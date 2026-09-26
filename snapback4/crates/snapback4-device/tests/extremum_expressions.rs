mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, value::object};
use snapback4_device::device::Queued;

const SOURCE: &str = include_str!("../../snapback4-lang/tests/extremum_expressions/schema.q");
const SAVE: &str = r#"
table summaries:
  owner: principal
  state: int ?
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
query saved():
  return summaries['summary']
mutation save(conversation: id, ordinal: int):
  insert summaries { id: 'summary', owner: viewer, state: min(members where .conversation = conversation, 2 if .seenOrdinal >= ordinal else 1) }
"#;
fn run<H: Host>(host: &mut H) {
    for (name, sync, complete) in [("whole", "sync public", true), ("horizon", "sync public last 1 by .joinedOrdinal", false), ("online", "online only", false)] {
        let source = format!("{}{SAVE}", SOURCE.replacen("sync public", sync, 1));
        let (mut server, backend) = compile(&source);
        server.seed([("a", 1, 0, Value::Null), ("b", 2, 8, Value::Int(-2)), ("c", 3, 20, Value::Int(7))]
            .map(|(key, joined, seen, n)| ("members".into(), object([("id", id(key)), ("conversation", id("chat")),
                ("joinedOrdinal", Value::Int(joined)), ("seenOrdinal", Value::Int(seen)), ("n", n)])))).unwrap();
        let args = json!({"conversation":"chat","ordinal":10});
        let mut device = host.open(name, Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut server, "alice", 1).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        host.close(name, device);
        let mut device = host.open(name, None).unwrap();
        for op in ["receipt", "fastest", "defaulted", "nullable", "nested"] {
            let remote = server.query(op, context("alice", &[("conversation", id("chat")), ("ordinal", Value::Int(10))]).at(100)).unwrap();
            assert!(remote.complete, "{op}: {remote:?}");
            let local = device.query(op, "alice", &args, 100).unwrap();
            assert_eq!(local.complete, complete, "{name} {op}: {local:?}");
            assert_eq!(local.data, if complete { remote.data } else { Value::Null }, "{name} {op}");
        }
        let queued = device.admit(Queued { id: "save".into(), seq: 1, op: "save".into(), args: args.clone(), viewer: "alice".into(), now: 100,
            new_ids: vec![], predicted: vec![], predictable: true, sent_seq: None, receipt_store: None, observed_seq: None }).unwrap();
        assert_eq!(queued.predictable, complete, "{name}: {queued:?}");
        assert_eq!(queued.predicted.len(), usize::from(complete));
        host.close(name, device);
        let mut reopened = host.open(name, None).unwrap();
        let result = reopened.query("receipt", "alice", &args, 100).unwrap();
        assert_eq!(result.complete, complete);
        assert_eq!(result.data, if complete { Value::Int(1) } else { Value::Null });
        if complete { assert_eq!(reopened.query("saved", "alice", &json!({}), 100).unwrap().data.field("state").unwrap(), &Value::Int(1)); }
    }
}
#[test] fn expression_extrema_memory_coverage_prediction_and_reopen() { run(&mut Memory::new()); }
#[test] fn expression_extrema_sqlite_coverage_prediction_and_reopen() { run(&mut Sqlite::new("extremum-expressions")); }

fn components<H: Host>(host: &mut H) {
    let source = "table t:\n  n: int\n  cap 3\n  public\n  sync public\ntable remote:\n  n: int\n  public\n  online only\nquery column():\n  return { a: min(t, .n), z: remote['r'].n }\nquery expression():\n  return { a: min(t, .n + 0), z: remote['r'].n }\n";
    let (mut server, backend) = compile(source);
    assert_eq!(backend.schema.operations["expression"].components.len(), 2);
    server.seed([("t".into(), object([("id", id("t")), ("n", Value::Int(5))])),
        ("remote".into(), object([("id", id("r")), ("n", Value::Int(9))]))]).unwrap();
    let mut device = host.open("components", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "alice", 1).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    host.close("components", device);
    let mut device = host.open("components", None).unwrap();
    let (column, _, _, expected) = device.query_with_components("column", "alice", &json!({}), 100);
    let (expression, _, _, actual) = device.query_with_components("expression", "alice", &json!({}), 100);
    assert_eq!(column.unwrap().data, expression.unwrap().data);
    assert_eq!(actual, expected);
    assert!(actual["a"].complete && !actual["a"].unknown);
    assert!(!actual["z"].complete && actual["z"].unknown);
}
#[test] fn expression_extrema_memory_independent_components() { components(&mut Memory::new()); }
#[test] fn expression_extrema_sqlite_independent_components() { components(&mut Sqlite::new("extremum-components")); }
