use super::*;

fn missing_backend<H: RepairHost>(host: &mut H, reopen: bool) {
    missing_backend_case(host, reopen, true);
}
fn missing_backend_held<H: RepairHost>(host: &mut H, reopen: bool) {
    missing_backend_case(host, reopen, false);
}
fn missing_backend_case<H: RepairHost>(host: &mut H, reopen: bool, left: bool) {
        let (_, backend, device) = fixture(host, "dev:alice", left);
        host.close("store", device);
        let checked = Checked {
            inner: host.raw("store"),
            fail: Cell::new(false),
            legacy: Cell::new(reopen),
            missing_backend: Cell::new(true),
            edit: Cell::new(None),
        };
        let result = if reopen {
            Device::open_store(checked, Some(backend), "dev:bob")
        } else {
            let mut d = Device::open_store(checked, None, "dev:alice").unwrap();
            d.store().legacy.set(true);
            d.adopt_captured(backend, "dev:bob", BTreeMap::new())
                .map(|()| d)
        };
        // Without the persisted schema even a Held key cannot classify the old
        // row: the incoming schema may have changed the grouping or retention.
        assert!(matches!(result, Err(ref e) if e.code() == "SNAPBACK_HISTORY_OWNER"));
}

fn replacement_at_same_generation<H: RepairHost>(host: &mut H, reopen: bool) {
    replacement_marker(host, reopen, false);
}
fn literal_with_replacement<H: RepairHost>(host: &mut H, reopen: bool) {
    replacement_marker(host, reopen, true);
}
fn replacement_marker<H: RepairHost>(host: &mut H, reopen: bool, literal: bool) {
    let (mut engine, mut backend, device) = fixture(host, "dev:alice", true);
    let before = device.store().row_count();
    host.close("store", device);
    let checked = Checked {
        inner: host.raw("store"),
        fail: Cell::new(false),
        legacy: Cell::new(false),
        missing_backend: Cell::new(false),
        edit: Cell::new(None),
    };
    if literal {
        backend = next(
            &mut engine,
            &SOURCE.replace("  body: text", "  flag: bool default false\n  body: text"),
        );
    }
    let marker = Some(("device:backend-required", "replacement"));
    let mut d = if reopen {
        checked.edit.set(marker);
        Device::open_store(checked, Some(backend), "dev:alice").unwrap()
    } else {
        let mut d = Device::open_store(checked, None, "dev:alice").unwrap();
        d.store().edit.set(marker);
        d.adopt_captured(backend, "dev:alice", BTreeMap::new())
            .unwrap();
        d
    };
    assert_eq!(d.sync_state().unwrap().acquired, literal && !reopen);
    assert_eq!(
        d.store().inner.row_count(),
        if literal { before } else { 0 }
    );
    assert_eq!(d.store().meta(GROUPS).unwrap().as_deref(), Some("{}"));
}

fn live_owner_refusals<H: RepairHost>(host: &mut H, missing: bool) {
    let (mut engine, backend, device) = fixture(host, "dev:alice", true);
    host.close("store", device);
    let checked = Checked {
        inner: host.raw("store"),
        fail: Cell::new(false),
        legacy: Cell::new(false),
        missing_backend: Cell::new(false),
        edit: Cell::new(None),
    };
    let mut d = Device::open_store(checked, Some(backend), "dev:alice").unwrap();
    if missing {
        d.store().legacy.set(true);
        // Trigger the old-store fixture's metadata removal before the baseline.
        d.store().inner.records();
        let _ = d.query("marker", "dev:alice", &json!({}), 100);
    } else {
        d.store().edit.set(Some((OWNER, "dev:bob")));
        let _ = d.query("marker", "dev:alice", &json!({}), 100);
    }
    let before = d.store().inner.records();
    assert_eq!(d.sync_state().unwrap_err().code(), "SNAPBACK_HISTORY_OWNER");
    let mut page = snapshot_pages(&mut engine, "dev:alice", 1000).remove(0);
    // No request capture: the acquisition still requires the handle's binding.
    assert!(page.send_revision.is_none());
    page.store_id = Some("replacement-must-not-reset".into());
    assert_eq!(
        d.apply(&page, true).unwrap_err().code(),
        "SNAPBACK_HISTORY_OWNER"
    );
    assert_eq!(
        d.observe_store(&page).unwrap_err().code(),
        "SNAPBACK_HISTORY_OWNER"
    );
    assert_eq!(d.store().inner.records(), before);
    assert_eq!(
        d.query("marker", "dev:alice", &json!({}), 100)
            .unwrap_err()
            .code,
        "SNAPBACK_HISTORY_OWNER"
    );
}

fn newly_delivered_history<H: RepairHost>(host: &mut H, reopen: bool) {
    let source = SOURCE.replace("retain delivered-history", "retain until-revoked");
    let (_, previous, d) = fixture_source(host, "dev:alice", false, &source);
    // Lost membership evidence cannot authorize a new reader under the new schema.
    // until-revoked acquisition has Held groups; missing group evidence is
    // covered separately by the unknown-backend fixtures.
    let (_, mut backend) = compile(SOURCE);
    backend.generation = previous.generation + 1;
    // The review's literal-default example cannot hold for a changed retention
    // policy: that predicate compares the rest of each Table as well.
    assert!(!snapback4_core::successor::keeps_literal_default_images(
        &previous.schema,
        &backend.schema
    ));
    host.close("store", d);
    let checked = Checked {
        inner: host.raw("store"),
        fail: Cell::new(false),
        legacy: Cell::new(false),
        missing_backend: Cell::new(false),
        edit: Cell::new(None),
    };
    let result = if reopen {
        checked.edit.set(Some((GROUPS, "{}")));
        Device::open_store(checked, Some(backend), "dev:bob")
    } else {
        let mut d = Device::open_store(checked, None, "dev:alice").unwrap();
        d.store().edit.set(Some((GROUPS, "{}")));
        d.adopt_captured(backend, "dev:bob", BTreeMap::new())
            .map(|()| d)
    };
    assert!(matches!(result, Err(ref e) if e.code() == "SNAPBACK_HISTORY_OWNER"));
}

#[test]
fn corrupt_sqlite_scan_refuses_and_preserves() {
    for corruption in [
        "DELETE FROM _catalog",
        "DROP TABLE _catalog",
        "UPDATE _catalog SET num = num + 1000",
        "UPDATE _catalog SET name = 'orphaned_messages' WHERE name = 'messages'; INSERT INTO _catalog(name, num) VALUES('messages', 9000)",
        "UPDATE r SET data = 'broken'",
        "UPDATE r SET data = '{}'",
    ] {
        let mut host = Sqlite::new("corrupt-owner-scan");
        let (_, backend, d) = fixture(&mut host, "dev:alice", true);
        d.store().conn().execute_batch(corruption).unwrap();
        // Catalog SQL, mapping and decoding failures are not evidence of empty.
        let mut raw = snapback4_core::Store::open(&host.path("store")).unwrap();
        let tx = raw.read_transaction().unwrap();
        assert!(
            tx.stored_tables().map(|names| names.iter().any(|name| backend.schema.table(name).is_none())).unwrap_or(true)
                || tx.stored_rows_after("messages", None, 256).is_err(),
            "{corruption}"
        );
        tx.rollback().unwrap();
        drop(raw);
        let before = d.store().records();
        assert!(
            matches!(Device::open_store(snapback4_core::Store::open(&host.path("store")).unwrap(), Some(backend), "dev:bob"), Err(ref e) if e.code() == "SNAPBACK_HISTORY_OWNER"),
            "{corruption}"
        );
        assert_eq!(d.store().records(), before, "{corruption}");
    }
}

#[test]
fn empty_principal_is_rejected_before_opening_metadata() {
    let (_, backend) = compile(SOURCE);
    for backend in [None, Some(backend)] {
        assert!(matches!(
            Device::open_store(MemoryStore::new(), backend.clone(), ""),
            Err(RuntimeError::Input(_))
        ));
        let mut host = Sqlite::new("empty-principal");
        assert!(matches!(
            host.open_as("empty", backend, ""),
            Err(RuntimeError::Input(_))
        ));
    }
}

both_paths!(missing_backend_metadata, missing_backend);
both_paths!(missing_backend_held_metadata, missing_backend_held);
both_paths!(
    replacement_marker_same_generation,
    replacement_at_same_generation
);
both_paths!(literal_defaults_with_replacement, literal_with_replacement);
both_paths!(live_binding_is_structural, live_owner_refusals);
both_paths!(new_schema_history_scan, newly_delivered_history);

#[test]
fn native_ffi_delayed_first_page_after_signin() {
    use snapback4_device::ffi::{sb4_call, sb4_close, sb4_free, sb4_open, sb4_open_reason};
    use std::ffi::{CStr, CString};
    let host = Sqlite::new("ffi-delayed-signin");
    let (_, backend) = compile(SOURCE);
    let path = CString::new(host.path("store").to_str().unwrap()).unwrap();
    let backend_text = CString::new(serde_json::to_string(&backend).unwrap()).unwrap();
    let device = sb4_open(path.as_ptr(), backend_text.as_ptr(), c"dev:alice".as_ptr());
    assert!(!device.is_null());
    let call = |request: Json| {
        let text = CString::new(request.to_string()).unwrap();
        let result = sb4_call(device, text.as_ptr());
        let value: Json =
            serde_json::from_str(unsafe { CStr::from_ptr(result) }.to_str().unwrap()).unwrap();
        sb4_free(result);
        value
    };
    let empty = json!({"snapshot":true,"events":[],"held":{},"watermark":0,"more":false,"store_id":"same-store","generation":1});
    assert!(call(json!({"op":"apply","page":empty,"first":true}))["ok"].is_object());
    let captured = call(json!({"op":"sync_state"}))["ok"].clone();
    assert_eq!(captured["watermark"], 0);
    assert!(call(json!({"op":"adopt","backend":backend,"viewer":"dev:bob","send_revision":captured["send_revision"],"store_id":"same-store"})).get("ok").is_some());
    let delayed = json!({"snapshot":true,"events":[{"table":"messages","kind":"put","id":"private","data":{"id":"private","room":"left","at":1,"body":"ALICE_PRIVATE"}}],"held":{"messages":[["left"]]},"watermark":0,"more":false,"store_id":"same-store","generation":1,"captured_watermark":0,"send_revision":captured["send_revision"]});
    for op in ["observe_store", "apply"] {
        assert_eq!(
            call(json!({"op":op,"page":delayed,"first":true}))["denied"]["code"],
            "E_GENERATION"
        );
    }
    assert!(
        call(json!({"op":"apply","page":empty,"first":true}))
            .get("ok")
            .is_some()
    );
    let read = call(json!({"op":"query","name":"both","viewer":"dev:bob"}));
    assert_eq!(read["ok"]["data"], json!({"left":[],"held":[]}));
    sb4_close(device);

    // Diagnostic formatting returns the saved failed open; even unrelated
    // arguments must not perform a second open or change its principal.
    assert!(sb4_open(path.as_ptr(), backend_text.as_ptr(), c"".as_ptr()).is_null());
    let reason = sb4_open_reason(path.as_ptr(), backend_text.as_ptr(), c"dev:alice".as_ptr());
    let reason_json: Json =
        serde_json::from_str(unsafe { CStr::from_ptr(reason) }.to_str().unwrap()).unwrap();
    sb4_free(reason);
    assert_eq!(reason_json["denied"]["code"], "E_INPUT");
    let store = snapback4_core::Store::open(&host.path("store")).unwrap();
    assert_eq!(store.meta(OWNER).unwrap().as_deref(), Some("dev:bob"));
}

#[test]
fn memory_physical_scan_checks_images_and_empty_ids_without_indexes() {
    for corruption in ["invalid-image", "different-id", "empty-id"] {
        let mut host = Memory::new();
        let (_, backend, d) = fixture(&mut host, "dev:alice", true);
        let mut kept = d.store().export();
        // Keep one delivered-history row only, so an omitted empty ID would
        // incorrectly certify that reassignment can reset this store.
        kept.retain(|c| c.s != 'r' || c.k == "[\"messages\",\"left-25\"]");
        let row = kept.iter_mut().find(|c| c.s == 'r').unwrap();
        if corruption == "invalid-image" {
            row.v =
                Some(snapback4_core::json_codec::to_text(&snapback4_core::Value::Null).unwrap());
        } else {
            let id = if corruption == "empty-id" {
                ""
            } else {
                "different-id"
            };
            let image = wire::row_from_json(
                &backend.schema.tables["messages"],
                &json!({"id":id,"room":"left","at":25,"body":"old"}),
            )
            .unwrap();
            row.v = Some(snapback4_core::json_codec::to_text(&image).unwrap());
            if corruption == "empty-id" {
                row.k = "[\"messages\",\"\"]".into();
            }
        }
        let mut raw = MemoryStore::new();
        raw.load(kept).unwrap();
        // No schema/index installation has occurred on this loaded memory store.
        assert!(
            matches!(Device::open_store(raw, Some(backend), "dev:bob"), Err(ref e) if e.code() == "SNAPBACK_HISTORY_OWNER"),
            "{corruption}"
        );
    }
}
