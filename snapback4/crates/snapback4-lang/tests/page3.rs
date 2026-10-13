use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::{Bound, compile};
use std::collections::BTreeMap;

fn bound(source: &str) -> Bound { compile(&[("schema.q".into(), source.into())]) }

fn clean(source: &str) -> Bound {
    let b = bound(source);
    assert!(b.diagnostics.is_empty(), "{source}\n{:#?}", b.diagnostics);
    b
}

fn has_note(b: &Bound, code: &str) -> bool { b.notes.iter().any(|n| n.code == code) }

type Rows = Vec<(&'static str, Vec<(&'static str, Value)>)>;

fn engine(source: &str, rows: Rows) -> Engine {
    let b = clean(source);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(rows.into_iter().map(|(table, fields)| (table.to_owned(), object(fields)))).unwrap();
    engine
}

fn id(text: &str) -> Value { Value::Id(text.into()) }

fn ids(data: &Value) -> Vec<String> {
    data.as_array().unwrap().iter().map(|row| match row.field("id") { Ok(Value::Id(id)) => id.clone(), other => panic!("{other:?}") }).collect()
}

/// Every page of `query` by cursor: the ids in order, and whether each page was complete.
fn walk(engine: &mut Engine, query: &str, viewer: &str, extra: &[(&str, Value)]) -> (Vec<String>, Vec<bool>) {
    let mut cursor = Value::Null;
    let mut out = Vec::new();
    let mut complete = Vec::new();
    for _ in 0..50 {
        let mut args: BTreeMap<String, Value> = extra.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect();
        args.insert("c".into(), cursor.clone());
        let outcome = engine.query(query, Context::new(viewer, args)).unwrap_or_else(|e| panic!("{query} as {viewer}: {e:?}"));
        out.extend(ids(&outcome.data));
        complete.push(outcome.complete);
        match outcome.next { Some(next) => cursor = Value::String(next), None => return (out, complete) }
    }
    panic!("{query}: cursor did not end");
}

const ROLE: &str = "table roles:
  principal: principal
  role: text <=20
  unique principal
  read <- .principal = viewer
  online only
table docs:
  owner: principal
  group: int
  at: int
  unique group
  read <- .owner = viewer or exists roles[principal = viewer, role = 'admin']
  online only
query list(c: cursor ?):
  return docs first 1 by .at after c
query group(group: int):
  return docs where .group = group
";
fn doc(name: &'static str, owner: &str, group: i64, at: i64) -> (&'static str, Vec<(&'static str, Value)>) {
    ("docs", vec![("id", id(name)), ("owner", id(owner)), ("group", Value::Int(group)), ("at", Value::Int(at))])
}
#[test]
fn static_role_and_unique_group_pages_are_complete_for_all_callers() {
    let b = clean(ROLE);
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:?}", b.notes);
    assert!(b.schema.required_capabilities().contains("branch-pages-v2"));
    let mut e = engine(ROLE, vec![
        ("roles", vec![("id", id("grant")), ("principal", id("sam")), ("role", Value::String("admin".into()))]),
        ("roles", vec![("id", id("nongrant")), ("principal", id("bob")), ("role", Value::String("staff".into()))]),
        doc("a", "alice", 1, 1), doc("b", "bob", 2, 2), doc("c", "alice", 3, 3)]);
    for (who, expected) in [("sam", vec!["a", "b", "c"]), ("alice", vec!["a", "c"]), ("bob", vec!["b"]), ("erin", vec![])] {
        let (rows, complete) = walk(&mut e, "list", who, &[]);
        assert_eq!(rows, expected); assert!(complete.iter().all(|c| *c));
        let page = e.query("group", Context::new(who, BTreeMap::from([("group".into(), Value::Int(1))]))).unwrap();
        assert!(page.complete, "{who}: {page:?}");
        assert_eq!(ids(&page.data), if who == "sam" || who == "alice" { vec!["a"] } else { vec![] });
    }
}
#[test]
fn implicit_cap_is_the_original_group_bound_not_an_owner_cap() {
    let source = ROLE.replace("  unique group\n", "  cap 4 by group\n");
    let b = clean(&source);
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:?}", b.notes);
    let no_group_bound = source.replace("  cap 4 by group\n", "  cap 4 by owner\n");
    let b = bound(&no_group_bound);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_BOUND"));
}
const PURE: &str = "table members:
  group: int
  principal: principal
  unique group, principal
  read <- .principal = viewer
  online only
table docs:
  owner: principal
  group: int
  at: int
  read <- exists members[.group, viewer]
  online only
query list(c: cursor ?):
  return docs first 1 by .at after c
";
#[test]
fn membership_without_a_party_walks_and_fences_discovery_cuts() {
    let b = clean(PURE); assert!(!has_note(&b, "N_NEVER_COMPLETE"));
    let rows = vec![
        ("members", vec![("id", id("m1")), ("group", Value::Int(1)), ("principal", id("alice"))]),
        ("members", vec![("id", id("m2")), ("group", Value::Int(2)), ("principal", id("alice"))]),
        doc("a", "bob", 1, 1), doc("b", "bob", 2, 2), doc("hidden", "alice", 9, 3)];
    let mut e = engine(PURE, rows.clone());
    let (rows_out, complete) = walk(&mut e, "list", "alice", &[]);
    assert_eq!(rows_out, ["a", "b"]); assert!(complete.iter().all(|c| *c));
    assert_eq!(walk(&mut e, "list", "erin", &[]), (vec![], vec![true]));
    for examined in 1..4 {
        let mut e = engine(PURE, rows.clone());
        e.set_ceilings(snapback4_core::Ceilings { examined, ..Default::default() });
        let page = e.query("list", Context::new("alice", BTreeMap::from([("c".into(), Value::Null)]))).unwrap();
        assert!(ids(&page.data).is_empty() && !page.complete && page.next.is_none(), "{examined}: {page:?}");
    }
}
const COMPOUND: &str = "table roles:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table docs:
  owner: principal
  open: bool
  at: int
  read <- .owner = viewer or (exists roles[viewer] and .open = true)
  online only
query list(c: cursor ?):
  return docs first 1 by .at after c
";
#[test]
fn a_compound_role_opens_only_its_status_range_and_deduplicates() {
    let b = clean(COMPOUND); assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:?}", b.notes);
    let mut e = engine(COMPOUND, vec![
        ("roles", vec![("id", id("grant")), ("principal", id("alice"))]),
        ("docs", vec![("id", id("a")), ("owner", id("bob")), ("open", Value::Bool(true)), ("at", Value::Int(1))]),
        ("docs", vec![("id", id("b")), ("owner", id("bob")), ("open", Value::Bool(false)), ("at", Value::Int(2))]),
        ("docs", vec![("id", id("c")), ("owner", id("alice")), ("open", Value::Bool(true)), ("at", Value::Int(3))]),
        ("docs", vec![("id", id("d")), ("owner", id("alice")), ("open", Value::Bool(false)), ("at", Value::Int(4))])]);
    for (who, expected) in [("alice", vec!["a", "c", "d"]), ("bob", vec!["a", "b"]), ("erin", vec![])] {
        let (rows, complete) = walk(&mut e, "list", who, &[]);
        assert_eq!(rows, expected); assert!(complete.iter().all(|c| *c));
    }
}
#[test]
fn compound_parent_membership_preserves_both_status_alternatives() {
    let source = PURE.replace("  read <- exists members[.group, viewer]\n", "  open: bool\n  read <- .owner = viewer or (exists members[.group, viewer] and .open = true)\n");
    let b = clean(&source); assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:?}", b.notes);
    let mut rows = vec![
        ("members", vec![("id", id("m1")), ("group", Value::Int(1)), ("principal", id("alice"))]),
        doc("a", "bob", 1, 1), doc("b", "bob", 1, 2), doc("c", "alice", 9, 3)];
    for (table, fields) in &mut rows { if *table == "docs" { fields.push(("open", Value::Bool(fields[0].1 != id("b")))); } }
    let mut e = engine(&source, rows);
    let (rows, complete) = walk(&mut e, "list", "alice", &[]);
    assert_eq!(rows, ["a", "c"]); assert!(complete.iter().all(|c| *c));
}
#[test]
fn nullable_enum_non_equality_includes_only_non_null_variants() {
    let source = "table docs:
  owner: principal
  species: enum('a', 'b') ?
  at: int
  read <- .owner = viewer or .species != null
  online only
query list(c: cursor ?):
  return docs where .species != null first 1 by .at after c
";
    let b = clean(source); assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:?}", b.notes);
    let rows = [("a", Some("a")), ("b", None), ("c", Some("b"))].into_iter().enumerate().map(|(at, (name, species))|
        ("docs", vec![("id", id(name)), ("owner", id("alice")), ("species", species.map_or(Value::Null, |s| Value::String(s.into()))), ("at", Value::Int(at as i64))])).collect();
    let mut e = engine(source, rows);
    let (rows, complete) = walk(&mut e, "list", "erin", &[]);
    assert_eq!(rows, ["a", "c"]); assert!(complete.iter().all(|c| *c));
}
