import { metadata, metadataChanges, restoreMetadata } from "./metadata.js";
import type { ChangedRecords } from "./swap-journal.js";
import { emptyState, jsonState, type PersistedRangeState } from "./range-store.js";

export type StateEntry = { key: string; value: unknown };
export type StateProjection = Record<"rows" | "answers" | "outbox" | "meta", StateEntry[]>;

// @ref LLP 1013#3-the-sqlite-carrier — one projection for both database carriers;
// the rest carries future metadata fields without a second list to keep in sync.
export function projectState(state: PersistedRangeState): StateProjection {
  // State has the JSON wire form on every carrier: omit undefined object fields,
  // preserve null, and turn undefined array slots into null. Bytes travel separately.
  const { rows = {}, answers = {}, outbox = {}, ...meta } = jsonState(state);
  const entries = (value: object) => Object.entries(value).map(([key, value]) => ({ key, value }));
  return { rows: entries(rows), answers: entries(answers), outbox: entries(outbox), meta: metadata(meta) };
}

type ProjectionDelta = Record<keyof StateProjection, { put: StateEntry[]; remove: string[] }>;

/** Keep serialized committed entries, advancing only after the carrier commits.
 * `previous` is the store's immutable last committed state; direct backend users
 * omit it and all entries are compared. Neither path trusts mutable caller data. */
export class ProjectionCache {
  private legacyMetadata = false;
  private values = { rows: new Map<string, string>(), answers: new Map<string, string>(),
    outbox: new Map<string, string>(), meta: new Map<string, string>() };

  reset(projected?: StateProjection): void {
    this.legacyMetadata = !!projected?.meta.some(e => e.key !== "state" && !e.key.startsWith("["));
    for (const name of Object.keys(this.values) as Array<keyof StateProjection>) {
      this.values[name] = new Map((projected?.[name] ?? []).map(({ key, value }) => [key, JSON.stringify(value)]));
    }
  }

  prepare(state: PersistedRangeState, previous?: PersistedRangeState, changed?: ChangedRecords): { delta: ProjectionDelta; committed(): void } {
    const delta: ProjectionDelta = { rows: { put: [], remove: [] }, answers: { put: [], remove: [] },
      outbox: { put: [], remove: [] }, meta: { put: [], remove: [] } };
    const encoded: Array<[keyof StateProjection, string, string]> = [];
    const compare = (name: keyof StateProjection, entries: StateEntry[]) => {
      const present = new Set(entries.map(({ key }) => key));
      for (const key of this.values[name].keys()) if (!present.has(key)) delta[name].remove.push(key);
      for (const { key, value } of entries) {
        const text = JSON.stringify(value);
        if (this.values[name].get(key) === text) continue;
        delta[name].put.push({ key, value: JSON.parse(text) });
        encoded.push([name, key, text]);
      }
    };
    for (const name of ["rows", "answers", "outbox"] as const) {
      if (changed && !changed.get('*')?.has(name)) {
        for (const key of changed.get(name) ?? []) {
          const value = state[name][key];
          if (value === undefined) { if (this.values[name].has(key)) delta[name].remove.push(key); }
          else {
            const text = JSON.stringify(value);
            if (this.values[name].get(key) !== text) { delta[name].put.push({ key, value: JSON.parse(text) }); encoded.push([name, key, text]); }
          }
        }
        continue;
      }
      if (previous && state[name] === previous[name]) continue;
      compare(name, Object.entries(state[name] ?? {}).map(([key, value]) => ({ key, value })));
    }
    const metaDelta = !this.legacyMetadata && changed && metadataChanges(state, changed);
    if (!metaDelta) compare("meta", metadata(state));
    else {
      delta.meta.remove.push(...metaDelta.remove);
      for (const { key, value } of metaDelta.put) {
        const text = JSON.stringify(value);
        if (this.values.meta.get(key) !== text) { delta.meta.put.push({ key, value: JSON.parse(text) }); encoded.push(['meta', key, text]); }
      }
    }
    return { delta, committed: () => {
      this.legacyMetadata = false;
      for (const name of Object.keys(delta) as Array<keyof StateProjection>) {
        for (const key of delta[name].remove) this.values[name].delete(key);
      }
      for (const [name, key, text] of encoded) this.values[name].set(key, text);
    } };
  }
}

export function unprojectState(projected: StateProjection): PersistedRangeState | undefined {
  const meta = projected.meta.find(({ key }) => key === "state");
  if (!meta && !projected.rows.length && !projected.answers.length && !projected.outbox.length) return undefined;
  const record = (entries: StateEntry[]) => Object.fromEntries(entries.map(({ key, value }) => [key, value]));
  return {
    ...emptyState(),
    ...restoreMetadata(projected.meta),
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
