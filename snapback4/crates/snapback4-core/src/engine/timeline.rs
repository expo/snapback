//! Trusted recipe transitions, in the caller's transaction and meter.
use super::runner::Runner;
#[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
mod online;
use crate::{RuntimeError, Value};
use crate::{ir::{self, Expr, IndexKeyExpr, KeyProvenance, Read, Scan}, schema::timeline::Timeline, value::object};

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

// @ref LLP 3000.007.003#33-f3-the-following-recipes-contract-as-a-declaration — activation is event-free, not a historical rebuild.
#[cfg(feature = "sqlite")]
pub(crate) fn check_activation(tx: &crate::store::Tx<'_>, schema: &crate::schema::Schema) -> Result<(), RuntimeError> {
    use rusqlite::OptionalExtension;
    let previous: Option<String> = tx.conn().query_row("SELECT schema FROM _generations WHERE generation = (SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'generation')", [], |row| row.get(0)).optional()?;
    let previous: crate::schema::Schema = previous.map(|s| crate::json_codec::from_text(&s).map_err(|e| RuntimeError::Store(e.to_string()))).transpose()?.unwrap_or_default();
    let populated = |table: &str| -> Result<bool, RuntimeError> {
        Ok(tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM r JOIN _catalog c ON r.t = c.num WHERE c.name = ?1)", [table], |row| row.get(0))?)
    };
    for old in &previous.timelines {
        if schema.timelines.iter().any(|new| old.same_declaration(new)) { continue; }
        for table in previous.tables.keys().filter(|name| old.owns(name) || old.event_tables().contains(&name.as_str())) {
            if populated(table)? { return Err(refusal("E_TIMELINE_REDEFINE", "a populated timeline cannot be removed or redefined; the first scope sizes the timeline before data exists; preserve its declaration, or use a fresh store in dev")); }
        }
    }
    for new in &schema.timelines {
        if previous.timelines.iter().any(|old| old.same_declaration(new)) { continue; }
        for table in new.event_tables() {
            if populated(table)? { return Err(refusal("E_TIMELINE_ACTIVATE", "declare the timeline before event and edge data exists; profiles may already exist; in dev use a fresh store")); }
        }
        for table in schema.tables.keys().filter(|name| new.owns(name)) {
            if populated(table)? { return Err(refusal("E_TIMELINE_ACTIVATE", "timeline-owned names already contain data; declare the timeline before data exists; in dev use a fresh store")); }
        }
    }
    Ok(())
}

/// Register pre-existing profiles inside the same activation transaction. The
/// generation barrier reacquires these rows; activation emits no publication.
#[cfg(feature = "sqlite")]
pub(crate) fn activate_profiles(tx: &crate::store::Tx<'_>, schema: &crate::schema::Schema, previous: Option<&crate::schema::Schema>) -> Result<(), RuntimeError> {
    use crate::{Context, Ceilings, meter::{Meter, Cut}};
    let added: Vec<_> = schema.timelines.iter().filter(|t| previous.is_none_or(|old| !old.timelines.iter().any(|prior| prior.same_declaration(t)))).collect();
    if added.is_empty() { return Ok(()); }
    let mut runner = Runner::new(tx, schema, Context::system().at(crate::now_ms()), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
    for t in added {
        let mut runner = runner.timeline_scope(super::timeline_authority::Authority::Transition(t.name.clone()));
        let profiles = runner.timeline_scan(&t.authors[0], "byId", vec![], t.author_cap.saturating_add(1), false)?;
        if profiles.len() > t.author_cap as usize {
            return Err(refusal("E_TIMELINE_ACTIVATE", format!("activation can register at most {} authors; size the timeline or reduce the existing profiles before declaring it", t.author_cap)));
        }
        for profile in profiles {
            runner.timeline_register(t, &text(&profile, &t.authors[1])?)?;
        }
    }
    Ok(())
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
        let timelines: Vec<_> = self.schema.timelines.iter().filter(|timeline| timeline.maps(table)).cloned().collect();
        if self.device && timelines.iter().any(|timeline| table == timeline.edges[0]) {
            return Err(RuntimeError::Prediction("timeline follow/unfollow/refollow reads online-only slot counts; queue the whole mutation without prediction".into()));
        }
        for timeline in timelines {
            let mut guard = self.timeline_scope(super::timeline_authority::Authority::Transition(timeline.name.clone()));
            let runner = &mut *guard;
            // Internal scans cannot take ownership of an application's returned page.
            let page = runner.page.take();
            let depth = runner.page_depth;
            runner.page_depth += 1;
            let result = runner.timeline_apply(&timeline, table, old, new);
            runner.page_depth = depth;
            runner.page = page;
            result?;
        }
        Ok(())
    }

    fn timeline_apply(&mut self, t: &Timeline, table: &str, old: Option<&Value>, new: Option<&Value>) -> Result<(), RuntimeError> {
        if table == t.authors[0] {
            // Registration belongs to profile creation. Deletion deliberately
            // retains the mode, including permanent promotion, as the recipe does.
            if let (None, Some(row)) = (old, new) {
                self.timeline_register(t, &text(row, &t.authors[1])?)?;
            }
        } else if table == t.posts[0] {
            if let Some(new) = new {
                let removed = field(new, &t.posts[3])? == Value::Bool(true);
                if old.is_none() {
                    if removed { return Err(refusal("E_TIMELINE_REMOVAL", "insert the post with its removal flag false; set it true only to remove an existing event")); }
                    let actor = text(new, &t.posts[1])?;
                    self.timeline_profile(t, &actor)?;
                    let mode = self.timeline_mode(t, &actor)?;
                    let id = text(new, "id")?;
                    self.timeline_require_live_id(t, &Value::Id(id.clone()))?;
                    let event = object([("id", Value::Id(id.clone())), ("postId", Value::Id(id)),
                        ("actorId", Value::Id(actor.clone())), ("authorId", Value::Id(actor)),
                        ("repost", Value::Bool(false)), ("at", field(new, &t.posts[2])?), ("shared", field(&mode, "shared")?)]);
                    self.insert(&t.table("Posts"), event.clone())?;
                    self.timeline_deliver(t, &event)?;
                } else if let Some(old) = old {
                    let was_removed = field(old, &t.posts[3])? == Value::Bool(true);
                    if was_removed && !removed { return Err(refusal("E_TIMELINE_REMOVAL", "a removed post cannot be restored; keep its flag true and insert a new post for new content")); }
                    if removed && !was_removed {
                        let event = self.timeline_get(&t.table("Posts"), "byActorPost", vec![field(old, &t.posts[1])?, field(old, "id")?, Value::Bool(false)])?;
                        if let Some(event) = event { self.timeline_remove(t, &event)?; }
                        else {
                            self.timeline_tombstone(t, field(old, "id")?, field(old, &t.posts[1])?)?;
                            if let Some(copy) = self.timeline_get(&t.table("Broadcast"), "byReaderEvent", vec![field(old, &t.posts[1])?, field(old, "id")?])? {
                                self.delete(&t.table("Broadcast"), &text(&copy, "id")?)?;
                            }
                        }
                    }
                }
            }
        } else if table == t.reposts[0] {
            match (old, new) {
                (None, Some(row)) => {
                    let actor = text(row, &t.reposts[1])?;
                    self.timeline_profile(t, &actor)?;
                    let post = self.timeline_get(&t.posts[0], "byId", vec![field(row, &t.reposts[2])?])?;
                    let post = required(post, "FEED_APP_NOT_FOUND")?;
                    let original = self.timeline_get(&t.table("Posts"), "byActorPost", vec![field(&post, &t.posts[1])?, field(&post, "id")?, Value::Bool(false)])?;
                    require(original.is_some(), "FEED_POST_NOT_FOUND")?;
                    let mode = self.timeline_mode(t, &actor)?;
                    let id = self.context.mint()?;
                    self.timeline_require_live_id(t, &Value::Id(id.clone()))?;
                    let event = object([("id", Value::Id(id)), ("postId", field(&post, "id")?),
                        ("actorId", Value::Id(actor)), ("authorId", field(&post, &t.posts[1])?),
                        ("repost", Value::Bool(true)), ("at", field(row, &t.reposts[3])?), ("shared", field(&mode, "shared")?)]);
                    self.insert(&t.table("Posts"), event.clone())?;
                    self.timeline_deliver(t, &event)?;
                }
                (Some(row), None) => {
                    if let Some(event) = self.timeline_get(&t.table("Posts"), "byActorPost", vec![field(row, &t.reposts[1])?, field(row, &t.reposts[2])?, Value::Bool(true)])? {
                        self.timeline_remove(t, &event)?;
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

    fn timeline_profile(&mut self, t: &Timeline, principal: &str) -> Result<(), RuntimeError> {
        let table = self.schema.table(&t.authors[0]).ok_or_else(|| refusal("E_TIMELINE_SHAPE", "timeline author table is missing"))?;
        let index = table.indexes.iter().find(|(_, index)| index.unique && index.is_plain() && index.columns() == [t.authors[1].clone()])
            .map(|(name, _)| name.clone()).ok_or_else(|| refusal("E_TIMELINE_SHAPE", "timeline author identity index is missing"))?;
        require(self.timeline_get(&t.authors[0], &index, vec![Value::Id(principal.into())])?.is_some(), "FEED_APP_NOT_FOUND")
    }

    fn timeline_register(&mut self, t: &Timeline, actor: &str) -> Result<(), RuntimeError> {
        if self.timeline_get(&t.table("Authors"), "byPrincipal", vec![Value::Id(actor.into())])?.is_some() { return Ok(()); }
        self.timeline_insert(t, "Authors", &[Value::Id(actor.into())], object([("principal", Value::Id(actor.into())), ("shared", Value::Bool(false))]))?;
        Ok(())
    }

    fn timeline_mode(&mut self, t: &Timeline, actor: &str) -> Result<Value, RuntimeError> {
        let mode = self.timeline_get(&t.table("Authors"), "byPrincipal", vec![Value::Id(actor.into())])?;
        required(mode, "FEED_AUTHOR_NOT_FOUND")
    }

    fn timeline_deliver(&mut self, t: &Timeline, event: &Value) -> Result<(), RuntimeError> {
        let actor = text(event, "actorId")?;
        if field(event, "shared")? == Value::Bool(true) {
            self.timeline_copy(t, event, &actor, true)?;
            if self.timeline_get(&t.table("Pulls"), "byReaderAuthor", vec![Value::Id(actor.clone()), Value::Id(actor.clone())])?.is_none() {
                self.timeline_copy(t, event, &actor, false)?;
            }
        } else {
            self.timeline_copy(t, event, &actor, false)?;
            for edge in self.timeline_scan(&t.edges[0], &t.followed_index, vec![Value::Id(actor)], 1000, false)? {
                self.timeline_copy(t, event, &text(&edge, &t.edges[1])?, false)?;
            }
        }
        Ok(())
    }

    fn timeline_copy(&mut self, t: &Timeline, event: &Value, reader: &str, shared: bool) -> Result<(), RuntimeError> {
        self.timeline_require_live_id(t, &field(event, "id")?)?;
        // Fresh delivery never probes a foreign private inbox.
        let row = object([("readerId", Value::Id(reader.into())), ("eventId", field(event, "id")?),
            ("actorId", field(event, "actorId")?), ("authorId", field(event, "authorId")?),
            ("postId", field(event, "postId")?), ("repost", field(event, "repost")?), ("at", field(event, "at")?)]);
        let key = if shared { vec![field(event, "id")?] } else { vec![Value::Id(reader.into()), field(event, "id")?] };
        self.timeline_insert(t, if shared { "Broadcast" } else { "Feed" }, &key, row)?;
        Ok(())
    }

    fn timeline_require_live_id(&mut self, t: &Timeline, event: &Value) -> Result<(), RuntimeError> {
        // A pending removal may still have private copies at this digest identity.
        // Refuse using only its public tombstone before inserting an event or copy.
        // Purge deletes all copies together with the tombstone: the per-event cap
        // of 1,001 fits one chunk. A live id collides first on the public event row.
        require(self.timeline_get(&t.table("RemovedEvents"), "byEvent", vec![event.clone()])?.is_none(), "FEED_EVENT_REMOVED")
    }

    fn timeline_tombstone(&mut self, t: &Timeline, event: Value, actor: Value) -> Result<(), RuntimeError> {
        self.timeline_insert(t, "RemovedEvents", &[event.clone()], object([("eventId", event), ("actorId", actor)]))?;
        Ok(())
    }

    fn timeline_remove(&mut self, t: &Timeline, event: &Value) -> Result<(), RuntimeError> {
        let id = text(event, "id")?;
        self.timeline_tombstone(t, Value::Id(id.clone()), field(event, "actorId")?)?;
        if field(event, "shared")? == Value::Bool(true) {
            if let Some(row) = self.timeline_get(&t.table("Broadcast"), "byReaderEvent", vec![field(event, "actorId")?, Value::Id(id.clone())])? {
                self.delete(&t.table("Broadcast"), &text(&row, "id")?)?;
            }
        }
        self.delete(&t.table("Posts"), &id)
    }

    fn timeline_insert(&mut self, t: &Timeline, suffix: &str, key: &[Value], row: Value) -> Result<TimelineInsert, RuntimeError> {
        let mut fields = row.as_object()?.clone();
        fields.insert("id".into(), Value::Id(crate::schema::timeline::owned_id(&t.name, suffix, key)));
        let row = Value::Row(fields.into());
        // F3's foreign owned rows alone are skipped instead of queuing the
        // whole mutation. Evaluation errors still abort the prediction.
        if self.device && !self.evaluate_read_rule(&t.table(suffix), &row)? { return Ok(TimelineInsert::Skipped); }
        self.meter.heap(row.heap_bytes())?;
        self.insert(&t.table(suffix), row)?;
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

    fn timeline_scan(&mut self, table: &str, index: &str, prefix: Vec<Value>, take: u32, reverse: bool) -> Result<Vec<Value>, RuntimeError> {
        let rows = self.scan(&Scan { site: format!("timeline/{table}/{index}"), table: table.into(), index: index.into(),
            prefix: prefix.iter().cloned().map(|value| IndexKeyExpr::Scalar(Expr::Literal(value))).collect(),
            order: if reverse { ir::Order::Desc } else { ir::Order::Asc }, take: ir::Bound::Literal(take),
            existence: false, after: None, before: None, range: None, filter: None, opaque_cursor: false,
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
        Ok(rows)
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
