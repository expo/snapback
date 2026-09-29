import type { Change, Persistence } from "./web.ts";
import { bucket, packedStore, unpack, upgradeBuckets, writeBucket } from "./web-idb-buckets.ts";

// New stores pack row images into 256 bounded buckets with per-row overflow.
// Legacy per-row stores retain their representation. Metadata,
// outbox and transfer acknowledgements share the same strict transaction.
const FORMAT: Change = { s: "$format", k: "row-buckets", v: "2" };
const done = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

// @ref LLP 3000.008.004#3 — deletion and publication share one strict save.
/** A replacement removes every staged row. Prove the physical overflow range
 * is covered by this delta before replacing its individual deletes. The read
 * is capped by the delta, not by the size of a possibly unrelated partition.
 * Reads, the range delete and all ordinary changes share the strict transaction.
 */
function clearDeletedRanges(store: IDBObjectStore, changes: Change[], write: (cleared: Set<string>) => void): void {
  const candidates = new Map<string, Set<string>>(), mixed = new Set<string>();
  for (const change of changes) {
    if (!packedStore(change.s)) continue;
    if (change.v !== null) mixed.add(change.s);
    else {
      let keys = candidates.get(change.s);
      if (!keys) candidates.set(change.s, keys = new Set());
      keys.add(change.k);
    }
  }
  for (const [s, keys] of candidates) if (mixed.has(s) || keys.size < 512) candidates.delete(s);
  const cleared = new Set<string>();
  let pending = candidates.size;
  if (!pending) { write(cleared); return; }
  for (const [s, keys] of candidates) {
    const range = IDBKeyRange.bound([s], [s, []]);
    const request = store.getAllKeys(range, keys.size + 1);
    request.onsuccess = () => {
      try {
        if (request.result.length <= keys.size && request.result.every(key => Array.isArray(key) && key.length === 2 && typeof key[1] === "string" && keys.has(key[1]))) {
          store.delete(range); cleared.add(s);
        }
        if (!--pending) write(cleared);
      } catch { try { store.transaction.abort(); } catch { /* Already aborted. */ } }
    };
  }
}

export function indexedDbStore(claim: Persistence["claim"]): Persistence {
  const packing = new Map<string, boolean>();
  const open = (name: string, create = true): Promise<IDBDatabase | null> => new Promise((resolve, reject) => {
    let absent = false;
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      if (create) {
        request.result.createObjectStore("changes", { keyPath: ["s", "k"] }).put(FORMAT);
        packing.set(name, true);
      } else { absent = true; request.transaction!.abort(); }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { packing.delete(name); absent ? resolve(null) : reject(request.error); };
  });
  const save = async (name: string, changes: Change[], current?: () => boolean): Promise<boolean> => {
      const db = (await open(name))!;
      try {
        if (!packing.has(name) && changes.some(c => packedStore(c.s))) {
          const tx = db.transaction("changes", "readonly");
          const marker = tx.objectStore("changes").get([FORMAT.s, FORMAT.k]);
          await done(tx);
          if (marker.result?.v === "1") throw new Error("load the device before saving: its old row buckets require a bounded-format upgrade");
          packing.set(name, marker.result?.v === FORMAT.v);
        }
        const tx = db.transaction("changes", "readwrite", { durability: "strict" });
        const committed = done(tx), store = tx.objectStore("changes");
        let stale = false;
        try {
          clearDeletedRanges(store, changes, cleared => {
            const groups = new Map<string, Change[]>();
            for (const change of changes) {
              if (packing.get(name) && packedStore(change.s)) {
                const key = bucket(change.s, change.k);
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(change);
              } else if (change.v === null) { if (!cleared.has(change.s)) store.delete([change.s, change.k]); }
              else store.put(change);
            }
            // Keep every read/modify/write inside IDB's transaction, including
            // simultaneous owners using separate Persistence instances.
            for (const [key, delta] of groups) {
              const request = store.get(["$bucket", key]);
              request.onsuccess = () => {
                try {
                  writeBucket(store, key, request.result, delta, cleared.has(key.slice(0, 1)));
                } catch { try { tx.abort(); } catch { /* An earlier request already aborted it. */ } }
              };
            }
            // Delivery changes are metadata. Check inside the live transaction,
            // after all requests, so a held write can abort without publishing debt.
            if (current) {
              const guard = store.get([FORMAT.s, FORMAT.k]);
              guard.onsuccess = () => { if (!current()) { stale = true; tx.abort(); } else tx.commit(); };
            }
          });
        } catch (error) { try { tx.abort(); } catch { /* The failing operation may already have aborted it. */ } await committed.catch(() => {}); throw error; }
        try { await committed; } catch (error) { if (!stale) throw error; }
        return !stale;
      } finally { db.close(); }
  };
  return {
    claim,
    async has(name) {
      if (indexedDB.databases) return (await indexedDB.databases()).some(db => db.name === name);
      const db = await open(name, false); db?.close(); return db !== null;
    },
    async read(name, s, k) {
      const db = await open(name, false);
      if (!db) return null;
      try {
        const tx = db.transaction("changes", "readonly"), store = tx.objectStore("changes");
        const direct = store.get([s, k]);
        const group = packedStore(s) ? store.get(["$bucket", bucket(s, k)]) : undefined;
        await done(tx);
        if (direct.result) return (direct.result as Change).v;
        if (group?.result) return new Map(JSON.parse((group.result as Change).v!)).get(k) as string ?? null;
        return null;
      } finally { db.close(); }
    },
    async load(name) {
      const db = (await open(name))!;
      try {
        const tx = db.transaction("changes", "readonly");
        const request = tx.objectStore("changes").getAll();
        await done(tx);
        const changes = request.result as Change[];
        if (changes.some(c => c.s === FORMAT.s && c.k === FORMAT.k && c.v === "1")) {
          await upgradeBuckets(db, done);
          return this.load(name);
        }
        packing.set(name, changes.some(c => c.s === FORMAT.s && c.k === FORMAT.k && c.v === FORMAT.v));
        return changes.flatMap(unpack);
      } finally { db.close(); }
    },
    async save(name, changes) { await save(name, changes); },
    saveIfCurrent: save,
    async others(prefix) {
      const list = (indexedDB as { databases?: () => Promise<{ name?: string }[]> }).databases;
      return list ? (await list.call(indexedDB)).map(d => d.name ?? "").filter(name => name.startsWith(prefix)) : [];
    },
    async remove(name) {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => { packing.delete(name); resolve(); };
        request.onerror = () => reject(request.error);
        request.onblocked = () => resolve();
      });
    },
  };
}
