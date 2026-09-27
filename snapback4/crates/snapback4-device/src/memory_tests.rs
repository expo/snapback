use super::*;
use snapback4_core::value::object;

#[test]
fn replacement_indexes_match_scalar_puts_and_rollback_with_counts_and_savepoints() {
    let compiled = snapback4_lang::compile(&[("bulk.q".into(), r#"
table items:
  group: text <=30
  label: text <=80
  until: time ?
  by byGroup: group, id
  search label
  cap 1000 by group
  expire at .until
  public
  sync public
"#.into())]);
    assert!(compiled.diagnostics.is_empty(), "{:?}", compiled.diagnostics);
    let schema = compiled.schema;
    let table = &schema.tables["items"];
    let row = |n: usize| object([("id", Value::Id(format!("row-{n:04}"))),
        ("group", Value::String(format!("group-{}", n % 3))),
        ("label", Value::String(format!("shared search prefix item {n}"))), ("until", Value::Int(1))]);
    let mut bulk = MemoryStore::new();
    let mut scalar = MemoryStore::new();
    for store in [&mut bulk, &mut scalar] { store.install(&schema, &BTreeMap::new(), false).unwrap(); store.drain(); }
    let tx = scalar.transaction().unwrap();
    for n in (0..200).rev() { tx.put("items", table, &row(n), None).unwrap(); }
    tx.commit().unwrap();
    let tx = bulk.transaction().unwrap();
    tx.replace_rows(|| {
        for n in (0..200).rev() { tx.put("items", table, &row(n), None)?; }
        Ok(())
    }).unwrap();
    assert!(!tx.replacing.get());
    assert!(tx.store.state.borrow().entries == scalar.state.borrow().entries, "every search, expiry, ordinary index and physical count agrees");
    tx.savepoint("prediction").unwrap();
    tx.delete("items", table, &row(100)).unwrap();
    tx.rollback_to("prediction").unwrap();
    assert!(tx.store.state.borrow().entries == scalar.state.borrow().entries);
    tx.commit().unwrap();
    assert_eq!(bulk.drain(), scalar.drain(), "durable changes keep the same row representation");
    for fail in [false, true] {
        let before = bulk.export();
        let tx = bulk.transaction().unwrap();
        tx.savepoint("replacement").unwrap();
        let result = tx.replace_rows(|| {
            for n in 400..450 { tx.put("items", table, &row(n), None)?; }
            if fail { return Err(RuntimeError::Input("fault before index publication".into())); }
            Ok(())
        });
        assert_eq!(result.is_err(), fail);
        tx.rollback_to("replacement").unwrap();
        assert!(tx.store.state.borrow().entries == scalar.state.borrow().entries);
        tx.rollback().unwrap();
        assert_eq!(bulk.export(), before);
    }
}
