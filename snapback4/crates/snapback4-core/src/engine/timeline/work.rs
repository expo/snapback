//! Engine-owned delivery queue. Every bounded chunk and its cursor share a commit.
// @ref LLP 3000.013#4-following-without-caps — derived delivery survives crashes and replay.
use super::*;
use crate::{engine::Engine, Context, Ceilings, meter::{Meter, Cut, Metered}, partition};
use crate::schema::timeline::DELIVERY_CHUNK;

impl Runner<'_> {
    fn timeline_follows(&mut self, t: &Timeline, reader: &Value, actor: &Value, epoch: &Value) -> Result<bool, RuntimeError> {
        Ok(self.timeline_edge(t, reader, actor)?.is_some_and(|edge| edge.field("epoch").ok() == Some(epoch)))
    }

    fn timeline_work(&mut self, t: &Timeline, work: &Value) -> Result<(), RuntimeError> {
        let kind = text(work, "kind")?;
        let actor = field(work, "actorId")?;
        let reader = field(work, "readerId")?;
        let event_id = field(work, "eventId")?;
        let epoch = field(work, "epoch")?;
        let remaining = field(work, "remaining")?.as_int()? as usize;
        let mut finished = false;
        let mut copied = 0;
        let cursor = match work.field("cursor")? {
            Value::Null => None,
            Value::String(hex) => Some(crate::value::decode_bytes_hex(hex).ok_or_else(|| refusal("E_TIMELINE_SHAPE", "invalid delivery cursor; restore the complete store"))?),
            _ => return Err(refusal("E_TIMELINE_SHAPE", "invalid delivery cursor; restore the complete store")),
        };
        let mut last = None;
        let mut visited = 0;
        match kind.as_str() {
            "delivery" => {
                if let Some(event) = self.timeline_get(&t.table("Posts"), "byId", vec![event_id.clone()])? {
                    let (edges, keys) = self.timeline_page(&t.edges[0], &t.followed_index, vec![actor.clone()], DELIVERY_CHUNK, false, cursor.as_deref())?;
                    visited = edges.len(); last = keys.last().cloned();
                    for edge in edges {
                        let follower = field(&edge, &t.edges[1])?;
                        if follower != actor {
                            if let Some(admission) = self.timeline_edge(t, &follower, &actor)? {
                                let epoch = field(&admission, "epoch")?;
                                // Backfill alone owns events born before this edge.
                                if epoch.as_str()? < work.field("admitted")?.as_str()? {
                                    self.timeline_copy(t, &event, follower.as_str()?, epoch)?;
                                }
                            }
                        }
                    }
                }
            }
            "backfill" => {
                if self.timeline_follows(t, &reader, &actor, &epoch)? {
                    let (events, keys) = self.timeline_page(&t.table("Posts"), "byActorTime", vec![actor.clone()], DELIVERY_CHUNK.min(remaining as u32), true, cursor.as_deref())?;
                    visited = events.len(); last = keys.last().cloned();
                    for event in events {
                        let delivery = required(self.timeline_get(&t.table("Work"), "byId", vec![Value::Id(Self::timeline_delivery_id(t, &actor, event.field("id")?))])?, "FEED_APP_NOT_FOUND")?;
                        if delivery.field("admitted")?.as_str()? < epoch.as_str()? {
                            self.timeline_copy(t, &event, reader.as_str()?, epoch.clone())?;
                            copied += 1;
                        }
                    }
                    finished = copied == remaining;
                }
            }
            "cleanup" => {
                // Only the retired edge's copies are deleted. A refollow has
                // a fresh epoch, so even delayed cleanup cannot touch its rows.
                let (copies, keys) = self.timeline_page(&t.table("Feed"), "byReaderActor", vec![reader, actor, epoch], DELIVERY_CHUNK, false, cursor.as_deref())?;
                visited = copies.len(); last = keys.last().cloned();
                for copy in copies { self.delete(&t.table("Feed"), &text(&copy, "id")?)?; }
            }
            "purge" => {
                let (copies, keys) = self.timeline_page(&t.table("Feed"), "byEvent", vec![event_id.clone()], DELIVERY_CHUNK, false, cursor.as_deref())?;
                visited = copies.len(); last = keys.last().cloned();
                for copy in copies { self.delete(&t.table("Feed"), &text(&copy, "id")?)?; }
                if visited < DELIVERY_CHUNK as usize {
                    // Retire/cancel the event's delivery record before its public
                    // tombstone. Backfills scan only the live event table.
                    let delivery_id = Self::timeline_delivery_id(t, &actor, &event_id);
                    if self.timeline_get(&t.table("Work"), "byId", vec![Value::Id(delivery_id.clone())])?.is_some() {
                        self.delete(&t.table("Work"), &delivery_id)?;
                    }
                    if let Some(tombstone) = self.timeline_get(&t.table("RemovedEvents"), "byEvent", vec![event_id])? {
                        self.delete(&t.table("RemovedEvents"), &text(&tombstone, "id")?)?;
                    }
                }
            }
            _ => return Err(refusal("E_TIMELINE_SHAPE", "unknown delivery work; restore the complete timeline store")),
        }
        let batch = if kind == "backfill" { DELIVERY_CHUNK.min(remaining as u32) } else { DELIVERY_CHUNK };
        if finished || visited < batch as usize {
            if kind == "delivery" {
                // Keep the admission order until removal: a later backfill must
                // distinguish old history from already-delivered newer events.
                self.update(&t.table("Work"), &field(work, "id")?, object([
                    ("status", Value::String("done".into())), ("cursor", Value::Null),
                ]).timeline_input(&super::TimelineInput(())))?;
            } else {
                self.delete(&t.table("Work"), &text(work, "id")?)?;
            }
        } else {
            let cursor = last.ok_or_else(|| refusal("E_TIMELINE_SHAPE", "delivery made no progress; restore the complete timeline store"))?;
            self.update(&t.table("Work"), &field(work, "id")?, object([("cursor", Value::String(crate::value::encode_bytes_hex(&cursor))), ("remaining", Value::Int(remaining.saturating_sub(copied) as i64))]).timeline_input(&super::TimelineInput(())))?;
        }
        Ok(())
    }
}

impl Engine {
    /// One chunk, using normal job ceilings and system authority limited to
    /// this declaration's owned tables. Application jobs cannot acquire it.
    pub fn run_timeline_chunk(&mut self, now: i64) -> Result<Option<Metered>, RuntimeError> {
        for timeline in self.schema.timelines.clone() {
            let tx = self.store.transaction()?;
            tx.savepoint("timeline_chunk")?;
            let seq = tx.next_seq()?;
            let mut runner = Runner::new(&tx, &self.schema, Context::system().at(now), Meter::new(Ceilings::job(), Cut::Abort), seq);
            let mut runner = runner.timeline_scope(super::super::timeline_authority::Authority::Transition(timeline.name.clone()));
            let work = runner.timeline_scan(&timeline.table("Work"), "byStatusTime", vec![Value::String("pending".into())], 1, false)?.pop();
            let Some(work) = work else { continue; };
            let outcome = runner.timeline_work(&timeline, &work).and_then(|()| runner.check_final_exists());
            let events = runner.events.take();
            let tables: Vec<_> = runner.written_tables.iter().cloned().collect();
            let metered = runner.meter.used;
            drop(runner);
            match outcome {
                Ok(()) => {
                    tx.record_commit(seq, now, &format!("{}:delivery", timeline.name), crate::SYSTEM_PRINCIPAL, "job", &tables, metered.rows_written)?;
                    partition::append(&tx, seq, &events)?;
                    tx.commit()?;
                    return Ok(Some(metered));
                }
                Err(error) if error.is_refusal() => {
                    tx.rollback_to("timeline_chunk")?;
                    let seq = tx.next_seq()?;
                    let mut runner = Runner::new(&tx, &self.schema, Context::system().at(now), Meter::new(Ceilings::job(), Cut::Abort), seq);
                    let mut guard = runner.timeline_scope(super::super::timeline_authority::Authority::Transition(timeline.name.clone()));
                    let message: String = error.to_string().chars().take(4000).collect();
                    guard.update(&timeline.table("Work"), &field(&work, "id")?, object([("status", Value::String("parked".into())), ("error", Value::String(message))]).timeline_input(&super::TimelineInput(())))?;
                    let tables = guard.written_tables.iter().cloned().collect::<Vec<_>>();
                    let events = guard.events.take();
                    let metered = guard.meter.used;
                    drop(guard); drop(runner);
                    tx.record_commit(seq, now, &format!("{}:delivery", timeline.name), crate::SYSTEM_PRINCIPAL, "job", &tables, metered.rows_written)?;
                    partition::append(&tx, seq, &events)?;
                    tx.commit()?;
                    return Ok(Some(metered));
                }
                Err(error) => return Err(error),
            }
        }
        Ok(None)
    }

    /// Operator counts. Work images are private to their actor or affected reader.
    pub fn timeline_work_counts(&self) -> Result<Vec<(String, u64, u64)>, RuntimeError> {
        self.schema.timelines.iter().map(|t| {
            let count = |state: &str| self.store.conn().query_row(
                "SELECT count(*) FROM r JOIN _catalog c ON r.t = c.num WHERE c.name = ?1 AND json_extract(r.data, '$.Row.status.String') = ?2",
                [&t.table("Work"), state], |row| row.get::<_, i64>(0).map(|n| n as u64)).map_err(RuntimeError::from);
            Ok((t.name.clone(), count("pending")?, count("parked")?))
        }).collect()
    }
}
