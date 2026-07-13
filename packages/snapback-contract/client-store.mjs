// Store-agnostic retained-query + offline-mutation state (LLP 0043 M1/M2).
//
// The adapter depends only on this async contract. Tests use the deterministic
// memory implementation; web can use the localStorage implementation. Native
// SQLite/OPFS implementations can preserve the same records without changing
// replay semantics (DK-9).

import {
  effectiveDisposition,
  mergeResyncObligation,
  nextInvalidationGeneration,
  resolutionSatisfies,
  scopeKey,
  validateResolutionTicket,
  validateResyncObligation,
} from './auth-invalidation.mjs';

export const SNAPBACK_CLIENT_STORE_VERSION = 5;
export const MAX_OFFLINE_LEDGER_IDS = 1024;
const SNAPBACK_CTX_LEDGER_VERSION = 1;
const REPLAY_OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const ARTIFACT_SCOPE_FIELDS = [
  'schemaHash',
  'inputsHash',
  'targetProfileId',
  'appId',
  'databaseId',
  'versionStreamId',
];
const AUTHORITY_KEY_PATTERN = /^sha256:[0-9a-f]{64}$/;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECORD_IDENTITY_FIELDS = ['authFingerprint', 'authorityKey', ...ARTIFACT_SCOPE_FIELDS];

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};

export const stableJson = (value) => JSON.stringify(canonical(value));

export const retainedQueryKey = (name, args = {}) => `${name}:${stableJson(args)}`;

// Small synchronous SHA-256 implementation for the browser-facing store. The
// auth fingerprint is needed while a surface is being scoped, before any
// asynchronous Web Crypto call can complete. Keeping this implementation
// local also gives Node, browsers, and native shells one byte-for-byte format.
const sha256 = (input) => {
  const bytes = Array.from(input);
  const bitLength = BigInt(bytes.length) * 8n;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  for (let shift = 56n; shift >= 0n; shift -= 8n) {
    bytes.push(Number((bitLength >> shift) & 0xffn));
  }
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const rotr = (value, count) => (value >>> count) | (value << (32 - count));
  const w = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const at = offset + i * 4;
      w[i] = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const sum1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + sum1 + ch + k[i] + w[i]) >>> 0;
      const sum0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (sum0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((word) => word.toString(16).padStart(8, '0')).join('');
};

const authFingerprintBytes = (auth) => {
  const encoder = new TextEncoder();
  const bytes = [...encoder.encode('snapback-auth-fingerprint-v1\0')];
  for (const value of [auth.principal, auth.session_id ?? auth.sessionId, auth.user_id ?? auth.userId]) {
    if (value === null || value === undefined) {
      bytes.push(0);
      continue;
    }
    const encoded = encoder.encode(String(value));
    bytes.push(1);
    const length = BigInt(encoded.length);
    for (let shift = 56n; shift >= 0n; shift -= 8n) {
      bytes.push(Number((length >> shift) & 0xffn));
    }
    for (const byte of encoded) bytes.push(byte);
  }
  return Uint8Array.from(bytes);
};

/** SHA-256 over the length-delimited AuthInput tuple; mirrors src/manifest.rs. */
export const snapbackAuthFingerprint = (authOrUserId = null) => {
  const auth = typeof authOrUserId === 'string' || authOrUserId === null
    // Mirrors demos/_kit/client.mjs SnapbackClient.auth(userId).
    ? { principal: authOrUserId, session_id: null, user_id: authOrUserId }
    : authOrUserId ?? {};
  return `sha256:${sha256(authFingerprintBytes(auth))}`;
};

/** Pre-v2 alias, retained only for cross-language compatibility/recovery tests. */
export const legacySnapbackAuthFingerprint = (authOrUserId = null) => {
  const auth = typeof authOrUserId === 'string' || authOrUserId === null
    ? { principal: authOrUserId, session_id: null, user_id: authOrUserId }
    : authOrUserId ?? {};
  let hash = 0xcbf29ce484222325n;
  const eat = (byte) => {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  };
  for (const value of [auth.principal, auth.session_id ?? auth.sessionId, auth.user_id ?? auth.userId]) {
    if (value === null || value === undefined) {
      eat(0);
    } else {
      eat(1);
      for (const byte of new TextEncoder().encode(String(value))) eat(byte);
    }
    eat(0xff);
  }
  return `fnv1a:${hash.toString(16).padStart(16, '0')}`;
};

const newOrigin = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll('-', '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
};

const freshState = () => ({
  version: SNAPBACK_CLIENT_STORE_VERSION,
  origin: newOrigin(),
  generation: 0,
  authorityEpoch: null,
  authorityKey: null,
  queueAuthorization: {
    authorityGeneration: 0,
    queueGeneration: 0,
    pendingByScope: {},
  },
  principalScope: null,
  authorityDescriptor: null,
  // Reserved for item 8. Format 5 owns and validates the namespace but gives
  // it no lease/invalidation semantics.
  queryAuthorization: {},
  authFingerprint: null,
  artifactScope: null,
  nextSequence: 1,
  retained: {},
  pending: [],
  failed: [],
  acknowledged: [],
  stranded: [],
  legacyV2Stranded: [],
  legacyV3Stranded: [],
  legacyV4Stranded: [],
});

function clientStoreStateError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = {
    code,
    message,
    details,
  };
  return error;
}

function assertStateField(condition, field) {
  if (!condition) {
    throw clientStoreStateError(
      'SNAPBACK_CLIENT_STORE_CORRUPT',
      `persisted client-store field ${field} has an invalid shape`,
      { field },
    );
  }
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function assertQueueAuthorizationState(queue, path, authorityEpoch) {
  assertStateField(isRecord(queue), path);
  assertStateField(
    Object.keys(queue).sort().join(',')
      === 'authorityGeneration,pendingByScope,queueGeneration',
    path,
  );
  assertStateField(
    Number.isSafeInteger(queue.authorityGeneration) && queue.authorityGeneration >= 0,
    `${path}.authorityGeneration`,
  );
  assertStateField(
    Number.isSafeInteger(queue.queueGeneration) && queue.queueGeneration >= 0,
    `${path}.queueGeneration`,
  );
  assertStateField(isRecord(queue.pendingByScope), `${path}.pendingByScope`);
  if (authorityEpoch !== null) {
    assertStateField(
      queue.authorityGeneration === authorityEpoch,
      `${path}.authorityGeneration`,
    );
  }
  for (const [key, value] of Object.entries(queue.pendingByScope)) {
    try {
      const obligation = validateResyncObligation(value, `${path}.pendingByScope`);
      assertStateField(scopeKey(obligation.scopeId) === key, `${path}.pendingByScope`);
      assertStateField(
        obligation.maxDisposition === 'quarantine' || obligation.maxDisposition === 'delete',
        `${path}.pendingByScope`,
      );
    } catch {
      assertStateField(false, `${path}.pendingByScope`);
    }
  }
}

function assertPrincipalScope(scope, path) {
  assertStateField(isRecord(scope), path);
  assertStateField(
    Object.keys(scope).sort().join(',')
      === 'authMode,authorizationStreamIncarnation,userId',
    path,
  );
  assertStateField(scope.authMode === 'dev' || scope.authMode === 'sessions', `${path}.authMode`);
  assertStateField(
    typeof scope.authorizationStreamIncarnation === 'string'
      && UUID_V7_PATTERN.test(scope.authorizationStreamIncarnation),
    `${path}.authorizationStreamIncarnation`,
  );
  assertStateField(
    scope.userId === null || (typeof scope.userId === 'string' && scope.userId.length > 0),
    `${path}.userId`,
  );
}

function assertAuthorityDescriptor(descriptor, path) {
  assertStateField(isRecord(descriptor), path);
  assertStateField(
    Object.keys(descriptor).sort().join(',')
      === 'authorityInstanceId,descriptorVersion,sessionGeneration',
    path,
  );
  assertStateField(descriptor.descriptorVersion === 1, `${path}.descriptorVersion`);
  assertStateField(
    typeof descriptor.authorityInstanceId === 'string'
      && UUID_V7_PATTERN.test(descriptor.authorityInstanceId),
    `${path}.authorityInstanceId`,
  );
  assertStateField(
    Number.isSafeInteger(descriptor.sessionGeneration)
      && descriptor.sessionGeneration >= 0,
    `${path}.sessionGeneration`,
  );
}

function assertOptionalRecordIdentity(record, path) {
  for (const field of RECORD_IDENTITY_FIELDS) {
    assertStateField(
      record[field] === undefined || record[field] === null || typeof record[field] === 'string',
      `${path}.${field}`,
    );
  }
  assertStateField(
    record.authorityEpoch === undefined
      || record.authorityEpoch === null
      || (Number.isSafeInteger(record.authorityEpoch) && record.authorityEpoch >= 0),
    `${path}.authorityEpoch`,
  );
  assertStateField(
    record.authorityKey === undefined
      || record.authorityKey === null
      || (typeof record.authorityKey === 'string' && AUTHORITY_KEY_PATTERN.test(record.authorityKey)),
    `${path}.authorityKey`,
  );
  assertStateField(
    (record.authorityEpoch === undefined || record.authorityEpoch === null)
      === (record.authorityKey === undefined || record.authorityKey === null),
    `${path}.authorityEpoch/authorityKey`,
  );
}

function assertCursor(cursor, path) {
  assertStateField(isRecord(cursor), path);
  assertStateField(typeof cursor.stream === 'string' && cursor.stream.length > 0, `${path}.stream`);
  assertStateField(
    Number.isSafeInteger(cursor.version) && cursor.version >= 0,
    `${path}.version`,
  );
}

function assertMutationRecord(entry, path, expectedStatus) {
  assertStateField(isRecord(entry), path);
  assertOptionalRecordIdentity(entry, path);
  assertStateField(typeof entry.id === 'string' && entry.id.length > 0, `${path}.id`);
  assertStateField(typeof entry.function === 'string' && entry.function.length > 0, `${path}.function`);
  assertStateField(
    Number.isSafeInteger(entry.sequence) && entry.sequence >= 1,
    `${path}.sequence`,
  );
  assertStateField(entry.status === expectedStatus, `${path}.status`);
  if (entry.authorityDescriptor !== undefined && entry.authorityDescriptor !== null) {
    assertAuthorityDescriptor(entry.authorityDescriptor, `${path}.authorityDescriptor`);
  }
  if (entry.baseVersion !== undefined && entry.baseVersion !== null) {
    assertStateField(
      Number.isSafeInteger(entry.baseVersion) && entry.baseVersion >= 0,
      `${path}.baseVersion`,
    );
  }
  if (entry.cursor !== undefined && entry.cursor !== null) {
    assertCursor(entry.cursor, `${path}.cursor`);
    if (entry.versionStreamId !== undefined && entry.versionStreamId !== null) {
      assertStateField(
        typeof entry.versionStreamId === 'string'
          && entry.versionStreamId.length > 0
          && entry.versionStreamId === entry.cursor.stream,
        `${path}.versionStreamId`,
      );
    }
    if (entry.baseVersion !== undefined && entry.baseVersion !== null) {
      assertStateField(
        entry.baseVersion === entry.cursor.version,
        `${path}.baseVersion`,
      );
    }
  }
  if (entry.ctxLedger !== undefined && entry.ctxLedger !== null) {
    assertStateField(isRecord(entry.ctxLedger), `${path}.ctxLedger`);
    assertStateField(
      entry.ctxLedger.version === SNAPBACK_CTX_LEDGER_VERSION,
      `${path}.ctxLedger.version`,
    );
    assertStateField(
      Array.isArray(entry.ctxLedger.ids)
        && entry.ctxLedger.ids.length <= MAX_OFFLINE_LEDGER_IDS
        && entry.ctxLedger.ids.every((id) => (
          typeof id === 'string' && REPLAY_OPAQUE_ID_PATTERN.test(id)
        )),
      `${path}.ctxLedger.ids`,
    );
    assertStateField(
      Number.isSafeInteger(entry.ctxLedger.now) && entry.ctxLedger.now >= 0,
      `${path}.ctxLedger.now`,
    );
  }
}

function assertMatchesCurrentScope(record, path, state, { queued = false } = {}) {
  const modernScope = queued
    ? state.authorityDescriptor !== null
    : state.principalScope !== null;
  if (queued && !modernScope && state.authorityEpoch !== null) {
    assertStateField(record.authorityEpoch === state.authorityEpoch, `${path}.authorityEpoch`);
    assertStateField(record.authorityKey === state.authorityKey, `${path}.authorityKey`);
  }
  if (queued && state.authorityDescriptor !== null) {
    assertStateField(
      record.authorityDescriptor?.authorityInstanceId
        === state.authorityDescriptor.authorityInstanceId,
      `${path}.authorityDescriptor.authorityInstanceId`,
    );
  }
  if (!queued && state.principalScope !== null) {
    assertStateField(
      stableJson(record.principalScope) === stableJson(state.principalScope),
      `${path}.principalScope`,
    );
  }
  if (!modernScope && state.authFingerprint) {
    assertStateField(record.authFingerprint === state.authFingerprint, `${path}.authFingerprint`);
  }
  if (!state.artifactScope) return;
  for (const field of ARTIFACT_SCOPE_FIELDS) {
    const expected = state.artifactScope[field];
    if (!expected) continue;
    assertStateField(record[field] === expected, `${path}.${field}`);
    if (field === 'versionStreamId') {
      assertStateField(record.cursor !== undefined && record.cursor !== null, `${path}.cursor`);
      assertCursor(record.cursor, `${path}.cursor`);
      assertStateField(record.cursor.stream === expected, `${path}.cursor.stream`);
    }
  }
}

const normalizeState = (state) => {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw clientStoreStateError(
      'SNAPBACK_CLIENT_STORE_CORRUPT',
      'persisted client-store state is not an object',
    );
  }
  const legacyV1 = state.version === 1;
  const legacyV2 = state.version === 2;
  const legacyV3 = state.version === 3;
  const legacyV4 = state.version === 4;
  const legacyV4HadQueueAuthorization = legacyV4
    && Object.hasOwn(state, 'queueAuthorization');
  const legacyV4HadAuthorityDescriptor = legacyV4
    && state.authorityDescriptor !== null
    && state.authorityDescriptor !== undefined;
  if (legacyV1 || legacyV2 || legacyV3 || legacyV4) {
    // v2 changed acknowledgements from ambiguous bare ids to auth-tagged
    // records and replaces the collision-prone FNV scope with SHA-256. A v1
    // store retained only the 64-bit alias, not the canonical auth tuple, so
    // no caller-supplied SHA identity can prove it owns those records. Fully
    // validate the old bytes below, then quarantine their privacy/integrity-
    // bearing collections instead of rebinding them across an FNV collision.
    state.version = SNAPBACK_CLIENT_STORE_VERSION;
  } else if (state.version !== SNAPBACK_CLIENT_STORE_VERSION) {
    if (!Number.isSafeInteger(state.version) || state.version < 0) {
      throw clientStoreStateError(
        'SNAPBACK_CLIENT_STORE_CORRUPT',
        'persisted client-store field version has an invalid shape',
        { field: 'version', type: Array.isArray(state.version) ? 'array' : typeof state.version },
      );
    }
    const storedVersion = state.version;
    throw clientStoreStateError(
      'SNAPBACK_CLIENT_STORE_VERSION_UNSUPPORTED',
      `persisted client-store version ${storedVersion} is not supported by version ${SNAPBACK_CLIENT_STORE_VERSION}`,
      {
        storedVersion,
        supportedVersion: SNAPBACK_CLIENT_STORE_VERSION,
        direction: storedVersion > SNAPBACK_CLIENT_STORE_VERSION ? 'future' : 'legacy',
      },
    );
  }
  // Additive legacy fields have explicit migrations. Every original field remains
  // mandatory so truncated durable JSON cannot turn into empty success and
  // let the next write destroy the only copy.
  if (!Object.hasOwn(state, 'generation')) state.generation = 0;
  if (!Object.hasOwn(state, 'acknowledged')) state.acknowledged = [];
  // v3's authority axis is deliberately distinct from the old write
  // generation and caller-asserted fingerprint. A v2 store stays unbound in
  // dev until a server-proven coordinator transition explicitly binds it.
  if (!Object.hasOwn(state, 'authorityEpoch')) state.authorityEpoch = null;
  if (!Object.hasOwn(state, 'authorityKey')) state.authorityKey = null;
  if (!Object.hasOwn(state, 'queueAuthorization')) {
    if (!legacyV1 && !legacyV2 && !legacyV3 && !legacyV4) {
      assertStateField(false, 'queueAuthorization');
    }
    state.queueAuthorization = {
      authorityGeneration: state.authorityEpoch ?? 0,
      queueGeneration: 0,
      pendingByScope: {},
    };
  }
  if (!Object.hasOwn(state, 'stranded')) state.stranded = [];
  if (!Object.hasOwn(state, 'legacyV2Stranded')) state.legacyV2Stranded = [];
  if (!Object.hasOwn(state, 'legacyV3Stranded')) state.legacyV3Stranded = [];
  if (!Object.hasOwn(state, 'legacyV4Stranded')) state.legacyV4Stranded = [];
  if (!Object.hasOwn(state, 'principalScope')) state.principalScope = null;
  if (!Object.hasOwn(state, 'authorityDescriptor')) state.authorityDescriptor = null;
  if (!Object.hasOwn(state, 'queryAuthorization')) state.queryAuthorization = {};
  // Early v1 stores persisted acknowledgement ids as bare strings. Attribute
  // them only when the enclosing store already had a known auth scope; an
  // unscoped id cannot safely be sent under a newly supplied identity.
  state.acknowledged = state.acknowledged.flatMap((entry) => {
    if (typeof entry !== 'string') return [entry];
    return state.authFingerprint === null
      ? []
      : [{ id: entry, authFingerprint: state.authFingerprint }];
  });
  assertStateField(typeof state.origin === 'string' && state.origin.length > 0, 'origin');
  assertStateField(Number.isSafeInteger(state.generation) && state.generation >= 0, 'generation');
  assertStateField(
    state.authorityEpoch === null
      || (Number.isSafeInteger(state.authorityEpoch) && state.authorityEpoch >= 0),
    'authorityEpoch',
  );
  if (state.principalScope !== null) assertPrincipalScope(state.principalScope, 'principalScope');
  if (state.authorityDescriptor !== null) {
    assertAuthorityDescriptor(state.authorityDescriptor, 'authorityDescriptor');
  }
  assertStateField(
    isRecord(state.queryAuthorization)
      && Object.keys(state.queryAuthorization).length === 0,
    'queryAuthorization',
  );
  assertStateField(
    state.authorityKey === null
      || (typeof state.authorityKey === 'string' && AUTHORITY_KEY_PATTERN.test(state.authorityKey)),
    'authorityKey',
  );
  assertStateField(
    (state.authorityEpoch === null) === (state.authorityKey === null),
    'authorityEpoch/authorityKey',
  );
  assertQueueAuthorizationState(
    state.queueAuthorization,
    'queueAuthorization',
    state.authorityEpoch,
  );
  assertStateField(
    state.authFingerprint === null || typeof state.authFingerprint === 'string',
    'authFingerprint',
  );
  assertStateField(
    state.artifactScope === null
      || (typeof state.artifactScope === 'object' && !Array.isArray(state.artifactScope)),
    'artifactScope',
  );
  if (state.artifactScope !== null) {
    for (const field of ARTIFACT_SCOPE_FIELDS) {
      assertStateField(
        state.artifactScope[field] === undefined
          || state.artifactScope[field] === null
          || typeof state.artifactScope[field] === 'string',
        `artifactScope.${field}`,
      );
    }
  }
  assertStateField(Number.isSafeInteger(state.nextSequence) && state.nextSequence >= 1, 'nextSequence');
  assertStateField(
    typeof state.retained === 'object' && state.retained !== null && !Array.isArray(state.retained),
    'retained',
  );
  assertStateField(Array.isArray(state.pending), 'pending');
  assertStateField(Array.isArray(state.failed), 'failed');
  assertStateField(Array.isArray(state.stranded), 'stranded');
  assertStateField(Array.isArray(state.legacyV2Stranded), 'legacyV2Stranded');
  assertStateField(Array.isArray(state.legacyV3Stranded), 'legacyV3Stranded');
  assertStateField(Array.isArray(state.legacyV4Stranded), 'legacyV4Stranded');
  assertStateField(
    Array.isArray(state.acknowledged)
      && state.acknowledged.every((entry) => (
        isRecord(entry)
        && typeof entry.id === 'string'
        && REPLAY_OPAQUE_ID_PATTERN.test(entry.id)
        && typeof entry.authFingerprint === 'string'
        && entry.authFingerprint.length > 0
        && (
          state.authorityEpoch === null
          || (
            entry.authorityEpoch === state.authorityEpoch
            && entry.authorityKey === state.authorityKey
          )
        )
      ))
      && new Set(state.acknowledged.map((entry) => (
        `${entry.authorityEpoch ?? 'legacy'}\0${entry.authorityKey ?? 'legacy'}\0${entry.authFingerprint}\0${entry.id}`
      ))).size
        === state.acknowledged.length,
    'acknowledged',
  );
  Object.values(state.retained).forEach((record, index) => {
    // Query keys can contain canonicalized user arguments. Diagnostics name
    // only the structural position, never the potentially sensitive key.
    const path = `retained.${index}`;
    assertStateField(isRecord(record), path);
    assertOptionalRecordIdentity(record, path);
    assertStateField(Array.isArray(record.rows), `${path}.rows`);
    if (record.version !== undefined && record.version !== null) {
      assertStateField(
        Number.isSafeInteger(record.version) && record.version >= 0,
        `${path}.version`,
      );
    }
    if (record.cursor !== undefined && record.cursor !== null) {
      assertCursor(record.cursor, `${path}.cursor`);
      if (record.versionStreamId !== undefined && record.versionStreamId !== null) {
        assertStateField(
          typeof record.versionStreamId === 'string'
            && record.versionStreamId.length > 0
            && record.versionStreamId === record.cursor.stream,
          `${path}.versionStreamId`,
        );
      }
      if (record.version !== undefined && record.version !== null) {
        assertStateField(
          record.version === record.cursor.version,
          `${path}.version`,
        );
      }
    }
    assertMatchesCurrentScope(record, path, state);
  });
  const seenIds = new Set();
  const seenSequences = new Set();
  let highestSequence = 0;
  const assertMutationIdentity = (entry, path) => {
    assertStateField(!seenIds.has(entry.id), `${path}.id`);
    assertStateField(!seenSequences.has(entry.sequence), `${path}.sequence`);
    seenIds.add(entry.id);
    seenSequences.add(entry.sequence);
    highestSequence = Math.max(highestSequence, entry.sequence);
  };
  state.pending.forEach((entry, index) => {
    const path = `pending.${index}`;
    assertMutationRecord(entry, path, 'pending');
    assertMatchesCurrentScope(entry, path, state, { queued: true });
    assertMutationIdentity(entry, path);
  });
  state.failed.forEach((entry, index) => {
    const path = `failed.${index}`;
    assertMutationRecord(entry, path, 'failed');
    assertMutationIdentity(entry, path);
  });
  state.stranded.forEach((entry, index) => {
    const path = `stranded.${index}`;
    assertStateField(isRecord(entry), path);
    assertOptionalRecordIdentity(entry, path);
    assertStateField(typeof entry.id === 'string' && entry.id.length > 0, `${path}.id`);
    assertStateField(typeof entry.function === 'string' && entry.function.length > 0, `${path}.function`);
    assertStateField(Number.isSafeInteger(entry.sequence) && entry.sequence >= 1, `${path}.sequence`);
  });
  state.legacyV2Stranded.forEach((entry, index) => {
    const path = `legacyV2Stranded.${index}`;
    assertStateField(isRecord(entry), path);
    assertStateField(typeof entry.id === 'string' && entry.id.length > 0, `${path}.id`);
    assertStateField(typeof entry.function === 'string' && entry.function.length > 0, `${path}.function`);
    assertStateField(Number.isSafeInteger(entry.sequence) && entry.sequence >= 1, `${path}.sequence`);
  });
  state.legacyV3Stranded.forEach((entry, index) => {
    const path = `legacyV3Stranded.${index}`;
    assertStateField(isRecord(entry), path);
    assertStateField(typeof entry.id === 'string' && entry.id.length > 0, `${path}.id`);
    assertStateField(typeof entry.function === 'string' && entry.function.length > 0, `${path}.function`);
    assertStateField(Number.isSafeInteger(entry.sequence) && entry.sequence >= 1, `${path}.sequence`);
  });
  state.legacyV4Stranded.forEach((entry, index) => {
    const path = `legacyV4Stranded.${index}`;
    assertStateField(isRecord(entry), path);
    assertStateField(typeof entry.id === 'string' && entry.id.length > 0, `${path}.id`);
    assertStateField(typeof entry.function === 'string' && entry.function.length > 0, `${path}.function`);
    assertStateField(Number.isSafeInteger(entry.sequence) && entry.sequence >= 1, `${path}.sequence`);
  });
  assertStateField(state.nextSequence > highestSequence, 'nextSequence');
  if (legacyV1) {
    // Fail closed at the v1 authority boundary. Retained rows, queued/failed
    // mutations, ctx ledgers, and settlement ACKs can expose data, replay a
    // write, or delete another authority's result if an FNV collision is
    // treated as identity proof. The server keeps old settlements quarantined
    // and offers the explicit admin purge recovery path.
    state.authFingerprint = null;
    state.artifactScope = null;
    state.retained = {};
    state.pending = [];
    state.failed = [];
    state.acknowledged = [];
    state.stranded = [];
    state.legacyV2Stranded = [];
  }
  if (legacyV3) {
    // Format 3 had no server-issued authority-instance axis. Its queued bytes
    // are inspectable for explicit discard only and can never be replayed.
    state.legacyV3Stranded.push(...[...state.pending, ...state.failed].map((entry) => ({
      ...clone(entry),
      legacyFormat: 3,
      replayable: false,
    })));
    state.retained = {};
    state.pending = [];
    state.failed = [];
    state.acknowledged = [];
    state.principalScope = null;
    state.authorityDescriptor = null;
    state.queryAuthorization = {};
  }
  if (legacyV4 && !legacyV4HadAuthorityDescriptor) {
    // Format 4 was independently occupied by item 6's invalidation queue and
    // item 7's two-axis authority store. The item-6 shape has no server-issued
    // authority instance, so its queued bytes are inspectable/discardable but
    // can never be rebound for replay in the composed format 5 store.
    state.legacyV4Stranded.push(...[...state.pending, ...state.failed].map((entry) => ({
      ...clone(entry),
      legacyFormat: 4,
      legacyShape: legacyV4HadQueueAuthorization ? 'invalidation' : 'unknown',
      replayable: false,
    })));
    state.pending = [];
    state.failed = [];
    state.acknowledged = [];
    state.authorityDescriptor = null;
  }
  return state;
};

// @ref LLP 0012#versioning — retained versions are meaningful only inside
//   the full app/database/target stream identity; never compare a bare number.
const recordMatchesArtifacts = (record, expected = {}) => (
  (expected.authorityEpoch === undefined || expected.authorityEpoch === null
    || record.authorityEpoch === expected.authorityEpoch)
  && (!expected.authorityKey || record.authorityKey === expected.authorityKey)
  && (!expected.authFingerprint || record.authFingerprint === expected.authFingerprint)
  && (!expected.schemaHash || record.schemaHash === expected.schemaHash)
  && (!expected.inputsHash || record.inputsHash === expected.inputsHash)
  && (!expected.targetProfileId || record.targetProfileId === expected.targetProfileId)
  && (!expected.appId || record.appId === expected.appId)
  && (!expected.databaseId || record.databaseId === expected.databaseId)
  && (!expected.versionStreamId || record.versionStreamId === expected.versionStreamId)
  && (!expected.versionStreamId || record.cursor?.stream === expected.versionStreamId)
);

const recordMatchesCurrentRetainedScope = (state, record) => recordMatchesArtifacts(record, {
  ...(state.principalScope === null ? { authFingerprint: state.authFingerprint } : {}),
  ...(state.artifactScope ?? {}),
}) && (
  state.principalScope === null
  || stableJson(record.principalScope) === stableJson(state.principalScope)
);

const recordMatchesCurrentQueueScope = (state, record) => recordMatchesArtifacts(record, {
  ...(state.authorityDescriptor === null
    ? {
        authorityEpoch: state.authorityEpoch,
        authorityKey: state.authorityKey,
        authFingerprint: state.authFingerprint,
      }
    : {}),
  ...(state.artifactScope ?? {}),
}) && (
  state.authorityDescriptor === null
  || record.authorityDescriptor?.authorityInstanceId
    === state.authorityDescriptor.authorityInstanceId
);

const artifactExpectation = ({
  schemaHash = null,
  inputsHash = null,
  targetProfileId = null,
  appId = null,
  databaseId = null,
  versionStreamId = null,
} = {}) => ({
  schemaHash,
  inputsHash,
  targetProfileId,
  appId,
  databaseId,
  versionStreamId,
});

const recordMatchesExpectedRetainedScope = (state, record, expected = {}) => (
  recordMatchesArtifacts(record, {
    ...artifactExpectation(expected),
    ...(state.principalScope === null
      ? {
          authorityEpoch: expected.authorityEpoch,
          authorityKey: expected.authorityKey,
          authFingerprint: expected.authFingerprint,
        }
      : {}),
  })
  && (
    state.principalScope === null
    || stableJson(record.principalScope) === stableJson(state.principalScope)
  )
);

const recordMatchesExpectedQueueScope = (state, record, expected = {}) => (
  recordMatchesArtifacts(record, {
    ...artifactExpectation(expected),
    ...(state.authorityDescriptor === null
      ? {
          authorityEpoch: expected.authorityEpoch,
          authorityKey: expected.authorityKey,
          authFingerprint: expected.authFingerprint,
        }
      : {}),
  })
  && (
    state.authorityDescriptor === null
    || record.authorityDescriptor?.authorityInstanceId
      === state.authorityDescriptor.authorityInstanceId
  )
);

function staleStoreScopeError(operation) {
  const error = new Error(`${operation} belongs to a stale client-store auth/artifact stream scope`);
  error.code = 'SNAPBACK_CLIENT_STORE_SCOPE_STALE';
  return error;
}

function staleStoreAuthorityError(operation) {
  return clientStoreStateError(
    'SNAPBACK_CLIENT_STORE_AUTHORITY_STALE',
    `${operation} belongs to a stale client authority epoch`,
    { operation },
  );
}

function expectedAuthorityMatchesState(state, expected = {}) {
  if (state.authorityEpoch === null) {
    return expected.authorityEpoch === undefined || expected.authorityEpoch === null;
  }
  return expected.authorityEpoch === state.authorityEpoch
    && expected.authorityKey === state.authorityKey;
}

function assertExpectedAuthority(state, expected, operation) {
  if (!expectedAuthorityMatchesState(state, expected)) {
    throw staleStoreAuthorityError(operation);
  }
}

function recordAuthority(state) {
  return state.authorityEpoch === null
    ? {}
    : { authorityEpoch: state.authorityEpoch, authorityKey: state.authorityKey };
}

function staleMutationQueueError(operation) {
  return clientStoreStateError(
    'SNAPBACK_CLIENT_QUEUE_GENERATION_STALE',
    `${operation} captured a stale mutation-queue generation`,
    { operation },
  );
}

function suspendedMutationQueueError(operation, state) {
  return clientStoreStateError(
    'SNAPBACK_CLIENT_QUEUE_SUSPENDED',
    `authorization invalidation suspended ${operation}`,
    {
      operation,
      pendingScopeCount: Object.keys(state.queueAuthorization.pendingByScope).length,
      effectiveDisposition: effectiveDisposition(state.queueAuthorization.pendingByScope),
    },
  );
}

function queueCapture(state) {
  return {
    authorityGeneration: state.queueAuthorization.authorityGeneration,
    queueGeneration: state.queueAuthorization.queueGeneration,
  };
}

function expectedQueueMatchesState(state, expected = {}) {
  const hasAuthority = Object.hasOwn(expected, 'authorityGeneration');
  const hasQueue = Object.hasOwn(expected, 'queueGeneration');
  if (state.authorityEpoch === null && !hasAuthority && !hasQueue) return true;
  return hasAuthority
    && hasQueue
    && expected.authorityGeneration === state.queueAuthorization.authorityGeneration
    && expected.queueGeneration === state.queueAuthorization.queueGeneration;
}

function assertExpectedQueue(state, expected, operation) {
  if (!expectedQueueMatchesState(state, expected)) {
    throw staleMutationQueueError(operation);
  }
}

function assertQueueRunnable(state, operation) {
  if (Object.keys(state.queueAuthorization.pendingByScope).length > 0) {
    throw suspendedMutationQueueError(operation, state);
  }
}

function advanceQueueGeneration(state, authorityGeneration = null) {
  state.queueAuthorization.queueGeneration = nextInvalidationGeneration(
    state.queueAuthorization.queueGeneration,
    'queueGeneration',
  );
  if (authorityGeneration !== null) {
    state.queueAuthorization.authorityGeneration = authorityGeneration;
  }
}

function redactedStrandedMutation(entry, state, reason, disposition) {
  return {
    id: entry.id,
    function: entry.function,
    sequence: entry.sequence,
    authorityEpoch: entry.authorityEpoch ?? state.authorityEpoch,
    authorityKey: entry.authorityKey ?? state.authorityKey,
    strandedAtEpoch: state.queueAuthorization.authorityGeneration,
    strandedAtQueueGeneration: state.queueAuthorization.queueGeneration,
    disposition,
    reason,
    replayable: false,
    discardOnly: true,
  };
}

function strandCurrentQueue(state, reason, disposition = 'delete') {
  state.stranded.push(...[...state.pending, ...state.failed].map((entry) => (
    redactedStrandedMutation(entry, state, reason, disposition)
  )));
  state.pending = [];
  state.failed = [];
}

function expectationForObligation(obligation) {
  return {
    authorization: obligation.witness.authorization,
    versionStream: obligation.witness.data?.versionStream ?? null,
    issuerId: obligation.scopeId.kind === 'clientQuery'
      ? null
      : obligation.scopeId.issuerId,
  };
}

function createStore({ read, write, withExclusive = (operation) => operation() }) {
  const load = () => normalizeState(read());
  const save = (state) => {
    // Validate a detached candidate before replacing durable bytes. Besides
    // preserving corrupt/future input, this keeps failed writes from
    // poisoning the in-memory reference adapter.
    const next = clone(state);
    if (next.generation === Number.MAX_SAFE_INTEGER) {
      throw clientStoreStateError(
        'SNAPBACK_CLIENT_STORE_GENERATION_EXHAUSTED',
        'client-store write generation is exhausted and the store must be replaced',
      );
    }
    next.generation += 1;
    normalizeState(next);
    write(next);
    return next;
  };
  const transact = (operation) => withExclusive(() => operation(load(), save));
  return {
    version: SNAPBACK_CLIENT_STORE_VERSION,

    // @ref LLP 0056#format-3-and-authority-tags — the coordinator epoch/key
    //   owns the expected-authority CAS around store mutations.
    async bindAuthority({ authorityEpoch, authorityKey, authMode = 'sessions' }) {
      if (!Number.isSafeInteger(authorityEpoch) || authorityEpoch < 0) {
        throw new TypeError('bindAuthority requires a safe nonnegative authorityEpoch');
      }
      if (typeof authorityKey !== 'string' || !AUTHORITY_KEY_PATTERN.test(authorityKey)) {
        throw new TypeError('bindAuthority requires a canonical authorityKey');
      }
      if (authMode !== 'dev' && authMode !== 'sessions') {
        throw new TypeError('bindAuthority authMode must be dev or sessions');
      }
      return transact((state, commit) => {
        if (state.authorityEpoch !== null) {
          if (state.authorityEpoch === authorityEpoch && state.authorityKey === authorityKey) {
            return clone({ authorityEpoch, authorityKey });
          }
          throw staleStoreAuthorityError('authority bind');
        }

        // A v2 fingerprint was client input, not server provenance. Preserve
        // only records whose v2 shape is explicitly unscoped, and only in the
        // non-replayable legacy namespace; sessions-mode binding deletes every
        // fingerprint-bearing payload rather than retagging it as current.
        const legacyQueue = [...state.pending, ...state.failed]
          .filter((entry) => entry.authFingerprint === undefined || entry.authFingerprint === null)
          .map((entry) => ({ ...clone(entry), legacyFormat: 2, replayable: false }));
        state.legacyV2Stranded.push(...legacyQueue);
        state.retained = {};
        state.pending = [];
        state.failed = [];
        state.acknowledged = [];
        state.authFingerprint = null;
        state.authorityEpoch = authorityEpoch;
        state.authorityKey = authorityKey;
        state.queueAuthorization.pendingByScope = {};
        advanceQueueGeneration(state, authorityEpoch);
        commit(state);
        return clone({ authorityEpoch, authorityKey });
      });
    },

    async transitionAuthority({
      expectedEpoch,
      nextEpoch,
      nextAuthorityKey,
      disposition = 'delete',
      strandQueued = false,
      nextPrincipalScope = null,
    }) {
      if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0) {
        throw new TypeError('transitionAuthority requires a safe expectedEpoch');
      }
      if (!Number.isSafeInteger(nextEpoch) || nextEpoch !== expectedEpoch + 1) {
        throw new TypeError('transitionAuthority must advance authority epoch exactly once');
      }
      if (typeof nextAuthorityKey !== 'string' || !AUTHORITY_KEY_PATTERN.test(nextAuthorityKey)) {
        throw new TypeError('transitionAuthority requires a canonical nextAuthorityKey');
      }
      if (disposition !== 'delete') {
        throw clientStoreStateError(
          'SNAPBACK_AUTH_DISPOSITION_UNSUPPORTED',
          'item-5 client storage executes only delete disposition',
          { disposition },
        );
      }
      if (nextPrincipalScope !== null) {
        assertPrincipalScope(nextPrincipalScope, 'nextPrincipalScope');
      }
      return transact((state, commit) => {
        if (state.authorityEpoch === nextEpoch && state.authorityKey === nextAuthorityKey) {
          return clone({ authorityEpoch: nextEpoch, authorityKey: nextAuthorityKey });
        }
        if (state.authorityEpoch !== expectedEpoch) {
          throw staleStoreAuthorityError('authority transition');
        }
        advanceQueueGeneration(state, nextEpoch);
        state.queueAuthorization.pendingByScope = {};
        if (strandQueued) {
          strandCurrentQueue(state, 'authority_instance_changed', disposition);
        }
        const samePrincipal = state.principalScope !== null
          && nextPrincipalScope !== null
          && stableJson(state.principalScope) === stableJson(nextPrincipalScope);
        if (!samePrincipal) state.retained = {};
        state.pending = [];
        state.failed = [];
        state.acknowledged = [];
        if (!samePrincipal) state.authFingerprint = null;
        state.principalScope = clone(nextPrincipalScope);
        state.authorityDescriptor = null;
        state.authorityEpoch = nextEpoch;
        state.authorityKey = nextAuthorityKey;
        commit(state);
        return clone({ authorityEpoch: nextEpoch, authorityKey: nextAuthorityKey });
      });
    },

    async authorityScope() {
      return transact((state) => clone({
        authorityEpoch: state.authorityEpoch,
        authorityKey: state.authorityKey,
      }));
    },

    // @ref LLP 0053#dispositions-with-producers-and-meanings — pending
    //   mutations use a queue generation independent of every query fence.
    //   A caller must capture this tuple before every queue act.
    async captureMutationQueue(expected = {}) {
      return transact((state) => {
        assertExpectedAuthority(state, expected, 'mutation queue capture');
        const pendingScopeCount = Object.keys(
          state.queueAuthorization.pendingByScope,
        ).length;
        return clone({
          ...queueCapture(state),
          suspended: pendingScopeCount > 0,
          pendingScopeCount,
          effectiveDisposition: effectiveDisposition(
            state.queueAuthorization.pendingByScope,
          ),
        });
      });
    },

    async assertMutationQueueCapture(capture, expected = {}) {
      return transact((state) => {
        assertExpectedAuthority(state, expected, 'mutation queue preflight');
        assertExpectedQueue(state, capture, 'mutation queue preflight');
        assertQueueRunnable(state, 'mutation queue execution');
        return clone(queueCapture(state));
      });
    },

    async applyMutationQueueObligation(obligationValue, expected = {}) {
      const obligation = validateResyncObligation(obligationValue);
      if (obligation.scopeId.kind === 'connection') {
        throw clientStoreStateError(
          'SNAPBACK_CLIENT_QUEUE_SCOPE_UNSUPPORTED',
          'a connection projection root must be expanded into query-sized children',
        );
      }
      if (obligation.maxDisposition === 'retain') {
        throw clientStoreStateError(
          'SNAPBACK_CLIENT_QUEUE_ROOT_UNNECESSARY',
          'retain does not create a mutation-queue suspension root',
        );
      }
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'mutation queue obligation');
        assertExpectedQueue(state, expected, 'mutation queue obligation');
        const key = scopeKey(obligation.scopeId);
        const merged = mergeResyncObligation(
          state.queueAuthorization.pendingByScope[key] ?? null,
          obligation,
          expectationForObligation(obligation),
        );
        if (merged.status !== 'accepted') {
          return clone({
            status: merged.status,
            ...queueCapture(state),
            suspended: true,
            pendingScopeCount: Object.keys(
              state.queueAuthorization.pendingByScope,
            ).length,
          });
        }

        state.queueAuthorization.pendingByScope[key] = clone(merged.obligation);
        advanceQueueGeneration(state);
        if (merged.obligation.maxDisposition === 'delete') {
          strandCurrentQueue(state, 'authorization_invalidation', 'delete');
        }
        commit(state);
        return clone({
          status: 'accepted',
          ...queueCapture(state),
          suspended: true,
          pendingScopeCount: Object.keys(
            state.queueAuthorization.pendingByScope,
          ).length,
          effectiveDisposition: effectiveDisposition(
            state.queueAuthorization.pendingByScope,
          ),
        });
      });
    },

    // @ref LLP 0043#auth-posture — principal/data and authority-instance/queue
    //   are independent axes in the composed format-5 store.
    /// Install the two independent format-5 axes from one authenticated
    /// handshake. Principal identity owns retained rows; the opaque authority
    /// instance owns queued mutations. `queryAuthorization` is reserved and
    /// deliberately empty until item 8 supplies lease semantics.
    async scopeAuthorization({
      principalScope,
      authorityDescriptor,
      queryAuthorization = {},
    }, expected = {}) {
      assertPrincipalScope(principalScope, 'principalScope');
      assertAuthorityDescriptor(authorityDescriptor, 'authorityDescriptor');
      if (!isRecord(queryAuthorization) || Object.keys(queryAuthorization).length !== 0) {
        throw new TypeError('queryAuthorization is reserved and must be an empty object');
      }
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'authorization scope change');
        const principalChanged = state.principalScope !== null
          && stableJson(state.principalScope) !== stableJson(principalScope);
        const unknownPrincipal = state.principalScope === null
          && Object.keys(state.retained).length > 0;
        if (principalChanged || unknownPrincipal) state.retained = {};

        const authorityChanged = state.authorityDescriptor !== null
          && state.authorityDescriptor.authorityInstanceId
            !== authorityDescriptor.authorityInstanceId;
        const unknownAuthority = state.authorityDescriptor === null
          && (state.pending.length > 0 || state.failed.length > 0);
        if (authorityChanged || unknownAuthority) {
          state.stranded.push(...[...state.pending, ...state.failed].map((entry) => ({
            ...clone(entry),
            replayable: false,
            reason: authorityChanged ? 'authority_instance_changed' : 'authority_unknown',
          })));
          state.pending = [];
          state.failed = [];
          state.acknowledged = [];
        }
        state.principalScope = clone(principalScope);
        state.authorityDescriptor = clone(authorityDescriptor);
        state.queryAuthorization = {};
        commit(state);
        return clone({
          principalScope: state.principalScope,
          authorityDescriptor: state.authorityDescriptor,
          queryAuthorization: state.queryAuthorization,
        });
      });
    },

    async resolveMutationQueueObligation(resolutionValue, expected = {}) {
      const resolution = validateResolutionTicket(resolutionValue);
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'mutation queue resolution');
        assertExpectedQueue(state, expected, 'mutation queue resolution');
        const key = scopeKey(resolution.scopeId);
        const obligation = state.queueAuthorization.pendingByScope[key];
        if (!obligation || !resolutionSatisfies(obligation, resolution)) {
          throw clientStoreStateError(
            'SNAPBACK_CLIENT_QUEUE_RESOLUTION_STALE',
            'resolution does not satisfy the current exact mutation-queue root',
          );
        }
        delete state.queueAuthorization.pendingByScope[key];
        advanceQueueGeneration(state);
        if (resolution.kind === 'terminalDelete' || resolution.maxDisposition === 'delete') {
          strandCurrentQueue(state, 'authorization_denied', 'delete');
        }
        commit(state);
        const pendingScopeCount = Object.keys(
          state.queueAuthorization.pendingByScope,
        ).length;
        return clone({
          ackToken: resolution.ackToken,
          ...queueCapture(state),
          suspended: pendingScopeCount > 0,
          pendingScopeCount,
          effectiveDisposition: effectiveDisposition(
            state.queueAuthorization.pendingByScope,
          ),
        });
      });
    },

    // Authenticated scope/issuer retirement is validated by the live-query
    // coordinator together with its covering snapshot. This store transition
    // consumes only the exact scopes that coordinator proved extinct; it is
    // cleanup, never an ACK or a release proof by itself.
    async retireMutationQueueScopes(scopeValues, expected = {}) {
      if (!Array.isArray(scopeValues)) {
        throw new TypeError('retireMutationQueueScopes requires an array of exact scope ids');
      }
      const keys = new Set(scopeValues.map((value) => {
        if (value?.kind === 'connection') {
          throw clientStoreStateError(
            'SNAPBACK_CLIENT_QUEUE_SCOPE_UNSUPPORTED',
            'a connection projection root must be expanded into query-sized children',
          );
        }
        return scopeKey(value);
      }));
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'mutation queue scope retirement');
        assertExpectedQueue(state, expected, 'mutation queue scope retirement');
        let retired = 0;
        for (const key of keys) {
          if (!Object.hasOwn(state.queueAuthorization.pendingByScope, key)) continue;
          delete state.queueAuthorization.pendingByScope[key];
          retired += 1;
        }
        if (retired > 0) {
          advanceQueueGeneration(state);
          commit(state);
        }
        const pendingScopeCount = Object.keys(
          state.queueAuthorization.pendingByScope,
        ).length;
        return clone({
          retired,
          ...queueCapture(state),
          suspended: pendingScopeCount > 0,
          pendingScopeCount,
          effectiveDisposition: effectiveDisposition(
            state.queueAuthorization.pendingByScope,
          ),
        });
      });
    },

    async authorizationScope(expected = {}) {
      return transact((state) => {
        assertExpectedAuthority(state, expected, 'authorization scope read');
        return clone({
          principalScope: state.principalScope,
          authorityDescriptor: state.authorityDescriptor,
          queryAuthorization: state.queryAuthorization,
        });
      });
    },

    async strandedMutations(expected = {}) {
      return transact((state) => {
        assertExpectedAuthority(state, expected, 'stranded mutation read');
        return clone(state.stranded);
      });
    },

    async discardStranded(expected = {}) {
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'stranded mutation discard');
        assertExpectedQueue(state, expected, 'stranded mutation discard');
        state.stranded = [];
        commit(state);
      });
    },

    async scopeToAuth(authFingerprint, expected = {}) {
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'auth scope change');
        const modernAxesBound = state.principalScope !== null
          || state.authorityDescriptor !== null;
        const changed = state.authFingerprint !== null
          && state.authFingerprint !== authFingerprint;
        const unknownLegacyState = state.authFingerprint === null
          && authFingerprint !== null
          && (
            state.pending.length > 0
            || state.failed.length > 0
            || Object.keys(state.retained).length > 0
          );
        if (!modernAxesBound && (changed || unknownLegacyState)) {
          // LLP 0043/0039: a user switch wipes retained rows and queued writes
          // before the new authority can observe or replay them. Establishing
          // the first known authority is also a boundary for unscoped legacy
          // records; they cannot be attributed after the fact.
          state.retained = {};
          advanceQueueGeneration(state);
          state.pending = [];
          state.failed = [];
          // Acknowledgements are opaque settlement ids, not retained app
          // data. Keep them auth-tagged across a user switch so returning to
          // the old authority can finish authenticated GC without exposing a
          // result or sending the ids under the new authority.
        }
        state.authFingerprint = authFingerprint;
        commit(state);
      });
    },

    async scopeToArtifacts({
      schemaHash = null,
      inputsHash = null,
      targetProfileId = null,
      appId = null,
      databaseId = null,
      versionStreamId = null,
    } = {}, expected = {}) {
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'artifact scope change');
        const nextScope = {
          schemaHash,
          inputsHash,
          targetProfileId,
          appId,
          databaseId,
          versionStreamId,
        };
        const changed = state.artifactScope !== null
          && stableJson(state.artifactScope) !== stableJson(nextScope);
        const unknownLegacyState = state.artifactScope === null
          && (
            state.pending.length > 0
            || state.failed.length > 0
            || Object.keys(state.retained).length > 0
          );
        if (changed || unknownLegacyState) {
          state.retained = {};
          // Failed records can contain the original args. An artifact boundary
          // is also a privacy boundary: discard old failures, then retain only
          // redacted tombstones for writes this transition quarantines.
          state.failed = [];
          advanceQueueGeneration(state);
          for (const entry of state.pending) {
            state.failed.push({
              id: entry.id,
              function: entry.function,
              sequence: entry.sequence,
              authFingerprint: entry.authFingerprint,
              ...recordAuthority(state),
              schemaHash: entry.schemaHash,
              inputsHash: entry.inputsHash,
              status: 'failed',
              diagnostic: {
                code: 'SNAPBACK_CLIENT_ARTIFACT_STALE',
                message: 'queued mutation belongs to another schema/artifact revision',
                previous: state.artifactScope,
                current: nextScope,
              },
            });
          }
          state.pending = [];
          // Artifact replacement does not change authority and must not strand
          // already-consumed server settlements. Keep the auth-tagged ACKs.
        }
        state.artifactScope = nextScope;
        commit(state);
      });
    },

    async getRetainedQuery(key, expected = {}) {
      return transact((state) => {
        if (!expectedAuthorityMatchesState(state, expected)) return null;
        const record = state.retained[key];
        if (!record || !recordMatchesExpectedRetainedScope(state, record, expected)) return null;
        return clone({ ...record, stale: true });
      });
    },

    async putRetainedQuery(key, record) {
      return transact((state, commit) => {
        assertExpectedAuthority(state, record, 'retained query write');
        const scopedRecord = state.principalScope === null
          ? record
          : { ...record, principalScope: clone(state.principalScope) };
        if (!recordMatchesCurrentRetainedScope(state, scopedRecord)) {
          throw staleStoreScopeError('retained query write');
        }
        const current = state.retained[key];
        if (
          current
          && current.versionStreamId === scopedRecord.versionStreamId
          && current.cursor?.stream === scopedRecord.cursor?.stream
          && Number.isFinite(current.version)
          && Number.isFinite(scopedRecord.version)
          && current.version > scopedRecord.version
        ) {
          return clone(current);
        }
        state.retained[key] = clone({ ...scopedRecord, stale: false });
        commit(state);
        return clone(state.retained[key]);
      });
    },

    async enqueueMutation(record) {
      return transact((state, commit) => {
        assertExpectedAuthority(state, record, 'queued mutation write');
        assertExpectedQueue(state, record, 'queued mutation write');
        assertQueueRunnable(state, 'mutation enqueue');
        if (state.authorityDescriptor !== null) {
          if (record.authorityDescriptor === undefined) {
            throw clientStoreStateError(
              'SNAPBACK_AUTHORITY_DESCRIPTOR_REQUIRED',
              'queued mutation must capture the current authority descriptor',
            );
          }
          assertAuthorityDescriptor(record.authorityDescriptor, 'record.authorityDescriptor');
        }
        if (!recordMatchesCurrentQueueScope(state, record)) {
          throw staleStoreScopeError('queued mutation write');
        }
        let sequence = Number.isSafeInteger(record.sequence)
          ? record.sequence
          : state.nextSequence;
        let id = record.id;
        if (id !== undefined && id !== null) {
          const existing = state.pending.find((entry) => entry.id === id);
          if (existing) return clone(existing);
        } else {
          const occupiedIds = new Set(
            [...state.pending, ...state.failed].map((entry) => entry.id),
          );
          id = `cm_${state.origin}_${sequence}`;
          while (occupiedIds.has(id)) {
            if (sequence >= Number.MAX_SAFE_INTEGER - 1) {
              throw clientStoreStateError(
                'SNAPBACK_CLIENT_STORE_SEQUENCE_EXHAUSTED',
                'client-store mutation sequence space is exhausted',
              );
            }
            sequence += 1;
            id = `cm_${state.origin}_${sequence}`;
          }
        }
        if (!Number.isSafeInteger(sequence) || sequence >= Number.MAX_SAFE_INTEGER) {
          throw clientStoreStateError(
            'SNAPBACK_CLIENT_STORE_SEQUENCE_EXHAUSTED',
            'client-store mutation sequence space is exhausted',
          );
        }
        state.nextSequence = Math.max(state.nextSequence, sequence + 1);
        const capturedRecord = clone(record);
        delete capturedRecord.suspended;
        delete capturedRecord.pendingScopeCount;
        delete capturedRecord.effectiveDisposition;
        const queued = clone({ ...capturedRecord, id, sequence, status: 'pending' });
        state.pending.push(queued);
        state.pending.sort((left, right) => left.sequence - right.sequence);
        commit(state);
        return clone(queued);
      });
    },

    async pendingMutations(options = {}) {
      const {
      authorityEpoch = null,
      authorityKey = null,
      authFingerprint = null,
      schemaHash = null,
      inputsHash = null,
      targetProfileId = null,
      appId = null,
      databaseId = null,
      versionStreamId = null,
      } = options;
      return transact((state) => {
        const expected = { authorityEpoch, authorityKey };
        if (!expectedAuthorityMatchesState(state, expected)) return [];
        assertExpectedQueue(state, options, 'mutation replay');
        assertQueueRunnable(state, 'mutation replay');
        return clone(state.pending
        .filter((entry) => recordMatchesExpectedQueueScope(state, entry, {
          authorityEpoch,
          authorityKey,
          authFingerprint,
          schemaHash,
          inputsHash,
          targetProfileId,
          appId,
          databaseId,
          versionStreamId,
        }))
        .sort((left, right) => left.sequence - right.sequence));
      });
    },

    async settleMutation(id, options = {}) {
      const {
        status,
        output = null,
        diagnostic = null,
        authorityEpoch = null,
        authorityKey = null,
      } = options;
      return transact((state, commit) => {
        assertExpectedAuthority(state, { authorityEpoch, authorityKey }, 'mutation settlement');
        assertExpectedQueue(state, options, 'mutation settlement');
        assertQueueRunnable(state, 'mutation settlement');
        const index = state.pending.findIndex((entry) => entry.id === id);
        if (index < 0) return null;
        const [entry] = state.pending.splice(index, 1);
        if (!recordMatchesExpectedQueueScope(state, entry, { authorityEpoch, authorityKey })) {
          throw staleStoreAuthorityError('mutation settlement');
        }
        const settled = clone({ ...entry, status, output, diagnostic });
        if (status === 'failed') state.failed.push(settled);
        if (
          status === 'confirmed'
          && entry.authFingerprint
          && !state.acknowledged.some((entry) => (
            entry.id === id && entry.authFingerprint === settled.authFingerprint
          ))
        ) {
          state.acknowledged.push({
            id,
            authFingerprint: entry.authFingerprint,
            ...recordAuthority(state),
          });
        }
        commit(state);
        return settled;
      });
    },

    async pendingMutationAcknowledgements(
      limit = MAX_OFFLINE_LEDGER_IDS,
      authFingerprint = null,
      expected = {},
    ) {
      return transact((state) => {
        if (!expectedAuthorityMatchesState(state, expected)) return [];
        return clone(state.acknowledged
        .filter((entry) => recordMatchesArtifacts(entry, expected))
        .filter((entry) => entry.authFingerprint === (authFingerprint ?? state.authFingerprint))
        .slice(0, limit)
        .map((entry) => entry.id));
      });
    },

    async confirmMutationAcknowledgements(ids, authFingerprint = null, expected = {}) {
      const confirmed = new Set(ids);
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'mutation acknowledgement confirmation');
        const expectedAuth = authFingerprint ?? state.authFingerprint;
        state.acknowledged = state.acknowledged.filter((entry) => (
          !recordMatchesArtifacts(entry, expected)
          || entry.authFingerprint !== expectedAuth
          || !confirmed.has(entry.id)
        ));
        commit(state);
      });
    },

    async failedMutations(expected = {}) {
      return transact((state) => {
        if (!expectedAuthorityMatchesState(state, expected)) return [];
        assertExpectedQueue(state, expected, 'failed mutation read');
        assertQueueRunnable(state, 'failed mutation read');
        return clone(state.failed.filter((entry) => (
          recordMatchesExpectedQueueScope(state, entry, expected)
        )));
      });
    },

    async snapshot() {
      return transact((state) => clone(state));
    },

    async clear() {
      // Explicit reset is the sole operation allowed to replace bytes that
      // the current implementation cannot parse or migrate.
      return withExclusive(() => save(freshState()));
    },
  };
}

/**
 * Deterministic reference for tests. Pass the same `state` object to a new
 * store to model an app reload without sharing a live adapter instance.
 */
export function createMemorySnapbackClientStore({ state = freshState() } = {}) {
  if (
    state
    && typeof state === 'object'
    && !Array.isArray(state)
    && Object.keys(state).length === 0
  ) {
    Object.assign(state, freshState());
  }
  let current = normalizeState(state);
  return createStore({
    // Match localStorage's parse-on-read isolation: a failed transaction may
    // never mutate the caller-owned durable state before validation/commit.
    read: () => clone(current),
    write: (next) => {
      current = next;
      // Preserve caller identity so a second store constructed with the same
      // state object observes commits (reload proof).
      if (state !== next) {
        for (const key of Object.keys(state)) delete state[key];
        Object.assign(state, clone(next));
        current = state;
      }
    },
  });
}

/** Web implementation; callers may inject Storage/Web-Locks-compatible test doubles. */
export function createLocalStorageSnapbackClientStore({
  storage = globalThis.localStorage,
  key = 'snapback.client-store.v1',
  lockManager = globalThis.navigator?.locks,
} = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new Error('createLocalStorageSnapbackClientStore requires a Storage-compatible object.');
  }
  if (!lockManager || typeof lockManager.request !== 'function') {
    throw clientStoreStateError(
      'SNAPBACK_CLIENT_STORE_LOCK_UNAVAILABLE',
      'the localStorage client store requires the Web Locks API for cross-context serialization',
      { key },
    );
  }
  const lockName = `snapback:client-store:${key}`;
  return createStore({
    read: () => {
      const raw = storage.getItem(key);
      if (raw === null) return freshState();
      try {
        return JSON.parse(raw);
      } catch {
        throw clientStoreStateError(
          'SNAPBACK_CLIENT_STORE_CORRUPT',
          'persisted client-store bytes are not valid JSON; original bytes were left untouched',
          { key, byteLength: new TextEncoder().encode(raw).length },
        );
      }
    },
    write: (state) => storage.setItem(key, JSON.stringify(state)),
    // @ref LLP 0008#local-store — all web durable-store access is serialized
    //   through a same-origin correctness mutex; Web Locks release on context
    //   loss, so another tab can take over without a timing-based lease.
    withExclusive: (operation) => lockManager.request(
      lockName,
      { mode: 'exclusive' },
      operation,
    ),
  });
}

/** Register one physical client store as the coordinator's durable participant. */
export function createSnapbackClientStoreAuthParticipant(store, {
  name = 'snapback-client-store',
  strandQueued = () => false,
} = {}) {
  if (!store || typeof store.transitionAuthority !== 'function') {
    throw new TypeError('client-store auth participant requires a format-5 store');
  }
  return Object.freeze({
    name,
    async quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable(context) {
      await store.transitionAuthority({
        expectedEpoch: context.expectedEpoch,
        nextEpoch: context.nextEpoch,
        nextAuthorityKey: context.nextAuthorityKey,
        disposition: context.disposition,
        strandQueued: strandQueued(context) === true,
        nextPrincipalScope: context.nextAuthority
          ? {
              authMode: context.nextAuthority.authMode,
              authorizationStreamIncarnation:
                context.nextAuthority.authorizationStreamIncarnation,
              userId: context.nextAuthority.kind === 'session'
                ? context.nextAuthority.userId
                : null,
            }
          : null,
      });
    },
    async resume() {},
  });
}

export function createClientMutationId(prefix = 'cm') {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? newOrigin();
  return `${prefix}_${random}`;
}
