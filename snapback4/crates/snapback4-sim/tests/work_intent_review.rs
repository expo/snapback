//! Regressions from the first independent review of LLP 3000.013 lane D.
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, JobState, Value, engine::WriteState, wire};
use std::collections::BTreeMap;

fn memory(source: &str) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}

fn load(engine: &mut Engine, rows: Vec<(&str, Json)>) {
    let rows = rows.into_iter().map(|(table, row)| {
        (table.into(), wire::row_from_json(engine.schema().table(table).unwrap(), &row).unwrap())
    }).collect::<Vec<_>>();
    engine.load(rows).unwrap();
}

#[test]
fn resolved_inner_aggregates_preserve_the_non_uniform_outer_page() {
    for predicate in ["exists notes[.id] by byFolder", "count(notes[.id] by byFolder) > 0", "sum(notes[.id] by byFolder, .n) > 0"] {
        let source = format!(r#"
table folders:
  owner: principal
  read <- .owner = viewer
  online only
table notes:
  folderId: folders
  n: int
  by byFolder: folderId, id
  public 'test notes'
  online only
query foldersWithNotes(c: cursor ?):
  return folders first 10 by byId after c where ({predicate})
"#);
        let mut engine = memory(&source);
        load(&mut engine, vec![
            ("folders", json!({"id":"alice-folder", "owner":"alice"})),
            ("folders", json!({"id":"bob-folder", "owner":"bob"})),
            ("notes", json!({"id":"note", "folderId":"alice-folder", "n":1})),
        ]);
        let result = engine.query("foldersWithNotes", Context::new("alice", [("c".into(), Value::Null)].into()).at(1)).unwrap();
        let rows = result.data.as_array().expect("a resolved inner aggregate must not erase its outer page");
        assert_eq!(rows.len(), 1, "{predicate}: {result:?}");
        assert_eq!(rows[0].field("id").unwrap(), &Value::Id("alice-folder".into()));
        assert!(!result.complete, "outer non-uniform coverage remains incomplete");
        assert!(result.next.is_some(), "outer continuation is preserved: {result:?}");
    }
}

#[test]
fn adaptive_single_item_chunks_do_not_fetch_a_second_large_row() {
    let mut engine = memory(r#"
effect notify
table items:
  body: text <=8000000
  public 'test items'
  online only
job sweep():
  for item in items:
    emit notify { item: item.id }
"#);
    load(&mut engine, (0..2).map(|i| ("items", json!({"id":format!("i{i}"), "body":"x".repeat(1_500_000)}))).collect());
    let run = engine.run_job("sweep", BTreeMap::new(), 1).unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    assert_eq!(run.chunk_size, 1);
    assert_eq!(run.retries, 6);
    assert_eq!(run.chunks, 2);
    let effects = engine.effects(None, 10).unwrap();
    assert_eq!(effects.len(), 2, "refused attempts must leave no effects");
    let mut items = effects.iter().map(|effect| effect.payload.field("item").unwrap().as_str().unwrap()).collect::<Vec<_>>();
    items.sort();
    assert_eq!(items, ["i0", "i1"]);
    println!("large adaptive rows: {run:?}");
}

#[test]
fn schema_capped_non_uniform_count_and_sum_keep_their_execution_path() {
    let mut engine = memory(r#"
table items:
  cap 100
  owner: principal
  n: int
  read <- .owner = viewer
  online only
query total():
  return count(items[] by byId)
query amount():
  return sum(items[] by byId, .n)
"#);
    load(&mut engine, vec![
        ("items", json!({"id":"a", "owner":"alice", "n":7})),
        ("items", json!({"id":"b", "owner":"bob", "n":1000})),
        ("items", json!({"id":"c", "owner":"alice", "n":11})),
    ]);
    for (viewer, count, sum) in [("alice", 2, 18), ("bob", 1, 1000), ("carol", 0, 0)] {
        for (op, expected) in [("total", count), ("amount", sum)] {
            let result = engine.query(op, Context::new(viewer, BTreeMap::new()).at(1)).unwrap();
            assert_eq!(result.data, Value::Int(expected), "{viewer}/{op}: {result:?}");
            assert!(!result.complete, "non-uniform reads keep their existing coverage contract");
        }
    }
}

#[test]
fn explicitly_paged_job_prelude_loop_remains_a_prelude() {
    let mut engine = memory(r#"
table items:
  n: int
  public 'test items'
  online only
job sweep():
  total = 0
  for row in items first 10 by byId:
    total = total + row.n
  chunk row in items first 10 by byId:
    update items[row.id] { n: total }
query amounts():
  return items first 10 by byId
"#);
    load(&mut engine, vec![("items", json!({"id":"a", "n":2})), ("items", json!({"id":"b", "n":3}))]);
    let run = engine.run_job("sweep", BTreeMap::new(), 1).unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    assert_eq!(run.chunk_size, 10);
    assert_eq!(run.retries, 0);
    let result = engine.query("amounts", Context::system().at(1)).unwrap();
    for row in result.data.as_array().unwrap() { assert_eq!(row.field("n").unwrap(), &Value::Int(5)); }
}

#[test]
fn permanent_effect_keys_consume_the_write_meter_and_rollback_with_effects() {
    let source = r#"
effect notify
mutation send(n: int):
  for i in range(0, n):
    emit notify { i } once [i]
"#;
    for n in [1024, 1025] {
        let mut engine = memory(source);
        let result = engine.mutate("send", Some("metered"), Context::new("alice", [("n".into(), Value::Int(n))].into()).at(1)).unwrap();
        let effects: i64 = engine.store().conn().query_row("SELECT count(*) FROM _outbox", [], |r| r.get(0)).unwrap();
        if n == 1025 {
            assert!(matches!(result.state, WriteState::Failed { ref why, .. } if why.code == "E_BOUND"), "{result:?}");
            let tables: i64 = engine.store().conn().query_row("SELECT count(*) FROM sqlite_master WHERE name = '_effect_keys'", [], |r| r.get(0)).unwrap();
            assert_eq!(tables, 0, "all permanent keys and their table from the refused first attempt roll back");
            assert_eq!(effects, 0);
        } else {
            assert!(!matches!(result.state, WriteState::Failed { .. }), "{result:?}");
            let keys: i64 = engine.store().conn().query_row("SELECT count(*) FROM _effect_keys", [], |r| r.get(0)).unwrap();
            assert_eq!(keys, n);
            assert_eq!(effects, n);
        }
    }
}
