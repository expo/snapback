//! Reproductions from the first blind review of LLP 3000.013 lane A.
use snapback4_core::{Context, Engine, Value};
use snapback4_lang::compile;
use std::collections::BTreeMap;

fn engine(source: &str) -> Engine {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn row(id: &str, at: Value) -> Value {
    Value::Row(BTreeMap::from([("id".into(), Value::Id(id.into())), ("at".into(), at)]).into())
}
fn context(cursor: Option<String>) -> Context {
    Context::new("alice", BTreeMap::from([("c".into(), cursor.map(Value::String).unwrap_or(Value::Null))]))
}
fn ids(value: &Value) -> Vec<String> {
    value.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()).collect()
}

#[test]
fn id_alias_keeps_its_position_before_other_order_keys() {
    for (direction, expected) in [("first", vec!["a", "b", "c"]), ("last", vec!["c", "b", "a"])] {
        let mut engine = engine(&format!("table t:\n  at: time\n  public 't'\nview v:\n  t {{ source: .id, at }}\nquery page(c: cursor ?):\n  return v {direction} 1 by .source, .at after c\n"));
        engine.seed([("a", 3), ("b", 2), ("c", 1)].map(|(id, at)| ("t".into(), row(id, Value::Int(at))))).unwrap();
        let mut cursor = None;
        let mut actual = Vec::new();
        for _ in 0..4 {
            let page = engine.query("page", context(cursor)).unwrap();
            assert!(page.complete, "{page:?}");
            actual.extend(ids(&page.data));
            cursor = page.next;
            if cursor.is_none() { break; }
        }
        assert_eq!(actual, expected, "{direction}");
    }
}

#[test]
fn id_alias_union_orders_equal_ids_by_the_following_field() {
    for (direction, expected) in [("first", vec![1, 3, 2, 4]), ("last", vec![4, 2, 3, 1])] {
        let mut engine = engine(&format!("table a:\n  at: time\n  public 'a'\ntable b:\n  at: time\n  public 'b'\nview v:\n  a {{ source: .id, at }}\n  b {{ source: .id, at }}\nquery page(c: cursor ?):\n  return v {direction} 1 by .source, .at after c\n"));
        engine.seed([("a", "x", 3), ("b", "x", 1), ("a", "y", 2), ("b", "y", 4)]
            .map(|(table, id, at)| (table.into(), row(id, Value::Int(at))))).unwrap();
        let mut cursor = None;
        let mut actual = Vec::new();
        for _ in 0..5 {
            let page = engine.query("page", context(cursor)).unwrap();
            assert!(page.complete, "{page:?}");
            actual.extend(page.data.as_array().unwrap().iter().map(|row| row.field("at").unwrap().as_int().unwrap()));
            cursor = page.next;
            if cursor.is_none() { break; }
        }
        assert_eq!(actual, expected, "{direction}");
    }
}

#[test]
fn wrapped_view_page_owns_its_shared_cursor() {
    let mut engine = engine("table t:\n  at: time\n  public 't'\nview v:\n  t { at }\nquery page(c: cursor ?):\n  cursor = c\n  return { events: v first 1 by .at after cursor, label: 'events' }\n");
    engine.seed((1..=3).map(|at| ("t".into(), row(&at.to_string(), Value::Int(at))))).unwrap();
    let mut cursor = None;
    let mut actual = Vec::new();
    for _ in 0..4 {
        let page = engine.query("page", context(cursor)).unwrap();
        assert!(page.complete, "{page:?}");
        actual.extend(ids(page.data.field("events").unwrap()));
        cursor = page.next;
        if cursor.is_none() { break; }
    }
    assert_eq!(actual, ["1", "2", "3"]);
}

#[test]
fn view_charges_source_rows_even_when_projection_drops_the_payload() {
    let mut engine = engine("table t:\n  body: text <=1000000\n  public 't'\nview v:\n  t { id }\nquery direct():\n  return t first 20\nquery projected():\n  return v first 20\n");
    engine.seed((0..20).map(|n| ("t".into(), Value::Row(BTreeMap::from([
        ("id".into(), Value::Id(format!("r{n:02}"))), ("body".into(), Value::String("x".repeat(1_000_000))),
    ]).into())))).unwrap();
    for query in ["direct", "projected"] {
        let page = engine.query(query, Context::new("alice", BTreeMap::new())).unwrap();
        println!("{query}: heap={}, complete={}, next={:?}", page.metered.heap_bytes, page.complete, page.next);
        assert!(!page.complete && page.next.is_none(), "{query}: {page:?}");
        assert_eq!(page.data, Value::Null, "a heap cut clears the page");
        assert!(page.metered.heap_bytes >= engine.ceilings().heap_bytes, "{query}: {:?}", page.metered);
    }
}

#[test]
fn ordered_nullable_equality_remains_an_exact_predicate() {
    for direction in ["first", "last"] {
        let mut engine = engine(&format!("table t:\n  at: time ?\n  public 't'\nquery page(c: cursor ?):\n  return t where .at = null {direction} 1 by .at after c\n"));
        engine.seed([("a", Value::Null), ("b", Value::Int(1)), ("c", Value::Null)].map(|(id, at)| ("t".into(), row(id, at)))).unwrap();
        let mut cursor = None;
        let mut actual = Vec::new();
        for _ in 0..4 {
            let page = engine.query("page", context(cursor)).unwrap();
            assert!(page.complete, "{page:?}");
            actual.extend(ids(&page.data));
            cursor = page.next;
            if cursor.is_none() { break; }
        }
        assert_eq!(actual, if direction == "first" { vec!["a", "c"] } else { vec!["c", "a"] });
    }
}

#[test]
fn single_branch_view_preserves_mutation_scan_admission() {
    let source = "table t:\n  owner: principal\n  cap 5 by owner\n  read <- .owner = viewer\n  sync to .owner\nview v:\n  t { owner }\nmutation direct():\n  return t where .owner = viewer\nmutation projected():\n  return v where .owner = viewer\n";
    let mut engine = engine(source);
    engine.seed([("a", "alice"), ("b", "bob")].map(|(id, owner)| ("t".into(), Value::Row(BTreeMap::from([
        ("id".into(), Value::Id(id.into())), ("owner".into(), Value::Id(owner.into())),
    ]).into())))).unwrap();
    for query in ["direct", "projected"] {
        let result = engine.mutate(query, None, Context::new("alice", BTreeMap::new())).unwrap();
        let snapback4_core::engine::WriteState::Sent { result: data, .. } = result.state else { panic!("{result:?}") };
        assert_eq!(ids(&data), ["a"]);
    }
    let unbounded = source.replace("  cap 5 by owner\n", "");
    let refused = compile(&[("schema.q".into(), unbounded)]);
    assert!(refused.diagnostics.iter().any(|d| d.code == "E_QUARRY_BOUND"), "{:?}", refused.diagnostics);
}

#[test]
fn single_branch_view_does_not_relax_mutation_visibility_or_expiry() {
    for table in [
        "table t:\n  owner: principal\n  removed: bool\n  read <- .owner = viewer and .removed = false\n",
        "table t:\n  owner: principal\n  expires: time ?\n  expire at .expires\n  read <- .owner = viewer\n",
    ] {
        for source in ["t", "v"] {
            let bound = compile(&[("schema.q".into(), format!("{table}view v:\n  t {{ owner }}\nmutation page():\n  return {source} where .owner = viewer first 5\n"))]);
            assert!(bound.diagnostics.iter().any(|d| d.code == "E_STRUCTURAL_FANOUT"), "{source}: {:?}", bound.diagnostics);
        }
    }
}
