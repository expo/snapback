// Deferred Snapback Contract links — mount the board before the backend exists.
//
// ENG-23727: All Aboard must paint a useful departure board on the initial
// app paint, with backend health/ensure/live-subscribe running behind it.
// createSnapbackContractSurface awaits every live subscription before it
// returns its links, and the generated bindings throw when links are read
// before configuration — so mounting first needs a stand-in.
//
// This shim implements the same links surface the adapter returns, but each
// query link hands the Contract runtime a forwarding ContractQueryHandle that
// stays SILENT until attach(realLinks) is called: the runtime keeps the query
// binding 'pending' until its first delivery, so the .contract's `loading`
// arm renders (the schedule-data board) with zero backend. Once the real
// surface connects, every outstanding subscription subscribes through to the
// real handle and forwards deliveries verbatim — the attached DataCellV2 ride
// along on the rows array, so status/connection sugar (`stale rows`) works
// exactly as if the real links had been there from the start. Mutations queue
// behind the attach and then call through.

type QueryNotify = (rows: unknown[]) => void;
type RealQueryHandle = {
  subscribe(notify: QueryNotify): { current: readonly unknown[]; dispose(): void };
  read(): unknown[];
};
type RealLinks = Record<string, (args?: Record<string, unknown>) => unknown>;

export interface DeferredContractLinks {
  links: RealLinks;
  /** Wire the real adapter links in; flushes queued mutations and silent subscriptions. */
  attach(real: RealLinks): void;
  /** Fires once, on the first real query delivery forwarded to the mounted app. */
  onFirstDelivery(callback: () => void): void;
  dispose(): void;
}

export function createDeferredContractLinks({
  queries,
  mutations,
}: {
  queries: string[];
  mutations: string[];
}): DeferredContractLinks {
  let realLinks: RealLinks | null = null;
  let disposed = false;
  let delivered = false;
  let firstDeliveryCallback: (() => void) | null = null;
  const waiters: Array<(real: RealLinks) => void> = [];

  const whenReal = (): Promise<RealLinks> =>
    realLinks ? Promise.resolve(realLinks) : new Promise((resolve) => waiters.push(resolve));

  const markDelivered = () => {
    if (delivered) return;
    delivered = true;
    firstDeliveryCallback?.();
  };

  const links: RealLinks = {};
  for (const name of queries) {
    links[name] = (args: Record<string, unknown> = {}) => {
      let lastRows: readonly unknown[] = [];
      return {
        __exactContractQuery: true,
        table: name,
        key: `deferred:${name}`,
        read: () => [...lastRows],
        subscribe(notify: QueryNotify) {
          let subscriptionDisposed = false;
          let inner: { dispose(): void } | null = null;
          void whenReal().then((real) => {
            if (subscriptionDisposed || disposed) return;
            const handle = real[name](args) as RealQueryHandle;
            inner = handle.subscribe((rows) => {
              lastRows = rows;
              markDelivered();
              notify(rows);
            });
          });
          return {
            get current() {
              return lastRows;
            },
            dispose() {
              subscriptionDisposed = true;
              inner?.dispose();
              inner = null;
            },
          };
        },
      };
    };
  }
  for (const name of mutations) {
    links[name] = (args: Record<string, unknown> = {}) =>
      whenReal().then((real) => real[name](args));
  }

  return {
    links,
    attach(real) {
      realLinks = real;
      for (const waiter of waiters.splice(0)) waiter(real);
    },
    onFirstDelivery(callback) {
      firstDeliveryCallback = callback;
      if (delivered) callback();
    },
    dispose() {
      disposed = true;
      waiters.length = 0;
      firstDeliveryCallback = null;
    },
  };
}
