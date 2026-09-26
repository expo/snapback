import type { Read, Observed, Refusal } from "./contract.ts";
import type { ReadObservation } from "./read-observation.ts";

type Answer = Extract<Read<unknown>, { data: unknown }>;
// @ref LLP 3000.019#3.3 — opt-in presentation memory, independent of ordered server-answer recovery.
export class KeptAnswers {
  private entries = new Map<string, { read: Answer; until: number; timer: ReturnType<typeof setTimeout> }>();
  take(key: string): Answer | undefined {
    const entry = this.entries.get(key);
    this.delete(key);
    return entry && Date.now() < entry.until ? entry.read : undefined;
  }
  put(key: string, read: Read<unknown>): void {
    this.delete(key);
    if (!("data" in read)) return;
    const timer = setTimeout(() => this.delete(key), 30_000);
    (timer as { unref?: () => void }).unref?.();
    this.entries.set(key, { read, until: Date.now() + 30_000, timer });
  }
  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry) clearTimeout(entry.timer);
    this.entries.delete(key);
  }
  clear(): void { for (const key of this.entries.keys()) this.delete(key); }
}

interface Watch extends ReadObservation<unknown> {
  key: string;
  subscribers: Set<() => void>;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  presenceRefresh: ReturnType<typeof setTimeout> | null;
}

/** Both clients share watch ownership and the opt-in idle lifetime. Scope names
 * the viewer and store incarnation; resets also clear the cache synchronously. */
export function observeWatch<W extends Watch, R>(watches: Map<string, W>, key: string, memory: KeptAnswers,
  scope: () => string, make: () => W, start: (watch: W) => void, stop: (watch: W) => void,
  denied: () => Refusal | null, resetOnClose = true): Observed<R> {
  const acquire = () => {
    let watch = watches.get(key);
    if (!watch) {
      watch = make();
      const read = watch.keep && !denied() ? memory.take(scope() + key) : undefined;
      if (read) { watch.publish(read); watch.reload(); }
      watches.set(key, watch);
      start(watch);
    }
    return watch;
  };
  let own = acquire();
  const mine = new Set<() => void>();
  const release = () => {
    if (own.subscribers.size || watches.get(key) !== own) return;
    if (own.keep && !denied()) {
      own.reload();
      memory.put(scope() + key, own.snapshot);
    }
    watches.delete(key);
    stop(own);
    if (own.keep || resetOnClose) own.reset({ loading: true });
    if (own.expiryTimer) clearTimeout(own.expiryTimer);
    own.expiryTimer = null;
    if (own.presenceRefresh) clearTimeout(own.presenceRefresh);
    own.presenceRefresh = null;
  };
  return {
    getSnapshot: () => own.read(denied()) as Read<R>,
    subscribe(notify) {
      if (watches.get(key) !== own) {
        if (own.keep) own = acquire();
        else { watches.set(key, own); start(own); }
      }
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
