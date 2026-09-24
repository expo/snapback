import type { Read, Refusal } from "./contract.ts";

/** A previous answer bridges one replacing fetch, never an unavailable result.
 * Authority resets also retire the in-flight publication's revision. */
export class ReadObservation<T> {
  snapshot: Read<T> = { loading: true };
  kept = false;
  private since: number | undefined;
  private revision = 0;

  read(denied: Refusal | null): Read<T> {
    if (denied && (!("denied" in this.snapshot) || this.snapshot.denied.code !== denied.code)) this.reset({ denied });
    return this.snapshot;
  }

  async fetch<R extends { read: Read<T>; transportOffline?: boolean }>(run: () => Promise<R>, notify: () => void, publishResult = true): Promise<R> {
    const revision = this.revision;
    if ("data" in this.snapshot) {
      this.snapshot = { ...this.snapshot, fresh: false, ...(this.since === undefined ? {} : { since: this.since }) };
      this.kept = true;
      notify();
    }
    try {
      const result = await run();
      if (revision !== this.revision) return { ...result, read: this.snapshot };
      if (publishResult) {
        this.publish(result.transportOffline ? { loading: true } : result.read);
        notify();
      }
      return result;
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
