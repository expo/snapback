//! One bounded operator account, including retained input, boundaries and logs.
// @ref LLP 3000.014.000#42-bounded-bulk-call-account — no per-page budget reset or unpriced collector.
use super::*;
use crate::rows::{Bounds, Dir, Rows};
use crate::schema::{live, through::LIVE_CHILDREN};

pub(super) fn collect(
    rows: impl IntoIterator<Item = (String, Value)>,
    meter: &mut Meter,
) -> Result<Vec<(String, Value)>, RuntimeError> {
    let mut held = Vec::new();
    for (name, row) in rows {
        // Includes serialized/decoded input, retained copies, order slots and
        // geometric Vec growth; transferred caller storage is not free.
        meter.heap(
            row.retained_heap_bytes()
                .saturating_mul(8)
                .saturating_add(1024 + name.len() as u64 * 4),
        )?;
        meter.charge(MeterKind::Examined, 1)?;
        held.push((name, row));
    }
    Ok(held)
}
impl Runner<'_> {
    pub(super) fn reserve_bulk_source(&mut self, name: &str) -> Result<(), RuntimeError> {
        let table = self
            .schema
            .table(name)
            .ok_or_else(|| RuntimeError::Schema("unknown bulk table".into()))?;
        let d = crate::rows::disclosed::decode_reservation(table);
        let arms = table.sync.as_ref().map_or(0, |s| s.arms().count()) as u64;
        let dependents=self.schema.synced().filter(|(_,_,s)|matches!(&s.audience,crate::schema::Audience::Target{table,..} if table==name)).count() as u64;
        let owners = table.written_by.values().filter(|a| !a.audience).count() as u64;
        let metadata = 1024 + 4 * crate::rows::MAX_INDEX_KEY_BYTES as u64 + 4 * name.len() as u64;
        let (_, events) =
            crate::schema::reservations::event_envelope(d, arms + owners, metadata, dependents);
        let plan = crate::schema::reservations::reservation(self.schema, name)
            .ok_or_else(|| RuntimeError::Schema("bulk source needs complete prices".into()))?;
        let derived = plan
            .prices
            .iter()
            .map(|p| p[4])
            .fold(0_u64, u64::saturating_add)
            .saturating_add(plan.live.as_ref().map_or(0, |p| p.retained_heap));
        // Retain collector slots, earliest boundary maps, dense take() and
        // append's coalescer concurrently. Source scratch has its own payment.
        self.meter.heap(
            events
                .saturating_add(derived)
                .saturating_mul(4)
                .saturating_add(metadata * 8),
        )
    }
}

/// Direct trusted restoration has final-image semantics; live copies are
/// rebuilt from the final parent rather than trusting imported private fields.
pub(super) fn restore(
    tx: &dyn Rows,
    schema: &Schema,
    rows: impl IntoIterator<Item = (String, Value)>,
    seq: u64,
    now: i64,
) -> Result<(u64, Vec<partition::Event>, Vec<String>), RuntimeError> {
    let mut meter = Meter::new(Ceilings::job(), Cut::Abort);
    let mut input = collect(rows, &mut meter)?;
    let count = input.len() as u64;
    let order = schema.through_order();
    input.sort_by_key(|(n, _)| order.iter().position(|t| t == n));
    let mut runner = Runner::new(tx, schema, Context::system().at(now), meter, seq);
    let mut before = BTreeMap::<(String, String), Option<Value>>::new();
    for (name, row) in &input {
        let table = schema
            .table(name)
            .ok_or_else(|| RuntimeError::Schema("unknown restore table".into()))?;
        let id = row.field("id")?.as_str()?.to_owned();
        remember(&mut runner, &mut before, name, &id, None)?;
        if live::parent(schema, name) {
            runner.target_attempt(name, |r| {
                let children: Vec<_> = schema
                    .children(name)
                    .filter(|(_, _, e)| e.live.is_some())
                    .map(|(n, _, e)| (n.clone(), e.live.unwrap() as usize))
                    .collect();
                for (child, n) in children {
                    r.written_tables.insert(child.clone());
                    let found = r.metered_scan(|r, scope| {
                        r.tx.scan(
                            scope,
                            &child,
                            LIVE_CHILDREN,
                            &[row.field("id")?.clone()],
                            &Bounds::default(),
                            Dir::Asc,
                            n + 1,
                        )
                    })?;
                    if found.len() > n {
                        return Err(RuntimeError::Store(
                            "live restore found an invalid physical cap".into(),
                        ));
                    }
                    for (old, _) in found {
                        let id = old.field("id")?.as_str()?.to_owned();
                        remember(r, &mut before, &child, &id, Some(old))?;
                    }
                }
                Ok(())
            })?;
        }
        if table.through.as_ref().is_some_and(|t| t.live.is_some()) {
            if let Some(Some(old)) = before.get(&(name.clone(), id)) {
                let edge = table.through.as_ref().unwrap();
                if old.field(&edge.reference)? != row.field(&edge.reference)? {
                    return Err(RuntimeError::Store(
                        "live restore cannot change an immutable parent binding".into(),
                    ));
                }
            }
        }
    }
    for (name, mut row) in input {
        let table = &schema.tables[&name];
        schema.refuse_ephemeral_import(&name)?;
        if let Some(edge) = table.through.as_ref().filter(|t| t.live.is_some()) {
            runner
                .meter
                .heap(crate::rows::disclosed::decode_reservation(
                    &schema.tables[&edge.parent],
                ))?;
            let p = tx
                .get(&edge.parent, row.field(&edge.reference)?.as_str()?)?
                .ok_or_else(|| RuntimeError::Store("live restore needs every parent".into()))?;
            super::through::stamp(&schema.tables[&edge.parent], edge, &p, &mut row)?;
        }
        table.recompute_deadline(&mut row)?;
        validate::validate_row(schema, &name, &row)?;
        let id = row.field("id")?.as_str()?;
        runner
            .meter
            .heap(crate::rows::disclosed::decode_reservation(table))?;
        let old = tx.get(&name, id)?;
        runner.meter.charge(MeterKind::RowsWritten, 1)?;
        runner.meter.charge(
            MeterKind::IndexEntries,
            tx.put(&name, table, &row, old.as_ref())?,
        )?;
    }
    // Every existing off-input child of a replaced parent is in before.
    for ((name, id), _) in &before {
        let table = &schema.tables[name];
        let Some(edge) = table.through.as_ref().filter(|e| e.live.is_some()) else {
            continue;
        };
        let mark = runner.meter.mark();
        runner.meter.heap(
            crate::rows::disclosed::decode_reservation(table)
                .saturating_mul(4)
                .saturating_add(
                    2 * table.indexes.len() as u64 * crate::rows::MAX_INDEX_KEY_BYTES as u64,
                )
                .saturating_add(crate::rows::disclosed::decode_reservation(
                    &schema.tables[&edge.parent],
                )),
        )?;
        let mut row = tx
            .get(name, id)?
            .ok_or_else(|| RuntimeError::Store("live restore child disappeared".into()))?;
        let p = tx
            .get(&edge.parent, row.field(&edge.reference)?.as_str()?)?
            .ok_or_else(|| RuntimeError::Store("live restore needs every parent".into()))?;
        let old = row.clone();
        super::through::stamp(&schema.tables[&edge.parent], edge, &p, &mut row)?;
        table.recompute_deadline(&mut row)?;
        runner.meter.charge(
            MeterKind::IndexEntries,
            tx.put(name, table, &row, Some(&old))?,
        )?;
        runner.meter.release_heap(mark);
    }
    validate_final(&mut runner, now)?;
    for ((name, id), old) in before {
        runner.reserve_bulk_source(&name)?;
        let table = &schema.tables[&name];
        let new = tx.get(&name, &id)?;
        partition::row_changed(
            &mut runner,
            &name,
            old.as_ref(),
            new.as_ref(),
            super::write::Origin::Source,
        )?;
        tx.track_time_audience(
            &name,
            table,
            &id,
            new.as_ref(),
            now,
            new.as_ref().is_some_and(|r| table.live(r, now)),
        )?;
        runner.written_tables.insert(name);
    }
    let tables = runner.written_tables.iter().cloned().collect();
    // reserve_bulk_source has held the dense Vec/coalescer peak all along.
    let events = runner.events.take();
    Ok((count, events, tables))
}
fn remember(
    runner: &mut Runner<'_>,
    before: &mut BTreeMap<(String, String), Option<Value>>,
    name: &str,
    id: &str,
    provided: Option<Value>,
) -> Result<(), RuntimeError> {
    if before.contains_key(&(name.to_owned(), id.to_owned())) {
        return Ok(());
    }
    let d = crate::rows::disclosed::decode_reservation(&runner.schema.tables[name]);
    runner.meter.heap(
        d.saturating_mul(2)
            .saturating_add(2048 + name.len() as u64 * 8 + id.len() as u64 * 8),
    )?;
    let old = match provided {
        Some(row) => Some(row),
        None => runner.metered_scan(|r, scope| r.tx.get(scope, name, id))?,
    };
    before.insert((name.into(), id.into()), old);
    Ok(())
}

// The operator account also owns final validation. Adoption's independently
// bounded page accounts must not reset this bulk call's cumulative counters.
fn validate_final(r: &mut Runner<'_>, now: i64) -> Result<(), RuntimeError> {
    for name in r.schema.through_order() {
        let table = &r.schema.tables[&name];
        let Some(edge) = &table.through else { continue };
        let parent = &r.schema.tables[&edge.parent];
        let mut bounds = Bounds::default();
        loop {
            let mark = r.meter.mark();
            r.meter.charge(MeterKind::Examined, 1)?;
            r.meter.heap(4 * crate::rows::MAX_INDEX_KEY_BYTES as u64)?;
            let Some(key) = r.metered_scan(|r, scope| r.tx.index_head(scope, &name, "byId", &[], &bounds, Dir::Asc))? else {
                r.meter.release_heap(mark);
                break;
            };
            bounds.after = Some(key.clone());
            r.meter.heap(
                crate::rows::disclosed::decode_reservation(table)
                    .saturating_mul(2)
                    .saturating_add(
                        crate::rows::disclosed::decode_reservation(parent).saturating_mul(2),
                    ),
            )?;
            r.meter.charge(MeterKind::Examined, 2)?;
            let row =
                r.metered_scan(|r, scope| r.tx.get(scope, &name, key[0].as_str()?))?
                    .ok_or_else(|| RuntimeError::Store("bulk validation row disappeared".into()))?;
            let p =
                r.metered_scan(|r, scope| r.tx.get(scope, &edge.parent, row.field(&edge.reference)?.as_str()?))?
                    .ok_or_else(|| {
                        RuntimeError::Store("bulk restoration needs a live parent".into())
                    })?;
            let p = crate::schema::row_image(&p, parent);
            if (parent.expired(&p, now) && !table.expired(&row, now))
                || edge
                    .fields
                    .iter()
                    .any(|(f, source)| row.field(f).ok() != p.field(source).ok())
                || row.field(crate::schema::through::PARENT_DEADLINE).ok()
                    != Some(&parent.deadline(&p).map(Value::Int).unwrap_or(Value::Null))
            {
                return Err(RuntimeError::Store(
                    "bulk restored authority differs from its current parent".into(),
                ));
            }
            r.meter
                .step(edge.fields.len() as u64 + table.columns.len() as u64 + 8)?;
            r.meter.release_heap(mark);
        }
    }
    for (name, table) in &r.schema.tables {
        let mut checks: Vec<_> = table
            .indexes
            .iter()
            .filter(|(_, i)| i.unique)
            .map(|(n, i)| (n, i.components.len(), 1, true))
            .collect();
        for c in &table.constraints {
            if let crate::schema::Constraint::Cap { by, max } = c {
                let (index, _) = table
                    .indexes
                    .iter()
                    .find(|(_, i)| i.columns().starts_with(by))
                    .ok_or_else(|| RuntimeError::Schema("bulk cap has no index".into()))?;
                checks.push((index, by.len(), u64::from(*max), false));
            }
        }
        for (index, width, max, nulls_distinct) in checks {
            let mut bounds = Bounds::default();
            let mut previous = None;
            let mut count = 0;
            loop {
                let mark = r.meter.mark();
                r.meter.charge(MeterKind::Examined, 1)?;
                r.meter.step(width as u64 + 1)?;
                r.meter.heap(8 * crate::rows::MAX_INDEX_KEY_BYTES as u64)?;
                let Some(key) = r.metered_scan(|r, scope| r.tx.index_head(scope, name, index, &[], &bounds, Dir::Asc))? else {
                    r.meter.release_heap(mark);
                    break;
                };
                let group = key[..width].to_vec();
                bounds.after = Some(key);
                if !(nulls_distinct && group.contains(&Value::Null)) {
                    if previous.as_ref() == Some(&group) {
                        count += 1;
                    } else {
                        previous = Some(group);
                        count = 1;
                    }
                    if count > max {
                        return Err(RuntimeError::Constraint(format!(
                            "bulk restoration exceeds {name}.{index} bound {max}"
                        )));
                    }
                }
                r.meter.release_heap(mark);
            }
        }
    }
    Ok(())
}
