//! SQLite delegation for the shared partition access contract.
use super::{LogEvent, Tx};
use crate::{
    RuntimeError,
    partition::{LogSpan, PartitionRows, audience_epoch_key, audience_epoch_time_key},
};
use std::collections::BTreeMap;

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
    fn membership_transitions(
        &self,
        partition: &str,
        after: u64,
    ) -> Result<Vec<LogEvent>, RuntimeError> {
        self.membership_transitions(partition, after)
    }
    fn memberships_before(
        &self,
        partition: &str,
        watermark: u64,
    ) -> Result<Vec<LogEvent>, RuntimeError> {
        self.memberships_before(partition, watermark)
    }
    fn commit_times(&self, sequences: &[u64]) -> Result<BTreeMap<u64, i64>, RuntimeError> {
        self.commit_times(sequences)
    }
    fn read_log_spans(
        &self,
        spans: &[LogSpan],
        after: u64,
        only_seq: Option<u64>,
        limit: usize,
    ) -> Result<Vec<LogEvent>, RuntimeError> {
        self.read_log_spans(spans, after, only_seq, limit)
    }
    fn audience_epoch_time(&self, table: &str) -> Result<Option<i64>, RuntimeError> {
        self.meta(&audience_epoch_time_key(table))?
            .map(|time| {
                time.parse()
                    .map_err(|_| RuntimeError::Store("invalid audience epoch time".into()))
            })
            .transpose()
    }
    fn audience_epoch(&self, table: &str) -> Result<u64, RuntimeError> {
        Ok(self
            .meta(&audience_epoch_key(table))?
            .and_then(|value| value.parse().ok())
            .unwrap_or(0))
    }
}
