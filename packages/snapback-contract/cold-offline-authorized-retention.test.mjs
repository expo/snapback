import assert from 'node:assert/strict';

import { SnapbackClient } from '../../demos/_kit/client.mjs';
import {
  AuthCoordinator,
  authorizedLeaseActivationHash,
  createMemoryAuthCustodyStorage,
  createMemorySnapbackClientStore,
  createSnapbackContractSurface,
  retainedQueryKey,
} from './index.mjs';

const APP_ID = 'cold_offline_app';
const DATABASE_ID = 'cold-offline-db';
const TARGET_PROFILE_ID = 'local-dev-sqlite-ibex';
const VERSION_STREAM = 'cold_offline_stream';
const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const SESSION_ID = '018f0d90-7b12-7a22-8c33-445566778899';
const USER_ID = '018f0d90-7b13-7a22-8c33-445566778899';
const AUTHORITY_INSTANCE = '018f0d90-7b14-7a22-8c33-445566778899';
const QUERY_ARGS = { gameId: 'game_1' };
const QUERY_KEY = retainedQueryKey('myHand', QUERY_ARGS);
const AUTHORIZATION = { incarnation: INCARNATION, epoch: 7 };
const ISSUER = {
  authorizationIncarnation: INCARNATION,
  bootSequence: 1,
  bootNonce: 'AAAAAAAAAAAAAAAAAAAAAA',
};

const manifest = {
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  schemaVersion: 'snapback.v1',
  schemaHash: 'cold-offline-schema',
  inputsHash: 'cold-offline-inputs',
  bundleHash: 'cold-offline-bundle',
  capabilities: { offlineReplay: true },
  queries: {
    myHand: {
      name: 'myHand',
      mode: 'live',
      defaultLive: true,
      retainable: true,
      authorizationDependence: ['userId'],
      reads: ['hands'],
    },
  },
  mutations: {},
};
const schemaManifest = {
  appId: APP_ID,
  schemaVersion: manifest.schemaVersion,
  schemaHash: manifest.schemaHash,
  inputsHash: manifest.inputsHash,
  targetProfile: TARGET_PROFILE_ID,
};
const functionManifest = {
  schemaVersion: manifest.schemaVersion,
  bundleHash: manifest.bundleHash,
  inputsHash: manifest.inputsHash,
  functions: [{ name: 'myHand', authorizationDependence: ['userId'] }],
};
const activationHash = authorizedLeaseActivationHash({
  schemaVersion: manifest.schemaVersion,
  authMode: 'sessions',
  appId: APP_ID,
  schemaHash: manifest.schemaHash,
  bundleHash: manifest.bundleHash,
  inputsHash: manifest.inputsHash,
});

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

const custodyState = { custody: {} };
const initialCoordinator = new AuthCoordinator({
  appId: APP_ID,
  storage: createMemoryAuthCustodyStorage({ state: custodyState }),
  broadcastChannelFactory: null,
  hintStorage: null,
});
const anonymousCapture = await initialCoordinator.establishAnonymous({
  kind: 'anonymous',
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
});
const sessionCapture = await initialCoordinator.transition(anonymousCapture, {
  authority: {
    kind: 'session',
    authMode: 'sessions',
    authorizationStreamIncarnation: INCARNATION,
    sessionId: SESSION_ID,
    userId: USER_ID,
  },
  bearer: 'durable-bearer-never-used-offline',
  refreshAfterMs: Date.now() + 60_000,
});
await initialCoordinator.close();

const storeState = {};
const store = createMemorySnapbackClientStore({ state: storeState });
const expectedAuthority = {
  authorityEpoch: sessionCapture.authorityEpoch,
  authorityKey: sessionCapture.authorityKey,
};
await store.bindAuthority(expectedAuthority);
await store.scopeToArtifacts({
  schemaHash: manifest.schemaHash,
  inputsHash: manifest.inputsHash,
  targetProfileId: TARGET_PROFILE_ID,
  appId: APP_ID,
  databaseId: DATABASE_ID,
  versionStreamId: VERSION_STREAM,
}, expectedAuthority);
await store.scopeAuthorization({
  principalScope: {
    authMode: 'sessions',
    authorizationStreamIncarnation: INCARNATION,
    userId: USER_ID,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: AUTHORITY_INSTANCE,
    sessionGeneration: 1,
  },
}, expectedAuthority);
const initialized = await store.initializeAuthorizedRetainedQuery(QUERY_KEY, {
  authorization: AUTHORIZATION,
  issuerId: ISSUER,
  versionStream: VERSION_STREAM,
  principalId: USER_ID,
  activationHash,
  appId: APP_ID,
  targetProfileId: TARGET_PROFILE_ID,
}, expectedAuthority);
const startedClientMs = Date.now();
const reserved = await store.beginAuthorizedLeaseRequest(QUERY_KEY, {
  fence: initialized.fence,
  leaseRequestId: 'cold_offline_request',
  clientNowMs: startedClientMs,
}, expectedAuthority);
const durationMs = 60_000;
await store.commitAuthorizedRetainedSnapshot(QUERY_KEY, {
  fence: reserved.fence,
  lease: {
    protocolVersion: 1,
    leaseId: 'cold_offline_lease',
    leaseRequestId: reserved.request.leaseRequestId,
    issuerId: ISSUER,
    clientStoreId: initialized.namespace.clientStoreId,
    queryKey: QUERY_KEY,
    queryInstanceId: initialized.namespace.queryInstanceId,
    principalId: USER_ID,
    sessionIdAtIssue: SESSION_ID,
    providerKey: 'email-code',
    authorization: AUTHORIZATION,
    data: { versionStream: VERSION_STREAM, snapshotCommitVersion: 11 },
    activationHash,
    issuedAtServerMs: 10_000,
    authorizedUntilServerMs: 10_000 + durationMs,
    sessionNotAfterMs: 10_000 + durationMs,
    providerNotAfterMs: null,
    authorityInstanceId: AUTHORITY_INSTANCE,
    keyId: 'cold-offline-key',
    mac: 'A'.repeat(43),
  },
  record: {
    rows: [{ card: 'king-clubs' }],
    version: 11,
    cursor: { stream: VERSION_STREAM, version: 11 },
    versionStreamId: VERSION_STREAM,
  },
  clientNowMs: startedClientMs + 1,
}, expectedAuthority);

const coldCoordinator = new AuthCoordinator({
  appId: APP_ID,
  storage: createMemoryAuthCustodyStorage({ state: custodyState }),
  broadcastChannelFactory: null,
  hintStorage: null,
});
const coldClient = new SnapbackClient('http://offline.invalid', {
  authCoordinator: coldCoordinator,
  authInvalidationProtocol: 1,
  authorityDescriptorProtocol: 1,
  authorizedLeaseProtocol: 1,
  clientStoreId: initialized.namespace.clientStoreId,
});
const coldStore = createMemorySnapbackClientStore({ state: storeState });
const originalFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts += 1;
  throw new TypeError('fetch failed');
};
let surface = null;
try {
  surface = await createSnapbackContractSurface({
    runtime,
    client: coldClient,
    clientStore: coldStore,
    manifest,
    artifactIndex: { appId: APP_ID, schemaVersion: manifest.schemaVersion },
    schemaManifest,
    functionManifest,
    queryName: 'myHand',
    boundaryKey: 'hand',
    queryArgs: QUERY_ARGS,
    connectionId: 'cold-offline-live',
    retainedIdentity: {
      appId: APP_ID,
      databaseId: DATABASE_ID,
      targetProfileId: TARGET_PROFILE_ID,
      versionStreamId: VERSION_STREAM,
    },
  });
  assert.equal(surface.retained(), true);
  assert.equal(surface.connection(), 'stale');
  assert.deepEqual(surface.boundary.current('hand'), [{ card: 'king-clubs' }]);
  assert.equal(networkAttempts > 0, true, 'online renewal was attempted but did not gate offline render');
} finally {
  await surface?.dispose();
  await coldClient.closeAuth();
  globalThis.fetch = originalFetch;
}

console.log('cold-offline-authorized-retention.test.mjs: all assertions passed');
