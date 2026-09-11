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
/** Scrub media even when a query projects it under an alias or out of its row. */
export function nullOnceMedia(value: unknown, ids: Set<string>, scrubbed?: Set<string>): unknown {
  if (Array.isArray(value)) return value.map(item => nullOnceMedia(item, ids, scrubbed));
  if (!object(value)) return value;
  if (typeof value.id === "string" && ids.has(value.id) && "width" in value && "height" in value) {
    scrubbed?.add(value.id); return null;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, nullOnceMedia(item, ids, scrubbed)]));
}

/** Incremental media custody shared by the carrier and effective twin rows. */
export class RowAssets {
  readonly once = new Set<string>();
  readonly exhausted: Record<string, { at: number; assets: string[] }> = {};
  private rows = new Map<string, Set<string>>();
  private counts = new Map<string, number>();
  constructor(private columns: OnceColumns) {}
  set(key: string, row?: StoredRow, viewed?: { at: number; assets: string[] }): void {
    for (const id of this.rows.get(key) ?? []) {
      const n = this.counts.get(id)! - 1;
      if (n) this.counts.set(id, n); else { this.counts.delete(id); this.once.delete(id); }
    }
    this.rows.delete(key); delete this.exhausted[key];
    const assets = row ? onceAssetIds(this.columns, [row]) : new Set<string>();
    if (assets.size) {
      this.rows.set(key, assets);
      for (const id of assets) { this.counts.set(id, (this.counts.get(id) ?? 0) + 1); this.once.add(id); }
    }
    if (viewed && (!row || !this.columns[row.table]?.length || (assets.size > 0 && [...assets].every(id => viewed.assets.includes(id))))) this.exhausted[key] = viewed;
  }
}
