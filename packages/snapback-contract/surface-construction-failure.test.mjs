// Regression: a failed createSnapbackContractSurface construction releases
// everything the attempt established before the error surfaces (ENG-23383).
//
// The receipt listener attaches before any fallible work, and in multi-live
// mode each loop iteration establishes a server-side live subscription — so
// without cleanup an app-level retry loop accumulates receipt listeners
// (callbacks fire N times per receipt) and strands live handles whose shared
// stream manager reconnects forever. Asserts every failure path — single-mode
// binding validation, a rejected subscribe in either mode, multi-mode
// liveQueries validation — detaches the listener and disposes the handles
// established so far, while the success path keeps them attached until
// surface.dispose().
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
  },
  mutations: {},
});

// Minimal kit-client shape: receipt listener registry plus liveQuery handles
// that record disposal; `failOn` makes one named subscribe reject mid-loop.
const makeClient = ({ failOn = null } = {}) => {
  const state = { attached: 0, detached: 0, handles: [] };
  return {
    state,
    onReceipt(_listener) {
      state.attached += 1;
      return () => {
        state.detached += 1;
      };
    },
    async liveQuery(name) {
      if (name === failOn) {
        throw new Error(`subscribe failed for ${name}`);
      }
      const handle = {
        name,
        disposed: false,
        rows: [],
        connection: 'live',
        dispose() {
          this.disposed = true;
        },
      };
      state.handles.push(handle);
      return handle;
    },
    async query(name) {
      if (name === failOn) {
        throw new Error(`query failed for ${name}`);
      }
      return { rows: [] };
    },
  };
};

const makeRuntime = () => ({
  createProviderQueryHandle: () => ({}),
  createContractMockQueryBoundary: () => ({
    write: () => {},
    query: () => ({ subscribe: () => ({ dispose: () => {} }) }),
  }),
  createBoundaryContractDataProvider: () => ({
    subscribe: () => ({ dispose: () => {} }),
  }),
});

const expectRejection = async (promise, messagePattern) => {
  let caught = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'construction must reject');
  assert.match(caught.message, messagePattern);
  return caught;
};

// --- multi-live mode: mid-loop subscribe rejection ---
{
  const client = makeClient({ failOn: 'beta' });
  await expectRejection(
    createSnapbackContractSurface({
      runtime: makeRuntime(),
      client,
      userId: 'u1',
      manifest: makeManifest(),
      onReceipt: () => {},
      liveQueries: ['alpha', 'beta'],
    }),
    /subscribe failed for beta/,
  );
  assert.equal(client.state.attached, 1);
  assert.equal(client.state.detached, 1, 'receipt listener must be detached on failure');
  assert.equal(client.state.handles.length, 1, 'alpha subscribed before beta failed');
  assert.equal(client.state.handles[0].name, 'alpha');
  assert.equal(client.state.handles[0].disposed, true, 'already-established handle must be disposed');
}

// --- multi-live mode: unknown liveQueries name (pre-subscribe validation) ---
{
  const client = makeClient();
  await expectRejection(
    createSnapbackContractSurface({
      runtime: makeRuntime(),
      client,
      userId: 'u1',
      manifest: makeManifest(),
      onReceipt: () => {},
      liveQueries: ['nope'],
    }),
    /unknown manifest query/,
  );
  assert.equal(client.state.detached, 1);
  assert.equal(client.state.handles.length, 0);
}

// --- multi-live mode: duplicate liveQueries names keep the structured diagnostic ---
{
  const client = makeClient();
  const error = await expectRejection(
    createSnapbackContractSurface({
      runtime: makeRuntime(),
      client,
      userId: 'u1',
      manifest: makeManifest(),
      onReceipt: () => {},
      liveQueries: ['alpha', 'alpha'],
    }),
    /at most once/,
  );
  assert.equal(error.diagnostic?.code, 'SNAPBACK_CONTRACT_LIVEQUERY_DUPLICATE');
  assert.equal(client.state.detached, 1);
}

// --- multi-live mode: runtime without createProviderQueryHandle ---
{
  const client = makeClient();
  await expectRejection(
    createSnapbackContractSurface({
      runtime: {},
      client,
      userId: 'u1',
      manifest: makeManifest(),
      onReceipt: () => {},
      liveQueries: ['alpha'],
    }),
    /createProviderQueryHandle/,
  );
  assert.equal(client.state.detached, 1);
}

// --- single mode: missing queryName/boundaryKey keeps the structured diagnostic ---
{
  const client = makeClient();
  const error = await expectRejection(
    createSnapbackContractSurface({
      runtime: makeRuntime(),
      client,
      userId: 'u1',
      manifest: makeManifest(),
      onReceipt: () => {},
    }),
    /requires queryName and boundaryKey/,
  );
  assert.equal(error.diagnostic?.code, 'SNAPBACK_CONTRACT_SURFACE_BINDING_REQUIRED');
  assert.equal(client.state.detached, 1);
}

// --- single mode: rejected live subscribe ---
{
  const client = makeClient({ failOn: 'alpha' });
  await expectRejection(
    createSnapbackContractSurface({
      runtime: makeRuntime(),
      client,
      userId: 'u1',
      manifest: makeManifest(),
      onReceipt: () => {},
      queryName: 'alpha',
      boundaryKey: 'alphaRows',
    }),
    /subscribe failed for alpha/,
  );
  assert.equal(client.state.detached, 1);
  assert.equal(client.state.handles.length, 0);
}

// --- success paths: the listener stays attached until surface.dispose() ---
{
  const client = makeClient();
  const surface = await createSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    onReceipt: () => {},
    liveQueries: ['alpha', 'beta'],
  });
  assert.equal(client.state.detached, 0, 'successful construction must not detach');
  assert.equal(client.state.handles.length, 2);
  surface.dispose();
  assert.equal(client.state.detached, 1);
  assert.ok(client.state.handles.every((handle) => handle.disposed));
}

{
  const client = makeClient();
  const surface = await createSnapbackContractSurface({
    runtime: makeRuntime(),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    onReceipt: () => {},
    queryName: 'alpha',
    boundaryKey: 'alphaRows',
  });
  assert.equal(client.state.detached, 0, 'successful construction must not detach');
  assert.equal(client.state.handles.length, 1);
  surface.dispose();
  assert.equal(client.state.detached, 1);
  assert.ok(client.state.handles[0].disposed);
}

console.log('surface-construction-failure.test.mjs: all assertions passed');
