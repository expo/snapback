//! Translate the frozen v1 corpus cursor into today's host-scoped envelope.
//! Descriptors, suffix values, prefix inputs and generation come from the fixture, never the result.
use snapback4_core::{Program, Schema, Value};
use snapback4_core::cursor::{CursorScope, decode_cursor, encode_cursor};
use snapback4_core::ir::{Expr, Input, IndexKeyExpr};
use std::collections::BTreeMap;

pub fn scope(token: &str, schema: &Schema, program: &Program, viewer: &str, args: &BTreeMap<String, Value>) -> Option<String> {
    let mut position = decode_cursor(schema, token).ok()?;
    let scan = snapback4_core::ir::scans(program).into_iter().find(|scan| scan.opaque_cursor && scan.merge_site.is_none() && scan.table == position.table && scan.index == position.index && scan.order == position.order)?;
    let prefix = scan.prefix.iter().map(|expr| match expr {
        IndexKeyExpr::Scalar(Expr::Literal(value)) => Some(value.clone()),
        IndexKeyExpr::Scalar(Expr::Input(Input::Viewer)) => Some(Value::Id(viewer.into())),
        IndexKeyExpr::Scalar(Expr::Variable(name)) => args.get(name).cloned(),
        _ => None,
    }).collect::<Option<Vec<_>>>()?;
    position.scope = Some(CursorScope { variant: None, generation: 1, prefix });
    encode_cursor(schema,&position).ok()
}
pub fn translate(value: &mut serde_json::Value, schema: &Schema, program: &Program, viewer: &str, args: &BTreeMap<String, Value>) {
    match value {
        serde_json::Value::String(token) => if let Some(scoped) = scope(token,schema,program,viewer,args) { *token=scoped; },
        serde_json::Value::Array(items) => for item in items { translate(item,schema,program,viewer,args); },
        serde_json::Value::Object(fields) => for item in fields.values_mut() { translate(item,schema,program,viewer,args); },
        _ => {}
    }
}
