import type { Change } from "./web.ts";

// Fixed caps bound a one-row update independently of accumulated store size.
// Once a bucket spills, new keys stay per-row; no growing shard directory or
// overflow scan is needed to locate them. Existing packed keys remain packed.
export const BUCKET_ENTRIES = 512;
export const BUCKET_BYTES = 256 * 1024;
export interface Bucket extends Change { spill?: boolean }
export const packedStore = (s: string) => s === "r" || s === "s" || s === "b";
export function bucket(s: string, key: string): string {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return `${s}:${hash & 255}`;
}
export const unpack = (change: Change): Change[] => change.s === "$format" ? [] : change.s === "$bucket"
  ? (JSON.parse(change.v!) as [string, string][]).map(([k, v]) => ({ s: change.k.slice(0, 1), k, v })) : [change];
const encoder = new TextEncoder();
const pairBytes = (key: string, value: string) => encoder.encode(JSON.stringify([key, value])).byteLength;

/** Runs in the caller's strict readwrite transaction. No ordinary update
 * reads, parses or rewrites another bucket or an overflow row. */
export function writeBucket(store: IDBObjectStore, key: string, saved: Bucket | undefined, delta: Change[]): void {
  const s = key.slice(0, 1);
  const rows = new Map<string, string>(saved ? JSON.parse(saved.v!) : []);
  const sizes = new Map([...rows].map(([k, v]) => [k, pairBytes(k, v)]));
  let bytes = 2 + [...sizes.values()].reduce((a, b) => a + b, 0) + Math.max(0, rows.size - 1);
  let spill = saved?.spill ?? false, dirty = !saved;
  for (const change of delta) {
    const prior = sizes.get(change.k);
    if (prior !== undefined) {
      bytes -= prior + (rows.size > 1 ? 1 : 0);
      rows.delete(change.k); sizes.delete(change.k); dirty = true;
    }
    if (change.v === null) {
      if (prior === undefined && spill) store.delete([s, change.k]);
      continue;
    }
    const size = pairBytes(change.k, change.v), nextBytes = bytes + size + (rows.size ? 1 : 0);
    if ((prior !== undefined || !spill) && rows.size < BUCKET_ENTRIES && nextBytes <= BUCKET_BYTES) {
      rows.set(change.k, change.v); sizes.set(change.k, size); bytes = nextBytes; dirty = true;
    } else {
      if (!spill) { spill = true; dirty = true; }
      store.put(change);
    }
  }
  if (!dirty) return;
  if (rows.size || spill) store.put({ s: "$bucket", k: key, v: JSON.stringify([...rows]), ...(spill ? { spill: true } : {}) });
  else store.delete(["$bucket", key]);
}

/** Format-1 packing was unbounded. Repartition once while loading the full
 * device, before any metered mutation runs. Metadata and rows commit together. */
export function upgradeBuckets(db: IDBDatabase, done: (tx: IDBTransaction) => Promise<void>): Promise<void> {
  const tx = db.transaction("changes", "readwrite", { durability: "strict" });
  const committed = done(tx), store = tx.objectStore("changes"), marker = store.get(["$format", "row-buckets"]);
  marker.onsuccess = () => {
    if (marker.result?.v !== "1") return;
    const request = store.getAll(IDBKeyRange.bound(["$bucket"], ["$bucket", []]));
    request.onsuccess = () => {
      try {
        for (const saved of request.result as Bucket[]) {
          writeBucket(store, saved.k, undefined, unpack(saved));
        }
        store.put({ s: "$format", k: "row-buckets", v: "2" });
      } catch { try { tx.abort(); } catch { /* An earlier request already aborted it. */ } }
    };
  };
  return committed;
}
