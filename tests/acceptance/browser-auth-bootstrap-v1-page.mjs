// Browser page for the LLP 0258 Phase 1.4 real-browser proof runner.
//
// The page deliberately exposes only public principal/custody facts. Passwords
// enter through method arguments and credential/recovery payloads are discarded
// before a CDP result can serialize them.
//
// @ref LLP 0258#d2-one-bootstrap-owner-constructs-the-auth-bearing-application-client
//   — every projection below uses one exact app/storage-partition owner key.
// @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback
//   — the platform uses the real browser IndexedDB and Web Locks capabilities.
// @ref LLP 0059#transition-barrier — the protected-state probe is a real
//   coordinator participant and makes blank-before-clear observable.

import React, { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { createSnapbackAppClient } from '../../packages/snapback-client/index.mjs';
import app from '../../demos/rbac/snapback/generated/app.mjs';

const params = new URL(globalThis.location.href).searchParams;
const DATABASE_NAME = params.get('database');
const DEFAULT_PARTITION = params.get('partition') ?? 'default';
const CUSTODY_STORE = 'custody';
const LEASE_STORE = 'leases';
const LOCK_NAME = `snapback-auth-custody:${app.identity.app}`;

if (
  typeof DATABASE_NAME !== 'string'
  || !DATABASE_NAME.startsWith('snapback-browser-auth-bootstrap-')
  || DATABASE_NAME.length > 180
) {
  throw new Error('browser auth bootstrap page requires a runner-scoped database name');
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitFor = async (predicate, label, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error(`timed out waiting for ${label}`);
};

const requestResult = (request) => new Promise((resolve, reject) => {
  request.addEventListener('success', () => resolve(request.result), { once: true });
  request.addEventListener('error', () => reject(
    request.error ?? new Error('IndexedDB request failed'),
  ), { once: true });
});

const transactionDone = (transaction) => new Promise((resolve, reject) => {
  transaction.addEventListener('complete', resolve, { once: true });
  transaction.addEventListener('abort', () => reject(
    transaction.error ?? new Error('IndexedDB transaction aborted'),
  ), { once: true });
  transaction.addEventListener('error', () => {}, { once: true });
});

const openDatabase = () => new Promise((resolve, reject) => {
  const request = globalThis.indexedDB.open(DATABASE_NAME, 1);
  request.addEventListener('upgradeneeded', () => {
    if (!request.result.objectStoreNames.contains(CUSTODY_STORE)) {
      request.result.createObjectStore(CUSTODY_STORE);
    }
    if (!request.result.objectStoreNames.contains(LEASE_STORE)) {
      request.result.createObjectStore(LEASE_STORE);
    }
  });
  request.addEventListener('success', () => resolve(request.result), { once: true });
  request.addEventListener('error', () => reject(
    request.error ?? new Error('IndexedDB open failed'),
  ), { once: true });
  request.addEventListener('blocked', () => reject(new Error('IndexedDB open was blocked')), {
    once: true,
  });
});

const publicPrincipal = (principal) => {
  if (!principal || typeof principal !== 'object') return null;
  if (principal.status === 'refreshing') {
    return Object.freeze({
      status: 'refreshing',
      principal: publicPrincipal(principal.principal),
    });
  }
  const fields = [
    'status',
    'userId',
    'sessionId',
    'sessionClass',
    'provider',
    'authorityInstanceId',
    'sessionGeneration',
    'authorizationStreamIncarnation',
    'expiresAt',
    'absoluteExpiresAt',
  ];
  const output = {};
  for (const field of fields) {
    if (Object.hasOwn(principal, field)) output[field] = principal[field];
  }
  if (principal.diagnostic?.code) {
    output.diagnosticCode = principal.diagnostic.code;
  }
  return Object.freeze(output);
};

const publicCapture = (capture) => capture === null ? null : Object.freeze({
  authorityEpoch: capture.authorityEpoch,
  custodyRevision: capture.custodyRevision,
  authorityKey: capture.authorityKey,
});

const publicBootstrap = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (snapshot.status === 'ready') {
    return Object.freeze({
      status: 'ready',
      authoritySource: snapshot.authoritySource,
      custody: Object.freeze({ ...snapshot.custody }),
      advisoryCodes: Object.freeze(
        snapshot.advisories.map(({ diagnostic }) => diagnostic.code),
      ),
    });
  }
  return Object.freeze({
    status: snapshot.status,
    ...(snapshot.stage ? { stage: snapshot.stage } : {}),
    ...(snapshot.diagnostic?.code ? { diagnosticCode: snapshot.diagnostic.code } : {}),
  });
};

const safeError = (error) => Object.freeze({
  ok: false,
  code: error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_BROWSER_AUTH_PAGE_ERROR',
  bootstrap: publicBootstrap(error?.bootstrapState ?? null),
});

const lockMetrics = {
  requests: 0,
  active: 0,
  maxActive: 0,
};

const measuredLockManager = Object.freeze({
  request(name, options, operation) {
    lockMetrics.requests += 1;
    return globalThis.navigator.locks.request(name, options, async (lock) => {
      lockMetrics.active += 1;
      lockMetrics.maxActive = Math.max(lockMetrics.maxActive, lockMetrics.active);
      try {
        return await operation(lock);
      } finally {
        lockMetrics.active -= 1;
      }
    });
  },
});

const makeBinding = () => {
  const now = Date.now();
  return Object.freeze({
    format: 'snapback.app-binding.v1',
    source: 'supervised-dev',
    descriptorIdentity: app.identity.descriptor,
    target: Object.freeze({
      app: app.identity.app,
      schema: app.identity.schema,
      functions: app.identity.functions,
      origin: globalThis.location.origin,
      routing: 'loopback',
    }),
    capabilities: Object.freeze({ offered: Object.freeze(['auth.passwords']) }),
    provenance: Object.freeze({
      supervisorGeneration: 'browser-auth-bootstrap-v1',
      issuedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 3_600_000).toISOString(),
    }),
    integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
  });
};

const optionsFor = (storagePartition = DEFAULT_PARTITION) => ({
  app,
  binding: makeBinding(),
  platform: {
    kind: 'browser',
    indexedDB: globalThis.indexedDB,
    lockManager: measuredLockManager,
    cryptoObject: globalThis.crypto,
    databaseName: DATABASE_NAME,
  },
  storagePartition,
});

const state = {
  appClient: null,
  bootPromise: null,
  lastBootstrap: Object.freeze({ status: 'starting', stage: 'binding' }),
  lastError: null,
  bootstrapEvents: [],
  principalEvents: [],
  barrierEvents: [],
  protectedRows: [],
  optimisticState: [],
  subscriptions: {
    bootstrap: 0,
    principal: 0,
    participant: 0,
  },
  unsubscribeBootstrap: null,
  unsubscribePrincipal: null,
  unregisterParticipant: null,
  lockHold: null,
};

const pushBounded = (target, value, maximum = 80) => {
  target.push(value);
  if (target.length > maximum) target.splice(0, target.length - maximum);
};

const barrierFact = (phase, context) => Object.freeze({
  phase,
  reason: context?.reason ?? null,
  expectedEpoch: context?.expectedEpoch ?? null,
  nextEpoch: context?.nextEpoch ?? null,
  protectedRows: state.protectedRows.length,
  optimisticState: state.optimisticState.length,
});

const installProjectionObservers = (projection) => {
  state.unsubscribeBootstrap = projection.subscribeBootstrap(() => {
    state.lastBootstrap = publicBootstrap(projection.bootstrapState());
    pushBounded(state.bootstrapEvents, state.lastBootstrap);
  });
  state.subscriptions.bootstrap += 1;
  state.unsubscribePrincipal = projection.auth.subscribeCurrentPrincipal(() => {
    pushBounded(state.principalEvents, publicPrincipal(projection.auth.currentPrincipal()));
  });
  state.subscriptions.principal += 1;

  state.unregisterParticipant = projection.client.authCoordinator.registerParticipant({
    name: 'browser-auth-bootstrap-protected-state-probe',
    async quiesce(context) {
      pushBounded(state.barrierEvents, barrierFact('quiesce', context));
    },
    blank(context) {
      state.protectedRows = [];
      pushBounded(state.barrierEvents, barrierFact('blank', context));
    },
    clearMemory(context) {
      state.optimisticState = [];
      pushBounded(state.barrierEvents, barrierFact('clearMemory', context));
    },
    async commitDurable(context) {
      pushBounded(state.barrierEvents, barrierFact('commitDurable', context));
    },
    async resume(context) {
      pushBounded(state.barrierEvents, barrierFact('resume', context));
      context.stagePublication(context.capture, () => {
        pushBounded(state.barrierEvents, barrierFact('stagePublication', context));
      });
    },
  });
  state.subscriptions.participant += 1;
};

async function disposeCurrent() {
  const projection = state.appClient;
  state.appClient = null;
  state.bootPromise = null;
  if (state.unsubscribeBootstrap) {
    state.unsubscribeBootstrap();
    state.unsubscribeBootstrap = null;
    state.subscriptions.bootstrap -= 1;
  }
  if (state.unsubscribePrincipal) {
    state.unsubscribePrincipal();
    state.unsubscribePrincipal = null;
    state.subscriptions.principal -= 1;
  }
  if (state.unregisterParticipant) {
    const unregister = state.unregisterParticipant;
    state.unregisterParticipant = null;
    await unregister();
    state.subscriptions.participant -= 1;
  }
  if (projection) await projection.dispose();
}

async function boot(storagePartition = DEFAULT_PARTITION) {
  if (state.appClient) return state.appClient;
  if (state.bootPromise) return state.bootPromise;
  state.lastError = null;
  state.bootPromise = createSnapbackAppClient(optionsFor(storagePartition))
    .then((projection) => {
      state.appClient = projection;
      state.lastBootstrap = publicBootstrap(projection.bootstrapState());
      installProjectionObservers(projection);
      pushBounded(state.principalEvents, publicPrincipal(projection.auth.currentPrincipal()));
      return projection;
    })
    .catch((error) => {
      state.lastError = safeError(error);
      state.lastBootstrap = publicBootstrap(error?.bootstrapState ?? null);
      state.bootPromise = null;
      throw error;
    });
  return state.bootPromise;
}

const inspectCustody = async () => {
  const database = await openDatabase();
  try {
    if (!database.objectStoreNames.contains(CUSTODY_STORE)) return null;
    const transaction = database.transaction(CUSTODY_STORE, 'readonly');
    const record = await requestResult(
      transaction.objectStore(CUSTODY_STORE).get(app.identity.app),
    );
    await transactionDone(transaction);
    if (record === undefined) return null;
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      return Object.freeze({ shape: 'invalid-nonrecord' });
    }
    return Object.freeze({
      shape: 'record',
      formatVersion: record.formatVersion ?? null,
      phase: record.phase ?? null,
      authorityEpoch: record.authorityEpoch ?? null,
      revision: record.revision ?? null,
      authorityKind: record.authority?.kind ?? null,
      userId: record.authority?.userId ?? null,
      sessionId: record.authority?.sessionId ?? null,
      bearerPresent: typeof record.bearer === 'string' && record.bearer.length > 0,
      pendingAuthorityPresent: record.pendingAuthority !== null && record.pendingAuthority !== undefined,
      pendingBearerPresent: typeof record.pendingBearer === 'string' && record.pendingBearer.length > 0,
    });
  } finally {
    database.close();
  }
};

const currentSnapshot = async () => {
  const projection = state.appClient;
  let capture = null;
  if (projection) {
    try { capture = publicCapture(projection.client.captureAuthority()); } catch { /* blocked */ }
  }
  return Object.freeze({
    bootstrap: state.lastBootstrap,
    principal: projection ? publicPrincipal(projection.auth.currentPrincipal()) : null,
    capture,
    custody: await inspectCustody(),
    protected: Object.freeze({
      rows: state.protectedRows.map((row) => ({ ...row })),
      optimistic: state.optimisticState.map((row) => ({ ...row })),
    }),
    barrierEvents: state.barrierEvents.map((event) => ({ ...event })),
    subscriptions: Object.freeze({ ...state.subscriptions }),
    lockMetrics: Object.freeze({ ...lockMetrics }),
    lastError: state.lastError,
  });
};

const run = async (operation) => {
  try {
    const projection = await boot();
    await operation(projection);
    return Object.freeze({ ok: true, snapshot: await currentSnapshot() });
  } catch (error) {
    return Object.freeze({ ...safeError(error), snapshot: await currentSnapshot() });
  }
};

const seedProtected = async (label) => {
  const projection = await boot();
  const principal = publicPrincipal(projection.auth.currentPrincipal());
  if (principal?.status !== 'authenticated') {
    throw new Error('protected probe seeding requires an authenticated principal');
  }
  state.protectedRows = [Object.freeze({ owner: principal.userId, label })];
  state.optimisticState = [Object.freeze({ owner: principal.userId, label: `${label}-optimistic` })];
  return currentSnapshot();
};

const mutateCustody = async (operation) => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([CUSTODY_STORE, LEASE_STORE], 'readwrite');
    const custody = transaction.objectStore(CUSTODY_STORE);
    const leases = transaction.objectStore(LEASE_STORE);
    await operation(custody, leases);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
};

const corruptCustody = async () => {
  await disposeCurrent();
  await mutateCustody(async (custody) => {
    await requestResult(custody.put('truncated-custody-record', app.identity.app));
  });
  return inspectCustody();
};

const clearCustodyExplicitly = async () => {
  await disposeCurrent();
  await mutateCustody(async (custody, leases) => {
    await Promise.all([
      requestResult(custody.delete(app.identity.app)),
      requestResult(leases.delete(app.identity.app)),
    ]);
  });
  state.lastError = null;
  state.lastBootstrap = Object.freeze({ status: 'starting', stage: 'binding' });
  return inspectCustody();
};

const deleteDatabase = async () => {
  await disposeCurrent();
  await new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.deleteDatabase(DATABASE_NAME);
    request.addEventListener('success', resolve, { once: true });
    request.addEventListener('error', () => reject(
      request.error ?? new Error('IndexedDB deletion failed'),
    ), { once: true });
    request.addEventListener('blocked', () => reject(new Error('IndexedDB deletion was blocked')), {
      once: true,
    });
  });
  return Object.freeze({ databaseDeleted: true });
};

const lockState = async () => {
  const snapshot = await globalThis.navigator.locks.query();
  return Object.freeze({
    held: snapshot.held.filter(({ name }) => name === LOCK_NAME).length,
    pending: snapshot.pending.filter(({ name }) => name === LOCK_NAME).length,
  });
};

const holdCustodyLock = async () => {
  if (state.lockHold !== null) return Object.freeze({ held: true });
  let entered;
  let release;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const releasePromise = new Promise((resolve) => { release = resolve; });
  const completion = globalThis.navigator.locks.request(
    LOCK_NAME,
    { mode: 'exclusive' },
    async () => {
      entered();
      await releasePromise;
    },
  );
  state.lockHold = { completion, release };
  await enteredPromise;
  return Object.freeze({ held: true, state: await lockState() });
};

const releaseCustodyLock = async () => {
  if (state.lockHold === null) return Object.freeze({ released: false });
  const hold = state.lockHold;
  state.lockHold = null;
  hold.release();
  await hold.completion;
  return Object.freeze({ released: true, state: await lockState() });
};

const idForFactory = () => {
  const ids = new WeakMap();
  let next = 1;
  return (value) => {
    if (!ids.has(value)) ids.set(value, next++);
    return ids.get(value);
  };
};

const runStrictModeRemount = async ({ cycles = 3 } = {}) => {
  await disposeCurrent();
  const host = document.createElement('div');
  host.id = 'strict-mode-proof-root';
  document.body.append(host);
  const ownerId = idForFactory();
  const coordinatorId = idForFactory();
  const metrics = {
    cycles,
    effectMounts: 0,
    effectCleanups: 0,
    projectionsCreated: 0,
    projectionsDisposed: 0,
    activeEffects: 0,
    activeProjections: 0,
    activeBootstrapListeners: 0,
    activePrincipalListeners: 0,
    maxConcurrentOwners: 0,
    cycleOwnerIds: [],
    cycleCoordinatorIds: [],
  };
  const activeOwners = new Map();
  const pendingTasks = new Set();
  let cycleReady = null;

  const addPending = (promise) => {
    const tracked = Promise.resolve(promise).finally(() => pendingTasks.delete(tracked));
    pendingTasks.add(tracked);
    return tracked;
  };

  function Probe({ cycle }) {
    useEffect(() => {
      metrics.effectMounts += 1;
      metrics.activeEffects += 1;
      let cleaned = false;
      let projection = null;
      let unsubscribeBootstrap = null;
      let unsubscribePrincipal = null;
      const acquired = createSnapbackAppClient(optionsFor(DEFAULT_PARTITION));
      addPending(acquired.then(async (next) => {
        projection = next;
        metrics.projectionsCreated += 1;
        const clientOwnerId = ownerId(next.client);
        const clientCoordinatorId = coordinatorId(next.client.authCoordinator);
        metrics.cycleOwnerIds[cycle] ??= [];
        metrics.cycleCoordinatorIds[cycle] ??= [];
        metrics.cycleOwnerIds[cycle].push(clientOwnerId);
        metrics.cycleCoordinatorIds[cycle].push(clientCoordinatorId);
        if (cleaned) {
          return;
        }
        metrics.activeProjections += 1;
        activeOwners.set(clientOwnerId, (activeOwners.get(clientOwnerId) ?? 0) + 1);
        metrics.maxConcurrentOwners = Math.max(metrics.maxConcurrentOwners, activeOwners.size);
        unsubscribeBootstrap = next.subscribeBootstrap(() => {});
        metrics.activeBootstrapListeners += 1;
        unsubscribePrincipal = next.auth.subscribeCurrentPrincipal(() => {});
        metrics.activePrincipalListeners += 1;
        cycleReady?.();
      }));

      return () => {
        cleaned = true;
        metrics.effectCleanups += 1;
        metrics.activeEffects -= 1;
        addPending(acquired.then(async (next) => {
          if (unsubscribeBootstrap) {
            unsubscribeBootstrap();
            unsubscribeBootstrap = null;
            metrics.activeBootstrapListeners -= 1;
          }
          if (unsubscribePrincipal) {
            unsubscribePrincipal();
            unsubscribePrincipal = null;
            metrics.activePrincipalListeners -= 1;
          }
          if (projection === next && metrics.activeProjections > 0) {
            metrics.activeProjections -= 1;
            const clientOwnerId = ownerId(next.client);
            const count = activeOwners.get(clientOwnerId) ?? 0;
            if (count <= 1) activeOwners.delete(clientOwnerId);
            else activeOwners.set(clientOwnerId, count - 1);
          }
          await next.dispose();
          metrics.projectionsDisposed += 1;
        }));
      };
    }, [cycle]);
    return React.createElement('output', { 'data-cycle': cycle }, 'mounted');
  }

  try {
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      let resolveReady;
      const ready = new Promise((resolve) => { resolveReady = resolve; });
      cycleReady = resolveReady;
      const root = createRoot(host);
      root.render(React.createElement(StrictMode, null, React.createElement(Probe, { cycle })));
      await ready;
      await waitFor(
        () => metrics.effectMounts >= (cycle + 1) * 2,
        `StrictMode double mount for cycle ${cycle}`,
      );
      root.unmount();
      await waitFor(
        () => metrics.activeEffects === 0 && metrics.activeProjections === 0,
        `StrictMode disposal for cycle ${cycle}`,
      );
      for (;;) {
        const current = [...pendingTasks];
        if (current.length === 0) break;
        await Promise.allSettled(current);
      }
    }
  } finally {
    host.remove();
  }

  metrics.cycleOwnerIds = metrics.cycleOwnerIds.map((values) => [...new Set(values)]);
  metrics.cycleCoordinatorIds = metrics.cycleCoordinatorIds.map((values) => [...new Set(values)]);
  return Object.freeze({
    ...metrics,
    activeOwners: activeOwners.size,
    leakedListeners:
      metrics.activeBootstrapListeners
      + metrics.activePrincipalListeners
      + state.subscriptions.bootstrap
      + state.subscriptions.principal
      + state.subscriptions.participant,
    fastRefreshDriven: false,
  });
};

const pageApi = Object.freeze({
  async ready() {
    try {
      await boot();
      return Object.freeze({ ok: true, snapshot: await currentSnapshot() });
    } catch (error) {
      return Object.freeze({ ...safeError(error), snapshot: await currentSnapshot() });
    }
  },
  snapshot: currentSnapshot,
  signUp({ email, password }) {
    return run((projection) => projection.auth.signUpWithPassword({ email, password }));
  },
  signIn({ email, password }) {
    return run((projection) => projection.auth.signInWithPassword({ email, password }));
  },
  signOut() {
    return run((projection) => projection.auth.signOut());
  },
  refresh() {
    return run((projection) => projection.client.auth.authRefresh());
  },
  switchUser({ email, password }) {
    return run(async (projection) => {
      await projection.auth.signOut();
      await projection.auth.signInWithPassword({ email, password });
    });
  },
  synchronize() {
    return run(async (projection) => {
      await projection.client.authCoordinator.synchronize();
      await projection.client.auth.authSession({ force: true });
    });
  },
  seedProtected({ label }) {
    return seedProtected(label);
  },
  dispose: disposeCurrent,
  inspectCustody,
  corruptCustody,
  clearCustodyExplicitly,
  deleteDatabase,
  lockState,
  holdCustodyLock,
  releaseCustodyLock,
  runStrictModeRemount,
  envFacts() {
    return Object.freeze({
      indexedDb: typeof globalThis.indexedDB?.open === 'function',
      webLocks: typeof globalThis.navigator?.locks?.request === 'function',
      userAgent: globalThis.navigator.userAgent,
      platform: globalThis.navigator.platform,
      navigationType: globalThis.performance.getEntriesByType('navigation')[0]?.type ?? null,
      appId: app.identity.app,
      databaseName: DATABASE_NAME,
    });
  },
});

Object.defineProperty(globalThis, 'snapbackBrowserAuthBootstrap', {
  value: pageApi,
  configurable: false,
  enumerable: true,
  writable: false,
});

void boot().catch(() => {
  // The global API deliberately remains available for typed corruption
  // inspection and explicit recovery after construction refusal.
});
