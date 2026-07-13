// LLP 0056 format-3 authority epoch/key tests.

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

const expectCode = async (code, operation) => {
  await assert.rejects(operation, (error) => error?.code === code);
};

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
});
await expectCode(
  'SNAPBACK_CLIENT_STORE_AUTHORITY_STALE',
  () => store.settleMutation(queued.id, { status: 'confirmed' }),
);
assert.equal((await store.pendingMutations(authority0)).length, 1);
await store.settleMutation(queued.id, { status: 'confirmed', output: 1, ...authority0 });
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

