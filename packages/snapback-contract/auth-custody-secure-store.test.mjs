import assert from 'node:assert/strict';
import test from 'node:test';

import { createSecureStoreAuthCustodyStorage } from '@expo/snapback-contract/auth-custody-secure-store';

import {
  AuthCoordinator,
  SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
  SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION,
  authAppIdHash,
} from './auth-coordinator.mjs';

const APP = 'snapback.test/auth-custody-secure-store';
const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const SESSION = '018f0d90-7b12-7a22-8c33-445566778899';
const USER = '018f0d90-7b14-7a22-8c33-445566778899';

const anonymous = () => ({
  kind: 'anonymous',
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
});

const session = () => ({
  kind: 'session',
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
  sessionId: SESSION,
  userId: USER,
});

const settled = ({
  appId = APP,
  authority = anonymous(),
  authorityEpoch = 0,
  revision = 1,
  bearer = authority.kind === 'session' ? 'secure-store-bearer' : null,
  refreshAfterMs = authority.kind === 'session' ? 10_000 : null,
} = {}) => ({
  formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
  appId,
  authorityEpoch,
  revision,
  phase: 'settled',
  authority,
  pendingAuthority: null,
  bearer,
  pendingBearer: null,
  refreshAfterMs,
  transitionIntent: null,
});

function secureStoreHarness() {
  const bytes = new Map();
  return {
    bytes,
    module: {
      async getItemAsync(key) { return bytes.get(key) ?? null; },
      async setItemAsync(key, value) { bytes.set(key, value); },
      async deleteItemAsync(key) { bytes.delete(key); },
    },
  };
}

const expectCode = (code, operation) => assert.rejects(
  operation,
  (error) => error?.code === code && error?.diagnostic?.code === code,
);

test('settled SecureStore session restores across coordinator restart', async () => {
  const { module: SecureStore } = secureStoreHarness();
  const appId = `${APP}/restart`;
  const authStorage = createSecureStoreAuthCustodyStorage(SecureStore);
  const authCoordinator = new AuthCoordinator({
    appId,
    storage: authStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const anonymousCapture = await authCoordinator.establishAnonymous(anonymous());
  await authCoordinator.transition(
    anonymousCapture,
    { authority: session(), bearer: 'secure-store-bearer', refreshAfterMs: 10_000 },
    'secure_store_fixture',
  );
  await authCoordinator.close();

  const restored = new AuthCoordinator({
    appId,
    storage: createSecureStoreAuthCustodyStorage(SecureStore),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await restored.synchronize();
  assert.equal(restored.settledView().authority.kind, 'session');
  assert.equal(restored.credentialFor(restored.capture()).bearer, 'secure-store-bearer');
  await restored.close();
});

test('compare-and-swap staleness carries the canonical typed code', async () => {
  const { module: SecureStore } = secureStoreHarness();
  const storage = createSecureStoreAuthCustodyStorage(SecureStore);
  await storage.withOwnership(APP, (owner) => owner.replace(null, settled()));
  await expectCode(
    'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
    () => storage.withOwnership(APP, (owner) => owner.replace(null, settled({ revision: 2 }))),
  );
});

test('corrupted SecureStore JSON is a typed validation refusal', async () => {
  const { module: SecureStore, bytes } = secureStoreHarness();
  bytes.set(`snapback.auth-custody.${authAppIdHash(APP)}`, '{not-json');
  const storage = createSecureStoreAuthCustodyStorage(SecureStore);
  await expectCode(
    'SNAPBACK_AUTH_CUSTODY_CORRUPT',
    () => storage.withOwnership(APP, (owner) => owner.read()),
  );
});

test('sender-constrained custody refuses instead of stripping key material', async () => {
  const { module: SecureStore } = secureStoreHarness();
  const storage = createSecureStoreAuthCustodyStorage(SecureStore);
  const senderRecord = {
    ...settled({ authority: session() }),
    formatVersion: SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION,
    senderConstraint: { privateKey: { opaque: true } },
    pendingSenderConstraint: null,
  };
  await expectCode(
    'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED',
    () => storage.withOwnership(APP, (owner) => owner.replace(null, senderRecord)),
  );
});

test('withOwnership serializes read/replace across adapter instances', async () => {
  const { module: SecureStore } = secureStoreHarness();
  const first = createSecureStoreAuthCustodyStorage(SecureStore);
  const second = createSecureStoreAuthCustodyStorage(SecureStore);
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let firstRead;
  const firstReadDone = new Promise((resolve) => { firstRead = resolve; });
  const order = [];

  const firstTask = first.withOwnership(APP, async (owner) => {
    order.push('first:read');
    assert.equal(await owner.read(), null);
    firstRead();
    await firstGate;
    order.push('first:replace');
    await owner.replace(null, settled());
  });
  await firstReadDone;

  const secondTask = second.withOwnership(APP, async (owner) => {
    order.push('second:read');
    return owner.read();
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(order, ['first:read']);

  releaseFirst();
  await firstTask;
  assert.deepEqual(await secondTask, settled());
  assert.deepEqual(order, ['first:read', 'first:replace', 'second:read']);
});

test('fresh, revision, and authority-epoch invariants reject corruption', async () => {
  const { module: SecureStore } = secureStoreHarness();
  const storage = createSecureStoreAuthCustodyStorage(SecureStore);

  await expectCode(
    'SNAPBACK_AUTH_CUSTODY_CORRUPT',
    () => storage.withOwnership(APP, (owner) => owner.replace(null, settled({ revision: 2 }))),
  );
  await storage.withOwnership(APP, (owner) => owner.replace(null, settled()));
  await expectCode(
    'SNAPBACK_AUTH_CUSTODY_CORRUPT',
    () => storage.withOwnership(APP, (owner) => owner.replace(1, settled({ revision: 3 }))),
  );
  await storage.withOwnership(
    APP,
    (owner) => owner.replace(1, settled({ authorityEpoch: 1, revision: 2 })),
  );
  await expectCode(
    'SNAPBACK_AUTH_CUSTODY_CORRUPT',
    () => storage.withOwnership(
      APP,
      (owner) => owner.replace(2, settled({ authorityEpoch: 0, revision: 3 })),
    ),
  );
  await expectCode(
    'SNAPBACK_AUTH_CUSTODY_CORRUPT',
    () => storage.withOwnership(
      APP,
      (owner) => owner.replace(2, settled({ authorityEpoch: 3, revision: 3 })),
    ),
  );
});

test('raw SecureStore read and write failures use the storage-error shape', async () => {
  const readFailure = createSecureStoreAuthCustodyStorage({
    async getItemAsync() { throw new Error('platform read failure'); },
    async setItemAsync() {},
  });
  await expectCode(
    'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED',
    () => readFailure.withOwnership(APP, (owner) => owner.read()),
  );

  const writeFailure = createSecureStoreAuthCustodyStorage({
    async getItemAsync() { return null; },
    async setItemAsync() { throw new Error('platform write failure'); },
  });
  await expectCode(
    'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED',
    () => writeFailure.withOwnership(APP, (owner) => owner.replace(null, settled())),
  );
});
