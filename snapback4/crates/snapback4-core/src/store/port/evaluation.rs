//! Evaluation configuration over the common store; no raw connection escapes.
// @ref LLP 3000.009.001.000#3.4 — evaluation switches never authorize production retries.
use super::AnyStore;
use crate::{RuntimeError, engine::postgres::{Handle, Stats}};
impl AnyStore {
    pub(crate) fn evaluation_postgres(config: postgres::Config, name: &str, fresh: bool) -> Result<Self, RuntimeError> {
        Handle::connect(config, name, fresh).map(Self::from_postgres)
    }
    pub(crate) fn evaluation_prefetch(&mut self, enabled: bool) {
        if let Self::Postgres(payload) = self { payload.0.store.get_mut().prefetch = enabled; }
    }
    pub(crate) fn evaluation_stats(&self) -> Result<Stats, RuntimeError> {
        match self {
            Self::Sqlite(_) => Ok(Stats::default()),
            Self::Postgres(payload) => {
                let store = payload.0.borrow()?;
                Ok(Stats { database_calls: store.calls.get(), transaction_retries: 0,
                    prefetch_marked_reads: store.marked_reads.get(), prefetch_page_reads: store.page_reads.get(),
                    prefetch_rows_transferred: store.prefetch_rows.get(), prefetch_bytes_transferred: store.prefetch_bytes.get() })
            }
        }
    }
}
