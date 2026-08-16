//! Storage-owned sender-proof replay and nonce authority.
//!
//! The server layer never receives a raw SQLite connection. Transport borrows
//! this narrow authority from `LocalDatabase` and passes it to sender-proof
//! policy, which composes typed durable operations downward.

use super::LocalDatabase;
use crate::contract_types::{
    ReplayConsumeError, SenderConstraintFact, SenderConstraintLookup, SenderFamilyTombstoneFact,
    SenderFamilyTombstoneLookup, SenderNonce, SenderNonceError, SenderNonceIssue, SenderNonceRead,
    SenderProofIdConsumption, SenderProofNonceRotation,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rusqlite::{
    Connection, ErrorCode, OptionalExtension as _, Transaction, TransactionBehavior, params,
};
use subtle::ConstantTimeEq as _;

const DEFAULT_REPLAY_CAPACITY: u64 = 100_000;
const DEFAULT_NONCE_CAPACITY: u64 = 100_000;
const REPLAY_RETENTION_AFTER_IAT_SECONDS: u64 = 31;
const REPLAY_TABLE: &str = "_snapback_sender_proof_replay";
const NONCE_TABLE: &str = "_snapback_sender_nonce";
const EPOCH_TABLE: &str = "_snapback_sender_replay_epoch";

fn sender_authority_error(reason: &'static str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_SENDER_PROOF_AUTHORITY_UNAVAILABLE",
        "auth",
        "sender proof authority is unavailable",
    )
    .with_details(serde_json::json!({ "reason": reason }))
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

fn checked_i64(value: u64) -> Result<i64, SenderNonceError> {
    i64::try_from(value).map_err(|_| SenderNonceError::Invalid)
}

fn constant_time_text_eq(left: &str, right: &str) -> bool {
    left.as_bytes().ct_eq(right.as_bytes()).into()
}

/// Create the durable replay table only after LLP 0060's hosted startup
/// preflight has authenticated the handler/admission boundary. Calling this
/// function is deployment authority; request verification never creates DDL.
///
/// @ref LLP 0077#http-binding — replay consumption is atomic, bounded, durable
/// across process restart, and precedes application execution.
pub(crate) fn initialize_sender_proof_replay_on(
    connection: &Connection,
) -> Result<(), ReplayConsumeError> {
    connection
        .execute_batch(&format!(
            "CREATE TABLE IF NOT EXISTS {REPLAY_TABLE} (
                admission_epoch INTEGER NOT NULL,
                proof_id BLOB NOT NULL CHECK(length(proof_id) = 16),
                expires_at_seconds INTEGER NOT NULL,
                PRIMARY KEY (admission_epoch, proof_id)
            ) STRICT;
            CREATE INDEX IF NOT EXISTS _snapback_sender_proof_replay_expiry
                ON {REPLAY_TABLE}(expires_at_seconds);
            CREATE TABLE IF NOT EXISTS {NONCE_TABLE} (
                admission_epoch INTEGER NOT NULL,
                jwk_thumbprint TEXT NOT NULL
                    CHECK(length(jwk_thumbprint) = 43),
                generation INTEGER NOT NULL CHECK(generation > 0),
                nonce TEXT NOT NULL CHECK(length(nonce) = 43),
                expires_at_seconds INTEGER NOT NULL,
                PRIMARY KEY (admission_epoch, jwk_thumbprint)
            ) STRICT;
            CREATE INDEX IF NOT EXISTS _snapback_sender_nonce_expiry
                ON {NONCE_TABLE}(expires_at_seconds);
            CREATE TABLE IF NOT EXISTS {EPOCH_TABLE} (
                singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                epoch INTEGER NOT NULL CHECK(epoch > 0)
            ) STRICT;
            INSERT OR IGNORE INTO {EPOCH_TABLE}(singleton, epoch) VALUES (1, 1);
            CREATE TABLE IF NOT EXISTS _snapback_sender_family_binding (
                session_id TEXT PRIMARY KEY
                    REFERENCES _auth_sessions(id) ON DELETE CASCADE,
                protocol_version INTEGER NOT NULL CHECK(protocol_version = 2),
                jwk_thumbprint TEXT NOT NULL
                    CHECK(length(jwk_thumbprint) = 43)
            ) STRICT;"
        ))
        .map_err(|_| ReplayConsumeError::Unavailable)
}

/// Read the durable sender replay namespace. The historical SQL column name
/// `admission_epoch` stores this value; it is no longer sourced from the
/// short-lived serving admission.
///
/// @ref LLP 0077#issuance-refresh-and-recovery — restart and rollout preserve
/// one sender namespace, while stream reset rotates it transactionally.
pub(crate) fn sender_replay_epoch_on(connection: &Connection) -> Result<u64, ReplayConsumeError> {
    let epoch: i64 = connection
        .query_row(
            &format!("SELECT epoch FROM {EPOCH_TABLE} WHERE singleton = 1"),
            [],
            |row| row.get(0),
        )
        .map_err(|_| ReplayConsumeError::Unavailable)?;
    u64::try_from(epoch)
        .ok()
        .filter(|value| *value > 0)
        .ok_or(ReplayConsumeError::Unavailable)
}

/// Apply the control-plane monotone floor to the durable sender replay
/// namespace at hosted-authority install. If the floor is ahead of the
/// durable counter the durable tables were rolled back wholesale: the epoch
/// advances to the floor and the replay/nonce tables are cleared in one
/// transaction. A floor at or below the durable counter is a no-op.
///
/// @ref LLP 0077#author-decisions--2026-07-23 — decision 1: effective epoch
/// = max(incarnation-derived durable value, control-plane floor); the floor
/// lives outside the rolled-back durable set and only ever advances.
pub(crate) fn apply_sender_replay_epoch_floor_on(
    connection: &mut Connection,
    floor: u64,
) -> Result<(), ReplayConsumeError> {
    if floor == 0 {
        return Ok(());
    }
    let floor = i64::try_from(floor).map_err(|_| ReplayConsumeError::Invalid)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| ReplayConsumeError::Unavailable)?;
    let current: i64 = transaction
        .query_row(
            &format!("SELECT epoch FROM {EPOCH_TABLE} WHERE singleton = 1"),
            [],
            |row| row.get(0),
        )
        .map_err(|_| ReplayConsumeError::Unavailable)?;
    if floor > current {
        let advanced = transaction
            .execute(
                &format!("UPDATE {EPOCH_TABLE} SET epoch = ?1 WHERE singleton = 1"),
                params![floor],
            )
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        if advanced != 1 {
            return Err(ReplayConsumeError::Unavailable);
        }
        transaction
            .execute(&format!("DELETE FROM {REPLAY_TABLE}"), [])
            .map_err(|_| ReplayConsumeError::Unavailable)?;
        transaction
            .execute(&format!("DELETE FROM {NONCE_TABLE}"), [])
            .map_err(|_| ReplayConsumeError::Unavailable)?;
    }
    transaction
        .commit()
        .map_err(|_| ReplayConsumeError::Unavailable)
}

/// Rotate the sender namespace inside the authorization-stream reset
/// transaction. An uninitialized hosted sender authority is a no-op.
pub(crate) fn rotate_sender_replay_epoch_for_stream_reset_on(
    transaction: &Transaction<'_>,
) -> Result<(), ReplayConsumeError> {
    let initialized: bool = transaction
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1
             )",
            params![EPOCH_TABLE],
            |row| row.get(0),
        )
        .map_err(|_| ReplayConsumeError::Unavailable)?;
    if !initialized {
        return Ok(());
    }
    let advanced = transaction
        .execute(
            &format!(
                "UPDATE {EPOCH_TABLE}
                 SET epoch = epoch + 1
                 WHERE singleton = 1 AND epoch < ?1"
            ),
            params![i64::MAX],
        )
        .map_err(|_| ReplayConsumeError::Unavailable)?;
    if advanced != 1 {
        return Err(ReplayConsumeError::Unavailable);
    }
    transaction
        .execute(&format!("DELETE FROM {REPLAY_TABLE}"), [])
        .map_err(|_| ReplayConsumeError::Unavailable)?;
    transaction
        .execute(&format!("DELETE FROM {NONCE_TABLE}"), [])
        .map_err(|_| ReplayConsumeError::Unavailable)?;
    Ok(())
}

pub(super) fn rotate_sender_authority_for_stream_reset(
    transaction: &Transaction<'_>,
) -> SnapbackResult<()> {
    rotate_sender_replay_epoch_for_stream_reset_on(transaction)
        .map_err(|_| sender_authority_error("epoch-rotation"))
}

pub(crate) struct SenderProofAuthority<'a> {
    connection: &'a mut Connection,
}

impl SenderProofAuthority<'_> {
    pub(crate) fn sender_replay_epoch(&self) -> Result<u64, ReplayConsumeError> {
        sender_replay_epoch_on(self.connection)
    }
}

/// Narrow durable operations consumed by sender-proof policy. Implementations
/// read or commit the supplied tuple; they do not classify admission outcomes.
pub(crate) trait SenderProofAuthorityOperations {
    fn issue_nonce(&mut self, input: SenderNonceIssue<'_>)
    -> Result<SenderNonce, SenderNonceError>;

    fn read_nonce(
        &self,
        input: SenderNonceRead<'_>,
    ) -> Result<Option<SenderNonce>, SenderNonceError>;

    fn consume_proof_and_rotate_nonce(
        &mut self,
        input: SenderProofNonceRotation<'_>,
    ) -> Result<SenderNonce, SenderNonceError>;

    fn consume_proof_id(
        &mut self,
        input: SenderProofIdConsumption,
    ) -> Result<(), ReplayConsumeError>;

    fn presented_token_sender_constraint(
        &self,
        input: SenderConstraintLookup<'_>,
    ) -> Result<Option<SenderConstraintFact>, ReplayConsumeError>;

    fn family_tombstone(
        &self,
        input: SenderFamilyTombstoneLookup<'_>,
    ) -> Result<Option<SenderFamilyTombstoneFact>, ReplayConsumeError>;
}

impl SenderProofAuthorityOperations for SenderProofAuthority<'_> {
    fn issue_nonce(
        &mut self,
        input: SenderNonceIssue<'_>,
    ) -> Result<SenderNonce, SenderNonceError> {
        issue_sender_nonce_on(self.connection, input)
    }

    fn read_nonce(
        &self,
        input: SenderNonceRead<'_>,
    ) -> Result<Option<SenderNonce>, SenderNonceError> {
        read_sender_nonce_on(self.connection, input)
    }

    fn consume_proof_and_rotate_nonce(
        &mut self,
        input: SenderProofNonceRotation<'_>,
    ) -> Result<SenderNonce, SenderNonceError> {
        consume_sender_proof_and_rotate_nonce_on(self.connection, input)
    }

    fn consume_proof_id(
        &mut self,
        input: SenderProofIdConsumption,
    ) -> Result<(), ReplayConsumeError> {
        consume_sender_proof_id_on(self.connection, input)
    }

    fn presented_token_sender_constraint(
        &self,
        input: SenderConstraintLookup<'_>,
    ) -> Result<Option<SenderConstraintFact>, ReplayConsumeError> {
        sender_constraint_for_presented_token_on(self.connection, input)
    }

    fn family_tombstone(
        &self,
        input: SenderFamilyTombstoneLookup<'_>,
    ) -> Result<Option<SenderFamilyTombstoneFact>, ReplayConsumeError> {
        tombstoned_sender_family_on(self.connection, input)
    }
}

#[cfg(test)]
impl SenderProofAuthorityOperations for Connection {
    fn issue_nonce(
        &mut self,
        input: SenderNonceIssue<'_>,
    ) -> Result<SenderNonce, SenderNonceError> {
        issue_sender_nonce_on(self, input)
    }

    fn read_nonce(
        &self,
        input: SenderNonceRead<'_>,
    ) -> Result<Option<SenderNonce>, SenderNonceError> {
        read_sender_nonce_on(self, input)
    }

    fn consume_proof_and_rotate_nonce(
        &mut self,
        input: SenderProofNonceRotation<'_>,
    ) -> Result<SenderNonce, SenderNonceError> {
        consume_sender_proof_and_rotate_nonce_on(self, input)
    }

    fn consume_proof_id(
        &mut self,
        input: SenderProofIdConsumption,
    ) -> Result<(), ReplayConsumeError> {
        consume_sender_proof_id_on(self, input)
    }

    fn presented_token_sender_constraint(
        &self,
        input: SenderConstraintLookup<'_>,
    ) -> Result<Option<SenderConstraintFact>, ReplayConsumeError> {
        sender_constraint_for_presented_token_on(self, input)
    }

    fn family_tombstone(
        &self,
        input: SenderFamilyTombstoneLookup<'_>,
    ) -> Result<Option<SenderFamilyTombstoneFact>, ReplayConsumeError> {
        tombstoned_sender_family_on(self, input)
    }
}

impl LocalDatabase {
    pub(crate) fn sender_proof_authority(&mut self) -> SenderProofAuthority<'_> {
        SenderProofAuthority {
            connection: &mut self.conn,
        }
    }

    /// DDL authority retained exclusively by authenticated hosted preflight.
    /// Request admission never creates or repairs replay/nonce tables.
    #[allow(dead_code)] // Invoked when a concrete hosted adapter installs authority.
    pub(crate) fn initialize_sender_proof_after_hosted_preflight(&self) -> SnapbackResult<()> {
        initialize_sender_proof_replay_on(&self.conn).map_err(|error| {
            let reason = match error {
                ReplayConsumeError::Capacity => "capacity",
                ReplayConsumeError::Replay => "replay",
                ReplayConsumeError::Unavailable => "unavailable",
                ReplayConsumeError::Invalid => "invalid",
                // Table DDL performs no family install; unreachable here.
                ReplayConsumeError::KeyBound => "key-bound",
            };
            SnapbackError::error(
                "SNAPBACK_AUTH_SENDER_PROOF_AUTHORITY_UNAVAILABLE",
                "auth",
                "sender proof authority could not be initialized",
            )
            .with_details(serde_json::json!({ "reason": reason }))
        })
    }

    /// Apply the control-plane monotone floor at hosted-authority install.
    #[allow(dead_code)] // Invoked when a concrete hosted adapter installs authority.
    pub(crate) fn apply_sender_replay_epoch_floor(&mut self, floor: u64) -> SnapbackResult<()> {
        apply_sender_replay_epoch_floor_on(&mut self.conn, floor)
            .map_err(|_| sender_authority_error("epoch-floor"))
    }

    #[cfg(test)]
    pub(crate) fn make_sender_proof_replay_unavailable_for_test(&self) -> SnapbackResult<()> {
        self.conn
            .execute_batch("DROP TABLE _snapback_sender_proof_replay;")
            .map_err(Into::into)
    }
}

/// Install or replace one nonce generation. The caller has already selected
/// whether issuance is appropriate; this operation only validates and commits
/// the supplied durable tuple.
pub(crate) fn issue_sender_nonce_on(
    connection: &mut Connection,
    input: SenderNonceIssue<'_>,
) -> Result<SenderNonce, SenderNonceError> {
    let admission_epoch = checked_i64(input.sender_replay_epoch)?;
    let now_seconds_i64 = checked_i64(input.now_seconds)?;
    let expires_at_seconds_i64 = checked_i64(input.expires_at_seconds)?;
    let capacity = input.capacity.unwrap_or(DEFAULT_NONCE_CAPACITY);
    if admission_epoch <= 0
        || !canonical_thumbprint(input.family_jwk_thumbprint)
        || !canonical_nonce(input.nonce)
        || input.expires_at_seconds <= input.now_seconds
        || capacity == 0
        || capacity > i64::MAX as u64
    {
        return Err(SenderNonceError::Invalid);
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| SenderNonceError::Unavailable)?;
    let current_generation: Option<i64> = transaction
        .query_row(
            &format!(
                "SELECT generation FROM {NONCE_TABLE}
                 WHERE admission_epoch = ?1 AND jwk_thumbprint = ?2"
            ),
            params![admission_epoch, input.family_jwk_thumbprint],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| SenderNonceError::Unavailable)?;
    transaction
        .execute(
            &format!("DELETE FROM {NONCE_TABLE} WHERE expires_at_seconds < ?1"),
            params![now_seconds_i64],
        )
        .map_err(|_| SenderNonceError::Unavailable)?;
    let generation = match current_generation {
        Some(value) if value > 0 && value < i64::MAX => value + 1,
        Some(_) => return Err(SenderNonceError::Unavailable),
        None => {
            let retained: i64 = transaction
                .query_row(&format!("SELECT COUNT(*) FROM {NONCE_TABLE}"), [], |row| {
                    row.get(0)
                })
                .map_err(|_| SenderNonceError::Unavailable)?;
            if retained < 0 || retained as u64 >= capacity {
                return Err(SenderNonceError::Capacity);
            }
            1
        }
    };
    transaction
        .execute(
            &format!(
                "INSERT INTO {NONCE_TABLE}(
                    admission_epoch, jwk_thumbprint, generation, nonce, expires_at_seconds
                 ) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(admission_epoch, jwk_thumbprint) DO UPDATE SET
                    generation = excluded.generation,
                    nonce = excluded.nonce,
                    expires_at_seconds = excluded.expires_at_seconds"
            ),
            params![
                admission_epoch,
                input.family_jwk_thumbprint,
                generation,
                input.nonce,
                expires_at_seconds_i64
            ],
        )
        .map_err(|_| SenderNonceError::Unavailable)?;
    transaction
        .commit()
        .map_err(|_| SenderNonceError::Unavailable)?;
    Ok(SenderNonce {
        nonce: input.nonce.to_owned(),
        generation: generation as u64,
        expires_at_seconds: input.expires_at_seconds,
    })
}

pub(crate) fn read_sender_nonce_on(
    connection: &Connection,
    input: SenderNonceRead<'_>,
) -> Result<Option<SenderNonce>, SenderNonceError> {
    let admission_epoch = checked_i64(input.sender_replay_epoch)?;
    let now_seconds = checked_i64(input.now_seconds)?;
    if admission_epoch <= 0 || !canonical_thumbprint(input.family_jwk_thumbprint) {
        return Err(SenderNonceError::Invalid);
    }
    let row: Option<(i64, String, i64)> = connection
        .query_row(
            &format!(
                "SELECT generation, nonce, expires_at_seconds
                 FROM {NONCE_TABLE}
                 WHERE admission_epoch = ?1
                   AND jwk_thumbprint = ?2
                   AND expires_at_seconds > ?3"
            ),
            params![admission_epoch, input.family_jwk_thumbprint, now_seconds],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| SenderNonceError::Unavailable)?;
    match row {
        None => Ok(None),
        Some((generation, nonce, expires_at_seconds))
            if generation > 0 && canonical_nonce(&nonce) && expires_at_seconds > now_seconds =>
        {
            Ok(Some(SenderNonce {
                nonce,
                generation: generation as u64,
                expires_at_seconds: expires_at_seconds as u64,
            }))
        }
        Some(_) => Err(SenderNonceError::Unavailable),
    }
}

/// Consume the verified proof and retire its nonce in one SQLite transaction.
/// A successful call installs the next nonce generation before returning.
///
/// @ref LLP 0077#nonce-protocol — only the current custody generation may
/// publish a successor nonce; replay-store or nonce-state failure refuses work.
pub(crate) fn consume_sender_proof_and_rotate_nonce_on(
    connection: &mut Connection,
    input: SenderProofNonceRotation<'_>,
) -> Result<SenderNonce, SenderNonceError> {
    let admission_epoch_i64 = checked_i64(input.sender_replay_epoch)?;
    let now_seconds_i64 = checked_i64(input.now_seconds)?;
    let replay_expires_i64 = checked_i64(input.replay_expires_at_seconds)?;
    let next_expires_i64 = checked_i64(input.next_nonce_expires_at_seconds)?;
    let current_generation = checked_i64(input.current.generation)?;
    let replay_capacity = input.replay_capacity.unwrap_or(DEFAULT_REPLAY_CAPACITY);
    if admission_epoch_i64 <= 0
        || !canonical_thumbprint(input.family_jwk_thumbprint)
        || !canonical_nonce(input.current.expose_for_transport())
        || !canonical_nonce(input.next_nonce)
        || current_generation <= 0
        || input.current.expires_at_seconds <= input.now_seconds
        || input.replay_expires_at_seconds
            < input
                .verified
                .issued_at_seconds
                .saturating_add(REPLAY_RETENTION_AFTER_IAT_SECONDS)
        || input.next_nonce_expires_at_seconds <= input.now_seconds
        || replay_capacity == 0
        || replay_capacity > i64::MAX as u64
        || !constant_time_text_eq(&input.verified.jwk_thumbprint, input.family_jwk_thumbprint)
    {
        return Err(SenderNonceError::Invalid);
    }
    let next_generation = current_generation
        .checked_add(1)
        .ok_or(SenderNonceError::Unavailable)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| SenderNonceError::Unavailable)?;
    let durable: Option<(i64, String, i64)> = transaction
        .query_row(
            &format!(
                "SELECT generation, nonce, expires_at_seconds
                 FROM {NONCE_TABLE}
                 WHERE admission_epoch = ?1 AND jwk_thumbprint = ?2"
            ),
            params![admission_epoch_i64, input.family_jwk_thumbprint],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| SenderNonceError::Unavailable)?;
    let Some((generation, durable_nonce, durable_expiry)) = durable else {
        return Err(SenderNonceError::Required);
    };
    if generation != current_generation
        || durable_expiry <= now_seconds_i64
        || !constant_time_text_eq(&durable_nonce, input.current.expose_for_transport())
    {
        let already_consumed: Option<i64> = transaction
            .query_row(
                &format!(
                    "SELECT 1 FROM {REPLAY_TABLE}
                     WHERE admission_epoch = ?1 AND proof_id = ?2"
                ),
                params![admission_epoch_i64, input.verified.proof_id.as_slice()],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| SenderNonceError::Unavailable)?;
        return if already_consumed.is_some() {
            Err(SenderNonceError::Replay)
        } else {
            Err(SenderNonceError::Required)
        };
    }
    transaction
        .execute(
            &format!("DELETE FROM {REPLAY_TABLE} WHERE expires_at_seconds < ?1"),
            params![now_seconds_i64],
        )
        .map_err(|_| SenderNonceError::Unavailable)?;
    let retained: i64 = transaction
        .query_row(&format!("SELECT COUNT(*) FROM {REPLAY_TABLE}"), [], |row| {
            row.get(0)
        })
        .map_err(|_| SenderNonceError::Unavailable)?;
    if retained < 0 || retained as u64 >= replay_capacity {
        return Err(SenderNonceError::Capacity);
    }
    match transaction.execute(
        &format!(
            "INSERT INTO {REPLAY_TABLE}
             (admission_epoch, proof_id, expires_at_seconds)
             VALUES (?1, ?2, ?3)"
        ),
        params![
            admission_epoch_i64,
            input.verified.proof_id.as_slice(),
            replay_expires_i64
        ],
    ) {
        Ok(1) => {}
        Ok(_) => return Err(SenderNonceError::Unavailable),
        Err(error)
            if error
                .sqlite_error_code()
                .is_some_and(|code| code == ErrorCode::ConstraintViolation) =>
        {
            return Err(SenderNonceError::Replay);
        }
        Err(_) => return Err(SenderNonceError::Unavailable),
    }
    let updated = transaction
        .execute(
            &format!(
                "UPDATE {NONCE_TABLE}
                 SET generation = ?1, nonce = ?2, expires_at_seconds = ?3
                 WHERE admission_epoch = ?4
                   AND jwk_thumbprint = ?5
                   AND generation = ?6
                   AND nonce = ?7
                   AND expires_at_seconds > ?8"
            ),
            params![
                next_generation,
                input.next_nonce,
                next_expires_i64,
                admission_epoch_i64,
                input.family_jwk_thumbprint,
                current_generation,
                input.current.expose_for_transport(),
                now_seconds_i64
            ],
        )
        .map_err(|_| SenderNonceError::Unavailable)?;
    if updated != 1 {
        return Err(SenderNonceError::Required);
    }
    transaction
        .commit()
        .map_err(|_| SenderNonceError::Unavailable)?;
    Ok(SenderNonce {
        nonce: input.next_nonce.to_owned(),
        generation: next_generation as u64,
        expires_at_seconds: input.next_nonce_expires_at_seconds,
    })
}

pub(crate) fn consume_sender_proof_id_on(
    connection: &mut Connection,
    input: SenderProofIdConsumption,
) -> Result<(), ReplayConsumeError> {
    if input.sender_replay_epoch == 0
        || input.sender_replay_epoch > i64::MAX as u64
        || input.now_seconds > i64::MAX as u64
        || input.expires_at_seconds <= input.now_seconds
        || input.expires_at_seconds > i64::MAX as u64
    {
        return Err(ReplayConsumeError::Invalid);
    }
    let capacity = input.capacity.unwrap_or(DEFAULT_REPLAY_CAPACITY);
    if capacity == 0 || capacity > i64::MAX as u64 {
        return Err(ReplayConsumeError::Invalid);
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| ReplayConsumeError::Unavailable)?;
    transaction
        .execute(
            &format!("DELETE FROM {REPLAY_TABLE} WHERE expires_at_seconds < ?1"),
            params![input.now_seconds as i64],
        )
        .map_err(|_| ReplayConsumeError::Unavailable)?;
    let retained: i64 = transaction
        .query_row(&format!("SELECT COUNT(*) FROM {REPLAY_TABLE}"), [], |row| {
            row.get(0)
        })
        .map_err(|_| ReplayConsumeError::Unavailable)?;
    if retained < 0 || retained as u64 >= capacity {
        return Err(ReplayConsumeError::Capacity);
    }
    match transaction.execute(
        &format!(
            "INSERT INTO {REPLAY_TABLE}
             (admission_epoch, proof_id, expires_at_seconds)
             VALUES (?1, ?2, ?3)"
        ),
        params![
            input.sender_replay_epoch as i64,
            input.proof_id.as_slice(),
            input.expires_at_seconds as i64
        ],
    ) {
        Ok(1) => transaction
            .commit()
            .map_err(|_| ReplayConsumeError::Unavailable),
        Ok(_) => Err(ReplayConsumeError::Unavailable),
        Err(error)
            if error
                .sqlite_error_code()
                .is_some_and(|code| code == ErrorCode::ConstraintViolation) =>
        {
            Err(ReplayConsumeError::Replay)
        }
        Err(_) => Err(ReplayConsumeError::Unavailable),
    }
}

/// Resolve only the durable key thumbprint needed for proof verification.
/// Whether a superseded token may participate is already composed by policy
/// into the optional grace bound.
pub(crate) fn sender_constraint_for_presented_token_on(
    connection: &Connection,
    input: SenderConstraintLookup<'_>,
) -> Result<Option<SenderConstraintFact>, ReplayConsumeError> {
    if input.token_hash.len() != 32 || input.now_ms > i64::MAX as u64 {
        return Err(ReplayConsumeError::Invalid);
    }
    let current: Option<String> = connection
        .query_row(
            "SELECT binding.jwk_thumbprint
             FROM _auth_sessions AS session
             JOIN _snapback_sender_family_binding AS binding
               ON binding.session_id = session.id
             WHERE session.token_hash = ?1
               AND session.revoked_at_ms IS NULL",
            params![input.token_hash],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| ReplayConsumeError::Unavailable)?;
    if let Some(jwk_thumbprint) = current {
        return Ok(Some(SenderConstraintFact { jwk_thumbprint }));
    }
    let Some(supersession_grace_ms) = input.supersession_grace_ms else {
        return Ok(None);
    };
    let supersession_grace_ms =
        i64::try_from(supersession_grace_ms).map_err(|_| ReplayConsumeError::Invalid)?;
    connection
        .query_row(
            "SELECT binding.jwk_thumbprint
             FROM _auth_session_tokens AS token
             JOIN _auth_sessions AS session
               ON session.id = token.session_id
             JOIN _snapback_sender_family_binding AS binding
               ON binding.session_id = session.id
             WHERE token.token_hash = ?1
               AND session.revoked_at_ms IS NULL
               AND token.superseded_at_ms <= ?2
               AND (?2 - token.superseded_at_ms) <= ?3",
            params![input.token_hash, input.now_ms as i64, supersession_grace_ms],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map(|value| value.map(|jwk_thumbprint| SenderConstraintFact { jwk_thumbprint }))
        .map_err(|_| ReplayConsumeError::Unavailable)
}

/// Whether the presented token's live session carries a durable sender-family
/// binding. Databases that never ran hosted sender preflight report unbound.
///
/// @ref LLP 0225#1-ownership-map — this is a mechanical canonical-store read
///   on the connection the kernel holds; sender-proof policy remains above it.
/// @ref LLP 0077#author-decisions--2026-07-23 — decision 4: the durable binding
///   selects the `sbs2_` spelling for successors of a sender-bound family.
pub(super) fn presented_token_has_sender_family_binding_on(
    connection: &Connection,
    token_hash: &[u8],
) -> Result<bool, ReplayConsumeError> {
    if token_hash.len() != 32 {
        return Err(ReplayConsumeError::Invalid);
    }
    match connection.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM _auth_sessions AS session
           JOIN _snapback_sender_family_binding AS binding
             ON binding.session_id = session.id
           WHERE session.token_hash = ?1
             AND session.revoked_at_ms IS NULL
         )",
        params![token_hash],
        |row| row.get(0),
    ) {
        Ok(exists) => Ok(exists),
        Err(rusqlite::Error::SqliteFailure(_, Some(message)))
            if message.contains("no such table") =>
        {
            Ok(false)
        }
        Err(_) => Err(ReplayConsumeError::Unavailable),
    }
}

/// Read the bounded revoked-family row and its exact persisted terminal-cause
/// witness. The caller decides whether those facts authorize a terminal
/// outcome or stay behind the ordinary cover challenge.
///
/// @ref LLP 0077#issuance-refresh-and-recovery — the logout-lost-response
/// tombstone is a bounded refusal-path lookup and never rotates a nonce.
pub(crate) fn tombstoned_sender_family_on(
    connection: &Connection,
    input: SenderFamilyTombstoneLookup<'_>,
) -> Result<Option<SenderFamilyTombstoneFact>, ReplayConsumeError> {
    if input.token_hash.len() != 32
        || input.now_ms > i64::MAX as u64
        || input.retention_ms > i64::MAX as u64
    {
        return Err(ReplayConsumeError::Invalid);
    }
    let row: Option<(String, String, i64, i64)> = connection
        .query_row(
            "SELECT binding.jwk_thumbprint, session.id, session.generation,
                    session.revoked_at_ms
             FROM _auth_sessions AS session
             JOIN _snapback_sender_family_binding AS binding
               ON binding.session_id = session.id
             WHERE session.token_hash = ?1
               AND session.revoked_at_ms IS NOT NULL
               AND (?2 - session.revoked_at_ms) <= ?3",
            params![
                input.token_hash,
                input.now_ms as i64,
                input.retention_ms as i64,
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|_| ReplayConsumeError::Unavailable)?;
    let Some((jwk_thumbprint, session_id, generation, revoked_at_ms)) = row else {
        return Ok(None);
    };
    let (Ok(generation), Ok(revoked_at_ms)) =
        (u64::try_from(generation), u64::try_from(revoked_at_ms))
    else {
        return Err(ReplayConsumeError::Invalid);
    };
    let terminal_reason = super::auth::read_session_terminal_cause_on(
        connection,
        &session_id,
        generation,
        revoked_at_ms,
    )
    .map_err(|_| ReplayConsumeError::Unavailable)?;
    Ok(Some(SenderFamilyTombstoneFact {
        jwk_thumbprint,
        terminal_reason,
    }))
}
