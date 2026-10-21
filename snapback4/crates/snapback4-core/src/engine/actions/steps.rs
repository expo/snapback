//! Action authority and commit orchestration for durable external steps.
//!
//! Authority is established on the caller's writer transaction before this
//! adapter borrows it; step mutation and action finishing therefore have no
//! commit gap.

use super::*;
use crate::engine::steps::{self as step_core, StepClaim, StepOwner, Transition};

pub use crate::engine::steps::Step as ActionStep;

fn apply<T>(tx: AnyTx<'_>, transition: Result<Transition<T>, RuntimeError>) -> Result<T, RuntimeError> {
    match transition? {
        Transition::Applied(value) => { tx.commit()?; Ok(value) }
        Transition::Refused(error) => Err(error),
        Transition::ClaimLost => Err(lease_error()),
        Transition::CommitRefusal(error) => { tx.commit()?; Err(error) }
    }
}

impl Engine {
    pub fn begin_action_step(&mut self, id: &str, worker: &str, lease: &str, name: &str, input: &Json, reconcile: bool, now: i64) -> Result<ActionStep, RuntimeError> {
        let owner = StepOwner::action(id);
        let prepared = step_core::prepare_begin(owner, lease, name, input, reconcile, self.ceilings.heap_bytes)?;
        let tx = self.store.transaction()?;
        held_claim_authority(&tx, id, worker, lease, now)?;
        let transition = step_core::begin(&mut tx.action_steps(), owner, &prepared, now);
        apply(tx, transition)
    }

    pub fn complete_action_step(&mut self, id: &str, worker: &str, lease: &str, name: &str, result: &Json, now: i64) -> Result<ActionStep, RuntimeError> {
        let owner = StepOwner::action(id);
        let prepared = step_core::prepare_result(lease, name, result, self.ceilings.output_bytes)?;
        let tx = self.store.transaction()?;
        held_claim_authority(&tx, id, worker, lease, now)?;
        let transition = step_core::complete(&mut tx.action_steps(), owner, &prepared, now);
        apply(tx, transition)
    }

    pub fn park_action_step(&mut self, id: &str, worker: &str, lease: &str, name: &str, error: &str, now: i64) -> Result<(), RuntimeError> {
        let owner = StepOwner::action(id);
        let claim = StepClaim::from_token(lease);
        let tx = self.store.transaction()?;
        held_claim_authority(&tx, id, worker, lease, now)?;
        let transition = step_core::park(&mut tx.action_steps(), owner, claim, name, error, now);
        apply(tx, transition)
    }
}
