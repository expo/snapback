//! Follow keeps an immediate fifty-event preview of an engine-chosen history window.
use super::*;
use crate::schema::timeline::{DELIVERY_CHUNK, HISTORY_WINDOW};

impl Runner<'_> {
    pub(super) fn timeline_follow(&mut self, t: &Timeline, row: &Value) -> Result<(), RuntimeError> {
        let reader = field(row, &t.edges[1])?;
        let actor = field(row, &t.edges[2])?;
        require(reader != actor, "FEED_CANNOT_FOLLOW_SELF")?;
        let epoch = self.timeline_admission();
        self.timeline_insert(t, "Edges", &[reader.clone(), actor.clone()], object([
            ("readerId", reader.clone()), ("actorId", actor.clone()), ("epoch", epoch.clone()),
        ]))?;
        let (events, keys) = self.timeline_page(&t.table("Posts"), "byActorTime", vec![actor.clone()], (t.backfill() + 1) as u32, true, None)?;
        for event in events.iter().take(t.backfill()) { self.timeline_copy(t, event, reader.as_str()?, epoch.clone())?; }
        if events.len() > t.backfill() {
            self.timeline_enqueue(t, "backfill", actor, reader, Value::Null, epoch, HISTORY_WINDOW - t.backfill(), keys.get(t.backfill() - 1).cloned())?;
        }
        Ok(())
    }

    pub(super) fn timeline_unfollow(&mut self, t: &Timeline, row: &Value) -> Result<(), RuntimeError> {
        let reader = field(row, &t.edges[1])?;
        let actor = field(row, &t.edges[2])?;
        let edge = self.timeline_edge(t, &reader, &actor)?;
        let edge = required(edge, "FEED_APP_NOT_FOUND")?;
        let epoch = field(&edge, "epoch")?;
        self.delete(&t.table("Edges"), &text(&edge, "id")?)?;
        let (copies, keys) = self.timeline_page(&t.table("Feed"), "byReaderActor", vec![reader.clone(), actor.clone(), epoch.clone()], DELIVERY_CHUNK + 1, false, None)?;
        for copy in copies.iter().take(DELIVERY_CHUNK as usize) { self.delete(&t.table("Feed"), &text(copy, "id")?)?; }
        if copies.len() > DELIVERY_CHUNK as usize {
            self.timeline_enqueue(t, "cleanup", actor, reader, Value::Null, epoch, 0, keys.get(DELIVERY_CHUNK as usize - 1).cloned())?;
        }
        Ok(())
    }
}
