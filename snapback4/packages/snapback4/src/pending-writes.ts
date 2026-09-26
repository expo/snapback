import type { PendingWrite } from "./contract.ts";
import type { Queued } from "./local-types.ts";
import { successSequence } from "./local-receipts.ts";
import type { WriteHistory } from "./writes.ts";

// @ref LLP 3000.019#3.3 — notifications invalidate a view of existing custody;
// no second queue owns admission, delivery order or terminal outcomes.
export function pendingChanges() {
  const listeners = new Set<() => void>();
  return {
    subscribe(notify: () => void) { listeners.add(notify); return () => { listeners.delete(notify); }; },
    notify() {
      for (const notify of listeners) {
        try { notify(); } catch (error) { console.error("snapback4 pending writes listener:", error); }
      }
    },
    clear() { listeners.clear(); },
  };
}

export async function localPendingWrites(queued: () => Promise<Queued[]>, history: WriteHistory,
  unavailable: () => unknown, acquired: () => boolean): Promise<readonly PendingWrite[]> {
  if (unavailable()) return [];
  const entries = await queued();
  if (unavailable()) return [];
  const terminal = await history.settledIds();
  if (unavailable()) return [];
  return entries.filter(entry => successSequence(entry) == null && !terminal.has(entry.id)).map(entry => ({
    id: entry.id, op: entry.op, args: entry.args,
    state: entry.dispatch ? "held" : entry.dispatch != null || entry.sent_seq != null || entry.observed_seq != null ? "sent" : "queued",
    ...(entry.dispatch ? { reason: entry.dispatch } : !entry.predictable && !entry.predicted.length
      ? { reason: !acquired() ? "queued without a row: not acquired yet" : "queued without a row: local data does not justify prediction" } : {}),
    predicted: entry.predicted,
  }));
}
