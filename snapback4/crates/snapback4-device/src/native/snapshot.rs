//! Snapshot acquisition and its log catch-up remain invisible until drained.
use super::*;
use rusqlite::params;

pub(super) fn stage(tx: &Tx<'_>, schema: &Schema, events: &[StreamEvent], snapshot: bool) -> Result<(), RuntimeError> {
    for event in events {
        let table = schema.table(&event.table).ok_or_else(|| RuntimeError::Schema(format!("unknown table {}", event.table)))?;
        let key = serde_json::to_string(&(&event.table, &event.id)).expect("row key");
        if snapshot && event.kind != "put" { return Err(RuntimeError::Input("snapshots contain only row images".into())); }
        match event.kind.as_str() {
            "put" => {
                let row = wire::row_from_json(table, event.data.as_ref().ok_or_else(|| RuntimeError::Input("snapshot row is missing".into()))?).map_err(RuntimeError::Input)?;
                if row.field("id")?.as_str()? != event.id { return Err(RuntimeError::Input("snapshot row identity does not match its event".into())); }
                tx.conn().execute("INSERT INTO _device_snapshot(k, t, data) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET data = excluded.data", params![key, event.table, serde_json::to_string(&row).expect("row")])?;
            }
            "del" => { tx.conn().execute("DELETE FROM _device_snapshot WHERE k = ?1", [&key])?; }
            "scope" => {
                let columns = audience_prefix(table);
                let group: Vec<Value> = match &event.data {
                    Some(serde_json::Value::Array(items)) if items.len() == columns.len() => items.iter().zip(&columns).map(|(item, column)| wire::column_from_json(&table.columns[column], item)).collect::<Result<_, _>>().map_err(RuntimeError::Input)?,
                    _ => return Err(RuntimeError::Input("scope is not a key".into())),
                };
                if table.leave == LeavePolicy::DeliveredHistory { continue; }
                let mut after = String::new();
                loop {
                    let rows = tx.conn().prepare("SELECT k, data FROM _device_snapshot WHERE t = ?1 AND k > ?2 ORDER BY k LIMIT 500")?.query_map(params![event.table, after], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?.collect::<Result<Vec<_>, _>>()?;
                    for (key, data) in &rows {
                        let row: Value = serde_json::from_str(data).map_err(|e| RuntimeError::Store(e.to_string()))?;
                        if columns.iter().zip(&group).all(|(column, value)| row.field(column).ok() == Some(value)) { tx.conn().execute("DELETE FROM _device_snapshot WHERE k = ?1", [key])?; }
                        after = key.clone();
                    }
                    if rows.len() < 500 { break; }
                }
            }
            _ => return Err(RuntimeError::Input("unknown stream event".into())),
        }
    }
    Ok(())
}
