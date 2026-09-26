import type { Read, Observed, Refusal } from "./contract.ts";
import type { ReadObservation } from "./read-observation.ts";
import { answerExpired, wallExpiryClock, type ExpiryClock, type ReadDeadlines } from "./read-expiry.ts";

type Answer = Extract<Read<unknown>, { data: unknown }>;
type KeptAnswer = { read: Answer; deadlines: ReadDeadlines | undefined; ephemeral: boolean };
// @ref LLP 3000.019#3.3 — opt-in presentation memory, independent of ordered server-answer recovery.
export class KeptAnswers {
  private entries = new Map<string, KeptAnswer & { until: number; timer: ReturnType<typeof setTimeout> }>();
  constructor(private clock: ExpiryClock = wallExpiryClock) {}
  take(key: string): KeptAnswer | undefined {
    const entry = this.entries.get(key);
    this.delete(key);
    return entry && Date.now() < entry.until && !answerExpired(entry.deadlines, this.clock) ? entry : undefined;
  }
  put(key: string, read: Read<unknown>, deadlines?: ReadDeadlines, ephemeral = false): void {
    this.delete(key);
    if (!("data" in read) || answerExpired(deadlines, this.clock)) return;
    const timer = setTimeout(() => this.delete(key), 30_000);
    (timer as { unref?: () => void }).unref?.();
    this.entries.set(key, { read, deadlines, ephemeral, until: Date.now() + 30_000, timer });
  }
  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry) clearTimeout(entry.timer);
    this.entries.delete(key);
  }
  clear(): void { for (const key of this.entries.keys()) this.delete(key); }
  clearEphemeral(): void { for (const [key, entry] of this.entries) if (entry.ephemeral) this.delete(key); }
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
      const kept = watch.keep && !denied() ? memory.take(scope() + key) : undefined;
      if (kept) { watch.publish(kept.read); watch.reload(); watch.deadlines = kept.deadlines; }
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
      memory.put(scope() + key, own.snapshot, own.deadlines, own.ephemeralTables.length > 0);
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
