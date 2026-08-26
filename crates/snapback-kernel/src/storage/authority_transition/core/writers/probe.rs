//! Unit-only SQL probes for the dormant authorizer substrate.

use super::super::AuthorityWritePermit;
use rusqlite::{Connection, Transaction};

pub(super) fn create_schema(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE ordinary(id TEXT PRIMARY KEY);
         CREATE TABLE _auth_users(id TEXT PRIMARY KEY);
         CREATE TABLE _auth_sessions(id TEXT PRIMARY KEY, assurance_generation INTEGER);
         CREATE TABLE _auth_session_tokens(id TEXT PRIMARY KEY);
         CREATE TABLE _auth_password_attempts(id TEXT PRIMARY KEY, attempts INTEGER);
         CREATE TABLE _auth_password_credentials(id TEXT PRIMARY KEY);
         CREATE TABLE team_membership(id TEXT PRIMARY KEY);",
    )
}

pub(super) fn insert_expected_session(
    transaction: &Transaction<'_>,
    _permit: &AuthorityWritePermit<'_>,
) -> rusqlite::Result<usize> {
    transaction.execute("INSERT INTO _auth_sessions(id) VALUES('session-1')", [])
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
mod tests {
    use super::super::super::*;
    use super::*;
    use rusqlite::ErrorCode;

    fn authorizer() -> ConnectionAuthorizer {
        ConnectionAuthorizer::for_database(
            DatabaseBinding::isolated(),
            [7; 32],
            NonZeroU64::new(1).expect("nonzero connection epoch"),
        )
    }

    fn password_proof() -> VerifiedProof {
        VerifiedProof {
            proof_kind: ProofKind::Password,
            subject: VerifiedSubject::Human([1; 32]),
            authority_class: AuthorityClass::Human,
            purpose: AuthorityPurpose::PasswordSessionIssuance,
            predecessors: NonEmpty {
                head: DurablePredecessor {
                    object: ProtectedObject::AuthPasswordCredentials,
                    generation: NonZeroU64::new(1).expect("nonzero predecessor generation"),
                    digest: [2; 32],
                },
                tail: Vec::new(),
            },
            time: VerifiedTime {
                durable_floor_ms: 5,
                verified_at_ms: 10,
                not_after_ms: 20,
            },
        }
    }

    fn denied(error: &rusqlite::Error) -> bool {
        matches!(
            error,
            rusqlite::Error::SqliteFailure(inner, _)
                if inner.code == ErrorCode::AuthorizationForStatementDenied
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
        authorizer.install(&connection);

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
        authorizer.install(&connection);
        let (transaction, identity) = authorizer
            .begin_immediate(&mut connection)
            .expect("begin immediate protected transaction");
        let permit = verifier::consume_verified_proof(
            &identity,
            &authorizer.database_origin,
            password_proof(),
            AuthorityMutation::IssuePasswordSession,
            [9; 32],
            15,
        )
        .expect("consume exact password evidence");

        assert_eq!(
            insert_expected_session(&transaction, &permit)
                .expect("exact session insert is authorized"),
            1
        );
        let mismatch = insert_auth_user(&transaction)
            .expect_err("another protected table is outside the exact write set");
        assert!(
            denied(&mismatch),
            "unexpected write-set mismatch: {mismatch:?}"
        );
        transaction.commit().expect("commit exact protected write");
        drop(permit);

        let after_drop = insert_auth_user(&connection)
            .expect_err("permit drop clears the connection-local cell");
        assert!(
            denied(&after_drop),
            "unexpected post-drop error: {after_drop:?}"
        );
        assert!(identity.nonce_registry.borrow().is_empty());
    }

    #[test]
    fn failed_relation_consumes_the_allocated_nonce_and_never_arms_the_cell() {
        let mut connection = Connection::open_in_memory().expect("open authorizer probe");
        create_schema(&connection).expect("create probe schema before install");
        let authorizer = authorizer();
        authorizer.install(&connection);
        let (transaction, identity) = authorizer
            .begin_immediate(&mut connection)
            .expect("begin immediate protected transaction");

        let error = match verifier::consume_verified_proof(
            &identity,
            &authorizer.database_origin,
            password_proof(),
            AuthorityMutation::RotateRecoveryCredential,
            [9; 32],
            15,
        ) {
            Ok(_) => panic!("purpose and mutation are one-to-one"),
            Err(error) => error,
        };
        assert_eq!(error, AuthorityTransitionError::MutationMismatch);
        assert!(identity.nonce_registry.borrow().is_empty());
        assert!(
            identity
                .authorizer_permit_cell
                .lock()
                .expect("permit cell")
                .active
                .is_none()
        );
        transaction.rollback().expect("rollback rejected ceremony");
    }
}
