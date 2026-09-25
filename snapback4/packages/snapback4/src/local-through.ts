import type { Read } from "./contract.ts";
// @ref LLP 3000.014#5 — a fallback replaces current pages, preserving delivered history.
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export function hasRetainedRows(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((row) => object(row) && row.retained === true);
  return object(value) && Object.values(value).some(hasRetainedRows);
}
export function keepRetainedRows(current: unknown, local: unknown): unknown {
  if (Array.isArray(current) && Array.isArray(local)) {
    return [...current, ...local.filter((row) => object(row) && row.retained === true)];
  }
  if (object(current) && object(local)) {
    return Object.fromEntries(Object.entries(current).map(([field, value]) => [field, keepRetainedRows(value, local[field])]));
  }
  return current;
}

type Observation<R> = { read: Read<R>; tables: Set<string>; nextExpiry: number | null; transportOffline?: boolean };
type Local<R> = { result: Observation<R>; terminal: boolean; outcome: { unknown?: boolean; data?: unknown } };

// Re-observe after the server reply: retention, pending writes and incarnation
// may have changed while that request was in flight.
export async function readThroughFallback<R>(
  server: (failure: () => Observation<R>, remember: boolean, retain: boolean) => Promise<Observation<R>>,
  local: () => Promise<Local<R>>, first: Observation<R>, obsolete: () => boolean,
  stopped: () => Promise<boolean>, clearRemembered: () => void,
): Promise<Observation<R>> {
  clearRemembered();
  let failed = false;
  const remote = await server(() => { failed = true; return first; }, false, true);
  if (!("data" in remote.read)) return remote;
  const second = await local();
  if (obsolete()) return { read: { loading: true }, tables: first.tables, nextExpiry: null };
  if (second.terminal || !("data" in second.result.read) || failed || await stopped()) return second.result;
  if (!second.outcome.unknown) return second.result;
  const expiries = [remote.nextExpiry, second.result.nextExpiry].filter((expiry): expiry is number => expiry !== null);
  return { read: { ...remote.read, data: keepRetainedRows(remote.read.data, second.outcome.data) as R, fresh: false, complete: false }, tables: first.tables, nextExpiry: expiries.length ? Math.min(...expiries) : null };
}
