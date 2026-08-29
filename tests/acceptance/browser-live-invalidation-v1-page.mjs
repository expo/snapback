// Standards-real browser page for LLP 0317.000 O14 shapes (a)-(c).
//
// Node owns orchestration only. Every client, IndexedDB database, Web Lock,
// managed WebSocket, subscription, mutation, and delivery witness below runs
// inside the Chrome browser context that owns this page.
//
// @ref LLP 0258#d2-one-bootstrap-owner-constructs-the-auth-bearing-application-client
//   — each persona has an explicit storage partition and one app-client owner.
// @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback
//   — the proof uses Chrome's real IndexedDB and Web Locks without a memory
//   substitute.
// @ref LLP 0317.000#design-principles — verdict witnesses retain the original
//   subscription, push-only transport, authoritative frame, and evidence scope.

import { createSnapbackAppClient } from '../../packages/snapback-client/index.mjs';
import app from 'snapback-o14-generated-app';

const params = new URL(globalThis.location.href).searchParams;
const DATABASE_NAME = params.get('database');
const STORAGE_PARTITION = params.get('partition');
const RUN_KEY = params.get('run');
const PAGE_GLOBAL = 'snapbackBrowserLiveInvalidation';
const FAST_STREAM = Object.freeze({
  heartbeatIntervalMs: 500,
  freshnessBudgetMs: 4_000,
  reconnectBaseDelayMs: 100,
  reconnectMaxDelayMs: 400,
});
const AUTHORITATIVE_KINDS = new Set(['live_replace', 'live_delta']);

if (
  typeof DATABASE_NAME !== 'string'
  || !DATABASE_NAME.startsWith('snapback-o14-browser-')
  || DATABASE_NAME.length > 180
  || !['o14-persona-a', 'o14-persona-b'].includes(STORAGE_PARTITION)
  || typeof RUN_KEY !== 'string'
  || RUN_KEY.length === 0
  || RUN_KEY.length > 120
) {
  throw new Error('O14 browser page requires runner-scoped database, partition, and run inputs');
}

const contextNonce = globalThis.crypto.randomUUID();

function summarizeRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    count: list.length,
    ids: list.length <= 16 ? list.map((row) => row?._id ?? row?.id ?? null) : undefined,
  };
}

function authoritativeCarrier(frame) {
  if (AUTHORITATIVE_KINDS.has(frame?.kind)) {
    return {
      subscriptionId: frame.subscription_id ?? null,
      version: frame.version ?? null,
      rows: frame.rows ?? null,
      ops: frame.ops ?? null,
    };
  }
  if (frame?.kind === 'authorization_invalidation' && frame.snapshot) {
    return {
      subscriptionId:
        frame.snapshot.subscription_id ?? frame.snapshot.subscriptionId ?? null,
      version: frame.snapshot.version ?? null,
      rows: frame.snapshot.rows ?? null,
      ops: null,
    };
  }
  return null;
}

function summarizeFrame(frame) {
  const carrier = authoritativeCarrier(frame);
  return {
    kind: frame?.kind ?? null,
    subscriptionId: carrier?.subscriptionId ?? frame?.subscription_id ?? null,
    version: carrier?.version ?? frame?.version ?? null,
    reason: frame?.reason ?? null,
    rows: Array.isArray(carrier?.rows) ? summarizeRows(carrier.rows) : null,
    ops: Array.isArray(carrier?.ops)
      ? carrier.ops.slice(0, 16).map((op) => ({
          op: op?.op ?? null,
          id: op?.id ?? null,
          rowId: op?.row?._id ?? null,
        }))
      : null,
    opCount: Array.isArray(carrier?.ops) ? carrier.ops.length : null,
    authorization: frame?.kind === 'authorization_invalidation'
      ? {
          scopeSubscriptionId:
            frame.obligation?.scopeId?.subscriptionId
            ?? frame.obligation?.scope_id?.subscription_id
            ?? null,
          revision: frame.obligation?.revision ?? null,
          maxDisposition:
            frame.obligation?.maxDisposition ?? frame.obligation?.max_disposition ?? null,
          hasResolution: frame.resolution != null,
          hasSnapshot: frame.snapshot != null,
        }
      : null,
  };
}

function createWitness(client, connectionId) {
  const manager = client.liveStreamManager(connectionId, FAST_STREAM);
  const frames = [];
  const managerStates = [];
  const connectionChanges = [];
  const subscriptionEvents = [];
  const authorizationBoundaries = [];
  const authorizationErrors = [];
  const updates = [];
  const waiters = new Set();

  const poke = () => {
    for (const waiter of [...waiters]) {
      if (!waiter.predicate()) continue;
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  };
  const waitFor = (predicate, label, timeoutMs) => {
    if (predicate()) return Promise.resolve();
    return new Promise((resolveWait, reject) => {
      const waiter = {
        predicate,
        resolve: resolveWait,
        timer: setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`timed out waiting for ${label}`));
        }, timeoutMs),
      };
      waiters.add(waiter);
    });
  };

  const stopFrame = manager.onDurable((frame) => {
    frames.push({ at: Date.now(), frame });
    poke();
  });
  const stopState = manager.onState((managerState, detail = {}) => {
    managerStates.push({
      at: Date.now(),
      state: managerState,
      wasOpen: detail?.wasOpen ?? null,
      error: detail?.error?.message ?? null,
    });
    poke();
  });

  return {
    authorizationBoundaries,
    authorizationErrors,
    connectionChanges,
    connectionId,
    frames,
    manager,
    managerStates,
    subscriptionEvents,
    updates,
    waitFor,
    liveOptions: {
      connectionId,
      transport: 'stream',
      fallbackToPoll: false,
      stream: FAST_STREAM,
      onUpdate(rows, meta = {}) {
        updates.push({
          at: Date.now(),
          kind: meta.kind ?? null,
          version: meta.version ?? null,
          refusal: meta.refusal ?? null,
          rows: summarizeRows(rows),
        });
        poke();
      },
      onConnectionChange(connection, detail = {}) {
        connectionChanges.push({
          at: Date.now(),
          connection,
          previous: detail.previous ?? null,
          error: detail.error?.message ?? null,
        });
        poke();
      },
      onSubscriptionEvent(event) {
        subscriptionEvents.push({ at: Date.now(), ...event });
        poke();
      },
      onAuthorizationBoundary(rows, detail = {}) {
        authorizationBoundaries.push({
          at: Date.now(),
          kind: detail.kind ?? null,
          version: detail.version ?? null,
          disposition: detail.authorization?.kind ?? null,
          refusal: detail.refusal ?? null,
          rows: summarizeRows(rows),
        });
        poke();
      },
      onAuthorizationError(error) {
        authorizationErrors.push({
          at: Date.now(),
          code: error?.diagnostic?.code ?? error?.code ?? null,
          message: error?.message ?? String(error),
        });
        poke();
      },
    },
    async ready(handle) {
      await waitFor(
        () => (
          typeof handle.subscriptionId === 'string'
          && handle.subscriptionId.length > 0
          && handle.connection === 'live'
          && manager.isOpen()
          && subscriptionEvents.some((event) => (
            event.event === 'established'
            && event.subscriptionId === handle.subscriptionId
            && event.transport === 'push'
          ))
        ),
        `push establishment for ${connectionId}`,
        2_500,
      );
    },
    baseline(handle) {
      return Object.freeze({
        subscriptionId: handle.subscriptionId,
        version: handle.version,
        frameIndex: frames.length,
        managerStateIndex: managerStates.length,
        connectionIndex: connectionChanges.length,
        eventIndex: subscriptionEvents.length,
        authorizationBoundaryIndex: authorizationBoundaries.length,
        authorizationErrorIndex: authorizationErrors.length,
        updateIndex: updates.length,
      });
    },
    stop() {
      stopState();
      stopFrame();
      for (const waiter of [...waiters]) {
        clearTimeout(waiter.timer);
        waiter.resolve();
      }
      waiters.clear();
    },
  };
}

function frameResultRows(frame) {
  const carrier = authoritativeCarrier(frame);
  if (Array.isArray(carrier?.rows)) return carrier.rows;
  if (Array.isArray(carrier?.ops)) {
    return carrier.ops.flatMap((op) => (
      op?.row === undefined || op?.row === null ? [] : [op.row]
    ));
  }
  return [];
}

function findOriginalAuthoritativeFrame(witness, baseline, frameRowsMatch) {
  return witness.frames.slice(baseline.frameIndex).find(({ frame }) => {
    const carrier = authoritativeCarrier(frame);
    return carrier?.subscriptionId === baseline.subscriptionId
      && Number.isSafeInteger(carrier.version)
      && carrier.version > baseline.version
      && frameRowsMatch(frameResultRows(frame));
  }) ?? null;
}

async function originalSubscriptionDelivery({
  baseline,
  deadlineMs,
  frameRowsMatch,
  handle,
  label,
  rowsMatch,
  settledAt,
  witness,
}) {
  const matchesFrame = frameRowsMatch ?? rowsMatch;
  const deadlineAt = settledAt + deadlineMs;
  let resultObservedAt = null;
  const qualifiesWithinDeadline = () => {
    const authoritative = findOriginalAuthoritativeFrame(witness, baseline, matchesFrame);
    if (authoritative === null || !rowsMatch(handle.rows)) return false;
    resultObservedAt ??= Date.now();
    return authoritative.at <= deadlineAt && resultObservedAt <= deadlineAt;
  };
  let timeoutError = null;
  try {
    await witness.waitFor(qualifiesWithinDeadline, label, deadlineMs);
  } catch (error) {
    timeoutError = error.message;
  }

  const authoritative = findOriginalAuthoritativeFrame(witness, baseline, matchesFrame);
  if (authoritative !== null && rowsMatch(handle.rows)) resultObservedAt ??= Date.now();
  const events = witness.subscriptionEvents.slice(baseline.eventIndex);
  const managerStates = witness.managerStates.slice(baseline.managerStateIndex);
  const connectionChanges = witness.connectionChanges.slice(baseline.connectionIndex);
  const subscriptionIdUnchanged = handle.subscriptionId === baseline.subscriptionId;
  const resubscribed = events.some((event) => event.event === 'resubscribed');
  const managerStayedOpen = managerStates.every(({ state }) => state === 'open')
    && witness.manager.isOpen();
  const handleStayedLive = connectionChanges.every(({ connection }) => connection === 'live')
    && handle.connection === 'live';
  const resultMatches = rowsMatch(handle.rows);
  const authoritativeFrameWithinDeadline = authoritative !== null
    && authoritative.at <= deadlineAt;
  const resultObservedWithinDeadline = resultObservedAt !== null
    && resultObservedAt <= deadlineAt;
  const strict = timeoutError === null
    && authoritativeFrameWithinDeadline
    && resultObservedWithinDeadline
    && subscriptionIdUnchanged
    && !resubscribed
    && managerStayedOpen
    && handleStayedLive
    && resultMatches;
  const failures = [];
  if (authoritative === null) failures.push('no-authoritative-frame-on-original-subscription');
  if (
    authoritative !== null
    && (!authoritativeFrameWithinDeadline || !resultObservedWithinDeadline)
  ) failures.push('deadline-expired');
  if (!subscriptionIdUnchanged) failures.push('subscription-id-changed');
  if (resubscribed) failures.push('resubscribed-event');
  if (!managerStayedOpen || !handleStayedLive) failures.push('connection-detached');
  if (!resultMatches) failures.push('authoritative-result-stale');
  if (timeoutError !== null && failures.length === 0) failures.push('deadline-expired');

  return {
    delivered: strict,
    failures,
    timeoutError,
    deadlineMs,
    deadlineAt,
    originalSubscriptionId: baseline.subscriptionId,
    finalSubscriptionId: handle.subscriptionId,
    originalVersion: baseline.version,
    finalVersion: handle.version,
    transport: { requested: 'stream', fallbackToPoll: false },
    invariants: {
      subscriptionIdUnchanged,
      resubscribed,
      managerStayedOpen,
      handleStayedLive,
      authoritativeFrameCarriesExpectedResult: authoritative !== null,
      authoritativeFrameWithinDeadline,
      resultObservedWithinDeadline,
      finalResultMatches: resultMatches,
    },
    authoritativeFrame: authoritative ? summarizeFrame(authoritative.frame) : null,
    afterSettlementMs: authoritative === null
      ? null
      : Math.max(0, authoritative.at - settledAt),
    resultObservedAfterSettlementMs: resultObservedAt === null
      ? null
      : Math.max(0, resultObservedAt - settledAt),
    subscriptionEvents: events.map(({ at: _at, ...event }) => event),
    authorizationBoundaries: witness.authorizationBoundaries
      .slice(baseline.authorizationBoundaryIndex),
    authorizationErrors: witness.authorizationErrors.slice(baseline.authorizationErrorIndex),
    managerStates,
    connectionChanges,
    updates: witness.updates.slice(baseline.updateIndex),
    frames: witness.frames
      .slice(baseline.frameIndex)
      .map(({ at: _at, frame }) => summarizeFrame(frame)),
  };
}

function makeBinding() {
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
    capabilities: Object.freeze({
      offered: Object.freeze([...new Set([
        ...app.capabilities.required,
        'auth.passwords',
      ])].sort()),
    }),
    provenance: Object.freeze({
      supervisorGeneration: `o14-browser-${RUN_KEY}`,
      issuedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 60 * 60_000).toISOString(),
    }),
    integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
  });
}

const state = {
  appClient: null,
  bootPromise: null,
  handles: new Map(),
  baselines: new Map(),
};

async function boot() {
  if (state.appClient !== null) return state.appClient;
  if (state.bootPromise !== null) return state.bootPromise;
  state.bootPromise = createSnapbackAppClient({
    app,
    binding: makeBinding(),
    platform: {
      kind: 'browser',
      indexedDB: globalThis.indexedDB,
      lockManager: globalThis.navigator.locks,
      cryptoObject: globalThis.crypto,
      databaseName: DATABASE_NAME,
    },
    storagePartition: STORAGE_PARTITION,
  }).then((projection) => {
    state.appClient = projection;
    return projection;
  });
  return state.bootPromise;
}

function principalFacts(projection) {
  const principal = projection.auth.currentPrincipal();
  const bootstrap = projection.bootstrapState();
  return Object.freeze({
    status: principal?.status ?? null,
    userId: principal?.userId ?? null,
    storagePartition: STORAGE_PARTITION,
    storagePartitionIdentityHash: bootstrap?.custody?.storagePartitionIdentityHash ?? null,
    custodyCarrier: bootstrap?.custody?.carrier ?? null,
  });
}

function matcherFor(expectation) {
  const matchesChild = (child) => (
    child != null
    && (child._id === expectation.childId || child.id === expectation.childId)
    && (expectation.body === undefined || child.body === expectation.body)
    && (expectation.revision === undefined || child.revision === expectation.revision)
  );
  if (expectation.kind === 'nested-child') {
    return (rows) => rows[0]?.children?.some(matchesChild) === true;
  }
  if (expectation.kind === 'child-row') {
    return (rows) => rows.some(matchesChild);
  }
  throw new Error(`unknown O14 delivery expectation ${expectation.kind}`);
}

async function dispose() {
  const cleanups = [];
  for (const { handle, witness } of state.handles.values()) {
    cleanups.push((async () => {
      try {
        await handle.dispose();
      } finally {
        witness.stop();
      }
    })());
  }
  state.handles.clear();
  state.baselines.clear();
  await Promise.all(cleanups);
  const projection = state.appClient;
  state.appClient = null;
  state.bootPromise = null;
  await projection?.dispose();
  return { disposed: true };
}

async function safe(operation) {
  try {
    return Object.freeze({ ok: true, value: await operation() });
  } catch (error) {
    return Object.freeze({
      ok: false,
      code: error?.diagnostic?.code ?? error?.code ?? 'O14_BROWSER_PAGE_OPERATION_FAILED',
      message: String(error?.message ?? error).replace(/sbs_[A-Za-z0-9._~-]+/gu, '[REDACTED]'),
    });
  }
}

const pageApi = Object.freeze({
  ready() {
    return safe(async () => {
      const projection = await boot();
      return principalFacts(projection);
    });
  },
  signUp({ email, password }) {
    return safe(async () => {
      const projection = await boot();
      await projection.auth.signUpWithPassword({ email, password });
      return principalFacts(projection);
    });
  },
  createParent({ name }) {
    return safe(async () => {
      const projection = await boot();
      const mutation = await projection.client.mutate(app.api.mutations.createParent, {
        args: { name },
      });
      return { status: mutation.status, parentId: mutation.result };
    });
  },
  createChild({ parentId, lookupKey, body }) {
    return safe(async () => {
      const projection = await boot();
      const mutation = await projection.client.mutate(app.api.mutations.createChild, {
        args: { parentId, lookupKey, body },
      });
      const settledAt = Date.now();
      const childId = mutation.result;
      return {
        status: mutation.status,
        childId,
        settledAt,
        presentAtSettlement: Object.fromEntries([...state.handles].map(([key, { handle }]) => [
          key,
          handle.rows.some((row) => row?._id === childId || row?.id === childId),
        ])),
      };
    });
  },
  patchChild({ childId, body, revision }) {
    return safe(async () => {
      const projection = await boot();
      const mutation = await projection.client.mutate(app.api.mutations.patchChild, {
        args: { childId, body, revision },
      });
      return { status: mutation.status, settledAt: Date.now() };
    });
  },
  freshChild({ lookupKey }) {
    return safe(async () => {
      const projection = await boot();
      const result = await projection.client.query(app.api.queries.childByKey, {
        args: { lookupKey },
      });
      return { rows: result.rows };
    });
  },
  openSubscriptions({ connectionId, subscriptions }) {
    return safe(async () => {
      const projection = await boot();
      const opened = [];
      for (const { key, functionName, args } of subscriptions) {
        if (state.handles.has(key)) throw new Error(`duplicate subscription key ${key}`);
        const reference = app.api.queries[functionName];
        if (reference === undefined) throw new Error(`unknown generated query ${functionName}`);
        const witness = createWitness(projection.client, connectionId);
        const handle = await projection.client.liveQuery(reference, {
          args,
          ...witness.liveOptions,
        });
        state.handles.set(key, { handle, witness });
        await witness.ready(handle);
        opened.push({
          key,
          functionName,
          subscriptionId: handle.subscriptionId,
          version: handle.version,
          connection: handle.connection,
          rows: summarizeRows(handle.rows),
        });
      }
      return opened;
    });
  },
  captureBaselines({ phase }) {
    return safe(async () => {
      const baselines = {};
      for (const [key, { handle, witness }] of state.handles) {
        baselines[key] = witness.baseline(handle);
      }
      state.baselines.set(phase, baselines);
      return baselines;
    });
  },
  awaitDeliveries({ phase, expectations, settledAt, deadlineMs }) {
    return safe(async () => {
      const baselines = state.baselines.get(phase);
      if (baselines === undefined) throw new Error(`missing baseline phase ${phase}`);
      const entries = await Promise.all(Object.entries(expectations).map(async ([key, expectation]) => {
        const entry = state.handles.get(key);
        if (entry === undefined || baselines[key] === undefined) {
          throw new Error(`missing subscription ${key} for phase ${phase}`);
        }
        const rowsMatch = matcherFor(expectation);
        const delivery = await originalSubscriptionDelivery({
          baseline: baselines[key],
          deadlineMs,
          handle: entry.handle,
          label: `${phase} ${key} original-subscription delivery`,
          rowsMatch,
          settledAt,
          witness: entry.witness,
        });
        return [key, delivery];
      }));
      return Object.fromEntries(entries);
    });
  },
  dispose() {
    return safe(dispose);
  },
  envFacts() {
    return Object.freeze({
      indexedDb: typeof globalThis.indexedDB?.open === 'function',
      webLocks: typeof globalThis.navigator?.locks?.request === 'function',
      userAgent: globalThis.navigator.userAgent,
      platform: globalThis.navigator.platform,
      origin: globalThis.location.origin,
      databaseName: DATABASE_NAME,
      storagePartition: STORAGE_PARTITION,
      contextNonce,
      appId: app.identity.app,
    });
  },
});

Object.defineProperty(globalThis, PAGE_GLOBAL, {
  value: pageApi,
  configurable: false,
  enumerable: true,
  writable: false,
});

void boot().catch(() => {
  // The public API retains the typed construction failure for the runner.
});
