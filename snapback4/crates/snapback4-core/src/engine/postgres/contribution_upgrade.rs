//! Internal contribution format adoption under the evaluation adapter's writer lock.
use super::{store::Store, WriteMode};
use crate::{error::{MeterKind, RuntimeError}, meter::{Ceilings, Cut, Meter}, rows::{Bounds, Dir, Rows}, schema::{IndexComponent, Schema}, value::canonical_json};

pub(super) fn install(store: &mut Store, schema: &mut Schema) -> Result<u64, RuntimeError> {
    let tx = store.transaction(Some(WriteMode::Serialized))?;
    tx.batch("ALTER TABLE _backend ADD COLUMN IF NOT EXISTS generation BIGINT NOT NULL DEFAULT 1")?;
    let backend = tx.query("SELECT schema,generation FROM _backend WHERE singleton", &[])?;
    let previous: Schema = super::store::decode(backend[0].get(0))?;
    let mut generation = backend[0].get::<_, i64>(1);
    schema.prepare_contribution_indexes();
    if *schema != previous {
        for (name, table) in &schema.tables {
            for (index_name, index) in &table.indexes {
                let Some(IndexComponent::Contribution(maintain)) = index.components.first() else {continue};
                if previous.table(name).and_then(|t|t.index(index_name)) == Some(index) {continue;}
                tx.execute("DELETE FROM i WHERE t = $1 AND ix = $2", &[name,index_name])?;
                let mut bounds=Bounds::default();
                loop {
                    let mut meter=Meter::new(Ceilings::job(),Cut::Abort);
                    meter.at(&format!("adopt {name}.{index_name}"));
                    let page=tx.scan_metered(name,"byId",&[],&bounds,Dir::Asc,32,&mut meter)?;
                    let count=page.len();
                    for (row,key) in page {
                        meter.charge(MeterKind::Examined,1)?;
                        meter.step(maintain.evaluation_steps())?;
                        meter.heap(row.heap_bytes().saturating_mul(4).saturating_add(4096))?;
                        let id=row.field("id")?.as_str()?;
                        for key in crate::rows::stored_index_keys(table,index,&row,id) {
                            meter.charge(MeterKind::IndexEntries,1)?;
                            tx.execute("INSERT INTO i(t,ix,k,id) VALUES ($1,$2,$3,$4)", &[name,index_name,&key,&id])?;
                        }
                        bounds.after=crate::key::decode(&key);
                    }
                    if count<32 {break;}
                }
            }
        }
        generation=generation.checked_add(1).ok_or_else(||RuntimeError::Generation("generation overflow".into()))?;
        tx.execute("UPDATE _backend SET schema = $1, generation = $2 WHERE singleton", &[&canonical_json(schema), &generation])?;
    }
    tx.commit()?;
    u64::try_from(generation).map_err(|_|RuntimeError::Generation("negative generation".into()))
}
