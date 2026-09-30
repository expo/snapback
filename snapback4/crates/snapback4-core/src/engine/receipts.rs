//! Generated receipts share the interpreter, meter and partition log.
// @ref LLP 3000.022#14 — receipt progress is owned; recipient removal retires runs atomically.
use super::runner::Runner;
use crate::{error::RuntimeError, ir::*, value::Value};

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
                ("deliveredOrdinal", &family.delivered),
                ("seenOrdinal", &family.seen),
            ] {
                if patch.as_object()?.contains_key(field)
                    && !(inserting && patch.field(field)? == &Value::Int(0))
                    && self.receipt_operation != *operation
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
        if table == "runs"
            && self
                .schema
                .receipts
                .iter()
                .any(|f| self.receipt_operation != f.delivered)
        {
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
            let runs = &self.schema.tables["runs"];
            let (index, _) = runs
                .indexes
                .iter()
                .find(|(_, i)| {
                    i.unique && i.columns() == [family.group.as_str(), "principal", "fromOrdinal"]
                })
                .ok_or_else(|| RuntimeError::Schema("receipt runs needs its unique key".into()))?;
            let scan = Scan {
                site: "receipts/remove".into(),
                table: "runs".into(),
                index: index.clone(),
                prefix: [
                    member.field(&family.group)?.clone(),
                    member.field("principal")?.clone(),
                ]
                .into_iter()
                .map(|v| IndexKeyExpr::Scalar(Expr::Literal(v)))
                .collect(),
                order: Order::Asc,
                take: Bound::Literal(64),
                existence: false,
                after: None,
                before: None,
                range: None,
                filter: None,
                opaque_cursor: false,
                merge_site: None,
                provenance: KeyProvenance::Const,
                variant: None,
                cursor_pins: 0,
            };
            for run in self.scan(&scan)? {
                // The member's delete rule was already authorized. The run's
                // read remains audience-authorized, and every delete is metered.
                self.delete_authorized("runs", run)?;
            }
        }
        Ok(())
    }
}
