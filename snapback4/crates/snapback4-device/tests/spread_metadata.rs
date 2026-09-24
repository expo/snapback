//! A row spread keeps the device's pending metadata through outbox custody.
mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, WriteState, value::object};
use snapback4_device::device::Device;

const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/spread-metadata.q");

fn inspect<S: BoundaryMetadata>(device: &mut Device<S>, key: &str, pending: bool) {
    let shaped = device.query("shaped", "alice", &json!({"key":key}), 100).unwrap();
    assert!(shaped.complete);
    assert_eq!(shaped.data.as_object().unwrap().get("pending"), pending.then_some(&Value::Bool(true)));
    for query in ["spread", "reshaped"] {
        let spread = device.query(query, "alice", &json!({"key":key}), 100).unwrap();
        assert_eq!(spread.data, shaped.data, "{query}, pending={pending}");
        assert_eq!(spread.complete, shaped.complete);
        assert_eq!(spread.metered.examined, 1, "spread reads the row once");
    }
    for query in ["spreadThenShape", "spreadThenShapes", "shapeThenShape"] {
        let result = device.query(query, "alice", &json!({"key":key}), 100).unwrap();
        let title = if query == "shapeThenShape" { Value::String("override".into()) } else { shaped.data.field("title").unwrap().clone() };
        assert_eq!(result.data.field("title").unwrap(), &title, "{query}");
        assert_eq!(result.data.as_object().unwrap().get("pending"), pending.then_some(&Value::Bool(true)), "{query}");
    }
    for flag in [true, false] {
        for query in ["shapedArms", "shapedConditional", "shapedReassignment", "spreadJoined"] {
            let result = device.query(query, "alice", &json!({"key":key, "flag":flag}), 100).unwrap();
            assert!(result.complete);
            assert_eq!(result.metered.examined, 1);
            assert_eq!(result.data.field("title").unwrap(), &Value::String(if flag || query == "spreadJoined" { "offline" } else { "override" }.into()), "{query}, flag={flag}");
            assert_eq!(result.data.as_object().unwrap().get("pending"), pending.then_some(&Value::Bool(true)), "{query}, flag={flag}");
        }
    }
    for query in ["tagged", "taggedAgain", "taggedReplaced"] {
        let result = device.query(query, "alice", &json!({"key":key,"tag":"tag"}), 100).unwrap();
        assert!(result.complete);
        assert_eq!(result.metered.examined, 2, "each operand read once");
        assert_eq!(result.data.field("id").unwrap(), &id("tag"));
        assert_eq!(result.data.field("label").unwrap(), &Value::String("confirmed tag".into()));
        let replaced = query == "taggedReplaced";
        assert_eq!(result.data.field("title").unwrap(), &Value::String(if replaced { "override" } else { "offline" }.into()));
        assert_eq!(result.data.as_object().unwrap().get("pending"), pending.then_some(&Value::Bool(true)), "{query}: replacing fields does not clear pending");
    }
    let nested = device.query("nested", "alice", &json!({"key":key}), 100).unwrap();
    assert_eq!(nested.data.field("row").unwrap(), &shaped.data);
    assert!(!nested.data.as_object().unwrap().contains_key("pending"), "a containing record is not a row");
    for (first, second, marked) in [("confirmed", key, pending), (key, "confirmed", pending)] {
        let merged = device.query("merged", "alice", &json!({"first":first,"second":second}), 100).unwrap();
        assert_eq!(merged.data.field("id").unwrap(), &id(second));
        assert_eq!(merged.data.as_object().unwrap().get("pending"), marked.then_some(&Value::Bool(true)), "either pending row marks the result, including an entirely replaced row");
    }
}

fn lifecycle<H: Host>(host: &mut H) {
    let (mut server, backend) = compile(SOURCE);
    server.seed([
        ("notes".into(), object([("id", id("confirmed")), ("owner", id("alice")), ("title", Value::String("confirmed".into()))])),
        ("tags".into(), object([("id", id("tag")), ("owner", id("alice")), ("label", Value::String("confirmed tag".into()))])),
    ]).unwrap();
    let mut device = host.open("spread-metadata", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut server, "alice", 10).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let queued = device.admit(serde_json::from_value(json!({
        "id":"add-note", "seq":1, "op":"add", "args":{"title":"offline"},
        "new_ids":["predicted"], "viewer":"alice", "now":100, "predictable":true,
    })).unwrap()).unwrap();
    assert!(queued.predictable);
    let key = &queued.new_ids[0];
    inspect(&mut device, key, true);
    host.close("spread-metadata", device);
    let mut device = host.open("spread-metadata", None).unwrap();
    assert_eq!(device.queued().unwrap().len(), 1);
    inspect(&mut device, key, true);
    let written = server.mutate("add", Some(&queued.id), context("alice", &[("title", Value::String("offline".into()))]).at(100).with_ids(queued.new_ids.clone())).unwrap();
    let WriteState::Sent { seq, .. } = written.state else { panic!("{:?}", written.state) };
    device.settle(&queued.id, Some(seq)).unwrap();
    let from = device.state().unwrap().0;
    device.apply(&stream_page(&mut server, "alice", from), false).unwrap();
    assert!(device.queued().unwrap().is_empty());
    inspect(&mut device, key, false);
    for query in ["spread", "spreadThenShape", "spreadThenShapes", "shapeThenShape", "tagged", "taggedAgain", "taggedReplaced"] {
        let args = if query.starts_with("tagged") { json!({"key":key,"tag":"tag"}) } else { json!({"key":key}) };
        let ctx = if query.starts_with("tagged") { context("alice", &[("key", id(key)), ("tag", id("tag"))]) } else { context("alice", &[("key", id(key))]) };
        let remote = server.query(query, ctx.at(100)).unwrap();
        assert_eq!(device.query(query, "alice", &args, 100).unwrap().data, remote.data, "{query}");
    }
    host.close("spread-metadata", device);
    inspect(&mut host.open("spread-metadata", None).unwrap(), key, false);
}

#[test] fn spread_pending_on_memory_before_confirmation_after_reopen_and_settlement() { lifecycle(&mut Memory::new()); }
#[test] fn spread_pending_on_sqlite_before_confirmation_after_reopen_and_settlement() { lifecycle(&mut Sqlite::new("spread-metadata")); }
