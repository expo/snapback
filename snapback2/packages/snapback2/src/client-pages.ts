import type { Op } from './api.js';
import type { Cursor, ObservedQuery, SnapbackClient } from './types.js';
import type { Snapshot } from './snapshot.js';

export interface PageSnapshot<Result extends readonly unknown[]> {
  readonly items: readonly Result[number][];
  readonly pages: readonly Snapshot<Result>[];
  loadMore(): void;
  readonly hasMore: boolean;
  readonly status: Snapshot<Result>['status'];
  readonly reason?: Snapshot<Result>['reason'];
}

/** Each continuation owns its live observation; changed boundaries rebind successors. */
export class ClientPages<Args, Result extends readonly unknown[]> {
  private wanted = 1;
  private entries: { cursor: Cursor | null; query: ObservedQuery<Result>; off?: () => void }[] = [];
  private readonly listeners = new Set<() => void>();
  private refreshing = false;
  private again = false;
  private snapshot!: PageSnapshot<Result>;
  constructor(private readonly client: SnapbackClient, private readonly op: Op<Args, Result>,
    private readonly args: unknown, private readonly cursor: string) { this.refresh(); }

  private refresh = () => {
    if (this.refreshing) { this.again = true; return; }
    this.refreshing = true;
    try {
      do {
        this.again = false;
        let next: Cursor | null = null;
        let length = 0;
        for (; length < this.wanted; length++) {
          if (length > 0 && next === null) break;
          let entry = this.entries[length];
          if (entry && entry.cursor !== next) { this.trim(length); entry = undefined!; }
          if (!entry) {
            const args = { ...(this.args as object), [this.cursor]: next } as Args;
            entry = { cursor: next, query: this.client.observe(this.op, args) };
            this.entries.push(entry);
          }
          if (this.listeners.size && !entry.off) entry.off = entry.query.subscribe(this.refresh);
          next = entry.query.getSnapshot().next;
        }
        this.trim(length);
      } while (this.again);
      const pages = this.entries.map(entry => entry.query.getSnapshot());
      if (this.snapshot && pages.length === this.snapshot.pages.length && pages.every((page, i) => page === this.snapshot.pages[i])) return;
      const unavailable = pages.find(page => page.status === 'unavailable');
      const loading = pages.find(page => page.status === 'loading');
      const reason = unavailable?.reason ?? pages.find(page => page.reason)?.reason;
      this.snapshot = Object.freeze({ items: Object.freeze(pages.flatMap(page => page.data ? [...page.data] : [])),
        pages: Object.freeze(pages), loadMore: this.loadMore, hasMore: pages.at(-1)?.next != null,
        status: unavailable ? 'unavailable' : loading ? 'loading' : 'ready', ...(reason ? { reason } : {}) });
      for (const listener of this.listeners) listener();
    } finally { this.refreshing = false; }
  };
  private trim(length: number) { for (const entry of this.entries.splice(length)) entry.off?.(); }
  private loadMore = () => {
    if (!this.snapshot.hasMore || this.snapshot.status === 'loading') return;
    this.wanted = this.entries.length + 1;
    this.refresh();
  };
  getSnapshot = (): PageSnapshot<Result> => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.refresh();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) for (const entry of this.entries) { entry.off?.(); entry.off = undefined; }
    };
  };
}
