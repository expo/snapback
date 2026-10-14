//! Timings belong to a successful activation, never to an uncommitted candidate.
use std::time::{Duration, Instant};

#[derive(Default, Debug)]
pub struct AdoptionReport {
    pub changes:Vec<String>,
    pub phases: Vec<(&'static str, Duration)>,
    /// Nested attribution, not additional time to add to `phases`.
    pub details: Vec<(String, Duration)>,
    pub views: Vec<ViewBuild>,
}

#[derive(Debug)]
pub struct ViewBuild {
    pub name: String,
    /// Source row visits; a row-keyed rebuild can visit one source per member.
    pub rows: u64,
    pub elapsed: Duration,
}

impl AdoptionReport {
    // @ref LLP 3000.000.000#11-wave-11-factual-release-narration — current dormant storage is counted by unit; samples never mix units.
    pub fn dormant(items: &[super::release_history::DormantItem]) -> String {
        let mut counts = [0u64; 3];
        let mut samples = std::collections::BTreeMap::<String, std::collections::BTreeSet<String>>::new();
        for item in items {
            let (slot, label) = match item.kind.as_str() {
                "column" => (1, format!("cells {}", item.path)),
                "index" => (2, format!("entries {}", item.path)),
                _ => (0, format!("rows {}", item.path)),
            };
            counts[slot] += item.rows;
            if !item.sample_ids.is_empty() { samples.entry(label).or_default().extend(item.sample_ids.iter().cloned()); }
        }
        let labelled = samples.into_iter().map(|(label, ids)| format!("{label} [{}]", ids.into_iter().take(5).collect::<Vec<_>>().join(", "))).collect::<Vec<_>>();
        format!("{} {}, {} {}, {} index {} dormant{}", counts[0], if counts[0] == 1 { "row" } else { "rows" }, counts[1], if counts[1] == 1 { "cell" } else { "cells" }, counts[2], if counts[2] == 1 { "entry" } else { "entries" },
            if labelled.is_empty() { String::new() } else { format!("; samples: {}", labelled.join("; ")) })
    }
    pub fn compact(&self)->String {
        let elapsed:Duration=self.phases.iter().map(|(_,d)|*d).sum();
        let mut changes=self.changes.iter().take(5).cloned().collect::<Vec<_>>();
        if self.changes.len()>5 {changes.push(format!("{} more changes",self.changes.len()-5));}
        format!("{}; {:.1} ms",if changes.is_empty(){"adopted".into()}else{changes.join(", ")},elapsed.as_secs_f64()*1000.0)
    }
    pub fn summary(&self) -> String {
        let report = self;
        let mut out = String::new();
        if !report.phases.is_empty() {
            out.push_str(&format!(
                "; phases [{}]",
                report
                    .phases
                    .iter()
                    .map(|(name, time)| format!("{name} {:.3} ms", time.as_secs_f64() * 1000.0))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        if !report.details.is_empty() {
            out.push_str(&format!(
                "; phase details (nested) [{}]",
                report
                    .details
                    .iter()
                    .map(|(name, time)| format!("{name} {:.3} ms", time.as_secs_f64() * 1000.0))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        if !report.views.is_empty() {
            out.push_str(&format!(
                "; rebuilt {}",
                report
                    .views
                    .iter()
                    .map(|view| format!(
                        "{} ({} source visits, {:.3} ms)",
                        view.name,
                        view.rows,
                        view.elapsed.as_secs_f64() * 1000.0
                    ))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        out
    }

    pub(crate) fn detail(&mut self, name: impl Into<String>, start: Instant) {
        self.details.push((name.into(), start.elapsed()));
    }
    pub(crate) fn phase(&mut self, name: &'static str, start: &mut Instant) {
        self.phases.push((name, start.elapsed()));
        *start = Instant::now();
    }
}

// @ref LLP 3000.007.001#3.11 — builder output names the parent field, never its private target.
pub(super) fn table_label(schema: &crate::Schema, name: &str) -> String {
    if let Some(maintain) = schema.maintain_for(name) {
        return maintain.label();
    }
    for (prefix, suffix) in [("$basis:", "live basis"), ("$recount:", "recount state")] {
        if let Some(target) = name.strip_prefix(prefix) {
            let target = schema
                .maintain_for(target)
                .map_or_else(|| target.to_owned(), |m| m.label());
            return format!("{target} {suffix}");
        }
    }
    name.to_owned()
}
