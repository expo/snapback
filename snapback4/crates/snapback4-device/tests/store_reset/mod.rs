//! A persisted device can outlive the server's database, at the same generation.
use super::*;
use serde_json::json;

#[test]
fn sync_metadata_recovery_fences_and_durable_acquisition_on_both_stores() {
    on_both(|host| {
        let (mut engine, backend) = compile(SOURCE);
        engine.seed([("notes".into(), snapback4_core::value::object([("id", id("held")), ("body", Value::String("held".into()))]))]).unwrap();
        let mut device = host.open("metadata", Some(backend.clone())).unwrap();
        identified_pages(&mut engine, &mut *device, false);
        for (n, id) in ["known", "unknown"].iter().enumerate() {
            ok(device.call(json!({ "op": "admit", "entry": { "id": id, "seq": n + 1, "op": "add", "args": { "body": id }, "viewer": "alice", "now": 1, "predictable": false } })));
        }
        ok(device.call(json!({ "op": "settle", "id": "known", "seq": 2 })));
        assert_eq!(ok(device.call(json!({ "op": "queued" }))).as_array().unwrap().len(), 2);
        let state = ok(device.call(json!({ "op": "sync_state" })));
        let capture = json!({ "store_id": state["store_id"], "generation": state["generation"], "send_revision": state["send_revision"],
            "captured_watermark": state["watermark"], "from": state["watermark"], "stream": false, "recover": true });
        let metadata = json!({ "metadata": true, "store_id": state["store_id"], "generation": state["generation"], "watermark": state["watermark"] });
        assert_eq!(ok(device.call(json!({ "op": "sync_metadata", "metadata": metadata, "capture": capture })))["snapshot"], false);
        assert_eq!(ok(device.call(json!({ "op": "sync_state" }))), state, "generic metadata is read-only");
        let mut decision = metadata.clone();
        decision["recovery"] = json!({ "from": state["watermark"], "snapshot": true });
        for field in ["store_id", "send_revision", "captured_watermark", "generation", "from", "stream", "recover"] {
            let mut stale = capture.clone();
            stale[field] = match field { "store_id" => json!("foreign"), "stream" => json!(true), "recover" => json!(false), _ => json!(99) };
            let denied = device.call(json!({ "op": "sync_metadata", "metadata": decision, "capture": stale }));
            assert_eq!(denied["denied"]["code"], "E_GENERATION", "{field}: {denied}");
            assert_eq!(ok(device.call(json!({ "op": "sync_state" }))), state);
            assert_eq!(ok(device.call(json!({ "op": "queued" }))).as_array().unwrap().len(), 2, "a stale capture cannot retire either receipt");
            assert!(ok(device.call(json!({ "op": "meta", "key": "write-history" }))).is_null(), "no receipt history before the fence");
            assert_eq!(rows(&query(&mut *device, "all", "alice", json!({}), 1)).len(), 1);
        }
        let mut wrong_position = decision.clone();
        wrong_position["recovery"]["from"] = json!(0);
        assert_eq!(device.call(json!({ "op": "sync_metadata", "metadata": wrong_position, "capture": capture }))["denied"]["code"], "E_GENERATION");
        assert_eq!(ok(device.call(json!({ "op": "sync_metadata", "metadata": decision, "capture": capture })))["snapshot"], true);
        let receipts = ok(device.call(json!({ "op": "meta", "key": "write-history" })));
        let receipts: serde_json::Value = serde_json::from_str(receipts.as_str().unwrap()).unwrap();
        assert_eq!(receipts[0]["id"], "known", "recovery persists known receipts in the fenced transaction");
        let queue = ok(device.call(json!({ "op": "queued" })));
        assert_eq!(queue.as_array().unwrap().len(), 1);
        assert_eq!(queue[0]["id"], "unknown");
        let recovering = ok(device.call(json!({ "op": "sync_state" })));
        assert_eq!(recovering["snapshot_required"], true);
        assert_eq!(recovering["acquired"], false);
        assert_eq!(recovering["watermark"], state["watermark"], "keep the restore watermark");
        assert_eq!(recovering["send_revision"].as_u64().unwrap(), state["send_revision"].as_u64().unwrap() + 1);
        let mut page = page_json(&stream_page(&mut engine, "alice", state["watermark"].as_u64().unwrap()));
        page["store_id"] = state["store_id"].clone();
        page["send_revision"] = state["send_revision"].clone();
        assert_eq!(device.call(json!({ "op": "apply", "page": page }))["denied"]["code"], "E_GENERATION", "pre-recovery pages are fenced");
        device.close();
        let mut device = host.open("metadata", None).unwrap();
        assert_eq!(ok(device.call(json!({ "op": "sync_state" }))), recovering, "restart persists across reopen");
        page["send_revision"] = recovering["send_revision"].clone();
        assert_eq!(device.call(json!({ "op": "apply", "page": page }))["denied"]["code"], "E_GENERATION", "ordinary streaming cannot discharge recovery");
        identified_pages(&mut engine, &mut *device, true);
        assert_eq!(ok(device.call(json!({ "op": "sync_state" })))["acquired"], false, "snapshot rows stay staged until catch-up");
        page["snapshot_catchup"] = json!(true);
        ok(device.call(json!({ "op": "apply", "page": page })));
        let published = ok(device.call(json!({ "op": "sync_state" })));
        assert_eq!(published["acquired"], true);
        assert!(published["snapshot_required"].is_null());
        assert_eq!(rows(&query(&mut *device, "all", "alice", json!({}), 1)).len(), 1);
        device.close();
    });
}

#[test]
fn sync_metadata_restore_checks_the_capture_before_persisting_on_both_stores() {
    for older in [false, true] { on_both(|host| {
        let (mut engine, mut backend) = compile(SOURCE);
        if older {
            let (_, changed) = compile(&SOURCE.replace("first 100", "first 99"));
            engine.adopt(changed.schema.clone(), changed.programs.clone()).unwrap();
            backend = snapback4_device::device::Backend { generation: engine.generation(), ..changed };
        }
        engine.seed([("notes".into(), snapback4_core::value::object([("id", id("held")), ("body", Value::String("held".into()))]))]).unwrap();
        let mut device = host.open("metadata-restore", Some(backend)).unwrap();
        identified_pages(&mut engine, &mut *device, false);
        let state = ok(device.call(json!({ "op": "sync_state" })));
        let capture = json!({ "store_id": state["store_id"], "generation": state["generation"], "send_revision": state["send_revision"],
            "captured_watermark": state["watermark"], "from": state["watermark"], "stream": false, "recover": false });
        let metadata = json!({ "metadata": true, "store_id": state["store_id"], "generation": if older { 1 } else { state["generation"].as_u64().unwrap() }, "watermark": 0 });
        let mut stale = capture.clone(); stale["send_revision"] = json!(0);
        assert_eq!(device.call(json!({ "op": "sync_metadata", "metadata": metadata, "capture": stale }))["denied"]["code"], "E_GENERATION");
        assert_eq!(ok(device.call(json!({ "op": "sync_state" }))), state);
        assert_eq!(device.call(json!({ "op": "sync_metadata", "metadata": metadata, "capture": capture }))["denied"]["code"], if older { "E_GENERATION" } else { "E_STORE_RESTORE" });
        device.close();
        let mut device = host.open("metadata-restore", None).unwrap();
        let restored = ok(device.call(json!({ "op": "sync_state" })));
        assert_eq!(restored["restore_refusal"]["code"], if older { json!(null) } else { json!("E_STORE_RESTORE") });
        assert_eq!(restored["watermark"], state["watermark"]);
        device.close();
    }); }
}

#[test]
fn sync_metadata_cannot_identify_a_legacy_acquired_partition_on_both_stores() {
    on_both(|host| {
        let (mut engine, backend) = compile(SOURCE);
        engine.seed([("notes".into(), snapback4_core::value::object([("id", id("held")), ("body", Value::String("held".into()))]))]).unwrap();
        let mut device = host.open("legacy-metadata", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "alice", 2).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        let state = ok(device.call(json!({ "op": "sync_state" })));
        assert!(state["store_id"].is_null());
        let capture = json!({ "store_id": null, "generation": state["generation"], "send_revision": state["send_revision"],
            "captured_watermark": state["watermark"], "from": state["watermark"], "stream": false, "recover": false });
        let metadata = json!({ "metadata": true, "store_id": "a-store", "generation": state["generation"], "watermark": 0 });
        assert_eq!(device.call(json!({ "op": "sync_metadata", "metadata": metadata, "capture": capture }))["denied"]["code"], "E_GENERATION");
        assert_eq!(ok(device.call(json!({ "op": "sync_state" }))), state);
        assert_eq!(rows(&query(&mut *device, "all", "alice", json!({}), 1)).len(), 1);
        device.close();
    });
}

const SOURCE: &str = "table notes:\n  body: text <=100\n  public 'reset fixture'\n  insert <- allow\n  sync\nquery all():\n  return notes first 100 by byId\nmutation add(body: text <=100):\n  return insert notes { body }\n";

fn same_store_restore(host: &mut dyn HostDyn, observe: &str) {
    let (mut a, backend) = compile(SOURCE);
    for n in 0..3 { a.seed([("notes".into(), snapback4_core::value::object([("id", id(&format!("old-{n}"))), ("body", Value::String("A".into()))]))]).unwrap(); }
    let mut device = host.open("restore", Some(backend.clone())).unwrap();
    identified_pages(&mut a, &mut *device, false);
    let capture = ok(device.call(json!({ "op": "sync_state" })));
    // Equal and advancing heads remain ordinary sync in the same store.
    for watermark in [3, 4] { ok(device.call(json!({ "op": "apply", "page": { "snapshot": false, "events": [], "watermark": watermark, "more": false, "store_id": capture["store_id"] } }))); }
    assert_eq!(query(&mut *device, "all", "alice", json!({}), 1)["complete"], true);
    let stale = device.call(json!({ "op": observe, "page": { "snapshot": false, "events": [], "watermark": 2, "more": false, "store_id": capture["store_id"], "requested_watermark": 3, "captured_watermark": 3 } }));
    assert_eq!(stale["denied"]["code"], "E_GENERATION", "a delayed capture cannot infer restore after another owner's progress");
    assert_eq!(query(&mut *device, "all", "alice", json!({}), 1)["complete"], true);
    let page = json!({ "snapshot": false, "events": [], "watermark": 1, "more": false, "store_id": capture["store_id"], "requested_watermark": 4, "captured_watermark": 4 });
    let refusal = device.call(json!({ "op": observe, "page": page }));
    assert_eq!(refusal["denied"]["code"], "E_STORE_RESTORE", "{refusal}");
    assert_eq!(refusal["denied"]["message"], "E_STORE_RESTORE: the backend store was restored or shrank below this device's watermark; stop this client and use a fresh device store and outbox");
    assert_ne!(refusal["denied"]["retryable"], true);
    assert_eq!(query(&mut *device, "all", "alice", json!({}), 1)["denied"]["code"], "E_STORE_RESTORE");
    assert_eq!(state(&mut *device).0, 4);
    assert_eq!(device.call(json!({ "op": "begin_send" }))["denied"]["code"], "E_STORE_RESTORE");
    device.close();
    let mut device = host.open("restore", Some(backend)).unwrap();
    assert_eq!(query(&mut *device, "all", "alice", json!({}), 1)["denied"]["code"], "E_STORE_RESTORE");
    assert_eq!(device.call(json!({ "op": "apply", "first": true, "page": { "snapshot": true, "events": [], "watermark": 4, "more": false, "store_id": capture["store_id"] } }))["denied"]["code"], "E_STORE_RESTORE", "same identity cannot silently reacquire even after its head recovers");
    assert_eq!(state(&mut *device).0, 4);
}

#[test]
fn same_store_restore_sqlite() { for op in ["observe_store", "apply"] { same_store_restore(&mut Sqlite::new("restore"), op); } }
#[test]
fn same_store_restore_memory() { for op in ["observe_store", "apply"] { same_store_restore(&mut Memory::new(), op); } }

fn replaced(host: &mut dyn HostDyn) {
    let label = host.label();
    let (mut a, backend) = compile(SOURCE);
    for n in 0..3 {
        a.seed([("notes".into(), snapback4_core::value::object([("id", id(&format!("old-{n}"))), ("body", Value::String("old".into()))]))]).unwrap();
    }
    let mut device = host.open("reset", Some(backend.clone())).unwrap();
    for (n, page) in snapshot_pages(&mut a, "alice", 2).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
    let watermark = state(&mut *device).0;
    assert_eq!(watermark, 3);
    ok(device.call(json!({ "op": "admit", "entry": { "id": "unsent", "seq": 1, "op": "add", "args": { "body": "pending" }, "viewer": "alice", "now": 1, "predictable": true } })));
    device.close();
    let (mut b, replacement) = compile(SOURCE);
    assert_eq!(replacement.generation, backend.generation);
    let mut device = host.open("reset", Some(replacement)).unwrap();
    let page = stream_page(&mut b, "alice", watermark);
    let mut wire = page_json(&page); wire["requested_watermark"] = json!(watermark); wire["captured_watermark"] = json!(watermark);
    let result = device.call(json!({ "op": "apply", "page": wire }));
    let read = query(&mut *device, "all", "alice", json!({}), 1);
    eprintln!("{label} reset: A={watermark}, B={}, reply={}, apply={result}, read={read}", b.store().seq().unwrap(), page.watermark);
    assert!(read["denied"].is_object(), "old partition must lose acquisition when the server watermark regresses: {read}");
    assert_eq!(state(&mut *device).0, 0);
    assert_eq!(ok(device.call(json!({ "op": "queued" })))[0]["id"], "unsent");
    ok(device.call(json!({ "op": "adopt", "backend": backend })));
    for (n, page) in snapshot_pages(&mut b, "alice", 2).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
    assert_eq!(rows(&query(&mut *device, "all", "alice", json!({}), 1)).len(), 0, "old predictions are discarded too");
    device.close();
}

#[test]
fn replaced_backend_sqlite() { replaced(&mut Sqlite::new("reset")); }
#[test]
fn replaced_backend_memory() { replaced(&mut Memory::new()); }

fn identified_pages(engine: &mut snapback4_core::Engine, device: &mut dyn AnyDevice, stage: bool) {
    let store_id = engine.store().meta("store_id").unwrap().unwrap();
    for (n, page) in snapshot_pages(engine, "alice", 2).iter().enumerate() {
        let mut wire = page_json(page);
        wire["store_id"] = json!(store_id);
        wire["stage_snapshot"] = json!(stage);
        ok(device.call(json!({ "op": "apply", "page": wire, "first": n == 0 })));
    }
}

#[test]
fn store_identity_resets_equal_watermarks_and_retires_only_known_receipts_on_both_stores() {
    on_both(|host| {
        let (mut a, backend) = compile(SOURCE);
        a.seed([("notes".into(), snapback4_core::value::object([("id", id("old")), ("body", Value::String("A".into()))]))]).unwrap();
        let a_id = a.store().meta("store_id").unwrap().unwrap();
        let mut device = host.open("identities", Some(backend.clone())).unwrap();
        identified_pages(&mut a, &mut *device, false);
        for (n, name) in ["known-sent", "known-observed", "unknown-receipt", "unsent"].iter().enumerate() {
            ok(device.call(json!({ "op": "admit", "entry": { "id": name, "seq": n + 1, "op": "add", "args": { "body": name }, "viewer": "alice", "now": 1, "predictable": true } })));
        }
        // The first write's receipt has arrived but its row has not streamed.
        let entries = ok(device.call(json!({ "op": "queued" })));
        for entry in entries.as_array().unwrap().iter().take(3) {
            let ctx = context("alice", &[("body", Value::String(entry["id"].as_str().unwrap().into()))])
                .with_ids(serde_json::from_value::<Vec<String>>(entry["new_ids"].clone()).unwrap());
            let result = a.mutate("add", entry["id"].as_str(), ctx).unwrap();
            let WriteState::Sent { seq, .. } = result.state else { panic!("{:?}", result.state) };
            if entry["id"] == "known-sent" { ok(device.call(json!({ "op": "settle", "id": entry["id"], "seq": seq }))); }
        }
        let mut acknowledged = page_json(&stream_page(&mut a, "alice", 1));
        acknowledged["store_id"] = json!(a_id);
        acknowledged["acknowledged"] = json!({ "known-observed": 3 });
        ok(device.call(json!({ "op": "apply", "page": acknowledged })));
        let known = ok(device.call(json!({ "op": "admit", "entry": { "id": "known-unstreamed", "seq": 5, "op": "add", "args": { "body": "known-unstreamed" }, "viewer": "alice", "now": 1, "predictable": true } })));
        let ctx = context("alice", &[("body", Value::String("known-unstreamed".into()))]).with_ids(serde_json::from_value::<Vec<String>>(known["new_ids"].clone()).unwrap());
        let result = a.mutate("add", Some("known-unstreamed"), ctx).unwrap();
        let WriteState::Sent { seq, .. } = result.state else { panic!("{:?}", result.state) };
        ok(device.call(json!({ "op": "settle", "id": "known-unstreamed", "seq": seq })));
        let capture = ok(device.call(json!({ "op": "sync_state" })));
        let old_page = json!({ "snapshot": false, "events": [], "watermark": 4, "more": false, "store_id": a_id, "send_revision": capture["send_revision"] });
        device.close();
        let (mut b, _) = compile(SOURCE);
        // Equal head: no watermark heuristic can distinguish these stores.
        for n in 0..4 { b.seed([("notes".into(), snapback4_core::value::object([("id", id(&format!("B-{n}"))), ("body", Value::String("B".into()))]))]).unwrap(); }
        let b_id = b.store().meta("store_id").unwrap().unwrap();
        assert_ne!(a_id, b_id);
        let mut device = host.open("identities", Some(backend.clone())).unwrap();
        let mut page = page_json(&stream_page(&mut b, "alice", 4));
        page["store_id"] = json!(b_id); page["send_revision"] = capture["send_revision"].clone();
        let observation = ok(device.call(json!({ "op": "observe_store", "page": page })));
        assert_eq!(observation["reset"], true);
        assert_eq!(observation["retired"]["known-observed"], 3);
        assert_eq!(observation["retired"]["known-unstreamed"], 5);
        let receipts = ok(device.call(json!({ "op": "meta", "key": "write-history" })));
        let receipts: serde_json::Value = serde_json::from_str(receipts.as_str().unwrap()).unwrap();
        for id in ["known-observed", "known-unstreamed"] {
            assert!(receipts.as_array().unwrap().iter().any(|receipt| receipt["id"] == id), "retirement persists receipts before returning to its host");
        }
        assert!(device.call(json!({ "op": "apply", "page": old_page }))["denied"].is_object(), "an old response cannot reset B back to A");
        assert_eq!(ok(device.call(json!({ "op": "sync_state" })))["store_id"], b_id);
        assert!(query(&mut *device, "all", "alice", json!({}), 1)["denied"].is_object());
        let queue = ok(device.call(json!({ "op": "queued" })));
        assert_eq!(queue.as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap()).collect::<Vec<_>>(), ["unknown-receipt", "unsent"]);
        assert!(queue.as_array().unwrap().iter().all(|e| e["predicted"] == json!([]) && e["predictable"] == false));
        ok(device.call(json!({ "op": "adopt", "backend": backend })));
        // Crash during acquisition: even staged rows remain unavailable.
        identified_pages(&mut b, &mut *device, true); device.close();
        let mut device = host.open("identities", None).unwrap();
        assert!(query(&mut *device, "all", "alice", json!({}), 1)["denied"].is_object());
        identified_pages(&mut b, &mut *device, false);
        assert_eq!(rows(&query(&mut *device, "all", "alice", json!({}), 1)).len(), 4);
        for entry in queue.as_array().unwrap() {
            let ctx = context("alice", &[("body", Value::String(entry["id"].as_str().unwrap().into()))])
                .with_ids(serde_json::from_value::<Vec<String>>(entry["new_ids"].clone()).unwrap());
            let result = b.mutate("add", entry["id"].as_str(), ctx.clone()).unwrap();
            let WriteState::Sent { seq, .. } = result.state else { panic!("{:?}", result.state) };
            assert!(b.mutate("add", entry["id"].as_str(), ctx).unwrap().replayed);
            ok(device.call(json!({ "op": "settle", "id": entry["id"], "seq": seq })));
        }
        let mut page = page_json(&stream_page(&mut b, "alice", 4)); page["store_id"] = json!(b_id);
        ok(device.call(json!({ "op": "apply", "page": page })));
        assert_eq!(rows(&query(&mut *device, "all", "alice", json!({}), 1)).len(), 6);
        assert_eq!(ok(device.call(json!({ "op": "queued" }))), json!([]));
        device.close();
        let (mut c, _) = compile(SOURCE);
        let mut device = host.open("identities", Some(backend)).unwrap();
        let mut page = page_json(&stream_page(&mut c, "alice", 6)); page["store_id"] = json!(c.store().meta("store_id").unwrap().unwrap());
        assert!(device.call(json!({ "op": "apply", "page": page }))["denied"].is_object());
        let backend = ok(device.call(json!({ "op": "backend" })));
        ok(device.call(json!({ "op": "adopt", "backend": backend })));
        identified_pages(&mut c, &mut *device, false);
        assert_eq!(rows(&query(&mut *device, "all", "alice", json!({}), 1)).len(), 0);
        device.close();
    });
}

#[test]
fn store_replacement_discards_left_group_history_on_both_stores() {
    on_both(|host| {
        let (mut a, _) = server();
        let (_, backend) = compile(&format!("{CHAT}\nquery retainedHistory(conversationId: conversations):\n  return messages[conversationId] last 50 by byConvTime\n"));
        let mut device = host.open("left-reset", Some(backend.clone())).unwrap();
        let a_id = a.store().meta("store_id").unwrap().unwrap();
        for (n, page) in snapshot_pages(&mut a, "dev:alice", 50).iter().enumerate() {
            let mut wire = page_json(page); wire["store_id"] = json!(a_id);
            ok(device.call(json!({ "op": "apply", "page": wire, "first": n == 0 })));
        }
        let from = state(&mut *device).0;
        assert!(matches!(a.mutate("leave", Some("leave"), context("dev:alice", &[("conversationId", id("c1"))])).unwrap().state, WriteState::Sent { .. }));
        let mut page = page_json(&stream_page(&mut a, "dev:alice", from)); page["store_id"] = json!(a_id);
        ok(device.call(json!({ "op": "apply", "page": page })));
        let retained = query(&mut *device, "retainedHistory", "dev:alice", json!({ "conversationId": "c1" }), 1);
        assert_eq!(rows(&retained).len(), 50);
        device.close();
        let (mut b, _) = compile(CHAT);
        let mut device = host.open("left-reset", Some(backend)).unwrap();
        let mut page = page_json(&stream_page(&mut b, "dev:alice", 2)); page["store_id"] = json!(b.store().meta("store_id").unwrap().unwrap());
        assert!(device.call(json!({ "op": "apply", "page": page }))["denied"].is_object());
        let backend = ok(device.call(json!({ "op": "backend" })));
        ok(device.call(json!({ "op": "adopt", "backend": backend })));
        for (n, page) in snapshot_pages(&mut b, "dev:alice", 50).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        // If the old held/left map or confirmed images survived, retention
        // would copy A's delivered messages into B's empty snapshot.
        let read = query(&mut *device, "retainedHistory", "dev:alice", json!({ "conversationId": "c1" }), 1);
        assert_eq!(rows(&read).len(), 0);
        device.close();
    });
}

#[test]
fn replacement_backend_obligation_survives_restart_and_blocks_publication_on_both_stores() {
    on_both(|host| {
        let (mut a, backend) = compile(SOURCE);
        let mut device = host.open("adoption-obligation", Some(backend.clone())).unwrap();
        identified_pages(&mut a, &mut *device, false);
        let a_id = a.store().meta("store_id").unwrap().unwrap();
        let before = ok(device.call(json!({ "op": "sync_state" })));
        let b = json!({ "snapshot": true, "events": [], "watermark": 0, "more": false, "store_id": "B", "send_revision": before["send_revision"] });
        assert_eq!(ok(device.call(json!({ "op": "observe_store", "page": b })))["reset"], true);
        device.close();
        let mut device = host.open("adoption-obligation", None).unwrap();
        let capture = ok(device.call(json!({ "op": "sync_state" })));
        assert_eq!(capture["backend_required"], true);
        let page = json!({ "snapshot": true, "events": [], "watermark": 0, "more": false, "store_id": "B", "send_revision": capture["send_revision"] });
        assert!(device.call(json!({ "op": "apply", "page": page, "first": true }))["denied"].is_object());
        assert!(device.call(json!({ "op": "adopt", "backend": backend, "store_id": a_id, "send_revision": before["send_revision"] }))["denied"].is_object());
        assert_eq!(ok(device.call(json!({ "op": "sync_state" })))["backend_required"], true);
        ok(device.call(json!({ "op": "adopt", "backend": backend, "store_id": "B", "send_revision": capture["send_revision"] })));
        assert_eq!(ok(device.call(json!({ "op": "sync_state" })))["backend_required"], false);
        ok(device.call(json!({ "op": "apply", "page": page, "first": true })));
        assert_eq!(rows(&query(&mut *device, "all", "alice", json!({}), 1)).len(), 0);
        device.close();
    });
}

#[test]
fn replacement_during_paged_snapshot_and_catchup_rejects_delayed_a_pages_on_both_stores() {
    on_both(|host| {
        for during_catchup in [false, true] {
            let (mut a, backend) = compile(SOURCE);
            for n in 0..3 { a.seed([("notes".into(), snapback4_core::value::object([("id", id(&format!("A-{n}"))), ("body", Value::String("A".into()))]))]).unwrap(); }
            let mut device = host.open(if during_catchup { "catchup" } else { "pages" }, Some(backend.clone())).unwrap();
            let pages = snapshot_pages(&mut a, "alice", 2);
            let a_id = a.store().meta("store_id").unwrap().unwrap();
            for (i, page) in pages.iter().enumerate().take(if during_catchup { pages.len() } else { 1 }) {
                let mut page = page_json(page); page["store_id"] = json!(a_id); page["stage_snapshot"] = json!(true);
                ok(device.call(json!({ "op": "apply", "page": page, "first": i == 0 })));
            }
            let capture = ok(device.call(json!({ "op": "sync_state" })));
            let mut delayed = if during_catchup { page_json(&stream_page(&mut a, "alice", 3)) } else { page_json(&pages[1]) };
            delayed["store_id"] = json!(a_id); delayed["send_revision"] = capture["send_revision"].clone();
            delayed["stage_snapshot"] = json!(!during_catchup); delayed["snapshot_catchup"] = json!(during_catchup);
            let b = json!({ "snapshot": true, "events": [], "watermark": 0, "more": false, "store_id": "B", "send_revision": capture["send_revision"] });
            assert_eq!(ok(device.call(json!({ "op": "observe_store", "page": b })))["reset"], true);
            ok(device.call(json!({ "op": "adopt", "backend": backend })));
            assert!(device.call(json!({ "op": "apply", "page": delayed }))["denied"].is_object());
            let b = json!({ "snapshot": true, "events": [], "watermark": 0, "more": false, "store_id": "B" });
            ok(device.call(json!({ "op": "apply", "page": b, "first": true })));
            assert_eq!(rows(&query(&mut *device, "all", "alice", json!({}), 1)).len(), 0);
            device.close();
        }
    });
}

#[test]
fn legacy_first_identification_discards_left_history_even_on_the_same_store() {
    on_both(|host| {
        let (mut engine, _) = server();
        let (_, backend) = compile(&format!("{CHAT}\nquery retainedHistory(conversationId: conversations):\n  return messages[conversationId] last 50 by byConvTime\n"));
        let mut device = host.open("legacy-history", Some(backend.clone())).unwrap();
        for (i, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
        let from = state(&mut *device).0;
        engine.mutate("leave", Some("leave"), context("dev:alice", &[("conversationId", id("c1"))])).unwrap();
        ok(apply(&mut *device, &stream_page(&mut engine, "dev:alice", from), false));
        assert_eq!(rows(&query(&mut *device, "retainedHistory", "dev:alice", json!({ "conversationId": "c1" }), 1)).len(), 50);
        let mut page = page_json(&stream_page(&mut engine, "dev:alice", state(&mut *device).0));
        page["store_id"] = json!(engine.store().meta("store_id").unwrap().unwrap());
        assert_eq!(ok(device.call(json!({ "op": "observe_store", "page": page })))["reset"], true);
        ok(device.call(json!({ "op": "adopt", "backend": backend })));
        for (i, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
        assert_eq!(rows(&query(&mut *device, "retainedHistory", "dev:alice", json!({ "conversationId": "c1" }), 1)).len(), 0);
        device.close();
    });
}

#[test]
fn same_store_backend_adoption_and_backwards_clock_keep_identity_and_history() {
    on_both(|host| {
        let (mut engine, backend) = compile(SOURCE);
        engine.seed([("notes".into(), snapback4_core::value::object([("id", id("held")), ("body", Value::String("held".into()))]))]).unwrap();
        let identity = engine.store().meta("store_id").unwrap().unwrap();
        let mut device = host.open("same-store", Some(backend.clone())).unwrap();
        ok(device.call(json!({ "op": "adopt", "backend": backend, "store_id": null, "send_revision": 0 })));
        identified_pages(&mut engine, &mut *device, false);
        let (_, changed) = compile(&SOURCE.replace("first 100", "first 99"));
        engine.adopt(changed.schema.clone(), changed.programs.clone()).unwrap();
        assert_eq!(engine.store().meta("store_id").unwrap().unwrap(), identity);
        ok(device.call(json!({ "op": "adopt", "backend": backend })));
        assert_eq!(ok(device.call(json!({ "op": "sync_state" })))["backend_required"], false);
        for now in [100_000, -100_000] { assert_eq!(rows(&query(&mut *device, "all", "alice", json!({}), now)).len(), 1); }
        for watermark in [2_147_483_647u64, 4_294_967_296, 9_007_199_254_740_991] {
            let capture = ok(device.call(json!({ "op": "sync_state" })));
            let page = json!({ "snapshot": false, "events": [], "watermark": watermark, "more": false, "store_id": identity,
                "send_revision": capture["send_revision"], "requested_watermark": capture["watermark"], "captured_watermark": capture["watermark"] });
            ok(device.call(json!({ "op": "apply", "page": page })));
            assert_eq!(ok(device.call(json!({ "op": "sync_state" })))["watermark"], watermark);
        }
        device.close();
    });
}
