// The E-B gate, duplicate-reapply leg (Exact LLP 0329 §E5): derived overlays
// must pass the adapter's existing reducer regression suite before replacing
// a reducer anywhere. This is optimistic-duplicate-reapply.test.mjs with the
// hand-written todo reducers REMOVED — the manifest embeds the IR plans and
// the adapter derives the overlays. Same failure scenarios (ENG-23385), same
// assertions; plus the E-B receipt contract: mutation receipts matching this
// surface identify the overlay class per mutation.
//
// Pure mock client/runtime; runs under plain node (no server, no Exact).

import assert from 'node:assert/strict';

import { createSnapbackContractSurface } from './index.mjs';

const createTodoPlan = {
  steps: [
    {
      Insert: {
        table: 'todos',
        values: {
          title: { Arg: 'title' },
          completed: { Literal: false },
          userId: 'AuthUserId',
        },
        bind_id_as: 'todoId',
      },
    },
  ],
  return_value: { Binding: 'todoId' },
};

const setCompletedPlan = {
  steps: [
    {
      Patch: {
        table: 'todos',
        id: { Arg: 'id' },
        values: { completed: { Arg: 'completed' } },
      },
    },
  ],
  return_value: null,
};

const makeManifest = () => ({
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  // Non-live descriptor with the boundary's table declared: reconcile-on-mutate
  // is the server-rows write path, `reads` is the derivation join.
  queries: { listTodos: { reads: ['todos'] } },
  mutations: {
    createTodo: { optimistic: true, plan: createTodoPlan },
    setCompleted: { optimistic: true, plan: setCompletedPlan },
  },
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

// Client whose authoritative rows are mutable mid-test, with a minimal
// receipt surface: mutate behaviors may return `{ receipt }` and the kit-ring
// shape notifies listeners (the adapter enriches on the way through).
const makeClient = (initialServerRows) => {
  const state = { serverRows: initialServerRows, mutations: {} };
  const receiptListeners = new Set();
  const receiptRing = [];
  return {
    state,
    receiptRing,
    async query() {
      return { rows: [...state.serverRows] };
    },
    async mutate(name, { correlation } = {}) {
      const behavior = state.mutations[name];
      if (!behavior) throw new Error(`no mutate behavior for ${name}`);
      const result = await behavior();
      const receipt = {
        kind: 'mutation',
        mutationId: `mut_${receiptRing.length + 1}`,
        mutation: name,
        outcome: 'confirmed',
        rollbackReason: null,
        affectedTables: ['todos'],
        snapshotVersion: 1,
        transport: 'http',
        correlation: correlation ?? null,
        receivedAtMs: 1,
      };
      receiptRing.push(receipt);
      for (const listener of [...receiptListeners]) listener(receipt);
      return result;
    },
    receipts() {
      return [...receiptRing];
    },
    onReceipt(listener) {
      receiptListeners.add(listener);
      return () => receiptListeners.delete(listener);
    },
  };
};

const observedReceipts = [];

const makeSurface = async (client) =>
  createSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    queryName: 'listTodos',
    boundaryKey: 'todos',
    // No optimisticReducers: the derived overlays are under test.
    onReceipt: (receipt) => observedReceipts.push(receipt),
  });

const milkRows = (surface) =>
  surface.boundary.current('todos').filter((row) => row.title === 'milk');

// --- the issue's failure scenario: commit fans out before mutate() resolves ---
{
  const seed = [{ _id: 'todo_1', title: 'existing', completed: false, userId: 'u1', _version: 1 }];
  const client = makeClient(seed);
  const surface = await makeSurface(client);

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
  assert.equal(milkRows(surface).length, 1, 'derived optimistic row appears once during the in-flight window');
  assert.equal(milkRows(surface)[0].optimistic, true, 'derived row is marked optimistic');
  assert.equal(milkRows(surface)[0].userId, 'u1', 'AuthUserId evaluates to the surface user');

  // Concurrent toggle reconciles rows that already contain the committed
  // create while it is still in flight — the derived reducer re-applies.
  await surface.links.setCompleted({ id: 'todo_1', completed: true });

  const during = milkRows(surface);
  assert.equal(
    during.length,
    1,
    `committed row is not doubled by its own in-flight derived overlay (got ${during.length} copies)`,
  );
  assert.equal(during[0]._id, 'todo_2', 'the committed row wins over the optimistic copy');
  assert.equal(
    surface.boundary.current('todos').find((row) => row._id === 'todo_1')?.completed,
    true,
    'the concurrent derived Patch overlay is visible',
  );

  slow.resolve();
  await createTask;
  await surface.flush();
  assert.equal(milkRows(surface).length, 1, 'converged: exactly one committed row');
  assert.equal(surface.pendingCount(), 0, 'no pending work left behind');

  // E-B receipt contract: receipts produced through this surface identify the
  // overlay class per mutation (LLP 0329 §E5 / EQ5) on both the listener and
  // the ring surface.
  assert.ok(observedReceipts.length >= 2, 'mutation receipts observed');
  assert.ok(
    observedReceipts.every((receipt) => receipt.overlayClass === 'derived'),
    `listener receipts carry overlayClass 'derived' (got ${JSON.stringify(observedReceipts.map((r) => r.overlayClass))})`,
  );
  assert.ok(
    surface.receipts().every((receipt) => receipt.overlayClass === 'derived'),
    'ring receipts carry overlayClass through the surface getter',
  );
  surface.dispose();
}

// --- precision guard: a pre-existing same-title row must NOT suppress the
// --- optimistic append (baseVersion distinguishes it from a landed commit),
// --- and the optimistic row still survives a reconcile that lacks it.
{
  const seed = [
    { _id: 'todo_1', title: 'milk', completed: false, userId: 'u1', _version: 1 },
    { _id: 'todo_2', title: 'other', completed: false, userId: 'u1', _version: 2 },
  ];
  const client = makeClient(seed);
  const surface = await makeSurface(client);

  const slow = deferred();
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
    'a genuinely new duplicate-title create still gets its derived optimistic row',
  );

  await surface.links.setCompleted({ id: 'todo_2', completed: true });
  assert.equal(milkRows(surface).length, 2, 'derived optimistic row survives the concurrent reconcile');

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

console.log('derived-overlay-duplicate-reapply.test.mjs: all assertions passed');
