use snapback4_core::{
    engine::{Context, Engine, LoadMode, runner::Runner},
    ir::*, meter::{Ceilings, Cut, Meter}, schema::{self, Schema}, value::{Value, object},
};
use std::collections::BTreeMap;

const MODEL: &str = include_str!("../../snapback4-lang/tests/fixtures/maintained-columns.q");

fn schema() -> Schema {
    let bound = snapback4_lang::compile(&[("schema.q".into(), MODEL.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound.schema
}

fn shadowed(schema: &Schema, first: bool) -> Schema {
    let mut schema = schema.clone();
    let mut ordinary = schema.maintains[0].clone();
    ordinary.private = None;
    ordinary.source = "spoofs".into();
    ordinary.by = vec![schema::columns::GROUP.into()];
    schema.tables.insert("spoofs".into(), schema::public_table(
        BTreeMap::from([("id".into(), schema::ColumnType::Id),
            (schema::columns::GROUP.into(), schema::ColumnType::Optional(Box::new(schema::ColumnType::Ref { table: "posts".into() })))]),
        BTreeMap::from([("byId".into(), schema::Index::of(&["id"], true))]),
    ));
    if first { schema.maintains.insert(0, ordinary); } else { schema.maintains.push(ordinary); }
    schema
}

#[test]
fn duplicate_target_shadowing_is_rejected_at_admission() {
    for first in [true, false] {
        let raw = shadowed(&schema(), first);
        let issues = schema::validate(&raw);
        assert!(!format!("{issues:?}").contains(&schema().maintains[0].target));
        assert!(issues.iter().any(|i| i.message.contains("duplicate maintain target")), "{issues:?}");
        let error = Engine::memory(raw, []).err().expect("duplicate target admitted");
        assert!(error.to_string().contains("duplicate maintain target"), "{error}");
        assert!(!error.to_string().contains("$column:"));
    }
    let bound = snapback4_lang::compile(&[("schema.q".into(),
        "table items:\n  group: int\n  public\n  online only\nmaintain counts: count items by group\n  read <- allow\n  online only\n".into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut ordinary = bound.schema;
    ordinary.maintains.push(ordinary.maintains[0].clone());
    assert!(Engine::memory(ordinary, []).err().unwrap().to_string().contains("duplicate maintain target"));
}

#[test]
fn duplicate_target_never_changes_projection_or_system_read_privacy() {
    let base = schema();
    let target = base.maintains[0].target.clone();
    let key = schema::maintained_id(&[Value::Id("p".into())]);
    let mut engine = Engine::memory(base.clone(), []).unwrap();
    engine.load_mode([(target.clone(), object([
        ("id", Value::Id(key.clone())), (schema::columns::GROUP, Value::Id("p".into())), ("value", Value::Int(7)),
    ]))], LoadMode::Restore).unwrap();
    for first in [true, false] {
        let raw = shadowed(&base, first);
        assert!(!raw.visible(&target));
        let projection = raw.public_projection();
        assert!(!projection.tables.contains_key(&target));
        assert!(projection.maintains.iter().all(|m| m.target != target));
        assert!(!serde_json::to_string(&projection).unwrap().contains(&target));
        let read = Read { table: target.clone(), index: "byId".into(), key: vec![Expr::Literal(Value::Id(key.clone()))], site: "probe".into(), provenance: KeyProvenance::Computed };
        let scan = Scan { variant: None, table: target.clone(), index: "byId".into(), prefix: vec![], order: Order::Asc, take: Bound::Literal(1), site: "probe".into(), provenance: KeyProvenance::Computed, existence: false, after: None, before: None, range: None, filter: None, opaque_cursor: false, merge_site: None };
        let tx = engine.store_mut().transaction().unwrap();
        for expression in [Expr::Get(read.clone()), Expr::Exists(read), Expr::Scan(scan)] {
            let program = Program { name: "probe".into(), kind: ProgramKind::Query, args: BTreeMap::new(), read_time_granularity_ms: None, body: vec![Stmt::Return(expression)], native: false, returned_shapes: Default::default() };
            let mut runner = Runner::new(&tx, &raw, Context::system(), Meter::new(Ceilings::unbounded(), Cut::Abort), 1);
            let error = runner.run(&program).unwrap_err();
            assert_eq!(error.code(), "E_MAINTAINED_COLUMN_PRIVATE");
            assert!(error.to_string().contains("posts.likeCount"));
            assert!(!error.to_string().contains(&target));
        }
        tx.rollback().unwrap();
    }
}

#[test]
fn private_derivations_reject_malformed_raw_target_shapes() {
    let base = schema();
    for case in 0..7 {
        let mut raw = base.clone();
        let target = raw.maintains[0].target.clone();
        match case {
            0 => { raw.tables.get_mut(&target).unwrap().columns.remove("value"); },
            1 => { raw.tables.get_mut(&target).unwrap().indexes.remove("byGroup"); },
            2 => { raw.tables.get_mut(&target).unwrap().expire = Some("value".into()); },
            3 => { raw.tables.get_mut(&target).unwrap().sync = Some(schema::Sync { audience: schema::Audience::Public, horizon: None }); },
            4 => { raw.tables.get_mut("posts").unwrap().maintained.insert("likeCount".into(), "forged".into()); },
            5 => { raw.tables.get_mut(&target).unwrap().columns.insert("extra".into(), schema::ColumnType::Int); },
            _ => raw.maintains[0].by.push("postId".into()),
        }
        let error = Engine::memory(raw, []).err().expect("malformed private derivation admitted");
        assert_eq!(error.code(), "E_SCHEMA", "case {case}: {error}");
        assert!(!error.to_string().contains(&target), "case {case}: {error}");
    }
    let projected = base.public_projection();
    let error=Engine::memory(projected, []).err().expect("a projection is not an authoritative schema");
    assert!(error.to_string().contains("exactly one engine derivation"));
    assert!(!error.to_string().contains(&base.maintains[0].target));
}

#[test]
fn every_private_target_refuses_nested_ir_and_native_program_admission() {
    let schema=schema();
    for maintain in &schema.maintains {
        let read=Read {table:maintain.target.clone(),index:"byId".into(),key:vec![Expr::Literal(Value::Id("p".into()))],site:"nested".into(),provenance:KeyProvenance::Computed};
        for native in [false,true] {
            for statement in [Stmt::Return(Expr::Array(vec![Expr::Get(read.clone())])),
                Stmt::If {condition:Expr::Literal(Value::Bool(false)),then_body:vec![Stmt::Insert {table:maintain.target.clone(),row:Expr::Literal(Value::Null)}],else_body:vec![]}] {
                let program=Program {name:"bad".into(),kind:ProgramKind::Mutation,args:BTreeMap::new(),read_time_granularity_ms:None,body:vec![statement],native,returned_shapes:Default::default()};
                let error=Engine::memory(schema.clone(),[program]).err().expect("private IR admitted");
                assert_eq!(error.code(),"E_MAINTAINED_COLUMN_PRIVATE","{error}");
                assert!(error.to_string().contains(&maintain.label()));
                assert!(!error.to_string().contains(&maintain.target));
            }
        }
    }
}
