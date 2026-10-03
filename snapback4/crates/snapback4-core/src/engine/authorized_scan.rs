//! One logical allowance for work whose shape can depend on unreadable rows.
use super::runner::Runner;
use std::cell::{Cell, RefCell};

// @ref LLP 3000.015#2 — one physical allowance per request, nested work included.
pub(super) const AUTHORIZATION_WALK_LIMIT: usize = 8192;
use crate::{error::{MeterKind, RuntimeError}, meter::{Ceilings, Cut, Meter}, rows::{Rows, Bounds, Dir, AcquiredBoundary, PrefetchRequest}, schema::{Table, Index}, value::Value, assets::Asset};

// Only this module mints the capability; it cannot be constructed or cloned
// by callers, and the borrowed token cannot escape the guarded closure.
pub struct Authorization { probes: Cell<u64>, remaining_probes: u64 }

impl Authorization {
    fn internal() -> Self { Self { probes: std::cell::Cell::new(0), remaining_probes: u64::MAX } }
    // The candidate's declared probe allowance is checked before authorization
    // executes. The enclosing scope commits this logical count on every exit.
    pub(super) fn admit_probes(&self, probes: u64) -> bool {
        let total = self.probes.get().saturating_add(probes);
        self.probes.set(total);
        total <= self.remaining_probes
    }

}


// No Rows implementation, Deref or raw accessor: row reads require the
// unforgeable token even when a caller has access to Runner's store facade.
pub(crate) struct GuardedRows<'a> { raw: &'a dyn Rows, remaining: Cell<usize>, authorizing: Cell<bool>, revision: Cell<u64>, lookup_cache: RefCell<Option<(String, String, Vec<Value>, Option<Value>)>> }
impl<'a> GuardedRows<'a> {
    pub(crate) fn new(raw: &'a dyn Rows) -> Self { Self { raw, remaining: Cell::new(AUTHORIZATION_WALK_LIMIT), authorizing: Cell::new(false), revision: Cell::new(0), lookup_cache: RefCell::new(None) } }
    pub(super) fn revision(&self) -> u64 { self.revision.get() }
    pub(super) fn remaining(&self) -> usize { self.remaining.get() }
    fn limit(&self, table: &str, requested: usize) -> Result<usize, RuntimeError> {
        if !self.authorizing.get() { return Ok(requested); }
        if self.remaining.get() == 0 { return Err(RuntimeError::AuthorizationBudget { table: table.into(), effect: crate::schema::Effect::Read }); }
        Ok(requested.min(self.remaining.get()))
    }
    fn charge(&self, fetched: usize) {
        if self.authorizing.get() { self.remaining.set(self.remaining.get().saturating_sub(fetched)); }
    }
    pub(crate) fn get(&self, _authorization: &Authorization, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        self.limit(table, 1)?;
        let row = self.raw.get(table, id)?;
        self.charge(usize::from(row.is_some()));
        Ok(row)
    }
    /// A key-only witness still consumes the shared physical authorization allowance.
    pub(crate) fn index_head(&self, _authorization: &Authorization, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir) -> Result<Option<Vec<Value>>, RuntimeError> {
        self.limit(table, 1)?;
        let key = self.raw.index_head(table, index, prefix, bounds, dir)?;
        self.charge(usize::from(key.is_some()));
        Ok(key)
    }
    pub(crate) fn lookup(&self, _authorization: &Authorization, table: &str, name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> {
        // @ref LLP 3000.015#2 — repeated unchanged points share decoded storage,
        // while every logical read still prepays its complete rule.
        if let Some((cached_table, cached_index, cached_key, row)) = &*self.lookup_cache.borrow()
            && cached_table == table && cached_index == name && cached_key == key { return Ok(row.clone()); }
        self.limit(table, 1)?;
        let row = self.raw.lookup(table, name, index, key)?;
        self.charge(usize::from(row.is_some()));
        *self.lookup_cache.borrow_mut() = Some((table.into(), name.into(), key.to_vec(), row.clone()));
        Ok(row)
    }
    pub(crate) fn scan(&self, _authorization: &Authorization, table: &str, name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        let permitted = self.limit(table, limit)?;
        let rows = self.raw.scan(table, name, prefix, bounds, dir, permitted)?;
        self.charge(rows.len());
        if permitted < limit && rows.len() == permitted { return Err(RuntimeError::AuthorizationBudget { table: table.into(), effect: crate::schema::Effect::Read }); }
        Ok(rows)
    }
    #[cfg(feature = "server-search")]
    pub(crate) fn scan_selected(&self, _authorization: &Authorization, table: &str, name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, fields: &[String]) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        self.limit(table, 1)?;
        let rows = self.raw.scan_selected(table, name, prefix, bounds, dir, fields)?;
        self.charge(rows.len());
        Ok(rows)
    }
    pub(crate) fn scan_metered(&self, _authorization: &Authorization, table: &str, name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize, meter: &mut Meter) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        let permitted = self.limit(table, limit)?;
        let rows = InternalLedger::with_meter(meter, |meter, _| self.raw.scan_metered(table, name, prefix, bounds, dir, permitted, _authorization, meter))?;
        self.charge(rows.len());
        if permitted < limit && rows.len() == permitted { return Err(RuntimeError::AuthorizationBudget { table: table.into(), effect: crate::schema::Effect::Read }); }
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
    pub(crate) fn put(&self, name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> { self.revision.set(self.revision.get().wrapping_add(1)); self.lookup_cache.borrow_mut().take(); self.raw.put(name, table, row, old) }
    pub(crate) fn delete(&self, name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> { self.revision.set(self.revision.get().wrapping_add(1)); self.lookup_cache.borrow_mut().take(); self.raw.delete(name, table, old) }
    pub(crate) fn holds_assets(&self) -> bool { self.raw.holds_assets() }
    pub(crate) fn asset(&self, id: &str) -> Result<Option<Asset>, RuntimeError> { self.raw.asset(id) }
    pub(crate) fn claim_asset(&self, id: &str, by: &str, table: &str, row: &str, column: &str) -> Result<Asset, RuntimeError> { self.raw.claim_asset(id, by, table, row, column) }
    pub(crate) fn release_asset(&self, id: &str, #[cfg(feature = "sqlite")] table: &str, #[cfg(feature = "sqlite")] row_id: &str, #[cfg(feature = "sqlite")] column: &str, now: i64) -> Result<(), RuntimeError> { #[cfg(feature = "sqlite")] { self.raw.release_asset(id, table, row_id, column, now) } #[cfg(not(feature = "sqlite"))] { self.raw.release_asset(id, now) } }
    pub(crate) fn effect_once(&self, effect: &str, key: &str) -> Result<bool, RuntimeError> { self.raw.effect_once(effect, key) }
    pub(crate) fn provisional_id_after(&self, table: &str, after: &str) -> Result<Option<String>, RuntimeError> { self.raw.provisional_id_after(table, after) }
    pub(crate) fn provisional_row(&self, table: &str, row: &Value) -> Result<bool, RuntimeError> { self.raw.provisional_row(table, row) }
    pub(crate) fn search_retained_row(&self, table: &str, row: &Value) -> Result<bool, RuntimeError> { self.raw.search_retained_row(table, row) }
    pub(crate) fn retained_row(&self, table: &str, row: &Value) -> Result<bool, RuntimeError> { self.raw.retained_row(table, row) }
    pub(crate) fn retained_group(&self, table: &str, index: &str, prefix: &[Value]) -> Result<bool, RuntimeError> { self.raw.retained_group(table, index, prefix) }
    /// Device acquisition facts carry no row payload, like retained_row.
    pub(crate) fn current_row(&self, table: &str, row: &Value) -> Result<bool, RuntimeError> { self.raw.current_row(table, row) }
    pub(crate) fn current_group(&self, table: &str, index: &str, prefix: &[Value]) -> Result<bool, RuntimeError> { self.raw.current_group(table, index, prefix) }
    pub(crate) fn recording_covered(&self, table: &str, row: &Value, viewer: &str, now: i64, scope: &Authorization, meter: &mut Meter) -> Result<bool, RuntimeError> { InternalLedger::with_meter(meter, |meter, _| self.raw.recording_covered(table, row, viewer, now, scope, meter)) }
    pub(crate) fn acquired_boundary(&self, table: &str, index: &str, prefix: &[Value]) -> Result<Option<AcquiredBoundary>, RuntimeError> { self.raw.acquired_boundary(table, index, prefix) }
    pub(crate) fn prefetch_enabled(&self) -> bool { self.raw.prefetch_enabled() }
    #[allow(dead_code)] // Used by the native prefetch planner; absent on web.
    pub(crate) fn prefetch(&self, requests: &[PrefetchRequest]) { self.raw.prefetch(requests) }
}

struct PrepaidState {
    mark: crate::meter::MeterMark,
    ceilings: Ceilings,
    cut: Cut,
    authorizing: bool,
    nested: bool,
}

impl Runner<'_> {
    // @ref LLP 3000.015#1 — declaration-only scratch is admitted before any
    // candidate/witness access. The logical heap retains only disclosed output.
    pub(super) fn authorized_scratch<T: Default>(&mut self, bytes: u64, allowance: &[(MeterKind, u64)], work: impl FnOnce(&mut Self, &Authorization) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        self.reserved_scratch(bytes, allowance, true, work)
    }

    /// Count certification follows an admitted member and source-group verdict.
    /// Nested authorization still shares any enclosing physical allowance.
    pub(super) fn disclosed_scratch<T: Default>(&mut self, bytes: u64, allowance: &[(MeterKind, u64)], work: impl FnOnce(&mut Self, &Authorization) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        self.reserved_scratch(bytes, allowance, false, work)
    }

    pub(super) fn reserved_scratch<T: Default>(&mut self, bytes: u64, allowance: &[(MeterKind, u64)], physical: bool, work: impl FnOnce(&mut Self, &Authorization) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        if self.device_work_active || self.context.is_system() { return self.prepaid_scan(allowance, physical, work); }
        let mark = self.meter.mark();
        self.meter.heap(bytes)?;
        let result = self.prepaid_scan(allowance, physical, work);
        self.meter.release_row_heap(mark, bytes);
        result
    }

    pub(super) fn rule_scratch(&self, rule: &crate::schema::RuleExpr) -> u64 {
        let mut sites = Vec::new();
        super::rules::probe_sites(rule, &mut sites);
        sites.iter().map(|(table, _)| self.witness_scratch(table)).max().unwrap_or(0)
    }

    pub(super) fn witness_scratch(&self, table: &str) -> u64 {
        let definition = &self.schema.tables[table];
        let own = crate::rows::disclosed::admission(definition);
        let source = self.schema.maintain_for(table)
            .and_then(|m| self.schema.table(&m.source)).filter(|source| source.is_expiring());
        own.saturating_add(source.map_or(0, crate::rows::disclosed::admission))
    }


    /// Ordinary data reads keep their existing meter and cut semantics. This
    /// scope grants storage access without disabling or restoring any charge.
    /// Hidden authorization must use authorized_scan's prepaid reservation.
    pub(crate) fn metered_scan<T>(&mut self, scan: impl FnOnce(&mut Self, &Authorization) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        scan(self, &Authorization::internal())
    }

    /// A rule whose logical allowance the caller has already charged, possibly
    /// to a cut, still evaluates its witnesses under the physical allowance;
    /// the caller decides what its cut means for the answer (LLP 3000.014 §5).
    pub(super) fn prepaid_witnesses<T>(&mut self, work: impl FnOnce(&mut Self, &Authorization) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        let active = self.tx.authorizing.replace(self.tx.authorizing.get() || !self.context.is_system());
        let result = work(self, &Authorization::internal());
        self.tx.authorizing.set(active);
        result
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
            let result = scan(self, &Authorization::internal());
            self.tx.authorizing.set(active);
            return result;
        }
        for &(kind, amount) in allowance {
            if !self.read_charge(kind, amount)? { return Ok(T::default()); }
        }
        if self.read_capped() { return Ok(T::default()); }
        let scope = Authorization { probes: Cell::new(0), remaining_probes: self.meter.ceilings.rule_probes.saturating_sub(self.meter.used.rule_probes) };
        let state = self.enter_prepaid(physical);
        let result = scan(self, &scope);
        self.leave_prepaid(state, result.as_ref().err());
        if scope.probes.get() > 0 { self.read_charge(MeterKind::RuleProbes, scope.probes.get())?; }
        result
    }

    // Kept out of the generic closure wrapper: every protected access shares
    // the same scope transition instead of instantiating its restoration code.
    #[inline(never)]
    fn enter_prepaid(&mut self, physical: bool) -> PrepaidState {
        let nested = self.caller_heap_ceiling.is_some();
        self.caller_heap_ceiling.get_or_insert((self.meter.ceilings.heap_bytes, self.meter.used.heap_bytes));
        PrepaidState {
            mark: self.meter.mark(),
            ceilings: std::mem::replace(&mut self.meter.ceilings, Ceilings::unbounded()),
            cut: std::mem::replace(&mut self.meter.cut, Cut::Abort),
            authorizing: self.tx.authorizing.replace(self.tx.authorizing.get() || (physical && !self.context.is_system())),
            nested,
        }
    }

    #[inline(never)]
    fn leave_prepaid(&mut self, state: PrepaidState, error: Option<&RuntimeError>) {
        self.tx.authorizing.set(state.authorizing);
        self.meter.restore(state.mark);
        self.meter.ceilings = state.ceilings;
        self.meter.cut = state.cut;
        if !state.nested { self.caller_heap_ceiling = None; }
        if let Some(RuntimeError::Bound { kind: MeterKind::HeapBytes, site, .. }) = error {
            self.meter.capped_at.get_or_insert((MeterKind::HeapBytes, site.clone()));
        }
    }

}

#[cfg(all(test, feature = "sqlite"))]
mod tests {
    use super::*;
    use crate::{Context, Store, meter::Meter, schema::Schema};

    #[test]
    fn job_authority_edges_clear_raw_cache_but_keep_the_allowance() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        let schema = Schema::default();
        let mut runner = Runner::new(&tx, &schema, Context::system(), Meter::new(Ceilings::job(), Cut::Abort), 0);
        runner.tx.remaining.set(17);
        *runner.tx.lookup_cache.borrow_mut() = Some(("t".into(), "byId".into(), vec![], None));
        let child = runner.job_read_child(Context::new("user:alice", Default::default()));
        assert!(child.tx.lookup_cache.borrow().is_none());
        assert_eq!(child.tx.remaining(), 17);
        child.tx.remaining.set(13);
        *child.tx.lookup_cache.borrow_mut() = Some(("t".into(), "byId".into(), vec![], None));
        runner.finish_job_read_child(child);
        assert!(runner.tx.lookup_cache.borrow().is_none());
        assert_eq!(runner.tx.remaining(), 13);
    }

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
            } else { runner.metered_scan(|runner, scope|runner.fetch(scope,"records","absent")) };
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
pub struct InternalMeter<'a>(&'a mut Meter);
impl InternalMeter<'_> {
    pub fn heap(&mut self, bytes: u64) -> Result<(), RuntimeError> { self.0.heap(bytes) }
    pub fn charge(&mut self, kind: MeterKind, amount: u64) -> Result<bool, RuntimeError> { self.0.charge(kind, amount) }
    pub fn at(&mut self, site: &str) { self.0.at(site); }
    pub fn step(&mut self, steps: u64) -> Result<(), RuntimeError> { self.0.step(steps) }
    /// Release temporary allocations without exposing the saved heap counter.
    pub fn scratch<T>(&mut self, work: impl FnOnce(&mut Self) -> T) -> T {
        let mark = self.0.mark();
        let result = work(self);
        self.0.release_heap(mark);
        result
    }
    pub fn examined_room(&self, rows: usize) -> bool { self.0.room(MeterKind::Examined, rows as u64) }
    pub(crate) fn room(&self, kind: MeterKind, amount: u64) -> bool { self.0.room(kind, amount) }
    pub(crate) fn grow<T>(&mut self, len: usize, capacity: usize) -> Result<usize, RuntimeError> {
        crate::rows::word_heap::grow::<T>(self.0, len, capacity)
    }
    #[cfg(feature = "sqlite")]
    pub(crate) fn once(&mut self, site: crate::meter::HeapSite, bytes: u64) -> Result<(), RuntimeError> { self.0.once(site, bytes) }
}
impl InternalLedger {
    pub(crate) fn with_meter<T>(meter: &mut crate::meter::Meter, work: impl FnOnce(&mut InternalMeter<'_>, &Authorization) -> T) -> T {
        work(&mut InternalMeter(meter), &Authorization::internal())
    }
    pub fn new(meter: crate::meter::Meter) -> Self { Self(meter) }
    pub fn run<T>(&mut self, work: impl FnOnce(&mut InternalMeter<'_>, &Authorization) -> T) -> T {
        work(&mut InternalMeter(&mut self.0), &Authorization::internal())
    }
}

#[cfg(all(test,feature="sqlite"))]
mod row_view_tests {
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

#[cfg(feature = "sqlite")]
impl<'a> Runner<'a> {
    /// Fresh read state over this exact transaction; move the guarded allowance
    /// with the meter so nested queries cannot reset authorization work.
    pub(super) fn job_read_child(&mut self, context: super::Context) -> Runner<'a> {
        self.tx.lookup_cache.borrow_mut().take();
        let meter = std::mem::replace(&mut self.meter, Meter::new(Ceilings::job(), Cut::Abort));
        let mut child = Runner::new(self.tx.raw, self.schema, context, meter, self.seq);
        std::mem::swap(&mut child.tx, &mut self.tx);
        child.job_read_scope = 2;
        child
    }
    pub(super) fn finish_job_read_child(&mut self, mut child: Runner<'a>) {
        child.tx.lookup_cache.borrow_mut().take();
        std::mem::swap(&mut child.tx, &mut self.tx);
        self.meter = child.meter;
        self.read_tables.extend(child.read_tables);
    }
}

// @ref LLP 3000.028#3.3.1 — decoration has separate coverage, never separate
// resource or authorization allowances. Move both, including exhausted counters.
impl<'a> Runner<'a> {
    pub(super) fn decoration_child(&mut self) -> Result<Runner<'a>, RuntimeError> {
        self.meter.heap(1024 + self.context.args.values().map(super::runner::expression_heap).sum::<u64>())?;
        #[cfg(feature = "server-search")]
        self.meter.heap(self.context.search_retained_order.as_ref().map_or(0, |(keys, _)| keys.len() as u64 * 8)
            + self.context.search_retained_candidates.iter().map(|(id, _, _)| 64 + id.len() as u64).sum::<u64>())?;
        let placeholder = Meter::new(self.meter.ceilings, self.meter.cut);
        let meter = std::mem::replace(&mut self.meter, placeholder);
        let mut child = Runner::new(self.tx.raw, self.schema, self.context.clone(), meter, self.seq);
        std::mem::swap(&mut child.tx, &mut self.tx);
        child.device = self.device;
        child.meter.cut = Cut::Abort;
        Ok(child)
    }
    pub(super) fn finish_decoration_child(&mut self, mut child: Runner<'a>) {
        child.tx.lookup_cache.borrow_mut().take();
        std::mem::swap(&mut child.tx, &mut self.tx);
        child.meter.cut = self.meter.cut;
        self.meter = child.meter;
        self.read_tables.extend(child.read_tables);
        // Decoration expiry invalidates the value, but never changes freshness
        // or the page's completeness. Re-evaluation substitutes null after expiry.
        self.decoration_expiry = child.next_expiry.get();
    }
}
