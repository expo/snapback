//! Revision 12 event state is carried by its source, on both device stores.
mod common;
use common::{args, id, BoundaryMetadata, Host, Memory, Sqlite, snapshot_pages};
use serde_json::json;
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_device::{device::{Backend, Device}, store::DeviceStore};

const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/following-view.q");
fn source(posts: &str, reposts: &str) -> String {
    SOURCE.replacen("sync public", posts, 1)
        .replace("sync public\n\ntable follows", &format!("{reposts}\n\ntable follows")) + r#"
query event(eventId: id):
  return feedPosts[eventId]
query events():
  return feedPosts last 100 by .at
query original(actor: principal, postId: id):
  return feedPosts[actor, postId, false]
mutation needsEvent(eventId: id):
  require exists feedPosts[eventId] else NO_EVENT
mutation plainRepost(repostId: id, postId: posts):
  insert reposts { id: repostId, actorId: viewer, postId, at: now }
mutation backdated(postId: id, at: time):
  insert posts { id: postId, authorId: viewer, at }
"#
}
fn write(e: &mut Engine, op: &str, who: &str, input: &[(&str, Value)], at: i64) {
    let out = e.mutate(op, None, Context::new(who, args(input)).at(at)).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
}
fn post(e: &mut Engine, name: &str, at: i64) {
    write(e, "post", "alice", &[("postId", id(name)), ("parentId", Value::Null)], at);
}
fn acquire<S: DeviceStore>(d: &mut Device<S>, e: &mut Engine, who: &str) {
    for (i, page) in snapshot_pages(e, who, 5).iter().enumerate() { d.apply(page, i == 0).unwrap(); }
}
fn slot(row: &Value, name: &str, repost: bool) -> Value {
    row.field(&format!("$timeline:{name}:{}", if repost { "repost" } else { "post" })).unwrap().clone()
}
fn agree(e: &mut Engine) {
    for t in e.schema().timelines.clone() {
        let definition = e.schema().tables[&t.table("Posts")].indexes["byActorPost"].clone();
        for repost in [false, true] {
            for row in e.store().rows(t.source(repost)).unwrap() {
                let actor = row.field(if repost { &t.reposts[1] } else { &t.posts[1] }).unwrap();
                let post = row.field(if repost { &t.reposts[2] } else { "id" }).unwrap();
                let tx = e.store_mut().read_transaction().unwrap();
                let event = tx.lookup(&t.table("Posts"), "byActorPost", &definition, &[actor.clone(), post.clone(), Value::Bool(repost)]).unwrap();
                tx.rollback().unwrap();
                let expected = if repost { event.map(|event| event.field("id").unwrap().clone()).unwrap_or(Value::Null) } else { Value::Bool(event.is_some()) };
                assert_eq!(slot(&row, &t.name, repost), expected, "{row:?}");
            }
        }
    }
}
fn admit<S: DeviceStore>(d: &mut Device<S>, op: &str, who: &str, input: serde_json::Value, seq: u64) -> snapback4_device::device::Queued {
    d.admit(serde_json::from_value(json!({"id":format!("intent-{seq}"),"seq":seq,"op":op,"viewer":who,"args":input,"now":100,"predictable":true})).unwrap()).unwrap()
}

fn residency<H: Host>(mut host: H) {
    for (pi, posts) in ["sync public", "sync public last 2 by .at", "online only"].into_iter().enumerate() {
        for (ri, reposts) in ["sync public", "sync public last 2 by .at", "online only"].into_iter().enumerate() {
            let (mut e, backend) = common::compile(&source(posts, reposts));
            for i in 0..4 { post(&mut e, &format!("p{i}"), i); }
            write(&mut e, "plainRepost", "bob", &[("repostId", id("r")), ("postId", id("p3"))], 8);
            agree(&mut e);
            let name = format!("{pi}-{ri}");
            let mut d = host.open(&name, Some(backend.clone())).unwrap();
            acquire(&mut d, &mut e, "bob");
            let rows = d.store().raw_rows("feedPosts");
            assert_eq!(rows.len(), 4 * usize::from(posts == "sync public") + usize::from(reposts == "sync public"));
            for row in d.store().raw_rows("posts") { assert_eq!(slot(&row, "feed", false), Value::Bool(true)); }
            for row in d.store().raw_rows("reposts") { assert_eq!(slot(&row, "feed", true), slot(&e.store().rows("reposts").unwrap()[0], "feed", true)); }
            let event = e.store().rows("feedPosts").unwrap().into_iter().find(|r| r.field("repost").unwrap() == &Value::Bool(true)).unwrap();
            let event_id = event.field("id").unwrap().as_str().unwrap();
            let page = d.query("events", "bob", &json!({}), 20).unwrap();
            assert_eq!(page.unavailable, posts != "sync public" || reposts != "sync public");
            let point = d.query("event", "bob", &json!({"eventId":event_id}), 20).unwrap();
            assert_eq!(point.unavailable, reposts != "sync public");
            let original = d.query("original", "bob", &json!({"actor":"alice","postId":"absent"}), 20).unwrap();
            assert_eq!(original.unavailable, posts != "sync public");
            if reposts != "sync public" { assert!(!admit(&mut d, "needsEvent", "bob", json!({"eventId":event_id}), 1).predictable); }
            drop(d);
        }
    }
}

fn transitions<H: Host>(mut host: H) {
    let (mut e, backend) = common::compile(&source("sync public last 2 by .at", "sync public last 2 by .at"));
    post(&mut e, "old", 1); post(&mut e, "live", 2); post(&mut e, "remove", 3);
    write(&mut e, "plainRepost", "alice", &[("repostId", id("r")), ("postId", id("live"))], 4);
    let mut d = host.open("alice", Some(backend)).unwrap(); acquire(&mut d, &mut e, "alice");
    let event = slot(&d.store().raw_rows("reposts")[0], "feed", true);
    let removed = admit(&mut d, "unrepost", "alice", json!({"postId":"live"}), 1);
    assert!(removed.predictable, "{removed:?}");
    assert!(d.store().raw_rows("feedPosts").is_empty());
    assert!(d.store().raw_rows("feedRemovedEvents").iter().any(|row| row.field("eventId").unwrap() == &event));
    let removed = admit(&mut d, "remove", "alice", json!({"postId":"remove"}), 2);
    assert!(removed.predictable, "{removed:?}");
    assert_eq!(slot(d.store().raw_rows("posts").iter().find(|r| r.field("id").unwrap() == &id("remove")).unwrap(), "feed", false), Value::Bool(false));
    assert!(!admit(&mut d, "remove", "alice", json!({"postId":"old"}), 3).predictable);
    let new = admit(&mut d, "plainRepost", "alice", json!({"repostId":"r2","postId":"live"}), 4);
    assert!(new.predictable, "{new:?}");
    assert!(d.store().raw_rows("feedPosts").is_empty());
    write(&mut e, "unrepost", "alice", &[("postId", id("live"))], 10);
    write(&mut e, "remove", "alice", &[("postId", id("remove"))], 11);
    agree(&mut e);
}

fn activation<H: Host>(mut host: H) {
    let text = source("sync public", "sync public");
    let bound = snapback4_lang::compile(&[("schema.q".into(), text)]);
    let mut legacy = bound.schema.clone();
    for table in legacy.tables.values_mut() { table.columns.retain(|name, _| !snapback4_core::schema::timeline::is_slot(name)); }
    let programs: Vec<_> = bound.programs.into_iter().map(|p| p.program).collect();
    let mut e = Engine::memory(legacy.clone(), programs.clone()).unwrap();
    post(&mut e, "live", 1);
    write(&mut e, "post", "alice", &[("postId", id("reply")), ("parentId", id("live"))], 2);
    write(&mut e, "plainRepost", "alice", &[("repostId", id("r")), ("postId", id("live"))], 3);
    let mut d = host.open("alice", Some(Backend { generation: e.generation(), schema: legacy.clone(), programs: programs.clone() })).unwrap();
    acquire(&mut d, &mut e, "alice");
    let mut next = bound.schema;
    let follows = next.tables.get_mut("follows").unwrap();
    follows.columns.insert("pinned".into(), snapback4_core::schema::ColumnType::Bool);
    follows.defaults.insert("pinned".into(), snapback4_core::schema::ColumnDefault::Literal(Value::Bool(false)));
    assert!(!snapback4_core::successor::keeps_literal_default_images(&legacy, &next));
    let mut only_repost = next.clone();
    only_repost.tables.get_mut("posts").unwrap().columns.remove("$timeline:feed:post");
    assert!(!snapback4_core::successor::keeps_literal_default_images(&legacy, &only_repost));
    let before = e.seq().unwrap();
    let steps = e.store_mut().successor(&next).unwrap();
    assert!(steps.iter().all(|s| s.change != snapback4_core::successor::Change::Narrowing), "{steps:?}");
    assert!(e.store().rows("posts").unwrap().iter().all(|r| r.field("$timeline:feed:post").is_err()), "read-only check never fills slots");
    let generation = e.adopt(next.clone(), programs.clone()).unwrap();
    assert_eq!(e.seq().unwrap(), before, "activation has no partition-log writes");
    agree(&mut e);
    d.adopt(Backend { generation, schema: next, programs }).unwrap();
    assert!(d.store().raw_rows("posts").is_empty());
    let pages = snapshot_pages(&mut e, "alice", 1);
    d.apply(&pages[0], true).unwrap();
    host.close("alice", d);
    let mut d = host.open("alice", None).unwrap();
    assert!(d.query("cards", "alice", &json!({"c":null}), 10).is_err());
    let queued = admit(&mut d, "repost", "alice", json!({"postId":"live"}), 1);
    assert!(!queued.predictable && queued.predicted.is_empty());
    acquire(&mut d, &mut e, "alice");
    assert_eq!(d.store().raw_rows("posts").len(), 2);
    assert_eq!(slot(d.store().raw_rows("posts").iter().find(|r| r.field("id").unwrap() == &id("reply")).unwrap(), "feed", false), Value::Bool(false));
}

macro_rules! stores { ($name:ident, $run:ident) => { mod $name { use super::*;
    #[test] fn memory() { $run(Memory::new()); }
    #[test] fn sqlite() { $run(Sqlite::new(stringify!($name))); }
} }; }
stores!(residencies, residency);
stores!(source_transitions, transitions);
stores!(interrupted_activation, activation);
