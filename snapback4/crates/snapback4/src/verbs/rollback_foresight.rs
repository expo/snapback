//! @ref LLP 3000.000.000#16-release-reactivation-and-rollback-foresight-rel5 — future-write risks are distinct from snapshot validation.
use snapback4_core::{Schema, successor::{self, Change}, schema::ColumnDefault};
use std::path::Path;

pub(super) fn risks(candidate: &Schema, old: &Schema, release: u64, dir: &Path) -> Vec<String> {
    let mut risks:Vec<_>=successor::classify(candidate,old).into_iter().filter_map(|step| {
        let path=step.path.strip_prefix("tables.")?;
        let (table,column)=path.split_once(".columns.")?;
        let target=old.tables.get(table)?;
        if target.engine_field(column) || old.maintain_for(table).is_some() || target.maintained.contains_key(column) {return None;}
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
        if old.table(name).is_none() && !candidate.table_renames.get(name).is_some_and(|source|old.table(source).is_some()) {
            risks.push(format!("rollback foresight: rows written to new table {name} will be hidden while release {release} is live; release {release} has no such table, so these are newer-only facts, not lost old-table records; a same-table `down` cannot create this missing table; keep it in a loosened bridge or declare a table rename; run `snapback4 rollback {} --to {release} --check --bridge <new-dir>` after writes",dir.display()));
        }
    }
    for (name,target) in old.visible_tables().filter(|(_,t)|t.ephemeral.is_none()) {
        let Some(from)=candidate.tables.get(name) else {continue;};
        if old.maintain_for(name).is_some() {continue;}
        for (column,kind) in &target.columns {
            if projected(candidate,name,column,kind) || from.columns.contains_key(column) || target.engine_field(column) || target.maintained.contains_key(column) {continue;}
            let interpretation=if kind.is_optional() {"null".to_owned()} else if let Some(ColumnDefault::Literal(value))=target.defaults.get(column) {format!("the old default {}",snapback4_core::wire::to_json(value))} else {continue;};
            risks.push(format!("rollback foresight: release {release}, {name}.{column}: without a fitting reverse projection, records created while this field is absent have no retained old cell and will show {interpretation} to release {release} users; declare a reverse projection from the replacement value, or retain the field in a bridge release; run `snapback4 rollback {} --to {release} --check --bridge <new-dir>` after writes",dir.display()));
        }
        for (index,definition) in &target.indexes {
            if definition.unique && from.indexes.get(index)!=Some(definition) {
                risks.push(format!("rollback foresight: release {release}, unique index {name}.{index}: future writes may introduce duplicate keys and refuse restoration; keep the old uniqueness in a bridge; run `snapback4 rollback {} --to {release} --check --bridge <new-dir>` after writes",dir.display()));
            }
        }
        if target.constraints.iter().any(|c|!from.constraints.contains(c) && matches!(c,snapback4_core::schema::Constraint::Text{..}|snapback4_core::schema::Constraint::Cap{..}|snapback4_core::schema::Constraint::FinalExistsOnInsert{..})) {
            risks.push(format!("rollback foresight: release {release}, table {name}: changed constraints may let future writes refuse rollback; preserve old bounds/quotas in a bridge; run `snapback4 rollback {} --to {release} --check --bridge <new-dir>` after writes",dir.display()));
        }
    }
    risks
}

fn projected(candidate:&Schema,table:&str,column:&str,kind:&snapback4_core::schema::ColumnType)->bool {
    (scalar(kind) && candidate.downfills.iter().any(|f|f.table==table && f.outputs.contains(column))) || candidate.asset_renames.get(table).is_some_and(|map|map.iter().any(|(new,old)|old==column && candidate.tables.get(table).and_then(|t|t.columns.get(new))==Some(kind)))
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

}
