//! One charge path for every fixed source-write reservation.
// @ref LLP 3000.022#14.3 — projection retains prices, never private formulas.
use super::runner::Runner;
use crate::{error::{MeterKind, RuntimeError}, schema::reservations::{self, Price}};
impl Runner<'_> {
    pub(super) fn source_price(&self, source: &str, phase: usize) -> Result<Price, RuntimeError> {
        let plan = self.schema.write_reservation(source);
        #[cfg(feature = "sqlite")]
        let plan = if self.device { plan } else { reservations::reservation(self.schema, source) };
        let plan = plan.filter(|p| phase != reservations::VIEW_READ || p.view_read.is_some());
        plan.map(|p| p.price(phase)).ok_or_else(|| RuntimeError::Prediction(
            format!("{source} has no complete source-write reservation; adopt the current backend")))
    }
    pub(super) fn charge_price(&mut self, price: Price) -> Result<(), RuntimeError> {
        // A failed scratch reservation must not report unallocated heap.
        if !self.meter.room(MeterKind::HeapBytes, price[4]) {
            return Err(RuntimeError::Bound { kind: MeterKind::HeapBytes,
                actual: self.meter.used.heap_bytes.saturating_add(price[4]),
                ceiling: self.meter.ceilings.heap_bytes, site: self.meter.site().into() });
        }
        for (kind, amount) in [MeterKind::Steps, MeterKind::IndexEntries, MeterKind::Examined,
            MeterKind::RowsWritten, MeterKind::HeapBytes, MeterKind::OutputBytes, MeterKind::RuleProbes]
            .into_iter().zip(price) { self.meter.charge(kind, amount)?; }
        Ok(())
    }
    #[cfg(feature = "sqlite")]
    pub(super) fn reserve_assets(&mut self, table: &crate::schema::Table) -> Result<u64, RuntimeError> {
        if !self.device && !self.tx.holds_assets() { return Ok(0); }
        let price = reservations::asset_price(table);
        self.charge_price(price)?;
        Ok(price[4])
    }
}
