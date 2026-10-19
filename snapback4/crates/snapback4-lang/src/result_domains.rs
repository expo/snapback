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
            for key in ["field","next_field"] {if let Some(field)=object.get(key).and_then(Value::as_str) {fields.insert(field.into());}}
            for child in object.values() {consumed(child,tables,fields);}
        }
        Value::Array(array)=>for child in array {consumed(child,tables,fields);},
        _=>{}
    }
}
type Definitions=BTreeMap<String,Vec<Value>>;
fn definitions(value:&Value,defs:&mut Definitions) {
    match value {
        Value::Object(object)=> {
            for kind in ["Let","Const","Assign"] {
                if let Some(binding)=object.get(kind) && let Some(name)=binding["name"].as_str() {defs.entry(name.into()).or_default().push(binding["value"].clone());}
            }
            for child in object.values(){definitions(child,defs);}
        }
        Value::Array(array)=>for child in array{definitions(child,defs);},
        _=>{}
    }
}
fn payload_keys(value:&Value,defs:&Definitions,seen:&mut BTreeSet<String>)->Option<BTreeSet<String>> {
    if let Some(object)=value.get("Object").and_then(Value::as_object) {return Some(object.keys().cloned().collect());}
    if let Some(name)=value.get("Variable").and_then(Value::as_str) {
        if !seen.insert(name.into()){return None;}
        let mut keys=BTreeSet::new();
        for value in defs.get(name)? {keys.extend(payload_keys(value,defs,&mut seen.clone())?);}
        return Some(keys);
    }
    if let Some(shape)=value.get("Shape") {
        let mut keys=payload_keys(&shape["base"],defs,seen)?;
        keys.extend(shape["fields"].as_object()?.keys().cloned());return Some(keys);
    }
    if let Some(block)=value.get("Block") {return payload_keys(&block["value"],defs,seen);}
    None
}
fn writes(value:&Value,defs:&Definitions,bound:&Bound,fields:&mut BTreeSet<String>) {
    match value {
        Value::Object(object)=> {
            for (kind,payload) in [("Insert","row"),("InsertIfAbsent","row"),("Upsert","row"),("Update","patch"),("WriteTarget","patch")] {
                if let Some(write)=object.get(kind) {
                    if let Some(keys)=payload_keys(&write[payload],defs,&mut BTreeSet::new()) {fields.extend(keys);}
                    else {
                        // Opaque/spread write images conservatively consume their target domain.
                        let table=if kind=="WriteTarget" {write["target"]["table"].as_str()} else {write["table"].as_str()};
                        if let Some(table)=table.and_then(|name|bound.schema.table(name)) {fields.extend(table.columns.keys().cloned());}
                    }
                }
            }
            for child in object.values(){writes(child,defs,bound,fields);}
        }
        Value::Array(array)=>for child in array{writes(child,defs,bound,fields);},
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
    let body=serde_json::to_value(&program.program.body).unwrap();
    consumed(&body,&mut tables,&mut fields);
    let mut defs=Definitions::new();definitions(&body,&mut defs);writes(&body,&defs,bound,&mut fields);
    for read in snapback4_core::ir::read_sites(&program.program) {
        if let Some(table)=bound.schema.table(&read.table) && let Some(index)=table.index(&read.index) {
            // Physical key labels omit word/calendar/contribution source columns.
            fields.extend(table.columns.keys().filter(|column|index.uses_column(column)).cloned());
        }
    }
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
