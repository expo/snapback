//! Durable event transitions under the caller's transaction and meter.
// @ref LLP 3000.013#4-following-without-caps — only own delivery is synchronous.
use super::runner::Runner;
mod slots;
#[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
mod online;
#[cfg(feature = "sqlite")]
mod work;
#[cfg(feature = "sqlite")]
pub(super) use work::Schedule;
#[cfg(feature = "sqlite")]
mod activation;
#[cfg(feature = "sqlite")]
pub(crate) use activation::{check_activation, check_activation_read_only, check_no_rebuilds};
use crate::{RuntimeError, Value};
use crate::{ir::{self, Expr, IndexKeyExpr, KeyProvenance, Read, Scan}, schema::timeline::Timeline, value::object};

// Engine-created timeline values use only declared public mappings and inputs.
pub(crate) struct TimelineInput(());

pub(super) fn refusal(code: &'static str, message: impl Into<String>) -> RuntimeError {
    RuntimeError::Structural { code, message: message.into() }
}

#[cfg(feature = "sqlite")]
pub(crate) fn check_import(schema: &crate::schema::Schema, table: &str) -> Result<(), RuntimeError> {
    if schema.timelines.iter().any(|t| t.maps(table) || t.owns(table)) {
        return Err(refusal("E_TIMELINE_IMPORT", "fixture imports cannot restore timeline history; seed the mapped rows through operations instead"));
    }
    Ok(())
}

/// Trusted row restores retain admission history too. Advance the restore
/// commit beyond every imported token so a fresh store cannot reuse an epoch.
#[cfg(feature = "sqlite")]
pub(crate) fn restored_sequence(schema: &crate::schema::Schema, table: &str, row: &Value) -> Result<u64, RuntimeError> {
    if !schema.timelines.iter().any(|t| t.owns(table)) { return Ok(0); }
    let mut sequence = 0;
    for name in ["epoch", "admitted"] {
        let Some(value) = row.field(name).ok().filter(|v| **v != Value::Null) else { continue; };
        let token = value.as_str()?;
        let invalid = || refusal("E_TIMELINE_SHAPE", "invalid engine admission order in restored timeline history; restore the complete store or use a fresh store in dev");
        if token.len() != 32 || !token.bytes().all(|b| b.is_ascii_hexdigit()) { return Err(invalid()); }
        let born = u64::from_str_radix(&token[..16], 16).map_err(|_| invalid())?;
        if born >= i64::MAX as u64 { return Err(invalid()); }
        sequence = sequence.max(born + 1);
    }
    Ok(sequence)
}

fn field(row: &Value, name: &str) -> Result<Value, RuntimeError> { Ok(row.field(name)?.clone()) }
fn text(row: &Value, name: &str) -> Result<String, RuntimeError> { Ok(row.field(name)?.as_str()?.to_owned()) }
fn require(condition: bool, code: &str) -> Result<(), RuntimeError> {
    if condition { Ok(()) } else { Err(RuntimeError::Require { site: None, code: code.into() }) }
}

fn required(value: Option<Value>, code: &str) -> Result<Value, RuntimeError> {
    value.ok_or_else(|| RuntimeError::Require { site: None, code: code.into() })
}

impl Runner<'_> {
    // @ref LLP 3000.007.003#33-f3-the-following-recipes-contract-as-a-declaration — process actual transitions, including delete/reinsert in one mutation.
    pub(super) fn timeline_transition(&mut self, table: &str, old: Option<&Value>, new: Option<&Value>) -> Result<(), RuntimeError> {
        let timelines = self.schema.timelines.iter().filter(|timeline| timeline.maps(table));
        if self.device && timelines.clone().any(|timeline| table == timeline.edges[0]) {
            return Err(RuntimeError::Prediction("timeline follow/unfollow/refollow uses server-owned background work; queue the whole mutation without prediction".into()));
        }
        for timeline in timelines {
            let mut guard = self.timeline_scope(super::timeline_authority::Authority::Transition(timeline.name.clone()));
            let runner = &mut *guard;
            // Internal scans cannot take ownership of an application's returned page.
            let page = runner.page.take();
            let depth = runner.page_depth;
            runner.page_depth += 1;
            let result = runner.timeline_apply(timeline, table, old, new);
            runner.page_depth = depth;
            runner.page = page;
            result?;
        }
        Ok(())
    }

    fn timeline_apply(&mut self, t: &Timeline, table: &str, old: Option<&Value>, new: Option<&Value>) -> Result<(), RuntimeError> {
        if table == t.posts[0] {
            if let Some(new) = new {
                let removed = !t.posts[3].is_empty() && field(new, &t.posts[3])? == Value::Bool(true);
                if old.is_none() {
                    if removed { return Err(refusal("E_TIMELINE_REMOVAL", "insert the post with its removal flag false; set it true only to remove an existing event")); }
                    if t.has_slot(self.schema, false) {
                        if !self.timeline_original_live(t, new)? { return Ok(()); }
                    } else if let Some(filter) = &t.filter {
                        self.meter.step(filter.steps())?;
                        if !filter.matches(new) { return Ok(()); }
                    }
                    let actor = text(new, &t.posts[1])?;
                    let id = text(new, "id")?;
                    self.timeline_require_live_id(t, &Value::Id(id.clone()))?;
                    let event = object([("id", Value::Id(id.clone())), ("postId", Value::Id(id)),
                        ("actorId", Value::Id(actor.clone())), ("authorId", Value::Id(actor)),
                        ("repost", Value::Bool(false)), ("at", field(new, &t.posts[2])?)]);
                    if !self.device || t.fully_synced(self.schema, false) { self.insert(&t.table("Posts"), event.clone().timeline_input(&TimelineInput(())))?; }
                    self.timeline_deliver(t, &event)?;
                } else if let Some(old) = old {
                    let was_removed = !t.posts[3].is_empty() && field(old, &t.posts[3])? == Value::Bool(true);
                    if was_removed && !removed { return Err(refusal("E_TIMELINE_REMOVAL", "a removed post cannot be restored; keep its flag true and insert a new post for new content")); }
                    if removed && !was_removed {
                        if self.timeline_original_live(t, old)? {
                            self.timeline_remove_id(t, field(old, "id")?, field(old, &t.posts[1])?, false)?;
                        }
                        else {
                            if let Some(filter) = &t.filter { self.meter.step(filter.steps())?; }
                            if t.filter.as_ref().is_none_or(|p| p.matches(old)) {
                                self.timeline_tombstone(t, field(old, "id")?, field(old, &t.posts[1])?)?;
                                self.timeline_enqueue(t, "purge", field(old, &t.posts[1])?, Value::Null, field(old, "id")?, Value::Null, 0, None)?;
                            }
                        }

                    }
                }
            }
        } else if table == t.reposts[0] {
            match (old, new) {
                (None, Some(row)) => {
                    let actor = text(row, &t.reposts[1])?;
                    let post = self.timeline_get(&t.posts[0], "byId", vec![field(row, &t.reposts[2])?])?;
                    let post = required(post, "FEED_APP_NOT_FOUND")?;
                    require(self.timeline_original_live(t, &post)?, "FEED_POST_NOT_FOUND")?;
                    // @ref LLP 3000.016#2.3 — held event metadata alone cannot justify repost prediction when removal has arrived.
                    self.timeline_require_live_id(t, &field(&post, "id")?)?;
                    let id = if t.has_slot(self.schema, true) { field(row, &t.slot(true))?.as_str()?.to_owned() } else { self.context.mint()? };
                    self.timeline_require_live_id(t, &Value::Id(id.clone()))?;
                    let event = object([("id", Value::Id(id)), ("postId", field(&post, "id")?),
                        ("actorId", Value::Id(actor)), ("authorId", field(&post, &t.posts[1])?),
                        ("repost", Value::Bool(true)), ("at", field(row, &t.reposts[3])?)]);
                    if !self.device || t.fully_synced(self.schema, true) { self.insert(&t.table("Posts"), event.clone().timeline_input(&TimelineInput(())))?; }
                    self.timeline_deliver(t, &event)?;
                }
                (Some(row), None) => {
                    if let Some(id) = self.timeline_repost_id(t, row)? {
                        self.timeline_remove_id(t, id, field(row, &t.reposts[1])?, true)?;
                    }
                }
                _ => {}
            }
        } else if table == t.edges[0] {
            #[cfg(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite")))]
            return Err(RuntimeError::Prediction("timeline edge transitions require the server".into()));
            #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
            match (old, new) {
                (None, Some(row)) => self.timeline_follow(t, row)?,
                (Some(row), None) => self.timeline_unfollow(t, row)?,
                _ => {}
            }
        }
        Ok(())
    }

    /// Transaction sequence and write ordinal form a durable total admission
    /// order, including delete/reinsert and post/follow inside one mutation.
    /// Neither component comes from an application id or wall-clock timestamp.
    fn timeline_admission(&self) -> Value {
        Value::Id(format!("{:016x}{:016x}", self.seq, self.rows_written))
    }

    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
    fn timeline_edge(&mut self, t: &Timeline, reader: &Value, actor: &Value) -> Result<Option<Value>, RuntimeError> {
        self.timeline_get(&t.table("Edges"), "byPair", vec![reader.clone(), actor.clone()])
    }

    #[cfg(feature = "sqlite")]
    fn timeline_delivery_id(t: &Timeline, actor: &Value, event: &Value) -> String {
        crate::schema::timeline::owned_id(&t.name, "Work", &[Value::String("delivery".into()), actor.clone(), Value::Null, event.clone(), Value::Null])
    }

    fn timeline_deliver(&mut self, t: &Timeline, event: &Value) -> Result<(), RuntimeError> {
        let actor = field(event, "actorId")?;
        self.timeline_copy(t, event, actor.as_str()?, Value::Null)?;
        self.timeline_enqueue(t, "delivery", actor, Value::Null, field(event, "id")?, Value::Null, 0, None)
    }

    // @ref LLP 3000.016#2.1 — own copies are predicted locally; background
    // delivery/purge work is server-owned even when a device changes a source.
    #[cfg(not(feature = "sqlite"))]
    fn timeline_enqueue(&mut self, _t: &Timeline, _kind: &str, _actor: Value, _reader: Value, _event: Value, _epoch: Value, _remaining: usize, _cursor: Option<Vec<u8>>) -> Result<(), RuntimeError> { Ok(()) }

    #[cfg(feature = "sqlite")]
    fn timeline_enqueue(&mut self, t: &Timeline, kind: &str, actor: Value, reader: Value, event: Value, epoch: Value, remaining: usize, cursor: Option<Vec<u8>>) -> Result<(), RuntimeError> {
        if self.device { return Ok(()); }
        let key = [Value::String(kind.into()), actor.clone(), reader.clone(), event.clone(), epoch.clone()];
        let id = Value::Id(crate::schema::timeline::owned_id(&t.name, "Work", &key));
        let viewer = if reader == Value::Null { actor.clone() } else { reader.clone() };
        let row = object([("viewerId", viewer), ("epoch", epoch), ("remaining", Value::Int(remaining as i64)), ("id", id.clone()), ("kind", Value::String(kind.into())), ("actorId", actor), ("readerId", reader), ("eventId", event),
            ("cursor", cursor.map(|c| Value::String(crate::value::encode_bytes_hex(&c))).unwrap_or(Value::Null)),
            ("admitted", self.timeline_admission()), ("at", Value::Int(self.context.now.unwrap_or(0))), ("status", Value::String("pending".into())), ("error", Value::Null)]);
        self.meter.heap(super::write_target::row_copy_ceiling(&self.schema.tables[&t.table("Work")]))?;
        // Resetting an existing natural-key task is safe and costs the same one
        // write as insertion. No task existence is disclosed to the application.
        self.upsert(&t.table("Work"), &id, row.timeline_input(&TimelineInput(())))
    }

    fn timeline_copy(&mut self, t: &Timeline, event: &Value, reader: &str, epoch: Value) -> Result<(), RuntimeError> {
        self.timeline_require_live_id(t, &field(event, "id")?)?;
        self.timeline_copy_live(t, event, reader, epoch)
    }

    /// Caller checked this event's tombstone in the same transaction.
    fn timeline_copy_live(&mut self, t: &Timeline, event: &Value, reader: &str, epoch: Value) -> Result<(), RuntimeError> {
        // Only own/backfill copies run as a viewer. Foreign copies run as system.
        let row = object([("readerId", Value::Id(reader.into())), ("eventId", field(event, "id")?), ("epoch", epoch.clone()),
            ("actorId", field(event, "actorId")?), ("authorId", field(event, "authorId")?),
            ("postId", field(event, "postId")?), ("repost", field(event, "repost")?), ("at", field(event, "at")?)]);
        let key = [Value::Id(reader.into()), field(event, "id")?, epoch];
        self.timeline_insert(t, "Feed", &key, row)?;
        Ok(())
    }

    fn timeline_require_live_id(&mut self, t: &Timeline, event: &Value) -> Result<(), RuntimeError> {
        // Keep the public tombstone until the last purge chunk commits. No
        // private copy collision can reveal another reader's pending state.
        require(self.timeline_get(&t.table("RemovedEvents"), "byEvent", vec![event.clone()])?.is_none(), "FEED_EVENT_REMOVED")
    }

    fn timeline_tombstone(&mut self, t: &Timeline, event: Value, actor: Value) -> Result<(), RuntimeError> {
        self.timeline_insert(t, "RemovedEvents", &[event.clone()], object([("eventId", event), ("actorId", actor)]))?;
        Ok(())
    }

    fn timeline_insert(&mut self, t: &Timeline, suffix: &str, key: &[Value], row: Value) -> Result<TimelineInsert, RuntimeError> {
        let mut fields = row.as_object()?.clone();
        fields.insert("id".into(), Value::Id(crate::schema::timeline::owned_id(&t.name, suffix, key)));
        let row = Value::Row(fields.into());
        // F3's foreign owned rows alone are skipped instead of queuing the
        // whole mutation. Evaluation errors still abort the prediction.
        if self.device && !self.evaluate_read_rule(&t.table(suffix), &row)? { return Ok(TimelineInsert::Skipped); }
        self.meter.heap(super::write_target::row_copy_ceiling(&self.schema.tables[&t.table(suffix)]))?;
        #[cfg(feature = "sqlite")]
        if suffix == "Feed" && !self.device
            && self.timeline_get(&t.table(suffix), "byReaderEvent", key.to_vec())?.is_some() { return Ok(TimelineInsert::Skipped); }
        self.insert(&t.table(suffix), row.timeline_input(&TimelineInput(())))?;
        Ok(TimelineInsert::Written)
    }

    fn timeline_get(&mut self, table: &str, index: &str, key: Vec<Value>) -> Result<Option<Value>, RuntimeError> {
        let value = self.get(&Read { site: format!("timeline/{table}/{index}"), table: table.into(), index: index.into(),
            key: key.iter().cloned().map(Expr::Literal).collect(), provenance: KeyProvenance::Shape })?;
        // Point inputs must be covered, including an absent tombstone. Retained
        // history is not current coverage and cannot justify a prediction.
        if self.device && (self.retained_group(table, index, &key)?
            || (value != Value::Null && self.retained_row(table, &value)?)) {
            self.unknown_fact(table, index, &key, "timeline input");
        }
        self.timeline_known()?;
        Ok((value != Value::Null).then_some(value))
    }

    fn timeline_page(&mut self, table: &str, index: &str, prefix: Vec<Value>, take: u32, reverse: bool, cursor: Option<&[u8]>) -> Result<(Vec<Value>, Vec<Vec<u8>>), RuntimeError> {
        let after = cursor.map(|key| Box::new(Expr::Literal(Value::Array(crate::key::decode(key).unwrap_or_default().into_iter().skip(prefix.len()).collect()))));
        let (rows, keys) = self.scan_with_keys(&Scan { cursor_pins: 0, variant: None, site: format!("timeline/{table}/{index}"), table: table.into(), index: index.into(),
            prefix: prefix.iter().cloned().map(|value| IndexKeyExpr::Scalar(Expr::Literal(value))).collect(),
            order: if reverse { ir::Order::Desc } else { ir::Order::Asc }, take: ir::Bound::Literal(take),
            existence: false, after, before: None, range: None, filter: None, opaque_cursor: false,
            merge_site: None, provenance: KeyProvenance::Shape })?;
        if self.device {
            let mut retained = self.retained_group(table, index, &prefix)?;
            for row in &rows {
                if retained { break; }
                if self.retained_row(table, row)? {
                    retained = true;
                }
            }
            if retained { self.unknown_fact(table, index, &prefix, "timeline input range"); }
        }
        self.timeline_known()?;
        Ok((rows, keys))
    }

    pub(super) fn timeline_read_pending(&mut self, table: &str, index: &str, prefix: &[Value]) -> Result<(), RuntimeError> {
        if self.meter.cut != crate::meter::Cut::Cap || !matches!(index, "byReaderTime" | "byReaderPage") || prefix.len() != 1 { return Ok(()); }
        let Some(t) = self.schema.timelines.iter().find(|t| table == t.table("Feed")) else { return Ok(()); };
        let pending = self.timeline_get(&t.table("Work"), "byReader", prefix.to_vec())?.is_some();
        if pending { self.timeline_pending = true; self.components.note(|frame| frame.pending = true); }
        Ok(())
    }

    fn timeline_known(&self) -> Result<(), RuntimeError> {
        if self.device && self.beyond_horizon {
            return Err(RuntimeError::Prediction(self.missing_fact.clone().unwrap_or_else(|| "timeline input is not held; queue without predicted rows".into())));
        }
        Ok(())
    }
}

/// No row image escapes a skipped private delivery.
enum TimelineInsert { Written, Skipped }
