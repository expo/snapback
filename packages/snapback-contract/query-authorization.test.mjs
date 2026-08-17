import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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

// A current exact scope may advance monotonically within its authenticated
// incarnation. Membership churn advances the global authorization epoch in
// the causing commit; rejecting that obligation as a stale subscribe
// expectation would retain rows that the terminal resolution must delete.
// Lower epochs and other incarnations remain stale.
{
  const fence = createFence();
  const nextAuthorization = { incarnation: INCARNATION, epoch: 5 };
  const advanced = obligation({
    disposition: 'delete',
    observed: witness({ auth: nextAuthorization, minCommitVersion: 11 }),
  });
  const events = [];
  const accepted = fence.receiveObligation(advanced, {
    commit: (event) => events.push(event),
  });
  assert.equal(accepted.status, 'accepted');
  assert.equal(events.at(-1).kind, 'delete');
  assert.deepEqual(fence.snapshot().expectedAuthorization, nextAuthorization);

  const delayed = obligation({
    revision: 2,
    observed: witness({ auth: authorization, minCommitVersion: 12 }),
  });
  assert.equal(fence.receiveObligation(delayed).status, 'stale-expectation');

  const otherIncarnation = obligation({
    revision: 3,
    observed: witness({
      auth: { incarnation: NEXT_INCARNATION, epoch: 1 },
      minCommitVersion: 13,
    }),
  });
  assert.equal(
    fence.receiveObligation(otherIncarnation).status,
    'stale-expectation',
  );

  const applied = fence.applyResolution({
    fence: accepted.fence,
    resolution: resolution(advanced, { kind: 'terminalDelete' }),
    commit: (event) => events.push(event),
  });
  assert.equal(applied.disposition, 'delete');
  assert.equal(fence.snapshot().terminalDeleted, true);

  const unaffectedFence = createFence();
  const unaffectedEvents = [];
  const resnapshot = obligation({
    observed: witness({ auth: nextAuthorization, minCommitVersion: 14 }),
  });
  const resnapshotAccepted = unaffectedFence.receiveObligation(resnapshot, {
    commit: (event) => unaffectedEvents.push(event),
  });
  assert.equal(resnapshotAccepted.status, 'accepted');
  const refreshed = unaffectedFence.applyResolution({
    fence: resnapshotAccepted.fence,
    resolution: resolution(resnapshot),
    snapshot: snapshot({
      version: 14,
      rows: [{ id: 'still-authorized' }],
      auth: nextAuthorization,
    }),
    commit: (event) => unaffectedEvents.push(event),
  });
  assert.equal(refreshed.disposition, 'retain');
  assert.equal(unaffectedFence.isRenderable(refreshed.fence), true);
  assert.deepEqual(unaffectedEvents.at(-1).rows, [{ id: 'still-authorized' }]);
}

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
  const rejected = fence.rejectAcknowledgement(applied.ackToken, {
    commit: (event) => assert.equal(event.kind, 'quarantine'),
  });
  assert.equal(rejected.status, 'rejected');
  assert.deepEqual(rejected.obligation, pending);
  assert.equal(fence.isRenderable(), false);
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
  const freshSnapshot = snapshot({ version: 20, rows: [{ id: 20 }] });
  const beforePreview = fence.snapshot();
  const preview = fence.previewRetireScopes({ retirement, freshSnapshot });
  assert.equal(preview.status, 'retired');
  assert.deepEqual(
    fence.snapshot(),
    beforePreview,
    'retirement preview cannot publish or advance the local fence',
  );
  assert.equal(fence.isRenderable(), false);
  const retired = fence.retireScopes({
    retirement,
    freshSnapshot,
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

// Format-v2 auth/live adversarial fixtures execute against the same JS fence
// used by the first-party client. This is semantic conformance, not merely a
// corpus-shape assertion.
{
  const corpus = JSON.parse(readFileSync(
    new URL('../../schemas/live.wire-fixtures.v1.json', import.meta.url),
    'utf8',
  ));
  // formatVersion 3: bd94ea18 completed the LLP 0095 P-1 negative inventory
  // (corpus 21 -> 37 fixtures) without updating this conformance pin.
  assert.equal(corpus.formatVersion, 3);
  const fixture = (name) => {
    const found = corpus.fixtures.find((entry) => entry.name === name);
    assert(found, `missing conformance fixture ${name}`);
    return found;
  };
  const fenceForFixture = (entry) => {
    const held = entry.given.subscriptions[0];
    const expectation = entry.given.authorizationExpectation;
    return createLiveQueryAuthorizationFence({
      namespace: held.authorizationNamespace,
      authorityGeneration: 1,
      issuerId: expectation.issuerId,
      authorizationScope: held.authorizationScope,
      connectionGeneration: expectation.connectionGeneration,
      authorization: expectation.authorization,
      versionStream: expectation.versionStream,
      initialSnapshot: {
        rows: held.rows,
        version: held.version,
      },
    });
  };

  const mismatched = fixture(
    'auth.live.invalidation_owned_id_mismatched_scope_never_acknowledged',
  );
  assert.throws(
    () => fenceForFixture(mismatched).receiveObligation(
      mismatched.frame.obligation,
      { commit: () => assert.fail('foreign scope quarantined owned rows') },
    ),
    { code: 'SNAPBACK_AUTH_INVALIDATION_SCOPE_INVALID' },
  );
  const validSnapshot = fixture('auth.live.invalidation_snapshot_apply_then_ack');
  const validSnapshotFrame = validSnapshot.steps[0].frame;
  for (const mutateScope of [
    (foreign) => { foreign.connectionGeneration += 1; },
    (foreign) => {
      foreign.subscriptionId = 'sub_foreign_same_namespace';
      foreign.scopeSequence += 1;
    },
  ]) {
    const foreignObligation = structuredClone(validSnapshotFrame.obligation);
    mutateScope(foreignObligation.scopeId);
    assert.throws(
      () => fenceForFixture(validSnapshot).receiveObligation(
        foreignObligation,
        { commit: () => assert.fail('foreign exact scope quarantined owned rows') },
      ),
      { code: 'SNAPBACK_AUTH_INVALIDATION_SCOPE_INVALID' },
    );
  }

  const invalid = fixture('auth.live.invalidation_invalid_resolution_never_acknowledged');
  const invalidFence = fenceForFixture(invalid);
  const belowFloor = invalid.steps[0].frame;
  const belowFloorAccepted = invalidFence.receiveObligation(
    belowFloor.obligation,
    { commit() {} },
  );
  assert.throws(
    () => invalidFence.applyResolution({
      fence: belowFloorAccepted.fence,
      resolution: belowFloor.resolution,
      snapshot: belowFloor.snapshot,
      commit: () => assert.fail('below-floor snapshot applied'),
    }),
    { code: 'SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE' },
  );
  const terminalWithSnapshot = invalid.steps[1].frame;
  const terminalAccepted = invalidFence.receiveObligation(
    terminalWithSnapshot.obligation,
    { commit() {} },
  );
  assert.throws(
    () => invalidFence.applyResolution({
      fence: terminalAccepted.fence,
      resolution: terminalWithSnapshot.resolution,
      snapshot: terminalWithSnapshot.snapshot,
      commit: () => assert.fail('terminal delete with rows applied'),
    }),
    { code: 'SNAPBACK_AUTH_INVALIDATION_CORRUPT' },
  );

  const terminal = fixture(
    'auth.live.invalidation_terminal_delete_blocks_ordinary_live_reuse',
  );
  const terminalFence = fenceForFixture(terminal);
  const terminalFrame = terminal.steps[0].frame;
  const terminalObligation = terminalFence.receiveObligation(
    terminalFrame.obligation,
    { commit() {} },
  );
  const terminalApplied = terminalFence.applyResolution({
    fence: terminalObligation.fence,
    resolution: terminalFrame.resolution,
    snapshot: null,
    commit() {},
  });
  assert.equal(terminalFence.acknowledge(terminalApplied.ackToken).status, 'acknowledged');
  const ordinary = terminal.steps[1].frame;
  assert.throws(
    () => terminalFence.applyLiveSnapshot({
      fence: terminalFence.capture(),
      snapshot: { rows: ordinary.rows, version: ordinary.version },
      commit: () => assert.fail('ordinary live frame resurrected terminal rows'),
    }),
    { code: 'SNAPBACK_AUTH_QUERY_QUARANTINED' },
  );
  const expectation = terminal.given.authorizationExpectation;
  assert.throws(
    () => terminalFence.replaceAuthenticatedExpectation({
      issuerId: expectation.issuerId,
      authorizationScope: terminal.given.subscriptions[0].authorizationScope,
      connectionGeneration: expectation.connectionGeneration,
      authorization: expectation.authorization,
      versionStream: expectation.versionStream,
      snapshot: { rows: ordinary.rows, version: ordinary.version },
      commit: () => assert.fail('ordinary fresh subscribe resurrected terminal rows'),
    }),
    { code: 'SNAPBACK_AUTH_QUERY_FENCE_STALE' },
  );
}

test('C1 same-envelope satisfying snapshot commits once and ACKs unchanged', () => {
  const fence = createFence();
  const pending = obligation();
  const events = [];
  const accepted = fence.receiveObligation(pending, {
    deferCommit: true,
    commit: (event) => events.push(event),
  });
  assert.equal(accepted.status, 'accepted');
  assert.deepEqual(events, []);

  const applied = fence.applyResolution({
    fence: accepted.fence,
    resolution: resolution(pending),
    snapshot: snapshot({ version: 11, rows: [{ id: 'refreshed' }] }),
    commit: (event) => events.push(event),
  });
  assert.deepEqual(events.map((event) => event.kind), ['snapshot']);
  assert.deepEqual(events[0].rows, [{ id: 'refreshed' }]);
  assert.equal(fence.acknowledge(applied.ackToken).status, 'acknowledged');
  assert.equal(fence.acknowledge(applied.ackToken).status, 'duplicate');
});

test('C2 obligation without a resolution still quarantines immediately', () => {
  const fence = createFence();
  const events = [];
  const accepted = fence.receiveObligation(obligation(), {
    commit: (event) => events.push(event),
  });
  assert.equal(accepted.status, 'accepted');
  assert.deepEqual(events.map((event) => event.kind), ['quarantine']);
  assert.equal(fence.isRenderable(), false);
});

test('C3 stale same-envelope resolution repairs the deferred boundary fail closed', () => {
  const fence = createFence();
  const pending = obligation({ revision: 2 });
  const events = [];
  const accepted = fence.receiveObligation(pending, {
    deferCommit: true,
    commit: (event) => events.push(event),
  });
  const staleResolution = { ...resolution(pending), revision: 1 };
  assert.throws(
    () => fence.applyResolution({
      fence: accepted.fence,
      resolution: staleResolution,
      snapshot: snapshot({ version: 11 }),
      commit: (event) => events.push(event),
    }),
    { code: 'SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE' },
  );
  assert.deepEqual(events, []);

  fence.commitCurrentDisposition({
    fence: fence.capture(),
    commit: (event) => events.push(event),
  });
  assert.deepEqual(events.map((event) => event.kind), ['quarantine']);
  assert.equal(fence.isRenderable(), false);
});

// The fence API permits deferCommit for any resolution kind; the CLIENT never
// defers terminal proofs (revocation must blank at obligation receipt —
// blankBeforeMutationReturn, pinned end-to-end by
// tests/acceptance/require-role-live-revocation.mjs). This case pins only the
// fence-level semantics of a deferred terminal application.
test('C4 same-envelope terminalDelete commits delete without intermediate quarantine', () => {
  const fence = createFence();
  const pending = obligation({ disposition: 'delete' });
  const events = [];
  const accepted = fence.receiveObligation(pending, {
    deferCommit: true,
    commit: (event) => events.push(event),
  });
  const applied = fence.applyResolution({
    fence: accepted.fence,
    resolution: resolution(pending, { kind: 'terminalDelete' }),
    commit: (event) => events.push(event),
  });
  assert.deepEqual(events.map((event) => event.kind), ['delete']);
  assert.equal(applied.disposition, 'delete');
  assert.equal(fence.isRenderable(), false);
});

test('deferred disposition repair rejects an older fence generation', () => {
  const fence = createFence();
  const first = fence.receiveObligation(obligation(), { deferCommit: true });
  fence.receiveObligation(obligation({
    scoped: scope({ sequence: 2 }),
  }), { deferCommit: true });
  assert.throws(
    () => fence.commitCurrentDisposition({
      fence: first.fence,
      commit: () => assert.fail('stale deferred fence committed'),
    }),
    { code: 'SNAPBACK_AUTH_QUERY_FENCE_STALE' },
  );
});

console.log('live query authorization fence conformance: ok');
