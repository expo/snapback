//! Depth-two witnesses use the real slots and a deliberately held predecessor.
#[path = "program_g72_recovery_tests.rs"]
mod recovery_tests;
use super::*;
use crate::engine::program_pipeline::Lane;
use postgres::{Client, NoTls};
use std::sync::{Arc, Mutex};
fn observer(engine: &mut Engine) -> Client {
    let handle = engine.store_mut().test_postgres_handle_mut();
    let schema: String = handle
        .store
        .get_mut()
        .client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0);
    let mut client =
        Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), NoTls).unwrap();
    client
        .batch_execute(&format!(
            "SET search_path={schema},pg_catalog;SET statement_timeout='10s';SET lock_timeout='10s'"
        ))
        .unwrap();
    client
}
fn wait(mut condition: impl FnMut() -> bool) {
    let until = Instant::now() + Duration::from_secs(10);
    while !condition() {
        assert!(Instant::now() < until, "held-chain rendezvous");
        std::thread::sleep(Duration::from_millis(1));
    }
}
fn item(i: usize) -> Invocation {
    let mut invocation = Invocation::new(
        "guarded",
        Some(format!("g72-{i}")),
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
    invocation.deadline = Instant::now() + Duration::from_secs(10);
    invocation
}
fn members(start: usize) -> Vec<Invocation> {
    (start..start + 8).map(item).collect()
}
#[test]
#[ignore = "private Postgres"]
fn g72_held_chain_folds_before_predecessor_commits_and_releases_in_order() {
    let mut engine = fixture(true);
    let mut client = observer(&mut engine);
    let mut lane = Lane::new();
    let released = Arc::new(Mutex::new(Vec::new()));
    let hold = Hold::new();
    let events = install_hook(&mut lane, Point::AfterTail, hold.clone(), false);
    let output = Arc::new(Mutex::new(Vec::new()));
    crate::engine::committer::closure::PLAN_BUILDS.with(|count|count.set(0));
    for start in [0, 8] {
        let r = released.clone();
        let o = output.clone();
        let batch = members(start);
        let mut plans = (0..batch.len()).map(|_|None).collect();
        assert!(Lane::eligible(&engine,&batch,!lane.empty(),&mut plans));
        lane.start_planned(
            &mut engine,
            batch,
            plans,
            Box::new(move |_, out| {
                r.lock().unwrap().push(start);
                o.lock().unwrap().extend(out.into_iter().map(outcome));
            }),
        );
        if start == 0 {
            until_event(&events, 0, Point::AfterTail);
        }
    }
    assert_eq!(lane.len(), 2, "both slots must dispatch while k is held");
    assert!(released.lock().unwrap().is_empty());
    // k+1 owns its ticket while waiting on k, proving P1 and interpretation overlapped COMMIT.
    assert!(client.query_one("SELECT count(DISTINCT pid) FROM pg_locks WHERE locktype='advisory' AND granted AND pid<>pg_backend_pid() AND database=(SELECT oid FROM pg_database WHERE datname=current_database())",&[]).unwrap().get::<_,i64>(0)>=2);
    hold.open();
    lane.drain(&mut engine);
    assert_eq!(*released.lock().unwrap(), vec![0, 8]);
    assert_eq!(crate::engine::committer::closure::PLAN_BUILDS.with(|count|count.get()),16,
        "pipeline classification and chained staging must reuse one plan per member");
    let mut serial = fixture(true);
    let expected = (0..16)
        .map(|i| outcome(serial.invoke_program(&mut item(i))))
        .collect::<Vec<_>>();
    assert_eq!(*output.lock().unwrap(), expected);
    assert_eq!(
        super::super::tests::snapshot(&mut engine),
        super::super::tests::snapshot(&mut serial)
    );
}

use crate::engine::postgres::writer_slot::{Point, Witness};
use std::sync::{
    Condvar,
    atomic::{AtomicUsize, Ordering},
    mpsc,
};
struct Hold {
    state: Mutex<bool>,
    changed: Condvar,
}
impl Hold {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(false),
            changed: Condvar::new(),
        })
    }
    fn wait(&self) {
        let state = self.state.lock().unwrap();
        let (state, result) = self
            .changed
            .wait_timeout_while(state, Duration::from_secs(10), |open| !*open)
            .unwrap();
        assert!(*state && !result.timed_out(), "held slot release");
    }
    fn open(&self) {
        *self.state.lock().unwrap() = true;
        self.changed.notify_all();
    }
}
fn sql_status(client: &mut Client, xid: &str) -> String {
    client
        .query_one("SELECT pg_xact_status($1::text::xid8)", &[&xid])
        .unwrap()
        .get(0)
}
fn digest(engine: &mut Engine) -> serde_json::Value {
    let mut snapshot = super::super::tests::snapshot(engine);
    let mut client = observer(engine);
    let head = client.query_one("SELECT revision,attempt FROM _head WHERE singleton", &[]).unwrap();
    snapshot["revision"] = serde_json::json!(head.get::<_,i64>(0));
    let attempt: String = head.get(1);
    let (_, counter) = attempt.split_once(':').expect("head attempt pair");
    assert!(counter.parse::<u64>().unwrap() > 0);
    snapshot
}
fn contiguous(client: &mut Client) {
    let row=client.query_one("SELECT h.seq,(SELECT max(seq) FROM _commits),(SELECT count(*) FROM _commits) FROM _head h WHERE singleton",&[]).unwrap();
    let seq: i64 = row.get(0);
    assert_eq!(row.get::<_, Option<i64>>(1), Some(seq));
    assert_eq!(row.get::<_, i64>(2), seq);
}
fn install_hook(
    lane: &mut Lane,
    point: Point,
    hold: Arc<Hold>,
    failure: bool,
) -> mpsc::Receiver<Witness> {
    let (send, receive) = mpsc::channel();
    let send = Mutex::new(send);
    lane.hook = Some(Arc::new(move |w| {
        send.lock().unwrap().send(w.clone()).unwrap();
        if w.ordinal % 2 == 0 && w.point == point {
            hold.wait();
            if failure {
                return Err(crate::RuntimeError::Store(
                    "injected known predecessor abort".into(),
                ));
            }
        }
        Ok(())
    }));
    receive
}
fn until_event(events: &mpsc::Receiver<Witness>, ordinal: usize, point: Point) -> Witness {
    loop {
        let w = events.recv_timeout(Duration::from_secs(10)).unwrap();
        if w.ordinal == ordinal && w.point == point {
            return w;
        }
    }
}
#[test]
#[ignore = "private Postgres"]
fn g72_known_abort_cascades_whole_successor_after_both_transactions_end() {
    let mut engine = fixture(true);
    let mut client = observer(&mut engine);
    let mut lane = Lane::new();
    let hold = Hold::new();
    let events = install_hook(&mut lane, Point::AfterTail, hold.clone(), true);
    let output = Arc::new(Mutex::new(Vec::new()));
    let calls = Arc::new(Mutex::new(Vec::new()));
    let counts = Arc::new((0..16).map(|_| AtomicUsize::new(0)).collect::<Vec<_>>());
    for start in [0, 8] {
        let out = output.clone();
        let calls = calls.clone();
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
            Box::new(move |_, values| {
                calls.lock().unwrap().push(start);
                out.lock().unwrap().extend(values.into_iter().map(outcome));
            }),
        );
        if start == 0 {
            until_event(&events, 0, Point::AfterTail);
        }
    }
    let successor = until_event(&events, 1, Point::BeforeFinal);
    assert_eq!(sql_status(&mut client, &successor.xid), "in progress");
    assert!(output.lock().unwrap().is_empty());
    hold.open();
    lane.drain(&mut engine);
    assert_eq!(sql_status(&mut client, &successor.xid), "aborted");
    assert_eq!(*calls.lock().unwrap(), vec![0, 8]);
    assert!(counts.iter().all(|c| c.load(Ordering::SeqCst) == 2));
    let ids = (8..16).map(|i| format!("g72-{i}")).collect::<Vec<_>>();
    assert_eq!(client.query_one("SELECT count(DISTINCT c.xmin::text) FROM _commits c JOIN _ops o USING(seq) WHERE o.id=ANY($1)",&[&ids]).unwrap().get::<_,i64>(0),1,"innocent successor fallback must remain one physical batch");
    let mut serial = fixture(true);
    let expected = (0..16)
        .map(|i| outcome(serial.invoke_program(&mut item(i))))
        .collect::<Vec<_>>();
    assert_eq!(*output.lock().unwrap(), expected);
    assert_eq!(digest(&mut engine), digest(&mut serial));
    contiguous(&mut client);
}
#[test]
#[ignore = "private Postgres"]
fn g72_duplicate_only_successor_still_depends_on_aborted_predecessor() {
    let mut engine = fixture(true);
    let mut client = observer(&mut engine);
    let mut lane = Lane::new();
    let hold = Hold::new();
    let events = install_hook(&mut lane, Point::AfterTail, hold.clone(), true);
    let output = Arc::new(Mutex::new(Vec::new()));
    for start in [0, 0] {
        let out = output.clone();
        lane.start(
            &mut engine,
            members(start),
            Box::new(move |_, values| {
                out.lock()
                    .unwrap()
                    .push(values.into_iter().map(outcome).collect::<Vec<_>>())
            }),
        );
        if lane.len() == 1 {
            until_event(&events, 0, Point::AfterTail);
        }
    }
    let successor = until_event(&events, 1, Point::BeforeFinal);
    hold.open();
    lane.drain(&mut engine);
    assert_eq!(sql_status(&mut client, &successor.xid), "aborted");
    let out = output.lock().unwrap();
    assert_eq!(out.len(), 2);
    assert!(out[1].iter().all(|o| o["replayed"] == true));
    for (a, b) in out[0].iter().zip(&out[1]) {
        assert_eq!(a["seq"], b["seq"]);
    }
    let mut serial = fixture(true);
    for mut i in members(0) {
        serial.invoke_program(&mut i).unwrap();
    }
    assert_eq!(digest(&mut engine), digest(&mut serial));
    contiguous(&mut client);
}
#[test]
#[ignore = "private Postgres"]
fn g72_unknown_predecessor_never_retries_and_successor_confirms_on_its_own() {
    let mut engine = fixture(true);
    let mut client = observer(&mut engine);
    let mut lane = Lane::new();
    let hold = Hold::new();
    let events = install_hook(&mut lane, Point::AfterCommit, hold.clone(), true);
    let output = Arc::new(Mutex::new(Vec::new()));
    for start in [0, 8] {
        let out = output.clone();
        lane.start(
            &mut engine,
            members(start),
            Box::new(move |_, values| out.lock().unwrap().push((start, values))),
        );
        if start == 0 {
            until_event(&events, 0, Point::AfterCommit);
        }
    }
    let successor = until_event(&events, 1, Point::AfterCommit);
    assert_eq!(sql_status(&mut client, &successor.xid), "committed");
    lane.poll(&mut engine, false);
    assert!(output.lock().unwrap().is_empty());
    hold.open();
    lane.drain(&mut engine);
    let out = output.lock().unwrap();
    assert_eq!(out.len(), 2);
    assert_eq!(out[0].0, 0);
    assert!(out[0].1.iter().all(|o| {
        o.as_ref()
            .err()
            .is_some_and(|e| e.code == "E_COMMIT_OUTCOME_UNKNOWN")
    }));
    assert_eq!(out[1].0, 8);
    assert!(out[1].1.iter().all(Result::is_ok));
    let mut serial = fixture(true);
    for mut i in (0..16).map(item) {
        serial.invoke_program(&mut i).unwrap();
    }
    assert_eq!(digest(&mut engine), digest(&mut serial));
    contiguous(&mut client);
}
#[test]
#[ignore = "private Postgres"]
fn g72_ticket_deadline_aborts_without_commit_and_preserves_original_deadline() {
    let mut engine = fixture(true);
    let mut client = observer(&mut engine);
    let mut lane = Lane::new();
    let hold = Hold::new();
    let events = install_hook(&mut lane, Point::AfterTail, hold.clone(), false);
    let output = Arc::new(Mutex::new(Vec::new()));
    let out = output.clone();
    lane.start(
        &mut engine,
        members(0),
        Box::new(move |_, values| out.lock().unwrap().push(values)),
    );
    until_event(&events, 0, Point::AfterTail);
    let mut second = members(8);
    for i in &mut second {
        i.deadline = Instant::now() + Duration::from_millis(100);
    }
    let out = output.clone();
    lane.start(
        &mut engine,
        second,
        Box::new(move |_, values| out.lock().unwrap().push(values)),
    );
    let successor = until_event(&events, 1, Point::BeforeFinal);
    wait(|| sql_status(&mut client, &successor.xid) == "aborted");
    assert!(output.lock().unwrap().is_empty());
    hold.open();
    lane.drain(&mut engine);
    let out = output.lock().unwrap();
    assert!(out[0].iter().all(Result::is_ok));
    assert!(out[1].iter().all(Result::is_err));
    let mut serial = fixture(true);
    for mut i in members(0) {
        serial.invoke_program(&mut i).unwrap();
    }
    assert_eq!(digest(&mut engine), digest(&mut serial));
    contiguous(&mut client);
}

#[test]
#[ignore = "private Postgres"]
fn g72_held_random_histories_match_n1_with_refusals_replays_and_barriers() {
    for seed in [1u64, 19, 0xdecaf] {
        let make = |i: usize| {
            let old = if i > 3 && i % 11 == 0 { i - 3 } else { i };
            let mut invocation = item(old);
            let x = seed
                .wrapping_mul(6364136223846793005)
                .rotate_left((old % 63) as u32)
                .wrapping_add(old as u64 * 797);
            invocation.context.args.insert(
                "counter".into(),
                Value::Id(
                    match x % 4 {
                        0 => "a",
                        1 => "b",
                        _ => "shared",
                    }
                    .into(),
                ),
            );
            invocation
                .context
                .args
                .insert("delta".into(), Value::Int((x % 7) as i64 - 3));
            invocation
                .context
                .args
                .insert("reject".into(), Value::Bool(x % 9 == 0));
            invocation
        };
        let mut expected = fixture(true);
        let expected_out = (0..192)
            .map(|i| outcome(expected.invoke_program(&mut make(i))))
            .collect::<Vec<_>>();
        let mut actual = fixture(true);
        let mut lane = Lane::new();
        let outputs = Arc::new(Mutex::new(Vec::new()));
        let mut next = 0usize;
        let mut random = seed;
        while next < 192 {
            random = random.wrapping_mul(6364136223846793005).wrapping_add(1);
            let remaining = 192 - next;
            if remaining == 1 {
                lane.drain(&mut actual);
                outputs
                    .lock()
                    .unwrap()
                    .push(outcome(actual.invoke_program(&mut make(next))));
                break;
            }
            let first = (1 + ((random >> 32) as usize % 16)).min(remaining - 1);
            let second = (1 + ((random >> 16) as usize % 16)).min(remaining - first);
            let hold = Hold::new();
            let events = install_hook(&mut lane, Point::AfterTail, hold.clone(), false);
            for (offset, size) in [(next, first), (next + first, second)] {
                let out = outputs.clone();
                lane.start(
                    &mut actual,
                    (offset..offset + size).map(make).collect(),
                    Box::new(move |_, values| {
                        out.lock().unwrap().extend(values.into_iter().map(outcome))
                    }),
                );
                if offset == next {
                    loop {
                        let w = events.recv_timeout(Duration::from_secs(10)).unwrap();
                        if w.point == Point::AfterTail {
                            assert_eq!(
                                sql_status(&mut observer(&mut actual), &w.xid),
                                "in progress"
                            );
                            break;
                        }
                    }
                }
            }
            hold.open();
            lane.drain(&mut actual);
            next += first + second;
            if next < 192 && next % 3 == 0 {
                // Every non-program producer is a drained barrier.
                let tx = actual.store_mut().transaction().unwrap();
                tx.rollback().unwrap();
            }
        }
        assert_eq!(*outputs.lock().unwrap(), expected_out, "seed={seed}");
        assert_eq!(digest(&mut actual), digest(&mut expected), "seed={seed}");
    }
}

#[test]
#[ignore = "private Postgres"]
fn g72_mixed_ticket_deadlines_never_retry_later_peers() {
    for predecessor_aborts in [false, true] {
        let mut engine = fixture(true);
        let mut client = observer(&mut engine);
        let mut lane = Lane::new();
        let hold = Hold::new();
        let events = install_hook(
            &mut lane,
            Point::AfterTail,
            hold.clone(),
            predecessor_aborts,
        );
        lane.start(&mut engine, members(0), Box::new(|_, _| {}));
        until_event(&events, 0, Point::AfterTail);
        let counts = Arc::new((0..8).map(|_| AtomicUsize::new(0)).collect::<Vec<_>>());
        let mut second = members(8)
            .into_iter()
            .enumerate()
            .map(|(n, i)| {
                let counts = counts.clone();
                i.instrument(move |run| {
                    counts[n].fetch_add(1, Ordering::SeqCst);
                    run();
                })
            })
            .collect::<Vec<_>>();
        second[0].deadline = Instant::now() + Duration::from_millis(100);
        let output = Arc::new(Mutex::new(Vec::new()));
        let out = output.clone();
        lane.start(
            &mut engine,
            second,
            Box::new(move |_, values| *out.lock().unwrap() = values),
        );
        let successor = until_event(&events, 1, Point::BeforeFinal);
        wait(|| sql_status(&mut client, &successor.xid) == "aborted");
        hold.open();
        lane.drain(&mut engine);
        assert!(output.lock().unwrap().iter().all(Result::is_err));
        assert!(
            counts.iter().all(|c| c.load(Ordering::SeqCst) == 1),
            "no later-deadline peer may retry a ticket timeout"
        );
    }
}

#[test]
#[ignore = "private Postgres"]
fn g72_ownership_loss_while_closing_g6_gate_prevents_final_dispatch() {
    use crate::engine::postgres::read_grant::Grant;
    use std::sync::atomic::AtomicBool;
    let mut engine = fixture(true);
    let mut client = observer(&mut engine);
    let before: i64 = client
        .query_one("SELECT seq FROM _head WHERE singleton", &[])
        .unwrap()
        .get(0);
    let grant = Arc::new(Grant::default());
    grant.configured.store(true, Ordering::Release);
    engine
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .read_grant = Some(grant.clone());
    let read = grant.state.read().unwrap();
    let lost = Arc::new(AtomicBool::new(false));
    let guard = lost.clone();
    let mut batch = members(0);
    // Exercise the same atomic final-dispatch guard installed by ProgramTask,
    // with a long test admission window independent of process startup load.
    batch[0].final_dispatch = Some(Arc::new(move |dispatch| {
        if guard.load(Ordering::SeqCst) {
            Err(crate::RuntimeError::StoreOwnership(
                "ownership lost before final dispatch".into(),
            ))
        } else {
            dispatch();
            Ok(())
        }
    }));
    let worker = std::thread::spawn(move || {
        let mut lane = Lane::new();
        let output = Arc::new(Mutex::new(Vec::new()));
        let out = output.clone();
        lane.start(
            &mut engine,
            batch,
            Box::new(move |_, v| *out.lock().unwrap() = v),
        );
        assert!(lane.empty(), "ownership loss must prevent dispatch");
        let result = output.lock().unwrap().clone();
        (engine, result)
    });
    wait(|| grant.closing.load(Ordering::SeqCst) > 0);
    lost.store(true, Ordering::SeqCst);
    drop(read);
    let (_engine, result) = worker.join().unwrap();
    assert!(result.iter().all(|v| {
        v.as_ref()
            .err()
            .is_some_and(|e| e.code == "E_STORE_OWNERSHIP")
    }));
    assert_eq!(
        client
            .query_one("SELECT seq FROM _head WHERE singleton", &[])
            .unwrap()
            .get::<_, i64>(0),
        before
    );
    assert_eq!(grant.state.read().unwrap().inflight, 0);
}

#[test]
#[ignore = "private Postgres"]
fn g72_probe_timeout_fences_old_writers_then_fresh_token_reopens() {
    use crate::store_port::{LeasePolicy, StoreLease};
    let mut engine = fixture(true);
    let mut client = observer(&mut engine);
    let schema: String = client
        .query_one("SELECT current_schema()", &[])
        .unwrap()
        .get(0);
    let id = engine.store_id.clone();
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let orphan = Arc::new(Mutex::new(None));
    let retained = orphan.clone();
    let cfg = connection.clone();
    let namespace = schema.clone();
    let tag = format!("sb:{id}:0000:0");
    let (sent, events) = mpsc::channel();
    let sent = Mutex::new(sent);
    let mut lane = Lane::new();
    lane.hook = Some(Arc::new(move |w| {
        if w.point == Point::AfterCommit {
            let mut client = Client::connect(&cfg, NoTls).unwrap();
            client
                .batch_execute(&format!(
                    "SET search_path={namespace},pg_catalog;SET lock_timeout='5s';BEGIN"
                ))
                .unwrap();
            client
                .execute("SELECT set_config('application_name',$1,false)", &[&tag])
                .unwrap();
            client
                .query_one(
                    "SELECT token FROM _owner WHERE singleton FOR KEY SHARE",
                    &[],
                )
                .unwrap();
            client
                .query_one("SELECT pg_advisory_xact_lock($1)", &[&w.ticket])
                .unwrap();
            *retained.lock().unwrap() = Some(client);
            sent.lock().unwrap().send(w).unwrap();
            return Err(crate::RuntimeError::Store(
                "synthetic lost confirmation with an affected tagged writer".into(),
            ));
        }
        Ok(())
    }));
    let result = Arc::new(Mutex::new(Vec::new()));
    let out = result.clone();
    lane.start(
        &mut engine,
        members(0),
        Box::new(move |_, values| *out.lock().unwrap() = values),
    );
    let ended = events.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(sql_status(&mut client, &ended.xid), "committed");
    let attempt_before: String = client
        .query_one("SELECT attempt FROM _head WHERE singleton", &[])
        .unwrap()
        .get(0);
    lane.drain(&mut engine);
    assert!(
        lane.paused,
        "failed probe must terminally refuse the old lane"
    );
    assert!(result.lock().unwrap().iter().all(|o| {
        o.as_ref()
            .err()
            .is_some_and(|e| e.code == "E_COMMIT_OUTCOME_UNKNOWN")
    }));
    assert_eq!(
        client
            .query_one("SELECT attempt FROM _head WHERE singleton", &[])
            .unwrap()
            .get::<_, String>(0),
        attempt_before,
        "no reseed before fenced reopen"
    );
    let old_tag = format!("sb:{id}:0000:0");
    wait(|| {
        client
            .query_one(
                "SELECT count(*) FROM pg_stat_activity WHERE application_name=$1",
                &[&old_tag],
            )
            .unwrap()
            .get::<_, i64>(0)
            == 0
    });
    let refused = Arc::new(Mutex::new(Vec::new()));
    let out = refused.clone();
    lane.start(
        &mut engine,
        members(8),
        Box::new(move |_, v| *out.lock().unwrap() = v),
    );
    assert!(refused.lock().unwrap().iter().all(Result::is_err));
    drop(lane);
    drop(engine);
    drop(orphan.lock().unwrap().take());
    let mut lease =
        StoreLease::connect(&connection, &schema, &id, "a072", LeasePolicy::default()).unwrap();
    assert_eq!(lease.acquire().unwrap().unwrap().token, 1);
    let mut reopened =
        Engine::open(AnyStore::open_postgres_owned(&connection, &schema, &lease).unwrap()).unwrap();
    reopened.invoke_program(&mut item(99)).unwrap();
    contiguous(&mut client);
    drop(reopened);
    lease.release().unwrap();
}

#[path = "program_g72_fault_tests.rs"]
mod faults;

#[test]
#[ignore = "private Postgres"]
fn g72_two_slot_rt0_is_three_flights_per_eligible_batch_for_every_n() {
    for g6 in [false, true] {
        for n in [1, 8, 32] {
            let mut engine = fixture(true);
            if g6 {
                let grant = Arc::new(crate::engine::postgres::read_grant::Grant::default());
                grant.configured.store(true, Ordering::Release);
                engine
                    .store_mut()
                    .test_postgres_handle_mut()
                    .store
                    .get_mut()
                    .read_grant = Some(grant);
            }
            let intent = |start: usize, n: usize| {
                (start..start + n)
                    .map(|i| {
                        let mut invocation = Invocation::new(
                            "increment",
                            None,
                            Context::new(
                                "alice",
                                [("counter".into(), Value::Id(format!("k{}", i % 32)))].into(),
                            )
                            .at(1000),
                        );
                        invocation.deadline = Instant::now() + Duration::from_secs(10);
                        invocation
                    })
                    .collect::<Vec<_>>()
            };
            let mut lane = Lane::new();
            // Each slot has its own prepared-statement cache. Qualify the
            // warm protocol after both connections have prepared that code.
            for _ in 0..2 {
                lane.start(
                    &mut engine,
                    intent(0, 8),
                    Box::new(|_, v| assert!(v.iter().all(Result::is_ok))),
                );
                lane.drain(&mut engine);
            }
            let scope = crate::round_trips::Scope::begin();
            let attribution = scope.handle();
            std::thread::scope(|threads| {
                threads
                    .spawn(|| {
                        let hold = Hold::new();
                        let events =
                            install_hook(&mut lane, Point::BeforeCommit, hold.clone(), false);
                        for start in [0, 32] {
                            let mut batch = intent(start, if start == 0 { n.max(8) } else { n });
                            for i in &mut batch {
                                i.attribution = Some(attribution.clone());
                            }
                            lane.start(
                                &mut engine,
                                batch,
                                Box::new(|_, v| assert!(v.iter().all(Result::is_ok))),
                            );
                            if start == 0 {
                                loop {
                                    if events.recv_timeout(Duration::from_secs(10)).unwrap().point
                                        == Point::BeforeCommit
                                    {
                                        break;
                                    }
                                }
                            }
                        }
                        hold.open();
                        lane.drain(&mut engine);
                    })
                    .join()
                    .unwrap();
            });
            assert_eq!(
                scope.counts().postgres,
                6,
                "g6={g6} N={n}: exactly three flights on each slot"
            );
        }
    }
}

#[path = "program_g72_measure_tests.rs"]
mod measure;

#[test]
#[ignore = "private Postgres"]
fn g72_second_writer_leaves_29_physical_readers_within_32_total() {
    let mut engine = fixture(true);
    let mut lane = Lane::new();
    let mut client = observer(&mut engine);
    lane.start(
        &mut engine,
        members(0),
        Box::new(|_, v| assert!(v.iter().all(Result::is_ok))),
    );
    lane.drain(&mut engine);
    let readers = (0..40)
        .map(|_| engine.reader().unwrap())
        .collect::<Vec<_>>();
    let count: i64 = client
        .query_one(
            "SELECT count(*) FROM pg_stat_activity WHERE application_name=$1",
            &[&format!("sb:{}:0000:0", engine.store_id)],
        )
        .unwrap()
        .get(0);
    assert_eq!(
        count, 31,
        "two writers plus 29 readers; a production owner adds the 32nd connection"
    );
    drop(readers);
}
