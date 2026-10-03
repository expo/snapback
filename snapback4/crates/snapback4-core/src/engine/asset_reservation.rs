//! Public declared-slot prices; no asset ledger or cell value is inspected.
// @ref LLP 3000.022#14.3 — device source writes retain the server's fixed media charge.
use super::runner::Runner;
use crate::{error::{MeterKind, RuntimeError}, schema::{ColumnType, Table}};

fn slots(kind: &ColumnType, in_list: bool) -> u64 {
    match kind {
        ColumnType::Optional(inner) => slots(inner, in_list),
        ColumnType::List { of, max } => slots(of, true).saturating_mul(u64::from(*max)),
        ColumnType::Image { .. } | ColumnType::Video { .. } if in_list => 1,
        _ => 0,
    }
}

impl Runner<'_> {
    /// Reserve each declared list slot, even for empty/null/unchanged cells.
    /// Scalar accounting stays unchanged; no hidden list length selects a charge.
    pub(super) fn reserve_assets(&mut self, table: &Table) -> Result<u64, RuntimeError> {
        if !self.device && !self.tx.holds_assets() { return Ok(0); }
        let count = table.columns.values().map(|kind| slots(kind, false)).fold(0_u64, u64::saturating_add);
        // Fact lookup, system-placeholder lookup, claim lookup and GC lookup;
        // release plus claim writes. Facts, two identity maps and list copies
        // fit the existing 16 KiB asset decode allowance per slot.
        let heap = count.saturating_mul(16_384);
        // Scratch admission must not leave an unallocated, over-ceiling heap
        // charge in a refused target's receipt (LLP 3000.015 §1).
        if !self.meter.room(MeterKind::HeapBytes, heap) {
            return Err(RuntimeError::Bound { kind: MeterKind::HeapBytes,
                actual: self.meter.used.heap_bytes.saturating_add(heap),
                ceiling: self.meter.ceilings.heap_bytes, site: self.meter.site().into() });
        }
        for (kind, amount) in [(MeterKind::Steps, count.saturating_mul(8)),
            (MeterKind::Examined, count.saturating_mul(4)),
            (MeterKind::RowsWritten, count.saturating_mul(2)),
            (MeterKind::HeapBytes, heap)] { self.meter.charge(kind, amount)?; }
        Ok(heap)
    }

}
