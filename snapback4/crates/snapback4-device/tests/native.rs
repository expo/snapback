//! The native device against a real server engine: the snapshot applied a
//! page at a time, the stream followed, queries with the device's words,
//! a prediction pending then replaced, the outbox in submission order, the
//! C ABI round trip.

use snapback4_core::engine::{Context, Engine, WriteState};
use snapback4_core::value::Value;
use snapback4_device::ffi;
use snapback4_device::native::{Backend, Device, Queued, StreamPage};
use std::collections::BTreeMap;

const CHAT: &str = include_str!("../../../apps/chat/snapback/schema.q");

fn id(s: &str) -> Value {
    Value::Id(s.into())
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

fn server() -> (Engine, Backend) {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), CHAT.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let mut rows = vec![("conversations".to_owned(), snapback4_core::value::object([("id", id("c1")), ("title", Value::String("General".into())), ("creatorId", id("dev:alice"))]))];
    for (n, member) in ["dev:alice", "dev:bob"].iter().enumerate() {
        rows.push(("memberships".to_owned(), snapback4_core::value::object([("id", id(&format!("m{n}"))), ("conversationId", id("c1")), ("principal", id(member)), ("role", Value::String(if n == 0 { "admin".into() } else { "member".into() })), ("joinedAt", Value::Int(n as i64))])));
    }
    for n in 0..120 {
        rows.push(("messages".to_owned(), snapback4_core::value::object([("id", id(&format!("msg{n:03}"))), ("conversationId", id("c1")), ("authorId", id(if n % 2 == 1 { "dev:alice" } else { "dev:bob" })), ("body", Value::String(format!("m{n}"))), ("at", Value::Int(1_000 + n))])));
    }
    engine.seed(rows).unwrap();
    let backend = Backend { generation: engine.generation(), schema: bound.schema.clone(), programs: bound.programs.iter().map(|p| p.program.clone()).collect() };
    (engine, backend)
}

/// A `/sync` page as the wire sends it, from the engine.
fn snapshot_pages(engine: &mut Engine, principal: &str, limit: usize) -> Vec<StreamPage> {
    let mut pages = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let (events, watermark, next) = engine.snapshot_page(principal, after.as_deref(), limit).unwrap();
        let more = next.is_some();
        pages.push(serde_json::from_value(serde_json::json!({
            "snapshot": true,
            "events": events.iter().map(|e| serde_json::json!({ "table": e.table, "kind": e.kind.word(), "id": e.id, "data": e.data.as_ref().map(snapback4_core::wire::to_json) })).collect::<Vec<_>>(),
            "watermark": watermark, "more": more, "next": next, "generation": engine.generation(),
        })).unwrap());
        match next {
            Some(next) => after = Some(next),
            None => return pages,
        }
    }
}

fn stream_page(engine: &mut Engine, principal: &str, watermark: u64) -> StreamPage {
    let page = engine.stream(principal, watermark, 1_000).unwrap();
    serde_json::from_value(serde_json::json!({
        "snapshot": false,
        "events": page.events.iter().map(|e| serde_json::json!({ "table": e.table, "kind": e.kind, "id": e.id, "data": e.data.as_ref().map(snapback4_core::wire::to_json) })).collect::<Vec<_>>(),
        "watermark": page.watermark, "more": page.more, "generation": engine.generation(),
    })).unwrap()
}

#[test]
fn the_device_follows_the_server_and_answers_locally() {
    let (mut engine, backend) = server();
    let dir = std::env::temp_dir().join(format!("sb4-device-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let mut device = Device::open(&dir.join("bob.sqlite"), Some(backend.clone())).unwrap();
    assert_eq!(device.state().unwrap(), (0, backend.generation));
    // The snapshot in pages of 50: the first clears, the watermark lands with the last.
    let pages = snapshot_pages(&mut engine, "dev:bob", 50);
    assert!(pages.len() >= 3, "{} pages", pages.len());
    for (n, page) in pages.iter().enumerate() {
        device.apply(page, n == 0).unwrap();
        let (watermark, _) = device.state().unwrap();
        assert_eq!(watermark > 0, n + 1 == pages.len(), "the watermark lands with the last page");
    }
    let (watermark, _) = device.state().unwrap();
    // A query with the device's words: the thread pages with the server's cursors.
    let first = device.query("thread", "dev:bob", &serde_json::json!({ "conversationId": "c1" }), 2_000).unwrap();
    assert_eq!(first.data.as_array().unwrap().len(), 50);
    assert!(first.complete && first.next.is_some());
    let inbox = device.query("inbox", "dev:bob", &serde_json::json!({}), 2_000).unwrap();
    assert_eq!(inbox.data.as_array().unwrap()[0].field("count").unwrap(), &Value::Int(120));
    // A prediction: pending on the device, counted, then replaced by the server's image.
    let predicted = device.predict("send", "dev:bob", &serde_json::json!({ "conversationId": "c1", "body": "hello" }), 2_000, vec!["msgNEW".to_owned()], 7).unwrap();
    assert_eq!(predicted.result["id"], "msgNEW");
    assert!(predicted.predicted.contains(&"messages/msgNEW".to_owned()));
    let thread = device.query("thread", "dev:bob", &serde_json::json!({ "conversationId": "c1" }), 2_000).unwrap();
    let newest = &thread.data.as_array().unwrap()[0];
    assert_eq!(newest.field("id").unwrap(), &id("msgNEW"));
    assert_eq!(newest.field("pending").unwrap(), &Value::Bool(true));
    assert_eq!(device.query("inbox", "dev:bob", &serde_json::json!({}), 2_000).unwrap().data.as_array().unwrap()[0].field("count").unwrap(), &Value::Int(121));
    // The outbox keeps it in submission order until the server answers.
    let seq = device.next_submission().unwrap();
    device.enqueue(&Queued { id: "w1".into(), seq, op: "send".into(), args: serde_json::json!({ "conversationId": "c1", "body": "hello" }), new_ids: vec!["msgNEW".into()], predicted: predicted.predicted.clone() }).unwrap();
    assert_eq!(device.queued().unwrap().len(), 1);
    // The server applies it; the stream brings the confirmed image, without `pending`.
    let sent = engine.mutate("send", Some("w1"), Context::new("dev:bob", args(&[("conversationId", id("c1")), ("body", Value::String("hello".into()))])).at(2_500).with_ids(["msgNEW".to_owned()])).unwrap();
    assert!(matches!(sent.state, WriteState::Sent { .. }));
    device.dequeue("w1").unwrap();
    let page = stream_page(&mut engine, "dev:bob", watermark);
    assert!(page.events.iter().any(|e| e.table == "messages" && e.id == "msgNEW"));
    device.apply(&page, false).unwrap();
    let thread = device.query("thread", "dev:bob", &serde_json::json!({ "conversationId": "c1" }), 3_000).unwrap();
    let newest = &thread.data.as_array().unwrap()[0];
    assert_eq!(newest.field("id").unwrap(), &id("msgNEW"));
    assert!(newest.field("pending").is_err(), "the server's image carries no pending");
    assert_eq!(device.queued().unwrap().len(), 0);
    // A refused prediction leaves nothing; a withdrawn one goes.
    let refused = device.predict("send", "dev:mallory", &serde_json::json!({ "conversationId": "c1", "body": "hi" }), 3_000, vec![], 7).unwrap_err();
    assert_eq!(refused.code(), "NOT_MEMBER");
    let doomed = device.predict("send", "dev:bob", &serde_json::json!({ "conversationId": "c1", "body": "doomed" }), 3_000, vec!["msgDOOM".to_owned()], 7).unwrap();
    device.withdraw(&doomed.predicted).unwrap();
    assert!(device.query("thread", "dev:bob", &serde_json::json!({ "conversationId": "c1" }), 3_000).unwrap().data.as_array().unwrap().iter().all(|m| m.field("id").unwrap() != &id("msgDOOM")));
    // The rows survive a reopen; a new generation clears them.
    drop(device);
    let again = Device::open(&dir.join("bob.sqlite"), Some(backend.clone())).unwrap();
    assert_eq!(again.state().unwrap().0, page.watermark);
    drop(again);
    // A cold start with no network opens on the backend it kept.
    let mut cold = Device::open(&dir.join("bob.sqlite"), None).unwrap();
    assert_eq!(cold.state().unwrap().0, page.watermark);
    assert_eq!(cold.query("thread", "dev:bob", &serde_json::json!({ "conversationId": "c1" }), 3_000).unwrap().data.as_array().unwrap().len(), 50);
    drop(cold);
    assert!(Device::open(&dir.join("never.sqlite"), None).is_err(), "a device that never synced needs the server once");
    let mut moved = backend.clone();
    moved.generation += 1;
    let fresh = Device::open(&dir.join("bob.sqlite"), Some(moved)).unwrap();
    assert_eq!(fresh.state().unwrap(), (0, backend.generation + 1));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_scope_tombstone_applies_the_leave_policy() {
    let (mut engine, backend) = server();
    let dir = std::env::temp_dir().join(format!("sb4-device-leave-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let mut device = Device::open(&dir.join("bob.sqlite"), Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "dev:bob", 1_000).iter().enumerate() {
        device.apply(page, n == 0).unwrap();
    }
    let (watermark, _) = device.state().unwrap();
    // Bob leaves: memberships go (until-revoked), messages stay (delivered-history).
    let left = engine.mutate("leave", Some("l1"), Context::new("dev:bob", args(&[("conversationId", id("c1"))])).at(5_000)).unwrap();
    assert!(matches!(left.state, WriteState::Sent { .. }));
    let page = stream_page(&mut engine, "dev:bob", watermark);
    assert!(page.events.iter().any(|e| e.kind == "scope"), "{:?}", page.events.iter().map(|e| (&e.table, &e.kind)).collect::<Vec<_>>());
    device.apply(&page, false).unwrap();
    let inbox = device.query("inbox", "dev:bob", &serde_json::json!({}), 6_000).unwrap();
    assert_eq!(inbox.data.as_array().unwrap().len(), 0, "the membership is gone");
    let thread = device.query("thread", "dev:bob", &serde_json::json!({ "conversationId": "c1" }), 6_000).unwrap_err();
    assert_eq!(thread.code, "MEMBERSHIP_REQUIRED", "the query requires a membership; the rows themselves stay held");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_c_abi_round_trips_json() {
    let (mut engine, backend) = server();
    let dir = std::env::temp_dir().join(format!("sb4-device-ffi-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let mut device = Device::open(&dir.join("bob.sqlite"), Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "dev:bob", 1_000).into_iter().enumerate() {
        let answer = ffi::call(&mut device, &serde_json::json!({ "op": "apply", "page": serde_json::to_value(&page_json(&page)).unwrap(), "first": n == 0 }));
        assert!(answer.get("ok").is_some(), "{answer}");
    }
    let answer = ffi::call(&mut device, &serde_json::json!({ "op": "query", "name": "thread", "viewer": "dev:bob", "args": { "conversationId": "c1" }, "now": 2_000 }));
    assert_eq!(answer["ok"]["data"].as_array().unwrap().len(), 50, "{answer}");
    // A refused read is the card's `denied`, inside a call that succeeded.
    let answer = ffi::call(&mut device, &serde_json::json!({ "op": "query", "name": "nothing", "viewer": "dev:bob" }));
    assert_eq!(answer["ok"]["denied"]["code"], "E_OP", "{answer}");
    let answer = ffi::call(&mut device, &serde_json::json!({ "op": "nothing" }));
    assert_eq!(answer["denied"]["code"], "E_OP", "{answer}");
    let answer = ffi::call(&mut device, &serde_json::json!({ "op": "state" }));
    assert_eq!(answer["ok"]["generation"], 1);
    let _ = std::fs::remove_dir_all(&dir);
}

fn page_json(page: &StreamPage) -> serde_json::Value {
    serde_json::json!({ "snapshot": page.snapshot, "events": page.events.iter().map(|e| serde_json::json!({ "table": e.table, "kind": e.kind, "id": e.id, "data": e.data })).collect::<Vec<_>>(), "watermark": page.watermark, "more": page.more, "next": page.next, "generation": page.generation })
}

#[test]
fn a_wide_merge_matches_the_server_until_the_device_horizon() {
    use snapback4_core::value::object;
    let source = format!("{CHAT}\nquery feed(c: cursor ?):\n  return merge messages after c last 20 by byConvTime:\n    [m.conversationId] for m in memberships[viewer] first 20 by byPrincipalConversation\n");
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let programs: Vec<_> = bound.programs.iter().map(|p| p.program.clone()).collect();
    let mut engine = Engine::memory(bound.schema.clone(), programs.clone()).unwrap();
    let mut rows = Vec::new();
    // Ten lanes exercise one-head refill. The first conversation exceeds
    // its device horizon, while the others include tied timestamps.
    for g in 0..10 {
        let c = id(&format!("c{g}"));
        rows.push(("conversations".to_owned(), object([("id", c.clone()), ("title", Value::String(format!("Group {g}"))), ("creatorId", id("dev:bob"))])));
        rows.push(("memberships".to_owned(), object([("id", id(&format!("m{g}"))), ("conversationId", c.clone()), ("principal", id("dev:bob")), ("role", Value::String("admin".into())), ("joinedAt", Value::Int(1))])));
        for n in 0..if g == 0 { 550 } else { 25 } {
            rows.push(("messages".to_owned(), object([("id", id(&format!("msg{g}-{n:03}"))), ("conversationId", c.clone()), ("authorId", id("dev:bob")), ("body", Value::String(format!("m{n}"))), ("at", Value::Int(1_000 + n))])));
        }
    }
    engine.seed(rows).unwrap();
    let backend = Backend { generation: engine.generation(), schema: bound.schema, programs };
    let dir = std::env::temp_dir().join(format!("sb4-device-merge-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut device = Device::open(&dir.join("bob.sqlite"), Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "dev:bob", 100).iter().enumerate() {
        device.apply(page, n == 0).unwrap();
    }
    // Reopening also exercises the persisted native store, not a JS mirror.
    drop(device);
    let mut device = Device::open(&dir.join("bob.sqlite"), None).unwrap();
    let mut cursor: Option<String> = None;
    let mut complete_pages = 0;
    loop {
        let page = device.query("feed", "dev:bob", &serde_json::json!({ "c": cursor }), 2_000).unwrap();
        let online = engine.query("feed", Context::new("dev:bob", args(&[("c", cursor.clone().map(Value::String).unwrap_or(Value::Null))])).at(2_000)).unwrap();
        assert!(online.complete);
        if !page.complete {
            assert!(complete_pages >= 24, "pages inside the held horizon are complete");
            break;
        }
        assert_eq!(page.data, online.data);
        assert_eq!(page.next, online.next);
        if complete_pages == 0 {
            assert!(page.metered.examined < 100, "a wide native merge reads lane heads: {:?}", page.metered);
        }
        complete_pages += 1;
        assert!(complete_pages < 40, "the exhausted horizon must report incomplete");
        cursor = Some(page.next.expect("the server continues past this page"));
    }
    drop(device);
    std::fs::remove_dir_all(dir).unwrap();
}
