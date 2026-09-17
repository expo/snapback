//! What a device needs of its store, beyond the interpreter's `Rows`: a
//! transaction with savepoints, metadata, the outbox in submission order,
//! the confirmed images beneath predictions, and a staged snapshot. Two
//! stores implement it — the core's SQLite on a native host, and memory
//! on the web, where the host persists the changes each commit reports —
//! and one device runs over either (LLP 3000 §7, one implementation).

use snapback4_core::error::RuntimeError;
use snapback4_core::rows::Rows;
use snapback4_core::schema::Schema;
use std::collections::BTreeMap;

pub trait DeviceStore {
    type Tx<'a>: DeviceTx
    where
        Self: 'a;
    /// Install the schema and the metadata in one step; `reset` drops the
    /// rows, the images and the staged snapshot (a new generation), never
    /// the outbox.
    fn install(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool) -> Result<(), RuntimeError>;
    /// Compare capture metadata inside the installation transaction.
    fn install_checked(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool, expected: &BTreeMap<String, Option<String>>) -> Result<(), RuntimeError> {
        if !expected.is_empty() { return Err(RuntimeError::Store("this device store cannot check backend adoption captures".into())); }
        self.install(schema, metadata, reset)
    }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError>;
    fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError>;
    fn transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError>;
    /// A consistent read that does not need to reserve a writer. Memory has
    /// one transaction kind; native SQLite overrides this with `DEFERRED`.
    fn read_transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError> {
        self.transaction()
    }
}

/// One transaction: everything below commits or rolls back together.
pub trait DeviceTx: Rows {
    fn commit(self) -> Result<(), RuntimeError>;
    fn rollback(self) -> Result<(), RuntimeError>;
    fn savepoint(&self, name: &str) -> Result<(), RuntimeError>;
    fn release(&self, name: &str) -> Result<(), RuntimeError>;
    /// Roll back to the named savepoint and release it.
    fn rollback_to(&self, name: &str) -> Result<(), RuntimeError>;

    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError>;
    fn set_meta(&self, key: &str, value: &str) -> Result<(), RuntimeError>;
    /// Read a metadata namespace in key order. Keys ending in `:` name namespaces.
    fn meta_prefix(&self, prefix: &str) -> Result<Vec<(String, String)>, RuntimeError>;
    /// Delete exact keys, or every entry of a namespace ending in `:`.
    fn delete_meta(&self, keys: &[&str]) -> Result<(), RuntimeError>;
    /// Every row and index entry goes.
    fn clear_rows(&self) -> Result<(), RuntimeError>;

    /// A new outbox entry; a duplicate submission number or id is refused.
    fn outbox_insert(&self, seq: u64, id: &str, entry: &str) -> Result<(), RuntimeError>;
    /// The entry with this id, replaced.
    fn outbox_upsert(&self, seq: u64, id: &str, entry: &str) -> Result<(), RuntimeError>;
    fn outbox_delete(&self, id: &str) -> Result<(), RuntimeError>;
    fn outbox_get(&self, id: &str) -> Result<Option<String>, RuntimeError>;
    /// Every entry, in submission order.
    fn outbox_entries(&self) -> Result<Vec<String>, RuntimeError>;
    fn outbox_max_seq(&self) -> Result<u64, RuntimeError>;

    /// The confirmed image of a row a prediction is about to touch (`None`
    /// when there was no row); the first image kept wins.
    fn base_remember(&self, table: &str, id: &str, image: Option<&str>) -> Result<(), RuntimeError>;
    fn base_entries(&self) -> Result<Vec<(String, String, Option<String>)>, RuntimeError>;
    fn base_clear(&self) -> Result<(), RuntimeError>;

    /// A staged snapshot row, keyed by `key` (ordered), in `table`.
    fn staged_put(&self, key: &str, table: &str, image: &str) -> Result<(), RuntimeError>;
    fn staged_delete(&self, key: &str) -> Result<(), RuntimeError>;
    /// Staged rows with keys after `after`, in key order: (key, table, image).
    fn staged_after(&self, after: &str, limit: usize) -> Result<Vec<(String, String, String)>, RuntimeError>;
    /// One table's staged rows with keys after `after`: (key, image).
    fn staged_table_after(&self, table: &str, after: &str, limit: usize) -> Result<Vec<(String, String)>, RuntimeError>;
    fn staged_clear(&self) -> Result<(), RuntimeError>;
}
