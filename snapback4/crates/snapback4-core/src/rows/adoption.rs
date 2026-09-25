//! Admission for a fetched adoption page, before any callback can write.
use crate::{error::{MeterKind, RuntimeError}, meter::Meter, schema::{ColumnDefault, Table}, value::Value};
use super::word_heap as heap;

pub(crate) fn decode_bytes(data: &str) -> u64 {
    // stored_row already includes decoder scratch; multiplying it again
    // rejects fitting rows even when they are the only image in the page.
    heap::stored_row(data).saturating_add(4096)
}

/// Bound the contribution allowance after optional/default materialization,
/// without allocating a second row just to decide whether it fits.
pub(crate) fn contribution_bytes(row: &Value, table: &Table) -> u64 {
    let mut bytes = row.heap_bytes();
    for (name, kind) in &table.columns {
        if row.field(name).is_ok() { continue; }
        let added = if table.maintained.contains_key(name) || kind.is_optional() { Some(0) }
            else if let Some(ColumnDefault::Literal(value)) = table.defaults.get(name) { Some(value.heap_bytes()) }
            else { None };
        if let Some(added) = added { bytes = bytes.saturating_add(80 + name.len() as u64).saturating_add(added); }
    }
    bytes.saturating_mul(4).saturating_add(4096)
}

// @ref LLP 3000.007#20.9.3 — shrink pages before adoption writes when retained images plus row work cannot fit.
pub(crate) fn page_fits<'a>(images: impl Iterator<Item = &'a str>, singleton: bool,
    meter: &mut Meter, scratch: impl Fn(&Value) -> u64) -> Result<bool, RuntimeError> {
    for data in images {
        let mark = meter.mark();
        let decode = decode_bytes(data);
        if !singleton && !meter.room(MeterKind::HeapBytes, decode) { return Ok(false); }
        meter.heap(decode)?;
        meter.charge(MeterKind::Examined, 1)?;
        let row: Value = crate::json_codec::from_text(data).map_err(|e| RuntimeError::Store(e.to_string()))?;
        let work = scratch(&row);
        let fits = meter.room(MeterKind::HeapBytes, work);
        // Only a singleton may refuse for heap. Larger pages can be dropped
        // and fetched again with a smaller limit, without replaying a write.
        if !fits && singleton { meter.heap(work)?; }
        drop(row);
        meter.release_heap(mark);
        if !fits { return Ok(false); }
    }
    Ok(true)
}
