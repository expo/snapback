//! Foundation contracts run on both adapters; Postgres-specific attach and snapshot witnesses.
// @ref LLP 3000.009.001.000#9.1 — adapter operations and an observable head-lock wait.
use super::super::{PostgresEngine, WriteMode};
use crate::{
    metadata::{DevMetadata, MetadataReader, MetadataWriter, test_cases},
    store::test_race::FenceRace,
};
use postgres::{Client, NoTls};
use std::{cell::RefCell, sync::Arc};
fn client() -> Client {
    Client::connect(
        &std::env::var("SNAPBACK4_EVAL_POSTGRES")
            .expect("private scripts/test-postgres.sh database"),
        NoTls,
    )
    .unwrap()
}
fn engine() -> PostgresEngine {
    PostgresEngine::create(
        client(),
        &format!("sb4_eval_foundation_{:x}", crate::ids::seed()),
        crate::Schema::default(),
        [],
    )
    .unwrap()
}
fn name(e: &mut PostgresEngine) -> String {
    e.store
        .client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0)
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn metadata_shared_contract() {
    let mut e = engine();
    test_cases::missing(&RefCell::new(&mut e.store));
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    for (key, value) in [
        ("generation", "invalid"),
        ("worker:session-family", "legacy"),
        ("worker:session-revision", "invalid"),
        ("worker:family:named", "2"),
    ] {
        tx.execute(
            "INSERT INTO _meta(key,value) VALUES ($1,$2)",
            &[&key, &value],
        )
        .unwrap();
    }
    test_cases::raw_values_and_worker_fences(&tx);
    test_cases::independent_families(&tx);
    test_cases::admission(&tx);
    tx.commit().unwrap();
    let handle = RefCell::new(&mut e.store);
    test_cases::raw_values_and_worker_fences(&handle);
    test_cases::independent_families(&handle);
    test_cases::admission(&handle);
    drop(handle);
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.set_dev_value(DevMetadata::Replay, "rolled back")
        .unwrap();
    tx.rollback().unwrap();
    assert_eq!(
        RefCell::new(&mut e.store)
            .dev_value(DevMetadata::Replay)
            .unwrap()
            .as_deref(),
        Some("true")
    );
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn metadata_nul_keys_are_absent_without_queries() {
    let mut e = engine();
    let tx = e.store.transaction(None).unwrap();
    let before = tx.calls.get();
    assert_eq!(tx.worker_status(Some("bad\0key")).unwrap(), None);
    assert_eq!(tx.worker_family_revision("bad\0key").unwrap(), None);
    assert_eq!(tx.calls.get(), before);
    tx.rollback().unwrap();
    let before = e.stats().database_calls;
    let handle = RefCell::new(&mut e.store);
    assert_eq!(handle.worker_status(Some("bad\0key")).unwrap(), None);
    assert_eq!(handle.worker_family_revision("bad\0key").unwrap(), None);
    drop(handle);
    assert_eq!(e.stats().database_calls, before);
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn metadata_snapshot_reopen_and_additive_cached_reads() {
    let mut e = engine();
    let namespace = name(&mut e);
    let mut peer = PostgresEngine::open(client(), &namespace).unwrap();
    RefCell::new(&mut e.store)
        .set_worker_status(None, "old")
        .unwrap();
    let tx = e.store.transaction(None).unwrap();
    assert_eq!(tx.worker_status(None).unwrap().as_deref(), Some("old"));
    RefCell::new(&mut peer.store)
        .set_worker_status(None, "new")
        .unwrap();
    assert_eq!(tx.worker_status(None).unwrap().as_deref(), Some("old"));
    // Reopen while a metadata reader holds its relation lock: attach must do no no-op ALTER.
    let reopened = PostgresEngine::open(client(), &namespace).unwrap();
    tx.rollback().unwrap();
    drop(reopened);
    let mut reopened = PostgresEngine::open(client(), &namespace).unwrap();
    assert_eq!(
        RefCell::new(&mut reopened.store)
            .worker_status(None)
            .unwrap()
            .as_deref(),
        Some("new")
    );
    e.store
        .client
        .batch_execute("ALTER TABLE _meta ADD COLUMN future TEXT")
        .unwrap();
    let tx = e.store.transaction(None).unwrap();
    assert_eq!(tx.worker_status(None).unwrap().as_deref(), Some("new"));
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn metadata_writers_observe_predecessor_under_contention() {
    let mut e = engine();
    let namespace = name(&mut e);
    let mut peer = PostgresEngine::open(client(), &namespace).unwrap();
    let race = Arc::new(FenceRace::postgres(
        &mut e.store.client,
        &mut peer.store.client,
        client(),
    ));
    let ready = race.clone();
    let other = std::thread::spawn(move || {
        let tx = peer
            .store
            .transaction_with_begin_hook(Some(WriteMode::Serialized), || ready.after_begin(false))
            .unwrap();
        test_cases::advance(&tx, Some("first"), "second");
        tx.commit().unwrap();
    });
    let tx = e
        .store
        .transaction_with_begin_hook(Some(WriteMode::Serialized), || race.after_begin(true))
        .unwrap();
    race.after_fence(true).unwrap();
    test_cases::advance(&tx, None, "first");
    tx.commit().unwrap();
    other.join().unwrap();
    assert_eq!(
        RefCell::new(&mut e.store)
            .worker_status(Some("race"))
            .unwrap()
            .as_deref(),
        Some("second")
    );
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn metadata_requires_writer_fence_and_bind_refusal_rolls_back() {
    let mut e = engine();
    for mode in [None, Some(WriteMode::Serializable)] {
        let tx = e.store.transaction(mode).unwrap();
        assert!(tx.set_deployment_environment("no fence").is_err());
        tx.rollback().unwrap();
    }
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.set_deployment_environment("discard").unwrap();
    assert_eq!(
        tx.execute(
            "INSERT INTO _meta(key,value) VALUES ('residual',$1)",
            &[&"bad\0value"]
        )
        .unwrap_err()
        .code(),
        "E_INPUT"
    );
    assert!(tx.deployment_environment().is_err());
    assert!(tx.commit().is_err());
    assert_eq!(
        RefCell::new(&mut e.store).deployment_environment().unwrap(),
        None
    );
}

fn shape_refusals(table: &str, alterations: &[&str]) {
    for alteration in alterations {
        let mut e = engine();
        let namespace = name(&mut e);
        e.store.client.batch_execute(alteration).unwrap();
        let error = PostgresEngine::open(client(), &namespace)
            .err()
            .expect("incompatible shape must refuse");
        assert!(
            (error.to_string().contains("SNAPBACK_FOUNDATION_SCHEMA")
                || (table == "_meta" && error.to_string().contains("SNAPBACK_IDENTITY_SCHEMA")))
                && error.to_string().contains(table),
            "{alteration}: {error}"
        );
    }
}
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn metadata_attach_refuses_incompatible_shapes() {
    shape_refusals(
        "_meta",
        &[
            "ALTER TABLE _meta ALTER COLUMN key TYPE varchar(40)",
            "ALTER TABLE _meta ALTER COLUMN value DROP NOT NULL",
            "ALTER TABLE _meta ALTER COLUMN key TYPE text COLLATE \"POSIX\"",
            "ALTER TABLE _meta ADD CONSTRAINT extra CHECK (value <> '')",
            "CREATE UNIQUE INDEX extra ON _meta(value)",
            "ALTER TABLE _meta ALTER COLUMN value SET DEFAULT ''",
            "ALTER TABLE _meta DROP CONSTRAINT _meta_pkey",
            "ALTER TABLE _meta SET UNLOGGED",
            "CREATE RULE suppress AS ON INSERT TO _meta DO INSTEAD NOTHING",
            "ALTER TABLE _meta ENABLE ROW LEVEL SECURITY",
            "CREATE FUNCTION suppress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER suppress BEFORE INSERT ON _meta FOR EACH ROW EXECUTE FUNCTION suppress()",
        ],
    );
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn metadata_statement_error_discards_the_writer() {
    let mut e = engine();
    e.store.client.batch_execute("CREATE FUNCTION refuse_metadata() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key = 'deployment_environment' THEN RAISE EXCEPTION 'fixture refusal'; END IF; RETURN NEW; END $$; CREATE TRIGGER refuse_metadata BEFORE INSERT ON _meta FOR EACH ROW EXECUTE FUNCTION refuse_metadata()").unwrap();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.set_worker_status(None, "discard").unwrap();
    assert!(tx.set_deployment_environment("refused").is_err());
    tx.rollback().unwrap();
    assert_eq!(
        RefCell::new(&mut e.store).worker_status(None).unwrap(),
        None
    );
}
