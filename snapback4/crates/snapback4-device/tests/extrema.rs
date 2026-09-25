mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, value::object};
use snapback4_device::device::Queued;

const SOURCE: &str = r#"
table receipts:
  owner: principal
  state: int ?
  by byState: owner, state, id
  read <- .owner = viewer
  sync to .owner
table summaries:
  owner: principal
  state: int ?
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
query low():
  return min(receipts where .owner = viewer, .state)
query high():
  return max(receipts where .owner = viewer, .state)
query fallback():
  return min(receipts where .owner = viewer, .state) ?? 2
query saved():
  return summaries['summary']
mutation save():
  insert summaries { id: 'summary', owner: viewer, state: min(receipts where .owner = viewer, .state) }
"#;

fn run<H: Host>(host: &mut H) {
    for (name, sync, complete) in [("whole", "sync to .owner", true), ("horizon", "sync to .owner last 1 by byState", false), ("online", "online only", false)] {
        let source = SOURCE.replacen("sync to .owner", sync, 1);
        let (mut server, backend) = compile(&source);
        server.seed([("a", "alice", Value::Null), ("b", "alice", Value::Int(1)), ("c", "alice", Value::Int(8)), ("hidden", "bob", Value::Int(-100))]
            .map(|(key, owner, state)| ("receipts".into(), object([("id", id(key)), ("owner", id(owner)), ("state", state)])))).unwrap();
        let mut device = host.open(name, Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut server, "alice", 1).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        host.close(name, device);
        let mut device = host.open(name, None).unwrap();
        for (op, expected) in [("low", 1), ("high", 8), ("fallback", 1)] {
            let remote = server.query(op, context("alice", &[]).at(100)).unwrap();
            assert!(remote.complete);
            assert_eq!(remote.data, Value::Int(expected));
            let local = device.query(op, "alice", &json!({}), 100).unwrap();
            assert_eq!(local.complete, complete, "{name} {op}: {local:?}");
            assert_eq!(local.data, if complete { remote.data } else { Value::Null }, "{name} {op}");
        }
        let queued = device.admit(Queued { id: "save".into(), seq: 1, op: "save".into(), args: json!({}), viewer: "alice".into(), now: 100,
            new_ids: vec![], predicted: vec![], predictable: true, sent_seq: None, receipt_store: None, observed_seq: None }).unwrap();
        assert_eq!(queued.predictable, complete, "{name}: {queued:?}");
        assert_eq!(queued.predicted.len(), usize::from(complete));
        if complete { assert_eq!(device.query("saved", "alice", &json!({}), 100).unwrap().data.field("state").unwrap(), &Value::Int(1)); }
        host.close(name, device);
        let mut reopened = host.open(name, None).unwrap();
        assert_eq!(reopened.query("low", "alice", &json!({}), 100).unwrap().complete, complete);
    }
}

#[test] fn min_max_coverage_prediction_and_reopen_memory() { run(&mut Memory::new()); }
#[test] fn min_max_coverage_prediction_and_reopen_sqlite() { run(&mut Sqlite::new("extrema")); }
