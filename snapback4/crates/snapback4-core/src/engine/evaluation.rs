//! Opt-in standalone evaluation of the common Engine, never production retry policy.
// @ref LLP 3000.009.001.000#3.4 — keep physical statistics outside logical outcome parity.
use super::Engine;
use crate::meter::Metered;
#[cfg(feature = "postgres")]
use crate::{Program, Schema, RuntimeError, store_port::AnyStore};

impl Engine {
    /// Reserve allowance before the first logical charge, for exhaustive cut probes.
    pub fn set_evaluation_precharge(&mut self, used: Metered) { self.evaluation_precharge = used; }
}
#[cfg(feature = "postgres")]
impl Engine {
    /// Only isolated evaluator namespaces are admitted by these convenience constructors.
    pub fn create_postgres_evaluation(config: postgres::Config, name: &str, schema: Schema, programs: impl IntoIterator<Item = Program>) -> Result<Self, RuntimeError> {
        super::postgres::evaluation_namespace(name)?;
        Self::new(AnyStore::evaluation_postgres(config, name, true)?, schema, programs)
    }
    pub fn open_postgres_evaluation(config: postgres::Config, name: &str) -> Result<Self, RuntimeError> {
        super::postgres::evaluation_namespace(name)?;
        Self::open(AnyStore::evaluation_postgres(config, name, false)?)
    }
    pub fn set_evaluation_prefetch(&mut self, enabled: bool) { self.store.evaluation_prefetch(enabled); }
    /// Explicit driver calls (including cold prepares), never packets. No retries are performed.
    pub fn evaluation_stats(&self) -> Result<super::postgres::Stats, RuntimeError> { self.store.evaluation_stats() }
}
