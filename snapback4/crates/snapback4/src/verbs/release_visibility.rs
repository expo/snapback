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
    pub sample_ids: Vec<String>,
}

// The row id, table number and retained-row existence are facts from the same
// snapshot. Exclude actual expiry/deletion and private rebuilt caches.
const LOST: &str = "FROM main._release_preview_active p WHERE p.name=?1 AND NOT EXISTS(SELECT 1 FROM r WHERE r.t=p.t AND r.id=p.id) AND (EXISTS(SELECT 1 FROM _dormant_narrow_rows d WHERE d.t=p.t AND d.id=p.id) OR EXISTS(SELECT 1 FROM _dormant_rows d WHERE d.t=p.t AND d.id=p.id))";

pub(super) fn assess(store: &Store, current: Option<&Schema>, target: &Schema) -> Result<Visibility, String> {
    let mut result = Visibility::default();
    let Some(current) = current else { return Ok(result); };
    let conn = store.conn();
    for (name, table) in current.visible_tables().filter(|(name, t)| t.ephemeral.is_none() && current.maintain_for(name).is_none()) {
        let rows: u64 = conn.query_row(&format!("SELECT count(*) {LOST}"), [name], |r| r.get::<_,i64>(0).map(|n|n as u64)).map_err(|e|e.to_string())?;
        if rows > 0 {
            let target_has_table = target.table(name).is_some() && target.visible(name);
            let sample_ids = conn.prepare(&format!("SELECT p.id {LOST} ORDER BY p.id LIMIT 5")).map_err(|e|e.to_string())?
                .query_map([name], |r| r.get(0)).map_err(|e|e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e|e.to_string())?;
            if target_has_table { result.hidden_rows += rows; } else { result.newer_only_rows += rows; }
            result.tables.push(Population { table:name.clone(), rows, target_has_table, sample_ids });
        }
        let Some(next) = target.table(name).filter(|_|target.visible(name) && target.maintain_for(name).is_none()) else { continue; };
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
            let prior = if table.columns.contains_key(column) {
                // Materialize only the old interpretation of physically absent
                // fields, without loading an unbounded historical row in Rust.
                let old = if table.columns[column].is_optional() { Value::Null }
                    else if let Some(ColumnDefault::Literal(value)) = table.defaults.get(column) { value.clone() }
                    else { Value::Null };
                serde_json::to_string(&old).map_err(|e|e.to_string())?
            } else { encoded.clone() };
            let prior_missing = !table.columns.contains_key(column);
            let from = "FROM main._release_preview_active p JOIN r ON r.t=p.t AND r.id=p.id WHERE p.name=?1 AND (json_extract(r.data,?2)=json_extract(?3,'$') OR json_extract(r.data,?2) IS NULL) AND (?4 OR coalesce(json_extract(p.data,?2),json_extract(?5,'$'))!=json_extract(?3,'$'))";
            let args = rusqlite::params![name, path, encoded, prior_missing, prior];
            let rows: u64 = conn.query_row(&format!("SELECT count(*) {from}"), args, |r|r.get::<_,i64>(0).map(|n|n as u64)).map_err(|e|e.to_string())?;
            if rows == 0 { continue; }
            let sample_ids = conn.prepare(&format!("SELECT p.id {from} ORDER BY p.id LIMIT 5")).map_err(|e|e.to_string())?
                .query_map(args, |r|r.get(0)).map_err(|e|e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e|e.to_string())?;
            let retained_empty_rows = if prior_missing {
                conn.query_row(&format!("SELECT count(*) {from} AND EXISTS(SELECT 1 FROM main._release_preview_cells c WHERE c.t=p.t AND c.id=p.id AND c.column_name=?6 AND json_extract(c.data,'$')=json_extract(?3,'$'))"),rusqlite::params![name,path,encoded,prior_missing,prior,column],|r|r.get::<_,i64>(0).map(|n|n as u64)).map_err(|e|e.to_string())?
            } else {0};
            result.empty_cells += rows;
            result.retained_empty_cells += retained_empty_rows;
            result.newly_empty_cells += rows-retained_empty_rows;
            result.cells.push(Cells {table:name.clone(), column:column.clone(), rows, value:value.clone(), retained_empty_rows, sample_ids});
        }
    }
    Ok(result)
}

impl Visibility {
    pub(super) fn lines(&self, current: u64, target: u64) -> Vec<String> {
        let mut lines = vec![format!("rollback to release {target}: {} records visible under release {current} will be hidden from release {target} users", self.hidden_rows)];
        for table in self.tables.iter().filter(|t|t.target_has_table) {
            lines.push(format!("  {}: {} rows leave a table release {target} has; declare a reverse projection where the old type can represent them, or preserve the domain in a bridge release",table.table,table.rows));
        }
        for cell in &self.cells {
            let value = if cell.value==Value::Null {"empty (null)".into()} else {format!("the old default {}",snapback4_core::wire::to_json(&cell.value))};
            lines.push(format!("  {}.{}: {} surviving records show {value} ({} restored empty legacy cells); declare a reverse projection if these records have a truthful old representation, or use a bridge release",cell.table,cell.column,cell.rows,cell.retained_empty_rows));
        }
        lines.push(format!("  {} cells are empty/defaulted; {} rows belong to tables absent from release {target} (newer-only facts)", self.empty_cells, self.newer_only_rows));
        for table in self.tables.iter().filter(|t|!t.target_has_table) {lines.push(format!("  newer-only {}: {} rows retained dormant",table.table,table.rows));}
        lines.push("  counts are schema populations before read rules, not per-user query results; saved empty cells are not proof of lost text; nothing dormant is deleted by this switch; compatible forward restores retained images".into());
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
        assert_eq!(v.cells[0].sample_ids,["empty","new"]);
        super::super::release_safeguards::capture(e.store()).unwrap();
        assert_eq!(assess(e.store(),Some(&old.schema),&old.schema).unwrap().empty_cells,0);
    }
}
