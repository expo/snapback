//! Malformed scope schemas must refuse rather than silently retain private rows.
use super::*;

fn scope_errors<S: DeviceStore>(mut store: S) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), "table staff:\n  principal: principal\n  unique principal\n  immutable principal\n  read <- exists staff[viewer]\n  insert <- exists staff[viewer]\n  sync\ntable notes:\n  body: text <=20\n  read <- exists staff[viewer]\n  insert <- exists staff[viewer]\n  sync\n".into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    store
        .install(&bound.schema, &BTreeMap::new(), false)
        .unwrap();
    for variant in ["missing", "unsynced", "unindexed", "column"] {
        let mut schema = bound.schema.clone();
        let name = if variant == "missing" {
            "absent"
        } else {
            "notes"
        };
        let notes = schema.tables.get_mut("notes").unwrap();
        match variant {
            "unsynced" => notes.sync = None,
            "unindexed" => notes.indexes.clear(),
            "column" => notes.sync.as_mut().unwrap().audience = Audience::Column("body".into()),
            _ => {}
        }
        let tx = store.transaction().unwrap();
        assert!(
            matches!(
                leave(&tx, &schema, name, &[], None),
                Err(RuntimeError::Schema(_))
            ),
            "{variant}"
        );
        tx.rollback().unwrap();
    }
    // The staged delivery helper also refuses an unknown table directly,
    // although its current entrypoint already validates every event table.
    let mut schema = bound.schema;
    schema
        .delivery
        .push(snapback4_core::schema::DeliveryBinding {
            table: "notes".into(),
            group: "body".into(),
            position: "id".into(),
            mutation: "delivered".into(),
            fingerprint: "test".into(),
            ..Default::default()
        });
    let page: StreamPage = decoded(r#"{"snapshot":false,"watermark":1,"more":false,"events":[{"table":"absent","kind":"scope","id":"","data":[]}] }"#).unwrap();
    let tx = store.transaction().unwrap();
    assert!(matches!(
        delivery::stage_left(&tx, &schema, &page, false),
        Err(RuntimeError::Schema(_))
    ));
    tx.rollback().unwrap();
}

#[test]
fn malformed_scope_schemas_refuse_on_both_stores() {
    scope_errors(crate::memory::MemoryStore::new());
    #[cfg(feature = "native")]
    publication_tests::with_sqlite(scope_errors);
}

// Read-through children can inherit a single principal-column audience. Their
// departure scope remains supported alongside the union's group-only scopes.
fn column_scopes<S: DeviceStore>(mut store: S) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), "table notes:\n  owner: principal\n  body: text <=20\n  read <- .owner = viewer\n  sync\n".into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    store.install(&bound.schema, &BTreeMap::new(), false).unwrap();
    for history in [false, true] {
        let mut schema = bound.schema.clone();
        let table = schema.tables.get_mut("notes").unwrap();
        if history { table.leave = LeavePolicy::DeliveredHistory; }
        let tx = store.transaction().unwrap();
        for (id, owner) in [("a", "alice"), ("b", "bob")] {
            let row = snapback4_core::value::object([("id", Value::Id(id.into())), ("owner", Value::Id(owner.into())), ("body", Value::String("x".into()))]);
            tx.put("notes", table, &row, None).unwrap();
        }
        leave(&tx, &schema, "notes", &[Value::Id("alice".into())], None).unwrap();
        assert_eq!(tx.get("notes", "a").unwrap().is_some(), history);
        assert!(tx.get("notes", "b").unwrap().is_some());
        tx.rollback().unwrap();
    }
}

#[test]
fn single_column_departure_scopes_keep_their_existing_retention_policy() {
    column_scopes(crate::memory::MemoryStore::new());
    #[cfg(feature = "native")]
    publication_tests::with_sqlite(column_scopes);
}
