// Cross-context browser authority custody and the local exposure barrier.
//
// @ref LLP 0059#client-custody-and-authcoordinator — bearer custody is one
//   durable, serialized state machine per canonical app id and storage
//   partition; app participants never own independent current-auth state.

import { ID_PREFIXES, encodeBody, isMintedIdentifier } from './ids.mjs';

export const SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION = 2;
export const SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION = 3;
export const AUTH_DEFAULT_STORAGE_PARTITION = 'default';
export const AUTH_CUSTODY_DATABASE_NAME = 'snapback-auth-custody';
export const AUTH_CUSTODY_DATABASE_VERSION = 1;
export const AUTH_CUSTODY_LEASE_MS = 5_000;
export const AUTH_CUSTODY_LEASE_RENEW_MS = 1_000;
export const AUTH_CUSTODY_SUPERSEDED_WAIT_MS = 2_000;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUTHORITY_KEY = /^sha256:[0-9a-f]{64}$/;
const PHASES = new Set(['settled', 'clearing', 'exhausted']);
const AUTH_MODES = new Set(['dev', 'sessions']);
const SENDER_PROTOCOL = 'snapback.sender-constrained.v2';
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const SENDER_SELF_CHECK = new TextEncoder().encode('snapback.sender-custody-self-check.v1');
const DEFERRED_COUNTER_TERMINAL = Symbol('snapback.auth.deferred-counter-terminal');
const BARRIER_PHASE_CLOSURE_RETRY = 'SNAPBACK_AUTH_BARRIER_PHASE_CLOSURE_RETRY';
const INVALID_STORAGE_PARTITION = /[\s\u0000-\u001f\u007f-\u009f]/u;

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
    throw corrupt('sender-constrained custody requires structured clone support');
  }
  return JSON.parse(JSON.stringify(value));
};

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === expected.length
    && actual.every((key) => typeof key === 'string' && expected.includes(key));
}

function assertExactKeys(value, expected, path) {
  if (!hasExactKeys(value, expected)) {
    throw corrupt(`${path} has missing or unknown fields`, { field: path });
  }
}

/** Typed error shape shared by first-party auth-custody storage adapters. */
export function createAuthCustodyError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message, details };
  return error;
}

const coordinatorError = createAuthCustodyError;

const corrupt = (message, details = {}) => coordinatorError(
  'SNAPBACK_AUTH_CUSTODY_CORRUPT',
  message,
  details,
);

function assertSafeInteger(value, field, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw corrupt(`custody field ${field} is not a safe ${positive ? 'positive' : 'nonnegative'} integer`, { field });
  }
}

function nextRevision(revision) {
  assertSafeInteger(revision, 'revision', { positive: true });
  // Reserve the final safe integer for a durable terminal marker. No settled
  // authority may consume it and leave peers unable to learn that comparison
  // identities can no longer advance.
  if (revision >= MAX_SAFE - 1) {
    throw coordinatorError(
      'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
      'custody revision is exhausted and this custody is permanently closed',
      { revision },
    );
  }
  return revision + 1;
}

function durableCounterExhausted(record) {
  return coordinatorError(
    'SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED',
    'durable auth custody is permanently closed because a monotonic counter is exhausted',
    {
      authorityEpoch: record?.authorityEpoch ?? null,
      revision: record?.revision ?? null,
    },
  );
}

function isCounterExhaustion(error) {
  return error?.code === 'SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED'
    || error?.code === 'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED'
    || error?.code === 'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED';
}

function deferredCounterTerminal(terminal) {
  const signal = new Error('deferred auth custody counter terminal');
  signal[DEFERRED_COUNTER_TERMINAL] = terminal;
  return signal;
}

function deferredCounterTerminalValue(error) {
  return error?.[DEFERRED_COUNTER_TERMINAL] ?? null;
}

function isBarrierPhaseClosureRetry(error) {
  return error?.code === BARRIER_PHASE_CLOSURE_RETRY;
}

function nextAuthorityEpoch(epoch) {
  assertSafeInteger(epoch, 'authorityEpoch');
  if (epoch === MAX_SAFE) {
    throw coordinatorError(
      'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED',
      'authority epoch is exhausted and the custody store must be replaced',
      { authorityEpoch: epoch },
    );
  }
  return epoch + 1;
}

// Synchronous SHA-256 keeps capture() and authority-key comparison synchronous
// in browsers, Node, and native JS shells. Input is always UTF-8 protocol text.
function sha256Hex(input) {
  const bytes = typeof input === 'string'
    ? Array.from(new TextEncoder().encode(input))
    : Array.from(input);
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
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351,
    0x14292967, 0x27b70a85,
    0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585,
    0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa,
    0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
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
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (s0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((word) => word.toString(16).padStart(8, '0')).join('');
}

function canonicalAppId(appId) {
  if (typeof appId !== 'string' || appId.length === 0 || appId.trim() !== appId) {
    throw corrupt('canonical app id must be a non-empty, already-normalized string', { field: 'appId' });
  }
  return appId;
}

function canonicalStoragePartition(storagePartition) {
  if (
    typeof storagePartition !== 'string'
    || storagePartition.length === 0
    || INVALID_STORAGE_PARTITION.test(storagePartition)
  ) {
    throw new TypeError(
      'storagePartition must be a non-empty string without whitespace or control characters',
    );
  }
  return storagePartition;
}

/** Normalize the structured owner key, accepting a legacy app-id default. */
export function normalizeAuthCustodyOwnerKey(ownerKey) {
  if (typeof ownerKey === 'string') {
    return Object.freeze({
      appId: canonicalAppId(ownerKey),
      storagePartition: AUTH_DEFAULT_STORAGE_PARTITION,
    });
  }
  if (!ownerKey || typeof ownerKey !== 'object' || Array.isArray(ownerKey)) {
    throw new TypeError('auth custody owner key must be an app id or owner-key object');
  }
  return Object.freeze({
    appId: canonicalAppId(ownerKey.appId),
    storagePartition: canonicalStoragePartition(ownerKey.storagePartition),
  });
}

export function normalizeClientAuthority(authority) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    throw corrupt('client authority is not an object', { field: 'authority' });
  }
  const kind = authority.kind;
  if (kind !== 'anonymous' && kind !== 'session') {
    throw corrupt('client authority kind is invalid', { field: 'authority.kind' });
  }
  if (!AUTH_MODES.has(authority.authMode)) {
    throw corrupt('client authority authMode is invalid', { field: 'authority.authMode' });
  }
  if (!UUID_V7.test(authority.authorizationStreamIncarnation ?? '')) {
    throw corrupt('authorization stream incarnation is not a canonical UUIDv7', {
      field: 'authority.authorizationStreamIncarnation',
    });
  }
  if (kind === 'anonymous') {
    assertExactKeys(authority, [
      'kind',
      'authMode',
      'authorizationStreamIncarnation',
    ], 'authority');
    return {
      kind,
      authMode: authority.authMode,
      authorizationStreamIncarnation: authority.authorizationStreamIncarnation,
    };
  }
  if (authority.authMode !== 'sessions') {
    throw corrupt('session authority requires sessions mode', { field: 'authority.authMode' });
  }
  assertExactKeys(authority, [
    'kind',
    'authMode',
    'authorizationStreamIncarnation',
    'sessionId',
    'userId',
  ], 'authority');
  // @ref LLP 0148#what-implementation-surfaced — object ids accept the new
  // prefixed spelling and stored legacy UUIDv7s; the incarnation above does not.
  for (const field of ['sessionId', 'userId']) {
    if (!isMintedIdentifier(authority[field])) {
      throw corrupt(`session authority ${field} is not a Snapback identifier`, { field: `authority.${field}` });
    }
  }
  return {
    kind,
    authMode: 'sessions',
    authorizationStreamIncarnation: authority.authorizationStreamIncarnation,
    sessionId: authority.sessionId,
    userId: authority.userId,
  };
}

export function canonicalAuthorityKey(appId, authority) {
  const canonicalId = canonicalAppId(appId);
  const normalized = normalizeClientAuthority(authority);
  const ordered = normalized.kind === 'anonymous'
    ? {
        appId: canonicalId,
        kind: normalized.kind,
        authMode: normalized.authMode,
        authorizationStreamIncarnation: normalized.authorizationStreamIncarnation,
      }
    : {
        appId: canonicalId,
        kind: normalized.kind,
        authMode: normalized.authMode,
        authorizationStreamIncarnation: normalized.authorizationStreamIncarnation,
        sessionId: normalized.sessionId,
        userId: normalized.userId,
      };
  return `sha256:${sha256Hex(`snapback.auth-authority.v1\n${JSON.stringify(ordered)}`)}`;
}

// Agent custody has a durable grant-tuple axis distinct from browser session
// custody. Keep this synchronous so headless clients can capture/fence work at
// the call boundary in browsers, Node, and native JS shells.
//
// @ref LLP 0055#grant-backed-live-and-queued-replay — token id and carrier
// generation deliberately do not participate in durable queued-replay identity.
export function canonicalAgentAuthorityKey({
  actorUserId,
  credentialId,
  credentialGeneration,
  grantId,
} = {}) {
  // @ref LLP 0148#d4-the-prefix-is-never-load-bearing — grant tuple ids use
  // the shared shape predicate; no authority decision branches on a prefix.
  for (const [field, value] of [
    ['actorUserId', actorUserId],
    ['credentialId', credentialId],
    ['grantId', grantId],
  ]) {
    if (!isMintedIdentifier(value)) {
      throw new TypeError(`${field} must be a Snapback identifier`);
    }
  }
  if (!Number.isSafeInteger(credentialGeneration) || credentialGeneration < 0) {
    throw new TypeError('credentialGeneration must be a non-negative safe integer');
  }
  const ordered = {
    actorUserId,
    credentialId,
    credentialGeneration,
    grantId,
  };
  return `sha256:${sha256Hex(`snapback.agent-authority.v1\n${JSON.stringify(ordered)}`)}`;
}

// Exact JS twin of src/auth/descriptor.rs::service_authority_instance_id.
// The server descriptor is opaque, but deriving it on the custody side keeps
// a crossed grant/credential handshake from binding queued work to the wrong
// durable authority before replay discovers the mismatch.
export function deriveServiceAuthorityInstanceId({
  actorUserId,
  credentialId,
  credentialGeneration,
  grantId,
} = {}) {
  // Reuse the durable-tuple validator before constructing the descriptor.
  canonicalAgentAuthorityKey({
    actorUserId,
    credentialId,
    credentialGeneration,
    grantId,
  });
  const encoder = new TextEncoder();
  const bytes = [...encoder.encode('snapback.service-authority.v1')];
  const appendU64 = (value) => {
    let remaining = BigInt(value);
    const encoded = new Array(8);
    for (let index = 7; index >= 0; index -= 1) {
      encoded[index] = Number(remaining & 0xffn);
      remaining >>= 8n;
    }
    bytes.push(...encoded);
  };
  for (const value of [actorUserId, credentialId, grantId]) {
    const encoded = [...encoder.encode(value)];
    appendU64(encoded.length);
    bytes.push(...encoded);
  }
  appendU64(credentialGeneration);
  // Derived, not minted: the id body is the digest prefix as-is, spelled
  // through the LLP 0148 registry so a service authority instance reads like
  // the session arm's `aut_` id. The UUID version/variant bits this used to
  // stamp described a shape it no longer produces.
  //
  // Must stay byte-identical to `service_authority_instance_id` in
  // src/auth/descriptor.rs; agent-authority-contract.test.mjs pins the vector.
  const digest = sha256Hex(bytes);
  const body = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    body[index] = Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16);
  }
  return `${ID_PREFIXES.authorityInstance}_${encodeBody(body)}`;
}

export function authAppIdHash(appId) {
  return sha256Hex(`snapback.auth-app.v1\n${canonicalAppId(appId)}`);
}

/** Stable namespace digest for a full auth-custody owner key. */
export function authCustodyOwnerKeyHash(ownerKey) {
  const normalized = normalizeAuthCustodyOwnerKey(ownerKey);
  return sha256Hex(`snapback.auth-owner.v1\n${JSON.stringify({
    appId: normalized.appId,
    storagePartition: normalized.storagePartition,
  })}`);
}

function validateRefreshTime(value, field = 'refreshAfterMs') {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw corrupt(`custody field ${field} is not a safe nonnegative integer timestamp or null`, { field });
  }
}

function sameClientAuthority(left, right) {
  return left.kind === right.kind
    && left.authMode === right.authMode
    && left.authorizationStreamIncarnation === right.authorizationStreamIncarnation
    && (left.kind !== 'session' || (
      left.sessionId === right.sessionId
      && left.userId === right.userId
    ));
}

function transitionIdFor(
  appId,
  predecessorRevision,
  nextEpoch,
  nextAuthorityKey,
  senderConstraintThumbprint = undefined,
) {
  const domain = senderConstraintThumbprint === undefined
    ? `snapback.auth-transition.v1\n${appId}\n${predecessorRevision}\n${nextEpoch}\n${nextAuthorityKey}`
    : `snapback.auth-transition.v2\n${appId}\n${predecessorRevision}\n${nextEpoch}\n${nextAuthorityKey}\n${senderConstraintThumbprint ?? 'delete'}`;
  return `sha256:${sha256Hex(domain)}`;
}

function validateTransitionIntent(value, appId) {
  if (value === null) return null;
  const commonKeys = [
    'formatVersion',
    'transitionId',
    'expectedEpoch',
    'expectedAuthorityKey',
    'nextEpoch',
    'nextAuthorityKey',
    'reason',
    'disposition',
    'previousAuthority',
    'nextAuthority',
  ];
  assertExactKeys(
    value,
    value?.formatVersion === 2 ? [...commonKeys, 'senderConstraintThumbprint'] : commonKeys,
    'custody.transitionIntent',
  );
  if (![1, 2].includes(value.formatVersion) || !AUTHORITY_KEY.test(value.transitionId ?? '')) {
    throw corrupt('custody transition intent version or identifier is invalid');
  }
  if (
    value.formatVersion === 2
    && value.senderConstraintThumbprint !== null
    && !BASE64URL_32.test(value.senderConstraintThumbprint ?? '')
  ) {
    throw corrupt('custody transition intent sender constraint is invalid');
  }
  assertSafeInteger(value.expectedEpoch, 'transitionIntent.expectedEpoch');
  assertSafeInteger(value.nextEpoch, 'transitionIntent.nextEpoch', { positive: true });
  if (value.nextEpoch !== value.expectedEpoch + 1) throw corrupt('custody transition epochs are not consecutive');
  if (!AUTHORITY_KEY.test(value.expectedAuthorityKey ?? '') || !AUTHORITY_KEY.test(value.nextAuthorityKey ?? '')) {
    throw corrupt('custody transition authority keys are invalid');
  }
  if (typeof value.reason !== 'string' || value.reason.length === 0 || !['delete', 'preserve'].includes(value.disposition)) {
    throw corrupt('custody transition policy is invalid');
  }
  const previousAuthority = normalizeClientAuthority(value.previousAuthority);
  const nextAuthority = normalizeClientAuthority(value.nextAuthority);
  if (
    canonicalAuthorityKey(appId, previousAuthority) !== value.expectedAuthorityKey
    || canonicalAuthorityKey(appId, nextAuthority) !== value.nextAuthorityKey
  ) {
    throw corrupt('custody transition intent authority keys do not bind their embedded authorities');
  }
  return clone({ ...value, previousAuthority, nextAuthority });
}

function canonicalSenderPublicJwk(value, field) {
  assertExactKeys(value, ['crv', 'kty', 'x', 'y'], field);
  if (
    value.crv !== 'P-256'
    || value.kty !== 'EC'
    || !BASE64URL_32.test(value.x ?? '')
    || !BASE64URL_32.test(value.y ?? '')
  ) {
    throw corrupt(`custody field ${field} is not a canonical P-256 public JWK`, { field });
  }
  return { crv: 'P-256', kty: 'EC', x: value.x, y: value.y };
}

function validateSenderNonce(value, field) {
  assertExactKeys(value, ['value', 'generation', 'expiresAtMs'], field);
  if (!BASE64URL_32.test(value.value ?? '')) {
    throw corrupt(`custody field ${field}.value is not a canonical 32-byte nonce`, { field });
  }
  assertSafeInteger(value.generation, `${field}.generation`, { positive: true });
  assertSafeInteger(value.expiresAtMs, `${field}.expiresAtMs`, { positive: true });
  return clone(value);
}

function validateSenderPrivateKey(value, field) {
  const CryptoKeyClass = globalThis.CryptoKey;
  if (
    typeof CryptoKeyClass !== 'function'
    || !(value instanceof CryptoKeyClass)
    || value.type !== 'private'
    || value.extractable !== false
    || value.algorithm?.name !== 'ECDSA'
    || value.algorithm?.namedCurve !== 'P-256'
    || value.usages?.length !== 1
    || value.usages[0] !== 'sign'
  ) {
    throw corrupt(`custody field ${field} is not a non-extractable P-256 signing key`, { field });
  }
  return value;
}

function validateSenderConstraint(value, field) {
  if (value === null) return null;
  assertExactKeys(value, [
    'formatVersion',
    'protocol',
    'custodyGeneration',
    'privateKey',
    'publicJwk',
    'thumbprint',
    'nonce',
  ], field);
  if (value.formatVersion !== 1 || value.protocol !== SENDER_PROTOCOL) {
    throw corrupt(`custody field ${field} has an unsupported sender protocol`, { field });
  }
  assertSafeInteger(value.custodyGeneration, `${field}.custodyGeneration`, { positive: true });
  const privateKey = validateSenderPrivateKey(value.privateKey, `${field}.privateKey`);
  const publicJwk = canonicalSenderPublicJwk(value.publicJwk, `${field}.publicJwk`);
  if (!BASE64URL_32.test(value.thumbprint ?? '')) {
    throw corrupt(`custody field ${field}.thumbprint is invalid`, { field });
  }
  const nonce = validateSenderNonce(value.nonce, `${field}.nonce`);
  return {
    formatVersion: 1,
    protocol: SENDER_PROTOCOL,
    custodyGeneration: value.custodyGeneration,
    privateKey,
    publicJwk,
    thumbprint: value.thumbprint,
    nonce,
  };
}

// @ref LLP 0077#browser-custody — a stored non-extractable handle is accepted
// only when a live signature binds it to the exact public JWK and thumbprint.
export async function validateAuthCustodySenderKeys(record, expectedAppId = null) {
  const validated = validateAuthCustody(record, expectedAppId);
  const constraints = [validated.senderConstraint, validated.pendingSenderConstraint]
    .filter((value) => value !== null && value !== undefined);
  const subtle = globalThis.crypto?.subtle;
  if (constraints.length > 0 && !subtle) {
    throw corrupt('sender-constrained custody requires WebCrypto');
  }
  for (const constraint of constraints) {
    const digest = new Uint8Array(await subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(constraint.publicJwk)),
    ));
    let binary = '';
    for (const byte of digest) binary += String.fromCharCode(byte);
    const thumbprint = btoa(binary)
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/u, '');
    if (thumbprint !== constraint.thumbprint) {
      throw corrupt('sender-constrained custody thumbprint does not bind its public key');
    }
    let publicKey;
    try {
      publicKey = await subtle.importKey(
        'jwk',
        { ...constraint.publicJwk, ext: true, key_ops: ['verify'] },
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify'],
      );
      const signature = await subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        constraint.privateKey,
        SENDER_SELF_CHECK,
      );
      if (
        new Uint8Array(signature).byteLength !== 64
        || !await subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          publicKey,
          signature,
          SENDER_SELF_CHECK,
        )
      ) throw new Error('key mismatch');
    } catch {
      throw corrupt('sender-constrained custody private and public keys do not match');
    }
  }
  return validated;
}

export function validateAuthCustody(record, expectedAppId = null) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw corrupt('durable custody is not an object');
  }
  const commonKeys = [
    'formatVersion',
    'appId',
    'authorityEpoch',
    'revision',
    'phase',
    'authority',
    'pendingAuthority',
    'bearer',
    'pendingBearer',
    'refreshAfterMs',
    'transitionIntent',
  ];
  const senderFormat = record.formatVersion === SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION;
  assertExactKeys(
    record,
    senderFormat ? [...commonKeys, 'senderConstraint', 'pendingSenderConstraint'] : commonKeys,
    'custody',
  );
  if (
    record.formatVersion !== SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION
    && !senderFormat
  ) {
    throw corrupt('durable custody format version is unsupported', {
      storedVersion: record.formatVersion ?? null,
      supportedVersions: [
        SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
        SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION,
      ],
    });
  }
  const appId = canonicalAppId(record.appId);
  if (expectedAppId !== null && appId !== expectedAppId) {
    throw corrupt('durable custody belongs to another app', { expectedAppId, actualAppId: appId });
  }
  assertSafeInteger(record.authorityEpoch, 'authorityEpoch');
  assertSafeInteger(record.revision, 'revision', { positive: true });
  if (!PHASES.has(record.phase)) throw corrupt('durable custody phase is invalid', { field: 'phase' });
  validateRefreshTime(record.refreshAfterMs);
  // @ref LLP 0059#durable-custody-record — a peer may execute destructive
  // physical-store phases from this intent, so every embedded authority/key
  // pair and the containing successor must be one closed durable statement.
  const transitionIntent = validateTransitionIntent(record.transitionIntent, appId);
  const authority = record.authority === null ? null : normalizeClientAuthority(record.authority);
  const pendingAuthority = record.pendingAuthority === null
    ? null
    : normalizeClientAuthority(record.pendingAuthority);
  const senderConstraint = senderFormat
    ? validateSenderConstraint(record.senderConstraint, 'senderConstraint')
    : null;
  const pendingSenderConstraint = senderFormat
    ? validateSenderConstraint(record.pendingSenderConstraint, 'pendingSenderConstraint')
    : null;
  const bearerValid = (value) => value === null || (typeof value === 'string' && value.length > 0);
  if (!bearerValid(record.bearer) || !bearerValid(record.pendingBearer)) {
    throw corrupt('custody bearer fields must be non-empty strings or null');
  }
  if (record.phase === 'exhausted') {
    if (
      authority !== null
      || pendingAuthority !== null
      || record.bearer !== null
      || record.pendingBearer !== null
      || record.refreshAfterMs !== null
      || transitionIntent !== null
      || senderConstraint !== null
      || pendingSenderConstraint !== null
    ) {
      throw corrupt('exhausted custody must contain no publishable authority or credential state');
    }
  } else if (record.phase === 'settled') {
    if (
      authority === null
      || pendingAuthority !== null
      || record.pendingBearer !== null
      || pendingSenderConstraint !== null
    ) {
      throw corrupt('settled custody has inconsistent current or pending fields');
    }
    if (
      authority.kind === 'anonymous'
      && (record.bearer !== null || record.refreshAfterMs !== null || senderConstraint !== null)
    ) {
      throw corrupt('anonymous settled custody cannot contain bearer custody or a refresh time');
    }
    if (authority.kind === 'session' && (record.bearer === null || record.refreshAfterMs === null)) {
      throw corrupt('session settled custody requires a bearer and refresh time');
    }
    if (senderFormat && authority.kind === 'session' && senderConstraint === null) {
      throw corrupt('sender custody session requires its sender constraint');
    }
    if (transitionIntent !== null && (
      transitionIntent.nextEpoch !== record.authorityEpoch
      || transitionIntent.nextAuthorityKey !== canonicalAuthorityKey(appId, authority)
      || !sameClientAuthority(transitionIntent.nextAuthority, authority)
    )) {
      throw corrupt('settled custody does not match its retained transition successor');
    }
    if (
      senderFormat
      && transitionIntent !== null
      && (
        transitionIntent.formatVersion !== 2
        || transitionIntent.senderConstraintThumbprint !== senderConstraint?.thumbprint
      )
    ) {
      throw corrupt('settled sender custody does not match its retained transition constraint');
    }
    const maximumEpochWithExactMinimumRevision = Math.floor((Number.MAX_SAFE_INTEGER - 1) / 2);
    const minimumSettledRevision = record.authorityEpoch <= maximumEpochWithExactMinimumRevision
      ? (record.authorityEpoch * 2) + 1
      : null;
    if (
      transitionIntent !== null
      && record.revision === minimumSettledRevision
      && transitionIntent.transitionId !== transitionIdFor(
        appId,
        record.revision - 2,
        transitionIntent.nextEpoch,
        transitionIntent.nextAuthorityKey,
        transitionIntent.formatVersion === 2
          ? transitionIntent.senderConstraintThumbprint
          : undefined,
      )
    ) {
      throw corrupt('settled custody transition identifier does not match its derivable predecessor');
    }
  } else {
    if (record.authorityEpoch < 1) {
      throw corrupt('clearing custody must advance to a positive authority epoch', {
        field: 'authorityEpoch',
      });
    }
    if (
      authority !== null
      || record.bearer !== null
      || senderConstraint !== null
      || pendingAuthority === null
    ) {
      throw corrupt('clearing custody has inconsistent current or pending fields');
    }
    if (
      transitionIntent === null
      || transitionIntent.nextEpoch !== record.authorityEpoch
      || transitionIntent.nextAuthorityKey !== canonicalAuthorityKey(appId, pendingAuthority)
      || !sameClientAuthority(transitionIntent.nextAuthority, pendingAuthority)
    ) throw corrupt('clearing custody lacks its exact durable transition intent');
    const predecessorRevision = record.revision - 1;
    if (
      predecessorRevision < 1
      || transitionIntent.transitionId !== transitionIdFor(
        appId,
        predecessorRevision,
        transitionIntent.nextEpoch,
        transitionIntent.nextAuthorityKey,
        transitionIntent.formatVersion === 2
          ? transitionIntent.senderConstraintThumbprint
          : undefined,
      )
    ) {
      // The clearing revision is exactly one greater than its settled
      // predecessor, so the transition identifier is derivable here. A
      // retained settled intent may survive later bearer-only revisions and
      // therefore cannot recover the original predecessor revision.
      throw corrupt('clearing custody transition identifier does not match its durable predecessor');
    }
    if (pendingAuthority.kind === 'anonymous' && (record.pendingBearer !== null || record.refreshAfterMs !== null)) {
      throw corrupt('anonymous clearing successor cannot contain bearer custody or a refresh time');
    }
    if (pendingAuthority.kind === 'session' && (record.pendingBearer === null || record.refreshAfterMs === null)) {
      throw corrupt('session clearing successor requires a bearer and refresh time');
    }
    if (senderFormat) {
      if (
        transitionIntent.formatVersion !== 2
        || transitionIntent.senderConstraintThumbprint !== (pendingSenderConstraint?.thumbprint ?? null)
      ) {
        throw corrupt('sender custody clearing intent does not bind its pending sender constraint', {
          intentThumbprint: transitionIntent.senderConstraintThumbprint ?? null,
          pendingThumbprint: pendingSenderConstraint?.thumbprint ?? null,
        });
      }
      if (pendingAuthority.kind === 'session' && pendingSenderConstraint === null) {
        throw corrupt('sender custody session successor requires its pending sender constraint');
      }
      if (pendingAuthority.kind === 'anonymous' && pendingSenderConstraint !== null) {
        throw corrupt('anonymous clearing successor cannot contain a sender constraint');
      }
    }
  }
  if (record.phase !== 'exhausted' && record.revision === MAX_SAFE) {
    throw coordinatorError(
      'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
      'a non-terminal custody record consumed the final revision and is permanently closed',
      { authorityEpoch: record.authorityEpoch, revision: record.revision },
    );
  }
  return clone({
    formatVersion: record.formatVersion,
    appId,
    authorityEpoch: record.authorityEpoch,
    revision: record.revision,
    phase: record.phase,
    authority,
    pendingAuthority,
    bearer: record.bearer,
    pendingBearer: record.pendingBearer,
    refreshAfterMs: record.refreshAfterMs,
    transitionIntent,
    ...(senderFormat ? {
      senderConstraint,
      pendingSenderConstraint,
    } : {}),
  });
}

/** Validate one durable replacement against the canonical counter invariants. */
export function validateAuthCustodyReplacement(previous, next, expectedAppId) {
  const validated = validateAuthCustody(next, expectedAppId);
  if (previous === null) {
    if (validated.revision !== 1 || validated.authorityEpoch !== 0) {
      throw corrupt('fresh custody must begin at epoch 0 and revision 1');
    }
    return validated;
  }
  const current = validateAuthCustody(previous, expectedAppId);
  if (current.revision === MAX_SAFE || validated.revision !== current.revision + 1) {
    throw corrupt('custody replacement did not increment revision exactly once');
  }
  if (
    validated.authorityEpoch < current.authorityEpoch
    || validated.authorityEpoch > current.authorityEpoch + 1
  ) {
    throw corrupt('custody replacement regressed or skipped authority epoch');
  }
  return validated;
}

async function normalizeSuccessor(successor) {
  const candidate = successor?.authority ? successor : { authority: successor };
  const authority = normalizeClientAuthority(candidate.authority);
  const bearer = candidate.bearer ?? null;
  const refreshAfterMs = candidate.refreshAfterMs ?? null;
  validateRefreshTime(refreshAfterMs, 'successor.refreshAfterMs');
  if (authority.kind === 'anonymous') {
    if (bearer !== null || refreshAfterMs !== null) {
      throw corrupt('anonymous successor cannot contain a bearer or refresh time');
    }
  } else if (typeof bearer !== 'string' || bearer.length === 0 || refreshAfterMs === null) {
    throw corrupt('session successor requires a non-empty bearer and refresh time');
  }
  const senderConstraint = candidate.senderConstraint === undefined
    ? null
    : validateSenderConstraint(candidate.senderConstraint, 'successor.senderConstraint');
  if (authority.kind === 'anonymous' && senderConstraint !== null) {
    throw corrupt('anonymous successor cannot contain a sender constraint');
  }
  if (senderConstraint !== null) {
    await validateAuthCustodySenderKeys({
      formatVersion: SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION,
      appId: 'snapback.internal/sender-successor-validation',
      authorityEpoch: 0,
      revision: 1,
      phase: 'settled',
      authority,
      pendingAuthority: null,
      bearer,
      pendingBearer: null,
      refreshAfterMs,
      transitionIntent: null,
      senderConstraint,
      pendingSenderConstraint: null,
    });
  }
  return { authority, bearer, refreshAfterMs, senderConstraint };
}

function captureFor(appId, record) {
  if (record.phase !== 'settled') {
    throw coordinatorError(
      'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
      'authority custody is clearing; app-visible work is paused',
      { authorityEpoch: record.authorityEpoch },
    );
  }
  return Object.freeze({
    authorityEpoch: record.authorityEpoch,
    custodyRevision: record.revision,
    authorityKey: canonicalAuthorityKey(appId, record.authority),
  });
}

function captureMatches(appId, record, capture, { revision = false } = {}) {
  if (!record || record.phase !== 'settled' || !capture) return false;
  if (record.authorityEpoch !== capture.authorityEpoch) return false;
  if (canonicalAuthorityKey(appId, record.authority) !== capture.authorityKey) return false;
  return !revision || record.revision === capture.custodyRevision;
}

/** Build one operation-scoped owner view that becomes unusable after release. */
export function createSerialOwner(readRecord, replaceRecord) {
  let active = true;
  return {
    read: async () => {
      if (!active) throw coordinatorError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'custody ownership was released');
      return clone(await readRecord());
    },
    replace: async (expectedRevision, next) => {
      if (!active) throw coordinatorError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'custody ownership was released');
      return clone(await replaceRecord(expectedRevision, clone(next)));
    },
    release: () => { active = false; },
  };
}

const memoryLocks = new WeakMap();

function memoryLockFor(state, ownerAddress) {
  let locks = memoryLocks.get(state);
  if (!locks) {
    locks = new Map();
    memoryLocks.set(state, locks);
  }
  let lock = locks.get(ownerAddress);
  if (!lock) {
    lock = { tail: Promise.resolve() };
    locks.set(ownerAddress, lock);
  }
  return lock;
}

function memoryOwnerAddress(state, input) {
  const ownerKey = normalizeAuthCustodyOwnerKey(input);
  if (ownerKey.storagePartition === AUTH_DEFAULT_STORAGE_PARTITION) {
    // @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback — adapters address records by the full owner key (appId, storagePartition); the default partition retains the legacy app-id map key.
    return {
      ownerKey,
      records: state.custody,
      recordKey: ownerKey.appId,
      lockKey: `default:${ownerKey.appId}`,
    };
  }
  if (!state.partitionedCustody) state.partitionedCustody = {};
  if (typeof state.partitionedCustody !== 'object' || Array.isArray(state.partitionedCustody)) {
    throw new TypeError('memory custody partition state must be an object');
  }
  const partitionKey = authCustodyOwnerKeyHash(ownerKey);
  return {
    ownerKey,
    records: state.partitionedCustody,
    recordKey: partitionKey,
    lockKey: `partition:${partitionKey}`,
  };
}

/** Deterministic transactional custody storage for unit tests and native shims. */
export function createMemoryAuthCustodyStorage({ state = { custody: {} } } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('createMemoryAuthCustodyStorage requires a shared state object');
  }
  if (!state.custody) state.custody = {};
  return {
    ownerKeyCapability: 'owner-key-v1',
    async withOwnership(ownerKeyInput, operation) {
      const address = memoryOwnerAddress(state, ownerKeyInput);
      const { appId } = address.ownerKey;
      const lock = memoryLockFor(state, address.lockKey);
      let release;
      const prior = lock.tail;
      lock.tail = new Promise((resolve) => { release = resolve; });
      await prior;
      const owner = createSerialOwner(
        () => Object.hasOwn(address.records, address.recordKey)
          ? address.records[address.recordKey]
          : null,
        async (expectedRevision, next) => {
          const current = Object.hasOwn(address.records, address.recordKey)
            ? address.records[address.recordKey]
            : null;
          const actualRevision = current?.revision ?? null;
          if (actualRevision !== expectedRevision) {
            throw coordinatorError(
              'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
              'durable custody changed before compare-and-swap',
              { expectedRevision, actualRevision },
            );
          }
          const validated = await validateAuthCustodySenderKeys(next, appId);
          const previous = current === null
            ? null
            : await validateAuthCustodySenderKeys(current, appId);
          const replacement = validateAuthCustodyReplacement(previous, validated, appId);
          Object.defineProperty(address.records, address.recordKey, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: clone(replacement),
          });
          return replacement;
        },
      );
      try {
        return await operation(owner);
      } finally {
        owner.release();
        release();
      }
    },
    snapshot(ownerKeyInput) {
      const address = memoryOwnerAddress(state, ownerKeyInput);
      return clone(Object.hasOwn(address.records, address.recordKey)
        ? address.records[address.recordKey]
        : null);
    },
  };
}

function participantMethod(participant, method, context) {
  const fn = participant?.[method];
  if (typeof fn !== 'function') return method === 'blank' || method === 'clearMemory' ? undefined : Promise.resolve();
  return fn.call(participant, context);
}

function barrierCompletion() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/**
 * One context's view of the shared custody state and its ordered local barrier.
 * Storage is injected so tests, browsers, and native shells use the same state
 * machine without pretending localStorage is an atomic authority source.
 */
export class AuthCoordinator {
  #appId;
  #appIdHash;
  #storagePartition;
  #storageOwnerKey;
  #channelNamespace;
  #storage;
  #record = null;
  #participants = [];
  #participantSequence = 0;
  #broadcast = null;
  #hintStorage = null;
  #publicationPaused = true;
  #activeBarrier = null;
  #closed = false;
  #synchronizing = null;
  #inCommit = false;
  #counterExhaustionError = null;
  #counterExhaustionSettlement = null;
  #exhaustedWakeupCut = null;
  #activeCutCompletions = new Set();
  #destructiveCutGeneration = 0;

  constructor({
    appId,
    storagePartition = AUTH_DEFAULT_STORAGE_PARTITION,
    storage,
    broadcastChannelFactory = globalThis.BroadcastChannel
      ? (name) => new globalThis.BroadcastChannel(name)
      : null,
    hintStorage = globalThis.localStorage ?? null,
  }) {
    const ownerKey = normalizeAuthCustodyOwnerKey({ appId, storagePartition });
    this.#appId = ownerKey.appId;
    this.#appIdHash = authAppIdHash(this.#appId);
    this.#storagePartition = ownerKey.storagePartition;
    this.#storageOwnerKey = this.#storagePartition === AUTH_DEFAULT_STORAGE_PARTITION
      ? this.#appId
      : ownerKey;
    // @ref LLP 0258#d2-one-bootstrap-owner-constructs-the-auth-bearing-application-client — partitioned owners cannot share wakeup namespaces, while the default owner retains the shipped channel and hint names.
    this.#channelNamespace = this.#storagePartition === AUTH_DEFAULT_STORAGE_PARTITION
      ? this.#appIdHash
      : `partition:${authCustodyOwnerKeyHash(ownerKey)}`;
    if (!storage || typeof storage.withOwnership !== 'function') {
      throw new TypeError('AuthCoordinator requires transactional custody storage');
    }
    if (
      this.#storagePartition !== AUTH_DEFAULT_STORAGE_PARTITION
      && storage.ownerKeyCapability !== 'owner-key-v1'
    ) {
      throw createAuthCustodyError(
        'SNAPBACK_AUTH_CUSTODY_OWNER_KEY_UNSUPPORTED',
        'non-default storagePartition requires owner-key-v1 custody storage',
        { storagePartition: this.#storagePartition },
      );
    }
    this.#storage = storage;
    this.#hintStorage = hintStorage;
    if (broadcastChannelFactory) {
      this.#broadcast = broadcastChannelFactory(`snapback-auth-custody:${this.#channelNamespace}`);
      if (this.#broadcast) {
        this.#broadcast.onmessage = (event) => this.#receiveWakeup(event?.data);
      }
    }
  }

  get appId() { return this.#appId; }

  get storagePartition() { return this.#storagePartition; }

  get phase() { return this.#counterExhaustionError ? 'exhausted' : (this.#record?.phase ?? 'blank'); }

  get authority() {
    if (this.#counterExhaustionError || this.#record?.phase !== 'settled') return null;
    // The durable authority is deliberately a smaller, exact record than the
    // public projection. Derive the convenience authentication fact at this
    // read boundary so custody written by older clients remains valid and an
    // anonymous transition (including logout) is unambiguous to app code.
    return {
      ...clone(this.#record.authority),
      isAuthenticated: this.#record.authority.kind === 'session',
    };
  }

  capture() {
    this.#assertUsable();
    if (this.#inCommit) {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT',
        'coordinator operations are forbidden inside compareAndCommit',
      );
    }
    if (this.#publicationPaused || this.#record === null) {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
        'authority custody is not settled for app-visible work',
      );
    }
    return captureFor(this.#appId, this.#record);
  }

  isCurrent(capture) {
    return !this.#closed
      && this.#counterExhaustionError === null
      && !this.#publicationPaused
      && captureMatches(this.#appId, this.#record, capture);
  }

  settledView() {
    const capture = this.capture();
    return Object.freeze({
      ...capture,
      authority: clone(this.#record.authority),
      refreshAfterMs: this.#record.refreshAfterMs,
    });
  }

  /** Narrow transport read used during the post-settle resume barrier. */
  credentialFor(capture) {
    this.#assertUsable();
    if (!captureMatches(this.#appId, this.#record, capture)) {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_STALE',
        'credential capture does not name current settled custody',
      );
    }
    return Object.freeze({
      authority: clone(this.#record.authority),
      bearer: this.#record.bearer,
      refreshAfterMs: this.#record.refreshAfterMs,
      revision: this.#record.revision,
    });
  }

  /**
   * Internal v2 transport read: bearer, proof key, and nonce share one capture.
   * @ref LLP 0077#browser-custody — transport inputs come from one exact
   * custody revision rather than independently readable side records.
   */
  senderCredentialFor(capture) {
    this.#assertUsable();
    if (!captureMatches(this.#appId, this.#record, capture, { revision: true })) {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_STALE',
        'sender credential capture does not name the current custody revision',
      );
    }
    if (
      this.#record.formatVersion !== SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION
      || this.#record.authority.kind !== 'session'
      || this.#record.senderConstraint === null
    ) {
      throw coordinatorError(
        'SNAPBACK_AUTH_SENDER_CUSTODY_REQUIRED',
        'current custody is not a sender-constrained session',
      );
    }
    return Object.freeze({
      authority: clone(this.#record.authority),
      bearer: this.#record.bearer,
      refreshAfterMs: this.#record.refreshAfterMs,
      revision: this.#record.revision,
      senderConstraint: clone(this.#record.senderConstraint),
    });
  }

  /** Establish a fresh store only from a successful anonymous handshake. */
  async establishAnonymous(authority) {
    this.#assertOperationAllowed();
    if (this.#activeBarrier !== null || this.#record !== null) {
      throw coordinatorError(
        this.#publicationPaused
          ? 'SNAPBACK_CLIENT_AUTHORITY_CLEARING'
          : 'SNAPBACK_CLIENT_AUTHORITY_STALE',
        'anonymous custody bootstrap cannot replace or reopen existing local custody',
      );
    }
    const normalized = normalizeClientAuthority(authority);
    if (normalized.kind !== 'anonymous') {
      throw coordinatorError(
        'SNAPBACK_AUTH_CUSTODY_BOOTSTRAP_INVALID',
        'fresh custody may be established only from an anonymous server handshake',
      );
    }
    this.#assertParticipantRegistrationsReady();
    const owned = await this.#withOwnership(async (owner) => {
      const existing = await this.#readOwned(owner);
      if (existing !== null) {
        // @ref LLP 0059#transition-barrier — establishAnonymous is creation,
        // never an adoption/recovery shortcut that can reopen a paused gate.
        throw coordinatorError(
          'SNAPBACK_CLIENT_AUTHORITY_STALE',
          'durable custody already exists; synchronize before using it',
        );
      }
      const record = await owner.replace(null, {
        formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
        appId: this.#appId,
        authorityEpoch: 0,
        revision: 1,
        phase: 'settled',
        authority: normalized,
        pendingAuthority: null,
        bearer: null,
        pendingBearer: null,
        refreshAfterMs: null,
        transitionIntent: null,
      });
      this.#publish(record);
      if (this.#activeBarrier !== null || this.#record !== null) {
        throw coordinatorError(
          'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
          'local custody changed while anonymous bootstrap was being created',
        );
      }
      this.#assertParticipantRegistrationsReady();
      this.#adoptSettled(record);
      return captureFor(this.#appId, record);
    });
    return this.#resumeAfterOwnership(owned);
  }

  /** Mandatory lifecycle/publication gate; reloads durable custody under ownership. */
  async synchronize() {
    this.#assertUsable();
    if (this.#inCommit) {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT',
        'coordinator operations are forbidden inside compareAndCommit',
      );
    }
    const eagerCut = this.#exhaustedWakeupCut;
    if (eagerCut !== null) await eagerCut;
    this.#assertOperationAllowed();
    const activeClearing = this.#record?.phase === 'clearing'
      ? this.#activeBarrier
      : null;
    const insideParticipantCallback = this.#participants.some((entry) => (
      entry.invocationDepth > 0
    ));
    if (activeClearing !== null && !insideParticipantCallback) {
      // A clearing publication can wake client machinery that treats the
      // prompt CLEARING result as retryable. Joining the installed terminal
      // completion gives that caller one progress-making wait instead of an
      // unbounded promise-microtask retry loop. Participant callbacks are the
      // exception: quiesce may await work that reaches synchronize(), so a
      // callback must continue to the owned exact-clearing refusal below
      // rather than wait on the barrier that is waiting on that callback.
      // @ref LLP 0059#cross-context-ownership — external clearing observers
      // join settlement; participant reentry refuses promptly without
      // reintroducing ownership across participant work.
      await activeClearing.completion.promise;
      this.#assertOperationAllowed();
      return this.synchronize();
    }
    if (this.#activeBarrier?.phase === 'resume' && this.#record?.phase === 'settled') {
      // A resume participant may be inside either an owner transition or the
      // outer synchronize operation. Starting peer adoption here would replace
      // the active barrier; awaiting the same synchronize promise would
      // deadlock it. Re-read under ownership and accept only the exact settled
      // record the closed local barrier is already adopting. A concurrent
      // successor aborts this resume and remains closed for a later clean
      // synchronization.
      // @ref LLP 0059#cross-context-ownership — reentrant resume checks share
      // no in-memory authority assumption and cannot start a nested barrier.
      try {
        return await this.#withOwnership(async (owner) => {
          const durable = await this.#readOwned(owner);
          if (durable === null) {
            throw corrupt('durable custody disappeared during local barrier resume');
          }
          const exact = durable.phase === 'settled'
            && durable.revision === this.#record.revision
            && durable.authorityEpoch === this.#record.authorityEpoch
            && canonicalAuthorityKey(this.#appId, durable.authority)
              === canonicalAuthorityKey(this.#appId, this.#record.authority);
          if (!exact) {
            throw coordinatorError(
              'SNAPBACK_CLIENT_AUTHORITY_STALE',
              'durable authority changed during local barrier resume',
            );
          }
          return captureFor(this.#appId, durable);
        });
      } catch (error) {
        // The active owner/peer barrier is already blank. Keep its publication
        // gate closed and let the surrounding resume path perform the complete
        // reblank/settlement choreography.
        await this.#failClosedAfterConfirmation('resume_synchronization_read_failed', error);
        throw error;
      }
    }
    if (this.#synchronizing) return this.#synchronizing;
    const work = (async () => {
      let owned;
      try {
        owned = await this.#withOwnership(async (owner) => {
          const record = await this.#readOwned(owner);
          if (record === null) {
            if (this.#record !== null) {
              throw corrupt('durable custody disappeared during synchronization');
            }
            this.#publicationPaused = true;
            return null;
          }
          const validated = record;
          if (validated.phase === 'clearing') {
            if (this.#activeBarrier !== null) {
              const sameLocalClearing = this.#record?.phase === 'clearing'
                && this.#record.revision === validated.revision
                && this.#record.authorityEpoch === validated.authorityEpoch
                && this.#record.transitionIntent?.transitionId
                  === validated.transitionIntent?.transitionId;
              throw coordinatorError(
                sameLocalClearing
                  ? 'SNAPBACK_CLIENT_AUTHORITY_CLEARING'
                  : 'SNAPBACK_CLIENT_AUTHORITY_STALE',
                sameLocalClearing
                  ? 'local authority transition is still clearing'
                  : 'local authority barrier changed before synchronization',
              );
            }
            return this.#recoverOwned(owner, validated, 'peer_recovery');
          }
          if (
            this.#record === null
            || this.#record.revision !== validated.revision
            || this.#record.authorityEpoch !== validated.authorityEpoch
            || this.#publicationPaused
          ) {
            const localAtRead = this.#record === null
              ? null
              : Object.freeze({
                phase: this.#record.phase,
                revision: this.#record.revision,
                authorityEpoch: this.#record.authorityEpoch,
                authorityKey: canonicalAuthorityKey(
                  this.#appId,
                  this.#record.phase === 'settled'
                    ? this.#record.authority
                    : this.#record.pendingAuthority,
                ),
              });
            return {
              adoptPeerAfterOwnership: true,
              record: validated,
              localAtRead,
              publicationPausedAtRead: this.#publicationPaused,
            };
          }
          return captureFor(this.#appId, validated);
        });
      } catch (error) {
        // Ownership acquisition and its first durable read are mandatory
        // publication gates. If either fails after a capture was exposed,
        // close the gate immediately, then quiesce and blank local participants.
        // A clearing wakeup may already have paused publication before this
        // read begins; that pause is not evidence that predecessor surfaces
        // were blanked. The retained local record is the exposure witness.
        if (this.#counterExhaustionError === null && this.#record !== null) {
          await this.#failClosedAfterConfirmation(
            'synchronization_custody_read_failed',
            error,
          );
        }
        throw error;
      }
      return this.#resumeAfterOwnership(owned);
    })();
    const tracked = work.finally(() => {
      if (this.#synchronizing === tracked) this.#synchronizing = null;
    });
    this.#synchronizing = tracked;
    return tracked;
  }

  /**
   * Cold-process restore for lease-bounded offline reads. This deliberately
   * does not run participant resume: no transport becomes online, and the
   * caller may use the returned capture only to validate durable retained
   * state. Every later online boundary still enters synchronize/authSession.
   *
   * @ref LLP 0058#kit-ordering — offline cold boot is authorized by the last
   *   durable mode/authority metadata, not by a fabricated handshake.
   */
  async restoreOffline() {
    this.#assertOperationAllowed();
    let ownershipEntered = false;
    let inspected;
    try {
      inspected = await this.#storage.withOwnership(this.#storageOwnerKey, async (owner) => {
        ownershipEntered = true;
        // @ref LLP 0059#cross-context-ownership — offline restore ownership is
        // read/validation only. Counter cuts and every participant callback
        // are deferred until this callback has released the non-reentrant
        // custody owner.
        return this.#inspectOwnedWithoutCut(owner);
      });
    } catch (error) {
      if (this.#counterExhaustionError === null && this.#record !== null) {
        await this.#failClosedAfterConfirmation(
          ownershipEntered
            ? 'offline_custody_read_failed'
            : 'offline_custody_ownership_failed',
          error,
        );
      }
      throw error;
    }

    if (inspected.terminal !== null) {
      throw await this.#applyDeferredCounterTerminal(inspected.terminal);
    }
    const record = inspected.record;
    if (record === null) {
      if (this.#record !== null) {
        const error = corrupt('durable custody disappeared during offline restore');
        await this.#failClosedAfterConfirmation('offline_custody_missing', error);
        throw error;
      }
      const confirmed = await this.#confirmOfflineDurableExact(
        null,
        'offline_fresh_null_confirm_failed',
      );
      return confirmed.durable;
    }
    if (record.phase !== 'settled') {
      const error = coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
        'offline authority requires settled durable custody',
        { authorityEpoch: record.authorityEpoch },
      );
      await this.#failClosedAfterConfirmation('offline_custody_clearing', error);
      throw error;
    }

    const expected = captureFor(this.#appId, record);
    if (this.#record === null) {
      // A fresh context has no predecessor app-visible state to clear. Its
      // participants were registered while publication was paused and are
      // already blank. The exact second read and local adoption share one
      // ownership-fenced synchronous turn.
      const confirmed = await this.#confirmOfflineDurableExact(
        expected,
        'offline_fresh_custody_confirm_failed',
        (durable) => {
          this.#assertParticipantRegistrationsReady();
          if (this.#record !== null || this.#activeBarrier !== null) {
            throw coordinatorError(
              'SNAPBACK_CLIENT_AUTHORITY_STALE',
              'local custody changed before fresh offline restore could publish',
            );
          }
          this.#adoptSettled(durable);
          return captureFor(this.#appId, durable);
        },
      );
      return confirmed.value;
    }

    if (this.#publicationPaused || this.#record.phase !== 'settled') {
      const error = coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
        'offline authority cannot be restored over an in-progress local barrier',
      );
      await this.#failClosedAfterConfirmation('offline_custody_local_barrier', error);
      throw error;
    }
    const current = validateAuthCustody(this.#record, this.#appId);
    const currentCapture = captureFor(this.#appId, current);
    if (
      record.revision < current.revision
      || record.authorityEpoch < current.authorityEpoch
    ) {
      const error = corrupt('durable custody regressed during offline restore');
      await this.#failClosedAfterConfirmation('offline_custody_regressed', error);
      throw error;
    }
    const sameAuthority = record.authorityEpoch === current.authorityEpoch
      && canonicalAuthorityKey(this.#appId, record.authority)
        === canonicalAuthorityKey(this.#appId, current.authority);
    if (sameAuthority) {
      // A bearer rotation may advance only the custody revision. It does not
      // change the offline authorization identity. Recheck local continuity
      // and install the exact durable revision under the final owner fence.
      const confirmed = await this.#confirmOfflineDurableExact(
        expected,
        'offline_same_authority_confirm_failed',
        (durable) => {
          if (
            this.#publicationPaused
            || this.#activeBarrier !== null
            || !captureMatches(this.#appId, this.#record, currentCapture, { revision: true })
          ) {
            throw coordinatorError(
              'SNAPBACK_CLIENT_AUTHORITY_STALE',
              'local custody changed before offline revision adoption',
            );
          }
          this.#adoptSettled(durable);
          return captureFor(this.#appId, durable);
        },
      );
      return confirmed.value;
    }

    const preconfirmed = await this.#confirmOfflineDurableExact(
      expected,
      'offline_peer_adoption_preconfirm_failed',
    );
    if (
      this.#publicationPaused
      || this.#activeBarrier !== null
      || !captureMatches(this.#appId, this.#record, currentCapture, { revision: true })
    ) {
      const error = coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_STALE',
        'local custody changed before offline peer adoption',
      );
      await this.#failClosedAfterConfirmation('offline_peer_adoption_local_mismatch', error);
      throw error;
    }
    return this.#adoptPeerOfflineSettled(preconfirmed.durable, currentCapture);
  }

  async compareAndCommit(capture, commit) {
    this.#assertOperationAllowed();
    if (typeof commit !== 'function') throw new TypeError('compareAndCommit requires a commit callback');
    if (this.#publicationPaused) return { committed: false };
    return this.#withOwnership(async (owner) => {
      const record = await this.#readOwned(owner);
      if (this.#publicationPaused || !captureMatches(this.#appId, record, capture)) {
        return { committed: false };
      }
      const validated = record;
      this.#adoptSettled(validated, { expose: true });
      const view = Object.freeze({
        ...captureFor(this.#appId, validated),
        authority: clone(validated.authority),
        bearer: validated.bearer,
        refreshAfterMs: validated.refreshAfterMs,
      });
      const runCommit = () => {
        // A broadcast or same-context barrier may pause publication while a
        // fallback owner is asynchronously revalidating its lease.
        if (this.#publicationPaused) return { committed: false };
        this.#inCommit = true;
        try {
          const value = commit(view);
          if (value && typeof value.then === 'function') {
            throw coordinatorError(
              'SNAPBACK_CLIENT_AUTH_COMMIT_ASYNC',
              'compareAndCommit callback must be synchronous and non-reentrant',
            );
          }
          return { committed: true, value };
        } finally {
          this.#inCommit = false;
        }
      };
      // @ref LLP 0059#cross-context-ownership — without Web Locks the lease
      // can be lost between the fenced read and this synchronous commit. A
      // fenced storage owner revalidates the lease row transactionally around
      // the publication commit, so a paused former holder rejects with lock
      // loss instead of publishing under a successor. Owners whose ownership
      // spans the whole operation (Web Locks, serialized memory) run direct.
      return typeof owner.fencePublication === 'function'
        ? await owner.fencePublication(runCommit)
        : runCommit();
    });
  }

  async compareAndRotateBearer(capture, { bearer, refreshAfterMs }) {
    this.#assertOperationAllowed();
    if (typeof bearer !== 'string' || bearer.length === 0) {
      throw new TypeError('compareAndRotateBearer requires a non-empty bearer');
    }
    validateRefreshTime(refreshAfterMs, 'refreshAfterMs');
    if (refreshAfterMs === null) throw new TypeError('compareAndRotateBearer requires refreshAfterMs');
    return this.#withOwnership(async (owner) => {
      const record = await this.#readOwned(owner);
      if (!captureMatches(this.#appId, record, capture, { revision: true })) {
        return { rotated: false };
      }
      const current = record;
      if (current.authority.kind !== 'session') {
        throw coordinatorError('SNAPBACK_CLIENT_AUTHORITY_STALE', 'anonymous custody cannot rotate a bearer');
      }
      if (current.formatVersion === SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION) {
        throw coordinatorError(
          'SNAPBACK_AUTH_SENDER_CUSTODY_REQUIRED',
          'sender-constrained custody must rotate its credential and nonce atomically',
        );
      }
      let revision;
      try {
        revision = nextRevision(current.revision);
      } catch (error) {
        if (!isCounterExhaustion(error)) throw error;
        await this.#terminalizeOwned(owner, current, error);
        throw error;
      }
      const next = await owner.replace(current.revision, {
        ...current,
        revision,
        bearer,
        refreshAfterMs,
      });
      // A same-authority credential rotation may be reentrant from participant
      // resume. It may update the barrier's exact settled record, but it must
      // not reopen publication before every participant is ready.
      this.#adoptSettled(next, { expose: !this.#publicationPaused });
      this.#publish(next);
      return { rotated: true, capture: captureFor(this.#appId, next) };
    });
  }

  async compareAndRotateSenderCredential(capture, {
    bearer,
    refreshAfterMs,
    nonce,
    expectedSenderGeneration,
  }) {
    // @ref LLP 0077#nonce-protocol — the response successor nonce and bearer
    // become current in one revision- and sender-generation-fenced write.
    this.#assertOperationAllowed();
    if (typeof bearer !== 'string' || bearer.length === 0) {
      throw new TypeError('compareAndRotateSenderCredential requires a non-empty bearer');
    }
    validateRefreshTime(refreshAfterMs, 'refreshAfterMs');
    if (refreshAfterMs === null) {
      throw new TypeError('compareAndRotateSenderCredential requires refreshAfterMs');
    }
    const validatedNonce = validateSenderNonce(nonce, 'nonce');
    assertSafeInteger(expectedSenderGeneration, 'expectedSenderGeneration', { positive: true });
    return this.#withOwnership(async (owner) => {
      const current = await this.#readOwned(owner);
      if (!captureMatches(this.#appId, current, capture, { revision: true })) {
        return { rotated: false };
      }
      if (
        current.formatVersion !== SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION
        || current.authority.kind !== 'session'
        || current.senderConstraint === null
      ) {
        throw coordinatorError(
          'SNAPBACK_AUTH_SENDER_CUSTODY_REQUIRED',
          'current custody is not a sender-constrained session',
        );
      }
      if (
        current.senderConstraint.custodyGeneration !== expectedSenderGeneration
        || validatedNonce.generation !== current.senderConstraint.nonce.generation + 1
      ) {
        return { rotated: false };
      }
      if (
        expectedSenderGeneration >= MAX_SAFE
        || current.senderConstraint.nonce.generation >= MAX_SAFE
      ) {
        throw coordinatorError(
          'SNAPBACK_AUTH_SENDER_CUSTODY_GENERATION_EXHAUSTED',
          'sender custody generation is exhausted and requires a new session',
        );
      }
      let revision;
      try {
        revision = nextRevision(current.revision);
      } catch (error) {
        if (!isCounterExhaustion(error)) throw error;
        await this.#terminalizeOwned(owner, current, error);
        throw error;
      }
      const next = await owner.replace(current.revision, {
        ...current,
        revision,
        bearer,
        refreshAfterMs,
        senderConstraint: {
          ...current.senderConstraint,
          custodyGeneration: expectedSenderGeneration + 1,
          nonce: validatedNonce,
        },
      });
      this.#adoptSettled(next, { expose: !this.#publicationPaused });
      this.#publish(next);
      return { rotated: true, capture: captureFor(this.#appId, next) };
    });
  }

  /**
   * Serialize refresh across contexts and keep successor plaintext private
   * until the exact predecessor revision is durably replaced.
   */
  async withCredentialRotation(capture, rotate) {
    this.#assertOperationAllowed();
    if (typeof rotate !== 'function') throw new TypeError('withCredentialRotation requires a callback');
    const prepared = await this.#withOwnership(async (owner) => {
      const record = await this.#readOwned(owner);
      if (!captureMatches(this.#appId, record, capture, { revision: true })) {
        return null;
      }
      const current = record;
      if (current.authority.kind !== 'session') {
        throw coordinatorError('SNAPBACK_CLIENT_AUTHORITY_STALE', 'anonymous custody cannot refresh a bearer');
      }
      if (current.formatVersion === SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION) {
        throw coordinatorError(
          'SNAPBACK_AUTH_SENDER_CUSTODY_REQUIRED',
          'sender-constrained refresh must use its proof-and-nonce rotation path',
        );
      }
      return Object.freeze({
        bearer: current.bearer,
        authority: clone(current.authority),
        refreshAfterMs: current.refreshAfterMs,
      });
    });
    if (prepared === null) return { rotated: false };

    // The refresh request may involve arbitrary network I/O. Durable custody
    // is deliberately not owned while it runs; the exact predecessor capture
    // is compared again in compareAndRotateBearer before publication.
    // @ref LLP 0059#cross-context-ownership — no network request runs under
    // the Web Lock/lease mutex.
    const candidate = await rotate(prepared);
    if (!candidate || typeof candidate.bearer !== 'string' || candidate.bearer.length === 0) {
      throw coordinatorError('SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID', 'refresh returned no successor bearer');
    }
    validateRefreshTime(candidate.refreshAfterMs, 'refreshAfterMs');
    if (candidate.refreshAfterMs === null) {
      throw coordinatorError('SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID', 'refresh returned no refresh schedule');
    }
    const committed = await this.compareAndRotateBearer(capture, candidate);
    return committed.rotated
      ? { ...committed, value: candidate.value }
      : { rotated: false };
  }

  async withSenderCredentialRotation(capture, rotate) {
    this.#assertOperationAllowed();
    if (typeof rotate !== 'function') {
      throw new TypeError('withSenderCredentialRotation requires a callback');
    }
    const prepared = await this.#withOwnership(async (owner) => {
      const record = await this.#readOwned(owner);
      if (!captureMatches(this.#appId, record, capture, { revision: true })) {
        return null;
      }
      if (
        record.formatVersion !== SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION
        || record.authority.kind !== 'session'
        || record.senderConstraint === null
      ) {
        throw coordinatorError(
          'SNAPBACK_AUTH_SENDER_CUSTODY_REQUIRED',
          'sender-constrained refresh requires sender custody',
        );
      }
      return Object.freeze({
        bearer: record.bearer,
        authority: clone(record.authority),
        refreshAfterMs: record.refreshAfterMs,
        senderConstraint: clone(record.senderConstraint),
      });
    });
    if (prepared === null) return { rotated: false };

    // @ref LLP 0077#issuance-refresh-and-recovery — network I/O occurs outside
    // custody ownership; the successor bearer and response nonce become
    // visible only through the exact revision+sender-generation CAS below.
    const candidate = await rotate(prepared);
    if (
      !candidate
      || typeof candidate.bearer !== 'string'
      || candidate.bearer.length === 0
      || !candidate.nonce
    ) {
      throw coordinatorError(
        'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID',
        'sender refresh returned no complete successor',
      );
    }
    const committed = await this.compareAndRotateSenderCredential(capture, {
      bearer: candidate.bearer,
      refreshAfterMs: candidate.refreshAfterMs,
      nonce: candidate.nonce,
      expectedSenderGeneration: prepared.senderConstraint.custodyGeneration,
    });
    return committed.rotated
      ? { ...committed, value: candidate.value }
      : { rotated: false };
  }

  /**
   * Serialize one sender-proof flight across every same-origin context.
   *
   * This uses a lock namespace distinct from custody ownership: the network
   * callback may acquire ordinary custody ownership to commit its successor
   * nonce without re-entering the serialization lock. Web Locks release on
   * context death; the IndexedDB fallback renews and fences the equivalent
   * lease row.
   */
  // @ref LLP 0077#browser-custody — one custody lineage permits one proof flight through successor commit.
  async withSenderRequestSerialization(expectedCapture, operation) {
    this.#assertOperationAllowed();
    if (typeof operation !== 'function') {
      throw new TypeError('withSenderRequestSerialization requires a callback');
    }
    const serializationKey = `\u0000snapback.sender-request.v2\u0000${this.#appId}`;
    const serializationOwnerKey = this.#storagePartition === AUTH_DEFAULT_STORAGE_PARTITION
      ? serializationKey
      : { appId: serializationKey, storagePartition: this.#storagePartition };
    return this.#storage.withOwnership(serializationOwnerKey, async () => {
      this.#assertOperationAllowed();
      const prepared = await this.#withOwnership(async (owner) => {
        const record = await this.#readOwned(owner);
        if (!captureMatches(this.#appId, record, expectedCapture)) return null;
        if (
          record.formatVersion !== SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION
          || record.authority.kind !== 'session'
          || record.senderConstraint === null
        ) {
          throw coordinatorError(
            'SNAPBACK_AUTH_SENDER_CUSTODY_REQUIRED',
            'serialized sender request requires sender custody',
          );
        }
        return Object.freeze({
          capture: captureFor(this.#appId, record),
          credential: Object.freeze({
            authority: clone(record.authority),
            bearer: record.bearer,
            refreshAfterMs: record.refreshAfterMs,
            senderConstraint: clone(record.senderConstraint),
          }),
        });
      });
      if (prepared === null) {
        throw coordinatorError(
          'SNAPBACK_CLIENT_AUTHORITY_STALE',
          'sender request authority changed before serialization',
        );
      }
      return operation(prepared);
    });
  }

  // @ref LLP 0077#websocket-and-connection-binding — browser 101 responses retain the flight until an observable terminal edge.
  async beginSenderRequestSerialization(expectedCapture) {
    let enter;
    let rejectEnter;
    const entered = new Promise((resolve, reject) => {
      enter = resolve;
      rejectEnter = reject;
    });
    let releaseOperation;
    const released = new Promise((resolve) => {
      releaseOperation = resolve;
    });
    const completion = this.withSenderRequestSerialization(
      expectedCapture,
      async (prepared) => {
        enter(prepared);
        await released;
      },
    );
    completion.catch(rejectEnter);
    const prepared = await entered;
    let releaseStarted = false;
    return Object.freeze({
      ...prepared,
      release: async () => {
        if (!releaseStarted) {
          releaseStarted = true;
          releaseOperation();
        }
        await completion;
      },
    });
  }

  async waitForNewerRevision(capture, {
    timeoutMs = AUTH_CUSTODY_SUPERSEDED_WAIT_MS,
    pollMs = 25,
    monotonicNow = () => globalThis.performance?.now?.() ?? Date.now(),
  } = {}) {
    this.#assertOperationAllowed();
    const deadline = monotonicNow() + timeoutMs;
    for (;;) {
      try {
        await this.synchronize();
      } catch (error) {
        if (
          error?.code === 'SNAPBACK_AUTH_CUSTODY_CORRUPT'
          || error?.code === 'SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED'
          || error?.code === 'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED'
          || error?.code === 'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED'
        ) throw error;
        // A peer may still own a clearing transition; retry until the bounded
        // monotonic deadline and let the caller choose the family-alarm path.
      }
      if (
        this.#record?.phase === 'settled'
        && this.#record.authorityEpoch === capture.authorityEpoch
        && canonicalAuthorityKey(this.#appId, this.#record.authority) === capture.authorityKey
        && this.#record.revision > capture.custodyRevision
      ) {
        return captureFor(this.#appId, this.#record);
      }
      if (
        this.#record?.phase === 'settled'
        && (
          this.#record.authorityEpoch !== capture.authorityEpoch
          || canonicalAuthorityKey(this.#appId, this.#record.authority) !== capture.authorityKey
        )
      ) return null;
      const remaining = deadline - monotonicNow();
      if (remaining <= 0) return null;
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
    }
  }

  async compareAndClear(capture, reason = 'terminal_auth_error') {
    await this.#joinAuthorityOperationBarrier();
    this.#assertOperationAllowed();
    const current = this.#record;
    if (!captureMatches(this.#appId, current, capture)) return { cleared: false };
    const authority = current.authority;
    const anonymous = {
      kind: 'anonymous',
      authMode: authority.authMode,
      authorizationStreamIncarnation: authority.authorizationStreamIncarnation,
    };
    try {
      await this.transition(capture, { authority: anonymous, bearer: null, refreshAfterMs: null }, reason);
      return { cleared: true };
    } catch (error) {
      if (error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE') return { cleared: false };
      throw error;
    }
  }

  /**
   * Recover publication-closed custody from a server-witnessed anonymous
   * authority on a different authorization-stream incarnation.
   *
   * @ref LLP 0059#unrecognized-authority-recovery — capture-free recovery is
   *   admitted only after ordinary publication has failed closed, and the
   *   witnessed successor still enters the standard transition barrier.
   */
  async recoverUnrecognizedAuthority(
    observedAnonymousAuthority,
    reason = 'unrecognized_authority',
  ) {
    this.#assertOperationAllowed();
    const observed = normalizeClientAuthority(observedAnonymousAuthority);
    if (observed.kind !== 'anonymous') {
      throw coordinatorError(
        'SNAPBACK_AUTH_CUSTODY_BOOTSTRAP_INVALID',
        'unrecognized-authority recovery requires an anonymous server handshake',
      );
    }
    if (
      !this.#publicationPaused
      || this.#activeBarrier !== null
      || this.#record === null
      || !['settled', 'clearing'].includes(this.#record.phase)
    ) {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_STALE',
        'capture-free authority recovery requires failed-closed or stuck-clearing custody',
      );
    }
    this.#assertParticipantRegistrationsReady();
    const local = validateAuthCustody(this.#record, this.#appId);
    const localAuthority = local.phase === 'settled'
      ? local.authority
      : local.pendingAuthority;
    const localFingerprint = Object.freeze({
      phase: local.phase,
      revision: local.revision,
      authorityEpoch: local.authorityEpoch,
      authorityKey: canonicalAuthorityKey(this.#appId, localAuthority),
      transitionId: local.transitionIntent?.transitionId ?? null,
    });
    const normalized = {
      authority: observed,
      bearer: null,
      refreshAfterMs: null,
      senderConstraint: null,
    };
    const owned = await this.#withOwnership(async (owner) => {
      const current = await this.#readOwned(owner);
      const currentAuthority = current?.phase === 'settled'
        ? current.authority
        : current?.phase === 'clearing'
          ? current.pendingAuthority
          : null;
      const localStillExact = this.#publicationPaused
        && this.#activeBarrier === null
        && this.#record?.phase === localFingerprint.phase
        && this.#record?.revision === localFingerprint.revision
        && this.#record?.authorityEpoch === localFingerprint.authorityEpoch
        && canonicalAuthorityKey(
          this.#appId,
          this.#record?.phase === 'settled'
            ? this.#record.authority
            : this.#record.pendingAuthority,
        ) === localFingerprint.authorityKey
        && (this.#record?.transitionIntent?.transitionId ?? null)
          === localFingerprint.transitionId;
      const durableExact = currentAuthority !== null
        && current.phase === localFingerprint.phase
        && current.revision === localFingerprint.revision
        && current.authorityEpoch === localFingerprint.authorityEpoch
        && canonicalAuthorityKey(this.#appId, currentAuthority)
          === localFingerprint.authorityKey
        && (current.transitionIntent?.transitionId ?? null)
          === localFingerprint.transitionId;
      if (!localStillExact || !durableExact) {
        throw coordinatorError(
          'SNAPBACK_CLIENT_AUTHORITY_STALE',
          'durable authority changed before unrecognized-authority recovery',
        );
      }
      if (
        observed.authorizationStreamIncarnation
        === currentAuthority.authorizationStreamIncarnation
      ) {
        throw coordinatorError(
          'SNAPBACK_CLIENT_AUTHORITY_STALE',
          'anonymous recovery handshake did not witness a different authorization-stream incarnation',
        );
      }
      return this.#beginClearingTransitionOwned(
        owner,
        current,
        normalized,
        reason,
        currentAuthority,
      );
    });
    return this.#resumeAfterOwnership(owned);
  }

  async transition(expected, successor, reason = 'authority_change') {
    await this.#joinAuthorityOperationBarrier();
    this.#assertOperationAllowed();
    const normalized = await normalizeSuccessor(successor);
    const owned = await this.#withOwnership(async (owner) => {
      let current = await this.#readOwned(owner);
      if (current === null) {
        throw coordinatorError('SNAPBACK_CLIENT_AUTHORITY_STALE', 'no durable predecessor custody exists');
      }
      const successorKey = canonicalAuthorityKey(this.#appId, normalized.authority);
      if (current.phase === 'settled' && canonicalAuthorityKey(this.#appId, current.authority) === successorKey) {
        if (
          normalized.senderConstraint !== null
          && (
            current.formatVersion !== SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION
            || current.senderConstraint.thumbprint !== normalized.senderConstraint.thumbprint
          )
        ) {
          throw coordinatorError(
            'SNAPBACK_AUTH_SENDER_CUSTODY_STALE',
            'same-authority confirmation cannot replace its sender constraint',
          );
        }
        const currentCapture = captureFor(this.#appId, current);
        const localAlreadyExact = this.#record?.phase === 'settled'
          && captureMatches(this.#appId, this.#record, currentCapture, { revision: true });
        if (localAlreadyExact) {
          // A reentrant transition from successor resume is confirmation only.
          // It cannot replace or reopen the active local barrier.
          return currentCapture;
        }
        // A missed wakeup may leave this context on predecessor A while a peer
        // has already settled requested successor B. Treat that as peer
        // adoption after ownership; blindly installing B here would skip every
        // local quiesce/blank/commit/resume callback.
        const localAtRead = this.#record === null
          ? null
          : Object.freeze({
            phase: this.#record.phase,
            revision: this.#record.revision,
            authorityEpoch: this.#record.authorityEpoch,
            authorityKey: canonicalAuthorityKey(
              this.#appId,
              this.#record.phase === 'settled'
                ? this.#record.authority
                : this.#record.pendingAuthority,
            ),
          });
        return {
          adoptPeerAfterOwnership: true,
          record: current,
          localAtRead,
          publicationPausedAtRead: this.#publicationPaused,
        };
      }
      if (current.phase === 'clearing') {
        if (canonicalAuthorityKey(this.#appId, current.pendingAuthority) !== successorKey) {
          throw coordinatorError('SNAPBACK_CLIENT_AUTHORITY_STALE', 'another authority transition is already clearing');
        }
        return this.#recoverOwned(owner, current, reason);
      }
      if (!captureMatches(this.#appId, current, expected)) {
        throw coordinatorError('SNAPBACK_CLIENT_AUTHORITY_STALE', 'authority changed before transition');
      }
      if (
        current.formatVersion === SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION
        && current.authority.kind === 'session'
        && normalized.senderConstraint !== null
      ) {
        throw coordinatorError(
          'SNAPBACK_AUTH_SENDER_CUSTODY_UPGRADE_REQUIRED',
          'an existing bearer-only session cannot gain a sender constraint in place',
        );
      }
      return this.#beginClearingTransitionOwned(
        owner,
        current,
        normalized,
        reason,
        current.authority,
      );
    });
    return this.#resumeAfterOwnership(owned);
  }

  async #beginClearingTransitionOwned(
    owner,
    current,
    normalized,
    reason,
    previousAuthority,
  ) {
    const successorKey = canonicalAuthorityKey(this.#appId, normalized.authority);
    const senderFormat = (
      current.formatVersion === SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION
      || normalized.senderConstraint !== null
    );
    if (
      senderFormat
      && normalized.authority.kind === 'session'
      && normalized.senderConstraint === null
    ) {
      throw coordinatorError(
        'SNAPBACK_AUTH_SENDER_CUSTODY_REQUIRED',
        'a sender-constrained session transition requires its new sender constraint',
      );
    }
    let nextEpoch;
    let clearingRevision;
    try {
      nextEpoch = nextAuthorityEpoch(current.authorityEpoch);
      clearingRevision = nextRevision(current.revision);
      // A transition requires two durable increments. Check both before
      // publishing clearing so exhaustion cannot strand a half-transition.
      nextRevision(clearingRevision);
    } catch (error) {
      if (!isCounterExhaustion(error)) throw error;
      await this.#terminalizeOwned(owner, current, error);
      throw error;
    }
    const expectedAuthorityKey = canonicalAuthorityKey(this.#appId, previousAuthority);
    const senderConstraintThumbprint = normalized.senderConstraint?.thumbprint ?? null;
    const transitionIntent = {
      formatVersion: senderFormat ? 2 : 1,
      transitionId: transitionIdFor(
        this.#appId,
        current.revision,
        nextEpoch,
        successorKey,
        senderFormat ? senderConstraintThumbprint : undefined,
      ),
      expectedEpoch: current.authorityEpoch,
      expectedAuthorityKey,
      nextEpoch,
      nextAuthorityKey: successorKey,
      reason,
      disposition: 'delete',
      previousAuthority: clone(previousAuthority),
      nextAuthority: clone(normalized.authority),
      ...(senderFormat ? { senderConstraintThumbprint } : {}),
    };
    const clearing = await owner.replace(current.revision, {
      formatVersion: senderFormat
        ? SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION
        : SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
      appId: this.#appId,
      authorityEpoch: nextEpoch,
      revision: clearingRevision,
      phase: 'clearing',
      authority: null,
      pendingAuthority: normalized.authority,
      bearer: null,
      pendingBearer: normalized.bearer,
      refreshAfterMs: normalized.refreshAfterMs,
      transitionIntent,
      ...(senderFormat ? {
        senderConstraint: null,
        pendingSenderConstraint: normalized.senderConstraint,
      } : {}),
    });
    return this.#prepareClearingBarrierOwned(owner, clearing, {
      expectedEpoch: current.authorityEpoch,
      expectedAuthorityKey,
      nextEpoch,
      nextAuthorityKey: successorKey,
      reason,
      disposition: 'delete',
      previousAuthority: clone(previousAuthority),
      nextAuthority: clone(normalized.authority),
    });
  }

  registerParticipant(participant, { before = null } = {}) {
    this.#assertOperationAllowed();
    if (!participant || typeof participant !== 'object') throw new TypeError('participant must be an object');
    const entry = {
      participant,
      order: this.#participantSequence += 1,
      removed: false,
      active: Promise.resolve(),
      callbackDepth: 0,
      invocationDepth: 0,
      removalTask: null,
    };
    const beforeIndex = before === null
      ? -1
      : this.#participants.findIndex((candidate) => candidate.participant === before);
    if (beforeIndex === -1) this.#participants.push(entry);
    else this.#participants.splice(beforeIndex, 0, entry);
    if (this.#publicationPaused) {
      // Registration while blank/clearing must not briefly expose predecessor
      // state. Synchronous phases run before registration returns; awaited
      // quiescence joins the active transition before its next phase.
      const context = this.#barrierContext();
      for (const method of ['blank', 'clearMemory']) {
        try {
          this.#invokeSyncParticipant(entry, method, context);
        } catch (error) {
          entry.registrationError ??= error;
        }
      }
      if (!entry.registrationError) {
        if (this.#activeBarrier) {
          // @ref LLP 0059#transition-barrier — a participant registering
          // mid-barrier joins paused and blank, so these phases are satisfied
          // at registration; commitDurable and resume still come from the
          // active barrier (as remaining phases or as pre-resume catch-up).
          this.#markPhaseDone(this.#activeBarrier, entry, 'quiesce');
          this.#markPhaseDone(this.#activeBarrier, entry, 'blank');
          this.#markPhaseDone(this.#activeBarrier, entry, 'clearMemory');
        }
      }
    }
    return () => {
      if (entry.removalTask === null) {
        entry.removalTask = Promise.resolve().then(async () => {
          // A destructive cut may begin after removal was requested but before
          // this task gets its turn. Keep joining active barrier/cut
          // completions until one synchronous check observes none; marking the
          // entry removed then excludes it from every later snapshot.
          for (;;) {
            const completions = new Set(this.#activeCutCompletions);
            const barrierCompletionPromise = this.#activeBarrier?.completion?.promise;
            if (barrierCompletionPromise) completions.add(barrierCompletionPromise);
            if (completions.size === 0) break;
            await Promise.all([...completions]);
          }
          entry.removed = true;
          await entry.active;
          this.#participants = this.#participants.filter((candidate) => candidate !== entry);
        });
      }
      const observe = () => {
        if (entry.callbackDepth > 0) {
          return Promise.reject(coordinatorError(
            'SNAPBACK_AUTH_CUSTODY_PARTICIPANT_REENTRANT',
            'a participant callback cannot await its own unregistration',
            { participant: entry.participant.name ?? entry.order },
          ));
        }
        return entry.removalTask;
      };
      // Requesting removal is safe from inside a callback, but joining that
      // removal from the same callback is a cycle: removal waits for the
      // callback, while the callback would wait for removal. A lazy thenable
      // distinguishes the supported fire-and-join-later form from a forbidden
      // self-join without manufacturing an ignored rejected Promise.
      return Object.freeze({
        then(onFulfilled, onRejected) {
          return observe().then(onFulfilled, onRejected);
        },
        catch(onRejected) {
          return observe().catch(onRejected);
        },
        finally(onFinally) {
          return observe().finally(onFinally);
        },
        [Symbol.toStringTag]: 'Promise',
      });
    };
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#publicationPaused = true;
    if (this.#broadcast) {
      this.#broadcast.onmessage = null;
      this.#broadcast.close?.();
    }
  }

  async #recoverOwned(owner, clearing, reason) {
    const intent = validateTransitionIntent(clearing.transitionIntent, this.#appId);
    return this.#prepareClearingBarrierOwned(owner, clearing, {
      expectedEpoch: intent.expectedEpoch,
      expectedAuthorityKey: intent.expectedAuthorityKey,
      nextEpoch: intent.nextEpoch,
      nextAuthorityKey: intent.nextAuthorityKey,
      reason: intent.reason ?? reason,
      disposition: intent.disposition,
      recovery: true,
      previousAuthority: clone(intent.previousAuthority),
      nextAuthority: clone(intent.nextAuthority),
    });
  }

  async #prepareClearingBarrierOwned(owner, clearing, context) {
    const validated = validateAuthCustody(clearing, this.#appId);
    let settledRevision;
    try {
      settledRevision = nextRevision(validated.revision);
    } catch (error) {
      if (!isCounterExhaustion(error)) throw error;
      await this.#terminalizeOwned(owner, validated, error);
      throw error;
    }
    if (this.#activeBarrier !== null) {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
        'local authority barrier is already active',
      );
    }
    const barrier = Object.freeze({
      appId: this.#appId,
      expectedEpoch: context.expectedEpoch,
      expectedAuthorityKey: context.expectedAuthorityKey,
      nextEpoch: context.nextEpoch,
      nextAuthorityKey: context.nextAuthorityKey,
      reason: context.reason,
      disposition: context.disposition,
      recovery: context.recovery === true,
      previousAuthority: clone(context.previousAuthority),
      nextAuthority: clone(context.nextAuthority),
    });
    this.#record = validated;
    this.#publicationPaused = true;
    const completion = barrierCompletion();
    this.#activeBarrier = {
      phase: 'clearing',
      context,
      completion,
      stagedPublications: [],
      cutGeneration: this.#destructiveCutGeneration,
      // @ref LLP 0059#transition-barrier — barrier phase completion is tracked
      // per registration; a participant that registers after commitDurable has
      // completed globally catches up through these phases (with this exact
      // CAS context) before it may resume.
      catchUp: {
        phases: ['quiesce', 'blank', 'clearMemory', 'commitDurable'],
        context: barrier,
      },
    };
    this.#publish(validated);
    return {
      settleClearingAfterOwnership: true,
      clearing: validated,
      settledRevision,
      barrier,
      barrierState: this.#activeBarrier,
    };
  }

  async #settleClearingAfterOwnership({
    clearing: validated,
    settledRevision,
    barrier,
    barrierState,
  }) {
    try {
      await this.#runAwaitedPhase('quiesce', barrier);
      this.#runSyncPhase('blank', barrier);
      this.#runSyncPhase('clearMemory', barrier);
      await this.#runAwaitedPhase('commitDurable', barrier);
      const settled = await this.#withOwnership(async (owner) => {
        const current = await this.#readOwned(owner);
        const transitionId = validated.transitionIntent?.transitionId;
        const currentTransitionId = current?.transitionIntent?.transitionId;
        const exactClearing = current?.phase === 'clearing'
          && current.revision === validated.revision
          && current.authorityEpoch === validated.authorityEpoch
          && currentTransitionId === transitionId;
        const exactSettledSuccessor = current?.phase === 'settled'
          && current.revision >= settledRevision
          && current.authorityEpoch === validated.authorityEpoch
          && currentTransitionId === transitionId
          && canonicalAuthorityKey(this.#appId, current.authority)
            === canonicalAuthorityKey(this.#appId, validated.pendingAuthority);
        if (!exactClearing && !exactSettledSuccessor) {
          throw coordinatorError(
            'SNAPBACK_CLIENT_AUTHORITY_STALE',
            'durable authority changed while the local transition barrier settled',
          );
        }
        if (exactSettledSuccessor) return current;

        const retainSenderConstraint = (
          validated.formatVersion === SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION
          && validated.pendingSenderConstraint !== null
        );
        const settledBase = {
          formatVersion: !retainSenderConstraint
            ? SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION
            : SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION,
          appId: validated.appId,
          authorityEpoch: validated.authorityEpoch,
          revision: settledRevision,
          phase: 'settled',
          authority: validated.pendingAuthority,
          pendingAuthority: null,
          bearer: validated.pendingBearer,
          pendingBearer: null,
          refreshAfterMs: validated.refreshAfterMs,
          transitionIntent: validated.transitionIntent,
        };
        return owner.replace(validated.revision, {
          ...settledBase,
          ...(!retainSenderConstraint ? {} : {
            senderConstraint: validated.pendingSenderConstraint,
            pendingSenderConstraint: null,
          }),
        });
      });
      this.#adoptSettled(settled, { expose: false });
      this.#publish(settled);
      // @ref LLP 0059#transition-barrier — participant settlement runs after
      // the clearing CAS releases ownership. The exact transition id/revision
      // above fences the short clearing-to-settled reacquisition; resume and
      // final exposure remain outside it with their own exact confirmation.
      return { resumeAfterOwnership: true, settled, barrier };
    } catch (error) {
      this.#publicationPaused = true;
      const failedPhase = barrierState?.phase ?? 'unknown';
      if (
        deferredCounterTerminalValue(error) !== null
        || isCounterExhaustion(error)
        || this.#counterExhaustionError
      ) {
        throw error;
      }
      const primaryError = coordinatorError(
        'SNAPBACK_AUTH_TRANSITION_FAILED',
        'authority transition barrier did not settle',
        { phase: failedPhase, causeCode: error?.code ?? null },
      );
      return {
        barrierFailureAfterOwnership: true,
        barrierState,
        context: barrier,
        snapshot: this.#participants.filter((entry) => !entry.removed),
        primaryError,
      };
    }
  }

  async #resumeAfterOwnership(result) {
    if (result?.settleClearingAfterOwnership) {
      result = await this.#settleClearingAfterOwnership(result);
    }
    if (result?.barrierFailureAfterOwnership) {
      const {
        barrierState,
        context,
        snapshot,
        primaryError,
      } = result;
      try {
        const failures = await this.#runSnapshottedDestructiveCut(
          context,
          { snapshot, barrier: barrierState },
        );
        this.#attachParticipantFailures(primaryError, failures);
      } finally {
        barrierState?.completion?.resolve();
        if (this.#activeBarrier === barrierState) this.#activeBarrier = null;
      }
      throw primaryError;
    }
    if (result?.adoptPeerAfterOwnership) {
      // Ownership used to obtain result.record has ended. Reacquire it for a
      // short exact read before participant work; a peer may have advanced the
      // durable record while the first result was being delivered.
      const durable = await this.#confirmDurableExact(
        captureFor(this.#appId, result.record),
        'peer_adoption_preconfirm_failed',
      );
      const exact = durable.phase === 'settled'
        && this.#record?.phase === 'settled'
        && durable.revision === this.#record.revision
        && durable.authorityEpoch === this.#record.authorityEpoch
        && canonicalAuthorityKey(this.#appId, durable.authority)
          === canonicalAuthorityKey(this.#appId, this.#record.authority);
      if (this.#activeBarrier !== null) {
        if (!exact) {
          this.#publicationPaused = true;
          throw coordinatorError(
            'SNAPBACK_CLIENT_AUTHORITY_STALE',
            'durable authority changed before an in-flight reload could adopt it',
          );
        }
        // A synchronization begun before this barrier may finish after the
        // owner has settled it. Its exact record is confirmation only: it must
        // not replace the active barrier or replay participant resume.
        return captureFor(this.#appId, durable);
      }
      if (exact && !this.#publicationPaused) {
        // Another completed synchronization or transition already installed
        // this exact record while the ownership result was in delivery.
        return captureFor(this.#appId, durable);
      }
      const localUnchanged = result.localAtRead === null
        ? this.#record === null
        : this.#record?.phase === result.localAtRead.phase
          && this.#record.revision === result.localAtRead.revision
          && this.#record.authorityEpoch === result.localAtRead.authorityEpoch
          && canonicalAuthorityKey(
            this.#appId,
            this.#record.phase === 'settled'
              ? this.#record.authority
              : this.#record.pendingAuthority,
          )
            === result.localAtRead.authorityKey;
      if (!localUnchanged || this.#publicationPaused !== result.publicationPausedAtRead) {
        await this.#failClosedAfterConfirmation('peer_adoption_local_mismatch');
        throw coordinatorError(
          'SNAPBACK_CLIENT_AUTHORITY_STALE',
          'local authority changed before an in-flight custody reload could adopt',
        );
      }
      await this.#adoptPeerSettled(durable);
      return captureFor(this.#appId, durable);
    }
    if (!result?.resumeAfterOwnership) {
      const durable = await this.#confirmDurableExact(
        result,
        'direct_synchronization_confirm_failed',
      );
      const exact = durable === null
        ? this.#record === null
        : this.#record?.phase === 'settled'
          && durable.revision === this.#record.revision
          && durable.authorityEpoch === this.#record.authorityEpoch
          && canonicalAuthorityKey(this.#appId, durable.authority)
            === canonicalAuthorityKey(this.#appId, this.#record.authority)
          && !this.#publicationPaused;
      if (!exact) {
        await this.#failClosedAfterConfirmation('direct_synchronization_local_mismatch');
        throw coordinatorError(
          'SNAPBACK_CLIENT_AUTHORITY_STALE',
          'authority changed before an in-flight custody reload returned',
        );
      }
      // The read may have begun before a barrier and complete during or after
      // its successor resume. Only the exact current local record can return;
      // an already-read predecessor capture is stale even once the barrier is
      // no longer active.
      return durable === null ? null : captureFor(this.#appId, durable);
    }
    const { settled, barrier } = result;
    const barrierState = this.#activeBarrier;
    try {
      const confirmed = await this.#confirmDurableExact(
        captureFor(this.#appId, settled),
        'owner_transition_preconfirm_failed',
      );
      const resumeCoordinator = this;
      const resumeContext = Object.freeze({
        ...barrier,
        // A sender-successor nonce may rotate the exact settled record while
        // the transport participant resumes. Later participants must receive
        // that current same-authority revision rather than the pre-network
        // capture. The final durable confirmation below still rejects any
        // unobserved peer change.
        get capture() {
          return captureFor(resumeCoordinator.#appId, resumeCoordinator.#record);
        },
        authority: clone(confirmed.authority),
        stagePublication: (capture, commit) => this.#stagePublication(
          barrierState,
          capture,
          commit,
        ),
      });
      for (;;) {
        await this.#runAwaitedPhase('resume', resumeContext, { reverse: true });
        try {
          const locallyExpected = validateAuthCustody(this.#record, this.#appId);
          if (
            locallyExpected.phase !== 'settled'
            || locallyExpected.authorityEpoch !== confirmed.authorityEpoch
            || canonicalAuthorityKey(this.#appId, locallyExpected.authority)
              !== canonicalAuthorityKey(this.#appId, confirmed.authority)
          ) {
            throw coordinatorError(
              'SNAPBACK_CLIENT_AUTHORITY_STALE',
              'authority changed during transition resume',
            );
          }
          const final = await this.#confirmDurableExact(
            captureFor(this.#appId, locallyExpected),
            'owner_transition_postconfirm_failed',
            () => {
              this.#assertBarrierPhaseClosure(
                barrierState,
                ['quiesce', 'blank', 'clearMemory', 'commitDurable', 'resume'],
              );
              this.#flushStagedPublications(barrierState, locallyExpected);
              this.#assertBarrierPhaseClosure(
                barrierState,
                ['quiesce', 'blank', 'clearMemory', 'commitDurable', 'resume'],
              );
              this.#exposePublication();
            },
          );
          return captureFor(this.#appId, final);
        } catch (error) {
          if (!isBarrierPhaseClosureRetry(error)) throw error;
          await this.#prepareBarrierPhaseClosureRetry(barrierState, error);
        }
      }
    } catch (error) {
      this.#publicationPaused = true;
      this.#discardStagedPublications(barrierState);
      const failures = await this.#runSnapshottedDestructiveCut(
        barrier,
        { snapshot: this.#participants.filter((entry) => !entry.removed) },
      );
      if (isCounterExhaustion(error) || this.#counterExhaustionError) {
        throw this.#counterExhaustionError ?? error;
      }
      const primaryError = coordinatorError(
        'SNAPBACK_AUTH_TRANSITION_FAILED',
        'authority transition resume did not complete',
        { phase: barrierState?.phase ?? 'resume', causeCode: error?.code ?? null },
      );
      this.#attachParticipantFailures(primaryError, failures);
      throw primaryError;
    } finally {
      barrierState?.completion?.resolve();
      if (this.#activeBarrier === barrierState) this.#activeBarrier = null;
    }
  }

  async #adoptPeerOfflineSettled(record, expectedLocalCapture) {
    const previous = validateAuthCustody(this.#record, this.#appId);
    if (!captureMatches(this.#appId, previous, expectedLocalCapture, { revision: true })) {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_STALE',
        'local custody changed before offline peer barrier started',
      );
    }
    this.#publicationPaused = true;
    const context = Object.freeze({
      appId: this.#appId,
      expectedEpoch: previous.authorityEpoch,
      expectedAuthorityKey: canonicalAuthorityKey(this.#appId, previous.authority),
      nextEpoch: record.authorityEpoch,
      nextAuthorityKey: canonicalAuthorityKey(this.#appId, record.authority),
      reason: 'offline_durable_reload',
      disposition: 'delete',
      recovery: true,
      previousAuthority: clone(previous.authority),
      nextAuthority: clone(record.authority),
    });
    const completion = barrierCompletion();
    const barrier = {
      phase: 'offline_durable_reload',
      context,
      completion,
      cutGeneration: this.#destructiveCutGeneration,
    };
    this.#activeBarrier = barrier;
    try {
      for (;;) {
        await this.#runAwaitedPhase('quiesce', context);
        this.#runSyncPhase('blank', context);
        this.#runSyncPhase('clearMemory', context);
        await this.#runAwaitedPhase('commitDurable', context);
        try {
          const confirmed = await this.#confirmOfflineDurableExact(
            captureFor(this.#appId, record),
            'offline_peer_adoption_postconfirm_failed',
            (durable) => {
              this.#assertBarrierPhaseClosure(
                barrier,
                ['quiesce', 'blank', 'clearMemory', 'commitDurable'],
              );
              if (
                !this.#publicationPaused
                || !captureMatches(
                  this.#appId,
                  this.#record,
                  expectedLocalCapture,
                  { revision: true },
                )
              ) {
                throw coordinatorError(
                  'SNAPBACK_CLIENT_AUTHORITY_STALE',
                  'local custody changed during offline peer barrier',
                );
              }
              this.#adoptSettled(durable, { expose: false });
              // No participant resume runs here: a durable offline authority
              // can validate retained leases, but it cannot establish online
              // transport.
              this.#exposePublication();
              return captureFor(this.#appId, durable);
            },
          );
          return confirmed.value;
        } catch (error) {
          if (!isBarrierPhaseClosureRetry(error)) throw error;
          await this.#prepareBarrierPhaseClosureRetry(barrier, error);
        }
      }
    } catch (error) {
      this.#publicationPaused = true;
      await this.#runSnapshottedDestructiveCut(
        context,
        { snapshot: this.#participants.filter((entry) => !entry.removed) },
      );
      throw error;
    } finally {
      completion.resolve();
      if (this.#activeBarrier === barrier) this.#activeBarrier = null;
    }
  }

  async #failClosedOfflineExposure(reason) {
    this.#publicationPaused = true;
    if (this.#record === null) return [];
    const context = Object.freeze({
      ...this.#barrierContext(),
      reason,
      disposition: 'delete',
    });
    const completion = barrierCompletion();
    const barrier = {
      phase: reason,
      context,
      completion,
    };
    const snapshot = this.#participants.filter((entry) => !entry.removed);
    this.#activeBarrier = barrier;
    try {
      // @ref LLP 0059#cross-context-ownership — a mandatory custody-read
      // failure is a complete local cut. One faulty participant cannot retain
      // another participant's predecessor materialization, and a participant
      // requesting unregistration from quiesce remains snapshotted until the
      // destructive phases finish.
      return await this.#runSnapshottedDestructiveCut(
        context,
        { snapshot, barrier },
      );
    } finally {
      completion.resolve();
      if (this.#activeBarrier === barrier) this.#activeBarrier = null;
    }
  }

  async #failClosedAfterConfirmation(reason, primaryError = null) {
    this.#publicationPaused = true;
    if (this.#activeBarrier === null) {
      const failures = await this.#failClosedOfflineExposure(reason);
      this.#attachParticipantFailures(primaryError, failures);
    }
  }

  #attachParticipantFailures(primaryError, failures) {
    if (
      failures.length === 0
      || !primaryError
      || (typeof primaryError !== 'object' && typeof primaryError !== 'function')
    ) return;
    // Preserve the mandatory custody/transition diagnostic as the operation's
    // primary error. Participant failures are secondary evidence and never a
    // reason to skip later destructive callbacks.
    try {
      Object.defineProperty(primaryError, 'failClosedParticipantFailures', {
        configurable: true,
        enumerable: false,
        value: Object.freeze(failures.map(({ entry, method, error }) => Object.freeze({
          participant: entry.participant.name ?? entry.order,
          method,
          code: error?.code ?? error?.diagnostic?.code ?? null,
        }))),
      });
    } catch {
      // Some host errors are non-extensible. The primary error still wins.
    }
  }

  async #inspectOwnedWithoutCut(owner) {
    let raw = null;
    try {
      raw = await owner.read();
      if (raw === null) return { record: null, terminal: null };
      const record = await validateAuthCustodySenderKeys(raw, this.#appId);
      if (record.phase === 'exhausted') {
        return {
          record: null,
          terminal: {
            error: durableCounterExhausted(record),
            durable: record,
            poisonHint: null,
          },
        };
      }
      return { record, terminal: null };
    } catch (error) {
      if (!isCounterExhaustion(error)) throw error;
      const poisonHint = (
        raw?.phase !== 'exhausted'
        && raw?.revision === MAX_SAFE
        && Number.isSafeInteger(raw?.authorityEpoch)
        && raw.authorityEpoch >= 0
      )
        ? {
            authorityEpoch: raw.authorityEpoch,
            revision: raw.revision,
            phase: 'exhausted',
          }
        : null;
      return {
        record: null,
        terminal: {
          error,
          durable: null,
          poisonHint,
        },
      };
    }
  }

  async #withOwnership(operation) {
    // @ref LLP 0059#cross-context-ownership — an owned callback may report a
    // terminal durable fact, but participant cuts begin only after release.
    try {
      return await this.#storage.withOwnership(this.#storageOwnerKey, operation);
    } catch (error) {
      const terminal = deferredCounterTerminalValue(error);
      if (terminal === null) throw error;
      throw await this.#applyDeferredCounterTerminal(terminal);
    }
  }

  async #applyDeferredCounterTerminal({ error, durable, poisonHint }) {
    this.#latchCounterExhaustion(error, durable);
    if (poisonHint !== null) this.#publish(poisonHint);
    await this.#counterExhaustionSettlement;
    return this.#counterExhaustionError ?? error;
  }

  async #readOwned(owner) {
    const inspected = await this.#inspectOwnedWithoutCut(owner);
    if (inspected.terminal !== null) {
      throw deferredCounterTerminal(inspected.terminal);
    }
    return inspected.record;
  }

  async #terminalizeOwned(owner, current, error) {
    if (current.phase === 'exhausted') {
      throw deferredCounterTerminal({ error, durable: current, poisonHint: null });
    }
    if (current.revision >= MAX_SAFE) {
      throw deferredCounterTerminal({
        error,
        durable: null,
        poisonHint: {
          authorityEpoch: current.authorityEpoch,
          revision: current.revision,
          phase: 'exhausted',
        },
      });
    }
    const marker = await owner.replace(current.revision, {
      formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
      appId: this.#appId,
      authorityEpoch: current.authorityEpoch,
      revision: current.revision + 1,
      phase: 'exhausted',
      authority: null,
      pendingAuthority: null,
      bearer: null,
      pendingBearer: null,
      refreshAfterMs: null,
      transitionIntent: null,
    });
    throw deferredCounterTerminal({ error, durable: marker, poisonHint: marker });
  }

  #latchCounterExhaustion(error, durable = null) {
    const prior = this.#record;
    if (durable?.phase === 'exhausted') this.#record = durable;
    this.#publicationPaused = true;
    if (this.#counterExhaustionError === null) {
      this.#counterExhaustionError = isCounterExhaustion(error)
        ? error
        : durableCounterExhausted(durable);
    }
    this.#discardStagedPublications(this.#activeBarrier);
    if (this.#counterExhaustionSettlement !== null) return this.#counterExhaustionError;

    const previousAuthority = prior?.phase === 'settled' ? clone(prior.authority) : null;
    const context = Object.freeze({
      appId: this.#appId,
      expectedEpoch: prior?.authorityEpoch ?? durable?.authorityEpoch ?? 0,
      expectedAuthorityKey: previousAuthority === null
        ? null
        : canonicalAuthorityKey(this.#appId, previousAuthority),
      nextEpoch: durable?.authorityEpoch ?? prior?.authorityEpoch ?? 0,
      nextAuthorityKey: null,
      reason: 'auth_counter_exhausted',
      disposition: 'delete',
      recovery: durable !== null,
      previousAuthority,
      nextAuthority: null,
    });
    const snapshot = this.#participants.filter((entry) => !entry.removed);
    // Publication closes before any asynchronous quiescence can yield. The
    // exact participant snapshot is held behind a completion so a participant
    // cannot unregister, repopulate from quiesce, and escape the final cut.
    this.#counterExhaustionSettlement = this.#runSnapshottedDestructiveCut(
      context,
      { snapshot, initialBlank: true },
    ).then(() => {});
    return this.#counterExhaustionError;
  }

  #runSnapshottedDestructiveCut(context, {
    snapshot = this.#participants.filter((entry) => !entry.removed),
    initialBlank = false,
    barrier = null,
  } = {}) {
    // @ref LLP 0059#cross-context-ownership — removal cannot shorten an exact
    // destructive snapshot between quiescence and its final blank/clear pass.
    const exactSnapshot = [...snapshot];
    const completion = barrierCompletion();
    this.#activeCutCompletions.add(completion.promise);
    this.#destructiveCutGeneration += 1;
    const failures = [];
    const runSyncPass = () => {
      for (const method of ['blank', 'clearMemory']) {
        if (barrier !== null) barrier.phase = method;
        for (const entry of exactSnapshot) {
          try {
            this.#invokeSyncParticipant(entry, method, context);
          } catch (error) {
            failures.push({ entry, method, error });
          } finally {
            if (barrier !== null) this.#markPhaseDone(barrier, entry, method);
          }
        }
      }
    };
    const task = (async () => {
      try {
        if (initialBlank) runSyncPass();
        if (barrier !== null) barrier.phase = 'quiesce';
        await Promise.all(exactSnapshot.map(async (entry) => {
          try {
            await this.#startAwaitedParticipant(entry, 'quiesce', context);
          } catch (error) {
            failures.push({ entry, method: 'quiesce', error });
          } finally {
            if (barrier !== null) this.#markPhaseDone(barrier, entry, 'quiesce');
          }
        }));
        // A quiescence callback may repopulate predecessor state. The final
        // destructive pass therefore targets the original snapshot even when
        // one of its entries requested removal during the callback.
        runSyncPass();
        return failures;
      } finally {
        completion.resolve();
        this.#activeCutCompletions.delete(completion.promise);
      }
    })();
    return task;
  }

  #exposePublication() {
    if (this.#closed) {
      this.#publicationPaused = true;
      throw coordinatorError(
        'SNAPBACK_AUTH_COORDINATOR_CLOSED',
        'a closed auth coordinator cannot expose authority',
      );
    }
    if (this.#counterExhaustionError) {
      this.#publicationPaused = true;
      throw this.#counterExhaustionError;
    }
    this.#assertParticipantRegistrationsReady();
    if (this.#exhaustedWakeupCut !== null || this.#activeCutCompletions.size > 0) {
      this.#publicationPaused = true;
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
        'authority publication is blocked by an active destructive cut',
      );
    }
    this.#publicationPaused = false;
  }

  async #confirmOfflineDurableExact(expected, reason, onConfirmed = null) {
    try {
      const outcome = await this.#storage.withOwnership(this.#storageOwnerKey, async (owner) => {
        const inspected = await this.#inspectOwnedWithoutCut(owner);
        if (inspected.terminal !== null) {
          return { terminal: inspected.terminal, durable: null, value: undefined };
        }
        const raw = inspected.record;
        let durable;
        if (expected === null) {
          if (raw === null) durable = null;
        } else if (captureMatches(this.#appId, raw, expected, { revision: true })) {
          durable = raw;
        }
        if (durable === undefined) {
          throw coordinatorError(
            'SNAPBACK_CLIENT_AUTHORITY_STALE',
            'durable authority changed before offline custody confirmation',
          );
        }
        let value;
        if (onConfirmed !== null) {
          const publish = () => {
            value = onConfirmed(durable);
            if (value && typeof value.then === 'function') {
              throw coordinatorError(
                'SNAPBACK_CLIENT_AUTH_COMMIT_ASYNC',
                'offline custody confirmation callback must be synchronous and non-reentrant',
              );
            }
          };
          if (typeof owner.fencePublication === 'function') {
            await owner.fencePublication(publish);
          } else {
            publish();
          }
        }
        return { terminal: null, durable, value };
      });
      if (outcome.terminal !== null) {
        throw await this.#applyDeferredCounterTerminal(outcome.terminal);
      }
      return outcome;
    } catch (error) {
      if (
        !isBarrierPhaseClosureRetry(error)
        && !isCounterExhaustion(error)
        && this.#counterExhaustionError === null
      ) {
        await this.#failClosedAfterConfirmation(reason, error);
      }
      throw error;
    }
  }

  async #confirmDurableExact(expected, reason, onConfirmed = null) {
    try {
      return await this.#withOwnership(async (owner) => {
        const raw = await this.#readOwned(owner);
        let durable;
        if (expected === null) {
          if (raw === null) durable = null;
        } else if (captureMatches(this.#appId, raw, expected, { revision: true })) {
          durable = raw;
        }
        if (durable === undefined) {
          throw coordinatorError(
            'SNAPBACK_CLIENT_AUTHORITY_STALE',
            'durable authority changed before custody confirmation',
          );
        }
        if (onConfirmed !== null) {
          const publish = () => onConfirmed(durable);
          if (typeof owner.fencePublication === 'function') {
            await owner.fencePublication(publish);
          } else {
            publish();
          }
        }
        return durable;
      });
    } catch (error) {
      if (
        !isBarrierPhaseClosureRetry(error)
        && !isCounterExhaustion(error)
        && this.#counterExhaustionError === null
      ) {
        await this.#failClosedAfterConfirmation(reason, error);
      }
      throw error;
    }
  }

  #stagePublication(barrier, capture, commit) {
    // @ref LLP 0059#cross-context-ownership — resume effects remain staged
    // until the exact successor is confirmed under the final ownership fence.
    this.#assertOperationAllowed();
    if (typeof commit !== 'function') throw new TypeError('stagePublication requires a commit callback');
    if (
      barrier === null
      || barrier !== this.#activeBarrier
      || barrier.phase !== 'resume'
      || !this.#publicationPaused
      || !captureMatches(this.#appId, this.#record, capture, { revision: true })
    ) {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_STALE',
        'publication cannot be staged outside the exact active resume barrier',
      );
    }
    barrier.stagedPublications.push({ capture: clone(capture), commit });
  }

  #flushStagedPublications(barrier, durable) {
    if (barrier === null || barrier !== this.#activeBarrier || barrier.phase !== 'resume') {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_STALE',
        'staged publication lost its active resume barrier',
      );
    }
    const staged = barrier.stagedPublications.splice(0);
    for (const entry of staged) {
      // A prior staged callback may synchronously close the coordinator or
      // start an eager terminal cut. Recheck lifecycle authority before every
      // callback so later queued publications cannot escape that closure.
      this.#assertOperationAllowed();
      if (!captureMatches(this.#appId, durable, entry.capture, { revision: true })) {
        throw coordinatorError(
          'SNAPBACK_CLIENT_AUTHORITY_STALE',
          'staged publication capture changed before final confirmation',
        );
      }
      const view = Object.freeze({
        ...captureFor(this.#appId, durable),
        authority: clone(durable.authority),
        bearer: durable.bearer,
        refreshAfterMs: durable.refreshAfterMs,
      });
      this.#inCommit = true;
      try {
        const value = entry.commit(view);
        if (value && typeof value.then === 'function') {
          throw coordinatorError(
            'SNAPBACK_CLIENT_AUTH_COMMIT_ASYNC',
            'staged publication callback must be synchronous and non-reentrant',
          );
        }
      } finally {
        this.#inCommit = false;
      }
    }
  }

  #discardStagedPublications(barrier) {
    if (barrier?.stagedPublications) barrier.stagedPublications.length = 0;
  }

  async #adoptPeerSettled(record) {
    const previous = this.#record;
    const authorityChanged = previous === null
      || previous.phase !== 'settled'
      || previous.authorityEpoch !== record.authorityEpoch
      || canonicalAuthorityKey(this.#appId, previous.authority) !== canonicalAuthorityKey(this.#appId, record.authority);
    if (!authorityChanged && !this.#publicationPaused) {
      const previousCapture = captureFor(this.#appId, previous);
      await this.#confirmDurableExact(
        captureFor(this.#appId, record),
        'peer_same_authority_postconfirm_failed',
        (durable) => {
          if (
            this.#publicationPaused
            || this.#activeBarrier !== null
            || !captureMatches(
              this.#appId,
              this.#record,
              previousCapture,
              { revision: true },
            )
          ) {
            throw coordinatorError(
              'SNAPBACK_CLIENT_AUTHORITY_STALE',
              'local custody changed during same-authority peer confirmation',
            );
          }
          this.#adoptSettled(durable, { expose: false });
          this.#exposePublication();
        },
      );
      return;
    }
    this.#publicationPaused = true;
    const durableIntent = record.transitionIntent;
    const context = Object.freeze(durableIntent ? {
      appId: this.#appId,
      ...clone(durableIntent),
      recovery: true,
    } : {
      appId: this.#appId,
      expectedEpoch: previous?.authorityEpoch ?? Math.max(0, record.authorityEpoch - 1),
      expectedAuthorityKey: previous?.phase === 'settled'
        ? canonicalAuthorityKey(this.#appId, previous.authority)
        : null,
      nextEpoch: record.authorityEpoch,
      nextAuthorityKey: canonicalAuthorityKey(this.#appId, record.authority),
      reason: 'peer_transition',
      disposition: 'delete',
      recovery: true,
      previousAuthority: clone(previous?.authority ?? null),
      nextAuthority: clone(record.authority),
    });
    const completion = barrierCompletion();
    this.#activeBarrier = {
      phase: 'peer_transition',
      context,
      completion,
      stagedPublications: [],
      cutGeneration: this.#destructiveCutGeneration,
      catchUp: {
        phases: ['quiesce', 'blank', 'clearMemory', 'commitDurable'],
        context,
      },
    };
    const barrierState = this.#activeBarrier;
    try {
      await this.#runAwaitedPhase('quiesce', context);
      this.#runSyncPhase('blank', context);
      this.#runSyncPhase('clearMemory', context);
      await this.#runAwaitedPhase('commitDurable', context);
      this.#adoptSettled(record, { expose: false });
      const resumeContext = Object.freeze({
        ...context,
        capture: captureFor(this.#appId, record),
        authority: clone(record.authority),
        stagePublication: (capture, commit) => this.#stagePublication(
          barrierState,
          capture,
          commit,
        ),
      });
      for (;;) {
        await this.#runAwaitedPhase('resume', resumeContext, { reverse: true });
        try {
          await this.#confirmDurableExact(
            captureFor(this.#appId, record),
            'peer_adoption_postconfirm_failed',
            () => {
              this.#assertBarrierPhaseClosure(
                barrierState,
                ['quiesce', 'blank', 'clearMemory', 'commitDurable', 'resume'],
              );
              this.#flushStagedPublications(barrierState, record);
              this.#assertBarrierPhaseClosure(
                barrierState,
                ['quiesce', 'blank', 'clearMemory', 'commitDurable', 'resume'],
              );
              this.#exposePublication();
            },
          );
          break;
        } catch (error) {
          if (!isBarrierPhaseClosureRetry(error)) throw error;
          await this.#prepareBarrierPhaseClosureRetry(barrierState, error);
        }
      }
    } catch (error) {
      this.#publicationPaused = true;
      this.#discardStagedPublications(barrierState);
      await this.#runSnapshottedDestructiveCut(
        context,
        { snapshot: this.#participants.filter((entry) => !entry.removed) },
      );
      if (isCounterExhaustion(error) || this.#counterExhaustionError) {
        throw this.#counterExhaustionError ?? error;
      }
      throw error;
    } finally {
      completion.resolve();
      if (this.#activeBarrier === barrierState) this.#activeBarrier = null;
    }
  }

  #invokeSyncParticipant(entry, method, context) {
    entry.callbackDepth += 1;
    entry.invocationDepth += 1;
    let result;
    try {
      result = participantMethod(entry.participant, method, context);
    } finally {
      entry.invocationDepth -= 1;
      entry.callbackDepth -= 1;
    }
    if (result && typeof result.then === 'function') {
      // Observe an invalid async return before rejecting the declared sync
      // phase. Otherwise a participant's rejected Promise becomes an
      // unrelated unhandled rejection after the barrier already failed.
      void Promise.resolve(result).catch(() => {});
      throw coordinatorError(
        'SNAPBACK_AUTH_PARTICIPANT_ASYNC_SYNC_PHASE',
        `participant ${entry.participant.name ?? entry.order} returned a promise from ${method}`,
      );
    }
    return result;
  }

  async #invokeAwaitedParticipant(entry, method, context) {
    entry.callbackDepth += 1;
    entry.invocationDepth += 1;
    let result;
    try {
      // Reentry is the synchronous act of a participant starting coordinator
      // work from its callback. Once the callback returns its promise, other
      // callers are external observers and must be allowed to join settlement
      // while that promise remains pending.
      result = participantMethod(entry.participant, method, context);
    } finally {
      entry.invocationDepth -= 1;
    }
    try {
      return await result;
    } finally {
      entry.callbackDepth -= 1;
    }
  }

  #startAwaitedParticipant(entry, method, context) {
    const call = Promise.resolve().then(() => (
      this.#invokeAwaitedParticipant(entry, method, context)
    ));
    entry.active = call.catch(() => {});
    return call;
  }

  #assertParticipantRegistrationsReady() {
    const failed = this.#participants.find((entry) => (
      !entry.removed && entry.registrationError
    ));
    if (failed) throw failed.registrationError;
  }

  #assertBarrierPhaseClosure(barrier, requiredPhases) {
    // @ref LLP 0059#transition-barrier — the final ownership fence closes both
    // durable custody and the per-registration phase set before exposure.
    if (this.#closed) {
      throw coordinatorError(
        'SNAPBACK_AUTH_COORDINATOR_CLOSED',
        'a closed auth coordinator cannot complete authority phase closure',
      );
    }
    if (barrier === null || this.#activeBarrier !== barrier) {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_STALE',
        'authority barrier changed before final phase closure',
      );
    }
    this.#assertParticipantRegistrationsReady();
    const cutChanged = barrier.cutGeneration !== this.#destructiveCutGeneration;
    if (
      cutChanged
      || this.#exhaustedWakeupCut !== null
      || this.#activeCutCompletions.size > 0
    ) {
      throw coordinatorError(
        BARRIER_PHASE_CLOSURE_RETRY,
        'a destructive cut overlapped final authority phase closure',
        { cutChanged: true },
      );
    }
    const missing = this.#participants.find((entry) => (
      !entry.removed
      && requiredPhases.some((phase) => !this.#phaseDone(barrier, entry, phase))
    ));
    if (missing) {
      throw coordinatorError(
        BARRIER_PHASE_CLOSURE_RETRY,
        'a participant registered before final authority phase closure',
        { cutChanged: false, participant: missing.participant.name ?? missing.order },
      );
    }
  }

  async #prepareBarrierPhaseClosureRetry(barrier, error) {
    if (!isBarrierPhaseClosureRetry(error)) throw error;
    for (;;) {
      const waits = new Set(this.#activeCutCompletions);
      if (this.#exhaustedWakeupCut !== null) waits.add(this.#exhaustedWakeupCut);
      if (waits.size === 0) break;
      await Promise.all([...waits]);
    }
    if (this.#counterExhaustionError) throw this.#counterExhaustionError;
    if (barrier.cutGeneration !== this.#destructiveCutGeneration) {
      this.#discardStagedPublications(barrier);
      for (const entry of this.#participants) {
        if (entry.barrier === barrier) entry.donePhases.clear();
      }
      barrier.cutGeneration = this.#destructiveCutGeneration;
    }
  }

  // Barrier phase completion is tracked per (barrier, participant entry) so a
  // participant registered mid-barrier is neither double-invoked nor skipped:
  // the awaited-phase loops pick up unmarked entries dynamically, and the
  // pre-resume catch-up runs any phase the entry missed entirely.
  #markPhaseDone(barrier, entry, method) {
    if (entry.barrier !== barrier) {
      entry.barrier = barrier;
      entry.donePhases = new Set();
    }
    entry.donePhases.add(method);
  }

  #phaseDone(barrier, entry, method) {
    return entry.barrier === barrier && entry.donePhases.has(method);
  }

  #runSyncPhase(method, context) {
    if (this.#counterExhaustionError) throw this.#counterExhaustionError;
    const barrier = this.#activeBarrier;
    barrier.phase = method;
    for (const entry of this.#participants) {
      if (entry.removed || this.#phaseDone(barrier, entry, method)) continue;
      if (entry.registrationError) throw entry.registrationError;
      this.#invokeSyncParticipant(entry, method, context);
      this.#markPhaseDone(barrier, entry, method);
    }
  }

  async #runAwaitedPhase(method, context, { reverse = false } = {}) {
    if (this.#counterExhaustionError) throw this.#counterExhaustionError;
    if (this.#closed && method !== 'quiesce') this.#assertUsable();
    const barrier = this.#activeBarrier;
    barrier.phase = method;
    for (;;) {
      if (this.#counterExhaustionError) throw this.#counterExhaustionError;
      if (this.#closed && method !== 'quiesce') this.#assertUsable();
      const ordered = reverse ? [...this.#participants].reverse() : [...this.#participants];
      const entry = ordered
        .find((candidate) => !candidate.removed && !this.#phaseDone(barrier, candidate, method));
      if (!entry) break;
      if (entry.registrationError) throw entry.registrationError;
      if (method === 'resume') {
        // @ref LLP 0059#transition-barrier — resume may not execute until the
        // participant's predecessor durable state is cleared: a registrant
        // that missed a globally completed phase (commitDurable in
        // particular) receives it here first, with the barrier's CAS context.
        await this.#catchUpBeforeResume(barrier, entry);
      }
      if (this.#closed && method !== 'quiesce') this.#assertUsable();
      const call = this.#startAwaitedParticipant(entry, method, context);
      await call;
      this.#markPhaseDone(barrier, entry, method);
    }
  }

  async #catchUpBeforeResume(barrier, entry) {
    if (!barrier.catchUp) return;
    const { phases, context } = barrier.catchUp;
    for (const method of phases) {
      if (this.#phaseDone(barrier, entry, method)) continue;
      if (this.#closed && method !== 'quiesce' && method !== 'blank' && method !== 'clearMemory') {
        this.#assertUsable();
      }
      barrier.phase = method;
      if (method === 'blank' || method === 'clearMemory') {
        this.#invokeSyncParticipant(entry, method, context);
      } else {
        const call = this.#startAwaitedParticipant(entry, method, context);
        await call;
      }
      this.#markPhaseDone(barrier, entry, method);
    }
    barrier.phase = 'resume';
  }

  #adoptSettled(record, { expose = true } = {}) {
    const validated = validateAuthCustody(record, this.#appId);
    if (validated.phase !== 'settled') throw corrupt('attempted to adopt non-settled custody');
    if (this.#record) {
      if (validated.authorityEpoch < this.#record.authorityEpoch || validated.revision < this.#record.revision) {
        throw corrupt('durable custody regressed relative to this context');
      }
    }
    this.#record = validated;
    if (expose) this.#exposePublication();
  }

  #publish(record) {
    const message = {
      formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
      appIdHash: this.#appIdHash,
      namespace: this.#channelNamespace,
      authorityEpoch: record.authorityEpoch,
      revision: record.revision,
      phase: record.phase,
    };
    try { this.#broadcast?.postMessage(message); } catch { /* wakeup loss is harmless */ }
    try {
      this.#hintStorage?.setItem?.(
        `snapback:auth-custody-hint:${this.#channelNamespace}`,
        JSON.stringify({
          formatVersion: message.formatVersion,
          appId: this.#appId,
          authorityEpoch: message.authorityEpoch,
          revision: message.revision,
          phase: message.phase,
        }),
      );
    } catch {
      // The hint is deliberately non-authoritative.
    }
  }

  #receiveWakeup(message) {
    const hasNamespace = message !== null
      && typeof message === 'object'
      && Object.hasOwn(message, 'namespace');
    const expectedKeys = hasNamespace
      ? ['formatVersion', 'appIdHash', 'namespace', 'authorityEpoch', 'revision', 'phase']
      : ['formatVersion', 'appIdHash', 'authorityEpoch', 'revision', 'phase'];
    if (
      !message
      || !hasExactKeys(message, expectedKeys)
      || message.formatVersion !== SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION
      || message.appIdHash !== this.#appIdHash
      || (hasNamespace
        ? message.namespace !== this.#channelNamespace
        : this.#storagePartition !== AUTH_DEFAULT_STORAGE_PARTITION)
      || !Number.isSafeInteger(message.authorityEpoch)
      || message.authorityEpoch < 0
      || !Number.isSafeInteger(message.revision)
      || message.revision < 1
      || !PHASES.has(message.phase)
    ) return;
    if (this.#record && message.revision <= this.#record.revision) return;
    if (message.phase === 'exhausted') {
      // Broadcast bytes are routing hints, never durable authority. Cut local
      // visibility eagerly, then reload under ownership; only #readOwned may
      // turn a validated durable marker/poison record into a permanent latch.
      const cut = this.#beginExhaustedWakeupCut(message);
      void cut
        .then(() => this.synchronize())
        .catch(() => { this.#publicationPaused = true; });
      return;
    }
    if (
      message.phase === 'clearing'
      || this.#record === null
      || message.authorityEpoch !== this.#record.authorityEpoch
    ) {
      // Stop new app-visible work synchronously; the durable reload is the
      // authority and runs asynchronously under cross-context ownership.
      this.#publicationPaused = true;
    }
    void this.synchronize().catch(() => { this.#publicationPaused = true; });
  }

  #beginExhaustedWakeupCut(message) {
    if (this.#exhaustedWakeupCut !== null) return this.#exhaustedWakeupCut;
    let finish;
    const gate = new Promise((resolve) => { finish = resolve; });
    // Install the gate before participant callbacks so their reentrant
    // operations cannot race the durable reload ahead of this terminal cut.
    this.#exhaustedWakeupCut = gate;
    const prior = this.#record;
    this.#publicationPaused = true;
    this.#discardStagedPublications(this.#activeBarrier);
    const previousAuthority = prior?.phase === 'settled' ? clone(prior.authority) : null;
    const context = Object.freeze({
      appId: this.#appId,
      expectedEpoch: prior?.authorityEpoch ?? message.authorityEpoch,
      expectedAuthorityKey: previousAuthority === null
        ? null
        : canonicalAuthorityKey(this.#appId, previousAuthority),
      nextEpoch: message.authorityEpoch,
      nextAuthorityKey: null,
      reason: 'auth_counter_exhausted_wakeup',
      disposition: 'delete',
      recovery: true,
      previousAuthority,
      nextAuthority: null,
    });
    const snapshot = this.#participants.filter((entry) => !entry.removed);
    void this.#runSnapshottedDestructiveCut(
      context,
      { snapshot, initialBlank: true },
    ).finally(() => {
      if (this.#exhaustedWakeupCut === gate) this.#exhaustedWakeupCut = null;
      finish();
    });
    return gate;
  }

  #barrierContext() {
    return Object.freeze({
      appId: this.#appId,
      expectedEpoch: this.#record ? Math.max(0, this.#record.authorityEpoch - 1) : 0,
      expectedAuthorityKey: null,
      nextEpoch: this.#record?.authorityEpoch ?? 0,
      nextAuthorityKey: this.#record?.phase === 'settled'
        ? canonicalAuthorityKey(this.#appId, this.#record.authority)
        : this.#record?.pendingAuthority
          ? canonicalAuthorityKey(this.#appId, this.#record.pendingAuthority)
          : null,
      reason: 'registration_while_blank',
      disposition: 'delete',
    });
  }

  #assertUsable() {
    if (this.#closed) throw coordinatorError('SNAPBACK_AUTH_COORDINATOR_CLOSED', 'auth coordinator is closed');
    if (this.#counterExhaustionError) throw this.#counterExhaustionError;
  }

  async #joinAuthorityOperationBarrier() {
    this.#assertOperationAllowed();
    const barrier = this.#activeBarrier;
    if (barrier === null) return;
    const insideParticipantCallback = this.#participants.some((entry) => (
      entry.invocationDepth > 0
    ));
    if (insideParticipantCallback) {
      // Successor resume is allowed to confirm the exact authority the active
      // barrier already installed. Every earlier participant phase must refuse
      // promptly: joining a barrier from work that barrier awaits deadlocks.
      if (barrier.phase === 'resume' && this.#record?.phase === 'settled') return;
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
        'authority operation cannot reenter an active participant barrier',
      );
    }
    // @ref LLP 0059#cross-context-ownership — external authority operations
    // join local settlement; only participant reentry receives prompt refusal.
    await barrier.completion.promise;
    this.#assertOperationAllowed();
    if (this.#activeBarrier !== null) await this.#joinAuthorityOperationBarrier();
  }

  #assertOperationAllowed() {
    this.#assertUsable();
    if (this.#inCommit) {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT',
        'coordinator operations are forbidden inside compareAndCommit',
      );
    }
    if (this.#exhaustedWakeupCut !== null) {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
        'durable custody is reloading after an exhausted wakeup',
      );
    }
  }
}
