// LLP 0059 IndexedDB custody ownership and fencing conformance.

import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { IDBFactory } from 'fake-indexeddb';

import {
  AuthCoordinator,
  AUTH_CUSTODY_LEASE_MS,
  SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
} from './auth-coordinator.mjs';
import { createIndexedDbAuthCustodyStorage } from './auth-custody-indexeddb.mjs';

const APP = 'snapback.test/indexeddb-custody';
const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const INCARNATION_B = '018f0d90-7b12-7a22-8c33-445566778899';

const anonymousAuthority = (incarnation) => ({
  kind: 'anonymous',
  authMode: 'sessions',
  authorizationStreamIncarnation: incarnation,
});

const settledAnonymous = () => ({
  formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
  appId: APP,
  authorityEpoch: 0,
  revision: 1,
  phase: 'settled',
  authority: {
    kind: 'anonymous',
    authMode: 'sessions',
    authorizationStreamIncarnation: INCARNATION,
  },
  pendingAuthority: null,
  bearer: null,
  pendingBearer: null,
  refreshAfterMs: null,
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

const expectCode = async (code, operation) => {
  await assert.rejects(operation, (error) => error?.code === code);
};

class DeterministicLockManager {
  #tails = new Map();

  async request(name, options, operation) {
    assert.deepEqual(options, { mode: 'exclusive' });
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
