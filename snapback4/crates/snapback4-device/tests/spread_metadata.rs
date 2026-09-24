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
    let nested = device.query("nested", "alice", &json!({"key":key}), 100).unwrap();
    assert_eq!(nested.data.field("row").unwrap(), &shaped.data);
    assert!(!nested.data.as_object().unwrap().contains_key("pending"), "a containing record is not a row");
    for (first, second, marked) in [("confirmed", key, pending), (key, "confirmed", false)] {
        let merged = device.query("merged", "alice", &json!({"first":first,"second":second}), 100).unwrap();
        assert_eq!(merged.data.field("id").unwrap(), &id(second));
        assert_eq!(merged.data.as_object().unwrap().get("pending"), marked.then_some(&Value::Bool(true)), "last row supplies the metadata base");
    }
}

fn lifecycle<H: Host>(host: &mut H) {
    let (mut server, backend) = compile(SOURCE);
    server.seed([("notes".into(), object([("id", id("confirmed")), ("owner", id("alice")), ("title", Value::String("confirmed".into()))]))]).unwrap();
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
    let remote = server.query("spread", context("alice", &[("key", id(key))]).at(100)).unwrap();
    assert_eq!(device.query("spread", "alice", &json!({"key":key}), 100).unwrap().data, remote.data);
    host.close("spread-metadata", device);
    inspect(&mut host.open("spread-metadata", None).unwrap(), key, false);
}

#[test] fn spread_pending_on_memory_before_confirmation_after_reopen_and_settlement() { lifecycle(&mut Memory::new()); }
#[test] fn spread_pending_on_sqlite_before_confirmation_after_reopen_and_settlement() { lifecycle(&mut Sqlite::new("spread-metadata")); }
