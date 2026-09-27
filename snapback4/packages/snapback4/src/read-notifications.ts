// @ref LLP 3000.023#3.4 — shared approvals withdraw with their sources before any reset callback.
let pending: (() => void)[] | undefined;
export function deliverReadNotifications(deliveries: (() => void)[]): void {
  if (pending) pending.push(...deliveries);
  else for (const deliver of deliveries) deliver();
}
export function deferReadNotifications(withdraw: () => void): () => void {
  const prior = pending, deliveries: (() => void)[] = [];
  pending = deliveries;
  try { withdraw(); } finally { pending = prior; }
  return () => deliverReadNotifications(deliveries);
}
