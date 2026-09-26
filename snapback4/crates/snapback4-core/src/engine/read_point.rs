//! Point reads own authorization and provisional expiry until their answer emits.
// @ref LLP 3000.015#1 — the ordinary point read is `authorized_point`: row and
// field authorization precede result pricing, under the request's one physical
// allowance. 0.4.2's inherited-aggregate, parent-key and event-slot branches
// (LLP 3000.014 §5, LLP 3000.016 §2.2) sit above that boundary and share it.
use super::{runner::Runner, rules, read::PrefixProbe};
use crate::{error::{RuntimeError, MeterKind}, ir::Read, value::Value};
use std::collections::BTreeMap;

fn unavailable_aggregate() -> Value { crate::value::object([("value", Value::Null)]) }

impl Runner<'_> {
    /// A point read: the row when it exists and the viewer may read it, else
    /// `null`. Hidden and absent are the same word on purpose.
    pub(super) fn get(&mut self, read: &Read) -> Result<Value, RuntimeError> {
        let expiry = self.next_expiry.scope();
        let mut emitted = false;
        self.schema.refuse_private(&read.table)?;
        // @ref LLP 3000.007#20.21 — an unfinished maintained value is unavailable, never an absent group coerced to zero.
        let maintained = self.schema.maintain_for(&read.table).is_some();
        if maintained { self.meter.require_uncapped()?; }
        let mut value = self.get_inner(read, &mut emitted)?;
        if maintained { self.meter.require_uncapped()?; }
        if emitted && self.meter.capped_at.is_none() { self.stamp_source(&read.table, &mut value)?; expiry.emit(); }
        Ok(value)
    }

    fn get_inner(&mut self, read: &Read, emitted: &mut bool) -> Result<Value, RuntimeError> {
        let key = read.key.iter().map(|value| self.expr(value)).collect::<Result<Vec<_>, _>>()?;
        self.observe_sequence_selection(&read.table, &read.index, &key)?;
        let table = self.schema.table(&read.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", read.table)))?;
        self.read_tables.insert(read.table.clone());
        self.rule_dependencies(&table.rules.read);
        self.meter.at(&read.site);
        self.aggregate_read_coverage(&read.table, &read.index, &key, &read.site);
        let Some(maintain) = self.schema.maintain_for(&read.table) else {
            let (value, price) = self.get_prepared(read, &key, emitted)?;
            self.meter.heap(price)?;
            return Ok(value);
        };
        if let Some(message) = maintain.expiring_read_refusal(self.schema) {
            return Err(RuntimeError::Structural { code: "E_MAINTAIN_READ_EXPIRE", message });
        }
        // @ref LLP 3000.014#5-what-derives-from-the-capture — a point hit, miss or denial reserves the same reusable row scratch before discovering occupancy.
        let scratch = self.aggregate_point_scratch(maintain, &key);
        self.meter.heap(scratch)?;
        let result = (|| {
            self.read_charge(MeterKind::Examined, 1)?;
            self.meter.require_uncapped()?;
            self.get_prepared(read, &key, emitted)
        })();
        // Transfer only the sealed result to retained ownership. Keep the
        // high-water mark, work counters and any cut when releasing scratch.
        self.meter.used.heap_bytes = self.meter.used.heap_bytes.saturating_sub(scratch);
        let (value, price) = result?;
        self.meter.heap(price)?;
        Ok(value)
    }

    /// The answer and the sealed price of its retained image, charged by the caller
    /// once its scratch is released.
    fn get_prepared(&mut self, read: &Read, key: &[Value], emitted: &mut bool) -> Result<(Value, u64), RuntimeError> {
        let table = self.schema.table(&read.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", read.table)))?;
        let index = table.index(&read.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", read.table, read.index)))?;
        let maintained = self.schema.maintain_for(&read.table);
        let inherited = maintained.filter(|m| self.schema.tables[&m.source].through.is_some());
        let mut key_admitted = false;
        // @ref LLP 3000.014#5-what-derives-from-the-capture — only key-determined inputs may authorize a synthetic aggregate row.
        if let Some(m) = inherited.filter(|m| m.parent_key.is_some() || rules::deciding_fields(&read.table, table, &table.rules.read).iter().all(|field| index.columns().iter().take(key.len()).any(|column| column == field) || (field == "id" && m.group_fields().iter().all(|f| index.columns().iter().take(key.len()).any(|column| column == f))))) {
            let visible = (|| Ok(if let Some(parent) = &m.parent_key {
                let Some(at) = index.columns().iter().position(|f| f == &parent.reference) else { return Err(RuntimeError::Structural {code:"E_READ_THROUGH_SCAN",message:format!("{} must be read by its full parent key; use {}[parent] (guide maintains)",read.table,read.table)}); };
                let parent_id = key.get(at).ok_or_else(|| RuntimeError::Input("read through aggregate needs its full parent key".into()))?;
                match self.parent_verdict(&m.source,parent,parent_id)? {
                    super::through::ParentVerdict::Readable => true,
                    super::through::ParentVerdict::Unknown => { self.unknown_fact(&read.table,&read.index,key,&read.site); false },
                    _ => false,
                }
            } else {
                let mut fields: BTreeMap<_, _> = index.columns().into_iter().zip(key.iter().cloned()).collect();
                let group_fields = m.group_fields();
                if group_fields.iter().all(|f| fields.contains_key(f)) {
                    let group: Vec<_> = group_fields.iter().map(|f| fields[f].clone()).collect();
                    fields.insert("id".into(), Value::Id(crate::schema::maintained_id(&group)));
                }
                let row = Value::Row(fields.into());
                self.meter.charge(MeterKind::RuleProbes, rules::rule_probes(&table.rules.read))?;
                let viewer = self.context.viewer.clone();
                if self.device { self.authorize_read(&read.table, &row, true)? }
                else if self.context.is_system() { true }
                else {
                    // The key rule's probes were charged above, possibly to a cut; its
                    // witnesses still run under the request's physical allowance and
                    // the cut stops the read before any aggregate state is fetched.
                    self.prepaid_witnesses(|runner, allowance| rules::evaluate(&table.rules.read,&viewer,None,&row,false,&mut PrefixProbe { runner, allowance }))?
                }
            }))();
            if !visible? || self.read_capped() { return Ok((unavailable_aggregate(), 0)); }
            key_admitted = true;
            if self.device && (table.residency.online_only || (m.parent_key.is_none() && !self.captured_aggregate_coverage(m, index, key)?)) {
                self.unknown_fact(&read.table, &read.index, key, &read.site);
                return Ok((unavailable_aggregate(), 0));
            }
            if self.device && m.parent_key.is_some() {
                if self.beyond_horizon { return Ok((unavailable_aggregate(), 0)); }
                // The parent-key view is derived locally from fully held children;
                // its generated table need not have an invertible sync audience.
                let fields = index.columns().into_iter().zip(key.iter().cloned()).collect::<BTreeMap<_,_>>();
                let row = self.live_aggregate_inner(m, Value::Row(fields.into()))?.unwrap_or(Value::Null);
                *emitted = true;
                // Key-authorized and computed from the caller's key and the disclosed total: sealed without a lookup.
                let sealed = self.authorized_synthetic(table, row);
                let price = sealed.heap_bytes() + sealed.projection_heap() + sealed.materialization_heap();
                return Ok((sealed.into_value(), price));
            }
        }
        if self.filter_depth > 0 && !self.read_charge(MeterKind::RuleProbes, 1)? { return Ok((Value::Null, 0)); }
        if self.device && table.sync.is_none() {
            self.unknown_fact(&read.table, &read.index, key, &read.site);
            self.components.note(|frame| frame.speculative = true);
            self.withhold_unheld_card(&read.table);
        }
        if key.iter().any(|value| *value == Value::Null) && !index.columns().iter().zip(key).all(|(column, value)| *value != Value::Null || table.columns.get(column).is_some_and(|kind| kind.is_optional())) {
            // A null key on a required column addresses nothing.
            return Ok((Value::Null, 0));
        }
        // @ref LLP 3000.007#20.12 — reserve authorization before knowing hit, miss or hidden; an exhausted probe is not a false verdict to roll back.
        let trusted = key_admitted || self.context.is_system() || self.trust_synced_read(table);
        // @ref LLP 3000.015#2 — prediction keeps the server's reservation even for
        // delivered rows; a key-admitted aggregate has already paid its rule.
        let prepaid = !self.context.is_system() && !key_admitted;
        if prepaid && !self.read_charge(MeterKind::RuleProbes, rules::rule_probes(&table.rules.read))? { return Ok((Value::Null, 0)); }
        // @ref LLP 3000.014#5-what-derives-from-the-capture — a non-expiring inherited total is already live; a missing group authorizes its logical zero.
        let stored_authorization = inherited.is_some_and(|m| !self.schema.tables[&m.source].is_expiring()) && !key_admitted;
        let tables_mark = self.read_tables.clone();
        let mut absent = false;
        let found = self.authorized_point(read, index, key, prepaid, trusted, maintained.is_some(), &mut absent)?;
        let Some(row) = found else {
            if absent && stored_authorization {
                // The same reservation owns a live row or a logical zero.
                let mut fields: BTreeMap<_, _> = index.columns().into_iter().zip(key.iter().cloned()).collect();
                let m = maintained.expect("maintained aggregate");
                if !m.by.iter().all(|field| fields.contains_key(field)) { return Ok((unavailable_aggregate(), 0)); }
                let group: Vec<_> = m.by.iter().map(|field| fields[field].clone()).collect();
                fields.insert("id".into(), Value::Id(crate::schema::maintained_id(&group)));
                fields.insert("value".into(), Value::Int(0));
                let zero = Value::Row(fields.into());
                // The rule was prepaid above; its witnesses run on the restoring scope.
                let authorized = self.authorized_scratch(0, &[], |runner, _| runner.authorize_image(&read.table, zero))?;
                if self.read_capped() { return Ok((Value::Null, 0)); }
                return Ok(match authorized {
                    Some(row) => { self.next_expiry.inherit(row.expiry()); *emitted = true; (Value::Null, 0) }
                    None => { self.read_tables = tables_mark; (unavailable_aggregate(), 0) }
                });
            }
            if absent {
                // An authorized missing aggregate emits its logical zero: null here,
                // which the compiled read coerces to 0 (LLP 3000.007 §20.21).
                *emitted = key_admitted;
                return Ok((Value::Null, 0));
            }
            self.read_tables = tables_mark;
            return Ok((if inherited.is_some() { unavailable_aggregate() } else { Value::Null }, 0));
        };
        let price = row.heap_bytes() + row.projection_heap() + row.materialization_heap();
        let mut value = row.into_value();
        // @ref LLP 3000.014#5 — retained history stays marked through projections; ordinary retained
        // point reads keep their established component composition (the row-level fallback is read-through's).
        if self.device && table.through.is_some() && self.context.row_provenance && self.retained_row(&read.table, &value)? {
            if let Value::Row(fields) = &mut value { fields.mark_retained(); }
        }
        let value = self.sequence_read_result(&read.table, value)?;
        *emitted = true;
        Ok((if matches!(self.timeline_authority, Some(super::timeline_authority::Authority::Transition(_))) { value }
            else { super::recorded::public_image(table, value) }, price))
    }
}
