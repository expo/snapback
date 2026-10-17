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
) -> Result<(u64, Vec<partition::Event>, Vec<String>, u64), RuntimeError> {
    let mut commit_seq = seq;
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
        runner
            .meter
            .heap(crate::rows::disclosed::decode_reservation(table).saturating_mul(4))?;
        let id = row.field("id")?.as_str()?.to_owned();
        let old = tx.get(&name, &id)?;
        let mut row = runner.import_sequences(&name, row, old.as_ref(), true)?;
        commit_seq = commit_seq.max(super::timeline::restored_sequence(schema, &name, &row)?);
        table.recompute_deadline(&mut row)?;
        validate::validate_row(schema, &name, &row)?;
        runner.meter.charge(MeterKind::RowsWritten, 1)?;
        bulk_put(&mut runner, &name, table, &row, old.as_ref())?;
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
        bulk_put(&mut runner, name, table, &row, Some(&old))?;
        runner.meter.release_heap(mark);
    }
    validate_final(&mut runner, &before, now)?;
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
    Ok((count, events, tables, commit_seq))
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

// Validate changed groups and captured children of changed parents. Population
// outside these identities cannot affect a coherent bounded restore batch.
fn validate_final(
    r: &mut Runner<'_>,
    before: &BTreeMap<(String, String), Option<Value>>,
    now: i64,
) -> Result<(), RuntimeError> {
    for ((name, id), previous) in before {
        validate_one(r, name, id, now, true)?;
        for (child, _, edge) in r
            .schema
            .children(name)
            .filter(|(_, _, edge)| edge.live.is_none())
        {
            let parent = &r.schema.tables[name];
            r.meter
                .heap(crate::rows::disclosed::decode_reservation(parent).saturating_mul(2))?;
            let current = r
                .metered_scan(|r, scope| r.tx.get(scope, name, id))?
                .ok_or_else(|| RuntimeError::Store("restored parent disappeared".into()))?;
            let current = crate::schema::row_image(&current, parent);
            if previous.as_ref().is_some_and(|old| {
                let old = crate::schema::row_image(old, parent);
                edge.fields
                    .values()
                    .all(|f| old.field(f).ok() == current.field(f).ok())
                    && parent.deadline(&old) == parent.deadline(&current)
            }) {
                continue;
            }
            let mut bounds = Bounds::default();
            loop {
                let mark = r.meter.mark();
                r.meter.charge(MeterKind::Examined, 1)?;
                r.meter.heap(8 * crate::rows::MAX_INDEX_KEY_BYTES as u64)?;
                let key = r.metered_scan(|r, scope| {
                    r.tx.index_head(
                        scope,
                        child,
                        crate::schema::through::CHILDREN,
                        &[Value::Id(id.clone())],
                        &bounds,
                        Dir::Asc,
                    )
                })?;
                let Some(key) = key else {
                    r.meter.release_heap(mark);
                    break;
                };
                bounds.after = Some(key.iter().skip(1).cloned().collect());
                let child_id = key
                    .last()
                    .ok_or_else(|| RuntimeError::Store("restored child key is empty".into()))?
                    .as_str()?;
                validate_one(r, child, child_id, now, false)?;
                r.meter.release_heap(mark);
            }
            let _ = edge;
        }
    }
    Ok(())
}
fn validate_one(
    r: &mut Runner<'_>,
    name: &str,
    id: &str,
    now: i64,
    groups: bool,
) -> Result<(), RuntimeError> {
    let mark = r.meter.mark();
    let table = &r.schema.tables[name];
    r.meter.charge(MeterKind::Examined, 1)?;
    r.meter
        .heap(crate::rows::disclosed::decode_reservation(table).saturating_mul(2))?;
    let row = r
        .metered_scan(|r, scope| r.tx.get(scope, name, id))?
        .ok_or_else(|| RuntimeError::Store("restored row disappeared".into()))?;
    let row = crate::schema::row_image(&row, table);
    if let Some(edge) = &table.through {
        let parent = &r.schema.tables[&edge.parent];
        r.meter.charge(MeterKind::Examined, 1)?;
        r.meter
            .heap(crate::rows::disclosed::decode_reservation(parent).saturating_mul(2))?;
        let p = r
            .metered_scan(|r, scope| {
                r.tx.get(scope, &edge.parent, row.field(&edge.reference)?.as_str()?)
            })?
            .ok_or_else(|| RuntimeError::Store("bulk restoration needs a live parent".into()))?;
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
    }
    if groups {
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
                    .find(|(_, i)| i.is_plain() && i.columns().starts_with(by))
                    .ok_or_else(|| RuntimeError::Schema("bulk cap has no index".into()))?;
                checks.push((index, by.len(), u64::from(*max), false));
            }
        }
        for (index, width, max, nulls_distinct) in checks {
            let scratch = r.meter.mark();
            r.meter.heap(12 * crate::rows::MAX_INDEX_KEY_BYTES as u64)?;
            let key = crate::rows::index_values(&table.indexes[index], &row);
            let group = key[..width].to_vec();
            if !(nulls_distinct && group.contains(&Value::Null))
                && (nulls_distinct
                    || !r.schema.cap_skips_null(
                        table,
                        &table.indexes[index].columns()[..width],
                        &group,
                    ))
            {
                let mut bounds = Bounds::default();
                let mut count = 0;
                loop {
                    r.meter.charge(MeterKind::Examined, 1)?;
                    r.meter.step(width as u64 + 1)?;
                    let key = r.metered_scan(|r, scope| {
                        r.tx.index_head(scope, name, index, &group, &bounds, Dir::Asc)
                    })?;
                    let Some(key) = key else { break };
                    bounds.after = Some(key.into_iter().skip(width).collect());
                    let occupies = if !nulls_distinct && table.is_expiring() {
                        let mark = r.meter.mark();
                        r.meter.charge(MeterKind::Examined,1)?;
                        r.meter
                            .heap(crate::rows::disclosed::decode_reservation(table))?;
                        let row_id = bounds
                            .after
                            .as_ref()
                            .and_then(|k| k.last())
                            .ok_or_else(|| RuntimeError::Store("cap key misses identity".into()))?
                            .as_str()?;
                        let row = r
                            .metered_scan(|r, scope| r.tx.get(scope, name, row_id))?
                            .ok_or_else(|| RuntimeError::Store("cap row disappeared".into()))?;
                        let live = !table.expired(&row, now);
                        r.meter.release_heap(mark);
                        live
                    } else {
                        true
                    };
                    count += u64::from(occupies);
                    if count > max {
                        return Err(RuntimeError::Constraint(format!(
                            "bulk restoration exceeds {name}.{index} bound {max}"
                        )));
                    }
                }
            }
            r.meter.release_heap(scratch);
        }
    }
    r.meter.release_heap(mark);
    Ok(())
}

// Native index_write retains every old/new key vector concurrently. Reserve
// complete cardinality/width buffers before it owns any key, not after put.
fn bulk_put(
    r: &mut Runner<'_>,
    name: &str,
    table: &crate::schema::Table,
    row: &Value,
    old: Option<&Value>,
) -> Result<(), RuntimeError> {
    let mark = r.meter.mark();
    let keys=crate::rows::adoption::index_scratch(name,table);
    r.meter.heap(
        keys.saturating_mul(2)
            .saturating_add(crate::rows::disclosed::decode_reservation(table).saturating_mul(4)),
    )?;
    let entries = r.tx.put(name, table, row, old)?;
    r.meter.charge(MeterKind::IndexEntries, entries)?;
    r.meter.release_heap(mark);
    Ok(())
}
