//! A row-read verdict and field projection together authorize result pricing.
use super::runner::Runner;
use crate::{error::{MeterKind, RuntimeError}, ir::Read, meter::Meter,
    schema::{Effect, Index}, value::{Disclosed, Value}};

// Neither a projected raw row nor a fabricated system context constructs this.
// The only constructor is below, after the row's read verdict succeeds.
pub(super) struct AuthorizedRow<'a>(Disclosed<'a>);
impl AuthorizedRow<'_> {
    pub(super) fn charge(self, meter: &mut Meter) -> Result<Value, RuntimeError> {
        meter.heap(self.0.heap_bytes() + self.0.projection_heap() + self.0.materialization_heap())?;
        Ok(self.0.into_value())
    }
}

impl<'r> Runner<'r> {
    // @ref LLP 3000.015#1 — row and field authorization precede result pricing.
    pub(super) fn authorized_point(&mut self, read: &Read, index: &Index, key: &[Value], prepaid: bool, trusted: bool) -> Result<Option<AuthorizedRow<'r>>, RuntimeError> {
        let table = &self.schema.tables[&read.table];
        let bytes = crate::rows::disclosed::decode_reservation(table).saturating_add(self.rule_scratch(&table.rules.read));
        let expiry_mark = self.next_expiry;
        let authorized = self.authorized_scratch(bytes, &[(MeterKind::Examined, 1)], |runner, _| {
            let Some(row) = runner.live_lookup(&read.table, &read.index, index, key)? else {
                if runner.device && table.sync.as_ref().is_some_and(|s| s.horizon.is_some()) { runner.unknown_fact(&read.table, &read.index, key, &read.site); }
                return Ok(None);
            };
            if runner.expired(table, &row) { return Ok(None); }
            let provisional = runner.is_provisional(&read.table, &row)?;
            let allowed = if provisional && !runner.context.is_system() {
                runner.authorize_read(&read.table, &row, prepaid)?
            } else { trusted || runner.check_rule(&read.table, Effect::Read, None, &row)? };
            if !allowed { runner.next_expiry = expiry_mark; return Ok(None); }
            // @ref LLP 3000.001#proposed-composition-of-retained-and-authoritative-reads — a delivered left point hit marks only its component, never whole-query coverage or a miss.
            if runner.device && runner.retained_row(&read.table, &row)? { runner.components.note(|frame| frame.retained = true); }
            runner.note_expiry(table, &row);
            let projected = runner.disclosed_row(table, row).for_query();
            runner.meter.heap(projected.projection_heap() + projected.materialization_heap())?;
            let visible = projected.into_value(); // drop hidden storage before leaving the internal scope
            Ok(Some(AuthorizedRow(runner.disclosed_row(table, visible).for_query())))
        })?;
        // The live aggregate is an authorized result computation. It must keep
        // its ordinary work budget and cannot publish a partial scalar value.
        let Some(authorized) = authorized else { return Ok(None); };
        let row = self.live_aggregate(&read.table, authorized.0.into_value())?.unwrap_or(Value::Null);
        Ok(Some(AuthorizedRow(self.disclosed_row(table, row).for_query())))
    }
}
