import { isSnapbackRefusal } from "./client-wire.js";
import { referenceName, referencePath, type Op } from "./api.js";
import {
  initialQueryState,
  reduceQueryState,
  stableSerialize,
  type QueryMachineEvent,
  type QueryResult,
  type QueryView,
  type Subscription,
} from "./types.js";

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
) {
  return {
    key,
    initial: initialQueryState<Result>(),
    reduce: (current: QueryView<Result>, event: Event) => reduceQueryState(current, event),
    open,
  };
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
