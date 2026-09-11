// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — an escaped
// application object is traversed through its fields, never re-read as a marker.
import { plainObject as object } from "../../../evaluator/src/value-runtime.js";
import type { RowRef } from "./range-store.js";

export { object };

export function asRowRef(value: unknown): RowRef | undefined {
  if (!object(value) || Object.keys(value).length !== 1 || !object(value.$row)) return;
  const marker = value.$row;
  return Object.keys(marker).sort().join(",") === "id,table"
    && typeof marker.table === "string" && typeof marker.id === "string"
    ? { table: marker.table, id: marker.id } : undefined;
}

export function escapedFields(value: unknown): Record<string, unknown> | undefined {
  if (!object(value) || Object.keys(value).length !== 1 || !object(value.$row)) return;
  return Object.keys(value.$row).length === 1 && object(value.$row.$value) ? value.$row.$value : undefined;
}

/** Walk markers beside their expansion. Observers return the same row; transforms
 * replace changed slots only, so their caller must own the expanded parents. */
export function mapExpandedRows(markers: unknown, data: unknown, row: (ref: RowRef, value: unknown) => unknown): unknown {
  const ref = asRowRef(markers);
  if (ref) return row(ref, data);
  markers = escapedFields(markers) ?? markers;
  if (!markers || !data || typeof markers !== "object" || typeof data !== "object") return data;
  for (const key of Object.keys(data)) {
    const before = (data as Record<string, unknown>)[key];
    const after = mapExpandedRows((markers as Record<string, unknown>)[key], before, row);
    if (!Object.is(after, before)) (data as Record<string, unknown>)[key] = after;
  }
  return data;
}

export function mapRowValues(value: unknown, resolve: (ref: RowRef) => unknown): unknown {
  const ref = asRowRef(value);
  if (ref) return resolve(ref);
  if (Array.isArray(value)) return value.map((item) => mapRowValues(item, resolve));
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(escapedFields(value) ?? value)
    .map(([key, item]) => [key, mapRowValues(item, resolve)]));
}

export function collectRefs(value: unknown): RowRef[] {
  const refs = new Map<string, RowRef>();
  // @ref LLP 1018.008.007.000#a2--remove-unnecessary-traversal-and-preparation
  // Collection owns no transformed parent values and confers no image custody.
  const visit = (item: unknown): void => {
    const ref = asRowRef(item);
    if (ref) { refs.set(rowKey(ref), ref); return; }
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (!object(item)) return;
    const fields = escapedFields(item) ?? item;
    for (const key of Object.keys(fields)) visit(fields[key]);
  };
  visit(value);
  return [...refs.values()];
}

/** No field-level provenance exists for projections: invalidate their literals,
 * while preserving references to the other rows still held by the answer. */
export function purgeAnswerData(value: unknown, evicted: RowRef): unknown {
  const ref = asRowRef(value);
  if (ref) return ref.table === evicted.table && ref.id === evicted.id ? null : value;
  if (Array.isArray(value)) return value.map((item) => purgeAnswerData(item, evicted));
  if (!object(value)) return null;
  const escaped = escapedFields(value);
  const data = Object.fromEntries(Object.entries(escaped ?? value)
    .map(([key, item]) => [key, purgeAnswerData(item, evicted)]));
  return escaped ? { $row: { $value: data } } : data;
}

export function rowKey(ref: RowRef): string {
  return `${ref.table}\u0000${ref.id}`;
}

export function hiddenRefs(before: unknown, after: unknown, output = new Map<string, RowRef>()): RowRef[] {
  collectHiddenRefs(before, after, output);
  return [...output.values()];
}

// @ref LLP 1018.008.004#3-first-slice-remove-duplicate-work-within-existing-contracts
// Recursive callers need only the shared collection, not a copy at every node.
function collectHiddenRefs(before: unknown, after: unknown, output: Map<string, RowRef>): void {
  if (after === null || after === undefined) {
    for (const ref of collectRefs(before)) output.set(rowKey(ref), ref);
    return;
  }
  if (asRowRef(before)) return;
  before = escapedFields(before) ?? before;
  after = escapedFields(after) ?? after;
  if (Array.isArray(before) && Array.isArray(after)) {
    for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
      collectHiddenRefs(before[index], after[index], output);
    }
  } else if (before && after && typeof before === "object" && typeof after === "object"
    && !Array.isArray(before) && !Array.isArray(after)) {
    for (const key of Object.keys(before as object)) {
      collectHiddenRefs(
        (before as Record<string, unknown>)[key],
        Object.hasOwn(after, key) ? (after as Record<string, unknown>)[key] : undefined,
        output,
      );
    }
  }
}

/** Restore references whose retention policy survived a partial fresh answer. */
export function restoreRetained(
  before: unknown, after: unknown, retained: Set<string>, clone: <T>(value: T) => T,
): unknown {
  const ref = asRowRef(before);
  if (ref && (after === null || after === undefined) && retained.has(rowKey(ref))) return before;
  if (Array.isArray(before) && Array.isArray(after)) {
    const result = after.map((item, index) => index < before.length
      ? restoreRetained(before[index], item, retained, clone) : item);
    for (let index = after.length; index < before.length; index += 1) {
      if (collectRefs(before[index]).some((item) => retained.has(rowKey(item)))) result.push(clone(before[index]));
    }
    return result;
  }
  if (before && after && typeof before === "object" && typeof after === "object"
    && !Array.isArray(before) && !Array.isArray(after)) {
    const result = clone(after as Record<string, unknown>);
    for (const key of Object.keys(before as object)) {
      const old = (before as Record<string, unknown>)[key];
      if (Object.hasOwn(result, key)) result[key] = restoreRetained(old, result[key], retained, clone);
      else if (collectRefs(old).some((item) => retained.has(rowKey(item)))) result[key] = clone(old);
    }
    return result;
  }
  if ((after === null || after === undefined)
    && collectRefs(before).some((item) => retained.has(rowKey(item)))) return clone(before);
  return after;
}
