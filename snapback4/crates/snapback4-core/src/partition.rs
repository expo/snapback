//! The partition log (LLP 2000.000 §7): for every principal, the rows that
//! principal may read from every `sync`ed table, as a change log with one
//! watermark. `sync to T[.prefix]` is Snapback 2's `deliver` generalized:
//! the engine inverts the read rule into an audience it maintains. A row
//! change fans out one event per recipient; a target row (a membership)
//! appearing or disappearing bootstraps or tombstones a whole group for one
//! recipient. A device with no watermark takes a snapshot first.

use crate::engine::runner::Runner;
use crate::error::{MeterKind, RuntimeError};
use crate::schema::{Audience, AudienceBinding, Schema, Sync, Table, audience_binding, materialize_optional_fields};
use crate::store::{Bounds, Dir, LogEvent, Tx};
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

/// The proved mapping behind a target audience: the read rule's probe index.
fn binding(schema: &Schema, content_name: &str, sync: &Sync) -> Option<AudienceBinding> {
    let content = schema.table(content_name)?;
    audience_binding(schema, content_name, content, sync).ok()
}

/// The principals that hold `row` under `sync`, as partition names.
pub fn audience(tx: &Tx<'_>, schema: &Schema, content_name: &str, sync: &Sync, row: &Value) -> Result<Vec<String>, RuntimeError> {
    Ok(match &sync.audience {
        Audience::Public => vec![PUBLIC.to_owned()],
        Audience::Column(column) => match row.field(column) {
            Ok(Value::Id(principal)) => vec![partition_of(principal)],
            _ => Vec::new(),
        },
        Audience::Target { table, .. } => {
            let bound = binding(schema, content_name, sync).ok_or_else(|| RuntimeError::Schema(format!("sync to {table} has no audience index")))?;
            let group = group_of(sync, row);
            if group.iter().any(|value| *value == Value::Null) {
                return Ok(Vec::new());
            }
            let mut out = BTreeSet::new();
            for (member, _) in tx.scan(table, &bound.group_index, &group, &Bounds::default(), Dir::Asc, u32::MAX as usize)? {
                if let Ok(Value::Id(p)) = member.field(&bound.principal) {
                    out.insert(partition_of(p));
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
        if was == is {
            continue;
        }
        if let Some((partition, group)) = &was {
            // A grant that ends inside the commit that made it was never an
            // authority: the rows it would have carried are withdrawn before
            // they are logged, so a temporary membership delivers nothing.
            runner.events.retain(|event| !(event.partition == *partition && event.table == content_name && event.kind == EventKind::Put && event.data.as_ref().is_some_and(|row| group_of(&sync, row) == *group)));
            runner.events.push(Event { partition: partition.clone(), table: content_name.clone(), kind: EventKind::Scope, id: canonical_json(group), data: Some(Value::Array(group.clone())) });
        }
        if let Some((partition, group)) = &is {
            let content = schema.table(&content_name).expect("synced table");
            let rows = group_rows(runner.tx, &content_name, content, &sync, group)?;
            runner.meter.charge(MeterKind::Examined, rows.len() as u64)?;
            for row in rows {
                let id = row.field("id")?.as_str()?.to_owned();
                runner.events.push(Event { partition: partition.clone(), table: content_name.clone(), kind: EventKind::Put, id, data: Some(row) });
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
                    events.push(Event { partition: partition_of(principal), table: table_name.to_owned(), kind: EventKind::Put, id, data: Some(row) });
                }
            }
            Audience::Target { table: target, .. } => {
                let bound = binding(schema, table_name, sync).ok_or_else(|| RuntimeError::Schema(format!("sync to {target} has no audience index")))?;
                let mut groups = BTreeSet::new();
                for (member, _) in tx.scan(target, &bound.principal_index, &[Value::Id(principal.to_owned())], &Bounds::default(), Dir::Asc, u32::MAX as usize)? {
                    let group: Vec<Value> = bound.columns.iter().map(|c| member.field(c).cloned().unwrap_or(Value::Null)).collect();
                    if !group.iter().any(|value| *value == Value::Null) {
                        groups.insert(canonical_json(&group));
                    }
                }
                for group in groups {
                    let group: Vec<Value> = serde_json::from_str(&group).expect("canonical");
                    for row in group_rows(tx, table_name, table, sync, &group)? {
                        let id = row.field("id")?.as_str()?.to_owned();
                        events.push(Event { partition: partition_of(principal), table: table_name.to_owned(), kind: EventKind::Put, id, data: Some(row) });
                    }
                }
            }
        }
    }
    Ok(events)
}

/// Append a commit's events to the log. A row's events within one commit
/// coalesce to the last (a put then a delete logs the delete alone, so an
/// image that did not survive the commit never crosses the wire); scopes
/// keep their place.
pub fn append(tx: &Tx<'_>, seq: u64, events: &[Event]) -> Result<(), RuntimeError> {
    let mut last: BTreeMap<(&str, &str, &str), usize> = BTreeMap::new();
    for (position, event) in events.iter().enumerate() {
        if event.kind != EventKind::Scope {
            last.insert((&event.partition, &event.table, &event.id), position);
        }
    }
    let kept = events.iter().enumerate().filter(|(position, event)| event.kind == EventKind::Scope || last.get(&(event.partition.as_str(), event.table.as_str(), event.id.as_str())) == Some(position));
    for (ord, (_, event)) in kept.enumerate() {
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
    let partition = partition_of(principal);
    let mut own = tx.read_log(&partition, watermark, limit + 1)?;
    let mut public = tx.read_log(PUBLIC, watermark, limit + 1)?;
    own.append(&mut public);
    own.sort_by_key(|event| (event.seq, event.ord));
    let overflow = own.len() > limit;
    own.truncate(limit);
    // Never split one commit's events across pages: a page ends on a seq
    // boundary, and a commit larger than the page is delivered whole (its
    // scopes land with its puts, or a revocation would be skipped for good).
    if overflow {
        let last_seq = own.last().map(|e| e.seq).unwrap_or(watermark);
        match own.iter().rev().find(|e| e.seq < last_seq).map(|e| e.seq) {
            Some(complete) => own.retain(|e| e.seq <= complete),
            None => {
                own = tx.read_log_seq(&partition, last_seq)?;
                own.append(&mut tx.read_log_seq(PUBLIC, last_seq)?);
                own.sort_by_key(|event| (event.seq, event.ord));
            }
        }
    }
    let next = own.last().map(|e| e.seq).unwrap_or(watermark);
    let more = overflow && (!tx.read_log(&partition, next, 1)?.is_empty() || !tx.read_log(PUBLIC, next, 1)?.is_empty());
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
