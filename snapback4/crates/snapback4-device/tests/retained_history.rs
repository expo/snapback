//! Retention across acquisition and revocation on the native and web stores,
//! with the real engine producing the membership and history pages.
mod common;

use common::*;
use snapback4_core::{Engine, engine::WriteState, value::{Value, object}};
use snapback4_device::{device::{Backend, Device, StreamPage}, store::DeviceStore};

trait PhysicalRows: DeviceStore { fn message_count(&self) -> usize; }
impl PhysicalRows for snapback4_core::store::Store {
    fn message_count(&self) -> usize { self.rows("messages").unwrap().len() }
}
impl PhysicalRows for snapback4_device::memory::MemoryStore {
    fn message_count(&self) -> usize {
        self.export().iter().filter(|change| change.s == 'r' && serde_json::from_str::<(String, String)>(&change.k).unwrap().0 == "messages").count()
    }
}

const SOURCE: &str = r#"
table directory:
  number: int
  read <- allow
  sync public
table conversations:
  title: text <=40
  read <- exists members[.id, viewer]
  retain delivered-history
  sync to members[.id]
table members:
  conversationId: conversations
  principal: principal
  until: time ?
  unique byConversationPrincipal: conversationId, principal
  by byPrincipal: principal, conversationId
  by byExpiry: until
  expire at .until
  immutable conversationId, principal
  read <- exists members[.conversationId, viewer]
  insert <- exists members[.conversationId, viewer]
  delete <- exists members[.conversationId, viewer]
  retain delivered-history
  sync to members[.conversationId]
table messages:
  conversationId: conversations
  at: time
  body: text <=40
  by byTime: conversationId, at, id
  immutable conversationId
  read <- exists members[.conversationId, viewer]
  insert <- exists members[.conversationId, viewer]
  update <- exists members[.conversationId, viewer]
  delete <- exists members[.conversationId, viewer]
  retain delivered-history
  sync to members[.conversationId] last 25 by byTime
table temporary:
  conversationId: conversations
  by byConversation: conversationId, id
  read <- exists members[.conversationId, viewer]
  sync to members[.conversationId]
query history(conversationId: conversations):
  return messages[conversationId] last 50 by byTime
query recent(conversationId: conversations, c: cursor ?):
  return messages[conversationId] after c last 10 by byTime
query interrupted(conversationId: conversations, c: cursor ?):
  result = []
  for m in messages[conversationId, at >= 22] after c last 5 by byTime:
    result = result + [m]
    break
  return result
query exhaustedScalar(conversationId: conversations, c: cursor ?):
  rows = messages[conversationId, at >= 21] after c last 5 by byTime
  return count(rows)
query across():
  return messages[] first 50 by byId
query temporary():
  return temporary[] first 50 by byId
mutation join(until: time ?):
  insert members {conversationId: 'g', principal: 'dev:bob', until}
mutation leave():
  delete members[conversationId = 'g', principal = 'dev:bob']
mutation send(at: time):
  insert messages {conversationId: 'g', at, body: 'new'}
mutation edit(id: messages):
  update messages[id] {body: 'edited'}
mutation erase(id: messages):
  delete messages[id]
"#;

fn write(engine: &mut Engine, op: &str, nonce: &str, now: i64, values: &[(&str, Value)]) {
    let result = engine.mutate(op, Some(nonce), context("dev:alice", values).at(now).with_ids([nonce.into()])).unwrap();
    assert!(matches!(result.state, WriteState::Sent { .. }), "{result:?}");
}

fn fixture(horizon: bool, until: Value) -> (Engine, Backend, u64) {
    let source = if horizon { SOURCE.to_owned() } else { SOURCE.replace(" last 25 by byTime", "") };
    let (mut engine, backend) = compile(&source);
    let mut seed = vec![
        ("conversations".into(), object([("id", id("g")), ("title", Value::String("Group".into()))])),
        ("members".into(), object([("id", id("alice")), ("conversationId", id("g")), ("principal", id("dev:alice")), ("until", Value::Null)])),
        ("temporary".into(), object([("id", id("temp")), ("conversationId", id("g"))])),
    ];
    for n in 0..26 {
        seed.push(("messages".into(), object([("id", id(&format!("m{n:02}"))), ("conversationId", id("g")), ("at", Value::Int(n)), ("body", Value::String("old".into()))])));
    }
    // Unrelated held rows force replacement after a leave to remain paged.
    for n in 0..15 {
        seed.push(("directory".into(), object([("id", id(&format!("d{n:02}"))), ("number", Value::Int(n))])));
    }
    engine.seed(seed).unwrap();
    let before_join = engine.seq().unwrap();
    write(&mut engine, "join", "bob", 100, &[("until", until)]);
    let backend = Backend { generation: engine.generation(), ..backend };
    (engine, backend, before_join)
}

fn snapshot(engine: &mut Engine, now: i64) -> Vec<StreamPage> {
    let mut after = None;
    let mut pages = Vec::new();
    loop {
        let (events, watermark, next, held) = engine.snapshot_page_with_groups_at("dev:bob", after.as_deref(), 7, now).unwrap();
        pages.push(serde_json::from_value(serde_json::json!({
            "snapshot": true, "held": held, "watermark": watermark, "more": next.is_some(), "next": next,
            "generation": engine.generation(), "events": events.iter().map(|e| serde_json::json!({
                "table": e.table, "kind": e.kind.word(), "id": e.id, "data": e.data.as_ref().map(snapback4_core::wire::to_json),
            })).collect::<Vec<_>>(),
        })).unwrap());
        match next { Some(next) => after = Some(next), None => return pages }
    }
}

fn stream(engine: &mut Engine, watermark: u64, now: i64) -> StreamPage {
    let page = engine.stream_at("dev:bob", watermark, 1_000, now).unwrap();
    serde_json::from_value(serde_json::json!({
        "snapshot": false, "joined": page.joined, "watermark": page.watermark, "more": page.more, "generation": engine.generation(),
        "events": page.events.iter().map(|e| serde_json::json!({"table": e.table, "kind": e.kind, "id": e.id, "data": e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),
    })).unwrap()
}

fn observation<S: PhysicalRows>(device: &mut Device<S>, label: &str, path: &str, now: i64) -> (usize, bool) {
    let (read, unknown, retained) = device.query_with_coverage("history", "dev:bob", &serde_json::json!({"conversationId":"g"}), now);
    let read = read.unwrap();
    let count = read.data.as_array().unwrap().len();
    let physical = device.store().message_count();
    assert_eq!(count, physical, "{label}/{path}: physical rows differ from the local read");
    println!("{label}/{path}: rows={count}, physical={physical}, complete={}, unknown={unknown}, retained={retained}", read.complete);
    if retained { assert!(!unknown); }
    (count, read.complete)
}

fn retention<H: Host>(host: &mut H, horizon: bool) where H::Store: PhysicalRows {
    let label = host.label();
    let expected = (if horizon { 25 } else { 26 }, !horizon);
    let mut observed = Vec::new();
    for path in ["live", "resnapshot", "catchup", "catchup-left", "expiry"] {
        let (mut engine, backend, before_join) = fixture(horizon, if path == "expiry" { Value::Int(200) } else { Value::Null });
        let mut device = host.open(path, Some(backend)).unwrap();
        let joined = stream(&mut engine, before_join, 100);
        device.apply(&joined, false).unwrap();
        assert_eq!(observation(&mut device, label, &format!("{path}/before"), 100), expected);
        if path == "catchup" {
            for (i, mut page) in snapshot(&mut engine, 100).into_iter().enumerate() {
                page.stage_snapshot = true;
                device.apply(&page, i == 0).unwrap();
            }
        }
        if path != "expiry" { write(&mut engine, "leave", "leave", 150, &[]); }
        let now = if path == "expiry" { 200 } else { 150 };
        if path == "resnapshot" || path == "catchup-left" {
            let pages = snapshot(&mut engine, now);
            assert!(pages.len() > 1, "replacement after leaving is paged too");
            for (i, mut page) in pages.into_iter().enumerate() {
                page.stage_snapshot = path == "catchup-left";
                device.apply(&page, i == 0).unwrap();
                if page.more {
                    assert_eq!(device.query("history", "dev:bob", &serde_json::json!({"conversationId":"g"}), now).unwrap().data.as_array().unwrap().len(), expected.0, "partial snapshot stays private");
                }
            }
            if path == "catchup-left" {
                let head = engine.seq().unwrap();
                let mut page = stream(&mut engine, head, now);
                page.snapshot_catchup = true;
                device.apply(&page, false).unwrap();
            }
        } else {
            let mut page = stream(&mut engine, joined.watermark, now);
            assert!(page.events.iter().any(|e| e.table == "messages" && e.kind == "scope"), "{path}: {:?}", page.events);
            assert!(!page.events.iter().any(|e| e.table == "messages" && e.kind == "put"), "revoked images stay off the wire");
            page.snapshot_catchup = path == "catchup";
            device.apply(&page, false).unwrap();
        }
        observed.push((path, observation(&mut device, label, &format!("{path}/after"), now)));
        retained_answer(&mut device, true, now);
        let (_, unknown, retained) = device.query_with_coverage("across", "dev:bob", &serde_json::json!({}), now);
        assert!(!retained, "unscoped scans keep their existing behavior");
        assert_eq!(unknown, horizon);
        let temporary = device.query("temporary", "dev:bob", &serde_json::json!({}), now).unwrap();
        assert!(temporary.data.as_array().unwrap().is_empty());
        let server = engine.query("history", context("dev:bob", &[("conversationId", id("g"))]).at(now)).unwrap();
        assert!(server.data.as_array().unwrap().is_empty() && server.complete);
        host.close(path, device);
        let mut device = host.open(path, None).unwrap();
        observed.push((path, observation(&mut device, label, &format!("{path}/reopen"), now)));
        retained_answer(&mut device, true, now);
        host.close(path, device);
    }
    assert!(observed.iter().all(|(_, read)| *read == expected), "{label}, horizon={horizon}: expected {expected:?}; {observed:?}");
}

#[test]
fn retained_history_with_horizon_sqlite() { retention(&mut Sqlite::new("retention"), true); }
#[test]
fn retained_history_with_horizon_memory() { retention(&mut Memory::new(), true); }
#[test]
fn retained_history_without_horizon_sqlite() { retention(&mut Sqlite::new("retention"), false); }
#[test]
fn retained_history_without_horizon_memory() { retention(&mut Memory::new(), false); }

fn rejoin<H: Host>(host: &mut H) where H::Store: PhysicalRows {
    let label = host.label();
    let (mut engine, backend, _) = fixture(true, Value::Null);
    let mut device = host.open("rejoin", Some(backend)).unwrap();
    let pages = snapshot(&mut engine, 100);
    assert!(pages.len() > 1);
    for (i, page) in pages.iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    assert_eq!(observation(&mut device, label, "rejoin/before", 100), (25, false));
    let from = device.state().unwrap().0;
    write(&mut engine, "leave", "leave", 150, &[]);
    device.apply(&stream(&mut engine, from, 150), false).unwrap();
    write(&mut engine, "send", "new", 160, &[("at", Value::Int(26))]);
    write(&mut engine, "edit", "edit", 160, &[("id", id("m25"))]);
    let from = device.state().unwrap().0;
    let hidden = stream(&mut engine, from, 160);
    assert!(!hidden.events.iter().any(|e| e.table == "messages" && e.kind == "put"));
    device.apply(&hidden, false).unwrap();
    assert_eq!(observation(&mut device, label, "rejoin/left", 160), (25, false));
    retained_answer(&mut device, true, 160);
    write(&mut engine, "join", "rejoined", 170, &[("until", Value::Null)]);
    let page = stream(&mut engine, hidden.watermark, 170);
    assert_eq!(page.events.iter().filter(|e| e.table == "messages" && e.kind == "put").count(), 25, "rejoin acquisition stays bounded");
    device.apply(&page, false).unwrap();
    device.apply(&page, false).unwrap();
    assert_eq!(observation(&mut device, label, "rejoin/after-duplicate", 170), (26, false));
    retained_answer(&mut device, false, 170);
    for (i, page) in snapshot(&mut engine, 170).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    assert_eq!(observation(&mut device, label, "rejoin/resnapshot", 170), (25, false));
    let read = device.query("history", "dev:bob", &serde_json::json!({"conversationId":"g"}), 170).unwrap();
    let rows = read.data.as_array().unwrap();
    let ids: std::collections::BTreeSet<_> = rows.iter().map(|row| row.field("id").unwrap().as_str().unwrap()).collect();
    assert_eq!(ids.len(), 25);
    assert!(!ids.contains("m00"), "the undelivered oldest row stays absent");
    assert!(!ids.contains("m01"), "a held group replacement is authoritative within its acquisition horizon");
    assert_eq!(rows.iter().find(|row| row.field("id").unwrap() == &id("m25")).unwrap().field("body").unwrap().as_str().unwrap(), "edited");
    let recent = device.query("recent", "dev:bob", &serde_json::json!({"conversationId":"g","c":null}), 170).unwrap();
    assert!(recent.complete && recent.data.as_array().unwrap().len() == 10);
    host.close("rejoin", device);
}

fn confirmed_only<H: Host>(host: &mut H) where H::Store: PhysicalRows {
    let label = host.label();
    let (mut engine, backend, before_join) = fixture(true, Value::Null);
    let mut device = host.open("confirmed", Some(backend)).unwrap();
    device.apply(&stream(&mut engine, before_join, 100), false).unwrap();
    device.predict("edit", "dev:bob", &serde_json::json!({"id":"m25"}), 110, vec![], 1).unwrap();
    device.predict("erase", "dev:bob", &serde_json::json!({"id":"m24"}), 110, vec![], 1).unwrap();
    device.predict("send", "dev:bob", &serde_json::json!({"at":30}), 110, vec!["pending".into()], 1).unwrap();
    write(&mut engine, "leave", "leave", 150, &[]);
    for (i, page) in snapshot(&mut engine, 150).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    assert_eq!(observation(&mut device, label, "confirmed/resnapshot", 150), (25, false));
    let read = device.query("history", "dev:bob", &serde_json::json!({"conversationId":"g"}), 150).unwrap();
    assert!(read.data.as_array().unwrap().iter().all(|row| row.field("body").unwrap().as_str().unwrap() == "old"));
    assert!(!read.data.as_array().unwrap().iter().any(|row| row.field("id").unwrap() == &id("pending")));
    host.close("confirmed", device);

    let (mut engine, backend, before_join) = fixture(true, Value::Null);
    let mut device = host.open("deleted", Some(backend)).unwrap();
    let joined = stream(&mut engine, before_join, 100);
    device.apply(&joined, false).unwrap();
    for (i, mut page) in snapshot(&mut engine, 100).into_iter().enumerate() {
        page.stage_snapshot = true;
        device.apply(&page, i == 0).unwrap();
    }
    write(&mut engine, "erase", "erase", 120, &[("id", id("m25"))]);
    write(&mut engine, "leave", "leave", 150, &[]);
    let mut catchup = stream(&mut engine, joined.watermark, 150);
    assert!(catchup.events.iter().any(|e| e.table == "messages" && e.kind == "del" && e.id == "m25"));
    catchup.snapshot_catchup = true;
    device.apply(&catchup, false).unwrap();
    assert_eq!(observation(&mut device, label, "confirmed/deletion", 150), (24, false));
    for (i, page) in snapshot(&mut engine, 150).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    assert_eq!(observation(&mut device, label, "confirmed/deletion-resnapshot", 150), (24, false));
    host.close("deleted", device);
}

#[test]
fn retained_history_rejoin_sqlite() { rejoin(&mut Sqlite::new("rejoin")); }
#[test]
fn retained_history_rejoin_memory() { rejoin(&mut Memory::new()); }
#[test]
fn retained_history_confirmed_only_sqlite() { confirmed_only(&mut Sqlite::new("confirmed")); }
#[test]
fn retained_history_confirmed_only_memory() { confirmed_only(&mut Memory::new()); }

fn media_scope<H: Host>(host: &mut H) {
    let (_, backend) = compile("table photos:\n  owner: principal\n  photo: image <=100000\n  by byOwner: owner, id\n  read <- .owner = viewer\n  retain delivered-history\n  sync to .owner last 1 by byOwner\nquery photo(id: photos):\n  return photos[id]\n");
    let mut device = host.open("media", Some(backend)).unwrap();
    let mut page: StreamPage = serde_json::from_value(serde_json::json!({"snapshot":true,"events":[{
        "table":"photos", "id":"row", "kind":"put", "data":{"id":"row", "owner":"dev:bob",
        "photo":{"id":"asset","type":"image/png","bytes":26,"width":2,"height":3,"duration":null}}
    }],"watermark":1,"more":false})).unwrap();
    device.apply(&page, true).unwrap();
    assert_eq!(device.asset_home("asset", "dev:bob", 1).unwrap()["row"], "row");
    page.stage_snapshot = true;
    device.apply(&page, true).unwrap();
    let scope: StreamPage = serde_json::from_value(serde_json::json!({"snapshot":false,"snapshot_catchup":true,
        "events":[{"table":"photos","kind":"scope","id":"scope","data":["dev:bob"]}],"watermark":2,"more":false})).unwrap();
    device.apply(&scope, false).unwrap();
    assert_eq!(device.asset_home("asset", "dev:bob", 1).unwrap(), serde_json::Value::Null);
    let empty: StreamPage = serde_json::from_value(serde_json::json!({"snapshot":true,"events":[],"watermark":2,"more":false})).unwrap();
    device.apply(&empty, true).unwrap();
    assert_eq!(device.asset_home("asset", "dev:bob", 1).unwrap(), serde_json::Value::Null);
    assert_eq!(device.query("photo", "dev:bob", &serde_json::json!({"id":"row"}), 1).unwrap().data.field("id").unwrap(), &id("row"));
    // Reacquisition can activate the media home again.
    page.watermark = 3;
    page.stage_snapshot = false;
    device.apply(&page, true).unwrap();
    assert_eq!(device.asset_home("asset", "dev:bob", 1).unwrap()["row"], "row");
    host.close("media", device);
}

#[test]
fn retained_history_media_scope_sqlite() { media_scope(&mut Sqlite::new("media")); }
#[test]
fn retained_history_media_scope_memory() { media_scope(&mut Memory::new()); }

fn retained_answer<S: DeviceStore>(device: &mut Device<S>, expected: bool, now: i64) {
    let (read, unknown, retained) = device.query_with_coverage("history", "dev:bob", &serde_json::json!({"conversationId":"g"}), now);
    let read = read.unwrap();
    assert_eq!(retained, expected);
    assert_eq!(unknown, !expected && !read.complete);
}

fn collector_coverage<H: Host>(host: &mut H) {
    let (mut engine, backend, _) = fixture(true, Value::Null);
    let mut device = host.open("collector", Some(backend)).unwrap();
    for (n, page) in snapshot(&mut engine, 110).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let watermark = engine.seq().unwrap();
    write(&mut engine, "leave", "leave-collector", 120, &[]);
    device.apply(&stream(&mut engine, watermark, 120), false).unwrap();
    let args = serde_json::json!({"conversationId":"g", "c":null});
    let (read, unknown, retained) = device.query_with_coverage("interrupted", "dev:bob", &args, 130);
    let read = read.unwrap();
    assert_eq!(read.data.as_array().unwrap().len(), 1);
    assert!(!read.complete && read.next.is_none() && !unknown, "{read:?}");
    assert!(!retained, "a lost page is an independent incomplete reason");
    let (read, unknown, retained) = device.query_with_coverage("exhaustedScalar", "dev:bob", &args, 130);
    let read = read.unwrap();
    assert_eq!(read.data, Value::Int(5));
    assert!(!read.complete && read.next.is_none() && !unknown && retained, "only the retained horizon remains: {read:?}; unknown={unknown}, retained={retained}");
}

#[test]
fn interrupted_collector_is_not_only_retained_history_sqlite() { collector_coverage(&mut Sqlite::new("collector")); }
#[test]
fn interrupted_collector_is_not_only_retained_history_memory() { collector_coverage(&mut Memory::new()); }

fn missed_log<H: Host>(host: &mut H) where H::Store: PhysicalRows {
    for path in ["R1-held-deletion", "R2-unseen-removal", "R3-live-removal"] {
        let (mut engine, backend, before_join) = fixture(true, Value::Null);
        let mut device = host.open(path, Some(backend)).unwrap();
        let joined = stream(&mut engine, before_join, 100);
        device.apply(&joined, false).unwrap();
        assert_eq!(observation(&mut device, host.label(), &format!("{path}/before"), 100), (25, false));
        retained_answer(&mut device, false, 100);
        if path == "R1-held-deletion" {
            write(&mut engine, "erase", "erase-away", 150, &[("id", id("m25"))]);
        } else {
            write(&mut engine, "leave", "leave-away", 150, &[]);
            if path == "R3-live-removal" { device.apply(&stream(&mut engine, joined.watermark, 150), false).unwrap(); }
        }
        // Skip the log entirely. Only the first page's own-audience prefixes
        // distinguish an absent held row from an entire left group.
        let pages = snapshot(&mut engine, 150);
        assert!(pages.len() > 1);
        assert_eq!(pages[0].held.as_ref().unwrap()["messages"], if path == "R1-held-deletion" { vec![vec![serde_json::json!("g")]] } else { vec![] });
        assert!(pages.iter().skip(1).all(|page| page.held.is_none()));
        for (i, page) in pages.iter().enumerate() {
            device.apply(page, i == 0).unwrap();
            if page.more { retained_answer(&mut device, path == "R3-live-removal", 150); }
        }
        assert_eq!(observation(&mut device, host.label(), path, 150), (25, false));
        retained_answer(&mut device, path != "R1-held-deletion", 150);
        let read = device.query("history", "dev:bob", &serde_json::json!({"conversationId":"g"}), 150).unwrap();
        let ids: Vec<_> = read.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap()).collect();
        assert_eq!(ids.contains(&"m25"), path != "R1-held-deletion");
        assert_eq!(ids.contains(&"m00"), path == "R1-held-deletion", "held snapshots acquire the current horizon");
        if path != "R1-held-deletion" {
            assert!(!pages.iter().flat_map(|page| &page.events).any(|event| event.table == "messages"), "no revoked image on the wire");
            let (recent, unknown, retained) = device.query_with_coverage("recent", "dev:bob", &serde_json::json!({"conversationId":"g","c":null}), 150);
            assert!(recent.unwrap().complete && retained && !unknown);
        }
        host.close(path, device);
        let mut device = host.open(path, None).unwrap();
        retained_answer(&mut device, path != "R1-held-deletion", 150);
        host.close(path, device);
    }
}

#[test]
fn missed_log_sqlite() { missed_log(&mut Sqlite::new("missed")); }
#[test]
fn missed_log_memory() { missed_log(&mut Memory::new()); }

fn removal_between_pages<H: Host>(host: &mut H) where H::Store: PhysicalRows {
    let (mut engine, backend, before_join) = fixture(true, Value::Null);
    let mut device = host.open("between", Some(backend)).unwrap();
    let joined = stream(&mut engine, before_join, 100);
    device.apply(&joined, false).unwrap();
    let mut first = snapshot(&mut engine, 100).remove(0);
    assert!(!first.events.iter().any(|event| event.table == "messages"));
    first.stage_snapshot = true;
    device.apply(&first, true).unwrap();
    write(&mut engine, "leave", "leave-between", 150, &[]);
    let mut after = first.next;
    while let Some(cursor) = after {
        let (events, watermark, next, held) = engine.snapshot_page_with_groups_at("dev:bob", Some(&cursor), 7, 150).unwrap();
        assert!(held.is_none());
        assert!(!events.iter().any(|event| event.table == "messages"));
        let page = serde_json::from_value(serde_json::json!({"snapshot":true,"stage_snapshot":true,"watermark":watermark,"more":next.is_some(),"next":next,
            "events":events.iter().map(|event| serde_json::json!({"table":event.table,"kind":event.kind.word(),"id":event.id,"data":event.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>() })).unwrap();
        device.apply(&page, false).unwrap();
        after = next;
    }
    retained_answer(&mut device, false, 150);
    let mut catchup = stream(&mut engine, joined.watermark, 150);
    catchup.snapshot_catchup = true;
    device.apply(&catchup, false).unwrap();
    assert_eq!(observation(&mut device, host.label(), "removal-between-pages", 150), (25, false));
    retained_answer(&mut device, true, 150);
    host.close("between", device);
}

#[test]
fn removal_between_pages_sqlite() { removal_between_pages(&mut Sqlite::new("between")); }
#[test]
fn removal_between_pages_memory() { removal_between_pages(&mut Memory::new()); }

fn empty_rejoin<H: Host>(host: &mut H) {
    let (mut engine, backend, _) = fixture(true, Value::Null);
    for n in 0..26 { write(&mut engine, "erase", &format!("erase-{n}"), 110, &[("id", id(&format!("m{n:02}")))]); }
    let mut device = host.open("empty", Some(backend)).unwrap();
    for (i, page) in snapshot(&mut engine, 110).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    retained_answer(&mut device, false, 110);
    write(&mut engine, "leave", "empty-leave", 120, &[]);
    // No message image can identify this formerly held group. The first
    // snapshot's prefix list, kept with the partition, still can.
    for (i, page) in snapshot(&mut engine, 120).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    retained_answer(&mut device, true, 120);
    let from = device.state().unwrap().0;
    write(&mut engine, "join", "empty-rejoin", 130, &[("until", Value::Null)]);
    let page = stream(&mut engine, from, 130);
    assert!(!page.events.iter().any(|event| event.table == "messages"));
    assert_eq!(page.joined["messages"], vec![vec![serde_json::json!("g")]]);
    device.apply(&page, false).unwrap();
    retained_answer(&mut device, false, 130);
    host.close("empty", device);
}

#[test]
fn empty_rejoin_sqlite() { empty_rejoin(&mut Sqlite::new("empty")); }
#[test]
fn empty_rejoin_memory() { empty_rejoin(&mut Memory::new()); }
