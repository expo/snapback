//! Point lookup cuts in expressions and page predicates, shared by hosts.
use snapback4_core::{Ceilings, Context, QueryOutcome, Value};
use snapback4_core::value::object;
use std::collections::BTreeMap;

pub const SOURCE: &str = r#"
table items:
  owner: principal
  body: text <=20
  by byOwner: owner, id
  cap 10 by owner
  read <- .owner = viewer
  sync to .owner
table markers:
  eventId: items
  owner: principal
  unique byEvent: eventId
  by byOwner: owner, id
  cap 10 by owner
  read <- .owner = viewer
  sync to .owner
query point(itemId: items):
  return markers[eventId = itemId]
query missing(itemId: items):
  return not exists markers[eventId = itemId]
query shaped(c: cursor ?):
  return items[viewer] after c first 2 by byOwner { body, marker: markers[eventId = .id] }
query guarded(c: cursor ?):
  return items[viewer] after c first 2 by byOwner { body: null if exists markers[eventId = .id] else .body }
query filtered(c: cursor ?):
  return items[viewer] after c first 2 by byOwner where not exists markers[eventId = .id]
fn visibleBody(item: items):
  if exists markers[eventId = item.id]:
    return null
  return item.body
query helper(c: cursor ?):
  return items[viewer] after c first 2 by byOwner { body: visibleBody(.) }
query required(itemId: items):
  marker = markers[eventId = itemId] ! else MARKER_MISSING
  return marker.owner
"#;

pub fn seed(world: &str) -> Vec<(String, Value)> {
    let mut rows: Vec<_> = (0..4).map(|n| ("items".into(), object([
        ("id", Value::Id(format!("item{n}"))), ("owner", Value::Id("dev:alice".into())), ("body", Value::String(format!("body{n}"))),
    ]))).collect();
    rows.push(("markers".into(), object([
        ("id", Value::Id("marker".into())), ("eventId", Value::Id(if world == "absent" { "elsewhere" } else { "item0" }.into())),
        ("owner", Value::Id(if world == "visible" { "dev:alice" } else { "dev:bob" }.into())),
    ])));
    rows
}

pub fn context(name: &str) -> Context {
    let args = if matches!(name, "point" | "missing" | "required") { BTreeMap::from([("itemId".into(), Value::Id("item0".into()))]) } else { BTreeMap::new() };
    Context::new("dev:alice", args).at(100)
}

pub fn check(host: &str, world: &str, mut query: impl FnMut(&str, Ceilings) -> QueryOutcome) -> Vec<QueryOutcome> {
    let mut observations = Vec::new();
    for (name, examined) in [("point", 0), ("missing", 0), ("shaped", 3), ("guarded", 3), ("filtered", 1), ("helper", 3)] {
        let control = query(name, Ceilings::default());
        assert!(control.complete, "{host} {world} {name}: {control:?}");
        if name == "missing" { assert_eq!(control.data, Value::Bool(world != "visible")); }
        if name == "point" { assert_eq!(control.data == Value::Null, world != "visible"); }
        if name == "filtered" {
            let rows = control.data.as_array().unwrap();
            assert_eq!(rows.len(), 2);
            assert_eq!(rows[0].field("body").unwrap(), &Value::String(if world == "visible" { "body1" } else { "body0" }.into()));
            assert!(control.next.is_some());
        }
        let cut = query(name, Ceilings { examined, ..Ceilings::default() });
        assert!(!cut.complete, "{host} {world} {name}: {cut:?}");
        assert_eq!(cut.data, Value::Null, "{host} {world} {name}: unknown never selects a branch");
        assert!(cut.next.is_none(), "{host} {world} {name}: no continuation past unknown work");
        assert!(cut.capped_at.is_some());
        observations.extend([control, cut]);
    }
    let probe_cut = query("filtered", Ceilings { rule_probes: 0, ..Ceilings::default() });
    assert_eq!(probe_cut.data, Value::Null);
    assert!(!probe_cut.complete);
    assert!(probe_cut.next.is_none());
    observations.push(probe_cut);
    if world == "visible" {
        assert_eq!(query("required", Ceilings::default()).data, Value::Id("dev:alice".into()));
        let cut = query("required", Ceilings { examined: 0, ..Ceilings::default() });
        assert_eq!(cut.data, Value::Null, "unknown does not raise MARKER_MISSING");
        assert!(!cut.complete);
    }
    println!("POINT_CUT host={host} world={world} expression_forms=6 probe_cut=1 controls=6");
    observations
}
