use super::*;
use rusqlite::{ErrorCode, params};
use std::collections::HashSet;
use std::mem::ManuallyDrop;

const USER_A: &str = "user-a";
const USER_B: &str = "user-b";
const SECRET_A: &[u8] = b"correct horse battery staple";
const SECRET_B: &[u8] = b"different credential";

fn initialized_connection(origin: [u8; 32], resource: [u8; 32]) -> InitializedConnection {
    let connection =
        InitializedConnection::private_memory().expect("open authority-transition probe");
    initialize_schema(&connection, origin, resource, "");
    connection
}

fn initialize_schema(
    connection: &InitializedConnection,
    origin: [u8; 32],
    resource: [u8; 32],
    session_primary_key_suffix: &str,
) {
    connection
        .execute_batch(&format!(
            "CREATE TABLE _snapback_authorization_publication_guard_v1(
                 singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                 durable_origin BLOB NOT NULL,
                 resource_binding BLOB NOT NULL,
                 state TEXT NOT NULL CHECK(state IN ('operational', 'maintenance'))
             );
             CREATE TABLE _auth_password_credentials(
                 user_id TEXT PRIMARY KEY COLLATE NOCASE,
                 secret_digest BLOB NOT NULL,
                 assurance_generation INTEGER NOT NULL
             );
             CREATE TABLE _auth_sessions(
                 id TEXT PRIMARY KEY {session_primary_key_suffix},
                 user_id TEXT NOT NULL,
                 assurance_generation INTEGER NOT NULL
             );
             CREATE TABLE ordinary(id TEXT PRIMARY KEY, value TEXT);"
        ))
        .expect("create authority-transition probe schema");
    seed_resource_and_credentials(connection, origin, resource);
}

fn seed_resource_and_credentials(
    connection: &InitializedConnection,
    origin: [u8; 32],
    resource: [u8; 32],
) {
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

fn denied(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(inner, _)
            if inner.code == ErrorCode::AuthorizationForStatementDenied
    )
}

fn sessions(connection: &Connection) -> Vec<(String, String, i64)> {
    connection
        .prepare(
            "SELECT id, user_id, assurance_generation
             FROM _auth_sessions ORDER BY id",
        )
        .expect("prepare durable session readback")
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .expect("query durable sessions")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect durable sessions")
}

fn credential_generation(connection: &Connection, user_id: &str) -> i64 {
    connection
        .query_row(
            "SELECT assurance_generation FROM _auth_password_credentials WHERE user_id = ?1",
            [user_id],
            |row| row.get(0),
        )
        .expect("read credential generation")
}

fn expected_session_id(user_id: &str, secret: &[u8], generation: i64) -> String {
    let secret_digest: [u8; 32] = Sha256::digest(secret).into();
    derive_session_id(user_id, &secret_digest, generation)
}

fn emit_runtime_probe(id: &str) {
    eprintln!("AUTHORITY_TRANSITION_RUNTIME_PROBE: {id}");
}

#[test]
fn authority_transition_runtime_01_forgotten_scope_cannot_commit_or_outlive_wrapper() {
    let mut guarded = guarded(1, 2);
    execute_verified_effect(
        &mut guarded,
        |transaction| verify_and_derive_password_session(transaction, proof(USER_A, SECRET_A)),
        |transaction, derived| {
            let commit = writers::transaction_control_sql(transaction)
                .expect_err("transaction-control SQL must be refused in the scope");
            assert!(denied(&commit), "unexpected COMMIT refusal: {commit:?}");
            assert_eq!(writers::insert_password_session(transaction, derived)?, 1);

            let forgotten = ManuallyDrop::new(transaction);
            std::mem::forget(forgotten);
            Ok(())
        },
    )
    .expect("wrapper commits the exact fixed write");

    let after_scope =
        writers::unscoped_session_insert(&guarded.connection, "liveness-after-scope", USER_A)
            .expect_err("FORGOTTEN_SCOPE_MUTATION authorized after wrapper commit");
    assert!(
        denied(&after_scope),
        "unexpected liveness refusal: {after_scope:?}"
    );
    assert_eq!(
        sessions(&guarded.connection),
        vec![(
            expected_session_id(USER_A, SECRET_A, 7),
            USER_A.to_owned(),
            7
        )]
    );
    emit_runtime_probe("01-transaction-liveness");
}

#[test]
fn authority_transition_runtime_02_scope_on_a_cannot_authorize_connection_b() {
    let mut first = guarded(3, 4);
    let second = guarded(5, 6);

    execute_verified_effect(
        &mut first,
        |transaction| verify_and_derive_password_session(transaction, proof(USER_A, SECRET_A)),
        |_transaction, _derived| {
            let error =
                writers::unscoped_session_insert(&second.connection, "cross-installed", USER_A)
                    .expect_err("SHARED_CONNECTION_STATE_MUTATION armed connection B");
            assert!(
                denied(&error),
                "unexpected cross-connection refusal: {error:?}"
            );
            Ok(())
        },
    )
    .expect("empty connection-A probe transaction commits");

    assert!(!Arc::ptr_eq(
        &first.authorizer_state,
        &second.authorizer_state
    ));
    assert!(sessions(&second.connection).is_empty());
    emit_runtime_probe("02-connection-ownership");
}

#[test]
fn authority_transition_runtime_03_prepared_statement_cannot_execute_after_scope() {
    let mut guarded = guarded(7, 8);
    execute_verified_effect(
        &mut guarded,
        |transaction| verify_and_derive_password_session(transaction, proof(USER_A, SECRET_A)),
        |transaction, _derived| {
            let statement = writers::prime_cached_session_insert(transaction)?;
            drop(statement);
            Ok(())
        },
    )
    .expect("prepare-only scope commits without a write");

    let error =
        writers::execute_cached_session_insert(&guarded.connection, "execute-after-authority")
            .expect_err("STATEMENT_CACHE_MUTATION executed after scope exit");
    assert!(
        denied(&error),
        "unexpected cached-statement refusal: {error:?}"
    );
    assert!(sessions(&guarded.connection).is_empty());
    emit_runtime_probe("03-prepare-execution-lifetime");
}

#[test]
fn authority_transition_runtime_04_schema_conflict_replace_cannot_replace_predecessor() {
    let connection = InitializedConnection::private_memory().expect("open hostile conflict schema");
    initialize_schema(&connection, [9; 32], [10; 32], "ON CONFLICT REPLACE");
    let attacked_id = expected_session_id(USER_A, SECRET_A, 7);
    connection
        .execute(
            "INSERT INTO _auth_sessions(id, user_id, assurance_generation) VALUES(?1, ?2, ?3)",
            params![&attacked_id, USER_B, 11_i64],
        )
        .expect("seed foreign predecessor at the derived write key");
    let mut guarded = GuardedConnection::from_initialized(connection)
        .expect("schema-level conflict policy is independently overridden at effect time");

    let result = issue_password_session(&mut guarded, proof(USER_A, SECRET_A));
    if let Err(error) = &result {
        assert!(
            matches!(
                error,
                AuthorityTransitionError::Sqlite(rusqlite::Error::SqliteFailure(inner, _))
                    if inner.code == ErrorCode::ConstraintViolation
            ),
            "unexpected duplicate refusal: {error:?}"
        );
    }
    assert_eq!(
        sessions(&guarded.connection),
        vec![(attacked_id, USER_B.to_owned(), 11)],
        "SCHEMA_CONFLICT_REPLACE_MUTATION replaced the predecessor"
    );
    emit_runtime_probe("04-schema-conflict-abort");
}

#[test]
fn authority_transition_runtime_05_write_key_and_subject_derive_from_credential_row() {
    let mut guarded = guarded(11, 12);
    issue_password_session(&mut guarded, proof("USER-A", SECRET_A))
        .expect("case-folded selector verifies the canonical credential row");
    assert_eq!(
        sessions(&guarded.connection),
        vec![(
            expected_session_id(USER_A, SECRET_A, 7),
            USER_A.to_owned(),
            7
        )],
        "SUPPLIED_SELECTOR_MUTATION reached durable successor state"
    );

    let error = issue_password_session(&mut guarded, proof(USER_B, SECRET_A))
        .expect_err("user A's secret must not join caller-selected user B");
    assert!(matches!(error, AuthorityTransitionError::ProofRefused));
    emit_runtime_probe("05-row-derived-successor");
}

#[test]
fn authority_transition_runtime_06_stale_generation_cannot_reactivate_scope() {
    let mut guarded = guarded(13, 14);
    issue_password_session(&mut guarded, proof(USER_A, SECRET_A))
        .expect("advance wrapper-owned lifecycle to generation one");
    execute_verified_effect(
        &mut guarded,
        |transaction| verify_and_derive_password_session(transaction, proof(USER_B, SECRET_B)),
        |transaction, _derived| {
            let error =
                writers::stale_generation_session_insert(transaction, "stale-generation", USER_A)
                    .expect_err(
                        "SCOPE_GENERATION_MUTATION accepted generation 1 during generation 2",
                    );
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
            .authorizer_state
            .transition
            .lock()
            .expect("authorizer cell")
            .phase,
        ScopePhase::Idle { generation: 2 }
    ));
    assert_eq!(sessions(&guarded.connection).len(), 1);
    emit_runtime_probe("06-wrapper-generation");
}

#[test]
fn authority_transition_runtime_07_conflict_and_upsert_matrix_is_refused_unscoped() {
    let connection = initialized_connection([15; 32], [16; 32]);
    connection
        .execute(
            "INSERT INTO _auth_sessions(id, user_id, assurance_generation)
             VALUES('matrix', ?1, 7)",
            [USER_B],
        )
        .expect("seed the conflicting protected predecessor");
    let guarded = GuardedConnection::from_initialized(connection)
        .expect("activate the conflict-matrix connection owner");
    let attacks = [
        (
            "insert-or-replace",
            "INSERT OR REPLACE INTO _auth_sessions(id, user_id, assurance_generation)
             VALUES('matrix', 'attacker', 99)",
        ),
        (
            "upsert-do-update",
            "INSERT INTO _auth_sessions(id, user_id, assurance_generation)
             VALUES('matrix', 'attacker', 99)
             ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id",
        ),
        (
            "insert-or-ignore",
            "INSERT OR IGNORE INTO _auth_sessions(id, user_id, assurance_generation)
             VALUES('matrix', 'attacker', 99)",
        ),
        (
            "upsert-do-nothing",
            "INSERT INTO _auth_sessions(id, user_id, assurance_generation)
             VALUES('matrix', 'attacker', 99) ON CONFLICT(id) DO NOTHING",
        ),
        (
            "update-or-replace",
            "UPDATE OR REPLACE _auth_sessions SET user_id = 'attacker' WHERE id = 'matrix'",
        ),
    ];
    for (label, sql) in attacks {
        let error = match guarded.connection.execute(sql, []) {
            Ok(_) => panic!("UNSCOPED_CONFLICT_MUTATION {label} unexpectedly executed"),
            Err(error) => error,
        };
        assert!(
            denied(&error),
            "{label} produced unexpected refusal: {error:?}"
        );
    }
    assert_eq!(
        sessions(&guarded.connection),
        vec![("matrix".to_owned(), USER_B.to_owned(), 7)]
    );
    emit_runtime_probe("07-conflict-upsert-matrix");
}

#[test]
fn authority_transition_runtime_08_casefolded_trigger_attack_is_closed() {
    let connection =
        InitializedConnection::private_memory().expect("open casefold attack database");
    connection
        .execute_batch(
            "CREATE TABLE _snapback_authorization_publication_guard_v1(
                 singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                 durable_origin BLOB NOT NULL,
                 resource_binding BLOB NOT NULL,
                 state TEXT NOT NULL CHECK(state IN ('operational', 'maintenance'))
             );
             CREATE TABLE _AUTH_PASSWORD_CREDENTIALS(
                 user_id TEXT PRIMARY KEY COLLATE NOCASE,
                 secret_digest BLOB NOT NULL,
                 assurance_generation INTEGER NOT NULL
             );
             CREATE TABLE _auth_sessions(
                 id TEXT PRIMARY KEY,
                 user_id TEXT NOT NULL,
                 assurance_generation INTEGER NOT NULL
             );
             CREATE TABLE ordinary(id TEXT PRIMARY KEY, value TEXT);
             CREATE TRIGGER hostile AFTER INSERT ON _auth_sessions BEGIN
                 UPDATE _AUTH_PASSWORD_CREDENTIALS
                 SET assurance_generation = 99 WHERE user_id = NEW.user_id;
             END;",
        )
        .expect("create exact casefold trigger attack");
    seed_resource_and_credentials(&connection, [17; 32], [18; 32]);

    match GuardedConnection::from_initialized(connection) {
        Err(AuthorityTransitionError::HostileSchema(reason)) => assert!(!reason.is_empty()),
        Err(error) => panic!("unexpected casefold schema refusal: {error:?}"),
        Ok(mut guarded) => {
            let result = issue_password_session(&mut guarded, proof(USER_A, SECRET_A));
            let generation = credential_generation(&guarded.connection, USER_A);
            assert!(
                result.is_err() || generation == 7,
                "CASEFOLD_SCHEMA_MUTATION changed assurance_generation to {generation}"
            );
        }
    }
    emit_runtime_probe("08-casefolded-trigger");
}

#[test]
fn authority_transition_runtime_09_suppressing_trigger_cannot_report_success() {
    let connection = initialized_connection([19; 32], [20; 32]);
    connection
        .execute_batch(
            "CREATE TRIGGER suppress_session BEFORE INSERT ON _auth_sessions BEGIN
                 SELECT RAISE(IGNORE);
             END;",
        )
        .expect("create suppressing trigger attack");

    let error = match GuardedConnection::from_initialized(connection) {
        Ok(_) => panic!("SUPPRESSING_TRIGGER_SCHEMA_MUTATION accepted the hostile trigger"),
        Err(error) => error,
    };
    assert!(matches!(error, AuthorityTransitionError::HostileSchema(_)));

    // Exercise the independent effect-time defense with the exact hostile
    // durable schema. This constructor exists only in unit-test compilation
    // and remains inside the evidence sibling that owns raw SQLite custody.
    let effect_connection = initialized_connection([19; 32], [20; 32]);
    effect_connection
        .execute_batch(
            "CREATE TRIGGER suppress_session BEFORE INSERT ON _auth_sessions BEGIN
                 SELECT RAISE(IGNORE);
             END;",
        )
        .expect("recreate suppressing trigger for effect-time proof");
    let mut guarded = guarded_from_hostile_schema_for_effect_time_test(effect_connection)
        .expect("unit-only activation reaches the independent row-count defense");
    let error = issue_password_session(&mut guarded, proof(USER_A, SECRET_A))
        .expect_err("SUPPRESSING_TRIGGER_COUNT_MUTATION reported success with zero rows");
    assert!(matches!(
        error,
        AuthorityTransitionError::UnexpectedWriteCount {
            expected: 1,
            actual: 0
        }
    ));
    assert!(sessions(&guarded.connection).is_empty());
    emit_runtime_probe("09-suppressing-trigger");
}

#[test]
fn authority_transition_runtime_10_foreign_key_cascade_into_protected_row_is_denied() {
    let connection = initialized_connection([21; 32], [22; 32]);
    connection
        .execute_batch(
            "DROP TABLE _auth_sessions;
             INSERT INTO ordinary(id, value) VALUES('parent-a', 'before');
             CREATE TABLE _auth_sessions(
                 id TEXT PRIMARY KEY,
                 user_id TEXT NOT NULL REFERENCES ordinary(id) ON UPDATE CASCADE,
                 assurance_generation INTEGER NOT NULL
             );
             INSERT INTO _auth_sessions(id, user_id, assurance_generation)
             VALUES('fk-victim', 'parent-a', 7);
             PRAGMA foreign_keys = ON;",
        )
        .expect("create foreign-key cascade attack");
    let guarded = GuardedConnection::from_initialized(connection)
        .expect("foreign keys are independently enforced at effect time");

    let error = guarded
        .connection
        .execute(
            "UPDATE ordinary SET id = 'parent-b' WHERE id = 'parent-a'",
            [],
        )
        .expect_err("FK_CASCADE_MUTATION changed a protected row");
    assert!(denied(&error), "unexpected FK-cascade refusal: {error:?}");
    assert_eq!(
        sessions(&guarded.connection),
        vec![("fk-victim".to_owned(), "parent-a".to_owned(), 7)]
    );
    emit_runtime_probe("10-foreign-key-cascade");
}

#[test]
fn authority_transition_runtime_11_virtual_table_is_refused_before_activation() {
    let connection = initialized_connection([23; 32], [24; 32]);
    connection
        .execute_batch("CREATE VIRTUAL TABLE hostile_search USING fts5(body);")
        .expect("create pre-activation virtual table attack");
    let error = match GuardedConnection::from_initialized(connection) {
        Ok(_) => panic!("VIRTUAL_TABLE_MUTATION activated virtual and shadow tables"),
        Err(error) => error,
    };
    assert!(
        matches!(error, AuthorityTransitionError::HostileSchema(_)),
        "unexpected virtual-table refusal: {error:?}"
    );
    emit_runtime_probe("11-virtual-table-preactivation");
}

#[test]
fn authority_transition_runtime_12_existing_writer_policy_remains_composed() {
    let connection = initialized_connection([25; 32], [26; 32]);
    connection
        .arm_covered_table_for_test("ordinary")
        .expect("install the first 24-lane writer policy callback");
    let guarded = GuardedConnection::from_initialized(connection)
        .expect("replace the callback only with the composed state owner");

    let result = guarded.connection.execute(
        "INSERT INTO ordinary(id, value) VALUES('bypass', 'written')",
        [],
    );
    if let Err(error) = &result {
        assert!(
            denied(error),
            "unexpected composed-policy refusal: {error:?}"
        );
    }
    let rows: i64 = guarded
        .connection
        .query_row("SELECT COUNT(*) FROM ordinary", [], |row| row.get(0))
        .expect("read composed-policy durable projection");
    assert_eq!(
        rows, 0,
        "DISCARDED_WRITER_POLICY_MUTATION wrote an uncovered row"
    );
    emit_runtime_probe("12-policy-composition");
}

#[test]
fn authority_transition_runtime_13_close_and_address_reuse_gets_fresh_state() {
    let mut addresses = HashSet::new();
    let mut reused = false;
    for iteration in 0..64_u8 {
        let guarded = guarded(iteration.wrapping_add(27), iteration.wrapping_add(91));
        // SAFETY: the handle is observed only as an address while the owning
        // connection remains alive; it is never dereferenced or retained.
        let address = unsafe { guarded.connection.handle() as usize };
        reused |= !addresses.insert(address);
        let error = writers::unscoped_session_insert(&guarded.connection, "reused", USER_A)
            .expect_err("ADDRESS_REUSE_STATE_MUTATION started a new handle active");
        assert!(denied(&error));
        drop(guarded);
        if reused {
            break;
        }
    }
    assert!(
        reused,
        "SQLite allocator did not reuse a closed handle in 64 attempts"
    );
    emit_runtime_probe("13-close-address-reuse");
}

#[test]
fn authority_transition_runtime_14_resource_guard_is_reread_inside_effect_transaction() {
    let mut guarded = guarded(29, 30);
    mutate_resource_guard_for_effect_time_test(&guarded, &[31; 32])
        .expect("unit-only raw-custody hook changes the guard after acquisition");

    let error = issue_password_session(&mut guarded, proof(USER_A, SECRET_A))
        .expect_err("RESOURCE_GUARD_REREAD_MUTATION trusted the acquisition-time guard");
    assert!(matches!(
        error,
        AuthorityTransitionError::ResourceGuardChanged
    ));
    assert!(sessions(&guarded.connection).is_empty());
    emit_runtime_probe("14-resource-guard-reread");
}

#[test]
fn authority_transition_runtime_15_second_handle_cannot_author_trusted_facts_or_effects() {
    let directory = tempfile::tempdir().expect("second-handle tempdir");
    let path = directory.path().join("authority-transition.sqlite3");
    let bootstrap = InitializedConnection::shared_file_for_rejection_probe(&path)
        .expect("open bootstrap connection");
    initialize_schema(&bootstrap, [32; 32], [33; 32], "");
    drop(bootstrap);

    let initialized = InitializedConnection::shared_file_for_rejection_probe(&path)
        .expect("open file-backed rejection probe");
    match GuardedConnection::from_initialized(initialized) {
        Err(AuthorityTransitionError::SharedFileCustodyUnproven) => {}
        Err(error) => panic!("unexpected shared-file refusal: {error:?}"),
        Ok(mut guarded) => {
            let external = Connection::open(&path).expect("open hostile second connection");
            let attacker_digest: [u8; 32] = Sha256::digest(b"attacker secret").into();
            external
                .execute_batch(
                    "ALTER TABLE _auth_password_credentials RENAME TO caller_replaced_credentials;
                     CREATE TABLE caller_credentials(
                         user_id TEXT PRIMARY KEY,
                         secret_digest BLOB NOT NULL,
                         assurance_generation INTEGER NOT NULL
                     );
                     CREATE VIEW _auth_password_credentials AS
                         SELECT user_id, secret_digest, assurance_generation FROM caller_credentials;",
                )
                .expect("replace the trusted credential relation after activation");
            external
                .execute(
                    "INSERT INTO caller_credentials(user_id, secret_digest, assurance_generation)
                     VALUES(?1, ?2, 31337)",
                    params![USER_A, attacker_digest.as_slice()],
                )
                .expect("seed caller-authored credential fact");
            let direct = external.execute(
                "INSERT INTO _auth_sessions(id, user_id, assurance_generation)
                 VALUES('second-handle-direct', ?1, 31337)",
                [USER_A],
            );
            let issued = issue_password_session(&mut guarded, proof(USER_A, b"attacker secret"));
            let durable_sessions = sessions(&guarded.connection);
            assert!(
                direct.is_err() && issued.is_err() && durable_sessions.is_empty(),
                "SECOND_HANDLE_CUSTODY_MUTATION direct={direct:?} issued={issued:?} rows={durable_sessions:?}"
            );
        }
    }
    emit_runtime_probe("15-second-handle-custody");
}

#[test]
fn authority_transition_runtime_16_writer_policy_limb_cannot_be_swapped_or_disarmed() {
    let initialized = initialized_connection([34; 32], [35; 32]);
    initialized
        .arm_covered_table_for_test("ordinary")
        .expect("arm the connection-owned writer policy");
    let guarded = GuardedConnection::from_initialized(initialized)
        .expect("activation consumes the connection and its owned policy together");
    let write = guarded.connection.execute(
        "INSERT INTO ordinary(id, value) VALUES('owned', 'written')",
        [],
    );
    let rows: i64 = guarded
        .connection
        .query_row("SELECT COUNT(*) FROM ordinary", [], |row| row.get(0))
        .expect("read owned-policy projection");
    assert!(
        write.is_err() && rows == 0,
        "WRITER_POLICY_OWNERSHIP_MUTATION write={write:?} rows={rows}"
    );
    emit_runtime_probe("16-writer-policy-ownership");
}
