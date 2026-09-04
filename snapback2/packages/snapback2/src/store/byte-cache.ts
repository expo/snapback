// @ref LLP 1006#9b-bytes-on-the-device-author-ruling-2026-09-04 — bytes are cached under the owning row's lease, or not at all.
// @ref LLP 1012#9-asset-bytes-on-the-device — the ByteCache sits beside the range store and joins its swap; view-once is excluded at view time.

import type { RangeStore, RowRef, StoredRow } from "./range-store.js";

/** One cached rendition: what a component fetched at the width it asked for. */
export interface ByteCacheEntry {
  assetId: string;
  width: number | null;
  size: number;
  type: string;
  /** Logical last-read stamp on the range store's clock; the LRU orders by it. */
  lastRead: number;
}

/** A view-once row that was viewed, with the asset ids it carried at that moment. */
export interface ViewedRecord { at: number; assets: string[] }

export interface ByteCachePut { assetId: string; width: number | null; bytes: Uint8Array; type: string }
export interface ByteSwapRequest { put?: ByteCachePut[]; touch?: string[]; ceiling?: number }

/** What a carrier persists beside the state in the same swap: payloads to write and keys to drop. */
export interface ByteDelta { put: Array<{ key: string; bytes: Uint8Array }>; remove: string[] }

export interface ByteCacheStatus { entries: ByteCacheEntry[]; totalBytes: number; viewed: RowRef[] }
export type ByteCacheOutcome = "cached" | "viewed" | "unleased" | "refused";
export type ViewOncePredicate = (table: string, row: Record<string, unknown>) => boolean;

/** The byte surface the swap engine exposes beside `RangeStore`; only the carriers implement it. */
export interface ByteCarrier {
  readBytes(assetId: string, width: number | null): Promise<{ bytes: Uint8Array; type: string } | undefined>;
  bytes(): Promise<ByteCacheStatus>;
  rowsReferencing(assetId: string): Promise<StoredRow[]>;
  viewedAsset(assetId: string): Promise<boolean>;
  viewedRows(): Promise<RowRef[]>;
  /** LRU read stamps, coalesced: stamped in memory now, persisted by the next swap. */
  touchBytes(keys: string[]): Promise<void>;
  commit(swap: { bytes?: ByteSwapRequest; viewed?: RowRef[] }): Promise<void>;
}

/** The client-facing byte cache: `client.assetCache` when the client has an offline store. */
export interface AssetCache {
  /** The held bytes for an asset at a width, or nothing: never fetched, evicted with its row, viewed, or sealed. */
  get(assetId: string, width: number | null): Promise<Blob | undefined>;
  /** True once a view-once row carrying this asset was viewed on this partition. */
  viewed(assetId: string): Promise<boolean>;
  /** True while a held row carrying this asset is view-once (`offline.viewOnce`) and not yet viewed. */
  viewOnce(assetId: string): Promise<boolean>;
  /** Marks the held view-once rows carrying this asset viewed: what a player calls when playback starts. */
  markViewed(assetId: string): Promise<boolean>;
  status(): Promise<ByteCacheStatus>;
}

export const ASSET_ID = /^s2id-[0-9a-f]{32}-[0-9a-f]{16}$/;
const SESSION_VIEW_LIMIT = 8;

export function byteKey(assetId: string, width: number | null): string {
  return width === null ? assetId : `${assetId}.w${width}`;
}

function rowKey(ref: RowRef): string {
  return `${ref.table}\u0000${ref.id}`;
}

function positive(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** The closed asset record shape (LLP 1006 §1): exactly id, width, height, and duration for video. */
export function assetRecordId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (keys !== "height,id,width" && keys !== "duration,height,id,width") return undefined;
  if (typeof record.id !== "string" || !ASSET_ID.test(record.id)) return undefined;
  if (!positive(record.width) || !positive(record.height)) return undefined;
  if ("duration" in record && !positive(record.duration)) return undefined;
  return record.id;
}

export function assetIdsIn(value: unknown, output = new Set<string>()): Set<string> {
  const id = assetRecordId(value);
  if (id !== undefined) output.add(id);
  else if (Array.isArray(value)) for (const item of value) assetIdsIn(item, output);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) assetIdsIn(item, output);
  }
  return output;
}

/** Assets a held delivery references: through pooled rows and through inline answer data. */
export function leasedAssets(rows: Iterable<StoredRow>, answers: Iterable<{ data?: unknown }>): Set<string> {
  const leased = new Set<string>();
  for (const row of rows) assetIdsIn(row.row, leased);
  for (const answer of answers) if (answer.data !== undefined) assetIdsIn(answer.data, leased);
  return leased;
}

export interface ByteSwapState {
  clock: number;
  rows: Record<string, StoredRow>;
  assets: Record<string, ByteCacheEntry>;
  viewed: Record<string, ViewedRecord>;
}

/**
 * View-once is tracked per row, never per asset id: an asset is refused only while
 * every held row carrying it was viewed. A row that is not viewed keeps its lease,
 * so one shared id never poisons an ordinary row's bytes.
 */
export function viewedOnlyAssets(state: Pick<ByteSwapState, "rows" | "viewed">): Set<string> {
  const viewed = new Set<string>();
  for (const record of Object.values(state.viewed)) for (const id of record.assets) viewed.add(id);
  if (viewed.size === 0) return viewed;
  for (const [key, row] of Object.entries(state.rows)) {
    if (state.viewed[key]) continue;
    for (const id of assetIdsIn(row.row)) viewed.delete(id);
  }
  return viewed;
}

function checkedPut(put: ByteCachePut): void {
  if (!put || typeof put !== "object" || typeof put.assetId !== "string" || !ASSET_ID.test(put.assetId)) {
    throw new TypeError("byte cache put must name an engine-minted asset id");
  }
  if (put.width !== null && !positive(put.width)) throw new TypeError("byte cache put width must be null or a positive integer");
  if (!(put.bytes instanceof Uint8Array)) throw new TypeError("byte cache put bytes must be a Uint8Array");
  if (typeof put.type !== "string") throw new TypeError("byte cache put type must be a string");
}

/**
 * The byte half of one swap, run after the row rules settled `state.rows`: viewed
 * marks, the lease purge, read touches, puts, then the ceiling. Returns what the
 * carrier must write and drop in the same transaction.
 */
export function applyByteSwap(
  state: ByteSwapState,
  swap: { bytes?: ByteSwapRequest; viewed?: RowRef[] },
  leased: Set<string>,
): ByteDelta {
  const delta: ByteDelta = { put: [], remove: [] };
  for (const ref of swap.viewed ?? []) {
    if (!ref || typeof ref.table !== "string" || typeof ref.id !== "string") throw new TypeError("viewed rows must be row references");
    const key = rowKey(ref);
    const assets = new Set(state.viewed[key]?.assets ?? []);
    assetIdsIn(state.rows[key]?.row, assets);
    state.viewed[key] = { at: Date.now(), assets: [...assets] };
  }
  const viewedAssets = viewedOnlyAssets(state);
  for (const [key, entry] of Object.entries(state.assets)) {
    if (leased.has(entry.assetId) && !viewedAssets.has(entry.assetId)) continue;
    delete state.assets[key];
    delta.remove.push(key);
  }
  for (const key of swap.bytes?.touch ?? []) {
    const entry = state.assets[key];
    if (entry) entry.lastRead = ++state.clock;
  }
  const ceiling = swap.bytes?.ceiling ?? Number.POSITIVE_INFINITY;
  if (!(ceiling > 0)) throw new TypeError("byte cache ceiling must be positive");
  for (const put of swap.bytes?.put ?? []) {
    checkedPut(put);
    if (!leased.has(put.assetId) || viewedAssets.has(put.assetId)) continue;
    const size = put.bytes.byteLength;
    if (size === 0 || size > ceiling) continue;
    const key = byteKey(put.assetId, put.width);
    state.assets[key] = { assetId: put.assetId, width: put.width, size, type: put.type, lastRead: ++state.clock };
    delta.put.push({ key, bytes: put.bytes });
  }
  let total = Object.values(state.assets).reduce((sum, entry) => sum + entry.size, 0);
  while (total > ceiling) {
    const [key, victim] = Object.entries(state.assets)
      .reduce((least, item) => item[1].lastRead < least[1].lastRead ? item : least);
    delete state.assets[key];
    delta.remove.push(key);
    total -= victim.size;
  }
  delta.put = delta.put.filter((item) => state.assets[item.key] !== undefined);
  delta.remove = [...new Set(delta.remove)].filter((key) => state.assets[key] === undefined);
  return delta;
}

function isByteCarrier(store: RangeStore): store is RangeStore & ByteCarrier {
  const candidate = store as Partial<ByteCarrier>;
  return typeof candidate.readBytes === "function"
    && typeof candidate.bytes === "function"
    && typeof candidate.rowsReferencing === "function"
    && typeof candidate.viewedAsset === "function"
    && typeof candidate.viewedRows === "function"
    && typeof candidate.touchBytes === "function";
}

function checkedAssetId(assetId: string): string {
  if (typeof assetId !== "string" || !ASSET_ID.test(assetId)) throw new TypeError("asset id must be engine-minted");
  return assetId;
}

/**
 * Bytes a component fetched, kept under the owning row's lease in the same
 * partition as the rows. A store without a byte carrier caches nothing.
 */
export class ByteCache implements AssetCache {
  /**
   * View-once bytes stay renderable inside the instance that viewed them, keyed by
   * the partition that viewed them; nothing here is durable. The runtime forgets it
   * on seal, wipe, partition change, and close, and `get` serves it only under the
   * custody the carrier path applies: this partition, unsealed, the row still held.
   */
  private readonly session = new Map<string, Blob>();
  private partition?: string;

  constructor(
    private readonly store: RangeStore,
    private readonly options: { maxAssetBytes: number; viewOnce?: ViewOncePredicate },
  ) {}

  /** The partition the runtime opened; a change drops every session blob. */
  bind(partition: string | undefined): void {
    if (this.partition !== partition) this.session.clear();
    this.partition = partition;
  }

  /** Drops the session blobs: seal, close, and wipe call this. */
  forget(): void {
    this.session.clear();
  }

  async get(assetId: string, width: number | null): Promise<Blob | undefined> {
    checkedAssetId(assetId);
    const store = this.carrier();
    if (!store) return undefined;
    // `viewedAsset` is false on a sealed partition, so the session is never consulted past a seal.
    if (await store.viewedAsset(assetId)) return this.sessionBlob(assetId);
    const held = await store.readBytes(assetId, width);
    if (!held) return undefined;
    // The touch is the LRU stamp, coalesced into the next swap; a closing partition may refuse it.
    await store.touchBytes([byteKey(assetId, width)]).catch(() => undefined);
    return new Blob([held.bytes as BlobPart], { type: held.type });
  }

  async viewed(assetId: string): Promise<boolean> {
    checkedAssetId(assetId);
    const store = this.carrier();
    return store ? store.viewedAsset(assetId) : false;
  }

  async viewOnce(assetId: string): Promise<boolean> {
    checkedAssetId(assetId);
    const store = this.carrier();
    if (!store) return false;
    const once = await this.viewOnceRows(assetId);
    if (once.length === 0) return false;
    const viewed = new Set((await store.viewedRows()).map(rowKey));
    return once.some((ref) => !viewed.has(rowKey(ref)));
  }

  async markViewed(assetId: string): Promise<boolean> {
    checkedAssetId(assetId);
    const store = this.carrier();
    if (!store) return false;
    const once = await this.viewOnceRows(assetId);
    if (once.length === 0) return false;
    await store.commit({ viewed: once });
    return true;
  }

  /** After a network fetch: cache under the row's lease, or mark the view-once rows viewed and cache nothing. */
  async put(assetId: string, width: number | null, blob: Blob): Promise<ByteCacheOutcome> {
    checkedAssetId(assetId);
    const store = this.carrier();
    if (!store) return "unleased";
    const rows = await store.rowsReferencing(assetId);
    if (rows.length === 0) return "unleased";
    const once = rows
      .filter((row) => this.options.viewOnce?.(row.table, row.row) === true)
      .map(({ table, id }) => ({ table, id }));
    // Per row: the view-once rows are marked viewed; an ordinary row sharing the id still leases the bytes.
    if (once.length === rows.length) {
      try {
        await store.commit({ viewed: once });
      } catch {
        return "refused";
      }
      if (this.session.size >= SESSION_VIEW_LIMIT) this.session.delete(this.session.keys().next().value!);
      this.session.set(this.sessionKey(assetId), blob);
      return "viewed";
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    try {
      await store.commit({
        ...(once.length === 0 ? {} : { viewed: once }),
        bytes: { put: [{ assetId, width, bytes, type: blob.type }], ceiling: this.options.maxAssetBytes },
      });
    } catch {
      return "refused";
    }
    const status = await store.bytes();
    return status.entries.some((entry) => entry.assetId === assetId && entry.width === width) ? "cached" : "refused";
  }

  async status(): Promise<ByteCacheStatus> {
    const store = this.carrier();
    return store ? store.bytes() : { entries: [], totalBytes: 0, viewed: [] };
  }

  /** Nothing is served, marked, or cached without an open partition and a byte carrier. */
  private carrier(): (RangeStore & ByteCarrier) | undefined {
    return this.partition !== undefined && isByteCarrier(this.store) ? this.store : undefined;
  }

  private sessionKey(assetId: string): string {
    return `${this.partition}\u0000${assetId}`;
  }

  /** The session blob, only while the row that was viewed is still held on this partition. */
  private async sessionBlob(assetId: string): Promise<Blob | undefined> {
    const store = this.carrier();
    if (!store) return undefined;
    const key = this.sessionKey(assetId);
    const blob = this.session.get(key);
    if (!blob) return undefined;
    if ((await store.rowsReferencing(assetId)).length > 0) return blob;
    this.session.delete(key);
    return undefined;
  }

  private async viewOnceRows(assetId: string): Promise<RowRef[]> {
    const store = this.carrier();
    if (!store) return [];
    const rows = await store.rowsReferencing(assetId);
    return rows
      .filter((row) => this.options.viewOnce?.(row.table, row.row) === true)
      .map(({ table, id }) => ({ table, id }));
  }
}
