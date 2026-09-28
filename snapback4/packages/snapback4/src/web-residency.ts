import type { Residency } from "./contract.ts";
import type { Change } from "./web.ts";
import { utf8Size as bytes } from "./utf8-size.ts";


// @ref LLP 3000.019#3.4 — count committed persistence deltas without exporting or rescanning the wasm partition.
export class WebResidency {
  private records = new Map<string, Map<string, number>>();
  private tables = new Map<string, { rows: number; bytes: number }>();
  private names: string[] = [];
  private total = 0;

  reset(saved: readonly Change[]): void {
    this.records.clear(); this.tables.clear(); this.names = []; this.total = 0;
    this.apply(saved);
  }

  apply(changes: readonly Change[]): void {
    for (const { s, k, v } of changes) {
      let records = this.records.get(s);
      if (!records) { records = new Map(); this.records.set(s, records); }
      const old = records.get(k);
      const size = v === null ? undefined : bytes(v);
      const keyBytes = bytes(s) + bytes(k);
      if (old !== undefined) this.total -= keyBytes + old;
      if (size !== undefined) { records.set(k, size); this.total += keyBytes + size; }
      else records.delete(k);
      if (s === "r") {
        const [name] = JSON.parse(k) as [string, string];
        const table = this.tables.get(name) ?? { rows: 0, bytes: 0 };
        table.rows += Number(size !== undefined) - Number(old !== undefined);
        table.bytes += (size ?? 0) - (old ?? 0);
        if (table.rows) this.tables.set(name, table); else this.tables.delete(name);
      }
      if (s === "m" && k === "device:backend") {
        const schema = v === null ? undefined : JSON.parse(v).schema;
        const hidden = new Set((schema?.maintains ?? []).filter((m: { private?: unknown }) => m.private).map((m: { target: string }) => m.target));
        // @ref LLP 3000.028#3.4 — builders measure their explicit owner-key partitions alongside the public window.
        const ownKeys = new Set((schema?.maintains ?? []).filter((m: { own_keys?: unknown }) => m.own_keys).map((m: { target: string }) => m.target));
        this.names = Object.keys(schema?.tables ?? {}).filter(name => !hidden.has(name) && (!name.startsWith("$") || ownKeys.has(name)));
      }
    }
  }

  snapshot(wasmHeapBytes: number): Residency {
    return {
      tables: Object.fromEntries(this.names.map(name => [name, { ...(this.tables.get(name) ?? { rows: 0, bytes: 0 }) }])),
      totalBytes: this.total, totalBytesKind: "logical", wasmHeapBytes,
    };
  }
}
