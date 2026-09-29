import type { Change } from "./web.ts";
import { utf8Size } from "./utf8-size.ts";

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
const pairBytes = (key: string, value: string) => utf8Size(JSON.stringify([key, value]));

/** Runs in the caller's strict readwrite transaction. No ordinary update
 * reads, parses or rewrites another bucket or an overflow row. */
export function writeBucket(store: IDBObjectStore, key: string, saved: Bucket | undefined, delta: Change[], cleared = false): void {
  const s = key.slice(0, 1);
  const rows = new Map<string, string>(saved ? JSON.parse(saved.v!) : []);
  // Publication deletes staged images. No insertion means no capacity test:
  // do not re-encode every removed image just to subtract its escaped size.
  if (saved && delta.every(change => change.v === null)) {
    let dirty = false;
    for (const change of delta) {
      if (rows.delete(change.k)) dirty = true;
      else if (saved.spill && !cleared) store.delete([s, change.k]);
    }
    if (dirty) {
      if (rows.size || saved.spill) store.put({ ...saved, v: JSON.stringify([...rows]) });
      else store.delete(["$bucket", key]);
    }
    return;
  }
  // The saved JSON is already the exact bounded representation. Measure it
  // once; only changed pairs need escaping/encoding again.
  let bytes = saved ? utf8Size(saved.v!) : 2;
  let spill = saved?.spill ?? false, dirty = !saved;
  for (const change of delta) {
    const previous = rows.get(change.k);
    const prior = previous === undefined ? undefined : pairBytes(change.k, previous);
    if (prior !== undefined) {
      bytes -= prior + (rows.size > 1 ? 1 : 0);
      rows.delete(change.k); dirty = true;
    }
    if (change.v === null) {
      if (prior === undefined && spill && !cleared) store.delete([s, change.k]);
      continue;
    }
    const size = pairBytes(change.k, change.v), nextBytes = bytes + size + (rows.size ? 1 : 0);
    if ((prior !== undefined || !spill) && rows.size < BUCKET_ENTRIES && nextBytes <= BUCKET_BYTES) {
      rows.set(change.k, change.v); bytes = nextBytes; dirty = true;
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
