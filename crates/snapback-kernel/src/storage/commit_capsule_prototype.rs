//! Route-free, test-support-only SQLite operation used to prove the bounded
//! commit capsule before any production mutation adopts it.
//!
//! @ref LLP 0225#3-transaction-and-commit-boundaries--who-may-commit-what —
//!   even the prototype exposes a typed pending operation; SQLite ownership
//!   stays in the storage kernel.

use super::{
    BoundCommitCapsuleIntent, CommitCapsuleAuthority, CommitCapsuleIntent,
    CommitCapsuleIntentProducer, DatabaseBinding, ExactCommitRows, LocalDatabase,
    commit_capsule_intent_fingerprint, observe_durable_commit_for_test,
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

    fn intended_rows_fingerprint(&self) -> [u8; 32] {
        commit_capsule_intent_fingerprint(
            "prototype.v1",
            &[
                self.operation_id.as_ref().as_bytes(),
                self.payload.as_bytes(),
                self.proof_id.as_bytes(),
                self.response.as_bytes(),
            ],
        )
    }
}

impl super::commit_capsule_intent_sealed::Sealed for PrototypeIntent {}

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
    intended: PrototypeIntendedRows,
    value: PrototypeValue,
}

#[derive(Clone, Debug)]
pub struct PrototypeIntendedRows {
    intent: BoundCommitCapsuleIntent<PrototypeIntent>,
    subject: PrototypeIntent,
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
    intent_producer: CommitCapsuleIntentProducer<PrototypeIntent>,
    intent: &PrototypeIntent,
    include_consumed_proof: bool,
) -> SnapbackResult<PrototypeStage<'connection>> {
    let binding = db.binding();
    let bound_intent = intent_producer.bind(intent);
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
                binding.clone(),
                bound_intent,
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
        intended: PrototypeIntendedRows {
            intent: bound_intent,
            subject: intent.clone(),
        },
        value: PrototypeValue {
            operation_id: intent.operation_id.as_ref().to_owned(),
            response: intent.response.clone(),
        },
    }))
}

impl PrototypePending<'_> {
    pub fn intended_rows(&self) -> &PrototypeIntendedRows {
        &self.intended
    }

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

fn exact_reconciled_value(
    db: &mut LocalDatabase,
    intent: &PrototypeIntent,
) -> SnapbackResult<Option<PrototypeValue>> {
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
    Ok(exact.then(|| PrototypeValue {
        operation_id: intent.operation_id.as_ref().to_owned(),
        response,
    }))
}

/// Reconcile the subject retained by staging. A separate raw intent here would
/// let a dependent query rows B and attach correlation carrier A to the value.
///
/// @ref LLP 0303#the-governing-principle — the exact-row producer derives its
/// query subject from the authority-bound intended-row carrier.
pub fn exact_reconciliation(
    db: &mut LocalDatabase,
    intended: &PrototypeIntendedRows,
) -> SnapbackResult<Option<ExactCommitRows<PrototypeIntent, PrototypeValue>>> {
    Ok(exact_reconciled_value(db, &intended.subject)?
        .map(|value| ExactCommitRows::new(db.binding(), intended.intent.clone(), value)))
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
    let exact_intended_rows = exact_reconciled_value(db, intent)?.is_some();
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

#[cfg(test)]
mod tests {
    use super::*;

    fn intent(
        operation_id: &str,
        payload: &str,
        proof_id: &str,
        response: &str,
    ) -> PrototypeIntent {
        PrototypeIntent {
            operation_id: PrototypeOperationIdentity::new(operation_id),
            payload: payload.to_owned(),
            proof_id: proof_id.to_owned(),
            response: response.to_owned(),
        }
    }

    fn commit(db: &mut LocalDatabase, intent: &PrototypeIntent) -> PrototypeIntendedRows {
        let authority = CommitCapsuleAuthority {
            binding: db.binding(),
        };
        let (intent_producer, _intent_instance) = authority.derive_intent_instance();
        match stage(db, intent_producer, intent, true).expect("stage prototype intent") {
            PrototypeStage::Pending(pending) => {
                let intended = pending.intended_rows().clone();
                pending.commit(&authority).expect("commit prototype intent");
                intended
            }
            PrototypeStage::Existing(_) => panic!("fresh prototype intent unexpectedly existed"),
        }
    }

    #[test]
    fn exact_rows_reject_same_operation_id_with_different_intended_rows() {
        let mut db = LocalDatabase::memory().expect("prototype database");
        initialize(&mut db).expect("initialize prototype tables");
        let decoy = intent(
            "shared-operation",
            "decoy-payload",
            "proof-decoy",
            "same-response",
        );
        let target = intent(
            "shared-operation",
            "target-payload",
            "proof-target",
            "same-response",
        );
        let decoy_intended = commit(&mut db, &decoy);

        let witness = exact_reconciliation(&mut db, &decoy_intended)
            .expect("query decoy exact rows")
            .expect("decoy exact rows exist");
        let authority = CommitCapsuleAuthority {
            binding: db.binding(),
        };
        let (_target_producer, target_instance) =
            authority.derive_intent_instance::<PrototypeIntent>();
        let error = witness
            .into_value_for(&authority, &target_instance)
            .expect_err("another authority-derived intent must not retarget an exact-row witness");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_COMMIT_RECONCILIATION_WITNESS_MISMATCH"
        );

        let decoy_facts = facts(&mut db, &decoy).expect("read decoy durable facts");
        let target_facts = facts(&mut db, &target).expect("read target durable facts");
        assert_eq!(decoy_facts.operation_rows, 1);
        assert_eq!(decoy_facts.proof_rows, 1);
        assert!(decoy_facts.exact_intended_rows);
        assert!(!target_facts.exact_intended_rows);
    }

    #[test]
    fn exact_rows_accept_legitimate_retry_after_database_reopen() {
        let directory = tempfile::tempdir().expect("prototype directory");
        let path = directory.path().join("prototype.sqlite3");
        let retry = intent("retry-operation", "payload", "proof-retry", "response");
        {
            let mut db = LocalDatabase::open(&path).expect("open first prototype database");
            initialize(&mut db).expect("initialize prototype tables");
            commit(&mut db, &retry);
        }

        let mut reopened = LocalDatabase::open(&path).expect("reopen prototype database");
        let authority = CommitCapsuleAuthority {
            binding: reopened.binding(),
        };
        let (retry_producer, retry_instance) = authority.derive_intent_instance();
        let witness = match stage(&mut reopened, retry_producer, &retry, true)
            .expect("query retry exact rows after reopen")
        {
            PrototypeStage::Existing(witness) => witness,
            PrototypeStage::Pending(_) => panic!("retry exact rows must survive reopen"),
        };
        let value = witness
            .into_value_for(&authority, &retry_instance)
            .expect("same semantic retry remains valid after reopen");
        assert_eq!(value.operation_id, "retry-operation");
        assert_eq!(value.response, "response");
    }

    #[test]
    fn exact_rows_reject_another_database_producer() {
        let mut source = LocalDatabase::memory().expect("source prototype database");
        initialize(&mut source).expect("initialize source prototype tables");
        let exact = intent(
            "producer-operation",
            "payload",
            "proof-producer",
            "response",
        );
        commit(&mut source, &exact);
        let source_authority = CommitCapsuleAuthority {
            binding: source.binding(),
        };
        let (source_producer, _source_instance) = source_authority.derive_intent_instance();
        let witness = match stage(&mut source, source_producer, &exact, true)
            .expect("query source exact rows")
        {
            PrototypeStage::Existing(witness) => witness,
            PrototypeStage::Pending(_) => panic!("source exact rows must already exist"),
        };

        let destination = LocalDatabase::memory().expect("destination prototype database");
        let authority = CommitCapsuleAuthority {
            binding: destination.binding(),
        };
        let (_destination_producer, destination_instance) =
            authority.derive_intent_instance::<PrototypeIntent>();
        let error = witness
            .into_value_for(&authority, &destination_instance)
            .expect_err("another database producer must not consume the witness");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_COMMIT_RECONCILIATION_WITNESS_MISMATCH"
        );
    }
}
