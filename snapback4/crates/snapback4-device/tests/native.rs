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

#[test]
fn online_only_final_insert_target_is_unknown_to_the_native_predictor() {
    let source = "table targets:\n  name: text <=10\n  unique byName: name\n  read <- allow\ntable sources:\n  name: text <=10\n  read <- allow\n  insert <- allow\n  after insert <- exists targets[.name]\n  sync public\nquery rows():\n  return sources[] first 10 by byId\nmutation add(name: text <=10):\n  insert sources {name}\n  return null\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    engine.seed([("targets".into(), snapback4_core::value::object([("id", id("t")), ("name", Value::String("known".into()))]))]).unwrap();
    let backend = Backend { generation: engine.generation(), schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() };
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("sb4-final-exists-{}-{nonce}", std::process::id()));
    std::fs::create_dir(&dir).unwrap();
    let mut device = Device::open(&dir.join("device.sqlite"), Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "dev:alice", 10).iter().enumerate() {
        assert!(page.events.iter().all(|event| event.table != "targets"));
        device.apply(page, n == 0).unwrap();
    }
    let input = serde_json::json!({"name":"known"});
    let unknown = device.predict("add", "dev:alice", &input, 1, vec!["s".into()], 1).unwrap_err();
    assert_eq!(unknown.code(), "E_PREDICT", "an unacquired target is unknown, not a false final constraint");
    assert!(device.query("rows", "dev:alice", &serde_json::json!({}), 1).unwrap().data.as_array().unwrap().is_empty(), "the failed prediction rolls back its inserted source");
    let sent = engine.mutate("add", None, Context::new("dev:alice", args(&[("name", Value::String("known".into()))])).at(1).with_ids(["s".into()])).unwrap();
    assert!(matches!(sent.state, WriteState::Sent { .. }), "the server holds the required target");
    drop(device);
    std::fs::remove_dir_all(dir).unwrap();
}

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
    device.enqueue(&Queued { id: "w1".into(), seq, op: "send".into(), args: serde_json::json!({ "conversationId": "c1", "body": "hello" }), new_ids: vec!["msgNEW".into()], predicted: predicted.predicted.clone(), viewer: String::new(), now: 0, predictable: false, sent_seq: None, observed_seq: None }).unwrap();
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

#[test]
fn atomic_snapshots_and_durable_rejection_rebase_preserve_confirmed_images() {
    let source = "table items:\n  group: text <=10\n  value: int\n  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public\nmaintain sums: sum items of value by group\n  read <- allow\nquery row(id: id):\n  return items[id] by byId\nquery total():\n  return sums['g'] by byGroup\nmutation first():\n  update items['a'] {value: 99}\n  delete items['b']\nmutation later():\n  old = items['a'] by byId\n  require old != null else MISSING\n  update items['a'] {value: old.value + 1}\nmutation many():\n  for n in range(0, 12):\n    insert items {group: 'g', value: n}\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p|p.program.clone())).unwrap();
    engine.seed([("items".into(), snapback4_core::value::object([("id",id("a")),("group",Value::String("g".into())),("value",Value::Int(1))])),("items".into(),snapback4_core::value::object([("id",id("b")),("group",Value::String("g".into())),("value",Value::Int(20))]))]).unwrap();
    let backend = Backend { generation:engine.generation(),schema:bound.schema,programs:bound.programs.into_iter().map(|p|p.program).collect() };
    let dir=std::env::temp_dir().join(format!("sb4-native-atomic-{}",std::process::id()));std::fs::create_dir_all(&dir).unwrap();let path=dir.join("store.sqlite");let _=std::fs::remove_file(&path);
    let mut device=Device::open(&path,Some(backend)).unwrap();
    for(n,page)in snapshot_pages(&mut engine,"dev:alice",100).iter().enumerate(){device.apply(page,n==0).unwrap();}
    let watermark=device.state().unwrap().0;
    // A different process may send a write after our HTTP request captured
    // its pending IDs. Its durable revision invalidates that response under
    // the same transaction that would replace confirmed rows.
    let captured = device.sync_state().unwrap();
    let mut sender = Device::open(&path, None).unwrap();
    sender.begin_send().unwrap();
    let mut stale = stream_page(&mut engine, "dev:alice", watermark);
    stale.send_revision = Some(captured.send_revision);
    assert!(device.apply(&stale, false).is_err());
    assert_eq!(device.state().unwrap().0, watermark);
    let staged = snapshot_pages(&mut engine, "dev:alice", 1);
    device.apply(&staged[0], true).unwrap();
    sender.begin_send().unwrap();
    let mut continuation = staged[1].clone();
    continuation.send_revision = Some(sender.sync_state().unwrap().send_revision);
    assert!(device.apply(&continuation, false).is_err(), "a newer per-page capture cannot bless an older staged snapshot");
    for (n, page) in staged.iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    drop(sender);

    let queue=|op:&str,seq|Queued{id:format!("w{seq}"),seq,op:op.into(),args:serde_json::json!({}),new_ids:vec![],predicted:vec![],viewer:"dev:alice".into(),now:2000,predictable:true,sent_seq:None,observed_seq:None};
    device.admit(queue("first",1)).unwrap();device.admit(queue("later",2)).unwrap();
    assert_eq!(device.query("row","dev:alice",&serde_json::json!({"id":"a"}),2000).unwrap().data.field("value").unwrap(),&Value::Int(100));
    // Reopen before rejection: both the base images and ordered overlay survive.
    drop(device);let mut device=Device::open(&path,None).unwrap();device.settle("w1",None).unwrap();
    assert_eq!(device.queued().unwrap().len(),1);
    assert_eq!(device.query("row","dev:alice",&serde_json::json!({"id":"a"}),2000).unwrap().data.field("value").unwrap(),&Value::Int(2));
    assert_eq!(device.query("row","dev:alice",&serde_json::json!({"id":"b"}),2000).unwrap().data.field("value").unwrap(),&Value::Int(20));
    assert_eq!(device.query("total","dev:alice",&serde_json::json!({}),2000).unwrap().data,Value::Int(22));
    device.settle("w2",None).unwrap();
    let pages=snapshot_pages(&mut engine,"dev:alice",1);
    assert!(pages.len()>1);device.apply(&pages[0],true).unwrap();
    let sql=rusqlite::Connection::open(&path).unwrap();
    sql.execute_batch("CREATE TRIGGER fail_snapshot BEFORE INSERT ON r BEGIN SELECT RAISE(ABORT, 'snapshot failed'); END;").unwrap();
    for page in &pages[1..pages.len()-1]{device.apply(page,false).unwrap();}
    assert!(device.apply(pages.last().unwrap(),false).is_err());
    assert_eq!(device.state().unwrap().0,watermark);
    assert_eq!(device.query("row","dev:alice",&serde_json::json!({"id":"b"}),2000).unwrap().data.field("value").unwrap(),&Value::Int(20));
    sql.execute_batch("DROP TRIGGER fail_snapshot").unwrap();device.apply(pages.last().unwrap(),false).unwrap();
    assert!(device.apply(pages.last().unwrap(),false).is_err(), "a repeated final page cannot truncate the partition");
    let mut competing=Device::open(&path,None).unwrap();
    device.apply(&pages[0],true).unwrap();competing.apply(&pages[0],true).unwrap();
    assert!(device.apply(&pages[1],false).is_err(), "the superseded snapshot owner must restart");
    for page in &pages[1..]{competing.apply(page,false).unwrap();}
    assert_eq!(competing.query("row","dev:alice",&serde_json::json!({"id":"b"}),2000).unwrap().data.field("value").unwrap(),&Value::Int(20));
    drop(competing);
    // A program minting more than a guessed small preallocation persists
    // every actual id and retains those exact rows across replay/reopen.
    let admitted=device.admit(queue("many",3)).unwrap();assert_eq!(admitted.new_ids.len(),12);
    assert_eq!(admitted.new_ids.iter().collect::<std::collections::BTreeSet<_>>().len(),12);
    let ids=admitted.new_ids.clone();drop(device);let mut device=Device::open(&path,None).unwrap();
    device.apply(&stream_page(&mut engine,"dev:alice",watermark),false).unwrap();
    assert_eq!(device.queued().unwrap()[0].new_ids,ids);
    for id in ids{assert_ne!(device.query("row","dev:alice",&serde_json::json!({"id":id}),2000).unwrap().data,Value::Null);}
    drop(device);drop(sql);std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn snapshot_catchup_publishes_one_consistent_base_before_replaying_writes() {
    let source = "table items:\n  value: int\n  read <- allow\n  update <- allow\n  sync public\nquery row(id: id):\n  return items[id] by byId\nmutation inc(id: id):\n  row = items[id] by byId\n  require row != null else MISSING\n  update items[id] {value: row.value + 1}\n  return null\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    engine.seed(["a", "z"].map(|key| ("items".into(), snapback4_core::value::object([("id",id(key)),("value",Value::Int(0))])))).unwrap();
    let backend = Backend { generation: engine.generation(), schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() };
    let dir = std::env::temp_dir().join(format!("sb4-snapshot-catchup-{}",std::process::id())); std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("store.sqlite"); let _ = std::fs::remove_file(&path);
    let mut device = Device::open(&path,Some(backend)).unwrap();
    for (n,page) in snapshot_pages(&mut engine,"dev:alice",100).iter().enumerate() { device.apply(page,n==0).unwrap(); }
    let mut sender = Device::open(&path,None).unwrap();
    sender.admit(Queued { id:"pending-inc".into(),seq:1,op:"inc".into(),args:serde_json::json!({"id":"z"}),new_ids:vec![],predicted:vec![],viewer:"dev:alice".into(),now:2,predictable:true,sent_seq:None,observed_seq:None }).unwrap();
    sender.begin_send().unwrap();
    let capture = device.sync_state().unwrap();
    let (events,pinned,mut after) = engine.snapshot_page("dev:alice",None,1).unwrap();
    let mut page: StreamPage = serde_json::from_value(serde_json::json!({"snapshot":true,"events":events.into_iter().map(|e|serde_json::json!({"table":e.table,"kind":e.kind.word(),"id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),"watermark":pinned,"more":true,"stage_snapshot":true,"send_revision":capture.send_revision})).unwrap();
    device.apply(&page,true).unwrap();
    // The send began before capture; it commits between snapshot pages. A
    // second commit changes an already-staged row, so both directions need
    // the log before a coherent base can be published.
    let sent = engine.mutate("inc",Some("pending-inc"),Context::new("dev:alice",args(&[("id",id("z"))])).at(2)).unwrap();
    let WriteState::Sent { seq, .. } = sent.state else { panic!("expected sent") };
    engine.mutate("inc",None,Context::new("dev:alice",args(&[("id",id("a"))])).at(3)).unwrap();
    while let Some(token) = after {
        let (events,wm,next) = engine.snapshot_page("dev:alice",Some(&token),1).unwrap();
        page = serde_json::from_value(serde_json::json!({"snapshot":true,"events":events.into_iter().map(|e|serde_json::json!({"table":e.table,"kind":e.kind.word(),"id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),"watermark":wm,"more":next.is_some(),"stage_snapshot":true,"send_revision":capture.send_revision})).unwrap();
        device.apply(&page,false).unwrap(); after=next;
    }
    assert_eq!(device.query("row","dev:alice",&serde_json::json!({"id":"a"}),3).unwrap().data.field("value").unwrap(),&Value::Int(0),"the old base stays visible until catch-up drains");
    let mut from = pinned;
    loop {
        let streamed = engine.stream("dev:alice",from,1).unwrap();
        let mut page = stream_page(&mut engine,"dev:alice",from);
        // Exercise the bounded multi-page path, not stream_page's large limit.
        page.events = streamed.events.into_iter().map(|e|snapback4_device::native::StreamEvent { table:e.table,kind:e.kind,id:e.id,data:e.data.as_ref().map(snapback4_core::wire::to_json) }).collect();
        page.watermark=streamed.watermark; page.more=streamed.more; page.snapshot_catchup=true; page.send_revision=Some(capture.send_revision);
        page.acknowledged=engine.acknowledged("dev:alice",&capture.pending_ids,page.watermark).unwrap();
        device.apply(&page,false).unwrap(); from=page.watermark; if !page.more { break; }
    }
    for key in ["a","z"] { assert_eq!(device.query("row","dev:alice",&serde_json::json!({"id":key}),3).unwrap().data.field("value").unwrap(),&Value::Int(1)); }
    assert_eq!(device.queued().unwrap().len(),1,"keep retrying for the lost full mutation reply");
    device.settle("pending-inc",Some(seq)).unwrap(); assert!(device.queued().unwrap().is_empty());
    drop(sender);drop(device);std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn pending_metadata_reprediction_survives_updates_upserts_scans_and_offline_reopen() {
    let source = include_str!("fixtures/pending-metadata.q");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    engine.seed([("people".into(), snapback4_core::value::object([
        ("id", id("alice")), ("name", Value::String("Alice".into())), ("bio", Value::String("Confirmed bio".into())),
    ]))]).unwrap();
    let backend = Backend { generation: engine.generation(), schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() };
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("sb4-pending-metadata-{}-{nonce}", std::process::id()));
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join("device.sqlite");
    let mut device = Device::open(&path, Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "dev:alice", 10).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let commands = [
        ("profile", serde_json::json!({"person":"alice","name":"Offline Alice","bio":"Saved bio"})),
        ("profile", serde_json::json!({"person":"alice","name":"Final Alice","bio":"Final bio"})),
        ("vote", serde_json::json!({"person":"alice","answer":"answer","direction":1})),
        ("vote", serde_json::json!({"person":"alice","answer":"answer","direction":-1})),
        ("updateVote", serde_json::json!({"person":"alice","answer":"answer","direction":1})),
        ("scanVote", serde_json::json!({"direction":-1})),
    ];
    let person_args = serde_json::json!({"person":"alice"});
    for (n, (op, input)) in commands.iter().enumerate() {
        let seq = n as u64 + 1;
        device.admit(Queued { id:format!("write-{seq}"),seq,op:(*op).into(),args:input.clone(),new_ids:vec![],predicted:vec![],viewer:"dev:alice".into(),now:seq as i64,predictable:true,sent_seq:None,observed_seq:None }).unwrap();
        let person = device.query("person", "dev:alice", &person_args, 10).unwrap().data;
        assert_eq!(person.field("pending").unwrap(), &Value::Bool(true), "mutation reads must not erase the card");
        if n >= 2 {
            let total = device.query("voteTotal", "dev:alice", &serde_json::json!({"answer":"answer"}), 10).unwrap().data;
            assert_eq!(total, Value::Int(if n % 2 == 0 { 1 } else { -1 }));
        }
    }
    let queued = device.queued().unwrap();
    assert_eq!(queued.len(), commands.len());
    drop(device);
    device = Device::open(&path, None).unwrap();
    assert_eq!(device.queued().unwrap(), queued, "submission order, arguments and minted IDs survive offline reopen");
    // Match native hosts that explicitly predict their durable queue on open.
    for entry in &queued {
        device.predict(&entry.op, &entry.viewer, &entry.args, entry.now, entry.new_ids.clone(), entry.seq).unwrap();
    }
    assert_eq!(device.queued().unwrap(), queued, "re-prediction must not mutate the outbox");
    let person = device.query("person", "dev:alice", &person_args, 10).unwrap().data;
    assert_eq!(person.field("name").unwrap(), &Value::String("Final Alice".into()));
    assert_eq!(person.field("bio").unwrap(), &Value::String("Final bio".into()));
    let votes = device.query("voteRows", "dev:alice", &serde_json::json!({}), 10).unwrap().data;
    assert_eq!(votes.as_array().unwrap().len(), 1);
    assert_eq!(votes.as_array().unwrap()[0].field("direction").unwrap(), &Value::Int(-1));
    assert_eq!(votes.as_array().unwrap()[0].field("pending").unwrap(), &Value::Bool(true));
    let total = device.query("voteTotal", "dev:alice", &serde_json::json!({"answer":"answer"}), 10).unwrap().data;
    assert_eq!(total, Value::Int(-1), "replay must not double-count the maintained total");
    // Stripping trusted read metadata is not permission to author unknown fields.
    for extra in ["pending", "unexpected"] {
        let row = snapback4_core::value::object([("id", id("alice")),("name",Value::String("Alice".into())),("bio",Value::String("bio".into())),(extra,Value::Bool(true))]);
        let error = snapback4_core::engine::validate::validate_row(device.schema(), "people", &row).unwrap_err();
        assert_eq!(error.code(), "E_INPUT");
        assert!(error.to_string().contains(&format!("undeclared field {extra}")));
    }
    let watermark = device.state().unwrap().0;
    for entry in &queued {
        let typed = entry.args.as_object().unwrap().iter().map(|(name, value)| {
            let value = match value {
                serde_json::Value::String(value) if name == "person" => id(value),
                serde_json::Value::String(value) => Value::String(value.clone()),
                serde_json::Value::Number(value) => Value::Int(value.as_i64().unwrap()),
                _ => panic!("unexpected fixture argument"),
            };
            (name.clone(), value)
        }).collect();
        let sent = engine.mutate(&entry.op, Some(&entry.id), Context::new(&entry.viewer, typed).at(entry.now).with_ids(entry.new_ids.clone())).unwrap();
        let WriteState::Sent { seq, .. } = sent.state else { panic!("server refused the admitted fixture") };
        device.settle(&entry.id, Some(seq)).unwrap();
    }
    device.apply(&stream_page(&mut engine, "dev:alice", watermark), false).unwrap();
    assert!(device.queued().unwrap().is_empty());
    for (op, input) in [("person",person_args)] {
        let row = device.query(op, "dev:alice", &input, 10).unwrap().data;
        assert!(row.field("pending").is_err(), "the authoritative image replaces pending metadata");
    }
    let votes = device.query("voteRows", "dev:alice", &serde_json::json!({}), 10).unwrap().data;
    assert!(votes.as_array().unwrap()[0].field("pending").is_err());
    drop(device);
    std::fs::remove_dir_all(dir).unwrap();
}
