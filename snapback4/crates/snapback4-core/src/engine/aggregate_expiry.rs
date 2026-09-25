//! Physical aggregate totals minus the unswept expiry backlog.
use super::runner::Runner;
use crate::{error::{MeterKind, RuntimeError}, rows::{Bounds, Dir}, schema::{Maintain, materialize_optional_fields}, value::Value};

impl Runner<'_> {
    /// A maintain over expiring source rows is a live fact before the
    /// physical sweep catches up. Servers subtract the expired backlog;
    /// devices retain live recomputation and their existing coverage rules.
    // @ref LLP 3000.007#20.9.3 — physical totals minus unswept expiry; device physical delivery remains stopped.
    pub(crate) fn live_aggregate(&mut self, table_name: &str, row: Value) -> Result<Option<Value>, RuntimeError> {
        let Some(maintain) = self.schema.maintain_for(table_name).cloned() else { return Ok(Some(row)); };
        if maintain.row_key.is_some() { return self.live_row_view(&maintain, row); }
        let source = self.schema.table(&maintain.source).ok_or_else(|| RuntimeError::Schema("missing maintain source".into()))?;
        if source.expire.is_none() { return Ok(Some(row)); }
        let bytes = super::write_target::row_copy_ceiling(source).saturating_mul(32)
            .saturating_add(super::write_target::row_copy_ceiling(&self.schema.tables[table_name]).saturating_mul(16));
        self.maintain_scratch(bytes, |runner| runner.expiring_aggregate(&maintain, row))
    }

    fn live_aggregate_inner(&mut self, maintain: &crate::schema::Maintain, row: Value) -> Result<Option<Value>, RuntimeError> {
        let source = &self.schema.tables[&maintain.source];
        self.read_tables.insert(maintain.source.clone());
        let group = crate::schema::maintained_key(&row, &maintain.by);
        let (index, prefix) = maintain.source_scan(source, &group);
        if self.device && source.sync.as_ref().is_none_or(|sync| sync.horizon.is_some()) {
            self.unknown_fact(&maintain.source, index, &prefix, "live aggregate");
        }
        let mut bounds = Bounds::default();
        let mut total = 0_i128;
        let mut any = false;
        'sources: loop {
            let rows = self.metered_scan(|runner, allowance| runner.tx.scan(allowance, &maintain.source, index, &prefix, &bounds, Dir::Asc, 32))?;
            let count = rows.len();
            for (mut candidate, key) in rows {
                materialize_optional_fields(&mut candidate, source);
                if !self.read_charge(MeterKind::Examined, 1)? { break 'sources; }
                bounds.after = crate::key::decode(&key).map(|values| values.into_iter().skip(prefix.len()).collect());
                if !self.read_charge(MeterKind::Steps, maintain.evaluation_steps())? { break 'sources; }
                if self.expired(source, &candidate) || !maintain.selected(&candidate) || maintain.source_key(&candidate) != group { continue; }
                let prior = std::mem::replace(&mut self.beyond_horizon, false);
                let allowed = self.provisional_readable(&maintain.source, &candidate);
                let unknown = self.beyond_horizon;
                self.beyond_horizon |= prior;
                if !allowed? {
                    if unknown { return Ok(None); }
                    continue;
                }
                any = true;
                self.note_expiry(source, &candidate);
                total += match &maintain.kind { crate::schema::MaintainKind::Count => 1, crate::schema::MaintainKind::Sum { of } => i128::from(candidate.field(of)?.as_int()?) };
            }
            if count < 32 { break; }
        }
        self.meter.require_uncapped()?;
        if !any { return Ok(None); }
        if !(crate::value::I53_MIN as i128..=crate::value::I53_MAX as i128).contains(&total) {
            return Err(super::maintains::aggregate_overflow(&maintain));
        }
        let mut fields = row.as_object()?.clone();
        fields.insert("value".into(), Value::Int(total as i64));
        Ok(Some(Value::Row(fields.into())))
    }

    fn expiring_aggregate(&mut self, maintain: &Maintain, row: Value) -> Result<Option<Value>, RuntimeError> {
        if self.device { return self.live_aggregate_inner(maintain, row); }
        #[cfg(feature = "sqlite")]
        { self.backlog_aggregate(maintain, row) }
        #[cfg(not(feature = "sqlite"))]
        { self.live_aggregate_inner(maintain, row) }
    }

    #[cfg(feature = "sqlite")]
    fn backlog_aggregate(&mut self, maintain: &Maintain, row: Value) -> Result<Option<Value>, RuntimeError> {
        let source = &self.schema.tables[&maintain.source];
        self.read_tables.insert(maintain.source.clone());
        let group = crate::schema::maintained_key(&row, &maintain.by);
        let index = maintain.contribution_index();
        let now = self.context.now.unwrap_or(i64::MIN);
        let mut total = i128::from(row.field("value")?.as_int()?);
        let mut bounds = Bounds { lte: self.context.now.map(Value::Int), ..Bounds::default() };
        // No clock means expiry is disabled, as for ordinary row reads.
        if self.context.now.is_some() {
            loop {
                let rows = self.metered_scan(|runner, allowance| runner.tx.scan(allowance, &maintain.source, &index, &group, &bounds, Dir::Asc, 32))?;
                let count = rows.len();
                for (mut candidate, key) in rows {
                    if !self.read_charge(MeterKind::Examined, 1)? { self.meter.require_uncapped()?; }
                    materialize_optional_fields(&mut candidate, source);
                    bounds.after = crate::key::decode(&key).map(|values| values.into_iter().skip(group.len()).collect());
                    if !self.read_charge(MeterKind::Steps, maintain.evaluation_steps())? { self.meter.require_uncapped()?; }
                    total -= super::maintains::delta(maintain, &candidate, 1)?;
                }
                if count < 32 { break; }
            }
        }
        // A zero signed sum is a candidate while any live contribution remains.
        // This seek also supplies the next clock invalidation without walking live rows.
        if !self.read_charge(MeterKind::Examined, 1)? { self.meter.require_uncapped()?; }
        let bounds = Bounds { gt: self.context.now.map(|_| Value::Int(now)), ..Bounds::default() };
        let next = self.metered_scan(|runner, allowance| runner.tx.scan(allowance, &maintain.source, &index, &group, &bounds, Dir::Asc, 1))?;
        let Some((mut candidate, _)) = next.into_iter().next() else { return Ok(None) };
        materialize_optional_fields(&mut candidate, source);
        self.note_expiry(source, &candidate);
        if !(crate::value::I53_MIN as i128..=crate::value::I53_MAX as i128).contains(&total) {
            return Err(super::maintains::aggregate_overflow(maintain));
        }
        let mut fields = row.as_object()?.clone();
        fields.insert("value".into(), Value::Int(total as i64));
        Ok(Some(Value::Row(fields.into())))
    }
}
