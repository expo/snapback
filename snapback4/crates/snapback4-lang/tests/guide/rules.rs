//! Execute every case stated in the first E_RULE paragraph; definitions.rs pins
//! each sentence to these witnesses rather than treating prose as engine evidence.
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, MutationOutcome, Value, WriteState, wire};

const SOURCE: &str = r#"
table records:
  owner: principal
  key: text <=80
  amount: int
  writable: bool
  deletable: bool
  unique key
  unique amount
  read <- .owner = viewer
  insert <- .owner = viewer
  update (old, next) <- old.writable = true
  delete <- .deletable = true
mutation add(id: records, key: text <=80, owner: principal, amount: int):
  return insert records { id, key, owner, amount, writable: true, deletable: false }
mutation quiet(id: records, key: text <=80, owner: principal, amount: int):
  return insert records { id, key, owner, amount, writable: true, deletable: false } if absent
mutation edit(id: records, amount: int):
  return update records[id = id] { amount }
mutation put(id: records, amount: int):
  return upsert records[id = id] { amount }
mutation incomplete(id: records, amount: int):
  return upsert records[id = id] { owner: viewer, amount }
mutation conditional(id: records, expected: int):
  return update records[id = id] { amount: 42 } if .amount = expected
mutation remove(id: records):
  delete records[id = id]
query one(id: records):
  return records[id = id]
"#;

fn engine() -> Engine {
    let b = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(b.diagnostics.is_empty() && b.notes.is_empty(), "{:?} {:?}", b.diagnostics, b.notes);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn seed(e: &mut Engine, id: &str, owner: &str, amount: i64, writable: bool, deletable: bool) {
    let row = wire::row_from_json(&e.schema().tables["records"], &json!({
        "id":id, "owner":owner, "key":id, "amount":amount, "writable":writable, "deletable":deletable,
    })).unwrap();
    e.seed(vec![("records".into(), row)]).unwrap();
}
fn call(e: &mut Engine, op: &str, values: Json) -> MutationOutcome {
    let p = e.programs().find(|p| p.name == op).unwrap();
    let args = values.as_object().unwrap().iter().map(|(k,v)| (k.clone(), wire::from_json(&p.args[k], v).unwrap())).collect();
    e.mutate(op, None, Context::new("bob", args).at(100)).unwrap()
}
fn denied(out: &MutationOutcome, code: &str) -> Json {
    let body = out.reply(None);
    assert_eq!(body["state"], "failed", "{body}");
    assert_eq!(body["why"]["code"], code, "{body}");
    body
}
fn null(out: MutationOutcome) {
    assert!(matches!(out.state, WriteState::Sent { result: Value::Null, .. }), "{out:?}");
}
fn private(out: &MutationOutcome) {
    let body = denied(out, "NOT_FOUND");
    assert!(body.get("current").is_none(), "{body}");
    let message = body["why"]["message"].as_str().unwrap();
    for detail in ["records", "owner", "amount", "key", "PRIVATE", "insert", "update"] {
        assert!(!message.contains(detail), "private detail {detail}: {body}");
    }
}
fn index(e: &Engine, column: &str) -> String {
    e.schema().tables["records"].indexes.iter().find(|(_, i)| i.unique && i.columns() == [column]).unwrap().0.clone()
}

#[test]
fn insert_rule_refusals() {
    for op in ["add", "quiet"] {
        let mut e = engine();
        denied(&call(&mut e, op, json!({"id":"fresh", "key":"free", "owner":"alice", "amount":11})), "E_RULE");
        assert!(e.store().rows("records").unwrap().is_empty());
        let out = call(&mut e, op, json!({"id":"fresh", "key":"free", "owner":"bob", "amount":11}));
        assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
        assert_eq!(e.store().rows("records").unwrap().len(), 1);
    }
}

#[test]
fn insert_collision_visibility() {
    for op in ["add", "quiet"] {
        for owner in ["alice", "bob"] {
            let mut e = engine();
            seed(&mut e, "PRIVATE", owner, 7, true, false);
            let before = e.store().rows("records").unwrap();
            let out = call(&mut e, op, json!({"id":"fresh", "key":"PRIVATE", "owner":"bob", "amount":11}));
            if owner == "alice" {
                let body = denied(&out, "E_RULE");
                assert!(!body["why"]["message"].as_str().unwrap().contains("PRIVATE"));
            } else if op == "quiet" { null(out); }
            else {
                let body = denied(&out, "E_CONSTRAINT");
                assert!(body["why"]["message"].as_str().unwrap().contains(&format!("records.{}", index(&e, "key"))));
            }
            assert_eq!(e.store().rows("records").unwrap(), before);
        }
    }
}

#[test]
fn update_rule_refusals() {
    for op in ["edit", "put"] {
        for owner in ["alice", "bob"] {
            let mut e = engine();
            seed(&mut e, "target", owner, 7, false, false);
            let before = e.store().rows("records").unwrap();
            let out = call(&mut e, op, json!({"id":"target", "amount":42}));
            if owner == "alice" { private(&out); } else { denied(&out, "E_RULE"); }
            assert_eq!(e.store().rows("records").unwrap(), before);
        }
    }
}

#[test]
fn admitted_hidden_updates() {
    for op in ["edit", "put"] {
        let mut e = engine();
        seed(&mut e, "target", "alice", 7, true, false);
        null(call(&mut e, op, json!({"id":"target", "amount":42})));
        assert_eq!(e.store().rows("records").unwrap()[0].field("amount"), Ok(&Value::Int(42)));
        for (viewer, hidden) in [("bob", true), ("alice", false)] {
            let read = e.query("one", Context::new(viewer, [("id".into(), Value::Id("target".into()))].into()).at(101)).unwrap();
            assert_eq!(read.data == Value::Null, hidden);
            if !hidden { assert_eq!(read.data.field("amount"), Ok(&Value::Int(42))); }
        }
    }
}

#[test]
fn update_collision_visibility() {
    for op in ["edit", "put"] {
        for owner in ["alice", "bob"] {
            for other in ["alice", "bob"] {
                let mut e = engine();
                seed(&mut e, "target", owner, 7, true, false);
                seed(&mut e, "PRIVATE", other, 42, true, false);
                let before = e.store().rows("records").unwrap();
                let out = call(&mut e, op, json!({"id":"target", "amount":42}));
                if owner == "alice" { private(&out); }
                else if other == "alice" { denied(&out, "E_RULE"); }
                else {
                    let body = denied(&out, "E_CONSTRAINT");
                    assert!(body["why"]["message"].as_str().unwrap().contains(&format!("records.{}", index(&e, "amount"))));
                }
                assert_eq!(e.store().rows("records").unwrap(), before);
            }
        }
    }
}

#[test]
fn missing_update_and_incomplete_upsert() {
    for op in ["edit", "incomplete"] {
        let mut e = engine();
        private(&call(&mut e, op, json!({"id":"missing", "amount":42})));
        assert!(e.store().rows("records").unwrap().is_empty());
    }
}

#[test]
fn update_conditions() {
    for owner in ["alice", "bob"] {
        for expected in [7, 19] {
            let mut e = engine();
            seed(&mut e, "target", owner, 7, true, false);
            let before = e.store().rows("records").unwrap();
            let out = call(&mut e, "conditional", json!({"id":"target", "expected":expected}));
            if owner == "alice" { private(&out); }
            else if expected != 7 { assert_eq!(denied(&out, "E_CONFLICT")["current"]["amount"], 7); }
            else { assert!(matches!(out.state, WriteState::Sent { .. })); continue; }
            assert_eq!(e.store().rows("records").unwrap(), before);
        }
    }
}

#[test]
fn delete_rule_refusals() {
    let mut e = engine();
    denied(&call(&mut e, "remove", json!({"id":"missing"})), "NOT_FOUND");
    for owner in ["alice", "bob"] {
        for allowed in [false, true] {
            let mut e = engine();
            seed(&mut e, "target", owner, 7, true, allowed);
            let before = e.store().rows("records").unwrap();
            let out = call(&mut e, "remove", json!({"id":"target"}));
            if allowed { null(out); assert!(e.store().rows("records").unwrap().is_empty()); }
            else { denied(&out, "E_RULE"); assert_eq!(e.store().rows("records").unwrap(), before); }
        }
    }
}
