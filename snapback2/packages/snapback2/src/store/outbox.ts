// @ref LLP 1012#7-writes-offline — the outbox is durable custody of unsent
// intents: each one owns a contiguous slice of a principal-bound replay grant,
// so its ids are known before the server has seen it and a retry is the same
// envelope. Delivered successes compact atomically; unresolved terminals remain dismissible.
import type { OutboxStatus } from "../types.js";
import { plainObject } from "../../../evaluator/src/value-runtime.js";
import { inboxKeyOf, type InboxRow } from "./inbox.js";
import { admittedMutationTargets } from "../mutation-targets.js";
import type {
  OverlayRow,
  RangeStore,
  StoreDelivery,
  StoreSwap,
  HeldProgram,
} from "./range-store.js";
import type { PendingDeliveryAcks } from '../delivery-acknowledgements.js';
import type { AdmittedMutationTargets } from '../mutation-targets.js';

export type OutboxState = "queued" | "committed" | "rejected" | "expired";
/** What the twin read when the intent was queued: the replay envelope's `trace` (LLP 1012 §7). */
export interface OutboxTrace {
  points: Array<{ table: string; index: string; key: unknown[]; digest: string | null }>;
  verdicts: Array<{ ruleHash: string; inputsDigest: string; result: boolean }>;
}
// @ref LLP 1012#7-writes-offline — one durable intent: its pinned id slice, its
// bytes, and its terminal response, so a retry is the same envelope.
export interface OutboxEntry {
  effects?: import("./success-compaction.js").SuccessEffects;
  targets?: import("../mutation-targets.js").AdmittedMutationTargets;
  intent: string;
  grant: string;
  offset: number;
  count: number;
  ids: string[];
  op: string;
  args: unknown;
  issuedSeq: number;
  expectedGeneration?: string;
  state: OutboxState;
  response?: unknown;
  presentation?: string; // The submitter's table choice, fixed with admission.
  predicted?: boolean;
  /** A pinned or confirmed authoritative row arrived; dismiss only after rendering it. */
  arrived?: true;
  /** Prediction and its trace were skipped; the program will check this write on the server. */
  reason?: "fence";
  /**
   * The owner's last non-retryable `input`/`schema` refusal of this queued intent's
   * replay (a removed enum case, LLP 1020 A2). The intent is unspent and still
   * queued; it is the one kind of queued entry `dismiss` admits. Cleared durably
   * before another replay can send, and on settlement.
   */
  refusal?: import("../types.js").Refusal;
  /** Engine-owned aggregate targets the prediction's overlay omits by design (the server writes them); absent when none. */
  omitted?: string[];
  trace?: OutboxTrace;
  createdAt: number;
  updatedAt: number;
  /** Durable FIFO position; assigned by the store when absent. */
  order?: number;
  /**
   * The inbox row this entry was admitted from, when a follower tab wrote it;
   * the row's public name `inbox:<key>` is an alias for this entry from then on
   * (LLP 1018.004 §1).
   */
  inbox?: number;
}

/** A principal-bound replay grant plus the client's own consumption cursor. */
export interface OutboxGrant {
  id: string;
  from: string;
  count: number;
  mintedAt: number;
  expiresAt: number;
  used: number;
}

export type QueuedInfo = Pick<OutboxEntry, 'intent' | 'state' | 'grant' | 'createdAt' | 'reason' | 'refusal'>;
/** Derive the blocked head from durable FIFO entries on either tab. */
export function blockedStatus(entries: Pick<QueuedInfo, 'intent' | 'state' | 'refusal'>[]): Pick<OutboxStatus, 'blocked'> {
  const head = entries.find(entry => entry.state === 'queued');
  return head?.refusal ? { blocked: { intent: head.intent, code: head.refusal.code } } : {};
}

export interface OutboxStore {
  pendingDeliveryAcks?(limit?: number): Promise<PendingDeliveryAcks>;
  replayBatch?(): Promise<OutboxEntry[]>;
  queued?(): Promise<OutboxEntry[]>;
  queuedInfo?(): Promise<QueuedInfo[]>;
  targets?(op: string, args: unknown, ids: readonly string[]): Promise<AdmittedMutationTargets | undefined>;
  acknowledgementWithoutTail?(entry: OutboxEntry): Promise<boolean>;
  compactedThrough?(): Promise<number>;
  all(): Promise<OutboxEntry[]>;
  get(intent: string): Promise<OutboxEntry | undefined>;
  put(entry: OutboxEntry): Promise<void>;
  remove(intent: string): Promise<void>;
  /** The grant new intents consume from, if one is held. */
  grant(): Promise<OutboxGrant | undefined>;
  /** Every held grant, including those older queued intents still name. */
  grants(): Promise<OutboxGrant[]>;
  /** Each op's persisted write bound (`maxNewIds`); an enqueue refuses without one. */
  bounds(): Promise<Record<string, number>>;
  /** The prediction overlay by intent: the rows a queued intent's local run wrote, `removed` for a delete. */
  overlay(): Promise<Record<string, OverlayRow[]>>;
  /** The certified programs held for this partition, keyed by generation. */
  programs(): Promise<Record<string, HeldProgram>>;
}

/** A predicted row: the write's final image, or a `removed` marker for a row the intent deletes. */
export const ENGINE_ID = /^s2id-([0-9a-f]{32})-([0-9a-f]{16})$/;

/** A local custody refusal at enqueue time; the client maps it onto the offline family. */
export class OutboxRefusal extends Error {
  readonly code = "E_OFFLINE_ID_BLOCK";
  readonly site = "client.outbox.enqueue";
  constructor(message: string, readonly rewrite: string = "reconnect as this account, then send again") {
    super(message);
    this.name = "OutboxRefusal";
  }
}

export function emptyTrace(): OutboxTrace {
  return { points: [], verdicts: [] };
}

/** Reads `grant` off a signup, login, guest, or resume response; anything malformed is ignored. */
export function decodeGrant(value: unknown): OutboxGrant | undefined {
  if (!plainObject(value) || !plainObject(value.grant)) return undefined;
  const record = value.grant;
  if (typeof record.id !== "string" || typeof record.from !== "string" || !ENGINE_ID.test(record.from)
    || !Number.isSafeInteger(record.count) || (record.count as number) <= 0
    || !Number.isSafeInteger(record.mintedAt) || !Number.isSafeInteger(record.expiresAt)) return undefined;
  return {
    id: record.id,
    from: record.from,
    count: record.count as number,
    mintedAt: record.mintedAt as number,
    expiresAt: record.expiresAt as number,
    used: 0,
  };
}

/** The engine ids `from + offset …`, spelled exactly as `Store::replay_slice_ids` spells them. */
export function sliceIds(grant: Pick<OutboxGrant, "from" | "count">, offset: number, count: number): string[] {
  const match = ENGINE_ID.exec(grant.from);
  if (!match || count <= 0 || offset < 0 || offset + count > grant.count) return [];
  const first = BigInt(`0x${match[2]!}`) + BigInt(offset);
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(`s2id-${match[1]}-${(first + BigInt(index)).toString(16).padStart(16, "0")}`);
  }
  return ids;
}

/** A queued entry is eligible only while its last attempt is a known input/schema refusal.
 * Only drainQueued records that field, after excluding retryable and other refusals. */
export function dismissible(entry: OutboxEntry): boolean {
  return entry.state !== "queued" || entry.refusal !== undefined;
}

export interface EnqueueInput {
  op: string;
  args: unknown;
  issuedSeq: number;
  expectedGeneration?: string;
  presentation?: string;
  trace?: OutboxTrace;
  /** The inbox row this intent is admitted from (LLP 1018.004 §2). */
  inbox?: number;
}

/** Why an inbox row could not be admitted now; temporary refusals leave it queued and stop the loop behind it. */
export type InboxAdmission =
  | { state: "admitted"; entry: OutboxEntry }
  | { state: "already"; intent: string }
  | { state: "rejected" }
  | { state: "gone" };

/** The twin's run over held rows for the slice it was handed: the overlay and the trace land with the entry. */
export interface EnqueuePrediction {
  predicted: boolean;
  overlay: OverlayRow[];
  trace: OutboxTrace;
  /** Maintained targets the overlay intentionally omits (LLP 1012 §7); recorded on the entry when non-empty. */
  omitted?: string[];
}


export interface OutboxLedgerOptions {
  now(): number;
  fenceMs: number;
}

export class OutboxLedger {
  private readonly listeners = new Set<() => void>();
  /** A successful resume renews trust without changing the server-minted grant's age. */
  private resumedAt?: number;
  /** Runtime lifecycle, advanced synchronously on open, seal, wipe, reset, or close. */
  private trustGeneration = 0;
  /**
   * Grant custody is one critical section: a read of the grant's cursor and the
   * swap that advances it never interleave with another enqueue or adoption, so
   * two overlapping writes can never mint the same slice.
   */
  private tail: Promise<void> = Promise.resolve();
  private fenceTimer?: ReturnType<typeof setTimeout>;
  private fenceProbe = 0;

  constructor(private readonly store: RangeStore, private readonly options: OutboxLedgerOptions) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.armFence();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.close();
    };
  }

  notify(): void {
    this.armFence();
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* observers cannot break custody */ }
    }
  }

  close(): void {
    this.fenceProbe += 1;
    clearTimeout(this.fenceTimer);
  }

  /** Readiness changes with time even when the outbox has no entries to push. */
  private armFence(): void {
    this.close();
    if (!this.listeners.size) return;
    const probe = this.fenceProbe;
    void this.grant().then((grant) => {
      if (probe !== this.fenceProbe || !grant) return;
      const now = this.options.now();
      if (grant.expiresAt <= now) return;
      const deadlines = [grant.expiresAt, this.trustEndsAt(grant) + 1].filter((at) => at > now);
      const remaining = Math.min(...deadlines) - now;
      this.fenceTimer = setTimeout(() => this.notify(), Math.min(remaining, 2_147_483_647));
      // A readiness observer must not keep a headless process alive for days.
      (this.fenceTimer as { unref?: () => void }).unref?.();
    }, () => undefined); // Sealed custody has no usable grant; status() reports it.
  }

  entries(): Promise<OutboxEntry[]> {
    return this.store.outbox.all();
  }

  async queued(): Promise<OutboxEntry[]> {
    if (this.store.outbox.queued) return this.store.outbox.queued();
    return (await this.entries()).filter((entry) => entry.state === "queued");
  }

  private queuedInfo(): Promise<QueuedInfo[]> {
    return this.store.outbox.queuedInfo?.() ?? this.queued();
  }

  grant(): Promise<OutboxGrant | undefined> {
    return this.store.outbox.grant();
  }

  async grantById(id: string): Promise<OutboxGrant | undefined> {
    return (await this.store.outbox.grants()).find((grant) => grant.id === id);
  }

  /** A fresh grant replaces the consumption target; older grants stay for the intents that name them. */
  adopt(grant: OutboxGrant, check?: () => void): Promise<void> {
    return this.write(async () => {
      const grants = await this.store.outbox.grants();
      const current = await this.store.outbox.grant();
      const held = grants.some(item => item.id === grant.id);
      const queued = new Set((await this.queued()).map(entry => entry.grant));
      check?.();
      // The carrier may defer after receiving the swap. Check authority both
      // before and after persistence, and restore the exact prior grant image
      // before releasing the ledger tail when lifecycle custody changed.
      await this.store.commit({ grants: { current: grant.id, ...(held ? {} : {
        put: [grant], remove: grants.filter(item => !queued.has(item.id)).map(item => item.id),
      }) } });
      try {
        check?.();
      } catch (authorityError) {
        try {
          await this.store.commit({ grants: {
            current: current?.id ?? null,
            put: grants,
            ...(held ? {} : { remove: [grant.id] }),
          } });
        } catch (rollbackError) {
          throw new AggregateError([authorityError, rollbackError], "grant adoption lost authority and rollback failed");
        }
        throw authorityError;
      }
      this.notify();
    });
  }

  /**
   * Persists the program's write bounds (each op's `maxNewIds`) beside the grants,
   * on the same tail as enqueue, so an enqueue issued after the program loaded
   * always sees the bound it certified. The certified program itself rides the
   * same swap when given, so a cold start with the network cut evaluates and
   * prices from custody, never from a fallback (LLP 1012 §7, §8).
   */
  recordBounds(bounds: Record<string, number>, programs?: Record<string, unknown>): Promise<void> {
    for (const [op, bound] of Object.entries(bounds)) {
      if (!Number.isSafeInteger(bound) || bound < 0) throw new TypeError(`write bound for ${op} must be a non-negative integer`);
    }
    return this.write(async () => {
      await this.commit({ bounds, programs: programs as never });
    });
  }

  /** The same admission checks enqueue applies, without consuming a slice. */
  async status(op?: string): Promise<OutboxStatus> {
    const pending = await this.pendingAcknowledgements();
    // Read pending before queued: admission can transfer the former into the
    // latter between reads, and may conservatively double-count, never vanish.
    const queued = await this.queuedInfo();
    op ??= pending.next?.op;
    const grant = await this.grant();
    const bound = op === undefined ? 0 : (await this.store.outbox.bounds())[op];
    const reason = !grant ? "grant-missing" : this.expired(grant) ? "grant-expired"
      : bound === undefined ? "program-missing" : grant.used + 1 + bound > grant.count ? "ids-exhausted" : "ready";
    return { ready: reason === "ready", reason, action: reason === "ready" ? "none" : "connect",
      remaining: queued.length + pending.remaining, fence: await this.fence(queued), ...blockedStatus(queued) };
  }

  // @ref LLP 1012#7-writes-offline — the fence bounds trust, never custody: a
  // grant older than fenceMs is past it unless this partition resumed
  // successfully after the crossing. The grant's own expiry is a separate
  // readiness fact (`expired`) that no resume renews.
  pastFence(grant: Pick<OutboxGrant, "mintedAt">): boolean {
    const crossedAt = grant.mintedAt + this.options.fenceMs;
    return this.options.now() > crossedAt && !this.resumedSince(crossedAt);
  }

  /** The server-minted grant's own lifetime; a resume renews fence trust, not the grant. */
  expired(grant: Pick<OutboxGrant, "expiresAt">): boolean {
    return this.options.now() >= grant.expiresAt;
  }

  /** When time alone next changes `fence()`: the crossing, or the lapse of a resume's renewed trust. */
  private trustEndsAt(grant: Pick<OutboxGrant, "mintedAt">): number {
    const crossedAt = grant.mintedAt + this.options.fenceMs;
    return this.resumedAt !== undefined && this.resumedAt >= crossedAt ? this.resumedAt + this.options.fenceMs : crossedAt;
  }

  private resumedSince(at: number): boolean {
    return this.resumedAt !== undefined && this.resumedAt >= at
      && this.options.now() - this.resumedAt <= this.options.fenceMs;
  }

  /** Trust belongs to this open partition and session, never to the next one. */
  resetTrust(): void {
    this.trustGeneration += 1;
    this.resumedAt = undefined;
    this.notify();
  }

  /** Capture before a resume starts; this is independent of the program generation. */
  get generation(): number { return this.trustGeneration; }

  /** A newer consumption grant cannot authorize work queued under an older one. */
  async canReplay(entry: QueuedInfo): Promise<boolean> {
    return this.replayTrusted(entry, await this.grantById(entry.grant));
  }

  private replayTrusted(entry: QueuedInfo, grant: OutboxGrant | undefined): boolean {
    if (entry.reason === "fence" && !this.resumedSince(entry.createdAt)) return false;
    // Without the original grant's trust facts only a subsequent resume can
    // authorize sending; the owner still judges the grant and the intent.
    return grant ? !this.pastFence(grant) : this.resumedSince(entry.createdAt);
  }

  async fence(queued?: QueuedInfo[]): Promise<"inside" | "past"> {
    queued ??= await this.queuedInfo();
    const grants = await this.store.outbox.grants();
    for (const entry of queued) {
      if (!this.replayTrusted(entry, grants.find(grant => grant.id === entry.grant))) return "past";
    }
    const grant = await this.grant();
    return grant && this.pastFence(grant) ? "past" : "inside";
  }

  /** The owner re-authorized this partition; old intents may now replay for the server to judge. */
  resumeSucceeded(generation: number): boolean {
    // Grant persistence can finish after a seal has already invalidated trust.
    if (generation !== this.trustGeneration) return false;
    this.resumedAt = this.options.now();
    this.notify();
    return true;
  }

  // @ref LLP 1012#7-writes-offline — the full reserved slice is the program's
  // `new` envelope; grant:offset names the intent independently. The certificate's
  // persisted write bound prices the slice. No bound, or no remaining ids, is a refusal,
  // never a silent reuse or a guessed reservation.
  enqueue(input: EnqueueInput, predict?: (ids: string[]) => Promise<EnqueuePrediction>, beforeCommit?: () => void): Promise<OutboxEntry> {
    return this.write(() => this.enqueueNow(input, predict, beforeCommit));
  }

  async pendingAcknowledgements(limit = 1): Promise<PendingDeliveryAcks> {
    return await this.store.outbox.pendingDeliveryAcks?.(limit) ?? { remaining: 0 };
  }

  /** Page acknowledgement admission shares the ordinary FIFO write lock. */
  admitAcknowledgements(): Promise<number> {
    const generation = this.generation;
    const custody = () => { if (generation !== this.generation) throw new OutboxRefusal("offline custody changed"); };
    return this.write(async () => {
      if (generation !== this.generation) return 0;
      const pending = await this.pendingAcknowledgements(16), entries: OutboxEntry[] = [];
      if (!pending.next) return 0;
      if ((await this.store.inboxRows?.())?.some(row => row.kind === 'mutation' && row.state === 'queued' && row.admitted === undefined)) return 0;
      let grant = await this.grant();
      const bounds = await this.store.outbox.bounds();
      let keyBytes = 0;
      // @ref LLP 1018.008.007.002#5-batch-acknowledgement-admission-and-replay —
      // one bounded FIFO turn owns every slice and event binding atomically.
      for (const batch of pending.batches ?? [pending.next]) {
        // Ack admission changes event bindings, one outbox key per intent, and
        // grant/clock accounting. Leave half the journal for existing custody.
        const size = batch.args.events.reduce((n, event) => n + event.length + batch.op.length + 96, 0) + 256 + (grant?.id.length ?? 0);
        if (entries.length && keyBytes + size > 131_072) break;
        try {
          custody();
          const prepared = await this.prepareEntry(batch, grant, bounds);
          entries.push(prepared.entry); grant = prepared.grant; keyBytes += size;
        } catch (error) { if (!(error instanceof OutboxRefusal)) throw error; break; }
      }
      if (!entries.length || generation !== this.generation) return 0;
      await this.commit({ grants: { put: [grant!] }, outbox: { put: entries } });
      return entries.reduce((count, entry) => count + (entry.args as { events: string[] }).events.length, 0);
    });
  }

  private async enqueueNow(
    input: EnqueueInput,
    predict?: (ids: string[]) => Promise<EnqueuePrediction>,
    beforeCommit?: () => void,
    extra?: (entry: OutboxEntry, grant: OutboxGrant) => Partial<import("./range-store.js").StoreSwap>,
  ): Promise<OutboxEntry> {
      const grant = await this.grant();
      const prepared = await this.prepareEntry(input, grant, await this.store.outbox.bounds(), predict);
      beforeCommit?.();
      await this.commit({
        grants: { put: [prepared.grant] }, outbox: { put: [prepared.entry] },
        ...(prepared.overlay ? { overlay: { put: { [prepared.entry.intent]: prepared.overlay } } } : {}),
        ...extra?.(prepared.entry, grant!),
      });
      // The ledger lock excludes settlement; commit already gave this entry
      // custody. A second read can be sealed after commit and lose its identity.
      return structuredClone(prepared.entry);
  }

  private async prepareEntry(input: EnqueueInput, grant: OutboxGrant | undefined, bounds: Record<string, number>,
    predict?: (ids: string[]) => Promise<EnqueuePrediction>): Promise<{ entry: OutboxEntry; grant: OutboxGrant; overlay?: OverlayRow[] }> {
      const args = structuredClone(input.args);
      if (!grant) throw new OutboxRefusal("no replay grant on this device");
      if (this.expired(grant)) throw new OutboxRefusal("replay grant expired; queued writes are kept");
      const maxNewIds = bounds[input.op];
      if (maxNewIds === undefined) throw new OutboxRefusal(`write bound for ${input.op} is unknown`);
      const count = 1 + maxNewIds;
      if (grant.used + count > grant.count) {
        throw new OutboxRefusal(
          `replay grant has ${grant.count - grant.used} ids left; this write needs ${count}`,
        );
      }
      const ids = sliceIds(grant, grant.used, count);
      const targets = this.store.outbox.targets
        ? await this.store.outbox.targets(input.op, args, ids)
        : admittedMutationTargets(Object.values(await this.store.outbox.programs())[0], input.op, args, ids);
      // @ref LLP 1012#7-writes-offline — the twin runs the mutation with the
      // slice as its `new` envelope, so the prediction and the commit mint the
      // same ids; the overlay and the trace land in the entry's own swap.
      // The fence bounds local trust, not custody: keep the write, but do not
      // predict it until a successful resume has renewed trust in this runtime.
      const pastFence = this.pastFence(grant);
      const prediction = predict === undefined || pastFence ? undefined : await predict(ids);
      const now = this.options.now();
      const entry: OutboxEntry = {
        ...input,
        intent: `${grant.id}:${grant.used}`,
        grant: grant.id,
        offset: grant.used,
        count,
        ids,
        ...(targets ? { targets } : {}),
        args,
        state: "queued",
        ...(prediction?.predicted ? { predicted: true } : {}),
        ...(pastFence ? { predicted: false, reason: "fence" as const } : {}),
        ...(prediction?.predicted && prediction.omitted?.length ? { omitted: [...prediction.omitted] } : {}),
        // No trusted prediction means no trace OCC: the program's own
        // requirements (for example baseBody = body) judge this write.
        trace: pastFence ? emptyTrace() : prediction?.trace ?? input.trace ?? emptyTrace(),
        createdAt: now,
        updatedAt: now,
      };
      return { entry, grant: { ...grant, used: grant.used + count }, ...(prediction?.predicted ? { overlay: prediction.overlay } : {}) };
  }

  // @ref LLP 1018.004#2-the-inbox — one serial operation and one swap: the row
  // is re-read fresh, custody is checked inside the serial, and grant
  // consumption, the entry, the prediction, and the row's admission mark land
  // together. A row already marked is skipped, so a crash between the
  // transaction and the nudge, or a takeover mid-loop, cannot admit twice.
  admitInbox(
    row: InboxRow,
    custody: () => void,
    issuedSeq: number,
    predict?: (ids: string[]) => Promise<EnqueuePrediction>,
    beforeCommit?: () => void,
  ): Promise<InboxAdmission> {
    return this.write(async () => {
      const fresh = (await this.store.inboxRows?.())?.find((candidate) => candidate.key === row.key);
      if (!fresh) return { state: "gone" };
      if (fresh.state === "rejected") return { state: "rejected" };
      if (fresh.admitted !== undefined) return { state: "already", intent: fresh.admitted };
      if (fresh.kind !== "mutation" || fresh.op === undefined) return { state: "gone" };
      custody();
      const entry = await this.enqueueNow({ op: fresh.op, args: fresh.args, issuedSeq, inbox: fresh.key, presentation: fresh.presentation }, predict, beforeCommit,
        (admitted) => ({ inbox: { put: [{ ...fresh, admitted: admitted.intent, ids: [...admitted.ids], updatedAt: this.options.now() }] } }));
      return { state: "admitted", entry };
    });
  }

  /** Drops a command row this partition will not honor (a dismissal from another backend, principal, or session). */
  discardInbox(key: number): Promise<void> {
    return this.write(async () => {
      if (!(await this.store.inboxRows?.())?.some((candidate) => candidate.key === key)) return;
      await this.commit({ inbox: { remove: [key] } });
    });
  }

  /** A terminal refusal at admission: the row keeps its arguments and the reason, creates no entry, and is dismissible. */
  rejectInbox(row: InboxRow, response: unknown): Promise<void> {
    return this.write(async () => {
      const fresh = (await this.store.inboxRows?.())?.find((candidate) => candidate.key === row.key);
      if (!fresh || fresh.state !== "queued" || fresh.admitted !== undefined) return;
      await this.commit({ inbox: { put: [{ ...fresh, state: "rejected", response, updatedAt: this.options.now() }] } });
    });
  }

  private async commit(swap: StoreSwap): Promise<void> {
    await this.store.commit(swap);
    this.notify();
  }

  /**
   * Every outbox write shares this tail: enqueue, adoption, bounds, dismiss,
   * and — through the runtime — settlements and the predictions they drop, so
   * a settlement never interleaves with the enqueue that reads the grant.
   */
  write<T>(action: () => Promise<T>): Promise<T> {
    const run = this.tail.then(action);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  settle(entry: OutboxEntry, state: OutboxState, response?: unknown): OutboxEntry {
    const { response: _response, refusal: _refusal, ...rest } = entry;
    return { ...rest, state, ...(response === undefined ? {} : { response }), updatedAt: this.options.now() };
  }

  // @ref LLP 1020#a2-enum-case-removal-is-checked-narrowing — clear the last
  // refusal durably under the dismissal lock BEFORE replay; absence means an unknown
  // outcome, including after a crash. Only a known input/schema refusal restores it.
  attempt(intent: string, refusal?: OutboxEntry["refusal"]): Promise<OutboxEntry | undefined> {
    return this.write(async () => {
      const entry = await this.store.outbox.get(intent);
      if (!entry || entry.state !== "queued") return;
      if (entry.refusal !== refusal) {
        entry.refusal = refusal;
        await this.commit({ outbox: { put: [entry] } });
      }
      return entry;
    });
  }

  /** Reserve a contiguous eligible prefix under the same dismissal/admission lock. */
  attemptBatch(signal?: AbortSignal): Promise<OutboxEntry[]> {
    return this.write(async () => {
      const generation = this.generation;
      const candidates = this.store.outbox.replayBatch ? await this.store.outbox.replayBatch() : (await this.queued()).slice(0, 1);
      const entries: OutboxEntry[] = [], changed: OutboxEntry[] = [];
      for (const entry of candidates) {
        if (!(await this.canReplay(entry))) break;
        entries.push(entry);
        if (entry.refusal) { delete entry.refusal; changed.push(entry); }
      }
      // A cancelled trust read never reached request custody. Preserve the
      // last known unspent refusal so the writer/follower can still dismiss it.
      if (generation !== this.generation || signal?.aborted) return [];
      if (changed.length) await this.commit({ outbox: { put: changed } });
      return entries;
    });
  }

  /** Writer and follower commands share one eligibility check and one atomic removal.
   * A completed command retains the result until its follower reads it, including
   * across a lost nudge or takeover; replay and dismissal race only on this lock.
   */
  dismiss(intent: string, command?: number, identity?: Pick<InboxRow, "scope" | "principal" | "authEpoch">): Promise<OutboxEntry | undefined> {
    return this.write(async () => {
      const rows = (await this.store.inboxRows?.()) ?? [];
      const key = inboxKeyOf(intent);
      const completed = command === undefined && identity && rows.find(row => row.kind === "dismiss" && row.state === "done"
        && row.scope === identity.scope && row.principal === identity.principal && (row.authEpoch === undefined || row.authEpoch === identity.authEpoch)
        && (row.target === intent || (row.response as OutboxEntry | null)?.intent === intent
          || key !== undefined && (row.response as OutboxEntry | null)?.inbox === key));
      if (completed) {
        // The carrier decides who consumed the result: a follower's take on its own
        // connection and this recovery cannot both return the same bytes.
        const taken = await this.store.inboxTake?.(completed.key);
        return (taken?.response ?? undefined) as OutboxEntry | undefined;
      }
      const receipt = rows.find(row => row.key === command);
      if (command !== undefined && (!receipt || receipt.state !== "queued")) return;
      const row = rows.find(row => row.key === key);
      const entry = key === undefined || row?.admitted !== undefined
        ? await this.store.outbox.get(row?.admitted ?? intent)
        : (await this.entries()).find(entry => entry.inbox === key);
      const eligible = entry && dismissible(entry) ? entry : undefined;
      const remove = rows.filter(candidate => eligible
        ? candidate.admitted === eligible.intent || candidate.key === eligible.inbox
        : !entry && row?.state === "rejected" && candidate.key === row.key).map(row => row.key);
      if (!eligible && !remove.length && !receipt) return;
      await this.commit({
        ...(eligible ? { outbox: { remove: [eligible.intent] } } : {}),
        inbox: { remove, ...(receipt ? { put: [{ ...receipt, state: "done", response: eligible ?? null }] } : {}) },
      });
      return eligible;
    });
  }

}

/** The replay envelope for one queued intent, byte-stable across retries. */
export function replayEnvelope(entry: OutboxEntry): {
  op: string;
  args: unknown;
  expectedGeneration?: string;
  replay: { grant: string; offset: number; count: number; intent: string; trace: OutboxTrace };
} {
  return {
    op: entry.op,
    args: entry.args,
    ...(entry.expectedGeneration ? { expectedGeneration: entry.expectedGeneration } : {}),
    replay: {
      grant: entry.grant,
      offset: entry.offset,
      count: entry.count,
      intent: entry.intent,
      trace: entry.trace ?? emptyTrace(),
    },
  };
}

export type { StoreDelivery };
