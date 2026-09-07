import { OfflineStoreFailure } from "./range-store.js";

export interface StoreLockOptions {
  /** Answer `null` at once when the lock is held (the one-writer refusal). */
  ifAvailable?: boolean;
  /** Waiting request: rejects with an `AbortError` when the signal fires. */
  signal?: AbortSignal;
}

export interface StoreLocks {
  request<T>(name: string, options: StoreLockOptions, callback: (lock: { readonly name?: string } | null) => T | Promise<T>): Promise<T>;
}

// @ref LLP 1013#4-locks-the-token-store-and-the-partition — a global symbol
// keeps the one-writer table shared even across separately emitted bundles.
// Deliberate pre-publication rename from snapback2.offline.locks for the new scoped value shape.
const key = Symbol.for("snapback2.offline.storeLocks");
type LockScope = string | object;
interface Held { holder: object; waiters: Array<{ run: () => void; cancel: () => void }> }
const scopes = ((globalThis as Record<PropertyKey, unknown>)[key] ??= new Map()) as Map<LockScope, Map<string, Held>>;

function abortError(): Error {
  const error = new Error("lock request aborted");
  error.name = "AbortError";
  return error;
}

/**
 * In-process locks with the Web Locks contract: `ifAvailable` answers `null`
 * at once, a waiting request queues in order and takes the lock when the
 * holder releases it, and a waiting request's `signal` withdraws it.
 */
export function inProcessLocks(scope: LockScope = "default"): StoreLocks {
  const table = () => {
    const held = scopes.get(scope) ?? new Map<string, Held>();
    scopes.set(scope, held);
    return held;
  };
  const release = (name: string, holder: object) => {
    const held = table();
    const entry = held.get(name);
    if (!entry || entry.holder !== holder) return;
    const next = entry.waiters.shift();
    if (next) { entry.holder = {}; next.run(); return; }
    held.delete(name);
    if (held.size === 0) scopes.delete(scope);
  };
  return {
    request(name, options, callback) {
      const held = table();
      const run = async (holder: object) => {
        try { return await callback({ name }); }
        finally { release(name, holder); }
      };
      const entry = held.get(name);
      if (!entry) {
        const holder = {};
        held.set(name, { holder, waiters: [] });
        return run(holder);
      }
      if (options.ifAvailable) return Promise.resolve(callback(null));
      if (options.signal?.aborted) return Promise.reject(abortError());
      return new Promise((resolve, reject) => {
        const waiter = {
          run: () => {
            options.signal?.removeEventListener("abort", onAbort);
            // The releasing holder handed this waiter the lock under a fresh holder token.
            const holder = held.get(name)!.holder;
            run(holder).then(resolve, reject);
          },
          cancel: () => {
            const current = held.get(name);
            if (current) current.waiters = current.waiters.filter((item) => item !== waiter);
            reject(abortError());
          },
        };
        const onAbort = () => waiter.cancel();
        options.signal?.addEventListener("abort", onAbort, { once: true });
        entry.waiters.push(waiter);
      });
    },
  };
}

/**
 * Takes the partition's writer lock. Without `wait`, a held lock is the
 * one-writer refusal `E_OFFLINE_LOCK`; with `wait`, the request queues until
 * the holder releases it or `signal` withdraws it. Resolves to the release.
 */
export async function acquireStoreLock(locks: StoreLocks, partition: string, wait?: { signal?: AbortSignal }): Promise<() => Promise<void>> {
  let accept!: () => void;
  let refuse!: (error: unknown) => void;
  let release!: () => void;
  const acquired = new Promise<void>((resolve, reject) => { accept = resolve; refuse = reject; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const options: StoreLockOptions = wait ? { ...(wait.signal ? { signal: wait.signal } : {}) } : { ifAvailable: true };
  const request = locks.request(`snapback2:${partition}`, options, async (lock) => {
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
