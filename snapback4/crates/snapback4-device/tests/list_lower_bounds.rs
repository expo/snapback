mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, WriteState};

const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/list-lower-bounds/schema.q");

fn parity<H: Host>(host: &mut H) {
    let (mut e, backend) = compile(SOURCE);
    e.seed([("groups".into(), snapback4_core::value::object([
        ("id", id("existing")), ("peers", Value::Array(vec![id("alice")]))
    ]))]).unwrap();
    let mut d = host.open("lists", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut e, "alice", 100).iter().enumerate() { d.apply(page, i == 0).unwrap(); }
    for op in ["createGroup", "built", "edit", "put"] {
        for n in [0, 1, 49, 50] {
            let args = if op == "createGroup" { json!({"peers":vec!["alice";n]}) }
                else if op == "built" { json!({"n":n}) }
                else { json!({"id":"existing","n":n}) };
            let prediction = d.predict(op, "alice", &args, 100, vec![format!("{op}{n}")], 0);
            let values = if op == "createGroup" { vec![("peers", Value::Array(vec![id("alice");n]))] }
                else if op == "built" { vec![("n", Value::Int(n as i64))] }
                else { vec![("id", id("existing")), ("n", Value::Int(n as i64))] };
            let sent = e.mutate(op, None, context("alice", &values).with_ids([format!("{op}{n}")])).unwrap();
            if n == 0 || n == 50 {
                let WriteState::Failed { why, .. } = sent.state else { panic!("{sent:?}") };
                assert_eq!(why.code, "E_INPUT");
                let failure = prediction.unwrap_err().refusal();
                assert_eq!(failure, why, "{op}/{n}");
                if n == 0 { assert!(why.message.contains("needs at least 1 item"), "{why:?}"); }
            } else {
                assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
                let prediction = prediction.unwrap();
                d.withdraw(&prediction.predicted).unwrap();
            }
        }
    }
    host.close("lists", d);
    let mut d = host.open("lists", None).unwrap();
    assert_eq!(d.predict("createGroup", "alice", &json!({"peers":[]}), 100, vec!["reopen".into()], 0).unwrap_err().refusal().code, "E_INPUT");
}
#[test] fn memory() { parity(&mut Memory::new()); }
#[test] fn sqlite() { parity(&mut Sqlite::new("list-lower-bounds")); }
