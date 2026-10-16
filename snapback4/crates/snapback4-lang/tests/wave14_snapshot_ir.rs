//! The core must rederive source proofs safely for arbitrary IR too.
use snapback4_core::{Context, Engine, Value, value::object, ir::{self, Expr, Stmt, Input, BinaryOp as B, Read, KeyProvenance}};
use snapback4_lang::compile;
fn setup() -> (snapback4_core::schema::Schema, ir::Program, ir::Scan) {
    let b=compile(&[("schema.q".into(),"table anchors:\n  owner: principal\n  public\n  online only\ntable secrets:\n  payload: text\n  read <- deny\n  online only\nquery q(p: anchors, other: principal):\n  return secrets first 50 by .id\n".into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let p=b.programs.into_iter().next().unwrap().program;
    let scan=ir::scans(&p)[0].clone();
    (b.schema,p,scan)
}
fn anchor(name:&str) -> Stmt { Stmt::Let {name:name.into(),value:Expr::Get(Read {site:"capture".into(),table:"anchors".into(),index:"byId".into(),key:vec![ir::var("p")],provenance:KeyProvenance::Arg})} }
fn eq(op:B,a:Expr,b:Expr)->Expr {Expr::Binary {op,left:Box::new(a),right:Box::new(b)}}
fn require(condition:Expr)->Stmt {Stmt::Require {condition,code:"NO".into(),site:None,message:None}}
fn secrets_stay_hidden(mut schema:snapback4_core::schema::Schema,mut program:ir::Program,body:Vec<Stmt>, hidden:bool) {
    if hidden {schema.tables.get_mut("anchors").unwrap().rules.read=snapback4_core::schema::RuleExpr::Eq(snapback4_core::schema::RuleTerm::Field("owner".into()),snapback4_core::schema::RuleTerm::Viewer);}
    program.body=body;
    assert!(snapback4_core::engine::rules::snapshot_decided_scans(&schema,&program).is_empty());
    let mut e=Engine::memory(schema,[program]).unwrap();
    let mut rows=vec![("secrets".into(),object([("id",Value::Id("secret".into())),("payload",Value::String("must not escape".into()))]))];
    if hidden {rows.push(("anchors".into(),object([("id",Value::Id("a".into())),("owner",Value::Id("other".into()))])));}
    e.seed(rows).unwrap();
    let answer=e.query("q",Context::new("viewer",[("p".into(),Value::Id("a".into())),("other".into(),Value::Id("other".into()))].into()).with_ids(["new-a".into(),"new-b".into()])).unwrap();
    assert_eq!(answer.data,Value::Array(vec![]),"{answer:?}");
}
#[test]
fn contradictory_facts_from_different_binding_versions_never_authorize() {
    let (schema,p,scan)=setup();
    let body=vec![anchor("a"),Stmt::Let {name:"x".into(),value:Expr::Input(Input::Viewer)},
        require(eq(B::Eq,ir::var("x"),Expr::Input(Input::Viewer))),
        Stmt::Assign {name:"x".into(),value:ir::var("other")},
        require(eq(B::Ne,ir::var("x"),Expr::Input(Input::Viewer))),Stmt::Return(Expr::Scan(scan))];
    secrets_stay_hidden(schema,p,body,false);
}
#[test]
fn missing_and_hidden_snapshot_ids_are_null_not_the_requested_key() {
    for hidden in [false,true] {
        let (schema,p,scan)=setup();
        secrets_stay_hidden(schema,p,vec![anchor("a"),require(eq(B::Ne,ir::field(ir::var("a"),"id"),ir::var("p"))),Stmt::Return(Expr::Scan(scan))],hidden);
    }
}
#[test]
fn a_short_circuit_setup_is_not_its_final_boolean_value() {
    let (schema,p,scan)=setup();
    let body=vec![anchor("a"),Stmt::Let {name:"$b".into(),value:Expr::Literal(Value::Bool(true))},
        Stmt::If {condition:ir::var("$b"),then_body:vec![Stmt::Let {name:"rows".into(),value:Expr::Scan(scan)},Stmt::Assign {name:"$b".into(),value:Expr::Literal(Value::Bool(false))}],else_body:vec![]},Stmt::Return(ir::var("rows"))];
    secrets_stay_hidden(schema,p,body,false);
}
#[test]
fn implicit_row_bindings_cannot_supply_a_capture() {
    for name in ["$filter","$project"] {
        let (schema,mut p,scan)=setup();
        p.body=vec![anchor(name),require(eq(B::Ne,ir::field(ir::var(name),"id"),ir::var("p"))),Stmt::Return(Expr::Scan(scan))];
        assert!(snapback4_core::engine::rules::snapshot_decided_scans(&schema,&p).is_empty());
    }
}
#[test]
fn every_occurrence_of_an_ir_site_must_be_proved() {
    let b=compile(&[("schema.q".into(),"table anchors:\n  owner: principal\n  public\n  online only\ntable secrets:\n  payload: text <=40\n  read <- .payload = 'public'\n  online only\nquery q(p: anchors, other: principal):\n  return secrets where .payload = 'public' first 50 by .id\nquery all():\n  return secrets first 50 by .id\n".into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let program=b.programs.iter().find(|p|p.program.name=="q").unwrap().program.clone();
    let mut safe=ir::scans(&program)[0].clone();
    let all=b.programs.iter().find(|p|p.program.name=="all").unwrap();
    let mut unsafe_scan=ir::scans(&all.program)[0].clone();
    safe.site="forged-shared-site".into();unsafe_scan.site=safe.site.clone();
    let body=vec![anchor("a"),Stmt::Let {name:"visible".into(),value:Expr::Scan(safe)},Stmt::Return(Expr::Scan(unsafe_scan))];
    secrets_stay_hidden(b.schema,program,body,false);
}

#[test]
fn an_argument_cannot_shadow_a_reconstructed_short_circuit_temporary() {
    let (schema,mut p,scan)=setup();
    p.args.insert("$b".into(),ir::ArgType::Bool);
    p.body=vec![anchor("a"),require(eq(B::Eq,ir::var("$b"),Expr::Literal(Value::Bool(true)))),
        Stmt::Let {name:"$b".into(),value:Expr::Literal(Value::Bool(false))},
        Stmt::If {condition:ir::var("$b"),then_body:vec![Stmt::Assign {name:"$b".into(),value:Expr::Literal(Value::Bool(true))}],else_body:vec![]},Stmt::Return(Expr::Scan(scan))];
    assert!(snapback4_core::engine::rules::snapshot_decided_scans(&schema,&p).is_empty());
}

#[test]
fn two_fresh_id_evaluations_are_never_a_stable_identity() {
    let (schema,p,scan)=setup();
    secrets_stay_hidden(schema,p,vec![anchor("a"),require(eq(B::Ne,Expr::Input(Input::NewId),Expr::Input(Input::NewId))),Stmt::Return(Expr::Scan(scan))],false);
}
#[test]
fn a_reconstruction_cannot_reference_its_previous_value() {
    let (schema,p,scan)=setup();
    let body=vec![anchor("a"),Stmt::Let {name:"$b".into(),value:Expr::Literal(Value::Bool(false))},
        Stmt::If {condition:Expr::Unary {op:ir::UnaryOp::Not,value:Box::new(ir::var("$b"))},then_body:vec![Stmt::Assign {name:"$b".into(),value:eq(B::Eq,ir::var("$b"),Expr::Literal(Value::Bool(false)))}],else_body:vec![]},
        require(ir::var("$b")),require(eq(B::Ne,ir::var("$b"),Expr::Literal(Value::Bool(false)))),Stmt::Return(Expr::Scan(scan))];
    secrets_stay_hidden(schema,p,body,false);
}
#[test]
fn a_reconstruction_cannot_reference_another_temporaries_later_value() {
    let (schema,p,scan)=setup();
    let no=Expr::Literal(Value::Bool(false));
    let invert=|name:&str|Expr::Unary {op:ir::UnaryOp::Not,value:Box::new(ir::var(name))};
    let body=vec![anchor("a"),Stmt::Let {name:"$c".into(),value:no.clone()},Stmt::Let {name:"$b".into(),value:no.clone()},
        Stmt::If {condition:invert("$b"),then_body:vec![Stmt::Assign {name:"$b".into(),value:ir::var("$c")}],else_body:vec![]},
        Stmt::If {condition:invert("$c"),then_body:vec![Stmt::Assign {name:"$c".into(),value:Expr::Literal(Value::Bool(true))}],else_body:vec![]},
        require(eq(B::Eq,ir::var("$b"),no)),require(invert("$b")),Stmt::Return(Expr::Scan(scan))];
    secrets_stay_hidden(schema,p,body,false);
}
#[test]
fn nullable_unique_captures_cannot_stand_for_a_total_point() {
    let source="table anchors:\n  owner: principal ?\n  unique owner\n  read <- .owner = viewer\n  online only\ntable children:\n  anchor: anchors\n  owner: principal\n  read <- .owner = viewer and exists anchors[owner = .owner]\n  online only\nquery q(owner: principal):\n  a = anchors[owner = owner]\n  if a != null and a.owner = viewer:\n    return children where .owner = owner first 20 by .id\n  return children where .owner = owner first 20 by .id\n";
    let b=compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let program=&b.programs[0].program;
    assert!(snapback4_core::engine::rules::snapshot_decided_scans(&b.schema,program).is_empty());
}
