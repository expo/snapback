// @ref LLP 1018#3-move-one-one-coherent-reactive-client — identical live
// queries share one entry: one transport child, one current delivery, one
// mounted record, released when the last consumer closes.
import type { Subscription } from "./types.js";

interface Entry<Event> {
  underlying: Subscription<Event>;
  readonly listeners: Set<(event: Event) => void>;
  last?: Event;
}

/**
 * Reference-counted subscriptions keyed by the caller's identity string
 * (authority generation, operation, arguments, drain). The first consumer of
 * a key opens the underlying subscription with a fan-out callback; later
 * consumers attach to it and receive its last delivery first, so two
 * components reading the same query never disagree and never cost two
 * streams. The underlying subscription closes only when the last consumer
 * closes, so a StrictMode remount or a second hook cannot evict a query from
 * the mounted set another consumer still relies on.
 */
export class SharedSubscriptions {
  private readonly entries = new Map<string, Entry<unknown>>();

  attach<Event>(
    key: string,
    open: (fanout: (event: Event) => void) => Subscription<Event>,
    listener: (event: Event) => void,
  ): Subscription<Event> {
    let entry = this.entries.get(key) as Entry<Event> | undefined;
    if (!entry) {
      const created: Entry<Event> = { listeners: new Set(), underlying: undefined as unknown as Subscription<Event> };
      created.underlying = open((event) => {
        created.last = event;
        for (const each of [...created.listeners]) {
          try { each(event); } catch { /* one consumer's throw cannot starve the others */ }
        }
      });
      entry = created;
      this.entries.set(key, created as Entry<unknown>);
    }
    const current = entry;
    current.listeners.add(listener);
    // A late consumer sees where the entry already is; the underlying stream
    // is not asked to repeat itself and the consumer never observes a gap.
    const replay = current.last;
    if (replay !== undefined) queueMicrotask(() => { if (current.listeners.has(listener)) listener(replay); });
    let closed = false;
    return {
      close: () => {
        if (closed) return;
        closed = true;
        current.listeners.delete(listener);
        if (current.listeners.size === 0 && this.entries.get(key) === current) {
          this.entries.delete(key);
          current.underlying.close();
        }
      },
      until: (predicate, timeoutMs) => current.underlying.until(predicate, timeoutMs),
    };
  }

  /** How many consumers share `key` right now (tests and diagnostics). */
  consumers(key: string): number {
    return this.entries.get(key)?.listeners.size ?? 0;
  }

  /** Forget every entry: the client closed its transports underneath them. */
  clear(): void {
    this.entries.clear();
  }
}
