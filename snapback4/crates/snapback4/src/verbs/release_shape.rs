//! Result shape identity is separate from source and successful call identity.
// @ref LLP 3000.000.000#22-wave-29-release-identity-rel2 — compare every predecessor export's bound wire result.
use snapback4_lang::{Bound, types::Ty};
use serde_json::{Value, json};
use std::path::Path;

fn shape(ty:&Ty,bound:&Bound)->Value {
    match ty {
        Ty::Row(name)|Ty::WriteRow(name)=> {
            let Some(table)=bound.schema.table(name) else{return json!({"unknownTable":name})};
            let mut fields=serde_json::Map::new();fields.insert("id".into(),json!("id"));
            for (column,kind) in table.columns.iter().filter(|(column,_)|!table.engine_field(column)
                &&!snapback4_core::schema::timeline::is_slot(column)&&column.as_str()!="$global"
                &&(!matches!(ty,Ty::WriteRow(_))||!table.maintained.contains_key(*column))) {
                let value=shape(&Ty::from_column(kind),bound);
                fields.insert(column.clone(),if table.read_optional(column){json!({"omittable":value})}else{value});
            }
            json!({"row":fields})
        },
        Ty::Page(name,_)=>json!({"page":shape(&Ty::Row(name.clone()),bound)}),
        Ty::Collection(item,_)=>json!({"page":shape(item,bound)}),
        Ty::List(item,_)=>json!({"list":shape(item,bound)}),
        Ty::Optional(item)=>json!({"nullable":shape(item,bound)}),
        Ty::Omittable(item)=>json!({"omittable":shape(item,bound)}),
        Ty::Object(fields)|Ty::RowShape(fields)|Ty::RowObject(fields)=> {
            let fields=fields.iter().map(|(name,ty)|(name.clone(),shape(ty,bound))).collect::<serde_json::Map<_,_>>();
            json!({"row":fields})
        },
        Ty::Text(_)=>json!("text"),Ty::Ref(_)|Ty::Id=>json!("id"),
        Ty::Enum(values)=>{let mut labels=values.clone();labels.sort();labels.dedup();json!({"enum":labels})},
        other=>json!(format!("{other:?}")),
    }
}

pub(super) fn compare(target:u64,old:&Bound,served:&Bound)->Value {
    let mut differences=Vec::new();
    for previous in &old.programs {
        if matches!(previous.program.kind,snapback4_core::ir::ProgramKind::Job){continue;}
        let expected=shape(&previous.result,old);
        let current=served.programs.iter().find(|p|p.program.name==previous.program.name&&p.program.kind==previous.program.kind).map(|p|shape(&p.result,served));
        if current.as_ref()!=Some(&expected){differences.push(json!({"operation":previous.program.name,"expected":expected,"served":current}));}
    }
    let tables=served.schema.tables.iter().map(|(name,table)|(name.clone(),table.columns.keys()
        .filter(|column|!table.engine_field(column)&&!snapback4_core::schema::timeline::is_slot(column)&&column.as_str()!="$global")
        .cloned().collect::<Vec<_>>())).collect::<std::collections::BTreeMap<_,_>>();
    let children=served.schema.extractions.iter().map(|e|json!({"parent":e.parent,"child":e.child,"columns":e.fields.keys().collect::<Vec<_>>()})).collect::<Vec<_>>();
    json!({"target":target,"matchesTarget":differences.is_empty(),"differences":differences,"tables":tables,"children":children})
}
pub(super) fn at(dir:&Path,release:u64)->Result<Value,String> {
    let root=dir.join("releases").join(release.to_string());
    let served=super::releases::bound_at(root.clone())?;
    let target=super::rollback_views::metadata(&root)?.map(|v|v.target).unwrap_or(release);
    let old=if target==release {None}else{Some(super::releases::bound_at(dir.join("releases").join(target.to_string()))?)};
    Ok(compare(target,old.as_ref().unwrap_or(&served),&served))
}
pub(super) fn print(value:&Value) {
    println!("target row shape: {} (release {})",if value["matchesTarget"]==true{"preserved"}else{"CHANGED"},value["target"]);
    for diff in value["differences"].as_array().into_iter().flatten() {
        println!("  {}: expected {}; serves {}",diff["operation"].as_str().unwrap_or("?"),diff["expected"],diff["served"]);
    }
    for child in value["children"].as_array().into_iter().flatten() {
        println!("  child {} of {} serves columns {}",child["child"],child["parent"],child["columns"]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn projections_never_invent_id_inside_optional_nested_or_collection_results() {
        let source="table items:\n  label: text <=20\n  public\n  online only\n";
        for (a,b) in [
            ("query get(id: items):\n  return items[id] {id, label}\n", "query get(id: items):\n  return items[id] {label}\n"),
            ("query get(id: items):\n  return {item:items[id] {id, label}}\n", "query get(id: items):\n  return {item:items[id] {label}}\n"),
            ("query get():\n  return items last 10 by .id {id, label}\n", "query get():\n  return items last 10 by .id {label}\n"),
        ] {
            let old=snapback4_lang::compile(&[("schema.q".into(),source.to_owned()+a)]);
            let now=snapback4_lang::compile(&[("schema.q".into(),source.to_owned()+b)]);
            assert!(old.diagnostics.is_empty(),"{:?}",old.diagnostics);assert!(now.diagnostics.is_empty(),"{:?}",now.diagnostics);
            assert_eq!(compare(1,&old,&now)["matchesTarget"],false);
            assert_eq!(compare(1,&old,&old)["matchesTarget"],true);
        }
    }
    #[test]
    fn enum_label_order_is_not_a_wire_shape_change_but_new_labels_are() {
        let source="table items:\n  status: enum('a', 'b')\n  read <- allow\n  online only\nquery get(id: items):\n  return items[id] {status}\n";
        let compile=|s:String|{let b=snapback4_lang::compile(&[("schema.q".into(),s)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b};
        let old=compile(source.into());
        let reordered=compile(source.replace("'a', 'b'","'b', 'a'"));
        assert_eq!(compare(1,&old,&reordered)["matchesTarget"],true);
        let widened=compile(source.replace("'a', 'b'","'b', 'a', 'c'"));
        assert_eq!(compare(1,&old,&widened)["matchesTarget"],false);
    }
    #[test]
    fn served_columns_exclude_compiler_owned_storage_cells() {
        let current=include_str!("../../tests/fixtures/rel2/wave29-040-v2.q");
        let b=snapback4_lang::compile(&[("schema.q".into(),current.into())]);
        assert!(b.diagnostics.is_empty());
        let result=compare(2,&b,&b);
        let columns=result["tables"]["idCards"].as_array().unwrap();
        assert!(columns.contains(&json!("serialPhoto")));
        assert!(!columns.iter().any(|c|c.as_str().unwrap().starts_with('$')));
    }
    #[test]
    fn maintained_cells_are_absent_from_write_rows_and_present_after_reread() {
        let source=include_str!("../../../snapback4-lang/tests/fixtures/maintained-columns.q");
        let reread=source.replace("  return insert posts { id, at }","  p = insert posts { id, at }\n  return posts[p.id] ! else MISSING");
        let before=snapback4_lang::compile(&[("schema.q".into(),reread)]);
        let served=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
        assert!(before.diagnostics.is_empty(),"{:?}",before.diagnostics);assert!(served.diagnostics.is_empty(),"{:?}",served.diagnostics);
        assert_eq!(compare(1,&before,&served)["matchesTarget"],false);
        for (bound,has_totals) in [(before,true),(served,false)] {
            let mut engine=snapback4_core::Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
            let result=engine.mutate("post",None,snapback4_core::Context::new("alice",std::collections::BTreeMap::from([("id".into(),snapback4_core::Value::Id("post".into())),("at".into(),snapback4_core::Value::Int(1))]))).unwrap();
            let snapback4_core::engine::WriteState::Sent{result,..}=result.state else{panic!("post refused")};
            assert_eq!(result.field("likeCount").is_ok(),has_totals);
        }
    }

}
