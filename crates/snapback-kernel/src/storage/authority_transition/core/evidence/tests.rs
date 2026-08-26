use super::*;
use rusqlite::{ErrorCode, params};
use std::mem::ManuallyDrop;

const USER_A: &str = "user-a";
const USER_B: &str = "user-b";
const SECRET_A: &[u8] = b"correct horse battery staple";
const SECRET_B: &[u8] = b"different credential";

fn initialized_connection(origin: [u8; 32], resource: [u8; 32]) -> Connection {
    let connection = Connection::open_in_memory().expect("open authority-transition probe");
    initialize_schema(&connection, origin, resource);
    connection
}

fn initialize_schema(connection: &Connection, origin: [u8; 32], resource: [u8; 32]) {
    connection
        .execute_batch(
            "CREATE TABLE _snapback_authorization_publication_guard_v1(
                 singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                 durable_origin BLOB NOT NULL,
                 resource_binding BLOB NOT NULL,
                 state TEXT NOT NULL CHECK(state IN ('operational', 'maintenance'))
             );
             CREATE TABLE _auth_password_credentials(
                 user_id TEXT PRIMARY KEY,
                 secret_digest BLOB NOT NULL,
                 assurance_generation INTEGER NOT NULL
             );
             CREATE TABLE _auth_sessions(
                 id TEXT PRIMARY KEY,
                 user_id TEXT NOT NULL,
                 assurance_generation INTEGER NOT NULL
             );
             CREATE TABLE ordinary(id TEXT PRIMARY KEY);",
        )
        .expect("create authority-transition probe schema");
    connection
        .execute(
            "INSERT INTO _snapback_authorization_publication_guard_v1(
                 singleton, durable_origin, resource_binding, state
             ) VALUES(1, ?1, ?2, 'operational')",
            params![origin.as_slice(), resource.as_slice()],
        )
        .expect("seed durable resource guard");
    for (user_id, secret, assurance_generation) in
        [(USER_A, SECRET_A, 7_i64), (USER_B, SECRET_B, 11_i64)]
    {
        let digest: [u8; 32] = Sha256::digest(secret).into();
        connection
            .execute(
                "INSERT INTO _auth_password_credentials(
                     user_id, secret_digest, assurance_generation
                 ) VALUES(?1, ?2, ?3)",
                params![user_id, digest.as_slice(), assurance_generation],
            )
            .expect("seed password credential");
    }
}

fn guarded(origin: u8, resource: u8) -> GuardedConnection {
    GuardedConnection::from_initialized(initialized_connection([origin; 32], [resource; 32]))
        .expect("own initialized guarded connection")
}

fn proof(user_selector: &str, secret: &[u8]) -> RawPasswordProof {
    RawPasswordProof {
        user_selector: user_selector.to_owned(),
        presented_secret: secret.to_vec(),
    }
}

fn payload(session_id: &str) -> PasswordSessionPayload {
    PasswordSessionPayload {
        session_id: session_id.to_owned(),
    }
}

fn denied(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(inner, _)
            if inner.code == ErrorCode::AuthorizationForStatementDenied
    )
}

fn session_owner(connection: &Connection, session_id: &str) -> Option<(String, i64)> {
    connection
        .query_row(
            "SELECT user_id, assurance_generation FROM _auth_sessions WHERE id = ?1",
            [session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .expect("read durable session projection")
}

fn emit_runtime_probe(id: &str) {
    eprintln!("AUTHORITY_TRANSITION_RUNTIME_PROBE: {id}");
}

#[test]
fn authority_transition_runtime_01_forgotten_scope_cannot_commit_or_outlive_wrapper() {
    let mut guarded = guarded(1, 2);
    execute_verified_effect(
        &mut guarded,
        |transaction| {
            verify_and_derive_password_session(
                transaction,
                proof(USER_A, SECRET_A),
                payload("liveness-authorized"),
            )
        },
        |transaction, derived| {
            let commit = writers::transaction_control_sql(transaction)
                .expect_err("transaction-control SQL must be unrepresentable in the scope");
            assert!(denied(&commit), "unexpected COMMIT refusal: {commit:?}");
            writers::insert_password_session(
                transaction,
                &derived.session_id,
                &derived.subject_user_id,
                derived.assurance_generation,
            )?;

            // Forgetting or suppressing Drop on the borrowed view cannot keep
            // the connection-owned state machine active.
            let forgotten = ManuallyDrop::new(transaction);
            std::mem::forget(forgotten);
            Ok(())
        },
    )
    .expect("wrapper commits the exact fixed write");

    let after_scope =
        writers::unscoped_session_insert(&guarded.connection, "liveness-after-scope", USER_A)
            .expect_err("forgotten scoped borrow must not authorize after wrapper commit");
    assert!(
        denied(&after_scope),
        "unexpected liveness refusal: {after_scope:?}"
    );
    assert_eq!(
        session_owner(&guarded.connection, "liveness-authorized"),
        Some((USER_A.to_owned(), 7))
    );
    assert_eq!(
        session_owner(&guarded.connection, "liveness-after-scope"),
        None
    );
    emit_runtime_probe("01-transaction-liveness");
}

#[test]
fn authority_transition_runtime_02_scope_on_a_cannot_authorize_connection_b() {
    let mut first = guarded(3, 4);
    let second = guarded(5, 6);

    execute_verified_effect(
        &mut first,
        |transaction| {
            verify_and_derive_password_session(
                transaction,
                proof(USER_A, SECRET_A),
                payload("connection-a"),
            )
        },
        |_transaction, _derived| {
            let error =
                writers::unscoped_session_insert(&second.connection, "cross-installed", USER_A)
                    .expect_err("connection A's active scope must not arm connection B");
            assert!(
                denied(&error),
                "unexpected cross-connection refusal: {error:?}"
            );
            Ok(())
        },
    )
    .expect("empty connection-A probe transaction commits");

    assert!(!Arc::ptr_eq(
        &first.authorizer_cell,
        &second.authorizer_cell
    ));
    assert_eq!(session_owner(&second.connection, "cross-installed"), None);
    emit_runtime_probe("02-connection-ownership");
}

#[test]
fn authority_transition_runtime_03_prepared_statement_cannot_execute_after_scope() {
    let mut guarded = guarded(7, 8);
    execute_verified_effect(
        &mut guarded,
        |transaction| {
            verify_and_derive_password_session(
                transaction,
                proof(USER_A, SECRET_A),
                payload("prepared-but-not-run"),
            )
        },
        |transaction, _derived| {
            let statement = writers::prime_cached_session_insert(transaction)?;
            drop(statement);
            Ok(())
        },
    )
    .expect("prepare-only scope commits without a write");

    let error =
        writers::execute_cached_session_insert(&guarded.connection, "execute-after-authority")
            .expect_err("the statement must be re-prepared and re-authorized after scope exit");
    assert!(
        denied(&error),
        "unexpected cached-statement refusal: {error:?}"
    );
    assert_eq!(
        session_owner(&guarded.connection, "execute-after-authority"),
        None
    );
    emit_runtime_probe("03-prepare-execution-lifetime");
}

#[test]
fn authority_transition_runtime_04_duplicate_insert_cannot_replace_foreign_session() {
    let mut guarded = guarded(9, 10);
    issue_password_session(
        &mut guarded,
        proof(USER_B, SECRET_B),
        payload("shared-session-id"),
    )
    .expect("seed exact user-B session");

    let error = issue_password_session(
        &mut guarded,
        proof(USER_A, SECRET_A),
        payload("shared-session-id"),
    )
    .expect_err("fixed INSERT must refuse rather than replace a foreign row");
    assert!(
        matches!(
            error,
            AuthorityTransitionError::Sqlite(rusqlite::Error::SqliteFailure(inner, _))
                if inner.code == ErrorCode::ConstraintViolation
        ),
        "unexpected duplicate-insert refusal: {error:?}"
    );
    assert_eq!(
        session_owner(&guarded.connection, "shared-session-id"),
        Some((USER_B.to_owned(), 11))
    );
    emit_runtime_probe("04-replace-unrepresentable");
}

#[test]
fn authority_transition_runtime_05_valid_secret_cannot_join_foreign_selector() {
    let mut guarded = guarded(11, 12);
    let error = issue_password_session(
        &mut guarded,
        proof(USER_B, SECRET_A),
        payload("foreign-subject"),
    )
    .expect_err("user A's secret must not authorize caller-selected user B");
    assert!(matches!(error, AuthorityTransitionError::ProofRefused));
    assert_eq!(session_owner(&guarded.connection, "foreign-subject"), None);
    emit_runtime_probe("05-private-proof-derivation");
}

#[test]
fn authority_transition_runtime_06_stale_generation_cannot_reactivate_scope() {
    let mut guarded = guarded(13, 14);
    issue_password_session(
        &mut guarded,
        proof(USER_A, SECRET_A),
        payload("generation-one"),
    )
    .expect("advance the wrapper-owned lifecycle once");
    execute_verified_effect(
        &mut guarded,
        |transaction| {
            verify_and_derive_password_session(
                transaction,
                proof(USER_A, SECRET_A),
                payload("generation-two"),
            )
        },
        |transaction, _derived| {
            let error =
                writers::stale_generation_session_insert(transaction, "stale-generation", USER_A)
                    .expect_err("a copied generation-1 scope must not write during generation 2");
            assert!(matches!(
                error,
                AuthorityTransitionError::ScopeAlreadyActive
            ));
            Ok(())
        },
    )
    .expect("wrapper retires generation 2 after refusing the stale scoped borrow");
    assert!(matches!(
        guarded
            .authorizer_cell
            .lock()
            .expect("authorizer cell")
            .phase,
        ScopePhase::Idle { generation: 2 }
    ));
    assert_eq!(session_owner(&guarded.connection, "stale-generation"), None);
    emit_runtime_probe("06-wrapper-generation");
}

#[test]
fn authority_transition_runtime_07_gate_executes_unscoped_denial() {
    let guarded = guarded(15, 16);
    let error =
        writers::unscoped_session_insert(&guarded.connection, "runtime-gate-sentinel", USER_A)
            .expect_err("the executing gate must observe an actual protected-write refusal");
    assert!(denied(&error), "unexpected unscoped refusal: {error:?}");
    assert_eq!(
        session_owner(&guarded.connection, "runtime-gate-sentinel"),
        None
    );
    emit_runtime_probe("07-executing-gate");
}

#[test]
fn authority_transition_runtime_resource_guard_is_reread_inside_effect_transaction() {
    let directory = tempfile::tempdir().expect("resource-guard tempdir");
    let path = directory.path().join("authority-transition.sqlite3");
    let bootstrap = Connection::open(&path).expect("open bootstrap connection");
    initialize_schema(&bootstrap, [17; 32], [18; 32]);
    drop(bootstrap);

    let mut guarded = GuardedConnection::from_initialized(
        Connection::open(&path).expect("open supported guarded connection"),
    )
    .expect("own file-backed guarded connection");
    let external = Connection::open(&path).expect("open hostile raw file connection");
    external
        .execute(
            "UPDATE _snapback_authorization_publication_guard_v1
             SET resource_binding = ?1 WHERE singleton = 1",
            [[19_u8; 32].as_slice()],
        )
        .expect("change durable guard after supported connection acquisition");

    let error = issue_password_session(
        &mut guarded,
        proof(USER_A, SECRET_A),
        payload("changed-resource-guard"),
    )
    .expect_err("the next effect must reread and refuse the changed durable guard");
    assert!(matches!(
        error,
        AuthorityTransitionError::ResourceGuardChanged
    ));
    assert_eq!(
        session_owner(&guarded.connection, "changed-resource-guard"),
        None
    );
    emit_runtime_probe("resource-guard-reread");
}
