//! Durable commit records, independent of the physical store.
// @ref LLP 3000.009.001.000#3.4 — commit recording and bounded ledger reads have an explicit family.
use crate::RuntimeError;

pub trait LedgerReader {
    fn commits_after(&self, after: u64, limit: usize) -> Result<Vec<(u64, Vec<String>)>, RuntimeError>;
}
pub(crate) trait LedgerTransaction: LedgerReader {
    fn record_commit(&self, seq: u64, at: i64, program: &str, principal: &str, kind: &str, touched: &[String], writes: u64) -> Result<(), RuntimeError>;
}
