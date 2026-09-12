import type { ChangedRecords } from "./swap-journal.js";
import type { OutboxEntry, PersistedRangeState } from "./range-store.js";
import { immutable } from '../../../evaluator/src/row-image.js';

export type QueryInputChange = "semantic" | "items";

/** The carrier's durable FIFO order, including its legacy timestamp tie-break. */
export const outboxFifo = (a: OutboxEntry, b: OutboxEntry): number =>
  (a.order ?? a.createdAt) - (b.order ?? b.createdAt) || a.intent.localeCompare(b.intent);
export function outboxOrder(entries: Record<string, OutboxEntry>, queued = false): OutboxEntry[] {
  const selected = Object.values(entries);
  return (queued ? selected.filter(entry => entry.state === "queued") : selected).sort((a, b) =>
    (a.order ?? a.createdAt) - (b.order ?? b.createdAt) || a.createdAt - b.createdAt || (a.intent < b.intent ? -1 : 1));
}

// @ref LLP 1018.008.007.002#6-reduce-the-remaining-preparation-and-publication-work —
// Journal records copy on write. Freeze the owned version once for presentation;
// ordinary public ledger reads still detach, and later writes replace the record.
export function itemEntry(entry: OutboxEntry): OutboxEntry {
  return Object.isFrozen(entry) ? entry : immutable(entry);
}

const RECORDS = ["answers", "rows", "negative", "extentNegative", "rowSeq", "viewed", "overlay", "overlayNegatives", "watermarks"];
const ROOTS = [...RECORDS, "facts", "superseded", "programs", "onceColumns", "sealed", "outbox"];

// @ref LLP 1018.008.007.001#5-avoid-redundant-query-work-without-suppressing-progress — a real
// removed overlay is journal-visible; a retained one is in the committed state. No row scan is needed.
export function changesQueryInputs(changed: ChangedRecords, state: Pick<PersistedRangeState, "overlay">): QueryInputChange | undefined {
  if (RECORDS.some((category) => (changed.get(category)?.size ?? 0) > 0)) return "semantic";
  const roots = changed.get("*");
  if (roots !== undefined && ROOTS.some((key) => roots.has(key))) return "semantic";
  const outbox = changed.get("outbox");
  if (outbox && [...outbox].some(intent => Object.hasOwn(state.overlay, intent))) return "semantic";
  if (outbox?.size || roots?.has("compactedThrough")) return "items";
  return undefined;
}
