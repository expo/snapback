// @ref LLP 1018#3-move-one-one-coherent-reactive-client — identical live
// queries share one entry: one transport child, one current delivery, one
// mounted record, released when the last consumer closes.
import type { Subscription } from "./types.js";

interface Attachment<Event> {
  listener: (event: Event) => void;
  /** The stream has spoken to this consumer; a queued replay is then redundant. */
  delivered: boolean;
}

interface Entry<Event> {
  underlying: Subscription<Event>;
  readonly attachments: Set<Attachment<Event>>;
  last?: Event;
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
  private readonly entries = new Map<string, Entry<unknown>>();

  attach<Event>(
    key: string,
    open: (fanout: (event: Event) => void) => Subscription<Event>,
    listener: (event: Event) => void,
  ): Subscription<Event> {
    let entry = this.entries.get(key) as Entry<Event> | undefined;
    if (!entry) {
      const created: Entry<Event> = { attachments: new Set(), underlying: undefined as unknown as Subscription<Event> };
      created.underlying = open((event) => {
        created.last = event;
        for (const each of [...created.attachments]) {
          each.delivered = true;
          try { each.listener(event); } catch { /* one consumer's throw cannot starve the others */ }
        }
      });
      // A reset (E_OFFLINE_RESET, a successor) forgets the current delivery, so
      // a consumer attaching before the fresh stream answers is not replayed
      // coverage the reset dropped.
      const resettable = created.underlying as Subscription<Event> & { reset?(): void };
      if (typeof resettable.reset === "function") {
        const reset = resettable.reset.bind(resettable);
        resettable.reset = () => { created.last = undefined; reset(); };
      }
      entry = created;
      this.entries.set(key, created as Entry<unknown>);
    }
    const current = entry;
    const attachment: Attachment<Event> = { listener, delivered: false };
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
    });
    let closed = false;
    const handle: Subscription<Event> & { reset?(): void; reconnect?(): void } = {
      close: () => {
        if (closed) return;
        closed = true;
        current.attachments.delete(attachment);
        if (current.attachments.size === 0 && this.entries.get(key) === current) {
          this.entries.delete(key);
          current.underlying.close();
        }
      },
      until: (predicate, timeoutMs) => current.underlying.until(predicate, timeoutMs),
    };
    // The stream's own controls (a successor's reset, a forced reconnect) stay
    // reachable through the handle; they act on the shared stream for everyone.
    const controls = current.underlying as Subscription<Event> & { reset?(): void; reconnect?(): void };
    if (typeof controls.reset === "function") handle.reset = () => controls.reset!();
    if (typeof controls.reconnect === "function") handle.reconnect = () => controls.reconnect!();
    return handle;
  }

  /** How many consumers share `key` right now (tests and diagnostics). */
  consumers(key: string): number {
    return this.entries.get(key)?.attachments.size ?? 0;
  }

  /** Forget every entry and consumer: the client closed its transports underneath them. */
  clear(): void {
    for (const entry of this.entries.values()) entry.attachments.clear();
    this.entries.clear();
  }
}

/** What the follower tab needs from the client: the runtime, and the client's own takeover steps. */
export interface FollowerHost<Authority> {
  runtime(): { follow(principal: string, signal: AbortSignal): Promise<void>; followed(): void; reauthenticate(principal: string, authEpoch?: number): Promise<void> };
  closed(): boolean;
  /** The inherited partition is open: forget the predecessor's metadata and adopt the principal. */
  inherited(principal: string): void;
  /** Load the program and resume the inherited coverage. */
  takeover(): Promise<Authority>;
  /** Replay the inherited queue. */
  drain(authority: Authority): void;
  failed(error: unknown): void;
}

interface Wait { principal: string; controller: AbortController; authenticated: boolean; authEpoch: number | undefined }

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
   * caller should treat the open as settled.
   */
  confirm(principal: string, authenticated: boolean, authEpoch: number | undefined): boolean {
    if (!this.wait) return false;
    if (this.wait.principal !== principal) { this.stop(); return false; }
    if (authenticated) { this.wait.authenticated = true; this.wait.authEpoch = authEpoch; }
    return true;
  }

  begin(principal: string, authenticated: boolean, authEpoch: number | undefined): void {
    const wait: Wait = { principal, controller: new AbortController(), authenticated, authEpoch };
    this.wait = wait;
    const runtime = this.host.runtime();
    void runtime.follow(principal, wait.controller.signal).then(async () => {
      if (wait.controller.signal.aborted || this.host.closed()) return;
      this.host.inherited(principal);
      if (wait.authenticated) await runtime.reauthenticate(principal, wait.authEpoch);
      const authority = await this.host.takeover();
      if (this.wait === wait) this.wait = undefined;
      runtime.followed();
      this.host.drain(authority);
    }).catch((error) => {
      if (this.wait === wait) this.wait = undefined;
      runtime.followed();
      if (wait.controller.signal.aborted || this.host.closed()) return;
      this.host.failed(error);
    });
  }

  stop(): void {
    this.wait?.controller.abort();
    this.wait = undefined;
  }
}
