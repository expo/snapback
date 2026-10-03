import type { Client, PendingWrite } from "./contract.ts";
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
  private selections = new Map<() => void, (write: PendingWrite) => boolean>();
  private access;
  constructor(private client: Client) { this.access = pendingIntentAccess(client); }
  getSnapshot = () => this.scope != null && this.scope === this.access.scope() ? this.value : EMPTY;
  getServerSnapshot = () => EMPTY;
  private refresh = () => {
    const revision = ++this.revision, scope = this.access.scope(), sourceRevision = this.access.revision?.();
    if (scope !== this.scope || scope == null) {
      this.scope = scope; this.value = EMPTY;
      for (const notify of this.listeners) notify();
    }
    if (scope == null) return;
    void this.access.read().then(value => {
      if (!this.listeners.size || revision !== this.revision || scope !== this.access.scope() || sourceRevision !== this.access.revision?.()) return;
      const owned = value.filter(this.owned);
      if (JSON.stringify(owned) === JSON.stringify(this.value)) return;
      this.value = owned;
      for (const notify of this.listeners) notify();
    }).catch(() => { /* Storage failure is not evidence of retirement. */ });
  };
  private owned = (item: PendingIntent) => [...this.selections.values()].some(select => {
    try { return select(item.write); } catch { return false; }
  });
  refreshSelection = () => {
    const owned = this.value.filter(this.owned);
    if (owned.length !== this.value.length) { this.value = owned; for (const notify of this.listeners) notify(); }
    this.refresh();
  };
  subscribe = (notify: () => void, select: (write: PendingWrite) => boolean = () => true) => {
    const release = this.access.retain?.(select);
    this.listeners.add(notify);
    this.selections.set(notify, select);
    if (!this.stop) {
      const stops = [this.client.onPendingWrites(this.refresh), this.client.onViewer(this.refresh), this.client.onSession(this.refresh), this.client.onLink(this.refresh)];
      this.stop = () => stops.forEach(stop => stop());
      this.refresh();
    }
    return () => {
      release?.();
      this.listeners.delete(notify); this.selections.delete(notify);
      if (this.listeners.size) { this.refreshSelection(); return; }
      this.stop?.(); this.stop = undefined; this.revision++; this.value = EMPTY; this.scope = undefined;
    };
  };
}
