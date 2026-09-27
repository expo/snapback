import type { Read } from "./contract.ts";
import type { localDelivery } from "./local-delivery.ts";

// @ref LLP 3000.022#4 — acceptance is synchronous; collection can only under-report.
export function publishDelivery(queue: ReturnType<typeof localDelivery> | undefined,
  result: { read: Read<unknown>; delivery?: unknown }, current: () => boolean, publish: () => boolean): boolean {
  if (!current() || !publish()) return false;
  if ("data" in result.read && Array.isArray(result.delivery) && result.delivery.length && queue) {
    // Publication runs once. Every collection attempt, including a CAS retry,
    // checks current again; failure cannot unaccept or republish the answer.
    void queue.accept(result.delivery, current).catch(() => {});
  }
  return true;
}
