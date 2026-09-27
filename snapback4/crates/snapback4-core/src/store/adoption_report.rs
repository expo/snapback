//! Timings belong to a successful activation, never to an uncommitted candidate.
use std::time::{Duration, Instant};

#[derive(Default, Debug)]
pub struct AdoptionReport {
    pub phases: Vec<(&'static str, Duration)>,
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
    pub(crate) fn phase(&mut self, name: &'static str, start: &mut Instant) {
        self.phases.push((name, start.elapsed()));
        *start = Instant::now();
    }
}
