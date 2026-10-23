//! @ref LLP 3000.000.000#16-release-reactivation-and-rollback-foresight-rel5 — future-write risks are distinct from snapshot validation.
use snapback4_core::{Schema, successor::{self, Change}, schema::ColumnDefault};
use std::path::Path;

pub(super) fn missing_defaults(candidate:&Schema,old:&Schema)->Result<Vec<String>,String>{
    let names=candidate.table_renames.iter().filter(|(new,prior)|old.table(prior).is_some()&&old.table(new).is_none()).map(|(new,prior)|(prior.clone(),new.clone())).collect();
    let old=old.with_table_names(&names).map_err(|e|e.to_string())?;
    let mut missing=Vec::new();
    for(name,target)in old.visible_tables().filter(|(_,t)|t.ephemeral.is_none()){
        let Some(from)=candidate.table(name)else{continue};if old.maintain_for(name).is_some(){continue}
        for(column,kind)in &target.columns {
            let renamed=candidate.asset_renames.get(name).is_some_and(|map|map.iter().any(|(new,prior)|prior==column&&from.columns.contains_key(new)));
            if !target.engine_field(column)&&!snapback4_core::schema::timeline::is_slot(column)&&!target.maintained.contains_key(column)&&matches!(target.defaults.get(column),Some(ColumnDefault::Literal(_)))&&!from.columns.contains_key(column)&&!renamed&&!projected(candidate,name,column,kind){missing.push(format!("{name}.{column}"));}
        }
    }Ok(missing)
}

pub(super) fn risks(candidate: &Schema, old: &Schema, release: u64, dir: &Path) -> Vec<String> {
    risks_for(candidate,old,release,dir,true,true)
}
// Timeline event slots are compiler-owned delivery metadata, not authored old
// cells. Retiring a rebuildable feed must not manufacture a visibility view.
pub(super) fn old_row_risks(candidate:&Schema,old:&Schema,release:u64,dir:&Path)->Vec<String>{
    risks_for(candidate,old,release,dir,false,false)
}
fn risks_for(candidate:&Schema,old:&Schema,release:u64,dir:&Path,include_new_tables:bool,include_constraints:bool)->Vec<String>{
    let names:std::collections::BTreeMap<_,_>=candidate.table_renames.iter().filter(|(new,prior)|old.table(prior).is_some() && old.table(new).is_none()).map(|(new,prior)|(prior.clone(),new.clone())).collect();
    if names.is_empty(){return risks_aligned(candidate,old,release,dir,include_new_tables,include_constraints)}
    let aligned=match old.with_table_names(&names){Ok(schema)=>schema,Err(error)=>return vec![format!("rollback foresight cannot compare renamed identities: {error}; run exact rollback --check")]};
    risks_aligned(candidate,&aligned,release,dir,include_new_tables,include_constraints).into_iter().map(|line|{
        let (mut facts,command)=line.split_once("; run `").map_or((line.clone(),String::new()),|(facts,command)|(facts.to_owned(),format!("; run `{command}")));
        for (prior,new) in &names {facts=facts.replace(&format!(", {new}."),&format!(", {prior} (current {new}).")).replace(&format!("table {new}:"),&format!("table {prior} (current {new}):")).replace(&format!("unique index {new}."),&format!("unique index {prior} (current {new})."));}
        facts+&command
    }).collect()
}
fn risks_aligned(candidate:&Schema,old:&Schema,release:u64,dir:&Path,include_new_tables:bool,include_constraints:bool)->Vec<String>{
    let mut risks:Vec<_>=successor::classify(candidate,old).into_iter().filter_map(|step| {
        let path=step.path.strip_prefix("tables.")?;
        let (table,column)=path.split_once(".columns.")?;
        let target=old.tables.get(table)?;
        if target.engine_field(column) || snapback4_core::schema::timeline::is_slot(column) || old.maintain_for(table).is_some() || target.maintained.contains_key(column) {return None;}
        let before=target.columns.get(column)?;
        if projected(candidate,table,column,before) {return None;}

        let from=candidate.tables.get(table)?;
        let source_kind=from.columns.get(column).or_else(||candidate.asset_renames.get(table)?.iter().find(|(_,old)|old.as_str()==column).and_then(|(new,_)|from.columns.get(new)));
        let reason=match source_kind {
            None if !before.is_optional() && !matches!(target.defaults.get(column),Some(ColumnDefault::Literal(_))) =>
                "without a fitting reverse projection, new rows will lack the old required field, so rollback can refuse".to_owned(),
            Some(kind) if kind!=before && matches!(step.change,Change::Narrowing|Change::Destructive) =>
                format!("new writes allowed by {kind} may not fit {before}, so rollback can hide rows; {}", remedy(before)),
            _ => return None,
        };
        Some(format!("rollback foresight: release {release}, {table}.{column}: {reason}; keep an expand/contract bridge with the old required fields and compatible domains; run `snapback4 rollback {} --to {release} --check --bridge <new-dir>` after writes",dir.display()))
    }).collect();
    // @ref LLP 3000.000.000#19-dormant-visibility-and-migration-dorm — warn before new writes, including harmless newer-only facts and empty legacy cells.
    for (name, _) in candidate.visible_tables().filter(|(name,t)|t.ephemeral.is_none() && candidate.maintain_for(name).is_none()) {
        if include_new_tables && old.table(name).is_none() && !candidate.table_renames.get(name).is_some_and(|source|old.table(source).is_some()) {
            risks.push(format!("rollback foresight: rows written to new table {name} will be hidden while release {release} is live; release {release} has no such table, so these are newer-only facts, not lost old-table records; a same-table `down` cannot create this missing table; keep it in a loosened bridge or declare a table rename; run `snapback4 rollback {} --to {release} --check --bridge <new-dir>` after writes",dir.display()));
        }
    }
    for (name,target) in old.visible_tables().filter(|(_,t)|t.ephemeral.is_none()) {
        let Some(from)=candidate.tables.get(name) else {continue;};
        if old.maintain_for(name).is_some() {continue;}
        for (column,kind) in &target.columns {
            if projected(candidate,name,column,kind) || from.columns.contains_key(column) || target.engine_field(column) || snapback4_core::schema::timeline::is_slot(column) || target.maintained.contains_key(column) {continue;}
            let interpretation=if kind.is_optional() {"null".to_owned()} else if let Some(ColumnDefault::Literal(value))=target.defaults.get(column) {format!("the old default {}",snapback4_core::wire::to_json(value))} else {continue;};
            let suggestions=cross_table_suggestions(candidate,old,name,column,kind,target.defaults.get(column));
            risks.push(format!("rollback foresight: release {release}, {name}.{column}: without a fitting reverse projection, records created while this field is absent have no retained old cell and will show {interpretation} to release {release} users; declare a reverse projection from the replacement value, or retain the field in a bridge release; {suggestions}run `snapback4 rollback {} --to {release} --check --bridge <new-dir>` after writes",dir.display()));
        }
        // Registration compares constraint domains structurally in
        // release_bridge::requires_view (including renamed fields). General
        // foresight advice also explains constraint changes, but is not a
        // second, less precise admission predicate.
        if include_constraints {
        for (index,definition) in &target.indexes {
            if definition.unique && from.indexes.get(index)!=Some(definition) {
                risks.push(format!("rollback foresight: release {release}, unique index {name}.{index}: future writes may introduce duplicate keys and refuse restoration; keep the old uniqueness in a bridge; run `snapback4 rollback {} --to {release} --check --bridge <new-dir>` after writes",dir.display()));
            }
        }
        if target.constraints.iter().any(|constraint| {
            if from.constraints.contains(constraint){return false;}
            match constraint {
                snapback4_core::schema::Constraint::Text{field,..}=>!target.columns.get(field).is_some_and(|kind|projected(candidate,name,field,kind)),
                snapback4_core::schema::Constraint::Cap{by,max}=>!from.constraints.iter().any(|c|matches!(c,snapback4_core::schema::Constraint::Cap{by:next_by,max:next_max}if next_by==by&&next_max<=max)),
                snapback4_core::schema::Constraint::FinalExistsOnInsert{..}=>true,
                _=>false,
            }
        }) {
            risks.push(format!("rollback foresight: release {release}, table {name}: changed constraints may let future writes refuse rollback; preserve old bounds/quotas in a bridge; run `snapback4 rollback {} --to {release} --check --bridge <new-dir>` after writes",dir.display()));
        }
        }
    }
    risks
}

fn projected(candidate:&Schema,table:&str,column:&str,kind:&snapback4_core::schema::ColumnType)->bool {
    candidate.extractions.iter().any(|e|e.parent==table&&e.fields.values().any(|c|c==column)) || (scalar(kind) && candidate.downfills.iter().any(|f|f.table==table && f.outputs.contains(column))) || candidate.asset_renames.get(table).is_some_and(|map|map.iter().any(|(new,old)|old==column && candidate.tables.get(table).and_then(|t|t.columns.get(new))==Some(kind)))
}
fn scalar(kind:&snapback4_core::schema::ColumnType)->bool {
    use snapback4_core::schema::ColumnType::*;
    match kind {Optional(k)=>scalar(k),Image{..}|Video{..}|File{..}|List{..}|ListRange{..}|Ref{..}=>false,_=>true}
}
fn remedy(kind:&snapback4_core::schema::ColumnType)->&'static str {
    if scalar(kind) {"declare a truthful scalar `down`, or generate a loosened bridge"}
    else {"computed `down` cannot project files, images, collections or references; generate a loosened bridge, or keep the required value and add a status"}
}

#[cfg(test)]
mod tests {
    use super::*;
    fn schema(source:&str)->Schema {
        let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b.schema
    }
    #[test]
    fn warns_before_any_future_rows_exist_but_compatible_additions_are_quiet() {
        let base="table items:\n  required: int 0..10\n  state: enum('old')\n  public\n";
        let old=schema(base);
        for (candidate,subject) in [
            (base.replace("  required: int 0..10\n",""),"items.required"),
            (base.replace("int 0..10","int 0..20"),"items.required"),
            (base.replace("enum('old')","enum('old','new')"),"items.state"),
            (base.replace("int 0..10","int 0..10 ?"),"items.required"),
        ] {
            let warnings=risks(&schema(&candidate),&old,1,Path::new("deployment"));
            assert!(warnings.iter().any(|w|w.contains(subject)&&w.contains("--to 1 --check --bridge")),"{warnings:?}");
        }
        assert!(risks(&schema(&base.replace("  public","  label: text <=20 ?\n  public")),&old,1,Path::new("deployment")).is_empty());
        let unique=schema(&base.replace("  public","  unique state\n  public"));
        assert!(risks(&old,&unique,1,Path::new("deployment")).iter().any(|w|w.contains("duplicate keys")));
    }
    #[test]
    fn warns_about_newer_only_tables_and_empty_legacy_cells_before_any_writes() {
        let old=schema("table items:\n  reason: text <=40 ?\n  public\n");
        let next=schema("table items:\n  public\ntable explanations:\n  text: text <=40\n  public\n");
        let warnings=risks(&next,&old,1,Path::new("deployment"));
        assert!(warnings.iter().any(|w|w.contains("new table explanations") && w.contains("newer-only facts")),"{warnings:?}");
        assert!(warnings.iter().any(|w|w.contains("items.reason") && w.contains("show null") && w.contains("reverse projection")),"{warnings:?}");
    }
    #[test]
    fn declared_down_and_scalar_or_asset_renames_do_not_warn_about_absent_fields() {
        let old=schema("table items:\n  state: enum('old')\n  public\n");
        let new=schema("table items:\n  state: enum('old','new')\n  public\ndown items oldState(state: enum('old','new')): {state:'old'}\n");
        assert!(risks(&new,&old,1,Path::new("deployment")).is_empty());
        for kind in ["text <=40 ?","file <=1024 ?"] {
            let old=schema(&format!("table items:\n  title: {kind}\n  public\n"));
            let new=schema(&format!("table items:\n  name: {kind} renamed from title\n  public\n"));
            assert!(risks(&new,&old,1,Path::new("deployment")).is_empty(),"{kind}");
        }
    }

    #[test]
    fn table_rename_still_warns_about_a_loosened_required_old_field() {
        let old=schema("table orders:\n  n: int\n  public\n");
        let new=schema("table records renamed from orders:\n  n: int ?\n  public\n");
        let warnings=risks(&new,&old,1,Path::new("deployment"));
        assert!(warnings.iter().any(|w|w.contains("orders (current records).n")&&w.contains("hide rows")),"{warnings:?}");
        assert!(!warnings.iter().any(|w|w.contains("new table records")),"{warnings:?}");
    }

}

fn cross_table_suggestions(candidate:&Schema,old:&Schema,parent:&str,column:&str,kind:&snapback4_core::schema::ColumnType,default:Option<&ColumnDefault>)->String {
    let fallback=match default {Some(ColumnDefault::Literal(v))=>match v{snapback4_core::Value::Bool(v)=>v.to_string(),snapback4_core::Value::Int(v)=>v.to_string(),snapback4_core::Value::String(v)=>snapback4_lang::print::quote(v),_=>return String::new()},_ if kind.is_optional()=>"null".into(),_=>return String::new()};
    let mut proposals=Vec::new();
    for(child,table)in candidate.visible_tables().filter(|(name,_)|old.table(name).is_none()) {
        for(reference,ty)in &table.columns {
            if !matches!(ty.required(),snapback4_core::schema::ColumnType::Ref{table} if table==parent){continue}
            let values=table.columns.iter().filter(|(c,k)|!table.engine_field(c)&&c.as_str()!=reference.as_str()&&k.required()==kind.required()).collect::<Vec<_>>();
            let unique=table.indexes.values().any(|i|i.unique&&i.columns()==vec![reference.clone()]);
            if unique&&values.len()==1 {
                let value=values[0].0;
                proposals.push(format!("candidate cross-table down (confirm the replacement field's meaning): `down {parent} rollback{column}(id: id): {{{column}: {child}[{reference} = id].{value} ?? {fallback}}}`"));
            }else if kind.required()==&snapback4_core::schema::ColumnType::Bool {
                proposals.push(format!("if child existence exactly means {column}, candidate cross-table down: `down {parent} rollback{column}(id: id): {{{column}: exists {child} where .{reference} = id}}`"));
            }
        }
    }
    if proposals.is_empty(){String::new()}else{proposals.join("; ")+"; "}
}

#[cfg(test)]
mod timeline_ownership_tests {
    #[test]
    fn retirement_ignores_event_slots_but_still_checks_authored_source_fields() {
        let source=snapback4_lang::guide::quarry(include_str!("../../../snapback4-lang/src/guide/feeds.md")).into_iter().find(|text|text.contains("view following:")).unwrap();
        let retired=source.replace("view following: activity where .actor = viewer or exists follows[viewer, .actor]\n","").replace("return following last","return activity last");
        let schema=|text:String|{let bound=snapback4_lang::compile(&[("schema.q".into(),text)]);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);bound.schema};
        let old=schema(source.clone());let current=schema(retired);
        assert!(old.tables["posts"].columns.keys().any(|field|snapback4_core::schema::timeline::is_slot(field)));
        assert!(super::old_row_risks(&current,&old,1,std::path::Path::new("deployment")).is_empty());
        let authored=schema(source.replacen("  authorId: principal","  note: text <=40 ?\n  authorId: principal",1));
        let risks=super::old_row_risks(&current,&authored,1,std::path::Path::new("deployment"));
        assert!(risks.iter().any(|line|line.contains("posts.note")),"{risks:?}");
        assert!(risks.iter().all(|line|!line.contains("$timeline:")),"{risks:?}");
    }
}
