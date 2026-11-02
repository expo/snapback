//! The legacy snapshot walk, also paged one horizonless table at a time.
use super::*;

/// Everything a principal holds right now, one page at a time: the
/// snapshot a device applies before it follows the log from the watermark
/// the first page pinned. Each page is its own transaction, so the engine
/// is free between pages and a device never holds more than a page in
/// memory; a row that changes between pages reaches the device again
/// through the log, idempotently, and a group joined or left between pages
/// reaches it as the log's join or scope.
#[cfg(feature = "sqlite")]
pub fn snapshot_page(tx: &dyn PartitionRows, schema: &Schema, principal: &str, cursor: Option<SnapshotCursor>, limit: usize, now: i64) -> Result<SnapshotPage, RuntimeError> {
    Ok(walk(tx, schema, principal, cursor, limit, now, false, None)?.0)
}

pub(super) fn walk(tx: &dyn PartitionRows, schema: &Schema, principal: &str, cursor: Option<SnapshotCursor>, limit: usize, now: i64, one_table: bool, mut budget: Option<&mut delivery::Budget>) -> Result<(SnapshotPage, Option<String>), RuntimeError> {
    let watermark = match &cursor {
        Some(cursor) => cursor.watermark,
        None => tx.next_seq()? - 1,
    };
    // @ref LLP 3000.007#18.2 — the first page names only this viewer's audience prefixes; held groups replace, left groups retain.
    let held = if cursor.is_none() {
        let mut held = crate::wire::HeldGroups::new();
        for (name, _, sync) in schema.synced().filter(|(name, table, _)| {
            table.leave == crate::schema::LeavePolicy::DeliveredHistory || schema.maintain_for(name).is_some_and(|m| m.own_keys.is_some())
        }) {
            held.insert(name.to_owned(), snapshot_groups(tx, schema, name, sync, principal, now)?.iter().map(|group| group.iter().map(crate::wire::to_json).collect()).collect());
        }
        Some(held)
    } else { None };
    let mut acquisitions = Vec::new();
    let mut at = cursor.unwrap_or(SnapshotCursor { watermark, ..SnapshotCursor::default() });
    let tables: Vec<(&str, &Table, &Sync)> = schema.synced().filter(|(_, _, sync)| at.tier == 0 || sync.horizon.is_none()).collect();
    let mut events = Vec::new();
    let limit = limit.max(1);
    let mut used = 0;
    while at.table < tables.len() {
        let (table_name, table, full) = tables[at.table];
        // A partial kind lives only in source slots. Do not even open its
        // owned table when neither kind can contribute a snapshot row.
        if schema.timelines.iter().any(|t| {
            table_name == t.table("Posts")
            && !t.fully_synced(schema, false) && !t.fully_synced(schema, true)
        }) {
            at.table += 1; at.arm = 0; at.group = None; at.after = None; at.taken = 0;
            if one_table {
                let next = (at.table < tables.len()).then_some(at);
                return Ok((SnapshotPage { acquisitions, events, watermark, next, held }, None));
            }
            continue;
        }
        // @ref LLP 3000.036.000.000#4.4 — a union's snapshot walks each arm in turn; a row in two arms is staged twice, idempotently.
        let arms: Vec<(&Audience, Option<&crate::schema::Horizon>)> = full.arms().collect();
        if at.arm >= arms.len() { at.table += 1; at.arm = 0; at.group = None; at.after = None; at.taken = 0; continue; }
        let (arm_audience, arm_horizon) = arms[at.arm];
        let arm = arm_sync(arm_audience, arm_horizon);
        let sync = &arm;
        let groups = arm_groups(tx, schema, table_name, full, arm_audience, principal, now)?;
        // Resume at the group in flight, or at the first group after one
        // the principal no longer holds.
        let mut position = match &at.group {
            Some(current) => groups.iter().position(|group| canonical_json(group) >= canonical_json(current)).unwrap_or(groups.len()),
            None => 0,
        };
        if at.group.as_ref().is_some_and(|current| groups.get(position) != Some(current)) {
            at.after = None;
            at.taken = 0;
        }
        while position < groups.len() {
            let group = &groups[position];
            let room = limit - used;
            if room == 0 {
                at.group = Some(group.clone());
                return Ok((SnapshotPage { acquisitions, events, watermark, next: Some(at), held }, None));
            }
            if at.taken == 0 && at.after.is_none() {
                if let Some(horizon) = &sync.horizon {
                    acquisitions.push(acquisition(table_name, &horizon.by, group, events.len(), None));
                }
            }
            // @ref LLP 3000.001.001#61-the-acquisition-page — tier 1 shares the packed reply's budget; reserve bounded decode scratch before reading any candidate batch.
            let (chunk, lookahead) = match budget.as_ref().map(|budget| budget.scratch_chunk(table, room.min(budget.row_room()))) {
                Some(Ok(chunk)) => (chunk, true),
                // @ref LLP 3000.001.001#61-the-acquisition-page — a tier-1 budget cut publishes its admitted prefix, never a whole-table fact. Tier-2 groups remain atomic.
                Some(Err(RuntimeError::Bound { .. })) if !events.is_empty() => {
                    at.group = Some(group.clone());
                    return Ok((SnapshotPage { acquisitions, events, watermark, next: Some(at), held }, None));
                }
                // The decoder allocates the actual value, not its declared
                // maximum. An empty reply can try one row without lookahead;
                // retain below either admits its actual bytes or refuses it.
                Some(Err(RuntimeError::Bound { kind: crate::error::MeterKind::HeapBytes, .. }))
                    if budget.as_ref().is_some_and(|budget| budget.is_empty()) => (1, false),
                Some(Err(error)) => return Err(error),
                None => (room, true),
            };
            let (rows, exhausted, scanned, work) = group_rows_from_mode(tx, table_name, table, sync, group, at.after.as_deref(), at.taken, chunk, now, Some((schema, principal)), lookahead)?;
            // Empty groups still emit transitions and must consume page room.
            used += work.max(1);
            for (row, key) in rows {
                let id = row.field("id")?.as_str()?.to_owned();
                let partition = if table.field_owners(&row).contains(principal) { partition_of(principal) } else { match &sync.audience {
                    Audience::Public => PUBLIC.to_owned(),
                    Audience::Column(_) => partition_of(principal),
                    Audience::Target { .. } => group_partition(table_name, group),
                }};
                let image = LogEvent { seq: watermark, ord: 0, table: table_name.into(), kind: "put".into(), id, data: Some(row) };
                if let Some(budget) = budget.as_mut() {
                    match budget.retain(&image, key.len()) {
                        Ok(()) => {},
                        Err(RuntimeError::Bound { .. }) if !events.is_empty() => {
                            at.group = Some(group.clone());
                            return Ok((SnapshotPage { acquisitions, events, watermark, next: Some(at), held }, None));
                        }
                        Err(error) => return Err(error),
                    }
                }
                // Advance only after admission: a refused candidate belongs
                // to the next page, including when it was already decoded.
                at.after = crate::key::decode(&key).map(|values| values.into_iter().skip(group.len()).collect());
                at.taken += 1;
                events.push(Event { partition, table: image.table, kind: EventKind::Put, id: image.id, data: image.data });
            }
            if scanned.is_some() { at.after = scanned; }
            if !exhausted {
                if used < limit { continue; }
                at.group = Some(group.clone());
                return Ok((SnapshotPage { acquisitions, events, watermark, next: Some(at), held }, None));
            }
            if let Some(horizon) = &sync.horizon {
                let floor = if at.taken < horizon.last as usize { "whole".into() } else {
                    let mut key = group.clone();
                    key.extend(at.after.clone().expect("selected horizon has a last key"));
                    crate::value::encode_bytes_hex(&crate::key::encode(&key))
                };
                acquisitions.push(acquisition(table_name, &horizon.by, group, events.len(), Some(floor)));
            }
            at.after = None;
            at.taken = 0;
            position += 1;
        }
        at.arm += 1;
        if at.arm >= arms.len() { at.table += 1; at.arm = 0; }
        at.group = None;
        // @ref LLP 3000.001.001#61-the-acquisition-page — a tier-1 unit ends at this table, even with room left.
        if one_table && at.arm == 0 {
            let next = (at.table < tables.len()).then_some(at);
            return Ok((SnapshotPage { acquisitions, events, watermark, next, held }, Some(table_name.into())));
        }
    }
    Ok((SnapshotPage { acquisitions, events, watermark, next: None, held }, None))
}

