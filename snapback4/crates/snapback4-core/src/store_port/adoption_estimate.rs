//! Population advice; measured rates are independent of the physical store.
use std::collections::BTreeMap;
#[derive(Debug, Default)]
pub struct AdoptionEstimate {
    pub cache_mib: u32,
    pub retired_rows: u64,
    pub retired_index_entries: u64,
    /// Unconditional deadline rewrites, without a measured rate (unlike projections).
    pub deadline_rewrite_rows: u64,
    /// Work without a measured rate; populations are not exact deletion counts.
    pub unestimated: std::collections::BTreeSet<String>,
    pub sources: BTreeMap<String, u64>,
    pub projected_rows: u64,
    pub index_rows: u64,
    pub capture_rows: u64,
    pub aggregate_rows: u64,
    pub member_rows: u64,
    pub row_view_visits: u64,
}

impl AdoptionEstimate {
    /// Reference rates measured on eb1000, release profile, calibration #30.
    /// Row-keyed work is a range: source populations alone do not reveal the
    /// member predicates, small-range probes or where a recount becomes pending.
    pub fn seconds(&self) -> (f64, f64) {
        let fixed = self.projected_rows as f64 / 200_000.0
            + self.index_rows as f64 / 400_000.0
            + self.capture_rows as f64 / 80_000.0
            + self.aggregate_rows as f64 / 200_000.0
            + self.member_rows as f64 / 10_000.0;
        (fixed, fixed + self.row_view_visits as f64 / 100_000.0)
    }

    pub fn summary(&self) -> String {
        let (lo, hi) = self.seconds();
        let sources = self
            .sources
            .iter()
            .map(|(name, rows)| format!("{name}={rows}"))
            .collect::<Vec<_>>()
            .join(", ");
        let pause = if hi == 0.0 {
            "unestimated write pause for activation cleanup/rewrite".to_owned()
        } else {
            format!("estimated write work up to {hi:.2} s on a host like measured eb1000 (not a host/load SLO); {lo:.2} s subtotal excludes row-view visits and is not a floor")
        };
        let retirement = if self.retired_rows != 0 || self.retired_index_entries != 0 {
            format!("; additional unestimated retirement pause: {} stored rows and {} index entries", self.retired_rows, self.retired_index_entries)
        } else { String::new() };
        let unestimated = if self.unestimated.is_empty() { String::new() } else {
            format!("; additional unestimated write pause: {}", self.unestimated.iter().cloned().collect::<Vec<_>>().join(", "))
        };
        let cache = if self.cache_mib == 0 { "caller cache setting".to_owned() }
            else { format!("{} MiB combined main/temp cache target (larger caller settings retained, reduced for Linux address-space headroom)", self.cache_mib) };
        format!(
            "{pause}; source rows [{sources}]; {} row projections, {} index row builds, {} capture fills, {} aggregate visits, {} members / up to {} row-view visits{retirement}{unestimated}; memory: {cache}, prior 64 MiB main-cache run used about 147 MiB process RSS (workspace target is not a process cap); SNAPBACK4_ADOPTION_CACHE_MIB=0 keeps caller settings, default 64; if the cache was enlarged, SQLite NOMEM rolls back and retries once at caller settings; payload width, token fanout, group distribution, cache setting and WAL/storage affect the actual time",
            self.projected_rows,
            self.index_rows,
            self.capture_rows,
            self.aggregate_rows,
            self.member_rows,
            self.row_view_visits
        )
    }
}
