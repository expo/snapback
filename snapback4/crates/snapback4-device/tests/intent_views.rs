mod common;
use common::*;
use snapback4_core::{Value, value::object};
use serde_json::json;

const SOURCE: &str = "table posts:\n  at: time\n  public 'posts'\n  sync public\n  insert <- allow\ntable reposts:\n  at: time\n  public 'reposts'\n  sync public\n  insert <- allow\nview activity:\n  posts { at, kind: 'post' }\n  reposts { at, kind: 'repost' }\nquery global(c: cursor ?):\n  return activity first 1 by .at after c\nquery selected(kind: text <=20, c: cursor ?):\n  return activity where .kind = kind first 1 by .at after c\nmutation post(at: time):\n  return insert posts { at }\nmutation repost(at: time):\n  return insert reposts { at }\n";

fn offline<H: Host>(host: &mut H) {
    let (mut server, backend) = compile(SOURCE);
    server.seed([("posts".into(), object([("id", id("same")), ("at", Value::Int(1))])),
        ("reposts".into(), object([("id", id("same")), ("at", Value::Int(1))]))]).unwrap();
    let mut device = host.open("intent-union", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "alice", 1).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let first = device.query("global", "alice", &json!({"c": null}), 10).unwrap();
    assert!(first.complete, "{first:?}");
    assert_eq!(first.data.as_array().unwrap()[0].field("kind").unwrap(), &Value::String("post".into()));
    let second = device.query("global", "alice", &json!({"c": first.next.unwrap()}), 10).unwrap();
    assert!(second.complete, "{second:?}");
    assert_eq!(second.data.as_array().unwrap()[0].field("kind").unwrap(), &Value::String("repost".into()));
    assert!(second.next.is_none());
}
#[test] fn union_offline_memory() { offline(&mut Memory::new()); }
#[test] fn union_offline_sqlite() { offline(&mut Sqlite::new("intent-union")); }

fn unknown_branch<H: Host>(host: &mut H) {
    let source = SOURCE.replace("  public 'reposts'\n  sync public", "  public 'reposts'\n  online only");
    let (mut server, backend) = compile(&source);
    server.seed((0..3).map(|n| ("posts".into(), object([("id", id(&format!("p{n}"))), ("at", Value::Int(n))])))).unwrap();
    let mut device = host.open("intent-unknown", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "alice", 1).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let page = device.query("global", "alice", &json!({"c": null}), 10).unwrap();
    assert!(!page.complete, "unknown branch must not certify the held prefix: {page:?}");
    assert!(page.next.is_none(), "unknown head cannot yield a shared continuation: {page:?}");
    let selected = device.query("selected", "alice", &json!({"kind": "post", "c": null}), 10).unwrap();
    assert!(selected.complete && selected.next.is_some(), "a constant-incompatible branch needs no coverage: {selected:?}");
}
#[test] fn union_unknown_branch_memory() { unknown_branch(&mut Memory::new()); }
#[test] fn union_unknown_branch_sqlite() { unknown_branch(&mut Sqlite::new("intent-unknown")); }

fn ordered_wrapped<H: Host>(host: &mut H) {
    let source = "table posts:\n  at: time\n  public 'posts'\n  sync public\nview events:\n  posts { source: .id, at }\nquery page(c: cursor ?):\n  return { events: events first 1 by .source, .at after c }\n";
    let (mut server, backend) = compile(source);
    server.seed([("a", 3), ("b", 2), ("c", 1)].map(|(key, at)| ("posts".into(), object([("id", id(key)), ("at", Value::Int(at))])))).unwrap();
    let mut device = host.open("intent-review-order", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "alice", 1).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    host.close("intent-review-order", device);
    let mut device = host.open("intent-review-order", None).unwrap();
    let mut cursor = None;
    for key in ["a", "b", "c"] {
        let page = device.query("page", "alice", &json!({"c": cursor}), 10).unwrap();
        assert!(page.complete, "{page:?}");
        assert_eq!(page.data.field("events").unwrap().as_array().unwrap()[0].field("id").unwrap(), &id(key));
        cursor = page.next;
    }
    assert!(cursor.is_none());
}
#[test] fn ordered_wrapped_view_memory() { ordered_wrapped(&mut Memory::new()); }
#[test] fn ordered_wrapped_view_sqlite() { ordered_wrapped(&mut Sqlite::new("intent-review-order")); }

fn source_heap<H: Host>(host: &mut H) {
    let source = "table posts:\n  body: text <=1000000\n  public 'posts'\n  sync public\nview events:\n  posts { id }\nquery page():\n  return events first 20\nquery small():\n  return events first 1\n";
    let (mut server, backend) = compile(source);
    server.seed((0..20).map(|n| ("posts".into(), object([("id", id(&format!("p{n:02}"))), ("body", Value::String("x".repeat(1_000_000)))])))).unwrap();
    let mut device = host.open("intent-review-heap", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "alice", 1).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let page = device.query("page", "alice", &json!({}), 10).unwrap();
    println!("{} projected 20 MB source: heap={}, complete={}, next={:?}", host.label(), page.metered.heap_bytes, page.complete, page.next);
    assert!(!page.complete && page.next.is_none(), "{page:?}");
    assert!(page.metered.heap_bytes >= snapback4_core::Ceilings::default().heap_bytes, "{page:?}");
    // Even the one-row shape fetches and retains source lookahead. The memory
    // store shares its row bodies; they still belong to this read's heap bound.
    let small = device.query("small", "alice", &json!({}), 10).unwrap();
    println!("{} one-row projection with source lookahead: heap={}", host.label(), small.metered.heap_bytes);
    assert!(small.metered.heap_bytes >= 3_000_000, "{small:?}");
}
#[test] fn view_source_heap_memory() { source_heap(&mut Memory::new()); }
#[test] fn view_source_heap_sqlite() { source_heap(&mut Sqlite::new("intent-review-heap")); }
