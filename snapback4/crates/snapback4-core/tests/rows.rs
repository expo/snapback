#[path = "common/meter.rs"]
mod common;
use snapback4_core::rows::{Bounds, Dir, MemoryRows, Rows};
use snapback4_core::schema::{ColumnDefault, row_image};
use snapback4_core::value::{Value, object};

#[test]
fn memory_rows_counts_only_changed_index_entries() {
    let schema = common::schema();
    let table = schema.tables["writes"].clone();
    let mut engine = snapback4_core::Engine::memory(schema, []).unwrap();
    let tx = engine.store_mut().transaction().unwrap();
    let memory = MemoryRows::new();
    let row = |bucket, body: &str| object([("id", Value::Id("r".into())), ("bucket", Value::Int(bucket)), ("body", Value::String(body.into()))]);
    let mut old = None;
    for (next, expected) in [(row(0, "one"), 2), (row(0, "one"), 0), (row(0, "two"), 0), (row(1, "two"), 2)] {
        let sql_count = tx.put("writes", &table, &next, old.as_ref()).unwrap();
        let memory_count = memory.put("writes", &table, &next, old.as_ref()).unwrap();
        println!("index changes: SQLite={sql_count}, MemoryRows={memory_count}, expected={expected}");
        assert_eq!(sql_count, expected);
        assert_eq!(memory_count, sql_count);
        for bucket in [0, 1] {
            assert_eq!(memory.scan("writes", "byBucket", &[Value::Int(bucket)], &Bounds::default(), Dir::Asc, 10).unwrap(),
                tx.scan("writes", "byBucket", &[Value::Int(bucket)], &Bounds::default(), Dir::Asc, 10).unwrap());
        }
        old = Some(next);
    }
    assert_eq!(memory.delete("writes", &table, old.as_ref().unwrap()).unwrap(), 2);
    assert!(memory.rows("writes").is_empty());
}

#[test]
fn memory_rows_indexes_interpreted_defaults_without_rewriting_raw_rows() {
    let mut table = common::schema().tables["writes"].clone();
    table.defaults.insert("bucket".into(), ColumnDefault::Literal(Value::Int(7)));
    let raw = object([("id", Value::Id("r".into())), ("body", Value::String("one".into()))]);
    let memory = MemoryRows::new();
    assert_eq!(memory.put("writes", &table, &raw, None).unwrap(), 2);
    assert_eq!(memory.rows("writes"), vec![raw.clone()]);
    assert_eq!(memory.count_prefix("writes", "byBucket", &[Value::Int(7)], 10).unwrap(), 1);
    assert_eq!(memory.count_prefix("writes", "byBucket", &[Value::Null], 10).unwrap(), 0);
    let materialized = row_image(&raw, &table);
    assert_eq!(memory.put("writes", &table, &materialized, Some(&raw)).unwrap(), 0);
    assert_eq!(memory.delete("writes", &table, &raw).unwrap(), 2);
    assert!(memory.scan("writes", "byBucket", &[], &Bounds::default(), Dir::Asc, 10).unwrap().is_empty());
}

#[test]
fn memory_rows_delete_uses_defaults_in_the_old_image() {
    let mut table = common::schema().tables["writes"].clone();
    table.defaults.insert("bucket".into(), ColumnDefault::Literal(Value::Int(7)));
    let raw = object([("id", Value::Id("r".into())), ("body", Value::String("one".into()))]);
    let memory = MemoryRows::new();
    memory.put("writes", &table, &row_image(&raw, &table), None).unwrap();
    assert_eq!(memory.delete("writes", &table, &raw).unwrap(), 2);
    // Reusing the id must not resurrect a stale entry under the old default.
    let next = object([("id", Value::Id("r".into())), ("bucket", Value::Int(8)), ("body", Value::String("two".into()))]);
    memory.put("writes", &table, &next, None).unwrap();
    assert_eq!(memory.count_prefix("writes", "byBucket", &[Value::Int(8)], 10).unwrap(), 1);
    assert_eq!(memory.count_prefix("writes", "byBucket", &[Value::Int(7)], 10).unwrap(), 0);
}
