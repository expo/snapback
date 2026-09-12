// @ref LLP 1019#6-receipts-with-receipts — one bounded certified mutation;
// clients submit event identities, never row/principal/received assertions.
use crate::*;
use super::{Deliver, declarations};
use std::collections::BTreeMap;

pub const ACK_BATCH: u32 = 50;
pub fn ack_name(d: &Deliver) -> String { format!("_delivery.{}.ack", d.log) }
fn var(name: &str) -> Expr { Expr::Variable(name.into()) }
fn field(base: &str, name: &str) -> Expr { Expr::Field { base: Box::new(var(base)), name: name.into() } }
fn get(table: &str, key: Expr, site: &str) -> Expr {
    Expr::Get(Read { site: site.into(), table: table.into(), index: "byId".into(), key: vec![key], provenance: KeyProvenance::Shape })
}
fn ne_null(value: Expr) -> Expr { Expr::Binary { op: BinaryOp::Ne, left: Box::new(value), right: Box::new(Expr::Literal(Value::Null)) } }

pub fn ack_program(content: &str, d: &Deliver) -> Program {
    let name = ack_name(d);
    Program {
        name: name.clone(), kind: ProgramKind::Mutation, read_time_granularity_ms: None,
        args: BTreeMap::from([("events".into(), ArgType::List { of: Some(Box::new(ArgType::Ref { table: d.log.clone() })), max: ACK_BATCH })]),
        body: vec![Stmt::For { binding: "eventId".into(), domain: LoopDomain::ArgList { name: "events".into(), max: ACK_BATCH }, body: vec![
            Stmt::Let { name: "event".into(), value: get(&d.log, var("eventId"), &format!("{name}.event")) },
            Stmt::If { condition: ne_null(var("event")), else_body: vec![], then_body: vec![
                Stmt::If { condition: Expr::Binary { op: BinaryOp::Ne, left: Box::new(field("event", "kind")), right: Box::new(Expr::Literal(Value::String("removed".into()))) }, else_body: vec![], then_body: vec![
                    Stmt::Let { name: "content".into(), value: get(content, field("event", "row"), &format!("{name}.content")) },
                    Stmt::Require { condition: ne_null(var("content")), code: "E_RULE".into(), site: None },
                    Stmt::If { condition: ne_null(var("content")), else_body: vec![], then_body: vec![
                        Stmt::Let { name: "receipt".into(), value: Expr::Get(Read { site: format!("{name}.receipt"), table: d.receipts_table().unwrap(), index: "byRow".into(),
                            key: vec![field("event", "row"), Expr::Input(Input::Viewer)], provenance: KeyProvenance::Shape }) },
                        Stmt::Require { condition: ne_null(var("receipt")), code: "E_RULE".into(), site: None },
                        Stmt::If { condition: ne_null(var("receipt")), else_body: vec![], then_body: vec![
                            Stmt::Let { name: "original".into(), value: get(&d.log, field("receipt", "id"), &format!("{name}.original")) },
                            Stmt::Update { table: d.receipts_table().unwrap(), key: field("receipt", "id"),
                            patch: Expr::Object(BTreeMap::from([("received".into(), Expr::Literal(Value::Bool(true))), ("seq".into(), Expr::Input(Input::Now))])) }] },
                    ] },
                ] },
            ] },
        ] }, Stmt::Return(Expr::Literal(Value::Null))],
    }
}
pub fn acknowledgement<'a>(schema: &'a Schema, program: &Program) -> Option<(&'a str, &'a Deliver)> {
    declarations(schema).find_map(|(content, _, d)| (d.receipts && program.name == ack_name(d)
        && *program == ack_program(content, d)).then_some((content, d)))
}

pub fn receipt_row(schema: &Schema, content: &Value, event: &Value, table: &str, received: bool, seq: i64) -> Result<Value, RuntimeError> {
    let mut row = BTreeMap::from([
        ("id".into(), event.field("id")?.clone()), ("row".into(), event.field("row")?.clone()),
        ("recipient".into(), event.field("recipient")?.clone()),
        ("received".into(), Value::Bool(received)), ("seq".into(), Value::Int(seq)),
    ]);
    for key in schema.tables[table].columns.keys() {
        if !row.contains_key(key) { row.insert(key.clone(), content.field(key)?.clone()); }
    }
    Ok(Value::Row(row.into()))
}
