//! SQLite adapter for effect-owned durable external steps.
//!
//! The shared step kernel owns every transition. This adapter only maps those
//! decisions onto `_effect_steps` and parks the parent effect atomically.

use super::{Engine, effects::{self, EffectStep}, steps::{self as step_core, PreparedBegin, StepClaim, StepOwner, StepRecord, StepState, StepTransaction, Transition}};
use crate::{RuntimeError, identity, store::Tx};
use rusqlite::{OptionalExtension, params};
use serde_json::Value as Json;

struct EffectStepTransaction<'tx, 'store> { tx: &'tx Tx<'store> }

impl StepTransaction for EffectStepTransaction<'_, '_> {
    fn record(&self, owner: StepOwner<'_>, name: &str) -> Result<Option<StepRecord>, RuntimeError> {
        debug_assert_eq!(owner.kind, step_core::WorkKind::Effect);
        let row: Option<(String, String, String, String, Option<String>)> = self.tx.conn().query_row(
            "SELECT input_digest, provider_key, state, claim_digest, result FROM _effect_steps WHERE effect_id = ?1 AND name = ?2",
            params![owner.id, name],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).optional()?;
        row.map(|(input_digest, provider_key, state, claim, result)| Ok(StepRecord {
            input_digest, provider_key, state: StepState::from_stored(state), claim: StepClaim::from_digest(claim),
            result: result.map(|text| serde_json::from_str(&text).map_err(|_| RuntimeError::Store("invalid persisted effect step result".into()))).transpose()?,
        })).transpose()
    }

    fn insert(&mut self, owner: StepOwner<'_>, step: &PreparedBegin<'_>, at: i64) -> Result<(), RuntimeError> {
        self.tx.conn().execute(
            "INSERT INTO _effect_steps(effect_id, name, input_digest, provider_key, state, claim_digest, at) VALUES (?1, ?2, ?3, ?4, 'started', ?5, ?6)",
            params![owner.id, step.name, step.input_digest(), step.provider_key(), step.claim().digest(), at],
        )?;
        Ok(())
    }

    fn take_over(&mut self, owner: StepOwner<'_>, name: &str, claim: &StepClaim) -> Result<(), RuntimeError> {
        self.tx.conn().execute("UPDATE _effect_steps SET state = 'started', claim_digest = ?3, error = NULL WHERE effect_id = ?1 AND name = ?2", params![owner.id, name, claim.digest()])?;
        Ok(())
    }

    fn complete(&mut self, owner: StepOwner<'_>, name: &str, result: &str, at: i64) -> Result<(), RuntimeError> {
        self.tx.conn().execute("UPDATE _effect_steps SET state = 'done', result = ?3, settled_at = ?4, error = NULL WHERE effect_id = ?1 AND name = ?2", params![owner.id, name, result, at])?;
        Ok(())
    }

    fn park(&mut self, owner: StepOwner<'_>, name: &str, error: &str) -> Result<(), RuntimeError> {
        self.tx.conn().execute("UPDATE _effect_steps SET state = 'parked', error = ?3 WHERE effect_id = ?1 AND name = ?2", params![owner.id, name, error])?;
        Ok(())
    }

    fn finish_parked(&mut self, owner: StepOwner<'_>, code: &str, error: &str, at: i64) -> Result<(), RuntimeError> {
        // The shared code is authoritative: uncertainty is E_STEP_PARKED,
        // while an oversized recorded result is E_STEP_RESULT.
        self.tx.conn().execute("UPDATE _outbox SET state = 'parked', error_code = ?2, error = ?3, settled_at = ?4, lease_until = NULL, claimed_by = NULL, lease_digest = NULL, next_at = NULL WHERE id = ?1", params![owner.id, code, error, at])?;
        Ok(())
    }
}

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
