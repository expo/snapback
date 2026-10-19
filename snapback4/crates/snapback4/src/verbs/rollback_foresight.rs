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
        let from=candidate.tables.get(table)?;
        let reason=match from.columns.get(column) {
            None if !before.is_optional() && !matches!(target.defaults.get(column),Some(ColumnDefault::Literal(_))) =>
                "new rows will lack the old required field, so rollback can refuse".to_owned(),
            Some(kind) if kind!=before && matches!(step.change,Change::Narrowing|Change::Destructive) =>
                format!("new writes allowed by {kind} may not fit {before}, so rollback can refuse or hide rows"),
            _ => return None,
        };
        Some(format!("rollback foresight: release {release}, {table}.{column}: {reason}; keep an expand/contract bridge with the old required fields and compatible domains; run `snapback4 rollback {} --to {release} --check --bridge <new-dir>` after writes",dir.display()))
    }).collect();
    for (name,target) in old.visible_tables().filter(|(_,t)|t.ephemeral.is_none()) {
        let Some(from)=candidate.tables.get(name) else {continue;};
        if old.maintain_for(name).is_some() {continue;}
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
}
