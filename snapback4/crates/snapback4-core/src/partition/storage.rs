//! Storage operations needed by the shared authorization and sync algorithm.
//! @ref LLP 3000#7-decisions-during-execution — experimental Postgres shares partition semantics
use crate::{
    error::RuntimeError,
    rows::Rows,
    store::LogEvent,
};
use std::collections::BTreeMap;

pub type LogSpan = (String, u64, Option<u64>, Option<i64>);

/// All calls must observe one transaction; the head covers committed log rows,
/// never merely an allocated sequence. Implementations do not authorize reads.
pub trait PartitionRows: Rows {
    fn next_seq(&self) -> Result<u64, RuntimeError>;
    fn append_log(
        &self,
        partition: &str,
        seq: u64,
        ord: u32,
        table: &str,
        kind: &str,
        id: &str,
        data: Option<&str>,
    ) -> Result<(), RuntimeError>;
    fn membership_transitions(&self, partition: &str, after: u64) -> Result<Vec<LogEvent>, RuntimeError>;
    fn memberships_before(&self, partition: &str, watermark: u64) -> Result<Vec<LogEvent>, RuntimeError>;
    fn commit_times(&self, sequences: &[u64]) -> Result<BTreeMap<u64, i64>, RuntimeError>;
    fn read_log_spans(&self, spans: &[LogSpan], after: u64, only_seq: Option<u64>, limit: usize) -> Result<Vec<LogEvent>, RuntimeError>;
    /// The first sequence of a content table's current group audience: the
    /// ledger's joins and scopes before it belong to an audience the table no
    /// longer syncs to (LLP 3000.036.000.000 §9). Zero when it never changed.
    fn audience_epoch(&self, _table: &str) -> Result<u64, RuntimeError> { Ok(0) }
    fn audience_epoch_time(&self, _table: &str) -> Result<Option<i64>, RuntimeError> { Ok(None) }
    /// A bounded per-table partition summary of one commit's events, kept
    /// beside the log by `append` (LLP 3000.041 §4.1); a store that keeps
    /// none publishes every commit as unattributed.
    fn record_commit_partitions(&self, _seq: u64, _summary: &str) -> Result<(), RuntimeError> { Ok(()) }
    /// The recorded summaries in (after, through], oldest first; None when
    /// this store keeps none.
    fn commit_partitions_between(&self, _after: u64, _through: u64, _limit: usize) -> Result<Option<Vec<(u64, String)>>, RuntimeError> { Ok(None) }
}

pub fn audience_epoch_time_key(table: &str) -> String { format!("audience_epoch_time:{table}") }

/// The meta key that records a content table's audience epoch.
pub fn audience_epoch_key(table: &str) -> String {
    format!("audience_epoch:{table}")
}
