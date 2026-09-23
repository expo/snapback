//! The partition log (LLP 2000.000 §7): for every principal, the rows that
//! principal may read from every `sync`ed table, as a change log with one
//! watermark. `sync to T[.prefix]` is Snapback 2's `deliver` generalized:
//! the engine inverts the read rule into an audience it maintains.
//!
//! The log is keyed by group, not by recipient. A row of a table that syncs
//! to a target is logged once, under its group (`g:<table>:<group>`); a
//! principal's own partition (`p:<principal>`) carries the rows that name
//! it by column and the `join`/`scope` events of the groups it enters and
//! leaves; `public` carries what everyone holds. A device's stream is the
//! merge of its own partition, the public one, and every group it held
//! over the interval it held it; a `join` is expanded to the group's rows
//! when it is streamed. So a message costs one log row however many
//! members read it, and a membership costs one event however many rows it
//! grants. A device with no watermark takes a snapshot first.

use crate::engine::runner::Runner;
use crate::error::{MeterKind, RuntimeError};
#[cfg(feature = "sqlite")]
use crate::schema::Table;
use crate::schema::{Audience, AudienceBinding, Schema, Sync, audience_binding, row_image};
use crate::rows::{Bounds, Dir};
#[cfg(feature = "sqlite")]
use crate::store::LogEvent;
#[cfg(feature = "sqlite")]
mod storage;
#[cfg(feature = "sqlite")]
pub use storage::{LogSpan, PartitionRows};
use crate::value::{Value, canonical_json};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// The partition every principal also holds. Principal partitions carry a
/// tag (`p:<principal>`), so no principal's name can collide with it: a
/// membership granted to a principal literally named `public` delivers to
/// that principal alone.
pub const PUBLIC: &str = "public";

/// The partition name of one principal.
pub fn partition_of(principal: &str) -> String {
    format!("p:{principal}")
}

/// The partition of one group of a table that syncs to a target.
pub fn group_partition(table: &str, group: &[Value]) -> String {
    format!("g:{table}:{}", canonical_json(&group))
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Event {
    pub partition: String,
    pub table: String,
    pub kind: EventKind,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventKind {
    /// A row image the recipient may now hold.
    Put,
    /// A row the recipient no longer holds (deleted, or hidden from it).
    Del,
    /// A group (the audience prefix values, in `data`) the recipient left;
    /// the device applies the table's leave policy to every row in it.
    Scope,
    /// A group the recipient entered. Logged in the principal's partition,
    /// never streamed: the stream expands it to the group's rows.
    Join,
}

impl EventKind {
    pub fn word(self) -> &'static str {
        match self {
            Self::Put => "put",
            Self::Del => "del",
            Self::Scope => "scope",
            Self::Join => "join",
        }
    }
    pub fn parse(word: &str) -> Option<Self> {
        match word {
            "put" => Some(Self::Put),
            "del" => Some(Self::Del),
            "scope" => Some(Self::Scope),
            "join" => Some(Self::Join),
            _ => None,
        }
    }
}

/// The group a row belongs to under a sync declaration: the audience
/// prefix values (empty for a public partition). Callers supply `row_image`
/// under the row's table before extracting group fields.
pub fn group_of(sync: &Sync, row: &Value) -> Vec<Value> {
    match &sync.audience {
        Audience::Public => Vec::new(),
        Audience::Column(column) => vec![row.field(column).cloned().unwrap_or(Value::Null)],
        Audience::Target { prefix, .. } => prefix.iter().map(|column| row.field(column).cloned().unwrap_or(Value::Null)).collect(),
    }
}

/// The proved mapping behind a target audience: the read rule's probe index.
fn binding(schema: &Schema, content_name: &str, sync: &Sync) -> Option<AudienceBinding> {
    let content = schema.table(content_name)?;
    audience_binding(schema, content_name, content, sync).ok()
}

/// The partitions a row is logged to under `sync`: the public one, the
/// principal its column names, or its group's. Never a scan: a group's
/// members are found when the group is streamed, not when it is written.
pub fn partitions(table_name: &str, sync: &Sync, row: &Value) -> Vec<String> {
    match &sync.audience {
        Audience::Public => vec![PUBLIC.to_owned()],
        Audience::Column(column) => match row.field(column) {
            Ok(Value::Id(principal)) => vec![partition_of(principal)],
            _ => Vec::new(),
        },
        Audience::Target { .. } => {
            let group = group_of(sync, row);
            if group.iter().any(|value| *value == Value::Null) { Vec::new() } else { vec![group_partition(table_name, &group)] }
        }
    }
}

#[cfg(feature = "sqlite")]
mod log_events {
    use super::*;
    pub(super) fn put(events: &mut Vec<Event>, table: &str, id: &str, new: &Value, after: &BTreeSet<String>) {
        let image = new.clone();
        for partition in after {
            events.push(Event { partition: partition.clone(), table: table.to_owned(), kind: EventKind::Put, id: id.to_owned(), data: Some(image.clone()) });
        }
    }
    pub(super) fn del(events: &mut Vec<Event>, table: &str, id: &str, before: &BTreeSet<String>, after: &BTreeSet<String>) {
        for partition in before.difference(after) {
            events.push(Event { partition: partition.clone(), table: table.to_owned(), kind: EventKind::Del, id: id.to_owned(), data: None });
        }
    }
    pub(super) fn scope(events: &mut Vec<Event>, table: &str, partition: &str, group: &[Value]) {
        events.push(Event { partition: partition.to_owned(), table: table.to_owned(), kind: EventKind::Scope, id: canonical_json(&group), data: Some(Value::Array(group.to_vec())) });
    }
    pub(super) fn join(events: &mut Vec<Event>, table: &str, partition: &str, group: &[Value], expiry: Value) {
        events.push(Event { partition: partition.to_owned(), table: table.to_owned(), kind: EventKind::Join, id: canonical_json(&group), data: Some(crate::value::object([("expiresAt", expiry)])) });
    }
}

// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — logless devices retain partition accounting and refusals, but construct no events.
#[cfg(feature = "sqlite")]
pub fn row_changed(runner: &mut Runner<'_>, table_name: &str, old: Option<&Value>, new: Option<&Value>) -> Result<(), RuntimeError> {
    account_row_change::<true>(runner, table_name, old, new)
}

/// Every host pays the same partition work, including expired membership
/// scans. Only a log-bearing host constructs the corresponding events.
pub(crate) fn account_row_change<const LOG: bool>(runner: &mut Runner<'_>, table_name: &str, old: Option<&Value>, new: Option<&Value>) -> Result<(), RuntimeError> {
    let schema = runner.schema;
    let table = schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
    // @ref LLP 3000.007#18.3 — audience keys and lifetimes use the same interpreted image as rules and indexes.
    let old_image = old.map(|row| row_image(row, table));
    let new_image = new.map(|row| row_image(row, table));
    let old = old_image.as_deref();
    let new = new_image.as_deref();
    if let Some(sync) = &table.sync {
        let before: BTreeSet<String> = old.map(|old| partitions(table_name, sync, old)).unwrap_or_default().into_iter().collect();
        let after: BTreeSet<String> = new.map(|new| partitions(table_name, sync, new)).unwrap_or_default().into_iter().collect();
        let id = old.or(new).expect("a row change has an image").field("id")?.as_str()?;
        #[cfg(feature = "sqlite")]
        let id = if LOG { id.to_owned() } else { String::new() };
        #[cfg(not(feature = "sqlite"))]
        let _ = id;
        #[cfg(feature = "sqlite")]
        if LOG && let Some(new) = new {
            log_events::put(&mut runner.events, table_name, &id, new, &after);
        }
        #[cfg(feature = "sqlite")]
        if LOG {
            log_events::del(&mut runner.events, table_name, &id, &before, &after);
        }
        if schema.maintain_for(table_name).is_some() { runner.charge_maintain(MeterKind::Steps, (before.len() + after.len()) as u64)?; }
        else { runner.meter.charge(MeterKind::Steps, (before.len() + after.len()) as u64)?; }
    }
    // This table as the target of other tables' audiences.
    let dependents: Vec<(String, Sync)> = schema
        .synced()
        .filter_map(|(name, _, sync)| match &sync.audience {
            Audience::Target { table, .. } if table == table_name => Some((name.to_owned(), sync.clone())),
            _ => None,
        })
        .collect();
    if dependents.is_empty() {
        return Ok(());
    }
    let membership = |row: Option<&Value>, content_name: &str, sync: &Sync| -> Option<(String, Vec<Value>)> {
        let row = row?;
        let bound = binding(schema, content_name, sync)?;
        let Ok(Value::Id(p)) = row.field(&bound.principal) else { return None };
        let group: Vec<Value> = bound.columns.iter().map(|c| row.field(c).cloned().unwrap_or(Value::Null)).collect();
        if group.iter().any(|value| *value == Value::Null) {
            return None;
        }
        Some((partition_of(p), group))
    };
    for (content_name, sync) in dependents {
        let was = membership(old, &content_name, &sync);
        let is = membership(new, &content_name, &sync);
        let expiry = |row: Option<&Value>| table.expire.as_ref().and_then(|column| row.and_then(|row| row.field(column).ok())).cloned().unwrap_or(Value::Null);
        if was == is && expiry(old) == expiry(new) {
            continue;
        }
        // A grant that ends inside the commit that made it was never an
        // authority: a group's interval is `[join, leave)`, so the same
        // commit's join and scope deliver nothing.
        if let Some((partition, group)) = &was {
            // Sweeping an expired predecessor must not revoke the live
            // replacement admitted under the same logical unique key.
            let mut replaced = false;
            if old.is_some_and(|row| runner.context.now.is_some_and(|now| table.expired(row, now))) {
                let bound = binding(schema, &content_name, &sync).expect("validated audience");
                let mut key = group.clone();
                key.push(old.unwrap().field(&bound.principal)?.clone());
                let mut bounds = Bounds::default();
                loop {
                    let rows = runner.tx.scan(table_name, &bound.group_index, &key, &bounds, Dir::Asc, 32)?;
                    let count = rows.len();
                    for (candidate, stored) in rows {
                        let candidate = row_image(&candidate, table);
                        runner.meter.charge(MeterKind::Examined, 1)?;
                        bounds.after = crate::key::decode(&stored).map(|values| values.into_iter().skip(key.len()).collect());
                        if !runner.context.now.is_some_and(|now| table.expired(&candidate, now)) { replaced = true; break; }
                    }
                    if replaced || count < 32 { break; }
                }
            }
            // A live deadline renewal is a join transition without a
            // revocation. If the old lifetime already ended, catch-up inserts
            // its scope before that join; shortening to expiry still revokes.
            let renewed = was == is && new.is_some_and(|row| !runner.context.now.is_some_and(|now| table.expired(row, now)));
            #[cfg(not(feature = "sqlite"))]
            let _ = (partition, replaced, renewed);
            #[cfg(feature = "sqlite")]
            if LOG && !replaced && !renewed {
                log_events::scope(&mut runner.events, &content_name, partition, group);
            }
        }
        #[cfg(feature = "sqlite")]
        if LOG && let Some((partition, group)) = &is {
            log_events::join(&mut runner.events, &content_name, partition, group, expiry(new));
        }
        runner.meter.charge(MeterKind::Steps, 1)?;
    }
    Ok(())
}

/// The rows of one group within the horizon, newest first when a horizon
/// orders them, else in the group index's order.
#[cfg(feature = "sqlite")]
pub fn group_rows(tx: &dyn PartitionRows, table_name: &str, table: &Table, sync: &Sync, group: &[Value]) -> Result<Vec<Value>, RuntimeError> {
    Ok(group_rows_from(tx, table_name, table, sync, group, None, 0, usize::MAX, crate::now_ms(), None)?.0.into_iter().map(|(row, _)| row).collect())
}

/// The groups a principal holds right now under one target audience, as
/// their prefix values.
#[cfg(feature = "sqlite")]
fn groups_now(tx: &dyn PartitionRows, schema: &Schema, bound: &AudienceBinding, target: &str, principal: &str, now: i64) -> Result<Vec<Vec<Value>>, RuntimeError> {
    let mut groups = BTreeSet::new();
    for (member, _) in tx.scan(target, &bound.principal_index, &[Value::Id(principal.to_owned())], &Bounds::default(), Dir::Asc, u32::MAX as usize)? {
        let table = schema.table(target).expect("validated audience target");
        let member = row_image(&member, table);
        if table.expired(&member, now) { continue; }
        let group: Vec<Value> = bound.columns.iter().map(|c| member.field(c).cloned().unwrap_or(Value::Null)).collect();
        if !group.iter().any(|value| *value == Value::Null) {
            groups.insert(canonical_json(&group));
        }
    }
    Ok(groups.into_iter().map(|group| serde_json::from_str(&group).expect("canonical")).collect())
}

/// Where a paged snapshot continues: the synced table (by position in the
/// schema's order), the group in flight (its prefix, so a membership that
/// changes between pages resumes at the next group in order), the last
/// key's suffix inside it, how many of that group's rows went (against the
/// horizon), and the watermark the first page pinned. Opaque on the wire.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotCursor {
    pub table: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<Vec<Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<Vec<Value>>,
    #[serde(default)]
    pub taken: usize,
    pub watermark: u64,
}

impl SnapshotCursor {
    pub fn encode(&self) -> String {
        crate::cursor::base64url_encode(canonical_json(self).as_bytes())
    }

    pub fn decode(token: &str) -> Option<Self> {
        let bytes = crate::cursor::base64url_decode(token).ok()?;
        crate::json_codec::from_slice(&bytes).ok()
    }
}

/// One page of the snapshot: events, and where the next page starts
/// (`None` on the last).
pub struct SnapshotPage {
    pub acquisitions: Vec<crate::wire::Acquisition>,
    pub events: Vec<Event>,
    pub watermark: u64,
    pub next: Option<SnapshotCursor>,
    pub held: Option<crate::wire::HeldGroups>,
}

#[cfg(feature = "sqlite")]
fn snapshot_groups(tx: &dyn PartitionRows, schema: &Schema, table_name: &str, sync: &Sync, principal: &str, now: i64) -> Result<Vec<Vec<Value>>, RuntimeError> {
    Ok(match &sync.audience {
        Audience::Public => vec![Vec::new()],
        Audience::Column(_) => vec![vec![Value::Id(principal.to_owned())]],
        Audience::Target { table: target, .. } => {
            let bound = binding(schema, table_name, sync).ok_or_else(|| RuntimeError::Schema(format!("sync to {target} has no audience index")))?;
            groups_now(tx, schema, &bound, target, principal, now)?
        }
    })
}

/// Everything a principal holds right now, one page at a time: the
/// snapshot a device applies before it follows the log from the watermark
/// the first page pinned. Each page is its own transaction, so the engine
/// is free between pages and a device never holds more than a page in
/// memory; a row that changes between pages reaches the device again
/// through the log, idempotently, and a group joined or left between pages
/// reaches it as the log's join or scope.
#[cfg(feature = "sqlite")]
pub fn snapshot_page(tx: &dyn PartitionRows, schema: &Schema, principal: &str, cursor: Option<SnapshotCursor>, limit: usize, now: i64) -> Result<SnapshotPage, RuntimeError> {
    let watermark = match &cursor {
        Some(cursor) => cursor.watermark,
        None => tx.next_seq()? - 1,
    };
    // @ref LLP 3000.007#18.2 — the first page names only this viewer's audience prefixes; held groups replace, left groups retain.
    let held = if cursor.is_none() {
        let mut held = crate::wire::HeldGroups::new();
        for (name, _, sync) in schema.synced().filter(|(_, table, _)| table.leave == crate::schema::LeavePolicy::DeliveredHistory) {
            held.insert(name.to_owned(), snapshot_groups(tx, schema, name, sync, principal, now)?.iter().map(|group| group.iter().map(crate::wire::to_json).collect()).collect());
        }
        Some(held)
    } else { None };
    let mut acquisitions = Vec::new();
    let mut at = cursor.unwrap_or(SnapshotCursor { watermark, ..SnapshotCursor::default() });
    let tables: Vec<(&str, &Table, &Sync)> = schema.synced().collect();
    let mut events = Vec::new();
    let limit = limit.max(1);
    let mut used = 0;
    while at.table < tables.len() {
        let (table_name, table, sync) = tables[at.table];
        let groups = snapshot_groups(tx, schema, table_name, sync, principal, now)?;
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
                return Ok(SnapshotPage { acquisitions, events, watermark, next: Some(at), held });
            }
            if at.taken == 0 && at.after.is_none() {
                if let Some(horizon) = &sync.horizon {
                    acquisitions.push(acquisition(table_name, &horizon.by, group, events.len(), None));
                }
            }
            let (rows, exhausted) = group_rows_from(tx, table_name, table, sync, group, at.after.as_deref(), at.taken, room, now, Some((schema, principal)))?;
            // Empty groups still emit transitions and must consume page room.
            used += rows.len().max(1);
            for (row, key) in rows {
                let id = row.field("id")?.as_str()?.to_owned();
                at.after = crate::key::decode(&key).map(|values| values.into_iter().skip(group.len()).collect());
                at.taken += 1;
                let partition = match &sync.audience {
                    Audience::Public => PUBLIC.to_owned(),
                    Audience::Column(_) => partition_of(principal),
                    Audience::Target { .. } => group_partition(table_name, group),
                };
                events.push(Event { partition, table: table_name.to_owned(), kind: EventKind::Put, id, data: Some(row) });
            }
            if !exhausted {
                at.group = Some(group.clone());
                return Ok(SnapshotPage { acquisitions, events, watermark, next: Some(at), held });
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
        at.table += 1;
        at.group = None;
    }
    Ok(SnapshotPage { acquisitions, events, watermark, next: None, held })
}

/// The whole snapshot at once, for hosts that hold it (the simulator's
/// device, tests); a real device pages it.
#[cfg(feature = "sqlite")]
pub fn snapshot(tx: &dyn PartitionRows, schema: &Schema, principal: &str, now: i64) -> Result<Vec<Event>, RuntimeError> {
    let mut events = Vec::new();
    let mut cursor = None;
    loop {
        let page = snapshot_page(tx, schema, principal, cursor, 10_000, now)?;
        events.extend(page.events);
        match page.next {
            Some(next) => cursor = Some(next),
            None => return Ok(events),
        }
    }
}

/// A group's rows from a position: at most `room`, never past the horizon
/// counting the `taken` rows already delivered. Returns the rows with their
/// keys and whether the group is done.
#[cfg(feature = "sqlite")]
fn group_rows_from(tx: &dyn PartitionRows, table_name: &str, table: &Table, sync: &Sync, group: &[Value], after: Option<&[Value]>, taken: usize, room: usize, now: i64, viewer: Option<(&Schema, &str)>) -> Result<(Vec<(Value, Vec<u8>)>, bool), RuntimeError> {
    let (index_name, remaining, dir) = match &sync.horizon {
        Some(horizon) => (horizon.by.clone(), (horizon.last as usize).saturating_sub(taken), Dir::Desc),
        None => (audience_index(table_name, table, sync)?, usize::MAX, Dir::Desc),
    };
    let ask = remaining.min(room);
    if ask == 0 {
        return Ok((Vec::new(), true));
    }
    let mut bounds = Bounds { after: after.map(<[Value]>::to_vec), ..Bounds::default() };
    let mut live = Vec::new();
    let mut exhausted = false;
    let mut reader = viewer.map(|(schema, principal)| Runner::new(tx, schema, crate::Context::new(principal, BTreeMap::new()).at(now), crate::meter::Meter::new(crate::meter::Ceilings::unbounded(), crate::meter::Cut::Abort), 0));
    let mut aggregate = viewer.map(|(schema, _)| Runner::new(tx, schema, crate::Context::system().at(now), crate::meter::Meter::new(crate::meter::Ceilings::unbounded(), crate::meter::Cut::Cap), 0));
    // One extra readable row decides pagination, never selection past N.
    let target = remaining.min(room.saturating_add(1));
    loop {
        let batch = target.saturating_sub(live.len()).min(256).max(1);
        let rows = tx.scan(table_name, &index_name, group, &bounds, dir, batch)?;
        let count = rows.len();
        for (row, key) in rows {
            let mut row = row_image(&row, table).into_owned();
            bounds.after = crate::key::decode(&key).map(|values| values.into_iter().skip(group.len()).collect());
            if table.expired(&row, now) { continue; }
            if let Some(runner) = &mut aggregate {
                let Some(live_row) = runner.live_aggregate(table_name, row)? else { continue; };
                row = live_row;
            }
            if let Some(reader) = &mut reader {
                if !reader.check_rule(table_name, crate::schema::Effect::Read, None, &row)? { continue; }
            }
            live.push((row, key));
            if live.len() == target { break; }
        }
        if live.len() == target { break; }
        if count < batch { exhausted = true; break; }
    }
    live.truncate(ask);
    exhausted |= sync.horizon.as_ref().is_some_and(|horizon| taken + live.len() >= horizon.last as usize);
    Ok((live, exhausted))
}

/// The index a horizonless audience walks: the first leading with the
/// audience's columns.
#[cfg(feature = "sqlite")]
fn audience_index(table_name: &str, table: &Table, sync: &Sync) -> Result<String, RuntimeError> {
    let group_columns: Vec<String> = match &sync.audience {
        Audience::Public => Vec::new(),
        Audience::Column(column) => vec![column.clone()],
        Audience::Target { prefix, .. } => prefix.clone(),
    };
    table.indexes.iter().find(|(_, index)| index.is_plain() && index.columns().starts_with(&group_columns)).map(|(name, _)| name.clone()).ok_or_else(|| RuntimeError::Schema(format!("{table_name} has no index leading with {}", group_columns.join(", "))))
}

/// Append a commit's events to the log. A row's events within one commit
/// coalesce to the last (a put then a delete logs the delete alone, so an
/// image that did not survive the commit never crosses the wire); joins
/// and scopes keep their place.
#[cfg(feature = "sqlite")]
pub fn append(tx: &dyn PartitionRows, seq: u64, events: &[Event]) -> Result<(), RuntimeError> {
    let mut last: BTreeMap<(&str, &str, &str), usize> = BTreeMap::new();
    for (position, event) in events.iter().enumerate() {
        if matches!(event.kind, EventKind::Put | EventKind::Del) {
            last.insert((&event.partition, &event.table, &event.id), position);
        }
    }
    let kept = events.iter().enumerate().filter(|(position, event)| !matches!(event.kind, EventKind::Put | EventKind::Del) || last.get(&(event.partition.as_str(), event.table.as_str(), event.id.as_str())) == Some(position));
    for (ord, (_, event)) in kept.enumerate() {
        let data = event.data.as_ref().map(canonical_json);
        tx.append_log(&event.partition, seq, ord as u32, &event.table, event.kind.word(), &event.id, data.as_deref())?;
    }
    Ok(())
}

#[cfg(feature = "sqlite")]
/// A page of the stream a device follows: the principal's own partition,
/// the public one, and the groups it holds, merged by sequence, after
/// `watermark`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamPage {
    #[serde(default)]
    pub images_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub acquisitions: Vec<crate::wire::Acquisition>,
    pub events: Vec<LogEvent>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub joined: crate::wire::HeldGroups,
    /// The watermark after applying `events`.
    pub watermark: u64,
    /// Whether more events wait past `watermark`.
    pub more: bool,
}

#[cfg(feature = "sqlite")]
/// One group's membership over the window. Log reads use `[from, to.seq)`;
/// join identity also includes its ordinal. The watermark predecessor has
/// no opening join (`from_ord: None`) and may only precede a real join.
#[derive(Clone, Debug)]
struct Interval {
    from: u64,
    from_ord: Option<u32>,
    to: Option<(u64, u32)>,
    expires_at: Option<i64>,
    ends_in_join: bool,
}

/// The groups a principal held during `(watermark, now]`, per content
/// table, from its memberships now and the joins and scopes logged since.
#[cfg(feature = "sqlite")]
fn intervals(tx: &dyn PartitionRows, schema: &Schema, principal: &str, watermark: u64) -> Result<BTreeMap<(String, String), Vec<Interval>>, RuntimeError> {
    // Physical memberships provide the initial state for databases whose old
    // ledger predates expiry metadata. Logical expiry still bounds every span.
    let mut current = BTreeMap::new();
    for (table_name, _, sync) in schema.synced() {
        let Audience::Target { table: target, .. } = &sync.audience else { continue };
        let bound = binding(schema, table_name, sync).ok_or_else(|| RuntimeError::Schema(format!("sync to {target} has no audience index")))?;
        for (member, _) in tx.scan(target, &bound.principal_index, &[Value::Id(principal.to_owned())], &Bounds::default(), Dir::Asc, usize::MAX)? {
            let member = row_image(&member, schema.table(target).expect("validated audience target"));
            let group: Vec<Value> = bound.columns.iter().map(|c| member.field(c).cloned().unwrap_or(Value::Null)).collect();
            if group.contains(&Value::Null) { continue; }
            let expiry = schema.table(target).and_then(|table| table.expire.as_ref()).and_then(|column| member.field(column).ok()).and_then(|value| value.as_int().ok());
            current.entry((table_name.to_owned(), canonical_json(&group))).and_modify(|held: &mut Option<i64>| {
                *held = match (*held, expiry) { (Some(a), Some(b)) => Some(a.max(b)), _ => None };
            }).or_insert(expiry);
        }
    }
    // @ref LLP 3000#7 — a content page cannot establish authority from a truncated ledger.
    let previous: BTreeMap<_, _> = tx.memberships_before(&partition_of(principal), watermark)?.into_iter().map(|event| ((event.table.clone(), event.id.clone()), event)).collect();
    let mut transitions: BTreeMap<(String, String), Vec<LogEvent>> = BTreeMap::new();
    for event in tx.membership_transitions(&partition_of(principal), watermark)? {
        transitions.entry((event.table.clone(), event.id.clone())).or_default().push(event);
    }
    let keys: BTreeSet<_> = current.keys().chain(transitions.keys()).cloned().collect();
    let mut out = BTreeMap::new();
    for key in keys {
        let expiring = schema.table(&key.0).and_then(|table| table.sync.as_ref()).and_then(|sync| match &sync.audience { Audience::Target { table, .. } => schema.table(table), _ => None }).is_some_and(|table| table.expire.is_some());
        // A legacy grant without its lifetime or surviving membership cannot
        // authorize historical reads of an expiring audience. Fail closed.
        let fallback_expiry = || expiring.then_some(i64::MIN);
        let expiry = |event: &LogEvent| event.data.as_ref().and_then(|data| data.field("expiresAt").ok()).map(|value| value.as_int().ok()).unwrap_or_else(fallback_expiry);
        let steps = transitions.get(&key).map(Vec::as_slice).unwrap_or_default();
        let held_at_watermark = previous.get(&key).map_or_else(
            || steps.first().map_or_else(|| current.contains_key(&key), |event| event.kind == "scope"),
            |event| event.kind == "join");
        let initial_expiry = if steps.is_empty() { current.get(&key).copied().flatten() } else { previous.get(&key).map(&expiry).unwrap_or_else(fallback_expiry) };
        let mut open = held_at_watermark.then_some(Interval { from: watermark.saturating_add(1), from_ord: None, to: None, expires_at: initial_expiry, ends_in_join: false });
        let mut spans = Vec::new();
        for event in steps {
            match event.kind.as_str() {
                "join" => {
                    // A new live row may replace an expired grant before
                    // the old row is swept. Each join owns its own lifetime.
                    if let Some(mut prior) = open.take() {
                        prior.to = Some((event.seq, event.ord));
                        prior.ends_in_join = true;
                        spans.push(prior);
                    }
                    open = Some(Interval { from: event.seq, from_ord: Some(event.ord), to: None, expires_at: expiry(event), ends_in_join: false });
                }
                "scope" => {
                    if let Some(mut prior) = open.take() {
                        prior.to = Some((event.seq, event.ord));
                        spans.push(prior);
                    }
                }
                _ => {}
            }
        }
        if let Some(open) = open { spans.push(open); }
        if !spans.is_empty() { out.insert(key, spans); }
    }
    Ok(out)
}

#[cfg(feature = "sqlite")]
pub fn stream(tx: &dyn PartitionRows, schema: &Schema, principal: &str, watermark: u64, limit: usize, now: i64) -> Result<StreamPage, RuntimeError> {
    let limit = limit.max(1);
    let head = tx.next_seq()?.saturating_sub(1);
    let expiring_audience = schema.synced().any(|(_, _, sync)| match &sync.audience {
        Audience::Target { table, .. } => schema.table(table).is_some_and(|target| target.expire.is_some()),
        _ => false,
    });
    // A cursor from a replaced database is not evidence that this store reached it.
    if watermark > head || (watermark == head && !expiring_audience) { return Ok(StreamPage { images_at: Some(head), acquisitions: Vec::new(), events: Vec::new(), watermark: head, more: false, joined: BTreeMap::new() }); }
    let held = intervals(tx, schema, principal, watermark)?;
    let mut spans = vec![(partition_of(principal), watermark.saturating_add(1), None, None), (PUBLIC.to_owned(), watermark.saturating_add(1), None, None)];
    for ((table, group), intervals) in &held {
        let group: Vec<Value> = serde_json::from_str(group).map_err(|e| RuntimeError::Store(e.to_string()))?;
        for interval in intervals {
            if interval.to.is_none_or(|(seq, _)| seq > interval.from) {
                spans.push((group_partition(table, &group), interval.from, interval.to.map(|(seq, _)| seq), interval.expires_at));
            }
        }
    }
    let mut page = tx.read_log_spans(&spans, watermark, None, limit.saturating_add(1))?;
    if page.len() > limit {
        let cut = page[limit].seq;
        if page[0].seq == cut {
            // Commits are indivisible, including their revocations.
            page = tx.read_log_spans(&spans, watermark, Some(cut), usize::MAX)?;
        } else {
            page.retain(|event| event.seq < cut);
        }
    }
    let mut next = page.last().map_or(watermark, |event| event.seq);
    let more = !tx.read_log_spans(&spans, next, None, 1)?.is_empty();
    let (mut events, acquisitions, joined) = expand_joins(tx, schema, principal, page, &held, now)?;
    if !more {
        next = next.max(head);
        // Logical expiry is a revocation even before the physical sweep
        // logs a scope. Append it after catch-up so retention sees the last
        // authorized image and until-revoked rows leave the replica.
        for ((table, group), spans) in &held {
            if spans.last().is_some_and(|span| span.to.is_none() && span.expires_at.is_some_and(|at| at <= now)) {
                let group_values: Vec<Value> = serde_json::from_str(group).map_err(|e| RuntimeError::Store(e.to_string()))?;
                let event = LogEvent { seq: next, ord: u32::MAX, table: table.clone(), kind: "scope".into(), id: group.clone(), data: Some(Value::Array(group_values)) };
                events.push(event);
            }
        }
    }
    Ok(StreamPage { images_at: Some(head), acquisitions, events, watermark: next, more, joined })
}

#[cfg(feature = "sqlite")]
fn continuous_renewal(span: &Interval, seq: u64, ord: u32, commit_times: &BTreeMap<u64, i64>) -> bool {
    span.ends_in_join && span.to == Some((seq, ord))
        && span.expires_at.is_none_or(|expiry| commit_times.get(&seq).is_some_and(|at| *at < expiry))
}

// @ref LLP 3000.007#18.2 — match renewal edges by (seq, ord): even a zero-width grant span preserves its acquisition through continuous renewals.
#[cfg(feature = "sqlite")]
fn live_join_chain(spans: &[Interval], start: usize, commit_times: &BTreeMap<u64, i64>, now: i64) -> bool {
    let mut span = &spans[start];
    for next in &spans[start + 1..] {
        if !next.from_ord.is_some_and(|ord| continuous_renewal(span, next.from, ord, commit_times)) { return false; }
        span = next;
    }
    span.to.is_none() && span.expires_at.is_none_or(|expiry| expiry > now)
}

/// Only a currently open, acquiring membership chain expands content. A closed interval
/// acquires nothing, including for publicly readable retained-history tables.
/// Membership intervals remain join-time; joins never reach a device.
#[cfg(feature = "sqlite")]
fn expand_joins(tx: &dyn PartitionRows, schema: &Schema, principal: &str, page: Vec<LogEvent>, held: &BTreeMap<(String, String), Vec<Interval>>, now: i64) -> Result<(Vec<LogEvent>, Vec<crate::wire::Acquisition>, crate::wire::HeldGroups), RuntimeError> {
    let mut acquisitions = Vec::new();
    let mut joined = crate::wire::HeldGroups::new();
    // The next renewal may be on a later raw-log page. Read every edge time
    // for the groups whose joins this page serves, in one storage call.
    let sequences: BTreeSet<_> = page.iter().filter(|event| event.kind == "join").flat_map(|event| {
        std::iter::once(event.seq).chain(held.get(&(event.table.clone(), event.id.clone())).into_iter().flatten()
            .filter(|span| span.ends_in_join).filter_map(|span| span.to.map(|(seq, _)| seq)))
    }).collect();
    let commit_times = tx.commit_times(&sequences.into_iter().collect::<Vec<_>>())?;
    let mut out = Vec::with_capacity(page.len());
    // @ref LLP 3000#7-decisions-during-execution — retained history is device-held; the server serves current readable images.
    // Normalize ordinary puts before delivery. Join selection already checks
    // its images: never re-fetch them or probe their read rule a second time.
    let mut reader = Runner::new(tx, schema, crate::Context::new(principal, BTreeMap::new()).at(now),
        crate::meter::Meter::new(crate::meter::Ceilings::unbounded(), crate::meter::Cut::Abort), 0);
    for mut event in page {
        if event.kind != "join" {
            if event.kind == "put" {
                event.data = if schema.table(&event.table).is_some() { reader.fetch(&event.table, &event.id)? } else { None };
                if let Some(row) = &event.data {
                    if !reader.check_rule(&event.table, crate::schema::Effect::Read, None, row)? { continue; }
                } else { event.kind = "del".into(); }
            }
            out.push(event);
            continue;
        }
        let Some(spans) = held.get(&(event.table.clone(), event.id.clone())) else { continue };
        let Some(start) = spans.iter().position(|span| span.from == event.seq && span.from_ord == Some(event.ord)) else { continue };
        if !live_join_chain(spans, start, &commit_times, now) { continue; }
        let Some(table) = schema.table(&event.table) else { continue };
        let Some(sync) = &table.sync else { continue };
        let group: Vec<Value> = serde_json::from_str(&event.id).map_err(|e| RuntimeError::Store(e.to_string()))?;
        // A catch-up spanning an expired grant and its replacement must
        // retire the old until-revoked image before acquiring the new one.
        // A continuous live renewal keeps its already acquired horizon.
        let predecessor = start.checked_sub(1).map(|i| &spans[i]).filter(|span| span.to == Some((event.seq, event.ord)));
        let expired_predecessor = predecessor.is_some_and(|span| span.ends_in_join
            && span.expires_at.is_some_and(|expiry| commit_times.get(&event.seq).is_some_and(|at| *at >= expiry)));
        if expired_predecessor {
            let scope = LogEvent { seq: event.seq, ord: event.ord, table: event.table.clone(), kind: "scope".into(), id: event.id.clone(), data: Some(Value::Array(group.clone())) };
            out.push(scope);
        }
        let continuous = predecessor.is_some_and(|span| continuous_renewal(span, event.seq, event.ord, &commit_times));
        if continuous { continue; }
        // `joined` certifies this acquisition, including an empty one. A live
        // renewal preserves its predecessor's coverage on every page boundary.
        if table.leave == crate::schema::LeavePolicy::DeliveredHistory {
            joined.entry(event.table.clone()).or_default().push(group.iter().map(crate::wire::to_json).collect());
        }
        // @ref LLP 3000.007#18.2 — ruling 36: an acquisition selects the current readable rows at serve time; the boundary is the Nth delivered key by construction.
        if let Some(horizon) = &sync.horizon {
            acquisitions.push(acquisition(&event.table, &horizon.by, &group, out.len(), None));
        }
        let (rows, _) = group_rows_from(tx, &event.table, table, sync, &group, None, 0, usize::MAX, now, Some((schema, principal)))?;
        let floor = sync.horizon.as_ref().map(|horizon| {
            if rows.len() < horizon.last as usize { "whole".into() }
            else { crate::value::encode_bytes_hex(&rows.last().expect("selected horizon has a last key").1) }
        });
        for (row, _) in rows {
            let id = row.field("id")?.as_str()?.to_owned();
            let image = LogEvent { seq: event.seq, ord: event.ord, table: event.table.clone(), kind: "put".into(), id, data: Some(row) };
            out.push(image);
        }
        if let Some(horizon) = &sync.horizon {
            acquisitions.push(acquisition(&event.table, &horizon.by, &group, out.len(), floor));
        }
    }
    Ok((out, acquisitions, joined))
}

#[cfg(feature = "sqlite")]
fn acquisition(table: &str, index: &str, group: &[Value], at: usize, floor: Option<String>) -> crate::wire::Acquisition {
    crate::wire::Acquisition { at, table: table.into(), index: index.into(), group: group.iter().map(crate::wire::to_json).collect(), floor }
}

/// What one principal holds, grouped by table, for tests and `why`.
pub fn holdings(events: &[Event]) -> BTreeMap<String, BTreeSet<String>> {
    let mut out: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for event in events {
        match event.kind {
            EventKind::Put => {
                out.entry(event.table.clone()).or_default().insert(event.id.clone());
            }
            EventKind::Del => {
                out.entry(event.table.clone()).or_default().remove(&event.id);
            }
            EventKind::Scope | EventKind::Join => {}
        }
    }
    out
}
