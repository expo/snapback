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
} from "./range-store.js";

export const ENGINE_ID = /^s2id-([0-9a-f]{32})-([0-9a-f]{16})$/;

export type OutboxRefusalCode = "E_OFFLINE_ID_BLOCK";

/** A local custody refusal at enqueue time; the client maps it onto the offline family. */
export class OutboxRefusal extends Error {
  constructor(readonly code: OutboxRefusalCode, message: string, readonly site: string, readonly rewrite: string) {
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
    || !Number.isSafeInteger(record.count) || Number(record.count) <= 0
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
  const namespace = match[1]!;
  const first = BigInt(`0x${match[2]!}`) + BigInt(offset);
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(`s2id-${namespace}-${(first + BigInt(index)).toString(16).padStart(16, "0")}`);
  }
  return ids;
}

export function intentName(grant: string, offset: number): string {
  return `${grant}:${offset}`;
}

export function settledEntry(entry: OutboxEntry, state: OutboxState, response: unknown, now: number): OutboxEntry {
  const { response: _response, ...rest } = entry;
  return { ...rest, state, ...(response === undefined ? {} : { response }), updatedAt: now };
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
    }, () => undefined); // Sealed custody has no usable grant; ready() reports false.
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
  adopt(grant: OutboxGrant): Promise<void> {
    return this.serial(async () => {
      const held = await this.grantById(grant.id);
      if (held) {
        await this.store.commit({ grants: { current: grant.id } });
        this.notify();
        return;
      }
      const stale = (await this.store.outbox.grants())
        .filter((item) => item.id !== grant.id)
        .map((item) => item.id);
      const queued = new Set((await this.queued()).map((entry) => entry.grant));
      await this.store.commit({
        grants: { put: [grant], current: grant.id, remove: stale.filter((id) => !queued.has(id)) },
      });
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
    return this.serial(async () => {
      await this.store.commit({ bounds, ...(programs === undefined ? {} : { programs: programs as never }) });
      this.notify();
    });
  }

  /** The same admission checks enqueue applies, without consuming a slice. */
  async status(op?: string): Promise<OutboxStatus> {
    const grant = await this.grant();
    const remaining = (await this.queued()).length;
    const fence = await this.fence();
    const state = (reason: OutboxStatus["reason"], action: OutboxStatus["action"]): OutboxStatus =>
      ({ ready: reason === "ready", reason, action, remaining, fence });
    if (!grant) return state("grant-missing", "connect");
    if (this.expired(grant)) return state("grant-expired", "connect");
    const bound = op === undefined ? 0 : (await this.store.outbox.bounds())[op];
    if (bound === undefined) return state("program-missing", "connect");
    if (grant.used + 1 + bound > grant.count) return state("ids-exhausted", "connect");
    return state("ready", "none");
  }

  async ready(op?: string): Promise<boolean> {
    return (await this.status(op)).ready;
  }

  /** Admission readiness reported to a follower, including the fixed durable receipt bounds. */
  /**
   * Every outbox write shares this tail: enqueue, adoption, bounds, dismiss,
   * and — through the runtime — settlements and the predictions they drop, so
   * a settlement never interleaves with the enqueue that reads the grant.
   */
  write<T>(action: () => Promise<T>): Promise<T> {
    return this.serial(action);
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
    return this.serial(() => this.enqueueNow(input, predict, beforeCommit));
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
          "E_OFFLINE_ID_BLOCK",
          "this device holds no replay grant; log in, or drain a query online, before writing",
          "client.outbox.enqueue",
          "resume as this principal for a grant (a login, or a query with { drain: true } reaching its watermark), then send again",
        );
      }
      if (this.expired(grant)) {
        throw new OutboxRefusal(
          "E_OFFLINE_ID_BLOCK", "this device's replay grant has expired; existing queued writes are kept",
          "client.outbox.enqueue", "resume online for a fresh grant, then enqueue a new intent",
        );
      }
      const maxNewIds = (await this.store.outbox.bounds())[input.op];
      if (maxNewIds === undefined) {
        throw new OutboxRefusal(
          "E_OFFLINE_ID_BLOCK",
          `the write bound for ${input.op} is unknown on this device: its certificate was never recorded here, so the slice size cannot be priced`,
          "client.outbox.enqueue",
          "reach the owner once so /api/program is recorded, then enqueue a new intent",
        );
      }
      const count = 1 + maxNewIds;
      if (grant.used + count > grant.count) {
        throw new OutboxRefusal(
          "E_OFFLINE_ID_BLOCK",
          `the replay grant has ${grant.count - grant.used} ids left and this write needs ${count}`,
          "client.outbox.enqueue",
          "resume online for a fresh grant, then enqueue a new intent",
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
        intent: intentName(grant.id, grant.used),
        grant: grant.id,
        offset: grant.used,
        count,
        ids,
        ...(targets ? { targets } : {}),
        ...(input.presentation === undefined ? {} : { presentation: input.presentation }),
        op: input.op,
        args,
        issuedSeq: input.issuedSeq,
        ...(input.expectedGeneration ? { expectedGeneration: input.expectedGeneration } : {}),
        state: "queued",
        ...(prediction?.predicted ? { predicted: true } : {}),
        ...(pastFence ? { predicted: false, reason: "fence" as const } : {}),
        ...(prediction?.predicted && prediction.omitted !== undefined && prediction.omitted.length > 0 ? { omitted: [...prediction.omitted] } : {}),
        // No trusted prediction means no trace OCC: the program's own
        // requirements (for example baseBody = body) judge this write.
        trace: pastFence ? emptyTrace() : prediction?.trace ?? input.trace ?? emptyTrace(),
        createdAt: now,
        updatedAt: now,
        ...(input.inbox === undefined ? {} : { inbox: input.inbox }),
      };
      // From this point a storage failure can be ambiguous; before it no intent exists.
      beforeCommit?.();
      await this.store.commit({
        grants: { put: [{ ...grant, used: grant.used + count }] },
        outbox: { put: [entry] },
        ...(prediction?.predicted ? { overlay: { put: { [entry.intent]: prediction.overlay } } } : {}),
        ...(extra ? extra(entry, grant) : {}),
      });
      this.notify();
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
    return this.serial(async () => {
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
    return this.serial(async () => {
      if (!(await this.store.inboxRows?.())?.some((candidate) => candidate.key === key)) return;
      await this.store.commit({ inbox: { remove: [key] } });
      this.notify();
    });
  }

  /** A terminal refusal at admission: the row keeps its arguments and the reason, creates no entry, and is dismissible. */
  rejectInbox(row: InboxRow, response: unknown): Promise<void> {
    return this.serial(async () => {
      const fresh = (await this.store.inboxRows?.())?.find((candidate) => candidate.key === row.key);
      if (!fresh || fresh.state !== "queued" || fresh.admitted !== undefined) return;
      await this.store.commit({ inbox: { put: [{ ...fresh, state: "rejected", response, updatedAt: this.options.now() }] } });
      this.notify();
    });
  }

  /**
   * A follower's dismissal is a durable command row naming its target. The
   * writer consumes it by dismissing the target's entry (an `inbox:` alias
   * resolves to the entry admitted from that row) and deleting the command in
   * one swap; a queued target leaves the command consumed and the entry kept.
   */
  consumeDismiss(row: InboxRow): Promise<void> {
    return this.serial(async () => {
      const rows = (await this.store.inboxRows?.()) ?? [];
      const command = rows.find((candidate) => candidate.key === row.key);
      if (!command || command.kind !== "dismiss" || command.target === undefined) return;
      const resolved = await this.resolveIntent(command.target, rows);
      const remove = [command.key];
      let outbox: { remove: string[] } | undefined;
      if (resolved.row && resolved.row.state === "rejected") remove.push(resolved.row.key);
      if (resolved.entry && resolved.entry.state !== "queued") {
        outbox = { remove: [resolved.entry.intent] };
        for (const mirrored of rows) if (mirrored.admitted === resolved.entry.intent) remove.push(mirrored.key);
      }
      await this.store.commit({ inbox: { remove: [...new Set(remove)] }, ...(outbox ? { outbox } : {}) });
      this.notify();
    });
  }

  /** The entry an intent or `inbox:` alias names, and the inbox row behind an alias. */
  private async resolveIntent(intent: string, rows?: InboxRow[]): Promise<{ entry?: OutboxEntry; row?: InboxRow }> {
    const key = inboxKeyOf(intent);
    if (key === undefined) return { entry: await this.store.outbox.get(intent) };
    const row = (rows ?? (await this.store.inboxRows?.()) ?? []).find((candidate) => candidate.key === key);
    const entry = row?.admitted !== undefined ? await this.store.outbox.get(row.admitted)
      : (await this.store.outbox.all()).find((candidate) => candidate.inbox === key);
    return { ...(entry ? { entry } : {}), ...(row ? { row } : {}) };
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const run = this.tail.then(action);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  settle(entry: OutboxEntry, state: OutboxState, response?: unknown): OutboxEntry {
    return settledEntry(entry, state, response, this.options.now());
  }

  /** Removes a settled entry, or a rejected inbox row, by intent or `inbox:` alias; a queued intent is never dismissed. */
  dismiss(intent: string): Promise<void> {
    return this.serial(async () => {
      const rows = (await this.store.inboxRows?.()) ?? [];
      const { entry, row } = await this.resolveIntent(intent, rows);
      if (entry) {
        if (entry.state === "queued") return;
        const mirrored = rows.filter((candidate) => candidate.admitted === entry.intent || candidate.key === entry.inbox).map((candidate) => candidate.key);
        await this.store.commit({ outbox: { remove: [entry.intent] }, ...(mirrored.length ? { inbox: { remove: mirrored } } : {}) });
      } else if (row && row.state === "rejected") {
        await this.store.commit({ inbox: { remove: [row.key] } });
      } else return;
      this.notify();
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
