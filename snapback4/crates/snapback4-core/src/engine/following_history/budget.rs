//! Reservation does not charge on refusal. All seven dimensions move together.
use crate::meter::{Ceilings, Metered};

pub(super) const SCRATCH: u64 = 2 * 1024 * 1024;
pub(super) const ENVELOPE: u64 = 512;

pub(super) struct Budget {
    pub used: Metered,
    pub ceilings: Ceilings,
    pub publication: Metered,
}

impl Budget {
    pub fn new(ceilings: Ceilings, page_size: usize) -> Self {
        Self {
            used: Metered::default(),
            ceilings,
            publication: Metered {
                examined: page_size as u64 * 4,
                rule_probes: page_size as u64 * 2,
                steps: page_size as u64 * 128 + 64,
                heap_bytes: 8 * 1024 * 1024,
                rows_written: 5,
                ..Default::default()
            },
        }
    }
    pub fn fits(&self, cost: Metered) -> bool {
        fits(self.ceilings, add(self.used, cost))
    }
    pub fn take(&mut self, cost: Metered) -> bool {
        if !self.fits(cost) {
            return false;
        }
        self.used = add(self.used, cost);
        true
    }
    pub fn work(&mut self, cost: Metered, checkpoint: u64) -> bool {
        let reserve = Metered {
            rows_written: checkpoint,
            ..self.publication
        };
        if !self.fits(add(cost, reserve)) {
            return false;
        }
        self.take(cost)
    }
    pub fn remaining_output(&self) -> u64 {
        self.ceilings.output_bytes.saturating_sub(ENVELOPE)
    }
}

pub(super) fn add(a: Metered, b: Metered) -> Metered {
    Metered {
        examined: a.examined.saturating_add(b.examined),
        index_entries: a.index_entries.saturating_add(b.index_entries),
        rule_probes: a.rule_probes.saturating_add(b.rule_probes),
        steps: a.steps.saturating_add(b.steps),
        heap_bytes: a.heap_bytes.saturating_add(b.heap_bytes),
        output_bytes: a.output_bytes.saturating_add(b.output_bytes),
        rows_written: a.rows_written.saturating_add(b.rows_written),
    }
}
pub(super) fn fits(c: Ceilings, m: Metered) -> bool {
    m.examined <= c.examined
        && m.index_entries <= c.index_entries
        && m.rule_probes <= c.rule_probes
        && m.steps <= c.steps
        && m.heap_bytes <= c.heap_bytes
        && m.output_bytes <= c.output_bytes
        && m.rows_written <= c.rows_written
}
pub(super) fn unit(index: bool) -> Metered {
    Metered {
        examined: 4,
        index_entries: u64::from(index),
        rule_probes: 2,
        steps: 128,
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MeterKind;
    #[test]
    fn refused_reservations_change_none_of_seven_dimensions() {
        for kind in [
            MeterKind::Examined,
            MeterKind::IndexEntries,
            MeterKind::RuleProbes,
            MeterKind::Steps,
            MeterKind::HeapBytes,
            MeterKind::OutputBytes,
            MeterKind::RowsWritten,
        ] {
            let mut b = Budget::new(Ceilings::default(), 1);
            let before = b.used;
            let mut m = Metered::default();
            match kind {
                MeterKind::Examined => m.examined = u64::MAX,
                MeterKind::IndexEntries => m.index_entries = u64::MAX,
                MeterKind::RuleProbes => m.rule_probes = u64::MAX,
                MeterKind::Steps => m.steps = u64::MAX,
                MeterKind::HeapBytes => m.heap_bytes = u64::MAX,
                MeterKind::OutputBytes => m.output_bytes = u64::MAX,
                MeterKind::RowsWritten => m.rows_written = u64::MAX,
            }
            assert!(!b.take(m));
            assert_eq!(b.used, before);
        }
    }
}
