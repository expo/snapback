import { onceColumns, onceRow, onceAssetIds, nullOnceMedia, type OnceColumns } from "./asset-policy.js";
// @ref LLP 1012#4-the-range-store — every carrier persists the same per-principal answer/range model.
// @ref LLP 1012#5-retention-revocation-and-the-fence — eviction is decided once over a complete swap.
// @ref LLP 1012#9-asset-bytes-on-the-device — asset bytes leave in the same commit as the row whose lease held them.

import {
  applyByteSwap,
  assetIdsIn,
  byteKey,
  leasedAssets,
  viewedOnlyAssets,
  fullyViewed,
  type ByteCacheEntry,
  type ByteCacheStatus,
  type ByteDelta,
  type ByteSwapRequest,
  type ViewedRecord,
} from "./byte-cache.js";

import { advanceOverlay, cursorChain, pagePosition, type OverlayWatermark } from "./overlay-retirement.js";
import { canonical } from "./canonical.js";
import { sha256 } from "../../../evaluator/src/hash.js";
import { totalCompare } from "../../../evaluator/src/value-runtime.js";
import { tagWireValue, type TaggedValue, type WireValue } from "../offline-protocol.js";
import { asRowRef, collectRefs, escapedFields, mapRowValues, purgeAnswerData } from "./row-values.js";

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
  /**
   * Members this page was recorded with that a later swap evicted (LLP 1012 §5):
   * the page's answer is `partial/evicted` from then on, and the twin's
   * drained-prefix rule (§6) no longer counts the page as a link in a complete chain.
   */
  evictedIds?: string[];
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
  /** The owner's execution read time of a clock-reading program's answer (LLP 1012 §8). */
  readTime?: number;
}

export interface StoredAnswer extends Omit<HeldAnswer, "data"> {
  data?: unknown;
  refs: RowRef[];
  order: number;
  fingerprint?: string;
  /** Cursor argument used when this page was filed, before or after manifest load. */
  cursorArg?: string;
  /** Seq of the full delivery behind the fingerprint and `next`; unchanged cannot renew either. */
  nextSeq?: number;
}

export interface WatermarkRecord {
  op: string;
  args: unknown;
  /** The argument the manifest types as this query's cursor; `c` before the manifest loads. */
  cursorArg?: string;
  watermark: string | null;
  validator?: string;
  generation?: string;
  schemaHash?: string;
  authEpoch?: number;
  updatedAt: number;
  /**
   * Durable position among this partition's drained queries: assigned by the store
   * when the query first records a watermark, kept across every later mark. The
   * lowest order is the log a settlement and a resume name (LLP 1012 §7).
   */
  order?: number;
}

/** The generation and authority every held envelope of a partition was delivered under. */
export interface CoverageFacts {
  generation: string;
  schemaHash: string;
  authEpoch: number;
}

/** One certified operation as `GET /api/program` serves it: the IR the twin runs and its certificate. */
export interface HeldOperation {
  drain?: import("../types.js").DrainContract;
  kind: "query" | "mutation";
  planHash: string;
  ir: unknown;
  certificate: unknown;
}

// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — the program
// custody the evaluator ticket names: the certified IR, certificates, and the
// schema of one generation, held in the partition so a cold start with the
// network cut still evaluates and prices from the certificate.
export interface HeldProgram {
  generation: string;
  schemaHash: string;
  schema: OfflineSchema & Record<string, unknown>;
  programs: Record<string, HeldOperation>;
}

export interface Coverage {
  rows: StoredRow[];
  ranges: ReceiptRange[];
  absences: Receipt["absences"];
  verdicts: unknown[];
  watermarks: WatermarkRecord[];
  /**
   * View-once rows already viewed on this partition: absent from `rows`, listed under
   * `absences` as a `byId` point, and named here so a replay never renders them (LLP 1012 §9).
   */
  viewed?: RowRef[];
  /** Rows a swap evicted (LLP 1012 §5): the twin reports a read of one as `evicted`, not `never-held`. */
  evicted?: RowRef[];
  /** The generation and auth epoch the held coverage was delivered under; absent when nothing is held. */
  facts?: CoverageFacts;
  /**
   * The facts a later delivery arrived under when its generation or schema differ
   * from `facts`: the held answers predate the program the server now runs, so the
   * twin serves nothing from them — every read is `hydrating` — until the reset
   * path drops this coverage and rebuilds it under the live generation (LLP 1012 §8).
   */
  superseded?: CoverageFacts;
  /** The newest delivery's time: what an answer the twin computes reports as `stale.since`. */
  deliveredAt?: number;
}

export type OutboxState = "queued" | "committed" | "rejected" | "expired";
/** What the twin read when the intent was queued: the replay envelope's `trace` (LLP 1012 §7). */
export interface OutboxTrace {
  points: Array<{ table: string; index: string; key: unknown[]; digest: string | null }>;
  verdicts: Array<{ ruleHash: string; inputsDigest: string; result: boolean }>;
}
// @ref LLP 1012#7-writes-offline — one durable intent: its pinned id slice, its
// bytes, and its terminal response, so a retry is the same envelope.
export interface OutboxEntry {
  intent: string;
  grant: string;
  offset: number;
  count: number;
  ids: string[];
  op: string;
  args: unknown;
  issuedSeq: number;
  state: OutboxState;
  response?: unknown;
  predicted?: boolean;
  /** Prediction and its trace were skipped; the program will check this write on the server. */
  reason?: "fence";
  /** Engine-owned aggregate targets the prediction's overlay omits by design (the server writes them); absent when none. */
  omitted?: string[];
  trace?: OutboxTrace;
  createdAt: number;
  updatedAt: number;
  /** Durable FIFO position; assigned by the store when absent. */
  order?: number;
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

export interface OutboxStore {
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
export interface OverlayRow extends StoredRow { removed?: true }

export interface StoreDelivery {
  cursorArg?: string;
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
  readTime?: number;
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
  /** One validated resume response, including unchanged; never a query re-delivery. */
  resumeSeq?: number;
  dropAnswers?: string[];
  outbox?: { put?: OutboxEntry[]; remove?: string[] };
  /**
   * Byte-cache puts and read touches; they land in the same swap as the rows: one
   * readwrite transaction on IndexedDB, an ordered payload write + state rename with
   * a sweep on open for the Node file carrier.
   */
  bytes?: ByteSwapRequest;
  /** View-once rows viewed now: excluded from every later answer, their bytes never cached. */
  viewed?: RowRef[];
  viewedAssets?: string[];
  /** `current` names the grant new intents consume; `null` clears it. */
  grants?: { put?: OutboxGrant[]; current?: string | null; remove?: string[] };
  /** Predicted rows keyed by intent; visible to the twin's local evaluation, never to `answer()` (LLP 1012 §7). */
  overlay?: { put?: Record<string, OverlayRow[]>; remove?: string[] };
  /** The certified programs, replaced whole (one generation is held at a time); custody like the outbox. */
  programs?: Record<string, HeldProgram>;
  /** The facts the swap's envelopes were delivered under; cleared by `resetCoverage`. */
  facts?: CoverageFacts;
  /** A rotation: the facts a refused delivery arrived under; held coverage is superseded until rebuild completion clears it with `null`. */
  superseded?: CoverageFacts | null;
  /**
   * The program's write bounds, replaced whole: what `/api/program` certified each op may
   * mint. Custody like the outbox — a coverage reset never touches it (LLP 1012 §7).
   */
  bounds?: Record<string, number>;
}

export interface RangeStore {
  open(partition: PrincipalPartition): Promise<void>;
  /** Waits for the partition's writer lock (a browser tab following the writer); absent on carriers that refuse at once. */
  acquire?(partition: PrincipalPartition, signal?: AbortSignal): Promise<void>;
  /** Gives back a lock `acquire` won but `open` never used, touching no other request. */
  giveBack?(partition: PrincipalPartition): Promise<void>;
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
  constructor(readonly code: "E_OFFLINE_CARRIER" | "E_OFFLINE_LOCK", message: string, readonly rewrite?: string) {
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
  grants: Record<string, OutboxGrant>;
  currentGrant?: string;
  overlay: Record<string, OverlayRow[]>;
  /** Per committed intent, successful resumes or proven tail advances without its rows. */
  overlayMisses: Record<string, number>;
  /** The commit-time tail snapshot; null after reset until the next drain establishes a new head. */
  overlayWatermarks: Record<string, OverlayWatermark | null>;
  /** Coverage-scoped primary absences and tombstones for each prediction's ids; cleared on reset. */
  overlayNegatives: Record<string, Record<string, { seq: number; source: "absence" | "tombstone" }>>;
  bounds: Record<string, number>;
  programs: Record<string, HeldProgram>;
  facts?: CoverageFacts;
  superseded?: CoverageFacts;
  negative: Record<string, number>;
  rowSeq: Record<string, number>;
  /** The byte-cache index; payloads live beside the state in the carrier, keyed by `byteKey`. */
  assets: Record<string, ByteCacheEntry>;
  viewed: Record<string, ViewedRecord>;
  onceColumns: OnceColumns;
}

export interface RangeStoreBackend {
  readonly carrier: string;
  open(partition: PrincipalPartition): Promise<PersistedRangeState | undefined>;
  /** Waits for the partition's writer lock so a later `open` finds it held; carriers without a waiting lock omit it. */
  acquire?(partition: PrincipalPartition, signal?: AbortSignal): Promise<void>;
  /** Releases a lock `acquire` won that no open uses; a queued request of another wait is left alone. */
  giveBack?(partition: PrincipalPartition): Promise<void>;
  /** One carrier transaction: the state, plus the byte payloads to write and the keys to drop. */
  replace(state: PersistedRangeState, bytes: ByteDelta, previous?: PersistedRangeState): Promise<void>;
  readBytes?(key: string): Promise<Uint8Array | undefined>;
  wipe(partition: PrincipalPartition): Promise<void>;
  close(): Promise<void> | void;
}

const NO_BYTES: ByteDelta = { put: [], remove: [] };

export function emptyState(): PersistedRangeState {
  return {
    version: 1, sealed: false, clock: 0, rows: {}, answers: {}, watermarks: {}, outbox: {},
    grants: {}, overlay: {}, overlayMisses: {}, overlayWatermarks: {}, overlayNegatives: {}, bounds: {}, programs: {}, negative: {}, rowSeq: {}, assets: {}, viewed: {}, onceColumns: {},
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function canonicalAnswerKey(op: string, args: unknown): string {
  return `${op}\u0000${canonical(args === undefined ? args : jsonState(args))}`;
}

function rowKey(ref: RowRef): string {
  return `${ref.table}\u0000${ref.id}`;
}

function viewedRef(key: string): RowRef {
  const at = key.indexOf(String.fromCharCode(0));
  return { table: key.slice(0, at), id: key.slice(at + 1) };
}

function recordEviction(evictions: Map<string, StoreTombstone>, eviction: StoreTombstone): void {
  const key = rowKey(eviction);
  if ((evictions.get(key)?.seq ?? -1) <= eviction.seq) evictions.set(key, eviction);
}

export function rowReference(table: string, id: string): { $row: RowRef } {
  return { $row: { table, id } };
}

function expand(value: unknown, rows: Record<string, StoredRow>, viewed?: Record<string, unknown>): unknown {
  return mapRowValues(value, (ref) => viewed?.[rowKey(ref)] ? null : clone(rows[rowKey(ref)]?.row ?? null));
}

function hiddenRefs(before: unknown, after: unknown, output = new Map<string, RowRef>()): RowRef[] {
  if (after === null || after === undefined) {
    for (const ref of collectRefs(before)) output.set(rowKey(ref), ref);
    return [...output.values()];
  }
  if (asRowRef(before)) return [...output.values()];
  before = escapedFields(before) ?? before;
  after = escapedFields(after) ?? after;
  if (Array.isArray(before) && Array.isArray(after)) {
    for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
      hiddenRefs(before[index], after[index], output);
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

function compareValue(left: TaggedValue, right: TaggedValue): number {
  return totalCompare(left, right);
}

function compareKey(left: TaggedValue[], right: TaggedValue[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const order = compareValue(left[index], right[index]);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

function tagKey(schema: OfflineSchema | undefined, range: ReceiptRange, values: unknown[], offset = 0): TaggedValue[] {
  const table = schema?.tables?.[range.table];
  const columns = table?.indexes?.[range.index]?.columns;
  return values.map((value, at) => {
    const descriptor = table?.columns?.[columns?.[offset + at] ?? ""];
    // Handwritten harness schemas may omit column descriptors. The wire's scalar
    // values still have the same order; a real held schema always supplies types.
    const fallback = typeof value === "string" ? { Text: {} } : typeof value === "number" ? "Int"
      : typeof value === "boolean" ? "Bool" : { Json: {} };
    return tagWireValue(descriptor ?? fallback, value as WireValue, `${range.table}.${range.index}[${offset + at}]`);
  });
}

function indexKey(schema: OfflineSchema | undefined, range: ReceiptRange, row: StoredRow | undefined): TaggedValue[] | undefined {
  const columns = schema?.tables?.[range.table]?.indexes?.[range.index]?.columns;
  if (!row || !Array.isArray(columns) || !columns.every((item) => typeof item === "string")) return undefined;
  // Missing optional columns have the engine's Null value, just like explicit null.
  return tagKey(schema, range, columns.map((column) => row.row[column] ?? null));
}

function cursorKey(value: unknown, width: number): unknown[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.length === width ? value : undefined;
  return width === 1 ? [value] : undefined;
}

function insidePrefixBounds(key: TaggedValue[], range: ReceiptRange, schema: OfflineSchema | undefined): boolean {
  if (key.length < range.prefix.length
    || compareKey(key.slice(0, range.prefix.length), tagKey(schema, range, range.prefix)) !== 0) return false;
  const suffix = key.slice(range.prefix.length);
  const after = cursorKey(range.after, suffix.length);
  const before = cursorKey(range.before, suffix.length);
  const compareSuffix = (bound: unknown[]) => compareKey(suffix, tagKey(schema, range, bound, range.prefix.length));
  if (after && (range.order === "Asc" ? compareSuffix(after) <= 0 : compareSuffix(after) >= 0)) return false;
  if (before && (range.order === "Asc" ? compareSuffix(before) >= 0 : compareSuffix(before) <= 0)) return false;
  for (const [kind, value] of [["gt", range.gt], ["gte", range.gte], ["lt", range.lt], ["lte", range.lte]] as const) {
    if (value === null || value === undefined) continue;
    const order = compareValue(suffix[0]!, tagKey(schema, range, [value], range.prefix.length)[0]!);
    if (kind === "gt" ? order <= 0 : kind === "gte" ? order < 0 : kind === "lt" ? order >= 0 : order > 0) return false;
  }
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
  if (!insidePrefixBounds(key, fresh, schema)) return false;
  if (fresh.stop === "Exhausted") return true;
  const presentKeys = fresh.rowIds
    .map((rowId) => indexKey(schema, fresh, rows[rowKey({ table: fresh.table, id: rowId })]))
    .filter(Array.isArray) as TaggedValue[][];
  if (presentKeys.length === 0) return false;
  const first = presentKeys.reduce((a, b) => compareKey(a, b) <= 0 ? a : b);
  const last = presentKeys.reduce((a, b) => compareKey(a, b) >= 0 ? a : b);
  return compareKey(key, first) >= 0 && compareKey(key, last) <= 0;
}

/** One JSON form for warm state and every carrier: omit undefined fields, preserve null. */
export function jsonState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeState(value: PersistedRangeState | undefined): PersistedRangeState {
  if (!value) return emptyState();
  value = jsonState(value);
  if (value.version !== 1 || typeof value.rows !== "object" || typeof value.answers !== "object") {
    throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "range store contains an unsupported format");
  }
  // Older snapshots used the canonical delivery itself as the fingerprint.
  // Hash that value before any subsequent persistence can retain its row bodies.
  for (const answer of Object.values(value.answers)) {
    if (answer.fingerprint && !/^[0-9a-f]{64}$/.test(answer.fingerprint)) answer.fingerprint = sha256(answer.fingerprint);
  }
  return {
    ...value,
    watermarks: value.watermarks ?? {},
    outbox: value.outbox ?? {},
    grants: value.grants ?? {},
    overlay: value.overlay ?? {},
    overlayMisses: value.overlayMisses ?? {},
    overlayWatermarks: value.overlayWatermarks ?? {},
    overlayNegatives: value.overlayNegatives ?? {},
    bounds: value.bounds ?? {},
    programs: value.programs ?? {},
    onceColumns: value.onceColumns ?? {},
    negative: value.negative ?? {},
    rowSeq: value.rowSeq ?? {},
    assets: value.assets ?? {},
    viewed: value.viewed ?? {},
  };
}

/**
 * The log a settlement's tail request and a resume's `log` both name: the drained
 * query whose watermark was recorded first in this partition — the first-mounted
 * drain, since a drain records its watermark when it first catches up — by the
 * store's durable `order`, so the choice survives restarts and re-marks and never
 * follows whichever page moved last (LLP 1012 §7, §8).
 */
export function tailWatermark(watermarks: WatermarkRecord[]): WatermarkRecord | undefined {
  return [...watermarks].sort((a, b) =>
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
    || a.updatedAt - b.updatedAt
    || canonicalAnswerKey(a.op, a.args).localeCompare(canonicalAnswerKey(b.op, b.args)))[0];
}

/** Two post-commit resumes or proven tail advances retire a stranded prediction. */
const OVERLAY_PATIENCE = 2;

function outboxOrder(entries: Record<string, OutboxEntry>): OutboxEntry[] {
  return Object.values(entries).sort((a, b) =>
    (a.order ?? a.createdAt) - (b.order ?? b.createdAt) || a.createdAt - b.createdAt || (a.intent < b.intent ? -1 : 1));
}

function changesCoverage(swap: StoreSwap): boolean {
  return !!(swap.resetCoverage || swap.deliveries?.length || swap.refreshes?.length || swap.tombstones?.length
    || swap.dropAnswers?.length || swap.bytes || swap.viewed?.length || swap.schema || swap.programs);
}

/** Shared swap engine; carrier subclasses only provide the atomic replace. */
export class PersistentRangeStore implements RangeStore {
  private state = emptyState();
  private persisted?: PersistedRangeState;
  private partition?: PrincipalPartition;
  private tail: Promise<void> = Promise.resolve();

  readonly outbox: OutboxStore = {
    all: async () => this.read(() => {
      this.ensureUnsealed();
      return clone(outboxOrder(this.state.outbox));
    }),
    get: async (intent) => this.read(() => {
      this.ensureUnsealed();
      return this.state.outbox[intent] && clone(this.state.outbox[intent]);
    }),
    put: async (entry) => this.commit({ outbox: { put: [entry] } }),
    remove: async (intent) => this.commit({ outbox: { remove: [intent] } }),
    grant: async () => this.read(() => {
      this.ensureUnsealed();
      const current = this.state.currentGrant === undefined ? undefined : this.state.grants[this.state.currentGrant];
      return current && clone(current);
    }),
    grants: async () => this.read(() => {
      this.ensureUnsealed();
      return clone(Object.values(this.state.grants));
    }),
    bounds: async () => this.read(() => {
      this.ensureUnsealed();
      return clone(this.state.bounds);
    }),
    overlay: async () => this.read(() => {
      this.ensureUnsealed();
      return clone(this.state.overlay);
    }),
    programs: async () => this.read(() => {
      this.ensureUnsealed();
      return clone(this.state.programs);
    }),
  };

  readonly acquire?: (partition: PrincipalPartition, signal?: AbortSignal) => Promise<void>;
  readonly giveBack?: (partition: PrincipalPartition) => Promise<void>;

  constructor(private readonly backend: RangeStoreBackend) {
    if (backend.acquire) this.acquire = (partition, signal) => backend.acquire!(partition, signal);
    if (backend.giveBack) this.giveBack = (partition) => backend.giveBack!(partition);
  }

  async open(partition: PrincipalPartition): Promise<void> {
    if (typeof partition !== "string" || partition.length === 0) {
      throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "range store partition must be a principal id");
    }
    await this.enqueue(async () => {
      if (this.partition === partition) return;
      if (this.partition !== undefined && this.partition !== partition) await this.backend.close();
      // The partition counts as open only once the carrier opened it: a refused
      // lock leaves the store closed, so a later open of the same partition retries.
      this.partition = undefined;
      const loaded = await this.backend.open(partition);
      this.partition = partition;
      const rawFingerprints = loaded && Object.values(loaded.answers).some((answer) =>
        answer.fingerprint && !/^[0-9a-f]{64}$/.test(answer.fingerprint));
      this.state = normalizeState(loaded);
      // Normalizing a legacy fingerprint changes persisted content. Keep the
      // original baseline until the next successful swap writes those digests.
      this.persisted = rawFingerprints ? loaded : this.state;
    });
  }

  async unseal(): Promise<void> {
    await this.enqueue(async () => {
      this.ensureOpen();
      if (!this.state.sealed) return;
      const next = { ...this.state, sealed: false };
      await this.backend.replace(next, NO_BYTES, this.persisted);
      this.state = this.persisted = next;
    });
  }

  async seal(): Promise<void> {
    await this.enqueue(async () => {
      this.ensureOpen();
      const next = { ...this.state, sealed: true };
      await this.backend.replace(next, NO_BYTES, this.persisted);
      this.state = this.persisted = next;
    });
  }

  async wipe(partition: PrincipalPartition): Promise<void> {
    await this.enqueue(async () => {
      await this.backend.wipe(partition);
      if (this.partition === partition) {
        this.partition = undefined;
        this.state = emptyState();
        this.persisted = undefined;
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
      const { refs: _refs, order: _order, fingerprint: _fingerprint, cursorArg: _cursorArg, data, ...answer } = clone(stored);
      return {
        ...answer,
        // A viewed view-once row reads as absent: the view was its one delivery (LLP 1012 §9).
        ...(data === undefined ? {} : { data: nullOnceMedia(expand(data, this.state.rows, fullyViewed(this.state)), onceAssetIds(this.state.onceColumns, Object.values(this.state.rows))) as Result }),
        ...(watermark === undefined ? {} : { caughtUp: true, watermark: watermark.watermark }),
      };
    });
  }

  async coverage(): Promise<Coverage> {
    return this.read(() => {
      if (this.state.sealed) return { rows: [], ranges: [], absences: [], verdicts: [], watermarks: [], viewed: [], evicted: [] };
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
      // A viewed view-once row is absent to the twin: not a row, and a byId absence (LLP 1012 §9).
      const exhausted = fullyViewed(this.state);
      const viewed = Object.keys(exhausted).map(viewedRef);
      for (const ref of viewed) {
        const absence: Receipt["absences"][number] = [ref.table, "byId", [ref.id]];
        absences.set(canonical(absence), absence);
      }
      let deliveredAt: number | undefined;
      for (const answer of Object.values(this.state.answers)) {
        if (deliveredAt === undefined || answer.deliveredAt > deliveredAt) deliveredAt = answer.deliveredAt;
      }
      return {
        rows: clone(Object.entries(this.state.rows).filter(([key]) => !exhausted[key]).map(([, row]) => row)),
        ranges: [...ranges.values()],
        absences: [...absences.values()],
        verdicts: [...verdicts.values()],
        watermarks: clone(Object.values(this.state.watermarks)),
        viewed,
        evicted: Object.keys(this.state.negative).map(viewedRef),
        ...(this.state.facts === undefined ? {} : { facts: clone(this.state.facts) }),
        ...(this.state.superseded === undefined ? {} : { superseded: clone(this.state.superseded) }),
        ...(deliveredAt === undefined ? {} : { deliveredAt }),
      };
    });
  }

  async commit(swap: StoreSwap): Promise<void> {
    await this.enqueue(async () => {
      this.ensureOpen();
      // Byte payloads are not cloned: they can be megabytes and the swap never mutates them.
      const { bytes, ...rest } = swap;
      const delta: ByteDelta = { put: [], remove: [] };
      // Normalize before deriving answer keys/fingerprints, then normalize the state we publish.
      const normalized = { ...jsonState(rest), ...(bytes === undefined ? {} : { bytes }) };
      const coverage = changesCoverage(normalized);
      // Custody-only swaps never walk or clone retained rows, answers, or programs.
      // The few mutable custody maps are copied before applySwap can edit them.
      const draft = coverage ? clone(this.state) : {
        ...this.state,
        ...jsonState({ outbox: this.state.outbox, grants: this.state.grants,
          overlay: this.state.overlay, overlayMisses: this.state.overlayMisses,
          overlayWatermarks: this.state.overlayWatermarks, overlayNegatives: this.state.overlayNegatives,
          watermarks: this.state.watermarks }),
      };
      const applied = this.applySwap(draft, normalized, delta);
      const next = coverage ? normalizeState(applied) : applied;
      await this.backend.replace(next, delta, this.persisted);
      this.state = this.persisted = next;
    });
  }

  /** The cached rendition for an asset at a width; nothing when unheld, sealed, or the payload is gone. */
  async readBytes(assetId: string, width: number | null): Promise<{ bytes: Uint8Array; type: string } | undefined> {
    return this.read(async () => {
      if (this.state.sealed) return undefined;
      const key = byteKey(assetId, width);
      const entry = this.state.assets[key];
      if (!entry) return undefined;
      const bytes = await this.backend.readBytes?.(key);
      return bytes && bytes.byteLength === entry.size ? { bytes, type: entry.type } : undefined;
    });
  }

  async bytes(): Promise<ByteCacheStatus> {
    return this.read(() => {
      if (this.state.sealed) return { entries: [], totalBytes: 0, viewed: [] };
      const entries = clone(Object.values(this.state.assets));
      return {
        entries,
        totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
        viewed: Object.keys(fullyViewed(this.state)).map(viewedRef),
      };
    });
  }

  /** Held rows whose values carry this asset record: the lease under which its bytes may be cached. */
  async rowsReferencing(assetId: string): Promise<StoredRow[]> {
    return this.read(() => this.state.sealed
      ? []
      : clone(Object.values(this.state.rows).filter((row) => assetIdsIn(row.row).has(assetId))));
  }

  /** The schema columns that own this one-use image. */
  async onceRows(assetId: string): Promise<RowRef[]> {
    return this.read(() => this.state.sealed ? [] : Object.values(this.state.rows)
      .filter(row => onceAssetIds(this.state.onceColumns, [row]).has(assetId))
      .map(({ table, id }) => ({ table, id })));
  }

  async viewedAsset(assetId: string): Promise<boolean> {
    return this.read(() => !this.state.sealed && viewedOnlyAssets(this.state).has(assetId));
  }

  /** The viewed view-once rows; a live frame nulls them exactly as a held answer does. */
  async viewedRows(): Promise<RowRef[]> {
    return this.read(() => this.state.sealed ? [] : Object.keys(fullyViewed(this.state)).map(viewedRef));
  }

  /**
   * LRU read stamps, coalesced per swap: a read stamps the entry in memory and the next
   * swap's `replace` persists it, so a read never rewrites the carrier (LLP 1012 §9).
   */
  async touchBytes(keys: string[]): Promise<void> {
    await this.enqueue(async () => {
      if (this.partition === undefined || this.state.sealed) return;
      const assets = { ...this.state.assets };
      let clock = this.state.clock;
      for (const key of keys) {
        const entry = assets[key];
        if (entry) assets[key] = { ...entry, lastRead: ++clock };
      }
      this.state = { ...this.state, assets, clock };
    });
  }

  async close(): Promise<void> {
    await this.enqueue(async () => {
      this.partition = undefined;
      this.state = emptyState();
      this.persisted = undefined;
      await this.backend.close();
    });
  }

  private applySwap(state: PersistedRangeState, swap: StoreSwap, bytes: ByteDelta): PersistedRangeState {
    if (state.sealed) throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "range store is sealed");
    if (swap.resumeSeq !== undefined && (!Number.isSafeInteger(swap.resumeSeq) || swap.resumeSeq < 0)) {
      throw new TypeError("store resume seq must be a non-negative safe integer");
    }
    if (swap.facts && state.facts && swap.facts.authEpoch !== state.facts.authEpoch) {
      // @ref LLP 1012#4-the-range-store — owner-confirmed reauthentication
      // preserves history, but epoch-bound validators/cursors make the next
      // delivery new even when its data sequence has not changed. The old
      // validator still goes to resume; the next full answer establishes the
      // new epoch's duplicate guard. No guard is relaxed within an epoch.
      state.answers = Object.fromEntries(Object.entries(state.answers).map(([key, answer]) => {
        const { fingerprint: _fingerprint, ...held } = answer;
        return [key, held];
      }));
    }
    const schema = swap.schema ?? (swap.programs && Object.values(swap.programs)[0]?.schema);
    if (schema) state.onceColumns = onceColumns(schema);
    const authoritativeNegatives = changesCoverage(swap) ? this.applyCoverage(state, swap, bytes) : new Map<string, { seq: number; source: "absence" | "tombstone" }>();
    if (swap.facts) state.facts = clone(swap.facts);
    if (swap.superseded === null) delete state.superseded;
    else if (swap.superseded) state.superseded = clone(swap.superseded);

    const previousTail = tailWatermark(Object.values(state.watermarks));
    if (swap.watermark) {
      const key = canonicalAnswerKey(swap.watermark.op, swap.watermark.args);
      // The order is the store's: first recorded, kept across re-marks (LLP 1012 §7's tail chooser).
      const order = state.watermarks[key]?.order ?? ++state.clock;
      state.watermarks[key] = { ...clone(swap.watermark), order };
    }
    const tail = tailWatermark(Object.values(state.watermarks));
    // The outbox, its grants, its write bounds, and the prediction overlay are
    // custody of unsent work: a coverage reset above never touches them.
    for (const intent of swap.outbox?.remove ?? []) {
      delete state.outbox[intent];
      delete state.overlayMisses[intent];
      delete state.overlay[intent];
      delete state.overlayWatermarks[intent];
      delete state.overlayNegatives[intent];
    }
    const committedNow = new Set<string>();
    for (const entry of swap.outbox?.put ?? []) {
      if (typeof entry.intent !== "string" || entry.intent.length === 0) throw new TypeError("outbox entry needs an intent");
      const previous = state.outbox[entry.intent];
      if (entry.state === "committed" && previous?.state !== "committed") committedNow.add(entry.intent);
      const order = previous?.order ?? entry.order ?? ++state.clock;
      state.outbox[entry.intent] = { ...clone(entry), order };
    }
    if (swap.bounds) state.bounds = clone(swap.bounds);
    if (swap.programs) state.programs = clone(swap.programs);
    for (const id of swap.grants?.remove ?? []) {
      delete state.grants[id];
      if (state.currentGrant === id) delete state.currentGrant;
    }
    for (const grant of swap.grants?.put ?? []) state.grants[grant.id] = clone(grant);
    if (swap.grants?.current === null) delete state.currentGrant;
    else if (typeof swap.grants?.current === "string") {
      if (!state.grants[swap.grants.current]) throw new TypeError("current grant must be a held grant");
      state.currentGrant = swap.grants.current;
    }
    for (const intent of swap.overlay?.remove ?? []) {
      delete state.overlay[intent];
      delete state.overlayMisses[intent];
      delete state.overlayWatermarks[intent];
      delete state.overlayNegatives[intent];
    }
    for (const [intent, rows] of Object.entries(swap.overlay?.put ?? {})) {
      state.overlay[intent] = clone(rows);
      delete state.overlayMisses[intent];
      delete state.overlayWatermarks[intent];
      delete state.overlayNegatives[intent];
    }
    // @ref LLP 1012#7-writes-offline — retire on authoritative row/negative
    // evidence, a non-empty page reached by a post-commit next-cursor chain,
    // or two misses (proven forward marks or successful resumes, once per swap).
    // A reset rebases the snapshot at the new drain's current head; opaque cursor names
    // and positions from the former coverage cannot order the new log.
    const answers = Object.keys(state.overlay).some((intent) => state.outbox[intent]?.state === "committed")
      ? Object.values(state.answers) : [];
    const pages = answers.filter((answer) => {
      // Denial can retain the previous complete state for history rendering;
      // that retained content supplies no fresh arrival or continuation proof.
      const nonempty = Array.isArray(answer.data) ? answer.data.length > 0 : collectRefs(answer.data).length > 0;
      return !answer.retained && (answer.state === "complete" || answer.state === "capped") && answer.receipt !== undefined
        && !answer.receipt.ranges.some((range) => (range.evictedIds?.length ?? 0) > 0)
        && nonempty && answer.refs.length > 0 && answer.refs.every((ref) => state.rows[rowKey(ref)] !== undefined);
    });
    const chains = new Map<string, { chain: string[]; reached: Set<string | null | undefined> }>();
    for (const intent of Object.keys(state.overlay)) {
      const entry = state.outbox[intent];
      if (entry === undefined || entry.state === "rejected" || entry.state === "expired") {
        delete state.overlay[intent];
        delete state.overlayMisses[intent];
        delete state.overlayWatermarks[intent];
        delete state.overlayNegatives[intent];
        if (entry) delete entry.predicted;
        continue;
      }
      for (const row of state.overlay[intent]!) {
        const key = rowKey(row);
        const evidence = authoritativeNegatives.get(key);
        if (evidence !== undefined && evidence.seq >= (state.overlayNegatives[intent]?.[key]?.seq ?? -1)) {
          (state.overlayNegatives[intent] ??= {})[key] = evidence;
        }
      }
      if (entry.state !== "committed") continue;
      if (state.overlayWatermarks[intent] == null && tail !== undefined) {
        const snapshot = committedNow.has(intent) && state.overlayWatermarks[intent] !== null ? previousTail ?? tail : tail;
        state.overlayWatermarks[intent] = {
          op: snapshot.op, args: clone(snapshot.args), cursorArg: snapshot.cursorArg ?? "c",
          watermark: snapshot.watermark,
        };
      }
      const committedSeq = (entry.response as { seq?: unknown } | undefined)?.seq;
      if (!Number.isSafeInteger(committedSeq)) {
        delete state.overlay[intent];
        delete state.overlayMisses[intent];
        delete state.overlayWatermarks[intent];
        delete state.overlayNegatives[intent];
        delete entry.predicted;
        continue;
      }
      const overlay = state.overlay[intent]!;
      const seq = Number(committedSeq);
      // A deletion is confirmed by absence, never by a still-present row.
      const predicted = new Set(overlay.filter((row) => !row.removed).map(rowKey));
      const committedWatermark = state.overlayWatermarks[intent] ?? undefined;
      const chainKey = committedWatermark ? canonical({ op: committedWatermark.op, args: committedWatermark.args,
        cursorArg: committedWatermark.cursorArg, watermark: committedWatermark.watermark, seq }) : "";
      if (!chains.has(chainKey)) {
        const chain = committedWatermark ? cursorChain(pages, committedWatermark, seq) : [];
        chains.set(chainKey, { chain, reached: new Set(chain) });
      }
      const { chain, reached } = chains.get(chainKey)!;
      const negative = overlay.some((row) => {
        const evidence = state.overlayNegatives[intent]?.[rowKey(row)];
        return evidence !== undefined && evidence.seq >= seq && (state.rowSeq[rowKey(row)] ?? -1) <= evidence.seq;
      });
      // The closure's pooled halo/rule-input row is authoritative arrival too.
      const arrived = negative || answers.some((answer) => answer.seq >= seq && !answer.retained && answer.state !== "denied"
        && answer.refs.some((ref) => predicted.has(rowKey(ref)) && state.rows[rowKey(ref)] !== undefined))
        || (predicted.size > 0 && committedWatermark !== undefined && pages.some((page) => page.seq >= seq
          && reached.has(pagePosition(page, committedWatermark))));
      const advanced = committedWatermark !== undefined && swap.watermark !== undefined
        && tail !== undefined && canonicalAnswerKey(tail.op, tail.args) === canonicalAnswerKey(swap.watermark.op, swap.watermark.args)
        && advanceOverlay(committedWatermark, tail, chain);
      const moved = advanced || (swap.resumeSeq !== undefined && swap.resumeSeq > seq);
      const misses = arrived ? 0 : (state.overlayMisses[intent] ?? 0)
        + (moved && !committedNow.has(intent) ? 1 : 0);
      if (!arrived && misses < OVERLAY_PATIENCE) {
        if (misses > 0) state.overlayMisses[intent] = misses;
        continue;
      }
      delete state.overlay[intent];
      delete state.overlayMisses[intent];
      delete state.overlayWatermarks[intent];
      delete state.overlayNegatives[intent];
      delete entry.predicted;
    }
    return state;
  }

  private applyCoverage(state: PersistedRangeState, swap: StoreSwap, bytes: ByteDelta) {
    if (swap.resetCoverage) {
      state.rows = {};
      // Sequence guards belong to this generation's coverage, just like rows.
      // A query-only successor can deliver the same row at the same data seq.
      state.rowSeq = {};
      state.negative = {};
      state.overlayNegatives = {};
      state.answers = {};
      state.watermarks = {};
      // These describe coverage, unlike the overlay and its replay entry.
      state.overlayWatermarks = Object.fromEntries(Object.keys(state.overlay).map((intent) => [intent, null]));
      state.overlayMisses = {};
      delete state.facts;
    }
    const explicitEvictions = new Map<string, StoreTombstone>();
    // Keep provenance distinct from hidden-row and extent evictions. These facts
    // join each matching overlay below, even while its response is still queued.
    const authoritativeNegatives = new Map<string, { seq: number; source: "absence" | "tombstone" }>();
    const recordNegative = (ref: StoreTombstone, source: "absence" | "tombstone") => {
      const key = rowKey(ref);
      if ((authoritativeNegatives.get(key)?.seq ?? -1) <= ref.seq) {
        authoritativeNegatives.set(key, { seq: ref.seq, source });
      }
      recordEviction(explicitEvictions, ref);
    };
    const recordAbsences = (answer: Pick<StoredAnswer, "receipt" | "seq">) => {
      for (const [table, index, key] of answer.receipt?.absences ?? []) {
        if (index !== "byId" || key.length !== 1) {
          throw new TypeError("store receipts may evict only a primary byId absence");
        }
        if (typeof key[0] === "string") recordNegative({ table, id: key[0], seq: answer.seq }, "absence");
      }
    };
    for (const key of swap.dropAnswers ?? []) delete state.answers[key];
    for (const refresh of swap.refreshes ?? []) {
      const answer = state.answers[canonicalAnswerKey(refresh.op, refresh.args)];
      if (!answer || refresh.seq < answer.seq) continue;
      if (answer.validator !== undefined && answer.validator !== refresh.validator) {
        throw new TypeError(`conditional validator changed for ${refresh.op}`);
      }
      if (refresh.seq === answer.seq) continue;
      answer.nextSeq ??= answer.seq;
      answer.seq = refresh.seq;
      answer.validator = refresh.validator;
      answer.deliveredAt = refresh.deliveredAt ?? Date.now();
      answer.order = ++state.clock;
      recordAbsences(answer);
    }
    const before = clone(state.answers);
    const freshRanges: Array<{ range: ReceiptRange; seq: number }> = [];
    for (const ref of swap.tombstones ?? []) {
      recordNegative(ref, "tombstone");
    }
    for (const delivery of swap.deliveries ?? []) {
      if (!Number.isSafeInteger(delivery.seq) || delivery.seq < 0) {
        throw new TypeError("store delivery seq must be a non-negative safe integer");
      }
      const key = canonicalAnswerKey(delivery.op, delivery.args);
      const old = before[key];
      const fingerprintPayload = {
        op: delivery.op, args: delivery.args, state: delivery.state, data: delivery.data,
        next: delivery.next, seq: delivery.seq, validator: delivery.validator,
        receipt: delivery.receipt, rows: delivery.rows, reason: delivery.reason, rule: delivery.rule,
      };
      const fingerprint = sha256(canonical(fingerprintPayload));
      if (old && delivery.seq < old.seq) continue;
      if (old && delivery.seq === old.seq && old.fingerprint !== undefined) {
        if (old.fingerprint === fingerprint) continue;
        // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — an
        // unchanged response advances seq, retaining the full delivery's digest.
        // Compare every content field at that original seq, then install this
        // full delivery normally: its rows and next link now have fresh evidence.
        const fullSeq = old.nextSeq ?? old.seq;
        if (fullSeq === delivery.seq
          || old.fingerprint !== sha256(canonical({ ...fingerprintPayload, seq: fullSeq }))) {
          // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — a program that
          // reads the clock re-executes at one durable seq with a different answer; the
          // owner's execution read time orders those deliveries. A later execution installs,
          // an older one is stale and stays out; the same read time with different bytes,
          // or no read time at all, is the equivocation this refuses.
          const later = typeof delivery.readTime === "number" && typeof old.readTime === "number" && delivery.readTime !== old.readTime;
          if (!later) throw new TypeError(`conflicting deliveries for ${delivery.op} at seq ${delivery.seq}`);
          if (delivery.readTime! < old.readTime!) continue;
        }
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
      // Moving a row within an array or into another fresh slot is not a
      // revocation. Array truncation itself has no stable slot; receipts prove holes.
      const present = new Set([...collectRefs(data), ...(delivery.rows ?? [])].map(rowKey));
      const retainedRefs = new Set<string>();
      for (const ref of hidden) {
        if (present.has(rowKey(ref))) continue;
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
      // The pool is the answer's closure: halo and rule-input bodies (the
      // membership a message's read rule probed) are delivered content the
      // twin evaluates over, so an answer keeps every row it was delivered with.
      for (const pooled of delivery.rows ?? []) {
        if (!refs.some((ref) => ref.table === pooled.table && ref.id === pooled.id)) refs.push({ table: pooled.table, id: pooled.id });
      }
      const stored: StoredAnswer = {
        op: delivery.op,
        ...(delivery.cursorArg === undefined ? {} : { cursorArg: delivery.cursorArg }),
        args: clone(delivery.args),
        state: answerState,
        ...(data === undefined ? {} : { data }),
        ...(delivery.next === undefined ? {} : { next: delivery.next }),
        nextSeq: delivery.seq,
        seq: delivery.seq,
        ...(delivery.validator === undefined ? {} : { validator: delivery.validator }),
        ...(delivery.receipt === undefined ? {} : { receipt: clone(delivery.receipt) }),
        deliveredAt: delivery.deliveredAt ?? Date.now(),
        ...(retained ? { retained: true } : {}),
        ...(delivery.reason === undefined ? {} : { reason: delivery.reason }),
        ...(delivery.rule === undefined ? {} : { rule: delivery.rule }),
        ...(delivery.readTime === undefined ? {} : { readTime: delivery.readTime }),
        refs,
        order: ++state.clock,
        fingerprint,
      };
      state.answers[key] = stored;
      freshRanges.push(...(delivery.receipt?.ranges ?? []).map((range) => ({ range, seq: delivery.seq })));
      recordAbsences(stored);
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
          if (range.rowIds.includes(id)) {
            range.rowIds = range.rowIds.filter((rowId) => rowId !== id);
            // The page remembers what it lost: an interior eviction leaves a hole
            // the twin must not paper over with "complete" (LLP 1012 §6).
            range.evictedIds = [...(range.evictedIds ?? []), id];
          }
          if (range.haloId === id) delete range.haloId;
        }
        if (!answer.refs.some((ref) => rowKey(ref) === key)) continue;
        answer.refs = answer.refs.filter((ref) => rowKey(ref) !== key);
        if (answer.data !== undefined) answer.data = purgeAnswerData(answer.data, eviction);
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
    // Every pooled row joins its answer's refs above, so nothing arrives unused;
    // a row leaves here when no answer references it any more — its answer was
    // dropped, or replaced by a delivery whose closure no longer pools it.
    for (const key of Object.keys(state.rows)) if (!referenced.has(key)) {
      delete state.rows[key];
      delete state.rowSeq[key];
    }

    // Bytes join the swap by row lease: whatever left `state.rows` above takes its bytes with it.
    const leased = leasedAssets(Object.values(state.rows), Object.values(state.answers));
    for (const row of Object.values(state.rows)) if (onceRow(state.onceColumns, row)) {
      for (const id of assetIdsIn(row.row)) leased.delete(id);
    }
    const byteDelta = applyByteSwap(state, swap, leased);
    bytes.put.push(...byteDelta.put);
    bytes.remove.push(...byteDelta.remove);

    return authoritativeNegatives;
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
