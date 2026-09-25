//! LLP 3000.013 lane D: Grok's heap and per-row authorization regressions.
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, JobState, Value, wire};
use std::collections::BTreeMap;

fn memory(source: &str) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn load(engine: &mut Engine, rows: Vec<(&str, Json)>) {
    let rows = rows.into_iter().map(|(table, row)| (table.into(), wire::row_from_json(engine.schema().table(table).unwrap(), &row).unwrap())).collect::<Vec<_>>();
    engine.load(rows).unwrap();
}

#[test]
fn a_wide_key_domain_near_the_job_examined_ceiling_keeps_one_cursor() {
    let mut engine = memory(r#"
effect total
table starts:
  public
  online only
table entries:
  key: text <=400
  n: int
  by byKey: key, id
  public
  online only
job sweep():
  for start in starts:
    n = count(entries[] by byKey)
    emit total { n }
"#);
    load(&mut engine, vec![("starts", json!({"id":"start"}))]);
    load(&mut engine, (0..16_370).map(|n| ("entries", json!({"id":format!("e{n:05}"), "key":"x".repeat(256), "n":1}))).collect());
    let run = engine.run_job("sweep", BTreeMap::new(), 1).unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    assert_eq!(run.chunks, 1);
    assert_eq!(engine.effects(None, 1).unwrap()[0].payload.field("n").unwrap(), &Value::Int(16_370));
    assert!(run.heap_peak < 100_000, "cursor scratch must not accumulate per row: {run:?}");
    println!("wide-key streaming: {run:?}");
}

#[test]
fn inner_job_domain_refuses_before_decoding_the_unaffordable_suffix() {
    let source = r#"
effect notify
table starts:
  public
  online only
table entries:
  body: text <=1000000
  public
  online only
job sweep():
  for start in starts:
    emit notify { id: start.id } once [start.id]
    n = 0
    for entry in entries:
      n = n + 1
    emit notify { n }
"#;
    for poison_suffix in [false, true] {
        let mut engine = memory(source);
        load(&mut engine, vec![("starts", json!({"id":"start"}))]);
        load(&mut engine, (0..128).map(|n| ("entries", json!({"id":format!("e{n:03}"), "body":"x".repeat(256_000)}))).collect());
        if poison_suffix {
            // If the decoder runs ahead of the allowance, it reaches this
            // deliberately malformed final image and returns E_STORE instead.
            engine.store().conn().execute("UPDATE r SET data = 'malformed' WHERE id = 'e127'", []).unwrap();
        }
        let run = engine.run_job("sweep", BTreeMap::new(), 1).unwrap();
        assert_eq!(run.state, JobState::Parked, "{run:?}");
        assert_eq!(run.chunk_size, 1);
        assert!(run.error.as_ref().is_some_and(|error| error.starts_with("E_BOUND:") && error.contains("heap")), "suffix={poison_suffix}: {run:?}");
        assert_eq!(run.chunks, 0);
        assert!(engine.effects(None, 10).unwrap().is_empty());
        let tables: i64 = engine.store().conn().query_row("SELECT count(*) FROM sqlite_master WHERE name = '_effect_keys'", [], |r| r.get(0)).unwrap();
        assert_eq!(tables, 0, "refused first chunk rolls back the key table too");
        println!("inner domain, poisoned suffix={poison_suffix}: {run:?}");
    }
}

#[test]
fn adaptive_non_uniform_sweep_reads_one_large_candidate_at_a_time() {
    let source = r#"
effect notify
table items:
  owner: principal
  payload: json <=1000000
  read <- .owner = viewer
  online only
job sweep():
  for item in items:
    emit notify { id: item.id }
"#;
    for extra_work in [false, true] {
        // The review's emit-only body fits K=2. Two ordinary payload bindings
        // also exercise K=1, without changing the selector or any ceiling.
        let source = if extra_work { source.replace("    emit notify", "    scratch = item.payload\n    scratch = item.payload\n    emit notify") } else { source.into() };
        let mut engine = memory(&source);
        load(&mut engine, (0..32).map(|n| ("items", json!({"id":format!("i{n:02}"), "owner":"alice", "payload":"x".repeat(999_000)}))).collect());
        let run = engine.run_job("sweep", BTreeMap::new(), 1).unwrap();
        assert_eq!(run.state, JobState::Done, "{run:?}");
        assert_eq!(run.chunk_size, if extra_work { 1 } else { 2 }, "{run:?}");
        assert_eq!(run.retries, if extra_work { 6 } else { 5 });
        assert_eq!(run.chunks, if extra_work { 32 } else { 16 });
        assert_eq!(engine.effects(None, 100).unwrap().len(), 32);
        println!("non-uniform large JSON sweep, extra work={extra_work}: {run:?}");
    }
}

#[test]
fn allowed_prefix_visits_and_excludes_rows_denied_by_the_read_rule() {
    let mut engine = memory(r#"
table items:
  scope: text <=20
  owner: principal
  n: int
  cap 100 by scope
  by byScope: scope, id
  read <- .scope = 'shared' and .owner = viewer
  online only
query total():
  return count(items['shared'] by byScope)
query amount():
  return sum(items['shared'] by byScope, .n)
"#);
    load(&mut engine, vec![
        ("items", json!({"id":"a", "scope":"shared", "owner":"alice", "n":7})),
        ("items", json!({"id":"b", "scope":"shared", "owner":"bob", "n":1000})),
        ("items", json!({"id":"c", "scope":"shared", "owner":"alice", "n":11})),
    ]);
    for (op, expected) in [("total", 2), ("amount", 18)] {
        let result = engine.query(op, Context::new("alice", BTreeMap::new()).at(1)).unwrap();
        assert_eq!(result.metered.examined, 2, "denied rows stay inside the prepaid authorization scan");
        assert_eq!(result.data, Value::Int(expected));
        assert!(!result.complete, "retain the non-uniform query contract");
    }
}
