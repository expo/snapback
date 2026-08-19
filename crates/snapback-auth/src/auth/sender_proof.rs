//! Closed sender-constrained browser proof codec and ES256 verifier.
//!
//! @ref LLP 0077#protocol-and-algorithms — hosted browser proofs use one
//! canonical ES256/JWK/claim shape with no algorithm or field negotiation.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::signature::{ECDSA_P256_SHA256_FIXED, UnparsedPublicKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

pub use snapback_kernel::auth::sender_proof::{
    SenderIssuanceCommitment, VerifiedSenderIssuance, generate_sender_nonce,
};

use super::crypto::SessionBearer;
use super::provider::AUTH_SESSION_SUPERSESSION_GRACE_MS;
use super::wire::SenderPublicJwk;
pub use crate::contract_types::{
    ReplayConsumeError, SenderAdmission, SenderAdmissionRejection, SenderAdmissionRejectionKind,
    SenderCoverNonceKey, SenderNonce, SenderNonceChallenge, SenderNonceError, VerifiedSenderProof,
};
use crate::contract_types::{
    SenderConstraintLookup, SenderFamilyTombstoneLookup, SenderNonceIssue, SenderNonceRead,
    SenderProofIdConsumption, SenderProofNonceRotation,
};
use crate::storage::auth_sender::{self, SenderProofAuthorityOperations};

const MAX_COMPACT_PROOF_BYTES: usize = 8 * 1024;
const PAST_WINDOW_SECONDS: u64 = 30;
const FUTURE_WINDOW_SECONDS: u64 = 5;
const DEFAULT_REPLAY_CAPACITY: u64 = 100_000;
const DEFAULT_NONCE_CAPACITY: u64 = 100_000;
// A proof issued at `iat` remains acceptable through `iat + PAST_WINDOW_SECONDS`
// inclusive. Retain its id for the following second as well so an exclusive
// expiry purge cannot reopen the final accepted instant.
const REPLAY_RETENTION_AFTER_IAT_SECONDS: u64 = PAST_WINDOW_SECONDS + 1;
/// Bounded revoked-family sender tombstone horizon: the maximum session
/// sliding TTL plus tolerated clock skew, hard-capped at 30 days — the
/// 30-day cap binds, because the sliding window already equals it.
///
/// @ref LLP 0077#author-decisions--2026-07-23 — decision 2: after this bound
/// every credential the tombstone could refuse has itself expired, so a
/// long-offline client lands in ordinary re-authentication.
pub const SENDER_TOMBSTONE_RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
pub const REPLAY_TABLE: &str = "_snapback_sender_proof_replay";
pub const NONCE_TABLE: &str = "_snapback_sender_nonce";
pub const SENDER_ISSUANCE_PROTOCOL: &str = "snapback.sender-issuance.v2";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
struct SenderProofHeader {
    alg: String,
    jwk: SenderProofJwk,
    typ: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
struct SenderProofJwk {
    crv: String,
    kty: String,
    x: String,
    y: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
struct SenderProofPayload {
    ath: String,
    htm: String,
    htu: String,
    iat: u64,
    jti: String,
    nonce: String,
    version: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SenderIssuancePayload {
    challenge_id: String,
    htm: String,
    htu: String,
    iat: u64,
    jti: String,
    protocol: String,
    version: u64,
}

#[derive(Clone, Eq, PartialEq)]
pub struct SenderProofExpectation<'a> {
    pub method: &'a str,
    pub canonical_external_uri: &'a str,
    pub access_token: &'a [u8],
    pub nonce: &'a str,
    pub family_jwk_thumbprint: &'a str,
    pub server_unix_seconds: u64,
}

impl std::fmt::Debug for SenderProofExpectation<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SenderProofExpectation([REDACTED])")
    }
}

#[derive(Clone, Eq, PartialEq)]
pub struct SenderIssuanceExpectation<'a> {
    pub challenge_id: &'a str,
    pub canonical_exchange_uri: &'a str,
    pub public_jwk: &'a SenderPublicJwk,
    pub server_unix_seconds: u64,
}

impl std::fmt::Debug for SenderIssuanceExpectation<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SenderIssuanceExpectation([REDACTED])")
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SenderProofError {
    Malformed,
    Algorithm,
    Binding,
    Nonce,
    Time,
    Signature,
}

/// Deterministic cover nonce for a carrier that resolves to no live bound
/// family: `HMAC(purpose key, epoch ‖ token_digest ‖ time_bucket)`, stable
/// within one nonce-TTL bucket, indistinguishable in shape from a real
/// challenge, and never installed — it can never authorize work.
///
/// @ref LLP 0077#author-decisions--2026-07-23 — decision 3 closes the
/// live-bound-family existence oracle at the cost of one HMAC on the refusal
/// path; no state is stored for unknown carriers.
fn keyed_cover_nonce(
    cover: &SenderCoverNonceKey,
    sender_replay_epoch: u64,
    token_digest: &[u8; 32],
    time_bucket: u64,
) -> String {
    use hmac::{Hmac, Mac as _};
    let mut mac = <Hmac<Sha256> as hmac::Mac>::new_from_slice(cover.as_bytes())
        .expect("HMAC-SHA256 accepts a 32-byte key");
    mac.update(b"snapback.sender-cover-nonce.value.v1");
    mac.update(&sender_replay_epoch.to_be_bytes());
    mac.update(token_digest);
    mac.update(&time_bucket.to_be_bytes());
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

fn canonical_thumbprint(value: &str) -> bool {
    value.len() == 43
        && URL_SAFE_NO_PAD
            .decode(value)
            .is_ok_and(|bytes| bytes.len() == 32 && URL_SAFE_NO_PAD.encode(bytes) == value)
}

fn canonical_nonce(value: &str) -> bool {
    canonical_thumbprint(value)
}

fn rejection(
    kind: SenderAdmissionRejectionKind,
    challenge: Option<String>,
) -> SenderAdmissionRejection {
    SenderAdmissionRejection {
        kind,
        challenge: challenge.map(SenderNonceChallenge),
    }
}

pub fn sender_authority_unavailable_rejection() -> SenderAdmissionRejection {
    rejection(SenderAdmissionRejectionKind::Unavailable, None)
}

fn fresh_challenge(
    authority: &mut impl SenderProofAuthorityOperations,
    admission_epoch: u64,
    family_jwk_thumbprint: Option<&str>,
    now_seconds: u64,
    nonce_ttl_seconds: u64,
    nonce_capacity: Option<u64>,
    cover: Option<(&SenderCoverNonceKey, [u8; 32])>,
) -> Result<SenderAdmissionRejection, SenderAdmissionRejection> {
    if let Some(thumbprint) = family_jwk_thumbprint {
        if let Some(current) = authority
            .read_nonce(SenderNonceRead {
                sender_replay_epoch: admission_epoch,
                family_jwk_thumbprint: thumbprint,
                now_seconds,
            })
            .map_err(|_| rejection(SenderAdmissionRejectionKind::Unavailable, None))?
        {
            return Ok(rejection(
                SenderAdmissionRejectionKind::Required,
                Some(current.expose_for_transport().to_owned()),
            ));
        }
        let nonce = generate_sender_nonce()
            .map_err(|_| rejection(SenderAdmissionRejectionKind::Unavailable, None))?;
        let expires_at = now_seconds
            .checked_add(nonce_ttl_seconds)
            .ok_or_else(|| rejection(SenderAdmissionRejectionKind::Unavailable, None))?;
        authority
            .issue_nonce(SenderNonceIssue {
                sender_replay_epoch: admission_epoch,
                family_jwk_thumbprint: thumbprint,
                nonce: &nonce,
                now_seconds,
                expires_at_seconds: expires_at,
                capacity: nonce_capacity,
            })
            .map_err(|error| {
                rejection(
                    match error {
                        SenderNonceError::Capacity | SenderNonceError::Unavailable => {
                            SenderAdmissionRejectionKind::Unavailable
                        }
                        SenderNonceError::Required
                        | SenderNonceError::Replay
                        | SenderNonceError::Invalid => SenderAdmissionRejectionKind::Invalid,
                    },
                    None,
                )
            })?;
        return Ok(rejection(
            SenderAdmissionRejectionKind::Required,
            Some(nonce),
        ));
    }
    // No resolvable family: return an uninstalled nonce that can never
    // authorize work. With the hosted purpose key it is the deterministic
    // keyed cover value (stable within one nonce-TTL bucket, so a live bound
    // family and an unknown carrier are indistinguishable); without one
    // (uninstalled or local authority) it degrades to a fresh random value.
    let nonce = match cover {
        Some((key, token_digest)) => keyed_cover_nonce(
            key,
            admission_epoch,
            &token_digest,
            now_seconds / nonce_ttl_seconds.max(1),
        ),
        None => generate_sender_nonce()
            .map_err(|_| rejection(SenderAdmissionRejectionKind::Unavailable, None))?,
    };
    Ok(rejection(
        SenderAdmissionRejectionKind::Required,
        Some(nonce),
    ))
}

/// Complete pre-body sender admission for one protected browser HTTP request.
///
/// This function deliberately returns only a redacted typed result and the
/// exact response-header nonce accessor. It does not resolve a user/session
/// projection or ingest an application body.
///
/// @ref LLP 0077#http-binding — family binding, proof verification, replay
/// consumption, and nonce rotation all precede ordinary credential resolution.
#[allow(clippy::too_many_arguments)]
pub fn admit_sender_constrained_request(
    authority: &mut impl SenderProofAuthorityOperations,
    admission_epoch: u64,
    method: &str,
    canonical_external_uri: &str,
    access_token: &str,
    compact_proof: Option<&str>,
    now_seconds: u64,
    nonce_ttl_seconds: u64,
    allow_superseded_grace: bool,
    nonce_capacity: Option<u64>,
    replay_capacity: Option<u64>,
    cover_key: Option<&SenderCoverNonceKey>,
) -> Result<SenderAdmission, SenderAdmissionRejection> {
    if admission_epoch == 0
        || method.is_empty()
        || canonical_external_uri.is_empty()
        || nonce_ttl_seconds < REPLAY_RETENTION_AFTER_IAT_SECONDS
    {
        return Err(rejection(SenderAdmissionRejectionKind::Invalid, None));
    }
    let cover = cover_key.map(|key| {
        let digest = Sha256::digest(access_token.as_bytes());
        let mut token_digest = [0_u8; 32];
        token_digest.copy_from_slice(&digest);
        (key, token_digest)
    });
    // @ref LLP 0077#author-decisions--2026-07-23 — decision 4: both spellings hash
    // and resolve, but the verifier requires the versioned `sbs2_` spelling
    // for a sender-bound family (the "v2 verifiers require it" half below).
    let presented_v1_spelling = SessionBearer::parse(access_token).is_ok();
    let session_bearer = SessionBearer::parse_any_version(access_token).ok();
    let family = match session_bearer.as_ref() {
        Some(bearer) => {
            let now_ms = now_seconds
                .checked_mul(1_000)
                .ok_or_else(|| rejection(SenderAdmissionRejectionKind::Invalid, None))?;
            authority
                .presented_token_sender_constraint(SenderConstraintLookup {
                    token_hash: bearer.token_hash().as_bytes(),
                    now_ms,
                    supersession_grace_ms: allow_superseded_grace
                        .then_some(AUTH_SESSION_SUPERSESSION_GRACE_MS),
                })
                .map_err(|_| rejection(SenderAdmissionRejectionKind::Unavailable, None))?
                .map(|fact| fact.jwk_thumbprint)
        }
        None => None,
    };
    // @ref LLP 0077#author-decisions--2026-07-23 — decision 4, verifier half: a
    // sender-bound family presented in the legacy `sbs_` spelling refuses at
    // proof time. Migration for live pre-change families is deletion-and-
    // re-exchange (LLP 0077: "never attachment"): the custody machine treats
    // the refusal as deletion-only and re-authenticates under a fresh key.
    // The proofless branch below still answers with a challenge, so a
    // bearer-only holder learns nothing it could not learn before (the
    // decision-3 anti-oracle posture is preserved).
    if presented_v1_spelling && family.is_some() && compact_proof.is_some() {
        return Err(rejection(SenderAdmissionRejectionKind::Invalid, None));
    }
    let Some(compact_proof) = compact_proof else {
        return Err(fresh_challenge(
            authority,
            admission_epoch,
            family.as_deref(),
            now_seconds,
            nonce_ttl_seconds,
            nonce_capacity,
            cover,
        )?);
    };
    let Some(family_jwk_thumbprint) = family else {
        // Bounded revoked-family tombstone (decision 2): a fully valid proof
        // over a durable-delete-revoked family's bound key receives the
        // terminal outcome and consumes its proof id without touching nonce
        // state. Anything less than a valid proof — including a malformed or
        // wrong-key one — stays behind the anti-oracle cover challenge, so a
        // bearer-only holder learns nothing about the family's existence.
        if let Some(bearer) = session_bearer.as_ref() {
            let now_ms = now_seconds
                .checked_mul(1_000)
                .ok_or_else(|| rejection(SenderAdmissionRejectionKind::Invalid, None))?;
            let tombstoned = authority
                .family_tombstone(SenderFamilyTombstoneLookup {
                    token_hash: bearer.token_hash().as_bytes(),
                    now_ms,
                    retention_ms: SENDER_TOMBSTONE_RETENTION_MS,
                })
                .map_err(|_| rejection(SenderAdmissionRejectionKind::Unavailable, None))?;
            let tombstone_thumbprint = tombstoned.and_then(|fact| {
                let durable_delete = fact.terminal_reason.is_some_and(|reason| {
                    matches!(
                        reason.authority_disposition(),
                        crate::auth::session_projection::TerminalAuthorityDisposition::DurableDelete
                    )
                });
                durable_delete.then_some(fact.jwk_thumbprint)
            });
            if let Some(tombstone_thumbprint) = tombstone_thumbprint
                && let Ok(claimed_nonce) = claimed_proof_nonce(compact_proof)
            {
                let expected = SenderProofExpectation {
                    method,
                    canonical_external_uri,
                    access_token: access_token.as_bytes(),
                    nonce: &claimed_nonce,
                    family_jwk_thumbprint: &tombstone_thumbprint,
                    server_unix_seconds: now_seconds,
                };
                if let Ok(verified) = verify_sender_proof(compact_proof, &expected) {
                    let replay_expires_at = verified
                        .issued_at_seconds
                        .checked_add(REPLAY_RETENTION_AFTER_IAT_SECONDS)
                        .ok_or_else(|| {
                            rejection(SenderAdmissionRejectionKind::Unavailable, None)
                        })?;
                    return Err(
                        match authority.consume_proof_id(SenderProofIdConsumption {
                            sender_replay_epoch: admission_epoch,
                            proof_id: verified.proof_id,
                            now_seconds,
                            expires_at_seconds: replay_expires_at,
                            capacity: replay_capacity,
                        }) {
                            Ok(()) => {
                                rejection(SenderAdmissionRejectionKind::TerminalDurableDelete, None)
                            }
                            Err(ReplayConsumeError::Replay) => {
                                rejection(SenderAdmissionRejectionKind::Replayed, None)
                            }
                            Err(_) => rejection(SenderAdmissionRejectionKind::Unavailable, None),
                        },
                    );
                }
            }
        }
        return Err(fresh_challenge(
            authority,
            admission_epoch,
            None,
            now_seconds,
            nonce_ttl_seconds,
            nonce_capacity,
            cover,
        )?);
    };
    admit_sender_constrained_bound_request(
        authority,
        admission_epoch,
        method,
        canonical_external_uri,
        access_token,
        Some(compact_proof),
        &family_jwk_thumbprint,
        now_seconds,
        nonce_ttl_seconds,
        nonce_capacity,
        replay_capacity,
        None,
    )
}

/// Admit a proof for a connection-grant carrier whose family identity was
/// already bound by the authenticated connection-open cut.
///
/// @ref LLP 0077#websocket-and-connection-binding — the upgrade proves
/// possession over the exact grant token while retaining the session-family
/// thumbprint captured when that grant was minted.
#[allow(clippy::too_many_arguments)]
pub fn admit_sender_constrained_bound_request(
    authority: &mut impl SenderProofAuthorityOperations,
    admission_epoch: u64,
    method: &str,
    canonical_external_uri: &str,
    access_token: &str,
    compact_proof: Option<&str>,
    family_jwk_thumbprint: &str,
    now_seconds: u64,
    nonce_ttl_seconds: u64,
    nonce_capacity: Option<u64>,
    replay_capacity: Option<u64>,
    issuance_sender_replay_epoch: Option<u64>,
) -> Result<SenderAdmission, SenderAdmissionRejection> {
    if admission_epoch == 0
        || method.is_empty()
        || canonical_external_uri.is_empty()
        || access_token.is_empty()
        || compact_proof.is_some_and(str::is_empty)
        || !canonical_thumbprint(family_jwk_thumbprint)
        || nonce_ttl_seconds < REPLAY_RETENTION_AFTER_IAT_SECONDS
    {
        return Err(rejection(SenderAdmissionRejectionKind::Invalid, None));
    }
    // @ref LLP 0059#boundgrantauthorityv2--sender-bound-grants-amendment-2026-07-23
    // — a sender-bound grant invalidates when `sender_replay_epoch` advances
    // past its issuance value; exact-tuple equality, checked against the
    // durable namespace before any nonce or proof work.
    if issuance_sender_replay_epoch.is_some_and(|issued| issued != admission_epoch) {
        return Err(rejection(SenderAdmissionRejectionKind::Invalid, None));
    }
    let Some(compact_proof) = compact_proof else {
        return Err(fresh_challenge(
            authority,
            admission_epoch,
            Some(family_jwk_thumbprint),
            now_seconds,
            nonce_ttl_seconds,
            nonce_capacity,
            None,
        )?);
    };
    let Some(current) = authority
        .read_nonce(SenderNonceRead {
            sender_replay_epoch: admission_epoch,
            family_jwk_thumbprint,
            now_seconds,
        })
        .map_err(|_| rejection(SenderAdmissionRejectionKind::Unavailable, None))?
    else {
        return Err(fresh_challenge(
            authority,
            admission_epoch,
            Some(family_jwk_thumbprint),
            now_seconds,
            nonce_ttl_seconds,
            nonce_capacity,
            None,
        )?);
    };
    let expected = SenderProofExpectation {
        method,
        canonical_external_uri,
        access_token: access_token.as_bytes(),
        nonce: current.expose_for_transport(),
        family_jwk_thumbprint,
        server_unix_seconds: now_seconds,
    };
    let verified = match verify_sender_proof(compact_proof, &expected) {
        Ok(verified) => verified,
        Err(SenderProofError::Nonce) => {
            return Err(fresh_challenge(
                authority,
                admission_epoch,
                Some(family_jwk_thumbprint),
                now_seconds,
                nonce_ttl_seconds,
                nonce_capacity,
                None,
            )?);
        }
        Err(_) => return Err(rejection(SenderAdmissionRejectionKind::Invalid, None)),
    };
    let next_nonce = generate_sender_nonce()
        .map_err(|_| rejection(SenderAdmissionRejectionKind::Unavailable, None))?;
    let replay_expires_at = verified
        .issued_at_seconds
        .checked_add(REPLAY_RETENTION_AFTER_IAT_SECONDS)
        .ok_or_else(|| rejection(SenderAdmissionRejectionKind::Unavailable, None))?;
    let next_nonce_expires_at = now_seconds
        .checked_add(nonce_ttl_seconds)
        .ok_or_else(|| rejection(SenderAdmissionRejectionKind::Unavailable, None))?;
    match authority.consume_proof_and_rotate_nonce(SenderProofNonceRotation {
        sender_replay_epoch: admission_epoch,
        family_jwk_thumbprint,
        current: &current,
        verified: &verified,
        now_seconds,
        replay_expires_at_seconds: replay_expires_at,
        next_nonce: &next_nonce,
        next_nonce_expires_at_seconds: next_nonce_expires_at,
        replay_capacity,
    }) {
        Ok(next_nonce) => Ok(SenderAdmission {
            verified,
            next_nonce,
            sender_replay_epoch: admission_epoch,
        }),
        Err(SenderNonceError::Required) => {
            let challenge = authority
                .read_nonce(SenderNonceRead {
                    sender_replay_epoch: admission_epoch,
                    family_jwk_thumbprint,
                    now_seconds,
                })
                .map_err(|_| rejection(SenderAdmissionRejectionKind::Unavailable, None))?
                .map(|nonce| nonce.expose_for_transport().to_owned());
            match challenge {
                Some(challenge) => Err(rejection(
                    SenderAdmissionRejectionKind::Required,
                    Some(challenge),
                )),
                None => Err(fresh_challenge(
                    authority,
                    admission_epoch,
                    Some(family_jwk_thumbprint),
                    now_seconds,
                    nonce_ttl_seconds,
                    nonce_capacity,
                    None,
                )?),
            }
        }
        Err(SenderNonceError::Replay) => {
            Err(rejection(SenderAdmissionRejectionKind::Replayed, None))
        }
        Err(SenderNonceError::Capacity | SenderNonceError::Unavailable) => {
            Err(rejection(SenderAdmissionRejectionKind::Unavailable, None))
        }
        Err(SenderNonceError::Invalid) => {
            Err(rejection(SenderAdmissionRejectionKind::Invalid, None))
        }
    }
}

/// Bind a newly issued session to its custody key inside the same transaction
/// that inserts the session. Existing bearer-v1 sessions are never upgraded.

fn decode_canonical(input: &str) -> Result<Vec<u8>, SenderProofError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(input)
        .map_err(|_| SenderProofError::Malformed)?;
    if URL_SAFE_NO_PAD.encode(&bytes) != input {
        return Err(SenderProofError::Malformed);
    }
    Ok(bytes)
}

pub fn sha256_base64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(bytes))
}

fn constant_time_text_eq(left: &str, right: &str) -> bool {
    left.len() == right.len() && bool::from(left.as_bytes().ct_eq(right.as_bytes()))
}

fn canonical_public_key(jwk: &SenderProofJwk) -> Result<(Vec<u8>, String), SenderProofError> {
    if jwk.kty != "EC" || jwk.crv != "P-256" {
        return Err(SenderProofError::Algorithm);
    }
    let x = decode_canonical(&jwk.x)?;
    let y = decode_canonical(&jwk.y)?;
    if x.len() != 32 || y.len() != 32 {
        return Err(SenderProofError::Malformed);
    }
    let mut public_key = Vec::with_capacity(65);
    public_key.push(4);
    public_key.extend_from_slice(&x);
    public_key.extend_from_slice(&y);
    let thumbprint_object = format!(
        "{{\"crv\":\"P-256\",\"kty\":\"EC\",\"x\":\"{}\",\"y\":\"{}\"}}",
        jwk.x, jwk.y
    );
    Ok((public_key, sha256_base64url(thumbprint_object.as_bytes())))
}

fn compact_parts(
    compact: &str,
) -> Result<(&str, &str, Vec<u8>, SenderProofHeader), SenderProofError> {
    if compact.is_empty() || compact.len() > MAX_COMPACT_PROOF_BYTES {
        return Err(SenderProofError::Malformed);
    }
    let mut parts = compact.split('.');
    let encoded_header = parts.next().ok_or(SenderProofError::Malformed)?;
    let encoded_payload = parts.next().ok_or(SenderProofError::Malformed)?;
    let encoded_signature = parts.next().ok_or(SenderProofError::Malformed)?;
    if parts.next().is_some()
        || encoded_header.is_empty()
        || encoded_payload.is_empty()
        || encoded_signature.is_empty()
    {
        return Err(SenderProofError::Malformed);
    }
    let header: SenderProofHeader = serde_json::from_slice(&decode_canonical(encoded_header)?)
        .map_err(|_| SenderProofError::Malformed)?;
    let signature = decode_canonical(encoded_signature)?;
    if header.alg != "ES256" || header.typ != "dpop+jwt" || signature.len() != 64 {
        return Err(SenderProofError::Algorithm);
    }
    Ok((encoded_header, encoded_payload, signature, header))
}

fn verify_time(issued_at_seconds: u64, server_unix_seconds: u64) -> Result<(), SenderProofError> {
    if issued_at_seconds.saturating_add(PAST_WINDOW_SECONDS) < server_unix_seconds
        || issued_at_seconds > server_unix_seconds.saturating_add(FUTURE_WINDOW_SECONDS)
    {
        return Err(SenderProofError::Time);
    }
    Ok(())
}

fn fixed_proof_id(encoded: &str) -> Result<[u8; 16], SenderProofError> {
    let proof_id = decode_canonical(encoded)?;
    if proof_id.len() != 16 {
        return Err(SenderProofError::Malformed);
    }
    let mut fixed = [0_u8; 16];
    fixed.copy_from_slice(&proof_id);
    Ok(fixed)
}

/// The nonce value a compact proof claims, decoded with the same strict
/// codec as full verification. The tombstone path verifies every binding
/// axis except installed-nonce equality (a tombstoned family never installs
/// or rotates one), so the claimed value substitutes for the expectation.
fn claimed_proof_nonce(compact: &str) -> Result<String, SenderProofError> {
    let (_, encoded_payload, _, _) = compact_parts(compact)?;
    let payload: SenderProofPayload = serde_json::from_slice(&decode_canonical(encoded_payload)?)
        .map_err(|_| SenderProofError::Malformed)?;
    Ok(payload.nonce)
}

pub fn verify_sender_proof(
    compact: &str,
    expected: &SenderProofExpectation<'_>,
) -> Result<VerifiedSenderProof, SenderProofError> {
    let (encoded_header, encoded_payload, signature, header) = compact_parts(compact)?;
    let payload: SenderProofPayload = serde_json::from_slice(&decode_canonical(encoded_payload)?)
        .map_err(|_| SenderProofError::Malformed)?;
    if payload.version != 2 {
        return Err(SenderProofError::Algorithm);
    }
    let (public_key, thumbprint) = canonical_public_key(&header.jwk)?;
    let proof_id = fixed_proof_id(&payload.jti)?;
    let expected_ath = sha256_base64url(expected.access_token);
    if payload.htm != expected.method
        || payload.htu != expected.canonical_external_uri
        || !constant_time_text_eq(&payload.ath, &expected_ath)
        || !constant_time_text_eq(&thumbprint, expected.family_jwk_thumbprint)
    {
        return Err(SenderProofError::Binding);
    }
    if !constant_time_text_eq(&payload.nonce, expected.nonce) {
        return Err(SenderProofError::Nonce);
    }
    verify_time(payload.iat, expected.server_unix_seconds)?;
    let signing_input = format!("{encoded_header}.{encoded_payload}");
    UnparsedPublicKey::new(&ECDSA_P256_SHA256_FIXED, public_key)
        .verify(signing_input.as_bytes(), &signature)
        .map_err(|_| SenderProofError::Signature)?;
    Ok(VerifiedSenderProof {
        proof_id,
        jwk_thumbprint: thumbprint,
        issued_at_seconds: payload.iat,
    })
}

/// Verify the distinct no-bearer issuance proof. The separately transported
/// JWK must be byte-for-byte the same canonical public identity as the signed
/// header, so neither carrier can substitute a key.
///
/// @ref LLP 0077#issuance-refresh-and-recovery — exchange covers the exact
/// challenge and endpoint before the key is bound inside session creation.
pub fn verify_sender_issuance_proof(
    compact: &str,
    expected: &SenderIssuanceExpectation<'_>,
) -> Result<VerifiedSenderIssuance, SenderProofError> {
    let (encoded_header, encoded_payload, signature, header) = compact_parts(compact)?;
    let payload: SenderIssuancePayload =
        serde_json::from_slice(&decode_canonical(encoded_payload)?)
            .map_err(|_| SenderProofError::Malformed)?;
    if payload.version != 2 || payload.protocol != SENDER_ISSUANCE_PROTOCOL {
        return Err(SenderProofError::Algorithm);
    }
    let (public_key, thumbprint) = canonical_public_key(&header.jwk)?;
    if expected.public_jwk.crv != header.jwk.crv
        || expected.public_jwk.kty != header.jwk.kty
        || expected.public_jwk.x != header.jwk.x
        || expected.public_jwk.y != header.jwk.y
        || payload.htm != "POST"
        || payload.htu != expected.canonical_exchange_uri
        || payload.challenge_id != expected.challenge_id
    {
        return Err(SenderProofError::Binding);
    }
    verify_time(payload.iat, expected.server_unix_seconds)?;
    let proof_id = fixed_proof_id(&payload.jti)?;
    let signing_input = format!("{encoded_header}.{encoded_payload}");
    UnparsedPublicKey::new(&ECDSA_P256_SHA256_FIXED, public_key)
        .verify(signing_input.as_bytes(), &signature)
        .map_err(|_| SenderProofError::Signature)?;
    Ok(VerifiedSenderIssuance {
        proof_id,
        jwk_thumbprint: thumbprint,
        issued_at_seconds: payload.iat,
    })
}
