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
  mark(watermark: Cursor | null): Promise<void>;
  onEvent(event: SubscriptionDelivery<Result>): void;
}

/** Follows a cursor to exhaustion, records its watermark, then watches the tail. */
export class DrainSubscription<Args, Result> implements Subscription<SubscriptionDelivery<Result>> {
  private readonly waiters = new Set<Waiter<SubscriptionDelivery<Result>>>();
  private tail?: Subscription<SubscriptionDelivery<Result>>;
  private last?: SubscriptionDelivery<Result>;
  private watermark: Cursor | null = null;
  private closed = false;

  constructor(private readonly options: DrainOptions<Args, Result>) {
    void this.drain(null).catch((error) => this.fail(error));
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
    void this.drain(null).catch((error) => this.fail(error));
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

  private async drain(start: Cursor | null): Promise<void> {
    let cursor = start;
    while (!this.closed) {
      const args = { ...(this.options.args as Record<string, unknown>), c: cursor } as Args;
      const page = await this.options.query(args);
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
      await this.options.mark(this.watermark);
      this.deliver({ ...page, live: false, caughtUp: true, watermark: this.watermark });
      this.watchTail();
      return;
    }
  }

  private watchTail(): void {
    if (this.closed) return;
    const args = { ...(this.options.args as Record<string, unknown>), c: this.watermark } as Args;
    this.tail = this.options.subscribe(args, (event) => {
      if (this.closed) return;
      if ((event.state === "complete" || event.state === "capped") && event.next !== null) {
        this.watermark = event.next;
        this.deliver({ ...event, caughtUp: false, watermark: this.watermark });
        this.tail?.close();
        this.tail = undefined;
        void this.drain(this.watermark).catch((error) => this.fail(error));
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
