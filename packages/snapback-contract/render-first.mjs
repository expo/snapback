// Render-first Snapback Contract surface (ENG-23736).
//
// @ref LLP 0034#107-render-first-surface-mode-2026-07-09-eng-23736 - the
//   adapter owns render-before-connect: links return synchronously with every
//   binding pending; connection, ensure, and subscription establishment run
//   behind the mounted app and bindings go live in place on attach.
//
// createSnapbackContractSurface treats the connection as a precondition: it
// awaits health-independent construction and every live snapshot-with-subscribe
// before returning its links, and the generated per-binding modules throw when
// links are read before configuration. An app that wants a useful first paint
// from bundled/deterministic data (All Aboard's board-first startup, ENG-23727)
// therefore had to hand-roll a forwarding-links shim
// (demos/all-aboard/surfaces/contract/deferred-links.ts, now deleted — this
// module is that shim promoted to the package, plus the background
// connect/retry/attach loop every copy of it would have carried).
//
// Contract of the deferred links: a query link hands the Contract runtime a
// forwarding ContractQueryHandle that stays SILENT until the real links
// attach — the runtime keeps the binding 'pending' until its first delivery,
// so the .contract's `loading` arm renders with zero backend. On attach every
// outstanding subscription subscribes through to the real handle and forwards
// deliveries verbatim (the attached DataCellV2 rides along on the rows array,
// so `stale rows` sugar and `<binding>.connection` keep working). Mutation
// links queue behind the attach and then call through. Ephemeral map links
// mirror the query shape (silent handle until attach; publishes queue).

// Keep the namespace object live across the intentional index -> render-first
// -> index cycle. Ibex's ESM-to-CJS fallback snapshots named imports while a
// cyclic dependency is still initializing; the namespace object is the stable
// partial-exports object and receives these functions before callers construct
// a render-first surface.
import * as snapbackContract from './index.mjs';
import { isConnectivityFailureError } from './connectivity-failure.mjs';

const disposedError = () => {
  const error = new Error('Render-first Snapback Contract surface was disposed before attach.');
  error.code = 'SNAPBACK_CONTRACT_SURFACE_DISPOSED';
  return error;
};

const disposalAggregate = (errors) => {
  const error = new AggregateError(
    errors,
    'Render-first Snapback Contract teardown failed after completing cleanup.',
  );
  error.code = 'SNAPBACK_CONTRACT_SURFACE_DISPOSAL_FAILED';
  return error;
};

const collectDisposalError = (errors, error) => {
  if (
    error instanceof AggregateError &&
    error.code === 'SNAPBACK_CONTRACT_SURFACE_DISPOSAL_FAILED'
  ) {
    errors.push(...error.errors);
  } else {
    errors.push(error);
  }
};

export function createDeferredContractLinks({ queries = [], mutations = [], ephemerals = [] } = {}) {
  let realLinks = null;
  let disposed = false;
  let delivered = false;
  const firstDeliveryCallbacks = new Set();
  const waiters = new Set();
  const forwardingSubscriptions = new Set();

  const waitForReal = () => {
    if (disposed) return { promise: Promise.reject(disposedError()), cancel() {} };
    if (realLinks) return { promise: Promise.resolve(realLinks), cancel() {} };
    let active = true;
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const waiter = {
      resolve(value) {
        if (!active) return;
        active = false;
        resolvePromise(value);
      },
      reject(error) {
        if (!active) return;
        active = false;
        rejectPromise(error);
      },
    };
    waiters.add(waiter);
    return {
      promise,
      cancel() {
        if (!active) return;
        waiters.delete(waiter);
        // Settle the private promise so cancellation leaves neither a retained
        // waiter nor a forever-pending chain. Subscription callbacks treat
        // null as the cancelled sentinel and never expose it to the runtime.
        waiter.resolve(null);
      },
    };
  };

  const whenReal = () => waitForReal().promise;

  const forwardSubscription = (subscribe) => {
    const pending = waitForReal();
    let inner = null;
    const forwarding = {
      disposed: false,
      dispose() {
        if (forwarding.disposed) return;
        forwarding.disposed = true;
        pending.cancel();
        forwardingSubscriptions.delete(forwarding);
        const active = inner;
        inner = null;
        active?.dispose();
      },
    };
    forwardingSubscriptions.add(forwarding);
    void pending.promise.then((real) => {
      if (!real || forwarding.disposed || disposed) return;
      const attached = subscribe(real);
      // A real subscription may deliver synchronously. If that callback
      // disposes this deferred surface, the registry sees `inner === null`;
      // close the just-returned handle here instead of retaining it forever.
      if (forwarding.disposed || disposed) attached?.dispose();
      else inner = attached;
    }).catch(() => {
      forwarding.dispose();
    });
    return forwarding;
  };

  const assertActive = () => {
    if (disposed) throw disposedError();
  };

  const markDelivered = () => {
    if (delivered) return;
    delivered = true;
    for (const callback of [...firstDeliveryCallbacks]) {
      try {
        callback();
      } catch {
        // App callbacks cannot interrupt delivery or corrupt lifecycle state.
      }
    }
  };

  const links = {};
  for (const name of queries) {
    links[name] = (args = {}) => {
      assertActive();
      // Post-attach reads go straight to the real link: late binds behave
      // exactly as if the deferred layer had never existed.
      if (realLinks) return realLinks[name](args);
      let lastRows = [];
      return {
        __exactContractQuery: true,
        table: name,
        key: `deferred:${name}`,
        read: () => [...lastRows],
        subscribe(notify) {
          const forwarding = forwardSubscription((real) => {
            const handle = real[name](args);
            return handle.subscribe((rows) => {
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
              forwarding.dispose();
            },
          };
        },
      };
    };
  }
  for (const name of ephemerals) {
    // Ephemeral maps hold 'pending' the same way queries do: the handle stays
    // silent until attach, then subscribes through and forwards cells.
    links[name] = (args = {}) => {
      assertActive();
      if (realLinks) return realLinks[name](args);
      return {
        __exactContractEphemeral: true,
        name,
        key: `deferred:${name}`,
        subscribe(observer) {
          const forwarding = forwardSubscription((real) =>
            real[name](args).subscribe(observer));
          return {
            dispose() {
              forwarding.dispose();
            },
          };
        },
      };
    };
    links[`${name}Publish`] = (args = {}) => {
      assertActive();
      return realLinks ? realLinks[`${name}Publish`](args) : whenReal().then((real) => real[`${name}Publish`](args));
    };
  }
  for (const name of mutations) {
    links[name] = (args = {}) => {
      assertActive();
      return realLinks ? realLinks[name](args) : whenReal().then((real) => real[name](args));
    };
  }

  return {
    links,
    get attached() {
      return realLinks !== null && !disposed;
    },
    get pendingAttachCount() {
      return waiters.size;
    },
    attach(real) {
      if (realLinks || disposed) return;
      realLinks = real;
      const pending = [...waiters];
      waiters.clear();
      for (const waiter of pending) waiter.resolve(real);
    },
    onFirstDelivery(callback) {
      if (disposed) return;
      firstDeliveryCallbacks.add(callback);
      if (delivered) {
        try {
          callback();
        } catch {
          // Same isolation rule as the first-delivery fan-out above.
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const disposalErrors = [];
      for (const subscription of [...forwardingSubscriptions]) {
        try {
          subscription.dispose();
        } catch (error) {
          // Continue deterministically in insertion order: one misbehaving
          // inner handle cannot retain siblings or strand the waiters below.
          disposalErrors.push(error);
        }
      }
      const error = disposedError();
      const pending = [...waiters];
      waiters.clear();
      for (const waiter of pending) waiter.reject(error);
      firstDeliveryCallbacks.clear();
      if (disposalErrors.length > 0) throw disposalAggregate(disposalErrors);
    },
  };
}

// Backoff policy: same shape All Aboard shipped with (1s doubling to a 15s
// cap). Proven transport-connectivity failures retry forever while the app
// keeps presenting its bundled data. Anything that produced an HTTP response,
// or otherwise lacks connectivity provenance, is terminal — diagnostic codes
// alone never opt an error into retry. The app still paints: honest failure
// surfaces beat a blocking boot screen either way (ENG-23727).
const RENDER_FIRST_BASE_DELAY_MS = 1_000;
const RENDER_FIRST_MAX_DELAY_MS = 15_000;
const QUERY_OFFLINE_UNAVAILABLE = 'SNAPBACK_QUERY_OFFLINE_UNAVAILABLE';

// @ref LLP 0034#107-render-first-surface-mode-2026-07-09-eng-23736 — the Full
// client turns a proven live-subscribe dispatch failure into this typed D4
// refusal while retaining the dispatch provenance on its direct cause. This
// adapter-only recognition must not widen the shared outbox classifier.
const isRenderFirstConnectivityFailureError = (error) => (
  isConnectivityFailureError(error)
  || (
    error?.code === QUERY_OFFLINE_UNAVAILABLE
    && error?.cause?.fetchDispatchFailed === true
  )
);

export function createRenderFirstSnapbackContractSurface(options = {}) {
  const {
    manifest,
    connect = null,
    onRetry = null,
    retryBaseDelayMs = RENDER_FIRST_BASE_DELAY_MS,
    retryMaxDelayMs = RENDER_FIRST_MAX_DELAY_MS,
    ...surfaceOptions
  } = options;

  // Validation runs up front so a build defect is a fact on the handle from
  // construction, but it must NOT throw here: the render-first guarantee is
  // that the app always gets mountable links (the bundled-data board paints
  // even over a broken backend pairing). The defect rejects `attached`.
  const diagnostics = snapbackContract.validateSnapbackContractArtifacts({
    manifest,
    artifactIndex: surfaceOptions.artifactIndex ?? null,
    schemaManifest: surfaceOptions.schemaManifest ?? null,
    functionManifest: surfaceOptions.functionManifest ?? null,
  });
  const blockingDiagnostic = diagnostics.find((diagnostic) => diagnostic.severity === 'error');

  const queries = [];
  const ephemerals = [];
  for (const [name, descriptor] of Object.entries(manifest?.queries ?? {})) {
    if (descriptor?.ephemeral === true) ephemerals.push(name);
    else queries.push(name);
  }
  const deferred = createDeferredContractLinks({
    queries,
    ephemerals,
    mutations: Object.keys(manifest?.mutations ?? {}),
  });

  let disposed = false;
  let realSurface = null;
  let retryTimer = null;
  let cancelRetrySleep = null;
  let resolveAttached;
  let rejectAttached;
  const attached = new Promise((resolve, reject) => {
    resolveAttached = resolve;
    rejectAttached = reject;
  });
  // The handle is usable without ever consuming `attached` (links + facts are
  // enough for many apps); a rejection must not surface as an unhandled one.
  attached.catch(() => {});

  // Deliberately NOT unref'd: the backoff timer is the pending attach itself
  // (a disposed handle clears it), so a node process awaiting `attached` must
  // stay alive through it.
  const sleep = (ms) =>
    new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
        cancelRetrySleep = null;
        resolve();
      };
      retryTimer = setTimeout(() => {
        finish();
      }, ms);
      cancelRetrySleep = finish;
    });

  void (async () => {
    if (blockingDiagnostic) {
      const error = new Error(blockingDiagnostic.message);
      error.diagnostic = blockingDiagnostic;
      rejectAttached(error);
      return;
    }
    for (let attempt = 0; ; attempt++) {
      if (disposed) return;
      try {
        if (connect) await connect({ client: surfaceOptions.client, attempt });
        const surface = await snapbackContract.createSnapbackContractSurface({
          manifest,
          ...surfaceOptions,
          // `runtime` may arrive as the module namespace or a promise of one
          // (render-first callers construct synchronously, often before their
          // dynamic runtime import resolves).
          runtime: await surfaceOptions.runtime,
        });
        if (disposed) {
          // dispose() raced construction: the surface just established live
          // subscriptions nobody will drain — release them.
          surface.dispose();
          return;
        }
        realSurface = surface;
        deferred.attach(surface.links);
        resolveAttached(surface);
        return;
      } catch (error) {
        if (disposed) return;
        if (!isRenderFirstConnectivityFailureError(error)) {
          rejectAttached(error);
          return;
        }
        const delayMs = Math.min(retryMaxDelayMs, retryBaseDelayMs * 2 ** Math.min(attempt, 4));
        if (onRetry) {
          try {
            onRetry(error, { attempt, delayMs });
          } catch {
            // Retry hooks are observational; they cannot terminate attachment.
          }
        }
        await sleep(delayMs);
      }
    }
  })();

  return {
    links: deferred.links,
    attached,
    surface: () => realSurface,
    diagnostics,
    onFirstDelivery: (callback) => deferred.onFirstDelivery(callback),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      const disposalErrors = [];
      try {
        cancelRetrySleep?.();
      } catch (error) {
        collectDisposalError(disposalErrors, error);
      }
      try {
        deferred.dispose();
      } catch (error) {
        collectDisposalError(disposalErrors, error);
      }
      try {
        realSurface?.dispose();
      } catch (error) {
        collectDisposalError(disposalErrors, error);
      }
      realSurface = null;
      rejectAttached(disposedError());
      if (disposalErrors.length > 0) throw disposalAggregate(disposalErrors);
    },
  };
}
