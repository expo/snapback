// Internal SDK custody. The public Client contract does not expose raw tokens.
import type { Client, FollowingQuery } from "./contract.ts";
export type FollowingWire = Record<string, unknown>;
type Transport = (op: FollowingQuery<unknown, unknown>, args: unknown, body: FollowingWire, signal?: AbortSignal) => Promise<FollowingWire | undefined>;
const transports = new WeakMap<Client, Transport>();
const fences = new WeakMap<Client, (op: FollowingQuery<unknown, unknown>) => boolean>();
export function bindFollowing(client: Client, send: Transport, blocked?: (op: FollowingQuery<unknown, unknown>) => boolean): void { transports.set(client, send); if (blocked) fences.set(client, blocked); }
export function followingBlocked<A,R>(client:Client,op:FollowingQuery<A,R>):boolean { return fences.get(client)?.(op) ?? false; }
export function followingRequest<A, R>(client: Client, op: FollowingQuery<A, R>, args: A, body: FollowingWire, signal?: AbortSignal): Promise<FollowingWire | undefined> {
  if (client.readOnly) return Promise.resolve({ phase: "refused", code: "E_READ_ONLY" });
  const send = transports.get(client);
  return send ? send(op, args, body, signal) : Promise.resolve({ phase: "refused", code: "E_FOLLOWING_DECLARATION" });
}
export function guardFollowing(client: Client, raw: Client, check: () => Promise<unknown>, current: () => boolean): void {
  parents.set(client,raw);
  bindFollowing(client, async (op, args, body, signal) => {
    if (!current() || await check() || !current()) return;
    const result = await followingRequest(raw, op, args, body, signal);
    if (!current() || await check() || !current()) return;
    if (!result) return;
    const previous = result.__followingCurrent;
    return { ...result, __followingCurrent: () => current() && (typeof previous !== "function" || previous()) };
  }, op => !current() || followingBlocked(raw, op));
}

const parents = new WeakMap<Client, Client>();
const changes = new WeakMap<Client, Set<() => void>>();
export function onFollowingChange(client: Client, listener: () => void): () => void {
  const parent=parents.get(client); if (parent) return onFollowingChange(parent,listener);
  let listeners=changes.get(client); if (!listeners) changes.set(client,listeners=new Set());
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function notifyFollowing(client: Client): void { for (const listener of changes.get(client) ?? []) listener(); }
