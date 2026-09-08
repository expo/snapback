import { isSnapbackRefusal } from "./client-wire.js";
import { referenceName, referencePath, type Op } from "./api.js";
import { SharedSubscriptions } from "./client-sessions.js";
import { summarize, type Snapshot } from "./snapshot.js";
import {
  attachItems, composeHistory,
  type HistorySnapshot, type ItemInputs, type ItemRow, type Items, type ItemSnapshot, type ItemsWithHistory,
} from "./client-items.js";
import { carryItemInputs, cloneItemPublication, emptyItemInputs, itemInputs, rebindItemInputs, withItemInputs } from "./query-frame.js";
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

type QuerySnapshot<Result> = { view: QueryView<Result>; snapshot: Snapshot<Result>; inputs: ItemInputs };
const snapshotProjection = {};

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
  const published = cloneItemPublication(value);
  if (current && typeof published === "object" && published !== null && "data" in published && "data" in current
    && stableSerialize(published.data) === stableSerialize(current.data)) {
    const inputs = itemInputs(published);
    if (inputs) withItemInputs(published, rebindItemInputs(inputs, published.data, current.data));
    published.data = current.data;
  }
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
  refresh?: (current: QueryView<Result>, authoritative?: Event, inputs?: ItemInputs) => Promise<Event | undefined>,
  connection: () => import("./types.js").ConnectionState = () => "reconnecting",
) {
  const view = immutablePublication(initialQueryState<Result>());
  const initial = freezeTree({ view, snapshot: summarize(view, connection()), inputs: emptyItemInputs });
  return {
    key,
    initial,
    publication: (event: Event, current: QuerySnapshot<Result>) => immutablePublication(event, current.view),
    reduce: (current: QuerySnapshot<Result>, event: Event) => {
      const next = freezeTree(reduceQueryState(current.view, event));
      const received = itemInputs(event);
      const inputs = received ? rebindItemInputs(received, "data" in event ? event.data : undefined, "data" in next ? next.data : undefined)
        : "data" in next ? current.inputs : { ...emptyItemInputs, entries: current.inputs.entries };
      if (next === current.view && inputs === current.inputs) return current;
      return Object.freeze({ view: next, snapshot: next === current.view ? current.snapshot : freezeTree(summarize(next, connection())), inputs });
    },
    reproject: (current: QuerySnapshot<Result>) => current.snapshot.freshness.connection === connection()
      ? current : Object.freeze({ ...current, snapshot: freezeTree(summarize(current.view, connection())) }),
    open,
    ...(refresh === undefined ? {} : { refresh: (current: QuerySnapshot<Result>, authoritative?: Event) => refresh(current.view, authoritative, current.inputs) }),
  };
}

// @ref LLP 1018.006#3-mechanics — one composition per declaration and query
// identity while any consumer holds it: handles join the registered core at
// subscribe time, each subscription is its own attachment, listeners are
// isolated from one another, acquisition reconciles in the subscribing call
// because the shared entry registers silently, the core releases only its own
// history subscription, and `clear()` retires cores while detached handles
// keep reading the underlying fallbacks.
interface HistoryCore<Result, Row extends ItemRow, Draft, History> {
  readonly retired: boolean;
  getSnapshot(): HistorySnapshot<Result, Row, Draft, History>;
  subscribe(listener: () => void): () => void;
  retire(): void;
}

function historyCore<Result, Row extends ItemRow, Draft, History>(
  primary: ObservedQuery<Result, ItemSnapshot<Result, Row, Draft>>,
  history: ObservedQuery<History, ItemSnapshot<History, Row, Draft>>,
  onIdle: () => void,
): HistoryCore<Result, Row, Draft, History> {
  type Attachment = { listener: () => void; closed: boolean };
  const attachments = new Set<Attachment>();
  let primaryOff: (() => void) | undefined;
  let historyOff: (() => void) | undefined;
  let retired = false;
  let basis: { primary?: ItemSnapshot<Result, Row, Draft>; history?: ItemSnapshot<History, Row, Draft>;
    value?: HistorySnapshot<Result, Row, Draft, History> } = {};
  const notify = () => {
    for (const attachment of [...attachments]) {
      if (attachment.closed) continue;
      try { attachment.listener(); } catch { /* listeners are isolated from one another, as in the shared entry */ }
    }
  };
  const reconcile = () => {
    if (primaryOff === undefined) return;
    if (primary.getSnapshot().receipt?.outcome === "partial") historyOff ??= history.subscribe(broadcast);
    else if (historyOff !== undefined) { historyOff(); historyOff = undefined; }
  };
  const broadcast = () => { reconcile(); notify(); };
  const release = () => {
    historyOff?.(); historyOff = undefined;
    primaryOff?.(); primaryOff = undefined;
  };
  return {
    get retired() { return retired; },
    getSnapshot: () => {
      const current = primary.getSnapshot();
      const fallback = current.receipt?.outcome === "partial" ? history.getSnapshot() : undefined;
      if (basis.value !== undefined && basis.primary === current && basis.history === fallback) return basis.value;
      basis = { primary: current, history: fallback, value: composeHistory(current, fallback, basis.value) };
      return basis.value!;
    },
    subscribe: (listener) => {
      if (retired) return () => undefined;
      const attachment: Attachment = { listener, closed: false };
      attachments.add(attachment);
      if (primaryOff === undefined) primaryOff = primary.subscribe(broadcast);
      reconcile();
      return () => {
        if (attachment.closed) return;
        attachment.closed = true;
        attachments.delete(attachment);
        if (attachments.size === 0 && !retired) { release(); onIdle(); }
      };
    },
    retire: () => {
      if (retired) return;
      retired = true;
      release();
      notify();
      for (const attachment of attachments) attachment.closed = true;
      attachments.clear();
    },
  };
}

const declarationIds = new WeakMap<object, number>();
let nextDeclarationId = 0;
function declarationId(declaration: object): number {
  let id = declarationIds.get(declaration);
  if (id === undefined) { id = ++nextDeclarationId; declarationIds.set(declaration, id); }
  return id;
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
  entries?(): Promise<ItemInputs["entries"]>;
}

/** Owns query identity, lazy shared entries, and committed-local-input reevaluation for one client. */
export class ClientQueries {
  private readonly shared = new SharedSubscriptions();
  /** Composition cores with at least one consumer, by items declaration and composite identity. */
  private readonly compositions = new Map<string, HistoryCore<any, any, any, any>>();
  constructor(private readonly host: QueryHost) {}

  private async local<Args, Result>(
    request: ReturnType<typeof bindQueryRequest<Args, Result>>, drain: boolean,
    current: QueryView<Result>, fence: QueryFence, authoritative?: SubscriptionDelivery<Result>, inputs = emptyItemInputs,
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
    if (!this.host.active(fence)) return undefined;
    if (current.live && event.state === "hydrating") {
      // Keep the old value's own witnesses; a newer ledger does not advance them.
      // @ref LLP 1018.004#4-liveness-nudges-polls-and-where-admission-runs — a
      // follower has no local answer, so its items must still take the
      // runtime's current entries: the durable inbox rows it just wrote.
      return withItemInputs({ ...current } as SubscriptionDelivery<Result>,
        { ...inputs, entries: itemInputs(event)?.entries ?? (await this.host.entries?.()) ?? inputs.entries });
    }
    // A drain is caught up only after DrainSubscription.mark has finished its
    // watermark and replay-grant work. A store-input refresh can see the page
    // committed by that mark while the mark is still pending; it may update the
    // value, but cannot publish caughtUp ahead of the drain lifecycle.
    let refreshed = event as QueryMachineEvent<Result>;
    if (drain && event.state !== "refused") {
      const { caughtUp: _caughtUp, ...value } = event as QueryMachineEvent<Result> & { caughtUp?: boolean };
      const caughtUp = (current as QueryView<Result> & { caughtUp?: boolean }).caughtUp;
      refreshed = carryItemInputs(event, { ...value, ...(caughtUp === undefined ? {} : { caughtUp }) } as QueryMachineEvent<Result>);
    }
    // @ref LLP 1018.003#1-the-snapshot-record — evaluation provenance is
    // independent of transport liveness: a live connection can publish a twin result.
    refreshed = carryItemInputs(refreshed, { ...refreshed, source: "twin" } as QueryMachineEvent<Result>);
    if (!current.live || event.state === "refused") return refreshed as SubscriptionDelivery<Result>;
    if (authoritative && (authoritative.state === "complete" || authoritative.state === "capped")
      && (refreshed.state === "held"
        || ((refreshed.state === "complete" || refreshed.state === "capped")
          && refreshed.state === authoritative.state && refreshed.seq === authoritative.seq))
      && valueIdentity(refreshed) === valueIdentity(authoritative)) {
      const captured = itemInputs(refreshed);
      return withItemInputs({ ...authoritative }, captured && rebindItemInputs(captured,
        "data" in refreshed ? refreshed.data : undefined, authoritative.data));
    }
    const { connection: _connection, stale: _stale, ...fresh } = refreshed as QueryMachineEvent<Result> & {
      connection?: unknown; stale?: unknown;
    };
    return carryItemInputs(refreshed, { ...fresh, live: true } as SubscriptionDelivery<Result>);
  }

  observe<Args, Result, Row extends ItemRow, Draft, HistoryArgs, History>(
    ref: Op<Args, Result>, args: Args,
    options: { live?: false; drain?: boolean; items: ItemsWithHistory<Args, Result, Row, Draft, HistoryArgs, History> },
  ): ObservedQuery<Result, HistorySnapshot<Result, Row, Draft, History>>;
  observe<Args, Result, Row extends ItemRow, Draft>(
    ref: Op<Args, Result>, args: Args, options: { live?: false; drain?: boolean; items: Items<Args, Result, Row, Draft> },
  ): ObservedQuery<Result, ItemSnapshot<Result, Row, Draft>>;
  observe<Args, Result>(
    ref: Op<Args, Result>, args: Args, options?: { live?: false; drain?: boolean; items?: undefined },
  ): ObservedQuery<Result>;
  observe<Args, Result, Row extends ItemRow, Draft>(
    ref: Op<Args, Result>, args: Args, options: { live?: false; drain?: boolean; items?: Items<Args, Result, Row, Draft> } = {},
  ): ObservedQuery<Result> {
    const once = options.live === false, drain = options.drain === true;
    if (once && drain) throw new TypeError("query observation drain requires a live subscription");
    const request = bindQueryRequest(ref, args), fence = this.host.identity();
    const active = () => this.host.active(fence);
    const mode: QueryMode = once ? "once" : drain ? "drain" : "live";
    const key = queryIdentity(fence[0], fence[1], mode, request.op, request.args);
    const items = options.items;
    if (items && items.query !== request.op) throw new TypeError("items must describe the observed query");
    const projection = {
      key: items ?? snapshotProjection,
      project: (current: QuerySnapshot<Result>, previous?: Snapshot<Result>) => {
        if (!items) return current.snapshot;
        const before = previous as ItemSnapshot<Result, Row, Draft> | undefined;
        const joined = attachItems(items, request.args, current.snapshot.data, current.inputs, before?.items);
        if (before && before.items === joined && before.receipt === current.snapshot.receipt
          && before.data === current.snapshot.data && before.freshness === current.snapshot.freshness
          && before.local === current.snapshot.local && before.refusal === current.snapshot.refusal
          && before.status === current.snapshot.status && before.reason === current.snapshot.reason) return before;
        return freezeTree({ ...current.snapshot, items: joined });
      },
    };
    const observed = once ? this.shared.observe(queryEntry<Result, QueryMachineEvent<Result>>(
      key, (fanout) => oneShotQuery(() => this.host.query(request.ref, request.args), fanout),
      async (current, _authoritative, inputs = emptyItemInputs) => {
        const entries = await this.host.entries?.();
        if (!active() || entries === undefined) return undefined;
        // A one-shot keeps its original row witnesses and value. Ledger changes
        // can attach work but cannot turn it into an implicitly refreshed query.
        return withItemInputs({ ...current } as QueryMachineEvent<Result>, { ...inputs, entries });
      }, this.host.connection,
    ), active, projection) : this.shared.observe(queryEntry<Result, SubscriptionDelivery<Result>>(
      key,
      (fanout) => this.host.open(request.ref, request.args, fanout, drain),
      (current, authoritative, inputs) => this.local(request, drain, current, fence, authoritative, inputs),
      this.host.connection,
    ), active, projection);
    if (!items || !("history" in items)) return observed;
    const declared = items as ItemsWithHistory<Args, Result, Row, Draft>;
    const shareKey = `${key}\u0000${declarationId(declared)}`;
    const historyOp = declared.history.items.query;
    const historyArgs = structuredClone(declared.history.args(request.args));
    const historyRef = Object.freeze({ op: historyOp, [referencePath]: historyOp }) as Op<unknown, unknown>;
    const history = this.observe(historyRef, historyArgs, {
      ...(once ? { live: false as const } : {}), ...(drain ? { drain: true } : {}),
      items: declared.history.items as Items<unknown, unknown, Row, Draft>,
    });
    // This handle's own core serves detached reads and becomes the registered
    // core when it is the first to subscribe; otherwise the handle joins the
    // core another handle registered.
    let own: HistoryCore<Result, Row, Draft, unknown> | undefined;
    const detached = () => own ??= historyCore(observed as ObservedQuery<Result, ItemSnapshot<Result, Row, Draft>>, history,
      () => { if (this.compositions.get(shareKey) === own) this.compositions.delete(shareKey); });
    // A retired handle (its core was cleared) keeps reading fallbacks and never
    // registers again; a fresh handle after `clear()` builds a live core.
    const handle: ObservedQuery<Result, HistorySnapshot<Result, Row, Draft, unknown>> = {
      getSnapshot: () => (own?.retired ? own : this.compositions.get(shareKey) ?? detached()).getSnapshot(),
      subscribe: (listener) => {
        if (own?.retired) return () => undefined;
        let core = this.compositions.get(shareKey);
        if (core === undefined) { core = detached(); this.compositions.set(shareKey, core); }
        return core.subscribe(listener);
      },
    };
    return handle;
  }

  subscribe<Args, Result>(
    ref: Op<Args, Result>, args: Args, callback: (event: SubscriptionDelivery<Result>) => void, options: { drain?: boolean } = {},
  ): Subscription<SubscriptionDelivery<Result>> {
    const request = bindQueryRequest(ref, args), drain = options.drain === true, fence = this.host.identity();
    const mode: QueryMode = drain ? "drain" : "live";
    return this.shared.attach(queryEntry<Result, SubscriptionDelivery<Result>>(
      queryIdentity(fence[0], fence[1], mode, request.op, request.args),
      (fanout) => this.host.open(request.ref, request.args, fanout, drain),
      (current, authoritative, inputs) => this.local(request, drain, current, fence, authoritative, inputs),
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
  clear(except?: Subscription<unknown>): void {
    this.shared.clear(except);
    for (const core of this.compositions.values()) core.retire();
    this.compositions.clear();
  }
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
