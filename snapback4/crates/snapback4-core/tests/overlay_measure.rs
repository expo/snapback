//! Explicit private Linux loopback diagnostic; never a capacity or scale claim.
#![cfg(all(feature = "postgres", target_os = "linux"))]
use postgres::{Client, NoTls};
use snapback4_core::{
    Context, Engine, Program, Schema, Value, WriteState,
    engine::{
        command::{Command, ProgramCommand, Queue},
        program::Invocation,
    },
    identity,
    round_trips::Scope,
    store_port::{AnyStore, LeasePolicy, StoreLease},
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Barrier},
    time::{Duration, Instant},
};
fn row(values: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    Value::Row(
        values
            .into_iter()
            .map(|(k, v)| (k.into(), v))
            .collect::<BTreeMap<_, _>>()
            .into(),
    )
}
fn load() -> serde_json::Value {
    serde_json::json!({"loadavg":std::fs::read_to_string("/proc/loadavg").unwrap(),"cpus":std::thread::available_parallelism().unwrap().get()})
}
fn phase(
    queue: &Arc<Queue>,
    credentials: &[(String, String)],
    duration: Duration,
    shared: bool,
) -> (u64, u64, Vec<u64>, f64) {
    let start = Arc::new(Barrier::new(33));
    let began = Instant::now();
    let threads = credentials
        .iter()
        .enumerate()
        .map(|(n, (principal, digest))| {
            let queue = queue.clone();
            let start = start.clone();
            let principal = principal.clone();
            let digest = digest.clone();
            std::thread::spawn(move || {
                start.wait();
                let until = Instant::now() + duration;
                let mut writes = 0;
                let mut flights = 0;
                let mut latencies = Vec::new();
                while Instant::now() < until {
                    let began = Instant::now();
                    let scope = Scope::begin();
                    let who = principal.clone();
                    let invocation = Invocation::new(
                        "increment",
                        None,
                        Context::new(
                            principal.clone(),
                            [(
                                "counter".into(),
                                Value::Id(if shared {
                                    "shared".into()
                                } else {
                                    format!("c{n}")
                                }),
                            )]
                            .into(),
                        )
                        .with_request_credential("account"),
                    )
                    .authorized(
                        digest.clone(),
                        || identity::ServiceSample {
                            now: snapback4_core::now_ms(),
                            supervisor_revision: 0,
                        },
                        move |facts| {
                            assert_eq!(facts.capability.unwrap().0, who);
                            Ok(())
                        },
                    );
                    let ack = queue
                        .submit_program(ProgramCommand::new(invocation, |_, out| out))
                        .unwrap()
                        .wait()
                        .unwrap()
                        .unwrap();
                    assert!(
                        matches!(ack.outcome.state, WriteState::Sent { .. }),
                        "{:?}",
                        ack.outcome
                    );
                    writes += 1;
                    flights += scope.counts().postgres;
                    latencies.push(began.elapsed().as_micros() as u64);
                }
                (writes, flights, latencies)
            })
        })
        .collect::<Vec<_>>();
    start.wait();
    let (mut writes, mut flights, mut latencies) = (0, 0, Vec::new());
    for thread in threads {
        let (w, f, l) = thread.join().unwrap();
        writes += w;
        flights += f;
        latencies.extend(l);
    }
    (writes, flights, latencies, began.elapsed().as_secs_f64())
}
#[test]
#[ignore = "explicit private PG16 loopback measurement, 32 writers, about 90 seconds"]
fn overlay_loopback_32_writers() {
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private PG16");
    let mut control = Client::connect(&connection, NoTls).unwrap();
    let version: String = control.query_one("SELECT version()", &[]).unwrap().get(0);
    assert!(version.contains("PostgreSQL 16."));
    let mut durability = BTreeMap::new();
    for setting in ["fsync", "synchronous_commit", "full_page_writes"] {
        let value: String = control
            .query_one("SELECT current_setting($1)", &[&setting])
            .unwrap()
            .get(0);
        assert_eq!(value, "on");
        durability.insert(setting, value);
    }
    let bound = snapback4_lang::compile(&[(
        "schema.q".into(),
        include_str!("../../../experiments/scale-controls/snapback-app/snapback/schema.q").into(),
    )]);
    assert!(bound.diagnostics.is_empty());
    let schema: Schema =
        serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
    let programs: Vec<Program> = bound
        .programs
        .into_iter()
        .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
        .collect();
    let mut trials = Vec::new();
    for shared in [false, true] {
        for n in [1, 8, 32, 32, 8, 1, 1, 8, 32] {
            let namespace = format!("sb4_g3b_measure_{:x}", snapback4_core::ids::seed());
            let mut engine = Engine::new(
                AnyStore::create_postgres(&connection, &namespace).unwrap(),
                schema.clone(),
                programs.clone(),
            )
            .unwrap();
            let at = snapback4_core::now_ms();
            let credentials = (0..32)
                .map(|n| {
                    let who = format!("user:writer{n}");
                    let session =
                        identity::open_session(engine.store(), &who, "account", at).unwrap();
                    (who, identity::session_digest(&session.token))
                })
                .collect::<Vec<_>>();
            let mut rows = vec![("rooms".into(), row([("id", Value::Id("r".into()))]))];
            for (n, (who, _)) in credentials.iter().enumerate() {
                rows.push((
                    "memberships".into(),
                    row([
                        ("id", Value::Id(format!("m{n}"))),
                        ("room", Value::Id("r".into())),
                        ("principal", Value::Id(who.clone())),
                        ("last_read", Value::Int(0)),
                    ]),
                ));
                rows.push((
                    "counters".into(),
                    row([
                        ("id", Value::Id(format!("c{n}"))),
                        ("room", Value::Id("r".into())),
                        ("owner", Value::Id(who.clone())),
                        ("n", Value::Int(0)),
                    ]),
                ));
            }
            rows.push((
                "counters".into(),
                row([
                    ("id", Value::Id("shared".into())),
                    ("room", Value::Id("r".into())),
                    ("owner", Value::Null),
                    ("n", Value::Int(0)),
                ]),
            ));
            engine.seed_at(rows, at).unwrap();
            let id = engine.store().store_identity().unwrap().unwrap();
            drop(engine);
            let mut lease =
                StoreLease::connect(&connection, &namespace, &id, "c001", LeasePolicy::default())
                    .unwrap();
            assert!(lease.acquire().unwrap().is_some());
            let engine = Engine::open(
                AnyStore::open_postgres_owned(&connection, &namespace, &lease).unwrap(),
            )
            .unwrap();
            let mut queue = Queue::start_fixed(engine, 64, n).unwrap();
            queue.hold_lease(lease, Duration::from_millis(700)).unwrap();
            let queue = Arc::new(queue);
            let pids = control
                .query(
                    "SELECT pid FROM pg_stat_activity WHERE application_name=$1",
                    &[&format!("sb:{id}:c001:1")],
                )
                .unwrap()
                .iter()
                .map(|r| r.get::<_, i32>(0))
                .collect::<Vec<_>>();
            assert_eq!(pids.len(), 2);
            eprintln!("measurement owns backend PIDs {pids:?}");
            let (warm, _, _, _) = phase(&queue, &credentials, Duration::from_secs(1), shared);
            let before = queue.batch_stats();
            let load_before = load();
            let started_at = snapback4_core::now_ms();
            let (writes, flights, mut latency, elapsed) =
                phase(&queue, &credentials, Duration::from_secs(3), shared);
            let after = queue.batch_stats();
            let load_after = load();
            let sum = queue
                .call(Command::new(|e| {
                    e.store()
                        .rows("counters")
                        .unwrap()
                        .iter()
                        .map(|r| r.field("n").unwrap().as_int().unwrap())
                        .sum::<i64>()
                }))
                .unwrap();
            assert_eq!(sum as u64, warm + writes);
            let fills = after
                .fills
                .iter()
                .zip(&before.fills)
                .map(|(a, b)| a - b)
                .collect::<Vec<_>>();
            let batches = fills.iter().sum::<u64>();
            assert_eq!(
                fills
                    .iter()
                    .enumerate()
                    .map(|(n, c)| n as u64 * c)
                    .sum::<u64>(),
                writes
            );
            assert_eq!(after.commit_attempts - before.commit_attempts, batches);
            latency.sort_unstable();
            let trial = serde_json::json!({"workload":if shared{"W5-shared"}else{"W4-disjoint"},"max_n":n,"writes":writes,"elapsed_s":elapsed,"writes_per_s":writes as f64/elapsed,"flights":flights,"batches":batches,"flights_per_batch":flights as f64/batches as f64,"mean_fill":writes as f64/batches as f64,"fills":fills,"commit_us_per_member":(after.commit_nanos-before.commit_nanos)as f64/1000.0/writes as f64,"p50_us":latency[latency.len()/2],"p99_us":latency[latency.len()*99/100],"load_before":load_before,"load_after":load_after,"started_at_ms":started_at,"backend_pids":pids});
            eprintln!("{trial}");
            trials.push(trial);
            drop(queue);
            assert!(
                control
                    .query(
                        "SELECT pid FROM pg_stat_activity WHERE pid=ANY($1)",
                        &[&pids]
                    )
                    .unwrap()
                    .is_empty()
            );
            control
                .batch_execute(&format!("DROP SCHEMA {namespace} CASCADE"))
                .unwrap();
        }
    }
    let path = std::env::var("SNAPBACK4_G3B_MEASURE_OUT").expect("output path outside Git");
    std::fs::write(
        path,
        serde_json::to_vec_pretty(
            &serde_json::json!({"version":version,"durability":durability,"trials":trials}),
        )
        .unwrap(),
    )
    .unwrap();
}
