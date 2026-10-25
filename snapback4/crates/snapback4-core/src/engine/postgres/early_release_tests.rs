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
#[ignore = "private PG16"]
fn g7e_delayed_disconnect_closure_cannot_strand_writer_admission() {
    use super::read_grant::Grant;
    use crate::engine::{
        command::{Command, Queue},
        program_pipeline::Lane,
    };
    use std::sync::atomic::Ordering;

    let mut engine = crate::engine::program_batch::tests::fixture(true);
    let grant = Arc::new(Grant::default());
    grant.configured.store(true, Ordering::Release);
    engine
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .read_grant = Some(grant.clone());
    engine
        .store_mut()
        .enable_postgres_early_lock_release()
        .unwrap();
    let d = engine.store().durability().unwrap();
    let (bumped, bump) = mpsc::channel();
    let (resume, paused) = mpsc::channel();
    let notify = d.clone();
    let notification = std::thread::spawn(move || {
        notify.break_history_with(|epoch| {
            bumped.send(epoch).unwrap();
            paused.recv_timeout(Duration::from_secs(10)).unwrap();
        });
    });
    let epoch = bump.recv_timeout(Duration::from_secs(5)).unwrap();
    let (started, start) = mpsc::channel();
    let (recovered, recovery) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        started.send(()).unwrap();
        Lane::new().drain(&mut engine);
        recovered.send(engine).unwrap();
    });
    start.recv_timeout(Duration::from_secs(5)).unwrap();
    // Before the fix this completes while the notification is paused. With
    // the shared transition lock recovery waits until closure has completed.
    let early = recovery.recv_timeout(Duration::from_secs(2));
    resume.send(()).unwrap();
    notification.join().unwrap();
    let engine = early.unwrap_or_else(|_| recovery.recv_timeout(Duration::from_secs(10)).unwrap());
    worker.join().unwrap();
    assert_eq!(d.epoch(), epoch);
    assert!(!d.broken(), "fenced recovery must restore D");
    let queue = Queue::start(engine, 8).unwrap();
    let write = queue.call(Command::new(|engine| {
        engine.mutate(
            "increment",
            None,
            crate::Context::new(
                "alice",
                [
                    ("key".into(), crate::Value::Id("a".into())),
                    ("delta".into(), crate::Value::Int(1)),
                    ("reject".into(), crate::Value::Bool(false)),
                ]
                .into(),
            )
            .at(1000),
        )
    }));
    drop(queue);
    assert!(
        write.is_ok(),
        "recovered epoch stranded admission: {write:?}"
    );
    assert!(write.unwrap().is_ok());
    assert!(!grant.uncertain.load(Ordering::Acquire));
    assert!(
        grant.state.read().unwrap().epoch.is_none(),
        "recovery must not resurrect the old read grant"
    );
}

#[test]
fn g7e_recovery_clears_only_its_own_epoch_uncertainty() {
    use super::read_grant::Grant;
    use std::sync::atomic::Ordering;
    let grant = Arc::new(Grant::default());
    let d = Durability::new(Some(&grant));
    d.certify(d.epoch(), snapshot(10, 3, 10), true).unwrap();
    d.break_history();
    let stale = d.epoch();
    d.break_history();
    assert!(d.certify(stale, snapshot(10, 3, 20), true).is_err());
    assert!(d.broken());
    assert!(grant.uncertain.load(Ordering::Acquire));
    d.certify(d.epoch(), snapshot(10, 3, 30), true).unwrap();
    assert!(!d.broken());
    assert!(
        !grant.uncertain.load(Ordering::Acquire),
        "matching recovery left writer admission uncertain"
    );
    d.break_history();
    assert!(
        grant.uncertain.load(Ordering::Acquire),
        "a newer break must close admission again"
    );
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

#[test]
#[ignore = "private PG16"]
fn g7e_concurrent_reader_break_during_recovery_retries_and_admits_writes() {
    use super::read_grant::Grant;
    use crate::engine::{
        command::{Command, Queue},
        program_pipeline::Lane,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    let mut engine = crate::engine::program_batch::tests::fixture(true);
    let grant = Arc::new(Grant::default());
    grant.configured.store(true, Ordering::Release);
    engine
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .read_grant = Some(grant.clone());
    engine
        .store_mut()
        .enable_postgres_early_lock_release()
        .unwrap();
    let d = engine.store().durability().unwrap();
    let (sampled, sample) = mpsc::channel();
    let (broke, broken) = mpsc::channel();
    let broken = std::sync::Mutex::new(broken);
    let attempts = Arc::new(AtomicUsize::new(0));
    let count = attempts.clone();
    d.set_recovery_hook(Arc::new(move || {
        if count.fetch_add(1, Ordering::AcqRel) < 3 {
            sampled.send(()).unwrap();
            broken
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
        }
    }));
    let reader = d.clone();
    let notification = std::thread::spawn(move || {
        for _ in 0..3 {
            sample.recv_timeout(Duration::from_secs(5)).unwrap();
            // The reader connection task uses this same break_history entry.
            reader.break_history();
            broke.send(()).unwrap();
        }
    });
    d.break_history();
    let mut lane = Lane::new();
    let until = Instant::now() + Duration::from_secs(3);
    while d.broken() && Instant::now() < until {
        lane.drain(&mut engine);
        std::thread::sleep(Duration::from_millis(2));
    }
    // Drop the hook before joining so a failing-before run cannot park the
    // notification thread waiting for attempts the old lane never makes.
    d.set_recovery_hook(Arc::new(|| {}));
    drop(engine.store().durability());
    assert!(
        !d.broken(),
        "superseded recovery permanently paused admission; attempts={}",
        attempts.load(Ordering::Acquire)
    );
    notification.join().unwrap();
    assert!(!lane.paused);
    assert!(attempts.load(Ordering::Acquire) >= 4);
    assert!(!grant.uncertain.load(Ordering::Acquire));
    drop(lane);
    let queue = Queue::start(engine, 8).unwrap();
    let write = queue.call(Command::new(|engine| {
        engine.mutate(
            "increment",
            None,
            crate::Context::new(
                "alice",
                [
                    ("key".into(), crate::Value::Id("a".into())),
                    ("delta".into(), crate::Value::Int(1)),
                    ("reject".into(), crate::Value::Bool(false)),
                ]
                .into(),
            )
            .at(1000),
        )
    }));
    assert!(
        write.is_ok(),
        "follow-up recovery must admit writes: {write:?}"
    );
    assert!(write.unwrap().is_ok());
    drop(queue);
}

fn marker_timeout_client() -> postgres::Client {
    let mut c = postgres::Client::connect(
        &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
        postgres::NoTls,
    )
    .unwrap();
    c.batch_execute("SET statement_timeout='5s'; SET lock_timeout='5s'; CREATE TEMP TABLE _durable(token bigint, slot bigint, n bigint); INSERT INTO _durable VALUES(1,0,0)").unwrap();
    c
}
#[test]
#[ignore = "private PG16; real certificate wait exceeds 5s session timeout"]
fn g7e_marker_commit_wait_exceeds_session_statement_timeout() {
    let mut c = marker_timeout_client();
    c.batch_execute("CREATE FUNCTION pg_temp.slow_marker() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF current_setting('synchronous_commit')<>'on' OR current_setting('statement_timeout')<>'0' OR current_setting('lock_timeout')<>'0' THEN RAISE EXCEPTION 'certificate timeouts not disabled'; END IF; PERFORM pg_sleep(5.2); RETURN NEW; END $f$; CREATE CONSTRAINT TRIGGER slow_marker AFTER UPDATE ON _durable DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pg_temp.slow_marker(); BEGIN; SET LOCAL statement_timeout=0; SET LOCAL lock_timeout=0").unwrap();
    let xid: String = c
        .query_one("SELECT pg_current_xact_id()::text", &[])
        .unwrap()
        .get(0);
    let start = Instant::now();
    let outcome = commit_marker(
        &mut c,
        &std::sync::atomic::AtomicBool::new(false),
        1,
        0,
        &xid,
    );
    assert!(
        outcome.is_ok(),
        "slow marker COMMIT must certify: {outcome:?}"
    );
    assert!(start.elapsed() >= Duration::from_millis(5200));
    assert_eq!(
        c.query_one("SHOW statement_timeout", &[])
            .unwrap()
            .get::<_, String>(0),
        "5s"
    );
}
#[test]
#[ignore = "private PG16; real certificate wait exceeds 5s session timeout"]
fn g7e_marker_lock_wait_exceeds_session_lock_timeout() {
    let mut c = marker_timeout_client();
    let mut blocker = marker_timeout_client();
    let key = (crate::ids::seed() & i64::MAX as u64) as i64;
    blocker
        .query_one("SELECT pg_advisory_lock($1)", &[&key])
        .unwrap();
    c.batch_execute(&format!("CREATE FUNCTION pg_temp.lock_marker() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_advisory_xact_lock({key}); RETURN NEW; END $f$; CREATE TRIGGER lock_marker BEFORE UPDATE ON _durable FOR EACH ROW EXECUTE FUNCTION pg_temp.lock_marker(); BEGIN; SET LOCAL statement_timeout=0; SET LOCAL lock_timeout=0")).unwrap();
    let pid: i32 = c.query_one("SELECT pg_backend_pid()", &[]).unwrap().get(0);
    let xid: String = c
        .query_one("SELECT pg_current_xact_id()::text", &[])
        .unwrap()
        .get(0);
    let task = std::thread::spawn(move || {
        let outcome = commit_marker(
            &mut c,
            &std::sync::atomic::AtomicBool::new(false),
            1,
            0,
            &xid,
        );
        (c, outcome)
    });
    let until = Instant::now() + Duration::from_secs(3);
    while !blocker
        .query_one(
            "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted)",
            &[&pid],
        )
        .unwrap()
        .get::<_, bool>(0)
    {
        assert!(Instant::now() < until, "marker lock rendezvous");
        std::thread::sleep(Duration::from_millis(1));
    }
    std::thread::sleep(Duration::from_millis(5200));
    blocker
        .query_one("SELECT pg_advisory_unlock($1)", &[&key])
        .unwrap();
    let (mut c, outcome) = task.join().unwrap();
    assert!(
        outcome.is_ok(),
        "slow marker lock must certify: {outcome:?}"
    );
    assert_eq!(
        c.query_one("SHOW lock_timeout", &[])
            .unwrap()
            .get::<_, String>(0),
        "5s"
    );
}
#[test]
#[ignore = "private PG16; real recovery COMMIT wait exceeds 5s session timeout"]
fn g7e_recovery_commit_wait_exceeds_session_statement_timeout() {
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
    store.client.batch_execute("SET statement_timeout='5s'; SET lock_timeout='5s'; CREATE FUNCTION slow_recovery() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_sleep(5.2); IF current_setting('synchronous_commit')<>'on' OR current_setting('statement_timeout')<>'0' OR current_setting('lock_timeout')<>'0' THEN RAISE EXCEPTION 'certificate timeouts not disabled'; END IF; RETURN NEW; END $f$; CREATE CONSTRAINT TRIGGER slow_recovery AFTER UPDATE ON _head DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION slow_recovery()").unwrap();
    let d = store.early_release.clone().unwrap();
    d.break_history();
    let start = Instant::now();
    let outcome = store.recover_early_release();
    assert!(
        outcome.is_ok(),
        "slow recovery COMMIT must certify: {outcome:?}"
    );
    assert!(start.elapsed() >= Duration::from_millis(5200));
    assert!(!d.broken());
    assert_eq!(
        store
            .client
            .query_one("SHOW statement_timeout", &[])
            .unwrap()
            .get::<_, String>(0),
        "5s"
    );
}

#[test]
#[ignore = "private PG16"]
fn g7e_recovery_pending_queue_returns_unknown_and_lease_loss_stops_retries() {
    use crate::engine::{
        command::{Command, ProgramCommand, Queue, SubmitError},
        program::Invocation,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    let mut engine = crate::engine::program_batch::tests::fixture(true);
    engine
        .store_mut()
        .enable_postgres_early_lock_release()
        .unwrap();
    let d = engine.store().durability().unwrap();
    let weak = Arc::downgrade(&d);
    let attempts = Arc::new(AtomicUsize::new(0));
    let count = attempts.clone();
    let (sampled, sample) = mpsc::channel();
    let (resume, resumed) = mpsc::channel();
    let resumed = std::sync::Mutex::new(resumed);
    d.set_recovery_hook(Arc::new(move || {
        if count.fetch_add(1, Ordering::AcqRel) == 0 {
            sampled.send(()).unwrap();
            resumed
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
        }
        weak.upgrade().unwrap().break_history();
    }));
    d.break_history();
    let queue = Queue::start(engine, 8).unwrap();
    sample.recv_timeout(Duration::from_secs(5)).unwrap();
    let mut replies = Vec::new();
    for _ in 0..2 {
        replies.push(
            queue
                .submit_program(ProgramCommand::new(
                    Invocation::new(
                        "increment",
                        None,
                        crate::Context::new(
                            "alice",
                            [
                                ("key".into(), crate::Value::Id("a".into())),
                                ("delta".into(), crate::Value::Int(1)),
                                ("reject".into(), crate::Value::Bool(false)),
                            ]
                            .into(),
                        )
                        .at(1000),
                    ),
                    |_, outcome| outcome,
                ))
                .unwrap(),
        );
    }
    let solo = queue.submit(Command::new(|_| ())).unwrap();
    resume.send(()).unwrap();
    let outcomes: Vec<_> = replies.into_iter().map(|r| r.wait()).collect();
    let solo = solo.wait();
    queue.refuse_ownership();
    // Barrier via the hook mutex is not needed: at most the recovery already
    // in progress can finish. No later idle tick may start another attempt.
    std::thread::sleep(Duration::from_millis(300));
    let stopped = attempts.load(Ordering::Acquire);
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(
        attempts.load(Ordering::Acquire),
        stopped,
        "lease loss left recovery retries running"
    );
    drop(queue);
    for outcome in outcomes {
        assert!(
            matches!(outcome, Err(SubmitError::OutcomeUnknown)),
            "queued program lost its explicit unknown outcome: {outcome:?}"
        );
    }
    assert!(
        matches!(solo, Err(SubmitError::OutcomeUnknown)),
        "queued solo lost its explicit unknown outcome: {solo:?}"
    );
}
