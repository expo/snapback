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
    let row = |value| object([("id", Value::Id("r".into())), ("body", Value::String("group".into())), ("value", Value::Int(value))]);
    let mut measurements = Vec::new();
    for ranked in [false, true] {
        let mut schema = schema.clone();
        let table = schema.tables.get_mut("writes").unwrap();
        if ranked { table.indexes.insert("byValue".into(), snapback4_core::schema::Index::of(&["value", "id"], false)); }
        let table = table.clone();
        let mut engine = snapback4_core::Engine::memory(schema, []).unwrap();
        let tx = engine.store_mut().transaction().unwrap();
        let memory = MemoryRows::new();
        let mut totals = Vec::new();
        for rows in [&tx as &dyn Rows, &memory as &dyn Rows] {
            let mut old = row(2001);
            let inserted = rows.put("writes", &table, &old, None).unwrap();
            let mut changed = 0;
            for value in (1..=2000).rev() {
                let next = row(value);
                changed += rows.put("writes", &table, &next, Some(&old)).unwrap();
                old = next;
            }
            let index = if ranked { "byValue" } else { "byGroup" };
            let surviving = rows.scan("writes", index, &[], &Bounds::default(), Dir::Desc, 1).unwrap();
            assert_eq!(surviving[0].0.field("value").unwrap(), &Value::Int(1));
            let deleted = rows.delete("writes", &table, &old).unwrap();
            assert!(rows.scan("writes", index, &[], &Bounds::default(), Dir::Desc, 1).unwrap().is_empty());
            totals.push((inserted, changed, deleted));
        }
        assert_eq!(totals[0], totals[1], "SQLite and MemoryRows must measure the same work");
        measurements.push(totals[0]);
    }
    let (base, ranked) = (measurements[0], measurements[1]);
    assert_eq!(base, (2, 0, 2));
    assert_eq!(ranked, (3, 4000, 3));
    assert_eq!(ranked.1 - base.1, 4000);
    assert_eq!(ranked.2 - base.2, 1);
    println!("W12a SQLite and MemoryRows: value changes=2000; without byValue: insert={}, changes={}, delete={}; with byValue: insert={}, changes={}, delete={}; extra rank entries={}; entries/change={}; extra deletion entries={}",
        base.0, base.1, base.2, ranked.0, ranked.1, ranked.2, ranked.1 - base.1, (ranked.1 - base.1) / 2000, ranked.2 - base.2);
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

#[test]
fn written_after_is_strict_per_row_and_uses_the_log_index() {
    use snapback4_core::partition::PartitionRows;
    let mut engine = snapback4_core::Engine::memory(common::schema(), []).unwrap();
    let tx = engine.store_mut().transaction().unwrap();
    for n in 0..10_000 {
        tx.append_log("noise", n + 1, 0, "other", "put", "p1", None).unwrap();
    }
    tx.append_log("g", 10, 0, "posts", "put", "p1", None).unwrap();
    assert!(tx.written_after("posts", "p1", 9).unwrap());
    assert!(!tx.written_after("posts", "p1", 10).unwrap(), "the join commit is not after itself");
    assert!(!tx.written_after("posts", "missing", 0).unwrap());
    assert!(!tx.written_after("missing", "p1", 0).unwrap());
    for (seq, partition, kind) in [(11, "g", "put"), (12, "g", "del"), (13, "elsewhere", "put")] {
        tx.append_log(partition, seq, 0, "posts", kind, "p1", None).unwrap();
        assert!(tx.written_after("posts", "p1", seq - 1).unwrap(), "{kind} in {partition}");
        assert!(!tx.written_after("posts", "p1", seq).unwrap());
    }
    for (seq, kind) in [(14, "join"), (15, "scope")] {
        tx.append_log("hidden-principal", seq, 0, "posts", kind, "p1", None).unwrap();
        assert!(!tx.written_after("posts", "p1", 13).unwrap(), "{kind} is not a row transition");
    }
    let sql = "SELECT EXISTS(SELECT 1 FROM _log WHERE t = ?1 AND id = ?2 AND seq > ?3 AND kind IN ('put', 'del'))";
    let plan: Vec<String> = tx.conn().prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap()
        .query_map(rusqlite::params!["posts", "p1", 10], |row| row.get(3)).unwrap().map(Result::unwrap).collect();
    assert!(plan.iter().any(|step| step.contains("SEARCH _log USING COVERING INDEX _log_row_seq_kind (t=? AND id=? AND seq>?)")), "{plan:?}");
    for (after, expected) in [(10, true), (13, false)] {
        let mut statement = tx.conn().prepare(sql).unwrap();
        let found: bool = statement.query_row(rusqlite::params!["posts", "p1", after], |row| row.get(0)).unwrap();
        assert_eq!(found, expected);
        let scanned = statement.get_status(rusqlite::StatementStatus::FullscanStep);
        let steps = statement.get_status(rusqlite::StatementStatus::VmStep);
        assert_eq!(scanned, 0);
        println!("written_after: log-rows=10006 after={after} found={found} fullscan-steps={scanned} vm-steps={steps}; plan={plan:?}");
    }
}

#[test]
fn written_after_reopened_store_replaces_the_uncovered_index() {
    use snapback4_core::store::Store;
    let dir = std::env::temp_dir().join(format!("snapback4-written-after-{}-{}", std::process::id(), snapback4_core::ids::mint(snapback4_core::now_ms(), &mut 0).unwrap()));
    let path = dir.join("store.sqlite");
    let store = Store::open(&path).unwrap();
    store.conn().execute_batch("DROP INDEX IF EXISTS _log_row_seq_kind; CREATE INDEX IF NOT EXISTS _log_row_seq ON _log(t, id, seq);").unwrap();
    drop(store);
    for _ in 0..2 {
        let store = Store::open(&path).unwrap();
        let columns: Vec<String> = store.conn().prepare("SELECT name FROM pragma_index_info('_log_row_seq_kind') ORDER BY seqno").unwrap()
            .query_map([], |row| row.get(0)).unwrap().map(Result::unwrap).collect();
        assert_eq!(columns, ["t", "id", "seq", "kind"]);
        let old: bool = store.conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = '_log_row_seq')", [], |row| row.get(0)).unwrap();
        assert!(!old, "the superseded index must not double the per-event index writes");
    }
    std::fs::remove_dir_all(dir).unwrap();
}
