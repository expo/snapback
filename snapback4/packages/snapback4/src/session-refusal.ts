import type { Client, Refusal } from "./contract.ts";

// @ref LLP 3000.007#20.2 — app custody may fence a refused client without erasing its explanation.
// Internal only: no bearer or new public Client member crosses the online arm.
const reasons = new WeakMap<Client, () => Refusal | undefined>();
export function bindSessionRefusal(client: Client, reason: () => Refusal | undefined): void { reasons.set(client, reason); }
export function sessionRefusal(client: Client): Refusal | undefined { return reasons.get(client)?.(); }
