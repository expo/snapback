//! Expiry is a physical delete trigger for referential actions (LLP 3000.039
//! §3). These cases cover scheduled cleanup, commit-end retirement and
//! same-id replacement of an expired row against the real engine.
use snapback4_core::{Context, Engine, Value, WriteState, value::object};
use std::collections::BTreeMap;

fn id(value: &str) -> Value { Value::Id(value.into()) }

fn engine(source: &str) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}

const SWEEP: &str = r#"
table roots:
  expiresAt: time ?
  by byExpiry: expiresAt
  expire at .expiresAt
  public 'roots'
  insert <- allow
  sync public
table cascadeKids:
  root: roots on delete cascade
  cap 4 by root
  public 'cascade kids'
  insert <- allow
  sync public
table nullableKids:
  root: roots ? on delete set null
  cap 4 by root
  public 'nullable kids'
  insert <- allow
  sync public
table dualNullableKids:
  left: roots ? on delete set null
  right: roots ? on delete set null
  cap 4 by left
  cap 4 by right
  public 'dual nullable kids'
  insert <- allow
  sync public
table blockers:
  root: roots
  public 'blockers'
  insert <- allow
  sync public
"#;

#[test]
fn sweep_applies_every_action_and_advances_past_a_restricted_root() {
    let mut e = engine(SWEEP);
    e.seed_at([
        ("roots".into(), object([("id", id("a-blocked")), ("expiresAt", Value::Int(10))])),
        ("roots".into(), object([("id", id("b-blocked")), ("expiresAt", Value::Int(10))])),
        ("roots".into(), object([("id", id("c-blocked")), ("expiresAt", Value::Int(10))])),
        ("roots".into(), object([("id", id("z-free")), ("expiresAt", Value::Int(10))])),
        ("cascadeKids".into(), object([("id", id("ca")), ("root", id("a-blocked"))])),
        ("cascadeKids".into(), object([("id", id("cz")), ("root", id("z-free"))])),
        ("nullableKids".into(), object([("id", id("nz")), ("root", id("z-free"))])),
        ("dualNullableKids".into(), object([("id", id("dn")), ("left", id("z-free")), ("right", id("z-free"))])),
        ("blockers".into(), object([("id", id("ba")), ("root", id("a-blocked"))])),
        ("blockers".into(), object([("id", id("bb")), ("root", id("b-blocked"))])),
        ("blockers".into(), object([("id", id("bc")), ("root", id("c-blocked"))])),
    ], 0).unwrap();

    for expected in [0, 0, 0, 1] {
        assert_eq!(e.sweep_expired(10, 1).unwrap(), expected, "a one-row sweep must advance its physical scan position");
    }
    assert_eq!(e.store().rows("roots").unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap()).collect::<Vec<_>>(), vec!["a-blocked", "b-blocked", "c-blocked"]);
    assert_eq!(e.store().rows("cascadeKids").unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap()).collect::<Vec<_>>(), vec!["ca"]);
    assert_eq!(e.store().rows("nullableKids").unwrap()[0].field("root").unwrap(), &Value::Null);
    let dual = &e.store().rows("dualNullableKids").unwrap()[0];
    assert_eq!(dual.field("left").unwrap(), &Value::Null);
    assert_eq!(dual.field("right").unwrap(), &Value::Null, "each set-null uses the child's current image");

    for blocker in ["ba", "bb", "bc"] { e.seed_delete("blockers", blocker).unwrap(); }
    assert_eq!(e.sweep_expired(10, 10).unwrap(), 3);
    assert!(e.store().rows("roots").unwrap().is_empty());
    assert!(e.store().rows("cascadeKids").unwrap().is_empty());
}

#[test]
fn a_read_through_blocker_below_a_cascade_is_preflighted_and_does_not_starve_later_roots() {
    let source = r#"
table roots:
  expiresAt: time ?
  by byExpiry: expiresAt
  expire at .expiresAt
  public 'roots'
table nullableKids:
  root: roots ? on delete set null
  cap 1 by root
  public 'nullable kids'
table children:
  root: roots on delete cascade
  cap 1 by root
  public 'children'
table grandchildren:
  child: children
  immutable child
  read through .child
table cascadeGrandchildren:
  child: children on delete cascade
  cap 1 by child
  immutable child
  read through .child
"#;
    let mut e = engine(source);
    e.seed_at([
        ("roots".into(), object([("id", id("p")), ("expiresAt", Value::Int(10))])),
        ("roots".into(), object([("id", id("q-cascade")), ("expiresAt", Value::Int(10))])),
        ("roots".into(), object([("id", id("z-free")), ("expiresAt", Value::Int(10))])),
        ("nullableKids".into(), object([("id", id("n")), ("root", id("p"))])),
        ("children".into(), object([("id", id("c")), ("root", id("p"))])),
        ("children".into(), object([("id", id("d")), ("root", id("q-cascade"))])),
        ("grandchildren".into(), object([("id", id("g")), ("child", id("c"))])),
        ("cascadeGrandchildren".into(), object([("id", id("h")), ("child", id("d"))])),
    ], 0).unwrap();

    assert_eq!(e.sweep_expired(10, 10).unwrap(), 2, "the retained closure yields, while a read-through row inside another cascade is deleted first");
    assert_eq!(e.store().rows("nullableKids").unwrap()[0].field("root").unwrap(), &id("p"), "preflight runs before set-null writes");
    assert!(!e.store().rows("roots").unwrap().iter().any(|row| row.field("id").unwrap() == &id("z-free")));
    for table in ["roots", "children", "grandchildren"] {
        assert_eq!(e.store().rows(table).unwrap().len(), 1, "{table}");
    }
    assert!(e.store().rows("cascadeGrandchildren").unwrap().is_empty());
}

#[test]
fn read_through_closure_probe_is_admitted_before_a_low_ceiling_delete() {
    let source = r#"
table roots:
  public
  delete <- allow
table children:
  root: roots on delete cascade
  cap 2 by root
  public
table grandchildren:
  child: children on delete cascade
  cap 2 by child
  immutable child
  read through .child
mutation drop(id: roots):
  delete roots[id]
"#;
    let world = || {
        let mut e = engine(source);
        e.seed_at([
            ("roots".into(), object([("id", id("p"))])),
            ("children".into(), object([("id", id("c")), ("root", id("p"))])),
            ("grandchildren".into(), object([("id", id("g")), ("child", id("c"))])),
        ], 0).unwrap();
        e
    };
    let context = || Context::new("dev:alice", BTreeMap::from([("id".into(), id("p"))])).at(100);
    let mut complete = world();
    let sent = complete.mutate("drop", None, context()).unwrap();
    assert!(matches!(sent.state, WriteState::Sent { .. }), "{:?}", sent.state);

    let mut cut = world();
    let mut ceilings = cut.ceilings();
    ceilings.examined = sent.metered.examined - 1;
    cut.set_ceilings(ceilings);
    let refused = cut.mutate("drop", None, context()).unwrap();
    assert!(matches!(refused.state, WriteState::Failed { ref why, .. } if why.code == "E_BOUND"), "{:?}", refused.state);
    assert_eq!(cut.store().rows("roots").unwrap().len(), 1);
    assert_eq!(cut.store().rows("children").unwrap().len(), 1);
    assert_eq!(cut.store().rows("grandchildren").unwrap().len(), 1);
}

#[test]
fn commit_retirement_and_expired_same_id_replacement_apply_actions() {
    let source = format!(r#"{SWEEP}
mutation bornExpired():
  insert roots {{id: 'born', expiresAt: now}}
  insert cascadeKids {{id: 'born-c', root: 'born'}}
  insert nullableKids {{id: 'born-n', root: 'born'}}
  return null
mutation bornRestricted():
  insert roots {{id: 'blocked', expiresAt: now}}
  insert blockers {{id: 'blocked-b', root: 'blocked'}}
  return null
mutation replaceExpired():
  insert roots {{id: 'old', expiresAt: null}}
  return null
"#);
    let mut e = engine(&source);
    let sent = e.mutate("bornExpired", None, Context::new("dev:alice", BTreeMap::new()).at(100)).unwrap();
    assert!(matches!(sent.state, WriteState::Sent { .. }), "{:?}", sent.state);
    assert!(e.store().rows("roots").unwrap().is_empty());
    assert!(e.store().rows("cascadeKids").unwrap().is_empty());
    assert_eq!(e.store().rows("nullableKids").unwrap()[0].field("root").unwrap(), &Value::Null);

    let refused = e.mutate("bornRestricted", None, Context::new("dev:alice", BTreeMap::new()).at(100)).unwrap();
    assert!(matches!(refused.state, WriteState::Failed { ref why, .. } if why.code == "E_REFERENCED"), "{:?}", refused.state);
    assert!(e.store().rows("roots").unwrap().is_empty(), "the refused birth and its blocker roll back together");
    assert!(e.store().rows("blockers").unwrap().is_empty());

    e.seed_at([
        ("roots".into(), object([("id", id("old")), ("expiresAt", Value::Int(1))])),
        ("cascadeKids".into(), object([("id", id("old-c")), ("root", id("old"))])),
    ], 0).unwrap();
    let replaced = e.mutate("replaceExpired", None, Context::new("dev:alice", BTreeMap::new()).at(100)).unwrap();
    assert!(matches!(replaced.state, WriteState::Sent { .. }), "{:?}", replaced.state);
    assert_eq!(e.store().rows("roots").unwrap().len(), 1);
    assert_eq!(e.store().rows("roots").unwrap()[0].field("expiresAt").unwrap(), &Value::Null);
    assert!(e.store().rows("cascadeKids").unwrap().is_empty(), "same-id cleanup cannot orphan the expired predecessor's child");
}

#[test]
fn same_id_replacement_reloads_maintained_columns_after_cascade_retirement() {
    let source = r#"
table roots:
  expiresAt: time ?
  by byExpiry: expiresAt
  expire at .expiresAt
  childCount: count children by root
  public
  insert <- allow
table children:
  root: roots on delete cascade
  cap 4 by root
  public
mutation replace():
  insert roots {id: 'same', expiresAt: null}
"#;
    let mut e = engine(source);
    e.seed_at([
        ("roots".into(), object([("id", id("same")), ("expiresAt", Value::Int(10))])),
        ("children".into(), object([("id", id("child")), ("root", id("same"))])),
    ], 0).unwrap();
    assert_eq!(e.store().rows("roots").unwrap()[0].field("childCount").unwrap(), &Value::Int(1));

    let replaced = e.mutate("replace", None, Context::new("dev:alice", BTreeMap::new()).at(100)).unwrap();
    assert!(matches!(replaced.state, WriteState::Sent { .. }), "{:?}", replaced.state);
    let roots = e.store().rows("roots").unwrap();
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0].field("childCount").unwrap(), &Value::Int(0));
    assert!(e.store().rows("children").unwrap().is_empty());
}

#[test]
fn a_blocked_expiry_table_yields_to_later_tables_at_limit_one() {
    let source = r#"
table aFree:
  expiresAt: time
  expire at .expiresAt
  public
table zBlocked:
  expiresAt: time
  expire at .expiresAt
  public
table zReferences:
  root: zBlocked on delete restrict
  public
"#;
    let mut e = engine(source);
    e.seed_at([
        ("zBlocked".into(), object([("id", id("blocked")), ("expiresAt", Value::Int(10))])),
        ("zReferences".into(), object([("id", id("witness")), ("root", id("blocked"))])),
        ("aFree".into(), object([("id", id("free")), ("expiresAt", Value::Int(10))])),
    ], 0).unwrap();
    assert_eq!(e.sweep_expired(10, 1).unwrap(), 0);
    assert_eq!(e.sweep_expired(10, 1).unwrap(), 1, "the table cursor advances past a blocked expiry table");
    assert!(e.store().rows("aFree").unwrap().is_empty());
}
