// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — an escaped
// application object is traversed through its fields, never re-read as a marker.
import type { RowRef } from "./range-store.js";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

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
  mapRowValues(value, (ref) => { refs.set(`${ref.table}\u0000${ref.id}`, ref); });
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
