import {
  DeliveryEnvelopeDecodeError,
  decodeDeliveryEnvelope,
  expandRows,
  type DeliveryEnvelopeV1,
} from "./offline-protocol.js";
import {
  canonicalAnswerKey,
  type Coverage,
  type HeldAnswer,
  type OfflineSchema,
  type RangeStore,
  type RetentionPolicy,
  type RowRef,
  type StoreDelivery,
  type StoreRefresh,
  type StoreTombstone,
  type WatermarkRecord,
} from "./store/range-store.js";
import { ByteCache } from "./store/byte-cache.js";
import type { Manifest, OfflineClientOptions } from "./types.js";

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
  private partition?: string;
  private retention: Record<string, RetentionPolicy> = {};
  private cursors: Record<string, string> = {};
  private schema?: OfflineSchema;
  private facts?: ResumeFacts;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: OfflineClientOptions) {
    this.store = options.store();
    this.fenceDays = options.fenceDays ?? 7;
    this.maxAssetBytes = options.maxAssetBytes ?? 256 * 1024 * 1024;
    this.bytes = new ByteCache(this.store, { maxAssetBytes: this.maxAssetBytes, viewOnce: options.viewOnce });
  }

  get principal(): string | undefined { return this.partition; }

  async open(principal: string): Promise<void> {
    await this.serial(async () => {
      if (this.partition !== undefined && this.partition !== principal) await this.store.wipe(this.partition);
      await this.store.open(principal);
      this.partition = principal;
      this.bytes.bind(principal);
      await this.loadFacts();
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
    });
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
      this.bytes.bind(undefined);
      await this.store.wipe(partition);
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

  program(value: unknown): void {
    if (!object(value)) return;
    const schema = value.schema;
    if (object(schema) && object(schema.tables)) this.schema = schema as OfflineSchema;
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
  ): Promise<void> {
    if (items.length === 0 && !watermark) return;
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
      });
      this.facts = nextFacts;
    });
  }

  async answer<Result>(op: string, args: unknown): Promise<HeldAnswer<Result> | undefined> {
    if (this.partition === undefined) return undefined;
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
    return {
      protocol: 1,
      ...this.facts,
      ...(!watermark || omitLog ? {} : {
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
