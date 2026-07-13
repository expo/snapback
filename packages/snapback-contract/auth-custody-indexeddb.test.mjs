// LLP 0056 IndexedDB custody ownership and fencing conformance.

import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { IDBFactory } from 'fake-indexeddb';

import {
  AUTH_CUSTODY_LEASE_MS,
  SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
} from './auth-coordinator.mjs';
import { createIndexedDbAuthCustodyStorage } from './auth-custody-indexeddb.mjs';

const APP = 'snapback.test/indexeddb-custody';
const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';

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

// @ref LLP 0056#cross-context-ownership — an expired fallback holder is
// fenced in the same transaction as custody CAS, and its later best-effort
// release cannot expire or overwrite the successor holder's lease.
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
  await staleTask;
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
  await staleTask;
  await Promise.all([stale.close(), successor.close()]);
}

console.log('auth-custody-indexeddb.test.mjs: all assertions passed');
