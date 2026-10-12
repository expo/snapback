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
    pub(super) fn authorized_member(&mut self, name: &str, id: &str, #[cfg(feature = "server-search")] trusted: bool) -> Result<Option<Value>, RuntimeError> {
        let table = &self.schema.tables[name];
        // @ref LLP 3000.024#decision — this id came from an authorized head in
        // this read-only transaction. Price its public image before decoding,
        // then recheck the rule with a separate witness reservation. Neither
        // hidden/expired images nor private fields can select actual-size admission.
        #[cfg(feature = "server-search")]
        if trusted && !self.device && !table.is_expiring() && table.recorded.is_empty()
            && table.through.is_none() && table.written_by.values().all(|a|a.audience) {
            if !self.read_charge(MeterKind::Examined,1)? { return Ok(None); }
            self.meter.heap(crate::rows::word_heap::text(id) + crate::rows::word_heap::slots::<Value>(1))?;
            let key = [Value::Id(id.into())];
            let Some((Some(row),_)) = self.scan_authorized(name,crate::schema::BY_ID,&key,&Default::default(),crate::rows::Dir::Asc,1,true,true,None)?.pop() else { return Ok(None); };
            let materialization = row.materialization_heap();
            let prepay = self.meter.mark();
            self.meter.heap(materialization)?;
            let expiry = self.next_expiry.scope();
            let row = self.authorized_scratch(self.rule_scratch(&table.rules.read), &[(MeterKind::RuleProbes,super::rules::rule_probes(&table.rules.read))], |runner,_| {
                let row = runner.authorize_image(name,row.into_value())?;
                if let Some(row) = &row { runner.next_expiry.inherit(row.expiry()); }
                Ok(row)
            });
            // The value now owns the default. Transfer its prepay to charge(),
            // keeping only one retained reservation after the recheck.
            self.meter.release_row_heap(prepay, materialization);
            let row = row?;
            if row.is_some() { expiry.emit(); }
            return row.map(|row|row.charge(&mut self.meter)).transpose();
        }
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
        self.scan_authorized(name,index,prefix,bounds,dir,limit,true,true,#[cfg(feature = "server-search")] None)
    }

    pub(super) fn scan_authorized(&mut self, name: &str, index: &str, prefix: &[Value], bounds: &crate::rows::Bounds, dir: crate::rows::Dir, limit: usize, metered: bool, trusted: bool, #[cfg(feature = "server-search")] fields: Option<&[String]>) -> Result<Vec<(Option<AuthorizedRow<'r>>, Vec<u8>)>, RuntimeError> {
        self.scan_authorized_prepaid(name, index, prefix, bounds, dir, limit, metered, trusted, false, #[cfg(feature = "server-search")] fields)
    }

    // @ref LLP 3000.007#20.24.6 — a delivered uniform prefix has prepaid its
    // logical rule once; provisional rows still undergo physical authorization.
    pub(super) fn scan_authorized_prepaid(&mut self, name: &str, index: &str, prefix: &[Value], bounds: &crate::rows::Bounds, dir: crate::rows::Dir, limit: usize, metered: bool, trusted: bool, rule_prepaid: bool, #[cfg(feature = "server-search")] fields: Option<&[String]>) -> Result<Vec<(Option<AuthorizedRow<'r>>, Vec<u8>)>, RuntimeError> {
        let table = &self.schema.tables[name];
        // A public, non-expiring image is authorized before accessing storage.
        // No hidden candidate can influence its actual-size decoder admission.
        // Trusted selected heads may use the same actual-size adapter. It
        // decodes a full transient image; the streaming consumer retains only
        // its ordering key. Selection remains useful in the private decoder.
        if (self.context.is_system() || trusted && !table.is_expiring()) && table.recorded.is_empty() && table.through.is_none() && table.written_by.values().all(|a| a.audience) {
            let rows = if metered {
                self.meter.heap(crate::rows::word_heap::slots::<(Option<AuthorizedRow<'_>>,Vec<u8>)>(limit))?;
                self.metered_scan(|runner, scope| runner.tx.scan_metered(scope,name,index,prefix,bounds,dir,limit,&mut runner.meter))?
            } else { self.metered_scan(|runner, scope| runner.tx.scan(scope,name,index,prefix,bounds,dir,limit))? };
            // @ref LLP 3000.007#20.24.5 — a device prices the server's image with the server's charge. Its
            // own prediction rows still meet a non-uniform rule, as prepaid internal work outside the caller's
            // heap; after an earlier cut such a row stays hidden (the read is incomplete either way).
            let check = self.device && !self.context.is_system() && !table.rules.read.is_uniformly_readable();
            let mut out = Vec::with_capacity(rows.len());
            for (row, key) in rows {
                let row = if check && self.is_provisional(name, &row)? {
                    self.prepaid_scan(&[], false, |runner, scope| runner.candidate_verdict(scope, name, index, prefix, row, true, rule_prepaid))?
                } else { Some(AuthorizedRow { projection:self.disclosed_row(table,row),authority:RowAuthorization(()),expiry:Default::default() }) };
                out.push((row, key));
            }
            return Ok(out);
        }
        let bytes = crate::rows::disclosed::decode_reservation(table).saturating_add(self.rule_scratch(&table.rules.read));
        if metered { self.meter.heap(crate::rows::word_heap::slots::<(Option<AuthorizedRow<'_>>, Vec<u8>)>(limit))?; }
        let mut cursor = bounds.clone();
        let mut out = Vec::with_capacity(limit);
        for _ in 0..limit {
            let candidate = self.reserved_scratch(bytes, &[], !trusted, |runner, scope| {
                #[cfg(not(feature = "server-search"))]
                let selected = runner.tx.scan(scope,name,index,prefix,&cursor,dir,1)?;
                #[cfg(feature = "server-search")]
                let selected = if let Some(fields) = fields { runner.tx.scan_selected(scope,name,index,prefix,&cursor,dir,fields)? } else { runner.tx.scan(scope,name,index,prefix,&cursor,dir,1)? };
                let Some((row,key)) = selected.into_iter().next() else { return Ok(None); };
                // Advancing over a rejected candidate is internal decoder work.
                cursor.after = crate::key::decode(&key).map(|v|v.into_iter().skip(prefix.len()).collect());
                Ok(Some((runner.candidate_verdict(scope, name, index, prefix, row, trusted, rule_prepaid)?,key)))
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

    /// One fetched candidate's expiry, rule and field verdict, inside an
    /// internal scope. Unadmitted rule work is an unknown fact on a device.
    fn candidate_verdict(&mut self, scope: &super::authorized_scan::Authorization, name: &str, index: &str, prefix: &[Value], mut row: Value, trusted: bool, rule_prepaid: bool) -> Result<Option<AuthorizedRow<'r>>, RuntimeError> {
        let table = &self.schema.tables[name];
        crate::schema::materialize_optional_fields(&mut row,table);
        let provisional = self.is_provisional(name,&row)?;
        let needs_rule = !self.context.is_system() && (!trusted || provisional);
        if needs_rule && !rule_prepaid && !self.device_work_active && !scope.admit_probes(super::rules::rule_probes(&table.rules.read)) {
            // @ref LLP 3000.020#3.2 — unresolved authority is unknown, not an absent contribution.
            if self.device { self.unknown_fact(name, index, prefix, "source rule admission"); }
            return Ok(None);
        }
        if trusted && !provisional && self.schema.maintain_for(name).is_some_and(|m| m.parent_key.is_some()) {
            return Ok(Some(self.authorized_synthetic(table, row)));
        }
        self.authorize_image(name,row)
    }

    /// Cold certification has already admitted the member and entire source
    /// group, including a decoder page reserved before entering prepaid work. Every row
    /// still receives the ordinary expiry, rule and field verdict below.
    // @ref LLP 3000.015#3 — live count certification shares its transaction and authority.
    #[cfg(feature = "sqlite")]
    pub(super) fn scan_acquisition_basis(&mut self, name: &str, index: &str, prefix: &[Value], bounds: &crate::rows::Bounds) -> Result<Vec<(Option<AuthorizedRow<'r>>, Vec<u8>)>, RuntimeError> {
        const PAGE: usize = 32;
        assert!(!self.device);
        let table = &self.schema.tables[name];
        let rows = self.disclosed_scratch(0, &[], |runner, scope| {
            let selected = runner.tx.scan(scope, name, index, prefix, bounds, crate::rows::Dir::Asc, PAGE)?;
            let mut out = Vec::with_capacity(selected.len());
            for (mut row, key) in selected {
                crate::schema::materialize_optional_fields(&mut row, table);
                let provisional = runner.is_provisional(name, &row)?;
                if provisional && !runner.context.is_system() && !scope.admit_probes(super::rules::rule_probes(&table.rules.read)) {
                    out.push((None, key)); continue;
                }
                let row = if !provisional && runner.schema.maintain_for(name).is_some_and(|m| m.parent_key.is_some()) {
                    Some(runner.authorized_synthetic(table, row))
                } else { runner.authorize_image(name, row)? };
                out.push((row, key));
            }
            Ok(out)
        })?;
        for (row, key) in &rows {
            if let Some(row) = row {
                self.meter.heap(row.heap_bytes() + row.projection_heap() + row.materialization_heap()
                    + crate::rows::word_heap::key_decode(table.index(index).map_or(1, |i| i.components.len() + 1), key.len()))?;
            }
        }
        Ok(rows)
    }

    // @ref LLP 3000.015#1 — row and field authorization precede result pricing.
    pub(super) fn authorized_point(&mut self, read: &Read, index: &Index, key: &[Value], prepaid: bool, trusted: bool, prepaid_examined: bool, absent: &mut bool) -> Result<Option<AuthorizedRow<'r>>, RuntimeError> {
        let table = &self.schema.tables[&read.table];
        let row = if crate::rows::disclosed::actual_size(table) {
            if !prepaid_examined && !self.read_charge(MeterKind::Examined,1)? { self.point_cut(read, key); return Ok(None); }
            let scratch = self.meter.mark();
            let row = self.metered_scan(|runner, scope| runner.tx.scan_metered(scope,&read.table,&read.index,key,&Default::default(),crate::rows::Dir::Asc,1,&mut runner.meter))?.pop();
            self.meter.release_heap(scratch);
            let Some((mut row,_)) = row else {
                *absent = true;
                self.point_miss(read, key);
                #[cfg(feature = "sqlite")]
                if !self.device && !self.read_capped() { self.no_candidate(&read.table, &read.site); }
                return Ok(None);
            };
            if !self.point_event_held(read, key, &row) {
                return Ok(None);
            }
            if self.device && self.retained_row(&read.table,&row)? { self.components.note(|frame|frame.retained=true); }
            crate::schema::materialize_optional_fields(&mut row,table);
            row
        } else {
            let bytes = crate::rows::disclosed::decode_reservation(table).saturating_add(self.rule_scratch(&table.rules.read));
            // @ref LLP 3000.014#5-what-derives-from-the-capture — a hidden, expired or absent candidate's deadlines are discarded with this scope.
            let expiry = self.next_expiry.scope();
            let authorized = self.authorized_scratch(bytes, &[(MeterKind::Examined, u64::from(!prepaid_examined))], |runner, scope| {
                #[cfg(feature = "sqlite")]
                let mut encountered = false;
                let Some(row) = runner.live_lookup(scope,&read.table, &read.index, index, key, #[cfg(feature = "sqlite")] Some(&mut encountered))? else {
                    *absent = true;
                    runner.point_miss(read, key);
                    #[cfg(feature = "sqlite")]
                    if !encountered && !runner.device && !runner.read_capped() { runner.no_candidate(&read.table, &read.site); }
                    return Ok(None);
                };
                // @ref LLP 3000.016#21a-owned-events-follow-their-source-rows — a held source whose event kind is not fully synced answers nothing.
                if !runner.point_event_held(read, key, &row) {
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
            authorized.into_value()
        };
        // A maintained point read has already reserved its recount scratch (aggregate_point_scratch).
        let row = if prepaid_examined { self.live_aggregate_prepaid(&read.table, row)? } else { self.live_aggregate(&read.table, row)? }.unwrap_or(Value::Null);
        Ok(Some(AuthorizedRow { projection: self.disclosed_row(table, row).for_query(), authority: RowAuthorization(()), expiry: Default::default() }))
    }

    fn point_event_held(&mut self, read: &Read, key: &[Value], row: &Value) -> bool {
        if self.device && !crate::schema::timeline::holds_event(self.schema, &read.table, row) {
            self.event_read_unknown(&read.table, &read.index, key, &read.site);
            return false;
        }
        true
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

#[cfg(all(test, feature = "sqlite", feature = "server-search"))]
mod tests {
    use super::*;
    use crate::{Context, Schema, rows::{MemoryRows, Rows}, schema::{ColumnDefault, ColumnType, Index}, value::object};

    #[test]
    fn trusted_search_member_prepays_missing_defaults() {
        let rows = MemoryRows::new();
        let mut table = crate::schema::public_table([
            ("id".into(),ColumnType::Id), ("payload".into(),ColumnType::Text {max:1_000_000}),
        ].into(),[("byId".into(),Index::of(&["id"],true))].into());
        table.defaults.insert("payload".into(),ColumnDefault::Literal(Value::String("x".repeat(1_000_000))));
        // Existing storage can omit a subsequently adopted default. Authority
        // is public here, so this exercises only its materialization admission.
        rows.put("records",&table,&object([("id",Value::Id("hit".into()))]),None).unwrap();
        let schema = Schema { tables:[("records".into(),table)].into(),..Default::default() };
        for heap in [64 << 10,16 << 20] {
            let mut runner = Runner::new(&rows,&schema,Context::new("alice",Default::default()),
                Meter::new(crate::Ceilings {heap_bytes:heap,..Default::default()},crate::meter::Cut::Cap),0);
            let (result,allocated) = crate::rows::word_heap::tests::measured(||runner.authorized_member("records","hit",true));
            eprintln!("heap={heap}: allocated={allocated}, peak={}",runner.meter.heap_peak);
            if heap == 64 << 10 {
                assert!(matches!(result,Err(RuntimeError::Bound {kind:MeterKind::HeapBytes,..})),"{result:?}");
                assert!(allocated < 64 << 10,"refused before copying the million-byte default: allocated={allocated}");
            } else {
                let row = result.unwrap().unwrap();
                assert_eq!(row.field("payload").unwrap().as_str().unwrap().len(),1_000_000);
                assert!(allocated <= runner.meter.heap_peak,"allocated={allocated}, peak={}",runner.meter.heap_peak);
            }
        }
    }
}
