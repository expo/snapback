// Framework-neutral live-query external store.
//
// @ref LLP 0012#react-and-expo-requirements — React/Expo and vanilla consume
//   one lifecycle primitive with an authoritative initial snapshot, late-handle
//   disposal, connection/error state, and honest Online capability.
// @ref LLP 0063#workstream-2--first-class-react-expo-and-vanilla-projections —
//   StrictMode replay, HMR/unmount, mutation settlement, and handshake refusal
//   are package behavior rather than app-local hooks.

export const SNAPBACK_EXTERNAL_STORE_PROTOCOL = 'snapback.external-store.v1';

let mutationSequence = 0;

function freezeSnapshot(snapshot) {
  return Object.freeze({
    protocol: SNAPBACK_EXTERNAL_STORE_PROTOCOL,
    status: 'pending',
    rows: Object.freeze([]),
    connection: 'connecting',
    error: null,
    // Row freshness (LLP 0090 D1 / LLP 0043 retained-data distinction):
    // 'retained' rows come from persistence/preload and are never presented
    // as current — they ride the existing 'pending' status; 'current' rows
    // arrived through an authoritative delivery.
    freshness: 'unknown',
    generation: 0,
    mutation: Object.freeze({
      status: 'idle',
      id: null,
      error: null,
      pendingCount: 0,
      attempts: Object.freeze([]),
      lastSettlement: null,
    }),
    ...snapshot,
  });
}

function serializedError(error) {
  return Object.freeze({
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    ...(error?.code ? { code: error.code } : {}),
    ...(error?.diagnostic ? { diagnostic: error.diagnostic } : {}),
  });
}

export function assertExternalStoreCompatibility({
  expected = SNAPBACK_EXTERNAL_STORE_PROTOCOL,
  actual,
  provider = 'unknown',
} = {}) {
  if (actual === expected) return;
  const received = actual === undefined ? 'missing' : actual;
  const diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code: 'SNAPBACK_EXTERNAL_STORE_INCOMPATIBLE',
    severity: 'error',
    message: `external-store protocol mismatch for ${provider}: expected ${expected}, received ${received}`,
    details: Object.freeze({ expected, actual: actual ?? null, provider }),
  });
  const error = new Error(`${diagnostic.code}: ${diagnostic.message}`);
  error.code = diagnostic.code;
  error.diagnostic = diagnostic;
  throw error;
}

function canonicalValue(value, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('external-store identity refuses non-finite numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === undefined) return undefined;
  if (typeof value !== 'object') throw new TypeError(`external-store identity refuses ${typeof value}`);
  if (seen.has(value)) throw new TypeError('external-store identity refuses cyclic values');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => {
        const canonical = canonicalValue(entry, seen);
        if (canonical === undefined) throw new TypeError('external-store identity refuses undefined array entries');
        return canonical;
      });
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError('external-store identity accepts only plain objects');
    }
    return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
      const canonical = canonicalValue(value[key], seen);
      return canonical === undefined ? [] : [[key, canonical]];
    }));
  } finally {
    seen.delete(value);
  }
}

export function externalStoreIdentity({ provider = 'unknown', query, args = {}, authority = 'default' }) {
  return JSON.stringify([provider, query, authority, canonicalValue(args, new Set())]);
}

export function createExternalQueryStore({
  start,
  identity,
  initialRows = [],
  initialConnection = 'connecting',
  protocol = SNAPBACK_EXTERNAL_STORE_PROTOCOL,
  provider = 'unknown',
  onIdle = null,
} = {}) {
  if (typeof start !== 'function') throw new TypeError('createExternalQueryStore requires start(controller)');
  assertExternalStoreCompatibility({ actual: protocol, provider });

  const listeners = new Set();
  let authoritativeRows = Object.freeze([...initialRows]);
  const optimisticLayers = [];
  const activeMutations = new Map();
  let snapshot = freezeSnapshot({
    rows: authoritativeRows,
    connection: initialConnection,
    identity: identity ?? null,
  });
  let generation = 0;
  let upstream = null;
  let starting = false;
  let closed = false;
  let lateHandleDisposals = 0;
  let ignoredLateDeliveries = 0;
  let lastDisposalError = null;
  let startCompletion = Promise.resolve(null);
  let authoritativeRevision = 0;

  const materializeRows = () => optimisticLayers.reduce(
    (rows, layer) => layer.suppressed
      ? rows
      : Object.freeze([...(layer.apply(rows) ?? [])]),
    authoritativeRows,
  );
  const settlementIdMap = (result) => {
    const candidate = result?.receipt?.idMap ?? result?.idMap;
    return Array.isArray(candidate)
      ? Object.freeze(candidate.map((entry) => Object.freeze({ ...entry })))
      : null;
  };
  const suppressWhenAuthoritative = (layer) => {
    if (layer.suppressed) return true;
    if (layer.isAuthoritative?.(authoritativeRows, {
      id: layer.id,
      status: layer.status,
      result: layer.result,
      idMap: layer.idMap,
    }) === true) {
      layer.suppressed = true;
    }
    return layer.suppressed;
  };
  const acceptAuthoritativeRows = (rows) => {
    authoritativeRows = Object.freeze([...(rows ?? [])]);
    authoritativeRevision += 1;
    for (let index = optimisticLayers.length - 1; index >= 0; index -= 1) {
      const layer = optimisticLayers[index];
      // @ref LLP 0133#divergence-on-settle — map-aware retirement receives
      //   the submitting receipt's private id-map; fan-out never carries it.
      suppressWhenAuthoritative(layer);
      // A generated/provider matcher handles query-before-response ordering.
      // Without one, the conservative fallback is the first authoritative
      // delivery strictly after transport confirmation.
      if (
        layer.status === 'confirmed'
        && (layer.suppressed || authoritativeRevision > layer.confirmedAtRevision)
      ) optimisticLayers.splice(index, 1);
    }
    return materializeRows();
  };
  const mutationState = (settlement = null) => {
    const attempts = Object.freeze([...activeMutations.values()].map(({ id }) => Object.freeze({
      id,
      status: 'pending',
    })));
    if (attempts.length > 0) {
      return Object.freeze({
        status: 'pending',
        id: attempts.at(-1).id,
        error: null,
        pendingCount: attempts.length,
        attempts,
        lastSettlement: settlement,
      });
    }
    if (settlement) {
      return Object.freeze({
        ...settlement,
        pendingCount: 0,
        attempts,
        lastSettlement: settlement,
      });
    }
    return Object.freeze({
      status: 'idle',
      id: null,
      error: null,
      pendingCount: 0,
      attempts,
      lastSettlement: null,
    });
  };

  const notify = () => {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* one consumer cannot starve siblings */ }
    }
  };
  const publish = (patch, expectedGeneration = generation) => {
    if (closed || expectedGeneration !== generation || listeners.size === 0) {
      ignoredLateDeliveries += 1;
      return false;
    }
    const acceptedPatch = typeof patch === 'function' ? patch() : patch;
    snapshot = freezeSnapshot({ ...snapshot, ...acceptedPatch, generation });
    notify();
    return true;
  };
  const disposeAttempt = () => {
    generation += 1;
    starting = false;
    const handle = upstream;
    upstream = null;
    try {
      handle?.dispose?.();
    } catch (error) {
      lastDisposalError = serializedError(error);
    }
    onIdle?.();
  };
  const ensureStarted = () => {
    if (closed || starting || upstream || listeners.size === 0) return;
    const attemptGeneration = ++generation;
    starting = true;
    snapshot = freezeSnapshot({
      ...snapshot,
      status: 'pending',
      connection: initialConnection,
      error: null,
      generation,
    });
    notify();
    let delivered = false;
    const controller = Object.freeze({
      pending(connection = 'connecting', previous = snapshot.rows) {
        publish({ status: 'pending', connection, rows: Object.freeze([...previous]), error: null }, attemptGeneration);
      },
      // Persisted/preloaded rows surfaced before the first authoritative
      // answer (LLP 0090 D3 render-first): the existing 'pending' status —
      // never 'ready' — with the freshness fact exposed on the snapshot.
      retained(rows, connection = snapshot.connection) {
        publish(
          () => ({
            status: 'pending',
            rows: acceptAuthoritativeRows(rows),
            connection,
            error: null,
            freshness: 'retained',
          }),
          attemptGeneration,
        );
      },
      ready(rows, connection = snapshot.connection) {
        delivered = publish(
          () => ({ status: 'ready', rows: acceptAuthoritativeRows(rows), connection, error: null, freshness: 'current' }),
          attemptGeneration,
        ) || delivered;
      },
      refreshing(rows = snapshot.rows, connection = snapshot.connection) {
        delivered = publish(
          () => ({ status: 'refreshing', rows: acceptAuthoritativeRows(rows), connection, error: null, freshness: 'current' }),
          attemptGeneration,
        ) || delivered;
      },
      error(error, { previous = snapshot.rows, connection = 'disconnected' } = {}) {
        delivered = true;
        publish({ status: 'error', rows: Object.freeze([...(previous ?? [])]), connection, error: serializedError(error) }, attemptGeneration);
      },
      connection(connection) {
        publish({ connection }, attemptGeneration);
      },
    });

    let startResult;
    try {
      startResult = start(controller);
    } catch (error) {
      startResult = Promise.reject(error);
    }
    startCompletion = Promise.resolve(startResult).then((handle) => {
      if (closed || attemptGeneration !== generation || listeners.size === 0) {
        lateHandleDisposals += 1;
        handle?.dispose?.();
        return null;
      }
      try {
        if (handle?.protocol !== undefined) {
          assertExternalStoreCompatibility({ actual: handle.protocol, provider });
        }
      } catch (error) {
        try {
          handle?.dispose?.();
        } catch (disposeError) {
          lastDisposalError = serializedError(disposeError);
        }
        throw error;
      }
      starting = false;
      upstream = handle ?? { dispose() {} };
      if (!delivered && Array.isArray(handle?.rows)) {
        controller.ready(handle.rows, handle.connection ?? snapshot.connection);
      }
      return upstream;
    }).catch((error) => {
      if (closed || attemptGeneration !== generation || listeners.size === 0) {
        ignoredLateDeliveries += 1;
        return null;
      }
      starting = false;
      controller.error(error);
      return null;
    });
  };

  const store = {
    protocol: SNAPBACK_EXTERNAL_STORE_PROTOCOL,
    identity: identity ?? null,
    subscribe(listener) {
      if (closed) return () => {};
      listeners.add(listener);
      ensureStarted();
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
        if (listeners.size === 0) disposeAttempt();
      };
    },
    getSnapshot() { return snapshot; },
    getServerSnapshot() { return snapshot; },
    whenStarted() { return startCompletion; },
    async runMutation(call, {
      optimisticRows = null,
      isAuthoritative = null,
      id = `mutation-${++mutationSequence}`,
    } = {}) {
      if (closed) throw new Error('external query store is closed');
      if (activeMutations.has(id)) {
        throw new Error(`external query store already has active mutation ${id}`);
      }
      const layer = optimisticRows === null ? null : {
        id,
        status: 'pending',
        result: undefined,
        idMap: null,
        suppressed: false,
        confirmedAtRevision: null,
        isAuthoritative,
        apply: typeof optimisticRows === 'function'
          ? optimisticRows
          : () => optimisticRows,
      };
      if (layer) optimisticLayers.push(layer);
      activeMutations.set(id, { id });
      snapshot = freezeSnapshot({
        ...snapshot,
        ...(layer === null ? {} : { rows: materializeRows() }),
        mutation: mutationState(),
      });
      notify();
      try {
        const result = await call();
        const idMap = settlementIdMap(result);
        if (layer) {
          layer.status = 'confirmed';
          layer.result = result;
          layer.idMap = idMap;
          layer.confirmedAtRevision = authoritativeRevision;
          // Delivery may win the race. Re-evaluate the latest authoritative
          // base now that confirmation has supplied the id-map, then splice
          // without waiting for a redundant subsequent delivery.
          suppressWhenAuthoritative(layer);
          if (layer.suppressed) {
            const index = optimisticLayers.indexOf(layer);
            if (index >= 0) optimisticLayers.splice(index, 1);
          }
        }
        activeMutations.delete(id);
        const settlement = Object.freeze({
          status: 'confirmed',
          id,
          error: null,
          result,
          idMap,
        });
        snapshot = freezeSnapshot({
          ...snapshot,
          rows: materializeRows(),
          mutation: mutationState(settlement),
        });
        notify();
        return result;
      } catch (error) {
        if (layer) {
          const index = optimisticLayers.indexOf(layer);
          if (index >= 0) optimisticLayers.splice(index, 1);
        }
        activeMutations.delete(id);
        const settlement = Object.freeze({
          status: 'rejected',
          id,
          error: serializedError(error),
          idMap: settlementIdMap(error),
        });
        snapshot = freezeSnapshot({
          ...snapshot,
          rows: materializeRows(),
          mutation: mutationState(settlement),
        });
        notify();
        throw error;
      }
    },
    inspection() {
      return Object.freeze({
        identity: identity ?? null,
        generation,
        listeners: listeners.size,
        active: upstream !== null || starting,
        lateHandleDisposals,
        ignoredLateDeliveries,
        lastDisposalError,
        optimisticLayers: optimisticLayers.length,
        // A confirmed layer remains an explicit bridge until a map-aware
        // matcher or the conservative post-confirmation delivery fallback
        // retires it. This is inspection state, never an assertion that the
        // speculative rows are authoritative.
        // @ref LLP 0133#divergence-on-settle — delayed delivery must remain
        //   visibly bridged without flickering to the pre-mutation base.
        optimisticLayerStatuses: Object.freeze(optimisticLayers.map((layer) => Object.freeze({
          id: layer.id,
          status: layer.status === 'confirmed' ? 'bridging' : 'pending',
          idMap: layer.idMap,
        }))),
        pendingMutations: activeMutations.size,
        closed,
      });
    },
    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      disposeAttempt();
    },
  };
  return Object.freeze(store);
}

/**
 * Provider-scoped logical-store registry. Equivalent sibling bindings share
 * one upstream attempt while retaining independent React/vanilla subscriber
 * cleanup. Idle entries are evicted after the current microtask so StrictMode
 * cleanup/replay can reattach without creating a parallel store.
 */
export function createExternalQueryStoreRegistry() {
  const stores = new Map();
  let closed = false;

  const registry = {
    get(options = {}) {
      if (closed) throw new Error('external query store registry is closed');
      if (typeof options.identity !== 'string' || options.identity.length === 0) {
        throw new TypeError('external query store registry requires a non-empty identity');
      }
      const protocol = options.protocol ?? SNAPBACK_EXTERNAL_STORE_PROTOCOL;
      const key = JSON.stringify([protocol, options.identity]);
      const existing = stores.get(key);
      if (existing) return existing;
      let store;
      store = createExternalQueryStore({
        ...options,
        protocol,
        onIdle() {
          queueMicrotask(() => {
            if (
              stores.get(key) === store
              && store.inspection().listeners === 0
            ) stores.delete(key);
          });
        },
      });
      stores.set(key, store);
      return store;
    },
    inspection() {
      return Object.freeze({
        closed,
        stores: stores.size,
        identities: Object.freeze([...stores.values()].map((store) => store.identity)),
      });
    },
    close() {
      if (closed) return;
      closed = true;
      for (const store of stores.values()) store.close();
      stores.clear();
    },
  };
  return Object.freeze(registry);
}

/** Group independently keyed stores behind one vanilla view generation. */
export class ExternalQueryScope {
  constructor(onChange = () => {}) {
    this.generation = 0;
    this.bindings = new Set();
    this.disposedSubscriptions = 0;
    this.ignoredStaleUpdates = 0;
    this.closed = false;
    this.onChange = onChange;
  }

  renew() {
    if (this.closed) throw new Error('external query scope is closed');
    this.generation += 1;
    for (const binding of [...this.bindings]) this.disposeBinding(binding);
    this.bindings.clear();
    this.notify();
    return this.generation;
  }

  async watch(start, observer) {
    const scopeGeneration = this.generation;
    const store = createExternalQueryStore({
      identity: `scope:${scopeGeneration}:${this.bindings.size}`,
      start: (controller) => start((rows, connection, delivery = { kind: 'authoritative' }) => {
        if (this.closed || scopeGeneration !== this.generation) {
          this.ignoredStaleUpdates += 1;
          this.notify();
          return;
        }
        if (delivery.kind === 'connection') {
          controller.connection(connection);
          return;
        }
        if (delivery.kind === 'error') {
          controller.error(delivery.error ?? new Error('provider subscription failed'), {
            previous: rows,
            connection,
          });
          return;
        }
        if (delivery.kind === 'retained') {
          controller.retained(rows, connection);
          return;
        }
        controller.ready(rows, connection);
      }),
    });
    let lastSnapshot = store.getSnapshot();
    const unsubscribe = store.subscribe(() => {
      const next = store.getSnapshot();
      if (this.closed || scopeGeneration !== this.generation) {
        this.ignoredStaleUpdates += 1;
        this.notify();
        return;
      }
      if (next !== lastSnapshot && next.status === 'error') {
        lastSnapshot = next;
        observer(next.rows, next.connection, { kind: 'error', error: next.error });
      } else if (next !== lastSnapshot && (next.status === 'ready' || next.status === 'refreshing')) {
        const delivery = next.rows === lastSnapshot.rows
          ? { kind: 'connection' }
          : { kind: 'authoritative' };
        lastSnapshot = next;
        observer(next.rows, next.connection, delivery);
      } else if (
        next !== lastSnapshot
        && next.status === 'pending'
        && next.freshness === 'retained'
        && next.rows !== lastSnapshot.rows
      ) {
        lastSnapshot = next;
        observer(next.rows, next.connection, { kind: 'retained' });
      }
    });
    const binding = { store, unsubscribe, disposed: false };
    this.bindings.add(binding);
    this.notify();
    await store.whenStarted();
    if (this.closed || scopeGeneration !== this.generation) {
      this.disposeBinding(binding);
      return null;
    }
    const startedSnapshot = store.getSnapshot();
    if (startedSnapshot.status === 'error') {
      this.bindings.delete(binding);
      this.disposeBinding(binding);
      this.notify();
      const error = new Error(startedSnapshot.error?.message ?? 'provider subscription failed');
      if (startedSnapshot.error?.code) error.code = startedSnapshot.error.code;
      if (startedSnapshot.error?.diagnostic) error.diagnostic = startedSnapshot.error.diagnostic;
      throw error;
    }
    return binding;
  }

  disposeBinding(binding) {
    if (binding.disposed) return;
    binding.disposed = true;
    this.bindings.delete(binding);
    binding.unsubscribe?.();
    binding.store?.close();
    this.disposedSubscriptions += 1;
  }

  close() {
    if (this.closed) return;
    this.generation += 1;
    this.closed = true;
    for (const binding of [...this.bindings]) this.disposeBinding(binding);
    this.bindings.clear();
    this.notify();
  }

  snapshot() {
    return Object.freeze({
      generation: this.generation,
      activeSubscriptions: this.bindings.size,
      disposedSubscriptions: this.disposedSubscriptions,
      ignoredStaleUpdates: this.ignoredStaleUpdates,
      closed: this.closed,
    });
  }

  notify() {
    this.onChange(this.snapshot());
  }
}
