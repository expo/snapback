import assert from 'node:assert/strict';

const AUTHORIZATION = Object.freeze({
  incarnation: '018f0d90-7b30-7a22-8c33-445566778899',
  epoch: 1,
});
const SCOPE = Object.freeze({
  kind: 'clientQuery',
  namespace: Object.freeze({
    clientStoreId: 'outbox-fence-shared-contract',
    queryKey: 'sharedFenceContract:{}',
    queryInstanceId: 1,
  }),
});
const OBLIGATION = Object.freeze({
  protocolVersion: 1,
  scopeId: SCOPE,
  revision: 1,
  maxDisposition: 'quarantine',
  witness: Object.freeze({ authorization: AUTHORIZATION, data: null }),
  retryEpisodeId: null,
});
const RESOLUTION = Object.freeze({
  protocolVersion: 1,
  kind: 'snapshot',
  scopeId: SCOPE,
  revision: 1,
  witness: OBLIGATION.witness,
  maxDisposition: 'quarantine',
  ackToken: 'outbox-fence-shared-contract-proof',
});
const PRINCIPAL_SCOPE = Object.freeze({
  authMode: 'sessions',
  authorizationStreamIncarnation: 'outbox-fence-shared-contract-stream',
  userId: 'outbox-fence-shared-contract-user',
});
const QUARANTINE_REFUSAL = Object.freeze({
  code: 'SNAPBACK_MIGRATION_UPGRADE_REQUIRED',
});
const RESULT_GONE = Object.freeze({
  outcome: 'committed',
  receiptDigest: `sha256:${'d'.repeat(64)}`,
});

const expectStale = async (operation, message) => assert.rejects(
  operation,
  (error) => error?.code === 'SNAPBACK_OUTBOX_AUTHORIZATION_STALE',
  message,
);

// @ref LLP 0053#client-fences — every delayed queue transition must carry
// the exact authorization generation it captured before awaiting work.
export async function exerciseOutboxAuthorizationFenceCompareAndCommit(store, { label }) {
  const quarantinedId = 'shared-fence-quarantined';
  const resultGoneTransitionId = 'shared-fence-result-gone-transition';
  const resultGoneDiscardId = 'shared-fence-result-gone-discard';
  const discardId = 'shared-fence-discard';
  const strandedId = 'shared-fence-stranded';
  const acknowledgementId = 'shared-fence-ack';

  const capturedFence = await store.outboxAuthorizationStatus();
  await store.outboxEnqueue({ id: quarantinedId, function: 'sharedFenceMutation' }, capturedFence);
  await store.outboxMarkQuarantined(
    quarantinedId,
    QUARANTINE_REFUSAL,
    capturedFence,
  );
  await store.outboxEnqueue(
    { id: resultGoneTransitionId, function: 'sharedFenceMutation' },
    capturedFence,
  );
  await store.outboxEnqueue(
    { id: resultGoneDiscardId, function: 'sharedFenceMutation' },
    capturedFence,
  );
  await store.outboxMarkResultGone(resultGoneDiscardId, RESULT_GONE, capturedFence);
  await store.outboxEnqueue({ id: discardId, function: 'sharedFenceMutation' }, capturedFence);
  await store.outboxEnqueue({ id: strandedId, function: 'sharedFenceMutation' }, capturedFence);
  await store.outboxMarkStranded(
    strandedId,
    'authority_instance_changed',
    PRINCIPAL_SCOPE,
    capturedFence,
  );
  await store.outboxEnqueue({ id: acknowledgementId, function: 'sharedFenceMutation' }, capturedFence);
  await store.outboxDurablyConsume(
    acknowledgementId,
    { result: { ok: true } },
    PRINCIPAL_SCOPE.userId,
    [],
    capturedFence,
  );
  await store.outboxMarkAcknowledgementsReady([acknowledgementId]);

  await store.outboxApplyAuthorizationObligation(
    OBLIGATION,
    capturedFence.authorityGeneration,
  );
  await store.outboxResolveAuthorizationObligation(
    RESOLUTION,
    capturedFence.authorityGeneration,
  );
  const currentFence = await store.outboxAuthorizationStatus();
  assert.equal(currentFence.suspended, false, `${label}: proof releases the queue`);
  assert.notDeepEqual(currentFence, capturedFence, `${label}: proof advances the queue fence`);

  await expectStale(
    () => store.outboxDiscardStranded([strandedId], PRINCIPAL_SCOPE, capturedFence),
    `${label}: stale stranded discard refuses`,
  );
  await expectStale(
    () => store.outboxMarkQuarantined(discardId, QUARANTINE_REFUSAL, capturedFence),
    `${label}: stale quarantine refuses`,
  );
  await expectStale(
    () => store.outboxReenterQuarantined(capturedFence),
    `${label}: stale quarantine re-entry refuses`,
  );
  await expectStale(
    () => store.outboxMarkResultGone(resultGoneTransitionId, RESULT_GONE, capturedFence),
    `${label}: stale result-gone transition refuses`,
  );
  await expectStale(
    () => store.outboxDiscard(resultGoneDiscardId, capturedFence),
    `${label}: stale result-gone discard refuses`,
  );
  await expectStale(
    () => store.outboxConfirmAcknowledgements(
      [acknowledgementId],
      undefined,
      undefined,
      capturedFence,
    ),
    `${label}: stale ACK confirmation refuses`,
  );

  assert.deepEqual(
    (await store.outboxRecords()).map(({ id, status }) => ({ id, status })),
    [
      { id: quarantinedId, status: 'quarantined' },
      { id: resultGoneTransitionId, status: 'pending' },
      { id: resultGoneDiscardId, status: 'result-gone' },
      { id: discardId, status: 'pending' },
      { id: strandedId, status: 'stranded' },
      { id: acknowledgementId, status: 'settled' },
    ],
    `${label}: stale operations leave every custody record intact`,
  );

  assert.equal(
    (await store.outboxMarkResultGone(
      resultGoneTransitionId,
      RESULT_GONE,
      currentFence,
    )).status,
    'result-gone',
  );
  assert.equal(await store.outboxDiscard(resultGoneTransitionId, currentFence), true);
  assert.equal(await store.outboxDiscard(resultGoneDiscardId, currentFence), true);
  assert.equal(await store.outboxDiscard(discardId, currentFence), true);
  assert.deepEqual(
    await store.outboxDiscardStranded([strandedId], PRINCIPAL_SCOPE, currentFence),
    { discarded: 1, clientMutationIds: [strandedId] },
  );
  assert.equal(
    await store.outboxConfirmAcknowledgements(
      [acknowledgementId],
      undefined,
      undefined,
      currentFence,
    ),
    1,
  );
  assert.deepEqual(await store.outboxReenterQuarantined(currentFence), {
    count: 1,
    clientMutationIds: [quarantinedId],
  });
  assert.equal(
    (await store.outboxMarkQuarantined(
      quarantinedId,
      QUARANTINE_REFUSAL,
      currentFence,
    )).count,
    1,
  );
  assert.deepEqual(await store.outboxReenterQuarantined(currentFence), {
    count: 1,
    clientMutationIds: [quarantinedId],
  });
  assert.equal(await store.outboxDiscard(quarantinedId, currentFence), true);
  assert.deepEqual(await store.outboxRecords(), [], `${label}: current witnesses commit`);
}
