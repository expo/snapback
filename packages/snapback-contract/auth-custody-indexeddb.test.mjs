// LLP 0059 IndexedDB custody ownership and fencing conformance.

import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { IDBFactory } from 'fake-indexeddb';

import {
  AUTH_DEFAULT_STORAGE_PARTITION,
  AuthCoordinator,
  AUTH_CUSTODY_LEASE_MS,
  SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
  authCustodyOwnerKeyHash,
} from './auth-coordinator.mjs';
import { createIndexedDbAuthCustodyStorage } from './auth-custody-indexeddb.mjs';

const APP = 'snapback.test/indexeddb-custody';
const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const INCARNATION_B = '018f0d90-7b12-7a22-8c33-445566778899';
const INCARNATION_C = '018f0d90-7b13-7a22-8c33-445566778899';

const anonymousAuthority = (incarnation) => ({
  kind: 'anonymous',
  authMode: 'sessions',
  authorizationStreamIncarnation: incarnation,
});

const settledAnonymous = (incarnation = INCARNATION) => ({
  formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
  appId: APP,
  authorityEpoch: 0,
  revision: 1,
  phase: 'settled',
  authority: {
    kind: 'anonymous',
    authMode: 'sessions',
    authorizationStreamIncarnation: incarnation,
  },
  pendingAuthority: null,
  bearer: null,
  pendingBearer: null,
  refreshAfterMs: null,
  transitionIntent: null,
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

const expectCode = async (code, operation) => {
  await assert.rejects(operation, (error) => error?.code === code);
};

const readIndexedDbRecord = (indexedDB, databaseName, storeName, key) => new Promise((resolve, reject) => {
  const open = indexedDB.open(databaseName);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const database = open.result;
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const value = structuredClone(request.result ?? null);
      transaction.oncomplete = () => {
        database.close();
        resolve(value);
      };
    };
  };
});

const writeIndexedDbRecord = (indexedDB, databaseName, storeName, key, value) => new Promise((resolve, reject) => {
  const open = indexedDB.open(databaseName);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const database = open.result;
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(structuredClone(value), key);
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => {};
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
  };
});

class DeterministicLockManager {
  #tails = new Map();
  names = [];

  async request(name, options, operation) {
    assert.deepEqual(options, { mode: 'exclusive' });
    this.names.push(name);
    const prior = this.#tails.get(name) ?? Promise.resolve();
    const release = deferred();
    const tail = prior.then(() => release.promise);
    this.#tails.set(name, tail);
    await prior;
    try {
      return await operation();
    } finally {
      release.resolve();
      if (this.#tails.get(name) === tail) this.#tails.delete(name);
    }
  }
}

// A default coordinator restores a raw pre-partition row, while preview and
// staging persist at their exact independent compound keys.
{
  const indexedDB = new IDBFactory();
  const databaseName = 'snapback-auth-custody-partition-addressing-test';
  const lockManager = new DeterministicLockManager();
  const storage = createIndexedDbAuthCustodyStorage({
    indexedDB,
    lockManager,
    cryptoObject: webcrypto,
    databaseName,
  });
  assert.equal(storage.ownerKeyCapability, 'owner-key-v1');
  const defaultOwnerKey = {
    appId: APP,
    storagePartition: AUTH_DEFAULT_STORAGE_PARTITION,
  };
  const previewOwnerKey = { appId: APP, storagePartition: 'preview' };
  const stagingOwnerKey = { appId: APP, storagePartition: 'staging' };
  const legacy = settledAnonymous();
  const preview = settledAnonymous(INCARNATION_B);
  const staging = settledAnonymous(INCARNATION_C);
  const previewStorageKey = [
    'snapback-auth-custody-partition-v1',
    authCustodyOwnerKeyHash(previewOwnerKey),
  ];
  const stagingStorageKey = [
    'snapback-auth-custody-partition-v1',
    authCustodyOwnerKeyHash(stagingOwnerKey),
  ];

  await storage.withOwnership(APP, (owner) => owner.read());
  await writeIndexedDbRecord(indexedDB, databaseName, 'custody', APP, legacy);
  const defaultCoordinator = new AuthCoordinator({
    appId: APP,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await defaultCoordinator.synchronize();
  assert.equal(
    defaultCoordinator.authority.authorizationStreamIncarnation,
    INCARNATION,
    'default-partition synchronize restores the raw legacy app-id row',
  );
  await defaultCoordinator.close();
  await storage.withOwnership(
    previewOwnerKey,
    (owner) => owner.replace(null, preview),
  );
  await storage.withOwnership(
    stagingOwnerKey,
    (owner) => owner.replace(null, staging),
  );
  assert.deepEqual(
    await storage.withOwnership(defaultOwnerKey, (owner) => owner.read()),
    legacy,
  );
  assert.deepEqual(
    await storage.withOwnership(previewOwnerKey, (owner) => owner.read()),
    preview,
  );
  assert.deepEqual(
    await storage.withOwnership(stagingOwnerKey, (owner) => owner.read()),
    staging,
  );
  assert.deepEqual(
    await readIndexedDbRecord(indexedDB, databaseName, 'custody', APP),
    legacy,
  );
  const rawPreview = await readIndexedDbRecord(
    indexedDB,
    databaseName,
    'custody',
    previewStorageKey,
  );
  const rawStaging = await readIndexedDbRecord(
    indexedDB,
    databaseName,
    'custody',
    stagingStorageKey,
  );
  assert.equal(rawPreview.authority.authorizationStreamIncarnation, INCARNATION_B);
  assert.equal(rawStaging.authority.authorizationStreamIncarnation, INCARNATION_C);
  assert.notDeepEqual(rawPreview, rawStaging);
  assert.equal(Object.hasOwn(rawPreview, 'storagePartition'), false);
  assert.equal(Object.hasOwn(rawStaging, 'storagePartition'), false);
  assert.equal(lockManager.names.includes(`snapback-auth-custody:${APP}`), true);
  assert.equal(
    lockManager.names.includes(
      `snapback-auth-custody-partition:${authCustodyOwnerKeyHash(previewOwnerKey)}`,
    ),
    true,
  );
  assert.equal(
    lockManager.names.includes(
      `snapback-auth-custody-partition:${authCustodyOwnerKeyHash(stagingOwnerKey)}`,
    ),
    true,
  );
  await storage.close();
}

// Web Lock tails serialize one partition without blocking another partition.
{
  const lockManager = new DeterministicLockManager();
  const storage = createIndexedDbAuthCustodyStorage({
    indexedDB: new IDBFactory(),
    lockManager,
    cryptoObject: webcrypto,
    databaseName: 'snapback-auth-custody-partition-web-lock-tail-test',
  });
  const previewOwnerKey = { appId: APP, storagePartition: 'preview' };
  const stagingOwnerKey = { appId: APP, storagePartition: 'staging' };
  const previewEntered = deferred();
  const releasePreview = deferred();
  const queuedPreviewEntered = deferred();
  const stagingEntered = deferred();
  const preview = storage.withOwnership(previewOwnerKey, async () => {
    previewEntered.resolve();
    await releasePreview.promise;
  });
  await previewEntered.promise;
  const queuedPreview = storage.withOwnership(previewOwnerKey, async () => {
    queuedPreviewEntered.resolve();
  });
  const staging = storage.withOwnership(stagingOwnerKey, async () => {
    stagingEntered.resolve();
  });
  await withDeadline(stagingEntered.promise, 'independent staging Web Lock');
  let queuedPreviewStarted = false;
  queuedPreviewEntered.promise.then(() => { queuedPreviewStarted = true; });
  await Promise.resolve();
  assert.equal(queuedPreviewStarted, false, 'same-partition Web Lock remains queued');
  await staging;
  releasePreview.resolve();
  await Promise.all([preview, queuedPreview]);
  await storage.close();
}

// Fallback leases use the same compound partition key, so one held preview
// lease neither serializes nor fences staging's independent ownership tail.
{
  const indexedDB = new IDBFactory();
  const databaseName = 'snapback-auth-custody-partition-fallback-tail-test';
  const storage = createIndexedDbAuthCustodyStorage({
    indexedDB,
    lockManager: null,
    cryptoObject: webcrypto,
    databaseName,
  });
  const previewOwnerKey = { appId: APP, storagePartition: 'preview' };
  const stagingOwnerKey = { appId: APP, storagePartition: 'staging' };
  const previewStorageKey = [
    'snapback-auth-custody-partition-v1',
    authCustodyOwnerKeyHash(previewOwnerKey),
  ];
  const stagingStorageKey = [
    'snapback-auth-custody-partition-v1',
    authCustodyOwnerKeyHash(stagingOwnerKey),
  ];
  const previewEntered = deferred();
  const releasePreview = deferred();
  const queuedPreviewEntered = deferred();
  const stagingEntered = deferred();
  const preview = storage.withOwnership(previewOwnerKey, async () => {
    previewEntered.resolve();
    await releasePreview.promise;
  });
  await previewEntered.promise;
  const queuedPreview = storage.withOwnership(previewOwnerKey, async () => {
    queuedPreviewEntered.resolve();
  });
  const staging = storage.withOwnership(stagingOwnerKey, async () => {
    stagingEntered.resolve();
  });
  await withDeadline(stagingEntered.promise, 'independent staging fallback lease');
  let queuedPreviewStarted = false;
  queuedPreviewEntered.promise.then(() => { queuedPreviewStarted = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(queuedPreviewStarted, false, 'same-partition fallback lease remains queued');
  await staging;
  releasePreview.resolve();
  await Promise.all([preview, withDeadline(queuedPreview, 'queued preview fallback lease')]);
  assert.notEqual(
    await readIndexedDbRecord(indexedDB, databaseName, 'leases', previewStorageKey),
    null,
  );
  assert.notEqual(
    await readIndexedDbRecord(indexedDB, databaseName, 'leases', stagingStorageKey),
    null,
  );
  await storage.close();
}

// Partition validation refuses whitespace/control and empty values before I/O.
{
  const storage = createIndexedDbAuthCustodyStorage({
    indexedDB: new IDBFactory(),
    lockManager: new DeterministicLockManager(),
    cryptoObject: webcrypto,
    databaseName: 'snapback-auth-custody-partition-validation-test',
  });
  for (const storagePartition of ['', 'two words', 'line\nfeed', 'control\u007f']) {
    await assert.rejects(
      storage.withOwnership({ appId: APP, storagePartition }, () => null),
      TypeError,
    );
  }
  await storage.close();
}

// Web Locks ownership serializes the entire asynchronous callback, including
// work performed between durable reads and replacement.
{
  const indexedDB = new IDBFactory();
  const locks = new DeterministicLockManager();
  const options = {
    indexedDB,
    lockManager: locks,
    cryptoObject: webcrypto,
    databaseName: 'snapback-auth-custody-web-lock-test',
  };
  const first = createIndexedDbAuthCustodyStorage(options);
  const second = createIndexedDbAuthCustodyStorage(options);
  const entered = deferred();
  const release = deferred();
  let secondEntered = false;

  const firstTask = first.withOwnership(APP, async (owner) => {
    assert.equal(await owner.read(), null);
    entered.resolve();
    await release.promise;
    return owner.replace(null, settledAnonymous());
  });
  await entered.promise;
  const secondTask = second.withOwnership(APP, async (owner) => {
    secondEntered = true;
    return owner.read();
  });
  await Promise.resolve();
  assert.equal(secondEntered, false);
  release.resolve();
  assert.deepEqual(await firstTask, settledAnonymous());
  assert.deepEqual(await secondTask, settledAnonymous());
  await Promise.all([first.close(), second.close()]);
}

// @ref LLP 0059#cross-context-ownership — an expired fallback holder is
// fenced in the same transaction as custody CAS, and its later best-effort
// release cannot expire or overwrite the successor holder's lease. Its
// withOwnership operation itself fails closed on completion (ENG-24985): a
// paused holder that was taken over rejects with lock loss instead of
// resolving, so its caller never acts on work performed under a lost lease.
{
  const indexedDB = new IDBFactory();
  let wallMs = 10_000;
  let monotonicMs = 0;
  const options = {
    indexedDB,
    lockManager: null,
    cryptoObject: webcrypto,
    databaseName: 'snapback-auth-custody-expired-lease-test',
    wallNow: () => wallMs,
    monotonicNow: () => monotonicMs,
  };
  const stale = createIndexedDbAuthCustodyStorage(options);
  const successor = createIndexedDbAuthCustodyStorage(options);
  const staleEntered = deferred();
  const releaseStale = deferred();
  let staleOwner;

  const staleTask = stale.withOwnership(APP, async (owner) => {
    staleOwner = owner;
    staleEntered.resolve();
    await releaseStale.promise;
  });
  await staleEntered.promise;
  wallMs += AUTH_CUSTODY_LEASE_MS + 1;
  monotonicMs += AUTH_CUSTODY_LEASE_MS + 1;

  const successorEntered = deferred();
  const releaseSuccessor = deferred();
  let successorOwner;
  const successorTask = successor.withOwnership(APP, async (owner) => {
    successorOwner = owner;
    successorEntered.resolve();
    await releaseSuccessor.promise;
  });
  await successorEntered.promise;

  await expectCode(
    'SNAPBACK_AUTH_CUSTODY_LOCK_LOST',
    () => staleOwner.replace(null, settledAnonymous()),
  );
  await expectCode('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', () => staleOwner.read());

  releaseStale.resolve();
  await expectCode('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', () => staleTask);
  assert.deepEqual(await successorOwner.replace(null, settledAnonymous()), settledAnonymous());
  releaseSuccessor.resolve();
  await successorTask;

  const observer = createIndexedDbAuthCustodyStorage(options);
  assert.deepEqual(
    await observer.withOwnership(APP, (owner) => owner.read()),
    settledAnonymous(),
  );
  await Promise.all([stale.close(), successor.close(), observer.close()]);
}

// A backward/frozen wall clock cannot wedge the fallback forever. A contender
// may take over only after observing the exact unchanged lease for a full
// monotonic lease interval; the old holder is fenced exactly as above.
{
  const indexedDB = new IDBFactory();
  let wallMs = 50_000;
  let monotonicMs = 0;
  const options = {
    indexedDB,
    lockManager: null,
    cryptoObject: webcrypto,
    databaseName: 'snapback-auth-custody-observed-lease-test',
    wallNow: () => wallMs,
    monotonicNow: () => monotonicMs,
  };
  const stale = createIndexedDbAuthCustodyStorage(options);
  const successor = createIndexedDbAuthCustodyStorage(options);
  const staleEntered = deferred();
  const releaseStale = deferred();
  let staleOwner;
  const staleTask = stale.withOwnership(APP, async (owner) => {
    staleOwner = owner;
    staleEntered.resolve();
    await releaseStale.promise;
  });
  await staleEntered.promise;

  // Simulate the wall clock jumping backward while monotonic observation
  // continues. The adapter polls every 50 ms; this advances before its third
  // observation and well before the stale holder's renewal timer.
  wallMs -= AUTH_CUSTODY_LEASE_MS;
  const advance = setTimeout(() => {
    monotonicMs += AUTH_CUSTODY_LEASE_MS + 1;
  }, 75);
  const successorTask = successor.withOwnership(APP, async (owner) => {
    await expectCode('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', () => staleOwner.read());
    return owner.replace(null, settledAnonymous());
  });
  assert.deepEqual(await successorTask, settledAnonymous());
  clearTimeout(advance);
  releaseStale.resolve();
  // The taken-over holder fails closed on completion rather than resolving.
  await expectCode('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', () => staleTask);
  await Promise.all([stale.close(), successor.close()]);
}

// Two consecutive fallback takeovers allocate exact predecessor + 1 fencing
// tokens. Neither of the two paused former holders can return successfully or
// expire the final holder's lease when it resumes.
{
  const indexedDB = new IDBFactory();
  const databaseName = 'snapback-auth-custody-two-takeover-test';
  let wallMs = 75_000;
  let monotonicMs = 0;
  const options = {
    indexedDB,
    lockManager: null,
    cryptoObject: webcrypto,
    databaseName,
    wallNow: () => wallMs,
    monotonicNow: () => monotonicMs,
  };
  const holders = [
    createIndexedDbAuthCustodyStorage(options),
    createIndexedDbAuthCustodyStorage(options),
    createIndexedDbAuthCustodyStorage(options),
  ];
  const entered = [deferred(), deferred(), deferred()];
  const release = [deferred(), deferred(), deferred()];
  const tasks = [];
  const startHolder = (index) => holders[index].withOwnership(APP, async (owner) => {
    entered[index].resolve();
    await release[index].promise;
    if (index === 2) return owner.replace(null, settledAnonymous());
    return null;
  });

  tasks[0] = startHolder(0);
  await entered[0].promise;
  assert.equal(
    (await readIndexedDbRecord(indexedDB, databaseName, 'leases', APP)).fencingToken,
    1,
  );
  wallMs += AUTH_CUSTODY_LEASE_MS + 1;
  monotonicMs += AUTH_CUSTODY_LEASE_MS + 1;
  tasks[1] = startHolder(1);
  await entered[1].promise;
  assert.equal(
    (await readIndexedDbRecord(indexedDB, databaseName, 'leases', APP)).fencingToken,
    2,
  );
  wallMs += AUTH_CUSTODY_LEASE_MS + 1;
  monotonicMs += AUTH_CUSTODY_LEASE_MS + 1;
  tasks[2] = startHolder(2);
  await entered[2].promise;
  assert.equal(
    (await readIndexedDbRecord(indexedDB, databaseName, 'leases', APP)).fencingToken,
    3,
    'the second takeover increments the exact first-takeover token',
  );

  release[0].resolve();
  release[1].resolve();
  await expectCode('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', () => tasks[0]);
  await expectCode('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', () => tasks[1]);
  release[2].resolve();
  assert.deepEqual(await tasks[2], settledAnonymous());
  assert.equal(
    (await readIndexedDbRecord(indexedDB, databaseName, 'leases', APP)).fencingToken,
    3,
    'stale release cannot replace the final holder lease',
  );
  await Promise.all(holders.map((holder) => holder.close()));
}

// @ref LLP 0059#coordinator-and-two-context-races — model a Web-Lock owner
// context dying at every durable/participant cut. The rejected lock callback
// releases ownership; a fresh context reloads either settled A or clearing B,
// reruns the complete local barrier, and exposes only settled B.
for (const failurePoint of [
  'before-clearing',
  'quiesce',
  'blank',
  'clearMemory',
  'commitDurable',
  'before-settled-publication',
  'resume',
]) {
  const appId = `${APP}/owner-kill/${failurePoint}`;
  const indexedDB = new IDBFactory();
  const locks = new DeterministicLockManager();
  const options = {
    indexedDB,
    lockManager: locks,
    cryptoObject: webcrypto,
    databaseName: `snapback-auth-custody-owner-kill-${failurePoint}`,
  };
  const ownerBase = createIndexedDbAuthCustodyStorage(options);
  let failureArmed = false;
  const ownerStorage = {
    withOwnership: (ownedAppId, operation) => ownerBase.withOwnership(ownedAppId, (owner) => operation({
      ...owner,
      replace: async (expectedRevision, next) => {
        if (
          failureArmed
          && (
            (failurePoint === 'before-clearing' && next.phase === 'clearing')
            || (failurePoint === 'before-settled-publication' && next.phase === 'settled')
          )
        ) {
          throw new Error(`simulated owner death at ${failurePoint}`);
        }
        return owner.replace(expectedRevision, next);
      },
    })),
  };
  const ownerCoordinator = new AuthCoordinator({
    appId,
    storage: ownerStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const captureA = await ownerCoordinator.establishAnonymous(anonymousAuthority(INCARNATION));
  let participantFailed = false;
  const failParticipant = (phase) => {
    if (!participantFailed && failurePoint === phase) {
      participantFailed = true;
      throw new Error(`simulated owner death during ${phase}`);
    }
  };
  ownerCoordinator.registerParticipant({
    name: `owner-dies-${failurePoint}`,
    async quiesce() { failParticipant('quiesce'); },
    blank() { failParticipant('blank'); },
    clearMemory() { failParticipant('clearMemory'); },
    async commitDurable() { failParticipant('commitDurable'); },
    async resume() { failParticipant('resume'); },
  });
  failureArmed = true;
  const interruptedTransition = () => ownerCoordinator.transition(
    captureA,
    { authority: anonymousAuthority(INCARNATION_B), bearer: null, refreshAfterMs: null },
    `owner_kill_${failurePoint}`,
  );
  if (failurePoint === 'before-clearing') {
    await assert.rejects(interruptedTransition, /simulated owner death at before-clearing/);
  } else {
    await expectCode('SNAPBACK_AUTH_TRANSITION_FAILED', interruptedTransition);
  }
  await ownerCoordinator.close();
  await ownerBase.close();

  const recoveryStorage = createIndexedDbAuthCustodyStorage(options);
  const recovery = new AuthCoordinator({
    appId,
    storage: recoveryStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const recoveryPhases = [];
  recovery.registerParticipant({
    name: `recovery-${failurePoint}`,
    async quiesce() { recoveryPhases.push('quiesce'); },
    blank() { recoveryPhases.push('blank'); },
    clearMemory() { recoveryPhases.push('clearMemory'); },
    async commitDurable() { recoveryPhases.push('commitDurable'); },
    async resume() { recoveryPhases.push('resume'); },
  });
  assert.throws(
    () => recovery.capture(),
    { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING' },
    `${failurePoint}: a fresh context begins blank`,
  );
  let captureB = await recovery.synchronize();
  if (failurePoint === 'before-clearing') {
    captureB = await recovery.transition(
      captureB,
      { authority: anonymousAuthority(INCARNATION_B), bearer: null, refreshAfterMs: null },
      `recovery_${failurePoint}`,
    );
  }
  assert.equal(captureB.authorityEpoch, captureA.authorityEpoch + 1, failurePoint);
  assert.equal(
    recovery.settledView().authority.authorizationStreamIncarnation,
    INCARNATION_B,
    failurePoint,
  );
  for (const phase of ['quiesce', 'blank', 'clearMemory', 'commitDurable', 'resume']) {
    assert.equal(recoveryPhases.includes(phase), true, `${failurePoint}: recovery ran ${phase}`);
  }
  const durable = await recoveryStorage.withOwnership(appId, (owner) => owner.read());
  assert.equal(durable.phase, 'settled', failurePoint);
  assert.equal(durable.authority.authorizationStreamIncarnation, INCARNATION_B, failurePoint);
  await recovery.close();
  await recoveryStorage.close();
}

// ENG-24985: without Web Locks, the fallback lease can expire after
// owner.read() and before the synchronous compareAndCommit publication. A
// paused former holder A that resumes after a successor durably settled B must
// be fenced across publication: its commit/publication callback (where the
// Contract boundary write and app/store observer effects run) must never
// execute, and the stale operation must reject with lock loss rather than
// resolving committed. The previous `if (lost)` timer-flag check did not
// reread the lease and let the stale task resolve.
{
  const indexedDB = new IDBFactory();
  let wallMs = 100_000;
  let monotonicMs = 0;
  const options = {
    indexedDB,
    lockManager: null,
    cryptoObject: webcrypto,
    databaseName: 'snapback-auth-custody-commit-fence-test',
    wallNow: () => wallMs,
    monotonicNow: () => monotonicMs,
  };

  // Pause the stale coordinator's compareAndCommit after its fenced read but
  // before publication, without touching the fenced publish path itself, so
  // the same injection point exercises fixed and unfixed code alike.
  const base = createIndexedDbAuthCustodyStorage(options);
  let armed = false;
  let paused = false;
  const readEntered = deferred();
  const readGate = deferred();
  const staleStorage = {
    withOwnership: (appId, operation) => base.withOwnership(appId, (owner) => operation({
      ...owner,
      read: async () => {
        const record = await owner.read();
        if (armed && !paused) {
          paused = true;
          readEntered.resolve();
          await readGate.promise;
        }
        return record;
      },
    })),
  };
  const successorStorage = createIndexedDbAuthCustodyStorage(options);

  const staleCoordinator = new AuthCoordinator({
    appId: APP,
    storage: staleStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const successorCoordinator = new AuthCoordinator({
    appId: APP,
    storage: successorStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });

  const captureA = await staleCoordinator.establishAnonymous(anonymousAuthority(INCARNATION));
  await successorCoordinator.synchronize();
  const successorCaptureA = successorCoordinator.capture();

  let aPublicationRan = false;
  armed = true;
  const staleCommit = staleCoordinator.compareAndCommit(captureA, () => {
    // This is exactly where index.mjs runs the Contract boundary write and
    // app/store observer effects. It must not execute after a takeover.
    aPublicationRan = true;
    return 'A-publication';
  });
  await readEntered.promise;

  // A holds a fresh lease and has read settled-A, paused before publication.
  // Expire that lease and let the successor durably settle A -> B.
  wallMs += AUTH_CUSTODY_LEASE_MS + 1;
  monotonicMs += AUTH_CUSTODY_LEASE_MS + 1;
  const captureB = await successorCoordinator.transition(
    successorCaptureA,
    { authority: anonymousAuthority(INCARNATION_B), bearer: null, refreshAfterMs: null },
    'takeover_settles_b',
  );
  assert.equal(captureB.authorityEpoch, captureA.authorityEpoch + 1);

  // Resume A. Its stale publication is fenced by a post-read lease revalidation.
  readGate.resolve();
  await expectCode('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', () => staleCommit);
  assert.equal(
    aPublicationRan,
    false,
    'no A boundary/store/publication callback may run after a successor takeover',
  );

  // Durable custody is the successor's B, untouched by the fenced holder.
  const observer = createIndexedDbAuthCustodyStorage(options);
  const durable = await observer.withOwnership(APP, (owner) => owner.read());
  assert.equal(durable.authorityEpoch, captureB.authorityEpoch);
  assert.equal(durable.authority.authorizationStreamIncarnation, INCARNATION_B);

  await Promise.all([
    staleCoordinator.close(),
    successorCoordinator.close(),
    base.close(),
    successorStorage.close(),
    observer.close(),
  ]);
}

console.log('auth-custody-indexeddb.test.mjs: all assertions passed');
