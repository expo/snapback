// Item 7 Contract composition: session queue replay is enabled by the exact
// authority descriptor without accidentally enabling retained reads.

import assert from 'node:assert/strict';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
  createMemorySnapbackClientStore,
  createSnapbackContractSurface,
  SNAPBACK_CONTRACT_CAPABILITY_CLASS,
} from './index.mjs';

const APP = 'session-queue-axis';
const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const SESSION = '018f0d90-7b12-7a22-8c33-445566778899';
const SESSION_2 = '018f0d90-7b15-7a22-8c33-445566778899';
const USER = '018f0d90-7b13-7a22-8c33-445566778899';
const AUTHORITY = '018f0d90-7b14-7a22-8c33-445566778899';
const AUTHORITY_2 = '018f0d90-7b16-7a22-8c33-445566778899';

const runtime = {
  createContractMockQueryBoundary(initialRows) {
    const rows = new Map(Object.entries(initialRows));
    return {
      current: (key) => rows.get(key) ?? [],
      query: (key, project = (value) => value) => project(rows.get(key) ?? []),
      write(key, update) {
        const next = update(rows.get(key) ?? []);
        rows.set(key, next);
        return next;
      },
      subscribe() { return () => {}; },
    };
  },
  createBoundaryContractDataProvider(_manifest, boundary) { return { boundary }; },
  createProviderQueryHandle() { return { dispose() {} }; },
  createProviderEphemeralHandle() { return { dispose() {} }; },
};

const manifest = {
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  schemaVersion: 'snapback.v1',
  schemaHash: 'queue-schema',
  bundleHash: 'queue-bundle',
  inputsHash: 'queue-inputs',
  capabilities: { derivedOptimisticOverlays: true, offlineReplay: true },
  queries: {
    listCards: {
      name: 'listCards',
      mode: 'live',
      defaultLive: true,
      reads: ['cards'],
    },
  },
  mutations: {
    addCard: {
      optimistic: true,
      plan: {
        steps: [{
          Insert: {
            table: 'cards',
            values: { card: { Arg: 'card' } },
            bind_id_as: 'cardId',
          },
        }],
        return_value: { Binding: 'cardId' },
      },
    },
  },
};

const coordinator = new AuthCoordinator({
  appId: APP,
  storage: createMemoryAuthCustodyStorage(),
  broadcastChannelFactory: null,
  hintStorage: null,
});
const anonymous = await coordinator.establishAnonymous({
  kind: 'anonymous',
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
});
await coordinator.transition(anonymous, {
  authority: {
    kind: 'session',
    authMode: 'sessions',
    authorizationStreamIncarnation: INCARNATION,
    sessionId: SESSION,
    userId: USER,
  },
  bearer: 'session-queue-bearer',
  refreshAfterMs: 60_000,
}, 'test_login');

let queryOnline = true;
let activeAuthorityInstanceId = AUTHORITY;
let activeSessionGeneration = 1;
const client = {
  authCoordinator: coordinator,
  async authSession() {
    return {
      clientProtocols: { authorityDescriptor: 1 },
      availability: { queuedReplay: { available: true } },
    };
  },
  captureAuthority: () => coordinator.capture(),
  registerAuthBarrierParticipant: (participant) => coordinator.registerParticipant(participant),
  async currentAuthorizationScope() {
    return {
      principalScope: {
        authMode: 'sessions',
        authorizationStreamIncarnation: INCARNATION,
        userId: USER,
      },
      authorityDescriptor: {
        descriptorVersion: 1,
        authorityInstanceId: activeAuthorityInstanceId,
        sessionGeneration: activeSessionGeneration,
      },
      queryAuthorization: {},
    };
  },
  async query() {
    if (!queryOnline) throw new TypeError('fetch failed');
    return { version: 1, rows: [{ _id: 'card_1', _version: 1, card: 'ace' }] };
  },
  async mutate() { throw new TypeError('fetch failed'); },
};

const physicalStore = createMemorySnapbackClientStore();
let retainedCalls = 0;
const store = {
  ...physicalStore,
  async getRetainedQuery(...args) {
    retainedCalls += 1;
    return physicalStore.getRetainedQuery(...args);
  },
  async putRetainedQuery(...args) {
    retainedCalls += 1;
    return physicalStore.putRetainedQuery(...args);
  },
};
const options = {
  runtime,
  client,
  clientStore: store,
  manifest,
  queryName: 'listCards',
  boundaryKey: 'cards',
  livePush: false,
  artifactIndex: { appId: APP },
  schemaManifest: { schemaHash: 'queue-schema', targetProfileId: 'local-dev' },
  retainedIdentity: {
    databaseId: 'queue-db',
    versionStreamId: 'queue-stream',
  },
};

const surface = await createSnapbackContractSurface(options);
assert.equal(surface.capabilityClass, SNAPBACK_CONTRACT_CAPABILITY_CLASS);
assert.equal(surface.retained(), false);
const queued = await surface.links.addCard({ card: 'king' });
assert.equal(queued.queued, true);
assert.equal((await physicalStore.snapshot()).pending.length, 1);
await surface.flush();
assert.equal(retainedCalls, 0, 'descriptor negotiation must not touch retained rows');

// Same principal, successor session/authority. The store transition retires
// predecessor custody before the surface swaps its captured descriptor; the
// next enqueue must therefore carry only the successor descriptor.
activeAuthorityInstanceId = AUTHORITY_2;
activeSessionGeneration = 2;
const beforeTransition = coordinator.capture();
await coordinator.transition(beforeTransition, {
  authority: {
    kind: 'session',
    authMode: 'sessions',
    authorizationStreamIncarnation: INCARNATION,
    sessionId: SESSION_2,
    userId: USER,
  },
  bearer: 'session-queue-bearer-2',
  refreshAfterMs: 60_000,
}, 'same_principal_new_session');
await surface.flush();
const successorQueued = await surface.links.addCard({ card: 'queen' });
assert.equal(successorQueued.queued, true);
const successorPending = (await physicalStore.snapshot()).pending;
assert.equal(successorPending.length, 1);
assert.equal(successorPending[0].authorityDescriptor.authorityInstanceId, AUTHORITY_2);
await surface.dispose();

queryOnline = false;
await assert.rejects(() => createSnapbackContractSurface(options), /fetch failed/);
assert.equal(retainedCalls, 0, 'session cold boot must not attempt legacy retained fallback');
assert.equal((await physicalStore.snapshot()).pending.length, 1);

console.log('session-queue-axis.test.mjs: all assertions passed');
