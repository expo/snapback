//! The device's store on a native host: the core's own SQLite, the
//! server's two-table layout through the server's own code, with the
//! device's side tables — the outbox, the confirmed images, the staged
//! snapshot — beside it.

use crate::store::{DeviceStore, DeviceTx};
use snapback4_core::error::RuntimeError;
use snapback4_core::schema::Schema;
use snapback4_core::store::{Store, Tx};
use std::collections::BTreeMap;
use std::path::Path;

/// Open (or create) the device store; side tables join accepted installation.
pub fn open(path: &Path) -> Result<Store, RuntimeError> {
    Store::open_shared(path)
}

impl DeviceStore for Store {
    type Tx<'a> = Tx<'a>;
    fn install(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool) -> Result<(), RuntimeError> {
        self.install_checked(schema, metadata, reset, &BTreeMap::new())
    }
    fn install_checked(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool, expected: &BTreeMap<String, Option<String>>) -> Result<(), RuntimeError> {
        self.install_open(schema, metadata, reset, expected, |_| Ok(()))
    }
    fn install_open<R>(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool, expected: &BTreeMap<String, Option<String>>, finish: impl FnOnce(&Tx<'_>) -> Result<R, RuntimeError>) -> Result<R, RuntimeError> {
        self.install_device_checked_with_finish(schema, metadata, reset, expected, |tx| {
            tx.initialize_device_storage(metadata)?;
            crate::device::reset_for_install(tx, metadata, reset)
        }, finish)
    }
    fn witness_count(&self, table: &str) -> Result<u64, RuntimeError> { self.count(table) }
    fn residency(&mut self, schema: &Schema) -> Result<serde_json::Value, RuntimeError> {
        self.device_residency(schema)
    }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        self.device_meta(key)
    }
    fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> {
        self.set_device_meta(key, value)
    }
    fn transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError> {
        Store::transaction(self)
    }
    fn read_transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError> {
        Store::read_transaction(self)
    }
}

impl DeviceTx for Tx<'_> {
    fn commit(self) -> Result<(), RuntimeError> {
        Tx::commit(self)
    }
    fn rollback(self) -> Result<(), RuntimeError> {
        Tx::rollback(self)
    }
    fn savepoint(&self, name: &str) -> Result<(), RuntimeError> {
        Tx::savepoint(self, name)
    }
    fn release(&self, name: &str) -> Result<(), RuntimeError> {
        Tx::release(self, name)
    }
    fn rollback_to(&self, name: &str) -> Result<(), RuntimeError> {
        Tx::rollback_to(self, name)
    }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        self.device_meta(key)
    }
    fn set_meta(&self, key: &str, value: &str) -> Result<(), RuntimeError> {
        self.set_device_meta(key, value)
    }
    fn meta_prefix(&self, prefix: &str) -> Result<Vec<(String, String)>, RuntimeError> {
        self.device_meta_prefix(prefix)
    }
    fn delete_meta(&self, keys: &[&str]) -> Result<(), RuntimeError> {
        self.delete_device_meta(keys)
    }
    fn clear_rows(&self) -> Result<(), RuntimeError> {
        self.device_clear_rows()
    }
    fn replace_rows(&self, load: impl FnOnce() -> Result<(), RuntimeError>) -> Result<(), RuntimeError> {
        self.device_replace_rows(load)
    }
    fn put_staged(&self, _key: &str, name: &str, table: &snapback4_core::schema::Table, row: &snapback4_core::value::Value) -> Result<u64, RuntimeError> {
        self.put_loading_indexes(name, table, row)
    }
    fn outbox_insert(&self, seq: u64, id: &str, entry: &str) -> Result<(), RuntimeError> {
        self.device_outbox_insert(seq, id, entry)
    }
    fn outbox_upsert(&self, seq: u64, id: &str, entry: &str) -> Result<(), RuntimeError> {
        self.device_outbox_upsert(seq, id, entry)
    }
    fn outbox_delete(&self, id: &str) -> Result<(), RuntimeError> {
        self.device_outbox_delete(id)
    }
    fn outbox_get(&self, id: &str) -> Result<Option<String>, RuntimeError> {
        self.device_outbox_get(id)
    }
    fn outbox_entries(&self) -> Result<Vec<String>, RuntimeError> {
        self.device_outbox_entries()
    }
    fn outbox_max_seq(&self) -> Result<u64, RuntimeError> {
        self.device_outbox_max_seq()
    }
    fn base_remember(&self, table: &str, id: &str, image: Option<&str>) -> Result<(), RuntimeError> {
        self.device_base_remember(table, id, image)
    }
    fn base_entries(&self) -> Result<Vec<(String, String, Option<String>)>, RuntimeError> {
        self.device_base_entries()
    }
    fn base_has_table(&self, table: &str) -> Result<bool, RuntimeError> {
        self.device_base_has_table(table)
    }
    fn base_id_after(&self, table: &str, after: &str) -> Result<Option<String>, RuntimeError> {
        self.device_base_id_after(table, after)
    }
    fn base_clear(&self) -> Result<(), RuntimeError> {
        self.device_base_clear()
    }
    fn staged_put(&self, key: &str, table: &str, image: &str) -> Result<(), RuntimeError> {
        self.device_staged_put(key, table, image)
    }
    fn staged_delete(&self, key: &str) -> Result<(), RuntimeError> {
        self.device_staged_delete(key)
    }
    fn staged_after(&self, after: &str, limit: usize) -> Result<Vec<(String, String, String)>, RuntimeError> {
        self.device_staged_after(after, limit)
    }
    fn staged_table_after(&self, table: &str, after: &str, limit: usize) -> Result<Vec<(String, String)>, RuntimeError> {
        self.device_staged_table_after(table, after, limit)
    }
    fn staged_clear(&self) -> Result<(), RuntimeError> {
        self.device_staged_clear()
    }
}
