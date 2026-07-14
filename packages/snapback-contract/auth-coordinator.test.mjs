// LLP 0056 item-5 browser custody and local barrier conformance.

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
  assert.equal(staleCallbackRan, false);
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
console.log('auth coordinator conformance: ok');
