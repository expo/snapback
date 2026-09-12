import { imageField } from '../../../evaluator/src/row-image.js';
// @ref LLP 1006#2a1-one-use-image-delivery-clique-f3-2026-09-05 — once is column custody, never an application predicate.
import type { OfflineSchema, StoredRow } from "./range-store.js";
import { object } from "./row-values.js";

export type OnceColumns = Record<string, string[]>;
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
  return (columns[row.table] ?? []).some(column => imageField(row.row,column) != null);
}
export function onceAssetIds(columns: OnceColumns, rows: Iterable<StoredRow>): Set<string> {
  const ids = new Set<string>();
  const collect = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (object(value) && typeof value.id === "string") ids.add(value.id);
  };
  for (const row of rows) for (const column of columns[row.table] ?? []) collect(imageField(row.row,column));
  return ids;
}
/** The same row exhaustion test governs bytes, carrier projection, and the twin. */
export function onceExhausted(columns: OnceColumns | undefined, row: StoredRow | undefined, viewed: readonly string[], assets?: Set<string>): boolean {
  if (!row || !columns?.[row.table]?.length) return true;
  assets ??= onceAssetIds(columns, [row]);
  return assets.size > 0 && [...assets].every(id => viewed.includes(id));
}
/** Scrub media even when a query projects it under an alias or out of its row. */
export function nullOnceMedia(value: unknown, ids: { has(id: string, path: string, value: unknown): boolean }, scrubbed?: Map<string, { id: string }>, path = ""): unknown {
  if (Array.isArray(value)) return value.map((item, key) => nullOnceMedia(item, ids, scrubbed, path + JSON.stringify([key])));
  if (!object(value)) return value;
  if (typeof value.id === "string" && ids.has(value.id, path, value) && "width" in value && "height" in value) {
    scrubbed?.set(path, value as { id: string }); return null;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, nullOnceMedia(item, ids, scrubbed, path + JSON.stringify([key]))]));
}

/** Incremental media custody shared by the carrier and effective twin rows. */
export class RowAssets {
  // Membership and reference counts share one map; callers only ask has(id).
  readonly once = new Map<string, number>();
  readonly exhausted: Record<string, { at: number; assets: string[] }> = {};
  private rows = new Map<string, Set<string>>();
  constructor(private columns: OnceColumns) {}
  set(key: string, row?: StoredRow, viewed?: { at: number; assets: string[] }): void {
    for (const id of this.rows.get(key) ?? []) {
      const n = this.once.get(id)! - 1;
      if (n) this.once.set(id, n); else this.once.delete(id);
    }
    this.rows.delete(key); delete this.exhausted[key];
    const assets = row && onceAssetIds(this.columns, [row]);
    if (assets?.size) {
      this.rows.set(key, assets);
      for (const id of assets) { this.once.set(id, (this.once.get(id) ?? 0) + 1); }
    }
    if (viewed && onceExhausted(this.columns, row, viewed.assets, assets)) this.exhausted[key] = viewed;
  }
}
