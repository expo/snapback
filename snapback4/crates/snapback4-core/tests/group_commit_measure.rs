//! Private loopback diagnostic, deliberately outside the ordinary test run.
#![cfg(feature = "postgres")]
use serde_json::{Value as Json, json};
use snapback4_core::{
    Context, Engine, Value,
    engine::{
        command::{Command, ProgramCommand, Queue},
        program::Invocation,
    },
    identity,
    store_port::{AnyStore, LeasePolicy, StoreLease},
};
use std::{
    sync::{Arc, Barrier, Mutex},
    time::{Duration, Instant},
};

fn phase(queue: &Arc<Queue>, digests: &[String], seconds: u64) -> (u64, f64, Vec<u64>) {
    let barrier = Arc::new(Barrier::new(33));
    let start = Arc::new(Mutex::new(None));
    let handles: Vec<_> = (0..32)
        .map(|writer| {
            let queue = queue.clone();
            let barrier = barrier.clone();
            let start = start.clone();
            let digest = digests[writer].clone();
            std::thread::spawn(move || {
                let principal = format!("bench:{writer}");
                barrier.wait();
                let began: Instant = start.lock().unwrap().unwrap();
                let mut count = 0;
                let mut latencies = Vec::new();
                while began.elapsed() < Duration::from_secs(seconds) {
                    let at = Instant::now();
                    let invocation = Invocation::new(
                        "increment",
                        None,
                        Context::new(
                            &principal,
                            [("counter".into(), Value::Id(format!("c{writer:04}")))].into(),
                        )
                        .at(snapback4_core::now_ms())
                        .with_request_credential("account"),
                    )
                    .authorized(
                        digest.clone(),
                        || identity::ServiceSample {
                            now: snapback4_core::now_ms(),
                            supervisor_revision: 0,
                        },
                        |facts| {
                            assert!(facts.capability.is_some());
                            Ok(())
                        },
                    );
                    let ack = queue
                        .submit_program(ProgramCommand::new(invocation, |_, result| result))
                        .unwrap()
                        .wait()
                        .unwrap()
                        .unwrap();
                    assert!(matches!(
                        ack.outcome.state,
                        snapback4_core::WriteState::Sent { .. }
                    ));
                    count += 1;
                    latencies.push(at.elapsed().as_nanos().min(u64::MAX as u128) as u64);
                }
                (count, latencies)
            })
        })
        .collect();
    let began = Instant::now();
    *start.lock().unwrap() = Some(began);
    barrier.wait();
    let mut count = 0;
    let mut latencies = Vec::new();
    for handle in handles {
        let (n, mut samples) = handle.join().unwrap();
        count += n;
        latencies.append(&mut samples);
    }
    (count, began.elapsed().as_secs_f64(), latencies)
}
fn load() -> Json {
    #[cfg(target_os = "linux")]
    {
        return json!({"loadavg":std::fs::read_to_string("/proc/loadavg").unwrap().trim(),"available_parallelism":std::thread::available_parallelism().unwrap().get()});
    }
    #[cfg(not(target_os = "linux"))]
    {
        json!({"available_parallelism":std::thread::available_parallelism().unwrap().get()})
    }
}
fn quantile(samples: &mut [u64], p: usize) -> f64 {
    samples.sort_unstable();
    samples[(samples.len() * p).div_ceil(100).saturating_sub(1)] as f64 / 1000.0
}

#[test]
#[ignore = "private PG16 loopback diagnostic; SNAPBACK4_G23_MEASURE_OUT names a private summary"]
fn private_loopback_s1_increment_32_writers() {
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private PG16");
    assert!(
        connection.contains("host=127.0.0.1"),
        "measurement must use private loopback TCP"
    );
    assert!(!connection.contains("55440"), "PG17 is outside this lane");
    let output = std::path::PathBuf::from(
        std::env::var_os("SNAPBACK4_G23_MEASURE_OUT").expect("private summary output"),
    );
    let mut observer = postgres::Client::connect(&connection, postgres::NoTls).unwrap();
    let version: i32 = observer
        .query_one("SELECT current_setting('server_version_num')::int", &[])
        .unwrap()
        .get(0);
    assert!((160000..170000).contains(&version));
    let durability: std::collections::BTreeMap<String, String> = observer.query(
        "SELECT name,setting FROM pg_settings WHERE name IN ('fsync','synchronous_commit','full_page_writes','max_connections') ORDER BY name", &[]
    ).unwrap().into_iter().map(|row|(row.get(0),row.get(1))).collect();
    assert_eq!(durability["fsync"], "on");
    assert_eq!(durability["synchronous_commit"], "on");
    assert_eq!(durability["full_page_writes"], "on");
    let source = include_str!("../../../experiments/scale-controls/snapback-app/snapback/schema.q");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty());
    let schema: snapback4_core::Schema =
        serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
    let programs: Vec<snapback4_core::Program> = bound
        .programs
        .into_iter()
        .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
        .collect();
    let mut results = Vec::new();
    for (trial, n) in [1, 4, 16, 32, 32, 16, 4, 1, 1, 4, 16, 32]
        .into_iter()
        .enumerate()
    {
        let namespace = format!("sb4_eval_g23_measure_{:x}", snapback4_core::ids::seed());
        let mut bootstrap = Engine::new(
            AnyStore::create_postgres(&connection, &namespace).unwrap(),
            schema.clone(),
            programs.clone(),
        )
        .unwrap();
        let mut rows = vec![("rooms", json!({"id":"r1024"}))];
        for writer in 0..32 {
            rows.push(("counters",json!({"id":format!("c{writer:04}"),"owner":format!("bench:{writer}"),"room":"r1024"})));
        }
        let rows: Vec<_> = rows
            .into_iter()
            .map(|(table, row)| {
                (
                    table.to_string(),
                    snapback4_core::wire::row_from_json(&bootstrap.schema().tables[table], &row)
                        .unwrap(),
                )
            })
            .collect();
        bootstrap.seed(rows).unwrap();
        let digests: Vec<_> = (0..32)
            .map(|writer| {
                identity::session_digest(
                    &identity::open_session(
                        bootstrap.store(),
                        &format!("bench:{writer}"),
                        "account",
                        snapback4_core::now_ms(),
                    )
                    .unwrap()
                    .token,
                )
            })
            .collect();
        let store_id = bootstrap.store().store_identity().unwrap().unwrap();
        drop(bootstrap);
        let mut lease = StoreLease::connect(
            &connection,
            &namespace,
            &store_id,
            "a023",
            LeasePolicy::default(),
        )
        .unwrap();
        assert!(lease.acquire().unwrap().is_some());
        let engine =
            Engine::open(AnyStore::open_postgres_owned(&connection, &namespace, &lease).unwrap())
                .unwrap();
        let mut queue = Queue::start_fixed(engine, 128, n).unwrap();
        queue.hold_lease(lease, Duration::from_millis(700)).unwrap();
        let queue = Arc::new(queue);
        let backend_pids: Vec<i32> = observer
            .query(
                "SELECT pid FROM pg_stat_activity WHERE application_name=$1 ORDER BY pid",
                &[&format!("sb:{store_id}:a023:1")],
            )
            .unwrap()
            .iter()
            .map(|r| r.get(0))
            .collect();
        assert_eq!(backend_pids.len(), 2);
        let (warm, _, _) = phase(&queue, &digests, 1);
        let before = queue.batch_stats();
        let load_before = load();
        let at = snapback4_core::now_ms();
        let (writes, elapsed, mut latencies) = phase(&queue, &digests, 3);
        let load_after = load();
        let after = queue.batch_stats();
        let fills: Vec<_> = after
            .fills
            .iter()
            .zip(&before.fills)
            .map(|(a, b)| a - b)
            .collect();
        let attempts = after.commit_attempts - before.commit_attempts;
        assert_eq!(fills.iter().sum::<u64>(), attempts);
        assert_eq!(
            fills
                .iter()
                .enumerate()
                .map(|(fill, batches)| fill as u64 * batches)
                .sum::<u64>(),
            writes
        );
        let durable = queue
            .call(Command::new(|engine| {
                engine
                    .store()
                    .rows("counters")
                    .unwrap()
                    .iter()
                    .map(|r| r.field("n").unwrap().as_int().unwrap())
                    .sum::<i64>()
            }))
            .unwrap();
        assert_eq!(durable as u64, warm + writes);
        let row = json!({"trial":trial,"max_n":n,"writers":32,"warmup_s":1,"requested_s":3,"started_at_ms":at,
            "elapsed_s":elapsed,"writes":writes,"writes_per_s":writes as f64/elapsed,"service_us_per_write":elapsed*1e6/writes as f64,
            "commit_us_per_member":(after.commit_nanos-before.commit_nanos) as f64/1000.0/writes as f64,
            "commit_attempts":attempts,"latency_p50_us":quantile(&mut latencies,50),"latency_p99_us":quantile(&mut latencies,99),
            "fills":fills,"load_before":load_before,"load_after":load_after,"owned_backend_pids":backend_pids});
        println!("G23 diagnostic {row}");
        results.push(row);
        drop(queue);
        assert_eq!(
            observer
                .query_one(
                    "SELECT count(*) FROM pg_stat_activity WHERE pid=ANY($1)",
                    &[&backend_pids]
                )
                .unwrap()
                .get::<_, i64>(0),
            0
        );
        observer
            .batch_execute(&format!("DROP SCHEMA {namespace} CASCADE"))
            .unwrap();
        std::fs::write(&output,serde_json::to_vec_pretty(&json!({"version":version,"durability":durability,"scope":"S1 increment body, 32 owned counters and live account credentials; core committer queue, no HTTP/ingress/encoding, no 1M-message scale seed; private durable loopback diagnostic, not a scale claim","trials":results})).unwrap()).unwrap();
    }
}
