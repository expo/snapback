//! Developer-owned, in-memory refusal context. Never part of Refusal or receipts.
// @ref LLP 3000.015#2.1 — only a host opt-in can collect the private refusing clause.
use super::runner::Runner;
use crate::{RuntimeError, schema::Effect};

#[cfg(feature = "sqlite")]
#[derive(Clone, Debug, serde::Serialize)]
pub struct RefusingClause {
    pub table: String,
    pub clause: String,
    pub phase: String,
    pub terminal: bool,
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
        self.refusing_phase(table, clause, clause);
    }
    pub(super) fn filtered_clause(&self, table: &str, clause: &str) {
        self.filtered_phase(table, clause, clause);
    }
    pub(super) fn filtered_phase(&self, table: &str, clause: &str, phase: &str) {
        self.record_clause(table, clause, phase, false);
    }
    pub(super) fn refusing_phase(&self, table: &str, clause: &str, phase: &str) {
        self.record_clause(table, clause, phase, true);
    }
    fn record_clause(&self, table: &str, clause: &str, phase: &str, terminal: bool) {
        #[cfg(feature = "sqlite")]
        if let Some(trace) = &self.context.refusal_trace {
            *trace.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(RefusingClause {
                table: table.into(), clause: clause.into(), phase: phase.into(), terminal, site: self.statement_site.clone(), generation: self.context.generation,
            });
        }
        #[cfg(not(feature = "sqlite"))]
        let _ = (table, clause, phase, terminal);
    }
    pub(super) fn trace_rule_result(&self, result: &Result<bool, RuntimeError>, table: &str, effect: Effect) {
        #[cfg(feature = "sqlite")]
        if self.context.refusal_trace.is_some() {
            let phase = format!("{effect} rule");
            if matches!(result, Ok(false)) { self.record_clause(table, &phase, &phase, effect != Effect::Read); }
            self.trace_authorization(result, table, effect, &phase);
        }
        #[cfg(not(feature = "sqlite"))]
        let _ = (result, table, effect);
    }
    /// Preserve the phase before enclosing writes remap the public error effect.
    pub(super) fn trace_authorization<T>(&self, result: &Result<T, RuntimeError>, table: &str, effect: Effect, phase: &str) {
        #[cfg(feature = "sqlite")]
        if self.context.refusal_trace.is_some() && matches!(result, Err(RuntimeError::AuthorizationBudget { .. })) {
            self.refusing_phase(table, &format!("authorization allowance ({effect})"), phase);
        }
        #[cfg(not(feature = "sqlite"))]
        let _ = (result, table, effect, phase);
    }
    pub(super) fn trace_unlocated_budget(&self, table: &str, effect: Effect) {
        #[cfg(feature = "sqlite")]
        if self.context.refusal_trace.as_ref().is_some_and(|trace| trace.0.lock().unwrap_or_else(|e|e.into_inner()).as_ref().is_none_or(|cause| !cause.clause.starts_with("authorization allowance"))) {
            self.refusing_phase(table, &format!("authorization allowance ({effect})"), "authorization access");
        }
        #[cfg(not(feature = "sqlite"))]
        let _ = (table, effect);
    }
    pub(super) fn rule_refusal(&self, table: &str, effect: Effect, clause: &str) -> RuntimeError {
        self.refusing_clause(table, clause);
        RuntimeError::Rule { table: table.into(), effect }
    }
}
