import { cursorArgument } from "../local-cursor.js";
import { applyDeliveryAcknowledgements, applyOutboxSwap, DeliveryAcknowledgementIndex,
  acknowledgementWithoutTail, acknowledgementForReplay, AcknowledgementTailRequired } from "../delivery-acknowledgements.js";
import { admittedMutationTargets } from '../mutation-targets.js';
import { RangeReceipt, preparedDeliveryRanges } from '../../../evaluator/src/range-preparation.js';
import { RowImage, ImageKeys, imageWire, imageRecord, imageRecords, imageState, preparedChanges, preparedProjection } from '../../../evaluator/src/row-image.js';
import { CarrierIndex } from "./carrier-index.js";
import { queryClock } from '../held-program.js';
import { ClockCoverageReset, FullRevalidationRequired, deliveryFacts, FactTransaction, negativeProof, proofSlots,
  checkFactSlots, validateClock, sameClockPlan, factAssertion, answerFactKeys, rowFactKey, factRow, factGuard, answerProof, answerProofs, storedProofs,
  imageSlots, extentSlots, extentMeaning, FACT_FORMAT, type FactProof, type PreparedImage } from './fact-integrity.js';
import { extentContains, rangeMeaningKey, type FactImage, type FactExtent, type ExtentProof, type ExtentCondition } from './extent-facts.js';
import { SwapJournal, StoreChanges, raw, type StoreRevision, type StoreChange, type ChangedRecords } from "./swap-journal.js";
import { changesQueryInputs, outboxOrder, itemEntry, type QueryInputChange } from "./query-inputs.js";
import { compactSuccesses } from "./success-compaction.js";
import { onceColumns, onceRow, onceAssetIds, nullOnceMedia, type OnceColumns } from "./asset-policy.js";
// @ref LLP 1012#4-the-range-store — every carrier persists the same per-principal answer/range model.
// @ref LLP 1012#5-retention-revocation-and-the-fence — eviction is decided once over a complete swap.
// @ref LLP 1012#9-asset-bytes-on-the-device — asset bytes leave in the same commit as the row whose lease held them.

import {
  applyByteSwap, assetIdsIn, byteKey, leasedAssets, viewedOnlyAssets, fullyViewed,
  type ByteCacheEntry, type ByteCacheStatus, type ByteDelta, type ByteSwapRequest, type ViewedRecord,
} from "./byte-cache.js";
import { admitOverlayAuthority, dropOverlay, markDeliveredArrivals, pagePosition, recordOverlayAuthorityEvidence, retireOverlays,
  type OverlayAuthorityEvidence, type OverlayWatermark } from "./overlay-retirement.js";
import { defined, canonical, canonicalAnswerKey, jsonState, queryArgs, storedAnswerKey, storedProgram } from "./canonical.js";
export { canonicalAnswerKey, jsonState } from "./canonical.js";
import { ItemCapture, freshItemSelection } from "../query-items.js";
import { withItemInputs } from "../query-frame.js";
import { isSha256, sha256 } from "../../../evaluator/src/hash.js";
import { compareArrays, totalCompare } from "../../../evaluator/src/value-runtime.js";
import { EvalError } from "../../../evaluator/src/errors.js";
import { DeliveryEnvelopeDecodeError, prepareWireRow, preparedDeliveryRows, tagWireValue, type TaggedValue } from "../offline-protocol.js";
import { asRowRef, collectRefs, mapRowValues, object, purgeAnswerData, restoreRetained, rowKey, hiddenRefs } from "./row-values.js";
import type { InboxConnection, InboxDelta, InboxRow } from "./inbox.js";
import { MaintainedTransitions } from "./maintained-coherence.js";
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
  /** Original endpoint retained across later row changes; local carrier metadata only. */
  heldSuffix?: TaggedValue[];
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
  readTime?: number;
  clockPlanHash?: string;
  /** A conditional cannot refresh this answer until its original full facts are revalidated. */
  needsFactProofs?: true;
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
  /** Cursor argument used when this page was filed, before or after manifest load. */
  cursorArg?: string;
  /** Seq of the full delivery behind the fingerprint and `next`; unchanged cannot renew either. */
  nextSeq?: number;
  rowProofs?: Record<string, string | null>;
  verdictProofs?: Record<string, string>;
  extentProofs?: ExtentProof[];
  clockOnly?: true;
  /** @ref LLP 1018.003#10-retirement-is-a-read-model-decision-dismissal-is-a-write — uncertainty preserves past membership evidence. */
  selection?: { through: number; order: number };
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
  cursor?: string; drain?: import("../types.js").DrainContract;
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

export interface CoverageMetadata {
  watermarks: WatermarkRecord[];
  facts?: CoverageFacts;
  superseded?: CoverageFacts;
}

import type { OutboxEntry, OutboxGrant, OutboxStore } from "./outbox.js";
export type { OutboxState, OutboxTrace, OutboxEntry, OutboxGrant, OutboxStore } from "./outbox.js";

export interface OverlayRow extends StoredRow { removed?: true; fields?: string[] }

export interface StoreDelivery {
  [preparedDeliveryRows]?: StoredRow[];
  [preparedDeliveryRanges]?: ReceiptRange[];
  cursorArg?: string;
  op: string;
  args: unknown;
  state: HeldAnswer["state"];
  data?: unknown;
  next?: string | null;
  seq: number;
  readTime?: number;
  clockPlanHash?: string;
  validator?: string;
  receipt?: Receipt;
  /** Integrity evidence before issuing-program admission; never grants coverage or persists a second receipt. */
  receiptEvidence?: Receipt;
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
    indexes?: Record<string, { components: import("../../../evaluator/src/search-key.js").IndexComponent[]; unique?: boolean }>;
    retain?: RetentionPolicy;
    deliver?: { log: string; receipts: boolean };
  }>;
}

export interface StoreSwap {
  factLimitReset?: string;
  deliveries?: StoreDelivery[];
  refreshes?: StoreRefresh[];
  tombstones?: StoreTombstone[];
  schema?: OfflineSchema;
  watermark?: WatermarkRecord;
  resetCoverage?: boolean;
  /** One validated resume response, including unchanged; never a query re-delivery. */
  resumeSeq?: number;
  dropAnswers?: string[];
  /** Explicitly retire unusable delivery-log candidates by canonical answer key. */
  dropWatermarks?: string[];
  outbox?: { put?: OutboxEntry[]; remove?: string[]; acknowledgementOnly?: true };
  /** Inbox rows to mark or delete in this swap's carrier transaction: a per-key delta, never a store replacement (LLP 1018.004 §2). */
  inbox?: InboxDelta;
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

export { preparedChanges, preparedProjection } from '../../../evaluator/src/row-image.js';
export interface RangeStore {
  [preparedChanges]?(since?: StoreRevision): Promise<StoreChange<PersistedRangeState>>;
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
  /** Small custody read for reconnect and settlement; custom carriers may fall back to `coverage()`. */
  metadata?(): Promise<CoverageMetadata>;
  changes(since?: StoreRevision): Promise<StoreChange<PersistedRangeState>>;
  /** @ref LLP 1018#3-move-one-one-coherent-reactive-client — post-commit effective local query inputs. */
  subscribeInputs(listener: (kind?: QueryInputChange) => void): () => void;
  readonly outbox: OutboxStore;
  /** Stable carrier namespace used with backend identity and principal for tab coordination. */
  readonly coordinationScope?: string;
  /** The writer's inbox read (key order) and a follower's own inbox connection; absent on carriers that cannot follow (LLP 1018.004 §2). */
  inboxRows?(): Promise<InboxRow[]>;
  /** Consumes one inbox row in one carrier transaction; `undefined` once another connection took it. */
  inboxTake?(key: number): Promise<InboxRow | undefined>;
  inbox?(partition: PrincipalPartition): Promise<InboxConnection>;
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
  deliveryAcks: Record<string, import('../delivery-acknowledgements.js').DeliveryAcknowledgement>;
  version: 1;
  sealed: boolean;
  clock: number;
  rows: Record<string, StoredRow>;
  answers: Record<string, StoredAnswer>;
  watermarks: Record<string, WatermarkRecord>;
  outbox: Record<string, OutboxEntry>;
  compactedThrough?: number;
  grants: Record<string, OutboxGrant>;
  currentGrant?: string;
  overlay: Record<string, OverlayRow[]>;
  /** Per committed intent, successful resumes or proven tail advances without its rows. */
  overlayMisses: Record<string, number>;
  /** The commit-time tail snapshot; null after reset until the next drain establishes a new head. */
  overlayWatermarks: Record<string, OverlayWatermark | null>;
  /** Coverage-scoped admission/contradiction evidence for each prediction's ids; cleared on reset. */
  overlayNegatives: Record<string, Record<string, { seq: number; source: "absence" | "tombstone" | "row"; admitted?: true; basis?: "absence" | "row"; admittedSeq?: number; contradictedAt?: number }>>;
  bounds: Record<string, number>;
  programs: Record<string, HeldProgram>;
  facts?: CoverageFacts;
  superseded?: CoverageFacts;
  negative: Record<string, number>;
  rowSeq: Record<string, number>;
  rowFacts: Record<string, number | [seq: number, digest: string]>;
  verdictFacts: Record<string, [seq: number, digest: string]>;
  /** Missing on predecessor carrier records; common admission decides their custody. */
  factFormat?: number;
  factImages: Record<string, FactImage>;
  factExtents: Record<string, FactExtent>;
  extentGuards: Record<string, { id: string; seq: number }>;
  extentNegative: Record<string, { seq: number; active: boolean; cause?: string }>;
  factSlots: number;
  factLimitReset?: string;
  /** The byte-cache index; payloads live beside the state in the carrier, keyed by `byteKey`. */
  assets: Record<string, ByteCacheEntry>;
  viewed: Record<string, ViewedRecord>;
  onceColumns: OnceColumns;
}

export interface RangeStoreBackend {
  readonly [preparedProjection]?: true;
  readonly carrier: string;
  readonly coordinationScope?: string;
  open(partition: PrincipalPartition): Promise<PersistedRangeState | undefined>;
  /** Waits for the partition's writer lock so a later `open` finds it held; carriers without a waiting lock omit it. */
  acquire?(partition: PrincipalPartition, signal?: AbortSignal): Promise<void>;
  /** Releases a lock `acquire` won that no open uses; a queued request of another wait is left alone. */
  giveBack?(partition: PrincipalPartition): Promise<void>;
  /** One carrier transaction: the state, the byte payloads to write and the keys to drop, and any inbox rows to mark or delete. */
  replace(state: PersistedRangeState, bytes: ByteDelta, previous?: PersistedRangeState, changed?: ChangedRecords, inbox?: InboxDelta): Promise<void>;
  readBytes?(key: string): Promise<Uint8Array | undefined>;
  inboxRows?(): Promise<InboxRow[]>; inboxTake?(key: number): Promise<InboxRow | undefined>; inbox?(partition: PrincipalPartition): Promise<InboxConnection>;
  wipe(partition: PrincipalPartition): Promise<void>;
  close(): Promise<void> | void;
}

const NO_BYTES: ByteDelta = { put: [], remove: [] };

export function emptyState(): PersistedRangeState {
  return {
    version: 1, sealed: false, clock: 0, rows: {}, answers: {}, watermarks: {}, outbox: {}, deliveryAcks: {}, rowFacts: {}, verdictFacts: {}, factSlots: 0,
    factFormat: FACT_FORMAT, factImages: {}, factExtents: {}, extentGuards: {}, extentNegative: {},
    grants: {}, overlay: {}, overlayMisses: {}, overlayWatermarks: {}, overlayNegatives: {}, bounds: {}, programs: {},
    negative: {}, rowSeq: {}, assets: {}, viewed: {}, onceColumns: {},
  };
}

function clone<T>(value: T): T {
  return value === undefined ? value : jsonState(raw(value));
}

function recordEviction(evictions: Map<string, StoreTombstone>, eviction: StoreTombstone): void {
  const key = rowKey(eviction);
  if ((evictions.get(key)?.seq ?? -1) <= eviction.seq) evictions.set(key, eviction);
}

const absenceKey = ([table, index, values]: Receipt["absences"][number]): string | undefined =>
  index === "byId" && typeof values[0] === "string" ? rowKey({ table, id: values[0] }) : undefined;

export function rowReference(table: string, id: string): { $row: RowRef } {
  return { $row: { table, id } };
}

function expand(value: unknown, rows: Record<string, StoredRow>, viewed?: Record<string, unknown>): unknown {
  return mapRowValues(value, (ref) => viewed?.[rowKey(ref)] ? null : clone(imageWire(rows[rowKey(ref)]?.row ?? null)));
}

function normalizeState(value: PersistedRangeState | undefined): PersistedRangeState {
  if (!value) return emptyState();
  for (const answer of Object.values(value.answers ?? {})) validateClock(answer);
  value = jsonState(value);
  if (value.version !== 1 || !object(value.rows) || !object(value.answers)) {
    throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "unsupported range store format");
  }
  // Older snapshots used the canonical delivery itself as the fingerprint.
  // Hash that value before any subsequent persistence can retain its row bodies.
  for (const answer of Object.values(value.answers)) {
    if (answer.fingerprint && !isSha256(answer.fingerprint)) answer.fingerprint = sha256(answer.fingerprint);
  }
  const { factGuards: legacyGuards, ...current } = value as PersistedRangeState & { factGuards?: object };
  const factFormat = value.factFormat ?? (Object.keys(legacyGuards ?? {}).length || Object.keys(value.rowFacts ?? {}).length
    || Object.keys(value.verdictFacts ?? {}).length || Object.values(value.answers).some(a => a.readTime !== undefined) ? 0 : FACT_FORMAT);
  // Empty-state custody defines the collection defaults for every carrier.
  // Rows/answers were required above; never repair their absence implicitly.
  for (const [key, initial] of Object.entries(emptyState())) {
    if (key !== "rows" && key !== "answers" && object(initial))
      (current as unknown as Record<string, unknown>)[key] ??= initial;
  }
  return {
    ...current, factFormat,
    factSlots: factFormat !== FACT_FORMAT ? 0 : (['rowFacts', 'verdictFacts', 'extentGuards', 'extentNegative'] as const)
      .reduce((sum, key) => sum + Object.keys(current[key]).length, 0)
      + Object.values(current.factImages).reduce((sum,image) => sum + imageSlots(image.keys),0)
      + Object.values(current.factExtents).reduce((sum, extent) => sum + extentSlots(extent.condition), 0)
      + Object.values(current.answers).reduce((sum, a) => sum + proofSlots(a), 0),
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
    || canonicalAnswerKey(a.op, a.args, a.cursorArg).localeCompare(canonicalAnswerKey(b.op, b.args, b.cursorArg)))[0];
}

function changesCoverage(swap: StoreSwap): boolean {
  return !!(swap.resetCoverage || swap.deliveries?.length || swap.refreshes?.length || swap.tombstones?.length
    || swap.dropAnswers?.length || swap.dropWatermarks?.length || swap.bytes || swap.viewed?.length || swap.schema || swap.programs
    || swap.outbox?.put?.some((entry) => entry.state === "committed"));
}

/** Shared swap engine; carrier subclasses only provide the atomic replace. */
export class PersistentRangeStore implements RangeStore {
  private state = emptyState();
  private acknowledgementIndex?: DeliveryAcknowledgementIndex;
  private referenceIndex?: CarrierIndex;
  private referenceSchema?: OfflineSchema;
  private persisted?: PersistedRangeState;
  private readonly updates = new StoreChanges<PersistedRangeState>();
  private readonly inputListeners = new Set<(kind?: QueryInputChange) => void>();
  private partition?: PrincipalPartition;
  private tail: Promise<void> = Promise.resolve();
  private readonly touchedBytes = new Set<string>();

  readonly outbox: OutboxStore = {
    pendingDeliveryAcks: async limit => {
      await this.tail;
      return this.partition === undefined || this.state.sealed ? { remaining: 0 } : this.acknowledgements().read(this.state.deliveryAcks, limit);
    },
    compactedThrough: () => this.read(() => this.state.sealed ? 0 : this.state.compactedThrough ?? 0),
    all: () => this.readOutbox(state => outboxOrder(state.outbox)),
    itemEntries: () => this.read(() => { this.ensureUnsealed(); return outboxOrder(this.state.outbox).map(itemEntry); }),
    queued: () => this.readOutbox(state => outboxOrder(state.outbox, true)),
    queuedInfo: () => this.readOutbox(state => outboxOrder(state.outbox, true)
      .map(({ intent, state, grant, createdAt, reason, refusal }) => ({ intent, state, grant, createdAt, reason, refusal }))),
    replayBatch: () => this.readOutbox(state => {
      const queued = outboxOrder(state.outbox, true), batch: OutboxEntry[] = [];
      for (const entry of queued) {
        if (batch.length === 16 || !acknowledgementForReplay(state, entry)) break;
        batch.push(entry);
      }
      return batch.length ? batch : queued.slice(0, 1);
    }),
    targets: (op, args, ids) => this.readOutbox(state => admittedMutationTargets(storedProgram(state), op, args, ids)),
    acknowledgementWithoutTail: entry => this.readOutbox(state => acknowledgementWithoutTail(state, entry)),
    get: (intent) => this.readOutbox(state => state.outbox[intent]),
    put: (entry) => this.commit({ outbox: { put: [entry] } }),
    remove: (intent) => this.commit({ outbox: { remove: [intent] } }),
    grant: () => this.readOutbox(state => state.currentGrant === undefined ? undefined : state.grants[state.currentGrant]),
    grants: () => this.readOutbox(state => Object.values(state.grants)),
    bounds: () => this.readOutbox(state => state.bounds),
    overlay: () => this.readOutbox(state => state.overlay),
    programs: () => this.readOutbox(state => state.programs),
  };

  /** Every outbox view shares the same admission and detached-value boundary. */
  private readOutbox<T>(select: (state: PersistedRangeState) => T): Promise<T> {
    // @ref LLP 1018.008.007.002#6-reduce-the-remaining-preparation-and-publication-work — committed state has no journal proxies; detach once without recursively unwrapping its ledger.
    return this.read(() => { this.ensureUnsealed(); const value = select(this.state); return value === undefined ? value : jsonState(value); });
  }
  private acknowledgements(): DeliveryAcknowledgementIndex {
    return this.acknowledgementIndex ??= new DeliveryAcknowledgementIndex(this.state.deliveryAcks);
  }

  readonly acquire?: (partition: PrincipalPartition, signal?: AbortSignal) => Promise<void>;
  readonly giveBack?: (partition: PrincipalPartition) => Promise<void>;
  readonly coordinationScope?: string;

  constructor(private readonly backend: RangeStoreBackend) {
    this.coordinationScope = backend.coordinationScope;
    if (backend.acquire) this.acquire = (partition, signal) => backend.acquire!(partition, signal);
    if (backend.giveBack) this.giveBack = (partition) => backend.giveBack!(partition);
    if (backend.inboxRows) this.inboxRows = () => this.read(() => { this.ensureOpen(); return backend.inboxRows!(); });
    if (backend.inboxTake) this.inboxTake = (key) => this.read(() => { this.ensureOpen(); return backend.inboxTake!(key); });
    if (backend.inbox) this.inbox = (partition) => backend.inbox!(partition);
  }
  readonly inboxRows?: () => Promise<InboxRow[]>; readonly inboxTake?: (key: number) => Promise<InboxRow | undefined>;
  readonly inbox?: (partition: PrincipalPartition) => Promise<InboxConnection>;

  async open(partition: PrincipalPartition): Promise<void> {
    if (typeof partition !== "string" || partition.length === 0) {
      throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "partition must be a principal id");
    }
    await this.enqueue(async () => {
      if (this.partition === partition) return;
      if (this.partition !== undefined && this.partition !== partition) await this.backend.close();
      this.referenceIndex = undefined; this.referenceSchema = undefined;
      this.acknowledgementIndex = undefined;
      this.partition = undefined;
      try {
      const loaded = await this.backend.open(partition);
      this.partition = partition;
      const rawFingerprints = loaded && Object.values(loaded.answers).some((answer) =>
        answer.fingerprint && !isSha256(answer.fingerprint));
      this.state = normalizeState(loaded);
      if (this.state.factFormat !== FACT_FORMAT) {
        // Experimental predecessor holes used indistinguishable global guards.
        // Reset their coverage atomically; never reinterpret or discard an individual guard.
        const bytes: ByteDelta = { put: [], remove: [] };
        const sealed = this.state.sealed; this.state.sealed = false;
        try { this.applySwap(this.state, { resetCoverage: true, superseded: this.state.facts }, bytes); }
        finally { this.state.sealed = sealed; }
        await this.replace(this.state, bytes, loaded);
      }
      this.updates.reset(this.state, rawFingerprints ? loaded : undefined); this.referenceIndex = undefined;
      this.touchedBytes.clear();
      // Normalizing a legacy fingerprint changes persisted content. Keep the
      // original baseline until the next successful swap writes those digests.
      this.persisted = rawFingerprints ? loaded : this.state;
      } catch (error) {
        this.partition = undefined; this.referenceIndex = undefined;
        try { await this.backend.close(); } catch { /* Preserve the failed admission, not a secondary close error. */ }
        throw error;
      }
    });
  }

  unseal(): Promise<void> { return this.setSealed(false); }
  seal(): Promise<void> { return this.setSealed(true); }

  private setSealed(sealed: boolean): Promise<void> {
    return this.enqueue(async () => {
      this.ensureOpen();
      if (!sealed && !this.state.sealed) return;
      const next = { ...this.state, sealed };
      await this.replace(next, NO_BYTES, this.persisted);
      this.state = this.persisted = next;
      this.touchedBytes.clear();
      this.updates.reset();
    });
  }

  async wipe(partition: PrincipalPartition): Promise<void> {
    await this.enqueue(async () => {
      await this.backend.wipe(partition);
      if (this.partition === partition) {
        this.release();
      }
    });
  }

  async answer<Result = unknown>(op: string, args: unknown): Promise<HeldAnswer<Result> | undefined> {
    return this.read(() => {
      if (this.state.sealed) return undefined;
      const key = storedAnswerKey(this.state, op, args);
      const stored = this.state.answers[key];
      if (!stored) return undefined;
      const watermark = this.state.watermarks[key];
      const media = (this.referenceIndex ??= new CarrierIndex(this.state, this.referenceSchema)).assets;
      const { refs: _refs, order: _order, fingerprint: _fingerprint, cursorArg: _cursorArg, rowProofs: _rows, verdictProofs: _verdicts, extentProofs: _extents, clockOnly: _clockOnly, selection: _selection, ...visible } = stored;
      const { data, validator, ...answer } = clone(visible), scrubbed = new Map<string, { id: string }>();
      const projected = data === undefined ? undefined : nullOnceMedia(expand(data, this.state.rows, media.exhausted), media.once, scrubbed) as Result;
      const capture = new ItemCapture(this.state, op, args); capture.references(stored.data, projected);
      return withItemInputs(defined({ ...answer,
        // @ref LLP 1006#2a1-one-use-image-delivery-clique-f3-2026-09-05 — a locally hidden descriptor cannot satisfy a conditional owner read; force the full authorized live frame.
        ...(validator === undefined || scrubbed.size > 0 ? {} : { validator }),
        // A viewed view-once row reads as absent: the view was its one delivery (LLP 1012 §9).
        data: projected,
        caughtUp: watermark === undefined ? undefined : true, watermark: watermark?.watermark,
      }), capture.inputs(scrubbed));
    });
  }

  async coverage(): Promise<Coverage> {
    return this.read(() => {
      if (this.state.sealed) return { rows: [], ranges: [], absences: [], verdicts: [], watermarks: [], viewed: [], evicted: [] };
      const ranges = new Map<string, ReceiptRange>();
      const absences = new Map<string, Receipt["absences"][number]>();
      const verdicts = new Map<string, unknown>();
      let deliveredAt: number | undefined;
      for (const answer of Object.values(this.state.answers)) {
        if (deliveredAt === undefined || answer.deliveredAt > deliveredAt) deliveredAt = answer.deliveredAt;
        for (const range of answer.receipt?.ranges ?? []) {
          ranges.set(canonical([range.site, range.prefix,
            range.order, range.after, range.before, range.gt, range.gte, range.lt, range.lte,
          ]), clone(range));
        }
        for (const absence of answer.receipt?.absences ?? []) absences.set(canonical(absence), clone(absence));
        for (const verdict of answer.receipt?.verdicts ?? []) verdicts.set(canonical(verdict), clone(verdict));
      }
      // A viewed view-once row is absent to the twin: not a row, and a byId absence (LLP 1012 §9).
      const exhausted = fullyViewed(this.state);
      const viewed = Object.keys(exhausted).map(key => factRow(key)!);
      for (const ref of viewed) {
        const absence: Receipt["absences"][number] = [ref.table, "byId", [ref.id]];
        absences.set(canonical(absence), absence);
      }
      return defined({
        rows: clone(Object.entries(this.state.rows).flatMap(([key, row]) => exhausted[key] ? [] : [imageRecord(row)])),
        ranges: [...ranges.values()],
        absences: [...absences.values()],
        verdicts: [...verdicts.values()],
        watermarks: clone(Object.values(this.state.watermarks)),
        viewed,
        evicted: [...new Set([...Object.keys(this.state.negative), ...Object.keys(this.state.extentNegative)
          .filter(key => this.state.extentNegative[key].active)])].map(key => factRow(key)!),
        facts: clone(this.state.facts),
        superseded: clone(this.state.superseded),
        deliveredAt,
      });
    });
  }

  metadata(): Promise<CoverageMetadata> {
    return this.read(() => clone(this.state.sealed ? { watermarks: [] } : {
      watermarks: Object.values(this.state.watermarks), facts: this.state.facts, superseded: this.state.superseded,
    }));
  }

  changes(since?: StoreRevision): Promise<StoreChange<PersistedRangeState>> {
    return this.read(() => { this.ensureUnsealed(); const change = this.updates.read(this.state,since);
      if (change.snapshot) change.snapshot = imageState(change.snapshot);
      if (change.records?.rows) change.records.rows = imageRecords(change.records.rows as Record<string,StoredRow>);
      return jsonState(change); });
  }

  subscribeInputs(listener: (kind?: QueryInputChange) => void): () => void {
    this.inputListeners.add(listener);
    return () => { this.inputListeners.delete(listener); };
  }
  [preparedChanges](since?: StoreRevision): Promise<StoreChange<PersistedRangeState>> {
    return this.read(() => {
      this.ensureUnsealed();
      const program = storedProgram(this.state);
      const change = this.updates.read(this.state,since);
      // Cold preparation only, or the bounded changed-row set; raw pre-schema custody remains opaque until requested.
      const rows = change.snapshot?.rows ?? change.records?.rows as Record<string, StoredRow> | undefined;
      const prepared: Array<[string,StoredRow]> = [];
      const keys: Array<[FactImage,ImageKeys]> = [];
      if (program && rows) for (const [key,row] of Object.entries(rows)) {
        const proof = this.state.factImages[`${row.table}\0${factAssertion(row)}`];
        const known = proof?.keys && ImageKeys.restore(proof.keys);
        const image = prepareWireRow(program.schema,row.table,row.row,program.schemaHash,known);
        if (known) keys.push([proof,known]);
        const current = { ...row,row: image as unknown as Record<string, unknown> };
        prepared.push([key,current]);
      }
      const answers: Array<[string,StoredAnswer]> = [];
      const index = this.referenceIndex ?? new CarrierIndex(this.state,this.referenceSchema,(key,answer) => { answers.push([key,answer]); });
      for (const [key,answer] of answers) {
        this.state.answers[key] = answer;
        if (change.snapshot) change.snapshot.answers[key] = answer;
        else if (change.records?.answers && Object.hasOwn(change.records.answers,key)) change.records.answers[key] = answer;
      }
      this.referenceIndex = index;
      for (const [proof,image] of keys) proof.keys = image;
      for (const [key,current] of prepared) { this.state.rows[key] = current; rows![key] = current; }
      return change;
    });
  }
  private replace(state: PersistedRangeState, bytes: ByteDelta, previous?: PersistedRangeState, changed?: ChangedRecords, inbox?: InboxDelta): Promise<void> {
    return this.backend.replace(this.backend[preparedProjection] ? state : jsonState(imageState(state)),bytes,
      previous && (this.backend[preparedProjection] ? previous : jsonState(imageState(previous))),changed, inbox);
  }

  async commit(swap: StoreSwap): Promise<void> {
    await this.enqueue(async () => {
      this.ensureOpen();
      // Byte payloads are not cloned: they can be megabytes and the swap never mutates them.
      const { bytes, inbox, ...rest } = swap;
      for (const delivery of swap.deliveries ?? []) validateClock(delivery);
      const delta: ByteDelta = { put: [], remove: [] };
      // Own and normalize metadata once before deriving answer keys/fingerprints or publishing it.
      const normalized = { ...jsonState(rest), ...(bytes === undefined ? {} : { bytes }) };
      const ackEntries = normalized.outbox?.acknowledgementOnly ? normalized.outbox.put : undefined;
      const ackQueued = ackEntries?.map(entry => this.state.outbox[entry.intent]);
      if (normalized.outbox?.acknowledgementOnly && (!ackEntries?.length
        || new Set(ackEntries.map(entry => entry.intent)).size !== ackEntries.length
        || normalized.outbox.remove?.length || !ackEntries.every(entry => acknowledgementWithoutTail(this.state, entry))))
        throw new AcknowledgementTailRequired();
      for (let i = 0; i < (swap.deliveries?.length ?? 0); i++) {
        const images = swap.deliveries![i][preparedDeliveryRows];
        if (images) {
          if (!images.every(r => RowImage.is(r.row)) || canonical(images) !== canonical(normalized.deliveries![i].rows))
            throw new TypeError('prepared/wire row pool mismatch');
          normalized.deliveries![i].rows = images.map(r => ({ ...r }));
        }
        const ranges = swap.deliveries![i][preparedDeliveryRanges], receipt = normalized.deliveries![i].receipt;
        if (ranges) {
          if (!receipt || !ranges.every(r => RangeReceipt.get(r,true)) || canonical(ranges) !== canonical(receipt.ranges))
            throw new TypeError('prepared/wire ranges mismatch');
          receipt.ranges = ranges;
        }
      }
      const journal = new SwapJournal(this.state), priorIndex = this.referenceIndex, priorSchema = this.referenceSchema;
      const acknowledgements = this.acknowledgements();
      try {
        const removed = this.applySwap(journal.draft, normalized, delta);
        if (ackEntries?.some((entry, index) => !acknowledgementWithoutTail(journal.draft, entry, ackQueued![index]))) throw new AcknowledgementTailRequired();
        const compactedAliases = compactSuccesses(journal.draft, this.referenceIndex && !journal.changed.get('*')?.has('answers')
          ? key => new Set([...(this.referenceIndex!.proofOwners.get(key) ?? []), ...(journal.changed.get('answers') ?? [])]) : undefined,
          priorIndex?.successCandidates(journal.draft, journal.changed));
        const removedAcks = applyDeliveryAcknowledgements(journal.draft, normalized, this.partition!, acknowledgements, journal.changed);
        const combinedInbox = compactedAliases.length ? { ...inbox, remove: [...(inbox?.remove ?? []), ...compactedAliases] } : inbox;
        this.updates.prepare(journal.changed);
        await this.replace(this.state, delta, undefined, journal.changed, combinedInbox);
        this.touchedBytes.clear();
        for (const [table, count] of removed) console.info(JSON.stringify({ snapback2: "adopt", table, removed: count }));
        if (removedAcks) console.info("delivery acknowledgements removed: receipts removed");
      } catch (error) { journal.rollback(); this.referenceIndex = priorIndex; this.referenceSchema = priorSchema; throw error; }
      this.persisted = this.state;
      try {
        if (journal.changed.get('*')?.has('deliveryAcks')) this.acknowledgementIndex = undefined;
        else acknowledgements.update(this.state.deliveryAcks, journal.changed.get('deliveryAcks') ?? []);
      } catch { this.acknowledgementIndex = undefined; } // Committed state is never rolled back for a derived index.
      this.updates.publish(this.state, journal.changed);
      if (['answers', 'programs', 'onceColumns', 'rows', 'viewed', 'outbox'].some(k => journal.changed.get('*')?.has(k))) this.referenceIndex = undefined;
      else { try { this.referenceIndex?.update(this.state, journal.changed, normalized.schema); }
        catch (error) { this.referenceIndex = undefined; throw error; } }

      const inputChange = changesQueryInputs(journal.changed, this.state);
      if (inputChange) for (const listener of [...this.inputListeners]) {
        try { listener(inputChange); } catch { /* store durability cannot depend on an observer */ }
      }

    });
  }

  /** The cached rendition for an asset at a width; nothing when unheld, sealed, or the payload is gone. */
  async readBytes(assetId: string, width: number | null): Promise<{ bytes: Uint8Array; type: string } | undefined> {
    return this.enqueue(async () => {
      this.ensureOpen();
      if (this.state.sealed) return undefined;
      const key = byteKey(assetId, width);
      const entry = this.state.assets[key];
      if (!entry) return undefined;
      const bytes = await this.backend.readBytes?.(key);
      return bytes && bytes.byteLength === entry.size ? { bytes, type: entry.type } : undefined;
    });
  }

  bytes(): Promise<ByteCacheStatus> {
    return this.read(() => {
      if (this.state.sealed) return { entries: [], totalBytes: 0, viewed: [] };
      const entries = clone(Object.values(this.state.assets));
      return {
        entries,
        totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
        viewed: Object.keys(fullyViewed(this.state)).map(key => factRow(key)!),
      };
    });
  }

  /** Held rows whose values carry this asset record: the lease under which its bytes may be cached. */
  rowsReferencing(assetId: string): Promise<StoredRow[]> {
    return this.read(() => this.state.sealed
      ? []
      : clone(Object.values(this.state.rows).filter((row) => assetIdsIn(row.row).has(assetId)).map(imageRecord)));
  }

  /** The schema columns that own this one-use image. */
  onceRows(assetId: string): Promise<RowRef[]> {
    return this.read(() => this.state.sealed ? [] : Object.values(this.state.rows)
      .filter(row => onceAssetIds(this.state.onceColumns, [row]).has(assetId))
      .map(({ table, id }) => ({ table, id })));
  }

  viewedAsset(assetId: string): Promise<boolean> {
    return this.read(() => !this.state.sealed && viewedOnlyAssets(this.state).has(assetId));
  }

  /** The viewed view-once rows; a live frame nulls them exactly as a held answer does. */
  viewedRows(): Promise<RowRef[]> {
    return this.read(() => this.state.sealed ? [] : Object.keys(fullyViewed(this.state)).map(key => factRow(key)!));
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
        if (entry) { assets[key] = { ...entry, lastRead: ++clock }; this.touchedBytes.add(key); }
      }
      this.state = { ...this.state, assets, clock };
      this.updates.dirty('assets', keys); this.updates.dirty('*', ['clock']);
    });
  }

  async close(): Promise<void> {
    await this.enqueue(async () => {
      let primary: unknown;
      try {
        if (this.partition !== undefined && this.touchedBytes.size > 0) {
          const changed: ChangedRecords = new Map([['assets', new Set(this.touchedBytes)], ['*', new Set(['clock'])]]);
          await this.replace(this.state, NO_BYTES, this.persisted, changed);
          this.persisted = this.state; this.touchedBytes.clear();
        }
      } catch (error) { primary = error; }
      this.release();
      try { await this.backend.close(); }
      catch (error) {
        if (primary !== undefined) throw new AggregateError([primary, error], 'byte touch flush and carrier close both failed');
        throw error; }
      if (primary !== undefined) throw primary;
    });
  }
  private release(): void {
    this.acknowledgementIndex = undefined;
    this.partition = undefined; this.state = emptyState(); this.persisted = undefined;
    this.referenceIndex = undefined; this.referenceSchema = undefined; this.updates.reset();
    this.touchedBytes.clear();
  }
  private applySwap(state: PersistedRangeState, swap: StoreSwap, bytes: ByteDelta) {
    const removed = new Map<string, number>();
    if (state.sealed) throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "range store is sealed");
    if (swap.resetCoverage && swap.factLimitReset !== undefined && swap.factLimitReset === state.factLimitReset)
      throw new OfflineStoreFailure('E_OFFLINE_CARRIER', 'fact custody still exceeds its slot budget after revalidation',
        'keep queued writes; reduce retained coverage before retrying');
    if (swap.resumeSeq !== undefined && (!Number.isSafeInteger(swap.resumeSeq) || swap.resumeSeq < 0)) {
      throw new TypeError("store resume seq must be a non-negative safe integer");
    }
    if (swap.resetCoverage || (swap.facts && state.facts && swap.facts.authEpoch !== state.facts.authEpoch)) {
      // @ref LLP 1012#4-the-range-store — owner-confirmed reauthentication
      // preserves history, but epoch-bound validators/cursors make the next
      // delivery new even when its data sequence has not changed. The old
      // validator still goes to resume; the next full answer establishes the
      // new epoch's duplicate guard. No guard is relaxed within an epoch.
      if (!swap.resetCoverage) for (const answer of Object.values(state.answers)) {
        for (const field of ['fingerprint', 'rowProofs', 'verdictProofs', 'extentProofs', 'needsFactProofs'] as const) delete answer[field];
      }
      state.rowFacts = {}; state.verdictFacts = {};
      state.factImages = {}; state.factExtents = {}; state.extentGuards = {}; state.factSlots = Object.keys(state.extentNegative).length;
      this.referenceIndex = undefined;
    }
    const generation = swap.facts?.generation ?? state.facts?.generation;
    const custody = swap.programs && (generation ? swap.programs[generation] : Object.values(swap.programs)[0]);
    const program = storedProgram(state, swap);
    const answerKey = (op: string, args: unknown, cursor = cursorArgument(program?.programs[op])) => canonicalAnswerKey(op, args, cursor);
    if (custody && !swap.resetCoverage) for (const answer of Object.values(state.answers)) {
      const op = custody.programs[answer.op]; if (!op) continue;
      const clock = queryClock(op);
      if (clock && answer.readTime === undefined) throw new ClockCoverageReset();
      if (answer.readTime !== undefined && (!clock || answer.clockPlanHash !== op.planHash)) throw new TypeError('held clock identity mismatch');
    }
    if (swap.factLimitReset !== undefined) state.factLimitReset = swap.factLimitReset;
    const schema = swap.schema ?? (swap.programs && Object.values(swap.programs)[0]?.schema);
    if (schema) { const columns = onceColumns(schema); if (canonical(columns) !== canonical(state.onceColumns)) state.onceColumns = columns; }
    const clockOnly = new Set<string>(), deliveredIds = new Set<string>();
    const authoritativeEvidence = changesCoverage(swap) ? this.applyCoverage(state, swap, bytes, clockOnly, deliveredIds, program, answerKey, removed) : new Map<string, OverlayAuthorityEvidence>();
    // These incoming metadata values belong to commit's private normalized swap.
    if (swap.facts && canonical(state.facts) !== canonical(swap.facts)) state.facts = swap.facts;
    if (swap.superseded === null) delete state.superseded;
    else if (swap.superseded) state.superseded = swap.superseded;
    for (const key of swap.dropWatermarks ?? []) delete state.watermarks[key];
    const previousTail = tailWatermark(Object.values(state.watermarks));
    const clockMark = swap.watermark && (swap.deliveries ?? []).some(d => clockOnly.has(answerKey(d.op, d.args))
      && (answerKey(d.op, d.args) === answerKey(swap.watermark!.op, swap.watermark!.args)
        || pagePosition(d, { ...swap.watermark!, cursorArg: swap.watermark!.cursorArg ?? 'c' }) !== undefined));
    if (swap.watermark && !clockMark) {
      const key = answerKey(swap.watermark.op, swap.watermark.args, swap.watermark.cursorArg);
      // The order is the store's: first recorded, kept across re-marks (LLP 1012 §7's tail chooser).
      const order = state.watermarks[key]?.order ?? ++state.clock;
      state.watermarks[key] = { ...swap.watermark, order };
    }
    const tail = tailWatermark(Object.values(state.watermarks));
    const committedNow = applyOutboxSwap(state, swap);
    markDeliveredArrivals(state, deliveredIds);
    for (const intent of swap.overlay?.remove ?? []) dropOverlay(state, intent);
    for (const [intent, rows] of Object.entries(swap.overlay?.put ?? {})) {
      state.overlay[intent] = rows;
      for (const field of ['overlayMisses', 'overlayWatermarks', 'overlayNegatives'] as const) delete state[field][intent];
      admitOverlayAuthority(state, intent, rows, key => {
        const index = this.referenceIndex ??= new CarrierIndex(state, this.referenceSchema);
        return index.absences.get(key) ?? [];
      });
    }
    retireOverlays(state, swap, authoritativeEvidence, clockOnly, previousTail, tail, committedNow, answerKey, clone);
    return removed;
  }

  private applyCoverage(state: PersistedRangeState, swap: StoreSwap, bytes: ByteDelta, clockOnly: Set<string>, deliveredIds: Set<string>,
    program: HeldProgram | undefined, answerKey: (op: string, args: unknown, cursor?: string) => string, removed: Map<string, number>) {
    const schema = swap.schema ?? (swap.resetCoverage ? storedProgram(state) : program)?.schema ?? this.referenceSchema;
    const dropRow = (key: string) => { delete state.rows[key]; delete state.rowSeq[key]; };
    const retains = (table: string) => schema?.tables?.[table]?.retain === 'delivered-history';
    const adopted = swap.programs && Object.values(swap.programs)[0];
    const validate = adopted && adopted.schemaHash !== storedProgram(state)?.schemaHash;
    const kept = swap.resetCoverage ? Object.create(null) : undefined;
    if (swap.resetCoverage) {
      // @ref LLP 1012#coverage-reset-amendment — custody survives reset; incompatible images leave at adoption.
      for (const [table, declaration] of Object.entries(schema?.tables ?? {})) {
        if (!retains(table) || !declaration.deliver) continue;
        for (const [key, record] of Object.entries(state.rows)) {
          const event = imageRecord(record);
          if (event.table !== declaration.deliver.log) continue;
          kept[key] = true;
          if (typeof event.row.row !== 'string') continue;
          const target = rowKey({ table, id: event.row.row });
          if (event.row.kind === 'removed' || event.row.kind === 'delivered') kept[target] = kept[target] !== false && event.row.kind === 'delivered';
        }
      }
      // Sequence guards belong to this generation's coverage.
      // A query-only successor can deliver the same row at the same data seq.
      for (const field of ['rowSeq', 'negative', 'extentNegative', 'overlayNegatives', 'answers', 'watermarks', 'overlayMisses'] as const) state[field] = {};
      state.factFormat = FACT_FORMAT; state.factSlots = 0;
      // These describe coverage, unlike the overlay and its replay entry.
      state.overlayWatermarks = Object.fromEntries(Object.keys(state.overlay).map((intent) => [intent, null]));
      delete state.facts;
    }
    if (swap.resetCoverage || validate) for (const [key, { table, row }] of Object.entries(state.rows)) {
      if (swap.resetCoverage && !kept[key]) { dropRow(key); continue; }
      if (validate && retains(table)) try { prepareWireRow(adopted.schema, table, row, adopted.schemaHash); }
      catch (error) {
        if (!(error instanceof DeliveryEnvelopeDecodeError) && !(error instanceof EvalError && ['E_INPUT', 'E_SCHEMA'].includes(error.code))) throw error;
        dropRow(key);
        removed.set(table, (removed.get(table) ?? 0) + 1);
      }
    }
    if (swap.resetCoverage || swap.programs || (swap.schema && !this.referenceSchema)) this.referenceIndex = undefined;
    this.referenceSchema = swap.schema ?? this.referenceSchema;
    // Coverage and issuing-program custody may arrive in the same atomic swap.
    // This shallow root view shares row dictionaries and sees the proposed identities before publication.
    const base = raw(state);
    const index = this.referenceIndex ??= new CarrierIndex({ ...base,
      programs: swap.programs ?? base.programs, facts: swap.facts ?? base.facts }, this.referenceSchema, (key,answer) => { state.answers[key] = answer; });
    const maintained = new MaintainedTransitions(schema);
    const authorityEvictions = new Map<string, StoreTombstone>();
    for (const eviction of maintained.committed(swap.outbox?.put ?? [], state.overlay, swap.overlay?.put)) {
      recordEviction(authorityEvictions, eviction);
    }
    const changedAnswers = new Set<string>();
    const before = new Map<string, StoredAnswer | undefined>();
    const remember = (key: string) => {
      const answer = state.answers[key];
      if (answer && !answer.selection) answer.selection = freshItemSelection(answer);
      if (!before.has(key)) before.set(key, raw(answer)); changedAnswers.add(key);
    };
    const candidates = (key: string, absent = false) => new Set([...(absent ? index.absences : index.references).get(key) ?? [], ...changedAnswers]);
    const enrollmentKeys = new Map<string, Set<string>>();
    const enroll = (key: string) => {
      const owners = factRow(key) ? new Set([...candidates(key), ...candidates(key, true)])
        : new Set([...(index.verdicts.get(key) ?? []), ...changedAnswers]);
      for (const owner of owners) {
        const answer = state.answers[owner]; if (!answer || answerProof(answer,key) !== undefined) continue;
        if (!enrollmentKeys.has(owner)) enrollmentKeys.set(owner, answerFactKeys(answer));
        if (!enrollmentKeys.get(owner)!.has(key)) continue;
        remember(owner); answer.needsFactProofs = true;
      }
    };
    const explicitEvictions = new Map<string, StoreTombstone>();
    const extentEvictions = new Map<string, StoreTombstone>();
    const evictionConditions = new Map<string, ExtentCondition[]>();
    const obsoleteImages = new Map<string, number>();
    const recordHole = (ref: StoreTombstone, condition: ExtentCondition) => {
      const key = rowKey(ref), old = extentEvictions.get(key)?.seq ?? -1;
      if (old > ref.seq) return;
      evictionConditions.set(key, [...(old === ref.seq ? evictionConditions.get(key) ?? [] : []), condition]);
      recordEviction(extentEvictions, ref);
    };
    // Keep provenance distinct from hidden-row and extent evictions. These facts
    // join each matching overlay below, even while its response is still queued.
    const authoritativeEvidence = new Map<string, OverlayAuthorityEvidence>();
    const recordNegative = (ref: StoreTombstone, source: "absence" | "tombstone") => {
      const key = rowKey(ref);
      recordOverlayAuthorityEvidence(authoritativeEvidence, key, { seq: ref.seq, source });
      recordEviction(explicitEvictions, ref);
    };
    const recordAbsences = (answer: Pick<StoredAnswer, "receipt" | "seq">) => {
      for (const [table, index, key] of answer.receipt?.absences ?? []) {
        if (index !== "byId" || key.length !== 1) {
          throw new TypeError("eviction requires a primary byId absence");
        }
        if (typeof key[0] === "string") recordNegative({ table, id: key[0], seq: answer.seq }, "absence");
      }
    };
    for (const key of swap.dropAnswers ?? []) { remember(key); delete state.answers[key]; }
    // Whole-swap preflight enrolls applicable timed facts before conditionals.
    // Its frontier follows delivery order so a genuinely stale frame is ignored.
    const integrity = new FactTransaction(state, enroll, index, (key, digest, seq) => {
      for (const owner of new Set([...(index.proofOwners.get(key) ?? []), ...changedAnswers])) {
        const answer = state.answers[owner];
        if (answer?.seq === seq && answerProof(answer,key) === digest) throw new FullRevalidationRequired(answer.op, answer.args);
      }
      throw new ClockCoverageReset();
    }, owner => before.has(owner) ? before.get(owner) : state.answers[owner], condition => {
      for (const owner of new Set([...index.matchingKey(rangeMeaningKey(condition))].map(r => r.owner).concat([...changedAnswers]))) {
        const answer = state.answers[owner]; if (!answer || answer.extentProofs?.length) continue;
        if (answer.receipt?.ranges.some(range => index.rangeKey(range,answer.op) === rangeMeaningKey(condition))) { remember(owner); answer.needsFactProofs = true; }
      }
    });
    type Frame = { owner: string; seq: number; delivery?: StoreDelivery; preflight?: boolean;
      images?: PreparedImage[]; pool?: Map<string, PreparedImage>; facts?: FactProof[];
      answer?: StoredAnswer; conditions?: ExtentCondition[] };
    const frames: Frame[] = [];
    const frameImages = (frame: Frame) => frame.images ??= (frame.delivery!.rows ?? []).map(row => integrity.prepare(row));
    const frameFacts = (frame: Frame) => frame.facts ??= deliveryFacts(frame.delivery!,frameImages(frame));
    const frontier = new Map<string, StoreDelivery | StoredAnswer>();
    for (const delivery of swap.deliveries ?? []) {
      const frame: Frame = { delivery,owner: answerKey(delivery.op, delivery.args, delivery.cursorArg),seq: delivery.seq };
      frames.push(frame);
      const key = frame.owner, old = frontier.get(key) ?? state.answers[key];
      frame.preflight = !(old && (delivery.seq < old.seq || (delivery.seq === old.seq && old.readTime !== undefined
        && delivery.readTime !== undefined && old.clockPlanHash === delivery.clockPlanHash && delivery.readTime < old.readTime)));
      if (!frame.preflight) continue;
      frontier.set(key, delivery);
      frame.images = integrity.register(delivery.rows ?? [],delivery.seq);
      if (delivery.readTime !== undefined) integrity.check(frameFacts(frame), delivery.seq, true);
    }
    // Applied frames remain distinct from preflight eligibility: refreshes run first,
    // and exact replays may skip full application without dropping incoming facts.
    const applied: Frame[] = [];
    for (const refresh of swap.refreshes ?? []) {
      const key = answerKey(refresh.op, refresh.args); remember(key);
      const answer = state.answers[key];
      if (!answer || refresh.seq < answer.seq) continue;
      if (answer.validator !== undefined && answer.validator !== refresh.validator) {
        throw new TypeError(`conditional validator changed for ${refresh.op}`);
      }
      if (answer.needsFactProofs) throw new FullRevalidationRequired(answer.op, answer.args);
      const frame: Frame = { owner: key,seq: refresh.seq,answer: raw(answer),facts: answerProofs(answer),
        conditions: (answer.extentProofs ?? []).map(id => state.factExtents[id].condition) };
      integrity.check(frame.facts!,refresh.seq);
      for (const condition of frame.conditions!) integrity.close(condition,refresh.seq);
      applied.push(frame);
      if (refresh.seq === answer.seq) continue;
      answer.nextSeq ??= answer.seq;
      answer.seq = refresh.seq;
      answer.validator = refresh.validator;
      answer.deliveredAt = refresh.deliveredAt ?? Date.now();
      answer.order = ++state.clock;
      answer.selection = freshItemSelection(answer) ?? answer.selection;
      recordAbsences(answer);
    }
    // Only touched images survive this swap's membership checks. A later movement
    // cannot erase an earlier contradiction; a same-seq move out is not a deletion.
    const images = new Map<string, Array<{ seq: number; image: PreparedImage }>>();
    const versions = (key: string) => {
      let found = images.get(key);
      if (!found) {
        found = state.rows[key] ? [{ seq: state.rowSeq[key],image: integrity.prepare(raw(state.rows[key])) }] : [];
        images.set(key,found);
      }
      return found;
    };
    const imageAt = (key: string, seq: number) => {
      let found: { seq: number; image: PreparedImage } | undefined;
      for (const image of versions(key)) if (image.seq <= seq && (!found || image.seq >= found.seq)) found = image;
      return found?.image;
    };
    for (const ref of swap.tombstones ?? []) recordNegative(ref, "tombstone");
    for (const frame of frames) {
      const delivery = frame.delivery!;
      if (!Number.isSafeInteger(delivery.seq) || delivery.seq < 0) {
        throw new TypeError("store delivery seq must be a non-negative safe integer");
      }
      const key = frame.owner;
      remember(key);
      const old = raw(state.answers[key]);
      const fingerprintPayload = {
        op: delivery.op, args: queryArgs(delivery.args, delivery.cursorArg ?? cursorArgument(program?.programs[delivery.op])), state: delivery.state, data: delivery.data,
        next: delivery.next, seq: delivery.seq, validator: delivery.validator,
        receipt: delivery.receiptEvidence ?? delivery.receipt, rows: delivery.rows, reason: delivery.reason, rule: delivery.rule,
        ...(delivery.readTime === undefined ? {} : { readTime: delivery.readTime, clockPlanHash: delivery.clockPlanHash }),
      };
      const fingerprint = sha256(canonical(fingerprintPayload));
      if (old && delivery.seq < old.seq) continue;
      const timedChange = sameClockPlan(old, delivery) && old.seq === delivery.seq && delivery.readTime !== old.readTime;
      if (timedChange) {
        clockOnly.add(key);
        if (delivery.readTime! < old.readTime!) continue;
      }
      if (old && delivery.seq === old.seq && old.fingerprint !== undefined) {
        // An identical pre-program envelope may now install its checked receipt.
        // Its integrity digest is independent of this local admission transition.
        if (old.fingerprint === fingerprint) {
          if (!old.needsFactProofs && (old.receipt !== undefined || delivery.receipt === undefined)) continue;
        } else {
          // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — an
          // unchanged response advances seq, retaining the full delivery's digest.
          // Compare every content field at that original seq, then install this
          // full delivery normally: its rows and next link now have fresh evidence.
          const fullSeq = old.nextSeq ?? old.seq;
          if (!timedChange && (fullSeq === delivery.seq || old.fingerprint !== sha256(canonical({ ...fingerprintPayload, seq: fullSeq })))) {
            throw new TypeError(`conflicting deliveries for ${delivery.op} at seq ${delivery.seq}`);
          }
        }
      }
      const proofs = integrity.check(frameFacts(frame), delivery.seq, delivery.readTime !== undefined);
      for (const [offset,row] of (delivery.rows ?? []).entries()) {
        const image = frameImages(frame)[offset];
        if (!row.table || !row.id || !object(row.row)) {
          throw new TypeError("malformed delivery row");
        }
        const storageKey = rowKey(row);
        versions(storageKey).push({ seq: delivery.seq, image });
        const blocked = integrity.blocking(image, delivery.seq);
        if (blocked) {
          // This authentic newer image supersedes the old body even when a later
          // extent already excludes it. A newer compatible outside image survives.
          obsoleteImages.set(storageKey, Math.max(obsoleteImages.get(storageKey) ?? -1, delivery.seq));
          recordHole({ table: row.table, id: row.id, seq: blocked.seq }, blocked.condition); continue;
        }
        if ((state.negative[storageKey] ?? -1) >= delivery.seq) {
          recordEviction(explicitEvictions, { table: row.table, id: row.id, seq: state.negative[storageKey]! });
          continue;
        }
        const priorRow = state.rows[storageKey] && raw(state.rows[storageKey]);
        const rowChanged = !priorRow || !(RowImage.is(row.row) && priorRow.row === row.row)
          && canonical(priorRow.row) !== canonical(row.row);
        if (state.rowSeq[storageKey] === delivery.seq && rowChanged) {
          throw new TypeError(`conflicting row ${row.table}/${row.id} at seq ${delivery.seq}`);
        }
        if ((state.rowSeq[storageKey] ?? -1) > delivery.seq) continue;
        if (rowChanged) maintained.transition(priorRow, row, delivery.seq);
        if (state.extentNegative[storageKey]) state.extentNegative[storageKey].active = false;
        // Incoming records belong to the private normalized swap; prepared
        // images are immutable. Future nested writes use the journal's COW.
        state.rows[storageKey] = row;
        state.rowSeq[storageKey] = delivery.seq;
        recordOverlayAuthorityEvidence(authoritativeEvidence, storageKey, { seq: delivery.seq, source: "row" });
        deliveredIds.add(row.id);
      }
      let data = delivery.data;
      let answerState = delivery.state;
      let retained = false;
      const hidden = timedChange ? [] : delivery.state === "denied" && old
        ? old.refs
        : old ? hiddenRefs(old.data, data) : [];
      // Moving a row within an array or into another fresh slot is not a
      // revocation. Array truncation itself has no stable slot; receipts prove holes.
      const present = new Set([...collectRefs(data), ...(delivery.rows ?? [])].map(rowKey));
      const retainedRefs = new Set<string>();
      for (const ref of hidden) {
        if (present.has(rowKey(ref))) continue;
        if (retains(ref.table)) {
          retainedRefs.add(rowKey(ref));
          retained = true;
        } else recordEviction(explicitEvictions, { ...ref, seq: delivery.seq });
      }
      // @ref LLP 1012#6-reads-offline — retained row bodies do not prove a complete result.
      if (delivery.state === "denied" && old && retainedRefs.size > 0) {
        data = clone(old.data);
        answerState = "partial";
      } else if (old && retainedRefs.size > 0) {
        data = restoreRetained(old.data, data, retainedRefs, clone);
        answerState = "partial";
      }
      // Preserve the delivered pool order and retain every same-pool halo/rule input.
      const refs = (delivery.rows ?? []).map(({ table, id }) => ({ table, id }));
      const referenced = new Set(refs.map(rowKey));
      const add = (ref: { table: string; id: string }) => { const key = rowKey(ref); if (!referenced.has(key)) { refs.push(ref); referenced.add(key); } };
      for (const ref of collectRefs(data)) add(ref);
      for (const range of delivery.receipt?.ranges ?? [])
        for (const id of [...range.rowIds, ...(range.haloId ? [range.haloId] : [])]) add({ table: range.table, id });
      frame.pool = new Map(frameImages(frame).map(image => [image.key,image]));
      const stored: StoredAnswer = defined({
        op: delivery.op,
        cursorArg: delivery.cursorArg,
        args: delivery.args,
        state: answerState,
        data,
        next: delivery.next,
        nextSeq: delivery.seq,
        seq: delivery.seq,
        readTime: delivery.readTime, clockPlanHash: delivery.readTime === undefined ? undefined : delivery.clockPlanHash,
        ...storedProofs(proofs),
        clockOnly: clockOnly.has(key) ? true : undefined,
        validator: delivery.validator,
        receipt: delivery.receipt === undefined ? undefined : index.receipt(delivery.receipt, frame.pool, delivery.op),
        deliveredAt: delivery.deliveredAt ?? Date.now(),
        retained: retained ? true : undefined,
        reason: retained ? "retained" : delivery.reason,
        rule: delivery.rule,
        refs,
        order: ++state.clock,
        fingerprint,
      });
      stored.selection = freshItemSelection(stored) ?? old?.selection;
      state.answers[key] = stored;
      frame.answer = stored; applied.push(frame);
      enrollmentKeys.delete(key);
      recordAbsences(stored);
    }

    for (const frame of applied) {
      if (!frame.delivery || !index.schemaReady) continue; // Opaque custody grants no typed extent authority.
      frame.conditions = (frame.answer!.receipt?.ranges ?? []).flatMap(range => {
        const condition = index.extent(range,frame.delivery!.op,frame.pool!); return condition ? [condition] : [];
      });
    }
    const holeProofs = new Map<string, Map<string, string>>();
    const extentProofs = new Map<string, Set<ExtentProof>>();
    const enrolledRows = new Set<string>();
    for (const frame of applied) for (const condition of frame.conditions ?? []) {
      const { seq,owner } = frame, answer = frame.answer!;
      const proof = integrity.close(condition,seq), present = new Set(condition.present);
      for (const id of present) enrolledRows.add(rowFactKey(condition.table,id));
      if (state.answers[owner]?.fingerprint === answer.fingerprint) {
        const proofs = extentProofs.get(owner) ?? new Set(answer.extentProofs ?? []); proofs.add(proof); extentProofs.set(owner,proofs);
      }
      const masked = new Set(index.maskTargets(extentMeaning(condition)));
      const candidates = new Set([...index.live.matching(condition)].map(fact => rowKey({ table: fact.table,id: fact.rowId })));
      for (const key of masked) candidates.add(key);
      // Only this bounded transaction's incoming versions supplement maintained seeks.
      for (const [key,versions] of images) if (versions[0]?.image.row.table === condition.table) candidates.add(key);
      for (const key of candidates) {
        const ref = factRow(key)!; if (present.has(ref.id)) continue;
        const image = imageAt(key,seq);
        if ((image && extentContains(image.keys!,condition)) || (!image && masked.has(key))) recordHole({ ...ref,seq },condition);
      }
    }

    // First enrollment by an inferred hole also constrains earlier ordinary FULL
    // assertions in this swap. Replay immutable incoming proofs, never pooled bodies.
    for (const frame of applied) {
      const { owner,seq } = frame, facts = frame.facts!, fingerprint = frame.answer!.fingerprint;
      const proofs = [...integrity.check(facts, seq), ...integrity.check(facts.filter(([key]) => enrolledRows.has(key)),seq,true)], answer = state.answers[owner];
      if ((proofs.length || extentProofs.has(owner)) && answer?.fingerprint === fingerprint) {
        const retained = holeProofs.get(owner) ?? new Map(answerProofs(answer));
        for (const [key, digest] of proofs) retained.set(key, digest);
        holeProofs.set(owner, retained);
        if (answer.needsFactProofs && [...answerFactKeys(answer)].every(key => factGuard(state,key) === undefined || retained.has(key))) delete answer.needsFactProofs;
      }
    }
    for (const ref of swap.tombstones ?? []) integrity.check([negativeProof(ref.table, ref.id)], ref.seq);
    for (const [owner, proofs] of holeProofs) Object.assign(state.answers[owner],storedProofs(proofs));
    for (const [owner, proofs] of extentProofs) state.answers[owner].extentProofs = [...proofs];
    // Hole enrollment can discover an ordinary conditional's missing custody
    // after its provisional update above. Refuse the whole journaled swap.
    for (const refresh of swap.refreshes ?? []) {
      const answer = state.answers[answerKey(refresh.op, refresh.args)];
      if (answer?.needsFactProofs) throw new FullRevalidationRequired(answer.op, answer.args);
    }
    // A primary deletion is a source transition too. Extent holes are not: a
    // row leaving local coverage does not prove that the database aggregate
    // changed.
    for (const [key, eviction] of explicitEvictions) {
      const held = state.rows[key];
      maintained.transition(held && (state.rowSeq[key] ?? -1) <= eviction.seq && (state.negative[key] ?? -1) <= eviction.seq
        ? raw(held) : undefined, undefined, eviction.seq, eviction);
    }
    for (const eviction of maintained.invalidations()) recordEviction(authorityEvictions, eviction);
    // The inverse arrival order is also possible: a maintained target can be
    // refreshed by one mounted query before this named query receives the
    // source rows from its own coherent delivery. Keep the old query result as
    // an explicitly unusable partial until that owner speaks again. Its data
    // remains held for authorized-history fallback; the partial marker keeps a
    // cold/offline reevaluation from assembling fields from different commits.
    for (const [key, seq] of maintained.targetChanges) {
      const table = factRow(key)!.table;
      const owners = new Set([...(index.references.get(key) ?? []), ...(index.absences.get(key) ?? [])]);
      for (const owner of changedAnswers) if (state.answers[owner]?.refs.some((ref) => rowKey(ref) === key)) owners.add(owner);
      const targetImage = imageAt(key, seq)?.keys;
      if (targetImage) {
        // Closed extents are indexed by their exact typed key space. Seek only
        // ranges that contain this maintained row; an unrelated group on the
        // same target table never enters the candidate set.
        for (const extent of index.closed.matching(table, targetImage, 0)) {
          for (const held of index.matchingKey(rangeMeaningKey(extent.condition))) owners.add(held.owner);
        }
        // A range installed earlier in this same swap is not in the persistent
        // reverse index yet. Only changed owners need this bounded supplement.
        for (const owner of changedAnswers) {
          const answer = state.answers[owner];
          for (const range of answer?.receipt?.ranges ?? []) {
            if (range.table !== table) continue;
            const condition = index.extent(range, answer!.op, new Map());
            if (condition && extentContains(targetImage, condition)) owners.add(owner);
          }
        }
      }
      for (const owner of owners) {
        const answer = state.answers[owner];
        if (!answer || answer.seq >= seq || answer.state === "denied") continue;
        remember(owner);
        answer.state = "partial";
        answer.reason = "maintained-coherence";
        delete answer.next;
      }
    }
    const appliedEvictions = new Set<string>();
    for (const [key, eviction, kind] of [...[...explicitEvictions].map(([key, value]) => [key, value, "global"] as const),
      ...[...extentEvictions].map(([key, value]) => [key, value, "extent"] as const),
      ...[...authorityEvictions].map(([key, value]) => [key, value, "authority"] as const)]) {
      if ((state.negative[key] ?? -1) > eviction.seq) continue;
      if ((state.rowSeq[key] ?? -1) > eviction.seq) continue;
      // A target row or primary absence from this same/later database image is
      // the authority we were waiting for; never erase it because its source
      // sibling happened to be applied first in this swap.
      if (kind === "authority" && ((state.rowSeq[key] ?? -1) >= eviction.seq
        || (explicitEvictions.get(key)?.seq ?? -1) >= eviction.seq)) continue;
      if (kind === "global") {
        state.negative[key] = eviction.seq;
        if ((state.extentNegative[key]?.seq ?? Infinity) <= eviction.seq) { delete state.extentNegative[key]; state.factSlots--; }
      }
      else if (kind === "extent") {
        if ((state.negative[key] ?? -1) >= eviction.seq) continue;
        if (state.rows[key] && (state.rowSeq[key] ?? -1) > (obsoleteImages.get(key) ?? -1)) {
          const image = integrity.prepare(raw(state.rows[key]));
          if (!evictionConditions.get(key)!.some(condition => extentContains(image.keys!,condition))) continue;
        }
        if ((state.extentNegative[key]?.seq ?? -1) > eviction.seq) continue;
        if (state.extentNegative[key] === undefined) state.factSlots++;
        state.extentNegative[key] = { seq: eviction.seq, active: true, cause: extentMeaning(evictionConditions.get(key)![0]) };
      }
      else {
        // This is missing authority, not proof of absence. Remove any older
        // point/extent masks so neither the old body nor an old negative can
        // satisfy the maintained read while its target catches up.
        if ((state.negative[key] ?? -1) <= eviction.seq) delete state.negative[key];
        if ((state.extentNegative[key]?.seq ?? Infinity) <= eviction.seq) { delete state.extentNegative[key]; state.factSlots--; }
      }
      appliedEvictions.add(key);
      dropRow(key);
      for (const answerKey of kind === "authority"
        ? new Set([...candidates(key), ...candidates(key, true), ...(index.rangeTables.get(eviction.table) ?? []), ...changedAnswers])
        : candidates(key)) {
        const answer = state.answers[answerKey]; if (!answer) continue;
        remember(answerKey);
        let affected = answer.refs.some(ref => rowKey(ref) === key);
        const receipt = kind === "authority" && answer.receipt;
        if (receipt) {
          let length = receipt.absences.length;
          receipt.absences = receipt.absences.filter((absence) => absenceKey(absence) !== key);
          if (receipt.absences.length !== length) affected = true;
          length = receipt.ranges.length;
          receipt.ranges = receipt.ranges.filter((range) => range.table !== eviction.table
            || maintained.disjoint(key, RangeReceipt.get(range, true)!));
          if (receipt.ranges.length !== length) {
            answer.extentProofs = answer.extentProofs?.filter((id) => state.factExtents[id]?.condition.table !== eviction.table);
            affected = true;
          }
        }
        if (!affected) continue;
        for (let i = 0; i < (answer.receipt?.ranges.length ?? 0); i++) {
          const range = answer.receipt!.ranges[i];
          if (range.table !== eviction.table) continue;
          const id = eviction.id, changes: Partial<ReceiptRange> = {};
          if (range.rowIds.includes(id)) {
            changes.rowIds = range.rowIds.filter(rowId => rowId !== id);
            changes.evictedIds = [...(range.evictedIds ?? []),id];
          }
          if (range.haloId === id) changes.haloId = undefined;
          if (Object.keys(changes).length) {
            const changed = RangeReceipt.change(raw(range),changes);
            // Keep absent halo spelling in format5; undefined is omitted at every backend boundary.
            answer.receipt!.ranges[i] = changed;
          }
        }
        answer.refs = answer.refs.filter((ref) => rowKey(ref) !== key);
        if (answer.data !== undefined) answer.data = purgeAnswerData(answer.data, eviction);
        if (answer.state !== "denied") {
          answer.state = "partial";
          answer.reason = answer.reason === "maintained-coherence"
            ? answer.reason
            : kind === "authority" ? "missing-authority" : "evicted";
          if (!answer.retained || kind === "authority") delete answer.next;
        }
      }
    }

    const positive = new Set((swap.deliveries ?? []).flatMap(d => (d.rows ?? []).map(rowKey)));
    for (const key of positive) for (const answerKey of candidates(key, true)) {
      const answer = state.answers[answerKey]; if (!answer?.receipt) continue;
      const absences = answer.receipt.absences.filter((absence) => {
        const storageKey = absenceKey(absence);
        return storageKey !== key || (state.rowSeq[key] ?? -1) < 0 || appliedEvictions.has(key);
      });
      if (absences.length !== answer.receipt.absences.length) { remember(answerKey); answer.receipt.absences = absences; }
    }
    const maybeUnused = new Set<string>();
    for (const key of changedAnswers) for (const r of before.get(key)?.refs ?? []) maybeUnused.add(rowKey(r));
    for (const key of maybeUnused) {
      const used = [...(index.references.get(key) ?? [])].some(owner => !changedAnswers.has(owner))
        || [...changedAnswers].some(owner => state.answers[owner]?.refs.some(r => rowKey(r) === key));
      if (!used) dropRow(key);
    }

    // Bytes join the swap by row lease: whatever left `state.rows` above takes its bytes with it.
    if (Object.keys(state.assets).length || swap.bytes || swap.viewed?.length || swap.viewedAssets?.length) {
    const leased = leasedAssets(Object.values(state.rows), Object.values(state.answers));
    for (const row of Object.values(state.rows)) if (onceRow(state.onceColumns, row)) {
      for (const id of assetIdsIn(row.row)) leased.delete(id);
    }
    const byteDelta = applyByteSwap(state, swap, leased);
    bytes.put.push(...byteDelta.put);
    bytes.remove.push(...byteDelta.remove);
    }

    integrity.finish(before);
    for (const key of changedAnswers) state.factSlots += proofSlots(state.answers[key]) - proofSlots(before.get(key));
    checkFactSlots(state);
    return authoritativeEvidence;
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

  private async read<T>(action: () => T | Promise<T>): Promise<T> {
    await this.tail;
    this.ensureOpen();
    return action();
  }
}
