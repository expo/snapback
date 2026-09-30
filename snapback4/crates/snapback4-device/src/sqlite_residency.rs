//! Native residency counters; SQLite maintains them with the row transaction.
use rusqlite::{Connection, OptionalExtension, params};
use snapback4_core::{error::{MeterKind, RuntimeError}, meter::{Ceilings, Cut, Meter}, schema::Schema};
use serde_json::{Value, json};

// @ref LLP 3000.019#3.4 — inspecting residency must not copy or scan the held partition on every call.
pub(crate) fn install_in(conn: &Connection, adopting: bool) -> Result<(), RuntimeError> {
    assert!(!conn.is_autocommit(), "residency installation belongs to schema installation");
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = '_device_residency')", [], |r| r.get(0))?;
    let temporary = !adopting && !exists;
    // Opening an old, unchanged backend is not permission to migrate its
    // durable state. Keep a connection-local counter cache until adoption.
    // @ref LLP 3000.019#3.4 — legacy inspection preserves the old store.
    let namespace = if temporary { "temp" } else { "main" };
    if !temporary {
        conn.execute_batch("DROP TRIGGER IF EXISTS temp._device_residency_insert;
            DROP TRIGGER IF EXISTS temp._device_residency_delete;
            DROP TRIGGER IF EXISTS temp._device_residency_update;
            DROP TABLE IF EXISTS temp._device_residency; PRAGMA temp.user_version = 0;")?;
    }
    let installed: bool = conn.query_row(&format!("SELECT
        EXISTS(SELECT 1 FROM {namespace}.sqlite_master WHERE type = 'table' AND name = '_device_residency') AND
        (SELECT count(*) FROM {namespace}.sqlite_master WHERE type = 'trigger' AND tbl_name = 'r'
         AND name IN ('_device_residency_insert', '_device_residency_delete', '_device_residency_update')) = 3"), [], |r| r.get(0))?;
    if installed && (!temporary || current_cache(conn)?) { return Ok(()); }
    rebuild(conn, temporary)
}

// temp.user_version belongs only to this connection. Main's data_version
// changes on other owners' commits; our own writes maintain the temp triggers.
fn current_cache(conn: &Connection) -> Result<bool, RuntimeError> {
    let kept: i64 = conn.query_row("PRAGMA temp.user_version", [], |r| r.get(0))?;
    let current: i64 = conn.query_row("PRAGMA main.data_version", [], |r| r.get(0))?;
    Ok(kept == current)
}

fn rebuild(tx: &Connection, temporary: bool) -> Result<(), RuntimeError> {
    let namespace = if temporary { "temp" } else { "main" };
    let storage = if temporary { "TEMP " } else { "" };
    // A table without all its triggers cannot certify the counters. Rebuild
    // interrupted/partial installations atomically before reporting or writing.
    tx.execute_batch(&format!("DROP TRIGGER IF EXISTS {namespace}._device_residency_insert;
        DROP TRIGGER IF EXISTS {namespace}._device_residency_delete;
        DROP TRIGGER IF EXISTS {namespace}._device_residency_update;
        DROP TABLE IF EXISTS {namespace}._device_residency;
        CREATE {storage}TABLE _device_residency (t INTEGER PRIMARY KEY, rows INTEGER NOT NULL, bytes INTEGER NOT NULL);"))?;
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
    create_triggers(tx, temporary)?;
    if temporary {
        let version: i64 = tx.query_row("PRAGMA main.data_version", [], |r| r.get(0))?;
        tx.execute_batch(&format!("PRAGMA temp.user_version = {version}"))?;
    }
    Ok(())
}

fn create_triggers(tx: &Connection, temporary: bool) -> Result<(), RuntimeError> {
    let storage = if temporary { "TEMP " } else { "" };
    tx.execute_batch(&format!("CREATE {storage}TRIGGER _device_residency_insert AFTER INSERT ON main.r BEGIN
        INSERT INTO _device_residency VALUES (NEW.t, 1, length(CAST(NEW.data AS BLOB)))
        ON CONFLICT(t) DO UPDATE SET rows = rows + 1, bytes = bytes + excluded.bytes;
      END;
      CREATE {storage}TRIGGER _device_residency_delete AFTER DELETE ON main.r BEGIN
        UPDATE _device_residency SET rows = rows - 1, bytes = bytes - length(CAST(OLD.data AS BLOB)) WHERE t = OLD.t;
      END;
      CREATE {storage}TRIGGER _device_residency_update AFTER UPDATE ON main.r BEGIN
        UPDATE _device_residency SET rows = rows - 1, bytes = bytes - length(CAST(OLD.data AS BLOB)) WHERE t = OLD.t;
        INSERT INTO _device_residency VALUES (NEW.t, 1, length(CAST(NEW.data AS BLOB)))
        ON CONFLICT(t) DO UPDATE SET rows = rows + 1, bytes = bytes + excluded.bytes;
      END;"))?;
    Ok(())
}

// @ref LLP 3000.007#20.4 — whole-partition replacement computes counters once in the same atomic publication.
pub(crate) fn replace_in(conn: &Connection, load: impl FnOnce() -> Result<(), RuntimeError>) -> Result<(), RuntimeError> {
    assert!(!conn.is_autocommit(), "replacement counters belong to the row transaction");
    let temporary: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM temp.sqlite_master WHERE name = '_device_residency' AND type = 'table')", [], |r| r.get(0))?;
    let namespace = if temporary { "temp" } else { "main" };
    conn.execute_batch(&format!("DROP TRIGGER {namespace}._device_residency_insert;
        DROP TRIGGER {namespace}._device_residency_delete;
        DROP TRIGGER {namespace}._device_residency_update;"))?;
    let result = load().and_then(|()| {
        // Keep zero entries for formerly occupied tables, like the triggers.
        // The r primary key groups this scan; only one aggregate per table is
        // retained, and row bodies are never copied into Rust for bookkeeping.
        conn.execute_batch(&format!("UPDATE {namespace}._device_residency SET rows = 0, bytes = 0;
            INSERT INTO {namespace}._device_residency(t, rows, bytes)
            SELECT t, count(*), sum(length(CAST(data AS BLOB))) FROM main.r GROUP BY t
            ON CONFLICT(t) DO UPDATE SET rows = excluded.rows, bytes = excluded.bytes;"))?;
        Ok(())
    });
    let restore = create_triggers(conn, temporary);
    result?;
    restore?;
    Ok(())
}

pub(crate) fn read(store: &mut snapback4_core::Store, schema: &Schema) -> Result<Value, RuntimeError> {
    // The catalog and counters must belong to the handle's adopted generation.
    let snapshot = store.read_transaction()?;
    let tx = snapshot.conn();
    let cached: i64 = tx.query_row("PRAGMA temp.user_version", [], |r| r.get(0))?;
    if cached != 0 && !current_cache(tx)? { rebuild(tx, true)?; }
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
    drop(query);
    snapshot.commit()?; // Retain a refreshed temp cache; main remains read-only.
    Ok(json!({ "tables": tables, "totalBytes": pages * page_size, "totalBytesKind": "sqlite-pages" }))
}

#[cfg(test)]
#[path = "sqlite_residency_tests.rs"]
mod tests;
