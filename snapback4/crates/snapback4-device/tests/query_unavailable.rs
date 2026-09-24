//! An interrupted list evaluation has no value, unlike a legitimate null point.
mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, meter::Ceilings, value::object};

const SOURCE: &str = include_str!("../../../packages/snapback4/test/fixtures/page-ready.q");

fn seeded() -> (snapback4_core::Engine, snapback4_device::device::Backend) {
    let (mut engine, backend) = compile(SOURCE);
    engine.seed([
        ("chats".into(), object([("id", id("chat")), ("owner", id("alice"))])),
        ("members".into(), object([("id", id("member")), ("chat", id("chat")), ("principal", id("alice")), ("at", Value::Int(1)), ("readAt", Value::Int(0))])),
    ]).unwrap();
    engine.seed((0..3).map(|n| ("messages".into(), object([
        ("id", id(&format!("message{n}"))), ("chat", id("chat")), ("sender", id("bob")),
        ("body", Value::String(format!("message {n}"))), ("at", Value::Int(n + 1)),
    ])))).unwrap();
    (engine, backend)
}

fn unknown_list<H: Host>(host: &mut H) {
    let (mut engine, backend) = seeded();
    let mut device = host.open("alice", Some(backend.clone())).unwrap();
    let query = |name| json!({"op":"query", "name":name, "viewer":"alice", "args":{}, "now":10});
    let cold = snapback4_device::call::call(&mut device, query("inbox"));
    assert_eq!(cold["ok"]["unknown"], true, "{cold}");
    assert!(cold["ok"].get("data").is_none(), "{cold}");
    for (n, page) in snapshot_pages(&mut engine, "alice", 100).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let (result, unknown, _, _) = device.query_with_components("inbox", "alice", &json!({}), 10);
    let result = result.unwrap();
    assert!(unknown && !result.complete && result.unavailable, "{result:?}");
    // The internal meter result stays intact, but its placeholder never leaves
    // as ready data. No count, cut-site detail or invented empty page is exposed.
    assert_eq!(result.data, Value::Null);
    let reply = snapback4_device::call::call(&mut device, query("inbox"));
    assert_eq!(reply["ok"]["loading"], true, "{reply}");
    assert!(reply["ok"].get("data").is_none(), "{reply}");
    assert!(reply["ok"].get("components").is_none(), "{reply}");
    let absent = snapback4_device::call::call(&mut device, query("absent"));
    assert_eq!(absent["ok"].get("data"), Some(&json!(null)), "{absent}");
    assert!(absent["ok"].get("loading").is_none(), "{absent}");
    let history = snapback4_device::call::call(&mut device, json!({"op":"query", "name":"history", "viewer":"alice", "args":{"chat":"chat"}, "now":10}));
    assert_eq!(history["ok"]["data"].as_array().unwrap().len(), 2);
    assert_eq!(history["ok"]["complete"], false);
    assert!(history["ok"].get("loading").is_none());
    host.close("alice", device);
    let mut device = host.open("alice", None).unwrap();
    assert_eq!(snapback4_device::call::call(&mut device, query("inbox"))["ok"]["loading"], true);
    host.close("alice", device);
}

#[test]
fn unknown_aggregate_inside_a_list_is_unavailable_on_both_device_stores() {
    unknown_list(&mut Memory::new());
    unknown_list(&mut Sqlite::new("unavailable"));
}

#[test]
fn server_marks_aborted_lists_without_changing_partial_pages_or_nullable_results() {
    let (mut engine, _) = seeded();
    let full = engine.query("inbox", context("alice", &[]).at(10)).unwrap();
    assert!(!full.unavailable && full.complete);
    assert_eq!(full.data.as_array().unwrap()[0].field("unread").unwrap(), &Value::Int(3));
    let absent = engine.query("absent", context("alice", &[])).unwrap();
    assert_eq!(absent.data, Value::Null);
    assert!(!absent.unavailable);
    for ceiling in [Ceilings { heap_bytes: 1, ..Ceilings::default() }, Ceilings { examined: 2, ..Ceilings::default() }] {
        engine.set_ceilings(ceiling);
        let cut = engine.query("totalList", context("alice", &[("chat", id("chat"))]).at(10)).unwrap();
        assert!(cut.unavailable && !cut.complete && cut.next.is_none(), "{cut:?}");
        assert!(cut.capped_at.is_some());
    }
    let page = engine.query("history", context("alice", &[("chat", id("chat"))]).at(10)).unwrap();
    assert!(page.data.as_array().is_ok() && !page.unavailable && !page.complete, "{page:?}");
}
