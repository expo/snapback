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
  consumePreparedReactQueryGroup,
  abandonConsumedReactQueryGroup,
  LIVE_RECONNECT_BASE_DELAY_MS,
  LIVE_RECONNECT_MAX_DELAY_MS,
} from '@expo/snapback-client';
export { bindSnapbackAppLifecycle } from '@expo/snapback-client';
import { createAssetClient } from '@expo/snapback-client/assets';
import { placeholderToDataURL, thumbHashToApproximateAspectRatio } from './thumbhash.mjs';
export {
  placeholderToDataURL,
  rgbaToDataURL,
  thumbHashToApproximateAspectRatio,
  thumbHashToDataURL,
  thumbHashToRGBA,
} from './thumbhash.mjs';

// @ref LLP 0114#prepared-binding-and-provider-ownership — the provider owns
// its registry and barrier participant while borrowing the prepared client's
// transport.
// @ref LLP 0114#exact-saturated-replacement-semantics — group admission is
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
// Local-uniqueness labels (provider instances, optimistic-layer ids): NOT
// security-bearing identity, so a carrier with no WebCrypto (React
// Native/Hermes — 0137 A1-Expo f1) falls back to time+sequence+Math.random
// uniqueness, mirroring the headless client's processClientStoreId and the
// contract arm's createClientMutationId. Never used for custody or
// server-visible idempotency claims.
let localLabelSequence = 0;
const localUniqueLabel = () => globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${(localLabelSequence += 1).toString(36)}-${Math.random().toString(36).slice(2)}`;
const preparedGroupReadersByRegistry = new WeakMap();

function preparedGroupForProvider(provider) {
  return preparedGroupReadersByRegistry.get(provider.registry)?.() ?? null;
}

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
    freshness: 'unknown',
    retention: null,
  });
}

const SKIPPED = Object.freeze({
  status: 'skipped',
  data: undefined,
  error: null,
  connection: 'idle',
  freshness: 'unknown',
  retention: null,
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

function projectionEquals(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, index) => projectionEquals(value, b[index]));
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length
    && aKeys.every((key) => Object.hasOwn(b, key) && projectionEquals(a[key], b[key]));
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
  const order = CONNECTION_ORDER[value];
  if (order >= 2 && order <= 6) return value;
  if (value === 'closed') return 'closed';
  if (value === 'error' || detail?.error) return 'error';
  return 'disconnected';
}

// Latest retainability classification from the live handle (LLP 0129
// Phase 0 refuse-with-clarity fact; frozen on the headless handle). Facts
// are surfaced, never synthesized: null stays null until the client
// classifies the subscription.
function captureRetention(store) {
  const retention = store.handle?.current?.retention ?? null;
  if (retention !== null) store.retention = retention;
}

function queryStateForConnection(store, connection, detail = {}) {
  const snapshot = store.snapshot;
  if (connection === 'error') {
    return Object.freeze({
      status: 'error',
      data: undefined,
      error: serializeError(detail.error ?? new Error('live query connection failed')),
      connection,
      freshness: 'unknown',
      retention: store.retention,
    });
  }
  if (connection === 'closed') {
    return Object.freeze({
      status: 'error',
      data: undefined,
      error: diagnostic('SNAPBACK_REACT_PROVIDER_CLOSED', 'React provider is closed'),
      connection,
      freshness: 'unknown',
      retention: store.retention,
    });
  }
  if (snapshot.status === 'ready' || snapshot.status === 'refreshing') {
    return Object.freeze({
      // Retained rows are never presented as settled: 'ready' requires both
      // a live connection AND authoritative freshness (LLP 0043's
      // never-presented-as-current rule projected onto the status axis).
      status: connection === 'live' && snapshot.freshness !== 'retained'
        ? 'ready'
        : 'refreshing',
      data: snapshot.data,
      error: null,
      connection,
      freshness: snapshot.freshness,
      retention: store.retention,
    });
  }
  if (snapshot.status === 'error') {
    // An error snapshot (e.g. an authorization denial after a bearer custody
    // transition — 0137 A1-Expo f4) survives ordinary connection movement;
    // only fresh authoritative rows clear it. Pre-fix the trailing
    // 'disconnected' event wiped the denial back to pending, so the hook
    // presented zero rows with no error fact.
    return Object.freeze({ ...snapshot, connection });
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
  let preparedGroup = options.preparedGroup ?? null;
  if (preparedGroup !== null && !isPreparedReactQueryGroup(preparedGroup)) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_PREPARATION_INVALID',
      'preparedGroup must come from binding.prepareQueryGroup()',
    );
  }
  if (preparedGroup !== null) admittedReactQueryGroup(binding, preparedGroup.reference);
  const preparedDevUserId = preparedGroup?.devUserId ?? null;
  const preparedPersistResume = preparedGroup?.reference?.persist !== false;
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
  const preparedRegistrations = new Map(
    (preparedGroup?.entries ?? [])
      .filter((entry) => entry.registeredSubscription !== null)
      .map((entry) => [
        entry.name,
        entry.registeredSubscription,
      ]),
  );
  const unadoptedPreparedSubscriptions = new Map(
    (preparedGroup?.entries ?? [])
      .filter((entry) => entry.registeredSubscription !== null)
      .map((entry) => [
        entry.registeredSubscription.subscriptionId,
        Object.freeze({
          registration: entry.registeredSubscription,
          reference: entry.ref,
        }),
      ]),
  );
  let manager = typeof client.liveStreamManager === 'function'
    ? client.liveStreamManager(connectionId)
    : null;
  let consumers = 0;
  let presenceConsumers = 0;
  let publishers = 0;
  let terminal = false;
  let custodyPaused = false;
  let leaseSequence = 0;
  let registeredConnectionAttached = false;
  let registeredRecovery = null;
  let registeredRetirement = Promise.resolve();
  const dirtyPreparedSubscriptions = new Set();
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
  const retireUnadoptedPreparedSubscriptions = () => {
    const pending = [...unadoptedPreparedSubscriptions.values()];
    unadoptedPreparedSubscriptions.clear();
    if (pending.length === 0 || typeof client.unsubscribeLive !== 'function') {
      return registeredRetirement;
    }
    registeredRetirement = registeredRetirement.then(async () => {
      await Promise.allSettled(pending.map(async ({ registration, reference }) => {
        try {
          await client.unsubscribeLive(reference, {
            subscriptionId: registration.subscriptionId,
            connectionId,
            ...(preparedDevUserId === null ? {} : { userId: preparedDevUserId }),
          });
        } catch (error) {
          recordDiagnostic(error);
        }
      }));
    });
    return registeredRetirement;
  };
  const invalidatePreparedRegistrations = (reason) => {
    if (
      preparedGroup === null
      || (
        unadoptedPreparedSubscriptions.size === 0
        && !preparedGroup.entries.some(
          (entry) => entry.registeredSubscription !== null,
        )
      )
    ) return;
    const retirement = retireUnadoptedPreparedSubscriptions();
    preparedRegistrations.clear();
    for (const store of stores.values()) store.registeredSubscription = null;
    preparedGroup = Object.freeze({
      ...preparedGroup,
      source: 'live-recovery',
      reason,
      connectionId: null,
      boot: null,
      entries: Object.freeze(preparedGroup.entries.map((entry) => Object.freeze({
        name: entry.name,
        ref: entry.ref,
        args: entry.args,
        registeredSubscription: null,
        readOnlySnapshot: entry.readOnlySnapshot ?? null,
        ...(entry.bootDelivery === undefined ? {} : { bootDelivery: entry.bootDelivery }),
      }))),
    });
    return retirement;
  };
  const markPreparedGroupRecovery = (reason) => {
    if (preparedGroup?.source !== 'registered-bundle') return;
    preparedGroup = Object.freeze({
      ...preparedGroup,
      source: 'live-recovery',
      reason,
      boot: null,
    });
  };
  // @ref LLP 0112#registered-boot — once the shared connection attaches,
  // frames for a not-yet-demanded child cannot be dropped and followed by an
  // older bundle snapshot presented as current. Mark it for a fresh
  // superseding subscribe before its first store can publish.
  const unregisterPreparedFrameGuard = typeof client.registerDurableConsumer === 'function'
    ? client.registerDurableConsumer(
      connectionId,
      (frame) => {
        const subscriptionId = frame?.subscription_id ?? frame?.subscriptionId ?? null;
        if (typeof subscriptionId !== 'string') return;
        const pending = unadoptedPreparedSubscriptions.get(subscriptionId);
        if (!pending) return;
        if (dirtyPreparedSubscriptions.has(subscriptionId)) return;
        dirtyPreparedSubscriptions.add(subscriptionId);
        markPreparedGroupRecovery('unadopted-delta');
        const claimedStore = [...stores.values()].find(
          (store) => store.unadoptedSubscriptionId === subscriptionId,
        );
        if (claimedStore) {
          claimedStore.blockedPreparedPublication = true;
          queueMicrotask(() => {
            if (
              terminal
              || claimedStore.unadoptedSubscriptionId !== subscriptionId
            ) return;
            unadoptedPreparedSubscriptions.delete(subscriptionId);
            claimedStore.unadoptedSubscriptionId = null;
            stopStore(claimedStore, { blank: true });
            claimedStore.registeredSubscription = null;
            claimedStore.supersedesSubscriptionId = subscriptionId;
            claimedStore.blockedPreparedPublication = false;
            startStore(claimedStore);
          });
        }
      },
    )
    : () => {};
  const recoverExpiredRegisteredConnection = () => {
    if (registeredRecovery !== null) return registeredRecovery;
    custodyPaused = true;
    const attachDeadline = preparedGroup?.boot?.attachDeadline
      ?? preparedGroup?.entries.find(
        (entry) => Number.isSafeInteger(entry.registeredSubscription?.attachDeadline),
      )?.registeredSubscription?.attachDeadline
      ?? null;
    const retirement = invalidatePreparedRegistrations('attach-deadline-expired');
    const connectionRelease = Promise.resolve(client.releaseConnection?.(connectionId, {
        attachDeadline,
        ifIdle: true,
      }));
    registeredRecovery = Promise.allSettled([retirement, connectionRelease])
      .then((settlements) => {
        for (const settlement of settlements) {
          if (settlement.status === 'rejected') recordDiagnostic(settlement.reason);
        }
      })
      .catch(recordDiagnostic)
      .then(() => {
        if (terminal) return;
        manager = typeof client.liveStreamManager === 'function'
          ? client.liveStreamManager(connectionId)
          : null;
        custodyPaused = false;
        for (const store of stores.values()) startStore(store);
        for (const room of rooms.values()) startRoom(room);
      })
      .finally(() => { registeredRecovery = null; });
    return registeredRecovery;
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

  // Channel B retained delivery (LLP 0090 D3 / LLP 0114 freshness axis): a
  // persisted/preloaded frame renders marked 'retained' — status stays
  // 'refreshing', never 'ready' — WITHOUT advancing the authoritative
  // revision, so optimistic admission still requires a current authoritative
  // store and no layer retirement can key on a retained frame. Queued-intent
  // state is the outbox surface (useSnapbackOutbox); the retained frame never
  // fabricates an overlay for it.
  const publishRetained = (store, rows, generation = store.generation) => {
    store.authoritativeData = validateResultContract(store.resultContract, rows);
    store.freshness = 'retained';
    captureRetention(store);
    publish(store, Object.freeze({
      status: 'refreshing',
      data: store.authoritativeData,
      error: null,
      connection: normalizeConnection(store.handle?.current?.connection ?? 'connecting'),
      freshness: 'retained',
      retention: store.retention,
      ...(store.bootDelivery === null ? {} : { bootDelivery: store.bootDelivery }),
    }), generation);
  };

  const publishAuthoritative = (store, rows, generation = store.generation) => {
    store.authoritativeRevision += 1;
    store.authoritativeData = validateResultContract(store.resultContract, rows);
    store.freshness = 'current';
    captureRetention(store);
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
      freshness: 'current',
      retention: store.retention,
      ...(store.bootDelivery === null ? {} : { bootDelivery: store.bootDelivery }),
    }), generation);
  };

  // @ref LLP 0114#bounded-subscribe-failure-window--2026-08-04 — a store whose
  // subscribe rejects holds its error snapshot behind a timer-owned failure
  // window (the client's 250ms→10s reconnect ladder, held at the cap while
  // demanded). Render- and mutation-driven startStore calls during the window
  // are inert, so render cadence can never set subscribe-attempt cadence
  // (RN carrier storm, issues/closed/20260803-rn-carrier-bricked-tosorted-
  // registration-ledger.md). Success, supersession, or any stopStore
  // lifecycle event (idle release, custody movement, dispose) clears it.
  const clearSubscribeFailureWindow = (store) => {
    if (store.subscribeFailureRetryTimer !== null) {
      clearTimeout(store.subscribeFailureRetryTimer);
      store.subscribeFailureRetryTimer = null;
    }
    store.subscribeFailureAttempts = 0;
  };

  const scheduleSubscribeRetry = (store) => {
    if (terminal || custodyPaused || store.subscribeFailureRetryTimer !== null) return;
    if (store.consumers === 0 && store.pins === 0) return;
    const delay = Math.min(
      LIVE_RECONNECT_BASE_DELAY_MS * 2 ** Math.min(store.subscribeFailureAttempts, 30),
      LIVE_RECONNECT_MAX_DELAY_MS,
    );
    store.subscribeFailureAttempts += 1;
    store.subscribeFailureRetryTimer = setTimeout(() => {
      store.subscribeFailureRetryTimer = null;
      if (terminal || custodyPaused || store.handle) return;
      if (store.consumers === 0 && store.pins === 0) return;
      startStore(store);
    }, delay);
    store.subscribeFailureRetryTimer.unref?.();
  };

  const stopStore = (store, { blank = false } = {}) => {
    store.generation += 1;
    clearSubscribeFailureWindow(store);
    const handle = store.handle;
    store.handle = null;
    if (blank) {
      store.snapshot = pending('idle');
      store.freshness = 'unknown';
      store.retention = null;
    }
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
    if (store.readOnlySnapshot !== null) return null;
    // A one-for-one supersession must carry its exact predecessor witness to
    // the server now; it is an explicit invalidation, so it resets any held
    // failure window rather than waiting behind it.
    if (supersedes !== null) clearSubscribeFailureWindow(store);
    else if (store.subscribeFailureRetryTimer !== null) return;
    if (
      store.registeredSubscription !== null
      && !registeredConnectionAttached
      && Number.isSafeInteger(store.registeredSubscription.attachDeadline)
      && Date.now() >= store.registeredSubscription.attachDeadline
    ) {
      void recoverExpiredRegisteredConnection();
      return;
    }
    const generation = ++store.generation;
    store.snapshot = pending('connecting');
    store.freshness = 'unknown';
    let handle;
    handle = client.startLiveQuery(store.reference, {
      connectionId,
      args: store.args,
      transport: 'stream',
      fallbackToPoll: false,
      supersedes,
      ...(preparedDevUserId === null ? {} : { userId: preparedDevUserId }),
      persistResume: preparedPersistResume,
      ...(store.registeredSubscription?.authorizationNamespace == null
        ? {}
        : { authorizationNamespace: store.registeredSubscription.authorizationNamespace }),
      ...(store.supersedesSubscriptionId === null
        ? {}
        : { supersedesSubscriptionId: store.supersedesSubscriptionId }),
      ...(store.registeredSubscription === null
        ? {}
        : { registeredSubscription: store.registeredSubscription }),
      onUpdate(rows, detail) {
        if (store.blockedPreparedPublication) return;
        if (store.unadoptedSubscriptionId !== null) {
          unadoptedPreparedSubscriptions.delete(store.unadoptedSubscriptionId);
          store.unadoptedSubscriptionId = null;
        }
        if (detail?.kind === 'authorization_denied') {
          // A server-answered authorization denial (0137 A1-Expo f4: e.g. a
          // bearer custody transition to a lesser-privileged successor) is a
          // renderable outcome, not an empty 'ready'. Rows are already blank;
          // project the denial on the error axis. Fresh authoritative rows
          // (a later authorized subscribe) clear it below.
          captureRetention(store);
          publish(store, Object.freeze({
            status: 'error',
            data: undefined,
            error: serializeError(detail.error ?? detail.authorization),
            connection: normalizeConnection(store.handle?.current?.connection ?? 'disconnected'),
            freshness: 'unknown',
            retention: store.retention,
          }), generation);
          return;
        }
        if (detail?.freshness === 'retained') {
          publishRetained(store, rows ?? [], generation);
          return;
        }
        publishAuthoritative(store, rows ?? [], generation);
      },
      onConnectionChange(connection, detail) {
        const normalized = normalizeConnection(connection, detail);
        captureRetention(store);
        publish(
          store,
          queryStateForConnection(store, normalized, detail),
          generation,
        );
      },
    });
    if (store.registeredSubscription !== null) registeredConnectionAttached = true;
    store.registeredSubscription = null;
    store.handle = handle;
    allHandles.add(handle);
    void handle.started().then(() => {
      if (store.generation !== generation || store.handle !== handle) return;
      store.subscribeFailureAttempts = 0;
      if (store.blockedPreparedPublication) return;
      if (store.unadoptedSubscriptionId !== null) {
        unadoptedPreparedSubscriptions.delete(store.unadoptedSubscriptionId);
        store.unadoptedSubscriptionId = null;
      }
      if (store.snapshot.status === 'pending' && Array.isArray(handle.current?.rows)) {
        // A handle that established holding only retained rows (offline boot
        // survival — LLP 0129 Phase 0) must not have them republished as
        // authoritative here.
        if (handle.current.freshness === 'retained') {
          publishRetained(store, handle.current.rows, generation);
        } else {
          publishAuthoritative(store, handle.current.rows, generation);
        }
        return;
      }
      // The retainability classification lands on the handle only once the
      // subscribe settles; refresh an already-published snapshot with it.
      captureRetention(store);
      if (
        (store.snapshot.status === 'ready' || store.snapshot.status === 'refreshing')
        && store.snapshot.retention !== store.retention
      ) {
        publish(store, Object.freeze({
          ...store.snapshot,
          retention: store.retention,
        }), generation);
      }
    }, (error) => {
      if (store.generation !== generation || store.handle !== handle) return;
      if (store.unadoptedSubscriptionId !== null) {
        unadoptedPreparedSubscriptions.delete(store.unadoptedSubscriptionId);
        store.unadoptedSubscriptionId = null;
      }
      store.handle = null;
      allHandles.delete(handle);
      if (error?.code === 'SNAPBACK_REACT_GROUP_ATTACH_EXPIRED') {
        void recoverExpiredRegisteredConnection();
        return;
      }
      publish(store, Object.freeze({
        status: 'error',
        data: undefined,
        error: serializeError(error),
        connection: 'error',
        freshness: 'unknown',
        retention: store.retention,
      }), generation);
      scheduleSubscribeRetry(store);
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
    const preparedRegistration = preparedRegistrations.get(
      descriptor.preparedEntryName,
    ) ?? null;
    const readOnlySnapshot = descriptor.readOnlySnapshot ?? null;
    const mustResubscribe = preparedRegistration !== null
      && dirtyPreparedSubscriptions.has(preparedRegistration.subscriptionId);
    const store = {
      key: descriptor.key,
      reference: descriptor.reference,
      args: descriptor.args,
      snapshot: readOnlySnapshot === null
        ? pending()
        : Object.freeze({
            status: 'ready',
            data: readOnlySnapshot.rows,
            error: null,
            connection: 'idle',
            freshness: 'snapshot',
            retention: null,
            ...(descriptor.bootDelivery === null
              ? {}
              : { bootDelivery: descriptor.bootDelivery }),
          }),
      consumers: 0,
      listeners: new Map(),
      handle: null,
      generation: 0,
      idleEpoch: 0,
      handoffPending: 0,
      subscribeFailureAttempts: 0,
      subscribeFailureRetryTimer: null,
      resultContract: descriptor.resultContract,
      authoritativeData: readOnlySnapshot?.rows ?? Object.freeze([]),
      authoritativeRevision: readOnlySnapshot === null ? 0 : 1,
      freshness: readOnlySnapshot === null ? 'unknown' : 'snapshot',
      retention: null,
      optimisticLayers: [],
      pendingMutations: new Map(),
      pins: 0,
      registeredSubscription: mustResubscribe ? null : preparedRegistration,
      readOnlySnapshot,
      bootDelivery: descriptor.bootDelivery,
      unadoptedSubscriptionId: preparedRegistration?.subscriptionId ?? null,
      blockedPreparedPublication: false,
      supersedesSubscriptionId: mustResubscribe
        ? preparedRegistration.subscriptionId
        : null,
    };
    preparedRegistrations.delete(
      descriptor.preparedEntryName,
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
      freshness: store.freshness,
      retention: store.retention,
      ...(store.bootDelivery === null ? {} : { bootDelivery: store.bootDelivery }),
    }));
  };

  // @ref LLP 0107#replay-safety-affordances — dev-only advisory: an
  // optimistic update is a replayable projection, so a reducer that diverges
  // over its own output is action-shaped (toggle/increment) and would re-run
  // the user action during rebase. Observational only — warns once per
  // (mutation, query) pair and never changes admission or layer state.
  const replayAdvisoryKeys = new Set();
  const warnIfReplayDivergent = (mutationReference, queryReference, layer, store, initialProjection) => {
    if (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production') return;
    const key = `${mutationReference.id} ${queryReference.id}`;
    if (replayAdvisoryKeys.has(key)) return;
    let detail = null;
    try {
      const replayed = validateResultContract(
        store.resultContract,
        layer.update(initialProjection, layer.mutationArgs),
        { requireKnown: true },
      );
      if (!projectionEquals(replayed, initialProjection)) {
        detail = 'returned a different projection when replayed over its own output';
      }
    } catch (error) {
      detail = 'failed when replayed over its own output '
        + `(${error?.code ?? error?.message ?? String(error)})`;
    }
    if (detail === null) return;
    replayAdvisoryKeys.add(key);
    console.warn(
      `SNAPBACK_REACT_OPTIMISTIC_REPLAY_DIVERGENT: the optimistic update for ${mutationReference.name} `
      + `over ${queryReference.name} ${detail}. Optimistic updates are replayable projections over an `
      + 'evolving authoritative base: capture the intended outcome and set it (or use '
      + 'projectRecordFields) instead of toggling or incrementing the incoming rows. See '
      + 'guide/recipes/optimistic-toggle.md.',
    );
  };

  const runMutation = async (mutationReference, mutationArgs, optimistic = null) => {
    if (terminal) throw diagnosticError('SNAPBACK_REACT_PROVIDER_CLOSED', 'React provider is closed');
    const admittedMutation = admittedReactReference(binding, mutationReference, 'Mutation');
    canonicalizeClientValueV1(mutationArgs);
    const mutationContract = preparedReactResultContract(binding, admittedMutation);
    if (optimistic === null) {
      // @ref LLP 0100#product-receipt — the admitted local-dev
      // persona must bind writes at the same product boundary as live reads.
      const output = await client.mutate(admittedMutation, {
        args: mutationArgs,
        ...(preparedDevUserId === null ? {} : { userId: preparedDevUserId }),
      });
      return validateResultContract(
        mutationContract,
        output.result,
        { violationCode: 'SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED' },
      );
    }

    if (
      typeof optimistic !== 'object'
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
    const id = localUniqueLabel();
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
    warnIfReplayDivergent(admittedMutation, queryReference, layer, store, initialProjection);
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
      freshness: store.freshness,
      retention: store.retention,
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
        ...(preparedDevUserId === null ? {} : { userId: preparedDevUserId }),
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
    const netNew = [...uniqueNew.entries()]
      .filter(([, descriptor]) => descriptor.reference.kind === 'LiveQuery')
      .map(([key]) => key)
      .filter((key) => !stores.get(key)?.handle);
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
        ...(registeredRecovery === null ? [] : [registeredRecovery]),
      ]);
    },
    blank() {
      custodyPaused = true;
      for (const store of stores.values()) {
        store.generation += 1;
        store.snapshot = pending('idle');
        store.freshness = 'unknown';
        store.retention = null;
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
    clearMemory() {
      // @ref LLP 0112#authority-races-and-cleanup — a successor authority
      // may never lazily adopt predecessor bundle registrations or boot rows.
      invalidatePreparedRegistrations('authority-replaced');
    },
    async commitDurable() {},
    async resume() {
      if (terminal) return;
      manager = typeof client.liveStreamManager === 'function'
        ? client.liveStreamManager(connectionId)
        : null;
      custodyPaused = false;
      for (const store of stores.values()) startStore(store);
      for (const room of rooms.values()) startRoom(room);
    },
  };
  const unregisterBarrier = client.registerAuthBarrierParticipant(barrierParticipant);

  const registry = Object.freeze({
    descriptor(reference, args, groupBoot = null, preparedEntryName = null) {
      const preparedEntry = preparedEntryName === null
        ? null
        : preparedGroup?.entries.find((entry) => entry.name === preparedEntryName) ?? null;
      const admitted = admittedReactReference(
        binding,
        reference,
        preparedEntry?.readOnlySnapshot == null ? 'LiveQuery' : ['Query', 'LiveQuery'],
      );
      const resultContract = preparedReactResultContract(binding, admitted);
      if (args === skip) return Object.freeze({
        skipped: true,
        reference: admitted,
        args,
        key: null,
        resultContract,
        groupBoot,
        preparedEntryName,
        readOnlySnapshot: preparedEntry?.readOnlySnapshot ?? null,
        bootDelivery: preparedEntry?.bootDelivery ?? null,
      });
      const key = canonicalReactStoreKeyV1(providerInstanceId, admitted, args);
      return Object.freeze({
        skipped: false,
        reference: admitted,
        args,
        key,
        resultContract,
        groupBoot,
        preparedEntryName,
        readOnlySnapshot: preparedEntry?.readOnlySnapshot ?? null,
        bootDelivery: preparedEntry?.bootDelivery ?? null,
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
    get connectionId() { return connectionId; },
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
        preparedGroupSource: preparedGroup?.source ?? null,
        preparedGroupReason: preparedGroup?.reason ?? null,
        preparedGroupBoot: preparedGroup?.boot ?? null,
      });
    },
    async dispose() {
      if (terminal) return;
      terminal = true;
      custodyPaused = true;
      const ownsUnadoptedRegisteredOwner = preparedGroup?.connectionId === connectionId
        && (
          preparedRegistrations.size > 0
          || unadoptedPreparedSubscriptions.size > 0
        );
      const pendingAttachDeadline = preparedGroup?.boot?.attachDeadline ?? null;
      const pendingRegisteredRetirement = retireUnadoptedPreparedSubscriptions();
      for (const lease of [...leases]) releaseLease(lease);
      for (const token of [...roomLeases]) releasePresenceToken(token);
      for (const store of stores.values()) stopStore(store, { blank: true });
      for (const room of rooms.values()) stopRoom(room);
      await Promise.allSettled([
        ...[...allHandles].map((handle) => handle.settled()),
        ...[...rooms.values()].map((room) => room.cleanup),
        ...(registeredRecovery === null ? [] : [registeredRecovery]),
        pendingRegisteredRetirement,
      ]);
      // @ref LLP 0114#closed-connection-and-cancellation-protocol — adopted
      // and ordinary children retire through their own handle refcounts before
      // the provider conditionally releases its grant-owned connection. A
      // sibling's remaining socket demand keeps the shared connection live.
      const connectionStillShared = (
        manager?.inspection?.().socketDemand ?? 0
      ) > 0;
      if (
        !connectionStillShared
        && typeof client.releaseConnection === 'function'
      ) {
        try {
          await client.releaseConnection(connectionId, {
            attachDeadline: ownsUnadoptedRegisteredOwner
              ? pendingAttachDeadline
              : null,
            ifIdle: true,
          });
        } catch (error) {
          recordDiagnostic(error);
        }
      }
      stores.clear();
      preparedRegistrations.clear();
      unadoptedPreparedSubscriptions.clear();
      dirtyPreparedSubscriptions.clear();
      rooms.clear();
      connectionListeners.clear();
      unregisterPreparedFrameGuard();
      try { await unregisterBarrier(); } catch (error) { recordDiagnostic(error); }
    },
  });
  preparedGroupReadersByRegistry.set(registry, () => preparedGroup);
  return registry;
}

export function createSnapbackReactProvider(binding, options = {}) {
  const prepared = assertPreparedReactBinding(binding);
  const providerInstanceId = `provider-${++providerSequence}-${localUniqueLabel()}`;
  const preparedGroup = options.preparedGroup == null
    ? null
    : consumePreparedReactQueryGroup(prepared, options.preparedGroup);
  let registry;
  try {
    registry = createRegistry(prepared, providerInstanceId, {
      ...options,
      ...(preparedGroup === null ? {} : { preparedGroup }),
    });
  } catch (error) {
    if (preparedGroup !== null) void abandonConsumedReactQueryGroup(preparedGroup);
    throw error;
  }
  return Object.freeze({
    kind: 'snapback.react-provider.v1',
    providerInstanceId,
    binding: prepared,
    registry,
    assets: options.assets ?? null,
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
  const suppliedGroup = isPreparedReactQueryGroup(entries) ? entries : null;
  if (suppliedGroup !== null) {
    // Provider construction may deliberately convert a just-expired
    // registered boot into a visible live-recovery group. Consumers keep the
    // original one-shot capability, so descriptor creation must use the
    // provider-owned effective group rather than resurrecting expired rows.
    const providerGroup = preparedGroupForProvider(provider);
    const preparedGroup = providerGroup?.reference?.id === suppliedGroup.reference?.id
      ? providerGroup
      : suppliedGroup;
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
      ...provider.registry.descriptor(
        entry.ref,
        entry.args,
        preparedGroup.boot,
        entry.name,
      ),
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
  const preparedGroup = descriptors.length > 0
    && descriptors.every((descriptor) => descriptor.preparedEntryName !== null)
    ? preparedGroupForProvider(provider)
    : null;
  const boot = preparedGroup !== null
    ? preparedGroup.boot
    : descriptors.length > 0
      && descriptors.every((descriptor) => descriptor.groupBoot !== null)
      && descriptors.every(
        (descriptor) => descriptor.groupBoot === descriptors[0].groupBoot,
      )
      ? descriptors[0].groupBoot
      : null;
  return Object.freeze({
    queries,
    status,
    connection: descriptors.some((descriptor) => descriptor.readOnlySnapshot !== null)
      ? 'idle'
      : weakConnection(active.map((query) => query.connection)),
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

// @ref LLP 0107#replay-safety-affordances — declarative capture-and-set
// projection over the records result shape: one declaration derives an
// idempotent update and a complete-receipt matcher, so the paved toggle
// recipe cannot express the replay hazard or the partial-receipt dip.
export function projectRecordFields(recordId, fields, { idField = '_id' } = {}) {
  if (typeof recordId !== 'string' || recordId.length === 0) {
    throw new TypeError('projectRecordFields requires a non-empty string record id');
  }
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new TypeError('projectRecordFields requires an object of intended field values');
  }
  const names = Object.keys(fields);
  if (names.length === 0) {
    throw new TypeError('projectRecordFields requires at least one intended field');
  }
  for (const name of names) {
    const value = fields[name];
    if (value !== null && !['boolean', 'number', 'string'].includes(typeof value)) {
      throw new TypeError(
        `projectRecordFields field "${name}" must be a primitive intended outcome`,
      );
    }
  }
  const intended = Object.freeze({ ...fields });
  return Object.freeze({
    update: (rows) => {
      if (!Array.isArray(rows)) {
        throw new TypeError('projectRecordFields projects over a records query result');
      }
      return rows.map((row) => (row?.[idField] === recordId ? { ...row, ...intended } : row));
    },
    isAuthoritative: (rows, receipt) => Array.isArray(rows) && rows.some((row) => {
      if (row?.[idField] !== recordId) return false;
      return names.every((name) => {
        const expected = receipt !== null && typeof receipt === 'object' && name in receipt
          ? receipt[name]
          : intended[name];
        return row[name] === expected;
      });
    }),
  });
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

// ---------------------------------------------------------------------------
// Outbox (LLP 0043 M2 queue on the JS arm — LLP 0129 Phase 0). The React
// projection of the headless client's OWN facts: `outboxStatus()` counts and
// the `subscribeOutbox` seam. The hook surfaces queued/failed/replaying
// state; it never derives an overlay, reorders replay, or claims settlement
// — LLP 0090 D3's full-resync-before-replay ordering stays entirely the
// headless client's.

const OUTBOX_LOADING = Object.freeze({
  status: 'loading',
  supported: false,
  pending: 0,
  failed: 0,
  replaying: false,
});

const outboxStores = new WeakMap();

function outboxStoreFor(provider) {
  let store = outboxStores.get(provider);
  if (store) return store;
  const client = preparedReactBindingClient(provider.binding);
  if (
    typeof client.outboxStatus !== 'function'
    || typeof client.subscribeOutbox !== 'function'
    || typeof client.replayQueuedMutations !== 'function'
  ) {
    // Capability honesty (LLP 0114): a client without the projection seam
    // refuses — reporting `supported: false` for a client whose queue state
    // is merely unreadable would be a false claim.
    throw diagnosticError(
      'SNAPBACK_REACT_OUTBOX_UNSUPPORTED',
      'the bound client does not expose the outbox projection surface',
    );
  }
  const listeners = new Set();
  let snapshot = OUTBOX_LOADING;
  let refreshing = false;
  let dirty = false;
  let clientOff = null;
  const notify = () => {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observational */ }
    }
  };
  const refresh = () => {
    if (refreshing) {
      dirty = true;
      return;
    }
    refreshing = true;
    void client.outboxStatus().then((status) => {
      snapshot = Object.freeze({ status: 'ready', ...status });
      notify();
    }).catch(() => { /* the durable store stays the authority */ }).finally(() => {
      refreshing = false;
      if (dirty) {
        dirty = false;
        refresh();
      }
    });
  };
  store = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      if (clientOff === null) {
        clientOff = client.subscribeOutbox(refresh);
        refresh();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && clientOff !== null) {
          clientOff();
          clientOff = null;
        }
      };
    },
    async replay() {
      const outcome = await client.replayQueuedMutations();
      refresh();
      return outcome;
    },
  };
  outboxStores.set(provider, store);
  return store;
}

export function useSnapbackOutbox() {
  const provider = useProvider();
  const store = useMemo(() => outboxStoreFor(provider), [provider]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return useMemo(
    () => Object.freeze({ ...state, replay: store.replay }),
    [state, store],
  );
}

/// Framework-neutral outbox observer (the observeSnapbackQueries pattern):
/// acceptance adapters read the exact same projection the hook renders.
export function observeSnapbackOutbox(providerValue, listener) {
  const provider = assertProvider(providerValue);
  const store = outboxStoreFor(provider);
  let closed = false;
  const off = store.subscribe(() => {
    if (!closed) listener(store.getSnapshot());
  });
  listener(store.getSnapshot());
  return Object.freeze({
    snapshot: () => store.getSnapshot(),
    replay: () => store.replay(),
    dispose() {
      if (closed) return;
      closed = true;
      off();
    },
  });
}

// ---------------------------------------------------------------------------
// Assets (LLP 0044 §Client upload surface — the React projection over the
// framework-neutral asset client; LLP 0107 optimistic lifecycle).
//
// The hooks below own no transport, cache, or auth of their own: every byte
// and every decision rides the headless `SnapbackAssetClient`, and authority
// replacement blanks through the same barrier-participant contract the query
// registry uses. Late task events after a blank are generation-fenced.

const BLANKED_UPLOAD = Object.freeze({
  assetId: null,
  assetRef: null,
  attemptId: null,
  attemptExpiresAtMs: null,
  status: 'blanked',
  diagnostic: null,
  bytesTransferred: 0,
  totalBytes: 0,
  previewUrl: null,
  integrityBasis: null,
});
const IDLE_UPLOAD = Object.freeze({ ...BLANKED_UPLOAD, status: 'idle' });

const assetRegistries = new WeakMap();

function assetRegistryFor(provider) {
  let registry = assetRegistries.get(provider);
  if (registry) return registry;
  const client = preparedReactBindingClient(provider.binding);
  const assets = provider.assets ?? createAssetClient(client);
  const stores = new Set();
  let generation = 0;
  const participant = {
    name: `snapback-react-assets:${provider.providerInstanceId}`,
    async quiesce() {},
    blank() {
      generation += 1;
      for (const store of [...stores]) store._blank();
    },
    clearMemory() {},
    async commitDurable() {},
    async resume() {},
  };
  const unregister = typeof client.registerAuthBarrierParticipant === 'function'
    ? client.registerAuthBarrierParticipant(participant)
    : () => {};
  registry = {
    assets,
    stores,
    get generation() { return generation; },
    dispose: unregister,
  };
  assetRegistries.set(provider, registry);
  return registry;
}

function createAssetUploadStore(registry, upload) {
  const listeners = new Set();
  let snapshot = IDLE_UPLOAD;
  let task = null;
  let taskOff = null;
  let boundGeneration = registry.generation;
  const publish = (next) => {
    snapshot = next;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observational */ }
    }
  };
  const detach = () => {
    taskOff?.();
    taskOff = null;
    task = null;
  };
  const adopt = (nextTask) => {
    detach();
    task = nextTask;
    boundGeneration = registry.generation;
    const bound = task;
    const boundAt = boundGeneration;
    taskOff = task.subscribe((taskSnapshot) => {
      // Generation fence: an authority change orphans in-flight tasks; their
      // late events must not repopulate a blanked surface.
      if (task !== bound || boundAt !== registry.generation) return;
      publish(taskSnapshot);
    });
  };
  const store = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start(file, options = {}) {
      const nextTask = registry.assets.start({ upload, file, ...options });
      adopt(nextTask);
      return nextTask;
    },
    resumePersisted(options) {
      const nextTask = registry.assets.resumePersisted(options);
      if (nextTask !== null) adopt(nextTask);
      return nextTask;
    },
    pause: () => task?.pause(),
    resume: () => task?.resume(),
    cancel: (options) => task?.cancel(options) ?? Promise.resolve(snapshot),
    async retry() {
      if (!task) return null;
      const successor = await task.retry();
      adopt(successor);
      publish(successor.snapshot());
      return successor;
    },
    _blank() {
      detach();
      publish(BLANKED_UPLOAD);
    },
    release() {
      registry.stores.delete(store);
      detach();
      listeners.clear();
    },
  };
  registry.stores.add(store);
  return store;
}

export function useSnapbackAssetUpload(options) {
  const provider = useProvider();
  if (!options || typeof options !== 'object' || !options.upload) {
    throw new TypeError('useSnapbackAssetUpload requires a generated upload reference');
  }
  const registry = assetRegistryFor(provider);
  const storeRef = useRef(null);
  if (storeRef.current === null) {
    storeRef.current = createAssetUploadStore(registry, options.upload);
  }
  const store = storeRef.current;
  useEffect(() => () => store.release(), [store]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return useMemo(() => Object.freeze({
    state,
    start: store.start,
    resumePersisted: store.resumePersisted,
    pause: store.pause,
    resume: store.resume,
    cancel: store.cancel,
    retry: store.retry,
  }), [state, store]);
}

const ASSET_IMAGE_IDLE = Object.freeze({
  phase: 'empty',
  src: null,
  aspectRatio: null,
  record: null,
});

/**
 * The renderer ladder as a headless hook (Expo-ready — no DOM API in this
 * path): local preview → ThumbHash placeholder → best delivered rendition.
 * Readiness arrives over the reserved record projection with no polling
 * where the client supports the frame lane.
 */
export function useSnapbackAssetImage({
  assetId = null,
  placeholder = null,
  previewUrl = null,
  maxWidth = 512,
  userId = null,
} = {}) {
  const provider = useProvider();
  const registry = assetRegistryFor(provider);
  const watchRef = useRef(null);
  const [watchTick, setWatchTick] = React.useState(0);
  useEffect(() => {
    watchRef.current?.dispose();
    watchRef.current = null;
    if (assetId !== null && typeof registry.assets.watchStore === 'function') {
      const watch = registry.assets.watchStore(assetId, { userId });
      watchRef.current = watch;
      const off = watch.subscribe(() => setWatchTick((tick) => tick + 1));
      return () => {
        off();
        watch.dispose();
        if (watchRef.current === watch) watchRef.current = null;
      };
    }
    return undefined;
  }, [registry, assetId, userId]);
  return useMemo(() => {
    void watchTick;
    const record = watchRef.current?.getSnapshot() ?? null;
    // The server-provided placeholder (the record view's media block) wins
    // over the prop, which stays as the fallback for pre-establishment
    // renders and older servers.
    const media = record?.record?.media ?? null;
    const serverPlaceholder =
      media?.placeholder?.algo === 'thumbhash.v1'
        && typeof media.placeholder.value === 'string'
        ? media.placeholder.value
        : null;
    const effectivePlaceholder = serverPlaceholder ?? placeholder;
    const placeholderState = (recordForPhase) => {
      try {
        const bytes = Uint8Array.from(
          typeof atob === 'function'
            ? atob(effectivePlaceholder).split('').map((char) => char.charCodeAt(0))
            : Buffer.from(effectivePlaceholder, 'base64'),
        );
        return {
          src: placeholderToDataURL(effectivePlaceholder),
          aspectRatio: thumbHashToApproximateAspectRatio(bytes),
          record: recordForPhase,
        };
      } catch {
        return null;
      }
    };
    const ready = record?.status === 'ready'
      && (record.record?.availability ?? 'ready') === 'ready';
    const blanked = record?.status === 'blank';
    if (ready && assetId !== null && !blanked) {
      const underlay = effectivePlaceholder !== null
        ? placeholderState(record.record)
        : null;
      return Object.freeze({
        phase: 'rendition',
        src: registry.assets.deliveryUrl(assetId, { maxWidth }),
        aspectRatio: underlay?.aspectRatio ?? null,
        placeholderSrc: underlay?.src ?? null,
        record: record.record,
      });
    }
    if (blanked) return ASSET_IMAGE_IDLE;
    if (previewUrl !== null) {
      return Object.freeze({
        phase: 'preview', src: previewUrl, aspectRatio: null, record: null,
      });
    }
    if (effectivePlaceholder !== null) {
      const state = placeholderState(null);
      if (state === null) return ASSET_IMAGE_IDLE;
      return Object.freeze({ phase: 'placeholder', ...state });
    }
    return ASSET_IMAGE_IDLE;
  }, [registry, assetId, placeholder, previewUrl, maxWidth, watchTick]);
}

/**
 * Web convenience component over the headless ladder (`img` is DOM-only;
 * React Native consumers use `useSnapbackAssetImage` with their own
 * `Image`).
 */
export function SnapbackAssetImage({
  assetId = null,
  placeholder = null,
  previewUrl = null,
  maxWidth = 512,
  userId = null,
  alt = '',
  ...rest
}) {
  const image = useSnapbackAssetImage({ assetId, placeholder, previewUrl, maxWidth, userId });
  if (image.src === null) return null;
  return React.createElement('img', {
    src: image.src,
    alt,
    'data-snapback-asset-phase': image.phase,
    ...rest,
  });
}
