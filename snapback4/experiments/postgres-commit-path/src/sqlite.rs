//! Cells 4 and 5: SQLite under `serve`'s topology, the old four-connection
//! cell on the same timer, and the exec/flush split for the serial-batch
//! estimate. Stores are created with the production `Store::open`
//! (WAL, synchronous=FULL), in `--dir` (one fresh subdirectory per cell).
use crate::{Args, common::*, rows, slot};
use serde_json::{Value as Json, json};
use snapback4_core::{Engine, Value, store::Store};
use snapback4_postgres_evaluation::{compiled, context, id, sent};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

fn fresh(dir: &str, label: &str) -> PathBuf {
    let d = Path::new(dir).join(format!("{label}-{}-{:x}", std::process::id(), snapback4_core::ids::seed() & 0xffff_ffff));
    std::fs::create_dir_all(&d).unwrap();
    d.join("store.sqlite")
}

fn create(path: &Path, synchronous: &str) -> Engine {
    let (schema, programs) = compiled();
    let store = Store::open(path).unwrap();
    store.conn().execute_batch(&format!("PRAGMA synchronous={synchronous}")).unwrap();
    let mut engine = Engine::new(store, schema, programs).unwrap();
    engine.seed_at(rows(), 10).unwrap();
    engine
}

fn pragmas(engine: &Engine) -> Json {
    let conn = engine.store().conn();
    json!({
        "journal_mode": conn.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0)).unwrap(),
        "synchronous": conn.query_row("PRAGMA synchronous", [], |r| r.get::<_, i64>(0)).unwrap(),
        "sqlite_version": conn.query_row("SELECT sqlite_version()", [], |r| r.get::<_, String>(0)).unwrap(),
    })
}

fn counter_sum(engine: &mut Engine, n: usize) -> i64 {
    (0..n)
        .map(|c| match engine.query("counter", context("alice", &[("slot", id(format!("c{c}")))])).unwrap().data.field("value").unwrap() {
            Value::Int(v) => *v,
            other => panic!("{other:?}"),
        })
        .sum()
}

fn tag() -> String {
    format!("{:x}", snapback4_core::ids::seed() & 0xffff_ffff)
}

/// Cell 4: one Engine (one connection) behind a Mutex, `--writers` client
/// threads calling mutate("increment") through it. Models serve's
/// FairMutex<Engine>; std's Mutex is not FIFO-fair, which changes who goes
/// next but not the serial work per commit.
pub fn serve(args: &Args) -> Json {
    let writers = args.num("--writers", 4);
    let disjoint = args.req("--counters") == "disjoint";
    let synchronous = args.get("--synchronous").unwrap_or("FULL").to_string();
    let timing = Timing::from_env();
    let path = fresh(args.req("--dir"), "serve");
    let engine = create(&path, &synchronous);
    let pragmas = pragmas(&engine);
    let engine = Arc::new(Mutex::new(engine));
    let tag = tag();
    let mut runs = Vec::new();
    let mut total = 0;
    for run in 0..args.runs() {
        let (e2, tag) = (engine.clone(), tag.clone());
        let r = closed_loop(writers, &timing, None, |_| (), move |_, w, i| {
            let out = e2.lock().unwrap()
                .mutate("increment", Some(&format!("{tag}-{run}-{w}-{i}")), context("alice", &[("slot", id(slot(disjoint, w)))]))
                .map_err(|e| format!("{e:?}"))?;
            sent(&out);
            Ok(0)
        });
        total += r["total_ops"].as_i64().unwrap();
        runs.push(r);
    }
    let sum = counter_sum(&mut engine.lock().unwrap(), writers.max(1));
    json!({"cell": "sqlite-serve", "label": "one Engine behind a Mutex (serve's topology)", "writers": writers,
        "counters": if disjoint {"disjoint"} else {"same"}, "store": path, "pragmas": pragmas,
        "counter_check": {"acknowledged": total, "counter_sum": sum, "ok": total == sum},
        "summary": aggregate(&runs), "runs": runs})
}

/// The old `concurrent_sqlite` cell (experiments/postgres/src/main.rs) on
/// this experiment's timer: four connections, each its own Engine, so the
/// writers contend in SQLite's busy handler (5 s busy timeout, unchanged).
pub fn four_connections(args: &Args) -> Json {
    let disjoint = args.req("--counters") == "disjoint";
    let timing = Timing::from_env();
    let path = fresh(args.req("--dir"), "four");
    let mut engine = create(&path, "FULL");
    let pragmas = pragmas(&engine);
    let tag = tag();
    let mut runs = Vec::new();
    let mut total = 0;
    for run in 0..args.runs() {
        let (p2, tag) = (path.clone(), tag.clone());
        let r = closed_loop(4, &timing, None, move |_| {
            let store = Store::open(&p2).unwrap();
            store.conn().execute_batch("PRAGMA synchronous=FULL").unwrap();
            Engine::open(store).unwrap()
        }, move |e, w, i| {
            let out = e.mutate("increment", Some(&format!("{tag}-{run}-{w}-{i}")), context("alice", &[("slot", id(slot(disjoint, w)))]))
                .map_err(|e| format!("{e:?}"))?;
            sent(&out);
            Ok(0)
        });
        total += r["total_ops"].as_i64().unwrap();
        runs.push(r);
    }
    let sum = counter_sum(&mut engine, 4);
    json!({"cell": "sqlite-four-connections", "label": "old concurrent_sqlite shape: four connections in the busy handler", "writers": 4,
        "counters": if disjoint {"disjoint"} else {"same"}, "store": path, "pragmas": pragmas,
        "counter_check": {"acknowledged": total, "counter_sum": sum, "ok": total == sum},
        "summary": aggregate(&runs), "runs": runs})
}

/// Cell 5: one connection, one writer, per-mutation latency at
/// synchronous=OFF (exec) and FULL (exec + flush). The serial-batch
/// throughput N/(N·exec + flush) is then an ESTIMATE: the core exposes no way
/// to run several mutations in one transaction from outside (Engine::mutate
/// opens its own BEGIN IMMEDIATE), and OFF still pays per-commit WAL writes
/// and locking that a real batch would amortize, so exec is conservative.
pub fn exec_flush(args: &Args) -> Json {
    let timing = Timing::from_env();
    let tag = tag();
    let mut per_setting = serde_json::Map::new();
    for synchronous in ["OFF", "FULL"] {
        let path = fresh(args.req("--dir"), &format!("exec-{synchronous}"));
        let engine = create(&path, synchronous);
        let pragmas = pragmas(&engine);
        let engine = Arc::new(Mutex::new(engine));
        let mut runs = Vec::new();
        for run in 0..args.runs() {
            let (e2, tag) = (engine.clone(), tag.clone());
            runs.push(closed_loop(1, &timing, None, |_| (), move |_, w, i| {
                let out = e2.lock().unwrap()
                    .mutate("increment", Some(&format!("{tag}-{run}-{w}-{i}")), context("alice", &[("slot", id("c0"))]))
                    .map_err(|e| format!("{e:?}"))?;
                sent(&out);
                Ok(0)
            }));
        }
        let mut means: Vec<f64> = runs.iter().filter_map(|r| r["mean_ms"].as_f64()).collect();
        means.sort_by(f64::total_cmp);
        per_setting.insert(synchronous.into(), json!({"pragmas": pragmas, "store": path, "summary": aggregate(&runs),
            "mean_ms_median": means.get(means.len() / 2), "runs": runs}));
    }
    let exec = per_setting["OFF"]["mean_ms_median"].as_f64().unwrap();
    let full = per_setting["FULL"]["mean_ms_median"].as_f64().unwrap();
    let flush = full - exec;
    let estimate: Vec<Json> = [1usize, 4, 16, 64]
        .iter()
        .map(|&n| json!({"batch": n, "predicted_commits_per_s": n as f64 / (n as f64 * exec + flush) * 1000.0}))
        .collect();
    json!({"cell": "sqlite-exec-flush", "label": "ESTIMATE of the SQLite serial batch from measured exec and flush (not a measured batch)",
        "exec_ms": exec, "full_ms": full, "flush_ms": flush, "serial_batch_estimate": estimate,
        "reference_commits_per_s_single_writer": 1000.0 / full, "settings": per_setting})
}

/// The old cell verbatim: `concurrent_sqlite` from experiments/postgres/src/main.rs
/// (count-based, four connections, `n` increments per writer, its own timer
/// including worker readiness). Copied rather than run through that crate's
/// binary because its lockfile is stale for `--locked` builds.
pub fn old_cell(args: &Args) -> Json {
    use std::sync::Barrier;
    use std::time::Instant;
    let disjoint = args.req("--counters") == "disjoint";
    let n = args.num("--per-writer", 100);
    let path = fresh(args.req("--dir"), "old");
    let mut engine = create(&path, "FULL");
    let mut runs = Vec::new();
    for run in 0..args.runs() {
        let gate = Arc::new(Barrier::new(5));
        let handles: Vec<_> = (0..4)
            .map(|writer| {
                let path = path.clone();
                let gate = gate.clone();
                std::thread::spawn(move || {
                    let store = Store::open(&path).unwrap();
                    store.conn().execute_batch("PRAGMA synchronous=FULL").unwrap();
                    let mut sqlite = Engine::open(store).unwrap();
                    let slot = format!("c{}", if disjoint { writer } else { 0 });
                    gate.wait();
                    let mut completed = 0;
                    let mut failure = None;
                    for i in 0..n {
                        match sqlite.mutate("increment", Some(&format!("{run}-{disjoint}-{writer}-{i}")), context("alice", &[("slot", id(&slot))])) {
                            Ok(outcome) => { sent(&outcome); completed += 1; }
                            Err(error) => { failure = Some(error.to_string()); break; }
                        }
                    }
                    (completed, failure)
                })
            })
            .collect();
        let start = Instant::now();
        gate.wait();
        let mut completed = Vec::new();
        let mut failures = Vec::new();
        for handle in handles {
            let (count, failure) = handle.join().unwrap();
            completed.push(count);
            failures.push(failure);
        }
        let elapsed = start.elapsed().as_secs_f64();
        let complete = failures.iter().all(Option::is_none);
        runs.push(json!({"status":if complete {"complete"} else {"failed"}, "requested_mutations":4*n,
            "mutations":completed.iter().sum::<usize>(), "completed_per_writer":completed, "failures":failures,
            "seconds":elapsed,"commits_per_s":complete.then_some(4.0*n as f64/elapsed)}));
    }
    let total: i64 = runs.iter().map(|r| r["mutations"].as_i64().unwrap()).sum();
    let sum = counter_sum(&mut engine, 4);
    json!({"cell": "sqlite-old-cell", "label": "verbatim concurrent_sqlite (count-based, four connections)", "writers": 4, "per_writer": n,
        "counters": if disjoint {"disjoint"} else {"same"}, "store": path,
        "counter_check": {"acknowledged": total, "counter_sum": sum, "ok": total == sum},
        "summary": aggregate(&runs), "runs": runs})
}
