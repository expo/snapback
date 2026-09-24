//! Execute the maintained-count SQL through the real PostgreSQL Rows adapter.
use super::*;

fn engine() -> PostgresEngine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), r#"
table items:
  group: text <=20
  until: time ?
  expire at .until
  cap 2
  cap 1 by group
  public
  insert <- allow
  update <- allow
  delete <- allow
mutation add(id: id, group: text <=20):
  insert items { id, group, until: null }
"#.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema = serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
    let programs: Vec<Program> = bound.programs.into_iter().map(|p| serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap()).collect();
    let client = Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private test-postgres.sh database"), postgres::NoTls).unwrap();
    PostgresEngine::create(client, &format!("sb4_eval_expiry_{:x}", crate::ids::seed()), schema, programs).unwrap()
}

fn row(id: &str, group: &str) -> Value {
    object([("id", Value::Id(id.into())), ("group", Value::String(group.into())), ("until", Value::Int(1))])
}

fn counts(tx: &impl Rows, all: u64, a: u64, b: u64) {
    assert_eq!(tx.cap_count("items", &[], &[]).unwrap(), all);
    for (group, expected) in [("a", a), ("b", b), ("missing", 0)] {
        assert_eq!(tx.cap_count("items", &["group".into()], &[Value::String(group.into())]).unwrap(), expected);
    }
    assert_eq!(tx.cap_count("other-table", &[], &[]).unwrap(), 0);
    assert_eq!(tx.cap_count("items", &["different-column".into()], &[Value::String("a".into())]).unwrap(), 0);
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn physical_cap_sql_preserves_counts_across_moves_rollback_reopen_and_upgrade() {
    let mut engine = engine();
    let name: String = engine.store.client.query_one("SELECT current_schema()", &[]).unwrap().get(0);
    let table = engine.schema.tables["items"].clone();
    let old = row("old", "a");
    let moved = row("old", "b");
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    counts(&tx, 0, 0, 0);
    tx.put("items", &table, &old, None).unwrap();
    counts(&tx, 1, 1, 0);
    tx.batch("SAVEPOINT program").unwrap();
    tx.put("items", &table, &moved, Some(&old)).unwrap();
    counts(&tx, 1, 0, 1);
    tx.delete("items", &table, &moved).unwrap();
    counts(&tx, 0, 0, 0);
    tx.rollback_program().unwrap();
    counts(&tx, 1, 1, 0);
    tx.commit().unwrap();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.delete("items", &table, &old).unwrap();
    counts(&tx, 0, 0, 0);
    tx.rollback().unwrap();

    let reconnect = || Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), postgres::NoTls).unwrap();
    drop(engine);
    let mut engine = PostgresEngine::open(reconnect(), &name).unwrap();
    let tx = engine.store.transaction(None).unwrap();
    counts(&tx, 1, 1, 0);
    tx.rollback().unwrap();
    // An evaluation database predating physical counters rebuilds them once.
    engine.store.client.batch_execute("DROP TABLE _cap_counts").unwrap();
    drop(engine);
    let mut engine = PostgresEngine::open(reconnect(), &name).unwrap();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    counts(&tx, 1, 1, 0);
    tx.delete("items", &table, &old).unwrap();
    counts(&tx, 0, 0, 0);
    assert!(tx.query("SELECT n FROM _cap_counts", &[]).unwrap().is_empty());
    tx.commit().unwrap();
    drop(engine);
    let mut engine = PostgresEngine::open(reconnect(), &name).unwrap();
    let tx = engine.store.transaction(None).unwrap();
    counts(&tx, 0, 0, 0);
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn unswept_expired_rows_enforce_group_and_table_caps_on_postgres() {
    let mut engine = engine();
    engine.load([("items".into(), row("old", "a"))]).unwrap();
    let call = |engine: &mut PostgresEngine, id: &str, group: &str| engine.mutate("add", None,
        Context::new("alice", BTreeMap::from([("id".into(), Value::Id(id.into())),
            ("group".into(), Value::String(group.into()))])).at(100)).unwrap();
    let group = call(&mut engine, "same-group", "a");
    assert!(matches!(group.state, WriteState::Failed { ref why, .. } if why.code == "E_CONSTRAINT"), "{group:?}");
    assert_eq!(group.metered.examined, 0, "cap enforcement reads a counter, not row images");
    let other = call(&mut engine, "other-group", "b");
    assert!(matches!(other.state, WriteState::Sent { .. }), "{other:?}");
    assert_eq!(other.metered.examined, 0);
    let table = call(&mut engine, "over-table", "c");
    assert!(matches!(table.state, WriteState::Failed { ref why, .. } if why.code == "E_CONSTRAINT"), "{table:?}");
    assert_eq!(table.metered.examined, 0);
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    counts(&tx, 2, 1, 1);
    assert!(tx.get("items", "same-group").unwrap().is_none());
    assert!(tx.get("items", "over-table").unwrap().is_none());
    // The evaluation adapter has no sweep host; exercise its physical deletion.
    tx.delete("items", &engine.schema.tables["items"], &row("old", "a")).unwrap();
    counts(&tx, 1, 0, 1);
    tx.commit().unwrap();
    let replacement = call(&mut engine, "replacement", "a");
    assert!(matches!(replacement.state, WriteState::Sent { .. }), "{replacement:?}");
    assert_eq!(replacement.metered.examined, 0);
}
