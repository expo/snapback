import { RefusalError } from "./client-wire.js";
import { carryItemInputs } from "./query-frame.js";
import type { Cursor, QueryResult, Subscription, SubscriptionDelivery } from "./types.js";

interface Waiter<Event> {
  predicate: (event: Event) => boolean;
  resolve: (event: Event) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface DrainOptions<Args, Result> {
  args: Args;
  query(args: Args): Promise<QueryResult<Result>>;
  subscribe(args: Args, callback: (event: SubscriptionDelivery<Result>) => void): Subscription<SubscriptionDelivery<Result>>;
  /** `offline`: every page came from the store; the watermark is the persisted one and nothing is recorded. */
  mark(watermark: Cursor | null, current: () => boolean, offline: boolean): Promise<void>;
  onEvent(event: SubscriptionDelivery<Result>): void;
  /** The cursor argument's name, resolved when a page is built (the manifest may still be loading); `c` by default. */
  cursor?(): Promise<string> | string;
}

/** Follows a cursor to exhaustion, records its watermark, then watches the tail. */
export class DrainSubscription<Args, Result> implements Subscription<SubscriptionDelivery<Result>> {
  private readonly waiters = new Set<Waiter<SubscriptionDelivery<Result>>>();
  private tail?: Subscription<SubscriptionDelivery<Result>>;
  private last?: SubscriptionDelivery<Result>;
  private watermark: Cursor | null = null;
  private cursorName = "c";
  private closed = false;
  private failure?: Error;
  private generation = 0;

  constructor(private readonly options: DrainOptions<Args, Result>) {
    this.start(null);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.tail?.close();
    const error = new Error("subscription closed");
    error.name = "AbortError";
    this.fail(error);
  }

  /** Whether `subscription` is this drain's live tail (the stream a terminal refusal can originate from). */
  owns(subscription: Subscription<unknown>): boolean {
    return this.tail !== undefined && (this.tail as Subscription<unknown>) === subscription;
  }

  /** Discard a stale cursor after E_OFFLINE_RESET and cold-drain from the prefix root. */
  reset(): void {
    if (this.closed) return;
    this.tail?.close();
    this.tail = undefined;
    this.watermark = null;
    this.last = undefined;
    this.failure = undefined;
    this.start(null);
  }

  /** Reopen the live tail after the client's shared transport is cut. */
  reconnect(): void {
    if (this.closed || this.failure) return;
    // Client.subscribeRegular tracks an established tail itself, so the
    // client's transport loop reconnects that child exactly once. The outer
    // drain owns only the no-tail case: a cut while paging or marking invalidates
    // the old generation and restarts from its last proven page position.
    if (this.tail) return;
    this.start(this.watermark);
  }

  until(
    predicate: (event: SubscriptionDelivery<Result>) => boolean,
    timeoutMs = 30_000,
  ): Promise<SubscriptionDelivery<Result>> {
    if (this.last && predicate(this.last)) return Promise.resolve(this.last);
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.reject(new Error("subscription closed"));
    return new Promise((resolve, reject) => {
      const waiter: Waiter<SubscriptionDelivery<Result>> = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`subscription condition timed out after ${timeoutMs} ms`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  refuse(envelope: import("./types.js").Refusal): void {
    if (this.closed) return;
    this.generation++;
    this.tail?.close();
    this.tail = undefined;
    const error = new RefusalError(envelope);
    this.failure = error;
    this.deliver({ state: "refused", live: false, ...envelope });
    this.fail(error);
  }

  private start(cursor: Cursor | null): void {
    const generation = ++this.generation;
    void this.drain(cursor, generation).catch((error) => {
      if (this.current(generation)) {
        if (error instanceof RefusalError) this.refuse(error.envelope);
        else this.fail(error);
      }
    });
  }

  private current(generation: number): boolean { return !this.closed && generation === this.generation; }

  private async drain(start: Cursor | null, generation: number): Promise<void> {
    let cursor = start;
    const seen = new Set<string>(start === null ? [] : [start]);
    // @ref LLP 1012#6-reads-offline — a drain answered from the store keeps the
    // watermark the last online drain or resume persisted: the twin mints its
    // own page cursors, so a chain followed offline says nothing about the
    // server's log, and re-marking it would move the resume position backward.
    let offline = false;
    let held: Cursor | null | undefined;
    while (this.current(generation)) {
      this.cursorName = (await this.options.cursor?.()) ?? "c";
      if (!this.current(generation)) return;
      const args = { ...(this.options.args as Record<string, unknown>), [this.cursorName]: cursor } as Args;
      const page = await this.options.query(args);
      if (!this.current(generation)) return;
      if (page.state === "hydrating") {
        this.deliver(page);
        return;
      }
      if (page.state !== "complete" && page.state !== "capped") {
        this.deliver(page as SubscriptionDelivery<Result>);
        return;
      }
      const facts = page as { connection?: string; watermark?: Cursor | null };
      if (facts.connection === "offline") {
        offline = true;
        if (held === undefined && typeof facts.watermark === "string") held = facts.watermark;
      }
      if (page.next !== null) {
        if (seen.has(page.next)) {
          throw this.repeatedCursor();
        }
        seen.add(page.next);
        this.watermark = page.next;
        this.deliver(carryItemInputs(page, { ...page, live: false, caughtUp: false, watermark: this.watermark }));
        cursor = page.next;
        continue;
      }
      if (offline && held !== undefined) this.watermark = held;
      await this.options.mark(this.watermark, () => this.current(generation), offline);
      if (!this.current(generation)) return;
      this.deliver(carryItemInputs(page, { ...page, live: false, caughtUp: true, watermark: this.watermark }));
      // The tail is watched from the page chain's own last cursor. Online that is the
      // watermark; offline the adopted store watermark is the resume position, and a
      // tail opened there would answer only the rows past it and replace the caught-up
      // page on screen (the browser witness saw a cold inbox shrink to one chat).
      this.watchTail(generation, cursor);
      return;
    }
  }

  private repeatedCursor(): RefusalError {
    const refusal = new RefusalError({
      code: "E_OFFLINE_RESUME", family: "offline", guide: "offline",
      message: "query drain returned a cursor it already followed",
      site: "client.subscribe.drain",
      rewrite: "reconnect to refresh this query and its cursor metadata; the saved watermark is unchanged",
    });
    return refusal;
  }

  private watchTail(generation: number, from: Cursor | null = this.watermark): void {
    if (!this.current(generation)) return;
    this.tail?.close();
    const args = { ...(this.options.args as Record<string, unknown>), [this.cursorName]: from } as Args;
    this.tail = this.options.subscribe(args, (event) => {
      if (!this.current(generation)) return;
      if (event.state === "refused") { this.refuse(event); return; }
      if ((event.state === "complete" || event.state === "capped") && event.next !== null) {
        if (event.next === this.watermark) {
          this.tail?.close();
          this.refuse(this.repeatedCursor().envelope);
          return;
        }
        this.watermark = event.next;
        this.deliver(carryItemInputs(event, { ...event, caughtUp: false, watermark: this.watermark }));
        this.tail?.close();
        this.tail = undefined;
        this.start(this.watermark);
        return;
      }
      if (event.state === "complete" || event.state === "capped") {
        this.deliver(carryItemInputs(event, { ...event, caughtUp: true, watermark: this.watermark }));
      } else this.deliver(event);
    });
  }

  private deliver(event: SubscriptionDelivery<Result>): void {
    this.last = event;
    try { this.options.onEvent(event); } catch { /* application callbacks cannot stop the drain */ }
    for (const waiter of [...this.waiters]) {
      let matches = false;
      try { matches = waiter.predicate(event); }
      catch (error) {
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
      }
      if (!matches) continue;
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(event);
    }
  }

  private fail(value: unknown): void {
    const error = value instanceof Error ? value : new Error(String(value));
    this.failure = error;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters.clear();
  }
}
