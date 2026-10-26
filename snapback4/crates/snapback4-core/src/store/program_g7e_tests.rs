//! E runs on the real depth-two product lane, with a held marker rather than
//! an artificial durable-point advance.
use super::*;
use crate::engine::program_pipeline::Lane;
use postgres::{Client, NoTls};
use std::sync::{Arc, Mutex, mpsc};
fn control(engine: &mut Engine) -> Client {
    let ns: String = engine
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0);
    let mut c = Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), NoTls).unwrap();
    c.batch_execute(&format!(
        "SET search_path={ns},pg_catalog;SET statement_timeout='10s';SET lock_timeout='10s'"
    ))
    .unwrap();
    c
}
fn enabled() -> Engine {
    let mut e = fixture(true);
    e.store_mut().enable_postgres_early_lock_release().unwrap();
    e
}
fn member(i: usize) -> Invocation {
    let mut v = Invocation::new(
        "guarded",
        Some(format!("g7e-{i}")),
        Context::new(
            "alice",
            [
                ("counter".into(), Value::Id("shared".into())),
                ("delta".into(), Value::Int(1)),
                ("reject".into(), Value::Bool(false)),
            ]
            .into(),
        )
        .at(1000 + i as i64),
    );
    v.deadline = Instant::now() + Duration::from_secs(10);
    v
}
fn batch(start: usize) -> Vec<Invocation> {
    (start..start + 8).map(member).collect()
}
fn head(c: &mut Client) -> (i64, i64, String) {
    let r = c
        .query_one(
            "SELECT seq,revision,attempt FROM _head WHERE singleton",
            &[],
        )
        .unwrap();
    (r.get(0), r.get(1), r.get(2))
}
fn wait(mut f: impl FnMut() -> bool) {
    let until = Instant::now() + Duration::from_secs(10);
    while !f() {
        assert!(Instant::now() < until, "E rendezvous");
        std::thread::sleep(Duration::from_millis(1));
    }
}
fn counter(c: &mut Client) -> i64 {
    let text: String = c
        .query_one("SELECT data FROM r WHERE t='counters' AND id='shared'", &[])
        .unwrap()
        .get(0);
    serde_json::from_str::<Value>(&text)
        .unwrap()
        .field("n")
        .unwrap()
        .as_int()
        .unwrap()
}
fn held_marker(c: &mut Client) -> i64 {
    let key = (crate::ids::seed() & i64::MAX as u64) as i64;
    c.query_one("SELECT pg_advisory_lock($1)", &[&key]).unwrap();
    c.batch_execute(&format!("CREATE FUNCTION e_hold() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_advisory_xact_lock({key});RETURN NEW;END $f$; CREATE TRIGGER e_hold BEFORE UPDATE ON _durable FOR EACH ROW EXECUTE FUNCTION e_hold()")).unwrap();
    key
}
fn release(c: &mut Client, key: i64) {
    c.query_one("SELECT pg_advisory_unlock($1)", &[&key])
        .unwrap();
}
#[test]
#[ignore = "private PG16"]
fn g7e_data_is_visible_before_marker_but_reply_and_reader_wait_for_flush() {
    let mut e = enabled();
    let mut c = control(&mut e);
    let mut lane = Lane::new();
    lane.start(
        &mut e,
        batch(100),
        Box::new(|_, r| assert!(r.iter().all(Result::is_ok))),
    );
    lane.drain(&mut e);
    let prior = head(&mut c);
    let reader = e.reader().unwrap();
    let key = held_marker(&mut c);
    let result = Arc::new(Mutex::new(Vec::new()));
    let out = result.clone();
    lane.start(
        &mut e,
        batch(0),
        Box::new(move |_, r| out.lock().unwrap().extend(r)),
    );
    wait(|| head(&mut c).1 > prior.1);
    let owner_lock:bool=c.query_one("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE relation='_owner'::regclass AND mode='RowShareLock' AND granted)",&[]).unwrap().get(0);
    assert!(!owner_lock, "an E marker must run outside the owner fence");
    let (send, receive) = mpsc::channel();
    let t = std::thread::spawn(move || send.send(reader.store().rows("counters")).unwrap());
    let early = receive.recv_timeout(Duration::from_millis(35));
    let early_debug = format!("{early:?}");
    assert!(result.lock().unwrap().is_empty());
    release(&mut c, key);
    lane.drain(&mut e);
    let late = if let Ok(value) = early {
        value
    } else {
        receive.recv_timeout(Duration::from_secs(1)).unwrap()
    };
    t.join().unwrap();
    assert!(
        early_debug.starts_with("Err(Timeout)"),
        "reader completed before certification: {early_debug}"
    );
    assert!(late.is_ok(), "{late:?}");
    assert!(result.lock().unwrap().iter().all(Result::is_ok));
    assert_eq!(
        c.query_one("SELECT sum(n)::bigint FROM _durable", &[])
            .unwrap()
            .get::<_, Option<i64>>(0),
        Some(2)
    );
}
#[test]
#[ignore = "private PG16"]
fn g7e_marker_update_zero_and_error_after_commit_are_unknown_never_rerun() {
    for mode in ["zero", "error", "warning"] {
        let mut e = enabled();
        let mut c = control(&mut e);
        let mut lane = Lane::new();
        lane.start(
            &mut e,
            batch(100),
            Box::new(|_, r| assert!(r.iter().all(Result::is_ok))),
        );
        lane.drain(&mut e);
        let prior = head(&mut c);
        if mode == "zero" {
            c.execute("DELETE FROM _durable", &[]).unwrap();
        } else if mode == "error" {
            c.batch_execute("CREATE FUNCTION e_fail() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'marker after COMMIT' USING ERRCODE='23514';END $f$;CREATE TRIGGER e_fail BEFORE UPDATE ON _durable FOR EACH ROW EXECUTE FUNCTION e_fail()").unwrap();
        }
        if mode == "warning" {
            c.batch_execute("CREATE FUNCTION e_fail() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE WARNING 'canceling wait for synchronous replication' USING ERRCODE='57014';RETURN NEW;END $f$;CREATE TRIGGER e_fail BEFORE UPDATE ON _durable FOR EACH ROW EXECUTE FUNCTION e_fail()").unwrap();
        }
        let result = Arc::new(Mutex::new(Vec::new()));
        let out = result.clone();
        lane.start(
            &mut e,
            batch(0),
            Box::new(move |_, r| out.lock().unwrap().extend(r)),
        );
        lane.drain(&mut e);
        let result = result.lock().unwrap();
        assert_eq!(result.len(), 8);
        assert!(
            result
                .iter()
                .all(|r| matches!(r,Err(r) if r.code=="E_COMMIT_OUTCOME_UNKNOWN")),
            "{mode}: {result:?}"
        );
        let after = head(&mut c);
        assert_eq!(after.1, prior.1 + 8, "no replay after data COMMIT");
        assert_eq!(
            c.query_one(
                "SELECT count(*) FROM _ops WHERE id=ANY($1)",
                &[&(0..8).map(|i| format!("g7e-{i}")).collect::<Vec<_>>()]
            )
            .unwrap()
            .get::<_, i64>(0),
            8
        );
        if mode != "zero" {
            c.batch_execute("DROP TRIGGER e_fail ON _durable;DROP FUNCTION e_fail()")
                .unwrap();
            e.store_mut().recover_durability().unwrap();
        }
        assert!(
            !e.store().durability().unwrap().broken(),
            "drained recovery must rebuild D"
        );
        assert!(e.store().rows("counters").is_ok());
    }
}
#[test]
#[ignore = "private PG16"]
fn g7e_role_default_off_still_certifies_barriers_and_marker_and_three_flights() {
    let mut e = fixture_with_sync(true, true);
    e.store_mut().enable_postgres_early_lock_release().unwrap();
    let mut c = control(&mut e);
    e.store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .batch_execute("SET synchronous_commit=off")
        .unwrap();
    let tx = e.store_mut().transaction().unwrap();
    tx.commit().unwrap();
    for warm in 0..2 {
        let mut v = batch(warm * 8);
        assert!(e.invoke_program_batch(&mut v).iter().all(Result::is_ok));
    }
    let scope = crate::round_trips::Scope::begin();
    let mut v = batch(16);
    let result = e.invoke_program_batch(&mut v);
    let flights = scope.counts().postgres;
    drop(scope);
    assert!(result.iter().all(Result::is_ok), "{result:?}");
    assert_eq!(flights, 3, "marker shares the third flight");
    assert_eq!(
        c.query_one("SELECT sum(n)::bigint FROM _durable", &[])
            .unwrap()
            .get::<_, Option<i64>>(0),
        Some(3)
    );
}

#[test]
#[ignore = "private PG16"]
fn g7e_idle_solo_rt0_keeps_the_synchronous_budget() {
    let mut flights = Vec::new();
    for early in [false, true] {
        let mut e = fixture(true);
        if early {
            e.store_mut().enable_postgres_early_lock_release().unwrap();
        }
        for n in 100..103 {
            assert!(e.invoke_program(&mut member(n)).is_ok());
        }
        let scope = crate::round_trips::Scope::begin();
        assert!(e.invoke_program(&mut member(103)).is_ok());
        flights.push(scope.counts().postgres);
    }
    eprintln!("E idle N=1 warm flights S/E={flights:?}");
    assert_eq!(
        flights[1], flights[0],
        "E must not add a head-sampling flight to idle N=1: S/E={flights:?}"
    );
}
#[test]
#[ignore = "private PG16"]
fn g7e_recovery_writes_a_new_attempt_without_advancing_public_head_or_revision() {
    let mut e = enabled();
    let mut c = control(&mut e);
    let before = head(&mut c);
    let d = e.store().durability().unwrap();
    d.break_history();
    assert!(e.store().rows("counters").is_err());
    let mut lane = Lane::new();
    lane.drain(&mut e);
    let after = head(&mut c);
    assert_eq!((before.0, before.1), (after.0, after.1));
    assert_ne!(before.2, after.2);
    assert!(!d.broken());
    assert!(e.store().rows("counters").is_ok());
}
#[test]
#[ignore = "private PG16"]
fn g7e_two_slots_fold_and_release_in_order_with_markers() {
    let mut e = enabled();
    let mut c = control(&mut e);
    let mut lane = Lane::new();
    lane.start(
        &mut e,
        batch(100),
        Box::new(|_, r| assert!(r.iter().all(Result::is_ok))),
    );
    lane.drain(&mut e);
    let key = held_marker(&mut c);
    let prior = head(&mut c);
    let released = Arc::new(Mutex::new(Vec::new()));
    crate::engine::committer::closure::PLAN_BUILDS.with(|count|count.set(0));
    for n in [0, 8] {
        let r = released.clone();
        lane.start(
            &mut e,
            batch(n),
            Box::new(move |_, out| {
                assert!(out.iter().all(Result::is_ok), "{out:?}");
                r.lock().unwrap().push(n);
            }),
        );
    }
    wait(|| head(&mut c).1 == prior.1 + 16);
    assert!(released.lock().unwrap().is_empty());
    release(&mut c, key);
    lane.drain(&mut e);
    assert_eq!(*released.lock().unwrap(), vec![0, 8]);
    assert_eq!(counter(&mut c), 24);
    assert_eq!(crate::engine::committer::closure::PLAN_BUILDS.with(|count|count.get()),16,
        "E certification and ordered release must retain one plan per member");
}

#[test]
#[ignore = "private PG16"]
fn g7e_unknown_predecessor_discards_an_already_certified_successor() {
    use crate::engine::postgres::writer_slot::Point;
    let mut e = enabled();
    let mut c = control(&mut e);
    let mut lane = Lane::new();
    lane.start(
        &mut e,
        batch(100),
        Box::new(|_, out| assert!(out.iter().all(Result::is_ok))),
    );
    lane.drain(&mut e); // ordinal 0 used marker slot 0.
    let key = (crate::ids::seed() & i64::MAX as u64) as i64;
    c.query_one("SELECT pg_advisory_lock($1)", &[&key]).unwrap();
    // Hold only the lower marker. The upper marker must confirm first, so
    // its successful result is already waiting when the lower becomes unknown.
    c.batch_execute(&format!("CREATE FUNCTION e_lower_fail() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF OLD.slot=1 THEN PERFORM pg_advisory_xact_lock({key});RAISE EXCEPTION 'lower marker after COMMIT' USING ERRCODE='23514';END IF;RETURN NEW;END $f$;CREATE TRIGGER e_lower_fail BEFORE UPDATE ON _durable FOR EACH ROW EXECUTE FUNCTION e_lower_fail()")).unwrap();
    let (send, receive) = mpsc::channel();
    let send = Mutex::new(send);
    lane.hook = Some(Arc::new(move |w| {
        if w.ordinal == 2 && w.point == Point::AfterCommit {
            send.lock().unwrap().send(()).unwrap();
        }
        Ok(())
    }));
    let results = Arc::new(Mutex::new(Vec::new()));
    for start in [0, 8] {
        let out = results.clone();
        lane.start(
            &mut e,
            batch(start),
            Box::new(move |_, values| out.lock().unwrap().push((start, values))),
        );
    }
    receive
        .recv_timeout(Duration::from_secs(5))
        .expect("upper marker certified while lower is held");
    assert!(
        results.lock().unwrap().is_empty(),
        "FIFO reply release precedes the lower result"
    );
    c.query_one("SELECT pg_advisory_unlock($1)", &[&key])
        .unwrap();
    lane.drain(&mut e);
    let results = results.lock().unwrap();
    assert_eq!(
        results.iter().map(|(start, _)| *start).collect::<Vec<_>>(),
        [0, 8]
    );
    assert!(
        results.iter().all(|(_, values)| values
            .iter()
            .all(|v| matches!(v, Err(e) if e.code=="E_COMMIT_OUTCOME_UNKNOWN"))),
        "a certificate in the discarded epoch escaped: {results:?}"
    );
    assert_eq!(
        counter(&mut c),
        24,
        "both data commits happened exactly once"
    );
    c.batch_execute("DROP TRIGGER e_lower_fail ON _durable;DROP FUNCTION e_lower_fail()")
        .unwrap();
    e.store_mut().recover_durability().unwrap();
    assert!(e.store().rows("counters").is_ok());
}

#[test]
#[ignore = "private PG16"]
fn g7e_connection_drop_at_each_slot_boundary_never_replays_unknown_data() {
    use crate::engine::postgres::writer_slot::Point;
    for point in [
        Point::BeforeFinal,
        Point::AfterTail,
        Point::BeforeCommit,
        Point::AfterCommit,
    ] {
        let mut e = enabled();
        let mut c = control(&mut e);
        let prior = head(&mut c);
        let tag: String = e
            .store_mut()
            .test_postgres_handle_mut()
            .store
            .get_mut()
            .client
            .query_one("SELECT current_setting('application_name')", &[])
            .unwrap()
            .get(0);
        let killer = control(&mut e);
        let (send, recv) = mpsc::channel();
        let state = Mutex::new((killer, Some(send)));
        let mut lane = Lane::new();
        lane.hook = Some(Arc::new(move |w| {
            if w.point == point {
                let mut state = state.lock().unwrap();
                let rows=state.0.query("SELECT pid FROM pg_stat_activity WHERE backend_xid::text=$1 OR (query LIKE 'SET LOCAL synchronous_commit=off; COMMIT;%' AND application_name=$2 AND state='idle')",&[&w.xid,&tag]).unwrap();
                // At AfterCommit the backend xid is gone: the injected missing
                // confirmation below still establishes unknown, with no replay.
                for row in rows {
                    let pid: i32 = row.get(0);
                    state
                        .0
                        .query_one("SELECT pg_terminate_backend($1)", &[&pid])
                        .unwrap();
                }
                if let Some(s) = state.1.take() {
                    s.send(w.xid.clone()).unwrap();
                }
                return Err(crate::RuntimeError::CommitOutcomeUnknown(
                    "injected lost transport confirmation".into(),
                ));
            }
            Ok(())
        }));
        let output = Arc::new(Mutex::new(Vec::new()));
        let out = output.clone();
        lane.start(
            &mut e,
            batch(0),
            Box::new(move |_, r| out.lock().unwrap().extend(r)),
        );
        lane.drain(&mut e);
        let xid = recv.recv_timeout(Duration::from_secs(1)).unwrap();
        let known_rerun = output.lock().unwrap().iter().all(Result::is_ok);
        let unknown = output
            .lock()
            .unwrap()
            .iter()
            .all(|r| matches!(r,Err(r) if r.code=="E_COMMIT_OUTCOME_UNKNOWN"));
        assert!(
            known_rerun || unknown,
            "{point:?}: {:?}",
            output.lock().unwrap()
        );
        if point == Point::AfterCommit {
            assert!(unknown, "a committed xid must never rerun");
        }
        let status: String = c
            .query_one("SELECT pg_xact_status($1::text::xid8)", &[&xid])
            .unwrap()
            .get(0);
        assert_eq!(
            status,
            if point == Point::AfterCommit {
                "committed"
            } else {
                "aborted"
            }
        );
        assert_eq!(
            head(&mut c).1,
            prior.1
                + if point == Point::AfterCommit || known_rerun {
                    8
                } else {
                    0
                }
        );
    }
}

// The Python matrix owns the process/PG signals and checks the flushed ack file.
// This helper only writes a rendezvous after one acknowledged prefix, then holds
// the next flight. No process can report a second acknowledgement at the hold.
#[test]
#[ignore = "subprocess helper for scripts/test-g7e-crash.py"]
fn g7e_crash_child() {
    let Ok(path) = std::env::var("SNAPBACK4_G7E_CRASH_RECORD") else {
        return;
    };
    let mode = std::env::var("SNAPBACK4_G7E_CRASH_POINT").unwrap();
    let mut e = fixture_with_sync(true, true);
    e.store_mut().enable_postgres_early_lock_release().unwrap();
    let mut c = control(&mut e);
    let mut lane = Lane::new();
    lane.start(
        &mut e,
        batch(0),
        Box::new(|_, r| assert!(r.iter().all(Result::is_ok))),
    );
    lane.drain(&mut e);
    // Warm the other physical slot with replay of the same eight keys, keeping
    // eight unique acknowledged writes. The faulted batch then has exactly the
    // qualified three flights, with complete public sync images in its tail.
    lane.start(
        &mut e,
        batch(0),
        Box::new(|_, out| assert!(out.iter().all(Result::is_ok))),
    );
    lane.drain(&mut e);
    let ns: String = c.query_one("SELECT current_schema()", &[]).unwrap().get(0);
    let record = serde_json::json!({"schema":ns,"acknowledged":8,"head":head(&mut c),"pid":std::process::id(),"point":mode});
    let write = |record: &serde_json::Value| {
        use std::io::Write;
        let tmp = format!("{path}.tmp");
        let mut file = std::fs::File::create(&tmp).unwrap();
        file.write_all(&serde_json::to_vec(record).unwrap())
            .unwrap();
        file.sync_all().unwrap();
        std::fs::rename(tmp, &path).unwrap();
    };
    if mode == "marker" {
        let r = e.reader().unwrap();
        let _key = held_marker(&mut c);
        let before = head(&mut c).1;
        let resume = std::env::var_os("SNAPBACK4_G7E_RESUME_AFTER_PG_CRASH").is_some();
        let mut pending = batch(8);
        if resume {
            for i in &mut pending {
                i.deadline = Instant::now() + Duration::from_secs(1);
            }
        }
        lane.start(
            &mut e,
            pending,
            Box::new(move |_, _| {
                if !resume {
                    panic!("unconfirmed suffix released");
                }
            }),
        );
        wait(|| head(&mut c).1 > before);
        let lost = head(&mut c);
        let mut marked = record.clone();
        marked["lost_head"] = serde_json::json!(lost);
        let (send, receive) = mpsc::channel();
        let t = std::thread::spawn(move || send.send(r.store().rows("counters").is_ok()).unwrap());
        assert!(receive.recv_timeout(Duration::from_millis(30)).is_err());
        write(&marked);
        let released = receive
            .recv_timeout(Duration::from_secs(2))
            .unwrap_or(false);
        assert!(!released, "reader emitted from uncertified suffix");
        t.join().unwrap();
        if resume {
            wait(|| std::path::Path::new(&format!("{path}.resume")).exists());
            std::thread::sleep(Duration::from_millis(1200));
            lane.drain(&mut e);
            assert!(
                !e.store().durability().unwrap().broken(),
                "live recovery must rebuild D"
            );
            let mut current =
                Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), NoTls).unwrap();
            current
                .batch_execute(&format!("SET search_path={ns},pg_catalog"))
                .unwrap();
            assert!(
                head(&mut current).1 < lost.1,
                "expired aborted callers must not rerun"
            );
            let mut fresh = batch(16);
            for i in &mut fresh {
                i.context.args.insert("delta".into(), Value::Int(2));
            }
            lane.start(
                &mut e,
                fresh,
                Box::new(|_, out| assert!(out.iter().all(Result::is_ok))),
            );
            lane.drain(&mut e);
            let reused = head(&mut current);
            assert_eq!(reused.1, lost.1);
            assert_ne!(reused.2, lost.2);
            assert_eq!(counter(&mut current), 24);
            use std::io::Write;
            let temporary = format!("{path}.resumed.tmp");
            let mut f = std::fs::File::create(&temporary).unwrap();
            f.write_all(&serde_json::to_vec(&serde_json::json!({"revision_reused":true,"old_attempt":lost.2,"new_attempt":reused.2,"held_reader_released":false,"counter":24})).unwrap()).unwrap();
            f.sync_all().unwrap();
            std::fs::rename(temporary, format!("{path}.resumed")).unwrap();
        }
    } else {
        use crate::engine::postgres::writer_slot::Point;
        let point = match mode.as_str() {
            "p1" => Point::BeforeFinal,
            "tail" => Point::AfterTail,
            "commit" => Point::BeforeCommit,
            "certificate" => Point::AfterCommit,
            _ => panic!("unknown crash point"),
        };
        let (send, receive) = mpsc::channel();
        let send = Mutex::new(Some(send));
        lane.hook = Some(Arc::new(move |w| {
            if w.point == point {
                if let Some(s) = send.lock().unwrap().take() {
                    s.send(()).unwrap();
                }
                std::thread::park_timeout(Duration::from_secs(60));
            }
            Ok(())
        }));
        lane.start(
            &mut e,
            batch(8),
            Box::new(|_, _| panic!("held suffix released")),
        );
        receive.recv_timeout(Duration::from_secs(10)).unwrap();
        write(&record);
    }
    std::thread::park_timeout(Duration::from_secs(60));
    panic!("crash controller did not terminate child");
}

#[test]
#[ignore = "private PG16"]
fn g7e_takeover_during_marker_flushes_data_and_provisions_without_old_row_wait() {
    use crate::store_port::{AnyStore, LeasePolicy, StoreLease};
    let mut bootstrap = fixture(true);
    let mut c = control(&mut bootstrap);
    let namespace: String = c.query_one("SELECT current_schema()", &[]).unwrap().get(0);
    let id = bootstrap.store_id.clone();
    drop(bootstrap);
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let mut old =
        StoreLease::connect(&connection, &namespace, &id, "7e01", LeasePolicy::default()).unwrap();
    old.acquire().unwrap().unwrap();
    let mut e = Engine::open_at(
        AnyStore::open_postgres_owned(&connection, &namespace, &old).unwrap(),
        1000,
    )
    .unwrap();
    e.store_mut().enable_postgres_early_lock_release().unwrap();
    let old_d = e.store().durability().unwrap();
    let mut lane = Lane::new();
    lane.start(
        &mut e,
        batch(100),
        Box::new(|_, r| assert!(r.iter().all(Result::is_ok))),
    );
    lane.drain(&mut e);
    let reader = e.reader().unwrap();
    let mut next =
        StoreLease::connect(&connection, &namespace, &id, "7e02", LeasePolicy::default()).unwrap();
    let before = head(&mut c);
    let key = held_marker(&mut c);
    let output = Arc::new(Mutex::new(Vec::new()));
    let out = output.clone();
    lane.start(
        &mut e,
        batch(0),
        Box::new(move |_, r| out.lock().unwrap().extend(r)),
    );
    wait(|| head(&mut c).1 == before.1 + 8);
    c.execute(
        "UPDATE _owner SET lease_until='-infinity' WHERE singleton",
        &[],
    )
    .unwrap();
    let acquired = next.acquire().unwrap().unwrap();
    assert_eq!(acquired.token, old.token().unwrap() + 1);
    lane.drain(&mut e);
    assert!(
        output
            .lock()
            .unwrap()
            .iter()
            .all(|r| matches!(r,Err(r) if r.code=="E_COMMIT_OUTCOME_UNKNOWN"))
    );
    assert!(old_d.broken());
    assert!(reader.store().rows("counters").is_err());
    release(&mut c, key);
    c.batch_execute("DROP TRIGGER e_hold ON _durable;DROP FUNCTION e_hold()")
        .unwrap();
    let mut stale = Client::connect(&connection, NoTls).unwrap();
    stale.batch_execute(&format!("SET search_path={namespace},pg_catalog;BEGIN;SET LOCAL synchronous_commit=on;UPDATE _durable SET n=n+1 WHERE token={} AND slot=0",old.token().unwrap())).unwrap();
    let mut current = AnyStore::open_postgres_owned(&connection, &namespace, &next).unwrap();
    let started = Instant::now();
    current.enable_postgres_early_lock_release().unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "old token marker blocked provisioning"
    );
    let d = current.durability().unwrap();
    let epoch = d.epoch();
    let after = head(&mut c);
    stale.batch_execute("COMMIT").unwrap();
    assert_eq!(d.epoch(), epoch);
    assert_eq!(head(&mut c), after);
    assert_eq!(counter(&mut c), 16);
    assert!(current.rows("counters").is_ok());
}

#[test]
#[ignore = "subprocess restart verifier for scripts/test-g7e-crash.py"]
fn g7e_restart_child_rebuilds_d_before_receipt_or_row_output() {
    use crate::{receipts::ReceiptReader, store_port::AnyStore};
    let Ok(namespace) = std::env::var("SNAPBACK4_G7E_RESTART_NAMESPACE") else {
        return;
    };
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let mut e = Engine::open_at(
        AnyStore::open_postgres(&connection, &namespace).unwrap(),
        1000,
    )
    .unwrap();
    e.store_mut().enable_postgres_early_lock_release().unwrap();
    assert!(!e.store().durability().unwrap().broken());
    for i in 0..8 {
        assert!(
            e.store()
                .receipt("alice", &format!("g7e-{i}"))
                .unwrap()
                .is_some()
        );
    }
    assert!(e.store().rows("counters").is_ok());
}

#[test]
#[ignore = "private PG16"]
fn g7e_idle_reader_connection_loss_rebuilds_d_without_a_queued_operation() {
    use crate::engine::command::Queue;
    let mut e = enabled();
    let mut c = control(&mut e);
    let mut reader = e.reader().unwrap();
    let pid: i32 = reader
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .query_one("SELECT pg_backend_pid()", &[])
        .unwrap()
        .get(0);
    let gate = e.store().durability().unwrap();
    let epoch = gate.epoch();
    let before = head(&mut c);
    let queue = Queue::start_fixed(e, 64, 8).unwrap();
    assert!(
        c.query_one("SELECT pg_terminate_backend($1)", &[&pid])
            .unwrap()
            .get::<_, bool>(0)
    );
    wait(|| gate.epoch() > epoch && !gate.broken());
    assert_ne!(
        before.2,
        head(&mut c).2,
        "idle recovery must persist its new attempt"
    );
    // Replacing the failed logical handle may observe the same loss again.
    // The idle worker also reconciles that bump without requiring a write.
    if reader.store().rows("counters").is_err() {
        wait(|| !gate.broken());
    }
    assert!(reader.store().rows("counters").is_ok());
    drop(queue);
}

// @ref LLP 3000.009.001.000.000.002#4.2 — an uncertified predecessor never authorizes the innocent cascade rerun.
#[test]
#[ignore = "private PG16"]
fn g7e_successor_own_failure_after_unconfirmed_predecessor_uses_member_recovery() {
    use crate::engine::program_batch::fault;
    use std::sync::atomic::{AtomicUsize, Ordering};
    let mut e = enabled();
    let mut c = control(&mut e);
    // Qualify both writer slots before installing the intentional interception.
    let mut lane = Lane::new();
    lane.start(
        &mut e,
        batch(100),
        Box::new(|_, r| assert!(r.iter().all(Result::is_ok))),
    );
    lane.drain(&mut e);
    let key = held_marker(&mut c);
    c.batch_execute("CREATE FUNCTION e_fail() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'marker after COMMIT' USING ERRCODE='23514';END $f$;CREATE TRIGGER z_e_fail BEFORE UPDATE ON _durable FOR EACH ROW EXECUTE FUNCTION e_fail()").unwrap();
    let prior = head(&mut c);
    let predecessor = Arc::new(Mutex::new(Vec::new()));
    let out = predecessor.clone();
    lane.start(
        &mut e,
        batch(0),
        Box::new(move |_, r| *out.lock().unwrap() = r),
    );
    wait(|| head(&mut c).1 > prior.1);
    let attempts = Arc::new(AtomicUsize::new(0));
    let observed = attempts.clone();
    let successor = Arc::new(Mutex::new(Vec::new()));
    let out = successor.clone();
    fault::with_check_hook(
        move |point, index| {
            if point == fault::Point::AfterMember && index == 1 {
                observed.fetch_add(1, Ordering::SeqCst);
                release(&mut c, key);
                // Wait for the marker transaction to fail, then remove the test
                // interception so fenced D recovery can legitimately proceed.
                c.batch_execute("DROP TRIGGER e_hold ON _durable; DROP TRIGGER z_e_fail ON _durable; DROP FUNCTION e_hold(); DROP FUNCTION e_fail()").unwrap();
                return Err(crate::RuntimeError::Store(
                    "successor member failure".into(),
                ));
            }
            Ok(())
        },
        || {
            lane.start(
                &mut e,
                batch(8),
                Box::new(move |_, r| *out.lock().unwrap() = r),
            );
            lane.drain(&mut e);
        },
    );
    assert_eq!(
        attempts.load(Ordering::SeqCst),
        1,
        "named failed member must never enter a cascade rerun"
    );
    assert_eq!(predecessor.lock().unwrap().len(), 8);
    assert!(
        predecessor
            .lock()
            .unwrap()
            .iter()
            .all(|r| matches!(r, Err(r) if r.code == "E_COMMIT_OUTCOME_UNKNOWN"))
    );
    let successor = successor.lock().unwrap();
    assert_eq!(successor.len(), 8);
    for (index, result) in successor.iter().enumerate() {
        assert_eq!(result.is_ok(), index != 1, "{successor:?}");
    }
    let mut c = control(&mut e);
    assert_eq!(
        counter(&mut c),
        23,
        "warmup, committed predecessor and seven recovered peers, exactly once"
    );
    assert_eq!(head(&mut c).1, prior.1 + 15);
    assert!(
        e.store().rows("counters").is_ok(),
        "recovered peer commits must advance D"
    );
}
