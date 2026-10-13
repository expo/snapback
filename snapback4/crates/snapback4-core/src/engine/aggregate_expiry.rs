//! Physical aggregate totals minus the unswept expiry backlog.
use super::runner::Runner;
use crate::{error::{MeterKind, RuntimeError}, rows::{Bounds, Dir}, schema::{Maintain, materialize_optional_fields}, value::Value};

impl Runner<'_> {
    #[cfg(feature = "sqlite")]
    pub(super) fn backlog_aggregate(&mut self, maintain: &Maintain, row: Value) -> Result<Option<Value>, RuntimeError> {
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
                let rows = self.metered_scan(|runner, allowance| {
                    runner.tx.scan(allowance, &maintain.source, &index, &group, &bounds, Dir::Asc, 32)
                })?;
                let count = rows.len();
                for (mut candidate, key) in rows {
                    // @ref LLP 3000.007#20.24.6 — the backlog is expired rows: store work on the expiry guard, never the public meter.
                    materialize_optional_fields(&mut candidate, source);
                    self.step_inactive(&maintain.source, &candidate, &key)?;
                    bounds.after = crate::key::decode(&key).map(|values| values.into_iter().skip(group.len()).collect());
                    total -= super::maintains::delta(maintain, &candidate, 1)?;
                }
                if count < 32 { break; }
            }
        }
        // A zero signed sum is a candidate while any live contribution remains.
        // This seek also supplies the next clock invalidation without walking live rows.
        if !self.read_charge(MeterKind::Examined, 1)? { self.meter.require_uncapped()?; }
        let bounds = Bounds { gt: self.context.now.map(|_| Value::Int(now)), ..Bounds::default() };
        let next = self.metered_scan(|runner, allowance| {
            runner.tx.scan(allowance, &maintain.source, &index, &group, &bounds, Dir::Asc, 1)
        })?;
        let Some((mut candidate, _)) = next.into_iter().next() else { return Ok(None);
        };
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
