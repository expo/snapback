// Regression: the in-flight optimistic overlay must not duplicate a row the
// server already committed (ENG-23385; the dual of LLP 0034 review fix 3).
//
// Every server-rows write re-applies still-in-flight optimistic reducers —
// but "in flight" means the mutate() HTTP response has not resolved, and the
// server may have already committed and fanned out. A concurrent mutation's
// reconcile (or the client's own live_replace racing the HTTP response)
// delivers rows that already CONTAIN the committed row; a naive insert
// reducer then appends the optimistic copy again, rendering the row twice
// until the response resolves. The fix specs reducers as idempotent and has
// the adapter record each op's baseVersion (max server-row _version at
// mutation time) so the canonical demo reducer can recognize its own landed
// commit without suppressing genuinely new duplicate-title creates.
//
// Uses the actual todo demo reducers (the canonical insert reducer the issue
// names). Pure mock client/runtime; runs under plain node (no server, no
// Exact).

import assert from 'node:assert/strict';

import { createSnapbackContractSurface } from './index.mjs';
import { todoOptimisticReducers } from '../../demos/todo/surfaces/contract/optimistic.mjs';

const makeManifest = () => ({
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  // Non-live descriptor: reconcile-on-mutate is the server-rows write path.
  queries: { listTodos: {} },
  mutations: { createTodo: {}, setCompleted: {} },
});

// Boundary mock that actually holds rows, so duplicates are observable.
const makeRuntime = () => ({
  createContractMockQueryBoundary: (initialRows) => {
    const rows = { ...initialRows };
    return {
      current: (key) => rows[key],
      write: (key, fn) => {
        rows[key] = fn(rows[key]);
      },
      query: (key, fn) => fn(rows[key]),
    };
  },
  createBoundaryContractDataProvider: () => ({
    subscribe: () => ({ dispose: () => {} }),
  }),
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

// Client whose authoritative rows are mutable mid-test: queries always serve
// the current serverRows; mutate behaviors are installed per name.
const makeClient = (initialServerRows) => {
  const state = { serverRows: initialServerRows, mutations: {} };
  return {
    state,
    async query() {
      return { rows: [...state.serverRows] };
    },
    async mutate(name) {
      const behavior = state.mutations[name];
      if (!behavior) throw new Error(`no mutate behavior for ${name}`);
      return behavior();
    },
  };
};

const makeSurface = async (client) =>
  createSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    queryName: 'listTodos',
    boundaryKey: 'todos',
    optimisticReducers: todoOptimisticReducers,
  });

const milkRows = (surface) =>
  surface.boundary.current('todos').filter((row) => row.title === 'milk');

// --- the issue's failure scenario: commit fans out before mutate() resolves ---
{
  const seed = [{ _id: 'todo_1', title: 'existing', completed: false, userId: 'u1', _version: 1 }];
  const client = makeClient(seed);
  const surface = await makeSurface(client);

  // createTodo's response is slow (e.g. the server write mutex is held), but
  // the server commits the row before the response resolves.
  const slow = deferred();
  client.state.mutations.createTodo = () => {
    client.state.serverRows = [
      ...client.state.serverRows,
      { _id: 'todo_2', title: 'milk', completed: false, userId: 'u1', _version: 2 },
    ];
    return slow.promise;
  };
  client.state.mutations.setCompleted = () => {
    client.state.serverRows = client.state.serverRows.map((row) =>
      row._id === 'todo_1' ? { ...row, completed: true, _version: 3 } : row,
    );
    return Promise.resolve();
  };

  const createTask = surface.links.createTodo({ title: 'milk' });
  assert.equal(milkRows(surface).length, 1, 'optimistic row appears once during the in-flight window');

  // The user immediately toggles another todo; its reconcile fetches rows
  // that already include the committed new todo while createTodo is still in
  // flight — the overlay re-applies createTodo's reducer on top.
  await surface.links.setCompleted({ id: 'todo_1', completed: true });

  const during = milkRows(surface);
  assert.equal(
    during.length,
    1,
    `committed row is not doubled by its own in-flight overlay (got ${during.length} copies)`,
  );
  assert.equal(during[0]._id, 'todo_2', 'the committed row wins over the optimistic copy');
  assert.equal(
    surface.boundary.current('todos').find((row) => row._id === 'todo_1')?.completed,
    true,
    'the concurrent toggle is visible',
  );

  // Response resolves; reconcile converges on the authoritative rows.
  slow.resolve();
  await createTask;
  await surface.flush();
  assert.equal(milkRows(surface).length, 1, 'converged: exactly one committed row');
  assert.equal(surface.pendingCount(), 0, 'no pending work left behind');
  surface.dispose();
}

// --- precision guard: a pre-existing same-title row must NOT suppress the
// --- optimistic append (baseVersion distinguishes it from a landed commit),
// --- and the optimistic row still survives a reconcile that lacks it
// --- (LLP 0034 review fix 3, the flash-out direction).
{
  const seed = [
    { _id: 'todo_1', title: 'milk', completed: false, userId: 'u1', _version: 1 },
    { _id: 'todo_2', title: 'other', completed: false, userId: 'u1', _version: 2 },
  ];
  const client = makeClient(seed);
  const surface = await makeSurface(client);

  const slow = deferred();
  // The server has NOT committed yet: serverRows stay as seeded.
  client.state.mutations.createTodo = () => slow.promise;
  client.state.mutations.setCompleted = () => {
    client.state.serverRows = client.state.serverRows.map((row) =>
      row._id === 'todo_2' ? { ...row, completed: true, _version: 3 } : row,
    );
    return Promise.resolve();
  };

  const createTask = surface.links.createTodo({ title: 'milk' });
  assert.equal(
    milkRows(surface).length,
    2,
    'a genuinely new duplicate-title create still gets its optimistic row',
  );

  // A concurrent reconcile whose rows legitimately lack the uncommitted row
  // (and whose versions advanced) must not flash the optimistic row out —
  // and must not suppress it either: no matching row is newer than base in
  // a way that represents this commit... the committed "milk" row predates
  // the mutation (version 1 <= baseVersion 2), so the append is re-applied.
  await surface.links.setCompleted({ id: 'todo_2', completed: true });
  assert.equal(milkRows(surface).length, 2, 'optimistic row survives the concurrent reconcile');

  // Now the commit lands server-side and the response resolves.
  client.state.serverRows = [
    ...client.state.serverRows,
    { _id: 'todo_3', title: 'milk', completed: false, userId: 'u1', _version: 4 },
  ];
  slow.resolve();
  await createTask;
  await surface.flush();
  const finalMilk = milkRows(surface);
  assert.equal(finalMilk.length, 2, 'converged: both committed duplicate-title rows');
  assert.equal(
    finalMilk.every((row) => row.optimistic !== true),
    true,
    'no optimistic copies remain after commit',
  );
  surface.dispose();
}

// --- a synchronous optimistic reducer failure is a rejected mutation task,
// --- not a permanently registered overlay. Later authoritative live rows
// --- must publish without re-running the failed reducer (ENG-24495).
{
  const seed = [{ _id: 'todo_1', title: 'before', completed: false, userId: 'u1', _version: 1 }];
  const liveManifest = {
    ...makeManifest(),
    queries: {
      listTodos: {
        name: 'listTodos',
        mode: 'live',
        defaultLive: true,
      },
    },
  };
  let onUpdate = null;
  let mutateCalls = 0;
  let reducerCalls = 0;
  let disposed = false;
  const client = {
    async liveQuery(_name, options) {
      onUpdate = options.onUpdate;
      return {
        rows: [...seed],
        version: 1,
        connection: 'live',
        dispose() { disposed = true; },
      };
    },
    async mutate() {
      mutateCalls += 1;
    },
  };
  const surface = await createSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: liveManifest,
    queryName: 'listTodos',
    boundaryKey: 'todos',
    optimisticReducers: {
      createTodo(rows) {
        reducerCalls += 1;
        rows.push({ _id: 'mutated_before_throw', title: 'phantom' });
        throw new Error('app reducer exploded');
      },
    },
  });

  // Merely calling the link no longer throws synchronously. It returns the
  // same tracked-promise shape as every other mutation failure.
  const failedTask = surface.links.createTodo({ title: 'never delivered' });
  assert.equal(typeof failedTask?.then, 'function');
  await assert.rejects(failedTask, (error) => {
    assert.equal(error.code, 'SNAPBACK_CONTRACT_OPTIMISTIC_REDUCER_FAILED');
    assert.equal(error.diagnostic?.details?.mutation, 'createTodo');
    assert.equal(error.cause?.message, 'app reducer exploded');
    return true;
  });
  assert.equal(mutateCalls, 0, 'transport never starts after local prediction failure');
  assert.equal(reducerCalls, 1);
  assert.equal(surface.pendingCount(), 0);
  assert.deepEqual(surface.boundary.current('todos'), seed, 'authoritative rows restored');
  assert.equal(
    surface.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'SNAPBACK_CONTRACT_OPTIMISTIC_REDUCER_FAILED',
    ).length,
    1,
  );

  const after = [{ _id: 'todo_2', title: 'server truth', completed: false, userId: 'u1', _version: 2 }];
  onUpdate(after, { version: 2, kind: 'live_replace' });
  assert.equal(reducerCalls, 1, 'later live delivery never re-runs the retired reducer');
  assert.deepEqual(surface.boundary.current('todos'), after);
  surface.dispose();
  assert.equal(disposed, true);
}

// Authorization invalidation owns the render boundary synchronously. Neither
// an ordinary live callback nor an optimistic reducer may repopulate it before
// an authenticated replacement snapshot releases the query fence.
{
  const seed = [{ _id: 'todo_auth_1', title: 'visible', completed: false, userId: 'u1', _version: 1 }];
  let liveOptions;
  let mutateCalls = 0;
  let reducerCalls = 0;
  const client = {
    async liveQuery(_name, options) {
      liveOptions = options;
      return {
        rows: [...seed],
        version: 1,
        connection: 'live',
        dispose() {},
      };
    },
    async mutate() {
      mutateCalls += 1;
    },
  };
  const surface = await createSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: {
      ...makeManifest(),
      queries: { listTodos: { mode: 'live', defaultLive: true } },
    },
    queryName: 'listTodos',
    boundaryKey: 'todos',
    optimisticReducers: {
      createTodo(rows) {
        reducerCalls += 1;
        return [...rows, { _id: 'must_not_render', title: 'hidden' }];
      },
    },
  });

  liveOptions.onAuthorizationBoundary([], { kind: 'authorization_quarantine', version: 1 });
  assert.deepEqual(surface.boundary.current('todos'), [], 'quarantine blanks synchronously');

  liveOptions.onUpdate(
    [{ _id: 'late_live', title: 'late', _version: 2 }],
    { kind: 'live_replace', version: 2 },
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(surface.boundary.current('todos'), [], 'ordinary live callback stays hidden');

  assert.throws(
    () => surface.links.createTodo({ title: 'blocked' }),
    { code: 'SNAPBACK_AUTH_QUERY_QUARANTINED' },
  );
  assert.equal(reducerCalls, 0, 'optimistic reducer never runs behind the fence');
  assert.equal(mutateCalls, 0, 'transport never starts behind the fence');
  assert.deepEqual(surface.boundary.current('todos'), []);

  const fresh = [{ _id: 'todo_auth_2', title: 'fresh', completed: false, userId: 'u1', _version: 3 }];
  liveOptions.onAuthorizationBoundary(fresh, { kind: 'authorization_snapshot', version: 3 });
  assert.deepEqual(surface.boundary.current('todos'), fresh);

  liveOptions.onAuthorizationBoundary([], {
    kind: 'authorization_error',
    version: 3,
    error: new Error('injected durable queue failure'),
  });
  assert.deepEqual(surface.boundary.current('todos'), [], 'authorization faults also blank synchronously');
  surface.dispose();
}

console.log('optimistic-duplicate-reapply.test.mjs: all assertions passed');
