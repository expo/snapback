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

#[path = "common/acquisition.rs"]
mod acquisition;
fn mixed_acquisition(hidden: usize, readable: usize, deleted_selected: bool) -> (String, String) {
    let acquisition::Fixture { stream, snapshots: pages, .. } = acquisition::mixed_acquisition(hidden, readable, deleted_selected);
    assert_eq!(stream.events.len(), readable.min(2));
    assert!(stream.events.iter().all(|e| e.data.as_ref().unwrap().field("body").unwrap() == &Value::String("bob".into())));
    assert_eq!(stream.acquisitions.len(), 2);
    assert_eq!(stream.acquisitions[1].floor.as_deref() == Some("whole"), readable < 2);
    let mut snapshots = Vec::new(); let mut floors = Vec::new();
    for page in pages {
        snapshots.extend(page.events); floors.extend(page.acquisitions.into_iter().filter_map(|a| a.floor));
    }
    assert_eq!(snapshots.len(), readable.min(2));
    assert_eq!(floors, vec![stream.acquisitions[1].floor.clone().unwrap()]);
    (serde_json::to_string(&stream).unwrap(), serde_json::to_string(&snapshots).unwrap())
}

#[test]
fn acquisition_selects_readable_rows_independent_of_hidden_or_deleted_history() {
    let clean = mixed_acquisition(0, 3, false);
    assert_eq!(clean, mixed_acquisition(1, 3, false));
    assert_eq!(clean, mixed_acquisition(1000, 3, false));
    assert_eq!(clean, mixed_acquisition(0, 3, true));
    assert_eq!(mixed_acquisition(0, 0, false), mixed_acquisition(1000, 0, false));
}

#[test]
fn successful_activation_drops_the_retired_row_log_index() {
    use snapback4_core::store::Store;
    let dir = std::env::temp_dir().join(format!("snapback4-retired-log-index-{}-{}", std::process::id(), snapback4_core::ids::mint(snapback4_core::now_ms(), &mut 0).unwrap()));
    let path = dir.join("store.sqlite");
    let store = Store::open(&path).unwrap();
    store.conn().execute_batch("CREATE INDEX _log_row_seq_kind ON _log(t, id, seq, kind);").unwrap(); drop(store);
    for attempt in 0..2 {
        let mut store = Store::open(&path).unwrap();
        let before: bool = store.conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = '_log_row_seq_kind')", [], |row| row.get(0)).unwrap();
        assert_eq!(before, attempt == 0, "low-level open must not run activation upgrades");
        store.install(&snapback4_core::schema::Schema::default()).unwrap();
        let exists: bool = store.conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = '_log_row_seq_kind')", [], |row| row.get(0)).unwrap();
        assert!(!exists);
        let tx = store.conn();
        tx.execute("INSERT OR REPLACE INTO _meta VALUES ('w13k', 'usable')", []).unwrap();
        assert_eq!(store.meta("w13k").unwrap().as_deref(), Some("usable"));
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn renewal_chains_stop_at_expiry_scope_and_same_commit_revocation() {
    use snapback4_core::{partition, schema::Horizon, value::canonical_json};
    // (sequence, time, kind, expiry). Equality with expiry is already a gap;
    // a scope breaks authority even when the next join has the same sequence.
    let cases = [
        (vec![(2,2,"join",Some(1000)),(3,500,"join",Some(1500)),(4,1200,"join",Some(2000))], Some(2)),
        (vec![(2,2,"join",Some(1000)),(3,1000,"join",Some(1500)),(4,1200,"join",Some(2000))], Some(3)),
        (vec![(2,2,"join",None),(3,500,"scope",None),(3,500,"join",Some(1500)),(4,1200,"join",Some(2000))], Some(3)),
        (vec![(2,2,"join",None),(2,2,"scope",None)], None),
        (vec![(2,2,"join",Some(1000)),(3,500,"join",Some(1500))], None),
    ];
    for (steps, expected) in cases { for limit in [1, 1000] {
        let mut schema = common::schema(); schema.tables.remove("messages");
        schema.tables.get_mut("writes").unwrap().sync.as_mut().unwrap().horizon = Some(Horizon { last: 2, by: "byBucket".into() });
        let mut engine = snapback4_core::Engine::memory(schema.clone(), []).unwrap();
        engine.seed_at((0..3).map(|n| ("writes".into(), object([("id",Value::Id(format!("r{n}"))),("bucket",Value::Int(n)),("body",Value::String("bob".into()))]))), 1).unwrap();
        let tx = engine.store_mut().transaction().unwrap();
        let mut previous = 1;
        for (ord, (seq, at, kind, expiry)) in steps.iter().enumerate() {
            if previous != *seq { tx.record_commit(*seq, *at, "membership", "bob", "mutation", &[], 0).unwrap(); previous = *seq; }
            let data = if *kind == "join" { object([("expiresAt",expiry.map_or(Value::Null, Value::Int))]) } else { Value::Array(vec![]) };
            tx.append_log("p:bob", *seq, ord as u32, "writes", kind, "[]", Some(&canonical_json(&data))).unwrap();
        }
        let mut from = 1; let mut puts = Vec::new(); let mut markers = Vec::new();
        loop {
            let page = partition::stream(&tx, &schema, "bob", from, limit, 1800).unwrap();
            puts.extend(page.events.into_iter().filter(|e| e.kind == "put").map(|e| (e.seq, e.id)));
            markers.extend(page.acquisitions); from = page.watermark; if !page.more { break; }
        }
        assert_eq!(puts, expected.map_or_else(Vec::new, |seq| vec![(seq,"r2".into()),(seq,"r1".into())]), "steps={steps:?} limit={limit}");
        assert_eq!(markers.len(), if expected.is_some() { 2 } else { 0 });
    } }
}
