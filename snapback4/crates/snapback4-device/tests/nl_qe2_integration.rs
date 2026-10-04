//! NL key admission and QE2 presence/reference facts must compose without
//! using an ambiguous probe as its own proof or mixing old/next images.
mod common;
#[path = "nl_qe2_integration/null_runtime.rs"]
mod null_runtime;
use common::*;
use snapback4_core::{Value, WriteState, value::object};

const KEYS: &str = "table conversations:\n  low: principal ?\n  high: principal ?\n  unique pair: low, high\n  public\n  sync public\nfn keep(value: conversations): value\n";
const PARENTS: &str = "table parents:\n  owner: principal\n  low: principal ?\n  high: principal ?\n  read <- .owner = viewer\n  sync to .owner\n";

fn checked(source: &str) {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{source}\n{:?}", b.diagnostics);
}

fn refused(source: &str, code: &str) {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.iter().any(|d| d.code == code), "{source}\n{:?}", b.diagnostics);
}

#[test]
fn nullable_point_presence_requires_admission_before_narrowing() {
    for key in ["low, high", "low = low, high = high", "high = high, low = low"] {
        for body in [
            format!("require low != null and high != null else BAD_KEY\n  require exists conversations[{key}] else NOT_FOUND\n  return keep(conversations[{key}].id)"),
            format!("if low != null and high != null and exists conversations[{key}]:\n    return keep(conversations[{key}].id)\n  return null"),
        ] {
            checked(&format!("{KEYS}query q(low: principal ?, high: principal ?):\n  {body}\n"));
        }
        for body in [
            format!("require exists conversations[{key}] else NOT_FOUND\n  return keep(conversations[{key}].id)"),
            format!("require exists conversations[{key}] and low != null and high != null else NOT_FOUND\n  return keep(conversations[{key}].id)"),
            format!("if exists conversations[{key}]:\n    return keep(conversations[{key}].id)\n  return null"),
        ] {
            refused(&format!("{KEYS}query q(low: principal ?, high: principal ?):\n  {body}\n"), "E_QUARRY_NULL_KEY");
        }
    }
    // Row presence exposes a required field, but does not make optional
    // fields present. Both become operands of a second nullable-unique point.
    checked(&format!("{KEYS}{PARENTS}query q(p: parents):\n  require exists parents[p] else NOT_FOUND\n  return conversations[parents[p].owner, viewer]\n"));
    refused(&format!("{KEYS}{PARENTS}query q(p: parents):\n  require exists parents[p] else NOT_FOUND\n  return conversations[parents[p].low, viewer]\n"), "E_QUARRY_NULL_KEY");
    refused(&format!("{KEYS}query q():\n  require exists conversations[null, null] else NOT_FOUND\n  return conversations[null, null]\n"), "E_QUARRY_NULL_KEY");
}

#[test]
fn rule_presence_facts_keep_reference_image_and_hop_limits() {
    for (guard, probe, accepted) in [
        ("old.parent.low != null and old.parent.high != null", "old.parent.low, old.parent.high", true),
        ("next.parent.low != null and next.parent.high != null", "next.parent.low, next.parent.high", true),
        ("old.parent.low != null and old.parent.high != null", "next.parent.low, next.parent.high", false),
        ("next.parent.low != null and next.parent.high != null", "old.parent.low, old.parent.high", false),
        ("old.parent.low != null or old.parent.high != null", "old.parent.low, old.parent.high", false),
    ] {
        let source = format!("{KEYS}{PARENTS}table children:\n  parent: parents\n  public\n  update (old, next) <- ({guard}) and exists conversations[{probe}]\n");
        if accepted { checked(&source); } else { refused(&source, "E_QUARRY_NULL_KEY"); }
    }
    for rule in [
        "insert <- .parent.low != null and .parent.high != null and exists conversations[low = .parent.low, high = .parent.high]",
        "delete <- .parent.low != null and .parent.high != null and exists conversations[.parent.low, .parent.high]",
        // Explicit table syntax resolves to the same reference term as the guard.
        "insert <- .parent.low != null and .parent.high != null and exists conversations[parents[.parent].low, parents[.parent].high]",
    ] {
        checked(&format!("{KEYS}{PARENTS}table children:\n  parent: parents\n  public\n  {rule}\n"));
    }
    for rule in [
        "read <- .parent.low != null and .parent.high != null and exists conversations[.parent.low, .parent.high]",
        "after insert <- exists conversations[.parent.low, .parent.high]",
    ] {
        refused(&format!("{KEYS}{PARENTS}table children:\n  parent: parents\n  {rule}\n"), "E_QUARRY_RULE_HOP");
    }
}

fn scenario<H: Host>(host: &mut H) {
    let source = format!("{KEYS}{PARENTS}
table children:
  parent: parents
  public
  sync public
  insert <- .parent.low != null and .parent.high != null and .parent.owner = viewer and exists conversations[low = .parent.low, high = .parent.high]
  update (old, next) <- old.parent.low != null and old.parent.high != null and next.parent.low != null and next.parent.high != null and old.parent.owner = viewer and next.parent.owner = viewer and exists conversations[old.parent.low, old.parent.high] and exists conversations[high = next.parent.high, low = next.parent.low]
  delete <- .parent.low != null and .parent.high != null and .parent.owner = viewer and exists conversations[.parent.low, .parent.high]
mutation add(id: children, parent: parents):
  return insert children {{ id, parent }}
mutation change(id: children, parent: parents):
  return update children[id] {{ parent }}
mutation remove(id: children):
  delete children[id]
  return true
query guarded(low: principal ?, high: principal ?):
  require low != null and high != null else BAD_KEY
  require exists conversations[low, high] else NOT_FOUND
  return keep(conversations[low, high].id)
query conditional(low: principal ?, high: principal ?):
  if low != null and high != null and exists conversations[high = high, low = low]:
    return keep(conversations[high = high, low = low].id)
  return null
query through(p: parents):
  require exists parents[p] else NOT_FOUND
  return conversations[parents[p].owner, viewer]
");
    let (mut server, backend) = compile(&source);
    let mut rows = Vec::new();
    for (name, low, high) in [
        ("pair-a", id("alice"), id("alice")), ("pair-b", id("alice"), id("bob")),
        ("null-a", Value::Null, Value::Null), ("null-b", Value::Null, Value::Null),
    ] {
        rows.push(("conversations".into(), object([("id", id(name)), ("low", low), ("high", high)])));
    }
    for (name, owner, low, high) in [
        ("p-a", "alice", id("alice"), id("alice")),
        ("p-b", "alice", id("alice"), id("bob")),
        ("p-null", "alice", Value::Null, Value::Null),
        ("p-hidden", "bob", id("alice"), id("alice")),
    ] {
        rows.push(("parents".into(), object([("id", id(name)), ("owner", id(owner)), ("low", low), ("high", high)])));
    }
    server.seed(rows).unwrap();
    let mut device = host.open("nl-qe2", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "alice", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }

    for (low, high, expected) in [(id("alice"), id("alice"), id("pair-a")), (Value::Null, Value::Null, Value::Null), (id("missing"), id("missing"), Value::Null)] {
        let input = [("low", low), ("high", high)];
        let json = snapback4_core::wire::to_json(&object(input.clone()));
        let s = server.query("conditional", context("alice", &input).at(100)).unwrap();
        let d = device.query("conditional", "alice", &json, 100).unwrap();
        assert_eq!(s.data, expected);
        assert_eq!(s.data, d.data);
        assert!(s.complete && d.complete);
        let s = server.query("guarded", context("alice", &input).at(100));
        let d = device.query("guarded", "alice", &json, 100);
        if expected == Value::Null {
            assert!(s.is_err() && d.is_err());
        } else {
            let (s, d) = (s.unwrap(), d.unwrap());
            assert_eq!(s.data, expected);
            assert_eq!(s.data, d.data);
            assert!(s.complete && d.complete);
        }
    }
    let input = [("p", id("p-a"))];
    let s = server.query("through", context("alice", &input).at(100)).unwrap();
    let d = device.query("through", "alice", &snapback4_core::wire::to_json(&object(input)), 100).unwrap();
    assert_eq!(s.data.field("id"), Ok(&id("pair-a")));
    assert_eq!(s.data, d.data);
    assert!(s.complete && d.complete);

    for (op, input) in [
        ("add", vec![("id", id("child")), ("parent", id("p-a"))]),
        ("change", vec![("id", id("child")), ("parent", id("p-b"))]),
        ("remove", vec![("id", id("child"))]),
    ] {
        let out = server.mutate(op, None, context("alice", &input).at(100)).unwrap();
        let WriteState::Sent { result, .. } = out.state else { panic!("{op}: {out:?}") };
        let d = device.predict(op, "alice", &snapback4_core::wire::to_json(&object(input)), 100, vec![], 0).unwrap();
        assert_eq!(snapback4_core::wire::to_json(&result), d.result);
    }
    for parent in ["p-null", "p-hidden", "missing"] {
        let input = [("id", id("refused")), ("parent", id(parent))];
        let out = server.mutate("add", None, context("alice", &input).at(100)).unwrap();
        assert!(matches!(out.state, WriteState::Failed { .. }), "{parent}: {out:?}");
        assert!(device.predict("add", "alice", &snapback4_core::wire::to_json(&object(input)), 100, vec![], 0).is_err());
    }
}

#[test] fn memory_guards_hops_and_nullable_points() { scenario(&mut Memory::new()); }
#[test] fn sqlite_guards_hops_and_nullable_points() { scenario(&mut Sqlite::new("nl-qe2")); }
