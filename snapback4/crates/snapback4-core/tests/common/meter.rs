//! Shared IR fixtures: the binder's concurrent language changes are not inputs.
#![allow(dead_code)]
use snapback4_core::ir::*;
use snapback4_core::schema::*;
use snapback4_core::value::{Value, object};
use snapback4_core::{Context, Engine};
use std::collections::BTreeMap;

pub fn program(name: &str, kind: ProgramKind, body: Vec<Stmt>) -> Program {
    Program { name: name.into(), kind, args: BTreeMap::new(), read_time_granularity_ms: None, body, native: false, returned_shapes: Default::default() }
}

pub fn builtin(builtin: Builtin, args: Vec<Expr>) -> Expr { Expr::Builtin { builtin, args } }
pub fn text(text: &str) -> Expr { Expr::Literal(Value::String(text.into())) }
pub fn int(value: i64) -> Expr { Expr::Literal(Value::Int(value)) }
pub fn context() -> Context { Context::new("alice", BTreeMap::new()).at(1) }

pub fn schema() -> Schema {
    let mut table = Table {
        ephemeral: None,        sequences: Default::default(), written_by: Default::default(), update_transition: false, through: None,
        maintained: BTreeMap::new(), recorded: BTreeMap::new(),
        defaults: BTreeMap::new(),
        residency: Default::default(),
        columns: BTreeMap::from([("id".into(), ColumnType::Id), ("bucket".into(), ColumnType::Int), ("body".into(), ColumnType::Text { max: 4000 })]),
        indexes: BTreeMap::from([("byId".into(), Index::of(&["id"], true)), ("byBucket".into(), Index::of(&["bucket", "id"], false))]),
        rules: Rules { read: RuleExpr::Allow, insert: RuleExpr::Allow, update: RuleExpr::Allow, delete: RuleExpr::Allow },
        constraints: Vec::new(), leave: LeavePolicy::UntilRevoked, sync: Some(Sync { audience: Audience::Public, horizon: None, also: Vec::new() }), expire: None,
    };
    let writes = table.clone();
    table.constraints.push(Constraint::Cap { by: vec!["bucket".into()], max: 128 });
    Schema { tables: BTreeMap::from([("messages".into(), table), ("writes".into(), writes)]), ..Schema::default() }
}

pub fn scan(take: u32) -> Scan {
    Scan { cursor_pins: 0, variant: None, site: "messages.page".into(), table: "messages".into(), index: "byBucket".into(), prefix: vec![IndexKeyExpr::Scalar(int(0))], order: Order::Asc,
        take: Bound::Literal(take), existence: false, after: None, before: None, range: None, filter: None, opaque_cursor: false, merge_site: None, provenance: KeyProvenance::Const }
}

pub fn rows(count: usize) -> Vec<(String, Value)> {
    (0..count).map(|n| ("messages".into(), object([("id", Value::Id(format!("m{n:05}"))), ("bucket", Value::Int(0)), ("body", Value::String("x".repeat(4000)))]))).collect()
}

pub fn engine(programs: Vec<Program>, count: usize) -> Engine {
    let mut engine = Engine::memory(schema(), programs).unwrap();
    engine.seed(rows(count)).unwrap();
    engine
}

pub fn growing(name: &str, kind: ProgramKind, push: bool, count: u32) -> Program {
    let value = field(var("row"), "body");
    let accumulation = if push {
        Stmt::For { binding: "repeat".into(), domain: LoopDomain::LiteralRange { start: 0, end_exclusive: 64 },
            body: vec![Stmt::Push { target: "acc".into(), value }] }
    } else {
        Stmt::Assign { name: "acc".into(), value: builtin(Builtin::Concat, vec![var("acc"), value]) }
    };
    let mut body = Vec::new();
    if kind == ProgramKind::Mutation {
        body.push(Stmt::Insert { table: "writes".into(), row: Expr::Literal(object([("id", Value::Id("written-before-cut".into())), ("bucket", Value::Int(0)), ("body", Value::String("ok".into()))])) });
    }
    body.extend([
        Stmt::Let { name: "acc".into(), value: if push { Expr::Array(Vec::new()) } else { text("") } },
        Stmt::For { binding: "row".into(), domain: LoopDomain::Page(scan(if kind == ProgramKind::Mutation { 128 } else { count })), body: vec![accumulation] },
        Stmt::Return(builtin(Builtin::Len, vec![var("acc")])),
    ]);
    program(name, kind, body)
}

pub fn measured_programs() -> Vec<Program> {
    vec![
        growing("concat_page_8", ProgramKind::Query, false, 8),
        growing("push_page_8", ProgramKind::Query, true, 8),
        program("count_text_100", ProgramKind::Query, vec![
            Stmt::Let { name: "s".into(), value: text(&"x".repeat(4000)) },
            Stmt::For { binding: "i".into(), domain: LoopDomain::LiteralRange { start: 0, end_exclusive: 100 }, body: vec![
                Stmt::Let { name: "n".into(), value: builtin(Builtin::Len, vec![var("s")]) },
            ] },
            Stmt::Return(var("n")),
        ]),
    ]
}

pub fn written() -> Program {
    program("written", ProgramKind::Query, vec![Stmt::Return(Expr::Exists(Read {
        site: "written".into(), table: "writes".into(), index: "byId".into(), key: vec![Expr::Literal(Value::Id("written-before-cut".into()))], provenance: KeyProvenance::Const,
    }))])
}
