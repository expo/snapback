import type { Client, Read } from "./contract.ts";
import { answerIdentity, answerObservation } from "./read-observation.ts";

// Write-only wrappers (including app custody) preserve the raw observe function.
const guarded = new WeakSet<Client["observe"]>();
const pending = new WeakMap<object, { current(): boolean; collect(): void }>();

export function guardDelivery(client: Client): void {
  if (typeof client.observe === "function") guarded.add(client.observe);
}
export function discardDelivery(read: Read<unknown>): void { pending.delete(answerIdentity(read)); }

// @ref LLP 3000.022#4 — a guarded answer carries collection until facade approval.
export function offerDelivery(client: Client, read: Read<unknown>,
  collect: (current?: () => boolean) => void, current: () => boolean): void {
  if (!("data" in read)) return;
  if (!guarded.has(client.observe)) { collect(); return; }
  const identity = answerIdentity(read), owner = answerObservation(read);
  const valid = () => current() && (!owner || answerIdentity(owner.read(null)) === identity);
  pending.set(identity, { current: valid, collect: () => collect(valid) });
}

// @ref LLP 3000.023#3.6 — peers approve one identity; freshness copies share it.
export function approveDelivery(read: Read<unknown>): boolean {
  const identity = answerIdentity(read), acceptance = pending.get(identity);
  if (!acceptance) return true;
  if (!acceptance.current()) return false;
  pending.delete(identity);
  acceptance.collect();
  return true;
}
