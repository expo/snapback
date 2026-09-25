//! Preflight activation pages before owning their serialized row images.
use super::*;
use crate::{error::MeterKind, meter::{Ceilings, Cut, Meter}, rows::word_heap as heap};

pub(super) fn walk(tx: &Tx<'_>, table: i64, mut visit: impl FnMut(&str, Value) -> Result<(), RuntimeError>) -> Result<(), RuntimeError> {
    walk_metered(tx, table, |id, row, _| visit(id, row))
}

// @ref LLP 3000.007#20.24.1 — reserve stored bytes before fetching or decoding; page scratch stays live until consumed.
pub(super) fn walk_metered(tx: &Tx<'_>, table: i64, mut visit: impl FnMut(&str, Value, &mut Meter) -> Result<(), RuntimeError>) -> Result<(), RuntimeError> {
    const PAGE: usize = 256;
    let mut after: Option<String> = None;
    loop {
        // One job meter per page, shared with contribution evaluation. Retain
        // the continuation's allowance across the page; reset only after all
        // its row images and callback scratch have been consumed and dropped.
        let mut meter = Meter::new(Ceilings::job(), Cut::Abort);
        meter.at("adopt stored rows");
        meter.heap(after.as_deref().map_or(0, heap::text))?;
        meter.once(crate::meter::HeapSite::SqliteColumns, 2 * tx.page_size)?;
        let page_mark = meter.mark();
        let sizes = if after.is_some() {
            "SELECT octet_length(id), octet_length(data) FROM r WHERE t = ?1 AND id > ?2 ORDER BY id LIMIT ?3"
        } else {
            "SELECT octet_length(id), octet_length(data) FROM r WHERE t = ?1 AND ?2 IS NULL ORDER BY id LIMIT ?3"
        };
        let (mut count, mut bytes) = (0, 0u64);
        {
            let mut statement = tx.tx.prepare_cached(sizes)?;
            let mut rows = statement.query(params![table, after, PAGE as i64])?;
            while let Some(row) = rows.next()? {
                let id_bytes = row.get::<_, i64>(0)? as usize;
                let data_bytes = row.get::<_, i64>(1)? as usize;
                // Rust-owned text, two native payload copies, allocation
                // headers and exact Vec slots. Length preflight borrows no
                // overflow payload (the same SQLite convention as scans).
                let next = bytes.saturating_add(3 * (heap::allocation(id_bytes) + heap::allocation(data_bytes)) + 64 + heap::slots::<(String, String)>(1));
                // Leave half the job heap for one decoded row and evaluation.
                // A single larger image must still pass the whole allowance;
                // it may refuse, but never starts an unreserved allocation.
                if count > 0 && next > meter.ceilings.heap_bytes / 2 { break; }
                meter.heap(next - bytes)?;
                bytes = next;
                count += 1;
            }
        }
        if count == 0 { return Ok(()); }
        let query = if after.is_some() {
            "SELECT id, data FROM r WHERE t = ?1 AND id > ?2 ORDER BY id LIMIT ?3"
        } else {
            "SELECT id, data FROM r WHERE t = ?1 AND ?2 IS NULL ORDER BY id LIMIT ?3"
        };
        let mut page = Vec::<(String, String)>::with_capacity(count);
        {
            let mut statement = tx.tx.prepare_cached(query)?;
            let mut rows = statement.query(params![table, after, count as i64])?;
            while let Some(row) = rows.next()? { page.push((row.get(0)?, row.get(1)?)); }
        }
        for (id, data) in &page {
            let row_mark = meter.mark();
            meter.charge(MeterKind::Examined, 1)?;
            // Decode plus copy-on-write projection, optional materialization
            // and validation scratch. Contribution keys reserve more through
            // this same meter, on top of the still-resident complete page.
            meter.heap(heap::stored_row(data).saturating_mul(4).saturating_add(4096))?;
            let row = serde_json::from_str(data).map_err(|e| RuntimeError::Store(e.to_string()))?;
            visit(id, row, &mut meter)?;
            meter.release_heap(row_mark);
        }
        // Move the last ID into the next page's continuation, without an
        // unpriced clone. Drop every other fetched byte before releasing.
        after = page.pop().map(|row| row.0);
        drop(page);
        meter.release_heap(page_mark);
    }
}
