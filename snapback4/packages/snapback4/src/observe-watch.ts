import type { Client, ObserveOptions, Query, Read, Observed, Refusal } from "./contract.ts";
import { deferReadNotifications } from "./read-notifications.ts";
import type { ReadObservation } from "./read-observation.ts";
import { readKey } from "./read-key.ts";

interface Watch extends ReadObservation<unknown> {
  key: string;
  subscribers: Set<() => void>;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  presenceRefresh: ReturnType<typeof setTimeout> | null;
  lingering?: { until: number; timer: ReturnType<typeof setTimeout>; close(): void; resume?: boolean };
}

type Peek = (op: Query<unknown, unknown>, args: unknown, options?: ObserveOptions) => Read<unknown> | undefined;
// Key by observe so write-only wrappers preserve the same read implementation.
const peeks = new WeakMap<Client["observe"], Peek>();
export function registerObservationPeek(client: Client, peek: Peek): void { peeks.set(client.observe, peek); }
export function peekObservation<A, R>(client: Client, op: Query<A, R>, args: A, options?: ObserveOptions): Read<R> | undefined {
  return peeks.get(client.observe)?.(op as Query<unknown, unknown>, args, options) as Read<R> | undefined;
}

// @ref LLP 3000.023#3.2 — omitted, withdrawing and lingering subscribers never share policy.
export function observationKey(op: Query<unknown, unknown>, args: unknown, options?: ObserveOptions): string {
  return `${options?.keep === true ? "keep:" : options?.keep === false ? "withdraw:" : "retain:"}${readKey(op, args)}`;
}

// @ref LLP 3000.019#3.3 — render can see a live watch before subscribing, without extending its lifetime.
export function bindWatchPeek(client: Client, watches: Map<string, Watch>, denied: () => Refusal | null): void {
  registerObservationPeek(client, (op, args, options) => {
    if (denied()) return undefined;
    const watch = watches.get(observationKey(op, args, options));
    if (!watch || (watch.lingering && performance.now() >= watch.lingering.until)) return undefined;
    return watch.read(null);
  });
}

/** A scope-ending reset closes unsubscribed watches before application callbacks. */
export function endLingering(watches: Iterable<Watch>): void {
  for (const watch of [...watches]) watch.lingering?.close();
}

// @ref LLP 3000.023#3.4 — close withdraws all peers and cancels deadlines before callbacks.
export function closeWatchAnswers(watches: Map<string, Watch>, denied: Refusal): () => void {
  const current = [...watches.values()];
  const deliver = deferReadNotifications(() => {
    endLingering(current);
    for (const watch of current) {
      if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
      watch.expiryTimer = null;
      watch.deadlines = undefined;
      if (watch.presenceRefresh) clearTimeout(watch.presenceRefresh);
      watch.presenceRefresh = null;
      watch.publish({ denied });
    }
  });
  return () => { deliver(); for (const watch of current) for (const subscriber of watch.subscribers) subscriber(); };
}

// @ref LLP 3000.019#3.3 — keep leaves the same live observation running for 30 seconds without subscribers.
export function observeWatch<W extends Watch, R>(watches: Map<string, W>, key: string,
  make: () => W, start: (watch: W) => void, stop: (watch: W) => void,
  denied: () => Refusal | null, resetOnClose = true, idle?: (watch: W) => boolean): Observed<R> {
  const cancelLinger = (watch: W) => {
    if (watch.lingering) clearTimeout(watch.lingering.timer);
    delete watch.lingering;
  };
  const close = (watch: W) => {
    cancelLinger(watch);
    if (watches.get(key) !== watch) return;
    watches.delete(key);
    stop(watch);
    watch.retire();
    if (watch.linger || resetOnClose) { watch.reset({ loading: true }); watch.deadlines = undefined; }
    if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
    watch.expiryTimer = null;
    // A non-resetting local close keeps access-time deadlines for its last snapshot.
    if (watch.presenceRefresh) clearTimeout(watch.presenceRefresh);
    watch.presenceRefresh = null;
  };
  const acquire = () => {
    let watch = watches.get(key);
    // Enforce the boundary even if a suspended host has not delivered its timer.
    if (watch?.lingering && performance.now() >= watch.lingering.until) { close(watch); watch = undefined; }
    if (watch) { const resume = watch.lingering?.resume; cancelLinger(watch); if (resume) start(watch); }
    else {
      watch = make();
      const created = watch;
      watch.onWithdrawal = () => { for (const subscriber of created.subscribers) subscriber(); };
      watches.set(key, watch);
      start(watch);
    }
    return watch;
  };
  let own = acquire();
  const mine = new Set<() => void>();
  const release = () => {
    if (own.subscribers.size || watches.get(key) !== own || own.lingering) return;
    if (!own.linger || denied()) { close(own); return; }
    const watch = own;
    // Preserve the held answer and its authority/deadlines, but release work
    // when the last subscriber leaves. Reacquisition resumes a cancelled read.
    const resume = idle?.(watch);
    const timer = setTimeout(() => close(watch), 30_000);
    (timer as { unref?: () => void }).unref?.();
    watch.lingering = { until: performance.now() + 30_000, timer, close: () => close(watch), ...(resume ? { resume } : {}) };
  };
  return {
    getSnapshot: () => own.read(denied()) as Read<R>,
    subscribe(notify) {
      if (own.linger) own = acquire();
      else if (watches.get(key) !== own) { watches.set(key, own); start(own); }
      mine.add(notify); own.subscribers.add(notify);
      return () => {
        mine.delete(notify); own.subscribers.delete(notify);
        if (own.linger) release();
      };
    },
    close() {
      for (const subscriber of mine) own.subscribers.delete(subscriber);
      mine.clear();
      release();
    },
  };
}
