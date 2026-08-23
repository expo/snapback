//! Route-free, test-support-only SQLite operation used to prove the bounded
//! commit capsule before any production mutation adopts it.
//!
//! @ref LLP 0225#3-transaction-and-commit-boundaries--who-may-commit-what —
//!   even the prototype exposes a typed pending operation; SQLite ownership
//!   stays in the storage kernel.

use super::{
    CommitCapsuleAuthority, CommitCapsuleIntent, DatabaseBinding, ExactCommitRows, LocalDatabase,
    observe_durable_commit_for_test,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use rusqlite::{Connection, OptionalExtension as _, Transaction, TransactionBehavior, params};
use std::fmt;
use std::path::Path;

const OPERATION_TABLE: &str = "_test_bounded_commit_capsule_operations";
const PROOF_TABLE: &str = "_test_bounded_commit_capsule_proofs";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrototypeOperationIdentity(String);

impl PrototypeOperationIdentity {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

impl AsRef<str> for PrototypeOperationIdentity {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl std::ops::Deref for PrototypeOperationIdentity {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        self.as_ref()
    }
}

impl fmt::Display for PrototypeOperationIdentity {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrototypeIntent {
    pub operation_id: PrototypeOperationIdentity,
    pub payload: String,
    pub proof_id: String,
    pub response: String,
}

impl CommitCapsuleIntent for PrototypeIntent {
    type OperationIdentity = PrototypeOperationIdentity;

    fn operation_identity(&self) -> &Self::OperationIdentity {
        &self.operation_id
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrototypeValue {
    pub operation_id: String,
    pub response: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PrototypeFacts {
    pub operation_rows: u64,
    pub proof_rows: u64,
    pub exact_intended_rows: bool,
}

pub enum PrototypeStage<'connection> {
    Existing(ExactCommitRows<PrototypeIntent, PrototypeValue>),
    Pending(PrototypePending<'connection>),
}

pub struct PrototypePending<'connection> {
    tx: Transaction<'connection>,
    binding: DatabaseBinding,
    value: PrototypeValue,
}

pub fn initialize(db: &mut LocalDatabase) -> SnapbackResult<()> {
    db.conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS {OPERATION_TABLE} (\
             operation_id TEXT PRIMARY KEY NOT NULL,\
             payload TEXT NOT NULL,\
             response TEXT NOT NULL\
         );\
         CREATE TABLE IF NOT EXISTS {PROOF_TABLE} (\
             proof_id TEXT PRIMARY KEY NOT NULL,\
             operation_id TEXT NOT NULL,\
             expected_payload TEXT NOT NULL,\
             consumed INTEGER NOT NULL CHECK (consumed IN (0, 1))\
         );"
    ))?;
    Ok(())
}

pub fn stage<'connection>(
    db: &'connection mut LocalDatabase,
    intent: &PrototypeIntent,
    include_consumed_proof: bool,
) -> SnapbackResult<PrototypeStage<'connection>> {
    let binding = db.binding();
    let tx = db
        .conn
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let existing_operation = tx
        .query_row(
            &format!("SELECT payload, response FROM {OPERATION_TABLE} WHERE operation_id = ?1"),
            params![intent.operation_id.as_ref()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let existing_proof = tx
        .query_row(
            &format!(
                "SELECT operation_id, expected_payload, consumed FROM {PROOF_TABLE} WHERE proof_id = ?1"
            ),
            params![intent.proof_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;

    if let Some((payload, response)) = existing_operation {
        let exact = payload == intent.payload
            && response == intent.response
            && existing_proof
                .as_ref()
                .is_some_and(|(operation_id, expected_payload, consumed)| {
                    operation_id == intent.operation_id.as_ref()
                        && expected_payload == &intent.payload
                        && *consumed == 1
                });
        tx.rollback()?;
        if exact {
            return Ok(PrototypeStage::Existing(ExactCommitRows::new(
                binding,
                intent.operation_id.clone(),
                PrototypeValue {
                    operation_id: intent.operation_id.as_ref().to_owned(),
                    response,
                },
            )));
        }
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_IDEMPOTENCY_CONFLICT",
            "storage",
            "the bounded commit prototype operation identity names different or partial rows",
        ));
    }
    if existing_proof.is_some() {
        tx.rollback()?;
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_IDEMPOTENCY_CONFLICT",
            "storage",
            "the bounded commit prototype proof identity is already consumed elsewhere",
        ));
    }

    tx.execute(
        &format!(
            "INSERT INTO {OPERATION_TABLE} (operation_id, payload, response) VALUES (?1, ?2, ?3)"
        ),
        params![
            intent.operation_id.as_ref(),
            intent.payload,
            intent.response
        ],
    )?;
    if include_consumed_proof {
        tx.execute(
            &format!(
                "INSERT INTO {PROOF_TABLE} (proof_id, operation_id, expected_payload, consumed) \
                 VALUES (?1, ?2, ?3, 1)"
            ),
            params![
                intent.proof_id,
                intent.operation_id.as_ref(),
                intent.payload
            ],
        )?;
    }
    Ok(PrototypeStage::Pending(PrototypePending {
        tx,
        binding,
        value: PrototypeValue {
            operation_id: intent.operation_id.as_ref().to_owned(),
            response: intent.response.clone(),
        },
    }))
}

impl PrototypePending<'_> {
    pub fn rollback(self) -> SnapbackResult<()> {
        self.tx.rollback()?;
        Ok(())
    }

    pub fn commit(self, authority: &CommitCapsuleAuthority) -> SnapbackResult<PrototypeValue> {
        if !authority.matches(&self.binding) {
            self.tx.rollback()?;
            return Err(SnapbackError::error(
                "SNAPBACK_COMMIT_CAPSULE_DESTINATION_MISMATCH",
                "storage",
                "the commit capsule authority does not govern this database",
            ));
        }
        observe_durable_commit_for_test();
        self.tx.commit()?;
        Ok(self.value)
    }

    /// Model a storage COMMIT error whose durable predecessor is still exact.
    /// The observer still records a COMMIT attempt, while explicit rollback
    /// makes the absent-row reconciliation deterministic.
    pub fn commit_error_without_rows(
        self,
        authority: &CommitCapsuleAuthority,
        error: SnapbackError,
    ) -> SnapbackResult<PrototypeValue> {
        if !authority.matches(&self.binding) {
            self.tx.rollback()?;
            return Err(SnapbackError::error(
                "SNAPBACK_COMMIT_CAPSULE_DESTINATION_MISMATCH",
                "storage",
                "the commit capsule authority does not govern this database",
            ));
        }
        observe_durable_commit_for_test();
        self.tx.rollback()?;
        Err(error)
    }

    /// Record that the final cut invoked COMMIT, then let the caller panic
    /// before SQLite can return. Dropping the transaction rolls back here,
    /// but the capsule must still retain ambiguity because real storage may
    /// not provide that proof on an unwind.
    pub fn observe_commit_attempt_before_panic(&self) {
        observe_durable_commit_for_test();
    }
}

pub fn exact_reconciliation(
    db: &mut LocalDatabase,
    intent: &PrototypeIntent,
) -> SnapbackResult<Option<ExactCommitRows<PrototypeIntent, PrototypeValue>>> {
    let tx = db
        .conn
        .transaction_with_behavior(TransactionBehavior::Deferred)?;
    let operation = tx
        .query_row(
            &format!("SELECT payload, response FROM {OPERATION_TABLE} WHERE operation_id = ?1"),
            params![intent.operation_id.as_ref()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let proof = tx
        .query_row(
            &format!(
                "SELECT operation_id, expected_payload, consumed FROM {PROOF_TABLE} WHERE proof_id = ?1"
            ),
            params![intent.proof_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;
    tx.rollback()?;

    let Some((payload, response)) = operation else {
        return Ok(None);
    };
    let exact = payload == intent.payload
        && response == intent.response
        && proof.is_some_and(|(operation_id, expected_payload, consumed)| {
            operation_id == intent.operation_id.as_ref()
                && expected_payload == intent.payload
                && consumed == 1
        });
    Ok(exact.then(|| {
        ExactCommitRows::new(
            db.binding(),
            intent.operation_id.clone(),
            PrototypeValue {
                operation_id: intent.operation_id.as_ref().to_owned(),
                response,
            },
        )
    }))
}

pub fn facts(db: &mut LocalDatabase, intent: &PrototypeIntent) -> SnapbackResult<PrototypeFacts> {
    let operation_rows = db.conn.query_row(
        &format!("SELECT COUNT(*) FROM {OPERATION_TABLE}"),
        [],
        |row| row.get(0),
    )?;
    let proof_rows =
        db.conn
            .query_row(&format!("SELECT COUNT(*) FROM {PROOF_TABLE}"), [], |row| {
                row.get(0)
            })?;
    let exact_intended_rows = exact_reconciliation(db, intent)?.is_some();
    Ok(PrototypeFacts {
        operation_rows,
        proof_rows,
        exact_intended_rows,
    })
}

/// Observe the file through a separate SQLite connection. This is the
/// prototype's visibility/reopen oracle; staged rows in the writer's open
/// transaction must remain absent here.
pub fn facts_from_path(path: &Path, intent: &PrototypeIntent) -> SnapbackResult<PrototypeFacts> {
    let conn = Connection::open(path)?;
    let operation_rows = conn.query_row(
        &format!("SELECT COUNT(*) FROM {OPERATION_TABLE}"),
        [],
        |row| row.get(0),
    )?;
    let proof_rows = conn.query_row(&format!("SELECT COUNT(*) FROM {PROOF_TABLE}"), [], |row| {
        row.get(0)
    })?;
    let operation = conn
        .query_row(
            &format!("SELECT payload, response FROM {OPERATION_TABLE} WHERE operation_id = ?1"),
            params![intent.operation_id.as_ref()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let proof = conn
        .query_row(
            &format!(
                "SELECT operation_id, expected_payload, consumed FROM {PROOF_TABLE} WHERE proof_id = ?1"
            ),
            params![intent.proof_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;
    let exact_intended_rows = operation.is_some_and(|(payload, response)| {
        payload == intent.payload
            && response == intent.response
            && proof.is_some_and(|(operation_id, expected_payload, consumed)| {
                operation_id == intent.operation_id.as_ref()
                    && expected_payload == intent.payload
                    && consumed == 1
            })
    });
    Ok(PrototypeFacts {
        operation_rows,
        proof_rows,
        exact_intended_rows,
    })
}
