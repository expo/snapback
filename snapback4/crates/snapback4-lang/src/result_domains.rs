//! Conservative declared-domain provenance for values reaching operation returns.
// @ref LLP 3000.000.000.000#11-old-client-operation-contracts-rel5 — inferred TypeScript numbers/strings must not erase declared result-domain changes.
use crate::{Bound,BoundProgram};
use serde_json::Value;
use std::collections::{BTreeMap,BTreeSet};

type Definitions=BTreeMap<String,Vec<Value>>;
fn definitions(value:&Value, defs:&mut Definitions, returns:&mut Vec<Value>) {
    match value {
        Value::Object(object)=> {
            for (kind,key) in [("Let","name"),("Const","name"),("Assign","name"),("Push","target")] {
                if let Some(binding)=object.get(kind) && let Some(name)=binding[key].as_str() {
                    defs.entry(name.into()).or_default().push(binding["value"].clone());
                }
            }
            if let Some(value)=object.get("Return") {returns.push(value.clone());}
            if let Some(loop_)=object.get("For") && let Some(name)=loop_["binding"].as_str() {
                let domain=&loop_["domain"];
                if let Some(page)=domain.get("Page") {defs.entry(name.into()).or_default().push(serde_json::json!({"Scan":page}));}
                else if let Some(array)=domain.get("DerivedArray") {defs.entry(name.into()).or_default().push(array["value"].clone());}
            }
            for child in object.values() {definitions(child,defs,returns);}
        }
        Value::Array(array)=>for child in array {definitions(child,defs,returns);},
        _=>{}
    }
}
fn dependencies(value:&Value,defs:&Definitions,seen:&mut BTreeSet<String>,tables:&mut BTreeSet<String>,fields:&mut BTreeSet<String>) {
    match value {
        Value::Object(object)=> {
            if let Some(name)=object.get("Variable").and_then(Value::as_str) && seen.insert(name.into()) {
                for definition in defs.get(name).into_iter().flatten() {dependencies(definition,defs,seen,tables,fields);}
            }
            if let Some(field)=object.get("Field") && let Some(name)=field["name"].as_str() {fields.insert(name.into());}
            for kind in ["Get","Scan","Merge"] {
                if let Some(read)=object.get(kind) && let Some(table)=read["table"].as_str() {tables.insert(table.into());}
            }
            for child in object.values() {dependencies(child,defs,seen,tables,fields);}
        }
        Value::Array(array)=>for child in array {dependencies(child,defs,seen,tables,fields);},
        _=>{}
    }
}
pub(crate) fn signature(program:&BoundProgram,bound:&Bound)->BTreeMap<String,String> {
    let mut defs=Definitions::new();let mut returns=Vec::new();
    definitions(&serde_json::to_value(&program.program.body).unwrap(),&mut defs,&mut returns);
    let mut tables=BTreeSet::new();let mut fields=BTreeSet::new();let mut seen=BTreeSet::new();
    for value in &returns {dependencies(value,&defs,&mut seen,&mut tables,&mut fields);}
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
