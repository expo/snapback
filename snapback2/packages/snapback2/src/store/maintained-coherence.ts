// @ref LLP 1018.000#4-one-observed-query-one-coherent-snapshot — source rows and their
// engine-maintained targets cannot authorize different revisions of one named value.
import { RowImage } from "../../../evaluator/src/row-image.js";
import type { PreparedRange } from "../../../evaluator/src/range-preparation.js";
import { asInt, canonicalValues, field, materializeOptionalFields, totalCompare } from "../../../evaluator/src/value-runtime.js";
import { tagWireRow, type TaggedValue, type WireValue } from "../offline-protocol.js";
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
  private readonly deltas = new Map<string, [bigint, number, string[], TaggedValue[]]>();

  constructor(private readonly schema?: any) {
    this.maintains = schema?.maintains ?? [];
  }

  *committed(entries: OutboxEntry[], overlays: Record<string, OverlayRow[]>, proposed: Record<string, OverlayRow[]> = {}): Iterable<StoreTombstone> {
    for (const entry of entries) {
      const seq = (entry.response as { seq?: unknown } | undefined)?.seq;
      if (entry.state !== "committed" || !Number.isSafeInteger(seq)) continue;
      for (const row of proposed[entry.intent] ?? overlays[entry.intent] ?? []) {
        if (this.maintains.some((maintain) => maintain.target === row.table)) yield { table: row.table, id: row.id, seq: seq as number };
      }
    }
  }

  transition(old: StoredRow | undefined, next: StoredRow | undefined, seq: number,
    target: Pick<StoredRow, "table" | "id"> | undefined = next ?? old): void {
    if (old) this.contribution(old, -1, seq);
    if (next) this.contribution(next, 1, seq);
    if (target && this.maintains.some((maintain) => maintain.target === target.table)) {
      const key = rowKey(target);
      this.targetChanges.set(key, Math.max(this.targetChanges.get(key) ?? -1, seq));
    }
  }

  *invalidations(): Iterable<StoreTombstone> {
    for (const [key, change] of this.deltas) if (change[0]) yield { ...factRow(key)!, seq: change[1] };
  }

  // @ref LLP 1012#6-reads-offline — an exact typed group prefix can retain its
  // range when a source transition withdraws authority for a different group.
  disjoint(key: string, range: PreparedRange): boolean {
    const change = this.deltas.get(key);
    if (!change) return false;
    return range.meaning.prefix.some((atom, index) => change[2][index]
      && (range.parts[index] as any).Column === change[2][index]
      && totalCompare((atom as any).Scalar, change[3][index]));
  }

  private contribution(row: StoredRow, direction: 1 | -1, seq: number): void {
    if (!this.schema) return;
    let source: TaggedValue | undefined;
    for (const maintain of this.maintains) {
      if (maintain.source !== row.table) continue;
      source ??= materializeOptionalFields(this.schema, row.table, RowImage.is(row.row)
        ? row.row as unknown as TaggedValue
        : tagWireRow(this.schema, row.table, row.row as Record<string, WireValue>));
      const group = maintain.by.map((name) => field(source as any, name));
      const amount = maintain.kind === "Count" ? 1n : BigInt(asInt(field(source as any, maintain.kind.Sum.of)));
      const key = rowKey({ table: maintain.target, id: canonicalValues(group as any) });
      const previous = this.deltas.get(key);
      this.deltas.set(key, [(previous?.[0] ?? 0n) + BigInt(direction) * amount,
        Math.max(previous?.[1] ?? -1, seq), maintain.by, group as TaggedValue[]]);
    }
  }
}
