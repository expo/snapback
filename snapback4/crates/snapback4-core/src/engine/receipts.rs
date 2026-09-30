//! Generated receipts share the interpreter, meter and partition log.
// @ref LLP 3000.022#14 — receipt progress is owned; recipient removal retires runs atomically.
use super::runner::Runner;
use crate::{
    error::RuntimeError,
    rows::{Bounds, Dir},
    value::Value,
};

fn owned() -> RuntimeError {
    RuntimeError::Structural { code: "E_RECEIPTS_OWNED", message: "receipt progress is engine-owned; call delivered or seen for the signed-in recipient (guide receipts)".into() }
}
impl Runner<'_> {
    pub(super) fn refuse_receipt_fields(
        &self,
        table: &str,
        patch: &Value,
        inserting: bool,
    ) -> Result<(), RuntimeError> {
        if self.context.is_system() {
            return Ok(());
        }
        for family in &self.schema.receipts {
            if family.members != table {
                continue;
            }
            for (field, operation) in [
                (family.delivered_field.as_str(), &family.delivered),
                (family.seen_field.as_str(), &family.seen),
            ] {
                if patch.as_object()?.contains_key(field)
                    && !(inserting && patch.field(field)? == &Value::Int(0))
                    && self.receipt_operation != *operation
                    && !(field == family.delivered_field
                        && self.receipt_operation == family.compact)
                {
                    return Err(owned());
                }
            }
        }
        Ok(())
    }
    pub(super) fn refuse_receipt_table(&self, table: &str) -> Result<(), RuntimeError> {
        if self.context.is_system() {
            return Ok(());
        }
        if self.schema.receipts.iter().any(|f| {
            table == f.runs
                && self.receipt_operation != f.delivered
                && self.receipt_operation != f.compact
        }) {
            return Err(owned());
        }
        Ok(())
    }
    pub(super) fn receipt_member_removed(
        &mut self,
        table: &str,
        member: &Value,
    ) -> Result<(), RuntimeError> {
        for family in &self.schema.receipts {
            if table != family.members {
                continue;
            }
            let runs = &self.schema.tables[&family.runs];
            let (index, _) = runs
                .indexes
                .iter()
                .find(|(_, i)| {
                    i.unique
                        && i.columns() == [family.run_group.as_str(), "principal", "fromOrdinal"]
                })
                .ok_or_else(|| RuntimeError::Schema("receipt runs needs its unique key".into()))?;
            let prefix = [
                member.field(&family.group)?.clone(),
                member.field(&family.principal)?.clone(),
            ];
            if self.device && !self.tx.current_group(&family.runs, index, &prefix)? {
                self.unknown_fact(
                    &family.runs,
                    index,
                    &prefix,
                    "receipt removal needs complete run coverage",
                );
            }
            // This is storage retirement, not disclosure. The member delete
            // authorized exactly these rows; never install a broader viewer.
            self.meter
                .heap(crate::rows::word_heap::slots::<(Value, Vec<u8>)>(64))?;
            let rows = self.metered_scan(|runner, scope| {
                runner.tx.scan_metered(
                    scope,
                    &family.runs,
                    index,
                    &prefix,
                    &Bounds::default(),
                    Dir::Asc,
                    64,
                    &mut runner.meter,
                )
            })?;
            for (run, _) in rows {
                self.meter.step(1)?;
                self.meter.charge(crate::error::MeterKind::Examined, 1)?;
                self.meter
                    .charge(crate::error::MeterKind::IndexEntries, 1)?;
                self.delete_authorized(&family.runs, run)?;
            }
        }
        Ok(())
    }
}
