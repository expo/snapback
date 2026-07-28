import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

import {
  admittedReactReference,
  assertPreparedReactBinding,
  canonicalReactStoreKeyV1,
  preparedReactBindingClient,
} from '@snapback/client';
export { bindSnapbackAppLifecycle } from '@snapback/client';

// @ref LLP 0102#prepared-binding-and-provider-ownership — the provider owns
// its registry and barrier participant while borrowing the prepared client's
// transport.
// @ref LLP 0102#exact-saturated-replacement-semantics — group admission is
// transactional, with only unique one-for-one supersession at saturation.

export const skip = Symbol.for('snapback.react.skip.v1');

const QUERY_CACHE_CAP = 256;
const CONSUMER_CAP = 1_024;
const SERVER_SUBSCRIPTION_CAP = 64;
const providerContext = createContext(null);
let providerSequence = 0;

const CONNECTION_ORDER = Object.freeze({
  error: 0,
  closed: 1,
  disconnected: 2,
  stale: 3,
  connecting: 4,
  polling: 5,
  live: 6,
  idle: 7,
});

function diagnostic(code, message, details = {}) {
  return Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    message,
    details: Object.freeze({ ...details }),
  });
}

function diagnosticError(code, message, details = {}) {
  const value = diagnostic(code, message, details);
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = value;
  return error;
}

function serializeError(error) {
  return error?.diagnostic ?? diagnostic(
    error?.code ?? 'SNAPBACK_REACT_QUERY_FAILED',
    error instanceof Error ? error.message : String(error),
  );
}

function pending(connection = 'idle') {
  return Object.freeze({
    status: 'pending',
    data: undefined,
    error: null,
    connection,
  });
}

const SKIPPED = Object.freeze({
  status: 'skipped',
  data: undefined,
  error: null,
  connection: 'idle',
});
const SERVER_PENDING = pending();

function weakConnection(values) {
  let current = 'idle';
  for (const value of values) {
    if (CONNECTION_ORDER[value] < CONNECTION_ORDER[current]) current = value;
  }
  return current;
}

function normalizeConnection(value, detail = {}) {
  if (['connecting', 'live', 'polling', 'stale', 'disconnected'].includes(value)) {
    return value;
  }
  if (value === 'closed') return 'closed';
  if (value === 'error' || detail?.error) return 'error';
  return 'disconnected';
}

function queryStateForConnection(snapshot, connection, detail = {}) {
  if (connection === 'error') {
    return Object.freeze({
      status: 'error',
      data: undefined,
      error: serializeError(detail.error ?? new Error('live query connection failed')),
      connection,
    });
  }
  if (connection === 'closed') {
    return Object.freeze({
      status: 'error',
      data: undefined,
      error: diagnostic('SNAPBACK_REACT_PROVIDER_CLOSED', 'React provider is closed'),
      connection,
    });
  }
  if (snapshot.status === 'ready' || snapshot.status === 'refreshing') {
    return Object.freeze({
      status: connection === 'live' ? 'ready' : 'refreshing',
      data: snapshot.data,
      error: null,
      connection,
    });
  }
  return pending(connection);
}

function assertProvider(provider) {
  if (provider?.kind === 'snapback.react-provider.v1') return provider;
  throw diagnosticError(
    'SNAPBACK_REACT_PROVIDER_REQUIRED',
    'a SnapbackProvider with a prepared binding is required',
  );
}

function createRegistry(binding, providerInstanceId, options = {}) {
  const client = preparedReactBindingClient(binding);
  const stores = new Map();
  const leases = new Set();
  const diagnostics = [];
  const connectionListeners = new Set();
  const allHandles = new Set();
  const connectionId = options.connectionId ?? `snapback_react_${providerInstanceId}`;
  const manager = typeof client.liveStreamManager === 'function'
    ? client.liveStreamManager(connectionId)
    : null;
  let consumers = 0;
  let terminal = false;
  let custodyPaused = false;
  let leaseSequence = 0;
  let connectionSnapshotKey = null;
  let connectionSnapshot = Object.freeze({
    status: 'idle',
    diagnostic: null,
    activeSubscriptions: 0,
  });

  const notifyConnection = () => {
    for (const listener of [...connectionListeners]) {
      try { listener(); } catch { /* observation cannot own lifecycle */ }
    }
  };
  const recordDiagnostic = (error) => {
    diagnostics.push(serializeError(error));
    if (diagnostics.length > 64) diagnostics.shift();
    try { options.onDiagnostic?.(diagnostics.at(-1)); } catch { /* observational */ }
    notifyConnection();
  };
  const activeStores = () => [...stores.values()].filter((store) => store.handle !== null);

  const publish = (store, snapshot, generation = store.generation) => {
    if (terminal || generation !== store.generation) return;
    store.snapshot = snapshot;
    for (const listener of [...store.listeners.values()]) {
      try { listener(); } catch { /* one consumer cannot starve siblings */ }
    }
    notifyConnection();
  };

  const stopStore = (store, { blank = false } = {}) => {
    store.generation += 1;
    const handle = store.handle;
    store.handle = null;
    if (blank) store.snapshot = pending('idle');
    if (handle) {
      try { handle.dispose(); } catch (error) { recordDiagnostic(error); }
      allHandles.add(handle);
      void handle.settled().catch(recordDiagnostic).finally(() => allHandles.delete(handle));
    }
    if (blank) {
      for (const listener of [...store.listeners.values()]) {
        try { listener(); } catch { /* observational */ }
      }
    }
    notifyConnection();
  };

  const startStore = (store, supersedes = null) => {
    if (terminal || custodyPaused || store.handle || store.consumers === 0) return;
    const generation = ++store.generation;
    store.snapshot = pending('connecting');
    let handle;
    handle = client.startLiveQuery(store.reference, {
      connectionId,
      args: store.args,
      transport: 'stream',
      fallbackToPoll: false,
      supersedes,
      onUpdate(rows) {
        publish(store, Object.freeze({
          status: 'ready',
          data: Object.freeze([...(rows ?? [])]),
          error: null,
          connection: normalizeConnection(handle.current?.connection ?? 'live'),
        }), generation);
      },
      onConnectionChange(connection, detail) {
        const normalized = normalizeConnection(connection, detail);
        publish(
          store,
          queryStateForConnection(store.snapshot, normalized, detail),
          generation,
        );
      },
    });
    store.handle = handle;
    allHandles.add(handle);
    void handle.started().then(() => {
      if (store.generation !== generation || store.handle !== handle) return;
      if (store.snapshot.status === 'pending' && Array.isArray(handle.current?.rows)) {
        publish(store, Object.freeze({
          status: 'ready',
          data: Object.freeze([...handle.current.rows]),
          error: null,
          connection: normalizeConnection(handle.current.connection),
        }), generation);
      }
    }, (error) => {
      if (store.generation !== generation || store.handle !== handle) return;
      store.handle = null;
      allHandles.delete(handle);
      publish(store, Object.freeze({
        status: 'error',
        data: undefined,
        error: serializeError(error),
        connection: 'error',
      }), generation);
    });
    void handle.settled().finally(() => allHandles.delete(handle));
    notifyConnection();
    return handle;
  };

  const createStore = (descriptor) => {
    if (stores.size >= QUERY_CACHE_CAP) {
      throw diagnosticError(
        'SNAPBACK_REACT_STORE_CAPACITY',
        `React provider has reached its ${QUERY_CACHE_CAP}-store cache cap`,
        { cap: QUERY_CACHE_CAP },
      );
    }
    const store = {
      key: descriptor.key,
      reference: descriptor.reference,
      args: descriptor.args,
      snapshot: pending(),
      consumers: 0,
      listeners: new Map(),
      handle: null,
      generation: 0,
      idleEpoch: 0,
      handoffPending: 0,
    };
    stores.set(store.key, store);
    return store;
  };

  const releaseLease = (lease) => {
    if (!lease || lease.released) return;
    lease.released = true;
    leases.delete(lease);
    consumers -= lease.edges.length;
    for (const edge of lease.edges) {
      const store = stores.get(edge.key);
      if (!store) continue;
      store.listeners.delete(edge.edgeId);
      store.consumers -= 1;
      if (store.consumers === 0) {
        const idleEpoch = ++store.idleEpoch;
        queueMicrotask(() => {
          if (
            store.consumers !== 0
            || store.idleEpoch !== idleEpoch
            || store.handoffPending !== 0
          ) return;
          stopStore(store);
          void Promise.allSettled([...allHandles].map((handle) => handle.settled()))
            .then(() => {
              if (store.consumers === 0 && store.idleEpoch === idleEpoch) stores.delete(store.key);
              notifyConnection();
            });
        });
      }
    }
    notifyConnection();
  };

  const subscribeMany = (descriptors, listener, previousLease = null) => {
    if (terminal) throw diagnosticError('SNAPBACK_REACT_PROVIDER_CLOSED', 'React provider is closed');
    const admitted = descriptors.filter((entry) => !entry.skipped);
    const previous = previousLease && !previousLease.released ? previousLease : null;
    const previousEdges = previous?.edges ?? [];
    const projectedConsumers = consumers - previousEdges.length + admitted.length;
    if (projectedConsumers > CONSUMER_CAP) {
      throw diagnosticError(
        'SNAPBACK_REACT_STORE_CAPACITY',
        `React provider has reached its ${CONSUMER_CAP}-consumer cap`,
        { cap: CONSUMER_CAP },
      );
    }
    const uniqueNew = new Map();
    for (const descriptor of admitted) uniqueNew.set(descriptor.key, descriptor);
    const active = activeStores();
    const netNew = [...uniqueNew.keys()].filter((key) => !stores.get(key)?.handle);
    const retiring = [...new Set(previousEdges.map((edge) => edge.key))]
      .filter((key) => !uniqueNew.has(key))
      .map((key) => stores.get(key))
      .filter(Boolean);
    let supersession = null;
    if (active.length + netNew.length > SERVER_SUBSCRIPTION_CAP) {
      const predecessor = retiring.length === 1 ? retiring[0] : null;
      if (
        active.length === SERVER_SUBSCRIPTION_CAP
        && netNew.length === 1
        && predecessor?.handle
        && predecessor.consumers === previousEdges.filter((edge) => edge.key === predecessor.key).length
      ) {
        supersession = { successorKey: netNew[0], predecessor };
      } else {
        throw diagnosticError(
          'SNAPBACK_REACT_GROUP_CAPACITY',
          'query-group transition exceeds the 64-subscription cap',
          {
            cap: SERVER_SUBSCRIPTION_CAP,
            active: active.length,
            netNew: netNew.length,
            retiring: retiring.length,
          },
        );
      }
    }

    // Validation above is side-effect free. Store allocation and edge
    // installation happen only after the entire transaction is admitted.
    const edgeIdPrefix = `lease-${++leaseSequence}`;
    const next = {
      id: edgeIdPrefix,
      edges: [],
      released: false,
      release() { releaseLease(next); },
    };
    try {
      for (let index = 0; index < admitted.length; index += 1) {
        const descriptor = admitted[index];
        const store = stores.get(descriptor.key) ?? createStore(descriptor);
        const edgeId = `${edgeIdPrefix}:${index}`;
        store.idleEpoch += 1;
        store.consumers += 1;
        store.listeners.set(edgeId, listener);
        next.edges.push({ key: store.key, edgeId });
      }
      leases.add(next);
      consumers += next.edges.length;
      let successorHandle = null;
      if (supersession) supersession.predecessor.handoffPending += 1;
      for (const key of uniqueNew.keys()) {
        const store = stores.get(key);
        const handle = startStore(
          store,
          supersession?.successorKey === key ? supersession.predecessor.handle : null,
        );
        if (supersession?.successorKey === key) successorHandle = handle;
      }
      if (previous) releaseLease(previous);
      if (supersession) {
        // Releasing the predecessor's final consumer must not dispose its
        // handle before the successor subscribe has carried the exact
        // supersession witness to the server. Once admission settles, the
        // predecessor wrapper can retire locally whether admission succeeded
        // or failed; the successor store owns any surfaced failure.
        void successorHandle.started().catch(() => {}).finally(() => {
          const predecessor = supersession.predecessor;
          predecessor.handoffPending -= 1;
          if (predecessor.consumers !== 0 || predecessor.handoffPending !== 0) return;
          const idleEpoch = ++predecessor.idleEpoch;
          stopStore(predecessor);
          void Promise.allSettled([...allHandles].map((handle) => handle.settled()))
            .then(() => {
              if (
                predecessor.consumers === 0
                && predecessor.handoffPending === 0
                && predecessor.idleEpoch === idleEpoch
              ) stores.delete(predecessor.key);
              notifyConnection();
            });
        });
      }
      return next;
    } catch (error) {
      releaseLease(next);
      throw error;
    }
  };

  const snapshot = (descriptor) => {
    if (descriptor.skipped) return SKIPPED;
    return stores.get(descriptor.key)?.snapshot ?? SERVER_PENDING;
  };

  const aggregateConnection = () => {
    const active = activeStores();
    const status = weakConnection(active.map((store) => store.snapshot.connection));
    const currentDiagnostic = status === 'error' ? diagnostics.at(-1) ?? null : null;
    const key = `${status}\u0000${active.length}\u0000${currentDiagnostic?.code ?? ''}`;
    if (key === connectionSnapshotKey) return connectionSnapshot;
    connectionSnapshotKey = key;
    connectionSnapshot = Object.freeze({
      status,
      diagnostic: currentDiagnostic,
      activeSubscriptions: active.length,
    });
    return connectionSnapshot;
  };

  const barrierParticipant = {
    name: `snapback-react:${providerInstanceId}`,
    async quiesce() {
      custodyPaused = true;
      for (const store of stores.values()) stopStore(store);
      await Promise.allSettled([...allHandles].map((handle) => handle.settled()));
    },
    blank() {
      custodyPaused = true;
      for (const store of stores.values()) {
        store.generation += 1;
        store.snapshot = pending('idle');
        for (const listener of [...store.listeners.values()]) {
          try { listener(); } catch { /* observational */ }
        }
      }
      notifyConnection();
    },
    clearMemory() {},
    async commitDurable() {},
    async resume() {
      if (terminal) return;
      custodyPaused = false;
      for (const store of stores.values()) startStore(store);
    },
  };
  const unregisterBarrier = client.registerAuthBarrierParticipant(barrierParticipant);

  return Object.freeze({
    descriptor(reference, args) {
      const admitted = admittedReactReference(binding, reference, 'LiveQuery');
      if (args === skip) return Object.freeze({ skipped: true, reference: admitted, args, key: null });
      const key = canonicalReactStoreKeyV1(providerInstanceId, admitted, args);
      return Object.freeze({ skipped: false, reference: admitted, args, key });
    },
    subscribe(descriptor, listener, previousLease = null) {
      return subscribeMany([descriptor], listener, previousLease);
    },
    subscribeMany,
    snapshot,
    aggregateConnection,
    subscribeConnection(listener) {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    },
    recordDiagnostic,
    inspection() {
      return Object.freeze({
        providerInstanceId,
        terminal,
        custodyPaused,
        stores: stores.size,
        consumers,
        serverSubscriptions: activeStores().length,
        leases: leases.size,
        reservations: 0,
        timers: 0,
        listeners: [...stores.values()].reduce((sum, store) => sum + store.listeners.size, 0)
          + connectionListeners.size,
        diagnostics: Object.freeze([...diagnostics]),
      });
    },
    async dispose() {
      if (terminal) return;
      terminal = true;
      custodyPaused = true;
      for (const lease of [...leases]) releaseLease(lease);
      for (const store of stores.values()) stopStore(store, { blank: true });
      await Promise.allSettled([...allHandles].map((handle) => handle.settled()));
      try { await manager?.settled?.(); } catch (error) { recordDiagnostic(error); }
      stores.clear();
      connectionListeners.clear();
      try { await unregisterBarrier(); } catch (error) { recordDiagnostic(error); }
    },
  });
}

export function createSnapbackReactProvider(binding, options = {}) {
  const prepared = assertPreparedReactBinding(binding);
  const providerInstanceId = `provider-${++providerSequence}-${globalThis.crypto.randomUUID()}`;
  const registry = createRegistry(prepared, providerInstanceId, options);
  return Object.freeze({
    kind: 'snapback.react-provider.v1',
    providerInstanceId,
    binding: prepared,
    registry,
    registerEphemeralRepublisher(reference, callback) {
      return preparedReactBindingClient(prepared).registerEphemeralRepublisher(reference, callback);
    },
    inspection: () => registry.inspection(),
    dispose: () => registry.dispose(),
  });
}

export function SnapbackProvider({ binding = null, provider = null, children = null }) {
  const owned = useMemo(
    () => (provider ? null : createSnapbackReactProvider(assertPreparedReactBinding(binding))),
    [binding, provider],
  );
  const current = assertProvider(provider ?? owned);
  useEffect(() => () => {
    if (owned) void owned.dispose();
  }, [owned]);
  return React.createElement(providerContext.Provider, { value: current }, children);
}

function useProvider() {
  return assertProvider(useContext(providerContext));
}

export function useSnapbackQuery(reference, args) {
  const provider = useProvider();
  const descriptor = useMemo(
    () => provider.registry.descriptor(reference, args),
    [provider, reference, args],
  );
  const lease = useRef(null);
  const subscribe = useCallback((listener) => {
    const next = provider.registry.subscribe(descriptor, listener, lease.current);
    lease.current = next;
    return () => {
      const releasing = next;
      queueMicrotask(() => {
        if (lease.current === releasing) lease.current = null;
        releasing.release();
      });
    };
  }, [provider, descriptor]);
  return useSyncExternalStore(
    subscribe,
    () => provider.registry.snapshot(descriptor),
    () => (descriptor.skipped ? SKIPPED : SERVER_PENDING),
  );
}

function validateEntries(provider, entries) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new TypeError('useSnapbackQueries requires an object map');
  }
  const descriptors = Object.keys(entries).sort().map((name) => {
    if (!/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(name)) {
      throw new TypeError(`invalid query-group entry name ${name}`);
    }
    const entry = entries[name];
    return Object.freeze({
      name,
      ...provider.registry.descriptor(entry?.ref, entry?.args ?? {}),
    });
  });
  if (descriptors.length < 1 || descriptors.length > 64) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_CAPACITY',
      'query groups contain 1 through 64 entries',
      { entries: descriptors.length },
    );
  }
  return Object.freeze(descriptors);
}

function groupSnapshot(provider, descriptors) {
  const queries = {};
  for (const descriptor of descriptors) {
    queries[descriptor.name] = provider.registry.snapshot(descriptor);
  }
  Object.freeze(queries);
  const active = descriptors
    .filter((descriptor) => !descriptor.skipped)
    .map((descriptor) => queries[descriptor.name]);
  const firstError = descriptors
    .filter((descriptor) => queries[descriptor.name].status === 'error')
    .map((descriptor) => queries[descriptor.name].error)[0] ?? null;
  const status = active.some((query) => query.status === 'error')
    ? 'error'
    : active.some((query) => query.status === 'pending')
      ? 'pending'
      : active.some((query) => query.status === 'refreshing')
        ? 'refreshing'
        : 'ready';
  return Object.freeze({
    queries,
    status,
    connection: weakConnection(active.map((query) => query.connection)),
    error: firstError,
  });
}

export function useSnapbackQueries(entries) {
  const provider = useProvider();
  const descriptors = useMemo(() => validateEntries(provider, entries), [provider, entries]);
  const lease = useRef(null);
  const lastSnapshot = useRef(null);
  const subscribe = useCallback((listener) => {
    const next = provider.registry.subscribeMany(descriptors, listener, lease.current);
    lease.current = next;
    return () => {
      const releasing = next;
      queueMicrotask(() => {
        if (lease.current === releasing) lease.current = null;
        releasing.release();
      });
    };
  }, [provider, descriptors]);
  const read = useCallback(() => {
    const next = groupSnapshot(provider, descriptors);
    const previous = lastSnapshot.current;
    if (
      previous
      && previous.status === next.status
      && previous.connection === next.connection
      && previous.error === next.error
      && descriptors.every(({ name }) => previous.queries[name] === next.queries[name])
    ) return previous;
    lastSnapshot.current = next;
    return next;
  }, [provider, descriptors]);
  return useSyncExternalStore(subscribe, read, read);
}

export function useSnapbackMutation(reference) {
  const provider = useProvider();
  const admitted = useMemo(
    () => admittedReactReference(provider.binding, reference, 'Mutation'),
    [provider, reference],
  );
  return useCallback(async (args) => {
    const client = preparedReactBindingClient(provider.binding);
    const output = await client.mutate(admitted, { args });
    return output.result;
  }, [provider, admitted]);
}

export function useSnapbackConnection() {
  const provider = useProvider();
  return useSyncExternalStore(
    provider.registry.subscribeConnection,
    provider.registry.aggregateConnection,
    provider.registry.aggregateConnection,
  );
}

/// Register the mounted component as an active producer for one ephemeral
/// collection. React owns disposal with the component lifecycle; the headless
/// client owns authority replacement, empty-snapshot, acknowledgement, and
/// generation fencing.
export function useEphemeralRepublisher(reference, callback) {
  const provider = useProvider();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  useEffect(() => {
    const registration = provider.registerEphemeralRepublisher(
      reference,
      (context) => callbackRef.current(context),
    );
    return () => registration.dispose();
  }, [provider, reference]);
}

/**
 * Framework-neutral harness for acceptance adapters. Applications should use
 * useSnapbackQueries; this seam lets packed starters and backend receipts
 * exercise the exact same provider registry without manufacturing a React
 * renderer around non-UI acceptance code.
 */
export function observeSnapbackQueries(providerValue, entries, listener) {
  const provider = assertProvider(providerValue);
  let descriptors = validateEntries(provider, entries);
  let lease = null;
  let closed = false;
  const emit = () => {
    if (!closed) listener(groupSnapshot(provider, descriptors));
  };
  lease = provider.registry.subscribeMany(descriptors, emit);
  emit();
  return Object.freeze({
    update(nextEntries) {
      if (closed) throw diagnosticError('SNAPBACK_REACT_PROVIDER_CLOSED', 'query observer is closed');
      const nextDescriptors = validateEntries(provider, nextEntries);
      const nextLease = provider.registry.subscribeMany(nextDescriptors, emit, lease);
      descriptors = nextDescriptors;
      lease = nextLease;
      emit();
    },
    snapshot() { return groupSnapshot(provider, descriptors); },
    dispose() {
      if (closed) return;
      closed = true;
      lease?.release();
      lease = null;
    },
  });
}

export async function invokeSnapbackMutation(providerValue, reference, args) {
  const provider = assertProvider(providerValue);
  const admitted = admittedReactReference(provider.binding, reference, 'Mutation');
  const output = await preparedReactBindingClient(provider.binding).mutate(admitted, { args });
  return output.result;
}
