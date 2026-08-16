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
  const corruptedCiphertext = new Set();
  const calls = [];
  const module = {
    records,
    corruptedCiphertext,
    calls,
    readOutcome: null,
    refusal: false,
    keyAlias: 'valid',
    keyGeneration: 0,
    invalidatedHolderGenerations: [],
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
        carrier: os === 'ios' ? 'ios-keychain' : 'android-datastore-keystore',
        mechanism: os === 'ios' ? 'keychain-serial-cas' : 'datastore-keystore-aes-gcm',
        moduleVersion: '0.1.0',
        storageFormatVersion: 1,
      };
    },
    async read(appId, storageKey) {
      calls.push(['read', appId, storageKey]);
      if (this.refusal) {
        return {
          status: 'single-runtime-refused',
          reason: 'secondary-process',
          platform: os,
          process: 'test-secondary',
        };
      }
      if (this.readOutcome) return this.readOutcome;
      if (this.invalidatedHolderGenerations.length > 0) {
        const usedGeneration = this.invalidatedHolderGenerations.shift();
        if (usedGeneration === this.keyGeneration) {
          this.keyAlias = 'missing';
          return {
            status: 'absent',
            reason: 'Android Keystore key was permanently invalidated',
          };
        }
        // A stale holder observes the newer generation and retries its read
        // with the fresh alias instead of retiring that alias.
      }
      if (this.keyAlias === 'invalidated') {
        this.keyAlias = 'missing';
        return {
          status: 'absent',
          reason: 'Android Keystore key was permanently invalidated',
        };
      }
      if (this.keyAlias === 'missing') {
        return { status: 'absent', reason: 'Android Keystore key alias is missing' };
      }
      if (corruptedCiphertext.has(storageKey)) {
        return { status: 'corrupt', reason: 'custody AES-GCM authentication failed' };
      }
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
      const current = this.keyAlias === 'missing' ? undefined : records.get(storageKey);
      const actualRevision = current === undefined ? null : JSON.parse(current).revision;
      if (actualRevision !== expectedRevision) {
        return { status: 'cas-stale', expectedRevision, actualRevision };
      }
      if (this.keyAlias === 'missing') this.keyGeneration += 1;
      this.keyAlias = 'valid';
      corruptedCiphertext.delete(storageKey);
      records.set(storageKey, serializedRecord);
      return { status: 'ok', record: records.get(storageKey) };
    },
    async corruptCiphertext(appId, storageKey) {
      calls.push(['corruptCiphertext', appId, storageKey]);
      if (this.refusal) {
        return { status: 'single-runtime-refused', platform: os, process: 'test-secondary' };
      }
      if (os !== 'android' || !records.has(storageKey)) {
        return { status: 'storage-error', reason: 'ciphertext corruption target is unavailable' };
      }
      corruptedCiphertext.add(storageKey);
      return {
        status: 'ok',
        mechanism: 'persisted-aead-byte-flip-datastore-reopen',
      };
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
    carrier: 'ios-keychain',
    mechanism: 'keychain-serial-cas',
    moduleVersion: '0.1.0',
    storageFormatVersion: 1,
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
  await assert.rejects(
    storage.withOwnership(
      APP,
      (owner) => owner.replace(1, settled({ revision: 2 })),
    ),
    (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_CAS_STALE'
      && error?.diagnostic?.details?.expectedRevision === 1
      && error?.diagnostic?.details?.actualRevision === 2,
  );
});

test('JS stale precheck wins before replacement monotonicity validation', async () => {
  const nativeModule = fakeNativeModule();
  const storage = createNativeAuthCustodyStorage({ nativeModule });
  await storage.withOwnership(APP, (owner) => owner.replace(null, settled()));
  nativeModule.records.set(
    [...nativeModule.records.keys()][0],
    JSON.stringify(settled({ revision: 2 })),
  );
  await assert.rejects(
    storage.withOwnership(
      APP,
      (owner) => owner.replace(1, settled({ revision: 9 })),
    ),
    (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_CAS_STALE'
      && error?.diagnostic?.details?.expectedRevision === 1
      && error?.diagnostic?.details?.actualRevision === 2,
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

test('same-tick same-key ownership queues, serializes, and completes', async () => {
  const nativeModule = fakeNativeModule();
  const storage = createNativeAuthCustodyStorage({ nativeModule });
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let markFirstEntered;
  const firstEntered = new Promise((resolve) => { markFirstEntered = resolve; });
  const order = [];
  const first = storage.withOwnership(APP, async (owner) => {
    order.push('first-entered');
    markFirstEntered();
    await firstGate;
    await owner.replace(null, settled());
    order.push('first-completed');
  });
  const second = storage.withOwnership(APP, async (owner) => {
    order.push('second-entered');
    return owner.read();
  });
  await firstEntered;
  assert.deepEqual(order, ['first-entered']);
  releaseFirst();
  await first;
  assert.deepEqual(await second, settled());
  assert.deepEqual(order, ['first-entered', 'first-completed', 'second-entered']);
});

test('same-key reentrant ownership and corruption refuse through the bounded wait breaker', async () => {
  const nativeModule = fakeNativeModule({ os: 'android' });
  const storage = createNativeAuthCustodyStorage({
    nativeModule,
    ownershipWaitTimeoutMs: 5,
  });
  const priorDev = globalThis.__DEV__;
  globalThis.__DEV__ = true;
  try {
    await storage.withOwnership(APP, async () => {
      await assert.rejects(
        storage.withOwnership(APP, () => null),
        (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED'
          && error?.diagnostic?.details?.operation === 'withOwnership'
          && error?.diagnostic?.details?.reason === 'ownership-wait-timeout',
      );
      await assert.rejects(
        storage.testHooks.corruptCiphertext(APP),
        (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED'
          && error?.diagnostic?.details?.operation === 'corruptCiphertext'
          && error?.diagnostic?.details?.reason === 'ownership-wait-timeout',
      );
    });
  } finally {
    if (priorDev === undefined) delete globalThis.__DEV__;
    else globalThis.__DEV__ = priorDev;
  }
});

test('normal ownership completion clears its deadlock-breaker timer', async () => {
  const nativeModule = fakeNativeModule();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const tracked = new Set();
  globalThis.setTimeout = (callback, delay, ...args) => {
    let handle;
    handle = originalSetTimeout(() => {
      tracked.delete(handle);
      callback(...args);
    }, delay);
    if (delay === 25) tracked.add(handle);
    return handle;
  };
  globalThis.clearTimeout = (handle) => {
    tracked.delete(handle);
    return originalClearTimeout(handle);
  };
  try {
    const storage = createNativeAuthCustodyStorage({
      nativeModule,
      ownershipWaitTimeoutMs: 25,
    });
    await storage.withOwnership(APP, (owner) => owner.read());
    assert.equal(tracked.size, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('different-key ownership may nest on one adapter instance', async () => {
  const nativeModule = fakeNativeModule();
  const storage = createNativeAuthCustodyStorage({ nativeModule });
  const nested = await storage.withOwnership(
    { appId: APP, storagePartition: 'outer' },
    () => storage.withOwnership(
      { appId: APP, storagePartition: 'inner' },
      (owner) => owner.read(),
    ),
  );
  assert.equal(nested, null);
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

test('Android permanent key invalidation retires the alias and permits fresh custody', async () => {
  const nativeModule = fakeNativeModule({ os: 'android' });
  const diagnostics = [];
  const storage = createNativeAuthCustodyStorage({
    nativeModule,
    onDiagnostic(diagnostic) { diagnostics.push(diagnostic); },
  });
  await storage.withOwnership(APP, (owner) => owner.replace(null, settled()));
  nativeModule.keyAlias = 'invalidated';
  assert.equal(
    await storage.withOwnership(APP, (owner) => owner.read()),
    null,
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'SNAPBACK_AUTH_CUSTODY_CORRUPT');
  assert.equal(
    diagnostics[0].details.reason,
    'Android Keystore key was permanently invalidated',
  );
  const restarted = settled({
    authority: { ...anonymous(), authorizationStreamIncarnation: SESSION },
  });
  assert.deepEqual(
    await storage.withOwnership(APP, (owner) => owner.replace(null, restarted)),
    restarted,
  );
});

test('stale invalidation holder cannot retire a freshly generated Android alias', async () => {
  const nativeModule = fakeNativeModule({ os: 'android' });
  const diagnostics = [];
  const storage = createNativeAuthCustodyStorage({
    nativeModule,
    onDiagnostic(diagnostic) { diagnostics.push(diagnostic); },
  });
  await storage.withOwnership(APP, (owner) => owner.replace(null, settled()));
  const staleGeneration = nativeModule.keyGeneration;

  nativeModule.invalidatedHolderGenerations.push(staleGeneration);
  assert.equal(await storage.withOwnership(APP, (owner) => owner.read()), null);
  assert.equal(nativeModule.keyAlias, 'missing', 'holder A retires its current alias');

  const fresh = settled({
    authority: { ...anonymous(), authorizationStreamIncarnation: SESSION },
  });
  assert.deepEqual(
    await storage.withOwnership(APP, (owner) => owner.replace(null, fresh)),
    fresh,
  );
  assert.equal(nativeModule.keyGeneration, staleGeneration + 1, 'holder B creates generation N+1');
  const diagnosticsBeforeStaleRetry = diagnostics.length;

  nativeModule.invalidatedHolderGenerations.push(staleGeneration);
  assert.deepEqual(
    await storage.withOwnership(APP, (owner) => owner.read()),
    fresh,
    'stale holder C retries against N+1 instead of deleting it',
  );
  assert.equal(nativeModule.keyAlias, 'valid');
  assert.equal(nativeModule.keyGeneration, staleGeneration + 1);
  assert.equal(diagnostics.length, diagnosticsBeforeStaleRetry);
});

test('recoverable absence without onDiagnostic uses the console warning path', async () => {
  const nativeModule = fakeNativeModule({ os: 'android' });
  nativeModule.readOutcome = {
    status: 'absent',
    reason: 'Android Keystore key alias is missing',
  };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const storage = createNativeAuthCustodyStorage({ nativeModule });
    assert.equal(await storage.withOwnership(APP, (owner) => owner.read()), null);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /^SNAPBACK_AUTH_CUSTODY_CORRUPT:/u);
  assert.equal(warnings[0][1].reason, 'Android Keystore key alias is missing');
});

test('structural corruption is never adopted or overwritten without explicit store replacement', async () => {
  const nativeModule = fakeNativeModule({ os: 'android' });
  const storage = createNativeAuthCustodyStorage({ nativeModule });
  nativeModule.readOutcome = { status: 'corrupt', reason: 'custody envelope checksum mismatch' };
  await expectCode(
    'SNAPBACK_AUTH_CUSTODY_CORRUPT',
    () => storage.withOwnership(APP, (owner) => owner.read()),
  );
  await expectCode(
    'SNAPBACK_AUTH_CUSTODY_CORRUPT',
    () => storage.withOwnership(APP, (owner) => owner.replace(null, settled())),
  );
  assert.equal(
    nativeModule.calls.some((call) => call[0] === 'compareAndReplace'),
    false,
  );

  nativeModule.readOutcome = null;
  nativeModule.records.clear();
  assert.deepEqual(
    await storage.withOwnership(APP, (owner) => owner.replace(null, settled())),
    settled(),
    'explicit replacement of the storage carrier restores the fresh-store path',
  );
});

test('Android ciphertext corruption hook is development-only and yields typed corruption', async () => {
  const nativeModule = fakeNativeModule({ os: 'android' });
  const storage = createNativeAuthCustodyStorage({ nativeModule });
  await storage.withOwnership(APP, (owner) => owner.replace(null, settled()));
  await expectCode(
    'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED',
    () => storage.testHooks.corruptCiphertext({
      appId: APP,
      storagePartition: 'default',
    }),
  );

  const priorDev = globalThis.__DEV__;
  globalThis.__DEV__ = true;
  let releaseOwnership;
  const ownershipGate = new Promise((resolve) => { releaseOwnership = resolve; });
  let markOwnershipEntered;
  const ownershipEntered = new Promise((resolve) => { markOwnershipEntered = resolve; });
  let ownershipTask;
  let corruptionTask;
  try {
    ownershipTask = storage.withOwnership(APP, async (owner) => {
      assert.deepEqual(await owner.read(), settled());
      markOwnershipEntered();
      await ownershipGate;
    });
    await ownershipEntered;
    corruptionTask = storage.testHooks.corruptCiphertext({
      appId: APP,
      storagePartition: 'default',
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      nativeModule.calls.some((call) => call[0] === 'corruptCiphertext'),
      false,
      'corruption hook waits behind same-key ownership',
    );
    releaseOwnership();
    await ownershipTask;
    const hook = await corruptionTask;
    assert.equal(hook.mechanism, 'persisted-aead-byte-flip-datastore-reopen');
  } finally {
    releaseOwnership?.();
    await Promise.allSettled([ownershipTask, corruptionTask].filter(Boolean));
    if (priorDev === undefined) delete globalThis.__DEV__;
    else globalThis.__DEV__ = priorDev;
  }
  await expectCode(
    'SNAPBACK_AUTH_CUSTODY_CORRUPT',
    () => storage.withOwnership(APP, (owner) => owner.read()),
  );
});
