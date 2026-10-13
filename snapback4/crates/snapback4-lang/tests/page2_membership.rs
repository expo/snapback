//! PAGE2 coverage kept separate from the already-large branch_merge suite.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::{Bound, compile};
use std::collections::BTreeMap;

fn bound(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{source}\n{:#?}", bound.diagnostics);
    bound
}

fn engine(source: &str, rows: Vec<(&str, Vec<(&str, Value)>)>) -> Engine {
    let bound = bound(source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|program| program.program)).unwrap();
    engine.seed(rows.into_iter().map(|(table, fields)| (table.to_owned(), object(fields)))).unwrap();
    engine
}

fn id(value: &str) -> Value { Value::Id(value.into()) }
fn ids(value: &Value) -> Vec<String> { value.as_array().unwrap().iter().map(|row| match row.field("id").unwrap() {
    Value::Id(id) => id.clone(), other => panic!("row id is {other:?}"),
}).collect() }
fn args() -> BTreeMap<String, Value> { BTreeMap::from([("c".into(), Value::Null)]) }

const MEMBERSHIP: &str = "table memberships:
  parent: text <=40
  principal: principal
  unique parent, principal
  read <- .principal = viewer
  online only

table documents:
  owner: principal
  parent: text <=40
  at: int
  read <- .owner = viewer or exists memberships[.parent, viewer]
  online only

query documents(c: cursor ?):
  return documents last 10 by .at after c
";

fn membership(name: &str, parent: &str) -> (&'static str, Vec<(&'static str, Value)>) {
    ("memberships", vec![("id", id(name)), ("parent", Value::String(parent.into())), ("principal", id("alice"))])
}

fn document(name: &str, owner: &str, parent: &str, at: i64) -> (&'static str, Vec<(&'static str, Value)>) {
    ("documents", vec![("id", id(name)), ("owner", id(owner)), ("parent", Value::String(parent.into())), ("at", Value::Int(at))])
}

#[test]
fn total_point_admits_metered_discovery_without_a_global_cap() {
    let compiled = bound(MEMBERSHIP);
    assert!(!compiled.notes.iter().any(|note| note.code == "N_NEVER_COMPLETE"), "{:#?}", compiled.notes);
    assert!(compiled.schema.required_capabilities().contains("branch-membership-v2"));
    let rows = || vec![membership("m1", "p1"), membership("m2", "p2"),
        document("owned", "alice", "p0", 1), document("shared-1", "bob", "p1", 2),
        document("shared-2", "bob", "p2", 3), document("hidden", "bob", "p9", 4)];
    let mut full = engine(MEMBERSHIP, rows());
    let page = full.query("documents", Context::new("alice", args())).unwrap();
    assert!(page.complete && page.next.is_none());
    assert_eq!(ids(&page.data), ["shared-2", "shared-1", "owned"]);
    let mut cut = engine(MEMBERSHIP, rows());
    cut.set_ceilings(snapback4_core::Ceilings { examined: 1, ..Default::default() });
    let page = cut.query("documents", Context::new("alice", args())).unwrap();
    assert!(ids(&page.data).is_empty() && !page.complete && page.next.is_none(), "{page:?}");

    let capped = MEMBERSHIP.replace("  unique parent, principal\n", "  unique parent, principal\n  cap 16 by principal\n");
    let old = bound(&capped);
    assert!(old.schema.required_capabilities().contains("branch-membership-v1"));
    assert!(!old.schema.required_capabilities().contains("branch-membership-v2"));
    let roundtrip: snapback4_core::schema::Schema = serde_json::from_str(&serde_json::to_string(&old.schema).unwrap()).unwrap();
    assert!(roundtrip.required_capabilities().contains("branch-membership-v1"));
    assert!(!roundtrip.required_capabilities().contains("branch-membership-v2"));
}

#[test]
fn row_id_targets_keep_at_id_order_and_withhold_a_partial_head_set() {
    let source = "table documents:
  owner: principal
  at: int
  read <- .owner = viewer or exists shares[.id, viewer]
  online only
table shares:
  document: documents
  principal: principal
  unique document, principal
  read <- .principal = viewer
  online only
query documents(c: cursor ?):
  return documents last 10 by .at after c
";
    let rows = || vec![
        ("documents", vec![("id", id("owned")), ("owner", id("alice")), ("at", Value::Int(20))]),
        ("documents", vec![("id", id("shared-early")), ("owner", id("bob")), ("at", Value::Int(10))]),
        ("documents", vec![("id", id("shared-late")), ("owner", id("bob")), ("at", Value::Int(30))]),
        ("documents", vec![("id", id("hidden")), ("owner", id("bob")), ("at", Value::Int(40))]),
        ("shares", vec![("id", id("s1")), ("document", id("shared-late")), ("principal", id("alice"))]),
        ("shares", vec![("id", id("s2")), ("document", id("shared-early")), ("principal", id("alice"))])];
    let bound = bound(source);
    assert!(bound.schema.tables["documents"].indexes.values().any(|index| index.columns() == ["id", "at"]));
    assert!(bound.schema.required_capabilities().contains("branch-membership-v2"), "{:?}", bound.schema.required_capabilities());
    let mut full = engine(source, rows());
    let page = full.query("documents", Context::new("alice", args())).unwrap();
    assert!(page.complete && page.next.is_none());
    assert_eq!(ids(&page.data), ["shared-late", "owned", "shared-early"]);

    let cut = (1..30).find_map(|examined| {
        let mut engine = engine(source, rows());
        engine.set_ceilings(snapback4_core::Ceilings { examined, ..snapback4_core::Ceilings::unbounded() });
        let page = engine.query("documents", Context::new("alice", args())).unwrap();
        (!page.complete && ids(&page.data).is_empty() && page.next.is_none() && page.metered.examined > 2).then_some(page)
    }).expect("a target head cuts after discovery and before every id lane opens");
    assert!(cut.next.is_none(), "an unread point lane has no safe frontier: {cut:?}");
}

#[test]
fn parent_owner_by_id_witness_discovers_targets_without_a_cap() {
    let source = "table offers:
  baker: principal
  read <- .baker = viewer
  online only
table requests:
  requester: principal
  offer: offers
  at: int
  read <- .requester = viewer or exists offers[.offer, baker = viewer]
  online only
query requests(c: cursor ?):
  return requests last 10 by .at after c
";
    let bound = bound(source);
    assert!(bound.schema.tables["offers"].indexes.values().any(|index| index.columns() == ["baker", "id"]));
    assert!(bound.schema.required_capabilities().contains("branch-membership-v2"));
    let mut engine = engine(source, vec![
        ("offers", vec![("id", id("o1")), ("baker", id("alice"))]),
        ("offers", vec![("id", id("o2")), ("baker", id("bob"))]),
        ("requests", vec![("id", id("r1")), ("requester", id("bob")), ("offer", id("o1")), ("at", Value::Int(1))]),
        ("requests", vec![("id", id("r2")), ("requester", id("alice")), ("offer", id("o2")), ("at", Value::Int(2))]),
        ("requests", vec![("id", id("r3")), ("requester", id("bob")), ("offer", id("o2")), ("at", Value::Int(3))]),
    ]);
    let page = engine.query("requests", Context::new("alice", args())).unwrap();
    assert!(page.complete && page.next.is_none());
    assert_eq!(ids(&page.data), ["r2", "r1"]);
}

#[test]
fn nullable_point_prints_only_a_verified_hard_cap_repair() {
    let source = MEMBERSHIP.replacen("parent: text <=40", "parent: text <=40 ?", 1);
    let compiled = bound(&source);
    let note = compiled.notes.iter().find(|note| note.code == "N_NEVER_COMPLETE").expect("nullable unique needs a bound");
    assert!(note.rewrite.contains("`cap 50 by principal` on table memberships"), "{}", note.rewrite);
    assert!(note.rewrite.contains("hard stored-row limit") && note.rewrite.contains("refuse adoption or later writes"), "{}", note.rewrite);

    let repaired = source.replace("  unique parent, principal\n", "  unique parent, principal\n  cap 50 by principal\n");
    let compiled = bound(&repaired);
    assert!(!compiled.notes.iter().any(|note| note.code == "N_NEVER_COMPLETE"), "{:#?}", compiled.notes);
    assert!(compiled.schema.required_capabilities().contains("branch-membership-v1"));

    let hidden = source.replace("  read <- .principal = viewer\n", "  read <- deny\n");
    let compiled = bound(&hidden);
    let note = compiled.notes.iter().find(|note| note.code == "N_NEVER_COMPLETE").expect("hidden source remains incomplete");
    assert!(!note.rewrite.contains("cap 50"), "an unreadable source has no cap-only repair: {}", note.rewrite);
}
