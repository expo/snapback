//! LLP 3000.013 lane D: retained-domain handoff and uniform capped totals.
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, JobState, Value, meter::Ceilings, wire};
use std::collections::BTreeMap;

fn memory(source: &str) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn load(engine: &mut Engine, rows: Vec<(&str, Json)>) {
    let rows = rows.into_iter().map(|(table, row)| (table.into(), wire::row_from_json(&engine.schema().tables[table], &row).unwrap())).collect::<Vec<_>>();
    engine.load(rows).unwrap();
}

#[test]
fn three_large_inner_domain_rows_fit_after_decode_scratch_is_released() {
    let mut engine = memory(r#"
effect total
table starts:
  public
  online only
table entries:
  body: text <=8000000
  public
  online only
job sweep():
  for start in starts:
    n = 0
    for entry in entries:
      n = n + 1
    emit total { n } once [start.id]
"#);
    load(&mut engine, vec![("starts", json!({"id":"start"}))]);
    load(&mut engine, (0..3).map(|n| ("entries", json!({"id":format!("e{n}"), "body":"x".repeat(2_000_000)}))).collect());
    let run = engine.run_job("sweep", BTreeMap::new(), 1).unwrap();
    println!("three large retained rows: {run:?}");
    assert_eq!(run.state, JobState::Done, "{run:?}");
    assert_eq!(run.chunks, 1);
    assert_eq!(run.retries, 0);
    assert!(run.heap_peak <= Ceilings::job().heap_bytes, "{run:?}");
    let effects = engine.effects(None, 10).unwrap();
    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0].payload.field("n").unwrap(), &Value::Int(3));
}

#[test]
fn inner_domain_near_the_examined_ceiling_retains_rows_without_unused_keys() {
    let mut engine = memory(r#"
effect total
table starts:
  public
  online only
table entries:
  n: int
  public
  online only
job sweep():
  for start in starts:
    n = 0
    for entry in entries:
      n = n + entry.n
    emit total { n }
"#);
    load(&mut engine, vec![("starts", json!({"id":"start"}))]);
    load(&mut engine, (0..16_370).map(|n| ("entries", json!({"id":format!("e{n:05}"), "n":1}))).collect());
    let run = engine.run_job("sweep", BTreeMap::new(), 1).unwrap();
    println!("retained rows without unused keys: {run:?}");
    assert_eq!(run.state, JobState::Done, "{run:?}");
    assert_eq!(run.chunks, 1);
    assert_eq!(engine.effects(None, 1).unwrap()[0].payload.field("n").unwrap(), &Value::Int(16_370));
    assert!(run.heap_peak < 5_000_000, "unused per-row keys must not consume the retained allowance: {run:?}");
}

#[test]
fn uniform_schema_capped_aggregates_stream_and_withhold_cut_totals() {
    let mut engine = memory(r#"
table items:
  cap 100
  n: int
  public
  online only
query total():
  return count(items[] by byId)
query amount():
  return sum(items[] by byId, .n)
"#);
    load(&mut engine, (0..10).map(|n| ("items", json!({"id":format!("i{n}"), "n":7}))).collect());
    for (op, expected) in [("total", 10), ("amount", 70)] {
        engine.set_ceilings(Ceilings::default());
        let complete = engine.query(op, Context::new("alice", BTreeMap::new()).at(1)).unwrap();
        assert!(complete.complete);
        assert_eq!(complete.data, Value::Int(expected));
        engine.set_ceilings(Ceilings { examined: 3, ..Ceilings::default() });
        let cut = engine.query(op, Context::new("alice", BTreeMap::new()).at(1)).unwrap();
        assert!(!cut.complete);
        assert_eq!(cut.data, Value::Null, "a schema cap does not permit a partial streaming total: {cut:?}");
    }
}
