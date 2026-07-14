// Composed item-7/item-8 Contract activation: descriptor-backed queued writes
// and lease-backed retained reads are independent session-mode axes.

import assert from 'node:assert/strict';

import {
  AuthCoordinator,
  authorizedLeaseActivationHash,
  createMemoryAuthCustodyStorage,
  createMemorySnapbackClientStore,
  createSnapbackContractSurface,
  SNAPBACK_CONTRACT_PARITY_CAPABILITY_CLASS,
} from './index.mjs';

const APP = 'contract-auth-app';
const TARGET = 'local-dev-sqlite-ibex';
const DATABASE = 'contract-auth-db';
const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const SESSION = '018f0d90-7b12-7a22-8c33-445566778899';
const USER = '018f0d90-7b13-7a22-8c33-445566778899';
const AUTHORITY = '018f0d90-7b14-7a22-8c33-445566778899';
const ISSUER = {
  authorizationIncarnation: INCARNATION,
  bootSequence: 1,
  bootNonce: 'AAAAAAAAAAAAAAAAAAAAAA',
};
const AUTHORIZATION = { incarnation: INCARNATION, epoch: 4 };
const VERSION_STREAM = 'stream_contract_auth';
const SCHEMA_VERSION = 'snapback.v1';
const SCHEMA_HASH = 'schema-contract-auth';
const BUNDLE_HASH = 'bundle-contract-auth';
const INPUTS_HASH = 'inputs-contract-auth';
const ACTIVATION_HASH = authorizedLeaseActivationHash({
  schemaVersion: SCHEMA_VERSION,
  authMode: 'sessions',
  appId: APP,
  schemaHash: SCHEMA_HASH,
  bundleHash: BUNDLE_HASH,
  inputsHash: INPUTS_HASH,
});

const runtime = {
  createContractMockQueryBoundary(initialRows) {
    const rows = new Map(Object.entries(initialRows));
    const listeners = new Map();
    return {
      current: (key) => rows.get(key) ?? [],
      query: (key, project = (value) => value) => project(rows.get(key) ?? []),
      write(key, update) {
        const next = update(rows.get(key) ?? []);
        rows.set(key, next);
        for (const listener of listeners.get(key) ?? []) listener(next);
        return next;
      },
      subscribe(key, listener) {
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(listener);
        return () => listeners.get(key)?.delete(listener);
      },
    };
  },
  createBoundaryContractDataProvider(_manifest, boundary, options) {
    return {
      boundary,
      subscribe(name, args, observer) {
        observer({ status: 'ready', rows: options.queries[name](args, boundary) });
        return { dispose() {} };
      },
    };
  },
  createProviderQueryHandle() { return { dispose() {} }; },
  createProviderEphemeralHandle() { return { dispose() {} }; },
};

const manifest = {
  appId: APP,
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  schemaVersion: SCHEMA_VERSION,
  schemaHash: SCHEMA_HASH,
  bundleHash: BUNDLE_HASH,
  inputsHash: INPUTS_HASH,
  capabilities: {
    derivedOptimisticOverlays: true,
    offlineReplay: true,
  },
  queries: {
    myHand: {
      name: 'myHand',
      mode: 'live',
      defaultLive: true,
      reads: ['hands'],
      retainable: true,
      authorizationDependence: ['userId'],
    },
  },
  mutations: {
    playCard: {
      optimistic: true,
      plan: {
        steps: [{
          Insert: {
            table: 'hands',
            values: {
              card: { Arg: 'card' },
              ownerId: { AuthUserId: true },
            },
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
const anonymousCapture = await coordinator.establishAnonymous({
  kind: 'anonymous',
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
});
await coordinator.transition(anonymousCapture, {
  authority: {
    kind: 'session',
    authMode: 'sessions',
    authorizationStreamIncarnation: INCARNATION,
    sessionId: SESSION,
    userId: USER,
  },
  bearer: 'bearer-contract-auth',
  refreshAfterMs: 60_000,
}, 'test_login');

let online = true;
let mutationOnline = true;
let leaseCalls = 0;
let now = 10_000;
const originalDateNow = Date.now;
Date.now = () => now;

const sessionFacts = {
  clientProtocols: {
    authClient: 1,
    authInvalidation: 1,
    authorityDescriptor: 1,
    authorizedLease: 1,
  },
  availability: {
    queuedReplay: { available: true },
    retainedReads: { available: true },
  },
  authorizedLease: {
    protocolVersion: 1,
    defaultMs: 86_400_000,
    hardMaxMs: 86_400_000,
    configuredMs: 1_000,
    clamps: ['session', 'provider'],
    renewal: 'full-revalidation',
    timeBasis: 'server-absolute+client-request-elapsed',
    clockRollback: 'delete-before-read',
  },
};

const client = {
  authCoordinator: coordinator,
  async authSession() { return sessionFacts; },
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
        authorityInstanceId: AUTHORITY,
        sessionGeneration: 1,
      },
      queryAuthorization: {},
    };
  },
  async connectionGrant() {
    if (!online) {
      const error = new TypeError('fetch failed');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    return {
      id: 'connection_contract_auth',
      token: 'token_contract_auth',
      authorizationInvalidation: {
        protocolVersion: 1,
        issuerId: ISSUER,
        connectionGeneration: 1,
        authorization: AUTHORIZATION,
        versionStream: VERSION_STREAM,
      },
    };
  },
  async authorizedLeaseQuery(_name, {
    leaseRequestId,
    authorizationNamespace,
  }) {
    leaseCalls += 1;
    if (!online) {
      const error = new TypeError('fetch failed');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    return {
      version: 7,
      rows: [{ _id: 'hand_ada', _version: 7, card: 'ace', ownerId: USER }],
      authorizedLease: {
        protocolVersion: 1,
        leaseId: `lease_${leaseCalls}`,
        leaseRequestId,
        issuerId: ISSUER,
        clientStoreId: authorizationNamespace.clientStoreId,
        queryKey: authorizationNamespace.queryKey,
        queryInstanceId: authorizationNamespace.queryInstanceId,
        principalId: USER,
        sessionIdAtIssue: SESSION,
        providerKey: 'email-code',
        authorization: AUTHORIZATION,
        data: { versionStream: VERSION_STREAM, snapshotCommitVersion: 7 },
        activationHash: ACTIVATION_HASH,
        issuedAtServerMs: 5_000,
        authorizedUntilServerMs: 6_000,
        sessionNotAfterMs: 6_000,
        providerNotAfterMs: null,
        authorityInstanceId: AUTHORITY,
        keyId: 'lease-key-1',
        mac: 'A'.repeat(43),
      },
    };
  },
  async mutate() {
    if (mutationOnline) return { version: 8, result: 'played' };
    const error = new TypeError('fetch failed');
    error.code = 'ECONNREFUSED';
    throw error;
  },
  async query() { throw new Error('ordinary query must not renew session retention'); },
};

const store = createMemorySnapbackClientStore();
const options = {
  runtime,
  client,
  clientStore: store,
  manifest,
  queryName: 'myHand',
  boundaryKey: 'hand',
  queryArgs: { gameId: 'game_1' },
  livePush: false,
  artifactIndex: {
    appId: APP,
    schemaVersion: SCHEMA_VERSION,
    schemaHash: SCHEMA_HASH,
    bundleHash: BUNDLE_HASH,
    inputsHash: INPUTS_HASH,
  },
  schemaManifest: {
    appId: APP,
    schemaVersion: SCHEMA_VERSION,
    schemaHash: SCHEMA_HASH,
    inputsHash: INPUTS_HASH,
    targetProfileId: TARGET,
  },
  functionManifest: {
    appId: APP,
    schemaVersion: SCHEMA_VERSION,
    bundleHash: BUNDLE_HASH,
    inputsHash: INPUTS_HASH,
    functions: [{
      name: 'myHand',
      retainable: true,
      authorizationDependence: ['userId'],
    }],
  },
  retainedIdentity: {
    appId: APP,
    databaseId: DATABASE,
    targetProfileId: TARGET,
    versionStreamId: VERSION_STREAM,
  },
};

try {
  const onlineSurface = await createSnapbackContractSurface(options);
  await onlineSurface.flush();
  assert.equal(onlineSurface.capabilityClass, SNAPBACK_CONTRACT_PARITY_CAPABILITY_CLASS);
  assert.deepEqual(onlineSurface.boundary.current('hand').map((row) => row.card), ['ace']);
  assert.equal(leaseCalls, 1);

  // Item 7 remains independently useful in sessions mode: a failed mutation
  // is retained under the current authority descriptor even though this test
  // later takes the lease-bearing query offline.
  mutationOnline = false;
  const queued = await onlineSurface.links.playCard({ card: 'king' });
  assert.equal(queued.queued, true);
  assert.equal(onlineSurface.pendingCount(), 1);
  assert.equal((await store.snapshot()).pending[0].authorityDescriptor.authorityInstanceId, AUTHORITY);
  await onlineSurface.dispose();

  online = false;
  now = 10_500;
  const offlineSurface = await createSnapbackContractSurface(options);
  assert.equal(offlineSurface.retained(), true);
  assert.deepEqual(offlineSurface.boundary.current('hand').map((row) => row.card), ['ace']);
  assert.equal(leaseCalls, 1, 'offline boot did not invent or extend a lease without the server');
  await offlineSurface.dispose();

  // Equality is expired. The store deletes before Contract can construct a
  // boundary, and the unavailable server cannot turn those bytes back into a
  // successful offline surface.
  now = 11_000;
  await assert.rejects(
    () => createSnapbackContractSurface(options),
    /fetch failed/,
  );
  const snapshot = await store.snapshot();
  assert.equal(snapshot.retained['myHand:{"gameId":"game_1"}'], undefined);
  assert.equal(snapshot.pending.length, 1, 'lease expiry does not discard item-7 queue custody');
} finally {
  Date.now = originalDateNow;
}

console.log('authorized-contract.test.mjs: all assertions passed');
