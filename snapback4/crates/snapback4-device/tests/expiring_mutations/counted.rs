//! Storage instrumentation for the actual device, independent of logical meter receipts.
use snapback4_core::{error::RuntimeError, rows::{Rows, Bounds, Dir, AcquiredBoundary, PrefetchRequest}, schema::{Schema, Table, Index}, value::Value, assets::Asset};
use snapback4_device::store::{DeviceStore, DeviceTx};
use std::{cell::RefCell, collections::BTreeMap, rc::Rc};
pub type Visits = Rc<RefCell<BTreeMap<(String, String), usize>>>;
pub struct Counted<S> { pub inner: S, pub visits: Visits }
pub struct Tx<T> { inner: T, visits: Visits }
impl<S: DeviceStore> DeviceStore for Counted<S> {
    type Tx<'a> = Tx<S::Tx<'a>> where Self: 'a;
    fn install(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool) -> Result<(), RuntimeError> { self.inner.install(schema, metadata, reset) }
    fn install_checked(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool, expected: &BTreeMap<String, Option<String>>) -> Result<(), RuntimeError> { self.inner.install_checked(schema, metadata, reset, expected) }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> { self.inner.meta(key) }
    fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> { self.inner.set_meta(key, value) }
    fn transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError> { Ok(Tx { inner: self.inner.transaction()?, visits: self.visits.clone() }) }
    fn read_transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError> { Ok(Tx { inner: self.inner.read_transaction()?, visits: self.visits.clone() }) }
}
impl<T: DeviceTx> Rows for Tx<T> {
    fn provisional_sequence_floor(&self, _parent: &str, _id: &str) -> Result<i64, RuntimeError> { self.inner.provisional_sequence_floor(_parent, _id) }
    fn sequence_value(&self, _parent: &str, _id: &str) -> Result<i64, RuntimeError> { self.inner.sequence_value(_parent, _id) }
    fn set_sequence(&self, _parent: &str, _id: &str, _value: i64) -> Result<(), RuntimeError> { self.inner.set_sequence(_parent, _id, _value) }
    fn effect_once(&self, _effect: &str, _key: &str) -> Result<bool, RuntimeError> { self.inner.effect_once(_effect, _key) }
    fn provisional_row(&self, _table: &str, _row: &Value) -> Result<bool, RuntimeError> { self.inner.provisional_row(_table, _row) }
    fn recording_covered(&self, _table: &str, _row: &Value, _viewer: &str, _now: i64, _scope: &snapback4_core::engine::Authorization, _meter: &mut snapback4_core::engine::InternalMeter<'_>) -> Result<bool, RuntimeError> { self.inner.recording_covered(_table, _row, _viewer, _now, _scope, _meter) }
    fn current_row(&self, _table: &str, _row: &Value) -> Result<bool, RuntimeError> { self.inner.current_row(_table, _row) }
    fn current_group(&self, _table: &str, _index: &str, _prefix: &[Value]) -> Result<bool, RuntimeError> { self.inner.current_group(_table, _index, _prefix) }
    fn acquired_boundary(&self, _table: &str, _index: &str, _prefix: &[Value]) -> Result<Option<AcquiredBoundary>, RuntimeError> { self.inner.acquired_boundary(_table, _index, _prefix) }
    fn retained_row(&self, _table: &str, _row: &Value) -> Result<bool, RuntimeError> { self.inner.retained_row(_table, _row) }
    fn retained_group(&self, _table: &str, _index: &str, _prefix: &[Value]) -> Result<bool, RuntimeError> { self.inner.retained_group(_table, _index, _prefix) }
    fn prefetch(&self, _requests: &[PrefetchRequest]) { self.inner.prefetch(_requests) }
    fn prefetch_enabled(&self) -> bool { self.inner.prefetch_enabled() }
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> { *self.visits.borrow_mut().entry((table.into(), "get".into())).or_default() += 1; self.inner.get(table, id) }
    fn lookup(&self, table: &str, index_name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> { *self.visits.borrow_mut().entry((table.into(), "lookup".into())).or_default() += 1; self.inner.lookup(table, index_name, index, key) }
    fn scan(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { let rows = self.inner.scan(table, index_name, prefix, bounds, dir, limit)?; *self.visits.borrow_mut().entry((table.into(), index_name.into())).or_default() += 1; Ok(rows) }
    fn index_head(&self, _table: &str, _index: &str, _prefix: &[Value], _bounds: &Bounds, _dir: Dir) -> Result<Option<Vec<Value>>, RuntimeError> { self.inner.index_head(_table, _index, _prefix, _bounds, _dir) }
    fn scan_metered(&self, _table: &str, _index_name: &str, _prefix: &[Value], _bounds: &Bounds, _dir: Dir, _limit: usize, _scope: &snapback4_core::engine::Authorization, meter: &mut snapback4_core::engine::InternalMeter<'_>) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { let rows = self.inner.scan_metered(_table, _index_name, _prefix, _bounds, _dir, _limit, _scope, meter)?; *self.visits.borrow_mut().entry((_table.into(), _index_name.into())).or_default() += 1; Ok(rows) }
    fn count_prefix(&self, table: &str, index_name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> { *self.visits.borrow_mut().entry((table.into(), "count".into())).or_default() += 1; self.inner.count_prefix(table, index_name, prefix, limit) }
    fn cap_count(&self, _table: &str, _by: &[String], _group: &[Value]) -> Result<u64, RuntimeError> { self.inner.cap_count(_table, _by, _group) }
    fn put(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> { *self.visits.borrow_mut().entry((table_name.into(), "put".into())).or_default() += 1; self.inner.put(table_name, table, row, old) }
    fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> { *self.visits.borrow_mut().entry((table_name.into(), "delete".into())).or_default() += 1; self.inner.delete(table_name, table, old) }
    fn holds_assets(&self) -> bool { self.inner.holds_assets() }
    fn asset(&self, _id: &str) -> Result<Option<Asset>, RuntimeError> { self.inner.asset(_id) }
    fn claim_asset(&self, id: &str, _by: &str, _table: &str, _row_id: &str, _column: &str) -> Result<Asset, RuntimeError> { self.inner.claim_asset(id, _by, _table, _row_id, _column) }
    fn release_asset(&self, id: &str, table: &str, row_id: &str, column: &str, now: i64) -> Result<(), RuntimeError> { self.inner.release_asset(id, table, row_id, column, now) }
}
impl<T: DeviceTx> DeviceTx for Tx<T> {
    fn commit(self) -> Result<(), RuntimeError> { self.inner.commit() }
    fn rollback(self) -> Result<(), RuntimeError> { self.inner.rollback() }
    fn savepoint(&self, name: &str) -> Result<(), RuntimeError> { self.inner.savepoint(name) }
    fn release(&self, name: &str) -> Result<(), RuntimeError> { self.inner.release(name) }
    fn rollback_to(&self, name: &str) -> Result<(), RuntimeError> { self.inner.rollback_to(name) }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> { self.inner.meta(key) }
    fn set_meta(&self, key: &str, value: &str) -> Result<(), RuntimeError> { self.inner.set_meta(key, value) }
    fn meta_prefix(&self, prefix: &str) -> Result<Vec<(String, String)>, RuntimeError> { self.inner.meta_prefix(prefix) }
    fn delete_meta(&self, keys: &[&str]) -> Result<(), RuntimeError> { self.inner.delete_meta(keys) }
    fn clear_rows(&self) -> Result<(), RuntimeError> { self.inner.clear_rows() }
    fn outbox_insert(&self, seq: u64, id: &str, entry: &str) -> Result<(), RuntimeError> { self.inner.outbox_insert(seq, id, entry) }
    fn outbox_upsert(&self, seq: u64, id: &str, entry: &str) -> Result<(), RuntimeError> { self.inner.outbox_upsert(seq, id, entry) }
    fn outbox_delete(&self, id: &str) -> Result<(), RuntimeError> { self.inner.outbox_delete(id) }
    fn outbox_get(&self, id: &str) -> Result<Option<String>, RuntimeError> { self.inner.outbox_get(id) }
    fn outbox_entries(&self) -> Result<Vec<String>, RuntimeError> { self.inner.outbox_entries() }
    fn outbox_max_seq(&self) -> Result<u64, RuntimeError> { self.inner.outbox_max_seq() }
    fn base_remember(&self, table: &str, id: &str, image: Option<&str>) -> Result<(), RuntimeError> { self.inner.base_remember(table, id, image) }
    fn base_entries(&self) -> Result<Vec<(String, String, Option<String>)>, RuntimeError> { self.inner.base_entries() }
    fn base_has_table(&self, table: &str) -> Result<bool, RuntimeError> { self.inner.base_has_table(table) }
    fn base_id_after(&self, table: &str, after: &str) -> Result<Option<String>, RuntimeError> { self.inner.base_id_after(table, after) }
    fn base_clear(&self) -> Result<(), RuntimeError> { self.inner.base_clear() }
    fn staged_put(&self, key: &str, table: &str, image: &str) -> Result<(), RuntimeError> { self.inner.staged_put(key, table, image) }
    fn staged_delete(&self, key: &str) -> Result<(), RuntimeError> { self.inner.staged_delete(key) }
    fn staged_after(&self, after: &str, limit: usize) -> Result<Vec<(String, String, String)>, RuntimeError> { self.inner.staged_after(after, limit) }
    fn staged_table_after(&self, table: &str, after: &str, limit: usize) -> Result<Vec<(String, String)>, RuntimeError> { self.inner.staged_table_after(table, after, limit) }
    fn staged_clear(&self) -> Result<(), RuntimeError> { self.inner.staged_clear() }
}
