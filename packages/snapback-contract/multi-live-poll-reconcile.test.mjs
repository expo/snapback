// Regression: multi-live mode honors the documented poll/reconcile opt-out
// (ENG-23386).
//
// `livePush: false` — or a client without liveQuery() — promises "poll/
// reconcile only" (LLP 0034 D1), and single-query mode honors it with a
// client.query snapshot plus reconcile-on-mutate. Multi-live mode used to
// initialize every cell to [], skip the subscribe loop, never issue any
// client.query snapshot, and never reconcile — every cell stayed [] with
// ready status forever while mutations silently committed server-side.
// Asserts: initial cells seed from per-entry snapshots (with the configured
// args), mutations reconcile every configured entry, a reconcile failure is
// surfaced as SNAPBACK_CONTRACT_RECONCILE_FAILED (not a mutation failure),
// and the live-push path still never polls.
//
// Pure mock client/runtime; runs under plain node (no server, no Exact).

import assert from 'node:assert/strict';

import { createSnapbackContractSurface } from './index.mjs';

const makeManifest = () => ({
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  queries: {
    alpha: { mode: 'live' },
    beta: { mode: 'live' },
    gamma: { mode: 'snapshot' }, // deliberately omitted from liveQueries
  },
  mutations: {
    addRow: {},
  },
});

// Server-side store the mock client serves snapshots from and mutates.
const makeClient = ({ withLiveQuery = false, failQueryAfterMutate = false } = {}) => {
  const store = {
    alpha: [{ _id: 'a1', _version: 1 }],
    beta: [{ _id: 'b1', _version: 1 }],
  };
  const state = { queryCalls: [], liveQueryCalls: 0, liveQueryOptions: [], mutated: false };
  const client = {
    store,
    state,
    async query(name, { args } = {}) {
      if (failQueryAfterMutate && state.mutated) {
        throw new Error(`query outage for ${name}`);
      }
      state.queryCalls.push({ name, args: args ?? {} });
      return { rows: store[name] ?? [] };
    },
    async mutate(name, { args } = {}) {
      state.mutated = true;
      store.alpha = [...store.alpha, { _id: args.id, _version: 2 }];
      return { ok: true };
    },
  };
  if (withLiveQuery) {
    client.liveQuery = async (name, options) => {
      state.liveQueryCalls += 1;
      state.liveQueryOptions.push({ name, options });
      return {
        rows: store[name] ?? [],
        connection: 'live',
        dispose() {},
      };
    };
  }
  return client;
};

// Boundary mock that actually stores rows so tests can observe writes.
const makeRuntime = () => ({
  createProviderQueryHandle: (provider, name, args) => ({
    subscribe(observer) {
      return provider.subscribe(name, args, observer);
    },
  }),
  createContractMockQueryBoundary: (initialRows) => {
    const cells = new Map(Object.entries(initialRows));
    return {
      cells,
      write(key, fn) {
        cells.set(key, fn(cells.get(key)));
      },
      query(key) {
        return cells.get(key);
      },
    };
  },
  createBoundaryContractDataProvider: () => ({
    subscribe: () => ({ dispose: () => {} }),
  }),
});

// --- compiler-known bindings refuse an incomplete multi-live config at boot ---
{
  const client = makeClient({ withLiveQuery: true });
  let caught = null;
  try {
    await createSnapbackContractSurface({
      runtime: makeRuntime(),
      client,
      userId: 'u1',
      manifest: makeManifest(),
      livePush: false,
      liveQueries: ['alpha'],
      requiredQueries: ['alpha', 'gamma'],
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'an omitted required binding must refuse construction');
  assert.equal(caught.code, 'SNAPBACK_CONTRACT_QUERY_UNCONFIGURED');
  assert.equal(caught.diagnostic?.code, 'SNAPBACK_CONTRACT_QUERY_UNCONFIGURED');
  assert.deepEqual(caught.diagnostic?.details?.queries, ['gamma']);
  assert.equal(caught.diagnostic?.details?.configurationSurface, 'liveQueries');
  assert.match(caught.message, /Add each query.*liveQueries/);
  assert.equal(client.state.queryCalls.length, 0, 'boot refusal happens before a snapshot query runs');
  assert.equal(client.state.liveQueryCalls, 0, 'boot refusal happens before a subscription opens');
}

// --- livePush: false seeds snapshots (configured args) and reconciles on mutate ---
{
  const client = makeClient({ withLiveQuery: true });
  const surface = await createSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    livePush: false,
    liveQueries: ['alpha', { name: 'beta', args: { board: 'b1' } }],
  });
  assert.equal(surface.livePush, false);
  assert.equal(client.state.liveQueryCalls, 0, 'livePush: false must not subscribe');
  assert.deepEqual(
    client.state.queryCalls,
    [
      { name: 'alpha', args: {} },
      { name: 'beta', args: { board: 'b1' } },
    ],
    'each configured entry seeds from a snapshot with its configured args',
  );
  assert.deepEqual(surface.boundary.cells.get('alpha'), [{ _id: 'a1', _version: 1 }]);
  assert.deepEqual(surface.boundary.cells.get('beta'), [{ _id: 'b1', _version: 1 }]);
  assert.equal(surface.boundary.cells.has('gamma'), false, 'unconfigured query has no successful empty boundary cell');
  const gammaCells = [];
  const gammaSubscription = surface.links.gamma({}).subscribe((cell) => gammaCells.push(cell));
  assert.equal(gammaCells.length, 1);
  assert.equal(gammaCells[0].status, 'error');
  assert.equal(gammaCells[0].diagnostic.code, 'SNAPBACK_CONTRACT_QUERY_UNCONFIGURED');
  assert(surface.diagnostics.some((diagnostic) => diagnostic.code === 'SNAPBACK_CONTRACT_QUERY_UNCONFIGURED'));
  gammaSubscription.dispose();
  assert.equal(surface.connection('alpha'), null, 'no subscription: connection fact is null');

  await surface.links.addRow({ id: 'a2' });
  assert.deepEqual(
    surface.boundary.cells.get('alpha'),
    [{ _id: 'a1', _version: 1 }, { _id: 'a2', _version: 2 }],
    'mutation must reconcile the boundary from authoritative snapshots',
  );
  assert.equal(client.state.queryCalls.length, 4, 'reconcile re-queries every configured entry');
  surface.dispose();
}

// --- a client without liveQuery() gets the same poll/reconcile behavior ---
{
  const client = makeClient({ withLiveQuery: false });
  const surface = await createSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha', 'beta'],
  });
  assert.equal(surface.livePush, false);
  assert.deepEqual(surface.boundary.cells.get('alpha'), [{ _id: 'a1', _version: 1 }]);
  await surface.links.addRow({ id: 'a2' });
  assert.equal(surface.boundary.cells.get('alpha').length, 2);
  surface.dispose();
}

// --- reconcile failure after a committed mutation surfaces honestly ---
{
  const client = makeClient({ withLiveQuery: false, failQueryAfterMutate: true });
  const surface = await createSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha'],
  });
  let caught = null;
  try {
    await surface.links.addRow({ id: 'a2' });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'reconcile failure must propagate');
  assert.match(caught.message, /query outage/);
  const codes = surface.diagnostics.map((d) => d.code);
  assert.ok(codes.includes('SNAPBACK_CONTRACT_RECONCILE_FAILED'), 'reconcile failure is diagnosed');
  assert.ok(!codes.includes('SNAPBACK_CONTRACT_MUTATION_FAILED'), 'the mutation itself committed');
  surface.dispose();
}

// --- live-push path is unchanged: no polling at construction or on mutate ---
{
  const client = makeClient({ withLiveQuery: true });
  const surface = await createSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha', 'beta'],
  });
  assert.equal(surface.livePush, true);
  assert.equal(client.state.liveQueryCalls, 2);
  const alphaLiveOptions = client.state.liveQueryOptions.find(({ name }) => name === 'alpha').options;
  alphaLiveOptions.onAuthorizationBoundary([], {
    kind: 'authorization_error',
    terminal: true,
    error: new Error('injected terminal auth loss'),
  });
  assert.deepEqual(
    surface.boundary.cells.get('alpha'),
    [],
    'terminal auth loss synchronously blanks the private multi-live predecessor boundary',
  );
  assert.deepEqual(
    surface.boundary.cells.get('beta'),
    [{ _id: 'b1', _version: 1 }],
    'a query-scoped terminal carrier does not blank an unrelated multi-live cell',
  );
  await surface.links.addRow({ id: 'a2' });
  assert.equal(client.state.queryCalls.length, 0, 'push mode never issues client.query');
  surface.dispose();
}

// --- a live-push surface refuses configured snapshot queries at construction ---
{
  const client = makeClient({ withLiveQuery: true });
  let caught = null;
  try {
    await createSnapbackContractSurface({
      runtime: makeRuntime(),
      client,
      userId: 'u1',
      manifest: makeManifest(),
      liveQueries: ['alpha', 'gamma'],
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'configuring a snapshot query in live-push mode must refuse construction');
  assert.equal(caught.diagnostic?.code, 'SNAPBACK_CONTRACT_LIVEQUERY_NOT_LIVE');
  assert.deepEqual(caught.diagnostic?.details?.queries, ['gamma']);
  assert.equal(client.state.liveQueryCalls, 0, 'refusal happens before any subscription is opened');
}

// --- livePush: false still serves configured snapshot queries (poll/reconcile) ---
{
  const client = makeClient({ withLiveQuery: true });
  client.store.gamma = [{ _id: 'g1', _version: 1 }];
  const surface = await createSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    livePush: false,
    liveQueries: ['alpha', 'gamma'],
  });
  assert.deepEqual(surface.boundary.cells.get('gamma'), [{ _id: 'g1', _version: 1 }]);
  surface.dispose();
}

// --- fallback-to-poll defaults on and can be disabled for every live cell ---
for (const { label, value, expected } of [
  { label: 'default', value: undefined, expected: true },
  { label: 'disabled', value: false, expected: false },
]) {
  const client = makeClient({ withLiveQuery: true });
  const surface = await createSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha', 'beta'],
    ...(value === undefined ? {} : { liveFallbackToPoll: value }),
  });
  assert.equal(client.state.liveQueryOptions.length, 2, `${label} multi-live surface was short`);
  assert.ok(
    client.state.liveQueryOptions.every(({ options }) => options.fallbackToPoll === expected),
    `${label} multi-live fallback option drifted`,
  );
  surface.dispose();
}

console.log('multi-live-poll-reconcile.test.mjs: all assertions passed');
