//! Opt-in standalone evaluation of the common Engine, never production retry policy.
// @ref LLP 3000.009.001.000#3.4 — keep physical statistics outside logical outcome parity.
use super::Engine;
use crate::meter::Metered;

impl Engine {
    /// Reserve allowance before the first logical charge, for exhaustive cut probes.
    pub fn set_evaluation_precharge(&mut self, used: Metered) { self.evaluation_precharge = used; }
}
