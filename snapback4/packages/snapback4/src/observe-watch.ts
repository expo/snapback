import type { Read, Observed, Refusal } from "./contract.ts";
import type { ReadObservation } from "./read-observation.ts";

interface Watch extends ReadObservation<unknown> {
  key: string;
  subscribers: Set<() => void>;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  presenceRefresh: ReturnType<typeof setTimeout> | null;
  linger?: { until: number; timer: ReturnType<typeof setTimeout>; close(): void };
}

/** A scope-ending reset closes unsubscribed watches before application callbacks. */
export function endLingering(watches: Iterable<Watch>): void {
  for (const watch of [...watches]) watch.linger?.close();
}

// @ref LLP 3000.019#3.3 — keep leaves the same live observation running for 30 seconds without subscribers.
export function observeWatch<W extends Watch, R>(watches: Map<string, W>, key: string,
  make: () => W, start: (watch: W) => void, stop: (watch: W) => void,
  denied: () => Refusal | null, resetOnClose = true): Observed<R> {
  const cancelLinger = (watch: W) => {
    if (watch.linger) clearTimeout(watch.linger.timer);
    delete watch.linger;
  };
  const close = (watch: W) => {
    cancelLinger(watch);
    if (watches.get(key) !== watch) return;
    watches.delete(key);
    stop(watch);
    if (watch.keep || resetOnClose) watch.reset({ loading: true });
    if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
    watch.expiryTimer = null;
    watch.deadlines = undefined;
    if (watch.presenceRefresh) clearTimeout(watch.presenceRefresh);
    watch.presenceRefresh = null;
  };
  const acquire = () => {
    let watch = watches.get(key);
    // Enforce the boundary even if a suspended host has not delivered its timer.
    if (watch?.linger && performance.now() >= watch.linger.until) { close(watch); watch = undefined; }
    if (watch) cancelLinger(watch);
    else {
      watch = make();
      watches.set(key, watch);
      start(watch);
    }
    return watch;
  };
  let own = acquire();
  const mine = new Set<() => void>();
  const release = () => {
    if (own.subscribers.size || watches.get(key) !== own || own.linger) return;
    if (!own.keep || denied()) { close(own); return; }
    const watch = own;
    const timer = setTimeout(() => close(watch), 30_000);
    (timer as { unref?: () => void }).unref?.();
    watch.linger = { until: performance.now() + 30_000, timer, close: () => close(watch) };
  };
  return {
    getSnapshot: () => own.read(denied()) as Read<R>,
    subscribe(notify) {
      if (own.keep) own = acquire();
      else if (watches.get(key) !== own) { watches.set(key, own); start(own); }
      mine.add(notify); own.subscribers.add(notify);
      return () => {
        mine.delete(notify); own.subscribers.delete(notify);
        if (own.keep) release();
      };
    },
    close() {
      for (const subscriber of mine) own.subscribers.delete(subscriber);
      mine.clear();
      release();
    },
  };
}
