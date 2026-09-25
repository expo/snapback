//! Internal contribution format adoption under the evaluation adapter's writer lock.
use super::{store::Store, WriteMode};
use crate::{error::{MeterKind, RuntimeError}, meter::{Ceilings, Cut, Meter}, rows::{adoption, word_heap as heap}, schema::{IndexComponent, Schema, Table}, value::{Value, canonical_json}};

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
                let work=adoption::Work::DECODE.with_contribution(maintain);
                let mut after: Option<String> = None;
                loop {
                    let mut meter=Meter::new(Ceilings::job(),Cut::Abort);
                    meter.at(&format!("adopt {name}.{index_name}"));
                    meter.heap(4096 + after.as_deref().map_or(0, heap::text))?;
                    let page=source_page(&tx,name,table,after.as_deref(),&mut meter,work)?;
                    if page.is_empty() { break; }
                    for raw in &page {
                        let scratch=meter.mark();
                        let id=raw.get::<_,&str>(0);
                        let data=raw.get::<_,&str>(1);
                        meter.charge(MeterKind::Examined,1)?;
                        meter.heap(adoption::decode_bytes(data))?;
                        let row: Value=super::store::decode(data)?;
                        meter.charge(MeterKind::Examined,1)?;
                        meter.step(maintain.evaluation_steps())?;
                        meter.heap(adoption::contribution_bytes(&row,table))?;
                        for key in crate::rows::stored_index_keys(table,index,&row,id) {
                            if key.len() > crate::rows::MAX_INDEX_KEY_BYTES { return Err(crate::rows::index_key_refusal(name,index_name,1)); }
                            meter.charge(MeterKind::IndexEntries,1)?;
                            tx.execute("INSERT INTO i(t,ix,k,id) VALUES ($1,$2,$3,$4)", &[name,index_name,&key,&id])?;
                        }
                        drop(row);
                        meter.release_heap(scratch);
                    }
                    let last=page.last().expect("nonempty page").get::<_,&str>(0);
                    meter.heap(heap::text(last))?;
                    after=Some(last.to_owned());
                    // The full driver-owned page remains reserved until every
                    // decoded row and its index scratch have been consumed.
                    drop(page);
                }
            }
        }
        generation=generation.checked_add(1).ok_or_else(||RuntimeError::Generation("generation overflow".into()))?;
        tx.execute("UPDATE _backend SET schema = $1, generation = $2 WHERE singleton", &[&canonical_json(schema), &generation])?;
    }
    tx.commit()?;
    u64::try_from(generation).map_err(|_|RuntimeError::Generation("negative generation".into()))
}

// @ref LLP 3000.007#20.9.3 — adoption reserves fetched images separately from per-row contribution scratch.
pub(super) fn source_page(tx: &super::store::Tx<'_>, table: &str, schema: &Table, after: Option<&str>, meter: &mut Meter, work: adoption::Work) -> Result<Vec<postgres::Row>, RuntimeError> {
    let sizes=if after.is_some() {
        "SELECT COALESCE(SUM(octet_length(id) + octet_length(data)),0)::bigint, COUNT(*) FROM (SELECT id,data FROM r WHERE t=$1 AND id>$2 ORDER BY id LIMIT $3) AS picked"
    } else {
        "SELECT COALESCE(SUM(octet_length(id) + octet_length(data)),0)::bigint, COUNT(*) FROM (SELECT id,data FROM r WHERE t=$1 AND $2::text IS NULL ORDER BY id LIMIT $3) AS picked"
    };
    let mut limit=32i64;
    let page_mark=meter.mark();
    loop {
        limit=work.limit(meter,limit as usize) as i64;
        let size=tx.query(sizes,&[&table,&after,&limit])?;
        let bytes=size[0].get::<_,i64>(0) as u64;
        let count=size[0].get::<_,i64>(1) as u64;
        // Network/read buffers, retained driver rows and their metadata. Typed
        // JSON decode is priced from borrowed text later, one row at a time;
        // the query scan's conservative 256x all-rows decoder is inappropriate
        // for this walk. This initial estimate is followed by a scratch check
        // before any adoption callback runs.
        let reservation=bytes.saturating_mul(8).saturating_add(count.saturating_mul(1024));
        if limit>1 && reservation>meter.ceilings.heap_bytes/2 { limit/=2; continue; }
        meter.heap(reservation)?;
        let query=if after.is_some() {
            "SELECT id,data FROM r WHERE t=$1 AND id>$2 ORDER BY id LIMIT $3"
        } else {
            "SELECT id,data FROM r WHERE t=$1 AND $2::text IS NULL ORDER BY id LIMIT $3"
        };
        let page=tx.query(query,&[&table,&after,&limit])?;
        if adoption::page_fits(page.iter().map(|raw| raw.get::<_,&str>(1)), meter, work,
            |row| adoption::contribution_bytes(row,schema))? { return Ok(page); }
        limit=(page.len() as i64/2).max(1);
        drop(page);
        meter.release_heap(page_mark.clone());
    }
}
