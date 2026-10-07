// @ref LLP 3000.033#1.8 — arm ownership follows each operation through a shared client's queues.
import type { Refusal } from "./contract.ts";

export interface ArmFence { key: number; valid(): boolean; why(): Refusal }
let nextKey = 0;
const operations = new WeakMap<object, ArmFence>();
const requests = new WeakMap<RequestInit, ArmFence>();

/** Bind immutable operation copies, never caller arguments or public metadata.
 * Repeated observations/renewals share within one arm, never across retirement. */
export function armOperations(valid: () => boolean, why: () => Refusal) {
  const fence: ArmFence = { key: ++nextKey, valid, why };
  const copies = new WeakMap<object, object>();
  return <T extends object>(op: T): T => {
    let copy = copies.get(op);
    if (!copy) { copy = { ...op }; copies.set(op, copy); operations.set(copy, fence); }
    return copy as T;
  };
}
export const operationArm = (op: object): ArmFence | undefined => operations.get(op);
export const armRefusal = (arm?: ArmFence): Refusal | undefined => arm && !arm.valid() ? arm.why() : undefined;
export const armKey = (op: object): string => {
  const arm = operationArm(op);
  return arm ? `arm:${arm.key}:` : "";
};

/** Clock/transport wrappers preserve init identity. Nothing is serialized into
 * HTTP headers/body; createApp reads this after its asynchronous authority check. */
export function armRequest(init: RequestInit, arm?: ArmFence): RequestInit {
  if (arm) requests.set(init, arm);
  return init;
}
export const requestArm = (init?: RequestInit): ArmFence | undefined => init && requests.get(init);
