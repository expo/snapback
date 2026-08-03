// LLP 0043 M1/M2 / ENG-23965: retained boot + durable ordered mutation replay
// through the real Contract adapter, including response loss after commit.

import assert from 'node:assert/strict';

import {
  AuthCoordinator,
  createLocalStorageSnapbackClientStore,
  createMemoryAuthCustodyStorage,
  createMemorySnapbackClientStore,
  createSnapbackContractSurface,
  snapbackAuthFingerprint,
} from './index.mjs';
import {
  SNAPBACK_CLIENT_STORE_VERSION,
  legacySnapbackAuthFingerprint,
} from './client-store.mjs';
import { todoOptimisticReducers } from '../../demos/todo/surfaces/contract/optimistic.mjs';

const USER = 'user_offline';
const AUTH_STREAM = '018f0d90-7b21-7a22-8c33-445566778899';
const AUTHORITY_INSTANCE = '018f0d90-7b24-7a22-8c33-445566778899';
assert.equal(
  snapbackAuthFingerprint(USER),
  'sha256:86461827557b6998a5a62a63791d835495afd03cb573055d83bd5be048cc082a',
);
assert.equal(
  snapbackAuthFingerprint({ principal: 'é', session_id: '会话', user_id: '👩🏽‍💻' }),
  'sha256:d858de49d9f97b29fb3066058e41b05b98918c82255b1a19e97331dc61e34e3d',
);
assert.notEqual(
  snapbackAuthFingerprint({}),
  snapbackAuthFingerprint({ principal: '', session_id: null, user_id: '' }),
);
assert.equal(
  snapbackAuthFingerprint({ principal: 'a'.repeat(131_072), session_id: null, user_id: null }),
  'sha256:a7b4c457a7a1c988d351e99d3c48213a82145129cf9e3132c1981ca01f420ef0',
);

const manifest = {
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  schemaVersion: 'snapback.v0',
  inputsHash: 'offline-inputs',
  schemaHash: 'offline-schema',
  bundleHash: 'offline-bundle',
  capabilities: {
    derivedOptimisticOverlays: true,
    offlineReplay: true,
  },
  queries: {
    listTodos: {
      name: 'listTodos',
      mode: 'live',
      defaultLive: true,
      reads: ['todos'],
    },
  },
  mutations: {
    createTodo: {
      optimistic: true,
      plan: {
        steps: [{
          Insert: {
            table: 'todos',
            values: {
              title: { Arg: 'title' },
              completed: { Literal: false },
              userId: 'AuthUserId',
            },
            bind_id_as: 'todoId',
          },
        }],
        return_value: { Binding: 'todoId' },
      },
    },
    setCompleted: {
      optimistic: true,
      plan: {
        steps: [{
          Patch: {
            table: 'todos',
            id: { Arg: 'id' },
            values: { completed: { Arg: 'completed' } },
          },
        }],
        return_value: 'ChangedCount',
      },
    },
    deleteTodo: {
      optimistic: true,
      plan: {
        steps: [{ Delete: { table: 'todos', id: { Arg: 'id' } } }],
        return_value: 'ChangedCount',
      },
    },
  },
};

const runtime = {
  createContractMockQueryBoundary(initialRows) {
    const rows = new Map(Object.entries(initialRows));
    return {
      current: (key) => rows.get(key) ?? [],
      query: (key, project = (value) => value) => project(rows.get(key) ?? []),
      write(key, update) {
        const next = update(rows.get(key) ?? []);
        rows.set(key, next);
        return next;
      },
    };
  },
  createBoundaryContractDataProvider(_manifest, boundary, options) {
    return {
      boundary,
      subscribe(name, args, observer) {
        observer({ status: 'ready', value: options.queries[name](args, boundary) });
        return { dispose() {} };
      },
      mutate(name, args) {
        return options.mutations[name](args, boundary);
      },
    };
  },
};

const retainedSurfaceIdentity = {
  artifactIndex: { appId: 'offline-test-app' },
  schemaManifest: { schemaHash: manifest.schemaHash, targetProfile: 'local-dev-sqlite-ibex' },
  retainedIdentity: { databaseId: 'offline-test-db', versionStreamId: 'offline-test-stream-1' },
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

// Deterministic same-origin Web Locks stand-in. Operations for one lock name
// are FIFO, and a rejected/crashed holder releases the queue for its successor.
function createTestLockManager() {
  const tails = new Map();
  return {
    request(name, _options, operation) {
      const prior = tails.get(name) ?? Promise.resolve();
      const result = prior.then(operation, operation);
      const tail = result.then(() => undefined, () => undefined);
      tails.set(name, tail);
      return result.finally(() => {
        if (tails.get(name) === tail) tails.delete(name);
      });
    },
  };
}

function makeClient() {
  const state = {
    online: true,
    rows: [],
    version: 0,
    settlements: new Map(),
    acknowledged: [],
    applied: [],
    deliveries: [],
    queryCalls: 0,
    mutationCalls: 0,
    acknowledgementCalls: 0,
    loseAfterCommit: null,
    failBeforeOrigin: null,
    rejectWithReceipt: null,
  };
  const snapshot = () => ({
    version: state.version,
    rows: state.rows.map((row) => ({ ...row })),
  });
  const offline = () => {
    throw new TypeError('network unavailable');
  };
  return {
    state,
    async currentAuthorizationScope({ devUserId = null } = {}) {
      return {
        principalScope: {
          authMode: 'dev',
          authorizationStreamIncarnation: AUTH_STREAM,
          userId: devUserId,
        },
        authorityDescriptor: {
          descriptorVersion: 1,
          authorityInstanceId: AUTHORITY_INSTANCE,
          sessionGeneration: 0,
        },
        queryAuthorization: {},
      };
    },
    async query() {
      state.queryCalls += 1;
      if (!state.online) offline();
      return snapshot();
    },
    async liveQuery(_name, options) {
      if (!state.online) offline();
      const current = snapshot();
      return {
        ...current,
        connection: 'live',
        dispose() {},
        push() {
          options.onUpdate?.(snapshot().rows, { version: state.version });
        },
      };
    },
    async mutate(name, request) {
      state.mutationCalls += 1;
      if (!state.online) offline();
      if (state.failBeforeOrigin === name) {
        state.failBeforeOrigin = null;
        const error = new Error('proxy returned 502 before origin');
        error.status = 502;
        error.diagnostic = {
          code: 'SNAPBACK_UPSTREAM_UNAVAILABLE',
          message: error.message,
        };
        throw error;
      }
      for (const acknowledged of request.acknowledgedClientMutationIds ?? []) {
        if (state.settlements.delete(acknowledged)) state.acknowledged.push(acknowledged);
      }
      if (state.rejectWithReceipt === name) {
        state.rejectWithReceipt = null;
        const error = new Error('origin rejected mutation');
        error.status = 400;
        error.diagnostic = {
          code: 'SNAPBACK_TEST_REJECTED',
          message: error.message,
        };
        error.receipt = { kind: 'mutation', outcome: 'REJECTED' };
        throw error;
      }
      const id = request.clientMutationId;
      assert.ok(id, 'replayed mutation must carry clientMutationId');
      assert.ok(request.ctxLedger, 'replayed mutation must carry ctxLedger');
      assert.equal(
        request.authorityDescriptor?.authorityInstanceId,
        AUTHORITY_INSTANCE,
        'replayed mutation must preserve its authority descriptor',
      );
      state.deliveries.push({ name, id, authorityDescriptor: request.authorityDescriptor });
      if (state.settlements.has(id)) return state.settlements.get(id);

      if (name === 'createTodo') {
        const rowId = request.ctxLedger.ids[0];
        assert.ok(rowId, 'create replay must carry its generated row id');
        state.version += 1;
        state.rows.push({
          _id: rowId,
          _version: state.version,
          title: request.args.title,
          completed: false,
          userId: request.userId,
        });
      } else if (name === 'setCompleted') {
        state.version += 1;
        state.rows = state.rows.map((row) => row._id === request.args.id
          ? { ...row, completed: request.args.completed, _version: state.version }
          : row);
      } else if (name === 'deleteTodo') {
        state.version += 1;
        state.rows = state.rows.filter((row) => row._id !== request.args.id);
      } else {
        throw new Error(`unknown mutation ${name}`);
      }
      const output = { version: state.version, changed_count: 1, result: null };
      state.settlements.set(id, output);
      state.applied.push(name);
      if (state.loseAfterCommit === name) {
        state.loseAfterCommit = null;
        offline();
      }
      return output;
    },
    async acknowledgeMutations({ clientMutationIds }) {
      state.acknowledgementCalls += 1;
      if (!state.online) offline();
      let acknowledged = 0;
      for (const id of clientMutationIds) {
        if (state.settlements.delete(id)) {
          acknowledged += 1;
          state.acknowledged.push(id);
        }
      }
      return { acknowledged };
    },
  };
}

const sharedState = {};
const client = makeClient();
const makeSurface = (store) => createSnapbackContractSurface({
  runtime,
  client,
  clientStore: store,
  userId: USER,
  manifest,
  queryName: 'listTodos',
  boundaryKey: 'todos',
  ...retainedSurfaceIdentity,
});

const successorAnonymous = {
  kind: 'anonymous',
  authMode: 'dev',
  authorizationStreamIncarnation: '018f0d90-7b22-7a22-8c33-445566778899',
};

const makeCoordinatedRaceSurface = async (suffix, wrapStore) => {
  const appId = `offline-race-${suffix}`;
  const custodyState = { custody: {} };
  const custodyStorage = createMemoryAuthCustodyStorage({ state: custodyState });
  const coordinator = new AuthCoordinator({
    appId,
    storage: custodyStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const captureA = await coordinator.establishAnonymous({
    kind: 'anonymous',
    authMode: 'dev',
    authorizationStreamIncarnation: AUTH_STREAM,
  });
  const writer = new AuthCoordinator({
    appId,
    storage: custodyStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await writer.synchronize();
  const baseStore = createMemorySnapbackClientStore();
  const store = wrapStore(baseStore);
  const raceClient = makeClient();
  raceClient.authCoordinator = coordinator;
  raceClient.captureAuthority = () => coordinator.capture();
  const surface = await createSnapbackContractSurface({
    runtime,
    client: raceClient,
    clientStore: store,
    userId: USER,
    manifest,
    queryName: 'listTodos',
    boundaryKey: 'todos',
    livePush: false,
    artifactIndex: { appId },
    schemaManifest: retainedSurfaceIdentity.schemaManifest,
    retainedIdentity: {
      databaseId: `offline-race-db-${suffix}`,
      versionStreamId: `offline-race-stream-${suffix}`,
    },
  });
  return {
    coordinator,
    writer,
    captureA,
    surface,
    store,
    baseStore,
    client: raceClient,
  };
};

// Online boot publishes an authorized retained snapshot.
const firstStore = createMemorySnapbackClientStore({ state: sharedState });
const first = await makeSurface(firstStore);
assert.equal(first.capabilityClass, 'Parity');
assert.equal(first.retained(), false);

// Queue create offline; the derived overlay uses the SAME id as its ledger.
client.state.online = false;
await first.links.createTodo({ title: 'survives reload' });
assert.equal(first.pendingCount(), 1);
const optimistic = first.boundary.current('todos');
assert.equal(optimistic.length, 1);
const todoId = optimistic[0]._id;
// LLP 0148: the durable mutation id is `mut_<body>` and no longer embeds the
// function name — the queued record carries `function` beside it.
assert.match(todoId, /^mut_[0-9a-hjkmnp-tv-z]{26}_id_1$/u);
first.dispose();

// New store + new adapter instance models an app reload. The live request
// fails, retained rows boot stale, and the durable create overlay re-applies.
const secondStore = createMemorySnapbackClientStore({ state: sharedState });
const second = await makeSurface(secondStore);
assert.equal(second.retained(), true);
assert.equal(second.connection(), 'stale');
assert.equal(second.boundary.current('todos')[0]._id, todoId);

// Queue the rest of the CRUD sequence while offline. Ordering is the store's
// monotonic sequence, never the wall clock.
await second.links.setCompleted({ id: todoId, completed: true });
await second.links.deleteTodo({ id: todoId });
const queued = await secondStore.pendingMutations();
assert.deepEqual(queued.map((entry) => entry.function), [
  'createTodo',
  'setCompleted',
  'deleteTodo',
]);
assert.deepEqual(queued.map((entry) => entry.sequence), [1, 2, 3]);
assert.deepEqual(second.boundary.current('todos'), []);

// First reconnect commits create but loses the response. The durable queue
// remains. A second reconnect redelivers the SAME id; server settlement
// dedupe returns the original result and the row is applied only once.
client.state.online = true;
client.state.loseAfterCommit = 'createTodo';
await assert.rejects(second.reconnect(), /network unavailable/);
assert.equal(client.state.rows.length, 1);
assert.equal(second.pendingCount(), 3);

const replay = await second.reconnect();
assert.deepEqual(replay, { replayed: 3, failed: 0 });
assert.deepEqual(client.state.applied, ['createTodo', 'setCompleted', 'deleteTodo']);
assert.deepEqual(client.state.rows, []);
assert.equal(second.pendingCount(), 0);
assert.equal((await secondStore.pendingMutations()).length, 0);
assert.equal(client.state.deliveries.filter((entry) => entry.name === 'createTodo').length, 2);
assert.equal(client.state.settlements.size, 0, 'final results are ACKed without a later mutation');
assert.equal(client.state.acknowledged.length, 3);
second.dispose();

// Generated ordinary JS mutations carry optimistic:false. That legacy fact
// does not suppress their app reducer, including when durable pending work is
// restored after an offline reload; only atomicOptimisticWithholding does.
{
  const jsClient = makeClient();
  jsClient.state.rows = [{
    _id: 'todo_js_restore',
    _version: 1,
    title: 'restore me',
    completed: false,
    userId: USER,
  }];
  jsClient.state.version = 1;
  const jsState = {};
  const jsManifest = {
    ...manifest,
    inputsHash: 'offline-js-inputs',
    schemaHash: 'offline-js-schema',
    bundleHash: 'offline-js-bundle',
    mutations: {
      setCompleted: {
        ...manifest.mutations.setCompleted,
        optimistic: false,
      },
    },
  };
  const jsIdentity = {
    artifactIndex: { appId: 'offline-js-app' },
    schemaManifest: { schemaHash: jsManifest.schemaHash, targetProfile: 'local-dev-sqlite-ibex' },
    retainedIdentity: { databaseId: 'offline-js-db', versionStreamId: 'offline-js-stream-1' },
  };
  const jsSurface = (store, surfaceManifest = jsManifest) => createSnapbackContractSurface({
    runtime,
    client: jsClient,
    clientStore: store,
    userId: USER,
    manifest: surfaceManifest,
    queryName: 'listTodos',
    boundaryKey: 'todos',
    optimisticReducers: { setCompleted: todoOptimisticReducers.setCompleted },
    ...jsIdentity,
  });
  const onlineStore = createMemorySnapbackClientStore({ state: jsState });
  const online = await jsSurface(onlineStore);
  jsClient.state.online = false;
  await online.links.setCompleted({ id: 'todo_js_restore', completed: true });
  assert.equal(online.boundary.current('todos')[0].completed, true);
  online.dispose();

  const restoredStore = createMemorySnapbackClientStore({ state: jsState });
  const restored = await jsSurface(restoredStore);
  assert.equal(restored.retained(), true);
  assert.equal(
    restored.boundary.current('todos')[0].completed,
    true,
    'ordinary JS app reducer re-applies to restored pending work',
  );
  restored.dispose();

  const withheldManifest = {
    ...jsManifest,
    mutations: {
      setCompleted: {
        ...jsManifest.mutations.setCompleted,
        atomicOptimisticWithholding: true,
      },
    },
  };
  const withheldStore = createMemorySnapbackClientStore({ state: jsState });
  const withheld = await jsSurface(withheldStore, withheldManifest);
  assert.equal(
    withheld.boundary.current('todos')[0].completed,
    false,
    'atomic withholding suppresses app reducers on the restored-pending branch',
  );
  assert.equal(withheld.pendingCount(), 1, 'withheld work remains durably pending');
  withheld.dispose();
}

// A foreground reconnect must not turn a failed durable custody read into a
// best-effort hint. The mandatory synchronize gate blanks the surface, rejects
// reconnect, and stops before either the authoritative query or queued
// mutation dispatch can run.
{
  const baseCustodyStorage = createMemoryAuthCustodyStorage();
  let failNextCustodyRead = false;
  const failingCustodyStorage = {
    ...baseCustodyStorage,
    withOwnership(appId, operation) {
      return baseCustodyStorage.withOwnership(appId, (owner) => operation({
        ...owner,
        async read() {
          if (failNextCustodyRead) {
            failNextCustodyRead = false;
            throw Object.assign(
              new Error('deterministic custody read failure'),
              { code: 'TEST_CUSTODY_READ_FAILED' },
            );
          }
          return owner.read();
        },
      }));
    },
  };
  const failingCoordinator = new AuthCoordinator({
    appId: retainedSurfaceIdentity.artifactIndex.appId,
    storage: failingCustodyStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await failingCoordinator.establishAnonymous({
    kind: 'anonymous',
    authMode: 'dev',
    authorizationStreamIncarnation: AUTH_STREAM,
  });
  const failingClient = makeClient();
  failingClient.authCoordinator = failingCoordinator;
  failingClient.captureAuthority = () => failingCoordinator.capture();
  const failingStore = createMemorySnapbackClientStore();
  const failingSurface = await createSnapbackContractSurface({
    runtime,
    client: failingClient,
    clientStore: failingStore,
    userId: USER,
    manifest,
    queryName: 'listTodos',
    boundaryKey: 'todos',
    ...retainedSurfaceIdentity,
  });

  failingClient.state.online = false;
  const queued = await failingSurface.links.createTodo({ title: 'must stay queued' });
  assert.equal(queued.queued, true);
  assert.equal(failingSurface.pendingCount(), 1);
  failingClient.state.online = true;
  const queryCallsBefore = failingClient.state.queryCalls;
  const mutationCallsBefore = failingClient.state.mutationCalls;

  failNextCustodyRead = true;
  await assert.rejects(failingSurface.reconnect(), { code: 'TEST_CUSTODY_READ_FAILED' });
  assert.equal(failingClient.state.queryCalls, queryCallsBefore);
  assert.equal(failingClient.state.mutationCalls, mutationCallsBefore);
  assert.equal(failingSurface.pendingCount(), 0, 'the blank surface hides queued predecessor work');
  assert.equal(
    (await failingStore.snapshot()).pending.length,
    1,
    'the read failure does not settle or discard the durable queue',
  );
  assert.deepEqual(failingSurface.boundary.current('todos'), []);
  assert.throws(
    () => failingCoordinator.capture(),
    { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING' },
  );

  await failingSurface.dispose();
  await failingCoordinator.close();
}

// The optimistic publication preflight is not the transport preflight. A
// peer can settle A -> B while the single-surface path awaits its final queue
// CAS; the generic mutation client must still receive zero predecessor calls.
{
  const assertEntered = deferred();
  const releaseAssert = deferred();
  let blockNextAssert = false;
  const fixture = await makeCoordinatedRaceSurface('first-send', (baseStore) => ({
    ...baseStore,
    async assertMutationQueueCapture(...args) {
      if (blockNextAssert) {
        blockNextAssert = false;
        assertEntered.resolve();
        await releaseAssert.promise;
      }
      return baseStore.assertMutationQueueCapture(...args);
    },
  }));
  blockNextAssert = true;
  const pendingMutation = fixture.surface.links.createTodo({ title: 'must not dispatch from A' });
  await assertEntered.promise;
  await fixture.writer.transition(
    fixture.captureA,
    successorAnonymous,
    'first_send_final_store_await',
  );
  releaseAssert.resolve();
  await assert.rejects(pendingMutation, { code: 'SNAPBACK_CLIENT_AUTHORITY_STALE' });
  assert.equal(fixture.client.state.mutationCalls, 0);
  assert.deepEqual(fixture.surface.boundary.current('todos'), []);
  await fixture.surface.dispose();
  await fixture.coordinator.close();
  await fixture.writer.close();
}

// Replay has the same last-mile race: pending-ACK and queue-CAS reads occur
// after reconnect's initial authority check. Reconfirm immediately before
// redelivery so a transition during that final store await cannot send A.
{
  const assertEntered = deferred();
  const releaseAssert = deferred();
  let blockNextAssert = false;
  const fixture = await makeCoordinatedRaceSurface('replay-send', (baseStore) => ({
    ...baseStore,
    async assertMutationQueueCapture(...args) {
      if (blockNextAssert) {
        blockNextAssert = false;
        assertEntered.resolve();
        await releaseAssert.promise;
      }
      return baseStore.assertMutationQueueCapture(...args);
    },
  }));
  fixture.client.state.online = false;
  const queuedResult = await fixture.surface.links.createTodo({ title: 'queued under A' });
  assert.equal(queuedResult.queued, true);
  fixture.client.state.online = true;
  blockNextAssert = true;
  const mutationCallsBeforeReplay = fixture.client.state.mutationCalls;
  const pendingReplay = fixture.surface.reconnect();
  await assertEntered.promise;
  await fixture.writer.transition(
    fixture.captureA,
    successorAnonymous,
    'replay_final_store_await',
  );
  releaseAssert.resolve();
  await assert.rejects(pendingReplay, { code: 'SNAPBACK_CLIENT_AUTHORITY_STALE' });
  assert.equal(fixture.client.state.mutationCalls, mutationCallsBeforeReplay);
  assert.deepEqual(fixture.surface.boundary.current('todos'), []);
  await fixture.surface.dispose();
  await fixture.coordinator.close();
  await fixture.writer.close();
}

// Standalone mutation acknowledgements are authenticated app-data dispatches
// too. A transition while loading the durable ACK ids must strand those ids
// locally and leave the generic acknowledgement transport untouched.
{
  const acknowledgementsEntered = deferred();
  const releaseAcknowledgements = deferred();
  let blockNonEmptyAcknowledgements = false;
  const fixture = await makeCoordinatedRaceSurface('ack-send', (baseStore) => ({
    ...baseStore,
    async pendingMutationAcknowledgements(...args) {
      const ids = await baseStore.pendingMutationAcknowledgements(...args);
      if (blockNonEmptyAcknowledgements && ids.length > 0) {
        blockNonEmptyAcknowledgements = false;
        acknowledgementsEntered.resolve();
        await releaseAcknowledgements.promise;
      }
      return ids;
    },
  }));
  blockNonEmptyAcknowledgements = true;
  const pendingMutation = fixture.surface.links.createTodo({ title: 'commit before ACK race' });
  await acknowledgementsEntered.promise;
  assert.equal(fixture.client.state.mutationCalls, 1);
  assert.equal(fixture.client.state.acknowledgementCalls, 0);
  await fixture.writer.transition(
    fixture.captureA,
    successorAnonymous,
    'ack_final_store_await',
  );
  releaseAcknowledgements.resolve();
  await assert.rejects(pendingMutation, { code: 'SNAPBACK_CLIENT_AUTHORITY_STALE' });
  assert.equal(fixture.client.state.acknowledgementCalls, 0);
  assert.equal(fixture.client.state.settlements.size, 1);
  await fixture.surface.dispose();
  await fixture.coordinator.close();
  await fixture.writer.close();
}

// A receipt-less proxy 502 is not proof that the origin saw either the
// piggyback ACKs or the current mutation. Keep both durable records, then let
// the next reconnect deliver them. (Snapback-origin rejections carry a
// mutation receipt and take the separate terminal-failure path.)
const ambiguousClient = makeClient();
const ambiguousStore = createMemorySnapbackClientStore();
const ambiguousSurface = await createSnapbackContractSurface({
  runtime,
  client: ambiguousClient,
  clientStore: ambiguousStore,
  userId: USER,
  manifest,
  queryName: 'listTodos',
  boundaryKey: 'todos',
  ...retainedSurfaceIdentity,
});
const ambiguousAuth = snapbackAuthFingerprint(USER);
const consumedBefore502 = await ambiguousStore.enqueueMutation({
  id: 'consumed-before-502',
  function: 'createTodo',
  args: { title: 'already consumed' },
  readSet: [],
  ctxLedger: { version: 1, ids: ['consumed-row'], now: 1, authFingerprint: ambiguousAuth },
  authFingerprint: ambiguousAuth,
  schemaHash: manifest.schemaHash,
  inputsHash: manifest.inputsHash,
  targetProfileId: 'local-dev-sqlite-ibex',
  appId: retainedSurfaceIdentity.artifactIndex.appId,
  databaseId: retainedSurfaceIdentity.retainedIdentity.databaseId,
  versionStreamId: retainedSurfaceIdentity.retainedIdentity.versionStreamId,
  cursor: { stream: retainedSurfaceIdentity.retainedIdentity.versionStreamId, version: 0 },
  baseVersion: 0,
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: AUTHORITY_INSTANCE,
    sessionGeneration: 0,
  },
});
await ambiguousStore.settleMutation(consumedBefore502.id, {
  status: 'confirmed',
  output: { version: 0, changed_count: 0, result: null },
});
ambiguousClient.state.settlements.set(consumedBefore502.id, {
  version: 0,
  changed_count: 0,
  result: null,
});
ambiguousClient.state.failBeforeOrigin = 'createTodo';
const ambiguousDelivery = await ambiguousSurface.links.createTodo({ title: 'ambiguous delivery' });
assert.equal(ambiguousDelivery.queued, true);
assert.deepEqual(
  await ambiguousStore.pendingMutationAcknowledgements(10, ambiguousAuth),
  [consumedBefore502.id],
  'receipt-less 502 must retain the only server-GC proof',
);
assert.equal((await ambiguousStore.pendingMutations()).length, 1);
assert.equal(ambiguousClient.state.settlements.has(consumedBefore502.id), true);
assert.deepEqual(await ambiguousSurface.reconnect(), { replayed: 1, failed: 0 });
assert.equal(ambiguousClient.state.acknowledged.includes(consumedBefore502.id), true);
assert.equal((await ambiguousStore.pendingMutations()).length, 0);
assert.deepEqual(await ambiguousStore.pendingMutationAcknowledgements(10, ambiguousAuth), []);
ambiguousSurface.dispose();

// The ordinary online delivery path has the same receipt-proof contract as
// reconnect replay. Even when the current mutation is rejected, its origin
// receipt proves that piggyback ACKs were processed and may be removed from
// the durable client store before the current mutation becomes failed.
const onlineRejectedClient = makeClient();
const onlineRejectedStore = createMemorySnapbackClientStore();
const onlineRejectedSurface = await createSnapbackContractSurface({
  runtime,
  client: onlineRejectedClient,
  clientStore: onlineRejectedStore,
  userId: USER,
  manifest,
  queryName: 'listTodos',
  boundaryKey: 'todos',
  ...retainedSurfaceIdentity,
});
const consumedBeforeOnlineRejection = await onlineRejectedStore.enqueueMutation({
  ...consumedBefore502,
  id: 'consumed-before-online-rejection',
  sequence: undefined,
});
await onlineRejectedStore.settleMutation(consumedBeforeOnlineRejection.id, {
  status: 'confirmed',
  output: { version: 0, changed_count: 0, result: null },
});
onlineRejectedClient.state.settlements.set(consumedBeforeOnlineRejection.id, {
  version: 0,
  changed_count: 0,
  result: null,
});
onlineRejectedClient.state.rejectWithReceipt = 'createTodo';
await assert.rejects(
  onlineRejectedSurface.links.createTodo({ title: 'ordinary origin rejection' }),
  (error) => error?.receipt?.outcome === 'REJECTED',
);
assert.deepEqual(
  await onlineRejectedStore.pendingMutationAcknowledgements(10, ambiguousAuth),
  [],
  'an online origin rejection receipt confirms its preceding piggyback ACK stage',
);
assert.equal(
  onlineRejectedClient.state.acknowledged.includes(consumedBeforeOnlineRejection.id),
  true,
);
assert.equal((await onlineRejectedStore.pendingMutations()).length, 0);
assert.equal((await onlineRejectedStore.failedMutations()).length, 1);
onlineRejectedSurface.dispose();

const rejectedClient = makeClient();
const rejectedStore = createMemorySnapbackClientStore();
const rejectedSurface = await createSnapbackContractSurface({
  runtime,
  client: rejectedClient,
  clientStore: rejectedStore,
  userId: USER,
  manifest,
  queryName: 'listTodos',
  boundaryKey: 'todos',
  ...retainedSurfaceIdentity,
});
const consumedBeforeRejection = await rejectedStore.enqueueMutation({
  ...consumedBefore502,
  id: 'consumed-before-rejection',
  sequence: undefined,
});
await rejectedStore.settleMutation(consumedBeforeRejection.id, {
  status: 'confirmed',
  output: { version: 0, changed_count: 0, result: null },
});
rejectedClient.state.settlements.set(consumedBeforeRejection.id, {
  version: 0,
  changed_count: 0,
  result: null,
});
rejectedClient.state.online = false;
await rejectedSurface.links.createTodo({ title: 'origin rejection' });
rejectedClient.state.online = true;
rejectedClient.state.rejectWithReceipt = 'createTodo';
assert.deepEqual(await rejectedSurface.reconnect(), { replayed: 0, failed: 1 });
assert.deepEqual(
  await rejectedStore.pendingMutationAcknowledgements(10, ambiguousAuth),
  [],
  'an origin receipt proves its preceding piggyback ACK stage ran',
);
assert.equal(rejectedClient.state.acknowledged.includes(consumedBeforeRejection.id), true);
assert.equal((await rejectedStore.pendingMutations()).length, 0);
assert.equal((await rejectedStore.failedMutations()).length, 1);
rejectedSurface.dispose();

// User switches wipe retained rows and queued writes before the new authority
// can observe them (LLP 0043/0039).
const authState = {};
const authStore = createMemorySnapbackClientStore({ state: authState });
await authStore.scopeToAuth('auth:a');
await authStore.putRetainedQuery('q', { rows: [{ secret: true }], authFingerprint: 'auth:a' });
await authStore.enqueueMutation({ function: 'x', authFingerprint: 'auth:a' });
await authStore.scopeToAuth('auth:b');
assert.equal(await authStore.getRetainedQuery('q', { authFingerprint: 'auth:b' }), null);
assert.deepEqual(await authStore.pendingMutations(), []);

// Consumed settlement ids carry their own auth scope. A user/artifact switch
// neither exposes them to the new user nor discards the only server-GC proof;
// returning to the original authority can finish the standalone ACK.
const ackStore = createMemorySnapbackClientStore();
await ackStore.scopeToAuth('auth:a');
const consumed = await ackStore.enqueueMutation({ function: 'x', authFingerprint: 'auth:a' });
await ackStore.settleMutation(consumed.id, { status: 'confirmed', output: {} });
await ackStore.scopeToArtifacts({ schemaHash: 'schema:a' });
assert.deepEqual(await ackStore.pendingMutationAcknowledgements(), [consumed.id]);
await ackStore.scopeToAuth('auth:b');
assert.deepEqual(await ackStore.pendingMutationAcknowledgements(), []);
await ackStore.scopeToAuth('auth:a');
assert.deepEqual(await ackStore.pendingMutationAcknowledgements(), [consumed.id]);
await ackStore.scopeToArtifacts({ schemaHash: 'schema:b' });
assert.deepEqual(await ackStore.pendingMutationAcknowledgements(), [consumed.id]);
await ackStore.confirmMutationAcknowledgements([consumed.id], 'auth:a');
assert.deepEqual(await ackStore.pendingMutationAcknowledgements(), []);

// The first known auth/artifact scope cannot retroactively claim unscoped v1
// bytes. Clear every privacy-bearing collection, including failed-only legacy
// state, before the new authority or artifact revision can inspect it.
const legacyUnscopedState = {
  version: 1,
  origin: 'legacy-unscoped',
  generation: 0,
  authFingerprint: null,
  artifactScope: null,
  nextSequence: 3,
  retained: { q: { rows: [{ secret: 'retained' }] } },
  pending: [{
    id: 'pending-legacy',
    function: 'pendingLegacy',
    sequence: 1,
    status: 'pending',
    args: { secret: 'pending' },
  }],
  failed: [{
    id: 'failed-legacy',
    function: 'failedLegacy',
    sequence: 2,
    status: 'failed',
    args: { secret: 'failed' },
  }],
};
const legacyUnscopedStore = createMemorySnapbackClientStore({ state: legacyUnscopedState });
await legacyUnscopedStore.scopeToAuth('auth:new');
assert.deepEqual((await legacyUnscopedStore.snapshot()).retained, {});
assert.deepEqual(await legacyUnscopedStore.pendingMutations(), []);
assert.deepEqual(await legacyUnscopedStore.failedMutations(), []);

const failedOnlyArtifactState = {
  version: 1,
  origin: 'legacy-failed-only',
  generation: 0,
  authFingerprint: 'auth:stable',
  artifactScope: null,
  nextSequence: 2,
  retained: {},
  pending: [],
  failed: [{
    id: 'failed-only',
    function: 'failedOnly',
    sequence: 1,
    status: 'failed',
    authFingerprint: 'auth:stable',
    args: { secret: 'failed-only' },
  }],
};
const failedOnlyArtifactStore = createMemorySnapbackClientStore({ state: failedOnlyArtifactState });
await failedOnlyArtifactStore.scopeToArtifacts({ schemaHash: 'schema:new' });
assert.deepEqual(await failedOnlyArtifactStore.failedMutations(), []);

// The actual localStorage adapter round-trips through serialized bytes: a new
// adapter object sees retained rows + queue, and an artifact revision
// quarantines (typed failed) rather than replaying the old mutation.
const storageBytes = new Map();
const fakeStorage = {
  getItem(key) { return storageBytes.get(key) ?? null; },
  setItem(key, value) { storageBytes.set(key, value); },
};
const durableLocks = createTestLockManager();
const durableA = createLocalStorageSnapbackClientStore({
  storage: fakeStorage,
  key: 'test',
  lockManager: durableLocks,
});
await durableA.scopeToAuth('auth:stable');
await durableA.scopeToArtifacts({ schemaHash: 'schema:a', inputsHash: 'inputs:a' });
await durableA.putRetainedQuery('todos:{}', {
  rows: [{ _id: 'retained' }],
  authFingerprint: 'auth:stable',
  schemaHash: 'schema:a',
  inputsHash: 'inputs:a',
});
const oldFailure = await durableA.enqueueMutation({
  function: 'failedBeforeUpgrade',
  args: { secret: 'old-failed-payload' },
  authFingerprint: 'auth:stable',
  schemaHash: 'schema:a',
  inputsHash: 'inputs:a',
});
await durableA.settleMutation(oldFailure.id, {
  status: 'failed',
  diagnostic: { code: 'OLD_FAILURE' },
});
await durableA.enqueueMutation({
  function: 'createTodo',
  args: { secret: 'old-payload' },
  ctxLedger: { version: 1, ids: ['secret-id'], now: 1 },
  authFingerprint: 'auth:stable',
  schemaHash: 'schema:a',
  inputsHash: 'inputs:a',
});
const durableB = createLocalStorageSnapbackClientStore({
  storage: fakeStorage,
  key: 'test',
  lockManager: durableLocks,
});
assert.deepEqual(
  (await durableB.getRetainedQuery('todos:{}', {
    authFingerprint: 'auth:stable',
    schemaHash: 'schema:a',
    inputsHash: 'inputs:a',
  })).rows,
  [{ _id: 'retained' }],
);
assert.equal((await durableB.pendingMutations({
  authFingerprint: 'auth:stable',
  schemaHash: 'schema:a',
  inputsHash: 'inputs:a',
})).length, 1);
await durableB.scopeToArtifacts({ schemaHash: 'schema:b', inputsHash: 'inputs:b' });
assert.deepEqual(await durableB.pendingMutations(), []);
const tombstone = (await durableB.failedMutations()).at(-1);
assert.equal(tombstone.diagnostic.code, 'SNAPBACK_CLIENT_ARTIFACT_STALE');
assert.equal('args' in tombstone, false, 'artifact quarantine must redact old mutation args');
assert.equal('ctxLedger' in tombstone, false, 'artifact quarantine must redact old replay ledger');
assert.equal(JSON.stringify(tombstone).includes('old-payload'), false);
assert.equal(JSON.stringify(await durableB.failedMutations()).includes('old-failed-payload'), false);
assert.equal(await durableB.getRetainedQuery('todos:{}', { authFingerprint: 'auth:stable' }), null);

// `generation` was added to format v1 as an additive fencing fact. Its absent
// form has one explicit migration; the original v1 core fields remain
// mandatory so structural truncation cannot masquerade as a fresh store.
const additiveV1 = {
  version: 1,
  origin: 'legacy-origin',
  authFingerprint: null,
  artifactScope: null,
  nextSequence: 1,
  retained: {},
  pending: [],
  failed: [],
};
const additiveBytes = new Map([['additive-v1', JSON.stringify(additiveV1)]]);
const additiveStore = createLocalStorageSnapbackClientStore({
  storage: {
    getItem(key) { return additiveBytes.get(key) ?? null; },
    setItem(key, value) { additiveBytes.set(key, value); },
  },
  key: 'additive-v1',
  lockManager: createTestLockManager(),
});
assert.equal((await additiveStore.snapshot()).generation, 0, 'missing additive generation migrates');
assert.equal((await additiveStore.snapshot()).version, SNAPBACK_CLIENT_STORE_VERSION);

// A v1/FNV store cannot prove which canonical auth tuple created it. Even a
// caller that supplies the exact legacy alias may be a 64-bit collision, so
// v2 validates then quarantines every privacy/integrity-bearing collection
// instead of rebinding rows, queued writes, ledgers, failures, or ACKs.
const legacyFingerprint = legacySnapbackAuthFingerprint(USER);
const collisionClaimFingerprint = snapbackAuthFingerprint('collision-claim');
const legacyFingerprintStore = createMemorySnapbackClientStore({
  state: {
    version: 1,
    origin: 'legacy-fingerprint',
    generation: 0,
    authFingerprint: legacyFingerprint,
    artifactScope: null,
    nextSequence: 3,
    retained: {
      secret: {
        rows: [{ secret: 'legacy-retained' }],
        authFingerprint: legacyFingerprint,
      },
    },
    pending: [{
      id: 'legacy-pending',
      function: 'createTodo',
      sequence: 1,
      status: 'pending',
      authFingerprint: legacyFingerprint,
      ctxLedger: {
        version: 1,
        ids: ['legacy-row-id'],
        now: 1,
        authFingerprint: legacyFingerprint,
      },
    }],
    failed: [{
      id: 'legacy-failed',
      function: 'createTodo',
      sequence: 2,
      status: 'failed',
      authFingerprint: legacyFingerprint,
      args: { secret: 'legacy-failed' },
    }],
    acknowledged: ['legacy-ack'],
  },
});
await legacyFingerprintStore.scopeToAuth(collisionClaimFingerprint, {
  // Deliberately ignored: alias membership is not identity proof.
  legacyAuthFingerprints: [legacyFingerprint],
});
const migratedFingerprintState = await legacyFingerprintStore.snapshot();
assert.equal(migratedFingerprintState.version, SNAPBACK_CLIENT_STORE_VERSION);
assert.equal(migratedFingerprintState.authFingerprint, collisionClaimFingerprint);
assert.deepEqual(migratedFingerprintState.retained, {});
assert.deepEqual(migratedFingerprintState.pending, []);
assert.deepEqual(migratedFingerprintState.failed, []);
assert.deepEqual(migratedFingerprintState.acknowledged, []);

// Existing but uninterpretable bytes are never normalized into an empty
// healthy queue. Every ordinary operation fails with a stable diagnostic and
// leaves the exact bytes in place; only the explicit clear() recovery replaces
// them. Both future-version and downgrade-version stores fail closed.
for (const invalid of [
  {
    label: 'corrupt JSON',
    raw: '{not-json',
    code: 'SNAPBACK_CLIENT_STORE_CORRUPT',
    direction: undefined,
  },
  {
    label: 'truncated valid JSON',
    raw: JSON.stringify({ version: 1 }),
    code: 'SNAPBACK_CLIENT_STORE_CORRUPT',
    direction: undefined,
  },
  {
    label: 'truncated pending record',
    raw: JSON.stringify({ ...additiveV1, pending: [null] }),
    code: 'SNAPBACK_CLIENT_STORE_CORRUPT',
    direction: undefined,
  },
  {
    label: 'truncated retained record',
    raw: JSON.stringify({ ...additiveV1, retained: { q: null } }),
    code: 'SNAPBACK_CLIENT_STORE_CORRUPT',
    direction: undefined,
  },
  {
    label: 'truncated failed record',
    raw: JSON.stringify({ ...additiveV1, failed: [null] }),
    code: 'SNAPBACK_CLIENT_STORE_CORRUPT',
    direction: undefined,
  },
  {
    label: 'truncated replay ledger',
    raw: JSON.stringify({
      ...additiveV1,
      pending: [{
        id: 'pending-1',
        function: 'createTodo',
        sequence: 1,
        status: 'pending',
        ctxLedger: {},
      }],
    }),
    code: 'SNAPBACK_CLIENT_STORE_CORRUPT',
    direction: undefined,
  },
  {
    label: 'future nested replay ledger',
    raw: JSON.stringify({
      ...additiveV1,
      nextSequence: 2,
      pending: [{
        id: 'pending-1',
        function: 'createTodo',
        sequence: 1,
        status: 'pending',
        ctxLedger: { version: 2, ids: [], now: 1 },
      }],
    }),
    code: 'SNAPBACK_CLIENT_STORE_CORRUPT',
    direction: undefined,
  },
  {
    label: 'overbound replay ledger',
    raw: JSON.stringify({
      ...additiveV1,
      nextSequence: 2,
      pending: [{
        id: 'pending-1',
        function: 'createTodo',
        sequence: 1,
        status: 'pending',
        ctxLedger: { version: 1, ids: Array.from({ length: 1025 }, (_, index) => `id-${index}`), now: 1 },
      }],
    }),
    code: 'SNAPBACK_CLIENT_STORE_CORRUPT',
    direction: undefined,
  },
  {
    label: 'invalid retained cursor',
    raw: JSON.stringify({
      ...additiveV1,
      retained: { q: { rows: [], cursor: { stream: 17, version: 'bad' } } },
    }),
    code: 'SNAPBACK_CLIENT_STORE_CORRUPT',
    direction: undefined,
  },
  {
    label: 'regressed sequence watermark',
    raw: JSON.stringify({
      ...additiveV1,
      origin: 'origin',
      nextSequence: 1,
      pending: [{
        id: 'cm_origin_1',
        function: 'old',
        sequence: 1,
        status: 'pending',
      }],
    }),
    code: 'SNAPBACK_CLIENT_STORE_CORRUPT',
    direction: undefined,
  },
  {
    label: 'duplicate mutation identity',
    raw: JSON.stringify({
      ...additiveV1,
      nextSequence: 3,
      pending: [{ id: 'duplicate', function: 'one', sequence: 1, status: 'pending' }],
      failed: [{ id: 'duplicate', function: 'two', sequence: 2, status: 'failed' }],
    }),
    code: 'SNAPBACK_CLIENT_STORE_CORRUPT',
    direction: undefined,
  },
  {
    label: 'duplicate mutation sequence',
    raw: JSON.stringify({
      ...additiveV1,
      nextSequence: 2,
      pending: [{ id: 'one', function: 'one', sequence: 1, status: 'pending' }],
      failed: [{ id: 'two', function: 'two', sequence: 1, status: 'failed' }],
    }),
    code: 'SNAPBACK_CLIENT_STORE_CORRUPT',
    direction: undefined,
  },
  {
    label: 'invalid pending identity without cursor',
    raw: JSON.stringify({
      ...additiveV1,
      artifactScope: {
        schemaHash: 'sh',
        inputsHash: 'ih',
        targetProfileId: 'tp',
        appId: 'a',
        databaseId: 'db',
        versionStreamId: 'stream',
      },
      nextSequence: 2,
      pending: [{
        id: 'one',
        function: 'one',
        sequence: 1,
        status: 'pending',
        schemaHash: 'sh',
        inputsHash: 'ih',
        targetProfileId: 'tp',
        appId: 'a',
        databaseId: 'db',
        versionStreamId: 17,
      }],
    }),
    code: 'SNAPBACK_CLIENT_STORE_CORRUPT',
    direction: undefined,
  },
  {
    label: 'future version',
    raw: JSON.stringify({ version: 999, pending: [{ id: 'must-survive' }] }),
    code: 'SNAPBACK_CLIENT_STORE_VERSION_UNSUPPORTED',
    direction: 'future',
  },
  {
    label: 'downgrade version',
    raw: JSON.stringify({ version: 0, retained: { secret: true } }),
    code: 'SNAPBACK_CLIENT_STORE_VERSION_UNSUPPORTED',
    direction: 'legacy',
  },
  {
    label: 'non-numeric version is redacted corruption',
    raw: JSON.stringify({ version: { secret: 'must-not-leak' }, pending: [{ secret: 'also-private' }] }),
    code: 'SNAPBACK_CLIENT_STORE_CORRUPT',
    direction: undefined,
    redacted: true,
  },
]) {
  const bytes = new Map([['invalid', invalid.raw]]);
  const storage = {
    getItem(key) { return bytes.get(key) ?? null; },
    setItem(key, value) { bytes.set(key, value); },
  };
  const store = createLocalStorageSnapbackClientStore({
    storage,
    key: 'invalid',
    lockManager: createTestLockManager(),
  });
  await assert.rejects(store.snapshot(), (error) => {
    assert.equal(error.code, invalid.code, invalid.label);
    assert.equal(error.diagnostic?.code, invalid.code, invalid.label);
    if (invalid.direction) {
      assert.equal(error.diagnostic?.details?.direction, invalid.direction, invalid.label);
    }
    if (invalid.redacted) {
      assert.equal(
        JSON.stringify(error.diagnostic).includes('must-not-leak'),
        false,
        `${invalid.label}: diagnostic must not copy persisted values`,
      );
    }
    return true;
  });
  await assert.rejects(store.enqueueMutation({ function: 'must-not-overwrite' }), {
    code: invalid.code,
  });
  assert.equal(bytes.get('invalid'), invalid.raw, `${invalid.label}: preserve exact original bytes`);
  await store.clear();
  const recovered = await store.snapshot();
  assert.equal(
    recovered.version,
    SNAPBACK_CLIENT_STORE_VERSION,
    `${invalid.label}: explicit reset recovers`,
  );
  assert.deepEqual(recovered.pending, [], `${invalid.label}: reset is visibly empty`);
}

// Opaque client mutation IDs and local sequence numbers are independent LLP
// fields. Prefix-like caller IDs remain valid, while automatic generation
// probes past an occupied ID instead of returning an unrelated old mutation.
const opaqueIdState = {
  ...additiveV1,
  version: SNAPBACK_CLIENT_STORE_VERSION,
  terminallyUnbound: false,
  queueAuthorization: {
    authorityGeneration: 0,
    queueGeneration: 0,
    pendingByScope: {},
  },
  origin: 'origin',
  nextSequence: 2,
  pending: [{
    id: 'cm_origin_custom',
    function: 'custom',
    sequence: 1,
    status: 'pending',
  }],
};
assert.equal((await createMemorySnapbackClientStore({ state: opaqueIdState }).snapshot())
  .pending[0].id, 'cm_origin_custom');

const generatedCollisionState = {
  ...additiveV1,
  version: SNAPBACK_CLIENT_STORE_VERSION,
  terminallyUnbound: false,
  queueAuthorization: {
    authorityGeneration: 0,
    queueGeneration: 0,
    pendingByScope: {},
  },
  origin: 'origin',
  nextSequence: 2,
  pending: [{
    id: 'cm_origin_2',
    function: 'callerOpaqueId',
    sequence: 1,
    status: 'pending',
  }],
};
const generatedCollisionStore = createMemorySnapbackClientStore({ state: generatedCollisionState });
const collisionSafe = await generatedCollisionStore.enqueueMutation({ function: 'newMutation' });
assert.equal(collisionSafe.id, 'cm_origin_3');
assert.equal(collisionSafe.sequence, 3);
assert.equal((await generatedCollisionStore.snapshot()).pending.length, 2);

// A caller can also hand the adapter an invalid new nested record. Validate a
// detached candidate before commit so that rejection leaves the shared memory
// reference just as intact as localStorage's prior bytes.
const rejectedWriteState = {};
const rejectedWriteStore = createMemorySnapbackClientStore({ state: rejectedWriteState });
await assert.rejects(
  rejectedWriteStore.enqueueMutation({
    function: 'futureLedger',
    ctxLedger: { version: 2, ids: [], now: 1 },
  }),
  { code: 'SNAPBACK_CLIENT_STORE_CORRUPT' },
);
await assert.rejects(
  rejectedWriteStore.putRetainedQuery('bad', {
    rows: [],
    cursor: { stream: 17, version: 'bad' },
  }),
  { code: 'SNAPBACK_CLIENT_STORE_CORRUPT' },
);
assert.deepEqual((await rejectedWriteStore.snapshot()).pending, []);
assert.deepEqual((await rejectedWriteStore.snapshot()).retained, {});
assert.deepEqual(rejectedWriteState.pending, [], 'rejected transaction preserves caller state');
assert.deepEqual(rejectedWriteState.retained, {}, 'rejected retained write preserves caller state');

assert.throws(
  () => createLocalStorageSnapbackClientStore({ storage: fakeStorage, lockManager: null }),
  { code: 'SNAPBACK_CLIENT_STORE_LOCK_UNAVAILABLE' },
  'localStorage must fail closed when cross-context serialization is unavailable',
);

// Two independently constructed tab/context stores enqueue concurrently under
// one same-origin lock name. Both records survive with one durable monotonic
// sequence; the pre-fix load/modify/save race lost one and reused sequence 1.
const sharedBytes = new Map();
let failNextSharedWrite = false;
const sharedStorage = {
  getItem(key) { return sharedBytes.get(key) ?? null; },
  setItem(key, value) {
    if (failNextSharedWrite) {
      failNextSharedWrite = false;
      throw new Error('simulated context crash during durable write');
    }
    sharedBytes.set(key, value);
  },
};
const sharedLocks = createTestLockManager();
const tabA = createLocalStorageSnapbackClientStore({
  storage: sharedStorage,
  key: 'tabs',
  lockManager: sharedLocks,
});
const tabB = createLocalStorageSnapbackClientStore({
  storage: sharedStorage,
  key: 'tabs',
  lockManager: sharedLocks,
});
const [queuedA, queuedB] = await Promise.all([
  tabA.enqueueMutation({ function: 'fromTabA' }),
  tabB.enqueueMutation({ function: 'fromTabB' }),
]);
assert.deepEqual([queuedA.sequence, queuedB.sequence], [1, 2]);
assert.notEqual(queuedA.id, queuedB.id);
assert.deepEqual(
  (await tabA.pendingMutations()).map((entry) => entry.function),
  ['fromTabA', 'fromTabB'],
);
const afterConcurrentEnqueue = await tabB.snapshot();
assert.equal(afterConcurrentEnqueue.nextSequence, 3);
assert.equal(afterConcurrentEnqueue.generation, 2, 'each committed transaction advances durable generation');

// A holder that dies while writing does not leave a lease wedged. Web Locks
// releases it; the next context takes over from the last committed generation.
failNextSharedWrite = true;
await assert.rejects(tabA.enqueueMutation({ function: 'crashedTab' }), /simulated context crash/);
const afterCrash = await tabB.enqueueMutation({ function: 'takeoverTab' });
assert.equal(afterCrash.sequence, 3);
assert.equal((await tabB.snapshot()).generation, 3, 'failed write did not consume a durable generation');
assert.deepEqual(
  (await tabA.pendingMutations()).map((entry) => entry.function),
  ['fromTabA', 'fromTabB', 'takeoverTab'],
);

// @ref LLP 0059#format-3-and-authority-tags — an old asynchronous writer may
// retain only its captured authority/queue tuple. If a successor settles while
// that work is paused, the eventual one-key Web-Lock holder must reload the
// successor bytes and reject before replacing the sole localStorage record.
{
  const authorityKeyA = `sha256:${'a'.repeat(64)}`;
  const authorityKeyB = `sha256:${'b'.repeat(64)}`;
  const key = 'stale-authority-writer';
  const bytes = new Map();
  const storage = {
    getItem(name) { return bytes.get(name) ?? null; },
    setItem(name, value) { bytes.set(name, value); },
  };
  const locks = createTestLockManager();
  const staleTab = createLocalStorageSnapbackClientStore({ storage, key, lockManager: locks });
  const successorTab = createLocalStorageSnapbackClientStore({ storage, key, lockManager: locks });
  const authorityA = { authorityEpoch: 0, authorityKey: authorityKeyA };
  await staleTab.bindAuthority({ ...authorityA, authMode: 'dev' });
  const staleQueue = await staleTab.captureMutationQueue(authorityA);

  let releaseStale;
  let staleStarted = false;
  const staleGate = new Promise((resolve) => { releaseStale = resolve; });
  const staleWriter = (async () => {
    staleStarted = true;
    await staleGate;
    return staleTab.enqueueMutation({
      function: 'mustNotLandUnderSuccessor',
      ...authorityA,
      ...staleQueue,
    });
  })();
  await Promise.resolve();
  assert.equal(staleStarted, true);

  await successorTab.transitionAuthority({
    expectedEpoch: 0,
    nextEpoch: 1,
    nextAuthorityKey: authorityKeyB,
  });
  const successorBytes = bytes.get(key);
  releaseStale();
  await assert.rejects(
    staleWriter,
    { code: 'SNAPBACK_CLIENT_STORE_AUTHORITY_STALE' },
    'the delayed predecessor writer reloads and rejects under the Web Lock',
  );
  assert.equal(bytes.get(key), successorBytes, 'stale rejection leaves the one stored key unchanged');
  assert.deepEqual(await successorTab.authorityScope(), {
    authorityEpoch: 1,
    authorityKey: authorityKeyB,
  });
  assert.deepEqual(await successorTab.pendingMutations(), []);
}

// A durable enqueue failure must roll back the already-rendered optimistic
// row and fail before contacting the server. Otherwise every later server-row
// write would re-apply a mutation that was neither sent nor safely queued.
const enqueueFailureClient = makeClient();
const enqueueFailureBaseStore = createMemorySnapbackClientStore();
const enqueueFailureStore = {
  ...enqueueFailureBaseStore,
  async enqueueMutation() {
    throw new Error('durable enqueue unavailable');
  },
};
const enqueueFailureSurface = await createSnapbackContractSurface({
  runtime,
  client: enqueueFailureClient,
  clientStore: enqueueFailureStore,
  userId: USER,
  manifest,
  queryName: 'listTodos',
  boundaryKey: 'todos',
  ...retainedSurfaceIdentity,
});
await assert.rejects(
  enqueueFailureSurface.links.createTodo({ title: 'must roll back' }),
  (error) => {
    assert.equal(error.diagnostic?.code, 'SNAPBACK_CLIENT_STORE_WRITE_FAILED');
    assert.equal(error.diagnostic?.details?.operation, 'enqueueMutation');
    return true;
  },
);
assert.deepEqual(enqueueFailureSurface.boundary.current('todos'), []);
assert.equal(enqueueFailureSurface.pendingCount(), 0);
assert.deepEqual(enqueueFailureClient.state.deliveries, []);
assert.equal(
  enqueueFailureSurface.diagnostics.filter(
    (diagnostic) => diagnostic.code === 'SNAPBACK_CLIENT_STORE_WRITE_FAILED'
      && diagnostic.details?.operation === 'enqueueMutation',
  ).length,
  1,
);
enqueueFailureSurface.dispose();

console.log('offline-replay.test.mjs: all assertions passed');
