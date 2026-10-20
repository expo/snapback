//! S0 commit-path cells (LLP 3000.009.001.002 §9). Each subcommand runs one
//! cell at one setting, three times, and prints one JSON line. See README.md.
mod common;
mod execution;
mod model;
mod proxy;
mod raw;
mod sqlite;
mod sqlite_optimistic;

use common::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Value, engine::postgres::{PostgresEngine, WriteMode}};
use snapback4_postgres_evaluation::{compiled, context, fixture, id, namespace, sent};
use std::time::Instant;

pub struct Args(Vec<String>);
impl Args {
    pub fn get(&self, key: &str) -> Option<&str> {
        self.0.iter().position(|a| a == key).map(|i| self.0[i + 1].as_str())
    }
    pub fn req(&self, key: &str) -> &str {
        self.get(key).unwrap_or_else(|| panic!("missing {key}"))
    }
    pub fn num(&self, key: &str, default: usize) -> usize {
        self.get(key).map_or(default, |v| v.parse().expect(key))
    }
    pub fn flag(&self, key: &str) -> bool {
        self.0.iter().any(|a| a == key)
    }
    pub fn runs(&self) -> usize {
        self.num("--runs", 3)
    }
}

/// The experiment's fixture: the existing 32×25 rooms fixture with 256
/// counters (c0..c255) so every writer in a disjoint cell owns a counter.
pub fn rows() -> Vec<(String, Value)> {
    let mut rows = fixture(32, 25);
    for i in 8..256 {
        rows.push(("counters".into(), snapback4_core::value::object([("id", id(format!("c{i}"))), ("value", Value::Int(0))])));
    }
    rows
}

/// Create a fresh engine namespace over the Unix socket (setup, unmeasured).
pub fn create_engine(label: &str) -> (String, PostgresEngine) {
    let (schema, programs) = compiled();
    let name = namespace(label);
    let mut pg = PostgresEngine::create(admin(), &name, schema, programs).expect("create engine namespace");
    pg.seed_at(rows(), 10).expect("seed");
    let mut a = admin();
    a.batch_execute(&format!("SET search_path={name},pg_catalog; ANALYZE r; ANALYZE i; ANALYZE _log; ANALYZE _ops; ANALYZE _commits;")).unwrap();
    (name, pg)
}

pub fn slot(disjoint: bool, writer: usize) -> String {
    format!("c{}", if disjoint { writer } else { 0 })
}

fn tag() -> String {
    format!("{:x}", snapback4_core::ids::seed() & 0xffff_ffff)
}

fn ping(args: &Args) -> Json {
    let net = Net::parse(args.req("--net"));
    let mut client = net.connect();
    let statement = client.prepare("SELECT 1").unwrap();
    let n = args.num("--n", 3000);
    for _ in 0..200 {
        client.query_one(&statement, &[]).unwrap();
    }
    let mut us = Vec::with_capacity(n);
    for _ in 0..n {
        let start = Instant::now();
        client.query_one(&statement, &[]).unwrap();
        us.push(start.elapsed().as_secs_f64() * 1e6);
    }
    us.sort_by(f64::total_cmp);
    json!({"cell": "ping", "net": net.describe(), "iterations": n, "p50_us": us[n / 2], "p90_us": us[n * 9 / 10], "p99_us": us[n * 99 / 100], "min_us": us[0]})
}

/// Run a few increments with log_statement=all on the engine's own session
/// and return the server log lines they produced.
fn capture(_args: &Args) -> Json {
    let (name, _pg) = create_engine("cpcap");
    let log = std::path::Path::new(&env("PGDATA_DIR")).parent().unwrap().join("server.log");
    let before = std::fs::metadata(&log).map(|m| m.len()).unwrap_or(0);
    let url = format!("{} options='-c log_statement=all -c log_min_duration_statement=0'", env("PG_UNIX_URL"));
    let client = postgres::Client::connect(&url, postgres::NoTls).unwrap();
    let mut pg = PostgresEngine::open(client, &name).unwrap();
    pg.set_write_mode(WriteMode::Serialized);
    let mut calls = Vec::new();
    for i in 0..3 {
        let before = pg.stats().database_calls;
        sent(&pg.mutate("increment", Some(&format!("capture-{i}")), context("alice", &[("slot", id("c1"))])).unwrap());
        calls.push(pg.stats().database_calls - before);
    }
    drop(pg);
    std::thread::sleep(std::time::Duration::from_millis(300));
    let text = std::fs::read(&log).unwrap();
    let new = String::from_utf8_lossy(&text[before as usize..]).into_owned();
    json!({"cell": "capture", "schema": name, "engine_calls_per_increment": calls, "log": new.lines().collect::<Vec<_>>()})
}

/// Cell 1: the real PostgresEngine, WriteMode::Serialized, through `--net`.
fn engine(args: &Args) -> Json {
    let net = std::sync::Arc::new(Net::parse(args.req("--net")));
    let writers = args.num("--writers", 4);
    let disjoint = args.req("--counters") == "disjoint";
    let prefetch = args.get("--prefetch") != Some("off");
    let timing = Timing::from_env();
    let (name, mut pg) = create_engine("cpeng");
    let tag = tag();
    let mut runs = Vec::new();
    let mut total = 0i64;
    for run in 0..args.runs() {
        let (n1, n2, tag) = (name.clone(), net.clone(), tag.clone());
        let result = closed_loop(
            writers,
            &timing,
            Some(true),
            move |_| {
                let mut pg = PostgresEngine::open(n2.connect(), &n1).unwrap();
                pg.set_write_mode(WriteMode::Serialized);
                pg.set_prefetch(prefetch);
                pg
            },
            move |pg, w, i| {
                let before = pg.stats().database_calls;
                let out = pg
                    .mutate("increment", Some(&format!("{tag}-{run}-{w}-{i}")), context("alice", &[("slot", id(slot(disjoint, w)))]))
                    .map_err(|e| format!("{e:?}"))?;
                sent(&out);
                Ok(pg.stats().database_calls - before)
            },
        );
        total += result["total_ops"].as_i64().unwrap();
        runs.push(result);
    }
    // No lost increments: every acknowledged increment is in the counters.
    let mut sum = 0i64;
    for c in 0..writers.max(1) {
        let v = pg.query("counter", context("alice", &[("slot", id(format!("c{c}")))])).unwrap().data;
        sum += match v.field("value").unwrap() { Value::Int(n) => *n, other => panic!("{other:?}") };
    }
    json!({"cell": "engine", "committer": "reference (WriteMode::Serialized)", "net": net.describe(), "writers": writers,
        "counters": if disjoint {"disjoint"} else {"same"}, "prefetch": prefetch, "schema": name,
        "counter_check": {"acknowledged": total, "counter_sum": sum, "ok": total == sum},
        "summary": aggregate(&runs), "runs": runs})
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let cmd = argv.first().cloned().unwrap_or_default();
    let args = Args(argv);
    let started = now_iso();
    let load_before = loadavg();
    let mut out = match cmd.as_str() {
        "ping" => ping(&args),
        "capture" => capture(&args),
        "engine" => engine(&args),
        "model" => model::run(&args),
        "raw" => raw::run(&args),
        "pg-execution" => execution::run(&args),
        "sqlite-execution" => sqlite_optimistic::execution(&args),
        "sqlite-commit" => sqlite_optimistic::commit(&args),
        "sqlite-serve" => sqlite::serve(&args),
        "sqlite-four-connections" => sqlite::four_connections(&args),
        "sqlite-exec-flush" => sqlite::exec_flush(&args),
        "sqlite-old-cell" => sqlite::old_cell(&args),
        _ => panic!("usage: commit-path <ping|capture|engine|model|raw|sqlite-serve|sqlite-four-connections|sqlite-exec-flush|sqlite-old-cell> [options]; see README"),
    };
    out["started"] = json!(started);
    out["finished"] = json!(now_iso());
    out["loadavg_before"] = load_before;
    out["loadavg_after"] = loadavg();
    out["argv"] = json!(std::env::args().collect::<Vec<_>>());
    out["timing_ms"] = json!({"warmup": Timing::from_env().warmup.as_millis() as u64, "measure": Timing::from_env().measure.as_millis() as u64});
    out["profile"] = json!(if cfg!(debug_assertions) { "debug" } else { "release" });
    println!("{}", serde_json::to_string(&out).unwrap());
    if out["summary"]["status"] == "failed" || out["counter_check"]["ok"] == false {
        std::process::exit(1);
    }
}
