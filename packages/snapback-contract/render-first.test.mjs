// Render-first surface mode (ENG-23736): links return synchronously with
// every binding pending; connection + subscription establishment run in the
// background with capped backoff; bindings go live in place on attach.
//
// Pure mock client/runtime; runs under plain node (no server, no Exact).

import assert from 'node:assert/strict';

import { createRenderFirstSnapbackContractSurface, createDeferredContractLinks } from './index.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const until = async (predicate, label, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await tick();
  }
};

const makeManifest = () => ({
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  queries: {
    alpha: { mode: 'live', defaultLive: true },
    beta: { mode: 'snapshot', subscription: 'none' },
  },
  mutations: { doThing: {} },
});

// Mock kit client: liveQuery handles record their onUpdate fan-out so the
// test can push server rows; `failures` makes the first N health calls throw.
const makeClient = ({ failures = 0 } = {}) => {
  const state = { healthCalls: 0, mutations: [], handles: [] };
  return {
    state,
    async health() {
      state.healthCalls += 1;
      if (state.healthCalls <= failures) throw new Error(`health failed (${state.healthCalls})`);
    },
    async liveQuery(name, { onUpdate }) {
      const handle = {
        name,
        rows: [],
        connection: 'live',
        disposed: false,
        onUpdate,
        dispose() {
          this.disposed = true;
        },
      };
      state.handles.push(handle);
      return handle;
    },
    async query() {
      return { rows: [] };
    },
    async mutate(name, { args }) {
      state.mutations.push({ name, args });
    },
  };
};

// Mock Exact runtime: provider-backed query handles subscribe through the
// boundary so a boundary.write (the live push path) reaches subscribers.
const makeRuntime = () => {
  const cells = new Map(); // key -> rows
  const observers = new Map(); // key -> Set<notify>
  const boundary = {
    write(key, produce) {
      cells.set(key, produce(cells.get(key) ?? []));
      for (const notify of [...(observers.get(key) ?? [])]) notify(cells.get(key));
    },
    query(key) {
      return { key };
    },
  };
  return {
    createContractMockQueryBoundary(initialRows) {
      for (const [key, rows] of Object.entries(initialRows)) cells.set(key, rows);
      return boundary;
    },
    createBoundaryContractDataProvider() {
      return { subscribe: () => ({ dispose: () => {} }) };
    },
    createProviderQueryHandle(_provider, name) {
      return {
        __exactContractQuery: true,
        table: name,
        key: `provider:${name}`,
        read: () => [...(cells.get(name) ?? [])],
        subscribe(notify) {
          if (!observers.has(name)) observers.set(name, new Set());
          observers.get(name).add(notify);
          return {
            current: cells.get(name) ?? [],
            dispose: () => observers.get(name).delete(notify),
          };
        },
      };
    },
  };
};

// --- links are synchronous; queries stay silent until attach; mutations queue ---
{
  const client = makeClient();
  let connectCalls = 0;
  let releaseConnect;
  const gate = new Promise((resolve) => {
    releaseConnect = resolve;
  });
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha'],
    connect: async () => {
      connectCalls += 1;
      await gate;
    },
  });

  // Links exist synchronously for every manifest binding.
  assert.equal(typeof handle.links.alpha, 'function');
  assert.equal(typeof handle.links.beta, 'function');
  assert.equal(typeof handle.links.doThing, 'function');
  assert.equal(handle.surface(), null);

  // A pre-attach query handle is silent: no emission, empty reads.
  const deliveries = [];
  const queryHandle = handle.links.alpha({});
  const subscription = queryHandle.subscribe((rows) => deliveries.push(rows));
  assert.deepEqual(queryHandle.read(), []);
  assert.deepEqual([...subscription.current], []);

  // A pre-attach mutation queues (does not reach the client yet).
  let firstDelivery = false;
  handle.onFirstDelivery(() => {
    firstDelivery = true;
  });
  const mutation = handle.links.doThing({ n: 1 });
  await tick();
  assert.equal(client.state.mutations.length, 0, 'mutation must queue behind attach');
  assert.equal(firstDelivery, false);

  // Release the backend: the surface attaches, the queued mutation flushes,
  // and a live push forwards through the pre-attach subscription.
  releaseConnect();
  const surface = await handle.attached;
  assert.equal(connectCalls, 1);
  assert.equal(handle.surface(), surface);
  await mutation;
  assert.deepEqual(client.state.mutations, [{ name: 'doThing', args: { n: 1 } }]);

  const alphaHandle = client.state.handles.find((h) => h.name === 'alpha');
  alphaHandle.onUpdate([{ _id: 'r1' }]);
  await until(() => deliveries.length > 0, 'live push forwarded through deferred subscription');
  assert.deepEqual(deliveries.at(-1), [{ _id: 'r1' }]);
  assert.equal(firstDelivery, true, 'onFirstDelivery fires on the first forwarded delivery');
  assert.deepEqual(queryHandle.read(), [{ _id: 'r1' }]);

  // Post-attach link calls go straight to the real links (real provider key).
  assert.equal(handle.links.alpha({}).key, 'provider:alpha');

  handle.dispose();
  assert.equal(alphaHandle.disposed, true, 'dispose releases the real surface');
}

// --- transient connect failures retry on capped backoff, then attach ---
{
  const client = makeClient({ failures: 2 });
  const retries = [];
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha'],
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 4,
    connect: async ({ attempt }) => {
      assert.equal(attempt, retries.length);
      await client.health();
    },
    onRetry: (error, { attempt, delayMs }) => {
      retries.push({ message: error.message, attempt, delayMs });
    },
  });
  await handle.attached;
  assert.equal(client.state.healthCalls, 3);
  assert.deepEqual(
    retries.map(({ attempt, delayMs }) => ({ attempt, delayMs })),
    [
      { attempt: 0, delayMs: 1 },
      { attempt: 1, delayMs: 2 },
    ],
  );
  handle.dispose();
}

// --- a structured contract diagnostic is a build defect: no retry, attached rejects ---
{
  const client = makeClient();
  const retries = [];
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    // Single-query mode without queryName/boundaryKey produces the structured
    // SNAPBACK_CONTRACT_SURFACE_BINDING_REQUIRED diagnostic from the adapter.
    retryBaseDelayMs: 1,
    onRetry: () => retries.push(1),
  });
  await assert.rejects(handle.attached, /queryName and boundaryKey/);
  assert.equal(retries.length, 0, 'diagnostic failures must not retry');
  handle.dispose();
}

// --- a stale generated manifest rejects attached but still returns links ---
{
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: makeRuntime(),
    client: makeClient(),
    userId: 'u1',
    manifest: { ...makeManifest(), artifactKind: 'wrong' },
    liveQueries: ['alpha'],
  });
  assert.equal(typeof handle.links.alpha, 'function', 'links must exist even over a build defect');
  assert.ok(handle.diagnostics.some((d) => d.code === 'SNAPBACK_STALE_CONTRACT_DATA_ARTIFACT_KIND'));
  await assert.rejects(handle.attached, /wrong artifact kind/);
  handle.dispose();
}

// --- dispose before attach cancels the loop; a racing construction is released ---
{
  const client = makeClient();
  let releaseConnect;
  const gate = new Promise((resolve) => {
    releaseConnect = resolve;
  });
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha'],
    connect: async () => {
      await gate;
    },
  });
  handle.dispose();
  await assert.rejects(handle.attached, /disposed before attach/);
  // The in-flight connect resolves after dispose: the loop must release the
  // surface it constructs instead of leaking its live subscription.
  releaseConnect();
  await until(
    () => client.state.handles.length === 0 || client.state.handles.every((h) => h.disposed),
    'late-constructed surface released',
  );
}

// --- runtime accepted as a promise (dynamic import shape) ---
{
  const client = makeClient();
  const handle = createRenderFirstSnapbackContractSurface({
    runtime: Promise.resolve(makeRuntime()),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    liveQueries: ['alpha'],
  });
  const surface = await handle.attached;
  assert.equal(surface.livePush, true);
  handle.dispose();
}

// --- low-level deferred links: attach is idempotent; dispose drops waiters ---
{
  const deferred = createDeferredContractLinks({ queries: ['q'], mutations: ['m'], ephemerals: ['presence'] });
  assert.equal(deferred.attached, false);
  const cells = [];
  const ephemeralHandle = deferred.links.presence({ room: 'a' });
  ephemeralHandle.subscribe((cell) => cells.push(cell));
  const real = {
    q: () => ({ subscribe: () => ({ current: [], dispose() {} }) }),
    m: async () => 'ran',
    presence: () => ({
      subscribe(observer) {
        observer({ status: 'ready', entries: [] });
        return { dispose() {} };
      },
    }),
    presencePublish: async () => 'published',
  };
  const publish = deferred.links.presencePublish({ value: 1 });
  deferred.attach(real);
  deferred.attach({}); // second attach ignored
  assert.equal(deferred.attached, true);
  assert.equal(await publish, 'published');
  await until(() => cells.length > 0, 'ephemeral cell forwarded after attach');
  assert.deepEqual(cells[0], { status: 'ready', entries: [] });
  assert.equal(await deferred.links.m({}), 'ran');
  deferred.dispose();
}

console.log('render-first.test.mjs: all assertions passed');
