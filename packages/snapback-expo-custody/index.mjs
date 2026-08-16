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
} from '@expo/snapback-contract/auth-coordinator';

export const SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED =
  'SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED';

const MODULE_NAME = 'SnapbackExpoCustody';
const KEY_PREFIX = 'snapback.auth-custody.';
const nativeLocks = new WeakMap();
let defaultNativeModulePromise;

function assertOrdinaryBearerCustody(record) {
  if (
    record?.formatVersion === SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION
    || record?.senderConstraint != null
    || record?.pendingSenderConstraint != null
  ) {
    throw createAuthCustodyError(
      'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED',
      'native custody carries ordinary bearer custody only; sender-constrained custody requires a CryptoKey-capable adapter',
    );
  }
}

function validateOrdinaryBearerCustody(record, appId) {
  assertOrdinaryBearerCustody(record);
  return validateAuthCustody(record, appId);
}

function nativeAddress(input) {
  const ownerKey = normalizeAuthCustodyOwnerKey(input);
  if (ownerKey.storagePartition === AUTH_DEFAULT_STORAGE_PARTITION) {
    // @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback — native adapters address the full owner key while retaining the shipped default-partition address.
    return Object.freeze({
      appId: ownerKey.appId,
      storageKey: `${KEY_PREFIX}${authAppIdHash(ownerKey.appId)}`,
    });
  }
  return Object.freeze({
    appId: ownerKey.appId,
    storageKey: `${KEY_PREFIX}partition.${authCustodyOwnerKeyHash(ownerKey)}`,
  });
}

function lockFor(nativeModule, storageKey) {
  let locks = nativeLocks.get(nativeModule);
  if (!locks) {
    locks = new Map();
    nativeLocks.set(nativeModule, locks);
  }
  let lock = locks.get(storageKey);
  if (!lock) {
    lock = { tail: Promise.resolve() };
    locks.set(storageKey, lock);
  }
  return lock;
}

async function loadDefaultNativeModule() {
  if (!defaultNativeModulePromise) {
    defaultNativeModulePromise = import('expo-modules-core').then(({ requireNativeModule }) => (
      requireNativeModule(MODULE_NAME)
    ));
  }
  return defaultNativeModulePromise;
}

function assertNativeModule(nativeModule) {
  if (!nativeModule || typeof nativeModule !== 'object') {
    throw new TypeError('nativeModule must be an object');
  }
  for (const method of ['platformGrade', 'read', 'compareAndReplace']) {
    if (typeof nativeModule[method] !== 'function') {
      throw new TypeError(`nativeModule must provide ${method}`);
    }
  }
  return nativeModule;
}

function nativeFailure(result, operation) {
  if (result?.status === 'single-runtime-refused') {
    return createAuthCustodyError(
      SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED,
      'native auth custody is available only in the application main runtime',
      { operation, platform: result.platform ?? null, process: result.process ?? null },
    );
  }
  if (result?.status === 'corrupt') {
    return createAuthCustodyError(
      'SNAPBACK_AUTH_CUSTODY_CORRUPT',
      'native auth custody failed envelope verification',
      { operation, reason: result.reason ?? null },
    );
  }
  if (result?.status === 'cas-stale') {
    return createAuthCustodyError(
      'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
      'durable custody changed before native compare-and-swap',
      {
        expectedRevision: result.expectedRevision ?? null,
        actualRevision: result.actualRevision ?? null,
      },
    );
  }
  return createAuthCustodyError(
    'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED',
    'native auth custody operation failed',
    { operation, status: result?.status ?? null, reason: result?.reason ?? null },
  );
}

async function callNative(operation, invoke) {
  try {
    return await invoke();
  } catch (error) {
    if (error?.code === SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED) {
      return Promise.reject(createAuthCustodyError(
        SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED,
        'native auth custody is available only in the application main runtime',
        { operation },
      ));
    }
    return Promise.reject(createAuthCustodyError(
      'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED',
      'native auth custody call failed',
      { operation, causeCode: error?.code ?? null },
    ));
  }
}

function parseNativeRecord(encoded, appId) {
  if (typeof encoded !== 'string') {
    throw createAuthCustodyError(
      'SNAPBACK_AUTH_CUSTODY_CORRUPT',
      'native auth custody record is not a serialized string',
    );
  }
  let record;
  try {
    record = JSON.parse(encoded);
  } catch {
    throw createAuthCustodyError(
      'SNAPBACK_AUTH_CUSTODY_CORRUPT',
      'native auth custody record is not valid JSON',
    );
  }
  return validateOrdinaryBearerCustody(record, appId);
}

/**
 * Construct first-party, native-CAS ordinary bearer custody for Expo iOS and Android.
 */
export function createNativeAuthCustodyStorage(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('native custody options must be an object');
  }
  const resolveNativeModule = options.nativeModule === undefined
    ? loadDefaultNativeModule
    : async () => assertNativeModule(options.nativeModule);
  if (options.onDiagnostic !== undefined && typeof options.onDiagnostic !== 'function') {
    throw new TypeError('onDiagnostic must be a function');
  }

  const reportDiagnostic = (diagnostic) => {
    try {
      if (options.onDiagnostic) {
        options.onDiagnostic(diagnostic);
      } else {
        console.warn(`${diagnostic.code}: ${diagnostic.message}`, diagnostic.details);
      }
    } catch {
      // Diagnostics must remain observable without turning a recoverable
      // custody-absent outcome into a storage wedge.
    }
  };

  return Object.freeze({
    ownerKeyCapability: 'owner-key-v1',

    async platformGrade() {
      const nativeModule = assertNativeModule(await resolveNativeModule());
      const result = await callNative('platformGrade', () => nativeModule.platformGrade());
      if (
        result?.status !== 'ok'
        || (result.os !== 'ios' && result.os !== 'android')
        || result.grade !== 'single-runtime'
        || typeof result.mechanism !== 'string'
        || result.mechanism.length === 0
        || typeof result.moduleVersion !== 'string'
        || result.moduleVersion.length === 0
      ) {
        throw nativeFailure(result, 'platformGrade');
      }
      return Object.freeze({
        os: result.os,
        grade: 'single-runtime',
        mechanism: result.mechanism,
        moduleVersion: result.moduleVersion,
      });
    },

    async withOwnership(ownerKeyInput, operation) {
      if (typeof operation !== 'function') {
        throw new TypeError('ownership operation must be a function');
      }
      const { appId, storageKey } = nativeAddress(ownerKeyInput);
      const nativeModule = assertNativeModule(await resolveNativeModule());
      const lock = lockFor(nativeModule, storageKey);
      const prior = lock.tail;
      let releaseTail;
      lock.tail = new Promise((resolve) => { releaseTail = resolve; });
      await prior;

      const readRecord = async () => {
        const result = await callNative(
          'read',
          () => nativeModule.read(appId, storageKey),
        );
        if (result?.status === 'ok') {
          return result.record === null ? null : parseNativeRecord(result.record, appId);
        }
        if (result?.status === 'absent') {
          const diagnostic = createAuthCustodyError(
            'SNAPBACK_AUTH_CUSTODY_CORRUPT',
            'native auth custody became unavailable and was treated as absent',
            { operation: 'read', reason: result.reason ?? null },
          ).diagnostic;
          reportDiagnostic(diagnostic);
          return null;
        }
        throw nativeFailure(result, 'read');
      };

      const owner = createSerialOwner(
        readRecord,
        async (expectedRevision, next) => {
          const validatedNext = validateOrdinaryBearerCustody(next, appId);
          const current = await readRecord();
          const validated = validateAuthCustodyReplacement(current, validatedNext, appId);
          const serialized = JSON.stringify(validated);
          // @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback — the JS read is validation/courtesy serialization only; correctness comes from this one native expected-revision CAS call.
          const result = await callNative(
            'compareAndReplace',
            () => nativeModule.compareAndReplace(
              appId,
              storageKey,
              expectedRevision,
              serialized,
            ),
          );
          if (result?.status !== 'ok') throw nativeFailure(result, 'compareAndReplace');
          const persisted = parseNativeRecord(result.record, appId);
          if (JSON.stringify(persisted) !== serialized) {
            throw createAuthCustodyError(
              'SNAPBACK_AUTH_CUSTODY_CORRUPT',
              'native auth custody read-verify did not echo the replacement',
            );
          }
          return persisted;
        },
      );
      const operationOwner = Object.freeze({
        read: owner.read,
        replace(expectedRevision, next) {
          // Refuse before createSerialOwner tries to clone an opaque native key.
          assertOrdinaryBearerCustody(next);
          return owner.replace(expectedRevision, next);
        },
      });

      try {
        return await operation(operationOwner);
      } finally {
        owner.release();
        releaseTail();
      }
    },
  });
}
