import type { PersistedRangeState } from "./range-store.js";

export type StateEntry = { key: string; value: unknown };
export type StateProjection = Record<"rows" | "answers" | "outbox" | "meta", StateEntry[]>;

// @ref LLP 1013#3-the-sqlite-carrier — one projection for both database carriers;
// the rest carries future metadata fields without a second list to keep in sync.
export function projectState(state: PersistedRangeState): StateProjection {
  const { rows, answers, outbox, ...meta } = state;
  const entries = (value: object) => Object.entries(value).map(([key, value]) => ({ key, value }));
  return { rows: entries(rows), answers: entries(answers), outbox: entries(outbox), meta: [{ key: "state", value: meta }] };
}

export function unprojectState(projected: StateProjection): PersistedRangeState | undefined {
  const meta = projected.meta.find(({ key }) => key === "state");
  if (!meta) return undefined;
  const record = (entries: StateEntry[]) => Object.fromEntries(entries.map(({ key, value }) => [key, value]));
  return {
    ...meta.value as Omit<PersistedRangeState, "rows" | "answers" | "outbox">,
    rows: record(projected.rows) as PersistedRangeState["rows"],
    answers: record(projected.answers) as PersistedRangeState["answers"],
    outbox: record(projected.outbox) as PersistedRangeState["outbox"],
  };
}

/** Split only the first separator: a row id may itself contain NUL. */
export function encodeStateKey(key: string, tuple: boolean): string {
  const at = tuple ? key.indexOf("\u0000") : -1;
  return JSON.stringify(at < 0 ? [key] : [key.slice(0, at), key.slice(at + 1)]);
}

export function decodeStateKey(key: string): string {
  const parts: unknown = JSON.parse(key);
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 2 || parts.some((part) => typeof part !== "string")) {
    throw new Error("invalid sqlite state key");
  }
  return parts.join("\u0000");
}
