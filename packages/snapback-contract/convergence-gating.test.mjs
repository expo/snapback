// LLP 0200 Phase 1: settled optimistic overlays remain visible until this
// subscription observes an authoritative server version at/after the
// mutation's committed version. Older late frames cannot regress the boundary.
// Pure mock client/runtime; runs under plain node (no server, no Exact).

import assert from 'node:assert/strict';

import { createSnapbackContractSurface } from './index.mjs';

const manifest = {
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  queries: { listTodos: { mode: 'live', defaultLive: true } },
  mutations: { createTodo: {} },
};

const runtime = {
  createContractMockQueryBoundary(initialRows) {
    const rows = { ...initialRows };
    return {
      current: (key) => rows[key],
      write(key, update) { rows[key] = update(rows[key]); },
      query: (key, read) => read(rows[key]),
    };
  },
  createBoundaryContractDataProvider: () => ({
    subscribe: () => ({ dispose() {} }),
  }),
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const waitFor = async (predicate, message) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
};

const optimisticCreate = (rows, args, { optimisticId, baseVersion }) => {
  if (rows.some((row) => row.title === args.title && row._version > baseVersion)) return rows;
  return [
    ...rows,
    { _id: optimisticId, title: args.title, _version: 0, optimistic: true },
  ];
};

const makeSurface = async ({ mutate, query }) => {
  const initial = [{ _id: 'seed', title: 'seed', _version: 5 }];
  const state = { liveOptions: null, queryCalls: 0 };
  const client = {
    async liveQuery(_name, options) {
      state.liveOptions = options;
      return { rows: initial, version: 5, connection: 'live', dispose() {} };
    },
    async mutate(name, options) {
      return mutate(name, options);
    },
    async query(name, options) {
      state.queryCalls += 1;
      return query(name, options);
    },
  };
  const surface = await createSnapbackContractSurface({
    runtime,
    client,
    userId: 'u1',
    manifest,
    queryName: 'listTodos',
    boundaryKey: 'todos',
    optimisticReducers: { createTodo: optimisticCreate },
  });
  return { surface, state };
};

// A current_as_of at V releases only after its held rows apply. A later frame
// below the accepted server boundary is ignored, and a subsequent deletion
// proves the settled overlay is no longer being re-applied.
{
  const reconcile = deferred();
  const { surface, state } = await makeSurface({
    mutate: async () => ({ result: { ok: true }, version: 7 }),
    query: async () => reconcile.promise,
  });
  const task = surface.links.createTodo({ title: 'committed' });
  assert.equal(surface.boundary.current('todos').some((row) => row.optimistic), true);
  await waitFor(() => state.queryCalls === 1, 'settlement must enter reconcile');

  const committed = [{ _id: 'server-7', title: 'committed', _version: 7 }];
  state.liveOptions.onUpdate(committed, { kind: 'current_as_of', version: 7 });
  assert.deepEqual(surface.boundary.current('todos'), committed);

  state.liveOptions.onUpdate(
    [{ _id: 'seed', title: 'stale-before-write', _version: 6 }],
    { kind: 'live_replace', version: 6 },
  );
  assert.deepEqual(
    surface.boundary.current('todos'),
    committed,
    'a late frame below the applied boundary cannot regress settled state',
  );

  state.liveOptions.onUpdate([], { kind: 'live_replace', version: 8 });
  assert.deepEqual(
    surface.boundary.current('todos'),
    [],
    'the V=7 watermark released the overlay before the V=8 authoritative deletion',
  );
  reconcile.resolve({ rows: [], version: 8 });
  await task;
  surface.dispose();
}

// The ordinary post-settlement reconcile is the prompt convergence fast path:
// its snapshot at V applies, then retires the overlay without waiting for push.
{
  const committed = [{ _id: 'server-7', title: 'fast', _version: 7 }];
  const { surface, state } = await makeSurface({
    mutate: async () => ({ result: { ok: true }, version: 7 }),
    query: async () => ({ rows: committed, version: 7 }),
  });
  await surface.links.createTodo({ title: 'fast' });
  assert.deepEqual(surface.boundary.current('todos'), committed);
  state.liveOptions.onUpdate([], { kind: 'live_replace', version: 8 });
  assert.deepEqual(
    surface.boundary.current('todos'),
    [],
    'reconcile at the committed version released the optimistic overlay',
  );
  surface.dispose();
}

// A refused write has no convergence milestone. Its optimistic overlay still
// retires at failure settlement and rollback/reconcile remains immediate.
{
  const refusal = Object.assign(new Error('write refused'), {
    receipt: { id: 'refused' },
    diagnostic: { code: 'SNAPBACK_TEST_REFUSED', message: 'write refused' },
  });
  const { surface, state } = await makeSurface({
    mutate: async () => { throw refusal; },
    query: async () => ({
      rows: [{ _id: 'seed', title: 'seed', _version: 5 }],
      version: 5,
    }),
  });
  const task = surface.links.createTodo({ title: 'refused' });
  assert.equal(surface.boundary.current('todos').some((row) => row.optimistic), true);
  await assert.rejects(task, (error) => error === refusal);
  assert.equal(surface.boundary.current('todos').some((row) => row.optimistic), false);
  state.liveOptions.onUpdate([], { kind: 'live_replace', version: 6 });
  assert.deepEqual(
    surface.boundary.current('todos'),
    [],
    'a refused mutation leaves no overlay to reapply after settlement',
  );
  surface.dispose();
}

console.log('convergence-gating.test.mjs: all assertions passed');
