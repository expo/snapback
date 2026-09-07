// @ref LLP 1018#3-move-one-one-coherent-reactive-client — identical live
// queries share one entry: one transport child, one current delivery, one
// mounted record, released when the last consumer closes.
import { SnapbackRefusal, copyRefusal } from "./client-wire.js";
import type { Subscription } from "./types.js";

interface Waiter<Event> {
  predicate: (event: Event) => boolean;
  resolve: (event: Event) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Attachment<Event> {
  listener: (event: Event) => void;
  /** The stream has spoken to this consumer; a queued replay is then redundant. */
  delivered: boolean;
  closed: boolean;
  readonly waiters: Set<Waiter<Event>>;
}

interface Observation {
  notify: () => void;
  active: () => boolean;
  retire: () => void;
}

interface Entry<Event, Snapshot> {
  underlying: Subscription<Event>;
  readonly spec: EntrySpec<Event, Snapshot>;
  readonly attachments: Set<Attachment<Event>>;
  readonly observations: Set<Observation>;
  readonly initial: Snapshot;
  snapshot: Snapshot;
  last?: Event;
  epoch: number;
  refreshPending: boolean;
  refreshScheduled: boolean;
  refreshing: boolean;
}

interface EntrySpec<Event, Snapshot> {
  key: string;
  initial: Snapshot;
  reduce(current: Snapshot, event: Event): Snapshot;
  open(fanout: (event: Event) => void): Subscription<Event>;
  /** Reevaluate this query after a committed local input revision. */
  refresh?(current: Snapshot): Promise<Event | undefined>;
}

interface ObservedSnapshot<Snapshot> {
  getSnapshot(): Snapshot;
  subscribe(notify: () => void): () => void;
}

function subscriptionClosed(): Error {
  const error = new Error("subscription closed");
  error.name = "AbortError";
  return error;
}

function refusalEvent(event: unknown): SnapbackRefusal | undefined {
  const value = event as { state?: unknown; code?: unknown; family?: unknown; message?: unknown; guide?: unknown } | undefined;
  return value?.state === "refused" && typeof value.code === "string" && typeof value.family === "string"
    && typeof value.message === "string" && typeof value.guide === "string"
    ? new SnapbackRefusal(copyRefusal(value as never)) : undefined;
}

/**
 * Reference-counted subscriptions keyed by the caller's identity string
 * (authority generation, kind, operation, arguments). The first consumer of
 * a key opens the underlying subscription with a fan-out callback; later
 * consumers attach to it and receive its current delivery first, so two
 * components reading the same query never disagree and never cost two
 * streams. Each attachment is its own consumer even when two share one
 * callback function. The underlying subscription closes only when the last
 * consumer closes, so a StrictMode remount or a second hook cannot evict a
 * query from the mounted set another consumer still relies on.
 */
export class SharedSubscriptions {
  private readonly entries = new Map<string, Entry<unknown, unknown>>();

  private entry<Event, Snapshot>(spec: EntrySpec<Event, Snapshot>): Entry<Event, Snapshot> {
    let entry = this.entries.get(spec.key) as Entry<Event, Snapshot> | undefined;
    if (entry) return entry;
    const created: Entry<Event, Snapshot> = {
      spec,
      attachments: new Set(),
      observations: new Set(),
      initial: spec.initial,
      snapshot: spec.initial,
      epoch: 0,
      refreshPending: false,
      refreshScheduled: false,
      refreshing: false,
      underlying: undefined as unknown as Subscription<Event>,
    };
    const publish = (event: Event, direct: boolean) => {
      if (direct) {
        created.epoch += 1;
        if (created.refreshing) created.refreshPending = true;
      }
      created.last = event;
      const next = spec.reduce(created.snapshot, event);
      const changed = next !== created.snapshot;
      created.snapshot = next;
      if (direct || changed) for (const each of [...created.attachments]) {
        each.delivered = true;
        try { each.listener(event); } catch { /* one consumer's throw cannot starve the others */ }
        this.settle(each, event);
      }
      if (changed) for (const each of [...created.observations]) {
        try { each.notify(); } catch { /* a snapshot observer cannot starve its peers */ }
      }
      this.release(spec.key, created);
    };
    created.underlying = spec.open((event) => publish(event, true));
    // A program reset forgets predecessor evidence before the fresh stream
    // answers. Both raw late-subscriber replay and observed snapshots reset.
    const resettable = created.underlying as Subscription<Event> & { reset?(): void };
    if (typeof resettable.reset === "function") {
      const reset = resettable.reset.bind(resettable);
      resettable.reset = () => {
        created.epoch += 1;
        created.last = undefined;
        const changed = created.snapshot !== spec.initial;
        created.snapshot = spec.initial;
        if (changed) for (const each of [...created.observations]) {
          try { each.notify(); } catch { /* isolated like delivery */ }
        }
        reset();
      };
    }
    this.entries.set(spec.key, created as Entry<unknown, unknown>);
    return created;
  }

  private scheduleRefresh<Event, Snapshot>(key: string, entry: Entry<Event, Snapshot>, spec: EntrySpec<Event, Snapshot>): void {
    if (!spec.refresh) return;
    if (entry.refreshScheduled || entry.refreshing) return;
    entry.refreshScheduled = true;
    setTimeout(() => {
      entry.refreshScheduled = false;
      if (this.entries.get(key) !== entry) return;
      entry.refreshPending = false;
      entry.refreshing = true;
      const epoch = entry.epoch;
      void spec.refresh!(entry.snapshot).then((event) => {
        if (event === undefined || epoch !== entry.epoch || this.entries.get(key) !== entry) return;
        entry.last = event;
        const next = spec.reduce(entry.snapshot, event);
        if (next === entry.snapshot) return;
        entry.snapshot = next;
        for (const each of [...entry.attachments]) {
          each.delivered = true;
          try { each.listener(event); } catch { /* one consumer cannot block the revision */ }
          this.settle(each, event);
        }
        for (const each of [...entry.observations]) {
          try { each.notify(); } catch { /* a snapshot observer cannot starve its peers */ }
        }
      }).catch(() => undefined).finally(() => {
        entry.refreshing = false;
        if (entry.refreshPending && this.entries.get(key) === entry) this.scheduleRefresh(key, entry, spec);
      });
    }, 0);
  }

  private release<Event, Snapshot>(key: string, entry: Entry<Event, Snapshot>): void {
    if (entry.attachments.size > 0 || entry.observations.size > 0 || this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    entry.underlying.close();
  }

  private settle<Event>(attachment: Attachment<Event>, event: Event): void {
    const refusal = refusalEvent(event);
    for (const waiter of [...attachment.waiters]) {
      if (refusal) {
        clearTimeout(waiter.timer);
        attachment.waiters.delete(waiter);
        waiter.reject(refusal);
        continue;
      }
      let matched = false;
      try { matched = waiter.predicate(event); }
      catch (error) {
        clearTimeout(waiter.timer);
        attachment.waiters.delete(waiter);
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
        continue;
      }
      if (!matched) continue;
      clearTimeout(waiter.timer);
      attachment.waiters.delete(waiter);
      waiter.resolve(event);
    }
  }

  private closeAttachment<Event>(attachment: Attachment<Event>): void {
    if (attachment.closed) return;
    attachment.closed = true;
    const error = subscriptionClosed();
    for (const waiter of attachment.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    attachment.waiters.clear();
  }

  attach<Event, Snapshot>(
    spec: EntrySpec<Event, Snapshot>,
    listener: (event: Event) => void,
  ): Subscription<Event> {
    const current = this.entry(spec);
    const attachment: Attachment<Event> = { listener, delivered: false, closed: false, waiters: new Set() };
    current.attachments.add(attachment);
    // A late consumer sees where the entry is *now*: what is current when the
    // replay runs, never a captured older delivery, and nothing at all once the
    // stream itself has already spoken to it or it has closed.
    queueMicrotask(() => {
      if (attachment.delivered || !current.attachments.has(attachment)) return;
      const replay = current.last;
      if (replay === undefined) return;
      attachment.delivered = true;
      try { listener(replay); } catch { /* isolated like any other fan-out */ }
      this.settle(attachment, replay);
    });
    let closed = false;
    const handle: Subscription<Event> & { reset?(): void; reconnect?(): void } = {
      close: () => {
        if (closed) return;
        closed = true;
        this.closeAttachment(attachment);
        current.attachments.delete(attachment);
        this.release(spec.key, current);
      },
      until: (predicate, timeoutMs = 30_000) => {
        if (attachment.closed) return Promise.reject(subscriptionClosed());
        if (current.last !== undefined) {
          const refusal = refusalEvent(current.last);
          if (refusal) return Promise.reject(refusal);
          try { if (predicate(current.last)) return Promise.resolve(current.last); }
          catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))); }
        }
        return new Promise((resolve, reject) => {
          const waiter: Waiter<Event> = { predicate, resolve, reject, timer: setTimeout(() => {
            attachment.waiters.delete(waiter);
            reject(new Error(`subscription condition timed out after ${timeoutMs} ms`));
          }, timeoutMs) };
          attachment.waiters.add(waiter);
        });
      },
    };
    // The stream's own controls (a successor's reset, a forced reconnect) stay
    // reachable through the handle; they act on the shared stream for everyone.
    const controls = current.underlying as Subscription<Event> & { reset?(): void; reconnect?(): void };
    if (typeof controls.reset === "function") handle.reset = () => controls.reset!();
    if (typeof controls.reconnect === "function") handle.reconnect = () => controls.reconnect!();
    return handle;
  }

  /** A lazy external-store view over the same entry used by `attach`. */
  observe<Event, Snapshot>(spec: EntrySpec<Event, Snapshot>, active: () => boolean = () => true): ObservedSnapshot<Snapshot> {
    const fallback = spec.initial;
    let retired = false;
    return {
      getSnapshot: () => retired || !active()
        ? fallback : (this.entries.get(spec.key) as Entry<Event, Snapshot> | undefined)?.snapshot ?? fallback,
      subscribe: (notify) => {
        if (retired || !active()) return () => undefined;
        const entry = this.entry(spec);
        const observation: Observation = { notify, active, retire: () => { retired = true; } };
        entry.observations.add(observation);
        let closed = false;
        return () => {
          if (closed) return;
          closed = true;
          entry.observations.delete(observation);
          this.release(spec.key, entry);
        };
      },
    };
  }

  /** How many consumers share `key` right now (tests and diagnostics). */
  consumers(key: string): number {
    const entry = this.entries.get(key);
    return entry === undefined ? 0 : entry.attachments.size + entry.observations.size;
  }

  /** Coalesce committed local input revisions to at most one evaluation per active entry at a time. */
  refresh(): void {
    for (const [key, entry] of this.entries) {
      if (!entry.spec.refresh) continue;
      entry.epoch += 1;
      entry.refreshPending = true;
      this.scheduleRefresh(key, entry, entry.spec);
    }
  }

  /** Retire subscribed views whose captured client authority is no longer current. */
  retireInactive(): void {
    for (const [key, entry] of [...this.entries]) {
      const retired = [...entry.observations].filter((observation) => !observation.active());
      for (const observation of retired) { entry.observations.delete(observation); observation.retire(); }
      if (retired.length > 0) {
        this.release(key, entry);
        for (const observation of retired) try { observation.notify(); } catch { /* isolated like delivery */ }
      }
    }
  }

  /**
   * Forget every entry whose transport the client is closing underneath it,
   * consumers included. The one stream a terminal refusal originates from stays
   * attached, so its consumers still hear that refusal.
   */
  clear(except?: Subscription<unknown>): void {
    for (const [key, entry] of [...this.entries]) {
      entry.epoch += 1;
      const owner = entry.underlying as Subscription<unknown> & { owns?(subscription: Subscription<unknown>): boolean };
      const preserved = except !== undefined && (owner === except || owner.owns?.(except) === true);
      if (preserved) { entry.last = undefined; entry.snapshot = entry.initial; }
      if (!preserved) {
        for (const attachment of entry.attachments) this.closeAttachment(attachment);
        entry.attachments.clear(); this.entries.delete(key);
      }
      const observations = [...entry.observations];
      entry.observations.clear();
      if (!preserved) entry.underlying.close();
      for (const each of observations) {
        each.retire();
        try { each.notify(); } catch { /* a retired observer cannot block reset */ }
      }
    }
  }
}

/** What the follower tab needs from the client: the runtime, and the client's own takeover steps. */
export interface FollowerHost<Authority> {
  runtime(): { follow(principal: string, signal: AbortSignal, wait: object): Promise<void>; followed(wait: object): void; reauthenticate(principal: string, authEpoch?: number): Promise<void> };
  closed(): boolean;
  /** The inherited partition is open: forget the predecessor's metadata and adopt the principal. */
  inherited(principal: string): void;
  /** Load the program and resume the inherited coverage. */
  takeover(): Promise<Authority>;
  /** Replay the inherited queue. */
  drain(authority: Authority): void;
  failed(error: unknown): void;
}

interface Wait { principal: string; controller: AbortController; authenticated: boolean; authEpoch: number | undefined; inherited: boolean }

/**
 * A browser tab whose account another tab is writing. It waits for that tab's
 * lock outside the startup path, keeps the follower marker (and the write
 * refusal behind it) until the inherited partition is reauthenticated and
 * resumed, and withdraws the wait on close, restart, sign-out, session expiry,
 * and account change so a discarded tab can never take the lock later.
 */
export class TabFollower<Authority> {
  private wait?: Wait;
  constructor(private readonly host: FollowerHost<Authority>) {}

  get principal(): string | undefined { return this.wait?.principal; }

  /**
   * A later open of the principal already waited for (the restored bearer
   * confirming its account) keeps the wait and records the confirmed epoch for
   * the takeover; an open of another principal withdraws it. True when the
   * caller should treat the open as settled. Once the lock is granted the
   * partition is open, so a confirmation arriving then takes the ordinary open
   * path and reauthenticates itself.
   */
  confirm(principal: string, authenticated: boolean, authEpoch: number | undefined): boolean {
    if (!this.wait) return false;
    if (this.wait.principal !== principal) { this.stop(); return false; }
    if (this.wait.inherited) return false;
    if (authenticated) { this.wait.authenticated = true; this.wait.authEpoch = authEpoch; }
    return true;
  }

  begin(principal: string, authenticated: boolean, authEpoch: number | undefined): void {
    const wait: Wait = { principal, controller: new AbortController(), authenticated, authEpoch, inherited: false };
    this.wait = wait;
    const runtime = this.host.runtime();
    // A wait that was withdrawn or replaced while a step was in flight stops
    // at the next step; it never resumes, drains, or unfences on behalf of the
    // wait that replaced it. The runtime's marker is owned by the wait object
    // itself, so an old continuation cannot release a newer wait's fence even
    // for the same principal.
    const current = () => this.wait === wait && !wait.controller.signal.aborted && !this.host.closed();
    void runtime.follow(principal, wait.controller.signal, wait).then(async () => {
      if (!current()) { runtime.followed(wait); return; }
      wait.inherited = true;
      this.host.inherited(principal);
      if (wait.authenticated) await runtime.reauthenticate(principal, wait.authEpoch);
      if (!current()) { runtime.followed(wait); return; }
      const authority = await this.host.takeover();
      if (!current()) { runtime.followed(wait); return; }
      this.wait = undefined;
      runtime.followed(wait);
      this.host.drain(authority);
    }).catch((error) => {
      if (this.wait === wait) this.wait = undefined;
      runtime.followed(wait);
      if (wait.controller.signal.aborted || this.host.closed()) return;
      this.host.failed(error);
    });
  }

  stop(): void {
    this.wait?.controller.abort();
    this.wait = undefined;
  }
}
