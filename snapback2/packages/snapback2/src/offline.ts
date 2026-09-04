import {
  DeliveryEnvelopeDecodeError,
  decodeDeliveryEnvelope,
  expandRows,
  type DeliveryEnvelopeV1,
} from "./offline-protocol.js";
import { OutboxLedger, decodeGrant } from "./store/outbox.js";
import {
  canonicalAnswerKey,
  type Coverage,
  type CoverageFacts,
  type HeldAnswer,
  type HeldOperation,
  type HeldProgram,
  type OfflineSchema,
  type OutboxEntry,
  type OutboxGrant,
  type RangeStore,
  type RetentionPolicy,
  type RowRef,
  type StoreDelivery,
  type StoreRefresh,
  type StoreTombstone,
  type WatermarkRecord,
  tailWatermark,
} from "./store/range-store.js";
import { ByteCache } from "./store/byte-cache.js";
import { Twin, type LocalAnswer, type Prediction } from "./twin.js";
import type { Manifest, OfflineClientOptions } from "./types.js";

/**
 * Ids a certified mutation can mint: the certificate's insert/upsert bounds, which
 * already price every row the program creates. A program without a certificate
 * has no bound, and an offline write against it refuses rather than guessing.
 */
export function certificateMaxNewIds(program: unknown): number | undefined {
  if (!object(program)) return undefined;
  const certificate = program.certificate;
  if (!object(certificate) || !Array.isArray(certificate.write_sites)) return undefined;
  let total = 0;
  for (const site of certificate.write_sites) {
    if (!object(site)) continue;
    if ((site.kind === "Insert" || site.kind === "Upsert") && Number.isSafeInteger(site.max_rows)) {
      total += Number(site.max_rows);
    }
  }
  return total;
}

// The tail chooser lives with the store, which keys the overlay drop by it; the
// settlement tail and the resume's `log` import it from here as before.
export { tailWatermark };

export interface MountedQuery {
  op: string;
  args: unknown;
  drain: boolean;
}

export interface ResumeRequestV1 {
  protocol: 1;
  generation: string;
  schemaHash: string;
  authEpoch: number;
  log?: { op: string; args: unknown; watermark: string | null; validator?: string };
  mounted: Array<{ op: string; args: unknown; validator: string }>;
}

export interface ResumeAdjustment {
  which?: string;
  cap?: number;
}

export interface AcceptedDelivery<Result> {
  result: {
    state: "complete" | "capped" | "partial" | "denied";
    data?: Result;
    next?: string | null;
    seq: number;
    reason?: string;
    rule?: string;
  };
  envelope?: DeliveryEnvelopeV1;
  refresh?: StoreRefresh;
}

type ResumeFacts = CoverageFacts;

/**
 * `GET /api/program` as custody: the shape the twin holds per generation.
 * Anything malformed is refused here rather than evaluated later.
 */
export function decodeHeldProgram(value: unknown): HeldProgram | undefined {
  if (!object(value)) return undefined;
  const { generation, schemaHash, schema, programs } = value;
  if (typeof generation !== "string" || typeof schemaHash !== "string" || !object(schema) || !object(schema.tables) || !object(programs)) {
    return undefined;
  }
  const held: Record<string, HeldOperation> = {};
  for (const [name, entry] of Object.entries(programs)) {
    if (!object(entry) || (entry.kind !== "query" && entry.kind !== "mutation")) continue;
    if (typeof entry.planHash !== "string" || !object(entry.ir) || !object(entry.certificate)) continue;
    // The payload binds each op to one certificate: the plan hashes must agree.
    if (entry.certificate.plan_hash !== entry.planHash) continue;
    held[name] = { kind: entry.kind, planHash: entry.planHash, ir: entry.ir, certificate: entry.certificate };
  }
  return { generation, schemaHash, schema: schema as HeldProgram["schema"], programs: held };
}

// @ref LLP 1012#15-diagnostics — a local authority violation (a delivery for
// another principal or auth epoch; a commit with no partition open) has its
// own code: it is never `E_OFFLINE_RESET`, which drops held coverage, so a
// healthy store is refused a delivery and keeps everything. A delivery under
// another generation or schema is not a violation but a rotation: it is not
// held, and the coverage is superseded until the reset path (`commitMany`).
export class OfflineAuthorityError extends Error {
  readonly code = "E_OFFLINE_AUTHORITY";
  constructor(message: string) {
    super(message);
    this.name = "OfflineAuthorityError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The argument the manifest types `Cursor` (or `Optional(Cursor)`), by name order as the server picks it. */
function cursorArgument(args: unknown): string | undefined {
  if (!object(args)) return undefined;
  for (const name of Object.keys(args).sort()) {
    const kind = args[name];
    if (kind === "Cursor" || (object(kind) && kind.Optional === "Cursor")) return name;
  }
  return undefined;
}

function rowKey(ref: RowRef): string {
  return `${ref.table}\u0000${ref.id}`;
}

/**
 * Walks the envelope's reference form beside its expansion and nulls every `$row`
 * that names a viewed view-once row, so a live frame or a fresh query never
 * re-renders what `answer()` already hides (LLP 1012 §9).
 */
function nullViewed(reference: unknown, expanded: unknown, viewed: Set<string>): unknown {
  if (!object(reference)) {
    return Array.isArray(reference) && Array.isArray(expanded)
      ? expanded.map((item, index) => nullViewed(reference[index], item, viewed))
      : expanded;
  }
  const marker = reference.$row;
  if (object(marker) && Object.keys(reference).length === 1) {
    if (typeof marker.table === "string" && typeof marker.id === "string" && Object.keys(marker).length === 2) {
      return viewed.has(rowKey({ table: marker.table, id: marker.id })) ? null : expanded;
    }
    if (object(marker.$value) && object(expanded)) return nullViewed(marker.$value, expanded, viewed);
  }
  if (!object(expanded)) return expanded;
  return Object.fromEntries(Object.entries(expanded)
    .map(([key, item]) => [key, nullViewed(reference[key], item, viewed)]));
}

function resumeWhichMatches(which: string | undefined, op: string, args: unknown): boolean {
  if (!which) return false;
  return which === op || which === canonicalAnswerKey(op, args);
}

export class OfflineRuntime {
  readonly store: RangeStore;
  readonly fenceDays: number;
  readonly maxAssetBytes: number;
  /** Asset bytes beside the rows, under their lease (LLP 1012 §9); lane O4. */
  readonly bytes: ByteCache;
  readonly outbox: OutboxLedger;
  /** The replay currently in flight; the next drain queues behind it. Never rejects. */
  drainTail: Promise<void> = Promise.resolve();
  /**
   * The last drain's outcome, rejection kept: `settled()` awaits this so a
   * non-retryable refusal that stopped the replay reaches the caller instead of
   * resolving with intents still queued (LLP 1012 §7).
   */
  drainOutcome: Promise<void> = Promise.resolve();
  /** The twin: the certified program over this partition's coverage (LLP 1012 §6, §7). */
  readonly twin: Twin;
  private partition?: string;
  private retention: Record<string, RetentionPolicy> = {};
  private cursors: Record<string, string> = {};
  private schema?: OfflineSchema;
  private facts?: ResumeFacts;
  /** Set by a delivery under another generation or schema: held coverage is stale-exact until the reset path (LLP 1012 §8). */
  private superseded?: CoverageFacts;
  private latestSeq = 0;
  private pendingGrant?: OutboxGrant;
  private pendingBounds?: Record<string, number>;
  private pendingProgram?: HeldProgram;
  private held?: HeldProgram;
  private standIn?: string;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: OfflineClientOptions) {
    this.store = options.store();
    this.fenceDays = options.fenceDays ?? 7;
    this.maxAssetBytes = options.maxAssetBytes ?? 256 * 1024 * 1024;
    this.bytes = new ByteCache(this.store, { maxAssetBytes: this.maxAssetBytes, viewOnce: options.viewOnce });
    this.outbox = new OutboxLedger(this.store, {
      now: () => Date.now(),
      fenceMs: this.fenceDays * 24 * 60 * 60 * 1_000,
    });
    this.twin = new Twin({
      program: () => this.held,
      coverage: () => this.coverage(),
      overlay: () => this.store.outbox.overlay(),
      entries: () => this.outbox.entries(),
      principal: () => this.partition,
      now: () => Date.now(),
      seq: () => this.latestSeq,
    });
  }

  get principal(): string | undefined { return this.partition; }

  /** The generation of the certified program this partition holds, if any. */
  get programGeneration(): string | undefined { return this.held?.generation; }

  /** The twin's answer for a query, or `undefined` when it cannot run (no program, another generation). */
  async evaluate(op: string, args: unknown): Promise<LocalAnswer | undefined> {
    if (this.partition === undefined) return undefined;
    return this.twin.evaluate(op, args);
  }

  /** The twin's run of a mutation over held rows with the intent's pinned ids. */
  async predict(op: string, args: unknown, ids: string[]): Promise<Prediction> {
    return this.twin.predict(op, args, ids);
  }

  /** The highest server seq this runtime has committed; what a queued intent was issued against. */
  get seq(): number { return this.latestSeq; }

  async open(principal: string): Promise<void> {
    // The session allowance is dropped before the first await of a partition change:
    // a byte read that lands between the carrier's open and bind() must never hand
    // the previous principal's blob to the incoming partition (grok, O4-web round 2).
    if (this.partition !== undefined && this.partition !== principal) this.bytes.forget();
    await this.serial(async () => {
      if (this.partition !== undefined && this.partition !== principal) await this.store.wipe(this.partition);
      await this.store.open(principal);
      this.partition = principal;
      this.bytes.bind(principal);
      await this.loadFacts();
      await this.loadProgram();
      await this.flushGrant();
      await this.flushBounds();
      this.outbox.notify();
    });
  }

  /** Called only after the owner authenticated this exact principal. */
  async reauthenticate(principal: string): Promise<void> {
    await this.serial(async () => {
      if (this.partition !== principal) {
        throw new OfflineAuthorityError(`authenticated principal ${principal} does not match the open offline partition`);
      }
      await this.store.unseal();
      await this.loadFacts();
      await this.loadProgram();
      await this.flushGrant();
      await this.flushBounds();
      this.outbox.notify();
    });
  }

  /**
   * Records the `grant` a login, guest, or resume response carries. The
   * partition may not be open yet (login opens it next), so the grant waits
   * until the store for this principal is writable. Returns its input.
   */
  noteGrant<T>(value: T): T {
    const grant = decodeGrant(value);
    if (grant) this.pendingGrant = grant;
    return value;
  }

  async adoptPendingGrant(): Promise<void> {
    await this.serial(() => this.flushGrant());
  }

  /** True when a resume request's `log` is an ordinary answer standing in for a drained log. */
  standInLog(log: { op: string; args: unknown }): boolean {
    return this.standIn !== undefined && this.standIn === canonicalAnswerKey(log.op, log.args);
  }

  async queuedIntents(): Promise<OutboxEntry[]> {
    if (this.partition === undefined) return [];
    return this.outbox.queued();
  }

  async seal(): Promise<void> {
    if (this.partition === undefined) return;
    await this.serial(async () => {
      this.bytes.forget();
      await this.store.seal();
    });
  }

  async wipe(): Promise<void> {
    await this.serial(async () => {
      if (this.partition === undefined) return;
      const partition = this.partition;
      this.partition = undefined;
      this.facts = undefined;
      this.superseded = undefined;
      this.held = undefined;
      this.bytes.bind(undefined);
      await this.store.wipe(partition);
      this.outbox.notify();
    });
  }

  async close(): Promise<void> {
    await this.tail;
    this.bytes.forget();
    await this.store.close?.();
  }

  manifest(value: Manifest): void {
    const tables = value.tables ?? value.schema?.tables ?? {};
    const retention: Record<string, RetentionPolicy> = {};
    for (const [name, table] of Object.entries(tables)) {
      if (!table || typeof table !== "object") continue;
      const word = (table as { retain?: unknown }).retain;
      if (word === "until-revoked" || word === "delivered-history") retention[name] = word;
    }
    this.retention = retention;
    const cursors: Record<string, string> = {};
    for (const [name, operation] of Object.entries(value.ops ?? {})) {
      const cursor = cursorArgument((operation as { args?: unknown } | undefined)?.args);
      if (cursor !== undefined) cursors[name] = cursor;
    }
    this.cursors = cursors;
    if (value.schema?.tables) this.schema = value.schema as OfflineSchema;
  }

  /**
   * The op's cursor argument as the manifest names it (the server keys the resume tail
   * by that argument's type, never its name); `c`, the recipe's spelling, until the
   * manifest is loaded.
   */
  cursorArg(op: string): string {
    return this.cursors[op] ?? "c";
  }

  /**
   * Records `/api/program`: the schema, the certified program held for the twin
   * keyed by its generation, and each op's write bound — persisted together
   * with the outbox so a cold start with the owner cut evaluates and prices its
   * slices from the certificate, never from a guess (LLP 1012 §7, §8).
   */
  program(value: unknown): void {
    if (!object(value)) return;
    const schema = value.schema;
    if (object(schema) && object(schema.tables)) this.schema = schema as OfflineSchema;
    if (!object(value.programs)) return;
    const bounds: Record<string, number> = {};
    for (const [name, program] of Object.entries(value.programs)) {
      const bound = certificateMaxNewIds(program);
      if (bound !== undefined) bounds[name] = bound;
    }
    this.pendingBounds = bounds;
    const held = decodeHeldProgram(value);
    if (held) {
      this.held = held;
      this.pendingProgram = held;
    }
    // The persist rides the outbox tail ahead of any enqueue issued after this
    // call; a carrier failure leaves the bounds pending and the next enqueue
    // refuses loudly with the bound unknown.
    void this.flushBounds().catch(() => undefined);
  }

  async accept<Result>(op: string, args: unknown, raw: unknown): Promise<AcceptedDelivery<Result>> {
    if (object(raw) && raw.state === "unchanged") {
      if (Object.keys(raw).sort().join(",") !== "seq,state,validator"
        || !Number.isSafeInteger(raw.seq) || Number(raw.seq) < 0
        || typeof raw.validator !== "string" || !/^[0-9a-f]{64}$/.test(raw.validator)) {
        throw new DeliveryEnvelopeDecodeError("$", "conditional delivery must be { state, seq, validator }");
      }
      const held = await this.answer<Result>(op, args);
      if (!held || held.validator !== raw.validator) {
        throw new DeliveryEnvelopeDecodeError("$.validator", "does not match the held answer");
      }
      const result = {
        state: held.state,
        ...(held.data === undefined ? {} : { data: held.data }),
        ...(held.next === undefined ? {} : { next: held.next }),
        seq: raw.seq as number,
        ...(held.reason === undefined ? {} : { reason: held.reason }),
        ...(held.rule === undefined ? {} : { rule: held.rule }),
      } as AcceptedDelivery<Result>["result"];
      return {
        result,
        refresh: { op, args, seq: raw.seq as number, validator: raw.validator, deliveredAt: Date.now() },
      };
    }
    if (!object(raw) || raw.protocol === undefined) {
      return { result: raw as AcceptedDelivery<Result>["result"] };
    }
    const envelope = decodeDeliveryEnvelope(raw);
    const result: AcceptedDelivery<Result>["result"] = {
      state: envelope.state,
      ...(envelope.state === "denied" ? {} : { data: await this.expandUnviewed(envelope) as Result }),
      ...(envelope.state === "complete" || envelope.state === "capped" ? { next: envelope.next } : {}),
      seq: envelope.seq,
      ...(envelope.reason === undefined ? {} : { reason: envelope.reason }),
      ...(envelope.rule === undefined ? {} : { rule: envelope.rule }),
    };
    return { result, envelope };
  }

  async commit(op: string, args: unknown, accepted: AcceptedDelivery<unknown>): Promise<void> {
    await this.commitMany([{ op, args, accepted }]);
  }

  async commitMany(
    items: Array<{ op: string; args: unknown; accepted: AcceptedDelivery<unknown> }>,
    watermark?: Omit<WatermarkRecord, "generation" | "schemaHash" | "authEpoch" | "updatedAt">,
    outbox?: { put?: OutboxEntry[]; remove?: string[] },
  ): Promise<void> {
    if (items.length === 0 && !watermark && !outbox) return;
    // An outbox write shares the ledger's tail (one critical section for
    // every enqueue, adoption, bound, settlement, and prediction drop).
    const run = () => this.serial(async () => {
      if (this.partition === undefined) {
        throw new OfflineAuthorityError("an offline partition must be opened before committing a delivery");
      }
      const deliveries: StoreDelivery[] = [];
      const refreshes: StoreRefresh[] = [];
      const tombstones: StoreTombstone[] = [];
      let nextFacts = this.facts;
      let superseded = this.superseded;
      for (const { op, args, accepted } of items) {
        const envelope = accepted.envelope;
        if (envelope && envelope.authority.principal !== this.partition) {
          throw new OfflineAuthorityError(
            `delivery principal ${envelope.authority.principal} does not match open partition ${this.partition}`,
          );
        }
        if (accepted.refresh) {
          refreshes.push(accepted.refresh);
          continue;
        }
        if (envelope) {
          // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — a
          // rotation: the server now runs another generation or schema. The
          // delivery is not held (one generation per partition), the caller
          // still gets the live answer, and the held coverage is marked
          // superseded so the twin serves nothing stale-exact from it; the next
          // resume carries the old facts, is refused `E_OFFLINE_RESET`, and the
          // reset path drops the coverage and re-fetches the program.
          if (nextFacts && (envelope.generation !== nextFacts.generation || envelope.schemaHash !== nextFacts.schemaHash)) {
            superseded = { generation: envelope.generation, schemaHash: envelope.schemaHash, authEpoch: envelope.authority.authEpoch };
            continue;
          }
          // Another auth epoch under the same program is a local authority
          // violation: refused, and the coverage kept (LLP 1012 §15).
          if (nextFacts && envelope.authority.authEpoch !== nextFacts.authEpoch) {
            throw new OfflineAuthorityError("delivery auth epoch does not match the open coverage");
          }
          nextFacts = {
            generation: envelope.generation,
            schemaHash: envelope.schemaHash,
            authEpoch: envelope.authority.authEpoch,
          };
        }
        const source = envelope ?? accepted.result;
        deliveries.push({
          op,
          args,
          state: source.state,
          ...(source.data === undefined ? {} : { data: source.data }),
          ...(source.next === undefined ? {} : { next: source.next }),
          seq: source.seq,
          ...(envelope?.validator === undefined ? {} : { validator: envelope.validator }),
          ...(envelope?.receipt === undefined ? {} : { receipt: envelope.receipt }),
          ...(envelope?.rows === undefined ? {} : { rows: envelope.rows }),
          ...("reason" in source && typeof source.reason === "string" ? { reason: source.reason } : {}),
          ...("rule" in source && typeof source.rule === "string" ? { rule: source.rule } : {}),
          deliveredAt: Date.now(),
        });
        for (const row of envelope?.rows ?? []) {
          for (const ref of this.options.onTombstone?.(row) ?? []) tombstones.push({ ...ref, seq: envelope!.seq });
        }
      }
      const watermarkRecord = watermark ? {
        ...watermark,
        ...(nextFacts?.generation === undefined ? {} : { generation: nextFacts.generation }),
        ...(nextFacts?.schemaHash === undefined ? {} : { schemaHash: nextFacts.schemaHash }),
        ...(nextFacts?.authEpoch === undefined ? {} : { authEpoch: nextFacts.authEpoch }),
        updatedAt: Date.now(),
      } : undefined;
      await this.store.commit({
        deliveries,
        refreshes,
        tombstones,
        retention: this.retention,
        schema: this.schema,
        ...(watermarkRecord ? { watermark: watermarkRecord } : {}),
        ...(outbox ? { outbox } : {}),
        ...(nextFacts && nextFacts !== this.facts ? { facts: nextFacts } : {}),
        ...(superseded && superseded !== this.superseded ? { superseded } : {}),
      });
      this.facts = nextFacts;
      this.superseded = superseded;
      for (const item of [...deliveries, ...refreshes]) this.latestSeq = Math.max(this.latestSeq, item.seq);
      if (outbox) this.outbox.notify();
    });
    await (outbox ? this.outbox.write(run) : run());
  }

  async answer<Result>(op: string, args: unknown): Promise<HeldAnswer<Result> | undefined> {
    // Superseded coverage answers nothing: not served offline, and its validators
    // are never sent, so a conditional `unchanged` cannot carry a stale answer forward.
    if (this.partition === undefined || this.superseded !== undefined) return undefined;
    return this.store.answer<Result>(op, args);
  }

  /** The envelope's data with every viewed view-once row read as `null`, on the wire as in the store. */
  private async expandUnviewed(envelope: DeliveryEnvelopeV1): Promise<unknown> {
    const expanded = expandRows(envelope);
    const store = this.store as Partial<{ viewedRows(): Promise<RowRef[]> }>;
    if (this.partition === undefined || typeof store.viewedRows !== "function") return expanded;
    const viewed = new Set((await store.viewedRows()).map(rowKey));
    return viewed.size === 0 ? expanded : nullViewed(envelope.data, expanded, viewed);
  }

  async markWatermark(op: string, args: unknown, watermark: string | null, validator?: string): Promise<void> {
    if (this.partition === undefined) return;
    await this.commitMany([], { op, args, watermark, ...(validator === undefined ? {} : { validator }) });
  }

  async resumeRequest(
    mounted: MountedQuery[],
    adjustment: ResumeAdjustment = {},
  ): Promise<ResumeRequestV1 | undefined> {
    if (this.partition === undefined || !this.facts) return undefined;
    const coverage = await this.store.coverage();
    // The same chooser as the settlement tail (`tailWatermark`), so the log a
    // resume asks for is the log a committed intent's rows are filed under.
    const watermark = tailWatermark(coverage.watermarks);
    const cap = Math.max(0, Math.min(32, Number.isSafeInteger(adjustment.cap) ? adjustment.cap! : 32));
    const candidates = mounted.filter((query) => !query.drain
      && query.op !== watermark?.op
      && !resumeWhichMatches(adjustment.which, query.op, query.args));
    const indexedWhich = adjustment.which?.match(/^mounted\[(\d+)\]$/)?.[1];
    if (indexedWhich !== undefined) candidates.splice(Number(indexedWhich), 1);
    const mountedAnswers = (await Promise.all(candidates.slice(0, cap).map(async (query) => ({
      query,
      answer: await this.store.answer(query.op, query.args),
    })))).filter((item): item is { query: MountedQuery; answer: HeldAnswer & { validator: string } } =>
      typeof item.answer?.validator === "string");
    const omitLog = adjustment.which === "log"
      || (watermark !== undefined && resumeWhichMatches(adjustment.which, watermark.op, watermark.args));
    // Without a drained log the owner still needs one member to answer, and the
    // device still needs the grant a resume returns: the first held mounted
    // answer stands in, with a null watermark, and leaves no watermark behind.
    const standIn = !watermark && !omitLog ? mountedAnswers.shift() : undefined;
    this.standIn = standIn ? canonicalAnswerKey(standIn.query.op, standIn.query.args) : undefined;
    if (!watermark && !standIn) return undefined;
    return {
      protocol: 1,
      ...this.facts,
      ...(standIn ? {
        log: { op: standIn.query.op, args: standIn.query.args, watermark: null, validator: standIn.answer.validator },
      } : !watermark || omitLog ? {} : {
        log: {
          op: watermark.op,
          args: watermark.args,
          watermark: watermark.watermark,
          ...(watermark.validator === undefined ? {} : { validator: watermark.validator }),
        },
      }),
      mounted: mountedAnswers.map(({ query, answer }) => ({
        op: query.op,
        args: query.args,
        validator: answer.validator,
      })),
    };
  }

  async resetCoverage(): Promise<void> {
    if (this.partition !== undefined) await this.serial(async () => {
      await this.store.commit({ resetCoverage: true });
      this.facts = undefined;
      this.superseded = undefined;
    });
  }

  async coverage(): Promise<Coverage | undefined> {
    return this.partition === undefined ? undefined : this.store.coverage();
  }

  private async flushGrant(): Promise<void> {
    const grant = this.pendingGrant;
    if (!grant || this.partition === undefined) return;
    this.pendingGrant = undefined;
    try {
      await this.outbox.adopt(grant);
    } catch (error) {
      this.pendingGrant = grant;
      throw error;
    }
  }

  private async flushBounds(): Promise<void> {
    const bounds = this.pendingBounds;
    if (!bounds || this.partition === undefined) return;
    const program = this.pendingProgram;
    this.pendingBounds = undefined;
    this.pendingProgram = undefined;
    try {
      // One generation is held at a time: the program replaces its predecessor whole.
      await this.outbox.recordBounds(bounds, program === undefined ? undefined : { [program.generation]: program });
    } catch (error) {
      this.pendingBounds = bounds;
      this.pendingProgram = program;
      throw error;
    }
  }

  private async loadProgram(): Promise<void> {
    let programs: Record<string, HeldProgram>;
    // Custody like the outbox: sealed with it, read again on unseal.
    try { programs = await this.store.outbox.programs(); } catch { return; }
    const held = Object.values(programs)[0];
    if (held) this.held = held;
    if (held && this.schema === undefined) this.schema = held.schema;
  }

  private async loadFacts(): Promise<void> {
    const coverage = await this.store.coverage();
    this.superseded = coverage.superseded;
    if (coverage.facts) {
      this.facts = coverage.facts;
      return;
    }
    const watermark = tailWatermark(coverage.watermarks);
    if (watermark?.generation && watermark.schemaHash && watermark.authEpoch !== undefined) {
      this.facts = {
        generation: watermark.generation,
        schemaHash: watermark.schemaHash,
        authEpoch: watermark.authEpoch,
      };
    }
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const run = this.tail.then(action);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}

/**
 * The offline view of a query: the twin's local answer when it ran and is at
 * least as exact as the held one, else the held answer, else `hydrating`. A
 * held answer's facts (`seq`, `since`, the drain's watermark, `retained`) stay
 * with the twin's data: the stored answer is the covered case, not a second
 * mechanism (LLP 1012 §6).
 */
export function offlineView<Result>(held: HeldAnswer<Result> | undefined, local?: LocalAnswer): any {
  const exactHeld = held !== undefined && (held.state === "complete" || held.state === "capped");
  const useLocal = local !== undefined && !(local.state === "partial" && exactHeld) && !held?.retained;
  if (!useLocal) {
    if (!held) return { state: "hydrating", live: false, connection: "offline" };
    const {
      op: _op,
      args: _args,
      receipt: _receipt,
      validator: _validator,
      deliveredAt,
      ...answer
    } = held;
    return {
      ...answer,
      live: false,
      connection: "offline",
      stale: { since: deliveredAt },
    };
  }
  const { since, ...answer } = local;
  const facts = held === undefined ? {} : {
    seq: held.seq,
    ...(held.caughtUp === undefined ? {} : { caughtUp: held.caughtUp }),
    ...(held.watermark === undefined ? {} : { watermark: held.watermark }),
  };
  return {
    ...answer,
    ...facts,
    live: false,
    connection: "offline",
    stale: { since: held?.deliveredAt ?? since ?? Date.now() },
  };
}
