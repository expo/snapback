// IndexedDB custody storage with Web Locks ownership and a transactionally
// fenced lease fallback.
//
// @ref LLP 0057#cross-context-ownership — localStorage is only a wakeup hint;
//   custody and fallback lease CAS live in the same IndexedDB transaction.

import {
  AUTH_CUSTODY_DATABASE_NAME,
  AUTH_CUSTODY_DATABASE_VERSION,
  AUTH_CUSTODY_LEASE_MS,
  AUTH_CUSTODY_LEASE_RENEW_MS,
  validateAuthCustody,
} from './auth-coordinator.mjs';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const OBSERVED_UNCHANGED_MS = AUTH_CUSTODY_LEASE_MS;
const RETRY_POLL_MS = 50;

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function storageError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message, details };
  return error;
}

const requestResult = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? storageError(
    'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED',
    'IndexedDB request failed',
  ));
});

const transactionDone = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? storageError(
    'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED',
    'IndexedDB transaction aborted',
  ));
  transaction.onerror = () => {
    // onabort is the terminal notification and carries the transaction error.
  };
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function exactLease(a, b) {
  return a !== null && b !== null
    && a.holderNonce === b.holderNonce
    && a.fencingToken === b.fencingToken
    && a.expiresAtMs === b.expiresAtMs;
}

function sameLeaseHolder(a, b) {
  return a !== null && b !== null
    && a.holderNonce === b.holderNonce
    && a.fencingToken === b.fencingToken;
}

function validateLease(lease) {
  if (!lease || typeof lease !== 'object' || Array.isArray(lease)) {
    throw storageError('SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE', 'custody lease has an invalid shape');
  }
  const keys = Reflect.ownKeys(lease);
  if (
    keys.length !== 3
    || !keys.every((key) => (
      typeof key === 'string'
      && ['holderNonce', 'fencingToken', 'expiresAtMs'].includes(key)
    ))
  ) {
    throw storageError('SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE', 'custody lease has unknown or missing fields');
  }
  if (typeof lease.holderNonce !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(lease.holderNonce)) {
    throw storageError('SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE', 'custody lease nonce is invalid');
  }
  if (!Number.isSafeInteger(lease.fencingToken) || lease.fencingToken < 1) {
    throw storageError('SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE', 'custody lease fencing token is invalid');
  }
  if (!Number.isSafeInteger(lease.expiresAtMs)) {
    throw storageError('SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE', 'custody lease expiry is invalid');
  }
  return clone(lease);
}

function nonce128(cryptoObject) {
  if (!cryptoObject || typeof cryptoObject.getRandomValues !== 'function') {
    throw storageError(
      'SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE',
      'fallback custody ownership requires a cryptographic random source',
    );
  }
  const bytes = cryptoObject.getRandomValues(new Uint8Array(16));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let encoded = '';
  let bits = 0;
  let accumulator = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      encoded += alphabet[(accumulator >>> bits) & 0x3f];
    }
  }
  if (bits > 0) encoded += alphabet[(accumulator << (6 - bits)) & 0x3f];
  return encoded;
}

function validateReplacement(previous, next, appId) {
  const validated = validateAuthCustody(next, appId);
  if (previous === null) {
    if (validated.revision !== 1 || validated.authorityEpoch !== 0) {
      throw storageError(
        'SNAPBACK_AUTH_CUSTODY_CORRUPT',
        'fresh custody must begin at epoch 0 and revision 1',
      );
    }
    return validated;
  }
  const current = validateAuthCustody(previous, appId);
  if (current.revision === MAX_SAFE || validated.revision !== current.revision + 1) {
    throw storageError(
      'SNAPBACK_AUTH_CUSTODY_CORRUPT',
      'custody replacement did not advance revision exactly once',
    );
  }
  if (
    validated.authorityEpoch < current.authorityEpoch
    || validated.authorityEpoch > current.authorityEpoch + 1
  ) {
    throw storageError(
      'SNAPBACK_AUTH_CUSTODY_CORRUPT',
      'custody replacement regressed or skipped authority epoch',
    );
  }
  return validated;
}

function openCustodyDatabase(indexedDB, name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, AUTH_CUSTODY_DATABASE_VERSION);
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('custody')) db.createObjectStore('custody');
      if (!db.objectStoreNames.contains('leases')) db.createObjectStore('leases');
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      if (!db.objectStoreNames.contains('custody') || !db.objectStoreNames.contains('leases')) {
        db.close();
        fail(storageError(
          'SNAPBACK_AUTH_CUSTODY_CORRUPT',
          'custody database is missing a required object store',
        ));
        return;
      }
      settled = true;
      resolve(db);
    };
    request.onerror = () => fail(request.error ?? storageError(
      'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED',
      'could not open the custody database',
    ));
    request.onblocked = () => fail(storageError(
      'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED',
      'custody database upgrade is blocked by another context',
    ));
  });
}

/**
 * Browser storage for AuthCoordinator. Web Locks is preferred. If unavailable,
 * the `leases` row is acquired and validated in the same transaction domain as
 * every custody replacement; there is deliberately no localStorage mutex.
 */
export function createIndexedDbAuthCustodyStorage({
  indexedDB = globalThis.indexedDB,
  lockManager = globalThis.navigator?.locks ?? null,
  cryptoObject = globalThis.crypto,
  databaseName = AUTH_CUSTODY_DATABASE_NAME,
  wallNow = () => Date.now(),
  monotonicNow = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function') {
    throw storageError(
      'SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE',
      'sessions-mode custody requires IndexedDB or an equivalent transactional adapter',
    );
  }
  let databasePromise = null;
  let closed = false;
  const database = () => {
    if (closed) throw storageError('SNAPBACK_AUTH_COORDINATOR_CLOSED', 'custody storage is closed');
    if (!databasePromise) databasePromise = openCustodyDatabase(indexedDB, databaseName);
    return databasePromise;
  };

  const readCustody = async (db, appId, lease = null) => {
    const stores = lease ? ['custody', 'leases'] : ['custody'];
    const tx = db.transaction(stores, 'readonly');
    const custodyRequest = tx.objectStore('custody').get(appId);
    const leaseRequest = lease ? tx.objectStore('leases').get(appId) : null;
    const [record, currentLease] = await Promise.all([
      requestResult(custodyRequest),
      leaseRequest ? requestResult(leaseRequest) : Promise.resolve(null),
    ]);
    await transactionDone(tx);
    if (lease) {
      const valid = currentLease ? validateLease(currentLease) : null;
      if (!sameLeaseHolder(valid, lease) || valid.expiresAtMs <= wallNow()) {
        throw storageError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'fallback custody lease was lost');
      }
    }
    return record === undefined ? null : validateAuthCustody(record, appId);
  };

  const replaceCustody = async (db, appId, expectedRevision, next, lease = null) => {
    const stores = lease ? ['custody', 'leases'] : ['custody'];
    const tx = db.transaction(stores, 'readwrite');
    const custodyStore = tx.objectStore('custody');
    try {
      const currentRaw = await requestResult(custodyStore.get(appId));
      const current = currentRaw === undefined ? null : validateAuthCustody(currentRaw, appId);
      if ((current?.revision ?? null) !== expectedRevision) {
        tx.abort();
        throw storageError(
          'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
          'durable custody changed before compare-and-swap',
          { expectedRevision, actualRevision: current?.revision ?? null },
        );
      }
      if (lease) {
        const currentLeaseRaw = await requestResult(tx.objectStore('leases').get(appId));
        const currentLease = currentLeaseRaw === undefined ? null : validateLease(currentLeaseRaw);
        if (!sameLeaseHolder(currentLease, lease) || currentLease.expiresAtMs <= wallNow()) {
          tx.abort();
          throw storageError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'fallback custody lease was lost');
        }
      }
      const validated = validateReplacement(current, next, appId);
      custodyStore.put(clone(validated), appId);
      await transactionDone(tx);
      return validated;
    } catch (error) {
      if (tx.readyState !== 'done') {
        try { tx.abort(); } catch { /* already completed or aborted */ }
      }
      throw error;
    }
  };

  const acquireFallbackLease = async (db, appId) => {
    const holderNonce = nonce128(cryptoObject);
    let observed = null;
    let observedSince = null;
    for (;;) {
      const tx = db.transaction(['leases'], 'readwrite');
      const store = tx.objectStore('leases');
      const raw = await requestResult(store.get(appId));
      const current = raw === undefined ? null : validateLease(raw);
      const nowWall = wallNow();
      const nowMono = monotonicNow();
      const unchangedLongEnough = current !== null
        && exactLease(current, observed)
        && observedSince !== null
        && nowMono - observedSince >= OBSERVED_UNCHANGED_MS;
      if (current === null || current.expiresAtMs <= nowWall || unchangedLongEnough) {
        const priorToken = current?.fencingToken ?? 0;
        if (priorToken === MAX_SAFE) {
          tx.abort();
          throw storageError(
            'SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE',
            'custody lease fencing token is exhausted',
          );
        }
        const lease = {
          holderNonce,
          fencingToken: priorToken + 1,
          expiresAtMs: nowWall + AUTH_CUSTODY_LEASE_MS,
        };
        store.put(lease, appId);
        await transactionDone(tx);
        return lease;
      }
      await transactionDone(tx);
      if (!exactLease(current, observed)) {
        observed = current;
        observedSince = nowMono;
      }
      await wait(RETRY_POLL_MS);
    }
  };

  const renewFallbackLease = async (db, appId, lease) => {
    const tx = db.transaction(['leases'], 'readwrite');
    const store = tx.objectStore('leases');
    const raw = await requestResult(store.get(appId));
    const current = raw === undefined ? null : validateLease(raw);
    if (!sameLeaseHolder(current, lease) || current.expiresAtMs <= wallNow()) {
      tx.abort();
      throw storageError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'fallback custody lease was lost');
    }
    const next = { ...lease, expiresAtMs: wallNow() + AUTH_CUSTODY_LEASE_MS };
    store.put(next, appId);
    await transactionDone(tx);
    return next;
  };

  const releaseFallbackLease = async (db, appId, lease) => {
    const tx = db.transaction(['leases'], 'readwrite');
    const store = tx.objectStore('leases');
    const raw = await requestResult(store.get(appId));
    const current = raw === undefined ? null : validateLease(raw);
    if (sameLeaseHolder(current, lease)) {
      store.put({ ...lease, expiresAtMs: 0 }, appId);
    }
    await transactionDone(tx);
  };

  const withWebLock = async (appId, operation) => lockManager.request(
    `snapback-auth-custody:${appId}`,
    { mode: 'exclusive' },
    async () => {
      const db = await database();
      let active = true;
      const owner = {
        read: async () => {
          if (!active) throw storageError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'custody ownership was released');
          return readCustody(db, appId);
        },
        replace: async (expectedRevision, next) => {
          if (!active) throw storageError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'custody ownership was released');
          return replaceCustody(db, appId, expectedRevision, next);
        },
      };
      try {
        return await operation(owner);
      } finally {
        active = false;
      }
    },
  );

  const withFallbackLease = async (appId, operation) => {
    const db = await database();
    let lease = await acquireFallbackLease(db, appId);
    let lost = null;
    let renewing = false;
    const timer = setInterval(async () => {
      if (renewing || lost) return;
      renewing = true;
      try {
        lease = await renewFallbackLease(db, appId, lease);
      } catch (error) {
        lost = error;
      } finally {
        renewing = false;
      }
    }, AUTH_CUSTODY_LEASE_RENEW_MS);
    const assertHeld = () => {
      if (lost) throw lost;
    };
    const owner = {
      read: async () => {
        assertHeld();
        const record = await readCustody(db, appId, lease);
        assertHeld();
        return record;
      },
      replace: async (expectedRevision, next) => {
        assertHeld();
        const record = await replaceCustody(db, appId, expectedRevision, next, lease);
        assertHeld();
        return record;
      },
    };
    try {
      const result = await operation(owner);
      assertHeld();
      return result;
    } finally {
      clearInterval(timer);
      try { await releaseFallbackLease(db, appId, lease); } catch { /* fenced release is best effort */ }
    }
  };

  return {
    async withOwnership(appId, operation) {
      if (closed) throw storageError('SNAPBACK_AUTH_COORDINATOR_CLOSED', 'custody storage is closed');
      if (typeof appId !== 'string' || appId.length === 0) throw new TypeError('appId must be non-empty');
      if (typeof operation !== 'function') throw new TypeError('ownership operation must be a function');
      return lockManager?.request
        ? withWebLock(appId, operation)
        : withFallbackLease(appId, operation);
    },
    async close() {
      if (closed) return;
      closed = true;
      if (databasePromise) (await databasePromise).close();
    },
  };
}
