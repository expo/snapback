import assert from 'node:assert/strict';

import {
  effectiveDisposition,
  mergeResyncObligation,
  nextInvalidationGeneration,
  nextQueryInstanceId,
  resolutionSatisfies,
  scopeKey,
  SNAPBACK_AUTH_INVALIDATION_PROTOCOL_VERSION,
  validateAuthorizationInvalidationConnection,
  validateIssuerRetirement,
  validateResyncObligation,
  validateScopeRetirement,
} from './auth-invalidation.mjs';

const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const OTHER_INCARNATION = '018f0d90-7b12-7a22-8c33-445566778899';
const issuerId = Object.freeze({
  authorizationIncarnation: INCARNATION,
  bootSequence: 7,
  bootNonce: 'ABCDEFGHIJKLMNOPQRSTUV',
});
const namespace = Object.freeze({
  clientStoreId: 'store-A',
  queryKey: 'todos:{"status":"open"}',
  queryInstanceId: 19,
});
const scopeId = Object.freeze({
  kind: 'subscription',
  issuerId,
  namespace,
  scopeSequence: 3,
  connectionGeneration: 5,
  subscriptionId: 'sub_A',
});
const witness = (epoch = 4, minCommitVersion = 100) => ({
  authorization: { incarnation: INCARNATION, epoch },
  data: { versionStream: 'stream-A', minCommitVersion },
});
const obligation = ({
  scope = scopeId,
  revision = 1,
  disposition = 'quarantine',
  observed = witness(),
  retryEpisodeId = null,
  ownerContinuityId = scope.kind === 'subscription' ? 'owner_A' : undefined,
} = {}) => ({
  protocolVersion: SNAPBACK_AUTH_INVALIDATION_PROTOCOL_VERSION,
  scopeId: scope,
  revision,
  maxDisposition: disposition,
  witness: observed,
  retryEpisodeId,
  ...(ownerContinuityId === undefined ? {} : { ownerContinuityId }),
});
const expectation = ({
  authorization = { incarnation: INCARNATION, epoch: 4 },
  versionStream = 'stream-A',
  issuer = issuerId,
} = {}) => ({ authorization, versionStream, issuerId: issuer });
const authenticatedIssuer = Object.freeze({
  issuerId,
  keyId: 'invalidation-key-1',
  mac: 'A'.repeat(43),
});

// Exact closed shapes reject extension fields before they can become an
// accidental compatibility channel.
{
  assert.throws(
    () => validateResyncObligation({ ...obligation(), bearer: 'secret' }),
    { code: 'SNAPBACK_AUTH_INVALIDATION_CORRUPT' },
  );
  assert.throws(
    () => validateResyncObligation(obligation({
      scope: { ...scopeId, namespace: { ...namespace, queryInstanceId: 0 } },
    })),
    { code: 'SNAPBACK_AUTH_INVALIDATION_CORRUPT' },
  );
  assert.throws(
    () => validateResyncObligation({ ...obligation(), maxDisposition: 'hide-ish' }),
    { code: 'SNAPBACK_AUTH_INVALIDATION_CORRUPT' },
  );
  const missingOwner = obligation();
  delete missingOwner.ownerContinuityId;
  assert.throws(
    () => validateResyncObligation(missingOwner),
    { code: 'SNAPBACK_AUTH_INVALIDATION_CORRUPT' },
  );
}

// Authenticated cleanup frontiers are closed, monotone facts bound to the
// exact issuer incarnation and query instance. Validation never treats them
// as a snapshot/release proof.
{
  const scopeRetirement = {
    issuerId,
    namespace,
    retireThroughScopeSequence: 3,
    authorizationExpectation: { incarnation: INCARNATION, epoch: 4 },
    mac: 'A'.repeat(43),
  };
  assert.deepEqual(validateScopeRetirement(scopeRetirement), scopeRetirement);
  const issuerRetirement = {
    currentIssuer: authenticatedIssuer,
    retireThroughBootSequence: 6,
    authorizationExpectation: { incarnation: INCARNATION, epoch: 4 },
    mac: 'A'.repeat(43),
  };
  assert.deepEqual(validateIssuerRetirement(issuerRetirement), issuerRetirement);
  assert.deepEqual(validateAuthorizationInvalidationConnection({
    protocolVersion: 1,
    issuerId,
    connectionGeneration: 5,
    issuerRetirement,
  }), {
    protocolVersion: 1,
    issuerId,
    connectionGeneration: 5,
    issuerRetirement,
  });
  assert.throws(
    () => validateScopeRetirement({
      ...scopeRetirement,
      authorizationExpectation: { incarnation: OTHER_INCARNATION, epoch: 0 },
    }),
    { code: 'SNAPBACK_AUTH_INVALIDATION_CORRUPT' },
  );
  assert.throws(
    () => validateIssuerRetirement({
      ...issuerRetirement,
      retireThroughBootSequence: issuerId.bootSequence,
    }),
    { code: 'SNAPBACK_AUTH_INVALIDATION_CORRUPT' },
  );
  assert.throws(
    () => validateAuthorizationInvalidationConnection({
      protocolVersion: 1,
      issuerId,
      connectionGeneration: 5,
      issuerRetirement,
      bearer: 'planted',
    }),
    { code: 'SNAPBACK_AUTH_INVALIDATION_CORRUPT' },
  );
}

// Revision comparison is per complete scope. A stronger newer revision merges
// monotonically and preserves a data floor that an auth-only record omits.
{
  const first = mergeResyncObligation(null, obligation(), expectation());
  assert.equal(first.status, 'accepted');
  const authOnly = obligation({
    revision: 2,
    disposition: 'delete',
    observed: {
      authorization: { incarnation: INCARNATION, epoch: 4 },
      data: null,
    },
  });
  const merged = mergeResyncObligation(first.obligation, authOnly, expectation());
  assert.equal(merged.status, 'accepted');
  assert.equal(merged.obligation.maxDisposition, 'delete');
  assert.deepEqual(merged.obligation.witness.data, {
    versionStream: 'stream-A',
    minCommitVersion: 100,
  });
  assert.equal(
    mergeResyncObligation(merged.obligation, obligation({ revision: 1 }), expectation()).status,
    'duplicate',
  );
  assert.throws(
    () => mergeResyncObligation(
      merged.obligation,
      obligation({ revision: 2, disposition: 'retain' }),
      expectation(),
    ),
    { code: 'SNAPBACK_AUTH_INVALIDATION_CORRUPT' },
  );
  assert.throws(
    () => mergeResyncObligation(
      merged.obligation,
      obligation({ revision: 3, ownerContinuityId: 'owner_B' }),
      expectation(),
    ),
    { code: 'SNAPBACK_AUTH_INVALIDATION_CORRUPT' },
  );
}

// Pair/stream/issuer changes are admitted only by an authenticated bootstrap
// expectation, never by arrival order.
{
  assert.equal(
    mergeResyncObligation(
      null,
      obligation({
        observed: {
          authorization: { incarnation: OTHER_INCARNATION, epoch: 0 },
          data: { versionStream: 'stream-B', minCommitVersion: 1 },
        },
      }),
      expectation(),
    ).status,
    'stale-expectation',
  );
  assert.equal(
    mergeResyncObligation(
      null,
      obligation({ scope: { ...scopeId, issuerId: { ...issuerId, bootSequence: 8 } } }),
      expectation(),
    ).status,
    'stale-expectation',
  );
}

// Different scopes coexist even when their numeric revisions suggest the
// opposite ordering; aggregate disposition is the maximum of extant entries.
{
  const clientQuery = {
    kind: 'clientQuery',
    namespace,
  };
  const live = obligation({ revision: 5, disposition: 'quarantine' });
  const durable = obligation({
    scope: clientQuery,
    revision: 1,
    disposition: 'delete',
  });
  assert.notEqual(scopeKey(live.scopeId), scopeKey(durable.scopeId));
  assert.equal(effectiveDisposition({
    [scopeKey(live.scopeId)]: live,
    [scopeKey(durable.scopeId)]: durable,
  }), 'delete');
}

// Resolution is exact-revision and must cover both witness axes. A version-99
// snapshot cannot discharge a removal committed at 100.
{
  const pending = obligation({ revision: 3, disposition: 'quarantine' });
  const resolution = (minCommitVersion, revision = 3) => ({
    protocolVersion: SNAPBACK_AUTH_INVALIDATION_PROTOCOL_VERSION,
    kind: 'snapshot',
    scopeId,
    revision,
    witness: witness(4, minCommitVersion),
    maxDisposition: 'quarantine',
    ackToken: 'ack_snapshot_3',
    ownerContinuityId: 'owner_A',
  });
  assert.equal(resolutionSatisfies(pending, resolution(99)), false);
  assert.equal(resolutionSatisfies(pending, resolution(100)), true);
  assert.equal(resolutionSatisfies(pending, resolution(105, 2)), false);
  assert.equal(resolutionSatisfies(
    { ...pending, maxDisposition: 'delete' },
    resolution(105),
  ), false);
  assert.equal(resolutionSatisfies(
    pending,
    { ...resolution(105), ownerContinuityId: 'owner_B' },
  ), false);
  const missingOwner = resolution(105);
  delete missingOwner.ownerContinuityId;
  assert.throws(
    () => resolutionSatisfies(pending, missingOwner),
    { code: 'SNAPBACK_AUTH_INVALIDATION_CORRUPT' },
  );
}

// Never-reused allocators refuse the JS precision boundary instead of wrap.
assert.equal(nextQueryInstanceId(41), 42);
assert.equal(nextInvalidationGeneration(8), 9);
assert.throws(
  () => nextQueryInstanceId(Number.MAX_SAFE_INTEGER),
  { code: 'SNAPBACK_AUTH_QUERY_INSTANCE_EXHAUSTED' },
);
assert.throws(
  () => nextInvalidationGeneration(Number.MAX_SAFE_INTEGER),
  { code: 'SNAPBACK_AUTH_INVALIDATION_GENERATION_EXHAUSTED' },
);

console.log('auth invalidation protocol conformance: ok');
