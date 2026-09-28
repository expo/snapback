//! Developer-owned, in-memory refusal context. Never part of Refusal or receipts.
// @ref LLP 3000.015#2.1 — only a host opt-in can collect the private refusing clause.
use super::runner::Runner;
use crate::{RuntimeError, schema::Effect};

#[cfg(feature = "sqlite")]
#[derive(Clone, Debug, serde::Serialize)]
pub struct RefusingClause {
    pub table: String,
    pub clause: String,
    pub site: String,
    pub generation: u64,
}
#[cfg(feature = "sqlite")]
#[derive(Clone, Debug, Default)]
pub struct RefusalTrace(std::sync::Arc<std::sync::Mutex<Option<RefusingClause>>>);
#[cfg(feature = "sqlite")]
impl RefusalTrace {
    pub fn take(&self) -> Option<RefusingClause> { self.0.lock().unwrap_or_else(|e| e.into_inner()).take() }
}
impl Runner<'_> {
    pub(super) fn refusing_clause(&self, table: &str, clause: &str) {
        #[cfg(feature = "sqlite")]
        if let Some(trace) = &self.context.refusal_trace {
            *trace.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(RefusingClause {
                table: table.into(), clause: clause.into(), site: self.statement_site.clone(), generation: self.context.generation,
            });
        }
        #[cfg(not(feature = "sqlite"))]
        let _ = (table, clause);
    }
    pub(super) fn rule_refusal(&self, table: &str, effect: Effect, clause: &str) -> RuntimeError {
        self.refusing_clause(table, clause);
        RuntimeError::Rule { table: table.into(), effect }
    }
}
