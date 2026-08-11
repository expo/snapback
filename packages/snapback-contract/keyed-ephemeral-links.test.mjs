import assert from 'node:assert/strict';
import test from 'node:test';

import { createSnapbackContractSurface } from './index.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  assert.fail(`timed out waiting for ${label}`);
}

function createRuntime(state = {}) {
  return {
    createProviderQueryHandle(provider, name, args) {
      return {
        subscribe(observer) {
          return provider.subscribe(name, args, observer);
        },
      };
    },
    createProviderEphemeralHandle(provider, name, args) {
      state.ephemeralHandles ??= [];
      state.ephemeralHandles.push({ provider, name, args });
      return {
        subscribe(observer) {
          return provider.subscribeEphemeral(name, args, observer);
        },
      };
    },
    createProviderMutation(provider, name) {
      return (args) => provider.mutate(name, args);
    },
    rotatePartition(provider) {
      state.rotations ??= [];
      state.rotations.push(provider.partitionId());
      return provider.partitionId();
    },
  };
}

function createManifest({ authorityIndependent = false } = {}) {
  return {
    artifactKind: 'contractDataManifest',
    manifestVersion: 2,
    provider: 'snapback-keyed-ephemeral-test',
    queries: {
      liveRound: { name: 'liveRound', mode: 'live', livePush: true },
      roomPresence: {
        name: 'roomPresence',
        ephemeral: true,
        keyMode: 'Connection',
        scopeFields: ['roomId'],
        authorityIndependent,
      },
    },
    mutations: {
      castVote: { name: 'castVote' },
    },
  };
}

function createEphemeralClient({ coordinator = null } = {}) {
  const state = {
    subscribes: [],
    publishes: [],
    overlays: [],
  };
  const manager = {
    listeners: new Set(),
    isOpen: () => true,
    onState(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
  };
  const client = {
    state,
    ...(coordinator ? {
      authCoordinator: coordinator,
      captureAuthority: () => coordinator.capture(),
      registerAuthBarrierParticipant(participant) {
        return coordinator.registerParticipant(participant);
      },
    } : {}),
    liveQuery(_name, options) {
      return Promise.resolve({
        rows: [{ _id: options.args.roomId ?? 'round-1' }],
        connection: 'live',
        dispose() {},
      });
    },
    async mutate(name, options) {
      return { name, options };
    },
    liveStreamManager() {
      return manager;
    },
    async subscribeEphemeral(name, options) {
      const epoch = coordinator?.capture().authorityEpoch ?? 0;
      const listeners = new Set();
      const expiresAtMs = Date.now() + 60_000;
      const overlay = {
        epoch,
        disposed: 0,
        grantedConnectionId: `connection-${epoch}`,
        currentEntries: () => [{
          key: `connection-${epoch}`,
          value: { picking: epoch === 0 ? '5' : '8' },
          receivedAtMs: 100 + epoch,
          expiresAtMs,
        }],
        onChange(listener) {
          listeners.add(listener);
        },
        dispose() {
          this.disposed += 1;
          listeners.clear();
        },
        listenerCount: () => listeners.size,
      };
      state.subscribes.push({ name, options, epoch, overlay });
      state.overlays.push(overlay);
      return overlay;
    },
    async unsubscribeEphemeral() {},
    async publishEphemeral(name, options) {
      state.publishes.push({ name, options });
      return { published: true };
    },
  };
  return client;
}

async function createWorkingSurface(overrides = {}) {
  const runtimeState = {};
  const client = overrides.client ?? createEphemeralClient();
  const surface = await createSnapbackContractSurface({
    runtime: createRuntime(runtimeState),
    client,
    manifest: createManifest(),
    userId: 'user-1',
    liveQueries: ['liveRound'],
    requiredQueries: ['liveRound', 'roomPresence'],
    keyedQueryScopes: true,
    connectionId: 'keyed-ephemeral-connection',
    rootId: 'keyed-ephemeral-root',
    ephemeralIdleLingerMs: 0,
    ...overrides,
  });
  return { client, runtimeState, surface };
}

test('keyed surfaces return durable and generated ephemeral link families', async () => {
  const { surface } = await createWorkingSurface();
  assert.equal(typeof surface.links.liveRound, 'function');
  assert.equal(typeof surface.links.castVote, 'function');
  assert.equal(typeof surface.links.roomPresence, 'function');
  assert.equal(typeof surface.links.roomPresencePublish, 'function');
  assert.equal(typeof surface.prewarmEphemeral, 'function');
  assert.equal(typeof surface.ephemeralSourceStarts, 'function');
  await surface.dispose();
});

test('keyed ephemeral reads subscribe through the provider and deliver wiring entries', async () => {
  const { client, runtimeState, surface } = await createWorkingSurface();
  assert.equal(typeof surface.provider.subscribeEphemeral, 'function');
  const cells = [];
  const subscription = surface.links.roomPresence({ roomId: 'room-planning' })
    .subscribe((cell) => cells.push(cell));
  await waitFor(() => cells.some((cell) => cell.entries?.length === 1), 'ephemeral ready cell');

  assert.deepEqual(runtimeState.ephemeralHandles.map(({ name, args }) => ({ name, args })), [{
    name: 'roomPresence',
    args: { roomId: 'room-planning' },
  }]);
  assert.equal(client.state.subscribes.length, 1);
  assert.deepEqual(cells.at(-1).entries, [{
    key: 'connection-0',
    value: { picking: '5' },
    updatedAt: 100,
    expiresAt: client.state.overlays[0].currentEntries()[0].expiresAtMs,
    sourceClientId: 'connection-0',
    self: true,
  }]);
  assert.equal(surface.ephemeralSourceStarts('roomPresence'), 1);

  subscription.dispose();
  subscription.dispose();
  await surface.dispose();
});

test('keyed ephemeral publish links split scope, value, and ttl', async () => {
  const { client, surface } = await createWorkingSurface();
  await surface.links.roomPresencePublish({
    roomId: 'room-platform',
    value: { picking: '13' },
    ttlMs: 4_500,
  });
  const [publish] = client.state.publishes;
  assert.equal(client.state.publishes.length, 1);
  assert.equal(publish.name, 'roomPresence');
  assert.deepEqual(publish.options.scope, { roomId: 'room-platform' });
  assert.deepEqual(publish.options.value, { picking: '13' });
  assert.equal(publish.options.ttlMs, 4_500);
  assert.equal(publish.options.userId, 'user-1');
  assert.deepEqual(publish.options.permissions, []);
  await surface.dispose();
});

// The ephemeral lane must never ride the durable keyed surface's connection:
// an ephemeral consumer holding demand there leaves every predecessor durable
// subscription registered server-side after a re-key
// (issues/20260810-durable-unsubscribe-withheld-behind-shared-connection-demand.md).
test('keyed ephemeral traffic takes its own connection, stable across operations', async () => {
  const { client, surface } = await createWorkingSurface();
  await surface.links.roomPresencePublish({ roomId: 'room-planning', value: { picking: '5' } });
  await surface.links.roomPresencePublish({ roomId: 'room-platform', value: { picking: '8' } });
  const connections = client.state.publishes.map(({ options }) => options.connectionId);
  assert.equal(connections.length, 2);
  assert.notEqual(connections[0], 'keyed-ephemeral-connection', 'ephemeral publish must not reuse the durable connection');
  assert.equal(connections[0], connections[1], 'the ephemeral connection is stable across publishes');

  const subscription = surface.links.roomPresence({ roomId: 'room-planning' })
    .subscribe(() => {});
  await waitFor(() => client.state.subscribes.length === 1, 'ephemeral subscribe');
  assert.equal(client.state.subscribes[0].options.connectionId, connections[0]);

  subscription.dispose();
  await surface.dispose();
});

test('keyed construction refuses clients that cannot serve declared ephemerals', async () => {
  let receiptListeners = 0;
  let detachedReceiptListeners = 0;
  await assert.rejects(
    createSnapbackContractSurface({
      runtime: createRuntime(),
      client: {
        async liveQuery() {
          return { rows: [], connection: 'live', dispose() {} };
        },
        async mutate() {},
        onReceipt() {
          receiptListeners += 1;
          return () => { detachedReceiptListeners += 1; };
        },
      },
      manifest: createManifest(),
      liveQueries: ['liveRound'],
      requiredQueries: ['roomPresence'],
      keyedQueryScopes: true,
      onReceipt() {},
    }),
    (error) => {
      assert.equal(error?.code, 'SNAPBACK_CONTRACT_EPHEMERAL_UNSUPPORTED');
      assert.equal(error?.diagnostic?.code, error.code);
      assert.match(error.message, /roomPresence/);
      assert.match(error.message, /roomPresencePublish/);
      return true;
    },
  );
  assert.equal(receiptListeners, 1);
  assert.equal(detachedReceiptListeners, 1, 'construction refusal detaches established listeners');
});

test('requiredQueries may name an ephemeral outside the durable keyed allowlist', async () => {
  const client = createEphemeralClient();
  const surface = await createSnapbackContractSurface({
    runtime: createRuntime(),
    client,
    manifest: createManifest(),
    liveQueries: ['liveRound'],
    requiredQueries: ['roomPresence'],
    keyedQueryScopes: true,
  });
  assert.equal(typeof surface.links.roomPresence, 'function');
  await surface.dispose();
});

test('authority barriers replace predecessor ephemeral wiring and honor sessions non-resume', async () => {
  const participants = [];
  let capture = Object.freeze({ authorityEpoch: 0, authorityKey: 'authority-0' });
  const coordinator = {
    authority: { kind: 'anonymous', authMode: 'dev' },
    capture: () => capture,
    isCurrent(candidate) {
      return candidate?.authorityEpoch === capture.authorityEpoch
        && candidate?.authorityKey === capture.authorityKey;
    },
    async compareAndCommit(candidate, commit) {
      if (!this.isCurrent(candidate)) return { committed: false };
      return { committed: true, value: commit() };
    },
    registerParticipant(participant) {
      participants.push(participant);
      return async () => {};
    },
    async synchronize() {},
  };
  const client = createEphemeralClient({ coordinator });
  const { surface } = await createWorkingSurface({ client, userId: null });
  const participant = participants.find(({ name }) => (
    name.startsWith('snapback-contract-keyed-surface:')
  ));
  assert.ok(participant, 'keyed authority participant registered');

  const cells = [];
  const subscription = surface.links.roomPresence({ roomId: 'room-planning' })
    .subscribe((cell) => cells.push(cell));
  await waitFor(() => cells.some((cell) => cell.entries?.[0]?.key === 'connection-0'), 'predecessor presence');
  const predecessor = client.state.overlays[0];

  participant.quiesce();
  participant.blank();
  participant.clearMemory();
  capture = Object.freeze({ authorityEpoch: 1, authorityKey: 'authority-1' });
  await participant.resume({ capture, authority: coordinator.authority });
  await surface.flush();
  await waitFor(() => cells.some((cell) => cell.entries?.[0]?.key === 'connection-1'), 'successor presence');
  assert.equal(client.state.subscribes.length, 2, 'successor wiring starts a fresh source');
  assert.equal(predecessor.disposed, 1, 'predecessor overlay is disposed');
  assert.equal(predecessor.listenerCount(), 0, 'mounted binding no longer listens to predecessor');

  participant.quiesce();
  participant.blank();
  participant.clearMemory();
  coordinator.authority = { kind: 'session', authMode: 'sessions', userId: 'user-2' };
  capture = Object.freeze({ authorityEpoch: 2, authorityKey: 'authority-2' });
  await participant.resume({ capture, authority: coordinator.authority });
  await surface.flush();
  assert.equal(
    client.state.subscribes.length,
    2,
    'auth-scoped ephemeral state is not resumed in sessions mode',
  );
  assert.deepEqual(cells.at(-1).entries, []);

  subscription.dispose();
  await surface.dispose();
});
