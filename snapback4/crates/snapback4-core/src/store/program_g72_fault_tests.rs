//! Cross-socket outcomes, visibility and process-death prefixes.
use super::*;
use std::sync::atomic::AtomicBool;
static LOCK_WITNESSES: Mutex<()> = Mutex::new(());

fn reopen_reference(mut engine: Engine) -> Engine {
    // Engine attach itself is an administrative revision. Apply that same
    // barrier to the oracle when the recovered side was reopened.
    let store = std::mem::replace(&mut engine.store, AnyStore::memory().unwrap());
    Engine::open(store).unwrap()
}

#[test]
#[ignore = "private Postgres"]
fn g72_every_final_boundary_classifies_xids_and_rolls_back_provisional_state() {
    for point in [
        Point::BeforeFinal,
        Point::AfterTail,
        Point::BeforeCommit,
        Point::AfterCommit,
    ] {
        let mut engine = fixture_with_sync(true, true);
        engine.entropy = 773;
        let mut client = observer(&mut engine);
        let mut lane = Lane::new();
        let hold = Hold::new();
        let events = install_hook(&mut lane, point, hold.clone(), true);
        let output = Arc::new(Mutex::new(Vec::new()));
        let counts = Arc::new((0..16).map(|_| AtomicUsize::new(0)).collect::<Vec<_>>());
        let mut witnesses = Vec::new();
        for start in [0, 8] {
            let out = output.clone();
            let batch = members(start)
                .into_iter()
                .enumerate()
                .map(|(n, i)| {
                    let counts = counts.clone();
                    i.instrument(move |run| {
                        counts[start + n].fetch_add(1, Ordering::SeqCst);
                        run();
                    })
                })
                .collect();
            lane.start(
                &mut engine,
                batch,
                Box::new(move |engine, values| {
                    out.lock().unwrap().push((start, values, engine.entropy));
                }),
            );
            witnesses.push(until_event(
                &events,
                start / 8,
                if start == 0 {
                    point
                } else {
                    Point::BeforeFinal
                },
            ));
        }
        assert!(
            output.lock().unwrap().is_empty(),
            "{point:?}: no provisional reply"
        );
        assert_eq!(engine.entropy, 773, "entropy installs only at release");
        assert_ne!(witnesses[0].attempt, witnesses[1].attempt);
        hold.open();
        lane.drain(&mut engine);
        let unknown = point == Point::AfterCommit;
        let out = output.lock().unwrap();
        assert_eq!(out.iter().map(|o| o.0).collect::<Vec<_>>(), [0, 8]);
        for (n, witness) in witnesses.iter().enumerate() {
            assert_eq!(
                sql_status(&mut client, &witness.xid),
                if unknown { "committed" } else { "aborted" },
                "{point:?}/{n}"
            );
            if unknown && n == 0 {
                assert!(out[n].1.iter().all(|v| {
                    v.as_ref()
                        .err()
                        .is_some_and(|e| e.code == "E_COMMIT_OUTCOME_UNKNOWN")
                }));
            } else {
                assert!(
                    out[n].1.iter().all(Result::is_ok),
                    "{point:?}/{n}: {:?}",
                    out[n].1
                );
            }
        }
        assert!(
            counts
                .iter()
                .all(|c| c.load(Ordering::SeqCst) == if unknown { 1 } else { 2 })
        );
        let mut reference = fixture_with_sync(true, true);
        reference.entropy = 773;
        for mut i in (0..16).map(item) {
            reference.invoke_program(&mut i).unwrap();
        }
        assert_eq!(engine.entropy, reference.entropy);
        assert_eq!(digest(&mut engine), digest(&mut reference), "{point:?}");
        contiguous(&mut client);
        let attempt: String = client
            .query_one("SELECT attempt FROM _head WHERE singleton", &[])
            .unwrap()
            .get(0);
        if !unknown {
            assert!(
                witnesses.iter().all(|w| w.attempt != attempt),
                "reruns use fresh attempts"
            );
        }
    }
}

#[test]
#[ignore = "private Postgres"]
fn g72_connection_loss_before_commit_is_unknown_and_never_reruns_chain() {
    for point in [Point::BeforeFinal, Point::AfterTail, Point::BeforeCommit] {
        let mut engine = fixture(true);
        let mut client = observer(&mut engine);
        let killer = observer(&mut engine);
        let mut lane = Lane::new();
        let hold = Hold::new();
        let held = hold.clone();
        let (send, events) = mpsc::channel();
        let send = Mutex::new(send);
        let killer = Mutex::new(killer);
        lane.hook = Some(Arc::new(move |w| {
            send.lock().unwrap().send(w.clone()).unwrap();
            if w.ordinal == 0 && w.point == point {
                held.wait();
                // This is a backend owned by this test's P1 xid, recorded
                // before termination; no ambient backend is selected by name.
                let mut killer = killer.lock().unwrap();
                let pid: i32 = killer
                    .query_one(
                        "SELECT pid FROM pg_stat_activity WHERE backend_xid::text=$1",
                        &[&w.xid],
                    )
                    .unwrap()
                    .get(0);
                assert!(
                    killer
                        .query_one("SELECT pg_terminate_backend($1)", &[&pid])
                        .unwrap()
                        .get::<_, bool>(0)
                );
                return Err(crate::RuntimeError::Store(
                    "lost owned writer socket".into(),
                ));
            }
            Ok(())
        }));
        let results = Arc::new(Mutex::new(Vec::new()));
        let mut xids = Vec::new();
        for start in [0, 8] {
            let out = results.clone();
            lane.start(
                &mut engine,
                members(start),
                Box::new(move |_, v| out.lock().unwrap().push(v)),
            );
            xids.push(
                until_event(
                    &events,
                    start / 8,
                    if start == 0 {
                        point
                    } else {
                        Point::BeforeFinal
                    },
                )
                .xid,
            );
        }
        hold.open();
        lane.drain(&mut engine);
        let results = results.lock().unwrap();
        assert!(results[0].iter().all(|v| {
            v.as_ref()
                .err()
                .is_some_and(|e| e.code == "E_COMMIT_OUTCOME_UNKNOWN")
        }));
        assert!(results[1].iter().all(Result::is_err));
        for xid in &xids {
            assert_eq!(sql_status(&mut client, xid), "aborted");
        }
        let mut reference = fixture(true);
        assert_eq!(digest(&mut engine), digest(&mut reference), "{point:?}");
        contiguous(&mut client);
    }
}

#[test]
#[ignore = "private Postgres"]
fn g72_visibility_hammer_reads_only_whole_committed_prefixes() {
    let _exclusive = LOCK_WITNESSES.lock().unwrap();
    let mut engine = fixture_with_sync(true, true);
    let mut client = observer(&mut engine);
    let mut hammer = observer(&mut engine);
    let stop = Arc::new(AtomicBool::new(false));
    let done = stop.clone();
    let worker = std::thread::spawn(move || {
        let mut samples = 0;
        while !done.load(Ordering::SeqCst) || samples < 4 {
            hammer
                .batch_execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
                .unwrap();
            contiguous(&mut hammer);
            let commits: i64 = hammer
                .query_one("SELECT count(*) FROM _commits WHERE program='guarded'", &[])
                .unwrap()
                .get(0);
            let row: String = hammer
                .query_one("SELECT data FROM r WHERE t='counters' AND id='shared'", &[])
                .unwrap()
                .get(0);
            let row: Value = serde_json::from_str(&row).unwrap();
            assert_eq!(row.field("n").unwrap(), &Value::Int(commits));
            let images: i64 = hammer.query_one("SELECT count(*) FROM _log l JOIN _commits c USING(seq) WHERE c.program='guarded' AND l.t='counters'", &[]).unwrap().get(0);
            assert_eq!(images, commits);
            let ids: i64 = hammer
                .query_one("SELECT count(*) FROM _ops WHERE name='guarded'", &[])
                .unwrap()
                .get(0);
            assert_eq!(ids, commits);
            hammer.batch_execute("ROLLBACK").unwrap();
            samples += 1;
        }
        samples
    });
    let before: i64 = client
        .query_one(
            "SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()",
            &[],
        )
        .unwrap()
        .get(0);
    let mut lane = Lane::new();
    for start in (0..96).step_by(16) {
        let hold = Hold::new();
        let events = install_hook(&mut lane, Point::BeforeCommit, hold.clone(), false);
        lane.start(
            &mut engine,
            members(start),
            Box::new(|_, v| assert!(v.iter().all(Result::is_ok))),
        );
        loop {
            if events.recv_timeout(Duration::from_secs(10)).unwrap().point == Point::BeforeCommit {
                break;
            }
        }
        lane.start(
            &mut engine,
            members(start + 8),
            Box::new(|_, v| assert!(v.iter().all(Result::is_ok))),
        );
        hold.open();
        lane.drain(&mut engine);
    }
    stop.store(true, Ordering::SeqCst);
    assert!(worker.join().unwrap() >= 4);
    let after: i64 = client
        .query_one(
            "SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()",
            &[],
        )
        .unwrap()
        .get(0);
    assert_eq!(before, after, "single-store wait graph is acyclic");
}

#[test]
#[ignore = "subprocess helper; run by g72_process_death_recovers_only_a_prefix"]
fn g72_crash_child() {
    let Ok(output) = std::env::var("SNAPBACK4_G72_CRASH_OUTPUT") else {
        return;
    };
    let mode: usize = std::env::var("SNAPBACK4_G72_CRASH_MODE")
        .unwrap()
        .parse()
        .unwrap();
    let mut engine = fixture(true);
    let mut client = observer(&mut engine);
    let schema: String = client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0);
    let mut lane = Lane::new();
    let (send, events) = mpsc::channel();
    let send = Mutex::new(send);
    let hold = Hold::new();
    let held = hold.clone();
    lane.hook = Some(Arc::new(move |w| {
        send.lock().unwrap().send(w.clone()).unwrap();
        let point = if mode == 0 && w.ordinal == 0 {
            Point::BeforeFinal
        } else if mode == 1 && w.ordinal == 1 {
            Point::BeforeCommit
        } else {
            Point::AfterCommit
        };
        if w.point == point {
            held.wait();
        }
        Ok(())
    }));
    lane.start(
        &mut engine,
        members(0),
        Box::new(|_, _| panic!("child must die before release")),
    );
    let first = until_event(
        &events,
        0,
        if mode == 0 {
            Point::BeforeFinal
        } else {
            Point::AfterCommit
        },
    );
    lane.start(
        &mut engine,
        members(8),
        Box::new(|_, _| panic!("child must die before release")),
    );
    let second = until_event(
        &events,
        1,
        match mode {
            0 => Point::BeforeFinal,
            1 => Point::BeforeCommit,
            _ => Point::AfterCommit,
        },
    );
    if mode == 0 {
        wait(|| {
            client.query_one("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE backend_xid::text=$1 AND wait_event='advisory')", &[&second.xid]).unwrap().get::<_,bool>(0)
                || sql_status(&mut client, &second.xid) != "in progress"
        });
    }
    std::fs::write(
        format!("{output}.tmp"),
        serde_json::to_vec(&serde_json::json!({"schema":schema,"xids":[first.xid,second.xid]}))
            .unwrap(),
    )
    .unwrap();
    std::fs::rename(format!("{output}.tmp"), &output).unwrap();
    hold.wait();
}

#[test]
#[ignore = "private Postgres; SIGKILL only recorded child processes"]
fn g72_process_death_recovers_only_a_prefix() {
    use std::process::{Command, Stdio};
    struct CrashChild(std::process::Child);
    impl Drop for CrashChild {
        fn drop(&mut self) {
            if self.0.try_wait().ok().flatten().is_none() {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
    }
    let exe = std::env::current_exe().unwrap();
    for mode in 0..3 {
        let path =
            std::env::temp_dir().join(format!("sb4-g72-crash-{}-{mode}.json", crate::ids::seed()));
        let mut child = CrashChild(
            Command::new(&exe)
                .args([
                    "--exact",
                    "engine::program_batch::overlay_tests::g72_tests::faults::g72_crash_child",
                    "--ignored",
                    "--nocapture",
                ])
                .env("SNAPBACK4_G72_CRASH_OUTPUT", &path)
                .env("SNAPBACK4_G72_CRASH_MODE", mode.to_string())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        );
        let recorded_pid = child.0.id();
        let startup_deadline = Instant::now() + Duration::from_secs(30);
        while !path.exists() {
            assert!(
                child.0.try_wait().unwrap().is_none(),
                "crash child exited before rendezvous"
            );
            assert!(
                Instant::now() < startup_deadline,
                "crash child startup deadline"
            );
            std::thread::sleep(Duration::from_millis(1));
        }
        let record: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(child.0.id(), recorded_pid);
        child.0.kill().unwrap();
        assert!(!child.0.wait().unwrap().success());
        let mut client =
            Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), NoTls).unwrap();
        let schema = record["schema"].as_str().unwrap();
        client
            .batch_execute(&format!("SET search_path={schema},pg_catalog"))
            .unwrap();
        for (n, xid) in record["xids"].as_array().unwrap().iter().enumerate() {
            wait(|| sql_status(&mut client, xid.as_str().unwrap()) != "in progress");
            assert_eq!(
                sql_status(&mut client, xid.as_str().unwrap()),
                if n < mode { "committed" } else { "aborted" }
            );
        }
        contiguous(&mut client);
        let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
        let mut reopened =
            Engine::open(AnyStore::open_postgres(&connection, schema).unwrap()).unwrap();
        let mut reference = fixture(true);
        for mut i in (0..mode * 8).map(item) {
            reference.invoke_program(&mut i).unwrap();
        }
        let mut reference = reopen_reference(reference);
        assert_eq!(
            digest(&mut reopened),
            digest(&mut reference),
            "crash mode {mode}"
        );
        std::fs::remove_file(path).unwrap();
    }
}

#[test]
#[ignore = "private Postgres"]
fn g72_ticket_wait_precedes_cas_even_if_predecessor_has_not_locked_head() {
    let mut engine = fixture(true);
    let mut client = observer(&mut engine);
    let mut lane = Lane::new();
    let hold = Hold::new();
    let events = install_hook(&mut lane, Point::BeforeFinal, hold.clone(), false);
    lane.start(
        &mut engine,
        members(0),
        Box::new(|_, v| assert!(v.iter().all(Result::is_ok))),
    );
    until_event(&events, 0, Point::BeforeFinal);
    lane.start(
        &mut engine,
        members(8),
        Box::new(|_, v| assert!(v.iter().all(Result::is_ok))),
    );
    let second = until_event(&events, 1, Point::BeforeFinal);
    let mut waiting = false;
    wait(|| {
        waiting=client.query_one("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE backend_xid::text=$1 AND wait_event='advisory')",&[&second.xid]).unwrap().get(0);
        waiting || sql_status(&mut client, &second.xid) != "in progress"
    });
    hold.open();
    lane.drain(&mut engine);
    assert!(
        waiting,
        "successor must wait before its CAS, even when _head has no predecessor lock"
    );
}

#[test]
#[ignore = "private Postgres"]
fn g72_unknown_drain_waits_for_parked_successor_and_two_unknowns_stay_unknown() {
    for first_aborts in [false, true] {
        let mut engine = fixture(true);
        let mut client = observer(&mut engine);
        let mut lane = Lane::new();
        let lower = Hold::new();
        let higher = Hold::new();
        let low = lower.clone();
        let high = higher.clone();
        let (send, events) = mpsc::channel();
        let send = Mutex::new(send);
        lane.hook = Some(Arc::new(move |w| {
            send.lock().unwrap().send(w.clone()).unwrap();
            if w.ordinal == 0
                && w.point
                    == if first_aborts {
                        Point::AfterTail
                    } else {
                        Point::AfterCommit
                    }
            {
                low.wait();
                return Err(crate::RuntimeError::Store("injected lower failure".into()));
            }
            if w.ordinal == 1 && w.point == Point::BeforeFinal {
                high.wait();
            }
            if !first_aborts && w.ordinal == 1 && w.point == Point::AfterCommit {
                return Err(crate::RuntimeError::Store(
                    "second lost confirmation".into(),
                ));
            }
            Ok(())
        }));
        let calls = Arc::new(AtomicUsize::new(0));
        let outputs = Arc::new(Mutex::new(Vec::new()));
        let retries = Arc::new(AtomicUsize::new(0));
        let batch = members(0)
            .into_iter()
            .map(|i| {
                let retry = retries.clone();
                let mut attempts = 0;
                i.instrument(move |run| {
                    attempts += 1;
                    if attempts > 1 {
                        retry.fetch_add(1, Ordering::SeqCst);
                    }
                    run();
                })
            })
            .collect();
        let out = outputs.clone();
        let called = calls.clone();
        lane.start(
            &mut engine,
            batch,
            Box::new(move |_, v| {
                called.fetch_add(1, Ordering::SeqCst);
                out.lock().unwrap().push(v);
            }),
        );
        let first = until_event(
            &events,
            0,
            if first_aborts {
                Point::AfterTail
            } else {
                Point::AfterCommit
            },
        );
        let out = outputs.clone();
        let called = calls.clone();
        lane.start(
            &mut engine,
            members(8),
            Box::new(move |_, v| {
                called.fetch_add(1, Ordering::SeqCst);
                out.lock().unwrap().push(v);
            }),
        );
        let second = until_event(&events, 1, Point::BeforeFinal);
        lower.open();
        wait(|| sql_status(&mut client, &first.xid) != "in progress");
        let (started, ready) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            started.send(()).unwrap();
            lane.drain(&mut engine);
            (lane, engine)
        });
        ready.recv_timeout(Duration::from_secs(10)).unwrap();
        // A parked dispatched successor is still affected. Neither a reply nor
        // recovery interpretation is allowed until its terminal result arrives.
        std::thread::sleep(Duration::from_millis(50));
        let early_calls = calls.load(Ordering::SeqCst);
        let early_retries = retries.load(Ordering::SeqCst);
        assert_eq!(sql_status(&mut client, &second.xid), "in progress");
        higher.open();
        let (_lane, mut engine) = worker.join().unwrap();
        assert_eq!(early_calls, 0);
        assert_eq!(early_retries, 0, "no reseed or rerun ahead of drain");
        if first_aborts {
            assert!(outputs.lock().unwrap().iter().flatten().all(Result::is_ok));
            assert_eq!(retries.load(Ordering::SeqCst), 8);
        } else {
            assert!(outputs.lock().unwrap().iter().flatten().all(|v| {
                v.as_ref()
                    .err()
                    .is_some_and(|e| e.code == "E_COMMIT_OUTCOME_UNKNOWN")
            }));
            assert_eq!(retries.load(Ordering::SeqCst), 0);
        }
        let mut reference = fixture(true);
        for mut i in (0..16).map(item) {
            reference.invoke_program(&mut i).unwrap();
        }
        assert_eq!(digest(&mut engine), digest(&mut reference));
    }
}

#[test]
#[ignore = "private Postgres"]
fn g72_takeover_terminates_both_tagged_slots_and_reopens_with_fresh_token() {
    use crate::store_port::{LeasePolicy, StoreLease};
    let mut engine = fixture(true);
    let mut client = observer(&mut engine);
    let schema: String = client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0);
    let id = engine.store_id.clone();
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let mut lane = Lane::new();
    let hold = Hold::new();
    let events = install_hook(&mut lane, Point::AfterTail, hold.clone(), false);
    let out = Arc::new(Mutex::new(Vec::new()));
    for start in [0, 8] {
        let values = out.clone();
        lane.start(
            &mut engine,
            members(start),
            Box::new(move |_, v| values.lock().unwrap().push(v)),
        );
        if start == 0 {
            until_event(&events, 0, Point::AfterTail);
        }
    }
    until_event(&events, 1, Point::BeforeFinal);
    let pids=client.query("SELECT DISTINCT a.pid FROM pg_stat_activity a JOIN pg_locks l USING(pid) WHERE a.application_name=$1 AND l.locktype='advisory' AND l.granted",&[&format!("sb:{id}:0000:0")]).unwrap().into_iter().map(|r|r.get::<_,i32>(0)).collect::<Vec<_>>();
    assert_eq!(pids.len(), 2);
    let mut lease =
        StoreLease::connect(&connection, &schema, &id, "a073", LeasePolicy::default()).unwrap();
    let acquisition = lease.acquire().unwrap().unwrap();
    assert_eq!(acquisition.token, 1);
    for pid in pids {
        assert!(
            client
                .query_opt("SELECT pid FROM pg_stat_activity WHERE pid=$1", &[&pid])
                .unwrap()
                .is_none()
        );
    }
    hold.open();
    lane.drain(&mut engine);
    assert!(out.lock().unwrap().iter().flatten().all(Result::is_err));
    drop(lane);
    drop(engine);
    let mut reopened =
        Engine::open(AnyStore::open_postgres_owned(&connection, &schema, &lease).unwrap()).unwrap();
    let mut reference = reopen_reference(fixture(true));
    assert_eq!(digest(&mut reopened), digest(&mut reference));
    for mut i in members(0) {
        reopened.invoke_program(&mut i).unwrap();
    }
    contiguous(&mut client);
    drop(reopened);
    lease.release().unwrap();
}

#[test]
#[ignore = "private Postgres"]
fn g72_cross_store_ticket_cycle_is_a_known_deadlock_abort() {
    let _exclusive = LOCK_WITNESSES.lock().unwrap();
    use crate::engine::program_pipeline::Chain;
    let mut first = fixture(true);
    let mut second = fixture(true);
    let mut watch = observer(&mut first);
    let mut a = members(0);
    let mut b = members(0);
    let indices = (0..8).collect::<Vec<_>>();
    let mut fa = None;
    let mut fb = None;
    let ca = Chain {
        entropy: first.entropy,
        ..Default::default()
    };
    let cb = Chain {
        entropy: second.entropy,
        ..Default::default()
    };
    let plans = |engine: &Engine, batch: &[Invocation]| batch.iter().map(|i|
        crate::engine::committer::closure::Closure::new(&engine.schema,&engine.programs[&i.name],&i.context,engine.generation).unwrap()).collect::<Vec<_>>();
    let pa = plans(&first, &a);
    let pb = plans(&second, &b);
    assert!(
        first
            .program_group_staged(&mut a, &indices, false, Some(pa), Some(&ca), &mut fa)
            .is_ok()
    );
    assert!(
        second
            .program_group_staged(&mut b, &indices, false, Some(pb), Some(&cb), &mut fb)
            .is_ok()
    );
    let mut fa = fa.unwrap();
    let mut fb = fb.unwrap();
    let xids = [fa.head.xid.clone(), fb.head.xid.clone()];
    // Force exactly the wait graph that colliding store keys (or a foreign
    // advisory user) can create. Each slot still owns its real P1 ticket.
    fa.predecessor = Some(fb.ticket);
    fb.predecessor = Some(fa.ticket);
    let a = std::thread::spawn(move || first.store.finish_suspended(fa));
    let b = std::thread::spawn(move || second.store.finish_suspended(fb));
    let results = [a.join().unwrap(), b.join().unwrap()];
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    for (result, xid) in results.iter().zip(xids) {
        if let Err(f) = result {
            assert!(f.aborted);
            assert!(
                matches!(&f.error,crate::RuntimeError::Postgres(e) if e.code().is_some_and(|c|c.code()=="40P01"))
            );
            assert_eq!(sql_status(&mut watch, &xid), "aborted");
        } else {
            assert_eq!(sql_status(&mut watch, &xid), "committed");
        }
    }
}

#[test]
#[ignore = "private Postgres"]
fn g72_generation_change_with_both_slots_dispatched_rolls_back_both() {
    let mut engine = fixture(true);
    let mut client = observer(&mut engine);
    let before = digest(&mut engine);
    let mut lane = Lane::new();
    let hold = Hold::new();
    let events = install_hook(&mut lane, Point::BeforeFinal, hold.clone(), false);
    let output = Arc::new(Mutex::new(Vec::new()));
    let mut xids = Vec::new();
    for start in [0, 8] {
        let out = output.clone();
        lane.start(
            &mut engine,
            members(start),
            Box::new(move |_, v| out.lock().unwrap().extend(v)),
        );
        xids.push(until_event(&events, start / 8, Point::BeforeFinal).xid);
    }
    client
        .execute(
            "UPDATE _backend SET generation=generation+1 WHERE singleton",
            &[],
        )
        .unwrap();
    hold.open();
    lane.drain(&mut engine);
    assert!(output.lock().unwrap().iter().all(Result::is_err));
    for xid in xids {
        assert_eq!(sql_status(&mut client, &xid), "aborted");
    }
    // Restore the faulted generation solely to inspect the original engine;
    // ordinary reads correctly refuse while its generation is stale.
    client
        .execute(
            "UPDATE _backend SET generation=generation-1 WHERE singleton",
            &[],
        )
        .unwrap();
    assert_eq!(digest(&mut engine), before);
    contiguous(&mut client);
}

#[test]
#[ignore = "private Postgres"]
fn g72_two_lost_connections_drain_then_both_slots_can_reconnect() {
    let mut engine = fixture(true);
    let mut client = observer(&mut engine);
    let killer = Mutex::new(observer(&mut engine));
    let mut lane = Lane::new();
    let hold = Hold::new();
    let held = hold.clone();
    let (send, events) = mpsc::channel();
    let send = Mutex::new(send);
    lane.hook = Some(Arc::new(move |w| {
        send.lock().unwrap().send(w.clone()).unwrap();
        if w.point == Point::BeforeFinal {
            held.wait();
            let mut killer = killer.lock().unwrap();
            let pid: i32 = killer
                .query_one(
                    "SELECT pid FROM pg_stat_activity WHERE backend_xid::text=$1",
                    &[&w.xid],
                )
                .unwrap()
                .get(0);
            assert!(
                killer
                    .query_one("SELECT pg_terminate_backend($1)", &[&pid])
                    .unwrap()
                    .get::<_, bool>(0)
            );
            return Err(crate::RuntimeError::Store(
                "both owned transports lost".into(),
            ));
        }
        Ok(())
    }));
    let out = Arc::new(Mutex::new(Vec::new()));
    let mut xids = Vec::new();
    for start in [0, 8] {
        let values = out.clone();
        lane.start(
            &mut engine,
            members(start),
            Box::new(move |_, v| values.lock().unwrap().extend(v)),
        );
        xids.push(until_event(&events, start / 8, Point::BeforeFinal).xid);
    }
    hold.open();
    lane.drain(&mut engine);
    assert!(out.lock().unwrap().iter().all(|v| {
        v.as_ref()
            .err()
            .is_some_and(|e| e.code == "E_COMMIT_OUTCOME_UNKNOWN")
    }));
    for xid in xids {
        assert_eq!(sql_status(&mut client, &xid), "aborted");
    }
    lane.hook = None;
    for start in [16, 24] {
        lane.start(
            &mut engine,
            members(start),
            Box::new(|_, v| assert!(v.iter().all(Result::is_ok))),
        );
        lane.drain(&mut engine);
    }
    let mut reference = fixture(true);
    for mut i in (16..32).map(item) {
        reference.invoke_program(&mut i).unwrap();
    }
    assert_eq!(digest(&mut engine), digest(&mut reference));
}

#[test]
#[ignore = "private Postgres"]
fn g72_first_ticket_deadline_never_reruns_later_deadline_peers() {
    let mut engine = fixture(true);
    let mut client = observer(&mut engine);
    let before = digest(&mut engine);
    // No program batch has opened yet, so the store's first ticket is slot 0.
    let ticket = (u64::from_str_radix(&engine.store_id[..16], 16).unwrap() & !63) as i64;
    client
        .query_one("SELECT pg_advisory_lock($1)", &[&ticket])
        .unwrap();
    let counts = Arc::new(AtomicUsize::new(0));
    let count = counts.clone();
    let mut batch = members(0)
        .into_iter()
        .map(|i| {
            let count = count.clone();
            i.instrument(move |run| {
                count.fetch_add(1, Ordering::SeqCst);
                run();
            })
        })
        .collect::<Vec<_>>();
    batch[0].deadline = Instant::now() + Duration::from_millis(100);
    let mut lane = Lane::new();
    let out = Arc::new(Mutex::new(Vec::new()));
    let values = out.clone();
    lane.start(
        &mut engine,
        batch,
        Box::new(move |_, v| *values.lock().unwrap() = v),
    );
    lane.drain(&mut engine);
    client
        .query_one("SELECT pg_advisory_unlock($1)", &[&ticket])
        .unwrap();
    assert!(
        out.lock().unwrap().iter().all(Result::is_err),
        "first-flight ticket timeout must not rerun later-deadline peers"
    );
    assert_eq!(counts.load(Ordering::SeqCst), 0);
    assert_eq!(digest(&mut engine), before);
}

#[test]
#[ignore = "private Postgres"]
fn g72_unacknowledged_preparation_rollback_makes_g6_uncertainty_sticky() {
    for pipelined in [false, true] {
        use crate::engine::{
            postgres::read_grant::{Grant, Published, boottime},
            program_batch::fault,
        };
        let Some(clock) = boottime() else {
            eprintln!("G6 preparation witness requires Linux CLOCK_BOOTTIME");
            return;
        };
        let mut engine = fixture(true);
        let mut control = observer(&mut engine);
        let pid: i32 = engine
            .store_mut()
            .test_postgres_handle_mut()
            .store
            .get_mut()
            .client
            .query_one("SELECT pg_backend_pid()", &[])
            .unwrap()
            .get(0);
        eprintln!("G72 preparation witness owns backend PID {pid}");
        let grant = Arc::new(Grant::default());
        grant.configured.store(true, Ordering::Release);
        grant.until.store(
            (clock + Duration::from_secs(30)).as_nanos() as u64,
            Ordering::Release,
        );
        {
            let mut state = grant.state.write().unwrap();
            state.epoch = Some("before-unknown".into());
            state.published = Some(Published {
                revision: 2,
                head: 2,
                store: engine.store_id.clone(),
                generation: engine.generation as i64,
                schema: String::new(),
                code: String::new(),
            });
        }
        engine
            .store_mut()
            .test_postgres_handle_mut()
            .store
            .get_mut()
            .read_grant = Some(grant.clone());
        let mut batch = members(0);
        batch[0] = item(0).instrument(move |run| {
            run();
            assert!(
                control
                    .query_one("SELECT pg_terminate_backend($1)", &[&pid])
                    .unwrap()
                    .get::<_, bool>(0)
            );
        });
        let mut lane = Lane::new();
        let results = Arc::new(Mutex::new(Vec::new()));
        let out = results.clone();
        fault::inject(fault::Point::AfterMember, 0, || {
            if pipelined {
                lane.start(
                    &mut engine,
                    batch,
                    Box::new(move |_, v| *out.lock().unwrap() = v),
                );
            } else {
                *out.lock().unwrap() = engine.invoke_program_batch(&mut batch);
            }
        });
        lane.drain(&mut engine);
        assert!(results.lock().unwrap().iter().all(|v| {
            v.as_ref()
                .err()
                .is_some_and(|e| e.code == "E_COMMIT_OUTCOME_UNKNOWN")
        }));
        assert!(
            grant.uncertain.load(Ordering::Acquire),
            "an unacknowledged preparation rollback must close G6 before any final was dispatched"
        );
        let state = grant.state.read().unwrap();
        assert!(state.epoch.is_none() && state.published.is_none());
        assert_eq!(state.inflight, 0);
        drop(state);
        assert!(grant.read().is_none());
        assert!(engine.store_mut().transaction().is_err());
    }
}
