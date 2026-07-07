// Regression: the ephemeral resubscribe race (ENG-23387).
//
// subscribeEphemeral is an HTTP POST independent of the shared live socket.
// If a wasOpen socket loss lands while a subscribe is in flight, the server's
// disconnect drops the registration that subscribe just created — the room is
// dead server-side and no in-band needs_resync will ever arrive for it. The
// old wiring let the late HTTP resolve overwrite `subscribed = true`, so the
// socket-regain 'open' handler's `!record.subscribed` guard skipped the real
// re-subscribe and the map froze under a 'live' banner (the ENG-22541 state,
// resurfacing through this ordering) until the next socket bounce.
//
// Asserts both racy windows:
//   1. resync path — a needs_resync re-subscribe raced by loss+regain keeps
//      the record unsubscribed ('stale', never 'live') and immediately
//      re-enters a fresh subscribe, which then promotes to 'live';
//   2. initial-createRecord path — a loss+regain during the very first
//      subscribe (before the record's onState exists) starts the record
//      unsubscribed and re-enters immediately;
// plus the plain ENG-22541 path (loss with no subscribe in flight still
// re-subscribes exactly once on regain).
//
// Pure mock client/runtime; runs under plain node (no server, no Exact).

import assert from 'node:assert/strict';

import { createSnapbackContractSurface } from './index.mjs';

const makeManifest = () => ({
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  queries: {
    alpha: {},
    presence: { ephemeral: true, keyMode: 'Connection' },
  },
  mutations: {},
});

// Shared live-socket manager stub: test-controlled open/lost transitions with
// the same (state, detail) listener contract the kit client exposes —
// including the demand rule that detaching the LAST listener closes and
// releases the manager for good (demos/_kit/client.mjs #listen), so wiring
// that momentarily drops to zero listeners kills the socket permanently.
const makeManager = () => {
  const listeners = new Set();
  let open = false;
  let closed = false;
  return {
    isClosed: () => closed,
    isOpen: () => open,
    onState(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          closed = true;
          open = false;
        }
      };
    },
    emitOpen() {
      if (closed) return;
      open = true;
      for (const listener of [...listeners]) listener('open', {});
    },
    emitLost({ wasOpen = true } = {}) {
      open = false;
      for (const listener of [...listeners]) listener('lost', { wasOpen });
    },
  };
};

const makeOverlay = () => {
  const changeListeners = new Set();
  return {
    disposed: false,
    onChange(listener) {
      changeListeners.add(listener);
    },
    emitChange(result) {
      for (const listener of [...changeListeners]) listener(result);
    },
    currentEntries() {
      return [];
    },
    dispose() {
      this.disposed = true;
    },
  };
};

// Every subscribeEphemeral is a deferred the test resolves by hand, so socket
// transitions can be interleaved with the HTTP round trip.
const makeClient = (manager) => {
  const subscribes = [];
  return {
    subscribes,
    async query() {
      return { rows: [] };
    },
    liveStreamManager: () => manager,
    subscribeEphemeral() {
      return new Promise((resolve, reject) => {
        const overlay = makeOverlay();
        subscribes.push({ overlay, resolve: () => resolve(overlay), reject });
      });
    },
    async unsubscribeEphemeral() {},
  };
};

const makeRuntime = (captured) => ({
  createContractMockQueryBoundary: (initialRows) => ({
    cells: new Map(Object.entries(initialRows)),
    write() {},
    query() {},
  }),
  createBoundaryContractDataProvider: (_manifest, _boundary, options) => {
    captured.ephemerals = options.ephemerals;
    return { subscribe: () => ({ dispose: () => {} }) };
  },
  createProviderEphemeralHandle: () => ({}),
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const waitFor = async (predicate, label) => {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${label}`);
};

const buildSurface = async ({ raceInitialSubscribe = false } = {}) => {
  const manager = makeManager();
  manager.emitOpen();
  const client = makeClient(manager);
  const captured = {};
  const surfacePromise = createSnapbackContractSurface({
    runtime: makeRuntime(captured),
    client,
    userId: 'u1',
    manifest: makeManifest(),
    queryName: 'alpha',
    boundaryKey: 'alpha',
  });
  surfacePromise.catch(() => {}); // assertions surface failures via await below
  await waitFor(() => client.subscribes.length === 1, 'initial ephemeral subscribe');
  if (raceInitialSubscribe) {
    manager.emitLost();
    manager.emitOpen();
  }
  client.subscribes[0].resolve();
  const surface = await surfacePromise;
  assert.equal(
    manager.isClosed(),
    false,
    'record construction must never let shared-socket demand drop to zero',
  );
  const cells = [];
  captured.ephemerals.presence({}, (cell) => cells.push(cell));
  return { manager, client, surface, cells };
};

const lastConnection = (cells) => cells.at(-1)?.connection;

// --- 1. resync path: a subscribe resolving after loss+regain must not claim the room ---
{
  const { manager, client, surface, cells } = await buildSurface();
  assert.equal(lastConnection(cells), 'live', 'healthy room binds live');

  // Server retires the epoch: in-band needs_resync dispatches subscribe #2.
  client.subscribes[0].overlay.emitChange('needs_resync');
  assert.equal(client.subscribes.length, 2, 'needs_resync re-enters a fresh subscribe');
  assert.equal(lastConnection(cells), 'stale', 'stale while the re-subscribe is in flight');

  // The race: the socket dies (server drops the room subscribe #2 just
  // registered) and regains BEFORE the HTTP response arrives. The regain's
  // attemptResync is blocked by the single-in-flight guard.
  manager.emitLost();
  manager.emitOpen();
  assert.equal(client.subscribes.length, 2, 'single-in-flight: regain does not overlap subscribes');

  // The stale resolve lands: it must not claim subscribed over the dead room.
  client.subscribes[1].resolve();
  await waitFor(() => client.subscribes.length === 3, 'stale resolve re-enters immediately');
  assert.equal(
    lastConnection(cells),
    'stale',
    'a subscribe from before the socket loss never presents live',
  );

  // The fresh subscribe (dispatched at the current epoch) promotes to live.
  client.subscribes[2].resolve();
  await waitFor(() => lastConnection(cells) === 'live', 'fresh subscribe promotes to live');

  // Plain ENG-22541 path still works: loss with nothing in flight
  // re-subscribes exactly once on regain.
  manager.emitLost();
  assert.equal(lastConnection(cells), 'stale', 'loss demotes to stale');
  manager.emitOpen();
  assert.equal(client.subscribes.length, 4, 'regain re-subscribes the dead room once');
  client.subscribes[3].resolve();
  await waitFor(() => lastConnection(cells) === 'live', 'regained room returns to live');
  assert.ok(client.subscribes[1].overlay.disposed, 'superseded overlays are disposed');

  surface.dispose();
  console.log('ok - stale resync resolve keeps the room unsubscribed and re-enters');
}

// --- 2. initial-createRecord path: loss+regain during the very first subscribe ---
{
  const { client, cells, surface } = await buildSurface({ raceInitialSubscribe: true });
  assert.equal(
    client.subscribes.length,
    2,
    'an initial subscribe raced by loss+regain re-enters immediately',
  );
  assert.equal(lastConnection(cells), 'stale', 'never live over the dead initial registration');

  client.subscribes[1].resolve();
  await waitFor(() => lastConnection(cells) === 'live', 'fresh initial re-subscribe goes live');

  surface.dispose();
  console.log('ok - raced initial subscribe starts unsubscribed and re-enters');
}

console.log('ephemeral-resubscribe-race: all assertions passed');
