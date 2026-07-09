// The E-B gate, reconcile-failure leg (Exact LLP 0329 §E5): derived overlays
// must pass the adapter's existing reducer regression suite. This is
// mutation-reconcile-failure.test.mjs (ENG-23384) with the hand-written
// reducers REMOVED — the manifest embeds IR plans and the adapter derives
// the overlays. Same scenarios, same assertions: a failed mutation whose
// reconcile also fails rolls the boundary back (no stranded phantom row),
// surviving in-flight derived ops re-overlay, and the caller receives the
// mutation error with the reconcile failure as cause.
//
// Pure mock client/runtime; runs under plain node (no server, no Exact).

import assert from 'node:assert/strict';

import { createSnapbackContractSurface } from './index.mjs';

const insertPlan = {
  steps: [
    {
      Insert: {
        table: 'todos',
        values: { title: { Arg: 'title' } },
        bind_id_as: 'id',
      },
    },
  ],
  return_value: { Binding: 'id' },
};

const makeManifest = () => ({
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  // Non-live descriptor: one snapshot read plus reconcile-on-mutate, the mode
  // where nothing else ever rewrites the boundary.
  queries: { listTodos: { reads: ['todos'] } },
  mutations: {
    createTodo: { optimistic: true, plan: insertPlan },
    slowCreate: { optimistic: true, plan: insertPlan },
  },
});

// Boundary mock that actually holds rows, so rollback is observable.
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

const seedRows = [{ _id: 'seed_1', title: 'seeded', _version: 1 }];

// Client: the initial snapshot query succeeds; after `state.offline` flips,
// every query (i.e. reconcile) rejects. Mutations run per-name behaviors.
const makeClient = () => {
  const state = { offline: false, mutations: {} };
  return {
    state,
    async query() {
      if (state.offline) {
        throw new Error('network down: query');
      }
      return { rows: seedRows };
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
    // No optimisticReducers: the derived overlays are under test.
  });

// --- failed mutation + failed reconcile: rollback and honest error ---
{
  const client = makeClient();
  const surface = await makeSurface(client);
  client.state.offline = true;
  client.state.mutations.createTodo = () => Promise.reject(new Error('network down: mutate'));

  const task = surface.links.createTodo({ title: 'phantom' });
  assert.equal(
    surface.boundary.current('todos').some((row) => row.title === 'phantom'),
    true,
    'derived optimistic row appears during the in-flight window',
  );

  let caught = null;
  try {
    await task;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'mutation must reject');
  assert.equal(caught.message, 'network down: mutate', 'caller sees the MUTATION error, not the reconcile error');
  assert.equal(caught.cause?.message, 'network down: query', 'reconcile failure travels as cause');

  assert.deepEqual(
    surface.boundary.current('todos'),
    seedRows,
    'boundary rolled back to the last known server rows — no stranded phantom row',
  );
  assert.ok(
    surface.diagnostics.some((d) => d.code === 'SNAPBACK_CONTRACT_MUTATION_FAILED' && d.details?.mutation === 'createTodo'),
    'mutation failure diagnostic published',
  );
  assert.equal(surface.pendingCount(), 0, 'no pending work left behind');
  surface.dispose();
}

// --- the rollback re-overlays OTHER still-in-flight derived ops ---
{
  const client = makeClient();
  const surface = await makeSurface(client);
  const slow = deferred();
  client.state.mutations.slowCreate = () => slow.promise;
  client.state.mutations.createTodo = () => Promise.reject(new Error('network down: mutate'));

  const slowTask = surface.links.slowCreate({ title: 'survivor' });
  client.state.offline = true;
  const failedTask = surface.links.createTodo({ title: 'phantom' });
  await failedTask.catch(() => {});

  const rows = surface.boundary.current('todos');
  assert.equal(rows.some((row) => row.title === 'phantom'), false, 'failed derived op rolled back');
  assert.equal(rows.some((row) => row.title === 'survivor'), true, 'in-flight sibling derived op survives the rollback');
  assert.equal(rows.some((row) => row._id === 'seed_1'), true, 'server rows preserved');

  client.state.offline = false;
  slow.resolve();
  await slowTask;
  assert.deepEqual(surface.boundary.current('todos'), seedRows, 'committed reconcile republishes authoritative rows');
  surface.dispose();
}

console.log('derived-overlay-reconcile-failure.test.mjs: all assertions passed');
