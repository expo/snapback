/** The committed web outbox's transport view, available without an async read. */
export interface PendingSend {
  id: string;
  op: string;
  args: unknown;
  newIds: string[];
}

// Fetch's quota is the sum of outstanding keepalive bodies, across clients
// in this page, not a per-request limit. Other libraries may also consume it.
const KEEPALIVE_BYTES = 64 * 1024;
let inflightBytes = 0;
export function exitTransport(doFetch: typeof fetch, base: string) {
  let active: Promise<void> | undefined;
  // @ref LLP 3000.007#20.4 — the exit transport preserves durable submission order, sharing ordinary sends' exclusion.
  return (entries: readonly PendingSend[], headers: Record<string, string>, isCurrent = () => true): Promise<void> | undefined => {
    if (active) return active;
    const entry = entries[0];
    if (!entry) return;
    const body = JSON.stringify({ id: entry.id, args: entry.args, newIds: entry.newIds });
    const bytes = new TextEncoder().encode(body).byteLength;
    // No ordered batch exists. Never bypass a blocked head or dispatch its
    // successors without settlement; the remaining queue flushes on reopen.
    if (bytes + inflightBytes > KEEPALIVE_BYTES || !isCurrent()) return;
    inflightBytes += bytes;
    try {
      // No page AbortSignal: close() must not cancel this request. Ordinary
      // flushing waits for it, then replays the durable head to settle it.
      active = doFetch(`${base}/m/${entry.op}`, { method: "POST", headers: { ...headers }, body, keepalive: true })
        .then(async response => { await response.arrayBuffer(); })
        .catch(() => {})
        .finally(() => { inflightBytes -= bytes; active = undefined; });
      return active;
    } catch { inflightBytes -= bytes; }
  };
}
