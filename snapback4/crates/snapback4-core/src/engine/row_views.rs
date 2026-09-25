//! Row-keyed aggregate deltas and durable streaming recounts.
// @ref LLP 3000.015#3 — a mark write commits even when its changed range needs background work.
use super::{runner::Runner, write::Origin};
use crate::{
    error::{MeterKind, RuntimeError},
    rows::{Bounds, Dir},
    schema::{Maintain, row_image},
    value::{Value, object},
};

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
            })
            .cloned()
            .collect::<Vec<_>>();
        let prepaid = std::mem::replace(&mut self.maintain_prepaid, false);
        let result = (|| {
            for m in views {
                if self.device && self.schema.tables[&m.target].sync.is_none() {
                    continue;
                }
                let key = m.row_key.as_ref().unwrap();
                if key.table == table {
                    self.row_view_member(&m, old, new)?;
                } else {
                    // Reserve before inspecting any recipient, including its hidden mark or work.
                    self.reserve_row_view(&m)?;
                    self.maintain_prepaid = true;
                    self.row_view_source(&m, old, new)?;
                    self.maintain_prepaid = false;
                }
            }
            Ok(())
        })();
        self.maintain_prepaid = prepaid;
        result
    }

    // @ref LLP 3000.015#3 — two parent groups, each bounded by the declared live cap.
    fn reserve_row_view(&mut self, m: &Maintain) -> Result<(), RuntimeError> {
        let k = m.row_key.as_ref().unwrap();
        let target = &self.schema.tables[&m.target];
        let recipients = k.fanout.saturating_mul(2);
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
        self.tx.get(table, id)
    }
    fn view_put(
        &mut self,
        table: &str,
        row: &Value,
        old: Option<&Value>,
        work: bool,
    ) -> Result<(), RuntimeError> {
        if old == Some(row) {
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
        let prefix = vec![u.field(&k.member_key)?.clone()];
        let Some(sync) = &t.sync else {
            return Ok(false);
        };
        if self.retained_group(&m.source, &k.source_index(), &prefix)? {
            return Ok(false);
        }
        let Some(horizon) = &sync.horizon else {
            return self.upsert_absence_proven(&m.source, &k.source_index(), &prefix);
        };
        // An acquisition boundary proves a delivered suffix, independent of cached rows.
        // Only an audience pinned by the parent key can certify this whole source range.
        let group = match &sync.audience {
            crate::schema::Audience::Public => vec![],
            crate::schema::Audience::Column(f) if f == &k.source_key => prefix.clone(),
            crate::schema::Audience::Target { prefix: fields, .. }
                if fields == &vec![k.source_key.clone()] =>
            {
                prefix.clone()
            }
            _ => return Ok(false),
        };
        let expression = crate::ir::Expr::Literal(prefix[0].clone());
        let pins = std::collections::BTreeMap::from([(&k.source_key, &expression)]);
        let rule = t.rules.read.device_audience_rule();
        if !super::rules::prefix_visibility(&m.source, t, &rule, &pins).uniform {
            return Ok(false);
        }
        match self.tx.acquired_boundary(&m.source, &horizon.by, &group)? {
            Some(crate::rows::AcquiredBoundary::Whole) => Ok(true),
            Some(crate::rows::AcquiredBoundary::Key(floor)) => {
                let h = t.indexes[&horizon.by].columns();
                let planned = t.indexes[index].columns();
                if h.get(group.len()) != planned.get(1) {
                    return Ok(false);
                }
                let mut lower = bounds.clone();
                lower.after = None;
                lower.before = None;
                let Some((lo, _)) = crate::rows::scan_range(&group, &lower, Dir::Asc) else {
                    return Ok(true);
                };
                Ok(lo >= floor)
            }
            None => Ok(false),
        }
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
        let prefix = vec![u.field(&k.member_key)?.clone()];
        // Keep bounds/cursor storage outside the transient row allocation scope.
        let cursor_bytes = crate::rows::word_heap::key_decode(
            self.schema.tables[&m.source].indexes[index]
                .components
                .len()
                + 1,
            crate::rows::MAX_INDEX_KEY_BYTES,
        );
        let scratch = cursor_bytes.saturating_mul(2) + crate::rows::word_heap::bounds(&bounds);
        if !self.meter.room(MeterKind::HeapBytes, scratch) {
            return Ok((0, false, None));
        }
        let outer = self.meter.mark();
        self.meter.heap(scratch)?;
        let result = (|| {
            let mut total = 0i64;
            let mut last = None;
            for _ in 0..limit {
                self.meter.charge(MeterKind::Examined, 1)?;
                let mark = self.meter.mark();
                let next = (|| {
                    let rows = self.tx.scan_metered(
                        &m.source,
                        index,
                        &prefix,
                        &bounds,
                        Dir::Asc,
                        1,
                        &mut self.meter,
                    )?;
                    let Some((stored, position)) = rows.into_iter().next() else {
                        return Ok(None);
                    };
                    self.meter.heap(crate::rows::word_heap::materialize(
                        &stored,
                        &self.schema.tables[&m.source],
                    ))?;
                    let source = row_image(&stored, &self.schema.tables[&m.source]);
                    let selected = (!live
                        || !self.expired(&self.schema.tables[&m.source], &source))
                        && k.matches(&source, u);
                    if live && selected {
                        self.note_expiry(&self.schema.tables[&m.source], &source);
                    }
                    let before = old.is_some_and(|old| k.matches(&source, old));
                    self.meter.step(k.predicate.steps() * 2 + 4)?;
                    Ok(Some((
                        i64::from(selected) - i64::from(before),
                        source.field("id")?.clone(),
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
                        let Some((n, id, position)) = other? else {
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
        let work_name = m.work_table();
        if new.is_none() {
            if let Some(row) = existing {
                self.view_delete(&m.target, &row, false)?;
            }
            if !self.device {
                if let Some(work) = self.view_get(&work_name, id)? {
                    self.view_delete(&work_name, &work, true)?;
                }
            }
            return Ok(());
        }
        let u = row_image(u, &self.schema.tables[&k.table]).into_owned();
        let old = old.map(|o| row_image(o, &self.schema.tables[&k.table]).into_owned());
        let changed = k.fields().iter().any(|name| {
            old.as_ref()
                .is_none_or(|old| old.field(name).ok() != u.field(name).ok())
        });
        if !changed && let Some(existing) = &existing {
            let row = self.view_image(m, &u, number(existing, "value"), pending(existing))?;
            return self.view_put(&m.target, &row, Some(existing), false);
        }
        let mut index = k.source_index();
        let mut bounds = Bounds::default();
        let delta = old.as_ref().filter(|old| {
            existing.as_ref().is_some_and(|v| !pending(v))
                && old.field(&k.member_key).ok() == u.field(&k.member_key).ok()
        });
        if let Some(old) = delta {
            let changed = k
                .fields()
                .into_iter()
                .filter(|f| old.field(f).ok() != u.field(f).ok())
                .collect::<Vec<_>>();
            if changed.len() == 1 {
                let fields = k
                    .comparisons()
                    .into_iter()
                    .filter(|(_, f)| f == &changed[0])
                    .map(|(s, _)| s)
                    .collect::<std::collections::BTreeSet<_>>();
                if fields.len() == 1 {
                    let f = fields.into_iter().next().unwrap();
                    let (a, b) = (old.field(&changed[0])?, u.field(&changed[0])?);
                    if !matches!(a, Value::Null) && !matches!(b, Value::Null) {
                        index = k.range_index(&f);
                        let (lo, hi) = if a.total_cmp(b).is_gt() {
                            (b, a)
                        } else {
                            (a, b)
                        };
                        bounds.gte = Some(lo.clone());
                        bounds.lte = Some(hi.clone());
                    }
                }
            }
        }
        if self.device && !self.covered_view_source(m, &u, &index, &bounds)? {
            // A held settled value remains visible, but this provisional mark cannot certify it.
            self.unknown_fact(
                &m.source,
                &k.source_index(),
                &[u.field(&k.member_key)?.clone()],
                "row-keyed view recount",
            );
            return Err(RuntimeError::Prediction("row-keyed view recount needs the covered source range; queued without a predicted row".into()));
        }
        let limit = self.scan_room(m).min(WRITER_RECOUNT);
        let (n, complete, _) = self.view_scan(m, &u, delta, &index, bounds, limit, false)?;
        if self.device && !complete {
            return Err(RuntimeError::Prediction("row-keyed recount exceeds this device writer's allowance; queued without a predicted value".into()));
        }
        let base = existing.as_ref().map_or(0, |v| number(v, "value"));
        let total = if complete {
            if delta.is_some() { base + n } else { n }
        } else {
            base
        };
        let row = self.view_image(m, &u, total, !complete)?;
        self.view_put(&m.target, &row, existing.as_ref(), false)?;
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
                let index = if table.expire.is_some() { k.live_member_index() } else { k.member_index() };
                let ranges = if table.expire.is_some() {
                    vec![Bounds { lte: Some(Value::Null), ..Bounds::default() },
                         Bounds { gt: Some(Value::Int(r.context.now.unwrap_or(0))), ..Bounds::default() }]
                } else { vec![Bounds::default()] };
                let mut live = 0;
                for mut bounds in ranges {
                loop {
                    r.charge_maintain(MeterKind::Examined,1)?;
                    let Some((member,position))=r.tx.scan(&k.table,&index,&prefix,&bounds,Dir::Asc,1)?.pop() else {break;};
                    bounds.after=crate::key::decode(&position).map(|v|v.into_iter().skip(1).collect());
                    if r.device && r.retained_row(&k.table,&member)? {continue;}
                    live+=1;if live>k.fanout {return Err(RuntimeError::Structural {code:"E_VIEW_KEY", message:"recipient cap exceeded; repair the member group (guide maintains)".into()});}
                    let member=row_image(&member,&r.schema.tables[&k.table]).into_owned();
                    let id=member.field("id")?.as_str()?;
                    let existing=r.view_get(&m.target,id)?;
                    let delta=i64::from(new.as_ref().is_some_and(|v|k.matches(v,&member)))-i64::from(old.as_ref().is_some_and(|v|k.matches(v,&member)));
                    r.charge_maintain(MeterKind::Steps,k.predicate.steps()*2)?;
                    if existing.as_ref().is_some_and(pending) {
                        if !r.device {
                            let name=m.work_table();
                            if let Some(work)=r.view_get(&name,id)? {
                                if let Ok(Value::Id(cursor))=work.field("cursor") {
                                    let counted=|row:&Option<Value>|row.as_ref().is_some_and(|v|v.field("id").ok().and_then(|v|v.as_str().ok()).is_some_and(|id|id<=cursor.as_str()) && k.matches(v,&member));
                                    let change=i64::from(counted(&new))-i64::from(counted(&old));
                                    let mut next=work.as_object()?.clone();next.insert("total".into(),Value::Int(number(&work,"total")+change));next.insert("parked".into(),Value::Bool(false));
                                    r.view_put(&name,&Value::Row(next.into()),Some(&work),true)?;
                                }
                            }
                        }
                    } else if delta!=0 || existing.is_none() {
                        if existing.is_none() {
                            if r.device { return Err(RuntimeError::Prediction("the held member needs a settled view before predicting its delta".into())); }
                            // Adoption and ordinary member writes create the value. Repair a missing
                            // value through bounded work, never an unreserved hidden source scan.
                            let row=r.view_image(m,&member,0,true)?;
                            r.view_put(&m.target,&row,None,false)?;
                            let work=object([("id",Value::Id(id.into())),("cursor",Value::Null),("total",Value::Int(0)),("parked",Value::Bool(false))]);
                            r.view_put(&m.work_table(),&work,None,true)?;
                        }
                        else {let row=r.view_image(m, &member,number(existing.as_ref().unwrap(),"value")+delta,false)?;r.view_put(&m.target,&row,existing.as_ref(),false)?;}
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
            return Err(RuntimeError::Structural { code: "E_VIEW_KEY", message: "an incomplete row-keyed count cannot decide a writer; use the member row or wait for complete before submitting this count-dependent write (guide maintains)".into() });
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
        let k = m.row_key.as_ref().unwrap();
        let Some(member) = self.view_get(&k.table, row.field("member")?.as_str()?)? else {
            return Ok(None);
        };
        let member = row_image(&member, &self.schema.tables[&k.table]).into_owned();
        if self.expired(&self.schema.tables[&k.table], &member) {
            return Ok(None);
        }
        self.note_expiry(&self.schema.tables[&k.table], &member);
        Ok(Some(member))
    }
    pub(super) fn live_row_view(
        &mut self,
        m: &Maintain,
        mut row: Value,
    ) -> Result<Option<Value>, RuntimeError> {
        let k = m.row_key.as_ref().unwrap();
        self.read_tables.insert(k.table.clone());
        self.read_tables.insert(m.source.clone());
        let Some(member) = self.row_view_member_image(m, &row)? else {
            return Ok(None);
        };
        if pending(&row) {
            self.pending_view_read()?;
            return Ok(Some(row));
        }
        // Expiry is a live fact even before the physical sweep reaches the source.
        if self.schema.tables[&m.source].expire.is_some() {
            let (index, bounds) = k.live_range(&member);
            if !self.covered_view_source(m, &member, &index, &bounds)? {
                self.pending_view_read()?;
                return Ok(Some(row));
            }
            let limit = if self.meter.cut == crate::meter::Cut::Abort {
                self.scan_room(m).min(WRITER_RECOUNT)
            } else {
                self.scan_room(m)
            };
            let (n, complete, _) = self.view_scan(m, &member, None, &index, bounds, limit, true)?;
            if !complete {
                self.pending_view_read()?;
            } else if let Value::Row(fields) = &mut row {
                fields.insert("value".into(), Value::Int(n));
            }
        }
        Ok(Some(row))
    }
}

#[cfg(feature = "sqlite")]
impl Runner<'_> {
    pub(super) fn rebuild_row_view(&mut self, m: &Maintain) -> Result<(), RuntimeError> {
        for table in [&m.target, &m.work_table()] {
            loop {
                let rows = self
                    .tx
                    .scan(table, "byId", &[], &Bounds::default(), Dir::Asc, 256)?;
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
            let rows = self
                .tx
                .scan(&k.table, "byId", &[], &bounds, Dir::Asc, 256)?;
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
        let bounds = match work.field("cursor")? {
            Value::Id(id) => Bounds {
                after: Some(vec![Value::Id(id.clone()), Value::Id(id.clone())]),
                ..Default::default()
            },
            _ => Bounds::default(),
        };
        let limit = self.scan_room(m).min(RECOUNT_CHUNK);
        let (n, complete, last) =
            self.view_scan(m, &member, None, &k.source_index(), bounds, limit, false)?;
        if !complete && last.is_none() {
            return Err(RuntimeError::Structural { code: "E_VIEW_KEY", message: "one source row does not fit a recount chunk; reduce its payload, then retry the pending view (guide maintains)".into() });
        }
        let total = number(work, "total") + n;
        if complete {
            let row = self.view_image(m, &member, total, false)?;
            self.view_put(&m.target, &row, existing.as_ref(), false)?;
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
            ]);
            self.view_put(&m.work_table(), &next, Some(work), true)
        }
    }
}

#[cfg(feature = "sqlite")]
impl super::Engine {
    /// One durable, bounded recount chunk; restart resumes its stored cursor.
    pub fn run_view_chunk(
        &mut self,
        now: i64,
    ) -> Result<Option<crate::meter::Metered>, RuntimeError> {
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
                continue;
            };
            let seq = tx.next_seq()?;
            let mut runner = Runner::new(
                &tx,
                &self.schema,
                Context::system().at(now),
                Meter::new(Ceilings::job(), Cut::Abort),
                seq,
            );
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
            return Ok(Some(metered));
        }
        Ok(None)
    }
}
