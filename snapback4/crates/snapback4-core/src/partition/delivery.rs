//! Bounded server-only materialization for stream join acquisitions.
use super::{PartitionRows, group_rows_from};
use crate::{Value, error::{MeterKind, RuntimeError}, meter::Ceilings, schema::{Schema, Sync, Table}, store::LogEvent};

const BATCH_ROWS: usize = 64;
const ROW_CEILING: u64 = 8_192;
const WIRE_CEILING: u64 = 16 << 20;
const SITE: &str = "sync join acquisition";

pub(super) struct Budget {
    rows: u64,
    heap: u64,
    wire: u64,
}

impl Budget {
    pub(super) fn new() -> Self { Self { rows: 0, heap: 0, wire: 0 } }

    fn refusal(kind: MeterKind, actual: u64, ceiling: u64) -> RuntimeError {
        RuntimeError::Bound { kind, actual, ceiling, site: SITE.into() }
    }

    fn scratch_chunk(&self, table: &Table, rows: usize) -> Result<usize, RuntimeError> {
        let rows = rows.min(BATCH_ROWS);
        if rows == 0 { return Err(Self::refusal(MeterKind::Examined, self.rows.saturating_add(1), ROW_CEILING)); }
        let ceiling = Ceilings::default().heap_bytes;
        let decode = crate::rows::disclosed::decode_reservation(table).max(1);
        let available = ceiling.saturating_sub(self.heap);
        // group_rows_from reads one extra live row to decide exhaustion.
        let admitted = (available / decode).saturating_sub(1).min(rows as u64) as usize;
        if admitted == 0 {
            return Err(Self::refusal(MeterKind::HeapBytes,
                self.heap.saturating_add(decode.saturating_mul(2)), ceiling));
        }
        Ok(admitted)
    }

    fn acquisition_chunk(&self, table: &Table) -> Result<usize, RuntimeError> {
        // @ref LLP 3000.036.003#5 — admit bounded decode scratch before
        // materializing any private join row, then retain only actual bytes.
        self.scratch_chunk(table, ROW_CEILING.saturating_sub(self.rows) as usize)
    }

    pub(super) fn push(&mut self, out: &mut Vec<LogEvent>, event: LogEvent, key_bytes: usize) -> Result<(), RuntimeError> {
        let data_heap = event.data.as_ref().map_or(0, Value::retained_heap_bytes);
        let retained = (std::mem::size_of::<LogEvent>() as u64)
            .saturating_add(event.table.capacity() as u64)
            .saturating_add(event.kind.capacity() as u64)
            .saturating_add(event.id.capacity() as u64)
            .saturating_add(key_bytes as u64)
            .saturating_add(data_heap);
        let data_wire = event.data.as_ref().map(crate::json_codec::value_bytes).transpose()
            .map_err(|error| RuntimeError::Store(error.to_string()))?.unwrap_or(0);
        // Tagged Value JSON is conservative for the plain wire image. Six
        // bytes per metadata byte covers JSON control escaping and framing.
        let wire = data_wire.saturating_add(96).saturating_add(
            6_u64.saturating_mul((event.table.len() + event.kind.len() + event.id.len()) as u64));
        let rows = self.rows.saturating_add(1);
        let heap = self.heap.saturating_add(retained);
        let wire_total = self.wire.saturating_add(wire);
        if rows > ROW_CEILING { return Err(Self::refusal(MeterKind::Examined, rows, ROW_CEILING)); }
        if heap > Ceilings::default().heap_bytes {
            return Err(Self::refusal(MeterKind::HeapBytes, heap, Ceilings::default().heap_bytes));
        }
        if wire_total > WIRE_CEILING { return Err(Self::refusal(MeterKind::OutputBytes, wire_total, WIRE_CEILING)); }
        self.rows = rows;
        self.heap = heap;
        self.wire = wire_total;
        out.push(event);
        Ok(())
    }
}

fn after(group: &[Value], key: Option<&Vec<u8>>, scanned: Option<Vec<Value>>, exhausted: bool) -> Result<Option<Vec<Value>>, RuntimeError> {
    if scanned.is_some() { return Ok(scanned); }
    let decoded = key.and_then(|key| crate::key::decode(key))
        .map(|values| values.into_iter().skip(group.len()).collect());
    if !exhausted && decoded.is_none() { return Err(RuntimeError::Store("join acquisition made no continuation progress".into())); }
    Ok(decoded)
}

pub(super) fn expand_group(tx: &dyn PartitionRows, schema: &Schema, principal: &str,
    source: &LogEvent, table: &Table, sync: &Sync, group: &[Value], now: i64,
    budget: &mut Budget, out: &mut Vec<LogEvent>,
) -> Result<(usize, Option<Vec<u8>>), RuntimeError> {
    let mut position = None;
    let mut taken = 0;
    let mut last_key = None;
    loop {
        let room = budget.acquisition_chunk(table)?;
        let (rows, exhausted, scanned, _) = group_rows_from(tx, &source.table, table, sync,
            group, position.as_deref(), taken, room, now, Some((schema, principal)))?;
        let batch_last = rows.last().map(|(_, key)| key.clone());
        let delivered = rows.len();
        for (row, key) in rows {
            let id = row.field("id")?.as_str()?.to_owned();
            let image = LogEvent { seq: source.seq, ord: source.ord, table: source.table.clone(),
                kind: "put".into(), id, data: Some(row) };
            budget.push(out, image, key.len())?;
        }
        taken += delivered;
        if let Some(key) = batch_last { last_key = Some(key); }
        if exhausted { return Ok((taken, last_key)); }
        position = after(group, last_key.as_ref(), scanned, false)?;
    }
}

pub(super) fn group_contains(tx: &dyn PartitionRows, schema: &Schema, principal: &str,
    table_name: &str, table: &Table, sync: &Sync, group: &[Value], id: &Value, now: i64,
    budget: &Budget,
) -> Result<bool, RuntimeError> {
    let mut position = None;
    let mut taken = 0;
    let mut walked = 0;
    loop {
        let room = budget.scratch_chunk(table, (ROW_CEILING as usize).saturating_sub(walked))?;
        let (rows, exhausted, scanned, work) = group_rows_from(tx, table_name, table, sync,
            group, position.as_deref(), taken, room, now, Some((schema, principal)))?;
        let batch_last = rows.last().map(|(_, key)| key.clone());
        taken += rows.len();
        walked = walked.saturating_add(work.max(rows.len()));
        if rows.iter().any(|(row, _)| row.field("id").is_ok_and(|row_id| row_id == id)) { return Ok(true); }
        if exhausted { return Ok(false); }
        position = after(group, batch_last.as_ref(), scanned, false)?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_reservation_is_bounded_before_decode() {
        let small = crate::schema::public_table(
            [("payload".into(), crate::schema::ColumnType::Text { max: 64 })].into(),
            Default::default(),
        );
        assert_eq!(Budget::new().acquisition_chunk(&small).unwrap(), BATCH_ROWS);

        let oversized = crate::schema::public_table(
            [("payload".into(), crate::schema::ColumnType::Text { max: u32::MAX })].into(),
            Default::default(),
        );
        assert!(matches!(Budget::new().acquisition_chunk(&oversized),
            Err(RuntimeError::Bound { kind: MeterKind::HeapBytes, .. })));
    }

    #[test]
    fn delivery_budget_refuses_before_retaining_event_8193() {
        let mut budget = Budget::new();
        let mut out = Vec::new();
        for n in 0..ROW_CEILING {
            budget.push(&mut out, LogEvent { seq: 1, ord: n as u32, table: "t".into(),
                kind: "del".into(), id: "x".into(), data: None }, 0).unwrap();
        }
        let error = budget.push(&mut out, LogEvent { seq: 1, ord: u32::MAX, table: "t".into(),
            kind: "del".into(), id: "x".into(), data: None }, 0).unwrap_err();
        assert!(matches!(error, RuntimeError::Bound { kind: MeterKind::Examined, actual: 8193, ceiling: 8192, .. }));
        assert_eq!(out.len(), 8192);
    }
}
