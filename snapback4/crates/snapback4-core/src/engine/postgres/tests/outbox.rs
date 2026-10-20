use super::authority_engine;
use super::super::{PostgresEngine, WriteMode};
use crate::engine::effects::{self, OutboxTransaction};
use crate::{Schema, Value};
use std::collections::BTreeMap;

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn outbox_shared_expiry_and_generation() {
    let mut engine = authority_engine();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    effects::test_cases::expiry_and_generation(&tx);
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn outbox_shared_presence_and_bounded_maintenance() {
    let mut engine = authority_engine();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    effects::test_cases::presence_and_bounded_maintenance(&tx);
    tx.commit().unwrap();
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn outbox_tail_matches_the_ordinary_recorder() {
    let mut engine = authority_engine();
    let schema = Schema { effects: vec!["mail".into()], ..Schema::default() };
    let presence = BTreeMap::from([("alice".into(), Some(500)), ("bob".into(), None)]);
    let emissions = vec![("batched".into(), "mail".into(), Value::String("nul\0payload".into()), presence.clone())];
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.execute("INSERT INTO _meta(key,value) VALUES ('release','release-1')", &[]).unwrap();
    tx.record_commit(1, 100, "emit", "alice", "mutation", &[], 0).unwrap();
    tx.record_effects(&emissions, 1, 100, &schema).unwrap();
    // Preparing the tail does no driver work; its flush remains one execution.
    let before = tx.calls.get();
    tx.flush_tail().unwrap();
    assert!(tx.calls.get() - before <= 2, "one prepare and one execution");
    effects::record(&tx, &[("ordinary".into(), "mail".into(), emissions[0].2.clone(), presence)], 1, 100, false, &schema).unwrap();
    let mut batched = tx.required_effect_run("batched").unwrap();
    let ordinary = tx.required_effect_run("ordinary").unwrap();
    batched.id = "ordinary".into();
    assert_eq!(batched, ordinary);
    assert_eq!(tx.effect_presence("batched").unwrap(), tx.effect_presence("ordinary").unwrap());
    assert_eq!(ordinary.release.as_deref(), Some("release-1"));
    assert_eq!(ordinary.next_at, Some(500));
    tx.commit().unwrap();
}

fn reopen_after(ddl: &str) -> Result<PostgresEngine, crate::RuntimeError> {
    let mut engine = authority_engine();
    let name: String = engine.store.client.query_one("SELECT current_schema()", &[]).unwrap().get(0);
    engine.store.client.batch_execute(ddl).unwrap();
    drop(engine);
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private database");
    PostgresEngine::open(postgres::Client::connect(&url, postgres::NoTls).unwrap(), &name)
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn outbox_attach_upgrades_evaluation_rows_and_reopens() {
    let mut engine = reopen_after("DROP TABLE _outbox; DROP TABLE _effect_presence;
        CREATE TABLE _outbox(id TEXT PRIMARY KEY,seq BIGINT NOT NULL REFERENCES _commits(seq),effect TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,attempts BIGINT NOT NULL,at BIGINT NOT NULL);
        INSERT INTO _commits(seq,at,program,principal,kind,touched,writes) VALUES (1,0,'emit','alice','mutation','[]',0);
        INSERT INTO _outbox(id,seq,effect,payload,state,attempts,at) VALUES ('legacy',1,'mail','null','queued',0,0)").unwrap();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    let run = tx.required_effect_run("legacy").unwrap();
    assert_eq!(run.work, effects::legacy_work());
    assert!(run.contract.is_none() && run.deadline.is_none() && !run.cancelled);
    tx.claim_effect("legacy", "worker", 100, None).unwrap();
    assert_eq!(tx.required_effect_run("legacy").unwrap().state, "running");
    tx.commit().unwrap();
    let name: String = engine.store.client.query_one("SELECT current_schema()", &[]).unwrap().get(0);
    drop(engine);
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    PostgresEngine::open(postgres::Client::connect(&url, postgres::NoTls).unwrap(), &name).unwrap();
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn outbox_attach_refuses_incompatible_shapes() {
    for ddl in [
        "ALTER TABLE _outbox ADD COLUMN surprise TEXT",
        "ALTER TABLE _outbox ALTER COLUMN attempts TYPE INTEGER",
        "ALTER TABLE _outbox ALTER COLUMN cancelled DROP DEFAULT",
        "ALTER TABLE _outbox ADD UNIQUE(effect)",
        "ALTER TABLE _outbox ALTER COLUMN id TYPE TEXT COLLATE \"POSIX\"",
        "ALTER TABLE _outbox DROP CONSTRAINT _outbox_pkey; ALTER TABLE _outbox ADD PRIMARY KEY(id) DEFERRABLE",
        "DROP INDEX _outbox_due; CREATE INDEX _outbox_due ON _outbox(effect)",
        "ALTER TABLE _effect_presence ALTER COLUMN deadline DROP NOT NULL",
    ] {
        let error = match reopen_after(ddl) { Ok(_) => panic!("accepted {ddl}"), Err(error) => error };
        assert_eq!(error.code(), "E_STORE");
        assert!(error.to_string().contains("SNAPBACK_OUTBOX_SCHEMA"), "{ddl}: {error}");
    }
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn outbox_shared_snapshots_replay_and_leases() {
    use crate::engine::effects::OutboxStore;
    use std::cell::RefCell;
    let mut engine = authority_engine();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.batch(effects::test_cases::LEASE_SEED).unwrap();
    effects::test_cases::lease_shift(&tx);
    let sessions: Vec<(String,i64)> = tx.query("SELECT token_digest,expires_at FROM _sessions ORDER BY token_digest", &[]).unwrap().iter().map(|r| (r.get(0),r.get(1))).collect();
    assert_eq!(sessions, [("delegated".into(),900),("expired-worker".into(),100),("legacy-worker".into(),1200),("modern-worker".into(),1700),("ordinary".into(),900)]);
    let requests: Vec<(String,i64)> = tx.query("SELECT id,lease_until FROM _requests ORDER BY id", &[]).unwrap().iter().map(|r| (r.get(0),r.get(1))).collect();
    assert_eq!(requests, [("bound".into(),900),("legacy".into(),1000),("missing".into(),700),("queued".into(),600)]);
    tx.rollback().unwrap();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    effects::test_cases::snapshot_seed(&tx);
    tx.commit().unwrap();
    effects::test_cases::snapshot_reads(&RefCell::new(&mut engine.store));
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    effects::test_cases::replay_suppression(&tx);
    tx.commit().unwrap();
    assert_eq!(RefCell::new(&mut engine.store).effect_counts().unwrap().get("suppressed"),Some(&3));
}
