// @ref LLP 1012#7-writes-offline — the outbox is durable custody of unsent
// intents: each one owns a contiguous slice of a principal-bound replay grant,
// so its ids are known before the server has seen it and a retry is the same
// envelope. Settlement never deletes; `dismiss` is the app's choice.
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

/** Reads `grant` off a login, guest, or resume response; anything malformed is ignored. */
export function decodeGrant(value: unknown): OutboxGrant | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const grant = (value as { grant?: unknown }).grant;
  if (!grant || typeof grant !== "object" || Array.isArray(grant)) return undefined;
  const record = grant as Record<string, unknown>;
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
  trace?: OutboxTrace;
}

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
  /**
   * Grant custody is one critical section: a read of the grant's cursor and the
   * swap that advances it never interleave with another enqueue or adoption, so
   * two overlapping writes can never mint the same slice.
   */
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly store: RangeStore, private readonly options: OutboxLedgerOptions) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  notify(): void {
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* observers cannot break custody */ }
    }
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
    return this.serial(() => this.store.commit({ bounds, ...(programs === undefined ? {} : { programs: programs as never }) }));
  }

  /**
   * Every outbox write shares this tail: enqueue, adoption, bounds, dismiss,
   * and — through the runtime — settlements and the predictions they drop, so
   * a settlement never interleaves with the enqueue that reads the grant.
   */
  write<T>(action: () => Promise<T>): Promise<T> {
    return this.serial(action);
  }

  pastFence(grant: Pick<OutboxGrant, "mintedAt">): boolean {
    const crossedAt = grant.mintedAt + this.options.fenceMs;
    return this.options.now() > crossedAt && !this.resumedSince(crossedAt);
  }

  private resumedSince(at: number): boolean {
    return this.resumedAt !== undefined && this.resumedAt >= at
      && this.options.now() - this.resumedAt <= this.options.fenceMs;
  }

  /** Trust belongs to this open partition and session, never to the next one. */
  resetTrust(): void {
    this.resumedAt = undefined;
    this.notify();
  }

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
  resumeSucceeded(): void {
    this.resumedAt = this.options.now();
    this.notify();
  }

  // @ref LLP 1012#7-writes-offline — the first id names the intent; the rest
  // are the program's `new` envelope in order, as many as the certificate's
  // persisted write bound allows. No bound, or no remaining ids, is a refusal,
  // never a silent reuse or a guessed reservation.
  enqueue(input: EnqueueInput, predict?: (ids: string[]) => Promise<EnqueuePrediction>): Promise<OutboxEntry> {
    return this.serial(async () => {
      const grant = await this.grant();
      if (!grant) {
        throw new OutboxRefusal(
          "E_OFFLINE_ID_BLOCK",
          "this device holds no replay grant; log in, or drain a query online, before writing",
          "client.outbox.enqueue",
          "resume as this principal for a grant (a login, or a query with { drain: true } reaching its watermark), then send again",
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
        op: input.op,
        args: structuredClone(input.args),
        issuedSeq: input.issuedSeq,
        state: "queued",
        ...(prediction?.predicted ? { predicted: true } : {}),
        ...(pastFence ? { predicted: false, reason: "fence" as const } : {}),
        ...(prediction?.predicted && prediction.omitted !== undefined && prediction.omitted.length > 0 ? { omitted: [...prediction.omitted] } : {}),
        // No trusted prediction means no trace OCC: the program's own
        // requirements (for example baseBody = body) judge this write.
        trace: pastFence ? emptyTrace() : prediction?.trace ?? input.trace ?? emptyTrace(),
        createdAt: now,
        updatedAt: now,
      };
      await this.store.commit({
        grants: { put: [{ ...grant, used: grant.used + count }] },
        outbox: { put: [entry] },
        ...(prediction?.predicted ? { overlay: { put: { [entry.intent]: prediction.overlay } } } : {}),
      });
      this.notify();
      return (await this.store.outbox.get(entry.intent)) ?? entry;
    });
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const run = this.tail.then(action);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  settle(entry: OutboxEntry, state: OutboxState, response?: unknown): OutboxEntry {
    return settledEntry(entry, state, response, this.options.now());
  }

  /** Removes a settled entry; a queued intent is never dismissed. */
  dismiss(intent: string): Promise<void> {
    return this.serial(async () => {
      const entry = await this.store.outbox.get(intent);
      if (!entry || entry.state === "queued") return;
      await this.store.commit({ outbox: { remove: [intent] } });
      this.notify();
    });
  }
}

/** The replay envelope for one queued intent, byte-stable across retries. */
export function replayEnvelope(entry: OutboxEntry): {
  op: string;
  args: unknown;
  replay: { grant: string; offset: number; count: number; intent: string; trace: OutboxTrace };
} {
  return {
    op: entry.op,
    args: entry.args,
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
