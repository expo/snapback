//! Table ids end the meaningful order; projected view orders stay intact.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::compile;
use std::collections::BTreeMap;

fn bound(source: &str) -> snapback4_lang::Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}

fn context(cursor: Option<String>) -> Context {
    Context::new("alice", BTreeMap::from([("c".into(), cursor.map(Value::String).unwrap_or(Value::Null))]))
}

#[test]
fn table_order_after_id_has_identical_plans_and_cursor_pages() {
    for (read, short, long, expected) in [
        ("t", ".id", ".id, .at", vec!["a", "b", "c"]),
        ("t", ".rank, .id", ".rank, .id, .at, .rank", vec!["b", "a", "c"]),
        ("t where .at = 2", ".id", ".id, .at", vec!["b"]),
        ("t where .rank in [1, 2]", ".id", ".id, .at", vec!["a", "b", "c"]),
        ("t matching 'hello'", ".id", ".id, .at", vec!["a", "b", "c"]),
    ] {
        for direction in ["first", "last"] {
            let source = |order| format!("table t:\n  at: time\n  rank: int\n  body: text <=20\n  search body\n  public 't'\nquery page(c: cursor ?):\n  return {read} {direction} 1 by {order} after c\n");
            let a = bound(&source(short));
            let b = bound(&source(long));
            assert_eq!(a.schema.tables, b.schema.tables, "index/schema mismatch: {read} by {long}");
            assert_eq!(a.programs[0].program, b.programs[0].program, "executable plan mismatch: {read} by {long}");
            if read == "t" && short == ".id" {
                assert_eq!(b.schema.tables["t"].indexes.keys().map(String::as_str).collect::<Vec<_>>(), ["byId"]);
                assert_eq!(snapback4_core::ir::scans(&b.programs[0].program)[0].index, "byId");
            }
            let mut engines = [a, b].map(|b| Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap());
            for engine in &mut engines {
                engine.seed([("a", 3, 2), ("b", 2, 1), ("c", 1, 2)].map(|(key, at, rank)| ("t".into(), object([
                    ("id", Value::Id(key.into())), ("at", Value::Int(at)), ("rank", Value::Int(rank)), ("body", Value::String("hello".into())),
                ])))).unwrap();
            }
            let mut expected = expected.clone();
            if direction == "last" { expected.reverse(); }
            let mut cursor = None;
            for (position, key) in expected.iter().enumerate() {
                // The same opaque continuation must work for either spelling.
                let [a, b] = engines.each_mut().map(|engine| engine.query("page", context(cursor.clone())).unwrap());
                assert_eq!((&a.data, a.complete, &a.next), (&b.data, b.complete, &b.next));
                assert!(a.complete, "{read} {direction}: {a:?}");
                assert_eq!(a.data.as_array().unwrap().len(), 1);
                assert_eq!(a.data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id((*key).into()));
                assert_eq!(a.next.is_some(), position + 1 < expected.len());
                cursor = a.next;
            }
        }
    }
}

#[test]
fn nested_table_orders_normalize_before_planning() {
    for expression in [
        "count(t first 2 by ORDER)",
        "{ rows: t first 1 by ORDER after c }",
        "v first 1 by .id after c",
    ] {
        let source = format!("table t:\n  at: time\n  public 't'\nview v:\n  t {{ id, n: count(t first 2 by ORDER) }}\nquery page(c: cursor ?):\n  return {expression}\n");
        let a = bound(&source.replace("ORDER", ".id"));
        let b = bound(&source.replace("ORDER", ".id, .at"));
        assert_eq!(a.schema.tables, b.schema.tables);
        assert_eq!(a.programs[0].program, b.programs[0].program);
        assert_eq!(b.schema.tables["t"].indexes.len(), 1);
    }
}

#[test]
fn union_order_after_literal_id_keeps_cross_branch_ties() {
    for (direction, expected) in [("first", [1, 3, 2, 4]), ("last", [4, 2, 3, 1])] {
        let b = bound(&format!("table a:\n  at: time\n  public 'a'\ntable b:\n  at: time\n  public 'b'\nview v:\n  a {{ id, at }}\n  b {{ id, at }}\nquery page(c: cursor ?):\n  return v {direction} 1 by .id, .at after c\n"));
        let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        engine.seed([("a", "x", 3), ("b", "x", 1), ("a", "y", 2), ("b", "y", 4)].map(|(table, id, at)|
            (table.into(), object([("id", Value::Id(id.into())), ("at", Value::Int(at))])))).unwrap();
        let mut cursor = None;
        for (position, at) in expected.iter().enumerate() {
            let page = engine.query("page", context(cursor)).unwrap();
            assert!(page.complete, "{direction}: {page:?}");
            assert_eq!(page.data.as_array().unwrap().len(), 1);
            assert_eq!(page.data.as_array().unwrap()[0].field("at").unwrap(), &Value::Int(*at));
            assert_eq!(page.next.is_some(), position + 1 < expected.len());
            cursor = page.next;
        }
    }
}
