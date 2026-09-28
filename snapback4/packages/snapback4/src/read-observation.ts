import type { Read, Refusal } from "./contract.ts";
import { checkReadExpiry, type ReadDeadlines } from "./read-expiry.ts";
import { deferReadNotifications, deliverReadNotifications } from "./read-notifications.ts";
import { beginEpisode, copyEpisode, ReadEpisode } from "./read-episode.ts";

// Authority belongs to wire-equivalent arguments, independent of object key order.
export function readKey(op: { name: string }, args: unknown): string {
  return `${op.name}:${JSON.stringify(args, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)}`;
}

// @ref LLP 3000.019#3.3 — freshness copies remain the same authorized answer; replacements and resets do not.
const identities = new WeakMap<Read<unknown>, object>();
const owners = new WeakMap<Read<unknown>, ReadObservation<unknown>>();
export function answerIdentity(read: Read<unknown>): object { return identities.get(read) ?? read; }
export function answerObservation(read: Read<unknown>): ReadObservation<unknown> | undefined { return owners.get(read); }

function copyAnswer<T>(from: Read<T>, to: Read<T>): Read<T> {
  identities.set(to, answerIdentity(from));
  const owner = owners.get(from);
  if (owner) owners.set(to, owner);
  copyEpisode(from, to);
  return to;
}

// @ref LLP 3000.023#3.3 — revalidation preserves freshness, since and answer identity.
export function revalidatingAnswer<T>(read: Read<T>, bounded: boolean): Read<T> {
  if (!("data" in read) || read.revalidating) return read;
  const copy = copyAnswer(read, { ...read, revalidating: true });
  beginEpisode(read, copy, bounded);
  return copy;
}

/** Retention and the subscriber-free lifetime are independent policies. */
export class ReadObservation<T> {
  readonly retain: boolean;
  readonly linger: boolean;
  constructor(keep?: boolean) {
    this.retain = keep !== false; this.linger = keep === true;
    // Opening facades can share notification ownership before the first answer.
    owners.set(this.snapshot, this);
  }
  onWithdrawal: () => void = () => {};
  private readonly episode = new ReadEpisode(() => {
    if (!("data" in this.snapshot)) return;
    // @ref LLP 3000.023#3.1 — deadline withdrawal must allow the in-flight answer to publish.
    this.snapshot = { loading: true };
    owners.set(this.snapshot, this);
    this.kept = false;
    this.deliver("answer")();
    deliverReadNotifications([this.onWithdrawal]);
  });
  retire(): void { this.episode.stop(); this.deliver("reset")(); }

  snapshot: Read<T> = { loading: true };
  kept = false;
  resetVersion = 0;
  deadlines: ReadDeadlines | undefined;
  expiryTimer: ReturnType<typeof setTimeout> | null = null;
  since: number | undefined;
  // @ref LLP 3000.019#3.3 — facade holds belong to this live watch and end with its scope.
  readonly followers = new Set<(change: "answer" | "reset" | "expiry") => (() => void) | void>();
  private revision = 0;

  read(denied: Refusal | null): Read<T> {
    if (denied && (!("denied" in this.snapshot) || this.snapshot.denied.code !== denied.code)) this.reset({ denied });
    // A detached handle is absent from client.close's sweep; its owner's denial still wins.
    if (denied) return this.snapshot;
    checkReadExpiry(this);
    this.episode.check();
    return this.snapshot;
  }

  async fetch<R extends { read: Read<T>; transportOffline?: boolean }>(run: () => Promise<R>, notify: () => void,
    { retain, publishResult = true, accept = (_: R) => true }: { retain?: boolean; publishResult?: boolean; accept?: (result: R) => boolean } = {}): Promise<R & { retryExhausted?: boolean }> {
    if (retain !== false && this.retain) this.reload();
    else this.publish({ loading: true });
    const revision = this.revision;
    notify();
    try {
      let result = await run();
      for (let attempt = 0; ; attempt++) {
        if (revision !== this.revision) return publishResult ? { ...result, read: this.snapshot } : result;
        // Check at publication, after the caller's asynchronous continuation.
        if (!accept(result)) {
          // One round has at most four requests, with 25/50/100 ms backoff.
          // A later invalidation can start another round; this one must settle.
          if (attempt === 3) {
            this.reload(); notify();
            return { ...result, read: this.snapshot, retryExhausted: true };
          }
          await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt));
          // Close/reset may happen during backoff, before another request starts.
          if (revision !== this.revision) return publishResult ? { ...result, read: this.snapshot } : result;
          result = await run();
          continue;
        }
        // Acceptance may itself adopt an incarnation and synchronously reset
        // this observation (or let a peer close it). That retires this fetch.
        if (revision !== this.revision) return publishResult ? { ...result, read: this.snapshot } : result;
        if (publishResult) {
          this.update(result.transportOffline ? { loading: true } : result.read);
          notify();
        }
        return result;
      }
    } catch (error) {
      if (publishResult && revision === this.revision) { this.reload(); notify(); }
      throw error;
    }
  }

  // @ref LLP 3000.029#3 — only plain revalidation retains; evidence uses reset/publish.
  reload(): void {
    this.read(null);
    if (!this.retain || !("data" in this.snapshot)) {
      if (!("loading" in this.snapshot)) this.publish({ loading: true });
      return;
    }
    this.snapshot = revalidatingAnswer(this.snapshot, false);
    this.kept = true;
    this.episode.arm(this.snapshot);
    this.deliver("answer")();
  }

  // No new answer is not evidence against the last authorized answer. Callers
  // must reset at the evidence boundary, before starting their asynchronous read.
  update(read: Read<T>): void {
    if ("loading" in read) this.reload(); else this.publish(read);
  }

  offline(): void {
    this.reload();
    if ("data" in this.snapshot) {
      this.snapshot = copyAnswer(this.snapshot, { ...this.snapshot, fresh: false,
        ...(this.since === undefined ? {} : { since: this.since }) });
      this.deliver("answer")();
    }
  }

  publish(read: Read<T>): void { this.replace(read); }

  private deliver(change: "answer" | "reset" | "expiry"): () => void {
    const deliveries = [...this.followers].map(follow => follow(change));
    return () => deliverReadNotifications(deliveries.filter((deliver): deliver is () => void => !!deliver));
  }

  private replace(read: Read<T>, change: "answer" | "reset" | "expiry" = "answer", deferred = false): () => void {
    this.revision++;
    this.episode.clear();
    if ("data" in read && read.since !== undefined) read = { ...read, since: Math.min(read.since, Date.now()) };
    this.snapshot = { ...read };
    identities.set(this.snapshot, {});
    owners.set(this.snapshot, this);
    this.kept = false;
    // Freshness age uses wall time even when row deadlines use issued device time.
    this.since = "data" in read ? read.since ?? (read.fresh ? Date.now() : undefined) : undefined;
    const deliver = this.deliver(change);
    if (!deferred) deliver();
    return deliver;
  }

  reset(read: Read<T>, deferred = false): () => void { this.resetVersion++; return this.replace(read, "reset", deferred); }
  // @ref LLP 3000.023#3.6 — source expiry withdraws its facade hold in the sweep's notification phase.
  expire(): () => void { this.resetVersion++; return this.replace({ loading: true }, "expiry", true); }
}

// @ref LLP 3000.029#4 — an unavailable replacement cannot forget the held answer's inputs.
export function readInputs(previous: Set<string>, next: Iterable<string>, retained: boolean): Set<string> {
  return retained && previous.size === 0 ? previous : new Set([...(retained ? previous : []), ...next]);
}

// @ref LLP 3000.029#7 — accepted whole replacements reach every policy before callbacks.
export function invalidateReadEvidence<W extends ReadObservation<unknown> & { op: { name: string }; args: unknown; subscribers: Set<() => void> }>(watches: Iterable<W>,
  op: { name: string }, args: unknown, read: Read<unknown>, install: (watch: W) => void = () => {}, source?: W, publish: () => boolean = () => true): boolean {
  const deliveries: (() => void)[] = [];
  for (const watch of watches) if (watch !== source && watch.op.name === op.name && readKey(watch.op, watch.args) === readKey(op, args)) {
    clearTimeout(watch.expiryTimer ?? undefined); watch.expiryTimer = null; watch.deadlines = undefined;
    install(watch);
    deliveries.push(deferReadNotifications(() => watch.publish(read)));
    deliveries.push(() => { for (const notify of watch.subscribers) notify(); });
  }
  let accepted = false;
  deliveries.push(deferReadNotifications(() => { accepted = publish(); }));
  deliverReadNotifications(deliveries);
  return accepted;
}
