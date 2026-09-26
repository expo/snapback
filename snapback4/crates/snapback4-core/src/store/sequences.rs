//! Sequence custody starts with activation/allocation, never a legacy open.
// @ref LLP 3000.017#3.6-what-does-not-change-and-what-the-lock-claims-are — preserve published capability fences.
use super::*;

impl Tx<'_> {
    pub(super) fn has_sequence_table(&self) -> Result<bool, RuntimeError> {
        Ok(self.conn().prepare_cached("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sequences')")?.query_row([], |r| r.get(0))?)
    }
    pub(super) fn ensure_sequence_table(&self) -> Result<(), RuntimeError> {
        self.conn().execute_batch("CREATE TABLE IF NOT EXISTS _sequences (parent TEXT NOT NULL, id TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY(parent, id)) WITHOUT ROWID;")?;
        Ok(())
    }
}
