//! Resumable-query-snapshot (RQS) token and digest cryptography — the 0A
//! contract of LLP 0091, consumed by the `resumeFromToken` subscribe path
//! (LLP 0090 rollout step 1).
//!
//! Everything here is a byte-exact contract shared with the JS arm
//! (`packages/snapback-client/rqs.mjs`); the cross-language parity
//! obligations live in `tests/rqs_digest_parity_v0.rs` and
//! `packages/snapback-client/rqs-digest-parity.test.mjs` over the shared
//! fixture corpus `tests/fixtures/rqs-parity-v1.json`.
//!
//! @ref LLP 0091#0a--token-and-digest-cryptography — token envelope, MAC
//!   transcript, keyring window, JCS canonicalization, leaf and digest
//!   constructions are all pinned there; this module implements them exactly.

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use hkdf::Hkdf;
use hmac::{Hmac, Mac as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use zeroize::Zeroizing;

use crate::auth::crypto::{OsRandom, RandomSource, ResumeKeyId};
#[cfg(test)]
use crate::rqs_contract::ecma_number_string;
pub use crate::rqs_contract::{
    CONTENT_DIGEST_ACCUMULATOR_VERSION, CONTENT_DIGEST_DOMAIN, CONTENT_DIGEST_SYSTEM_DOMAIN,
    ContentDigestAccumulatorV1, ContentDigestHeaderV1, ContentDigestStream, DigestKind, MsetState,
    RESUME_KEYRING_FILE_NAME, ResumableSha256, args_hash, leaf, query_artifact_hash, row_hash,
    row_wire_id, seq1_digest,
};
pub use crate::rqs_contract::{MintRefusal, jcs, sha256_identity};
// @ref LLP 0225#1-ownership-map — retain the crate-internal compatibility
//   path while all implementation consumers depend directly on the leaf.
#[allow(unused_imports)]
pub(crate) use crate::rqs_contract::projection_row_digest;
use crate::rqs_contract::{
    CONTENT_DIGEST_TRAILER_DOMAIN, cmp_utf16, hex, jcs_escape_into, jcs_into, sha256_tagged,
};

type HmacSha256 = Hmac<Sha256>;

/// Token-contract version prefix (LLP 0091 §0A.1).
pub const RESUME_TOKEN_WIRE_PREFIX: &str = "sbrt1";
/// Maximum accepted `tokenWire` size in bytes (LLP 0091 §0A.1).
pub const RESUME_TOKEN_MAX_WIRE_BYTES: usize = 1024;
/// Default admission staleness backstop (LLP 0091 §0A.1 expiry).
pub const RESUME_TOKEN_MAX_AGE_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
/// Active resume-key rotation age (mirrors `AUTH_KEY_ROTATION_AGE_MS`).
pub const RESUME_KEY_ROTATION_AGE_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
/// Retired keys verify for at most this long past retirement (LLP 0091 §0A.1).
pub const RESUME_KEY_RETIRED_OVERLAP_MS: u64 = 14 * 24 * 60 * 60 * 1_000;
/// At most this many most-recently-retired keys verify inside the window.
pub const RESUME_KEY_RETIRED_OVERLAP_KEYS: usize = 2;
/// The 0A digest-contract version carried in `resumeConfig` (LLP 0091 §0A.6).
pub const RESUME_DIGEST_CONTRACT_VERSION: &str = "rqs-0A-v1";
/// Rung-2 witness caps (LLP 0091 rung-2 amendment; server policy knobs with
/// these defaults): at most this many `(rowId, oldRowHash)` entries…
pub const RESUME_WITNESS_MAX_ENTRIES: usize = 4096;
/// …and at most this many serialized witness bytes on the wire.
pub const RESUME_WITNESS_MAX_WIRE_BYTES: usize = 1024 * 1024;
const MAC_DOMAIN: &str = "snapback.resume-token.v1";
/// Relational-cursor wire prefix (LLP 0080 §2: opaque and versioned).
pub const RELATIONAL_CURSOR_WIRE_PREFIX: &str = "sbrc1";
/// Maximum accepted relational-cursor wire size in bytes.
pub const RELATIONAL_CURSOR_MAX_WIRE_BYTES: usize = 1024;
/// Staleness backstop for presented relational cursors (same window as
/// resume tokens; an over-age cursor refuses like any other invalid cursor).
pub const RELATIONAL_CURSOR_MAX_AGE_MS: u64 = RESUME_TOKEN_MAX_AGE_MS;
const RELATIONAL_CURSOR_MAC_DOMAIN: &str = "snapback.relational-cursor.v1";
const CONFIG_TAG: &[u8] = b"snapback-rqs-config-v1\0";
const GENERATION_TAG: &[u8] = b"snapback-generation-v1\0";

/// Stable `SNAPBACK_RESUME_*` refusal-code registry (LLP 0091 §0B.6).
/// Append-only; every refusal answers with rung 3, never a failure.
pub mod refusal {
    pub const TOKEN_MALFORMED: &str = "SNAPBACK_RESUME_TOKEN_MALFORMED";
    pub const TOKEN_OVERSIZE: &str = "SNAPBACK_RESUME_TOKEN_OVERSIZE";
    pub const MAC_INVALID: &str = "SNAPBACK_RESUME_MAC_INVALID";
    pub const KEY_UNKNOWN: &str = "SNAPBACK_RESUME_KEY_UNKNOWN";
    pub const KEY_RETIRED: &str = "SNAPBACK_RESUME_KEY_RETIRED";
    pub const TOKEN_EXPIRED: &str = "SNAPBACK_RESUME_TOKEN_EXPIRED";
    pub const APP_MISMATCH: &str = "SNAPBACK_RESUME_APP_MISMATCH";
    pub const GENERATION_STALE: &str = "SNAPBACK_RESUME_GENERATION_STALE";
    pub const STREAM_MISMATCH: &str = "SNAPBACK_RESUME_STREAM_MISMATCH";
    pub const QUERY_MISMATCH: &str = "SNAPBACK_RESUME_QUERY_MISMATCH";
    pub const NOT_ELIGIBLE: &str = "SNAPBACK_RESUME_NOT_ELIGIBLE";
    pub const DIGEST_KIND_MISMATCH: &str = "SNAPBACK_RESUME_DIGEST_KIND_MISMATCH";
    pub const VERSION_IMPLAUSIBLE: &str = "SNAPBACK_RESUME_VERSION_IMPLAUSIBLE";
    pub const JOURNAL_FLOOR: &str = "SNAPBACK_RESUME_JOURNAL_FLOOR";
    pub const WITNESS_INVALID: &str = "SNAPBACK_RESUME_WITNESS_INVALID";
    pub const WITNESS_OVERSIZE: &str = "SNAPBACK_RESUME_WITNESS_OVERSIZE";
    /// Rung-2 amendment codes (LLP 0091, ENG-25457): the witness decoded but
    /// its keyed-leaf aggregate does not equal the token's MAC-bound root…
    pub const WITNESS_ROOT_MISMATCH: &str = "SNAPBACK_RESUME_WITNESS_ROOT_MISMATCH";
    /// …or the accumulator updated over the journal-affected ids does not
    /// reproduce the fresh head digest (an untouched row changed anyway) —
    /// both refuse to rung 3, never a partial replay.
    pub const WITNESS_REPLAY_DIVERGED: &str = "SNAPBACK_RESUME_WITNESS_REPLAY_DIVERGED";
    #[allow(dead_code)]
    pub const BUDGET_EXCEEDED: &str = "SNAPBACK_RESUME_BUDGET_EXCEEDED";
    #[allow(dead_code)]
    pub const RATE_LIMITED: &str = "SNAPBACK_RESUME_RATE_LIMITED";
    pub const POLICY_REPLACED: &str = "SNAPBACK_RESUME_POLICY_REPLACED";
}

// ---------------------------------------------------------------------------
// Standard-pattern keyset cursor (LLP 0065 §3)
// ---------------------------------------------------------------------------

/// Standard-pattern cursor wire prefix (LLP 0065: opaque and versioned).
pub const STANDARD_PATTERN_CURSOR_WIRE_PREFIX: &str = "sbpc1";
const STANDARD_PATTERN_CURSOR_MAC_DOMAIN: &str = "snapback.standard-pattern-cursor.v1";
/// Confidential standard-pattern cursor prefix. Authority-roster cursors use
/// this envelope because their keyset boundary contains host-private member
/// ids and authority fields, not merely an opaque continuation identity.
// @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface — generated
// roster pagination must keep the canonical membership row boundary private.
pub const SEALED_STANDARD_PATTERN_CURSOR_WIRE_PREFIX: &str = "sbpc2";
const SEALED_STANDARD_PATTERN_CURSOR_PURPOSE: &[u8] =
    b"snapback:standard-pattern-cursor:xchacha20:v2";

/// The opaque `defineOwnedKeysetPages` continuation body. `binding` folds
/// the app, the plan identity (function id, helper, profile, direction,
/// cursor field, serialized plan), and the caller's authority partition;
/// the per-instance resume keyring MAC supplies the deployment/database
/// binding — a cursor minted by one instance cannot verify on another.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardPatternCursorBody {
    pub app: String,
    pub binding: String,
    /// The exact unique boundary value — the last returned row's cursor
    /// field. Unique inside one owner partition by the declared compound
    /// index, so no `_id` tie-break is needed (LLP 0065).
    pub boundary: Value,
    pub issued_at: u64,
}

fn standard_pattern_cursor_mac(
    key: &[u8],
    key_id: &str,
    body: &StandardPatternCursorBody,
) -> HmacSha256 {
    let mut mac =
        <HmacSha256 as hmac::Mac>::new_from_slice(key).expect("HMAC accepts any key length");
    put_string(&mut mac, STANDARD_PATTERN_CURSOR_MAC_DOMAIN);
    put_string(&mut mac, key_id);
    put_string(&mut mac, &body.app);
    put_string(&mut mac, &body.binding);
    // A non-canonicalizable boundary was refused at mint; on verify the
    // empty frame simply fails the MAC — uniformly refused either way.
    put_string(&mut mac, &jcs(&body.boundary).unwrap_or_default());
    put_u64(&mut mac, body.issued_at);
    mac
}

/// Mint the wire cursor; `None` when the boundary cannot canonicalize or
/// the wire form would exceed the size cap — callers fail closed rather
/// than serving a full page without its continuation.
pub fn mint_standard_pattern_cursor(
    key: &[u8],
    key_id: &str,
    body: &StandardPatternCursorBody,
) -> Option<String> {
    jcs(&body.boundary).ok()?;
    let body_value = serde_json::to_value(body).ok()?;
    let body_json = jcs(&body_value).ok()?;
    let mac = standard_pattern_cursor_mac(key, key_id, body)
        .finalize()
        .into_bytes();
    let wire = format!(
        "{STANDARD_PATTERN_CURSOR_WIRE_PREFIX}.{key_id}.{}.{}",
        URL_SAFE_NO_PAD.encode(body_json.as_bytes()),
        URL_SAFE_NO_PAD.encode(mac)
    );
    (wire.len() <= RELATIONAL_CURSOR_MAX_WIRE_BYTES).then_some(wire)
}

/// Decode and cryptographically verify a presented standard-pattern
/// cursor. Cause-free like the relational family: every refusal class
/// answers with one byte-identical `SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID`.
pub fn decode_and_verify_standard_pattern_cursor(
    token_wire: &str,
    keyring: &ResumeKeyring,
    now_ms: u64,
    max_age_ms: u64,
) -> Result<StandardPatternCursorBody, RelationalCursorRefusal> {
    const REFUSED: RelationalCursorRefusal = RelationalCursorRefusal;
    if token_wire.len() > RELATIONAL_CURSOR_MAX_WIRE_BYTES {
        return Err(REFUSED);
    }
    let mut parts = token_wire.split('.');
    let (Some(prefix), Some(key_id), Some(body_part), Some(mac_part), None) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return Err(REFUSED);
    };
    if prefix != STANDARD_PATTERN_CURSOR_WIRE_PREFIX || ResumeKeyId::parse(key_id).is_err() {
        return Err(REFUSED);
    }
    let body_bytes = URL_SAFE_NO_PAD.decode(body_part).map_err(|_| REFUSED)?;
    let mac_bytes = URL_SAFE_NO_PAD.decode(mac_part).map_err(|_| REFUSED)?;
    if mac_bytes.len() != 32 {
        return Err(REFUSED);
    }
    let body: StandardPatternCursorBody =
        serde_json::from_slice(&body_bytes).map_err(|_| REFUSED)?;
    let key = keyring
        .verification_key(key_id, now_ms)
        .map_err(|_| REFUSED)?;
    standard_pattern_cursor_mac(key.secret.as_ref(), key_id, &body)
        .verify_slice(&mac_bytes)
        .map_err(|_| REFUSED)?;
    if body.issued_at > now_ms || now_ms - body.issued_at > max_age_ms {
        return Err(REFUSED);
    }
    Ok(body)
}

fn sealed_standard_pattern_cursor_key(root: &[u8], key_id: &str) -> Option<[u8; 32]> {
    let hkdf = Hkdf::<Sha256>::new(Some(SEALED_STANDARD_PATTERN_CURSOR_PURPOSE), root);
    let mut key = [0_u8; 32];
    hkdf.expand(key_id.as_bytes(), &mut key).ok()?;
    Some(key)
}

fn sealed_standard_pattern_cursor_aad(key_id: &str) -> Vec<u8> {
    let mut aad = SEALED_STANDARD_PATTERN_CURSOR_PURPOSE.to_vec();
    aad.extend_from_slice(&(SEALED_STANDARD_PATTERN_CURSOR_WIRE_PREFIX.len() as u32).to_be_bytes());
    aad.extend_from_slice(SEALED_STANDARD_PATTERN_CURSOR_WIRE_PREFIX.as_bytes());
    aad.extend_from_slice(&(key_id.len() as u32).to_be_bytes());
    aad.extend_from_slice(key_id.as_bytes());
    aad
}

/// Mint an AEAD-sealed standard-pattern cursor. The keyset body is encrypted
/// as well as authenticated so private boundary fields never become a
/// base64-decoding side channel.
pub fn mint_sealed_standard_pattern_cursor(
    root: &[u8],
    key_id: &str,
    body: &StandardPatternCursorBody,
) -> Option<String> {
    jcs(&body.boundary).ok()?;
    let key = sealed_standard_pattern_cursor_key(root, key_id)?;
    let cipher = XChaCha20Poly1305::new((&key).into());
    let plaintext = serde_json::to_vec(body).ok()?;
    let mut nonce = [0_u8; 24];
    getrandom::fill(&mut nonce).ok()?;
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: &sealed_standard_pattern_cursor_aad(key_id),
            },
        )
        .ok()?;
    let mut payload = nonce.to_vec();
    payload.extend_from_slice(&ciphertext);
    let wire = format!(
        "{SEALED_STANDARD_PATTERN_CURSOR_WIRE_PREFIX}.{key_id}.{}",
        URL_SAFE_NO_PAD.encode(payload)
    );
    (wire.len() <= RELATIONAL_CURSOR_MAX_WIRE_BYTES).then_some(wire)
}

/// Decode an AEAD-sealed standard-pattern cursor. Every parser, key, AEAD,
/// shape, and age failure collapses to the same cause-free refusal.
pub fn decode_and_verify_sealed_standard_pattern_cursor(
    token_wire: &str,
    keyring: &ResumeKeyring,
    now_ms: u64,
    max_age_ms: u64,
) -> Result<StandardPatternCursorBody, RelationalCursorRefusal> {
    const REFUSED: RelationalCursorRefusal = RelationalCursorRefusal;
    if token_wire.len() > RELATIONAL_CURSOR_MAX_WIRE_BYTES {
        return Err(REFUSED);
    }
    let mut parts = token_wire.split('.');
    let (Some(prefix), Some(key_id), Some(payload_part), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(REFUSED);
    };
    if prefix != SEALED_STANDARD_PATTERN_CURSOR_WIRE_PREFIX || ResumeKeyId::parse(key_id).is_err() {
        return Err(REFUSED);
    }
    let payload = URL_SAFE_NO_PAD.decode(payload_part).map_err(|_| REFUSED)?;
    if payload.len() < 24 + 16 {
        return Err(REFUSED);
    }
    let key = keyring
        .verification_key(key_id, now_ms)
        .map_err(|_| REFUSED)?;
    let derived = sealed_standard_pattern_cursor_key(key.secret.as_ref(), key_id).ok_or(REFUSED)?;
    let cipher = XChaCha20Poly1305::new((&derived).into());
    let (nonce, ciphertext) = payload.split_at(24);
    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: &sealed_standard_pattern_cursor_aad(key_id),
            },
        )
        .map_err(|_| REFUSED)?;
    let body: StandardPatternCursorBody =
        serde_json::from_slice(&plaintext).map_err(|_| REFUSED)?;
    if body.issued_at > now_ms || now_ms - body.issued_at > max_age_ms {
        return Err(REFUSED);
    }
    Ok(body)
}

// ---------------------------------------------------------------------------
// RelationalResultEncodingV1 (LLP 0080 §2)
// ---------------------------------------------------------------------------

/// Version identifier for the pinned relational result-byte encoding.
pub const RELATIONAL_RESULT_ENCODING_VERSION: &str = "relational-result-encoding-v1";

/// Why a row set cannot be encoded under `RelationalResultEncodingV1`.
/// Both arms are server invariants — the executor only emits projected
/// scalar members — so a refusal here is a bug, never a client class.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RelationalEncodingRefusal {
    /// A row was not an object, or carried a member outside the projection
    /// declaration. Encoding must be total over the declared shape;
    /// dropping unknown members silently would un-pin the bytes.
    RowShapeInvalid,
    /// A member value failed canonicalization (non-finite number or an
    /// integer outside the safe band) — the same values `jcs` refuses.
    NonCanonicalValue,
}

/// Encode result rows as the pinned `RelationalResultEncodingV1` bytes
/// (LLP 0080 §2): UTF-8 JSON with no insignificant whitespace, RFC 8785
/// number spelling and string escaping over LLP 0051's canonical value
/// mapping, object members in the projection declaration's order — an
/// explicit, named divergence from JCS key sorting — absent expressed by
/// omission and null by the literal. V1 projects only scalar leaves, so no
/// nested-object ordering question arises (nested values still encode
/// canonically if they ever appear).
pub fn relational_result_encoding_v1(
    field_order: &[String],
    rows: &[Value],
) -> Result<String, RelationalEncodingRefusal> {
    let mut out = String::from("[");
    for (row_index, row) in rows.iter().enumerate() {
        if row_index > 0 {
            out.push(',');
        }
        let Value::Object(members) = row else {
            return Err(RelationalEncodingRefusal::RowShapeInvalid);
        };
        if members
            .keys()
            .any(|member| !field_order.iter().any(|field| field == member))
        {
            return Err(RelationalEncodingRefusal::RowShapeInvalid);
        }
        out.push('{');
        let mut first = true;
        for field in field_order {
            let Some(value) = members.get(field) else {
                // Absent is expressed by omission (null stays the literal).
                continue;
            };
            if !first {
                out.push(',');
            }
            first = false;
            jcs_escape_into(&mut out, field);
            out.push(':');
            jcs_into(&mut out, value).map_err(|_| RelationalEncodingRefusal::NonCanonicalValue)?;
        }
        out.push('}');
    }
    out.push(']');
    Ok(out)
}

/// The committed `schemas/relational.result-encoding-v1.json` artifact:
/// the encoding rules plus executable golden vectors, generated through the
/// encoder itself so the committed file cannot drift from the
/// implementation (the drift gate re-runs this; the unit tests pin the
/// exact bytes so the encoder cannot drift either).
pub fn relational_result_encoding_artifact() -> Value {
    let vector = |name: &str, field_order: &[&str], rows: Value| {
        let fields: Vec<String> = field_order.iter().map(|s| (*s).to_owned()).collect();
        let rows_vec = rows.as_array().cloned().expect("vector rows are an array");
        let bytes =
            relational_result_encoding_v1(&fields, &rows_vec).expect("golden vectors encode");
        serde_json::json!({
            "name": name,
            "fieldOrder": fields,
            "rows": rows_vec,
            "bytes": bytes,
        })
    };
    serde_json::json!({
        "version": RELATIONAL_RESULT_ENCODING_VERSION,
        "authority": "llp/0080-portable-relational-queries-and-projections.rfc.md#2-portable-evaluation-semantics",
        "rules": [
            "UTF-8 JSON with no insignificant whitespace",
            "RFC 8785 number spelling and string escaping over LLP 0051's canonical value mapping",
            "object members in the projection declaration's order (a named divergence from JCS key sorting)",
            "absent expressed by omission; null by the literal",
        ],
        "vectors": [
            vector(
                "declaration-order-not-sorted",
                &["title", "authorName", "shelf"],
                serde_json::json!([
                    { "title": "alpha", "authorName": "Ada", "shelf": "fiction" },
                ]),
            ),
            vector(
                "absent-omitted-null-literal",
                &["title", "authorName", "shelf"],
                serde_json::json!([
                    { "title": "beta", "authorName": null },
                    {},
                ]),
            ),
            vector(
                "number-spelling",
                &["int", "half", "big", "tiny", "negzero"],
                serde_json::json!([
                    { "int": 42, "half": 0.5, "big": 1e21, "tiny": 1e-7, "negzero": -0.0 },
                ]),
            ),
            vector(
                "string-escaping-and-unicode",
                &["control", "quote", "nfc", "nfd"],
                serde_json::json!([
                    {
                        "control": "a\u{8}b\tc\u{1f}",
                        "quote": "say \"hi\" \\ done",
                        "nfc": "caf\u{e9}",
                        "nfd": "cafe\u{301}",
                    },
                ]),
            ),
            vector("empty-result", &["title"], serde_json::json!([])),
        ],
    })
}

// ---------------------------------------------------------------------------
// Row hash, leaf, digests
// ---------------------------------------------------------------------------

/// Per-live-result digest state held server-side for incremental refresh
/// (LLP 0090 D1: refresh is O(changed rows) for `mset1`; `seq1` recomputes
/// only at `LiveReplace` boundaries).
#[derive(Clone, Debug)]
pub struct ResultDigest {
    pub kind: DigestKind,
    mset: MsetState,
    /// id → row hash for the currently held result (`mset1` only): the old
    /// leaf a delta's update/remove must subtract.
    row_hashes: BTreeMap<String, [u8; 32]>,
    seq_root: Option<String>,
}

impl ResultDigest {
    pub fn from_rows(kind: DigestKind, rows: &[Value]) -> Result<Self, MintRefusal> {
        match kind {
            DigestKind::Mset1 => {
                let mut state = MsetState::default();
                let mut row_hashes = BTreeMap::new();
                for row in rows {
                    let id = row_wire_id(row)
                        .ok_or(MintRefusal::RowIdMissing)?
                        .to_owned();
                    let hash = row_hash(row)?;
                    if row_hashes.insert(id.clone(), hash).is_some() {
                        return Err(MintRefusal::RowIdDuplicate);
                    }
                    state.add_leaf(&leaf(&id, &hash));
                }
                Ok(Self {
                    kind,
                    mset: state,
                    row_hashes,
                    seq_root: None,
                })
            }
            DigestKind::Seq1 => Ok(Self {
                kind,
                mset: MsetState::default(),
                row_hashes: BTreeMap::new(),
                seq_root: Some(seq1_digest(rows)?),
            }),
        }
    }

    /// Apply one `live_delta` op set incrementally (`mset1` only): remove the
    /// old leaf where the id was present, add the new post-image leaf where
    /// the row remains.
    pub fn apply_delta_ops(
        &mut self,
        ops: &[crate::live_wire::LiveDeltaWireOp],
    ) -> Result<(), MintRefusal> {
        debug_assert_eq!(self.kind, DigestKind::Mset1);
        for op in ops {
            if let Some(old_hash) = self.row_hashes.remove(&op.id) {
                self.mset.remove_leaf(&leaf(&op.id, &old_hash));
            }
            match op.op {
                crate::live_wire::LiveDeltaOpKind::Remove => {}
                crate::live_wire::LiveDeltaOpKind::Add
                | crate::live_wire::LiveDeltaOpKind::Update => {
                    let row = op.row.as_ref().ok_or(MintRefusal::RowIdMissing)?;
                    let hash = row_hash(row)?;
                    self.row_hashes.insert(op.id.clone(), hash);
                    self.mset.add_leaf(&leaf(&op.id, &hash));
                }
            }
        }
        Ok(())
    }

    pub fn published(&self) -> String {
        match self.kind {
            DigestKind::Mset1 => self.mset.root(),
            DigestKind::Seq1 => self
                .seq_root
                .clone()
                .expect("seq1 digest is computed at construction"),
        }
    }

    /// The held row hash for one wire id (`mset1` only) — the post-image
    /// leaf a rung-2 replay adds back for a journal-affected row that is
    /// still in the result (LLP 0090 D1.3 accumulator-update rule).
    pub fn row_hash_for(&self, id: &str) -> Option<&[u8; 32]> {
        self.row_hashes.get(id)
    }
}

// ---------------------------------------------------------------------------
// Rung-2 membership witness (LLP 0091 rung-2 amendment, ENG-25457)
// ---------------------------------------------------------------------------

/// One decoded witness pair: the wire row id and the 32-byte row hash the
/// client held for it at the token's version.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WitnessPair {
    pub id: String,
    pub row_hash: [u8; 32],
}

/// Decode and structurally validate a rung-2 membership witness. The
/// reconciliation rule is fail-closed (LLP 0090 D1.3): a count that does not
/// match the entries, a hash that is not exactly 32 base64url bytes, or
/// entries out of ascending UTF-16 id order (which also catches duplicate
/// ids) are decode ambiguity — `WITNESS_INVALID`, rung 3 — and an entry
/// count over `max_entries` is `WITNESS_OVERSIZE`. Nothing here can suppress
/// a removal: every refusal is answered with a full fresh snapshot.
///
/// @ref LLP 0090#d13-replay-admission-ladder — decode ambiguity falls back
///   to rung 3 and can never suppress a required removal.
pub fn decode_witness(
    witness: &crate::live_wire::MembershipWitnessWire,
    max_entries: usize,
) -> Result<Vec<WitnessPair>, &'static str> {
    if witness.count as usize != witness.entries.len() {
        return Err(refusal::WITNESS_INVALID);
    }
    if witness.entries.len() > max_entries {
        return Err(refusal::WITNESS_OVERSIZE);
    }
    let mut pairs = Vec::with_capacity(witness.entries.len());
    for (index, entry) in witness.entries.iter().enumerate() {
        let bytes = URL_SAFE_NO_PAD
            .decode(&entry.old_row_hash)
            .map_err(|_| refusal::WITNESS_INVALID)?;
        let row_hash: [u8; 32] = bytes.try_into().map_err(|_| refusal::WITNESS_INVALID)?;
        if index > 0 && cmp_utf16(&witness.entries[index - 1].id, &entry.id) != Ordering::Less {
            // Out of order or duplicate id: ambiguity, never a best guess.
            return Err(refusal::WITNESS_INVALID);
        }
        pairs.push(WitnessPair {
            id: entry.id.clone(),
            row_hash,
        });
    }
    Ok(pairs)
}

/// The witness's keyed-leaf multiset aggregate (LLP 0091 §0A.3/§0A.4). Its
/// compressed root must equal the token's MAC-bound `contentDigest` before
/// replay is admitted — token and witness are jointly verifiable, and the
/// keyed leaf makes a hash permutation among ids fail the root check.
pub fn witness_state(pairs: &[WitnessPair]) -> MsetState {
    let mut state = MsetState::default();
    for pair in pairs {
        state.add_leaf(&leaf(&pair.id, &pair.row_hash));
    }
    state
}

// ---------------------------------------------------------------------------
// Identity hashes: args, query artifact, resume config, generation
// ---------------------------------------------------------------------------

pub fn resume_config_identity(
    journal_prune_policy: &str,
    auth_mode: &str,
    route_manifest_hash: &str,
) -> String {
    let config = serde_json::json!({
        "journalPrunePolicy": journal_prune_policy,
        "authMode": auth_mode,
        "routeManifestHash": route_manifest_hash,
        "digestContractVersion": RESUME_DIGEST_CONTRACT_VERSION,
    });
    let canonical = jcs(&config).expect("resume config is canonical JSON");
    format!(
        "sha256:{}",
        hex(&sha256_tagged(CONFIG_TAG, &[canonical.as_bytes()]))
    )
}

// ---------------------------------------------------------------------------
// ContentDigestV1 (LLP 0081 §5)
// ---------------------------------------------------------------------------

/// The committed `schemas/content-digest.v1.json` artifact: frame rules and
/// executable golden vectors generated through the implementation itself
/// (the drift gate re-runs this; the unit tests pin the exact digests, so
/// neither the file nor the stream can drift alone). Includes a
/// resume-equality vector: the digest of a stream checkpointed and resumed
/// at every row boundary equals the one-shot digest.
pub fn content_digest_artifact() -> Value {
    let header = ContentDigestHeaderV1 {
        algorithm_version: 1,
        plan_digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
            .to_owned(),
        schema_hash: "sha256:1111111111111111".to_owned(),
        qualified_table: "app.todos".to_owned(),
        generation: "gen-1".to_owned(),
        barrier_head: 41,
        publication_version: 42,
        publication_timestamp: 1_784_000_000_000,
    };
    let logical_rows = vec![
        serde_json::json!({ "title": "alpha", "rank": 1 }),
        serde_json::json!({ "title": "beta", "note": null }),
        serde_json::json!({ "title": "caf\u{e9}" }),
    ];
    let system_rows = vec![
        serde_json::json!({ "_id": "a", "_version": 42, "_createdAt": 1, "_updatedAt": 2 }),
        serde_json::json!({ "_id": "b", "_version": 42, "_createdAt": 1, "_updatedAt": 2 }),
        serde_json::json!({ "_id": "c", "_version": 42, "_createdAt": 3, "_updatedAt": 3 }),
    ];
    let one_shot = |domain: &str, rows: &[Value]| {
        let mut stream = ContentDigestStream::new(domain, &header);
        for row in rows {
            stream.absorb_row(row).expect("vector rows canonicalize");
        }
        stream.finalize()
    };
    let logical_digest = one_shot(CONTENT_DIGEST_DOMAIN, &logical_rows);
    let system_digest = one_shot(CONTENT_DIGEST_SYSTEM_DOMAIN, &system_rows);
    // Resume equality at every boundary.
    for split in 0..=logical_rows.len() {
        let mut stream = ContentDigestStream::new(CONTENT_DIGEST_DOMAIN, &header);
        for row in &logical_rows[..split] {
            stream.absorb_row(row).expect("vector rows canonicalize");
        }
        let checkpoint = stream.checkpoint();
        let mut resumed = ContentDigestStream::resume(&checkpoint).expect("checkpoint resumes");
        for row in &logical_rows[split..] {
            resumed.absorb_row(row).expect("vector rows canonicalize");
        }
        assert_eq!(
            resumed.finalize(),
            logical_digest,
            "resume at row {split} must equal the one-shot digest"
        );
    }
    serde_json::json!({
        "version": "content-digest-v1",
        "authority": "llp/0081-reviewed-storage-evolution-and-migrations.rfc.md#5-verification-and-data-proof",
        "frameRule": "every frame is u64-be(length) || bytes; numeric header fields are u64/u32 big-endian; rows are RFC 8785 re-canonicalizations of LLP 0051 JSON-transport values; the trailer binds the row count",
        "domains": {
            "logical": CONTENT_DIGEST_DOMAIN,
            "system": CONTENT_DIGEST_SYSTEM_DOMAIN,
            "trailer": CONTENT_DIGEST_TRAILER_DOMAIN,
        },
        "vectors": [{
            "name": "three-row-fixture",
            "header": header,
            "logicalRows": logical_rows,
            "systemRows": system_rows,
            "logicalDigest": logical_digest,
            "systemDigest": system_digest,
            "resumeEquality": "verified at every row boundary during generation",
        }],
    })
}

fn frame(hash: &mut Sha256, component: &str) {
    hash.update((component.len() as u64).to_be_bytes());
    hash.update(component.as_bytes());
}

/// The `generation` digest (LLP 0091 §0A.6): length-framed components under
/// the `snapback-generation-v1` tag, published as `gen1:` + hex.
pub fn generation_digest(
    deployment_identity: &str,
    schema_identity: &str,
    functions_identity: &str,
    capability_identity: &str,
    resume_config_identity: &str,
) -> String {
    let mut hash = Sha256::new();
    hash.update(GENERATION_TAG);
    frame(&mut hash, deployment_identity);
    frame(&mut hash, schema_identity);
    frame(&mut hash, functions_identity);
    frame(&mut hash, capability_identity);
    frame(&mut hash, resume_config_identity);
    format!("gen1:{}", hex(&hash.finalize()))
}

// ---------------------------------------------------------------------------
// Token body, MAC transcript, wire envelope
// ---------------------------------------------------------------------------

/// The MAC-bound token body (LLP 0090 D1 / LLP 0091 §0A.1). Self-describing:
/// admission decodes this from the token itself; the clear `meta` copy is
/// never an admission input. `deny_unknown_fields` is safe because only the
/// minting server family decodes its own tokens; new fields require `sbrt2`.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResumeTokenBody {
    pub app: String,
    pub generation: String,
    pub version_stream: String,
    pub version: u64,
    pub query_artifact: String,
    pub args_hash: String,
    pub digest_kind: String,
    pub content_digest: String,
    pub issued_at: u64,
    /// Reserved v2 door — absent (not `null`) in v1; MAC'd tagged-absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_partition: Option<String>,
}

fn put_u64(mac: &mut HmacSha256, value: u64) {
    mac.update(&value.to_be_bytes());
}

fn put_string(mac: &mut HmacSha256, value: &str) {
    put_u64(mac, value.len() as u64);
    mac.update(value.as_bytes());
}

fn put_optional_string(mac: &mut HmacSha256, value: Option<&str>) {
    match value {
        None => mac.update(&[0x00]),
        Some(value) => {
            mac.update(&[0x01]);
            put_string(mac, value);
        }
    }
}

/// The length-framed MAC transcript (LLP 0091 §0A.1): the MAC covers this,
/// never `bodyBytes`, so JSON serialization ambiguity cannot widen the
/// forgery surface. `keyId` is outside the body but inside the transcript.
fn token_mac(key: &[u8], key_id: &str, body: &ResumeTokenBody) -> HmacSha256 {
    let mut mac =
        <HmacSha256 as hmac::Mac>::new_from_slice(key).expect("HMAC accepts any key length");
    put_string(&mut mac, MAC_DOMAIN);
    put_string(&mut mac, key_id);
    put_string(&mut mac, &body.app);
    put_string(&mut mac, &body.generation);
    put_string(&mut mac, &body.version_stream);
    put_u64(&mut mac, body.version);
    put_string(&mut mac, &body.query_artifact);
    put_string(&mut mac, &body.args_hash);
    put_string(&mut mac, &body.digest_kind);
    put_string(&mut mac, &body.content_digest);
    put_u64(&mut mac, body.issued_at);
    put_optional_string(&mut mac, body.auth_partition.as_deref());
    mac
}

pub fn mint_token_wire(key: &[u8], key_id: &str, body: &ResumeTokenBody) -> String {
    let body_value = serde_json::to_value(body).expect("token body serializes");
    let body_json = jcs(&body_value).expect("token body is canonical JSON");
    let mac = token_mac(key, key_id, body).finalize().into_bytes();
    format!(
        "{RESUME_TOKEN_WIRE_PREFIX}.{key_id}.{}.{}",
        URL_SAFE_NO_PAD.encode(body_json.as_bytes()),
        URL_SAFE_NO_PAD.encode(mac)
    )
}

// ---------------------------------------------------------------------------
// Relational pagination cursor (LLP 0080 §2)
// ---------------------------------------------------------------------------

/// The opaque relational continuation body. The cursor binds the app, the
/// plan, the normalized non-cursor arguments, the order schema, and the
/// caller's authority partition — all folded into `binding` — and carries the
/// last consumed root's order-key values (which may include fields the
/// application projection does not expose; the MAC is what keeps them
/// opaque). `deny_unknown_fields` is safe because only the minting server
/// family decodes its own cursors; new fields require `sbrc2`.
///
/// @ref LLP 0080#2-portable-evaluation-semantics — the cursor is opaque and
///   versioned; a malformed, cross-plan, cross-argument-set,
///   authority-crossing, or order-schema-invalid cursor is refused with
///   `SNAPBACK_RELATIONAL_CURSOR_INVALID`, never repositioned.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelationalCursorBody {
    pub app: String,
    /// `sha256:` digest over the canonical binding object (app, plan,
    /// normalized non-cursor args, order schema, authority partition).
    pub binding: String,
    /// Order-key values of the last consumed root, aligned 1:1 with the
    /// plan's order fields; `null` marks a null/absent component.
    pub boundary: Vec<Value>,
    /// The `_id` tie-break of the last consumed root.
    pub id: String,
    pub issued_at: u64,
}

fn relational_cursor_mac(key: &[u8], key_id: &str, body: &RelationalCursorBody) -> HmacSha256 {
    let mut mac =
        <HmacSha256 as hmac::Mac>::new_from_slice(key).expect("HMAC accepts any key length");
    put_string(&mut mac, RELATIONAL_CURSOR_MAC_DOMAIN);
    put_string(&mut mac, key_id);
    put_string(&mut mac, &body.app);
    put_string(&mut mac, &body.binding);
    put_u64(&mut mac, body.boundary.len() as u64);
    for value in &body.boundary {
        // Boundary values are canonical JSON scalars; a non-canonicalizable
        // value was refused at mint time, so this frame is total here.
        put_string(&mut mac, &jcs(value).unwrap_or_default());
    }
    put_string(&mut mac, &body.id);
    put_u64(&mut mac, body.issued_at);
    mac
}

/// Mint the wire cursor. Returns `None` when a boundary value cannot be
/// canonicalized (non-finite or unsafe numbers) or the wire form would
/// exceed the size cap — the caller must fail closed rather than serve a
/// full page without its continuation.
pub fn mint_relational_cursor(
    key: &[u8],
    key_id: &str,
    body: &RelationalCursorBody,
) -> Option<String> {
    for value in &body.boundary {
        if jcs(value).is_err() {
            return None;
        }
    }
    let body_value = serde_json::to_value(body).ok()?;
    let body_json = jcs(&body_value).ok()?;
    let mac = relational_cursor_mac(key, key_id, body)
        .finalize()
        .into_bytes();
    let wire = format!(
        "{RELATIONAL_CURSOR_WIRE_PREFIX}.{key_id}.{}.{}",
        URL_SAFE_NO_PAD.encode(body_json.as_bytes()),
        URL_SAFE_NO_PAD.encode(mac)
    );
    (wire.len() <= RELATIONAL_CURSOR_MAX_WIRE_BYTES).then_some(wire)
}

/// The one relational-cursor refusal. Deliberately cause-free: the six
/// refusal classes of LLP 0080 §2 all answer with one byte-identical
/// `SNAPBACK_RELATIONAL_CURSOR_INVALID`, so no layer may produce
/// distinguishable causes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RelationalCursorRefusal;

/// Decode and cryptographically verify a presented relational cursor.
/// Semantic admission (binding digest, boundary-versus-order-schema
/// validation) is the caller's.
pub fn decode_and_verify_relational_cursor(
    token_wire: &str,
    keyring: &ResumeKeyring,
    now_ms: u64,
    max_age_ms: u64,
) -> Result<RelationalCursorBody, RelationalCursorRefusal> {
    const REFUSED: RelationalCursorRefusal = RelationalCursorRefusal;
    if token_wire.len() > RELATIONAL_CURSOR_MAX_WIRE_BYTES {
        return Err(REFUSED);
    }
    let mut parts = token_wire.split('.');
    let (Some(prefix), Some(key_id), Some(body_part), Some(mac_part), None) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return Err(REFUSED);
    };
    if prefix != RELATIONAL_CURSOR_WIRE_PREFIX || ResumeKeyId::parse(key_id).is_err() {
        return Err(REFUSED);
    }
    let body_bytes = URL_SAFE_NO_PAD.decode(body_part).map_err(|_| REFUSED)?;
    let mac_bytes = URL_SAFE_NO_PAD.decode(mac_part).map_err(|_| REFUSED)?;
    if mac_bytes.len() != 32 {
        return Err(REFUSED);
    }
    let body: RelationalCursorBody = serde_json::from_slice(&body_bytes).map_err(|_| REFUSED)?;
    let key = keyring
        .verification_key(key_id, now_ms)
        .map_err(|_| REFUSED)?;
    relational_cursor_mac(key.secret.as_ref(), key_id, &body)
        .verify_slice(&mac_bytes)
        .map_err(|_| REFUSED)?;
    if body.issued_at > now_ms || now_ms - body.issued_at > max_age_ms {
        return Err(REFUSED);
    }
    Ok(body)
}

// ---------------------------------------------------------------------------
// Resume keyring (separate ring and file from the auth keyring)
// ---------------------------------------------------------------------------

const RESUME_KEYRING_FORMAT_VERSION: u32 = 1;
const RESUME_KEYRING_MAX_BYTES: usize = 64 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedResumeKeyring {
    format_version: u32,
    keys: Vec<PersistedResumeKey>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedResumeKey {
    key_id: String,
    secret: String,
    created_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    retired_at_ms: Option<u64>,
}

struct ResumeKey {
    key_id: String,
    secret: Zeroizing<[u8; 32]>,
    created_at_ms: u64,
    retired_at_ms: Option<u64>,
}

/// The per-instance resume keyring: active key mints; the two most recently
/// retired keys verify for 14 days past retirement (LLP 0091 §0A.1). A
/// dedicated ring and file — resume-key loss must never touch session/lease
/// security (custody rule), and key loss is availability-only: an unreadable
/// or corrupt ring is replaced with a fresh one, refusing outstanding tokens
/// to rung 3.
pub struct ResumeKeyring {
    path: Option<PathBuf>,
    keys: Vec<ResumeKey>,
}

impl ResumeKeyring {
    pub fn in_memory(now_ms: u64) -> Self {
        let mut ring = Self {
            path: None,
            keys: Vec::new(),
        };
        ring.mint_active(now_ms);
        ring
    }

    pub fn load_or_create(path: PathBuf, now_ms: u64) -> Self {
        let keys = crate::secure_file::read_owner_only(&path)
            .ok()
            .filter(|bytes| bytes.len() <= RESUME_KEYRING_MAX_BYTES)
            .and_then(|bytes| serde_json::from_slice::<PersistedResumeKeyring>(&bytes).ok())
            .filter(|persisted| persisted.format_version == RESUME_KEYRING_FORMAT_VERSION)
            .map(|persisted| {
                persisted
                    .keys
                    .into_iter()
                    .filter_map(|key| {
                        ResumeKeyId::parse(&key.key_id).ok()?;
                        let bytes = URL_SAFE_NO_PAD.decode(&key.secret).ok()?;
                        let secret: [u8; 32] = bytes.try_into().ok()?;
                        Some(ResumeKey {
                            key_id: key.key_id,
                            secret: Zeroizing::new(secret),
                            created_at_ms: key.created_at_ms,
                            retired_at_ms: key.retired_at_ms,
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut ring = Self {
            path: Some(path),
            keys,
        };
        if ring.active_index().is_none() {
            ring.mint_active(now_ms);
        }
        ring
    }

    /// Strict, non-creating parse check used by derived-deployment boot evidence.
    /// Ordinary resume-key loss is availability-only and may self-heal, but a
    /// fork's mint receipt must never outlive a missing or truncated keyring.
    pub(crate) fn persisted_file_has_active_key(path: &Path) -> bool {
        let Ok(bytes) = crate::secure_file::read_owner_only(path) else {
            return false;
        };
        if bytes.len() > RESUME_KEYRING_MAX_BYTES {
            return false;
        }
        let Ok(persisted) = serde_json::from_slice::<PersistedResumeKeyring>(&bytes) else {
            return false;
        };
        if persisted.format_version != RESUME_KEYRING_FORMAT_VERSION {
            return false;
        }
        let mut active = 0_usize;
        for key in persisted.keys {
            if ResumeKeyId::parse(&key.key_id).is_err() {
                return false;
            }
            let Ok(bytes) = URL_SAFE_NO_PAD.decode(&key.secret) else {
                return false;
            };
            if <[u8; 32]>::try_from(bytes).is_err() {
                return false;
            }
            if key.retired_at_ms.is_none() {
                active += 1;
            }
        }
        active == 1
    }

    fn active_index(&self) -> Option<usize> {
        self.keys
            .iter()
            .enumerate()
            .filter(|(_, key)| key.retired_at_ms.is_none())
            .max_by_key(|(_, key)| key.created_at_ms)
            .map(|(index, _)| index)
    }

    fn mint_active(&mut self, now_ms: u64) {
        let random = OsRandom;
        let Ok(key_id) = ResumeKeyId::generate(&random) else {
            return;
        };
        let mut secret = Zeroizing::new([0_u8; 32]);
        if random.fill(secret.as_mut()).is_err() {
            return;
        }
        self.keys.push(ResumeKey {
            key_id: key_id.as_str().to_owned(),
            secret,
            created_at_ms: now_ms,
            retired_at_ms: None,
        });
        self.persist();
    }

    /// Retire an over-age active key and mint a successor (30-day cadence,
    /// mirroring `AUTH_KEY_ROTATION_AGE_MS`). Routine rotation stays
    /// invisible to clients inside the retired-overlap window.
    pub fn rotate_if_due(&mut self, now_ms: u64) {
        let Some(active) = self.active_index() else {
            self.mint_active(now_ms);
            return;
        };
        if now_ms.saturating_sub(self.keys[active].created_at_ms) < RESUME_KEY_ROTATION_AGE_MS {
            return;
        }
        self.keys[active].retired_at_ms = Some(now_ms);
        self.mint_active(now_ms);
        self.prune(now_ms);
    }

    fn prune(&mut self, now_ms: u64) {
        // Keep the active key plus every retired key still inside the
        // verification window; drop the rest.
        let mut retired: Vec<(u64, String)> = self
            .keys
            .iter()
            .filter_map(|key| {
                key.retired_at_ms
                    .map(|retired_at| (retired_at, key.key_id.clone()))
            })
            .collect();
        retired.sort_by_key(|entry| std::cmp::Reverse(entry.0));
        let keep: Vec<&String> = retired
            .iter()
            .take(RESUME_KEY_RETIRED_OVERLAP_KEYS)
            .filter(|(retired_at, _)| {
                now_ms.saturating_sub(*retired_at) <= RESUME_KEY_RETIRED_OVERLAP_MS
            })
            .map(|(_, key_id)| key_id)
            .collect();
        self.keys.retain(|key| {
            key.retired_at_ms.is_none() || keep.iter().any(|kept| **kept == key.key_id)
        });
    }

    /// The active minting key.
    pub fn active(&mut self, now_ms: u64) -> Option<(String, Zeroizing<[u8; 32]>)> {
        self.rotate_if_due(now_ms);
        let index = self.active_index()?;
        let key = &self.keys[index];
        Some((key.key_id.clone(), key.secret.clone()))
    }

    /// The active minting key without the rotation side effect — for mint
    /// sites that hold only a shared reference (relational-cursor minting on
    /// the read lanes). Rotation cadence is owned by the `&mut` resume-token
    /// mint path; a slightly overdue key still verifies inside the retired
    /// overlap window, so skipping rotation here is availability-neutral.
    pub fn active_current(&self) -> Option<(String, Zeroizing<[u8; 32]>)> {
        let index = self.active_index()?;
        let key = &self.keys[index];
        Some((key.key_id.clone(), key.secret.clone()))
    }

    /// Search cursors have a much shorter verification overlap than RQS
    /// tokens. Return the active generation first, followed only by retired
    /// roots still inside search's 120-second TTL. Callers derive a
    /// domain-separated AEAD key; raw material never enters a cursor.
    ///
    /// @ref LLP 0073#ranking-order-and-cursors — current plus explicitly
    /// overlapping predecessors, never the full RQS retention window.
    pub(crate) fn search_cursor_materials(&self, now_ms: u64) -> Vec<(String, [u8; 32])> {
        let mut keys = self
            .keys
            .iter()
            .filter(|key| {
                key.retired_at_ms
                    .is_none_or(|retired_at| now_ms.saturating_sub(retired_at) <= 120_000)
            })
            .map(|key| (key.key_id.clone(), *key.secret))
            .collect::<Vec<_>>();
        keys.sort_by(|left, right| {
            let active_left = self
                .keys
                .iter()
                .find(|key| key.key_id == left.0)
                .is_some_and(|key| key.retired_at_ms.is_none());
            let active_right = self
                .keys
                .iter()
                .find(|key| key.key_id == right.0)
                .is_some_and(|key| key.retired_at_ms.is_none());
            active_right.cmp(&active_left).then(left.0.cmp(&right.0))
        });
        keys
    }

    /// Root material for the purpose-derived bounded-children AEAD. The
    /// cursor lifetime never exceeds the resume ring's retired-key overlap,
    /// so routine rotation preserves availability without widening custody.
    pub(crate) fn bounded_children_cursor_materials(&self, now_ms: u64) -> Vec<(String, [u8; 32])> {
        let mut keys = self
            .keys
            .iter()
            .filter(|key| {
                key.retired_at_ms.is_none_or(|retired_at| {
                    now_ms.saturating_sub(retired_at) <= crate::bounded_children_cursor::MAX_AGE_MS
                })
            })
            .map(|key| (key.key_id.clone(), *key.secret))
            .collect::<Vec<_>>();
        keys.sort_by(|left, right| {
            let active_left = self
                .keys
                .iter()
                .find(|key| key.key_id == left.0)
                .is_some_and(|key| key.retired_at_ms.is_none());
            let active_right = self
                .keys
                .iter()
                .find(|key| key.key_id == right.0)
                .is_some_and(|key| key.retired_at_ms.is_none());
            active_right
                .cmp(&active_left)
                .then_with(|| left.0.cmp(&right.0))
        });
        keys
    }

    /// Root material for the purpose-derived snapshot-batch AEAD. The
    /// `sbsb1` lifetime matches bounded children, but its codec derives a
    /// separate key and AAD domain from the shared root custody.
    ///
    /// @ref LLP 0135#24-composite-cursor-and-coordinated-resume — shared
    ///   keyring custody with a distinct purpose and 14-day verification
    ///   overlap.
    #[cfg_attr(not(test), allow(dead_code))] // Consumed by the snapshot-batch runtime lane.
    pub(crate) fn snapshot_batch_cursor_materials(&self, now_ms: u64) -> Vec<(String, [u8; 32])> {
        let mut keys = self
            .keys
            .iter()
            .filter(|key| {
                key.retired_at_ms.is_none_or(|retired_at| {
                    now_ms.saturating_sub(retired_at) <= crate::snapshot_batch_cursor::MAX_AGE_MS
                })
            })
            .map(|key| (key.key_id.clone(), *key.secret))
            .collect::<Vec<_>>();
        keys.sort_by(|left, right| {
            let active_left = self
                .keys
                .iter()
                .find(|key| key.key_id == left.0)
                .is_some_and(|key| key.retired_at_ms.is_none());
            let active_right = self
                .keys
                .iter()
                .find(|key| key.key_id == right.0)
                .is_some_and(|key| key.retired_at_ms.is_none());
            active_right
                .cmp(&active_left)
                .then_with(|| left.0.cmp(&right.0))
        });
        keys
    }

    /// Root material for the purpose-derived v2 snapshot-batch AEAD. V2 keeps
    /// independent `snapback:snapshot-batch-cursor:xchacha20:v2` derivation
    /// while retaining retired roots for exactly its 14-day credential age.
    ///
    /// @ref LLP 0157#sbsb2-plaintext-and-budget — `sbsb2` is a separate
    ///   purpose domain with the same bounded verification overlap as `sbsb1`.
    #[cfg_attr(not(test), allow(dead_code))] // Consumed by the v2 executor lane.
    pub(crate) fn snapshot_batch_cursor_v2_materials(
        &self,
        now_ms: u64,
    ) -> Vec<(String, [u8; 32])> {
        let mut keys = self
            .keys
            .iter()
            .filter(|key| {
                key.retired_at_ms.is_none_or(|retired_at| {
                    now_ms.saturating_sub(retired_at) <= crate::snapshot_batch_cursor_v2::MAX_AGE_MS
                })
            })
            .map(|key| (key.key_id.clone(), *key.secret))
            .collect::<Vec<_>>();
        keys.sort_by(|left, right| {
            let active_left = self
                .keys
                .iter()
                .find(|key| key.key_id == left.0)
                .is_some_and(|key| key.retired_at_ms.is_none());
            let active_right = self
                .keys
                .iter()
                .find(|key| key.key_id == right.0)
                .is_some_and(|key| key.retired_at_ms.is_none());
            active_right
                .cmp(&active_left)
                .then_with(|| left.0.cmp(&right.0))
        });
        keys
    }

    /// Resolve a presented key id for verification under the overlap window.
    fn verification_key(&self, key_id: &str, now_ms: u64) -> Result<&ResumeKey, &'static str> {
        let key = self
            .keys
            .iter()
            .find(|key| key.key_id == key_id)
            .ok_or(refusal::KEY_UNKNOWN)?;
        match key.retired_at_ms {
            None => Ok(key),
            Some(retired_at) => {
                let mut retired: Vec<u64> = self
                    .keys
                    .iter()
                    .filter_map(|key| key.retired_at_ms)
                    .collect();
                retired.sort_unstable_by(|a, b| b.cmp(a));
                let recent_enough = retired
                    .iter()
                    .take(RESUME_KEY_RETIRED_OVERLAP_KEYS)
                    .any(|candidate| *candidate == retired_at);
                if recent_enough
                    && now_ms.saturating_sub(retired_at) <= RESUME_KEY_RETIRED_OVERLAP_MS
                {
                    Ok(key)
                } else {
                    Err(refusal::KEY_RETIRED)
                }
            }
        }
    }

    fn persist(&self) {
        let Some(path) = &self.path else { return };
        let persisted = PersistedResumeKeyring {
            format_version: RESUME_KEYRING_FORMAT_VERSION,
            keys: self
                .keys
                .iter()
                .map(|key| PersistedResumeKey {
                    key_id: key.key_id.clone(),
                    secret: URL_SAFE_NO_PAD.encode(key.secret.as_ref()),
                    created_at_ms: key.created_at_ms,
                    retired_at_ms: key.retired_at_ms,
                })
                .collect(),
        };
        if let Ok(bytes) = serde_json::to_vec(&persisted) {
            // Best-effort: a failed write means restart refuses outstanding
            // tokens to rung 3 — availability-only by contract.
            let _ = crate::secure_file::write_owner_only(path, &bytes);
        }
    }

    #[cfg(test)]
    pub(crate) fn retire_all_for_test(&mut self, now_ms: u64) {
        for key in &mut self.keys {
            key.retired_at_ms = Some(now_ms);
        }
    }
}

/// Decode and cryptographically verify a presented `tokenWire`: framing,
/// size cap, key resolution under the overlap window, MAC over the rebuilt
/// transcript, and the `issuedAt` staleness backstop. Semantic admission
/// (app/generation/stream/query/eligibility/version) is the caller's.
pub fn decode_and_verify(
    token_wire: &str,
    keyring: &ResumeKeyring,
    now_ms: u64,
    max_age_ms: u64,
) -> Result<ResumeTokenBody, &'static str> {
    if token_wire.len() > RESUME_TOKEN_MAX_WIRE_BYTES {
        return Err(refusal::TOKEN_OVERSIZE);
    }
    let mut parts = token_wire.split('.');
    let (Some(prefix), Some(key_id), Some(body_part), Some(mac_part), None) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return Err(refusal::TOKEN_MALFORMED);
    };
    if prefix != RESUME_TOKEN_WIRE_PREFIX {
        return Err(refusal::TOKEN_MALFORMED);
    }
    if ResumeKeyId::parse(key_id).is_err() {
        return Err(refusal::TOKEN_MALFORMED);
    }
    let body_bytes = URL_SAFE_NO_PAD
        .decode(body_part)
        .map_err(|_| refusal::TOKEN_MALFORMED)?;
    let mac_bytes = URL_SAFE_NO_PAD
        .decode(mac_part)
        .map_err(|_| refusal::TOKEN_MALFORMED)?;
    if mac_bytes.len() != 32 {
        return Err(refusal::TOKEN_MALFORMED);
    }
    let body: ResumeTokenBody =
        serde_json::from_slice(&body_bytes).map_err(|_| refusal::TOKEN_MALFORMED)?;
    let key = keyring.verification_key(key_id, now_ms)?;
    token_mac(key.secret.as_ref(), key_id, &body)
        .verify_slice(&mac_bytes)
        .map_err(|_| refusal::MAC_INVALID)?;
    // A server clock earlier than issuedAt is implausible, never
    // negative-age-accepted (LLP 0091 §0A.1).
    if body.issued_at > now_ms {
        return Err(refusal::TOKEN_MALFORMED);
    }
    if now_ms - body.issued_at > max_age_ms {
        return Err(refusal::TOKEN_EXPIRED);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sealed_standard_pattern_cursor_round_trips_without_decodable_private_boundary() {
        const NOW: u64 = 10_000;
        const PRIVATE_ID: &str = "roommembers_01k9m4x7p2q8we5rt3yu6a10s";
        let ring = ResumeKeyring::in_memory(NOW);
        let (key_id, key) = ring.active_current().expect("active cursor root");
        let body = StandardPatternCursorBody {
            app: "team-chat".to_owned(),
            binding: "sha256:authority-binding".to_owned(),
            boundary: json!({
                "entries": [["role", "owner"], ["userId", "user_owner"]],
                "id": PRIVATE_ID,
            }),
            issued_at: NOW,
        };
        let wire = mint_sealed_standard_pattern_cursor(key.as_ref(), &key_id, &body)
            .expect("seal authority cursor");
        let parts = wire.split('.').collect::<Vec<_>>();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], SEALED_STANDARD_PATTERN_CURSOR_WIRE_PREFIX);
        let decoded_payload = URL_SAFE_NO_PAD.decode(parts[2]).expect("base64 payload");
        for private in [PRIVATE_ID, "user_owner"] {
            assert_ne!(
                decoded_payload.as_slice(),
                private.as_bytes(),
                "cursor payload exactly exposed {private}"
            );
        }
        assert!(serde_json::from_slice::<Value>(&decoded_payload).is_err());
        assert_eq!(
            decode_and_verify_sealed_standard_pattern_cursor(
                &wire,
                &ring,
                NOW + 1,
                RELATIONAL_CURSOR_MAX_AGE_MS,
            )
            .expect("open authority cursor"),
            body,
        );

        let mut tampered = wire.into_bytes();
        let last = tampered.last_mut().expect("wire byte");
        *last = if *last == b'A' { b'B' } else { b'A' };
        assert!(
            decode_and_verify_sealed_standard_pattern_cursor(
                &String::from_utf8(tampered).expect("ASCII wire"),
                &ring,
                NOW + 1,
                RELATIONAL_CURSOR_MAX_AGE_MS,
            )
            .is_err()
        );
    }

    // The hand-rolled resumable SHA-256 core must be byte-identical to
    // `sha2::Sha256` — over the NIST vectors, odd chunkings, and
    // mid-stream export/import — or ContentDigestV1's resumability claim
    // is built on a broken hash.
    #[test]
    fn resumable_sha256_matches_sha2_and_survives_checkpoints() {
        let cases: Vec<Vec<u8>> = vec![
            Vec::new(),
            b"abc".to_vec(),
            b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".to_vec(),
            vec![0xa3; 63],
            vec![0x5c; 64],
            vec![0x17; 65],
            (0..=255_u8).cycle().take(1_000).collect(),
        ];
        // NIST FIPS 180-4 known answers for the first three cases.
        assert_eq!(
            hex(&ResumableSha256::new().finalize()),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        );
        let mut abc = ResumableSha256::new();
        abc.update(b"abc");
        assert_eq!(
            hex(&abc.finalize()),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
        for case in &cases {
            let expected = hex(&Sha256::digest(case));
            // One-shot.
            let mut ours = ResumableSha256::new();
            ours.update(case);
            assert_eq!(hex(&ours.finalize()), expected);
            // Every split point, through an export/import checkpoint.
            for split in 0..=case.len().min(200) {
                let mut first = ResumableSha256::new();
                first.update(&case[..split]);
                let checkpoint = first.export_state();
                let mut second = ResumableSha256::import_state(&checkpoint).expect("state imports");
                second.update(&case[split..]);
                assert_eq!(hex(&second.finalize()), expected, "split at {split}");
            }
        }
    }

    // @ref LLP 0081#5-verification-and-data-proof — ContentDigestV1's
    //   exact bytes: the committed vector digests are pinned here so the
    //   stream, the artifact, and this test must agree three ways.
    #[test]
    fn content_digest_v1_pins_golden_vectors() {
        let artifact = content_digest_artifact();
        let vector = &artifact["vectors"][0];
        let logical = vector["logicalDigest"].as_str().expect("logical digest");
        let system = vector["systemDigest"].as_str().expect("system digest");
        assert!(logical.starts_with("cdv1:") && system.starts_with("cdv1:"));
        assert_ne!(logical, system, "the system stream has its own domain");
        // Sensitivity: any header field change moves the digest.
        let header: ContentDigestHeaderV1 =
            serde_json::from_value(vector["header"].clone()).expect("header parses");
        let rows: Vec<Value> =
            serde_json::from_value(vector["logicalRows"].clone()).expect("rows parse");
        let digest_with = |header: &ContentDigestHeaderV1| {
            let mut stream = ContentDigestStream::new(CONTENT_DIGEST_DOMAIN, header);
            for row in &rows {
                stream.absorb_row(row).expect("rows canonicalize");
            }
            stream.finalize()
        };
        assert_eq!(digest_with(&header), logical);
        let mut moved = header.clone();
        moved.publication_version += 1;
        assert_ne!(digest_with(&moved), logical);
        // Row-count binding: the same bytes with a forged row counter
        // cannot finalize to the same digest.
        let mut stream = ContentDigestStream::new(CONTENT_DIGEST_DOMAIN, &header);
        for row in &rows {
            stream.absorb_row(row).expect("rows canonicalize");
        }
        let mut forged = stream.checkpoint();
        forged.rows += 1;
        let forged_stream = ContentDigestStream::resume(&forged).expect("resumes");
        assert_ne!(forged_stream.finalize(), logical);
        // Out-of-domain values fail closed.
        let mut refusing = ContentDigestStream::new(CONTENT_DIGEST_DOMAIN, &header);
        assert!(
            refusing
                .absorb_row(&json!({ "n": 9_007_199_254_740_993_i64 }))
                .is_err(),
            "unsafe integers are outside the proof domain"
        );
    }

    // @ref LLP 0080#2-portable-evaluation-semantics — the result bytes are
    //   pinned as a versioned RelationalResultEncodingV1 with golden vectors
    //   in the committed schema; these are the exact bytes.
    #[test]
    fn relational_result_encoding_v1_pins_golden_bytes() {
        let artifact = relational_result_encoding_artifact();
        let vectors: std::collections::BTreeMap<&str, &str> = artifact["vectors"]
            .as_array()
            .expect("vectors array")
            .iter()
            .map(|vector| {
                (
                    vector["name"].as_str().expect("vector name"),
                    vector["bytes"].as_str().expect("vector bytes"),
                )
            })
            .collect();
        assert_eq!(
            vectors["declaration-order-not-sorted"],
            r#"[{"title":"alpha","authorName":"Ada","shelf":"fiction"}]"#,
            "members follow the projection declaration, not JCS sorting",
        );
        assert_eq!(
            vectors["absent-omitted-null-literal"],
            r#"[{"title":"beta","authorName":null},{}]"#,
        );
        assert_eq!(
            vectors["number-spelling"],
            r#"[{"int":42,"half":0.5,"big":1e+21,"tiny":1e-7,"negzero":0}]"#,
        );
        assert_eq!(
            vectors["string-escaping-and-unicode"],
            "[{\"control\":\"a\\bb\\tc\\u001f\",\"quote\":\"say \\\"hi\\\" \\\\ done\",\
             \"nfc\":\"caf\u{e9}\",\"nfd\":\"cafe\u{301}\"}]",
            "JCS short escapes, \\u for other controls, and no unicode normalization",
        );
        assert_eq!(vectors["empty-result"], "[]");

        // Refusals are server invariants: rows must be objects over the
        // declared members, and values must canonicalize.
        let field = vec!["a".to_owned()];
        assert_eq!(
            relational_result_encoding_v1(&field, &[json!(3)]),
            Err(RelationalEncodingRefusal::RowShapeInvalid),
        );
        assert_eq!(
            relational_result_encoding_v1(&field, &[json!({ "b": 1 })]),
            Err(RelationalEncodingRefusal::RowShapeInvalid),
        );
        assert_eq!(
            relational_result_encoding_v1(&field, &[json!({ "a": 9_007_199_254_740_993_i64 })]),
            Err(RelationalEncodingRefusal::NonCanonicalValue),
        );
    }

    #[test]
    fn jcs_number_serialization_matches_ecmascript() {
        // The RFC 8785 / ECMAScript vectors the JS arm reproduces natively.
        let cases: &[(f64, &str)] = &[
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (-1.5, "-1.5"),
            (0.3, "0.3"),
            (0.000001, "0.000001"),
            (0.0000001, "1e-7"),
            (1e21, "1e+21"),
            (1.2e22, "1.2e+22"),
            (9007199254740991.0, "9007199254740991"),
            (0.1 + 0.2, "0.30000000000000004"),
            (123.456, "123.456"),
            (5e-324, "5e-324"),
            (1.7976931348623157e308, "1.7976931348623157e+308"),
        ];
        for (value, expected) in cases {
            assert_eq!(
                ecma_number_string(*value).unwrap(),
                *expected,
                "for {value:?}"
            );
        }
    }

    #[test]
    fn jcs_sorts_keys_by_utf16_code_units_and_escapes_controls() {
        // U+1D306 (surrogate pair, leads with 0xD834) sorts BEFORE U+FB33
        // under UTF-16 code-unit order, though its code point is larger.
        let value = json!({
            "\u{FB33}": 1,
            "\u{1D306}": 2,
            "a\u{0008}b": "\u{0009}",
        });
        assert_eq!(
            jcs(&value).unwrap(),
            "{\"a\\bb\":\"\\t\",\"\u{1D306}\":2,\"\u{FB33}\":1}"
        );
        // The RFC 8785 appendix ordering sample.
        let sample = json!({ "\u{20AC}": "Euro Sign", "\r": "CR", "1": "One" });
        assert_eq!(
            jcs(&sample).unwrap(),
            "{\"\\r\":\"CR\",\"1\":\"One\",\"\u{20AC}\":\"Euro Sign\"}"
        );
    }

    #[test]
    fn jcs_refuses_unsafe_integers() {
        assert_eq!(
            jcs(&json!(9007199254740992_u64)),
            Err(MintRefusal::UnsafeInteger)
        );
        assert_eq!(
            jcs(&json!(-9007199254740992_i64)),
            Err(MintRefusal::UnsafeInteger)
        );
        assert_eq!(
            jcs(&json!(9007199254740991_u64)).unwrap(),
            "9007199254740991"
        );
        // The integral-double band shared with the JS arm: refused below
        // 1e21, allowed at and above it (exponent form).
        assert_eq!(jcs(&json!(1e20)), Err(MintRefusal::UnsafeInteger));
        assert_eq!(jcs(&json!(1e21)).unwrap(), "1e+21");
    }

    #[test]
    fn leaf_is_length_framed_and_injective_for_prefix_ids() {
        let hash = [7_u8; 32];
        // "ab" + hash must differ from "a" + (b'b' || hash[..31])-style
        // ambiguity; with framing the leaves simply differ.
        assert_ne!(leaf("ab", &hash), leaf("a", &hash));
        assert_ne!(leaf("", &hash), leaf("\0", &hash));
    }

    #[test]
    fn mset1_is_commutative_incremental_and_preserves_untouched_leaves() {
        let row_a = json!({ "_id": "a", "value": 1 });
        let row_b = json!({ "_id": "b", "value": 2 });
        let row_c = json!({ "_id": "c", "value": 3 });

        let forward = ResultDigest::from_rows(
            DigestKind::Mset1,
            &[row_a.clone(), row_b.clone(), row_c.clone()],
        )
        .unwrap();
        let backward = ResultDigest::from_rows(
            DigestKind::Mset1,
            &[row_c.clone(), row_a.clone(), row_b.clone()],
        )
        .unwrap();
        assert_eq!(forward.published(), backward.published());

        // Strict-subset change: update only b; a and c leaves stay (the
        // accumulator-update fixture of LLP 0090 D1.3 rung 2).
        let row_b2 = json!({ "_id": "b", "value": 20 });
        let mut incremental = forward.clone();
        incremental
            .apply_delta_ops(&[crate::live_wire::LiveDeltaWireOp {
                op: crate::live_wire::LiveDeltaOpKind::Update,
                id: "b".into(),
                row: Some(row_b2.clone()),
            }])
            .unwrap();
        let recomputed =
            ResultDigest::from_rows(DigestKind::Mset1, &[row_a.clone(), row_b2, row_c.clone()])
                .unwrap();
        assert_eq!(incremental.published(), recomputed.published());

        // Remove one row incrementally == recompute without it.
        let mut removed = incremental.clone();
        removed
            .apply_delta_ops(&[crate::live_wire::LiveDeltaWireOp {
                op: crate::live_wire::LiveDeltaOpKind::Remove,
                id: "a".into(),
                row: None,
            }])
            .unwrap();
        let without_a = ResultDigest::from_rows(
            DigestKind::Mset1,
            &[json!({ "_id": "b", "value": 20 }), row_c],
        )
        .unwrap();
        assert_eq!(removed.published(), without_a.published());

        // Empty state root is stable and distinct.
        let empty = ResultDigest::from_rows(DigestKind::Mset1, &[]).unwrap();
        assert_ne!(empty.published(), removed.published());
    }

    #[test]
    fn mset1_refuses_missing_and_duplicate_row_ids() {
        assert_eq!(
            ResultDigest::from_rows(DigestKind::Mset1, &[json!({ "value": 1 })]).err(),
            Some(MintRefusal::RowIdMissing)
        );
        assert_eq!(
            ResultDigest::from_rows(
                DigestKind::Mset1,
                &[json!({ "_id": "a" }), json!({ "_id": "a" })]
            )
            .err(),
            Some(MintRefusal::RowIdDuplicate)
        );
    }

    #[test]
    fn witness_decode_is_fail_closed_and_aggregate_matches_result_digest() {
        use crate::live_wire::{MembershipWitnessEntry, MembershipWitnessWire};
        let rows = [
            json!({ "_id": "a", "value": 1 }),
            json!({ "_id": "b", "value": 2 }),
        ];
        let entry = |id: &str, row: &Value| MembershipWitnessEntry {
            id: id.to_owned(),
            old_row_hash: URL_SAFE_NO_PAD.encode(row_hash(row).unwrap()),
        };
        let witness = MembershipWitnessWire {
            count: 2,
            entries: vec![entry("a", &rows[0]), entry("b", &rows[1])],
        };
        let pairs = decode_witness(&witness, RESUME_WITNESS_MAX_ENTRIES).unwrap();
        // The witness aggregate root equals the digest a server would have
        // published for the same held rows — the joint-verifiability rule.
        let digest = ResultDigest::from_rows(DigestKind::Mset1, &rows).unwrap();
        assert_eq!(witness_state(&pairs).root(), digest.published());

        // Count mismatch (truncation) is ambiguity.
        let truncated = MembershipWitnessWire {
            count: 3,
            entries: witness.entries.clone(),
        };
        assert_eq!(
            decode_witness(&truncated, RESUME_WITNESS_MAX_ENTRIES),
            Err(refusal::WITNESS_INVALID)
        );

        // Over the entry cap refuses with the oversize code.
        assert_eq!(decode_witness(&witness, 1), Err(refusal::WITNESS_OVERSIZE));

        // Non-canonical hash encodings are ambiguity: bad base64, wrong length.
        let mut bad_base64 = witness.clone();
        bad_base64.entries[0].old_row_hash = "!!!not-base64!!!".to_owned();
        assert_eq!(
            decode_witness(&bad_base64, RESUME_WITNESS_MAX_ENTRIES),
            Err(refusal::WITNESS_INVALID)
        );
        let mut short_hash = witness.clone();
        short_hash.entries[0].old_row_hash = URL_SAFE_NO_PAD.encode([7_u8; 16]);
        assert_eq!(
            decode_witness(&short_hash, RESUME_WITNESS_MAX_ENTRIES),
            Err(refusal::WITNESS_INVALID)
        );

        // Out-of-order and duplicate ids are ambiguity (the order rule also
        // makes duplicates undecodable rather than last-wins).
        let out_of_order = MembershipWitnessWire {
            count: 2,
            entries: vec![entry("b", &rows[1]), entry("a", &rows[0])],
        };
        assert_eq!(
            decode_witness(&out_of_order, RESUME_WITNESS_MAX_ENTRIES),
            Err(refusal::WITNESS_INVALID)
        );
        let duplicate = MembershipWitnessWire {
            count: 2,
            entries: vec![entry("a", &rows[0]), entry("a", &rows[1])],
        };
        assert_eq!(
            decode_witness(&duplicate, RESUME_WITNESS_MAX_ENTRIES),
            Err(refusal::WITNESS_INVALID)
        );

        // A hash permutation among valid ids decodes but fails the root
        // check by the keyed-leaf construction (LLP 0090 D1.3).
        let permuted = MembershipWitnessWire {
            count: 2,
            entries: vec![
                MembershipWitnessEntry {
                    id: "a".to_owned(),
                    old_row_hash: URL_SAFE_NO_PAD.encode(row_hash(&rows[1]).unwrap()),
                },
                MembershipWitnessEntry {
                    id: "b".to_owned(),
                    old_row_hash: URL_SAFE_NO_PAD.encode(row_hash(&rows[0]).unwrap()),
                },
            ],
        };
        let permuted_pairs = decode_witness(&permuted, RESUME_WITNESS_MAX_ENTRIES).unwrap();
        assert_ne!(witness_state(&permuted_pairs).root(), digest.published());
    }

    #[test]
    fn seq1_is_order_sensitive() {
        let a = json!({ "_id": "a" });
        let b = json!({ "_id": "b" });
        let forward = seq1_digest(&[a.clone(), b.clone()]).unwrap();
        let backward = seq1_digest(&[b, a]).unwrap();
        assert_ne!(forward, backward);
        assert!(forward.starts_with("seq1:"));
    }

    fn test_body() -> ResumeTokenBody {
        ResumeTokenBody {
            app: "app_test".into(),
            generation: "gen1:aa".into(),
            version_stream: "stream-1".into(),
            version: 7,
            query_artifact: "sha256:bb".into(),
            args_hash: "sha256:cc".into(),
            digest_kind: "mset1".into(),
            content_digest: "mset1:dd".into(),
            issued_at: 1_000,
            auth_partition: None,
        }
    }

    #[test]
    fn token_mints_and_verifies_round_trip() {
        let mut ring = ResumeKeyring::in_memory(500);
        let (key_id, key) = ring.active(500).unwrap();
        let wire = mint_token_wire(key.as_ref(), &key_id, &test_body());
        assert!(wire.starts_with("sbrt1."));
        assert!(wire.len() <= RESUME_TOKEN_MAX_WIRE_BYTES);
        let decoded = decode_and_verify(&wire, &ring, 2_000, RESUME_TOKEN_MAX_AGE_MS).unwrap();
        assert_eq!(decoded, test_body());
    }

    #[test]
    fn single_table_adoption_does_not_change_legacy_token_wire_bytes() {
        // @ref LLP 0091#0a--token-and-digest-cryptography —
        // single_table_v1 copies the existing selector into plan identity;
        // it does not add a token field, digest spelling, or MAC frame.
        let wire = mint_token_wire(&[0x11; 32], "rk1_fixture", &test_body());
        assert_eq!(
            wire,
            "sbrt1.rk1_fixture.eyJhcHAiOiJhcHBfdGVzdCIsImFyZ3NIYXNoIjoic2hhMjU2OmNjIiwiY29udGVudERpZ2VzdCI6Im1zZXQxOmRkIiwiZGlnZXN0S2luZCI6Im1zZXQxIiwiZ2VuZXJhdGlvbiI6ImdlbjE6YWEiLCJpc3N1ZWRBdCI6MTAwMCwicXVlcnlBcnRpZmFjdCI6InNoYTI1NjpiYiIsInZlcnNpb24iOjcsInZlcnNpb25TdHJlYW0iOiJzdHJlYW0tMSJ9.ZuLSbeBFFAS11_IJiZmiuAZx18XW9UPjJ6jIOYlLAHo"
        );
    }

    #[test]
    fn token_refusals_are_per_cause() {
        let mut ring = ResumeKeyring::in_memory(500);
        let (key_id, key) = ring.active(500).unwrap();
        let wire = mint_token_wire(key.as_ref(), &key_id, &test_body());

        // Oversize.
        let oversized = format!("{wire}{}", "a".repeat(RESUME_TOKEN_MAX_WIRE_BYTES));
        assert_eq!(
            decode_and_verify(&oversized, &ring, 2_000, RESUME_TOKEN_MAX_AGE_MS),
            Err(refusal::TOKEN_OVERSIZE)
        );

        // Malformed framing.
        assert_eq!(
            decode_and_verify("sbrt2.x.y.z", &ring, 2_000, RESUME_TOKEN_MAX_AGE_MS),
            Err(refusal::TOKEN_MALFORMED)
        );
        assert_eq!(
            decode_and_verify("nonsense", &ring, 2_000, RESUME_TOKEN_MAX_AGE_MS),
            Err(refusal::TOKEN_MALFORMED)
        );

        // Tampered MAC: flip a mid-segment character so the base64url stays
        // canonical and only the MAC bytes change.
        let tampered = {
            let mut parts: Vec<String> = wire.split('.').map(str::to_owned).collect();
            let mac = &mut parts[3];
            let index = mac.len() / 2;
            let original = mac.as_bytes()[index];
            let replacement = if original == b'A' { b'B' } else { b'A' };
            let mut bytes = mac.clone().into_bytes();
            bytes[index] = replacement;
            *mac = String::from_utf8(bytes).unwrap();
            parts.join(".")
        };
        assert_eq!(
            decode_and_verify(&tampered, &ring, 2_000, RESUME_TOKEN_MAX_AGE_MS),
            Err(refusal::MAC_INVALID)
        );

        // Tampered body (MAC covers the transcript rebuilt from the body).
        let mut body = test_body();
        body.version = 8;
        let body_value = serde_json::to_value(&body).unwrap();
        let substituted_body = URL_SAFE_NO_PAD.encode(jcs(&body_value).unwrap().as_bytes());
        let parts: Vec<&str> = wire.split('.').collect();
        let spliced = format!("{}.{}.{substituted_body}.{}", parts[0], parts[1], parts[3]);
        assert_eq!(
            decode_and_verify(&spliced, &ring, 2_000, RESUME_TOKEN_MAX_AGE_MS),
            Err(refusal::MAC_INVALID)
        );

        // Unknown key.
        let other_ring = ResumeKeyring::in_memory(500);
        assert_eq!(
            decode_and_verify(&wire, &other_ring, 2_000, RESUME_TOKEN_MAX_AGE_MS),
            Err(refusal::KEY_UNKNOWN)
        );

        // Retired beyond the window.
        let mut retired_ring = ResumeKeyring::in_memory(500);
        let (retired_key_id, retired_key) = retired_ring.active(500).unwrap();
        let retired_wire = mint_token_wire(retired_key.as_ref(), &retired_key_id, &test_body());
        retired_ring.retire_all_for_test(1_000);
        retired_ring.mint_active(1_000);
        // Inside the window the retired key still verifies.
        assert!(
            decode_and_verify(&retired_wire, &retired_ring, 2_000, RESUME_TOKEN_MAX_AGE_MS).is_ok()
        );
        // Past the window it refuses with the retired code.
        assert_eq!(
            decode_and_verify(
                &retired_wire,
                &retired_ring,
                1_000 + RESUME_KEY_RETIRED_OVERLAP_MS + 1,
                u64::MAX
            ),
            Err(refusal::KEY_RETIRED)
        );

        // Expired.
        assert_eq!(
            decode_and_verify(
                &wire,
                &ring,
                1_000 + RESUME_TOKEN_MAX_AGE_MS + 1,
                RESUME_TOKEN_MAX_AGE_MS
            ),
            Err(refusal::TOKEN_EXPIRED)
        );

        // Implausible: server clock earlier than issuedAt.
        assert_eq!(
            decode_and_verify(&wire, &ring, 999, RESUME_TOKEN_MAX_AGE_MS),
            Err(refusal::TOKEN_MALFORMED)
        );

        // Unknown body field (self-describing envelope refuses).
        let widened = {
            let mut value = serde_json::to_value(test_body()).unwrap();
            value["surprise"] = json!(1);
            let encoded = URL_SAFE_NO_PAD.encode(jcs(&value).unwrap().as_bytes());
            let parts: Vec<&str> = wire.split('.').collect();
            format!("{}.{}.{encoded}.{}", parts[0], parts[1], parts[3])
        };
        assert_eq!(
            decode_and_verify(&widened, &ring, 2_000, RESUME_TOKEN_MAX_AGE_MS),
            Err(refusal::TOKEN_MALFORMED)
        );
    }

    #[test]
    fn keyring_survives_restart_via_file() {
        let dir =
            std::env::temp_dir().join(format!("snapback-rqs-keyring-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(RESUME_KEYRING_FILE_NAME);
        let _ = std::fs::remove_file(&path);
        let mut first = ResumeKeyring::load_or_create(path.clone(), 500);
        let (key_id, key) = first.active(500).unwrap();
        let wire = mint_token_wire(key.as_ref(), &key_id, &test_body());
        drop(first);
        // A fresh load (dev-loop restart) verifies the outstanding token.
        let second = ResumeKeyring::load_or_create(path.clone(), 600);
        assert!(decode_and_verify(&wire, &second, 2_000, RESUME_TOKEN_MAX_AGE_MS).is_ok());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn snapshot_batch_cursor_materials_keep_only_the_fourteen_day_overlap() {
        let mut ring = ResumeKeyring::in_memory(500);
        let (retired_generation, _) = ring.active(500).expect("initial root");
        ring.retire_all_for_test(1_000);
        ring.mint_active(1_000);

        let inside =
            ring.snapshot_batch_cursor_materials(1_000 + crate::snapshot_batch_cursor::MAX_AGE_MS);
        assert_eq!(inside.len(), 2);
        assert_ne!(inside[0].0, retired_generation, "active root sorts first");
        assert!(inside.iter().any(|entry| entry.0 == retired_generation));

        let outside = ring
            .snapshot_batch_cursor_materials(1_000 + crate::snapshot_batch_cursor::MAX_AGE_MS + 1);
        assert_eq!(outside.len(), 1);
        assert_ne!(outside[0].0, retired_generation);
    }

    #[test]
    fn snapshot_batch_cursor_v2_materials_keep_only_the_fourteen_day_overlap() {
        let mut ring = ResumeKeyring::in_memory(500);
        let (retired_generation, _) = ring.active(500).expect("initial root");
        ring.retire_all_for_test(1_000);
        ring.mint_active(1_000);

        let inside = ring.snapshot_batch_cursor_v2_materials(
            1_000 + crate::snapshot_batch_cursor_v2::MAX_AGE_MS,
        );
        assert_eq!(inside.len(), 2);
        assert_ne!(inside[0].0, retired_generation, "active root sorts first");
        assert!(inside.iter().any(|entry| entry.0 == retired_generation));

        let outside = ring.snapshot_batch_cursor_v2_materials(
            1_000 + crate::snapshot_batch_cursor_v2::MAX_AGE_MS + 1,
        );
        assert_eq!(outside.len(), 1);
        assert_ne!(outside[0].0, retired_generation);
    }

    #[test]
    fn generation_digest_is_component_framed() {
        let a = generation_digest("d", "s", "f", "c", "r");
        let mismatched = generation_digest("ds", "", "f", "c", "r");
        assert_ne!(a, mismatched, "framing must be injective across components");
        assert!(a.starts_with("gen1:"));
    }
}
