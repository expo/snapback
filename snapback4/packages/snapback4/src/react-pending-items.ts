import type { Client } from "./contract.ts";
import { pendingIntentAccess, type PendingIntent } from "./pending-items.ts";

const EMPTY: readonly PendingIntent[] = [];
const sources = new WeakMap<Client, PendingIntents>();
export function pendingItemsSource(client: Client): PendingIntents {
  let source = sources.get(client);
  if (!source) { source = new PendingIntents(client); sources.set(client, source); }
  return source;
}
// @ref LLP 3000.019#3.3.1 — a scope fence is synchronous, including during a
// failed/held refresh. Ordinary invalidation never invents terminal retirement.
class PendingIntents {
  private value = EMPTY;
  private scope: unknown;
  private revision = 0;
  private stop: (() => void) | undefined;
  private listeners = new Set<() => void>();
  private access;
  constructor(private client: Client) { this.access = pendingIntentAccess(client); }
  getSnapshot = () => this.scope != null && this.scope === this.access.scope() ? this.value : EMPTY;
  getServerSnapshot = () => EMPTY;
  private refresh = () => {
    const revision = ++this.revision, scope = this.access.scope();
    if (scope !== this.scope || scope == null) {
      this.scope = scope; this.value = EMPTY;
      for (const notify of this.listeners) notify();
    }
    if (scope == null) return;
    void this.access.read().then(value => {
      if (!this.listeners.size || revision !== this.revision || scope !== this.access.scope()) return;
      if (JSON.stringify(value) === JSON.stringify(this.value)) return;
      this.value = value;
      for (const notify of this.listeners) notify();
    }).catch(() => { /* Storage failure is not evidence of retirement. */ });
  };
  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    if (!this.stop) {
      const stops = [this.client.onPendingWrites(this.refresh), this.client.onViewer(this.refresh), this.client.onSession(this.refresh), this.client.onLink(this.refresh)];
      this.stop = () => stops.forEach(stop => stop());
      this.refresh();
    }
    return () => {
      this.listeners.delete(notify);
      if (this.listeners.size) return;
      this.stop?.(); this.stop = undefined; this.revision++; this.value = EMPTY; this.scope = undefined;
    };
  };
}
