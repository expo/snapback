use snapback4_core::{Ceilings, Context, Engine, Value, ir, value::object};
use snapback4_lang::{Bound, compile, types::Ty};
use std::collections::BTreeMap;

const SOURCE: &str = include_str!("fixtures/extremum-expressions.q");
fn bound(source: &str) -> Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:#?}", b.diagnostics);
    b
}
fn engine(source: &str) -> Engine {
    let b = bound(source);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn context(conversation: &str) -> Context {
    Context::new("alice", BTreeMap::from([("conversation".into(), Value::Id(conversation.into())), ("ordinal".into(), Value::Int(10))])).at(100)
}
fn rows() -> Vec<(String, Value)> {
    [("a", 1, 0, None), ("b", 2, 8, Some(-2)), ("c", 3, 20, Some(7)), ("d", 20, 0, None)]
        .map(|(id, joined, seen, n)| ("members".into(), object([("id", Value::Id(id.into())), ("conversation", Value::Id("chat".into())),
            ("joinedOrdinal", Value::Int(joined)), ("seenOrdinal", Value::Int(seen)), ("n", n.map(Value::Int).unwrap_or(Value::Null))]))).into()
}

#[test]
fn row_expressions_match_a_loop_with_nulls_and_named_outer_values() {
    let mut e = engine(SOURCE);
    e.seed(rows()).unwrap();
    for (op, value) in [("receipt", 1), ("fastest", 2), ("page", 8), ("nested", 28)] {
        let r = e.query(op, context("chat")).unwrap();
        assert_eq!(r.data, Value::Int(value), "{op}: {r:?}");
        assert_eq!(r.complete, op != "page", "{op}: {r:?}");
    }
    for conversation in ["chat", "empty"] {
        let fold = e.query("nullable", context(conversation)).unwrap();
        let explicit = e.query("loop", context(conversation)).unwrap();
        assert!(fold.complete && explicit.complete);
        assert_eq!(fold.data, explicit.data);
        assert_eq!(fold.data, if conversation == "chat" { object([("low", Value::Int(8)), ("high", Value::Int(17))]) }
            else { object([("low", Value::Null), ("high", Value::Null)]) });
    }
    let list = e.query("list", Context::new("alice", BTreeMap::new())).unwrap();
    assert_eq!(list.data, object([("low", Value::Int(-1)), ("high", Value::Int(8)), ("text", Value::String("b".into())), ("bool", Value::Bool(true))]));
    let b = bound(SOURCE);
    assert_eq!(b.programs.iter().find(|p| p.program.name == "receipt").unwrap().result, Ty::Int.optional());
}

#[test]
fn expression_encoding_is_distinct_and_column_encoding_and_seek_survive() {
    let source = "table t:\n  n: int\n  by byN: n, id\n  public\n  online only\nquery column():\n  return min(t, .n)\nquery expression():\n  return min(t, .n + 0)\n";
    let b = bound(source);
    let json = serde_json::to_value(&b.programs.iter().find(|p| p.program.name == "column").unwrap().program).unwrap();
    let text = json.to_string();
    assert!(text.contains("\"Extremum\":{\"domain\":true,\"field\":\"n\",\"max\":false}"), "{text}");
    assert!(!text.contains("ExtremumOf"));
    for p in b.programs {
        let encoded = serde_json::to_vec(&p.program).unwrap();
        let decoded: ir::Program = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(p.program, decoded);
    }
    let mut e = engine(source);
    e.seed((0..40).map(|i| ("t".into(), object([("id", Value::Id(format!("r{i:02}"))), ("n", Value::Int(i))])))).unwrap();
    let a = e.query("column", Context::new("alice", BTreeMap::new())).unwrap();
    let b = e.query("expression", Context::new("alice", BTreeMap::new())).unwrap();
    assert_eq!(a.data, b.data);
    assert_eq!(a.metered.examined, 1);
    assert_eq!(b.metered.examined, 40);
}

#[test]
fn expression_cuts_never_become_a_partial_or_default_scalar() {
    for ceilings in [Ceilings { examined: 1, ..Ceilings::default() }, Ceilings { steps: 20, ..Ceilings::default() }, Ceilings { heap_bytes: 128, ..Ceilings::default() }] {
        let mut e = engine(SOURCE);
        e.seed(rows()).unwrap();
        e.set_ceilings(ceilings);
        for op in ["receipt", "fastest", "defaulted"] {
            let r = e.query(op, context("chat")).unwrap();
            assert!(!r.complete && r.capped_at.is_some(), "{op}: {r:?}");
            assert_eq!(r.data, Value::Null);
        }
    }
}

#[test]
fn authorization_precedes_the_value_expression() {
    let source = "table t:\n  owner: principal\n  n: int\n  cap 10\n  read <- .owner = viewer\n  online only\nquery q():\n  return min(t, 10 / .n)\nquery page():\n  rows = t first 10 by .id\n  return max(rows, 10 / .n)\n";
    let mut e = engine(source);
    e.seed([("hidden", "bob", 0), ("visible", "alice", 2)].map(|(id, owner, n)| ("t".into(), object([
        ("id", Value::Id(id.into())), ("owner", Value::Id(owner.into())), ("n", Value::Int(n))])))).unwrap();
    // Evaluating a hidden row would fail division. An unscoped nonuniform
    // domain stays unavailable; a bounded page folds only its disclosed rows.
    let r = e.query("q", Context::new("alice", BTreeMap::new())).unwrap();
    assert!(!r.complete);
    assert_eq!(r.data, Value::Null);
    assert_eq!(e.query("page", Context::new("alice", BTreeMap::new())).unwrap().data, Value::Int(5));
}

#[test]
fn ambiguity_refusal_has_a_compiling_helper_rewrite() {
    let source = "query q():\n  rows = [{ n: 1 }]\n  return [{ n: 2 }] { answer: min(rows, .n + 1) }\n";
    let b = compile(&[("ambiguous.q".into(), source.into())]);
    let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_AMBIGUOUS").unwrap_or_else(|| panic!("{:?}", b.diagnostics));
    assert!(d.site.line > 0 && d.rewrite.contains("helper"));
    bound("table t:\n  n: int\n  cap 10\n  public\n  online only\nfn low():\n  return min(t, .n + 1)\nquery q():\n  return [{ n: 2 }] { answer: low() }\n");
    // Enclosed row binders do not accidentally count as enclosing-row use.
    bound("query q():\n  return [{ n: 2 }] { answer: min([{ n: 1 }], count([{ n: 3 }] { n })) }\n");
}

#[test]
fn nested_read_sites_remain_visible_to_residency_and_ir_walks() {
    let source = "table t:\n  target: id\n  cap 3\n  public\n  sync public\ntable secrets:\n  n: int\n  public\n  online only\nquery q():\n  return min(t, secrets[.target].n ?? 0)\n";
    let b = bound(source);
    let p = &b.programs[0];
    assert!(ir::read_sites(&p.program).iter().any(|s| s.table == "secrets"));
    assert!(b.schema.operations["q"].sites.iter().any(|s| s.table == "secrets"));
}

#[test]
fn binary_collection_expressions_keep_the_original_order() {
    for builtin in ["min", "max"] {
        let source = format!("table t:\n  n: int\n  cap 10\n  public\n  online only\nquery q():\n  rows = t where .n >= 0\n  return {{ expected: rows, actual: {builtin}(t where .n >= 0, rows if true else rows) }}\n");
        let mut e = engine(&source);
        e.seed([("a", 8), ("b", 1)].map(|(id, n)| ("t".into(), object([("id", Value::Id(id.into())), ("n", Value::Int(n))])))).unwrap();
        let result = e.query("q", Context::new("alice", BTreeMap::new())).unwrap();
        assert_eq!(result.data.field("actual").unwrap(), result.data.field("expected").unwrap());
    }
}

#[test]
fn constants_helpers_all_nulls_and_empty_sources() {
    let source = "fn bump(n: int):\n  return n + 1\nquery q():\n  return { empty: min([], 9), absent: max([{ n: 1 }], null), constant: min([{ n: 8 }], 7), helper: max([{ n: 8 }, { n: 2 }], bump(.n)) }\n";
    let result = engine(source).query("q", Context::new("alice", BTreeMap::new())).unwrap();
    assert_eq!(result.data, object([("empty", Value::Null), ("absent", Value::Null), ("constant", Value::Int(7)), ("helper", Value::Int(9))]));
}
