//! Bounded witness enumeration and indexed lifetime metadata.
use super::*;

impl Runner<'_> {
    // @ref LLP 3000.007#17 — one rule probe, regardless of expired siblings or an expiring maintain's sources.
    pub(super) fn rule_probe_exists(&mut self, allowance: &Authorization, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, RuntimeError> {
        let (present, known) = self.probe_witness(allowance, table, index, key, equalities, false)?;
        if !known && !self.read_capped() { self.unknown_fact(table, index, key, "rule probe"); self.components.note(|frame| frame.speculative = true); }
        Ok(present)
    }

    /// Existence witnesses are raw data, never recursively authorized rows.
    pub(in crate::engine) fn probe_witness(&mut self, allowance: &Authorization, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)], current: bool) -> Result<(bool, bool), RuntimeError> {
        self.witness_changes = None;
        if self.null_unique_point(table, index, key) { return Ok((false, true)); }
        if equalities.iter().any(|(field, _)| field == "value")
            && self.schema.maintain_for(table).is_some_and(|m| m.row_key.is_some()) {
            return self.count_witness_timeline(allowance, table, index, key, equalities, current);
        }
        if self.device_work_active { return self.probe_witness_uncached(allowance, table, index, key, equalities, current); }
        let cached_key = WitnessKey { revision: self.tx.revision(), table: table.into(), index: index.into(), key: key.to_vec(), equalities: equalities.to_vec(), current };
        if let Some((previous, (live, known, expiry))) = &self.witness_cache && previous == &cached_key {
            self.next_expiry.note_option(*expiry);
            return Ok((*live, *known));
        }
        let scope = self.next_expiry.scope();
        let result = self.probe_witness_uncached(allowance, table, index, key, equalities, current);
        let expiry = scope.defer().deadline();
        self.next_expiry.note_option(expiry);
        if let Ok((live, known)) = result { self.witness_cache = Some((cached_key, (live, known, expiry))); }
        result
    }

    // @ref LLP 3000.015#3 — count equality can enter and leave truth as sources expire.
    // Recheck at each certified dependency boundary inside the same transaction
    // and shared physical allowance. Never interpret a cache deadline as falsity.
    fn count_witness_timeline(&mut self, allowance: &Authorization, table: &str, index: &str,
        key: &[Value], equalities: &[(String, Value)], current: bool) -> Result<(bool, bool), RuntimeError> {
        let now = self.context.now;
        let mut changes = Vec::new();
        let result = (|| {
            let mut first = None;
            let mut previous = false;
            loop {
                self.witness_cache = None;
                let scope = self.next_expiry.scope();
                let answer = self.probe_witness_uncached(allowance, table, index, key, equalities, current)?;
                let deadline = scope.defer().deadline();
                if first.is_none() { first = Some(answer); }
                else if answer.0 != previous {
                    // 64 bytes per transition covers Vec's minimum and geometric reallocations.
                    self.meter.heap(64)?;
                    changes.push((self.context.now.unwrap_or(0), if answer.0 { super::rules::Verdict::Readable } else { super::rules::Verdict::Denied }));
                }
                previous = answer.0;
                let Some(deadline) = deadline.filter(|t| *t > self.context.now.unwrap_or(0)) else { return Ok(first.unwrap()); };
                self.context.now = Some(deadline);
            }
        })();
        self.context.now = now;
        self.witness_cache = None;
        self.witness_changes = Some(changes);
        result
    }

    fn probe_row_view(&mut self, allowance: &Authorization, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)], current: bool) -> Result<(bool,bool),RuntimeError> {
        self.schema.refuse_private(table)?;
        let definition = self.schema.table(table).ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?;
        let index_def = definition.index(index).ok_or_else(|| RuntimeError::Schema(format!("missing index {table}.{index}")))?;
        self.read_tables.insert(table.to_owned());
        let Some(maintain) = self.schema.maintain_for(table).filter(|m| m.row_key.is_some()) else {
            unreachable!("row view selected before shared witness dispatch");
        };
        self.read_tables.insert(maintain.row_key.as_ref().unwrap().table.clone());
        let Some(mut row) = self.live_lookup(allowance, table, index, index_def, key, #[cfg(feature = "sqlite")] None)? else {
            let known = !self.device || (definition.sync.as_ref().is_some_and(|s| s.horizon.is_none())
                && self.schema.tables[&maintain.row_key.as_ref().unwrap().table].sync.as_ref().is_some_and(|s|s.horizon.is_none()));
            return Ok((false, known));
        };
        let (present, expiry) = self.row_view_member_exists(maintain, &row)?;
        if !present { return Ok((false, !self.device || definition.sync.as_ref().is_some_and(|s|s.horizon.is_none()))); }
        let mut known = !self.device || if current { self.witness_covered(table, index, key, &row)? }
            else { definition.sync.is_some() };
        // @ref LLP 3000.015#3 — only value certifies; maintenance predicates refuse at admission.
        if equalities.iter().any(|(field,_)| field == "value") {
            let prior = self.timeline_pending;
            self.timeline_pending = false;
            let found = self.live_row_view(maintain, row)?;
            let pending = self.timeline_pending;
            self.timeline_pending |= prior;
            if pending { return Err(RuntimeError::Structural { code: "E_VIEW_KEY", message: "a pending row-keyed count cannot decide an existence/rule probe; probe the member's existence or retry after recount settlement (guide maintains)".into() }); }
            let Some(found) = found else { return Ok((false, known)); };
            row = found;
        }
        if self.device && self.schema.maintain_subset_unknown(table) { known = false; }
        let live = equalities.iter().all(|(column,value)| row.field(column).unwrap_or(&Value::Null) == value);
        if known && (live || equalities.iter().any(|(field, _)| field == "value")) { self.next_expiry.note_option(expiry); }
        Ok((live, known))
    }


    fn probe_witness_uncached(&mut self, allowance: &Authorization, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)], current: bool) -> Result<(bool, bool), RuntimeError> {
        if self.schema.maintain_for(table).is_some_and(|m|m.row_key.is_some()) {
            let bytes = crate::rows::disclosed::decode_reservation(&self.schema.tables[table])
                .saturating_add(crate::rows::MAX_INDEX_KEY_BYTES as u64 * 4);
            let expiry = self.next_expiry.scope();
            let result = self.authorized_scratch(bytes, &[(MeterKind::Examined,1)], |runner, scope|
                runner.probe_row_view(scope, table, index, key, equalities, current));
            if matches!(result, Ok((true, true))) || equalities.iter().any(|(field, _)| field == "value") { expiry.emit(); }
            return result;
        }

        self.observe_sequence_selection(table, index, key)?;
        let definition = self.schema.table(table).ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?;
        let index_def = definition.index(index).ok_or_else(|| RuntimeError::Schema(format!("missing index {table}.{index}")))?;
        self.read_tables.insert(table.to_owned());
        self.aggregate_source_dependency(table);
        let mut bounds = Bounds::default();
        let mut live = false;
        let mut until: Option<i64> = None;
        let mut uncertain = false;
        loop {
            let (rows, limit) = if !definition.is_expiring() {
                // Non-expiring indexed predicates need only one candidate;
                // extra equalities bind a complete unique key.
                (self.live_lookup(allowance, table, index, index_def, key, #[cfg(feature = "sqlite")] None)?.map(|row| (row, Vec::new())).into_iter().collect::<Vec<_>>(), usize::MAX)
            } else { self.witness_scan(allowance, table, index, key, &bounds, 32)? };
            let count = rows.len();
            for (mut row, stored) in rows {
                self.witness_materialize(&mut row, definition)?;
                bounds.after = self.witness_position(&stored, index_def.components.len() + 1, key.len())?;
                if self.expired(definition, &row) || !equalities.iter().all(|(column, value)| row.field(column).unwrap_or(&Value::Null) == value) { continue; }
                // @ref LLP 3000.016#21a-owned-events-follow-their-source-rows — a held source whose event kind is not fully synced is no witness.
                if self.device && !crate::schema::timeline::holds_event(self.schema, table, &row) {
                    self.event_read_unknown(table, index, key, "rule probe");
                    uncertain = true;
                    continue;
                }
                if current && !self.witness_covered(table, index, key, &row)? { uncertain = true; continue; }
                let (present, known, expiry) = self.witness_lifetime(allowance, table, &row, current)?;
                uncertain |= !known;
                if !present { continue; }
                until = if live { until.zip(expiry).map(|(a, b)| a.max(b)) } else { expiry };
                live = true;
                // Finish the bounded enumeration even after a permanent witness.
                // Its position must not select success versus exhaustion.
            }
            if count < limit { break; }
        }
        if !live && self.event_read_unknown(table, index, key, "rule probe") { uncertain = true; }
        let known = !self.device || (!self.schema.maintain_subset_unknown(table) && if current {
            if live { true } else { !uncertain && self.authorization_absence_covered(allowance, table, index, key)? }
        } else { !uncertain && definition.sync.as_ref().is_some_and(|s| live || s.horizon.is_none()) });
        if live { self.next_expiry.note_option(until); }
        Ok((live, known))
    }

    /// A maintained existence witness lives while any selected source lives;
    /// an aggregate's own expiration can only shorten that lifetime.
    fn witness_lifetime(&mut self, allowance: &Authorization, table: &str, row: &Value, current: bool) -> Result<(bool, bool, Option<i64>), RuntimeError> {
        let expiry = self.schema.tables[table].deadline(row);
        let Some(maintain) = self.schema.maintain_for(table) else { return Ok((true, true, expiry)); };
        let Some(source) = self.schema.table(&maintain.source).filter(|source| source.is_expiring()) else { return Ok((true, true, expiry)); };
        self.read_tables.insert(maintain.source.clone());
        if self.device_work_active {
            self.meter.heap(2 * word_heap::slots::<Value>(maintain.by.len()) + word_heap::allocation("$contribution:".len() + maintain.target.len()))?;
            for field in &maintain.by { if let Ok(value) = row.field(field) {
                crate::engine::authorized_scan::InternalLedger::with_meter(&mut self.meter, |meter, scope| value.scalar_heap(scope).charge(meter, scope))?;
                crate::engine::authorized_scan::InternalLedger::with_meter(&mut self.meter, |meter, scope| value.scalar_heap(scope).charge(meter, scope))?;
            } }
        }
        let group = crate::schema::maintained_key(row, &maintain.by);
        let (name, prefix) = maintain.source_scan(source, &group);
        let mut known = !self.device || source.sync.as_ref().is_some_and(|sync| sync.horizon.is_none());
        // @ref LLP 3000.007#20.9.3 — skip expired contributions; all live alternatives still determine the complete rule lifetime.
        let expiry_ordered = source.index(name).is_some_and(|index| matches!(index.components.as_slice(),
            [crate::schema::IndexComponent::Contribution(_), crate::schema::IndexComponent::Column(column)] if Some(column.as_str()) == source.expiry_column()));
        // The contribution index contains only selected sources and carries
        // their expiry. Two key-only seeks give the last surviving lifetime;
        // no payload is decoded and a permanent witness's position is irrelevant.
        #[cfg(feature = "sqlite")]
        if expiry_ordered && !self.device {
            let timeless = self.tx.index_head(allowance, &maintain.source, name, &prefix,
                &Bounds { lte: Some(Value::Null), ..Default::default() }, Dir::Asc)?;
            let latest = self.tx.index_head(allowance, &maintain.source, name, &prefix,
                &Bounds { gt: Some(Value::Int(self.context.now.unwrap_or(i64::MIN))), ..Default::default() }, Dir::Desc)?;
            let until = latest.as_ref().and_then(|key| key.get(prefix.len())).and_then(|v|v.as_int().ok());
            return Ok((timeless.is_some() || latest.is_some(), true,
                rules::earliest(expiry, if timeless.is_some() { None } else { until })));
        }
        let mut bounds = Bounds { gt: self.context.now.filter(|_| expiry_ordered).map(Value::Int), ..Bounds::default() };
        let mut live = false;
        let mut until: Option<i64> = None;
        loop {
            let (rows, limit) = self.witness_scan(allowance, &maintain.source, name, &prefix, &bounds, 32)?;
            let count = rows.len();
            for (mut candidate, stored) in rows {
                self.witness_materialize(&mut candidate, source)?;
                bounds.after = self.witness_position(&stored, (source.index(name).expect("source index").components.len() + 1).max(prefix.len() + 1), prefix.len())?;
                if self.device_work_active {
                    self.meter.step(maintain.evaluation_steps())?;
                    self.meter.heap(word_heap::slots::<Value>(maintain.by.len()))?;
                    for field in &maintain.by { if let Ok(value) = candidate.field(field) { crate::engine::authorized_scan::InternalLedger::with_meter(&mut self.meter, |meter, scope| value.scalar_heap(scope).charge(meter, scope))?; } }
                }
                if !self.live_contribution(maintain, source, &candidate, &group) { continue; }
                if current && !self.witness_covered(&maintain.source, name, &prefix, &candidate)? { known = false; continue; }
                if current { known = true; }
                let candidate_expiry = source.deadline(&candidate);
                until = if live { until.zip(candidate_expiry).map(|(a, b)| a.max(b)) } else { candidate_expiry };
                live = true;

            }
            if count < limit { break; }
        }
        Ok((live, known || (current && live), rules::earliest(expiry, until)))
    }

    /// Point lookups must pass expired siblings, even on an index whose
    /// logical uniqueness no longer counts those rows.
    pub(in crate::engine) fn lookup_stored(&mut self, table_name: &str, name: &str, index: &Index, key: &[Value], _charge: bool) -> Result<Option<Value>, RuntimeError> {
        let table = &self.schema.tables[table_name];
        if crate::rows::disclosed::actual_size(table) {
            return self.metered_scan(|runner, scope| runner.live_lookup(scope, table_name, name, index, key, #[cfg(feature = "sqlite")] None));
        }
        self.authorized_scratch(crate::rows::disclosed::decode_reservation(table), &[], |runner, scope| runner.live_lookup(scope, table_name, name, index, key, #[cfg(feature = "sqlite")] None))
    }

    pub(in crate::engine) fn live_lookup(&mut self, allowance: &Authorization, table_name: &str, name: &str, index: &Index, key: &[Value], #[cfg(feature = "sqlite")] mut encountered: Option<&mut bool>) -> Result<Option<Value>, RuntimeError> {
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
        if crate::rows::disclosed::actual_size(table) && !self.device_work_active {
            let mark = self.meter.mark();
            let result = self.tx.scan_metered(allowance, table_name, name, key, &Bounds::default(), Dir::Asc, 1, &mut self.meter);
            self.meter.release_heap(mark);
            let Some((row,_)) = result?.pop() else { return Ok(None); };
            #[cfg(feature = "sqlite")]
            if let Some(seen) = encountered.as_deref_mut() { *seen = true; }
            // @ref LLP 3000.015#1 — stored public bytes exclude adopted defaults.
            // Keep their materialization charge while the returned witness lives.
            let image = self.disclosed_row(table, row);
            // Public non-expiring images have authority before access. Enforce
            // the outer caller's ceiling even inside a restoring rule scope;
            // private witness work keeps its declaration-only admission.
            let ceiling = self.meter.ceilings.heap_bytes;
            let internal_heap = self.meter.used.heap_bytes;
            if let Some((limit, used)) = self.caller_heap_ceiling {
                self.meter.ceilings.heap_bytes = limit;
                self.meter.used.heap_bytes = used;
            }
            let charged = crate::engine::authorized_scan::InternalLedger::with_meter(&mut self.meter, |meter, scope|
                image.charge_materialization_internal(meter, scope));
            if let Some((_, used)) = &mut self.caller_heap_ceiling {
                let public_heap = self.meter.used.heap_bytes;
                self.meter.used.heap_bytes = internal_heap.saturating_add(public_heap.saturating_sub(*used));
                *used = public_heap;
            }
            self.meter.ceilings.heap_bytes = ceiling;
            charged?;
            return Ok(Some(image.into_value()));
        }
        if !table.is_expiring() && !self.device_work_active {
            return self.tx.lookup(allowance, table_name, name, index, key).map(|found| found.map(|mut row| {
                #[cfg(feature = "sqlite")]
                if let Some(seen) = encountered.as_deref_mut() { *seen = true; }
                materialize_optional_fields(&mut row, table); row }));
        }
        let mut bounds = Bounds::default();
        loop {
            let (rows, limit) = self.witness_scan(allowance, table_name, name, key, &bounds, if !table.is_expiring() { 1 } else { 32 })?;
            let count = rows.len();
            #[cfg(feature = "sqlite")]
            if count > 0 { if let Some(seen) = encountered.as_deref_mut() { *seen = true; } }
            for (mut row, stored) in rows {
                self.witness_materialize(&mut row, table)?;
                if !self.expired(table, &row) { return Ok(Some(row)); }
                bounds.after = self.witness_position(&stored, index.components.len() + 1, key.len())?;
            }
            if count < limit { return Ok(None); }
        }
    }

    // Physical witness work is additional device authorization work. Queries
    // and server rules keep their existing one-probe accounting.
    fn witness_scan(&mut self, allowance: &Authorization, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, batch: usize) -> Result<(Vec<(Value, Vec<u8>)>, usize), RuntimeError> {
        if !self.device_work_active { return Ok((self.tx.scan(allowance, table, index, prefix, bounds, Dir::Asc, batch)?, batch)); }
        let limit = self.meter.ceilings.examined.saturating_sub(self.meter.used.examined).min(batch as u64) as usize;
        if limit == 0 { self.meter.charge(MeterKind::Examined, 1)?; }
        let rows = self.tx.scan_metered(allowance, table, index, prefix, bounds, Dir::Asc, limit, &mut self.meter)?;
        self.meter.charge(MeterKind::Examined, rows.len().max(1) as u64)?;
        Ok((rows, limit))
    }

    fn witness_materialize(&mut self, row: &mut Value, table: &Table) -> Result<(), RuntimeError> {
        // Physical device-work accounting stays separate from the logical meter.
        if self.device_work_active {
            self.authorized_scratch(0,&[],|runner, scope| {
                let row = runner.disclosed_row(table,row.clone());
                crate::engine::authorized_scan::InternalLedger::with_meter(&mut runner.meter, |meter, _| row.charge_materialization_internal(meter,scope))
            })?;
        }
        materialize_optional_fields(row, table);
        Ok(())
    }

    fn witness_position(&mut self, stored: &[u8], components: usize, prefix: usize) -> Result<Option<Vec<Value>>, RuntimeError> {
        if self.device_work_active { self.meter.heap(word_heap::key_decode(components, stored.len()))?; }
        Ok(crate::key::decode(stored).map(|values| values.into_iter().skip(prefix).collect()))
    }

}

#[cfg(all(test, feature = "sqlite"))]
mod tests {
    use super::*;
    use crate::{meter::Meter, rows::{MemoryRows, Rows}, schema::{ColumnDefault, ColumnType}, value::object};

    #[test]
    fn protected_public_materialization_uses_caller_budget_not_private_work() {
        let rows=MemoryRows::new();
        let mut table=crate::schema::public_table([
            ("id".into(),ColumnType::Id),("note".into(),ColumnType::Text {max:1_000_000}),
        ].into(),[("byId".into(),Index::of(&["id"],true))].into());
        table.defaults.insert("note".into(),ColumnDefault::Literal(Value::String("n".repeat(1_000_000))));
        rows.put("rooms",&table,&object([("id",Value::Id("r".into()))]),None).unwrap();
        let schema=crate::Schema {tables:[("rooms".into(),table)].into(),..Default::default()};
        for heap in [64 << 10,200_000,3_600_000] {
            for private_work in [0,10_000_000] {
                let mut runner=Runner::new(&rows,&schema,crate::Context::new("alice",Default::default()),
                    Meter::new(crate::Ceilings {heap_bytes:heap,..Default::default()},crate::meter::Cut::Cap),0);
                let (result,allocated)=crate::rows::word_heap::tests::measured(||runner.authorized_scratch(64,&[],|runner,_| {
                    runner.meter.heap(private_work)?;
                    runner.authorized_scan(&[],|runner,scope| {
                        let row=runner.live_lookup(scope,"rooms","byId",&schema.tables["rooms"].indexes["byId"],&[Value::Id("r".into())], #[cfg(feature = "sqlite")] None)?.unwrap();
                        assert_eq!(row.field("note").unwrap().as_str().unwrap().len(),1_000_000);
                        assert!(runner.meter.used.heap_bytes >= private_work+1_000_000);
                        Ok(())
                    })
                }));
                assert_eq!(runner.meter.ceilings.heap_bytes,heap);
                assert!(runner.caller_heap_ceiling.is_none(),"nested scope restores caller state");
                if heap<1_000_000 {
                    assert!(matches!(result,Err(RuntimeError::Bound {kind:MeterKind::HeapBytes,ceiling,..}) if ceiling==heap));
                    assert!(allocated < 64 << 10,"refuse before copying: {allocated}");
                } else {result.unwrap();}
            }
        }
    }

    #[test]
    fn public_lookup_prepays_and_retains_an_adopted_default() {
        let rows=MemoryRows::new();
        let mut table=crate::schema::public_table([
            ("id".into(),ColumnType::Id),("note".into(),ColumnType::Text {max:1_000_000}),
        ].into(),[("byId".into(),Index::of(&["id"],true))].into());
        table.defaults.insert("note".into(),ColumnDefault::Literal(Value::String("n".repeat(1_000_000))));
        rows.put("rooms",&table,&object([("id",Value::Id("r".into()))]),None).unwrap();
        let schema=crate::Schema {tables:[("rooms".into(),table)].into(),..Default::default()};
        for heap in [64 << 10,3_600_000] {
            let mut runner=Runner::new(&rows,&schema,crate::Context::new("alice",Default::default()),
                Meter::new(crate::Ceilings {heap_bytes:heap,..Default::default()},crate::meter::Cut::Cap),0);
            let (result,allocated)=crate::rows::word_heap::tests::measured(|| runner.metered_scan(|runner,scope|
                runner.live_lookup(scope,"rooms","byId",&schema.tables["rooms"].indexes["byId"],&[Value::Id("r".into())], #[cfg(feature = "sqlite")] None)));
            eprintln!("public default heap={heap}: allocated={allocated}, retained={}, peak={}",runner.meter.used.heap_bytes,runner.meter.heap_peak);
            if heap==64 << 10 {
                assert!(matches!(result,Err(RuntimeError::Bound {kind:MeterKind::HeapBytes,..})),"must refuse before copying the default");
                assert!(allocated < 64 << 10,"allocated {allocated} bytes before refusal");
            } else {
                let row=result.unwrap().unwrap();
                assert_eq!(row.field("note").unwrap().as_str().unwrap().len(),1_000_000);
                assert!(runner.meter.used.heap_bytes >= 1_000_000,"witness row is still alive");
                assert!(runner.meter.heap_peak >= allocated,"allocated={allocated}, peak={}",runner.meter.heap_peak);
            }
        }
    }
}
