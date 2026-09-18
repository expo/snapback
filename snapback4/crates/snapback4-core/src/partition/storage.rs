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
}
