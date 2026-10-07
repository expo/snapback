//! The device's store on a native host: the core's own SQLite, the
//! server's two-table layout through the server's own code, with the
//! device's side tables — the outbox, the confirmed images, the staged
//! snapshot — beside it.

use crate::store::{DeviceStore, DeviceTx};
use rusqlite::{OptionalExtension, params};
use snapback4_core::error::RuntimeError;
use snapback4_core::schema::Schema;
use snapback4_core::store::{Store, Tx};
use std::collections::BTreeMap;
use std::path::Path;

/// Open (or create) the device store; side tables join accepted installation.
pub fn open(path: &Path) -> Result<Store, RuntimeError> {
    Store::open_shared(path)
}

// @ref LLP 3000.033#1.3 — native side tables join successful installation.
fn initialize(conn: &rusqlite::Connection) -> Result<(), RuntimeError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _device_outbox (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, entry TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS _device_base (t TEXT NOT NULL, id TEXT NOT NULL, data TEXT, PRIMARY KEY(t, id)) WITHOUT ROWID;
         CREATE TABLE IF NOT EXISTS _device_snapshot (k TEXT PRIMARY KEY, t TEXT NOT NULL, data TEXT NOT NULL);
         CREATE INDEX IF NOT EXISTS _device_snapshot_by_table ON _device_snapshot(t, k);",
    )?;
    Ok(())
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
            initialize(tx.conn())?;
            let adopting = tx.meta("device:backend")?.as_ref() != metadata.get("device:backend");
            crate::sqlite_residency::install_in(tx.conn(), adopting)?;
            crate::device::reset_for_install(tx, metadata, reset)
        }, finish)
    }
    fn witness_count(&self, table: &str) -> Result<u64, RuntimeError> { self.count(table) }
    fn residency(&mut self, schema: &Schema) -> Result<serde_json::Value, RuntimeError> {
        crate::sqlite_residency::read(self, schema)
    }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        Store::meta(self, key)
    }
    fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> {
        Store::set_meta(self, key, value)
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
        Ok(self.conn().prepare_cached("SELECT value FROM _meta WHERE key = ?1")?.query_row([key], |row| row.get(0)).optional()?)
    }
    fn set_meta(&self, key: &str, value: &str) -> Result<(), RuntimeError> {
        Tx::set_meta(self, key, value)
    }
    fn meta_prefix(&self, prefix: &str) -> Result<Vec<(String, String)>, RuntimeError> {
        Ok(self.conn().prepare_cached("SELECT key, value FROM _meta WHERE key >= ?1 AND key < ?2 ORDER BY key")?
            .query_map(params![prefix, format!("{prefix}\u{10ffff}")], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<_, _>>()?)
    }
    fn delete_meta(&self, keys: &[&str]) -> Result<(), RuntimeError> {
        for key in keys {
            if key.ends_with(':') {
                self.conn().execute("DELETE FROM _meta WHERE key >= ?1 AND key < ?2", params![key, format!("{key}\u{10ffff}")])?;
            } else { self.conn().execute("DELETE FROM _meta WHERE key = ?1", [key])?; }
        }
        Ok(())
    }
    fn clear_rows(&self) -> Result<(), RuntimeError> {
        self.changes.borrow_mut().widen();
        self.conn().execute_batch("DELETE FROM r; DELETE FROM i;")?;
        if self.meta("cap_counts_schema")?.is_some() {
            self.conn().execute_batch("DELETE FROM _cap_counts;")?;
        }
        Ok(())
    }
    // @ref LLP 3000.007#20.4 — sort native replacement indexes before coverage and prediction publication; keep FULL durability.
    fn replace_rows(&self, load: impl FnOnce() -> Result<(), RuntimeError>) -> Result<(), RuntimeError> {
        crate::sqlite_residency::replace_in(self.conn(), || {
            self.clear_rows()?;
            // Append to a disk-backed SQLite temp heap instead of doing random
            // B-tree inserts across every index with a bounded page cache. The
            // SQLite sorter spills to temporary files; Rust retains no key batch.
            self.conn().execute_batch("CREATE TEMP TABLE _device_index_load (ti INTEGER NOT NULL, k BLOB NOT NULL, id TEXT NOT NULL);")?;
            let result = load().and_then(|()| {
                self.conn().execute_batch("INSERT INTO main.i(ti, k, id) SELECT ti, k, id FROM temp._device_index_load ORDER BY ti, k;")?;
                Ok(())
            });
            // Leave no connection-local table after either outcome. Any failure
            // still propagates to the enclosing transaction's ordinary rollback.
            let cleanup = self.conn().execute_batch("DROP TABLE temp._device_index_load;");
            result?;
            cleanup?;
            Ok(())
        })
    }
    fn put_staged(&self, _key: &str, name: &str, table: &snapback4_core::schema::Table, row: &snapback4_core::value::Value) -> Result<u64, RuntimeError> {
        self.put_loading_indexes(name, table, row)
    }
    fn outbox_insert(&self, seq: u64, id: &str, entry: &str) -> Result<(), RuntimeError> {
        self.conn().execute("INSERT INTO _device_outbox(seq, id, entry) VALUES (?1, ?2, ?3)", params![stored_seq(seq)?, id, entry])?;
        Ok(())
    }
    fn outbox_upsert(&self, seq: u64, id: &str, entry: &str) -> Result<(), RuntimeError> {
        self.conn().execute("INSERT INTO _device_outbox(seq, id, entry) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET entry = excluded.entry", params![stored_seq(seq)?, id, entry])?;
        Ok(())
    }
    fn outbox_delete(&self, id: &str) -> Result<(), RuntimeError> {
        self.conn().execute("DELETE FROM _device_outbox WHERE id = ?1", [id])?;
        Ok(())
    }
    fn outbox_get(&self, id: &str) -> Result<Option<String>, RuntimeError> {
        Ok(self.conn().query_row("SELECT entry FROM _device_outbox WHERE id = ?1", [id], |row| row.get(0)).optional()?)
    }
    fn outbox_entries(&self) -> Result<Vec<String>, RuntimeError> {
        Ok(self.conn().prepare("SELECT entry FROM _device_outbox ORDER BY seq")?.query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?)
    }
    fn outbox_max_seq(&self) -> Result<u64, RuntimeError> {
        Ok(self.conn().query_row("SELECT COALESCE(MAX(seq), 0) FROM _device_outbox", [], |row| row.get::<_, i64>(0))? as u64)
    }
    fn base_remember(&self, table: &str, id: &str, image: Option<&str>) -> Result<(), RuntimeError> {
        self.conn().execute("INSERT OR IGNORE INTO _device_base(t, id, data) VALUES (?1, ?2, ?3)", params![table, id, image])?;
        Ok(())
    }
    fn base_entries(&self) -> Result<Vec<(String, String, Option<String>)>, RuntimeError> {
        Ok(self.conn().prepare("SELECT t, id, data FROM _device_base ORDER BY t, id")?.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?.collect::<Result<_, _>>()?)
    }
    fn base_has_table(&self, table: &str) -> Result<bool, RuntimeError> {
        Ok(self.conn().query_row("SELECT EXISTS(SELECT 1 FROM _device_base WHERE t = ?1)", [table], |row| row.get(0))?)
    }
    fn base_id_after(&self, table: &str, after: &str) -> Result<Option<String>, RuntimeError> {
        Ok(self.conn().query_row("SELECT id FROM _device_base WHERE t = ?1 AND id > ?2 ORDER BY id LIMIT 1", params![table, after], |row| row.get(0)).optional()?)
    }
    fn base_clear(&self) -> Result<(), RuntimeError> {
        self.conn().execute("DELETE FROM _device_base", [])?;
        Ok(())
    }
    fn staged_put(&self, key: &str, table: &str, image: &str) -> Result<(), RuntimeError> {
        self.conn().prepare_cached("INSERT INTO _device_snapshot(k, t, data) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET data = excluded.data, t = excluded.t")?.execute(params![key, table, image])?;
        Ok(())
    }
    fn staged_delete(&self, key: &str) -> Result<(), RuntimeError> {
        self.conn().execute("DELETE FROM _device_snapshot WHERE k = ?1", [key])?;
        Ok(())
    }
    fn staged_after(&self, after: &str, limit: usize) -> Result<Vec<(String, String, String)>, RuntimeError> {
        Ok(self.conn().prepare_cached("SELECT k, t, data FROM _device_snapshot WHERE k > ?1 ORDER BY k LIMIT ?2")?.query_map(params![after, limit as i64], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?.collect::<Result<_, _>>()?)
    }
    fn staged_table_after(&self, table: &str, after: &str, limit: usize) -> Result<Vec<(String, String)>, RuntimeError> {
        Ok(self.conn().prepare("SELECT k, data FROM _device_snapshot WHERE t = ?1 AND k > ?2 ORDER BY k LIMIT ?3")?.query_map(params![table, after, limit as i64], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<_, _>>()?)
    }
    fn staged_clear(&self) -> Result<(), RuntimeError> {
        self.conn().execute("DELETE FROM _device_snapshot", [])?;
        Ok(())
    }
}

fn stored_seq(seq: u64) -> Result<i64, RuntimeError> {
    i64::try_from(seq).map_err(|_| RuntimeError::Input("submission sequence exceeds the stored integer range".into()))
}
