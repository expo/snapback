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

use crate::engine::{runner::Runner, write::Origin};
use crate::error::{MeterKind, RuntimeError};
use crate::rows::{Bounds, Dir};
#[cfg(feature = "sqlite")]
use crate::rows::Rows;
#[cfg(feature = "sqlite")]
use crate::schema::Table;
use crate::schema::{Audience, AudienceBinding, Schema, Sync, audience_binding, row_image};
#[cfg(feature = "sqlite")]
use crate::store::LogEvent;
#[cfg(feature = "sqlite")]
mod counts;
#[cfg(feature = "sqlite")]
mod delivery;
#[cfg(feature = "sqlite")]
mod storage;
use crate::value::{Value, canonical_json};
#[cfg(feature = "sqlite")]
use counts::delivery_counts;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
#[cfg(feature = "sqlite")]
pub use storage::{LogSpan, PartitionRows, audience_epoch_key, audience_epoch_time_key};

/// The partition every principal also holds. Principal partitions carry a
/// tag (`p:<principal>`), so no principal's name can collide with it: a
/// membership granted to a principal literally named `public` delivers to
/// that principal alone.
pub const PUBLIC: &str = "public";

/// The partition name of one principal.
pub fn partition_of(principal: &str) -> String {
    format!("p:{principal}")
}

/// Durable evidence that this timed image actually crossed a publication
/// boundary. It is independent of the pending queue: an expired or missed
/// opening can consume that queue without ever publishing the row.
// @ref LLP 3000.036.003#4-advancing-time-without-an-application-job — revocation follows actual publication evidence.
#[cfg(feature = "sqlite")]
fn was_published<R: Rows + ?Sized>(tx: &R, table_name: &str, table: &Table, row: &Value) -> Result<bool, RuntimeError> {
    if table.not_before.is_none() { return Ok(true); }
    tx.time_audience_published(table_name, row.field("id")?.as_str()?)
}

/// A current server row is publishable only after the row is live and its
/// publication evidence exists. Devices contain only published rows.
#[cfg(feature = "sqlite")]
fn published<R: Rows + ?Sized>(tx: &R, table_name: &str, table: &Table, row: &Value, now: i64) -> Result<bool, RuntimeError> {
    if !table.live(row, now) { return Ok(false); }
    was_published(tx, table_name, table, row)
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

/// The first arm's group: its prefix values (empty for public). Callers
/// supply `row_image` under the row's table before extracting group fields.
/// A union has several groups; delivery must use `partitions()` /
/// `arm_group()` instead of this legacy first-arm helper.
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
    // @ref LLP 3000.036.000.000#3 — a union row is logged to each arm that names a recipient; no partition is the union's own.
    let mut out = Vec::new();
    for (audience, _) in sync.arms() {
        let partition = match audience {
            Audience::Public => Some(PUBLIC.to_owned()),
            Audience::Column(column) => match row.field(column) {
                Ok(Value::Id(principal)) => Some(partition_of(principal)),
                _ => None,
            },
            Audience::Target { .. } => {
                let group = arm_group(audience, row);
                (!group.iter().any(|value| *value == Value::Null)).then(|| group_partition(table_name, &group))
            }
        };
        if let Some(partition) = partition && !out.contains(&partition) { out.push(partition); }
    }
    out
}

/// The group a row belongs to under one arm: the arm's audience columns.
pub fn arm_group(audience: &Audience, row: &Value) -> Vec<Value> {
    audience.columns().iter().map(|column| row.field(column).cloned().unwrap_or(Value::Null)).collect()
}

/// One arm of a union as a single-audience declaration, for the code that
/// walks one audience's groups (snapshot pages, windows, join expansion).
pub fn arm_sync(audience: &Audience, horizon: Option<&crate::schema::Horizon>) -> Sync {
    Sync::single(audience.clone(), horizon.cloned())
}

/// The mutation receipt cannot reveal extra private owner deliveries. Count
/// one logical change per private table/row, regardless of recipient fanout.
#[cfg(feature = "sqlite")]
pub(crate) fn disclosed_event_count(schema: &Schema, events: &[Event], actions: &BTreeSet<String>) -> usize {
    let mut private = BTreeSet::new();
    events.iter().filter(|event| {
        // @ref LLP 3000.039#4.2 — no event of a table a delete's actions may
        // write is counted: the schema, not the rows reached, decides.
        if actions.contains(&event.table) { return false; }
        if schema.maintain_for(&event.table).is_some_and(|m|m.row_key.is_some()) { return false; }
        if schema.tables[&event.table].written_by.values().any(|a| !a.audience) {
            private.insert((&event.table, &event.id))
        } else { true }
    }).count()
}

#[cfg(feature = "sqlite")]
mod pending;
#[cfg(feature = "sqlite")]
pub(crate) use pending::PendingEvents;
#[cfg(all(test, feature = "sqlite"))]
mod born_reference;
#[cfg(all(test, feature = "sqlite"))]
mod born_tests;

#[cfg(feature = "sqlite")]
mod log_events {
    use super::*;
    pub(super) fn put(events: &mut PendingEvents, table: &str, definition: &Table, id: &str, new: &Value, after: &BTreeSet<String>) {
        for partition in after {
            events.push(Event { partition: partition.clone(), table: table.to_owned(), kind: EventKind::Put, id: id.to_owned(), data: Some(definition.project_fields(new.clone(), partition.strip_prefix("p:")).into_value()) });
        }
    }
    pub(super) fn del(events: &mut PendingEvents, table: &str, id: &str, before: &BTreeSet<String>, after: &BTreeSet<String>) {
        for partition in before.difference(after) {
            events.push(Event { partition: partition.clone(), table: table.to_owned(), kind: EventKind::Del, id: id.to_owned(), data: None });
        }
    }
    pub(super) fn scope(events: &mut PendingEvents, table: &str, partition: &str, group: &[Value], predecessor: Option<Value>) {
        let data = predecessor.map_or_else(|| Value::Array(group.to_vec()), |expiry| {
                crate::value::object([
            ("group", Value::Array(group.to_vec())), ("previousExpiresAt", expiry)])
            },
        );
        events.push(Event { partition: partition.to_owned(), table: table.to_owned(), kind: EventKind::Scope, id: canonical_json(&group), data: Some(data) });
    }
    pub(super) fn join(events: &mut PendingEvents, table: &str, partition: &str, group: &[Value], expiry: Value, predecessor: Option<Value>) {
        let mut data = BTreeMap::from([("expiresAt".to_owned(), expiry)]);
        if let Some(predecessor) = predecessor { data.insert("previousExpiresAt".into(), predecessor); }
        events.push(Event { partition: partition.to_owned(), table: table.to_owned(), kind: EventKind::Join, id: canonical_json(&group), data: Some(Value::Row(data.into())) });
    }
}

// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — logless devices retain partition accounting and refusals, but construct no events.
#[cfg(feature = "sqlite")]
pub(crate) fn row_changed(runner: &mut Runner<'_>, table_name: &str, old: Option<&Value>, new: Option<&Value>, origin: Origin) -> Result<(), RuntimeError> {
    account_row_change::<true>(runner, table_name, old, new, origin)
}

/// Every host pays the same partition work, including expired membership
/// scans. Only a log-bearing host constructs the corresponding events.
pub(crate) fn account_row_change<const LOG: bool>(runner: &mut Runner<'_>, table_name: &str, old: Option<&Value>, new: Option<&Value>, origin: Origin,
) -> Result<(), RuntimeError> {
    let schema = runner.schema;
    let table = schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
    // @ref LLP 3000.007#18.3 — audience keys and lifetimes use the same interpreted image as rules and indexes.
    let old_image = old.map(|row| row_image(row, table));
    let new_image = new.map(|row| row_image(row, table));
    let now = runner.context.now.unwrap_or(i64::MIN);
    // Check the old marker before write maintenance changes it. A consumed
    // due entry does not prove the old image was ever sent, while a published
    // image retains this evidence through expiry until physical cleanup.
    let old_published = match old_image.as_deref() {
        Some(row) if table.not_before.is_some() => runner
            .tx
            .time_audience_published(table_name, row.field("id")?.as_str()?)?,
        Some(_) => true,
        None => false,
    };
    let old = old_image.as_deref().filter(|_| old_published);
    let new = new_image.as_deref().filter(|row| table.opened(row, now));
    // Rows born in this commit, in every table: synced ones log only their
    // final image, and a born membership is no predecessor of a grant.
    #[cfg(feature = "sqlite")]
    let row_key = if LOG { Some((table_name.to_owned(),
            old_image
                .as_deref()
                .or(new_image.as_deref()).expect("a row change has an image").field("id")?.as_str()?.to_owned(),
        )) } else { None };
    #[cfg(feature = "sqlite")]
    if let Some(key) = &row_key && old.is_none() {
        let earlier = runner.events.row_count(key);
        runner.born_rows.insert(key.clone(), earlier);
    }
    if let Some(sync) = &table.sync {
        let mut before: BTreeSet<String> = old.map(|old| partitions(table_name, sync, old)).unwrap_or_default().into_iter().collect();
        let mut after: BTreeSet<String> = new.map(|new| partitions(table_name, sync, new)).unwrap_or_default().into_iter().collect();
        // @ref LLP 3000.015#1 — reserve all potential owner deliveries before
        // inspecting witnesses; neither short circuits nor recipient counts
        // may move the writer's meter or E_BOUND boundary.
        let ordinary_steps = (before.len() + after.len()) as u64;
        let owner_slots = table.written_by.values().filter(|a| !a.audience).count() as u64
            * (u64::from(old.is_some()) + u64::from(new.is_some()));
        runner.prepay_field_delivery(&table.rules.read, owner_slots, origin == Origin::Maintained)?;
        if origin == Origin::Maintained { runner.charge_maintain(MeterKind::Steps, ordinary_steps)?; }
        else { runner.meter.charge(MeterKind::Steps, ordinary_steps)?; }
        // Shared images omit private fields; each owner's own partition also
        // carries an image only when that owner may read the row. Use the old
        // image for revocations, so losing read authority still withdraws it.
        // Evaluate for the recipient explicitly: the writer may be the system.
        for (row, recipients) in [(old, &mut before), (new, &mut after)] {
            if let Some(row) = row {
                for owner in table.field_owners(row) {
                    if runner.field_owner_can_read(&table.rules.read, &owner, row)? {
                        recipients.insert(partition_of(&owner));
                    }
                }
            }
        }
        let id = old_image
            .as_deref()
            .or(new_image.as_deref()).expect("a row change has an image").field("id")?.as_str()?;
        #[cfg(feature = "sqlite")]
        let id = if LOG { id.to_owned() } else { String::new() };
        #[cfg(not(feature = "sqlite"))]
        let _ = id;
        // @ref LLP 3000#7-decisions-during-execution — a row born in a commit logs only its image at the commit's end: no id of a row, or of a row's place, that existed at no commit boundary crosses the wire.
        #[cfg(feature = "sqlite")]
        if LOG {
            let key = (table_name.to_owned(), id.clone());
            if let Some(&earlier) = runner.born_rows.get(&key) {
                runner.events.withdraw_row(&key, earlier);
                // A born row whose lifetime has already ended is not live at
                // this commit's end either: it logs nothing (the stream would
                // re-read it as absent and send its id as a `del`).
                let live = new.filter(|new| runner.context.now.is_none_or(|now| table.live(new, now)));
                if let Some(new) = live {
                    log_events::put(&mut runner.events, table_name, table, &id, new, &after);
                }
            } else {
                // @ref LLP 3000.036.000.000#3 — commit-boundary accounting: a row that existed before the commit is accounted from the partitions it was in then, never from an intermediate image.
                let boundary = match runner.touched_rows.get(&key) {
                    Some((earlier, start)) => {
                        let (earlier, start) = (*earlier, start.clone());
                        runner.events.withdraw_row(&key, earlier);
                        start
                    }
                    None => {
                        runner.touched_rows.insert(key.clone(), (runner.events.row_count(&key), before.clone()));
                        before.clone()
                    }
                };
                if let Some(new) = new {
                    log_events::put(&mut runner.events, table_name, table, &id, new, &after);
                }
                log_events::del(&mut runner.events, table_name, &id, &boundary, &after);
            }
        }
    }
    #[cfg(feature = "sqlite")]
    if let Some(key) = &row_key && new.is_none() {
        runner.born_rows.remove(key);
    }
    // This table as the target of other tables' audiences.
    let dependents: Vec<(String, Sync)> = schema
        .synced()
        .filter_map(|(name, _, sync)| match &sync.audience {
            Audience::Target { table, .. } if table == table_name => {
                Some((name.to_owned(), sync.clone()))
            }
            _ => None,
        })
        .collect();
    if dependents.is_empty() {
        return Ok(());
    }
    let membership = |row: Option<&Value>, content_name: &str, sync: &Sync| -> Option<(String, Vec<Value>)> {
        let row = row?;
        let bound = binding(schema, content_name, sync)?;
        let Ok(Value::Id(p)) = row.field(&bound.principal) else { return None;
            };
        let group: Vec<Value> = bound.columns.iter().map(|c| row.field(c).cloned().unwrap_or(Value::Null)).collect();
        if group.iter().any(|value| *value == Value::Null) {
            return None;
        }
        Some((partition_of(p), group))
    };
    for (content_name, sync) in dependents {
        let was = membership(old, &content_name, &sync);
        let is = membership(new, &content_name, &sync);
        let expiry = |row: Option<&Value>| {
            row.and_then(|row| table.deadline(row)).map(Value::Int).unwrap_or(Value::Null)
        };
        if was == is && expiry(old) == expiry(new) {
            continue;
        }
        #[cfg(feature = "sqlite")]
        let mut undone_born: Option<(String, String, String)> = None;
        // A grant that ends inside the commit that made it was never an
        // authority, and the principal never held the group at a commit
        // boundary: its join and its scope are both withdrawn, so the
        // principal learns nothing of the group. A renewal is not a new
        // grant, so a revocation after one is always logged.
        if let Some((partition, group)) = &was {
            // Sweeping an expired predecessor must not revoke the live
            // replacement admitted under the same logical unique key.
            let mut replaced = false;
            if old.is_some_and(|row| {
                runner.context.now.is_some_and(|now| table.expired(row, now))
            }) {
                let bound = binding(schema, &content_name, &sync).expect("validated audience");
                let mut key = group.clone();
                key.push(old.unwrap().field(&bound.principal)?.clone());
                // A commit retiring its expired births removes only expired
                // rows, which cannot change whether a live one remains.
                #[cfg(feature = "sqlite")]
                let memo = runner.retiring.as_ref().map(|_| {
                    (table_name.to_owned(), bound.group_index.clone(), canonical_json(&key),
                    )
                });
                #[cfg(feature = "sqlite")]
                let known = memo.as_ref().and_then(|memo| {
                    runner.retiring.as_ref().and_then(|retiring| retiring.live_keys.get(memo).copied())
                });
                #[cfg(not(feature = "sqlite"))]
                let known: Option<bool> = None;
                match known {
                    Some(known) => replaced = known,
                    None => {
                        let mut bounds = Bounds::default();
                        loop {
                            let rows = runner.metered_scan(|runner, allowance| {
                                runner.tx.scan(allowance, table_name, &bound.group_index, &key, &bounds, Dir::Asc, 32)
                            })?;
                            let count = rows.len();
                            for (candidate, stored) in rows {
                                let candidate = row_image(&candidate, table);
                                runner.meter.charge(MeterKind::Examined, 1)?;
                                bounds.after = crate::key::decode(&stored).map(|values| values.into_iter().skip(key.len()).collect());
                                let evidence = table.not_before.is_none()
                                    || runner.tx.time_audience_published(table_name, candidate.field("id")?.as_str()?)?;
                                if evidence && runner.context.now.is_none_or(|now| table.live(&candidate, now))
                                { replaced = true; break; }
                            }
                            if replaced || count < 32 { break; }
                        }
                        #[cfg(feature = "sqlite")]
                        if let (Some(memo), Some(retiring)) = (memo, runner.retiring.as_mut()) { retiring.live_keys.insert(memo, replaced); }
                    }
                }
            }
            // A live deadline renewal is a join transition without a
            // revocation. If the old lifetime already ended, catch-up inserts
            // its scope before that join; shortening to expiry still revokes.
            let renewed = was == is && new.is_some_and(|row| runner.context.now.is_none_or(|now| table.live(row, now)));
            #[cfg(not(feature = "sqlite"))]
            let _ = (partition, replaced, renewed);
            #[cfg(feature = "sqlite")]
            if LOG && !replaced && !renewed {
                let key = (partition.clone(), content_name.clone(), canonical_json(group),
                );
                match runner.born_grants.get(&key).copied() {
                    Some(earlier) => {
                        runner.events.withdraw_grant(&key, earlier);
                        // Siblings born beside it still carry the birth.
                        let row = old.expect("a revoked grant had an image");
                        let own = row.field("id")?.as_str()?.to_owned();
                        let bound = binding(schema, &content_name, &sync).expect("validated audience");
                        let mut probe = group.clone();
                        probe.push(row.field(&bound.principal)?.clone());
                        if !runner.metered_scan(|runner, allowance| {
                            key_has_row(runner, allowance, table_name, &bound.group_index, &probe, false, |other| other != own)
                        })? {
                            runner.born_grants.remove(&key);
                        }
                        undone_born = Some(key);
                    }
                    None => log_events::scope(&mut runner.events, &content_name, partition, group, table.is_expiring().then(|| expiry(old))),
                }
            }
        }
        // Only a live pre-commit sibling prevents a grant from being born.
        // An expired physical predecessor cannot lend authority to a transient
        // replacement. Any revocation owed by that predecessor remains in its
        // earlier scope or the final synthetic-expiry path.
        // @ref LLP 3000.036.000.000#9 — physical presence is not historical grant authority.
        #[cfg(feature = "sqlite")]
        if LOG && let Some((partition, group)) = &is {
            let key = (partition.clone(), content_name.clone(), canonical_json(group),
            );
            if (was != is || undone_born.as_ref() == Some(&key)) && !runner.born_grants.contains_key(&key) {
                let row = new.expect("a membership has an image");
                let bound = binding(schema, &content_name, &sync).expect("validated audience");
                // Audience admission requires a unique index over the complete
                // non-null group+principal key. This opening row owns that key,
                // so no distinct physical predecessor can exist; nullable-key
                // multiplicity is irrelevant because null audiences never join.
                let _ = (row, bound);
                let predecessor = false;
                if !predecessor {
                    let earlier = runner.events.grant_count(&key);
                    runner.born_grants.insert(key.clone(), earlier);
                }
            }
            // @ref LLP 3000.036.000.000#9 — the first renewal after an epoch retains the authority that a snapshot already acquired.
            // A same-commit birth has no predecessor, even if it is renewed.
            let predecessor = (was == is && !runner.born_grants.contains_key(&key)).then(|| expiry(old));
            log_events::join(&mut runner.events, &content_name, partition, group, expiry(new), predecessor);
        }
        runner.meter.charge(MeterKind::Steps, 1)?;
    }
    Ok(())
}

/// Whether a row of one audience key (the group columns and the principal)
/// satisfies `wanted`, scanning the unique group index in batches until one
/// does. Log bookkeeping on the log-bearing host: not metered.
#[cfg(feature = "sqlite")]
fn key_has_row(runner: &Runner<'_>, allowance: &crate::engine::authorized_scan::Authorization, table_name: &str, index: &str, probe: &[Value], live_only: bool, wanted: impl Fn(&str) -> bool) -> Result<bool, RuntimeError> {
    let mut bounds = Bounds::default();
    loop {
        let rows = runner.tx.scan(allowance, table_name, index, probe, &bounds, Dir::Asc, 32)?;
        for (other, stored) in &rows {
            if wanted(other.field("id")?.as_str()?)
                && (!live_only || match runner.context.now {
                    None => true,
                    Some(now) => {
                        let table = &runner.schema.tables[table_name];
                        let image = row_image(other, table);
                        table.live(&image, now)
                            && (table.not_before.is_none()
                                || runner.tx.time_audience_published(table_name, image.field("id")?.as_str()?)?)
                    }
                }) {
                return Ok(true);
            }
            bounds.after = crate::key::decode(stored).map(|values| values.into_iter().skip(probe.len()).collect());
        }
        if rows.len() < 32 {
            return Ok(false);
        }
    }
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
        if !published(tx, target, table, &member, now)? { continue; }
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
    /// The arm of a union audience in flight (0 for a single audience).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub arm: usize,
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

fn is_zero(n: &usize) -> bool { *n == 0 }

#[cfg(feature = "sqlite")]
fn snapshot_groups(tx: &dyn PartitionRows, schema: &Schema, table_name: &str, sync: &Sync, principal: &str, now: i64) -> Result<Vec<Vec<Value>>, RuntimeError> {
    arm_groups(tx, schema, table_name, sync, &sync.audience, principal, now)
}

/// The groups of one arm a principal holds now. A target arm's binding is
/// proved against the whole declaration (a union's group disjunct).
#[cfg(feature = "sqlite")]
fn arm_groups(tx: &dyn PartitionRows, schema: &Schema, table_name: &str, sync: &Sync, audience: &Audience, principal: &str, now: i64) -> Result<Vec<Vec<Value>>, RuntimeError> {
    Ok(match audience {
        Audience::Public => vec![Vec::new()],
        Audience::Column(_) => vec![vec![Value::Id(principal.to_owned())]],
        Audience::Target { table: target, .. } => {
            let bound = binding(schema, table_name, sync).ok_or_else(|| {
                RuntimeError::Schema(format!("sync to {target} has no audience index"))
            })?;
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
        for (name, _, sync) in schema.synced().filter(|(name, table, _)| {
            table.leave == crate::schema::LeavePolicy::DeliveredHistory || schema.maintain_for(name).is_some_and(|m| m.own_keys.is_some())
        }) {
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
        let (table_name, table, full) = tables[at.table];
        // A partial kind lives only in source slots. Do not even open its
        // owned table when neither kind can contribute a snapshot row.
        if schema.timelines.iter().any(|t| {
            table_name == t.table("Posts")
            && !t.fully_synced(schema, false) && !t.fully_synced(schema, true)
        }) {
            at.table += 1; at.arm = 0; at.group = None; at.after = None; at.taken = 0;
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
                return Ok(SnapshotPage { acquisitions, events, watermark, next: Some(at), held });
            }
            if at.taken == 0 && at.after.is_none() {
                if let Some(horizon) = &sync.horizon {
                    acquisitions.push(acquisition(table_name, &horizon.by, group, events.len(), None));
                }
            }
            let (rows, exhausted, scanned, work) = group_rows_from(tx, table_name, table, sync, group, at.after.as_deref(), at.taken, room, now, Some((schema, principal)))?;
            // Empty groups still emit transitions and must consume page room.
            used += work.max(1);
            for (row, key) in rows {
                let id = row.field("id")?.as_str()?.to_owned();
                at.after = crate::key::decode(&key).map(|values| values.into_iter().skip(group.len()).collect());
                at.taken += 1;
                let partition = if table.field_owners(&row).contains(principal) { partition_of(principal) } else { match &sync.audience {
                    Audience::Public => PUBLIC.to_owned(),
                    Audience::Column(_) => partition_of(principal),
                    Audience::Target { .. } => group_partition(table_name, group),
                }};
                events.push(Event { partition, table: table_name.to_owned(), kind: EventKind::Put, id, data: Some(row) });
            }
            if scanned.is_some() { at.after = scanned; }
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
        at.arm += 1;
        if at.arm >= arms.len() { at.table += 1; at.arm = 0; }
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
fn group_rows_from(tx: &dyn PartitionRows, table_name: &str, table: &Table, sync: &Sync, group: &[Value], after: Option<&[Value]>, taken: usize, room: usize, now: i64, viewer: Option<(&Schema, &str)>) -> Result<(Vec<(Value, Vec<u8>)>, bool, Option<Vec<Value>>, usize), RuntimeError> {
    // Select through U's horizon, then fetch only the projected count image.
    // The horizon's order columns stay on U; they never become view payload.
    if let Some((schema, principal)) = viewer
        && let Some(m) = schema.maintain_for(table_name).filter(|m| m.row_key.is_some()) {
        let k = m.row_key.as_ref().unwrap();
        let member = &schema.tables[&k.table];
        if let Some(member_sync) = member.sync.as_ref().filter(|s| s.horizon.is_some()) {
            let (members, exhausted, continuation, work) = group_rows_from(tx, &k.table, member, member_sync, group, after, taken, room, now, viewer)?;
            let mut rows = Vec::new();
            let mut aggregate = Runner::new(tx, schema, crate::Context::new(principal, BTreeMap::new()).at(now), crate::meter::Meter::new(crate::meter::Ceilings::unbounded(), crate::meter::Cut::Cap), 0);
            for (member, key) in members {
                if let Some(row) = tx.get(table_name, member.field("id")?.as_str()?)?
                    && let Some(row) = aggregate.live_aggregate(table_name, row)? { rows.push((row, key)); }
            }
            return Ok((rows, exhausted, continuation, work));
        }
    }
    let (index_name, remaining, dir) = match &sync.horizon {
        Some(horizon) => (horizon.by.clone(), (horizon.last as usize).saturating_sub(taken), Dir::Desc,
        ),
        None => (audience_index(table_name, table, sync)?, usize::MAX, Dir::Desc,
        ),
    };
    let ask = remaining.min(room);
    if ask == 0 {
        return Ok((Vec::new(), true, None, 0));
    }
    let mut bounds = Bounds { after: after.map(<[Value]>::to_vec), ..Bounds::default() };
    let mut live = Vec::new();
    let mut exhausted = false;
    let mut reader = viewer.map(|(schema, principal)| {
        Runner::new(tx, schema, crate::Context::new(principal, BTreeMap::new()).at(now), crate::meter::Meter::new(crate::meter::Ceilings::unbounded(), crate::meter::Cut::Abort), 0)
    });
    let mut aggregate = viewer.map(|(schema, principal)| {
        Runner::new(tx, schema, if schema.maintain_for(table_name).is_some_and(|m|m.row_key.is_some()) { crate::Context::new(principal, BTreeMap::new()).at(now) } else { crate::Context::system().at(now) }, crate::meter::Meter::new(crate::meter::Ceilings::unbounded(), crate::meter::Cut::Cap), 0)
    });
    // One extra readable row decides pagination, never selection past N.
    // @ref LLP 3000.016#21a-owned-events-follow-their-source-rows — filtered kinds spend page room even when
    // they produce no rows; the continuation records the last examined key.
    // No lookahead here: every examined row belongs to this page's progress.
    let filtered = viewer.is_some_and(|(schema, _)| {
        schema.timelines.iter().any(|t| {
            table_name == t.table("Posts") && (!t.fully_synced(schema, false) || !t.fully_synced(schema, true))
        })
    });
    let target = remaining.min(if filtered { room } else { room.saturating_add(1) });
    let mut examined = 0;
    loop {
        let batch = target.saturating_sub(if filtered { examined } else { live.len() }).min(256).max(1);
        let principal = viewer.map(|(_,p)|p).unwrap_or(crate::SYSTEM_PRINCIPAL);
        // Delivery owns a separate, unbounded internal ledger. Projection is
        // not a caller-price capability; its reader validates each live row.
        let rows = tx.scan(table_name,&index_name,group,&bounds,dir,batch)?
            .into_iter().map(|(r,k)|(table.project_fields(r,Some(principal)).into_value(),k)).collect::<Vec<_>>();
        let count = rows.len();
        let mut certified = if viewer.is_some_and(|(schema, _)| {
            schema.maintain_for(table_name)
            .is_some_and(|m| m.row_count_needs_live_basis(schema))
        }) {
            let runner = aggregate.as_mut().unwrap();
            runner.meter.heap(crate::rows::word_heap::slots::<Value>(count)
                .saturating_add(crate::engine::row_copy_ceiling(table).saturating_mul(count as u64)))?;
            Some(runner.live_acquisition_batch(table_name,
                &rows.iter().map(|(row, _)| row.clone()).collect::<Vec<_>>())?.into_iter())
        } else { None };
        examined += count;
        for (mut row, key) in rows {
            let certified = certified.as_mut().map(|batch| batch.next().unwrap());
            bounds.after = crate::key::decode(&key).map(|values| values.into_iter().skip(group.len()).collect());
            if !published(tx, table_name, table, &row, now)? { continue; }
            // @ref LLP 3000.016#21a-owned-events-follow-their-source-rows — the horizonless owned walk keeps fully synced kinds only.
            if viewer.is_some_and(|(schema, _)| {
                !crate::schema::timeline::holds_event(schema, table_name, &row)
            }) { continue; }
            if let Some(runner) = &mut aggregate {
                let Some(live_row) = (match certified { Some(row) => row, None => runner.live_aggregate(table_name, row)? }) else { continue; };
                row = live_row;
            }
            if let Some(reader) = &mut reader {
                if !reader.check_rule(table_name, crate::schema::Effect::Read, None, &row)? { continue; }
            }
            // Transport retains recorded attribution for device aggregates;
            // only authored private fields are stripped from sync images.
            let row = table.project_fields(row, viewer.map(|(_, principal)| principal)).into_value();
            live.push((row, key));
            if live.len() == target { break; }
        }
        if live.len() == target { break; }
        if count < batch { exhausted = true; break; }
        if filtered && examined >= target { break; }
    }
    live.truncate(ask);
    exhausted |= sync.horizon.as_ref().is_some_and(|horizon| taken + live.len() >= horizon.last as usize);
    let work = if filtered { examined } else { live.len() };
    Ok((live, exhausted, if filtered { bounds.after } else { None }, work,
    ))
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
    table.indexes.iter().find(|(_, index)| index.is_plain() && index.columns().starts_with(&group_columns)).map(|(name, _)| name.clone()).ok_or_else(|| {
            RuntimeError::Schema(format!("{table_name} has no index leading with {}", group_columns.join(", ")))
        })
}

/// Append a commit's events to the log. A row's events within one commit
/// coalesce to the last (an update then a delete logs the delete alone, so
/// an image that did not survive the commit never crosses the wire); joins
/// and scopes keep their place. A row or a grant born and undone inside the
/// commit has already been withdrawn by `account_row_change`.
#[cfg(feature = "sqlite")]
pub fn append(tx: &dyn PartitionRows, seq: u64, events: &[Event]) -> Result<(), RuntimeError> {
    let mut last: BTreeMap<(&str, &str, &str), usize> = BTreeMap::new();
    for (position, event) in events.iter().enumerate() {
        if matches!(event.kind, EventKind::Put | EventKind::Del) {
            last.insert((&event.partition, &event.table, &event.id), position);
        }
    }
    let kept = events.iter().enumerate().filter(|(position, event)| {
        !matches!(event.kind, EventKind::Put | EventKind::Del) || last.get(&(event.partition.as_str(), event.table.as_str(), event.id.as_str(),
            )) == Some(position)
    });
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
    /// The join that began this span (or, held at the watermark, the last
    /// join before it): its position and its explicit lifetime, if any.
    origin: Option<(u64, u32, Option<i64>)>,
}

/// A join's explicit lifetime; a legacy join without one has none.
#[cfg(feature = "sqlite")]
fn join_lifetime(event: &LogEvent) -> Option<i64> {
    event.data.as_ref().and_then(|data| data.field("expiresAt").ok()).and_then(|value| value.as_int().ok())
}

/// Each group-synced content table's audience epoch (zero when unchanged).
#[cfg(feature = "sqlite")]
fn audience_epochs(tx: &dyn PartitionRows, schema: &Schema) -> Result<BTreeMap<String, u64>, RuntimeError> {
    let mut epochs = BTreeMap::new();
    for (name, _, sync) in schema.synced() {
        if matches!(sync.audience, Audience::Target { .. }) {
            let epoch = tx.audience_epoch(name)?;
            if epoch > 0 { epochs.insert(name.to_owned(), epoch); }
        }
    }
    Ok(epochs)
}

/// The content tables whose group audience a new schema changes: added, or
/// bound to another target, group or recipient. Their membership ledger
/// starts again at the activation (`audience_epoch`), so a stream reads the
/// groups a principal holds from the membership table until it logs a
/// transition under the new audience.
// @ref LLP 3000.036.000.000#9 — an audience epoch, so a scope logged under an earlier audience never closes a group the current one grants.
pub fn changed_group_audiences(previous: Option<&Schema>, schema: &Schema) -> Vec<String> {
    let Some(previous) = previous else { return Vec::new();
    };
    // The identity includes how stored images are interpreted: a column's
    // type and default decide which group an old row names (round 4, GPT
    // finding 1), so a changed default is a new audience too.
    let key = |schema: &Schema, name: &str| -> Option<String> {
        let table = schema.table(name)?;
        let sync = table.sync.as_ref()?;
        let Audience::Target { table: target, prefix, .. } = &sync.audience else { return None;
        };
        let binding = audience_binding(schema, name, table, sync).ok()?;
        let target_table = schema.table(target)?;
        let reading = |owner: &crate::schema::Table, column: &String| {
            (column.clone(), owner.columns.get(column).cloned(), owner.defaults.get(column).cloned(),
            )
        };
        let content: Vec<_> = prefix.iter().map(|column| reading(table, column)).collect();
        let members: Vec<_> = binding.columns.iter().chain([&binding.principal]).map(|column| reading(target_table, column)).collect();
        let opening = target_table.not_before.as_ref().map(|column| reading(target_table, column));
        let lifetime = target_table.expire.as_ref().map(|column| reading(target_table, column));
        let effective = target_table.expiry_column().map(|column| reading(target_table, &column.to_owned()));
        // Inherited lifetime inputs can change without changing capture types.
        // Bind the entire finite parent chain, including default interpretation.
        let mut ancestors = Vec::new();
        let mut next = target_table.through.as_ref().map(|t| t.parent.as_str());
        let mut seen = std::collections::BTreeSet::new();
        while let Some(parent) = next {
            if !seen.insert(parent) { break; }
            let Some(owner) = schema.table(parent) else { break; };
            ancestors.push((parent, &owner.columns, &owner.defaults, &owner.not_before, &owner.expire, &owner.through,
            ));
            next = owner.through.as_ref().map(|t| t.parent.as_str());
        }
        Some(canonical_json(&serde_json::json!([target, content, members, binding.group_index, opening, lifetime, effective,
            target_table.through, table.through.as_ref().map(|t| &t.identity), ancestors])))
    };
    schema.synced().filter(|(_, _, sync)| matches!(sync.audience, Audience::Target { .. }))
        .filter(|(name, _, _)| key(schema, name) != key(previous, name))
        .map(|(name, _, _)| name.to_owned()).collect()
}

/// The groups a principal held during `(watermark, now]`, per content
/// table, from its memberships now and the joins and scopes logged since.
#[cfg(feature = "sqlite")]
fn intervals(tx: &dyn PartitionRows, schema: &Schema, principal: &str, watermark: u64, now: i64) -> Result<BTreeMap<(String, String), Vec<Interval>>, RuntimeError> {
    // Physical memberships provide the initial state for databases whose old
    // ledger predates expiry metadata. Logical expiry still bounds every span.
    let mut current = BTreeMap::new();
    for (table_name, _, sync) in schema.synced() {
        let Audience::Target { table: target, .. } = &sync.audience else { continue;
        };
        let bound = binding(schema, table_name, sync).ok_or_else(|| {
            RuntimeError::Schema(format!("sync to {target} has no audience index"))
        })?;
        for (member, _) in tx.scan(target, &bound.principal_index, &[Value::Id(principal.to_owned())], &Bounds::default(), Dir::Asc, usize::MAX)? {
            let table = schema.table(target).expect("validated audience target");
            let member = row_image(&member, table);
            if !published(tx, target, table, &member, now)? { continue; }
            let group: Vec<Value> = bound.columns.iter().map(|c| member.field(c).cloned().unwrap_or(Value::Null)).collect();
            if group.contains(&Value::Null) { continue; }
            let expiry = schema.table(target).and_then(|table| table.deadline(&member));
            current.entry((table_name.to_owned(), canonical_json(&group))).and_modify(|held: &mut Option<i64>| {
                *held = match (*held, expiry) { (Some(a), Some(b)) => Some(a.max(b)), _ => None };
            }).or_insert(expiry);
        }
    }
    // @ref LLP 3000.036.000.000#9 — joins and scopes logged under an audience the table no longer syncs to are not this audience's history.
    let epochs = audience_epochs(tx, schema)?;
    let times = epoch_times(tx, schema)?;
    let current_epoch = |event: &LogEvent| {
        schema.table(&event.table).and_then(|table| table.sync.as_ref())
        .is_some_and(|sync| matches!(sync.audience, Audience::Target { .. }))
        && event.seq >= epochs.get(&event.table).copied().unwrap_or(0)
    };
    // @ref LLP 3000#7 — a content page cannot establish authority from a truncated ledger.
    let previous: BTreeMap<_, _> = tx.memberships_before(&partition_of(principal), watermark)?.into_iter().filter(current_epoch).map(|event| ((event.table.clone(), event.id.clone()), event)).collect();
    let mut transitions: BTreeMap<(String, String), Vec<LogEvent>> = BTreeMap::new();
    for event in tx.membership_transitions(&partition_of(principal), watermark)?.into_iter().filter(current_epoch) {
        transitions.entry((event.table.clone(), event.id.clone())).or_default().push(event);
    }
    // An expired pre-watermark grant may have no current row or new event:
    // undoing its transient replacement still owes logical revocation.
    // @ref LLP 3000.036.000.000#9 — a previously live expired predecessor keeps its owed revocation.
    let keys: BTreeSet<_> = previous.iter().filter_map(|(key, event)| (event.kind == "join").then_some(key))
        .chain(current.keys()).chain(transitions.keys()).cloned().collect();
    let mut out = BTreeMap::new();
    for key in keys {
        let expiring = schema.table(&key.0).and_then(|table| table.sync.as_ref()).and_then(|sync| match &sync.audience { Audience::Target { table, .. } => schema.table(table), _ => None }).is_some_and(|table| table.is_expiring());
        // A legacy grant without its lifetime or surviving membership cannot
        // authorize historical reads of an expiring audience. Fail closed.
        let fallback_expiry = || expiring.then_some(i64::MIN);
        let expiry = |event: &LogEvent| {
            event.data.as_ref().and_then(|data| data.field("expiresAt").ok()).map(|value| value.as_int().ok()).unwrap_or_else(fallback_expiry)
        };
        let steps = transitions.get(&key).map(Vec::as_slice).unwrap_or_default();
        let predecessor = steps.first().filter(|event| matches!(event.kind.as_str(), "join" | "scope"))
            .and_then(|event| event.data.as_ref()).and_then(|data| data.field("previousExpiresAt").ok());
        let held_at_watermark = previous.get(&key).map_or_else(
            || {
                steps.first().map_or_else(|| current.contains_key(&key), |event| event.kind == "scope" || predecessor.is_some())
            },
            |event| event.kind == "join");
        let initial_expiry = if steps.is_empty() { current.get(&key).copied().unwrap_or_else(|| {
                previous.get(&key).map(&expiry).unwrap_or_else(fallback_expiry)
            }) }
            else { previous.get(&key).map(&expiry).unwrap_or_else(|| {
                predecessor.map(|value| value.as_int().ok()).unwrap_or_else(fallback_expiry)
            }) };
        let origin = previous.get(&key).filter(|event| event.kind == "join").map(|event| (event.seq, event.ord, join_lifetime(event)));
        let expired_baseline = previous.get(&key).is_none() && times.get(&key.0)
            .is_some_and(|time| initial_expiry.is_some_and(|expiry| expiry <= *time));
        let mut open = (held_at_watermark && !expired_baseline).then_some(Interval { from: watermark.saturating_add(1), from_ord: None, to: None, expires_at: initial_expiry, ends_in_join: false, origin });
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
                    open = Some(Interval { from: event.seq, from_ord: Some(event.ord), to: None, expires_at: expiry(event), ends_in_join: false, origin: Some((event.seq, event.ord, join_lifetime(event))) });
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

// @ref LLP 3000.036.000.000#9 — an expiry at/before activation cannot authorize the rebound group.
#[cfg(feature = "sqlite")]
fn epoch_times(tx: &dyn PartitionRows, schema: &Schema) -> Result<BTreeMap<String, i64>, RuntimeError> {
    let mut times = BTreeMap::new();
    for (name, _, _) in schema.synced() {
        if let Some(time) = tx.audience_epoch_time(name)? {
            times.insert(name.to_owned(), time);
        }
    }
    Ok(times)
}

#[cfg(feature = "sqlite")]
fn interval_never_live(span: &Interval, epoch_time: Option<i64>, commit_times: &BTreeMap<u64, i64>) -> bool {
    match span.origin {
        Some((seq, _, lifetime)) => ended_by_its_commit(commit_times, seq, lifetime),
        None => epoch_time.is_some_and(|time| span.expires_at.is_some_and(|expiry| expiry <= time)),
    }
}

#[cfg(feature = "sqlite")]
pub fn stream(tx: &dyn PartitionRows, schema: &Schema, principal: &str, watermark: u64, limit: usize, now: i64) -> Result<StreamPage, RuntimeError> {
    let limit = limit.max(1);
    let head = tx.next_seq()?.saturating_sub(1);
    let expiring_audience = schema.synced().any(|(_, _, sync)| match &sync.audience {
        Audience::Target { table, .. } => schema.table(table).is_some_and(|target| target.is_expiring()),
        _ => false,
    });
    // A cursor from a replaced database is not evidence that this store reached it.
    if watermark > head || (watermark == head && !expiring_audience) { return Ok(StreamPage { images_at: Some(head), acquisitions: Vec::new(), events: Vec::new(), watermark: head, more: false, joined: BTreeMap::new() }); }
    let held = intervals(tx, schema, principal, watermark, now)?;
    let mut spans = vec![(partition_of(principal), watermark.saturating_add(1), None, None,
        ), (PUBLIC.to_owned(), watermark.saturating_add(1), None, None)];
    // A group acquired by a join reads its log after the join's commit: the
    // join's expansion delivers the group's rows as they are now, and an
    // event of that same commit (a row deleted or moved out beside the join)
    // names a row the joiner never held at a commit boundary (D2). A
    // continuous renewal keeps reading from its own commit, as its
    // predecessor span ends there and no expansion follows it.
    // @ref LLP 3000.036.000.000#3 — round 2 (GPT finding 1): no id from the acquiring commit.
    let renewals: Vec<u64> = held.values().flat_map(|spans| {
            spans.iter().filter(|span| span.from_ord.is_some() && span.from > watermark).map(|span| span.from)
        }).collect();
    let renewal_times = if renewals.is_empty() { BTreeMap::new() } else { tx.commit_times(&renewals)? };
    let epochs = audience_epochs(tx, schema)?;
    for ((table, group), intervals) in &held {
        let group: Vec<Value> = serde_json::from_str(group).map_err(|e| RuntimeError::Store(e.to_string()))?;
        // A renewal inside the acquiring commit is still that commit's
        // acquisition (round 3, GPT finding 3): authority starts after it.
        let mut acquired_at: Option<u64> = None;
        for (n, interval) in intervals.iter().enumerate() {
            let continuous = interval.from_ord.is_some_and(|ord| {
                n.checked_sub(1).map(|i| &intervals[i])
                .is_some_and(|prior| {
                        continuous_renewal(prior, interval.from, ord, &renewal_times)
                    })
            });
            let acquired = interval.from_ord.is_some() && (!continuous || acquired_at == Some(interval.from));
            acquired_at = acquired.then_some(interval.from);
            let from = if acquired { interval.from.saturating_add(1) } else { interval.from };
            // @ref LLP 3000.036.000.000#9 — round 3 (GPT finding 1): a group's log before the audience epoch belongs to an earlier audience.
            let from = from.max(epochs.get(table).copied().unwrap_or(0));
            if interval.to.is_none_or(|(seq, _)| seq > from) {
                spans.push((group_partition(table, &group), from, interval.to.map(|(seq, _)| seq), interval.expires_at,
                ));
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
    // Raw cursors advance even over suppressed scopes. A rebound grant already
    // expired at activation never held its new group, before or after sweeping.
    // @ref LLP 3000.036.000.000#9 — scope lifetime and epoch time bound D2 group disclosure.
    let times = epoch_times(tx, schema)?;
    let origins: Vec<_> = held.values().flatten().filter_map(|span| span.origin.map(|(seq, _, _)| seq)).collect::<BTreeSet<_>>().into_iter().collect();
    let origin_times = if origins.is_empty() { BTreeMap::new() } else { tx.commit_times(&origins)? };
    page.retain(|event| {
        if event.kind != "scope" { return true; }
        let current = schema.table(&event.table).and_then(|table| table.sync.as_ref())
            .is_some_and(|sync| matches!(sync.audience, Audience::Target { .. }))
            && event.seq >= epochs.get(&event.table).copied().unwrap_or(0);
        current && (!times.contains_key(&event.table) || held.get(&(event.table.clone(), event.id.clone())).is_some_and(|spans| {
                        spans.iter().any(|span| {
                            span.from <= event.seq && match span.origin {
                Some((seq, _, lifetime)) => {
                                        seq < event.seq && !ended_by_its_commit(&origin_times, seq, lifetime)
                                    }
                                    None => !interval_never_live(span, times.get(&event.table).copied(), &origin_times),
            }
                        })
                    }))
    });
    for event in page.iter_mut().filter(|event| event.kind == "scope") {
        if let Some(group) = event.data.as_ref().and_then(|data| data.field("group").ok()).cloned() { event.data = Some(group); }
    }
    let (mut events, acquisitions, joined) = expand_joins(tx, schema, principal, page, &held, now)?;
    if !more {
        next = next.max(head);
        // Logical expiry is a revocation even before the physical sweep
        // logs a scope. Append it after catch-up so retention sees the last
        // authorized image and until-revoked rows leave the replica. A chain
        // whose every span is a join whose lifetime had ended by its own
        // commit was never held live: there is nothing to revoke, and a scope
        // would name a group the principal never held.
        let expired: Vec<_> = held.iter().filter(|(_, spans)| {
                spans.last().is_some_and(|span| {
                    span.to.is_none() && span.expires_at.is_some_and(|at| at <= now)
                })
            }).collect();
        let joins: Vec<u64> = expired.iter().flat_map(|(_, spans)| {
                spans.iter().filter_map(|span| span.origin.map(|(seq, _, _)| seq))
            }).collect();
        let commit_times = if joins.is_empty() { BTreeMap::new() } else { tx.commit_times(&joins)? };
        let never_live = |table: &str, span: &Interval| {
            interval_never_live(span, times.get(table).copied(), &commit_times)
        };
        // @ref LLP 3000#7-decisions-during-execution — logical expiry revokes only a grant once held live.
        let silent: Vec<_> = expired.iter().map(|((table, _), spans)| spans.iter().all(|span| never_live(table, span))).collect();
        // A span held at the watermark continues the chain of joins that led
        // to it: it is silent only if no join of that chain, back to its last
        // scope, was live either (the device may hold its rows). The history
        // is read once, grouped once, and its commit times fetched once.
        let walks: Vec<usize> = (0..expired.len()).filter(|&n| {
                silent[n] && expired[n].1.first().is_some_and(|span| span.from_ord.is_none() && span.origin.is_some())
            }).collect();
        let mut chains: BTreeMap<usize, Vec<LogEvent>> = BTreeMap::new();
        if !walks.is_empty() {
            let mut by_group: BTreeMap<(String, String), Vec<LogEvent>> = BTreeMap::new();
            let epochs = audience_epochs(tx, schema)?;
            for event in tx.membership_transitions(&partition_of(principal), 0)?.into_iter().filter(|event| event.seq >= epochs.get(&event.table).copied().unwrap_or(0)) {
                by_group.entry((event.table.clone(), event.id.clone())).or_default().push(event);
            }
            for &n in &walks {
                let ((table, group), spans) = expired[n];
                let origin = spans[0].origin.map(|(seq, ord, _)| (seq, ord)).expect("walks have an origin");
                let history = by_group.get(&(table.clone(), group.clone())).map(Vec::as_slice).unwrap_or_default();
                chains.insert(n, joins_before(history, origin));
            }
        }
        let chain_seqs: Vec<u64> = chains.values().flatten().map(|event| event.seq).collect();
        let chain_times = if chain_seqs.is_empty() { BTreeMap::new() } else { tx.commit_times(&chain_seqs)? };
        for (n, ((table, group), _)) in expired.into_iter().enumerate() {
            let quiet = silent[n] && chains.get(&n).is_none_or(|chain| {
                    chain.iter().all(|event| {
                        ended_by_its_commit(&chain_times, event.seq, join_lifetime(event))
                    })
                });
            if !quiet {
                let group_values: Vec<Value> = serde_json::from_str(group).map_err(|e| RuntimeError::Store(e.to_string()))?;
                let event = LogEvent { seq: next, ord: u32::MAX, table: table.clone(), kind: "scope".into(), id: group.clone(), data: Some(Value::Array(group_values)) };
                events.push(event);
            }
        }
    }
    union_scopes(schema, principal, &mut events);
    Ok(StreamPage { images_at: Some(head), acquisitions, events, watermark: next, more, joined })
}

/// Whether a row can move between two groups of its group audience: some
/// content group column is not immutable. A viewer in both groups follows
/// both partitions, so the move's `del` must be decided at serve time too.
// @ref LLP 3000.036.000.000#4.2 — round 3 (Muse finding 2): R1 covers a single group audience whose group can move.
#[cfg(feature = "sqlite")]
fn movable_group(table: &Table, sync: &Sync) -> bool {
    matches!(&sync.audience, Audience::Target { prefix, .. } if prefix.iter().any(|column| !table.immutable_fields().any(|field| field == column)))
}

/// R2's input: a scope of a union table carries the recipient after the
/// group values, so a device can keep the group's rows that name it in a
/// column arm. Added at serve time; the log is unchanged. Union schemas are
/// capability-fenced, so no decoder that expects the bare group sees one.
// @ref LLP 3000.036.000.000#4.3 — the trailing element is the recipient's own principal.
#[cfg(feature = "sqlite")]
fn union_scopes(schema: &Schema, principal: &str, events: &mut [LogEvent]) {
    for event in events.iter_mut().filter(|event| event.kind == "scope") {
        if schema.table(&event.table).and_then(|table| table.sync.as_ref()).is_some_and(Sync::is_union)
            && let Some(Value::Array(group)) = &mut event.data {
            group.push(Value::Id(principal.to_owned()));
        }
    }
}

/// Whether a join's explicit lifetime had ended by its own commit: a grant
/// never held live. A join without a lifetime, or without a recorded commit
/// time, counts as live.
#[cfg(feature = "sqlite")]
fn ended_by_its_commit(commit_times: &BTreeMap<u64, i64>, seq: u64, lifetime: Option<i64>) -> bool {
    lifetime.is_some_and(|at| {
        commit_times.get(&seq).is_some_and(|committed| *committed >= at)
    })
}

/// One group's joins before `origin`, walking back to its last scope: the
/// chain a span held at the watermark continues. `history` is that group's
/// transitions in (seq, ord) order.
#[cfg(feature = "sqlite")]
fn joins_before(history: &[LogEvent], origin: (u64, u32)) -> Vec<LogEvent> {
    history.iter().rev().filter(|event| (event.seq, event.ord) < origin).take_while(|event| event.kind == "join").cloned().collect()
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
fn expand_joins(tx: &dyn PartitionRows, schema: &Schema, principal: &str, page: Vec<LogEvent>, held: &BTreeMap<(String, String), Vec<Interval>>, now: i64) -> Result<(Vec<LogEvent>, Vec<crate::wire::Acquisition>, crate::wire::HeldGroups,
    ), RuntimeError,
> {
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
    let mut delivery = delivery::Budget::new();
    // @ref LLP 3000#7-decisions-during-execution — retained history is device-held; the server serves current readable images.
    // Normalize ordinary puts before delivery. Join selection already checks
    // its images: never re-fetch them or probe their read rule a second time.
    let mut reader = Runner::new(tx, schema, crate::Context::new(principal, BTreeMap::new()).at(now),
        crate::meter::Meter::new(crate::meter::Ceilings::unbounded(), crate::meter::Cut::Abort), 0);
    let mut aggregate = Runner::new(tx, schema, crate::Context::new(principal, BTreeMap::new()).at(now),
        crate::meter::Meter::new(crate::meter::Ceilings::unbounded(), crate::meter::Cut::Cap), 0);
    let certified = delivery_counts(&mut aggregate, schema, &page)?;
    for mut event in page {
        if event.kind != "join" {
            if event.kind == "del" && schema.table(&event.table).is_some_and(|table| {
                    table.written_by.values().any(|authority| !authority.audience)
                }) {
                if let Some(row) = reader.authorized_scan(&[], |reader, scope| {
                    reader.fetch(scope, &event.table, &event.id)
                })? {
                    if reader.check_rule(&event.table, crate::schema::Effect::Read, None, &row)? {
                        event.kind = "put".into();
                        event.data = Some(schema.tables[&event.table].project_fields(row, Some(principal)).into_value());
                    }
                }
                delivery.push(&mut out, event, 0)?;
                continue;
            }
            // @ref LLP 3000.036.000.000#4.2 — R1: a del of a row in two of the viewer's partitions is decided at serve time; a readable row becomes a put served exactly as every put is (re-fetched, a row-keyed view recomputed, re-checked, projected).
            if event.kind == "del" && schema.table(&event.table).is_some_and(|table| {
                    table.sync.as_ref().is_some_and(|sync| sync.is_union() || movable_group(table, sync))
                }) {
                let readable = match reader.authorized_scan(&[], |reader, scope| {
                    reader.fetch(scope, &event.table, &event.id)
                })? {
                    Some(row) => {
                        reader.check_rule(&event.table, crate::schema::Effect::Read, None, &row)?
                    }
                    None => false,
                };
                if !readable { delivery.push(&mut out, event, 0)?; continue; }
                event.kind = "put".into();
            }
            if event.kind == "put" {
                event.data = if schema.table(&event.table).is_some() { reader.metered_scan(|reader, allowance| {
                        reader.fetch(allowance, &event.table, &event.id)
                    })? } else { None };
                if let Some(row) = &event.data
                    && let Some(m) = schema.maintain_for(&event.table).filter(|m| m.row_key.is_some()) {
                    let member = reader.row_view_member_image(m, row)?;
                    let mut live = member.is_some();
                    let k = m.row_key.as_ref().unwrap();
                    let table = &schema.tables[&k.table];
                    if let Some(member) = member
                        && let Some(sync) = table.sync.as_ref().filter(|s| s.horizon.is_some()) {
                        let group = match &sync.audience {
                            Audience::Public => vec![],
                            Audience::Column(c) => vec![member.field(c)?.clone()],
                            Audience::Target { prefix, .. } => prefix.iter().map(|c| member.field(c).cloned()).collect::<Result<Vec<_>, _>>()?,
                        };
                        live = delivery::group_contains(tx, schema, principal, &k.table, table, sync, &group, row.field("member")?, now, &delivery)?;
                    }
                    event.data = if live {
                        match certified.get(&(event.table.clone(), event.id.clone())) {
                            Some(row) => row.clone(),
                            None => aggregate.live_aggregate(&event.table, row.clone())?,
                        }
                    } else { None };
                }
                if let Some(row) = &event.data {
                    if !reader.check_rule(&event.table, crate::schema::Effect::Read, None, row)? { continue; }
                    event.data = event.data.take().map(|row| {
                        schema.tables[&event.table].project_fields(row, Some(principal)).into_value()
                    });
                } else { event.kind = "del".into(); }
            }
            delivery.push(&mut out, event, 0)?;
            continue;
        }
        let Some(spans) = held.get(&(event.table.clone(), event.id.clone())) else { continue;
        };
        let Some(start) = spans.iter().position(|span| span.from == event.seq && span.from_ord == Some(event.ord)) else { continue;
        };
        if !live_join_chain(spans, start, &commit_times, now) { continue; }
        let Some(table) = schema.table(&event.table) else { continue;
        };
        let Some(sync) = &table.sync else { continue };
        if !matches!(sync.audience, Audience::Target { .. }) { continue; }
        let group: Vec<Value> = serde_json::from_str(&event.id).map_err(|e| RuntimeError::Store(e.to_string()))?;
        // A catch-up spanning an expired grant and its replacement must
        // retire the old until-revoked image before acquiring the new one.
        // A continuous live renewal keeps its already acquired horizon.
        let predecessor = start.checked_sub(1).map(|i| &spans[i]).filter(|span| span.to == Some((event.seq, event.ord)));
        let expired_predecessor = predecessor.is_some_and(|span| {
            span.ends_in_join
            && span.expires_at.is_some_and(|expiry| {
                    commit_times.get(&event.seq).is_some_and(|at| *at >= expiry)
                })
        });
        let continuous = predecessor.is_some_and(|span| continuous_renewal(span, event.seq, event.ord, &commit_times));
        if continuous { continue; }
        // @ref LLP 3000.036.000.000#4.4 — a first post-epoch acquisition with no predecessor replaces stale until-revoked copies.
        // This names only the group the currently live join chain grants,
        // never an id deleted in the acquiring commit. R2 keeps column-arm rows.
        let epoch_acquisition = predecessor.is_none() && tx.audience_epoch(&event.table)? > 0;
        if expired_predecessor || epoch_acquisition && table.leave == crate::schema::LeavePolicy::UntilRevoked {
            let scope = LogEvent { seq: event.seq, ord: event.ord, table: event.table.clone(), kind: "scope".into(), id: event.id.clone(), data: Some(Value::Array(group.clone())) };
            delivery.push(&mut out, scope, 0)?;
        }
        // `joined` certifies this acquisition, including an empty one. A live
        // renewal preserves its predecessor's coverage on every page boundary.
        if table.leave == crate::schema::LeavePolicy::DeliveredHistory {
            joined.entry(event.table.clone()).or_default().push(group.iter().map(crate::wire::to_json).collect());
        }
        // @ref LLP 3000.007#18.2 — ruling 36: an acquisition selects the current readable rows at serve time; the boundary is the Nth delivered key by construction.
        if let Some(horizon) = &sync.horizon {
            acquisitions.push(acquisition(&event.table, &horizon.by, &group, out.len(), None));
        }
        let (rows, last_key) = delivery::expand_group(tx, schema, principal, &event, table, sync, &group, now, &mut delivery, &mut out)?;
        let floor = sync.horizon.as_ref().map(|horizon| {
            if rows < horizon.last as usize { "whole".into() }
            else { crate::value::encode_bytes_hex(last_key.as_ref().expect("selected horizon has a last key")) }
        });
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
