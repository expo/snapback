// Shared format-v3 metadata primitives for the IndexedDB, file, and memory
// carriers. This module owns representation/validation only; LLP 0053 remains
// the owner of fence and allocator semantics, and LLP 0059 remains the owner
// of authority-barrier orchestration.

export const RQS_STORE_FORMAT_VERSION = 3;
export const RQS_STORE_META_KEY = 'state';

const RECORD_SLOTS = [
  'durableRegistrations',
  'policyBudgetFacts',
  'brokerRoster',
  // Last answered target capability fact used only to admit an automatic
  // offline enqueue after a transport-lost re-probe. The value itself binds
  // canonical origin plus, for generated references, exact app artifact
  // generation; replay never reads this slot as execution authority.
  'offlineMutationReplayCapabilityFact',
  'fenceHighWaters',
  'tombstoneHighWaters',
  'barrierHighWaters',
  // Complete AuthorizedLease custody for qmk1 fragments. L2 stores only the
  // unkeyed hash; this owner slot retains the exact issued bytes and the
  // rollback-checked client deadline that validation projects as leaseStatus.
  'materializationLeaseCustody',
  // Format-6-shaped query authorization + AuthorizedLease custody for the
  // ordinary generated LiveQuery path. This is deliberately separate from
  // both authority-independent RQS entries and qmk1 fragment custody: a
  // protected query is renderable after restart only through this slot's
  // exact namespace/fence/witness/lease validation.
  'authorizedQueryRetention',
];
const RESET_SLOTS = [
  'durableRegistrations',
  'policyBudgetFacts',
  'brokerRoster',
  'materializationLeaseCustody',
  'authorizedQueryRetention',
];
const ADDITIVE_DEFAULT_SLOTS = [
  'materializationLeaseCustody',
  'authorizedQueryRetention',
  'offlineMutationReplayCapabilityFact',
];

const plainRecord = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const jsonValue = (value, seen = new Set()) => {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) return true;
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => jsonValue(item, seen))
    : Object.getPrototypeOf(value) === Object.prototype
      && Object.values(value).every((item) => jsonValue(item, seen));
  seen.delete(value);
  return valid;
};

const clone = (value) => structuredClone(value);

const hex = (bytes) => [...bytes]
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

export function secureStoreRandomBytes(length) {
  const source = globalThis.crypto;
  if (typeof source?.getRandomValues !== 'function') {
    const error = new Error(
      'SNAPBACK_RQS_STORE_RANDOM_UNAVAILABLE: store identity and handle keys require crypto.getRandomValues',
    );
    error.code = 'SNAPBACK_RQS_STORE_RANDOM_UNAVAILABLE';
    throw error;
  }
  return source.getRandomValues(new Uint8Array(length));
}

const takeRandom = (randomBytes, length) => {
  const bytes = randomBytes(length);
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
    throw new TypeError(`store randomBytes(${length}) must return exactly ${length} Uint8Array bytes`);
  }
  return bytes;
};

export const mintClientStoreId = (randomBytes = secureStoreRandomBytes) => (
  `cs1_${hex(takeRandom(randomBytes, 16))}`
);

export const mintStoreHandleKey = (randomBytes = secureStoreRandomBytes) => (
  hex(takeRandom(randomBytes, 32))
);

export function createInitialStoreMeta({ clientStoreId = null, randomBytes } = {}) {
  const id = clientStoreId ?? mintClientStoreId(randomBytes);
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('clientStoreId must be a non-empty string');
  }
  return {
    formatVersion: RQS_STORE_FORMAT_VERSION,
    clientStoreId: id,
    queryInstanceIdHighWater: 0,
    generationCounters: {
      writerGeneration: 0,
      authorityGenerationHighWater: 0,
      queryGenerationHighWater: 0,
      offlineReplayCapabilityRequestHighWater: 0,
    },
    handleKey: mintStoreHandleKey(randomBytes),
    ...Object.fromEntries(RECORD_SLOTS.map((slot) => [slot, {}])),
  };
}

export function prepareStoreMeta(value) {
  if (!plainRecord(value) || !jsonValue(value)) return null;
  // Additive format-v3 migrations are closed: the two original
  // hydration/lease additions, the target-capability fact, and its later
  // request allocator may be defaulted. Missing predecessor allocators,
  // registration, or fence state remains corruption instead of being
  // silently reset to an empty high-water.
  const prepared = {
    ...value,
    ...Object.fromEntries(
      ADDITIVE_DEFAULT_SLOTS
        .filter((slot) => value[slot] === undefined)
        .map((slot) => [slot, {}]),
    ),
  };
  if (prepared.formatVersion !== RQS_STORE_FORMAT_VERSION) return null;
  if (typeof prepared.clientStoreId !== 'string' || prepared.clientStoreId.length === 0) return null;
  if (
    !Number.isSafeInteger(prepared.queryInstanceIdHighWater)
    || prepared.queryInstanceIdHighWater < 0
  ) return null;
  if (!plainRecord(prepared.generationCounters)) return null;
  prepared.generationCounters = {
    ...prepared.generationCounters,
    // Additive format-v3 migration for the shared capability-observation
    // allocator. Reservations are durable even when their request loses
    // transport; only answered facts advance the fact itself.
    offlineReplayCapabilityRequestHighWater:
      prepared.generationCounters.offlineReplayCapabilityRequestHighWater ?? 0,
  };
  for (const field of [
    'writerGeneration',
    'authorityGenerationHighWater',
    'queryGenerationHighWater',
    'offlineReplayCapabilityRequestHighWater',
  ]) {
    if (!Number.isSafeInteger(prepared.generationCounters[field]) || prepared.generationCounters[field] < 0) {
      return null;
    }
  }
  if (typeof prepared.handleKey !== 'string' || !/^[0-9a-f]{64}$/u.test(prepared.handleKey)) return null;
  for (const slot of RECORD_SLOTS) {
    if (!plainRecord(prepared[slot])) return null;
  }
  try {
    return clone(prepared);
  } catch {
    return null;
  }
}

const OFFLINE_REPLAY_CAPABILITY_OBSERVATION_V1 =
  'snapback.offline-replay-capability-observation.v1';

export function prepareOfflineMutationReplayCapabilityObservation(value) {
  if (
    !plainRecord(value)
    || value.schemaVersion !== OFFLINE_REPLAY_CAPABILITY_OBSERVATION_V1
    || !Number.isSafeInteger(value.requestSequence)
    || value.requestSequence < 1
    || !Number.isSafeInteger(value.observedStoreRevision)
    || value.observedStoreRevision < 0
  ) return null;
  return Object.freeze({
    schemaVersion: OFFLINE_REPLAY_CAPABILITY_OBSERVATION_V1,
    requestSequence: value.requestSequence,
    observedStoreRevision: value.observedStoreRevision,
  });
}

export function allocateOfflineMutationReplayCapabilityObservationInMeta(value) {
  const meta = prepareStoreMeta(value);
  if (meta === null) return null;
  const highWater = meta.generationCounters.offlineReplayCapabilityRequestHighWater;
  if (highWater === Number.MAX_SAFE_INTEGER) {
    const error = new Error(
      'SNAPBACK_RQS_STORE_ALLOCATOR_EXHAUSTED: offline replay capability request allocator exhausted',
    );
    error.code = 'SNAPBACK_RQS_STORE_ALLOCATOR_EXHAUSTED';
    throw error;
  }
  const current = meta.offlineMutationReplayCapabilityFact;
  const observedStoreRevision = plainRecord(current)
    && Number.isSafeInteger(current.storeRevision)
    && current.storeRevision >= 1
    ? current.storeRevision
    : 0;
  const requestSequence = highWater + 1;
  meta.generationCounters.offlineReplayCapabilityRequestHighWater = requestSequence;
  return {
    meta,
    observation: Object.freeze({
      schemaVersion: OFFLINE_REPLAY_CAPABILITY_OBSERVATION_V1,
      requestSequence,
      observedStoreRevision,
    }),
  };
}

export function compareAndVersionOfflineMutationReplayCapabilityFact(
  current,
  fact,
  observation,
) {
  const preparedObservation = prepareOfflineMutationReplayCapabilityObservation(observation);
  if (preparedObservation === null || !plainRecord(fact) || !jsonValue(fact)) return null;
  const currentFact = plainRecord(current) ? clone(current) : {};
  const currentStoreRevision = Number.isSafeInteger(currentFact.storeRevision)
    && currentFact.storeRevision >= 1
    ? currentFact.storeRevision
    : 0;
  const currentRequestSequence = Number.isSafeInteger(currentFact.requestSequence)
    && currentFact.requestSequence >= 1
    ? currentFact.requestSequence
    : 0;
  const currentGenerationWasObserved =
    preparedObservation.observedStoreRevision === currentStoreRevision;
  const requestIsStrictlyNewerThanStampedFloor =
    preparedObservation.requestSequence > currentRequestSequence;
  if (preparedObservation.observedStoreRevision < currentStoreRevision) {
    if (!requestIsStrictlyNewerThanStampedFloor) {
      return { fact: currentFact, committed: false };
    }
  } else if (!currentGenerationWasObserved && !requestIsStrictlyNewerThanStampedFloor) {
    return { fact: currentFact, committed: false };
  }
  if (currentStoreRevision === Number.MAX_SAFE_INTEGER) return null;
  const replacement = clone(fact);
  delete replacement.storeRevision;
  delete replacement.requestSequence;
  return {
    fact: {
      ...replacement,
      requestSequence: preparedObservation.requestSequence,
      storeRevision: currentStoreRevision + 1,
    },
    committed: true,
  };
}

export function allocateQueryInstanceIdInMeta(value) {
  const meta = prepareStoreMeta(value);
  if (meta === null) return null;
  if (meta.queryInstanceIdHighWater === Number.MAX_SAFE_INTEGER) {
    const error = new Error(
      'SNAPBACK_RQS_STORE_ALLOCATOR_EXHAUSTED: query_instance_id allocator exhausted',
    );
    error.code = 'SNAPBACK_RQS_STORE_ALLOCATOR_EXHAUSTED';
    throw error;
  }
  meta.queryInstanceIdHighWater += 1;
  return { meta, queryInstanceId: meta.queryInstanceIdHighWater };
}

// @ref LLP 0166#d1--one-store-domain — wipe clears policy-owned slots, preserves
//   allocator/fence/generation high-waters, and rotates only the handle key.
export function wipeStoreMeta(value, { randomBytes } = {}) {
  const meta = prepareStoreMeta(value);
  if (meta === null) return null;
  return {
    ...meta,
    handleKey: mintStoreHandleKey(randomBytes),
    ...Object.fromEntries(RESET_SLOTS.map((slot) => [slot, {}])),
  };
}
