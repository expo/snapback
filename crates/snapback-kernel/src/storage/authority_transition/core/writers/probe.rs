//! Unit-only SQL probes for the dormant authorizer substrate.

use super::super::AuthorityWritePermit;
use rusqlite::{Connection, Transaction};

pub(super) fn create_schema(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE ordinary(id TEXT PRIMARY KEY);
         CREATE TABLE _auth_users(id TEXT PRIMARY KEY);
         CREATE TABLE _auth_sessions(id TEXT PRIMARY KEY, assurance_generation INTEGER);
         CREATE TABLE _auth_session_tokens(id TEXT PRIMARY KEY);
         CREATE TABLE _auth_credentials(id TEXT PRIMARY KEY, generation INTEGER);
         CREATE TABLE _auth_recovery_codes(id TEXT PRIMARY KEY, consumed_at_ms INTEGER);
         CREATE TABLE _auth_password_attempts(id TEXT PRIMARY KEY, attempts INTEGER);
         CREATE TABLE _auth_password_credentials(id TEXT PRIMARY KEY);
         CREATE TABLE team_membership(id TEXT PRIMARY KEY);",
    )
}

pub(super) fn insert_expected_session(
    transaction: &Transaction<'_>,
    _permit: &AuthorityWritePermit<'_, '_>,
) -> rusqlite::Result<usize> {
    transaction.execute("INSERT INTO _auth_sessions(id) VALUES('session-1')", [])
}

pub(super) fn insert_auth_session(connection: &Connection, id: &str) -> rusqlite::Result<usize> {
    connection.execute("INSERT INTO _auth_sessions(id) VALUES(?1)", [id])
}

pub(super) fn insert_ordinary(connection: &Connection) -> rusqlite::Result<usize> {
    connection.execute("INSERT INTO ordinary(id) VALUES('ordinary-1')", [])
}

pub(super) fn insert_auth_user(connection: &Connection) -> rusqlite::Result<usize> {
    connection.execute("INSERT INTO _auth_users(id) VALUES('user-1')", [])
}

pub(super) fn update_auth_user(connection: &Connection) -> rusqlite::Result<usize> {
    connection.execute(
        "UPDATE _auth_users SET id = 'user-2' WHERE id = 'user-1'",
        [],
    )
}

pub(super) fn delete_auth_user(connection: &Connection) -> rusqlite::Result<usize> {
    connection.execute("DELETE FROM _auth_users WHERE id = 'user-1'", [])
}

pub(super) fn replace_auth_user(connection: &Connection) -> rusqlite::Result<usize> {
    connection.execute("REPLACE INTO _auth_users(id) VALUES('user-1')", [])
}

pub(super) fn create_protected_trigger(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TRIGGER auth_user_probe AFTER INSERT ON _auth_users
         BEGIN INSERT INTO ordinary(id) VALUES(NEW.id); END;",
    )
}

pub(super) fn create_schema_object(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch("CREATE TABLE later_schema(id TEXT PRIMARY KEY);")
}

pub(super) fn attach_database(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch("ATTACH DATABASE ':memory:' AS foreign_store;")
}

pub(super) fn insert_dynamic_membership(connection: &Connection) -> rusqlite::Result<usize> {
    connection.execute("INSERT INTO team_membership(id) VALUES('member-1')", [])
}

#[cfg(test)]
#[allow(unexpected_cfgs)]
mod tests {
    use super::super::super::*;
    use super::*;
    use rusqlite::ErrorCode;

    fn authorizer() -> ConnectionAuthorizer {
        ConnectionAuthorizer::for_database(DatabaseBinding::isolated(), [7; 32])
    }

    fn password_proof() -> evidence::VerifiedProof {
        evidence::password_proof_for_test()
    }

    fn denied(error: &rusqlite::Error) -> bool {
        matches!(
            error,
            rusqlite::Error::SqliteFailure(inner, _)
                if inner.code == ErrorCode::AuthorizationForStatementDenied
        )
    }

    fn interrupted(error: &rusqlite::Error) -> bool {
        matches!(
            error,
            rusqlite::Error::SqliteFailure(inner, _)
                if inner.code == ErrorCode::OperationInterrupted
        )
    }

    #[test]
    fn dormant_authorizer_denies_every_protected_effect_class_without_a_permit() {
        let connection = Connection::open_in_memory().expect("open authorizer probe");
        create_schema(&connection).expect("create probe schema before install");
        let authorizer = authorizer();
        authorizer
            .set_dynamic_membership_tables(["team_membership".to_owned()])
            .expect("register dynamic membership table");
        authorizer.install(&connection).expect("install authorizer");

        insert_ordinary(&connection).expect("ordinary DML remains unrelated");
        for attempt in [
            insert_auth_user(&connection),
            update_auth_user(&connection),
            delete_auth_user(&connection),
            replace_auth_user(&connection),
            insert_dynamic_membership(&connection),
        ] {
            let error = attempt.expect_err("protected DML must require an exact permit");
            assert!(denied(&error), "unexpected protected-DML error: {error:?}");
        }

        for attempt in [
            create_protected_trigger(&connection),
            create_schema_object(&connection),
            attach_database(&connection),
        ] {
            let error = attempt.expect_err("structural effects must require an exact permit");
            assert!(
                denied(&error),
                "unexpected structural-effect error: {error:?}"
            );
        }
    }

    #[test]
    fn consumed_evidence_activates_only_its_exact_write_set_until_permit_drop() {
        let mut connection = Connection::open_in_memory().expect("open authorizer probe");
        create_schema(&connection).expect("create probe schema before install");
        let authorizer = authorizer();
        authorizer.install(&connection).expect("install authorizer");
        let transaction = authorizer
            .begin_immediate(&mut connection)
            .expect("begin immediate protected transaction");
        let permit = verifier::consume_verified_proof(
            transaction.sqlite(),
            transaction.identity(),
            &transaction.identity().database_origin,
            password_proof(),
            AuthorityMutation::IssuePasswordSession,
            [9; 32],
            15,
        )
        .expect("consume exact password evidence");

        assert_eq!(
            insert_expected_session(transaction.sqlite(), &permit)
                .expect("exact session insert is authorized"),
            1
        );
        let mismatch = insert_auth_user(transaction.sqlite())
            .expect_err("another protected table is outside the exact write set");
        assert!(
            denied(&mismatch),
            "unexpected write-set mismatch: {mismatch:?}"
        );
        drop(permit);
        assert!(transaction.identity().nonce_registry.borrow().is_empty());
        transaction.commit().expect("commit exact protected write");

        let after_drop = insert_auth_user(&connection)
            .expect_err("permit drop clears the connection-local cell");
        assert!(
            denied(&after_drop),
            "unexpected post-drop error: {after_drop:?}"
        );
    }

    #[test]
    fn failed_relation_consumes_the_allocated_nonce_and_never_arms_the_cell() {
        let mut connection = Connection::open_in_memory().expect("open authorizer probe");
        create_schema(&connection).expect("create probe schema before install");
        let authorizer = authorizer();
        authorizer.install(&connection).expect("install authorizer");
        let transaction = authorizer
            .begin_immediate(&mut connection)
            .expect("begin immediate protected transaction");

        let error = match verifier::consume_verified_proof(
            transaction.sqlite(),
            transaction.identity(),
            &transaction.identity().database_origin,
            password_proof(),
            AuthorityMutation::RotateRecoveryCredential,
            [9; 32],
            15,
        ) {
            Ok(_) => panic!("purpose and mutation are one-to-one"),
            Err(error) => error,
        };
        assert_eq!(error, AuthorityTransitionError::MutationMismatch);
        assert!(transaction.identity().nonce_registry.borrow().is_empty());
        assert!(
            transaction
                .identity()
                .authorizer_permit_cell
                .lock()
                .expect("permit cell")
                .active
                .is_none()
        );
        transaction.rollback().expect("rollback rejected ceremony");
    }

    fn assert_post_commit_session_insert_denied(connection: &Connection, id: &str, bypass: &str) {
        let error = insert_auth_session(connection, id)
            .expect_err("a skipped permit destructor must not authorize after commit");
        assert!(
            denied(&error),
            "unexpected post-commit error after {bypass}: {error:?}"
        );
        eprintln!("{bypass} bypass: post-commit protected insert refused ({error})");
    }

    #[test]
    fn forgotten_permit_is_inert_after_its_transaction_commits() {
        let mut connection = Connection::open_in_memory().expect("open mem::forget probe");
        create_schema(&connection).expect("create probe schema before install");
        let authorizer = authorizer();
        authorizer.install(&connection).expect("install authorizer");
        let transaction = authorizer
            .begin_immediate(&mut connection)
            .expect("begin mem::forget transaction");
        let permit = verifier::consume_verified_proof(
            transaction.sqlite(),
            transaction.identity(),
            &transaction.identity().database_origin,
            password_proof(),
            AuthorityMutation::IssuePasswordSession,
            [9; 32],
            15,
        )
        .expect("consume mem::forget evidence");

        std::mem::forget(permit);
        transaction
            .commit()
            .expect("commit forgotten permit transaction");
        assert!(
            authorizer
                .permit_cell
                .lock()
                .expect("permit cell after mem::forget")
                .active
                .is_none(),
            "the commit hook must revoke even when permit Drop was skipped"
        );
        assert_post_commit_session_insert_denied(
            &connection,
            "post-commit-mem-forget",
            "mem::forget",
        );
    }

    #[test]
    fn leaked_boxed_permit_is_inert_after_its_transaction_commits() {
        let mut connection = Connection::open_in_memory().expect("open Box::leak probe");
        create_schema(&connection).expect("create probe schema before install");
        let authorizer = authorizer();
        authorizer.install(&connection).expect("install authorizer");
        let transaction = authorizer
            .begin_immediate(&mut connection)
            .expect("begin Box::leak transaction");
        let permit = verifier::consume_verified_proof(
            transaction.sqlite(),
            transaction.identity(),
            &transaction.identity().database_origin,
            password_proof(),
            AuthorityMutation::IssuePasswordSession,
            [9; 32],
            15,
        )
        .expect("consume Box::leak evidence");

        let _leaked = Box::leak(Box::new(permit));
        transaction
            .commit()
            .expect("commit leaked boxed permit transaction");
        assert_post_commit_session_insert_denied(&connection, "post-commit-box-leak", "Box::leak");
    }

    #[test]
    fn manually_dropped_permit_is_inert_after_its_transaction_commits() {
        let mut connection = Connection::open_in_memory().expect("open ManuallyDrop probe");
        create_schema(&connection).expect("create probe schema before install");
        let authorizer = authorizer();
        authorizer.install(&connection).expect("install authorizer");
        let transaction = authorizer
            .begin_immediate(&mut connection)
            .expect("begin ManuallyDrop transaction");
        let permit = verifier::consume_verified_proof(
            transaction.sqlite(),
            transaction.identity(),
            &transaction.identity().database_origin,
            password_proof(),
            AuthorityMutation::IssuePasswordSession,
            [9; 32],
            15,
        )
        .expect("consume ManuallyDrop evidence");

        let _permit_without_drop = std::mem::ManuallyDrop::new(permit);
        transaction
            .commit()
            .expect("commit manually dropped permit transaction");
        assert_post_commit_session_insert_denied(
            &connection,
            "post-commit-manually-drop",
            "ManuallyDrop",
        );
    }

    #[test]
    fn authority_runtime_rejects_forgotten_transaction_after_external_commit() {
        let mut connection = Connection::open_in_memory().expect("open owner-leak probe");
        create_schema(&connection).expect("create probe schema before install");
        let authorizer = authorizer();
        authorizer.install(&connection).expect("install authorizer");
        let transaction = authorizer
            .begin_immediate(&mut connection)
            .expect("begin leaked authority transaction");
        let first_epoch = transaction.identity().connection_epoch;
        let permit = verifier::consume_verified_proof(
            transaction.sqlite(),
            transaction.identity(),
            &transaction.identity().database_origin,
            password_proof(),
            AuthorityMutation::IssuePasswordSession,
            [9; 32],
            15,
        )
        .expect("consume exact password evidence");

        std::mem::forget(permit);
        std::mem::forget(transaction);
        connection
            .execute_batch("COMMIT")
            .expect("commit through the connection after leaking the Rust transaction");

        let cell = authorizer
            .permit_cell
            .lock()
            .expect("permit cell after raw commit");
        assert!(cell.active.is_none(), "COMMIT must clear leaked authority");
        assert_ne!(cell.connection_epoch, Some(first_epoch));
        drop(cell);
        assert_post_commit_session_insert_denied(
            &connection,
            "post-commit-owner-leak",
            "forgotten transaction owner",
        );

        let later = authorizer
            .begin_immediate(&mut connection)
            .expect("the leaked cell must not pin later legitimate work");
        let later_permit = verifier::consume_verified_proof(
            later.sqlite(),
            later.identity(),
            &later.identity().database_origin,
            password_proof(),
            AuthorityMutation::IssuePasswordSession,
            [8; 32],
            15,
        )
        .expect("later legitimate ceremony can activate");
        assert_eq!(
            insert_auth_session(later.sqlite(), "later-legitimate")
                .expect("later exact insert is authorized"),
            1
        );
        drop(later_permit);
        later.commit().expect("commit later legitimate ceremony");
    }

    #[test]
    fn authority_runtime_rejects_one_authorizer_on_a_second_connection() {
        let mut connection_a = Connection::open_in_memory().expect("open connection A");
        let connection_b = Connection::open_in_memory().expect("open connection B");
        create_schema(&connection_a).expect("create A schema");
        create_schema(&connection_b).expect("create B schema");
        let authorizer = authorizer();
        authorizer.install(&connection_a).expect("install on A");
        let second_install = authorizer.install(&connection_b);

        let transaction_a = authorizer
            .begin_immediate(&mut connection_a)
            .expect("begin exact transaction on A");
        let permit_a = verifier::consume_verified_proof(
            transaction_a.sqlite(),
            transaction_a.identity(),
            &transaction_a.identity().database_origin,
            password_proof(),
            AuthorityMutation::IssuePasswordSession,
            [9; 32],
            15,
        )
        .expect("activate A permit");

        let error = insert_auth_session(&connection_b, "cross-connection")
            .expect_err("A's permit must not authorize B");
        assert!(denied(&error), "unexpected B refusal: {error:?}");
        let b_rows: i64 = connection_b
            .query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| row.get(0))
            .expect("count B sessions");
        assert_eq!(b_rows, 0);
        assert_eq!(
            second_install,
            Err(AuthorityTransitionError::AuthorizerConnectionMismatch),
            "installing one authorizer on B must refuse the origin mismatch"
        );
        drop(permit_a);
        transaction_a.rollback().expect("rollback A probe");
    }

    #[test]
    fn authority_runtime_rejects_prepared_statement_after_permit_drop() {
        let mut connection = Connection::open_in_memory().expect("open prepared-statement probe");
        create_schema(&connection).expect("create probe schema before install");
        let authorizer = authorizer();
        authorizer.install(&connection).expect("install authorizer");
        let transaction = authorizer
            .begin_immediate(&mut connection)
            .expect("begin prepared-statement transaction");
        let permit = verifier::consume_verified_proof(
            transaction.sqlite(),
            transaction.identity(),
            &transaction.identity().database_origin,
            password_proof(),
            AuthorityMutation::IssuePasswordSession,
            [9; 32],
            15,
        )
        .expect("activate statement permit");
        let mut statement = transaction
            .sqlite()
            .prepare("INSERT INTO _auth_sessions(id) VALUES(?1)")
            .expect("prepare while the permit is active");

        drop(permit);
        let error = statement
            .execute(["prepared-after-drop"])
            .expect_err("live prepared statement must reauthorize after permit drop");
        assert!(
            denied(&error),
            "unexpected prepared-statement refusal: {error:?}"
        );
        drop(statement);
        let rows: i64 = transaction
            .sqlite()
            .query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| row.get(0))
            .expect("count sessions after refused prepared statement");
        assert_eq!(rows, 0);
        transaction
            .rollback()
            .expect("rollback prepared-statement probe");
    }

    #[test]
    fn authority_runtime_rejects_replace_under_insert_permit() {
        let mut connection = Connection::open_in_memory().expect("open REPLACE probe");
        create_schema(&connection).expect("create probe schema before install");
        connection
            .execute(
                "INSERT INTO _auth_sessions(id, assurance_generation) VALUES('existing', 1)",
                [],
            )
            .expect("seed existing protected row before install");
        let authorizer = authorizer();
        authorizer.install(&connection).expect("install authorizer");
        let transaction = authorizer
            .begin_immediate(&mut connection)
            .expect("begin REPLACE transaction");
        let permit = verifier::consume_verified_proof(
            transaction.sqlite(),
            transaction.identity(),
            &transaction.identity().database_origin,
            password_proof(),
            AuthorityMutation::IssuePasswordSession,
            [9; 32],
            15,
        )
        .expect("activate insert-only permit");

        let error = transaction
            .sqlite()
            .execute(
                "REPLACE INTO _auth_sessions(id, assurance_generation) VALUES('existing', 99)",
                [],
            )
            .expect_err("REPLACE's implicit delete must not fit an Insert permit");
        assert!(
            interrupted(&error),
            "semantic REPLACE guard should interrupt execution: {error:?}"
        );
        drop(permit);
        transaction
            .commit()
            .expect_err("a transaction tainted by REPLACE must be rolled back at commit");
        let generation: i64 = connection
            .query_row(
                "SELECT assurance_generation FROM _auth_sessions WHERE id = 'existing'",
                [],
                |row| row.get(0),
            )
            .expect("read durable protected row after refused commit");
        assert_eq!(generation, 1);
    }

    #[test]
    fn authority_runtime_rejects_writer_reactivation_with_arbitrary_mutation() {
        let mut connection = Connection::open_in_memory().expect("open reactivation probe");
        create_schema(&connection).expect("create probe schema before install");
        connection
            .execute(
                "INSERT INTO _auth_credentials(id, generation) VALUES('credential-1', 1)",
                [],
            )
            .expect("seed protected credential before install");
        connection
            .execute(
                "INSERT INTO _auth_recovery_codes(id, consumed_at_ms) VALUES('recovery-1', NULL)",
                [],
            )
            .expect("seed protected recovery code before install");
        let authorizer = authorizer();
        authorizer.install(&connection).expect("install authorizer");
        let transaction = authorizer
            .begin_immediate(&mut connection)
            .expect("begin reactivation transaction");
        let permit = verifier::consume_verified_proof(
            transaction.sqlite(),
            transaction.identity(),
            &transaction.identity().database_origin,
            password_proof(),
            AuthorityMutation::IssuePasswordSession,
            [9; 32],
            15,
        )
        .expect("obtain one legitimate permit");

        let stolen_transaction = permit.transaction;
        let stolen_sqlite_transaction = permit._sqlite_transaction;
        let consumed_nonce = permit.nonce;
        drop(permit);
        let error = match permit::activate(
            stolen_transaction,
            stolen_sqlite_transaction,
            consumed_nonce,
            AuthorityMutation::RotateRecoveryCredential,
            registry::write_set_for(&AuthorityMutation::RotateRecoveryCredential),
            [8; 32],
        ) {
            Ok(_) => panic!("one password ceremony must not mint recovery authority"),
            Err(error) => error,
        };
        assert_eq!(error, AuthorityTransitionError::NonceMissingOrConsumed);

        let write_error = transaction
            .sqlite()
            .execute(
                "UPDATE _auth_credentials SET generation = 2 WHERE id = 'credential-1'",
                [],
            )
            .expect_err("failed reactivation must leave the protected writer unarmed");
        assert!(
            denied(&write_error),
            "unexpected reactivation refusal: {write_error:?}"
        );
        let generation: i64 = transaction
            .sqlite()
            .query_row(
                "SELECT generation FROM _auth_credentials WHERE id = 'credential-1'",
                [],
                |row| row.get(0),
            )
            .expect("read unchanged credential generation");
        assert_eq!(generation, 1);
        transaction.rollback().expect("rollback reactivation probe");
    }

    #[test]
    fn authority_runtime_advances_epoch_on_commit_and_rollback() {
        let mut connection = Connection::open_in_memory().expect("open epoch probe");
        create_schema(&connection).expect("create probe schema before install");
        let authorizer = authorizer();
        authorizer.install(&connection).expect("install authorizer");

        let committed = authorizer
            .begin_immediate(&mut connection)
            .expect("begin committed epoch");
        let committed_epoch = committed.identity().connection_epoch;
        committed
            .sqlite()
            .execute("INSERT INTO ordinary(id) VALUES('commit-epoch')", [])
            .expect("make committed transaction non-empty");
        committed.commit().expect("commit epoch probe");

        let rolled_back = authorizer
            .begin_immediate(&mut connection)
            .expect("begin rollback epoch");
        let rollback_epoch = rolled_back.identity().connection_epoch;
        assert_eq!(rollback_epoch.get(), committed_epoch.get() + 1);
        rolled_back
            .sqlite()
            .execute("INSERT INTO ordinary(id) VALUES('rollback-epoch')", [])
            .expect("make rollback transaction non-empty");
        rolled_back.rollback().expect("rollback epoch probe");

        let after_rollback = authorizer
            .begin_immediate(&mut connection)
            .expect("begin after rollback");
        assert_eq!(
            after_rollback.identity().connection_epoch.get(),
            rollback_epoch.get() + 1
        );
        after_rollback.rollback().expect("close final epoch probe");
    }

    // These owning-crate probes compile only when the security-boundary gate
    // supplies its private cfg. They exercise the real private types and
    // functions; ordinary workspace and product builds never include them.
    #[cfg(snapback_authority_compile_fail)]
    include!("compile_fail/obtain_kernel_verified_evidence.rs");
    #[cfg(snapback_authority_compile_fail)]
    include!("compile_fail/accept_kernel_verified_evidence.rs");
    #[cfg(snapback_authority_compile_fail)]
    include!("compile_fail/clone_kernel_verified_evidence.rs");
    #[cfg(snapback_authority_compile_fail)]
    include!("compile_fail/convert_kernel_verified_evidence.rs");
    #[cfg(snapback_authority_compile_fail)]
    include!("compile_fail/deserialize_kernel_verified_evidence.rs");
    // Privacy diagnostics are a late rustc pass and are suppressed when the
    // other deliberately ill-typed probes share this compilation. Compile
    // this capability probe alone so its named-field pattern is witnessed.
    #[cfg(snapback_authority_compile_fail_decompose)]
    include!("compile_fail/decompose_kernel_verified_evidence.rs");
    #[cfg(snapback_authority_compile_fail)]
    include!("compile_fail/reinstall_kernel_verified_evidence.rs");
    #[cfg(snapback_authority_compile_fail)]
    include!("compile_fail/hold_authority_write_permit_across_commit.rs");
}
