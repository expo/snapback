//! Rebuild V2 from retained originals, independent reposts and the current graph.
use super::*;
use crate::schema::timeline::HISTORY_WINDOW;

// Service namespace is reserved from custom identities, and `$` cannot occur
// in a declared/minted service name. No session can own this control row.
pub(super) const REBUILD_SEAT: &str = "service:$timeline-rebuild";

impl Runner<'_> {
    pub(super) fn timeline_rebuild_id(t: &Timeline) -> String {
        crate::schema::timeline::owned_id(&t.name, "Work", &[
            Value::String("rebuild".into()), Value::Id(REBUILD_SEAT.into()),
            Value::Null, Value::Null, Value::Null,
        ])
    }

    /// Private control metadata, consulted only inside engine transitions. It
    /// never becomes a caller's row, count or ordering input. Source reads below
    /// still use their ordinary rules. Devices queue the missing original.
    pub(super) fn timeline_rebuild_state(&mut self, t: &Timeline) -> Result<Option<Value>, RuntimeError> {
        if self.device { return Ok(None); }
        debug_assert!(self.timeline_may_write(&t.table("Work"), crate::schema::Effect::Insert));
        self.meter.at(&format!("timeline/{}/rebuild", t.name));
        self.meter.step(1)?;
        self.meter.charge(crate::error::MeterKind::Examined, 1)?;
        let state = self.fetch(&t.table("Work"), &Self::timeline_rebuild_id(t))?;
        if let Some(row) = &state { self.meter.heap(row.heap_bytes())?; }
        Ok(state)
    }

    pub(super) fn timeline_rebuild_edge(&mut self, t: &Timeline, row: &Value, work: &Value) -> Result<(), RuntimeError> {
        let reader = field(row, &t.edges[1])?;
        let actor = field(row, &t.edges[2])?;
        if reader == actor || self.timeline_edge(t, &reader, &actor)?.is_some() { return Ok(()); }
        // All retained events precede this epoch, all post-adoption events
        // follow it. Wall clocks and source ids cannot change that ownership.
        let admission = text(work, "admitted")?;
        let epoch = Value::Id(format!("{}0000000000000001", &admission[..16]));
        self.timeline_insert(t, "Edges", &[reader.clone(), actor.clone()], object([
            ("readerId", reader.clone()), ("actorId", actor.clone()), ("epoch", epoch.clone()),
        ]))?;
        self.timeline_enqueue(t, "backfill", actor, reader, Value::Null, epoch, HISTORY_WINDOW, None)
    }

    pub(super) fn timeline_rebuild_original(&mut self, t: &Timeline, row: &Value, work: &Value) -> Result<(), RuntimeError> {
        if !t.posts[3].is_empty() && field(row, &t.posts[3])? == Value::Bool(true) { return Ok(()); }
        if let Some(filter) = &t.filter {
            self.meter.step(filter.steps())?;
            if !filter.matches(row) { return Ok(()); }
        }
        let actor = field(row, &t.posts[1])?;
        let id = field(row, "id")?;
        if self.timeline_get(&t.table("Posts"), "byId", vec![id.clone()])?.is_some() { return Ok(()); }
        let event = object([("id", id.clone()), ("postId", id), ("actorId", actor.clone()),
            ("authorId", actor), ("repost", Value::Bool(false)), ("at", field(row, &t.posts[2])?)]);
        self.timeline_rebuild_event(t, event, work)
    }

    pub(super) fn timeline_rebuild_repost(&mut self, t: &Timeline, row: &Value, work: &Value) -> Result<(), RuntimeError> {
        let actor = field(row, &t.reposts[1])?;
        let post_id = field(row, &t.reposts[2])?;
        if self.timeline_get(&t.table("Posts"), "byActorPost", vec![actor.clone(), post_id.clone(), Value::Bool(true)])?.is_some() { return Ok(()); }
        let post = self.timeline_get(&t.posts[0], "byId", vec![post_id.clone()])?
            .ok_or_else(|| refusal("E_TIMELINE_REDEFINE", format!("view {}: repost {} in {} references missing {} row {}; its original author cannot be rebuilt; delete this orphan repost through its owner's mutation, then rename the view to start a new rebuild", t.name, text(row, "id").unwrap_or_default(), t.reposts[0], t.posts[0], post_id.as_str().unwrap_or_default())))?;
        // An independent repost survives both removal and a newly narrowed
        // originals predicate. Its retained original still supplies attribution.
        let id = Value::Id(crate::schema::timeline::owned_id(&t.name, "RebuiltRepost", &[field(row, "id")?]));
        let event = object([("id", id), ("postId", post_id), ("actorId", actor),
            ("authorId", field(&post, &t.posts[1])?), ("repost", Value::Bool(true)), ("at", field(row, &t.reposts[3])?)]);
        self.timeline_rebuild_event(t, event, work)
    }

    fn timeline_rebuild_event(&mut self, t: &Timeline, event: Value, work: &Value) -> Result<(), RuntimeError> {
        let actor = field(&event, "actorId")?;
        let event_id = field(&event, "id")?;
        self.insert(&t.table("Posts"), event.clone())?;
        self.timeline_copy(t, &event, actor.as_str()?, Value::Null)?;
        self.timeline_enqueue(t, "delivery", actor.clone(), Value::Null, event_id.clone(), Value::Null, 0, None)?;
        // Backfill is the only foreign-copy producer for retained events.
        self.update(&t.table("Work"), &Value::Id(Self::timeline_delivery_id(t, &actor, &event_id)), object([
            ("admitted", field(work, "admitted")?), ("status", Value::String("done".into())),
        ]))
    }
}
