import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED,
  createNativeAuthCustodyStorage,
} from './index.mjs';
import {
  SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
  SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION,
} from '@expo/snapback-contract/auth-coordinator';

const APP = 'snapback.test/native-custody';
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
  bearer = authority.kind === 'session' ? 'native-custody-bearer' : null,
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

function fakeNativeModule({ os = 'ios' } = {}) {
  const records = new Map();
  const calls = [];
  const module = {
    records,
    calls,
    readOutcome: null,
    refusal: false,
    forceNextCasStale: undefined,
    async platformGrade() {
      calls.push(['platformGrade']);
      if (this.refusal) {
        return { status: 'single-runtime-refused', platform: os, process: 'test-secondary' };
      }
      return {
        status: 'ok',
        os,
        grade: 'single-runtime',
        mechanism: os === 'ios' ? 'keychain-serial-cas' : 'datastore-keystore-aes-gcm',
        moduleVersion: '0.1.0',
      };
    },
    async read(appId, storageKey) {
      calls.push(['read', appId, storageKey]);
      if (this.refusal) {
        return { status: 'single-runtime-refused', platform: os, process: 'test-secondary' };
      }
      if (this.readOutcome) return this.readOutcome;
      return { status: 'ok', record: records.get(storageKey) ?? null };
    },
    async compareAndReplace(appId, storageKey, expectedRevision, serializedRecord) {
      calls.push([
        'compareAndReplace',
        appId,
        storageKey,
        expectedRevision,
        serializedRecord,
      ]);
      if (this.refusal) {
        return { status: 'single-runtime-refused', platform: os, process: 'test-secondary' };
      }
      if (this.forceNextCasStale !== undefined) {
        const actualRevision = this.forceNextCasStale;
        this.forceNextCasStale = undefined;
        return { status: 'cas-stale', expectedRevision, actualRevision };
      }
      const current = records.get(storageKey);
      const actualRevision = current === undefined ? null : JSON.parse(current).revision;
      if (actualRevision !== expectedRevision) {
        return { status: 'cas-stale', expectedRevision, actualRevision };
      }
      records.set(storageKey, serializedRecord);
      return { status: 'ok', record: records.get(storageKey) };
    },
  };
  return module;
}

const expectCode = (code, operation) => assert.rejects(
  operation,
  (error) => error?.code === code && error?.diagnostic?.code === code,
);

test('platform grade and native CAS happy path expose the selected single-runtime mechanism', async () => {
  const nativeModule = fakeNativeModule();
  const storage = createNativeAuthCustodyStorage({ nativeModule });
  assert.deepEqual(await storage.platformGrade(), {
    os: 'ios',
    grade: 'single-runtime',
    mechanism: 'keychain-serial-cas',
    moduleVersion: '0.1.0',
  });
  const record = settled();
  assert.deepEqual(
    await storage.withOwnership(APP, (owner) => owner.replace(null, record)),
    record,
  );
  const cas = nativeModule.calls.find((call) => call[0] === 'compareAndReplace');
  assert.equal(cas[3], null);
  assert.deepEqual(JSON.parse(cas[4]), record);
  assert.equal(
    nativeModule.calls.filter((call) => call[0] === 'compareAndReplace').length,
    1,
    'one native call carries comparison and whole-record replacement',
  );
});

test('native stale revision maps to the canonical typed CAS diagnostic', async () => {
  const nativeModule = fakeNativeModule();
  const storage = createNativeAuthCustodyStorage({ nativeModule });
  await storage.withOwnership(APP, (owner) => owner.replace(null, settled()));
  nativeModule.forceNextCasStale = 2;
  await expectCode(
    'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
    () => storage.withOwnership(
      APP,
      (owner) => owner.replace(1, settled({ revision: 2 })),
    ),
  );
});

test('native corruption envelope is never treated as a fresh store', async () => {
  const nativeModule = fakeNativeModule();
  nativeModule.readOutcome = { status: 'corrupt', reason: 'envelope checksum mismatch' };
  const storage = createNativeAuthCustodyStorage({ nativeModule });
  await expectCode(
    'SNAPBACK_AUTH_CUSTODY_CORRUPT',
    () => storage.withOwnership(APP, (owner) => owner.read()),
  );
});

test('sender-constrained custody refuses before native persistence', async () => {
  const nativeModule = fakeNativeModule();
  const storage = createNativeAuthCustodyStorage({ nativeModule });
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
  assert.equal(
    nativeModule.calls.some((call) => call[0] === 'compareAndReplace'),
    false,
  );
});

test('full owner-key addressing keeps storage partitions disjoint', async () => {
  const nativeModule = fakeNativeModule();
  const storage = createNativeAuthCustodyStorage({ nativeModule });
  const preview = settled();
  const staging = settled({
    authority: {
      ...anonymous(),
      authorizationStreamIncarnation: SESSION,
    },
  });
  await storage.withOwnership(
    { appId: APP, storagePartition: 'preview' },
    (owner) => owner.replace(null, preview),
  );
  await storage.withOwnership(
    { appId: APP, storagePartition: 'staging' },
    (owner) => owner.replace(null, staging),
  );
  const keys = [...nativeModule.records.keys()];
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.match(keys[0], /^snapback\.auth-custody\.partition\.[0-9a-f]{64}$/u);
  assert.match(keys[1], /^snapback\.auth-custody\.partition\.[0-9a-f]{64}$/u);
  assert.deepEqual(
    await storage.withOwnership(
      { appId: APP, storagePartition: 'preview' },
      (owner) => owner.read(),
    ),
    preview,
  );
  assert.deepEqual(
    await storage.withOwnership(
      { appId: APP, storagePartition: 'staging' },
      (owner) => owner.read(),
    ),
    staging,
  );
});

test('JS adapters retain the per-key courtesy queue around native CAS', async () => {
  const nativeModule = fakeNativeModule();
  const first = createNativeAuthCustodyStorage({ nativeModule });
  const second = createNativeAuthCustodyStorage({ nativeModule });
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

test('single-runtime native refusal surfaces the package diagnostic before custody work', async () => {
  const nativeModule = fakeNativeModule({ os: 'android' });
  nativeModule.refusal = true;
  const storage = createNativeAuthCustodyStorage({ nativeModule });
  await expectCode(
    SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED,
    () => storage.platformGrade(),
  );
  await expectCode(
    SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED,
    () => storage.withOwnership(APP, (owner) => owner.read()),
  );
  assert.equal(
    nativeModule.calls.some((call) => call[0] === 'compareAndReplace'),
    false,
  );
});

test('Android AEAD/key-loss outcome becomes absent while surfacing a typed diagnostic', async () => {
  const nativeModule = fakeNativeModule({ os: 'android' });
  nativeModule.readOutcome = {
    status: 'absent',
    reason: 'custody AES-GCM authentication failed',
  };
  const diagnostics = [];
  const storage = createNativeAuthCustodyStorage({
    nativeModule,
    onDiagnostic(diagnostic) { diagnostics.push(diagnostic); },
  });
  assert.equal(
    await storage.withOwnership(APP, (owner) => owner.read()),
    null,
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'SNAPBACK_AUTH_CUSTODY_CORRUPT');
  assert.equal(
    diagnostics[0].details.reason,
    'custody AES-GCM authentication failed',
  );
});
