//! Refuse write interception before opening or changing a managed store.
use super::*;

pub(super) fn index_guards() -> [(String, String); 2] {
    let limit = crate::rows::MAX_INDEX_KEY_BYTES;
    [("insert", "INSERT"), ("update", "UPDATE OF k")].map(|(suffix, event)| {
        let name = format!("_index_keys_{suffix}_{limit}");
        let sql = format!("CREATE TRIGGER {name} AFTER {event} ON i WHEN length(NEW.k) > {limit}\n             BEGIN DELETE FROM _meta WHERE key = 'index_keys_validated'; END");
        (name, sql)
    })
}

pub(super) fn verify(conn: &Connection) -> Result<(), RuntimeError> {
    let guards = index_guards();
    let residency = super::device_residency::triggers();
    let durable_residency: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM main.sqlite_master WHERE type='table' AND name='_device_residency')", [], |r| r.get(0))?;
    let temporary_residency: bool = !durable_residency && conn.query_row("SELECT EXISTS(SELECT 1 FROM temp.sqlite_master WHERE type='table' AND name='_device_residency')", [], |r| r.get(0))?;
    // TEMP triggers can intercept main relations too, within this connection.
    for catalog in ["main.sqlite_master", "temp.sqlite_master"] {
        let mut stmt = conn.prepare(&format!("SELECT tbl_name, name, sql FROM {catalog} WHERE type='trigger' ORDER BY tbl_name,name"))?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let table: String = row.get(0)?;
            // SQLite identifier comparison folds ASCII, including quoted names.
            if !crate::managed_relations::TABLES.iter().any(|name|name.eq_ignore_ascii_case(&table)) { continue; }
            let name: String = row.get(1)?;
            let sql: Option<String> = row.get(2)?;
            if catalog == "main.sqlite_master" && table == "i" && guards.iter().any(|(n, definition)| n == &name && sql.as_deref() == Some(definition.as_str())) { continue; }
            let residency_mode = if catalog == "main.sqlite_master" { durable_residency } else { temporary_residency };
            if table == "r" && residency_mode && residency.iter().any(|(n, definition)| *n == name && sql.as_deref() == Some(*definition)) { continue; }
            // Production has no evaluation trigger exception. Even evaluation
            // builds admit only the exact TEMP tracker body for this table.
            #[cfg(feature = "evaluation-support")]
            if catalog == "temp.sqlite_master" && super::evaluation::is_tracker(&table, &name, sql.as_deref()) { continue; }
            return Err(crate::managed_relations::refusal(&table, &format!("trigger {name}")));
        }
    }
    Ok(())
}
