//! Follow keeps an immediate fifty-event preview; history and cleanup are jobs.
use super::*;

impl Runner<'_> {
    pub(super) fn timeline_follow(&mut self, t: &Timeline, row: &Value) -> Result<(), RuntimeError> {
        let reader = field(row, &t.edges[1])?;
        let actor = field(row, &t.edges[2])?;
        require(reader != actor, "FEED_CANNOT_FOLLOW_SELF")?;
        let (events, keys) = self.timeline_page(&t.table("Posts"), "byActorTime", vec![actor.clone()], t.backfill() as u32, true, None)?;
        for event in &events { self.timeline_copy(t, event, reader.as_str()?)?; }
        self.timeline_enqueue(t, "backfill", actor, reader, Value::Null, keys.last().cloned())
    }

    pub(super) fn timeline_unfollow(&mut self, t: &Timeline, row: &Value) -> Result<(), RuntimeError> {
        self.timeline_enqueue(t, "cleanup", field(row, &t.edges[2])?, field(row, &t.edges[1])?, Value::Null, None)
    }
}
