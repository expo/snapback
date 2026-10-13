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
  species: enum('a', 'b', 'c', 'd') ?
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
#[test]
fn a_readable_static_predicate_keeps_system_selection_and_safe_cut_continuations() {
    let source = ROLE.replace("return docs first 1", "return docs where (.owner = viewer or exists roles[principal = viewer, role = 'admin']) first 1");
    let b = clean(&source); assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:?}", b.notes);
    let rows = vec![
        ("roles", vec![("id", id("grant")), ("principal", id("sam")), ("role", Value::String("admin".into()))]),
        doc("a", "bob", 1, 1), doc("b", "sam", 2, 2), doc("c", "sam", 3, 3), doc("d", "bob", 4, 4)];
    let mut full = engine(&source, rows.clone());
    let all = walk(&mut full, "list", "sam", &[]).0;
    assert_eq!(all, ["a", "b", "c", "d"]);
    let mut system = Context::system(); system.args.insert("c".into(), Value::Null);
    assert!(ids(&full.query("list", system).unwrap().data).is_empty(), "the system keeps W, even though it bypasses R");
    let mut exercised = 0;
    for ceiling in 1..32 {
        let mut e = engine(&source, rows.clone());
        e.set_ceilings(snapback4_core::Ceilings { examined: ceiling, ..Default::default() });
        let page = e.query("list", Context::new("sam", BTreeMap::from([("c".into(), Value::Null)]))).unwrap();
        if page.complete { continue; }
        exercised += 1;
        let mut got = ids(&page.data);
        if let Some(cursor) = page.next {
            e.set_ceilings(snapback4_core::Ceilings::default());
            let rest = e.query("list", Context::new("sam", BTreeMap::from([("c".into(), Value::String(cursor))]))).unwrap();
            got.extend(ids(&rest.data));
            assert_eq!(got, all[..got.len()], "ceiling {ceiling}: interrupted predicates cannot skip a row");
        } else { assert_eq!(got, all[..got.len()]); }
    }
    assert!(exercised > 0);
}
#[test]
fn an_outer_conjunction_keeps_the_status_condition_in_every_grant_range() {
    let source = COMPOUND.replace(".owner = viewer or (exists roles[viewer] and .open = true)", "(.owner = viewer or exists roles[viewer]) and .open = true");
    let b = clean(&source); assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:?}", b.notes);
    let mut e = engine(&source, vec![
        ("roles", vec![("id", id("grant")), ("principal", id("alice"))]),
        ("docs", vec![("id", id("a")), ("owner", id("bob")), ("open", Value::Bool(true)), ("at", Value::Int(1))]),
        ("docs", vec![("id", id("b")), ("owner", id("alice")), ("open", Value::Bool(false)), ("at", Value::Int(2))])]);
    let (rows, complete) = walk(&mut e, "list", "alice", &[]);
    assert_eq!(rows, ["a"]); assert!(complete.iter().all(|c| *c));
}
#[test]
fn compound_membership_keeps_every_where_alternative() {
    let source = PURE.replace("  read <- exists members[.group, viewer]\n", "  open: bool\n  read <- .owner = viewer or (exists members[.group, viewer] and .open = true)\n")
        .replace("return docs first 1", "return docs where (.owner = 'alice' or .owner = 'bob') first 1");
    let b = clean(&source); assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:?}", b.notes);
    let mut rows = vec![
        ("members", vec![("id", id("m1")), ("group", Value::Int(1)), ("principal", id("erin"))]),
        doc("a", "alice", 1, 1), doc("b", "bob", 1, 2)];
    for (table, fields) in &mut rows { if *table == "docs" { fields.push(("open", Value::Bool(true))); } }
    let mut e = engine(&source, rows);
    let (rows, complete) = walk(&mut e, "list", "erin", &[]);
    assert_eq!(rows, ["a", "b"]); assert!(complete.iter().all(|c| *c));
}
#[test]
fn page2_id_membership_does_not_gain_the_page3_capability() {
    let source = PURE.replace("exists members[.group, viewer]", "exists members[.id, viewer]")
        .replace("  group: int\n  principal", "  group: docs\n  principal");
    let b = clean(&source);
    assert!(b.schema.required_capabilities().contains("branch-membership-v2"));
    assert!(!b.schema.required_capabilities().contains("branch-pages-v2"));
}

fn predicate_roles(expression: &str) -> String {
    format!("table roles:\n  principal: principal\n  slot: int\n  unique principal\n  read <- .principal = viewer\n  online only\ntable docs:\n  owner: principal\n  assignee: principal\n  at: int\n  read <- .owner = viewer or .assignee = viewer\n  online only\nquery list(n: int, c: cursor ?):\n  return docs where (.owner = viewer or (.assignee = viewer and exists roles[principal = viewer, slot = {expression}])) first 2 by .at after c\n")
}
#[test]
fn a_fallible_static_key_keeps_the_original_overlap_short_circuit() {
    let source = predicate_roles("1 / n");
    let b = clean(&source);
    assert!(snapback4_core::ir::body_merges(&b.programs[0].program.body).is_empty(), "a fallible key cannot be redistributed");
    let mut e = engine(&source, vec![("docs", vec![("id", id("both")), ("owner", id("alice")), ("assignee", id("alice")), ("at", Value::Int(1))])]);
    let out = e.query("list", Context::new("alice", BTreeMap::from([("n".into(), Value::Int(0)), ("c".into(), Value::Null)]))).unwrap();
    assert_eq!(ids(&out.data), ["both"]); assert!(!out.complete);
}
#[test]
fn a_block_lowered_static_probe_serializes_the_new_capability() {
    let source = predicate_roles("0");
    let b = clean(&source);
    assert!(!snapback4_core::ir::body_merges(&b.programs[0].program.body).is_empty());
    let required = b.schema.required_capabilities();
    assert!(required.contains("branch-pages-v2"));
    let v1_supported: std::collections::BTreeSet<String> = snapback4_core::schema::Schema::supported_capabilities().into_iter()
        .filter(|cap| cap != "branch-pages-v2").collect();
    assert_eq!(required.difference(&v1_supported).map(String::as_str).collect::<Vec<_>>(), ["branch-pages-v2"]);
    let text = serde_json::to_string(&b.schema).unwrap();
    let roundtrip: snapback4_core::schema::Schema = serde_json::from_str(&text).unwrap();
    assert!(roundtrip.required_capabilities().contains("branch-pages-v2"));
    // An attempted v1-only carrier cannot silently remove the fence.
    let mut encoded: serde_json::Value = serde_json::from_str(&text).unwrap();
    for table in encoded["tables"].as_object_mut().unwrap().values_mut() {
        for constraint in table["constraints"].as_array_mut().unwrap() {
            if let Some(names) = constraint.get_mut("Capabilities").and_then(|names| names.as_array_mut()) {
                names.retain(|name| name != "branch-pages-v2");
            }
        }
    }
    assert!(serde_json::from_value::<snapback4_core::schema::Schema>(encoded).is_err());
}

#[test]
fn four_variant_archive_with_reviewer_is_a_seven_lane_complete_cursor() {
    let source = "table reviewers:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable docs:\n  owner: principal\n  species: enum('a', 'b', 'c', 'd') ?\n  at: int\n  read <- .owner = viewer or exists reviewers[viewer] or .species != null\n  online only\nquery list(c: cursor ?):\n  return docs where .species != null first 1 by .at after c\n";
    let b = clean(source); assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:?}", b.notes);
    assert_eq!(snapback4_core::ir::body_merges(&b.programs[0].program.body)[0].lanes.len(), 7);
    let rows = [Some("a"), None, Some("b"), Some("c"), Some("d")].into_iter().enumerate().map(|(at, species)|
        ("docs", vec![("id", id(&format!("r{at}"))), ("owner", id("alice")), ("species", species.map_or(Value::Null, |s| Value::String(s.into()))), ("at", Value::Int(at as i64))])).collect();
    let mut e = engine(source, rows);
    for who in ["alice", "erin"] {
        let (ids, complete) = walk(&mut e, "list", who, &[]);
        assert_eq!(ids, ["r0", "r2", "r3", "r4"]); assert!(complete.iter().all(|c| *c));
    }
}
