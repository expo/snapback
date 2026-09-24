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
    { retain = false, publishResult = true, accept = (_: R) => true }: { retain?: boolean; publishResult?: boolean; accept?: (result: R) => boolean } = {}): Promise<R> {
    if (retain && "data" in this.snapshot) {
      this.snapshot = { ...this.snapshot, fresh: false, ...(this.since === undefined ? {} : { since: this.since }) };
      this.kept = true;
    } else {
      this.publish({ loading: true });
    }
    const revision = this.revision;
    notify();
    try {
      for (;;) {
        const result = await run();
        if (revision !== this.revision) return { ...result, read: this.snapshot };
        // Check at publication, after the caller's asynchronous continuation.
        if (!accept(result)) { await new Promise(resolve => setTimeout(resolve, 0)); continue; }
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
