//! Engine-owned delivery queue. Every bounded chunk and its cursor share a commit.
// @ref LLP 3000.013#4-following-without-caps — derived delivery survives crashes and replay.
use super::*;
use crate::{engine::Engine, Context, Ceilings, meter::{Meter, Cut, Metered}, partition};
use crate::schema::timeline::DELIVERY_CHUNK;
use std::time::{Duration, Instant};

// Leave room for the log, cursor and durable commit after copying. A row and
// SQLite commit are indivisible; this is a cooperative budget, not a timeout.
const DELIVERY_TIME: Duration = Duration::from_millis(1);

#[derive(Default)]
struct Progress { visited: usize, copied: usize, last: Option<Vec<u8>>, exhausted: bool }
impl Progress {
    fn exhausted() -> Self { Self { exhausted: true, ..Self::default() } }
}

impl Runner<'_> {
    fn timeline_follows(&mut self, t: &Timeline, reader: &Value, actor: &Value, epoch: &Value) -> Result<bool, RuntimeError> {
        Ok(self.timeline_edge(t, reader, actor)?.is_some_and(|edge| edge.field("epoch").ok() == Some(epoch)))
    }

    /// Read short pages so a time slice does not repeatedly decode and charge
    /// the unused suffix of a 256-row page. Every page still uses the ordinary
    /// ruled, metered scan; the chunk retains the same total count ceiling.
    fn timeline_walk(
        &mut self, table: &str, index: &str, prefix: Vec<Value>, reverse: bool,
        cursor: Option<&[u8]>, limit: u32, started: Instant, budget: Duration,
        mut visit: impl FnMut(&mut Self, Value) -> Result<usize, RuntimeError>,
    ) -> Result<Progress, RuntimeError> {
        let mut progress = Progress::default();
        while progress.visited < limit as usize {
            if progress.visited > 0 && started.elapsed() >= budget { return Ok(progress); }
            let take = 32.min(limit - progress.visited as u32);
            let (rows, keys) = self.timeline_page(table, index, prefix.clone(), take, reverse, progress.last.as_deref().or(cursor))?;
            let count = rows.len();
            for (row, key) in rows.into_iter().zip(keys) {
                if progress.visited > 0 && started.elapsed() >= budget { return Ok(progress); }
                progress.copied += visit(self, row)?;
                progress.visited += 1;
                progress.last = Some(key);
            }
            if count < take as usize { progress.exhausted = true; break; }
        }
        if limit == 0 { progress.exhausted = true; }
        Ok(progress)
    }

    fn timeline_work(&mut self, t: &Timeline, work: &Value, started: Instant, budget: Duration) -> Result<(), RuntimeError> {
        let kind = text(work, "kind")?;
        let actor = field(work, "actorId")?;
        let reader = field(work, "readerId")?;
        let event_id = field(work, "eventId")?;
        let epoch = field(work, "epoch")?;
        let remaining = field(work, "remaining")?.as_int()? as usize;
        let cursor = match work.field("cursor")? {
            Value::Null => None,
            Value::String(hex) => Some(crate::value::decode_bytes_hex(hex).ok_or_else(|| refusal("E_TIMELINE_SHAPE", "invalid delivery cursor; restore the complete store"))?),
            _ => return Err(refusal("E_TIMELINE_SHAPE", "invalid delivery cursor; restore the complete store")),
        };
        let progress = match kind.as_str() {
            "delivery" => {
                if let Some(event) = self.timeline_get(&t.table("Posts"), "byId", vec![event_id.clone()])? {
                    // The event cannot change during this transaction. Validate
                    // its tombstone once, while still validating each edge epoch.
                    self.timeline_require_live_id(t, &event_id)?;
                    self.timeline_walk(&t.edges[0], &t.followed_index, vec![actor.clone()], false,
                        cursor.as_deref(), DELIVERY_CHUNK, started, budget, |runner, edge| {
                            let follower = field(&edge, &t.edges[1])?;
                            if follower != actor {
                                if let Some(admission) = runner.timeline_edge(t, &follower, &actor)? {
                                    let epoch = field(&admission, "epoch")?;
                                    // Backfill alone owns events born before this edge.
                                    if epoch.as_str()? < work.field("admitted")?.as_str()? {
                                        runner.timeline_copy_live(t, &event, follower.as_str()?, epoch)?;
                                    }
                                }
                            }
                            Ok(0)
                        })?
                } else { Progress::exhausted() }
            }
            "backfill" => {
                if self.timeline_follows(t, &reader, &actor, &epoch)? {
                    self.timeline_walk(&t.table("Posts"), "byActorTime", vec![actor.clone()], true,
                        cursor.as_deref(), DELIVERY_CHUNK.min(remaining as u32), started, budget, |runner, event| {
                            let delivery = required(runner.timeline_get(&t.table("Work"), "byId", vec![Value::Id(Self::timeline_delivery_id(t, &actor, event.field("id")?))])?, "FEED_APP_NOT_FOUND")?;
                            if delivery.field("admitted")?.as_str()? < epoch.as_str()? {
                                runner.timeline_copy(t, &event, reader.as_str()?, epoch.clone())?;
                                Ok(1)
                            } else { Ok(0) }
                        })?
                } else { Progress::exhausted() }
            }
            "cleanup" | "purge" => {
                // Cleanup addresses only the retired edge epoch; a refollow's
                // new copies cannot enter this scan, even after a time cut.
                let (index, prefix) = if kind == "cleanup" {
                    ("byReaderActor", vec![reader, actor.clone(), epoch])
                } else { ("byEvent", vec![event_id.clone()]) };
                let progress = self.timeline_walk(&t.table("Feed"), index, prefix, false,
                    cursor.as_deref(), DELIVERY_CHUNK, started, budget, |runner, copy| {
                        runner.delete(&t.table("Feed"), &text(&copy, "id")?)?;
                        Ok(0)
                    })?;
                if kind == "purge" && progress.exhausted {
                    // Retire/cancel delivery before its public tombstone.
                    let delivery_id = Self::timeline_delivery_id(t, &actor, &event_id);
                    if self.timeline_get(&t.table("Work"), "byId", vec![Value::Id(delivery_id.clone())])?.is_some() {
                        self.delete(&t.table("Work"), &delivery_id)?;
                    }
                    if let Some(tombstone) = self.timeline_get(&t.table("RemovedEvents"), "byEvent", vec![event_id])? {
                        self.delete(&t.table("RemovedEvents"), &text(&tombstone, "id")?)?;
                    }
                }
                progress
            }
            _ => return Err(refusal("E_TIMELINE_SHAPE", "unknown delivery work; restore the complete timeline store")),
        };
        if progress.exhausted || (kind == "backfill" && progress.copied == remaining) {
            if kind == "delivery" {
                // Keep admission order until removal, for future backfills.
                self.update(&t.table("Work"), &field(work, "id")?, object([
                    ("status", Value::String("done".into())), ("cursor", Value::Null),
                ]).timeline_input(&super::TimelineInput(())))?;
            } else {
                self.delete(&t.table("Work"), &text(work, "id")?)?;
            }
        } else {
            let cursor = progress.last.ok_or_else(|| refusal("E_TIMELINE_SHAPE", "delivery made no progress; restore the complete timeline store"))?;
            self.update(&t.table("Work"), &field(work, "id")?, object([("cursor", Value::String(crate::value::encode_bytes_hex(&cursor))), ("remaining", Value::Int(remaining.saturating_sub(progress.copied) as i64))]).timeline_input(&super::TimelineInput(())))?;
        }
        Ok(())
    }
}

impl Engine {
    /// One chunk, using normal job ceilings and system authority limited to
    /// this declaration's owned tables. Application jobs cannot acquire it.
    pub fn run_timeline_chunk(&mut self, now: i64) -> Result<Option<Metered>, RuntimeError> {
        self.run_timeline_chunk_for(now, DELIVERY_TIME)
    }

    /// A cooperative time slice, ending only between atomic rows. The cursor
    /// records the last processed row, never the end of the prefetched page.
    /// A zero budget still processes one row so recovery always makes progress.
    pub fn run_timeline_chunk_for(&mut self, now: i64, budget: Duration) -> Result<Option<Metered>, RuntimeError> {
        let started = Instant::now();
        for timeline in self.schema.timelines.clone() {
            let tx = self.store.transaction()?;
            tx.savepoint("timeline_chunk")?;
            let seq = tx.next_seq()?;
            let mut runner = Runner::new(&tx, &self.schema, Context::system().at(now), Meter::new(Ceilings::job(), Cut::Abort), seq);
            let mut runner = runner.timeline_scope(super::super::timeline_authority::Authority::Transition(timeline.name.clone()));
            let work = runner.timeline_scan(&timeline.table("Work"), "byStatusTime", vec![Value::String("pending".into())], 1, false)?.pop();
            let Some(work) = work else { continue; };
            let outcome = runner.timeline_work(&timeline, &work, started, budget).and_then(|()| runner.check_final_exists());
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
