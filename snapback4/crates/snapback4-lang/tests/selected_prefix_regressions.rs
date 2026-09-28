//! @ref LLP 3000.028#3.2 — normalization preserves refusals and authored scan domains.
use snapback4_core::{Context, Engine, Value, value::object, ir};
use snapback4_lang::{Bound, compile};
use std::collections::BTreeMap;

const TABLE: &str = "table t:\n  key: int\n  second: int\n  denom: int\n  by byFull: key, second, id\n  public 'test'\n";
fn bound(source: String) -> Bound {
    let b = compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn ctx() -> Context { Context::new("alice", BTreeMap::from([("k".into(), Value::Int(1))])) }
fn engine(b: Bound) -> Engine {
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed((0..3).map(|n| ("t".into(), object([
        ("id", Value::Id(format!("r{n}"))), ("key", Value::Int(n)),
        ("second", Value::Int(n)), ("denom", Value::Int(n)),
    ])))).unwrap();
    engine
}
#[test]
fn earlier_refusal_and_division_still_run_before_argument_or_literal_equality() {
    for rhs in ["k", "1"] {
        for (earlier, code) in [("checked(.denom)", "BAD_ROW"), ("10 / .denom > 0", "E_DIV_ZERO")] {
            let b = bound(format!("{TABLE}fn checked(d: int):\n  require d != 0 else BAD_ROW\n  return true\nquery page(k: int):\n  return t where {earlier} and .key = {rhs} first 20 by byFull\n"));
            assert!(ir::scans(&b.programs[0].program)[0].prefix.is_empty());
            let error = engine(b).query("page", ctx()).unwrap_err();
            assert_eq!(error.code.as_str(), code, "{rhs}, {earlier}: {error}");
        }
    }
}
#[test]
fn final_index_component_remains_residual_in_every_scan_shape() {
    for rhs in ["k", "1"] {
        for (index, predicate, page, expected_prefix) in [
            ("by byKey: key", format!(".key = {rhs}"), "first 20", 0),
            ("by byKey: key, second", format!(".key = {rhs} and .second = 1"), "first 20", 1),
            ("unique byKey: key", format!(".key = {rhs}"), "first 20", 0),
            ("unique byKey: key", format!(".key = {rhs} and .denom > 0"), "", 0),
        ] {
            let table = TABLE.replace("by byFull: key, second, id", &format!("{index}\n  cap 10"));
            let b = bound(format!("{table}query page(k: int):\n  return t where {predicate} {page} by byKey\n"));
            assert_eq!(ir::scans(&b.programs[0].program)[0].prefix.len(), expected_prefix);
            let result = engine(b).query("page", ctx()).unwrap();
            assert!(result.complete);
            assert_eq!(result.data.as_array().unwrap().len(), 1);
            assert_eq!(result.data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id("r1".into()));
        }
    }
}
#[test]
fn existing_seeks_stop_extension_at_their_column() {
    for rhs in ["k", "1"] {
        for (keys, predicate, expected_prefix) in [
            ("key >= 0", format!(".key = {rhs}"), 0),
            ("key >= 2", format!(".key = {rhs}"), 0),
            ("key = 1, second >= 0", ".second = 1".into(), 1),
            ("key = 1, second >= 2", ".second = 1".into(), 1),
        ] {
            let b = bound(format!("{TABLE}query page(k: int):\n  return t[{keys}] where {predicate} first 20 by byFull\n"));
            let scan = ir::scans(&b.programs[0].program)[0];
            assert_eq!(scan.prefix.len(), expected_prefix);
            assert!(scan.range.is_some());
            let result = engine(b).query("page", ctx()).unwrap();
            assert!(result.complete);
            assert_eq!(result.data.as_array().unwrap().len(), usize::from(!keys.ends_with('2')));
        }
    }
}
#[test]
fn literal_equalities_match_brackets_and_keep_later_column_reads() {
    for direction in ["first", "last"] {
        for equality in [".key = 1", "1 = .key"] {
            let a = bound(format!("{TABLE}query page(k: int):\n  return t where {equality} and .key <= k {direction} 20 by byFull\n"));
            let b = bound(format!("{TABLE}query page(k: int):\n  return t[key = 1] where .key <= k {direction} 20 by byFull\n"));
            assert_eq!(ir::scans(&a.programs[0].program)[0].prefix.len(), 1);
            assert_eq!(a.programs[0].program, b.programs[0].program);
            let a = engine(a).query("page", ctx()).unwrap();
            let b = engine(b).query("page", ctx()).unwrap();
            assert_eq!(a.data, b.data);
            assert_eq!(a.complete, b.complete);
        }
    }
}

#[test]
fn unpaged_reads_keep_their_original_compile_result_and_domain() {
    let source = format!("{TABLE}query page(k: int):\n  return t where .key = k by byFull\n");
    let b = compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_BOUND"), "{:?}", b.diagnostics);
    let b = bound(format!("{}query page(k: int):\n  return t where .key = k by byFull\n", TABLE.replace("public 'test'", "cap 10\n  public 'test'")));
    assert!(ir::scans(&b.programs[0].program)[0].prefix.is_empty());
}

#[test]
fn normalization_cannot_repair_an_originally_invalid_seek() {
    for rhs in ["k", "1"] {
        let b = compile(&[("schema.q".into(), format!("{TABLE}query page(k: int):\n  return t[second >= 0] where .key = {rhs} first 20 by byFull\n"))]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"), "{:?}", b.diagnostics);
    }
}
