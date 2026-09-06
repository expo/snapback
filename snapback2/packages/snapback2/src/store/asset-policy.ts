// @ref LLP 1006#2a1-one-use-image-delivery-clique-f3-2026-09-05 — once is column custody, never an application predicate.
import type { OfflineSchema, StoredRow } from "./range-store.js";

export type OnceColumns = Record<string, string[]>;
function object(value: unknown): value is Record<string, any> { return value !== null && typeof value === "object" && !Array.isArray(value); }
export function onceType(type: unknown): boolean {
  return object(type) && (type.Image?.once === true || onceType(type.Optional) || onceType(type.List?.of));
}
export function onceColumns(schema: OfflineSchema): OnceColumns {
  return Object.fromEntries(Object.entries(schema.tables ?? {}).flatMap(([table, spec]) => {
    const columns = Object.entries(spec.columns ?? {}).filter(([, type]) => onceType(type)).map(([name]) => name);
    return columns.length ? [[table, columns]] : [];
  }));
}
export function onceRow(columns: OnceColumns, row: StoredRow): boolean {
  return (columns[row.table] ?? []).some(column => row.row[column] != null);
}
export function onceAssetIds(columns: OnceColumns, rows: Iterable<StoredRow>): Set<string> {
  const ids = new Set<string>();
  const collect = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (object(value) && typeof value.id === "string") ids.add(value.id);
  };
  for (const row of rows) for (const column of columns[row.table] ?? []) collect(row.row[column]);
  return ids;
}
/** Scrub media even when a query projects it under an alias or out of its row. */
export function nullOnceMedia(value: unknown, ids: Set<string>): unknown {
  if (Array.isArray(value)) return value.map(item => nullOnceMedia(item, ids));
  if (!object(value)) return value;
  if (typeof value.id === "string" && ids.has(value.id) && "width" in value && "height" in value) return null;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, nullOnceMedia(item, ids)]));
}
