import { copyDecorations, currentDecorations } from "./read-decoration.ts";
import { copyOnce, currentOnce, unproveOnce } from "./read-once.ts";
import { pendingRead, readyRead, readyExistence } from "./read-existence.ts";
import type { Read, Refusal } from "./contract.ts";
import { checkReadExpiry, type ReadDeadlines } from "./read-expiry.ts";
import { deliverReadNotifications } from "./read-notifications.ts";
import { freezeEpisode, beginEpisode, copyEpisode, episodeDeadline, EpisodeQueue, ReadEpisode } from "./read-episode.ts";

// @ref LLP 3000.019#3.3 — freshness copies remain the same authorized answer; replacements and resets do not.
const identities = new WeakMap<Read<unknown>, object>();
const owners = new WeakMap<Read<unknown>, ReadObservation<any>>();
export function answerIdentity(read: Read<unknown>): object { return identities.get(read) ?? read; }
export function answerObservation(read: Read<unknown>): ReadObservation<unknown> | undefined { return owners.get(read); }

function copyAnswer<T>(from: Read<T>, to: Read<T>): Read<T> {
  copyDecorations(from, to);
  copyOnce(from, to);
  identities.set(to, answerIdentity(from));
  const owner = owners.get(from);
  if (owner) owners.set(to, owner);
  copyEpisode(from, to);
  return to;
}

export function decorationAnswer<T>(read: Read<T>): Read<T> {
  const next = currentDecorations(currentOnce(read));
  return next === read ? read : copyAnswer(read, next);
}

/** Closed facades expose a fixed deadline without freezing their live peer. */
export function closedAnswer<T>(read: Read<T>, deadline: number): Read<T> {
  const copy = copyAnswer(read, { ...read });
  freezeEpisode(copy, deadline);
  return copy;
}

/** Reclassify a copy without renewing its answer identity or retention episode. */
export function answerExistence<T>(read: Read<T>, pending: boolean): Read<T> {
  if (!("data" in read)) return read;
  const next = readyExistence(read, pending);
  // Empty page chains notify pending changes even while a cursor keeps them partial.
  return read.existence !== next || next !== "present" && pendingRead(read) !== pending
    ? copyAnswer<T>(read, readyRead<T>(read, pending)) : read;
}

export function offlineAnswer<T>(read: Read<T>, confirmedAt?: number): Read<T> {
  if (!("data" in read) || (!read.fresh && read.since !== undefined)) return read;
  return copyAnswer<T>(read, readyRead<T>({ ...read, fresh: false, since: read.since ?? confirmedAt ?? Date.now() }, pendingRead(read)));
}

// @ref LLP 3000.023#10 — change evidence can bound an already plain revalidation.
// @ref LLP 3000.031#1.1 — pending changes reclassify the held answer, preserving its identity.
export function revalidatingAnswer<T>(read: Read<T>, bounded = false, pending?: boolean): Read<T> {
  if (!("data" in read)) return read;
  unproveOnce(read);
  read = decorationAnswer(read);
  if (!("data" in read)) return read;
  const blocked = pending ?? answerObservation(read)?.pending?.() ?? pendingRead(read);
  const next = readyExistence(read, blocked);
  if (read.revalidating && read.existence === next && (next === "present" || pendingRead(read) === blocked)) {
    beginEpisode(read, read, bounded, answerObservation(read)?.episodeQueue); return read;
  }
  const copy = copyAnswer<T>(read, readyRead<T>({ ...read, revalidating: true }, blocked));
  beginEpisode(read, copy, bounded, answerObservation(read)?.episodeQueue);
  return copy;
}

/** Retention and the subscriber-free lifetime are independent policies. */
export class ReadObservation<T> {
  // @ref LLP 3000.023#12 — source B cannot hide the dependencies of facade-held A.
  dependencies?: () => { tables: ReadonlySet<string>; scopes?: import("./local-reads.ts").ReadScopes | undefined; read?: Read<unknown> };
  readonly protectedReads = new Set<{ tables: ReadonlySet<string>; scopes?: import("./local-reads.ts").ReadScopes | undefined; read?: Read<unknown> }>();
  readonly retain: boolean;
  readonly linger: boolean;
  constructor(keep?: boolean) {
    this.retain = keep !== false; this.linger = keep === true;
    // Opening facades can share notification ownership before the first answer.
    owners.set(this.snapshot, this);
  }
  /** Local observations supply the current queue predicate, including admissions. */
  pending: (() => boolean) | undefined;
  updateExistence(): boolean {
    const read = this.snapshot;
    if (!("data" in read) || !this.pending) return false;
    const next = answerExistence<T>(read, this.pending());
    if (read === next) return false;
    this.snapshot = next;
    this.deliver("answer")();
    return true;
  }
  readonly episodeQueue = new EpisodeQueue();
  queueEpisode(queued: boolean): void { this.episode.check(); this.episodeQueue.set(queued); }
  /** Private diagnostic callback; records transitions from data, never row contents. */
  withdrawal: ((cause: string, code?: string) => void) | undefined;
  hasAnswered = false;
  onWithdrawal: () => void = () => {};
  private readonly episode = new ReadEpisode(() => {
    if (!("data" in this.snapshot)) return;
    // @ref LLP 3000.023#3.1 — deadline withdrawal must allow the in-flight answer to publish.
    this.withdrawal?.("change-timeout");
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
  expiredServerDeadline: number | undefined;
  deadlines: ReadDeadlines | undefined;
  expiryTimer: ReturnType<typeof setTimeout> | null = null;
  since: number | undefined;
  // Transport metadata also applies to an older approved facade answer.
  transportOffline = false;
  // @ref LLP 3000.019#3.3 — facade holds belong to this live watch and end with its scope.
  readonly followers = new Set<(change: "answer" | "reset" | "expiry") => (() => void) | void>();
  private revision = 0;
  private changePending = false;

  expireValues(): () => void {
    const next = decorationAnswer(this.snapshot);
    if (next === this.snapshot) return () => {};
    this.snapshot = next;
    const deliver = this.deliver("answer");
    return () => { deliver(); this.onWithdrawal(); };
  }

  read(denied: Refusal | null): Read<T> {
    if (denied && (!("denied" in this.snapshot) || this.snapshot.denied.code !== denied.code)) this.reset({ denied });
    // A detached handle is absent from client.close's sweep; its owner's denial still wins.
    if (denied) return this.snapshot;
    checkReadExpiry(this);
    this.snapshot = decorationAnswer(this.snapshot);
    this.episode.check();
    this.updateExistence();
    return this.snapshot;
  }

  async fetch<R extends { read: Read<T>; transportOffline?: boolean }>(run: () => Promise<R>, notify: () => void,
    { retain, revalidate = true, publishResult = true, accept = (_: R) => true }: { retain?: boolean; revalidate?: boolean; publishResult?: boolean; accept?: (result: R) => boolean } = {}): Promise<R & { retryExhausted?: boolean }> {
    // A held-only expiry refresh preserves the raw answer; explicit expiry retries still withdraw.
    if (retain === false) this.replace({ loading: true }, "answer", false, "expiry-retry");
    else if (revalidate) this.reload();
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
          if (attempt === 3) {
            this.failed(); notify();
            return { ...result, read: this.snapshot, retryExhausted: true };
          }
          await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt));
          // Close/reset may happen during backoff, before another request starts.
          if (revision !== this.revision) return { ...result, read: this.snapshot };
          if (this.kept) this.reload(); // A retry starts an episode deferred by in-flight invalidation.
          result = await run();
          continue;
        }
        // Acceptance may itself adopt an incarnation and synchronously reset
        // this observation (or let a peer close it). That retires this fetch.
        if (revision !== this.revision) return { ...result, read: this.snapshot };
        if (publishResult) {
          if (result.transportOffline) this.failed(true); else this.publish(result.read);
          notify();
        }
        return result;
      }
    } catch (error) {
      if (publishResult && revision === this.revision) { this.failed(); notify(); }
      throw error;
    }
  }

  // @ref LLP 3000.023#10 — queued change evidence starts its bound at attempt execution.
  reload(bounded = false, { queued = false }: { queued?: boolean } = {}): void {
    this.changePending ||= bounded;
    this.read(null);
    if (!this.retain || !("data" in this.snapshot)) {
      if (!("loading" in this.snapshot)) this.replace({ loading: true }, "answer", false, "retention-disabled");
      return;
    }
    this.snapshot = revalidatingAnswer(this.snapshot, !queued && this.changePending, this.pending?.());
    this.kept = true;
    this.episode.arm(this.snapshot);
    this.deliver("answer")();
  }

  // Failure is not an answer. Possible revocation still withdraws on failure;
  // plain revalidation keeps the displayed identity and all its row deadlines.
  // @ref LLP 3000.023#10 — transport loss marks existing freshness false, with no new flag.
  failed(offline = false): void {
    this.read(null);
    if (!this.retain || !("data" in this.snapshot) || episodeDeadline(this.snapshot) !== undefined) {
      this.replace({ loading: true }, "answer", false, "change-failed");
      return;
    }
    if (offline) {
      this.transportOffline = true;
      this.snapshot = offlineAnswer(this.snapshot, this.since);
    }
    this.reload(false, { queued: true });
  }

  publish(read: Read<T>): void { this.replace(read); }

  private deliver(change: "answer" | "reset" | "expiry"): () => void {
    const deliveries = [...this.followers].map(follow => follow(change));
    return () => deliverReadNotifications(deliveries.filter((deliver): deliver is () => void => !!deliver));
  }

  private replace(read: Read<T>, change: "answer" | "reset" | "expiry" = "answer", deferred = false, cause: string = change): () => void {
    if ("data" in this.snapshot && !("data" in read)) this.withdrawal?.("denied" in read ? "denied" : cause === "answer" ? "unavailable" : cause, "denied" in read ? read.denied.code : undefined);
    if (this.withdrawal) this.hasAnswered ||= "data" in read;
    this.revision++;
    this.changePending = false;
    this.episode.clear();
    // Every replacement classifies its own value and facts, never the previous answer.
    // @ref LLP 3000.031#1.1 — existence is recomputed on each published answer.
    this.snapshot = "data" in read ? readyRead<T>({ ...read,
      ...(read.since !== undefined ? { since: Math.min(read.since, Date.now()) } : {}),
    }, this.pending?.() ?? pendingRead(read)) : { ...read };
    copyDecorations(read, this.snapshot);
    copyOnce(read, this.snapshot);
    this.snapshot = decorationAnswer(this.snapshot);
    this.transportOffline = this.transportOffline && "data" in read && !read.fresh;
    identities.set(this.snapshot, {});
    owners.set(this.snapshot, this);
    this.kept = false;
    // Freshness age uses wall time even when row deadlines use issued device time.
    this.since = "data" in this.snapshot ? this.snapshot.since ?? (this.snapshot.fresh ? Date.now() : undefined) : undefined;
    const deliver = this.deliver(change);
    if (!deferred) deliver();
    return deliver;
  }

  reset(read: Read<T>, deferred = false, cause = "reset"): () => void { this.resetVersion++; this.expiredServerDeadline = undefined; return this.replace(read, "reset", deferred, cause); }
  // @ref LLP 3000.023#3.6 — source expiry withdraws its facade hold in the sweep's notification phase.
  expire(): () => void { this.resetVersion++; return this.replace({ loading: true }, "expiry", true); }
}
