// @ref LLP 1018.003#10-retirement-is-a-read-model-decision-dismissal-is-a-write —
// a row's evidence travels with its image, through decoding, reduction, and publication.
import { RowImage } from "../../evaluator/src/row-image.js";
import { fieldOrNull, wireJson } from "../../evaluator/src/value-runtime.js";
import { asRowRef, escapedFields } from "./store/row-values.js";
import { canonicalAnswerKey, type PersistedRangeState, type StoredAnswer } from "./store/range-store.js";
import { itemAddress, type ItemInputs, type ItemObservation } from "./client-items.js";
import type { DeliveryEnvelopeV1 } from "./offline-protocol.js";

function references(markers: unknown, data: unknown, row: (table: string, id: string, value: unknown) => void): void {
  const ref = asRowRef(markers);
  if (ref) { row(ref.table, ref.id, data); return; }
  markers = escapedFields(markers) ?? markers;
  if (!markers || !data || typeof markers !== "object" || typeof data !== "object") return;
  for (const key of Object.keys(markers)) references((markers as Record<string, unknown>)[key], (data as Record<string, unknown>)[key], row);
}

/** A server delivery certifies its own returned images, not later pool versions or halo identities. */
export function deliveredItemInputs(envelope: DeliveryEnvelopeV1, data: unknown, entries: ItemInputs["entries"]): ItemInputs {
  const values = new Map<object, string>(), observations = new Map<string, ItemObservation>();
  references(envelope.data, data, (table, id, value) => {
    if (!value || typeof value !== "object") return;
    const key = itemAddress(table, id);
    values.set(value, key); observations.set(key, { through: envelope.seq });
  });
  for (const [table, index, key] of envelope.receipt.absences) if (index === "byId" && key.length === 1 && typeof key[0] === "string") {
    const address = itemAddress(table, key[0]);
    if (!observations.has(address)) observations.set(address, { through: envelope.seq, absent: true });
  }
  return { entries, values, observations, predicted: new Map() };
}

/** Synchronous capture from the same durable image that answered the query. */
export class ItemCapture {
  private readonly values = new Map<object, string>();
  private readonly observations = new Map<string, ItemObservation>();
  private readonly held: StoredAnswer | undefined;
  constructor(private readonly state: PersistedRangeState, op: string, args: unknown,
    private readonly predicted: ItemInputs["predicted"] = new Map()) {
    this.held = state.answers[canonicalAnswerKey(op, args)];
    // Extent eviction and viewed-once bookkeeping are deliberately excluded.
    for (const [key, through] of Object.entries(state.negative)) {
      if ((state.rowSeq[key] ?? -1) <= through) this.observations.set(key, { through, absent: true });
    }
    if (this.held && !this.held.retained && this.held.state !== "denied") {
      for (const [table, index, key] of this.held.receipt?.absences ?? []) {
        if (index !== "byId" || key.length !== 1 || typeof key[0] !== "string") continue;
        const address = itemAddress(table, key[0]);
        if (!state.rows[address] && (this.observations.get(address)?.through ?? -1) <= this.held.seq)
          this.observations.set(address, { through: this.held.seq, order: this.held.order, absent: true });
      }
    }
  }
  private row(table: string, id: string, value: unknown): void {
    if (!value || typeof value !== "object") return;
    const key = itemAddress(table, id), row = this.state.rows[key], held = this.held;
    this.values.set(value, key);
    let through = this.state.rowSeq[key];
    if (!row || through === undefined || through <= (this.state.negative[key] ?? -1)) return;
    let order: number | undefined;
    // An unchanged answer can advance observation without changing the row.
    // Its original image proof must still match; retained/clock-only answers cannot.
    if (held && !held.retained && !held.clockOnly && held.state !== "denied" && held.seq >= through
      && RowImage.is(row.row) && held.rowProofs?.[key] === RowImage.digest(row.row)) {
      through = held.seq; order = held.order;
    }
    this.observations.set(key, { through, ...(order === undefined ? {} : { order }) });
  }
  /** The wire's actual pooled-row markers, paired with the final expanded public value. */
  references(markers: unknown, data: unknown): void {
    references(markers, data, (table, id, value) => this.row(table, id, value));
  }
  /** A real row image in the evaluator result retains its table identity. */
  evaluated(tagged: unknown, data: unknown): void {
    if (!tagged || !data || typeof tagged !== "object" || typeof data !== "object") return;
    if (RowImage.is(tagged)) {
      this.row(RowImage.table(tagged), String(wireJson(fieldOrNull(tagged, "id"))), data);
      return;
    }
    const value = tagged as { Array?: unknown[]; Map?: Record<string, unknown>; Row?: Record<string, unknown> };
    const entries = value.Array ?? value.Map ?? value.Row;
    if (entries) for (const key of Object.keys(entries)) this.evaluated((entries as Record<string, unknown>)[key], (data as Record<string, unknown>)[key]);
  }
  inputs(): ItemInputs {
    return { entries: Object.values(this.state.outbox).sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt)
      || a.intent.localeCompare(b.intent)), observations: this.observations, values: this.values, predicted: new Map(this.predicted) };
  }
}
