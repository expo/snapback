//! Storage operations needed by the shared authorization and sync algorithm.
//! @ref LLP 3000#7-decisions-during-execution — experimental Postgres shares partition semantics
use crate::{
    error::RuntimeError,
    rows::Rows,
    store::{LogEvent, Tx},
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
}

/// The meta key that records a content table's audience epoch.
pub fn audience_epoch_key(table: &str) -> String {
    format!("audience_epoch:{table}")
}

impl PartitionRows for Tx<'_> {
    fn next_seq(&self) -> Result<u64, RuntimeError> {
        self.next_seq()
    }
    fn append_log(
        &self,
        partition: &str,
        seq: u64,
        ord: u32,
        table: &str,
        kind: &str,
        id: &str,
        data: Option<&str>,
    ) -> Result<(), RuntimeError> {
        self.append_log(partition, seq, ord, table, kind, id, data)
    }
    fn membership_transitions(&self, partition: &str, after: u64) -> Result<Vec<LogEvent>, RuntimeError> {
        self.membership_transitions(partition, after)
    }
    fn memberships_before(&self, partition: &str, watermark: u64) -> Result<Vec<LogEvent>, RuntimeError> {
        self.memberships_before(partition, watermark)
    }
    fn commit_times(&self, sequences: &[u64]) -> Result<BTreeMap<u64, i64>, RuntimeError> {
        self.commit_times(sequences)
    }
    fn read_log_spans(&self, spans: &[LogSpan], after: u64, only_seq: Option<u64>, limit: usize) -> Result<Vec<LogEvent>, RuntimeError> {
        self.read_log_spans(spans, after, only_seq, limit)
    }
    fn audience_epoch(&self, table: &str) -> Result<u64, RuntimeError> {
        Ok(self.meta(&audience_epoch_key(table))?.and_then(|value| value.parse().ok()).unwrap_or(0))
    }
}
