//! Live recounts run only after key authorization; point-read scratch is reusable.
use super::{runner::Runner, write_target::row_copy_ceiling};
use crate::{
    error::{MeterKind, RuntimeError},
    rows::{Bounds, Dir},
    schema::{Maintain, materialize_optional_fields},
    value::Value,
};

impl Runner<'_> {
    // @ref LLP 3000.014#5-what-derives-from-the-capture — a point hit, miss or denial reserves the same reusable row scratch before discovering occupancy.
    pub(super) fn aggregate_point_scratch(&self, maintain: &Maintain, key: &[Value]) -> u64 {
        let source = &self.schema.tables[&maintain.source];
        row_copy_ceiling(&self.schema.tables[&maintain.target])
            .saturating_mul(17)
            .saturating_add(
                // The key is the caller's evaluated input, never a stored image.
                key.iter()
                    .map(|value| match value { Value::String(s) | Value::Id(s) => s.len() as u64, Value::Bytes(b) => b.len() as u64, _ => 0 })
                    .fold(0_u64, u64::saturating_add)
                    .saturating_mul(8),
            )
            .saturating_add(if source.is_expiring() || (self.device && maintain.parent_key.is_some()) {
                row_copy_ceiling(source).saturating_mul(32)
            } else {
                0
            })
    }

    /// A maintain over expiring source rows is a live fact before the
    /// physical sweep catches up. Recompute only that fact's group, with
    /// the usual runtime meter and device coverage rules.
    pub(crate) fn live_aggregate(
        &mut self,
        table_name: &str,
        row: Value,
    ) -> Result<Option<Value>, RuntimeError> {
        self.aggregate_source_dependency(table_name);
        let Some(maintain) = self.schema.maintain_for(table_name) else {
            return Ok(Some(row));
        };
        // @ref LLP 3000.015#3 — a row-keyed count certifies its live basis on the internal ledger.
        if maintain.row_key.is_some() { return self.live_row_view(maintain, row); }
        if self.defer_receipt_maintain(maintain) && self.receipt_maintain_pending(maintain, Some(&crate::schema::maintained_key(&row, &maintain.by)))? { return Ok(Some(row)); }
        let source = self
            .schema
            .table(&maintain.source)
            .ok_or_else(|| RuntimeError::Schema("missing maintain source".into()))?;
        if !source.is_expiring() {
            return Ok(Some(row));
        }
        let bytes = super::write_target::row_copy_ceiling(source)
            .saturating_mul(32)
            .saturating_add(
                super::write_target::row_copy_ceiling(&self.schema.tables[table_name])
                    .saturating_mul(16),
            );
        self.maintain_scratch(bytes, |runner| runner.live_aggregate_inner(maintain, row))
    }

    /// A maintained point read reserved its recount scratch up front
    /// (`aggregate_point_scratch`); recompute without a second reservation.
    pub(super) fn live_aggregate_prepaid(&mut self, table_name: &str, row: Value) -> Result<Option<Value>, RuntimeError> {
        self.aggregate_source_dependency(table_name);
        let Some(maintain) = self.schema.maintain_for(table_name) else { return Ok(Some(row)); };
        if maintain.row_key.is_some() { return self.live_row_view(maintain, row); }
        if self.defer_receipt_maintain(maintain) && self.receipt_maintain_pending(maintain, Some(&crate::schema::maintained_key(&row, &maintain.by)))? { return Ok(Some(row)); }
        if !self.schema.tables[&maintain.source].is_expiring() { return Ok(Some(row)); }
        self.live_aggregate_inner(maintain, row)
    }

    // Shared selection only: witnesses and scalar recounts keep their distinct
    // authorization, coverage, lifetime and metering behavior around it.
    pub(super) fn live_contribution(&self, maintain: &Maintain, source: &crate::schema::Table, candidate: &Value, group: &[Value]) -> bool {
        !self.expired(source, candidate)
            && maintain.selected(candidate)
            && maintain.source_key(candidate) == group
    }

    pub(super) fn live_aggregate_inner(
        &mut self,
        maintain: &crate::schema::Maintain,
        row: Value,
    ) -> Result<Option<Value>, RuntimeError> {
        if self.defer_receipt_maintain(maintain) && self.receipt_maintain_pending(maintain, Some(&crate::schema::maintained_key(&row, &maintain.by)))? { return Ok(Some(row)); }
        debug_assert!(
            maintain.expiring_read_refusal(self.schema).is_none(),
            "authorize expiring aggregates from their keys before recounting"
        );
        self.read_tables.insert(maintain.source.clone());
        #[cfg(feature = "sqlite")]
        if !self.device && self.query_program && self.schema.tables[&maintain.source].is_expiring() {
            return self.backlog_aggregate(maintain, row);
        }
        let source = &self.schema.tables[&maintain.source];
        let group = crate::schema::maintained_key(&row, &maintain.by);
        let (index, prefix) = maintain.source_scan(source, &group);
        if self.device
            && source
                .sync
                .as_ref()
                .is_none_or(|sync| sync.horizon.is_some())
        {
            self.unknown_fact(&maintain.source, index, &prefix, "live aggregate");
        }
        let mut bounds = Bounds::default();
        let mut total = 0_i128;
        let mut any = false;
        'sources: loop {
            let limit = 32;
            // Already-authorized source candidates keep their ordinary meter; the token is the storage capability.
            let rows = self.metered_scan(|runner, allowance| runner.tx.scan(allowance, &maintain.source, index, &prefix, &bounds, Dir::Asc, limit))?;
            let count = rows.len();
            for (mut candidate, key) in rows {
                materialize_optional_fields(&mut candidate, source);
                if !self.read_charge(MeterKind::Examined, 1)? {
                    break 'sources;
                }
                bounds.after = crate::key::decode(&key)
                    .map(|values| values.into_iter().skip(prefix.len()).collect());
                if !self.read_charge(MeterKind::Steps, maintain.evaluation_steps())? {
                    break 'sources;
                }
                if !self.live_contribution(maintain, source, &candidate, &group)
                {
                    continue;
                }
                if self.device && source.through.is_some() && self.tx.retained_row(&maintain.source, &candidate)? { continue; }
                let prior = std::mem::replace(&mut self.beyond_horizon, false);
                let allowed = self.provisional_readable(&maintain.source, &candidate);
                let unknown = self.beyond_horizon;
                self.beyond_horizon |= prior;
                if !allowed? {
                    if unknown {
                        return Ok(None);
                    }
                    continue;
                }
                any = true;
                self.note_expiry(source, &candidate);
                total += match &maintain.kind {
                    crate::schema::MaintainKind::Count => 1,
                    crate::schema::MaintainKind::Sum { of } => {
                        i128::from(candidate.field(of)?.as_int()?)
                    }
                };
            }
            if count < limit {
                break;
            }
        }
        self.meter.require_uncapped()?;
        if !any {
            return Ok(None);
        }
        if !(crate::value::I53_MIN as i128..=crate::value::I53_MAX as i128).contains(&total) {
            return Err(super::maintains::aggregate_overflow(&maintain));
        }
        let mut fields = row.as_object()?.clone();
        fields.insert("value".into(), Value::Int(total as i64));
        Ok(Some(Value::Row(fields.into())))
    }
}
