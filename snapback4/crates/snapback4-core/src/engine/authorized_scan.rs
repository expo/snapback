//! One logical allowance for work whose shape can depend on unreadable rows.
use super::runner::Runner;
use std::cell::Cell;

// @ref LLP 3000.015#2 — one physical allowance per request, nested work included.
pub(super) const AUTHORIZATION_WALK_LIMIT: usize = 8192;
use crate::{error::{MeterKind, RuntimeError}, meter::{Ceilings, Cut, Meter}, rows::{Rows, Bounds, Dir, AcquiredBoundary, PrefetchRequest}, schema::{Table, Index}, value::Value, assets::Asset};

// Only this module mints the capability; it cannot be constructed or cloned
// by callers, and the borrowed token cannot escape the guarded closure.
pub(crate) struct Authorization { _private: () }

// No Rows implementation, Deref or raw accessor: row reads require the
// unforgeable token even when a caller has access to Runner's store facade.
pub(crate) struct GuardedRows<'a> { raw: &'a dyn Rows, remaining: Cell<usize>, authorizing: Cell<bool>, revision: Cell<u64> }
impl<'a> GuardedRows<'a> {
    pub(crate) fn new(raw: &'a dyn Rows) -> Self { Self { raw, remaining: Cell::new(AUTHORIZATION_WALK_LIMIT), authorizing: Cell::new(false), revision: Cell::new(0) } }
    pub(super) fn revision(&self) -> u64 { self.revision.get() }
    pub(super) fn remaining(&self) -> usize { self.remaining.get() }
    fn limit(&self, requested: usize) -> Result<usize, RuntimeError> {
        if !self.authorizing.get() { return Ok(requested); }
        if self.remaining.get() == 0 { return Err(RuntimeError::AuthorizationBudget); }
        Ok(requested.min(self.remaining.get()))
    }
    fn charge(&self, fetched: usize) {
        if self.authorizing.get() { self.remaining.set(self.remaining.get().saturating_sub(fetched)); }
    }
    pub(crate) fn get(&self, _authorization: &Authorization, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        self.limit(1)?;
        let row = self.raw.get(table, id)?;
        self.charge(usize::from(row.is_some()));
        Ok(row)
    }
    pub(crate) fn lookup(&self, _authorization: &Authorization, table: &str, name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> {
        self.limit(1)?;
        let row = self.raw.lookup(table, name, index, key)?;
        self.charge(usize::from(row.is_some()));
        Ok(row)
    }
    pub(crate) fn scan(&self, _authorization: &Authorization, table: &str, name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        let permitted = self.limit(limit)?;
        let rows = self.raw.scan(table, name, prefix, bounds, dir, permitted)?;
        self.charge(rows.len());
        if permitted < limit && rows.len() == permitted { return Err(RuntimeError::AuthorizationBudget); }
        Ok(rows)
    }
    pub(crate) fn scan_metered(&self, _authorization: &Authorization, table: &str, name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize, meter: &mut Meter) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        let permitted = self.limit(limit)?;
        let rows = self.raw.scan_metered(table, name, prefix, bounds, dir, permitted, meter)?;
        self.charge(rows.len());
        if permitted < limit && rows.len() == permitted { return Err(RuntimeError::AuthorizationBudget); }
        Ok(rows)
    }
    pub(crate) fn count_prefix(&self, _authorization: &Authorization, table: &str, name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> {
        // This scalar adapter is used only by non-expiring, non-private
        // caps. It fetches no candidate rows and keeps its declared cap bound.
        self.raw.count_prefix(table, name, prefix, limit)
    }

    pub(crate) fn cap_count(&self, _authorization: &Authorization, table: &str, by: &[String], group: &[Value]) -> Result<u64, RuntimeError> { self.raw.cap_count(table, by, group) }

    pub(crate) fn sequence_value(&self, _authorization: &Authorization, parent: &str, id: &str) -> Result<i64, RuntimeError> { self.raw.sequence_value(parent, id) }
    pub(crate) fn provisional_sequence_floor(&self, _authorization: &Authorization, parent: &str, id: &str) -> Result<i64, RuntimeError> { self.raw.provisional_sequence_floor(parent, id) }
    pub(crate) fn set_sequence(&self, parent: &str, id: &str, value: i64) -> Result<(), RuntimeError> { self.raw.set_sequence(parent, id, value) }
    pub(crate) fn put(&self, name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> { self.revision.set(self.revision.get().wrapping_add(1)); self.raw.put(name, table, row, old) }
    pub(crate) fn delete(&self, name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> { self.revision.set(self.revision.get().wrapping_add(1)); self.raw.delete(name, table, old) }
    pub(crate) fn holds_assets(&self) -> bool { self.raw.holds_assets() }
    pub(crate) fn asset(&self, id: &str) -> Result<Option<Asset>, RuntimeError> { self.raw.asset(id) }
    pub(crate) fn claim_asset(&self, id: &str, by: &str, table: &str, row: &str, column: &str) -> Result<Asset, RuntimeError> { self.raw.claim_asset(id, by, table, row, column) }
    pub(crate) fn release_asset(&self, id: &str, now: i64) -> Result<(), RuntimeError> { self.raw.release_asset(id, now) }
    pub(crate) fn effect_once(&self, effect: &str, key: &str) -> Result<bool, RuntimeError> { self.raw.effect_once(effect, key) }
    pub(crate) fn provisional_row(&self, table: &str, row: &Value) -> Result<bool, RuntimeError> { self.raw.provisional_row(table, row) }
    pub(crate) fn retained_row(&self, table: &str, row: &Value) -> Result<bool, RuntimeError> { self.raw.retained_row(table, row) }
    pub(crate) fn retained_group(&self, table: &str, index: &str, prefix: &[Value]) -> Result<bool, RuntimeError> { self.raw.retained_group(table, index, prefix) }
    pub(crate) fn recording_covered(&self, table: &str, row: &Value, viewer: &str, now: i64, meter: &mut Meter) -> Result<bool, RuntimeError> { self.raw.recording_covered(table, row, viewer, now, meter) }
    pub(crate) fn acquired_boundary(&self, table: &str, index: &str, prefix: &[Value]) -> Result<Option<AcquiredBoundary>, RuntimeError> { self.raw.acquired_boundary(table, index, prefix) }
    pub(crate) fn prefetch_enabled(&self) -> bool { self.raw.prefetch_enabled() }
    #[allow(dead_code)] // Used by the native prefetch planner; absent on web.
    pub(crate) fn prefetch(&self, requests: &[PrefetchRequest]) { self.raw.prefetch(requests) }
}

impl Runner<'_> {
    /// Ordinary data reads keep their existing meter and cut semantics. This
    /// scope grants storage access without disabling or restoring any charge.
    /// Hidden authorization must use authorized_scan's prepaid reservation.
    pub(crate) fn metered_scan<T>(&mut self, scan: impl FnOnce(&mut Self, &Authorization) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        scan(self, &Authorization { _private: () })
    }

    // @ref LLP 3000.015#2 — admission depends on declared bounds, never on
    // occupants. Private scratch cannot cut the caller's prepaid scan.
    pub(crate) fn authorized_scan<T: Default>(&mut self, allowance: &[(MeterKind, u64)], scan: impl FnOnce(&mut Self, &Authorization) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        self.prepaid_scan(allowance, true, scan)
    }

    /// Public or already-authorized data reads still reserve their logical
    /// meter; they do no authorization traversal. A nested scope cannot opt
    /// out of its enclosing authorization's physical allowance.
    pub(super) fn prepaid_scan<T: Default>(&mut self, allowance: &[(MeterKind, u64)], physical: bool, scan: impl FnOnce(&mut Self, &Authorization) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        // This meter is the device's separate physical-work budget. Its
        // caller maps exhaustion to uncertainty, never a logical E_BOUND.
        if self.device_work_active {
            let active = self.tx.authorizing.replace(self.tx.authorizing.get() || (physical && !self.context.is_system()));
            let result = scan(self, &Authorization { _private: () });
            self.tx.authorizing.set(active);
            return result;
        }
        for &(kind, amount) in allowance {
            if !self.read_charge(kind, amount)? { return Ok(T::default()); }
        }
        if self.read_capped() { return Ok(T::default()); }
        let mark = self.meter.mark();
        let ceilings = std::mem::replace(&mut self.meter.ceilings, Ceilings::unbounded());
        let cut = std::mem::replace(&mut self.meter.cut, Cut::Abort);
        let active = self.tx.authorizing.replace(self.tx.authorizing.get() || (physical && !self.context.is_system()));
        let result = scan(self, &Authorization { _private: () });
        self.tx.authorizing.set(active);
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
                    let result = runner.authorized_scan(&[(MeterKind::Examined, 2), (MeterKind::RuleProbes, 2)], |runner, _| {
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
                    let result = runner.authorized_scan(&[(MeterKind::Examined, 1)], |_, _| -> Result<(), RuntimeError> { panic!("admission must precede all occupant access") });
                    if cut == Cut::Abort { assert!(matches!(result, Err(RuntimeError::Bound { kind: MeterKind::Examined, actual: 3, ceiling: 2, .. }))); }
                    else { assert!(result.is_ok()); assert!(runner.meter.capped_at.is_some()); }
                }
            }
        }
    }
}
