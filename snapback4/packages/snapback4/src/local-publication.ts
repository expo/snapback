import type { Read } from "./contract.ts";
import type { localDelivery } from "./local-delivery.ts";

// @ref LLP 3000.022#3 — answer and manifest share one acceptance point.
// Publish synchronously after the last fences, before persisting its debt.
// CAS retries do not republish. Persistence failure cannot reject an answer.
export async function publishDelivery(queue: ReturnType<typeof localDelivery> | undefined,
  result: { read: Read<unknown>; delivery?: unknown }, current: () => boolean, publish: () => boolean): Promise<boolean> {
  let accepted: boolean | undefined;
  const commit = () => {
    if (accepted !== undefined) return accepted;
    if (!current()) return false;
    return accepted = publish();
  };
  if ("data" in result.read && Array.isArray(result.delivery) && result.delivery.length && queue) {
    try { await queue.accept(result.delivery, commit); } catch { /* Collection is supplementary to the answer. */ }
  }
  return accepted ?? commit();
}
