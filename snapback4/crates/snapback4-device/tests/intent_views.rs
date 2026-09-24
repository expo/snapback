mod common;
use common::*;
use snapback4_core::{Value, value::object};
use serde_json::json;

const SOURCE: &str = "table posts:\n  at: time\n  public 'posts'\n  sync public\n  insert <- allow\ntable reposts:\n  at: time\n  public 'reposts'\n  sync public\n  insert <- allow\nview activity:\n  posts { at, kind: 'post' }\n  reposts { at, kind: 'repost' }\nquery global(c: cursor ?):\n  return activity first 1 by .at after c\nmutation post(at: time):\n  return insert posts { at }\nmutation repost(at: time):\n  return insert reposts { at }\n";

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
}
#[test] fn union_unknown_branch_memory() { unknown_branch(&mut Memory::new()); }
#[test] fn union_unknown_branch_sqlite() { unknown_branch(&mut Sqlite::new("intent-unknown")); }
