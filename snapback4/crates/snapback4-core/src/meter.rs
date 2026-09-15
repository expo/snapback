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

#[derive(Clone, Debug)]
pub struct MeterMark {
    used: Metered,
    capped_at: Option<(MeterKind, String)>,
}

#[derive(Clone, Debug)]
pub struct Meter {
    pub ceilings: Ceilings,
    pub used: Metered,
    pub cut: Cut,
    /// Set when a read site was cut; the result is then `capped`.
    pub capped_at: Option<(MeterKind, String)>,
    site: String,
}

impl Meter {
    pub fn new(ceilings: Ceilings, cut: Cut) -> Self {
        Self { ceilings, used: Metered::default(), cut, capped_at: None, site: String::new() }
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
        MeterMark { used: self.used, capped_at: self.capped_at.clone() }
    }

    pub fn restore(&mut self, mark: MeterMark) {
        self.used = mark.used;
        self.capped_at = mark.capped_at;
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
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
