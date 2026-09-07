import { imageRecord, imageState } from '../../../evaluator/src/row-image.js';
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
  const { rows = {}, answers = {}, outbox = {}, ...meta } = jsonState(imageState(state));
  const entries = (value: object) => Object.entries(value).map(([key, value]) => ({ key, value }));
  return { rows: entries(rows), answers: entries(answers), outbox: entries(outbox), meta: metadata(meta) };
}

type ProjectionDelta = Record<keyof StateProjection, { put: StateEntry[]; remove: string[] }>;

/** Keep committed key presence only, advancing after the carrier commits.
 * The journal bounds warm writes. Direct backend replacements rewrite supplied
 * entries rather than retain full payloads to compare with mutable callers. */
export class ProjectionCache {
  private legacyMetadata = false;
  private keys = { rows: new Set<string>(), answers: new Set<string>(), outbox: new Set<string>(), meta: new Set<string>() };

  reset(projected?: StateProjection): void {
    this.legacyMetadata = !!projected?.meta.some(e => e.key !== "state" && !e.key.startsWith("["));
    for (const name of Object.keys(this.keys) as Array<keyof StateProjection>) {
      this.keys[name] = new Set((projected?.[name] ?? []).map(({ key }) => key));
    }
  }

  prepare(state: PersistedRangeState, _previous?: PersistedRangeState, changed?: ChangedRecords): { delta: ProjectionDelta; committed(): void } {
    const delta: ProjectionDelta = { rows: { put: [], remove: [] }, answers: { put: [], remove: [] },
      outbox: { put: [], remove: [] }, meta: { put: [], remove: [] } };
    const put = (name: keyof StateProjection, key: string, value: unknown) => {
      const text = JSON.stringify(name === 'rows' ? imageRecord(value as { row: unknown }) : value);
      if (text === undefined && !this.keys[name].has(key)) return;
      delta[name].put.push({ key, value: JSON.parse(text) });
    };
    const compare = (name: keyof StateProjection, entries: StateEntry[]) => {
      const present = new Set(entries.map(({ key }) => key));
      for (const key of this.keys[name]) if (!present.has(key)) delta[name].remove.push(key);
      for (const { key, value } of entries) put(name, key, value);
    };
    for (const name of ["rows", "answers", "outbox"] as const) {
      if (changed && !changed.get('*')?.has(name)) {
        for (const key of changed.get(name) ?? []) {
          const value = state[name][key];
          if (value === undefined) { if (this.keys[name].has(key)) delta[name].remove.push(key); }
          else put(name, key, value);
        }
        continue;
      }
      compare(name, Object.entries(state[name] ?? {}).map(([key, value]) => ({ key, value })));
    }
    const metaDelta = !this.legacyMetadata && changed && metadataChanges(state, changed);
    if (!metaDelta) compare("meta", metadata(state));
    else {
      delta.meta.remove.push(...metaDelta.remove);
      for (const { key, value } of metaDelta.put) put('meta', key, value);
    }
    return { delta, committed: () => {
      this.legacyMetadata = false;
      for (const name of Object.keys(delta) as Array<keyof StateProjection>) {
        for (const key of delta[name].remove) this.keys[name].delete(key);
        for (const { key } of delta[name].put) this.keys[name].add(key);
      }
    } };
  }
}

export function unprojectState(projected: StateProjection): PersistedRangeState | undefined {
  const meta = projected.meta.find(({ key }) => key === "state");
  if (!meta && !projected.rows.length && !projected.answers.length && !projected.outbox.length) return undefined;
  const record = (entries: StateEntry[]) => Object.fromEntries(entries.map(({ key, value }) => [key, value]));
  // Preserve an absent private custody marker for common legacy admission.
  // A current default would silently relabel predecessor experimental guards.
  const { factFormat: _factFormat, ...defaults } = emptyState();
  return {
    ...defaults,
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
