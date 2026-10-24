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
    // Exercise missing/raw metadata independently of the opening bootstrap facts.
    e.store.client.batch_execute("DELETE FROM _meta").unwrap();
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
        // Shape mutations need an empty ledger: opening now installs several
        // bootstrap facts with identical values, which would block this DDL.
        if table == "_meta" { e.store.client.batch_execute("DELETE FROM _meta").unwrap(); }
        e.store.client.batch_execute(alteration).unwrap();
        let error = PostgresEngine::open(client(), &namespace)
            .err()
            .expect("incompatible shape must refuse");
        assert!(
            (error.to_string().contains(super::shape_code(alteration,"SNAPBACK_FOUNDATION_SCHEMA"))
                || (table == "_meta" && error.to_string().contains("SNAPBACK_IDENTITY_SCHEMA")))
                && error.to_string().contains(table),
            "{alteration}: {error}"
        );
    }
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn ledger_attach_refuses_inheritance_and_partitioning() {
    for (table, key, code) in [
        ("_ops", "principal", "SNAPBACK_FOUNDATION_SCHEMA"),
        ("_principals", "id", "SNAPBACK_IDENTITY_SCHEMA"),
        ("_jobs", "id", "SNAPBACK_JOBS_SCHEMA"),
        ("_outbox", "id", "SNAPBACK_OUTBOX_SCHEMA"),
        ("_asset_gc", "asset", "SNAPBACK_ASSET_SCHEMA"),
        ("_requests", "id", "SNAPBACK_REQUESTS_SCHEMA"),
    ] {
        for ddl in [
            format!("CREATE TABLE extra_child () INHERITS ({table})"),
            format!("CREATE TABLE extra_parent (LIKE {table}); ALTER TABLE {table} INHERIT extra_parent"),
            format!("ALTER TABLE {table} RENAME TO old_ledger; CREATE TABLE {table} (LIKE old_ledger INCLUDING ALL) PARTITION BY LIST ({key})"),
        ] {
            let mut e = engine();
            let namespace = name(&mut e);
            e.store.client.batch_execute(&ddl).unwrap();
            // Pin the actual duplicate-key counterexample, on two families.
            if ddl.starts_with("CREATE TABLE extra_child") {
                let insert = match table {
                    "_ops" => Some("INSERT INTO _ops(principal,id,seq,outcome,at) VALUES ('alice','same',1,'{}',0); INSERT INTO extra_child(principal,id,seq,outcome,at) VALUES ('alice','same',2,'{}',0)"),
                    "_asset_gc" => Some("INSERT INTO _asset_gc(asset) VALUES ('same'); INSERT INTO extra_child(asset) VALUES ('same')"),
                    _ => None,
                };
                if let Some(insert) = insert {
                    e.store.client.batch_execute(insert).unwrap();
                    let count: i64 = e.store.client.query_one(&format!("SELECT count(*) FROM {table}"), &[]).unwrap().get(0);
                    assert_eq!(count, 2, "parent scans include conflicting child rows");
                }
            }
            let error = PostgresEngine::open(client(), &namespace).err().expect("hierarchical ledgers must refuse attach");
            let message = error.to_string();
            assert!(message.contains(code) && message.contains(table) && message.contains("inheritance or partitioning"), "{ddl}: {error}");
        }
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

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn receipts_shared_contract() {
    use crate::receipts::{ReceiptReader, test_cases};
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    for row in test_cases::fixtures() {
        tx.execute("INSERT INTO _ops(principal,id,seq,outcome,name,args_digest,at) VALUES ('alice',$1,$2,$3,$4,$5,0)", &[&row.id,&row.seq,&row.outcome,&row.name,&row.digest]).unwrap();
    }
    tx.commit().unwrap();
    test_cases::replay_and_acknowledgement(&RefCell::new(&mut e.store));
    let tx = e.store.transaction(None).unwrap();
    test_cases::replay_and_acknowledgement(&tx);
    let before = tx.calls.get();
    for (principal, id) in [("alice", "nul\0id"), ("nul\0principal", "bound")] {
        assert!(tx.receipt(principal, id).unwrap().is_none());
        assert!(!tx.receipt_exists(principal, id).unwrap());
        assert_eq!(tx.sent_sequence(principal, id, i64::MAX).unwrap(), None);
        assert!(
            crate::receipts::replay_bound(&tx, principal, id, "send", &serde_json::Value::Null)
                .unwrap()
                .is_none()
        );
    }
    assert_eq!(tx.calls.get(), before);
    tx.rollback().unwrap();
    let before = e.stats().database_calls;
    let handle = RefCell::new(&mut e.store);
    assert!(handle.receipt("alice", "nul\0id").unwrap().is_none());
    assert!(!handle.receipt_exists("nul\0principal", "bound").unwrap());
    assert_eq!(
        handle.sent_sequence("alice", "nul\0id", i64::MAX).unwrap(),
        None
    );
    assert_eq!(e.stats().database_calls, before);
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn receipts_record_replay_snapshot_additive_reads_and_reopen() {
    use crate::receipts::{ReceiptReader, payload_digest, replay_bound};
    let mut e = engine();
    let namespace = name(&mut e);
    let mut peer = PostgresEngine::open(client(), &namespace).unwrap();
    let tx = e.store.transaction(None).unwrap();
    assert!(tx.receipt("alice", "recorded").unwrap().is_none());
    let write = peer.store.transaction(Some(WriteMode::Serialized)).unwrap();
    let args = serde_json::json!({"nested": ["escaped\0text"]});
    write
        .record_applied(
            "alice",
            "recorded",
            7,
            r#"{"state":"sent","result":"escaped\u0000text"}"#,
            "send",
            &payload_digest(&args),
            0,
        )
        .unwrap();
    write.commit().unwrap();
    assert!(!tx.receipt_exists("alice", "recorded").unwrap());
    let reopened = PostgresEngine::open(client(), &namespace).unwrap();
    drop(reopened);
    tx.rollback().unwrap();
    let handle = RefCell::new(&mut e.store);
    assert_eq!(
        replay_bound(&handle, "alice", "recorded", "send", &args)
            .unwrap()
            .as_deref(),
        Some(r#"{"state":"sent","result":"escaped\u0000text"}"#)
    );
    e.store
        .client
        .batch_execute("ALTER TABLE _ops ADD COLUMN future TEXT")
        .unwrap();
    let tx = e.store.transaction(None).unwrap();
    assert!(tx.receipt("alice", "recorded").unwrap().is_some());
    assert_eq!(tx.sent_sequence("alice", "recorded", 7).unwrap(), Some(7));
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn receipts_attach_upgrades_old_binding_nullability_and_installs_missing_ledger() {
    use crate::receipts::ReceiptReader;
    let mut e = engine();
    let namespace = name(&mut e);
    e.store.client.batch_execute("ALTER TABLE _ops ALTER COLUMN name SET NOT NULL; ALTER TABLE _ops ALTER COLUMN args_digest SET NOT NULL").unwrap();
    let mut reopened = PostgresEngine::open(client(), &namespace).unwrap();
    reopened
        .store
        .client
        .batch_execute(
            "INSERT INTO _ops(principal,id,seq,outcome,at) VALUES ('alice','legacy',8,'{}',0)",
        )
        .unwrap();
    assert!(
        RefCell::new(&mut reopened.store)
            .receipt("alice", "legacy")
            .unwrap()
            .is_some()
    );
    reopened
        .store
        .client
        .batch_execute("DROP TABLE _ops")
        .unwrap();
    let mut reopened = PostgresEngine::open(client(), &namespace).unwrap();
    assert!(
        !RefCell::new(&mut reopened.store)
            .receipt_exists("alice", "legacy")
            .unwrap()
    );
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn receipts_attach_refuses_incompatible_shapes() {
    shape_refusals(
        "_ops",
        &[
            "ALTER TABLE _ops ALTER COLUMN seq TYPE integer",
            "ALTER TABLE _ops ALTER COLUMN outcome DROP NOT NULL",
            "ALTER TABLE _ops ALTER COLUMN id TYPE text COLLATE \"POSIX\"",
            "ALTER TABLE _ops ADD CONSTRAINT extra CHECK (seq >= 0)",
            "CREATE UNIQUE INDEX extra ON _ops(id)",
            "ALTER TABLE _ops ALTER COLUMN outcome SET DEFAULT '{}'",
            "ALTER TABLE _ops SET UNLOGGED",
            "CREATE RULE suppress AS ON INSERT TO _ops DO INSTEAD NOTHING",
            "ALTER TABLE _ops ENABLE ROW LEVEL SECURITY",
        ],
    );
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn change_evidence_shared_contract_and_boundaries() {
    use crate::revocation::{ChangeEvidence, evidence_test_cases};
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    // Seed backwards so physical insertion order cannot accidentally satisfy the ordered contract.
    for record in evidence_test_cases::records().into_iter().rev() {
        tx.execute("INSERT INTO _commits(seq,at,program,principal,kind,touched,writes) VALUES ($1,0,'test','test','mutation','[]',0)", &[&(record.seq as i64)]).unwrap();
        if let Some(footprint) = record.footprint {
            tx.execute(
                "INSERT INTO _change_evidence(seq,footprint) VALUES ($1,$2)",
                &[&(record.seq as i64), &footprint],
            )
            .unwrap();
        }
    }
    tx.commit().unwrap();
    evidence_test_cases::check(&RefCell::new(&mut e.store));
    let tx = e.store.transaction(None).unwrap();
    evidence_test_cases::check(&tx);
    let before = tx.calls.get();
    assert!(tx.change_evidence(0, u64::MAX, |_| Some(())).unwrap().is_none());
    assert_eq!(tx.calls.get(), before);
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn change_evidence_missing_table_or_rows_always_widen() {
    use crate::revocation::footprint_between;
    let mut e = engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.record_commit(1, 0, "test", "alice", "mutation", &[], 0)
        .unwrap();
    tx.commit().unwrap();
    e.store.client.batch_execute("DELETE FROM _change_evidence").unwrap();
    assert!(footprint_between(&RefCell::new(&mut e.store), 0, 1).is_none());
    e.store
        .client
        .batch_execute("DROP TABLE _change_evidence")
        .unwrap();
    assert!(footprint_between(&RefCell::new(&mut e.store), 0, 1).is_none());
    let namespace = name(&mut e);
    let mut reopened = PostgresEngine::open(client(), &namespace).unwrap();
    assert!(footprint_between(&RefCell::new(&mut reopened.store), 0, 1).is_none());
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.set_deployment_environment("discard").unwrap();
    tx.batch("DROP TABLE _change_evidence").unwrap();
    assert!(footprint_between(&tx, 0, 1).is_none());
    // A query failure is never recovered inside the writer.
    tx.rollback().unwrap();
    assert_eq!(
        RefCell::new(&mut e.store).deployment_environment().unwrap(),
        None
    );
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn change_evidence_snapshots_additive_cached_reads_and_reopen() {
    use crate::revocation::footprint_between;
    let mut e = engine();
    let namespace = name(&mut e);
    let mut peer = PostgresEngine::open(client(), &namespace).unwrap();
    let tx = e.store.transaction(None).unwrap();
    assert!(footprint_between(&tx, 0, 1).is_none());
    let write = peer.store.transaction(Some(WriteMode::Serialized)).unwrap();
    write
        .record_commit(1, 0, "test", "alice", "mutation", &[], 0)
        .unwrap();
    write.commit().unwrap();
    assert!(footprint_between(&tx, 0, 1).is_none());
    let reopened = PostgresEngine::open(client(), &namespace).unwrap();
    drop(reopened);
    tx.rollback().unwrap();
    assert!(footprint_between(&RefCell::new(&mut e.store), 0, 1).is_some());
    e.store.client.batch_execute("ALTER TABLE _change_evidence ADD COLUMN future TEXT; ALTER TABLE _commits ADD COLUMN future TEXT").unwrap();
    assert!(footprint_between(&RefCell::new(&mut e.store), 0, 1).is_some());
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn change_evidence_attach_refuses_incompatible_shapes() {
    shape_refusals(
        "_change_evidence",
        &[
            "ALTER TABLE _change_evidence ALTER COLUMN seq TYPE integer",
            "ALTER TABLE _change_evidence ALTER COLUMN footprint DROP NOT NULL",
            "ALTER TABLE _change_evidence ADD CONSTRAINT extra CHECK (seq >= 0)",
            "CREATE UNIQUE INDEX extra ON _change_evidence(footprint)",
            "ALTER TABLE _change_evidence ALTER COLUMN footprint SET DEFAULT '{}'",
            "ALTER TABLE _change_evidence SET UNLOGGED",
            "CREATE RULE suppress AS ON INSERT TO _change_evidence DO INSTEAD NOTHING",
            "ALTER TABLE _change_evidence ENABLE ROW LEVEL SECURITY",
        ],
    );
    shape_refusals(
        "_commits",
        &[
            "ALTER TABLE _log SET UNLOGGED; ALTER TABLE _commits SET UNLOGGED",
            "CREATE RULE suppress AS ON INSERT TO _commits DO INSTEAD NOTHING",
        ],
    );
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn change_evidence_distinguishes_missing_footprints_from_driver_errors() {
    use crate::revocation::ChangeEvidence;
    let mut e = engine();
    let namespace = name(&mut e);
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.record_commit(1, 0, "test", "alice", "mutation", &[], 0).unwrap();
    tx.commit().unwrap();
    e.store.client.batch_execute("DELETE FROM _change_evidence").unwrap();
    let tx = e.store.transaction(None).unwrap();
    assert_eq!(tx.change_evidence(0, 1, |_| panic!("missing footprint must not be visited")).unwrap(), None);
    tx.rollback().unwrap();
    assert_eq!(RefCell::new(&mut e.store).change_evidence(0, 1, |_| Some(())).unwrap(), None);

    let mut peer = PostgresEngine::open(client(), &namespace).unwrap();
    let mut lock = peer.store.client.transaction().unwrap();
    lock.batch_execute("LOCK TABLE _change_evidence IN ACCESS EXCLUSIVE MODE").unwrap();
    e.store.client.batch_execute("SET lock_timeout = '25ms'").unwrap();
    let tx = e.store.transaction(None).unwrap();
    assert_eq!(tx.change_evidence(0, 1, |_| Some(())).unwrap_err().code(), "E_STORE");
    tx.rollback().unwrap();
    assert_eq!(RefCell::new(&mut e.store).change_evidence(0, 1, |_| Some(())).unwrap_err().code(), "E_STORE");
    lock.rollback().unwrap();
    // The failed scoped read rolled back and released its connection for reuse.
    assert_eq!(RefCell::new(&mut e.store).change_evidence(0, 1, |_| Some(())).unwrap(), None);
}
