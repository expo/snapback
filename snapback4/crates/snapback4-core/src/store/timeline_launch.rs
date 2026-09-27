//! First-use Following adoption. All construction belongs to activation's transaction.
// @ref LLP 3000.026#4-atomic-launch-adoption — start this feed now, not historical replay.
use super::*;
use crate::{error::MeterKind, meter::{Ceilings, Cut, Meter}, rows::adoption::Work,
    schema::timeline::{Timeline, HISTORY_WINDOW}, value::object};

pub const COPY_CEILING: u64 = 5_000_000;
// Updated from the complete release-profile activation measurement, including
// slot fill, indexes, validation and commit. An estimate, not a latency promise.
pub const ROW_WRITES_PER_SECOND: u64 = 7_000;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Estimate {
    pub name: String,
    pub sources: u64,
    pub events: u64,
    pub edges: u64,
    pub copies: u64,
}
impl Estimate {
    pub fn summary(&self) -> String {
        format!("view {}: {} source rows, {} events, {} follows; {} rows to copy; estimated writer lock {:.2} s at {} row writes/s (hardware-dependent); ceiling {} copies",
            self.name, self.sources, self.events, self.edges, self.copies,
            (self.sources + 2 * self.events + self.copies) as f64 / ROW_WRITES_PER_SECOND as f64, ROW_WRITES_PER_SECOND, COPY_CEILING)
    }
}
fn refuse(message: impl Into<String>) -> RuntimeError {
    RuntimeError::Structural { code: "E_TIMELINE_ACTIVATE", message: message.into() }
}
const ALTERNATIVE: &str = "Use the planned home query in guide feeds: query home(c: cursor ?): return activity where .actor = viewer or exists follows[viewer, .actor] last 20 by .at after c";

impl Store {
    /// Read-only preflight, before taking the activation writer lock.
    pub fn timeline_launch_estimate(&mut self, schema: &Schema) -> Result<Vec<Estimate>, RuntimeError> {
        let tx = self.read_transaction()?;
        let estimates = estimate(&tx, schema)?;
        tx.rollback()?;
        Ok(estimates)
    }
}

pub(super) fn admission(estimates: &[Estimate], allow: bool) -> Result<(), RuntimeError> {
    let copies: u64 = estimates.iter().map(|e| e.copies).sum();
    let details = || estimates.iter().map(Estimate::summary).collect::<Vec<_>>().join("; ");
    if copies > COPY_CEILING {
        return Err(refuse(format!("{}; total {copies} exceeds the activation ceiling {COPY_CEILING}; --allow-feed-adoption does not override this ceiling; no activation started. {ALTERNATIVE}", details())));
    }
    if !allow && estimates.iter().any(|e| e.sources != 0) {
        return Err(refuse(format!("{}; atomic launch blocks writes and syncs; pass --allow-feed-adoption to start this feed now. {ALTERNATIVE}", details())));
    }
    Ok(())
}

fn previous(tx: &Tx<'_>) -> Result<Schema, RuntimeError> {
    tx.conn().query_row("SELECT schema FROM _generations WHERE generation = (SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'generation')", [], |r| r.get::<_, String>(0))
        .optional()?.map(|s| crate::json_codec::from_text(&s).map_err(|e| RuntimeError::Store(e.to_string())))
        .transpose().map(Option::unwrap_or_default)
}
fn walk(tx: &Tx<'_>, table: &str, work: Work, visit: impl FnMut(&str, Value, &mut Meter) -> Result<(), RuntimeError>) -> Result<(), RuntimeError> {
    if let Some(num) = tx.catalog.get(table) {
        super::activation_walk::walk_metered(tx, *num, work, |_| crate::value::InternalPrice::zero(), visit)?;
    }
    Ok(())
}
fn field(row: &Value, name: &str) -> Result<Value, RuntimeError> { Ok(row.field(name)?.clone()) }
fn live(t: &Timeline, row: &Value, meter: &mut Meter) -> Result<bool, RuntimeError> {
    if !t.posts[3].is_empty() && row.field(&t.posts[3])? == &Value::Bool(true) { return Ok(false); }
    if let Some(filter) = &t.filter { meter.step(filter.steps())?; return Ok(filter.matches(row)); }
    Ok(true)
}

/// Exact copy count from retained events per actor, with bounded preflight memory.
/// No source image or per-reader roster is retained. Repeat under the writer lock.
pub(super) fn estimate(tx: &Tx<'_>, schema: &Schema) -> Result<Vec<Estimate>, RuntimeError> {
    let previous = previous(tx)?;
    let mut estimates = Vec::new();
    for t in &schema.timelines {
        if previous.timelines.iter().any(|old| old.same_declaration(t)) { continue; }
        if previous.timelines.iter().any(|old| old.name == t.name) {
            return Err(RuntimeError::Structural { code: "E_TIMELINE_REDEFINE", message: format!("view {} changed; retire it and use a fresh view name, or the planned home query in guide feeds", t.name) });
        }
        // Catalog ordinals survive retirement. A literal-default addition cannot
        // accidentally authorize same-name device-image preservation.
        if t.owned.iter().any(|name| tx.catalog.contains_key(name))
            || [false, true].iter().any(|&r| previous.table(t.source(r)).is_some_and(|s| s.columns.contains_key(&t.slot(r)))) {
            return Err(refuse(format!("view {} requires first-use owned and slot names ({:?}); rename the view to preserve existing data and force device reacquisition. {ALTERNATIVE}", t.name, t.owned)));
        }
        let mut e = Estimate { name: t.name.clone(), ..Default::default() };
        let mut actors = BTreeMap::<String, u64>::new();
        let mut retained = Meter::new(Ceilings::job(), Cut::Abort);
        retained.at("adopt actor counts");
        for repost in [false, true] {
            walk(tx, t.source(repost), Work::DECODE, |_, mut row, meter| {
                crate::schema::materialize_optional_fields(&mut row, &schema.tables[t.source(repost)]);
                meter.heap(retained.used.heap_bytes)?;
                e.sources += 1;
                if !repost && !live(t, &row, meter)? { return Ok(()); }
                let actor = row.field(if repost { &t.reposts[1] } else { &t.posts[1] })?.as_str()?;
                if !actors.contains_key(actor) {
                    let bytes = actor.len() as u64 + 256;
                    retained.heap(bytes)?;
                    meter.heap(bytes)?;
                }
                *actors.entry(actor.to_owned()).or_default() += 1;
                e.events += 1;
                Ok(())
            })?;
        }
        e.copies = e.events;
        walk(tx, &t.edges[0], Work::DECODE, |_, row, meter| {
            meter.heap(retained.used.heap_bytes)?;
            e.sources += 1;
            e.edges += 1;
            let reader = row.field(&t.edges[1])?;
            let actor = row.field(&t.edges[2])?;
            if reader == actor { return Err(refuse(format!("view {}: retained self-follow {}; remove it before adoption", t.name, row.field("id")?.as_str()?))); }
            e.copies += actors.get(actor.as_str()?).copied().unwrap_or(0).min(HISTORY_WINDOW as u64);
            Ok(())
        })?;
        estimates.push(e);
    }
    Ok(estimates)
}

fn put(tx: &Tx<'_>, schema: &Schema, table: &str, mut row: Value, meter: &mut Meter) -> Result<(), RuntimeError> {
    let def = &schema.tables[table];
    meter.heap(crate::engine::row_copy_ceiling(def).saturating_mul(4))?;
    crate::schema::materialize_optional_fields(&mut row, def);
    meter.charge(MeterKind::RowsWritten, 1)?;
    meter.charge(MeterKind::IndexEntries, def.indexes.len() as u64)?;
    meter.step(def.indexes.len() as u64 + 1)?;
    // INSERT, never upsert: an identity collision aborts the entire launch.
    tx.put(table, def, &row, None)?;
    Ok(())
}
fn copy(tx: &Tx<'_>, schema: &Schema, t: &Timeline, event: &Value, reader: Value, epoch: Value, meter: &mut Meter) -> Result<(), RuntimeError> {
    let id = crate::schema::timeline::owned_id(&t.name, "Feed", &[reader.clone(), field(event, "id")?, epoch.clone()]);
    put(tx, schema, &t.table("Feed"), object([
        ("id", Value::Id(id)), ("readerId", reader), ("epoch", epoch), ("eventId", field(event, "id")?),
        ("actorId", field(event, "actorId")?), ("authorId", field(event, "authorId")?),
        ("postId", field(event, "postId")?), ("repost", field(event, "repost")?), ("at", field(event, "at")?),
    ]), meter)
}

pub(super) fn build(tx: &Tx<'_>, schema: &Schema, estimates: &[Estimate], now: i64) -> Result<(), RuntimeError> {
    if estimates.iter().all(|e| e.sources == 0) { return Ok(()); }
    let incarnation = Value::Id(crate::ids::mint(now, &mut 0)?);
    let seq = tx.next_seq()?;
    let birth = Value::Id(format!("{seq:016x}{:016x}", 0));
    let epoch = Value::Id(format!("{seq:016x}{:016x}", 1));
    let mut writes = 0;
    for estimate in estimates {
        let t = schema.timelines.iter().find(|t| t.name == estimate.name).unwrap();
        for repost in [false, true] {
            walk(tx, t.source(repost), Work { examined: 2, steps: 128, index_entries: 64 }, |id, mut row, meter| {
                crate::schema::materialize_optional_fields(&mut row, &schema.tables[t.source(repost)]);
                if !repost && !live(t, &row, meter)? { return Ok(()); }
                let actor = field(&row, if repost { &t.reposts[1] } else { &t.posts[1] })?;
                let post_id = if repost { field(&row, &t.reposts[2])? } else { field(&row, "id")? };
                let author = if repost {
                    meter.charge(MeterKind::Examined, 1)?;
                    meter.heap(crate::engine::row_copy_ceiling(&schema.tables[&t.posts[0]]).saturating_mul(4))?;
                    let card = tx.get(&t.posts[0], post_id.as_str()?)?.ok_or_else(|| refuse(format!("view {}: retained repost {id} has no original card; restore the card or remove the repost", t.name)))?;
                    field(&card, &t.posts[1])?
                } else { actor.clone() };
                let event_id = if repost { Value::Id(crate::schema::timeline::owned_id(&t.name, "LaunchEvent", &[incarnation.clone(), Value::String(t.reposts[0].clone()), Value::Id(id.into())])) } else { post_id.clone() };
                let event = object([("id", event_id.clone()), ("actorId", actor.clone()), ("authorId", author),
                    ("postId", post_id), ("at", field(&row, if repost { &t.reposts[3] } else { &t.posts[2] })?), ("repost", Value::Bool(repost))]);
                put(tx, schema, &t.table("Posts"), event.clone(), meter)?;
                let work_id = crate::schema::timeline::owned_id(&t.name, "Work", &[Value::String("delivery".into()), actor.clone(), Value::Null, event_id.clone(), Value::Null]);
                put(tx, schema, &t.table("Work"), object([
                    ("id", Value::Id(work_id)), ("kind", Value::String("delivery".into())), ("actorId", actor.clone()),
                    ("readerId", Value::Null), ("viewerId", actor.clone()), ("eventId", event_id), ("epoch", Value::Null),
                    ("remaining", Value::Int(0)), ("cursor", Value::Null), ("admitted", birth.clone()),
                    ("at", Value::Int(now)), ("status", Value::String("done".into())), ("error", Value::Null),
                ]), meter)?;
                copy(tx, schema, t, &event, actor, Value::Null, meter)?;
                writes += 3;
                Ok(())
            })?;
        }
        walk(tx, &t.edges[0], Work { examined: 1, steps: 128, index_entries: 64 }, |_, row, outer| {
            let reader = field(&row, &t.edges[1])?;
            let actor = field(&row, &t.edges[2])?;
            let id = crate::schema::timeline::owned_id(&t.name, "Edges", &[reader.clone(), actor.clone()]);
            put(tx, schema, &t.table("Edges"), object([("id", Value::Id(id)), ("readerId", reader.clone()), ("actorId", actor.clone()), ("epoch", epoch.clone())]), outer)?;
            writes += 1;
            let mut after = None;
            let mut remaining = HISTORY_WINDOW;
            while remaining > 0 {
                // Metered pages are scratch scopes, never transaction chunks.
                // Reserve the still-live source page and the bounded owned images
                // before fetching this event page; no unbounded roster allocation.
                let mut meter = Meter::new(Ceilings::job(), Cut::Abort);
                meter.at("adopt following copies");
                meter.heap(outer.used.heap_bytes)?;
                let take = remaining.min(32);
                meter.heap(crate::engine::row_copy_ceiling(&schema.tables[&t.table("Posts")]).saturating_mul(4 * take as u64))?;
                meter.charge(MeterKind::Examined, take as u64)?;
                let events = tx.scan(&t.table("Posts"), "byActorTime", &[actor.clone()], &Bounds { after, ..Default::default() }, Dir::Desc, take)?;
                if events.is_empty() { break; }
                for (event, _) in &events {
                    let mark = meter.mark();
                    copy(tx, schema, t, event, reader.clone(), epoch.clone(), &mut meter)?;
                    meter.release_heap(mark);
                    writes += 1;
                }
                remaining -= events.len();
                after = events.last().and_then(|(_, key)| crate::key::decode(key)).map(|key| key.into_iter().skip(1).collect());
                if events.len() < take { break; }
            }
            Ok(())
        })?;
    }
    // Birth/edge order is above all predecessor commits and below every future
    // mutation. Devices reacquire: no per-copy log or pending launch work exists.
    tx.record_commit(seq, now, "following launch", crate::SYSTEM_PRINCIPAL, "rebuild", &estimates.iter().map(|e| e.name.clone()).collect::<Vec<_>>(), writes)?;
    Ok(())
}
