//! A persisted device can outlive the server's database, at the same generation.
use super::*;
use serde_json::json;

const SOURCE: &str = "table notes:\n  body: text <=100\n  public 'reset fixture'\n  insert <- allow\n  sync\nquery all():\n  return notes first 100 by byId\nmutation add(body: text <=100):\n  return insert notes { body }\n";

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
    let result = apply(&mut *device, &page, false);
    let read = query(&mut *device, "all", "alice", json!({}), 1);
    eprintln!("{label} reset: A={watermark}, B={}, reply={}, apply={result}, read={read}", b.store().seq().unwrap(), page.watermark);
    assert!(read["denied"].is_object(), "old partition must lose acquisition when the server watermark regresses: {read}");
    assert_eq!(state(&mut *device).0, 0);
    assert_eq!(ok(device.call(json!({ "op": "queued" })))[0]["id"], "unsent");
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
        assert!(device.call(json!({ "op": "apply", "page": old_page }))["denied"].is_object(), "an old response cannot reset B back to A");
        assert_eq!(ok(device.call(json!({ "op": "sync_state" })))["store_id"], b_id);
        assert!(query(&mut *device, "all", "alice", json!({}), 1)["denied"].is_object());
        let queue = ok(device.call(json!({ "op": "queued" })));
        assert_eq!(queue.as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap()).collect::<Vec<_>>(), ["unknown-receipt", "unsent"]);
        assert!(queue.as_array().unwrap().iter().all(|e| e["predicted"] == json!([]) && e["predictable"] == false));
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
        for (n, page) in snapshot_pages(&mut b, "dev:alice", 50).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        // If the old held/left map or confirmed images survived, retention
        // would copy A's delivered messages into B's empty snapshot.
        let read = query(&mut *device, "retainedHistory", "dev:alice", json!({ "conversationId": "c1" }), 1);
        assert_eq!(rows(&read).len(), 0);
        device.close();
    });
}
