//! Workroom 0.4.1: nullable predicates and finite enum complements.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::{Bound, compile};
use std::collections::BTreeMap;

fn bound(source: &str) -> Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:#?}\n{source}", b.diagnostics);
    b
}
const TABLE: &str = "table tasks:\n  orgId: principal\n  due: time ?\n  other: time ?\n  status: enum('todo', 'doing', 'done')\n  createdAt: time\n  cap 100 by orgId\n  read <- .orgId = viewer\n  sync to .orgId\n";
fn seed(engine: &mut Engine) {
    engine.seed([
        ("a", None, "todo"), ("b", Some(1), "doing"), ("c", Some(1), "todo"),
        ("d", Some(2), "done"), ("e", Some(3), "todo"), ("f", Some(4), "doing"),
    ].into_iter().flat_map(|(id, due, status)| ["alice", "bob"].map(|owner| ("tasks".into(), object([
        ("id", Value::Id(format!("{owner}-{id}"))), ("orgId", Value::Id(owner.into())),
        ("due", due.map(Value::Int).unwrap_or(Value::Null)), ("other", if id == "b" { Value::Null } else { Value::Int(2) }),
        ("status", Value::String(status.into())), ("createdAt", Value::Int(1)),
    ]))))).unwrap();
}
fn engine(b: Bound) -> Engine {
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    seed(&mut engine);
    engine
}
fn pages(engine: &mut Engine, args: BTreeMap<String, Value>) -> Vec<String> {
    let mut cursor = Value::Null;
    let mut result = Vec::new();
    for _ in 0..10 {
        let mut args = args.clone();
        args.insert("c".into(), cursor);
        let page = engine.query("page", Context::new("alice", args).at(2)).unwrap();
        assert!(page.complete, "{page:?}");
        result.extend(page.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()));
        match page.next { Some(next) => cursor = Value::String(next), None => return result }
    }
    panic!("did not exhaust: {result:?}");
}

#[test]
fn nullable_ordering_seeks_and_residuals_page_exactly_in_both_directions() {
    for (predicate, expected) in [
        (".due < now", vec!["b", "c"]), (".due <= now", vec!["b", "c", "d"]),
        (".due > now", vec!["e", "f"]), (".due >= now", vec!["d", "e", "f"]),
        ("now > .due", vec!["b", "c"]), ("now >= .due", vec!["b", "c", "d"]),
        ("now < .due", vec!["e", "f"]), ("now <= .due", vec!["d", "e", "f"]),
        (".due != null and .due < now", vec!["b", "c"]),
        (".due = null", vec!["a"]), (".due != null", vec!["b", "c", "d", "e", "f"]),
        (".due < .other", vec!["c"]), (".due <= .other", vec!["c", "d"]),
        (".due > .other", vec!["e", "f"]), (".due >= .other", vec!["d", "e", "f"]),
        ("not (.due < now)", vec!["a", "d", "e", "f"]),
    ] {
        for order in ["due", "id"] {
            for direction in ["first", "last"] {
                for take in [1, 50] {
                    let b = bound(&format!("{TABLE}query page(c: cursor ?):\n  return tasks where .orgId = viewer and {predicate} {direction} {take} by .{order} after c\n"));
                    let scan = snapback4_core::ir::scans(&b.programs[0].program)[0];
                    if order == "due" && !matches!(predicate, ".due = null" | ".due != null" | ".due < .other" | ".due <= .other" | ".due > .other" | ".due >= .other" | "not (.due < now)") {
                        let range = scan.range.as_ref().expect("ordering predicate must seek");
                        if expected[0] == "b" {
                            assert_eq!(range.gt.as_deref(), Some(&snapback4_core::ir::lit(Value::Null)));
                        }
                    }
                    let mut engine = engine(b);
                    let actual = pages(&mut engine, BTreeMap::new());
                    let mut expected = expected.iter().map(|id| format!("alice-{id}")).collect::<Vec<_>>();
                    if direction == "last" { expected.reverse(); }
                    assert_eq!(actual, expected, "{predicate} {order} {direction} {take}");
                }
            }
        }
    }
}

#[test]
fn nullable_seek_skips_null_work_and_aggregates_use_the_same_semantics() {
    let b = bound(&format!("{TABLE}query page(c: cursor ?):\n  return tasks where .orgId = viewer and .due < now first 50 by .due after c\nquery total():\n  return count(tasks where .orgId = viewer and .due < now)\n"));
    let mut engine = engine(b);
    engine.seed((0..90).map(|n| ("tasks".into(), object([
        ("id", Value::Id(format!("null-{n:03}"))), ("orgId", Value::Id("alice".into())),
        ("due", Value::Null), ("other", Value::Null), ("status", Value::String("done".into())), ("createdAt", Value::Int(0)),
    ])))).unwrap();
    for (query, args) in [("page", BTreeMap::from([("c".into(), Value::Null)])), ("total", BTreeMap::new())] {
        let page = engine.query(query, Context::new("alice", args).at(2)).unwrap();
        assert!(page.complete, "{page:?}");
        assert!(page.metered.examined <= 2, "null rows must be excluded in the store: {page:?}");
        if query == "total" { assert_eq!(page.data, Value::Int(2)); }
    }
}

#[test]
fn nullable_relaxation_stops_at_the_predicate_row_and_diagnostics_give_real_rewrites() {
    for read in [
        "tasks where .orgId = viewer and .due < x first 1 by .due after c",
        "tasks where .orgId = viewer and .due < x first 1 by .id after c",
        "tasks where .orgId = viewer first 1 after c { before: .due < now }",
    ] {
        let b = compile(&[("schema.q".into(), format!("{TABLE}query page(x: time ?, c: cursor ?):\n  return {read}\n"))]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"), "{read}: {:?}", b.diagnostics);
        assert!(b.diagnostics.iter().all(|d| !d.rewrite.contains("<time ?>")), "{:?}", b.diagnostics);
    }
    let b = compile(&[("schema.q".into(), "query q(x: time ?):\n  return x < now\n".into())]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"));
    let source = format!("{TABLE}query page(x: time ?, c: cursor ?):\n  return tasks where .orgId = viewer and x != null and .due < x first 50 by .id after c\n");
    let mut engine = engine(bound(&source));
    assert_eq!(pages(&mut engine, BTreeMap::from([("x".into(), Value::Null)])), Vec::<String>::new());
    assert_eq!(pages(&mut engine, BTreeMap::from([("x".into(), Value::Int(2))])), ["alice-b", "alice-c"]);
}

#[test]
fn required_enum_inequality_and_membership_have_identical_plans_and_pages() {
    for direction in ["first", "last"] {
        for order in ["createdAt", "status"] {
            let source = format!("{TABLE}query page(c: cursor ?):\n  return tasks where .orgId = viewer and .status != 'done' {direction} 1 by .{order} after c\n");
            let b = bound(&source);
            let explicit = bound(&source.replace(".status != 'done'", ".status in ['todo', 'doing']"));
            assert_eq!(b.schema.tables, explicit.schema.tables);
            assert_eq!(b.programs[0].program, explicit.programs[0].program);
            let scans = snapback4_core::ir::scans(&b.programs[0].program);
            assert_eq!(scans.len(), 1);
            if order == "createdAt" { assert_eq!(scans[0].prefix.len(), 2); assert!(scans[0].filter.is_none()); }
            let mut planned = engine(b);
            let mut explicit = engine(explicit);
            assert_eq!(pages(&mut planned, BTreeMap::new()), pages(&mut explicit, BTreeMap::new()));
        }
    }
}

#[test]
fn enum_complements_handle_arguments_single_variants_and_nullable_residuals() {
    let source = format!("{TABLE}query page(excluded: enum('todo', 'doing', 'done'), c: cursor ?):\n  return tasks where .orgId = viewer and .status != excluded first 50 by .createdAt after c\n");
    let mut engine = engine(bound(&source));
    for (excluded, expected) in [("done", vec!["a", "b", "c", "e", "f"]), ("todo", vec!["b", "d", "f"])] {
        assert_eq!(pages(&mut engine, BTreeMap::from([("excluded".into(), Value::String(excluded.into()))])), expected.iter().map(|id| format!("alice-{id}")).collect::<Vec<_>>());
    }
    for declaration in ["enum('done')", "enum('todo', 'doing', 'done') ?", "enum('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'done')"] {
        let source = format!("table t:\n  status: {declaration}\n  public 't'\nquery page(c: cursor ?):\n  return t where .status != 'done' first 50 after c\n");
        let b = bound(&source);
        let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        engine.seed([("t".into(), object([("id", Value::Id("done".into())), ("status", Value::String("done".into()))]))]).unwrap();
        if declaration.ends_with('?') {
            engine.seed([("t".into(), object([("id", Value::Id("null".into())), ("status", Value::Null)]))]).unwrap();
            assert_eq!(pages(&mut engine, BTreeMap::new()), ["null"]);
        } else { assert!(pages(&mut engine, BTreeMap::new()).is_empty()); }
    }
}

#[test]
fn enum_complement_work_does_not_grow_with_finished_tasks() {
    let b = bound(&format!("{TABLE}query page(c: cursor ?):\n  return tasks where .orgId = viewer and .status != 'done' first 50 by .createdAt after c\n"));
    let mut engine = engine(b);
    engine.seed((0..90).map(|n| ("tasks".into(), object([
        ("id", Value::Id(format!("finished-{n:03}"))), ("orgId", Value::Id("alice".into())),
        ("due", Value::Null), ("other", Value::Null), ("status", Value::String("done".into())), ("createdAt", Value::Int(0)),
    ])))).unwrap();
    let page = engine.query("page", Context::new("alice", BTreeMap::from([("c".into(), Value::Null)]))).unwrap();
    assert!(page.complete && page.next.is_none(), "{page:?}");
    assert_eq!(page.data.as_array().unwrap().len(), 5);
    assert!(page.metered.examined <= 8, "finished rows must not consume candidate work: {page:?}");
}

#[test]
fn fallible_enum_exclusions_stay_below_their_predicate_guards() {
    let b = bound(&format!("{TABLE}query page(d: int, c: cursor ?):\n  return tasks where .orgId = viewer and d != 0 and .status != ('done' if 10 / d > 0 else 'todo') first 50 by .createdAt after c\n"));
    let scan = snapback4_core::ir::scans(&b.programs[0].program)[0];
    assert_eq!(scan.prefix.len(), 1);
    assert!(scan.filter.is_some());
    let mut engine = engine(b);
    assert!(pages(&mut engine, BTreeMap::from([("d".into(), Value::Int(0))])).is_empty());
    assert_eq!(pages(&mut engine, BTreeMap::from([("d".into(), Value::Int(1))])).len(), 5);
}
