//! A successor's own errors use the same per-member policy as depth one.
use super::*;
use crate::engine::program_batch::fault;

fn pair() -> Vec<Invocation> {
    [(8, "a"), (9, "b")]
        .into_iter()
        .map(|(n, key)| {
            let mut i = item(n);
            i.context
                .args
                .insert("counter".into(), Value::Id(key.into()));
            i
        })
        .collect()
}
fn capture(
    out: &Arc<Mutex<Vec<crate::engine::program_batch::Outcome>>>,
) -> Box<dyn FnOnce(&mut Engine, Vec<crate::engine::program_batch::Outcome>) + Send> {
    let out = out.clone();
    Box::new(move |_, values| *out.lock().unwrap() = values)
}
fn assert_survivor(
    engine: &mut Engine,
    out: &Arc<Mutex<Vec<crate::engine::program_batch::Outcome>>>,
) {
    let out = out.lock().unwrap();
    assert_eq!(out.len(), 2);
    assert!(
        out[0].is_ok(),
        "A must survive B's own failure: {:?}",
        out[0]
    );
    assert!(out[1].is_err(), "B must fail");
    let mut client = observer(engine);
    assert_eq!(
        client
            .query_one("SELECT count(*) FROM _ops WHERE id='g72-8'", &[])
            .unwrap()
            .get::<_, i64>(0),
        1
    );
    assert_eq!(
        client
            .query_one("SELECT count(*) FROM _ops WHERE id='g72-9'", &[])
            .unwrap()
            .get::<_, i64>(0),
        0
    );
    contiguous(&mut client);
    let mut serial = fixture(true);
    serial.invoke_program(&mut item(0)).unwrap();
    serial.invoke_program(&mut pair().remove(0)).unwrap();
    assert_eq!(digest(engine), digest(&mut serial));
}
fn duplicate(client: &mut Client) -> crate::RuntimeError {
    let error = client.batch_execute("DO $f$ BEGIN RAISE EXCEPTION 'deterministic B duplicate' USING ERRCODE='23505'; END $f$").unwrap_err();
    assert_eq!(error.code().unwrap().code(), "23505");
    crate::RuntimeError::Postgres(error)
}

#[test]
#[ignore = "private Postgres"]
fn g72_successor_own_23505_after_predecessor_commit_matches_depth_one() {
    for pipelined in [false, true] {
        let mut engine = fixture(true);
        let mut control = observer(&mut engine);
        let mut lane = Lane::new();
        let hold = Hold::new();
        let events =
            pipelined.then(|| install_hook(&mut lane, Point::AfterTail, hold.clone(), false));
        if pipelined {
            lane.start(
                &mut engine,
                vec![item(0)],
                Box::new(|_, v| assert!(v.iter().all(Result::is_ok))),
            );
            until_event(events.as_ref().unwrap(), 0, Point::AfterTail);
        } else {
            engine.invoke_program(&mut item(0)).unwrap();
        }
        let output = Arc::new(Mutex::new(Vec::new()));
        let released = hold.clone();
        // The real SQLSTATE is injected at the named-member boundary on every
        // attempt, including the serial fallback. A's overlay is rolled back.
        fault::with_check_hook(
            move |point, index| {
                if point == fault::Point::AfterMember && index == 1 {
                    released.open();
                    return Err(duplicate(&mut control));
                }
                Ok(())
            },
            || {
                if pipelined {
                    lane.start(&mut engine, pair(), capture(&output));
                    lane.drain(&mut engine);
                } else {
                    *output.lock().unwrap() = engine.invoke_program_batch(&mut pair());
                }
            },
        );
        assert_survivor(&mut engine, &output);
    }
}

#[test]
#[ignore = "private Postgres"]
fn g72_successor_own_expired_member_solo_retries_peer_with_time_left() {
    for pipelined in [false, true] {
        let mut engine = fixture(true);
        let mut lane = Lane::new();
        let hold = Hold::new();
        let events =
            pipelined.then(|| install_hook(&mut lane, Point::AfterTail, hold.clone(), false));
        if pipelined {
            lane.start(
                &mut engine,
                vec![item(0)],
                Box::new(|_, v| assert!(v.iter().all(Result::is_ok))),
            );
            until_event(events.as_ref().unwrap(), 0, Point::AfterTail);
        } else {
            engine.invoke_program(&mut item(0)).unwrap();
        }
        let mut batch = pair();
        let deadline = Instant::now() + Duration::from_millis(100);
        batch[1].deadline = deadline;
        let released = hold.clone();
        let b = batch.pop().unwrap();
        batch.push(b.instrument(move |run| {
            run();
            std::thread::sleep(
                deadline.saturating_duration_since(Instant::now()) + Duration::from_millis(5),
            );
            released.open();
        }));
        let output = Arc::new(Mutex::new(Vec::new()));
        if pipelined {
            lane.start(&mut engine, batch, capture(&output));
            lane.drain(&mut engine);
        } else {
            *output.lock().unwrap() = engine.invoke_program_batch(&mut batch);
        }
        assert_survivor(&mut engine, &output);
    }
}

fn cascade(dispatched: bool) {
    let mut engine = fixture(true);
    let mut control = observer(&mut engine);
    let mut lane = Lane::new();
    let hold = Hold::new();
    let events = install_hook(&mut lane, Point::AfterTail, hold.clone(), true);
    crate::engine::committer::closure::PLAN_BUILDS.with(|count|count.set(0));
    lane.start(
        &mut engine,
        vec![item(0)],
        Box::new(|_, v| assert!(v.iter().all(Result::is_ok))),
    );
    let first = until_event(&events, 0, Point::AfterTail);
    let output = Arc::new(Mutex::new(Vec::new()));
    let release = hold.clone();
    let mut duplicate_control = observer(&mut engine);
    let mut attempts = 0;
    fault::with_check_hook(
        move |p, i| {
            if p == fault::Point::AfterMember && i == 1 {
                attempts += 1;
                if !dispatched {
                    release.open();
                }
                if attempts > 1 {
                    return Err(duplicate(&mut duplicate_control));
                }
            }
            Ok(())
        },
        || {
            if dispatched {
                lane.start(&mut engine, pair(), capture(&output));
                let second = until_event(&events, 1, Point::BeforeFinal);
                hold.open();
                lane.drain(&mut engine);
                assert_eq!(sql_status(&mut control, &second.xid), "aborted");
            } else {
                // Fail staging with no final dispatched. The whole-batch fresh-fact
                // rerun then encounters B's persistent named SQLSTATE 23505.
                fault::inject(fault::Point::AfterMember, 1, || {
                    lane.start(&mut engine, pair(), capture(&output));
                });
                lane.drain(&mut engine);
            }
        },
    );
    assert_eq!(sql_status(&mut control, &first.xid), "aborted");
    assert_eq!(crate::engine::committer::closure::PLAN_BUILDS.with(|count|count.get()),3,
        "cascade and solo recovery must not rebuild closure plans");
    assert_survivor(&mut engine, &output);
}
#[test]
#[ignore = "private Postgres"]
fn g72_dispatched_cascade_second_failure_falls_through_to_solo() {
    cascade(true);
}
#[test]
#[ignore = "private Postgres"]
fn g72_undispatched_cascade_second_failure_falls_through_to_solo() {
    cascade(false);
}
