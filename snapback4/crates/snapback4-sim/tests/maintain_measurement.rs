//! Measurement only for LLP 3000.007 §20.9; no proposed syntax or production implementation.
//! Existing sum-of-0/1 and stored bucket columns proxy the target-row work of filters and keys.
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
