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
            if matches!(item, Ty::Enum(_)) {
                assert!(matches!(actual, Ty::Enum(_)) && actual.assignable_to(&item) && item.assignable_to(&actual),
                    "{source}: {actual:?}");
            }
            if body.contains("for i") {
                assert!(item.assignable_to(&actual), "{source}: {actual:?}");
                assert!(format!("{:?}", bound.programs[0].program).contains("Push"));
            } else {
                if !matches!(item, Ty::Enum(_)) { assert_eq!(actual, item, "{source}"); }
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
fn enum_pairs_join_subsets_reordered_sets_and_unions() {
    for (a, b, left, right, variants) in [
        ("enum('on')", "enum('on', 'off')", "on", "off", vec!["on", "off"]),
        ("enum('on', 'off')", "enum('off', 'on')", "on", "off", vec!["on", "off"]),
        ("enum('on')", "enum('off')", "on", "off", vec!["on", "off"]),
        ("enum('on', 'off')", "enum('off', 'maybe')", "on", "maybe", vec!["on", "off", "maybe"]),
        // Enum values need not fit the text character domain to join each other.
        ("enum('\0')", "enum('on')", "\0", "on", vec!["\0", "on"]),
    ] {
        widening(&format!("a: {a}, b: {b}"), Value::String(left.into()), Value::String(right.into()),
            Ty::Enum(variants.into_iter().map(String::from).collect()));
    }
    let bound = compile(&[("schema.q".into(), "query run(a: enum('on'), b: enum('off') ?):\n  return [{ state: a }, { state: b }]\n".into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert_eq!(bound.programs[0].result, Ty::List(Box::new(Ty::Object(BTreeMap::from([
        ("state".into(), Ty::Enum(vec!["on".into(), "off".into()]).optional()),
    ]))), 2));
}

#[test]
fn enum_item_conflicts_teach_a_value_preserving_typed_helper() {
    // This enum cannot widen to text. The text value can be kept as an enum
    // variant by the typed helper; no conversion or truncation is involved.
    let params = "a: enum('on', 'off', '\0'), b: text <=3";
    for expression in ["[a, b]", "[a] + [b]", "[{ state: a }, { state: b }]"] {
        let bound = compile(&[("schema.q".into(), format!("query run({params}):\n  return {expression}\n"))]);
        assert_eq!(bound.diagnostics.len(), 1, "{:?}", bound.diagnostics);
        let error = &bound.diagnostics[0];
        assert_eq!(error.code, "E_QUARRY_TYPE");
        assert_eq!(error.site.line, 2);
        assert!(error.rewrite.contains("fn state(v: enum('on', 'off')): v"), "{error:?}");
        assert!(error.rewrite.contains("all variants"), "{error:?}");
        assert!(error.rewrite.contains("state(a)") && error.rewrite.contains("state(b)"), "{error:?}");
    }
    for (params, helper, values) in [
        (params, "fn state(v: enum('on', 'off', '\0')): v", ["\0", "off"]),
        ("a: enum('on'), b: enum('on', 'off')", "fn state(v: enum('on', 'off')): v", ["on", "off"]),
    ] {
        let source = format!("{helper}\nquery run({params}):\n  return [state(a), state(b)]\n");
        let bound = compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        let [a, b] = values.map(|v| Value::String(v.into()));
        let args = BTreeMap::from([("a".into(), a.clone()), ("b".into(), b.clone())]);
        assert_eq!(engine.query("run", Context::new("alice", args)).unwrap().data, Value::Array(vec![a, b]));
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
