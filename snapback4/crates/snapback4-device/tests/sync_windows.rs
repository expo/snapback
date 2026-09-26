//! @ref LLP 3000.019#3.1 — several order columns use the existing full-key boundary on both device stores.
mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, wire, value::object};
use snapback4_device::store::DeviceStore;

const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/sync-windows.q");

fn scenario<H: Host>(host: &mut H) {
    let source = SOURCE.replace("last 10000", "last 3") + r#"
query ascending(conversationId: conversations, c: cursor ?):
  return messages where .conversationId = conversationId first 2 by .at, .ordinal after c
query otherOrder(conversationId: conversations, c: cursor ?):
  return messages where .conversationId = conversationId last 2 by .at after c
"#;
    let (mut engine, backend) = compile(&source);
    let message = |name: &str, room: &str, at, ordinal| ("messages".into(), object([
        ("id", id(name)), ("conversationId", id(room)), ("at", Value::Int(at)), ("ordinal", Value::Int(ordinal)),
    ]));
    engine.seed([
        ("conversations".into(), object([("id", id("c1"))])),
        ("conversations".into(), object([("id", id("c2"))])),
        ("members".into(), object([("id", id("m1")), ("conversationId", id("c1")), ("principal", id("dev:alice"))])),
        ("members".into(), object([("id", id("m2")), ("conversationId", id("c2")), ("principal", id("dev:bob"))])),
        message("old", "c1", 99, 999),
        message("z", "c1", 100, 1),
        message("x", "c1", 100, 2),
        message("a", "c1", 100, 3),
        message("b", "c1", 100, 3),
        message("hidden", "c2", 999, 999),
    ]).unwrap();
    let pages = snapshot_pages(&mut engine, "dev:alice", 2);
    let floor = pages.iter().flat_map(|page| &page.acquisitions).find(|mark| mark.table == "messages" && mark.floor.is_some()).unwrap();
    let values = snapback4_core::key::decode(&snapback4_core::value::decode_bytes_hex(floor.floor.as_ref().unwrap()).unwrap()).unwrap();
    assert_eq!(values, [id("c1"), Value::Int(100), Value::Int(2), id("x"), id("x")], "full index key plus physical row id");
    let mut device = host.open("windows", Some(backend)).unwrap();
    for (i, page) in pages.iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let held = device.store().raw_rows("messages");
    assert_eq!(held.len(), 3);
    assert!(held.iter().all(|row| row.field("conversationId").unwrap() == &id("c1")));
    let args = json!({"conversationId":"c1", "c":null});
    let server = engine.query("thread", context("dev:alice", &[("conversationId", id("c1")), ("c", Value::Null)]).at(1000)).unwrap();
    let (result, unknown, _) = device.query_with_coverage("thread", "dev:alice", &args, 1000);
    let first = result.unwrap();
    assert!(!unknown && first.complete, "{first:?}");
    assert_eq!(first.data, server.data);
    assert_eq!(first.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap()).collect::<Vec<_>>(), ["b", "a"]);
    let cursor = first.next.clone().unwrap();
    // Reopen from persisted rows and boundary metadata, without a server or
    // supplied backend. No in-memory query cache can explain this answer.
    host.close("windows", device);
    let mut device = host.open("windows", None).unwrap();
    let (result, unknown, _) = device.query_with_coverage("thread", "dev:alice", &args, 1000);
    let reopened = result.unwrap();
    assert!(!unknown && reopened.complete);
    assert_eq!(reopened.data, first.data);
    let (result, unknown, _) = device.query_with_coverage("thread", "dev:alice", &json!({"conversationId":"c1", "c":cursor}), 1000);
    let crossing = result.unwrap();
    assert!(unknown && !crossing.complete);
    assert_eq!(wire::to_json(&crossing.data)[0]["id"], "x");
    assert_eq!(crossing.data.as_array().unwrap().len(), 1);
    for operation in ["ascending", "otherOrder"] {
        let (local, unknown, _) = device.query_with_coverage(operation, "dev:alice", &args, 1000);
        assert!(unknown && !local.unwrap().complete, "{operation}: needs server fallback");
        let server = engine.query(operation, context("dev:alice", &[("conversationId", id("c1")), ("c", Value::Null)]).at(1000)).unwrap();
        assert!(server.complete, "{operation} still runs on the server");
    }
    // A newer ordinal at the same timestamp enters the known suffix. An
    // older timestamp with a large ordinal is still below the same floor.
    let watermark = device.store().meta("device:watermark").unwrap().unwrap().parse().unwrap();
    engine.seed([message("new", "c1", 100, 4), message("older", "c1", 98, 9999)]).unwrap();
    device.apply(&stream_page(&mut engine, "dev:alice", watermark), false).unwrap();
    let held = device.store().raw_rows("messages");
    assert_eq!(held.len(), 4);
    assert!(!held.iter().any(|row| row.field("id").unwrap() == &id("older")));
    let (result, unknown, _) = device.query_with_coverage("thread", "dev:alice", &args, 1000);
    let result = result.unwrap();
    assert!(!unknown && result.complete);
    assert_eq!(wire::to_json(&result.data)[0]["id"], "new");
    host.close("windows", device);
}

#[test]
fn full_window_order_is_offline_after_reopen_on_sqlite() { scenario(&mut Sqlite::new("sync-windows")); }

#[test]
fn full_window_order_is_offline_after_reopen_on_memory() { scenario(&mut Memory::new()); }
