/** A web write's transport view, captured at submission or restored from the outbox. */
export interface PendingSend {
  id: string;
  op: string;
  args: unknown;
  newIds: string[];
}

// Fetch's quota is the sum of outstanding keepalive bodies, across clients
// in this page, not a per-request limit. Other libraries may also consume it.
const KEEPALIVE_BYTES = 64 * 1024;
const EXIT_WAIT_MS = 1000;
const MAX_BATCH_WRITES = 32;
let inflightBytes = 0;
export function exitTransport(doFetch: typeof fetch, base: string, closed?: AbortSignal) {
  let active: Promise<void> | undefined;
  // @ref LLP 3000.007#20.4 — exit retries the durable head or sends pending admissions as one ordered prefix, never concurrent successors.
  return (entries: readonly PendingSend[], headers: Record<string, string>, isCurrent = () => true, ordered = false): Promise<void> | undefined => {
    if (active) return active;
    const entry = entries[0];
    if (!entry) return;
    let body = JSON.stringify({ id: entry.id, args: entry.args, newIds: entry.newIds });
    let path = `/m/${entry.op}`;
    const encoder = new TextEncoder();
    let bytes = encoder.encode(body).byteLength;
    if (ordered && entries.length > 1) {
      const batch: string[] = [];
      let batchBytes = encoder.encode('{"writes":[]}').byteLength;
      for (const candidate of entries.slice(0, MAX_BATCH_WRITES)) {
        const encoded = JSON.stringify(candidate);
        const size = encoder.encode(encoded).byteLength + (batch.length ? 1 : 0);
        if (batchBytes + size + inflightBytes > KEEPALIVE_BYTES) break;
        batch.push(encoded); batchBytes += size;
      }
      if (batch.length > 1) { body = `{"writes":[${batch.join(",")}]}`; path = "/m"; bytes = batchBytes; }
    }
    // Never bypass a blocked head. Pending admissions can share one ordered
    // request; a durable head keeps its ordinary same-ID replay path.
    if (bytes + inflightBytes > KEEPALIVE_BYTES || !isCurrent()) return;
    inflightBytes += bytes;
    try {
      // No page AbortSignal on fetch: close() stops waiting, not delivery.
      // A timeout leaves the outcome unknown: ordinary flushing must replay
      // this same durable head before advancing. Keep the active slot and
      // quota until actual completion, so another exit cannot overlap it.
      const done = doFetch(`${base}${path}`, { method: "POST", headers: { ...headers }, body, keepalive: true })
        .then(async response => { await response.arrayBuffer(); })
        .catch(() => {})
        .finally(() => { inflightBytes -= bytes; active = undefined; });
      active = waitForExit(done, closed);
      return active;
    } catch { inflightBytes -= bytes; }
  };
}

function waitForExit(done: Promise<void>, closed?: AbortSignal): Promise<void> {
  if (closed?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      closed?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, EXIT_WAIT_MS);
    closed?.addEventListener("abort", finish, { once: true });
    void done.then(finish);
  });
}
