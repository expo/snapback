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
use crate::schema::{Audience, AudienceBinding, Schema, Sync, audience_binding, materialize_optional_fields};
#[cfg(feature = "sqlite")]
use crate::rows::{Bounds, Dir};
#[cfg(feature = "sqlite")]
use crate::store::{LogEvent, Tx};
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

/// Called for every physical row change. Produces the events of the row's
/// own sync, then the join and scope events of every table that syncs to
/// this table as a target.
pub fn row_changed(runner: &mut Runner<'_>, table_name: &str, old: Option<&Value>, new: Option<&Value>) -> Result<(), RuntimeError> {
    let schema = runner.schema;
    let table = schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
    if let Some(sync) = &table.sync {
        let before: BTreeSet<String> = old.map(|old| partitions(table_name, sync, old)).unwrap_or_default().into_iter().collect();
        let after: BTreeSet<String> = new.map(|new| partitions(table_name, sync, new)).unwrap_or_default().into_iter().collect();
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
        // A grant that ends inside the commit that made it was never an
        // authority: the stream expands a join only for a membership still
        // open, and a group's interval is `[join, leave)`, so the same
        // commit's join and scope deliver nothing.
        if let Some((partition, group)) = &was {
            runner.events.push(Event { partition: partition.clone(), table: content_name.clone(), kind: EventKind::Scope, id: canonical_json(group), data: Some(Value::Array(group.clone())) });
        }
        if let Some((partition, group)) = &is {
            runner.events.push(Event { partition: partition.clone(), table: content_name.clone(), kind: EventKind::Join, id: canonical_json(group), data: Some(Value::Array(group.clone())) });
        }
        runner.meter.charge(MeterKind::Steps, 1)?;
    }
    Ok(())
}

/// The rows of one group within the horizon, newest first when a horizon
/// orders them, else in the group index's order.
#[cfg(feature = "sqlite")]
pub fn group_rows(tx: &Tx<'_>, table_name: &str, table: &Table, sync: &Sync, group: &[Value]) -> Result<Vec<Value>, RuntimeError> {
    let (index_name, limit, dir) = match &sync.horizon {
        Some(horizon) => (horizon.by.clone(), horizon.last as usize, Dir::Desc),
        None => (audience_index(table_name, table, sync)?, u32::MAX as usize, Dir::Asc),
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

/// The groups a principal holds right now under one target audience, as
/// their prefix values.
#[cfg(feature = "sqlite")]
fn groups_now(tx: &Tx<'_>,
    schema: &Schema,
    bound: &AudienceBinding, target: &str, principal: &str) -> Result<Vec<Vec<Value>>, RuntimeError> {
    let mut groups = BTreeSet::new();
    for (member, _) in tx.scan(target, &bound.principal_index, &[Value::Id(principal.to_owned())], &Bounds::default(), Dir::Asc, u32::MAX as usize)? {
        if schema
            .table(target)
            .is_some_and(|table| table.expired(&member, crate::now_ms()))
        {
            continue;
        }
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
        serde_json::from_slice(&bytes).ok()
    }
}

/// One page of the snapshot: events, and where the next page starts
/// (`None` on the last).
pub struct SnapshotPage {
    pub events: Vec<Event>,
    pub watermark: u64,
    pub next: Option<SnapshotCursor>,
}

/// Everything a principal holds right now, one page at a time: the
/// snapshot a device applies before it follows the log from the watermark
/// the first page pinned. Each page is its own transaction, so the engine
/// is free between pages and a device never holds more than a page in
/// memory; a row that changes between pages reaches the device again
/// through the log, idempotently, and a group joined or left between pages
/// reaches it as the log's join or scope.
#[cfg(feature = "sqlite")]
pub fn snapshot_page(tx: &Tx<'_>, schema: &Schema, principal: &str, cursor: Option<SnapshotCursor>, limit: usize) -> Result<SnapshotPage, RuntimeError> {
    let watermark = match &cursor {
        Some(cursor) => cursor.watermark,
        None => tx.next_seq()? - 1,
    };
    let mut at = cursor.unwrap_or(SnapshotCursor { watermark, ..SnapshotCursor::default() });
    let tables: Vec<(&str, &Table, &Sync)> = schema.synced().collect();
    let mut events = Vec::new();
    let limit = limit.max(1);
    while at.table < tables.len() {
        let (table_name, table, sync) = tables[at.table];
        let groups: Vec<Vec<Value>> = match &sync.audience {
            Audience::Public => vec![Vec::new()],
            Audience::Column(_) => vec![vec![Value::Id(principal.to_owned())]],
            Audience::Target { table: target, .. } => {
                let bound = binding(schema, table_name, sync).ok_or_else(|| RuntimeError::Schema(format!("sync to {target} has no audience index")))?;
                groups_now(tx, schema, &bound, target, principal)?
            }
        };
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
            let room = limit - events.len();
            if room == 0 {
                at.group = Some(group.clone());
                return Ok(SnapshotPage { events, watermark, next: Some(at) });
            }
            let (rows, exhausted) = group_rows_from(tx, table_name, table, sync, group, at.after.as_deref(), at.taken, room)?;
            for (row, key) in rows {
                let id = row.field("id")?.as_str()?.to_owned();
                at.after = crate::key::decode(&key).map(|values| values.into_iter().skip(group.len()).collect());
                at.taken += 1;
                if table.expired(&row, crate::now_ms()) {
                    continue;
                }
                let partition = match &sync.audience {
                    Audience::Public => PUBLIC.to_owned(),
                    Audience::Column(_) => partition_of(principal),
                    Audience::Target { .. } => group_partition(table_name, group),
                };
                events.push(Event { partition, table: table_name.to_owned(), kind: EventKind::Put, id, data: Some(row) });
            }
            if !exhausted {
                at.group = Some(group.clone());
                return Ok(SnapshotPage { events, watermark, next: Some(at) });
            }
            at.after = None;
            at.taken = 0;
            position += 1;
        }
        at.table += 1;
        at.group = None;
    }
    Ok(SnapshotPage { events, watermark, next: None })
}

/// The whole snapshot at once, for hosts that hold it (the simulator's
/// device, tests); a real device pages it.
#[cfg(feature = "sqlite")]
pub fn snapshot(tx: &Tx<'_>, schema: &Schema, principal: &str) -> Result<Vec<Event>, RuntimeError> {
    let mut events = Vec::new();
    let mut cursor = None;
    loop {
        let page = snapshot_page(tx, schema, principal, cursor, 10_000)?;
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
fn group_rows_from(tx: &Tx<'_>, table_name: &str, table: &Table, sync: &Sync, group: &[Value], after: Option<&[Value]>, taken: usize, room: usize) -> Result<(Vec<(Value, Vec<u8>)>, bool), RuntimeError> {
    let (index_name, remaining, dir) = match &sync.horizon {
        Some(horizon) => (horizon.by.clone(), (horizon.last as usize).saturating_sub(taken), Dir::Desc),
        None => (audience_index(table_name, table, sync)?, usize::MAX, Dir::Asc),
    };
    let ask = remaining.min(room);
    if ask == 0 {
        return Ok((Vec::new(), true));
    }
    let bounds = Bounds { after: after.map(<[Value]>::to_vec), ..Bounds::default() };
    let rows: Vec<(Value, Vec<u8>)> = tx
        .scan(table_name, &index_name, group, &bounds, dir, ask)?
        .into_iter()
        .map(|(mut row, key)| {
            materialize_optional_fields(&mut row, table);
            (row, key)
        })
        .collect();
    let exhausted = rows.len() < ask || sync.horizon.as_ref().is_some_and(|horizon| taken + rows.len() >= horizon.last as usize);
    Ok((rows, exhausted))
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
pub fn append(tx: &Tx<'_>, seq: u64, events: &[Event]) -> Result<(), RuntimeError> {
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
    pub events: Vec<LogEvent>,
    /// The watermark after applying `events`.
    pub watermark: u64,
    /// Whether more events wait past `watermark`.
    pub more: bool,
}

#[cfg(feature = "sqlite")]
/// One group's membership over the window: `[from, to)` in sequence
/// numbers, `to` open while the membership stands.
#[derive(Clone, Debug)]
struct Interval {
    from: u64,
    to: Option<u64>,
}

#[cfg(feature = "sqlite")]
impl Interval {
    fn covers(&self, seq: u64) -> bool {
        seq >= self.from && self.to.is_none_or(|to| seq < to)
    }
}

/// The groups a principal held during `(watermark, now]`, per content
/// table, from its memberships now and the joins and scopes logged since.
#[cfg(feature = "sqlite")]
fn intervals(tx: &Tx<'_>, schema: &Schema, principal: &str, watermark: u64, own: &[LogEvent]) -> Result<BTreeMap<(String, String), Vec<Interval>>, RuntimeError> {
    // Membership now.
    let mut now: BTreeSet<(String, String)> = BTreeSet::new();
    for (table_name, _, sync) in schema.synced() {
        let Audience::Target { table: target, .. } = &sync.audience else { continue };
        let bound = binding(schema, table_name, sync).ok_or_else(|| RuntimeError::Schema(format!("sync to {target} has no audience index")))?;
        for group in groups_now(tx, schema, &bound, target, principal)? {
            now.insert((table_name.to_owned(), canonical_json(&group)));
        }
    }
    // Transitions since the watermark, per group, in order.
    let mut transitions: BTreeMap<(String, String), Vec<(u64, bool)>> = BTreeMap::new();
    for event in own {
        let joined = match event.kind.as_str() {
            "join" => true,
            "scope" => false,
            _ => continue,
        };
        transitions.entry((event.table.clone(), event.id.clone())).or_default().push((event.seq, joined));
    }
    let keys: BTreeSet<(String, String)> = now.iter().cloned().chain(transitions.keys().cloned()).collect();
    let mut out = BTreeMap::new();
    for key in keys {
        let steps = transitions.get(&key).cloned().unwrap_or_default();
        // Held at the watermark iff held now with an even number of flips since.
        let held_at_watermark = now.contains(&key) == (steps.len() % 2 == 0);
        let mut spans = Vec::new();
        let mut open: Option<u64> = held_at_watermark.then_some(watermark + 1);
        for (seq, joined) in steps {
            match (joined, open) {
                (true, None) => open = Some(seq),
                (false, Some(from)) => {
                    spans.push(Interval { from, to: Some(seq) });
                    open = None;
                }
                _ => {}
            }
        }
        if let Some(from) = open {
            spans.push(Interval { from, to: None });
        }
        if !spans.is_empty() {
            out.insert(key, spans);
        }
    }
    Ok(out)
}

#[cfg(feature = "sqlite")]
pub fn stream(tx: &Tx<'_>, schema: &Schema, principal: &str, watermark: u64, limit: usize) -> Result<StreamPage, RuntimeError> {
    let own_partition = partition_of(principal);
    let own = tx.read_log(&own_partition, watermark, limit + 1)?;
    let public = tx.read_log(PUBLIC, watermark, limit + 1)?;
    let held = intervals(tx, schema, principal, watermark, &own)?;
    // Every partition's events after the watermark, bounded per partition;
    // a partition that hit its bound is complete only below its last seq.
    let mut candidates: Vec<LogEvent> = Vec::new();
    let mut incomplete_from: Option<u64> = None;
    let mut saturated = |events: &Vec<LogEvent>| {
        if events.len() > limit && let Some(last) = events.last() {
            incomplete_from = Some(incomplete_from.map_or(last.seq, |s: u64| s.min(last.seq)));
        }
    };
    saturated(&own);
    saturated(&public);
    candidates.extend(own.iter().cloned());
    candidates.extend(public);
    for ((table, group), spans) in &held {
        let group_values: Vec<Value> = serde_json::from_str(group).expect("canonical");
        let events = tx.read_log(&group_partition(table, &group_values), watermark, limit + 1)?;
        saturated(&events);
        candidates.extend(events.into_iter().filter(|event| spans.iter().any(|span| span.covers(event.seq))));
    }
    candidates.sort_by_key(|event| (event.seq, event.ord));
    // Only sequences every partition was read through are deliverable.
    let deliverable_below = incomplete_from;
    let highest_read = candidates.last().map(|e| e.seq).unwrap_or(watermark);
    let mut page: Vec<LogEvent> = match deliverable_below {
        Some(bound) => candidates.iter().filter(|e| e.seq < bound).cloned().collect(),
        None => candidates.clone(),
    };
    let mut next = match deliverable_below {
        Some(bound) => page.last().map(|e| e.seq).unwrap_or(watermark).max(bound - 1),
        None => highest_read,
    };
    if page.is_empty() && let Some(bound) = deliverable_below {
        // The first pending commit alone exceeds the bound: deliver it whole.
        page = commit_events(tx, schema, principal, &own_partition, &held, bound)?;
        next = bound;
    } else if page.len() > limit {
        // A page ends on a commit boundary; a commit larger than the page
        // is delivered whole (its scopes land with its puts).
        let last_seq = page[limit].seq;
        let complete: Vec<LogEvent> = page.iter().filter(|e| e.seq < last_seq).cloned().collect();
        if complete.is_empty() {
            page = commit_events(tx, schema, principal, &own_partition, &held, last_seq)?;
            next = last_seq;
        } else {
            next = complete.last().map(|e| e.seq).unwrap_or(watermark);
            page = complete;
        }
    }
    let expanded = expand_joins(tx, schema, page, &held)?;
    let mut events = Vec::with_capacity(expanded.len());
    // @ref LLP 3000#7-decisions-during-execution — retained history is device-held; the server serves current readable images
    // Apply to legacy logs and join expansion alike. Replacing an old put
    // by a deletion also clears a device that caught up before the sweep.
    let mut reader = Runner::new(
        tx,
        schema,
        crate::Context::new(principal, BTreeMap::new()).at(crate::now_ms()),
        crate::meter::Meter::new(
            crate::meter::Ceilings::unbounded(),
            crate::meter::Cut::Abort,
        ),
        0,
    );
    for mut event in expanded {
        if event.kind == "put" {
            event.data = if schema.table(&event.table).is_some() {
                reader.fetch(&event.table, &event.id)?
            } else {
                None
            };
            if let Some(row) = &event.data {
                // Revocation with delivered-history keeps already delivered
                // device data. Suppress a now-hidden historical put; only an
                // actual row removal (or its scope policy) clears that copy.
                if !reader.check_rule(&event.table, crate::schema::Effect::Read, None, row)? {
                    continue;
                }
            }
            if event.data.is_none() {
                event.kind = "del".into();
            }
        }
        events.push(event);
    }
    let more = has_more(tx, &own_partition, &held, next)?;
    // A drained partition also covers commits with no events for this viewer
    // (no-op and online-only writes). Their acknowledged outbox entries must
    // be able to retire at the same transaction's through-watermark.
    if !more { next = next.max(tx.next_seq()? - 1); }
    Ok(StreamPage { events, watermark: next, more })
}

/// Every event of one commit across the principal's partitions.
#[cfg(feature = "sqlite")]
fn commit_events(tx: &Tx<'_>, _schema: &Schema, _principal: &str, own_partition: &str, held: &BTreeMap<(String, String), Vec<Interval>>, seq: u64) -> Result<Vec<LogEvent>, RuntimeError> {
    let mut events = tx.read_log_seq(own_partition, seq)?;
    events.append(&mut tx.read_log_seq(PUBLIC, seq)?);
    for ((table, group), spans) in held {
        if spans.iter().any(|span| span.covers(seq)) {
            let group_values: Vec<Value> = serde_json::from_str(group).expect("canonical");
            events.append(&mut tx.read_log_seq(&group_partition(table, &group_values), seq)?);
        }
    }
    events.sort_by_key(|event| (event.seq, event.ord));
    Ok(events)
}

/// A `join` becomes the group's rows as they stand, when the membership is
/// still open at the end of the window; a join whose group was left again
/// within the window delivers nothing beyond the group's own events over
/// the interval. Joins never reach a device.
#[cfg(feature = "sqlite")]
fn expand_joins(tx: &Tx<'_>, schema: &Schema, page: Vec<LogEvent>, held: &BTreeMap<(String, String), Vec<Interval>>) -> Result<Vec<LogEvent>, RuntimeError> {
    let mut out = Vec::with_capacity(page.len());
    for event in page {
        if event.kind != "join" {
            out.push(event);
            continue;
        }
        let open = held.get(&(event.table.clone(), event.id.clone())).is_some_and(|spans| spans.iter().any(|span| span.from == event.seq && span.to.is_none()));
        if !open {
            continue;
        }
        let Some(table) = schema.table(&event.table) else { continue };
        let Some(sync) = &table.sync else { continue };
        let group: Vec<Value> = serde_json::from_str(&event.id).expect("canonical");
        for row in group_rows(tx, &event.table, table, sync, &group)? {
            let id = row.field("id")?.as_str()?.to_owned();
            out.push(LogEvent { seq: event.seq, ord: event.ord, table: event.table.clone(), kind: "put".into(), id, data: Some(row) });
        }
    }
    Ok(out)
}

#[cfg(feature = "sqlite")]
fn has_more(tx: &Tx<'_>, own_partition: &str, held: &BTreeMap<(String, String), Vec<Interval>>, next: u64) -> Result<bool, RuntimeError> {
    if !tx.read_log(own_partition, next, 1)?.is_empty() || !tx.read_log(PUBLIC, next, 1)?.is_empty() {
        return Ok(true);
    }
    for ((table, group), spans) in held {
        if !spans.iter().any(|span| span.to.is_none_or(|to| to > next + 1)) {
            continue;
        }
        let group_values: Vec<Value> = serde_json::from_str(group).expect("canonical");
        if tx.read_log(&group_partition(table, &group_values), next, 1)?.iter().any(|event| spans.iter().any(|span| span.covers(event.seq))) {
            return Ok(true);
        }
    }
    Ok(false)
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
