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
  type HeldAnswer,
  type OfflineSchema,
  type OutboxEntry,
  type OutboxGrant,
  type RangeStore,
  type RetentionPolicy,
  type StoreDelivery,
  type StoreRefresh,
  type StoreTombstone,
  type WatermarkRecord,
} from "./store/range-store.js";
import type { Manifest, OfflineClientOptions } from "./types.js";

/** Ids a certified mutation can mint: its insert/upsert bounds plus explicit `new`s. */
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
  return total + countNew(program.ir);
}

function countNew(value: unknown): number {
  if (value === "New") return 1;
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + countNew(item), 0);
  if (!object(value)) return 0;
  return Object.entries(value).reduce((sum, [key, item]) => sum + (key === "New" ? 1 : 0) + countNew(item), 0);
}

/** The bound used when a program's certificate is not held: the engine's ordinary reservation. */
export const FALLBACK_MAX_NEW_IDS = 1_024;

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

interface ResumeFacts {
  generation: string;
  schemaHash: string;
  authEpoch: number;
}

export class OfflineAuthorityError extends Error {
  readonly code = "E_OFFLINE_RESET";
  constructor(message: string) {
    super(message);
    this.name = "OfflineAuthorityError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resumeWhichMatches(which: string | undefined, op: string, args: unknown): boolean {
  if (!which) return false;
  return which === op || which === canonicalAnswerKey(op, args);
}

export class OfflineRuntime {
  readonly store: RangeStore;
  readonly fenceDays: number;
  readonly maxAssetBytes: number;
  readonly outbox: OutboxLedger;
  /** The replay currently in flight, so `settled()` can wait on it. */
  drainTail: Promise<void> = Promise.resolve();
  private partition?: string;
  private retention: Record<string, RetentionPolicy> = {};
  private schema?: OfflineSchema;
  private certificates: Record<string, number> = {};
  private facts?: ResumeFacts;
  private latestSeq = 0;
  private pendingGrant?: OutboxGrant;
  private standIn?: string;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: OfflineClientOptions) {
    this.store = options.store();
    this.fenceDays = options.fenceDays ?? 7;
    this.maxAssetBytes = options.maxAssetBytes ?? 256 * 1024 * 1024;
    this.outbox = new OutboxLedger(this.store, {
      now: () => Date.now(),
      fenceMs: this.fenceDays * 24 * 60 * 60 * 1_000,
    });
  }

  get principal(): string | undefined { return this.partition; }

  /** The highest server seq this runtime has committed; what a queued intent was issued against. */
  get seq(): number { return this.latestSeq; }

  async open(principal: string): Promise<void> {
    await this.serial(async () => {
      if (this.partition !== undefined && this.partition !== principal) await this.store.wipe(this.partition);
      await this.store.open(principal);
      this.partition = principal;
      await this.loadFacts();
      await this.flushGrant();
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
      await this.flushGrant();
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

  maxNewIds(op: string): number {
    return this.certificates[op] ?? FALLBACK_MAX_NEW_IDS;
  }

  async queuedIntents(): Promise<OutboxEntry[]> {
    if (this.partition === undefined) return [];
    return this.outbox.queued();
  }

  async seal(): Promise<void> {
    if (this.partition === undefined) return;
    await this.serial(() => this.store.seal());
  }

  async wipe(): Promise<void> {
    await this.serial(async () => {
      if (this.partition === undefined) return;
      const partition = this.partition;
      this.partition = undefined;
      this.facts = undefined;
      await this.store.wipe(partition);
      this.outbox.notify();
    });
  }

  async close(): Promise<void> {
    await this.tail;
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
    if (value.schema?.tables) this.schema = value.schema as OfflineSchema;
  }

  program(value: unknown): void {
    if (!object(value)) return;
    const schema = value.schema;
    if (object(schema) && object(schema.tables)) this.schema = schema as OfflineSchema;
    if (!object(value.programs)) return;
    const certificates: Record<string, number> = {};
    for (const [name, program] of Object.entries(value.programs)) {
      const bound = certificateMaxNewIds(program);
      if (bound !== undefined) certificates[name] = bound;
    }
    this.certificates = certificates;
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
      ...(envelope.state === "denied" ? {} : { data: expandRows(envelope) as Result }),
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
    await this.serial(async () => {
      if (this.partition === undefined) {
        throw new OfflineAuthorityError("an offline partition must be opened before committing a delivery");
      }
      const deliveries: StoreDelivery[] = [];
      const refreshes: StoreRefresh[] = [];
      const tombstones: StoreTombstone[] = [];
      let nextFacts = this.facts;
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
          if (nextFacts && (envelope.generation !== nextFacts.generation
            || envelope.schemaHash !== nextFacts.schemaHash
            || envelope.authority.authEpoch !== nextFacts.authEpoch)) {
            throw new OfflineAuthorityError("delivery generation or auth epoch does not match the open coverage");
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
      });
      this.facts = nextFacts;
      for (const item of [...deliveries, ...refreshes]) this.latestSeq = Math.max(this.latestSeq, item.seq);
      if (outbox) this.outbox.notify();
    });
  }

  async answer<Result>(op: string, args: unknown): Promise<HeldAnswer<Result> | undefined> {
    if (this.partition === undefined) return undefined;
    return this.store.answer<Result>(op, args);
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
    const watermark = coverage.watermarks.sort((a, b) => b.updatedAt - a.updatedAt)[0];
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

  private async loadFacts(): Promise<void> {
    const coverage = await this.store.coverage();
    const watermark = coverage.watermarks.sort((a, b) => b.updatedAt - a.updatedAt)[0];
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

export function offlineView<Result>(held: HeldAnswer<Result> | undefined): any {
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
