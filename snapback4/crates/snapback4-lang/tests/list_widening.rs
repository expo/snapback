use snapback4_core::{Context, Engine, Value};
use snapback4_lang::{compile, types::Ty};
use std::collections::BTreeMap;

// Every widening is exercised in both operand orders, in a literal, a
// concatenation and the existing Push lowering inside a loop.
fn widening(params: &str, left: Value, right: Value, item: Ty) {
    for (a, b, values) in [
        ("a", "b", vec![left.clone(), right.clone()]),
        ("b", "a", vec![right.clone(), left.clone()]),
    ] {
        for body in [
            format!("  return [{a}, {b}]\n"),
            format!("  return [{a}] + [{b}]\n"),
            format!("  xs = [{a}]\n  for i in [1]:\n    xs = xs + [{b}]\n  return xs\n"),
        ] {
            let source = format!("table t:\n  n: int\n  public\nquery run({params}):\n{body}");
            let bound = compile(&[("schema.q".into(), source.clone())]);
            assert!(bound.diagnostics.is_empty(), "{source}\n{:?}", bound.diagnostics);
            let (actual, max) = bound.programs[0].result.sequence().unwrap();
            if body.contains("for i") {
                assert!(item.assignable_to(&actual), "{source}: {actual:?}");
                assert!(format!("{:?}", bound.programs[0].program).contains("Push"));
            } else {
                assert_eq!(actual, item, "{source}");
                assert_eq!(max, 2);
            }
            let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
            let args = BTreeMap::from([("a".into(), left.clone()), ("b".into(), right.clone())]);
            let read = engine.query("run", Context::new("alice", args)).unwrap();
            assert!(read.complete);
            assert_eq!(read.data, Value::Array(values.clone()), "{source}");
        }
    }
}

#[test]
fn enum_and_text_keep_a_sufficient_character_bound() {
    widening("a: enum('on', 'off'), b: text <=1", Value::String("off".into()), Value::String("x".into()), Ty::Text(3));
    widening("a: enum('é', '🦀'), b: text <=2", Value::String("🦀".into()), Value::String("hi".into()), Ty::Text(2));
}

#[test]
fn generic_ids_join_references_without_changing_values() {
    widening("a: id, b: t", Value::Id("generic".into()), Value::Id("row".into()), Ty::Id);
    widening("a: id, b: principal", Value::Id("generic".into()), Value::Id("alice".into()), Ty::Id);
}

#[test]
fn decimal_and_money_join_int_without_rescaling() {
    widening("a: decimal 2, b: int", Value::Int(123), Value::Int(0), Ty::Decimal(2));
    widening("a: money USD, b: int", Value::Int(123), Value::Int(0), Ty::Money("USD".into(), 2));
}

#[test]
fn json_joins_known_values_without_erasing_an_unknown_conflict() {
    widening("a: json <=100, b: int", Value::Bool(true), Value::Int(0), Ty::Json);
    for ty in [Ty::Json, Ty::Text(10), Ty::Decimal(2), Ty::Money("USD".into(), 2), Ty::Id] {
        for (a, b) in [(Ty::Unknown, ty.clone()), (ty, Ty::Unknown)] {
            assert!(Ty::List(Box::new(a), 1).join(&Ty::List(Box::new(b), 1)).is_err());
        }
    }
}

#[test]
fn enum_widening_keeps_the_text_character_domain() {
    for (a, b) in [(Ty::Enum(vec!["\0".into()]), Ty::Text(1)), (Ty::Text(1), Ty::Enum(vec!["\0".into()]))] {
        assert!(Ty::List(Box::new(a), 1).join(&Ty::List(Box::new(b), 1)).is_err());
    }
}

#[test]
fn reviewer_literal_and_text_helper_reproductions_run() {
    for (params, helper, expression, args, expected) in [
        ("a: enum('on', 'off')", "", "count([a, 'off'])", BTreeMap::from([("a".into(), Value::String("on".into()))]), Value::Int(2)),
        ("a: decimal 2", "", "[a, 0]", BTreeMap::from([("a".into(), Value::Int(123))]), Value::Array(vec![Value::Int(123), Value::Int(0)])),
        ("a: json <=100", "", "[a, 0]", BTreeMap::from([("a".into(), Value::Bool(true))]), Value::Array(vec![Value::Bool(true), Value::Int(0)])),
        ("a: enum('ON', 'OFF')", "fn lowerAll(xs: [text <=10] <=2):\n  out = []\n  for x in xs:\n    out = out + [lower(x)]\n  return out\n", "lowerAll([a, 'a'])", BTreeMap::from([("a".into(), Value::String("OFF".into()))]), Value::Array(vec![Value::String("off".into()), Value::String("a".into())])),
    ] {
        let source = format!("{helper}query run({params}):\n  return {expression}\n");
        let bound = compile(&[("schema.q".into(), source.clone())]);
        assert!(bound.diagnostics.is_empty(), "{source}\n{:?}", bound.diagnostics);
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        assert_eq!(engine.query("run", Context::new("alice", args)).unwrap().data, expected);
    }
}
