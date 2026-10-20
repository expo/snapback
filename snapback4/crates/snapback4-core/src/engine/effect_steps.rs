//! Effect authority and commit orchestration for durable external steps.
//!
//! The shared step kernel owns every transition; the store adapter applies it
//! and parks the parent effect atomically in the authorized transaction.

use super::{Engine, effects::{self, EffectStep}, steps::{self as step_core, StepClaim, StepOwner, Transition}};
use crate::{RuntimeError, identity, store::Tx};
use crate::store::steps::EffectStepTransaction;
use serde_json::Value as Json;

fn apply<T>(tx: Tx<'_>, transition: Result<Transition<T>, RuntimeError>) -> Result<T, RuntimeError> {
    match transition? {
        Transition::Applied(value) => { tx.commit()?; Ok(value) }
        Transition::Refused(error) => Err(error),
        Transition::ClaimLost => Err(RuntimeError::Structural { code: "E_EFFECT_LEASE", message: "this effect step does not belong to the current claim".into() }),
        Transition::CommitRefusal(error) => { tx.commit()?; Err(error) }
    }
}

impl Engine {
    // @ref LLP 3000.009#5.2 — current service, admitted declaration, claim fence and step transition share one transaction.
    pub fn begin_effect_step_strict(&mut self, service_token: &str, id: &str, lease: &str, name: &str, input: &Json, reconcile: bool, sample: impl FnOnce() -> identity::ServiceSample) -> Result<EffectStep, RuntimeError> {
        let owner = StepOwner::effect(id);
        let prepared = step_core::prepare_begin(owner, lease, name, input, reconcile, self.ceilings.heap_bytes)?;
        let tx = self.store.transaction()?;
        let sample = sample();
        let worker = identity::current_service_tx(&tx, service_token, sample)?.ok_or_else(effects::auth_error)?;
        let run = effects::strict_run(&tx, id)?;
        if !effects::contract_stands(&tx, &self.schema, &run, sample.now)? { tx.commit()?; return Err(effects::generation_error()); }
        effects::held_strict_claim(&tx, &run, &worker, lease, sample.now)?;
        let transition = step_core::begin(&mut EffectStepTransaction { tx: &tx }, owner, &prepared, sample.now);
        apply(tx, transition)
    }

    pub fn complete_effect_step_strict(&mut self, service_token: &str, id: &str, lease: &str, name: &str, result: &Json, sample: impl FnOnce() -> identity::ServiceSample) -> Result<EffectStep, RuntimeError> {
        let owner = StepOwner::effect(id);
        let prepared = step_core::prepare_result(lease, name, result, self.ceilings.output_bytes)?;
        let tx = self.store.transaction()?;
        let sample = sample();
        let worker = identity::current_service_tx(&tx, service_token, sample)?.ok_or_else(effects::auth_error)?;
        let run = effects::strict_run(&tx, id)?;
        if !effects::contract_stands(&tx, &self.schema, &run, sample.now)? { tx.commit()?; return Err(effects::generation_error()); }
        effects::held_strict_claim(&tx, &run, &worker, lease, sample.now)?;
        let transition = step_core::complete(&mut EffectStepTransaction { tx: &tx }, owner, &prepared, sample.now);
        apply(tx, transition)
    }

    pub fn park_effect_step_strict(&mut self, service_token: &str, id: &str, lease: &str, name: &str, error: &str, sample: impl FnOnce() -> identity::ServiceSample) -> Result<(), RuntimeError> {
        step_core::prepare_park(name)?;
        let owner = StepOwner::effect(id);
        let claim = StepClaim::from_token(lease);
        let tx = self.store.transaction()?;
        let sample = sample();
        let worker = identity::current_service_tx(&tx, service_token, sample)?.ok_or_else(effects::auth_error)?;
        let run = effects::strict_run(&tx, id)?;
        if !effects::contract_stands(&tx, &self.schema, &run, sample.now)? { tx.commit()?; return Err(effects::generation_error()); }
        effects::held_strict_claim(&tx, &run, &worker, lease, sample.now)?;
        let transition = step_core::park(&mut EffectStepTransaction { tx: &tx }, owner, claim, name, error, sample.now);
        apply(tx, transition)
    }
}
