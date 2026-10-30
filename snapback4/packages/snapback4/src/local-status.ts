import type { Client, Refusal } from "./contract.ts";

export type LocalStatus = { readonly state: "loading" | "opening" | "syncing" | "ready"; readonly executable: boolean; readonly acquired: boolean }
  | { readonly state: "unavailable"; readonly executable: false; readonly acquired: false; readonly why: Refusal };
export interface LocalStatusObservation { getSnapshot(): LocalStatus; subscribe(listener: () => void): () => void }
const statuses = new WeakMap<object, LocalStatusObservation>();
export const localUnavailable = (): Refusal => ({ code: "E_STORE", family: "store", retryable: true,
  message: "the local device is not available yet", rewrite: "wait for localStatus(client) to report an executable device, then retry" });
const absent: LocalStatus = { state: "unavailable", executable: false, acquired: false, why: localUnavailable() };
const unavailable: LocalStatusObservation = { getSnapshot: () => absent, subscribe: () => () => {} };
/** Observe executable-engine and acquired-replica readiness independently of auth. */
export const localStatus = (client: Client): LocalStatusObservation => statuses.get(client) ?? unavailable;
export function localStatusSource() {
  let snapshot: LocalStatus = { state: "loading", executable: false, acquired: false };
  const listeners = new Set<() => void>();
  const observation: LocalStatusObservation = { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return { bind(client: Client) { statuses.set(client, observation); },
    set(next: LocalStatus) { snapshot = next; for (const listener of listeners) { try { listener(); } catch (error) { console.error("snapback4 local status listener:", error); } } } };
}
export function guardLocalStatus(client: Client, raw: Client, valid: () => boolean, why: () => Refusal, invalidations: Set<() => void>) {
  const source = statuses.get(raw);
  if (!source) return;
  let ended: LocalStatus | undefined;
  statuses.set(client, { getSnapshot: () => valid() ? source.getSnapshot() : ended ??= { state: "unavailable", executable: false, acquired: false, why: why() },
    subscribe(listener) { invalidations.add(listener); const stop = source.subscribe(() => { if (valid()) listener(); }); return () => { stop(); invalidations.delete(listener); }; } });
}
