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
fn value_rank_index_cost_for_a_host_sized_expiry_batch() {
    let mut schema = common::schema();
    let table = schema.tables.get_mut("writes").unwrap();
    let value_type = table.columns.remove("bucket").unwrap();
    table.columns.insert("value".into(), value_type);
    table.indexes.remove("byBucket");
    table.indexes.insert("byGroup".into(), snapback4_core::schema::Index::of(&["body"], true));
    table.indexes.insert("byValue".into(), snapback4_core::schema::Index::of(&["value", "id"], false));
    let table = table.clone();
    let mut engine = snapback4_core::Engine::memory(schema, []).unwrap();
    let tx = engine.store_mut().transaction().unwrap();
    let memory = MemoryRows::new();
    let row = |value| object([("id", Value::Id("r".into())), ("body", Value::String("group".into())), ("value", Value::Int(value))]);
    let mut old = row(2001);
    assert_eq!(tx.put("writes", &table, &old, None).unwrap(), 3);
    assert_eq!(memory.put("writes", &table, &old, None).unwrap(), 3);
    let mut total = 0;
    for value in (1..=2000).rev() {
        let next = row(value);
        let sql = tx.put("writes", &table, &next, Some(&old)).unwrap();
        assert_eq!(sql, 2);
        assert_eq!(memory.put("writes", &table, &next, Some(&old)).unwrap(), sql);
        total += sql;
        old = next;
    }
    assert_eq!(total, 4000);
    for rows in [&tx as &dyn Rows, &memory as &dyn Rows] {
        let ranked = rows.scan("writes", "byValue", &[], &Bounds::default(), Dir::Desc, 1).unwrap();
        assert_eq!(ranked[0].0.field("value").unwrap(), &Value::Int(1));
        assert_eq!(rows.delete("writes", &table, &old).unwrap(), 3);
        assert!(rows.scan("writes", "byValue", &[], &Bounds::default(), Dir::Desc, 1).unwrap().is_empty());
    }
    println!("W12a SQLite and MemoryRows: value changes=2000; extra rank entries=4000; entries/change=2; group deletion entries=3 (2 base + 1 rank)");
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

#[test]
fn adoption_names_legacy_index_count_and_rewrites_can_shrink_or_delete() {
    use snapback4_core::{store::Store, rows::index_key, value::canonical_json};
    let mut schema = common::schema();
    let table = schema.tables.get_mut("writes").unwrap();
    table.indexes.insert("byBody".into(), snapback4_core::schema::Index::of(&["body"], false));
    let table = table.clone();
    let mut store = Store::memory().unwrap();
    store.install(&schema).unwrap(); // fresh: no entries to scan
    let row = |n| object([("id", Value::Id("r".into())), ("bucket", Value::Int(1)), ("body", Value::String("x".repeat(n)))]);
    let old = row(6000);
    // Reproduce the old SQLite layout, which admitted 6,000-byte keys.
    store.conn().execute("INSERT INTO r SELECT num, 'r', ?1 FROM _catalog WHERE name='writes'", [canonical_json(&old)]).unwrap();
    for (name, index) in &table.indexes {
        store.conn().execute("INSERT INTO i SELECT num, ?1, 'r' FROM _catalog WHERE name=?2", rusqlite::params![index_key(index, &old, "r"), format!("writes.{name}")]).unwrap();
    }
    let err = store.install(&schema).unwrap_err();
    assert_eq!(err.code(), "E_INDEX_KEY_BYTES");
    assert!(err.to_string().contains("writes.byBody: 1 index entries"), "{err}");
    let tx = store.transaction().unwrap();
    tx.put("writes", &table, &old, Some(&old)).unwrap();
    let shorter = row(5000);
    tx.put("writes", &table, &shorter, Some(&old)).unwrap();
    assert_eq!(tx.put("writes", &table, &old, Some(&shorter)).unwrap_err().code(), "E_INDEX_KEY_BYTES");
    assert_eq!(tx.get("writes", "r").unwrap(), Some(shorter.clone()));
    tx.delete("writes", &table, &shorter).unwrap();
    tx.commit().unwrap();
    store.install(&schema).unwrap();
}
