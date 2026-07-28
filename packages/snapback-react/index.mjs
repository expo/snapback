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
  admittedReactEphemeralDefinition,
  admittedReactQueryGroup,
  admittedReactReference,
  assertPreparedReactBinding,
  canonicalizeClientValueV1,
  canonicalReactStoreKeyV1,
  preparedReactResultContract,
  preparedReactBindingClient,
  isPreparedReactQueryGroup,
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
const PRESENCE_ROOM_CACHE_CAP = 128;
const PRESENCE_SUBSCRIPTION_CAP = 64;
const PRESENCE_CONSUMER_CAP = 256;
const PRESENCE_PUBLISHER_CAP = 64;
const OPTIMISTIC_LAYER_CAP = 256;
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
const PRESENCE_SERVER_PENDING = Object.freeze({
  status: 'pending',
  entries: Object.freeze([]),
  selfKey: null,
  diagnostic: null,
  connection: 'idle',
  publisher: Object.freeze({ status: 'observing', diagnostic: null }),
  publish: async () => {},
  delete: async () => {},
});

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function immutableClone(value) {
  return deepFreeze(structuredClone(value));
}

function validateResultContract(contract, value, {
  requireKnown = false,
  violationCode = 'SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED',
} = {}) {
  if (!contract?.descriptor || (requireKnown && contract.descriptor.kind === 'unknown')) {
    throw diagnosticError(
      'SNAPBACK_REACT_OPTIMISTIC_RESULT_CONTRACT_REQUIRED',
      'optimistic projection requires a generated query result contract',
    );
  }
  const result = contract.validator.validate(value);
  if (!result.ok) {
    throw diagnosticError(
      violationCode,
      'value did not satisfy the generated result contract',
      { resultContractHash: contract.hash, path: result.path },
    );
  }
  return deepFreeze(result.value);
}

function heartbeatInterval(ttlMs) {
  return Math.max(250, Math.min(Math.floor(ttlMs / 2), 10_000));
}

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
  const rooms = new Map();
  const leases = new Set();
  const roomLeases = new Set();
  const diagnostics = [];
  const connectionListeners = new Set();
  const allHandles = new Set();
  const preparedGroup = options.preparedGroup ?? null;
  if (preparedGroup !== null && !isPreparedReactQueryGroup(preparedGroup)) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_PREPARATION_INVALID',
      'preparedGroup must come from binding.prepareQueryGroup()',
    );
  }
  if (preparedGroup !== null) admittedReactQueryGroup(binding, preparedGroup.reference);
  if (
    preparedGroup?.connectionId
    && options.connectionId
    && preparedGroup.connectionId !== options.connectionId
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_CONNECTION_MISMATCH',
      'provider connectionId must match the register-mode query-group bundle',
      {
        expected: preparedGroup.connectionId,
        actual: options.connectionId,
      },
    );
  }
  const connectionId = options.connectionId
    ?? preparedGroup?.connectionId
    ?? `snapback_react_${providerInstanceId}`;
  const preparedRegistrationKey = (reference, args) => [
    reference.id,
    canonicalizeClientValueV1(args),
  ].join('\u0000');
  const preparedRegistrations = new Map(
    (preparedGroup?.entries ?? [])
      .filter((entry) => entry.registeredSubscription !== null)
      .map((entry) => [
        preparedRegistrationKey(entry.ref, entry.args),
        entry.registeredSubscription,
      ]),
  );
  const manager = typeof client.liveStreamManager === 'function'
    ? client.liveStreamManager(connectionId)
    : null;
  let consumers = 0;
  let presenceConsumers = 0;
  let publishers = 0;
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

  const releaseLayerPin = (store, layer) => {
    if (layer.pinReleased) return;
    layer.pinReleased = true;
    store.pins = Math.max(0, store.pins - 1);
    if (store.consumers !== 0 || store.pins !== 0) return;
    const idleEpoch = ++store.idleEpoch;
    queueMicrotask(() => {
      if (
        store.consumers !== 0
        || store.pins !== 0
        || store.idleEpoch !== idleEpoch
        || store.handoffPending !== 0
      ) return;
      stopStore(store);
      void Promise.allSettled([...allHandles].map((handle) => handle.settled()))
        .then(() => {
          if (
            store.consumers === 0
            && store.pins === 0
            && store.idleEpoch === idleEpoch
          ) stores.delete(store.key);
          notifyConnection();
        });
    });
  };

  const materializeStore = (store) => {
    let rows = store.authoritativeData;
    for (const layer of store.optimisticLayers) {
      if (layer.failed) continue;
      try {
        rows = validateResultContract(
          store.resultContract,
          layer.update(immutableClone(rows), immutableClone(layer.mutationArgs)),
          { requireKnown: true },
        );
      } catch (error) {
        layer.failed = true;
        releaseLayerPin(store, layer);
        recordDiagnostic(diagnosticError(
          'SNAPBACK_REACT_OPTIMISTIC_REBASE_FAILED',
          'an optimistic reducer failed while rebasing over newer authority',
          { attemptId: layer.id, cause: error?.code ?? error?.message ?? String(error) },
        ));
      }
    }
    store.optimisticLayers = store.optimisticLayers.filter((layer) => !layer.failed);
    return rows;
  };

  const publishAuthoritative = (store, rows, generation = store.generation) => {
    store.authoritativeRevision += 1;
    store.authoritativeData = validateResultContract(store.resultContract, rows);
    for (const layer of store.optimisticLayers) {
      if (!layer.confirmed) continue;
      try {
        const matched = layer.isAuthoritative
          ? layer.isAuthoritative(
              immutableClone(store.authoritativeData),
              immutableClone(layer.result),
            ) === true
          : store.authoritativeRevision > layer.confirmedRevision;
        if (matched) {
          layer.retired = true;
          releaseLayerPin(store, layer);
        }
      } catch (error) {
        layer.retired = true;
        layer.failed = true;
        releaseLayerPin(store, layer);
        recordDiagnostic(diagnosticError(
          'SNAPBACK_REACT_OPTIMISTIC_REBASE_FAILED',
          'an optimistic authority matcher failed after dispatch',
          { attemptId: layer.id, cause: error?.code ?? error?.message ?? String(error) },
        ));
      }
    }
    store.optimisticLayers = store.optimisticLayers.filter((layer) => !layer.retired);
    publish(store, Object.freeze({
      status: 'ready',
      data: materializeStore(store),
      error: null,
      connection: normalizeConnection(store.handle?.current?.connection ?? 'live'),
    }), generation);
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
    if (terminal || custodyPaused || store.handle || (store.consumers === 0 && store.pins === 0)) return;
    const generation = ++store.generation;
    store.snapshot = pending('connecting');
    let handle;
    handle = client.startLiveQuery(store.reference, {
      connectionId,
      args: store.args,
      transport: 'stream',
      fallbackToPoll: false,
      supersedes,
      ...(store.registeredSubscription === null
        ? {}
        : { registeredSubscription: store.registeredSubscription }),
      onUpdate(rows) {
        publishAuthoritative(store, rows ?? [], generation);
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
    store.registeredSubscription = null;
    store.handle = handle;
    allHandles.add(handle);
    void handle.started().then(() => {
      if (store.generation !== generation || store.handle !== handle) return;
      if (store.snapshot.status === 'pending' && Array.isArray(handle.current?.rows)) {
        publishAuthoritative(store, handle.current.rows, generation);
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
      resultContract: descriptor.resultContract,
      authoritativeData: Object.freeze([]),
      authoritativeRevision: 0,
      optimisticLayers: [],
      pendingMutations: new Map(),
      pins: 0,
      registeredSubscription: preparedRegistrations.get(
        preparedRegistrationKey(descriptor.reference, descriptor.args),
      ) ?? null,
    };
    preparedRegistrations.delete(
      preparedRegistrationKey(descriptor.reference, descriptor.args),
    );
    stores.set(store.key, store);
    return store;
  };

  const publishMaterialized = (store) => {
    publish(store, Object.freeze({
      status: 'ready',
      data: materializeStore(store),
      error: null,
      connection: normalizeConnection(store.handle?.current?.connection ?? 'live'),
    }));
  };

  const runMutation = async (mutationReference, mutationArgs, optimistic = null) => {
    if (terminal) throw diagnosticError('SNAPBACK_REACT_PROVIDER_CLOSED', 'React provider is closed');
    const admittedMutation = admittedReactReference(binding, mutationReference, 'Mutation');
    canonicalizeClientValueV1(mutationArgs);
    const mutationContract = preparedReactResultContract(binding, admittedMutation);
    if (optimistic === null) {
      const output = await client.mutate(admittedMutation, { args: mutationArgs });
      return validateResultContract(
        mutationContract,
        output.result,
        { violationCode: 'SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED' },
      );
    }

    if (
      typeof optimistic !== 'object'
      || optimistic === null
      || typeof optimistic.update !== 'function'
    ) throw new TypeError('optimistic mutation options require query, args, and update');
    const queryReference = admittedReactReference(binding, optimistic.query, 'LiveQuery');
    const queryKey = canonicalReactStoreKeyV1(
      providerInstanceId,
      queryReference,
      optimistic.args,
    );
    const store = stores.get(queryKey);
    if (
      custodyPaused
      || !store
      || store.authoritativeRevision === 0
      || !['ready', 'refreshing'].includes(store.snapshot.status)
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_OPTIMISTIC_STORE_MISSING',
        'optimistic projection requires a current authoritative query store',
        { queryId: queryReference.id },
      );
    }
    if (store.resultContract?.descriptor?.kind === 'unknown') {
      throw diagnosticError(
        'SNAPBACK_REACT_OPTIMISTIC_RESULT_CONTRACT_REQUIRED',
        'optimistic projection requires a generated query result contract',
        { queryId: queryReference.id },
      );
    }
    const activeLayerCount = [...stores.values()]
      .reduce((sum, value) => sum + value.optimisticLayers.length, 0);
    if (activeLayerCount >= OPTIMISTIC_LAYER_CAP) {
      throw diagnosticError(
        'SNAPBACK_REACT_OPTIMISTIC_LAYER_LIMIT',
        `React provider has reached its ${OPTIMISTIC_LAYER_CAP}-layer optimistic cap`,
        { cap: OPTIMISTIC_LAYER_CAP },
      );
    }
    const capture = client.authorityFence?.capture?.() ?? null;
    if (capture && !client.authorityFence?.isCurrent?.(capture)) {
      throw diagnosticError(
        'SNAPBACK_CLIENT_AUTHORITY_STALE',
        'optimistic mutation authority is no longer current',
      );
    }
    const id = globalThis.crypto.randomUUID();
    const frozenArgs = immutableClone(mutationArgs);
    const layer = {
      id,
      mutationArgs: frozenArgs,
      update: optimistic.update,
      isAuthoritative: typeof optimistic.isAuthoritative === 'function'
        ? optimistic.isAuthoritative
        : null,
      result: undefined,
      confirmed: false,
      confirmedRevision: null,
      failed: false,
      retired: false,
      pinReleased: false,
    };

    // Admission is side-effect free through validation. The first reducer run
    // uses the exact displayed same-authority base; only a valid projection is
    // installed and dispatched.
    const initialProjection = validateResultContract(
      store.resultContract,
      layer.update(immutableClone(store.snapshot.data), frozenArgs),
      { requireKnown: true },
    );
    store.optimisticLayers.push(layer);
    store.pendingMutations.set(id, layer);
    store.pins += 1;
    store.idleEpoch += 1;
    if (!store.handle) startStore(store);
    publish(store, Object.freeze({
      status: 'ready',
      data: initialProjection,
      error: null,
      connection: normalizeConnection(store.handle?.current?.connection ?? 'live'),
    }));

    try {
      if (capture && !client.authorityFence?.isCurrent?.(capture)) {
        throw diagnosticError(
          'SNAPBACK_CLIENT_AUTHORITY_STALE',
          'optimistic mutation authority was replaced before dispatch',
        );
      }
      const output = await client.mutate(admittedMutation, {
        args: mutationArgs,
        clientMutationId: id,
        authorityCapture: capture,
      });
      const result = validateResultContract(
        mutationContract,
        output.result,
        { violationCode: 'SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED' },
      );
      if (capture && !client.authorityFence?.isCurrent?.(capture)) {
        throw diagnosticError(
          'SNAPBACK_CLIENT_AUTHORITY_STALE',
          'optimistic mutation completed under stale authority',
        );
      }
      layer.result = result;
      layer.confirmed = true;
      layer.confirmedRevision = store.authoritativeRevision;
      store.pendingMutations.delete(id);
      try {
        if (
          layer.isAuthoritative?.(
            immutableClone(store.authoritativeData),
            immutableClone(result),
          ) === true
        ) {
          layer.retired = true;
          releaseLayerPin(store, layer);
          store.optimisticLayers = store.optimisticLayers.filter((entry) => entry !== layer);
          publishMaterialized(store);
        }
      } catch (error) {
        layer.retired = true;
        layer.failed = true;
        releaseLayerPin(store, layer);
        store.optimisticLayers = store.optimisticLayers.filter((entry) => entry !== layer);
        recordDiagnostic(diagnosticError(
          'SNAPBACK_REACT_OPTIMISTIC_REBASE_FAILED',
          'an optimistic authority matcher failed after dispatch',
          { attemptId: id, cause: error?.code ?? error?.message ?? String(error) },
        ));
        publishMaterialized(store);
      }
      return result;
    } catch (error) {
      store.pendingMutations.delete(id);
      store.optimisticLayers = store.optimisticLayers.filter((entry) => entry !== layer);
      releaseLayerPin(store, layer);
      publishMaterialized(store);
      throw error;
    }
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
      if (store.consumers === 0 && store.pins === 0) {
        const idleEpoch = ++store.idleEpoch;
        queueMicrotask(() => {
          if (
            store.consumers !== 0
            || store.pins !== 0
            || store.idleEpoch !== idleEpoch
            || store.handoffPending !== 0
          ) return;
          stopStore(store);
          void Promise.allSettled([...allHandles].map((handle) => handle.settled()))
            .then(() => {
              if (
                store.consumers === 0
                && store.pins === 0
                && store.idleEpoch === idleEpoch
              ) stores.delete(store.key);
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

  const presenceErrorSnapshot = (code, message, connection = 'idle') => Object.freeze({
    status: code === 'SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED' ? 'unsupported' : 'error',
    entries: Object.freeze([]),
    selfKey: null,
    diagnostic: diagnostic(code, message),
    connection,
  });
  const roomPublisherState = (room, token) => {
    if (!room?.desired || !token?.desired) {
      return Object.freeze({ status: 'observing', diagnostic: null });
    }
    if (room.publisherDiagnostic) {
      return Object.freeze({
        status: 'publish-error',
        diagnostic: room.publisherDiagnostic,
      });
    }
    return Object.freeze({
      status: room.acknowledged ? 'published' : 'publishing',
      diagnostic: null,
    });
  };
  const presenceView = (room, token) => {
    if (!room) return PRESENCE_SERVER_PENDING;
    if (token.viewVersion === room.version && token.view) return token.view;
    const raw = room.raw;
    const base = raw.status === 'ready' || raw.status === 'stale'
      ? {
          status: raw.status,
          entries: raw.entries,
          selfKey: raw.selfKey,
          diagnostic: null,
          connection: raw.connection,
        }
      : raw.status === 'error' || raw.status === 'unsupported'
        ? {
            status: raw.status,
            entries: Object.freeze([]),
            selfKey: null,
            diagnostic: raw.diagnostic,
            connection: raw.connection,
          }
        : {
            status: raw.status === 'resyncing' ? 'resyncing' : 'pending',
            entries: Object.freeze([]),
            selfKey: null,
            diagnostic: null,
            connection: raw.connection,
          };
    token.view = Object.freeze({
      ...base,
      publisher: roomPublisherState(room, token),
      publish: token.actions.publish,
      delete: token.actions.delete,
    });
    token.viewVersion = room.version;
    return token.view;
  };
  const notifyRoom = (room) => {
    room.version += 1;
    for (const token of room.tokens.values()) {
      token.view = null;
      for (const listener of [...token.listeners]) {
        try { listener(); } catch { /* observational */ }
      }
    }
    notifyConnection();
  };
  const clearRoomHeartbeat = (room) => {
    if (room.heartbeatTimer !== null) clearTimeout(room.heartbeatTimer);
    room.heartbeatTimer = null;
  };
  const activePublisherRooms = (collectionId, excluding = null) => [...rooms.values()]
    .filter((room) => (
      room !== excluding
      && room.definition.reference.id === collectionId
      && room.desired !== null
    ));
  const admitRoomIntent = (room, token, value, ttlMs) => {
    const effectiveTtlMs = ttlMs ?? room.definition.reference.defaultTtlMs;
    if (
      !Number.isSafeInteger(effectiveTtlMs)
      || effectiveTtlMs < 500
      || effectiveTtlMs > room.definition.reference.maxTtlMs
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_PRESENCE_HEARTBEAT_UNSUPPORTED',
        'managed presence TTL must be an integer from 500ms through the generated maximum',
        { ttlMs: effectiveTtlMs, maxTtlMs: room.definition.reference.maxTtlMs },
      );
    }
    const validated = room.definition.valueValidator.validate(value);
    if (!validated.ok) {
      throw diagnosticError(
        'SNAPBACK_REACT_PRESENCE_VALUE_INVALID',
        'managed presence value does not satisfy the generated value contract',
        { collection: room.definition.reference.name, path: validated.path },
      );
    }
    const encoded = canonicalizeClientValueV1(validated.value);
    if (new TextEncoder().encode(encoded).byteLength > room.definition.reference.maxValueBytes) {
      throw diagnosticError(
        'SNAPBACK_EPHEMERAL_VALUE_TOO_LARGE',
        'managed presence value exceeds the generated byte budget',
        { maxValueBytes: room.definition.reference.maxValueBytes },
      );
    }
    for (const sibling of room.tokens.values()) {
      if (sibling === token || sibling.desired === null) continue;
      if (
        sibling.desired.encoded !== encoded
        || sibling.desired.ttlMs !== effectiveTtlMs
      ) {
        throw diagnosticError(
          'SNAPBACK_REACT_PRESENCE_VALUE_CONFLICT',
          'same-room managed presence consumers must publish the same value and TTL',
          { collection: room.definition.reference.name },
        );
      }
    }
    const interval = heartbeatInterval(effectiveTtlMs);
    const other = activePublisherRooms(room.definition.reference.id, room);
    const sustained = other.reduce(
      (sum, entry) => sum + Math.ceil(1_000 / entry.desired.intervalMs),
      Math.ceil(1_000 / interval),
    );
    const activeCount = other.length + 1;
    const rate = room.definition.reference.publishRate;
    if (sustained > rate.sustainedHz || 2 * activeCount > rate.burst) {
      throw diagnosticError(
        'SNAPBACK_REACT_PRESENCE_HEARTBEAT_UNSUPPORTED',
        'managed presence publishers exceed the generated sustained or burst budget',
        {
          sustainedRequiredHz: sustained,
          sustainedHz: rate.sustainedHz,
          burstRequired: 2 * activeCount,
          burst: rate.burst,
        },
      );
    }
    return Object.freeze({
      value: deepFreeze(validated.value),
      encoded,
      ttlMs: effectiveTtlMs,
      intervalMs: interval,
    });
  };
  const recomputeRoomDesired = (room) => {
    const previous = room.desired;
    room.desired = [...room.tokens.values()].find((token) => token.desired !== null)?.desired ?? null;
    if (previous === null && room.desired !== null) publishers += 1;
    if (previous !== null && room.desired === null) publishers = Math.max(0, publishers - 1);
  };
  const scheduleRoomHeartbeat = (room, generation = room.intentGeneration) => {
    clearRoomHeartbeat(room);
    if (
      room.desired === null
      || room.suspended
      || room.raw.status !== 'ready'
      || room.intentGeneration !== generation
    ) return;
    room.heartbeatTimer = setTimeout(() => {
      room.heartbeatTimer = null;
      if (
        room.desired === null
        || room.suspended
        || room.raw.status !== 'ready'
        || room.intentGeneration !== generation
      ) return;
      void enqueueRoomPublish(room, generation);
    }, room.desired.intervalMs);
    room.heartbeatTimer.unref?.();
  };
  const enqueueRoomPublish = (room, generation = room.intentGeneration) => {
    room.publisherDiagnostic = null;
    room.acknowledged = false;
    notifyRoom(room);
    const desired = room.desired;
    const task = room.workTail.then(async () => {
      if (
        room.closed
        || room.intentGeneration !== generation
        || room.desired !== desired
        || room.raw.status !== 'ready'
      ) return;
      try {
        await room.handle.publish(desired.value, { ttlMs: desired.ttlMs });
        if (
          room.closed
          || room.intentGeneration !== generation
          || room.desired !== desired
        ) return;
        room.acknowledged = true;
        room.suspended = false;
        room.publisherDiagnostic = null;
        notifyRoom(room);
        scheduleRoomHeartbeat(room, generation);
      } catch (error) {
        if (
          room.closed
          || room.intentGeneration !== generation
          || room.desired !== desired
        ) return;
        room.suspended = true;
        room.acknowledged = false;
        room.publisherDiagnostic = serializeError(error);
        clearRoomHeartbeat(room);
        notifyRoom(room);
      }
    });
    room.workTail = task.catch(() => {});
    return task;
  };
  const setTokenIntent = (room, token, value, ttlMs, source) => {
    const next = admitRoomIntent(room, token, value, ttlMs);
    const unchanged = token.desired?.encoded === next.encoded
      && token.desired?.ttlMs === next.ttlMs;
    token.source = source;
    if (unchanged && !room.suspended) return Promise.resolve();
    token.desired = next;
    recomputeRoomDesired(room);
    room.intentGeneration += 1;
    room.suspended = false;
    room.acknowledged = false;
    clearRoomHeartbeat(room);
    notifyRoom(room);
    return room.raw.status === 'ready'
      ? enqueueRoomPublish(room)
      : Promise.resolve();
  };
  const deleteTokenIntent = async (room, token) => {
    if (token.source === 'declarative') {
      throw diagnosticError(
        'SNAPBACK_REACT_PRESENCE_ACTION_CONFLICT',
        'imperative actions cannot replace a non-skip declarative presence value',
      );
    }
    // One provider owns one connection-scoped backend entry for the room.
    // An observing token that never published has no entry of its own to
    // delete, and a publisher that shares the same admitted intent with
    // another token may relinquish only its lease. Deleting the shared backend
    // entry here would erase the sibling's presence and strand its heartbeat.
    if (token.desired === null) return;
    const siblingDesired = [...room.tokens.values()].some(
      (sibling) => sibling !== token && sibling.desired !== null,
    );
    if (siblingDesired) {
      token.desired = null;
      token.source = 'observer';
      recomputeRoomDesired(room);
      notifyRoom(room);
      scheduleRoomHeartbeat(room);
      return;
    }
    const generation = ++room.intentGeneration;
    clearRoomHeartbeat(room);
    try {
      await room.handle?.delete();
      if (room.closed || room.intentGeneration !== generation) return;
      token.desired = null;
      room.acknowledged = false;
      room.suspended = false;
      room.publisherDiagnostic = null;
      recomputeRoomDesired(room);
      notifyRoom(room);
    } catch (error) {
      if (room.closed || room.intentGeneration !== generation) return;
      room.suspended = true;
      room.publisherDiagnostic = serializeError(error);
      notifyRoom(room);
      throw error;
    }
  };
  const pauseRoom = (room) => {
    room.generation += 1;
    clearRoomHeartbeat(room);
    room.handleOff?.();
    room.handleOff = null;
    room.republisher?.dispose?.();
    room.republisher = null;
    const handle = room.handle;
    room.handle = null;
    if (room.acknowledged) void handle?.delete?.().catch((error) => recordDiagnostic(error));
    handle?.dispose?.();
    room.cleanup = Promise.allSettled([
      room.workTail,
      handle?.settled?.() ?? Promise.resolve(),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') recordDiagnostic(result.reason);
      }
    });
  };
  const stopRoom = (room) => {
    if (room.closed) return;
    room.closed = true;
    pauseRoom(room);
  };
  const startRoom = (room) => {
    if (room.closed || room.handle || terminal || custodyPaused) return;
    const generation = ++room.generation;
    room.raw = PRESENCE_SERVER_PENDING;
    const handle = client.startEphemeralRoom(
      { ...room.definition, connectionId },
      room.scope,
    );
    room.handle = handle;
    room.handleOff = handle.subscribe(() => {
      if (room.closed || room.generation !== generation || room.handle !== handle) return;
      const previous = room.raw;
      room.raw = handle.getSnapshot();
      if (room.raw.reason) room.resyncReasons.push(room.raw.reason);
      if (room.resyncReasons.length > 32) room.resyncReasons.shift();
      if (room.raw.status !== 'ready') clearRoomHeartbeat(room);
      notifyRoom(room);
      if (
        room.raw.status === 'ready'
        && room.desired !== null
        && !room.suspended
        && (
          previous.status !== 'ready'
          || previous.selfKey !== room.raw.selfKey
          || previous.status === 'resyncing'
        )
      ) void enqueueRoomPublish(room);
    });
    const scopeKey = canonicalizeClientValueV1(room.scope);
    room.republisher = client.registerEphemeralRepublisher(
      room.definition.reference,
      async (context) => {
        if (
          room.closed
          || room.desired === null
          || canonicalizeClientValueV1(context.scope ?? {}) !== scopeKey
        ) return;
        await context.publish(room.desired.value, { ttlMs: room.desired.ttlMs });
      },
    );
    void handle.started().catch((error) => {
      if (room.closed || room.generation !== generation) return;
      recordDiagnostic(error);
    });
  };
  const createRoom = (descriptor) => {
    if (
      rooms.size >= PRESENCE_ROOM_CACHE_CAP
      || [...rooms.values()].filter((room) => room.handle !== null).length
        >= PRESENCE_SUBSCRIPTION_CAP
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_PRESENCE_ROOM_LIMIT',
        'React provider has reached its room-store or subscription cap',
        {
          roomCap: PRESENCE_ROOM_CACHE_CAP,
          subscriptionCap: PRESENCE_SUBSCRIPTION_CAP,
        },
      );
    }
    const room = {
      key: descriptor.key,
      definition: descriptor.definition,
      scope: descriptor.scope,
      raw: PRESENCE_SERVER_PENDING,
      tokens: new Map(),
      handle: null,
      handleOff: null,
      republisher: null,
      heartbeatTimer: null,
      desired: null,
      acknowledged: false,
      suspended: false,
      publisherDiagnostic: null,
      intentGeneration: 0,
      generation: 0,
      version: 0,
      idleEpoch: 0,
      workTail: Promise.resolve(),
      cleanup: Promise.resolve(),
      resyncReasons: [],
      closed: false,
    };
    rooms.set(room.key, room);
    return room;
  };
  const releasePresenceToken = (token) => {
    const room = token.room;
    if (!room || token.released) return;
    token.released = true;
    room.tokens.delete(token.id);
    roomLeases.delete(token);
    presenceConsumers = Math.max(0, presenceConsumers - 1);
    const wasDesired = token.desired !== null;
    token.listeners.clear();
    token.room = null;
    token.desired = null;
    recomputeRoomDesired(room);
    if (wasDesired && room.desired === null) {
      room.intentGeneration += 1;
      clearRoomHeartbeat(room);
      if (room.acknowledged) void room.handle?.delete?.().catch((error) => recordDiagnostic(error));
      room.acknowledged = false;
    }
    notifyRoom(room);
    if (room.tokens.size !== 0) return;
    const idleEpoch = ++room.idleEpoch;
    queueMicrotask(() => {
      if (room.tokens.size !== 0 || room.idleEpoch !== idleEpoch) return;
      stopRoom(room);
      void room.cleanup.finally(() => {
        if (room.tokens.size === 0 && room.idleEpoch === idleEpoch) rooms.delete(room.key);
        notifyConnection();
      });
    });
  };
  const subscribePresence = (descriptor, token, listener) => {
    if (terminal) throw diagnosticError('SNAPBACK_REACT_PROVIDER_CLOSED', 'React provider is closed');
    if (descriptor.unsupported) {
      token.unsupported = descriptor.unsupported;
      token.listeners.add(listener);
      return Object.freeze({
        release() { token.listeners.delete(listener); },
      });
    }
    if (token.room && token.room.key !== descriptor.key) releasePresenceToken(token);
    let room = rooms.get(descriptor.key);
    const created = !room;
    if (!room) {
      if (presenceConsumers >= PRESENCE_CONSUMER_CAP) {
        throw diagnosticError(
          'SNAPBACK_REACT_PRESENCE_CONSUMER_LIMIT',
          `React provider has reached its ${PRESENCE_CONSUMER_CAP}-consumer cap`,
          { cap: PRESENCE_CONSUMER_CAP },
        );
      }
      room = createRoom(descriptor);
    }
    const attaching = !token.room;
    if (attaching) {
      if (presenceConsumers >= PRESENCE_CONSUMER_CAP) {
        if (created) rooms.delete(room.key);
        throw diagnosticError(
          'SNAPBACK_REACT_PRESENCE_CONSUMER_LIMIT',
          `React provider has reached its ${PRESENCE_CONSUMER_CAP}-consumer cap`,
          { cap: PRESENCE_CONSUMER_CAP },
        );
      }
      room.tokens.set(token.id, token);
      roomLeases.add(token);
      token.room = room;
      token.released = false;
      presenceConsumers += 1;
    }
    token.listeners.add(listener);
    room.idleEpoch += 1;
    try {
      if (descriptor.intent !== null) {
        if (!token.desired && room.desired === null && publishers >= PRESENCE_PUBLISHER_CAP) {
          throw diagnosticError(
            'SNAPBACK_REACT_PRESENCE_PUBLISHER_LIMIT',
            `React provider has reached its ${PRESENCE_PUBLISHER_CAP}-publisher cap`,
            { cap: PRESENCE_PUBLISHER_CAP },
          );
        }
        const publishTask = setTokenIntent(
          room,
          token,
          descriptor.intent.value,
          descriptor.intent.ttlMs,
          'declarative',
        );
        void publishTask.catch(recordDiagnostic);
      } else if (token.source === 'declarative') {
        token.source = 'observer';
        token.desired = null;
        recomputeRoomDesired(room);
      }
      startRoom(room);
    } catch (error) {
      token.listeners.delete(listener);
      if (attaching) {
        room.tokens.delete(token.id);
        roomLeases.delete(token);
        token.room = null;
        token.desired = null;
        token.released = true;
        presenceConsumers = Math.max(0, presenceConsumers - 1);
        recomputeRoomDesired(room);
      }
      if (created) {
        rooms.delete(room.key);
      }
      throw error;
    }
    notifyRoom(room);
    let released = false;
    return Object.freeze({
      release() {
        if (released) return;
        released = true;
        token.listeners.delete(listener);
        queueMicrotask(() => {
          if (token.listeners.size === 0) releasePresenceToken(token);
        });
      },
    });
  };
  const createPresenceToken = () => {
    const token = {
      id: `presence-${++leaseSequence}`,
      room: null,
      listeners: new Set(),
      desired: null,
      source: 'observer',
      released: false,
      unsupported: null,
      view: null,
      viewVersion: -1,
      actions: null,
    };
    token.actions = Object.freeze({
      async publish(value, publishOptions = {}) {
        if (token.source === 'declarative') {
          throw diagnosticError(
            'SNAPBACK_REACT_PRESENCE_ACTION_CONFLICT',
            'imperative actions cannot replace a non-skip declarative presence value',
          );
        }
        if (!token.room) {
          throw diagnosticError(
            'SNAPBACK_REACT_PRESENCE_NOT_AUTHORITATIVE',
            'presence observer is not attached to a room',
          );
        }
        if (token.desired === null && publishers >= PRESENCE_PUBLISHER_CAP) {
          throw diagnosticError(
            'SNAPBACK_REACT_PRESENCE_PUBLISHER_LIMIT',
            `React provider has reached its ${PRESENCE_PUBLISHER_CAP}-publisher cap`,
            { cap: PRESENCE_PUBLISHER_CAP },
          );
        }
        return setTokenIntent(token.room, token, value, publishOptions.ttlMs, 'observer');
      },
      async delete() {
        if (!token.room) return;
        return deleteTokenIntent(token.room, token);
      },
    });
    return token;
  };
  const presenceDescriptor = (reference, scope, value, ttlMs) => {
    const definition = admittedReactEphemeralDefinition(binding, reference);
    const scopeResult = definition.scopeValidator.validate(scope);
    if (!scopeResult.ok) {
      throw diagnosticError(
        'SNAPBACK_REACT_ARGS_INVALID',
        'presence scope does not satisfy the generated scope contract',
        { collection: reference.name, path: scopeResult.path },
      );
    }
    const normalizedScope = deepFreeze(scopeResult.value);
    const key = [
      providerInstanceId,
      reference.id,
      canonicalizeClientValueV1(normalizedScope),
    ].join('\u0000');
    const unsupported = binding.profile === 'local-dev-sqlite-ibex'
      ? null
      : diagnostic(
        'SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED',
        'React presence v1 is currently proven only on the local target',
        { targetProfileId: binding.profile },
      );
    return Object.freeze({
      key,
      definition,
      scope: normalizedScope,
      unsupported,
      intent: value === skip ? null : Object.freeze({ value, ttlMs }),
    });
  };
  const presenceSnapshot = (descriptor, token) => {
    if (descriptor.unsupported || token.unsupported) {
      const unsupported = descriptor.unsupported ?? token.unsupported;
      return Object.freeze({
        status: 'unsupported',
        entries: Object.freeze([]),
        selfKey: null,
        diagnostic: unsupported,
        connection: 'idle',
        publisher: Object.freeze({ status: 'observing', diagnostic: null }),
        publish: token.actions.publish,
        delete: token.actions.delete,
      });
    }
    const room = token.room ?? rooms.get(descriptor.key);
    if (!room) {
      return Object.freeze({
        ...PRESENCE_SERVER_PENDING,
        publisher: Object.freeze({ status: 'observing', diagnostic: null }),
        publish: token.actions.publish,
        delete: token.actions.delete,
      });
    }
    return presenceView(room, token);
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
      for (const room of rooms.values()) pauseRoom(room);
      await Promise.allSettled([
        ...[...allHandles].map((handle) => handle.settled()),
        ...[...rooms.values()].map((room) => room.cleanup),
      ]);
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
      for (const room of rooms.values()) {
        room.raw = PRESENCE_SERVER_PENDING;
        room.acknowledged = false;
        room.publisherDiagnostic = null;
        notifyRoom(room);
      }
      notifyConnection();
    },
    clearMemory() {},
    async commitDurable() {},
    async resume() {
      if (terminal) return;
      custodyPaused = false;
      for (const store of stores.values()) startStore(store);
      for (const room of rooms.values()) startRoom(room);
    },
  };
  const unregisterBarrier = client.registerAuthBarrierParticipant(barrierParticipant);

  return Object.freeze({
    descriptor(reference, args, groupBoot = null) {
      const admitted = admittedReactReference(binding, reference, 'LiveQuery');
      const resultContract = preparedReactResultContract(binding, admitted);
      if (args === skip) return Object.freeze({
        skipped: true,
        reference: admitted,
        args,
        key: null,
        resultContract,
        groupBoot,
      });
      const key = canonicalReactStoreKeyV1(providerInstanceId, admitted, args);
      return Object.freeze({
        skipped: false,
        reference: admitted,
        args,
        key,
        resultContract,
        groupBoot,
      });
    },
    subscribe(descriptor, listener, previousLease = null) {
      return subscribeMany([descriptor], listener, previousLease);
    },
    subscribeMany,
    runMutation,
    createPresenceToken,
    presenceDescriptor,
    subscribePresence,
    presenceSnapshot,
    snapshot,
    connectionId,
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
        timers: [...rooms.values()].filter((room) => room.heartbeatTimer !== null).length,
        presenceStores: rooms.size,
        presenceConsumers,
        presenceSubscriptions: [...rooms.values()].filter((room) => room.handle !== null).length,
        publishers,
        presenceTimers: [...rooms.values()].filter((room) => room.heartbeatTimer !== null).length,
        presenceListeners: [...rooms.values()].reduce(
          (sum, room) => sum + [...room.tokens.values()]
            .reduce((tokenSum, token) => tokenSum + token.listeners.size, 0),
          0,
        ),
        resyncReasons: Object.freeze([...rooms.values()].flatMap((room) => room.resyncReasons)),
        listeners: [...stores.values()].reduce((sum, store) => sum + store.listeners.size, 0)
          + connectionListeners.size,
        diagnostics: Object.freeze([...diagnostics]),
        preparedRegistrations: preparedRegistrations.size,
      });
    },
    async dispose() {
      if (terminal) return;
      terminal = true;
      custodyPaused = true;
      for (const lease of [...leases]) releaseLease(lease);
      for (const token of [...roomLeases]) releasePresenceToken(token);
      for (const store of stores.values()) stopStore(store, { blank: true });
      for (const room of rooms.values()) stopRoom(room);
      await Promise.allSettled([
        ...[...allHandles].map((handle) => handle.settled()),
        ...[...rooms.values()].map((room) => room.cleanup),
      ]);
      manager?.close?.();
      try { await manager?.settled?.(); } catch (error) { recordDiagnostic(error); }
      try { await client.disconnect?.(connectionId); } catch (error) { recordDiagnostic(error); }
      stores.clear();
      preparedRegistrations.clear();
      rooms.clear();
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

export function useSnapbackPresence(reference, options) {
  const provider = useProvider();
  if (!options || typeof options !== 'object') {
    throw new TypeError('useSnapbackPresence requires scope and value options');
  }
  const tokenRef = useRef(null);
  if (tokenRef.current === null) tokenRef.current = provider.registry.createPresenceToken();
  const token = tokenRef.current;
  const descriptor = useMemo(
    () => provider.registry.presenceDescriptor(
      reference,
      options.scope,
      options.value,
      options.ttlMs,
    ),
    [provider, reference, options.scope, options.value, options.ttlMs],
  );
  const subscribe = useCallback((listener) => {
    const lease = provider.registry.subscribePresence(descriptor, token, listener);
    return () => lease.release();
  }, [provider, descriptor, token]);
  return useSyncExternalStore(
    subscribe,
    () => provider.registry.presenceSnapshot(descriptor, token),
    () => provider.registry.presenceSnapshot(descriptor, token),
  );
}

function validateEntries(provider, entries) {
  const preparedGroup = isPreparedReactQueryGroup(entries) ? entries : null;
  if (preparedGroup !== null) {
    const admitted = admittedReactQueryGroup(provider.binding, preparedGroup.reference);
    if (
      admitted.id !== preparedGroup.reference.id
      || (
        preparedGroup.connectionId !== null
        && provider.registry.connectionId !== preparedGroup.connectionId
      )
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_GROUP_CONNECTION_MISMATCH',
        'prepared query group belongs to a different provider connection',
        { groupId: admitted.id },
      );
    }
    return Object.freeze(preparedGroup.entries.map((entry) => Object.freeze({
      name: entry.name,
      ...provider.registry.descriptor(entry.ref, entry.args, preparedGroup.boot),
    })));
  }
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
      ...provider.registry.descriptor(entry?.ref, entry?.args ?? {}, null),
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
  const boot = descriptors.length > 0
    && descriptors.every((descriptor) => descriptor.groupBoot !== null)
    && descriptors.every(
      (descriptor) => descriptor.groupBoot === descriptors[0].groupBoot,
    )
    ? descriptors[0].groupBoot
    : null;
  return Object.freeze({
    queries,
    status,
    connection: weakConnection(active.map((query) => query.connection)),
    error: firstError,
    boot,
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

export function useSnapbackMutation(reference, options = {}) {
  const provider = useProvider();
  const admitted = useMemo(
    () => admittedReactReference(provider.binding, reference, 'Mutation'),
    [provider, reference],
  );
  const optimistic = options?.optimistic ?? null;
  return useCallback(
    (args) => provider.registry.runMutation(admitted, args, optimistic),
    [provider, admitted, optimistic],
  );
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

export function observeSnapbackPresence(providerValue, reference, options, listener) {
  const provider = assertProvider(providerValue);
  const token = provider.registry.createPresenceToken();
  let descriptor = provider.registry.presenceDescriptor(
    reference,
    options.scope,
    Object.prototype.hasOwnProperty.call(options, 'value') ? options.value : skip,
    options.ttlMs,
  );
  let lease = null;
  let closed = false;
  const emit = () => {
    if (!closed) listener(provider.registry.presenceSnapshot(descriptor, token));
  };
  lease = provider.registry.subscribePresence(descriptor, token, emit);
  emit();
  return Object.freeze({
    update(nextOptions) {
      if (closed) throw diagnosticError('SNAPBACK_REACT_PROVIDER_CLOSED', 'presence observer is closed');
      lease.release();
      descriptor = provider.registry.presenceDescriptor(
        reference,
        nextOptions.scope,
        Object.prototype.hasOwnProperty.call(nextOptions, 'value') ? nextOptions.value : skip,
        nextOptions.ttlMs,
      );
      lease = provider.registry.subscribePresence(descriptor, token, emit);
      emit();
    },
    snapshot() { return provider.registry.presenceSnapshot(descriptor, token); },
    publish(value, publishOptions) { return token.actions.publish(value, publishOptions); },
    delete() { return token.actions.delete(); },
    async dispose() {
      if (closed) return;
      closed = true;
      const room = token.room;
      lease.release();
      lease = null;
      await Promise.resolve();
      await room?.cleanup;
    },
  });
}

export async function invokeSnapbackMutation(providerValue, reference, args, options = {}) {
  const provider = assertProvider(providerValue);
  const admitted = admittedReactReference(provider.binding, reference, 'Mutation');
  return provider.registry.runMutation(admitted, args, options.optimistic ?? null);
}
