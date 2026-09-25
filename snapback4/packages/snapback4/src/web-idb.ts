import type { Change, Persistence } from "./web.ts";

// New stores pack row images into 256 buckets instead of issuing one IDB
// request per row. Old stores retain their exact representation. Metadata,
// outbox and transfer acknowledgements share the same strict transaction.
const FORMAT: Change = { s: "$format", k: "row-buckets", v: "1" };
const packedStore = (s: string) => s === "r" || s === "s" || s === "b";
function bucket(s: string, key: string): string {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return `${s}:${hash & 255}`;
}
const unpack = (change: Change): Change[] => change.s === "$format" ? [] : change.s === "$bucket"
  ? (JSON.parse(change.v!) as [string, string][]).map(([k, v]) => ({ s: change.k.slice(0, 1), k, v })) : [change];
const done = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

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
        if (group?.result) return new Map(JSON.parse((group.result as Change).v!)).get(k) as string ?? null;
        return (direct.result as Change | undefined)?.v ?? null;
      } finally { db.close(); }
    },
    async load(name) {
      const db = (await open(name))!;
      try {
        const tx = db.transaction("changes", "readonly");
        const request = tx.objectStore("changes").getAll();
        await done(tx);
        const changes = request.result as Change[];
        packing.set(name, changes.some(c => c.s === FORMAT.s && c.k === FORMAT.k && c.v === FORMAT.v));
        return changes.flatMap(unpack);
      } finally { db.close(); }
    },
    async save(name, changes) {
      const db = (await open(name))!;
      try {
        if (!packing.has(name) && changes.some(c => packedStore(c.s))) {
          const tx = db.transaction("changes", "readonly");
          const marker = tx.objectStore("changes").get([FORMAT.s, FORMAT.k]);
          await done(tx); packing.set(name, marker.result?.v === FORMAT.v);
        }
        const tx = db.transaction("changes", "readwrite", { durability: "strict" });
        const committed = done(tx), store = tx.objectStore("changes");
        try {
          const groups = new Map<string, Change[]>();
          for (const change of changes) {
            if (packing.get(name) && packedStore(change.s)) {
              const key = bucket(change.s, change.k);
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key)!.push(change);
            } else if (change.v === null) store.delete([change.s, change.k]);
            else store.put(change);
          }
          // Keep every read/modify/write inside IDB's transaction, including
          // simultaneous owners using separate Persistence instances.
          for (const [key, delta] of groups) {
            const request = store.get(["$bucket", key]);
            request.onsuccess = () => {
              try {
                const rows = new Map<string, string>(request.result ? JSON.parse((request.result as Change).v!) : []);
                for (const change of delta) { if (change.v === null) rows.delete(change.k); else rows.set(change.k, change.v); }
                if (rows.size) store.put({ s: "$bucket", k: key, v: JSON.stringify([...rows]) });
                else store.delete(["$bucket", key]);
              } catch { tx.abort(); }
            };
          }
        } catch (error) { try { tx.abort(); } catch { /* The failing operation may already have aborted it. */ } await committed.catch(() => {}); throw error; }
        await committed;
      } finally { db.close(); }
    },
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
