// Prefixed identifiers, JavaScript half. Mirrors `src/ids.rs`.
//
// The prefix is for humans and for fail-fast shape checks. Nothing branches on
// it for a trust, routing, or table-selection decision.
//
// The prefix constants below are duplicated from the Rust registry rather than
// read from `schemas/id-registry.v1.json`, because that file is a repo-root
// build artifact and this module ships inside a published package. The
// duplication is gated: `ids.test.mjs` fails if these constants drift from the
// generated registry, so the copy cannot silently diverge.
//
// @ref LLP 0148#d1-grammar — prefix `_` 26-character Crockford base32 body
// @ref LLP 0148#d5-one-registry-one-minting-helper

// Crockford base32, lowercase: no `i`/`l`/`o`/`u` (transcription), no `-`/`_`
// (so an id is one double-click-selectable word), and in ASCII order (so a
// fixed-width body sorts lexically in the same order as the bytes it encodes).
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const PREFIXED_ID = /^[a-z][a-z0-9]{0,11}_[0-9a-hjkmnp-tv-z]{26}$/;

export const BODY_LENGTH = 26;
export const MAX_PREFIX_LENGTH = 12;

/// The prefixes this arm mints. The Rust registry is the full vocabulary; the
/// JavaScript client only ever mints these.
export const ID_PREFIXES = /* @__PURE__ */ Object.freeze({
  mutation: 'mut',
  lease: 'lse',
  // Derived (not minted) by `serviceAuthorityInstanceId` in
  // auth-coordinator.mjs, which must agree byte-for-byte with the Rust half.
  authorityInstance: 'aut',
  opaque: 'id',
});

// A monotone per-process counter so the non-crypto fallback below cannot
// repeat within a millisecond.
let fallbackCounter = 0;

// Uniqueness without unpredictability, for time-ordered ids only.
//
// React Native/Hermes ships no WebCrypto, and the LLP 0043 M2 offline queue
// has to keep minting mutation ids there — a client mutation id is an
// exactly-once dedup key, not a secret, so uniqueness is the whole
// requirement. Random-body ids (`usr_`) never reach this path: they are
// security-bearing and refuse instead.
const uniqueBytesWithoutCrypto = (count) => {
  const out = new Uint8Array(count);
  fallbackCounter = (fallbackCounter + 1) >>> 0;
  let mixed = BigInt(fallbackCounter) ^ (BigInt(Date.now()) << 21n);
  for (let index = 0; index < count; index += 1) {
    if (index % 4 === 0) {
      mixed ^= BigInt(Math.floor(Math.random() * 0x1_0000_0000)) << BigInt((index % 8) * 8);
    }
    out[index] = Number((mixed >> BigInt((index % 8) * 8)) & 0xffn);
  }
  return out;
};

// Security-bearing random identity is never synthesized from Math.random —
// when the WebCrypto RNG is absent those mints refuse with ONE named,
// actionable code instead of the carrier's bare "Cannot read property
// 'getRandomValues' of undefined". Same code and guidance as
// `cryptoRandomSource` in packages/snapback-client/index.mjs, so an RN boot
// failure reads the same wherever it surfaces.
const randomBytes = (count, { securityBearing }) => {
  const source = globalThis.crypto;
  if (typeof source?.getRandomValues !== 'function' && !securityBearing) {
    return uniqueBytesWithoutCrypto(count);
  }
  if (typeof source?.getRandomValues !== 'function') {
    const code = 'SNAPBACK_CLIENT_WEBCRYPTO_RNG_MISSING';
    const message = 'minting an identifier requires crypto.getRandomValues, which this '
      + 'runtime does not provide (React Native/Hermes ships no WebCrypto). Install an '
      + 'RNG polyfill before constructing the client — Expo: expo-crypto '
      + '(import its getRandomValues polyfill), bare RN: react-native-get-random-values.';
    const error = new Error(`${code}: ${message}`);
    error.code = code;
    error.diagnostic = { code, message };
    throw error;
  }
  const out = new Uint8Array(count);
  source.getRandomValues(out);
  return out;
};

/// 16 bytes to 26 lowercase Crockford base32 characters, most significant
/// first. The exact encoding `encode_body` produces in `src/ids.rs`.
export function encodeBody(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) {
    throw new TypeError('snapback: an id body is exactly 16 bytes');
  }
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = '';
  // 26 * 5 = 130 bits over a 128-bit value, so the leading character carries
  // only the top 3 bits.
  for (let i = 0; i < BODY_LENGTH; i += 1) {
    out = ALPHABET[Number(value & 0x1fn)] + out;
    value >>= 5n;
  }
  return out;
}

/// UUIDv7 bytes: 48-bit big-endian millisecond timestamp, version 7, variant
/// 10, random elsewhere. Time-ordered, so ids sort chronologically.
function timeOrderedBytes(nowMs = Date.now()) {
  // Not security-bearing: the body is mostly a timestamp and the tail only has
  // to be unique, so this still mints on a cryptoless carrier.
  const bytes = randomBytes(16, { securityBearing: false });
  const stamp = BigInt(Math.max(0, Math.trunc(nowMs)));
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((stamp >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  return bytes;
}

/// Mint a time-ordered id under `prefix`.
export function mintId(prefix, nowMs = Date.now()) {
  if (typeof prefix !== 'string' || !/^[a-z][a-z0-9]{0,11}$/.test(prefix)) {
    throw new TypeError(`snapback: ${JSON.stringify(prefix)} is not a valid id prefix`);
  }
  return `${prefix}_${encodeBody(timeOrderedBytes(nowMs))}`;
}

/// Split a well-formed id into `{ prefix, body }`.
///
/// `null` means "not in this format", which includes every id written before
/// LLP 0148 landed. That is ordinary, not an error — readers accept both.
export function splitId(id) {
  if (typeof id !== 'string' || !PREFIXED_ID.test(id)) return null;
  const cut = id.lastIndexOf('_');
  return { prefix: id.slice(0, cut), body: id.slice(cut + 1) };
}

/// Whether `id` is a canonically spelled LLP 0148 identifier. Advisory: a
/// `false` may refuse a shape at an input boundary and nothing else.
export const isWellFormedId = (id) =>
  typeof id === 'string' && PREFIXED_ID.test(id);

/// The canonical hyphenated UUIDv7 every Snapback id carried before LLP 0148.
export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/// Whether `value` is a Snapback-minted identifier in **either** spelling.
///
/// The predicate every stored-state and wire validator wants. There is no
/// backfill, so a client resuming against a database written before LLP 0148
/// still sees hyphenated ids, and a validator that accepted only the new
/// spelling would reject data Snapback itself wrote.
///
/// Not for `authorizationStreamIncarnation`, which keeps its strict UUIDv7
/// contract — it is an opaque incarnation marker with its own persisted
/// format, not an object id (LLP 0148 §Consequences).
export const isMintedIdentifier = (value) =>
  isWellFormedId(value) || UUID_V7.test(value ?? '');

/// An app document's prefix: its declared table name, ASCII-lowercased, with
/// non-alphanumerics removed, truncated to `MAX_PREFIX_LENGTH`. Mirrors
/// `table_prefix` in `src/ids.rs`.
export function tablePrefix(table) {
  const reduced = [...String(table)]
    .filter((char) => /[A-Za-z0-9]/.test(char))
    .join('')
    .toLowerCase()
    .slice(0, MAX_PREFIX_LENGTH);
  return /^[a-z]/.test(reduced) ? reduced : ID_PREFIXES.opaque;
}
