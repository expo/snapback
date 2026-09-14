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
const waiting = new Set<() => void>();

export function exitTransport(doFetch: typeof fetch, base: string) {
  const inflight = new Set<string>();
  let pending: readonly PendingSend[] = [];
  let headers: Record<string, string> = {};
  let current = () => true;
  const pump = () => {
    waiting.delete(pump);
    if (!current()) { pending = []; return; }
    const deferred: PendingSend[] = [];
    // @ref LLP 3000.007#20.4 — dispatch committed writes synchronously on page exit; replay keeps the same mutation id
    for (const entry of pending) {
      if (inflight.has(entry.id)) continue;
      const body = JSON.stringify({ id: entry.id, args: entry.args, newIds: entry.newIds });
      const bytes = new TextEncoder().encode(body).byteLength;
      // A mutation is atomic: its body cannot be split across /m requests.
      // Oversize entries stay durable for ordinary sends or reopen. Beacon
      // cannot carry our auth headers and shares this quota. Split a larger
      // queue into waves while the page is still alive to start the next wave.
      if (bytes > KEEPALIVE_BYTES) continue;
      if (bytes + inflightBytes > KEEPALIVE_BYTES) { deferred.push(entry); continue; }
      inflight.add(entry.id);
      inflightBytes += bytes;
      const release = () => {
        inflight.delete(entry.id); inflightBytes -= bytes;
        for (const next of [...waiting]) next();
      };
      try {
        // No page AbortSignal: close() must not cancel this request. Leave
        // settlement to normal sends/sync receipts, including after reopening.
        void doFetch(`${base}/m/${entry.op}`, { method: "POST", headers: { ...headers }, body, keepalive: true })
          .then(async response => { await response.arrayBuffer(); })
          .catch(() => {})
          .finally(release);
      } catch { inflight.delete(entry.id); inflightBytes -= bytes; }
    }
    pending = deferred;
    if (pending.length) waiting.add(pump);
  };
  return (entries: readonly PendingSend[], credentials: Record<string, string>, isCurrent = () => true) => {
    pending = entries;
    headers = credentials;
    current = isCurrent;
    pump();
  };
}
