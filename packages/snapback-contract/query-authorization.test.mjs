import assert from 'node:assert/strict';

import {
  createLiveQueryAuthorizationFence,
  createLiveQueryInstanceAllocator,
  createLiveQueryNamespace,
} from './query-authorization.mjs';

const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const NEXT_INCARNATION = '018f0d90-7b12-7a22-8c33-445566778899';
const MAC = 'A'.repeat(43);
const authorization = Object.freeze({ incarnation: INCARNATION, epoch: 4 });
const issuerId = Object.freeze({
  authorizationIncarnation: INCARNATION,
  bootSequence: 7,
  bootNonce: 'ABCDEFGHIJKLMNOPQRSTUV',
});
const nextIssuerId = Object.freeze({
  authorizationIncarnation: INCARNATION,
  bootSequence: 8,
  bootNonce: 'ABCDEFGHIJKLMNOPQRSTUW',
});
const namespace = Object.freeze({
  clientStoreId: 'store_live',
  queryKey: 'todos:{}',
  queryInstanceId: 1,
});

const witness = ({
  auth = authorization,
  versionStream = 'stream-A',
  minCommitVersion = 10,
} = {}) => ({
  authorization: auth,
  data: { versionStream, minCommitVersion },
});

const snapshot = ({
  version = 10,
  rows = [{ id: 1 }],
  auth = authorization,
  versionStream = 'stream-A',
} = {}) => ({
  rows,
  version,
  witness: witness({ auth, versionStream, minCommitVersion: version }),
});

const scope = ({
  sequence = 1,
  subscriptionId = `sub_${sequence}`,
  issuer = issuerId,
  queryNamespace = namespace,
} = {}) => ({
  kind: 'subscription',
  issuerId: issuer,
  namespace: queryNamespace,
  scopeSequence: sequence,
  connectionGeneration: 2,
  subscriptionId,
});

const obligation = ({
  scoped = scope(),
  revision = 1,
  disposition = 'quarantine',
  observed = witness(),
  ownerContinuityId = `owner_${scoped.subscriptionId}`,
} = {}) => ({
  protocolVersion: 1,
  scopeId: scoped,
  revision,
  maxDisposition: disposition,
  witness: observed,
  retryEpisodeId: null,
  ownerContinuityId,
});

const resolution = (pending, {
  kind = 'snapshot',
  observed = pending.witness,
  ackToken = `ack_${pending.scopeId.subscriptionId}_${pending.revision}`,
  ownerContinuityId = pending.ownerContinuityId,
} = {}) => ({
  protocolVersion: 1,
  kind,
  scopeId: pending.scopeId,
  revision: pending.revision,
  witness: observed,
  maxDisposition: pending.maxDisposition,
  ackToken,
  ownerContinuityId,
});

const createFence = (overrides = {}) => createLiveQueryAuthorizationFence({
  namespace,
  authorityGeneration: 3,
  authorityInstanceId: 'authority-A',
  issuerId,
  authorization,
  versionStream: 'stream-A',
  initialSnapshot: snapshot(),
  ...overrides,
});

// Query instances are scalar, monotone, and never reused. Incoming frames do
// not allocate an identity, and exhaustion refuses instead of wrapping.
{
  const allocator = createLiveQueryInstanceAllocator({ highWater: 19 });
  assert.equal(allocator.allocate(), 20);
  assert.equal(allocator.allocate(), 21);
  assert.equal(allocator.highWater(), 21);
  assert.deepEqual(createLiveQueryNamespace({
    clientStoreId: 'store_live',
    queryKey: 'todos:{}',
    queryInstanceId: 22,
  }), { clientStoreId: 'store_live', queryKey: 'todos:{}', queryInstanceId: 22 });
  const exhausted = createLiveQueryInstanceAllocator({
    highWater: Number.MAX_SAFE_INTEGER,
  });
  assert.throws(
    () => exhausted.allocate(),
    { code: 'SNAPBACK_AUTH_QUERY_INSTANCE_EXHAUSTED' },
  );
}

// Two independent roots coexist. Resolving A cannot reveal rows while B is
// pending; the final B snapshot becomes visible before its ACK token is handed
// to the transport. Old callbacks fail their captured generation.
{
  const fence = createFence();
  const initialCapture = fence.capture();
  const first = obligation({ scoped: scope({ sequence: 1 }) });
  const second = obligation({ scoped: scope({ sequence: 2 }) });
  const boundary = [];
  const firstAccepted = fence.receiveObligation(first, {
    commit: (event) => boundary.push(event),
  });
  assert.equal(firstAccepted.disposition, 'quarantine');
  assert.equal(boundary.at(-1).kind, 'quarantine');
  const secondAccepted = fence.receiveObligation(second, {
    commit: (event) => boundary.push(event),
  });
  assert.equal(fence.isRenderable(), false);
  assert.throws(
    () => fence.applyLiveSnapshot({
      fence: initialCapture,
      snapshot: snapshot({ version: 11 }),
      commit: () => assert.fail('stale callback published'),
    }),
    { code: 'SNAPBACK_AUTH_QUERY_FENCE_STALE' },
  );

  const appliedA = fence.applyResolution({
    fence: secondAccepted.fence,
    resolution: resolution(first),
    snapshot: snapshot({ version: 12 }),
    commit: (event) => boundary.push(event),
  });
  assert.equal(appliedA.disposition, 'quarantine');
  assert.equal(boundary.at(-1).kind, 'quarantine');
  assert.equal(fence.isRenderable(), false);
  assert.equal(fence.acknowledge(appliedA.ackToken).status, 'acknowledged');

  const appliedB = fence.applyResolution({
    fence: fence.capture(),
    resolution: resolution(second, {
      observed: witness({ minCommitVersion: 13 }),
    }),
    snapshot: snapshot({ version: 13, rows: [{ id: 2 }] }),
    commit: (event) => boundary.push(event),
  });
  assert.equal(appliedB.disposition, 'retain');
  assert.equal(boundary.at(-1).kind, 'snapshot');
  assert.deepEqual(boundary.at(-1).rows, [{ id: 2 }]);
  assert.equal(fence.isRenderable(appliedB.fence), true);
  assert.equal(fence.acknowledge(appliedB.ackToken).status, 'acknowledged');
  assert.equal(fence.acknowledge(appliedB.ackToken).status, 'duplicate');
}

// Boundary callbacks are transactional and synchronous. A failed/async commit
// cannot leave a hidden generation installed without its owning boundary.
{
  const fence = createFence();
  const before = fence.capture();
  assert.throws(
    () => fence.receiveObligation(obligation(), {
      commit: () => Promise.resolve(),
    }),
    /must be synchronous/,
  );
  assert.deepEqual(fence.capture(), before);
  assert.equal(fence.isRenderable(), true);
}

// Revision reuse and owner rebinding are corruption. A same-revision re-fire
// after an applied resolution returns the same ACK token for idempotent resend.
{
  const fence = createFence();
  const pending = obligation({ revision: 4 });
  const accepted = fence.receiveObligation(pending, { commit() {} });
  assert.throws(
    () => fence.receiveObligation(obligation({
      revision: 5,
      ownerContinuityId: 'different-owner',
    }), { commit() {} }),
    { code: 'SNAPBACK_AUTH_INVALIDATION_CORRUPT' },
  );
  const applied = fence.applyResolution({
    fence: accepted.fence,
    resolution: resolution(pending),
    snapshot: snapshot({ version: 12 }),
    commit() {},
  });
  const refired = fence.receiveObligation(pending, { commit: () => assert.fail() });
  assert.equal(refired.status, 'applied');
  assert.equal(refired.ackToken, applied.ackToken);
}

// An authenticated scope prefix is cleanup, not release proof. It first leaves
// quarantine intact; repeating the same proof with a covering fresh snapshot
// closes the extinct scope and makes delayed frames harmless.
{
  const fence = createFence();
  const pending = obligation({ scoped: scope({ sequence: 3 }) });
  fence.receiveObligation(pending, { commit() {} });
  const retirement = {
    issuerId,
    namespace,
    retireThroughScopeSequence: 3,
    authorizationExpectation: authorization,
    mac: MAC,
  };
  const waiting = fence.retireScopes({ retirement });
  assert.equal(waiting.status, 'pending-fresh-snapshot');
  assert.equal(fence.snapshot().retiredScopeFrontier, null);
  assert.equal(fence.isRenderable(), false);
  assert.equal(fence.receiveObligation(pending).status, 'retired');
  const events = [];
  const retired = fence.retireScopes({
    retirement,
    freshSnapshot: snapshot({ version: 20, rows: [{ id: 20 }] }),
    commit: (event) => events.push(event),
  });
  assert.equal(retired.status, 'retired');
  assert.equal(fence.isRenderable(retired.fence), true);
  assert.equal(events.at(-1).kind, 'snapshot');
  assert.equal(fence.snapshot().retiredScopeFrontier.scopeSequence, 3);
  assert.equal(fence.receiveObligation(obligation({
    scoped: scope({ sequence: 2, subscriptionId: 'delayed_sub_2' }),
  })).status, 'retired');
  assert.equal(fence.retireScopes({ retirement }).status, 'duplicate');
}

// A failing retirement boundary leaves neither its generation nor cleanup
// frontier installed.
{
  const fence = createFence();
  const pending = obligation({ scoped: scope({ sequence: 3 }) });
  fence.receiveObligation(pending, { commit() {} });
  const before = fence.snapshot();
  assert.throws(
    () => fence.retireScopes({
      retirement: {
        issuerId,
        namespace,
        retireThroughScopeSequence: 3,
        authorizationExpectation: authorization,
        mac: MAC,
      },
      freshSnapshot: snapshot({ version: 20 }),
      commit: () => { throw new Error('boundary failed'); },
    }),
    /boundary failed/,
  );
  assert.deepEqual(fence.snapshot(), before);
}

// A newer authenticated boot may replace the expectation, but old roots stay
// fail-closed until authenticated boot retirement and a fresh current snapshot
// jointly close their continuity. A frame cannot install this transition.
{
  const fence = createFence();
  const old = obligation({ scoped: scope({ sequence: 4 }) });
  fence.receiveObligation(old, { commit() {} });
  const nextAuthorization = { incarnation: INCARNATION, epoch: 5 };
  const events = [];
  const replacement = fence.replaceAuthenticatedExpectation({
    issuerId: nextIssuerId,
    authorization: nextAuthorization,
    versionStream: 'stream-A',
    snapshot: snapshot({
      version: 30,
      rows: [{ id: 30 }],
      auth: nextAuthorization,
    }),
    commit: (event) => events.push(event),
  });
  assert.equal(replacement.disposition, 'quarantine');
  assert.equal(fence.isRenderable(), false);
  assert.equal(
    fence.receiveObligation(obligation({
      scoped: scope({ sequence: 5, issuer: issuerId }),
      observed: witness({ auth: nextAuthorization, minCommitVersion: 30 }),
    })).status,
    'stale-expectation',
  );
  const retired = fence.retireIssuer({
    retirement: {
      currentIssuer: { issuerId: nextIssuerId, keyId: 'key_1', mac: MAC },
      retireThroughBootSequence: 7,
      authorizationExpectation: nextAuthorization,
      mac: MAC,
    },
    freshSnapshot: snapshot({
      version: 31,
      rows: [{ id: 31 }],
      auth: nextAuthorization,
    }),
    commit: (event) => events.push(event),
  });
  assert.equal(retired.status, 'retired');
  assert.equal(events.at(-1).kind, 'snapshot');
  assert.equal(fence.isRenderable(retired.fence), true);
}

// With no old root to discharge, an authenticated same-stream epoch change
// plus its fresh snapshot does not strand the live query.
{
  const fence = createFence();
  const nextAuthorization = { incarnation: INCARNATION, epoch: 5 };
  const events = [];
  const replacement = fence.replaceAuthenticatedExpectation({
    issuerId: nextIssuerId,
    authorization: nextAuthorization,
    versionStream: 'stream-A',
    snapshot: snapshot({
      version: 30,
      rows: [{ id: 'fresh' }],
      auth: nextAuthorization,
    }),
    commit: (event) => events.push(event),
  });
  assert.equal(replacement.disposition, 'retain');
  assert.equal(events.at(-1).kind, 'snapshot');
  assert.equal(fence.isRenderable(replacement.fence), true);
}

// Terminal retirement destroys the boundary first, rejects old callbacks, and
// finalizes only after exact owner continuity ends or an already-issued
// terminal-delete proof is applied and acknowledged.
{
  const fence = createFence();
  const pending = obligation({
    scoped: scope({ sequence: 6 }),
    disposition: 'delete',
  });
  const accepted = fence.receiveObligation(pending, { commit() {} });
  const retirement = fence.beginRetirement({
    fence: accepted.fence,
    commit: (event) => assert.equal(event.kind, 'delete'),
  });
  assert.deepEqual(retirement.pendingOwnerContinuities, ['owner_sub_6']);
  assert.throws(
    () => fence.finishRetirement(),
    { code: 'SNAPBACK_AUTH_QUERY_RETIREMENT_PENDING' },
  );
  const terminal = fence.applyResolution({
    fence: retirement.fence,
    resolution: resolution(pending, { kind: 'terminalDelete' }),
    commit: () => assert.fail('retirement must not publish a second boundary'),
  });
  assert.equal(fence.acknowledge(terminal.ackToken).status, 'acknowledged');
  assert.equal(fence.finishRetirement(), true);
  assert.equal(fence.isRenderable(), false);
  assert.throws(
    () => fence.applyLiveSnapshot({
      fence: retirement.fence,
      snapshot: snapshot({ version: 99 }),
      commit: () => assert.fail(),
    }),
    { code: 'SNAPBACK_AUTH_QUERY_FENCE_STALE' },
  );
}

// Incarnation replacement validates its own fresh snapshot; an arrival cannot
// smuggle a different authorization pair into the active state.
{
  const fence = createFence();
  const nextIssuer = {
    authorizationIncarnation: NEXT_INCARNATION,
    bootSequence: 1,
    bootNonce: 'ABCDEFGHIJKLMNOPQRSTUX',
  };
  const nextAuthorization = { incarnation: NEXT_INCARNATION, epoch: 0 };
  assert.throws(
    () => fence.replaceAuthenticatedExpectation({
      issuerId: nextIssuer,
      authorization: nextAuthorization,
      versionStream: 'stream-B',
      snapshot: snapshot(),
    }),
    { code: 'SNAPBACK_AUTH_INVALIDATION_SNAPSHOT_STALE' },
  );
  const events = [];
  const replaced = fence.replaceAuthenticatedExpectation({
    issuerId: nextIssuer,
    authorization: nextAuthorization,
    versionStream: 'stream-B',
    snapshot: snapshot({
      auth: nextAuthorization,
      versionStream: 'stream-B',
      rows: [{ id: 'new-incarnation-must-not-render-in-old-instance' }],
    }),
    commit: (event) => events.push(event),
  });
  assert.equal(replaced.disposition, 'delete');
  assert.equal(events.at(-1).kind, 'delete');
  assert.equal(fence.isRenderable(), false);
}

console.log('live query authorization fence conformance: ok');
