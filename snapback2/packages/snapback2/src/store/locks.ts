import { OfflineStoreFailure } from "./range-store.js";

export interface StoreLocks {
  request<T>(name: string, options: { ifAvailable: true }, callback: (lock: { readonly name?: string } | null) => T | Promise<T>): Promise<T>;
}

// @ref LLP 1013#4-locks-the-token-store-and-the-partition — a global symbol
// keeps the one-writer table shared even across separately emitted bundles.
const key = Symbol.for("snapback2.offline.storeLocks");
type LockScope = string | object;
const scopes = ((globalThis as Record<PropertyKey, unknown>)[key] ??= new Map()) as Map<LockScope, Map<string, object>>;

export function inProcessLocks(scope: LockScope = "default"): StoreLocks {
  return {
    async request(name, _options, callback) {
      const held = scopes.get(scope) ?? new Map<string, object>();
      if (held.has(name)) return callback(null);
      scopes.set(scope, held);
      const lock = { name };
      held.set(name, lock);
      try { return await callback(lock); }
      finally {
        if (held.get(name) === lock) held.delete(name);
        if (held.size === 0) scopes.delete(scope);
      }
    },
  };
}

export async function acquireStoreLock(locks: StoreLocks, partition: string): Promise<() => Promise<void>> {
  let accept!: () => void;
  let refuse!: (error: unknown) => void;
  let release!: () => void;
  const acquired = new Promise<void>((resolve, reject) => { accept = resolve; refuse = reject; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const request = locks.request(`snapback2:${partition}`, { ifAvailable: true }, async (lock) => {
    if (!lock) {
      refuse(new OfflineStoreFailure("E_OFFLINE_LOCK", "this account is open in another client; close it and try again"));
      return;
    }
    accept();
    await released;
  });
  void request.catch(refuse);
  await acquired;
  return async () => { release(); await request; };
}
