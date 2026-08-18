//! Storage-owned sender-proof commitment and durable lookup operations.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::rand::{SecureRandom, SystemRandom};
use rusqlite::{Connection, ErrorCode, OptionalExtension, Transaction, params};

pub use crate::contract_types::{ReplayConsumeError, SenderConstraintLookup, SenderNonceError};
use crate::storage::auth_sender;

const DEFAULT_REPLAY_CAPACITY: u64 = 100_000;
const DEFAULT_NONCE_CAPACITY: u64 = 100_000;
const REPLAY_RETENTION_AFTER_IAT_SECONDS: u64 = 31;
const REPLAY_TABLE: &str = "_snapback_sender_proof_replay";
const NONCE_TABLE: &str = "_snapback_sender_nonce";
pub const AUTH_SESSION_SUPERSESSION_GRACE_MS: u64 = 10 * 1_000;

pub fn sender_replay_epoch(connection: &Connection) -> Result<u64, ReplayConsumeError> {
    auth_sender::sender_replay_epoch_on(connection)
}

fn canonical_thumbprint(value: &str) -> bool {
    value.len() == 43
        && URL_SAFE_NO_PAD.decode(value).is_ok_and(|bytes| {
            bytes.len() == 32 && URL_SAFE_NO_PAD.encode(bytes) == value
        })
}

fn canonical_nonce(value: &str) -> bool {
    canonical_thumbprint(value)
}

#[derive(Clone, Eq, PartialEq)]
pub struct VerifiedSenderIssuance {
    pub proof_id: [u8; 16],
    pub jwk_thumbprint: String,
    pub issued_at_seconds: u64,
}

impl std::fmt::Debug for VerifiedSenderIssuance {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("VerifiedSenderIssuance([REDACTED])")
    }
}

/// Durable facts that must either all commit with a new session or all remain
/// absent. The nonce and public-key identity are deliberately redacted from
/// Debug and have only narrow transport/reconciliation accessors.
#[derive(Clone, Eq, PartialEq)]
pub struct SenderIssuanceCommitment {
    jwk_thumbprint: String,
    proof_id: [u8; 16],
    committed_at_seconds: u64,
    proof_expires_at_seconds: u64,
    initial_nonce: String,
    initial_nonce_expires_at_seconds: u64,
}

impl std::fmt::Debug for SenderIssuanceCommitment {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SenderIssuanceCommitment([REDACTED])")
    }
}


pub fn generate_sender_nonce() -> Result<String, SenderNonceError> {
    let mut bytes = [0_u8; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| SenderNonceError::Unavailable)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

impl SenderIssuanceCommitment {
    pub fn new(
        verified: VerifiedSenderIssuance,
        now_seconds: u64,
        nonce_ttl_seconds: u64,
    ) -> Result<Self, SenderNonceError> {
        if !canonical_thumbprint(&verified.jwk_thumbprint)
            || now_seconds > i64::MAX as u64
            || nonce_ttl_seconds < REPLAY_RETENTION_AFTER_IAT_SECONDS
        {
            return Err(SenderNonceError::Invalid);
        }
        let proof_expires_at_seconds = verified
            .issued_at_seconds
            .checked_add(REPLAY_RETENTION_AFTER_IAT_SECONDS)
            .filter(|value| *value <= i64::MAX as u64)
            .ok_or(SenderNonceError::Invalid)?;
        if proof_expires_at_seconds <= now_seconds {
            return Err(SenderNonceError::Invalid);
        }
        let initial_nonce_expires_at_seconds = now_seconds
            .checked_add(nonce_ttl_seconds)
            .filter(|value| *value <= i64::MAX as u64)
            .ok_or(SenderNonceError::Invalid)?;
        Ok(Self {
            jwk_thumbprint: verified.jwk_thumbprint,
            proof_id: verified.proof_id,
            committed_at_seconds: now_seconds,
            proof_expires_at_seconds,
            initial_nonce: generate_sender_nonce()?,
            initial_nonce_expires_at_seconds,
        })
    }

    pub fn initial_nonce_for_transport(&self) -> &str {
        &self.initial_nonce
    }

    fn consume_replay(&self, transaction: &Transaction<'_>) -> Result<(), ReplayConsumeError> {
        let sender_replay_epoch = sender_replay_epoch(transaction)?;
        transaction
            .execute(
                &format!("DELETE FROM {REPLAY_TABLE} WHERE expires_at_seconds < ?1"),
                params![self.committed_at_seconds as i64],
            )
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        let replay_count: i64 = transaction
            .query_row(&format!("SELECT COUNT(*) FROM {REPLAY_TABLE}"), [], |row| {
                row.get(0)
            })
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        if replay_count < 0 || replay_count as u64 >= DEFAULT_REPLAY_CAPACITY {
            return Err(ReplayConsumeError::Capacity);
        }
        transaction
            .execute(
                &format!(
                    "INSERT INTO {REPLAY_TABLE}
                     (admission_epoch, proof_id, expires_at_seconds)
                     VALUES (?1, ?2, ?3)"
                ),
                params![
                    sender_replay_epoch as i64,
                    self.proof_id.as_slice(),
                    self.proof_expires_at_seconds as i64,
                ],
            )
            .map_err(|error| {
                if error
                    .sqlite_error_code()
                    .is_some_and(|code| code == ErrorCode::ConstraintViolation)
                {
                    ReplayConsumeError::Replay
                } else {
                    ReplayConsumeError::Unavailable
                }
            })?;
        Ok(())
    }

    /// Consume a cryptographically valid issuance proof when code exchange
    /// refuses. No family binding or nonce is installed on a refused outcome.
    pub fn consume_rejected_outcome(
        &self,
        transaction: &Transaction<'_>,
    ) -> Result<(), ReplayConsumeError> {
        self.consume_replay(transaction)
    }

    /// Add proof replay retention, family binding, and generation-one nonce to
    /// the same provider transaction that inserts the session.
    pub fn install(
        &self,
        transaction: &Transaction<'_>,
        session_id: &str,
    ) -> Result<(), ReplayConsumeError> {
        let sender_replay_epoch = sender_replay_epoch(transaction)?;
        if session_id.is_empty()
            || !canonical_thumbprint(&self.jwk_thumbprint)
            || !canonical_nonce(&self.initial_nonce)
        {
            return Err(ReplayConsumeError::Invalid);
        }
        transaction
            .execute(
                &format!("DELETE FROM {NONCE_TABLE} WHERE expires_at_seconds < ?1"),
                params![self.committed_at_seconds as i64],
            )
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        let nonce_count: i64 = transaction
            .query_row(&format!("SELECT COUNT(*) FROM {NONCE_TABLE}"), [], |row| {
                row.get(0)
            })
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        if nonce_count < 0 || nonce_count as u64 >= DEFAULT_NONCE_CAPACITY {
            return Err(ReplayConsumeError::Capacity);
        }
        self.consume_replay(transaction)?;
        bind_issued_session_sender_constraint(transaction, session_id, &self.jwk_thumbprint)?;
        transaction
            .execute(
                &format!(
                    "INSERT INTO {NONCE_TABLE}
                     (admission_epoch, jwk_thumbprint, generation, nonce,
                      expires_at_seconds)
                     VALUES (?1, ?2, 1, ?3, ?4)"
                ),
                params![
                    sender_replay_epoch as i64,
                    self.jwk_thumbprint,
                    self.initial_nonce,
                    self.initial_nonce_expires_at_seconds as i64,
                ],
            )
            .map_err(|error| {
                if error
                    .sqlite_error_code()
                    .is_some_and(|code| code == ErrorCode::ConstraintViolation)
                {
                    ReplayConsumeError::KeyBound
                } else {
                    ReplayConsumeError::Unavailable
                }
            })?;
        Ok(())
    }

    /// True when the current epoch already holds a live (unexpired) nonce cell
    /// for this commitment's thumbprint — i.e. another session family is bound
    /// to the same key. `install` would refuse such an insert on its
    /// `(admission_epoch, jwk_thumbprint)` primary key; callers use this check
    /// inside the same write transaction to refuse with a coded outcome before
    /// any session state is written. Expired cells do not count: `install`
    /// garbage-collects them ahead of its insert.
    pub fn thumbprint_has_live_family(
        &self,
        transaction: &Transaction<'_>,
    ) -> Result<bool, ReplayConsumeError> {
        let sender_replay_epoch = sender_replay_epoch(transaction)?;
        transaction
            .query_row(
                &format!(
                    "SELECT EXISTS(
                       SELECT 1 FROM {NONCE_TABLE}
                       WHERE admission_epoch = ?1 AND jwk_thumbprint = ?2
                         AND expires_at_seconds >= ?3
                     )"
                ),
                params![
                    sender_replay_epoch as i64,
                    self.jwk_thumbprint,
                    self.committed_at_seconds as i64,
                ],
                |row| row.get(0),
            )
            .map_err(|_| ReplayConsumeError::Unavailable)
    }

    /// Durable witness that a key-bound refusal committed: the proof id was
    /// consumed, no family binding exists for the refused session id, and the
    /// thumbprint's nonce cell still belongs to the pre-existing family.
    pub fn is_key_bound_successor(
        &self,
        connection: &Connection,
        session_id: &str,
    ) -> Result<bool, ReplayConsumeError> {
        let sender_replay_epoch = sender_replay_epoch(connection)?;
        let binding: bool = connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM _snapback_sender_family_binding WHERE session_id = ?1
                 )",
                params![session_id],
                |row| row.get(0),
            )
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        let replay_expiry: Option<i64> = connection
            .query_row(
                &format!(
                    "SELECT expires_at_seconds FROM {REPLAY_TABLE}
                     WHERE admission_epoch = ?1 AND proof_id = ?2"
                ),
                params![sender_replay_epoch as i64, self.proof_id.as_slice()],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        let foreign_nonce: bool = connection
            .query_row(
                &format!(
                    "SELECT EXISTS(
                       SELECT 1 FROM {NONCE_TABLE}
                       WHERE admission_epoch = ?1 AND jwk_thumbprint = ?2
                         AND nonce <> ?3
                     )"
                ),
                params![
                    sender_replay_epoch as i64,
                    self.jwk_thumbprint,
                    self.initial_nonce,
                ],
                |row| row.get(0),
            )
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        Ok(
            !binding
                && foreign_nonce
                && replay_expiry == Some(self.proof_expires_at_seconds as i64),
        )
    }

    pub fn is_exact_successor(
        &self,
        connection: &Connection,
        session_id: &str,
    ) -> Result<bool, ReplayConsumeError> {
        let sender_replay_epoch = sender_replay_epoch(connection)?;
        let binding: Option<(i64, String)> = connection
            .query_row(
                "SELECT protocol_version, jwk_thumbprint
                 FROM _snapback_sender_family_binding WHERE session_id = ?1",
                params![session_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        let replay_expiry: Option<i64> = connection
            .query_row(
                &format!(
                    "SELECT expires_at_seconds FROM {REPLAY_TABLE}
                     WHERE admission_epoch = ?1 AND proof_id = ?2"
                ),
                params![sender_replay_epoch as i64, self.proof_id.as_slice()],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        let nonce: Option<(i64, String, i64)> = connection
            .query_row(
                &format!(
                    "SELECT generation, nonce, expires_at_seconds FROM {NONCE_TABLE}
                     WHERE admission_epoch = ?1 AND jwk_thumbprint = ?2"
                ),
                params![sender_replay_epoch as i64, self.jwk_thumbprint],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        Ok(binding == Some((2, self.jwk_thumbprint.clone()))
            && replay_expiry == Some(self.proof_expires_at_seconds as i64)
            && nonce
                == Some((
                    1,
                    self.initial_nonce.clone(),
                    self.initial_nonce_expires_at_seconds as i64,
                )))
    }

    pub fn is_rejected_successor(
        &self,
        connection: &Connection,
        session_id: &str,
    ) -> Result<bool, ReplayConsumeError> {
        let sender_replay_epoch = sender_replay_epoch(connection)?;
        let binding: bool = connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM _snapback_sender_family_binding WHERE session_id = ?1
                 )",
                params![session_id],
                |row| row.get(0),
            )
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        let replay_expiry: Option<i64> = connection
            .query_row(
                &format!(
                    "SELECT expires_at_seconds FROM {REPLAY_TABLE}
                     WHERE admission_epoch = ?1 AND proof_id = ?2"
                ),
                params![sender_replay_epoch as i64, self.proof_id.as_slice()],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        let nonce: bool = connection
            .query_row(
                &format!(
                    "SELECT EXISTS(
                       SELECT 1 FROM {NONCE_TABLE}
                       WHERE admission_epoch = ?1 AND jwk_thumbprint = ?2
                     )"
                ),
                params![sender_replay_epoch as i64, self.jwk_thumbprint],
                |row| row.get(0),
            )
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        Ok(!binding && !nonce && replay_expiry == Some(self.proof_expires_at_seconds as i64))
    }

    pub fn is_exact_predecessor(
        &self,
        connection: &Connection,
        session_id: &str,
    ) -> Result<bool, ReplayConsumeError> {
        let sender_replay_epoch = sender_replay_epoch(connection)?;
        let binding: bool = connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM _snapback_sender_family_binding WHERE session_id = ?1
                 )",
                params![session_id],
                |row| row.get(0),
            )
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        let replay: bool = connection
            .query_row(
                &format!(
                    "SELECT EXISTS(
                       SELECT 1 FROM {REPLAY_TABLE}
                       WHERE admission_epoch = ?1 AND proof_id = ?2
                     )"
                ),
                params![sender_replay_epoch as i64, self.proof_id.as_slice()],
                |row| row.get(0),
            )
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        let nonce: bool = connection
            .query_row(
                &format!(
                    "SELECT EXISTS(
                       SELECT 1 FROM {NONCE_TABLE}
                       WHERE admission_epoch = ?1 AND jwk_thumbprint = ?2
                     )"
                ),
                params![sender_replay_epoch as i64, self.jwk_thumbprint],
                |row| row.get(0),
            )
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        Ok(!binding && !replay && !nonce)
    }
}


pub fn bind_issued_session_sender_constraint(
    transaction: &Transaction<'_>,
    session_id: &str,
    jwk_thumbprint: &str,
) -> Result<(), ReplayConsumeError> {
    if session_id.is_empty() || !canonical_thumbprint(jwk_thumbprint) {
        return Err(ReplayConsumeError::Invalid);
    }
    match transaction.execute(
        "INSERT INTO _snapback_sender_family_binding
         (session_id, protocol_version, jwk_thumbprint)
         VALUES (?1, 2, ?2)",
        params![session_id, jwk_thumbprint],
    ) {
        Ok(1) => Ok(()),
        _ => Err(ReplayConsumeError::Unavailable),
    }
}

/// Resolve only the key thumbprint needed for proof verification. This is not
/// ordinary session authentication and publishes no user/session projection.
pub fn sender_constraint_for_presented_token(
    connection: &Connection,
    token_hash: &[u8],
    now_ms: u64,
    allow_superseded_grace: bool,
) -> Result<Option<String>, ReplayConsumeError> {
    auth_sender::sender_constraint_for_presented_token_on(
        connection,
        SenderConstraintLookup {
            token_hash,
            now_ms,
            supersession_grace_ms: allow_superseded_grace
                .then_some(AUTH_SESSION_SUPERSESSION_GRACE_MS),
        },
    )
    .map(|fact| fact.map(|fact| fact.jwk_thumbprint))
}
