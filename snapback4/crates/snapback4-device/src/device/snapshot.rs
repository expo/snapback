//! Snapshot acquisition and its log catch-up stay staged, invisible,
//! until drained into the partition in one transaction.
use super::*;

#[derive(Serialize, Deserialize)]
pub(super) struct Staged {
    pub row: Value,
    pub acquired: bool,
}

// @ref LLP 3000.007#18.2 — replacement keeps confirmed history only for groups the viewer no longer holds.
pub(super) fn retain<T: DeviceTx>(tx: &T, schema: &Schema, held: Option<&wire::HeldGroups>) -> Result<(), RuntimeError> {
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
    let mut left = history::load(tx, history::GROUPS)?;
    let held: BTreeMap<String, BTreeSet<String>> = held.into_iter().flat_map(|tables| tables.iter()).map(|(name, groups)| {
        Ok((name.clone(), groups.iter().map(encoded).collect::<Result<_, RuntimeError>>()?))
    }).collect::<Result<_, RuntimeError>>()?;
    for (name, groups) in &held {
        if let Some(known) = left.get_mut(name) {
            for (group, state) in known { *state = if groups.contains(group) { history::Membership::Held } else { history::Membership::Left }; }
        }
        for group in groups { left.entry(name.clone()).or_default().insert(group.clone(), history::Membership::Held); }
    }
    // Keep confirmed candidates private until catch-up decides the final
    // membership. A leave between pages must keep already delivered rows.
    let mut after = String::new();
    loop {
        let rows = tx.staged_after(&after, 500)?;
        for (key, name, data) in &rows {
            let table = schema.table(name).ok_or_else(|| RuntimeError::Schema(format!("unknown table {name}")))?;
            let staged: Staged = decoded(data)?;
            let group = history::row_key(table, &staged.row)?;
            let retain = held.get(name).map_or_else(|| history::is_left(&left, name, &group), |groups| !groups.contains(&group));
            if retain {
                left.entry(name.clone()).or_default().insert(group, history::Membership::Left);
            }
            after = key.clone();
        }
        if rows.len() < 500 { break; }
    }
    tx.set_meta(history::STAGED_GROUPS, &encoded(&left)?)?;
    Ok(())
}

pub(super) fn stage<T: DeviceTx>(tx: &T, schema: &Schema, page: &StreamPage) -> Result<(), RuntimeError> {
    expiry_clock::advance(tx, expiry_clock::STAGED, page.now)?;
    let mut boundaries = boundary::Boundaries::editing(true);
    let mut markers = page.acquisitions.iter().peekable();
    boundary::validate_positions(page)?;
    for position in 0..=page.events.len() {
        while markers.peek().is_some_and(|marker| marker.at == position) {
            boundaries.marker(tx, schema, markers.next().unwrap(), page.snapshot)?;
        }
        let Some(event) = page.events.get(position) else { break };
        let table = schema.table(&event.table).ok_or_else(|| RuntimeError::Schema(format!("unknown table {}", event.table)))?;
        let key = encoded(&(&event.table, &event.id))?;
        if page.snapshot && event.kind != "put" {
            return Err(RuntimeError::Input("snapshots contain only row images".into()));
        }
        match event.kind.as_str() {
            "put" => {
                let row = wire::row_from_json(table, event.data.as_ref().ok_or_else(|| RuntimeError::Input("snapshot row is missing".into()))?).map_err(RuntimeError::Input)?;
                if row.field("id")?.as_str()? != event.id {
                    return Err(RuntimeError::Input("snapshot row identity does not match its event".into()));
                }
                if !snapback4_core::schema::timeline::holds_event(schema, &event.table, &row) { continue; }
                if !page.snapshot {
                    // Keys are JSON tuples ending in ']'; its strict prefix
                    // seeks this exact staged key without scanning the group.
                    let held = tx.staged_after(&key[..key.len() - 1], 1)?.first().is_some_and(|(found, _, _)| found == &key);
                    if !boundaries.accept(tx, &event.table, table, &row, held)? { continue; }
                }
                tx.staged_put(&key, &event.table, &encoded(&Staged { row, acquired: true })?)?;
            }
            "del" => tx.staged_delete(&key)?,
            "scope" => {
                let columns = audience_prefix(table);
                let group = scope_group(table, event)?;
                boundaries.scope(tx, &event.table, table, &group)?;
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
    boundaries.save(tx, true)
}

// @ref LLP 3000.007#18.2 — staged completion is publishable only after every snapshot continuation and the terminal page.
pub(super) fn continuation<T: DeviceTx>(tx: &T, page: &StreamPage, first: bool) -> Result<(), RuntimeError> {
    let expected = tx.meta(SNAPSHOT_NEXT)?;
    if page.snapshot {
        let valid = if first { page.after.is_none() } else { expected.as_deref().is_some_and(|next| !next.is_empty() && Some(next) == page.after.as_deref()) };
        if !valid || page.more != page.next.is_some() || page.next.as_deref() == Some("") {
            return Err(RuntimeError::Generation("snapshot continuation does not match the expected page; restart at its first page".into()));
        }
        tx.set_meta(SNAPSHOT_NEXT, page.next.as_deref().unwrap_or(""))?;
    } else if expected.as_deref() != Some("") {
        return Err(RuntimeError::Generation("snapshot catch-up requires the terminal snapshot page".into()));
    }
    Ok(())
}

/// Snapshot publication and every reset consume the same staging state.
pub(super) fn clear<T: DeviceTx>(tx: &T) -> Result<(), RuntimeError> {
    tx.staged_clear()?;
    tx.delete_meta(&SNAPSHOT_KEYS)
}
