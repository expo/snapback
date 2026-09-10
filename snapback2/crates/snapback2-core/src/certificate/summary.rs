use super::diagnostic::WorkTerms;
use super::{ReadSite, WriteSite};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Default)]
pub(super) struct Summary {
    pub(super) reads: BTreeMap<String, ReadSite>,
    pub(super) writes: Vec<WriteSite>,
    pub(super) examined: u64,
    pub(super) index_entries: u64,
    pub(super) rule_probes: u64,
    pub(super) steps: u64,
    pub(super) derived_steps: u64,
    pub(super) derived_scratch: u64,
    pub(super) nonuniform_range: bool,
    pub(super) count_absence_bytes: u64,
    pub(super) count_probe_tables: BTreeSet<String>,
    pub(super) costs: WorkTerms,
}

impl Summary {
    pub(super) fn add(mut self, other: Self) -> Self {
        for (name, site) in other.reads {
            self.reads
                .entry(name)
                .and_modify(|existing| {
                    existing.max_calls += site.max_calls;
                    // Structural admission requires the full access shapes to
                    // agree. Keep this merge fail-closed as defense in depth:
                    // a future missed path must never let the first hoist or
                    // smaller meter silently govern a later access.
                    existing.take = existing.take.max(site.take);
                    existing.rule_probes_per_candidate = existing
                        .rule_probes_per_candidate
                        .max(site.rule_probes_per_candidate);
                    existing.hoist &= site.hoist;
                    existing.decided_true &= site.decided_true;
                })
                .or_insert(site);
        }
        self.costs.add(other.costs);
        self.writes.extend(other.writes);
        self.examined = self.examined.saturating_add(other.examined);
        self.index_entries = self.index_entries.saturating_add(other.index_entries);
        self.rule_probes = self.rule_probes.saturating_add(other.rule_probes);
        self.steps = self.steps.saturating_add(other.steps);
        self.count_absence_bytes = self
            .count_absence_bytes
            .saturating_add(other.count_absence_bytes);
        self.count_probe_tables.extend(other.count_probe_tables);
        self.nonuniform_range |= other.nonuniform_range;
        self
    }

    pub(super) fn branch(mut self, other: Self) -> Self {
        self.costs.branch(
            &other.costs,
            [
                self.examined < other.examined,
                self.index_entries < other.index_entries,
                self.rule_probes < other.rule_probes,
                self.steps < other.steps,
            ],
        );
        for (name, site) in other.reads {
            self.reads
                .entry(name)
                .and_modify(|existing| {
                    existing.max_calls = existing.max_calls.max(site.max_calls);
                    existing.take = existing.take.max(site.take);
                    existing.rule_probes_per_candidate = existing
                        .rule_probes_per_candidate
                        .max(site.rule_probes_per_candidate);
                    existing.hoist &= site.hoist;
                    existing.decided_true &= site.decided_true;
                })
                .or_insert(site);
        }
        // @ref LLP 1001#2-what-a-commit-records — sequential writes add
        // within one arm; only the completed arm totals are branch-maxed.
        self.writes = sum_write_sites(std::mem::take(&mut self.writes));
        for write in sum_write_sites(other.writes) {
            if let Some(existing) = self
                .writes
                .iter_mut()
                .find(|existing| existing.table == write.table && existing.kind == write.kind)
            {
                existing.max_rows = existing.max_rows.max(write.max_rows);
            } else {
                self.writes.push(write);
            }
        }
        self.examined = self.examined.max(other.examined);
        self.index_entries = self.index_entries.max(other.index_entries);
        self.rule_probes = self.rule_probes.max(other.rule_probes);
        self.steps = self.steps.max(other.steps);
        self.count_absence_bytes = self.count_absence_bytes.max(other.count_absence_bytes);
        self.count_probe_tables.extend(other.count_probe_tables);
        self.nonuniform_range |= other.nonuniform_range;
        self
    }
}

fn sum_write_sites(writes: Vec<WriteSite>) -> Vec<WriteSite> {
    let mut totals = Vec::<WriteSite>::new();
    for write in writes {
        if let Some(existing) = totals
            .iter_mut()
            .find(|existing| existing.table == write.table && existing.kind == write.kind)
        {
            existing.max_rows = existing.max_rows.saturating_add(write.max_rows);
        } else {
            totals.push(write);
        }
    }
    totals
}
