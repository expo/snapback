//! Native residency counters; SQLite maintains them with the row transaction.
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use snapback4_core::{error::{MeterKind, RuntimeError}, meter::{Ceilings, Cut, Meter}, schema::Schema};
use serde_json::{Value, json};

// @ref LLP 3000.019#3.4 — inspecting residency must not copy or scan the held partition on every call.
pub(crate) fn install(conn: &Connection) -> Result<(), RuntimeError> {
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let installed: bool = tx.query_row("SELECT
        EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_device_residency') AND
        (SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'r'
         AND name IN ('_device_residency_insert', '_device_residency_delete', '_device_residency_update')) = 3", [], |r| r.get(0))?;
    if installed { return Ok(tx.commit()?); }
    // A table without all its triggers cannot certify the counters. Rebuild
    // interrupted/partial installations atomically before reporting or writing.
    tx.execute_batch("DROP TRIGGER IF EXISTS _device_residency_insert;
        DROP TRIGGER IF EXISTS _device_residency_delete;
        DROP TRIGGER IF EXISTS _device_residency_update;
        DROP TABLE IF EXISTS _device_residency;
        CREATE TABLE _device_residency (t INTEGER PRIMARY KEY, rows INTEGER NOT NULL, bytes INTEGER NOT NULL);")?;
    // Upgrade old devices in bounded maintenance chunks. Read only keys and
    // byte lengths, never row bodies. The transaction fences concurrent owners
    // and rolls the entire installation back on failure.
    let mut cursor = (i64::MIN, String::new());
    loop {
        let mut meter = Meter::new(Ceilings::job(), Cut::Abort);
        meter.at("device residency upgrade");
        let mut query = tx.prepare("SELECT t, id, length(CAST(data AS BLOB)) FROM r WHERE (t, id) > (?1, ?2) ORDER BY t, id LIMIT 512")?;
        let mut rows = query.query(params![cursor.0, cursor.1])?;
        let mut count = 0;
        while let Some(row) = rows.next()? {
            meter.charge(MeterKind::Examined, 1)?;
            meter.step(1)?;
            let t: i64 = row.get(0)?;
            let id = row.get_ref(1)?.as_str().map_err(|e| RuntimeError::Store(e.to_string()))?;
            meter.charge(MeterKind::HeapBytes, id.len() as u64 + 32)?;
            let bytes: i64 = row.get(2)?;
            meter.charge(MeterKind::RowsWritten, 1)?;
            tx.execute("INSERT INTO _device_residency VALUES (?1, 1, ?2) ON CONFLICT(t) DO UPDATE SET rows = rows + 1, bytes = bytes + excluded.bytes", params![t, bytes])?;
            cursor = (t, id.to_owned());
            count += 1;
        }
        if count < 512 { break; }
    }
    tx.execute_batch("CREATE TRIGGER _device_residency_insert AFTER INSERT ON r BEGIN
        INSERT INTO _device_residency VALUES (NEW.t, 1, length(CAST(NEW.data AS BLOB)))
        ON CONFLICT(t) DO UPDATE SET rows = rows + 1, bytes = bytes + excluded.bytes;
      END;
      CREATE TRIGGER _device_residency_delete AFTER DELETE ON r BEGIN
        UPDATE _device_residency SET rows = rows - 1, bytes = bytes - length(CAST(OLD.data AS BLOB)) WHERE t = OLD.t;
      END;
      CREATE TRIGGER _device_residency_update AFTER UPDATE ON r BEGIN
        UPDATE _device_residency SET rows = rows - 1, bytes = bytes - length(CAST(OLD.data AS BLOB)) WHERE t = OLD.t;
        INSERT INTO _device_residency VALUES (NEW.t, 1, length(CAST(NEW.data AS BLOB)))
        ON CONFLICT(t) DO UPDATE SET rows = rows + 1, bytes = bytes + excluded.bytes;
      END;")?;
    Ok(tx.commit()?)
}

pub(crate) fn read(store: &mut snapback4_core::Store, schema: &Schema) -> Result<Value, RuntimeError> {
    // The catalog and counters must belong to the handle's adopted generation.
    let snapshot = store.read_transaction()?;
    let tx = snapshot.conn();
    let mut meter = Meter::new(Ceilings::default(), Cut::Abort);
    meter.at("client.residency");
    let mut tables = serde_json::Map::new();
    let mut query = tx.prepare("SELECT COALESCE(s.rows, 0), COALESCE(s.bytes, 0) FROM _catalog c LEFT JOIN _device_residency s ON s.t = c.num WHERE c.name = ?1")?;
    for (name, _) in schema.visible_tables() {
        meter.step(1)?;
        meter.charge(MeterKind::HeapBytes, name.len() as u64 + 128)?;
        meter.charge(MeterKind::OutputBytes, name.len() as u64 + 64)?;
        let (rows, bytes) = query.query_row([name], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))).optional()?.unwrap_or_default();
        tables.insert(name.clone(), json!({ "rows": rows, "bytes": bytes }));
    }
    let pages: i64 = tx.query_row("PRAGMA page_count", [], |r| r.get(0))?;
    let page_size: i64 = tx.query_row("PRAGMA page_size", [], |r| r.get(0))?;
    Ok(json!({ "tables": tables, "totalBytes": pages * page_size, "totalBytesKind": "sqlite-pages" }))
}

#[cfg(test)]
#[path = "sqlite_residency_tests.rs"]
mod tests;
