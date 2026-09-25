//! The acquisition floor withholds missing cards on both real device stores.
mod common;
use common::{args, id, BoundaryMetadata, Host, Memory, Sqlite, snapshot_pages};
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_device::device::Device;
use serde_json::json;
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/following-view.q");
fn source(sync: &str) -> String {
    SOURCE.replacen("sync public", sync, 2).replace("last 20 by .at", "last 2 by .at")
}
fn write(e: &mut Engine, op: &str, who: &str, input: &[(&str, Value)], at: i64) {
    let out = e.mutate(op, None, Context::new(who, args(input)).at(at)).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
}
fn post(e: &mut Engine, who: &str, name: &str, at: i64) {
    write(e, "post", who, &[("postId", id(name)), ("parentId", Value::Null)], at);
}
fn drain(e: &mut Engine) { while e.run_timeline_chunk(5000).unwrap().is_some() {} }
fn acquire<S: snapback4_device::store::DeviceStore>(d: &mut Device<S>, e: &mut Engine, who: &str) {
    for (n, page) in snapshot_pages(e, who, 37).iter().enumerate() { d.apply(page, n == 0).unwrap(); }
}

fn cards<H: Host>(mut host: H) {
    let (mut e, backend) = common::compile(&source("sync public last 3 by .at"));
    post(&mut e, "quiet", "old", 1);
    for n in 0..4 { post(&mut e, "alice", &format!("p{n}"), n + 10); }
    write(&mut e, "repost", "bob", &[("postId", id("old"))], 11);
    write(&mut e, "follow", "bob", &[("actor", id("alice"))], 20);
    drain(&mut e);
    let mut d = host.open("bob", Some(backend.clone())).unwrap();
    acquire(&mut d, &mut e, "bob");
    assert_eq!(d.store().raw_rows("posts").len(), 3);
    assert_eq!(d.store().raw_rows("feedPosts").len(), 6);
    let first = d.query("cards", "bob", &json!({"c":null}), 21).unwrap();
    assert!(first.complete && !first.unavailable, "{first:?}");
    assert_eq!(first.data.as_array().unwrap().len(), 2);
    let cursor = first.next.unwrap();
    let (local, unknown, _) = d.query_with_coverage("cards", "bob", &json!({"c":cursor}), 21);
    let local = local.unwrap();
    assert!(unknown && local.unavailable && !local.complete, "{local:?}");
    assert_eq!(local.data, Value::Null);
    assert!(local.next.is_none(), "no continuation past a missing card");
    let remote = e.query("cards", Context::new("bob", args(&[("c", Value::String(cursor))]))).unwrap();
    assert!(remote.complete);
    assert!(remote.data.as_array().unwrap().iter().any(|row| row.field("post").unwrap().field("id").unwrap() == &id("old")));
    let metadata = d.query("home", "bob", &json!({"c":null}), 21).unwrap();
    assert!(metadata.complete && !metadata.unavailable, "the inbox projection needs no card");

    // A quiet followed author is not covered by the global newest-N floor.
    write(&mut e, "follow", "reader", &[("actor", id("quiet"))], 22);
    drain(&mut e);
    let mut quiet = host.open("reader", Some(backend)).unwrap();
    acquire(&mut quiet, &mut e, "reader");
    assert!(quiet.query("home", "reader", &json!({"c":null}), 23).unwrap().complete);
    assert!(quiet.query("cards", "reader", &json!({"c":null}), 23).unwrap().unavailable);
    assert_eq!(e.query("cards", Context::new("reader", args(&[("c", Value::Null)]))).unwrap().data.as_array().unwrap().len(), 1);
}

fn prediction<H: Host>(mut host: H) {
    // Keep the repost pair's absence knowable. A horizon on reposts also
    // queues a missing unique pair under the existing insert-if-absent rule.
    let source = source("sync public").replacen("sync public", "sync public last 3 by .at", 1);
    let (mut e, backend) = common::compile(&source);
    for n in 0..5 { post(&mut e, "alice", &format!("p{n}"), n + 1); }
    drain(&mut e);
    let mut d = host.open("bob", Some(backend)).unwrap();
    acquire(&mut d, &mut e, "bob");
    for (seq, post, predicts) in [(1, "p0", false), (2, "p4", true)] {
        let entry = d.admit(serde_json::from_value(json!({"id":format!("repost-{seq}"),"seq":seq,"op":"repost","viewer":"bob","args":{"postId":post},"now":10,"predictable":true})).unwrap()).unwrap();
        assert_eq!(entry.predictable, predicts, "{entry:?}");
        assert_eq!(!entry.predicted.is_empty(), predicts);
    }
    let own = d.admit(serde_json::from_value(json!({"id":"own","seq":3,"op":"post","viewer":"bob","args":{"postId":"own","parentId":null},"now":11,"predictable":true})).unwrap()).unwrap();
    assert!(own.predictable && own.predicted.iter().any(|row| row.starts_with("feedFeed/")), "{own:?}");
    assert!(!d.query("cards", "bob", &json!({"c":null}), 12).unwrap().unavailable);
    host.close("bob", d);
    let mut d = host.open("bob", None).unwrap();
    assert_eq!(d.queued().unwrap().len(), 3, "prediction and unpredicted intent survive reopening");
    assert!(!d.query("cards", "bob", &json!({"c":null}), 12).unwrap().unavailable);
}

fn adoption<H: Host>(mut host: H) {
    let (mut e, backend) = common::compile(&source("sync public"));
    for n in 0..6 { post(&mut e, "alice", &format!("p{n}"), n + 1); }
    drain(&mut e);
    let mut d = host.open("alice", Some(backend)).unwrap();
    acquire(&mut d, &mut e, "alice");
    let copies = e.store().rows("feedFeed").unwrap();
    for (sync, held) in [("sync public last 3 by .at", 3), ("sync public", 6), ("online only", 0), ("sync public last 3 by .at", 3), ("online only", 0), ("sync public", 6)] {
        let old = e.generation();
        let (_, mut backend) = common::compile(&source(sync));
        backend.generation = e.adopt(backend.schema.clone(), backend.programs.clone()).unwrap();
        assert_eq!(backend.generation, old + 1);
        assert_eq!(e.store().rows("feedFeed").unwrap(), copies, "acquisition never reconstructs server history");
        d.adopt(backend).unwrap();
        assert!(d.store().raw_rows("posts").is_empty(), "no in-place trim");
        assert!(d.query("cards", "alice", &json!({"c":null}), 30).is_err(), "new generation must acquire first");
        acquire(&mut d, &mut e, "alice");
        assert_eq!(d.store().raw_rows("posts").len(), held);
        assert_eq!(d.store().raw_rows("feedPosts").len(), 6, "event absence stays knowable across every source residency");
        let page = d.query("cards", "alice", &json!({"c":null}), 30).unwrap();
        assert_eq!(page.unavailable, held == 0);
        assert_eq!(page.complete, held != 0);
    }
}

fn inbox<H: Host>(mut host: H) {
    let source = source("sync public") + "\nquery cut(c: cursor ?):\n  for i in range(0, 8):\n    burn = posts first 1000\n  return feed last 300 by .at after c\n";
    let (mut e, mut backend) = common::compile(&source);
    let bounded = backend.schema.tables["feedFeed"].sync.clone();
    // A pre-RFC inbox has no acquisition floor. Its contents and identity
    // survive an ordinary adoption; only the device's acquisition resets.
    backend.schema.tables.get_mut("feedFeed").unwrap().sync.as_mut().unwrap().horizon = None;
    backend.generation = e.adopt(backend.schema.clone(), backend.programs.clone()).unwrap();
    for n in 0..1004 { post(&mut e, "alice", &format!("p{n:04}"), n + 1); }
    drain(&mut e);
    let mut d = host.open("alice", Some(backend.clone())).unwrap();
    acquire(&mut d, &mut e, "alice");
    assert_eq!(d.store().raw_rows("feedFeed").len(), 1004);
    backend.schema.tables.get_mut("feedFeed").unwrap().sync = bounded;
    let old = backend.generation;
    backend.generation = e.adopt(backend.schema.clone(), backend.programs.clone()).unwrap();
    assert_eq!(backend.generation, old + 1);
    d.adopt(backend.clone()).unwrap();
    assert!(d.store().raw_rows("feedFeed").is_empty());
    acquire(&mut d, &mut e, "alice");
    assert_eq!(d.store().raw_rows("feedFeed").len(), 1000);
    let (cut, unknown, _) = d.query_with_coverage("cut", "alice", &json!({"c":null}), 2000);
    let cut = cut.unwrap();
    assert!(!cut.unavailable && !cut.complete && !unknown, "{cut:?}");
    assert!(cut.next.is_some() && cut.capped_at.is_some(), "known meter prefix must resume");
    assert!(!cut.data.as_array().unwrap().is_empty() && cut.data.as_array().unwrap().len() < 300);
    let first = d.query("home", "alice", &json!({"c":null}), 2000).unwrap();
    assert!(first.complete);
    let mut cursor = first.next;
    let mut count = 2;
    loop {
        let page = d.query("home", "alice", &json!({"c":cursor}), 2000).unwrap();
        if page.unavailable {
            assert_eq!(page.data, Value::Null);
            assert!(page.next.is_none(), "the page past the floor has no continuation");
            break;
        }
        assert!(page.complete);
        count += page.data.as_array().unwrap().len();
        cursor = page.next;
        assert!(cursor.is_some(), "a full page at the floor must continue to a withheld page");
    }
    assert_eq!(count, 1000);
    backend.schema.tables.get_mut("feedFeed").unwrap().sync.as_mut().unwrap().horizon = None;
    backend.generation = e.adopt(backend.schema.clone(), backend.programs.clone()).unwrap();
    d.adopt(backend).unwrap();
    assert!(d.store().raw_rows("feedFeed").is_empty());
    acquire(&mut d, &mut e, "alice");
    assert_eq!(d.store().raw_rows("feedFeed").len(), 1004);
}

fn known_event_absence<H: Host>(mut host: H) {
    let source = source("sync public").replacen("sync public", "sync public last 1 by .at", 1);
    let (mut e, backend) = common::compile(&source);
    post(&mut e, "alice", "original", 1);
    write(&mut e, "repost", "bob", &[("postId", id("original"))], 2);
    drain(&mut e);
    let mut d = host.open("charlie", Some(backend.clone())).unwrap();
    acquire(&mut d, &mut e, "charlie");
    assert_eq!(d.store().raw_rows("feedPosts").len(), 2);
    let entry = d.admit(serde_json::from_value(json!({"id":"held-original","seq":1,"op":"repost","viewer":"charlie","args":{"postId":"original"},"now":3,"predictable":true})).unwrap()).unwrap();
    assert!(entry.predictable && !entry.predicted.is_empty(), "a newer repost cannot evict original event metadata");
    write(&mut e, "post", "alice", &[("postId", id("reply")), ("parentId", id("original"))], 4);
    let mut d = host.open("dave", Some(backend)).unwrap();
    acquire(&mut d, &mut e, "dave");
    let refusal = d.admit(serde_json::from_value(json!({"id":"reply","seq":1,"op":"repost","viewer":"dave","args":{"postId":"reply"},"now":5,"predictable":true})).unwrap()).unwrap_err();
    assert_eq!(refusal.refusal().code, "FEED_POST_NOT_FOUND", "a held reply has known event absence");
    for (seq, op) in [(2, "follow"), (3, "unfollow")] {
        let entry = d.admit(serde_json::from_value(json!({"id":op,"seq":seq,"op":op,"viewer":"dave","args":{"actor":"alice"},"now":6,"predictable":true})).unwrap()).unwrap();
        assert!(!entry.predictable && entry.predicted.is_empty(), "edge transitions, including no-ops, never predict");
    }
}

#[test] fn cards_memory() { cards(Memory::new()); }
#[test] fn cards_sqlite() { cards(Sqlite::new("bounded-cards")); }
#[test] fn prediction_memory() { prediction(Memory::new()); }
#[test] fn prediction_sqlite() { prediction(Sqlite::new("bounded-prediction")); }
#[test] fn adoption_memory() { adoption(Memory::new()); }
#[test] fn adoption_sqlite() { adoption(Sqlite::new("bounded-adoption")); }
#[test] fn inbox_memory() { inbox(Memory::new()); }
#[test] fn inbox_sqlite() { inbox(Sqlite::new("bounded-inbox")); }
#[test] fn known_event_absence_memory() { known_event_absence(Memory::new()); }
#[test] fn known_event_absence_sqlite() { known_event_absence(Sqlite::new("bounded-event-absence")); }
