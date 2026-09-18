use snapback4_core::{ir::*, schema::{Component, Execution, Schema}, value::Value};
use snapback4_lang::bind::residency;
use std::collections::BTreeMap;

const TABLE: &str = "table messages:\n  room: text <=40\n  at: time\n  by byTime: room, at, id\n  read <- allow\n  sync public last 25 by byTime\n";
fn compile(source: &str) -> snapback4_lang::Bound {
    let bound = snapback4_lang::compile(&[("schema.q".into(), format!("{TABLE}{source}"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

#[test]
fn independent_fields_and_transitive_scalars_have_plans() {
    let bound = compile("fn history(room: text <=40): messages[room] last 50 by byTime\nquery both():\n  a = history('left')\n  b = history('held')\n  return {left: count(a), held: first(b)}\nquery plain():\n  return {one: 1, two: 2}\n");
    let fact = &bound.schema.operations["both"];
    assert_eq!(fact.components.iter().map(|p| p.field.as_str()).collect::<Vec<_>>(), ["held", "left"]);
    assert!(fact.components.iter().all(|component| !component.statements.is_empty()));
    assert!(residency::operation_lines("both", fact).contains("components: held, left"));
    assert_eq!(bound.schema.operations["plain"].components.len(), 2);
    let encoded = serde_json::to_value(fact).unwrap();
    assert_eq!(encoded["components"][0]["field"], "held");
    let old: Execution = serde_json::from_value(serde_json::json!({})).unwrap();
    assert!(old.components.is_empty());
    assert!(serde_json::to_value(old).unwrap().get("components").is_none());
}

#[test]
fn excluded_source_shapes_keep_no_plan() {
    assert_eq!(compile("query both():\n  return {left: messages['left'] last 50 by byTime, held: messages['held'] last 50 by byTime}\n").schema.operations["both"].components.len(), 2);
    for source in [
        "query q() held:\n  a = messages['left'] last 50 by byTime\n  b = messages['held'] last 50 by byTime\n  return {left: a, held: b}\n",
        "query q(c: cursor ?):\n  return {left: messages['left'] last 50 by byTime, held: messages['held'] last 50 by byTime}\n",
        "query q():\n  a = messages['left'] last 50 by byTime\n  return {left: a, again: a}\n",
        "query q():\n  a = messages['left'] last 50 by byTime\n  b = messages['held'] last 50 by byTime\n  return {count: count(a) + count(b), other: 1}\n",
        "query q():\n  if true:\n    return {left: 1, held: 2}\n  return {left: 3, held: 4}\n",
        "query q():\n  for i in range(0, 2):\n    return {left: i, held: 2}\n  return {left: 3, held: 4}\n",
        "query q():\n  ignored = messages['left'] last 50 by byTime\n  return {left: 1, held: messages['held'] last 50 by byTime}\n",
        "query q():\n  ignored = messages['left'] last 1 by byTime\n  return messages['held'] last 50 by byTime\n",
        "query q(): native\n",
        "fn history(room: text <=40):\n  return messages[room] last 50 by byTime\nquery q():\n  a = history('left')\n  b = history('held')\n  return {left: a, held: b}\n",
    ] {
        let bound = compile(source);
        assert!(bound.schema.operations["q"].components.is_empty(), "{source}\n{:?}", bound.programs[0].program);
    }
}

#[test]
fn inline_cross_read_aggregate_has_no_plan() {
    assert_eq!(compile("query both():\n  return {left: messages['left'] last 50 by byTime, held: messages['held'] last 50 by byTime}\n").schema.operations["both"].components.len(), 2);
    let bound = compile("query q():\n  return {count: count(messages['left'] last 50 by byTime) + count(messages['held'] last 50 by byTime), other: 1}\n");
    assert!(bound.schema.operations["q"].components.is_empty());
}

fn query(body: Vec<Stmt>) -> Program { Program { name: "q".into(), kind: ProgramKind::Query, args: Default::default(), body, native: false, returned_shapes: Default::default(), read_time_granularity_ms: None } }
fn record(value: Expr) -> Stmt { Stmt::Return(Expr::Object(BTreeMap::from([("a".into(), value), ("b".into(), lit(Value::Int(2)))]))) }
fn plan(program: &Program) -> Vec<Component> { residency::execution(&Schema::default(), program).components }

#[test]
fn nested_sinks_and_every_cursor_position_are_ineligible() {
    let scalar = lit(Value::Int(1));
    let initial = Stmt::Let { name: "top".into(), value: scalar.clone() };
    for stmt in [
        Stmt::Assign { name: "top".into(), value: scalar.clone() },
        Stmt::Push { target: "top".into(), value: scalar.clone() },
        Stmt::Let { name: "inner".into(), value: Expr::Builtin { builtin: Builtin::Divmod { remainder_sink: "top".into() }, args: vec![scalar.clone(), scalar.clone()] } },
        Stmt::InsertIfAbsent { table: "t".into(), row: scalar.clone(), result: "top".into() },
    ] {
        assert!(plan(&query(vec![initial.clone(), record(Expr::Block { body: vec![stmt], value: Box::new(var("top")) })])).is_empty());
    }
    let bound = compile("query q():\n  return {left: messages['left'] last 50 by byTime, held: messages['held'] last 50 by byTime}\n");
    let base = &bound.programs[0].program;
    assert_eq!(residency::execution(&bound.schema, base).components.len(), 2);
    for cursor in [0, 1, 2] {
        let mut p = base.clone();
        let Stmt::Return(Expr::Object(fields)) = p.body.last_mut().unwrap() else { panic!("record") };
        let Expr::Scan(scan) = fields.get_mut("left").unwrap() else { panic!("scan") };
        match cursor { 0 => scan.after = Some(Box::new(lit(Value::Null))), 1 => scan.before = Some(Box::new(lit(Value::Null))), _ => scan.opaque_cursor = true }
        assert!(residency::execution(&bound.schema, &p).components.is_empty());
    }
}

#[test]
fn reading_guards_have_no_plan() {
    let fields = "  return {left: messages['left'] last 50 by byTime, held: messages['held'] last 50 by byTime}\n";
    assert_eq!(compile(&format!("query q():\n  require true else NO\n{fields}")).schema.operations["q"].components.len(), 2);
    for guard in ["exists messages['held-25']", "count(messages['left'] last 50 by byTime) = count(messages['held'] last 50 by byTime)"] {
        let bound = compile(&format!("query q():\n  require {guard} else NO\n{fields}"));
        assert!(bound.schema.operations["q"].components.is_empty(), "{guard}");
    }
    let bound = compile("query q():\n  a = messages['left'] last 50 by byTime\n  b = messages['held'] last 50 by byTime\n  require count(a) = count(b) else NO\n  return {left: a, held: b, unknown: messages['third'] last 50 by byTime}\n");
    assert!(bound.schema.operations["q"].components.is_empty());
}

#[test]
fn escaped_nested_local_has_no_plan() {
    let bound = compile("query q():\n  return {left: messages['left'] last 50 by byTime, held: messages['held'] last 50 by byTime}\n");
    let Stmt::Return(Expr::Object(fields)) = &bound.programs[0].program.body[0] else { panic!("record") };
    let mut p = query(vec![
        Stmt::Let { name: "a".into(), value: Expr::Block { body: vec![Stmt::Let { name: "leak".into(), value: fields["left"].clone() }], value: Box::new(var("leak")) } },
        Stmt::Let { name: "held".into(), value: fields["held"].clone() },
        Stmt::Return(Expr::Object(BTreeMap::from([("a".into(), var("a")), ("held".into(), var("held"))]))),
    ]);
    let roundtrip = |p: &Program| serde_json::from_value::<Program>(serde_json::to_value(p).unwrap()).unwrap();
    assert_eq!(plan(&roundtrip(&p)).len(), 2);
    let Stmt::Return(Expr::Object(fields)) = p.body.last_mut().unwrap() else { unreachable!() };
    fields.insert("z".into(), var("leak"));
    assert!(plan(&roundtrip(&p)).is_empty());
}

#[test]
fn equal_counts_guard_cannot_mix_two_satisfying_observations() {
    let fields = "  return {left: messages['left'] last 50 by byTime, current: messages['current'] last 50 by byTime, held: messages['held'] last 50 by byTime}\n";
    assert_eq!(compile(&format!("query q():\n{fields}")).schema.operations["q"].components.len(), 3);
    let bound = compile(&format!("query q():\n  require count(messages['left'] last 50 by byTime) = count(messages['current'] last 50 by byTime) else UNEQUAL\n{fields}"));
    assert!(bound.schema.operations["q"].components.is_empty());
}
