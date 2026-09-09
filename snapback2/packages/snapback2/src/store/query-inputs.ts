import type { ChangedRecords } from "./swap-journal.js";
import type { OutboxEntry } from "./range-store.js";

/** The carrier's durable FIFO order, including its legacy timestamp tie-break. */
export function outboxOrder(entries: Record<string, OutboxEntry>): OutboxEntry[] {
  return Object.values(entries).sort((a, b) =>
    (a.order ?? a.createdAt) - (b.order ?? b.createdAt) || a.createdAt - b.createdAt || (a.intent < b.intent ? -1 : 1));
}

const RECORDS = ["answers", "rows", "negative", "extentNegative", "rowSeq", "viewed", "outbox", "overlay", "watermarks"];
const ROOTS = [...RECORDS, "facts", "superseded", "programs", "onceColumns", "sealed", "compactedThrough"];

/** Carrier fields read by `answer()` or the incremental twin; transport-only custody stays silent. */
export function changesQueryInputs(changed: ChangedRecords): boolean {
  if (RECORDS.some((category) => (changed.get(category)?.size ?? 0) > 0)) return true;
  const roots = changed.get("*");
  return roots !== undefined && ROOTS.some((key) => roots.has(key));
}
