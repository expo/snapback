//! Operator snapshots preserve tagged values even when historical column types differ.
// @ref LLP 3000.037.000#9 — merge current and retained images once per id, never via the active SQL scalar type.
use super::{Inspection, Result, store_error};
use crate::{Value, schema::{Schema, materialize_optional_fields},inspection::{InspectionCatalog,internal}};
use std::collections::BTreeMap;
impl Inspection {
    pub fn merged_records(&self, name: &str) -> Result<Vec<Value>> {
        if internal(name) {return Err(("E_SQL_INTERNAL","data reads application tables only".into()));}
        let (_,encoded)=self.active_schema_record()?;
        let active:Schema=serde_json::from_str(&encoded).map_err(|e|("E_SCHEMA",e.to_string()))?;
        active.refuse_private(name).map_err(|e|("E_MAINTAINED_COLUMN_PRIVATE",e.to_string()))?;
        let schema=self.retained_schema(active.clone())?;
        schema.refuse_private(name).map_err(|e|("E_MAINTAINED_COLUMN_PRIVATE",e.to_string()))?;
        let definition=schema.table(name).ok_or_else(||("E_SCHEMA",format!("no table {name}")))?;
        if definition.ephemeral.is_some() {return Err(("E_SCHEMA",format!("data {name}: ephemeral rows live only in serving memory; no disk snapshot")));}
        let number:i64=self.conn.query_row("SELECT num FROM _catalog WHERE name=?1",[name],|row|row.get(0)).map_err(store_error)?;
        let mut merged=BTreeMap::<String,BTreeMap<String,Value>>::new();
        // Active images win, including explicit null; retained cells fill only absent names.
        let mut query=self.conn.prepare("SELECT id,data,0 AS rank FROM r WHERE t=?1 UNION ALL SELECT id,data,1 FROM _dormant_rows WHERE t=?1 UNION ALL SELECT id,data,2 FROM _dormant_narrow_rows WHERE t=?1 ORDER BY rank,id").map_err(store_error)?;
        let rows=query.query_map([number],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,i64>(2)?))).map_err(store_error)?;
        for row in rows {
            let (id,data,rank)=row.map_err(store_error)?;
            let mut value:Value=serde_json::from_str(&data).map_err(|e|("E_SCHEMA",e.to_string()))?;
            if rank==0 {if let Some(table)=active.table(name) {materialize_optional_fields(&mut value,table);}}
            let Value::Row(fields)=value else {return Err(("E_SCHEMA","inspection row has no row image".into()));};
            let target=merged.entry(id.clone()).or_default();
            target.entry("id".into()).or_insert(Value::Id(id));
            for (column,value) in fields.iter() {
                if definition.columns.contains_key(column) {target.entry(column.clone()).or_insert_with(||value.clone());}
            }
        }
        let mut query=self.conn.prepare("SELECT id,column_name,data FROM _dormant_values WHERE t=?1 ORDER BY id,column_name").map_err(store_error)?;
        let cells=query.query_map([number],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?))).map_err(store_error)?;
        for cell in cells {
            let (id,column,data)=cell.map_err(store_error)?;
            // Cell-only residue cannot create a row that no retained image owns.
            if let Some(target)=merged.get_mut(&id) {
                if definition.columns.contains_key(&column) {
                    let value:Value=serde_json::from_str(&data).map_err(|e|("E_SCHEMA",e.to_string()))?;
                    target.entry(column).or_insert(value);
                }
            }
        }
        Ok(merged.into_values().map(|fields|Value::Row(fields.into())).collect())
    }
}
