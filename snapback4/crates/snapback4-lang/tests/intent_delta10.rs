//! Round 10: optimizations preserve consumers, guards and continuation.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::{Bound, compile};
use std::collections::BTreeMap;
fn bound(source: &str) -> Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}\n{source}", b.diagnostics);
    b
}
fn engine(b: Bound) -> Engine { Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap() }
fn args(cursor: Option<String>) -> BTreeMap<String, Value> { BTreeMap::from([("c".into(), cursor.map(Value::String).unwrap_or(Value::Null))]) }
fn ids(data: &Value) -> Vec<String> { data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_owned()).collect() }
fn total_source(cap: &str, kind: &str, predicate: &str) -> String {
    let read = format!("t where {predicate}");
    let expression = if kind == "count" { format!("count({read})") } else { format!("sum({read}, .n)") };
    format!("table t:\n  status: enum('todo', 'doing', 'done')\n  n: int\n  public 't'\n{cap}query q():\n  return {expression}\n")
}
#[test]
fn unpaged_enum_count_and_sum_compile_without_caps() {
    for kind in ["count", "sum"] {
        for predicate in [".status != 'done'", ".status in ['todo', 'doing']"] {
            let b = bound(&total_source("", kind, predicate));
            assert!(snapback4_core::ir::scans(&b.programs[0].program).iter().all(|s| s.take == snapback4_core::ir::Bound::Meter));
            let mut engine = engine(b);
            engine.seed((0..4).map(|n| ("t".into(), object([("id", Value::Id(n.to_string())), ("status", Value::String(if n == 1 { "doing" } else { "todo" }.into())), ("n", Value::Int(3))])))).unwrap();
            engine.seed([("t".into(), object([("id", Value::Id("done".into())), ("status", Value::String("done".into())), ("n", Value::Int(100))]))]).unwrap();
            let page = engine.query("q", Context::new("alice", BTreeMap::new())).unwrap();
            assert!(page.complete);
            assert_eq!(page.data, Value::Int(if kind == "count" { 4 } else { 12 }));
        }
    }
}
#[test]
fn interrupted_enum_totals_never_publish_a_partial_number() {
    for kind in ["count", "sum"] {
        for predicate in [".status != 'done'", ".status in ['todo', 'doing']"] {
            let mut engine = engine(bound(&total_source("  cap 100\n", kind, predicate)));
            engine.seed((0..4).map(|n| ("t".into(), object([("id", Value::Id(n.to_string())), ("status", Value::String("todo".into())), ("n", Value::Int(3))])))).unwrap();
            engine.set_ceilings(snapback4_core::Ceilings { examined: 1, ..Default::default() });
            let page = engine.query("q", Context::new("alice", BTreeMap::new())).unwrap();
            assert!(!page.complete && page.next.is_none(), "{page:?}");
            assert_eq!(page.data, Value::Null, "{kind} {predicate}: {page:?}");
        }
    }
}
#[test]
fn parenthesized_nullable_predicate_accepts_a_named_page_shape() {
    let mut engine = engine(bound("table tasks:\n  due: time ?\n  public 'tasks'\nshape card = { id, due }\nquery q(c: cursor ?):\n  return tasks first 10 by .id after c where (.due < now) card\n"));
    engine.seed([( "a", Value::Null), ("b", Value::Int(1)), ("c", Value::Int(3))].map(|(id, due)| ("tasks".into(), object([("id", Value::Id(id.into())), ("due", due)])))).unwrap();
    let page = engine.query("q", Context::new("alice", args(None)).at(2)).unwrap();
    assert!(page.complete);
    assert_eq!(ids(&page.data), ["b"]);
}
#[test]
fn unpinned_enum_complements_and_value_lists_keep_continuations() {
    for predicate in [".status != 'done'", ".status in ['todo', 'doing']"] {
        for direction in ["first", "last"] {
            let b = bound(&format!("table t:\n  orgId: principal\n  status: enum('todo', 'doing', 'done')\n  createdAt: time\n  read <- .orgId = viewer\nquery q(c: cursor ?):\n  return t where {predicate} {direction} 1 by .createdAt after c\n"));
            let mut engine = engine(b);
            engine.seed([("a1", "alice", "todo", 1), ("a2", "alice", "doing", 1), ("a3", "alice", "todo", 2),
                ("b0", "bob", "todo", 0), ("b1", "bob", "doing", 1), ("b2", "bob", "todo", 3)]
                .map(|(id, owner, status, at)| ("t".into(), object([("id", Value::Id(id.into())), ("orgId", Value::Id(owner.into())), ("status", Value::String(status.into())), ("createdAt", Value::Int(at))])))).unwrap();
            let mut cursor = None;
            let mut actual = Vec::new();
            for _ in 0..6 {
                let page = engine.query("q", Context::new("alice", args(cursor))).unwrap();
                assert!(!page.complete, "a residual cannot certify a non-uniform read");
                actual.extend(ids(&page.data));
                cursor = page.next.clone();
                if actual.len() < 3 { assert!(cursor.is_some(), "remaining visible rows need a continuation: {page:?}"); }
                if cursor.is_none() { break; }
            }
            assert!(cursor.is_none());
            assert_eq!(actual, if direction == "first" { vec!["a1", "a2", "a3"] } else { vec!["a3", "a2", "a1"] });
        }
    }
}
#[test]
fn ordered_seek_endpoints_respect_short_circuit_guards_and_narrowing() {
    for (decl, predicate, arg, value) in [
        ("d: int", "d != 0 and .at > 10 / d", "d", Value::Int(0)),
        ("x: time ?", "x != null and .at < x", "x", Value::Null),
        ("d: int", "d < 9007199254740991 and .at > d + 1", "d", Value::Int(9007199254740991)),
    ] {
        let b = bound(&format!("table t:\n  at: time ?\n  public 't'\nquery q({decl}, c: cursor ?):\n  return t where {predicate} first 50 by .at after c\n"));
        // The guard reads no row, so it is decided once as an `if` (LLP 3000.036 §15.4) and the
        // seek's endpoint is evaluated only inside its branch; otherwise the endpoint stays a residual.
        let program = &b.programs[0].program;
        assert!(matches!(program.body.last(), Some(snapback4_core::ir::Stmt::If { .. })) || snapback4_core::ir::scans(program).iter().all(|s| s.range.is_none()));
        let mut engine = engine(b);
        engine.seed([("null", Value::Null), ("a", Value::Int(1)), ("b", Value::Int(20))].map(|(id, at)| ("t".into(), object([("id", Value::Id(id.into())), ("at", at)])))).unwrap();
        let mut values = args(None); values.insert(arg.into(), value);
        let page = engine.query("q", Context::new("alice", values)).unwrap();
        assert!(page.complete && ids(&page.data).is_empty(), "{page:?}");
        let mut values = args(None); values.insert(arg.into(), Value::Int(if arg == "x" { 10 } else { 1 }));
        let page = engine.query("q", Context::new("alice", values)).unwrap();
        assert!(page.complete);
        assert_eq!(ids(&page.data), if arg == "x" { vec!["a"] } else { vec!["b"] });
    }
}

#[test]
fn present_and_proven_safe_arithmetic_endpoints_still_seek() {
    for endpoint in ["start", "start + 0", "1 + 2 * 3", "-(-7)"] {
        let b = bound(&format!("table t:\n  at: time ?\n  public 't'\nquery q(start: time, c: cursor ?):\n  return t where .at > {endpoint} first 50 by .at after c\n"));
        assert!(snapback4_core::ir::scans(&b.programs[0].program)[0].range.is_some(), "{endpoint}");
        let mut engine = engine(b);
        engine.seed([("null", Value::Null), ("a", Value::Int(1)), ("b", Value::Int(20))].map(|(id, at)| ("t".into(), object([("id", Value::Id(id.into())), ("at", at)])))).unwrap();
        let mut values = args(None); values.insert("start".into(), Value::Int(10));
        let page = engine.query("q", Context::new("alice", values)).unwrap();
        assert!(page.complete && page.metered.examined <= 1, "{endpoint}: {page:?}");
        assert_eq!(ids(&page.data), ["b"]);
    }
}
