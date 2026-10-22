//! Same deployed 1M fixture and W4 operation; HTTP, sessions and background
//! workers are omitted. Writes still use the production engine and WAL/FULL.
// @ref LLP 3000.009.001.002#6-method-and-metrics — count warm-up writes in the counter witness.
use rusqlite::Connection;
use serde_json::json;
use snapback4_core::{Context, Engine, Value, WriteState, store::Store};
use std::{collections::BTreeMap, path::Path, time::Instant};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = Path::new(&args[1]);
    let warmup: f64 = args.get(2).map_or(10.0, |x| x.parse().unwrap());
    let seconds: f64 = args.get(3).map_or(20.0, |x| x.parse().unwrap());
    let mode = args.get(4).map_or("engine", String::as_str);
    if mode == "raw-batch" {
        raw_batch(path, warmup, seconds, args.get(5).unwrap().parse().unwrap());
        return;
    }
    let store = Store::open(path).unwrap();
    let version = store.sqlite_version().unwrap();
    let mut engine = Engine::open(store).unwrap();
    let before = sum(path);
    let start = Instant::now();
    let mut latencies = Vec::new();
    let mut total = 0;
    let mut measured = 0;
    let mut measured_start = None;
    while start.elapsed().as_secs_f64() < warmup + seconds {
        let measuring = start.elapsed().as_secs_f64() >= warmup;
        if measuring && measured_start.is_none() {
            measured_start = Some(Instant::now());
        }
        let w = total % 32;
        let context = Context::new(
            format!("bench:{w}"),
            BTreeMap::from([("counter".into(), Value::Id(format!("c{w:04}")))]),
        );
        let at = Instant::now();
        // The matched HTTP harness sends no id; do not add receipt costs here.
        let result = engine.mutate("increment", None, context).unwrap();
        assert!(matches!(result.state, WriteState::Sent { .. }));
        if measuring {
            latencies.push(at.elapsed().as_secs_f64() * 1000.0);
            measured += 1;
        }
        total += 1;
    }
    let duration = measured_start.unwrap().elapsed().as_secs_f64();
    let after = sum(path);
    assert_eq!(after - before, total);
    latencies.sort_by(f64::total_cmp);
    println!(
        "{}",
        json!({"mode":"engine", "total":total,"measured":measured,
        "counter_delta":after-before,"counter_ok":true,"seconds":duration,
        "ops_per_s":measured as f64/duration,"sqlite_version":version,
        "durability":"production Store::open: WAL/FULL; no pragma overrides",
        "warmup_s":warmup,"latencies_ms":latencies})
    );
}

fn sum(path: &Path) -> i64 {
    Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap()
        .query_row("SELECT sum(json_extract(data,'$.Row.n.Int')) FROM r WHERE t=(SELECT t FROM r WHERE id='c0000' LIMIT 1)", [], |r| r.get(0)).unwrap()
}

/// A durable SQLite primitive, not a Snapback batch implementation. It leaves
/// the fixture untouched and increments 32 integers in a separate scratch DB.
/// The control measures the disk's one-flush/transaction floor at batch 1/16.
fn raw_batch(path: &Path, warmup: f64, seconds: f64, n: usize) {
    let conn = Connection::open(path).unwrap();
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS c(id INTEGER PRIMARY KEY,n INTEGER NOT NULL); INSERT OR IGNORE INTO c SELECT value,0 FROM json_each('[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]');").unwrap();
    let mut statement = conn
        .prepare_cached("UPDATE c SET n=n+1 WHERE id=?1")
        .unwrap();
    let start = Instant::now();
    let mut latencies = Vec::new();
    let mut total = 0;
    let mut measured = 0;
    let mut measured_start = None;
    while start.elapsed().as_secs_f64() < warmup + seconds {
        let measuring = start.elapsed().as_secs_f64() >= warmup;
        if measuring && measured_start.is_none() {
            measured_start = Some(Instant::now());
        }
        let at = Instant::now();
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        for i in 0..n {
            statement.execute([((total + i) % 32) as i64]).unwrap();
        }
        conn.execute_batch("COMMIT").unwrap();
        if measuring {
            measured += n;
            latencies.push(at.elapsed().as_secs_f64() * 1000.0);
        }
        total += n;
    }
    let duration = measured_start.unwrap().elapsed().as_secs_f64();
    let count: i64 = conn
        .query_row("SELECT sum(n) FROM c", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, total as i64);
    latencies.sort_by(f64::total_cmp);
    println!(
        "{}",
        json!({"mode":"raw-batch","batch":n,"total":total,"measured":measured,
        "seconds":duration,"ops_per_s":measured as f64/duration,"counter_ok":true,
        "journal_mode":conn.query_row("PRAGMA journal_mode",[],|r|r.get::<_,String>(0)).unwrap(),
        "synchronous":conn.query_row("PRAGMA synchronous",[],|r|r.get::<_,i64>(0)).unwrap(),
        "wal_autocheckpoint":conn.query_row("PRAGMA wal_autocheckpoint",[],|r|r.get::<_,i64>(0)).unwrap(),
        "transaction_latencies_ms":latencies})
    );
}
