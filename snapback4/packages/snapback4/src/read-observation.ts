import type { Read, Refusal } from "./contract.ts";
import type { ReadDeadlines } from "./read-expiry.ts";

// @ref LLP 3000.019#3.3 — freshness copies remain the same authorized answer; replacements and resets do not.
const identities = new WeakMap<Read<unknown>, object>();
const owners = new WeakMap<Read<unknown>, ReadObservation<unknown>>();
export function answerIdentity(read: Read<unknown>): object { return identities.get(read) ?? read; }
export function answerObservation(read: Read<unknown>): ReadObservation<unknown> | undefined { return owners.get(read); }

export function staleAnswer<T>(read: Read<T>, since?: number): Read<T> {
  if (!("data" in read)) return read;
  const stale = { ...read, fresh: false, ...(since === undefined ? {} : { since: Math.min(since, Date.now()) }) };
  identities.set(stale, answerIdentity(read));
  const owner = owners.get(read);
  if (owner) owners.set(stale, owner);
  return stale;
}

/** Default fallback retention and explicit application keep share one publication
 * fence. Resets retire in-flight
 * publications; online responses must also pass their commit-sequence fence. */
export class ReadObservation<T> {
  constructor(readonly keep = false) {}

  snapshot: Read<T> = { loading: true };
  kept = false;
  resetVersion = 0;
  deadlines: ReadDeadlines | undefined;
  expiryTimer: ReturnType<typeof setTimeout> | null = null;
  since: number | undefined;
  // @ref LLP 3000.019#3.3 — facade holds belong to this live watch and end with its scope.
  readonly followers = new Set<(change: "answer" | "reset" | "expiry") => void>();
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
        // Acceptance may itself adopt an incarnation and synchronously reset
        // this observation (or let a peer close it). That retires this fetch.
        if (revision !== this.revision) return { ...result, read: this.snapshot };
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
    this.snapshot = staleAnswer(this.snapshot, this.since);
    this.kept = true;
    for (const follow of this.followers) follow("answer");
  }

  publish(read: Read<T>): void {
    if (this.keep && "loading" in read && "data" in this.snapshot) {
      this.revision++;
      this.stale();
      return;
    }
    this.replace(read);
  }

  private replace(read: Read<T>, change: "answer" | "reset" | "expiry" = "answer"): void {
    this.revision++;
    if ("data" in read && read.since !== undefined) read = { ...read, since: Math.min(read.since, Date.now()) };
    this.snapshot = { ...read };
    identities.set(this.snapshot, {});
    owners.set(this.snapshot, this);
    this.kept = false;
    // Freshness age uses wall time even when row deadlines use issued device time.
    this.since = "data" in read ? read.since ?? (read.fresh ? Date.now() : undefined) : undefined;
    for (const follow of this.followers) follow(change);
  }

  reset(read: Read<T>): void { this.resetVersion++; this.replace(read, "reset"); }
  // @ref LLP 3000.019#3.3 — the raw replacement may expire before the facade's older, still valid answer.
  expire(): void { this.resetVersion++; this.replace({ loading: true }, "expiry"); }
}
