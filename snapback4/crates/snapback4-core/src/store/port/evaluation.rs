//! Evaluation configuration over the common store; no raw connection escapes.
// @ref LLP 3000.009.001.000#3.4 — evaluation switches never authorize production retries.
use super::{AnyStore, handles::SqliteStore};
#[cfg(feature = "postgres")]
use crate::{Program, Schema, RuntimeError, engine::postgres::{Handle, Stats}};
#[cfg(feature = "postgres")]
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

impl AnyStore {
    /// Typed SQLite seed snapshots for the differential evaluator. Postgres
    /// keeps its separate harness-owned namespace snapshot/reset implementation.
    pub fn evaluation_snapshot(&self, error_chain: impl Fn(&str, &(dyn std::error::Error + 'static)) -> String) -> Result<crate::store::evaluation::Snapshot, String> {
        match self {
            Self::Sqlite(SqliteStore(store)) => crate::store::evaluation::Snapshot::capture(store, error_chain),
            #[cfg(feature = "postgres")]
            Self::Postgres(_) => Err(crate::RuntimeError::StoreUnsupported { family: "evaluation-snapshot" }.to_string()),
        }
    }
    pub fn restore_evaluation_snapshot(&self, snapshot: &crate::store::evaluation::Snapshot, error_chain: impl Fn(&str, &(dyn std::error::Error + 'static)) -> String) -> Result<(), String> {
        match self {
            Self::Sqlite(SqliteStore(store)) => snapshot.restore(store, error_chain),
            #[cfg(feature = "postgres")]
            Self::Postgres(_) => Err(crate::RuntimeError::StoreUnsupported { family: "evaluation-snapshot" }.to_string()),
        }
    }
}

// @ref LLP 3000.009.001.000#32-the-rule — native evaluation configuration and statistics stay below the store port.
#[cfg(feature = "postgres")]
impl crate::engine::Engine {
    /// Only isolated evaluator namespaces are admitted by these convenience constructors.
    pub fn create_postgres_evaluation(config: postgres::Config, name: &str, schema: Schema, programs: impl IntoIterator<Item = Program>) -> Result<Self, RuntimeError> {
        crate::engine::postgres::evaluation_namespace(name)?;
        Self::new(AnyStore::evaluation_postgres(config, name, true)?, schema, programs)
    }
    pub fn open_postgres_evaluation(config: postgres::Config, name: &str) -> Result<Self, RuntimeError> {
        crate::engine::postgres::evaluation_namespace(name)?;
        Self::open(AnyStore::evaluation_postgres(config, name, false)?)
    }
    pub fn set_evaluation_prefetch(&mut self, enabled: bool) { self.store_mut().evaluation_prefetch(enabled); }
    /// Explicit driver calls (including cold prepares), never packets. No retries are performed.
    pub fn evaluation_stats(&self) -> Result<crate::engine::postgres::Stats, RuntimeError> { self.store().evaluation_stats() }
}
