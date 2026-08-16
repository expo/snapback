// Expo SecureStore custody for one React Native process.
//
// @ref LLP 0059#cross-context-ownership — SecureStore carries ordinary bearer
//   custody under an in-process owner; sender-constrained key custody refuses.

import {
  AUTH_DEFAULT_STORAGE_PARTITION,
  SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION,
  authAppIdHash,
  authCustodyOwnerKeyHash,
  createAuthCustodyError,
  createSerialOwner,
  normalizeAuthCustodyOwnerKey,
  validateAuthCustody,
  validateAuthCustodyReplacement,
} from './auth-coordinator.mjs';

const KEY_PREFIX = 'snapback.auth-custody.';
const secureStoreLocks = new WeakMap();
const storageError = createAuthCustodyError;

function lockFor(SecureStore, key) {
  let locks = secureStoreLocks.get(SecureStore);
  if (!locks) {
    locks = new Map();
    secureStoreLocks.set(SecureStore, locks);
  }
  let lock = locks.get(key);
  if (!lock) {
    lock = { tail: Promise.resolve() };
    locks.set(key, lock);
  }
  return lock;
}

function secureStoreAddress(input) {
  const ownerKey = normalizeAuthCustodyOwnerKey(input);
  if (ownerKey.storagePartition === AUTH_DEFAULT_STORAGE_PARTITION) {
    // @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback — adapters address records by the full owner key (appId, storagePartition); the default partition retains the shipped SecureStore key.
    return {
      appId: ownerKey.appId,
      key: `${KEY_PREFIX}${authAppIdHash(ownerKey.appId)}`,
    };
  }
  return {
    appId: ownerKey.appId,
    key: `${KEY_PREFIX}partition.${authCustodyOwnerKeyHash(ownerKey)}`,
  };
}

function assertOrdinaryBearerCustody(record) {
  if (
    record?.formatVersion === SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION
    || record?.senderConstraint != null
    || record?.pendingSenderConstraint != null
  ) {
    throw storageError(
      'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED',
      'SecureStore carries ordinary bearer custody only; sender-constrained custody requires a CryptoKey-capable adapter',
    );
  }
}

function validateOrdinaryBearerCustody(record, appId) {
  assertOrdinaryBearerCustody(record);
  return validateAuthCustody(record, appId);
}

/**
 * Native AuthCoordinator storage backed by an injected expo-secure-store
 * module. The package deliberately takes no dependency on Expo.
 */
export function createSecureStoreAuthCustodyStorage(
  SecureStore,
  { secureStoreOptions } = {},
) {
  if (
    (typeof SecureStore !== 'object' || SecureStore === null)
    && typeof SecureStore !== 'function'
  ) {
    throw new TypeError('SecureStore must be an object');
  }
  if (
    typeof SecureStore.getItemAsync !== 'function'
    || typeof SecureStore.setItemAsync !== 'function'
  ) {
    throw new TypeError('SecureStore must provide getItemAsync and setItemAsync');
  }

  return {
    ownerKeyCapability: 'owner-key-v1',
    async withOwnership(ownerKeyInput, operation) {
      if (typeof operation !== 'function') {
        throw new TypeError('ownership operation must be a function');
      }
      const { appId, key } = secureStoreAddress(ownerKeyInput);
      const lock = lockFor(SecureStore, key);
      const prior = lock.tail;
      let releaseTail;
      lock.tail = new Promise((resolve) => { releaseTail = resolve; });
      await prior;

      const readRecord = async () => {
        let encoded;
        try {
          encoded = await SecureStore.getItemAsync(key, secureStoreOptions);
        } catch {
          throw storageError(
            'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED',
            'SecureStore custody read failed',
            { operation: 'getItemAsync' },
          );
        }
        if (encoded === null) return null;
        if (typeof encoded !== 'string') {
          throw storageError(
            'SNAPBACK_AUTH_CUSTODY_CORRUPT',
            'persisted SecureStore custody is not a string',
          );
        }
        let record;
        try {
          record = JSON.parse(encoded);
        } catch {
          throw storageError(
            'SNAPBACK_AUTH_CUSTODY_CORRUPT',
            'persisted SecureStore custody is not valid JSON',
          );
        }
        return validateOrdinaryBearerCustody(record, appId);
      };

      const owner = createSerialOwner(
        readRecord,
        async (expectedRevision, next) => {
          const validatedNext = validateOrdinaryBearerCustody(next, appId);
          const current = await readRecord();
          const actualRevision = current?.revision ?? null;
          if (actualRevision !== expectedRevision) {
            throw storageError(
              'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
              'durable custody changed before compare-and-swap',
              { expectedRevision, actualRevision },
            );
          }
          const validated = validateAuthCustodyReplacement(current, validatedNext, appId);
          try {
            await SecureStore.setItemAsync(
              key,
              JSON.stringify(validated),
              secureStoreOptions,
            );
          } catch {
            throw storageError(
              'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED',
              'SecureStore custody write failed',
              { operation: 'setItemAsync' },
            );
          }
          return validated;
        },
      );
      const operationOwner = {
        read: owner.read,
        replace(expectedRevision, next) {
          // Refuse before createSerialOwner attempts to clone an opaque key.
          // That keeps the adapter diagnostic stable even on runtimes without
          // structuredClone support.
          assertOrdinaryBearerCustody(next);
          return owner.replace(expectedRevision, next);
        },
      };
      try {
        return await operation(operationOwner);
      } finally {
        owner.release();
        releaseTail();
      }
    },
  };
}
