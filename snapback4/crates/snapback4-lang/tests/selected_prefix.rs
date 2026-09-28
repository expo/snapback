//! @ref LLP 3000.028#7.1 — selected-index equality and bracket pages agree.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::compile;
use std::collections::BTreeMap;

const TABLE: &str = "table messages:\n  conversation: int\n  at: time\n  hidden: bool\n  by byHistory: conversation, at, id\n  public 'test'\n";
fn bound(body: &str, args: &str) -> snapback4_lang::Bound {
    let b = compile(&[("schema.q".into(), format!("{TABLE}query history({args}):\n  return {body}\n"))]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}

#[test]
fn paired_plans_residual_order_limit_and_cross_spelling_cursors() {
    for direction in ["first", "last"] {
        for equality in [".conversation = conversation", "conversation = .conversation"] {
            let suffix = format!("{direction} 2 by byHistory after c");
            let a = bound(&format!("messages where {equality} and not .hidden {suffix}"), "conversation: int, c: cursor ?");
            let b = bound(&format!("messages[conversation = conversation] where not .hidden {suffix}"), "conversation: int, c: cursor ?");
            assert_eq!(comparable(&a.programs[0].program), comparable(&b.programs[0].program));
            assert_eq!(snapback4_core::ir::scans(&a.programs[0].program)[0].cursor_pins, 1);
            assert_eq!(snapback4_core::ir::scans(&b.programs[0].program)[0].cursor_pins, 0);
            assert_eq!(a.schema.tables, b.schema.tables);
            let mut engine = Engine::memory(a.schema, a.programs.into_iter().map(|p| p.program)).unwrap();
            engine.seed((0..8).map(|n| ("messages".into(), object([
                ("id", Value::Id(format!("m{n}"))), ("conversation", Value::Int(n % 2)),
                ("at", Value::Int(n / 4)), ("hidden", Value::Bool(n == 4)),
            ])))).unwrap();
            let mut ids = Vec::new();
            let mut cursor = Value::Null;
            loop {
                let page = engine.query("history", Context::new("alice", BTreeMap::from([
                    ("conversation".into(), Value::Int(0)), ("c".into(), cursor),
                ]))).unwrap();
                assert!(page.complete);
                ids.extend(page.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().clone()));
                let Some(next) = page.next else { break; };
                cursor = Value::String(next);
            }
            let expected = if direction == "first" { ["m0", "m2", "m6"] } else { ["m6", "m2", "m0"] };
            assert_eq!(ids, expected.map(|id| Value::Id(id.into())));
        }
    }
}

#[test]
fn unsafe_optional_conflicting_and_nonleading_equalities_stay_residual() {
    for (predicate, args) in [
        ("d != 0 and .conversation = 10 / d", "d: int"),
        ("d < 9007199254740991 and .conversation = d + 1", "d: int"),
        ("d != null and .conversation = d", "d: int ?"),
        (".conversation = a and .conversation = b", "a: int, b: int"),
        (".at = at", "at: time"),
    ] {
        let b = bound(&format!("messages where {predicate} last 20 by byHistory"), args);
        let scans = snapback4_core::ir::scans(&b.programs[0].program);
        assert!(scans[0].prefix.is_empty(), "{predicate}: {:?}", scans[0]);
    }
    let b = compile(&[("schema.q".into(), format!("{}query history(d: int):\n  return messages where .conversation = d last 20 by byHistory\n", TABLE.replace("conversation: int", "conversation: int ?")))]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(snapback4_core::ir::scans(&b.programs[0].program)[0].prefix.is_empty());
}

#[test]
fn existing_prefix_constraints_survive() {
    for prefix in ["[conversation = conversation]", "[conversation]"] {
        let extended = if prefix.contains('=') { "[conversation = conversation, at = at]" } else { "[conversation, at]" };
        let a = bound(&format!("messages{prefix} where .at = at and not .hidden last 20 by byHistory"), "conversation: int, at: time");
        let b = bound(&format!("messages{extended} where not .hidden last 20 by byHistory"), "conversation: int, at: time");
        assert_eq!(a.programs[0].program, b.programs[0].program, "preserve the existing key notation while extending its prefix");
        assert_eq!(snapback4_core::ir::scans(&a.programs[0].program)[0].prefix.len(), 2);
        let b = bound(&format!("messages{prefix} where .conversation = other last 20 by byHistory"), "conversation: int, other: int");
        let scans = snapback4_core::ir::scans(&b.programs[0].program);
        assert_eq!(scans[0].prefix.len(), 1);
        let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        engine.seed([("messages".into(), object([("id", Value::Id("m".into())), ("conversation", Value::Int(1)), ("at", Value::Int(1)), ("hidden", Value::Bool(false))]))]).unwrap();
        let page = engine.query("history", Context::new("alice", BTreeMap::from([("conversation".into(), Value::Int(1)), ("other".into(), Value::Int(2))]))).unwrap();
        assert_eq!(page.data.as_array().unwrap().len(), 0);
    }
}

#[test]
fn unchanged_calibration_program_compiles() {
    let b = compile(&[("schema.q".into(), include_str!("../../../experiments/p19-one-query/builder.q").into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let ordinary = compile(&[("schema.q".into(), include_str!("../../../experiments/p19-one-query/equality/builder.q").into())]);
    assert!(ordinary.diagnostics.is_empty(), "{:?}", ordinary.diagnostics);
    assert_eq!(b.schema.tables, ordinary.schema.tables, "no builder schema change");
    for old in &b.programs {
        if old.program.name == "historyHeld" { continue; }
        let new = ordinary.programs.iter().find(|p| p.program.name == old.program.name).unwrap();
        assert_eq!(comparable(&old.program), comparable(&new.program), "builder operation {} changed", old.program.name);
    }
    let history = ordinary.programs.iter().find(|p| p.program.name == "history").unwrap();
    let scans = snapback4_core::ir::scans(&history.program);
    assert_eq!(scans[0].index, "byHistory");
    assert_eq!(scans[0].prefix.len(), 1);
}

#[test]
fn full_unique_equality_keeps_the_original_page_type() {
    let source = "table t:\n  key: int\n  unique byKey: key\n  cap 10\n  public 't'\nquery page(key: int):\n  return t where .key = key by byKey\n";
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert_eq!(snapback4_core::ir::scans(&b.programs[0].program).len(), 1, "a page must not become a point");
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("t".into(), object([("id", Value::Id("a".into())), ("key", Value::Int(1))]))]).unwrap();
    for (key, count) in [(1, 1), (2, 0)] {
        let page = engine.query("page", Context::new("alice", BTreeMap::from([("key".into(), Value::Int(key))]))).unwrap();
        assert_eq!(page.data.as_array().unwrap().len(), count);
    }
}

// The only IR difference is the equality page's legacy cursor descriptor.
// Compare every execution field, including its normalized prefix and residuals.
fn comparable(program: &snapback4_core::Program) -> serde_json::Value {
    fn strip(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::Object(fields) => {
                fields.remove("cursor_pins");
                for value in fields.values_mut() { strip(value); }
            }
            serde_json::Value::Array(values) => for value in values { strip(value); },
            _ => {}
        }
    }
    let mut value = serde_json::to_value(program).unwrap();
    strip(&mut value);
    value
}
