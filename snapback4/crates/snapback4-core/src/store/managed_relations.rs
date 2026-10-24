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
    // TEMP triggers can intercept main relations too, within this connection.
    for catalog in ["main.sqlite_master", "temp.sqlite_master"] {
        let mut stmt = conn.prepare(&format!("SELECT tbl_name, name, sql FROM {catalog} WHERE type='trigger' ORDER BY tbl_name,name"))?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let table: String = row.get(0)?;
            if !crate::managed_relations::TABLES.contains(&table.as_str()) { continue; }
            let name: String = row.get(1)?;
            let sql: Option<String> = row.get(2)?;
            if catalog == "main.sqlite_master" && table == "i" && guards.iter().any(|(n, definition)| n == &name && sql.as_deref() == Some(definition.as_str())) { continue; }
            return Err(crate::managed_relations::refusal(&table, &format!("trigger {name}")));
        }
    }
    Ok(())
}
