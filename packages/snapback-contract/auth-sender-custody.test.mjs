import assert from 'node:assert/strict';

import { IDBFactory } from 'fake-indexeddb';

import {
  AuthCoordinator,
  SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
  SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION,
  createMemoryAuthCustodyStorage,
  validateAuthCustodySenderKeys,
} from './auth-coordinator.mjs';
import { createIndexedDbAuthCustodyStorage } from './auth-custody-indexeddb.mjs';

const APP = 'snapback.test/sender-custody-v3';
const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const SESSION_A = '018f0d90-7b12-7a22-8c33-445566778899';
const SESSION_B = '018f0d90-7b13-7a22-8c33-445566778899';
const USER = '018f0d90-7b14-7a22-8c33-445566778899';
const NONCE_1 = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
const NONCE_2 = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI';

const anonymous = () => ({
  kind: 'anonymous',
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
});

const session = (sessionId = SESSION_A) => ({
  kind: 'session',
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
  sessionId,
  userId: USER,
});

const base64url = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};

async function senderConstraint(nonce = NONCE_1) {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const publicJwk = {
    crv: 'P-256',
    kty: 'EC',
    x: exported.x,
    y: exported.y,
  };
  const thumbprint = base64url(new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(publicJwk)),
  )));
  return {
    formatVersion: 1,
    protocol: 'snapback.sender-constrained.v2',
    custodyGeneration: 1,
    privateKey: pair.privateKey,
    publicJwk,
    thumbprint,
    nonce: {
      value: nonce,
      generation: 1,
      expiresAtMs: 60_000,
    },
  };
}

const coordinator = (appId, storage) => new AuthCoordinator({
  appId,
  storage,
  broadcastChannelFactory: null,
  hintStorage: null,
});

// Cross-context wakeups, localStorage hints, and app-visible settled state
// carry generations only. Browser credential/key/nonce material remains
// confined to the transactional custody record and explicit signing path.
{
  const appId = `${APP}/forbidden-carriers`;
  const broadcasts = [];
  const hints = [];
  const storage = createMemoryAuthCustodyStorage();
  const subject = new AuthCoordinator({
    appId,
    storage,
    broadcastChannelFactory: () => ({
      postMessage(message) {
        broadcasts.push(structuredClone(message));
      },
      close() {},
    }),
    hintStorage: {
      setItem(key, value) {
        hints.push([key, value]);
      },
    },
  });
  const initial = await subject.establishAnonymous(anonymous());
  const installed = await senderConstraint();
  const bearer = 'sbs_sender_forbidden_carrier_sentinel';
  await subject.transition(initial, {
    authority: session(),
    bearer,
    refreshAfterMs: 10_000,
    senderConstraint: installed,
  });
  const appVisibleBytes = JSON.stringify({
    broadcasts,
    hints,
    settledView: subject.settledView(),
  });
  for (const forbidden of [
    bearer,
    NONCE_1,
    installed.thumbprint,
    installed.publicJwk.x,
    installed.publicJwk.y,
    'privateKey',
    'senderConstraint',
  ]) {
    assert.equal(
      appVisibleBytes.includes(forbidden),
      false,
      `${forbidden} escaped transactional custody`,
    );
  }
  await subject.close();
}

// A failed local barrier leaves one recoverable clearing record containing the
// pending bearer and key. A new context settles that exact record.
{
  const state = { custody: {} };
  const storage = createMemoryAuthCustodyStorage({ state });
  const first = coordinator(APP, storage);
  const anonymousCapture = await first.establishAnonymous(anonymous());
  const constraint = await senderConstraint();
  let failOnce = true;
  first.registerParticipant({
    async commitDurable() {
      if (failOnce) {
        failOnce = false;
        throw new Error('simulated local durable cleanup failure');
      }
    },
  });
  await assert.rejects(
    first.transition(anonymousCapture, {
      authority: session(),
      bearer: 'sbs_sender_bound',
      refreshAfterMs: 10_000,
      senderConstraint: constraint,
    }),
    (error) => error.code === 'SNAPBACK_AUTH_TRANSITION_FAILED',
  );
  const clearing = storage.snapshot(APP);
  assert.equal(clearing.formatVersion, SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION);
  assert.equal(clearing.phase, 'clearing');
  assert.equal(clearing.bearer, null);
  assert.equal(clearing.senderConstraint, null);
  assert.equal(clearing.pendingBearer, 'sbs_sender_bound');
  assert.equal(clearing.pendingSenderConstraint.thumbprint, constraint.thumbprint);

  const recovery = coordinator(APP, storage);
  const sessionCapture = await recovery.synchronize();
  const credential = recovery.senderCredentialFor(sessionCapture);
  assert.equal(credential.senderConstraint.privateKey.extractable, false);
  assert.equal(credential.senderConstraint.thumbprint, constraint.thumbprint);

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    credential.senderConstraint.privateKey,
    new TextEncoder().encode('survived-recovery'),
  );
  assert.equal(new Uint8Array(signature).byteLength, 64);

  const rotated = await recovery.compareAndRotateSenderCredential(sessionCapture, {
    bearer: 'sbs_sender_bound_rotated',
    refreshAfterMs: 20_000,
    expectedSenderGeneration: 1,
    nonce: {
      value: NONCE_2,
      generation: 2,
      expiresAtMs: 70_000,
    },
  });
  assert.equal(rotated.rotated, true);
  assert.equal(
    recovery.senderCredentialFor(rotated.capture).senderConstraint.custodyGeneration,
    2,
  );
  assert.deepEqual(
    await recovery.compareAndRotateSenderCredential(sessionCapture, {
      bearer: 'stale',
      refreshAfterMs: 30_000,
      expectedSenderGeneration: 1,
      nonce: { value: NONCE_2, generation: 2, expiresAtMs: 80_000 },
    }),
    { rotated: false },
  );
  await assert.rejects(
    recovery.compareAndRotateBearer(rotated.capture, {
      bearer: 'unfenced',
      refreshAfterMs: 30_000,
    }),
    (error) => error.code === 'SNAPBACK_AUTH_SENDER_CUSTODY_REQUIRED',
  );

  assert.equal((await recovery.compareAndClear(rotated.capture, 'logout')).cleared, true);
  const loggedOut = storage.snapshot(APP);
  assert.equal(loggedOut.formatVersion, SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION);
  assert.equal(loggedOut.phase, 'settled');
  assert.equal(loggedOut.authority.kind, 'anonymous');
  assert.equal('senderConstraint' in loggedOut, false);
}

// A legacy bearer-only session cannot be silently upgraded in place.
{
  const appId = `${APP}/no-implicit-upgrade`;
  const storage = createMemoryAuthCustodyStorage();
  const subject = coordinator(appId, storage);
  const initial = await subject.establishAnonymous(anonymous());
  const legacy = await subject.transition(initial, {
    authority: session(),
    bearer: 'sbs_legacy',
    refreshAfterMs: 10_000,
  });
  await assert.rejects(
    subject.transition(legacy, {
      authority: session(SESSION_B),
      bearer: 'sbs_illegal_upgrade',
      refreshAfterMs: 20_000,
      senderConstraint: await senderConstraint(),
    }),
    (error) => error.code === 'SNAPBACK_AUTH_SENDER_CUSTODY_UPGRADE_REQUIRED',
  );
}

// The sender-flight namespace serializes network-shaped callbacks across
// coordinators without holding the custody lock they use for nonce CAS.
{
  const appId = `${APP}/serialized-flights`;
  const state = { custody: {} };
  const first = coordinator(appId, createMemoryAuthCustodyStorage({ state }));
  const second = coordinator(appId, createMemoryAuthCustodyStorage({ state }));
  const anonymousCapture = await first.establishAnonymous(anonymous());
  const installed = await first.transition(anonymousCapture, {
    authority: session(),
    bearer: 'sbs_serialized',
    refreshAfterMs: 10_000,
    senderConstraint: await senderConstraint(),
  });
  const restored = await second.synchronize();
  let inFlight = 0;
  let maximumInFlight = 0;
  const enter = async ({ credential }) => {
    assert.equal(credential.bearer, 'sbs_serialized');
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
  };
  await Promise.all([
    first.withSenderRequestSerialization(installed, enter),
    second.withSenderRequestSerialization(restored, enter),
  ]);
  assert.equal(maximumInFlight, 1);

  const socketFlight = await first.beginSenderRequestSerialization(installed);
  let queuedEntered = false;
  const queued = second.withSenderRequestSerialization(restored, async () => {
    queuedEntered = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(queuedEntered, false, 'WebSocket initiation retains the flight lock');
  await socketFlight.release();
  await queued;
  assert.equal(queuedEntered, true);
}

// Sender-request serialization tails include storagePartition: preview and
// staging can each hold one proof flight without sharing a hidden app-only
// tail, while each partition still uses its own custody record.
{
  const state = { custody: {} };
  const storage = createMemoryAuthCustodyStorage({ state });
  const preview = new AuthCoordinator({
    appId: APP,
    storagePartition: 'preview',
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const staging = new AuthCoordinator({
    appId: APP,
    storagePartition: 'staging',
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const previewAnonymous = await preview.establishAnonymous(anonymous());
  const stagingAnonymous = await staging.establishAnonymous(anonymous());
  const previewSession = await preview.transition(previewAnonymous, {
    authority: session(SESSION_A),
    bearer: 'sbs_preview_serialized',
    refreshAfterMs: 10_000,
    senderConstraint: await senderConstraint(),
  });
  const stagingSession = await staging.transition(stagingAnonymous, {
    authority: session(SESSION_B),
    bearer: 'sbs_staging_serialized',
    refreshAfterMs: 10_000,
    senderConstraint: await senderConstraint(NONCE_2),
  });
  let inFlight = 0;
  let maximumInFlight = 0;
  const entered = [];
  const release = [];
  const flight = (partition) => async () => {
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    entered.push(partition);
    await new Promise((resolve) => { release.push(resolve); });
    inFlight -= 1;
  };
  const previewFlight = preview.withSenderRequestSerialization(
    previewSession,
    flight('preview'),
  );
  const stagingFlight = staging.withSenderRequestSerialization(
    stagingSession,
    flight('staging'),
  );
  while (entered.length < 2) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(new Set(entered), new Set(['preview', 'staging']));
  assert.equal(maximumInFlight, 2, 'partitioned sender-request tails are independent');
  for (const resolve of release) resolve();
  await Promise.all([previewFlight, stagingFlight]);
  await preview.close();
  await staging.close();
}

// IndexedDB clones the non-extractable CryptoKey inside the same custody row.
{
  const appId = `${APP}/indexeddb`;
  const indexedDB = new IDBFactory();
  const databaseName = `sender-custody-v3-${crypto.randomUUID()}`;
  const storageA = createIndexedDbAuthCustodyStorage({
    indexedDB,
    databaseName,
    cryptoObject: crypto,
  });
  const first = coordinator(appId, storageA);
  const initial = await first.establishAnonymous(anonymous());
  const installed = await senderConstraint();
  await first.transition(initial, {
    authority: session(),
    bearer: 'sbs_indexeddb',
    refreshAfterMs: 10_000,
    senderConstraint: installed,
  });
  await first.close();
  await storageA.close();

  const storageB = createIndexedDbAuthCustodyStorage({
    indexedDB,
    databaseName,
    cryptoObject: crypto,
  });
  const second = coordinator(appId, storageB);
  const restoredCapture = await second.synchronize();
  const restored = second.senderCredentialFor(restoredCapture);
  assert.equal(restored.senderConstraint.thumbprint, installed.thumbprint);
  assert.equal(restored.senderConstraint.privateKey.extractable, false);
  await second.close();
  await storageB.close();
}

// Shape-valid but mismatched key material fails the asynchronous self-check.
{
  const state = { custody: {} };
  const storage = createMemoryAuthCustodyStorage({ state });
  const subject = coordinator(`${APP}/mismatch`, storage);
  const initial = await subject.establishAnonymous(anonymous());
  const installed = await senderConstraint();
  await subject.transition(initial, {
    authority: session(),
    bearer: 'sbs_mismatch',
    refreshAfterMs: 10_000,
    senderConstraint: installed,
  });
  const record = storage.snapshot(`${APP}/mismatch`);
  const other = await senderConstraint();
  record.senderConstraint.publicJwk = other.publicJwk;
  record.senderConstraint.thumbprint = other.thumbprint;
  await assert.rejects(
    validateAuthCustodySenderKeys(record, `${APP}/mismatch`),
    (error) => error.code === 'SNAPBACK_AUTH_CUSTODY_CORRUPT',
  );
}

console.log('auth sender custody v3: ok');
