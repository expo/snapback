use snapback4_core::{Context, Engine, Value};
use snapback4_lang::{Bound, compile, types::Ty};

fn checked(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{source}\n{:?}", bound.diagnostics);
    bound
}

fn run(source: &str) -> Value {
    let bound = checked(source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let read = engine.query("run", Context::new("alice", Default::default())).unwrap();
    assert!(read.complete, "{read:?}");
    read.data
}

#[test]
fn lists_concatenate_in_returns_bindings_arguments_records_and_loops() {
    for body in [
        "  return [1] + [2]\n",
        "  xs = [1]\n  return xs + [2]\n",
        "  xs = [1]\n  ys = xs + [2]\n  return ys\n",
        "  return identity([1] + [2])\n",
        "  record = { xs: [1] + [2] }\n  return record.xs\n",
        "  xs = []\n  for x in [1] + [2]:\n    xs = xs + [x]\n  return xs\n",
        "  xs = [1]\n  return xs + [2] if true else []\n",
    ] {
        let source = format!("fn identity(xs: [int] <=2): xs\nquery run():\n{body}");
        assert_eq!(run(&source), Value::Array(vec![Value::Int(1), Value::Int(2)]));
    }
}

#[test]
fn item_joins_match_literals_and_bounds_add() {
    for (left, right, literal) in [
        ("[]", "[1]", "[1]"), ("[1]", "[]", "[1]"), ("[]", "[]", "[]"),
        ("[null]", "[1]", "[null, 1]"),
        ("[{ a: 1 }]", "[{ b: 'hi' }]", "[{ a: 1 }, { b: 'hi' }]"),
        ("[[1]]", "[[2, 3]]", "[[1], [2, 3]]"),
    ] {
        let bound = checked(&format!("query concat():\n  return {left} + {right}\nquery literal():\n  return {literal}\n"));
        assert_eq!(bound.programs[0].result, bound.programs[1].result, "{left} + {right}");
    }
    let bound = checked("query run(a: [text <=5] <=2, b: [text <=10] <=3):\n  return a + b\n");
    assert_eq!(bound.programs[0].result, Ty::List(Box::new(Ty::Text(10)), 5));
}

#[test]
fn a_list_and_a_scalar_get_a_list_rewrite() {
    for expression in ["[1] + 2", "1 + [2]", "[1] + 'x'", "null + [1]"] {
        let bound = compile(&[("schema.q".into(), format!("query run():\n  return {expression}\n"))]);
        let diagnostic = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_TYPE").unwrap();
        assert!(diagnostic.message.contains("two lists"), "{diagnostic:?}");
        assert!(diagnostic.rewrite.contains("xs + [x]"), "{diagnostic:?}");
        assert_eq!(diagnostic.site.line, 2);
    }
}

#[test]
fn self_append_keeps_its_in_place_lowering_and_loop_growth() {
    let source = "query run():\n  xs = []\n  for x in [1, 2]:\n    xs = xs + [x]\n  return xs + [3]\n";
    let bound = checked(source);
    assert!(format!("{:?}", bound.programs[0].program).contains("Push"));
    assert_eq!(run(source), Value::Array(vec![Value::Int(1), Value::Int(2), Value::Int(3)]));
}

#[test]
fn other_loop_concatenations_keep_fixed_item_types_under_the_heap_meter() {
    for (body, expected) in [
        ("xs = [x] + xs", vec![2, 1]),
        ("xs = xs + [x, x]", vec![1, 1, 2, 2]),
        ("ys = xs + [x]\n    xs = ys", vec![1, 2]),
    ] {
        let source = format!("query run():\n  xs = []\n  for x in [1, 2]:\n    {body}\n  return xs\n");
        assert_eq!(run(&source), Value::Array(expected.into_iter().map(Value::Int).collect()));
    }
}

#[test]
fn recursive_loop_concatenation_names_the_self_append_rewrite() {
    let source = "query run():\n  xs = []\n  ys = []\n  for x in [1, 2]:\n    xs = ys + [ys]\n    ys = xs + []\n  return xs\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    let diagnostic = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_TYPE").unwrap();
    assert!(diagnostic.message.contains("growing"), "{diagnostic:?}");
    assert!(diagnostic.rewrite.contains("xs = xs + [x]"), "{diagnostic:?}");
    assert_eq!(run("query run():\n  xs = []\n  for x in [1, 2]:\n    xs = xs + [x]\n  return xs\n"), Value::Array(vec![Value::Int(1), Value::Int(2)]));
}

#[test]
fn concatenation_respects_operand_evaluation_order() {
    let source = "fn fail():\n  require false else RIGHT_FAILED\n  return [2]\nquery run():\n  return [1 / 0] + fail()\n";
    let bound = checked(source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(engine.query("run", Context::new("alice", Default::default())).unwrap_err().code, "E_DIV_ZERO");
}

#[test]
fn list_concatenation_remains_heap_metered() {
    for kind in ["query", "mutation"] {
        let bound = checked(&format!("{kind} run():\n  xs = []\n  for x in range(0, 100):\n    xs = xs + [x, x]\n  return xs\n"));
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        engine.set_ceilings(snapback4_core::Ceilings { heap_bytes: 1024, ..Default::default() });
        let context = Context::new("alice", Default::default());
        if kind == "query" {
            let read = engine.query("run", context).unwrap();
            assert!(!read.complete && read.metered.heap_bytes > 1024, "{read:?}");
        } else {
            let outcome = engine.mutate("run", None, context).unwrap();
            let snapback4_core::WriteState::Failed { why: refusal, .. } = outcome.state else { panic!("{outcome:?}") };
            assert_eq!(refusal.code, "E_BOUND");
            assert!(refusal.message.contains("heap"), "{refusal:?}");
        }
    }
}

#[test]
fn conflicting_row_kinds_keep_the_literal_join_refusal() {
    let source = "table notes:\n  title: text\n  public\nquery run(id: notes):\n  row = notes[id] ! else NOT_FOUND\n  return [row] + [{ ...row }]\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_SHAPE_JOIN"
        && d.message.contains("[]")), "{:?}", bound.diagnostics);
}
