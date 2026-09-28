import type { SessionStore } from "./auth.ts";
import { storeLock } from "./app-storage.ts";

type Transaction = <T>(key: string, work: (storage: SessionStore) => Promise<T>) => Promise<T>;
const transactions = new WeakMap<SessionStore, Transaction>();
// App stores already serialize and authorize saves. Rotation needs the same
// lock, with direct storage access inside it, never a nested lock acquisition.
export function registerSessionTransaction(store: SessionStore, transaction: Transaction): void { transactions.set(store, transaction); }
export const managedSessionStore = (store: SessionStore): boolean => transactions.has(store);
export function sessionTransaction<T>(store: SessionStore, key: string, work: (storage: SessionStore) => Promise<T>): Promise<T> {
  return transactions.get(store)?.(key, work) ?? storeLock(key, () => work(store));
}
