//! Exact before/after population facts from the private activation snapshot.
// @ref LLP 3000.000.000#19-dormant-visibility-and-migration-dorm — never mistake retained v2-only facts for deleted v1 records.
use snapback4_core::{Schema, Store, Value, schema::ColumnDefault};
use serde::Serialize;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Visibility {
    pub hidden_rows: u64,
    pub empty_cells: u64,
    pub newly_empty_cells: u64,
    pub retained_empty_cells: u64,
    pub newer_only_rows: u64,
    pub tables: Vec<Population>,
    pub cells: Vec<Cells>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Population {
    pub table: String,
    pub rows: u64,
    pub target_has_table: bool,
    pub target_table: Option<String>,
    pub causes: Vec<(String,u64)>,
    pub sample_ids: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Cells {
    pub table: String,
    pub column: String,
    pub rows: u64,
    pub value: Value,
    pub retained_empty_rows: u64,
    pub projection_supported: bool,
    pub sample_ids: Vec<String>,
}

pub(super) fn assess(store: &Store, current: Option<&Schema>, target: &Schema) -> Result<Visibility, String> {
    let mut result = Visibility::default();
    let Some(current) = current else { return Ok(result); };
    for (name, table) in current.visible_tables().filter(|(name, t)| t.ephemeral.is_none() && current.maintain_for(name).is_none()) {
        let (rows, sample_ids) = store.preview_hidden_population(name)?;
        let target_name=store.preview_target_table(name)?;
        if rows > 0 {
            let target_has_table = target.table(&target_name).is_some() && target.visible(&target_name);
            if target_has_table { result.hidden_rows += rows; } else { result.newer_only_rows += rows; }
            let causes=if target_has_table {store.preview_hidden_causes(name)?}else{Vec::new()};
            result.tables.push(Population { table:name.clone(), rows, target_has_table, target_table:target_has_table.then(||target_name.clone()), causes, sample_ids });
        }
        let Some(next) = target.table(&target_name).filter(|_|target.visible(&target_name) && target.maintain_for(&target_name).is_none()) else { continue; };
        for (column, kind) in &next.columns {
            if next.engine_field(column) || next.maintained.contains_key(column) { continue; }
            let value = if kind.is_optional() { Value::Null }
                else if let Some(ColumnDefault::Literal(value)) = next.defaults.get(column) { value.clone() }
                else { continue; };
            // A restored old column with no saved cell is meaningful even though
            // it was absent from the newer schema (the wave-19 reason-text case).
            // We report what it shows, not an inferred lost business value.
            let path = format!("$.Row.{}", serde_json::to_string(column).map_err(|e|e.to_string())?);
            let encoded = serde_json::to_string(&value).map_err(|e|e.to_string())?;
            let mut prior_column=store.preview_source_column(name,column,table)?;
            if !table.columns.contains_key(&prior_column) {if let Some(rename)=current.downfills.iter().find(|f|f.table==*name && f.outputs.contains(column) && f.name.starts_with("$rename:down:")){if let Some(c)=rename.inputs.keys().next(){prior_column=c.clone();}}}
            let prior_path=format!("$.Row.{}",serde_json::to_string(&prior_column).map_err(|e|e.to_string())?);
            let prior = if table.columns.contains_key(&prior_column) {
                // Materialize only the old interpretation of physically absent
                // fields, without loading an unbounded historical row in Rust.
                let old = if table.columns[&prior_column].is_optional() { Value::Null }
                    else if let Some(ColumnDefault::Literal(value)) = table.defaults.get(&prior_column) { value.clone() }
                    else { Value::Null };
                serde_json::to_string(&old).map_err(|e|e.to_string())?
            } else { encoded.clone() };
            let prior_missing = !table.columns.contains_key(&prior_column);
            let (rows, sample_ids, retained_empty_rows) = store.preview_empty_population(name, column, &path, &encoded, prior_missing, &prior, &prior_path)?;
            if rows == 0 { continue; }
            result.empty_cells += rows;
            result.retained_empty_cells += retained_empty_rows;
            result.newly_empty_cells += rows-retained_empty_rows;
            result.cells.push(Cells {table:target_name.clone(), column:column.clone(), rows, value:value.clone(), retained_empty_rows, projection_supported:computed_projection(kind), sample_ids});
        }
    }
    Ok(result)
}

fn computed_projection(kind:&snapback4_core::schema::ColumnType)->bool {
    use snapback4_core::schema::ColumnType::*;
    match kind {Optional(inner)=>computed_projection(inner),Image{..}|Video{..}|File{..}|List{..}|ListRange{..}|Ref{..}=>false,_=>true}
}

impl Visibility {
    pub(super) fn lines(&self, current: u64, target: u64) -> Vec<String> {
        let mut lines = vec![format!("rollback to release {target}: {} records visible under release {current} will be hidden from release {target} users", self.hidden_rows)];
        for table in self.tables.iter().filter(|t|t.target_has_table) {
            lines.push(format!("  {}: {} rows hidden from a table release {target} has",if table.target_table.as_ref().is_some_and(|name|name!=&table.table){format!("{} → {}",table.table,table.target_table.as_ref().unwrap())}else{table.table.clone()},table.rows));
            for (cause,count) in &table.causes {lines.push(format!("    {count} rows: {cause}"));}
        }
        for cell in &self.cells {
            let value = if cell.value==Value::Null {"empty (null)".into()} else {format!("the old default {}",snapback4_core::wire::to_json(&cell.value))};
            let mut causes=Vec::new();
            // @ref LLP 3000.000.000.002#8-wave-21-release-evolution — retained empty images alone do not prove their origin; owned predecessor preimages outrank down.
            if cell.retained_empty_rows>0 {causes.push(format!("cells matching retained empty/default images: {}; if a predecessor preimage wins, down cannot overwrite it; keep intended values or review an explicit bridge repair",cell.retained_empty_rows));}
            let other=cell.rows-cell.retained_empty_rows;
            if other>0 {
                let remedy=if cell.projection_supported {"keep intended values; review the current projection or declare a truthful scalar down where no predecessor preimage wins, otherwise use a bridge"} else {"computed down cannot supply files, images, collections or references; generate a loosened bridge to represent absence"};
                causes.push(format!("other empty/default cells: {other}; {remedy}"));
            }
            lines.push(format!("  {}.{}: {} surviving records show {value}; {}",cell.table,cell.column,cell.rows,causes.join("; ")));
        }
        lines.push(format!("  {} cells are empty/defaulted; {} rows belong to tables absent from release {target} (newer-only facts)", self.empty_cells, self.newer_only_rows));
        for table in self.tables.iter().filter(|t|!t.target_has_table) {lines.push(format!("  newer-only {}: {} rows retained dormant because release {target} has no table {}; same-table down cannot create a table; preserve it in a bridge or declare a table rename",table.table,table.rows,table.table));}
        lines.push("  counts are schema populations before read rules, not per-user query results; empty/default values alone do not prove lost data; nothing dormant is deleted by this switch; compatible forward restores retained images".into());
        lines
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapback4_core::{Engine, engine::release::ReleaseActivation, wire};
    fn bound(source:&str)->snapback4_lang::Bound {
        let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b
    }
    #[test]
    fn distinguishes_old_table_losses_empty_old_cells_and_newer_only_facts() {
        let old=bound("table items:\n  n: int 1..10\n  reason: text <=40 ?\n  public\n");
        let new=bound("table items:\n  n: int 0..10\n  public\ntable labels:\n  text: text <=40\n  public\n");
        let current=new.schema.clone();
        let mut e=Engine::new_release(Store::memory().unwrap(),new.schema,new.programs.into_iter().map(|p|p.program),2,None).unwrap();
        for (name,json) in [("items",serde_json::json!({"id":"hidden","n":0})),("items",serde_json::json!({"id":"visible","n":3})),("labels",serde_json::json!({"id":"label","text":"new fact"}))] {
            let row=wire::row_from_json(&current.tables[name],&json).unwrap();e.seed([(name.into(),row)]).unwrap();
        }
        super::super::release_safeguards::capture(e.store()).unwrap();
        e.adopt_release(old.schema.clone(),old.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(1,Some(2)),false).unwrap();
        let v=assess(e.store(),Some(&current),&old.schema).unwrap();
        assert_eq!((v.hidden_rows,v.empty_cells,v.newer_only_rows),(1,1,1));
        assert_eq!(v.cells[0].sample_ids,["visible"]);
        let lines=v.lines(2,1).join("\n");
        assert!(lines.starts_with("rollback to release 1: 1 records visible under release 2 will be hidden"),"{lines}");
        assert!(lines.contains("items.reason: 1 surviving records show empty (null)"),"{lines}");
        assert!(lines.contains("newer-only labels: 1 rows retained dormant"),"{lines}");
        assert!(!lines.contains("created under"),"legacy stores do not record row birth release");
    }
    #[test]
    fn restored_old_values_are_not_reported_as_empty_and_old_intentional_nulls_are_quiet() {
        let source="table items:\n  reason: text <=40 ?\n  public\n";
        let old=bound(source);let new=bound(&source.replace("  reason: text <=40 ?\n",""));
        let current=new.schema.clone();
        let mut e=Engine::new_release(Store::memory().unwrap(),old.schema.clone(),[],1,None).unwrap();
        for (id,reason) in [("kept",serde_json::json!("original")),("empty",serde_json::Value::Null)] {
            let row=wire::row_from_json(&old.schema.tables["items"],&serde_json::json!({"id":id,"reason":reason})).unwrap();e.seed([("items".into(),row)]).unwrap();
        }
        e.adopt_release(new.schema,[],&ReleaseActivation::new(2,Some(1)),false).unwrap();
        let row=wire::row_from_json(&current.tables["items"],&serde_json::json!({"id":"new"})).unwrap();e.seed([("items".into(),row)]).unwrap();
        super::super::release_safeguards::capture(e.store()).unwrap();
        e.adopt_release(old.schema.clone(),[],&ReleaseActivation::new(1,Some(2)),false).unwrap();
        let v=assess(e.store(),Some(&current),&old.schema).unwrap();
        // Legacy stores cannot distinguish intentionally null preimages from
        // nulls materialized by an earlier rollback. Report the visible fact,
        // separating retained empty cells without calling them lost text.
        assert_eq!(v.empty_cells,2);
        assert_eq!((v.newly_empty_cells,v.retained_empty_cells),(1,1));
        let lines=v.lines(2,1).join("\n");
        assert!(lines.contains("cells matching retained empty/default images: 1; if a predecessor preimage wins, down cannot overwrite it"),"{lines}");
        assert!(lines.contains("other empty/default cells: 1; keep intended values"),"{lines}");
        assert!(lines.contains("where no predecessor preimage wins"),"{lines}");
        assert_eq!(v.cells[0].sample_ids,["empty","new"]);
        super::super::release_safeguards::capture(e.store()).unwrap();
        assert_eq!(assess(e.store(),Some(&old.schema),&old.schema).unwrap().empty_cells,0);
    }
    #[test]
    fn renamed_table_losses_belong_to_the_target_identity_not_a_new_table() {
        let old=bound("table items:\n  n: int\n  public\n  online only\n");
        let new=bound("table records renamed from items:\n  n: int ?\n  public\n  online only\n");
        let current=new.schema.clone();let mut e=Engine::new_release(Store::memory().unwrap(),new.schema,[],2,None).unwrap();
        let row=wire::row_from_json(&current.tables["records"],&serde_json::json!({"id":"hidden","n":null})).unwrap();e.seed([("records".into(),row)]).unwrap();
        assert_eq!(e.store().release_table_mapping(&current,&old.schema).unwrap().get("records").map(String::as_str),Some("items"));
        super::super::release_safeguards::capture(e.store()).unwrap();e.adopt_release(old.schema.clone(),[],&ReleaseActivation::new(1,Some(2)),false).unwrap();
        let v=assess(e.store(),Some(&current),&old.schema).unwrap();assert_eq!((v.hidden_rows,v.newer_only_rows),(1,0));
        assert_eq!(v.tables[0].target_table.as_deref(),Some("items"));assert!(v.lines(2,1).join("\n").contains("records → items"));
    }

}
