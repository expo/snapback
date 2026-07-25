// RQS token/digest cryptography — the JS arm of LLP 0091's 0A contract.
//
// Byte-compatible with src/rqs.rs; the cross-language parity obligations run
// in rqs-digest-parity.test.mjs against tests/fixtures/rqs-parity-v1.json.
// Dependency-free (pure-JS SHA-256/HMAC) so the same module runs in browsers,
// workers, and the socket-less Channel C surfaces without node:crypto.
//
// @ref LLP 0091#0a--token-and-digest-cryptography — JCS canonicalization,
//   row hash, length-framed leaf, LtHash-16 mset1, seq1, MAC transcript.

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4) and HMAC — pure JS, synchronous.
// ---------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(bytes) {
  const length = bytes.length;
  const bitLength = length * 8;
  const padded = new Uint8Array(((length + 8) >> 6 << 6) + 64);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i += 1) outView.setUint32(i * 4, h[i]);
  return out;
}

export function hmacSha256(key, message) {
  let keyBytes = key;
  if (keyBytes.length > 64) keyBytes = sha256(keyBytes);
  const ipad = new Uint8Array(64 + message.length);
  const opad = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i += 1) {
    const byte = i < keyBytes.length ? keyBytes[i] : 0;
    ipad[i] = byte ^ 0x36;
    opad[i] = byte ^ 0x5c;
  }
  ipad.set(message, 64);
  opad.set(sha256(ipad), 64);
  return sha256(opad);
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function u64be(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value));
  return out;
}

function u32be(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

export function base64UrlNoPad(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return encoded.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// RFC 8785 (JCS) canonicalization with the LLP 0091 §0A.2 mint refusals.
// ---------------------------------------------------------------------------

export class RqsMintRefusal extends Error {
  constructor(reason) {
    super(`rqs mint refusal: ${reason}`);
    this.name = 'RqsMintRefusal';
    this.reason = reason;
  }
}

function jcsEscape(value) {
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (code === 0x08) out += '\\b';
    else if (code === 0x0c) out += '\\f';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

function assertWellFormed(value) {
  // Lone surrogates cannot round-trip; refuse at mint (Rust strings cannot
  // hold them, so the JS arm owns this refusal).
  if (typeof value.isWellFormed === 'function' ? !value.isWellFormed() : /[\uD800-\uDFFF]/.test(value) && !value.match(/^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/)) {
    throw new RqsMintRefusal('lone surrogate');
  }
}

function jcsNumber(value) {
  if (!Number.isFinite(value)) throw new RqsMintRefusal('non-finite number');
  // Integral values in the (2^53-1, 1e21) band are indistinguishable from
  // lossy big-integer JSON literals after parse, so both arms refuse the
  // band (see src/rqs.rs jcs_into for the shared rule). At and above 1e21
  // the ES exponent form is canonical and unambiguously double semantics.
  if (
    Number.isInteger(value)
    && Math.abs(value) > Number.MAX_SAFE_INTEGER
    && Math.abs(value) < 1e21
  ) {
    throw new RqsMintRefusal('unsafe integer');
  }
  if (Object.is(value, -0)) return '0';
  // ECMAScript Number::toString IS the RFC 8785 number serialization.
  return String(value);
}

function compareUtf16(a, b) {
  // Default string comparison in JS is already by UTF-16 code units.
  return a < b ? -1 : a > b ? 1 : 0;
}

export function jcs(value) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  const kind = typeof value;
  if (kind === 'number') return jcsNumber(value);
  if (kind === 'bigint') {
    if (value > 9007199254740991n || value < -9007199254740991n) {
      throw new RqsMintRefusal('unsafe integer');
    }
    return value.toString();
  }
  if (kind === 'string') {
    assertWellFormed(value);
    return jcsEscape(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => jcs(entry === undefined ? null : entry)).join(',')}]`;
  }
  if (kind === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined);
    keys.sort(compareUtf16);
    for (const key of keys) assertWellFormed(key);
    return `{${keys.map((key) => `${jcsEscape(key)}:${jcs(value[key])}`).join(',')}}`;
  }
  throw new RqsMintRefusal(`unsupported value type ${kind}`);
}

export function jcsBytes(value) {
  return encoder.encode(jcs(value));
}

// ---------------------------------------------------------------------------
// Row hash, leaf, mset1 (LtHash-16), seq1.
// ---------------------------------------------------------------------------

const ROW_TAG = encoder.encode('snapback-rqs-row-v1\0');
const LEAF_TAG = encoder.encode('snapback-rqs-leaf-v1\0');
const XOF_TAG = encoder.encode('snapback-rqs-xof-v1\0');
const STATE_TAG = encoder.encode('snapback-rqs-state-v1\0');
const SEQ_TAG = encoder.encode('snapback-rqs-seq-v1\0');
const ARGS_TAG = encoder.encode('snapback-rqs-args-v1\0');
const MAC_DOMAIN = 'snapback.resume-token.v1';

export function rowHash(row) {
  return sha256(concatBytes(ROW_TAG, jcsBytes(row)));
}

export function leaf(rowId, rowHashBytes) {
  const idBytes = encoder.encode(rowId);
  return sha256(concatBytes(LEAF_TAG, u64be(idBytes.length), idBytes, rowHashBytes));
}

export function rowWireId(row) {
  const id = row?._id;
  return typeof id === 'string' ? id : null;
}

function expandLeaf(leafBytes) {
  const lanes = new Uint16Array(1024);
  for (let block = 0; block < 64; block += 1) {
    const digest = sha256(concatBytes(XOF_TAG, leafBytes, u32be(block)));
    for (let lane = 0; lane < 16; lane += 1) {
      // Little-endian u16 lanes (LLP 0091 §0A.4).
      lanes[block * 16 + lane] = digest[2 * lane] | (digest[2 * lane + 1] << 8);
    }
  }
  return lanes;
}

export function mset1Empty() {
  return new Uint16Array(1024);
}

export function mset1Add(state, leafBytes) {
  const expanded = expandLeaf(leafBytes);
  for (let i = 0; i < 1024; i += 1) state[i] = (state[i] + expanded[i]) & 0xffff;
  return state;
}

export function mset1Remove(state, leafBytes) {
  const expanded = expandLeaf(leafBytes);
  for (let i = 0; i < 1024; i += 1) state[i] = (state[i] - expanded[i]) & 0xffff;
  return state;
}

export function mset1Root(state) {
  const bytes = new Uint8Array(2048);
  for (let i = 0; i < 1024; i += 1) {
    bytes[2 * i] = state[i] & 0xff;
    bytes[2 * i + 1] = state[i] >> 8;
  }
  return `mset1:${hex(sha256(concatBytes(STATE_TAG, bytes)))}`;
}

export function seq1Digest(rows) {
  return `seq1:${hex(sha256(concatBytes(SEQ_TAG, jcsBytes(rows))))}`;
}

export function argsHash(args) {
  return `sha256:${hex(sha256(concatBytes(ARGS_TAG, jcsBytes(args))))}`;
}

/// Compute the published content digest of a held row set for the kind named
/// by a digest's self-describing prefix ("mset1" | "seq1").
export function digestOfRows(kind, rows) {
  if (kind === 'seq1') return seq1Digest(rows);
  if (kind !== 'mset1') throw new RqsMintRefusal(`unknown digest kind ${kind}`);
  const state = mset1Empty();
  const seen = new Set();
  for (const row of rows) {
    const id = rowWireId(row);
    if (id === null) throw new RqsMintRefusal('row id missing');
    if (seen.has(id)) throw new RqsMintRefusal('duplicate row id');
    seen.add(id);
    mset1Add(state, leaf(id, rowHash(row)));
  }
  return mset1Root(state);
}

export function digestKindOf(contentDigest) {
  const prefix = String(contentDigest).split(':', 1)[0];
  return prefix === 'mset1' || prefix === 'seq1' ? prefix : null;
}

/// Rung-2 witness entry cap (LLP 0091 rung-2 amendment default; the server
/// enforces its own policy knob and refuses oversize witnesses to rung 3).
export const RQS_WITNESS_MAX_ENTRIES = 4096;

/// Build the rung-2 membership witness for a held `mset1` result (LLP 0090
/// D1.3 / LLP 0091 rung-2 amendment): exact (rowId, oldRowHash) pairs in
/// ascending UTF-16 id order with an explicit count. Returns null when the
/// result is not witnessable — wrong digest kind, over the entry cap, a
/// mint-refusable row, or rows that do not reproduce `contentDigest` (a
/// witness the server would refuse is never worth sending; the resume still
/// proceeds on rung 1 or rung 3).
export function membershipWitnessOfRows(rows, contentDigest, {
  maxEntries = RQS_WITNESS_MAX_ENTRIES,
} = {}) {
  if (digestKindOf(contentDigest) !== 'mset1') return null;
  if (!Array.isArray(rows) || rows.length > maxEntries) return null;
  try {
    const state = mset1Empty();
    const seen = new Set();
    const entries = [];
    for (const row of rows) {
      const id = rowWireId(row);
      if (id === null || seen.has(id)) return null;
      seen.add(id);
      const hash = rowHash(row);
      mset1Add(state, leaf(id, hash));
      entries.push({ id, oldRowHash: base64UrlNoPad(hash) });
    }
    if (mset1Root(state) !== contentDigest) return null;
    entries.sort((a, b) => compareUtf16(a.id, b.id));
    return { count: entries.length, entries };
  } catch (error) {
    if (error instanceof RqsMintRefusal) return null;
    throw error;
  }
}

/// Verify held rows against a resume meta's content digest. Returns true on
/// match; a mint refusal inside the recompute counts as a mismatch (the
/// transition table's discard-and-resubscribe path, LLP 0091 §0B.3 T7).
export function rowsMatchDigest(rows, contentDigest) {
  const kind = digestKindOf(contentDigest);
  if (kind === null) return false;
  try {
    return digestOfRows(kind, rows) === contentDigest;
  } catch (error) {
    if (error instanceof RqsMintRefusal) return false;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Token MAC transcript + wire mint (parity obligations; the browser client
// never mints — servers do — but the transcript must be byte-identical).
// ---------------------------------------------------------------------------

function putString(parts, value) {
  const bytes = encoder.encode(value);
  parts.push(u64be(bytes.length), bytes);
}

function putU64(parts, value) {
  parts.push(u64be(value));
}

function putOptionalString(parts, value) {
  if (value === null || value === undefined) parts.push(new Uint8Array([0x00]));
  else {
    parts.push(new Uint8Array([0x01]));
    putString(parts, value);
  }
}

export function tokenTranscript(keyId, body) {
  const parts = [];
  putString(parts, MAC_DOMAIN);
  putString(parts, keyId);
  putString(parts, body.app);
  putString(parts, body.generation);
  putString(parts, body.versionStream);
  putU64(parts, body.version);
  putString(parts, body.queryArtifact);
  putString(parts, body.argsHash);
  putString(parts, body.digestKind);
  putString(parts, body.contentDigest);
  putU64(parts, body.issuedAt);
  putOptionalString(parts, body.authPartition ?? null);
  return concatBytes(...parts);
}

export function mintTokenWire(key, keyId, body) {
  const mac = hmacSha256(key, tokenTranscript(keyId, body));
  const bodyBytes = jcsBytes(body);
  return `sbrt1.${keyId}.${base64UrlNoPad(bodyBytes)}.${base64UrlNoPad(mac)}`;
}
