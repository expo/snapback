import type { Client, Write } from "./contract.ts";

// Private connection between the online transport and createApp's journal.
// The public Client card stays independent of the persistence implementation.
export interface DispatchOwner {
  observe(store: string): void;
  before(id: string, store: string | undefined): Promise<Write | undefined>;
  held?(id: string, reason: string): Promise<void>;
}
export interface DispatchState { store?: string; owner?: DispatchOwner; identify?: () => Promise<void> }
const clients = new WeakMap<Client, DispatchState>();
export function trackDispatch(client: Client, state: DispatchState): void { clients.set(client, state); }
export function inheritDispatch(client: Client, raw: Client): void { clients.set(client, clients.get(raw)!); }
/** Authorized /schema identified this store before the late-bound core. */
export function seedDispatchIdentity(client: Client, store: string): void { clients.get(client)!.store = store; }
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

// @ref LLP 3000.002.000.000#2.2 — execution bindings reach custody without
// adding fields to a public live Write or substituting observation metadata.
interface ReceiptBinding { store_id?: string; generation?: number }
const receiptBindings = new WeakMap<object, ReceiptBinding>();
export function bindDispatchReceipt<T extends object>(write: T, json: Record<string, unknown>): T {
  receiptBindings.set(write, {
    ...(typeof json.store_id === "string" && json.store_id ? { store_id: json.store_id } : {}),
    ...(Number.isSafeInteger(json.generation) && Number(json.generation) >= 0 ? { generation: Number(json.generation) } : {}),
  });
  return write;
}
export const dispatchReceipt = (write: object): ReceiptBinding | undefined => receiptBindings.get(write);
