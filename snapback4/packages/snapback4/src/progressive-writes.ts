// @ref LLP 3000.002.000#7.2 — choose once, under journal then session lock.
// No ownership field is added to either durable store. Each id stays home.
import type { Client, Mutation, MutateOptions, PendingWrite, Refusal, Write } from "./contract.ts";
import type { SessionStore } from "./auth.ts";
import type { AdmissionAuthorityContext } from "./admission-authority.ts";
import { storeKey, storeLock, StorageWarning } from "./app-storage.ts";
import { journalReader, retiredReceipt, capturedReceipt, type Journal } from "./app-journal.ts";
import { onlineCustody, publicWrite } from "./app-online.ts";
import { OnlineCapture } from "./online-capture.ts";
import { sdkOwned, admissionRefusal, failedAdmission, freshlyMinted } from "./admission.ts";
import { createClient, mintId } from "./client.ts";
import { prepareClient } from "./client-start.ts";
import { inheritDispatch, seedDispatchIdentity } from "./online-dispatch.ts";
import { pendingIntentAccess, registerPendingIntents, registerIntentObserver, observeIntents, intentObserver, type PendingIntentAccess } from "./pending-items.ts";
import { routeMutations } from "./ephemeral.ts";
import { inheritClose, combineClose, holdClose } from "./closing-responses.ts";
import { WRITE_HISTORY_LIMIT } from "./writes.ts";
import { extract, type Facts } from "./settlement-extract.ts";
import { initialState, step, type State, type Event, type Effect } from "./settlement-reducer.ts";

interface Plan {
  store: SessionStore;
  authority?: AdmissionAuthorityContext | undefined;
  report(error: unknown): void;
}
const plans = new WeakMap<object, Plan>();
type Custody = Awaited<ReturnType<typeof onlineCustody>>;
type Change = (op: string | undefined, effect?: Effect) => void;
type Observation = (value?: unknown, id?: string, op?: string, store?: string) => Facts;
const unknownObservation: Observation = (value, id = "", op, store) => extract(value,
  { kind: "observed", source: "journal-wrapper", id, op, footprintKnown: false, restoreConfirmed: false },
  { closed: false, sessionDead: false, credentialRevision: 0, incarnation: 0, storeIdentity: undefined,
    onlineStore: undefined, generation: undefined, onlineHead: 0, onlineGeneration: undefined,
    dispatchWatermark: 0, dispatchSendRevision: 0, dispatchStore: undefined, dispatchIncarnation: 0,
    requestRevision: 0, requestStore: store });
type Lifetime = "opening" | "denied" | "recovering" | "installed" | "retiring" | "retired";
type LifetimeEvent = "denied" | "recover" | "installed" | "retire" | "cleaned";
type Retirement = "pause" | "close" | "signOut" | "viewer";
// @ref LLP 3000.002.000.000#2.4 — absent edges are idempotent no-ops.
const transitions: Record<Lifetime, Partial<Record<LifetimeEvent, Lifetime>>> = {
  opening: { denied: "denied", installed: "installed", retire: "retiring" },
  denied: { recover: "recovering", retire: "retiring" },
  recovering: { denied: "denied", installed: "installed", retire: "retiring" },
  installed: { retire: "retiring" },
  retiring: { cleaned: "retired" },
  retired: {},
};
const lifetimes = new WeakMap<Client, Custody>();
export const prepareProgressiveWrites = (options: object, plan: Plan): void => { plans.set(options, plan); };
export const progressiveWriteCustody = (client: Client) => lifetimes.get(client);
const unique = <T extends { id: string }>(items: readonly T[]): T[] => [...new Map(items.map(item => [item.id, item])).values()];

export class ProgressiveWrites {
  readonly plan: Plan;
  readonly key: string;
  private selected: "journal" | "outbox" = "journal";
  get owner(): "journal" | "outbox" { return this.selected; }
  private decision?: Promise<boolean>;
  private custody?: Awaited<ReturnType<typeof onlineCustody>>;
  private activateCustody?: () => void;
  private snapshot: readonly (PendingWrite & { storeId?: string | null | undefined })[] = [];
  private snapshotValid = true;
  private retryInspection: (() => void) | undefined;
  private lifetime: Lifetime = "opening";
  private wakeAdmission!: () => void;
  private readonly admissionReady = new Promise<void>(resolve => { this.wakeAdmission = resolve; });
  private retirementCause?: Retirement;
  private retirementRefusal?: Refusal;
  private closing?: Promise<void>;
  private signingOut: Promise<void> | undefined;
  private endDevice: (() => void) | undefined;
  private local?: Client;
  private original?: Client;
  private opening?: [Client, string | undefined, typeof globalThis.fetch, Change, (id: string) => boolean | undefined, () => Refusal | undefined, Observation, Client];
  private openingReader?: ReturnType<typeof journalReader>;
  private recovering: Promise<void> | undefined;
  private readonly openingWork = new Set<Promise<unknown>>();
  private stopInspection?: () => void;
  private stopViewer?: () => void;
  private bridgeOpeningWrites: ((journal: Client) => void) | undefined;
  private intentDelegate?: PendingIntentAccess;
  private deviceIntents?: PendingIntentAccess;
  private readonly intentSelections = new Map<object, { select: Parameters<NonNullable<PendingIntentAccess["retain"]>>[0]; release?: (() => void) | undefined }>();

  private blocked: () => Refusal | undefined = () => undefined;
  private get retired(): boolean { return this.lifetime === "retiring" || this.lifetime === "retired"; }
  private track<T>(work: Promise<T>): Promise<T> {
    this.openingWork.add(work);
    void work.then(() => this.openingWork.delete(work), () => this.openingWork.delete(work));
    return work;
  }
  // @ref LLP 3000.002.000.000#2.4 — the sole lifetime writer, shared by every
  // retained callback and nested install. Resource promises are drains, not states.
  private transition(event: LifetimeEvent, cause: Retirement = "close"): Promise<void> {
    const next = transitions[this.lifetime][event] ?? this.lifetime;
    if (next !== this.lifetime) {
      this.lifetime = next;
      if (next === "installed" || next === "retiring") this.wakeAdmission();
      if (next === "retiring") {
        this.retirementCause = cause;
        const signsOut = cause === "signOut" || cause === "viewer" || !!this.local?.viewer && this.local.viewer() !== this.viewer;
        this.retirementRefusal = signsOut
          ? { code: "E_AUTH", family: "auth", message: "sign in to write" }
          : { code: "E_CLOSED", family: "client", message: "this client is closed" };
        const finish = holdClose(this.local);
        let resolve!: () => void, reject!: (error: unknown) => void;
        this.closing = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
        // signOut fences synchronously, then calls this client's close after
        // session notifications. Keep that ordering: closing the device early
        // would erase those notifications and change its immediate E_AUTH.
        // The common drain waits for device close, not signOut (which awaits
        // this very drain). A reentrant close starts the device cleanup once.
        const ending = new Promise<void>((resolve, reject) => {
          this.endDevice = () => {
            this.endDevice = undefined;
            Promise.resolve(this.original?.close()).then(resolve, reject);
          };
        });
        if (signsOut) this.signingOut = this.original?.signOut();
        else this.endDevice?.();
        this.stopViewer?.(); this.stopInspection?.();
        const journal = this.custody?.client.close();
        this.snapshot = []; this.snapshotValid = true;
        void (async () => {
          const failures: unknown[] = [];
          const collect = async (work: readonly (Promise<unknown> | undefined)[]) => {
            for (const result of await Promise.allSettled(work)) if (result.status === "rejected") failures.push(result.reason);
          };
          await collect([ending, journal]);
          // A nested install can create its transport while retirement is
          // draining. Its tracked task closes that resource before settling.
          while (this.openingWork.size) await collect([...this.openingWork]);
          await this.transition("cleaned");
          if (failures.length) throw failures[0];
        })().then(() => { finish(); resolve(); }, error => { finish(); reject(error); });
      }
    }
    if (event === "retire" && cause === "close") this.endDevice?.();
    if (event === "retire" && cause === "signOut") {
      this.signingOut ??= this.original?.signOut();
      return Promise.all([this.closing, this.signingOut]).then(() => {});
    }
    return event === "retire" ? this.closing ?? Promise.resolve() : Promise.resolve();
  }
  private start(): void {
    if (this.retired) return;
    if (this.lifetime === "denied") void this.recover();
    else this.activateCustody?.();
  }
  private recover(): Promise<void> {
    if (this.recovering) return this.recovering;
    if (this.lifetime !== "denied" || !this.opening || !this.openingReader) return Promise.resolve();
    const [local, ...args] = this.opening;
    if (local.viewer() !== this.viewer) return this.transition("retire", "viewer");
    void this.transition("recover");
    const run = (async () => {
      try {
        const initial = await storeLock(this.key, () => storeLock(this.sessionKey!, () => this.openingReader!(true)));
        if (this.plan.authority) OnlineCapture.unsettled(this.url, this.plan.authority);
        if (this.retired) return;
        if (local.viewer() !== this.viewer) { void this.transition("retire", "viewer"); return; }
        this.initial = initial;
        await this.install(local, ...args);
        if (this.custody && !this.retired) { this.activateCustody?.(); this.changed(undefined); }
      } catch {
        void this.transition("denied");
      }
    })();
    this.recovering = this.track(run).finally(() => { this.recovering = undefined; });
    return this.recovering;
  }
  get uncertain(): boolean { return !this.snapshotValid; }
  get inspectionFailure(): Refusal | undefined { return !this.custody ? this.admissionDenied : undefined; }
  private initial?: Journal;
  private sessionKey?: string;
  private candidate = false;
  private admissionDenied?: Refusal;
  private readonly states = new Map<string, State>();
  private retainedReceipts = new Set<string>();
  private observation: Observation = unknownObservation;
  private changed: Change = () => {};
  private reduce(id: string, event: Event, facts = this.observation(undefined, id, this.states.get(id)?.op, this.states.get(id)?.storeId)): void {
    const { state, effects } = step(this.states.get(id) ?? initialState(0), event, facts);
    this.states.set(id, state);
    for (const effect of effects) {
      switch (effect.type) {
        case "settle": this.snapshot = this.snapshot.filter(entry => entry.id !== id); break;
        case "startEpisode": case "publish": this.changed(state.op ?? facts.op, effect); break;
        case "retain": if (effect.invalidate) this.changed(state.op); break;
        // The raw transport delivers the invocation's full live body under its
        // response hold, including late own replies after a peer's completion.
        // This logical owner notification must not emit a second public receipt.
        case "deliverOutcome": break;
        // The journal wrapper is the single refusal actor and executes this
        // decision before metadata adoption, then registers the response here.
        case "retire": break;
        case "discard": this.states.delete(id); break;
      }
    }
  }
  dispatch(id: string): () => void {
    this.reduce(id, { type: "dispatched" });
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.reduce(id, { type: "transportFinished" });
      this.trim();
    };
  }
  private trim(inserted?: string): void {
    let history = [...this.states.values()].filter(state => state.phase === "settled").length;
    for (const id of this.states.keys()) {
      if (history <= WRITE_HISTORY_LIMIT) break;
      // A retained receipt must keep its completed state: journal compaction
      // evicts unknown outcomes first, independently of state insertion order.
      // Pending/unpublished/outstanding pins still belong to the reducer's row.
      if (id !== inserted && !this.retainedReceipts.has(id)) { this.reduce(id, { type: "evicted" }); if (!this.states.has(id)) history--; }
    }
  }
  receipt(id: string, facts: Facts): void {
    if (!facts.certificate) return;
    this.reduce(id, { type: "response", certificate: facts.certificate }, facts);
    this.trim(id);
  }
  constructor(options: object, readonly url: string, readonly viewer: string) {
    this.plan = plans.get(options)!;
    this.key = storeKey("writes", url, viewer);
  }
  static for(options: object, url: string, viewer: string): ProgressiveWrites | undefined {
    return plans.has(options) ? new ProgressiveWrites(options, url, viewer) : undefined;
  }
  decide(sessionKey: string, probe: () => Promise<"none" | "present" | "unknown">): Promise<boolean> {
    this.sessionKey = sessionKey;
    return this.decision ??= storeLock(this.key, () => storeLock(sessionKey, async () => {
      let custody: "none" | "present" | "unknown" = "unknown";
      try { custody = await probe(); } catch { /* Unknown preserves A1's awaited device open. */ }
      try {
        this.initial = await journalReader(this.key, this.viewer, this.url, this.plan.store, this.plan.report, true)(false);
        const captured = this.plan.authority && OnlineCapture.unsettled(this.url, this.plan.authority);
        this.candidate = custody !== "none" && !this.initial.pending.length && !captured;
      } catch (error) {
        this.snapshotValid = false;
        this.admissionDenied = admissionRefusal(`the write journal cannot be inspected: ${String(error)}`, "app.mutate", "repair browser storage, then retry a read");
        this.plan.report(new StorageWarning(this.admissionDenied));
        return custody === "none";
      }
      return !this.candidate;
    }));
  }
  async compatible(): Promise<void> {
    if (!this.candidate) return;
    // Opening the engine can yield to another document's journal admission.
    // Select from current custody under the same lock order, after handshake.
    await storeLock(this.key, () => storeLock(this.sessionKey!, async () => {
      try {
        this.initial = await journalReader(this.key, this.viewer, this.url, this.plan.store, this.plan.report, true)(false);
        const captured = this.plan.authority && OnlineCapture.unsettled(this.url, this.plan.authority);
        if (!this.initial.pending.length && !captured) this.selected = "outbox";
      } catch (error) {
        this.snapshotValid = false;
        this.admissionDenied = admissionRefusal(`the write journal cannot be inspected: ${String(error)}`, "app.mutate", "repair browser storage, then retry a read");
        this.plan.report(new StorageWarning(this.admissionDenied));
      }
    }));
  }
  unavailable(): void { this.candidate = false; this.selected = "journal"; }
  async pending(): Promise<readonly PendingWrite[]> {
    await this.recover();
    if (!this.snapshotValid) this.retryInspection?.();
    return this.current();
  }
  current(): readonly PendingWrite[] {
    const reason = this.blocked();
    return unique([...this.snapshot, ...this.custody?.captures() ?? []]).filter(write => this.states.get(write.id)?.phase !== "settled").map(({ storeId: _store, ...write }) => reason ? { ...write, state: "held", reason: `${reason.code}: ${reason.message}` } : write);
  }
  refuseStore(why: Refusal, adoptedStore?: string): void { void this.custody?.refuseStore(why, adoptedStore).catch(this.plan.report); }
  async install(local: Client, storeIdentity: string | undefined, fetch: typeof globalThis.fetch, changed: Change,
    deviceKnown: (id: string) => boolean | undefined, blocked: () => Refusal | undefined = () => undefined,
    observation: Observation = unknownObservation, original: Client = { ...local }): Promise<void> {
    return this.track(this.installFrame(local, storeIdentity, fetch, changed, deviceKnown, blocked, observation, original));
  }
  private async installFrame(local: Client, storeIdentity: string | undefined, fetch: typeof globalThis.fetch, changed: Change,
    deviceKnown: (id: string) => boolean | undefined, blocked: () => Refusal | undefined,
    observation: Observation, original: Client): Promise<void> {
    if (this.retired) return;
    this.blocked = blocked;
    this.observation = observation; this.changed = changed;
    if (!this.deviceIntents) {
      this.deviceIntents = this.intentDelegate = pendingIntentAccess(local);
      // Facades and hooks capture this provider before opening recovery succeeds.
      registerPendingIntents(local, {
        scope: () => this.intentDelegate!.scope(), revision: () => this.intentDelegate!.revision?.(),
        read: () => this.intentDelegate!.read(),
        retain: select => {
          const owner = { select, release: this.intentDelegate!.retain?.(select) };
          this.intentSelections.set(owner, owner);
          return () => { owner.release?.(); this.intentSelections.delete(owner); };
        },
      });
      this.local = local; this.original = original;
      this.opening = [local, storeIdentity, fetch, changed, deviceKnown, blocked, observation, original];
      this.openingReader = journalReader(this.key, this.viewer, this.url, this.plan.store, (error, preserved) => {
        // Preservation notices always disclose their side key. A paused opening
        // also reports its final failure streak once; journalReader owns dedupe.
        if (preserved || this.retirementCause === "pause" || !this.retired && local.viewer() === this.viewer) this.plan.report(error);
      }, false);
      local.close = () => this.transition("retire", "close");
      local.signOut = () => this.transition("retire", "signOut");
      this.stopViewer = original.onViewer(viewer => { if (viewer !== this.viewer) void this.transition("retire", "viewer").catch(this.plan.report); });
      lifetimes.set(local, { client: local, start: () => this.start(),
        pause: () => { void this.transition("retire", "pause").catch(this.plan.report); },
        recover: async () => {}, refuseStore: async () => {}, captures: () => [],
        captureState: async () => ({ unsettled: true, peers: [] }), inspect: async () => ({ pending: [], receipts: [] }) });
    }
    const learned = new Map<string, Write>();
    const recorded = (id: string): Write | undefined => local.viewer() === this.viewer && this.initial
      ? publicWrite(learned.get(id) ?? this.initial.receipts.find(write => write.id === id) ?? retiredReceipt(this.initial, id) ?? capturedReceipt(this.initial, id)) : undefined;
    if (this.admissionDenied && this.lifetime !== "recovering") {
      const denied = this.admissionDenied;
      void this.transition("denied");
      local.mutate = routeMutations(original.mutate, (op, args, options) => {
        if (local.viewer() !== this.viewer) return failedAdmission(options?.id ?? mintId(), { code: "E_AUTH", family: "auth", message: "sign in to write" });
        if (this.retired) return failedAdmission(options?.id ?? mintId(), this.retirementRefusal!);
        return failedAdmission(options?.id ?? mintId(), denied);
      });
      if (!this.bridgeOpeningWrites) {
        const listeners = new Set<Parameters<Client["onWrite"]>[0]>(), pendingListeners = new Set<() => void>(); let waiting = true;
        local.onWrite = listener => { const stop = original.onWrite(listener); if (waiting) listeners.add(listener); return () => { stop(); listeners.delete(listener); }; };
        local.onPendingWrites = listener => { const stop = original.onPendingWrites(listener); if (waiting) pendingListeners.add(listener); return () => { stop(); pendingListeners.delete(listener); }; };
        this.bridgeOpeningWrites = journal => {
          waiting = false;
          journal.onWrite(write => { for (const listener of listeners) listener(write); });
          journal.onPendingWrites(() => { for (const listener of pendingListeners) listener(); });
        };
      }
      return;
    }
    if (this.owner === "outbox") {
      // No private transport, subscriptions or journal reads in the steady device path.
      // The opening snapshot still protects ids recorded by the other store.
      local.mutate = routeMutations(original.mutate, <A, R>(op: Mutation<A, R>, args: A, options?: MutateOptions) => {
        const known = options?.id && recorded(options.id);
        return known ? Promise.resolve(known as Write<R>) : original.mutate(op, args, options);
      });
      local.write = id => Promise.resolve(recorded(id) ?? original.write(id));
      const refused = { ...local, mutate: routeMutations(original.mutate, (_op, _args, options) => failedAdmission(options?.id ?? mintId(),
        admissionRefusal("the device outbox owns fresh writes in this document", "app.mutate", "submit through app.mutate"))) };
      void this.transition("installed");
      Object.assign(lifetimes.get(local)!, { client: refused, recover: async () => {}, refuseStore: async () => {}, captures: () => [], captureState: async () => ({ unsettled: false, peers: [] }), inspect: async () => ({ pending: [], receipts: [] }) });
      return;
    }
    // This private, read-less transport reuses the shipped online retry queue.
    // The local client supplies every credential, store and rollback fence.
    // It has no refresh authority, subscriptions, interpreter or result cache.
    const retired = () => {
      if (local.viewer() !== this.viewer && !this.retired) void this.transition("retire", "viewer").catch(this.plan.report);
      return this.retired;
    };
    if (retired()) return;
    const options = { url: this.url, ...(local.session() ? { token: local.session()!.token } : { persona: this.viewer.slice(4) }), fetch };
    const transport = (await prepareClient(options, () => sdkOwned(() => createClient(options)))).client;
    if (retired()) { await transport.close(); return; }
    combineClose(local, original, transport);
    const raw: Client = { ...local, mutate: transport.mutate, write: transport.write,
      pendingWrites: transport.pendingWrites, onPendingWrites: transport.onPendingWrites, onWrite: transport.onWrite,
      close: () => transport.close(), signOut: () => transport.close() };
    inheritDispatch(raw, transport); inheritClose(raw, transport);
    // Seed the existing dispatch boundary before exposing synchronous captures.
    if (storeIdentity) seedDispatchIdentity(raw, storeIdentity);
    const report = (error: unknown, preserved = false) => {
      // Suppress only unpublished, retired openings. Installed custody keeps
      // ordinary persistence-error reporting through its cleanup; saved bytes
      // always disclose their recovery key, even from nested opening.
      if (preserved || this.retirementCause === "pause" || this.custody || !retired()) this.plan.report(error);
    };
    let failing = false;
    const reportFailure = (error: unknown) => {
      if (!failing) { failing = true; report(error); }
    };
    let opened: Custody;
    try {
      opened = await onlineCustody(raw, this.url, this.plan.store, report, false,
        this.plan.authority, true, true, reportFailure, (kind, write) => {
          if (!this.states.has(write.id)) return;
          const prior = this.states.get(write.id), facts = observation(write, write.id, prior?.op, prior?.storeId);
          this.reduce(write.id, { type: kind, receipt: facts.outcome!, ...(facts.certificate ? { certificate: facts.certificate } : {}) }, facts);
          this.trim(write.id);
        }, { admission: () => this.retired ? { why: this.retirementRefusal! }
          : this.lifetime === "installed" ? {} : { wait: this.admissionReady },
          installed: () => { void this.transition("installed"); },
          retire: () => { void this.transition("retire", "viewer").catch(this.plan.report); } });
    } catch (error) {
      await transport.close();
      if (retired()) return;
      this.snapshotValid = false;
      this.admissionDenied = admissionRefusal(`the write journal cannot be opened: ${String(error)}`, "app.mutate", "repair browser storage, then retry a read");
      this.plan.report(new StorageWarning(this.admissionDenied));
      void this.transition("denied");
      return this.install(local, storeIdentity, fetch, changed, deviceKnown, blocked, observation, original);
    }
    if (retired()) { await opened.client.close(); return; }
    // Update the existing handle, including consumers created during failure.
    const handle = lifetimes.get(local)!;
    this.activateCustody = opened.start;
    const custody = this.custody = Object.assign(handle, opened, { start: () => this.start(),
      pause: () => { void this.transition("retire", "pause").catch(this.plan.report); } }), journal = custody.client;
    // The dispatcher can capture now. It becomes installed for admission only
    // after start has issued the restored prefix (the custody callback above).
    this.bridgeOpeningWrites?.(journal); this.bridgeOpeningWrites = undefined;
    const deviceIntents = this.deviceIntents!, journalIntents = pendingIntentAccess(journal);
    const devicePending = original.pendingWrites;
    for (const intent of this.initial?.pending ?? []) this.reduce(intent.id,
      { type: "admitted", op: intent.op, footprintKnown: observation(undefined, intent.id, intent.op).footprintKnown, initial: true },
      observation(undefined, intent.id, intent.op, intent.storeId ?? undefined));
    const observe = (entries: readonly (PendingWrite & { storeId?: string | null | undefined })[], receipts: readonly Write[], complete = false) => {
      this.snapshot = entries;
      if (complete) this.retainedReceipts = new Set(receipts.map(write => write.id));
      for (const entry of unique([...entries, ...custody.captures()])) {
        const facts = observation(undefined, entry.id, entry.op, entry.storeId ?? undefined);
        this.reduce(entry.id, { type: "admitted", op: entry.op, footprintKnown: facts.footprintKnown }, facts);
      }
      for (const write of receipts) {
        learned.set(write.id, write);
        if (learned.size > WRITE_HISTORY_LIMIT) learned.delete(learned.keys().next().value!);
        if (!this.states.has(write.id)) continue;
        const prior = this.states.get(write.id), facts = observation(write, write.id, prior?.op, prior?.storeId);
        if (facts.outcome) this.reduce(write.id, { type: "observed", receipt: facts.outcome,
          ...(facts.certificate ? { certificate: facts.certificate } : {}) }, facts);
      }
      if (complete) this.trim();
    };
    let refreshing: Promise<void> | undefined, dirty = false, retryAfter = 0, retryDelay = 100, capturePending = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = (invalidate = true) => {
      if (this.retired) return Promise.resolve();
      // Recovery can commit a capture before this runtime knows its operation.
      // Unknown notifications invalidate synchronously. Own live captures already
      // expose their footprint, so a held commit need not park disjoint reads.
      let knownCapture = !invalidate && this.snapshotValid;
      this.snapshotValid = false;
      dirty = true;
      changed(undefined);
      return refreshing ??= this.track((async () => {
        do {
          dirty = false;
          // An initially live peer may have died since opening. Re-run the same
          // locked recovery (including its liveness check) before inspecting.
          let captures = await custody.captureState();
          if (knownCapture && !dirty && !captures.unsettled) {
            // Publish the live capture footprints before waiting for a held
            // journal commit; peers discovered here also keep their reads parked.
            observe(unique([...this.snapshot, ...captures.peers]), []);
            this.snapshotValid = true; changed(undefined);
          }
          // A coalesced notification owns a newer fence: only the first pass
          // may publish known footprints before its journal inspection.
          knownCapture = false;
          if (captures.unsettled) { this.snapshotValid = false; await custody.recover(); }
          const snapshot = await custody.inspect();
          captures = await custody.captureState();
          if (this.retired) return;
          observe(unique([...snapshot.pending, ...captures.peers]), snapshot.receipts, true);
          capturePending = captures.peers.length > 0 || custody.captures().length > 0;
          this.snapshotValid = !dirty && !captures.unsettled;
          if (this.snapshotValid) failing = false;
          if (this.snapshotValid && !capturePending) { retryDelay = 100; clearTimeout(retryTimer); retryTimer = undefined; }
          changed(undefined);
        } while (dirty);
      })().catch(error => {
        this.snapshotValid = false;
        reportFailure(error);
      }).finally(() => {
        refreshing = undefined; retryAfter = Date.now() + retryDelay;
        if (!this.snapshotValid || capturePending) retryDelay = Math.min(retryDelay * 2, 3200);
        if (!this.retired && (!this.snapshotValid || capturePending)) this.retryInspection?.();
      }));
    };
    // Reads can repair a failed inspection without polling storage on every
    // evaluation or waiting behind a held inspection (including table-free reads).
    this.retryInspection = () => {
      if (this.retired || retryTimer !== undefined) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (this.retired || this.snapshotValid && !capturePending) return;
        if (refreshing) return; // Its completion schedules the next retry.
        else void refresh(!this.snapshotValid);
      }, Math.max(0, retryAfter - Date.now()));
    };
    let ownCaptures = new Set(custody.captures().map(write => write.id));
    const stopPending = journal.onPendingWrites(() => {
      const current = new Set(custody.captures().map(write => write.id));
      const newOwnCapture = [...current].some(id => !ownCaptures.has(id));
      ownCaptures = current;
      observe(this.snapshot, []); void refresh(!newOwnCapture);
    });
    const stopWrite = journal.onWrite(write => { this.snapshot = this.snapshot.filter(entry => entry.id !== write.id); observe(this.snapshot, [write]); void refresh(); });
    local.mutate = routeMutations(original.mutate, (op, args, options) => {
      if (this.retired) return failedAdmission(options?.id ?? mintId(), this.retirementRefusal!);
      // Preserve the device mutation wait bound across its journal dispatcher.
      const journalOptions = { ...options, waitSeconds: options?.waitSeconds ?? 4 };
      if (options?.id) {
        const known = deviceKnown(options.id);
        if (known) return original.mutate(op, args, options);
        if (this.current().some(write => write.id === options.id) || this.initial?.pending.some(write => write.id === options.id)
          || this.states.has(options.id) || recorded(options.id)) return journal.mutate(op, args, journalOptions);
        // A timestamp cannot exclude a concurrent peer's device admission.
        if (known === undefined && !freshlyMinted(options)) return failedAdmission(options.id, admissionRefusal("device write custody has not been listed", "app.mutate", "retry this id after device custody is recovered"));
      }
      if (this.admissionDenied) return failedAdmission(options?.id ?? mintId(), this.admissionDenied);
      return journal.mutate(op, args, journalOptions);
    });
    delete this.admissionDenied;
    local.write = async id => deviceKnown(id) ? original.write(id) : await journal.write(id) ?? original.write(id);
    local.pendingWrites = async () => unique([...(await this.pending()), ...(await devicePending())]);
    local.onPendingWrites = listener => { const a = original.onPendingWrites(listener), b = journal.onPendingWrites(listener); return () => { a(); b(); }; };
    local.onWrite = listener => { const a = original.onWrite(listener), b = journal.onWrite(listener); return () => { a(); b(); }; };
    this.intentDelegate = { scope: deviceIntents.scope, revision: () => deviceIntents.revision?.(),
      retain: select => { const a = deviceIntents.retain?.(select), b = journalIntents.retain?.(select); return () => { a?.(); b?.(); }; },
      read: async () => {
        const items = await journalIntents.read(), reason = blocked();
        const journalItems = items.map(item => reason && ["saving", "queued", "unknown", "held"].includes(item.phase)
          ? { ...item, phase: "held" as const, write: { ...item.write, state: "held" as const, reason: `${reason.code}: ${reason.message}` } } : item);
        return [...new Map([...journalItems, ...(await deviceIntents.read())].map(item => [item.write.id, item])).values()];
      } };
    for (const owner of this.intentSelections.values()) {
      owner.release?.(); owner.release = this.intentDelegate.retain?.(owner.select);
    }
    const deviceObserver = intentObserver(local);
    registerIntentObserver(local, ids => { deviceObserver?.(ids); observeIntents(journal, ids); });
    this.stopInspection = () => {
      this.retryInspection = undefined; clearTimeout(retryTimer);
      stopPending(); stopWrite();
    };
    await refresh();
  }
}
