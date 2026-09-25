import type { Read } from "./contract.ts";
// @ref LLP 3000.014#5 — a fallback replaces current pages, preserving delivered history.
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export function hasRetainedRows(value: unknown): boolean {
  if (value === true) return true;
  if (Array.isArray(value)) return value.some(hasRetainedRows);
  return object(value) && Object.values(value).some(hasRetainedRows);
}
// Only the envelope can establish row identity. In particular, a projection
// can rename or replace `id`, and two source tables can share the same id.
const identity = (mask: unknown): string | undefined => {
  const source = object(mask) ? mask.source : undefined;
  return Array.isArray(source) && source.length === 2 && source.every(part => typeof part === "string") ? JSON.stringify(source) : undefined;
};
export function keepRetainedRows(current: unknown, local: unknown, mask: unknown, currentMask?: unknown): unknown {
  if (!hasRetainedRows(mask)) return current;
  if (Array.isArray(current) && Array.isArray(local)) {
    if (!Array.isArray(mask) || !Array.isArray(currentMask) || mask.length !== local.length || currentMask.length !== current.length) return local;
    const localIds = mask.map(identity), serverIds = currentMask.map(identity);
    // No positional fallback, including for synthetic wrappers or ambiguous
    // repeated identities. The caller publishes this local subtree incomplete.
    if (localIds.includes(undefined) || serverIds.includes(undefined) || new Set(localIds).size !== localIds.length || new Set(serverIds).size !== serverIds.length) return local;
    const locals = new Map(localIds.map((id, index) => [id, index]));
    const servers = new Set(serverIds);
    return [
      ...current.map((value, index) => {
        const paired = locals.get(serverIds[index]);
        return paired === undefined ? value : keepRetainedRows(value, local[paired], mask[paired], currentMask[index]);
      }),
      ...local.filter((_, index) => !servers.has(localIds[index]) && hasRetainedRows(mask[index])),
    ];
  }
  if (object(current) && object(local) && object(mask) && object(currentMask)) {
    const source = identity(mask);
    if (source === undefined || source !== identity(currentMask) || !object(mask.fields) || !object(currentMask.fields)) return local;
    const fields = mask.fields, serverFields = currentMask.fields;
    const result = { ...current };
    for (const [field, value] of Object.entries(local)) {
      if (hasRetainedRows(fields[field])) result[field] = field in current ? keepRetainedRows(current[field], value, fields[field], serverFields[field]) : value;
    }
    return result;
  }
  return local;
}

type Observation<R> = { read: Read<R>; tables: Set<string>; nextExpiry: number | null; transportOffline?: boolean; rowProvenance?: unknown };
type Local<R> = { result: Observation<R>; terminal: boolean; outcome: { unknown?: boolean; data?: unknown; retainedRows?: unknown } };

// Re-observe after the server reply: retention, pending writes and incarnation
// may have changed while that request was in flight.
export async function readThroughFallback<R>(
  server: (failure: () => Observation<R>, remember: boolean, retain: boolean, provenance: boolean) => Promise<Observation<R>>,
  local: () => Promise<Local<R>>, first: Observation<R>, obsolete: () => boolean,
  stopped: () => Promise<boolean>, clearRemembered: () => void,
): Promise<Observation<R>> {
  clearRemembered();
  let failed = false;
  const remote = await server(() => { failed = true; return first; }, false, true, true);
  if (!("data" in remote.read)) return remote;
  const second = await local();
  if (obsolete()) return { read: { loading: true }, tables: first.tables, nextExpiry: null };
  if (second.terminal || !("data" in second.result.read) || failed || await stopped()) return second.result;
  if (!second.outcome.unknown) return second.result;
  const expiries = [remote.nextExpiry, second.result.nextExpiry].filter((expiry): expiry is number => expiry !== null);
  return { read: { ...remote.read, data: keepRetainedRows(remote.read.data, second.outcome.data, second.outcome.retainedRows, remote.rowProvenance) as R, fresh: false, complete: false }, tables: first.tables, nextExpiry: expiries.length ? Math.min(...expiries) : null };
}
