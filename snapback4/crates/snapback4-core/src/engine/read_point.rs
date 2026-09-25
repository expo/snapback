//! Point reads own authorization and provisional expiry until their answer emits.
use super::{runner::Runner, rules, read::PrefixProbe};
use crate::{error::{RuntimeError, MeterKind}, ir::Read, schema::materialize_optional_fields, value::Value};
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
        let value = self.get_inner(read, &mut emitted)?;
        if maintained { self.meter.require_uncapped()?; }
        if emitted && self.meter.capped_at.is_none() { expiry.emit(); }
        Ok(value)
    }

    fn get_inner(&mut self, read: &Read, emitted: &mut bool) -> Result<Value, RuntimeError> {
        let key = read.key.iter().map(|value| self.expr(value)).collect::<Result<Vec<_>, _>>()?;
        let table = self.schema.table(&read.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", read.table)))?;
        self.read_tables.insert(read.table.clone());
        self.rule_dependencies(&table.rules.read);
        self.meter.at(&read.site);
        self.aggregate_read_coverage(&read.table, &read.index, &key, &read.site);
        let Some(maintain) = self.schema.maintain_for(&read.table) else { return self.get_prepared(read, &key, emitted); };
        if let Some(message) = maintain.expiring_read_refusal(self.schema) {
            return Err(RuntimeError::Structural { code: "E_MAINTAIN_READ_EXPIRE", message });
        }
        let scratch = self.aggregate_point_scratch(maintain, &key);
        self.meter.heap(scratch)?;
        let result = (|| {
            self.read_charge(MeterKind::Examined, 1)?;
            self.meter.require_uncapped()?;
            self.get_prepared(read, &key, emitted)
        })();
        // Transfer only the returned image to retained ownership. Keep the
        // high-water mark, work counters and any cut when releasing scratch.
        self.meter.used.heap_bytes = self.meter.used.heap_bytes.saturating_sub(scratch);
        let value = result?;
        self.meter.heap(value.clone_heap_bytes())?;
        Ok(value)
    }

    fn get_prepared(&mut self, read: &Read, key: &[Value], emitted: &mut bool) -> Result<Value, RuntimeError> {
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
                    super::through::ParentVerdict::Unknown => { self.unknown_fact(&read.table,&read.index,&key,&read.site); false },
                    _ => false,
                }
            } else {
                let mut fields: std::collections::BTreeMap<_, _> = index.columns().into_iter().zip(key.iter().cloned()).collect();
                let group_fields = m.group_fields();
                if group_fields.iter().all(|f| fields.contains_key(f)) {
                    let group: Vec<_> = group_fields.iter().map(|f| fields[f].clone()).collect();
                    fields.insert("id".into(), Value::Id(crate::schema::maintained_id(&group)));
                }
                let row = Value::Row(fields.into());
                self.meter.charge(MeterKind::RuleProbes, rules::rule_probes(&table.rules.read))?;
                let viewer = self.context.viewer.clone();
                if self.device { self.authorize_read(&read.table, &row, true)? }
                else { self.context.is_system() || rules::evaluate(&table.rules.read,&viewer,None,&row,false,&mut PrefixProbe {runner:self})? }
            }))();
            if !visible? || self.read_capped() { return Ok(crate::value::object([("value",Value::Null)])); }
            key_admitted = true;
            if self.device && (table.residency.online_only || (m.parent_key.is_none() && !self.captured_aggregate_coverage(m, index, key)?)) {
                self.unknown_fact(&read.table, &read.index, key, &read.site);
                return Ok(crate::value::object([("value", Value::Null)]));
            }
            if self.device && m.parent_key.is_some() {
                if self.beyond_horizon { return Ok(crate::value::object([("value",Value::Null)])); }
                // The parent-key view is derived locally from fully held children;
                // its generated table need not have an invertible sync audience.
                let fields = index.columns().into_iter().zip(key.iter().cloned()).collect::<std::collections::BTreeMap<_,_>>();
                let row = self.live_aggregate_inner(m, Value::Row(fields.into()))?.unwrap_or(Value::Null);
                *emitted = true;
                return Ok(row);
            }
        }
        if self.filter_depth > 0 && !self.read_charge(MeterKind::RuleProbes, 1)? { return Ok(Value::Null); }
        if self.device && table.sync.is_none() {
            self.unknown_fact(&read.table, &read.index, &key, &read.site);
        }
        if key.iter().any(|value| *value == Value::Null) && !index.columns().iter().zip(key).all(|(column, value)| *value != Value::Null || table.columns.get(column).is_some_and(|kind| kind.is_optional())) {
            // A null key on a required column addresses nothing.
            return Ok(Value::Null);
        }
        // @ref LLP 3000.007#20.12 — reserve authorization before knowing hit, miss or hidden; an exhausted probe is not a false verdict to roll back.
        let trusted = key_admitted || self.context.is_system() || self.trust_synced_read(table);
        // Prediction keeps the server's reservation even for delivered rows.
        // Only the additional physical authority work uses the device allowance.
        let prepaid = !trusted || (self.device_allowance.is_some() && !self.context.is_system());
        if prepaid && !self.read_charge(MeterKind::RuleProbes, rules::rule_probes(&table.rules.read))? { return Ok(Value::Null); }
        // Hidden and absent cost one examined row and the same static probe
        // allowance, including probes that a rule would short-circuit.
        let stored_authorization = inherited.is_some_and(|m| !self.schema.tables[&m.source].is_expiring()) && !key_admitted;
        let mark = self.meter.mark();
        let tables_mark = self.read_tables.clone();
        let found = self.live_lookup(&read.table, &read.index, index, &key)?;
        // An expiring lookup already charged its live candidate while
        // passing expired siblings. A miss still costs one point read.
        if maintained.is_none() && (!table.is_expiring() || found.is_none()) && !self.read_charge(MeterKind::Examined, 1)? {
            return Ok(Value::Null);
        }
        let mut group_exists = found.is_some();
        let mut row = if stored_authorization {
            // Only non-expiring sources reach this path: the stored total
            // is already live. A missing group authorizes its logical zero.
            let live = found;
            group_exists = live.is_some();
            match live {
                Some(row) => row,
                None => {
                    // The same reservation owns a live row or a logical zero.
                    let mut fields: std::collections::BTreeMap<_, _> = index.columns().into_iter().zip(key.iter().cloned()).collect();
                    let m = maintained.expect("maintained aggregate");
                    if !m.by.iter().all(|field| fields.contains_key(field)) { return Ok(crate::value::object([("value", Value::Null)])); }
                    let group: Vec<_> = m.by.iter().map(|field| fields[field].clone()).collect();
                    fields.insert("id".into(), Value::Id(crate::schema::maintained_id(&group)));
                    fields.insert("value".into(), Value::Int(0));
                    Value::Row(fields.into())
                }
            }
        } else if let Some(row) = found { row } else {
            *emitted = key_admitted; // An authorized missing aggregate emits its logical zero.
            if self.device && table.sync.as_ref().is_some_and(|s| s.horizon.is_some()) { self.unknown_fact(&read.table, &read.index, &key, &read.site); }
            return Ok(Value::Null);
        };
        if self.expired(table, &row) {
            return Ok(Value::Null);
        }
        materialize_optional_fields(&mut row, table);
        let provisional = self.is_provisional(&read.table, &row)?;
        let viewer = self.context.viewer.clone();
        let allowed = if provisional && !self.context.is_system() {
            self.authorize_read(&read.table, &row, prepaid)?
        } else { trusted || rules::evaluate(&table.rules.read, &viewer, None, &row, false, &mut PrefixProbe { runner: self })? };
        // A failed authorization owns its charges and its cut. Hidden-candidate
        // rollback must never erase exhaustion or convert it into coverage.
        if self.read_capped() { return Ok(Value::Null); }
        if allowed {
            // @ref LLP 3000.001#proposed-composition-of-retained-and-authoritative-reads — a delivered left point hit marks only its component, never whole-query coverage or a miss.
            if self.device && self.retained_row(&read.table, &row)? { self.components.note(|frame| frame.retained = true); }
            self.note_expiry(table, &row);
            let value = if stored_authorization { if group_exists { row } else { Value::Null } }
                else if let Some(m) = maintained.filter(|m| self.schema.tables[&m.source].is_expiring()) {
                    self.live_aggregate_inner(m, row)?.unwrap_or(Value::Null)
                } else { row };
            *emitted = true;
            Ok(super::recorded::public_image(table, value))
        } else {
            self.read_tables = tables_mark;
            if !provisional {
                self.meter.restore(mark);
                if maintained.is_none() { self.read_charge(MeterKind::Examined, 1)?; }
            }
            Ok(if inherited.is_some() { crate::value::object([("value", Value::Null)]) } else { Value::Null })
        }
    }

}
