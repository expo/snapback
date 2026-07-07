// Regression: a failed reconcile after a failed mutation must not strand the
// optimistic row in the boundary or mask the mutation error (ENG-23384).
//
// The mutation catch path removes the failed op from inFlightOptimistic and
// relies on reconcile() to republish authoritative rows — but when the
// mutation failed because the server is unreachable, reconcile's query fails
// too. Without a local rollback the boundary keeps presenting the phantom
// optimistic row as ready data forever (non-live mode never rewrites the
// boundary again on its own), and the caller receives the reconcile error
// instead of the mutation failure. The fix rolls the boundary back from the
// last known server rows (surviving in-flight ops re-overlaid) and rethrows
// the original mutation error with the reconcile failure attached as cause.
//
// Pure mock client/runtime; runs under plain node (no server, no Exact).

import assert from 'node:assert/strict';

import { createSnapbackContractSurface } from './index.mjs';

const makeManifest = () => ({
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  // Non-live descriptor: one snapshot read plus reconcile-on-mutate, the mode
  // where nothing else ever rewrites the boundary.
  queries: { listTodos: {} },
  mutations: { createTodo: {}, slowCreate: {} },
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

const appendReducer = (rows, args, { optimisticId }) => [
  ...rows,
  { _id: optimisticId, title: args.title, _version: 0 },
];

const makeSurface = async (client) =>
  createSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    queryName: 'listTodos',
    boundaryKey: 'todos',
    optimisticReducers: { createTodo: appendReducer, slowCreate: appendReducer },
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
    'optimistic row appears during the in-flight window',
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
  assert.ok(
    surface.diagnostics.some((d) => d.code === 'SNAPBACK_CONTRACT_RECONCILE_FAILED' && d.details?.mutation === 'createTodo'),
    'reconcile failure diagnostic published',
  );
  assert.equal(surface.pendingCount(), 0, 'no pending work left behind');
  surface.dispose();
}

// --- the rollback re-overlays OTHER still-in-flight optimistic ops ---
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
  assert.equal(rows.some((row) => row.title === 'phantom'), false, 'failed op rolled back');
  assert.equal(rows.some((row) => row.title === 'survivor'), true, 'in-flight sibling op survives the rollback');
  assert.equal(rows.some((row) => row._id === 'seed_1'), true, 'server rows preserved');

  // Let the survivor commit once connectivity returns; its reconcile succeeds.
  client.state.offline = false;
  slow.resolve();
  await slowTask;
  assert.deepEqual(surface.boundary.current('todos'), seedRows, 'committed reconcile republishes authoritative rows');
  surface.dispose();
}

// --- a mutation error that already carries a cause keeps it ---
{
  const client = makeClient();
  const surface = await makeSurface(client);
  client.state.offline = true;
  const original = new Error('network down: mutate', { cause: new Error('ECONNREFUSED') });
  client.state.mutations.createTodo = () => Promise.reject(original);

  let caught = null;
  try {
    await surface.links.createTodo({ title: 'phantom' });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, original);
  assert.equal(caught.cause?.message, 'ECONNREFUSED', 'pre-existing cause is not overwritten');
  assert.deepEqual(surface.boundary.current('todos'), seedRows, 'rollback still happens');
  surface.dispose();
}

console.log('mutation-reconcile-failure.test.mjs: all assertions passed');
