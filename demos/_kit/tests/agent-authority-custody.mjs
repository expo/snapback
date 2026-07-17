// Durable headless-agent custody: restart, ABA, ambiguous commit, missed
// wakeup, terminal-disposition, and fail-closed barrier proof.

import assert from 'node:assert/strict';

import {
  AgentAuthorityFence,
  createMemoryAgentAuthorityCustodyStorage,
} from '../agent-authority.mjs';
import {
  canonicalAgentAuthorityKey,
  deriveServiceAuthorityInstanceId,
} from '../../../packages/snapback-contract/auth-coordinator.mjs';

const ACTOR = '018f0d90-7b26-7a22-8c33-445566778899';
const CREDENTIAL = '018f0d90-7b27-7a22-8c33-445566778899';
const GRANT_A = '018f0d90-7b28-7a22-8c33-445566778899';
const GRANT_B = '018f0d90-7b2b-7a22-8c33-445566778899';
const TOKEN_A = '018f0d90-7b29-7a22-8c33-445566778899';
const TOKEN_B = '018f0d90-7b2a-7a22-8c33-445566778899';
const TOKEN_C = '018f0d90-7b2c-7a22-8c33-445566778899';

const credential = ({
  grantId = GRANT_A,
  tokenId = TOKEN_A,
  credentialGeneration = 3,
  bearerToken = `bearer:${grantId}:${tokenId}`,
} = {}) => ({
  actorUserId: ACTOR,
  credentialId: CREDENTIAL,
  credentialGeneration,
  grantId,
  tokenId,
  bearerToken,
});

const code = (expected) => (error) => error?.code === expected;

const descriptorFor = (value) => ({
  descriptorVersion: 1,
  authorityInstanceId: deriveServiceAuthorityInstanceId(value),
  sessionGeneration: 0,
});

const synchronizeValidated = (fence, value = credential()) => (
  fence.synchronizeValidated(descriptorFor(value))
);

const replaceValidated = (fence, value) => (
  fence.replaceCredentialValidated(fence.capture(), value, descriptorFor(value))
);

const transitionIdForTest = (custodyId, transition) => `agent-transition-v1:${JSON.stringify({
  custodyId,
  expectedRevision: transition.expectedRevision,
  expectedEpoch: transition.expectedEpoch,
  expectedAuthorityKey: transition.expectedAuthorityKey,
  previousStatus: transition.previousStatus,
  nextEpoch: transition.nextEpoch,
  nextAuthorityKey: transition.nextAuthorityKey,
  nextStatus: transition.nextStatus,
  reason: transition.reason,
  disposition: transition.disposition,
})}`;

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

// Online-only custody remains explicitly available and preserves the durable
// epoch across token churn, while exposing that it has no restart guarantee.
{
  const fence = new AgentAuthorityFence(credential());
  assert.equal(fence.hasDurableCustody, false);
  const first = fence.capture();
  const rotated = await replaceValidated(fence, credential({ tokenId: TOKEN_B }));
  assert.equal(rotated.authorityEpoch, first.authorityEpoch);
  assert.equal(rotated.carrierGeneration, first.carrierGeneration + 1);
  assert(fence.isCurrent(rotated));
}

// Durable side-ledger atomicity is an explicit adapter capability. Legacy or
// globally non-reentrant mutex adapters fail at construction instead of
// hanging after the first gate/partition composition. Internal namespaces
// cannot collide with caller-selected custody ids.
{
  assert.throws(
    () => new AgentAuthorityFence(credential(), {
      storage: { async withOwnership() {} },
      custodyId: 'agent:legacy-global-mutex',
    }),
    code('SNAPBACK_AUTH_CUSTODY_PARTITION_OWNERSHIP_REQUIRED'),
  );
  const storage = createMemoryAgentAuthorityCustodyStorage();
  for (const custodyId of [
    'snapback.agent-custody-gate.v1:caller',
    'snapback.agent-terminal-witness.v1:caller',
    'x'.repeat(513),
  ]) {
    assert.throws(
      () => new AgentAuthorityFence(credential(), { storage, custodyId }),
      /reserved internal namespace|too long/,
    );
  }
  await storage.withOwnership('agent:memory-direct-reentry', async () => {
    await assert.rejects(
      storage.withOwnership('agent:memory-direct-reentry', () => assert.fail('reentered')),
      code('SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE'),
    );
  });
}

// The ownership callback is a structured-concurrency boundary. An unawaited
// nested partition operation remains owned by the outer scope: late starts
// are closed, and a successor cannot enter the outer partition until that
// exact child settles.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const nestedEntered = deferred();
  const releaseNested = deferred();
  let capturedOwner = null;
  let nestedOperation = null;
  let successorEntered = false;
  const outer = storage.withOwnership('agent:memory-joined-owner', (owner) => {
    capturedOwner = owner;
    nestedOperation = owner.withPartition('agent:memory-joined-child', async () => {
      nestedEntered.resolve();
      await releaseNested.promise;
    });
    return 'outer-result';
  });
  await nestedEntered.promise;
  await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(
    capturedOwner.read(),
    (error) => (
      error?.code === 'SNAPBACK_AUTH_CUSTODY_LOCK_LOST'
      && /released/u.test(error.message)
    ),
    'returning from the callback closes the owner to new starts before joining children',
  );
  const refusedUnhandled = [];
  const onRefusedUnhandled = (error) => { refusedUnhandled.push(error); };
  process.on('unhandledRejection', onRefusedUnhandled);
  void capturedOwner.read();
  await new Promise((resolve) => setImmediate(resolve));
  process.off('unhandledRejection', onRefusedUnhandled);
  assert.deepEqual(
    refusedUnhandled,
    [],
    'an unawaited late owner refusal is observed at the custody boundary',
  );
  let outerSettled = false;
  void outer.then(() => { outerSettled = true; }, () => { outerSettled = true; });
  const successor = storage.withOwnership('agent:memory-joined-owner', () => {
    successorEntered = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(outerSettled, false, 'the unawaited nested owner keeps the outer scope pending');
  assert.equal(successorEntered, false, 'the outer partition gate remains closed while joining');

  releaseNested.resolve();
  await nestedOperation;
  assert.equal(outerSettled, false, 'the observed child settles before the outer ownership releases');
  assert.equal(successorEntered, false, 'child settlement alone does not bypass outer release');
  assert.equal(await outer, 'outer-result');
  await successor;
  assert.equal(successorEntered, true);

  const failedChildEntered = deferred();
  const releaseFailedChild = deferred();
  const unhandled = [];
  const onUnhandled = (error) => { unhandled.push(error); };
  process.on('unhandledRejection', onUnhandled);
  let failedChildOuterSettled = false;
  const joinedFailure = storage.withOwnership('agent:memory-missed-child-error', (owner) => {
    void owner.withPartition('agent:memory-missed-child-error-nested', async () => {
      failedChildEntered.resolve();
      await releaseFailedChild.promise;
      throw new Error('memory missed-await child failed');
    });
    return 'joined-child-rejection';
  });
  void joinedFailure.then(
    () => { failedChildOuterSettled = true; },
    () => { failedChildOuterSettled = true; },
  );
  await failedChildEntered.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failedChildOuterSettled, false, 'a rejected child must first settle before release');
  releaseFailedChild.resolve();
  assert.equal(await joinedFailure, 'joined-child-rejection');
  await new Promise((resolve) => setImmediate(resolve));
  process.off('unhandledRejection', onUnhandled);
  assert.deepEqual(unhandled, [], 'missed child rejection is observed by its ownership scope');
  await storage.withOwnership('agent:memory-missed-child-error', async (owner) => {
    assert.equal(await owner.read(), null, 'child rejection still releases for a fresh owner');
  });

  const primaryFailure = new Error('memory ownership callback failed');
  await assert.rejects(
    storage.withOwnership('agent:memory-primary-child-error', (owner) => {
      void owner.withPartition('agent:memory-primary-child-error-nested', async () => {
        throw new Error('secondary memory child failure');
      });
      throw primaryFailure;
    }),
    (error) => error === primaryFailure,
    'the callback error remains primary after rejected children are joined',
  );
}

// The memory reference adapter has the same linear owner contract as the
// filesystem adapter. Two operations cannot observe one predecessor through a
// shared owner, and a missed-await overlap refusal is handled at creation.
{
  const custodyId = 'agent:memory-owner-overlap';
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const fence = new AgentAuthorityFence(credential(), { storage, custodyId });
  await synchronizeValidated(fence);
  const current = storage.snapshot(custodyId);
  const marker = {
    ...current,
    revision: current.revision + 1,
    phase: 'exhausted',
    status: 'deleted',
    transition: null,
  };
  const results = await storage.withOwnership(custodyId, (owner) => Promise.allSettled([
    owner.replace(current.revision, marker),
    owner.replace(current.revision, marker),
  ]));
  assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(
    results.find((result) => result.status === 'rejected').reason.code,
    'SNAPBACK_AUTH_CUSTODY_OPERATION_OVERLAP',
  );
  assert.deepEqual(storage.snapshot(custodyId), marker);

  const entered = deferred();
  const release = deferred();
  const unhandled = [];
  const onUnhandled = (error) => { unhandled.push(error); };
  process.on('unhandledRejection', onUnhandled);
  await storage.withOwnership('agent:memory-unawaited-overlap', async (owner) => {
    const nested = owner.withPartition('agent:memory-unawaited-overlap-child', async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    void owner.read();
    await new Promise((resolve) => setImmediate(resolve));
    release.resolve();
    await nested;
  });
  await new Promise((resolve) => setImmediate(resolve));
  process.off('unhandledRejection', onUnhandled);
  assert.deepEqual(unhandled, [], 'an unawaited memory overlap refusal is observed immediately');
  await storage.withOwnership('agent:memory-unawaited-overlap', async (owner) => {
    assert.equal(await owner.read(), null, 'a fresh owner proceeds after the predecessor joins');
  });
}

// `retire` consumes a memory partition owner just as it consumes a physical
// filesystem owner. No same-callback operation may recreate the retired row;
// only a later ownership interval may use that partition again.
{
  const custodyId = 'agent:memory-retired-owner';
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const fence = new AgentAuthorityFence(credential(), { storage, custodyId });
  await synchronizeValidated(fence);
  const record = storage.snapshot(custodyId);

  await storage.withOwnership(custodyId, async (owner) => {
    assert.equal(await owner.retire(record.revision), true);
    for (const operation of [
      () => owner.read(),
      () => owner.replace(null, record),
      () => owner.remove(record.revision),
      () => owner.retire(null),
      () => owner.scanPartitions({ cursor: null, limit: 1 }),
      () => owner.withPartition(
        'agent:memory-retired-owner-child',
        () => assert.fail('a retired owner entered a nested partition'),
      ),
    ]) {
      await assert.rejects(
        operation,
        (error) => (
          error?.code === 'SNAPBACK_AUTH_CUSTODY_LOCK_LOST'
          && /retired/u.test(error.message)
        ),
      );
    }
  });
  assert.equal(storage.snapshot(custodyId), null);

  await storage.withOwnership(custodyId, async (owner) => {
    assert.equal(await owner.read(), null);
    await owner.replace(null, record);
  });
  assert.deepEqual(storage.snapshot(custodyId), record);

  const emptyCustodyId = 'agent:memory-retired-empty-owner';
  await storage.withOwnership(emptyCustodyId, async (owner) => {
    await assert.rejects(
      owner.retire(1),
      (error) => (
        error?.code === 'SNAPBACK_AUTH_CUSTODY_CAS_STALE'
        && error?.diagnostic?.details?.actualRevision === null
      ),
    );
    assert.equal(await owner.read(), null, 'a memory CAS refusal does not consume the owner');
    assert.equal(await owner.retire(null), false);
    await assert.rejects(
      owner.read,
      (error) => (
        error?.code === 'SNAPBACK_AUTH_CUSTODY_LOCK_LOST'
        && /retired/u.test(error.message)
      ),
    );
  });
  await storage.withOwnership(emptyCustodyId, async (owner) => {
    assert.equal(await owner.read(), null);
  });
}

// Publication callbacks are a non-reentrant custody boundary in both
// online-only and durable modes. A callback may catch the stable refusal, but
// it cannot terminate, rotate, rebind, or change the participant set and then
// receive a successful publication result for the retired predecessor.
for (const durable of [false, true]) {
  const options = durable
    ? { storage: createMemoryAgentAuthorityCustodyStorage(), custodyId: `agent:commit-reentrant:${durable}` }
    : {};
  const fence = new AgentAuthorityFence(credential(), options);
  if (durable) await synchronizeValidated(fence);
  const capture = fence.capture();
  const unregister = fence.registerParticipant({ quiesce() {}, blank() {}, clearMemory() {} });
  const next = credential({ tokenId: TOKEN_B });
  const reentrant = (operation) => assert.throws(
    operation,
    code('SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT'),
  );
  const result = await fence.compareAndCommit(capture, () => {
    reentrant(() => fence.capture());
    reentrant(() => fence.bindHandshake(capture, descriptorFor(credential())));
    reentrant(() => fence.replaceCredentialValidated(capture, next, descriptorFor(next)));
    reentrant(() => fence.terminate(capture));
    reentrant(() => fence.registerParticipant({}));
    reentrant(() => unregister());
    reentrant(() => fence.compareAndCommit(capture, () => assert.fail('nested commit ran')));
    return durable ? 'durable' : 'volatile';
  });
  assert.deepEqual(result, { committed: true, value: durable ? 'durable' : 'volatile' });
  assert(fence.isCurrent(capture), 'reentrant custody attempts leave the published capture current');
  assert.equal(fence.authorityDescriptor, null, 'reentrant binding cannot mutate descriptor state');
  await unregister();
}

// Awaited participant callbacks receive a prompt stable refusal when they try
// to join the barrier that is awaiting them. Both synchronization and removal
// remain retryable after the callback returns; neither can self-deadlock.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const fence = new AgentAuthorityFence(credential(), {
    storage,
    custodyId: 'agent:participant-reentrant',
  });
  let synchronizeFailure = null;
  let removalFailure = null;
  let unregister;
  unregister = fence.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() {
      try {
        await fence.synchronize();
      } catch (error) {
        synchronizeFailure = error;
      }
    },
    async resume() {
      try {
        await unregister();
      } catch (error) {
        removalFailure = error;
      }
    },
  });
  await synchronizeValidated(fence);
  await replaceValidated(fence, credential({ grantId: GRANT_B, tokenId: TOKEN_B }));
  assert.equal(
    synchronizeFailure?.code,
    'SNAPBACK_AUTH_CUSTODY_PARTICIPANT_REENTRANT',
  );
  assert.equal(
    removalFailure?.code,
    'SNAPBACK_AUTH_CUSTODY_PARTICIPANT_REENTRANT',
  );
  await unregister();
}

// The optional exact-key terminal callback has the same non-reentrant awaited
// participant contract as ordinary durable commit and resume callbacks.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const fence = new AgentAuthorityFence(credential(), {
    storage,
    custodyId: 'agent:terminal-participant-reentrant',
  });
  let synchronizeFailure = null;
  let removalFailure = null;
  let unregister;
  unregister = fence.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitTerminalDurable() {
      try {
        await fence.synchronize();
      } catch (error) {
        synchronizeFailure = error;
      }
      try {
        await unregister();
      } catch (error) {
        removalFailure = error;
      }
    },
  });
  await synchronizeValidated(fence);
  const terminal = fence.terminateValidatedCredential(
    fence.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  await terminal.settlement;
  assert.equal(
    synchronizeFailure?.code,
    'SNAPBACK_AUTH_CUSTODY_PARTICIPANT_REENTRANT',
  );
  assert.equal(
    removalFailure?.code,
    'SNAPBACK_AUTH_CUSTODY_PARTICIPANT_REENTRANT',
  );
  await unregister();
}

// Scheduled fresh deletion may snapshot a participant before its async barrier
// starts; awaited unregister still does not resolve ahead of that final call.
{
  const fence = new AgentAuthorityFence(credential(), {
    storage: createMemoryAgentAuthorityCustodyStorage(),
    custodyId: 'agent:fresh-terminal-unregister-lifetime',
  });
  let callbackFinished = false;
  const unregister = fence.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitTerminalDurable() {
      await Promise.resolve();
      callbackFinished = true;
    },
  });
  const terminal = fence.terminateValidatedCredential(
    fence.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  await unregister();
  assert.equal(callbackFinished, true, 'unregister waits for snapshotted terminal callback');
  await terminal.settlement;
}

// Synchronous confidentiality callbacks run before the terminal handle and
// async barrier Promise are installed. Their supported unregister calls defer
// settlement selection until that handle exists, then wait for the mandatory
// durable callback instead of resolving in the intervening microtask.
{
  const fence = new AgentAuthorityFence(credential(), {
    storage: createMemoryAgentAuthorityCustodyStorage(),
    custodyId: 'agent:sync-cut-unregister-lifetime',
  });
  let armed = false;
  let releaseTerminal;
  let terminalCallbackStarted;
  const started = new Promise((resolve) => { terminalCallbackStarted = resolve; });
  const terminalGate = new Promise((resolve) => { releaseTerminal = resolve; });
  let terminalCallbackRan = false;
  let removalsResolved = 0;
  const removalAttempts = [];
  let unregister;
  const attemptRemoval = () => {
    if (!armed) return;
    const attempt = unregister();
    void attempt.then(() => { removalsResolved += 1; });
    removalAttempts.push(attempt);
  };
  unregister = fence.registerParticipant({
    quiesce: attemptRemoval,
    blank: attemptRemoval,
    clearMemory: attemptRemoval,
    async commitTerminalDurable() {
      terminalCallbackStarted();
      await terminalGate;
      terminalCallbackRan = true;
    },
  });
  await synchronizeValidated(fence);
  armed = true;
  const terminal = fence.terminateValidatedCredential(
    fence.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  assert.equal(removalAttempts.length, 3, 'every synchronous cut phase attempted removal');
  await started;
  assert.equal(removalsResolved, 0, 'unregister cannot resolve before durable cleanup');
  releaseTerminal();
  await terminal.settlement;
  await Promise.all(removalAttempts);
  assert.equal(removalsResolved, 3, 'sync-cut unregisters settle after durable cleanup');
  assert.equal(terminalCallbackRan, true, 'reentrant removal cannot skip durable cleanup');
  await unregister();
}

// A configured successor may offer its carrier to /auth/session without
// receiving publication authority. A mismatched settled predecessor is never
// changed until the exact service descriptor has been validated inside the
// fence; a failed or mismatched handshake leaves the record byte-for-byte A.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const custodyId = 'agent:validated-restart';
  const predecessorCredential = credential();
  const predecessor = new AgentAuthorityFence(predecessorCredential, { storage, custodyId });
  await synchronizeValidated(predecessor, predecessorCredential);
  const before = storage.snapshot(custodyId);

  const successorCredential = credential({ grantId: GRANT_B, tokenId: TOKEN_B });
  const predecessorCapture = predecessor.capture();
  assert.throws(
    () => predecessor.replaceCredential(successorCredential),
    code('SNAPBACK_CLIENT_AGENT_CREDENTIAL_VALIDATION_REQUIRED'),
    'live replacement cannot bypass server descriptor proof',
  );
  assert(predecessor.isCurrent(predecessorCapture));
  assert.deepEqual(storage.snapshot(custodyId), before);
  const successor = new AgentAuthorityFence(successorCredential, { storage, custodyId });
  const offer = successor.credentialOfferForHandshake();
  assert.deepEqual(offer, {
    bearer: successorCredential.bearerToken,
    tokenId: successorCredential.tokenId,
  });
  assert(Object.isFrozen(offer));
  assert.equal('authorityEpoch' in offer, false, 'the handshake offer is not a capture');
  assert.throws(() => successor.capture(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));

  await assert.rejects(
    successor.synchronize(),
    code('SNAPBACK_CLIENT_AGENT_CREDENTIAL_VALIDATION_REQUIRED'),
  );
  assert.deepEqual(storage.snapshot(custodyId), before);
  await assert.rejects(
    successor.synchronizeValidated(descriptorFor(predecessorCredential)),
    code('SNAPBACK_CLIENT_AUTHORITY_STALE'),
  );
  assert.deepEqual(storage.snapshot(custodyId), before, 'an invalid descriptor cannot replace A');

  const adopted = await successor.synchronizeValidated(descriptorFor(successorCredential));
  assert.equal(adopted.authorityEpoch, 1);
  assert.equal(storage.snapshot(custodyId).authorityKey, adopted.authorityKey);
}

// A durable fence begins publication-closed, initializes epoch zero under
// ownership, and completes every barrier phase before opening publication.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const fence = new AgentAuthorityFence(credential(), {
    storage,
    custodyId: 'agent:init',
  });
  assert.equal(fence.hasDurableCustody, true);
  assert.throws(() => fence.capture(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
  const order = [];
  fence.registerParticipant({
    quiesce() { order.push('quiesce'); },
    blank() { order.push('blank'); },
    clearMemory() { order.push('clearMemory'); },
    async commitDurable() { order.push('commitDurable'); },
    async resume() { order.push('resume'); },
  });
  assert.deepEqual(
    order,
    ['quiesce', 'blank', 'clearMemory'],
    'registration begins paused, blank, and memory-cleared',
  );
  await assert.rejects(
    fence.synchronize(),
    code('SNAPBACK_CLIENT_AGENT_CREDENTIAL_VALIDATION_REQUIRED'),
    'a fresh durable record cannot be initialized from an unvalidated bearer',
  );
  assert.equal(storage.snapshot('agent:init'), null);
  const capture = await synchronizeValidated(fence);
  assert.deepEqual(order, [
    'quiesce',
    'blank',
    'clearMemory',
    'quiesce',
    'blank',
    'clearMemory',
    'resume',
  ]);
  assert.equal(capture.authorityEpoch, 0);
  assert.equal(storage.snapshot('agent:init').revision, 1);

  const beforeToken = storage.snapshot('agent:init');
  const tokenTransition = replaceValidated(fence, credential({ tokenId: TOKEN_B }));
  assert.throws(() => fence.capture(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
  const tokenCapture = await tokenTransition;
  assert.equal(tokenCapture.authorityEpoch, 0, 'token churn does not advance durable epoch');
  assert.deepEqual(storage.snapshot('agent:init'), beforeToken, 'token churn does not rewrite custody');
}

// Restart restores the exact durable epoch. Tuple A -> B -> A advances twice,
// and the final A must not alias the original A capture.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const owner = new AgentAuthorityFence(credential(), { storage, custodyId: 'agent:aba' });
  const epoch0 = await synchronizeValidated(owner);
  const epoch1 = await replaceValidated(owner, credential({ grantId: GRANT_B, tokenId: TOKEN_B }));
  const epoch2 = await replaceValidated(owner, credential({ grantId: GRANT_A, tokenId: TOKEN_C }));
  assert.deepEqual(
    [epoch0.authorityEpoch, epoch1.authorityEpoch, epoch2.authorityEpoch],
    [0, 1, 2],
  );
  assert.notEqual(epoch0.authorityKey, epoch1.authorityKey);
  assert.equal(epoch0.authorityKey, epoch2.authorityKey);

  const restarted = new AgentAuthorityFence(
    credential({ grantId: GRANT_A, tokenId: TOKEN_A }),
    { storage, custodyId: 'agent:aba' },
  );
  let adoptionCommits = 0;
  restarted.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() { adoptionCommits += 1; },
    async resume() {},
  });
  await assert.rejects(
    restarted.synchronize(),
    code('SNAPBACK_CLIENT_AGENT_CREDENTIAL_VALIDATION_REQUIRED'),
    'same-tuple restart still requires proof for the current bearer',
  );
  const restored = await synchronizeValidated(restarted);
  assert.equal(restored.authorityEpoch, 2, 'restart adopts the exact durable epoch');
  assert.equal(adoptionCommits, 0, 'settled same-tuple restart does not replay a delete');
}

// A storage throw after commit is ambiguous. Exact-target reread recovers it;
// neither blind retry nor predecessor adoption is allowed.
{
  const base = createMemoryAgentAuthorityCustodyStorage();
  let throwAfterCommit = false;
  const ambiguous = {
    partitionOwnership: base.partitionOwnership,
    async withOwnership(custodyId, operation) {
      return base.withOwnership(custodyId, (owner) => operation(Object.freeze({
        ...owner,
        async withPartition(partition, partitionOperation) {
          const beforeRevision = base.snapshot(partition)?.revision ?? null;
          const result = await owner.withPartition(partition, partitionOperation);
          const afterRevision = base.snapshot(partition)?.revision ?? null;
          if (
            partition === 'agent:ambiguous'
            && throwAfterCommit
            && afterRevision !== beforeRevision
          ) {
            throwAfterCommit = false;
            const error = new Error('injected response loss after custody commit');
            error.code = 'TEST_AMBIGUOUS_AFTER_COMMIT';
            throw error;
          }
          return result;
        },
      })));
    },
  };
  const fence = new AgentAuthorityFence(credential(), {
    storage: ambiguous,
    custodyId: 'agent:ambiguous',
  });
  await synchronizeValidated(fence);
  throwAfterCommit = true;
  const staged = replaceValidated(fence, credential({ grantId: GRANT_B, tokenId: TOKEN_B }));
  const settled = await staged;
  assert.equal(settled.authorityEpoch, 1);
  assert.equal(base.snapshot('agent:ambiguous').authorityEpoch, 1);
  assert.equal(base.snapshot('agent:ambiguous').status, 'active');
}

// A peer that misses both A -> B and B -> A still sees the revision/epoch ABA
// and runs its complete local barrier. Publication stays closed through the
// awaited resume and only the final exact durable confirmation reopens it.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const writer = new AgentAuthorityFence(credential(), { storage, custodyId: 'agent:peer' });
  const peer = new AgentAuthorityFence(credential(), { storage, custodyId: 'agent:peer' });
  await synchronizeValidated(writer);
  const peerEpoch0 = await synchronizeValidated(peer);
  await replaceValidated(writer, credential({ grantId: GRANT_B, tokenId: TOKEN_B }));
  await replaceValidated(writer, credential({ grantId: GRANT_A, tokenId: TOKEN_C }));

  const resumeEntered = deferred();
  const releaseResume = deferred();
  const order = [];
  peer.registerParticipant({
    quiesce() { order.push('quiesce'); },
    blank() { order.push('blank'); },
    clearMemory() { order.push('clearMemory'); },
    async commitDurable(context) {
      order.push('commitDurable');
      assert.equal(context.expectedEpoch, 0);
      assert.equal(context.nextEpoch, 2);
    },
    async resume() {
      order.push('resume');
      resumeEntered.resolve();
      await releaseResume.promise;
    },
  });
  const adoption = peer.synchronize();
  await resumeEntered.promise;
  assert.equal(peer.isCurrent(peerEpoch0), false);
  assert.throws(() => peer.capture(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
  releaseResume.resolve();
  const adopted = await adoption;
  assert.equal(adopted.authorityEpoch, 2);
  assert.deepEqual(order, ['quiesce', 'blank', 'clearMemory', 'commitDurable', 'resume']);
}

// compareAndCommit treats local freshness only as a hint: it rereads custody
// under ownership, refuses the callback, and blanks on a missed peer change.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const writer = new AgentAuthorityFence(credential(), { storage, custodyId: 'agent:compare' });
  const stalePeer = new AgentAuthorityFence(credential(), { storage, custodyId: 'agent:compare' });
  await synchronizeValidated(writer);
  const staleCapture = await synchronizeValidated(stalePeer);
  let blanks = 0;
  stalePeer.registerParticipant({
    quiesce() {},
    blank() { blanks += 1; },
    clearMemory() {},
  });
  await replaceValidated(writer, credential({ grantId: GRANT_B, tokenId: TOKEN_B }));
  let publications = 0;
  const result = await stalePeer.compareAndCommit(staleCapture, () => {
    publications += 1;
  });
  assert.deepEqual(result, { committed: false });
  assert.equal(publications, 0);
  assert.equal(blanks, 1);
  assert.throws(() => stalePeer.capture(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
}

// A post-CAS participant failure remains blank and wedged. The durable target
// is authoritative and a fresh process can recover it, but the failed process
// never resumes or publishes through a partly completed barrier.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const failed = new AgentAuthorityFence(credential(), { storage, custodyId: 'agent:wedge' });
  await synchronizeValidated(failed);
  let blanks = 0;
  failed.registerParticipant({
    quiesce() {},
    blank() { blanks += 1; },
    clearMemory() {},
    async commitDurable() { throw new Error('injected durable participant failure'); },
    async resume() { assert.fail('a failed durable phase must not resume'); },
  });
  await assert.rejects(
    replaceValidated(failed, credential({ grantId: GRANT_B, tokenId: TOKEN_B })),
    /injected durable participant failure/,
  );
  assert(blanks >= 2, 'failure reblanks after the initial synchronous cut');
  assert.throws(() => failed.capture(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
  assert.equal(storage.snapshot('agent:wedge').authorityEpoch, 1);
  assert.equal(storage.snapshot('agent:wedge').phase, 'clearing');

  const recovery = new AgentAuthorityFence(
    credential({ grantId: GRANT_B, tokenId: TOKEN_C }),
    { storage, custodyId: 'agent:wedge' },
  );
  let recoveredDurableCommits = 0;
  recovery.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() { recoveredDurableCommits += 1; },
    async resume() {},
  });
  assert.equal(
    (await recovery.synchronizeValidated(descriptorFor(credential({
      grantId: GRANT_B,
      tokenId: TOKEN_C,
    })))).authorityEpoch,
    1,
  );
  assert.equal(recoveredDurableCommits, 1, 'restart replays a throw-before-commit transition');
  assert.equal(storage.snapshot('agent:wedge').phase, 'settled');
}

// If a participant applies idempotently and then loses its response, custody
// remains clearing. Restart receives the exact same transitionId, can observe
// that its durable effect already landed, and settles without applying twice.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const applied = new Set();
  const owner = new AgentAuthorityFence(credential(), {
    storage,
    custodyId: 'agent:participant-ambiguous',
  });
  await synchronizeValidated(owner);
  let loseResponse = true;
  owner.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable(context) {
      applied.add(context.transitionId);
      if (loseResponse) {
        loseResponse = false;
        throw new Error('injected participant response loss after commit');
      }
    },
    async resume() {},
  });
  await assert.rejects(
    replaceValidated(owner, credential({ grantId: GRANT_B, tokenId: TOKEN_B })),
    /participant response loss/,
  );
  const clearing = storage.snapshot('agent:participant-ambiguous');
  assert.equal(clearing.phase, 'clearing');
  assert(applied.has(clearing.transition.transitionId));

  const recovery = new AgentAuthorityFence(
    credential({ grantId: GRANT_B, tokenId: TOKEN_C }),
    { storage, custodyId: 'agent:participant-ambiguous' },
  );
  let reapplications = 0;
  recovery.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable(context) {
      if (!applied.has(context.transitionId)) {
        applied.add(context.transitionId);
        reapplications += 1;
      }
    },
    async resume() {},
  });
  assert.equal(
    (await recovery.synchronizeValidated(descriptorFor(credential({
      grantId: GRANT_B,
      tokenId: TOKEN_C,
    })))).authorityEpoch,
    1,
  );
  assert.equal(reapplications, 0);
  assert.equal(applied.size, 1);
  assert.equal(storage.snapshot('agent:participant-ambiguous').phase, 'settled');
}

// Durable counter exhaustion consumes a reserved revision for a terminal,
// secret-free marker. A fresh process sees the marker and cannot reopen the
// predecessor tuple even when it presents a newly validated carrier.
{
  const state = { custody: Object.create(null) };
  const storage = createMemoryAgentAuthorityCustodyStorage({ state });
  const custodyId = 'agent:epoch-reserved-terminal';
  const seed = new AgentAuthorityFence(credential(), { storage, custodyId });
  await synchronizeValidated(seed);
  state.custody[custodyId] = {
    ...storage.snapshot(custodyId),
    authorityEpoch: Number.MAX_SAFE_INTEGER - 1,
  };
  const exhausted = new AgentAuthorityFence(credential(), { storage, custodyId });
  await synchronizeValidated(exhausted);
  await assert.rejects(
    replaceValidated(exhausted, credential({ grantId: GRANT_B, tokenId: TOKEN_B })),
    code('SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED'),
  );
  assert.throws(() => exhausted.capture(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
  const marker = storage.snapshot(custodyId);
  assert.equal(marker.authorityEpoch, Number.MAX_SAFE_INTEGER - 1);
  assert.equal(marker.phase, 'exhausted');
  assert.equal(marker.status, 'deleted');
  assert.equal(marker.revision, 2);

  const restarted = new AgentAuthorityFence(credential({ tokenId: TOKEN_C }), {
    storage,
    custodyId,
  });
  await assert.rejects(
    synchronizeValidated(restarted, credential({ tokenId: TOKEN_C })),
    code('SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED'),
  );
  assert.deepEqual(storage.snapshot(custodyId), marker);
}

// Every other comparison identity fails closed too. Carrier and barrier
// ceilings are lowered only to make the otherwise unreachable safe-integer
// boundary deterministic; durable revision exhaustion is injected through
// the same persisted record a restarted process would read.
{
  const exhausted = new AgentAuthorityFence(credential(), {
    volatileCounterCeiling: 1,
  });
  await replaceValidated(exhausted, credential({ tokenId: TOKEN_B }));
  const lastCapture = exhausted.capture();
  assert.throws(
    () => replaceValidated(exhausted, credential({ tokenId: TOKEN_C })),
    code('SNAPBACK_CLIENT_AUTH_CARRIER_GENERATION_EXHAUSTED'),
  );
  assert.equal(exhausted.isCurrent(lastCapture), false);
  assert.throws(() => exhausted.capture(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
}

{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const exhausted = new AgentAuthorityFence(credential(), {
    storage,
    custodyId: 'agent:barrier-max',
    volatileCounterCeiling: 1,
  });
  await synchronizeValidated(exhausted);
  let blanks = 0;
  exhausted.registerParticipant({
    quiesce() {},
    blank() { blanks += 1; },
    clearMemory() {},
  });
  const lastCapture = exhausted.capture();
  assert.throws(
    () => replaceValidated(exhausted, credential({ tokenId: TOKEN_B })),
    code('SNAPBACK_CLIENT_AUTH_BARRIER_GENERATION_EXHAUSTED'),
  );
  assert.equal(blanks, 1, 'barrier exhaustion still attempts synchronous blanking');
  assert.equal(exhausted.isCurrent(lastCapture), false);
  assert.throws(() => exhausted.capture(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
}

{
  const state = { custody: Object.create(null) };
  const storage = createMemoryAgentAuthorityCustodyStorage({ state });
  const custodyId = 'agent:revision-reserved-terminal';
  const seed = new AgentAuthorityFence(credential(), {
    storage,
    custodyId,
  });
  await synchronizeValidated(seed);
  state.custody[custodyId] = {
    ...storage.snapshot(custodyId),
    revision: Number.MAX_SAFE_INTEGER - 2,
  };
  const exhausted = new AgentAuthorityFence(credential(), {
    storage,
    custodyId,
  });
  await synchronizeValidated(exhausted);
  const lastCapture = exhausted.capture();
  await assert.rejects(
    replaceValidated(exhausted, credential({ grantId: GRANT_B, tokenId: TOKEN_B })),
    code('SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED'),
  );
  assert.equal(exhausted.isCurrent(lastCapture), false);
  const marker = storage.snapshot(custodyId);
  assert.equal(marker.revision, Number.MAX_SAFE_INTEGER - 1);
  assert.equal(marker.phase, 'exhausted');
  assert.equal(marker.status, 'deleted');
  const restarted = new AgentAuthorityFence(credential({ tokenId: TOKEN_C }), {
    storage,
    custodyId,
  });
  await assert.rejects(
    synchronizeValidated(restarted, credential({ tokenId: TOKEN_C })),
    code('SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED'),
  );
}

// Legacy records that already consumed a maximum counter remain durable
// poison. Epoch exhaustion can still be rewritten to a marker when a revision
// remains; revision exhaustion cannot be rewritten, so every process rejects
// the exact maximum record instead.
for (const field of ['authorityEpoch', 'revision']) {
  const state = { custody: Object.create(null) };
  const storage = createMemoryAgentAuthorityCustodyStorage({ state });
  const custodyId = `agent:legacy-${field}-max`;
  const seed = new AgentAuthorityFence(credential(), { storage, custodyId });
  await synchronizeValidated(seed);
  state.custody[custodyId] = {
    ...storage.snapshot(custodyId),
    [field]: Number.MAX_SAFE_INTEGER,
  };
  const expected = field === 'revision'
    ? 'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED'
    : 'SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED';
  for (const tokenId of [TOKEN_B, TOKEN_C]) {
    const restarted = new AgentAuthorityFence(credential({ tokenId }), { storage, custodyId });
    await assert.rejects(
      synchronizeValidated(restarted, credential({ tokenId })),
      code(expected),
    );
  }
  const persisted = storage.snapshot(custodyId);
  assert.equal(persisted.status, field === 'revision' ? 'active' : 'deleted');
  assert.equal(persisted.phase, field === 'revision' ? 'settled' : 'exhausted');
}

// A maximum counter on an existing deletion tombstone is also normalized to
// the stable exhaustion marker; "already deleted" never bypasses poison
// handling or changes the public diagnosis on the next restart.
{
  const state = { custody: Object.create(null) };
  const storage = createMemoryAgentAuthorityCustodyStorage({ state });
  const custodyId = 'agent:legacy-deleted-epoch-max';
  const seed = new AgentAuthorityFence(credential(), { storage, custodyId });
  await synchronizeValidated(seed);
  const terminal = seed.terminate(seed.capture(), { authorityDisposition: 'durableDelete' });
  await terminal.settlement;
  state.custody[custodyId] = {
    ...storage.snapshot(custodyId),
    authorityEpoch: Number.MAX_SAFE_INTEGER,
  };
  const restarted = new AgentAuthorityFence(credential({ tokenId: TOKEN_B }), {
    storage,
    custodyId,
  });
  await assert.rejects(
    synchronizeValidated(restarted, credential({ tokenId: TOKEN_B })),
    code('SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED'),
  );
  assert.equal(storage.snapshot(custodyId).phase, 'exhausted');
  assert.equal(storage.snapshot(custodyId).status, 'deleted');
}

// A synchronous participant fault cannot veto durable deletion. The terminal
// handle rejects (so finite HTTP callers cannot report false settlement), but
// custody reaches the exact tombstone after every local blank was attempted.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const fence = new AgentAuthorityFence(credential(), {
    storage,
    custodyId: 'agent:terminal-sync-fault',
  });
  await synchronizeValidated(fence);
  const order = [];
  fence.registerParticipant({
    quiesce() { order.push('failing-quiesce'); },
    blank() {
      order.push('failing-blank');
      throw new Error('injected terminal blank failure');
    },
    clearMemory() { order.push('failing-clear'); },
    async commitDurable() { order.push('durable-delete'); },
  });
  fence.registerParticipant({
    quiesce() { order.push('following-quiesce'); },
    blank() { order.push('following-blank'); },
    clearMemory() { order.push('following-clear'); },
  });
  const capture = fence.capture();
  const termination = fence.terminate(capture, { authorityDisposition: 'durableDelete' });
  assert.equal(termination.accepted, true);
  assert.equal(fence.isCurrent(capture), false);
  await assert.rejects(termination.settlement, /injected terminal blank failure/);
  assert(order.includes('following-blank'), 'one broken participant cannot veto later blanks');
  assert(order.includes('durable-delete'), 'the durable delete phase still runs after a local fault');
  assert.equal(storage.snapshot('agent:terminal-sync-fault').phase, 'settled');
  assert.equal(storage.snapshot('agent:terminal-sync-fault').status, 'deleted');
}

// Carrier termination preserves the durable tuple and never invokes durable
// deletion. durableDelete advances to a tombstone, deletes through participants,
// and prevents restart of that exact tuple.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const carrier = new AgentAuthorityFence(credential(), { storage, custodyId: 'agent:terminal' });
  await synchronizeValidated(carrier);
  let carrierCommits = 0;
  carrier.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() { carrierCommits += 1; },
  });
  const carrierTermination = carrier.terminate(carrier.capture(), 'carrier');
  assert.equal(carrierTermination.accepted, true);
  assert.equal(carrierTermination.authorityDisposition, 'carrier');
  await carrierTermination.settlement;
  await assert.rejects(carrier.synchronize(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
  assert.equal(carrierCommits, 0);
  assert.equal(storage.snapshot('agent:terminal').authorityEpoch, 0);
  assert.equal(storage.snapshot('agent:terminal').status, 'active');

  const successorToken = new AgentAuthorityFence(
    credential({ tokenId: TOKEN_B }),
    { storage, custodyId: 'agent:terminal' },
  );
  assert.equal((await synchronizeValidated(
    successorToken,
    credential({ tokenId: TOKEN_B }),
  )).authorityEpoch, 0);
  let deleteContext = null;
  const deleteEntered = deferred();
  const releaseDelete = deferred();
  successorToken.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable(context) {
      deleteContext = context;
      deleteEntered.resolve();
      await releaseDelete.promise;
    },
  });
  const terminalCapture = successorToken.capture();
  const deletion = successorToken.terminate(
    terminalCapture,
    { authorityDisposition: 'durableDelete' },
  );
  assert.equal(deletion.accepted, true);
  assert.equal(deletion.authorityDisposition, 'durableDelete');
  assert.equal(successorToken.isCurrent(terminalCapture), false, 'the carrier cut is synchronous');
  let deletionSettled = false;
  void deletion.settlement.then(() => { deletionSettled = true; });
  await deleteEntered.promise;
  assert.equal(deletionSettled, false, 'settlement waits for participant deletion');
  assert.equal(storage.snapshot('agent:terminal').phase, 'clearing');
  assert.equal(storage.snapshot('agent:terminal').status, 'deleted');
  releaseDelete.resolve();
  await deletion.settlement;
  assert.equal(deletionSettled, true);
  assert.equal(storage.snapshot('agent:terminal').phase, 'settled');
  assert.equal(storage.snapshot('agent:terminal').status, 'deleted');
  await assert.rejects(successorToken.synchronize(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
  assert.equal(deleteContext.authorityDisposition, 'durableDelete');
  assert.equal(deleteContext.disposition, 'delete');
  assert.equal(deleteContext.nextAuthority, null);
  assert.equal(storage.snapshot('agent:terminal').authorityEpoch, 1);
  assert.equal(storage.snapshot('agent:terminal').status, 'deleted');
  assert.equal(successorToken.terminate(terminalCapture, 'carrier'), false);

  const forbiddenRestart = new AgentAuthorityFence(
    credential({ tokenId: TOKEN_C }),
    { storage, custodyId: 'agent:terminal' },
  );
  await assert.rejects(
    synchronizeValidated(forbiddenRestart, credential({ tokenId: TOKEN_C })),
    code('SNAPBACK_CLIENT_AUTHORITY_STALE'),
  );
  assert.throws(() => forbiddenRestart.capture(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));

  const differentGrant = new AgentAuthorityFence(
    credential({ grantId: GRANT_B, tokenId: TOKEN_C }),
    { storage, custodyId: 'agent:terminal' },
  );
  assert.equal(
    (await differentGrant.synchronizeValidated(descriptorFor(credential({
      grantId: GRANT_B,
      tokenId: TOKEN_C,
    })))).authorityEpoch,
    2,
  );
  assert.equal(storage.snapshot('agent:terminal').status, 'active');
}

// A close-only carrier cut can race a later finite revocation for the same
// request capture. The stronger classification escalates the existing handle,
// tombstones custody, and does not replay the already-completed local cut.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const fence = new AgentAuthorityFence(credential(), {
    storage,
    custodyId: 'agent:terminal-escalation',
  });
  await synchronizeValidated(fence);
  const phases = [];
  fence.registerParticipant({
    quiesce() { phases.push('quiesce'); },
    blank() { phases.push('blank'); },
    clearMemory() { phases.push('clearMemory'); },
    async commitDurable() { phases.push('commitDurable'); },
  });
  const capture = fence.capture();
  const carrier = fence.terminate(capture, 'carrier');
  await carrier.settlement;
  assert.equal(storage.snapshot('agent:terminal-escalation').status, 'active');
  const terminalError = Object.assign(new Error('classified revocation'), {
    authorityDisposition: 'durableDelete',
  });
  const escalated = fence.terminate(capture, {
    authorityDisposition: 'durableDelete',
    terminalError,
  });
  assert.equal(escalated.authorityDisposition, 'durableDelete');
  assert.equal(
    fence.terminate(capture, { authorityDisposition: 'durableDelete', terminalError }),
    escalated,
    'the exact escalation is idempotent',
  );
  await escalated.settlement;
  assert.deepEqual(phases, ['quiesce', 'blank', 'clearMemory', 'commitDurable']);
  assert.equal(storage.snapshot('agent:terminal-escalation').phase, 'settled');
  assert.equal(storage.snapshot('agent:terminal-escalation').status, 'deleted');
}

// A restarted process has no publishable capture before strict handshake.
// An exact classified invalid-bearer response can still tombstone only the
// configured/observed durable tuple while publication remains closed.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const custodyId = 'agent:terminal-restart-classification';
  const initial = new AgentAuthorityFence(credential(), { storage, custodyId });
  await synchronizeValidated(initial);
  const restartedCredential = credential({ tokenId: TOKEN_B, bearerToken: 'invalid-restart-carrier' });
  const restarted = new AgentAuthorityFence(restartedCredential, { storage, custodyId });
  const phases = [];
  restarted.registerParticipant({
    quiesce() { phases.push('registration-quiesce'); },
    blank() { phases.push('registration-blank'); },
    clearMemory() { phases.push('registration-clear'); },
    async commitDurable() { phases.push('commitDurable'); },
  });
  const offer = restarted.credentialOfferForHandshake();
  assert.throws(
    () => restarted.terminateValidatedCredential({ ...offer }, { authorityDisposition: 'durableDelete' }),
    code('SNAPBACK_CLIENT_AUTHORITY_STALE'),
    'a copied or forged offer cannot authorize closed-custody deletion',
  );
  const deletion = restarted.terminateValidatedCredential(offer, {
    authorityDisposition: 'durableDelete',
    terminalError: new Error('server-classified invalid carrier'),
  });
  assert.equal(
    restarted.terminateValidatedCredential(offer, { authorityDisposition: 'durableDelete' }),
    deletion,
    'the exact validated offer reuses one deletion settlement',
  );
  await deletion.settlement;
  assert.deepEqual(phases, [
    'registration-quiesce',
    'registration-blank',
    'registration-clear',
    'commitDurable',
  ]);
  assert.equal(storage.snapshot(custodyId).phase, 'settled');
  assert.equal(storage.snapshot(custodyId).status, 'deleted');
  assert.throws(() => restarted.capture(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
}

// A classified restart may find the configured successor already installed as
// a clearing/active intent. Replay and settle that exact transition first,
// then use its settled successor as the predecessor of a distinct tombstone.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const custodyId = 'agent:terminal-restart-clearing-active';
  const predecessorValue = credential();
  const successorValue = credential({ grantId: GRANT_B, tokenId: TOKEN_B });
  const predecessor = new AgentAuthorityFence(predecessorValue, { storage, custodyId });
  await synchronizeValidated(predecessor, predecessorValue);
  predecessor.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() { throw new Error('leave the active successor clearing'); },
  });
  await assert.rejects(
    replaceValidated(predecessor, successorValue),
    /leave the active successor clearing/,
  );
  const interrupted = storage.snapshot(custodyId);
  assert.equal(interrupted.phase, 'clearing');
  assert.equal(interrupted.status, 'active');

  const restartedValue = credential({ grantId: GRANT_B, tokenId: TOKEN_C });
  const restarted = new AgentAuthorityFence(restartedValue, { storage, custodyId });
  const localPhases = [];
  const durableContexts = [];
  restarted.registerParticipant({
    quiesce() { localPhases.push('registration-quiesce'); },
    blank() { localPhases.push('registration-blank'); },
    clearMemory() { localPhases.push('registration-clear'); },
    async commitDurable(context) { durableContexts.push(context); },
    async resume() { localPhases.push('unexpected-resume'); },
  });
  const offer = restarted.credentialOfferForHandshake();
  const deletion = restarted.terminateValidatedCredential(offer, {
    authorityDisposition: 'durableDelete',
    terminalError: new Error('classified while successor recovery was pending'),
  });
  await deletion.settlement;
  assert.deepEqual(localPhases, [
    'registration-quiesce',
    'registration-blank',
    'registration-clear',
  ]);
  assert.equal(durableContexts.length, 2, 'recovery and deletion each settle one durable intent');
  assert.equal(durableContexts[0].transitionId, interrupted.transition.transitionId);
  assert.equal(durableContexts[0].reason, interrupted.transition.reason);
  assert.equal(durableContexts[0].nextAuthority.grantId, GRANT_B);
  assert.notEqual(durableContexts[1].transitionId, durableContexts[0].transitionId);
  assert.equal(durableContexts[1].authorityDisposition, 'durableDelete');
  assert.equal(durableContexts[1].nextAuthority, null);
  const tombstone = storage.snapshot(custodyId);
  assert.equal(tombstone.phase, 'settled');
  assert.equal(tombstone.status, 'deleted');
  assert.equal(tombstone.authorityKey, interrupted.authorityKey);
  assert.equal(tombstone.authorityEpoch, interrupted.authorityEpoch + 1);
}

// Durable deletion remains available after the volatile carrier identity is
// exhausted. The local cut happens once, the exact tombstone still settles,
// and only then does the public handle preserve the exhaustion diagnostic.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const custodyId = 'agent:terminal-carrier-counter-exhausted';
  const fence = new AgentAuthorityFence(credential(), {
    storage,
    custodyId,
    carrierCounterCeiling: 1,
    barrierCounterCeiling: 10,
  });
  await synchronizeValidated(fence);
  await replaceValidated(fence, credential({ tokenId: TOKEN_B }));
  const phases = [];
  fence.registerParticipant({
    quiesce() { phases.push('quiesce'); },
    blank() { phases.push('blank'); },
    clearMemory() { phases.push('clearMemory'); },
    async commitDurable() { phases.push('commitDurable'); },
  });
  const capture = fence.capture();
  const deletion = fence.terminate(capture, { authorityDisposition: 'durableDelete' });
  assert.equal(
    fence.terminate(capture, { authorityDisposition: 'durableDelete' }),
    deletion,
  );
  await assert.rejects(
    deletion.settlement,
    code('SNAPBACK_CLIENT_AUTH_CARRIER_GENERATION_EXHAUSTED'),
  );
  assert.deepEqual(phases, ['quiesce', 'blank', 'clearMemory', 'commitDurable']);
  assert.equal(storage.snapshot(custodyId).phase, 'settled');
  assert.equal(storage.snapshot(custodyId).status, 'deleted');
}

// Barrier generation exhaustion performs the same synchronous local cut, but
// cannot veto a terminal-only durable CAS lane that does not reuse its ID.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const custodyId = 'agent:terminal-barrier-counter-exhausted';
  const fence = new AgentAuthorityFence(credential(), {
    storage,
    custodyId,
    carrierCounterCeiling: 10,
    barrierCounterCeiling: 1,
  });
  await synchronizeValidated(fence);
  const phases = [];
  let unregister;
  let removal;
  unregister = fence.registerParticipant({
    quiesce() {
      phases.push('quiesce');
      removal ??= unregister();
    },
    blank() { phases.push('blank'); },
    clearMemory() { phases.push('clearMemory'); },
    async commitDurable() { phases.push('commitDurable'); },
  });
  const capture = fence.capture();
  const deletion = fence.terminate(capture, { authorityDisposition: 'durableDelete' });
  await assert.rejects(
    deletion.settlement,
    code('SNAPBACK_CLIENT_AUTH_BARRIER_GENERATION_EXHAUSTED'),
  );
  assert.deepEqual(phases, ['quiesce', 'blank', 'clearMemory', 'commitDurable']);
  assert.equal(storage.snapshot(custodyId).phase, 'settled');
  assert.equal(storage.snapshot(custodyId).status, 'deleted');
  await removal;
}

// A classified durable deletion at the reserved counter boundary persists the
// same exhaustion marker as replacement. The initiating settlement preserves
// the precise counter diagnostic; a fresh process sees the generic permanent
// closure marker.
for (const { field, injected, expectedCode } of [
  {
    field: 'authorityEpoch',
    injected: Number.MAX_SAFE_INTEGER - 1,
    expectedCode: 'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED',
  },
  {
    field: 'revision',
    injected: Number.MAX_SAFE_INTEGER - 2,
    expectedCode: 'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
  },
]) {
  const state = { custody: Object.create(null) };
  const storage = createMemoryAgentAuthorityCustodyStorage({ state });
  const custodyId = `agent:terminal-durable-${field}-exhausted`;
  const seed = new AgentAuthorityFence(credential(), { storage, custodyId });
  await synchronizeValidated(seed);
  state.custody[custodyId] = {
    ...storage.snapshot(custodyId),
    [field]: injected,
  };
  const fence = new AgentAuthorityFence(credential(), { storage, custodyId });
  await synchronizeValidated(fence);
  let durableCommits = 0;
  fence.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() { durableCommits += 1; },
  });
  const deletion = fence.terminate(fence.capture(), { authorityDisposition: 'durableDelete' });
  await assert.rejects(deletion.settlement, code(expectedCode));
  const preserved = storage.snapshot(custodyId);
  assert.equal(preserved.phase, 'exhausted');
  assert.equal(preserved.status, 'deleted');
  assert.equal(preserved[field], field === 'revision' ? injected + 1 : injected);
  assert.equal(durableCommits, 0, 'no unrepresentable durable intent reaches participants');
  assert.throws(() => fence.capture(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
  const restarted = new AgentAuthorityFence(credential({ tokenId: TOKEN_B }), {
    storage,
    custodyId,
  });
  await assert.rejects(
    synchronizeValidated(restarted, credential({ tokenId: TOKEN_B })),
    code('SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED'),
  );
}

// Legacy clearing intents at a maximum counter replay their durable effect
// before failing closed. Epoch poison can settle and then consume a marker;
// a clearing record that already consumed MAX revision remains intact so every
// restart can replay the idempotent participant instead of dropping intent.
for (const field of ['authorityEpoch', 'revision']) {
  const state = { custody: Object.create(null) };
  const storage = createMemoryAgentAuthorityCustodyStorage({ state });
  const custodyId = `agent:legacy-clearing-${field}-max`;
  const writer = new AgentAuthorityFence(credential(), { storage, custodyId });
  await synchronizeValidated(writer);
  writer.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() { throw new Error('leave clearing for max-counter recovery'); },
    async resume() {},
  });
  await assert.rejects(
    replaceValidated(writer, credential({ grantId: GRANT_B, tokenId: TOKEN_B })),
    /leave clearing/,
  );
  const clearing = storage.snapshot(custodyId);
  const transition = { ...clearing.transition };
  if (field === 'authorityEpoch') {
    transition.expectedEpoch = Number.MAX_SAFE_INTEGER - 1;
    transition.nextEpoch = Number.MAX_SAFE_INTEGER;
  } else {
    transition.expectedRevision = Number.MAX_SAFE_INTEGER - 1;
  }
  transition.transitionId = transitionIdForTest(custodyId, transition);
  state.custody[custodyId] = {
    ...clearing,
    authorityEpoch: field === 'authorityEpoch'
      ? Number.MAX_SAFE_INTEGER
      : clearing.authorityEpoch,
    revision: field === 'revision'
      ? Number.MAX_SAFE_INTEGER
      : clearing.revision,
    transition,
  };

  const value = credential({ grantId: GRANT_B, tokenId: TOKEN_C });
  const recovery = new AgentAuthorityFence(value, { storage, custodyId });
  let durableCommits = 0;
  recovery.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() { durableCommits += 1; },
    async resume() { assert.fail('poisoned clearing recovery cannot resume'); },
  });
  await assert.rejects(
    synchronizeValidated(recovery, value),
    code(field === 'revision'
      ? 'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED'
      : 'SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED'),
  );
  assert.equal(durableCommits, 1, 'clearing intent replays before counter failure');
  assert.throws(() => recovery.capture(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
  const terminal = storage.snapshot(custodyId);
  assert.equal(terminal.phase, field === 'revision' ? 'clearing' : 'exhausted');
  assert.equal(terminal.status, field === 'revision' ? 'active' : 'deleted');
}

// A validated synchronization that has already read empty custody cannot
// resurrect it after a same-process durableDelete. The deletion establishes a
// fresh terminal tombstone before settling; the delayed initializer then sees
// the local terminal gate (and would lose the null CAS in another process).
{
  const base = createMemoryAgentAuthorityCustodyStorage();
  const readReleased = deferred();
  const releaseRead = deferred();
  let pauseFirstOwnershipResult = true;
  const storage = {
    partitionOwnership: base.partitionOwnership,
    async withOwnership(custodyId, operation) {
      const result = await base.withOwnership(custodyId, operation);
      if (
        pauseFirstOwnershipResult
        && custodyId.startsWith('snapback.agent-custody-gate.v1:')
      ) {
        pauseFirstOwnershipResult = false;
        readReleased.resolve();
        await releaseRead.promise;
      }
      return result;
    },
  };
  const custodyId = 'agent:null-delete-race';
  const value = credential();
  const fence = new AgentAuthorityFence(value, { storage, custodyId });
  const offer = fence.credentialOfferForHandshake();
  const synchronizing = synchronizeValidated(fence, value);
  await readReleased.promise;
  const deletion = fence.terminateValidatedCredential(offer, {
    authorityDisposition: 'durableDelete',
  });
  await deletion.settlement;
  const tombstone = base.snapshot(custodyId);
  assert.equal(tombstone.phase, 'settled');
  assert.equal(tombstone.status, 'deleted');
  assert.equal(tombstone.authorityEpoch, 0);
  assert.equal(tombstone.revision, 2);
  releaseRead.resolve();
  await assert.rejects(synchronizing, code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
  assert.deepEqual(base.snapshot(custodyId), tombstone);

  const restarted = new AgentAuthorityFence(credential({ tokenId: TOKEN_B }), {
    storage: base,
    custodyId,
  });
  await assert.rejects(
    synchronizeValidated(restarted, credential({ tokenId: TOKEN_B })),
    code('SNAPBACK_CLIENT_AUTHORITY_STALE'),
  );
  assert.deepEqual(base.snapshot(custodyId), tombstone);
}

// Fresh terminal custody remains in clearing until every durable participant
// has committed. A failed callback leaves replayable intent; a restarted
// fence replays it and only then settles the deletion tombstone.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const custodyId = 'agent:fresh-terminal-participant-recovery';
  const value = credential();
  const failing = new AgentAuthorityFence(value, { storage, custodyId });
  const offer = failing.credentialOfferForHandshake();
  let attempts = 0;
  failing.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable(context) {
      attempts += 1;
      assert.equal(context.expectedEpoch, null);
      assert.equal(context.nextEpoch, 0);
      assert.equal(context.previousAuthority.grantId, GRANT_A);
      assert.equal(context.nextAuthority, null);
      throw new Error('injected fresh terminal participant failure');
    },
    async resume() {},
  });
  const failed = failing.terminateValidatedCredential(offer, {
    authorityDisposition: 'durableDelete',
  });
  await assert.rejects(failed.settlement, /fresh terminal participant failure/);
  assert.equal(attempts, 1);
  assert.equal(storage.snapshot(custodyId).phase, 'clearing');
  assert.equal(storage.snapshot(custodyId).status, 'deleted');

  const recovery = new AgentAuthorityFence(credential({ tokenId: TOKEN_B }), {
    storage,
    custodyId,
  });
  let recoveryCommits = 0;
  recovery.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable(context) {
      recoveryCommits += 1;
      assert.equal(context.expectedEpoch, null);
      assert.equal(context.nextEpoch, 0);
    },
    async resume() {},
  });
  await assert.rejects(
    synchronizeValidated(recovery, credential({ tokenId: TOKEN_B })),
    code('SNAPBACK_CLIENT_AUTHORITY_STALE'),
  );
  assert.equal(recoveryCommits, 1);
  assert.equal(storage.snapshot(custodyId).phase, 'settled');
  assert.equal(storage.snapshot(custodyId).status, 'deleted');
}

// A terminal result for proposed tuple B excludes B without touching the
// active predecessor A. The tuple witness and main custody CAS share one gate:
// if an older validated B synchronization already read A but has not written,
// the later terminal witness wins and its active CAS is refused.
// A fresh terminal B that loses its null CAS to initializer A re-enters the
// gated ownership check. It preserves A instead of treating the newly observed
// row as B's predecessor.
{
  const base = createMemoryAgentAuthorityCustodyStorage();
  const custodyId = 'agent:fresh-terminal-cas-loser';
  const witnessRecorded = deferred();
  const releaseTerminal = deferred();
  let pauseFirstGate = true;
  const delayedTerminalStorage = {
    partitionOwnership: base.partitionOwnership,
    async withOwnership(partition, operation) {
      const result = await base.withOwnership(partition, operation);
      if (partition.startsWith('snapback.agent-custody-gate.v1:') && pauseFirstGate) {
        pauseFirstGate = false;
        witnessRecorded.resolve();
        await releaseTerminal.promise;
      }
      return result;
    },
  };
  const b = credential({ grantId: GRANT_B, tokenId: TOKEN_B });
  const terminalB = new AgentAuthorityFence(b, {
    storage: delayedTerminalStorage,
    custodyId,
  });
  const deletion = terminalB.terminateValidatedCredential(
    terminalB.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  await witnessRecorded.promise;

  const a = credential();
  const initializerA = new AgentAuthorityFence(a, { storage: base, custodyId });
  await synchronizeValidated(initializerA, a);
  const activeA = base.snapshot(custodyId);
  releaseTerminal.resolve();
  await deletion.settlement;
  assert.deepEqual(base.snapshot(custodyId), activeA);
  assert.equal(activeA.status, 'active');
  assert.equal(activeA.authority.grantId, GRANT_A);
}

// A terminal witness that linearizes after a successor checked the side ledger
// but before counter-exhaustion persistence prevents that successor from
// tombstoning the distinct predecessor merely because no next epoch exists.
{
  const state = { custody: Object.create(null) };
  const base = createMemoryAgentAuthorityCustodyStorage({ state });
  const custodyId = 'agent:witness-counter-race';
  const a = credential();
  const seed = new AgentAuthorityFence(a, { storage: base, custodyId });
  await synchronizeValidated(seed, a);
  state.custody[custodyId] = {
    ...state.custody[custodyId],
    authorityEpoch: Number.MAX_SAFE_INTEGER - 1,
  };
  const predecessor = base.snapshot(custodyId);
  const witnessChecked = deferred();
  const releasePlan = deferred();
  let gateReads = 0;
  const delayed = {
    partitionOwnership: base.partitionOwnership,
    async withOwnership(partition, operation) {
      const result = await base.withOwnership(partition, operation);
      if (partition.startsWith('snapback.agent-custody-gate.v1:')) {
        gateReads += 1;
        if (gateReads === 2) {
          witnessChecked.resolve();
          await releasePlan.promise;
        }
      }
      return result;
    },
  };
  const b = credential({ grantId: GRANT_B, tokenId: TOKEN_B });
  const successor = new AgentAuthorityFence(b, { storage: delayed, custodyId });
  const synchronizing = synchronizeValidated(successor, b);
  await witnessChecked.promise;
  const terminalB = new AgentAuthorityFence(b, { storage: base, custodyId });
  const deletion = terminalB.terminateValidatedCredential(
    terminalB.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  await deletion.settlement;
  releasePlan.resolve();
  await assert.rejects(synchronizing, code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
  assert.deepEqual(base.snapshot(custodyId), predecessor);
}

// Once B's clearing row is durable, a later terminal B witness and deletion
// wins the universal gate. The older installer cannot settle active B after
// the terminal process returns.
{
  const storage = createMemoryAgentAuthorityCustodyStorage();
  const custodyId = 'agent:clearing-terminal-race';
  const a = credential();
  const seed = new AgentAuthorityFence(a, { storage, custodyId });
  await synchronizeValidated(seed, a);
  const b = credential({ grantId: GRANT_B, tokenId: TOKEN_B });
  const successor = new AgentAuthorityFence(b, { storage, custodyId });
  const clearingWritten = deferred();
  const releaseCommit = deferred();
  successor.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() {
      clearingWritten.resolve();
      await releaseCommit.promise;
    },
    async resume() {},
  });
  const installing = synchronizeValidated(successor, b);
  await clearingWritten.promise;
  assert.equal(storage.snapshot(custodyId).phase, 'clearing');
  assert.equal(storage.snapshot(custodyId).status, 'active');

  const terminalValue = credential({ grantId: GRANT_B, tokenId: TOKEN_C });
  const terminal = new AgentAuthorityFence(terminalValue, { storage, custodyId });
  const deletion = terminal.terminateValidatedCredential(
    terminal.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  await deletion.settlement;
  releaseCommit.resolve();
  await assert.rejects(installing, code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
  assert.equal(storage.snapshot(custodyId).phase, 'settled');
  assert.equal(storage.snapshot(custodyId).status, 'deleted');
  assert.equal(storage.snapshot(custodyId).authority.grantId, GRANT_B);
}

// A pre-ledger v1 main-row tombstone is absorbed into the bounded exact ledger
// before a distinct active tuple replaces it. After C installs, delayed B
// remains excluded without retaining a tuple-specific sidecar.
{
  const state = { custody: Object.create(null) };
  const storage = createMemoryAgentAuthorityCustodyStorage({ state });
  const custodyId = 'agent:legacy-tombstone-backfill';
  const b = credential({ grantId: GRANT_B, tokenId: TOKEN_B });
  const originalB = new AgentAuthorityFence(b, { storage, custodyId });
  await synchronizeValidated(originalB, b);
  const deletion = originalB.terminate(originalB.capture(), {
    authorityDisposition: 'durableDelete',
  });
  await deletion.settlement;
  const modernTombstone = state.custody[custodyId];
  const { terminalLedgerVersion: _, ...legacyTombstone } = modernTombstone;
  state.custody[custodyId] = { ...legacyTombstone, formatVersion: 1 };
  for (const partition of Object.keys(state.custody)) {
    if (
      partition.startsWith('snapback.agent-terminal-ledger.v2:')
      || partition.startsWith('snapback.agent-terminal-bucket.v2:')
    ) delete state.custody[partition];
  }
  assert.equal(storage.snapshot(custodyId).status, 'deleted');

  const c = credential({ grantId: GRANT_A, tokenId: TOKEN_C });
  const successorC = new AgentAuthorityFence(c, { storage, custodyId });
  await synchronizeValidated(successorC, c);
  const activeC = storage.snapshot(custodyId);
  assert.equal(activeC.status, 'active');
  assert.equal(activeC.formatVersion, 2);
  const inspection = await successorC.inspectCustody();
  assert.equal(inspection.ledgerFormat, 'bucket-v2');
  assert.equal(inspection.witnessCount, 1);
  assert.equal(
    Object.keys(state.custody).some((partition) => (
      partition.startsWith('snapback.agent-terminal-witness.v1:')
    )),
    false,
  );

  const delayedBValue = credential({ grantId: GRANT_B, tokenId: TOKEN_C });
  const delayedB = new AgentAuthorityFence(delayedBValue, { storage, custodyId });
  await assert.rejects(
    synchronizeValidated(delayedB, delayedBValue),
    code('SNAPBACK_CLIENT_AUTHORITY_STALE'),
  );
  assert.deepEqual(storage.snapshot(custodyId), activeC);
}

{
  const base = createMemoryAgentAuthorityCustodyStorage();
  const custodyId = 'agent:proposed-terminal-witness';
  const a = credential();
  const seed = new AgentAuthorityFence(a, { storage: base, custodyId });
  await synchronizeValidated(seed, a);
  const predecessor = base.snapshot(custodyId);

  const readReleased = deferred();
  const releaseRead = deferred();
  let pausePrimaryRead = true;
  const delayed = {
    partitionOwnership: base.partitionOwnership,
    async withOwnership(partition, operation) {
      const result = await base.withOwnership(partition, operation);
      if (partition.startsWith('snapback.agent-custody-gate.v1:') && pausePrimaryRead) {
        pausePrimaryRead = false;
        readReleased.resolve();
        await releaseRead.promise;
      }
      return result;
    },
  };
  const b = credential({ grantId: GRANT_B, tokenId: TOKEN_B });
  const olderSuccess = new AgentAuthorityFence(b, { storage: delayed, custodyId });
  const installing = synchronizeValidated(olderSuccess, b);
  await readReleased.promise;

  const laterTerminal = new AgentAuthorityFence(b, { storage: base, custodyId });
  const offer = laterTerminal.credentialOfferForHandshake();
  const deletion = laterTerminal.terminateValidatedCredential(offer, {
    authorityDisposition: 'durableDelete',
  });
  await deletion.settlement;
  assert.deepEqual(base.snapshot(custodyId), predecessor, 'terminal B preserves active A byte-for-byte');

  releaseRead.resolve();
  await assert.rejects(installing, code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
  assert.deepEqual(base.snapshot(custodyId), predecessor);
  const restartedB = new AgentAuthorityFence(credential({
    grantId: GRANT_B,
    tokenId: TOKEN_C,
  }), { storage: base, custodyId });
  await assert.rejects(
    synchronizeValidated(restartedB, credential({ grantId: GRANT_B, tokenId: TOKEN_C })),
    code('SNAPBACK_CLIENT_AUTHORITY_STALE'),
  );
  assert.deepEqual(base.snapshot(custodyId), predecessor);
}

// A fresh v2 primary is never published without an active exact ledger. Fixed
// buckets bound growth; overflowing any one bucket closes the whole custody
// fail-closed, after which recorded, overflowing, unseen, and formerly active
// tuples are all refused without allocating another witness partition.
{
  const state = { custody: Object.create(null) };
  const storage = createMemoryAgentAuthorityCustodyStorage({
    state,
    terminalLedgerParameters: { bucketCount: 1, bucketCapacity: 2 },
  });
  const custodyId = 'agent:bounded-terminal-ledger';
  const activeValue = credential({ credentialGeneration: 3 });
  const active = new AgentAuthorityFence(activeValue, { storage, custodyId });
  await synchronizeValidated(active, activeValue);

  const rootId = `snapback.agent-terminal-ledger.v2:${custodyId}`;
  assert.equal(storage.snapshot(custodyId).formatVersion, 2);
  assert.equal(storage.snapshot(custodyId).terminalLedgerVersion, 1);
  assert.equal(storage.snapshot(rootId).phase, 'active');
  assert.equal(storage.snapshot(rootId).legacyCut, true);

  const terminalValues = [4, 5, 6].map((credentialGeneration) => credential({
    credentialGeneration,
    tokenId: TOKEN_B,
  }));
  for (const value of terminalValues) {
    const terminal = new AgentAuthorityFence(value, { storage, custodyId });
    const deletion = terminal.terminateValidatedCredential(
      terminal.credentialOfferForHandshake(),
      { authorityDisposition: 'durableDelete' },
    );
    await deletion.settlement;
  }

  const closed = storage.snapshot(rootId);
  assert.equal(closed.phase, 'closed');
  assert.equal(closed.legacyCut, true);
  const inspection = await active.inspectCustody();
  assert.deepEqual(
    {
      ledgerFormat: inspection.ledgerFormat,
      state: inspection.state,
      witnessCount: inspection.witnessCount,
      capacity: inspection.capacity,
      warningThreshold: inspection.warningThreshold,
      bucketCapacity: inspection.bucketCapacity,
      bucketWarningThreshold: inspection.bucketWarningThreshold,
      largestBucketCount: inspection.largestBucketCount,
      warning: inspection.warning,
    },
    {
      ledgerFormat: 'bucket-v2',
      state: 'closed',
      witnessCount: 2,
      capacity: 2,
      warningThreshold: 2,
      bucketCapacity: 2,
      bucketWarningThreshold: 2,
      largestBucketCount: 2,
      warning: true,
    },
  );
  assert(inspection.witnessBytes > 0);
  assert.equal(
    Object.keys(state.custody).filter((partition) => (
      partition.startsWith('snapback.agent-terminal-bucket.v2:')
    )).length,
    1,
  );
  assert.equal(
    Object.keys(state.custody).some((partition) => (
      partition.startsWith('snapback.agent-terminal-witness.v1:')
    )),
    false,
  );

  const partitionCount = Object.keys(state.custody).length;
  for (const value of [
    terminalValues[0],
    terminalValues[1],
    terminalValues[2],
    credential({ credentialGeneration: 99, tokenId: TOKEN_C }),
    activeValue,
  ]) {
    const delayed = new AgentAuthorityFence(value, { storage, custodyId });
    await assert.rejects(
      synchronizeValidated(delayed, value),
      code('SNAPBACK_CLIENT_AUTHORITY_STALE'),
    );
    assert.equal(Object.keys(state.custody).length, partitionCount);
  }
}

// The v1-to-v2 cut is restart-safe at every durable checkpoint. Until the v2
// primary is visible the exact v1 witness remains; once it is visible the root
// is already active, and restart completes physical retirement before sealing
// the cut without forgetting the delayed tuple. The retirement checkpoint
// reports the exact remaining count.
for (const checkpoint of [
  'afterLedgerPreparing',
  'afterLedgerBuckets',
  'afterLedgerActive',
  'afterPrimaryV2',
  'afterLegacyWitnessRemove',
]) {
  const state = { custody: Object.create(null) };
  const custodyId = `agent:terminal-ledger-crash-${checkpoint}`;
  const activeValue = credential({ credentialGeneration: 30 });
  const seedStorage = createMemoryAgentAuthorityCustodyStorage({ state });
  const seed = new AgentAuthorityFence(activeValue, { storage: seedStorage, custodyId });
  await synchronizeValidated(seed, activeValue);
  const modernPrimary = state.custody[custodyId];
  const { terminalLedgerVersion: _, ...legacyPrimary } = modernPrimary;
  state.custody[custodyId] = { ...legacyPrimary, formatVersion: 1 };
  for (const partition of Object.keys(state.custody)) {
    if (
      partition.startsWith('snapback.agent-terminal-ledger.v2:')
      || partition.startsWith('snapback.agent-terminal-bucket.v2:')
    ) delete state.custody[partition];
  }

  const delayedValue = credential({ credentialGeneration: 31, tokenId: TOKEN_B });
  const delayedAuthority = new AgentAuthorityFence(delayedValue).authority;
  const delayedKey = canonicalAgentAuthorityKey(delayedAuthority);
  const witnessId = `snapback.agent-terminal-witness.v1:${delayedKey}:${custodyId}`;
  state.custody[witnessId] = {
    formatVersion: 1,
    custodyId: witnessId,
    authorityEpoch: 0,
    revision: 2,
    phase: 'settled',
    status: 'deleted',
    authorityKey: delayedKey,
    authority: delayedAuthority,
    transition: null,
  };

  const events = [];
  let inject = true;
  const crashingStorage = createMemoryAgentAuthorityCustodyStorage({
    state,
    async terminalLedgerCheckpoint(name, context) {
      events.push({ name, context });
      if (inject && name === checkpoint) {
        inject = false;
        throw new Error(`injected terminal-ledger crash at ${checkpoint}`);
      }
    },
  });
  const crashing = new AgentAuthorityFence(activeValue, {
    storage: crashingStorage,
    custodyId,
  });
  await assert.rejects(
    synchronizeValidated(crashing, activeValue),
    new RegExp(`injected terminal-ledger crash at ${checkpoint}`),
  );
  assert(events.some((event) => event.name === checkpoint));

  const crashedPrimary = state.custody[custodyId];
  const rootId = `snapback.agent-terminal-ledger.v2:${custodyId}`;
  const crashedRoot = state.custody[rootId];
  if (crashedPrimary.formatVersion === 2) {
    assert(
      crashedRoot.phase === 'active' || crashedRoot.phase === 'closed',
      'a v2 primary is never visible beside a preparing ledger',
    );
  }
  if (
    crashedRoot.legacyCut
    || events.some((event) => event.name === 'afterLegacyWitnessRemove')
  ) {
    assert.equal(Object.hasOwn(state.custody, witnessId), false);
  } else {
    assert.equal(Object.hasOwn(state.custody, witnessId), true);
  }
  if (checkpoint === 'afterLegacyWitnessRemove') {
    const removal = events.findLast((event) => event.name === checkpoint);
    assert.equal(removal.context.remainingWitnessCount, 0);
  }

  const recoveredStorage = createMemoryAgentAuthorityCustodyStorage({ state });
  const recovered = new AgentAuthorityFence(activeValue, {
    storage: recoveredStorage,
    custodyId,
  });
  await synchronizeValidated(recovered, activeValue);
  assert.equal(recoveredStorage.snapshot(custodyId).formatVersion, 2);
  assert.equal(recoveredStorage.snapshot(rootId).phase, 'active');
  assert.equal(recoveredStorage.snapshot(rootId).legacyCut, true);
  assert.equal(Object.hasOwn(state.custody, witnessId), false);
  assert.equal((await recovered.inspectCustody()).witnessCount, 1);

  const delayed = new AgentAuthorityFence(delayedValue, {
    storage: recoveredStorage,
    custodyId,
  });
  await assert.rejects(
    synchronizeValidated(delayed, delayedValue),
    code('SNAPBACK_CLIENT_AUTHORITY_STALE'),
  );
  assert.equal(recoveredStorage.snapshot(custodyId).authorityKey, modernPrimary.authorityKey);
}

// While the migration compatibility cut is open, a terminal tuple is first
// settled in the v1 witness journal and only then copied into its v2 bucket.
// Crashing between those writes therefore remains exclusion-safe for an old
// reader and gives v2 restart an exact source from which to rebuild.
{
  const state = { custody: Object.create(null) };
  const custodyId = 'agent:terminal-ledger-dual-write-crash';
  const activeValue = credential({ credentialGeneration: 32 });
  const seedStorage = createMemoryAgentAuthorityCustodyStorage({ state });
  const seed = new AgentAuthorityFence(activeValue, { storage: seedStorage, custodyId });
  await synchronizeValidated(seed, activeValue);
  const { terminalLedgerVersion: _, ...legacyPrimary } = state.custody[custodyId];
  state.custody[custodyId] = { ...legacyPrimary, formatVersion: 1 };
  for (const partition of Object.keys(state.custody)) {
    if (
      partition.startsWith('snapback.agent-terminal-ledger.v2:')
      || partition.startsWith('snapback.agent-terminal-bucket.v2:')
    ) delete state.custody[partition];
  }

  const terminalValue = credential({ credentialGeneration: 33, tokenId: TOKEN_B });
  const terminalAuthority = new AgentAuthorityFence(terminalValue).authority;
  const terminalKey = canonicalAgentAuthorityKey(terminalAuthority);
  const witnessId = `snapback.agent-terminal-witness.v1:${terminalKey}:${custodyId}`;
  let inject = true;
  const crashingStorage = createMemoryAgentAuthorityCustodyStorage({
    state,
    async terminalLedgerCheckpoint(name) {
      if (inject && name === 'afterLegacyWitnessWrite') {
        inject = false;
        throw new Error('injected crash between v1 witness and v2 bucket');
      }
    },
  });
  const terminal = new AgentAuthorityFence(terminalValue, {
    storage: crashingStorage,
    custodyId,
  });
  const crashedDeletion = terminal.terminateValidatedCredential(
    terminal.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  await assert.rejects(
    crashedDeletion.settlement,
    /injected crash between v1 witness and v2 bucket/,
  );
  const legacyWitness = state.custody[witnessId];
  assert.equal(legacyWitness.formatVersion, 1);
  assert.equal(legacyWitness.phase, 'settled');
  assert.equal(legacyWitness.status, 'deleted');
  assert.equal(legacyWitness.authorityKey, terminalKey);
  assert.equal(
    Object.keys(state.custody).some((partition) => (
      partition.startsWith('snapback.agent-terminal-bucket.v2:')
      && partition.endsWith(`:${custodyId}`)
    )),
    false,
  );
  assert.throws(
    () => new AgentAuthorityFence(terminalValue, {
      storage: { ...crashingStorage, partitionOwnership: 'partitioned-v1' },
      custodyId,
    }),
    code('SNAPBACK_AUTH_CUSTODY_PARTITION_OWNERSHIP_REQUIRED'),
  );

  const recoveredStorage = createMemoryAgentAuthorityCustodyStorage({ state });
  const recoveredTerminal = new AgentAuthorityFence(terminalValue, {
    storage: recoveredStorage,
    custodyId,
  });
  const recoveredDeletion = recoveredTerminal.terminateValidatedCredential(
    recoveredTerminal.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  await recoveredDeletion.settlement;
  const delayed = new AgentAuthorityFence(terminalValue, {
    storage: recoveredStorage,
    custodyId,
  });
  await assert.rejects(
    synchronizeValidated(delayed, terminalValue),
    code('SNAPBACK_CLIENT_AUTHORITY_STALE'),
  );

  const cut = new AgentAuthorityFence(activeValue, {
    storage: recoveredStorage,
    custodyId,
  });
  await synchronizeValidated(cut, activeValue);
  assert.equal(recoveredStorage.snapshot(custodyId).formatVersion, 2);
  assert.equal(
    recoveredStorage.snapshot(`snapback.agent-terminal-ledger.v2:${custodyId}`).legacyCut,
    true,
  );
  assert.equal(Object.hasOwn(state.custody, witnessId), false);
}

// A straggling v1 terminal process can still journal a verdict before it reads
// and rejects the already-format-2 primary. A v2 gate derives that candidate's
// exact journal partition, absorbs it before comparison, and retires it only
// after its bucket entry is durable; unrelated partitions are never scanned.
{
  const state = { custody: Object.create(null) };
  const storage = createMemoryAgentAuthorityCustodyStorage({ state });
  const custodyId = 'agent:terminal-ledger-post-cut-v1-straggler';
  const activeValue = credential({ credentialGeneration: 37 });
  const active = new AgentAuthorityFence(activeValue, { storage, custodyId });
  await synchronizeValidated(active, activeValue);
  const rootId = `snapback.agent-terminal-ledger.v2:${custodyId}`;
  assert.equal(storage.snapshot(rootId).legacyCut, true);

  const stragglerValue = credential({ credentialGeneration: 38, tokenId: TOKEN_B });
  const stragglerAuthority = new AgentAuthorityFence(stragglerValue).authority;
  const stragglerKey = canonicalAgentAuthorityKey(stragglerAuthority);
  const witnessId = `snapback.agent-terminal-witness.v1:${stragglerKey}:${custodyId}`;
  state.custody[witnessId] = {
    formatVersion: 1,
    custodyId: witnessId,
    authorityEpoch: 0,
    revision: 2,
    phase: 'settled',
    status: 'deleted',
    authorityKey: stragglerKey,
    authority: stragglerAuthority,
    transition: null,
  };

  const delayed = new AgentAuthorityFence(stragglerValue, { storage, custodyId });
  await assert.rejects(
    synchronizeValidated(delayed, stragglerValue),
    code('SNAPBACK_CLIENT_AUTHORITY_STALE'),
  );
  assert.equal(Object.hasOwn(state.custody, witnessId), false);
  assert.equal(storage.snapshot(custodyId).authorityKey, active.capture().authorityKey);
  assert.equal((await active.inspectCustody()).witnessCount, 1);
}

// The initial compatibility scan is a migration-only operation. Once the cut
// is sealed, publication comparison and redacted inspection stay within the
// deterministic root/bucket/tuple namespace even amid large unrelated and
// malformed state.
{
  const state = { custody: Object.create(null) };
  const base = createMemoryAgentAuthorityCustodyStorage({ state });
  let scanCalls = 0;
  const storage = {
    ...base,
    async withOwnership(custodyId, operation) {
      return base.withOwnership(custodyId, (owner) => operation(Object.freeze({
        ...owner,
        async scanPartitions(options) {
          scanCalls += 1;
          return owner.scanPartitions(options);
        },
      })));
    },
  };
  const custodyId = 'agent:terminal-ledger-steady-local';
  const value = credential({ credentialGeneration: 39 });
  const fence = new AgentAuthorityFence(value, { storage, custodyId });
  await synchronizeValidated(fence, value);
  const migrationScanCalls = scanCalls;
  assert(migrationScanCalls > 0);
  for (let index = 0; index < 1_000; index += 1) {
    state.custody[`unrelated-steady-fixture:${index}`] = index % 2 === 0
      ? null
      : { malformed: true, revision: 'not-a-counter' };
  }
  const capture = fence.capture();
  assert.deepEqual(await fence.compareAndCommit(capture, () => 'committed'), {
    committed: true,
    value: 'committed',
  });
  assert.equal((await fence.inspectCustody()).witnessCount, 0);
  assert.equal(scanCalls, migrationScanCalls);
}

// If legacy migration itself overflows a fixed bucket, the exact current v1
// primary is journaled before the root's global closed state commits. Killing
// the migrator immediately after that root CAS leaves no mixed-version window
// in which an old reader can keep publishing the current tuple.
{
  const state = { custody: Object.create(null) };
  const custodyId = 'agent:terminal-ledger-mixed-close-crash';
  const activeValue = credential({ credentialGeneration: 34 });
  const seedStorage = createMemoryAgentAuthorityCustodyStorage({ state });
  const seed = new AgentAuthorityFence(activeValue, { storage: seedStorage, custodyId });
  await synchronizeValidated(seed, activeValue);
  const { terminalLedgerVersion: _, ...legacyPrimary } = state.custody[custodyId];
  state.custody[custodyId] = { ...legacyPrimary, formatVersion: 1 };
  for (const partition of Object.keys(state.custody)) {
    if (
      partition.startsWith('snapback.agent-terminal-ledger.v2:')
      || partition.startsWith('snapback.agent-terminal-bucket.v2:')
    ) delete state.custody[partition];
  }
  const addLegacyWitness = (value) => {
    const authority = new AgentAuthorityFence(value).authority;
    const authorityKey = canonicalAgentAuthorityKey(authority);
    const witnessId = `snapback.agent-terminal-witness.v1:${authorityKey}:${custodyId}`;
    state.custody[witnessId] = {
      formatVersion: 1,
      custodyId: witnessId,
      authorityEpoch: 0,
      revision: 2,
      phase: 'settled',
      status: 'deleted',
      authorityKey,
      authority,
      transition: null,
    };
    return witnessId;
  };
  addLegacyWitness(credential({ credentialGeneration: 35 }));
  addLegacyWitness(credential({ credentialGeneration: 36 }));

  let inject = true;
  const crashingStorage = createMemoryAgentAuthorityCustodyStorage({
    state,
    terminalLedgerParameters: { bucketCount: 1, bucketCapacity: 1 },
    async terminalLedgerCheckpoint(name) {
      if (inject && name === 'afterLedgerClosed') {
        inject = false;
        throw new Error('injected mixed-version crash after ledger close');
      }
    },
  });
  const crashing = new AgentAuthorityFence(activeValue, {
    storage: crashingStorage,
    custodyId,
  });
  await assert.rejects(
    synchronizeValidated(crashing, activeValue),
    /injected mixed-version crash after ledger close/,
  );
  const rootId = `snapback.agent-terminal-ledger.v2:${custodyId}`;
  assert.equal(state.custody[rootId].phase, 'closed');
  assert.equal(state.custody[rootId].legacyCut, false);
  assert.equal(state.custody[custodyId].formatVersion, 1);
  const activeKey = canonicalAgentAuthorityKey(new AgentAuthorityFence(activeValue).authority);
  const activeWitnessId = `snapback.agent-terminal-witness.v1:${activeKey}:${custodyId}`;
  assert.equal(state.custody[activeWitnessId].status, 'deleted');

  const recoveredStorage = createMemoryAgentAuthorityCustodyStorage({
    state,
    terminalLedgerParameters: { bucketCount: 1, bucketCapacity: 1 },
  });
  const recovered = new AgentAuthorityFence(activeValue, {
    storage: recoveredStorage,
    custodyId,
  });
  await assert.rejects(
    synchronizeValidated(recovered, activeValue),
    code('SNAPBACK_CLIENT_AUTHORITY_STALE'),
  );
  assert.equal(recoveredStorage.snapshot(custodyId).formatVersion, 2);
  assert.equal(recoveredStorage.snapshot(rootId).legacyCut, true);
  assert.equal(
    Object.keys(state.custody).some((partition) => (
      partition.startsWith('snapback.agent-terminal-witness.v1:')
      && partition.endsWith(`:${custodyId}`)
    )),
    false,
  );
}

// Diagnostics count only this custody's strict buckets. Another custody's
// valid bucket is ignored; a same-source bucket whose fixed parameters differ
// from the active root is corruption, not silently inflated telemetry.
{
  const state = { custody: Object.create(null) };
  const storage = createMemoryAgentAuthorityCustodyStorage({ state });
  const targetCustodyId = 'agent:terminal-ledger-diagnostics-target';
  const targetValue = credential({ credentialGeneration: 40 });
  const target = new AgentAuthorityFence(targetValue, {
    storage,
    custodyId: targetCustodyId,
  });
  await synchronizeValidated(target, targetValue);

  const otherCustodyId = 'agent:terminal-ledger-diagnostics-other';
  const otherValue = credential({ credentialGeneration: 41 });
  const other = new AgentAuthorityFence(otherValue, {
    storage,
    custodyId: otherCustodyId,
  });
  await synchronizeValidated(other, otherValue);
  const terminalOtherValue = credential({ credentialGeneration: 42 });
  const terminalOther = new AgentAuthorityFence(terminalOtherValue, {
    storage,
    custodyId: otherCustodyId,
  });
  const otherDeletion = terminalOther.terminateValidatedCredential(
    terminalOther.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  await otherDeletion.settlement;
  const otherBucketId = Object.keys(state.custody).find((partition) => (
    partition.startsWith('snapback.agent-terminal-bucket.v2:')
    && partition.endsWith(`:${otherCustodyId}`)
  ));
  assert(otherBucketId);
  state.custody[otherBucketId] = {
    ...state.custody[otherBucketId],
    sourceCustodyId: 'agent:structurally-corrupt-unrelated-source',
    unexpectedUnrelatedField: true,
  };
  assert.equal((await target.inspectCustody()).witnessCount, 0);

  const rogueValue = credential({ credentialGeneration: 43 });
  const rogueAuthority = new AgentAuthorityFence(rogueValue).authority;
  const rogueKey = canonicalAgentAuthorityKey(rogueAuthority);
  const rogueHashPrefix = Number.parseInt(
    rogueKey.slice('sha256:'.length, 'sha256:'.length + 8),
    16,
  );
  const relatedIndex = rogueHashPrefix % 64;
  const relatedId = `snapback.agent-terminal-bucket.v2:${relatedIndex}:${targetCustodyId}`;
  state.custody[relatedId] = {
    formatVersion: 1,
    recordType: 'agentTerminalBucket',
    custodyId: relatedId,
    sourceCustodyId: otherCustodyId,
    revision: 1,
    bucketIndex: relatedIndex,
    bucketCount: 64,
    bucketCapacity: 64,
    entries: [{ authorityKey: rogueKey, authority: rogueAuthority }],
  };
  await assert.rejects(
    target.inspectCustody(),
    code('SNAPBACK_AUTH_CUSTODY_CORRUPT'),
  );
  delete state.custody[relatedId];

  const rogueIndex = rogueHashPrefix % 2;
  const rogueId = `snapback.agent-terminal-bucket.v2:${rogueIndex}:${targetCustodyId}`;
  state.custody[rogueId] = {
    formatVersion: 1,
    recordType: 'agentTerminalBucket',
    custodyId: rogueId,
    sourceCustodyId: targetCustodyId,
    revision: 1,
    bucketIndex: rogueIndex,
    bucketCount: 2,
    bucketCapacity: 2,
    entries: [{ authorityKey: rogueKey, authority: rogueAuthority }],
  };
  await assert.rejects(
    target.inspectCustody(),
    code('SNAPBACK_AUTH_CUSTODY_CORRUPT'),
  );
}

// Partition scans are an explicitly bounded migration operation. A custom or
// in-memory store above the same 4,096-entry ceiling refuses before publishing
// a v2 primary, leaving a preparing root as fail-closed restart evidence.
{
  const state = { custody: Object.create(null) };
  for (let index = 0; index < 4_097; index += 1) {
    state.custody[`oversized-scan-fixture:${index}`] = null;
  }
  const storage = createMemoryAgentAuthorityCustodyStorage({ state });
  const custodyId = 'agent:terminal-ledger-scan-limit';
  const value = credential({ credentialGeneration: 50 });
  const fence = new AgentAuthorityFence(value, { storage, custodyId });
  await assert.rejects(
    synchronizeValidated(fence, value),
    code('SNAPBACK_AUTH_CUSTODY_PARTITION_SCAN_LIMIT'),
  );
  assert.equal(state.custody[custodyId], undefined);
  assert.equal(
    state.custody[`snapback.agent-terminal-ledger.v2:${custodyId}`].phase,
    'preparing',
  );
}

// A failure while consulting the tuple-specific terminal bucket is a custody
// read failure, not a harmless auxiliary miss. An already-open peer blanks and
// wedges before surfacing the storage error, so its prior capture cannot keep
// publishing after exclusion state becomes unknowable.
{
  const base = createMemoryAgentAuthorityCustodyStorage();
  const custodyId = 'agent:terminal-witness-read-failure';
  let failWitnessReads = false;
  const storage = {
    partitionOwnership: base.partitionOwnership,
    async withOwnership(partition, operation) {
      return base.withOwnership(partition, (owner) => operation(Object.freeze({
        ...owner,
        async withPartition(childPartition, childOperation) {
          if (
            failWitnessReads
            && childPartition.startsWith('snapback.agent-terminal-bucket.v2:')
          ) {
            throw new Error('injected terminal bucket read failure');
          }
          return owner.withPartition(childPartition, childOperation);
        },
      })));
    },
  };
  const value = credential();
  const fence = new AgentAuthorityFence(value, { storage, custodyId });
  let blanks = 0;
  fence.registerParticipant({
    quiesce() {},
    blank() { blanks += 1; },
    clearMemory() {},
    async commitDurable() {},
    async resume() {},
  });
  await synchronizeValidated(fence, value);
  const capture = fence.capture();
  const blanksBeforeFailure = blanks;
  failWitnessReads = true;
  await assert.rejects(
    synchronizeValidated(fence, value),
    /injected terminal bucket read failure/,
  );
  assert(blanks > blanksBeforeFailure, 'witness read failure blanks the open peer');
  assert.throws(() => fence.capture(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
  assert.equal(await fence.compareAndCommit(capture, () => assert.fail('stale commit ran')).then(
    (result) => result.committed,
  ), false);
}

await import('./agent-authority-filesystem.mjs');

console.log('PASS agent authority durable custody — restart, ABA, CAS, peer, wedge, terminal');
