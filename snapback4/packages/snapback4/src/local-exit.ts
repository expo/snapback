import type { Refusal } from "./contract.ts";

/** The committed web outbox's transport view, available without an async read. */
export interface PendingSend {
  id: string;
  op: string;
  args: unknown;
  newIds: string[];
  store_id: string | undefined;
}

// Fetch's quota is the sum of outstanding keepalive bodies, across clients
// in this page, not a per-request limit. Other libraries may also consume it.
const KEEPALIVE_BYTES = 64 * 1024;
const EXIT_WAIT_MS = 1000;
let inflightBytes = 0;
export function exitTransport(doFetch: typeof fetch, base: string, closed?: AbortSignal, refused?: (entry: PendingSend, why: Refusal) => Promise<void>, held?: (entry: PendingSend, why: Refusal) => Promise<void>) {
  let active: Promise<void> | undefined;
  // @ref LLP 3000.007#20.4 — exit retries only the oldest head, including an ordinary send whose outcome may be unknown after teardown.
  return (entries: readonly PendingSend[], headers: Record<string, string>, isCurrent = () => true): Promise<void> | undefined => {
    if (active) return active;
    const entry = entries[0];
    if (!entry?.store_id) return;
    // @ref LLP 3000.013#6 — server enforcement closes the race between validation and delivery.
    const body = JSON.stringify({ id: entry.id, args: entry.args, newIds: entry.newIds, store_id: entry.store_id });
    const bytes = new TextEncoder().encode(body).byteLength;
    // No ordered batch exists. Never bypass a blocked head or dispatch its
    // successors without settlement; the remaining queue flushes on reopen.
    if (bytes + inflightBytes > KEEPALIVE_BYTES || !isCurrent()) return;
    inflightBytes += bytes;
    try {
      // No page AbortSignal on fetch: close() stops waiting, not delivery.
      // A timeout leaves the outcome unknown: ordinary flushing must replay
      // this same durable head before advancing. Keep the active slot and
      // quota until actual completion, so another exit cannot overlap it.
      const done = doFetch(`${base}/m/${entry.op}`, { method: "POST", headers: { ...headers }, body, keepalive: true })
        .then(async response => {
          const json = await response.json(), why = json.why ?? json.denied;
          // @ref LLP 3000.019#3.3 — a live page can show the exit send's hold,
          // without changing keepalive's existing receipt/settlement policy.
          if (why?.retryable) await held?.(entry, why);
          if (why?.code === "E_STORE_REPLACED" && !why.retryable) await refused?.(entry, why);
        })
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
