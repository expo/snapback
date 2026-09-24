//! Exercise the prediction adapter itself: expiring-cap deferral means an
//! application write need not reach this adapter's physical counter today.
use super::*;

fn schema() -> Schema {
    let b = snapback4_lang::compile(&[("caps.q".into(), r#"
table items:
  group: text <=10
  until: time ?
  cap 10
  cap 5 by group
  expire at .until
  public
  sync public
"#.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b.schema
}

fn row(id: &str, group: &str) -> Value {
    snapback4_core::value::object([("id", Value::Id(id.into())), ("group", Value::String(group.into())), ("until", Value::Int(1))])
}

fn check(rows: &impl Rows, total: u64, a: u64, b: u64) {
    assert_eq!(rows.cap_count("items", &[], &[]).unwrap(), total);
    for (key, count) in [("a", a), ("b", b)] {
        assert_eq!(rows.cap_count("items", &["group".into()], &[Value::String(key.into())]).unwrap(), count);
    }
}

fn through_prediction<'a, T: DeviceTx>(tx: &'a T, schema: &'a Schema) -> Predicting<'a, T> {
    Predicting { tx, schema, groups: history::load(tx, history::GROUPS).unwrap(),
        boundaries: boundary::Boundaries::load(tx, false).unwrap(), written: RefCell::new(Vec::new()) }
}

fn transitions<S: DeviceStore>(store: &mut S) {
    let schema = schema();
    let table = &schema.tables["items"];
    store.install(&schema, &BTreeMap::new(), false).unwrap();
    let (first, second, moved) = (row("first", "a"), row("second", "a"), row("first", "b"));
    assert!(table.expired(&first, 100), "physical counts include expired unswept rows");
    let tx = store.transaction().unwrap();
    tx.put("items", table, &first, None).unwrap();
    tx.put("items", table, &second, None).unwrap();
    {
        let rows = through_prediction(&tx, &schema);
        check(&rows, 2, 2, 0);
        tx.savepoint("prediction").unwrap();
        rows.put("items", table, &moved, Some(&first)).unwrap();
        rows.delete("items", table, &second).unwrap();
        check(&rows, 1, 0, 1);
        tx.rollback_to("prediction").unwrap();
        check(&rows, 2, 2, 0);
        assert!(tx.base_entries().unwrap().is_empty());
        rows.put("items", table, &moved, Some(&first)).unwrap();
        rows.delete("items", table, &second).unwrap();
        check(&rows, 1, 0, 1);
        predictions::restore(&tx, &schema).unwrap();
        check(&rows, 2, 2, 0);
        assert!(tx.base_entries().unwrap().is_empty());
    }
    tx.commit().unwrap();
    let tx = store.transaction().unwrap();
    tx.clear_rows().unwrap();
    check(&through_prediction(&tx, &schema), 0, 0, 0);
    tx.rollback().unwrap();
    let tx = store.transaction().unwrap();
    check(&through_prediction(&tx, &schema), 2, 2, 0);
    tx.rollback().unwrap();
}

fn reset<S: DeviceStore>(store: &mut S) {
    let schema = schema();
    store.install(&schema, &BTreeMap::new(), true).unwrap();
    let tx = store.transaction().unwrap();
    check(&through_prediction(&tx, &schema), 0, 0, 0);
    tx.rollback().unwrap();
}

#[test]
fn predicting_cap_counts_follow_memory_changes_restore_reopen_and_reset() {
    let mut store = crate::memory::MemoryStore::new();
    transitions(&mut store);
    let mut reopened = crate::memory::MemoryStore::new();
    reopened.load(store.drain()).unwrap();
    let schema = schema();
    reopened.install(&schema, &BTreeMap::new(), false).unwrap();
    let tx = reopened.transaction().unwrap();
    check(&through_prediction(&tx, &schema), 2, 2, 0);
    tx.rollback().unwrap();
    reset(&mut reopened);
}

#[cfg(feature = "native")]
#[test]
fn predicting_cap_counts_follow_sqlite_changes_restore_and_reset() {
    publication_tests::with_sqlite(|mut store| {
        transitions(&mut store);
        reset(&mut store);
    });
}
