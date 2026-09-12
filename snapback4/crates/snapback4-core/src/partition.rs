//! The partition log (LLP 2000.000 §7): for every principal, the rows that
//! principal may read from every `sync`ed table, as a change log with one
//! watermark. `sync to T[.prefix]` is Snapback 2's `deliver` generalized:
//! the engine inverts the read rule into an audience it maintains. A row
//! change fans out one event per recipient; a target row (a membership)
//! appearing or disappearing bootstraps or tombstones a whole group for one
//! recipient. A device with no watermark takes a snapshot first.

use crate::engine::runner::Runner;
use crate::error::{MeterKind, RuntimeError};
use crate::schema::{Audience, Schema, Sync, Table, materialize_optional_fields, target_prefix_columns};
use crate::store::{Bounds, Dir, LogEvent, Tx};
use crate::value::{Value, canonical_json};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// The partition every principal also holds.
pub const PUBLIC: &str = "public";

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
}

impl EventKind {
    pub fn word(self) -> &'static str {
        match self {
            Self::Put => "put",
            Self::Del => "del",
            Self::Scope => "scope",
        }
    }
    pub fn parse(word: &str) -> Option<Self> {
        match word {
            "put" => Some(Self::Put),
            "del" => Some(Self::Del),
            "scope" => Some(Self::Scope),
            _ => None,
        }
    }
}

/// The group a row belongs to under a sync declaration: the audience
/// prefix values (empty for a public partition).
pub fn group_of(sync: &Sync, row: &Value) -> Vec<Value> {
    match &sync.audience {
        Audience::Public => Vec::new(),
        Audience::Column(column) => vec![row.field(column).cloned().unwrap_or(Value::Null)],
        Audience::Target { prefix, .. } => prefix.iter().map(|column| row.field(column).cloned().unwrap_or(Value::Null)).collect(),
    }
}

/// The index of the target table that lists a group's principals, and the
/// index that lists a principal's groups.
fn target_indexes(schema: &Schema, content_name: &str, target_name: &str, prefix: &[String], principal: &str) -> Option<(String, Vec<String>, String)> {
    let target = schema.table(target_name)?;
    let content = schema.table(content_name)?;
    let columns = target_prefix_columns(content_name, content, target, prefix, principal)?;
    let mut by_group = columns.clone();
    by_group.push(principal.to_owned());
    let group_index = target.indexes.iter().find(|(_, index)| index.columns() == by_group)?.0.clone();
    let mut by_principal = vec![principal.to_owned()];
    by_principal.extend(columns.iter().cloned());
    let principal_index = target.indexes.iter().find(|(_, index)| index.columns().starts_with(&by_principal))?.0.clone();
    Some((group_index, columns, principal_index))
}

/// The principals that hold `row` under `sync`, as partition names.
pub fn audience(tx: &Tx<'_>, schema: &Schema, content_name: &str, sync: &Sync, row: &Value) -> Result<Vec<String>, RuntimeError> {
    Ok(match &sync.audience {
        Audience::Public => vec![PUBLIC.to_owned()],
        Audience::Column(column) => match row.field(column) {
            Ok(Value::Id(principal)) => vec![principal.clone()],
            _ => Vec::new(),
        },
        Audience::Target { table, prefix, principal } => {
            let (group_index, _, _) = target_indexes(schema, content_name, table, prefix, principal).ok_or_else(|| RuntimeError::Schema(format!("sync to {table} has no audience index")))?;
            let group = group_of(sync, row);
            if group.iter().any(|value| *value == Value::Null) {
                return Ok(Vec::new());
            }
            let mut out = BTreeSet::new();
            for (member, _) in tx.scan(table, &group_index, &group, &Bounds::default(), Dir::Asc, u32::MAX as usize)? {
                if let Ok(Value::Id(p)) = member.field(principal) {
                    out.insert(p.clone());
                }
            }
            out.into_iter().collect()
        }
    })
}

/// Called for every physical row change. Produces the events of the row's
/// own sync, then the bootstrap and scope events of every table that syncs
/// to this table as a target.
pub fn row_changed(runner: &mut Runner<'_>, table_name: &str, old: Option<&Value>, new: Option<&Value>) -> Result<(), RuntimeError> {
    let schema = runner.schema;
    let table = schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
    if let Some(sync) = &table.sync {
        let before: BTreeSet<String> = match old {
            Some(old) => audience(runner.tx, schema, table_name, sync, old)?.into_iter().collect(),
            None => BTreeSet::new(),
        };
        let after: BTreeSet<String> = match new {
            Some(new) => audience(runner.tx, schema, table_name, sync, new)?.into_iter().collect(),
            None => BTreeSet::new(),
        };
        let id = old.or(new).expect("a row change has an image").field("id")?.as_str()?.to_owned();
        if let Some(new) = new {
            let mut image = new.clone();
            materialize_optional_fields(&mut image, table);
            for partition in &after {
                runner.events.push(Event { partition: partition.clone(), table: table_name.to_owned(), kind: EventKind::Put, id: id.clone(), data: Some(image.clone()) });
            }
        }
        for partition in before.difference(&after) {
            runner.events.push(Event { partition: partition.clone(), table: table_name.to_owned(), kind: EventKind::Del, id: id.clone(), data: None });
        }
        runner.meter.charge(MeterKind::Steps, (before.len() + after.len()) as u64)?;
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
        let Audience::Target { table: target, prefix, principal } = &sync.audience else { return None };
        let (_, columns, _) = target_indexes(schema, content_name, target, prefix, principal)?;
        let Ok(Value::Id(p)) = row.field(principal) else { return None };
        let group: Vec<Value> = columns.iter().map(|c| row.field(c).cloned().unwrap_or(Value::Null)).collect();
        if group.iter().any(|value| *value == Value::Null) {
            return None;
        }
        Some((p.clone(), group))
    };
    for (content_name, sync) in dependents {
        let was = membership(old, &content_name, &sync);
        let is = membership(new, &content_name, &sync);
        if was == is {
            continue;
        }
        if let Some((principal, group)) = &was {
            runner.events.push(Event { partition: principal.clone(), table: content_name.clone(), kind: EventKind::Scope, id: canonical_json(group), data: Some(Value::Array(group.clone())) });
        }
        if let Some((principal, group)) = &is {
            let content = schema.table(&content_name).expect("synced table");
            let rows = group_rows(runner.tx, &content_name, content, &sync, group)?;
            runner.meter.charge(MeterKind::Examined, rows.len() as u64)?;
            for row in rows {
                let id = row.field("id")?.as_str()?.to_owned();
                runner.events.push(Event { partition: principal.clone(), table: content_name.clone(), kind: EventKind::Put, id, data: Some(row) });
            }
        }
    }
    Ok(())
}

/// The rows of one group within the horizon, newest first when a horizon
/// orders them, else in the group index's order.
pub fn group_rows(tx: &Tx<'_>, table_name: &str, table: &Table, sync: &Sync, group: &[Value]) -> Result<Vec<Value>, RuntimeError> {
    let (index_name, limit, dir) = match &sync.horizon {
        Some(horizon) => (horizon.by.clone(), horizon.last as usize, Dir::Desc),
        None => {
            let group_columns: Vec<String> = match &sync.audience {
                Audience::Public => Vec::new(),
                Audience::Column(column) => vec![column.clone()],
                Audience::Target { prefix, .. } => prefix.clone(),
            };
            let index = table.indexes.iter().find(|(_, index)| index.columns().starts_with(&group_columns)).map(|(name, _)| name.clone()).ok_or_else(|| RuntimeError::Schema(format!("{table_name} has no index leading with {}", group_columns.join(", "))))?;
            (index, u32::MAX as usize, Dir::Asc)
        }
    };
    let rows = tx.scan(table_name, &index_name, group, &Bounds::default(), dir, limit)?;
    Ok(rows
        .into_iter()
        .map(|(mut row, _)| {
            materialize_optional_fields(&mut row, table);
            row
        })
        .collect())
}

/// Everything a principal holds right now: the snapshot a device applies
/// before it follows the log from the returned watermark.
pub fn snapshot(tx: &Tx<'_>, schema: &Schema, principal: &str) -> Result<Vec<Event>, RuntimeError> {
    let mut events = Vec::new();
    for (table_name, table, sync) in schema.synced() {
        match &sync.audience {
            Audience::Public => {
                for row in group_rows(tx, table_name, table, sync, &[])? {
                    let id = row.field("id")?.as_str()?.to_owned();
                    events.push(Event { partition: PUBLIC.to_owned(), table: table_name.to_owned(), kind: EventKind::Put, id, data: Some(row) });
                }
            }
            Audience::Column(_) => {
                for row in group_rows(tx, table_name, table, sync, &[Value::Id(principal.to_owned())])? {
                    let id = row.field("id")?.as_str()?.to_owned();
                    events.push(Event { partition: principal.to_owned(), table: table_name.to_owned(), kind: EventKind::Put, id, data: Some(row) });
                }
            }
            Audience::Target { table: target, prefix, principal: principal_column } => {
                let (_, columns, principal_index) = target_indexes(schema, table_name, target, prefix, principal_column).ok_or_else(|| RuntimeError::Schema(format!("sync to {target} has no audience index")))?;
                let mut groups = BTreeSet::new();
                for (member, _) in tx.scan(target, &principal_index, &[Value::Id(principal.to_owned())], &Bounds::default(), Dir::Asc, u32::MAX as usize)? {
                    let group: Vec<Value> = columns.iter().map(|c| member.field(c).cloned().unwrap_or(Value::Null)).collect();
                    if !group.iter().any(|value| *value == Value::Null) {
                        groups.insert(canonical_json(&group));
                    }
                }
                for group in groups {
                    let group: Vec<Value> = serde_json::from_str(&group).expect("canonical");
                    for row in group_rows(tx, table_name, table, sync, &group)? {
                        let id = row.field("id")?.as_str()?.to_owned();
                        events.push(Event { partition: principal.to_owned(), table: table_name.to_owned(), kind: EventKind::Put, id, data: Some(row) });
                    }
                }
            }
        }
    }
    Ok(events)
}

/// Append a commit's events to the log.
pub fn append(tx: &Tx<'_>, seq: u64, events: &[Event]) -> Result<(), RuntimeError> {
    for (ord, event) in events.iter().enumerate() {
        let data = event.data.as_ref().map(canonical_json);
        tx.append_log(&event.partition, seq, ord as u32, &event.table, event.kind.word(), &event.id, data.as_deref())?;
    }
    Ok(())
}

/// A page of the stream a device follows: the principal's own partition
/// and the public one, merged by sequence, after `watermark`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamPage {
    pub events: Vec<LogEvent>,
    /// The watermark after applying `events`.
    pub watermark: u64,
    /// Whether more events wait past `watermark`.
    pub more: bool,
}

pub fn stream(tx: &Tx<'_>, principal: &str, watermark: u64, limit: usize) -> Result<StreamPage, RuntimeError> {
    let mut own = tx.read_log(principal, watermark, limit + 1)?;
    let mut public = tx.read_log(PUBLIC, watermark, limit + 1)?;
    own.append(&mut public);
    own.sort_by_key(|event| (event.seq, event.ord));
    let more = own.len() > limit;
    own.truncate(limit);
    // Never split one commit's events across pages: a page ends on a seq boundary.
    if more {
        let last_seq = own.last().map(|e| e.seq).unwrap_or(watermark);
        let complete_seq = own.iter().rev().find(|e| e.seq < last_seq).map(|e| e.seq);
        if let Some(complete) = complete_seq {
            own.retain(|e| e.seq <= complete);
        }
    }
    let next = own.last().map(|e| e.seq).unwrap_or(watermark);
    Ok(StreamPage { events: own, watermark: next, more })
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
            EventKind::Scope => {}
        }
    }
    out
}
