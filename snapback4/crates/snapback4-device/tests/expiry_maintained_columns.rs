//! Expiry actions whose child writes feed a private maintained column must
//! settle on the server: the public device schema has the price but not the
//! private derivation that computes the new total (LLP 3000.007.001 §3.7).
mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Context, WriteState, value::{Value, object}};
use snapback4_device::{device::{Device, StreamPage}, store::DeviceStore};

const SOURCE: &str = r#"
table groups:
  total: count children by .group
  public
  sync public
table parents:
  until: time
  expire at .until
  public
  update <- allow
  sync public
table children:
  parent: parents on delete cascade
  group: groups
  cap 4 by parent
  public
  insert <- allow
  sync public
mutation expire(parent: parents, group: groups):
  insert children { id: 'born', parent, group }
  update parents[parent] { until: 0 }
query group(id: groups):
  return groups[id] { total }
"#;

fn acquire<S: DeviceStore>(engine: &mut snapback4_core::Engine, device: &mut Device<S>) {
    let mut after = None;
    let mut first = true;
    loop {
        let page = engine.snapshot_acquisition_page_at("alice", after.as_deref(), 100, 100).unwrap();
        let next = page.next.map(|next| next.encode());
        let page: StreamPage = serde_json::from_value(json!({
            "snapshot":true, "after":after, "held":page.held, "acquisitions":page.acquisitions,
            "events":page.events.iter().map(|event| json!({"table":event.table,"kind":event.kind.word(),"id":event.id,
                "data":event.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),
            "watermark":page.watermark, "more":next.is_some(), "next":next, "generation":engine.generation(),
        })).unwrap();
        device.apply(&page, first).unwrap();
        let Some(next) = next else { break };
        after = Some(next);
        first = false;
    }
}

fn run<H: Host>(host: &mut H) {
    let (mut server, backend) = compile(SOURCE);
    server.seed_at([
        ("groups".into(), object([("id", id("g"))])),
        ("parents".into(), object([("id", id("p")), ("until", Value::Int(200))])),
        ("children".into(), object([("id", id("old")), ("parent", id("p")), ("group", id("g"))])),
    ], 0).unwrap();
    let mut device = host.open("expiry-maintained-column", Some(backend)).unwrap();
    acquire(&mut server, &mut device);
    assert_eq!(device.query("group", "alice", &json!({"id":"g"}), 100).unwrap().data, object([("total", Value::Int(1))]));

    let error = device.predict("expire", "alice", &json!({"parent":"p","group":"g"}), 100, vec![], 1).unwrap_err();
    assert_eq!(error.code(), "E_PREDICT", "{}: {error:?}", host.label());
    assert_eq!(device.store().raw_rows("parents").len(), 1);
    assert_eq!(device.store().raw_rows("children").len(), 1, "queued prediction publishes neither birth nor cascade");
    assert_eq!(device.query("group", "alice", &json!({"id":"g"}), 100).unwrap().data, object([("total", Value::Int(1))]));

    let from = server.seq().unwrap();
    let outcome = server.mutate("expire", None, Context::new("alice", args(&[("parent", id("p")), ("group", id("g"))])).at(100)).unwrap();
    assert!(matches!(outcome.state, WriteState::Sent { .. }), "{outcome:?}");
    device.apply(&stream_page(&mut server, "alice", from), false).unwrap();
    assert!(device.store().raw_rows("parents").is_empty());
    assert!(device.store().raw_rows("children").is_empty());
    assert_eq!(device.query("group", "alice", &json!({"id":"g"}), 100).unwrap().data, object([("total", Value::Int(0))]));
    host.close("expiry-maintained-column", device);
}

#[test] fn expiry_maintained_column_memory() { run(&mut Memory::new()); }
#[test] fn expiry_maintained_column_sqlite() { run(&mut Sqlite::new("expiry-maintained-column")); }
