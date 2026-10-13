import type { SessionStore, StorageLike } from "./auth.ts";
import { sessionEpoch, StorageWarning } from "./app-storage.ts";

type Mirror = StorageLike;
type Authority = {
  source: string;
  read(key: string): Promise<string | null>;
  readScope(key: string): Promise<{ marker: string | null; raw: string | null }>;
  reconcileEpoch(key: string): Promise<void>;
};
// Function identity survives `{ ...localStorageSessionStore() }`.
const authorities = new WeakMap<SessionStore["get"], Authority>();
export const sessionAuthority = (store: SessionStore): Authority | undefined => authorities.get(store.get);
const database = "snapback4-session-authority";
const records = "sessions";
const failed = (error: unknown) => new StorageWarning({ code: "E_CLIENT", family: "store", site: "app.auth",
  message: `session authority could not be committed or read: ${String(error)}`,
  rewrite: "restore writable IndexedDB and localStorage, then retry app.auth.login", guide: "writes" });
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error ?? new Error("session transaction aborted"));
  // Request errors abort the transaction by default. Wait for that terminal
  // event too, so the caller never releases its session lock before rollback.
});

// @ref LLP 3000.013#6 — the browser authority commits before releasing the
// session lock; localStorage is only the synchronous admission mirror.
export function indexedDbSessionStore(mirror: () => Mirror, namespace: string | undefined): SessionStore {
  const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    if (namespace === undefined || namespace.length === 0) {
      reject(new Error("a custom localStorage mirror requires a stable, unique authority namespace: localStorageSessionStore(mirror, 'my-app')"));
      return;
    }
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(records);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const updateMirror = (key: string, value: string | null) => {
    if (value === null) mirror().removeItem(key); else mirror().setItem(key, value);
  };
  const read = async (key: string, repair = true): Promise<string | null> => {
    const db = await open();
    try {
      const tx = db.transaction(records, "readonly"), committed = done(tx);
      const request = tx.objectStore(records).get([namespace!, key]);
      await committed;
      // Missing authority never imports a possibly stale legacy mirror.
      const value = (request.result ?? null) as string | null;
      // Repair a stale mirror while the caller holds the session lock. A
      // mirror failure cannot turn this coherent read into stale authority.
      if (repair) try { updateMirror(key, value); } catch { /* Admission will refuse if its mirror is unusable. */ }
      return value;
    } finally { db.close(); }
  };
  const write = async (key: string, value: string | null, rollbackMirror?: string | null) => {
    let db: IDBDatabase | undefined;
    let previous: string | null = null, mirrored = false;
    try {
      db = await open();
      const tx = db.transaction(records, "readwrite", { durability: "strict" }), committed = done(tx);
      const store = tx.objectStore(records), request = store.get([namespace!, key]);
      let cause: unknown;
      request.onsuccess = () => {
        previous = rollbackMirror === undefined ? request.result ?? null : rollbackMirror;
        try {
          // A fallible mirror write precedes the authoritative commit. A
          // crash/abort can leave only a speculative mirror, never authority.
          updateMirror(key, value); mirrored = true;
          // Keep a null deletion marker, so stale mirrors cannot resurrect it.
          store.put(value, [namespace!, key]);
        } catch (error) { cause = error; tx.abort(); }
      };
      try { await committed; } catch (error) { throw cause ?? error; }
    } catch (error) {
      if (mirrored) try { updateMirror(key, previous); } catch { /* Locked checks still see the old IDB authority. */ }
      throw failed(error);
    } finally { db?.close(); }
  };
  const store: SessionStore = {
    async get(key) { try { return await read(key); } catch (error) { throw failed(error); } },
    set: write,
    delete: key => write(key, null),
  };
  authorities.set(store.get, {
    source: `indexeddb-v1:${namespace ?? ""}`, read: store.get,
    // @ref LLP 3000.013#6 — read both fences in one fresh transaction under
    // the caller's session lock; neither mirror nor a previous check is authority.
    async readScope(key) {
      let db: IDBDatabase | undefined;
      try {
        db = await open();
        const tx = db.transaction(records, "readonly"), committed = done(tx), store = tx.objectStore(records);
        const epochKey = key + ".epoch", marker = store.get([namespace!, epochKey]), raw = store.get([namespace!, key]);
        await committed;
        const result = { marker: (marker.result ?? null) as string | null, raw: (raw.result ?? null) as string | null };
        for (const [name, value] of [[epochKey, result.marker], [key, result.raw]] as const) {
          try { updateMirror(name, value); } catch { /* Authority survives a failed mirror repair. */ }
        }
        return result;
      } catch (error) { throw failed(error); }
      finally { db?.close(); }
    },
    async reconcileEpoch(key) {
      // Only at scope opening, under the session lock: preserve the legacy
      // epoch high-water mark before read repairs the mirror. Never import
      // mirror credentials, or use the mirror in ordinary authorization.
      try {
        const epochKey = key + ".epoch", before = mirror().getItem(epochKey), legacy = before ?? "0";
        // Do not repair/delete the legacy marker until its fence is committed.
        const keptMarker = await read(epochKey, false), marker = keptMarker ?? "0";
        const stored = sessionEpoch(await read(key, false)) ?? "0";
        if (![legacy, marker].every(value => /^(0|[1-9][0-9]*)$/.test(value))) throw new Error("invalid session epoch");
        const authoritative = BigInt(marker) > BigInt(stored) ? marker : stored;
        if (BigInt(legacy) > BigInt(authoritative)) await write(epochKey, legacy, before);
        else {
          // Reopening a committed session needs no allocation. In particular,
          // no separate epoch key is required when the session carries it.
          try { updateMirror(epochKey, keptMarker); } catch { /* Best-effort mirror repair; IDB already owns the fence. */ }
        }
      } catch (error) { throw failed(error); }
    },
  });
  return store;
}
