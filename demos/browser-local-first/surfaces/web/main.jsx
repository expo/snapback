import React, { useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { SnapbackClient } from '@expo/snapback-client';
import {
  RQS_STORE_DATABASE_NAME,
  rqsEntryKey,
} from '@expo/snapback-client/rqs-store';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
  invokeSnapbackMutation,
  useSnapbackOutbox,
  useSnapbackQuery,
} from '@expo/snapback-react';
import { snapbackBasePath } from 'virtual:snapback/dev';

import { canonicalTodoJson, canonicalizeTodos } from '../../shared/canonicalize.mjs';

const LIST_ID = 'witness';
const LIST_ARGS = Object.freeze({ listId: LIST_ID });
const FEED_ARGS = Object.freeze({ listId: LIST_ID });
const serverMode = new URLSearchParams(location.search).get('serverMode') === 'sessions'
  ? 'sessions'
  : 'dev-custody';
// The sessions phase binds against the sessions-mode backend variant (same
// functions, sessions auth mode in the schema — see ../../snapback-sessions/).
const generated = serverMode === 'sessions'
  ? {
      api: (await import('../../snapback-sessions/generated/api.mjs')).default,
      capabilityManifest:
        (await import('../../snapback-sessions/generated/capability.manifest.json')).default,
      functions: (await import('../../snapback-sessions/generated/functions.manifest.json')).default,
      schema: (await import('../../snapback-sessions/generated/schema.manifest.json')).default,
    }
  : {
      api: (await import('../../snapback/generated/api.mjs')).default,
      capabilityManifest:
        (await import('../../snapback/generated/capability.manifest.json')).default,
      functions: (await import('../../snapback/generated/functions.manifest.json')).default,
      schema: (await import('../../snapback/generated/schema.manifest.json')).default,
    };
const { api, capabilityManifest, functions, schema } = generated;
const documentId = crypto.randomUUID();
const RENDER_PHASE_CEILING = 50;
const counters = { appRenders: 0, rowRenders: 0, rowEffects: 0, queryEffects: 0 };
const phaseCounters = [];
const timeline = [];
const handles = new Map();
let client = null;
let provider = null;
let latestSurface = null;
let recordedDiagnosticCount = 0;
let outboxObservation = Promise.resolve();

const functionName = (ref) => ref?.name ?? ref?.functionName ?? ref?.function ?? 'unknown';
const recordEvent = (kind, details = {}) => {
  const event = Object.freeze({
    ordinal: timeline.length + 1,
    atMonotonicMs: performance.now(),
    kind,
    ...details,
  });
  timeline.push(event);
  return event;
};
const exactHandle = (name) => handles.get(name)?.current ?? null;

function handleFacts(name) {
  const handle = exactHandle(name);
  return handle === null ? null : {
    subscriptionId: handle.subscriptionId,
    version: handle.version,
    freshness: handle.freshness,
    answerClass: handle.answerClass,
    connection: handle.connection,
    retention: handle.retention,
    pendingIntentsAtSeed: handle.pendingIntentsAtSeed,
    resumeHeld: Boolean(handle.rqsResume),
  };
}

function instrumentClient(instance) {
  const original = instance.startLiveQuery.bind(instance);
  instance.startLiveQuery = (ref, options = {}) => {
    const name = functionName(ref);
    const callerUpdate = options.onUpdate;
    const callerConnection = options.onConnectionChange;
    const starter = original(ref, {
      ...options,
      onUpdate(rows, detail) {
        recordEvent('query-update', {
          name,
          detailKind: detail?.kind ?? null,
          detailFreshness: detail?.freshness ?? null,
          rows: Array.isArray(rows) ? rows.length : null,
          handle: handleFacts(name),
        });
        callerUpdate?.(rows, detail);
      },
      onConnectionChange(connection, detail) {
        recordEvent('query-connection', {
          name,
          connection,
          previous: detail?.previous ?? null,
          errorCode: detail?.error?.code ?? detail?.error?.diagnostic?.code ?? null,
          handle: handleFacts(name),
        });
        callerConnection?.(connection, detail);
      },
    });
    handles.set(name, starter);
    void starter.started().then(() => {
      recordEvent('query-started', { name, handle: handleFacts(name) });
    }, (error) => recordEvent('query-start-failed', {
      name,
      code: error?.code ?? error?.diagnostic?.code ?? null,
      message: error?.message ?? String(error),
    }));
    return starter;
  };
}

function useStableCanonicalTodos(rows) {
  return useMemo(() => Object.freeze(canonicalizeTodos(rows)), [rows]);
}

function Rows({ query, rows }) {
  counters.rowRenders += 1;
  useEffect(() => {
    counters.rowEffects += 1;
  }, [rows]);
  const handle = exactHandle('todosFeed');
  return (
    <section
      id="todo-surface"
      data-status={query.status}
      data-freshness={query.freshness ?? 'none'}
      data-answer-class={handle?.answerClass ?? 'unknown'}
      data-connection={query.connection}
      data-version={String(handle?.version ?? 0)}
      data-pending-intents-at-seed={String(handle?.pendingIntentsAtSeed ?? 0)}
      data-row-count={String(rows.length)}
      data-retainable={String(query.retention?.retainable ?? 'unknown')}
      data-retention-code={query.retention?.code ?? 'none'}
      data-handle-retainable={String(handle?.retention?.retainable ?? 'unknown')}
      data-handle-retention-code={handle?.retention?.code ?? 'none'}
    >
      <h1>Browser local-first witness</h1>
      <ol id="todo-rows">
        {rows.map((row) => (
          <li
            key={row._id}
            data-todo-id={row._id}
            data-done={String(row.done)}
            data-note={row.note === null ? 'null' : 'value'}
          >
            <span>{row.title}</span>
            <span>{row.note ?? '∅'}</span>
          </li>
        ))}
      </ol>
      <output id="canonical-rows">{canonicalTodoJson(rows)}</output>
    </section>
  );
}

function WitnessApp() {
  counters.appRenders += 1;
  const todos = useSnapbackQuery(api.todosFeed, LIST_ARGS);
  const mine = useSnapbackQuery(api.protectedTodosFeed, FEED_ARGS);
  const outbox = useSnapbackOutbox();
  const canonicalRows = useStableCanonicalTodos(todos.data);
  const retainedHandle = exactHandle('todosFeed');
  const protectedHandle = exactHandle('protectedTodosFeed');

  latestSurface = { canonicalRows, todos, mine, outbox };
  useEffect(() => {
    counters.queryEffects += 1;
    recordEvent('react-query-state', {
      freshness: todos.freshness ?? null,
      answerClass: retainedHandle?.answerClass ?? null,
      version: retainedHandle?.version ?? null,
      connection: todos.connection,
      pending: outbox.pending,
    });
  }, [
    canonicalRows,
    todos.freshness,
    todos.connection,
    outbox.pending,
    retainedHandle?.answerClass,
    retainedHandle?.version,
  ]);

  return (
    <div data-boot="ready">
      <Rows query={todos} rows={canonicalRows} />
      <section
        id="protected-retention"
        data-retainable={String(mine.retention?.retainable ?? 'unknown')}
        data-retention-code={mine.retention?.code ?? 'pending'}
        data-handle-retainable={String(protectedHandle?.retention?.retainable ?? 'unknown')}
        data-handle-retention-code={protectedHandle?.retention?.code ?? 'pending'}
        data-answer-class={protectedHandle?.answerClass ?? 'unknown'}
      >
        {mine.retention?.code ?? 'pending'}
      </section>
      <section
        id="outbox"
        data-supported={String(outbox.supported)}
        data-pending={String(outbox.pending)}
        data-failed={String(outbox.failed)}
        data-replaying={String(outbox.replaying)}
      >
        pending={outbox.pending}; failed={outbox.failed}
      </section>
      <section
        id="render-stability"
        data-app-renders={String(counters.appRenders)}
        data-row-renders={String(counters.rowRenders)}
        data-row-effects={String(counters.rowEffects)}
        data-query-effects={String(counters.queryEffects)}
        data-phase-ceiling={String(RENDER_PHASE_CEILING)}
      />
    </div>
  );
}

const request = (value) => new Promise((resolveRequest, rejectRequest) => {
  value.onsuccess = () => resolveRequest(value.result);
  value.onerror = () => rejectRequest(value.error ?? new Error('IndexedDB request failed'));
});

async function inspectIndexedDb() {
  const retainedKey = rqsEntryKey('todosFeed', LIST_ARGS);
  const protectedKey = rqsEntryKey('protectedTodosFeed', FEED_ARGS);
  const [retainedEntry, protectedEntry, inspection] = await Promise.all([
    client.rqsStore?.load?.(retainedKey) ?? null,
    client.rqsStore?.load?.(protectedKey) ?? null,
    client.rqsStore?.inspection?.() ?? null,
  ]);
  const db = await request(indexedDB.open(RQS_STORE_DATABASE_NAME));
  try {
    const storeNames = [...db.objectStoreNames];
    const tx = db.transaction(storeNames, 'readonly');
    const stores = {};
    for (const storeName of storeNames) {
      const store = tx.objectStore(storeName);
      const keys = await request(store.getAllKeys());
      stores[storeName] = keys.map((key) => String(key));
    }
    return {
      databaseName: RQS_STORE_DATABASE_NAME,
      version: db.version,
      stores,
      inspection,
      retainedKey,
      protectedKey,
      retainedEntryPresent: retainedEntry !== null,
      protectedEntryPresent: protectedEntry !== null,
      retainedEntry: retainedEntry === null ? null : {
        version: retainedEntry.meta?.version ?? null,
        generation: retainedEntry.meta?.generation ?? null,
        queryArtifact: retainedEntry.meta?.queryArtifact ?? null,
        rows: canonicalizeTodos(retainedEntry.rows),
        inProgress: retainedEntry.inProgress ?? null,
      },
    };
  } finally {
    db.close();
  }
}

async function storageFacts() {
  const [persisted, estimate, meta] = await Promise.all([
    navigator.storage?.persisted?.() ?? null,
    navigator.storage?.estimate?.() ?? null,
    client.rqsStore?.readStoreMeta?.() ?? null,
  ]);
  return {
    indexedDb: typeof indexedDB?.open === 'function',
    webLocks: typeof navigator.locks?.request === 'function',
    store: client.rqsStoreInfo,
    durability: client.rqsStore?.durability?.() ?? null,
    writer: client.rqsStore?.isWriter?.() ?? null,
    persisted,
    estimate,
    clientStoreId: meta?.clientStoreId ?? null,
  };
}

async function state() {
  await outboxObservation;
  const status = await client.outboxStatus();
  const records = await client.rqsStore.outboxRecords();
  return {
    documentId,
    serverMode,
    href: location.href,
    body: document.body.innerText.slice(0, 2_000),
    storageWriter: client.rqsStore?.isWriter?.() === true,
    rows: latestSurface?.canonicalRows ?? [],
    rowJson: canonicalTodoJson(latestSurface?.canonicalRows ?? []),
    handleRows: canonicalizeTodos(exactHandle('todosFeed')?.rows ?? []),
    query: {
      status: latestSurface?.todos.status ?? 'unknown',
      freshness: latestSurface?.todos.freshness ?? null,
      connection: latestSurface?.todos.connection ?? null,
      hookRetention: latestSurface?.todos.retention ?? null,
      ...handleFacts('todosFeed'),
    },
    protectedQuery: {
      status: latestSurface?.mine.status ?? 'unknown',
      hookRetention: latestSurface?.mine.retention ?? null,
      ...handleFacts('protectedTodosFeed'),
    },
    outbox: {
      ...status,
      records: records.map((record) => ({
        clientMutationId: record.clientMutationId ?? record.id,
        sequence: record.sequence,
        function: record.function,
        status: record.status,
        settlement: record.settlement ?? null,
      })),
    },
    counters: { ...counters },
    phaseCounters: structuredClone(phaseCounters),
    timeline: structuredClone(timeline),
    diagnostics: structuredClone(client.outboxDiagnostics),
  };
}

function observeOutbox() {
  outboxObservation = outboxObservation.then(async () => {
    const status = await client.outboxStatus();
    const diagnostics = client.outboxDiagnostics;
    recordEvent('outbox-transition', { ...status });
    for (const diagnostic of diagnostics.slice(recordedDiagnosticCount)) {
      recordEvent('outbox-diagnostic', {
        code: diagnostic.code,
        clientMutationId: diagnostic.clientMutationId ?? null,
        sequence: diagnostic.sequence ?? null,
      });
    }
    recordedDiagnosticCount = diagnostics.length;
  });
}

async function boot() {
  // @ref LLP 0053#negative-deltas-are-obligations-positive-deltas-are-best-effort —
  // authorization-scope delivery is sessions-mode-only; this explicit
  // anonymous offer installs the protocol without a login or lease flow.
  client = new SnapbackClient(snapbackBasePath, serverMode === 'sessions' ? {
    custody: 'anonymous-public',
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    offlineQueue: false,
  } : {});
  instrumentClient(client);
  // The mutation/outbox surface lives in the optional Full-profile
  // store-runtime chunk behind a literal dynamic import. This witness takes
  // the app offline by stopping the module server, so an unwarmed chunk
  // would fail to LOAD (SNAPBACK_STORE_RUNTIME_LOAD_FAILED) instead of
  // queueing — a chunk-availability fact, not the LLP 0043 offline contract
  // under test. Warm it while online, the way a bundled offline-first app's
  // precached chunk graph would be.
  await client.__ensureStoreRuntimeModule();
  recordEvent('store-runtime-warmed', { online: true });
  const binding = await client.prepareReactBinding({
    generatedManifest: { schema, functions, capabilityManifest },
  });
  provider = createSnapbackReactProvider(binding, { connectionId: 'browser-local-first' });
  const outboxUnsubscribe = client.subscribeOutbox(observeOutbox);
  observeOutbox();
  window.addEventListener('pagehide', () => {
    outboxUnsubscribe();
    void provider.dispose();
    void client.closeAuth();
  }, { once: true });
  createRoot(document.getElementById('root')).render(
    <SnapbackProvider provider={provider}>
      <WitnessApp />
    </SnapbackProvider>,
  );
}

const ready = boot().catch((error) => {
  document.getElementById('root').innerHTML = '<pre data-boot="error"></pre>';
  document.querySelector('[data-boot="error"]').textContent = error?.stack ?? String(error);
  throw error;
});

globalThis.snapbackBrowserLocalFirst = Object.freeze({
  ready,
  state,
  storageFacts,
  inspectIndexedDb,
  async flushRetention() {
    await exactHandle('todosFeed')?.flushResumeState?.();
    return inspectIndexedDb();
  },
  markPhase(name) {
    const observation = Object.freeze({
      name,
      documentId,
      ...counters,
      timelineOrdinal: timeline.length,
    });
    phaseCounters.push(observation);
    recordEvent('phase', { name, counters: { ...counters } });
    return observation;
  },
  async queueScenario() {
    // @ref LLP 0218#41-the-dispatch-union-headless-contract — the system
    // witness queues through the React facade and records its resolved union.
    const operations = [];
    operations.push(await invokeSnapbackMutation(provider, api.addTodo, {
      listId: LIST_ID,
      title: 'C queued browser row',
    }));
    for (const done of [true, false, true]) {
      operations.push(await invokeSnapbackMutation(provider, api.toggleTodo, {
        id: 'todo_anchor',
        done,
      }));
    }
    await outboxObservation;
    return operations;
  },
  // Exact duplicate delivery of an already-settled durable record: rebuild
  // the drain's own submission field-for-field from the store (the ledger
  // identity covers the full canonical payload, so a same-id different-
  // payload probe is refused with SNAPBACK_CLIENT_MUTATION_ID_REUSED — that
  // refusal is exactly-once working, not the duplicate case under test).
  async redeliverSettled(clientMutationId) {
    const records = await client.rqsStore.outboxRecords();
    const record = records.find((candidate) => candidate.id === clientMutationId);
    if (!record) throw new Error(`no durable outbox record for ${clientMutationId}`);
    return client.mutate(
      record.expectedGeneration == null
        ? record.function
        : { name: record.function, expectedGeneration: record.expectedGeneration },
      {
        args: record.args,
        userId: record.userId ?? undefined,
        readSet: record.readSet ?? [],
        correlation: record.correlation ?? null,
        clientMutationId: record.id,
        authorityDescriptor: record.authorityDescriptor ?? null,
        ctxLedger: record.ctxLedger ?? null,
        settlementLane: record.settlementLane ?? 'replay-accept',
        settlementIdentity: record.settlementIdentity ?? null,
        settlementClaims: record.settlementClaims ?? null,
        boundedSkew: record.boundedSkew ?? null,
        operationIssuance: record.operationIssuance ?? null,
        operationCoverageDisposition: record.operationCoverageDisposition ?? null,
        optimisticOperation: record.optimisticOperation ?? null,
        queue: false,
      },
    );
  },
  // Diagnostic seam: drive one explicit drain and surface its result (or the
  // fact that the single-flight task never resolves) into the timeline.
  async drainNow(timeoutMs = 10_000) {
    const result = await Promise.race([
      client.replayQueuedMutations().then(
        (value) => ({ resolved: true, value }),
        (error) => ({ resolved: true, rejected: String(error?.stack ?? error) }),
      ),
      new Promise((resolveRace) => setTimeout(
        () => resolveRace({ resolved: false, value: 'drain-task-unresolved' }),
        timeoutMs,
      )),
    ]);
    recordEvent('drain-result', { ...result });
    return result;
  },
  // Bisect which awaited step inside the drain wedges: race each store/client
  // primitive the drain path awaits, individually, with a bounded timeout.
  async drainDebug() {
    const store = client.rqsStore;
    const race = (label, promise, ms = 3000) => Promise.race([
      Promise.resolve(promise).then(
        (value) => ({ label, resolved: true, value: value ?? null }),
        (error) => ({ label, resolved: true, rejected: String(error?.stack ?? error) }),
      ),
      new Promise((resolveRace) => setTimeout(() => resolveRace({ label, resolved: false }), ms)),
    ]);
    const out = [];
    out.push(await race('whenLockSettled', store.whenLockSettled?.()));
    out.push(await race('isWriter', store.isWriter?.()));
    out.push(await race('outboxPending', store.outboxPending?.()));
    const records = await store.outboxRecords();
    const first = records.find((record) => record.status === 'pending') ?? null;
    out.push(await race(
      'prepareSubmission',
      first === null ? 'no-pending' : store.outboxPrepareSubmission(first.id),
    ));
    out.push(await race('readStoreMeta', store.readStoreMeta?.()));
    out.push(await race('inspect', client.inspect()));
    recordEvent('drain-debug', { out });
    return out;
  },
});
