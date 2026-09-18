use super::*;
use snapback4_core::Rows;

fn raw_fixture<H: RepairHost>(host: &mut H, left: bool) -> (Backend, H::Store) {
    let (_, backend, d) = fixture(host, "dev:alice", left);
    host.close("store", d);
    (backend, host.raw("store"))
}

fn refuse_preserving<S: DeviceStore + Inspect>(
    raw: S,
    backend: Backend,
    reopen: bool,
    missing_schema: bool,
) {
    let checked = Checked {
        inner: raw,
        fail: Cell::new(false),
        legacy: Cell::new(reopen && missing_schema),
        missing_backend: Cell::new(missing_schema),
        edit: Cell::new(None),
    };
    if reopen {
        assert!(
            matches!(Device::open_store(checked, Some(backend), "dev:bob"), Err(ref e) if e.code() == "SNAPBACK_HISTORY_OWNER")
        );
    } else {
        let mut d = Device::open_store(checked, None, "dev:alice").unwrap();
        d.store().legacy.set(missing_schema);
        // Trigger metadata removal before taking the immutable-state baseline.
        let _ = d.query("marker", "dev:alice", &json!({}), 100);
        let before = d.store().inner.records();
        assert_eq!(
            d.adopt_captured(backend, "dev:bob", BTreeMap::new())
                .unwrap_err()
                .code(),
            "SNAPBACK_HISTORY_OWNER"
        );
        assert_eq!(d.store().inner.records(), before);
    }
}

fn missing_schema_bases<H: RepairHost>(host: &mut H, reopen: bool) {
    let (mut backend, mut raw) = raw_fixture(host, true);
    let tx = raw.transaction().unwrap();
    let image = tx
        .stored_rows_after("messages", Some("left-24"), 1)
        .unwrap()
        .remove(0);
    assert_eq!(image.field("id").unwrap().as_str().unwrap(), "left-25");
    tx.base_remember(
        "messages",
        "left-25",
        Some(&snapback4_core::json_codec::to_text(&image).unwrap()),
    )
    .unwrap();
    tx.clear_rows().unwrap();
    tx.commit().unwrap();
    backend.schema.tables.get_mut("messages").unwrap().leave =
        snapback4_core::schema::LeavePolicy::UntilRevoked;
    refuse_preserving(raw, backend, reopen, true);
}

fn unknown_table<H: RepairHost>(host: &mut H, reopen: bool, base_only: bool) {
    let (backend, mut raw) = raw_fixture(host, false);
    let mut physical = backend.schema.clone();
    physical.tables.insert(
        "orphaned_messages".into(),
        physical.tables["messages"].clone(),
    );
    raw.install(&physical, &BTreeMap::new(), false).unwrap();
    let tx = raw.transaction().unwrap();
    let row = wire::row_from_json(
        &physical.tables["orphaned_messages"],
        &json!({"id":"hidden","room":"left","at":1,"body":"only copy"}),
    )
    .unwrap();
    if base_only {
        tx.base_remember(
            "orphaned_messages",
            "hidden",
            Some(&snapback4_core::json_codec::to_text(&row).unwrap()),
        )
        .unwrap();
    } else {
        tx.put(
            "orphaned_messages",
            &physical.tables["orphaned_messages"],
            &row,
            None,
        )
        .unwrap();
    }
    tx.commit().unwrap();
    if reopen || base_only {
        refuse_preserving(raw, backend, reopen, false);
    } else {
        // Open Alice's handle with the physical table installed; introduce the
        // incomplete persisted schema only after that open, immediately before
        // Bob's adoption. Otherwise Alice's open itself drops the unknown table.
        let mut physical_backend = backend.clone();
        physical_backend.schema = physical;
        raw.set_meta(
            "device:backend",
            &serde_json::to_string(&physical_backend).unwrap(),
        )
        .unwrap();
        let checked = Checked {
            inner: raw,
            fail: Cell::new(false),
            legacy: Cell::new(false),
            missing_backend: Cell::new(false),
            edit: Cell::new(None),
        };
        let mut d = Device::open_store(checked, None, "dev:alice").unwrap();
        let prior = Box::leak(serde_json::to_string(&backend).unwrap().into_boxed_str());
        d.store().edit.set(Some(("device:backend", prior)));
        let _ = d.query("marker", "dev:alice", &json!({}), 100);
        let before = d.store().inner.records();
        assert_eq!(
            d.adopt_captured(backend, "dev:bob", BTreeMap::new())
                .unwrap_err()
                .code(),
            "SNAPBACK_HISTORY_OWNER"
        );
        assert_eq!(d.store().inner.records(), before);
    }
}
fn unknown_rows<H: RepairHost>(host: &mut H, reopen: bool) {
    unknown_table(host, reopen, false);
}
fn unknown_bases<H: RepairHost>(host: &mut H, reopen: bool) {
    unknown_table(host, reopen, true);
}

fn missing_schema_names<H: RepairHost>(host: &mut H, reopen: bool, rename: bool) {
    let (mut backend, raw) = raw_fixture(host, true);
    let table = backend.schema.tables.remove("messages").unwrap();
    if rename {
        backend
            .schema
            .tables
            .insert("renamed_messages".into(), table);
    }
    backend.generation += 1;
    refuse_preserving(raw, backend, reopen, true);
}
fn renamed<H: RepairHost>(host: &mut H, reopen: bool) {
    missing_schema_names(host, reopen, true);
}
fn dropped<H: RepairHost>(host: &mut H, reopen: bool) {
    missing_schema_names(host, reopen, false);
}

fn empty_id<H: RepairHost>(host: &mut H, reopen: bool) {
    let (backend, mut raw) = raw_fixture(host, true);
    let tx = raw.transaction().unwrap();
    tx.clear_rows().unwrap();
    let row = wire::row_from_json(
        &backend.schema.tables["messages"],
        &json!({"id":"","room":"left","at":1,"body":"only copy"}),
    )
    .unwrap();
    tx.put("messages", &backend.schema.tables["messages"], &row, None)
        .unwrap();
    tx.commit().unwrap();
    refuse_preserving(raw, backend, reopen, false);
}

fn retained_after_full_page<H: RepairHost>(host: &mut H, reopen: bool) {
    let (backend, mut raw) = raw_fixture(host, true);
    let tx = raw.transaction().unwrap();
    tx.clear_rows().unwrap();
    for n in 0..257 {
        let row = wire::row_from_json(&backend.schema.tables["messages"], &json!({"id":format!("row-{n:03}"),"room":if n == 256 { "left" } else { "held" },"at":n,"body":"page"})).unwrap();
        tx.put("messages", &backend.schema.tables["messages"], &row, None)
            .unwrap();
    }
    tx.commit().unwrap();
    refuse_preserving(raw, backend, reopen, false);
}

fn physical_pages<H: RepairHost>(host: &mut H) -> Vec<String> {
    let (backend, mut raw) = raw_fixture(host, false);
    let tx = raw.transaction().unwrap();
    tx.clear_rows().unwrap();
    for id in ["", "a", "z"] {
        let row = wire::row_from_json(
            &backend.schema.tables["messages"],
            &json!({"id":id,"room":"held","at":1,"body":"held"}),
        )
        .unwrap();
        tx.put("messages", &backend.schema.tables["messages"], &row, None)
            .unwrap();
    }
    // Table emptiness has no dependency on other tables being populated.
    assert!(tx.stored_rows_after("members", None, 1).unwrap().is_empty());
    assert_eq!(tx.stored_tables().unwrap(), vec!["messages"]);
    assert!(tx.stored_rows_after("messages", None, 0).is_err());
    let mut ids = Vec::new();
    let mut cursor = None;
    for _ in 0..4 {
        let page = tx
            .stored_rows_after("messages", cursor.as_deref(), 1)
            .unwrap();
        if page.is_empty() {
            break;
        }
        let id = page[0].field("id").unwrap().as_str().unwrap().to_owned();
        cursor = Some(id.clone());
        ids.push(id);
    }
    tx.rollback().unwrap();
    ids
}

#[test]
fn stores_agree_on_empty_tables_and_exclusive_empty_id_cursor() {
    let memory = physical_pages(&mut Memory::new());
    let sqlite = physical_pages(&mut Sqlite::new("physical-pages"));
    assert_eq!(memory, vec!["", "a", "z"]);
    assert_eq!(memory, sqlite);
}

both_paths!(missing_prior_schema_confirmed_base, missing_schema_bases);
both_paths!(unclassified_physical_rows, unknown_rows);
both_paths!(unclassified_confirmed_bases, unknown_bases);
both_paths!(missing_prior_schema_renamed, renamed);
both_paths!(missing_prior_schema_dropped, dropped);
both_paths!(empty_id_retained_history, empty_id);

both_paths!(retained_on_second_physical_page, retained_after_full_page);
