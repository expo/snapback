//! Timings belong to a successful activation, never to an uncommitted candidate.
use std::time::{Duration, Instant};

#[derive(Default, Debug)]
pub struct AdoptionReport {
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
