//! Live aggregate evaluation and the fixed allowance for pre-authorization work.
use super::{runner::Runner, write_target::row_copy_ceiling};
use crate::{
    error::{MeterKind, RuntimeError},
    rows::{Bounds, Dir},
    schema::{Maintain, materialize_optional_fields},
    value::Value,
};

impl Runner<'_> {
    // @ref LLP 3000.014#11-review-record — a denied empty or occupied group pays one bounded recount before either can be discovered.
    pub(super) fn reserve_aggregate_read(
        &mut self,
        maintain: &Maintain,
        key: &[Value],
    ) -> Result<u32, RuntimeError> {
        let bound = maintain
            .recount_bound(self.schema)
            .ok_or_else(|| RuntimeError::Schema(maintain.read_bound_refusal()))?;
        let source = &self.schema.tables[&maintain.source];
        if source.is_expiring() && !source.indexes.contains_key(&maintain.contribution_index()) {
            return Err(RuntimeError::Schema(
                "bounded aggregate recount needs its contribution index".into(),
            ));
        }
        let target = &self.schema.tables[&maintain.target];
        let bytes = row_copy_ceiling(target)
            .saturating_mul(17)
            .saturating_add(
                key.iter()
                    .map(Value::clone_heap_bytes)
                    .fold(0_u64, u64::saturating_add)
                    .saturating_mul(8),
            )
            .saturating_add(if source.is_expiring() {
                row_copy_ceiling(source).saturating_mul(32)
            } else {
                0
            });
        for (kind, amount) in [
            (MeterKind::HeapBytes, bytes),
            (MeterKind::Examined, u64::from(bound) + 1),
            (
                MeterKind::Steps,
                u64::from(bound).saturating_mul(maintain.evaluation_steps() + 1),
            ),
        ] {
            self.read_charge(kind, amount)?;
            self.meter.require_uncapped()?;
        }
        Ok(bound)
    }

    pub(super) fn prepaid_aggregate(
        &mut self,
        maintain: &Maintain,
        row: Value,
        bound: u32,
    ) -> Result<Option<Value>, RuntimeError> {
        if !self.schema.tables[&maintain.source].is_expiring() {
            return Ok(Some(row));
        }
        self.live_aggregate_inner(maintain, row, Some(bound))
    }

    /// A maintain over expiring source rows is a live fact before the
    /// physical sweep catches up. Recompute only that fact's group, with
    /// the usual runtime meter and device coverage rules.
    pub(crate) fn live_aggregate(
        &mut self,
        table_name: &str,
        row: Value,
    ) -> Result<Option<Value>, RuntimeError> {
        let Some(maintain) = self.schema.maintain_for(table_name).cloned() else {
            return Ok(Some(row));
        };
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
        self.maintain_scratch(bytes, |runner| {
            runner.live_aggregate_inner(&maintain, row, None)
        })
    }

    fn live_aggregate_inner(
        &mut self,
        maintain: &crate::schema::Maintain,
        row: Value,
        prepaid: Option<u32>,
    ) -> Result<Option<Value>, RuntimeError> {
        let source = &self.schema.tables[&maintain.source];
        self.read_tables.insert(maintain.source.clone());
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
        let mut remaining = prepaid.map(u64::from);
        'sources: loop {
            let limit = remaining.map_or(32, |left| (left + 1).min(32) as usize);
            let rows = self
                .tx
                .scan(&maintain.source, index, &prefix, &bounds, Dir::Asc, limit)?;
            let count = rows.len();
            if let Some(left) = &mut remaining {
                *left = left.checked_sub(count as u64).ok_or_else(|| {
                    RuntimeError::Schema("aggregate source exceeds its physical cap".into())
                })?;
            }
            for (mut candidate, key) in rows {
                materialize_optional_fields(&mut candidate, source);
                if prepaid.is_none() && !self.read_charge(MeterKind::Examined, 1)? {
                    break 'sources;
                }
                bounds.after = crate::key::decode(&key)
                    .map(|values| values.into_iter().skip(prefix.len()).collect());
                if prepaid.is_none()
                    && !self.read_charge(MeterKind::Steps, maintain.evaluation_steps())?
                {
                    break 'sources;
                }
                if self.expired(source, &candidate)
                    || !maintain.selected(&candidate)
                    || maintain.source_key(&candidate) != group
                {
                    continue;
                }
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
