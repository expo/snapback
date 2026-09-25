//! Event witnesses travel in the source's one stored and logged image.
// @ref LLP 3000.016#21a-owned-events-follow-their-source-rows — prepare before the source write; partial events have no device row.
use super::*;

impl Runner<'_> {
    pub(crate) fn prepare_event_slots(&mut self, table: &str, old: Option<&Value>, mut row: Value) -> Result<Value, RuntimeError> {
        let timelines: Vec<_> = self.schema.timelines.iter().filter(|t| table == t.posts[0] || table == t.reposts[0]).cloned().collect();
        if timelines.is_empty() { return Ok(row); }
        self.meter.heap(row.heap_bytes())?;
        for t in timelines {
            let repost = table == t.reposts[0];
            if !t.has_slot(self.schema, repost) { continue; }
            let slot = t.slot(repost);
            let value = if repost {
                match old {
                    Some(old) => field(old, &slot)?,
                    None => {
                        self.timeline_aggregate_fence(&t, true)?;
                        Value::Id(self.context.mint()?)
                    }
                }
            } else {
                let removed = !t.posts[3].is_empty() && field(&row, &t.posts[3])? == Value::Bool(true);
                if let Some(old) = old {
                    let live = self.timeline_original_live(&t, old)?;
                    if removed && live { self.timeline_aggregate_fence(&t, false)?; }
                    Value::Bool(live && !removed)
                } else {
                    if let Some(filter) = &t.filter { self.meter.step(filter.steps())?; }
                    let live = !removed && t.filter.as_ref().is_none_or(|filter| filter.matches(&row));
                    if live { self.timeline_aggregate_fence(&t, false)?; }
                    Value::Bool(live)
                }
            };
            self.meter.step(1)?;
            self.meter.heap(80 + slot.len() as u64 + value.heap_bytes())?;
            if let Value::Row(fields) | Value::Map(fields) = &mut row { fields.insert(slot, value); }
        }
        Ok(row)
    }

    pub(super) fn timeline_aggregate_fence(&self, t: &Timeline, repost: bool) -> Result<(), RuntimeError> {
        if self.device && !t.fully_synced(self.schema, repost) {
            if let Some(aggregate) = t.synced_aggregates(self.schema).first() {
                return Err(RuntimeError::Prediction(format!("Following {} changes synced aggregate {aggregate} through a partial event; queue without predicted rows", t.name)));
            }
        }
        Ok(())
    }

    pub(super) fn timeline_original_live(&mut self, t: &Timeline, post: &Value) -> Result<bool, RuntimeError> {
        if t.has_slot(self.schema, false) {
            return match post.field(&t.slot(false)) {
                Ok(Value::Bool(live)) => Ok(*live),
                _ if self.device => Err(RuntimeError::Prediction("Following post slot is unfilled; acquire the replacement snapshot".into())),
                _ => Err(refusal("E_TIMELINE_SHAPE", "Following post slot is unfilled; adopt the source schema before writing events")),
            };
        }
        Ok(self.timeline_get(&t.table("Posts"), "byActorPost", vec![field(post, &t.posts[1])?, field(post, "id")?, Value::Bool(false)])?.is_some())
    }

    pub(super) fn timeline_repost_id(&mut self, t: &Timeline, row: &Value) -> Result<Option<Value>, RuntimeError> {
        if t.has_slot(self.schema, true) {
            return match row.field(&t.slot(true)) {
                Ok(Value::Id(id)) => Ok(Some(Value::Id(id.clone()))),
                Ok(Value::Null) => Ok(None),
                _ if self.device => Err(RuntimeError::Prediction("Following repost slot is unfilled; acquire the replacement snapshot".into())),
                _ => Err(refusal("E_TIMELINE_SHAPE", "Following repost slot is unfilled; adopt the source schema before writing events")),
            };
        }
        self.timeline_get(&t.table("Posts"), "byActorPost", vec![field(row, &t.reposts[1])?, field(row, &t.reposts[2])?, Value::Bool(true)])?
            .map(|event| field(&event, "id")).transpose()
    }

    pub(super) fn timeline_remove_id(&mut self, t: &Timeline, id: Value, actor: Value, repost: bool) -> Result<(), RuntimeError> {
        self.timeline_aggregate_fence(t, repost)?;
        self.timeline_tombstone(t, id.clone(), actor.clone())?;
        self.timeline_enqueue(t, "purge", actor, Value::Null, id.clone(), Value::Null, 0, None)?;
        if !self.device || t.fully_synced(self.schema, repost) { self.delete(&t.table("Posts"), id.as_str()?)?; }
        Ok(())
    }

    /// Ordinary event misses and unscoped ranges are withheld, not false facts.
    pub(in crate::engine) fn event_read_unknown(&mut self, table: &str, index: &str, key: &[Value], site: &str) -> bool {
        if self.device && crate::schema::timeline::partial_read(self.schema, table, index, key) {
            self.unknown_fact(table, index, key, site);
            self.components.note(|frame| frame.speculative = true);
            self.query_unavailable = true;
            true
        } else { false }
    }
}
