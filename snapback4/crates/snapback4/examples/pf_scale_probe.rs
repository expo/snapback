//! Read-only operation/SQLite work census on a COPY of a calibration store.
//! Usage: pf_scale_probe store.sqlite viewer [now-ms]
//! PF_PROBES_JSON optionally names [{op,viewer,args}]; PF_RUNS defaults to 3.
//! PF_CACHE_KIB / PF_MMAP_BYTES are diagnostic overrides, never store defaults.
//! @ref LLP 3000.024#3 — distinguish bounded heads from posting population.
use rusqlite::{
    StatementStatus,
    trace::{TraceEvent, TraceEventCodes},
};
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, Store, Value};
use std::{cell::RefCell, collections::BTreeMap, time::Instant};

thread_local! {
    static SQL: RefCell<BTreeMap<String, Json>> = RefCell::default();
    static BEFORE: RefCell<[i32;3]> = const { RefCell::new([0;3]) };
}

fn trace(event: TraceEvent<'_>) {
    if let TraceEvent::Stmt(stmt, _) = event {
        BEFORE.with(|before| {
            *before.borrow_mut() = [
                stmt.get_status(StatementStatus::VmStep),
                stmt.get_status(StatementStatus::FullscanStep),
                stmt.get_status(StatementStatus::Sort),
            ]
        });
        return;
    }
    if let TraceEvent::Profile(stmt, _) = event {
        SQL.with(|sql| {
            let mut sql = sql.borrow_mut();
            let entry = sql
                .entry(stmt.sql().into_owned())
                .or_insert_with(|| json!({"calls":0,"steps":0,"fullscan":0,"sort":0}));
            entry["calls"] = json!(entry["calls"].as_u64().unwrap() + 1);
            for (i, (key, status)) in [
                ("steps", StatementStatus::VmStep),
                ("fullscan", StatementStatus::FullscanStep),
                ("sort", StatementStatus::Sort),
            ]
            .into_iter()
            .enumerate()
            {
                let prior = BEFORE.with(|before| before.borrow()[i]);
                entry[key] = json!(
                    entry[key].as_i64().unwrap() + i64::from(stmt.get_status(status) - prior)
                );
            }
        });
    }
}

fn cache(engine: &Engine) -> Json {
    let mut result = serde_json::Map::new();
    for (name, op) in [
        ("hits", rusqlite::ffi::SQLITE_DBSTATUS_CACHE_HIT),
        ("misses", rusqlite::ffi::SQLITE_DBSTATUS_CACHE_MISS),
    ] {
        let (mut current, mut high) = (0, 0);
        // The engine owns this live connection; status inspection neither steps
        // a statement nor changes row data. Reset only the diagnostic counter.
        let code = unsafe {
            rusqlite::ffi::sqlite3_db_status(
                engine.store().conn().handle(),
                op,
                &mut current,
                &mut high,
                1,
            )
        };
        assert_eq!(code, rusqlite::ffi::SQLITE_OK);
        result.insert(name.into(), json!(current));
    }
    Json::Object(result)
}

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let now = args
        .get(2)
        .map_or_else(snapback4_core::now_ms, |s| s.parse().unwrap());
    let mut engine = Engine::open_at(
        Store::open_read_only(std::path::Path::new(&args[0]))
            .unwrap()
            .reader()
            .unwrap(),
        now,
    )
    .unwrap();
    for (var, pragma, sign) in [
        ("PF_CACHE_KIB", "cache_size", -1),
        ("PF_MMAP_BYTES", "mmap_size", 1),
    ] {
        if let Ok(value) = std::env::var(var) {
            engine
                .store()
                .conn()
                .pragma_update(None, pragma, value.parse::<i64>().unwrap() * sign)
                .unwrap();
        }
    }
    let settings: BTreeMap<String, i64> = [
        "cache_size",
        "mmap_size",
        "synchronous",
        "wal_autocheckpoint",
        "journal_size_limit",
    ]
    .into_iter()
    .map(|name| {
        (
            name.into(),
            engine
                .store()
                .conn()
                .query_row(&format!("PRAGMA {name}"), [], |r| r.get(0))
                .unwrap(),
        )
    })
    .collect();
    engine.store().conn().trace_v2(
        TraceEventCodes::SQLITE_TRACE_PROFILE | TraceEventCodes::SQLITE_TRACE_STMT,
        Some(trace),
    );
    let probes: Vec<Json> = match std::env::var("PF_PROBES_JSON") {
        Ok(path) => serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap(),
        Err(_) => vec![
            json!({"op":"chat.searchMessages","viewer":args[1],"args":{"q":"coffee","conversation":null,"c":null}}),
            json!({"op":"insights.summary","viewer":args[1],"args":{}}),
        ],
    };
    for probe in probes {
        let name = probe["op"].as_str().unwrap();
        let viewer = probe["viewer"].as_str().unwrap();
        let params: BTreeMap<String, Value> = probe["args"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(key, value)| {
                (
                    key.clone(),
                    snapback4_core::wire::from_json(
                        &engine.program(name).unwrap().args[key],
                        value,
                    )
                    .unwrap(),
                )
            })
            .collect();
        let runs = std::env::var("PF_RUNS").map_or(3, |v| v.parse().unwrap());
        for run in 0..runs {
            SQL.with(|s| s.borrow_mut().clear());
            cache(&engine);
            let started = Instant::now();
            let result = engine
                .query(name, Context::new(viewer, params.clone()).at(now))
                .unwrap();
            let elapsed = started.elapsed().as_secs_f64() * 1000.0;
            let cache = cache(&engine);
            let sql = SQL.with(|s| std::mem::take(&mut *s.borrow_mut()));
            let plans: BTreeMap<_, _> = sql
                .keys()
                .filter(|s| s.starts_with("SELECT"))
                .map(|s| {
                    let mut stmt = engine
                        .store()
                        .conn()
                        .prepare(&format!("EXPLAIN QUERY PLAN {s}"))
                        .unwrap();
                    for i in 1..=stmt.parameter_count() {
                        stmt.raw_bind_parameter(i, rusqlite::types::Null).unwrap();
                    }
                    let mut rows = stmt.raw_query();
                    let mut plan = Vec::new();
                    while let Some(row) = rows.next().unwrap() {
                        plan.push(row.get::<_, String>(3).unwrap());
                    }
                    (s.clone(), plan)
                })
                .collect();
            println!(
                "{}",
                json!({"settings":settings,"op":name,"run":run,"ms":elapsed,"cache":cache,"meter":result.metered,"complete":result.complete,"rows":result.data.as_array().ok().map(|r|r.len()),"sql":sql,"plans":plans})
            );
        }
    }
}
