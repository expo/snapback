import assert from 'node:assert/strict';

import {
  createMemorySnapbackClientStore,
  createSnapbackContractSurface,
  createSnapbackSystemContractSurface,
} from './index.mjs';

const baseManifest = (queries) => ({
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  schemaVersion: 'snapback.v0',
  inputsHash: 'inputs-test',
  schemaHash: 'schema-test',
  bundleHash: 'bundle-test',
  queries,
  mutations: {},
});

function mockRuntime() {
  return {
    createContractMockQueryBoundary(initialRows) {
      const rows = new Map(Object.entries(initialRows));
      return {
        query(key, project = (value) => value) {
          return project(rows.get(key) ?? []);
        },
        write(key, updater) {
          const next = updater(rows.get(key) ?? []);
          rows.set(key, next);
          return next;
        },
      };
    },
    createBoundaryContractDataProvider(_manifest, boundary, options) {
      return {
        boundary,
        queries: options.queries ?? {},
        mutations: options.mutations ?? {},
        ephemerals: options.ephemerals ?? {},
        subscribe(name, args, observer) {
          const query = options.queries?.[name];
          if (!query) {
            observer({ status: 'error', rows: [] });
            return { dispose() {} };
          }
          observer({ status: 'ready', rows: query(args, boundary) });
          return { dispose() {} };
        },
      };
    },
    createProviderEphemeralHandle(provider, name, args) {
      return { provider, name, args };
    },
    createProviderQueryHandle(provider, name, args) {
      return { provider, name, args };
    },
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(assertion, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await wait(20);
    }
  }
  throw lastError ?? new Error('timed out waiting for condition');
}

{
  const surface = await createSnapbackContractSurface({
    runtime: mockRuntime(),
    client: {
      async query(name) {
        assert.equal(name, 'listTodos');
        return { rows: [{ _id: 'todo_1', title: 'Bound' }] };
      },
      async mutate() {},
    },
    userId: 'ada',
    manifest: baseManifest({
      listTodos: { name: 'listTodos' },
      otherTodos: { name: 'otherTodos' },
    }),
    queryName: 'listTodos',
    boundaryKey: 'todos',
  });

  assert.deepEqual(Object.keys(surface.provider.queries), ['listTodos']);
  assert.equal(surface.capabilityClass, 'Online', 'default/no-store surface stays Online');
  assert.deepEqual(Object.keys(surface.links), ['listTodos']);
  assert.deepEqual(surface.links.listTodos(), [{ _id: 'todo_1', title: 'Bound' }]);
  assert.equal(surface.links.otherTodos, undefined);
  surface.dispose();
}

{
  const calls = [];
  const resolvers = new Map();
  const surfacePromise = createSnapbackContractSurface({
    runtime: mockRuntime(),
    client: {
      liveQuery(name) {
        calls.push(name);
        return new Promise((resolve) => {
          resolvers.set(name, () =>
            resolve({
              rows: [{ _id: `${name}_row` }],
              connection: 'live',
              dispose() {},
            }),
          );
        });
      },
      async mutate() {},
    },
    userId: 'ada',
    manifest: baseManifest({
      trains: { name: 'trains', mode: 'live' },
      feedState: { name: 'feedState', mode: 'live' },
    }),
    liveQueries: ['trains', 'feedState'],
  });

  await Promise.resolve();
  assert.deepEqual(calls, ['trains', 'feedState']);
  resolvers.get('feedState')();
  resolvers.get('trains')();
  const surface = await surfacePromise;
  assert.equal(surface.capabilityClass, 'Online', 'multi-query surface stays Online');
  assert.deepEqual(surface.liveQueries, ['trains', 'feedState']);
  surface.dispose();
}

for (const { label, value, expected } of [
  { label: 'default', value: undefined, expected: true },
  { label: 'disabled', value: false, expected: false },
]) {
  const optionsSeen = [];
  const surface = await createSnapbackContractSurface({
    runtime: mockRuntime(),
    client: {
      async liveQuery(_name, options) {
        optionsSeen.push(options);
        return { rows: [], connection: 'live', dispose() {} };
      },
      async mutate() {},
    },
    userId: 'ada',
    manifest: baseManifest({ listTodos: { name: 'listTodos', mode: 'live' } }),
    queryName: 'listTodos',
    boundaryKey: 'todos',
    ...(value === undefined ? {} : { liveFallbackToPoll: value }),
  });
  assert.equal(optionsSeen.length, 1, `${label} single-live surface did not subscribe exactly once`);
  assert.equal(optionsSeen[0].fallbackToPoll, expected, `${label} single-live fallback option drifted`);
  surface.dispose();
}

{
  const originalWarn = console.warn;
  let subscribeAttempts = 0;
  let overlayDisposed = 0;
  let grantedConnectionId = 'conn_opaque_client_1';
  let notifyOverlayChange = null;
  const overlay = {
    // Force the authority fact to differ from the surface's readable label.
    // Connection-keyed `self` must follow this opaque granted id.
    get grantedConnectionId() {
      return grantedConnectionId;
    },
    currentEntries() {
      return [
        {
          key: 'conn_opaque_client_1',
          value: { x: 1, y: 2 },
          receivedAtMs: Date.now(),
          expiresAtMs: Date.now() + 10_000,
        },
        {
          key: 'readable_client_label',
          value: { x: 3, y: 4 },
          receivedAtMs: Date.now(),
          expiresAtMs: Date.now() + 10_000,
        },
        {
          // A malformed injected overlay must not turn absent self metadata
          // into a self match through null === null.
          key: null,
          value: { x: 5, y: 6 },
          receivedAtMs: Date.now(),
          expiresAtMs: Date.now() + 10_000,
        },
      ];
    },
    onChange(listener) {
      notifyOverlayChange = listener;
    },
    dispose() {
      overlayDisposed += 1;
    },
  };
  console.warn = () => {};
  let surface;
  try {
    surface = await createSnapbackContractSurface({
      runtime: mockRuntime(),
      client: {
        async query(name) {
          assert.equal(name, 'listTodos');
          return { rows: [] };
        },
        async mutate() {},
        async subscribeEphemeral() {
          subscribeAttempts += 1;
          if (subscribeAttempts <= 2) {
            throw new Error('ephemeral subscribe temporarily failed');
          }
          return overlay;
        },
        liveStreamManager() {
          return {
            isOpen: () => true,
            onState: () => () => {},
          };
        },
      },
      userId: 'ada',
      manifest: baseManifest({
        listTodos: { name: 'listTodos' },
        cursors: {
          name: 'cursors',
          ephemeral: true,
          keyMode: 'Connection',
          scopeFields: [],
        },
      }),
      queryName: 'listTodos',
      boundaryKey: 'todos',
      connectionId: 'readable_client_label',
    });
  } finally {
    console.warn = originalWarn;
  }

  const cells = [];
  console.warn = () => {};
  let disposeSource;
  try {
    disposeSource = surface.provider.ephemerals.cursors({}, (cell) => cells.push(cell));
    await waitFor(() => assert(cells.some((cell) => cell.status === 'ready')));
  } finally {
    console.warn = originalWarn;
  }

  assert(cells.some((cell) => cell.status === 'error'));
  assert(subscribeAttempts >= 3);
  const opaqueEntry = cells.at(-1).entries.find((entry) => entry.key === 'conn_opaque_client_1');
  const labelEntry = cells.at(-1).entries.find((entry) => entry.key === 'readable_client_label');
  assert.deepEqual(
    [opaqueEntry.sourceClientId, opaqueEntry.self],
    ['conn_opaque_client_1', true],
    'connection-keyed self and source identity follow the opaque granted id',
  );
  assert.deepEqual(
    [labelEntry.sourceClientId, labelEntry.self],
    ['readable_client_label', false],
    'the readable label remains provenance but is not self',
  );
  grantedConnectionId = null;
  const cellsBeforeMissingMetadata = cells.length;
  notifyOverlayChange('updated');
  await waitFor(() => assert(cells.length > cellsBeforeMissingMetadata));
  assert(
    cells.at(-1).entries.every((entry) => entry.self === false),
    'missing granted identity fails closed, including for a malformed null entry key',
  );
  disposeSource();
  surface.dispose();
  assert(overlayDisposed >= 1);
}

{
  // A derived mutation takes ONE JSON snapshot for its overlay, replay
  // ledger, durable queue, and transport. Effectful raw objects must never be
  // observed again after that boundary (ENG-24350 review follow-up).
  const manifest = {
    ...baseManifest({
      listTodos: {
        name: 'listTodos',
        mode: 'live',
        defaultLive: true,
        reads: ['todos'],
      },
    }),
    capabilities: { derivedOptimisticOverlays: true, offlineReplay: true },
    mutations: {
      canonicalCreate: {
        optimistic: true,
        plan: {
          steps: [
            { Let: { bind_as: 'saved', expr: { Arg: 'payload' } } },
            {
              Insert: {
                table: 'todos',
                values: {
                  payload: { Binding: 'saved' },
                  runtimeToken: 'RuntimeId',
                },
                bind_id_as: 'rowId',
              },
            },
          ],
          return_value: { Expr: 'RuntimeId' },
        },
      },
    },
  };
  const store = createMemorySnapbackClientStore();
  const requests = [];
  let settleMutation;
  const client = {
    async query() {
      return { version: 1, rows: [] };
    },
    async liveQuery() {
      return { version: 0, rows: [], connection: 'live', dispose() {} };
    },
    mutate(_name, request) {
      requests.push(request);
      return new Promise((resolve) => { settleMutation = resolve; });
    },
  };
  const surface = await createSnapbackContractSurface({
    runtime: mockRuntime(),
    client,
    clientStore: store,
    userId: 'json-boundary-user',
    manifest,
    queryName: 'listTodos',
    boundaryKey: 'todos',
    artifactIndex: { appId: 'json-boundary-app' },
    schemaManifest: {
      schemaHash: manifest.schemaHash,
      targetProfile: 'local-dev-sqlite-ibex',
    },
    retainedIdentity: {
      databaseId: 'json-boundary-db',
      versionStreamId: 'json-boundary-stream',
    },
  });

  let proxyGets = 0;
  const effectfulProxy = new Proxy({ score: Infinity }, {
    get(target, key, receiver) {
      proxyGets += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  const task = surface.links.canonicalCreate({ payload: effectfulProxy });
  await waitFor(() => assert.equal(requests.length, 1));

  const request = requests[0];
  assert.equal(proxyGets, 0, 'raw Proxy getters are not used by prediction or transport');
  assert.equal(request.args.payload.score, null, 'transport receives the canonical non-finite value');
  assert.equal(Object.getPrototypeOf(request.args.payload), null, 'transport receives the copied JSON record');
  assert.equal(request.ctxLedger.ids.length, 3, 'implicit id, value RuntimeId, and return RuntimeId are captured');
  const optimisticRow = surface.provider.boundary.query('todos')[0];
  assert.equal(optimisticRow._id, request.ctxLedger.ids[0]);
  assert.equal(optimisticRow.runtimeToken, request.ctxLedger.ids[1]);
  assert.equal(optimisticRow.payload.score, null);
  assert.equal(JSON.stringify(request.args), '{"payload":{"score":null}}');
  assert.equal(proxyGets, 0, 'serializing the request cannot revisit the raw Proxy');

  const queued = await store.pendingMutations();
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0].ctxLedger.ids, request.ctxLedger.ids, 'durable queue reuses the same ledger');
  assert.equal(queued[0].args.payload.score, null, 'durable queue reuses the canonical args');

  settleMutation({ version: 1, changed_count: 1, result: null });
  await task;

  let getterCalls = 0;
  const accessor = Object.defineProperty({}, 'score', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 1;
    },
  });
  await assert.rejects(
    surface.links.canonicalCreate({ payload: accessor }),
    (error) => error?.code === 'SNAPBACK_EXPR_TYPE',
  );
  assert.equal(getterCalls, 0, 'accessor args reject without executing the getter');

  let toJSONCalls = 0;
  await assert.rejects(
    surface.links.canonicalCreate({
      payload: {
        score: 1,
        toJSON() {
          toJSONCalls += 1;
          return { score: 2 };
        },
      },
    }),
    (error) => error?.code === 'SNAPBACK_EXPR_TYPE',
  );
  assert.equal(toJSONCalls, 0, 'toJSON args reject without executing user code');
  assert.equal(requests.length, 1, 'rejected effectful values never reach transport');
  assert.equal((await store.pendingMutations()).length, 0, 'rejected values never create a partial ledger');
  surface.dispose();
}

{
  const surface = await createSnapbackSystemContractSurface({
    runtime: mockRuntime(),
    resources: { inspect: { initial: [{ ok: true }] } },
  });
  assert.equal(surface.capabilityClass, 'Online', 'system surface stays Online');
  surface.dispose();
}

console.log('snapback contract adapter tests: ok');
