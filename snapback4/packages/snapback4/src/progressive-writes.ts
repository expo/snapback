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

interface Plan {
  store: SessionStore;
  authority?: AdmissionAuthorityContext | undefined;
  report(error: unknown): void;
}
const plans = new WeakMap<object, Plan>();
type Custody = Awaited<ReturnType<typeof onlineCustody>>;
type ReceiptEvidence = { preserved: unknown; generation: unknown; store: string | undefined; authorityCurrent(): boolean };
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
  private snapshot: readonly (PendingWrite & { storeId?: string | null | undefined })[] = [];
  private snapshotValid = true;
  private retryInspection: (() => void) | undefined;
  private recoverOpening: (() => Promise<void>) | undefined;
  private bridgeOpeningWrites: ((journal: Client) => void) | undefined;
  private intentDelegate?: PendingIntentAccess;
  private deviceIntents?: PendingIntentAccess;
  private readonly intentSelections = new Map<object, { select: Parameters<NonNullable<PendingIntentAccess["retain"]>>[0]; release?: (() => void) | undefined }>();
  private lifetimePaused = false;
  private lifetimeClosed = false;
  private blocked: () => Refusal | undefined = () => undefined;
  get uncertain(): boolean { return !this.snapshotValid; }
  get inspectionFailure(): Refusal | undefined { return !this.custody ? this.admissionDenied : undefined; }
  private initial?: Journal;
  private sessionKey?: string;
  private candidate = false;
  private admissionDenied?: Refusal;
  private readonly receipts = new Map<string, ReceiptEvidence>();
  private readonly admitted = new Map<string, { op: string; evidence: ReceiptEvidence | undefined }>();
  // An id-only ring, independent of the receipt evidence cache.
  private readonly completed = new Set<string>();
  private readonly responding = new Map<string, number>();
  dispatch(id: string): () => void {
    this.responding.set(id, (this.responding.get(id) ?? 0) + 1);
    return () => {
      const remaining = (this.responding.get(id) ?? 1) - 1;
      if (remaining) this.responding.set(id, remaining); else this.responding.delete(id);
      this.trimCompleted();
    };
  }
  private trimCompleted(): void {
    for (const id of this.completed) {
      if (this.completed.size <= WRITE_HISTORY_LIMIT) break;
      // Peer settlement cannot evict the identity of an outstanding own reply.
      if (!this.responding.has(id)) this.completed.delete(id);
    }
  }
  receipt(id: string, evidence: ReceiptEvidence): boolean {
    // Completed ids still need live preservation, but cannot settle twice.
    if (this.completed.has(id)) return true;
    this.receipts.set(id, evidence);
    for (const key of this.receipts.keys()) {
      if (this.receipts.size <= WRITE_HISTORY_LIMIT) break;
      if (key !== id && !this.responding.has(key) && !this.admitted.has(key)) this.receipts.delete(key);
    }
    return false;
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
    await this.recoverOpening?.();
    if (!this.snapshotValid) this.retryInspection?.();
    return this.current();
  }
  current(): readonly PendingWrite[] {
    const reason = this.blocked();
    return unique([...this.snapshot, ...this.custody?.captures() ?? []]).map(({ storeId: _store, ...write }) => reason ? { ...write, state: "held", reason: `${reason.code}: ${reason.message}` } : write);
  }
  refuseStore(why: Refusal, adoptedStore?: string): void { void this.custody?.refuseStore(why, adoptedStore).catch(this.plan.report); }
  async install(local: Client, storeIdentity: string | undefined, fetch: typeof globalThis.fetch, changed: (op: string | undefined, committed?: number, evidence?: ReceiptEvidence) => void,
    deviceKnown: (id: string) => boolean | undefined, blocked: () => Refusal | undefined = () => undefined,
    observation: () => ReceiptEvidence | undefined = () => undefined, original: Client = { ...local }, recoveringOpening = false): Promise<void> {
    this.blocked = blocked;
    const openingEvidence = observation();
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
      // Keep the handle captured by the app's pause/store-retirement callbacks.
      lifetimes.set(local, { client: local, start: () => {
        if (this.lifetimeClosed) return;
        this.lifetimePaused = false;
        if (!this.custody) void this.recoverOpening?.();
      }, pause: () => { this.lifetimePaused = true; },
        recover: async () => {}, refuseStore: async () => {}, captures: () => [],
        captureState: async () => ({ unsettled: true, peers: [] }), inspect: async () => ({ pending: [], receipts: [] }) });
    }
    const learned = new Map<string, Write>();
    const recorded = (id: string): Write | undefined => local.viewer() === this.viewer && this.initial
      ? publicWrite(learned.get(id) ?? this.initial.receipts.find(write => write.id === id) ?? retiredReceipt(this.initial, id) ?? capturedReceipt(this.initial, id)) : undefined;
    if (this.admissionDenied && !recoveringOpening) {
      const denied = this.admissionDenied;
      let recovering: Promise<void> | undefined, closed = false;
      local.mutate = routeMutations(original.mutate, (op, args, options) => {
        if (local.viewer() !== this.viewer) return failedAdmission(options?.id ?? mintId(), { code: "E_AUTH", family: "auth", message: "sign in to write" });
        if (closed) return original.mutate(op, args, options);
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
      const close = async (signOut: boolean) => {
        // Fence the original client's act/sendPost now, before recovery drains.
        // @ref LLP 3000.013#6 — retain responses until both local cleanups finish.
        const finish = holdClose(local);
        try {
          if (this.custody) {
            // Published custody has already installed the steady close. Use
            // its transport, save and inspection cleanup even from a saved callback.
            closed = this.lifetimeClosed = this.lifetimePaused = true; this.recoverOpening = undefined;
            await (signOut ? local.signOut() : local.close());
            return;
          }
          closed = this.lifetimeClosed = this.lifetimePaused = true; this.recoverOpening = undefined;
          const ending = signOut ? original.signOut() : original.close();
          const results = await Promise.allSettled([ending, recovering]);
          for (const result of results) if (result.status === "rejected") throw result.reason;
        } finally { finish(); }
      };
      local.close = () => close(false); local.signOut = () => close(true);
      const recoverJournal = journalReader(this.key, this.viewer, this.url, this.plan.store, (error, preserved) => {
        // Saved bytes still need their side-key notice after this lifetime ends.
        if (!preserved && (closed || local.viewer() !== this.viewer)) return;
        this.plan.report(error);
      }, false);
      this.recoverOpening = () => closed || this.lifetimePaused || local.viewer() !== this.viewer ? Promise.resolve() : recovering ??= (async () => {
        try {
          // Opening inspection preserves bytes. A dependent read may retry the
          // existing quarantine/recovery under the same journal/session locks.
          const initial = await storeLock(this.key, () => storeLock(this.sessionKey!, () =>
            recoverJournal(true)));
          // Capture storage is part of the opening inspection too. Do not
          // clear its typed refusal until that same source is readable again.
          if (this.plan.authority) OnlineCapture.unsettled(this.url, this.plan.authority);
          if (closed || this.lifetimePaused || local.viewer() !== this.viewer) return;
          this.initial = initial;
          // Keep admission and close fenced until install replaces both wrappers.
          // Its method snapshot must still name the device, not this denial.
          await this.install(local, storeIdentity, fetch, changed, deviceKnown, blocked, observation, original, true);
          if (closed || this.lifetimePaused) {
            if (closed || this.custody) this.recoverOpening = undefined;
            if (closed && this.custody) await local.close();
          } else if (this.custody) {
            delete this.admissionDenied; this.recoverOpening = undefined;
            this.custody.start(); changed(undefined);
          }
        } catch {
          if (!this.custody) this.admissionDenied ??= denied;
        } finally {
          // A failed nested install may have installed another denial frame.
          // Closing this lifetime must retire that frame's retry as well.
          if (closed) this.recoverOpening = undefined;
        }
      })().finally(() => { recovering = undefined; });
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
      Object.assign(lifetimes.get(local)!, { client: refused, start() {}, pause() {}, recover: async () => {}, refuseStore: async () => {}, captures: () => [], captureState: async () => ({ unsettled: false, peers: [] }), inspect: async () => ({ pending: [], receipts: [] }) });
      return;
    }
    // This private, read-less transport reuses the shipped online retry queue.
    // The local client supplies every credential, store and rollback fence.
    // It has no refresh authority, subscriptions, interpreter or result cache.
    const retired = () => this.lifetimeClosed || local.viewer() !== this.viewer;
    if (retired()) return;
    const options = { url: this.url, ...(local.session() ? { token: local.session()!.token } : { persona: this.viewer.slice(4) }), fetch };
    const transport = (await prepareClient(options, () => sdkOwned(() => createClient(options)))).client;
    if (retired()) { await transport.close(); return; }
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
      if (preserved || this.custody || !retired()) this.plan.report(error);
    };
    let failing = false;
    const reportFailure = (error: unknown) => {
      if (!failing) { failing = true; report(error); }
    };
    let opened: Custody;
    try {
      opened = await onlineCustody(raw, this.url, this.plan.store, report, false,
        this.plan.authority, true, true, reportFailure);
    } catch (error) {
      await transport.close();
      if (retired()) return;
      this.snapshotValid = false;
      this.admissionDenied = admissionRefusal(`the write journal cannot be opened: ${String(error)}`, "app.mutate", "repair browser storage, then retry a read");
      this.plan.report(new StorageWarning(this.admissionDenied));
      return this.install(local, storeIdentity, fetch, changed, deviceKnown, blocked, observation, original);
    }
    if (retired()) { await opened.client.close(); return; }
    // Update the existing handle, including consumers created during failure.
    const custody = Object.assign(lifetimes.get(local)!, opened), journal = custody.client;
    this.custody = custody;
    custody.start = () => {
      if (retired()) return;
      // A pause while opening defers dispatch; only close retires the device.
      const resuming = this.lifetimePaused;
      this.lifetimePaused = false; delete this.admissionDenied; opened.start();
      if (resuming) void refresh();
    };
    this.bridgeOpeningWrites?.(journal); this.bridgeOpeningWrites = undefined;
    const deviceIntents = this.deviceIntents!, journalIntents = pendingIntentAccess(journal);
    const devicePending = original.pendingWrites;
    const binding = (evidence: ReceiptEvidence | undefined, store: string | null | undefined) => evidence && {
      // Inspection knows the intent's store, not the peer's execution program.
      ...evidence, store: store ?? undefined, generation: undefined, preserved: undefined,
    };
    const admitted = this.admitted, completed = this.completed;
    for (const intent of this.initial?.pending ?? []) admitted.set(intent.id, { op: intent.op, evidence: binding(openingEvidence, intent.storeId) });
    const observe = (entries: readonly (PendingWrite & { storeId?: string | null | undefined })[], receipts: readonly Write[], evidence = observation()) => {
      this.snapshot = entries;
      for (const entry of unique([...entries, ...custody.captures()])) if (!completed.has(entry.id)) {
        const prior = admitted.get(entry.id);
        // Identity waits are visible before capture has an original store.
        // Fill that binding once; never rebind an already identified intent.
        if (!prior || prior.evidence?.store === undefined && entry.storeId != null) {
          admitted.set(entry.id, { op: entry.op, evidence: binding(evidence, entry.storeId) });
          if (!prior) changed(entry.op);
        }
      }
      for (const write of receipts) {
        // Inspection can learn a peer's settlement after the opening snapshot.
        // Retain positive ownership so an unlisted device cannot refuse its retry.
        learned.set(write.id, publicWrite(write));
        if (learned.size > WRITE_HISTORY_LIMIT) learned.delete(learned.keys().next().value!);
        const admission = admitted.get(write.id);
        if (admission !== undefined && write.state !== "pending" && !completed.has(write.id)) {
          const evidence = this.receipts.get(write.id) ?? admission.evidence; this.receipts.delete(write.id);
          completed.add(write.id); admitted.delete(write.id); changed(admission.op, write.state === "sent" ? write.seq : undefined, evidence);
          this.trimCompleted();
        }
      }
    };
    let refreshing: Promise<void> | undefined, dirty = false, active = true, retryAfter = 0, retryDelay = 100, capturePending = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = (invalidate = true) => {
      if (!active || this.lifetimePaused) return Promise.resolve();
      // Recovery can commit a capture before this runtime knows its operation.
      // Unknown notifications invalidate synchronously. Own live captures already
      // expose their footprint, so a held commit need not park disjoint reads.
      let knownCapture = !invalidate && this.snapshotValid;
      this.snapshotValid = false;
      dirty = true;
      changed(undefined);
      return refreshing ??= (async () => {
        do {
          dirty = false;
          const observed = observation();
          // An initially live peer may have died since opening. Re-run the same
          // locked recovery (including its liveness check) before inspecting.
          let captures = await custody.captureState();
          if (knownCapture && !dirty && !captures.unsettled) {
            // Publish the live capture footprints before waiting for a held
            // journal commit; peers discovered here also keep their reads parked.
            observe(unique([...this.snapshot, ...captures.peers]), [], observed);
            this.snapshotValid = true; changed(undefined);
          }
          // A coalesced notification owns a newer fence: only the first pass
          // may publish known footprints before its journal inspection.
          knownCapture = false;
          if (captures.unsettled) { this.snapshotValid = false; await custody.recover(); }
          const snapshot = await custody.inspect();
          captures = await custody.captureState();
          if (!active) return;
          observe(unique([...snapshot.pending, ...captures.peers]), snapshot.receipts, observed);
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
        if (active && (!this.snapshotValid || capturePending)) this.retryInspection?.();
      });
    };
    // Reads can repair a failed inspection without polling storage on every
    // evaluation or waiting behind a held inspection (including table-free reads).
    this.retryInspection = () => {
      if (!active || retryTimer !== undefined) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (!active || this.snapshotValid && !capturePending) return;
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
      if (this.lifetimeClosed) return original.mutate(op, args, options);
      if (this.lifetimePaused) return failedAdmission(options?.id ?? mintId(), this.admissionDenied ??
        admissionRefusal("write custody is paused", "app.mutate", "retry after opening resumes"));
      // Preserve the device mutation wait bound across its journal dispatcher.
      const journalOptions = { ...options, waitSeconds: options?.waitSeconds ?? 4 };
      if (options?.id) {
        const known = deviceKnown(options.id);
        if (known) return original.mutate(op, args, options);
        if (this.current().some(write => write.id === options.id) || this.initial?.pending.some(write => write.id === options.id)
          || this.receipts.has(options.id) || recorded(options.id)) return journal.mutate(op, args, journalOptions);
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
    const close = async (signOut: boolean) => {
      // @ref LLP 3000.002.000#7.2 — the device fence and pause both notify.
      // Route to the device before its close callbacks, and fence it before
      // pause callbacks; neither notification may open fresh journal custody.
      this.lifetimeClosed = this.lifetimePaused = true;
      const ending = signOut ? original.signOut() : original.close();
      active = false; this.retryInspection = undefined;
      clearTimeout(retryTimer);
      custody.pause(); stopPending(); stopWrite(); this.snapshot = []; this.snapshotValid = true; this.receipts.clear(); this.admitted.clear();
      await Promise.all([journal.close(), ending]);
    };
    local.close = () => close(false); local.signOut = () => close(true);
    combineClose(local, original, transport);
    await refresh();
  }
}
