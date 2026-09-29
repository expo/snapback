import type { Client, Write } from "./contract.ts";
import { storeLock } from "./app-storage.ts";

// Private connection between the online transport and createApp's journal.
// The public Client card stays independent of the persistence implementation.
export interface DispatchOwner {
  observe(store: string): void;
  before(id: string, store: string | undefined): Promise<Write | undefined>;
  after?(id: string): Promise<void>;
  held?(id: string, reason: string): Promise<void>;
}
export interface DispatchState { store?: string; owner?: DispatchOwner; identify?: () => Promise<void> }
const clients = new WeakMap<Client, DispatchState>();
export function trackDispatch(client: Client, state: DispatchState): void { clients.set(client, state); }
export function ownDispatch(client: Client, owner: DispatchOwner): void {
  const state = clients.get(client);
  if (!state) throw new Error("online journal needs the online transport's dispatch boundary");
  state.owner = owner;
  if (state.store) owner.observe(state.store);
}
export function dispatchIdentity(client: Client): string | undefined {
  return clients.get(client)!.store;
}
export async function identifyDispatch(client: Client): Promise<string | undefined> {
  const state = clients.get(client)!;
  if (!state.store) await state.identify?.();
  return state.store;
}

// Hold only this identity's transport, not the journal/session transaction.
// A crashed renderer releases its Web Lock; reopen can replay the durable ID.
export function claimDispatch(key: string): Promise<() => void> {
  return new Promise((resolve, reject) => {
    void storeLock(key, () => new Promise<void>(release => resolve(release))).catch(reject);
  });
}
