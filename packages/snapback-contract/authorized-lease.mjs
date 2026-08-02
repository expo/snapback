// Item-8 AuthorizedLease wire validation and client-deadline derivation.
//
// @ref LLP 0053#the-lease-the-only-mechanism-for-the-unreachable-client — a
// retained session result is readable only inside the exact server-issued
// lease and the request-started client interval; neither heartbeat nor delta
// delivery can renew it.
//
// Verification locus (ENG-24992): this module is CLIENT CUSTODY validation.
// It promises exactly structural validation of the closed envelope (including
// canonical base64url MAC form), binding equality against the current query
// authority, clamp/duration arithmetic, expiry derivation, and — through
// `authorizedLeaseHash` — post-commit corruption/substitution detection over
// the exact issued bytes. It cannot and does not verify `mac`/`keyId`
// cryptographically: the HMAC key is a server secret, so a canonically shaped
// forged MAC passes here by design and is refused by the server's keyed
// verifier (`verify_for_service`), where unknown keys fail closed.

import {
  validateAuthorizationVersion,
  validateIssuerId,
} from './auth-invalidation.mjs';
import { isMintedIdentifier } from './ids.mjs';

export const SNAPBACK_AUTHORIZED_LEASE_PROTOCOL_VERSION = 1;
export const SNAPBACK_AUTHORIZED_LEASE_DEFAULT_MS = 86_400_000;
export const SNAPBACK_AUTHORIZED_LEASE_HARD_MAX_MS = 86_400_000;

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const MAC_SHA256 = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const ACTIVATION_HASH = /^snapback\.authorized-lease\.activation\.v1:sha256:[0-9a-f]{64}$/;

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const utf8Length = (value) => new TextEncoder().encode(value).length;

const ACTIVATION_HASH_DOMAIN = 'snapback.authorized-lease.activation.v1';

function leaseError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message, details };
  return error;
}

const corrupt = (message, details = {}) => leaseError(
  'SNAPBACK_AUTHORIZED_LEASE_CORRUPT',
  message,
  details,
);

function exact(value, fields, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw corrupt(`${path} must be an object`, { field: path });
  }
  const keys = Reflect.ownKeys(value);
  const allowed = new Set(fields);
  if (
    keys.length !== fields.length
    || !fields.every((field) => Object.hasOwn(value, field))
    || !keys.every((key) => typeof key === 'string' && allowed.has(key))
  ) {
    throw corrupt(`${path} has missing or unknown fields`, { field: path });
  }
}

function safeInteger(value, path, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw corrupt(`${path} must be a safe ${positive ? 'positive' : 'nonnegative'} integer`, {
      field: path,
    });
  }
  return value;
}

function opaque(value, path) {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
    throw corrupt(`${path} must be a canonical opaque id`, { field: path });
  }
  return value;
}

function optionalOpaque(value, path) {
  return value === null ? null : opaque(value, path);
}

function optionalTimestamp(value, path) {
  return value === null ? null : safeInteger(value, path, { positive: true });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

// Synchronous SHA-256 keeps the lease commit a single serialized client-store
// transaction in browsers and native shells without a second async authority
// window.
function sha256(input) {
  const bytes = Array.from(input);
  const bitLength = BigInt(bytes.length) * 8n;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  for (let shift = 56n; shift >= 0n; shift -= 8n) {
    bytes.push(Number((bitLength >> shift) & 0xffn));
  }
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
    0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
    0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
    0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
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
      const t2 = (sum0 + maj + t1) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = t2;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((word) => word.toString(16).padStart(8, '0')).join('');
}

// Cross-language activation identity used by the client store before it can
// accept a server-issued lease. Rust's `authorized_lease_activation_hash`
// prefixes every UTF-8 field with its unsigned 64-bit big-endian byte length;
// keeping that framing here avoids ambiguous concatenation and pins retained
// bytes to the exact active schema/function pair.
//
// @ref LLP 0053#the-lease-the-only-mechanism-for-the-unreachable-client —
// retained snapshots are usable only under the exact active deployment.
export function authorizedLeaseActivationHash({
  schemaVersion,
  authMode,
  appId,
  schemaHash,
  bundleHash,
  inputsHash,
}) {
  const fields = [
    ACTIVATION_HASH_DOMAIN,
    schemaVersion,
    authMode,
    appId,
    schemaHash,
    bundleHash,
    inputsHash,
  ];
  const encoder = new TextEncoder();
  const chunks = fields.map((value, index) => {
    if (typeof value !== 'string' || value.length === 0) {
      const names = [
        'domain',
        'schemaVersion',
        'authMode',
        'appId',
        'schemaHash',
        'bundleHash',
        'inputsHash',
      ];
      throw new TypeError(`authorized lease activation requires a non-empty ${names[index]}`);
    }
    const bytes = encoder.encode(value);
    const length = new Uint8Array(8);
    let remaining = BigInt(bytes.length);
    for (let at = 7; at >= 0; at -= 1) {
      length[at] = Number(remaining & 0xffn);
      remaining >>= 8n;
    }
    return [length, bytes];
  });
  const total = chunks.reduce((sum, [length, bytes]) => sum + length.length + bytes.length, 0);
  const framed = new Uint8Array(total);
  let offset = 0;
  for (const [length, bytes] of chunks) {
    framed.set(length, offset);
    offset += length.length;
    framed.set(bytes, offset);
    offset += bytes.length;
  }
  return `${ACTIVATION_HASH_DOMAIN}:sha256:${sha256(framed)}`;
}

export function validateAuthorizedLease(value, path = 'authorizedLease') {
  exact(value, [
    'protocolVersion',
    'leaseId',
    'leaseRequestId',
    'issuerId',
    'clientStoreId',
    'queryKey',
    'queryInstanceId',
    'principalId',
    'sessionIdAtIssue',
    'providerKey',
    'authorization',
    'data',
    'activationHash',
    'issuedAtServerMs',
    'authorizedUntilServerMs',
    'sessionNotAfterMs',
    'providerNotAfterMs',
    'authorityInstanceId',
    'keyId',
    'mac',
  ], path);
  if (value.protocolVersion !== SNAPBACK_AUTHORIZED_LEASE_PROTOCOL_VERSION) {
    throw leaseError(
      'SNAPBACK_AUTHORIZED_LEASE_CLIENT_UNSUPPORTED',
      'authorized lease protocol version is unsupported',
      { received: value.protocolVersion ?? null },
    );
  }
  exact(value.data, ['versionStream', 'snapshotCommitVersion'], `${path}.data`);
  const issuedAtServerMs = safeInteger(value.issuedAtServerMs, `${path}.issuedAtServerMs`);
  const authorizedUntilServerMs = safeInteger(
    value.authorizedUntilServerMs,
    `${path}.authorizedUntilServerMs`,
    { positive: true },
  );
  const durationMs = authorizedUntilServerMs - issuedAtServerMs;
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > SNAPBACK_AUTHORIZED_LEASE_HARD_MAX_MS) {
    throw corrupt(`${path} duration exceeds the positive 24-hour hard maximum`, {
      field: `${path}.authorizedUntilServerMs`,
    });
  }
  const sessionNotAfterMs = optionalTimestamp(value.sessionNotAfterMs, `${path}.sessionNotAfterMs`);
  const providerNotAfterMs = optionalTimestamp(value.providerNotAfterMs, `${path}.providerNotAfterMs`);
  if (value.sessionIdAtIssue !== null && sessionNotAfterMs === null) {
    throw corrupt(`${path}.sessionNotAfterMs is required for a session lease`, {
      field: `${path}.sessionNotAfterMs`,
    });
  }
  for (const [field, clamp] of [
    ['sessionNotAfterMs', sessionNotAfterMs],
    ['providerNotAfterMs', providerNotAfterMs],
  ]) {
    if (clamp !== null && authorizedUntilServerMs > clamp) {
      throw corrupt(`${path}.${field} does not clamp the authorized deadline`, {
        field: `${path}.${field}`,
      });
    }
  }
  // Leases issued before LLP 0148 permanently retain their UUIDv7 authority
  // instance; current servers issue the same identifier family as `aut_` plus
  // a Crockford body. Neither spelling is load-bearing for routing.
  // @ref LLP 0148#d4-the-prefix-is-never-load-bearing — accept both eras
  if (
    value.authorityInstanceId !== null
    && !isMintedIdentifier(value.authorityInstanceId ?? '')
  ) {
    throw corrupt(`${path}.authorityInstanceId must be null or a canonical Snapback identifier`, {
      field: `${path}.authorityInstanceId`,
    });
  }
  // Canonical FORM only — 43 base64url chars encoding exactly 256 bits. The
  // client holds no verifier key, so cryptographic validity is the server's
  // check; substitution after commit is caught by `authorizedLeaseHash`.
  // @ref LLP 0053#the-lease-the-only-mechanism-for-the-unreachable-client —
  // verification locus: server keyring authenticates mac/keyId, unknown keys
  // fail closed there.
  if (typeof value.mac !== 'string' || !MAC_SHA256.test(value.mac)) {
    throw corrupt(`${path}.mac must be a canonical SHA-256 base64url value`, {
      field: `${path}.mac`,
    });
  }
  return Object.freeze({
    protocolVersion: SNAPBACK_AUTHORIZED_LEASE_PROTOCOL_VERSION,
    leaseId: opaque(value.leaseId, `${path}.leaseId`),
    leaseRequestId: opaque(value.leaseRequestId, `${path}.leaseRequestId`),
    issuerId: validateIssuerId(value.issuerId, `${path}.issuerId`),
    clientStoreId: opaque(value.clientStoreId, `${path}.clientStoreId`),
    queryKey: typeof value.queryKey === 'string'
      && value.queryKey.length > 0
      && utf8Length(value.queryKey) <= 8_192
      ? value.queryKey
      : (() => { throw corrupt(`${path}.queryKey is invalid`, { field: `${path}.queryKey` }); })(),
    queryInstanceId: safeInteger(value.queryInstanceId, `${path}.queryInstanceId`, { positive: true }),
    principalId: opaque(value.principalId, `${path}.principalId`),
    sessionIdAtIssue: optionalOpaque(value.sessionIdAtIssue, `${path}.sessionIdAtIssue`),
    providerKey: optionalOpaque(value.providerKey, `${path}.providerKey`),
    authorization: validateAuthorizationVersion(value.authorization, `${path}.authorization`),
    data: Object.freeze({
      versionStream: opaque(value.data.versionStream, `${path}.data.versionStream`),
      snapshotCommitVersion: safeInteger(
        value.data.snapshotCommitVersion,
        `${path}.data.snapshotCommitVersion`,
      ),
    }),
    activationHash: typeof value.activationHash === 'string' && ACTIVATION_HASH.test(value.activationHash)
      ? value.activationHash
      : (() => {
          throw corrupt(`${path}.activationHash is not canonical`, {
            field: `${path}.activationHash`,
          });
        })(),
    issuedAtServerMs,
    authorizedUntilServerMs,
    sessionNotAfterMs,
    providerNotAfterMs,
    authorityInstanceId: value.authorityInstanceId,
    keyId: opaque(value.keyId, `${path}.keyId`),
    mac: value.mac,
  });
}

// Unkeyed custody hash over the exact issued lease bytes. Stored at commit
// and compared before every retained read, it detects post-commit corruption
// or substitution (any changed byte — including one flipped MAC bit — changes
// it and forces delete-before-read). It is not a forgery detector; see the
// module header for the verification locus.
export function authorizedLeaseHash(value) {
  const lease = validateAuthorizedLease(value);
  const bytes = new TextEncoder().encode(
    `snapback.authorized-lease.hash.v1\n${JSON.stringify(canonical(lease))}`,
  );
  return `sha256:${sha256(bytes)}`;
}

export function deriveAuthorizedLeaseCommit({ lease: leaseValue, request, expected, clientNowMs }) {
  const lease = validateAuthorizedLease(leaseValue);
  exact(request, [
    'leaseRequestId',
    'queryInstanceId',
    'queryGeneration',
    'startedClientMs',
  ], 'leaseRequest');
  exact(expected, [
    'clientStoreId',
    'queryKey',
    'queryInstanceId',
    'principalId',
    'authorization',
    'versionStream',
    'activationHash',
    'authorityInstanceId',
  ], 'leaseExpectation');
  const startedClientMs = safeInteger(request.startedClientMs, 'leaseRequest.startedClientMs');
  safeInteger(request.queryGeneration, 'leaseRequest.queryGeneration');
  safeInteger(clientNowMs, 'clientNowMs');
  const matches = (
    lease.leaseRequestId === request.leaseRequestId
    && lease.queryInstanceId === request.queryInstanceId
    && lease.clientStoreId === expected.clientStoreId
    && lease.queryKey === expected.queryKey
    && lease.queryInstanceId === expected.queryInstanceId
    && lease.principalId === expected.principalId
    && JSON.stringify(lease.authorization) === JSON.stringify(
      validateAuthorizationVersion(expected.authorization, 'leaseExpectation.authorization'),
    )
    && lease.data.versionStream === expected.versionStream
    && lease.activationHash === expected.activationHash
    && lease.authorityInstanceId === expected.authorityInstanceId
  );
  if (!matches) {
    throw leaseError(
      'SNAPBACK_AUTHORIZED_LEASE_BINDING_MISMATCH',
      'authorized lease does not bind the current query authority',
    );
  }
  const durationMs = lease.authorizedUntilServerMs - lease.issuedAtServerMs;
  const clientDeadlineMs = startedClientMs + durationMs;
  if (!Number.isSafeInteger(clientDeadlineMs) || clientDeadlineMs <= startedClientMs) {
    throw corrupt('authorized lease client deadline overflows', { field: 'clientDeadlineMs' });
  }
  if (clientNowMs >= clientDeadlineMs) {
    throw leaseError(
      'SNAPBACK_AUTHORIZED_LEASE_EXPIRED',
      'authorized lease expired before its snapshot could commit',
    );
  }
  return Object.freeze({
    lease: clone(lease),
    leaseHash: authorizedLeaseHash(lease),
    clientDeadlineMs,
  });
}

export function validateAuthorizedLeaseCapability(value, path = 'authorizedLease') {
  exact(value, [
    'protocolVersion',
    'defaultMs',
    'hardMaxMs',
    'configuredMs',
    'clamps',
    'renewal',
    'timeBasis',
    'clockRollback',
  ], path);
  if (
    value.protocolVersion !== SNAPBACK_AUTHORIZED_LEASE_PROTOCOL_VERSION
    || value.defaultMs !== SNAPBACK_AUTHORIZED_LEASE_DEFAULT_MS
    || value.hardMaxMs !== SNAPBACK_AUTHORIZED_LEASE_HARD_MAX_MS
    || !Number.isSafeInteger(value.configuredMs)
    || value.configuredMs <= 0
    || value.configuredMs > SNAPBACK_AUTHORIZED_LEASE_HARD_MAX_MS
    || JSON.stringify(value.clamps) !== JSON.stringify(['session', 'provider'])
    || value.renewal !== 'full-revalidation'
    || value.timeBasis !== 'server-absolute+client-request-elapsed'
    || value.clockRollback !== 'delete-before-read'
  ) {
    throw leaseError(
      'SNAPBACK_AUTHORIZED_LEASE_CLIENT_UNSUPPORTED',
      'authorized lease capability facts are unsupported',
    );
  }
  return Object.freeze(clone(value));
}
