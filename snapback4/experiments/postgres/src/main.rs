//! Same-process SQLite/PG Quarry comparison plus an explicitly separate SQL
//! planning experiment. Not a production or competitor benchmark.
use serde_json::{Value as Json, json};
use snapback4_core::{
    Engine, Value,
    engine::postgres::{PostgresEngine, WriteMode},
    store::Store,
    value::object,
};
use snapback4_postgres_evaluation::*;
use std::{
    sync::{Arc, Barrier},
    time::Instant,
};

fn timings(label: &str, n: usize, mut run: impl FnMut() -> Value, expected: Option<&Value>) -> Json {
    for _ in 0..20 {
        let value = run();
        if let Some(expected) = expected {
            assert_eq!(&value, expected);
        }
    }
    let mut us = Vec::new();
    for _ in 0..n {
        let start = Instant::now();
        let value = std::hint::black_box(run());
        us.push(start.elapsed().as_secs_f64() * 1e6);
        if let Some(expected) = expected {
            assert_eq!(&value, expected);
        }
    }
    us.sort_by(f64::total_cmp);
    json!({"label":label,"iterations":n,"p50_us":us[n/2],"p95_us":us[(n*95/100).min(n-1)],"mean_us":us.iter().sum::<f64>() / n as f64})
}

fn concurrent_pg(name: &str, mode: WriteMode, disjoint: bool, n: usize) -> Json {
    let gate = Arc::new(Barrier::new(5));
    let handles: Vec<_> = (0..4)
        .map(|writer| {
            let name = name.to_owned();
            let gate = gate.clone();
            std::thread::spawn(move || {
                let mut pg = PostgresEngine::open(connect(), &name).unwrap();
                pg.set_write_mode(mode);
                let slot = format!("c{}", if disjoint { writer } else { 0 });
                gate.wait();
                for i in 0..n {
                    sent(
                        &pg.mutate(
                            "increment",
                            Some(&format!("{mode:?}-{disjoint}-{writer}-{i}")),
                            context("alice", &[("slot", id(&slot))]),
                        )
                        .unwrap(),
                    );
                }
                pg.stats()
            })
        })
        .collect();
    let start = Instant::now();
    gate.wait();
    let mut retries = 0;
    let mut calls = 0;
    for handle in handles {
        let stats = handle.join().unwrap();
        retries += stats.transaction_retries;
        calls += stats.database_calls;
    }
    let elapsed = start.elapsed().as_secs_f64();
    json!({"backend":"postgres","mode":format!("{mode:?}"),"disjoint":disjoint,"writers":4,"mutations":4*n,"seconds":elapsed,"mutations_per_second":4.0*n as f64/elapsed,"retries":retries,"database_calls":calls})
}

fn concurrent_sqlite(path: &std::path::Path, disjoint: bool, n: usize) -> Json {
    let gate = Arc::new(Barrier::new(5));
    let handles: Vec<_> = (0..4)
        .map(|writer| {
            let path = path.to_owned();
            let gate = gate.clone();
            std::thread::spawn(move || {
                let store = Store::open(&path).unwrap();
                store.conn().execute_batch("PRAGMA synchronous=FULL").unwrap();
                let mut sqlite = Engine::open(store).unwrap();
                let slot = format!("c{}", if disjoint { writer } else { 0 });
                gate.wait();
                for i in 0..n {
                    sent(
                        &sqlite
                            .mutate("increment", Some(&format!("{disjoint}-{writer}-{i}")), context("alice", &[("slot", id(&slot))]))
                            .unwrap(),
                    );
                }
            })
        })
        .collect();
    let start = Instant::now();
    gate.wait();
    for handle in handles {
        handle.join().unwrap();
    }
    let elapsed = start.elapsed().as_secs_f64();
    json!({"backend":"sqlite","mode":"WAL/FULL","disjoint":disjoint,"writers":4,"mutations":4*n,"seconds":elapsed,"mutations_per_second":4.0*n as f64/elapsed})
}

// Isolate the SQLite regression cells from the optional Postgres stress
// modes. Reuse the exact fixture, timings, durability and writer functions.
fn sqlite_only(n: usize) -> Json {
    let (schema, programs) = compiled();
    let directory = std::env::temp_dir().join(namespace("sqlite_bench"));
    std::fs::create_dir(&directory).unwrap();
    let path = directory.join("store.sqlite");
    let store = Store::open(&path).unwrap();
    store.conn().execute_batch("PRAGMA synchronous=FULL").unwrap();
    let mut sqlite = Engine::new(store, schema, programs).unwrap();
    sqlite.seed_at(fixture(32, 25), 10).unwrap();
    let ctx = context("alice", &[("itemId", id("r000-i0000"))]);
    let expected = sqlite.query("item", ctx.clone()).unwrap().data;
    let point = timings("sqlite/item", n, || sqlite.query("item", ctx.clone()).unwrap().data, Some(&expected));
    let concurrency: Vec<_> = [false, true].into_iter().map(|disjoint| concurrent_sqlite(&path, disjoint, n / 2)).collect();
    for slot in 0..4 {
        let result = sqlite.query("counter", context("alice", &[("slot", id(format!("c{slot}")))])).unwrap();
        assert_eq!(result.data.field("value").unwrap(), &Value::Int((n / 2 * if slot == 0 { 5 } else { 1 }) as i64));
    }
    json!({"experiment":"C1 SQLite point and four-writer regression cells", "sqlite_file":path,
        "unix_ms":snapback4_core::now_ms(), "profile":if cfg!(debug_assertions){"debug"}else{"release"},
        "rooms":32,"items_per_room":25,"read_latencies":[point],"concurrency":concurrency,
        "sqlite_version":sqlite.store().conn().query_row("SELECT sqlite_version()",[],|r|r.get::<_,String>(0)).unwrap(),
        "sqlite_durability":"WAL, synchronous=FULL (not fullfsync)"})
}

fn main() {
    let n: usize = std::env::args().nth(1).map(|s| s.parse().expect("iteration count")).unwrap_or(200);
    assert!((20..=10_000).contains(&n), "use 20..10000 iterations");
    if std::env::args().nth(2).as_deref() == Some("--sqlite-only") {
        write_result(sqlite_only(n));
        return;
    }
    let (schema, programs) = compiled();
    let name = namespace("bench");
    let directory = std::env::temp_dir().join(&name);
    std::fs::create_dir(&directory).unwrap();
    let path = directory.join("store.sqlite");
    let store = Store::open(&path).unwrap();
    store.conn().execute_batch("PRAGMA synchronous=FULL").unwrap();
    let mut sqlite = Engine::new(store, schema.clone(), programs.clone()).unwrap();
    let mut pg = PostgresEngine::create(connect(), &name, schema, programs).unwrap();
    let rows = fixture(32, 25);
    sqlite.seed_at(rows.clone(), 10).unwrap();
    pg.seed_at(rows, 10).unwrap();
    let mut admin = connect();
    admin.batch_execute(&format!("SET search_path={name},pg_catalog; ANALYZE r; ANALYZE i; ANALYZE _log;")).unwrap();
    let settings = admin.query("SELECT name,setting FROM pg_settings WHERE name IN ('server_version','fsync','synchronous_commit','full_page_writes','shared_buffers') ORDER BY name", &[]).unwrap();
    let settings: Vec<_> = settings.iter().map(|r| json!([r.get::<_, &str>(0), r.get::<_, &str>(1)])).collect();
    let mut reads = Vec::new();
    for (op, args) in
        [("item", vec![("itemId", id("r000-i0000"))]), ("page", vec![("room", id("r000")), ("c", Value::Null)]), ("inbox", vec![])]
    {
        let expected = sqlite.query(op, context("alice", &args)).unwrap();
        assert_eq!(pg.query(op, context("alice", &args)).unwrap(), expected);
        reads.push(timings(&format!("sqlite/{op}"), n, || sqlite.query(op, context("alice", &args)).unwrap().data, Some(&expected.data)));
        let before = pg.stats();
        let mut result =
            timings(&format!("postgres/{op}"), n, || pg.query(op, context("alice", &args)).unwrap().data, Some(&expected.data));
        result["database_calls_per_operation"] = json!((pg.stats().database_calls - before.database_calls) as f64 / (n + 20) as f64);
        result["metered"] = json!(expected.metered);
        reads.push(result);
    }
    // A relational shape and one joined plan, with pre-maintained totals like
    // Quarry's inbox. This is a planning lower bound: it does NOT implement
    // generic Snapback rules, meter, completeness, cursor or sync semantics.
    admin.batch_execute("CREATE TABLE native_memberships (id TEXT COLLATE \"C\" PRIMARY KEY, principal TEXT COLLATE \"C\" NOT NULL, room TEXT COLLATE \"C\" NOT NULL);
        CREATE INDEX native_memberships_inbox ON native_memberships(principal,room,id);
        CREATE TABLE native_totals (room TEXT COLLATE \"C\" PRIMARY KEY,value BIGINT NOT NULL);").unwrap();
    let mut tx = admin.transaction().unwrap();
    for r in 0..32 {
        let room = format!("r{r:03}");
        tx.execute("INSERT INTO native_memberships VALUES ($1,'alice',$2)", &[&format!("{room}-alice"), &room]).unwrap();
        tx.execute("INSERT INTO native_totals VALUES ($1,300)", &[&room]).unwrap();
    }
    tx.commit().unwrap();
    admin.batch_execute("ANALYZE native_memberships; ANALYZE native_totals;").unwrap();
    let sql = "SELECT m.room,t.value FROM native_memberships m JOIN native_totals t ON t.room=m.room WHERE m.principal=$1 ORDER BY m.room,m.id LIMIT 32";
    let plan = admin.prepare(sql).unwrap();
    let expected = sqlite.query("inbox", context("alice", &[])).unwrap().data;
    reads.push(timings(
        "postgres/native_sql_inbox_lower_bound",
        n,
        || {
            let mut tx =
                admin.build_transaction().isolation_level(postgres::IsolationLevel::RepeatableRead).read_only(true).start().unwrap();
            let result = Value::Array(
                tx.query(&plan, &[&"alice"])
                    .unwrap()
                    .iter()
                    .map(|r| object([("room", id(r.get::<_, &str>(0))), ("total", Value::Int(r.get(1)))]))
                    .collect(),
            );
            tx.rollback().unwrap();
            result
        },
        Some(&expected),
    ));
    let explain: Vec<String> =
        admin.query(&format!("EXPLAIN (ANALYZE, BUFFERS) {sql}"), &[&"alice"]).unwrap().iter().map(|r| r.get(0)).collect();
    let mut writes = Vec::new();
    let mut sqlite_op = 0;
    writes.push(timings(
        "sqlite/increment",
        n,
        || {
            sqlite_op += 1;
            let result = sqlite.mutate("increment", Some(&format!("serial-{sqlite_op}")), context("alice", &[("slot", id("c7"))])).unwrap();
            sent(&result);
            Value::Null
        },
        None,
    ));
    let mut pg_op = 0;
    let before = pg.stats();
    let mut timing = timings(
        "postgres/increment",
        n,
        || {
            pg_op += 1;
            let result = pg.mutate("increment", Some(&format!("serial-{pg_op}")), context("alice", &[("slot", id("c7"))])).unwrap();
            sent(&result);
            Value::Null
        },
        None,
    );
    timing["database_calls_per_operation"] = json!((pg.stats().database_calls - before.database_calls) as f64 / (n + 20) as f64);
    writes.push(timing);
    let mut concurrency = Vec::new();
    for disjoint in [false, true] {
        concurrency.push(concurrent_sqlite(&path, disjoint, n / 2));
        for mode in [WriteMode::Serialized, WriteMode::Serializable] {
            concurrency.push(concurrent_pg(&name, mode, disjoint, n / 2));
        }
    }
    // No lost increments across any measured run (including warm-up).
    assert_eq!(
        pg.query("counter", context("alice", &[("slot", id("c7"))])).unwrap().data.field("value").unwrap(),
        &Value::Int((n + 20) as i64)
    );
    for slot in 0..4 {
        let expected_sqlite = (n / 2 * if slot == 0 { 5 } else { 1 }) as i64;
        for (value, expected) in [
            (sqlite.query("counter", context("alice", &[("slot", id(format!("c{slot}")))])).unwrap().data, expected_sqlite),
            (pg.query("counter", context("alice", &[("slot", id(format!("c{slot}")))])).unwrap().data, expected_sqlite * 2),
        ] {
            assert_eq!(value.field("value").unwrap(), &Value::Int(expected));
        }
    }
    let output = json!({"experiment":"Postgres Rows adapter, not production qualification", "schema":name,"sqlite_file":path,
        "unix_ms":snapback4_core::now_ms(),"profile":if cfg!(debug_assertions){"debug"}else{"release"},"rooms":32,"items_per_room":25,
        "sqlite_version":sqlite.store().conn().query_row("SELECT sqlite_version()",[],|r|r.get::<_,String>(0)).unwrap(),
        "sqlite_durability":"WAL, synchronous=FULL (not fullfsync); same machine as PostgreSQL", "postgres_settings":settings,
        "read_latencies":reads,"mutation_latencies":writes,"concurrency":concurrency,"native_inbox_plan":explain});
    write_result(output);
}

fn write_result(output: Json) {
    let text = serde_json::to_string_pretty(&output).unwrap();
    if let Ok(path) = std::env::var("SNAPBACK4_EVAL_OUTPUT") {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(path).expect("new result artifact path");
        file.write_all(text.as_bytes()).unwrap();
        file.write_all(b"\n").unwrap();
    }
    println!("{text}");
}
