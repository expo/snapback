//! Trusted recipe transitions, in the caller's transaction and meter.
use super::runner::Runner;
use crate::{RuntimeError, Value};
#[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
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
            if populated(table)? { return Err(refusal("E_TIMELINE_REDEFINE", "a populated timeline cannot be removed or redefined; preserve its declaration, or use a fresh store in dev")); }
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
        let profiles = runner.timeline_scan(&t.authors[0], "byId", vec![], 1001, false)?;
        if profiles.len() > 1000 {
            return Err(refusal("E_TIMELINE_ACTIVATE", "activation can register at most 1000 authors; reduce the existing profiles before declaring the timeline"));
        }
        for profile in profiles {
            runner.timeline_register(t, &text(&profile, &t.authors[1])?)?;
        }
    }
    Ok(())
}

#[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
fn field(row: &Value, name: &str) -> Result<Value, RuntimeError> { Ok(row.field(name)?.clone()) }
#[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
fn text(row: &Value, name: &str) -> Result<String, RuntimeError> { Ok(row.field(name)?.as_str()?.to_owned()) }
#[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
fn require(condition: bool, code: &str) -> Result<(), RuntimeError> {
    if condition { Ok(()) } else { Err(RuntimeError::Require { site: None, code: code.into() }) }
}

#[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
fn required(value: Option<Value>, code: &str) -> Result<Value, RuntimeError> {
    value.ok_or_else(|| RuntimeError::Require { site: None, code: code.into() })
}

impl Runner<'_> {
    // F3a queues these mutations. Do not ship the unreachable server transition
    // implementation in the web device; F3b owns enabling device derivation.
    #[cfg(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite")))]
    pub(super) fn timeline_transition(&mut self, table: &str, _old: Option<&Value>, _new: Option<&Value>) -> Result<(), RuntimeError> {
        if self.schema.timelines.iter().any(|timeline| timeline.maps(table)) {
            return Err(refusal("E_TIMELINE_SERVER", "timeline transitions queue without prediction; execute this mutation on the server"));
        }
        Ok(())
    }

    // @ref LLP 3000.007.003#33-f3-the-following-recipes-contract-as-a-declaration — process actual transitions, including delete/reinsert in one mutation.
    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
    pub(super) fn timeline_transition(&mut self, table: &str, old: Option<&Value>, new: Option<&Value>) -> Result<(), RuntimeError> {
        let timelines: Vec<_> = self.schema.timelines.iter().filter(|timeline| timeline.maps(table)).cloned().collect();
        for timeline in timelines {
            if self.device { return Err(refusal("E_TIMELINE_SERVER", "timeline transitions queue without prediction; execute this mutation on the server")); }
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

    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
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
            match (old, new) {
                (None, Some(row)) => self.timeline_follow(t, row)?,
                (Some(row), None) => self.timeline_unfollow(t, row)?,
                _ => {}
            }
        }
        Ok(())
    }

    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
    fn timeline_profile(&mut self, t: &Timeline, principal: &str) -> Result<(), RuntimeError> {
        let table = self.schema.table(&t.authors[0]).ok_or_else(|| refusal("E_TIMELINE_SHAPE", "timeline author table is missing"))?;
        let index = table.indexes.iter().find(|(_, index)| index.unique && index.is_plain() && index.columns() == [t.authors[1].clone()])
            .map(|(name, _)| name.clone()).ok_or_else(|| refusal("E_TIMELINE_SHAPE", "timeline author identity index is missing"))?;
        require(self.timeline_get(&t.authors[0], &index, vec![Value::Id(principal.into())])?.is_some(), "FEED_APP_NOT_FOUND")
    }

    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
    fn timeline_register(&mut self, t: &Timeline, actor: &str) -> Result<Value, RuntimeError> {
        if let Some(mode) = self.timeline_get(&t.table("Authors"), "byPrincipal", vec![Value::Id(actor.into())])? { return Ok(mode); }
        self.timeline_insert(t, "Authors", &[Value::Id(actor.into())], object([("principal", Value::Id(actor.into())), ("shared", Value::Bool(false))]))
    }

    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
    fn timeline_mode(&mut self, t: &Timeline, actor: &str) -> Result<Value, RuntimeError> {
        let mode = self.timeline_get(&t.table("Authors"), "byPrincipal", vec![Value::Id(actor.into())])?;
        required(mode, "FEED_AUTHOR_NOT_FOUND")
    }

    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
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

    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
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

    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
    fn timeline_require_live_id(&mut self, t: &Timeline, event: &Value) -> Result<(), RuntimeError> {
        // A pending removal may still have private copies at this digest identity.
        // Refuse using only its public tombstone before inserting an event or copy.
        // Purge deletes all copies together with the tombstone: the per-event cap
        // of 1,001 fits one chunk. A live id collides first on the public event row.
        require(self.timeline_get(&t.table("RemovedEvents"), "byEvent", vec![event.clone()])?.is_none(), "FEED_EVENT_REMOVED")
    }

    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
    fn timeline_tombstone(&mut self, t: &Timeline, event: Value, actor: Value) -> Result<(), RuntimeError> {
        self.timeline_insert(t, "RemovedEvents", &[event.clone()], object([("eventId", event), ("actorId", actor)]))?;
        Ok(())
    }

    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
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

    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
    fn timeline_pull(&mut self, t: &Timeline, reader: &str, author: &str, caller: &str) -> Result<bool, RuntimeError> {
        if reader == caller && self.timeline_get(&t.table("Pulls"), "byReaderAuthor", vec![Value::Id(reader.into()), Value::Id(author.into())])?.is_some() { return Ok(true); }
        let slots = self.timeline_get(&t.table("PullCounts"), "byReader", vec![Value::Id(reader.into())])?;
        let used = slots.as_ref().map(|row| row.field("used").and_then(Value::as_int)).transpose()?.unwrap_or(0);
        if used == 32 { return Ok(false); }
        // The ordinary source path deliberately executes Pulls -> PullTotals.
        // It is never an Origin::Maintained write that silently skips this edge.
        self.timeline_insert(t, "Pulls", &[Value::Id(reader.into()), Value::Id(author.into())], object([("readerId", Value::Id(reader.into())), ("authorId", Value::Id(author.into()))]))?;
        if let Some(slots) = slots {
            self.update(&t.table("PullCounts"), &field(&slots, "id")?, object([("used", Value::Int(used + 1))]))?;
        } else {
            self.timeline_insert(t, "PullCounts", &[Value::Id(reader.into())], object([("readerId", Value::Id(reader.into())), ("used", Value::Int(used + 1))]))?;
        }
        Ok(true)
    }

    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
    fn timeline_follow(&mut self, t: &Timeline, row: &Value) -> Result<(), RuntimeError> {
        let reader = text(row, &t.edges[1])?;
        let author = text(row, &t.edges[2])?;
        require(reader != author, "FEED_CANNOT_FOLLOW_SELF")?;
        self.timeline_profile(t, &author)?;
        self.timeline_profile(t, &reader)?;
        let mode = self.timeline_mode(t, &author)?;
        if field(&mode, "shared")? == Value::Bool(true) {
            require(self.timeline_pull(t, &reader, &author, &reader)?, "FEED_PULL_CAP")?;
        } else if self.timeline_scan(&t.edges[0], &t.followed_index, vec![Value::Id(author.clone())], 51, false)?.len() > 50 {
            require(self.timeline_pull(t, &reader, &author, &reader)?, "FEED_PULL_CAP")?;
            self.update(&t.table("Authors"), &field(&mode, "id")?, object([("shared", Value::Bool(true))]))?;
            self.timeline_pull(t, &author, &author, &reader)?;
            for follower in self.timeline_scan(&t.edges[0], &t.followed_index, vec![Value::Id(author.clone())], 1000, false)? {
                require(self.timeline_pull(t, &text(&follower, &t.edges[1])?, &author, &reader)?, "FEED_PROMOTION_PULL_CAP")?;
            }
        }
        // Membership is the newest 865 source events, not the newest pushed ones.
        for event in self.timeline_scan(&t.table("Posts"), "byActorTime", vec![Value::Id(author)], 1000, true)?.into_iter().take(865) {
            if field(&event, "shared")? == Value::Bool(false) { self.timeline_copy(t, &event, &reader, false)?; }
        }
        Ok(())
    }

    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
    fn timeline_unfollow(&mut self, t: &Timeline, row: &Value) -> Result<(), RuntimeError> {
        let reader = field(row, &t.edges[1])?;
        let author = field(row, &t.edges[2])?;
        for copy in self.timeline_scan(&t.table("Feed"), "byReaderActor", vec![reader.clone(), author.clone()], 1000, false)? {
            self.delete(&t.table("Feed"), &text(&copy, "id")?)?;
        }
        if let Some(route) = self.timeline_get(&t.table("Pulls"), "byReaderAuthor", vec![reader.clone(), author])? {
            self.delete(&t.table("Pulls"), &text(&route, "id")?)?;
            let slots = self.timeline_get(&t.table("PullCounts"), "byReader", vec![reader])?;
            let slots = required(slots, "FEED_PULL_COUNT_MISSING")?;
            let used = slots.field("used")?.as_int()?;
            if used == 1 { self.delete(&t.table("PullCounts"), &text(&slots, "id")?)?; }
            else { self.update(&t.table("PullCounts"), &field(&slots, "id")?, object([("used", Value::Int(used - 1))]))?; }
        }
        Ok(())
    }

    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
    fn timeline_insert(&mut self, t: &Timeline, suffix: &str, key: &[Value], row: Value) -> Result<Value, RuntimeError> {
        let mut fields = row.as_object()?.clone();
        fields.insert("id".into(), Value::Id(crate::schema::timeline::owned_id(&t.name, suffix, key)));
        let row = Value::Row(fields.into());
        self.meter.heap(row.heap_bytes())?;
        self.insert(&t.table(suffix), row.clone())?;
        Ok(row)
    }

    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
    fn timeline_get(&mut self, table: &str, index: &str, key: Vec<Value>) -> Result<Option<Value>, RuntimeError> {
        let value = self.get(&Read { site: format!("timeline/{table}/{index}"), table: table.into(), index: index.into(),
            key: key.into_iter().map(Expr::Literal).collect(), provenance: KeyProvenance::Shape })?;
        Ok((value != Value::Null).then_some(value))
    }

    #[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
    fn timeline_scan(&mut self, table: &str, index: &str, prefix: Vec<Value>, take: u32, reverse: bool) -> Result<Vec<Value>, RuntimeError> {
        self.scan(&Scan { site: format!("timeline/{table}/{index}"), table: table.into(), index: index.into(),
            prefix: prefix.into_iter().map(|value| IndexKeyExpr::Scalar(Expr::Literal(value))).collect(),
            order: if reverse { ir::Order::Desc } else { ir::Order::Asc }, take: ir::Bound::Literal(take),
            existence: false, after: None, before: None, range: None, filter: None, opaque_cursor: false,
            merge_site: None, provenance: KeyProvenance::Shape })
    }
}
