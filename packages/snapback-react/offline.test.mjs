// React offline surface (LLP 0114 freshness axis + LLP 0129 Phase 0 facts;
// sweep finding 0137-a1-f5): the query projection carries the headless
// handle's freshness ('retained' vs 'current') and retainability facts, and
// useSnapbackOutbox projects the client's own queued-intent state. The React
// arm SURFACES client facts — it derives no overlay, reorders no replay, and
// never presents retained rows as settled.
//
// Regression shape: before this surface landed, a retained (persisted)
// delivery was published as an authoritative 'ready' frame with no freshness
// field at all — the assertions on `freshness === 'retained'` and on the
// non-'ready' status fail on that behavior.

import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  createClientDevConsoleReporter,
  createClientDiagnosticsChannel,
} from '../snapback-client/client-diagnostics.mjs';
import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
  invokeSnapbackMutation,
  observeSnapbackOutbox,
  observeSnapbackQueries,
  useSnapbackOutbox,
  useSnapbackQuery,
  useSnapbackSettledMutation,
} from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => new Promise((resolve) => setImmediate(resolve));

const queryResultContract = Object.freeze({
  kind: 'records',
  record: Object.freeze({
    kind: 'object',
    fields: Object.freeze([
      Object.freeze({ name: 'id', required: true, value: { kind: 'string', maxBytes: 1_024 } }),
      Object.freeze({
        name: 'revision',
        required: true,
        value: { kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER },
      }),
    ]),
    allowExtra: false,
  }),
});
const mutationResultContract = Object.freeze({
  kind: 'value',
  value: Object.freeze({ kind: 'string', maxBytes: 1_024 }),
});
const reference = (name, kind, suffix) => {
  const resultContract = kind === 'Mutation' ? mutationResultContract : queryResultContract;
  return Object.freeze({
    artifactKind: 'functionReference',
    schemaVersion: 'snapback.v0',
    appId: 'react-offline-fixture',
    id: `react-offline-fixture:${name}`,
    name,
    kind,
    implementationHash: `sha256:implementation-${suffix}`,
    argsContractHash: `sha256:args-${suffix}`,
    argumentSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { value: { type: 'string' } },
    },
    resultContractHash: resultContractHash(resultContract),
    resultContract,
  });
};
const sites = reference('sites', 'LiveQuery', 'sites');
const record = reference('record', 'Mutation', 'record');
const generatedManifest = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'react-offline-fixture',
  bundleHash: 'sha256:react-offline-fixture-bundle',
  functions: Object.freeze([sites, record]),
});

const RETAINED_ROWS = Object.freeze([
  Object.freeze({ id: 'site-1', revision: 3 }),
  Object.freeze({ id: 'site-2', revision: 5 }),
]);
const CURRENT_ROWS = Object.freeze([
  Object.freeze({ id: 'site-1', revision: 4 }),
  Object.freeze({ id: 'site-2', revision: 5 }),
  Object.freeze({ id: 'site-3', revision: 1 }),
]);
const OFFLINE_RETENTION = Object.freeze({
  retainable: true,
  code: null,
  reason: 'offline boot from verified persisted entry',
  store: Object.freeze({ source: 'default', implementation: 'file', durable: true, reason: null }),
});

function createOfflineFakeClient({ outbox = null } = {}) {
  const liveHandles = [];
  const outboxListeners = new Set();
  let replays = 0;
  const client = {
    authProtocols: { authInvalidation: 1 },
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema: { schemaHash: 'sha256:schema' },
        functions: generatedManifest,
        routeManifestHash: 'sha256:f5f932754bef8663f6097c5e1cb5135cabdb522f19e277a244d4e9646b7cd1c8',
        capabilityManifest: {
          artifactKind: 'capabilityManifest',
          schemaVersion: 'snapback.v0',
          targetProfileId: 'local-dev-sqlite-ibex',
          supportedCapabilities: ['live_subscriptions'],
        },
      };
    },
    async authSession() { return { activeMode: 'dev' }; },
    allocateLiveQueryNamespace(ref) {
      return Object.freeze({
        clientStoreId: 'react-offline-store',
        queryKey: ref.name,
        queryInstanceId: liveHandles.length + 1,
      });
    },
    async disconnect() {},
    liveStreamManager() {
      return {
        close() {},
        inspection() { return { socketDemand: liveHandles.length }; },
      };
    },
    async releaseConnection() { return { released: true, attached: true }; },
    async unsubscribeLive() { return { removed: true }; },
    registerAuthBarrierParticipant() { return async () => {}; },
    registerDurableConsumer() { return () => {}; },
    async mutate(ref, { args }) { return { result: `${ref.name}:${args?.value ?? ''}` }; },
    startLiveQuery(ref, options) {
      // Mirrors the real headless handle's shape during an offline cold
      // boot: `current` is null until the establish settles; the retained
      // seed delivers `{ kind: 'persisted', freshness: 'retained' }`.
      const current = {
        subscriptionId: `sub-${liveHandles.length + 1}`,
        rows: [],
        connection: 'connecting',
        freshness: null,
        retention: null,
        pendingIntentsAtSeed: 0,
      };
      let resolveStarted = () => {};
      const started = new Promise((resolve) => { resolveStarted = resolve; });
      let established = false;
      const handle = {
        function: ref.name,
        get current() { return established ? current : null; },
        started: () => started,
        dispose() {},
        settled: async () => {},
        seedRetained(rows, { pendingIntents = 0 } = {}) {
          current.rows = rows;
          current.freshness = 'retained';
          current.pendingIntentsAtSeed = pendingIntents;
          options.onUpdate?.(rows, {
            version: 1,
            kind: 'persisted',
            freshness: 'retained',
            ...(pendingIntents > 0 ? { pendingIntents } : {}),
          });
        },
        surviveOffline(retention = OFFLINE_RETENTION) {
          current.retention = retention;
          current.connection = 'stale';
          established = true;
          options.onConnectionChange?.('stale');
          resolveStarted();
        },
        emitAuthoritative(rows, retention = current.retention) {
          current.rows = rows;
          current.freshness = 'current';
          current.retention = retention;
          current.connection = 'live';
          established = true;
          options.onUpdate?.(rows, { version: 2, kind: 'live_replace' });
          options.onConnectionChange?.('live');
          resolveStarted();
        },
        emitConnection(connection) {
          current.connection = connection;
          options.onConnectionChange?.(connection);
        },
      };
      liveHandles.push(handle);
      return Object.freeze(handle);
    },
    inspection() { return { liveHandles, replays }; },
  };
  if (outbox !== null) {
    client.outboxStatus = async () => Object.freeze({
      supported: outbox.supported,
      pending: outbox.records.filter((entry) => entry.status === 'pending').length,
      failed: outbox.records.filter((entry) => entry.status === 'failed').length,
      stranded: outbox.records.filter((entry) => entry.status === 'stranded').length,
      quarantined: outbox.records.filter((entry) => entry.status === 'quarantined').length,
      resultGone: outbox.records.filter((entry) => entry.status === 'result-gone').length,
      replaying: false,
      oldestPendingAtMs: outbox.records.some((entry) => entry.status === 'pending') ? 123 : null,
      drainPhase: 'idle',
      lastAttemptAtMs: null,
      nextRetryAtMs: null,
      blockedReason: null,
    });
    client.subscribeOutbox = (listener) => {
      outboxListeners.add(listener);
      return () => outboxListeners.delete(listener);
    };
    client.replayQueuedMutations = async () => {
      replays += 1;
      const replayed = outbox.records.filter((entry) => entry.status === 'pending').length;
      outbox.records = outbox.records.filter((entry) => entry.status !== 'pending');
      for (const listener of [...outboxListeners]) listener();
      const remaining = outbox.records.filter((entry) => entry.status === 'result-gone').length;
      return { replayed, failed: 0, remaining };
    };
    client.mutationStatus = async (clientMutationId) => {
      const found = outbox.records.find((entry) => entry.id === clientMutationId);
      if (found?.status === 'result-gone') {
        return { status: 'resultGone', disposition: 'result-expired', outcome: 'committed' };
      }
      return { status: found?.status ?? 'unknown' };
    };
    client.strandedMutations = async () => outbox.records
      .filter((entry) => entry.status === 'stranded');
    client.discardStrandedMutations = async (ids) => {
      const selected = outbox.records.filter(
        (entry) => entry.status === 'stranded' && ids.includes(entry.id),
      );
      outbox.records = outbox.records.filter((entry) => !selected.includes(entry));
      client.notifyOutbox();
      return { discarded: selected.length, clientMutationIds: selected.map((entry) => entry.id) };
    };
    client.reRecordStrandedMutation = async (id) => `rerecorded-${id}`;
    client.quarantinedMutations = async () => outbox.records
      .filter((entry) => entry.status === 'quarantined');
    client.reenterQuarantinedMutations = async () => {
      const selected = outbox.records.filter((entry) => entry.status === 'quarantined');
      for (const entry of selected) entry.status = 'pending';
      client.notifyOutbox();
      return { reentered: selected.length, clientMutationIds: selected.map((entry) => entry.id) };
    };
    client.acknowledgeResultGoneMutations = async (ids) => {
      const selected = outbox.records.filter(
        (entry) => entry.status === 'result-gone' && ids.includes(entry.id),
      );
      outbox.records = outbox.records.filter((entry) => !selected.includes(entry));
      client.notifyOutbox();
      return { acknowledged: selected.length, clientMutationIds: selected.map((entry) => entry.id) };
    };
    client.notifyOutbox = () => {
      for (const listener of [...outboxListeners]) listener();
    };
  }
  return client;
}

// ---------------------------------------------------------------------------
// 1. Cold offline boot: retained frame renders marked 'retained', never
//    'ready'; the retention fact surfaces once the establish settles; the
//    authoritative answer settles it to 'current'.
// ---------------------------------------------------------------------------
{
  const fake = createOfflineFakeClient();
  const binding = await prepareReactBindingForClient(fake, { generatedManifest });
  const provider = createSnapbackReactProvider(binding, { connectionId: 'offline-a' });
  const states = [];
  const observer = observeSnapbackQueries(
    provider,
    { sites: { ref: sites, args: {} } },
    (state) => states.push(state.queries.sites),
  );
  const [handle] = fake.inspection().liveHandles;
  assert.equal(observer.snapshot().queries.sites.status, 'pending');
  assert.equal(observer.snapshot().queries.sites.freshness, 'unknown');

  handle.seedRetained(RETAINED_ROWS, { pendingIntents: 2 });
  {
    const state = observer.snapshot().queries.sites;
    assert.equal(state.freshness, 'retained', 'retained frame carries the freshness fact');
    assert.equal(state.status, 'refreshing', 'a retained frame is never presented as ready');
    assert.deepEqual(state.data.map((row) => row.id), ['site-1', 'site-2']);
  }

  // Optimistic admission honesty: retained rows are not an authoritative
  // base — the optimistic install still refuses (no fabricated overlay of
  // queued intent over a retained frame).
  await assert.rejects(
    invokeSnapbackMutation(provider, record, { value: 'x' }, {
      optimistic: {
        query: sites,
        args: {},
        update(rows) { return rows; },
      },
    }),
    (error) => error?.code === 'SNAPBACK_REACT_OPTIMISTIC_STORE_MISSING',
  );

  handle.surviveOffline();
  await flush();
  {
    const state = observer.snapshot().queries.sites;
    assert.equal(state.status, 'refreshing');
    assert.equal(state.connection, 'stale', 'offline boot survives at the stale connection axis');
    assert.equal(state.freshness, 'retained');
    assert.equal(state.retention?.retainable, true, 'the retainability fact surfaces on the hook result');
    assert.match(state.retention?.reason ?? '', /offline boot/);
  }

  // A socket that claims 'live' before the authoritative answer must not
  // relabel retained rows as ready.
  handle.emitConnection('live');
  {
    const state = observer.snapshot().queries.sites;
    assert.equal(state.freshness, 'retained');
    assert.equal(state.status, 'refreshing', 'live connection alone never settles a retained frame');
  }

  handle.emitAuthoritative(CURRENT_ROWS);
  await flush();
  {
    const state = observer.snapshot().queries.sites;
    assert.equal(state.freshness, 'current');
    assert.equal(state.status, 'ready');
    assert.equal(state.data.length, 3);
  }
  observer.dispose();
  await provider.dispose();
  assert(states.length >= 3, 'listener observed the retained-to-current transition');
}

// ---------------------------------------------------------------------------
// 2. Refuse-with-clarity retention projection: a non-eligible query's
//    refusal fact rides the ready snapshot unchanged.
// ---------------------------------------------------------------------------
{
  const fake = createOfflineFakeClient();
  const binding = await prepareReactBindingForClient(fake, { generatedManifest });
  const provider = createSnapbackReactProvider(binding, { connectionId: 'offline-b' });
  const observer = observeSnapbackQueries(
    provider,
    { sites: { ref: sites, args: {} } },
    () => {},
  );
  const [handle] = fake.inspection().liveHandles;
  const refusal = Object.freeze({
    retainable: false,
    code: 'SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE',
    reason: 'the server minted no resume token',
    store: Object.freeze({ source: 'default', implementation: 'file', durable: true, reason: null }),
  });
  handle.emitAuthoritative(CURRENT_ROWS, refusal);
  await flush();
  const state = observer.snapshot().queries.sites;
  assert.equal(state.status, 'ready');
  assert.equal(state.freshness, 'current');
  assert.equal(state.retention, refusal, 'the handle refusal fact is surfaced verbatim');
  observer.dispose();
  await provider.dispose();
}

// ---------------------------------------------------------------------------
// 3. useSnapbackQuery renders the same facts through React.
// ---------------------------------------------------------------------------
{
  const fake = createOfflineFakeClient();
  const binding = await prepareReactBindingForClient(fake, { generatedManifest });
  const provider = createSnapbackReactProvider(binding, { connectionId: 'offline-c' });
  let latest = null;
  function Probe() {
    latest = useSnapbackQuery(sites, {});
    return null;
  }
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { provider },
      React.createElement(Probe),
    ));
    await flush();
  });
  const [handle] = fake.inspection().liveHandles;
  await act(async () => {
    handle.seedRetained(RETAINED_ROWS);
    handle.surviveOffline();
    await flush();
  });
  assert.equal(latest.freshness, 'retained');
  assert.equal(latest.status, 'refreshing');
  assert.equal(latest.connection, 'stale');
  assert.equal(latest.retention?.retainable, true);
  await act(async () => {
    handle.emitAuthoritative(CURRENT_ROWS);
    await flush();
  });
  assert.equal(latest.freshness, 'current');
  assert.equal(latest.status, 'ready');
  await act(async () => { renderer.unmount(); });
  await provider.dispose();
}

// ---------------------------------------------------------------------------
// 4. useSnapbackOutbox projects the client's queued-intent facts and drains
//    through the client's own single-flight replay.
// ---------------------------------------------------------------------------
{
  const outbox = {
    supported: true,
    records: [
      { id: 'm1', status: 'pending' },
      { id: 'm2', status: 'pending' },
      { id: 'm3', status: 'failed' },
      { id: 'm4', status: 'result-gone' },
      { id: 'm5', status: 'stranded' },
      { id: 'm6', status: 'quarantined' },
    ],
  };
  const fake = createOfflineFakeClient({ outbox });
  const binding = await prepareReactBindingForClient(fake, { generatedManifest });
  const provider = createSnapbackReactProvider(binding, { connectionId: 'offline-d' });
  let latest = null;
  function OutboxProbe() {
    latest = useSnapbackOutbox();
    return null;
  }
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { provider },
      React.createElement(OutboxProbe),
    ));
    await flush();
  });
  assert.equal(latest.status, 'ready');
  assert.deepEqual(
    {
      supported: latest.supported,
      pending: latest.pending,
      failed: latest.failed,
      stranded: latest.stranded,
      quarantined: latest.quarantined,
      resultGone: latest.resultGone,
    },
    {
      supported: true, pending: 2, failed: 1, stranded: 1, quarantined: 1, resultGone: 1,
    },
  );
  assert.equal(latest.depth, 6);

  // A queue transition on the client pushes through the subscription seam.
  await act(async () => {
    outbox.records.push({ id: 'm7', status: 'pending' });
    fake.notifyOutbox();
    await flush();
  });
  assert.equal(latest.pending, 3);

  assert.equal(latest.depth, 7);
  assert.equal(latest.oldestPendingAtMs, 123);
  assert.equal(latest.drainPhase, 'idle');

  // drainNow() drains through the client's replayQueuedMutations; replay is
  // retained as the deprecated alias.
  let outcome = null;
  await act(async () => {
    outcome = await latest.drainNow();
    await flush();
  });
  assert.equal(outcome.replayed, 3);
  assert.equal(latest.pending, 0);
  assert.equal(latest.failed, 1, 'failed records remain visible client state');
  assert.equal(latest.stranded, 1, 'stranded custody remains visible');
  assert.equal(latest.quarantined, 1, 'quarantined custody remains visible');
  assert.equal(latest.resultGone, 1, 'result-gone remains visible and unreplayed');
  assert.equal(fake.inspection().replays, 1);

  let affordances = null;
  await act(async () => {
    affordances = {
      mutationStatus: await latest.mutationStatus('m4'),
      stranded: await latest.strandedMutations(),
      reRecorded: await latest.reRecordStrandedMutation('m5'),
      quarantined: await latest.quarantinedMutations(),
      discarded: await latest.discardStrandedMutations(['m5']),
      reentered: await latest.reenterQuarantinedMutations(),
      acknowledged: await latest.acknowledgeResultGoneMutations(['m4']),
    };
    await flush();
  });
  assert.equal(affordances.mutationStatus.status, 'resultGone');
  assert.equal(affordances.stranded.length, 1);
  assert.equal(affordances.reRecorded, 'rerecorded-m5');
  assert.equal(affordances.quarantined.length, 1);
  assert.equal(affordances.discarded.discarded, 1);
  assert.equal(affordances.reentered.reentered, 1);
  assert.equal(affordances.acknowledged.acknowledged, 1);
  assert.equal(latest.stranded, 0);
  assert.equal(latest.quarantined, 0);
  assert.equal(latest.resultGone, 0);
  assert.equal(latest.pending, 1, 're-entered quarantine returns to pending');

  const frameworkNeutral = observeSnapbackOutbox(provider, () => {});
  assert.equal(typeof frameworkNeutral.drainNow, 'function');
  assert.equal(typeof frameworkNeutral.replay, 'function');
  assert.equal(typeof frameworkNeutral.acknowledgeResultGoneMutations, 'function');
  await act(async () => {
    await frameworkNeutral.replay();
    await flush();
  });
  frameworkNeutral.dispose();
  await act(async () => { renderer.unmount(); });
  await provider.dispose();
}

// ---------------------------------------------------------------------------
// 5. Capability honesty: a client without the projection seam refuses —
//    it is never reported as an empty queue.
// ---------------------------------------------------------------------------
{
  const fake = createOfflineFakeClient();
  const binding = await prepareReactBindingForClient(fake, { generatedManifest });
  const provider = createSnapbackReactProvider(binding, { connectionId: 'offline-e' });
  assert.throws(
    () => observeSnapbackOutbox(provider, () => {}),
    (error) => error?.code === 'SNAPBACK_REACT_OUTBOX_UNSUPPORTED',
  );
  await provider.dispose();
}

// ---------------------------------------------------------------------------
// 6. Provider-owned P2 drain: auto wakes on online, manual waits for
//    drainNow, Strict Mode never has more than one live controller, and
//    teardown stops it. Carrier eventTarget/timer options pass through.
// ---------------------------------------------------------------------------
{
  class FakeEventTarget {
    listeners = new Map();
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    dispatch(type) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(); }
  }
  const attachDrain = (client) => {
    client.rqsStoreInfo = Object.freeze({
      source: 'injected', implementation: 'fixture', durable: true, reason: null,
    });
    let controller = null;
    let active = 0;
    let maxActive = 0;
    let starts = 0;
    let stops = 0;
    let lastOptions = null;
    client.startOutboxDrain = (options = {}) => {
      if (controller?.status().running === true) return controller;
      starts += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      lastOptions = options;
      let running = true;
      const onOnline = () => {
        if (options.automatic !== false) void handle.drainNow();
      };
      options.eventTarget?.addEventListener('online', onOnline);
      const handle = Object.freeze({
        async drainNow() { return client.replayQueuedMutations(); },
        stop() {
          if (!running) return;
          running = false;
          active -= 1;
          stops += 1;
          options.eventTarget?.removeEventListener('online', onOnline);
        },
        status: () => Object.freeze({
          running,
          automatic: options.automatic !== false,
          drainPhase: 'idle',
          lastAttemptAtMs: null,
          nextRetryAtMs: null,
          blockedReason: null,
        }),
      });
      controller = handle;
      return handle;
    };
    return () => ({ active, maxActive, starts, stops, lastOptions });
  };

  const automaticOutbox = { supported: true, records: [{ id: 'auto-1', status: 'pending' }] };
  const automaticClient = createOfflineFakeClient({ outbox: automaticOutbox });
  const automaticDrain = attachDrain(automaticClient);
  const automaticEvents = new FakeEventTarget();
  const timer = Object.freeze({ now: () => 1 });
  const automaticBinding = await prepareReactBindingForClient(
    automaticClient,
    { generatedManifest },
  );
  const automaticProvider = createSnapbackReactProvider(automaticBinding, {
    connectionId: 'offline-auto-drain',
    outboxDrainOptions: { eventTarget: automaticEvents, timer },
  });
  automaticProvider.start();
  assert.equal(automaticDrain().active, 1);
  assert.equal(automaticDrain().lastOptions.eventTarget, automaticEvents);
  assert.equal(automaticDrain().lastOptions.timer, timer);
  automaticEvents.dispatch('online');
  await flush();
  assert.equal(automaticOutbox.records.some((entry) => entry.status === 'pending'), false);
  await automaticProvider.dispose();
  assert.equal(automaticDrain().active, 0);
  assert.equal(automaticDrain().stops, 1);

  const manualOutbox = { supported: true, records: [{ id: 'manual-1', status: 'pending' }] };
  const manualClient = createOfflineFakeClient({ outbox: manualOutbox });
  attachDrain(manualClient);
  const manualEvents = new FakeEventTarget();
  const manualBinding = await prepareReactBindingForClient(manualClient, { generatedManifest });
  const manualProvider = createSnapbackReactProvider(manualBinding, {
    connectionId: 'offline-manual-drain',
    outboxDrain: 'manual',
    outboxDrainOptions: { eventTarget: manualEvents },
  });
  manualProvider.start();
  manualEvents.dispatch('online');
  await flush();
  assert.equal(manualOutbox.records.some((entry) => entry.status === 'pending'), true);
  const manualObserver = observeSnapbackOutbox(manualProvider, () => {});
  await manualObserver.drainNow();
  assert.equal(manualOutbox.records.some((entry) => entry.status === 'pending'), false);
  manualObserver.dispose();
  await manualProvider.dispose();

  const strictClient = createOfflineFakeClient({ outbox: { supported: true, records: [] } });
  const strictDrain = attachDrain(strictClient);
  const strictEvents = new FakeEventTarget();
  const strictBinding = await prepareReactBindingForClient(strictClient, { generatedManifest });
  let strictRenderer;
  await act(async () => {
    strictRenderer = TestRenderer.create(React.createElement(
      React.StrictMode,
      null,
      React.createElement(SnapbackProvider, {
        binding: strictBinding,
        outboxDrainOptions: { eventTarget: strictEvents },
      }),
    ));
    await flush();
  });
  assert.equal(strictDrain().maxActive, 1);
  assert.equal(strictDrain().active, 1);
  await act(async () => strictRenderer.unmount());
  assert.equal(strictDrain().active, 0);
}

// ---------------------------------------------------------------------------
// 7. Settled-only compatibility is explicit: queue:false preserves the bare
//    validated result and connectivity rejects with the original error.
// ---------------------------------------------------------------------------
{
  const originalConnectivityError = new TypeError('fixture connectivity refused');
  const refusing = createOfflineFakeClient();
  refusing.mutate = async (_reference, options) => {
    assert.equal(options.queue, false);
    throw originalConnectivityError;
  };
  const refusingBinding = await prepareReactBindingForClient(refusing, { generatedManifest });
  const refusingProvider = createSnapbackReactProvider(refusingBinding, {
    connectionId: 'offline-queue-false',
  });
  await assert.rejects(
    invokeSnapbackMutation(
      refusingProvider,
      record,
      { value: 'must-settle' },
      { queue: false },
    ),
    (error) => error === originalConnectivityError,
  );
  await refusingProvider.dispose();

  const settled = createOfflineFakeClient();
  const settledBinding = await prepareReactBindingForClient(settled, { generatedManifest });
  const settledProvider = createSnapbackReactProvider(settledBinding, {
    connectionId: 'offline-settled-hook',
  });
  let runSettled = null;
  function SettledProbe() {
    runSettled = useSnapbackSettledMutation(record);
    return null;
  }
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { provider: settledProvider },
      React.createElement(SettledProbe),
    ));
    await flush();
  });
  assert.equal(await runSettled({ value: 'bare' }), 'record:bare');
  await act(async () => renderer.unmount());
  await settledProvider.dispose();
}

// ---------------------------------------------------------------------------
// 8. A queued hook dispatch resolves LLP 0218's pending union while the
//    canonical client event and React compatibility projection dedup to one
//    dev-console line. The React adapter owns no later wedge timer.
// ---------------------------------------------------------------------------
{
  const priorNodeEnv = process.env.NODE_ENV;
  const originalWarn = console.warn;
  const warnings = [];
  process.env.NODE_ENV = 'development';
  console.warn = (...parts) => warnings.push(parts.join(' '));
  let provider = null;
  let reporter = null;
  let channel = null;
  try {
    const outbox = {
      supported: true,
      records: [{ id: 'different-pending-record', status: 'pending' }],
    };
    const fake = createOfflineFakeClient({ outbox });
    channel = createClientDiagnosticsChannel();
    reporter = createClientDevConsoleReporter(channel);
    fake.diagnosticsChannel = () => channel;
    fake.mutate = async () => {
      channel.emit({
        code: 'SNAPBACK_OFFLINE_MUTATION_QUEUED',
        severity: 'warning',
        subsystem: 'outbox',
        message: 'Offline queue rule: queued is pending, not settled. Drain via useSnapbackOutbox().drainNow(); see guide/sync/offline-and-retention.md#replay-and-settle-without-guessing.',
        details: {
          mutation: 'record',
          clientMutationId: 'queued-record-1',
          sequence: 1,
        },
        site: 'record',
      });
      return {
        status: 'queued',
        clientMutationId: 'queued-record-1',
        sequence: 1,
        presentation: 'withheld',
      };
    };
    const binding = await prepareReactBindingForClient(fake, { generatedManifest });
    provider = createSnapbackReactProvider(binding, {
      connectionId: 'offline-queued-warning',
    });

    const queued = await invokeSnapbackMutation(provider, record, { value: 'offline' });
    assert.deepEqual(queued, {
      status: 'queued',
      clientMutationId: 'queued-record-1',
      sequence: 1,
      presentation: 'withheld',
    });
    assert.equal(warnings.length, 1, 'the canonical/compatibility pair prints once');
    assert.match(warnings[0], /SNAPBACK_OFFLINE_MUTATION_QUEUED/);
    assert.match(warnings[0], /Mutation: record/);
    assert.deepEqual(
      channel.snapshot().events.map((event) => event.code).sort(),
      ['SNAPBACK_OFFLINE_MUTATION_QUEUED', 'SNAPBACK_REACT_MUTATION_QUEUED'],
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(warnings.length, 1, 'React schedules no compatibility wedge timer');
  } finally {
    if (provider !== null) await provider.dispose();
    reporter?.dispose();
    channel?.dispose();
    console.warn = originalWarn;
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
  }
}

console.log('offline.test.mjs: retained freshness, retention facts, outbox projection, and capability refusal pass');
