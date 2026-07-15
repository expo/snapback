// LLP 0059 item-5 browser custody and local barrier conformance.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  AuthCoordinator,
  authAppIdHash,
  canonicalAuthorityKey,
  createMemoryAuthCustodyStorage,
  SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
  validateAuthCustody,
} from './auth-coordinator.mjs';

const APP = 'snapback.test/auth-coordinator';
const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const SESSION_A = '018f0d90-7b12-7a22-8c33-445566778899';
const SESSION_B = '018f0d90-7b13-7a22-8c33-445566778899';
const USER_A = '018f0d90-7b14-7a22-8c33-445566778899';
const USER_B = '018f0d90-7b15-7a22-8c33-445566778899';
const BEARER_SENTINEL = 'sbs_CLIENT_BEARER_SECRET_SENTINEL_MUST_NOT_ESCAPE';

const anonymous = (authMode = 'sessions') => ({
  kind: 'anonymous',
  authMode,
  authorizationStreamIncarnation: INCARNATION,
});

const session = (sessionId = SESSION_A, userId = USER_A) => ({
  kind: 'session',
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
  sessionId,
  userId,
});

const successor = (authority, bearer = null, refreshAfterMs = null) => ({
  authority,
  bearer,
  refreshAfterMs,
});

const transitionIdForTest = (predecessorRevision, nextEpoch, nextAuthorityKey) => (
  `sha256:${createHash('sha256')
    .update(
      `snapback.auth-transition.v1\n${APP}\n${predecessorRevision}\n${nextEpoch}\n${nextAuthorityKey}`,
      'utf8',
    )
    .digest('hex')}`
);

const errorCode = async (operation) => {
  try {
    await operation();
  } catch (error) {
    return error.code ?? error.diagnostic?.code;
  }
  assert.fail('expected operation to fail');
};

class BroadcastHub {
  channels = new Map();
  messages = [];

  factory = (name) => {
    const channel = {
      name,
      onmessage: null,
      postMessage: (message) => {
        this.messages.push(structuredClone(message));
        for (const peer of this.channels.get(name) ?? []) {
          if (peer !== channel) peer.onmessage?.({ data: structuredClone(message) });
        }
      },
      close: () => this.channels.get(name)?.delete(channel),
    };
    if (!this.channels.has(name)) this.channels.set(name, new Set());
    this.channels.get(name).add(channel);
    return channel;
  };
}

const hintBytes = new Map();
const hintStorage = {
  setItem(key, value) { hintBytes.set(key, value); },
};

// Authority keys are a closed byte protocol, not generic object canonicalization.
{
  const authority = session();
  const exactJson = JSON.stringify({
    appId: APP,
    kind: 'session',
    authMode: 'sessions',
    authorizationStreamIncarnation: INCARNATION,
    sessionId: SESSION_A,
    userId: USER_A,
  });
  const expected = createHash('sha256')
    .update(`snapback.auth-authority.v1\n${exactJson}`, 'utf8')
    .digest('hex');
  assert.equal(canonicalAuthorityKey(APP, authority), `sha256:${expected}`);
  assert.equal(
    authAppIdHash(APP),
    createHash('sha256').update(`snapback.auth-app.v1\n${APP}`, 'utf8').digest('hex'),
  );
  assert.notEqual(canonicalAuthorityKey(APP, anonymous('dev')), canonicalAuthorityKey(APP, anonymous('sessions')));
}

// The durable record is closed and fails blank on malformed authority/bearer combinations.
{
  const valid = {
    formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
    appId: APP,
    authorityEpoch: 0,
    revision: 1,
    phase: 'settled',
    authority: anonymous(),
    pendingAuthority: null,
    bearer: null,
    pendingBearer: null,
    refreshAfterMs: null,
    transitionIntent: null,
  };
  assert.deepEqual(validateAuthCustody(valid, APP), valid);
  assert.throws(
    () => validateAuthCustody({ ...valid, bearer: 'secret' }, APP),
    { code: 'SNAPBACK_AUTH_CUSTODY_CORRUPT' },
  );
  assert.throws(
    () => validateAuthCustody({ ...valid, revision: Number.MAX_SAFE_INTEGER + 1 }, APP),
    { code: 'SNAPBACK_AUTH_CUSTODY_CORRUPT' },
  );
  assert.throws(
    () => validateAuthCustody({ ...valid, unknown: true }, APP),
    { code: 'SNAPBACK_AUTH_CUSTODY_CORRUPT' },
  );
  assert.throws(
    () => validateAuthCustody({
      ...valid,
      authority: { ...anonymous(), unknown: true },
    }, APP),
    { code: 'SNAPBACK_AUTH_CUSTODY_CORRUPT' },
  );
  assert.throws(
    () => validateAuthCustody({
      ...valid,
      authority: session(),
      bearer: 'secret',
      refreshAfterMs: -1,
    }, APP),
    { code: 'SNAPBACK_AUTH_CUSTODY_CORRUPT' },
  );
  assert.throws(
    () => validateAuthCustody({
      ...valid,
      phase: 'clearing',
      authority: null,
      pendingAuthority: anonymous(),
    }, APP),
    { code: 'SNAPBACK_AUTH_CUSTODY_CORRUPT' },
  );

  const previousAuthority = anonymous();
  const nextAuthority = session();
  const expectedAuthorityKey = canonicalAuthorityKey(APP, previousAuthority);
  const nextAuthorityKey = canonicalAuthorityKey(APP, nextAuthority);
  const transitionIntent = {
    formatVersion: 1,
    transitionId: transitionIdForTest(1, 1, nextAuthorityKey),
    expectedEpoch: 0,
    expectedAuthorityKey,
    nextEpoch: 1,
    nextAuthorityKey,
    reason: 'validation_fixture',
    disposition: 'delete',
    previousAuthority,
    nextAuthority,
  };
  const clearing = {
    ...valid,
    authorityEpoch: 1,
    revision: 2,
    phase: 'clearing',
    authority: null,
    pendingAuthority: nextAuthority,
    pendingBearer: 'fixture-bearer',
    refreshAfterMs: 10_000,
    transitionIntent,
  };
  assert.deepEqual(validateAuthCustody(clearing, APP), clearing);
  const settled = {
    ...clearing,
    revision: 3,
    phase: 'settled',
    authority: nextAuthority,
    pendingAuthority: null,
    bearer: 'fixture-bearer',
    pendingBearer: null,
  };
  assert.deepEqual(validateAuthCustody(settled, APP), settled);
  assert.throws(
    () => validateAuthCustody({
      ...settled,
      authorityEpoch: 2,
      revision: 4,
    }, APP),
    { code: 'SNAPBACK_AUTH_CUSTODY_CORRUPT' },
    'the retained intent successor epoch must equal the settled record epoch',
  );
  assert.throws(
    () => validateAuthCustody({
      ...clearing,
      transitionIntent: {
        ...transitionIntent,
        previousAuthority: anonymous('dev'),
      },
    }, APP),
    { code: 'SNAPBACK_AUTH_CUSTODY_CORRUPT' },
    'the predecessor authority must derive its embedded expected key',
  );
  assert.throws(
    () => validateAuthCustody({
      ...clearing,
      transitionIntent: {
        ...transitionIntent,
        nextAuthority: session(SESSION_B, USER_B),
      },
    }, APP),
    { code: 'SNAPBACK_AUTH_CUSTODY_CORRUPT' },
    'the successor authority must derive its embedded next key',
  );
  assert.throws(
    () => validateAuthCustody({
      ...clearing,
      transitionIntent: {
        ...transitionIntent,
        transitionId: `sha256:${'0'.repeat(64)}`,
      },
    }, APP),
    { code: 'SNAPBACK_AUTH_CUSTODY_CORRUPT' },
    'a clearing record binds the derivable transition identifier',
  );
  assert.throws(
    () => validateAuthCustody({
      ...settled,
      transitionIntent: {
        ...transitionIntent,
        transitionId: `sha256:${'0'.repeat(64)}`,
      },
    }, APP),
    { code: 'SNAPBACK_AUTH_CUSTODY_CORRUPT' },
    'an unrotated settled record also binds its derivable transition identifier',
  );
}

// Memory adapters cannot confuse a canonical app id with an object prototype
// setter or inherited property.
{
  const state = { custody: {} };
  const protoCoordinator = new AuthCoordinator({
    appId: '__proto__',
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await protoCoordinator.establishAnonymous(anonymous());
  assert.equal(Object.hasOwn(state.custody, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(state.custody), Object.prototype);
  assert.equal(state.custody.__proto__.appId, '__proto__');
  await protoCoordinator.close();
}

// A peer rejects a structurally valid retained intent whose successor differs
// from the containing settled authority, before any physical-store phase runs.
{
  const state = { custody: {} };
  const writer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const peer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const anonymousCapture = await writer.establishAnonymous(anonymous());
  await peer.synchronize();
  const peerCapture = peer.capture();
  await writer.transition(
    anonymousCapture,
    successor(session(), 'peer-fixture-bearer', 10_000),
    'peer_fixture',
  );
  const corruptSuccessor = session(SESSION_B, USER_B);
  const corruptSuccessorKey = canonicalAuthorityKey(APP, corruptSuccessor);
  state.custody[APP].transitionIntent = {
    ...state.custody[APP].transitionIntent,
    transitionId: transitionIdForTest(1, 1, corruptSuccessorKey),
    nextAuthorityKey: corruptSuccessorKey,
    nextAuthority: corruptSuccessor,
  };
  const phases = [];
  peer.registerParticipant({
    name: 'must-not-adopt-corrupt-intent',
    async quiesce() { phases.push('quiesce'); },
    blank() { phases.push('blank'); },
    clearMemory() { phases.push('clearMemory'); },
    async commitDurable() { phases.push('commitDurable'); },
    async resume() { phases.push('resume'); },
  });
  assert.equal(
    await errorCode(() => peer.synchronize()),
    'SNAPBACK_AUTH_CUSTODY_CORRUPT',
  );
  assert.deepEqual(peer.capture(), peerCapture, 'the peer did not adopt the corrupt successor');
  assert.deepEqual(phases, [], 'no peer barrier phase trusted the corrupt intent');
  await peer.close();
  await writer.close();
}

const shared = { custody: {} };
const storage = createMemoryAuthCustodyStorage({ state: shared });
const hub = new BroadcastHub();
const coordinator = new AuthCoordinator({
  appId: APP,
  storage,
  broadcastChannelFactory: hub.factory,
  hintStorage,
});

assert.equal(await errorCode(() => Promise.resolve(coordinator.capture())), 'SNAPBACK_CLIENT_AUTHORITY_CLEARING');
assert.equal(
  await errorCode(() => coordinator.establishAnonymous(session())),
  'SNAPBACK_AUTH_CUSTODY_BOOTSTRAP_INVALID',
);
const anonymousCapture = await coordinator.establishAnonymous(anonymous());
assert.deepEqual(anonymousCapture, {
  authorityEpoch: 0,
  custodyRevision: 1,
  authorityKey: canonicalAuthorityKey(APP, anonymous()),
});

// Broadcast bytes are a closed, secret-free wakeup protocol. A valid-looking
// clearing message with any extra field cannot synchronously pause publication.
for (const channels of hub.channels.values()) {
  for (const channel of channels) {
    channel.onmessage?.({ data: {
      formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
      appIdHash: authAppIdHash(APP),
      authorityEpoch: 1,
      revision: 2,
      phase: 'clearing',
      bearer: 'must-be-rejected',
    } });
  }
}
assert.deepEqual(coordinator.capture(), anonymousCapture);

// All participant phases are deterministic; visibility blanks before durable
// deletion, and resume runs in reverse registration order only after settle.
{
  const log = [];
  const participant = (name) => ({
    name,
    async quiesce(ctx) { log.push(`${name}:quiesce:${ctx.nextEpoch}`); },
    blank(ctx) { log.push(`${name}:blank:${ctx.nextEpoch}`); },
    clearMemory(ctx) { log.push(`${name}:clearMemory:${ctx.nextEpoch}`); },
    async commitDurable(ctx) {
      log.push(`${name}:commitDurable:${ctx.expectedEpoch}->${ctx.nextEpoch}`);
      assert.equal(storage.snapshot(APP).phase, 'clearing');
      assert.equal(await errorCode(() => Promise.resolve(coordinator.capture())), 'SNAPBACK_CLIENT_AUTHORITY_CLEARING');
    },
    async resume(ctx) {
      log.push(`${name}:resume:${ctx.capture.authorityEpoch}`);
      assert.equal(storage.snapshot(APP).phase, 'settled');
    },
  });
  const unregisterA = coordinator.registerParticipant(participant('a'));
  const unregisterB = coordinator.registerParticipant(participant('b'));
  const sessionCapture = await coordinator.transition(
    anonymousCapture,
    successor(session(), BEARER_SENTINEL, 10_000),
    'login',
  );
  assert.deepEqual(log, [
    'a:quiesce:1',
    'b:quiesce:1',
    'a:blank:1',
    'b:blank:1',
    'a:clearMemory:1',
    'b:clearMemory:1',
    'a:commitDurable:0->1',
    'b:commitDurable:0->1',
    'b:resume:1',
    'a:resume:1',
  ]);
  assert.equal(sessionCapture.authorityEpoch, 1);
  assert.equal(Object.hasOwn(coordinator.settledView(), 'bearer'), false);
  assert.equal(storage.snapshot(APP).bearer, BEARER_SENTINEL);
  assert.equal(JSON.stringify(sessionCapture).includes(BEARER_SENTINEL), false);
  assert.equal(JSON.stringify(coordinator.settledView()).includes(BEARER_SENTINEL), false);
  assert.equal((await coordinator.compareAndCommit(anonymousCapture, () => 'late')).committed, false);
  assert.deepEqual(await coordinator.compareAndClear(anonymousCapture, 'late_terminal'), { cleared: false });
  await unregisterA();
  await unregisterB();
}

// Resume may perform a mandatory durable-authority reload after cross-context
// ownership is released. Reloading the exact locally settled successor must
// confirm the capture without recursively replacing and replaying the active
// barrier.
// @ref LLP 0059#cross-context-ownership — exact local successor reloads are
// fenced checks inside the still-closed exposure barrier, not peer adoption.
{
  const reentrant = new AuthCoordinator({
    appId: `${APP}/resume-reload`,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await reentrant.establishAnonymous(anonymous());
  let resumeCalls = 0;
  const unregister = reentrant.registerParticipant({
    name: 'resume-durable-reload',
    async quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() {},
    async resume(context) {
      resumeCalls += 1;
      assert.equal(resumeCalls, 1, 'exact successor reload must not recurse into resume');
      assert.deepEqual(await reentrant.synchronize(), context.capture);
    },
  });
  const after = await reentrant.transition(
    before,
    successor(session(), BEARER_SENTINEL, 10_000),
    'resume_reload',
  );
  assert.equal(after.authorityEpoch, 1);
  assert.equal(resumeCalls, 1);
  await unregister();
  await reentrant.close();
}

// The same exact-reload rule applies while a peer context is adopting a
// successor it learned from durable custody rather than owning the transition.
{
  const sharedResumeState = { custody: {} };
  const writer = new AuthCoordinator({
    appId: `${APP}/peer-resume-reload`,
    storage: createMemoryAuthCustodyStorage({ state: sharedResumeState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const peer = new AuthCoordinator({
    appId: `${APP}/peer-resume-reload`,
    storage: createMemoryAuthCustodyStorage({ state: sharedResumeState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await writer.establishAnonymous(anonymous());
  await peer.synchronize();
  let resumeCalls = 0;
  peer.registerParticipant({
    name: 'peer-resume-durable-reload',
    async quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() {},
    async resume(context) {
      resumeCalls += 1;
      assert.equal(resumeCalls, 1, 'peer successor reload must not recurse into resume');
      assert.deepEqual(await peer.synchronize(), context.capture);
    },
  });
  const settled = await writer.transition(
    before,
    successor(session(), BEARER_SENTINEL, 10_000),
    'peer_resume_reload',
  );
  assert.deepEqual(await peer.synchronize(), settled);
  assert.equal(resumeCalls, 1);
  await peer.close();
  await writer.close();
}

// If a different context advances durable custody during owner resume, the
// original barrier aborts closed. It neither adopts the peer inside that
// barrier nor returns its obsolete successor capture.
{
  const state = { custody: {} };
  const appId = `${APP}/owner-resume-race`;
  const owner = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const peer = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await owner.establishAnonymous(anonymous());
  await peer.synchronize();
  let peerSuccessor = null;
  let resumeCalls = 0;
  const unregister = owner.registerParticipant({
    name: 'owner-resume-race',
    async quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() {},
    async resume() {
      resumeCalls += 1;
      const ownerSuccessor = await peer.synchronize();
      peerSuccessor = await peer.transition(
        ownerSuccessor,
        successor(session(SESSION_B, USER_B), 'bearer-owner-race-peer', 20_000),
        'owner_resume_peer_advance',
      );
    },
  });
  assert.equal(
    await errorCode(() => owner.transition(
      before,
      successor(session(SESSION_A, USER_A), 'bearer-owner-race', 10_000),
      'owner_resume_race',
    )),
    'SNAPBACK_AUTH_TRANSITION_FAILED',
  );
  assert.equal(resumeCalls, 1);
  assert.equal(await errorCode(() => Promise.resolve(owner.capture())), 'SNAPBACK_CLIENT_AUTHORITY_CLEARING');
  await unregister();
  assert.deepEqual(await owner.synchronize(), peerSuccessor);
  await peer.close();
  await owner.close();
}

// A peer-adoption resume has the same changed-durable outcome: one failed
// resume, no nested adoption, then a later clean synchronization of the exact
// current successor.
{
  const state = { custody: {} };
  const appId = `${APP}/peer-resume-race`;
  const writer = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const peer = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await writer.establishAnonymous(anonymous());
  await peer.synchronize();
  const firstSuccessor = await writer.transition(
    before,
    successor(session(SESSION_A, USER_A), 'bearer-peer-race', 10_000),
    'peer_resume_first_successor',
  );
  let finalSuccessor = null;
  let resumeCalls = 0;
  const unregister = peer.registerParticipant({
    name: 'peer-resume-race',
    async quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() {},
    async resume() {
      resumeCalls += 1;
      finalSuccessor = await writer.transition(
        firstSuccessor,
        successor(session(SESSION_B, USER_B), 'bearer-peer-race-final', 20_000),
        'peer_resume_second_successor',
      );
    },
  });
  assert.equal(
    await errorCode(() => peer.synchronize()),
    'SNAPBACK_CLIENT_AUTHORITY_STALE',
  );
  assert.equal(resumeCalls, 1);
  assert.equal(await errorCode(() => Promise.resolve(peer.capture())), 'SNAPBACK_CLIENT_AUTHORITY_CLEARING');
  await unregister();
  assert.deepEqual(await peer.synchronize(), finalSuccessor);
  await peer.close();
  await writer.close();
}

// A synchronization may finish its storage callback before a transition, yet
// have its promise delivery delayed until successor resume. The already-read
// predecessor capture is stale at completion and cannot escape the closed
// barrier.
{
  const baseStorage = createMemoryAuthCustodyStorage();
  let delayNextCompletion = false;
  let reloadReadResolve;
  let releaseReloadResolve;
  const reloadRead = new Promise((resolve) => { reloadReadResolve = resolve; });
  const releaseReload = new Promise((resolve) => { releaseReloadResolve = resolve; });
  const delayedStorage = {
    ...baseStorage,
    async withOwnership(appId, operation) {
      const result = await baseStorage.withOwnership(appId, operation);
      if (!delayNextCompletion) return result;
      delayNextCompletion = false;
      reloadReadResolve();
      await releaseReload;
      return result;
    },
  };
  const delayed = new AuthCoordinator({
    appId: `${APP}/pre-barrier-reload`,
    storage: delayedStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await delayed.establishAnonymous(anonymous());
  delayNextCompletion = true;
  const staleReload = delayed.synchronize();
  await reloadRead;

  let resumeEnteredResolve;
  let releaseResumeResolve;
  const resumeEntered = new Promise((resolve) => { resumeEnteredResolve = resolve; });
  const releaseResume = new Promise((resolve) => { releaseResumeResolve = resolve; });
  const unregister = delayed.registerParticipant({
    name: 'hold-successor-resume',
    async resume() {
      resumeEnteredResolve();
      await releaseResume;
    },
  });
  const transition = delayed.transition(
    before,
    successor(session(), BEARER_SENTINEL, 10_000),
    'pre_barrier_reload_completion',
  );
  await resumeEntered;
  releaseReloadResolve();
  assert.equal(await errorCode(() => staleReload), 'SNAPBACK_CLIENT_AUTHORITY_STALE');
  assert.equal(await errorCode(() => Promise.resolve(delayed.capture())), 'SNAPBACK_CLIENT_AUTHORITY_CLEARING');
  releaseResumeResolve();
  const settled = await transition;
  assert.deepEqual(delayed.capture(), settled);
  await unregister();
  await delayed.close();
}

// The same old read remains stale when promise delivery is delayed until
// after the entire successor barrier has completed and activeBarrier is gone.
{
  const baseStorage = createMemoryAuthCustodyStorage();
  let delayNextCompletion = false;
  let reloadReadResolve;
  let releaseReloadResolve;
  const reloadRead = new Promise((resolve) => { reloadReadResolve = resolve; });
  const releaseReload = new Promise((resolve) => { releaseReloadResolve = resolve; });
  const delayedStorage = {
    ...baseStorage,
    async withOwnership(appId, operation) {
      const result = await baseStorage.withOwnership(appId, operation);
      if (!delayNextCompletion) return result;
      delayNextCompletion = false;
      reloadReadResolve();
      await releaseReload;
      return result;
    },
  };
  const delayed = new AuthCoordinator({
    appId: `${APP}/post-barrier-reload`,
    storage: delayedStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await delayed.establishAnonymous(anonymous());
  delayNextCompletion = true;
  const staleReload = delayed.synchronize();
  await reloadRead;
  const settled = await delayed.transition(
    before,
    successor(session(), BEARER_SENTINEL, 10_000),
    'post_barrier_reload_completion',
  );
  assert.deepEqual(delayed.capture(), settled);
  releaseReloadResolve();
  assert.equal(await errorCode(() => staleReload), 'SNAPBACK_CLIENT_AUTHORITY_STALE');
  assert.equal(await errorCode(() => Promise.resolve(delayed.capture())), 'SNAPBACK_CLIENT_AUTHORITY_CLEARING');
  assert.deepEqual(await delayed.synchronize(), settled);
  await delayed.close();
}

// A dropped wakeup cannot let a direct A read escape after another context
// durably settles B while the first ownership result is in delivery.
{
  const state = { custody: {} };
  const appId = `${APP}/missed-direct-final-confirm`;
  const writer = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const baseStorage = createMemoryAuthCustodyStorage({ state });
  let delayNext = false;
  let readResolve;
  let releaseResolve;
  const read = new Promise((resolve) => { readResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const delayedStorage = {
    ...baseStorage,
    async withOwnership(ownedAppId, operation) {
      const result = await baseStorage.withOwnership(ownedAppId, operation);
      if (!delayNext) return result;
      delayNext = false;
      readResolve();
      await release;
      return result;
    },
  };
  const peer = new AuthCoordinator({
    appId,
    storage: delayedStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await writer.establishAnonymous(anonymous());
  assert.deepEqual(await peer.synchronize(), before);
  delayNext = true;
  const stale = peer.synchronize();
  await read;
  const successorCapture = await writer.transition(
    before,
    successor(session(), 'bearer-missed-direct', 10_000),
    'missed_direct_final_confirm',
  );
  releaseResolve();
  assert.equal(await errorCode(() => stale), 'SNAPBACK_CLIENT_AUTHORITY_STALE');
  assert.equal(await errorCode(() => Promise.resolve(peer.capture())), 'SNAPBACK_CLIENT_AUTHORITY_CLEARING');
  assert.deepEqual(await peer.synchronize(), successorCapture);
  await peer.close();
  await writer.close();
}

// Null is also an exact custody result. A delayed empty-store read cannot
// return after another context establishes the first durable authority.
{
  const state = { custody: {} };
  const appId = `${APP}/null-final-confirm`;
  const writer = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const baseStorage = createMemoryAuthCustodyStorage({ state });
  let readResolve;
  let releaseResolve;
  const read = new Promise((resolve) => { readResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  let delayNext = true;
  const peer = new AuthCoordinator({
    appId,
    storage: {
      ...baseStorage,
      async withOwnership(ownedAppId, operation) {
        const result = await baseStorage.withOwnership(ownedAppId, operation);
        if (!delayNext) return result;
        delayNext = false;
        readResolve();
        await release;
        return result;
      },
    },
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const staleNull = peer.synchronize();
  await read;
  const established = await writer.establishAnonymous(anonymous());
  releaseResolve();
  assert.equal(await errorCode(() => staleNull), 'SNAPBACK_CLIENT_AUTHORITY_STALE');
  assert.deepEqual(await peer.synchronize(), established);
  await peer.close();
  await writer.close();
}

// The peer-adoption marker is equally provisional: B read after local A may
// not be adopted if a missed-broadcast writer settles C before delivery.
{
  const state = { custody: {} };
  const appId = `${APP}/missed-adoption-final-confirm`;
  const writer = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const baseStorage = createMemoryAuthCustodyStorage({ state });
  let delayNext = false;
  let readResolve;
  let releaseResolve;
  const read = new Promise((resolve) => { readResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const delayedStorage = {
    ...baseStorage,
    async withOwnership(ownedAppId, operation) {
      const result = await baseStorage.withOwnership(ownedAppId, operation);
      if (!delayNext) return result;
      delayNext = false;
      readResolve();
      await release;
      return result;
    },
  };
  const peer = new AuthCoordinator({
    appId,
    storage: delayedStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const first = await writer.establishAnonymous(anonymous());
  await peer.synchronize();
  const second = await writer.transition(
    first,
    successor(session(SESSION_A, USER_A), 'bearer-adoption-b', 10_000),
    'missed_adoption_b',
  );
  delayNext = true;
  const stale = peer.synchronize();
  await read;
  const third = await writer.transition(
    second,
    successor(session(SESSION_B, USER_B), 'bearer-adoption-c', 20_000),
    'missed_adoption_c',
  );
  releaseResolve();
  assert.equal(await errorCode(() => stale), 'SNAPBACK_CLIENT_AUTHORITY_STALE');
  assert.equal(await errorCode(() => Promise.resolve(peer.capture())), 'SNAPBACK_CLIENT_AUTHORITY_CLEARING');
  assert.deepEqual(await peer.synchronize(), third);
  await peer.close();
  await writer.close();
}

// Failed local clearing retains a phase-aware fingerprint. After a peer
// recovers durable custody, the original context can synchronize normally
// instead of canonicalizing clearing.authority (which is necessarily null).
{
  const state = { custody: {} };
  const appId = `${APP}/clearing-local-recovery`;
  const owner = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const peer = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await owner.establishAnonymous(anonymous());
  let failQuiesce = true;
  const unregister = owner.registerParticipant({
    name: 'fail-clearing-once',
    async quiesce() {
      if (failQuiesce) {
        failQuiesce = false;
        throw Object.assign(new Error('fail quiesce once'), { code: 'TEST_QUIESCE_FAILED' });
      }
    },
  });
  let transitionError = null;
  try {
    await owner.transition(
      before,
      successor(session(), 'bearer-clearing-recovery', 10_000),
      'clearing_local_recovery',
    );
  } catch (error) {
    transitionError = error;
  }
  assert.equal(transitionError?.code, 'SNAPBACK_AUTH_TRANSITION_FAILED');
  assert.equal(transitionError?.diagnostic?.details?.phase, 'quiesce');
  const recovered = await peer.synchronize();
  assert.deepEqual(await owner.synchronize(), recovered);
  await unregister();
  await peer.close();
  await owner.close();
}

// Failure of the final durable read is itself a mandatory-gate failure: the
// prior local capture is blanked and remains unavailable until a clean sync.
{
  const baseStorage = createMemoryAuthCustodyStorage();
  let confirmationFailureArmed = false;
  let armedCalls = 0;
  const failingStorage = {
    ...baseStorage,
    async withOwnership(appId, operation) {
      if (confirmationFailureArmed) {
        armedCalls += 1;
        if (armedCalls === 2) {
          confirmationFailureArmed = false;
          throw Object.assign(new Error('confirmation read failed'), { code: 'TEST_CONFIRM_READ_FAILED' });
        }
      }
      return baseStorage.withOwnership(appId, operation);
    },
  };
  const coordinator = new AuthCoordinator({
    appId: `${APP}/confirmation-read-failure`,
    storage: failingStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await coordinator.establishAnonymous(anonymous());
  confirmationFailureArmed = true;
  armedCalls = 0;
  assert.equal(await errorCode(() => coordinator.synchronize()), 'TEST_CONFIRM_READ_FAILED');
  assert.equal(
    await errorCode(() => Promise.resolve(coordinator.capture())),
    'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
  );
  await coordinator.synchronize();
  await coordinator.close();
}

// Revision is part of exact confirmation even when authority is unchanged.
{
  const state = { custody: {} };
  const appId = `${APP}/same-authority-revision-confirm`;
  const writer = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const baseStorage = createMemoryAuthCustodyStorage({ state });
  let delayNext = false;
  let readResolve;
  let releaseResolve;
  const read = new Promise((resolve) => { readResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const peer = new AuthCoordinator({
    appId,
    storage: {
      ...baseStorage,
      async withOwnership(ownedAppId, operation) {
        const result = await baseStorage.withOwnership(ownedAppId, operation);
        if (!delayNext) return result;
        delayNext = false;
        readResolve();
        await release;
        return result;
      },
    },
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const anonymousCapture = await writer.establishAnonymous(anonymous());
  const first = await writer.transition(
    anonymousCapture,
    successor(session(), 'bearer-revision-one', 10_000),
    'same_authority_revision_setup',
  );
  await peer.synchronize();
  delayNext = true;
  const stale = peer.synchronize();
  await read;
  const rotated = await writer.compareAndRotateBearer(first, {
    bearer: 'bearer-revision-two',
    refreshAfterMs: 20_000,
  });
  assert.equal(rotated.rotated, true);
  releaseResolve();
  assert.equal(await errorCode(() => stale), 'SNAPBACK_CLIENT_AUTHORITY_STALE');
  assert.deepEqual(await peer.synchronize(), rotated.capture);
  await peer.close();
  await writer.close();
}

// A same-authority credential write from inside resume may update durable
// custody, but it cannot reopen local publication. The outer exact revision
// confirmation then aborts closed and a clean synchronization adopts it.
{
  const storage = createMemoryAuthCustodyStorage();
  const coordinator = new AuthCoordinator({
    appId: `${APP}/reentrant-same-authority-exposure`,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const anonymousCapture = await coordinator.establishAnonymous(anonymous());
  let rotatedCapture = null;
  const unregister = coordinator.registerParticipant({
    name: 'rotate-during-resume',
    async resume(context) {
      if (rotatedCapture !== null) return;
      const rotated = await coordinator.compareAndRotateBearer(context.capture, {
        bearer: 'bearer-reentrant-rotation',
        refreshAfterMs: 30_000,
      });
      assert.equal(rotated.rotated, true);
      rotatedCapture = rotated.capture;
      assert.equal(
        await errorCode(() => Promise.resolve(coordinator.capture())),
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
      );
    },
  });
  assert.equal(
    await errorCode(() => coordinator.transition(
      anonymousCapture,
      successor(session(), 'bearer-before-reentrant-rotation', 10_000),
      'reentrant_same_authority_exposure',
    )),
    'SNAPBACK_AUTH_TRANSITION_FAILED',
  );
  assert.deepEqual(await coordinator.synchronize(), rotatedCapture);
  await unregister();
  await coordinator.close();
}

// Same-authority bearer rotation changes the custody revision, not app
// authority. Ordinary work captured before rotation remains current, while a
// second credential write must compare the exact old revision and loses.
{
  const before = coordinator.capture();
  const rotated = await coordinator.compareAndRotateBearer(before, {
    bearer: 'bearer-b',
    refreshAfterMs: 20_000,
  });
  assert.equal(rotated.rotated, true);
  assert.equal(rotated.capture.authorityEpoch, before.authorityEpoch);
  assert.equal(rotated.capture.custodyRevision, before.custodyRevision + 1);
  assert.equal(coordinator.isCurrent(before), true);
  assert.deepEqual(await coordinator.compareAndCommit(before, (view) => view.bearer), {
    committed: true,
    value: 'bearer-b',
  });
  assert.deepEqual(await coordinator.compareAndRotateBearer(before, {
    bearer: 'bearer-late',
    refreshAfterMs: 30_000,
  }), { rotated: false });
  assert.equal(
    await errorCode(() => coordinator.compareAndCommit(rotated.capture, () => coordinator.capture())),
    'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT',
  );
  assert.equal(
    await errorCode(() => coordinator.compareAndCommit(rotated.capture, async () => 'not-sync')),
    'SNAPBACK_CLIENT_AUTH_COMMIT_ASYNC',
  );
}

// A participant crash leaves durable custody in clearing. Recovery reruns the
// barrier from the exact clearing revision; no predecessor capture is exposed.
{
  let failOnce = true;
  const phases = [];
  const unregister = coordinator.registerParticipant({
    name: 'crash-once',
    async quiesce() { phases.push('quiesce'); },
    blank() { phases.push('blank'); },
    clearMemory() { phases.push('clearMemory'); },
    async commitDurable() {
      phases.push('commitDurable');
      if (failOnce) {
        failOnce = false;
        throw new Error('simulated participant crash');
      }
    },
    async resume() { phases.push('resume'); },
  });
  const before = coordinator.capture();
  assert.equal(
    await errorCode(() => coordinator.transition(
      before,
      successor(session(SESSION_B, USER_B), 'bearer-user-b', 40_000),
      'switch_user',
    )),
    'SNAPBACK_AUTH_TRANSITION_FAILED',
  );
  assert.equal(storage.snapshot(APP).phase, 'clearing');
  assert.equal(await errorCode(() => Promise.resolve(coordinator.capture())), 'SNAPBACK_CLIENT_AUTHORITY_CLEARING');
  const recovered = await coordinator.synchronize();
  assert.equal(recovered.authorityEpoch, before.authorityEpoch + 1);
  assert.equal(storage.snapshot(APP).phase, 'settled');
  assert.deepEqual(phases, [
    'quiesce', 'blank', 'clearMemory', 'commitDurable',
    'quiesce', 'blank', 'clearMemory', 'commitDurable', 'resume',
  ]);
  await unregister();
}

// A peer's clearing broadcast stops new work synchronously. Durable reload,
// not the message, determines the successor and resumes the second context.
{
  const peer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: shared }),
    broadcastChannelFactory: hub.factory,
    hintStorage,
  });
  await peer.synchronize();
  const peerPhases = [];
  peer.registerParticipant({
    name: 'peer-surface',
    async quiesce() { peerPhases.push('quiesce'); },
    blank() { peerPhases.push('blank'); },
    clearMemory() { peerPhases.push('clearMemory'); },
    async resume() { peerPhases.push('resume'); },
  });
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const unregisterGate = coordinator.registerParticipant({
    name: 'hold-clearing',
    async quiesce() {
      enteredResolve();
      await release;
    },
  });
  const before = coordinator.capture();
  const pending = coordinator.transition(
    before,
    successor(session(SESSION_A, USER_A), 'bearer-return', 50_000),
    'switch_back',
  );
  await entered;
  assert.equal(await errorCode(() => Promise.resolve(peer.capture())), 'SNAPBACK_CLIENT_AUTHORITY_CLEARING');
  releaseResolve();
  const next = await pending;
  await peer.synchronize();
  while (!peerPhases.includes('resume')) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await peer.synchronize();
  assert.equal(peer.capture().authorityKey, next.authorityKey);
  assert.deepEqual(peerPhases, ['quiesce', 'blank', 'clearMemory', 'resume']);
  await unregisterGate();
  await peer.close();
}

// Wakeups and hints are secret-free; the bearer exists only in custody.
for (const message of hub.messages) {
  assert.equal(JSON.stringify(message).includes('bearer'), false);
  assert.equal(JSON.stringify(message).includes(BEARER_SENTINEL), false);
  assert.deepEqual(Object.keys(message).sort(), [
    'appIdHash', 'authorityEpoch', 'formatVersion', 'phase', 'revision',
  ]);
}
for (const bytes of hintBytes.values()) {
  assert.equal(bytes.includes('bearer'), false);
  assert.equal(bytes.includes(BEARER_SENTINEL), false);
}

// Refresh ownership spans the network callback and exact durable replacement.
// A second context reloads after the first settles and cannot invoke its stale
// provider callback or overwrite the successor plaintext.
{
  const peer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: shared }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await peer.synchronize();
  const capture = coordinator.capture();
  const peerCapture = peer.capture();
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const first = coordinator.withCredentialRotation(capture, async () => {
    enteredResolve();
    await release;
    return { bearer: 'serialized-successor', refreshAfterMs: 80_000, value: 'first' };
  });
  await entered;
  let staleCallbackRan = false;
  const second = peer.withCredentialRotation(peerCapture, async () => {
    staleCallbackRan = true;
    return { bearer: 'must-not-land', refreshAfterMs: 90_000, value: 'second' };
  });
  releaseResolve();
  assert.deepEqual(await first, {
    rotated: true,
    capture: {
      ...capture,
      custodyRevision: capture.custodyRevision + 1,
    },
    value: 'first',
  });
  assert.deepEqual(await second, { rotated: false });
  assert.equal(staleCallbackRan, true, 'network rotation runs outside custody ownership; the final CAS rejects the loser');
  assert.equal((await peer.waitForNewerRevision(peerCapture))?.custodyRevision, capture.custodyRevision + 1);
  await peer.close();
}

// Neither monotonic counter can wrap or silently reuse an old comparison id.
{
  const epochState = { custody: {
    [APP]: {
      ...storage.snapshot(APP),
      authorityEpoch: Number.MAX_SAFE_INTEGER,
      revision: 100,
      transitionIntent: null,
    },
  } };
  const exhausted = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: epochState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await exhausted.synchronize();
  assert.equal(
    await errorCode(() => exhausted.transition(
      exhausted.capture(),
      successor(session(SESSION_B, USER_B), 'other', 60_000),
    )),
    'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED',
  );
}

{
  const revisionState = { custody: {
    [APP]: {
      ...storage.snapshot(APP),
      revision: Number.MAX_SAFE_INTEGER,
    },
  } };
  const exhausted = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: revisionState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await exhausted.synchronize();
  assert.equal(
    await errorCode(() => exhausted.compareAndRotateBearer(exhausted.capture(), {
      bearer: 'never-written',
      refreshAfterMs: 70_000,
    })),
    'SNAPBACK_AUTH_CUSTODY_CORRUPT',
  );
}

// Offline restore is a durable reload, not an in-memory cache lookup. A
// context that misses every wakeup cannot keep exposing predecessor A after
// another owner has durably transitioned the shared custody to B.
{
  const state = { custody: {} };
  const writer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const anonymousCapture = await writer.establishAnonymous(anonymous());
  const captureA = await writer.transition(
    anonymousCapture,
    successor(session(SESSION_A, USER_A), 'offline-a', 80_000),
  );
  const missedWakeup = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  assert.equal((await missedWakeup.restoreOffline()).authorityKey, captureA.authorityKey);
  const offlinePhases = [];
  missedWakeup.registerParticipant({
    async quiesce() { offlinePhases.push('quiesce'); },
    blank() { offlinePhases.push('blank'); },
    clearMemory() { offlinePhases.push('clearMemory'); },
    async commitDurable() { offlinePhases.push('commitDurable'); },
    async resume() { offlinePhases.push('resume'); },
  });
  const captureB = await writer.transition(
    captureA,
    successor(session(SESSION_B, USER_B), 'offline-b', 90_000),
  );
  const reloaded = await missedWakeup.restoreOffline();
  assert.equal(reloaded.authorityKey, captureB.authorityKey);
  assert.notEqual(reloaded.authorityKey, captureA.authorityKey);
  assert.deepEqual(offlinePhases, ['quiesce', 'blank', 'clearMemory', 'commitDurable']);
  await missedWakeup.close();
  await writer.close();
}

// ENG-24983: a participant that registers after the barrier's commitDurable
// phase completed globally — but before settle/resume — must still clear its
// predecessor durable state before it is resumed under the successor. The
// clearing-to-settled CAS is delayed deterministically to open that window.
{
  const deferred = () => {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
  };
  const state = { custody: {} };
  const inner = createMemoryAuthCustodyStorage({ state });
  let settleGate = null;
  const storage = {
    withOwnership: (appId, operation) => inner.withOwnership(appId, (owner) => operation({
      read: owner.read,
      replace: async (expectedRevision, next) => {
        if (next.phase === 'settled' && settleGate) {
          const gate = settleGate;
          settleGate = null;
          gate.entered.resolve();
          await gate.release.promise;
        }
        return owner.replace(expectedRevision, next);
      },
    })),
    snapshot: (appId) => inner.snapshot(appId),
  };
  const delayed = new AuthCoordinator({
    appId: APP,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const anonymousCapture = await delayed.establishAnonymous(anonymous());
  const durable = { early: 'A', late: 'A' };
  const log = [];
  delayed.registerParticipant({
    name: 'early',
    async quiesce() { log.push('early:quiesce'); },
    blank() { log.push('early:blank'); },
    clearMemory() { log.push('early:clearMemory'); },
    async commitDurable(ctx) {
      log.push(`early:commitDurable:${ctx.expectedEpoch}->${ctx.nextEpoch}`);
      durable.early = 'cleared';
    },
    async resume() { log.push(`early:resume:${durable.early}`); },
  });
  settleGate = { entered: deferred(), release: deferred() };
  const releaseSettle = settleGate.release;
  const settleEntered = settleGate.entered;
  const pendingTransition = delayed.transition(
    anonymousCapture,
    successor(session(SESSION_B, USER_B), 'late-registration-bearer', 10_000),
    'late_registration_window',
  );
  await settleEntered.promise;
  // The active barrier finished commitDurable for every registered
  // participant, but durable custody has not yet settled.
  assert.equal(inner.snapshot(APP).phase, 'clearing');
  assert.equal(durable.early, 'cleared');
  let lateResumeSawDurable = null;
  delayed.registerParticipant({
    name: 'late',
    async quiesce() { log.push('late:quiesce'); },
    blank() { log.push('late:blank'); },
    clearMemory() { log.push('late:clearMemory'); },
    async commitDurable(ctx) {
      log.push(`late:commitDurable:${ctx.expectedEpoch}->${ctx.nextEpoch}`);
      assert.equal(ctx.disposition, 'delete');
      durable.late = 'cleared';
    },
    async resume(ctx) {
      lateResumeSawDurable = durable.late;
      log.push(`late:resume:${ctx.capture.authorityEpoch}`);
    },
  });
  // Late registration while paused blanks synchronously and may not observe
  // pending custody.
  assert.deepEqual(log.filter((line) => line.startsWith('late:')), ['late:blank', 'late:clearMemory']);
  assert.equal(
    await errorCode(() => Promise.resolve(delayed.capture())),
    'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
  );
  releaseSettle.resolve();
  const settledCapture = await pendingTransition;
  assert.equal(settledCapture.authorityEpoch, 1);
  // The late participant's predecessor durable state was cleared before its
  // resume executed, via a commitDurable catch-up under the barrier context.
  assert.equal(durable.late, 'cleared');
  assert.equal(lateResumeSawDurable, 'cleared');
  assert.deepEqual(log.filter((line) => line.startsWith('late:')), [
    'late:blank',
    'late:clearMemory',
    'late:commitDurable:0->1',
    'late:resume:1',
  ]);
  // Reverse-order resume still holds: the late registrant (last registered)
  // resumes before the earlier participant.
  assert.deepEqual(log.filter((line) => line.includes(':resume')), [
    'late:resume:1',
    'early:resume:cleared',
  ]);
  await delayed.close();
}

// Malformed durable custody is a mandatory-gate failure. It must blank an
// already exposed predecessor before returning the corruption diagnostic;
// callers cannot keep using the old capture as an offline fallback.
{
  const state = { custody: {} };
  const malformed = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const exposed = await malformed.establishAnonymous(anonymous());
  const phases = [];
  malformed.registerParticipant({
    async quiesce() { phases.push('quiesce'); },
    blank() { phases.push('blank'); },
    clearMemory() { phases.push('clearMemory'); },
  });
  state.custody[APP].unexpected = true;
  assert.equal(
    await errorCode(() => malformed.restoreOffline()),
    'SNAPBACK_AUTH_CUSTODY_CORRUPT',
  );
  assert.deepEqual(phases, ['quiesce', 'blank', 'clearMemory']);
  assert.equal(malformed.isCurrent(exposed), false);
  assert.equal(
    await errorCode(() => Promise.resolve(malformed.capture())),
    'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
  );
  await malformed.close();
}

await coordinator.close();

{
  const inner = createMemoryAuthCustodyStorage();
  let owned = false;
  const observingStorage = {
    ...inner,
    withOwnership: (appId, operation) => inner.withOwnership(appId, async (owner) => {
      owned = true;
      try { return await operation(owner); }
      finally { owned = false; }
    }),
  };
  const phase8 = new AuthCoordinator({
    appId: `${APP}/phase8`,
    storage: observingStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const capture = await phase8.establishAnonymous(anonymous());
  phase8.registerParticipant({
    name: 'phase8-observer',
    resume: async () => assert.equal(owned, false),
  });
  await phase8.transition(capture, {
    authority: session(),
    bearer: 'phase8-successor',
    refreshAfterMs: 50_000,
  });
  await phase8.close();
}
console.log('auth coordinator conformance: ok');
