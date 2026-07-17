// Composed format-6 LLP 0059/0053 principal/data + authority-instance/queue tests.

import assert from 'node:assert/strict';

import {
  AuthCoordinator,
  canonicalAuthorityKey,
  createMemoryAuthCustodyStorage,
} from './auth-coordinator.mjs';
import {
  createLocalStorageSnapbackClientStore,
  createMemorySnapbackClientStore,
  createSnapbackClientStoreAuthParticipant,
  SNAPBACK_CLIENT_STORE_VERSION,
} from './client-store.mjs';

const APP = 'snapback.test/store-authority';
const INCARNATION = '018f0d90-7b21-7a22-8c33-445566778899';
const INCARNATION_2 = '018f0d90-7b28-7a22-8c33-445566778899';
const SESSION = '018f0d90-7b22-7a22-8c33-445566778899';
const SESSION_2 = '018f0d90-7b29-7a22-8c33-445566778899';
const SESSION_3 = '018f0d90-7b2a-7a22-8c33-445566778899';
const SESSION_B = '018f0d90-7b26-7a22-8c33-445566778899';
const USER = '018f0d90-7b23-7a22-8c33-445566778899';
const AUTHORITY_1 = '018f0d90-7b24-7a22-8c33-445566778899';
const AUTHORITY_2 = '018f0d90-7b25-7a22-8c33-445566778899';
const AUTHORITY_3 = '018f0d90-7b26-7a22-8c33-445566778899';
const USER_2 = '018f0d90-7b27-7a22-8c33-445566778899';
const anonymous = {
  kind: 'anonymous',
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
};
const authenticated = {
  kind: 'session',
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
  sessionId: SESSION,
  userId: USER,
};
const authenticatedB = {
  ...authenticated,
  sessionId: SESSION_B,
};
const key0 = canonicalAuthorityKey(APP, anonymous);
const key1 = canonicalAuthorityKey(APP, authenticated);
const keyB = canonicalAuthorityKey(APP, authenticatedB);
const principal = {
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
  userId: USER,
};
const devPrincipal = { ...principal, authMode: 'dev' };
const descriptor = (authorityInstanceId, sessionGeneration = 1) => ({
  descriptorVersion: 1,
  authorityInstanceId,
  sessionGeneration,
});

const expectCode = async (code, operation) => {
  await assert.rejects(operation, (error) => error?.code === code);
};

const authorityPrincipal = (authority) => ({
  authMode: authority.authMode,
  authorizationStreamIncarnation: authority.authorizationStreamIncarnation,
  userId: authority.kind === 'session' ? authority.userId : null,
});

const successorFor = (authority) => authority.kind === 'session'
  ? { authority, bearer: `bearer:${authority.sessionId}`, refreshAfterMs: 10_000 }
  : { authority, bearer: null, refreshAfterMs: null };

const coordinatorAt = async (authority) => {
  const coordinator = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const bootstrap = {
    kind: 'anonymous',
    authMode: authority.authMode,
    authorizationStreamIncarnation: authority.authorizationStreamIncarnation,
  };
  let capture = await coordinator.establishAnonymous(bootstrap);
  if (authority.kind === 'session') {
    capture = await coordinator.transition(
      capture,
      successorFor(authority),
      'test_setup_session',
    );
  }
  return { coordinator, capture };
};

// Format 3 did not possess a server-issued queue authority. Fully validate,
// delete retained rows, and quarantine queued bytes as never replayable.
{
  const legacy = {
    version: 3,
    origin: 'legacy-v3-origin',
    generation: 4,
    authorityEpoch: null,
    authorityKey: null,
    authFingerprint: null,
    artifactScope: null,
    nextSequence: 3,
    retained: { q: { rows: [{ private: true }] } },
    pending: [{ id: 'cm_v3', function: 'write', sequence: 1, status: 'pending' }],
    failed: [],
    acknowledged: [],
    stranded: [{
      id: 'cm_v3_stranded',
      function: 'write',
      sequence: 2,
      args: { secret: 'legacy-v3-unproven-payload' },
      replayable: false,
      rerecordable: true,
      discardOnly: false,
    }],
    legacyV2Stranded: [],
  };
  const migratedStore = createMemorySnapbackClientStore({ state: legacy });
  const migrated = await migratedStore.snapshot();
  assert.equal(migrated.version, SNAPBACK_CLIENT_STORE_VERSION);
  assert.deepEqual(migrated.retained, {});
  assert.deepEqual(migrated.pending, []);
  assert.deepEqual(migrated.stranded, []);
  assert.deepEqual(await migratedStore.strandedMutations(), []);
  assert.equal(migrated.legacyV3Stranded[0].id, 'cm_v3');
  assert.equal(migrated.legacyV3Stranded[0].replayable, false);
  assert.equal(migrated.legacyV3Stranded[1].id, 'cm_v3_stranded');
  assert.equal(migrated.legacyV3Stranded[1].replayable, false);
  assert.equal(
    migrated.legacyV3Stranded[1].args.secret,
    'legacy-v3-unproven-payload',
  );
  const reopened = createMemorySnapbackClientStore({ state: legacy });
  assert.deepEqual(await reopened.strandedMutations(), []);
  assert.equal((await reopened.snapshot()).legacyV3Stranded.length, 2);
}

// Format 6 makes terminallyUnbound a mandatory anti-rebind bit. Format 5 did
// not carry it, so migration validates but deletes every privacy/queue
// namespace and leaves a persistent marker that only an exact generation-CAS
// coordinator transition may consume.
{
  const predecessorStore = createMemorySnapbackClientStore();
  await predecessorStore.bindAuthority({
    authorityEpoch: 7,
    authorityKey: key1,
    authMode: 'sessions',
  });
  const queue = await predecessorStore.captureMutationQueue({
    authorityEpoch: 7,
    authorityKey: key1,
  });
  await predecessorStore.putRetainedQuery('legacy-v5-private', {
    authorityEpoch: 7,
    authorityKey: key1,
    rows: [{ secret: 'legacy-v5-retained' }],
  });
  await predecessorStore.enqueueMutation({
    id: 'cm_legacy_v5_private',
    function: 'legacyV5Write',
    authorityEpoch: 7,
    authorityKey: key1,
    ...queue,
  });
  const legacyV5 = await predecessorStore.snapshot();
  legacyV5.version = 5;
  delete legacyV5.terminallyUnbound;

  const migratedStore = createMemorySnapbackClientStore({ state: legacyV5 });
  const migrated = await migratedStore.snapshot();
  assert.equal(migrated.version, SNAPBACK_CLIENT_STORE_VERSION);
  assert.equal(migrated.terminallyUnbound, true);
  assert.equal(migrated.authorityEpoch, null);
  assert.equal(migrated.authorityKey, null);
  assert.equal(JSON.stringify(migrated).includes('legacy-v5-retained'), false);
  assert.equal(JSON.stringify(migrated).includes('cm_legacy_v5_private'), false);
  await expectCode(
    'SNAPBACK_CLIENT_STORE_AUTHORITY_STALE',
    migratedStore.bindAuthority({ authorityEpoch: 7, authorityKey: key1 }),
  );
  const binding = await migratedStore.authorityBindingCapture();
  await migratedStore.transitionAuthority({
    expectedEpoch: 7,
    nextEpoch: 7,
    nextAuthorityKey: key1,
    expectedStoreGeneration: binding.storeGeneration,
  });
  assert.deepEqual(await migratedStore.authorityScope(), {
    authorityEpoch: 7,
    authorityKey: key1,
  });
  assert.equal((await migratedStore.snapshot()).terminallyUnbound, false);

  const truncatedV6 = await migratedStore.snapshot();
  delete truncatedV6.terminallyUnbound;
  assert.throws(
    () => createMemorySnapbackClientStore({ state: truncatedV6 }),
    (error) => error?.code === 'SNAPBACK_CLIENT_STORE_CORRUPT',
  );
}

// The principal axis preserves rows across a new session. The independent
// authority-instance axis strands (and never silently retags) queued writes.
{
  const twoAxis = createMemorySnapbackClientStore();
  // This item-7-only fixture stays on the legacy dev retained path. Sessions
  // exercise the lease-bearing principal axis in authorized-retained-store.
  await twoAxis.scopeAuthorization({
    principalScope: devPrincipal,
    authorityDescriptor: descriptor(AUTHORITY_1),
    queryAuthorization: {},
  });
  await twoAxis.scopeToAuth('legacy-session-a');
  await twoAxis.putRetainedQuery('private', { rows: [{ card: 'ace' }] });
  await twoAxis.enqueueMutation({
    id: 'cm_authority_1',
    function: 'playCard',
    authorityDescriptor: descriptor(AUTHORITY_1),
  });

  // Refresh changes generation only: both axes remain usable.
  await twoAxis.scopeToAuth('legacy-refresh-b');
  await twoAxis.scopeAuthorization({
    principalScope: devPrincipal,
    authorityDescriptor: descriptor(AUTHORITY_1, 2),
  });
  assert.equal((await twoAxis.pendingMutations()).length, 1);

  // New session, same user: rows survive; old queue is explicitly stranded.
  await twoAxis.scopeToAuth('legacy-session-c');
  await twoAxis.scopeAuthorization({
    principalScope: devPrincipal,
    authorityDescriptor: descriptor(AUTHORITY_2),
  });
  assert.deepEqual((await twoAxis.getRetainedQuery('private')).rows, [{ card: 'ace' }]);
  assert.deepEqual(await twoAxis.pendingMutations(), []);
  const stranded = await twoAxis.strandedMutations();
  assert.equal(stranded[0].id, 'cm_authority_1');
  assert.equal(stranded[0].replayable, false);
  assert.equal(stranded[0].reason, 'authority_instance_changed');
  assert.equal(stranded[0].rerecordable, true);
  assert.equal(stranded[0].discardOnly, false);
  assert.deepEqual(stranded[0].predecessorPrincipalScope, devPrincipal);
  await twoAxis.discardStranded();
  assert.deepEqual(await twoAxis.strandedMutations(), []);

  // Different principal owns a different retained-data namespace.
  await twoAxis.scopeAuthorization({
    principalScope: { ...devPrincipal, userId: 'another-user' },
    authorityDescriptor: descriptor(AUTHORITY_2),
  });
  assert.equal(await twoAxis.getRetainedQuery('private'), null);
  await assert.rejects(
    twoAxis.scopeAuthorization({
      principalScope: devPrincipal,
      authorityDescriptor: descriptor(AUTHORITY_2),
      queryAuthorization: { lease: 'not-item-7' },
    }),
    /queryAuthorization must be an empty object/,
  );
}

// A format-6 rerecordable payload is principal-owned. Tampering only the
// persisted top-level principal must not make user A's mutation visible to
// user B when the store is reopened.
{
  const ownerStore = createMemorySnapbackClientStore();
  await ownerStore.scopeAuthorization({
    principalScope: devPrincipal,
    authorityDescriptor: descriptor(AUTHORITY_1),
  });
  await ownerStore.enqueueMutation({
    id: 'cm_principal_bound_stranded',
    function: 'writePrivate',
    args: { secret: 'principal-a-only' },
    authorityDescriptor: descriptor(AUTHORITY_1),
  });
  await ownerStore.scopeAuthorization({
    principalScope: devPrincipal,
    authorityDescriptor: descriptor(AUTHORITY_2),
  });
  const persisted = await ownerStore.snapshot();
  const validReopen = createMemorySnapbackClientStore({
    state: structuredClone(persisted),
  });
  assert.equal(
    (await validReopen.strandedMutations())[0].args.secret,
    'principal-a-only',
  );

  const tampered = structuredClone(persisted);
  tampered.principalScope = { ...devPrincipal, userId: USER_2 };
  const successorReopen = createMemorySnapbackClientStore({ state: tampered });
  assert.deepEqual(await successorReopen.strandedMutations(), []);
  assert.equal(
    JSON.stringify(await successorReopen.snapshot()).includes('principal-a-only'),
    false,
  );
}

// Artifact replacement preserves the exact queue authority on its redacted
// diagnostic tombstone and binds that tombstone to the replacement artifact
// namespace, so format-6 can validate and reopen its own committed bytes.
{
  const persisted = {};
  let artifactStore = createMemorySnapbackClientStore({ state: persisted });
  await artifactStore.scopeAuthorization({
    principalScope: devPrincipal,
    authorityDescriptor: descriptor(AUTHORITY_1, 7),
  });
  await artifactStore.scopeToArtifacts({
    schemaHash: 'schema:a',
    inputsHash: 'inputs:a',
  });
  const queue = await artifactStore.captureMutationQueue();
  await artifactStore.enqueueMutation({
    id: 'cm_modern_artifact_transition',
    function: 'writePrivate',
    args: { secret: 'old-artifact-payload' },
    ctxLedger: { version: 1, ids: ['old-artifact-ledger'], now: 1 },
    authorityDescriptor: descriptor(AUTHORITY_1, 7),
    schemaHash: 'schema:a',
    inputsHash: 'inputs:a',
    ...queue,
  });
  // Generation refresh is not an authority-instance change. The tombstone
  // keeps the descriptor the queued record actually captured, not a later
  // projection copied from the store root.
  await artifactStore.scopeAuthorization({
    principalScope: devPrincipal,
    authorityDescriptor: descriptor(AUTHORITY_1, 8),
  });
  await artifactStore.scopeToArtifacts({
    schemaHash: 'schema:b',
    inputsHash: 'inputs:b',
  });

  artifactStore = createMemorySnapbackClientStore({ state: persisted });
  const reopenedQueue = await artifactStore.captureMutationQueue();
  const [tombstone] = await artifactStore.failedMutations({
    ...reopenedQueue,
    schemaHash: 'schema:b',
    inputsHash: 'inputs:b',
  });
  assert.equal(tombstone.id, 'cm_modern_artifact_transition');
  assert.deepEqual(tombstone.authorityDescriptor, descriptor(AUTHORITY_1, 7));
  assert.equal(tombstone.schemaHash, 'schema:b');
  assert.equal(tombstone.inputsHash, 'inputs:b');
  assert.equal(tombstone.diagnostic.code, 'SNAPBACK_CLIENT_ARTIFACT_STALE');
  assert.equal(Object.hasOwn(tombstone, 'args'), false);
  assert.equal(Object.hasOwn(tombstone, 'ctxLedger'), false);
  assert.equal(
    JSON.stringify(await artifactStore.snapshot()).includes('old-artifact-payload'),
    false,
  );

  const secondReopen = createMemorySnapbackClientStore({ state: persisted });
  assert.equal((await secondReopen.failedMutations(reopenedQueue)).length, 1);
}

// Descriptor replacement without a server-resolved user is not evidence of a
// same-principal new session. Direct scoping fails closed instead of retaining
// an anonymous payload for re-record.
{
  const anonymousScope = {
    authMode: 'sessions',
    authorizationStreamIncarnation: INCARNATION,
    userId: null,
  };
  const anonymousStore = createMemorySnapbackClientStore();
  await anonymousStore.scopeAuthorization({
    principalScope: anonymousScope,
    authorityDescriptor: descriptor(AUTHORITY_1),
  });
  await anonymousStore.enqueueMutation({
    id: 'cm_anonymous_descriptor_change',
    function: 'write',
    args: { secret: 'anonymous-unproven-payload' },
    authorityDescriptor: descriptor(AUTHORITY_1),
  });
  await anonymousStore.scopeAuthorization({
    principalScope: anonymousScope,
    authorityDescriptor: descriptor(AUTHORITY_2),
  });
  const state = await anonymousStore.snapshot();
  assert.deepEqual(state.pending, []);
  assert.deepEqual(state.stranded, []);
  assert.equal(JSON.stringify(state).includes('anonymous-unproven-payload'), false);
}

// Item 6 and item 7 independently allocated format 4. Format 6 recognizes
// only their exact/XOR predecessor shapes: item 6's descriptor-less queue is
// discard-only, while item 7's descriptor-bound queue gains the independent
// invalidation generation without losing replay identity.
{
  const item6 = createMemorySnapbackClientStore();
  const queue = await item6.captureMutationQueue();
  await item6.enqueueMutation({
    id: 'cm_item6_v4',
    function: 'write',
    args: { secret: 'item6-payload' },
    ...queue,
  });
  const legacyItem6 = await item6.snapshot();
  legacyItem6.version = 4;
  delete legacyItem6.terminallyUnbound;
  delete legacyItem6.principalScope;
  delete legacyItem6.authorityDescriptor;
  delete legacyItem6.queryAuthorization;
  delete legacyItem6.queryInstanceHighWater;
  delete legacyItem6.leaseClockHighWaterMs;
  delete legacyItem6.legacyV3Stranded;
  delete legacyItem6.legacyV4Stranded;
  legacyItem6.retained.private = { rows: [{ secret: 'item6-row' }] };
  legacyItem6.legacyV2Stranded.push({
    id: 'cm_item6_legacy',
    function: 'legacyWrite',
    sequence: 9,
    args: { secret: 'older-item6-payload' },
  });
  const migratedItem6 = createMemorySnapbackClientStore({ state: legacyItem6 });
  const item6State = await migratedItem6.snapshot();
  assert.deepEqual(item6State.pending, []);
  assert.deepEqual(item6State.retained, {});
  assert.deepEqual(item6State.legacyV2Stranded, []);
  assert.equal(item6State.legacyV4Stranded[0].id, 'cm_item6_v4');
  assert.equal(item6State.legacyV4Stranded[0].replayable, false);
  assert.equal(item6State.legacyV4Stranded[0].discardOnly, true);

  const item7 = createMemorySnapbackClientStore();
  await item7.scopeAuthorization({
    principalScope: devPrincipal,
    authorityDescriptor: descriptor(AUTHORITY_1),
  });
  const item7Queue = await item7.captureMutationQueue();
  const item7Failed = await item7.enqueueMutation({
    id: 'cm_item7_v4_failed',
    function: 'write',
    args: { secret: 'item7-failed-payload' },
    authorityDescriptor: descriptor(AUTHORITY_1),
    ...item7Queue,
  });
  await item7.settleMutation(item7Failed.id, { status: 'failed', ...item7Queue });
  const item7Acknowledged = await item7.enqueueMutation({
    id: 'cm_item7_v4_ack',
    function: 'write',
    authFingerprint: 'auth:item7',
    authorityDescriptor: descriptor(AUTHORITY_1),
    ...item7Queue,
  });
  await item7.settleMutation(item7Acknowledged.id, {
    status: 'confirmed',
    ...item7Queue,
  });
  await item7.enqueueMutation({
    id: 'cm_item7_v4',
    function: 'write',
    args: { secret: 'item7-payload' },
    authorityDescriptor: descriptor(AUTHORITY_1),
    ...item7Queue,
  });
  await item7.putRetainedQuery('private', { rows: [{ secret: 'item7-row' }] });
  const legacyItem7 = await item7.snapshot();
  legacyItem7.stranded.push({
    id: 'cm_item7_unproven_stranded',
    function: 'oldWrite',
    sequence: 50,
    args: { secret: 'item7-unproven-stranded' },
  });
  legacyItem7.legacyV2Stranded.push({
    id: 'cm_item7_unproven_legacy2',
    function: 'oldWrite',
    sequence: 51,
    args: { secret: 'item7-unproven-legacy2' },
  });
  legacyItem7.legacyV3Stranded.push({
    id: 'cm_item7_unproven_legacy3',
    function: 'oldWrite',
    sequence: 52,
    args: { secret: 'item7-unproven-legacy3' },
  });
  const item7QueueAuthorization = structuredClone(legacyItem7.queueAuthorization);
  legacyItem7.version = 4;
  delete legacyItem7.terminallyUnbound;
  delete legacyItem7.queueAuthorization;
  delete legacyItem7.queryInstanceHighWater;
  delete legacyItem7.leaseClockHighWaterMs;
  delete legacyItem7.legacyV4Stranded;
  const exactItem7V4 = structuredClone(legacyItem7);
  const migratedItem7 = createMemorySnapbackClientStore({ state: legacyItem7 });
  const migratedQueue = await migratedItem7.captureMutationQueue();
  const item7State = await migratedItem7.snapshot();
  assert.deepEqual(
    (await migratedItem7.pendingMutations(migratedQueue)).map((entry) => entry.id),
    ['cm_item7_v4'],
  );
  assert.deepEqual(
    (await migratedItem7.failedMutations(migratedQueue)).map((entry) => entry.id),
    ['cm_item7_v4_failed'],
  );
  assert.deepEqual(item7State.acknowledged, []);
  assert.deepEqual(item7State.stranded, []);
  assert.deepEqual(item7State.legacyV2Stranded, []);
  assert.deepEqual(item7State.legacyV3Stranded, []);
  assert.deepEqual(
    (await migratedItem7.getRetainedQuery('private')).rows,
    [{ secret: 'item7-row' }],
  );

  const ambiguousPredecessors = [
    ['both-axes', (state) => {
      state.queueAuthorization = structuredClone(item7QueueAuthorization);
    }],
    ['partial-item7', (state) => {
      delete state.queryAuthorization;
    }],
    ['null-item7-axes', (state) => {
      state.principalScope = null;
      state.authorityDescriptor = null;
    }],
    ['neither-axis', (state) => {
      delete state.principalScope;
      delete state.authorityDescriptor;
      delete state.queryAuthorization;
    }],
    ['hybrid-item6', (state) => {
      state.queueAuthorization = structuredClone(item7QueueAuthorization);
      delete state.authorityDescriptor;
      delete state.queryAuthorization;
    }],
  ];
  for (const [name, corrupt] of ambiguousPredecessors) {
    const malicious = structuredClone(exactItem7V4);
    malicious.stranded.push({
      id: `cm_${name}_stranded`,
      function: 'oldWrite',
      sequence: 40,
      args: { secret: `${name}-stranded-secret` },
    });
    malicious.legacyV2Stranded.push({
      id: `cm_${name}_legacy2`,
      function: 'oldWrite',
      sequence: 41,
      args: { secret: `${name}-legacy-secret` },
    });
    corrupt(malicious);
    const migrated = await createMemorySnapbackClientStore({ state: malicious }).snapshot();
    assert.deepEqual(migrated.retained, {}, `${name}: retained`);
    assert.deepEqual(migrated.pending, [], `${name}: pending`);
    assert.deepEqual(migrated.failed, [], `${name}: failed`);
    assert.deepEqual(migrated.acknowledged, [], `${name}: acknowledgements`);
    assert.deepEqual(migrated.stranded, [], `${name}: stranded`);
    assert.deepEqual(migrated.legacyV2Stranded, [], `${name}: legacy v2`);
    assert.deepEqual(migrated.legacyV3Stranded, [], `${name}: legacy v3`);
    assert.equal(migrated.legacyV4Stranded.length, 2, `${name}: quarantine`);
    for (const tombstone of migrated.legacyV4Stranded) {
      assert.equal(tombstone.legacyShape, 'ambiguous');
      assert.equal(tombstone.discardOnly, true);
      assert.equal(Object.hasOwn(tombstone, 'args'), false);
    }
    const bytes = JSON.stringify(migrated);
    for (const secret of [
      'item7-payload',
      'item7-row',
      `${name}-stranded-secret`,
      `${name}-legacy-secret`,
    ]) assert.equal(bytes.includes(secret), false, `${name}: deleted ${secret}`);
    assert.equal(migrated.principalScope, null);
    assert.equal(migrated.authorityDescriptor, null);
  }
}

// Principal identity is decided before queue authority. A different principal
// or an unscoped predecessor deletes retained rows and every executable,
// receipt, modern-stranded, and legacy-stranded namespace.
{
  const seeded = createMemorySnapbackClientStore();
  await seeded.scopeAuthorization({
    principalScope: devPrincipal,
    authorityDescriptor: descriptor(AUTHORITY_1),
  });
  await seeded.putRetainedQuery('private', { rows: [{ secret: 'principal-row' }] });
  let queue = await seeded.captureMutationQueue();
  await seeded.enqueueMutation({
    id: 'cm_old_stranded',
    function: 'write',
    args: { secret: 'old-stranded' },
    authorityDescriptor: descriptor(AUTHORITY_1),
    ...queue,
  });
  await seeded.scopeAuthorization({
    principalScope: devPrincipal,
    authorityDescriptor: descriptor(AUTHORITY_2),
  });
  queue = await seeded.captureMutationQueue();
  const failed = await seeded.enqueueMutation({
    id: 'cm_current_failed',
    function: 'write',
    args: { secret: 'current-failed' },
    authorityDescriptor: descriptor(AUTHORITY_2),
    ...queue,
  });
  await seeded.settleMutation(failed.id, { status: 'failed', ...queue });
  const confirmed = await seeded.enqueueMutation({
    id: 'cm_current_ack',
    function: 'write',
    authFingerprint: 'auth:principal',
    authorityDescriptor: descriptor(AUTHORITY_2),
    ...queue,
  });
  await seeded.settleMutation(confirmed.id, { status: 'confirmed', ...queue });
  await seeded.enqueueMutation({
    id: 'cm_current_pending',
    function: 'write',
    args: { secret: 'current-pending' },
    authorityDescriptor: descriptor(AUTHORITY_2),
    ...queue,
  });
  const seededState = await seeded.snapshot();
  seededState.legacyV2Stranded.push({
    id: 'cm_legacy2_private', function: 'write', sequence: 70, args: { secret: 'legacy2' },
  });
  seededState.legacyV3Stranded.push({
    id: 'cm_legacy3_private', function: 'write', sequence: 71, args: { secret: 'legacy3' },
  });
  seededState.legacyV4Stranded.push({
    id: 'cm_legacy4_private', function: 'write', sequence: 72, args: { secret: 'legacy4' },
  });

  const switched = createMemorySnapbackClientStore({ state: structuredClone(seededState) });
  await switched.scopeAuthorization({
    principalScope: { ...devPrincipal, userId: USER_2 },
    authorityDescriptor: descriptor(AUTHORITY_3),
  });
  const switchedState = await switched.snapshot();
  assert.deepEqual(switchedState.retained, {});
  for (const field of [
    'pending',
    'failed',
    'acknowledged',
    'stranded',
    'legacyV2Stranded',
    'legacyV3Stranded',
    'legacyV4Stranded',
  ]) assert.deepEqual(switchedState[field], [], `different principal clears ${field}`);
  assert.equal(JSON.stringify(switchedState).includes('principal-row'), false);
  assert.equal(JSON.stringify(switchedState).includes('current-pending'), false);

  const unknownState = structuredClone(seededState);
  unknownState.principalScope = null;
  unknownState.authorityDescriptor = null;
  unknownState.pending = [];
  unknownState.failed = [];
  const unknown = createMemorySnapbackClientStore({ state: unknownState });
  await unknown.scopeAuthorization({
    principalScope: devPrincipal,
    authorityDescriptor: descriptor(AUTHORITY_3),
  });
  const adopted = await unknown.snapshot();
  assert.deepEqual(adopted.retained, {});
  for (const field of [
    'pending',
    'failed',
    'acknowledged',
    'stranded',
    'legacyV2Stranded',
    'legacyV3Stranded',
    'legacyV4Stranded',
  ]) assert.deepEqual(adopted[field], [], `unknown predecessor clears ${field}`);
}

// v2 validates without treating its generation/fingerprint as server
// authority. Fingerprint-bearing private state is delete-only; explicitly
// unscoped queued work is isolated in the never-replayable legacy namespace.
{
  const legacy = {
    version: 2,
    origin: 'legacy-origin',
    generation: 77,
    authFingerprint: null,
    artifactScope: null,
    nextSequence: 3,
    retained: {
      private: { rows: [{ secret: true }], authFingerprint: 'client-asserted' },
    },
    pending: [
      { id: 'cm_private', function: 'write', sequence: 1, status: 'pending', authFingerprint: 'client-asserted' },
      { id: 'cm_anonymous', function: 'write', sequence: 2, status: 'pending' },
    ],
    failed: [],
    acknowledged: [],
  };
  const store = createMemorySnapbackClientStore({ state: legacy });
  const migrated = await store.snapshot();
  assert.equal(migrated.version, SNAPBACK_CLIENT_STORE_VERSION);
  assert.equal(migrated.authorityEpoch, null);
  assert.equal(migrated.generation, 77);
  await store.bindAuthority({ authorityEpoch: 0, authorityKey: key0, authMode: 'sessions' });
  const bound = await store.snapshot();
  assert.equal(bound.authorityEpoch, 0);
  assert.equal(bound.authorityKey, key0);
  assert.deepEqual(bound.retained, {});
  assert.deepEqual(bound.pending, []);
  assert.equal(bound.legacyV2Stranded.length, 1);
  assert.equal(bound.legacyV2Stranded[0].id, 'cm_anonymous');
  assert.equal(bound.legacyV2Stranded[0].replayable, false);
}

// The real coordinator participant derives every LLP 0059 transition-table
// row from the exact predecessor/successor authorities. Mounting the successor
// authorization scope must not resurrect any collection the durable barrier
// deleted or redacted.
{
  const sessionA = {
    kind: 'session',
    authMode: 'sessions',
    authorizationStreamIncarnation: INCARNATION,
    sessionId: SESSION,
    userId: USER,
  };
  const rows = [
    {
      name: 'anonymous_to_authenticated',
      previous: anonymous,
      next: sessionA,
      expected: 'redacted',
    },
    {
      name: 'authenticated_to_different_user',
      previous: sessionA,
      next: {
        ...sessionA,
        sessionId: SESSION_3,
        userId: USER_2,
      },
      expected: 'delete',
    },
    {
      name: 'same_user_new_session',
      previous: sessionA,
      next: { ...sessionA, sessionId: SESSION_2 },
      expected: 'rerecordable',
    },
    {
      name: 'authenticated_to_anonymous',
      previous: sessionA,
      next: anonymous,
      expected: 'delete',
    },
    {
      name: 'dev_to_sessions',
      previous: { ...anonymous, authMode: 'dev' },
      next: anonymous,
      expected: 'redacted',
    },
    {
      name: 'sessions_to_dev',
      previous: sessionA,
      next: { ...anonymous, authMode: 'dev' },
      expected: 'delete',
    },
    {
      name: 'authorization_incarnation_changed',
      previous: sessionA,
      next: {
        ...sessionA,
        authorizationStreamIncarnation: INCARNATION_2,
      },
      expected: 'delete',
    },
  ];

  for (const row of rows) {
    const { coordinator, capture: predecessor } = await coordinatorAt(row.previous);
    let mounted = createMemorySnapbackClientStore();
    await mounted.bindAuthority({
      authorityEpoch: predecessor.authorityEpoch,
      authorityKey: predecessor.authorityKey,
      authMode: row.previous.authMode,
    });
    await mounted.scopeAuthorization({
      principalScope: authorityPrincipal(row.previous),
      authorityDescriptor: descriptor(AUTHORITY_1),
    }, predecessor);
    // Session retained rows require the item-8 AuthorizedLease path, whose
    // transition behavior is covered by authorized-retained-store.test.mjs.
    // This table isolates the mutation-queue privacy transition.
    const queue = await mounted.captureMutationQueue(predecessor);
    const failed = await mounted.enqueueMutation({
      id: `cm_${row.name}_failed`,
      function: 'privateWrite',
      args: { secret: `private/${row.name}/failed` },
      authorityDescriptor: descriptor(AUTHORITY_1),
      ...predecessor,
      ...queue,
    });
    await mounted.settleMutation(failed.id, {
      status: 'failed',
      ...predecessor,
      ...queue,
    });
    const acknowledged = await mounted.enqueueMutation({
      id: `cm_${row.name}_ack`,
      function: 'privateWrite',
      authFingerprint: `auth:${row.name}`,
      authorityDescriptor: descriptor(AUTHORITY_1),
      ...predecessor,
      ...queue,
    });
    await mounted.settleMutation(acknowledged.id, {
      status: 'confirmed',
      ...predecessor,
      ...queue,
    });
    await mounted.enqueueMutation({
      id: `cm_${row.name}_pending`,
      function: 'privateWrite',
      args: { secret: `private/${row.name}/pending` },
      authorityDescriptor: descriptor(AUTHORITY_1),
      ...predecessor,
      ...queue,
    });
    const seeded = await mounted.snapshot();
    seeded.stranded.push({
      id: `cm_${row.name}_already_stranded`,
      function: 'privateWrite',
      sequence: 100,
      args: { secret: `private/${row.name}/already-stranded` },
      predecessorPrincipalScope: authorityPrincipal(row.previous),
      replayable: false,
      rerecordable: true,
      discardOnly: false,
    });
    seeded.stranded.push({
      id: `cm_${row.name}_unknown_stranded`,
      function: 'privateWrite',
      sequence: 104,
      args: { secret: `private/${row.name}/unknown-stranded` },
      replayable: false,
    });
    for (const [field, suffix, sequence] of [
      ['legacyV2Stranded', 'legacy2', 101],
      ['legacyV3Stranded', 'legacy3', 102],
      ['legacyV4Stranded', 'legacy4', 103],
    ]) {
      seeded[field].push({
        id: `cm_${row.name}_${suffix}`,
        function: 'privateWrite',
        sequence,
        args: { secret: `private/${row.name}/${suffix}` },
        replayable: false,
      });
    }
    mounted = createMemorySnapbackClientStore({ state: seeded });
    const unregister = coordinator.registerParticipant(
      createSnapbackClientStoreAuthParticipant(mounted),
    );
    try {
      const successor = await coordinator.transition(
        predecessor,
        successorFor(row.next),
        row.name,
      );
      assert.deepEqual(await mounted.authorityScope(), {
        authorityEpoch: successor.authorityEpoch,
        authorityKey: successor.authorityKey,
      }, `${row.name}: durable authority`);

      // Model the real Contract resume/mount path after the coordinator's
      // durable barrier has installed the successor epoch.
      await mounted.scopeAuthorization({
        principalScope: authorityPrincipal(row.next),
        authorityDescriptor: descriptor(AUTHORITY_3),
      }, successor);
      const state = await mounted.snapshot();
      assert.deepEqual(state.pending, [], `${row.name}: pending`);
      assert.deepEqual(state.failed, [], `${row.name}: failed`);
      assert.deepEqual(state.acknowledged, [], `${row.name}: acknowledgements`);
      assert.deepEqual(state.legacyV2Stranded, [], `${row.name}: legacy v2`);
      assert.deepEqual(state.legacyV3Stranded, [], `${row.name}: legacy v3`);
      assert.deepEqual(state.legacyV4Stranded, [], `${row.name}: legacy v4`);

      const bytes = JSON.stringify(state);
      if (row.expected === 'rerecordable') {
        assert.deepEqual(state.retained, {}, `${row.name}: no unleased retention`);
        assert.deepEqual(
          state.stranded.map((entry) => entry.id).sort(),
          [
            `cm_${row.name}_already_stranded`,
            `cm_${row.name}_failed`,
            `cm_${row.name}_pending`,
          ].sort(),
        );
        for (const id of [`cm_${row.name}_failed`, `cm_${row.name}_pending`]) {
          const entry = state.stranded.find((candidate) => candidate.id === id);
          assert.equal(entry.rerecordable, true, `${row.name}: ${id} rerecordable`);
          assert.equal(entry.discardOnly, false, `${row.name}: ${id} payload visible`);
          assert.deepEqual(entry.predecessorPrincipalScope, authorityPrincipal(row.previous));
        }
        assert.equal(bytes.includes(`private/${row.name}/pending`), true);
        assert.equal(bytes.includes(`private/${row.name}/failed`), true);
        assert.equal(bytes.includes(`private/${row.name}/unknown-stranded`), false);
      } else {
        assert.deepEqual(state.retained, {}, `${row.name}: retained deleted`);
        assert.equal(
          bytes.includes(`private/${row.name}/`),
          false,
          `${row.name}: no predecessor privacy bytes`,
        );
        if (row.expected === 'redacted') {
          assert.deepEqual(
            state.stranded.map((entry) => entry.id).sort(),
            [`cm_${row.name}_failed`, `cm_${row.name}_pending`].sort(),
          );
          for (const entry of state.stranded) {
            assert.equal(entry.replayable, false);
            assert.equal(entry.discardOnly, true);
            assert.equal(Object.hasOwn(entry, 'args'), false);
          }
        } else {
          assert.deepEqual(state.stranded, [], `${row.name}: stranded deleted`);
        }
      }
    } finally {
      await unregister();
      await coordinator.close();
    }
  }
}

// Format-2 custody recovery carries and validates the exact predecessor and
// successor authorities in its durable transition intent. A same-user
// next-session recovery therefore applies the ordinary table row
// idempotently: private queued payloads remain stranded/rerecordable and can
// never replay under the successor session.
{
  const custodyState = { custody: {} };
  const owner = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: custodyState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const bootstrap = await owner.establishAnonymous(anonymous);
  const sessionA = {
    kind: 'session',
    authMode: 'sessions',
    authorizationStreamIncarnation: INCARNATION,
    sessionId: SESSION,
    userId: USER,
  };
  const predecessor = await owner.transition(
    bootstrap,
    successorFor(sessionA),
    'recovery_setup',
  );
  let recoveringStore = createMemorySnapbackClientStore();
  await recoveringStore.bindAuthority({
    authorityEpoch: predecessor.authorityEpoch,
    authorityKey: predecessor.authorityKey,
    authMode: 'sessions',
  });
  await recoveringStore.scopeAuthorization({
    principalScope: authorityPrincipal(sessionA),
    authorityDescriptor: descriptor(AUTHORITY_1),
  }, predecessor);
  const queue = await recoveringStore.captureMutationQueue(predecessor);
  await recoveringStore.enqueueMutation({
    id: 'cm_recovery_pending',
    function: 'privateWrite',
    args: { secret: 'private/recovery/pending' },
    authorityDescriptor: descriptor(AUTHORITY_1),
    ...predecessor,
    ...queue,
  });
  const seeded = await recoveringStore.snapshot();
  seeded.stranded.push({
    id: 'cm_recovery_stranded',
    function: 'privateWrite',
    sequence: 20,
    args: { secret: 'private/recovery/stranded' },
    predecessorPrincipalScope: authorityPrincipal(sessionA),
    replayable: false,
    rerecordable: true,
    discardOnly: false,
  });
  recoveringStore = createMemorySnapbackClientStore({ state: seeded });

  owner.registerParticipant({
    name: 'fail-before-durable-store',
    async commitDurable() {
      throw new Error('leave custody in clearing for recovery');
    },
  });
  const sameUserNextSession = { ...sessionA, sessionId: SESSION_2 };
  await assert.rejects(
    owner.transition(
      predecessor,
      successorFor(sameUserNextSession),
      'recovery_unknown_predecessor',
    ),
    { code: 'SNAPBACK_AUTH_TRANSITION_FAILED' },
  );

  const recovery = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: custodyState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const unregister = recovery.registerParticipant(
    createSnapbackClientStoreAuthParticipant(recoveringStore),
  );
  try {
    const successor = await recovery.synchronize();
    await recoveringStore.scopeAuthorization({
      principalScope: authorityPrincipal(sameUserNextSession),
      authorityDescriptor: descriptor(AUTHORITY_3),
    }, successor);
    const state = await recoveringStore.snapshot();
    assert.deepEqual(state.retained, {});
    assert.deepEqual(state.pending, []);
    assert.deepEqual(state.failed, []);
    assert.deepEqual(state.acknowledged, []);
    assert.deepEqual(
      state.stranded.map((entry) => entry.id).sort(),
      ['cm_recovery_pending', 'cm_recovery_stranded'],
    );
    for (const entry of state.stranded) {
      assert.equal(entry.replayable, false);
      assert.equal(entry.rerecordable, true);
      assert.equal(entry.discardOnly, false);
      assert.deepEqual(entry.predecessorPrincipalScope, authorityPrincipal(sessionA));
    }
    assert.equal(
      state.stranded.find((entry) => entry.id === 'cm_recovery_pending').reason,
      'same_principal_new_session',
    );
    assert.equal(JSON.stringify(state).includes('private/recovery/pending'), true);
    assert.equal(JSON.stringify(state).includes('private/recovery/stranded'), true);
  } finally {
    await unregister();
    await recovery.close();
    await owner.close();
  }
}

const store = createMemorySnapbackClientStore();
await store.bindAuthority({ authorityEpoch: 0, authorityKey: key0, authMode: 'sessions' });
const authority0 = { authorityEpoch: 0, authorityKey: key0 };
const queue0 = await store.captureMutationQueue(authority0);

await expectCode(
  'SNAPBACK_CLIENT_STORE_AUTHORITY_STALE',
  () => store.putRetainedQuery('q', { rows: [{ secret: 'untagged' }] }),
);
await store.putRetainedQuery('q', { rows: [{ secret: 'a' }], ...authority0 });
assert.equal(await store.getRetainedQuery('q'), null);
assert.deepEqual((await store.getRetainedQuery('q', authority0)).rows, [{ secret: 'a' }]);

await expectCode(
  'SNAPBACK_CLIENT_STORE_AUTHORITY_STALE',
  () => store.enqueueMutation({ function: 'write' }),
);
const queued = await store.enqueueMutation({
  id: 'cm_epoch0',
  function: 'write',
  authFingerprint: 'auth:anonymous',
  ...authority0,
  ...queue0,
});
await expectCode(
  'SNAPBACK_CLIENT_STORE_AUTHORITY_STALE',
  () => store.settleMutation(queued.id, { status: 'confirmed' }),
);
assert.equal((await store.pendingMutations({ ...authority0, ...queue0 })).length, 1);
await store.settleMutation(queued.id, {
  status: 'confirmed',
  output: 1,
  ...authority0,
  ...queue0,
});
assert.deepEqual(await store.pendingMutationAcknowledgements(10, 'auth:anonymous'), []);
assert.deepEqual(
  await store.pendingMutationAcknowledgements(10, 'auth:anonymous', authority0),
  [queued.id],
);

// A fresh terminal custody transition can target a physical store already
// bound to the exact epoch-zero tuple. Exact-current is idempotent only after
// every privacy-bearing namespace is actually clean; retained and queued
// predecessor bytes must be deleted before the participant reports success.
{
  const terminalStore = createMemorySnapbackClientStore();
  const terminalAuthority = { authorityEpoch: 0, authorityKey: keyB };
  await terminalStore.bindAuthority({ ...terminalAuthority, authMode: 'sessions' });
  const terminalQueue = await terminalStore.captureMutationQueue(terminalAuthority);
  await terminalStore.putRetainedQuery('terminal-private', {
    ...terminalAuthority,
    rows: [{ secret: 'terminal-retained-secret' }],
  });
  await terminalStore.enqueueMutation({
    id: 'cm_terminal_private',
    function: 'writeTerminalPrivate',
    authFingerprint: 'auth:terminal-private',
    ...terminalAuthority,
    ...terminalQueue,
  });
  const participant = createSnapbackClientStoreAuthParticipant(terminalStore);
  await participant.commitDurable({
    previousAuthority: {
      kind: 'servicePrincipal',
      authMode: 'sessions',
      actorUserId: USER,
      credentialId: SESSION,
      credentialGeneration: 0,
      grantId: SESSION_B,
    },
    nextAuthority: null,
    expectedEpoch: null,
    nextEpoch: 0,
    nextAuthorityKey: keyB,
    disposition: 'delete',
  });
  const terminalState = await terminalStore.snapshot();
  assert.equal(JSON.stringify(terminalState).includes('terminal-retained-secret'), false);
  assert.equal(JSON.stringify(terminalState).includes('cm_terminal_private'), false);
  assert.deepEqual(terminalState.retained, {});
  assert.deepEqual(terminalState.pending, []);
  assert.deepEqual(terminalState.failed, []);
  assert.deepEqual(terminalState.acknowledged, []);
  assert.deepEqual(terminalState.stranded, []);
  assert.equal(terminalState.principalScope, null);
  assert.equal(terminalState.authFingerprint, null);
  assert.deepEqual(await terminalStore.authorityScope(), terminalAuthority);

  await terminalStore.purgeAuthority({ authorityKey: keyB });
  await expectCode(
    'SNAPBACK_CLIENT_QUEUE_GENERATION_STALE',
    () => terminalStore.enqueueMutation({
      id: 'cm_delayed_after_terminal_purge',
      function: 'writeDelayedTerminalPrivate',
      ...terminalQueue,
    }),
  );
  assert.deepEqual(await terminalStore.authorityScope(), {
    authorityEpoch: null,
    authorityKey: null,
  });
  await expectCode(
    'SNAPBACK_CLIENT_STORE_AUTHORITY_STALE',
    () => terminalStore.bindAuthority({ authorityEpoch: 0, authorityKey: keyB }),
  );
  await terminalStore.transitionAuthority({
    expectedEpoch: 0,
    nextEpoch: 0,
    nextAuthorityKey: key1,
  });
  assert.deepEqual(await terminalStore.authorityScope(), {
    authorityEpoch: 0,
    authorityKey: key1,
  });

  const successorStore = createMemorySnapbackClientStore();
  const successorAuthority = { authorityEpoch: 1, authorityKey: keyB };
  await successorStore.bindAuthority({ ...successorAuthority, authMode: 'sessions' });
  const successorQueue = await successorStore.captureMutationQueue(successorAuthority);
  await successorStore.putRetainedQuery('agent-successor-private', {
    ...successorAuthority,
    rows: [{ secret: 'agent-successor-retained' }],
  });
  await successorStore.enqueueMutation({
    id: 'cm_agent_successor_private',
    function: 'writeAgentSuccessorPrivate',
    authFingerprint: 'auth:agent-successor',
    ...successorAuthority,
    ...successorQueue,
  });
  const successorParticipant = createSnapbackClientStoreAuthParticipant(successorStore);
  await successorParticipant.commitDurable({
    previousAuthority: {
      kind: 'servicePrincipal',
      authMode: 'sessions',
      actorUserId: USER,
      credentialId: SESSION,
      credentialGeneration: 0,
      grantId: SESSION_B,
    },
    nextAuthority: {
      kind: 'servicePrincipal',
      authMode: 'sessions',
      actorUserId: USER,
      credentialId: SESSION,
      credentialGeneration: 1,
      grantId: SESSION_2,
    },
    expectedEpoch: 0,
    nextEpoch: 1,
    nextAuthorityKey: keyB,
    disposition: 'delete',
  });
  const successorState = await successorStore.snapshot();
  assert.equal(JSON.stringify(successorState).includes('agent-successor-retained'), true);
  assert.equal(JSON.stringify(successorState).includes('cm_agent_successor_private'), true);
}

// A terminal callback that wins while an initially empty Contract store is
// still unbound records a durable bind fence. A delayed direct B bind cannot
// recreate the terminal tuple; only a coordinator-proven active adoption can
// consume the clean marker.
{
  const initiallyUnbound = createMemorySnapbackClientStore();
  await initiallyUnbound.purgeAuthority({ authorityKey: keyB });
  await expectCode(
    'SNAPBACK_CLIENT_STORE_AUTHORITY_STALE',
    () => initiallyUnbound.bindAuthority({ authorityEpoch: 0, authorityKey: keyB }),
  );
  await initiallyUnbound.transitionAuthority({
    expectedEpoch: 0,
    nextEpoch: 0,
    nextAuthorityKey: key1,
  });
  assert.deepEqual(await initiallyUnbound.authorityScope(), {
    authorityEpoch: 0,
    authorityKey: key1,
  });
}

// Terminal purge also invalidates a captured queue at the numeric ceiling
// without wrapping or reusing the same two-axis queue identity.
{
  const ceilingState = {};
  const ceilingStore = createMemorySnapbackClientStore({ state: ceilingState });
  const authority = { authorityEpoch: 0, authorityKey: keyB };
  await ceilingStore.bindAuthority({ ...authority, authMode: 'sessions' });
  ceilingState.queueAuthorization.queueGeneration = Number.MAX_SAFE_INTEGER;
  const captured = await ceilingStore.captureMutationQueue(authority);
  await ceilingStore.purgeAuthority({ authorityKey: keyB });
  await expectCode(
    'SNAPBACK_CLIENT_QUEUE_GENERATION_STALE',
    () => ceilingStore.enqueueMutation({
      id: 'cm_delayed_after_terminal_ceiling',
      function: 'writeDelayedTerminalCeiling',
      ...captured,
    }),
  );
  assert.equal(
    (await ceilingStore.snapshot()).queueAuthorization.queueGeneration,
    Number.MAX_SAFE_INTEGER,
  );
}

// A real coordinator transition drives the physical store's expected-epoch
// participant. The predecessor becomes unreachable before successor resume,
// and every delayed operation fails without changing current bytes.
{
  const custodyState = { custody: {} };
  const coordinator = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: custodyState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const capture0 = await coordinator.establishAnonymous(anonymous);
  const unregister = coordinator.registerParticipant(
    createSnapbackClientStoreAuthParticipant(store),
  );
  const capture1 = await coordinator.transition(capture0, {
    authority: authenticated,
    bearer: 'session-bearer',
    refreshAfterMs: 10_000,
  }, 'login');
  assert.deepEqual(await store.authorityScope(), {
    authorityEpoch: 1,
    authorityKey: key1,
  });
  assert.equal(capture1.authorityKey, key1);
  assert.equal(await store.getRetainedQuery('q', authority0), null);
  await expectCode(
    'SNAPBACK_CLIENT_STORE_AUTHORITY_STALE',
    () => store.confirmMutationAcknowledgements([queued.id], 'auth:anonymous', authority0),
  );
  assert.deepEqual(
    await store.pendingMutationAcknowledgements(10, 'auth:anonymous', capture1),
    [],
  );
  await unregister();
  await coordinator.close();
}

// The store generation is monotonic but never aliases auth authority and never wraps.
{
  const state = await store.snapshot();
  state.generation = Number.MAX_SAFE_INTEGER;
  const exhausted = createMemorySnapbackClientStore({ state });
  await expectCode(
    'SNAPBACK_CLIENT_STORE_AUTHORITY_STALE',
    () => exhausted.scopeToAuth('next', { authorityEpoch: 1, authorityKey: key1 }),
  );
  await expectCode(
    'SNAPBACK_CLIENT_STORE_GENERATION_EXHAUSTED',
    () => exhausted.bindAuthority({ authorityEpoch: 1, authorityKey: key1 }),
  );
  await expectCode('SNAPBACK_CLIENT_STORE_GENERATION_EXHAUSTED', () => exhausted.snapshot());
  assert.equal(state.generation, Number.MAX_SAFE_INTEGER);
}

// MAX_SAFE_INTEGER is the final terminal-deletion identity. A legacy/current
// bound store already at that ceiling exposes no retained or queued payload,
// terminal purge may replace it in place, and the clean marker is idempotent.
{
  const exhaustedState = {};
  const exhausted = createMemorySnapbackClientStore({ state: exhaustedState });
  const authority = { authorityEpoch: 0, authorityKey: keyB };
  await exhausted.bindAuthority({ ...authority, authMode: 'sessions' });
  const queue = await exhausted.captureMutationQueue(authority);
  await exhausted.putRetainedQuery('generation-ceiling-private', {
    ...authority,
    rows: [{ secret: 'generation-ceiling-retained' }],
  });
  await exhausted.enqueueMutation({
    id: 'cm_generation_ceiling_private',
    function: 'writeGenerationCeilingPrivate',
    ...authority,
    ...queue,
  });
  exhaustedState.generation = Number.MAX_SAFE_INTEGER;

  assert.equal(
    await exhausted.getRetainedQuery('generation-ceiling-private', authority),
    null,
  );
  assert.deepEqual(await exhausted.pendingMutations({ ...authority, ...queue }), []);
  await expectCode('SNAPBACK_CLIENT_STORE_GENERATION_EXHAUSTED', () => exhausted.snapshot());

  assert.deepEqual(await exhausted.purgeAuthority({ authorityKey: keyB }), {
    purged: true,
    fenced: true,
  });
  const terminal = await exhausted.snapshot();
  assert.equal(terminal.generation, Number.MAX_SAFE_INTEGER);
  assert.equal(terminal.terminallyUnbound, true);
  assert.equal(JSON.stringify(terminal).includes('generation-ceiling-retained'), false);
  assert.equal(JSON.stringify(terminal).includes('cm_generation_ceiling_private'), false);
  const exactTerminal = JSON.stringify(terminal);
  assert.deepEqual(await exhausted.purgeAuthority({ authorityKey: keyB }), {
    purged: true,
    fenced: true,
  });
  assert.equal(JSON.stringify(await exhausted.snapshot()), exactTerminal);
}

// If the physical terminal write itself fails, already-exhausted predecessor
// bytes stay inaccessible through every authority-bound read until clear or a
// later purge succeeds.
{
  const source = createMemorySnapbackClientStore();
  const authority = { authorityEpoch: 0, authorityKey: keyB };
  await source.bindAuthority({ ...authority, authMode: 'sessions' });
  const queue = await source.captureMutationQueue(authority);
  await source.putRetainedQuery('failed-terminal-private', {
    ...authority,
    rows: [{ secret: 'failed-terminal-retained' }],
  });
  await source.enqueueMutation({
    id: 'cm_failed_terminal_private',
    function: 'writeFailedTerminalPrivate',
    ...authority,
    ...queue,
  });
  const rawState = await source.snapshot();
  rawState.generation = Number.MAX_SAFE_INTEGER;
  const raw = JSON.stringify(rawState);
  const failedWriteStore = createLocalStorageSnapbackClientStore({
    key: 'generation-ceiling-write-failure',
    storage: {
      getItem() { return raw; },
      setItem() { throw new Error('injected terminal write failure'); },
    },
    lockManager: {
      request(_name, _options, operation) { return operation(); },
    },
  });
  await assert.rejects(
    failedWriteStore.purgeAuthority({ authorityKey: keyB }),
    /injected terminal write failure/,
  );
  assert.equal(
    await failedWriteStore.getRetainedQuery('failed-terminal-private', authority),
    null,
  );
  assert.deepEqual(await failedWriteStore.pendingMutations({ ...authority, ...queue }), []);
  await expectCode(
    'SNAPBACK_CLIENT_STORE_GENERATION_EXHAUSTED',
    () => failedWriteStore.snapshot(),
  );
}

// Ordinary writes stop one value early. A terminal participant can consume
// the reserved value, clear all data, and settle the marker without wrapping.
{
  const finalState = {};
  const finalStore = createMemorySnapbackClientStore({ state: finalState });
  const authority = { authorityEpoch: 0, authorityKey: keyB };
  await finalStore.bindAuthority({ ...authority, authMode: 'sessions' });
  const queue = await finalStore.captureMutationQueue(authority);
  await finalStore.putRetainedQuery('reserved-terminal-private', {
    ...authority,
    rows: [{ secret: 'reserved-terminal-retained' }],
  });
  await finalStore.enqueueMutation({
    id: 'cm_reserved_terminal_private',
    function: 'writeReservedTerminalPrivate',
    ...authority,
    ...queue,
  });
  finalState.generation = Number.MAX_SAFE_INTEGER - 1;
  await expectCode(
    'SNAPBACK_CLIENT_STORE_GENERATION_EXHAUSTED',
    () => finalStore.scopeToAuth('must-not-consume-reserved', authority),
  );
  finalState.queueAuthorization.queueGeneration = Number.MAX_SAFE_INTEGER;
  const participant = createSnapbackClientStoreAuthParticipant(finalStore);
  const context = {
    previousAuthority: {
      kind: 'servicePrincipal',
      authMode: 'sessions',
      actorUserId: USER,
      credentialId: SESSION,
      credentialGeneration: 0,
      grantId: SESSION_B,
    },
    nextAuthority: null,
    expectedEpoch: null,
    nextEpoch: 0,
    nextAuthorityKey: keyB,
    disposition: 'delete',
  };
  await participant.commitTerminalDurable(context);
  const terminal = await finalStore.snapshot();
  assert.equal(terminal.generation, Number.MAX_SAFE_INTEGER);
  assert.equal(terminal.terminallyUnbound, true);
  assert.equal(JSON.stringify(terminal).includes('reserved-terminal-retained'), false);
  assert.equal(JSON.stringify(terminal).includes('cm_reserved_terminal_private'), false);
}

// A suspended context can miss multiple transitions while another owner has
// already advanced the shared physical store to the exact durable successor.
// Reloading that exact current tuple is idempotent even though a real store
// transition remains constrained to one epoch at a time.
{
  const custodyState = { custody: {} };
  const storeState = {};
  const writerStore = createMemorySnapbackClientStore({ state: storeState });
  await writerStore.bindAuthority({
    authorityEpoch: 0,
    authorityKey: key0,
    authMode: 'sessions',
  });
  const writer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: custodyState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const capture0 = await writer.establishAnonymous(anonymous);
  const unregisterWriterStore = writer.registerParticipant(
    createSnapbackClientStoreAuthParticipant(writerStore),
  );
  const capture1 = await writer.transition(capture0, {
    authority: authenticated,
    bearer: 'session-a',
    refreshAfterMs: 10_000,
  }, 'login-a');

  const stale = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: custodyState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  assert.equal((await stale.restoreOffline()).authorityEpoch, 1);
  const staleStore = createMemorySnapbackClientStore({ state: storeState });
  await assert.rejects(
    staleStore.transitionAuthority({
      expectedEpoch: 1,
      nextEpoch: 3,
      nextAuthorityKey: keyB,
    }),
    /must advance authority epoch exactly once/,
  );
  assert.deepEqual(await staleStore.authorityScope(), {
    authorityEpoch: 1,
    authorityKey: key1,
  });
  const unregisterStaleStore = stale.registerParticipant(
    createSnapbackClientStoreAuthParticipant(staleStore),
  );
  const phases = [];
  const unregisterPhases = stale.registerParticipant({
    async quiesce() { phases.push('quiesce'); },
    blank() { phases.push('blank'); },
    clearMemory() { phases.push('clearMemory'); },
    async commitDurable() { phases.push('commitDurable'); },
    async resume() { phases.push('resume'); },
  });

  const capture2 = await writer.transition(capture1, {
    authority: anonymous,
    bearer: null,
    refreshAfterMs: null,
  }, 'logout');
  const capture3 = await writer.transition(capture2, {
    authority: authenticatedB,
    bearer: 'session-b',
    refreshAfterMs: 20_000,
  }, 'login-b');
  const restored = await stale.restoreOffline();
  assert.equal(restored.authorityEpoch, 3);
  assert.equal(restored.authorityKey, keyB);
  assert.deepEqual(await staleStore.authorityScope(), {
    authorityEpoch: 3,
    authorityKey: keyB,
  });
  assert.deepEqual(phases, ['quiesce', 'blank', 'clearMemory', 'commitDurable']);

  await unregisterPhases();
  await unregisterStaleStore();
  await unregisterWriterStore();
  await stale.close();
  await writer.close();
}

console.log('client-store authority conformance: ok');
