import type { Client, PendingWrite } from "./contract.ts";

const EMPTY: readonly PendingWrite[] = [];
// @ref LLP 3000.019#3.3 — one view of existing custody, shared by row hooks; admission and settlement still invalidate it.
const sources = new WeakMap<Client, Map<string | undefined, PendingWrites>>();

/** One outbox observation per client/filter, however many rows render it. */
export function pendingWritesSource(client: Client, op?: string): PendingWrites {
  let byOperation = sources.get(client);
  if (!byOperation) { byOperation = new Map(); sources.set(client, byOperation); }
  let source = byOperation.get(op);
  if (!source) { source = new PendingWrites(client, op); byOperation.set(op, source); }
  return source;
}

/** Render is inert. Subscribe before reading, and fence an older asynchronous
 * list when admission, settlement, account change or effect replay overtakes it. */
export class PendingWrites {
  private value = EMPTY;
  private revision = 0;
  private stop: (() => void) | undefined;
  private listeners = new Set<() => void>();
  constructor(private client: Client, private op?: string) {}
  getSnapshot = () => this.value;
  getServerSnapshot = () => EMPTY;
  private refresh = () => {
    const revision = ++this.revision;
    void this.client.pendingWrites().then(entries => {
      if (!this.listeners.size || revision !== this.revision) return;
      const next = this.op === undefined ? entries : entries.filter(entry => entry.op === this.op);
      // Receipt application often leaves this list unchanged. Preserve its
      // snapshot identity so a notification cannot rerender every message.
      if (JSON.stringify(next) === JSON.stringify(this.value)) return;
      this.value = next;
      for (const notify of this.listeners) notify();
    }).catch(() => { /* A failed storage read says nothing about settlement. */ });
  };
  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    if (!this.stop) { this.stop = this.client.onPendingWrites(this.refresh); this.refresh(); }
    return () => {
      this.listeners.delete(notify);
      if (this.listeners.size) return;
      this.stop?.(); this.stop = undefined;
      this.revision++; this.value = EMPTY;
    };
  };
}
