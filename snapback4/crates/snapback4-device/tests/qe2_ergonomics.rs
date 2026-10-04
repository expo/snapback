mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, WriteState};
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/qe2/rows.q");

fn scenario<H: Host>(host: &mut H) {
    let (mut e, backend) = compile(SOURCE);
    let out = e.mutate("room", None, context("alice", &[("id", id("c"))]).at(100)).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }));
    let mut d = host.open("qe2", Some(backend)).unwrap();
    for (i,p) in snapshot_pages(&mut e,"alice",100).iter().enumerate() { d.apply(p,i==0).unwrap(); }
    let sent = d.predict("send","alice",&json!({"id":"m","conversation":"c"}),100,vec![],0).unwrap();
    assert_eq!(sent.result["photo"], serde_json::Value::Null);
    assert_eq!(sent.result["edited"], false);
    assert_eq!(sent.result["at"], 100);
    assert_eq!(sent.result["setting"], "off");
    let patched = d.predict("patch","alice",&json!({"message":"m"}),100,vec![],0).unwrap();
    assert_eq!(patched.result["photo"], serde_json::Value::Null);
    assert_eq!(patched.result["edited"], true);
    assert_eq!(patched.result["at"], 100);
    let reaction = d.predict("react","alice",&json!({"id":"r","message":"m"}),100,vec![],0).unwrap();
    assert_eq!(reaction.result["emoji"], "like");
    let edited = d.predict("editReaction","alice",&json!({"id":"r"}),100,vec![],0).unwrap();
    assert_eq!(edited.result["emoji"], "new");
    d.predict("dropReaction","alice",&json!({"id":"r"}),100,vec![],0).unwrap();
    assert!(d.predict("react","alice",&json!({"id":"absent","message":"missing"}),100,vec![],0).is_err());
    host.close("qe2",d);
    let mut d = host.open("qe2",None).unwrap();
    let row = d.query("message","alice",&json!({"id":"m"}),100).unwrap().data;
    assert_eq!(row.field("photo"), Ok(&Value::Null));
}
#[test] fn memory_total_results_guards_and_rule_hops() { scenario(&mut Memory::new()); }
#[test] fn sqlite_total_results_guards_and_rule_hops() { scenario(&mut Sqlite::new("qe2")); }
