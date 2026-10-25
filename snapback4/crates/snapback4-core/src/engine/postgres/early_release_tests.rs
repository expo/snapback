use super::early_release::*;
use std::{
    sync::{Arc, mpsc},
    time::{Duration, Instant},
};
fn snapshot(r: i64, s: i64, a: u64) -> Snapshot {
    Snapshot {
        revision: r,
        seq: s,
        attempt: (1, a),
        postmaster: "boot-1".into(),
    }
}
fn gate() -> Arc<Durability> {
    let d = Durability::new(None);
    d.certify(1, snapshot(10, 3, 10), true).unwrap();
    d
}
#[test]
fn g7e_revision_reuse_discards_lost_output_and_fill() {
    let d = gate();
    let lost = d.bind(snapshot(11, 4, 11), "lost rows");
    d.break_history();
    d.certify(d.epoch(), snapshot(10, 3, 20), true).unwrap();
    d.certify(d.epoch(), snapshot(11, 4, 21), false).unwrap();
    assert!(
        lost.open().is_err(),
        "numeric revision reuse cannot release a lost snapshot"
    );
    assert_eq!(
        d.bind(snapshot(11, 4, 21), "new rows").open().unwrap(),
        "new rows"
    );
}
#[test]
fn g7e_public_sequence_is_not_revision_and_wait_is_bounded() {
    let d = gate();
    let started = Instant::now();
    assert!(d.bind(snapshot(11, 3, 11), ()).open().is_err());
    assert!(started.elapsed() >= HOLD && started.elapsed() < HOLD + Duration::from_secs(1));
    assert!(
        d.bind(snapshot(10, 4, 11), ()).open().is_err(),
        "public seq also requires coverage"
    );
}
#[test]
fn g7e_reader_uses_its_snapshot_head_and_bump_wakes_it() {
    let d = gate();
    let (send, receive) = mpsc::channel();
    let reader = d.clone();
    let thread = std::thread::spawn(move || {
        send.send(reader.bind(snapshot(11, 4, 11), ()).open())
            .unwrap()
    });
    assert!(receive.recv_timeout(Duration::from_millis(20)).is_err());
    d.break_history();
    assert!(
        receive
            .recv_timeout(Duration::from_millis(100))
            .unwrap()
            .is_err()
    );
    thread.join().unwrap();
    assert!(
        d.bind(snapshot(10, 3, 10), ()).open().is_err(),
        "broken epochs never open fresh holds"
    );
}
#[test]
fn g7e_late_certificate_and_postmaster_change_cannot_reopen_epoch() {
    let d = gate();
    let epoch = d.epoch();
    d.break_history();
    assert!(d.certify(epoch, snapshot(11, 4, 11), false).is_err());
    d.certify(d.epoch(), snapshot(10, 3, 20), true).unwrap();
    let mut h = snapshot(10, 3, 20);
    h.postmaster = "boot-2".into();
    assert!(d.bind(h, ()).open().is_err());
    assert!(d.broken());
}
#[test]
fn g7e_release_and_bump_share_a_lock() {
    for _ in 0..64 {
        let d = gate();
        let (s, r) = mpsc::channel();
        let child = d.clone();
        let task =
            std::thread::spawn(move || s.send(child.bind(snapshot(11, 4, 11), ()).open()).unwrap());
        d.certify(1, snapshot(11, 4, 11), false).unwrap();
        d.break_history();
        // Either the release linearized before the bump, or it is discarded.
        let _ = r.recv_timeout(Duration::from_secs(1)).unwrap();
        task.join().unwrap();
        assert!(d.bind(snapshot(11, 4, 11), ()).open().is_err());
    }
}

#[test]
#[should_panic(expected = "E acknowledgement exceeds WAL flush position")]
fn g7e_flush_position_assertion_rejects_an_unflushed_reply() {
    assert_flushed("1/20", "1/10").unwrap();
}

#[test]
fn g7e_cpu_hit_publication_is_head_bound_and_rechecked_at_release() {
    let d = gate();
    assert!(d.bind_publication(11, 4, "future cache entry").is_none());
    let held = d.bind_publication(10, 3, "cached rows").unwrap();
    d.break_history();
    assert!(held.open().is_err());
    assert!(d.bind_publication(10, 3, "cached rows").is_none());
}

#[test]
#[ignore = "private PG16"]
fn g7e_fallback_rebinds_the_head_of_its_new_physical_snapshot() {
    let mut engine = crate::engine::program_batch::tests::fixture(true);
    engine
        .store_mut()
        .enable_postgres_early_lock_release()
        .unwrap();
    let store = engine
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut();
    let namespace: String = store
        .client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0);
    let mut control = postgres::Client::connect(
        &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
        postgres::NoTls,
    )
    .unwrap();
    control
        .batch_execute(&format!("SET search_path={namespace},pg_catalog"))
        .unwrap();
    let tx = store.begin(None, false).unwrap();
    tx.flight(
        &[("SELECT revision FROM _head WHERE singleton", &[])],
        "ROLLBACK",
    )
    .unwrap();
    tx.finish_read_flight();
    // Model a visible, uncertified data suffix after the composed read ended.
    control
        .batch_execute("UPDATE _head SET revision=revision+1 WHERE singleton")
        .unwrap();
    let started = Instant::now();
    assert!(
        tx.restart_request_facts("absent-session").is_err(),
        "a reopened snapshot escaped using its previous snapshot's durable head"
    );
    assert!(started.elapsed() >= HOLD && started.elapsed() < HOLD + Duration::from_secs(1));
}

#[test]
#[ignore = "private PG16"]
fn g7e_effect_claim_output_waits_for_its_synchronous_barrier_and_d() {
    use crate::{Context, Value};
    let mut engine = crate::engine::program_batch::tests::fixture(true);
    engine
        .mutate(
            "increment",
            None,
            Context::new(
                "alice",
                [
                    ("key".into(), Value::Id("a".into())),
                    ("delta".into(), Value::Int(1)),
                    ("reject".into(), Value::Bool(false)),
                ]
                .into(),
            )
            .at(1000),
        )
        .unwrap();
    engine
        .store_mut()
        .enable_postgres_early_lock_release()
        .unwrap();
    let namespace: String = engine
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0);
    engine
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .batch_execute("SET synchronous_commit=off")
        .unwrap();
    let mut control = postgres::Client::connect(
        &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
        postgres::NoTls,
    )
    .unwrap();
    control
        .batch_execute(&format!("SET search_path={namespace},pg_catalog"))
        .unwrap();
    let key = (crate::ids::seed() & i64::MAX as u64) as i64;
    control
        .query_one("SELECT pg_advisory_lock($1)", &[&key])
        .unwrap();
    control.batch_execute(&format!("CREATE FUNCTION e_claim_hold() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_advisory_xact_lock({key});IF current_setting('synchronous_commit')<>'on' THEN RAISE EXCEPTION 'claim must set synchronous_commit on';END IF;RETURN NEW;END $f$; CREATE CONSTRAINT TRIGGER e_claim_hold AFTER UPDATE ON _outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION e_claim_hold(); UPDATE _head SET revision=revision+1 WHERE singleton")).unwrap();
    let gate = engine.store().durability().unwrap();
    let (send, receive) = mpsc::channel();
    let task = std::thread::spawn(move || {
        let result = engine.claim_effects_fenced("worker", None, 1, 1000, 1000);
        send.send((engine, result)).unwrap();
    });
    let early = receive.recv_timeout(Duration::from_millis(40));
    control
        .query_one("SELECT pg_advisory_unlock($1)", &[&key])
        .unwrap();
    assert!(
        early.is_err(),
        "effect payload escaped before its claim COMMIT"
    );
    let (engine, result) = receive.recv_timeout(Duration::from_secs(5)).unwrap();
    task.join().unwrap();
    assert_eq!(result.unwrap().len(), 1);
    assert!(!gate.broken());
    assert!(
        engine.store().rows("counters").is_ok(),
        "claim must advance D before returning"
    );
}

#[test]
#[ignore = "private PG16"]
fn g7e_recovery_refuses_marker_interception_before_certifying_d() {
    let mut engine = crate::engine::program_batch::tests::fixture(true);
    engine
        .store_mut()
        .enable_postgres_early_lock_release()
        .unwrap();
    let store = engine
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut();
    store.client.batch_execute("CREATE FUNCTION e_intercept() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL;END $f$; CREATE TRIGGER e_intercept BEFORE UPDATE ON _durable FOR EACH ROW EXECUTE FUNCTION e_intercept()").unwrap();
    let gate = store.early_release.clone().unwrap();
    gate.break_history();
    assert!(
        store.recover_early_release().is_err(),
        "recovery certified a foreign-intercepted marker relation"
    );
    assert!(gate.broken());
}

#[test]
#[ignore = "private PG16"]
fn g7e_synchronous_head_decode_failure_after_commit_is_unknown() {
    let mut client = postgres::Client::connect(
        &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
        postgres::NoTls,
    )
    .unwrap();
    client.batch_execute("CREATE TEMP TABLE _head(singleton boolean PRIMARY KEY,seq bigint,revision bigint,attempt text);INSERT INTO _head VALUES(true,1,1,'0:1');BEGIN;SET LOCAL synchronous_commit=on;UPDATE _head SET revision=2,attempt='invalid'").unwrap();
    let outcome = commit_synchronous_head(&mut client, &std::sync::atomic::AtomicBool::new(false));
    assert!(matches!(
        outcome,
        Err(crate::RuntimeError::CommitOutcomeUnknown(_))
    ));
    assert_eq!(
        client
            .query_one("SELECT revision FROM _head WHERE singleton", &[])
            .unwrap()
            .get::<_, i64>(0),
        2,
        "the certificate error happened after the data committed"
    );
}
