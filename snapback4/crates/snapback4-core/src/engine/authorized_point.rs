//! A row-read verdict and field projection together authorize result pricing.
use super::runner::Runner;
use crate::{error::{MeterKind, RuntimeError}, ir::Read, meter::Meter,
    schema::{Effect, Index}, value::{Disclosed, Value}};

// Only successful row authorization in this module can mint this evidence.
pub(crate) struct RowAuthorization(());
pub(crate) struct AuthorizedRow<'a> {
    projection: Disclosed<'a>,
    authority: RowAuthorization,
    // @ref LLP 3000.014#5 — a row's witness deadline is provisional until an answer emits it.
    expiry: super::expiry::Pending,
}
impl AuthorizedRow<'_> {
    pub(super) fn expiry(&self) -> super::expiry::Pending { self.expiry }
    pub(super) fn scalar_heap(&self, field: &str) -> u64 { self.projection.scalar_heap(field, &self.authority) }
    pub(crate) fn heap_bytes(&self) -> u64 { self.projection.heap_bytes(&self.authority) }
    pub(super) fn projection_heap(&self) -> u64 { self.projection.projection_heap(&self.authority) }
    pub(crate) fn materialization_heap(&self) -> u64 { self.projection.materialization_heap(&self.authority) }
    pub(super) fn into_value(self) -> Value { self.projection.into_value() }
    pub(super) fn into_parts(self) -> (Value, RowAuthorization) { (self.projection.into_value(), self.authority) }
    pub(super) fn charge(self, meter: &mut Meter) -> Result<Value, RuntimeError> {
        meter.heap(self.heap_bytes() + self.projection_heap() + self.materialization_heap())?;
        Ok(self.into_value())
    }
}

impl RowAuthorization {
    pub(super) fn project(self, projection: Disclosed<'_>) -> AuthorizedRow<'_> { AuthorizedRow { projection, authority:self, expiry: Default::default() } }
}

impl<'r> Runner<'r> {
    // @ref LLP 3000.015#1 — member reads share the row-read and field-disclosure capability.
    pub(super) fn authorized_member(&mut self, name: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        let table = &self.schema.tables[name];
        let bytes = crate::rows::disclosed::decode_reservation(table).saturating_add(self.rule_scratch(&table.rules.read));
        let expiry = self.next_expiry.scope();
        let row = self.authorized_scratch(bytes, &[(MeterKind::Examined, 1), (MeterKind::RuleProbes, super::rules::rule_probes(&table.rules.read))], |runner, scope| {
            let Some(mut row) = runner.tx.get(scope, name, id)? else { return Ok(None); };
            crate::schema::materialize_optional_fields(&mut row, table);
            let until = table.deadline(&row);
            let authorized = runner.authorize_image(name, row)?;
            if let Some(row) = &authorized { runner.next_expiry.inherit(row.expiry()); runner.next_expiry.note_option(until); }
            Ok(authorized)
        })?;
        if row.is_some() { expiry.emit(); }
        row.map(|row|row.charge(&mut self.meter)).transpose()
    }

    pub(super) fn authorize_image(&mut self, name: &str, row: Value) -> Result<Option<AuthorizedRow<'r>>, RuntimeError> {
        let table = &self.schema.tables[name];
        // @ref LLP 3000.014#5-what-derives-from-the-capture — a denied or expired candidate's witness deadlines are discarded with its scope.
        let expiry = self.next_expiry.scope();
        if self.expired(table, &row) || !self.check_rule(name, Effect::Read, None, &row)? {
            return Ok(None);
        }
        // Memory deadlines are hidden by Disclosed itself; transfer the live
        // boundary before projecting, still inside this candidate's expiry scope.
        if table.ephemeral.is_some() { self.note_expiry(table, &row); }
        let projection = self.disclosed_row(table, row).for_query();
        let visible = projection.into_value();
        Ok(Some(AuthorizedRow { projection: self.disclosed_row(table, visible).for_query(), authority: RowAuthorization(()), expiry: expiry.defer() }))
    }

    pub(super) fn scan_disclosed(&mut self, name: &str, index: &str, prefix: &[Value], bounds: &crate::rows::Bounds, dir: crate::rows::Dir, limit: usize) -> Result<Vec<(Option<AuthorizedRow<'r>>, Vec<u8>)>, RuntimeError> {
        self.scan_authorized(name,index,prefix,bounds,dir,limit,true,true)
    }

    pub(super) fn scan_authorized(&mut self, name: &str, index: &str, prefix: &[Value], bounds: &crate::rows::Bounds, dir: crate::rows::Dir, limit: usize, metered: bool, trusted: bool) -> Result<Vec<(Option<AuthorizedRow<'r>>, Vec<u8>)>, RuntimeError> {
        let table = &self.schema.tables[name];
        // A public, non-expiring image is authorized before accessing storage.
        // No hidden candidate can influence its actual-size decoder admission.
        if (self.context.is_system() || trusted && !table.is_expiring() && (!self.device || table.rules.read.is_uniformly_readable())) && table.recorded.is_empty() && table.through.is_none() && table.written_by.values().all(|a| a.audience) {
            let rows = if metered {
                self.meter.heap(crate::rows::word_heap::slots::<(Option<AuthorizedRow<'_>>,Vec<u8>)>(limit))?;
                self.metered_scan(|runner, scope| runner.tx.scan_metered(scope,name,index,prefix,bounds,dir,limit,&mut runner.meter))?
            } else { self.metered_scan(|runner, scope| runner.tx.scan(scope,name,index,prefix,bounds,dir,limit))? };
            return Ok(rows.into_iter().map(|(row,key)|(Some(AuthorizedRow { projection:self.disclosed_row(table,row),authority:RowAuthorization(()),expiry:Default::default() }),key)).collect());
        }
        let bytes = crate::rows::disclosed::decode_reservation(table).saturating_add(self.rule_scratch(&table.rules.read));
        if metered { self.meter.heap(crate::rows::word_heap::slots::<(Option<AuthorizedRow<'_>>, Vec<u8>)>(limit))?; }
        let mut cursor = bounds.clone();
        let mut out = Vec::with_capacity(limit);
        for _ in 0..limit {
            let candidate = self.reserved_scratch(bytes, &[], !trusted, |runner, scope| {
                let Some((mut row,key)) = runner.tx.scan(scope,name,index,prefix,&cursor,dir,1)?.pop() else { return Ok(None); };
                // Advancing over a rejected candidate is internal decoder work.
                cursor.after = crate::key::decode(&key).map(|v|v.into_iter().skip(prefix.len()).collect());
                crate::schema::materialize_optional_fields(&mut row,table);
                let provisional = runner.is_provisional(name,&row)?;
                let needs_rule = !runner.context.is_system() && (!trusted || provisional);
                if needs_rule && !runner.device_work_active && !scope.admit_probes(super::rules::rule_probes(&table.rules.read)) {
                    // @ref LLP 3000.020#3.2 — unresolved authority is unknown, not an absent contribution.
                    if runner.device { runner.unknown_fact(name, index, prefix, "source rule admission"); }
                    return Ok(Some((None,key)));
                }
                let row = runner.authorize_image(name,row)?;
                Ok(Some((row,key)))
            })?;
            let Some((row,key)) = candidate else { break; };
            // Only this sealed surviving projection can be priced on the caller ledger.
            if metered && let Some(row) = &row {
                self.meter.heap(row.heap_bytes() + row.projection_heap() + row.materialization_heap()
                    + crate::rows::word_heap::key_decode(table.index(index).map_or(1,|i|i.components.len()+1),key.len()))?;
            }
            out.push((row,key));
        }
        Ok(out)
    }

    // @ref LLP 3000.015#1 — row and field authorization precede result pricing.
    pub(super) fn authorized_point(&mut self, read: &Read, index: &Index, key: &[Value], prepaid: bool, trusted: bool, prepaid_examined: bool, absent: &mut bool) -> Result<Option<AuthorizedRow<'r>>, RuntimeError> {
        let table = &self.schema.tables[&read.table];
        if crate::rows::disclosed::actual_size(table) {
            if !prepaid_examined && !self.read_charge(MeterKind::Examined,1)? { self.point_cut(read, key); return Ok(None); }
            let scratch = self.meter.mark();
            let row = self.metered_scan(|runner, scope| runner.tx.scan_metered(scope,&read.table,&read.index,key,&Default::default(),crate::rows::Dir::Asc,1,&mut runner.meter))?.pop();
            self.meter.release_heap(scratch);
            let Some((mut row,_)) = row else {
                *absent = true;
                self.point_miss(read, key);
                return Ok(None);
            };
            if self.device && !crate::schema::timeline::holds_event(self.schema, &read.table, &row) {
                self.event_read_unknown(&read.table, &read.index, key, &read.site);
                return Ok(None);
            }
            if self.device && self.retained_row(&read.table,&row)? { self.components.note(|frame|frame.retained=true); }
            crate::schema::materialize_optional_fields(&mut row,table);
            let row = if prepaid_examined { self.live_aggregate_prepaid(&read.table,row)? } else { self.live_aggregate(&read.table,row)? }.unwrap_or(Value::Null);
            return Ok(Some(AuthorizedRow { projection:self.disclosed_row(table,row).for_query(),authority:RowAuthorization(()),expiry:Default::default() }));
        }
        let bytes = crate::rows::disclosed::decode_reservation(table).saturating_add(self.rule_scratch(&table.rules.read));
        // @ref LLP 3000.014#5-what-derives-from-the-capture — a hidden, expired or absent candidate's deadlines are discarded with this scope.
        let expiry = self.next_expiry.scope();
        let authorized = self.authorized_scratch(bytes, &[(MeterKind::Examined, u64::from(!prepaid_examined))], |runner, scope| {
            let Some(row) = runner.live_lookup(scope,&read.table, &read.index, index, key)? else {
                *absent = true;
                runner.point_miss(read, key);
                return Ok(None);
            };
            // @ref LLP 3000.016#21a-owned-events-follow-their-source-rows — a held source whose event kind is not fully synced answers nothing.
            if runner.device && !crate::schema::timeline::holds_event(runner.schema, &read.table, &row) {
                runner.event_read_unknown(&read.table, &read.index, key, &read.site);
                return Ok(None);
            }
            if runner.expired(table, &row) { return Ok(None); }
            let provisional = runner.is_provisional(&read.table, &row)?;
            let allowed = if provisional && !runner.context.is_system() {
                runner.authorize_read(&read.table, &row, prepaid)?
            } else { trusted || runner.check_rule(&read.table, Effect::Read, None, &row)? };
            if !allowed { return Ok(None); }
            // @ref LLP 3000.001#proposed-composition-of-retained-and-authoritative-reads — a delivered left point hit marks only its component, never whole-query coverage or a miss.
            if runner.device && runner.retained_row(&read.table, &row)? { runner.components.note(|frame| frame.retained = true); }
            runner.note_expiry(table, &row);
            let projected = runner.disclosed_row(table, row).for_query();

            let visible = projected.into_value(); // drop hidden storage before leaving the internal scope
            Ok(Some(AuthorizedRow { projection: runner.disclosed_row(table, visible).for_query(), authority: RowAuthorization(()), expiry: Default::default() }))
        })?;
        // The live aggregate is an authorized result computation. It must keep
        // its ordinary work budget and cannot publish a partial scalar value.
        let Some(authorized) = authorized else {
            if !*absent && self.read_capped() { self.point_cut(read, key); }
            return Ok(None);
        };
        expiry.emit();
        // A maintained point read has already reserved its recount scratch (aggregate_point_scratch).
        let row = if prepaid_examined { self.live_aggregate_prepaid(&read.table, authorized.into_value())? } else { self.live_aggregate(&read.table, authorized.into_value())? }.unwrap_or(Value::Null);
        Ok(Some(AuthorizedRow { projection: self.disclosed_row(table, row).for_query(), authority: RowAuthorization(()), expiry: Default::default() }))
    }

    /// A key-authorized synthetic aggregate image (its fields are the caller's
    /// key, the group id derived from it and the disclosed total) is sealed
    /// without a second row lookup: nothing in it came from hidden storage.
    pub(super) fn authorized_synthetic(&self, table: &'r crate::schema::Table, row: Value) -> AuthorizedRow<'r> {
        AuthorizedRow { projection: self.disclosed_row(table, row).for_query(), authority: RowAuthorization(()), expiry: Default::default() }
    }

    // @ref LLP 3000.016#2.2 — withhold missing cards before an examination cut can conceal their coverage.
    // Admission still precedes candidate access (LLP 3000.015 §2): a device point
    // read that cannot examine a partially held card is unknown, never a hole.
    // Owned events have no horizon themselves; classify their source kinds
    // from schema/key metadata even when admission prevented the lookup.
    fn point_cut(&mut self, read: &Read, key: &[Value]) {
        if self.device {
            self.point_miss(read, key);
        }
    }

    fn point_miss(&mut self, read: &Read, key: &[Value]) {
        let table = &self.schema.tables[&read.table];
        self.event_read_unknown(&read.table, &read.index, key, &read.site);
        if self.device && table.sync.as_ref().is_some_and(|s| s.horizon.is_some()) {
            self.unknown_fact(&read.table, &read.index, key, &read.site);
            self.components.note(|frame| frame.speculative = true);
            self.withhold_unheld_card(&read.table);
        } else if self.device && self.schema.maintain_for(&read.table).and_then(|m|m.row_key.as_ref()).is_some_and(|k|self.schema.tables[&k.table].sync.as_ref().is_none_or(|s|s.horizon.is_some())) {
            self.unknown_fact(&read.table, &read.index, key, &read.site);
        }
    }
}
