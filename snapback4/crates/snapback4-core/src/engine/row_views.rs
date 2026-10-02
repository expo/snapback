//! Row-keyed aggregate deltas and durable streaming recounts.
// @ref LLP 3000.015#3 — a mark write commits even when its changed range needs background work.
use super::{runner::Runner, write::Origin};
use crate::{
    error::{MeterKind, RuntimeError},
    rows::{Bounds, Dir},
    schema::{Maintain, row_image},
    value::Value,
};

#[cfg(feature = "sqlite")]
use crate::value::object;

// @ref LLP 3000.015#3 — devices predict from covered rows; durable recount
// work and basis timestamps belong only to the server storage build.
mod live;
mod device;
#[cfg(feature = "sqlite")]
mod batch;
#[cfg(all(test, feature = "sqlite"))]
mod range_tests;

pub const WRITER_RECOUNT: usize = 1024;
#[cfg(feature = "sqlite")]
pub const RECOUNT_CHUNK: usize = 256;

fn number(row: &Value, name: &str) -> i64 {
    row.field(name)
        .ok()
        .and_then(|v| v.as_int().ok())
        .unwrap_or(0)
}
fn pending(row: &Value) -> bool {
    row.field("recountPending") == Ok(&Value::Bool(true))
}

impl Runner<'_> {
    pub(super) fn maintain_row_views(
        &mut self,
        table: &str,
        old: Option<&Value>,
        new: Option<&Value>,
    ) -> Result<(), RuntimeError> {
        let views = self
            .schema
            .maintains
            .iter()
            .filter(|m| {
                m.row_key
                    .as_ref()
                    .is_some_and(|k| m.source == table || k.table == table)
            });
        let prepaid = std::mem::replace(&mut self.maintain_prepaid, false);
        let result = (|| {
            for m in views {
                if self.device && self.schema.tables[&m.target].sync.is_none() {
                    continue;
                }
                let key = m.row_key.as_ref().unwrap();
                if key.table == table {
                    self.reserve_row_view(m, 1)?;
                    // Reserve the same bounded scan even if the private predicate is unchanged.
                    // Execute against its original allowance, then retain only the public charge.
                    let scan = self.meter.clone();
                    let limit = self.scan_room(m).min(WRITER_RECOUNT) as u64;
                    self.meter.charge(MeterKind::Examined, limit)?;
                    self.meter.step(limit * (key.predicate.steps() * 2 + 4))?;
                    let heap = self
                        .meter
                        .ceilings
                        .heap_bytes
                        .saturating_sub(self.meter.used.heap_bytes);
                    self.meter.heap(heap)?;
                    self.meter.used.heap_bytes -= heap;
                    let reserved = std::mem::replace(&mut self.meter, scan);
                    self.maintain_prepaid = true;
                    let result = self.row_view_member(m, old, new);
                    self.meter = reserved;
                    self.maintain_prepaid = false;
                    result?;
                } else {
                    // Reserve before inspecting any recipient, including its hidden mark or work.
                    self.reserve_row_view(m, key.fanout.saturating_mul(2))?;
                    self.maintain_prepaid = true;
                    self.row_view_source(m, old, new)?;
                    self.maintain_prepaid = false;
                }
            }
            Ok(())
        })();
        self.maintain_prepaid = prepaid;
        result
    }

    // @ref LLP 3000.015#3 — two parent groups, each bounded by the declared live cap.
    fn reserve_row_view(&mut self, m: &Maintain, recipients: u64) -> Result<(), RuntimeError> {
        let k = m.row_key.as_ref().unwrap();
        let target = &self.schema.tables[&m.target];
        let image = super::write_target::row_copy_ceiling(target);
        for (kind, amount) in [
            (MeterKind::Examined, recipients.saturating_mul(4) + 4),
            (
                MeterKind::Steps,
                recipients.saturating_mul(k.predicate.steps() * 4 + 8),
            ),
            (MeterKind::RowsWritten, recipients.saturating_mul(2)),
            (
                MeterKind::IndexEntries,
                recipients.saturating_mul(2 * target.indexes.len() as u64 + 4),
            ),
            (
                MeterKind::OutputBytes,
                recipients.saturating_mul(image.saturating_mul(2)),
            ),
        ] {
            self.meter.charge(kind, amount)?;
        }
        // Member/target/work images are transient; reserve the schema bound, not their contents.
        let heap = super::write_target::row_copy_ceiling(&self.schema.tables[&k.table])
            .saturating_mul(4)
            .saturating_add(image.saturating_mul(16));
        self.meter.heap(heap)?;
        self.maintain_heap = self.maintain_heap.saturating_add(heap);
        Ok(())
    }

    fn view_get(&mut self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        self.charge_maintain(MeterKind::Examined, 1)?;
        self.metered_scan(|runner, scope| runner.tx.get(scope, table, id))
    }
    fn view_put(
        &mut self,
        table: &str,
        row: &Value,
        old: Option<&Value>,
        work: bool,
    ) -> Result<(), RuntimeError> {
        if work && old == Some(row) {
            return Ok(());
        }
        let entries = self.tx.put(table, &self.schema.tables[table], row, old)?;
        self.charge_maintain(MeterKind::IndexEntries, entries)?;
        if work {
            self.charge_maintain(MeterKind::RowsWritten, 1)?;
        } else {
            self.row_changed(table, old, Some(row), Origin::Maintained)?;
        }
        Ok(())
    }
    fn view_delete(&mut self, table: &str, old: &Value, work: bool) -> Result<(), RuntimeError> {
        let entries = self.tx.delete(table, &self.schema.tables[table], old)?;
        self.charge_maintain(MeterKind::IndexEntries, entries)?;
        if work {
            self.charge_maintain(MeterKind::RowsWritten, 1)?;
        } else {
            self.row_changed(table, Some(old), None, Origin::Maintained)?;
        }
        Ok(())
    }
    fn view_image(
        &self,
        m: &Maintain,
        member: &Value,
        total: i64,
        pending: bool,
    ) -> Result<Value, RuntimeError> {
        if !(0..=crate::value::I53_MAX).contains(&total) {
            return Err(RuntimeError::AggregateOverflow {
                maintain: "row-keyed view".into(),
                column: "value".into(),
            });
        }
        let mut fields = member
            .as_object()?
            .iter()
            .filter(|(name, _)| self.schema.tables[&m.target].columns.contains_key(*name))
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect::<std::collections::BTreeMap<_, _>>();
        fields.insert("member".into(), member.field("id")?.clone());
        fields.insert("value".into(), Value::Int(total));
        fields.insert("recountPending".into(), Value::Bool(pending));
        Ok(Value::Row(fields.into()))
    }
    fn covered_view_source(
        &mut self,
        m: &Maintain,
        u: &Value,
        index: &str,
        bounds: &Bounds,
    ) -> Result<bool, RuntimeError> {
        if !self.device {
            return Ok(true);
        }
        let k = m.row_key.as_ref().unwrap();
        let t = &self.schema.tables[&m.source];
        let prefix = std::slice::from_ref(u.field(&k.member_key)?);
        let Some(sync) = &t.sync else {
            return Ok(false);
        };
        let source_index = k.source_index();
        if self.retained_group(&m.source, &source_index, &prefix)? {
            return Ok(false);
        }
        let Some(horizon) = &sync.horizon else {
            return self.upsert_absence_proven(&m.source, &source_index, &prefix);
        };
        // An acquisition boundary proves a delivered suffix, independent of cached rows.
        // Only an audience pinned by the parent key can certify this whole source range.
        let group: &[Value] = match &sync.audience {
            crate::schema::Audience::Public => &[],
            crate::schema::Audience::Column(f) if f == &k.source_key => &prefix,
            crate::schema::Audience::Target { prefix: fields, .. }
                if fields.len() == 1 && fields[0] == k.source_key =>
            {
                &prefix
            }
            _ => return Ok(false),
        };
        if !Self::view_source_uniform(&m.source, t, &k.source_key, &prefix[0]) { return Ok(false); }
        match self.tx.acquired_boundary(&m.source, &horizon.by, &group)? {
            Some(crate::rows::AcquiredBoundary::Whole) => Ok(true),
            Some(crate::rows::AcquiredBoundary::Key(floor)) => {
                // @ref LLP 3000.020#3.2 — a public table's global suffix is not this parent's suffix.
                if group != prefix { return Ok(false); }
                let h = t.indexes[&horizon.by].components.get(group.len()).and_then(|c| c.column());
                let planned = t.indexes[index].components.get(1).and_then(|c| c.column());
                if h != planned {
                    return Ok(false);
                }
                // A certification starts from the predicate, never a resume position.
                if bounds.after.is_some() || bounds.before.is_some() || bounds.at_or_after.is_some() {
                    return Ok(false);
                }
                let Some((lo, _)) = crate::rows::scan_range(group, bounds, Dir::Asc) else {
                    return Ok(true);
                };
                Ok(lo >= floor)
            }
            None => Ok(false),
        }
    }
    fn view_source_uniform(name: &str, source: &crate::schema::Table, key: &String, parent: &Value) -> bool {
        let expression = crate::ir::Expr::Literal(parent.clone());
        let pins = crate::small_map::collect([(key, &expression)]);
        let rule = source.rules.read.device_audience_rule();
        super::rules::prefix_visibility(name, source, &rule, &pins).uniform
    }
    fn scan_room(&self, m: &Maintain) -> usize {
        let k = m.row_key.as_ref().unwrap();
        let steps = k.predicate.steps().saturating_mul(2).saturating_add(4);
        let examined = self
            .meter
            .ceilings
            .examined
            .saturating_sub(self.meter.used.examined)
            .saturating_sub(16);
        let steps = self
            .meter
            .ceilings
            .steps
            .saturating_sub(self.meter.used.steps)
            .saturating_sub(256)
            / steps;
        examined.min(steps) as usize
    }
    // Each decoded row is transient, as in the streaming aggregate consumer.
    fn view_scan(
        &mut self,
        m: &Maintain,
        u: &Value,
        old: Option<&Value>,
        index: &str,
        mut bounds: Bounds,
        limit: usize,
        live: bool,
    ) -> Result<(i64, bool, Option<Value>), RuntimeError> {
        let k = m.row_key.as_ref().unwrap();
        let prefix = std::slice::from_ref(u.field(&k.member_key)?);
        let device_live = self.device && live;
        let expiring = live && self.schema.tables[&m.source].is_expiring();
        if device_live && self.device_allowance.is_some() && !self.provisional_sequence_read {
            // @ref LLP 3000.020#3.2 — the whole predicate consumes sequences,
            // including residual source columns and provisional member bounds.
            let source_table = &self.schema.tables[&m.source];
            let member_table = &self.schema.tables[&k.table];
            let (mut source_sequence, mut member_sequence) = (false, false);
            k.predicate.each_field(&mut |field| {
                if let Some(field) = field.strip_prefix("$row.") { member_sequence |= member_table.sequences.contains_key(field); }
                else { source_sequence |= source_table.sequences.contains_key(field); }
            });
            if source_sequence { self.observe_provisional_selection(&m.source, &source_table.indexes[index], prefix)?; }
            if member_sequence { self.provisional_sequence_read |= self.is_provisional(&k.table, u)?; }
        }
        // Keep bounds/cursor storage outside the transient row allocation scope.
        let cursor_bytes = crate::rows::word_heap::key_decode(
            self.schema.tables[&m.source].indexes[index].components.len() + 1,
            crate::rows::MAX_INDEX_KEY_BYTES,
        );
        let scratch = cursor_bytes.saturating_mul(2).saturating_add(crate::rows::MAX_INDEX_KEY_BYTES as u64 * 4);
        if !self.meter.room(MeterKind::HeapBytes, scratch) {
            return Ok((0, false, None));
        }
        let outer = self.meter.mark();
        self.meter.heap(scratch)?;
        let result = (|| {
            let mut total = 0i64;
            let mut last = None;
            for _ in 0..limit {
                // @ref LLP 3000#contended-read-serving — commit the durable
                // recount cursor between complete rows, including filtered rows.
                #[cfg(feature = "sqlite")]
                if last.is_some() && self.recount_budget.is_some_and(|(at, budget)| at.elapsed() >= budget) { break; }
                self.meter.charge(MeterKind::Examined, 1)?;
                let mark = self.meter.mark();
                let next = (|| {
                    // Source-group authority was proven before recount selection;
                    // the shared candidate boundary also removes private fields before pricing.
                    let rows = self.scan_authorized(&m.source, index, &prefix, &bounds, Dir::Asc, 1, true, true, #[cfg(feature = "server-search")] None)?;
                    let Some((stored, position)) = rows.into_iter().next() else { return Ok(None); };
                    let source = match stored {
                        Some(stored) => {
                            #[cfg(feature = "sqlite")]
                            { self.rebuilt_source_rows = self.rebuilt_source_rows.saturating_add(1); }
                            stored.into_value()
                        },
                        // A rejected device candidate is expired or unreadable, never a contribution.
                        None if device_live => Value::Null,
                        None => return Err(RuntimeError::Prediction("row-view source authority is not covered".into())),
                    };
                    let selected = !matches!(source, Value::Null) && (!live
                        || !self.expired(&self.schema.tables[&m.source], &source))
                        // @ref LLP 3000.020#3.3 — retained copies never contribute to a current-row bound.
                        && (!device_live || (self.tx.current_row(&m.source, &source)? || self.is_provisional(&m.source, &source)?))
                        && k.matches(&source, u);
                    if live && selected {
                        self.note_expiry(&self.schema.tables[&m.source], &source);
                    }
                    let before = old.is_some_and(|old| k.matches(&source, old));
                    self.meter.step(k.predicate.steps() * 2 + 4)?;
                    Ok(Some((
                        i64::from(selected) - i64::from(before),
                        if expiring {
                            Value::Array(crate::key::decode(&position).unwrap().into_iter().skip(prefix.len()).collect())
                        } else { source.field("id")?.clone() },
                        position,
                    )))
                })();
                match next {
                    Err(RuntimeError::Bound {
                        kind: MeterKind::HeapBytes,
                        ..
                    }) => {
                        // A read-only attempted fetch may defer; the writer still has its
                        // untouched allowance for publishing the pending value and cursor.
                        self.meter.restore(mark);
                        return Ok((total, false, last));
                    }
                    other => {
                        self.meter.release_heap(mark);
                        let next = other?;
                        if device_live && self.read_capped() { return Ok((total, false, last)); }
                        let Some((n, id, position)) = next else {
                            return Ok((total, true, last));
                        };
                        total += n;
                        last = Some(id);
                        bounds.after = crate::key::decode(&position)
                            .map(|v| v.into_iter().skip(prefix.len()).collect());
                    }
                }
            }
            Ok((total, false, last))
        })();
        self.meter.release_heap(outer);
        result
    }
    fn row_view_member(
        &mut self,
        m: &Maintain,
        old: Option<&Value>,
        new: Option<&Value>,
    ) -> Result<(), RuntimeError> {
        let k = m.row_key.as_ref().unwrap();
        let u = new.or(old).unwrap();
        let id = u.field("id")?.as_str()?;
        let existing = self.view_get(&m.target, id)?;
        #[cfg(feature = "sqlite")]
        let work_name = m.work_table();
        if new.is_none() {
            #[cfg(feature = "sqlite")]
            if !self.device && let Some(basis) = self.view_get(&format!("$basis:{}",m.target),id)? {
                self.view_delete(&format!("$basis:{}",m.target),&basis,true)?;
            }
            if let Some(row) = existing {
                self.view_delete(&m.target, &row, false)?;
            }
            #[cfg(feature = "sqlite")]
            if !self.device {
                if let Some(work) = self.view_get(&work_name, id)? {
                    self.view_delete(&work_name, &work, true)?;
                }
            }
            return Ok(());
        }
        let u = row_image(u, &self.schema.tables[&k.table]).into_owned();
        // @ref LLP 3000.015#3 — this is the member-write recount decision point:
        // only a readable new image may select work, even over public sources.
        // Check the member first so its hidden parent cannot even select a refusal.
        #[cfg(feature = "sqlite")]
        if !self.device && !self.context.is_system()
            && (!self.check_rule(&k.table, crate::schema::Effect::Read, None, &u)?
                || !self.row_view_source_readable(m, &u)?)
        {
            return Err(RuntimeError::Structural { code: "E_VIEW_KEY", message: "member recounts require a readable member and destination source group; make the member row readable to its writers before marking (guide maintains)".into() });
        }
        // A newly readable image never inherits an unreadable old mark's schedule.
        let old = match old {
            Some(old) if self.check_rule(&k.table, crate::schema::Effect::Read, None, old)? => {
                Some(row_image(old, &self.schema.tables[&k.table]).into_owned())
            }
            _ => None,
        };
        let live = self.schema.tables[&m.source].is_expiring();
        let (mut changed, mut several) = (None, false);
        k.predicate.each_field(&mut |field| {
            if let Some(name) = field.strip_prefix("$row.")
                && old.as_ref().is_none_or(|old| old.field(name).ok() != u.field(name).ok()) {
                several |= changed.is_some_and(|previous| previous != name);
                changed = Some(name);
            }
        });
        if changed.is_none()
            && !live
            && let Some(existing) = &existing
        {
            let row = self.view_image(m, &u, number(existing, "value"), pending(existing))?;
            return self.view_put(&m.target, &row, Some(existing), false);
        }
        let mut index = k.source_index();
        let mut bounds = Bounds::default();
        let source_readable = self.row_view_source_readable(m, &u)?;
        let delta = old.as_ref().filter(|old| {
            !live
                && source_readable
                && existing.as_ref().is_some_and(|v| !pending(v))
                && old.field(&k.member_key).ok() == u.field(&k.member_key).ok()
        });
        if let Some(old) = delta {
            if !several && let Some(changed) = changed
                && let Some(f) = k.comparison_source(changed) {
                let (a, b) = (old.field(changed)?, u.field(changed)?);
                if f != k.source_key && !matches!(a, Value::Null) && !matches!(b, Value::Null) {
                    index = k.range_index(f);
                    let (lo, hi) = if a.total_cmp(b).is_gt() { (b, a) } else { (a, b) };
                    bounds.gte = Some(lo.clone());
                    bounds.lte = Some(hi.clone());
                }
            }
        }
        if self.device && !live && !self.covered_view_source(m, &u, &index, &bounds)? {
            // A held settled value remains visible, but this provisional mark cannot certify it.
            self.unknown_fact(
                &m.source,
                &k.source_index(),
                &[u.field(&k.member_key)?.clone()],
                "row-keyed view recount",
            );
            return Err(RuntimeError::Prediction("row-keyed count certification needs the server; queued without a predicted result (guide maintains)".into()));
        }
        let limit = self.scan_room(m).min(WRITER_RECOUNT);
        // @ref LLP 3000.020#3.2 — prediction uses the read's range and proof, never a durable expiry cursor.
        let (n, complete, _) = if self.device && live {
            if !source_readable { self.pending_view_read()?; }
            let (n, complete) = self.device_live_count(m, &u)?;
            (n, complete, None)
        } else if live {
            self.live_basis_scan(m, &u, None, limit)?
        } else { self.view_scan(m, &u, delta, &index, bounds, limit, false)? };
        if self.device && !complete {
            return Err(RuntimeError::Prediction("row-keyed count certification needs the server; queued without a predicted result (guide maintains)".into()));
        }
        let base = existing.as_ref().map_or(0, |v| number(v, "value"));
        let total = if complete {
            if delta.is_some() { base + n } else { n }
        } else if old.as_ref().is_some_and(|old|
            old.field(&k.member_key).ok() == u.field(&k.member_key).ok()
        ) {
            // A settled fallback belongs to one parent counting domain only.
            base
        } else {
            0
        };
        let row = self.view_image(m, &u, if live && !complete { 0 } else { total }, !complete)?;
        #[cfg(feature = "sqlite")]
        if !self.device && complete { self.set_view_basis(m, id)?; }
        self.view_put(&m.target, &row, existing.as_ref(), false)?;
        #[cfg(feature = "sqlite")]
        if !self.device {
            let work = self.view_get(&work_name, id)?;
            if complete {
                if let Some(work) = work {
                    self.view_delete(&work_name, &work, true)?;
                }
            } else {
                let next = object([
                    ("id", Value::Id(id.into())),
                    ("cursor", Value::Null),
                    ("total", Value::Int(0)),
                    ("parked", Value::Bool(false)),
                    ("at", Value::Int(self.context.now.unwrap_or(0))),
                    ("deadline", Value::Null),
                ]);
                self.view_put(&work_name, &next, work.as_ref(), true)?;
            }
        }
        Ok(())
    }
    fn row_view_source(
        &mut self,
        m: &Maintain,
        old: Option<&Value>,
        new: Option<&Value>,
    ) -> Result<(), RuntimeError> {
        let k = m.row_key.as_ref().unwrap();
        let t = &self.schema.tables[&m.source];
        let old = old.map(|v| row_image(v, t).into_owned());
        let new = new.map(|v| row_image(v, t).into_owned());
        let mut keys = Vec::new();
        for row in [&old, &new].into_iter().flatten() {
            let value = row.field(&k.source_key)?.clone();
            if !keys.contains(&value) {
                keys.push(value);
            }
        }
        for parent in keys {
            let prefix = vec![parent.clone()];
            // Predict only held current members; absent recipients do not invalidate
            // the deltas for members this device does hold.
            let bytes = super::write_target::row_copy_ceiling(&self.schema.tables[&k.table])
                .saturating_mul(4);
            self.maintain_scratch(bytes,|r| {
                let table = &r.schema.tables[&k.table];
                let index = if table.is_expiring() { k.live_member_index() } else { k.member_index() };
                let ranges = if table.is_expiring() {
                    vec![Bounds { lte: Some(Value::Null), ..Bounds::default() },
                         Bounds { gt: Some(Value::Int(r.context.now.unwrap_or(0))), ..Bounds::default() }]
                } else { vec![Bounds::default()] };
                let mut live = 0;
                for mut bounds in ranges {
                loop {
                    r.charge_maintain(MeterKind::Examined,1)?;
                    let Some((member,position))=r.metered_scan(|runner, scope| runner.tx.scan(scope,&k.table,&index,&prefix,&bounds,Dir::Asc,1))?.pop() else {break;};
                    bounds.after=crate::key::decode(&position).map(|v|v.into_iter().skip(1).collect());
                    if r.device && r.retained_row(&k.table,&member)? {continue;}
                    live+=1;if live>k.fanout {return Err(RuntimeError::Structural {code:"E_VIEW_KEY", message:"recipient cap exceeded; repair the member group (guide maintains)".into()});}
                    let member=row_image(&member,&r.schema.tables[&k.table]).into_owned();
                    if r.device && t.is_expiring() {
                        // Reuse the bounded new-image recount; a wire count is never a raw delta basis.
                        r.row_view_member(m, None, Some(&member))?;
                        continue;
                    }
                    let id=member.field("id")?.as_str()?;
                    let existing=r.view_get(&m.target,id)?;
                    #[cfg(feature = "sqlite")]
                    let at = r.view_basis(m, id)?;
                    #[cfg(not(feature = "sqlite"))]
                    let at = i64::MIN;
                    let contributes = |v: &Value| live::live_at(t,v,at) && k.matches(v,&member);
                    let delta=i64::from(new.as_ref().is_some_and(contributes))-i64::from(old.as_ref().is_some_and(contributes));
                    r.charge_maintain(MeterKind::Steps,k.predicate.steps()*2)?;
                    if existing.as_ref().is_some_and(pending) {
                        #[cfg(feature = "sqlite")]
                        if !r.device {
                            let name=m.work_table();
                            if let Some(work)=r.view_get(&name,id)? {
                                let mut next=work.as_object()?.clone();
                                next.insert("parked".into(),Value::Bool(false));
                                if let Ok(cursor)=work.field("cursor") {
                                    let at = number(&work,"at");
                                    let counted=|row:&Option<Value>| row.as_ref().is_some_and(|v| live::live_at(t,v,at) && live::before_cursor(k,t,v,cursor) && k.matches(v,&member));
                                    let change=i64::from(counted(&new))-i64::from(counted(&old));
                                    next.insert("total".into(),Value::Int(number(&work,"total")+change));
                                    // A newly inserted prefix contributor participates in the restart deadline.
                                    if let Some(v)=&new && counted(&new) && let Some(until)=live::expiry(t,v) {
                                        let deadline=work.field("deadline").ok().and_then(|v|v.as_int().ok()).map_or(until,|old|old.min(until));
                                        next.insert("deadline".into(),Value::Int(deadline));
                                    }
                                }
                                r.view_put(&name,&Value::Row(next.into()),Some(&work),true)?;
                            }
                        }
                    } else {
                        if existing.is_none() {
                            if r.device { return Err(RuntimeError::Prediction("the held member needs a settled view before predicting its delta".into())); }
                            #[cfg(feature = "sqlite")]
                            {
                                // Adoption and ordinary member writes create the value. Repair a missing
                                // value through bounded work, never an unreserved hidden source scan.
                                let row=r.view_image(m,&member,0,true)?;
                                r.view_put(&m.target,&row,None,false)?;
                                let work=object([("id",Value::Id(id.into())),("cursor",Value::Null),("total",Value::Int(0)),("parked",Value::Bool(false)),("at",Value::Int(r.context.now.unwrap_or(0))),("deadline",Value::Null)]);
                                r.view_put(&m.work_table(),&work,None,true)?;
                            }
                        }
                        else {
                            let row=r.view_image(m, &member,number(existing.as_ref().unwrap(),"value")+delta,false)?;
                            r.view_put(&m.target,&row,existing.as_ref(),false)?;
                        }
                    }
                }
                }
                Ok(())
            })?;
        }
        Ok(())
    }
    fn pending_view_read(&mut self) -> Result<(), RuntimeError> {
        if self.meter.cut == crate::meter::Cut::Abort {
            if self.device { return Err(RuntimeError::Prediction("row-keyed count certification needs the server; queued without a predicted result (guide maintains)".into())); }
            return Err(RuntimeError::Structural { code: "E_VIEW_KEY", message: "an incomplete row-keyed count cannot decide a writer; use the member row or retry after recount settlement (guide maintains)".into() });
        }
        self.timeline_pending = true;
        self.components.note(|f| f.pending = true);
        Ok(())
    }
    pub(crate) fn row_view_member_image(
        &mut self,
        m: &Maintain,
        row: &Value,
    ) -> Result<Option<Value>, RuntimeError> {
        self.authorized_member(&m.row_key.as_ref().unwrap().table, row.field("member")?.as_str()?, #[cfg(feature = "server-search")] false)
    }
    // A pure witness has no row payload. Reserve the key's admitted width,
    // then expose only existence/lifetime from the internal ledger.
    pub(super) fn row_view_member_exists(&mut self, m: &Maintain, row: &Value) -> Result<(bool, Option<i64>), RuntimeError> {
        let table = &m.row_key.as_ref().unwrap().table;
        self.authorized_scratch(crate::rows::MAX_INDEX_KEY_BYTES as u64 * 4, &[(MeterKind::Examined,1)], |runner,scope| {
            runner.meter.heap(crate::rows::MAX_INDEX_KEY_BYTES as u64 * 4)?;
            runner.meter.charge(MeterKind::Examined,1)?;
            let Some(key) = runner.tx.index_head(scope,table,"$viewLifetime",std::slice::from_ref(row.field("member")?),&Bounds::default(),Dir::Asc)? else { return Ok((false, None)); };
            if runner.schema.tables[table].is_expiring() && let Some(Value::Int(until)) = key.get(1) {
                if *until <= runner.context.now.unwrap_or(0) { return Ok((false, None)); }
                return Ok((true, Some(*until)));
            }
            Ok((true, None))
        })
    }
    // @ref LLP 3000.015#3 — a readable member does not authorize hidden source contributions.
    fn row_view_source_readable(
        &mut self,
        m: &Maintain,
        member: &Value,
    ) -> Result<bool, RuntimeError> {
        let k = m.row_key.as_ref().unwrap();
        let source = &self.schema.tables[&m.source];
        // @ref LLP 3000.020#3.2 — current authority is independent of whole-group acquisition.
        if self.device && source.is_expiring() {
            if source.sync.is_none()
                || !(self.tx.current_row(&k.table, member)? || self.is_provisional(&k.table, member)?) {
                return Ok(false);
            }
            let parent = member.field(&k.member_key)?;
            if !Self::view_source_uniform(&m.source, source, &k.source_key, parent) { return Ok(false); }
            if !source.rules.read.is_uniformly_readable() {
                // Admission restricts this rule to the parent and viewer. Check
                // current witnesses; never trust synthetic delivery provenance.
                let row = crate::value::object([("id", Value::Id(String::new())),
                    (k.source_key.as_str(), parent.clone())]);
                return Ok(self.read_authority(&m.source, &row, false)? == super::rules::Verdict::Readable);
            }
        }
        if source.rules.read.is_uniformly_readable() {
            return Ok(true);
        }
        #[cfg(feature = "sqlite")]
        if !self.device {
            if self.context.is_system() {
                return Ok(true);
            }
            let value = member.field(&k.member_key)?.clone();
            let expression = crate::ir::Expr::Literal(value.clone());
            let pins = crate::small_map::collect([(&k.source_key, &expression)]);
            let rule = source.rules.read.device_audience_rule();
            let visibility = super::rules::prefix_visibility(&m.source, source, &rule, &pins);
            if visibility.decided_true {
                return Ok(true);
            }
            if !visibility.uniform {
                return Ok(false);
            }
            let row = object([(k.source_key.as_str(), value)]);
            let rule = rule.into_owned();
            return self.authorized_scratch(self.rule_scratch(&rule), &[(MeterKind::RuleProbes, super::rules::rule_probes(&rule))], |runner, scope|
                runner.evaluate_sequence_rule(scope, &m.source, &rule, crate::schema::Effect::Read, None, &row));
        }
        self.covered_view_source(m, member, &k.source_index(), &Bounds::default())
    }
    pub(super) fn live_row_view(
        &mut self,
        m: &Maintain,
        row: Value,
    ) -> Result<Option<Value>, RuntimeError> {
        let mark = self.meter.mark();
        let result = self.live_row_view_inner(m, row);
        // Drop the member and decode scratch, retaining the peak and any cut.
        self.meter.release_heap(mark);
        result
    }
    fn live_row_view_inner(
        &mut self,
        m: &Maintain,
        row: Value,
    ) -> Result<Option<Value>, RuntimeError> {
        self.read_tables
            .insert(m.row_key.as_ref().unwrap().table.clone());
        self.read_tables.insert(m.source.clone());
        let Some(member) = self.row_view_member_image(m, &row)? else {
            return Ok(None);
        };
        if !self.row_view_source_readable(m, &member)? {
            if self.device && self.schema.tables[&m.source].is_expiring()
                && m.row_key.as_ref().unwrap().device_range(&self.schema.tables[&m.source])
                    .is_some_and(|plan| plan.lower_bound(&member).is_some()) {
                let k = m.row_key.as_ref().unwrap();
                self.unknown_fact(&m.source, &k.source_index(), std::slice::from_ref(member.field(&k.member_key)?), "row-keyed source authority");
            }
            self.pending_view_read()?;
            return Ok(Some(self.view_image(m, &member, 0, true)?));
        }
        if self.schema.tables[&m.source].is_expiring() {
            #[cfg(feature = "sqlite")]
            if !self.device {
                let bytes=crate::rows::disclosed::decode_reservation(&self.schema.tables[&m.source]);
                let result = self.disclosed_scratch(bytes,&[(MeterKind::Examined,1),(MeterKind::Steps,1)], |runner,_| {
                    // Certification depends only on the current live basis, never
                    // on the historical work record or stored pending bit.
                    let (n, complete, _) = runner.live_basis_scan(m,&member,None,usize::MAX)?;
                    Ok(complete.then_some(n))
                })?;
                if result.is_none() { self.pending_view_read()?; }
                return Ok(Some(self.view_image(m,&member,result.unwrap_or(0),result.is_none())?));
            }
            let (total, complete) = self.device_live_count(m, &member)?;
            if !complete { self.pending_view_read()?; }
            return Ok(Some(self.view_image(m, &member, total, !complete)?));
        }
        if pending(&row) { self.pending_view_read()?; }
        Ok(Some(row))
    }
}

#[cfg(feature = "sqlite")]
impl Runner<'_> {
    pub(super) fn rebuild_row_view(&mut self, m: &Maintain) -> Result<(), RuntimeError> {
        for table in [&m.target, &m.work_table(), &format!("$basis:{}",m.target)] {
            loop {
                let rows = self.metered_scan(|runner, scope| runner.tx.scan(scope, table, "byId", &[], &Bounds::default(), Dir::Asc, 256))?;
                if rows.is_empty() {
                    break;
                }
                for (row, _) in rows {
                    self.view_delete(table, &row, table != &m.target)?;
                }
            }
        }
        let k = m.row_key.as_ref().unwrap();
        let mut bounds = Bounds::default();
        loop {
            let rows = self.metered_scan(|runner, scope| runner.tx.scan(scope, &k.table, "byId", &[], &bounds, Dir::Asc, 256))?;
            if rows.is_empty() {
                break;
            }
            for (row, position) in rows {
                bounds.after = crate::key::decode(&position);
                self.row_view_member(m, None, Some(&row))?;
            }
        }
        Ok(())
    }
    fn recount_chunk(&mut self, m: &Maintain, work: &Value) -> Result<(), RuntimeError> {
        let k = m.row_key.as_ref().unwrap();
        let id = work.field("id")?.as_str()?;
        let Some(member) = self.view_get(&k.table, id)? else {
            return self.view_delete(&m.work_table(), work, true);
        };
        let member = row_image(&member, &self.schema.tables[&k.table]).into_owned();
        let existing = self.view_get(&m.target, id)?;
        let now = self.context.now.unwrap_or(0);
        let restart = work.field("deadline").ok().and_then(|v|v.as_int().ok()).is_some_and(|until|until<=now);
        let cursor = if restart { &Value::Null } else { work.field("cursor")? };
        let bounds = match cursor {
            Value::Id(id) => Bounds { after: Some(vec![Value::Id(id.clone()),Value::Id(id.clone())]), ..Default::default() },
            _ => Bounds::default(),
        };
        let limit = self.scan_room(m).min(RECOUNT_CHUNK);
        // The chunk's earliest contributing expiry is recorded on the work row, never emitted as an answer deadline.
        let recount_expiry = self.next_expiry.scope();
        let (n, complete, last) = if self.schema.tables[&m.source].is_expiring() {
            self.live_basis_scan(m,&member,Some(cursor),limit)?
        } else { self.view_scan(m,&member,None,&k.source_index(),bounds,limit,false)? };
        let deadline = recount_expiry.defer().deadline().into_iter().chain(if restart { None } else { work.field("deadline").ok().and_then(|v|v.as_int().ok()) }).min();
        if !complete && last.is_none() {
            return Err(RuntimeError::Structural { code: "E_VIEW_KEY", message: "one source row does not fit a recount chunk; reduce its payload, then retry the pending view (guide maintains)".into() });
        }
        let total = if restart { n } else { number(work, "total") + n };
        if complete {
            self.set_view_basis(m, id)?;
            let row = self.view_image(m, &member, total, false)?;
            self.view_put(&m.target, &row, existing.as_ref(), self.schema.tables[&m.source].is_expiring())?;
            self.view_delete(&m.work_table(), work, true)
        } else {
            let next = object([
                ("id", Value::Id(id.into())),
                (
                    "cursor",
                    last.unwrap_or_else(|| work.field("cursor").unwrap().clone()),
                ),
                ("total", Value::Int(total)),
                ("parked", Value::Bool(false)),
                    ("at", Value::Int(self.context.now.unwrap_or(0))),
                    ("deadline", deadline.map(Value::Int).unwrap_or(Value::Null)),
            ]);
            self.view_put(&m.work_table(), &next, Some(work), true)
        }
    }
}

/// A private cache transaction made progress without a public commit.
#[cfg(feature = "sqlite")]
#[derive(Debug)]
pub enum ViewChunk { Private, Published(crate::meter::Metered) }

#[cfg(feature = "sqlite")]
impl super::Engine {
    /// Publish one bounded non-expiring recount chunk. Expiring caches are
    /// reconciled in bounded durable transactions without public progress;
    /// restart resumes their stored cursor.
    pub fn run_view_chunk(
        &mut self,
        now: i64,
    ) -> Result<Option<ViewChunk>, RuntimeError> {
        self.run_view_chunk_for(now, std::time::Duration::MAX)
    }

    /// Background callers yield the engine between bounded durable chunks.
    pub fn run_view_chunk_for(&mut self, now: i64, budget: std::time::Duration) -> Result<Option<ViewChunk>, RuntimeError> {
        let started = std::time::Instant::now();
        use crate::{
            Ceilings, Context,
            meter::{Cut, Meter},
            partition,
        };
        for m in self
            .schema
            .maintains
            .iter()
            .filter(|m| m.row_key.is_some())
            .cloned()
            .collect::<Vec<_>>()
        {
            loop {
                let tx = self.store.transaction()?;
                let Some((work, _)) = tx
                    .scan(
                        &m.work_table(),
                        "byReady",
                        &[Value::Bool(false)],
                        &Bounds::default(),
                        Dir::Asc,
                        1,
                    )?
                    .pop()
                else {
                    break;
                };
                let private = self.schema.tables[&m.source].is_expiring();
                let seq = if private { 0 } else { tx.next_seq()? };
                let mut runner = Runner::new(
                    &tx,
                    &self.schema,
                    Context::system().at(now),
                    Meter::new(Ceilings::job(), Cut::Abort),
                    seq,
                );
                runner.recount_budget = Some((started, budget));
                if let Err(error) = runner.recount_chunk(&m, &work) {
                    if !matches!(
                        error,
                        RuntimeError::Structural {
                            code: "E_VIEW_KEY",
                            ..
                        }
                    ) {
                        return Err(error);
                    }
                    // A no-progress chunk has made no writes. Park it durably so the
                    // next tick can settle another member; a member edit retries it.
                    let mut parked = work.as_object()?.clone();
                    parked.insert("parked".into(), Value::Bool(true));
                    runner.view_put(
                        &m.work_table(),
                        &Value::Row(parked.into()),
                        Some(&work),
                        true,
                    )?;
                }
                let events = runner.events.take();
                let tables = runner.written_tables.iter().cloned().collect::<Vec<_>>();
                let metered = runner.meter.used;
                drop(runner);
                // Expiring values are already certified from the live basis at
                // every public read. Advance the private cache by one bounded durable
                // chunk without manufacturing redundant sequence/log activity.
                if private { tx.commit()?; return Ok(Some(ViewChunk::Private)); }
                tx.record_commit(
                    seq,
                    now,
                    &format!("{}:recount", m.target),
                    crate::SYSTEM_PRINCIPAL,
                    "job",
                    &tables,
                    metered.rows_written,
                )?;
                partition::append(&tx, seq, &events)?;
                tx.commit()?;
                return Ok(Some(ViewChunk::Published(metered)));
            }
        }
        Ok(None)
    }
}

#[cfg(all(test, feature = "sqlite"))]
mod tests;
