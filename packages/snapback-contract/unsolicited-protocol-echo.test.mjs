// ENG-24987: a /auth/session response echoing protocol versions the transport
// never offered is not capability. When the client publishes its offer tuple
// (`client.authProtocols`, as the kit does), Contract must not let unsolicited
// echoes enable queued replay, authority-descriptor-backed queue custody,
// invalidation-backed retention, or retained reads.
//
// @ref LLP 0058#bootstrap-handshake — exact, fail-closed offer/echo negotiation.

import assert from 'node:assert/strict';

import {
  AuthCoordinator,
  authorizedLeaseActivationHash,
  createMemoryAuthCustodyStorage,
  createMemorySnapbackClientStore,
  createSnapbackContractSurface,
} from './index.mjs';

const APP = 'unsolicited-echo-app';
const TARGET = 'local-dev-sqlite-ibex';
const DATABASE = 'unsolicited-echo-db';
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
const VERSION_STREAM = 'stream_unsolicited_echo';
const SCHEMA_VERSION = 'snapback.v1';
const SCHEMA_HASH = 'schema-unsolicited-echo';
const BUNDLE_HASH = 'bundle-unsolicited-echo';
const INPUTS_HASH = 'inputs-unsolicited-echo';
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

// Every scenario echoes ALL FOUR axes as version 1. Only the client's own
// published offer distinguishes a solicited echo from an unsolicited one.
const POISONED_ECHO = Object.freeze({
  authClient: 1,
  authInvalidation: 1,
  authorityDescriptor: 1,
  authorizedLease: 1,
});

const originalDateNow = Date.now;
Date.now = () => 10_000;

async function runScenario({ name, offer, expectQueued, expectLease }) {
  const coordinator = new AuthCoordinator({
    appId: `${APP}/${name}`,
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
    bearer: `bearer-${name}`,
    refreshAfterMs: 60_000,
  }, 'test_login');

  let leaseCalls = 0;
  const client = {
    authCoordinator: coordinator,
    authProtocols: Object.freeze({ authClient: 1, ...offer }),
    async authSession() {
      return {
        clientProtocols: { ...POISONED_ECHO },
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
          authorityInstanceId: AUTHORITY,
          sessionGeneration: 1,
        },
        queryAuthorization: {},
      };
    },
    async connectionGrant() {
      return {
        id: `connection_${name}`,
        token: `token_${name}`,
        authorizationInvalidation: {
          protocolVersion: 1,
          issuerId: ISSUER,
          connectionGeneration: 1,
          authorization: AUTHORIZATION,
          versionStream: VERSION_STREAM,
        },
      };
    },
    async authorizedLeaseQuery(_name, { leaseRequestId, authorizationNamespace }) {
      leaseCalls += 1;
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
      const error = new TypeError('fetch failed');
      error.code = 'ECONNREFUSED';
      throw error;
    },
    async query() {
      return {
        version: 7,
        rows: [{ _id: 'hand_ada', _version: 7, card: 'ace', ownerId: USER }],
      };
    },
  };

  const store = createMemorySnapbackClientStore();
  const surface = await createSnapbackContractSurface({
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
  });
  await surface.flush();
  assert.equal(surface.retained(), false, `${name}: online boot never reports retained bytes`);
  assert.equal(
    leaseCalls,
    expectLease ? 1 : 0,
    expectLease
      ? `${name}: the fully offered lease surface engages exactly once`
      : `${name}: unsolicited invalidation/lease echoes must not engage lease-backed retention`,
  );

  const failedMutation = surface.links.playCard({ card: 'king' });
  if (expectQueued) {
    const queued = await failedMutation;
    assert.equal(queued.queued, true, `${name}: the offered descriptor axis queues offline`);
    assert.equal((await store.snapshot()).pending.length, 1);
  } else {
    await assert.rejects(failedMutation, /fetch failed/, `${name}: an unsolicited descriptor echo must not queue`);
    assert.equal(
      (await store.snapshot()).pending.length,
      0,
      `${name}: no queue custody exists under an unsolicited descriptor echo`,
    );
  }

  const retainedSnapshot = await store.snapshot();
  assert.equal(
    Object.keys(retainedSnapshot.retained ?? {}).length > 0,
    expectLease,
    expectLease
      ? `${name}: the fully offered lease surface retains rows`
      : `${name}: no retained rows exist without an offered invalidation+lease pair`,
  );

  // The authority-transition refresh path re-evaluates the same gates. A
  // same-principal successor session must not resurrect the unsolicited axes.
  const beforeTransition = coordinator.capture();
  await coordinator.transition(beforeTransition, {
    authority: {
      kind: 'session',
      authMode: 'sessions',
      authorizationStreamIncarnation: INCARNATION,
      sessionId: SESSION,
      userId: USER,
    },
    bearer: `bearer-${name}-2`,
    refreshAfterMs: 60_000,
  }, 'same_principal_new_session');
  await surface.flush();
  const postTransitionMutation = surface.links.playCard({ card: 'queen' });
  if (expectQueued) {
    assert.equal((await postTransitionMutation).queued, true);
  } else {
    await assert.rejects(
      postTransitionMutation,
      /fetch failed/,
      `${name}: the refresh path must not enable queueing from unsolicited echoes`,
    );
    assert.equal((await store.snapshot()).pending.length, 0);
  }

  await surface.dispose();
  await coordinator.close();
  return { name };
}

try {
  // All three optional axes echoed without being offered: nothing is enabled.
  await runScenario({
    name: 'nothing-offered',
    offer: { authInvalidation: null, authorityDescriptor: null, authorizedLease: null },
    expectQueued: false,
    expectLease: false,
  });

  // Positive control for the descriptor axis; invalidation/lease echoes stay
  // unsolicited so retention stays disabled.
  await runScenario({
    name: 'descriptor-offered',
    offer: { authInvalidation: null, authorityDescriptor: 1, authorizedLease: null },
    expectQueued: true,
    expectLease: false,
  });

  // One unsolicited axis is enough to keep retention off: invalidation…
  await runScenario({
    name: 'invalidation-unsolicited',
    offer: { authInvalidation: null, authorityDescriptor: 1, authorizedLease: 1 },
    expectQueued: true,
    expectLease: false,
  });

  // …and the authorized lease.
  await runScenario({
    name: 'lease-unsolicited',
    offer: { authInvalidation: 1, authorityDescriptor: 1, authorizedLease: null },
    expectQueued: true,
    expectLease: false,
  });

  // Full-offer positive control: the gates key on the offer, not on a fixed
  // refusal, so a genuinely negotiated tuple still enables both capabilities.
  await runScenario({
    name: 'all-offered',
    offer: { authInvalidation: 1, authorityDescriptor: 1, authorizedLease: 1 },
    expectQueued: true,
    expectLease: true,
  });
} finally {
  Date.now = originalDateNow;
}

console.log('unsolicited-protocol-echo.test.mjs: all assertions passed');
