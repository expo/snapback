//! Shared canonical JSON and identity shapes used across owner boundaries.
//!
//! The resumable-query engine re-exports this surface for compatibility, while
//! kernel and contract callers depend directly on this leaf.
//!
//! @ref LLP 0225#1-ownership-map — shared contract/types are the canonical
//!   downward dependency for the kernel and domain services.

use std::cmp::Ordering;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};

/// A value the 0A contract refuses at mint time: the subscription simply
/// gets no token (`resume` absent), never a wrong digest (LLP 0091 §0A.2).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MintRefusal {
    NonFiniteNumber,
    UnsafeInteger,
    RowIdMissing,
    RowIdDuplicate,
}

/// The local-arm resume keyring file name beside the auth keyring
/// (LLP 0091 §0A.1 custody: a separate ring and file).
pub const RESUME_KEYRING_FILE_NAME: &str = "resume-keyring.json";

const ROW_HASH_TAG: &[u8] = b"snapback-rqs-row-v1\0";
const LEAF_TAG: &[u8] = b"snapback-rqs-leaf-v1\0";
const XOF_TAG: &[u8] = b"snapback-rqs-xof-v1\0";
const STATE_TAG: &[u8] = b"snapback-rqs-state-v1\0";
const SEQ_TAG: &[u8] = b"snapback-rqs-seq-v1\0";
const ARGS_TAG: &[u8] = b"snapback-rqs-args-v1\0";
const QUERY_ARTIFACT_TAG: &[u8] = b"snapback-rqs-query-artifact-v1\0";

// ---------------------------------------------------------------------------
// RFC 8785 (JCS) canonicalization
// ---------------------------------------------------------------------------

/// ECMAScript `Number::toString` for a finite double — the RFC 8785 number
/// serialization. Rust's `Display` already yields the shortest round-trip
/// digits without an exponent; this reformats them under the ECMAScript
/// thresholds (decimal for 1e-6 ≤ |x| < 1e21, exponent form outside).
pub fn ecma_number_string(value: f64) -> Result<String, MintRefusal> {
    if !value.is_finite() {
        return Err(MintRefusal::NonFiniteNumber);
    }
    if value == 0.0 {
        // Negative zero serializes as "0" (JCS; matches `canonicalValue`).
        return Ok("0".to_owned());
    }
    let negative = value < 0.0;
    let magnitude = format!("{}", value.abs());
    let (int_part, frac_part) = match magnitude.split_once('.') {
        Some((int_part, frac_part)) => (int_part, frac_part),
        None => (magnitude.as_str(), ""),
    };
    let all: String = format!("{int_part}{frac_part}");
    let first = all
        .find(|c: char| c != '0')
        .expect("nonzero float has a nonzero digit");
    let last = all.rfind(|c: char| c != '0').expect("nonzero digit exists");
    let digits = &all[first..=last];
    // value = 0.digits × 10^n
    let n = int_part.len() as i64 - first as i64;
    let k = digits.len() as i64;
    let mut out = String::new();
    if negative {
        out.push('-');
    }
    if k <= n && n <= 21 {
        out.push_str(digits);
        for _ in 0..(n - k) {
            out.push('0');
        }
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        out.push_str(digits);
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        let exponent = n - 1;
        if exponent >= 0 {
            out.push('+');
        }
        out.push_str(&exponent.to_string());
    }
    Ok(out)
}

pub fn jcs_escape_into(out: &mut String, s: &str) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Compare strings by UTF-16 code units — RFC 8785's member-name ordering.
/// (Rust's native `str` ordering is by Unicode scalar value, which sorts
/// supplementary-plane characters *after* U+E000..U+FFFF; UTF-16 code-unit
/// order sorts their surrogates before, so the two orders differ exactly
/// where JCS says they must not.)
pub fn cmp_utf16(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

pub fn jcs_into(out: &mut String, value: &Value) -> Result<(), MintRefusal> {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Number(number) => {
            if let Some(unsigned) = number.as_u64() {
                if unsigned > 9_007_199_254_740_991 {
                    return Err(MintRefusal::UnsafeInteger);
                }
                out.push_str(&unsigned.to_string());
            } else if let Some(signed) = number.as_i64() {
                if signed < -9_007_199_254_740_991 {
                    return Err(MintRefusal::UnsafeInteger);
                }
                out.push_str(&signed.to_string());
            } else if let Some(float) = number.as_f64() {
                // Integral doubles in the (2^53-1, 1e21) band serialize as
                // full decimal digits indistinguishable from lossy big
                // integers on the JS arm, so BOTH arms refuse the band —
                // the cross-language sharpening of LLP 0091 §0A.2's
                // ">2^53-1 integer" refusal (at and above 1e21 the ES
                // exponent form is canonical and unambiguously a double).
                if float.fract() == 0.0
                    && float.abs() > 9_007_199_254_740_991.0
                    && float.abs() < 1e21
                {
                    return Err(MintRefusal::UnsafeInteger);
                }
                out.push_str(&ecma_number_string(float)?);
            } else {
                return Err(MintRefusal::NonFiniteNumber);
            }
        }
        Value::String(s) => jcs_escape_into(out, s),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                jcs_into(out, item)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| cmp_utf16(a, b));
            out.push('{');
            for (index, key) in keys.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                jcs_escape_into(out, key);
                out.push(':');
                jcs_into(out, &map[key.as_str()])?;
            }
            out.push('}');
        }
    }
    Ok(())
}

/// RFC 8785 canonical serialization (LLP 0091 §0A.2). Lone surrogates cannot
/// occur in a Rust `String`, so that mint-refusal arm is structurally
/// discharged on this side; the JS arm must refuse them explicitly.
pub fn jcs(value: &Value) -> Result<String, MintRefusal> {
    let mut out = String::new();
    jcs_into(&mut out, value)?;
    Ok(out)
}

pub fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

pub fn sha256_identity(value: &Value) -> Result<String, MintRefusal> {
    Ok(format!(
        "sha256:{}",
        hex(&Sha256::digest(jcs(value)?.as_bytes()))
    ))
}

pub fn sha256_tagged(tag: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(tag);
    for part in parts {
        hash.update(part);
    }
    hash.finalize().into()
}

pub fn row_hash(row: &Value) -> Result<[u8; 32], MintRefusal> {
    Ok(sha256_tagged(ROW_HASH_TAG, &[jcs(row)?.as_bytes()]))
}

/// Domain-separated, length-framed leaf: commits to the keyed pair
/// (id → row hash) so aggregation cannot admit hash permutation among ids
/// (LLP 0090 D1.3 / LLP 0091 §0A.3).
pub fn leaf(row_id: &str, row_hash: &[u8; 32]) -> [u8; 32] {
    let id_bytes = row_id.as_bytes();
    sha256_tagged(
        LEAF_TAG,
        &[&(id_bytes.len() as u64).to_be_bytes(), id_bytes, row_hash],
    )
}

/// The wire row id for a result row: the same `_id` string `LiveDeltaWireOp`
/// carries. Missing or non-string ids are a mint refusal for `mset1`.
pub fn row_wire_id(row: &Value) -> Option<&str> {
    row.get("_id").and_then(Value::as_str)
}

/// LtHash-16 multiset accumulator state: 1024 × u16 little-endian lanes
/// (LLP 0091 §0A.4). The empty result is the all-zero state.
#[derive(Clone, PartialEq, Eq)]
pub struct MsetState(Box<[u16; 1024]>);

impl std::fmt::Debug for MsetState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("MsetState(..)")
    }
}

impl Default for MsetState {
    fn default() -> Self {
        Self(Box::new([0_u16; 1024]))
    }
}

fn expand_leaf(leaf: &[u8; 32]) -> Box<[u16; 1024]> {
    let mut lanes = Box::new([0_u16; 1024]);
    for block_index in 0_u32..64 {
        let block = sha256_tagged(XOF_TAG, &[leaf, &block_index.to_be_bytes()]);
        for lane in 0..16 {
            lanes[(block_index as usize) * 16 + lane] =
                u16::from_le_bytes([block[2 * lane], block[2 * lane + 1]]);
        }
    }
    lanes
}

impl MsetState {
    pub fn add_leaf(&mut self, leaf: &[u8; 32]) {
        let expanded = expand_leaf(leaf);
        for (lane, delta) in self.0.iter_mut().zip(expanded.iter()) {
            *lane = lane.wrapping_add(*delta);
        }
    }

    pub fn remove_leaf(&mut self, leaf: &[u8; 32]) {
        let expanded = expand_leaf(leaf);
        for (lane, delta) in self.0.iter_mut().zip(expanded.iter()) {
            *lane = lane.wrapping_sub(*delta);
        }
    }

    fn state_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(2048);
        for lane in self.0.iter() {
            bytes.extend_from_slice(&lane.to_le_bytes());
        }
        bytes
    }

    /// The published fixed-size compressed root ("mset1:" + hex SHA-256 of
    /// the domain-tagged state). The full state never leaves the server.
    pub fn root(&self) -> String {
        format!(
            "mset1:{}",
            hex(&sha256_tagged(STATE_TAG, &[&self.state_bytes()]))
        )
    }
}

/// Sequence-sensitive digest over the delivered row order (LLP 0091 §0A.4).
pub fn seq1_digest(rows: &[Value]) -> Result<String, MintRefusal> {
    let array = Value::Array(rows.to_vec());
    Ok(format!(
        "seq1:{}",
        hex(&sha256_tagged(SEQ_TAG, &[jcs(&array)?.as_bytes()]))
    ))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DigestKind {
    Mset1,
    Seq1,
}

impl DigestKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mset1 => "mset1",
            Self::Seq1 => "seq1",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "mset1" => Some(Self::Mset1),
            "seq1" => Some(Self::Seq1),
            _ => None,
        }
    }
}

pub fn args_hash(args: &Value) -> Result<String, MintRefusal> {
    Ok(format!(
        "sha256:{}",
        hex(&sha256_tagged(ARGS_TAG, &[jcs(args)?.as_bytes()]))
    ))
}

/// Interim per-function artifact identity: the served manifest on this arm
/// carries no per-function generated-artifact hash yet (a cluster-0C gap in
/// LLP 0091 §0A.1's premise), so the identity is content-derived from the
/// served `FunctionDefinition` itself — stable within a generation, rotated
/// whenever the function artifact changes, which is the property admission
/// needs. Cluster 0C replaces this with the real manifest-carried hash.
pub fn query_artifact_hash(function_definition: &Value) -> Result<String, MintRefusal> {
    Ok(format!(
        "sha256:{}",
        hex(&sha256_tagged(
            QUERY_ARTIFACT_TAG,
            &[jcs(function_definition)?.as_bytes()],
        ))
    ))
}

/// Domain-separated digest for a maintained-projection output row
/// (LLP 0080 §5): stored projection identity plus canonical output-key
/// bytes. The storage layer maps the digest into the UUIDv7 shape with the
/// identity's activation-timestamp constant in the time bits.
pub fn projection_row_digest(identity: &str, key_bytes: &str) -> [u8; 32] {
    sha256_tagged(
        b"snapback-projection-row-v1\0",
        &[identity.as_bytes(), key_bytes.as_bytes()],
    )
}

// ---------------------------------------------------------------------------
// ContentDigestV1 (LLP 0081 §5)
// ---------------------------------------------------------------------------

/// SHA-256 with an exportable/importable chaining state.
///
/// `ContentDigestV1` is a *resumable* streaming digest whose accumulator
/// checkpoint persists "the SHA-256 chaining state plus byte and row
/// counters" in the migration journal (LLP 0081 §5). The `sha2` crate does
/// not expose its compression state, so this is a minimal FIPS 180-4
/// SHA-256 core with a serializable state. Its output is asserted equal to
/// `sha2::Sha256` over shared inputs (including the NIST vectors) by the
/// unit tests, so the two implementations cannot drift silently.
#[derive(Clone, Debug)]
pub struct ResumableSha256 {
    state: [u32; 8],
    /// Total message bytes absorbed so far (drives padding).
    length_bytes: u64,
    /// Unprocessed tail, always shorter than one 64-byte block.
    buffer: Vec<u8>,
}

const SHA256_K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

impl Default for ResumableSha256 {
    fn default() -> Self {
        Self::new()
    }
}

impl ResumableSha256 {
    pub fn new() -> Self {
        Self {
            state: [
                0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
                0x5be0cd19,
            ],
            length_bytes: 0,
            buffer: Vec::with_capacity(64),
        }
    }

    fn compress(&mut self, block: &[u8]) {
        debug_assert_eq!(block.len(), 64);
        let mut w = [0_u32; 64];
        for (index, chunk) in block.chunks_exact(4).enumerate() {
            w[index] = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        for index in 16..64 {
            let s0 = w[index - 15].rotate_right(7)
                ^ w[index - 15].rotate_right(18)
                ^ (w[index - 15] >> 3);
            let s1 = w[index - 2].rotate_right(17)
                ^ w[index - 2].rotate_right(19)
                ^ (w[index - 2] >> 10);
            w[index] = w[index - 16]
                .wrapping_add(s0)
                .wrapping_add(w[index - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = self.state;
        for index in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = h
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(SHA256_K[index])
                .wrapping_add(w[index]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        for (word, value) in self.state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *word = word.wrapping_add(value);
        }
    }

    pub fn update(&mut self, mut bytes: &[u8]) {
        self.length_bytes += bytes.len() as u64;
        if !self.buffer.is_empty() {
            let take = (64 - self.buffer.len()).min(bytes.len());
            self.buffer.extend_from_slice(&bytes[..take]);
            bytes = &bytes[take..];
            if self.buffer.len() == 64 {
                let block = std::mem::take(&mut self.buffer);
                self.compress(&block);
            }
        }
        while bytes.len() >= 64 {
            let (block, rest) = bytes.split_at(64);
            self.compress(block);
            bytes = rest;
        }
        self.buffer.extend_from_slice(bytes);
    }

    pub fn finalize(mut self) -> [u8; 32] {
        let bit_length = self.length_bytes.wrapping_mul(8);
        self.update(&[0x80]);
        // Length no longer counts the padding: rewind the counter bump the
        // padding updates made, then pad with raw zeros through compress.
        while self.buffer.len() != 56 {
            let pad = if self.buffer.len() < 56 {
                56 - self.buffer.len()
            } else {
                64 - self.buffer.len() + 56
            };
            let zeros = vec![0_u8; pad.min(64)];
            self.update(&zeros);
        }
        self.update(&bit_length.to_be_bytes());
        debug_assert!(self.buffer.is_empty());
        let mut out = [0_u8; 32];
        for (chunk, word) in out.chunks_exact_mut(4).zip(self.state) {
            chunk.copy_from_slice(&word.to_be_bytes());
        }
        out
    }

    pub fn export_state(&self) -> ContentDigestAccumulatorV1 {
        ContentDigestAccumulatorV1 {
            version: CONTENT_DIGEST_ACCUMULATOR_VERSION.to_owned(),
            state: self.state.to_vec(),
            length_bytes: self.length_bytes,
            buffer: URL_SAFE_NO_PAD.encode(&self.buffer),
            rows: 0,
        }
    }

    pub fn import_state(accumulator: &ContentDigestAccumulatorV1) -> Result<Self, &'static str> {
        if accumulator.version != CONTENT_DIGEST_ACCUMULATOR_VERSION {
            return Err("unknown accumulator version");
        }
        let state: [u32; 8] = accumulator
            .state
            .as_slice()
            .try_into()
            .map_err(|_| "accumulator state must be eight words")?;
        let buffer = URL_SAFE_NO_PAD
            .decode(&accumulator.buffer)
            .map_err(|_| "accumulator buffer is not base64url")?;
        if buffer.len() >= 64 {
            return Err("accumulator buffer must be shorter than one block");
        }
        Ok(Self {
            state,
            length_bytes: accumulator.length_bytes,
            buffer,
        })
    }
}

pub const CONTENT_DIGEST_ACCUMULATOR_VERSION: &str = "content-digest-accumulator-v1";
/// The logical-row stream domain (LLP 0081 §5).
pub const CONTENT_DIGEST_DOMAIN: &str = "snapback:content-digest:v1";
/// The system-field stream's own domain prefix (LLP 0081 §5).
pub const CONTENT_DIGEST_SYSTEM_DOMAIN: &str = "snapback:content-digest:v1:system";
pub const CONTENT_DIGEST_TRAILER_DOMAIN: &str = "snapback:content-digest:v1:trailer";

/// The serialized SHA-256 chaining state plus counters — exactly what
/// LLP 0081 §5 pins into the migration journal's batch checkpoint.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentDigestAccumulatorV1 {
    pub version: String,
    /// The eight SHA-256 working words.
    pub state: Vec<u32>,
    /// Message bytes absorbed so far.
    pub length_bytes: u64,
    /// Base64url of the unprocessed tail (< 64 bytes).
    pub buffer: String,
    /// Row frames absorbed so far (bound by the trailer frame).
    pub rows: u64,
}

/// The header parameters every `ContentDigestV1` stream binds (LLP 0081
/// §5): identity of the plan, schema, table, generation, and publication
/// facts. The executor supplies real values; conformance vectors pin the
/// byte layout.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentDigestHeaderV1 {
    pub algorithm_version: u32,
    pub plan_digest: String,
    pub schema_hash: String,
    pub qualified_table: String,
    pub generation: String,
    pub barrier_head: u64,
    pub publication_version: u64,
    pub publication_timestamp: u64,
}

/// One `ContentDigestV1` stream: header frame, then one length-prefixed
/// frame per logical row in stable key order, then a trailer frame binding
/// the row count. Every frame is `u64-be(length) || bytes`; numeric header
/// fields are eight-byte big-endian; row bytes are the RFC 8785
/// re-canonicalization of the row's LLP 0051 JSON-transport value (which
/// distinguishes absent from null). The exact bytes are pinned by the
/// committed golden vectors, and resume-equality (checkpoint + import at
/// any row boundary) is itself a vector case.
#[derive(Clone, Debug)]
pub struct ContentDigestStream {
    hash: ResumableSha256,
    rows: u64,
}

fn digest_frame(hash: &mut ResumableSha256, bytes: &[u8]) {
    hash.update(&(bytes.len() as u64).to_be_bytes());
    hash.update(bytes);
}

impl ContentDigestStream {
    pub fn new(domain: &str, header: &ContentDigestHeaderV1) -> Self {
        let mut hash = ResumableSha256::new();
        digest_frame(&mut hash, domain.as_bytes());
        digest_frame(&mut hash, &header.algorithm_version.to_be_bytes());
        digest_frame(&mut hash, header.plan_digest.as_bytes());
        digest_frame(&mut hash, header.schema_hash.as_bytes());
        digest_frame(&mut hash, header.qualified_table.as_bytes());
        digest_frame(&mut hash, header.generation.as_bytes());
        digest_frame(&mut hash, &header.barrier_head.to_be_bytes());
        digest_frame(&mut hash, &header.publication_version.to_be_bytes());
        digest_frame(&mut hash, &header.publication_timestamp.to_be_bytes());
        Self { hash, rows: 0 }
    }

    /// Absorb one row's canonical transport value. Fails closed on values
    /// the canonical encoding refuses (non-finite numbers, unsafe
    /// integers): outside v1's proof domain, never digested approximately.
    pub fn absorb_row(&mut self, row: &Value) -> Result<(), MintRefusal> {
        let canonical = jcs(row)?;
        digest_frame(&mut self.hash, canonical.as_bytes());
        self.rows += 1;
        Ok(())
    }

    pub fn checkpoint(&self) -> ContentDigestAccumulatorV1 {
        let mut accumulator = self.hash.export_state();
        accumulator.rows = self.rows;
        accumulator
    }

    pub fn resume(accumulator: &ContentDigestAccumulatorV1) -> Result<Self, &'static str> {
        Ok(Self {
            hash: ResumableSha256::import_state(accumulator)?,
            rows: accumulator.rows,
        })
    }

    /// Seal the stream with the trailer frame binding the row count and
    /// return the labeled digest.
    pub fn finalize(mut self) -> String {
        digest_frame(&mut self.hash, CONTENT_DIGEST_TRAILER_DOMAIN.as_bytes());
        digest_frame(&mut self.hash, &self.rows.to_be_bytes());
        format!("cdv1:{}", hex(&self.hash.finalize()))
    }

    pub fn rows(&self) -> u64 {
        self.rows
    }
}
