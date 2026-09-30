import { LOCATION_STORE, PAGE_STORE, RowPages } from "./web-idb-pages.ts";
import type { Change, Persistence } from "./web.ts";
import { bucket, childBucket, packedStore, unpack, upgradeBuckets, writeGroup, type Bucket } from "./web-idb-buckets.ts";

// The public persistence adapter retains format 3 for existing consumers.
// Built-in devices prefer format 4; both readers understand either layout.
// Metadata, outbox and acknowledgements share the same strict transaction.
const FORMAT: Change = { s: "$format", k: "row-buckets", v: "3" };
// @ref LLP 3000.007#20.4 — each layout fences clients that cannot interpret it.
const DATABASE_VERSION = 2;
const PAGE_DATABASE_VERSION = 3;
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

export function indexedDbStore(claim: Persistence["claim"], preferPages = false): Persistence {
  const packing = new Map<string, string | undefined>();
  const rowPages = new RowPages();
  const open = (name: string, create = true, version = preferPages ? PAGE_DATABASE_VERSION : DATABASE_VERSION): Promise<IDBDatabase | null> => new Promise((resolve, reject) => {
    let absent = false;
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = event => {
      // The version fence preserves every existing store and format marker.
      // load() separately migrates old buckets in a strict transaction.
      if (event.oldVersion === 0 && !create) { absent = true; request.transaction!.abort(); return; }
      if (version === PAGE_DATABASE_VERSION && !request.result.objectStoreNames.contains(PAGE_STORE)) {
        request.result.createObjectStore(PAGE_STORE, { keyPath: "id" });
        request.result.createObjectStore(LOCATION_STORE, { keyPath: "id" });
      }
      if (event.oldVersion !== 0) return;
      if (create) {
        const store = request.result.createObjectStore("changes", { keyPath: ["s", "k"] });
        const format = preferPages ? "4" : FORMAT.v!;
        store.put({ ...FORMAT, v: format });
        if (preferPages) rowPages.initialize(store);
        packing.set(name, format);
      } else { absent = true; request.transaction!.abort(); }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      packing.delete(name);
      if (absent) resolve(null);
      else if (version === DATABASE_VERSION && request.error?.name === "VersionError") {
        // This version of the public adapter understands both layouts. An
        // actual pre-format-4 client still refuses at physical version 2.
        rowPages.forget(name); open(name, create, PAGE_DATABASE_VERSION).then(resolve, reject);
      } else reject(request.error);
    };
  });
  const save = async (name: string, changes: Change[], current?: () => boolean): Promise<boolean> => {
      const db = (await open(name))!;
      try {
        if (!packing.has(name) && changes.some(c => packedStore(c.s))) {
          const tx = db.transaction("changes", "readonly");
          const marker = tx.objectStore("changes").get([FORMAT.s, FORMAT.k]);
          await done(tx);
          if (["1", "2"].includes(marker.result?.v)) throw new Error("load the device before saving: its old row buckets require a bounded-format upgrade");
          packing.set(name, marker.result?.v);
        }
        if (packing.get(name) === "4") return await rowPages.save(db, changes, done, current);
        const tx = db.transaction("changes", "readwrite", { durability: "strict" });
        const committed = done(tx), store = tx.objectStore("changes");
        let stale = false, changedLayout = false, failure: unknown;
        const write = (format?: string) => {
          try {
            // @ref LLP 3000.007#20.4 — the writing transaction owns the layout
            // decision. A migration may have committed after the earlier read.
            if (format === "4") { changedLayout = true; tx.abort(); return; }
            if (format === "1" || format === "2") throw new Error("load the device before saving: its old row buckets require a bounded-format upgrade");
            clearDeletedRanges(store, changes, cleared => {
              const groups = new Map<string, Change[]>();
              for (const change of changes) {
                if (format === FORMAT.v && packedStore(change.s)) {
                  const key = bucket(change.s, change.k);
                  if (!groups.has(key)) groups.set(key, []);
                  groups.get(key)!.push(change);
                } else if (change.v === null) { if (!cleared.has(change.s)) store.delete([change.s, change.k]); }
                else store.put(change);
              }
              // Keep read/modify/write in this transaction. A split may queue
              // child reads: check current only after every callback has issued
              // its writes, with no asynchronous gap before the explicit commit.
              const guardCommit = () => {
                if (current) {
                  const guard = store.get([FORMAT.s, FORMAT.k]);
                  guard.onsuccess = () => { if (!current()) { stale = true; tx.abort(); } else tx.commit(); };
                }
              };
              let pending = groups.size;
              if (!pending) guardCommit();
              for (const [key, delta] of groups) {
                writeGroup(store, key, delta, cleared.has(key.slice(0, 1)), () => { if (!--pending) guardCommit(); });
              }
            });
          } catch (error) { failure = error; try { tx.abort(); } catch { /* Already aborted. */ } }
        };
        if (changes.some(c => packedStore(c.s))) {
          const marker = store.get([FORMAT.s, FORMAT.k]);
          marker.onsuccess = () => write(marker.result?.v);
        } else write(); // Metadata does not depend on the row layout.
        try { await committed; } catch (error) {
          if (changedLayout) {
            packing.set(name, "4"); rowPages.forget(name);
            return await rowPages.save(db, changes, done, current);
          }
          if (!stale) throw failure ?? error;
        }
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
        const tx = db.transaction(db.version >= PAGE_DATABASE_VERSION ? ["changes", PAGE_STORE, LOCATION_STORE] : ["changes"], "readonly"), store = tx.objectStore("changes");
        let pageValue: string | null = null;
        const direct = store.get([s, k]);
        let group: Bucket | undefined;
        if (packedStore(s)) {
          const marker = store.get([FORMAT.s, FORMAT.k]);
          marker.onsuccess = () => {
            if (marker.result?.v === "4") {
              rowPages.point(tx, s, k, value => { pageValue = value; });
              return;
            }
            const read = store.get(["$bucket", bucket(s, k, marker.result?.v !== FORMAT.v)]);
            read.onsuccess = () => {
              if (read.result?.split) {
                const child = store.get(["$bucket", childBucket(s, k)]);
                child.onsuccess = () => { group = child.result; };
              } else group = read.result;
            };
          };
        }
        await done(tx);
        if (direct.result) return (direct.result as Change).v;
        if (group) return new Map(JSON.parse(group.v!)).get(k) as string ?? null;
        return pageValue;
      } finally { db.close(); }
    },
    async load(name) {
      const db = (await open(name))!;
      try {
        const tx = db.transaction(db.version >= PAGE_DATABASE_VERSION ? ["changes", PAGE_STORE] : ["changes"], "readonly");
        const request = tx.objectStore("changes").getAll();
        const pages = db.version >= PAGE_DATABASE_VERSION ? tx.objectStore(PAGE_STORE).getAll() : undefined;
        await done(tx);
        const changes = request.result as Change[];
        if (changes.some(c => c.s === FORMAT.s && c.k === FORMAT.k && (c.v === "1" || c.v === "2"))) {
          await upgradeBuckets(db, done);
          return this.load(name);
        }
        const format = changes.find(c => c.s === FORMAT.s && c.k === FORMAT.k)?.v;
        if (preferPages && format === "3") { await rowPages.migrate(db, done); return this.load(name); }
        packing.set(name, format ?? undefined);
        if (format === "4") {
          const header = changes.find(c => c.s === "$format" && c.k === "row-pages");
          if (!header?.v || !pages) throw new Error("the row-page directory is missing");
          return [...changes.flatMap(unpack), ...rowPages.loaded(name, JSON.parse(header.v), pages.result)];
        }
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
        request.onsuccess = () => { packing.delete(name); rowPages.forget(name); resolve(); };
        request.onerror = () => reject(request.error);
        request.onblocked = () => resolve();
      });
    },
  };
}
