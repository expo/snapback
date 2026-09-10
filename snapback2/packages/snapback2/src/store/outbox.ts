// @ref LLP 1012#7-writes-offline — the outbox is durable custody of unsent
// intents: each one owns a contiguous slice of a principal-bound replay grant,
// so its ids are known before the server has seen it and a retry is the same
// envelope. Delivered successes compact atomically; unresolved terminals remain dismissible.
import type { OutboxStatus } from "../types.js";
import { plainObject } from "../../../evaluator/src/value-runtime.js";
import { inboxKeyOf, type InboxRow } from "./inbox.js";
import { admittedMutationTargets } from "../mutation-targets.js";
import type {
  OutboxEntry,
  OutboxGrant,
  OutboxState,
  OutboxTrace,
  OverlayRow,
  RangeStore,
  StoreDelivery,
  StoreSwap,
} from "./range-store.js";

export const ENGINE_ID = /^s2id-([0-9a-f]{32})-([0-9a-f]{16})$/;

/** A local custody refusal at enqueue time; the client maps it onto the offline family. */
export class OutboxRefusal extends Error {
  readonly code = "E_OFFLINE_ID_BLOCK";
  readonly site = "client.outbox.enqueue";
  constructor(message: string, readonly rewrite: string = "resume online for a fresh grant, then send again") {
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
    return (await this.entries()).filter((entry) => entry.state === "queued");
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
      const held = grants.some(item => item.id === grant.id);
      const queued = new Set((await this.queued()).map(entry => entry.grant));
      check?.();
      await this.commit({ grants: { current: grant.id, ...(held ? {} : {
        put: [grant], remove: grants.filter(item => !queued.has(item.id)).map(item => item.id),
      }) } });
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
    const grant = await this.grant();
    const bound = op === undefined ? 0 : (await this.store.outbox.bounds())[op];
    const reason = !grant ? "grant-missing" : this.expired(grant) ? "grant-expired"
      : bound === undefined ? "program-missing" : grant.used + 1 + bound > grant.count ? "ids-exhausted" : "ready";
    return { ready: reason === "ready", reason, action: reason === "ready" ? "none" : "connect",
      remaining: (await this.queued()).length, fence: await this.fence() };
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
  async canReplay(entry: OutboxEntry): Promise<boolean> {
    if (entry.reason === "fence" && !this.resumedSince(entry.createdAt)) return false;
    const grant = await this.grantById(entry.grant);
    // Without the original grant's trust facts only a subsequent resume can
    // authorize sending; the owner still judges the grant and the intent.
    return grant ? !this.pastFence(grant) : this.resumedSince(entry.createdAt);
  }

  async fence(): Promise<"inside" | "past"> {
    for (const entry of await this.queued()) {
      if (!(await this.canReplay(entry))) return "past";
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

  /** Pending page acknowledgements consume ordinary FIFO slices; each admission
   * marks its event identities in the same transaction as its intent. */
  admitAcknowledgements(): Promise<number> {
    return this.write(async () => {
      const pending = Object.entries(await this.store.outbox.deliveryAcks?.() ?? {}).filter(([, ack]) => !ack.intent);
      let admitted = 0;
      while (pending.length) {
        const op = pending[0]![1].op;
        const batch = pending.filter(([, ack]) => ack.op === op).slice(0, 50);
        try {
          await this.enqueueNow({ op, args: { events: batch.map(([, ack]) => ack.event) },
            issuedSeq: Math.max(...batch.map(([, ack]) => ack.seq)) }, undefined, undefined,
            entry => ({ deliveryAcks: Object.fromEntries(batch.map(([key, ack]) => [key, { ...ack, intent: entry.intent }])) }));
        } catch (error) { if (error instanceof OutboxRefusal) break; throw error; }
        admitted += batch.length;
        for (const item of batch) pending.splice(pending.indexOf(item), 1);
      }
      return admitted;
    });
  }

  private async enqueueNow(
    input: EnqueueInput,
    predict?: (ids: string[]) => Promise<EnqueuePrediction>,
    beforeCommit?: () => void,
    extra?: (entry: OutboxEntry, grant: OutboxGrant) => Partial<import("./range-store.js").StoreSwap>,
  ): Promise<OutboxEntry> {
      const args = structuredClone(input.args);
      const grant = await this.grant();
      if (!grant) {
        throw new OutboxRefusal(
          "no replay grant on this device; log in, or drain a query online, before writing",
          "resume as this principal (a login, or a query with { drain: true } reaching its watermark), then send again",
        );
      }
      if (this.expired(grant)) throw new OutboxRefusal("replay grant expired; queued writes are kept");
      const maxNewIds = (await this.store.outbox.bounds())[input.op];
      if (maxNewIds === undefined) {
        throw new OutboxRefusal(
          `write bound for ${input.op} is unknown`,
          "load /api/program online, then send again",
        );
      }
      const count = 1 + maxNewIds;
      if (grant.used + count > grant.count) {
        throw new OutboxRefusal(
          `replay grant has ${grant.count - grant.used} ids left; this write needs ${count}`,
        );
      }
      const ids = sliceIds(grant, grant.used, count);
      const programs = await this.store.outbox.programs();
      const targets = admittedMutationTargets(Object.values(programs)[0], input.op, args, ids);
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
      // From this point a storage failure can be ambiguous; before it no intent exists.
      beforeCommit?.();
      await this.commit({
        grants: { put: [{ ...grant, used: grant.used + count }] },
        outbox: { put: [entry] },
        ...(prediction?.predicted ? { overlay: { put: { [entry.intent]: prediction.overlay } } } : {}),
        ...extra?.(entry, grant),
      });
      return (await this.store.outbox.get(entry.intent)) ?? entry;
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

export type { OutboxEntry, OutboxGrant, OutboxState, OutboxTrace, StoreDelivery };
