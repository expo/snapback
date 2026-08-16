// IndexedDB custody storage with Web Locks ownership and a transactionally
// fenced lease fallback.
//
// @ref LLP 0059#cross-context-ownership — localStorage is only a wakeup hint;
//   custody and fallback lease CAS live in the same IndexedDB transaction.

import {
  AUTH_DEFAULT_STORAGE_PARTITION,
  AUTH_CUSTODY_DATABASE_NAME,
  AUTH_CUSTODY_DATABASE_VERSION,
  AUTH_CUSTODY_LEASE_MS,
  AUTH_CUSTODY_LEASE_RENEW_MS,
  authCustodyOwnerKeyHash,
  createAuthCustodyError,
  normalizeAuthCustodyOwnerKey,
  validateAuthCustody,
  validateAuthCustodyReplacement,
  validateAuthCustodySenderKeys,
} from './auth-coordinator.mjs';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const OBSERVED_UNCHANGED_MS = AUTH_CUSTODY_LEASE_MS;
const RETRY_POLL_MS = 50;
const PARTITIONED_KEY_MARKER = 'snapback-auth-custody-partition-v1';

const clone = (value) => {
  if (value === undefined) return undefined;
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  const CryptoKeyClass = globalThis.CryptoKey;
  const containsCryptoKey = (candidate) => (
    typeof CryptoKeyClass === 'function'
    && (
      candidate instanceof CryptoKeyClass
      || (
        candidate !== null
        && typeof candidate === 'object'
        && Reflect.ownKeys(candidate).some((key) => containsCryptoKey(candidate[key]))
      )
    )
  );
  if (containsCryptoKey(value)) {
    throw storageError(
      'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED',
      'sender-constrained custody requires structured clone support',
    );
  }
  return JSON.parse(JSON.stringify(value));
};

const storageError = createAuthCustodyError;

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
      if (
        !db.objectStoreNames.contains('custody')
        || !db.objectStoreNames.contains('leases')
      ) {
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

function ownerAddress(input) {
  const ownerKey = normalizeAuthCustodyOwnerKey(input);
  if (ownerKey.storagePartition === AUTH_DEFAULT_STORAGE_PARTITION) {
    // @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback — adapters address records by the full owner key (appId, storagePartition); the default partition retains the legacy app-id row and lock name.
    return {
      appId: ownerKey.appId,
      storageKey: ownerKey.appId,
      lockName: `snapback-auth-custody:${ownerKey.appId}`,
    };
  }
  const partitionHash = authCustodyOwnerKeyHash(ownerKey);
  return {
    appId: ownerKey.appId,
    storageKey: [PARTITIONED_KEY_MARKER, partitionHash],
    lockName: `snapback-auth-custody-partition:${partitionHash}`,
  };
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

  const readCustody = async (db, address, lease = null) => {
    const stores = lease ? ['custody', 'leases'] : ['custody'];
    const tx = db.transaction(stores, 'readonly');
    const custodyRequest = tx.objectStore('custody').get(address.storageKey);
    const leaseRequest = lease ? tx.objectStore('leases').get(address.storageKey) : null;
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
    return record === undefined ? null : validateAuthCustodySenderKeys(record, address.appId);
  };

  const replaceCustody = async (db, address, expectedRevision, next, lease = null) => {
    const validatedNext = await validateAuthCustodySenderKeys(next, address.appId);
    const stores = lease ? ['custody', 'leases'] : ['custody'];
    const tx = db.transaction(stores, 'readwrite');
    const custodyStore = tx.objectStore('custody');
    try {
      const currentRaw = await requestResult(custodyStore.get(address.storageKey));
      const current = currentRaw === undefined
        ? null
        : validateAuthCustody(currentRaw, address.appId);
      if ((current?.revision ?? null) !== expectedRevision) {
        tx.abort();
        throw storageError(
          'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
          'durable custody changed before compare-and-swap',
          { expectedRevision, actualRevision: current?.revision ?? null },
        );
      }
      if (lease) {
        const currentLeaseRaw = await requestResult(
          tx.objectStore('leases').get(address.storageKey),
        );
        const currentLease = currentLeaseRaw === undefined ? null : validateLease(currentLeaseRaw);
        if (!sameLeaseHolder(currentLease, lease) || currentLease.expiresAtMs <= wallNow()) {
          tx.abort();
          throw storageError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'fallback custody lease was lost');
        }
      }
      const validated = validateAuthCustodyReplacement(current, validatedNext, address.appId);
      custodyStore.put(clone(validated), address.storageKey);
      await transactionDone(tx);
      return validated;
    } catch (error) {
      if (tx.readyState !== 'done') {
        try { tx.abort(); } catch { /* already completed or aborted */ }
      }
      throw error;
    }
  };

  const acquireFallbackLease = async (db, address) => {
    const holderNonce = nonce128(cryptoObject);
    let observed = null;
    let observedSince = null;
    for (;;) {
      const tx = db.transaction(['leases'], 'readwrite');
      const store = tx.objectStore('leases');
      const raw = await requestResult(store.get(address.storageKey));
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
        store.put(lease, address.storageKey);
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

  const renewFallbackLease = async (db, address, lease) => {
    const tx = db.transaction(['leases'], 'readwrite');
    const store = tx.objectStore('leases');
    const raw = await requestResult(store.get(address.storageKey));
    const current = raw === undefined ? null : validateLease(raw);
    if (!sameLeaseHolder(current, lease) || current.expiresAtMs <= wallNow()) {
      tx.abort();
      throw storageError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'fallback custody lease was lost');
    }
    const next = { ...lease, expiresAtMs: wallNow() + AUTH_CUSTODY_LEASE_MS };
    store.put(next, address.storageKey);
    await transactionDone(tx);
    return next;
  };

  // Transactionally reread the lease row and require the exact holder,
  // unexpired. The renewal timer's `lost` flag is only a fast local hint — a
  // paused former holder's timer may not have fired since a takeover.
  const assertFallbackLeaseHeld = async (db, address, lease) => {
    const tx = db.transaction(['leases'], 'readonly');
    const raw = await requestResult(tx.objectStore('leases').get(address.storageKey));
    await transactionDone(tx);
    const current = raw === undefined ? null : validateLease(raw);
    if (!sameLeaseHolder(current, lease) || current.expiresAtMs <= wallNow()) {
      throw storageError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'fallback custody lease was lost');
    }
  };

  // @ref LLP 0059#cross-context-ownership — the lease-row fence spans the
  // publication commit: the synchronous callback runs inside an exclusive
  // `leases` transaction that revalidated the holder, so a takeover cannot
  // interleave between validation and publication, and a paused former holder
  // fails with lock loss before any stale publication executes.
  const fencePublication = async (db, address, lease, publish) => {
    const tx = db.transaction(['leases'], 'readwrite');
    const raw = await requestResult(tx.objectStore('leases').get(address.storageKey));
    const current = raw === undefined ? null : validateLease(raw);
    if (!sameLeaseHolder(current, lease) || current.expiresAtMs <= wallNow()) {
      try { tx.abort(); } catch { /* already completed or aborted */ }
      throw storageError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'fallback custody lease was lost');
    }
    let value;
    try {
      value = publish();
    } catch (error) {
      try { tx.abort(); } catch { /* already completed or aborted */ }
      throw error;
    }
    await transactionDone(tx);
    return value;
  };

  const releaseFallbackLease = async (db, address, lease) => {
    const tx = db.transaction(['leases'], 'readwrite');
    const store = tx.objectStore('leases');
    const raw = await requestResult(store.get(address.storageKey));
    const current = raw === undefined ? null : validateLease(raw);
    if (sameLeaseHolder(current, lease)) {
      store.put({ ...lease, expiresAtMs: 0 }, address.storageKey);
    }
    await transactionDone(tx);
  };

  const withWebLock = async (address, operation) => lockManager.request(
    address.lockName,
    { mode: 'exclusive' },
    async () => {
      const db = await database();
      let active = true;
      const owner = {
        read: async () => {
          if (!active) throw storageError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'custody ownership was released');
          return readCustody(db, address);
        },
        replace: async (expectedRevision, next) => {
          if (!active) throw storageError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'custody ownership was released');
          return replaceCustody(db, address, expectedRevision, next);
        },
      };
      try {
        return await operation(owner);
      } finally {
        active = false;
      }
    },
  );

  const withFallbackLease = async (address, operation) => {
    const db = await database();
    let lease = await acquireFallbackLease(db, address);
    let lost = null;
    let renewing = false;
    const timer = setInterval(async () => {
      if (renewing || lost) return;
      renewing = true;
      try {
        lease = await renewFallbackLease(db, address, lease);
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
        const record = await readCustody(db, address, lease);
        assertHeld();
        return record;
      },
      replace: async (expectedRevision, next) => {
        assertHeld();
        const record = await replaceCustody(db, address, expectedRevision, next, lease);
        assertHeld();
        return record;
      },
      fencePublication: async (publish) => {
        assertHeld();
        const value = await fencePublication(db, address, lease, publish);
        assertHeld();
        return value;
      },
    };
    try {
      const result = await operation(owner);
      assertHeld();
      // @ref LLP 0059#cross-context-ownership — a paused former holder never
      // successfully returns after a successor takeover: completion requires
      // the durable lease row, not just the renewal timer's local flag.
      await assertFallbackLeaseHeld(db, address, lease);
      return result;
    } finally {
      clearInterval(timer);
      try { await releaseFallbackLease(db, address, lease); } catch { /* fenced release is best effort */ }
    }
  };

  return {
    ownerKeyCapability: 'owner-key-v1',
    async withOwnership(ownerKeyInput, operation) {
      if (closed) throw storageError('SNAPBACK_AUTH_COORDINATOR_CLOSED', 'custody storage is closed');
      if (typeof operation !== 'function') throw new TypeError('ownership operation must be a function');
      const address = ownerAddress(ownerKeyInput);
      return lockManager?.request
        ? withWebLock(address, operation)
        : withFallbackLease(address, operation);
    },
    async close() {
      if (closed) return;
      closed = true;
      if (databasePromise) (await databasePromise).close();
    },
  };
}
