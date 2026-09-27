import type { Client, Read } from "./contract.ts";
import type { localDelivery } from "./local-delivery.ts";
import type { ReadObservation } from "./read-observation.ts";
import { offerDelivery } from "./delivery-acceptance.ts";

// @ref LLP 3000.022#4 — acceptance is synchronous; collection can only under-report.
export function publishDelivery(queue: ReturnType<typeof localDelivery> | undefined,
  result: { read: Read<unknown>; delivery?: unknown }, current: () => boolean, publish: () => boolean,
  publication?: { client: Client; watch?: ReadObservation<unknown> | undefined }): boolean {
  if (!current() || !publish()) return false;
  // Publication runs once. Every collection attempt, including a CAS retry,
  // checks current again; failure cannot unaccept or republish the answer.
  const collect = (fence = current) => {
    if ("data" in result.read && Array.isArray(result.delivery) && result.delivery.length && queue)
      void queue.accept(result.delivery, fence).catch(() => {});
  };
  if (publication) offerDelivery(publication.client, publication.watch?.snapshot ?? result.read, collect, current);
  else collect(current);
  return true;
}
