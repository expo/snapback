//! Inferred access paths must preserve predicate guards and intrinsic-id reads.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::compile;
use std::collections::BTreeMap;

fn bound(source: &str) -> snapback4_lang::Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn aggregate(kind: &str, read: &str) -> String {
    match kind {
        "count" => format!("count({read})"),
        "sum" => format!("sum(({read}), .at)"),
        "exists" => format!("exists {read}"),
        _ => unreachable!(),
    }
}
fn engine(b: snapback4_lang::Bound) -> Engine {
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("a", 1), ("b", 20), ("c", 40)].map(|(id, at)|
        ("t".into(), object([("id", Value::Id(id.into())), ("at", Value::Int(at))])))).unwrap();
    engine
}
fn expected(kind: &str, count: i64, sum: i64) -> Value {
    match kind { "count" => Value::Int(count), "sum" => Value::Int(sum), "exists" => Value::Bool(count != 0), _ => unreachable!() }
}

#[test]
fn aggregate_bounds_preserve_division_and_overflow_guards() {
    for predicate in [
        "d != 0 and .at > 10 / d",
        "d != 0 and .at > 10 / d and .at < 100",
        "d != 0 and .at < 100 and .at > 10 / d",
        "d < 9007199254740991 and .at > d + 1",
    ] {
        for kind in ["count", "sum", "exists"] {
            let expression = aggregate(kind, &format!("t where {predicate}"));
            let source = format!("table t:\n  at: int\n  public 't'\n  cap 20\nquery q(d: int):\n  return {expression}\n");
            let b = bound(&source);
            let scans = snapback4_core::ir::scans(&b.programs[0].program);
            assert!(scans.iter().all(|scan| scan.range.is_none()), "unsafe endpoints must remain predicates");
            let mut engine = engine(b);
            let guarded = if predicate.starts_with("d <") { (1_i64 << 53) - 1 } else { 0 };
            for (d, count, sum) in [(guarded, 0, 0), (1, 2, 60)] {
                let page = engine.query("q", Context::new("alice", BTreeMap::from([("d".into(), Value::Int(d))]))).unwrap();
                assert!(page.complete, "{kind}: {page:?}");
                assert_eq!(page.data, expected(kind, count, sum), "{predicate}");
            }
        }
    }
}

#[test]
fn aggregate_bounds_preserve_nullable_parameter_narrowing() {
    for predicate in ["x != null and .at > x", "x != null and .at > x and .at < 100"] {
        for kind in ["count", "sum", "exists"] {
            let expression = aggregate(kind, &format!("t where {predicate}"));
            let b = bound(&format!("table t:\n  at: time\n  public 't'\n  cap 20\nquery q(x: time ?):\n  return {expression}\n"));
            assert!(snapback4_core::ir::scans(&b.programs[0].program).iter().all(|scan| scan.range.is_none()));
            let mut engine = engine(b);
            for (x, count, sum) in [(Value::Null, 0, 0), (Value::Int(10), 2, 60)] {
                let page = engine.query("q", Context::new("alice", BTreeMap::from([("x".into(), x)]))).unwrap();
                assert!(page.complete, "{kind}: {page:?}");
                assert_eq!(page.data, expected(kind, count, sum));
            }
        }
    }
}

#[test]
fn aggregate_named_id_prefix_keeps_single_row_filtering() {
    for kind in ["count", "sum", "exists"] {
        let expression = aggregate(kind, "t[id = x] where .at > 10");
        let source = format!("table t:\n  at: int\n  public 't'\n  cap 20\nquery q(x: id):\n  return {expression}\n");
        let b = bound(&source);
        let explicit = bound(&source.replace(".at > 10", ".at > 10 by .id"));
        assert_eq!(b.programs[0].program, explicit.programs[0].program);
        assert_eq!(b.schema.tables, explicit.schema.tables);
        assert_eq!(b.schema.tables["t"].indexes.keys().map(String::as_str).collect::<Vec<_>>(), ["byId"]);
        let mut engine = engine(b);
        for (id, count, sum) in [("a", 0, 0), ("b", 1, 20), ("missing", 0, 0)] {
            let page = engine.query("q", Context::new("alice", BTreeMap::from([("x".into(), Value::Id(id.into()))]))).unwrap();
            assert!(page.complete, "{kind}: {page:?}");
            assert_eq!(page.data, expected(kind, count, sum));
            assert!(page.metered.examined <= 1, "{page:?}");
        }
    }
}

#[test]
fn aggregate_lone_lower_bound_seeks_without_examining_the_prefix() {
    for kind in ["count", "sum", "exists"] {
        let expression = aggregate(kind, "t where .at > start");
        let b = bound(&format!("table t:\n  at: int\n  public 't'\n  cap 100\nquery q(start: int):\n  return {expression}\n"));
        let scans = snapback4_core::ir::scans(&b.programs[0].program);
        assert_eq!(scans.len(), 1);
        assert!(scans[0].range.is_some(), "the lone range must become a seek");
        assert_eq!(b.schema.tables["t"].indexes[&scans[0].index].columns(), ["at", "id"]);
        let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        engine.seed((0..100).map(|at| ("t".into(), object([("id", Value::Id(format!("r{at:03}"))), ("at", Value::Int(at))])))).unwrap();
        let page = engine.query("q", Context::new("alice", BTreeMap::from([("start".into(), Value::Int(96))]))).unwrap();
        assert!(page.complete, "{kind}: {page:?}");
        assert_eq!(page.data, expected(kind, 3, 294));
        assert!(page.metered.examined <= 3, "the excluded 97-row prefix must not be examined: {page:?}");
    }
}

#[test]
fn aggregate_endpoint_proofs_follow_helper_parameter_types() {
    let source = "table t:\n  at: int\n  public 't'\n  cap 20\nfn required(start: int): count(t where .at > start)\nfn optional(start: int ?):\n  return count(t where start != null and .at > start)\nfn divide(d: int): 10 / d\nquery present(start: int):\n  return required(start)\nquery absent(start: int):\n  return optional(null)\nquery guarded(d: int):\n  return count(t where d != 0 and .at > divide(d))\n";
    let b = bound(source);
    for program in &b.programs {
        let scans = snapback4_core::ir::scans(&program.program);
        assert_eq!(scans.len(), 1);
        assert_eq!(scans[0].range.is_some(), program.program.name == "present");
    }
    let mut engine = engine(b);
    for (query, name, value, count) in [("present", "start", 10, 2), ("absent", "start", 10, 0), ("guarded", "d", 0, 0)] {
        let page = engine.query(query, Context::new("alice", BTreeMap::from([(name.into(), Value::Int(value))]))).unwrap();
        assert!(page.complete, "{page:?}");
        assert_eq!(page.data, Value::Int(count));
    }
}
