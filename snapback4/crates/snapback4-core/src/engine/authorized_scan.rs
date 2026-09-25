//! One logical allowance for work whose shape can depend on unreadable rows.
use super::runner::Runner;
use crate::{error::{MeterKind, RuntimeError}, meter::{Ceilings, Cut}};

// Only this module mints the capability; it cannot be constructed or cloned
// by callers, and the borrowed token cannot escape the guarded closure.
pub(crate) struct Authorization { _private: () }

impl Runner<'_> {
    // @ref LLP 3000.015#1 — declaration-only scratch is admitted before any
    // candidate/witness access. The logical heap retains only disclosed output.
    pub(super) fn authorized_scratch<T: Default>(&mut self, bytes: u64, allowance: &[(MeterKind, u64)], work: impl FnOnce(&mut Self, &Authorization) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        if self.device_work_active { return work(self, &Authorization { _private: () }); }
        if self.context.is_system() { return self.authorized_scan(allowance, work); }
        let mark = self.meter.mark();
        self.meter.heap(bytes)?;
        let result = self.authorized_scan(allowance, work);
        // Failure of fixed admission retains its cut; internal work cannot cut.
        self.meter.release_row_heap(mark, bytes);
        result
    }

    // @ref LLP 3000.015#1 — admission depends on declared bounds, never on
    // occupants. Private scratch cannot cut the caller's prepaid scan.
    pub(super) fn authorized_scan<T: Default>(&mut self, allowance: &[(MeterKind, u64)], scan: impl FnOnce(&mut Self, &Authorization) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        // This meter is the device's separate physical-work budget. Its
        // caller maps exhaustion to uncertainty, never a logical E_BOUND.
        if self.device_work_active { return scan(self, &Authorization { _private: () }); }
        for &(kind, amount) in allowance {
            if !self.read_charge(kind, amount)? { return Ok(T::default()); }
        }
        if self.read_capped() { return Ok(T::default()); }
        let mark = self.meter.mark();
        let ceilings = std::mem::replace(&mut self.meter.ceilings, Ceilings::unbounded());
        let cut = std::mem::replace(&mut self.meter.cut, Cut::Abort);
        let result = scan(self, &Authorization { _private: () });
        self.meter.restore(mark);
        self.meter.ceilings = ceilings;
        self.meter.cut = cut;
        result
    }
}


#[cfg(all(test,feature="sqlite"))]
mod tests {
    use super::*;
    use crate::{Context, rows::MemoryRows, Schema, meter::Meter};
    #[test]
    fn internal_work_cannot_change_reserved_receipt_or_cut() {
        let rows=MemoryRows::new(); let schema=Schema::default();
        for hidden in [0,1,17<<20] {
            for error in [false,true] {
                let mut r=Runner::new(&rows,&schema,Context::new("alice",Default::default()),Meter::new(Ceilings::default(),Cut::Cap),0);
                let out=r.authorized_scratch(8192,&[(MeterKind::Examined,1),(MeterKind::Steps,1)],|r,_| {
                    r.meter.heap(hidden)?; r.meter.charge(MeterKind::Examined,hidden)?;
                    if error {Err(RuntimeError::Input("internal test error".into()))} else {Ok(())}
                });
                assert_eq!(out.is_err(),error);
                assert_eq!(r.meter.used.examined,1); assert_eq!(r.meter.used.steps,1);
                assert_eq!(r.meter.used.heap_bytes,0); assert_eq!(r.meter.heap_peak,8192);
                assert!(r.meter.capped_at.is_none()); assert_eq!(r.meter.ceilings,Ceilings::default());
            }
        }
    }
}
