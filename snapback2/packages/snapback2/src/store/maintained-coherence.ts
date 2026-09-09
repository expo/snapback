// @ref LLP 1018.000#4-one-observed-query-one-coherent-snapshot — source rows and their
// engine-maintained targets cannot authorize different revisions of one named value.
import { RowImage } from "../../../evaluator/src/row-image.js";
import { asInt, canonicalValues, field, materializeOptionalFields } from "../../../evaluator/src/value-runtime.js";
import { tagWireRow, type TaggedValue, type WireValue } from "../offline-protocol.js";
import { canonical } from "./canonical.js";
import { factRow } from "./fact-integrity.js";
import { rowKey } from "./row-values.js";
import type { OutboxEntry, OverlayRow, StoredRow, StoreTombstone } from "./range-store.js";

type Maintain = {
  kind: "Count" | { Sum: { of: string } };
  source: string;
  by: string[];
  target: string;
};

export class MaintainedTransitions {
  private readonly maintains: Maintain[];
  readonly targetChanges = new Map<string, number>();
  private readonly deltas = new Map<string, { delta: bigint; seq: number }>();
  private targets?: Set<string>;

  constructor(private readonly schema?: any) {
    this.maintains = schema?.maintains ?? [];
  }

  targetTables(): Set<string> {
    return this.targets ??= new Set(this.maintains.map((maintain) => maintain.target));
  }

  committed(entries: OutboxEntry[], overlays: Record<string, OverlayRow[]>, proposed: Record<string, OverlayRow[]> = {}): StoreTombstone[] {
    if (!entries.some((entry) => entry.state === "committed")) return [];
    const targets = this.targetTables(), result: StoreTombstone[] = [];
    for (const entry of entries) {
      const seq = (entry.response as { seq?: unknown } | undefined)?.seq;
      if (entry.state !== "committed" || !Number.isSafeInteger(seq)) continue;
      for (const row of proposed[entry.intent] ?? overlays[entry.intent] ?? []) {
        if (targets.has(row.table)) result.push({ table: row.table, id: row.id, seq: Number(seq) });
      }
    }
    return result;
  }

  transition(old: StoredRow | undefined, next: StoredRow | undefined, seq: number): void {
    if (old && next && canonical(old.row) === canonical(next.row)) return;
    if (old) this.contribution(old, -1, seq);
    if (next) this.contribution(next, 1, seq);
  }

  target(row: Pick<StoredRow, "table" | "id">, seq: number): void {
    if (!this.targetTables().has(row.table)) return;
    const key = rowKey(row);
    this.targetChanges.set(key, Math.max(this.targetChanges.get(key) ?? -1, seq));
  }

  invalidations(): StoreTombstone[] {
    return [...this.deltas].flatMap(([key, change]) => change.delta === 0n ? [] : [{ ...factRow(key)!, seq: change.seq }]);
  }

  private contribution(row: StoredRow, direction: 1 | -1, seq: number): void {
    const matches = this.maintains.filter((maintain) => maintain.source === row.table);
    if (!this.schema || matches.length === 0) return;
    const tagged = RowImage.is(row.row)
      ? row.row as unknown as TaggedValue
      : tagWireRow(this.schema, row.table, row.row as Record<string, WireValue>);
    const source = materializeOptionalFields(this.schema, row.table, tagged as any);
    for (const maintain of matches) {
      const group = maintain.by.map((name) => field(source as any, name));
      const amount = maintain.kind === "Count" ? 1n : BigInt(asInt(field(source as any, maintain.kind.Sum.of)));
      const key = rowKey({ table: maintain.target, id: canonicalValues(group as any) });
      const previous = this.deltas.get(key);
      this.deltas.set(key, { delta: (previous?.delta ?? 0n) + BigInt(direction) * amount,
        seq: Math.max(previous?.seq ?? -1, seq) });
    }
  }
}
