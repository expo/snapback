//! Instrument store reads, not the engine's algorithm, for the 1000-lane witness.
use snapback4_device::store::{DeviceStore, DeviceTx};
use snapback4_device::memory::{MemoryStore, MemoryTx};
use snapback4_core::{error::RuntimeError, rows::{Rows, Bounds, Dir}, schema::{Schema, Table, Index}, value::Value};
use std::{cell::Cell, collections::BTreeMap, rc::Rc};
#[derive(Default)]
pub struct Counts { pub legacy: Cell<usize>, pub boundary_loads: Cell<usize>, pub lanes: Cell<usize> }
pub struct Counted { pub store: MemoryStore, pub counts: Rc<Counts> }
pub struct CountedTx<'a> { tx: MemoryTx<'a>, counts: Rc<Counts> }
impl DeviceStore for Counted {
    type Tx<'a> = CountedTx<'a>;
    fn install(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool) -> Result<(), RuntimeError> { self.store.install(schema, metadata, reset) }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> { self.store.meta(key) }
    fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> { self.store.set_meta(key, value) }
    fn transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError> { Ok(CountedTx { tx: self.store.transaction()?, counts: self.counts.clone() }) }
}
impl Rows for CountedTx<'_> {
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> { self.tx.get(table, id) }
    fn lookup(&self, table: &str, index_name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> { self.tx.lookup(table, index_name, index, key) }
    fn scan(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { if index_name == "byTime" { self.counts.lanes.set(self.counts.lanes.get() + 1); } self.tx.scan(table, index_name, prefix, bounds, dir, limit) }
    fn scan_metered(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize, scope: &snapback4_core::engine::Authorization, meter: &mut snapback4_core::engine::InternalMeter<'_>) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { if index_name == "byTime" { self.counts.lanes.set(self.counts.lanes.get() + 1); } self.tx.scan_metered(table, index_name, prefix, bounds, dir, limit, scope, meter) }
    fn count_prefix(&self, table: &str, index_name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> { self.tx.count_prefix(table, index_name, prefix, limit) }
    fn put(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> { self.tx.put(table_name, table, row, old) }
    fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> { self.tx.delete(table_name, table, old) }
}
impl DeviceTx for CountedTx<'_> {
    fn commit(self) -> Result<(), RuntimeError> { self.tx.commit() }
    fn rollback(self) -> Result<(), RuntimeError> { self.tx.rollback() }
    fn savepoint(&self, name: &str) -> Result<(), RuntimeError> { self.tx.savepoint(name) }
    fn release(&self, name: &str) -> Result<(), RuntimeError> { self.tx.release(name) }
    fn rollback_to(&self, name: &str) -> Result<(), RuntimeError> { self.tx.rollback_to(name) }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> { if key == "device:acquisition-boundaries" { self.counts.legacy.set(self.counts.legacy.get() + 1); } self.tx.meta(key) }
    fn set_meta(&self, key: &str, value: &str) -> Result<(), RuntimeError> { self.tx.set_meta(key, value) }
    fn meta_prefix(&self, prefix: &str) -> Result<Vec<(String, String)>, RuntimeError> { if prefix == "device:acquisition-boundaries:" { self.counts.boundary_loads.set(self.counts.boundary_loads.get() + 1); } self.tx.meta_prefix(prefix) }
    fn delete_meta(&self, keys: &[&str]) -> Result<(), RuntimeError> { self.tx.delete_meta(keys) }
    fn clear_rows(&self) -> Result<(), RuntimeError> { self.tx.clear_rows() }
    fn outbox_insert(&self, seq: u64, id: &str, entry: &str) -> Result<(), RuntimeError> { self.tx.outbox_insert(seq, id, entry) }
    fn outbox_upsert(&self, seq: u64, id: &str, entry: &str) -> Result<(), RuntimeError> { self.tx.outbox_upsert(seq, id, entry) }
    fn outbox_delete(&self, id: &str) -> Result<(), RuntimeError> { self.tx.outbox_delete(id) }
    fn outbox_get(&self, id: &str) -> Result<Option<String>, RuntimeError> { self.tx.outbox_get(id) }
    fn outbox_entries(&self) -> Result<Vec<String>, RuntimeError> { self.tx.outbox_entries() }
    fn outbox_max_seq(&self) -> Result<u64, RuntimeError> { self.tx.outbox_max_seq() }
    fn base_remember(&self, table: &str, id: &str, image: Option<&str>) -> Result<(), RuntimeError> { self.tx.base_remember(table, id, image) }
    fn base_entries(&self) -> Result<Vec<(String, String, Option<String>)>, RuntimeError> { self.tx.base_entries() }
    fn base_has_table(&self, table: &str) -> Result<bool, RuntimeError> { self.tx.base_has_table(table) }
    fn base_id_after(&self, table: &str, after: &str) -> Result<Option<String>, RuntimeError> { self.tx.base_id_after(table, after) }
    fn base_clear(&self) -> Result<(), RuntimeError> { self.tx.base_clear() }
    fn staged_put(&self, key: &str, table: &str, image: &str) -> Result<(), RuntimeError> { self.tx.staged_put(key, table, image) }
    fn staged_delete(&self, key: &str) -> Result<(), RuntimeError> { self.tx.staged_delete(key) }
    fn staged_after(&self, after: &str, limit: usize) -> Result<Vec<(String, String, String)>, RuntimeError> { self.tx.staged_after(after, limit) }
    fn staged_table_after(&self, table: &str, after: &str, limit: usize) -> Result<Vec<(String, String)>, RuntimeError> { self.tx.staged_table_after(table, after, limit) }
    fn staged_clear(&self) -> Result<(), RuntimeError> { self.tx.staged_clear() }
}

/// Instrument server acquisition separately from device boundary metadata.
pub struct Partition<'a> {
    pub tx: &'a dyn snapback4_core::partition::PartitionRows,
    pub content_gets: Cell<usize>,
    pub probes: Cell<usize>,
    pub selected_rows: Cell<usize>,
    pub content_scans: Cell<usize>,
}
impl<'a> Partition<'a> {
    pub fn new(tx: &'a dyn snapback4_core::partition::PartitionRows) -> Self {
        Self { tx, content_gets: Cell::new(0), probes: Cell::new(0), selected_rows: Cell::new(0), content_scans: Cell::new(0) }
    }
}
impl Rows for Partition<'_> {
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        if table == "posts" { self.content_gets.set(self.content_gets.get() + 1); }
        self.tx.get(table, id)
    }
    fn lookup(&self, table: &str, name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> {
        if table == "members" && name == "byGroupPerson" { self.probes.set(self.probes.get() + 1); }
        self.tx.lookup(table, name, index, key)
    }
    fn scan(&self, table: &str, name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        let rows = self.tx.scan(table, name, prefix, bounds, dir, limit)?;
        if table == "posts" { self.content_scans.set(self.content_scans.get() + 1); self.selected_rows.set(self.selected_rows.get() + rows.len()); }
        Ok(rows)
    }
    fn count_prefix(&self, table: &str, name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> { self.tx.count_prefix(table, name, prefix, limit) }
    fn put(&self, name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> { self.tx.put(name, table, row, old) }
    fn delete(&self, name: &str, table: &Table, row: &Value) -> Result<u64, RuntimeError> { self.tx.delete(name, table, row) }
}
impl snapback4_core::partition::PartitionRows for Partition<'_> {
    fn next_seq(&self) -> Result<u64, RuntimeError> { self.tx.next_seq() }
    fn append_log(&self, partition: &str, seq: u64, ord: u32, table: &str, kind: &str, id: &str, data: Option<&str>) -> Result<(), RuntimeError> { self.tx.append_log(partition, seq, ord, table, kind, id, data) }
    fn membership_transitions(&self, partition: &str, after: u64) -> Result<Vec<snapback4_core::store::LogEvent>, RuntimeError> { self.tx.membership_transitions(partition, after) }
    fn memberships_before(&self, partition: &str, watermark: u64) -> Result<Vec<snapback4_core::store::LogEvent>, RuntimeError> { self.tx.memberships_before(partition, watermark) }
    fn commit_times(&self, sequences: &[u64]) -> Result<BTreeMap<u64, i64>, RuntimeError> { self.tx.commit_times(sequences) }
    fn read_log_spans(&self, spans: &[snapback4_core::partition::LogSpan], after: u64, only_seq: Option<u64>, limit: usize) -> Result<Vec<snapback4_core::store::LogEvent>, RuntimeError> { self.tx.read_log_spans(spans, after, only_seq, limit) }
}
