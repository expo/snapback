import type { Client, Query, Read, Observed, ObserveOptions, Cursor } from "./contract.ts";
import { isReady } from "./contract.ts";
import { peekObservation } from "./observe-watch.ts";
const LOADING: Read<never> = { loading: true };

/** A page resource: the pages a screen has asked for, concatenated, and a way to ask for one more. */
export class Pages<A extends { c?: Cursor | null }, R extends readonly unknown[]> {
  private pages: { cursor: Cursor | null; observed: Observed<R>; unsubscribe: () => void }[] = [];
  private requested = 1;
  private subs = new Set<() => void>();
  private cache: { items: R[number][]; hasMore: boolean; read: Read<R> } | null = null;
  private peeked: Read<R> | undefined;
  private cacheReads: Read<R>[] = [];
  private reconciling = false;
  constructor(private client: Client, private op: Query<A, R>, private args: A, private options?: ObserveOptions) {}
  private open(c: Cursor | null) {
    const observed = this.client.observe(this.op, { ...this.args, c }, this.options);
    const page = { cursor: c, observed, unsubscribe: () => {} };
    this.pages.push(page);
    page.unsubscribe = observed.subscribe(() => {
      if (this.pages.includes(page)) this.notify();
    });
  }
  private drop(from: number) {
    for (const page of this.pages.splice(from)) {
      page.unsubscribe();
      page.observed.close();
    }
  }
  private notify() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      // A later page belongs to its predecessor's current cursor. Keep the
      // requested depth, but discard the old suffix before opening a new one:
      // deduplication alone cannot recover rows an old boundary skipped.
      for (let i = 0; i < this.pages.length; i++) {
        const read = this.pages[i]!.observed.getSnapshot();
        const next = isReady(read) && Array.isArray(read.data) ? read.next : null;
        if (!next || i + 1 >= this.requested || this.pages.slice(0, i + 1).some((p) => p.cursor === next)) {
          this.drop(i + 1);
          break;
        }
        if (this.pages[i + 1]?.cursor !== next) {
          this.drop(i + 1);
          this.open(next);
        }
      }
      this.cache = null;
    } finally { this.reconciling = false; }
    for (const s of this.subs) s();
  }
  subscribe = (notify: () => void) => {
    this.subs.add(notify);
    if (!this.pages.length) { this.open(null); this.notify(); }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.subs.delete(notify);
      if (!this.subs.size) { this.drop(0); this.cache = null; }
    };
  };
  getSnapshot = () => {
    const peeked = this.pages.length ? undefined : peekObservation(this.client, this.op, { ...this.args, c: null }, this.options);
    // An unsubscribed render owns no notifications: recheck the live snapshot
    // and the linger cutoff on every call, caching only its derived page shape.
    if (peeked !== this.peeked) { this.peeked = peeked; this.cache = null; }
    // @ref LLP 3000.023#5 — page accessors check deadlines before a combined cache can escape.
    let sources, reads: Read<R>[];
    do {
      sources = [...this.pages];
      reads = sources.length ? sources.map(page => page.observed.getSnapshot()) : peeked ? [peeked] : [];
      // A deadline check may synchronously drop a suffix through notify().
    } while (sources.length !== this.pages.length || sources.some((page, i) => page !== this.pages[i]));
    if (reads.length !== this.cacheReads.length || reads.some((read, i) => read !== this.cacheReads[i])) this.cache = null;
    this.cacheReads = reads;
    if (this.cache) return this.cache;
    const items: R[number][] = [];
    let last: Read<R> = LOADING as Read<R>;
    let complete = true, fresh = true, revalidating = false;
    let cut: import("./contract.ts").ReadCut = null;
    let since: number | undefined;
    let knownSince = true;
    let loadingMore = false;
    for (const read of reads) {
      // @ref LLP 3000.019#3.3 — a pending next page keeps the ready prefix on screen.
      // Resets of the first page and refusals still replace the combined read.
      if ("loading" in read && isReady(last)) { loadingMore = true; break; }
      last = read;
      if (!isReady(read)) break;
      if (!Array.isArray(read.data)) { last = LOADING as Read<R>; break; }
      items.push(...(read.data as readonly R[number][]));
      complete &&= read.complete;
      if (read.cut === "meter" || (cut === null && read.cut === "words")) cut = read.cut;
      fresh &&= read.fresh;
      revalidating ||= read.revalidating === true;
      if (!read.fresh) {
        if (read.since == null) knownSince = false;
        else since = Math.min(since ?? read.since, read.since);
      }
    }
    const hasMore = !loadingMore && isReady(last) && last.next != null && !this.pages.some((p) => p.cursor === last.next);
    const read: Read<R> = isReady(last)
      ? { data: items as unknown as R, complete, cut, fresh, ...(revalidating ? { revalidating: true } : {}), ...(knownSince && since != null ? { since } : {}), ...(last.next !== undefined ? { next: last.next } : {}) }
      : last;
    this.cache = { items, hasMore, read };
    return this.cache;
  };
  loadMore = () => {
    if (!this.subs.size || !this.getSnapshot().hasMore) return;
    this.requested = Math.max(this.requested, this.pages.length + 1);
    this.notify();
  };
}

