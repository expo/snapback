// Durable headless-agent custody: restart, ABA, ambiguous commit, missed
// wakeup, terminal-disposition, and fail-closed barrier proof.

import assert from 'node:assert/strict';

import {
  AgentAuthorityFence,
  createMemoryAgentAuthorityCustodyStorage,
} from '../agent-authority.mjs';
import { deriveServiceAuthorityInstanceId } from '../../../packages/snapback-contract/auth-coordinator.mjs';

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
  bearerToken = `bearer:${grantId}:${tokenId}`,
} = {}) => ({
  actorUserId: ACTOR,
  credentialId: CREDENTIAL,
  credentialGeneration: 3,
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
  assert.deepEqual(order, ['quiesce', 'blank'], 'registration begins paused and blank');
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
    async withOwnership(custodyId, operation) {
      const result = await base.withOwnership(custodyId, operation);
      if (throwAfterCommit) {
        throwAfterCommit = false;
        const error = new Error('injected response loss after custody commit');
        error.code = 'TEST_AMBIGUOUS_AFTER_COMMIT';
        throw error;
      }
      return result;
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

// Epoch exhaustion is a synchronous confidentiality cut and never wraps or
// overwrites the maximum durable record.
{
  const state = { custody: Object.create(null) };
  const storage = createMemoryAgentAuthorityCustodyStorage({ state });
  const seed = new AgentAuthorityFence(credential(), { storage, custodyId: 'agent:max' });
  await synchronizeValidated(seed);
  state.custody['agent:max'] = {
    ...storage.snapshot('agent:max'),
    authorityEpoch: Number.MAX_SAFE_INTEGER,
  };
  const exhausted = new AgentAuthorityFence(credential(), { storage, custodyId: 'agent:max' });
  await synchronizeValidated(exhausted);
  assert.throws(
    () => replaceValidated(exhausted, credential({ grantId: GRANT_B, tokenId: TOKEN_B })),
    code('SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED'),
  );
  assert.throws(() => exhausted.capture(), code('SNAPBACK_CLIENT_AUTHORITY_STALE'));
  assert.equal(storage.snapshot('agent:max').authorityEpoch, Number.MAX_SAFE_INTEGER);
  assert.equal(storage.snapshot('agent:max').status, 'active');
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
  const seed = new AgentAuthorityFence(credential(), {
    storage,
    custodyId: 'agent:revision-max',
  });
  await synchronizeValidated(seed);
  state.custody['agent:revision-max'] = {
    ...storage.snapshot('agent:revision-max'),
    revision: Number.MAX_SAFE_INTEGER,
  };
  const exhausted = new AgentAuthorityFence(credential(), {
    storage,
    custodyId: 'agent:revision-max',
  });
  await synchronizeValidated(exhausted);
  const lastCapture = exhausted.capture();
  assert.throws(
    () => replaceValidated(exhausted, credential({ grantId: GRANT_B, tokenId: TOKEN_B })),
    code('SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED'),
  );
  assert.equal(exhausted.isCurrent(lastCapture), false);
  assert.equal(storage.snapshot('agent:revision-max').revision, Number.MAX_SAFE_INTEGER);
  assert.equal(storage.snapshot('agent:revision-max').status, 'active');
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

await import('./agent-authority-filesystem.mjs');

console.log('PASS agent authority durable custody — restart, ABA, CAS, peer, wedge, terminal');
