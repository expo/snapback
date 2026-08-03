import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import { rqsEntryKey } from './rqs-store.mjs';

export const QUERY_REGISTRATION_FORMAT_V1 = 'snapback.query-registration.v1';
export const DURABLE_REGISTRATION_RECORD_CEILING = 512;
export const DURABLE_REGISTRATION_BYTE_CEILING = 16 * 1024;
export const ESTABLISHMENT_CONCURRENCY = 4;

const SOURCES = new Set(['active', 'preload', 'programmatic']);
const OWNER_KINDS = Object.freeze({
  active: 'subscription',
  preload: 'route',
  programmatic: 'api',
});
const RETENTION = new Set(['none', 'durable']);
const TTL = new Set(['none', 'default', 'pinned']);
const QMK = /^qmk1\.[A-Za-z0-9_-]{43}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const utf8 = new TextEncoder();

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => structuredClone(value);
const same = (a, b) => canonicalizeClientValueV1(a) === canonicalizeClientValueV1(b);

function refused(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function exact(value, fields, where) {
  if (!plain(value)) throw refused('SNAPBACK_QUERY_REGISTRATION_INVALID', `${where} must be an object`);
  const expected = [...fields].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw refused('SNAPBACK_QUERY_REGISTRATION_INVALID', `${where} is not a closed record`);
  }
}

function nonempty(value, where) {
  if (typeof value !== 'string' || value.length === 0) {
    throw refused('SNAPBACK_QUERY_REGISTRATION_INVALID', `${where} must be a non-empty string`);
  }
}

function prepareScope(value) {
  if (value?.kind === 'page') {
    exact(value, ['kind', 'input'], 'requestedScope');
    if (value.input?.kind === 'first') exact(value.input, ['kind'], 'requestedScope.input');
    else {
      exact(value.input, ['kind', 'profileId', 'digest'], 'requestedScope.input');
      if (value.input.kind !== 'cursor' || typeof value.input.profileId !== 'string' || !DIGEST.test(value.input.digest ?? '')) {
        throw refused('SNAPBACK_QUERY_REGISTRATION_INVALID', 'requestedScope page cursor is invalid');
      }
    }
    return clone(value);
  }
  if (value?.kind === 'page-set') {
    exact(value, ['kind', 'from', 'through'], 'requestedScope');
    if (value.from !== 'first' || value.through !== 'terminal') {
      throw refused('SNAPBACK_QUERY_REGISTRATION_INVALID', 'requestedScope page set must span first through terminal');
    }
    return clone(value);
  }
  throw refused('SNAPBACK_QUERY_REGISTRATION_INVALID', 'requestedScope is outside the closed union');
}

export function prepareQueryRegistrationV1(value) {
  exact(value, [
    'format', 'registrationId', 'source', 'ownerContext', 'functionReference',
    'canonicalArgs', 'requestedScope', 'retentionRequest', 'idleTtlClass',
  ], 'registration');
  if (value.format !== QUERY_REGISTRATION_FORMAT_V1) {
    throw refused('SNAPBACK_QUERY_REGISTRATION_INVALID', 'registration format is invalid');
  }
  nonempty(value.registrationId, 'registrationId');
  if (!SOURCES.has(value.source)) {
    throw refused('SNAPBACK_QUERY_REGISTRATION_INVALID', 'registration source is invalid');
  }
  const ownerKind = OWNER_KINDS[value.source];
  const ownerField = ownerKind === 'subscription' ? 'contextId' : ownerKind === 'route' ? 'routeId' : 'label';
  if (!plain(value.ownerContext) || value.ownerContext.kind !== ownerKind) {
    throw refused(
      'SNAPBACK_QUERY_REGISTRATION_SOURCE_OWNER_MISMATCH',
      `${value.source} registrations require ${ownerKind} ownership`,
    );
  }
  exact(value.ownerContext, ['kind', ownerField], 'ownerContext');
  if (ownerField === 'label') {
    if (value.ownerContext.label !== null) nonempty(value.ownerContext.label, 'ownerContext.label');
  } else nonempty(value.ownerContext[ownerField], `ownerContext.${ownerField}`);
  if (!plain(value.functionReference)) {
    throw refused('SNAPBACK_QUERY_REGISTRATION_INVALID', 'functionReference must be an object');
  }
  // CanonicalClientValueV1 is the owner of runtime-argument admission. Running
  // it here rejects getters, cycles, undefined, and values outside its bounds.
  canonicalizeClientValueV1(value.canonicalArgs);
  canonicalizeClientValueV1(value.functionReference);
  if (!RETENTION.has(value.retentionRequest) || !TTL.has(value.idleTtlClass)) {
    throw refused('SNAPBACK_QUERY_REGISTRATION_INVALID', 'registration policy is outside the closed lattice');
  }
  return clone({ ...value, requestedScope: prepareScope(value.requestedScope) });
}

function defaultAddressResolver(registration, clientStoreId) {
  const reference = registration.functionReference;
  const explicit = reference.clientMaterializationAddress ?? reference.materializationAddress ?? null;
  if (Array.isArray(explicit)) {
    if (
      explicit.length !== 3
      || explicit[0] !== 'snapback:client-materialization-address:v1'
      || explicit[1] !== clientStoreId
      || !QMK.test(explicit[2] ?? '')
    ) throw refused('SNAPBACK_QUERY_REGISTRATION_ADDRESS_INVALID', 'admitted qmk1 address is invalid');
    return { family: 'qmk1', address: clone(explicit), addressKey: explicit[2] };
  }
  if (QMK.test(reference.materializationKey ?? '')) {
    const address = ['snapback:client-materialization-address:v1', clientStoreId, reference.materializationKey];
    return { family: 'qmk1', address, addressKey: reference.materializationKey };
  }
  const name = typeof reference.name === 'string' && reference.name.length > 0
    ? reference.name
    : typeof reference.id === 'string' && reference.id.length > 0
      ? reference.id
      : null;
  if (name === null) {
    throw refused('SNAPBACK_QUERY_REGISTRATION_ADDRESS_INVALID', 'legacy reference has no alias-producing name');
  }
  return { family: 'legacy-resume', address: null, addressKey: rqsEntryKey(name, registration.canonicalArgs) };
}

const priority = (source) => source === 'active' ? 0 : source === 'preload' ? 1 : 2;
const ttlMaximum = (records) => records.some((entry) => entry.registration.idleTtlClass === 'pinned')
  ? 'pinned'
  : records.some((entry) => entry.registration.idleTtlClass === 'default') ? 'default' : 'none';
const retentionMaximum = (records) => records.some((entry) => entry.registration.retentionRequest === 'durable')
  ? 'durable'
  : 'none';

function durableEntries(slot) {
  const entries = [];
  for (const [addressKey, registrations] of Object.entries(slot ?? {})) {
    if (!plain(registrations)) throw refused('SNAPBACK_QUERY_REGISTRATION_STORE_CORRUPT', 'durable registration address slot is invalid');
    for (const [registrationId, registration] of Object.entries(registrations)) {
      entries.push({ addressKey, registrationId, registration });
    }
  }
  return entries;
}

function recordBytes(registration) {
  return utf8.encode(canonicalizeClientValueV1(registration)).byteLength;
}

// @ref LLP 0166#d2--the-sync-specification-registered-queries — this ledger is
// the one registration-derived sync set. Policy axes merge independently and
// final release pins the exact last live maxima for L5's grace owner.
export async function createRegistrationLedger({
  storeHandle,
  clientStoreId,
  resolveAddress = null,
  materializationStore = null,
  now = () => Date.now(),
  establishmentConcurrency = ESTABLISHMENT_CONCURRENCY,
} = {}) {
  if (storeHandle !== null && typeof storeHandle?.materializationTransaction !== 'function') {
    throw new TypeError('registration ledger requires a v3 RQS store handle');
  }
  nonempty(clientStoreId, 'clientStoreId');
  if (!Number.isSafeInteger(establishmentConcurrency) || establishmentConcurrency < 1) {
    throw new TypeError('establishmentConcurrency must be a positive safe integer');
  }
  const resolver = typeof resolveAddress === 'function'
    ? (registration) => resolveAddress(registration, clientStoreId)
    : (registration) => defaultAddressResolver(registration, clientStoreId);
  const records = new Map();
  const addresses = new Map();
  const contexts = new Map();
  const revisions = new Map();
  const grace = new Map();
  const scopes = new Map();
  const transitions = new Map();
  const hydration = new Map();
  let sequence = 0;
  let running = 0;
  let drainPromise = null;
  let resolveDrain = null;

  const resolve = (registration) => {
    const result = resolver(registration);
    if (!plain(result) || !['qmk1', 'legacy-resume'].includes(result.family)) {
      throw refused('SNAPBACK_QUERY_REGISTRATION_ADDRESS_INVALID', 'address resolver returned an invalid family');
    }
    nonempty(result.addressKey, 'resolved addressKey');
    if (result.family === 'qmk1') {
      const expected = defaultAddressResolver({ ...registration, functionReference: { materializationAddress: result.address } }, clientStoreId);
      if (expected.addressKey !== result.addressKey) {
        throw refused('SNAPBACK_QUERY_REGISTRATION_ADDRESS_INVALID', 'qmk1 address key does not match its address');
      }
    } else if (result.address !== null) {
      throw refused('SNAPBACK_QUERY_REGISTRATION_ADDRESS_INVALID', 'legacy alias must not carry a qmk1 address');
    }
    return clone(result);
  };

  const rowsAt = (addressKey) => [...(addresses.get(addressKey) ?? [])]
    .map((id) => records.get(id))
    .filter(Boolean);

  const policyOf = (addressKey) => {
    const live = rowsAt(addressKey);
    if (live.length > 0) return {
      retentionRequest: retentionMaximum(live),
      idleTtlClass: ttlMaximum(live),
      demandState: live.some((entry) => entry.registration.source === 'active')
        ? 'demanded-active'
        : 'demanded-idle',
    };
    const pinned = grace.get(addressKey);
    return {
      retentionRequest: pinned?.retentionRequest ?? 'none',
      idleTtlClass: pinned?.idleTtlClass ?? 'none',
      demandState: 'undemanded',
    };
  };

  const recomputeScope = (addressKey) => {
    const live = rowsAt(addressKey);
    if (live.length === 0) {
      scopes.set(addressKey, { effectiveScope: null, supersededRegistrationIds: [] });
      return;
    }
    const sets = live.filter((entry) => entry.registration.requestedScope.kind === 'page-set');
    // Hermes-safe non-mutating sort: Array.prototype.toSorted (ES2023) is
    // absent on RN/Hermes carriers (issues/20260803-rn-carrier-bricked-...).
    const winner = [...(sets.length > 0 ? sets : live)]
      .sort((a, b) => b.sequence - a.sequence)[0];
    const supersededRegistrationIds = live
      .filter((entry) => entry.registration.requestedScope.kind === 'page' && entry !== winner)
      .map((entry) => entry.registration.registrationId)
      .sort();
    scopes.set(addressKey, {
      effectiveScope: clone(winner.registration.requestedScope),
      supersededRegistrationIds,
    });
  };

  const settleDrain = () => {
    if (running !== 0 || [...hydration.values()].some((entry) => entry.state === 'queued')) return;
    resolveDrain?.();
    drainPromise = null;
    resolveDrain = null;
  };

  const schedule = () => {
    while (running < establishmentConcurrency) {
      const candidate = [...hydration.entries()]
        .filter(([, entry]) => entry.state === 'queued')
        .sort(([, a], [, b]) => (
          priority(a.source) - priority(b.source)
          || a.lastEstablishedAt - b.lastEstablishedAt
          || a.queuedAt - b.queuedAt
        ))[0];
      if (!candidate) break;
      const [addressKey, state] = candidate;
      state.state = 'pending';
      state.attempt = 'pending';
      running += 1;
      void (async () => {
        try {
          let beganEstablishment = false;
          if (state.resolution.family === 'qmk1' && materializationStore) {
            let observation = null;
            const release = materializationStore.observeMaterialization(state.resolution.address, (next) => { observation = next; });
            release();
            if (!observation?.present || !observation.generation) {
              throw refused('SNAPBACK_MATERIALIZATION_NOT_INITIALIZED', 'registered materialization is not initialized');
            }
            await materializationStore.beginEstablishment(
              state.resolution.address,
              state.requestedScope,
              observation.generation,
            );
            beganEstablishment = true;
          }
          state.state = 'idle';
          state.attempt = beganEstablishment ? 'pending' : 'idle';
          state.lastEstablishedAt = now();
          state.refusal = null;
        } catch (error) {
          const code = error?.code ?? 'SNAPBACK_QUERY_HYDRATION_FAILED';
          state.state = code.includes('OFFLINE') || code.includes('NETWORK') ? 'offline' : 'refused';
          state.attempt = state.state;
          state.refusal = { code };
        } finally {
          running -= 1;
          if (state.rerun === true && hydration.get(addressKey) === state) {
            state.rerun = false;
            state.state = 'queued';
            state.attempt = 'pending';
            state.queuedAt = now();
          }
          schedule();
          settleDrain();
        }
      })();
    }
    settleDrain();
  };

  const queueHydration = (entry) => {
    const scope = scopes.get(entry.resolution.addressKey)?.effectiveScope ?? entry.registration.requestedScope;
    const previous = hydration.get(entry.resolution.addressKey);
    if (previous?.state === 'pending') {
      previous.source = rowsAt(entry.resolution.addressKey)
        .sort((a, b) => priority(a.registration.source) - priority(b.registration.source))[0]
        ?.registration.source ?? entry.registration.source;
      previous.requestedScope = clone(scope);
      previous.rerun = true;
      return;
    }
    hydration.set(entry.resolution.addressKey, {
      source: rowsAt(entry.resolution.addressKey).sort((a, b) => priority(a.registration.source) - priority(b.registration.source))[0]?.registration.source ?? entry.registration.source,
      resolution: clone(entry.resolution),
      requestedScope: clone(scope),
      state: 'queued',
      attempt: 'idle',
      queuedAt: now(),
      lastEstablishedAt: previous?.lastEstablishedAt ?? 0,
      refusal: null,
      rerun: false,
    });
    schedule();
  };

  const add = (registrationInput, { durable = false } = {}) => {
    const registration = prepareQueryRegistrationV1(registrationInput);
    const resolution = resolve(registration);
    const existing = records.get(registration.registrationId);
    if (existing) {
      if (same(existing.registration, registration) && same(existing.resolution, resolution)) return existing;
      throw refused('SNAPBACK_QUERY_REGISTRATION_ID_CONFLICT', 'registrationId is already bound to another record');
    }
    const before = policyOf(resolution.addressKey);
    const entry = { registration, resolution, durable, sequence: ++sequence };
    records.set(registration.registrationId, entry);
    const ids = addresses.get(resolution.addressKey) ?? new Set();
    ids.add(registration.registrationId);
    addresses.set(resolution.addressKey, ids);
    grace.delete(resolution.addressKey);
    recomputeScope(resolution.addressKey);
    const after = policyOf(resolution.addressKey);
    if (before.retentionRequest === 'durable' && after.retentionRequest === 'none' && after.demandState !== 'undemanded') {
      transitions.set(resolution.addressKey, 'pending-payload-reclaim');
    } else if (after.retentionRequest === 'durable') transitions.delete(resolution.addressKey);
    queueHydration(entry);
    return entry;
  };

  const remove = (registrationId) => {
    const entry = records.get(registrationId);
    if (!entry) return null;
    const addressKey = entry.resolution.addressKey;
    const beforeRows = rowsAt(addressKey);
    const before = {
      retentionRequest: retentionMaximum(beforeRows),
      idleTtlClass: ttlMaximum(beforeRows),
    };
    records.delete(registrationId);
    const ids = addresses.get(addressKey);
    ids?.delete(registrationId);
    if (ids?.size === 0) addresses.delete(addressKey);
    if (!addresses.has(addressKey)) {
      grace.set(addressKey, { ...before, pinnedAt: now() });
      hydration.delete(addressKey);
    }
    recomputeScope(addressKey);
    const after = policyOf(addressKey);
    if (before.retentionRequest === 'durable' && after.retentionRequest === 'none' && after.demandState !== 'undemanded') {
      transitions.set(addressKey, 'pending-payload-reclaim');
    }
    return entry;
  };

  const persisted = storeHandle === null
    ? {}
    : await storeHandle.materializationTransaction('readonly', (view) => (
        clone(view.storeMeta.durableRegistrations)
      ));
  for (const { addressKey, registrationId, registration } of durableEntries(persisted)) {
    const entry = add(registration, { durable: true });
    if (entry.registration.registrationId !== registrationId || entry.resolution.addressKey !== addressKey) {
      throw refused('SNAPBACK_QUERY_REGISTRATION_STORE_CORRUPT', 'durable registration slot does not match its identity');
    }
  }

  const interfaceObject = {
    applyContextDemands({ contextId, authorityPartitionDigest, revision, demands }) {
      nonempty(contextId, 'contextId');
      if (!DIGEST.test(authorityPartitionDigest ?? '')) {
        throw refused('SNAPBACK_QUERY_REGISTRATION_INVALID', 'authorityPartitionDigest is invalid');
      }
      if (!Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(demands)) {
        throw refused('SNAPBACK_QUERY_REGISTRATION_INVALID', 'context demand revision or set is invalid');
      }
      const pair = `${contextId}\u0000${authorityPartitionDigest}`;
      if (revision <= (revisions.get(pair) ?? -1)) return { applied: false };
      const prepared = demands.map((registration) => {
        const admitted = prepareQueryRegistrationV1(registration);
        if (admitted.source === 'active' && admitted.ownerContext.contextId !== contextId) {
          throw refused('SNAPBACK_QUERY_REGISTRATION_CONTEXT_MISMATCH', 'active registration belongs to another context');
        }
        const resolution = resolve(admitted);
        if (resolution.authorityPartitionDigest && resolution.authorityPartitionDigest !== authorityPartitionDigest) {
          throw refused('SNAPBACK_QUERY_REGISTRATION_PARTITION_MISMATCH', 'registration belongs to another authority partition');
        }
        return admitted;
      });
      const preparedIds = new Set();
      for (const registration of prepared) {
        if (preparedIds.has(registration.registrationId)) {
          throw refused('SNAPBACK_QUERY_REGISTRATION_ID_CONFLICT', 'one demand set repeats a registrationId');
        }
        preparedIds.add(registration.registrationId);
        if ([...contexts].some(([otherPair, ids]) => (
          otherPair !== pair && ids.has(registration.registrationId)
        ))) {
          throw refused('SNAPBACK_QUERY_REGISTRATION_ID_CONFLICT', 'registrationId belongs to another context partition');
        }
      }
      const priorIds = contexts.get(pair) ?? new Set();
      const nextIds = new Set(prepared.map((entry) => entry.registrationId));
      for (const registration of prepared) {
        const existing = records.get(registration.registrationId);
        if (!existing) add(registration);
        else if (!same(existing.registration, registration)) {
          remove(registration.registrationId);
          add(registration);
        }
      }
      for (const id of priorIds) if (!nextIds.has(id)) remove(id);
      contexts.set(pair, nextIds);
      revisions.set(pair, revision);
      return { applied: true };
    },

    releaseContextDemands({ contextId }) {
      nonempty(contextId, 'contextId');
      for (const [pair, ids] of [...contexts]) {
        if (!pair.startsWith(`${contextId}\u0000`)) continue;
        for (const id of ids) remove(id);
        contexts.delete(pair);
      }
    },

    async registerDurable(registrationInput) {
      let registration;
      let resolution;
      try {
        registration = prepareQueryRegistrationV1(registrationInput);
        if (registration.source !== 'programmatic') {
          throw refused('SNAPBACK_QUERY_REGISTRATION_DURABILITY_MISMATCH', 'only programmatic registrations are durable');
        }
        if (storeHandle === null) {
          return { refused: { code: 'SNAPBACK_QUERY_REGISTRATION_STORE_DISABLED' } };
        }
        resolution = resolve(registration);
        const live = records.get(registration.registrationId);
        if (live && (!same(live.registration, registration) || live.durable !== true)) {
          return { refused: { code: 'SNAPBACK_QUERY_REGISTRATION_ID_CONFLICT' } };
        }
        const bytes = recordBytes(registration);
        if (bytes > DURABLE_REGISTRATION_BYTE_CEILING) {
          return { refused: { code: 'SNAPBACK_QUERY_REGISTRATION_BYTES_LIMIT' } };
        }
        const result = await storeHandle.materializationTransaction('readwrite', (view) => {
          const entries = durableEntries(view.storeMeta.durableRegistrations);
          const duplicate = entries.find((entry) => entry.registrationId === registration.registrationId);
          if (duplicate) {
            return same(duplicate.registration, registration)
              ? { committed: true, duplicate: true }
              : { refused: { code: 'SNAPBACK_QUERY_REGISTRATION_ID_CONFLICT' } };
          }
          if (entries.length >= DURABLE_REGISTRATION_RECORD_CEILING) {
            return { refused: { code: 'SNAPBACK_QUERY_REGISTRATION_LIMIT' } };
          }
          view.storeMeta.durableRegistrations[resolution.addressKey] ??= {};
          view.storeMeta.durableRegistrations[resolution.addressKey][registration.registrationId] = clone(registration);
          return { committed: true, duplicate: false };
        });
        if (result.refused) return result;
        if (!records.has(registration.registrationId)) add(registration, { durable: true });
        return { committed: true };
      } catch (error) {
        return { refused: { code: error?.code ?? 'SNAPBACK_QUERY_REGISTRATION_INVALID' } };
      }
    },

    async releaseDurable({ registrationId }) {
      nonempty(registrationId, 'registrationId');
      if (storeHandle === null) {
        remove(registrationId);
        return { released: true };
      }
      await storeHandle.materializationTransaction('readwrite', (view) => {
        for (const [addressKey, byId] of Object.entries(view.storeMeta.durableRegistrations)) {
          if (!own(byId, registrationId)) continue;
          delete byId[registrationId];
          if (Object.keys(byId).length === 0) delete view.storeMeta.durableRegistrations[addressKey];
          break;
        }
      });
      remove(registrationId);
      return { released: true };
    },

    effectivePolicy(addressKey) {
      nonempty(addressKey, 'addressKey');
      return Object.freeze(policyOf(addressKey));
    },

    demandState(addressKey) {
      return interfaceObject.effectivePolicy(addressKey).demandState;
    },

    scopeState(addressKey) {
      const state = scopes.get(addressKey) ?? { effectiveScope: null, supersededRegistrationIds: [] };
      return clone(state);
    },

    retentionTransition(addressKey) {
      return transitions.get(addressKey) ?? 'none';
    },

    hydrationState(addressKey) {
      const state = hydration.get(addressKey);
      return state ? clone(state) : null;
    },

    registrations(addressKey = null) {
      return [...records.values()]
        .filter((entry) => addressKey === null || entry.resolution.addressKey === addressKey)
        .map((entry) => clone({ registration: entry.registration, resolution: entry.resolution }));
    },

    awaitHydrationIdle() {
      if (running === 0 && ![...hydration.values()].some((entry) => entry.state === 'queued')) return Promise.resolve();
      if (!drainPromise) drainPromise = new Promise((resolvePromise) => { resolveDrain = resolvePromise; });
      return drainPromise;
    },
  };
  return Object.freeze(interfaceObject);
}

let defaultLedger = null;
export function installRegistrationLedger(ledger) {
  defaultLedger = ledger;
  return ledger;
}
const installed = () => {
  if (!defaultLedger) throw new Error('SNAPBACK_QUERY_REGISTRATION_LEDGER_UNINITIALIZED');
  return defaultLedger;
};

// Broker seam: keep these spellings and argument shapes stable. Store-scoped
// callers normally use the same methods on createRegistrationLedger's result;
// the installed projection exists for the cross-context broker module.
export const applyContextDemands = (input) => installed().applyContextDemands(input);
export const releaseContextDemands = (input) => installed().releaseContextDemands(input);
export const registerDurable = (input) => installed().registerDurable(input);
export const releaseDurable = (input) => installed().releaseDurable(input);
export const effectivePolicy = (addressKey) => installed().effectivePolicy(addressKey);
export const demandState = (addressKey) => installed().demandState(addressKey);
