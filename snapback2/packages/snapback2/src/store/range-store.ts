// @ref LLP 1012#4-the-range-store — every carrier persists the same per-principal answer/range model.
// @ref LLP 1012#5-retention-revocation-and-the-fence — eviction is decided once over a complete swap.

export type PrincipalPartition = string;
export type RetentionPolicy = "until-revoked" | "delivered-history";

export interface RowRef { table: string; id: string }
export interface StoredRow extends RowRef { row: Record<string, unknown> }

export interface ReceiptRange {
  site: string;
  table: string;
  index: string;
  prefix: unknown[];
  order: "Asc" | "Desc";
  take: number;
  after: unknown;
  before: unknown;
  gt: unknown;
  gte: unknown;
  lt: unknown;
  lte: unknown;
  rowIds: string[];
  stop: "Limit" | "Exhausted";
  absence: boolean;
  haloId?: string;
  ruleHash: string;
}

export interface Receipt {
  ranges: ReceiptRange[];
  absences: Array<[table: string, index: string, key: unknown[]]>;
  verdicts: unknown[];
}

export interface HeldAnswer<Result = unknown> {
  op: string;
  args: unknown;
  state: "complete" | "capped" | "partial" | "denied";
  data?: Result;
  next?: string | null;
  seq: number;
  validator?: string;
  receipt?: Receipt;
  deliveredAt: number;
  retained?: boolean;
  caughtUp?: boolean;
  watermark?: string | null;
  reason?: string;
  rule?: string;
}

export interface StoredAnswer extends Omit<HeldAnswer, "data"> {
  data?: unknown;
  refs: RowRef[];
  order: number;
  fingerprint?: string;
}

export interface WatermarkRecord {
  op: string;
  args: unknown;
  watermark: string | null;
  validator?: string;
  generation?: string;
  schemaHash?: string;
  authEpoch?: number;
  updatedAt: number;
}

export interface Coverage {
  rows: StoredRow[];
  ranges: ReceiptRange[];
  absences: Receipt["absences"];
  verdicts: unknown[];
  watermarks: WatermarkRecord[];
}

export type OutboxState = "queued" | "committed" | "rejected" | "expired";
export interface OutboxEntry {
  intent: string;
  ids: string[];
  op: string;
  args: unknown;
  state: OutboxState;
  refusal?: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface OutboxStore {
  all(): Promise<OutboxEntry[]>;
  get(intent: string): Promise<OutboxEntry | undefined>;
  put(entry: OutboxEntry): Promise<void>;
  remove(intent: string): Promise<void>;
}

export interface StoreDelivery {
  op: string;
  args: unknown;
  state: HeldAnswer["state"];
  data?: unknown;
  next?: string | null;
  seq: number;
  validator?: string;
  receipt?: Receipt;
  rows?: StoredRow[];
  deliveredAt?: number;
  reason?: string;
  rule?: string;
}

export interface StoreTombstone extends RowRef { seq: number }
export interface StoreRefresh {
  op: string;
  args: unknown;
  seq: number;
  validator: string;
  deliveredAt?: number;
}

export interface OfflineSchema {
  tables?: Record<string, {
    columns?: Record<string, unknown>;
    indexes?: Record<string, { columns?: string[] }>;
    retain?: RetentionPolicy;
  }>;
}

export interface StoreSwap {
  deliveries?: StoreDelivery[];
  refreshes?: StoreRefresh[];
  tombstones?: StoreTombstone[];
  retention?: Record<string, RetentionPolicy>;
  schema?: OfflineSchema;
  watermark?: WatermarkRecord;
  resetCoverage?: boolean;
  dropAnswers?: string[];
  outbox?: { put?: OutboxEntry[]; remove?: string[] };
}

export interface RangeStore {
  open(partition: PrincipalPartition): Promise<void>;
  unseal(): Promise<void>;
  seal(): Promise<void>;
  wipe(partition: PrincipalPartition): Promise<void>;
  answer<Result = unknown>(op: string, args: unknown): Promise<HeldAnswer<Result> | undefined>;
  commit(swap: StoreSwap): Promise<void>;
  coverage(): Promise<Coverage>;
  readonly outbox: OutboxStore;
  close?(): Promise<void> | void;
}

export interface RangeStoreFactory {
  (): RangeStore;
  readonly carrier?: string;
}

export class OfflineStoreFailure extends Error {
  constructor(readonly code: "E_OFFLINE_CARRIER" | "E_OFFLINE_LOCK", message: string) {
    super(message);
    this.name = "OfflineStoreFailure";
  }
}

export interface PersistedRangeState {
  version: 1;
  sealed: boolean;
  clock: number;
  rows: Record<string, StoredRow>;
  answers: Record<string, StoredAnswer>;
  watermarks: Record<string, WatermarkRecord>;
  outbox: Record<string, OutboxEntry>;
  negative: Record<string, number>;
  rowSeq: Record<string, number>;
}

export interface RangeStoreBackend {
  readonly carrier: string;
  open(partition: PrincipalPartition): Promise<PersistedRangeState | undefined>;
  replace(state: PersistedRangeState): Promise<void>;
  wipe(partition: PrincipalPartition): Promise<void>;
  close(): Promise<void> | void;
}

function emptyState(): PersistedRangeState {
  return {
    version: 1, sealed: false, clock: 0, rows: {}, answers: {}, watermarks: {}, outbox: {},
    negative: {}, rowSeq: {},
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function canonicalAnswerKey(op: string, args: unknown): string {
  return `${op}\u0000${canonical(args)}`;
}

function rowKey(ref: RowRef): string {
  return `${ref.table}\u0000${ref.id}`;
}

function recordEviction(evictions: Map<string, StoreTombstone>, eviction: StoreTombstone): void {
  const key = rowKey(eviction);
  if ((evictions.get(key)?.seq ?? -1) <= eviction.seq) evictions.set(key, eviction);
}

export function rowReference(table: string, id: string): { $row: RowRef } {
  return { $row: { table, id } };
}

function asRowRef(value: unknown): RowRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const marker = (value as { $row?: unknown }).$row;
  return marker !== null && typeof marker === "object" && !Array.isArray(marker)
    && Object.keys(marker).sort().join(",") === "id,table"
    && typeof (marker as RowRef).table === "string" && typeof (marker as RowRef).id === "string"
    ? { table: (marker as RowRef).table, id: (marker as RowRef).id }
    : undefined;
}

function collectRefs(value: unknown, refs = new Map<string, RowRef>()): RowRef[] {
  const ref = asRowRef(value);
  if (ref) refs.set(rowKey(ref), ref);
  else if (Array.isArray(value)) for (const item of value) collectRefs(item, refs);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectRefs(item, refs);
  }
  return [...refs.values()];
}

function expand(value: unknown, rows: Record<string, StoredRow>): unknown {
  const ref = asRowRef(value);
  if (ref) return rows[rowKey(ref)]?.row ?? null;
  if (Array.isArray(value)) return value.map((item) => expand(item, rows));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [key, expand(item, rows)]));
}

function hiddenRefs(before: unknown, after: unknown, output = new Map<string, RowRef>()): RowRef[] {
  if (after === null || after === undefined) {
    for (const ref of collectRefs(before)) output.set(rowKey(ref), ref);
    return [...output.values()];
  }
  const ref = asRowRef(before);
  if (ref && after === null) output.set(rowKey(ref), ref);
  else if (Array.isArray(before) && Array.isArray(after)) {
    for (let index = 0; index < before.length; index += 1) {
      hiddenRefs(before[index], index < after.length ? after[index] : undefined, output);
    }
  } else if (before && after && typeof before === "object" && typeof after === "object"
    && !Array.isArray(before) && !Array.isArray(after)) {
    for (const key of Object.keys(before as object)) {
      hiddenRefs(
        (before as Record<string, unknown>)[key],
        Object.prototype.hasOwnProperty.call(after, key) ? (after as Record<string, unknown>)[key] : undefined,
        output,
      );
    }
  }
  return [...output.values()];
}

function restoreRetained(before: unknown, after: unknown, retained: Set<string>): unknown {
  const ref = asRowRef(before);
  if (ref && (after === null || after === undefined) && retained.has(rowKey(ref))) return before;
  if (Array.isArray(before) && Array.isArray(after)) {
    const result = after.map((item, index) => index < before.length
      ? restoreRetained(before[index], item, retained) : item);
    for (let index = after.length; index < before.length; index += 1) {
      if (collectRefs(before[index]).some((item) => retained.has(rowKey(item)))) result.push(clone(before[index]));
    }
    return result;
  }
  if (before && after && typeof before === "object" && typeof after === "object"
    && !Array.isArray(before) && !Array.isArray(after)) {
    const result = clone(after as Record<string, unknown>);
    for (const key of Object.keys(before as object)) {
      const old = (before as Record<string, unknown>)[key];
      if (Object.prototype.hasOwnProperty.call(result, key)) result[key] = restoreRetained(old, result[key], retained);
      else if (collectRefs(old).some((item) => retained.has(rowKey(item)))) result[key] = clone(old);
    }
    return result;
  }
  if ((after === null || after === undefined)
    && collectRefs(before).some((item) => retained.has(rowKey(item)))) return clone(before);
  return after;
}

function sameRange(left: ReceiptRange, right: ReceiptRange): boolean {
  return left.site === right.site && left.table === right.table && left.index === right.index
    && canonical(left.prefix) === canonical(right.prefix)
    && left.order === right.order
    && canonical(left.after) === canonical(right.after)
    && canonical(left.before) === canonical(right.before)
    && canonical(left.gt) === canonical(right.gt)
    && canonical(left.gte) === canonical(right.gte)
    && canonical(left.lt) === canonical(right.lt)
    && canonical(left.lte) === canonical(right.lte)
    && left.ruleHash === right.ruleHash;
}

function compareValue(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (typeof left === "number" && typeof right === "number") return left < right ? -1 : 1;
  if (typeof left === "string" && typeof right === "string") return left < right ? -1 : 1;
  if (typeof left === "boolean" && typeof right === "boolean") return left ? 1 : -1;
  const a = canonical(left);
  const b = canonical(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareKey(left: unknown[], right: unknown[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const order = compareValue(left[index], right[index]);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

function indexKey(schema: OfflineSchema | undefined, range: ReceiptRange, row: StoredRow | undefined): unknown[] | undefined {
  const columns = schema?.tables?.[range.table]?.indexes?.[range.index]?.columns;
  if (!row || !Array.isArray(columns) || !columns.every((item) => typeof item === "string")) return undefined;
  const key = columns.map((column) => row.row[column]);
  return key.some((item) => item === undefined) ? undefined : key;
}

function cursorKey(value: unknown, width: number): unknown[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.length === width ? value : undefined;
  return width === 1 ? [value] : undefined;
}

function insidePrefixBounds(key: unknown[], range: ReceiptRange): boolean {
  if (key.length < range.prefix.length
    || compareKey(key.slice(0, range.prefix.length), range.prefix) !== 0) return false;
  const suffix = key.slice(range.prefix.length);
  const after = cursorKey(range.after, suffix.length);
  const before = cursorKey(range.before, suffix.length);
  if (after && (range.order === "Asc" ? compareKey(suffix, after) <= 0 : compareKey(suffix, after) >= 0)) return false;
  if (before && (range.order === "Asc" ? compareKey(suffix, before) >= 0 : compareKey(suffix, before) <= 0)) return false;
  const first = suffix[0];
  if (range.gt !== null && range.gt !== undefined && compareValue(first, range.gt) <= 0) return false;
  if (range.gte !== null && range.gte !== undefined && compareValue(first, range.gte) < 0) return false;
  if (range.lt !== null && range.lt !== undefined && compareValue(first, range.lt) >= 0) return false;
  if (range.lte !== null && range.lte !== undefined && compareValue(first, range.lte) > 0) return false;
  return true;
}

function inFreshExtent(
  id: string,
  held: ReceiptRange,
  fresh: ReceiptRange,
  rows: Record<string, StoredRow>,
  schema: OfflineSchema | undefined,
): boolean {
  const key = indexKey(schema, held, rows[rowKey({ table: held.table, id })]);
  if (!key) return fresh.stop === "Exhausted";
  if (!insidePrefixBounds(key, fresh)) return false;
  if (fresh.stop === "Exhausted") return true;
  const presentKeys = fresh.rowIds
    .map((rowId) => indexKey(schema, fresh, rows[rowKey({ table: fresh.table, id: rowId })]))
    .filter(Array.isArray) as unknown[][];
  if (presentKeys.length === 0) return false;
  const first = presentKeys.reduce((a, b) => compareKey(a, b) <= 0 ? a : b);
  const last = presentKeys.reduce((a, b) => compareKey(a, b) >= 0 ? a : b);
  return compareKey(key, first) >= 0 && compareKey(key, last) <= 0;
}

function normalizeState(value: PersistedRangeState | undefined): PersistedRangeState {
  if (!value) return emptyState();
  if (value.version !== 1 || typeof value.rows !== "object" || typeof value.answers !== "object") {
    throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "range store contains an unsupported format");
  }
  return {
    ...value,
    watermarks: value.watermarks ?? {},
    outbox: value.outbox ?? {},
    negative: value.negative ?? {},
    rowSeq: value.rowSeq ?? {},
  };
}

/** Shared swap engine; carrier subclasses only provide the atomic replace. */
export class PersistentRangeStore implements RangeStore {
  private state = emptyState();
  private partition?: PrincipalPartition;
  private tail: Promise<void> = Promise.resolve();

  readonly outbox: OutboxStore = {
    all: async () => this.read(() => {
      this.ensureUnsealed();
      return clone(Object.values(this.state.outbox).sort((a, b) => a.createdAt - b.createdAt));
    }),
    get: async (intent) => this.read(() => {
      this.ensureUnsealed();
      return this.state.outbox[intent] && clone(this.state.outbox[intent]);
    }),
    put: async (entry) => this.commit({ outbox: { put: [entry] } }),
    remove: async (intent) => this.commit({ outbox: { remove: [intent] } }),
  };

  constructor(private readonly backend: RangeStoreBackend) {}

  async open(partition: PrincipalPartition): Promise<void> {
    if (typeof partition !== "string" || partition.length === 0) {
      throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "range store partition must be a principal id");
    }
    await this.enqueue(async () => {
      if (this.partition === partition) return;
      if (this.partition !== undefined && this.partition !== partition) await this.backend.close();
      this.partition = partition;
      this.state = normalizeState(await this.backend.open(partition));
    });
  }

  async unseal(): Promise<void> {
    await this.enqueue(async () => {
      this.ensureOpen();
      if (!this.state.sealed) return;
      const next = { ...clone(this.state), sealed: false };
      await this.backend.replace(next);
      this.state = next;
    });
  }

  async seal(): Promise<void> {
    await this.enqueue(async () => {
      this.ensureOpen();
      const next = { ...clone(this.state), sealed: true };
      await this.backend.replace(next);
      this.state = next;
    });
  }

  async wipe(partition: PrincipalPartition): Promise<void> {
    await this.enqueue(async () => {
      await this.backend.wipe(partition);
      if (this.partition === partition) {
        this.partition = undefined;
        this.state = emptyState();
      }
    });
  }

  async answer<Result = unknown>(op: string, args: unknown): Promise<HeldAnswer<Result> | undefined> {
    return this.read(() => {
      if (this.state.sealed) return undefined;
      const key = canonicalAnswerKey(op, args);
      const stored = this.state.answers[key];
      if (!stored) return undefined;
      const watermark = this.state.watermarks[key];
      const { refs: _refs, order: _order, fingerprint: _fingerprint, data, ...answer } = clone(stored);
      return {
        ...answer,
        ...(data === undefined ? {} : { data: expand(data, this.state.rows) as Result }),
        ...(watermark === undefined ? {} : { caughtUp: true, watermark: watermark.watermark }),
      };
    });
  }

  async coverage(): Promise<Coverage> {
    return this.read(() => {
      if (this.state.sealed) return { rows: [], ranges: [], absences: [], verdicts: [], watermarks: [] };
      const ranges = new Map<string, ReceiptRange>();
      const absences = new Map<string, Receipt["absences"][number]>();
      const verdicts = new Map<string, unknown>();
      for (const answer of Object.values(this.state.answers)) {
        for (const range of answer.receipt?.ranges ?? []) {
          ranges.set(`${range.site}\u0000${canonical(range.prefix)}\u0000${canonical([
            range.order, range.after, range.before, range.gt, range.gte, range.lt, range.lte,
          ])}`, clone(range));
        }
        for (const absence of answer.receipt?.absences ?? []) absences.set(canonical(absence), clone(absence));
        for (const verdict of answer.receipt?.verdicts ?? []) verdicts.set(canonical(verdict), clone(verdict));
      }
      return {
        rows: clone(Object.values(this.state.rows)),
        ranges: [...ranges.values()],
        absences: [...absences.values()],
        verdicts: [...verdicts.values()],
        watermarks: clone(Object.values(this.state.watermarks)),
      };
    });
  }

  async commit(swap: StoreSwap): Promise<void> {
    await this.enqueue(async () => {
      this.ensureOpen();
      const next = this.applySwap(clone(this.state), clone(swap));
      await this.backend.replace(next);
      this.state = next;
    });
  }

  async close(): Promise<void> {
    await this.enqueue(async () => {
      this.partition = undefined;
      this.state = emptyState();
      await this.backend.close();
    });
  }

  private applySwap(state: PersistedRangeState, swap: StoreSwap): PersistedRangeState {
    if (state.sealed) throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "range store is sealed");
    if (swap.resetCoverage) {
      state.rows = {};
      state.answers = {};
      state.watermarks = {};
    }
    for (const key of swap.dropAnswers ?? []) delete state.answers[key];
    for (const refresh of swap.refreshes ?? []) {
      const answer = state.answers[canonicalAnswerKey(refresh.op, refresh.args)];
      if (!answer || refresh.seq < answer.seq) continue;
      if (answer.validator !== undefined && answer.validator !== refresh.validator) {
        throw new TypeError(`conditional validator changed for ${refresh.op}`);
      }
      if (refresh.seq === answer.seq) continue;
      answer.seq = refresh.seq;
      answer.validator = refresh.validator;
      answer.deliveredAt = refresh.deliveredAt ?? Date.now();
      answer.order = ++state.clock;
    }
    const before = clone(state.answers);
    const freshRanges: Array<{ range: ReceiptRange; seq: number }> = [];
    const explicitEvictions = new Map<string, StoreTombstone>();
    for (const ref of swap.tombstones ?? []) {
      const key = rowKey(ref);
      if ((state.negative[key] ?? -1) <= ref.seq) recordEviction(explicitEvictions, ref);
    }
    for (const delivery of swap.deliveries ?? []) {
      if (!Number.isSafeInteger(delivery.seq) || delivery.seq < 0) {
        throw new TypeError("store delivery seq must be a non-negative safe integer");
      }
      const key = canonicalAnswerKey(delivery.op, delivery.args);
      const old = before[key];
      const fingerprint = canonical({
        op: delivery.op, args: delivery.args, state: delivery.state, data: delivery.data,
        next: delivery.next, seq: delivery.seq, validator: delivery.validator,
        receipt: delivery.receipt, rows: delivery.rows, reason: delivery.reason, rule: delivery.rule,
      });
      if (old && delivery.seq < old.seq) continue;
      if (old && delivery.seq === old.seq) {
        if (old.fingerprint === fingerprint) continue;
        throw new TypeError(`conflicting deliveries for ${delivery.op} at seq ${delivery.seq}`);
      }
      for (const row of delivery.rows ?? []) {
        if (!row.table || !row.id || !row.row || typeof row.row !== "object") {
          throw new TypeError("store delivery row is malformed");
        }
        const storageKey = rowKey(row);
        if ((state.negative[storageKey] ?? -1) >= delivery.seq) {
          recordEviction(explicitEvictions, { table: row.table, id: row.id, seq: state.negative[storageKey]! });
          continue;
        }
        if (state.rowSeq[storageKey] === delivery.seq
          && canonical(state.rows[storageKey]) !== canonical(row)) {
          throw new TypeError(`conflicting row ${row.table}/${row.id} at seq ${delivery.seq}`);
        }
        if ((state.rowSeq[storageKey] ?? -1) > delivery.seq) continue;
        state.rows[storageKey] = clone(row);
        state.rowSeq[storageKey] = delivery.seq;
      }
      let data = clone(delivery.data);
      let answerState = delivery.state;
      let retained = false;
      const hidden = delivery.state === "denied" && old
        ? old.refs
        : old ? hiddenRefs(old.data, data) : [];
      const retainedRefs = new Set<string>();
      for (const ref of hidden) {
        if ((swap.retention?.[ref.table] ?? "until-revoked") === "delivered-history") {
          retainedRefs.add(rowKey(ref));
          retained = true;
        } else recordEviction(explicitEvictions, { ...ref, seq: delivery.seq });
      }
      if (delivery.state === "denied" && old && retainedRefs.size > 0) {
        data = clone(old.data);
        answerState = old.state;
      } else if (old && retainedRefs.size > 0) {
        data = restoreRetained(old.data, data, retainedRefs);
      }
      const refs = collectRefs(data);
      for (const range of delivery.receipt?.ranges ?? []) {
        for (const id of [...range.rowIds, ...(range.haloId ? [range.haloId] : [])]) {
          if (!refs.some((ref) => ref.table === range.table && ref.id === id)) refs.push({ table: range.table, id });
        }
      }
      const stored: StoredAnswer = {
        op: delivery.op,
        args: clone(delivery.args),
        state: answerState,
        ...(data === undefined ? {} : { data }),
        ...(delivery.next === undefined ? {} : { next: delivery.next }),
        seq: delivery.seq,
        ...(delivery.validator === undefined ? {} : { validator: delivery.validator }),
        ...(delivery.receipt === undefined ? {} : { receipt: clone(delivery.receipt) }),
        deliveredAt: delivery.deliveredAt ?? Date.now(),
        ...(retained ? { retained: true } : {}),
        ...(delivery.reason === undefined ? {} : { reason: delivery.reason }),
        ...(delivery.rule === undefined ? {} : { rule: delivery.rule }),
        refs,
        order: ++state.clock,
        fingerprint,
      };
      state.answers[key] = stored;
      freshRanges.push(...(delivery.receipt?.ranges ?? []).map((range) => ({ range, seq: delivery.seq })));
      for (const [table, index, absenceKey] of delivery.receipt?.absences ?? []) {
        if (index !== "byId" || absenceKey.length !== 1) {
          throw new TypeError("store receipts may evict only a primary byId absence");
        }
        const id = absenceKey[0];
        if (typeof id === "string") recordEviction(explicitEvictions, { table, id, seq: delivery.seq });
      }
    }

    const heldRanges = Object.values(before).flatMap((answer) => answer.receipt?.ranges ?? []);
    for (const held of heldRanges) {
      const matching = freshRanges.filter(({ range: fresh }) => sameRange(held, fresh));
      if (matching.length === 0) continue;
      const present = new Set(matching.flatMap(({ range: fresh }) => [
        ...fresh.rowIds,
        ...(fresh.haloId ? [fresh.haloId] : []),
      ]));
      for (const id of held.rowIds) {
        if (present.has(id)) continue;
        const seq = matching
          .filter(({ range: fresh }) => inFreshExtent(id, held, fresh, state.rows, swap.schema))
          .reduce((latest, item) => Math.max(latest, item.seq), -1);
        if (seq >= 0) recordEviction(explicitEvictions, { table: held.table, id, seq });
      }
    }

    const appliedEvictions = new Set<string>();
    for (const [key, eviction] of explicitEvictions) {
      if ((state.negative[key] ?? -1) > eviction.seq) continue;
      if ((state.rowSeq[key] ?? -1) > eviction.seq) continue;
      state.negative[key] = eviction.seq;
      appliedEvictions.add(key);
      delete state.rows[key];
      delete state.rowSeq[key];
      for (const answer of Object.values(state.answers)) {
        for (const range of answer.receipt?.ranges ?? []) {
          if (range.table !== eviction.table) continue;
          const id = eviction.id;
          range.rowIds = range.rowIds.filter((rowId) => rowId !== id);
          if (range.haloId === id) delete range.haloId;
        }
        if (!answer.refs.some((ref) => rowKey(ref) === key)) continue;
        answer.refs = answer.refs.filter((ref) => rowKey(ref) !== key);
        if (!answer.retained && answer.state !== "denied") {
          answer.state = "partial";
          answer.reason = "evicted";
          delete answer.next;
        }
      }
    }

    for (const answer of Object.values(state.answers)) {
      if (!answer.receipt) continue;
      answer.receipt.absences = answer.receipt.absences.filter(([table, index, key]) => {
        const id = index === "byId" && key.length === 1 ? key[0] : undefined;
        const storageKey = typeof id === "string" ? rowKey({ table, id }) : undefined;
        return storageKey === undefined || (state.rowSeq[storageKey] ?? -1) < 0 || appliedEvictions.has(storageKey);
      });
    }

    const referenced = new Set(Object.values(state.answers).flatMap((answer) => answer.refs.map(rowKey)));
    // Rows that arrived only as unused pool entries do not survive the swap.
    for (const key of Object.keys(state.rows)) if (!referenced.has(key)) {
      delete state.rows[key];
      delete state.rowSeq[key];
    }

    if (swap.watermark) state.watermarks[canonicalAnswerKey(swap.watermark.op, swap.watermark.args)] = clone(swap.watermark);
    for (const intent of swap.outbox?.remove ?? []) delete state.outbox[intent];
    for (const entry of swap.outbox?.put ?? []) state.outbox[entry.intent] = clone(entry);
    return state;
  }

  private ensureOpen(): void {
    if (this.partition === undefined) {
      throw new OfflineStoreFailure("E_OFFLINE_CARRIER", `${this.backend.carrier} range store is not open`);
    }
  }

  private ensureUnsealed(): void {
    if (this.state.sealed) throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "range store is sealed");
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const run = this.tail.then(action);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async read<T>(action: () => T): Promise<T> {
    await this.tail;
    this.ensureOpen();
    return action();
  }
}
