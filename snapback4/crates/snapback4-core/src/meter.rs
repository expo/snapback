//! The runtime meter (LLP 2000.000 §6): resources are charged as a program
//! runs, deterministically (counts, never time), on the server and on a
//! device alike. A query cut by the meter returns `capped`; a mutation
//! aborts with `E_BOUND` naming the actual work.

use crate::error::{MeterKind, RuntimeError};
use serde::{Deserialize, Serialize};

/// The ceilings. They keep Snapback 2's names and roughly its values.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ceilings {
    pub examined: u64,
    pub index_entries: u64,
    pub rule_probes: u64,
    pub steps: u64,
    pub heap_bytes: u64,
    pub output_bytes: u64,
    pub rows_written: u64,
}

impl Default for Ceilings {
    fn default() -> Self {
        Self { examined: 8_192, index_entries: 16_384, rule_probes: 8_192, steps: 1_000_000, heap_bytes: 16 << 20, output_bytes: 1 << 20, rows_written: 1_024 }
    }
}

impl Ceilings {
    /// A job runs one chunk at a time and may write more.
    pub fn job() -> Self {
        Self { rows_written: 8_192, examined: 16_384, ..Self::default() }
    }

    /// The engine's own partition maintenance is bounded by audience, not by
    /// the author's ceilings.
    pub fn unbounded() -> Self {
        Self { examined: u64::MAX, index_entries: u64::MAX, rule_probes: u64::MAX, steps: u64::MAX, heap_bytes: u64::MAX, output_bytes: u64::MAX, rows_written: u64::MAX }
    }

    fn of(&self, kind: MeterKind) -> u64 {
        match kind {
            MeterKind::Examined => self.examined,
            MeterKind::IndexEntries => self.index_entries,
            MeterKind::RuleProbes => self.rule_probes,
            MeterKind::Steps => self.steps,
            MeterKind::HeapBytes => self.heap_bytes,
            MeterKind::OutputBytes => self.output_bytes,
            MeterKind::RowsWritten => self.rows_written,
        }
    }
}

/// What a program actually did. Printed by `test` beside the ceilings.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Metered {
    pub examined: u64,
    pub index_entries: u64,
    pub rule_probes: u64,
    pub steps: u64,
    pub heap_bytes: u64,
    pub output_bytes: u64,
    pub rows_written: u64,
}

impl Metered {
    fn slot(&mut self, kind: MeterKind) -> &mut u64 {
        match kind {
            MeterKind::Examined => &mut self.examined,
            MeterKind::IndexEntries => &mut self.index_entries,
            MeterKind::RuleProbes => &mut self.rule_probes,
            MeterKind::Steps => &mut self.steps,
            MeterKind::HeapBytes => &mut self.heap_bytes,
            MeterKind::OutputBytes => &mut self.output_bytes,
            MeterKind::RowsWritten => &mut self.rows_written,
        }
    }
}

/// How the meter reports a cut: a read site returns what it found so far and
/// marks the result capped; a write aborts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cut {
    /// Reads stop and the result is `capped`.
    Cap,
    /// Writes abort with `E_BOUND`.
    Abort,
}

#[cfg(feature = "sqlite")]
#[derive(Clone, Copy)]
pub(crate) enum HeapSite {
    SqliteColumns,
}

#[derive(Clone, Debug)]
pub struct MeterMark {
    heap_peak: u64,
    used: Metered,
    capped_at: Option<(MeterKind, String)>,
    #[cfg(feature = "sqlite")]
    heap_once: u8,
}

#[derive(Clone, Debug)]
pub struct Meter {
    /// High water mark, including released transient row scopes.
    pub heap_peak: u64,
    pub ceilings: Ceilings,
    pub used: Metered,
    pub cut: Cut,
    /// Set when a read site was cut; the result is then `capped`.
    pub capped_at: Option<(MeterKind, String)>,
    site: String,
    #[cfg(feature = "sqlite")]
    heap_once: u8,
    /// Physical store scratch reserved through store guards; never public,
    /// never restored (word_heap::StoreGuard, LLP 3000.007 §20.24.5).
    pub(crate) scratch: u64,
}

impl Meter {
    pub fn new(ceilings: Ceilings, cut: Cut) -> Self {
        Self { heap_peak: 0, ceilings, used: Metered::default(), cut, capped_at: None, site: String::new(),
            #[cfg(feature = "sqlite")] heap_once: 0, scratch: 0 }
    }

    /// Resume prepaid coordinator work on the same device read allowance.
    pub fn resume(ceilings: Ceilings, used: Metered) -> Result<Self, RuntimeError> {
        Self::resume_read(ceilings, used, false)
    }

    /// Observe delivery state after a finished read. Capped read dimensions
    /// retain the rejected charge and cannot do more work; the state check
    /// may spend the remaining heap/step/output allowance. Never for a query.
    // @ref LLP 3000.028#3.3 — constituent cuts preserve the shared ledger without discarding server proof.
    pub fn resume_observation(ceilings: Ceilings, used: Metered) -> Result<Self, RuntimeError> {
        Self::resume_read(ceilings, used, true)
    }

    fn resume_read(ceilings: Ceilings, used: Metered, finished: bool) -> Result<Self, RuntimeError> {
        let mut meter = Self::new(ceilings, Cut::Cap);
        meter.at("ordinary search coordinator");
        for (kind, amount) in [(MeterKind::Examined, used.examined), (MeterKind::IndexEntries, used.index_entries),
            (MeterKind::RuleProbes, used.rule_probes), (MeterKind::HeapBytes, used.heap_bytes),
            (MeterKind::OutputBytes, used.output_bytes), (MeterKind::RowsWritten, used.rows_written)] {
            if !meter.charge(kind, amount)? && !(finished && matches!(kind, MeterKind::Examined | MeterKind::IndexEntries | MeterKind::RuleProbes)) {
                return Err(RuntimeError::Bound { kind, actual: amount, ceiling: ceilings.of(kind), site: meter.site.clone() });
            }
        }
        meter.step(used.steps)?;
        Ok(meter)
    }

    pub fn at(&mut self, site: &str) {
        self.site = site.to_owned();
    }

    pub fn site(&self) -> &str {
        &self.site
    }

    /// Charge `amount` of `kind`. Under `Cut::Abort` an exceeded ceiling is an
    /// error; under `Cut::Cap` it records the cut and returns `false`, and
    /// the read site stops examining.
    pub fn charge(&mut self, kind: MeterKind, amount: u64) -> Result<bool, RuntimeError> {
        let slot = self.used.slot(kind);
        *slot = slot.saturating_add(amount);
        let actual = *slot;
        if kind == MeterKind::HeapBytes { self.heap_peak = self.heap_peak.max(actual); }
        let ceiling = self.ceilings.of(kind);
        if actual <= ceiling {
            return Ok(true);
        }
        match self.cut {
            Cut::Abort => Err(RuntimeError::Bound { kind, actual, ceiling, site: self.site.clone() }),
            Cut::Cap => {
                if self.capped_at.is_none() {
                    self.capped_at = Some((kind, self.site.clone()));
                }
                Ok(false)
            }
        }
    }

    /// The meter's position, to roll back to: the work spent deciding that a
    /// row is hidden is not the viewer's to see (LLP 1001 §3's
    /// `rollback_candidate`), so a hidden hit costs what a miss costs and a
    /// hoisted-false range costs what an empty one costs.
    pub fn mark(&self) -> MeterMark {
        MeterMark { heap_peak: self.heap_peak, used: self.used, capped_at: self.capped_at.clone(),
            #[cfg(feature = "sqlite")] heap_once: self.heap_once }
    }

    pub fn restore(&mut self, mark: MeterMark) {
        self.heap_peak = mark.heap_peak;
        self.used = mark.used;
        self.capped_at = mark.capped_at;
        #[cfg(feature = "sqlite")]
        { self.heap_once = mark.heap_once; }
    }

    /// Release a scope whose allocated values have all been dropped, without
    /// erasing work or a refusal. Once-only reservations made in that scope
    /// must be paid again after their heap allowance is released.
    pub(crate) fn release_heap(&mut self, mark: MeterMark) {
        self.used.heap_bytes = mark.used.heap_bytes;
        #[cfg(feature = "sqlite")]
        { self.heap_once = mark.heap_once; }
    }

    /// Release only the store/row/key scratch part of an incremental scan.
    /// Retained cursor, selected row and buffer allowances are charged
    /// separately; filter allocations and helper bindings remain cumulative.
    pub(crate) fn release_row_heap(&mut self, mark: MeterMark, bytes: u64) {
        self.used.heap_bytes = self.used.heap_bytes.saturating_sub(bytes);
        #[cfg(feature = "sqlite")]
        { self.heap_once = mark.heap_once; }
        #[cfg(not(feature = "sqlite"))]
        { let _ = mark; }
    }

    /// Whether `kind` has room for `amount` more without charging.
    pub fn room(&self, kind: MeterKind, amount: u64) -> bool {
        let used = match kind {
            MeterKind::Examined => self.used.examined,
            MeterKind::IndexEntries => self.used.index_entries,
            MeterKind::RuleProbes => self.used.rule_probes,
            MeterKind::Steps => self.used.steps,
            MeterKind::HeapBytes => self.used.heap_bytes,
            MeterKind::OutputBytes => self.used.output_bytes,
            MeterKind::RowsWritten => self.used.rows_written,
        };
        used.saturating_add(amount) <= self.ceilings.of(kind)
    }

    /// A scalar cannot substitute absence or a partial total for unfinished work.
    pub(crate) fn require_uncapped(&self) -> Result<(), RuntimeError> {
        if let Some((kind, site)) = &self.capped_at {
            let mut used = self.used;
            return Err(RuntimeError::Bound { kind: *kind, actual: *used.slot(*kind), ceiling: self.ceilings.of(*kind), site: site.clone() });
        }
        Ok(())
    }

    pub fn step(&mut self, n: u64) -> Result<(), RuntimeError> {
        // Steps always abort: a runaway loop is not a page to cap.
        let slot = &mut self.used.steps;
        *slot = slot.saturating_add(n);
        if *slot > self.ceilings.steps {
            return Err(RuntimeError::Bound { kind: MeterKind::Steps, actual: *slot, ceiling: self.ceilings.steps, site: self.site.clone() });
        }
        Ok(())
    }

    pub fn heap(&mut self, bytes: u64) -> Result<(), RuntimeError> {
        // Heap exhaustion must unwind allocation, even for a capped read.
        // Runner turns that unwind into an incomplete, unavailable result.
        if !self.charge(MeterKind::HeapBytes, bytes)? {
            return Err(RuntimeError::Bound { kind: MeterKind::HeapBytes, actual: self.used.heap_bytes, ceiling: self.ceilings.heap_bytes, site: self.site.clone() });
        }
        Ok(())
    }

    /// Reserve bounded reusable scratch once per meter, only after admission.
    #[cfg(feature = "sqlite")]
    pub(crate) fn once(&mut self, site: HeapSite, bytes: u64) -> Result<(), RuntimeError> {
        let bit = 1 << site as u8;
        if self.heap_once & bit == 0 {
            self.heap(bytes)?;
            self.heap_once |= bit;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observation_preserves_capped_read_charges_without_reopening_the_scan() {
        let ceilings = Ceilings::default();
        for kind in [MeterKind::Examined, MeterKind::IndexEntries, MeterKind::RuleProbes] {
            let mut used = Metered { steps: 100, heap_bytes: 1024, output_bytes: 128, ..Default::default() };
            *used.slot(kind) = ceilings.of(kind) + 1;
            assert!(Meter::resume(ceilings, used).is_err(), "a query cannot resume a cut scan");
            let mut meter = Meter::resume_observation(ceilings, used).unwrap();
            assert_eq!(meter.used, used);
            assert_eq!(meter.ceilings, ceilings);
            assert_eq!(meter.capped_at.as_ref().map(|cut| cut.0), Some(kind));
            meter.step(1).unwrap(); meter.heap(64).unwrap();
            assert!(meter.charge(MeterKind::OutputBytes, 10).unwrap());
            assert!(!meter.charge(kind, 1).unwrap(), "no new read allowance");
            assert_eq!(*meter.used.slot(kind), ceilings.of(kind) + 2);
        }
        for kind in [MeterKind::Steps, MeterKind::HeapBytes, MeterKind::OutputBytes, MeterKind::RowsWritten] {
            let mut used = Metered::default();
            *used.slot(kind) = ceilings.of(kind) + 1;
            assert!(Meter::resume_observation(ceilings, used).is_err(), "{kind:?}");
        }
    }

    #[test]
    fn a_capped_read_records_where_it_was_cut() {
        let mut meter = Meter::new(Ceilings { examined: 2, ..Ceilings::default() }, Cut::Cap);
        meter.at("q.thread.0");
        assert!(meter.charge(MeterKind::Examined, 2).unwrap());
        assert!(!meter.charge(MeterKind::Examined, 1).unwrap());
        assert_eq!(meter.capped_at, Some((MeterKind::Examined, "q.thread.0".into())));
    }

    #[test]
    fn an_aborting_write_names_the_actual_work() {
        let mut meter = Meter::new(Ceilings { rows_written: 1, ..Ceilings::default() }, Cut::Abort);
        meter.at("m.sweep.2");
        meter.charge(MeterKind::RowsWritten, 1).unwrap();
        let error = meter.charge(MeterKind::RowsWritten, 1).unwrap_err();
        assert!(matches!(error, RuntimeError::Bound { kind: MeterKind::RowsWritten, actual: 2, ceiling: 1, .. }));
    }

    #[cfg(feature = "sqlite")]
    #[test]
    fn once_per_read_scratch_is_prepaid_and_restores_with_its_charge() {
        for cut in [Cut::Cap, Cut::Abort] {
            let mut meter = Meter::new(Ceilings { heap_bytes: 8192, ..Ceilings::default() }, cut);
            let before = meter.mark();
            for _ in 0..1000 { meter.once(HeapSite::SqliteColumns, 8192).unwrap(); }
            assert_eq!(meter.used.heap_bytes, 8192);
            let paid = meter.mark();
            meter.restore(before);
            assert_eq!(meter.used.heap_bytes, 0);
            meter.once(HeapSite::SqliteColumns, 8192).unwrap();
            assert_eq!(meter.used.heap_bytes, 8192, "a restored charge must restore admission too");
            meter.restore(paid);
            meter.once(HeapSite::SqliteColumns, 8192).unwrap();
            assert_eq!(meter.used.heap_bytes, 8192);
            let mut next_read = Meter::new(Ceilings { heap_bytes: 500, ..Ceilings::default() }, cut);
            assert!(next_read.once(HeapSite::SqliteColumns, 8192).is_err());
            assert!(next_read.once(HeapSite::SqliteColumns, 8192).is_err(), "a refusal must not mark the site paid");
            assert_eq!(next_read.heap_once, 0);
        }
    }
}

pub use crate::engine::authorized_scan::InternalLedger;
