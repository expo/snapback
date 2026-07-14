// LLP 0053 item-6 independent mutation-queue authorization fence.

import assert from 'node:assert/strict';

import {
  canonicalAuthorityKey,
} from './auth-coordinator.mjs';
import {
  createMemorySnapbackClientStore,
  SNAPBACK_CLIENT_STORE_VERSION,
} from './client-store.mjs';

const APP = 'snapback.test/queue-authorization';
const INCARNATION = '018f0d90-7b21-7a22-8c33-445566778899';
const authority = {
  authorityEpoch: 0,
  authorityKey: canonicalAuthorityKey(APP, {
    kind: 'anonymous',
    authMode: 'sessions',
    authorizationStreamIncarnation: INCARNATION,
  }),
};

const scope = (queryInstanceId) => ({
  kind: 'clientQuery',
  namespace: {
    clientStoreId: 'store_queue_test',
    queryKey: `todos:${queryInstanceId}`,
    queryInstanceId,
  },
});

const witness = (epoch = 1, minCommitVersion = 10) => ({
  authorization: { incarnation: INCARNATION, epoch },
  data: { versionStream: 'stream_queue_test', minCommitVersion },
});

const obligation = (queryInstanceId, maxDisposition = 'quarantine') => ({
  protocolVersion: 1,
  scopeId: scope(queryInstanceId),
  revision: 1,
  maxDisposition,
  witness: witness(),
  retryEpisodeId: null,
});

const resolution = (queryInstanceId, maxDisposition = 'quarantine', kind = 'snapshot') => ({
  protocolVersion: 1,
  kind,
  scopeId: scope(queryInstanceId),
  revision: 1,
  witness: witness(),
  maxDisposition,
  ackToken: `ack_queue_${queryInstanceId}`,
});

const expectCode = async (code, operation) => {
  await assert.rejects(operation, (error) => error?.code === code);
};

const store = createMemorySnapbackClientStore();
await store.bindAuthority({ ...authority, authMode: 'sessions' });
const initial = await store.captureMutationQueue(authority);
assert.deepEqual(initial, {
  authorityGeneration: 0,
  queueGeneration: 1,
  suspended: false,
  pendingScopeCount: 0,
  effectiveDisposition: 'retain',
});

const queuedA = await store.enqueueMutation({
  id: 'cm_queue_a',
  function: 'writeA',
  args: { secret: 'must-redact' },
  ...authority,
  ...initial,
});
await store.enqueueMutation({
  id: 'cm_queue_b',
  function: 'writeB',
  ctxLedger: { version: 1, ids: ['ledger_b'], now: 1 },
  ...authority,
  ...initial,
});

// One quarantine advances only the queue generation. Duplicate delivery is
// level-triggered and does not spuriously invalidate a second capture.
const first = await store.applyMutationQueueObligation(
  obligation(1),
  { ...authority, ...initial },
);
assert.equal(first.status, 'accepted');
assert.equal(first.queueGeneration, 2);
assert.equal(first.pendingScopeCount, 1);
const duplicate = await store.applyMutationQueueObligation(
  obligation(1),
  { ...authority, ...first },
);
assert.equal(duplicate.status, 'duplicate');
assert.equal(duplicate.queueGeneration, first.queueGeneration);

await expectCode(
  'SNAPBACK_CLIENT_QUEUE_GENERATION_STALE',
  () => store.settleMutation(queuedA.id, {
    status: 'confirmed',
    ...authority,
    ...initial,
  }),
);
await expectCode(
  'SNAPBACK_CLIENT_QUEUE_SUSPENDED',
  () => store.pendingMutations({ ...authority, ...first }),
);
await expectCode(
  'SNAPBACK_CLIENT_QUEUE_SUSPENDED',
  () => store.enqueueMutation({ function: 'blocked', ...authority, ...first }),
);

// Independent query roots compose. Releasing A cannot resume while B remains,
// and every transition invalidates an operation captured before it.
const second = await store.applyMutationQueueObligation(
  obligation(2),
  { ...authority, ...first },
);
assert.equal(second.pendingScopeCount, 2);
const releasedFirst = await store.resolveMutationQueueObligation(
  resolution(1),
  { ...authority, ...second },
);
assert.equal(releasedFirst.suspended, true);
assert.equal(releasedFirst.pendingScopeCount, 1);
await expectCode(
  'SNAPBACK_CLIENT_QUEUE_GENERATION_STALE',
  () => store.resolveMutationQueueObligation(
    resolution(2),
    { ...authority, ...second },
  ),
);
await expectCode(
  'SNAPBACK_CLIENT_QUEUE_SUSPENDED',
  () => store.pendingMutations({ ...authority, ...releasedFirst }),
);
const releasedSecond = await store.resolveMutationQueueObligation(
  resolution(2),
  { ...authority, ...releasedFirst },
);
assert.equal(releasedSecond.suspended, false);
assert.equal(releasedSecond.pendingScopeCount, 0);
assert.deepEqual(
  (await store.pendingMutations({ ...authority, ...releasedSecond })).map(({ id }) => id),
  ['cm_queue_a', 'cm_queue_b'],
);

// A delete root advances the independent fence and atomically turns the whole
// unproven queue into redacted discard-only custody. It never retains args,
// result payloads, or deterministic replay ledgers.
const deleted = await store.applyMutationQueueObligation(
  obligation(3, 'delete'),
  { ...authority, ...releasedSecond },
);
assert.equal(deleted.effectiveDisposition, 'delete');
const stranded = await store.strandedMutations(authority);
assert.deepEqual(stranded.map(({ id }) => id), ['cm_queue_a', 'cm_queue_b']);
for (const record of stranded) {
  assert.equal(record.discardOnly, true);
  assert.equal(record.replayable, false);
  assert.equal(Object.hasOwn(record, 'args'), false);
  assert.equal(Object.hasOwn(record, 'ctxLedger'), false);
  assert.equal(Object.hasOwn(record, 'output'), false);
}
await expectCode(
  'SNAPBACK_CLIENT_QUEUE_GENERATION_STALE',
  () => store.discardStranded({ ...authority, ...releasedSecond }),
);
const terminal = await store.resolveMutationQueueObligation(
  resolution(3, 'delete', 'terminalDelete'),
  { ...authority, ...deleted },
);
await store.discardStranded({ ...authority, ...terminal });
assert.deepEqual(await store.strandedMutations(authority), []);

// An authenticated retirement + covering snapshot is validated by the query
// coordinator. Its exact-scope cleanup removes the corresponding queue root
// without forging a resolution ticket or ACK.
const retirementRoot = await store.applyMutationQueueObligation(
  obligation(4),
  { ...authority, ...terminal },
);
const retired = await store.retireMutationQueueScopes(
  [scope(4)],
  { ...authority, ...retirementRoot },
);
assert.equal(retired.retired, 1);
assert.equal(retired.suspended, false);
assert.equal(retired.pendingScopeCount, 0);
await expectCode(
  'SNAPBACK_CLIENT_QUEUE_GENERATION_STALE',
  () => store.retireMutationQueueScopes(
    [scope(4)],
    { ...authority, ...retirementRoot },
  ),
);

// Format 3 migrates by preserving already authority-tagged queue bytes while
// installing a generation-zero queue fence. A truncated current format fails
// closed instead of silently manufacturing a new fence.
{
  const legacy = {
    version: 3,
    origin: 'legacy-queue-origin',
    generation: 4,
    authorityEpoch: 0,
    authorityKey: authority.authorityKey,
    authFingerprint: null,
    artifactScope: null,
    nextSequence: 2,
    retained: {},
    pending: [{
      id: 'cm_legacy_queue',
      function: 'legacyWrite',
      sequence: 1,
      status: 'pending',
      ...authority,
    }],
    failed: [],
    acknowledged: [],
    stranded: [],
    legacyV2Stranded: [],
  };
  const migrated = createMemorySnapbackClientStore({ state: legacy });
  const capture = await migrated.captureMutationQueue(authority);
  assert.equal((await migrated.snapshot()).version, SNAPBACK_CLIENT_STORE_VERSION);
  assert.deepEqual(capture, {
    authorityGeneration: 0,
    queueGeneration: 0,
    suspended: false,
    pendingScopeCount: 0,
    effectiveDisposition: 'retain',
  });
  assert.equal((await migrated.pendingMutations({ ...authority, ...capture })).length, 1);
}

{
  const truncated = await store.snapshot();
  delete truncated.queueAuthorization;
  assert.throws(
    () => createMemorySnapbackClientStore({ state: truncated }),
    (error) => error?.code === 'SNAPBACK_CLIENT_STORE_CORRUPT',
  );
}

console.log('client-store queue authorization conformance: ok');
