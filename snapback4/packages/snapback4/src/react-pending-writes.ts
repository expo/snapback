import type { Client, PendingWrite } from "./contract.ts";

const EMPTY: readonly PendingWrite[] = [];

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
      this.value = this.op === undefined ? entries : entries.filter(entry => entry.op === this.op);
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
