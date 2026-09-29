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
    #[cfg(not(target_arch = "wasm32"))]
    fn witness_count(&self, _table: &str) -> Result<u64, RuntimeError> {
        Err(RuntimeError::Store("this host cannot count held rows for the native witness".into()))
    }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError>;
    /// Web residency is measured by its persistence host, outside the wasm.
    #[cfg(feature = "native")]
    fn residency(&mut self, _schema: &Schema) -> Result<serde_json::Value, RuntimeError> {
        Err(RuntimeError::Input("residency needs a native SQLite device or the web persistence host".into()))
    }
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
    /// Delete exact keys; a trailing colon deletes the complete namespace.
    fn delete_meta(&self, keys: &[&str]) -> Result<(), RuntimeError>;
    /// Every row and index entry goes.
    fn clear_rows(&self) -> Result<(), RuntimeError>;
    /// Replace the partition in this transaction. The loader only puts rows
    /// and edits metadata: no index reads, deletes or savepoints until return.
    /// Memory can keep one index undo image; SQLite keeps ordinary puts.
    fn replace_rows(&self, load: impl FnOnce() -> Result<(), RuntimeError>) -> Result<(), RuntimeError> {
        self.clear_rows()?;
        load()
    }

    /// Install this exact decoded staged row. Memory may share its encoded
    /// image; native stores keep the ordinary transactional row/index write.
    fn put_staged(&self, _key: &str, name: &str, table: &snapback4_core::schema::Table, row: &snapback4_core::value::Value) -> Result<u64, RuntimeError> {
        self.put(name, table, row, None)
    }

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
    /// Seek one touched id without loading confirmed images or unrelated tables.
    fn base_id_after(&self, table: &str, after: &str) -> Result<Option<String>, RuntimeError>;
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

// Stream application borrows only rows and metadata. Keep the cold applicator
// shared across the real transaction and its rollback-only recording wrapper,
// without retaining outbox, staging, savepoint or commit vtable entries.
pub(crate) trait StreamTx: Rows {
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError>;
    fn set_meta(&self, key: &str, value: &str) -> Result<(), RuntimeError>;
    fn meta_prefix(&self, prefix: &str) -> Result<Vec<(String, String)>, RuntimeError>;
    fn delete_meta(&self, keys: &[&str]) -> Result<(), RuntimeError>;
}
impl<T: DeviceTx> StreamTx for T {
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> { DeviceTx::meta(self, key) }
    fn set_meta(&self, key: &str, value: &str) -> Result<(), RuntimeError> { DeviceTx::set_meta(self, key, value) }
    fn meta_prefix(&self, prefix: &str) -> Result<Vec<(String, String)>, RuntimeError> { DeviceTx::meta_prefix(self, prefix) }
    fn delete_meta(&self, keys: &[&str]) -> Result<(), RuntimeError> { DeviceTx::delete_meta(self, keys) }
}
