// LLP 0059 item-5 browser custody and local barrier conformance.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  AuthCoordinator,
  authAppIdHash,
  canonicalAgentAuthorityKey,
  canonicalAuthorityKey,
  createMemoryAuthCustodyStorage,
  SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
  SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION,
  validateAuthCustody,
} from './auth-coordinator.mjs';
import { createSecureStoreAuthCustodyStorage } from './auth-custody-secure-store.mjs';

const APP = 'snapback.test/auth-coordinator';
const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const SESSION_A = '018f0d90-7b12-7a22-8c33-445566778899';
const SESSION_B = '018f0d90-7b13-7a22-8c33-445566778899';
const USER_A = '018f0d90-7b14-7a22-8c33-445566778899';
const USER_B = '018f0d90-7b15-7a22-8c33-445566778899';
const PREFIXED_SESSION = `ses_${'0'.repeat(26)}`;
const PREFIXED_USER = `usr_${'1'.repeat(26)}`;
const PREFIXED_CREDENTIAL = `agc_${'2'.repeat(26)}`;
const PREFIXED_GRANT = `grt_${'3'.repeat(26)}`;
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

const withDeadline = async (promise, label, timeoutMs = 1_000) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not settle`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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

// Expo SecureStore can satisfy the same transactional custody contract as
// IndexedDB for ordinary (not sender-constrained) native sessions.
{
  const bytes = new Map();
  const SecureStore = {
    async getItemAsync(key) { return bytes.get(key) ?? null; },
    async setItemAsync(key, value) { bytes.set(key, value); },
  };
  const appId = `${APP}/secure-store`;
  const storage = createSecureStoreAuthCustodyStorage(SecureStore);
  const writer = new AuthCoordinator({
    appId, storage, broadcastChannelFactory: null, hintStorage: null,
  });
  const anonymousCapture = await writer.establishAnonymous(anonymous());
  await writer.transition(
    anonymousCapture,
    successor(session(), 'secure-store-bearer', 10_000),
    'secure_store_fixture',
  );
  const restored = new AuthCoordinator({
    appId, storage, broadcastChannelFactory: null, hintStorage: null,
  });
  await restored.synchronize();
  assert.equal(restored.settledView().authority.kind, 'session');
  assert.equal(restored.credentialFor(restored.capture()).bearer, 'secure-store-bearer');
  await restored.close();
  await writer.close();
}

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
  assert.match(canonicalAuthorityKey(APP, session(PREFIXED_SESSION, PREFIXED_USER)), /^sha256:[0-9a-f]{64}$/);
  assert.match(canonicalAgentAuthorityKey({
    actorUserId: PREFIXED_USER,
    credentialId: PREFIXED_CREDENTIAL,
    credentialGeneration: 1,
    grantId: PREFIXED_GRANT,
  }), /^sha256:[0-9a-f]{64}$/);
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
  const exhausted = {
    ...valid,
    revision: 2,
    phase: 'exhausted',
    authority: null,
  };
  assert.deepEqual(validateAuthCustody(exhausted, APP), exhausted);
  assert.throws(
    () => validateAuthCustody({ ...exhausted, authority: anonymous() }, APP),
    { code: 'SNAPBACK_AUTH_CUSTODY_CORRUPT' },
    'a durable exhaustion marker cannot retain a publishable predecessor',
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
// from the containing settled authority. The mandatory durable-read failure
// blanks local exposure without trusting the intent for durable commit/resume.
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
  assert.equal(
    await errorCode(() => Promise.resolve(peer.capture())),
    'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
  );
  assert.deepEqual(
    phases,
    ['quiesce', 'blank', 'clearMemory'],
    'the peer blanks locally without trusting the corrupt intent for durable work',
  );
  await peer.close();
  await writer.close();
}

// A missing durable record is valid only for a fresh, already-blank context.
// Once local custody was exposed, disappearance is corruption and must blank
// the predecessor rather than relabeling the context as fresh custody.
{
  const state = { custody: {} };
  const appId = `${APP}/missing-after-exposure`;
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await coordinator.establishAnonymous(anonymous());
  const phases = [];
  coordinator.registerParticipant({
    name: 'blank-missing-custody',
    async quiesce() { phases.push('quiesce'); },
    blank() { phases.push('blank'); },
    clearMemory() { phases.push('clearMemory'); },
  });
  delete state.custody[appId];

  assert.equal(
    await errorCode(() => coordinator.synchronize()),
    'SNAPBACK_AUTH_CUSTODY_CORRUPT',
  );
  assert.equal(
    await errorCode(() => Promise.resolve(coordinator.capture())),
    'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
  );
  assert.deepEqual(phases, ['quiesce', 'blank', 'clearMemory']);
  await coordinator.close();
}

// A clearing wakeup closes publication before its asynchronous durable read.
// If that read fails, the pre-existing pause must not be mistaken for proof
// that predecessor surfaces were already quiesced and blanked.
{
  const state = { custody: {} };
  const appId = `${APP}/prepaused-wakeup-read-failure`;
  const wakeups = new BroadcastHub();
  const writer = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: wakeups.factory,
    hintStorage: null,
  });
  const before = await writer.establishAnonymous(anonymous());
  const baseStorage = createMemoryAuthCustodyStorage({ state });
  let failNextRead = false;
  let failedReadResolve;
  const failedRead = new Promise((resolve) => { failedReadResolve = resolve; });
  const receiverStorage = {
    ...baseStorage,
    withOwnership(ownedAppId, operation) {
      return baseStorage.withOwnership(ownedAppId, (owner) => operation({
        ...owner,
        async read() {
          if (failNextRead) {
            failNextRead = false;
            failedReadResolve();
            throw Object.assign(new Error('wakeup custody read failed'), {
              code: 'TEST_WAKEUP_CUSTODY_READ_FAILED',
            });
          }
          return owner.read();
        },
      }));
    },
  };
  const receiver = new AuthCoordinator({
    appId,
    storage: receiverStorage,
    broadcastChannelFactory: wakeups.factory,
    hintStorage: null,
  });
  await receiver.synchronize();
  const phases = [];
  receiver.registerParticipant({
    name: 'prepaused-wakeup-surface',
    async quiesce() { phases.push('quiesce'); },
    blank() { phases.push('blank'); },
    clearMemory() { phases.push('clearMemory'); },
  });
  let releaseWriterBarrier;
  const writerBarrier = new Promise((resolve) => { releaseWriterBarrier = resolve; });
  writer.registerParticipant({
    name: 'prepaused-wakeup-settle-gate',
    async commitDurable() { await writerBarrier; },
  });

  failNextRead = true;
  const transition = writer.transition(
    before,
    successor(session(), 'prepaused-wakeup-bearer', 10_000),
    'prepaused_wakeup_read_failure',
  );
  await failedRead;
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(phases, ['quiesce', 'blank', 'clearMemory']);
  assert.equal(
    await errorCode(() => Promise.resolve(receiver.capture())),
    'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
  );
  releaseWriterBarrier();
  await transition;
  await receiver.close();
  await writer.close();
}

// Fail-closed participant cleanup is isolation-safe. A rejecting participant
// cannot mask the custody failure or prevent later participants from blanking,
// and a quiesce-time unregister request cannot escape the snapshotted cut.
{
  const baseStorage = createMemoryAuthCustodyStorage();
  let failNextRead = false;
  const failingStorage = {
    ...baseStorage,
    withOwnership(appId, operation) {
      return baseStorage.withOwnership(appId, (owner) => operation({
        ...owner,
        async read() {
          if (failNextRead) {
            failNextRead = false;
            throw Object.assign(new Error('primary custody read failed'), {
              code: 'TEST_PRIMARY_CUSTODY_READ_FAILED',
            });
          }
          return owner.read();
        },
      }));
    },
  };
  const coordinator = new AuthCoordinator({
    appId: `${APP}/isolated-fail-closed-participants`,
    storage: failingStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await coordinator.establishAnonymous(anonymous());
  const phases = [];
  coordinator.registerParticipant({
    name: 'faulty-fail-closed-participant',
    async quiesce() {
      phases.push('faulty:quiesce');
      throw Object.assign(new Error('quiesce failed'), { code: 'TEST_QUIESCE_FAILED' });
    },
    blank() {
      phases.push('faulty:blank');
      throw Object.assign(new Error('blank failed'), { code: 'TEST_BLANK_FAILED' });
    },
    clearMemory() { phases.push('faulty:clearMemory'); },
  });
  let selfUnregister;
  let selfUnregisterTask = Promise.resolve();
  selfUnregister = coordinator.registerParticipant({
    name: 'self-unregistering-fail-closed-participant',
    quiesce() {
      phases.push('self:quiesce');
      selfUnregisterTask = selfUnregister();
    },
    blank() { phases.push('self:blank'); },
    clearMemory() { phases.push('self:clearMemory'); },
  });
  coordinator.registerParticipant({
    name: 'later-fail-closed-participant',
    async quiesce() { phases.push('later:quiesce'); },
    blank() { phases.push('later:blank'); },
    clearMemory() { phases.push('later:clearMemory'); },
  });

  failNextRead = true;
  let primaryError = null;
  try {
    await coordinator.synchronize();
  } catch (error) {
    primaryError = error;
  }
  await selfUnregisterTask;

  assert.equal(primaryError?.code, 'TEST_PRIMARY_CUSTODY_READ_FAILED');
  assert.deepEqual(phases, [
    'faulty:quiesce',
    'self:quiesce',
    'later:quiesce',
    'faulty:blank',
    'self:blank',
    'later:blank',
    'faulty:clearMemory',
    'self:clearMemory',
    'later:clearMemory',
  ]);
  assert.deepEqual(
    primaryError.failClosedParticipantFailures.map(({ participant, method, code }) => ({
      participant,
      method,
      code,
    })),
    [
      {
        participant: 'faulty-fail-closed-participant',
        method: 'quiesce',
        code: 'TEST_QUIESCE_FAILED',
      },
      {
        participant: 'faulty-fail-closed-participant',
        method: 'blank',
        code: 'TEST_BLANK_FAILED',
      },
    ],
  );
  await coordinator.close();
}

// A participant may request removal from its own callback, but joining that
// removal before the callback returns is a dependency cycle. Reject the join
// promptly and keep the participant snapshotted through the active barrier.
{
  const coordinator = new AuthCoordinator({
    appId: `${APP}/self-unregister-join`,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await coordinator.establishAnonymous(anonymous());
  const phases = [];
  let selfJoinCode = null;
  let unregister;
  unregister = coordinator.registerParticipant({
    name: 'self-unregister-join',
    async quiesce() {
      phases.push('quiesce');
      selfJoinCode = await errorCode(() => unregister());
    },
    blank() { phases.push('blank'); },
    clearMemory() { phases.push('clearMemory'); },
    async commitDurable() { phases.push('commitDurable'); },
    async resume() { phases.push('resume'); },
  });
  await coordinator.transition(
    before,
    successor(session(), 'self-unregister-join-successor', 10_000),
    'self_unregister_join',
  );
  assert.equal(selfJoinCode, 'SNAPBACK_AUTH_CUSTODY_PARTICIPANT_REENTRANT');
  assert.deepEqual(phases, [
    'quiesce',
    'blank',
    'clearMemory',
    'commitDurable',
    'resume',
  ]);
  await unregister();
  await coordinator.close();
}

// A missing read during reentrant participant resume is typed custody
// corruption, not a host TypeError from dereferencing the absent record.
{
  const baseStorage = createMemoryAuthCustodyStorage();
  let returnNullFromNextRead = false;
  const storage = {
    ...baseStorage,
    withOwnership(appId, operation) {
      return baseStorage.withOwnership(appId, (owner) => operation({
        ...owner,
        async read() {
          if (returnNullFromNextRead) {
            returnNullFromNextRead = false;
            return null;
          }
          return owner.read();
        },
      }));
    },
  };
  const coordinator = new AuthCoordinator({
    appId: `${APP}/missing-during-resume`,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await coordinator.establishAnonymous(anonymous());
  let resumeError = null;
  const unregister = coordinator.registerParticipant({
    name: 'missing-during-resume',
    async resume() {
      returnNullFromNextRead = true;
      try {
        await coordinator.synchronize();
      } catch (error) {
        resumeError = error;
        throw error;
      }
    },
  });
  let transitionError = null;
  try {
    await coordinator.transition(
      before,
      successor(session(), 'missing-during-resume-bearer', 10_000),
      'missing_during_resume',
    );
  } catch (error) {
    transitionError = error;
  }

  assert.equal(resumeError?.code, 'SNAPBACK_AUTH_CUSTODY_CORRUPT');
  assert.equal(transitionError?.code, 'SNAPBACK_AUTH_TRANSITION_FAILED');
  assert.equal(
    transitionError?.diagnostic?.details?.causeCode,
    'SNAPBACK_AUTH_CUSTODY_CORRUPT',
  );
  await unregister();
  assert.equal((await coordinator.synchronize()).authorityEpoch, before.authorityEpoch + 1);
  await coordinator.close();
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

// A context with no local record cannot use anonymous bootstrap to adopt
// durable custody that another context already created. Synchronization is the
// only adoption/recovery path and keeps paused-vs-absent semantics explicit.
{
  const duplicate = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: shared }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  assert.equal(
    await errorCode(() => duplicate.establishAnonymous(anonymous())),
    'SNAPBACK_CLIENT_AUTHORITY_STALE',
  );
  assert.equal(
    await errorCode(() => Promise.resolve(duplicate.capture())),
    'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
  );
  assert.deepEqual(await duplicate.synchronize(), anonymousCapture);
  await duplicate.close();
}

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
  const publicationOrder = [];
  const unregister = reentrant.registerParticipant({
    name: 'resume-durable-reload',
    async quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() {},
    async resume(context) {
      resumeCalls += 1;
      publicationOrder.push('resume-enter');
      assert.deepEqual(
        await reentrant.compareAndCommit(context.capture, () => publicationOrder.push('must-not-run')),
        { committed: false },
      );
      assert.equal(
        await errorCode(() => reentrant.establishAnonymous(anonymous())),
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
        'owner resume cannot misuse anonymous bootstrap to reopen publication',
      );
      context.stagePublication(context.capture, () => {
        publicationOrder.push('staged-publication');
        assert.equal(reentrant.isCurrent(context.capture), false, 'barrier opens only after staged flush');
      });
      assert.equal(resumeCalls, 1, 'exact successor reload must not recurse into resume');
      assert.deepEqual(await reentrant.synchronize(), context.capture);
      publicationOrder.push('resume-exit');
    },
  });
  const after = await reentrant.transition(
    before,
    successor(session(), BEARER_SENTINEL, 10_000),
    'resume_reload',
  );
  assert.equal(after.authorityEpoch, 1);
  assert.equal(resumeCalls, 1);
  assert.deepEqual(publicationOrder, ['resume-enter', 'resume-exit', 'staged-publication']);
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
  const publicationOrder = [];
  peer.registerParticipant({
    name: 'peer-resume-durable-reload',
    async quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() {},
    async resume(context) {
      resumeCalls += 1;
      publicationOrder.push('resume-enter');
      assert.equal(
        await errorCode(() => peer.establishAnonymous(anonymous())),
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
        'peer resume cannot misuse anonymous bootstrap to reopen publication',
      );
      context.stagePublication(context.capture, () => publicationOrder.push('staged-publication'));
      assert.equal(resumeCalls, 1, 'peer successor reload must not recurse into resume');
      assert.deepEqual(await peer.synchronize(), context.capture);
      publicationOrder.push('resume-exit');
    },
  });
  const settled = await writer.transition(
    before,
    successor(session(), BEARER_SENTINEL, 10_000),
    'peer_resume_reload',
  );
  assert.deepEqual(await peer.synchronize(), settled);
  assert.equal(resumeCalls, 1);
  assert.deepEqual(publicationOrder, ['resume-enter', 'resume-exit', 'staged-publication']);
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
  let stagedPublications = 0;
  const unregister = owner.registerParticipant({
    name: 'owner-resume-race',
    async quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() {},
    async resume(context) {
      resumeCalls += 1;
      context.stagePublication(context.capture, () => { stagedPublications += 1; });
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
  assert.equal(stagedPublications, 0);
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
  let stagedPublications = 0;
  const unregister = peer.registerParticipant({
    name: 'peer-resume-race',
    async quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() {},
    async resume(context) {
      resumeCalls += 1;
      context.stagePublication(context.capture, () => { stagedPublications += 1; });
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
  assert.equal(stagedPublications, 0);
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

// A requested successor that is already durable is idempotent only when this
// context has already installed that exact record (for example, reentrant
// successor resume). A missed-wakeup predecessor must run the full peer
// adoption barrier before it can expose the durable successor.
{
  const appId = `${APP}/same-successor-missed-wakeup`;
  const state = { custody: {} };
  const writer = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const local = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const captureA = await writer.establishAnonymous(anonymous());
  await local.synchronize();
  const phases = [];
  local.registerParticipant({
    name: 'same-successor-peer-adoption',
    async quiesce() { phases.push('quiesce'); },
    blank() { phases.push('blank'); },
    clearMemory() { phases.push('clearMemory'); },
    async commitDurable() { phases.push('commitDurable'); },
    async resume() { phases.push('resume'); },
  });
  const requested = successor(session(), 'same-successor-durable-bearer', 10_000);
  const captureB = await writer.transition(captureA, requested, 'peer_settles_requested_successor');
  const adopted = await local.transition(captureA, requested, 'missed_wakeup_same_successor');
  assert.deepEqual(adopted, captureB);
  assert.deepEqual(phases, [
    'quiesce',
    'blank',
    'clearMemory',
    'commitDurable',
    'resume',
  ]);
  assert.equal(local.isCurrent(captureA), false);
  assert.equal(local.isCurrent(captureB), true);
  await local.close();
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

// A failure before the normal blank phase still performs a snapshotted,
// isolation-safe destructive cut after storage ownership releases. The
// transition diagnostic remains primary while every participant ends blank.
{
  const appId = `${APP}/throwing-quiesce-final-cut`;
  const state = { custody: {} };
  const subject = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await subject.establishAnonymous(anonymous());
  const surfaces = { faulty: 'predecessor', later: 'predecessor' };
  subject.registerParticipant({
    name: 'throwing-quiesce-visible-predecessor',
    async quiesce() {
      surfaces.faulty = 'repopulated';
      throw Object.assign(new Error('quiesce failed'), { code: 'TEST_QUIESCE_FAILED' });
    },
    blank() { surfaces.faulty = 'blank'; },
    clearMemory() { surfaces.faulty = 'blank'; },
  });
  subject.registerParticipant({
    name: 'later-must-still-blank',
    async quiesce() {},
    blank() { surfaces.later = 'blank'; },
    clearMemory() { surfaces.later = 'blank'; },
  });
  let transitionError = null;
  try {
    await subject.transition(
      before,
      successor(session(), 'throwing-quiesce-successor', 10_000),
      'throwing_quiesce_final_cut',
    );
  } catch (error) {
    transitionError = error;
  }
  assert.equal(transitionError?.code, 'SNAPBACK_AUTH_TRANSITION_FAILED');
  assert.equal(transitionError?.diagnostic?.details?.causeCode, 'TEST_QUIESCE_FAILED');
  assert.equal(state.custody[appId].phase, 'clearing');
  assert.deepEqual(surfaces, { faulty: 'blank', later: 'blank' });
  assert.throws(
    () => subject.capture(),
    { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING' },
  );
  await subject.close();
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

// Owner and peer resume staging is discarded when the final confirmation
// cannot run. No staged callback executes, and the context remains blank until
// a later clean synchronization.
for (const mode of ['owner', 'peer']) {
  const state = { custody: {} };
  const appId = `${APP}/staged-final-read-failure/${mode}`;
  const baseStorage = createMemoryAuthCustodyStorage({ state });
  let failNextOwnership = false;
  const failingStorage = {
    ...baseStorage,
    async withOwnership(ownedAppId, operation) {
      if (failNextOwnership) {
        failNextOwnership = false;
        throw Object.assign(new Error('staged final confirmation failed'), {
          code: 'TEST_STAGED_FINAL_CONFIRM_FAILED',
        });
      }
      return baseStorage.withOwnership(ownedAppId, operation);
    },
  };
  const subject = new AuthCoordinator({
    appId,
    storage: failingStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const writer = mode === 'peer'
    ? new AuthCoordinator({
      appId,
      storage: createMemoryAuthCustodyStorage({ state }),
      broadcastChannelFactory: null,
      hintStorage: null,
    })
    : subject;
  const before = await writer.establishAnonymous(anonymous());
  if (mode === 'peer') await subject.synchronize();
  let stagedPublications = 0;
  const unregister = subject.registerParticipant({
    name: `staged-final-read-failure-${mode}`,
    async resume(context) {
      context.stagePublication(context.capture, () => { stagedPublications += 1; });
      failNextOwnership = true;
    },
  });
  let settled;
  if (mode === 'owner') {
    assert.equal(
      await errorCode(() => subject.transition(
        before,
        successor(session(), `bearer-staged-final-${mode}`, 10_000),
        `staged_final_read_failure_${mode}`,
      )),
      'SNAPBACK_AUTH_TRANSITION_FAILED',
    );
  } else {
    settled = await writer.transition(
      before,
      successor(session(), `bearer-staged-final-${mode}`, 10_000),
      `staged_final_read_failure_${mode}`,
    );
    assert.equal(
      await errorCode(() => subject.synchronize()),
      'TEST_STAGED_FINAL_CONFIRM_FAILED',
    );
  }
  assert.equal(stagedPublications, 0);
  assert.equal(
    await errorCode(() => Promise.resolve(subject.capture())),
    'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
  );
  await unregister();
  if (mode === 'owner') {
    assert.equal((await subject.synchronize()).authorityEpoch, before.authorityEpoch + 1);
  } else {
    assert.deepEqual(await subject.synchronize(), settled);
  }
  if (writer !== subject) await writer.close();
  await subject.close();
}

// Staged callbacks are ordered and non-reentrant. A throwing callback aborts
// the remaining queue, re-blanks participants, and leaves publication paused.
{
  const coordinator = new AuthCoordinator({
    appId: `${APP}/staged-callback-failure`,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await coordinator.establishAnonymous(anonymous());
  const events = [];
  let clearMemoryCalls = 0;
  const unregister = coordinator.registerParticipant({
    name: 'staged-callback-failure',
    clearMemory() { clearMemoryCalls += 1; },
    async resume(context) {
      context.stagePublication(context.capture, () => events.push('first'));
      context.stagePublication(context.capture, () => coordinator.capture());
      context.stagePublication(context.capture, () => events.push('must-not-run'));
    },
  });
  assert.equal(
    await errorCode(() => coordinator.transition(
      before,
      successor(session(), 'bearer-staged-callback-failure', 10_000),
      'staged_callback_failure',
    )),
    'SNAPBACK_AUTH_TRANSITION_FAILED',
  );
  assert.deepEqual(events, ['first']);
  assert.equal(clearMemoryCalls, 2, 'failure cleanup re-runs clearMemory after the initial barrier');
  assert.equal(
    await errorCode(() => Promise.resolve(coordinator.capture())),
    'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
  );
  await unregister();
  await coordinator.close();
}

// Staged publication rechecks lifecycle authority before every callback. A
// first callback may synchronously close the coordinator, but no later queued
// callback can run and the transition failure cut leaves participants blank.
{
  const coordinator = new AuthCoordinator({
    appId: `${APP}/staged-callback-closes-coordinator`,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await coordinator.establishAnonymous(anonymous());
  const events = [];
  let visible = true;
  const unregister = coordinator.registerParticipant({
    name: 'staged-callback-closes-coordinator',
    blank() { visible = false; },
    clearMemory() { visible = false; },
    async resume(context) {
      context.stagePublication(context.capture, () => {
        events.push('first');
        void coordinator.close();
      });
      context.stagePublication(context.capture, () => events.push('must-not-run'));
    },
  });
  assert.equal(
    await errorCode(() => coordinator.transition(
      before,
      successor(session(), 'staged-close-successor', 10_000),
      'staged_callback_closes_coordinator',
    )),
    'SNAPBACK_AUTH_TRANSITION_FAILED',
  );
  assert.deepEqual(events, ['first']);
  assert.equal(visible, false);
  assert.equal(coordinator.isCurrent(before), false);
  await unregister();
}

// Participant registration is forbidden inside a staged commit. Otherwise a
// callback could insert an entry after phase closure and expose it without
// commitDurable/resume.
{
  const coordinator = new AuthCoordinator({
    appId: `${APP}/staged-callback-registers-participant`,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await coordinator.establishAnonymous(anonymous());
  let registrationCode = null;
  let lateParticipantCalls = 0;
  const unregister = coordinator.registerParticipant({
    name: 'staged-register-attempt',
    async resume(context) {
      context.stagePublication(context.capture, () => {
        try {
          coordinator.registerParticipant({
            name: 'must-not-register-from-staged-commit',
            async commitDurable() { lateParticipantCalls += 1; },
            async resume() { lateParticipantCalls += 1; },
          });
        } catch (error) {
          registrationCode = error.code;
        }
      });
    },
  });
  const settled = await coordinator.transition(
    before,
    successor(session(), 'staged-register-successor', 10_000),
    'staged_callback_registers_participant',
  );
  assert.equal(registrationCode, 'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT');
  assert.equal(lateParticipantCalls, 0);
  assert.equal(coordinator.isCurrent(settled), true);
  await unregister();
  await coordinator.close();
}

// Closing while one resume callback is pending aborts the dynamic resume loop
// before it selects another participant, and staged work never reaches final
// publication.
{
  const coordinator = new AuthCoordinator({
    appId: `${APP}/close-during-pending-resume`,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await coordinator.establishAnonymous(anonymous());
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  let laterResumeCalls = 0;
  let stagedCalls = 0;
  const unregisterLater = coordinator.registerParticipant({
    name: 'later-resume-must-not-run',
    async resume() { laterResumeCalls += 1; },
  });
  const unregisterGated = coordinator.registerParticipant({
    name: 'gated-resume-before-close',
    async resume(context) {
      context.stagePublication(context.capture, () => { stagedCalls += 1; });
      enteredResolve();
      await release;
    },
  });
  const pending = coordinator.transition(
    before,
    successor(session(), 'close-pending-resume-successor', 10_000),
    'close_during_pending_resume',
  );
  await entered;
  await coordinator.close();
  releaseResolve();
  assert.equal(await errorCode(() => pending), 'SNAPBACK_AUTH_TRANSITION_FAILED');
  assert.equal(laterResumeCalls, 0);
  assert.equal(stagedCalls, 0);
  assert.equal(coordinator.isCurrent(before), false);
  await unregisterGated();
  await unregisterLater();
}

// Close may also happen while the final exact read is in flight. The fenced
// closure check runs before staged flush, so no callback publishes after close.
{
  const appId = `${APP}/close-during-final-confirm`;
  const inner = createMemoryAuthCustodyStorage();
  let armed = false;
  let reads = 0;
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const coordinator = new AuthCoordinator({
    appId,
    storage: {
      ...inner,
      withOwnership: (requestedAppId, operation) => inner.withOwnership(
        requestedAppId,
        (owner) => operation({
          ...owner,
          async read() {
            const record = await owner.read();
            if (armed) {
              reads += 1;
              if (reads === 3) {
                enteredResolve();
                await release;
              }
            }
            return record;
          },
        }),
      ),
    },
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await coordinator.establishAnonymous(anonymous());
  let stagedCalls = 0;
  let visible = true;
  const unregister = coordinator.registerParticipant({
    name: 'close-during-final-confirm',
    blank() { visible = false; },
    clearMemory() { visible = false; },
    async resume(context) {
      context.stagePublication(context.capture, () => { stagedCalls += 1; });
    },
  });
  armed = true;
  const pending = coordinator.transition(
    before,
    successor(session(), 'close-final-confirm-successor', 10_000),
    'close_during_final_confirm',
  );
  await entered;
  await coordinator.close();
  releaseResolve();
  assert.equal(await errorCode(() => pending), 'SNAPBACK_AUTH_TRANSITION_FAILED');
  assert.equal(stagedCalls, 0);
  assert.equal(visible, false);
  assert.equal(coordinator.isCurrent(before), false);
  await unregister();
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

// A same-authority credential/nonce write from inside resume may update the
// exact durable revision while the outer barrier remains publication-closed.
// Final confirmation adopts that locally witnessed revision; an unobserved
// peer write would still fail the exact comparison.
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
  const transitioned = await coordinator.transition(
    anonymousCapture,
    successor(session(), 'bearer-before-reentrant-rotation', 10_000),
    'reentrant_same_authority_exposure',
  );
  assert.deepEqual(transitioned, rotatedCapture);
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
    'quiesce', 'blank', 'clearMemory',
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

// An exhausted broadcast is only an eager terminal wakeup, not durable state.
// Forged higher counters cut visibility synchronously but unchanged settled
// custody reopens through the normal owned reload and participant resume.
{
  const forgedHub = new BroadcastHub();
  const forgedState = { custody: { [APP]: { ...storage.snapshot(APP) } } };
  const subject = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: forgedState }),
    broadcastChannelFactory: forgedHub.factory,
    hintStorage: null,
  });
  const before = await subject.synchronize();
  const surface = { visible: true, memory: true, resumes: 0 };
  subject.registerParticipant({
    async quiesce() {},
    blank() { surface.visible = false; },
    clearMemory() { surface.memory = false; },
    async resume() {
      surface.visible = true;
      surface.memory = true;
      surface.resumes += 1;
    },
  });
  const channel = [...forgedHub.channels.values()][0].values().next().value;
  channel.onmessage({ data: {
    formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
    appIdHash: authAppIdHash(APP),
    authorityEpoch: before.authorityEpoch,
    revision: before.custodyRevision + 100,
    phase: 'exhausted',
  } });
  assert.deepEqual(
    surface,
    { visible: false, memory: false, resumes: 0 },
    'an exhausted wakeup performs its local terminal cut synchronously',
  );
  assert.equal(
    await errorCode(() => Promise.resolve(subject.capture())),
    'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
  );
  assert.deepEqual(await subject.synchronize(), before);
  assert.deepEqual(
    surface,
    { visible: true, memory: true, resumes: 1 },
    'unchanged settled durable custody recovers from a forged exhausted hint',
  );
  await subject.close();
}

// An eager exhausted wakeup that overlaps successor resume is a real exposure
// cut until its quiescence and final blank finish. The active transition may
// not reopen from its already-completed resume; it replays the full local
// barrier after the cut and reconfirms the durable successor.
{
  const appId = `${APP}/eager-exhausted-cut-overlaps-resume`;
  const hub = new BroadcastHub();
  const subject = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: hub.factory,
    hintStorage: null,
  });
  const before = await subject.establishAnonymous(anonymous());
  let visible = true;
  let resumeCalls = 0;
  let resumeEnteredResolve;
  let releaseResumeResolve;
  let eagerQuiesceEnteredResolve;
  let releaseEagerQuiesceResolve;
  const resumeEntered = new Promise((resolve) => { resumeEnteredResolve = resolve; });
  const releaseResume = new Promise((resolve) => { releaseResumeResolve = resolve; });
  const eagerQuiesceEntered = new Promise((resolve) => { eagerQuiesceEnteredResolve = resolve; });
  const releaseEagerQuiesce = new Promise((resolve) => { releaseEagerQuiesceResolve = resolve; });
  subject.registerParticipant({
    name: 'eager-cut-overlapping-resume',
    async quiesce(context) {
      if (context.reason === 'auth_counter_exhausted_wakeup') {
        eagerQuiesceEnteredResolve();
        await releaseEagerQuiesce;
      }
    },
    blank() { visible = false; },
    clearMemory() { visible = false; },
    async commitDurable() {},
    async resume() {
      resumeCalls += 1;
      if (resumeCalls === 1) {
        resumeEnteredResolve();
        await releaseResume;
      }
      visible = true;
    },
  });
  let transitionSettled = false;
  const pending = subject.transition(
    before,
    successor(session(), 'eager-overlap-successor', 10_000),
    'eager_overlap_transition',
  ).finally(() => { transitionSettled = true; });
  await resumeEntered;
  const channelSet = [...hub.channels.values()][0];
  const channel = channelSet.values().next().value;
  channel.onmessage({ data: {
    formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
    appIdHash: authAppIdHash(appId),
    authorityEpoch: before.authorityEpoch + 1,
    revision: before.custodyRevision + 100,
    phase: 'exhausted',
  } });
  await eagerQuiesceEntered;
  assert.equal(visible, false, 'the eager cut blanks synchronously');
  releaseResumeResolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(transitionSettled, false, 'final exposure waits for the eager cut');
  assert.throws(
    () => subject.capture(),
    { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING' },
  );
  releaseEagerQuiesceResolve();
  const settled = await pending;
  assert.equal(resumeCalls, 2, 'resume is replayed after the destructive cut');
  assert.equal(visible, true);
  assert.equal(subject.isCurrent(settled), true);
  await subject.close();
}

// Authority-epoch exhaustion persists a secret-free terminal marker. Both the
// owner and an already-exposed peer synchronously blank and permanently reject
// predecessor publication; no terminal-clear result can report success.
{
  const terminalHub = new BroadcastHub();
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
    broadcastChannelFactory: terminalHub.factory,
    hintStorage: null,
  });
  const peer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: epochState }),
    broadcastChannelFactory: terminalHub.factory,
    hintStorage: null,
  });
  await exhausted.synchronize();
  await peer.synchronize();
  const ownerCapture = exhausted.capture();
  const peerCapture = peer.capture();
  const surfaces = {
    owner: { visible: true, memory: true, resumed: 0 },
    peer: { visible: true, memory: true, resumed: 0 },
  };
  for (const [name, subject] of [['owner', exhausted], ['peer', peer]]) {
    subject.registerParticipant({
      name: `${name}-epoch-exhaustion`,
      async quiesce() {},
      blank() { surfaces[name].visible = false; },
      clearMemory() { surfaces[name].memory = false; },
      async resume() { surfaces[name].resumed += 1; },
    });
  }
  assert.equal(
    await errorCode(() => exhausted.compareAndClear(ownerCapture, 'terminal_epoch_exhaustion')),
    'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED',
  );
  assert.deepEqual(epochState.custody[APP], {
    formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
    appId: APP,
    authorityEpoch: Number.MAX_SAFE_INTEGER,
    revision: 101,
    phase: 'exhausted',
    authority: null,
    pendingAuthority: null,
    bearer: null,
    pendingBearer: null,
    refreshAfterMs: null,
    transitionIntent: null,
  });
  assert.deepEqual(surfaces, {
    owner: { visible: false, memory: false, resumed: 0 },
    peer: { visible: false, memory: false, resumed: 0 },
  });
  assert.equal(exhausted.phase, 'exhausted');
  assert.equal(
    await errorCode(() => peer.synchronize()),
    'SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED',
    'the peer latches only after its owned reload validates the durable marker',
  );
  assert.equal(peer.phase, 'exhausted');
  assert.equal(await errorCode(() => Promise.resolve(exhausted.capture())),
    'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED');
  assert.equal(
    await errorCode(() => peer.compareAndCommit(peerCapture, () => assert.fail('predecessor published'))),
    'SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED',
  );
  await exhausted.close();
  await peer.close();
}

// The last safe revision is reserved for the terminal marker. A bearer write
// at the boundary cannot publish its candidate, and the peer receives the same
// permanent cut without any bearer bytes in the wakeup.
{
  const terminalHub = new BroadcastHub();
  const revisionState = { custody: {
    [APP]: {
      ...storage.snapshot(APP),
      revision: Number.MAX_SAFE_INTEGER - 1,
    },
  } };
  const exhausted = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: revisionState }),
    broadcastChannelFactory: terminalHub.factory,
    hintStorage: null,
  });
  const peer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: revisionState }),
    broadcastChannelFactory: terminalHub.factory,
    hintStorage: null,
  });
  const ownershipPeer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: revisionState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await exhausted.synchronize();
  await peer.synchronize();
  await ownershipPeer.synchronize();
  const peerCapture = peer.capture();
  let peerVisible = true;
  let ownershipPeerVisible = true;
  peer.registerParticipant({
    async quiesce() {},
    blank() { peerVisible = false; },
    clearMemory() {},
    async resume() { assert.fail('an exhausted peer cannot resume'); },
  });
  ownershipPeer.registerParticipant({
    async quiesce() {},
    blank() { ownershipPeerVisible = false; },
    clearMemory() {},
    async resume() { assert.fail('an exhausted ownership peer cannot resume'); },
  });
  assert.equal(
    await errorCode(() => exhausted.compareAndRotateBearer(exhausted.capture(), {
      bearer: 'never-written',
      refreshAfterMs: 70_000,
    })),
    'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
  );
  assert.equal(revisionState.custody[APP].phase, 'exhausted');
  assert.equal(revisionState.custody[APP].revision, Number.MAX_SAFE_INTEGER);
  assert.equal(revisionState.custody[APP].bearer, null);
  assert.equal(JSON.stringify(terminalHub.messages).includes('never-written'), false);
  assert.equal(peerVisible, false);
  assert.equal(ownershipPeerVisible, true, 'a missed wakeup stays a hint miss until the mandatory durable gate');
  assert.equal(await errorCode(() => ownershipPeer.synchronize()),
    'SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED');
  assert.equal(ownershipPeerVisible, false, 'encountering the durable marker under ownership blanks the peer');
  assert.equal(
    await errorCode(() => peer.compareAndCommit(peerCapture, () => assert.fail('predecessor published'))),
    'SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED',
  );
  await exhausted.close();
  await peer.close();
  await ownershipPeer.close();
}

// A legacy or injected record that already consumed MAX_SAFE cannot be
// rewritten, but it is durable poison: every context that encounters it under
// ownership blanks locally and rejects publication instead of treating the
// unchanged authority key as current.
{
  const revisionState = { custody: {
    [APP]: { ...storage.snapshot(APP) },
  } };
  const writer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: revisionState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const peer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: revisionState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await writer.synchronize();
  await peer.synchronize();
  const writerCapture = writer.capture();
  const peerCapture = peer.capture();
  revisionState.custody[APP].revision = Number.MAX_SAFE_INTEGER;
  let writerBlank = false;
  let peerBlank = false;
  writer.registerParticipant({ blank() { writerBlank = true; }, clearMemory() {} });
  peer.registerParticipant({ blank() { peerBlank = true; }, clearMemory() {} });
  assert.equal(await errorCode(() => writer.compareAndRotateBearer(writerCapture, {
    bearer: 'legacy-max-must-not-land',
    refreshAfterMs: 80_000,
  })), 'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED');
  assert.equal(writerBlank, true);
  assert.equal(
    await errorCode(() => peer.compareAndCommit(peerCapture, () => assert.fail('predecessor published'))),
    'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
  );
  assert.equal(peerBlank, true);
  assert.equal(writer.isCurrent(writerCapture), false);
  assert.equal(peer.isCurrent(peerCapture), false);
  assert.equal(revisionState.custody[APP].bearer, storage.snapshot(APP).bearer);
  await writer.close();
  await peer.close();
}

// A legacy MAX_SAFE record starts its permanent local cut only after storage
// ownership releases. The cut holds an exact participant snapshot behind a
// completion: quiesce may repopulate state and request unregistration, but the
// unregister join settles only after the final blank/clear pass.
{
  const appId = `${APP}/legacy-max-snapshotted-terminal-cut`;
  const state = { custody: {} };
  const inner = createMemoryAuthCustodyStorage({ state });
  let owned = false;
  const strictStorage = {
    ...inner,
    async withOwnership(requestedAppId, operation) {
      if (owned) {
        throw Object.assign(new Error('nested custody ownership'), {
          code: 'TEST_REENTRANT_CUSTODY_OWNER',
        });
      }
      owned = true;
      try {
        return await inner.withOwnership(requestedAppId, operation);
      } finally {
        owned = false;
      }
    },
  };
  const subject = new AuthCoordinator({
    appId,
    storage: strictStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const exposed = await subject.establishAnonymous(anonymous());
  let visible = 'predecessor';
  let unregister;
  let unregisterTask = null;
  let quiesceEnteredResolve;
  let releaseQuiesceResolve;
  const quiesceEntered = new Promise((resolve) => { quiesceEnteredResolve = resolve; });
  const releaseQuiesce = new Promise((resolve) => { releaseQuiesceResolve = resolve; });
  unregister = subject.registerParticipant({
    name: 'legacy-max-self-unregister',
    async quiesce() {
      await strictStorage.withOwnership(appId, async (owner) => owner.read());
      visible = 'repopulated-during-quiesce';
      unregisterTask = unregister();
      quiesceEnteredResolve();
      await releaseQuiesce;
      visible = 'repopulated-after-quiesce';
    },
    blank() { visible = 'blank'; },
    clearMemory() { visible = 'blank'; },
  });
  state.custody[appId].revision = Number.MAX_SAFE_INTEGER;
  const terminal = subject.compareAndCommit(
    exposed,
    () => assert.fail('legacy MAX_SAFE custody cannot publish'),
  );
  await quiesceEntered;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(visible, 'repopulated-during-quiesce');
  releaseQuiesceResolve();
  assert.equal(
    await errorCode(() => terminal),
    'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
  );
  await unregisterTask;
  assert.equal(visible, 'blank');
  assert.equal(subject.isCurrent(exposed), false);
  await subject.close();
}

// A participant registered while a fresh coordinator is blank must complete
// blank/clear synchronously. An async blank is observed and typed immediately;
// a later offline restore cannot expose custody over that failed registration.
{
  const appId = `${APP}/offline-async-registration-blank`;
  const state = { custody: {} };
  const storage = createMemoryAuthCustodyStorage({ state });
  const writer = new AuthCoordinator({
    appId,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const durable = await writer.establishAnonymous(anonymous());
  const fresh = new AuthCoordinator({
    appId,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  let thenObserved = false;
  let clearMemoryCalled = false;
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    fresh.registerParticipant({
      name: 'async-registration-blank',
      blank() {
        return {
          then(_resolve, reject) {
            thenObserved = true;
            queueMicrotask(() => reject(new Error('async blank rejected')));
          },
        };
      },
      clearMemory() { clearMemoryCalled = true; },
    });
    await assert.rejects(
      fresh.restoreOffline(),
      { code: 'SNAPBACK_AUTH_PARTICIPANT_ASYNC_SYNC_PHASE' },
    );
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.equal(thenObserved, true, 'the invalid async return is observed');
  assert.equal(clearMemoryCalled, true, 'later destructive registration phases still run');
  assert.deepEqual(unhandled, []);
  assert.equal(fresh.isCurrent(durable), false);
  assert.throws(
    () => fresh.capture(),
    { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING' },
  );
  await fresh.close();
  await writer.close();
}

// Fresh anonymous establishment is the other first-exposure path. It must
// reject a participant whose registration-time blank returned a thenable,
// observe that thenable, and leave the coordinator closed without creating a
// durable row.
{
  const appId = `${APP}/establish-async-registration-blank`;
  const state = { custody: {} };
  const fresh = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  let clearMemoryCalled = false;
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    fresh.registerParticipant({
      name: 'establish-async-registration-blank',
      blank() { return Promise.resolve(); },
      clearMemory() { clearMemoryCalled = true; },
    });
    await assert.rejects(
      fresh.establishAnonymous(anonymous()),
      { code: 'SNAPBACK_AUTH_PARTICIPANT_ASYNC_SYNC_PHASE' },
    );
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.equal(clearMemoryCalled, true);
  assert.deepEqual(unhandled, []);
  assert.equal(Object.hasOwn(state.custody, appId), false);
  assert.throws(
    () => fresh.capture(),
    { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING' },
  );
  await fresh.close();
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

// Offline peer adoption must release the non-reentrant custody owner before
// every participant phase. Participants are allowed to perform their own
// short custody operation while quiescing or committing durable cleanup.
{
  const appId = `${APP}/offline-non-reentrant-owner`;
  const state = { custody: {} };
  const inner = createMemoryAuthCustodyStorage({ state });
  let owned = false;
  const storage = {
    ...inner,
    async withOwnership(requestedAppId, operation) {
      if (owned) {
        throw Object.assign(new Error('nested custody ownership'), {
          code: 'TEST_REENTRANT_CUSTODY_OWNER',
        });
      }
      owned = true;
      try {
        return await inner.withOwnership(requestedAppId, operation);
      } finally {
        owned = false;
      }
    },
  };
  const writer = new AuthCoordinator({
    appId,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const local = new AuthCoordinator({
    appId,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const anonymousCapture = await writer.establishAnonymous(anonymous());
  const captureA = await writer.transition(
    anonymousCapture,
    successor(session(SESSION_A, USER_A), 'strict-owner-a', 80_000),
  );
  assert.equal((await local.restoreOffline()).authorityKey, captureA.authorityKey);
  const participantOwnershipReads = [];
  local.registerParticipant({
    async quiesce() {
      participantOwnershipReads.push(await storage.withOwnership(
        appId,
        async (owner) => (await owner.read()).revision,
      ));
    },
    blank() {},
    clearMemory() {},
    async commitDurable() {
      participantOwnershipReads.push(await storage.withOwnership(
        appId,
        async (owner) => (await owner.read()).revision,
      ));
    },
  });
  const captureB = await writer.transition(
    captureA,
    successor(session(SESSION_B, USER_B), 'strict-owner-b', 90_000),
  );
  const restored = await local.restoreOffline();
  assert.equal(restored.authorityKey, captureB.authorityKey);
  assert.deepEqual(participantOwnershipReads, [captureB.custodyRevision, captureB.custodyRevision]);
  await local.close();
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

// Registration can also race the final exact owned read after resume has seen
// no remaining participants. Phase closure is checked inside that final fence;
// the late participant is caught up outside ownership and the record is then
// reconfirmed before exposure.
{
  const appId = `${APP}/late-registration-final-online-confirm`;
  const state = { custody: {} };
  const inner = createMemoryAuthCustodyStorage({ state });
  let armed = false;
  let reads = 0;
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const gatedStorage = {
    ...inner,
    withOwnership: (requestedAppId, operation) => inner.withOwnership(
      requestedAppId,
      (owner) => operation({
        ...owner,
        async read() {
          const record = await owner.read();
          if (armed) {
            reads += 1;
            if (reads === 3) {
              enteredResolve();
              await release;
            }
          }
          return record;
        },
      }),
    ),
  };
  const subject = new AuthCoordinator({
    appId,
    storage: gatedStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await subject.establishAnonymous(anonymous());
  armed = true;
  const pending = subject.transition(
    before,
    successor(session(), 'late-final-online-bearer', 10_000),
    'late_registration_final_online_confirm',
  );
  await entered;
  const phases = [];
  subject.registerParticipant({
    name: 'late-final-online-participant',
    async quiesce() { phases.push('quiesce'); },
    blank() { phases.push('blank'); },
    clearMemory() { phases.push('clearMemory'); },
    async commitDurable() { phases.push('commitDurable'); },
    async resume() { phases.push('resume'); },
  });
  assert.deepEqual(phases, ['blank', 'clearMemory']);
  releaseResolve();
  const settled = await pending;
  assert.deepEqual(phases, ['blank', 'clearMemory', 'commitDurable', 'resume']);
  assert.equal(subject.isCurrent(settled), true);
  await subject.close();
}

// Offline peer adoption has the same final-confirm registration window but no
// transport resume. The late participant must still receive durable cleanup
// before the successor becomes available for retained offline reads.
{
  const appId = `${APP}/late-registration-final-offline-confirm`;
  const state = { custody: {} };
  const writer = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const inner = createMemoryAuthCustodyStorage({ state });
  let armed = false;
  let reads = 0;
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const local = new AuthCoordinator({
    appId,
    storage: {
      ...inner,
      withOwnership: (requestedAppId, operation) => inner.withOwnership(
        requestedAppId,
        (owner) => operation({
          ...owner,
          async read() {
            const record = await owner.read();
            if (armed) {
              reads += 1;
              if (reads === 3) {
                enteredResolve();
                await release;
              }
            }
            return record;
          },
        }),
      ),
    },
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const anonymousCapture = await writer.establishAnonymous(anonymous());
  const captureA = await writer.transition(
    anonymousCapture,
    successor(session(SESSION_A, USER_A), 'late-final-offline-a', 10_000),
  );
  await local.restoreOffline();
  const captureB = await writer.transition(
    captureA,
    successor(session(SESSION_B, USER_B), 'late-final-offline-b', 20_000),
  );
  armed = true;
  const pending = local.restoreOffline();
  await entered;
  const phases = [];
  local.registerParticipant({
    name: 'late-final-offline-participant',
    async quiesce() { phases.push('quiesce'); },
    blank() { phases.push('blank'); },
    clearMemory() { phases.push('clearMemory'); },
    async commitDurable() { phases.push('commitDurable'); },
    async resume() { phases.push('resume'); },
  });
  assert.deepEqual(phases, ['blank', 'clearMemory']);
  releaseResolve();
  assert.deepEqual(await pending, captureB);
  assert.deepEqual(phases, ['blank', 'clearMemory', 'commitDurable']);
  assert.equal(local.isCurrent(captureB), true);
  await local.close();
  await writer.close();
}

// Malformed durable custody is a mandatory-gate failure. It must blank an
// already exposed predecessor before returning the corruption diagnostic;
// callers cannot keep using the old capture as an offline fallback.
{
  const state = { custody: {} };
  const inner = createMemoryAuthCustodyStorage({ state });
  let owned = false;
  const storage = {
    ...inner,
    async withOwnership(appId, operation) {
      if (owned) {
        throw Object.assign(new Error('nested custody ownership'), {
          code: 'TEST_REENTRANT_CUSTODY_OWNER',
        });
      }
      owned = true;
      try {
        return await inner.withOwnership(appId, operation);
      } finally {
        owned = false;
      }
    },
  };
  const malformed = new AuthCoordinator({
    appId: APP,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const exposed = await malformed.establishAnonymous(anonymous());
  const phases = [];
  malformed.registerParticipant({
    async quiesce() {
      await storage.withOwnership(APP, async (owner) => owner.read());
      phases.push('quiesce');
    },
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

// A Web Lock queues a nested ownership request until the current callback
// returns; it does not reject it as reentrant. A participant acknowledgment
// may therefore depend on work that reaches synchronize() while the local
// barrier is quiescing. The clearing CAS must release ownership before that
// acknowledgment, and the nested synchronization must fail promptly against
// the active clearing barrier rather than recursively replacing it.
{
  const appId = `${APP}/web-lock-participant-ack`;
  const inner = createMemoryAuthCustodyStorage();
  let tail = Promise.resolve();
  const lockEvents = [];
  const storage = {
    ...inner,
    withOwnership(requestedAppId, operation) {
      lockEvents.push('requested');
      const acquired = tail.then(async () => {
        lockEvents.push('acquired');
        try {
          return await inner.withOwnership(requestedAppId, operation);
        } finally {
          lockEvents.push('released');
        }
      });
      tail = acquired.catch(() => {});
      return acquired;
    },
  };
  const subject = new AuthCoordinator({
    appId,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const capture = await subject.establishAnonymous(anonymous());
  const phases = [];
  subject.registerParticipant({
    name: 'synchronize-dependent-ack',
    async quiesce() {
      phases.push('quiesce:start');
      assert.equal(lockEvents.at(-1), 'released');
      const synchronization = subject.synchronize();
      assert.equal(lockEvents.at(-1), 'requested');
      assert.equal(
        await errorCode(() => synchronization),
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
      );
      phases.push('quiesce:settled');
    },
    blank() { phases.push('blank'); },
    clearMemory() { phases.push('clearMemory'); },
    async commitDurable() { phases.push('commitDurable'); },
    async resume() { phases.push('resume'); },
  });
  const settled = await withDeadline(subject.transition(
    capture,
    successor(session(), 'web-lock-participant-ack-bearer', 50_000),
    'web_lock_participant_ack',
  ), 'Web-Lock-faithful participant acknowledgment');
  assert.equal(subject.isCurrent(settled), true);
  assert.deepEqual(phases, [
    'quiesce:start',
    'quiesce:settled',
    'blank',
    'clearMemory',
    'commitDurable',
    'resume',
  ]);
  const requested = lockEvents.filter((event) => event === 'requested').length;
  assert.equal(requested >= 5, true);
  assert.equal(lockEvents.filter((event) => event === 'acquired').length, requested);
  assert.equal(lockEvents.filter((event) => event === 'released').length, requested);
  assert.equal(lockEvents.at(-1), 'released');
  await subject.close();
}

// A clearing publication can wake client machinery that synchronizes before
// touching authority. Treat CLEARING as an immediately retryable refusal and
// that listener can build an unbounded promise-microtask loop while the real
// barrier is still settling. External synchronizers must instead join the
// active barrier completion; participant-callback reentry above remains a
// prompt refusal because joining the barrier from quiesce would self-deadlock.
{
  const appId = `${APP}/clearing-publication-retry-spin`;
  const inner = createMemoryAuthCustodyStorage();
  let tail = Promise.resolve();
  const storage = {
    ...inner,
    withOwnership(requestedAppId, operation) {
      const acquired = tail.then(() => inner.withOwnership(requestedAppId, operation));
      tail = acquired.catch(() => {});
      return acquired;
    },
  };
  let reactToPublish = false;
  let subject;
  let publicationParticipant;
  let synchronizeCount = 0;
  const listenerSettlements = [];
  const synchronizeLikeClient = async () => {
    synchronizeCount += 1;
    if (synchronizeCount > 256) return;
    try {
      await subject.synchronize();
    } catch (error) {
      if (error?.code !== 'SNAPBACK_CLIENT_AUTHORITY_CLEARING') throw error;
      await Promise.resolve();
      return synchronizeLikeClient();
    }
  };
  subject = new AuthCoordinator({
    appId,
    storage,
    broadcastChannelFactory: () => ({
      onmessage: null,
      postMessage() {
        if (!reactToPublish) return;
        publicationParticipant.onPublish();
      },
      close() {},
    }),
    hintStorage: null,
  });
  const capture = await subject.establishAnonymous(anonymous());
  publicationParticipant = {
    name: 'slow-clearing-publication-observer',
    onPublish() {
      listenerSettlements.push(Promise.resolve().then(synchronizeLikeClient));
    },
    async quiesce() {
      // Model a busy list/live participant yielding through already-queued
      // listener work without introducing sockets or wall-clock timing.
      for (let turn = 0; turn < 64; turn += 1) await Promise.resolve();
    },
    blank() {},
    clearMemory() {},
    async commitDurable() {},
    async resume() {},
  };
  subject.registerParticipant(publicationParticipant);
  reactToPublish = true;
  const settled = await withDeadline(subject.transition(
    capture,
    successor(session(), 'clearing-publication-retry-spin-bearer', 50_000),
    'clearing_publication_retry_spin',
  ), 'clearing publication retry settlement');
  await withDeadline(Promise.all(listenerSettlements), 'clearing publication listeners');
  assert.equal(subject.isCurrent(settled), true);
  assert.equal(
    synchronizeCount <= 4,
    true,
    `clearing publication retried synchronize ${synchronizeCount} times`,
  );
  await subject.close();
}

// External authority operations join the active local barrier. In particular,
// logout's compare-and-clear and a same-successor authority transition cannot
// leak a transient CLEARING refusal or settle early while the predecessor is
// still being quiesced. Participant callback reentry remains the prompt-refusal
// exception covered by the Web-Lock-faithful test above.
{
  const subject = new AuthCoordinator({
    appId: `${APP}/queued-authority-operations`,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const anonymousCapture = await subject.establishAnonymous(anonymous());
  const sessionCapture = await subject.transition(
    anonymousCapture,
    successor(session(), 'queued-authority-operations-bearer', 50_000),
    'signin',
  );
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  subject.registerParticipant({
    name: 'queued-authority-operations-gate',
    async quiesce(context) {
      if (context.reason !== 'logout') return;
      enteredResolve();
      await release;
    },
  });
  const anonymousSuccessor = successor(anonymous(), null, null);
  const logout = subject.transition(sessionCapture, anonymousSuccessor, 'logout');
  await entered;
  const duplicateLogout = subject.compareAndClear(sessionCapture, 'logout');
  const duplicateTransition = subject.transition(
    sessionCapture,
    anonymousSuccessor,
    'logout-duplicate',
  );
  const early = Symbol('early');
  assert.equal(
    await Promise.race([
      Promise.all([duplicateLogout, duplicateTransition]),
      new Promise((resolve) => setTimeout(() => resolve(early), 10)),
    ]),
    early,
    'authority operations must remain queued until the active barrier settles',
  );
  releaseResolve();
  const settled = await logout;
  assert.deepEqual(await duplicateLogout, { cleared: false });
  assert.deepEqual(await duplicateTransition, settled);
  assert.equal(subject.authority.kind, 'anonymous');
  await subject.close();
}

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
    appId: `${APP}/participant-ownership-release`,
    storage: observingStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const capture = await phase8.establishAnonymous(anonymous());
  phase8.registerParticipant({
    name: 'participant-ownership-release-observer',
    quiesce: async () => assert.equal(owned, false),
    blank: () => assert.equal(owned, false),
    clearMemory: () => assert.equal(owned, false),
    commitDurable: async () => assert.equal(owned, false),
    resume: async () => assert.equal(owned, false),
  });
  await phase8.transition(capture, {
    authority: session(),
    bearer: 'phase8-successor',
    refreshAfterMs: 50_000,
  });
  await phase8.close();
}

// A server-witnessed anonymous authority can replace custody without a
// capture only after ordinary publication has failed closed. Healthy settled
// custody must continue to require capture-scoped transition/compareAndClear.
{
  const newIncarnation = '018f0d90-7c11-7a22-8c33-445566778899';
  const observed = {
    kind: 'anonymous',
    authMode: 'sessions',
    authorizationStreamIncarnation: newIncarnation,
  };
  const healthy = new AuthCoordinator({
    appId: `${APP}/unrecognized-recovery-healthy`,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await healthy.establishAnonymous(anonymous());
  assert.equal(
    await errorCode(() => healthy.recoverUnrecognizedAuthority(observed)),
    'SNAPBACK_CLIENT_AUTHORITY_STALE',
  );
  assert.equal(healthy.authority.authorizationStreamIncarnation, INCARNATION);
  await healthy.close();

  const appId = `${APP}/unrecognized-recovery-paused`;
  const storage = createMemoryAuthCustodyStorage();
  const paused = new AuthCoordinator({
    appId,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const anonymousCapture = await paused.establishAnonymous(anonymous());
  const recoveryPhases = [];
  let failResume = true;
  paused.registerParticipant({
    name: 'fail-resume-once-before-unrecognized-recovery',
    async quiesce() { recoveryPhases.push('quiesce'); },
    blank() { recoveryPhases.push('blank'); },
    clearMemory() { recoveryPhases.push('clearMemory'); },
    async commitDurable() { recoveryPhases.push('commitDurable'); },
    async resume() {
      recoveryPhases.push('resume');
      if (failResume) {
        failResume = false;
        throw Object.assign(new Error('resume failed'), { code: 'TEST_RESUME_FAILED' });
      }
    },
  });
  await assert.rejects(
    paused.transition(
      anonymousCapture,
      successor(session(), 'unrecognized-paused-bearer', 10_000),
      'install_paused_session',
    ),
    (error) => error.code === 'SNAPBACK_AUTH_TRANSITION_FAILED',
  );
  assert.throws(() => paused.capture(), { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING' });
  await assert.rejects(
    paused.recoverUnrecognizedAuthority(session(SESSION_B, USER_B)),
    (error) => error.code === 'SNAPBACK_AUTH_CUSTODY_BOOTSTRAP_INVALID',
  );
  await assert.rejects(
    paused.recoverUnrecognizedAuthority(anonymous()),
    (error) => error.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE',
  );
  recoveryPhases.length = 0;
  const recovered = await paused.recoverUnrecognizedAuthority(
    observed,
    'server_unrecognized_authority',
  );
  assert.equal(paused.isCurrent(recovered), true);
  assert.deepEqual(recoveryPhases, [
    'quiesce',
    'blank',
    'clearMemory',
    'commitDurable',
    'resume',
  ]);
  assert.deepEqual(paused.authority, {
    ...observed,
    isAuthenticated: false,
  });
  assert.equal(storage.snapshot(appId).bearer, null);
  await paused.close();
}

// A failed commit leaves durable clearing custody. Recovery retargets that
// record directly to the witnessed anonymous incarnation and still runs the
// complete standard barrier before reopening publication.
{
  const appId = `${APP}/unrecognized-recovery-clearing`;
  const storage = createMemoryAuthCustodyStorage();
  const subject = new AuthCoordinator({
    appId,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const capture = await subject.establishAnonymous(anonymous());
  let failCommit = true;
  const phases = [];
  subject.registerParticipant({
    name: 'fail-commit-once-before-unrecognized-recovery',
    async quiesce() { phases.push('quiesce'); },
    blank() { phases.push('blank'); },
    clearMemory() { phases.push('clearMemory'); },
    async commitDurable() {
      phases.push('commitDurable');
      if (failCommit) {
        failCommit = false;
        throw Object.assign(new Error('commit failed'), { code: 'TEST_COMMIT_FAILED' });
      }
    },
    async resume() { phases.push('resume'); },
  });
  await assert.rejects(
    subject.transition(
      capture,
      successor(session(), 'unrecognized-clearing-bearer', 10_000),
      'strand_clearing',
    ),
    (error) => error.code === 'SNAPBACK_AUTH_TRANSITION_FAILED',
  );
  assert.equal(storage.snapshot(appId).phase, 'clearing');
  phases.length = 0;
  await subject.recoverUnrecognizedAuthority({
    kind: 'anonymous',
    authMode: 'sessions',
    authorizationStreamIncarnation: '018f0d90-7c12-7a22-8c33-445566778899',
  });
  assert.deepEqual(phases, [
    'quiesce',
    'blank',
    'clearMemory',
    'commitDurable',
    'resume',
  ]);
  assert.equal(storage.snapshot(appId).phase, 'settled');
  assert.equal(storage.snapshot(appId).authority.kind, 'anonymous');
  await subject.close();
}

// The capture-free lane snapshots the paused local comparison identity before
// ownership. A peer that signs in first wins; recovery performs no barrier
// callbacks and cannot blank or replace that fresh session.
{
  const appId = `${APP}/unrecognized-recovery-peer-wins`;
  const baseStorage = createMemoryAuthCustodyStorage();
  let delayNextOwnership = false;
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const delayedStorage = {
    ...baseStorage,
    withOwnership(requestedAppId, operation) {
      if (delayNextOwnership) {
        delayNextOwnership = false;
        enteredResolve();
        return release.then(() => baseStorage.withOwnership(requestedAppId, operation));
      }
      return baseStorage.withOwnership(requestedAppId, operation);
    },
  };
  const staleTab = new AuthCoordinator({
    appId,
    storage: delayedStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const freshTab = new AuthCoordinator({
    appId,
    storage: baseStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const anonymousCapture = await staleTab.establishAnonymous(anonymous());
  let failResume = true;
  let recoveryBlankCount = 0;
  staleTab.registerParticipant({
    blank() { recoveryBlankCount += 1; },
    async resume() {
      if (failResume) {
        failResume = false;
        throw Object.assign(new Error('pause stale tab'), { code: 'TEST_RESUME_FAILED' });
      }
    },
  });
  await assert.rejects(
    staleTab.transition(
      anonymousCapture,
      successor(session(), 'peer-race-stale-bearer', 10_000),
      'pause_stale_tab',
    ),
    (error) => error.code === 'SNAPBACK_AUTH_TRANSITION_FAILED',
  );
  const freshCapture = await freshTab.synchronize();
  recoveryBlankCount = 0;
  delayNextOwnership = true;
  const recovery = staleTab.recoverUnrecognizedAuthority({
    kind: 'anonymous',
    authMode: 'sessions',
    authorizationStreamIncarnation: '018f0d90-7c13-7a22-8c33-445566778899',
  });
  await entered;
  const freshAuthority = {
    kind: 'session',
    authMode: 'sessions',
    authorizationStreamIncarnation: '018f0d90-7c13-7a22-8c33-445566778899',
    sessionId: SESSION_B,
    userId: USER_B,
  };
  const signedIn = await freshTab.transition(
    freshCapture,
    successor(freshAuthority, 'peer-race-fresh-bearer', 20_000),
    'peer_fresh_sign_in',
  );
  releaseResolve();
  assert.equal(
    await errorCode(() => recovery),
    'SNAPBACK_CLIENT_AUTHORITY_STALE',
  );
  assert.equal(recoveryBlankCount, 0);
  assert.equal(freshTab.isCurrent(signedIn), true);
  assert.deepEqual(baseStorage.snapshot(appId).authority, freshAuthority);
  assert.equal(baseStorage.snapshot(appId).bearer, 'peer-race-fresh-bearer');
  await freshTab.close();
  await staleTab.close();
}

// A paused v3 sender-custody shell may recover only to anonymous v2. The
// standard barrier deletes the bearer and sender key instead of retaining a
// format-3 anonymous shell.
{
  const appId = `${APP}/unrecognized-recovery-v3`;
  const storage = createMemoryAuthCustodyStorage();
  const subject = new AuthCoordinator({
    appId,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const capture = await subject.establishAnonymous(anonymous());
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  const exported = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const publicJwk = { crv: 'P-256', kty: 'EC', x: exported.x, y: exported.y };
  const thumbprint = Buffer.from(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(publicJwk)),
  )).toString('base64url');
  const senderConstraint = {
    formatVersion: 1,
    protocol: 'snapback.sender-constrained.v2',
    custodyGeneration: 1,
    privateKey: keyPair.privateKey,
    publicJwk,
    thumbprint,
    nonce: {
      value: Buffer.alloc(32, 7).toString('base64url'),
      generation: 1,
      expiresAtMs: 60_000,
    },
  };
  let failResume = true;
  subject.registerParticipant({
    async resume() {
      if (failResume) {
        failResume = false;
        throw Object.assign(new Error('pause v3 custody'), { code: 'TEST_RESUME_FAILED' });
      }
    },
  });
  await assert.rejects(
    subject.transition(capture, {
      authority: session(),
      bearer: 'unrecognized-v3-bearer',
      refreshAfterMs: 10_000,
      senderConstraint,
    }, 'install_v3_session'),
    (error) => error.code === 'SNAPBACK_AUTH_TRANSITION_FAILED',
  );
  assert.equal(
    storage.snapshot(appId).formatVersion,
    SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION,
  );
  await subject.recoverUnrecognizedAuthority({
    kind: 'anonymous',
    authMode: 'sessions',
    authorizationStreamIncarnation: '018f0d90-7c14-7a22-8c33-445566778899',
  });
  const recovered = storage.snapshot(appId);
  assert.equal(recovered.formatVersion, SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION);
  assert.equal(recovered.authority.kind, 'anonymous');
  assert.equal(Object.hasOwn(recovered, 'senderConstraint'), false);
  assert.equal(JSON.stringify(recovered).includes('unrecognized-v3-bearer'), false);
  await subject.close();
}
console.log('auth coordinator conformance: ok');
