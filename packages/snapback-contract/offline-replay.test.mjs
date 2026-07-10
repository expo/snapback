// LLP 0043 M1/M2 / ENG-23965: retained boot + durable ordered mutation replay
// through the real Contract adapter, including response loss after commit.

import assert from 'node:assert/strict';

import {
  createLocalStorageSnapbackClientStore,
  createMemorySnapbackClientStore,
  createSnapbackContractSurface,
  snapbackAuthFingerprint,
} from './index.mjs';

const USER = 'user_offline';
assert.equal(snapbackAuthFingerprint(USER), 'fnv1a:2b4ee138e8fc12c8');

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

function makeClient() {
  const state = {
    online: true,
    rows: [],
    version: 0,
    settlements: new Map(),
    applied: [],
    deliveries: [],
    loseAfterCommit: null,
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
    async query() {
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
      if (!state.online) offline();
      const id = request.clientMutationId;
      assert.ok(id, 'replayed mutation must carry clientMutationId');
      assert.ok(request.ctxLedger, 'replayed mutation must carry ctxLedger');
      state.deliveries.push({ name, id });
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
});

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
assert.match(todoId, /^cm_createTodo_.+_id_1$/);
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
assert.equal(client.state.settlements.size, 3);
second.dispose();

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

// The actual localStorage adapter round-trips through serialized bytes: a new
// adapter object sees retained rows + queue, and an artifact revision
// quarantines (typed failed) rather than replaying the old mutation.
const storageBytes = new Map();
const fakeStorage = {
  getItem(key) { return storageBytes.get(key) ?? null; },
  setItem(key, value) { storageBytes.set(key, value); },
};
const durableA = createLocalStorageSnapbackClientStore({ storage: fakeStorage, key: 'test' });
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
const durableB = createLocalStorageSnapbackClientStore({ storage: fakeStorage, key: 'test' });
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
