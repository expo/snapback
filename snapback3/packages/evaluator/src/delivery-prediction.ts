// @ref LLP 1019#7-the-twin — a successful required membership point proves
// only the sender. Never enumerate an incomplete held audience.
import { asObject, canonicalValue, clone, field, int, rowValue } from './value-runtime';
import { sha256 } from './hash';
import type { Value } from './types';

type Proof = { table: string; row: Value; version: number };
export class DeliveryPrediction {
  private booleans = new WeakMap<object, Proof[]>();
  private required: Proof[] = [];
  private versions = new Map<string, number>();
  constructor(private schema: any, private viewer: string) {}
  point(result: Value, table: string, row: Value): Value {
    if (row !== 'Null' && typeof result === 'object')
      this.booleans.set(result, [{ table, row, version: this.versions.get(table) ?? 0 }]);
    return result;
  }
  copy(result: Value, ...inputs: Value[]): Value {
    if (typeof result === 'object') this.booleans.set(result,
      inputs.flatMap(v => typeof v === 'object' ? this.booleans.get(v) ?? [] : []));
    return result;
  }
  require(value: Value): void {
    if (typeof value === 'object') this.required.push(...this.booleans.get(value) ?? []);
  }
  changed(table: string): void { this.versions.set(table, (this.versions.get(table) ?? 0) + 1); }
  event(table: string, row: Value, now: number): { table: string; row: Value } | undefined {
    const d = this.schema.tables[table]?.deliver;
    if (!d || !this.required.some(p => p.table === d.target && p.version === (this.versions.get(p.table) ?? 0)
      && canonicalValue(field(p.row, d.principal)) === canonicalValue({ Id: this.viewer })
      && d.prefix.every((key: string) => canonicalValue(field(p.row, key)) === canonicalValue(field(row, key))))) return;
    const id = field(row, 'id');
    return { table: d.log, row: rowValue({
      id: { Id: `own:${sha256(canonicalValue(rowValue({ row: id, recipient: { Id: this.viewer } })))}` },
      row: clone(id), recipient: { Id: this.viewer }, kind: { String: 'delivered' },
      // Provisional metadata; the drain replaces the complete event image.
      incarnation: int(0), audience: int(0), seq: int(now), at: int(now),
      ...Object.fromEntries(d.prefix.map((key: string) => [key, asObject(row)[key]])),
    }) };
  }
}
