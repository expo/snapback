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
    let mut work = effects::legacy_work();
    work.policy.deadline_ms = Some(1_000);
    work.policy.backoff_ms = 8_000;
    let schema = Schema { effects: vec!["mail".into()], effect_specs: BTreeMap::from([("mail".into(),work)]), ..Schema::default() };
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
    assert_eq!(ordinary.deadline,Some(1_100));
    assert_eq!(ordinary.work.policy.backoff_ms,8_000);
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
        "ALTER TABLE _outbox SET UNLOGGED",
        "CREATE RULE discard AS ON INSERT TO _outbox DO INSTEAD NOTHING",
        "ALTER TABLE _effect_presence SET UNLOGGED",
        "CREATE RULE discard AS ON INSERT TO _effect_presence DO INSTEAD NOTHING",
        "ALTER TABLE _outbox ADD COLUMN surprise TEXT",
        "ALTER TABLE _outbox ALTER COLUMN attempts TYPE INTEGER",
        "ALTER TABLE _outbox ALTER COLUMN cancelled DROP DEFAULT",
        "ALTER TABLE _outbox ADD UNIQUE(effect)",
        "DROP TABLE _outbox; CREATE INDEX _outbox_due ON _meta(value)",
        "DROP INDEX _outbox_due; CREATE TABLE _outbox_due(id BIGINT)",
        "ALTER TABLE _outbox ADD FOREIGN KEY(seq) REFERENCES _commits(seq) ON DELETE CASCADE",
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
    effects::test_cases::nul_snapshot_reads(&RefCell::new(&mut engine.store));
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    effects::test_cases::replay_suppression(&tx);
    tx.commit().unwrap();
    assert_eq!(RefCell::new(&mut engine.store).effect_counts().unwrap().get("suppressed"),Some(&3));
}

impl effects::test_cases::Evidence for super::super::store::Tx<'_> {
    fn settled_at(&self,id: &str) -> Option<i64> {
        self.query("SELECT settled_at FROM _outbox WHERE id = $1", &[&id]).unwrap()[0].get(0)
    }
    fn seed_legacy(&self) { self.batch(effects::test_cases::LEGACY_ROW).unwrap(); }
}

macro_rules! contract {
    ($($name:ident),*) => { $(#[test]
    #[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
    fn $name() {
        let mut engine = authority_engine();
        let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
        effects::test_cases::$name(&tx);
        tx.commit().unwrap();
    })* };
}
contract!(signed_lease_shift_boundaries,nul_lookups,candidate_ordering,lifecycle_variants,text_and_wide_values,presence_satisfaction,deadline_and_attempt_limits);

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn outbox_statement_error_is_terminal_and_rolls_back() {
    let mut engine = authority_engine();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    effects::test_cases::race_seed(&tx,false);
    assert!(tx.insert_effect(&effects::NewEffect { id:"race",seq:1,effect:"mail",payload:&Value::Null,now:0,next_at:None,work:&effects::legacy_work(),deadline:None,release:None,contract:"contract" }).is_err());
    tx.rollback().unwrap();
    let tx = engine.store.transaction(None).unwrap();
    assert!(tx.effect_run("race").unwrap().is_none());
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn outbox_writers_require_head_and_never_repair_missing_storage() {
    let mut engine = authority_engine();
    for mode in [None,Some(WriteMode::Serializable)] {
        let tx = engine.store.transaction(mode).unwrap();
        assert!(tx.cancel_effect("missing",0).unwrap_err().to_string().contains("serialized shared-head fence"));
        tx.rollback().unwrap();
    }
    let name: String = engine.store.client.query_one("SELECT current_schema()", &[]).unwrap().get(0);
    engine.store.client.batch_execute("DROP TABLE _effect_presence").unwrap();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    assert!(tx.insert_effect_presence("alice","missing",0).is_err());
    tx.rollback().unwrap();
    assert!(!engine.store.client.query_one("SELECT to_regclass('_effect_presence') IS NOT NULL", &[]).unwrap().get::<_,bool>(0));
    drop(engine);
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let mut engine = PostgresEngine::open(postgres::Client::connect(&url,postgres::NoTls).unwrap(),&name).unwrap();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.insert_effect_presence("alice","missing",0).unwrap();
    tx.commit().unwrap();
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn outbox_cached_projection_survives_additive_ddl() {
    let mut engine = authority_engine();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    effects::test_cases::race_seed(&tx,false);
    tx.commit().unwrap();
    let tx = engine.store.transaction(None).unwrap();
    let before = tx.required_effect_run("race").unwrap();
    tx.rollback().unwrap();
    engine.store.client.batch_execute("ALTER TABLE _outbox ADD COLUMN evaluation_probe TEXT").unwrap();
    let tx = engine.store.transaction(None).unwrap();
    assert_eq!(tx.required_effect_run("race").unwrap(),before);
    tx.rollback().unwrap();
    engine.store.client.batch_execute("ALTER TABLE _outbox DROP COLUMN evaluation_probe").unwrap();
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn outbox_lease_shift_error_rolls_back_all_families_and_deployed_replay_refuses() {
    use std::cell::RefCell;
    let mut engine = authority_engine();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.batch(effects::test_cases::LEASE_SEED).unwrap();
    effects::test_cases::race_seed(&tx,true);
    tx.commit().unwrap();
    engine.store.client.batch_execute("DROP TABLE _requests").unwrap();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    assert!(tx.shift_worker_leases(200,100).is_err());
    tx.rollback().unwrap();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    assert_eq!(tx.required_effect_run("race").unwrap().lease_until,Some(100));
    assert_eq!(tx.query("SELECT expires_at FROM _sessions WHERE token_digest = 'legacy-worker'",&[]).unwrap()[0].get::<_,i64>(0),1000);
    tx.execute("INSERT INTO _meta(key,value) VALUES ('release','live')",&[]).unwrap();
    tx.commit().unwrap();
    effects::test_cases::deployed_replay_refusal(&RefCell::new(&mut engine.store));
    let tx = engine.store.transaction(None).unwrap();
    assert!(!tx.replay_suppresses().unwrap());
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn outbox_nul_lookups_issue_no_statements() {
    use crate::engine::effects::OutboxStore;
    use std::cell::RefCell;
    let mut engine = authority_engine();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    let before = tx.calls.get();
    assert!(tx.effect_run("id\0").unwrap().is_none());
    assert!(tx.effect_candidates(Some("mail\0"), 0, 10).unwrap().is_empty());
    assert!(tx.strict_effect_candidates(Some("mail\0"), 0, 10).unwrap().is_empty());
    assert!(!tx.pending_effect_presence("p\0", 0).unwrap());
    tx.reconnect_effect_presence("p\0", 0).unwrap();
    assert!(!tx.effect_presence_satisfied("id\0").unwrap());
    assert!(tx.effect_presence("id\0").unwrap().is_empty());
    assert!(tx.effect_lease_digest("id\0").is_err());
    assert_eq!(tx.calls.get(), before);
    tx.commit().unwrap();
    // Holding the RefCell borrow proves snapshot guards precede even BEGIN.
    let view = RefCell::new(&mut engine.store);
    let _held = view.borrow_mut();
    assert!(!view.effects_due(Some("mail\0"), 0).unwrap());
    assert!(view.list_effects(Some("queued\0"), 10).unwrap().is_empty());
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn outbox_nul_filter_claim_commits_expiry_and_matches_sqlite() {
    let mut engine = authority_engine();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    effects::test_cases::race_seed(&tx, true);
    tx.commit().unwrap();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    effects::test_cases::nul_filter_after_expiry(&tx);
    tx.commit().unwrap();
    let tx = engine.store.transaction(None).unwrap();
    let run = tx.required_effect_run("race").unwrap();
    tx.rollback().unwrap();
    assert_eq!(run, effects::test_cases::sqlite_nul_claim_oracle());
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn outbox_lease_shift_saturates_all_families() {
    let mut engine = authority_engine();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.batch(effects::test_cases::LEASE_BOUNDARY_SEED).unwrap();
    effects::test_cases::lease_shift_saturates(&tx);
    tx.commit().unwrap();
    let tx = engine.store.transaction(None).unwrap();
    let sessions = tx.query("SELECT token_digest, expires_at FROM _sessions ORDER BY token_digest", &[]).unwrap()
        .into_iter().map(|r| (r.get(0), r.get(1))).collect();
    let requests = tx.query("SELECT id, lease_until FROM _requests ORDER BY id", &[]).unwrap()
        .into_iter().map(|r| (r.get(0), r.get(1))).collect();
    effects::test_cases::lease_boundary_rows(sessions, requests);
    tx.rollback().unwrap();
}
