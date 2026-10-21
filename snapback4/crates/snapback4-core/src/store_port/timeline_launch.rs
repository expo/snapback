//! Following launch advice and its public alternative.
pub const COPY_CEILING: u64 = 5_000_000;
// Updated from the complete release-profile activation measurement, including
// slot fill, indexes, validation and commit. An estimate, not a latency promise.
pub const ROW_WRITES_PER_SECOND: u64 = 7_000;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Estimate {
    pub name: String,
    pub sources: u64,
    pub events: u64,
    pub edges: u64,
    pub copies: u64,
}
impl Estimate {
    pub fn summary(&self) -> String {
        format!("view {}: {} source rows, {} events, {} follows; {} rows to copy; estimated writer lock {:.2} s at {} row writes/s (hardware-dependent); ceiling {} copies",
            self.name, self.sources, self.events, self.edges, self.copies,
            (self.sources + 2 * self.events + self.copies) as f64 / ROW_WRITES_PER_SECOND as f64, ROW_WRITES_PER_SECOND, COPY_CEILING)
    }
}
pub const ALTERNATIVE: &str = "Use the planned home query in guide feeds: query home(c: cursor ?): return activity where .actor = viewer or exists follows[viewer, .actor] last 20 by .at after c";
