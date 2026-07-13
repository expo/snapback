import assert from 'node:assert/strict';

import {
  createMemorySnapbackClientStore,
  SNAPBACK_CLIENT_STORE_VERSION,
} from './client-store.mjs';

const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const AUTHORITY_INSTANCE = '018f0d90-7b12-7a22-8c33-445566778899';
const USER = '018f0d90-7b13-7a22-8c33-445566778899';
const AUTHORITY_KEY = `sha256:${'a'.repeat(64)}`;
const QUERY_KEY = 'myHand:{"gameId":"g1"}';
const VERSION_STREAM = 'stream_1';
const ACTIVATION_HASH = 'sha256:active-bundle';
const APP_ID = 'card-game';
const TARGET_PROFILE_ID = 'local-dev-sqlite-ibex';
const AUTHORIZATION = { incarnation: INCARNATION, epoch: 0 };
const ISSUER = {
  authorizationIncarnation: INCARNATION,
  bootSequence: 1,
  bootNonce: 'AAAAAAAAAAAAAAAAAAAAAA',
};
const EXPECTED = { authorityEpoch: 0, authorityKey: AUTHORITY_KEY };

const record = (version, rows = [{ card: 'ace' }]) => ({
  rows,
  version,
  versionStreamId: VERSION_STREAM,
  cursor: { stream: VERSION_STREAM, version },
});

const lease = ({ storeId, queryInstanceId, requestId, version, durationMs = 1_000 }) => ({
  protocolVersion: 1,
  leaseId: `lease_${version}`,
  leaseRequestId: requestId,
  issuerId: ISSUER,
  clientStoreId: storeId,
  queryKey: QUERY_KEY,
  queryInstanceId,
  principalId: USER,
  sessionIdAtIssue: 'session_1',
  providerKey: 'email-code',
  authorization: AUTHORIZATION,
  data: { versionStream: VERSION_STREAM, snapshotCommitVersion: version },
  activationHash: ACTIVATION_HASH,
  issuedAtServerMs: 10_000,
  authorizedUntilServerMs: 10_000 + durationMs,
  sessionNotAfterMs: 10_000 + durationMs,
  providerNotAfterMs: null,
  authorityInstanceId: AUTHORITY_INSTANCE,
  keyId: 'lease-key-1',
  mac: 'A'.repeat(43),
});

const obligation = ({ namespace, revision = 1, disposition = 'quarantine', minVersion = 101 }) => ({
  protocolVersion: 1,
  scopeId: {
    kind: 'subscription',
    issuerId: ISSUER,
    namespace,
    scopeSequence: 1,
    connectionGeneration: 1,
    subscriptionId: 'subscription_1',
  },
  revision,
  maxDisposition: disposition,
  witness: {
    authorization: AUTHORIZATION,
    data: { versionStream: VERSION_STREAM, minCommitVersion: minVersion },
  },
  ownerContinuityId: 'owner_subscription_1',
  retryEpisodeId: null,
});

const resolution = ({ obligation: pending, kind = 'snapshot', minVersion = 101 }) => ({
  protocolVersion: 1,
  kind,
  scopeId: pending.scopeId,
  revision: pending.revision,
  witness: {
    authorization: AUTHORIZATION,
    data: { versionStream: VERSION_STREAM, minCommitVersion: minVersion },
  },
  maxDisposition: pending.maxDisposition,
  ackToken: `ack_${pending.revision}`,
  ownerContinuityId: pending.ownerContinuityId,
});

const durable = {};
const store = createMemorySnapbackClientStore({ state: durable });
await store.bindAuthority({ authorityEpoch: 0, authorityKey: AUTHORITY_KEY });
await store.scopeToArtifacts({
  appId: APP_ID,
  targetProfileId: TARGET_PROFILE_ID,
  versionStreamId: VERSION_STREAM,
}, EXPECTED);
await store.scopeAuthorization({
  principalScope: {
    authMode: 'sessions',
    authorizationStreamIncarnation: INCARNATION,
    userId: USER,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: AUTHORITY_INSTANCE,
    sessionGeneration: 1,
  },
}, EXPECTED);

await assert.rejects(
  () => store.initializeAuthorizedRetainedQuery(QUERY_KEY, {
    authorization: AUTHORIZATION,
    issuerId: ISSUER,
    versionStream: VERSION_STREAM,
    principalId: USER,
    activationHash: ACTIVATION_HASH,
    appId: 'other-app',
    targetProfileId: TARGET_PROFILE_ID,
  }, EXPECTED),
  { code: 'SNAPBACK_AUTH_RETAINED_AUTHORITY_INVALID' },
);
const initialized = await store.initializeAuthorizedRetainedQuery(QUERY_KEY, {
  authorization: AUTHORIZATION,
  issuerId: ISSUER,
  versionStream: VERSION_STREAM,
  principalId: USER,
  activationHash: ACTIVATION_HASH,
  appId: APP_ID,
  targetProfileId: TARGET_PROFILE_ID,
}, EXPECTED);
assert.equal(initialized.namespace.queryInstanceId, 1);
assert.equal((await store.snapshot()).version, SNAPBACK_CLIENT_STORE_VERSION);

let firstRequest = await store.beginAuthorizedLeaseRequest(QUERY_KEY, {
  fence: initialized.fence,
  leaseRequestId: 'request_100',
  clientNowMs: 1_000,
}, EXPECTED);
await assert.rejects(
  () => store.commitAuthorizedRetainedSnapshot(QUERY_KEY, {
    fence: firstRequest.fence,
    lease: {
      ...lease({
        storeId: initialized.namespace.clientStoreId,
        queryInstanceId: initialized.namespace.queryInstanceId,
        requestId: firstRequest.request.leaseRequestId,
        version: 100,
      }),
      activationHash: 'sha256:other-bundle',
    },
    record: record(100),
    clientNowMs: 1_001,
  }, EXPECTED),
  { code: 'SNAPBACK_AUTHORIZED_LEASE_BINDING_MISMATCH' },
);
assert.equal((await store.snapshot()).retained[QUERY_KEY], undefined);
const afterRejectedLease = await store.captureAuthorizedRetainedQuery(QUERY_KEY, EXPECTED);
firstRequest = await store.beginAuthorizedLeaseRequest(QUERY_KEY, {
  fence: afterRejectedLease.fence,
  leaseRequestId: 'request_100_retry',
  clientNowMs: 1_002,
}, EXPECTED);
const firstSnapshot = await store.commitAuthorizedRetainedSnapshot(QUERY_KEY, {
  fence: firstRequest.fence,
  lease: lease({
    storeId: initialized.namespace.clientStoreId,
    queryInstanceId: initialized.namespace.queryInstanceId,
    requestId: firstRequest.request.leaseRequestId,
    version: 100,
  }),
  record: record(100),
  clientNowMs: 1_003,
}, EXPECTED);
assert.deepEqual(
  (await store.getAuthorizedRetainedQuery(QUERY_KEY, {
    fence: firstSnapshot.fence,
    clientNowMs: 1_500,
  }, EXPECTED)).rows,
  [{ card: 'ace' }],
);
const deadlineBeforeDelta = (await store.snapshot())
  .queryAuthorization[QUERY_KEY].clientDeadlineMs;
const deltaUpdate = await store.putAuthorizedRetainedQuery(QUERY_KEY, {
  fence: firstSnapshot.fence,
  record: record(100, [{ card: 'ace-updated' }]),
  clientNowMs: 1_500,
}, EXPECTED);
assert.equal(
  (await store.snapshot()).queryAuthorization[QUERY_KEY].clientDeadlineMs,
  deadlineBeforeDelta,
);
await assert.rejects(
  () => store.putRetainedQuery(QUERY_KEY, record(999)),
  { code: 'SNAPBACK_AUTHORIZED_LEASE_REQUIRED' },
);

// A coarse event hides before resnapshot, destroys no bytes, invalidates every
// predecessor callback, and does not let its resolving snapshot renew a lease.
const pending = obligation({ namespace: initialized.namespace });
const peer = createMemorySnapbackClientStore({ state: durable });
const peerCapture = await peer.captureAuthorizedRetainedQuery(QUERY_KEY, EXPECTED);
const invalidated = await store.receiveRetainedQueryObligation(
  QUERY_KEY,
  pending,
  deltaUpdate.fence,
  EXPECTED,
);
assert.equal(invalidated.disposition, 'quarantine');
assert.equal(await store.getAuthorizedRetainedQuery(QUERY_KEY, {
  fence: invalidated.fence,
  clientNowMs: 1_501,
}, EXPECTED), null);
assert.deepEqual((await store.snapshot()).retained[QUERY_KEY].rows, [{ card: 'ace-updated' }]);
await assert.rejects(
  () => peer.putAuthorizedRetainedQuery(QUERY_KEY, {
    fence: peerCapture.fence,
    record: record(101, [{ card: 'late-peer' }]),
    clientNowMs: 1_502,
  }, EXPECTED),
  { code: 'SNAPBACK_AUTH_QUERY_FENCE_STALE' },
);
await assert.rejects(
  () => store.commitAuthorizedRetainedSnapshot(QUERY_KEY, {
    fence: firstRequest.fence,
    lease: lease({
      storeId: initialized.namespace.clientStoreId,
      queryInstanceId: initialized.namespace.queryInstanceId,
      requestId: firstRequest.request.leaseRequestId,
      version: 100,
    }),
    record: record(100),
    clientNowMs: 1_502,
  }, EXPECTED),
  { code: 'SNAPBACK_AUTH_QUERY_FENCE_STALE' },
);

const applied = await store.applyRetainedQueryResolution(QUERY_KEY, {
  fence: invalidated.fence,
  resolution: resolution({ obligation: pending }),
  record: record(101, [{ card: 'king' }]),
}, EXPECTED);
assert.equal(applied.ackToken, 'ack_1');
assert.equal(applied.disposition, 'retain');
assert.equal((await store.snapshot()).queryAuthorization[QUERY_KEY].lease, null);

const renewalRequest = await store.beginAuthorizedLeaseRequest(QUERY_KEY, {
  fence: applied.fence,
  leaseRequestId: 'request_101',
  clientNowMs: 1_600,
}, EXPECTED);
const renewed = await store.commitAuthorizedRetainedSnapshot(QUERY_KEY, {
  fence: renewalRequest.fence,
  lease: lease({
    storeId: initialized.namespace.clientStoreId,
    queryInstanceId: initialized.namespace.queryInstanceId,
    requestId: renewalRequest.request.leaseRequestId,
    version: 101,
  }),
  record: record(101, [{ card: 'king' }]),
  clientNowMs: 1_601,
}, EXPECTED);
assert.deepEqual(
  (await store.getAuthorizedRetainedQuery(QUERY_KEY, {
    fence: renewed.fence,
    clientNowMs: 2_599,
  }, EXPECTED)).rows,
  [{ card: 'king' }],
);

// Equality is expired. Deletion and its generation tombstone commit before
// the diagnostic returns, and an explicit full revalidation can repopulate it.
await assert.rejects(
  () => store.getAuthorizedRetainedQuery(QUERY_KEY, {
    fence: renewed.fence,
    clientNowMs: 2_600,
  }, EXPECTED),
  { code: 'SNAPBACK_AUTHORIZED_LEASE_EXPIRED' },
);
let afterExpiry = await store.snapshot();
assert.equal(afterExpiry.retained[QUERY_KEY], undefined);
assert.equal(afterExpiry.queryAuthorization[QUERY_KEY].effectiveDisposition, 'delete');
const expiredCapture = await store.captureAuthorizedRetainedQuery(QUERY_KEY, EXPECTED);
const afterExpiryRequest = await store.beginAuthorizedLeaseRequest(QUERY_KEY, {
  fence: expiredCapture.fence,
  leaseRequestId: 'request_102',
  clientNowMs: 2_601,
}, EXPECTED);
const afterExpirySnapshot = await store.commitAuthorizedRetainedSnapshot(QUERY_KEY, {
  fence: afterExpiryRequest.fence,
  lease: lease({
    storeId: initialized.namespace.clientStoreId,
    queryInstanceId: initialized.namespace.queryInstanceId,
    requestId: afterExpiryRequest.request.leaseRequestId,
    version: 102,
  }),
  record: record(102, [{ card: 'queen' }]),
  clientNowMs: 2_602,
}, EXPECTED);

// A backward sample deletes before read and cannot revive by moving forward.
await store.getAuthorizedRetainedQuery(QUERY_KEY, {
  fence: afterExpirySnapshot.fence,
  clientNowMs: 2_700,
}, EXPECTED);
await assert.rejects(
  () => store.getAuthorizedRetainedQuery(QUERY_KEY, {
    fence: afterExpirySnapshot.fence,
    clientNowMs: 2_699,
  }, EXPECTED),
  { code: 'SNAPBACK_AUTH_CLOCK_ROLLBACK' },
);
assert.equal((await store.snapshot()).retained[QUERY_KEY], undefined);

// Retirement is crash-observable and instance identity is never reused.
const beforeRetirement = await store.captureAuthorizedRetainedQuery(QUERY_KEY, EXPECTED);
const retiring = await store.beginAuthorizedQueryRetirement(
  QUERY_KEY,
  beforeRetirement.fence,
  EXPECTED,
);
assert.equal((await store.snapshot()).queryAuthorization[QUERY_KEY].lifecycle, 'retiring');
assert.equal(await store.finishAuthorizedQueryRetirement(
  QUERY_KEY,
  retiring.queryInstanceId,
  EXPECTED,
), true);
const recreated = await store.initializeAuthorizedRetainedQuery(QUERY_KEY, {
  authorization: AUTHORIZATION,
  issuerId: ISSUER,
  versionStream: VERSION_STREAM,
  principalId: USER,
  activationHash: ACTIVATION_HASH,
  appId: APP_ID,
  targetProfileId: TARGET_PROFILE_ID,
}, EXPECTED);
assert.equal(recreated.namespace.queryInstanceId, 2);
await assert.rejects(
  () => store.receiveRetainedQueryObligation(
    QUERY_KEY,
    pending,
    recreated.fence,
    EXPECTED,
  ),
  { code: 'SNAPBACK_AUTH_QUERY_FENCE_STALE' },
);

// A malformed current-instance lease survives structural load only so the
// first authorized read can atomically delete its payload and leave the fence.
const malformedState = await store.snapshot();
const malformedStore = createMemorySnapbackClientStore({ state: malformedState });
const malformedRequest = await malformedStore.beginAuthorizedLeaseRequest(QUERY_KEY, {
  fence: recreated.fence,
  leaseRequestId: 'request_malformed',
  clientNowMs: 2_800,
}, EXPECTED);
const malformedSnapshot = await malformedStore.commitAuthorizedRetainedSnapshot(QUERY_KEY, {
  fence: malformedRequest.fence,
  lease: lease({
    storeId: recreated.namespace.clientStoreId,
    queryInstanceId: recreated.namespace.queryInstanceId,
    requestId: malformedRequest.request.leaseRequestId,
    version: 103,
  }),
  record: record(103),
  clientNowMs: 2_801,
}, EXPECTED);
malformedState.queryAuthorization[QUERY_KEY].lease.mac = 'not-a-mac';
const reloadedMalformed = createMemorySnapbackClientStore({ state: malformedState });
await assert.rejects(
  () => reloadedMalformed.getAuthorizedRetainedQuery(QUERY_KEY, {
    fence: malformedSnapshot.fence,
    clientNowMs: 2_802,
  }, EXPECTED),
  { code: 'SNAPBACK_AUTHORIZED_LEASE_INVALID' },
);
assert.equal((await reloadedMalformed.snapshot()).retained[QUERY_KEY], undefined);

// Format 4 had no lease proof. Session-mode rows are never grandfathered.
const legacy = {
  ...(await store.snapshot()),
  version: 4,
  queryInstanceHighWater: undefined,
  leaseClockHighWaterMs: undefined,
  queryAuthorization: {},
  retained: { planted: { rows: [{ secret: true }] } },
};
delete legacy.queryInstanceHighWater;
delete legacy.leaseClockHighWaterMs;
const migrated = createMemorySnapbackClientStore({ state: legacy });
assert.equal((await migrated.snapshot()).version, SNAPBACK_CLIENT_STORE_VERSION);
assert.deepEqual((await migrated.snapshot()).retained, {});

console.log('authorized-retained-store.test.mjs: all assertions passed');
