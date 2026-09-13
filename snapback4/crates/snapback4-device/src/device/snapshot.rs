//! Snapshot acquisition and its log catch-up stay staged, invisible,
//! until drained into the partition in one transaction.
use super::*;

pub(super) fn stage<T: DeviceTx>(tx: &T, schema: &Schema, events: &[StreamEvent], snapshot: bool) -> Result<(), RuntimeError> {
    for event in events {
        let table = schema.table(&event.table).ok_or_else(|| RuntimeError::Schema(format!("unknown table {}", event.table)))?;
        let key = encoded(&(&event.table, &event.id))?;
        if snapshot && event.kind != "put" {
            return Err(RuntimeError::Input("snapshots contain only row images".into()));
        }
        match event.kind.as_str() {
            "put" => {
                let row = wire::row_from_json(table, event.data.as_ref().ok_or_else(|| RuntimeError::Input("snapshot row is missing".into()))?).map_err(RuntimeError::Input)?;
                if row.field("id")?.as_str()? != event.id {
                    return Err(RuntimeError::Input("snapshot row identity does not match its event".into()));
                }
                tx.staged_put(&key, &event.table, &encoded(&row)?)?;
            }
            "del" => tx.staged_delete(&key)?,
            "scope" => {
                let columns = audience_prefix(table);
                let group = scope_group(table, event)?;
                if table.leave == LeavePolicy::DeliveredHistory {
                    continue;
                }
                let mut after = String::new();
                loop {
                    let rows = tx.staged_table_after(&event.table, &after, 500)?;
                    for (key, data) in &rows {
                        let row: Value = decoded(data)?;
                        if columns.iter().zip(&group).all(|(column, value)| row.field(column).ok() == Some(value)) {
                            tx.staged_delete(key)?;
                        }
                        after = key.clone();
                    }
                    if rows.len() < 500 {
                        break;
                    }
                }
            }
            _ => return Err(RuntimeError::Input("unknown stream event".into())),
        }
    }
    Ok(())
}
