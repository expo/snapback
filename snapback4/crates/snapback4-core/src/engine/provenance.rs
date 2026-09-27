//! Only an authorized query image can acquire source identity.
// @ref LLP 3000.014#5 — shape-independent identity for retained fallback, charged before allocation.
use super::runner::Runner;
use crate::{error::RuntimeError, value::Value};
impl Runner<'_> {
    pub(super) fn stamp_source(
        &mut self,
        table: &str,
        row: &mut Value,
    ) -> Result<(), RuntimeError> {
        #[cfg(feature = "sqlite")]
        self.stamp_delivery(table, row);
        if !self.context.row_provenance { return Ok(()); }
        if let Value::Row(fields) | Value::Map(fields) = row {
            let Some(id) = fields.get("id").and_then(|id| id.as_str().ok()) else {
                return Ok(());
            };
            self.meter.step(1)?;
            self.meter
                .heap(96 + table.len() as u64 + 2 * id.len() as u64)?;
            self.meter.require_uncapped()?;
            let id = id.to_owned();
            #[cfg(feature = "sqlite")]
            if fields.source_identity().is_none() { fields.set_source(table, &id); }
            #[cfg(not(feature = "sqlite"))]
            fields.set_source(table, &id);
        }
        Ok(())
    }
}
