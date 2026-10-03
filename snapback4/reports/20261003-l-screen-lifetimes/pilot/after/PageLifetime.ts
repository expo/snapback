import type { Client, Observed, Query } from "snapback4/contract";

// @ref LLP 3000.023#13 — a recipe owner marker, never an answer or cursor cache.
// The root watch is shared with usePage. Observe every withdrawal synchronously,
// even if React batches loading and its replacement into a single render.
export class PageLifetime<A, R> {
  private observed: Observed<R> | undefined;
  private stop: (() => void) | undefined;
  private listeners = new Set<() => void>();
  private snapshot = { epoch: 0, ready: false };
  constructor(private client: Client, private op: Query<A, R>, private args: A) {}
  private read = () => {
    const ready = !!this.observed && "data" in this.observed.getSnapshot();
    if (ready !== this.snapshot.ready) {
      this.snapshot = { epoch: this.snapshot.epoch + Number(!ready), ready };
      for (const notify of this.listeners) notify();
    }
  };
  getSnapshot = () => { this.read(); return this.snapshot; };
  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    if (!this.observed) {
      this.observed = this.client.observe(this.op, this.args);
      this.stop = this.observed.subscribe(this.read);
      this.read();
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(notify);
      if (!this.listeners.size) {
        this.stop?.(); this.stop = undefined;
        this.observed?.close(); this.observed = undefined;
        this.read();
      }
    };
  };
}
