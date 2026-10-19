//! Conservative source-domain evidence for operation results and refusal behavior.
// @ref LLP 3000.000.000.000#11-old-client-operation-contracts-rel5 — TypeScript numbers/strings must not erase consumed source-domain changes.
use crate::{Bound,BoundProgram};
use serde_json::Value;
use std::collections::{BTreeMap,BTreeSet};

// Inspect the complete operation: result construction may flow through writes,
// loops, merges, helper blocks or aggregate selectors. This deliberately includes
// guard/order dependencies rather than claiming a partial lineage analysis is exact.
fn consumed(value:&Value,tables:&mut BTreeSet<String>,fields:&mut BTreeSet<String>) {
    match value {
        Value::Object(object)=> {
            // Read, scan, merge lane, recursion and write targets all carry table.
            if let Some(table)=object.get("table").and_then(Value::as_str) {tables.insert(table.into());}
            if let Some(field)=object.get("Field") && let Some(name)=field["name"].as_str() {fields.insert(name.into());}
            // Aggregate, optional-field, range and sort selectors carry field directly.
            if let Some(field)=object.get("field").and_then(Value::as_str) {fields.insert(field.into());}
            for child in object.values() {consumed(child,tables,fields);}
        }
        Value::Array(array)=>for child in array {consumed(child,tables,fields);},
        _=>{}
    }
}
fn row_fields(ty:&crate::types::Ty,bound:&Bound,fields:&mut BTreeSet<String>) {
    use crate::types::Ty;
    match ty {
        Ty::Row(name)|Ty::WriteRow(name)|Ty::Page(name,_)=>if let Some(table)=bound.schema.table(name) {fields.extend(table.columns.keys().cloned());},
        Ty::RowShape(parts)|Ty::RowObject(parts)=>{fields.extend(parts.keys().cloned());for ty in parts.values(){row_fields(ty,bound,fields);}},
        Ty::Object(parts)=>for ty in parts.values(){row_fields(ty,bound,fields);},
        Ty::Optional(ty)|Ty::List(ty,_)|Ty::Collection(ty,_)=>row_fields(ty,bound,fields),
        _=>{}
    }
}
pub(crate) fn signature(program:&BoundProgram,bound:&Bound)->BTreeMap<String,String> {
    let mut tables=BTreeSet::new();let mut fields=BTreeSet::new();
    consumed(&serde_json::to_value(&program.program.body).unwrap(),&mut tables,&mut fields);
    row_fields(&program.result,bound,&mut fields);
    let mut out=BTreeMap::new();
    for name in tables {
        let Some(table)=bound.schema.table(&name) else {continue;};
        for field in &fields {
            if let Some(kind)=table.columns.get(field) {
                let constraints:Vec<_>=table.constraints.iter().filter(|c|matches!(c,snapback4_core::schema::Constraint::Text{field:name,..} if name==field)).collect();
                out.insert(format!("{name}.{field}"),format!("{kind:?};{constraints:?}"));
            }
        }
    }
    out
}
