import assert from 'node:assert/strict';

import { createSnapbackContractSurface } from './index.mjs';

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
  assert.deepEqual(surface.liveQueries, ['trains', 'feedState']);
  surface.dispose();
}

{
  const originalWarn = console.warn;
  let subscribeAttempts = 0;
  let overlayDisposed = 0;
  const overlay = {
    currentEntries() {
      return [{
        key: 'client_1',
        value: { x: 1, y: 2 },
        receivedAtMs: Date.now(),
        expiresAtMs: Date.now() + 10_000,
      }];
    },
    onChange() {},
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
  assert.deepEqual(cells.at(-1).entries.map((entry) => entry.key), ['client_1']);
  disposeSource();
  surface.dispose();
  assert(overlayDisposed >= 1);
}

console.log('snapback contract adapter tests: ok');
