import { isSnapbackRefusal } from "./client-wire.js";
import { referenceName, referencePath, type Op } from "./api.js";
import { SharedSubscriptions } from "./client-sessions.js";
import { summarize, type Snapshot } from "./snapshot.js";
import {
  initialQueryState,
  reduceQueryState,
  stableSerialize,
  type QueryMachineEvent,
  type QueryResult,
  type QueryView,
  type ObservedQuery,
  type Subscription,
  type SubscriptionDelivery,
} from "./types.js";

type QuerySnapshot<Result> = { view: QueryView<Result>; snapshot: Snapshot<Result> };

interface Waiter<Event> {
  predicate: (event: Event) => boolean;
  resolve: (event: Event) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function closedError(): Error {
  const error = new Error("query observation closed");
  error.name = "AbortError";
  return error;
}

/** Query value fields, excluding transport and freshness metadata. */
function valueIdentity(value: QueryMachineEvent<unknown>): string {
  const item = value as Record<string, unknown>;
  return stableSerialize({
    ...(Object.hasOwn(item, "data") ? { data: item.data } : {}),
    ...(Object.hasOwn(item, "next") ? { next: item.next } : {}),
    ...(Object.hasOwn(item, "predicted") ? { predicted: item.predicted } : {}),
    ...(Object.hasOwn(item, "retained") ? { retained: item.retained } : {}),
    ...(Object.hasOwn(item, "caughtUp") ? { caughtUp: item.caughtUp } : {}),
    ...(Object.hasOwn(item, "watermark") ? { watermark: item.watermark } : {}),
  });
}

function freezeTree<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeTree(child, seen);
  return Object.freeze(value);
}

/** One isolated, recursively immutable publication shared by every consumer. */
function immutablePublication<Value>(value: Value, current?: QueryView<unknown>): Value {
  const published = structuredClone(value);
  if (current && typeof published === "object" && published !== null && "data" in published && "data" in current
    && stableSerialize(published.data) === stableSerialize(current.data)) published.data = current.data;
  return freezeTree(published);
}

/** Isolate a deferred query from caller mutation after observe/subscribe returns. */
export function bindQueryRequest<Args, Result>(ref: Op<Args, Result>, args: Args) {
  const op = referenceName(ref);
  return {
    op,
    ref: Object.freeze({ op, [referencePath]: op }) as Op<Args, Result>,
    args: structuredClone(args),
  };
}

export function queryIdentity(authGeneration: number, fence: number, mode: "live" | "drain" | "once", op: string, args: unknown): string {
  return `${authGeneration}\u0000${fence}\u0000${mode}\u0000${op}\u0000${stableSerialize(args)}`;
}

export function queryEntry<Result, Event extends QueryMachineEvent<Result>>(
  key: string,
  open: (fanout: (event: Event) => void) => Subscription<Event>,
  refresh?: (current: QueryView<Result>, authoritative?: Event) => Promise<Event | undefined>,
  connection: () => import("./types.js").ConnectionState = () => "reconnecting",
) {
  const view = immutablePublication(initialQueryState<Result>());
  const initial = freezeTree({ view, snapshot: summarize(view, connection()) });
  return {
    key,
    initial,
    publication: (event: Event, current: QuerySnapshot<Result>) => immutablePublication(event, current.view),
    reduce: (current: QuerySnapshot<Result>, event: Event) => {
      const next = freezeTree(reduceQueryState(current.view, event));
      return next === current.view ? current : freezeTree({ view: next, snapshot: summarize(next, connection()) });
    },
    reproject: (current: QuerySnapshot<Result>) => current.snapshot.freshness.connection === connection()
      ? current : freezeTree({ view: current.view, snapshot: summarize(current.view, connection()) }),
    open,
    ...(refresh === undefined ? {} : { refresh: (current: QuerySnapshot<Result>, authoritative?: Event) => refresh(current.view, authoritative) }),
  };
}

type QueryMode = "live" | "drain" | "once";
type QueryFence = readonly [authGeneration: number, operationFence: number];

interface QueryHost {
  identity(): QueryFence;
  active(fence: QueryFence): boolean;
  connection(): import("./types.js").ConnectionState;
  open<Args, Result>(ref: Op<Args, Result>, args: Args, callback: (event: SubscriptionDelivery<Result>) => void, drain: boolean): Subscription<SubscriptionDelivery<Result>>;
  query<Args, Result>(ref: Op<Args, Result>, args: Args): Promise<QueryResult<Result>>;
  local<Args, Result>(ref: Op<Args, Result>, args: Args, drain: boolean): Promise<QueryMachineEvent<Result>>;
}

/** Owns query identity, lazy shared entries, and committed-local-input reevaluation for one client. */
export class ClientQueries {
  private readonly shared = new SharedSubscriptions();
  constructor(private readonly host: QueryHost) {}

  private async local<Args, Result>(
    request: ReturnType<typeof bindQueryRequest<Args, Result>>, drain: boolean,
    current: QueryView<Result>, fence: QueryFence, authoritative?: SubscriptionDelivery<Result>,
  ): Promise<SubscriptionDelivery<Result> | undefined> {
    if (!this.host.active(fence)) return undefined;
    let event: QueryMachineEvent<Result>;
    try {
      event = await this.host.local(request.ref, request.args, drain);
    } catch (error) {
      if (!this.host.active(fence) || (isSnapbackRefusal(error) && error.code === "E_AUTH_SUPERSEDED")) return undefined;
      const envelope = isSnapbackRefusal(error)
        ? error.envelope
        : { code: "E_CLIENT", family: "owner", message: String(error), guide: "owner/connect" };
      return { state: "refused", live: false, ...envelope };
    }
    if (!this.host.active(fence) || (current.live && event.state === "hydrating")) return undefined;
    // A drain is caught up only after DrainSubscription.mark has finished its
    // watermark and replay-grant work. A store-input refresh can see the page
    // committed by that mark while the mark is still pending; it may update the
    // value, but cannot publish caughtUp ahead of the drain lifecycle.
    let refreshed = event as QueryMachineEvent<Result>;
    if (drain && event.state !== "refused") {
      const { caughtUp: _caughtUp, ...value } = event as QueryMachineEvent<Result> & { caughtUp?: boolean };
      const caughtUp = (current as QueryView<Result> & { caughtUp?: boolean }).caughtUp;
      refreshed = { ...value, ...(caughtUp === undefined ? {} : { caughtUp }) } as QueryMachineEvent<Result>;
    }
    // @ref LLP 1018.003#1-the-snapshot-record — evaluation provenance is
    // independent of transport liveness: a live connection can publish a twin result.
    refreshed = { ...refreshed, source: "twin" } as QueryMachineEvent<Result>;
    if (!current.live || event.state === "refused") return refreshed as SubscriptionDelivery<Result>;
    if (authoritative && (authoritative.state === "complete" || authoritative.state === "capped")
      && (refreshed.state === "held"
        || ((refreshed.state === "complete" || refreshed.state === "capped")
          && refreshed.state === authoritative.state && refreshed.seq === authoritative.seq))
      && valueIdentity(refreshed) === valueIdentity(authoritative)) return authoritative;
    const { connection: _connection, stale: _stale, ...fresh } = refreshed as QueryMachineEvent<Result> & {
      connection?: unknown; stale?: unknown;
    };
    return { ...fresh, live: true } as SubscriptionDelivery<Result>;
  }

  observe<Args, Result>(
    ref: Op<Args, Result>, args: Args, options: { live?: false; drain?: boolean } = {},
  ): ObservedQuery<Result> {
    const once = options.live === false, drain = options.drain === true;
    if (once && drain) throw new TypeError("query observation drain requires a live subscription");
    const request = bindQueryRequest(ref, args), fence = this.host.identity();
    const active = () => this.host.active(fence);
    const mode: QueryMode = once ? "once" : drain ? "drain" : "live";
    const key = queryIdentity(fence[0], fence[1], mode, request.op, request.args);
    const observed = once ? this.shared.observe(queryEntry<Result, QueryMachineEvent<Result>>(
      key, (fanout) => oneShotQuery(() => this.host.query(request.ref, request.args), fanout),
      undefined, this.host.connection,
    ), active) : this.shared.observe(queryEntry<Result, SubscriptionDelivery<Result>>(
      key,
      (fanout) => this.host.open(request.ref, request.args, fanout, drain),
      (current, authoritative) => this.local(request, drain, current, fence, authoritative),
      this.host.connection,
    ), active);
    return { getSnapshot: () => observed.getSnapshot().snapshot, subscribe: observed.subscribe };
  }

  subscribe<Args, Result>(
    ref: Op<Args, Result>, args: Args, callback: (event: SubscriptionDelivery<Result>) => void, options: { drain?: boolean } = {},
  ): Subscription<SubscriptionDelivery<Result>> {
    const request = bindQueryRequest(ref, args), drain = options.drain === true, fence = this.host.identity();
    const mode: QueryMode = drain ? "drain" : "live";
    return this.shared.attach(queryEntry<Result, SubscriptionDelivery<Result>>(
      queryIdentity(fence[0], fence[1], mode, request.op, request.args),
      (fanout) => this.host.open(request.ref, request.args, fanout, drain),
      (current, authoritative) => this.local(request, drain, current, fence, authoritative),
      this.host.connection,
    ), callback);
  }

  consumers(ref: Op<any, any>, args: unknown, drain = false): number {
    const [generation, fence] = this.host.identity();
    return this.shared.consumers(queryIdentity(generation, fence, drain ? "drain" : "live", referenceName(ref), args));
  }
  refresh(): void { this.shared.refresh(); }
  reproject(): void { this.shared.reproject(); }
  retireInactive(): void { this.shared.retireInactive(); }
  clear(except?: Subscription<unknown>): void { this.shared.clear(except); }
}

/** The non-live source used by `client.observe`; ownership remains in the shared entry. */
export function oneShotQuery<Result>(
  query: () => Promise<QueryResult<Result>>,
  onEvent: (event: QueryMachineEvent<Result>) => void,
): Subscription<QueryMachineEvent<Result>> {
  const waiters = new Set<Waiter<QueryMachineEvent<Result>>>();
  let closed = false;
  let last: QueryMachineEvent<Result> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;

  const deliver = (event: QueryMachineEvent<Result>) => {
    if (closed) return;
    last = event;
    try { onEvent(event); } catch { /* observers are isolated by the shared entry too */ }
    for (const waiter of [...waiters]) {
      let matched = false;
      try { matched = waiter.predicate(event); }
      catch (error) {
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
        continue;
      }
      if (!matched) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(event);
    }
  };

  void (async () => {
    let backoff = 250;
    while (!closed) {
      try {
        deliver(await query());
        return;
      } catch (error) {
        if (closed || (isSnapbackRefusal(error) && error.code === "E_AUTH_SUPERSEDED")) return;
        if (isSnapbackRefusal(error) && error.retryable) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            timer = setTimeout(resolve, backoff);
          });
          timer = undefined;
          wake = undefined;
          backoff = Math.min(backoff * 2, 5_000);
          continue;
        }
        const envelope = isSnapbackRefusal(error)
          ? error.envelope
          : { code: "E_CLIENT", family: "owner", message: String(error), guide: "owner/connect" };
        deliver({ state: "refused", live: false, ...envelope });
        return;
      }
    }
  })();

  return {
    close: () => {
      if (closed) return;
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      wake?.();
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(closedError());
      }
      waiters.clear();
    },
    until: (predicate, timeoutMs = 30_000) => {
      if (last !== undefined && predicate(last)) return Promise.resolve(last);
      if (closed) return Promise.reject(closedError());
      return new Promise((resolve, reject) => {
        const waiter: Waiter<QueryMachineEvent<Result>> = {
          predicate,
          resolve,
          reject,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(`query observation condition timed out after ${timeoutMs} ms`));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
  };
}
