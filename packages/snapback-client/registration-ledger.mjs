import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import { rqsEntryKey } from './rqs-store.mjs';
import { base64UrlNoPad, sha256 as sha256PureJs } from './rqs.mjs';

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

function preloadManifestRefusal(message) {
  const error = new TypeError(`SNAPBACK_PRELOAD_MANIFEST_INVALID: ${message}`);
  error.code = 'SNAPBACK_PRELOAD_MANIFEST_INVALID';
  return error;
}

/**
 * Project one server-resolved routes-manifest boot into the closed LLP 0166
 * preload registration record. Registration identity belongs with the ledger,
 * not the public Channel-A/C payload reader.
 *
 * @ref LLP 0166#registration-sources-mapped-to-shipped-machinery — Channel
 * A/C boots are the concrete route instances from which preload demand is
 * re-derived on every client boot.
 */
export function derivePreloadQueryRegistrationsV1(payload, {
  authorityPartitionDigest,
  bootId,
  functionReferences = null,
  entryFunctionReferences = null,
  persist = true,
} = {}) {
  if (
    typeof payload?.route !== 'string'
    || payload.route.length === 0
    || typeof payload?.generation !== 'string'
    || payload.generation.length === 0
    || !Array.isArray(payload?.entries)
    || typeof authorityPartitionDigest !== 'string'
    || !DIGEST.test(authorityPartitionDigest)
    || typeof bootId !== 'string'
    || bootId.length === 0
  ) throw preloadManifestRefusal('route, generation, entries, owner partition, and boot identity are required');
  const references = functionReferences && typeof functionReferences === 'object'
    ? functionReferences
    : {};
  const registrations = payload.entries.map((entry, position) => {
    if (!entry || typeof entry.function !== 'string' || entry.function.length === 0) {
      throw preloadManifestRefusal(`entry ${position} lacks a concrete function`);
    }
    let canonicalArgs;
    try {
      canonicalArgs = JSON.parse(canonicalizeClientValueV1(entry.args ?? {}));
    } catch {
      throw preloadManifestRefusal(`entry ${position} args are not CanonicalClientValueV1`);
    }
    const suppliedReference = Array.isArray(entryFunctionReferences)
      ? entryFunctionReferences[position]
      : references[entry.function];
    const functionReference = suppliedReference && typeof suppliedReference === 'object'
      ? structuredClone(suppliedReference)
      : { name: entry.function };
    functionReference.authorityPartitionDigest = authorityPartitionDigest;
    const identity = canonicalizeClientValueV1({
      bootId,
      generation: payload.generation,
      route: payload.route,
      position,
      function: entry.function,
      args: canonicalArgs,
    });
    const registrationId = `qpre1_${base64UrlNoPad(sha256PureJs(
      utf8.encode(`snapback:preload-registration:v1:${identity}`),
    ))}`;
    return Object.freeze({
      format: QUERY_REGISTRATION_FORMAT_V1,
      registrationId,
      source: 'preload',
      ownerContext: { kind: 'route', routeId: payload.route },
      functionReference,
      canonicalArgs,
      requestedScope: { kind: 'page-set', from: 'first', through: 'terminal' },
      retentionRequest: persist === false ? 'none' : 'durable',
      idleTtlClass: 'default',
    });
  });
  const revisionIdentity = canonicalizeClientValueV1({
    generation: payload.generation,
    route: payload.route,
    entries: registrations.map((registration) => ({
      functionReference: registration.functionReference,
      canonicalArgs: registration.canonicalArgs,
    })),
    persist: persist !== false,
  });
  return Object.freeze({
    manifestRevision: `qpm1_${base64UrlNoPad(sha256PureJs(
      utf8.encode(`snapback:preload-manifest-revision:v1:${revisionIdentity}`),
    ))}`,
    registrations: Object.freeze(registrations),
  });
}

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
  const authorityPartitionDigest = reference.authorityPartitionDigest;
  if (!DIGEST.test(authorityPartitionDigest ?? '')) {
    throw refused(
      'SNAPBACK_QUERY_REGISTRATION_PARTITION_REQUIRED',
      'registration requires its owner-issued authority partition digest',
    );
  }
  const explicit = reference.clientMaterializationAddress ?? reference.materializationAddress ?? null;
  if (Array.isArray(explicit)) {
    if (
      explicit.length !== 3
      || explicit[0] !== 'snapback:client-materialization-address:v1'
      || explicit[1] !== clientStoreId
      || !QMK.test(explicit[2] ?? '')
    ) throw refused('SNAPBACK_QUERY_REGISTRATION_ADDRESS_INVALID', 'admitted qmk1 address is invalid');
    return {
      family: 'qmk1',
      address: clone(explicit),
      addressKey: explicit[2],
      authorityPartitionDigest,
    };
  }
  if (QMK.test(reference.materializationKey ?? '')) {
    const address = ['snapback:client-materialization-address:v1', clientStoreId, reference.materializationKey];
    return {
      family: 'qmk1',
      address,
      addressKey: reference.materializationKey,
      authorityPartitionDigest,
    };
  }
  const name = typeof reference.name === 'string' && reference.name.length > 0
    ? reference.name
    : typeof reference.id === 'string' && reference.id.length > 0
      ? reference.id
      : null;
  if (name === null) {
    throw refused('SNAPBACK_QUERY_REGISTRATION_ADDRESS_INVALID', 'legacy reference has no alias-producing name');
  }
  return {
    family: 'legacy-resume',
    address: null,
    addressKey: rqsEntryKey(name, registration.canonicalArgs),
    authorityPartitionDigest,
  };
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
  let preloadManifestRevision = null;
  let preloadManifestSnapshot = null;
  let preloadRegistrationIds = new Set();
  // Current rows belong to the volatile active registration that received
  // them. They are deliberately outside storeMeta/materialization payload:
  // a live delivery proves current presentation for this registration, not
  // durable completeness after the registration disappears.
  const liveAnswers = new Map();
  const grace = new Map();
  const scopes = new Map();
  const transitions = new Map();
  const hydration = new Map();
  let sequence = 0;
  let running = 0;
  let drainPromise = null;
  let resolveDrain = null;

  const resolve = (registration) => {
    const resolved = resolver(registration);
    const authorityPartitionDigest = resolved?.authorityPartitionDigest
      ?? registration.functionReference.authorityPartitionDigest;
    const result = resolved && DIGEST.test(authorityPartitionDigest ?? '')
      ? { ...resolved, authorityPartitionDigest }
      : resolved;
    if (!plain(result) || !['qmk1', 'legacy-resume'].includes(result.family)) {
      throw refused('SNAPBACK_QUERY_REGISTRATION_ADDRESS_INVALID', 'address resolver returned an invalid family');
    }
    if (!DIGEST.test(result.authorityPartitionDigest ?? '')) {
      throw refused(
        'SNAPBACK_QUERY_REGISTRATION_PARTITION_REQUIRED',
        'address resolver omitted the owner-issued authority partition digest',
      );
    }
    nonempty(result.addressKey, 'resolved addressKey');
    if (result.family === 'qmk1') {
      const expected = defaultAddressResolver({
        ...registration,
        functionReference: {
          materializationAddress: result.address,
          authorityPartitionDigest: result.authorityPartitionDigest
            ?? registration.functionReference.authorityPartitionDigest,
        },
      }, clientStoreId);
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

  const add = (registrationInput, { durable = false, preparedResolution = null } = {}) => {
    const registration = prepareQueryRegistrationV1(registrationInput);
    // Manifest replacement resolves and validates the complete candidate set
    // before mutation. Reuse that snapshot during commit so a custom owner
    // resolver cannot be observed twice and turn an admitted all-or-nothing
    // revision into a partial update.
    const resolution = preparedResolution === null
      ? resolve(registration)
      : clone(preparedResolution);
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
    liveAnswers.delete(registrationId);
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
        if (admitted.source !== 'active') {
          throw refused(
            'SNAPBACK_QUERY_REGISTRATION_DURABILITY_MISMATCH',
            'context demand sets contain active registrations only',
          );
        }
        if (admitted.ownerContext.contextId !== contextId) {
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

    // @ref LLP 0166#the-registration-record — preload registrations are one
    // boot-scoped, manifest-derived set. Replacement is all-or-nothing: the
    // same record/byte ceilings used by durable authoring refuse an oversized
    // manifest before ordinary add/remove commits any entry.
    replacePreloadManifest({ manifestRevision, registrations }) {
      try {
        nonempty(manifestRevision, 'manifestRevision');
        if (!Array.isArray(registrations)) {
          throw refused('SNAPBACK_PRELOAD_MANIFEST_INVALID', 'preload registrations must be an array');
        }
        if (registrations.length > DURABLE_REGISTRATION_RECORD_CEILING) {
          return { refused: { code: 'SNAPBACK_QUERY_REGISTRATION_LIMIT' } };
        }
        const prepared = registrations.map((registrationInput) => {
          const registration = prepareQueryRegistrationV1(registrationInput);
          if (registration.source !== 'preload') {
            throw refused(
              'SNAPBACK_QUERY_REGISTRATION_DURABILITY_MISMATCH',
              'preload manifests contain preload registrations only',
            );
          }
          if (recordBytes(registration) > DURABLE_REGISTRATION_BYTE_CEILING) {
            throw refused(
              'SNAPBACK_QUERY_REGISTRATION_BYTES_LIMIT',
              'preload registration exceeds the per-record byte ceiling',
            );
          }
          return { registration, resolution: resolve(registration) };
        });
        const ids = new Set();
        for (const entry of prepared) {
          const id = entry.registration.registrationId;
          if (ids.has(id)) {
            throw refused('SNAPBACK_QUERY_REGISTRATION_ID_CONFLICT', 'preload manifest repeats a registrationId');
          }
          ids.add(id);
          const existing = records.get(id);
          if (existing && !preloadRegistrationIds.has(id)) {
            throw refused('SNAPBACK_QUERY_REGISTRATION_ID_CONFLICT', 'preload registrationId belongs to another source');
          }
        }
        const snapshot = canonicalizeClientValueV1(registrations);
        if (preloadManifestRevision === manifestRevision) {
          if (preloadManifestSnapshot !== snapshot) {
            throw refused(
              'SNAPBACK_PRELOAD_MANIFEST_REVISION_CONFLICT',
              'one manifest revision cannot name different preload registrations',
            );
          }
          return { committed: true, added: 0, retired: 0, duplicate: true };
        }
        let retired = 0;
        for (const id of preloadRegistrationIds) {
          if (ids.has(id)) continue;
          if (remove(id)) retired += 1;
        }
        let added = 0;
        for (const { registration, resolution } of prepared) {
          const existing = records.get(registration.registrationId);
          if (
            existing
            && (!same(existing.registration, registration)
              || !same(existing.resolution, resolution))
          ) {
            remove(registration.registrationId);
          }
          if (!records.has(registration.registrationId)) {
            add(registration, { preparedResolution: resolution });
            added += 1;
          }
        }
        preloadRegistrationIds = ids;
        preloadManifestRevision = manifestRevision;
        preloadManifestSnapshot = snapshot;
        return { committed: true, added, retired, duplicate: false };
      } catch (error) {
        return { refused: { code: error?.code ?? 'SNAPBACK_PRELOAD_MANIFEST_INVALID' } };
      }
    },

    releaseContextDemands({ contextId }) {
      nonempty(contextId, 'contextId');
      for (const [pair, ids] of [...contexts]) {
        if (!pair.startsWith(`${contextId}\u0000`)) continue;
        for (const id of ids) remove(id);
        contexts.delete(pair);
        // A released pair's revision bookkeeping goes with it: the handoff
        // flow releases every roster context and rebuilds from
        // re-announcements, which legitimately re-carry their last revision
        // (LLP 0166 §D2 — never-reused contextIds protect across lifetimes).
        revisions.delete(pair);
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

    // Construction seam for the broker/policy runtime. Keeping resolution in
    // the ledger prevents shipped callers from forking the default-vs-owner-
    // supplied address rules used by every registration mutation above.
    resolveRegistration(registrationInput) {
      const registration = prepareQueryRegistrationV1(registrationInput);
      return resolve(registration);
    },

    // The liveQuery delivery path publishes only after its handle is both
    // authoritative/current and transport-current. Clearing is synchronous,
    // so connecting, stale, refused, paused, and disposed transitions revoke
    // admission before a later mutation can observe the old rows.
    //
    // @ref LLP 0155#local-read-admission — admitted materialized rows include
    //   the demanded active registration's current authoritative row set.
    publishLiveRegistrationAnswer({
      registrationId,
      rows,
      version,
      subscriptionId,
      materialization,
    }) {
      nonempty(registrationId, 'registrationId');
      const entry = records.get(registrationId);
      if (!entry || entry.registration.source !== 'active') return false;
      if (
        !Array.isArray(rows)
        || !Number.isSafeInteger(version)
        || version < 0
        || typeof subscriptionId !== 'string'
        || subscriptionId.length === 0
        || !plain(materialization)
      ) {
        throw refused(
          'SNAPBACK_LIVE_REGISTRATION_ANSWER_INVALID',
          'live registration answer is outside the closed current-row shape',
        );
      }
      let preparedRows;
      let preparedMaterialization;
      try {
        preparedRows = JSON.parse(canonicalizeClientValueV1(rows));
        preparedMaterialization = JSON.parse(canonicalizeClientValueV1(materialization));
      } catch {
        throw refused(
          'SNAPBACK_LIVE_REGISTRATION_ANSWER_INVALID',
          'live registration rows or identity are not canonical client values',
        );
      }
      liveAnswers.set(registrationId, {
        answerClass: 'authoritative',
        freshness: 'current',
        rows: preparedRows,
        version,
        subscriptionId,
        materialization: preparedMaterialization,
      });
      return true;
    },

    clearLiveRegistrationAnswer(registrationId) {
      nonempty(registrationId, 'registrationId');
      return liveAnswers.delete(registrationId);
    },

    // Move-3 read admission consumes this demand projection instead of
    // scanning carrier records. A grace-held record has no live registration
    // and therefore never becomes mutation input merely because bytes remain.
    // @ref LLP 0166#d2--the-sync-specification-registered-queries — the sync
    //   set is exactly the registration-derived demand set.
    demandedMaterializations() {
      return [...addresses.keys()].sort().map((addressKey) => {
        const entries = rowsAt(addressKey);
        const first = entries[0];
        return clone({
          family: first.resolution.family,
          address: first.resolution.address,
          addressKey,
          demandState: policyOf(addressKey).demandState,
          effectiveScope: scopes.get(addressKey)?.effectiveScope ?? null,
          registrations: entries.map((entry) => ({
            registration: entry.registration,
            resolution: entry.resolution,
            liveAnswer: liveAnswers.get(entry.registration.registrationId) ?? null,
          })),
        });
      });
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
export const demandedMaterializations = () => installed().demandedMaterializations();
