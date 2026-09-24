//! The shared rewrite printer must be safe inside new operator/postfix contexts.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::{ast::Stmt, compile, parse_document, print};
use std::collections::BTreeMap;

const SCHEMA: &str = "table items:\n  n: int\n  body: text\n  search body\n  public\n";

fn run(expression: &str) -> Value {
    let source = format!("{SCHEMA}query one(a: int, yes: bool, no: bool, c: cursor ?):\n  return {expression}\n");
    let bound = compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{expression}: {:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([
        ("items".into(), object([("id", Value::Id("one".into())), ("n", Value::Int(2)), ("body", Value::String("first".into()))])),
        ("items".into(), object([("id", Value::Id("other".into())), ("n", Value::Int(99)), ("body", Value::String("other".into()))])),
    ]).unwrap();
    engine.query("one", Context::new("alice", BTreeMap::from([
        ("a".into(), Value::Int(2)), ("c".into(), Value::Null), ("yes".into(), Value::Bool(true)), ("no".into(), Value::Bool(false)),
    ]))).unwrap().data
}

#[test]
fn printer_keeps_grouping_in_values_keys_filters_and_enclosing_rewrite_operators() {
    for (source, expected) in [
        ("(a + 1) * 2", Value::Int(6)),
        ("a - (a - 1)", Value::Int(1)),
        ("-(a + 1)", Value::Int(-3)),
        ("-(-a)", Value::Int(2)),
        ("(yes or no) and no", Value::Bool(false)),
        ("not (yes or no)", Value::Bool(false)),
        ("(a if yes else 9) * 2", Value::Int(4)),
        ("exists(items where .n = a) and no", Value::Bool(false)),
        ("exists(items where .n = a) = no", Value::Bool(false)),
        ("exists(items matching ('fir' + 'st')) and no", Value::Bool(false)),
        ("count(items first 2 by .n) = 2", Value::Bool(true)),
        ("count((items after c first 2 by .n) { n })", Value::Int(2)),
        ("(items after c first 2 by .n) = (items first 2 by .n)", Value::Bool(true)),
        ("exists items[n = (a + 1) * 2]", Value::Bool(false)),
        ("count(items where .n = 2 or .n = 3)", Value::Int(1)),
    ] {
        let (doc, errors) = parse_document("schema.q", &format!("query original():\n  return {source}\n"));
        assert!(errors.is_empty(), "{errors:?}");
        let Stmt::Return { value, .. } = &doc.programs[0].body[0] else { panic!("return") };
        let printed = print::expression(value);
        assert_eq!(run(source), expected, "source {source}");
        assert_eq!(run(&printed), expected, "printed {printed}");
        // Diagnostic callers embed the result in guards, coalesces, and new
        // arithmetic. It must preserve meaning without caller-specific fixes.
        assert_eq!(run(&format!("{printed} = ({source})")), Value::Bool(true), "embedded {printed}");
    }
}
