import type { Read, Refusal } from "./contract.ts";

/** Retention is opt-in for a local device fallback. Resets retire in-flight
 * publications; online responses must also pass their commit-sequence fence. */
export class ReadObservation<T> {
  snapshot: Read<T> = { loading: true };
  kept = false;
  private since: number | undefined;
  private revision = 0;

  read(denied: Refusal | null): Read<T> {
    if (denied && (!("denied" in this.snapshot) || this.snapshot.denied.code !== denied.code)) this.reset({ denied });
    return this.snapshot;
  }

  async fetch<R extends { read: Read<T>; transportOffline?: boolean }>(run: () => Promise<R>, notify: () => void,
    { retain = false, publishResult = true, accept = (_: R) => true }: { retain?: boolean; publishResult?: boolean; accept?: (result: R) => boolean } = {}): Promise<R & { retryExhausted?: boolean }> {
    if (retain && "data" in this.snapshot) {
      this.snapshot = { ...this.snapshot, fresh: false, ...(this.since === undefined ? {} : { since: this.since }) };
      this.kept = true;
    } else {
      this.publish({ loading: true });
    }
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
      // Neither permits the old answer to outlive this fetch.
      if (revision === this.revision) {
        this.publish({ loading: true });
        notify();
      }
    }
  }

  publish(read: Read<T>): void {
    this.revision++;
    this.snapshot = read;
    this.kept = false;
    this.since = "data" in read ? read.since ?? (read.fresh ? Date.now() : undefined) : undefined;
  }

  reset(read: Read<T>): void { this.publish(read); }
}
