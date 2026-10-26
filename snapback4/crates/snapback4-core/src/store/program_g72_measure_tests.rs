//! Explicit short loopback comparison; no network/S1 throughput qualification.
use super::*;
use crate::engine::command::{Command, ProgramCommand, Queue};
use std::sync::Barrier;

#[test]
#[ignore = "explicit loopback relative sanity; SNAPBACK4_G72_MEASURE=1"]
fn g72_loopback_relative_sanity_32_clients() {
    if std::env::var("SNAPBACK4_G72_MEASURE").as_deref() != Ok("1") {
        return;
    }
    for repetition in 0..2 {
        for cell in ["W4", "W5-exact", "W5-mix"] {
            for depth in if repetition == 0 { [1, 2] } else { [2, 1] } {
                let mut engine = fixture(true);
                let mut client = observer(&mut engine);
                let settings=client.query_one("SELECT current_setting('fsync'),current_setting('synchronous_commit'),current_setting('full_page_writes')",&[]).unwrap();
                let queue = Arc::new(Queue::start_fixed_depth(engine, 128, 32, depth).unwrap());
                let ready = Arc::new(Barrier::new(33));
                let go = Arc::new(Barrier::new(33));
                let mut workers = Vec::new();
                for worker in 0..32 {
                    let queue = queue.clone();
                    let ready = ready.clone();
                    let go = go.clone();
                    workers.push(std::thread::spawn(move || {
                        let mut nanos = 0u128;
                        for step in 0..48 {
                            if step == 8 {
                                ready.wait();
                                go.wait();
                            }
                            let key = match cell {
                                "W5-exact" => "shared".to_owned(),
                                "W5-mix" if (worker * 48 + step) % 100 == 0 => "shared".to_owned(),
                                _ => format!("k{worker}"),
                            };
                            let invocation = Invocation::new(
                                "increment",
                                None,
                                Context::new("alice", [("counter".into(), Value::Id(key))].into())
                                    .at(1000),
                            );
                            let started = Instant::now();
                            let reply = queue
                                .submit_program(ProgramCommand::new(invocation, |_, v| v))
                                .unwrap();
                            let ack = reply.wait().unwrap().unwrap();
                            assert!(matches!(ack.outcome.state, crate::WriteState::Sent { .. }));
                            if step >= 8 {
                                nanos += started.elapsed().as_nanos();
                            }
                        }
                        nanos
                    }));
                }
                ready.wait();
                let before = queue.batch_stats();
                let load_before = std::fs::read_to_string("/proc/loadavg").ok();
                let start = Instant::now();
                go.wait();
                let nanos = workers.into_iter().map(|w| w.join().unwrap()).sum::<u128>();
                let elapsed = start.elapsed();
                // This barrier also proves the final callbacks and stats have drained.
                let total = queue
                    .submit(Command::new(|engine| {
                        engine
                            .store()
                            .rows("counters")
                            .unwrap()
                            .into_iter()
                            .map(|r| match r.field("n").unwrap() {
                                Value::Int(n) => *n,
                                _ => panic!(),
                            })
                            .sum::<i64>()
                    }))
                    .unwrap()
                    .wait()
                    .unwrap();
                assert_eq!(total, 32 * 48);
                let after = queue.batch_stats();
                let in_flight = after.in_flight_at_dispatch.iter().zip(before.in_flight_at_dispatch).map(|(a,b)| a-b).collect::<Vec<_>>();
                let mean_n = (after.members-before.members) as f64 / after.fills.iter().zip(&before.fills).map(|(a,b)| a-b).sum::<u64>() as f64;
                let histogram = after
                    .fills
                    .iter()
                    .zip(&before.fills)
                    .enumerate()
                    .filter_map(|(n, (a, b))| (a > b).then_some((n, a - b)))
                    .collect::<std::collections::BTreeMap<_, _>>();
                crate::engine::wf_profile::flush();
                eprintln!(
                    "G72_MEASURE {}",
                    serde_json::json!({"cell":cell,"depth":depth,"repetition":repetition,"clients":32,"warmup_writes":256,"measured_writes":1280,"seconds":elapsed.as_secs_f64(),"writes_s":1280.0/elapsed.as_secs_f64(),"mean_ms":nanos as f64/1280.0/1e6,"mean_N":mean_n,"in_flight_at_dispatch":in_flight,"N":histogram,"counter_total":total,"load_before":load_before,"load_after":std::fs::read_to_string("/proc/loadavg").ok(),"fsync":settings.get::<_,String>(0),"synchronous_commit":settings.get::<_,String>(1),"full_page_writes":settings.get::<_,String>(2)})
                );
                drop(queue);
            }
        }
    }
}

#[test]
#[ignore = "explicit mixed gate sanity; SNAPBACK4_G72_MEASURE=1"]
fn g72_mixed_gate_wait_sanity() {
    if std::env::var("SNAPBACK4_G72_MEASURE").as_deref() != Ok("1") {
        return;
    }
    use crate::engine::postgres::read_grant::{Grant, boottime};
    use std::sync::atomic::AtomicBool;
    for depth in [1, 2] {
        let mut engine = fixture(true);
        let grant = Arc::new(Grant::default());
        grant.configured.store(true, Ordering::Release);
        // This probes gate scheduling, not deployment clock qualification or
        // end-to-end cached query throughput. Authority/fencing has its own suite.
        grant.until.store(
            (boottime().unwrap() + Duration::from_secs(300)).as_nanos() as u64,
            Ordering::Release,
        );
        grant.state.write().unwrap().epoch = Some("mixed-gate-test".into());
        engine
            .store_mut()
            .test_postgres_handle_mut()
            .store
            .get_mut()
            .read_grant = Some(grant.clone());
        let queue = Arc::new(Queue::start_fixed_depth(engine, 128, 32, depth).unwrap());
        let stop = Arc::new(AtomicBool::new(false));
        let done = stop.clone();
        let reads = grant.clone();
        let reader = std::thread::spawn(move || {
            let (mut hits, mut fallback, mut last) = (0u64, 0u64, 0u64);
            while !done.load(Ordering::Acquire) {
                if let Some((state, _)) = reads.read() {
                    assert_eq!(state.inflight, 0);
                    if let Some(p) = &state.published {
                        assert!(p.head >= last);
                        last = p.head;
                        hits += 1;
                    } else {
                        fallback += 1;
                    }
                } else {
                    fallback += 1;
                }
                std::thread::sleep(Duration::from_micros(50));
            }
            (hits, fallback)
        });
        let clients = (0..32)
            .map(|worker| {
                let queue = queue.clone();
                std::thread::spawn(move || {
                    for _ in 0..32 {
                        let invocation = Invocation::new(
                            "increment",
                            None,
                            Context::new(
                                "alice",
                                [("counter".into(), Value::Id(format!("k{worker}")))].into(),
                            )
                            .at(1000),
                        );
                        let ack = queue
                            .submit_program(ProgramCommand::new(invocation, |_, v| v))
                            .unwrap()
                            .wait()
                            .unwrap()
                            .unwrap();
                        assert!(matches!(ack.outcome.state, crate::WriteState::Sent { .. }));
                    }
                })
            })
            .collect::<Vec<_>>();
        for client in clients {
            client.join().unwrap();
        }
        stop.store(true, Ordering::Release);
        let (hits, fallback) = reader.join().unwrap();
        let stats = grant.stats();
        assert!(hits + fallback > 0 && stats.hit_waits > 0);
        eprintln!(
            "G72_GATE {}",
            serde_json::json!({"depth":depth,"writers":32,"writes":1024,"gate_readers":1,"hits":hits,"G5_fallbacks":fallback,"gate":stats,"wait_bound_ms":1})
        );
        drop(queue);
    }
}
