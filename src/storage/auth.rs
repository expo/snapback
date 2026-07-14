//! Protected SQLite auth catalog and the direct storage lane beneath app data.
//!
//! @ref LLP 0054#reserved-namespace-and-catalog-recognition — catalog state is
//! inspected without mutation and recognized exactly before auth effects run.
//! @ref LLP 0054#catalog-write-and-lifecycle-rules — auth writes never use app
//! mutation, journal, version, receipt, or live-delivery machinery.

use super::{LocalDatabase, is_auth_reserved_identifier};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use rusqlite::{
    Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior, params,
};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;
use uuid::Uuid;

pub(crate) const AUTH_CATALOG_VERSION: &str = "1";
pub(crate) const AUTH_GC_BATCH: usize = 512;
const META_AUTH_CATALOG_VERSION: &str = "auth_catalog_version";
pub(super) const META_AUTH_RESTORE_DECLARATION_ID: &str = "auth_restore_declaration_id";
#[cfg(test)]
const AUTH_ACTIVATION_STEPS: usize = AUTH_TABLES.len() + AUTH_INDEXES.len() + 1;

#[cfg(test)]
thread_local! {
    static FAIL_AUTH_ACTIVATION_AFTER_STEP: std::cell::Cell<Option<usize>> =
        const { std::cell::Cell::new(None) };
    static FAIL_AUTH_RESTORE_AFTER_STEP: std::cell::Cell<Option<usize>> =
        const { std::cell::Cell::new(None) };
}

#[cfg(test)]
fn inject_auth_activation_failure_after_step(step: usize) {
    FAIL_AUTH_ACTIVATION_AFTER_STEP.with(|slot| {
        assert!(
            slot.get().is_none(),
            "auth activation hook must be one-shot"
        );
        slot.set(Some(step));
    });
}

fn activation_step_completed(step: usize) -> SnapbackResult<()> {
    #[cfg(not(test))]
    let _ = step;
    #[cfg(test)]
    FAIL_AUTH_ACTIVATION_AFTER_STEP.with(|slot| {
        if slot.get() == Some(step) {
            slot.set(None);
            return Err(SnapbackError::error(
                "TEST_AUTH_ACTIVATION_FAILURE",
                "auth",
                "injected auth-catalog activation failure",
            ));
        }
        Ok(())
    })?;
    Ok(())
}

#[cfg(test)]
fn inject_auth_restore_failure_after_step(step: usize) {
    FAIL_AUTH_RESTORE_AFTER_STEP.with(|slot| {
        assert!(slot.get().is_none(), "auth restore hook must be one-shot");
        slot.set(Some(step));
    });
}

fn restore_transaction_step_completed(step: usize) -> SnapbackResult<()> {
    #[cfg(not(test))]
    let _ = step;
    #[cfg(test)]
    FAIL_AUTH_RESTORE_AFTER_STEP.with(|slot| {
        if slot.get() == Some(step) {
            slot.set(None);
            return Err(SnapbackError::error(
                "TEST_AUTH_RESTORE_TRANSACTION_FAILURE",
                "auth-restore",
                "injected declared-restore transaction failure",
            ));
        }
        Ok(())
    })?;
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AuthCatalogState {
    Uninitialized,
    ReadyV1,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct AuthGcResult {
    pub challenges_deleted: usize,
    pub sessions_deleted: usize,
    pub immediate_retry: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AuthRestoreResult {
    Applied {
        sessions_revoked: usize,
        challenges_deleted: usize,
    },
    AlreadyApplied,
}

/// Commit certainty for an item-5 two-phase auth mutation. Body/begin errors
/// are known rollbacks and may exact-unmark their projection ticket. A commit
/// error is conservatively ambiguous and must reconcile or fail closed.
pub(crate) enum AuthTransactionAttempt<T> {
    Committed(T),
    RolledBack(SnapbackError),
    CommitUncertain(SnapbackError),
}

struct ExpectedTable {
    name: &'static str,
    sql: &'static str,
}

struct ExpectedIndex {
    name: &'static str,
    table: &'static str,
    sql: &'static str,
}

const AUTH_TABLES: &[ExpectedTable] = &[
    ExpectedTable {
        name: "_auth_users",
        sql: r#"
CREATE TABLE "_auth_users" (
  id TEXT NOT NULL PRIMARY KEY,
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991)
)
"#,
    },
    ExpectedTable {
        name: "_auth_identities",
        sql: r#"
CREATE TABLE "_auth_identities" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(length(provider) > 0),
  subject TEXT NOT NULL CHECK(length(subject) > 0),
  verified_at_ms INTEGER NOT NULL
    CHECK(verified_at_ms BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY(user_id) REFERENCES "_auth_users"(id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_sessions",
        sql: r#"
CREATE TABLE "_auth_sessions" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  authority_instance_id TEXT NOT NULL,
  token_hash BLOB NOT NULL CHECK(length(token_hash) = 32),
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  last_used_at_ms INTEGER NOT NULL
    CHECK(last_used_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL
    CHECK(expires_at_ms BETWEEN 0 AND 9007199254740991),
  absolute_expires_at_ms INTEGER NOT NULL
    CHECK(absolute_expires_at_ms BETWEEN 0 AND 9007199254740991),
  revoked_at_ms INTEGER
    CHECK(revoked_at_ms IS NULL OR revoked_at_ms BETWEEN 0 AND 9007199254740991),
  CHECK(created_at_ms <= last_used_at_ms),
  CHECK(last_used_at_ms <= expires_at_ms),
  CHECK(expires_at_ms <= absolute_expires_at_ms),
  CHECK(revoked_at_ms IS NULL OR created_at_ms <= revoked_at_ms),
  FOREIGN KEY(user_id) REFERENCES "_auth_users"(id) ON DELETE CASCADE,
  FOREIGN KEY(identity_id, user_id)
    REFERENCES "_auth_identities"(id, user_id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_session_tokens",
        sql: r#"
CREATE TABLE "_auth_session_tokens" (
  token_hash BLOB NOT NULL PRIMARY KEY CHECK(length(token_hash) = 32),
  session_id TEXT NOT NULL,
  superseded_at_ms INTEGER NOT NULL
    CHECK(superseded_at_ms BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY(session_id) REFERENCES "_auth_sessions"(id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_verification_codes",
        sql: r#"
CREATE TABLE "_auth_verification_codes" (
  challenge_id TEXT NOT NULL PRIMARY KEY,
  canonical_address TEXT NOT NULL CHECK(length(canonical_address) > 0),
  code_digest BLOB NOT NULL CHECK(length(code_digest) = 32),
  key_id TEXT NOT NULL CHECK(length(key_id) > 0),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  requested_at_ms INTEGER NOT NULL
    CHECK(requested_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL
    CHECK(expires_at_ms BETWEEN 0 AND 9007199254740991),
  consumed_at_ms INTEGER
    CHECK(consumed_at_ms IS NULL OR consumed_at_ms BETWEEN 0 AND 9007199254740991),
  superseded_by TEXT,
  CHECK(attempts >= 0 AND attempts <= max_attempts),
  CHECK(max_attempts = 5),
  CHECK(requested_at_ms <= expires_at_ms),
  CHECK(consumed_at_ms IS NULL OR consumed_at_ms >= requested_at_ms),
  CHECK(consumed_at_ms IS NULL OR superseded_by IS NULL)
)
"#,
    },
];

const AUTH_INDEXES: &[ExpectedIndex] = &[
    ExpectedIndex {
        name: "_auth_identities_provider_subject_uq",
        table: "_auth_identities",
        sql: r#"CREATE UNIQUE INDEX "_auth_identities_provider_subject_uq"
  ON "_auth_identities"(provider, subject)"#,
    },
    ExpectedIndex {
        name: "_auth_identities_id_user_uq",
        table: "_auth_identities",
        sql: r#"CREATE UNIQUE INDEX "_auth_identities_id_user_uq"
  ON "_auth_identities"(id, user_id)"#,
    },
    ExpectedIndex {
        name: "_auth_identities_user",
        table: "_auth_identities",
        sql: r#"CREATE INDEX "_auth_identities_user"
  ON "_auth_identities"(user_id, id)"#,
    },
    ExpectedIndex {
        name: "_auth_sessions_token_uq",
        table: "_auth_sessions",
        sql: r#"CREATE UNIQUE INDEX "_auth_sessions_token_uq"
  ON "_auth_sessions"(token_hash)"#,
    },
    ExpectedIndex {
        name: "_auth_sessions_authority_instance_uq",
        table: "_auth_sessions",
        sql: r#"CREATE UNIQUE INDEX "_auth_sessions_authority_instance_uq"
  ON "_auth_sessions"(authority_instance_id)"#,
    },
    ExpectedIndex {
        name: "_auth_sessions_user_live",
        table: "_auth_sessions",
        sql: r#"CREATE INDEX "_auth_sessions_user_live"
  ON "_auth_sessions"(user_id, created_at_ms, id)
  WHERE revoked_at_ms IS NULL"#,
    },
    ExpectedIndex {
        name: "_auth_sessions_absolute_expiry",
        table: "_auth_sessions",
        sql: r#"CREATE INDEX "_auth_sessions_absolute_expiry"
  ON "_auth_sessions"(absolute_expires_at_ms, id)"#,
    },
    ExpectedIndex {
        name: "_auth_session_tokens_session",
        table: "_auth_session_tokens",
        sql: r#"CREATE INDEX "_auth_session_tokens_session"
  ON "_auth_session_tokens"(session_id, superseded_at_ms, token_hash)"#,
    },
    ExpectedIndex {
        name: "_auth_verification_codes_one_active",
        table: "_auth_verification_codes",
        sql: r#"CREATE UNIQUE INDEX "_auth_verification_codes_one_active"
  ON "_auth_verification_codes"(canonical_address)
  WHERE consumed_at_ms IS NULL AND superseded_by IS NULL"#,
    },
    ExpectedIndex {
        name: "_auth_verification_codes_address_requested",
        table: "_auth_verification_codes",
        sql: r#"CREATE INDEX "_auth_verification_codes_address_requested"
  ON "_auth_verification_codes"(canonical_address, requested_at_ms)"#,
    },
    ExpectedIndex {
        name: "_auth_verification_codes_requested",
        table: "_auth_verification_codes",
        sql: r#"CREATE INDEX "_auth_verification_codes_requested"
  ON "_auth_verification_codes"(requested_at_ms, challenge_id)"#,
    },
    ExpectedIndex {
        name: "_auth_verification_codes_expiry",
        table: "_auth_verification_codes",
        sql: r#"CREATE INDEX "_auth_verification_codes_expiry"
  ON "_auth_verification_codes"(expires_at_ms, challenge_id)"#,
    },
];

#[derive(Debug)]
struct SchemaObject {
    kind: String,
    name: String,
    table: String,
    sql: Option<String>,
}

#[derive(Debug, Eq, PartialEq)]
struct CatalogShape {
    tables: BTreeMap<String, TableShape>,
    indexes: BTreeMap<String, IndexShape>,
}

#[derive(Debug, Eq, PartialEq)]
struct TableShape {
    normalized_sql: String,
    columns: Vec<ColumnShape>,
    foreign_keys: Vec<ForeignKeyShape>,
}

#[derive(Debug, Eq, PartialEq)]
struct ColumnShape {
    position: i64,
    name: String,
    declared_type: String,
    not_null: bool,
    default_sql: Option<String>,
    primary_key_position: i64,
    hidden: i64,
}

#[derive(Debug, Eq, PartialEq)]
struct ForeignKeyShape {
    id: i64,
    sequence: i64,
    target_table: String,
    from_column: String,
    to_column: Option<String>,
    on_update: String,
    on_delete: String,
    match_name: String,
}

#[derive(Debug, Eq, PartialEq)]
struct IndexShape {
    normalized_sql: String,
    table: String,
    unique: bool,
    origin: String,
    partial: bool,
    columns: Vec<IndexColumnShape>,
}

#[derive(Debug, Eq, PartialEq)]
struct IndexColumnShape {
    sequence: i64,
    column_id: i64,
    name: Option<String>,
    descending: bool,
    collation: Option<String>,
    key_column: bool,
}

impl LocalDatabase {
    /// Inspect the protected catalog without creating metadata, opening a
    /// transaction, or otherwise writing a WAL frame.
    pub(crate) fn inspect_auth_catalog(&self) -> SnapbackResult<AuthCatalogState> {
        inspect_auth_catalog_on(&self.conn)
    }

    pub(crate) fn auth_catalog_ready(&self) -> SnapbackResult<bool> {
        Ok(self.inspect_auth_catalog()? == AuthCatalogState::ReadyV1)
    }

    /// Install catalog v1 after the caller has established a usable keyring.
    /// Keeping keyring creation outside this method makes the required
    /// keyring-before-DDL ordering explicit at the integration seam.
    pub(crate) fn activate_auth_catalog_v1(&mut self) -> SnapbackResult<()> {
        match self.inspect_auth_catalog()? {
            AuthCatalogState::ReadyV1 => return Ok(()),
            AuthCatalogState::Uninitialized => {}
        }

        let authorization_interlock = self.authorization_interlock.clone();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        activate_auth_catalog_v1_in(&tx)?;
        let authorization = super::authorization::authorization_commit_hook_in(
            &tx,
            super::authorization::AuthorizationCommitCause::Activation,
        )?;
        let min_commit_version = super::current_version_on(&tx)?;
        super::commit_with_authorization_interlock(
            tx,
            &authorization,
            min_commit_version,
            authorization_interlock,
        )?;
        require_ready_on(&self.conn)
    }

    /// Run a read through the protected lane. No raw connection accessor is
    /// exposed; callers must cross an exact-ReadyV1 check for every operation.
    pub(crate) fn with_auth_read<T>(
        &self,
        operation: impl FnOnce(&Connection) -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        require_ready_on(&self.conn)?;
        operation(&self.conn)
    }

    /// Run one direct auth mutation as an IMMEDIATE transaction. `Ok(T)` is a
    /// committed outcome (including provider-level negative outcome enums);
    /// `Err` drops and rolls the transaction back.
    pub(crate) fn with_auth_transaction<T>(
        &mut self,
        operation: impl FnOnce(&Transaction<'_>) -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_ready_on(&tx)?;
        let output = operation(&tx)?;
        tx.commit()?;
        Ok(output)
    }

    /// Run one direct auth transaction while preserving commit certainty for
    /// the coordinator. No projection/topology value enters this method; the
    /// caller has already installed a ticket and released every fence lock.
    ///
    /// @ref LLP 0056#rollback-and-ambiguous-commit — only a proven rollback
    /// exact-unmarks; a commit error is reconciled or left unavailable.
    pub(crate) fn attempt_auth_transaction<T>(
        &mut self,
        operation: impl FnOnce(&Transaction<'_>) -> SnapbackResult<T>,
    ) -> AuthTransactionAttempt<T> {
        let tx = match self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
        {
            Ok(tx) => tx,
            Err(error) => return AuthTransactionAttempt::RolledBack(error.into()),
        };
        if let Err(error) = require_ready_on(&tx) {
            return rollback_auth_transaction(tx, error);
        }
        let output = match operation(&tx) {
            Ok(output) => output,
            Err(error) => return rollback_auth_transaction(tx, error),
        };
        match tx.commit() {
            Ok(()) => AuthTransactionAttempt::Committed(output),
            Err(error) => AuthTransactionAttempt::CommitUncertain(error.into()),
        }
    }

    /// Delete expired durable auth state in bounded direct-path batches.
    pub(crate) fn auth_gc(&mut self, now_ms: u64) -> SnapbackResult<AuthGcResult> {
        if now_ms > 9_007_199_254_740_991 {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_CATALOG_CORRUPT",
                "auth",
                "auth garbage-collection time is outside the portable timestamp range",
            ));
        }
        self.with_auth_transaction(|tx| {
            let orphan_tombstones: i64 = tx.query_row(
                "SELECT COUNT(*)
                 FROM _auth_session_tokens AS token
                 LEFT JOIN _auth_sessions AS session ON session.id = token.session_id
                 WHERE session.id IS NULL",
                [],
                |row| row.get(0),
            )?;
            if orphan_tombstones != 0 {
                return Err(corrupt(
                    "auth catalog contains an orphan session-token tombstone",
                ));
            }

            let challenges_deleted = tx.execute(
                "DELETE FROM _auth_verification_codes
                 WHERE challenge_id IN (
                   SELECT challenge_id FROM _auth_verification_codes
                   WHERE expires_at_ms <= ?1
                   ORDER BY expires_at_ms, challenge_id
                   LIMIT ?2
                 )",
                params![now_ms as i64, AUTH_GC_BATCH as i64],
            )?;
            let sessions_deleted = tx.execute(
                "DELETE FROM _auth_sessions
                 WHERE id IN (
                   SELECT id FROM _auth_sessions
                   WHERE absolute_expires_at_ms <= ?1
                   ORDER BY absolute_expires_at_ms, id
                   LIMIT ?2
                 )",
                params![now_ms as i64, AUTH_GC_BATCH as i64],
            )?;
            Ok(AuthGcResult {
                challenges_deleted,
                sessions_deleted,
                immediate_retry: challenges_deleted == AUTH_GC_BATCH
                    || sessions_deleted == AUTH_GC_BATCH,
            })
        })
    }

    /// Prove whether a retained verification challenge still names a key.
    /// The keyring maintenance caller holds the keyring lock before crossing
    /// this read seam, preserving the global keyring-before-SQLite lock order.
    pub(crate) fn auth_key_is_referenced(&self, key_id: &str) -> SnapbackResult<bool> {
        self.with_auth_read(|conn| {
            Ok(conn.query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM _auth_verification_codes WHERE key_id = ?1
                 )",
                params![key_id],
                |row| row.get::<_, i64>(0),
            )? != 0)
        })
    }

    /// Enumerate only distinct retained key references for quiesced physical
    /// backup validation. Callers must keep the values internal and redacted.
    pub(crate) fn auth_retained_key_ids(&self) -> SnapbackResult<Vec<String>> {
        self.with_auth_read(retained_key_ids_on)
    }

    /// Apply one destructive restore declaration atomically. The durable
    /// declaration marker is deliberately the final statement, so retry after
    /// an ambiguous post-commit failure is an exact idempotent no-op.
    pub(crate) fn apply_auth_restore_declaration(
        &mut self,
        declaration_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<AuthRestoreResult> {
        validate_restore_declaration(declaration_id)?;
        if now_ms > 9_007_199_254_740_991 {
            return Err(restore_invalid(
                "declared restore time is outside the portable timestamp range",
            ));
        }
        let authorization_interlock = self.authorization_interlock.clone();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_ready_on(&tx)?;
        let applied: Option<String> = tx
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![META_AUTH_RESTORE_DECLARATION_ID],
                |row| row.get(0),
            )
            .optional()?;
        if applied.as_deref() == Some(declaration_id) {
            tx.commit()?;
            return Ok(AuthRestoreResult::AlreadyApplied);
        }

        let exhausted_generations: i64 = tx.query_row(
            "SELECT COUNT(*) FROM _auth_sessions
                 WHERE revoked_at_ms IS NULL AND generation >= 9007199254740991",
            [],
            |row| row.get(0),
        )?;
        if exhausted_generations != 0 {
            return Err(corrupt(
                "auth catalog contains an unrevoked session with an exhausted generation",
            ));
        }
        let sessions_revoked = tx.execute(
            "UPDATE _auth_sessions
                 SET revoked_at_ms = ?1, generation = generation + 1
                 WHERE revoked_at_ms IS NULL",
            params![now_ms as i64],
        )?;
        restore_transaction_step_completed(0)?;
        let challenges_deleted = tx.execute("DELETE FROM _auth_verification_codes", [])?;
        restore_transaction_step_completed(1)?;

        // @ref LLP 0056#reset-restore-and-stream-publication — a first
        // application rotates authorization authority in this same
        // destructive transaction; an idempotent declaration returns above
        // without rotating again. The closed hook also produces the exact
        // pre-commit witness consumed by LLP 0053's room sink barrier.
        let authorization = super::authorization::authorization_commit_hook_in(
            &tx,
            super::authorization::AuthorizationCommitCause::DestructiveBoundary,
        )?;
        super::auth_invalidation::clear_retry_episodes_in(&tx)?;
        super::auth_invalidation::rotate_data_version_stream_in(&tx)?;
        restore_transaction_step_completed(2)?;

        // @ref LLP 0054#restore — the declaration id is written last in the
        // same transaction as revocation and challenge destruction.
        tx.execute(
            "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![META_AUTH_RESTORE_DECLARATION_ID, declaration_id],
        )?;
        restore_transaction_step_completed(3)?;
        let min_commit_version = super::current_version_on(&tx)?;
        super::commit_with_authorization_interlock(
            tx,
            &authorization,
            min_commit_version,
            authorization_interlock,
        )?;
        Ok(AuthRestoreResult::Applied {
            sessions_revoked,
            challenges_deleted,
        })
    }

    /// Produce a complete database image with SQLite's online-backup API.
    /// The caller owns the exclusive maintenance boundary and retained
    /// keyring bytes; this method creates only the requested new 0600 file.
    pub(crate) fn backup_auth_catalog_to(&self, destination: &Path) -> SnapbackResult<()> {
        require_ready_on(&self.conn)?;
        crate::secure_file::write_new_owner_only(destination, &[])
            .map_err(|_| backup_invalid("could not create the backup database image"))?;
        let mut output = Connection::open_with_flags(
            destination,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        {
            let backup = rusqlite::backup::Backup::new(&self.conn, &mut output)?;
            backup.run_to_completion(128, Duration::from_millis(1), None)?;
        }
        // A WAL-mode bit copied from the source would make the standalone
        // image try to create a fresh sidecar merely to open. Normalize the
        // completed image to DELETE mode; all committed WAL pages are already
        // folded into it by the online backup.
        let journal_mode: String =
            output.query_row("PRAGMA journal_mode = DELETE", [], |row| row.get(0))?;
        if !journal_mode.eq_ignore_ascii_case("delete") {
            return Err(backup_invalid(
                "backup database image could not be made self-contained",
            ));
        }
        output.close().map_err(|(_, error)| error)?;
        File::open(destination)
            .and_then(|file| file.sync_all())
            .map_err(|_| backup_invalid("could not sync the backup database image"))
    }

    /// Inspect a physical backup image without configuring SQLite, opening a
    /// WAL writer, or otherwise mutating the candidate artifact.
    pub(crate) fn inspect_auth_catalog_file_read_only(
        path: &Path,
    ) -> SnapbackResult<AuthCatalogState> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        inspect_auth_catalog_on(&conn)
    }

    pub(crate) fn auth_retained_key_ids_file_read_only(path: &Path) -> SnapbackResult<Vec<String>> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        require_ready_on(&conn)?;
        retained_key_ids_on(&conn)
    }
}

/// A failed operation is not a proven rollback until SQLite confirms the
/// rollback. `Transaction::drop` intentionally ignores rollback failures, so
/// relying on drop could exact-unmark a projection ticket while the durable
/// outcome remained uncertain.
///
/// @ref LLP 0056#rollback-and-ambiguous-commit — exact compare-unmark requires
/// a known rollback or an exact durable predecessor proof.
fn rollback_auth_transaction<T>(
    tx: Transaction<'_>,
    operation_error: SnapbackError,
) -> AuthTransactionAttempt<T> {
    match tx.rollback() {
        Ok(()) => AuthTransactionAttempt::RolledBack(operation_error),
        Err(error) => AuthTransactionAttempt::CommitUncertain(
            SnapbackError::error(
                "SNAPBACK_AUTH_REVOCATION_UNCERTAIN",
                "auth",
                "authentication transaction rollback could not be proven",
            )
            .with_details(json!({ "sqlite": error.to_string() })),
        ),
    }
}

/// Install catalog v1 inside a caller-owned transaction. The caller has
/// already established usable keyring state; this seam lets LLP 0055 commit
/// catalog activation together with manifest relocation and mode settlement.
pub(super) fn activate_auth_catalog_v1_in(tx: &Transaction<'_>) -> SnapbackResult<()> {
    match inspect_auth_catalog_on(tx)? {
        AuthCatalogState::ReadyV1 => return Ok(()),
        AuthCatalogState::Uninitialized => {}
    }

    let mut activation_step = 0;
    for table in AUTH_TABLES {
        tx.execute_batch(table.sql)?;
        activation_step_completed(activation_step)?;
        activation_step += 1;
    }
    for index in AUTH_INDEXES {
        tx.execute_batch(index.sql)?;
        activation_step_completed(activation_step)?;
        activation_step += 1;
    }
    // The marker remains the final catalog statement. The outer LLP 0055
    // transaction may append mode metadata only after this exact-ready proof.
    tx.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)",
        params![META_AUTH_CATALOG_VERSION, AUTH_CATALOG_VERSION],
    )?;
    activation_step_completed(activation_step)?;
    require_ready_on(tx)
}

/// Revoke every still-live session inside a caller-owned downgrade
/// transaction. This matches declared-restore generation semantics without
/// creating a restore marker or deleting identity rows.
pub(super) fn revoke_all_sessions_in(tx: &Transaction<'_>, now_ms: u64) -> SnapbackResult<usize> {
    require_ready_on(tx)?;
    let exhausted: i64 = tx.query_row(
        "SELECT COUNT(*) FROM _auth_sessions
         WHERE revoked_at_ms IS NULL AND generation >= 9007199254740991",
        [],
        |row| row.get(0),
    )?;
    if exhausted != 0 {
        return Err(corrupt(
            "auth catalog contains an unrevoked session with an exhausted generation",
        ));
    }
    Ok(tx.execute(
        "UPDATE _auth_sessions
         SET revoked_at_ms = ?1, generation = generation + 1
         WHERE revoked_at_ms IS NULL",
        params![now_ms as i64],
    )?)
}

fn retained_key_ids_on(conn: &Connection) -> SnapbackResult<Vec<String>> {
    let mut statement =
        conn.prepare("SELECT DISTINCT key_id FROM _auth_verification_codes ORDER BY key_id")?;
    Ok(statement
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?)
}

fn validate_restore_declaration(declaration_id: &str) -> SnapbackResult<()> {
    let parsed = Uuid::parse_str(declaration_id)
        .map_err(|_| restore_invalid("restore declaration id is not a canonical UUIDv7"))?;
    if parsed.get_version_num() != 7 || parsed.hyphenated().to_string() != declaration_id {
        return Err(restore_invalid(
            "restore declaration id is not a canonical UUIDv7",
        ));
    }
    Ok(())
}

fn backup_invalid(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_BACKUP_INVALID", "auth-backup", message)
}

fn restore_invalid(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_BACKUP_INVALID", "auth-restore", message)
}

/// Reset helper called from the ordinary app-reset transaction. A dormant
/// unmarked collision is not auth-owned and is deliberately left untouched.
pub(super) fn reset_auth_catalog_in(tx: &Transaction<'_>) -> SnapbackResult<()> {
    if auth_catalog_marker(tx)?.is_none() {
        return Ok(());
    }
    require_ready_on(tx)?;
    for table in [
        "_auth_verification_codes",
        "_auth_session_tokens",
        "_auth_sessions",
        "_auth_identities",
        "_auth_users",
    ] {
        tx.execute(&format!("DELETE FROM \"{table}\""), [])?;
    }
    Ok(())
}

pub(super) fn inspect_auth_catalog_on(conn: &Connection) -> SnapbackResult<AuthCatalogState> {
    let objects = schema_objects(conn)?;
    let marker = auth_catalog_marker_from_objects(conn, &objects)?;
    match marker.as_deref() {
        Some(AUTH_CATALOG_VERSION) => {
            validate_exact_v1(conn, &objects)?;
            Ok(AuthCatalogState::ReadyV1)
        }
        Some(version) => Err(SnapbackError::error(
            "SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED",
            "auth",
            "auth catalog marker names an unsupported version",
        )
        .with_details(json!({ "catalogVersion": version }))),
        None => {
            if let Some(object) = objects
                .iter()
                .find(|object| object.kind == "table" && is_auth_reserved_identifier(&object.name))
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_TABLE_COLLISION",
                    "auth",
                    "an unowned physical table uses the protected auth namespace",
                )
                .with_details(json!({ "objectKind": "table", "objectName": object.name })));
            }
            if let Some(object) = objects.iter().find(|object| {
                AUTH_INDEXES
                    .iter()
                    .any(|index| index.name.eq_ignore_ascii_case(&object.name))
            }) {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION",
                    "auth",
                    "an exact auth-catalog object name is already foreign-owned",
                )
                .with_details(json!({
                    "objectKind": object.kind,
                    "objectName": object.name,
                    "owningTable": object.table,
                })));
            }
            Ok(AuthCatalogState::Uninitialized)
        }
    }
}

/// Rescue is intentionally limited to table collisions. An exact v1 global
/// object name remains an offline-repair condition even when an unrelated
/// table collision would otherwise be copyable.
pub(super) fn reject_exact_auth_catalog_object_collision(conn: &Connection) -> SnapbackResult<()> {
    if let Some(object) = schema_objects(conn)?.into_iter().find(|object| {
        AUTH_INDEXES
            .iter()
            .any(|index| index.name.eq_ignore_ascii_case(&object.name))
    }) {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION",
            "auth",
            "an exact auth-catalog object name is already foreign-owned",
        )
        .with_details(json!({
            "objectKind": object.kind,
            "objectName": object.name,
            "owningTable": object.table,
        })));
    }
    Ok(())
}

fn require_ready_on(conn: &Connection) -> SnapbackResult<()> {
    match inspect_auth_catalog_on(conn)? {
        AuthCatalogState::ReadyV1 => Ok(()),
        AuthCatalogState::Uninitialized => Err(corrupt("auth catalog is not initialized")),
    }
}

fn validate_exact_v1(conn: &Connection, objects: &[SchemaObject]) -> SnapbackResult<()> {
    let by_name = objects
        .iter()
        .map(|object| (object.name.as_str(), object))
        .collect::<BTreeMap<_, _>>();
    let expected_tables = AUTH_TABLES
        .iter()
        .map(|table| table.name)
        .collect::<BTreeSet<_>>();
    let expected_indexes = AUTH_INDEXES
        .iter()
        .map(|index| index.name)
        .collect::<BTreeSet<_>>();

    for table in AUTH_TABLES {
        let Some(object) = by_name.get(table.name) else {
            return Err(corrupt_with_object(
                "auth catalog table is missing",
                "table",
                table.name,
            ));
        };
        if object.kind != "table"
            || object.table != table.name
            || object.sql.as_deref().map(normalize_schema_sql)
                != Some(normalize_schema_sql(table.sql))
        {
            return Err(corrupt_with_object(
                "auth catalog table definition differs from version 1",
                &object.kind,
                table.name,
            ));
        }
    }

    for object in objects {
        if object.kind == "table"
            && is_auth_reserved_identifier(&object.name)
            && !expected_tables.contains(object.name.as_str())
        {
            return Err(corrupt_with_object(
                "marked auth catalog has an unexpected protected table",
                "table",
                &object.name,
            ));
        }
    }

    for index in AUTH_INDEXES {
        let Some(object) = by_name.get(index.name) else {
            return Err(corrupt_with_object(
                "auth catalog index is missing",
                "index",
                index.name,
            ));
        };
        if object.kind != "index"
            || object.table != index.table
            || object.sql.as_deref().map(normalize_schema_sql)
                != Some(normalize_schema_sql(index.sql))
        {
            return Err(corrupt_with_object(
                "auth catalog index definition differs from version 1",
                &object.kind,
                index.name,
            ));
        }
    }

    // Ignore only SQLite-owned primary-key autoindexes. Every other object
    // attached to a catalog table must be one of the named v1 indexes.
    for object in objects {
        if !expected_tables.contains(object.table.as_str()) || object.kind == "table" {
            continue;
        }
        let sqlite_autoindex = object.kind == "index"
            && object.name.starts_with("sqlite_autoindex_")
            && object.sql.is_none();
        if sqlite_autoindex {
            continue;
        }
        if object.kind == "index" && expected_indexes.contains(object.name.as_str()) {
            continue;
        }
        return Err(corrupt_with_object(
            "marked auth catalog has an unexpected attached object",
            &object.kind,
            &object.name,
        ));
    }

    // The SQL text comparison above pins every CHECK expression. The pragma
    // shape additionally proves declared types/nullability/defaults/PKs,
    // foreign keys, uniqueness, indexed columns/collations/order, and partial
    // predicates against a once-built exact-v1 reference catalog. This avoids
    // trusting writable-schema text that does not match the physical btree.
    if catalog_shape(conn, objects)? != *expected_catalog_shape()? {
        return Err(corrupt(
            "auth catalog physical constraints differ from version 1",
        ));
    }

    Ok(())
}

fn expected_catalog_shape() -> SnapbackResult<&'static CatalogShape> {
    static EXPECTED: OnceLock<Result<CatalogShape, SnapbackError>> = OnceLock::new();
    match EXPECTED.get_or_init(|| {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        for table in AUTH_TABLES {
            conn.execute_batch(table.sql)?;
        }
        for index in AUTH_INDEXES {
            conn.execute_batch(index.sql)?;
        }
        let objects = schema_objects(&conn)?;
        catalog_shape(&conn, &objects)
    }) {
        Ok(shape) => Ok(shape),
        Err(error) => Err(error.clone()),
    }
}

fn catalog_shape(conn: &Connection, objects: &[SchemaObject]) -> SnapbackResult<CatalogShape> {
    let objects_by_name = objects
        .iter()
        .map(|object| (object.name.as_str(), object))
        .collect::<BTreeMap<_, _>>();
    let mut tables = BTreeMap::new();
    for expected in AUTH_TABLES {
        let object = objects_by_name.get(expected.name).ok_or_else(|| {
            corrupt_with_object("auth catalog table is missing", "table", expected.name)
        })?;
        tables.insert(
            expected.name.to_owned(),
            TableShape {
                normalized_sql: object
                    .sql
                    .as_deref()
                    .map(normalize_schema_sql)
                    .unwrap_or_default(),
                columns: table_columns(conn, expected.name)?,
                foreign_keys: table_foreign_keys(conn, expected.name)?,
            },
        );
    }

    let mut indexes = BTreeMap::new();
    for expected in AUTH_INDEXES {
        let object = objects_by_name.get(expected.name).ok_or_else(|| {
            corrupt_with_object("auth catalog index is missing", "index", expected.name)
        })?;
        let (unique, origin, partial) = index_list_entry(conn, expected.table, expected.name)?
            .ok_or_else(|| {
                corrupt_with_object(
                    "auth catalog index is not attached to its declared table",
                    "index",
                    expected.name,
                )
            })?;
        indexes.insert(
            expected.name.to_owned(),
            IndexShape {
                normalized_sql: object
                    .sql
                    .as_deref()
                    .map(normalize_schema_sql)
                    .unwrap_or_default(),
                table: object.table.clone(),
                unique,
                origin,
                partial,
                columns: index_columns(conn, expected.name)?,
            },
        );
    }
    Ok(CatalogShape { tables, indexes })
}

fn table_columns(conn: &Connection, table: &str) -> SnapbackResult<Vec<ColumnShape>> {
    let mut statement = conn.prepare(&format!("PRAGMA table_xinfo(\"{table}\")"))?;
    Ok(statement
        .query_map([], |row| {
            Ok(ColumnShape {
                position: row.get(0)?,
                name: row.get(1)?,
                declared_type: row.get(2)?,
                not_null: row.get::<_, i64>(3)? != 0,
                default_sql: row.get(4)?,
                primary_key_position: row.get(5)?,
                hidden: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn table_foreign_keys(conn: &Connection, table: &str) -> SnapbackResult<Vec<ForeignKeyShape>> {
    let mut statement = conn.prepare(&format!("PRAGMA foreign_key_list(\"{table}\")"))?;
    let mut keys = statement
        .query_map([], |row| {
            Ok(ForeignKeyShape {
                id: row.get(0)?,
                sequence: row.get(1)?,
                target_table: row.get(2)?,
                from_column: row.get(3)?,
                to_column: row.get(4)?,
                on_update: row.get(5)?,
                on_delete: row.get(6)?,
                match_name: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    keys.sort_by(|left, right| {
        (&left.id, &left.sequence, &left.from_column).cmp(&(
            &right.id,
            &right.sequence,
            &right.from_column,
        ))
    });
    Ok(keys)
}

fn index_list_entry(
    conn: &Connection,
    table: &str,
    index: &str,
) -> SnapbackResult<Option<(bool, String, bool)>> {
    let mut statement = conn.prepare(&format!("PRAGMA index_list(\"{table}\")"))?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == index {
            return Ok(Some((
                row.get::<_, i64>(2)? != 0,
                row.get(3)?,
                row.get::<_, i64>(4)? != 0,
            )));
        }
    }
    Ok(None)
}

fn index_columns(conn: &Connection, index: &str) -> SnapbackResult<Vec<IndexColumnShape>> {
    let mut statement = conn.prepare(&format!("PRAGMA index_xinfo(\"{index}\")"))?;
    Ok(statement
        .query_map([], |row| {
            Ok(IndexColumnShape {
                sequence: row.get(0)?,
                column_id: row.get(1)?,
                name: row.get(2)?,
                descending: row.get::<_, i64>(3)? != 0,
                collation: row.get(4)?,
                key_column: row.get::<_, i64>(5)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn schema_objects(conn: &Connection) -> SnapbackResult<Vec<SchemaObject>> {
    let mut statement = conn.prepare(
        "SELECT type, name, tbl_name, sql
         FROM sqlite_schema
         ORDER BY type, name",
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok(SchemaObject {
                kind: row.get(0)?,
                name: row.get(1)?,
                table: row.get(2)?,
                sql: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

pub(super) fn auth_catalog_marker(conn: &Connection) -> SnapbackResult<Option<String>> {
    let objects = schema_objects(conn)?;
    auth_catalog_marker_from_objects(conn, &objects)
}

fn auth_catalog_marker_from_objects(
    conn: &Connection,
    objects: &[SchemaObject],
) -> SnapbackResult<Option<String>> {
    let has_meta = objects
        .iter()
        .any(|object| object.kind == "table" && object.name == "_snapback_meta");
    if !has_meta {
        return Ok(None);
    }
    Ok(conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            params![META_AUTH_CATALOG_VERSION],
            |row| row.get(0),
        )
        .optional()?)
}

fn normalize_schema_sql(sql: &str) -> String {
    sql.trim()
        .trim_end_matches(';')
        .chars()
        .filter(|character| !character.is_ascii_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}

fn corrupt(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_CATALOG_CORRUPT", "auth", message)
}

fn corrupt_with_object(message: &str, kind: &str, name: &str) -> SnapbackError {
    corrupt(message).with_details(json!({ "objectKind": kind, "objectName": name }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{FieldManifest, FieldType, IndexManifest, SchemaManifest, TableManifest};
    use crate::storage::auth_mode::{
        META_AUTH_MODE_STATE, META_CAPABILITY_AWARE_SCHEMA_MANIFEST, META_STAGED_AUTH_MODE_MANIFEST,
    };
    use serde_json::to_string;
    use std::fs;

    fn catalog_database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        assert_eq!(
            db.inspect_auth_catalog().expect("inspect empty catalog"),
            AuthCatalogState::Uninitialized
        );
        db.activate_auth_catalog_v1().expect("activate catalog");
        db
    }

    fn row_count(db: &LocalDatabase, table: &str) -> i64 {
        db.conn
            .query_row(&format!("SELECT COUNT(*) FROM \"{table}\""), [], |row| {
                row.get(0)
            })
            .expect("count rows")
    }

    struct RecordingRestoreInterlock {
        prepared: std::sync::Arc<std::sync::atomic::AtomicUsize>,
        committed: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    }

    struct RecordingRestoreCommit {
        committed: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    }

    impl crate::storage::AuthorizationCommitInterlock for RecordingRestoreInterlock {
        fn prepare(
            &self,
            witness: &crate::storage::AuthorizationCommitWitness,
        ) -> SnapbackResult<Box<dyn crate::storage::PreparedAuthorizationCommit>> {
            assert!(witness.event);
            assert!(witness.incarnation_rotated);
            self.prepared
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(Box::new(RecordingRestoreCommit {
                committed: self.committed.clone(),
            }))
        }
    }

    impl crate::storage::PreparedAuthorizationCommit for RecordingRestoreCommit {
        fn committed(self: Box<Self>, _min_commit_version: u64) -> SnapbackResult<()> {
            self.committed
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        }

        fn ambiguous(self: Box<Self>) {
            panic!("the in-memory restore commit must not be ambiguous");
        }
    }

    #[test]
    fn declared_restore_installs_and_settles_authorization_interlock() {
        let mut db = catalog_database();
        let prepared = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let committed = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        db.install_authorization_interlock(std::sync::Arc::new(RecordingRestoreInterlock {
            prepared: prepared.clone(),
            committed: committed.clone(),
        }));

        let declaration = "0197f862-f196-7bb2-b3f0-2a67185dfd17";
        let result = db.apply_auth_restore_declaration(declaration, 100).unwrap();
        assert!(matches!(result, AuthRestoreResult::Applied { .. }));
        assert_eq!(prepared.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(committed.load(std::sync::atomic::Ordering::SeqCst), 1);

        assert_eq!(
            db.apply_auth_restore_declaration(declaration, 101).unwrap(),
            AuthRestoreResult::AlreadyApplied
        );
        assert_eq!(prepared.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(committed.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[test]
    fn recognizes_uninitialized_collision_object_collision_and_exact_v1() {
        let mut db = LocalDatabase::memory().expect("memory database");
        let version_before = db.current_version().expect("app version before activation");
        let journal_before: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| {
                row.get(0)
            })
            .expect("journal before activation");
        assert_eq!(
            db.inspect_auth_catalog().expect("uninitialized"),
            AuthCatalogState::Uninitialized
        );

        db.conn
            .execute("CREATE TABLE \"_AuTh_Legacy\" (id TEXT)", [])
            .expect("create collision");
        let error = db
            .inspect_auth_catalog()
            .expect_err("reserved table must collide");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_TABLE_COLLISION");
        db.conn
            .execute("DROP TABLE \"_AuTh_Legacy\"", [])
            .expect("drop collision");

        db.conn
            .execute("CREATE TABLE ordinary (id TEXT)", [])
            .expect("ordinary table");
        db.conn
            .execute(
                "CREATE INDEX \"_AUTH_SESSIONS_TOKEN_UQ\" ON ordinary(id)",
                [],
            )
            .expect("foreign mixed-case exact index");
        let error = db
            .inspect_auth_catalog()
            .expect_err("exact catalog object collision");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION"
        );
        db.conn
            .execute("DROP INDEX \"_AUTH_SESSIONS_TOKEN_UQ\"", [])
            .expect("drop foreign index");
        db.conn
            .execute("DROP TABLE ordinary", [])
            .expect("drop ordinary table");

        db.activate_auth_catalog_v1().expect("activate exact v1");
        assert_eq!(
            db.inspect_auth_catalog().expect("ready catalog"),
            AuthCatalogState::ReadyV1
        );
        assert!(db.auth_catalog_ready().expect("ready predicate"));
        assert_eq!(
            db.current_version().expect("app version after activation"),
            version_before
        );
        assert_eq!(
            db.conn
                .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| row
                    .get::<_, i64>(0))
                .expect("journal after activation"),
            journal_before
        );
    }

    #[test]
    fn stage_inspection_is_file_and_wal_read_only() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("inspect-read-only.sqlite3");
        let db = LocalDatabase::open(&path).expect("file database");
        db.conn
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .expect("checkpoint before measurement");
        let wal = path.with_extension("sqlite3-wal");
        let file_len = fs::metadata(&path).expect("database metadata").len();
        let wal_len = fs::metadata(&wal)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let total_changes: i64 = db
            .conn
            .query_row("SELECT total_changes()", [], |row| row.get(0))
            .expect("total changes before inspection");

        assert_eq!(
            db.inspect_auth_catalog().expect("read-only inspection"),
            AuthCatalogState::Uninitialized
        );

        assert_eq!(
            db.conn
                .query_row("SELECT total_changes()", [], |row| row.get::<_, i64>(0))
                .expect("total changes after inspection"),
            total_changes
        );
        assert_eq!(
            fs::metadata(&path).expect("database metadata").len(),
            file_len
        );
        assert_eq!(
            fs::metadata(&wal)
                .map(|metadata| metadata.len())
                .unwrap_or(0),
            wal_len
        );
    }

    #[test]
    fn activation_failure_at_every_ddl_boundary_rolls_back_to_uninitialized() {
        for step in 0..AUTH_ACTIVATION_STEPS {
            let mut db = LocalDatabase::memory().expect("memory database");
            inject_auth_activation_failure_after_step(step);
            let error = db
                .activate_auth_catalog_v1()
                .expect_err("injected activation must fail");
            assert_eq!(error.diagnostic.code, "TEST_AUTH_ACTIVATION_FAILURE");
            assert_eq!(
                db.inspect_auth_catalog().expect("rolled-back catalog"),
                AuthCatalogState::Uninitialized,
                "activation step {step} left durable catalog state"
            );
        }
    }

    #[test]
    fn marker_version_and_every_marked_schema_drift_fail_closed() {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.conn
            .execute(
                "INSERT INTO _snapback_meta(key, value) VALUES(?1, '2')",
                params![META_AUTH_CATALOG_VERSION],
            )
            .expect("unknown marker");
        let error = db
            .inspect_auth_catalog()
            .expect_err("unknown version must fail");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED"
        );

        db.conn
            .execute(
                "DELETE FROM _snapback_meta WHERE key = ?1",
                params![META_AUTH_CATALOG_VERSION],
            )
            .expect("clear marker");
        db.activate_auth_catalog_v1().expect("activate catalog");
        db.conn
            .execute("DROP INDEX \"_auth_sessions_token_uq\"", [])
            .expect("corrupt index");
        let error = db
            .inspect_auth_catalog()
            .expect_err("missing index must be corruption");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_CATALOG_CORRUPT");

        let db = catalog_database();
        db.conn
            .execute(
                "CREATE INDEX extra_auth_index ON _auth_users(created_at_ms)",
                [],
            )
            .expect("extra attached index");
        let error = db
            .inspect_auth_catalog()
            .expect_err("extra attached index must be corruption");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_CATALOG_CORRUPT");

        let db = catalog_database();
        db.conn
            .execute("CREATE TABLE _auth_future(id TEXT)", [])
            .expect("extra protected table");
        let error = db
            .inspect_auth_catalog()
            .expect_err("extra protected table must be corruption");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_CATALOG_CORRUPT");
    }

    #[test]
    fn physical_index_shape_cannot_be_forged_by_expected_schema_text() {
        let db = catalog_database();
        db.conn
            .execute("DROP INDEX \"_auth_sessions_token_uq\"", [])
            .expect("drop expected index");
        db.conn
            .execute(
                "CREATE UNIQUE INDEX \"_auth_sessions_token_uq\"
                 ON \"_auth_sessions\"(user_id)",
                [],
            )
            .expect("create wrong physical index");
        let expected_sql = AUTH_INDEXES
            .iter()
            .find(|index| index.name == "_auth_sessions_token_uq")
            .expect("expected index")
            .sql;
        db.conn
            .execute_batch("PRAGMA writable_schema = ON;")
            .expect("enable in-memory corruption fixture");
        db.conn
            .execute(
                "UPDATE sqlite_schema SET sql = ?1 WHERE name = '_auth_sessions_token_uq'",
                params![expected_sql],
            )
            .expect("forge expected schema text");
        db.conn
            .execute_batch("PRAGMA writable_schema = OFF;")
            .expect("disable corruption fixture");

        let error = db
            .inspect_auth_catalog()
            .expect_err("physical index columns must still be compared");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_CATALOG_CORRUPT");
    }

    #[test]
    fn unmarked_exact_catalog_is_collision_not_adoption() {
        let db = catalog_database();
        db.conn
            .execute(
                "DELETE FROM _snapback_meta WHERE key = ?1",
                params![META_AUTH_CATALOG_VERSION],
            )
            .expect("remove marker");
        let error = db
            .inspect_auth_catalog()
            .expect_err("unmarked catalog must not be adopted");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_TABLE_COLLISION");
    }

    #[test]
    fn direct_auth_transactions_commit_ok_roll_back_err_and_never_touch_app_stream() {
        let mut db = catalog_database();
        let version_before = db.current_version().expect("version");
        let journal_before: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| {
                row.get(0)
            })
            .expect("journal count");

        let outcome = db
            .with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES('user-1', 0)",
                    [],
                )?;
                Ok("committed-negative-outcome")
            })
            .expect("Ok outcome commits");
        assert_eq!(outcome, "committed-negative-outcome");
        assert_eq!(row_count(&db, "_auth_users"), 1);

        let error = db
            .with_auth_transaction::<()>(|tx| {
                tx.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES('user-2', 0)",
                    [],
                )?;
                Err(SnapbackError::error("TEST_ROLLBACK", "test", "roll back"))
            })
            .expect_err("Err outcome rolls back");
        assert_eq!(error.diagnostic.code, "TEST_ROLLBACK");
        assert_eq!(row_count(&db, "_auth_users"), 1);
        assert_eq!(db.current_version().expect("version"), version_before);
        let journal_after: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| {
                row.get(0)
            })
            .expect("journal count");
        assert_eq!(journal_after, journal_before);
    }

    #[test]
    fn declared_restore_failure_at_every_boundary_rolls_back_all_effects() {
        for step in 0..=3 {
            let mut db = catalog_database();
            db.with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES('user-1', 0)",
                    [],
                )?;
                tx.execute(
                    "INSERT INTO _auth_identities(
                       id, user_id, provider, subject, verified_at_ms
                     ) VALUES('identity-1', 'user-1', 'email-code', 'person@example.com', 0)",
                    [],
                )?;
                tx.execute(
                    "INSERT INTO _auth_sessions(
                       id, user_id, identity_id, authority_instance_id, token_hash,
                       generation, created_at_ms, last_used_at_ms, expires_at_ms,
                       absolute_expires_at_ms, revoked_at_ms
                     ) VALUES(
                       'session-1', 'user-1', 'identity-1', 'authority-1', ?1,
                       1, 0, 0, 1000, 2000, NULL
                     )",
                    params![vec![7_u8; 32]],
                )?;
                tx.execute(
                    "INSERT INTO _auth_verification_codes(
                       challenge_id, canonical_address, code_digest, key_id,
                       attempts, max_attempts, requested_at_ms, expires_at_ms,
                       consumed_at_ms, superseded_by
                     ) VALUES(
                       'challenge-1', 'person@example.com', ?1, 'key-1',
                       0, 5, 0, 1000, NULL, NULL
                     )",
                    params![vec![9_u8; 32]],
                )?;
                Ok(())
            })
            .expect("seed restore rows");
            let predecessor_version = db.authorization_version().unwrap();

            inject_auth_restore_failure_after_step(step);
            let declaration_id = Uuid::now_v7().to_string();
            let error = db
                .apply_auth_restore_declaration(&declaration_id, 100)
                .expect_err("injected restore transaction must fail");
            assert_eq!(
                error.diagnostic.code,
                "TEST_AUTH_RESTORE_TRANSACTION_FAILURE"
            );
            let session: (i64, Option<i64>) = db
                .conn
                .query_row(
                    "SELECT generation, revoked_at_ms FROM _auth_sessions WHERE id = 'session-1'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .expect("session survives rollback");
            assert_eq!(session, (1, None));
            assert_eq!(row_count(&db, "_auth_verification_codes"), 1);
            let marker: Option<String> = db
                .conn
                .query_row(
                    "SELECT value FROM _snapback_meta WHERE key = ?1",
                    params![META_AUTH_RESTORE_DECLARATION_ID],
                    |row| row.get(0),
                )
                .optional()
                .expect("restore marker query");
            assert_eq!(marker, None);
            assert_eq!(db.authorization_version().unwrap(), predecessor_version);
        }
    }

    #[test]
    fn reset_and_gc_preserve_catalog_and_bypass_app_stream() {
        let mut db = catalog_database();
        db.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES('user-1', 0)",
                [],
            )?;
            tx.execute(
                "INSERT INTO _auth_identities(id, user_id, provider, subject, verified_at_ms)
                 VALUES('identity-1', 'user-1', 'email-code', 'person@example.com', 0)",
                [],
            )?;
            tx.execute(
                "INSERT INTO _auth_sessions(
                   id, user_id, identity_id, authority_instance_id, token_hash,
                   generation, created_at_ms, last_used_at_ms, expires_at_ms,
                   absolute_expires_at_ms, revoked_at_ms
                 ) VALUES(
                   'session-1', 'user-1', 'identity-1', 'authority-1', ?1,
                   1, 0, 0, 1, 1, NULL
                 )",
                params![vec![7_u8; 32]],
            )?;
            tx.execute(
                "INSERT INTO _auth_session_tokens(token_hash, session_id, superseded_at_ms)
                 VALUES(?1, 'session-1', 0)",
                params![vec![8_u8; 32]],
            )?;
            tx.execute(
                "INSERT INTO _auth_verification_codes(
                   challenge_id, canonical_address, code_digest, key_id,
                   attempts, max_attempts, requested_at_ms, expires_at_ms,
                   consumed_at_ms, superseded_by
                 ) VALUES(
                   'challenge-1', 'person@example.com', ?1, 'key-1',
                   0, 5, 0, 1, NULL, NULL
                 )",
                params![vec![9_u8; 32]],
            )?;
            Ok(())
        })
        .expect("seed auth rows");

        let gc = db.auth_gc(1).expect("collect expired auth rows");
        assert_eq!(gc.challenges_deleted, 1);
        assert_eq!(gc.sessions_deleted, 1);
        assert!(!gc.immediate_retry);
        assert_eq!(row_count(&db, "_auth_session_tokens"), 0);
        assert_eq!(db.current_version().expect("version"), 0);
        assert_eq!(
            db.conn
                .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| row
                    .get::<_, i64>(0))
                .expect("journal count"),
            0
        );

        db.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES('user-2', 0)",
                [],
            )?;
            Ok(())
        })
        .expect("seed reset row");
        db.reset().expect("reset app and auth");
        assert_eq!(row_count(&db, "_auth_users"), 0);
        assert_eq!(
            db.inspect_auth_catalog().expect("catalog survives reset"),
            AuthCatalogState::ReadyV1
        );
    }

    #[test]
    fn gc_is_bounded_and_schedules_an_immediate_followup_at_the_batch_edge() {
        let mut db = catalog_database();
        db.with_auth_transaction(|tx| {
            for index in 0..=AUTH_GC_BATCH {
                tx.execute(
                    "INSERT INTO _auth_verification_codes(
                       challenge_id, canonical_address, code_digest, key_id,
                       attempts, max_attempts, requested_at_ms, expires_at_ms,
                       consumed_at_ms, superseded_by
                     ) VALUES(?1, ?2, ?3, 'key-1', 0, 5, 0, 1, NULL, NULL)",
                    params![
                        format!("challenge-{index}"),
                        format!("person-{index}@example.com"),
                        vec![index as u8; 32],
                    ],
                )?;
            }
            Ok(())
        })
        .expect("seed one over a GC batch");

        let first = db.auth_gc(1).expect("first bounded GC pass");
        assert_eq!(first.challenges_deleted, AUTH_GC_BATCH);
        assert!(first.immediate_retry);
        assert_eq!(row_count(&db, "_auth_verification_codes"), 1);

        let second = db.auth_gc(1).expect("second GC pass");
        assert_eq!(second.challenges_deleted, 1);
        assert!(!second.immediate_retry);
        assert_eq!(row_count(&db, "_auth_verification_codes"), 0);
        assert_eq!(db.current_version().expect("app version"), 0);
    }

    #[test]
    fn reserved_manifest_names_reject_apply_reopen_and_runtime_resolution() {
        for (kind, manifest) in [
            (
                "table",
                SchemaManifest {
                    tables: vec![TableManifest {
                        name: "_AuTh_Users".to_owned(),
                        fields: Vec::new(),
                        indexes: Vec::new(),
                        syncable: false,
                        permission_backing: false,
                        permission_fields: None,
                    }],
                    ..SchemaManifest::default()
                },
            ),
            (
                "field",
                SchemaManifest {
                    tables: vec![TableManifest {
                        name: "items".to_owned(),
                        fields: vec![FieldManifest {
                            name: "_AUTH_subject".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        }],
                        indexes: Vec::new(),
                        syncable: false,
                        permission_backing: false,
                        permission_fields: None,
                    }],
                    ..SchemaManifest::default()
                },
            ),
            (
                "index",
                SchemaManifest {
                    tables: vec![TableManifest {
                        name: "items".to_owned(),
                        fields: vec![FieldManifest {
                            name: "value".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        }],
                        indexes: vec![IndexManifest {
                            name: "_auth_lookup".to_owned(),
                            fields: vec!["value".to_owned()],
                        }],
                        syncable: false,
                        permission_backing: false,
                        permission_fields: None,
                    }],
                    ..SchemaManifest::default()
                },
            ),
        ] {
            let mut db = LocalDatabase::memory().expect("memory database");
            let error = db
                .apply_schema(manifest.clone())
                .expect_err("reserved manifest apply must fail");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_INVALID_IDENTIFIER",
                "{kind}"
            );

            let directory = tempfile::tempdir().expect("tempdir");
            let path = directory.path().join(format!("reserved-{kind}.sqlite3"));
            let db = LocalDatabase::open(&path).expect("file database");
            db.conn
                .execute(
                    "DELETE FROM _snapback_meta WHERE key IN (?1, ?2, ?3)",
                    params![
                        META_AUTH_MODE_STATE,
                        META_CAPABILITY_AWARE_SCHEMA_MANIFEST,
                        META_STAGED_AUTH_MODE_MANIFEST,
                    ],
                )
                .expect("remove managed-mode metadata from legacy fixture");
            db.conn
                .execute(
                    "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)",
                    params![
                        super::super::META_SCHEMA_MANIFEST,
                        to_string(&manifest).expect("manifest json")
                    ],
                )
                .expect("plant stored manifest");
            drop(db);
            let error = LocalDatabase::open(&path)
                .err()
                .expect("reserved stored manifest must fail reopen");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_INVALID_IDENTIFIER",
                "{kind}"
            );
        }

        let db = LocalDatabase::memory().expect("memory database");
        let error = db
            .get("_aUtH_users", "anything")
            .expect_err("runtime resolver must reject protected table");
        assert_eq!(error.diagnostic.code, "SNAPBACK_INVALID_IDENTIFIER");
    }
}
