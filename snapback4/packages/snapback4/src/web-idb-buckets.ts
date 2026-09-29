import type { Change } from "./web.ts";
import { utf8Size } from "./utf8-size.ts";

// Fixed caps bound a one-row update independently of accumulated store size.
// Once a bucket spills, new keys stay per-row; no growing shard directory or
// overflow scan is needed to locate them. Existing packed keys remain packed.
export const BUCKET_ENTRIES = 512;
export const BUCKET_BYTES = 256 * 1024;
export interface Bucket extends Change { spill?: boolean; split?: boolean }
export const packedStore = (s: string) => s === "r" || s === "s" || s === "b";
function hashKey(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return hash;
}
export const bucket = (s: string, key: string, legacy = false): string => `${s}:${hashKey(key) & (legacy ? 255 : 63)}`;
export const childBucket = (s: string, key: string): string => `${bucket(s, key)}/${(hashKey(key) >>> 6) & 3}`;
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

// @ref LLP 3000.007#20.4 — fewer physical records for acquisition, bounded split work for ordinary writes.
/** Start with 64 buckets. A full bucket splits once into four bounded leaves;
 * those leaves retain the per-row overflow policy. No directory grows with
 * the partition, and an ordinary write reads at most its root and leaf. */
export function writeGroup(store: IDBObjectStore, key: string, delta: Change[], cleared: boolean, done: () => void): void {
  const abort = () => { try { store.transaction.abort(); } catch { /* Already aborted. */ } };
  const request = store.get(["$bucket", key]);
  request.onsuccess = () => {
    try {
      const saved = request.result as Bucket | undefined, s = key.slice(0, 1);
      if (saved?.split) {
        const children = new Map<string, Change[]>();
        for (const change of delta) {
          const child = childBucket(s, change.k);
          if (!children.has(child)) children.set(child, []);
          children.get(child)!.push(change);
        }
        let pending = children.size;
        for (const [child, changes] of children) {
          const read = store.get(["$bucket", child]);
          read.onsuccess = () => {
            try { writeBucket(store, child, read.result, changes, cleared); if (!--pending) done(); }
            catch { abort(); }
          };
        }
        return;
      }
      if (!saved?.spill && delta.some(change => change.v !== null)) {
        const rows = new Map<string, string>(saved ? JSON.parse(saved.v!) : []);
        for (const change of delta) {
          if (change.v === null) rows.delete(change.k); else rows.set(change.k, change.v);
        }
        if (rows.size > BUCKET_ENTRIES || utf8Size(JSON.stringify([...rows])) > BUCKET_BYTES) {
          const children = new Map<string, Change[]>();
          for (const [k, v] of rows) {
            const child = childBucket(s, k);
            if (!children.has(child)) children.set(child, []);
            children.get(child)!.push({ s, k, v });
          }
          store.put({ s: "$bucket", k: key, v: "[]", split: true });
          for (const [child, changes] of children) writeBucket(store, child, undefined, changes, cleared);
          done(); return;
        }
      }
      writeBucket(store, key, saved, delta, cleared);
      done();
    } catch { abort(); }
  };
}

/** Formats 1/2 used 256 roots (format 1 also lacked bucket caps). Repartition
 * once while loading the full device, before any metered mutation runs.
 * Read and replace packed AND overflow rows in the same strict transaction;
 * otherwise an old overflow image could shadow a newly packed update. */
export function upgradeBuckets(db: IDBDatabase, done: (tx: IDBTransaction) => Promise<void>): Promise<void> {
  const tx = db.transaction("changes", "readwrite", { durability: "strict" });
  const committed = done(tx), store = tx.objectStore("changes"), marker = store.get(["$format", "row-buckets"]);
  marker.onsuccess = () => {
    if (!["1", "2"].includes(marker.result?.v)) return;
    const request = store.getAll();
    request.onsuccess = () => {
      try {
        const groups = new Map<string, Change[]>();
        for (const saved of request.result as Bucket[]) {
          if (saved.s !== "$bucket" && !packedStore(saved.s)) continue;
          store.delete([saved.s, saved.k]);
          for (const change of unpack(saved)) {
            const key = bucket(change.s, change.k);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(change);
          }
        }
        for (const [key, changes] of groups) writeGroup(store, key, changes, false, () => {});
        store.put({ s: "$format", k: "row-buckets", v: "3" });
      } catch { try { tx.abort(); } catch { /* An earlier request already aborted it. */ } }
    };
  };
  return committed;
}
