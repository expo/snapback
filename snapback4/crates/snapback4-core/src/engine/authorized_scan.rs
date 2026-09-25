//! One logical allowance for work whose shape can depend on unreadable rows.
use super::runner::Runner;
use crate::{error::{MeterKind, RuntimeError}, meter::{Ceilings, Cut}};

impl Runner<'_> {
    // @ref LLP 3000.015#2 — admission depends on declared bounds, never on
    // occupants. Private scratch cannot cut the caller's prepaid scan.
    pub(super) fn authorized_scan<T: Default>(&mut self, allowance: &[(MeterKind, u64)], scan: impl FnOnce(&mut Self) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        // This meter is the device's separate physical-work budget. Its
        // caller maps exhaustion to uncertainty, never a logical E_BOUND.
        if self.device_work_active { return scan(self); }
        for &(kind, amount) in allowance {
            if !self.read_charge(kind, amount)? { return Ok(T::default()); }
        }
        if self.read_capped() { return Ok(T::default()); }
        let mark = self.meter.mark();
        let ceilings = std::mem::replace(&mut self.meter.ceilings, Ceilings::unbounded());
        let cut = std::mem::replace(&mut self.meter.cut, Cut::Abort);
        let result = scan(self);
        self.meter.restore(mark);
        self.meter.ceilings = ceilings;
        self.meter.cut = cut;
        result
    }
}

#[cfg(all(test, feature = "sqlite"))]
mod tests {
    use super::*;
    use crate::{Context, Store, meter::Meter, schema::Schema};

    #[test]
    fn allowance_alone_decides_admission_and_every_exit_keeps_it() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        let schema = Schema::default();
        for cut in [Cut::Cap, Cut::Abort] {
            for hidden_work in [0, 1, 8193] {
                for refuses in [false, true] {
                    let mut runner = Runner::new(&tx, &schema, Context::new("alice", Default::default()), Meter::new(Ceilings { examined: 2, rule_probes: 2, heap_bytes: 8, ..Default::default() }, cut), 0);
                    let result = runner.authorized_scan(&[(MeterKind::Examined, 2), (MeterKind::RuleProbes, 2)], |runner| {
                        runner.meter.charge(MeterKind::Examined, hidden_work)?;
                        runner.meter.charge(MeterKind::RuleProbes, hidden_work)?;
                        runner.meter.heap(hidden_work * 1024)?;
                        if refuses { Err(RuntimeError::Rule { table: "private".into(), effect: crate::schema::Effect::Insert }) }
                        else { Ok(()) }
                    });
                    assert_eq!(result.is_err(), refuses);
                    assert_eq!(runner.meter.used.examined, 2);
                    assert_eq!(runner.meter.used.rule_probes, 2);
                    assert_eq!(runner.meter.used.heap_bytes, 0);
                    assert_eq!(runner.meter.heap_peak, 0);
                    assert!(runner.meter.capped_at.is_none());
                    assert_eq!(runner.meter.ceilings.examined, 2);
                    assert_eq!(runner.meter.cut, cut);
                    let result = runner.authorized_scan(&[(MeterKind::Examined, 1)], |_| -> Result<(), RuntimeError> { panic!("admission must precede all occupant access") });
                    if cut == Cut::Abort { assert!(matches!(result, Err(RuntimeError::Bound { kind: MeterKind::Examined, actual: 3, ceiling: 2, .. }))); }
                    else { assert!(result.is_ok()); assert!(runner.meter.capped_at.is_some()); }
                }
            }
        }
    }
}
