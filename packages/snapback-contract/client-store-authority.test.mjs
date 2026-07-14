// Composed format-5 principal/data + authority-instance/queue tests.

import assert from 'node:assert/strict';

import {
  AuthCoordinator,
  canonicalAuthorityKey,
  createMemoryAuthCustodyStorage,
} from './auth-coordinator.mjs';
import {
  createMemorySnapbackClientStore,
  createSnapbackClientStoreAuthParticipant,
  SNAPBACK_CLIENT_STORE_VERSION,
} from './client-store.mjs';

const APP = 'snapback.test/store-authority';
const INCARNATION = '018f0d90-7b21-7a22-8c33-445566778899';
const SESSION = '018f0d90-7b22-7a22-8c33-445566778899';
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
const key0 = canonicalAuthorityKey(APP, anonymous);
const key1 = canonicalAuthorityKey(APP, authenticated);
const principal = {
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
  userId: USER,
};
const descriptor = (authorityInstanceId, sessionGeneration = 1) => ({
  descriptorVersion: 1,
  authorityInstanceId,
  sessionGeneration,
});

const expectCode = async (code, operation) => {
  await assert.rejects(operation, (error) => error?.code === code);
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
    nextSequence: 2,
    retained: { q: { rows: [{ private: true }] } },
    pending: [{ id: 'cm_v3', function: 'write', sequence: 1, status: 'pending' }],
    failed: [],
    acknowledged: [],
    stranded: [],
    legacyV2Stranded: [],
  };
  const migrated = await createMemorySnapbackClientStore({ state: legacy }).snapshot();
  assert.equal(migrated.version, SNAPBACK_CLIENT_STORE_VERSION);
  assert.deepEqual(migrated.retained, {});
  assert.deepEqual(migrated.pending, []);
  assert.equal(migrated.legacyV3Stranded[0].id, 'cm_v3');
  assert.equal(migrated.legacyV3Stranded[0].replayable, false);
}

// The principal axis preserves rows across a new session. The independent
// authority-instance axis strands (and never silently retags) queued writes.
{
  const twoAxis = createMemorySnapbackClientStore();
  await twoAxis.scopeAuthorization({
    principalScope: principal,
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
    principalScope: principal,
    authorityDescriptor: descriptor(AUTHORITY_1, 2),
  });
  assert.equal((await twoAxis.pendingMutations()).length, 1);

  // New session, same user: rows survive; old queue is explicitly stranded.
  await twoAxis.scopeToAuth('legacy-session-c');
  await twoAxis.scopeAuthorization({
    principalScope: principal,
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
  assert.deepEqual(stranded[0].predecessorPrincipalScope, principal);
  await twoAxis.discardStranded();
  assert.deepEqual(await twoAxis.strandedMutations(), []);

  // Different principal owns a different retained-data namespace.
  await twoAxis.scopeAuthorization({
    principalScope: { ...principal, userId: 'another-user' },
    authorityDescriptor: descriptor(AUTHORITY_2),
  });
  assert.equal(await twoAxis.getRetainedQuery('private'), null);
  await assert.rejects(
    twoAxis.scopeAuthorization({
      principalScope: principal,
      authorityDescriptor: descriptor(AUTHORITY_2),
      queryAuthorization: { lease: 'not-item-7' },
    }),
    /queryAuthorization is reserved/,
  );
}

// Item 6 and item 7 independently allocated format 4. Format 5 recognizes
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
  delete legacyItem6.principalScope;
  delete legacyItem6.authorityDescriptor;
  delete legacyItem6.queryAuthorization;
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
    principalScope: principal,
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
  delete legacyItem7.queueAuthorization;
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
    principalScope: principal,
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
    principalScope: principal,
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
    principalScope: { ...principal, userId: USER_2 },
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
    principalScope: principal,
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
    'SNAPBACK_CLIENT_STORE_GENERATION_EXHAUSTED',
    () => exhausted.scopeToAuth('next', { authorityEpoch: 1, authorityKey: key1 }),
  );
  assert.equal((await exhausted.snapshot()).generation, Number.MAX_SAFE_INTEGER);
}

console.log('client-store authority conformance: ok');
