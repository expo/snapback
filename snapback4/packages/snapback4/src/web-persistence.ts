// @ref LLP 3000.002#browser-startup-loading — separate initial page code from device opening without changing local execution.
import type { Change, Persistence } from "./web.ts";
import { indexedDbStore } from "./web-idb.ts";
import { claimWithWebLocks } from "./web-ownership.ts";

export const ephemeral = new WeakSet<Persistence>();

/** IndexedDB keeps each device call atomic and strictly durable. */
export function indexedDbPersistence(): Persistence { return indexedDbStore(claimWithWebLocks); }

/** Memory: what a test keeps between opens. */
export function memoryPersistence(): Persistence & { readonly stores: Map<string, Map<string, Change>> } {
  const stores = new Map<string, Map<string, Change>>();
  const held = new Set<string>();
  let alternate = 0;
  const save = (name: string, changes: Change[]) => {
      let held = stores.get(name);
      if (!held) stores.set(name, (held = new Map()));
      for (const change of changes) {
        const key = `${change.s} ${change.k}`;
        if (change.v === null) held.delete(key);
        else held.set(key, change);
      }
  };
  const provider: Persistence & { readonly stores: Map<string, Map<string, Change>> } = {
    stores,
    async has(name) { return stores.has(name); },
    async claim(name, allowAlternate) {
      let own = name;
      if (held.has(own) && !allowAlternate) return null;
      while (held.has(own)) own = `${name}:tab-memory-${++alternate}`;
      held.add(own);
      let released = false;
      return { name: own, async release() { if (!released) { released = true; held.delete(own); } } };
    },
    async read(name, store, key) { return stores.get(name)?.get(`${store} ${key}`)?.v ?? null; },
    async load(name) {
      return [...(stores.get(name)?.values() ?? [])];
    },
    async save(name, changes) { save(name, changes); },
    async saveIfCurrent(name, changes, current) {
      if (!current()) return false;
      save(name, changes);
      return true;
    },
    async others(prefix) {
      return [...stores.keys()].filter((n) => n.startsWith(prefix));
    },
    async remove(name) {
      stores.delete(name);
    },
  };
  ephemeral.add(provider);
  return provider;
}
