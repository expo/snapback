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

export function createDeferredContractLinks({ queries = [], mutations = [], ephemerals = [] } = {}) {
  let realLinks = null;
  let disposed = false;
  let delivered = false;
  const firstDeliveryCallbacks = new Set();
  const waiters = [];

  const whenReal = () =>
    realLinks ? Promise.resolve(realLinks) : new Promise((resolve) => waiters.push(resolve));

  const markDelivered = () => {
    if (delivered) return;
    delivered = true;
    for (const callback of [...firstDeliveryCallbacks]) callback();
  };

  const links = {};
  for (const name of queries) {
    links[name] = (args = {}) => {
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
          let subscriptionDisposed = false;
          let inner = null;
          void whenReal().then((real) => {
            if (subscriptionDisposed || disposed) return;
            const handle = real[name](args);
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
  for (const name of ephemerals) {
    // Ephemeral maps hold 'pending' the same way queries do: the handle stays
    // silent until attach, then subscribes through and forwards cells.
    links[name] = (args = {}) => {
      if (realLinks) return realLinks[name](args);
      return {
        __exactContractEphemeral: true,
        name,
        key: `deferred:${name}`,
        subscribe(observer) {
          let subscriptionDisposed = false;
          let inner = null;
          void whenReal().then((real) => {
            if (subscriptionDisposed || disposed) return;
            inner = real[name](args).subscribe(observer);
          });
          return {
            dispose() {
              subscriptionDisposed = true;
              inner?.dispose();
              inner = null;
            },
          };
        },
      };
    };
    links[`${name}Publish`] = (args = {}) =>
      realLinks ? realLinks[`${name}Publish`](args) : whenReal().then((real) => real[`${name}Publish`](args));
  }
  for (const name of mutations) {
    links[name] = (args = {}) =>
      realLinks ? realLinks[name](args) : whenReal().then((real) => real[name](args));
  }

  return {
    links,
    get attached() {
      return realLinks !== null;
    },
    attach(real) {
      if (realLinks || disposed) return;
      realLinks = real;
      for (const waiter of waiters.splice(0)) waiter(real);
    },
    onFirstDelivery(callback) {
      firstDeliveryCallbacks.add(callback);
      if (delivered) callback();
    },
    dispose() {
      disposed = true;
      waiters.length = 0;
      firstDeliveryCallbacks.clear();
    },
  };
}

// Backoff policy: same shape All Aboard shipped with (1s doubling to a 15s
// cap). Transient failures (server down, network) retry forever while the app
// keeps presenting its bundled data; a structured contract diagnostic (stale
// generated artifacts) is a build defect, not an outage — it rejects
// `attached` immediately and does not retry. The app still paints: honest
// failure surfaces beat a blocking boot screen either way (ENG-23727).
const RENDER_FIRST_BASE_DELAY_MS = 1_000;
const RENDER_FIRST_MAX_DELAY_MS = 15_000;

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
      retryTimer = setTimeout(() => {
        retryTimer = null;
        resolve();
      }, ms);
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
        if (error && typeof error === 'object' && error.diagnostic) {
          rejectAttached(error);
          return;
        }
        const delayMs = Math.min(retryMaxDelayMs, retryBaseDelayMs * 2 ** Math.min(attempt, 4));
        onRetry?.(error, { attempt, delayMs });
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
      disposed = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      deferred.dispose();
      realSurface?.dispose();
      realSurface = null;
      rejectAttached(new Error('Render-first Snapback Contract surface was disposed before attach.'));
    },
  };
}
