//! One logical allowance for work whose shape can depend on unreadable rows.
use super::runner::Runner;
use crate::{error::{MeterKind, RuntimeError}, meter::{Ceilings, Cut}};

// Only this module mints the capability; it cannot be constructed or cloned
// by callers, and the borrowed token cannot escape the guarded closure.
pub struct Authorization { probes: std::cell::Cell<u64>, remaining_probes: u64 }

impl Authorization {
    fn internal() -> Self { Self { probes: std::cell::Cell::new(0), remaining_probes: u64::MAX } }
    // The candidate's declared probe allowance is checked before authorization
    // executes. The enclosing scope commits this logical count on every exit.
    pub(super) fn admit_probes(&self, probes: u64) -> bool {
        let total = self.probes.get().saturating_add(probes);
        self.probes.set(total);
        total <= self.remaining_probes
    }
    pub(crate) fn for_read(_: &super::authorized_point::RowAuthorization) -> Self { Self::internal() }

}

impl Runner<'_> {
    // @ref LLP 3000.015#1 — declaration-only scratch is admitted before any
    // candidate/witness access. The logical heap retains only disclosed output.
    pub(super) fn authorized_scratch<T: Default>(&mut self, bytes: u64, allowance: &[(MeterKind, u64)], work: impl FnOnce(&mut Self, &Authorization) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        if self.device_work_active { return work(self, &Authorization::internal()); }
        if self.context.is_system() { return self.authorized_scan(allowance, work); }
        let mark = self.meter.mark();
        self.meter.heap(bytes)?;
        let result = self.authorized_scan(allowance, work);
        // Failure of fixed admission retains its cut; internal work cannot cut.
        self.meter.release_row_heap(mark, bytes);
        result
    }

    pub(super) fn rule_scratch(&self, rule: &crate::schema::RuleExpr) -> u64 {
        let mut sites = Vec::new();
        super::rules::probe_sites(rule, &mut sites);
        sites.iter().map(|(table, _)| self.witness_scratch(table)).max().unwrap_or(0)
    }

    pub(super) fn witness_scratch(&self, table: &str) -> u64 {
        let own = crate::rows::disclosed::decode_reservation(&self.schema.tables[table]);
        let source = self.schema.maintain_for(table)
            .and_then(|m| self.schema.table(&m.source)).filter(|source| source.expire.is_some());
        own.saturating_add(source.map_or(0, crate::rows::disclosed::decode_reservation))
    }

    // @ref LLP 3000.015#1 — admission depends on declared bounds, never on
    // occupants. Private scratch cannot cut the caller's prepaid scan.
    pub(super) fn authorized_scan<T: Default>(&mut self, allowance: &[(MeterKind, u64)], scan: impl FnOnce(&mut Self, &Authorization) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        // This meter is the device's separate physical-work budget. Its
        // caller maps exhaustion to uncertainty, never a logical E_BOUND.
        if self.device_work_active { return scan(self, &Authorization::internal()); }
        for &(kind, amount) in allowance {
            if !self.read_charge(kind, amount)? { return Ok(T::default()); }
        }
        if self.read_capped() { return Ok(T::default()); }
        let mark = self.meter.mark();
        let scope = Authorization { probes: std::cell::Cell::new(0), remaining_probes: self.meter.ceilings.rule_probes.saturating_sub(self.meter.used.rule_probes) };
        let ceilings = std::mem::replace(&mut self.meter.ceilings, Ceilings::unbounded());
        let cut = std::mem::replace(&mut self.meter.cut, Cut::Abort);
        let result = scan(self, &scope);
        self.meter.restore(mark);
        self.meter.ceilings = ceilings;
        self.meter.cut = cut;
        if scope.probes.get() > 0 { self.read_charge(MeterKind::RuleProbes,scope.probes.get())?; }
        result
    }
}

#[cfg(all(test, feature = "sqlite"))]
mod tests {
    use super::*;
    use crate::{Context, Store, meter::Meter, schema::Schema};

    #[test]
    fn raw_write_fetches_reserve_before_even_an_absent_candidate() {
        use crate::{rows::MemoryRows, schema::{ColumnType, FieldAuthority, public_table}, Value};
        let rows = MemoryRows::new();
        let mut schema = Schema::default();
        let mut table = public_table([("id".into(),ColumnType::Id),("owner".into(),ColumnType::Principal),
            ("secret".into(),ColumnType::Text { max: 1000000 })].into(), Default::default());
        table.indexes.insert("byId".into(),crate::schema::Index::of(&["id"],true));
        table.written_by.insert("secret".into(),FieldAuthority { owner:"owner".into(),audience:false });
        schema.tables.insert("records".into(),table);
        for lookup in [false,true] {
            let mut runner = Runner::new(&rows,&schema,Context::new("alice",Default::default()),
                Meter::new(Ceilings {heap_bytes:32,..Default::default()},Cut::Abort),0);
            let result = if lookup {
                let index=&schema.tables["records"].indexes["byId"];
                runner.lookup_stored("records","byId",index,&[Value::Id("absent".into())],false)
            } else { runner.fetch("records","absent") };
            assert!(matches!(result,Err(RuntimeError::Bound {kind:MeterKind::HeapBytes,..})),"lookup={lookup}: {result:?}");
        }
    }

    #[test]
    fn scratch_keeps_only_the_fixed_peak_on_success_and_failure() {
        let rows = crate::rows::MemoryRows::new();
        let schema = Schema::default();
        for hidden in [0,1000000] {
            for refuses in [false,true] {
                let mut runner=Runner::new(&rows,&schema,Context::new("alice",Default::default()),Meter::new(Ceilings::default(),Cut::Abort),0);
                let result=runner.authorized_scratch(4096,&[(MeterKind::RuleProbes,2)],|runner,_| {
                    runner.meter.heap(hidden)?;
                    if refuses { Err(RuntimeError::Input("internal test error".into())) } else { Ok(()) }
                });
                assert_eq!(result.is_err(),refuses);
                assert_eq!(runner.meter.used.heap_bytes,0);
                assert_eq!(runner.meter.heap_peak,4096);
                assert_eq!(runner.meter.used.rule_probes,2);
            }
        }
    }

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

/// Standalone physical accounting has its own meter. Its token is borrowed
/// only for `run`, never constructible on a caller ledger or returned by it.
pub struct InternalLedger(crate::meter::Meter);
impl InternalLedger {
    pub fn new(meter: crate::meter::Meter) -> Self { Self(meter) }
    pub fn run<T>(&mut self, work: impl FnOnce(&mut crate::meter::Meter, &Authorization) -> T) -> T {
        work(&mut self.0, &Authorization::internal())
    }
    pub fn into_meter(self) -> crate::meter::Meter { self.0 }
}
