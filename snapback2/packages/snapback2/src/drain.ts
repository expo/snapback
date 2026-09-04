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
  mark(watermark: Cursor | null, current: () => boolean): Promise<void>;
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

  /** Discard a stale cursor after E_OFFLINE_RESET and cold-drain from the prefix root. */
  reset(): void {
    if (this.closed) return;
    this.tail?.close();
    this.tail = undefined;
    this.watermark = null;
    this.last = undefined;
    this.start(null);
  }

  until(
    predicate: (event: SubscriptionDelivery<Result>) => boolean,
    timeoutMs = 30_000,
  ): Promise<SubscriptionDelivery<Result>> {
    if (this.last && predicate(this.last)) return Promise.resolve(this.last);
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

  private start(cursor: Cursor | null): void {
    const generation = ++this.generation;
    void this.drain(cursor, generation).catch((error) => {
      if (this.current(generation)) this.fail(error);
    });
  }

  private current(generation: number): boolean { return !this.closed && generation === this.generation; }

  private async drain(start: Cursor | null, generation: number): Promise<void> {
    let cursor = start;
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
      if (page.next !== null) {
        this.watermark = page.next;
        this.deliver({ ...page, live: false, caughtUp: false, watermark: this.watermark });
        cursor = page.next;
        continue;
      }
      await this.options.mark(this.watermark, () => this.current(generation));
      if (!this.current(generation)) return;
      this.deliver({ ...page, live: false, caughtUp: true, watermark: this.watermark });
      this.watchTail(generation);
      return;
    }
  }

  private watchTail(generation: number): void {
    if (!this.current(generation)) return;
    this.tail?.close();
    const args = { ...(this.options.args as Record<string, unknown>), [this.cursorName]: this.watermark } as Args;
    this.tail = this.options.subscribe(args, (event) => {
      if (!this.current(generation)) return;
      if ((event.state === "complete" || event.state === "capped") && event.next !== null) {
        this.watermark = event.next;
        this.deliver({ ...event, caughtUp: false, watermark: this.watermark });
        this.tail?.close();
        this.tail = undefined;
        this.start(this.watermark);
        return;
      }
      if (event.state === "complete" || event.state === "capped") {
        this.deliver({ ...event, caughtUp: true, watermark: this.watermark });
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
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters.clear();
  }
}
