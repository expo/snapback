//! Physical evaluation counters; logical Quarry meters are separate.
#[derive(Clone, Copy, Debug, Default, serde::Serialize)]
pub struct Stats {
    /// Explicit driver calls including BEGIN/COMMIT and cold prepares, not a
    /// packet count. Implicit rollback when an errored transaction drops is omitted.
    pub database_calls: u64,
    pub transaction_retries: u64,
    pub prefetch_marked_reads: u64,
    /// Largest marked page in the most recent transaction.
    pub prefetch_page_reads: u64,
    pub prefetch_rows_transferred: u64,
    pub prefetch_bytes_transferred: u64,
}

