//! Snapshot acquisition and its log catch-up stay staged, invisible,
//! until drained into the partition in one transaction.
use super::*;

#[derive(Serialize, Deserialize)]
pub(super) struct Staged {
    pub row: Value,
    pub acquired: bool,
}

// @ref LLP 3000.007#18.2 — acquisition overlays confirmed delivered history; neither a horizon nor a replacement snapshot evicts it.
pub(super) fn retain<T: DeviceTx>(tx: &T, schema: &Schema) -> Result<(), RuntimeError> {
    for (name, _, _) in schema.synced().filter(|(_, table, _)| table.leave == LeavePolicy::DeliveredHistory) {
        let mut bounds = Bounds::default();
        loop {
            let rows = tx.scan(name, "byId", &[], &bounds, Dir::Asc, 500)?;
            for (row, _) in &rows {
                let id = row.field("id")?;
                tx.staged_put(&encoded(&(name, id.as_str()?))?, name, &encoded(&Staged { row: row.clone(), acquired: false })?)?;
                bounds.after = Some(vec![id.clone()]);
            }
            if rows.len() < 500 { break; }
        }
    }
    // Predictions may insert, edit or delete a retained row. Overlay their
    // confirmed bases, including absent bases, without changing the visible
    // partition while the snapshot is still private.
    for (name, id, image) in tx.base_entries()? {
        if !schema.table(&name).is_some_and(|table| table.sync.is_some() && table.leave == LeavePolicy::DeliveredHistory) { continue; }
        let key = encoded(&(&name, id))?;
        match image {
            Some(image) => tx.staged_put(&key, &name, &encoded(&Staged { row: decoded(&image)?, acquired: false })?)?,
            None => tx.staged_delete(&key)?,
        }
    }
    Ok(())
}

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
                tx.staged_put(&key, &event.table, &encoded(&Staged { row, acquired: true })?)?;
            }
            "del" => tx.staged_delete(&key)?,
            "scope" => {
                let columns = audience_prefix(table);
                let group = scope_group(table, event)?;
                if table.leave == LeavePolicy::DeliveredHistory && !table.columns.values().any(|kind| kind.contains_asset()) { continue; }
                let mut after = String::new();
                loop {
                    let rows = tx.staged_table_after(&event.table, &after, 500)?;
                    for (key, data) in &rows {
                        let mut staged: Staged = decoded(data)?;
                        if columns.iter().zip(&group).all(|(column, value)| staged.row.field(column).ok() == Some(value)) {
                            if table.leave == LeavePolicy::DeliveredHistory {
                                // Text stays; a revoked media home must not be
                                // reactivated when these staged rows publish.
                                staged.acquired = false;
                                tx.staged_put(key, &event.table, &encoded(&staged)?)?;
                            } else {
                                tx.staged_delete(key)?;
                            }
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
