//! Fill new slots before successor assessment and row validation, without logs.
// @ref LLP 3000.016#21a-owned-events-follow-their-source-rows — one pinned activation transaction, including mixed default additions.
use super::*;
use crate::{error::MeterKind, rows::adoption::Work, schema::timeline::Timeline};

pub(super) fn fill(tx: &Tx<'_>, schema: &Schema, now: i64) -> Result<(), RuntimeError> {
    let previous: Option<String> = tx.conn().query_row(
        "SELECT schema FROM _generations WHERE generation = (SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'generation')",
        [], |row| row.get(0)).optional()?;
    let previous: Schema = previous.map(|s| crate::json_codec::from_text(&s).map_err(|e| RuntimeError::Store(e.to_string())))
        .transpose()?.unwrap_or_default();
    for timeline in &schema.timelines {
        for repost in [false, true] {
            let source = timeline.source(repost);
            let slot = timeline.slot(repost);
            if !timeline.has_slot(schema, repost) || previous.table(source).is_some_and(|table| table.columns.contains_key(&slot)) { continue; }
            fill_slot(tx, schema, timeline, repost, now)?;
        }
    }
    Ok(())
}

fn fill_slot(tx: &Tx<'_>, schema: &Schema, t: &Timeline, repost: bool, now: i64) -> Result<(), RuntimeError> {
    let source = t.source(repost);
    let slot = t.slot(repost);
    let events = t.table("Posts");
    let definition = &schema.tables[&events];
    let index = &definition.indexes["byActorPost"];
    // @ref LLP 3000.015#1 — activation is system-owned work; its scratch is the
    // source's declared copy ceiling, never a stored image's length.
    let scratch = crate::engine::row_copy_ceiling(&schema.tables[source]).saturating_mul(4)
        .saturating_add(crate::engine::row_copy_ceiling(definition).saturating_mul(8)).saturating_add(8192);
    super::activation_walk::walk_metered(tx, tx.num(source)?, Work { examined: 2, steps: 1, index_entries: 0 }, |_| crate::value::InternalPrice::zero(),
        |id, mut row, meter| {
            meter.at(&format!("adopt {source}.{slot}"));
            meter.heap(scratch)?;
            meter.charge(MeterKind::Examined, 1)?;
            meter.step(1)?;
            // @ref LLP 3000.026#4-atomic-launch-adoption — retained literal
            // defaults remain an interpretation; persist only the new slot.
            let mut interpreted = row.clone();
            crate::schema::materialize_optional_fields(&mut interpreted, &schema.tables[source]);
            let actor = interpreted.field(if repost { &t.reposts[1] } else { &t.posts[1] })?.clone();
            let post = interpreted.field(if repost { &t.reposts[2] } else { "id" })?.clone();
            let event = tx.lookup(&events, "byActorPost", index, &[actor, post, Value::Bool(repost)])?
                .filter(|row| !definition.expired(row, now));
            let value = if repost { event.map(|row| row.field("id").cloned()).transpose()?.unwrap_or(Value::Null) }
                else { Value::Bool(event.is_some()) };
            if let Value::Row(fields) | Value::Map(fields) = &mut row { fields.insert(slot.clone(), value); }
            meter.charge(MeterKind::RowsWritten, 1)?;
            // No slot participates in an index; ordinary activation rebuilds indexes next.
            tx.conn().execute("UPDATE r SET data = ?1 WHERE t = ?2 AND id = ?3", params![canonical_json(&row), tx.num(source)?, id])?;
            Ok(())
        })
}
