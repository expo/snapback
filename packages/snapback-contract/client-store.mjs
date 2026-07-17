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
  nextQueryInstanceId,
  resolutionSatisfies,
  scopeKey,
  validateAuthorizationVersion,
  validateCompositeWitness,
  validateIssuerId,
  validateScopeId,
  validateResolutionTicket,
  validateResyncObligation,
} from './auth-invalidation.mjs';
import {
  authorizedLeaseHash,
  deriveAuthorizedLeaseCommit,
  validateAuthorizedLease,
} from './authorized-lease.mjs';

export const SNAPBACK_CLIENT_STORE_VERSION = 6;
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
const ACTIVATION_HASH_PATTERN = /^snapback\.authorized-lease\.activation\.v1:sha256:[0-9a-f]{64}$/;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECORD_IDENTITY_FIELDS = ['authFingerprint', 'authorityKey', ...ARTIFACT_SCOPE_FIELDS];

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const utf8Length = (value) => new TextEncoder().encode(value).length;

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
  terminallyUnbound: false,
  queueAuthorization: {
    authorityGeneration: 0,
    queueGeneration: 0,
    pendingByScope: {},
  },
  principalScope: null,
  authorityDescriptor: null,
  queryInstanceHighWater: 0,
  leaseClockHighWaterMs: 0,
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
const ownEntry = (record, key) => Object.hasOwn(record, key) ? record[key] : undefined;
const setOwnEntry = (record, key, value) => Object.defineProperty(record, key, {
  value,
  enumerable: true,
  configurable: true,
  writable: true,
});

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

const QUERY_DISPOSITIONS = new Set(['retain', 'quarantine', 'delete']);
const QUERY_DISPOSITION_ORDER = Object.freeze({ retain: 0, quarantine: 1, delete: 2 });

function assertLeaseRequest(request, path) {
  assertStateField(isRecord(request), path);
  assertStateField(
    Object.keys(request).sort().join(',')
      === 'leaseRequestId,queryGeneration,queryInstanceId,startedClientMs',
    path,
  );
  assertStateField(
    typeof request.leaseRequestId === 'string'
      && REPLAY_OPAQUE_ID_PATTERN.test(request.leaseRequestId),
    `${path}.leaseRequestId`,
  );
  for (const field of ['queryInstanceId', 'queryGeneration', 'startedClientMs']) {
    assertStateField(
      Number.isSafeInteger(request[field]) && request[field] >= (field === 'queryInstanceId' ? 1 : 0),
      `${path}.${field}`,
    );
  }
}

function assertQueryAuthorizationState(query, path, state, queryKey) {
  assertStateField(isRecord(query), path);
  assertStateField(
    Object.keys(query).sort().join(',') === [
      'accepted',
      'authorityGeneration',
      'authorityInstanceId',
      'clientDeadlineMs',
      'effectiveDisposition',
      'expectedActivationHash',
      'expectedAppId',
      'expectedAuthorization',
      'expectedIssuerId',
      'expectedTargetProfileId',
      'expectedVersionStream',
      'lease',
      'leaseRequest',
      'lifecycle',
      'pendingByScope',
      'principalId',
      'queryGeneration',
      'queryInstanceId',
      'scopeRevisionHighWater',
    ].sort().join(','),
    path,
  );
  assertStateField(
    Number.isSafeInteger(query.queryInstanceId)
      && query.queryInstanceId >= 1
      && query.queryInstanceId <= state.queryInstanceHighWater,
    `${path}.queryInstanceId`,
  );
  assertStateField(
    Number.isSafeInteger(query.authorityGeneration) && query.authorityGeneration >= 0,
    `${path}.authorityGeneration`,
  );
  assertStateField(
    Number.isSafeInteger(query.queryGeneration) && query.queryGeneration >= 0,
    `${path}.queryGeneration`,
  );
  assertStateField(query.lifecycle === 'active' || query.lifecycle === 'retiring', `${path}.lifecycle`);
  assertStateField(QUERY_DISPOSITIONS.has(query.effectiveDisposition), `${path}.effectiveDisposition`);
  assertStateField(
    typeof query.principalId === 'string' && REPLAY_OPAQUE_ID_PATTERN.test(query.principalId),
    `${path}.principalId`,
  );
  try {
    validateAuthorizationVersion(query.expectedAuthorization, `${path}.expectedAuthorization`);
    validateIssuerId(query.expectedIssuerId, `${path}.expectedIssuerId`);
  } catch {
    assertStateField(false, path);
  }
  assertStateField(
    typeof query.expectedVersionStream === 'string'
      && REPLAY_OPAQUE_ID_PATTERN.test(query.expectedVersionStream),
    `${path}.expectedVersionStream`,
  );
  for (const field of ['expectedAppId', 'expectedTargetProfileId']) {
    assertStateField(
      typeof query[field] === 'string' && REPLAY_OPAQUE_ID_PATTERN.test(query[field]),
      `${path}.${field}`,
    );
  }
  assertStateField(
    typeof query.expectedActivationHash === 'string'
      && ACTIVATION_HASH_PATTERN.test(query.expectedActivationHash),
    `${path}.expectedActivationHash`,
  );
  assertStateField(
    query.authorityInstanceId === null
      || (typeof query.authorityInstanceId === 'string' && UUID_V7_PATTERN.test(query.authorityInstanceId)),
    `${path}.authorityInstanceId`,
  );
  assertStateField(isRecord(query.pendingByScope), `${path}.pendingByScope`);
  let pendingDisposition = 'retain';
  for (const [key, obligation] of Object.entries(query.pendingByScope)) {
    try {
      const validated = validateResyncObligation(obligation, `${path}.pendingByScope`);
      assertStateField(scopeKey(validated.scopeId) === key, `${path}.pendingByScope`);
      assertStateField(
        validated.scopeId.kind !== 'connection'
          && validated.scopeId.namespace.clientStoreId === state.origin
          && validated.scopeId.namespace.queryKey === queryKey
          && validated.scopeId.namespace.queryInstanceId === query.queryInstanceId,
        `${path}.pendingByScope`,
      );
      if (
        QUERY_DISPOSITION_ORDER[validated.maxDisposition]
          > QUERY_DISPOSITION_ORDER[pendingDisposition]
      ) pendingDisposition = validated.maxDisposition;
    } catch {
      assertStateField(false, `${path}.pendingByScope`);
    }
  }
  assertStateField(
    QUERY_DISPOSITION_ORDER[query.effectiveDisposition]
      >= QUERY_DISPOSITION_ORDER[pendingDisposition],
    `${path}.effectiveDisposition`,
  );
  assertStateField(isRecord(query.scopeRevisionHighWater), `${path}.scopeRevisionHighWater`);
  for (const [key, revision] of Object.entries(query.scopeRevisionHighWater)) {
    assertStateField(key.length > 0, `${path}.scopeRevisionHighWater`);
    assertStateField(Number.isSafeInteger(revision) && revision >= 1, `${path}.scopeRevisionHighWater`);
  }
  for (const [key, obligation] of Object.entries(query.pendingByScope)) {
    assertStateField(
      query.scopeRevisionHighWater[key] >= obligation.revision,
      `${path}.scopeRevisionHighWater`,
    );
  }
  if (query.accepted !== null) {
    assertStateField(isRecord(query.accepted), `${path}.accepted`);
    assertStateField(
      Object.keys(query.accepted).sort().join(',') === 'authorizedLeaseHash,witness',
      `${path}.accepted`,
    );
    assertStateField(
      query.accepted.authorizedLeaseHash === null
        || /^sha256:[0-9a-f]{64}$/.test(query.accepted.authorizedLeaseHash),
      `${path}.accepted.authorizedLeaseHash`,
    );
    try {
      validateCompositeWitness(query.accepted.witness, `${path}.accepted.witness`);
    } catch {
      assertStateField(false, `${path}.accepted.witness`);
    }
  }
  if (query.leaseRequest !== null) assertLeaseRequest(query.leaseRequest, `${path}.leaseRequest`);
  // A malformed lease is retained long enough for the first authorized read
  // to commit the required delete tombstone. Treating it as whole-store
  // corruption would strand the bytes without performing delete-before-read.
  assertStateField(query.lease === null || isRecord(query.lease), `${path}.lease`);
  assertStateField(
    query.clientDeadlineMs === null
      || (Number.isSafeInteger(query.clientDeadlineMs) && query.clientDeadlineMs >= 0),
    `${path}.clientDeadlineMs`,
  );
  if (state.principalScope?.authMode === 'sessions') {
    assertStateField(query.authorityGeneration === state.authorityEpoch, `${path}.authorityGeneration`);
    assertStateField(query.principalId === state.principalScope.userId, `${path}.principalId`);
    assertStateField(
      query.expectedAuthorization.incarnation
        === state.principalScope.authorizationStreamIncarnation,
      `${path}.expectedAuthorization.incarnation`,
    );
    assertStateField(
      query.authorityInstanceId === (state.authorityDescriptor?.authorityInstanceId ?? null),
      `${path}.authorityInstanceId`,
    );
  }
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

const LEGACY_V4_ITEM6_FIELDS = [
  'acknowledged',
  'artifactScope',
  'authFingerprint',
  'authorityEpoch',
  'authorityKey',
  'failed',
  'generation',
  'legacyV2Stranded',
  'nextSequence',
  'origin',
  'pending',
  'queueAuthorization',
  'retained',
  'stranded',
  'version',
].sort().join(',');

const LEGACY_V4_ITEM7_FIELDS = [
  'acknowledged',
  'artifactScope',
  'authFingerprint',
  'authorityDescriptor',
  'authorityEpoch',
  'authorityKey',
  'failed',
  'generation',
  'legacyV2Stranded',
  'legacyV3Stranded',
  'nextSequence',
  'origin',
  'pending',
  'principalScope',
  'queryAuthorization',
  'retained',
  'stranded',
  'version',
].sort().join(',');

function legacyV4PredecessorShape(state) {
  if (state.version !== 4) return null;
  const fields = Object.keys(state).sort().join(',');
  if (fields === LEGACY_V4_ITEM6_FIELDS) return 'item6';
  if (
    fields === LEGACY_V4_ITEM7_FIELDS
    && state.principalScope !== null
    && state.authorityDescriptor !== null
  ) return 'item7';
  return 'ambiguous';
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
  const legacyV5 = state.version === 5;
  // @ref LLP 0043#auth-posture — item 6 and item 7 both shipped physical
  //   format 4. Only their exact, mutually exclusive top-level shapes are
  //   eligible for migration; partial/hybrid shapes cannot supply a missing
  //   authority axis after the fact.
  const legacyV4Shape = legacyV4PredecessorShape(state);
  if (legacyV1 || legacyV2 || legacyV3 || legacyV4 || legacyV5) {
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
  if (!Object.hasOwn(state, 'terminallyUnbound')) {
    if (!legacyV1 && !legacyV2 && !legacyV3 && !legacyV4 && !legacyV5) {
      assertStateField(false, 'terminallyUnbound');
    }
    state.terminallyUnbound = false;
  }
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
  if (!Object.hasOwn(state, 'queryInstanceHighWater')) state.queryInstanceHighWater = 0;
  if (!Object.hasOwn(state, 'leaseClockHighWaterMs')) state.leaseClockHighWaterMs = 0;
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
  assertStateField(typeof state.terminallyUnbound === 'boolean', 'terminallyUnbound');
  assertStateField(
    !state.terminallyUnbound || (state.authorityEpoch === null && state.authorityKey === null),
    'terminallyUnbound',
  );
  if (state.principalScope !== null) assertPrincipalScope(state.principalScope, 'principalScope');
  if (state.authorityDescriptor !== null) {
    assertAuthorityDescriptor(state.authorityDescriptor, 'authorityDescriptor');
  }
  assertStateField(
    Number.isSafeInteger(state.queryInstanceHighWater) && state.queryInstanceHighWater >= 0,
    'queryInstanceHighWater',
  );
  assertStateField(
    Number.isSafeInteger(state.leaseClockHighWaterMs) && state.leaseClockHighWaterMs >= 0,
    'leaseClockHighWaterMs',
  );
  assertStateField(isRecord(state.queryAuthorization), 'queryAuthorization');
  for (const [queryKey, query] of Object.entries(state.queryAuthorization)) {
    assertStateField(
      queryKey.length > 0 && utf8Length(queryKey) <= 8_192,
      'queryAuthorization.key',
    );
    assertQueryAuthorizationState(query, 'queryAuthorization.entry', state, queryKey);
  }
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
  if (legacyV4 && state.principalScope?.authMode === 'sessions') {
    // Clear before record-level scope validation: format 4 never carried the
    // lease/fence fields that could make these session bytes attributable.
    state.retained = {};
  }
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
    if (state.authorityDescriptor !== null) {
      assertMatchesCurrentScope(entry, path, state, { queued: true });
    }
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
    // Its payload-bearing stranded namespace likewise had no persisted
    // principal proof, so move it into legacy custody instead of letting a
    // subsequently bound format-5 principal observe it as rerecordable work.
    state.legacyV3Stranded.push(...[
      ...state.pending,
      ...state.failed,
      ...state.stranded,
    ].map((entry) => ({
      ...clone(entry),
      legacyFormat: 3,
      replayable: false,
    })));
    state.retained = {};
    state.pending = [];
    state.failed = [];
    state.acknowledged = [];
    state.stranded = [];
    state.principalScope = null;
    state.authorityDescriptor = null;
    state.queryAuthorization = {};
  }
  if (legacyV4Shape === 'item6') {
    // The exact item-6 predecessor has no principal or server-issued authority
    // instance. Its current queue is isolated for explicit discard, while all
    // other privacy-bearing predecessor collections are deleted.
    state.legacyV4Stranded.push(...[...state.pending, ...state.failed].map((entry) => ({
      ...clone(entry),
      legacyFormat: 4,
      legacyShape: 'invalidation',
      replayable: false,
      discardOnly: true,
    })));
    state.retained = {};
    state.pending = [];
    state.failed = [];
    state.acknowledged = [];
    state.stranded = [];
    state.legacyV2Stranded = [];
    state.legacyV3Stranded = [];
    state.principalScope = null;
    state.authorityDescriptor = null;
    state.queryAuthorization = {};
    state.authFingerprint = null;
  }
  if (legacyV4Shape === 'item7') {
    // The exact item-7 predecessor already proves the principal and queue
    // authority axes. Preserve only data and current work bound to those axes;
    // older stranded/receipt namespaces do not carry that proof.
    state.acknowledged = [];
    state.stranded = [];
    state.legacyV2Stranded = [];
    state.legacyV3Stranded = [];
  }
  if (legacyV4Shape === 'ambiguous') {
    // Hybrid, partial, extended, and neither-shape v4 stores are not evidence
    // for either authority model. Keep only redacted diagnostic tombstones;
    // no payload or retained row may cross this unidentifiable predecessor.
    const quarantined = [...state.pending, ...state.failed].map((entry) => ({
      ...redactedStrandedMutation(entry, state, 'legacy_v4_ambiguous', 'delete'),
      legacyFormat: 4,
      legacyShape: 'ambiguous',
    }));
    state.retained = {};
    state.pending = [];
    state.failed = [];
    state.acknowledged = [];
    state.stranded = [];
    state.legacyV2Stranded = [];
    state.legacyV3Stranded = [];
    state.legacyV4Stranded = quarantined;
    state.principalScope = null;
    state.authorityDescriptor = null;
    state.queryAuthorization = {};
    state.authFingerprint = null;
    const format5Fields = new Set(Object.keys(freshState()));
    for (const field of Object.keys(state)) {
      if (!format5Fields.has(field)) delete state[field];
    }
  }
  if (legacyV4) {
    // Format 4 deliberately had no lease semantics. Session-mode retained
    // bytes cannot be grandfathered into an item-8 authority proof; dev rows
    // remain on their existing non-session path.
    if (state.principalScope?.authMode === 'sessions') state.retained = {};
    state.queryInstanceHighWater = 0;
    state.leaseClockHighWaterMs = 0;
    state.queryAuthorization = {};
  }
  if (legacyV5) {
    // Format 5 predates the persistent terminallyUnbound anti-rebind bit. A
    // missing bit cannot distinguish a legitimate predecessor from a terminal
    // record rewritten by an older process, so no privacy-bearing v5 byte is
    // grandfathered into v6. Validate the complete predecessor above, then
    // clear it and require an exact coordinator transition to consume this
    // marker. An old context that later overwrites v6 with v5 is handled by the
    // same deletion-only migration on the next read.
    state.retained = {};
    state.pending = [];
    state.failed = [];
    state.acknowledged = [];
    state.stranded = [];
    state.legacyV2Stranded = [];
    state.legacyV3Stranded = [];
    state.legacyV4Stranded = [];
    state.queryAuthorization = {};
    state.queueAuthorization.pendingByScope = {};
    if (state.queueAuthorization.queueGeneration < Number.MAX_SAFE_INTEGER) {
      advanceQueueGeneration(state, 0);
    } else {
      state.queueAuthorization.authorityGeneration =
        state.queueAuthorization.authorityGeneration === 0 ? 1 : 0;
    }
    state.principalScope = null;
    state.authorityDescriptor = null;
    state.authFingerprint = null;
    state.authorityEpoch = null;
    state.authorityKey = null;
    state.terminallyUnbound = true;
  }
  // A format-6 rerecordable record contains the original mutation payload.
  // It is visible only while its persisted predecessor-principal proof is
  // byte-for-byte equal to the validated current principal. Structural
  // tampering or an unproven predecessor drops the payload before any public
  // store method can return it; discard-only evidence is re-redacted.
  sanitizeStrandedForPrincipal(state, state.principalScope);
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

function clientStoreGenerationExhaustedError() {
  return clientStoreStateError(
    'SNAPBACK_CLIENT_STORE_GENERATION_EXHAUSTED',
    'client-store write generation is exhausted and the store must be replaced',
  );
}

function expectedAuthorityMatchesState(state, expected = {}) {
  // MAX_SAFE_INTEGER is reserved as the final terminal deletion identity.
  // A format-6 writer from before that reservation may already have left a
  // bound store at the ceiling. Its bytes remain parseable so purge/clear can
  // recover them, but no public authority-bound read or act may treat them as
  // current in the meantime.
  if (state.generation === Number.MAX_SAFE_INTEGER) return false;
  if (state.authorityEpoch === null) {
    if (state.terminallyUnbound) return false;
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
  if (state.generation === Number.MAX_SAFE_INTEGER || state.terminallyUnbound) return false;
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

function advanceQueueForTerminalCut(state, authorityGeneration = null) {
  if (state.queueAuthorization.queueGeneration < Number.MAX_SAFE_INTEGER) {
    advanceQueueGeneration(state, authorityGeneration);
    return;
  }
  // The queue counter itself has no successor. Change the other comparison
  // axis to a value distinct from every capture at the ceiling; terminal
  // unbinding then makes that final identity permanently non-runnable.
  state.queueAuthorization.authorityGeneration =
    state.queueAuthorization.authorityGeneration === 0 ? 1 : 0;
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

function rerecordableStrandedMutation(entry, state, reason) {
  return {
    ...clone(entry),
    predecessorPrincipalScope: clone(state.principalScope),
    strandedAtEpoch: state.queueAuthorization.authorityGeneration,
    strandedAtQueueGeneration: state.queueAuthorization.queueGeneration,
    disposition: 'strand',
    reason,
    replayable: false,
    discardOnly: false,
    rerecordable: true,
  };
}

function sanitizeStrandedForPrincipal(state, principalScope) {
  state.stranded = state.stranded.flatMap((entry) => {
    const provenRerecordable = principalScope !== null
      && principalScope.userId !== null
      && entry.replayable === false
      && entry.rerecordable === true
      && entry.discardOnly === false
      && isRecord(entry.predecessorPrincipalScope)
      && stableJson(entry.predecessorPrincipalScope) === stableJson(principalScope);
    if (provenRerecordable) return [clone(entry)];
    if (entry.replayable === false && entry.discardOnly === true) {
      return [redactedStrandedMutation(
        entry,
        state,
        typeof entry.reason === 'string' ? entry.reason : 'stranded_discard_only',
        typeof entry.disposition === 'string' ? entry.disposition : 'delete',
      )];
    }
    return [];
  });
}

function clearLegacyQueueNamespaces(state) {
  state.legacyV2Stranded = [];
  state.legacyV3Stranded = [];
  state.legacyV4Stranded = [];
}

function clearCurrentQueue(state) {
  state.pending = [];
  state.failed = [];
  state.acknowledged = [];
  state.queueAuthorization.pendingByScope = {};
}

function clearAllQueueNamespaces(state) {
  clearCurrentQueue(state);
  state.stranded = [];
  clearLegacyQueueNamespaces(state);
}

function hasPrivacyBearingState(state) {
  return Object.keys(state.retained).length > 0
    || state.pending.length > 0
    || state.failed.length > 0
    || state.acknowledged.length > 0
    || state.stranded.length > 0
    || state.legacyV2Stranded.length > 0
    || state.legacyV3Stranded.length > 0
    || state.legacyV4Stranded.length > 0;
}

function terminalAuthorityDataIsClean(state) {
  return !hasPrivacyBearingState(state)
    && Object.keys(state.queueAuthorization.pendingByScope).length === 0
    && Object.keys(state.queryAuthorization).length === 0
    && state.authFingerprint === null
    && state.principalScope === null
    && state.authorityDescriptor === null;
}

function strandCurrentQueue(
  state,
  reason,
  disposition = 'delete',
  { rerecordable = false } = {},
) {
  const strand = rerecordable
    ? (entry) => rerecordableStrandedMutation(entry, state, reason)
    : (entry) => redactedStrandedMutation(entry, state, reason, disposition);
  state.stranded.push(...[...state.pending, ...state.failed].map(strand));
  // Queue invalidation callers retain their unresolved obligation roots and
  // unrelated settlement receipts. Authority-boundary callers clear those
  // namespaces explicitly around this payload transformation.
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

function queryFence(query) {
  return Object.freeze({
    queryInstanceId: query.queryInstanceId,
    authorityGeneration: query.authorityGeneration,
    queryGeneration: query.queryGeneration,
    authorityInstanceId: query.authorityInstanceId,
  });
}

function fenceMatches(query, fence) {
  return isRecord(fence)
    && fence.queryInstanceId === query.queryInstanceId
    && fence.authorityGeneration === query.authorityGeneration
    && fence.queryGeneration === query.queryGeneration
    && fence.authorityInstanceId === query.authorityInstanceId;
}

function requireQuery(state, key, fence = null, operation = 'retained query operation') {
  const query = ownEntry(state.queryAuthorization, key);
  if (!query || query.lifecycle !== 'active' || (fence !== null && !fenceMatches(query, fence))) {
    throw clientStoreStateError(
      'SNAPBACK_AUTH_QUERY_FENCE_STALE',
      `${operation} belongs to a stale or absent query instance`,
      { operation },
    );
  }
  return query;
}

function advanceQueryGeneration(query) {
  query.queryGeneration = nextInvalidationGeneration(query.queryGeneration);
  return queryFence(query);
}

function deleteAuthorizedPayload(state, key, query, { disposition = 'delete' } = {}) {
  delete state.retained[key];
  query.lease = null;
  query.leaseRequest = null;
  query.clientDeadlineMs = null;
  query.accepted = null;
  query.effectiveDisposition = disposition;
  return advanceQueryGeneration(query);
}

function updateLeaseClock(state, clientNowMs, key, query) {
  if (!Number.isSafeInteger(clientNowMs) || clientNowMs < 0) {
    throw new TypeError('clientNowMs must be a safe nonnegative integer');
  }
  if (clientNowMs < state.leaseClockHighWaterMs) {
    deleteAuthorizedPayload(state, key, query);
    return clientStoreStateError(
      'SNAPBACK_AUTH_CLOCK_ROLLBACK',
      'client clock moved backward; retained query was deleted before read',
    );
  }
  state.leaseClockHighWaterMs = clientNowMs;
  return null;
}

function leaseExpectation(state, key, query) {
  return {
    clientStoreId: state.origin,
    queryKey: key,
    queryInstanceId: query.queryInstanceId,
    principalId: query.principalId,
    authorization: query.expectedAuthorization,
    versionStream: query.expectedVersionStream,
    activationHash: query.expectedActivationHash,
    authorityInstanceId: query.authorityInstanceId,
  };
}

function queryArtifactContextMatches(state, query) {
  return state.artifactScope !== null
    && state.artifactScope.appId === query.expectedAppId
    && state.artifactScope.targetProfileId === query.expectedTargetProfileId
    && state.artifactScope.versionStreamId === query.expectedVersionStream;
}

function invalidateQueriesForAuthorityTransition(state, { deleteRows }) {
  for (const [key, query] of Object.entries(state.queryAuthorization)) {
    if (deleteRows) {
      delete state.retained[key];
      delete state.queryAuthorization[key];
      continue;
    }
    query.authorityGeneration = nextInvalidationGeneration(query.authorityGeneration);
    query.queryGeneration = nextInvalidationGeneration(query.queryGeneration);
    // @ref LLP 0059#transition-barrier — same-principal/new-session keeps the
    //   physical rows quarantined, but the predecessor descriptor must stop
    //   binding them during the clearing epoch before resume installs the
    //   successor descriptor.
    query.authorityInstanceId = null;
    query.effectiveDisposition = 'quarantine';
    query.lease = null;
    query.leaseRequest = null;
    query.clientDeadlineMs = null;
    query.accepted = null;
  }
}

function createStore({ read, write, withExclusive = (operation) => operation() }) {
  const load = () => normalizeState(read());
  const writeValidated = (state) => {
    // Validate a detached candidate before replacing durable bytes. Besides
    // preserving corrupt/future input, this keeps failed writes from
    // poisoning the in-memory reference adapter.
    const next = clone(state);
    normalizeState(next);
    write(next);
    return next;
  };
  const save = (state) => {
    const next = clone(state);
    // Reserve the final safe integer for a terminal privacy cut. Ordinary
    // work may never consume it and leave no durable deletion identity.
    if (next.generation >= Number.MAX_SAFE_INTEGER - 1) {
      throw clientStoreGenerationExhaustedError();
    }
    next.generation += 1;
    return writeValidated(next);
  };
  const saveTerminal = (state) => {
    const next = clone(state);
    if (!terminalAuthorityDataIsClean(next)) {
      throw clientStoreStateError(
        'SNAPBACK_CLIENT_STORE_TERMINAL_DIRTY',
        'terminal client-store commit still contains authority-bound data',
      );
    }
    // A pre-reservation writer may already have consumed MAX_SAFE_INTEGER.
    // Replacing those bytes at the same final identity is safe because every
    // authority/queue comparison rejects the ceiling and only purge/clear can
    // operate there. Below the ceiling, terminal work still advances exactly
    // once and uses the reserved value only when no ordinary value remains.
    if (next.generation < Number.MAX_SAFE_INTEGER) next.generation += 1;
    return writeValidated(next);
  };
  const transact = (operation) => withExclusive(
    () => operation(load(), save, saveTerminal),
  );
  return {
    version: SNAPBACK_CLIENT_STORE_VERSION,

    // @ref LLP 0059#format-3-and-authority-tags — the coordinator epoch/key
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
        if (state.generation === Number.MAX_SAFE_INTEGER) {
          throw clientStoreGenerationExhaustedError();
        }
        if (state.authorityEpoch !== null) {
          if (state.authorityEpoch === authorityEpoch && state.authorityKey === authorityKey) {
            return clone({ authorityEpoch, authorityKey });
          }
          throw staleStoreAuthorityError('authority bind');
        }
        if (state.terminallyUnbound) {
          throw staleStoreAuthorityError('authority bind after terminal purge');
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
        state.queryAuthorization = {};
        state.pending = [];
        state.failed = [];
        state.acknowledged = [];
        state.authFingerprint = null;
        state.authorityEpoch = authorityEpoch;
        state.authorityKey = authorityKey;
        state.terminallyUnbound = false;
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
      expectedStoreGeneration = null,
      disposition = 'delete',
      queueTransition = 'delete',
      transitionReason = 'authority_boundary_delete',
      retainPrincipalData = false,
      nextPrincipalScope = null,
      terminal = false,
    }) {
      if (
        expectedEpoch !== null
        && (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0)
      ) {
        throw new TypeError('transitionAuthority requires a safe expectedEpoch or null');
      }
      if (!Number.isSafeInteger(nextEpoch) || nextEpoch < 0) {
        throw new TypeError('transitionAuthority requires a safe nextEpoch');
      }
      if (
        expectedStoreGeneration !== null
        && (!Number.isSafeInteger(expectedStoreGeneration) || expectedStoreGeneration < 0)
      ) {
        throw new TypeError('transitionAuthority expectedStoreGeneration must be a safe nonnegative integer or null');
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
      if (![
        'delete',
        'strand-redacted',
        'strand-rerecordable',
      ].includes(queueTransition)) {
        throw new TypeError('transitionAuthority received an invalid queueTransition');
      }
      if (typeof transitionReason !== 'string' || transitionReason.length === 0) {
        throw new TypeError('transitionAuthority requires a transitionReason');
      }
      if (typeof retainPrincipalData !== 'boolean') {
        throw new TypeError('transitionAuthority retainPrincipalData must be boolean');
      }
      if (typeof terminal !== 'boolean') {
        throw new TypeError('transitionAuthority terminal must be boolean');
      }
      if (nextPrincipalScope !== null) {
        assertPrincipalScope(nextPrincipalScope, 'nextPrincipalScope');
      }
      return transact((state, commit, commitTerminal) => {
        if (
          expectedStoreGeneration !== null
          && state.generation !== expectedStoreGeneration
        ) {
          throw staleStoreAuthorityError('authority transition generation');
        }
        const exactCurrent = state.authorityEpoch === nextEpoch
          && state.authorityKey === nextAuthorityKey;
        const terminalReplay = terminal
          && nextPrincipalScope === null
          && retainPrincipalData === false
          && queueTransition === 'delete';
        const terminalClean = terminalAuthorityDataIsClean(state);
        const cleanUnboundAdoption = state.authorityEpoch === null
          && state.authorityKey === null
          && terminalClean;
        // A suspended context may miss several custody transitions while a
        // peer has already committed this physical store to the exact current
        // successor. Exact-current adoption is idempotent except for a
        // terminal replay that finds privacy-bearing residue under the same
        // tuple; that residue must be cleared before the delete can settle.
        if (exactCurrent && (!terminalReplay || terminalClean)) {
          return clone({ authorityEpoch: nextEpoch, authorityKey: nextAuthorityKey });
        }
        if (!exactCurrent) {
          const cleanSameEpochAdoption = cleanUnboundAdoption
            && expectedEpoch !== null
            && nextEpoch === expectedEpoch;
          if (
            (expectedEpoch === null && nextEpoch !== 0)
            || (
              expectedEpoch !== null
              && nextEpoch !== expectedEpoch + 1
              && !cleanSameEpochAdoption
            )
          ) {
            throw new TypeError('transitionAuthority must begin at zero or must advance authority epoch exactly once');
          }
          // A terminal participant deliberately unbinds the physical store so
          // delayed captures for the deleted authority cannot write into it.
          // The durable coordinator may later prove a one-step active
          // successor from that tombstone. A fully privacy-clean unbound store
          // can adopt that proven successor just as bindAuthority could; dirty
          // or partially bound state still fails closed as stale.
          if (state.authorityEpoch !== expectedEpoch && !cleanUnboundAdoption) {
            throw staleStoreAuthorityError('authority transition');
          }
        }
        const samePrincipal = state.principalScope !== null
          && nextPrincipalScope !== null
          && stableJson(state.principalScope) === stableJson(nextPrincipalScope);
        const preservePrincipalData = retainPrincipalData && samePrincipal;
        advanceQueueGeneration(state, nextEpoch);
        state.queueAuthorization.pendingByScope = {};
        clearLegacyQueueNamespaces(state);
        if (queueTransition === 'strand-rerecordable' && preservePrincipalData) {
          sanitizeStrandedForPrincipal(state, state.principalScope);
          strandCurrentQueue(
            state,
            transitionReason,
            'strand',
            { rerecordable: true },
          );
        } else if (queueTransition === 'strand-redacted') {
          // Anonymous/dev predecessor payloads cannot be exposed to a successor
          // principal. Preserve only discard-only evidence that work existed.
          state.stranded = [];
          strandCurrentQueue(state, transitionReason, 'strand');
        } else {
          // This includes a caller attempting a rerecordable strand without
          // exact principal continuity: fail closed to the table's delete row.
          clearAllQueueNamespaces(state);
        }
        state.acknowledged = [];
        invalidateQueriesForAuthorityTransition(
          state,
          { deleteRows: !preservePrincipalData },
        );
        if (!preservePrincipalData) state.retained = {};
        if (!preservePrincipalData) state.authFingerprint = null;
        state.principalScope = clone(nextPrincipalScope);
        state.authorityDescriptor = null;
        state.authorityEpoch = nextEpoch;
        state.authorityKey = nextAuthorityKey;
        state.terminallyUnbound = false;
        (terminal ? commitTerminal : commit)(state);
        return clone({ authorityEpoch: nextEpoch, authorityKey: nextAuthorityKey });
      });
    },

    async purgeAuthority({ authorityKey }) {
      if (typeof authorityKey !== 'string' || !AUTHORITY_KEY_PATTERN.test(authorityKey)) {
        throw new TypeError('purgeAuthority requires a canonical authorityKey');
      }
      return transact((state, _commit, commitTerminal) => {
        if (state.authorityKey !== null && state.authorityKey !== authorityKey) {
          return { purged: false, fenced: false };
        }
        if (state.terminallyUnbound && terminalAuthorityDataIsClean(state)) {
          return { purged: true, fenced: true };
        }
        clearAllQueueNamespaces(state);
        state.queueAuthorization.pendingByScope = {};
        invalidateQueriesForAuthorityTransition(state, { deleteRows: true });
        state.retained = {};
        state.authFingerprint = null;
        state.principalScope = null;
        state.authorityDescriptor = null;
        // Invalidate every queue capture taken before the terminal cut. At the
        // numeric ceiling the unbound-state rule above is itself the permanent
        // non-aliasing fence; do not wrap the comparison generation.
        advanceQueueForTerminalCut(state, 0);
        // This path is used when shared custody proves another tuple owns the
        // primary row. Unbinding the exact stale local key invalidates every
        // old authority/queue capture without consuming a successor epoch.
        state.authorityEpoch = null;
        state.authorityKey = null;
        state.terminallyUnbound = true;
        commitTerminal(state);
        return { purged: true, fenced: true };
      });
    },

    async authorityScope() {
      return transact((state) => {
        if (state.generation === Number.MAX_SAFE_INTEGER && !state.terminallyUnbound) {
          throw clientStoreGenerationExhaustedError();
        }
        return clone({
          authorityEpoch: state.authorityEpoch,
          authorityKey: state.authorityKey,
        });
      });
    },

    async authorityBindingCapture() {
      return transact((state) => {
        if (state.generation === Number.MAX_SAFE_INTEGER && !state.terminallyUnbound) {
          throw clientStoreGenerationExhaustedError();
        }
        return clone({
          storeGeneration: state.generation,
          authorityEpoch: state.authorityEpoch,
          authorityKey: state.authorityKey,
          terminallyUnbound: state.terminallyUnbound,
        });
      });
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
    //   are independent axes in the composed format-6 store.
    /// Install the two independent format-6 axes from one authenticated
    /// handshake. Principal identity owns retained rows; the opaque authority
    /// instance owns queued mutations. Query authorization remains durable and
    /// is changed only through the item-8 fence/lease methods below.
    async scopeAuthorization({
      principalScope,
      authorityDescriptor,
      queryAuthorization = {},
    }, expected = {}) {
      assertPrincipalScope(principalScope, 'principalScope');
      assertAuthorityDescriptor(authorityDescriptor, 'authorityDescriptor');
      if (!isRecord(queryAuthorization) || Object.keys(queryAuthorization).length !== 0) {
        throw new TypeError('handshake queryAuthorization must be an empty object');
      }
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'authorization scope change');
        const principalChanged = state.principalScope !== null
          && stableJson(state.principalScope) !== stableJson(principalScope);
        const unknownPrincipal = state.principalScope === null
          && hasPrivacyBearingState(state);

        // @ref LLP 0059#format-3-and-authority-tags — establish the principal
        //   boundary before considering queue authority. A different, missing,
        //   or unprovable predecessor principal deletes every privacy-bearing
        //   namespace; no later descriptor may make those bytes attributable.
        if (principalChanged || unknownPrincipal) {
          state.retained = {};
          invalidateQueriesForAuthorityTransition(state, { deleteRows: true });
          advanceQueueGeneration(state);
          clearAllQueueNamespaces(state);
          state.authFingerprint = null;
        } else {
          // Legacy queues have no format-6 proof connecting them to this
          // principal, even when the modern principal itself is unchanged.
          clearLegacyQueueNamespaces(state);
          if (state.principalScope !== null) {
            sanitizeStrandedForPrincipal(state, state.principalScope);
          }
        }

        const authorityChanged = state.authorityDescriptor !== null
          && state.authorityDescriptor.authorityInstanceId
            !== authorityDescriptor.authorityInstanceId;
        const unknownAuthority = state.authorityDescriptor === null
          && (
            state.pending.length > 0
            || state.failed.length > 0
            || state.acknowledged.length > 0
          );
        const exactSamePrincipal = state.principalScope !== null
          && state.principalScope.userId !== null
          && stableJson(state.principalScope) === stableJson(principalScope);
        if (!principalChanged && !unknownPrincipal && authorityChanged) {
          advanceQueueGeneration(state);
          state.queueAuthorization.pendingByScope = {};
          if (exactSamePrincipal) {
            strandCurrentQueue(
              state,
              'authority_instance_changed',
              'strand',
              { rerecordable: true },
            );
          } else {
            clearAllQueueNamespaces(state);
          }
          state.acknowledged = [];
          invalidateQueriesForAuthorityTransition(state, { deleteRows: false });
        } else if (!principalChanged && !unknownPrincipal && unknownAuthority) {
          advanceQueueGeneration(state);
          // A transition participant may deliberately leave already-stranded
          // records while the successor descriptor is fetched. Only executable
          // queue/receipt state lacks proof here and must be deleted.
          clearCurrentQueue(state);
        }
        state.principalScope = clone(principalScope);
        state.authorityDescriptor = clone(authorityDescriptor);
        for (const query of Object.values(state.queryAuthorization)) {
          query.authorityInstanceId = authorityDescriptor.authorityInstanceId;
        }
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
          invalidateQueriesForAuthorityTransition(state, { deleteRows: true });
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
          invalidateQueriesForAuthorityTransition(state, { deleteRows: true });
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
              ...(state.authorityDescriptor === null
                ? {}
                : { authorityDescriptor: clone(entry.authorityDescriptor) }),
              // This redacted tombstone is diagnostic state intentionally
              // carried into the replacement artifact namespace. The old
              // identity remains in `diagnostic.previous`; binding the record
              // itself to that old namespace would make format-6 reject its
              // own committed state on reload.
              ...nextScope,
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

    // @ref LLP 0053#client-fences — query identity is allocated only by an
    // explicit initialization; incoming obligations and delayed callbacks can
    // never recreate a missing or terminally retired instance.
    async initializeAuthorizedRetainedQuery(key, {
      authorization,
      issuerId,
      versionStream,
      principalId,
      activationHash,
      appId,
      targetProfileId,
    }, expected = {}) {
      if (typeof key !== 'string' || key.length === 0 || utf8Length(key) > 8_192) {
        throw new TypeError('authorized retained query key must be non-empty and bounded');
      }
      const normalizedAuthorization = validateAuthorizationVersion(authorization);
      const normalizedIssuer = validateIssuerId(issuerId);
      if (typeof versionStream !== 'string' || !REPLAY_OPAQUE_ID_PATTERN.test(versionStream)) {
        throw new TypeError('authorized retained query requires a canonical versionStream');
      }
      if (typeof principalId !== 'string' || !REPLAY_OPAQUE_ID_PATTERN.test(principalId)) {
        throw new TypeError('authorized retained query requires a canonical principalId');
      }
      if (typeof activationHash !== 'string' || !ACTIVATION_HASH_PATTERN.test(activationHash)) {
        throw new TypeError('authorized retained query requires a canonical activationHash');
      }
      for (const [field, value] of Object.entries({ appId, targetProfileId })) {
        if (typeof value !== 'string' || !REPLAY_OPAQUE_ID_PATTERN.test(value)) {
          throw new TypeError(`authorized retained query requires a canonical ${field}`);
        }
      }
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'authorized retained query initialization');
        if (
          state.principalScope?.authMode !== 'sessions'
          || state.principalScope.userId !== principalId
          || state.principalScope.authorizationStreamIncarnation
            !== normalizedAuthorization.incarnation
          || state.authorityEpoch === null
          || state.artifactScope?.appId !== appId
          || state.artifactScope?.targetProfileId !== targetProfileId
          || state.artifactScope?.versionStreamId !== versionStream
        ) {
          throw clientStoreStateError(
            'SNAPBACK_AUTH_RETAINED_AUTHORITY_INVALID',
            'retainable session query must depend on the current userId-only principal scope',
          );
        }
        const authorityInstanceId = state.authorityDescriptor?.authorityInstanceId ?? null;
        const current = ownEntry(state.queryAuthorization, key);
        if (
          current?.lifecycle === 'active'
          && current.authorityGeneration === state.authorityEpoch
          && current.authorityInstanceId === authorityInstanceId
          && current.principalId === principalId
          && stableJson(current.expectedAuthorization) === stableJson(normalizedAuthorization)
          && stableJson(current.expectedIssuerId) === stableJson(normalizedIssuer)
          && current.expectedVersionStream === versionStream
          && current.expectedActivationHash === activationHash
          && current.expectedAppId === appId
          && current.expectedTargetProfileId === targetProfileId
        ) {
          return clone({
            namespace: {
              clientStoreId: state.origin,
              queryKey: key,
              queryInstanceId: current.queryInstanceId,
            },
            fence: queryFence(current),
          });
        }
        if (current) delete state.retained[key];
        const queryInstanceId = nextQueryInstanceId(state.queryInstanceHighWater);
        state.queryInstanceHighWater = queryInstanceId;
        const query = {
          queryInstanceId,
          lifecycle: 'active',
          authorityGeneration: state.authorityEpoch,
          queryGeneration: 0,
          authorityInstanceId,
          principalId,
          expectedAuthorization: clone(normalizedAuthorization),
          expectedIssuerId: clone(normalizedIssuer),
          expectedVersionStream: versionStream,
          expectedActivationHash: activationHash,
          expectedAppId: appId,
          expectedTargetProfileId: targetProfileId,
          effectiveDisposition: 'retain',
          accepted: null,
          pendingByScope: {},
          scopeRevisionHighWater: {},
          leaseRequest: null,
          lease: null,
          clientDeadlineMs: null,
        };
        setOwnEntry(state.queryAuthorization, key, query);
        commit(state);
        return clone({
          namespace: { clientStoreId: state.origin, queryKey: key, queryInstanceId },
          fence: queryFence(query),
        });
      });
    },

    async captureAuthorizedRetainedQuery(key, expected = {}) {
      return transact((state) => {
        assertExpectedAuthority(state, expected, 'authorized retained query capture');
        const query = requireQuery(state, key, null, 'authorized retained query capture');
        return clone({
          namespace: {
            clientStoreId: state.origin,
            queryKey: key,
            queryInstanceId: query.queryInstanceId,
          },
          fence: queryFence(query),
          disposition: query.effectiveDisposition,
        });
      });
    },

    async receiveRetainedQueryObligation(key, obligationValue, fence, expected = {}) {
      const obligation = validateResyncObligation(obligationValue);
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'retained query invalidation');
        const query = requireQuery(state, key, fence, 'retained query invalidation');
        if (obligation.scopeId.kind === 'connection') {
          throw clientStoreStateError(
            'SNAPBACK_AUTH_INVALIDATION_SCOPE_INVALID',
            'a connection root must be expanded to an exact query scope before client apply',
          );
        }
        const namespace = obligation.scopeId.namespace;
        if (
          namespace.clientStoreId !== state.origin
          || namespace.queryKey !== key
          || namespace.queryInstanceId !== query.queryInstanceId
        ) {
          throw clientStoreStateError(
            'SNAPBACK_AUTH_QUERY_FENCE_STALE',
            'invalidation names another query instance',
          );
        }
        const keyForScope = scopeKey(obligation.scopeId);
        const highWater = query.scopeRevisionHighWater[keyForScope] ?? 0;
        if (obligation.revision <= highWater && !query.pendingByScope[keyForScope]) {
          return clone({ status: 'duplicate', fence: queryFence(query) });
        }
        const merged = mergeResyncObligation(
          query.pendingByScope[keyForScope] ?? null,
          obligation,
          {
            authorization: query.expectedAuthorization,
            versionStream: query.expectedVersionStream,
            issuerId: obligation.scopeId.kind === 'clientQuery' ? null : query.expectedIssuerId,
          },
        );
        if (merged.status !== 'accepted') {
          return clone({ status: merged.status, fence: queryFence(query) });
        }
        query.pendingByScope[keyForScope] = clone(merged.obligation);
        query.scopeRevisionHighWater[keyForScope] = Math.max(highWater, obligation.revision);
        query.effectiveDisposition = effectiveDisposition(query.pendingByScope);
        query.lease = null;
        query.leaseRequest = null;
        query.clientDeadlineMs = null;
        if (query.effectiveDisposition === 'delete') delete state.retained[key];
        const nextFence = advanceQueryGeneration(query);
        commit(state);
        return clone({
          status: 'accepted',
          disposition: query.effectiveDisposition,
          fence: nextFence,
        });
      });
    },

    async beginAuthorizedLeaseRequest(key, {
      fence,
      leaseRequestId,
      clientNowMs,
    }, expected = {}) {
      if (typeof leaseRequestId !== 'string' || !REPLAY_OPAQUE_ID_PATTERN.test(leaseRequestId)) {
        throw new TypeError('leaseRequestId must be a canonical opaque id');
      }
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'authorized lease request');
        const query = requireQuery(state, key, fence, 'authorized lease request');
        const rollback = updateLeaseClock(state, clientNowMs, key, query);
        if (rollback) {
          commit(state);
          throw rollback;
        }
        if (Object.keys(query.pendingByScope).length > 0) {
          throw clientStoreStateError(
            'SNAPBACK_AUTH_INVALIDATION_PENDING',
            'a retained query with pending invalidation cannot request a lease',
          );
        }
        const nextFence = advanceQueryGeneration(query);
        const retained = ownEntry(state.retained, key);
        if (retained) retained.queryGeneration = query.queryGeneration;
        query.leaseRequest = {
          leaseRequestId,
          queryInstanceId: query.queryInstanceId,
          queryGeneration: query.queryGeneration,
          startedClientMs: clientNowMs,
        };
        commit(state);
        return clone({ request: query.leaseRequest, fence: nextFence });
      });
    },

    async commitAuthorizedRetainedSnapshot(key, {
      fence,
      lease: leaseValue,
      record,
      clientNowMs,
    }, expected = {}) {
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'authorized retained snapshot');
        const query = requireQuery(state, key, fence, 'authorized retained snapshot');
        const failDelete = (code, message) => {
          deleteAuthorizedPayload(state, key, query);
          commit(state);
          throw clientStoreStateError(code, message);
        };
        if (!queryArtifactContextMatches(state, query)) {
          failDelete(
            'SNAPBACK_AUTHORIZED_LEASE_BINDING_MISMATCH',
            'authorized snapshot belongs to another app, target, or version stream',
          );
        }
        const rollback = updateLeaseClock(state, clientNowMs, key, query);
        if (rollback) {
          commit(state);
          throw rollback;
        }
        if (
          query.leaseRequest === null
          || query.leaseRequest.queryGeneration !== query.queryGeneration
          || Object.keys(query.pendingByScope).length > 0
        ) {
          failDelete(
            'SNAPBACK_AUTHORIZED_LEASE_STALE',
            'authorized snapshot does not own the current empty-obligation lease reservation',
          );
        }
        let derived;
        try {
          derived = deriveAuthorizedLeaseCommit({
            lease: leaseValue,
            request: query.leaseRequest,
            expected: leaseExpectation(state, key, query),
            clientNowMs,
          });
        } catch (error) {
          failDelete(
            error?.code ?? 'SNAPBACK_AUTHORIZED_LEASE_INVALID',
            'authorized lease response was malformed, expired, or bound to another proof',
          );
        }
        if (
          !isRecord(record)
          || !Array.isArray(record.rows)
          || record.versionStreamId !== derived.lease.data.versionStream
          || record.cursor?.stream !== derived.lease.data.versionStream
          || record.version !== derived.lease.data.snapshotCommitVersion
          || record.cursor?.version !== derived.lease.data.snapshotCommitVersion
        ) {
          failDelete(
            'SNAPBACK_AUTHORIZED_LEASE_SNAPSHOT_MISMATCH',
            'lease-bearing snapshot does not match the authorized data witness',
          );
        }
        const nextFence = advanceQueryGeneration(query);
        query.accepted = {
          witness: {
            authorization: clone(derived.lease.authorization),
            data: {
              versionStream: derived.lease.data.versionStream,
              minCommitVersion: derived.lease.data.snapshotCommitVersion,
            },
          },
          authorizedLeaseHash: derived.leaseHash,
        };
        query.lease = clone(derived.lease);
        query.leaseRequest = null;
        query.clientDeadlineMs = derived.clientDeadlineMs;
        query.effectiveDisposition = 'retain';
        const scopedRecord = {
          ...record,
          ...(state.artifactScope ?? {}),
          principalScope: clone(state.principalScope),
          queryInstanceId: query.queryInstanceId,
          authorityGeneration: query.authorityGeneration,
          queryGeneration: query.queryGeneration,
          authorityInstanceId: query.authorityInstanceId,
          authorizedLeaseHash: derived.leaseHash,
          stale: false,
        };
        if (!recordMatchesCurrentRetainedScope(state, scopedRecord)) {
          throw staleStoreScopeError('authorized retained snapshot');
        }
        setOwnEntry(state.retained, key, clone(scopedRecord));
        commit(state);
        return clone({ fence: nextFence, record: ownEntry(state.retained, key) });
      });
    },

    async putAuthorizedRetainedQuery(key, {
      fence,
      record,
      clientNowMs,
    }, expected = {}) {
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'authorized retained update');
        const query = requireQuery(state, key, fence, 'authorized retained update');
        const failDelete = (code, message) => {
          deleteAuthorizedPayload(state, key, query);
          commit(state);
          throw clientStoreStateError(code, message);
        };
        const rollback = updateLeaseClock(state, clientNowMs, key, query);
        if (rollback) {
          commit(state);
          throw rollback;
        }
        if (!queryArtifactContextMatches(state, query)) {
          failDelete(
            'SNAPBACK_AUTHORIZED_LEASE_BINDING_MISMATCH',
            'retained update belongs to another app, target, or version stream',
          );
        }
        if (query.effectiveDisposition !== 'retain' || Object.keys(query.pendingByScope).length > 0) {
          throw clientStoreStateError(
            'SNAPBACK_AUTH_INVALIDATION_PENDING',
            'retained update cannot cross a query invalidation barrier',
          );
        }
        let currentLease;
        try {
          currentLease = validateAuthorizedLease(query.lease);
          const expectation = leaseExpectation(state, key, query);
          if (
            currentLease.clientStoreId !== expectation.clientStoreId
            || currentLease.queryKey !== expectation.queryKey
            || currentLease.queryInstanceId !== expectation.queryInstanceId
            || currentLease.principalId !== expectation.principalId
            || stableJson(currentLease.authorization) !== stableJson(expectation.authorization)
            || currentLease.data.versionStream !== expectation.versionStream
            || currentLease.activationHash !== expectation.activationHash
            || currentLease.authorityInstanceId !== expectation.authorityInstanceId
            || query.accepted?.authorizedLeaseHash !== authorizedLeaseHash(currentLease)
          ) {
            failDelete(
              'SNAPBACK_AUTHORIZED_LEASE_BINDING_MISMATCH',
              'retained update lease does not bind the current query authority',
            );
          }
        } catch (error) {
          if (error?.code === 'SNAPBACK_AUTHORIZED_LEASE_BINDING_MISMATCH') throw error;
          failDelete(
            'SNAPBACK_AUTHORIZED_LEASE_INVALID',
            'retained update lease is missing or malformed',
          );
        }
        if (query.clientDeadlineMs === null || clientNowMs >= query.clientDeadlineMs) {
          failDelete(
            'SNAPBACK_AUTHORIZED_LEASE_EXPIRED',
            'retained update lease expired before commit',
          );
        }
        const current = ownEntry(state.retained, key);
        if (
          !isRecord(record)
          || !Array.isArray(record.rows)
          || record.versionStreamId !== query.expectedVersionStream
          || record.cursor?.stream !== query.expectedVersionStream
          || !Number.isSafeInteger(record.version)
          || record.version < (query.accepted?.witness?.data?.minCommitVersion ?? 0)
          || record.cursor?.version !== record.version
          || (current && Number.isSafeInteger(current.version) && record.version < current.version)
        ) {
          throw clientStoreStateError(
            'SNAPBACK_AUTH_QUERY_FENCE_STALE',
            'retained update does not advance the current data witness',
          );
        }
        const nextFence = advanceQueryGeneration(query);
        query.accepted.witness = {
          authorization: clone(query.expectedAuthorization),
          data: {
            versionStream: query.expectedVersionStream,
            minCommitVersion: record.version,
          },
        };
        setOwnEntry(state.retained, key, clone({
          ...record,
          ...(state.artifactScope ?? {}),
          principalScope: clone(state.principalScope),
          queryInstanceId: query.queryInstanceId,
          authorityGeneration: query.authorityGeneration,
          queryGeneration: query.queryGeneration,
          authorityInstanceId: query.authorityInstanceId,
          authorizedLeaseHash: query.accepted.authorizedLeaseHash,
          stale: false,
        }));
        commit(state);
        return clone({ fence: nextFence, record: ownEntry(state.retained, key) });
      });
    },

    async applyRetainedQueryResolution(key, {
      fence,
      resolution: resolutionValue,
      record = null,
    }, expected = {}) {
      const resolution = validateResolutionTicket(resolutionValue);
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'retained query resolution');
        const query = requireQuery(state, key, fence, 'retained query resolution');
        const keyForScope = scopeKey(resolution.scopeId);
        const obligation = query.pendingByScope[keyForScope];
        if (!obligation || !resolutionSatisfies(obligation, resolution)) {
          throw clientStoreStateError(
            'SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE',
            'resolution does not satisfy the current exact query obligation',
          );
        }
        const destructive = resolution.kind === 'terminalDelete'
          || resolution.maxDisposition === 'delete';
        if (!destructive) {
          if (
            !isRecord(record)
            || !Array.isArray(record.rows)
            || resolution.witness.data === null
            || record.versionStreamId !== resolution.witness.data.versionStream
            || record.cursor?.stream !== resolution.witness.data.versionStream
            || !Number.isSafeInteger(record.version)
            || record.version < resolution.witness.data.minCommitVersion
            || record.cursor?.version !== record.version
          ) {
            throw clientStoreStateError(
              'SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE',
              'resolution snapshot does not cover its composite witness',
            );
          }
        }
        delete query.pendingByScope[keyForScope];
        query.lease = null;
        query.leaseRequest = null;
        query.clientDeadlineMs = null;
        const remainingDisposition = effectiveDisposition(query.pendingByScope);
        if (destructive || remainingDisposition === 'delete') {
          delete state.retained[key];
          query.accepted = null;
          query.effectiveDisposition = 'delete';
        } else {
          query.accepted = {
            witness: clone(resolution.witness),
            authorizedLeaseHash: null,
          };
          query.effectiveDisposition = remainingDisposition;
          setOwnEntry(state.retained, key, clone({
            ...record,
            ...(state.artifactScope ?? {}),
            principalScope: clone(state.principalScope),
            queryInstanceId: query.queryInstanceId,
            authorityGeneration: query.authorityGeneration,
            authorityInstanceId: query.authorityInstanceId,
            authorizedLeaseHash: null,
            stale: false,
          }));
        }
        const nextFence = advanceQueryGeneration(query);
        const retained = ownEntry(state.retained, key);
        if (retained) retained.queryGeneration = query.queryGeneration;
        commit(state);
        return clone({
          ackToken: resolution.ackToken,
          disposition: query.effectiveDisposition,
          fence: nextFence,
        });
      });
    },

    // Authenticated issuer/scope retirement is cleanup, not an ACK and not a
    // lease renewal. The live fence has already proved the retirement against
    // its covering fresh snapshot; this transaction removes only those exact
    // durable roots and installs the same snapshot with no lease, so offline
    // reads remain blocked until a later full revalidation.
    async retireRetainedQueryScopes(key, {
      fence,
      retired,
      record,
    }, expected = {}) {
      if (!Array.isArray(retired) || retired.length === 0) {
        throw new TypeError('retireRetainedQueryScopes requires retired scope entries');
      }
      const normalized = retired.map((entry, index) => {
        if (!isRecord(entry) || !Object.hasOwn(entry, 'scopeId')) {
          throw new TypeError(`retired[${index}] must name scopeId`);
        }
        return {
          scopeId: validateScopeId(entry.scopeId, `retired[${index}].scopeId`),
          revision: entry.revision,
        };
      });
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'retained query scope retirement');
        const query = requireQuery(state, key, fence, 'retained query scope retirement');
        for (const entry of normalized) {
          const scope = entry.scopeId;
          if (scope.kind === 'connection') {
            throw clientStoreStateError(
              'SNAPBACK_AUTH_INVALIDATION_SCOPE_INVALID',
              'a connection root must be expanded before retained-query retirement',
            );
          }
          if (
            scope.namespace.clientStoreId !== state.origin
            || scope.namespace.queryKey !== key
            || scope.namespace.queryInstanceId !== query.queryInstanceId
          ) {
            throw clientStoreStateError(
              'SNAPBACK_AUTH_QUERY_FENCE_STALE',
              'retirement names another retained query instance',
            );
          }
          const pendingKey = scopeKey(scope);
          const pending = query.pendingByScope[pendingKey];
          if (
            pending
            && (entry.revision === null || entry.revision === undefined
              || entry.revision >= pending.revision)
          ) {
            delete query.pendingByScope[pendingKey];
          }
        }
        if (
          !isRecord(record)
          || !Array.isArray(record.rows)
          || record.versionStreamId !== query.expectedVersionStream
          || record.cursor?.stream !== query.expectedVersionStream
          || !Number.isSafeInteger(record.version)
          || record.version < 0
          || record.cursor?.version !== record.version
        ) {
          throw clientStoreStateError(
            'SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE',
            'retirement snapshot does not cover the retained data stream',
          );
        }
        query.lease = null;
        query.leaseRequest = null;
        query.clientDeadlineMs = null;
        query.effectiveDisposition = effectiveDisposition(query.pendingByScope);
        query.accepted = {
          witness: {
            authorization: clone(query.expectedAuthorization),
            data: {
              versionStream: query.expectedVersionStream,
              minCommitVersion: record.version,
            },
          },
          authorizedLeaseHash: null,
        };
        const nextFence = advanceQueryGeneration(query);
        setOwnEntry(state.retained, key, clone({
          ...record,
          ...(state.artifactScope ?? {}),
          principalScope: clone(state.principalScope),
          queryInstanceId: query.queryInstanceId,
          authorityGeneration: query.authorityGeneration,
          queryGeneration: query.queryGeneration,
          authorityInstanceId: query.authorityInstanceId,
          authorizedLeaseHash: null,
          stale: false,
        }));
        commit(state);
        return clone({
          disposition: query.effectiveDisposition,
          fence: nextFence,
        });
      });
    },

    // @ref LLP 0053#retained-and-offline-authorization — clock rollback,
    // expiry/equality, and any missing or mismatched lease commit delete the
    // exact current instance before this method can return bytes.
    async getAuthorizedRetainedQuery(key, {
      fence = null,
      clientNowMs,
    }, expected = {}) {
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'authorized retained query read');
        const query = requireQuery(state, key, fence, 'authorized retained query read');
        const failDelete = (code, message) => {
          deleteAuthorizedPayload(state, key, query);
          commit(state);
          throw clientStoreStateError(code, message);
        };
        const rollback = updateLeaseClock(state, clientNowMs, key, query);
        if (rollback) {
          commit(state);
          throw rollback;
        }
        if (!queryArtifactContextMatches(state, query)) {
          failDelete(
            'SNAPBACK_AUTHORIZED_LEASE_BINDING_MISMATCH',
            'retained query belongs to another app, target, or version stream',
          );
        }
        if (query.effectiveDisposition !== 'retain') {
          commit(state);
          return null;
        }
        let lease;
        try {
          lease = validateAuthorizedLease(query.lease);
          const expectation = leaseExpectation(state, key, query);
          if (
            lease.clientStoreId !== expectation.clientStoreId
            || lease.queryKey !== expectation.queryKey
            || lease.queryInstanceId !== expectation.queryInstanceId
            || lease.principalId !== expectation.principalId
            || stableJson(lease.authorization) !== stableJson(expectation.authorization)
            || lease.data.versionStream !== expectation.versionStream
            || lease.activationHash !== expectation.activationHash
            || lease.authorityInstanceId !== expectation.authorityInstanceId
            || query.accepted?.authorizedLeaseHash !== authorizedLeaseHash(lease)
          ) {
            failDelete(
              'SNAPBACK_AUTHORIZED_LEASE_BINDING_MISMATCH',
              'retained query lease no longer binds the current query authority',
            );
          }
        } catch (error) {
          if (error?.code === 'SNAPBACK_AUTHORIZED_LEASE_BINDING_MISMATCH') throw error;
          failDelete(
            'SNAPBACK_AUTHORIZED_LEASE_INVALID',
            'retained query lease is missing or malformed',
          );
        }
        if (query.clientDeadlineMs === null || clientNowMs >= query.clientDeadlineMs) {
          failDelete(
            'SNAPBACK_AUTHORIZED_LEASE_EXPIRED',
            'retained query lease expired and was deleted before read',
          );
        }
        const record = ownEntry(state.retained, key);
        if (
          !record
          || !recordMatchesExpectedRetainedScope(state, record, expected)
          || record.queryInstanceId !== query.queryInstanceId
          || record.authorityGeneration !== query.authorityGeneration
          || record.queryGeneration !== query.queryGeneration
          || record.authorizedLeaseHash !== query.accepted?.authorizedLeaseHash
        ) {
          failDelete(
            'SNAPBACK_AUTHORIZED_LEASE_BINDING_MISMATCH',
            'retained payload does not match its current authorization fence',
          );
        }
        commit(state);
        return clone({ ...record, stale: true, fence: queryFence(query) });
      });
    },

    async beginAuthorizedQueryRetirement(key, fence, expected = {}) {
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'authorized query retirement');
        const query = requireQuery(state, key, fence, 'authorized query retirement');
        query.lifecycle = 'retiring';
        const nextFence = deleteAuthorizedPayload(state, key, query);
        commit(state);
        return clone({ queryInstanceId: query.queryInstanceId, fence: nextFence });
      });
    },

    async finishAuthorizedQueryRetirement(key, queryInstanceId, expected = {}) {
      return transact((state, commit) => {
        assertExpectedAuthority(state, expected, 'authorized query retirement finalization');
        const query = ownEntry(state.queryAuthorization, key);
        if (!query || query.queryInstanceId !== queryInstanceId) return false;
        if (query.lifecycle !== 'retiring' || Object.keys(query.pendingByScope).length > 0) {
          throw clientStoreStateError(
            'SNAPBACK_AUTH_QUERY_RETIREMENT_PENDING',
            'query retirement cannot finalize while exact obligations remain',
          );
        }
        delete state.retained[key];
        delete state.queryAuthorization[key];
        commit(state);
        return true;
      });
    },

    async getRetainedQuery(key, expected = {}) {
      return transact((state) => {
        if (state.principalScope?.authMode === 'sessions') return null;
        if (!expectedAuthorityMatchesState(state, expected)) return null;
        const record = ownEntry(state.retained, key);
        if (!record || !recordMatchesExpectedRetainedScope(state, record, expected)) return null;
        return clone({ ...record, stale: true });
      });
    },

    async putRetainedQuery(key, record) {
      return transact((state, commit) => {
        if (state.principalScope?.authMode === 'sessions') {
          throw clientStoreStateError(
            'SNAPBACK_AUTHORIZED_LEASE_REQUIRED',
            'session-mode retained writes require an exact query fence and AuthorizedLease commit',
          );
        }
        assertExpectedAuthority(state, record, 'retained query write');
        const scopedRecord = state.principalScope === null
          ? record
          : { ...record, principalScope: clone(state.principalScope) };
        if (!recordMatchesCurrentRetainedScope(state, scopedRecord)) {
          throw staleStoreScopeError('retained query write');
        }
        const current = ownEntry(state.retained, key);
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
        setOwnEntry(state.retained, key, clone({ ...scopedRecord, stale: false }));
        commit(state);
        return clone(ownEntry(state.retained, key));
      });
    },

    async enqueueMutation(record) {
      return transact((state, commit) => {
        if (state.terminallyUnbound) {
          // Prefer the precise stale-capture diagnostic for a delayed bound
          // queue token. A forged/current numeric queue pair still reaches the
          // authority check and cannot write into terminally unbound custody.
          assertExpectedQueue(state, record, 'queued mutation write');
          assertExpectedAuthority(state, record, 'queued mutation write');
        } else {
          assertExpectedAuthority(state, record, 'queued mutation write');
          assertExpectedQueue(state, record, 'queued mutation write');
        }
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
      return transact((state) => {
        if (state.generation === Number.MAX_SAFE_INTEGER && !state.terminallyUnbound) {
          throw clientStoreGenerationExhaustedError();
        }
        return clone(state);
      });
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

function isExactClientAuthority(authority) {
  if (!isRecord(authority)) return false;
  if (authority.authMode !== 'dev' && authority.authMode !== 'sessions') return false;
  if (!UUID_V7_PATTERN.test(authority.authorizationStreamIncarnation ?? '')) return false;
  if (authority.kind === 'anonymous') {
    return Object.keys(authority).sort().join(',')
      === 'authMode,authorizationStreamIncarnation,kind';
  }
  return authority.kind === 'session'
    && authority.authMode === 'sessions'
    && Object.keys(authority).sort().join(',')
      === 'authMode,authorizationStreamIncarnation,kind,sessionId,userId'
    && UUID_V7_PATTERN.test(authority.sessionId ?? '')
    && UUID_V7_PATTERN.test(authority.userId ?? '');
}

function principalScopeForAuthority(authority) {
  if (!isExactClientAuthority(authority)) return null;
  return {
    authMode: authority.authMode,
    authorizationStreamIncarnation: authority.authorizationStreamIncarnation,
    userId: authority.kind === 'session' ? authority.userId : null,
  };
}

// @ref LLP 0059#participant-contract — the durable participant derives queue
//   handling from the exact predecessor/successor authorities. Callers cannot
//   opt a delete row into payload-bearing stranding.
function authorityQueueTransition(previous, next) {
  if (!isExactClientAuthority(previous) || !isExactClientAuthority(next)) {
    return {
      queueTransition: 'delete',
      transitionReason: 'authority_predecessor_unknown',
      retainPrincipalData: false,
    };
  }
  if (
    previous.authorizationStreamIncarnation
      !== next.authorizationStreamIncarnation
  ) {
    return {
      queueTransition: 'delete',
      transitionReason: 'authorization_incarnation_changed',
      retainPrincipalData: false,
    };
  }
  if (previous.authMode === 'dev' && next.authMode === 'sessions') {
    return {
      queueTransition: 'strand-redacted',
      transitionReason: 'dev_to_sessions',
      retainPrincipalData: false,
    };
  }
  if (previous.authMode === 'sessions' && next.authMode === 'dev') {
    return {
      queueTransition: 'delete',
      transitionReason: 'sessions_to_dev',
      retainPrincipalData: false,
    };
  }
  if (previous.kind === 'anonymous' && next.kind === 'session') {
    return {
      queueTransition: 'strand-redacted',
      transitionReason: 'anonymous_to_authenticated',
      retainPrincipalData: false,
    };
  }
  if (
    previous.kind === 'session'
    && next.kind === 'session'
    && previous.userId === next.userId
    && previous.sessionId !== next.sessionId
  ) {
    return {
      queueTransition: 'strand-rerecordable',
      transitionReason: 'same_principal_new_session',
      retainPrincipalData: true,
    };
  }
  return {
    queueTransition: 'delete',
    transitionReason: previous.kind === 'session' && next.kind === 'anonymous'
      ? 'authenticated_to_anonymous'
      : 'principal_changed',
    retainPrincipalData: false,
  };
}

/** Register one physical client store as the coordinator's durable participant. */
export function createSnapbackClientStoreAuthParticipant(store, {
  name = 'snapback-client-store',
} = {}) {
  if (
    !store
    || typeof store.transitionAuthority !== 'function'
    || typeof store.purgeAuthority !== 'function'
  ) {
    throw new TypeError('client-store auth participant requires a format-6 store');
  }
  return Object.freeze({
    name,
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable(context) {
      const transition = authorityQueueTransition(
        context.previousAuthority,
        context.nextAuthority,
      );
      await store.transitionAuthority({
        expectedEpoch: context.expectedEpoch,
        nextEpoch: context.nextEpoch,
        nextAuthorityKey: context.nextAuthorityKey,
        disposition: context.disposition,
        ...transition,
        nextPrincipalScope: principalScopeForAuthority(context.nextAuthority),
        terminal: context.nextAuthority === null,
      });
    },
    async commitTerminalDurable(context) {
      await store.purgeAuthority({ authorityKey: context.nextAuthorityKey });
    },
    async resume() {},
  });
}

export function createClientMutationId(prefix = 'cm') {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? newOrigin();
  return `${prefix}_${random}`;
}
