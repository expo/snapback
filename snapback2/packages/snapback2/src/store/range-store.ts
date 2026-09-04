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
  prefix: unknown;
  bounds: unknown;
  rowIds: string[];
  stop: unknown;
  absence: boolean;
  haloId?: string;
  /** O1a's final envelope may replace this internal extent aid. */
  rowKeys?: Record<string, unknown[]>;
  ruleHash?: string;
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

export interface StoreSwap {
  deliveries?: StoreDelivery[];
  tombstones?: RowRef[];
  retention?: Record<string, RetentionPolicy>;
  watermark?: WatermarkRecord;
  resetCoverage?: boolean;
  dropAnswers?: string[];
  dropOldestUnmounted?: { mounted: string[]; count: number };
  outbox?: { put?: OutboxEntry[]; remove?: string[] };
}

export interface RangeStore {
  open(partition: PrincipalPartition): Promise<void>;
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
}

export interface RangeStoreBackend {
  readonly carrier: string;
  open(partition: PrincipalPartition): Promise<PersistedRangeState | undefined>;
  replace(state: PersistedRangeState): Promise<void>;
  wipe(partition: PrincipalPartition): Promise<void>;
  close(): Promise<void> | void;
}

function emptyState(): PersistedRangeState {
  return { version: 1, sealed: false, clock: 0, rows: {}, answers: {}, watermarks: {}, outbox: {} };
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

export function rowReference(table: string, id: string): { $row: [string, string] } {
  return { $row: [table, id] };
}

function asRowRef(value: unknown): RowRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const marker = (value as { $row?: unknown }).$row;
  return Array.isArray(marker) && marker.length === 2
    && typeof marker[0] === "string" && typeof marker[1] === "string"
    ? { table: marker[0], id: marker[1] }
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
  const ref = asRowRef(before);
  if (ref && after === null) output.set(rowKey(ref), ref);
  else if (Array.isArray(before) && Array.isArray(after)) {
    for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
      hiddenRefs(before[index], after[index], output);
    }
  } else if (before && after && typeof before === "object" && typeof after === "object"
    && !Array.isArray(before) && !Array.isArray(after)) {
    for (const key of Object.keys(before as object)) {
      if (Object.prototype.hasOwnProperty.call(after, key)) {
        hiddenRefs((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], output);
      }
    }
  }
  return [...output.values()];
}

function restoreRetained(before: unknown, after: unknown, retained: Set<string>): unknown {
  const ref = asRowRef(before);
  if (ref && after === null && retained.has(rowKey(ref))) return before;
  if (Array.isArray(before) && Array.isArray(after)) {
    return after.map((item, index) => index < before.length
      ? restoreRetained(before[index], item, retained) : item);
  }
  if (before && after && typeof before === "object" && typeof after === "object"
    && !Array.isArray(before) && !Array.isArray(after)) {
    const result = clone(after as Record<string, unknown>);
    for (const key of Object.keys(before as object)) {
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        result[key] = restoreRetained((before as Record<string, unknown>)[key], result[key], retained);
      }
    }
    return result;
  }
  return after;
}

function sameRange(left: ReceiptRange, right: ReceiptRange): boolean {
  return left.site === right.site && left.table === right.table && left.index === right.index
    && canonical(left.prefix) === canonical(right.prefix)
    && (left.ruleHash ?? "") === (right.ruleHash ?? "");
}

function compareKey(left: unknown[], right: unknown[]): number {
  const a = canonical(left);
  const b = canonical(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function exhausted(stop: unknown): boolean {
  return stop === "Exhausted" || stop === "exhausted"
    || (!!stop && typeof stop === "object" && "Exhausted" in stop);
}

function inFreshExtent(id: string, held: ReceiptRange, fresh: ReceiptRange): boolean {
  if (exhausted(fresh.stop)) return true;
  const presentKeys = fresh.rowIds.map((rowId) => fresh.rowKeys?.[rowId]).filter(Array.isArray) as unknown[][];
  const key = held.rowKeys?.[id];
  if (!key || presentKeys.length === 0) return false;
  const first = presentKeys.reduce((a, b) => compareKey(a, b) <= 0 ? a : b);
  const last = presentKeys.reduce((a, b) => compareKey(a, b) >= 0 ? a : b);
  return compareKey(key, first) >= 0 && compareKey(key, last) <= 0;
}

function normalizeState(value: PersistedRangeState | undefined): PersistedRangeState {
  if (!value) return emptyState();
  if (value.version !== 1 || typeof value.rows !== "object" || typeof value.answers !== "object") {
    throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "range store contains an unsupported format");
  }
  return value;
}

/** Shared swap engine; carrier subclasses only provide the atomic replace. */
export class PersistentRangeStore implements RangeStore {
  private state = emptyState();
  private partition?: PrincipalPartition;
  private tail: Promise<void> = Promise.resolve();

  readonly outbox: OutboxStore = {
    all: async () => this.read(() => Object.values(this.state.outbox).sort((a, b) => a.createdAt - b.createdAt)),
    get: async (intent) => this.read(() => this.state.outbox[intent] && clone(this.state.outbox[intent])),
    put: async (entry) => this.commit({ outbox: { put: [entry] } }),
    remove: async (intent) => this.commit({ outbox: { remove: [intent] } }),
  };

  constructor(private readonly backend: RangeStoreBackend) {}

  async open(partition: PrincipalPartition): Promise<void> {
    if (typeof partition !== "string" || partition.length === 0) {
      throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "range store partition must be a principal id");
    }
    await this.enqueue(async () => {
      if (this.partition === partition) {
        if (this.state.sealed) {
          this.state = { ...this.state, sealed: false };
          await this.backend.replace(this.state);
        }
        return;
      }
      if (this.partition !== undefined && this.partition !== partition) await this.backend.close();
      this.partition = partition;
      this.state = normalizeState(await this.backend.open(partition));
      if (this.state.sealed) {
        this.state = { ...this.state, sealed: false };
        await this.backend.replace(this.state);
      }
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
      const { refs: _refs, order: _order, data, ...answer } = clone(stored);
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
          ranges.set(`${range.site}\u0000${canonical(range.prefix)}\u0000${canonical(range.bounds)}`, clone(range));
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
    if (swap.dropOldestUnmounted) {
      const mounted = new Set(swap.dropOldestUnmounted.mounted);
      const candidates = Object.entries(state.answers)
        .filter(([key]) => !mounted.has(key))
        .sort((left, right) => left[1].order - right[1].order)
        .slice(0, Math.max(0, swap.dropOldestUnmounted.count));
      for (const [key] of candidates) delete state.answers[key];
    }
    const before = clone(state.answers);
    const freshRanges: ReceiptRange[] = [];
    const freshRows = new Set<string>();
    const explicitEvictions = new Map<string, RowRef>();
    for (const ref of swap.tombstones ?? []) explicitEvictions.set(rowKey(ref), ref);
    for (const delivery of swap.deliveries ?? []) {
      if (!Number.isFinite(delivery.seq)) throw new TypeError("store delivery seq must be a number");
      for (const row of delivery.rows ?? []) {
        if (!row.table || !row.id || !row.row || typeof row.row !== "object") {
          throw new TypeError("store delivery row is malformed");
        }
        state.rows[rowKey(row)] = clone(row);
        freshRows.add(rowKey(row));
      }
      const key = canonicalAnswerKey(delivery.op, delivery.args);
      const old = before[key];
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
        } else explicitEvictions.set(rowKey(ref), ref);
      }
      if (delivery.state === "denied" && old && retainedRefs.size > 0) {
        data = clone(old.data);
        answerState = old.state;
      } else if (old && retainedRefs.size > 0) {
        data = restoreRetained(old.data, data, retainedRefs);
      }
      const refs = collectRefs(data);
      for (const row of delivery.rows ?? []) {
        if (!refs.some((ref) => ref.table === row.table && ref.id === row.id)) refs.push({ table: row.table, id: row.id });
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
      };
      state.answers[key] = stored;
      freshRanges.push(...(delivery.receipt?.ranges ?? []));
      for (const [table, _index, absenceKey] of delivery.receipt?.absences ?? []) {
        const id = absenceKey.at(-1);
        if (typeof id === "string") explicitEvictions.set(rowKey({ table, id }), { table, id });
      }
    }

    const heldRanges = Object.values(before).flatMap((answer) => answer.receipt?.ranges ?? []);
    for (const fresh of freshRanges) {
      const present = new Set([...fresh.rowIds, ...(fresh.haloId ? [fresh.haloId] : [])]);
      for (const held of heldRanges.filter((candidate) => sameRange(candidate, fresh))) {
        for (const id of held.rowIds) {
          if (!present.has(id) && inFreshExtent(id, held, fresh)) {
            explicitEvictions.set(rowKey({ table: held.table, id }), { table: held.table, id });
          }
        }
      }
    }

    for (const key of explicitEvictions.keys()) {
      delete state.rows[key];
      for (const answer of Object.values(state.answers)) {
        for (const range of answer.receipt?.ranges ?? []) {
          if (range.table !== explicitEvictions.get(key)?.table) continue;
          const id = explicitEvictions.get(key)!.id;
          range.rowIds = range.rowIds.filter((rowId) => rowId !== id);
          if (range.haloId === id) delete range.haloId;
          if (range.rowKeys) delete range.rowKeys[id];
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
      answer.receipt.absences = answer.receipt.absences.filter(([table, _index, key]) => {
        const id = key.at(-1);
        const storageKey = typeof id === "string" ? rowKey({ table, id }) : undefined;
        return storageKey === undefined || !freshRows.has(storageKey) || explicitEvictions.has(storageKey);
      });
    }

    const referenced = new Set(Object.values(state.answers).flatMap((answer) => answer.refs.map(rowKey)));
    for (const key of Object.keys(state.rows)) {
      if (!referenced.has(key) && !freshRows.has(key)) delete state.rows[key];
    }
    // Rows that arrived only as unused pool entries do not survive the swap.
    for (const key of Object.keys(state.rows)) if (!referenced.has(key)) delete state.rows[key];

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
