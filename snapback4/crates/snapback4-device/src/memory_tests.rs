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
    {
        let before = bulk.export();
        let entries = bulk.state.borrow().entries.clone();
        let tx = bulk.transaction().unwrap();
        let old = row(0);
        let mut replacement = row(400);
        if let Value::Row(fields) = &mut replacement { fields.insert("id".into(), Value::Id("row-0000".into())); }
        tx.put("items", table, &replacement, Some(&old)).unwrap();
        tx.savepoint("after-overwrite").unwrap();
        let result = tx.replace_rows(|| {
            tx.put("items", table, &row(900), None)?;
            Err(RuntimeError::Input("interrupted replacement after overwrite".into()))
        });
        assert!(result.is_err());
        // Drop must restore the replacement tree AND the earlier entry undos.
        // Rolling back only to the savepoint would not exercise that ordering.
        drop(tx);
        assert!(bulk.state.borrow().entries == entries, "older index undos survive restoration of the saved tree");
        assert_eq!(bulk.export(), before, "every persisted image returns to its pre-transaction value");
    }
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

#[test]
fn staged_sharing_accepts_only_the_exact_row_value() {
    let row = object([("id", Value::Id("one".into())), ("body", Value::String("quotes \\\" and braces } {".into()))]);
    let encoded = stored(&row);
    for acquired in [false,true] {
        let canonical: Rc<str> = format!("{{\"row\":{encoded},\"acquired\":{acquired}}}").into();
        assert_eq!(&*Image::staged(canonical, &encoded).unwrap(), encoded);
        // A legacy/future stage may contain ignored fields or whitespace.
        // Sharing must not smuggle these bytes into the standalone row image.
        for extra in [",\"extra\":1", " "] {
            let old: Rc<str> = format!("{{\"row\":{encoded}{extra},\"acquired\":{acquired}}}").into();
            assert!(Image::staged(old, &encoded).is_none());
        }
    }
}


// Keep decoder fixture helpers visibly test-only to the source census too.
#[cfg(test)]
#[test]
fn noncanonical_staged_rows_keep_canonical_metered_prices() {
    use snapback4_core::meter::{Ceilings, Cut, InternalLedger, Meter};
    let compiled = snapback4_lang::compile(&[("images.q".into(), "table items:\n  payload: json <=10000\n  public\n  sync public\n".into())]);
    assert!(compiled.diagnostics.is_empty(), "{:?}", compiled.diagnostics);
    #[derive(Deserialize)]
    struct Stage { row: Value }
    let table = &compiled.schema.tables["items"];
    let scan = |store: &mut MemoryStore, ceiling| {
        let tx = store.transaction().unwrap();
        let mut ledger = InternalLedger::new(Meter::new(Ceilings { heap_bytes: ceiling, ..Ceilings::unbounded() }, Cut::Abort));
        ledger.run(|meter, scope| tx.scan_metered("items", "byId", &[], &Bounds::default(), Dir::Asc, 1, scope, meter))
    };
    for payload in ["[{},{}]", "{\"nested\":[{}, {\"inside\":[{},{}]}]}", "[{}, {\"Row\":\"tag-like text {\\\"Map\\\":}\"}]"] {
        let row = snapback4_core::wire::row_from_json(table, &serde_json::json!({"id":"one", "payload":serde_json::from_str::<serde_json::Value>(payload).unwrap()})).unwrap();
        let canonical = stored(&row);
        let mut scalar = MemoryStore::new();
        scalar.install(&compiled.schema, &BTreeMap::new(), false).unwrap();
        let tx = scalar.transaction().unwrap(); tx.put("items", table, &row, None).unwrap(); tx.commit().unwrap();
        let expected = scan(&mut scalar, u64::MAX).unwrap();
        // Observe admission without exposing the private ledger's counters.
        let (mut low, mut price) = (0, 1 << 20);
        assert!(scan(&mut scalar, price).is_ok());
        while low + 1 < price {
            let middle = (low + price) / 2;
            if scan(&mut scalar, middle).is_ok() { price = middle; } else { low = middle; }
        }
        for image in [canonical.clone(), canonical.replace("\"Row\":", "\"Row\" : ").replace("\"Map\":", "\"Map\"\n:\t"),
            canonical.replace("\"Row\"", "\"R\\u006fw\"").replace("\"Map\"", "\"M\\u0061p\""),
            serde_json::to_string_pretty(&row).unwrap()] {
            let stage = format!("{{\"row\":{image},\"acquired\":true}}");
            let mut store = MemoryStore::new();
            store.install(&compiled.schema, &BTreeMap::new(), false).unwrap();
            let tx = store.transaction().unwrap();
            tx.staged_put("stage", "items", &stage).unwrap();
            tx.replace_rows(|| { tx.put_staged("stage", "items", table, &parsed::<Stage>("stage", &stage)?.row)?; Ok(()) }).unwrap();
            tx.commit().unwrap();
            assert_eq!(scan(&mut store, price).unwrap(), expected, "{image}");
            assert_eq!(&*store.state.borrow().rows[&("items".into(), "one".into())], canonical);
            assert!(scan(&mut store, price - 1).is_err(), "refuse before decoding above the same canonical price");
        }
    }
}
