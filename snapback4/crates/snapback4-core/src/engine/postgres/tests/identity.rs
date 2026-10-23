use super::super::WriteMode;
use super::super::store::{Store, Tx};
use super::authority_engine;
use crate::identity::test_cases::{self, IdentityFixture, RotationFixture};
use crate::{
    authority::AuthorityTransaction,
    identity::{IdentityStore, IdentityTransaction, Session, SessionScope, digest},
};
use std::cell::RefCell;

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn identity_insert_and_logout_round_trip() {
    let mut engine = authority_engine();
    let session = Session {
        principal: "member:pg".into(),
        kind: "member".into(),
        token: "pg-token".into(),
        expires_at: 9_000_000_000,
        scope: SessionScope::Full,
        cap_expires_at: None,
    };
    let store = RefCell::new(&mut engine.store);
    store
        .insert_identity_session_atomic(&session, 1_000)
        .unwrap();
    assert_eq!(
        store
            .identity_session_expiry(&digest(&session.token))
            .unwrap(),
        Some(session.expires_at)
    );
    store
        .close_identity_session(&digest(&session.token))
        .unwrap();
    assert_eq!(
        store
            .identity_session_expiry(&digest(&session.token))
            .unwrap(),
        None
    );
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn identity_transaction_writes_require_the_existing_head_fence() {
    let mut engine = authority_engine();
    let session = Session {
        principal: "member:pg".into(),
        kind: "member".into(),
        token: "pg-token".into(),
        expires_at: 9_000,
        scope: SessionScope::Full,
        cap_expires_at: None,
    };
    for mode in [None, Some(WriteMode::Serializable)] {
        let tx = engine.store.transaction(mode).unwrap();
        assert!(
            tx.insert_identity_session(&session, 1_000)
                .unwrap_err()
                .to_string()
                .contains("insert identity session requires the serialized shared-head fence")
        );
        assert!(
            tx.session_by_digest(&digest(&session.token))
                .unwrap()
                .is_none()
        );
        let record = crate::identity::SessionMintRecord {
            input_digest: "input".into(),
            scope: "full".into(),
            principal: session.principal.clone(),
            kind: session.kind.clone(),
            days: 7,
            expires_at: session.expires_at,
            family: "family".into(),
            principal_generation: 0,
        };
        for (operation, error) in [
            ("insert read session", tx.insert_read_session(&session, 1_000, None).unwrap_err()),
            ("initialize mint binding scope", tx.initialize_mint_binding_scope().unwrap_err()),
            ("record session mint", tx.record_session_mint("invocation", "intent", &record).unwrap_err()),
            ("set identity session family", tx.set_identity_session_family("digest", "family").unwrap_err()),
        ] {
            assert_eq!(error.to_string(), format!("E_STORE: Postgres {operation} requires the serialized shared-head fence"));
        }
        tx.rollback().unwrap();
    }
}

impl IdentityFixture for RefCell<&mut Store> {
    type Transaction<'a> = Tx<'a>;
    fn with_identity_tx<T>(
        &self,
        run: impl FnOnce(&Tx<'_>) -> Result<T, crate::RuntimeError>,
    ) -> Result<T, crate::RuntimeError> {
        let mut store = self.borrow_mut();
        let tx = store.transaction(Some(WriteMode::Serialized))?;
        let result = run(&tx)?;
        tx.commit()?;
        Ok(result)
    }
    fn principal_facts(&self, principal: &str) -> Option<(String, Option<String>, i64)> {
        self.with_identity_tx(|tx| {
            Ok(tx
                .query(
                    "SELECT kind,name,created_at FROM _principals WHERE id = $1",
                    &[&principal],
                )?
                .first()
                .map(|row| (row.get(0), row.get(1), row.get(2))))
        })
        .unwrap()
    }
    fn principal_ids(&self) -> Vec<String> {
        self.with_identity_tx(|tx| {
            Ok(tx
                .query("SELECT id FROM _principals ORDER BY id", &[])?
                .iter()
                .map(|row| row.get(0))
                .collect())
        })
        .unwrap()
    }
    fn identity_row_counts(&self) -> [i64; 6] {
        self.with_identity_tx(|tx| {
            let row = &tx.query("SELECT (SELECT count(*) FROM _principals), (SELECT count(*) FROM _principal_generations), (SELECT count(*) FROM _sessions), (SELECT count(*) FROM _read_sessions), (SELECT count(*) FROM _credentials), (SELECT count(*) FROM _session_mint_bindings)", &[])?[0];
            Ok([row.get(0), row.get(1), row.get(2), row.get(3), row.get(4), row.get(5)])
        }).unwrap()
    }
    fn null_full_family(&self, digest: &str) {
        self.with_identity_tx(|tx| {
            tx.execute(
                "UPDATE _sessions SET family = NULL WHERE token_digest = $1",
                &[&digest],
            )?;
            Ok(())
        })
        .unwrap();
    }
    fn set_worker_meta(&self, key: &str, value: &str) {
        self.with_identity_tx(|tx| { tx.execute("INSERT INTO _meta(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", &[&key,&value])?; Ok(()) }).unwrap();
    }
    fn worker_meta(&self, key: &str) -> Option<String> {
        self.with_identity_tx(|tx| {
            Ok(tx
                .query("SELECT value FROM _meta WHERE key = $1", &[&key])?
                .first()
                .map(|r| r.get(0)))
        })
        .unwrap()
    }
}

impl RotationFixture for RefCell<&mut Store> {
    fn seed_read_family(&self, session: &Session, generation: i64) {
        self.with_identity_tx(|tx| {
            tx.insert_read_session(session, 1_000, Some((&digest(&session.token), generation)))
        })
        .unwrap();
    }
    fn drop_read_sessions(&self) {
        self.with_identity_tx(|tx| tx.batch("DROP TABLE IF EXISTS _read_sessions"))
            .unwrap();
    }
    fn read_sessions_present(&self) -> bool {
        self.with_identity_tx(|tx| {
            Ok(tx.query("SELECT to_regclass('_read_sessions') IS NOT NULL", &[])?[0].get(0))
        })
        .unwrap()
    }
}

macro_rules! shared_case {
    ($name:ident, $case:ident) => {
        #[test]
        #[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
        fn $name() {
            let mut engine = authority_engine();
            test_cases::$case(&RefCell::new(&mut engine.store));
        }
    };
}
shared_case!(shared_diagnostics, assert_diagnostics);
shared_case!(shared_refresh_rollback, assert_refresh_rollback);
shared_case!(shared_credential_policy, assert_credential_policy);
shared_case!(shared_worker_families, assert_worker_families);
shared_case!(shared_transaction_contract, assert_transaction_contract);
shared_case!(shared_mint_bindings, assert_mint_bindings);
shared_case!(
    shared_conflicts_and_collation,
    assert_conflicts_and_collation
);
shared_case!(
    shared_nulls_counts_and_timestamps,
    assert_nulls_counts_and_timestamps
);
shared_case!(shared_read_family_isolation, assert_read_family_isolation);
shared_case!(shared_worker_markers, assert_worker_markers);
shared_case!(shared_digest_in_both_session_tables_refused, assert_digest_in_both_session_tables_refused);
shared_case!(shared_nul_inputs_refused, assert_nul_inputs_refused);
shared_case!(shared_convenience_insert_conflict, assert_convenience_insert_conflict);
shared_case!(shared_latest_family_ties, assert_latest_family_ties);

macro_rules! refusal_case {
    ($name:ident, $refusal:ident) => {
        #[test]
        #[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
        fn $name() {
            let mut engine = authority_engine();
            test_cases::assert_read_rotation_refusal(
                &RefCell::new(&mut engine.store),
                test_cases::RotationRefusal::$refusal,
            );
        }
    };
}
refusal_case!(shared_read_rotation_expired_refusal, Expired);
refusal_case!(shared_read_rotation_cap_expired_refusal, CapExpired);
refusal_case!(
    shared_read_rotation_stale_generation_refusal,
    StaleGeneration
);
refusal_case!(shared_read_rotation_missing_table_refusal, MissingTable);

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn identity_attach_installs_missing_tables_and_reopens_without_changing_rows() {
    let mut engine = authority_engine();
    let name: String = engine
        .store
        .client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0);
    let session = Session {
        principal: "member:legacy".into(),
        kind: "member".into(),
        token: "legacy-token".into(),
        expires_at: 9_000_000_000,
        scope: SessionScope::Full,
        cap_expires_at: None,
    };
    RefCell::new(&mut engine.store)
        .insert_identity_session_atomic(&session, 1_000)
        .unwrap();
    let tx = engine
        .store
        .transaction(Some(WriteMode::Serialized))
        .unwrap();
    tx.batch("DROP TABLE _principals, _credentials, _session_mint_bindings, _meta; DROP INDEX _sessions_expiry, _sessions_family")
        .unwrap();
    tx.commit().unwrap();
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private test-postgres.sh database");
    let mut reopened = super::super::PostgresEngine::open(
        postgres::Client::connect(&url, postgres::NoTls).unwrap(),
        &name,
    )
    .unwrap();
    let tx = reopened.store.transaction(None).unwrap();
    for (table, column) in [
        ("_principals", "id"),
        ("_credentials", "principal"),
        ("_credentials", "email"),
        ("_session_mint_bindings", "invocation"),
        ("_session_mint_bindings", "intent"),
        ("_session_mint_bindings", "principal"),
        ("_session_mint_bindings", "family"),
        ("_meta", "key"),
    ] {
        let collation: String = tx.query(
            "SELECT c.collname FROM pg_attribute a JOIN pg_collation c ON c.oid = a.attcollation WHERE a.attrelid = to_regclass($1) AND a.attname = $2", &[&table, &column],
        ).unwrap()[0].get(0);
        assert_eq!(collation, "C", "{table}.{column}");
    }
    assert_eq!(
        tx.session_by_digest(&digest(&session.token))
            .unwrap()
            .unwrap()
            .expires_at,
        session.expires_at
    );
    tx.rollback().unwrap();
    drop(reopened);
    let mut reopened = super::super::PostgresEngine::open(
        postgres::Client::connect(&url, postgres::NoTls).unwrap(),
        &name,
    )
    .unwrap();
    assert_eq!(
        RefCell::new(&mut reopened.store)
            .identity_session_expiry(&digest(&session.token))
            .unwrap(),
        Some(session.expires_at)
    );
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn identity_store_writes_wait_for_the_head_before_running_callbacks() {
    let mut owner = authority_engine();
    let name: String = owner
        .store
        .client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0);
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private test-postgres.sh database");
    let mut peer = super::super::PostgresEngine::open(
        postgres::Client::connect(&url, postgres::NoTls).unwrap(),
        &name,
    )
    .unwrap();
    peer.store
        .client
        .batch_execute("SET lock_timeout = '50ms'")
        .unwrap();
    let held = owner
        .store
        .transaction(Some(WriteMode::Serialized))
        .unwrap();
    let mut minted = false;
    assert!(
        RefCell::new(&mut peer.store)
            .mint_supervised_child(true, 1_000, 7, || {
                minted = true;
                unreachable!("head wait must happen before minting")
            })
            .is_err()
    );
    assert!(!minted);
    held.rollback().unwrap();
    let store = RefCell::new(&mut peer.store);
    test_cases::assert_worker_families(&store);
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn identity_read_insert_does_not_block_peer_authority_reads() {
    let mut owner = authority_engine();
    let name: String = owner.store.client.query_one("SELECT current_schema()", &[]).unwrap().get(0);
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private test-postgres.sh database");
    let mut peer = super::super::PostgresEngine::open(
        postgres::Client::connect(&url, postgres::NoTls).unwrap(), &name,
    ).unwrap();
    let existing = Session {
        principal: "member:existing".into(), kind: "member".into(), token: "ro.existing".into(),
        expires_at: 9_000, cap_expires_at: Some(10_000), scope: SessionScope::Read,
    };
    RefCell::new(&mut owner.store).insert_identity_session_atomic(&existing, 1_000).unwrap();
    peer.store.client.batch_execute("SET lock_timeout = '100ms'").unwrap();
    let held = owner.store.transaction(Some(WriteMode::Serialized)).unwrap();
    let inserted = Session { principal: "member:inserted".into(), token: "ro.inserted".into(), ..existing.clone() };
    held.insert_read_session(&inserted, 1_001, None).unwrap();
    // A still owns its writer and relation locks. Both B readers must complete
    // before A releases it.
    assert_eq!(RefCell::new(&mut peer.store).identity_session_expiry(&digest(&existing.token)).unwrap(), Some(existing.expires_at));
    let reader = peer.store.transaction(None).unwrap();
    let record = reader.session_by_digest(&digest(&existing.token)).unwrap().unwrap();
    assert_eq!(record.scope, SessionScope::Read);
    assert_eq!(record.expires_at, existing.expires_at);
    reader.rollback().unwrap();
    // Probe relation-lock compatibility independently of the shared head. A
    // no-op CREATE INDEX retains a SHARE lock that blocks this ordinary writer
    // lock; the insert itself needs only ROW EXCLUSIVE, compatible with peers.
    peer.store.client.batch_execute("BEGIN; LOCK TABLE _read_sessions IN ROW EXCLUSIVE MODE NOWAIT; ROLLBACK").unwrap();
    held.rollback().unwrap();
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn identity_attach_refuses_incompatible_existing_tables() {
    for (table, drift) in [
        ("_principals", "ALTER TABLE _principals SET UNLOGGED"),
        ("_principals", "CREATE RULE discard AS ON INSERT TO _principals DO INSTEAD NOTHING"),
        ("_credentials", "ALTER TABLE _credentials SET UNLOGGED"),
        ("_credentials", "CREATE RULE discard AS ON INSERT TO _credentials DO INSTEAD NOTHING"),
        ("_session_mint_bindings", "ALTER TABLE _session_mint_bindings SET UNLOGGED"),
        ("_session_mint_bindings", "CREATE RULE discard AS ON INSERT TO _session_mint_bindings DO INSTEAD NOTHING"),
        ("_read_sessions", "ALTER TABLE _read_sessions SET UNLOGGED"),
        ("_read_sessions", "CREATE RULE discard AS ON INSERT TO _read_sessions DO INSTEAD NOTHING"),
        ("_sessions", "ALTER TABLE _sessions SET UNLOGGED"),
        ("_sessions", "CREATE RULE discard AS ON INSERT TO _sessions DO INSTEAD NOTHING"),
        ("_principal_generations", "ALTER TABLE _principal_generations SET UNLOGGED"),
        ("_principal_generations", "CREATE RULE discard AS ON INSERT TO _principal_generations DO INSTEAD NOTHING"),
        ("_meta", "ALTER TABLE _meta SET UNLOGGED"),
        ("_meta", "CREATE RULE discard AS ON INSERT TO _meta DO INSTEAD NOTHING"),
        ("_principals", "ALTER TABLE _principals ALTER COLUMN created_at TYPE TEXT"),
        ("_credentials", "ALTER TABLE _credentials ALTER COLUMN email TYPE TEXT COLLATE \"default\""),
        ("_session_mint_bindings", "ALTER TABLE _session_mint_bindings DROP COLUMN scope"),
        ("_read_sessions", "ALTER TABLE _read_sessions DROP COLUMN cap_expires_at"),
        ("_credentials", "ALTER TABLE _credentials DROP CONSTRAINT _credentials_email_key"),
        ("_principals", "ALTER TABLE _principals DROP CONSTRAINT _principals_pkey; ALTER TABLE _principals ADD PRIMARY KEY(id) DEFERRABLE INITIALLY IMMEDIATE"),
        ("_credentials", "ALTER TABLE _credentials DROP CONSTRAINT _credentials_email_key; ALTER TABLE _credentials ADD UNIQUE(email) DEFERRABLE INITIALLY DEFERRED"),
        ("_principals", "ALTER TABLE _principals ADD UNIQUE(kind)"),
        ("_principals", "CREATE UNIQUE INDEX unexpected_unique ON _principals(kind)"),
        ("_session_mint_bindings", "ALTER TABLE _session_mint_bindings ALTER COLUMN scope SET DEFAULT 'read'"),
        ("_sessions", "DROP INDEX _sessions_expiry; CREATE INDEX _sessions_expiry ON _sessions(principal)"),
        ("_sessions", "DROP INDEX _sessions_family; CREATE UNIQUE INDEX _sessions_family ON _sessions(principal,family,expires_at)"),
        ("_read_sessions", "DROP INDEX _read_sessions_family; CREATE INDEX _read_sessions_family ON _read_sessions(principal COLLATE \"default\",family,expires_at)"),
    ] {
        let mut engine = authority_engine();
        let name: String = engine.store.client.query_one("SELECT current_schema()", &[]).unwrap().get(0);
        let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
        tx.batch(drift).unwrap();
        tx.commit().unwrap();
        let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private test-postgres.sh database");
        let result = super::super::PostgresEngine::open(
            postgres::Client::connect(&url, postgres::NoTls).unwrap(), &name,
        );
        let error = match result { Ok(_) => panic!("attach admitted {drift}"), Err(error) => error };
        assert!(matches!(&error, crate::RuntimeError::Store(_)), "{error}");
        assert!(error.to_string().contains(&format!("SNAPBACK_IDENTITY_SCHEMA: {table}:")), "{error}");
    }
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn identity_rotation_races_revoke_through_the_head_fence() {
    use std::sync::Arc;
    use crate::store::test_race::FenceRace;
    let mut owner = authority_engine();
    let name: String = owner.store.client.query_one("SELECT current_schema()", &[]).unwrap().get(0);
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let mut peer = super::super::PostgresEngine::open(
        postgres::Client::connect(&url, postgres::NoTls).unwrap(), &name,
    ).unwrap();
    peer.store.client.batch_execute("SET statement_timeout = '10s'").unwrap();
    // This third connection only observes locks; both competing writes use
    // IdentityStore operations, with no harness SQL holding a writer lock.
    let observer = postgres::Client::connect(&url, postgres::NoTls).unwrap();
    let race = Arc::new(FenceRace::postgres(&mut owner.store.client, &mut peer.store.client, observer));
    let old = Session { principal: "member:race".into(), kind: "member".into(),
        token: "ro.race-old".into(), expires_at: 9_000, scope: SessionScope::Read, cap_expires_at: Some(10_000) };
    let next = Session { token: "ro.race-next".into(), ..old.clone() };
    let old_digest = digest(&old.token);
    let next_digest = digest(&next.token);
    RefCell::new(&mut owner.store).insert_identity_session_atomic(&old, 1_000).unwrap();
    let peer_race = race.clone();
    let principal = old.principal.clone();
    let revoked = std::thread::spawn(move || {
        peer_race.arm_after_begin(false);
        RefCell::new(&mut peer.store).revoke_identity_principal(&principal).unwrap()
    });
    race.arm_after_begin(true);
    let rotated = RefCell::new(&mut owner.store).rotate_read_session(&old_digest, 2_000, |record| {
        assert_eq!(record.principal, old.principal);
        race.after_fence(true).unwrap();
        Ok(Some(next.clone()))
    }).unwrap().unwrap();
    assert_eq!(rotated.token, next.token);
    let pg_removed = revoked.join().unwrap();
    let pg_state = test_cases::rotation_revoke_state(&RefCell::new(&mut owner.store), &old.principal, &old_digest, &next_digest);
    // Compare with SQLite executing the witnessed order: rotation then revoke.
    let sqlite = crate::Store::memory().unwrap();
    sqlite.insert_identity_session_atomic(&old, 1_000).unwrap();
    sqlite.rotate_read_session(&old_digest, 2_000, |_| Ok(Some(next))).unwrap().unwrap();
    let sqlite_removed = sqlite.revoke_identity_principal(&old.principal).unwrap();
    let sqlite_state = test_cases::rotation_revoke_state(&sqlite, &old.principal, &old_digest, &next_digest);
    assert_eq!((pg_removed, pg_state), (sqlite_removed, sqlite_state));
    assert_eq!((pg_removed, pg_state), (1, (1, false, false)));
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn identity_missing_read_storage_requires_reattach_without_writer_ddl() {
    let mut engine = authority_engine();
    let name: String = engine.store.client.query_one("SELECT current_schema()", &[]).unwrap().get(0);
    let store = RefCell::new(&mut engine.store);
    store.drop_read_sessions();
    let read = Session { principal: "member:attach".into(), kind: "member".into(), token: "ro.attach".into(),
        expires_at: 9_000, scope: SessionScope::Read, cap_expires_at: Some(10_000) };
    assert!(store.insert_identity_session_atomic(&read, 1_000).is_err());
    assert!(!store.read_sessions_present(), "ordinary writes must not install schema");
    assert!(store.principal_facts(&read.principal).is_none(), "failed insert must roll back its principal");
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let mut reopened = super::super::PostgresEngine::open(
        postgres::Client::connect(&url, postgres::NoTls).unwrap(), &name,
    ).unwrap();
    let store = RefCell::new(&mut reopened.store);
    store.insert_identity_session_atomic(&read, 1_000).unwrap();
    assert_eq!(store.identity_session_expiry(&digest(&read.token)).unwrap(), Some(read.expires_at));
}

#[test]
#[ignore = "requires private SNAPBACK4_EVAL_POSTGRES"]
fn bound_action_kind_lost_delivery_recovers() {
    let mut e = authority_engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    test_cases::assert_bound_recovery(&tx, false);
    tx.commit().unwrap();
}

#[test]
#[ignore = "requires private SNAPBACK4_EVAL_POSTGRES"]
fn bound_read_only_family_lost_delivery_recovers() {
    let mut e = authority_engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    test_cases::assert_bound_recovery(&tx, true);
    tx.commit().unwrap();
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn authority_facts_equivalence_postgres_generated_matrix() {
    use crate::identity::facts::tests;
    let mut total = 0;
    for read_storage in [false, true] {
        let mut engine = authority_engine();
        if !read_storage {
            let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
            tx.batch("DROP TABLE _read_sessions").unwrap();
            tx.commit().unwrap();
            // Model the read-only attach flag for a legacy store; writable
            // Postgres attach itself installs this table before accepting open.
            engine.store.read_sessions.set(false);
        }
        for case in tests::cases(read_storage) {
            let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
            tx.batch(&case.seed()).unwrap();
            tx.execute("UPDATE _backend SET generation=$1 WHERE singleton", &[&(if case.store_generation_changed { 2_i64 } else { 1_i64 })]).unwrap();
            tests::compare(&tx, &super::super::authority::Baseline(&tx), |digest| tx.session_authority_facts(digest), &case);
            tx.session_authority_facts("digest").unwrap(); // prepare before measuring
            let scope = crate::round_trips::Scope::begin();
            tx.session_authority_facts("digest").unwrap();
            assert_eq!(scope.counts().postgres, if !read_storage && case.state == 2 { 2 } else { 1 });
            drop(scope);
            tx.rollback().unwrap();
            total += 1;
        }
    }
    println!("Postgres authority facts: {total} generated states; hits use one SELECT");
}


#[test]
#[ignore = "requires private SNAPBACK4_EVAL_POSTGRES"]
fn authority_facts_independent_postgres_connection_discovers_storage() {
    let mut writer = authority_engine();
    let name: String = writer.store.client.query_one("SELECT current_schema()::text", &[]).unwrap().get(0);
    let tx = writer.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.batch("DROP TABLE _read_sessions").unwrap();
    tx.commit().unwrap();
    let mut client = postgres::Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), postgres::NoTls).unwrap();
    client.batch_execute(&format!("SET search_path = {}, pg_catalog", super::super::store::namespace(&name).unwrap())).unwrap();
    // A legacy adapter connection attaches before optional storage exists.
    // Use the evaluator adapter on both connections, preserving owner isolation.
    let mut reader_store = Store::new(client);
    assert!(!reader_store.read_sessions.get());
    let held = reader_store.transaction(None).unwrap();
    assert!(held.session_authority_facts("absent").unwrap().sessions.is_empty());
    let session = Session { principal: "member:independent".into(), kind: "member".into(), token: "ro.independent".into(), expires_at: 10000, cap_expires_at: Some(10000), scope: SessionScope::Read };
    let tx = writer.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.install_read_sessions().unwrap();
    tx.insert_read_session(&session, 0, None).unwrap();
    tx.commit().unwrap();
    assert!(held.session_authority_facts(&digest(&session.token)).unwrap().sessions.is_empty(), "repeatable-read snapshot retains absence");
    held.rollback().unwrap();
    let (tx, facts) = reader_store.session_authority_transaction(&digest(&session.token)).unwrap();
    assert!(crate::identity::facts::resolve(&tx, facts, 1000, None).unwrap().is_some());
    tx.rollback().unwrap();
    assert!(reader_store.read_sessions.get());
    let tx = reader_store.transaction(None).unwrap();
    tx.session_authority_facts(&digest(&session.token)).unwrap();
    let scope = crate::round_trips::Scope::begin();
    assert_eq!(tx.session_authority_facts(&digest(&session.token)).unwrap().sessions.len(), 1);
    assert_eq!(scope.counts().postgres, 1);
    drop(scope);
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires private SNAPBACK4_EVAL_POSTGRES"]
fn authority_facts_postgres_installing_savepoint_rollback_reprobes_storage() {
    let mut engine = authority_engine();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.batch("DROP TABLE _read_sessions").unwrap();
    tx.commit().unwrap();
    engine.store.read_sessions.set(false);
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.batch("SAVEPOINT installing").unwrap();
    tx.install_read_sessions().unwrap();
    assert!(tx.read_sessions_installed.get());
    tx.rollback_named("installing").unwrap();
    assert!(!tx.read_sessions_installed.get());
    assert!(tx.session_authority_facts("absent").unwrap().sessions.is_empty());
    tx.commit().unwrap();
    assert!(!engine.store.read_sessions.get());
    // An installation before the savepoint must survive rollback and commit.
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.install_read_sessions().unwrap();
    tx.batch("SAVEPOINT after_install").unwrap();
    tx.rollback_named("after_install").unwrap();
    assert!(tx.read_sessions_installed.get());
    tx.commit().unwrap();
    assert!(engine.store.read_sessions.get());
}

#[test]
#[ignore = "requires private SNAPBACK4_EVAL_POSTGRES"]
fn authority_facts_raw_nul_digest_is_absent_without_querying_postgres() {
    let mut engine = authority_engine();
    let tx = crate::store_port::AnyTx::from_postgres(engine.store.transaction(None).unwrap());
    let scope = crate::round_trips::Scope::begin();
    assert!(crate::identity::resolve_session_tx(&tx, "raw\0digest", 1000, None).unwrap().is_none());
    assert!(tx.session_authority_facts("raw\0digest").unwrap().sessions.is_empty());
    assert_eq!(scope.counts().postgres, 0);
    drop(scope);
    tx.rollback().unwrap();
}
