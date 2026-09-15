//! Opt-in measurements for LLP 3000.007 §20.9.
//! The original proxy control and the accepted filter/calendar/value-index forms run separately.
//! Run explicitly: cargo test -p snapback4-sim --test maintain_measurement -- --ignored --nocapture

use snapback4_core::engine::{Context, Engine, WriteState};
use snapback4_core::schema::Index;
use snapback4_core::store::Store;
use snapback4_core::value::{Value, object};
use std::collections::BTreeMap;
use std::time::Instant;

fn source(table: &str) -> String {
    format!(r#"table {table}:
  groupId: principal
  itemId: id
  at: time
  bucket: int
  included: int
  emoji: text <=8
  by byGroup: groupId, id
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

mutation add(rowId: id, itemId: id, included: int):
  insert {table} {{ id: rowId, groupId: viewer, itemId, at: now, bucket: 0, included, emoji: 'like' }}

mutation move(rowId: id):
  update {table}[rowId] {{ groupId: 'moved', bucket: 1, included: 0, emoji: 'heart' }}

mutation remove(rowId: id):
  delete {table}[rowId]
"#)
}

fn aggregate(table: &str, mode: &str) -> String {
    let declaration = match mode {
        "count" => format!("count {table} by groupId"),
        "filter_proxy" => format!("sum {table} of included by groupId"),
        "key_proxy" => format!("sum {table} of included by groupId, bucket"),
        "chips" | "rank_index" => format!("count {table} by groupId, itemId, emoji"),
        _ => return String::new(),
    };
    format!("\nmaintain totals: {declaration}\n  read <- allow\n  online only\n")
}

fn compiled(table: &str, mode: &str) -> snapback4_lang::Bound {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source(table) + &aggregate(table, mode))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

fn row(n: usize) -> Value {
    object([
        ("id", Value::Id(format!("r{n:08}"))),
        ("groupId", Value::Id(format!("u{:04}", n % 1000))),
        ("itemId", Value::Id(format!("m{:08}", n / 2))),
        ("at", Value::Int((n / 1000 * 86_400_000) as i64)),
        ("bucket", Value::Int((n / 1000) as i64)),
        ("included", Value::Int(i64::from(n % 4 != 0))),
        ("emoji", Value::String(if n % 2 == 0 { "like" } else { "heart" }.into())),
    ])
}

fn quantile(values: &mut [f64], percentile: usize) -> f64 {
    values.sort_by(f64::total_cmp);
    values[(values.len() - 1) * percentile / 100]
}

// @ref LLP 3000.007#20.9 — measure existing target-row/index work without claiming the proposed forms are implemented.
#[test]
#[ignore = "measurement only; scans the 50,000/100,000-row envelopes explicitly"]
fn existing_engine_maintain_costs() {
    for (table, count, modes) in [
        ("posts", 50_000, vec!["none", "count", "filter_proxy", "key_proxy"]),
        ("messages", 100_000, vec!["none", "count", "filter_proxy", "key_proxy"]),
        ("reactions", 100_000, vec!["none", "chips", "rank_index"]),
    ] {
        for mode in modes {
            let base = compiled(table, "none");
            let mut engine = Engine::new(Store::memory().unwrap(), base.schema, base.programs.into_iter().map(|p| p.program)).unwrap();
            for start in (0..count).step_by(500) {
                engine.seed((start..(start + 500).min(count)).map(|n| (table.into(), row(n)))).unwrap();
            }
            let mut candidate = compiled(table, mode);
            if mode == "rank_index" {
                // The existing engine already indexes engine-owned value rows. The binder has no surface for this yet.
                candidate.schema.tables.get_mut("totals").unwrap().indexes.insert("byCount".into(), Index::of(&["value", "id"], false));
            }
            let started = Instant::now();
            engine.adopt(candidate.schema, candidate.programs.into_iter().map(|p| p.program)).unwrap();
            let adoption_ms = started.elapsed().as_secs_f64() * 1000.0;
            let target_rows = if mode == "none" { 0 } else { engine.store().rows("totals").unwrap().len() };
            println!("MEASURE backfill source={table} rows={count} mode={mode} target_rows={target_rows} elapsed_ms={adoption_ms:.3} store=memory profile=debug");
            for operation in ["add", "move", "remove"] {
                let mut times = Vec::new();
                let mut metered = None;
                let mut meter_sum = BTreeMap::<String, u64>::new();
                for n in 0..200 {
                    let mut args = BTreeMap::from([("rowId".into(), Value::Id(format!("probe{n:05}")))]);
                    if operation == "add" {
                        args.insert("itemId".into(), Value::Id(format!("probe{n:05}")));
                        args.insert("included".into(), Value::Int(1));
                    }
                    let start = Instant::now();
                    let outcome = engine.mutate(operation, Some(&format!("{operation}-{n}")), Context::new("u0000", args).at(1)).unwrap();
                    times.push(start.elapsed().as_secs_f64() * 1_000_000.0);
                    assert!(matches!(outcome.state, WriteState::Sent { .. }), "{:?}", outcome.state);
                    metered = Some(outcome.metered);
                }
                let p50 = quantile(&mut times, 50);
                let p95 = quantile(&mut times, 95);
                println!("MEASURE write source={table} mode={mode} op={operation} n=200 p50_us={p50:.3} p95_us={p95:.3} last_meter={}", serde_json::to_string(&metered.unwrap()).unwrap());
            }
        }
    }
}

// @ref LLP 3000.007#20.9 — real filter/calendar/value-index execution beside the original proxy control.
#[test]
#[ignore = "explicit 50,000/100,000-row measurement; never part of the blocking suite"]
fn accepted_maintain_costs() {
    for (table, count) in [("posts", 50_000), ("messages", 100_000)] {
        for mode in ["filter0", "filter50", "filter100", "calendar", "rank", "expiry"] {
            let pct = match mode { "filter0" => 0, "filter50" => 50, _ => 100 };
            let source_text = if mode == "expiry" { source(table).replace("  at: time", "  at: time\n  until: time default 2000\n  by byUntil: until\n  expire at .until") } else { source(table) };
            let text = source_text + &format!(r#"
mutation unrelated(rowId: id):
  update {table}[rowId] {{ emoji: 'other' }}
mutation decrease(rowId: id):
  update {table}[rowId] {{ included: 0 }}
mutation enter(rowId: id):
  update {table}[rowId] {{ included: 1 }}
mutation keyMove(rowId: id):
  update {table}[rowId] {{ groupId: 'moved', at: 86400000 }}
"#);
            let base = snapback4_lang::compile(&[("schema.q".into(), text.clone())]);
            assert!(base.diagnostics.is_empty(), "{:?}", base.diagnostics);
            let mut engine = Engine::new(Store::memory().unwrap(), base.schema, base.programs.into_iter().map(|p| p.program)).unwrap();
            for start in (0..count).step_by(500) {
                engine.seed((start..(start + 500).min(count)).map(|n| {
                    let mut value = row(n).as_object().unwrap().clone();
                    value.insert("included".into(), Value::Int(i64::from(n % 100 < pct)));
                    (table.into(), Value::Row(value.into()))
                })).unwrap();
            }
            let declaration = match mode {
                "calendar" | "expiry" => format!("count {table} where .included = 1 by groupId, day(.at)"),
                "rank" => format!("sum {table} of included by groupId"),
                _ => format!("count {table} where .included = 1 by groupId"),
            };
            let extra = if mode == "rank" { "  by byCount: value, id\nquery leaders(c: cursor ?):\n  return totals after c last 10 by byCount\n" } else if mode == "expiry" { "query live():\n  return totals['u0000', day(now)]\n" } else { "" };
            let candidate = snapback4_lang::compile(&[("schema.q".into(), format!("{text}\nmaintain totals: {declaration}\n  read <- allow\n  online only\n{extra}"))]);
            assert!(candidate.diagnostics.is_empty(), "{:?}", candidate.diagnostics);
            let start = Instant::now();
            engine.adopt(candidate.schema, candidate.programs.into_iter().map(|p| p.program)).unwrap();
            println!("REAL adoption source={table} n={count} mode={mode} groups={} ms={:.3} store=sqlite-memory resumable_chunks=0", engine.store().rows("totals").unwrap().len(), start.elapsed().as_secs_f64() * 1000.0);
            // Capture physical source/target index work independently of the meter.
            engine.store().conn().execute_batch(&format!(r#"
CREATE TEMP TABLE d1_counts(kind TEXT PRIMARY KEY, n INTEGER);
INSERT INTO d1_counts VALUES ('target_rows',0),('target_index_insert',0),('target_index_delete',0),('source_index_insert',0),('source_index_delete',0);
CREATE TEMP TRIGGER d1_ri AFTER INSERT ON r WHEN NEW.t = (SELECT num FROM _catalog WHERE name='totals') BEGIN UPDATE d1_counts SET n=n+1 WHERE kind='target_rows'; END;
CREATE TEMP TRIGGER d1_ru AFTER UPDATE ON r WHEN NEW.t = (SELECT num FROM _catalog WHERE name='totals') BEGIN UPDATE d1_counts SET n=n+1 WHERE kind='target_rows'; END;
CREATE TEMP TRIGGER d1_rd AFTER DELETE ON r WHEN OLD.t = (SELECT num FROM _catalog WHERE name='totals') BEGIN UPDATE d1_counts SET n=n+1 WHERE kind='target_rows'; END;
CREATE TEMP TRIGGER d1_ii AFTER INSERT ON i BEGIN UPDATE d1_counts SET n=n+1 WHERE kind=CASE WHEN NEW.ti IN (SELECT num FROM _catalog WHERE name LIKE 'totals.%') THEN 'target_index_insert' ELSE 'source_index_insert' END; END;
CREATE TEMP TRIGGER d1_id AFTER DELETE ON i BEGIN UPDATE d1_counts SET n=n+1 WHERE kind=CASE WHEN OLD.ti IN (SELECT num FROM _catalog WHERE name LIKE 'totals.%') THEN 'target_index_delete' ELSE 'source_index_delete' END; END;
"#)).unwrap();
            for op in ["add", "unrelated", "decrease", "enter", "keyMove", "remove"] {
                engine.store().conn().execute("UPDATE d1_counts SET n=0", []).unwrap();
                let mut times = Vec::new();
                let mut metered = None;
                let mut meter_sum = BTreeMap::<String, u64>::new();
                for n in 0..200 {
                    let mut args = BTreeMap::from([("rowId".into(), Value::Id(format!("real{n:04}")))]);
                    if op == "add" { args.insert("itemId".into(), Value::Id(format!("item{n:04}"))); args.insert("included".into(), Value::Int(i64::from(n % 100 < pct))); }
                    let start = Instant::now();
                    let out = engine.mutate(op, None, Context::new("u0000", args).at(0)).unwrap();
                    times.push(start.elapsed().as_secs_f64() * 1_000_000.0);
                    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
                    for (kind, value) in serde_json::to_value(out.metered).unwrap().as_object().unwrap() {
                        *meter_sum.entry(kind.clone()).or_default() += value.as_u64().unwrap();
                    }
                    metered = Some(out.metered);
                }
                let physical: BTreeMap<String, i64> = engine.store().conn().prepare("SELECT kind,n FROM d1_counts").unwrap().query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_,_>>().unwrap();
                println!("REAL write source={table} mode={mode} op={op} n=200 p50_us={:.3} p95_us={:.3} last_meter={} meter_sum_200={} physical_200={}", quantile(&mut times,50), quantile(&mut times,95), serde_json::to_string(&metered.unwrap()).unwrap(), serde_json::to_string(&meter_sum).unwrap(), serde_json::to_string(&physical).unwrap());
            }
            if mode == "expiry" {
                let before = engine.query("live", Context::new("u0000", BTreeMap::new()).at(1000)).unwrap();
                let after = engine.query("live", Context::new("u0000", BTreeMap::new()).at(2000)).unwrap();
                assert!(before.complete && after.complete);
                assert_eq!(after.data, Value::Int(0));
                println!("REAL expiry source={table} before={} after={} next_expiry={:?} before_meter={} after_meter={}",
                    before.data.as_int().unwrap(), after.data.as_int().unwrap(), before.next_expiry,
                    serde_json::to_string(&before.metered).unwrap(), serde_json::to_string(&after.metered).unwrap());
            }
            if mode == "rank" {
                let mut times = Vec::new(); let mut meter = None;
                for _ in 0..200 {
                    let start = Instant::now();
                    let read = engine.query("leaders", Context::new("u0000", BTreeMap::from([("c".into(), Value::Null)]))).unwrap();
                    times.push(start.elapsed().as_secs_f64() * 1_000_000.0); meter = Some(read.metered);
                    assert_eq!(read.data.as_array().unwrap().len(), 10);
                }
                println!("REAL rank source={table} n=200 p50_us={:.3} p95_us={:.3} last_meter={}", quantile(&mut times,50), quantile(&mut times,95), serde_json::to_string(&meter.unwrap()).unwrap());
            }
        }
    }
}
