//! The IR is an engine boundary too: no condition can copy its private old image.
use serde_json::json;
use snapback4_core::{Context, Engine, Value, WriteState, wire};
use snapback4_core::ir::*;

const SOURCE: &str = r#"
table records:
  owner: principal
  secret: text <=80
  amount: int
  by byOwner: owner, id
  read <- .owner = viewer
  update <- allow
table copies:
  secret: text <=80
  read <- allow
  insert <- allow
mutation guarded(target: records):
  return update records[target] {amount: 0} if .amount = 7
query page():
  return records[viewer] first 1 by byOwner
"#;

#[test]
fn w2_serialized_conditions_refuse_writes_under_blocks_shapes_and_scan_filters() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    for owner in ["alice", "bob"] {
        for form in ["block", "shape-base", "shape-field", "scan-filter", "merge-setup", "range", "new", "divmod", "pure"] {
            let mut programs = bound.programs.iter().map(|p| p.program.clone()).collect::<Vec<_>>();
            let scan = scans(programs.iter().find(|p| p.name == "page").unwrap())[0].clone();
            let guarded = programs.iter_mut().find(|p| p.name == "guarded").unwrap();
            let condition = guarded.body.iter_mut().find_map(|s| match s { Stmt::WriteTarget { condition, .. } => condition.as_mut(), _ => None }).unwrap();
            let leak = Stmt::Insert { table: "copies".into(), row: Expr::Object([
                ("id".into(), Expr::Literal(Value::Id("copy".into()))),
                ("secret".into(), Expr::Field { base: Box::new(var(&condition.old)), name: "secret".into() }),
            ].into()) };
            let block = Expr::Block { body: vec![leak.clone()], value: Box::new(Expr::Literal(Value::Bool(true))) };
            condition.value = match form {
                "block" => block,
                "shape-base" => Expr::Shape { base: Box::new(block), fields: Default::default() },
                "shape-field" => Expr::Shape { base: Box::new(Expr::Object(Default::default())), fields: [("leak".into(), block)].into() },
                "scan-filter" => Expr::Scan(Scan { filter: Some(Box::new(block)), ..scan }),
                "merge-setup" => Expr::Merge(Merge { site: "condition".into(), lanes: vec![MergeLane { setup: vec![leak], scan, source: None, binding: "lane".into() }] }),
                "range" => Expr::Block { body: vec![Stmt::For { binding: "n".into(), domain: LoopDomain::ExpressionRange { start: block, end_exclusive: Expr::Literal(Value::Int(1)) }, body: vec![] }], value: Box::new(Expr::Literal(Value::Bool(true))) },
                "new" => Expr::Input(Input::NewId),
                "divmod" => Expr::Builtin { builtin: Builtin::Divmod { remainder_sink: "stolen".into() }, args: vec![Expr::Literal(Value::Int(7)), Expr::Literal(Value::Int(2))] },
                "pure" => Expr::Block { body: vec![Stmt::Const { name: "match".into(), value: condition.value.clone() }], value: Box::new(var("match")) },
                _ => unreachable!(),
            };
            // Exercise actual serialization, not only the binder's validated IR.
            let programs: Vec<Program> = serde_json::from_str(&serde_json::to_string(&programs).unwrap()).unwrap();
            let mut e = Engine::memory(bound.schema.clone(), programs).unwrap();
            let row = wire::row_from_json(e.schema().table("records").unwrap(), &json!({"id":"target","owner":owner,"secret":"PRIVATE","amount":7})).unwrap();
            e.seed([("records".into(), row)]).unwrap();
            let before = e.store().rows("records").unwrap();
            let result = e.mutate("guarded", Some("same"), Context::new("bob", [("target".into(), Value::Id("target".into()))].into()).at(1000)).unwrap();
            let body = result.reply(Some("same"));
            if form == "pure" && owner == "bob" {
                assert!(matches!(result.state, WriteState::Sent { .. }), "{body}");
                assert_eq!(e.store().rows("records").unwrap()[0].field("amount"), Ok(&Value::Int(0)));
            } else {
                assert_eq!(body["why"]["code"], if form == "pure" { "NOT_FOUND" } else { "E_INPUT" }, "{owner} {form}: {body}");
                assert_eq!(e.store().rows("records").unwrap(), before);
            }
            assert!(e.store().rows("copies").unwrap().is_empty(), "{form}: old escaped");
            assert!(!e.store().applied_outcome("bob", "same").unwrap().unwrap().contains("PRIVATE"));
        }
    }
}
