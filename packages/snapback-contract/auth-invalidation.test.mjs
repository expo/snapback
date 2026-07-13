import assert from 'node:assert/strict';

import {
  effectiveDisposition,
  mergeResyncObligation,
  nextInvalidationGeneration,
  nextQueryInstanceId,
  resolutionSatisfies,
  scopeKey,
  SNAPBACK_AUTH_INVALIDATION_PROTOCOL_VERSION,
  validateResyncObligation,
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
} = {}) => ({
  protocolVersion: SNAPBACK_AUTH_INVALIDATION_PROTOCOL_VERSION,
  scopeId: scope,
  revision,
  maxDisposition: disposition,
  witness: observed,
  retryEpisodeId,
});
const expectation = ({
  authorization = { incarnation: INCARNATION, epoch: 4 },
  versionStream = 'stream-A',
  issuer = issuerId,
} = {}) => ({ authorization, versionStream, issuerId: issuer });

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
  });
  assert.equal(resolutionSatisfies(pending, resolution(99)), false);
  assert.equal(resolutionSatisfies(pending, resolution(100)), true);
  assert.equal(resolutionSatisfies(pending, resolution(105, 2)), false);
  assert.equal(resolutionSatisfies(
    { ...pending, maxDisposition: 'delete' },
    resolution(105),
  ), false);
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
