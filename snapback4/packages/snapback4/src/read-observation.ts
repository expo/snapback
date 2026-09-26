import type { Read, Refusal } from "./contract.ts";
import type { ReadDeadlines } from "./read-expiry.ts";

/** Default fallback retention and explicit application keep share one publication
 * fence. Resets retire in-flight
 * publications; online responses must also pass their commit-sequence fence. */
export class ReadObservation<T> {
  constructor(readonly keep = false) {}

  snapshot: Read<T> = { loading: true };
  kept = false;
  resetVersion = 0;
  deadlines: ReadDeadlines | undefined;
  ephemeralTables: readonly string[] = [];
  private since: number | undefined;
  private revision = 0;

  read(denied: Refusal | null): Read<T> {
    if (denied && (!("denied" in this.snapshot) || this.snapshot.denied.code !== denied.code)) this.reset({ denied });
    return this.snapshot;
  }

  async fetch<R extends { read: Read<T>; transportOffline?: boolean }>(run: () => Promise<R>, notify: () => void,
    { retain = false, publishResult = true, accept = (_: R) => true }: { retain?: boolean; publishResult?: boolean; accept?: (result: R) => boolean } = {}): Promise<R & { retryExhausted?: boolean }> {
    if ((retain || this.keep) && "data" in this.snapshot) this.stale();
    else this.publish({ loading: true });
    const revision = this.revision;
    notify();
    try {
      let result = await run();
      for (let attempt = 0; ; attempt++) {
        if (revision !== this.revision) return { ...result, read: this.snapshot };
        // Check at publication, after the caller's asynchronous continuation.
        if (!accept(result)) {
          // One round has at most four requests, with 25/50/100 ms backoff.
          // A later invalidation can start another round; this one must settle.
          if (attempt === 3) return { ...result, read: { loading: true }, retryExhausted: true };
          await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt));
          // Close/reset may happen during backoff, before another request starts.
          if (revision !== this.revision) return { ...result, read: this.snapshot };
          result = await run();
          continue;
        }
        if (publishResult) {
          this.publish(result.transportOffline ? { loading: true } : result.read);
          notify();
        }
        return result;
      }
    } finally {
      // Composition may still need a device read, or the fetch may throw.
      // Without keep, neither permits the old answer to outlive this fetch.
      if (revision === this.revision) {
        this.publish({ loading: true });
        notify();
      }
    }
  }

  // @ref LLP 3000.019#3.3 — keep is an application's choice to display a stale answer while loading.
  reload(): void { this.publish({ loading: true }); }

  private stale(): void {
    if (!("data" in this.snapshot)) return;
    this.snapshot = { ...this.snapshot, fresh: false, ...(this.since === undefined ? {} : { since: Math.min(this.since, Date.now()) }) };
    this.kept = true;
  }

  publish(read: Read<T>): void {
    if (this.keep && "loading" in read && "data" in this.snapshot) {
      this.revision++;
      this.stale();
      return;
    }
    this.replace(read);
  }

  private replace(read: Read<T>): void {
    this.revision++;
    if ("data" in read && read.since !== undefined) read = { ...read, since: Math.min(read.since, Date.now()) };
    this.snapshot = read;
    this.kept = false;
    // Freshness age uses wall time even when row deadlines use issued device time.
    this.since = "data" in read ? read.since ?? (read.fresh ? Date.now() : undefined) : undefined;
  }

  reset(read: Read<T>): void { this.resetVersion++; this.replace(read); }
}
