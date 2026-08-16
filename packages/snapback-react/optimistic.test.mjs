import assert from 'node:assert/strict';

import {
  createClientDevConsoleReporter,
  createClientDiagnosticsChannel,
} from '../snapback-client/client-diagnostics.mjs';
import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import {
  createSnapbackReactProvider,
  invokeSnapbackMutation,
  observeSnapbackQueries,
  projectRecordFields,
} from './index.mjs';

const flush = () => new Promise((resolve) => setImmediate(resolve));

// Capture the dev replay advisory (LLP 0107 replay-safety affordances) so the
// fixtures below can assert exactly when it fires; everything else passes
// through to the real console.
const replayWarnings = [];
const originalConsoleWarn = console.warn;
console.warn = (...parts) => {
  const line = parts.join(' ');
  if (line.includes('SNAPBACK_REACT_OPTIMISTIC_REPLAY_DIVERGENT')) {
    replayWarnings.push(line);
    return;
  }
  originalConsoleWarn(...parts);
};
const replayReporter = (channel) => createClientDevConsoleReporter(channel, {
  console: {
    warn(line) {
      if (line.includes('SNAPBACK_REACT_OPTIMISTIC_REPLAY_DIVERGENT')) console.warn(line);
    },
    error() {},
  },
});
const queryContract = {
  kind: 'records',
  record: {
    kind: 'object',
    fields: [
      { name: 'id', required: true, value: { kind: 'string', maxBytes: 32 } },
      { name: 'count', required: true, value: { kind: 'integer', min: 0, max: 100 } },
    ],
    allowExtra: false,
  },
};
const mutationContract = {
  kind: 'value',
  value: {
    kind: 'object',
    fields: [
      { name: 'targetCount', required: true, value: { kind: 'integer', min: 0, max: 100 } },
    ],
    allowExtra: false,
  },
};
const ref = (name, kind, contract) => Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'optimistic-fixture',
  id: `optimistic-fixture:${name}`,
  name,
  kind,
  implementationHash: `sha256:${name}-implementation`,
  argsContractHash: `sha256:${name}-args`,
  argumentSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      amount: { type: 'integer' },
      handle: { type: 'string' },
      postId: { type: 'string' },
    },
  },
  resultContractHash: resultContractHash(contract),
  resultContract: contract,
});
const feed = ref('feed', 'LiveQuery', queryContract);
const increment = ref('increment', 'Mutation', mutationContract);
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'optimistic-fixture',
  bundleHash: 'sha256:optimistic-bundle',
  functions: [feed, increment],
});

function fakeClient() {
  const handles = new Set();
  const attempts = [];
  const diagnosticsChannel = createClientDiagnosticsChannel();
  const diagnosticsReporter = replayReporter(diagnosticsChannel);
  const devDiagnosticsEvents = [];
  const mutationListeners = new Map();
  const mutationDispositions = new Map();
  let barrier = null;
  let authorityEpoch = 1;
  let dispatches = 0;
  const publishDisposition = (clientMutationId, disposition) => {
    mutationDispositions.set(clientMutationId, disposition);
    for (const listener of [...(mutationListeners.get(clientMutationId) ?? [])]) {
      listener(disposition);
    }
  };
  const client = {
    liveQuery() {},
    diagnosticsChannel: () => diagnosticsChannel,
    authorityFence: {
      capture: () => authorityEpoch,
      isCurrent: (capture) => capture === authorityEpoch,
    },
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema: { schemaHash: 'sha256:optimistic-schema' },
        functions,
        capabilityManifest: {
          artifactKind: 'capabilityManifest',
          schemaVersion: 'snapback.v0',
          targetProfileId: 'local-dev-sqlite-ibex',
          supportedCapabilities: ['live_subscriptions'],
        },
      };
    },
    async authSession() { return { activeMode: 'dev' }; },
    __emitDevDiagnosticsEvent(event) { devDiagnosticsEvents.push(event); },
    disposeDiagnostics() {
      diagnosticsReporter.dispose();
      diagnosticsChannel.dispose();
    },
    registerAuthBarrierParticipant(participant) {
      barrier = participant;
      return async () => { if (barrier === participant) barrier = null; };
    },
    liveStreamManager() { return { async settled() {} }; },
    startLiveQuery(_reference, options) {
      const current = {
        rows: [{ id: 'counter', count: 0 }],
        connection: 'live',
      };
      const handle = {
        current,
        started: async () => {},
        dispose() { handles.delete(handle); },
        settled: async () => {},
        emit(rows, detail = {}) {
          current.rows = rows;
          options.onUpdate(rows, detail);
        },
      };
      handles.add(handle);
      queueMicrotask(() => options.onUpdate(current.rows));
      return Object.freeze(handle);
    },
    mutate(_reference, options) {
      dispatches += 1;
      const clientMutationId = options.clientMutationId ?? `plain-${dispatches}`;
      let resolve;
      let reject;
      const promise = new Promise((yes, no) => {
        resolve = (result) => yes({ result, version: dispatches });
        reject = no;
        attempts.push({
          options,
          clientMutationId,
          resolve,
          resolveOutput: yes,
          reject,
          queue(sequence = dispatches) {
            publishDisposition(clientMutationId, { status: 'pending', blockedReason: null });
            yes({
              status: 'queued', presentation: 'withheld',
              clientMutationId, sequence,
            });
          },
          disposition(status, result = null) {
            if (status === 'settled') {
              publishDisposition(clientMutationId, {
                status: 'settled',
                settlement: { status: 'settled', result, version: dispatches },
                settledAt: 1,
              });
            } else if (status === 'failed') {
              publishDisposition(clientMutationId, {
                status: 'failed',
                failure: { code: 'SNAPBACK_TYPED_REFUSAL', message: 'typed refusal' },
              });
            } else {
              publishDisposition(clientMutationId, { status });
            }
          },
        });
      });
      return promise;
    },
    subscribeMutation(clientMutationId, listener) {
      let listeners = mutationListeners.get(clientMutationId);
      if (listeners === undefined) {
        listeners = new Set();
        mutationListeners.set(clientMutationId, listeners);
      }
      listeners.add(listener);
      queueMicrotask(() => {
        if (listeners.has(listener)) {
          listener(mutationDispositions.get(clientMutationId) ?? { status: 'unknown' });
        }
      });
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) mutationListeners.delete(clientMutationId);
      };
    },
    emit(rows, detail = {}) {
      for (const handle of handles) handle.emit(rows, detail);
    },
    async cutAuthority() {
      await barrier.quiesce();
      barrier.blank();
      barrier.clearMemory();
      authorityEpoch += 1;
      await barrier.resume();
    },
    invalidateAuthorityWithoutBarrier() {
      authorityEpoch += 1;
    },
    inspection() {
      return {
        attempts,
        dispatches,
        handles: handles.size,
        mutationSubscriptions: [...mutationListeners.values()]
          .reduce((sum, listeners) => sum + listeners.size, 0),
        devDiagnosticsEvents,
      };
    },
  };
  return client;
}

const client = fakeClient();
const binding = await prepareReactBindingForClient(client, { generatedManifest: functions });
const provider = createSnapbackReactProvider(binding, { connectionId: 'optimistic-test' });
const observer = observeSnapbackQueries(
  provider,
  { feed: { ref: feed, args: {} } },
  () => {},
);
await flush();
assert.equal(observer.snapshot().queries.feed.data[0].count, 0);

const optimistic = (targetCount, extra = {}) => ({
  query: feed,
  args: {},
  update: (current) => current.map((row) => ({ ...row, count: row.count + 1 })),
  isAuthoritative: (current, result) => current[0].count === result.targetCount,
  ...extra,
});
const first = invokeSnapbackMutation(
  provider,
  increment,
  { amount: 1 },
  { optimistic: optimistic(1) },
);
const firstObserved = first.catch((error) => error);
const second = invokeSnapbackMutation(
  provider,
  increment,
  { amount: 1 },
  { optimistic: optimistic(1) },
);
assert.equal(observer.snapshot().queries.feed.data[0].count, 2);
client.inspection().attempts[0].reject(new Error('rejected'));
assert.equal((await firstObserved).message, 'rejected');
assert.equal(observer.snapshot().queries.feed.data[0].count, 1);
client.inspection().attempts[1].resolve({ targetCount: 1 });
assert.deepEqual(await second, { status: 'settled', result: { targetCount: 1 } });
assert.equal(observer.snapshot().queries.feed.data[0].count, 1);
client.emit([{ id: 'counter', count: 1 }]);
assert.equal(observer.snapshot().queries.feed.data[0].count, 1);

// Query-first: live authority arrives before the HTTP mutation response.
const queryFirst = invokeSnapbackMutation(
  provider,
  increment,
  { amount: 1 },
  { optimistic: optimistic(2) },
);
client.emit([{ id: 'counter', count: 2 }]);
assert.equal(observer.snapshot().queries.feed.data[0].count, 3);
client.inspection().attempts[2].resolve({ targetCount: 2 });
await queryFirst;
assert.equal(observer.snapshot().queries.feed.data[0].count, 2);

// Response-first: HTTP confirms, but the layer remains until matching live authority.
const responseFirst = invokeSnapbackMutation(
  provider,
  increment,
  { amount: 1 },
  { optimistic: optimistic(3) },
);
client.inspection().attempts[3].resolve({ targetCount: 3 });
await responseFirst;
assert.equal(observer.snapshot().queries.feed.data[0].count, 3);
client.emit([{ id: 'counter', count: 3 }]);
assert.equal(observer.snapshot().queries.feed.data[0].count, 3);

// A later rebase failure removes only that layer; backend settlement remains
// the mutation promise's truth.
const rebaseFailure = invokeSnapbackMutation(
  provider,
  increment,
  { amount: 1 },
  {
    optimistic: optimistic(5, {
      update(current) {
        if (current[0].count >= 4) throw new Error('cannot rebase');
        return current.map((row) => ({ ...row, count: row.count + 1 }));
      },
    }),
  },
);
assert.equal(observer.snapshot().queries.feed.data[0].count, 4);
client.emit([{ id: 'counter', count: 4 }]);
assert.equal(observer.snapshot().queries.feed.data[0].count, 4);
assert.equal(
  provider.inspection().diagnostics.at(-1).code,
  'SNAPBACK_REACT_OPTIMISTIC_REBASE_FAILED',
);
client.inspection().attempts[4].resolve({ targetCount: 5 });
assert.deepEqual(await rebaseFailure, { status: 'settled', result: { targetCount: 5 } });

await assert.rejects(
  invokeSnapbackMutation(provider, increment, { amount: 1 }, {
    optimistic: {
      query: feed,
      args: {},
      update: () => [{ id: 'counter', count: 'invalid' }],
    },
  }),
  (error) => error?.code === 'SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED',
);
assert.equal(client.inspection().dispatches, 5, 'invalid projection refuses before dispatch');

// Plain path: a connectivity refusal that crossed the durable enqueue cut
// resolves pending and records that no optimistic install was attempted.
const queuedSettlement = invokeSnapbackMutation(provider, increment, { amount: 1 });
client.inspection().attempts[5].resolveOutput({
  status: 'queued',
  clientMutationId: 'queued-increment-1',
  sequence: 7,
});
assert.deepEqual(await queuedSettlement, {
  status: 'queued',
  clientMutationId: 'queued-increment-1',
  sequence: 7,
  presentation: 'withheld',
});
assert.equal(client.inspection().dispatches, 6);

// The increment reducer above is exactly the action-shaped anti-pattern the
// dev replay advisory exists to catch: replayed over its own output it
// double-applies. One warning per (mutation, query) site, not per attempt.
assert.equal(replayWarnings.length, 1, 'the replay advisory warns once per mutation site');
assert.match(replayWarnings[0], /increment over feed/);
assert.match(replayWarnings[0], /guide\/recipes\/optimistic-toggle\.md/);

observer.dispose();
await flush();
await provider.dispose();
client.disposeDiagnostics();
assert.equal(client.inspection().handles, 0);

async function queuedLayerHarness({ disableStatusSubscription = false, queue = undefined } = {}) {
  const queuedClient = fakeClient();
  if (disableStatusSubscription) {
    queuedClient.subscribeMutation = () => {
      const error = new Error('local status bookkeeping failed');
      error.code = 'SNAPBACK_TEST_STATUS_SUBSCRIBE_FAILED';
      throw error;
    };
  }
  const queuedBinding = await prepareReactBindingForClient(
    queuedClient,
    { generatedManifest: functions },
  );
  const queuedProvider = createSnapbackReactProvider(queuedBinding, {
    connectionId: `queued-layer-${Math.random()}`,
  });
  const queuedObserver = observeSnapbackQueries(
    queuedProvider,
    { feed: { ref: feed, args: {} } },
    () => {},
  );
  await flush();
  const dispatch = invokeSnapbackMutation(
    queuedProvider,
    increment,
    { amount: 1 },
    {
      optimistic: optimistic(1, {
        update: (current) => current.map((row) => ({ ...row, count: 1 })),
      }),
      ...(queue === undefined ? {} : { queue }),
    },
  );
  const attempt = queuedClient.inspection().attempts[0];
  return { queuedClient, queuedProvider, queuedObserver, dispatch, attempt };
}

// Once headless mutate returns a settled outcome, a local result-contract
// failure is a presentation defect over committed effect, not rollback proof.
{
  const harness = await queuedLayerHarness();
  harness.attempt.resolveOutput({
    status: 'settled',
    clientMutationId: harness.attempt.clientMutationId,
    result: { targetCount: 'invalid' },
  });
  const error = await harness.dispatch.catch((caught) => caught);
  assert.equal(error.code, 'SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED');
  assert.equal(error.effectCommitted, true);
  assert.equal(error.diagnostic.details.effectCommitted, true);
  assert.equal(error.clientMutationId, harness.attempt.clientMutationId);
  assert.equal(harness.queuedProvider.inspection().optimisticLayers, 1);
  assert.equal(harness.queuedProvider.inspection().orphanedOptimisticLayers.length, 1);
  assert.equal(harness.queuedObserver.snapshot().queries.feed.data[0].count, 1);
  await harness.queuedClient.cutAuthority();
  harness.queuedObserver.dispose();
  await harness.queuedProvider.dispose();
  harness.queuedClient.disposeDiagnostics();
}

// The same post-dispatch rule applies when the captured authority becomes
// stale after the server response: the error says committed and retains the
// layer until the ordinary authority barrier owns cleanup.
{
  const harness = await queuedLayerHarness();
  harness.queuedClient.invalidateAuthorityWithoutBarrier();
  harness.attempt.resolveOutput({
    status: 'settled',
    clientMutationId: harness.attempt.clientMutationId,
    result: { targetCount: 1 },
  });
  const error = await harness.dispatch.catch((caught) => caught);
  assert.equal(error.code, 'SNAPBACK_CLIENT_AUTHORITY_STALE');
  assert.equal(error.effectCommitted, true);
  assert.equal(error.diagnostic.details.effectCommitted, true);
  assert.equal(harness.queuedProvider.inspection().optimisticLayers, 1);
  assert.equal(harness.queuedProvider.inspection().orphanedOptimisticLayers.length, 1);
  harness.queuedObserver.dispose();
  await harness.queuedProvider.dispose();
  harness.queuedClient.disposeDiagnostics();
}

// A broken headless queue:false promise is still durable acceptance. Preserve
// the installed layer and its status subscription while surfacing the client
// contract violation as committed effect.
{
  const harness = await queuedLayerHarness({ queue: false });
  harness.attempt.queue(42);
  const error = await harness.dispatch.catch((caught) => caught);
  assert.equal(error.code, 'SNAPBACK_REACT_QUEUE_FALSE_VIOLATED');
  assert.equal(error.effectCommitted, true);
  assert.equal(error.diagnostic.details.effectCommitted, true);
  assert.equal(harness.queuedProvider.inspection().optimisticLayers, 1);
  assert.equal(harness.queuedClient.inspection().mutationSubscriptions, 1);
  harness.attempt.disposition('failed');
  await flush();
  assert.equal(harness.queuedProvider.inspection().optimisticLayers, 0);
  harness.queuedObserver.dispose();
  await harness.queuedProvider.dispose();
  harness.queuedClient.disposeDiagnostics();
}

// M7 regression: queued dispatch resolves; a generic rollback-on-error
// handler cannot erase the pending layer. Replay settlement then retires it
// through the same matcher path using the retained settlement result.
async function queuedDispatchResolvesGenericRollbackCannotErasePendingLayer() {
  const harness = await queuedLayerHarness();
  let genericRollbackRan = false;
  const guarded = harness.dispatch.catch((error) => {
    genericRollbackRan = true;
    throw error;
  });
  harness.attempt.queue(41);
  assert.deepEqual(await guarded, {
    status: 'queued',
    presentation: 'installed',
    clientMutationId: harness.attempt.clientMutationId,
    sequence: 41,
  });
  await flush();
  assert.equal(genericRollbackRan, false);
  assert.equal(harness.queuedProvider.inspection().optimisticLayers, 1);
  assert.equal(harness.queuedObserver.snapshot().queries.feed.data[0].count, 1);
  harness.queuedClient.emit([{ id: 'counter', count: 1 }]);
  assert.equal(harness.queuedObserver.snapshot().queries.feed.data[0].count, 1);
  harness.attempt.disposition('settled', { targetCount: 1 });
  await flush();
  assert.equal(harness.queuedProvider.inspection().optimisticLayers, 0);
  assert.equal(harness.queuedObserver.snapshot().queries.feed.data[0].count, 1);
  assert.equal(harness.queuedClient.inspection().mutationSubscriptions, 0);
  harness.queuedObserver.dispose();
  await harness.queuedProvider.dispose();
  harness.queuedClient.disposeDiagnostics();
}
await queuedDispatchResolvesGenericRollbackCannotErasePendingLayer();

// Authorization quarantine owns an exact blank publication. An unresolved
// optimistic reducer remains suspended but cannot rematerialize the fenced
// row through a later live delivery or local mutation-status notification.
{
  const harness = await queuedLayerHarness();
  harness.attempt.queue();
  await harness.dispatch;
  await flush();
  assert.equal(harness.queuedProvider.inspection().optimisticLayers, 1);
  assert.deepEqual(
    harness.queuedObserver.snapshot().queries.feed.data,
    [{ id: 'counter', count: 1 }],
  );
  harness.queuedClient.emit([], { kind: 'authorization_quarantine' });
  assert.deepEqual(
    harness.queuedObserver.snapshot().queries.feed.data,
    [],
    'quarantine publishes the exact blank projection',
  );
  harness.queuedClient.emit([], { kind: 'live_replace' });
  harness.attempt.disposition('unknown');
  await flush();
  assert.equal(
    harness.queuedProvider.inspection().optimisticLayers,
    1,
    'the unresolved overlay is suspended rather than treated as resolved',
  );
  assert.deepEqual(
    harness.queuedObserver.snapshot().queries.feed.data,
    [],
    'an unresolved optimistic layer cannot republish across quarantine',
  );
  harness.attempt.disposition('failed');
  await flush();
  assert.deepEqual(harness.queuedObserver.snapshot().queries.feed.data, []);
  harness.queuedObserver.dispose();
  await harness.queuedProvider.dispose();
  harness.queuedClient.disposeDiagnostics();
}

for (const disposition of ['failed', 'stranded', 'quarantined', 'resultGone']) {
  const harness = await queuedLayerHarness();
  harness.attempt.queue();
  const outcome = await harness.dispatch;
  assert.equal(outcome.status, 'queued');
  assert.equal(outcome.presentation, 'installed');
  await flush();
  assert.equal(harness.queuedProvider.inspection().optimisticLayers, 1);
  harness.attempt.disposition(disposition);
  await flush();
  assert.equal(
    harness.queuedProvider.inspection().optimisticLayers,
    0,
    `${disposition} retires the retained layer`,
  );
  assert.equal(harness.queuedClient.inspection().mutationSubscriptions, 0);
  harness.queuedObserver.dispose();
  await harness.queuedProvider.dispose();
  harness.queuedClient.disposeDiagnostics();
}

// Settlement performed by another writer context arrives only through the
// durable status notification and still executes the matcher path.
{
  const harness = await queuedLayerHarness();
  harness.attempt.queue();
  await harness.dispatch;
  harness.queuedClient.emit([{ id: 'counter', count: 1 }]);
  harness.attempt.disposition('settled', { targetCount: 1 });
  await flush();
  assert.equal(harness.queuedProvider.inspection().optimisticLayers, 0);
  harness.queuedObserver.dispose();
  await harness.queuedProvider.dispose();
  harness.queuedClient.disposeDiagnostics();
}

// Unknown is not settlement evidence: retain and expose an orphan until the
// existing LLP 0107 authority-loss blank supplies a terminal ownership cut.
{
  const harness = await queuedLayerHarness();
  harness.attempt.queue();
  await harness.dispatch;
  harness.attempt.disposition('unknown');
  await flush();
  assert.equal(harness.queuedProvider.inspection().optimisticLayers, 1);
  assert.equal(harness.queuedProvider.inspection().orphanedOptimisticLayers.length, 1);
  await harness.queuedClient.cutAuthority();
  assert.equal(harness.queuedProvider.inspection().optimisticLayers, 0);
  assert.equal(harness.queuedClient.inspection().mutationSubscriptions, 0);
  harness.queuedObserver.dispose();
  await harness.queuedProvider.dispose();
  harness.queuedClient.disposeDiagnostics();
}

// Accepted intent is never rejected by local queued-path bookkeeping.
{
  const harness = await queuedLayerHarness({ disableStatusSubscription: true });
  harness.attempt.queue();
  const outcome = await harness.dispatch;
  assert.equal(outcome.status, 'queued');
  assert.equal(outcome.presentation, 'unavailable');
  assert.equal(outcome.diagnosticCode, 'SNAPBACK_REACT_QUEUED_PRESENTATION_UNAVAILABLE');
  assert.equal(
    harness.queuedClient.inspection().devDiagnosticsEvents.at(-1).code,
    'SNAPBACK_REACT_QUEUED_PRESENTATION_UNAVAILABLE',
  );
  assert.equal(harness.queuedProvider.inspection().optimisticLayers, 1);
  assert.equal(harness.queuedProvider.inspection().orphanedOptimisticLayers.length, 1);
  await harness.queuedClient.cutAuthority();
  harness.queuedObserver.dispose();
  await harness.queuedProvider.dispose();
  harness.queuedClient.disposeDiagnostics();
}

// Provider teardown releases a still-pending durable-status subscription.
{
  const harness = await queuedLayerHarness();
  harness.attempt.queue();
  await harness.dispatch;
  await flush();
  assert.equal(harness.queuedClient.inspection().mutationSubscriptions, 1);
  harness.queuedObserver.dispose();
  await harness.queuedProvider.dispose();
  harness.queuedClient.disposeDiagnostics();
  assert.equal(harness.queuedClient.inspection().mutationSubscriptions, 0);
}

// The optimistic toggle recipe (guide/recipes/optimistic-toggle.md): one
// viewer-aware query supplies both `liked` and `likeCount`, one replayable
// projection sets both atomically, and the matcher recognizes only the
// complete mutation receipt. The same post is mounted in two query stores to
// pin the v1 one-canonical-store boundary.
const postsContract = {
  kind: 'records',
  record: {
    kind: 'object',
    fields: [
      { name: 'id', required: true, value: { kind: 'string', maxBytes: 32 } },
      { name: 'liked', required: true, value: { kind: 'boolean' } },
      { name: 'likeCount', required: true, value: { kind: 'integer', min: 0, max: 1_000_000 } },
    ],
    allowExtra: false,
  },
};
const likeReceiptContract = {
  kind: 'value',
  value: {
    kind: 'object',
    fields: [
      { name: 'liked', required: true, value: { kind: 'boolean' } },
      { name: 'likeCount', required: true, value: { kind: 'integer', min: 0, max: 1_000_000 } },
    ],
    allowExtra: false,
  },
};
const timeline = ref('timeline', 'LiveQuery', postsContract);
const profilePosts = ref('profilePosts', 'LiveQuery', postsContract);
const toggleLike = ref('toggleLike', 'Mutation', likeReceiptContract);
const likeFunctions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'optimistic-fixture',
  bundleHash: 'sha256:optimistic-toggle-bundle',
  functions: [timeline, profilePosts, toggleLike],
});

function fakeSurfacesClient(initialRowsByQuery) {
  const handles = new Set();
  const attempts = [];
  const diagnosticsChannel = createClientDiagnosticsChannel();
  const diagnosticsReporter = replayReporter(diagnosticsChannel);
  let dispatches = 0;
  return {
    liveQuery() {},
    diagnosticsChannel: () => diagnosticsChannel,
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema: { schemaHash: 'sha256:optimistic-schema' },
        functions: likeFunctions,
        capabilityManifest: {
          artifactKind: 'capabilityManifest',
          schemaVersion: 'snapback.v0',
          targetProfileId: 'local-dev-sqlite-ibex',
          supportedCapabilities: ['live_subscriptions'],
        },
      };
    },
    async authSession() { return { activeMode: 'dev' }; },
    registerAuthBarrierParticipant() { return async () => {}; },
    liveStreamManager() { return { async settled() {} }; },
    startLiveQuery(reference, options) {
      const handle = {
        name: reference.name,
        current: { rows: initialRowsByQuery[reference.name], connection: 'live' },
        started: async () => {},
        dispose() { handles.delete(handle); },
        settled: async () => {},
        emit(rows) {
          handle.current.rows = rows;
          options.onUpdate(rows);
        },
      };
      handles.add(handle);
      queueMicrotask(() => options.onUpdate(handle.current.rows));
      return Object.freeze(handle);
    },
    mutate(_reference, options) {
      dispatches += 1;
      let resolve;
      let reject;
      const promise = new Promise((yes, no) => {
        resolve = (result) => yes({ result, version: dispatches });
        reject = no;
      });
      attempts.push({ options, resolve, reject });
      return promise;
    },
    emit(name, rows) {
      for (const handle of handles) if (handle.name === name) handle.emit(rows);
    },
    disposeDiagnostics() {
      diagnosticsReporter.dispose();
      diagnosticsChannel.dispose();
    },
    inspection() { return { attempts, dispatches, handles: handles.size }; },
  };
}

const likeClient = fakeSurfacesClient({
  timeline: [{ id: 'p1', liked: false, likeCount: 10 }],
  profilePosts: [{ id: 'p1', liked: false, likeCount: 10 }],
});
const likeBinding = await prepareReactBindingForClient(likeClient, { generatedManifest: likeFunctions });
const likeProvider = createSnapbackReactProvider(likeBinding, { connectionId: 'optimistic-toggle-test' });
const likeObserver = observeSnapbackQueries(
  likeProvider,
  {
    timeline: { ref: timeline, args: {} },
    profile: { ref: profilePosts, args: { handle: 'ada' } },
  },
  () => {},
);
await flush();
const view = () => likeObserver.snapshot().queries;
assert.equal(view().timeline.data[0].liked, false);
assert.equal(view().profile.data[0].likeCount, 10);

// Capture the intended outcome at admission. The projection is replayed over
// every newer authoritative base during rebase, so it must set the captured
// outcome; toggling or incrementing the incoming row would re-run the user
// action on replay and visibly invert or double-apply it.
const intended = { liked: true, likeCount: 11 };
const optimisticLike = {
  query: timeline,
  args: {},
  update: (posts) => posts.map((post) => post.id === 'p1' ? { ...post, ...intended } : post),
  isAuthoritative: (posts, receipt) => posts.some((post) => post.id === 'p1'
    && post.liked === receipt.liked && post.likeCount === receipt.likeCount),
};
const like = invokeSnapbackMutation(
  likeProvider,
  toggleLike,
  { postId: 'p1' },
  { optimistic: optimisticLike },
);
assert.equal(view().timeline.data[0].liked, true);
assert.equal(view().timeline.data[0].likeCount, 11, 'both fields change atomically');
assert.equal(view().profile.data[0].liked, false, 'v1: one canonical store carries the layer');

// A partial authoritative delivery (the like row landed, the denormalized
// count has not) rebases the layer instead of retiring it: the captured
// outcome holds, and a toggle-style reducer would have inverted here.
likeClient.emit('timeline', [{ id: 'p1', liked: true, likeCount: 10 }]);
assert.equal(view().timeline.data[0].liked, true, 'replay does not invert the heart');
assert.equal(view().timeline.data[0].likeCount, 11, 'partial delivery keeps the layer installed');

// Response-before-query: the HTTP receipt settles the mutation promise, but
// the layer retires only after a live delivery matches the complete receipt.
likeClient.inspection().attempts[0].resolve({ liked: true, likeCount: 11 });
assert.deepEqual(await like, { status: 'settled', result: { liked: true, likeCount: 11 } });
assert.equal(view().timeline.data[0].likeCount, 11, 'settled response alone does not retire the layer');
likeClient.emit('timeline', [{ id: 'p1', liked: true, likeCount: 11 }]);
assert.equal(view().timeline.data[0].likeCount, 11);
likeClient.emit('timeline', [{ id: 'p1', liked: true, likeCount: 12 }]);
assert.equal(view().timeline.data[0].likeCount, 12, 'layer retired after the complete receipt');

// Other mounted stores rendering the same record update through their own
// authoritative subscriptions, not through the optimistic layer.
likeClient.emit('profilePosts', [{ id: 'p1', liked: true, likeCount: 12 }]);
assert.equal(view().profile.data[0].liked, true, 'other surfaces settle authoritatively');
assert.equal(view().profile.data[0].likeCount, 12);

// The recipe's capture-and-set projection is replay-stable, so the advisory
// stayed silent across the whole toggle section.
assert.equal(replayWarnings.length, 1, 'capture-and-set projections pass the replay advisory');

likeObserver.dispose();
await flush();
await likeProvider.dispose();
likeClient.disposeDiagnostics();
assert.equal(likeClient.inspection().handles, 0);

// projectRecordFields derives the same recipe shape from one declaration: an
// idempotent capture-and-set update plus a complete-receipt matcher, spread
// into the ordinary optimistic options.
const helperClient = fakeSurfacesClient({
  timeline: [{ id: 'p2', liked: false, likeCount: 3 }],
  profilePosts: [{ id: 'p2', liked: false, likeCount: 3 }],
});
const helperBinding = await prepareReactBindingForClient(helperClient, { generatedManifest: likeFunctions });
const helperProvider = createSnapbackReactProvider(helperBinding, { connectionId: 'optimistic-helper-test' });
const helperObserver = observeSnapbackQueries(
  helperProvider,
  { timeline: { ref: timeline, args: {} } },
  () => {},
);
await flush();
const helperView = () => helperObserver.snapshot().queries.timeline.data[0];

// One declaration derives the idempotent capture-and-set update and the
// complete-receipt matcher; spread it into the ordinary optimistic options.
const optimisticHelperLike = {
  query: timeline,
  args: {},
  ...projectRecordFields('p2', { liked: true, likeCount: 4 }, { idField: 'id' }),
};
const helperLike = invokeSnapbackMutation(
  helperProvider,
  toggleLike,
  { postId: 'p2' },
  { optimistic: optimisticHelperLike },
);
assert.equal(helperView().liked, true, 'helper update sets both fields atomically');
assert.equal(helperView().likeCount, 4);

// A partial authoritative delivery rebases the helper's layer instead of
// retiring it: the derived matcher wants the complete receipt.
helperClient.emit('timeline', [{ id: 'p2', liked: true, likeCount: 3 }]);
assert.equal(helperView().liked, true, 'helper projection does not invert on replay');
assert.equal(helperView().likeCount, 4, 'partial delivery keeps the helper layer installed');

helperClient.inspection().attempts[0].resolve({ liked: true, likeCount: 4 });
assert.deepEqual(await helperLike, { status: 'settled', result: { liked: true, likeCount: 4 } });
helperClient.emit('timeline', [{ id: 'p2', liked: true, likeCount: 4 }]);
helperClient.emit('timeline', [{ id: 'p2', liked: true, likeCount: 5 }]);
assert.equal(helperView().likeCount, 5, 'helper matcher retired on the complete receipt');
assert.equal(replayWarnings.length, 1, 'projectRecordFields is replay-safe by construction');

// Declaration-time refusals: the helper only expresses capture-and-set over
// primitive intended outcomes.
assert.throws(() => projectRecordFields('', { liked: true }), TypeError);
assert.throws(() => projectRecordFields('p2', {}), TypeError);
assert.throws(() => projectRecordFields('p2', { nested: { deep: true } }), TypeError);

// The advisory is development-only: an explicit production NODE_ENV admits
// the same action-shaped reducer silently, and development warns again for a
// site that has not warned before.
const actionShaped = {
  query: timeline,
  args: {},
  update: (posts) => posts.map((post) => ({ ...post, likeCount: post.likeCount + 1 })),
};
const priorNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
let silent;
try {
  silent = invokeSnapbackMutation(
    helperProvider,
    toggleLike,
    { postId: 'p2' },
    { optimistic: actionShaped },
  );
  assert.equal(replayWarnings.length, 1, 'production skips the replay advisory');
} finally {
  if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = priorNodeEnv;
}
helperClient.inspection().attempts[1].resolve({ liked: true, likeCount: 6 });
await silent;
const noisy = invokeSnapbackMutation(
  helperProvider,
  toggleLike,
  { postId: 'p2' },
  { optimistic: actionShaped },
);
await flush();
assert.equal(replayWarnings.length, 2, 'development warns on the action-shaped reducer');
assert.match(replayWarnings[1], /toggleLike over timeline/);
helperClient.inspection().attempts[2].resolve({ liked: true, likeCount: 7 });
await noisy;
helperClient.emit('timeline', [{ id: 'p2', liked: true, likeCount: 7 }]);

// A reducer that throws when replayed over its own output takes the
// advisory's failure branch: the warning fires (fresh site — the profile
// query) and admission is untouched, so the projection still displays.
const profileObserver = observeSnapbackQueries(
  helperProvider,
  { profile: { ref: profilePosts, args: {} } },
  () => {},
);
await flush();
const throwsOnReplay = invokeSnapbackMutation(
  helperProvider,
  toggleLike,
  { postId: 'p2' },
  {
    optimistic: {
      query: profilePosts,
      args: {},
      update: (posts) => {
        if (posts[0].likeCount === 0) throw new Error('replayed over own output');
        return posts.map((post) => ({ ...post, likeCount: 0 }));
      },
    },
  },
);
await flush();
assert.equal(replayWarnings.length, 3, 'a throw over the reducer\'s own output warns');
assert.match(replayWarnings[2], /failed when replayed over its own output/);
assert.equal(
  profileObserver.snapshot().queries.profile.data[0].likeCount,
  0,
  'the advisory is observational: the projection was still admitted',
);
helperClient.inspection().attempts[3].resolve({ liked: true, likeCount: 0 });
await throwsOnReplay;
helperClient.emit('profilePosts', [{ id: 'p2', liked: true, likeCount: 0 }]);
profileObserver.dispose();

// Declaration-time refusals for the id-field seam.
assert.throws(() => projectRecordFields('p2', { liked: true }, { idField: '' }), TypeError);
assert.throws(() => projectRecordFields('p2', { id: 'p3', liked: true }, { idField: 'id' }), TypeError);

helperObserver.dispose();
await flush();
await helperProvider.dispose();
helperClient.disposeDiagnostics();
assert.equal(helperClient.inspection().handles, 0);
console.warn = originalConsoleWarn;

console.log('optimistic.test.mjs: overlap, rollback, matcher ordering, rebase failure, install refusal, the toggle recipe, the replay advisory, and projectRecordFields pass');

// A confirmed projectRecordFields layer retires when a later authoritative
// delivery omits its identified row. It cannot consume a provider layer slot
// or resurrect its projection if the row later returns.
const absentClient = fakeSurfacesClient({
  timeline: [{ id: 'absent-target', liked: false, likeCount: 20 }],
  profilePosts: [],
});
const absentBinding = await prepareReactBindingForClient(absentClient, { generatedManifest: likeFunctions });
const absentProvider = createSnapbackReactProvider(absentBinding, { connectionId: 'optimistic-absent-test' });
const absentObserver = observeSnapbackQueries(
  absentProvider,
  { timeline: { ref: timeline, args: {} } },
  () => {},
);
await flush();
const absentMutation = invokeSnapbackMutation(
  absentProvider,
  toggleLike,
  { postId: 'absent-target' },
  {
    optimistic: {
      query: timeline,
      args: {},
      ...projectRecordFields('absent-target', { liked: true, likeCount: 21 }, { idField: 'id' }),
    },
  },
);
absentClient.inspection().attempts[0].resolve({ liked: true, likeCount: 21 });
await absentMutation;
assert.equal(
  absentProvider.inspection().confirmedOptimisticLayers.length,
  1,
  'the confirmed helper layer remains installed while its row is still present but unmatched',
);
const authoritativeWithoutTarget = [{ id: 'other-post', liked: false, likeCount: 4 }];
absentClient.emit('timeline', authoritativeWithoutTarget);
assert.deepEqual(
  absentObserver.snapshot().queries.timeline.data,
  authoritativeWithoutTarget,
  'row-absent authority renders exactly the authoritative rows',
);
assert.equal(
  absentProvider.inspection().optimisticLayers,
  0,
  'row-absent authority retires the helper layer and releases its provider slot',
);
assert.deepEqual(
  absentProvider.inspection().confirmedOptimisticLayers,
  [],
  'row-absent authority leaves no confirmed helper layer pinned',
);
absentClient.emit('timeline', [{ id: 'absent-target', liked: false, likeCount: 22 }]);
assert.deepEqual(
  absentObserver.snapshot().queries.timeline.data,
  [{ id: 'absent-target', liked: false, likeCount: 22 }],
  'a row returning after absence does not resurrect the retired projection',
);
absentObserver.dispose();
await flush();
await absentProvider.dispose();
absentClient.disposeDiagnostics();

// Presence with non-matching fields is not absence evidence: the helper layer
// remains installed and continues projecting its captured intended values.
const dippedClient = fakeSurfacesClient({
  timeline: [{ id: 'dipped-target', liked: false, likeCount: 30 }],
  profilePosts: [],
});
const dippedBinding = await prepareReactBindingForClient(dippedClient, { generatedManifest: likeFunctions });
const dippedProvider = createSnapbackReactProvider(dippedBinding, { connectionId: 'optimistic-dipped-test' });
const dippedObserver = observeSnapbackQueries(
  dippedProvider,
  { timeline: { ref: timeline, args: {} } },
  () => {},
);
await flush();
const dippedMutation = invokeSnapbackMutation(
  dippedProvider,
  toggleLike,
  { postId: 'dipped-target' },
  {
    optimistic: {
      query: timeline,
      args: {},
      ...projectRecordFields('dipped-target', { liked: true, likeCount: 31 }, { idField: 'id' }),
    },
  },
);
dippedClient.inspection().attempts[0].resolve({ liked: true, likeCount: 31 });
await dippedMutation;
dippedClient.emit('timeline', [{ id: 'dipped-target', liked: false, likeCount: 30 }]);
assert.deepEqual(
  dippedObserver.snapshot().queries.timeline.data,
  [{ id: 'dipped-target', liked: true, likeCount: 31 }],
  'a present-but-dipped row keeps the helper projection installed',
);
assert.equal(
  dippedProvider.inspection().optimisticLayers,
  1,
  'presence without a complete receipt does not trigger the absence backstop',
);
assert.equal(
  dippedProvider.inspection().confirmedOptimisticLayers.length,
  1,
  'the present-but-dipped helper layer remains observable as confirmed',
);
dippedClient.emit('timeline', [{ id: 'dipped-target', liked: true, likeCount: 31 }]);
assert.equal(
  dippedProvider.inspection().optimisticLayers,
  0,
  'the present helper layer still retires on its ordinary complete-receipt match',
);
dippedObserver.dispose();
await flush();
await dippedProvider.dispose();
dippedClient.disposeDiagnostics();

// Hand-written matchers preserve their complete-receipt semantics, including
// when they override a matcher obtained by spreading projectRecordFields.
const customClient = fakeSurfacesClient({
  timeline: [
    { id: 'custom-target', liked: false, likeCount: 40 },
    { id: 'overridden-target', liked: false, likeCount: 50 },
  ],
  profilePosts: [],
});
const customBinding = await prepareReactBindingForClient(customClient, { generatedManifest: likeFunctions });
const customProvider = createSnapbackReactProvider(customBinding, { connectionId: 'optimistic-custom-test' });
const customObserver = observeSnapbackQueries(
  customProvider,
  { timeline: { ref: timeline, args: {} } },
  () => {},
);
await flush();
const customMatcherMutation = invokeSnapbackMutation(
  customProvider,
  toggleLike,
  { postId: 'custom-target' },
  {
    optimistic: {
      query: timeline,
      args: {},
      update: (posts) => posts.map((post) => (
        post.id === 'custom-target' ? { ...post, liked: true, likeCount: 41 } : post
      )),
      isAuthoritative: () => false,
    },
  },
);
customClient.inspection().attempts[0].resolve({ liked: true, likeCount: 41 });
await customMatcherMutation;
customClient.emit('timeline', [{ id: 'overridden-target', liked: false, likeCount: 50 }]);
assert.equal(
  customProvider.inspection().optimisticLayers,
  1,
  'row absence does not retire a confirmed hand-written matcher',
);
customClient.emit('timeline', [
  { id: 'custom-target', liked: false, likeCount: 40 },
  { id: 'overridden-target', liked: false, likeCount: 50 },
]);
assert.deepEqual(
  customObserver.snapshot().queries.timeline.data[0],
  { id: 'custom-target', liked: true, likeCount: 41 },
  'the hand-written matcher layer still projects after an absent delivery',
);

const overriddenMatcherMutation = invokeSnapbackMutation(
  customProvider,
  toggleLike,
  { postId: 'overridden-target' },
  {
    optimistic: {
      query: timeline,
      args: {},
      ...projectRecordFields(
        'overridden-target',
        { liked: true, likeCount: 51 },
        { idField: 'id' },
      ),
      isAuthoritative: () => false,
    },
  },
);
customClient.inspection().attempts[1].resolve({ liked: true, likeCount: 51 });
await overriddenMatcherMutation;
customClient.emit('timeline', [{ id: 'custom-target', liked: false, likeCount: 40 }]);
assert.equal(
  customProvider.inspection().optimisticLayers,
  2,
  'overriding the spread helper matcher prevents the helper brand from traveling',
);
customClient.emit('timeline', [
  { id: 'custom-target', liked: false, likeCount: 40 },
  { id: 'overridden-target', liked: false, likeCount: 50 },
]);
assert.deepEqual(
  customObserver.snapshot().queries.timeline.data,
  [
    { id: 'custom-target', liked: true, likeCount: 41 },
    { id: 'overridden-target', liked: true, likeCount: 51 },
  ],
  'both custom matcher layers continue projecting after their row-absent deliveries',
);

const customInspection = customProvider.inspection();
assert.equal(
  customInspection.confirmedOptimisticLayers.length,
  2,
  'inspection reports every installed confirmed layer',
);
for (const [index, layerInspection] of customInspection.confirmedOptimisticLayers.entries()) {
  assert.deepEqual(
    Object.keys(layerInspection),
    ['attemptId', 'mutationId', 'queryId', 'confirmedRevision', 'storeRevision'],
    'inspection exposes the complete confirmed-layer identity and revision shape',
  );
  assert.equal(
    layerInspection.attemptId,
    customClient.inspection().attempts[index].options.clientMutationId,
    'inspection attemptId identifies the corresponding dispatched attempt',
  );
  assert.equal(
    layerInspection.mutationId,
    toggleLike.id,
    'inspection mutationId identifies the fixture mutation reference',
  );
  assert.equal(
    layerInspection.queryId,
    timeline.id,
    'inspection queryId identifies the fixture query reference',
  );
  assert.ok(
    Number.isInteger(layerInspection.confirmedRevision),
    'inspection includes the authoritative revision captured at confirmation',
  );
  assert.equal(
    layerInspection.storeRevision,
    customInspection.confirmedOptimisticLayers[0].storeRevision,
    'inspection reports the current store revision for every layer in that store',
  );
  assert.ok(
    layerInspection.storeRevision >= layerInspection.confirmedRevision,
    'the inspected store revision is not older than the layer confirmation',
  );
  assert.ok(Object.isFrozen(layerInspection), 'each confirmed layer inspection entry is frozen');
}
assert.ok(
  Object.isFrozen(customInspection.confirmedOptimisticLayers),
  'the confirmed layer inspection collection is frozen',
);
customObserver.dispose();
await flush();
await customProvider.dispose();
customClient.disposeDiagnostics();

console.log('optimistic.test.mjs: strand backstop, custom matcher preservation, and confirmed-layer inspection pass');

// Query-first ordering uses the same absence proof at confirmation time: the
// unconfirmed layer survives the delivery, then retires when the response
// confirms it against the still-current absent result set.
const queryFirstAbsentClient = fakeSurfacesClient({
  timeline: [{ id: 'query-first-absent', liked: false, likeCount: 60 }],
  profilePosts: [],
});
const queryFirstAbsentBinding = await prepareReactBindingForClient(
  queryFirstAbsentClient,
  { generatedManifest: likeFunctions },
);
const queryFirstAbsentProvider = createSnapbackReactProvider(
  queryFirstAbsentBinding,
  { connectionId: 'optimistic-query-first-absent-test' },
);
const queryFirstAbsentObserver = observeSnapbackQueries(
  queryFirstAbsentProvider,
  { timeline: { ref: timeline, args: {} } },
  () => {},
);
await flush();
const queryFirstAbsentMutation = invokeSnapbackMutation(
  queryFirstAbsentProvider,
  toggleLike,
  { postId: 'query-first-absent' },
  {
    optimistic: {
      query: timeline,
      args: {},
      ...projectRecordFields(
        'query-first-absent',
        { liked: true, likeCount: 61 },
        { idField: 'id' },
      ),
    },
  },
);
queryFirstAbsentClient.emit('timeline', []);
assert.equal(
  queryFirstAbsentProvider.inspection().optimisticLayers,
  1,
  'an absent delivery does not retire a helper layer before mutation confirmation',
);
queryFirstAbsentClient.inspection().attempts[0].resolve({ liked: true, likeCount: 61 });
await queryFirstAbsentMutation;
assert.equal(
  queryFirstAbsentProvider.inspection().optimisticLayers,
  0,
  'confirmation retires a helper layer against a current row-absent delivery',
);
assert.deepEqual(
  queryFirstAbsentProvider.inspection().confirmedOptimisticLayers,
  [],
  'query-first row absence releases the confirmed layer pin immediately',
);
queryFirstAbsentClient.emit('timeline', [
  { id: 'query-first-absent', liked: false, likeCount: 62 },
]);
assert.deepEqual(
  queryFirstAbsentObserver.snapshot().queries.timeline.data,
  [{ id: 'query-first-absent', liked: false, likeCount: 62 }],
  'query-first retirement prevents later overlay resurrection',
);
queryFirstAbsentObserver.dispose();
await flush();
await queryFirstAbsentProvider.dispose();
queryFirstAbsentClient.disposeDiagnostics();

console.log('optimistic.test.mjs: query-first row-absence confirmation pass');
