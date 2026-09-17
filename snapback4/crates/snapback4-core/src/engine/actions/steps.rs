//! The action adapter for the shared durable external-step policy.
//!
//! Authority is established on the caller's writer transaction before this
//! adapter borrows it; step mutation and action finishing therefore have no
//! commit gap.

use super::*;
use crate::engine::steps::{self as step_core, PreparedBegin, StepClaim, StepOwner, StepRecord, StepState, StepTransaction, Transition};

pub(super) fn initialize(conn: &Connection) -> Result<(), RuntimeError> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS _action_steps (
        invocation TEXT NOT NULL, name TEXT NOT NULL, input_digest TEXT NOT NULL,
        provider_key TEXT NOT NULL, state TEXT NOT NULL, claim_digest TEXT NOT NULL,
        result TEXT, at INTEGER NOT NULL, settled_at INTEGER, error TEXT,
        PRIMARY KEY(invocation, name));")?;
    Ok(())
}

pub use crate::engine::steps::Step as ActionStep;

struct ActionStepTransaction<'tx, 'store> {
    tx: &'tx Tx<'store>,
}

impl StepTransaction for ActionStepTransaction<'_, '_> {
    fn record(&self, owner: StepOwner<'_>, name: &str) -> Result<Option<StepRecord>, RuntimeError> {
        debug_assert_eq!(owner.kind, step_core::WorkKind::Action);
        let row: Option<(String, String, String, String, Option<String>)> = self.tx.conn().query_row(
            "SELECT input_digest, provider_key, state, claim_digest, result FROM _action_steps WHERE invocation = ?1 AND name = ?2",
            params![owner.id, name],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).optional()?;
        row.map(|(input_digest, provider_key, state, claim, result)| Ok(StepRecord {
            input_digest,
            provider_key,
            state: StepState::from_stored(state),
            claim: StepClaim::from_digest(claim),
            result: result.map(|text| serde_json::from_str(&text).map_err(|_| RuntimeError::Store("invalid persisted step result".into()))).transpose()?,
        })).transpose()
    }

    fn insert(&mut self, owner: StepOwner<'_>, step: &PreparedBegin<'_>, at: i64) -> Result<(), RuntimeError> {
        self.tx.conn().execute(
            "INSERT INTO _action_steps(invocation, name, input_digest, provider_key, state, claim_digest, at) VALUES (?1, ?2, ?3, ?4, 'started', ?5, ?6)",
            params![owner.id, step.name, step.input_digest(), step.provider_key(), step.claim().digest(), at],
        )?;
        Ok(())
    }

    fn take_over(&mut self, owner: StepOwner<'_>, name: &str, claim: &StepClaim) -> Result<(), RuntimeError> {
        self.tx.conn().execute(
            "UPDATE _action_steps SET state = 'started', claim_digest = ?3, error = NULL WHERE invocation = ?1 AND name = ?2",
            params![owner.id, name, claim.digest()],
        )?;
        Ok(())
    }

    fn complete(&mut self, owner: StepOwner<'_>, name: &str, result: &str, at: i64) -> Result<(), RuntimeError> {
        self.tx.conn().execute(
            "UPDATE _action_steps SET state = 'done', result = ?3, settled_at = ?4, error = NULL WHERE invocation = ?1 AND name = ?2",
            params![owner.id, name, result, at],
        )?;
        Ok(())
    }

    fn park(&mut self, owner: StepOwner<'_>, name: &str, error: &str) -> Result<(), RuntimeError> {
        self.tx.conn().execute(
            "UPDATE _action_steps SET state = 'parked', error = ?3 WHERE invocation = ?1 AND name = ?2",
            params![owner.id, name, error],
        )?;
        Ok(())
    }

    fn finish_parked(&mut self, owner: StepOwner<'_>, code: &str, error: &str, at: i64) -> Result<(), RuntimeError> {
        finish(self.tx, owner.id, "parked", code, error, at)
    }
}

fn apply<T>(tx: Tx<'_>, transition: Result<Transition<T>, RuntimeError>) -> Result<T, RuntimeError> {
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
        let transition = step_core::begin(&mut ActionStepTransaction { tx: &tx }, owner, &prepared, now);
        apply(tx, transition)
    }

    pub fn complete_action_step(&mut self, id: &str, worker: &str, lease: &str, name: &str, result: &Json, now: i64) -> Result<ActionStep, RuntimeError> {
        let owner = StepOwner::action(id);
        let prepared = step_core::prepare_result(lease, name, result, self.ceilings.output_bytes)?;
        let tx = self.store.transaction()?;
        held_claim_authority(&tx, id, worker, lease, now)?;
        let transition = step_core::complete(&mut ActionStepTransaction { tx: &tx }, owner, &prepared, now);
        apply(tx, transition)
    }

    pub fn park_action_step(&mut self, id: &str, worker: &str, lease: &str, name: &str, error: &str, now: i64) -> Result<(), RuntimeError> {
        step_core::prepare_park(name)?;
        let owner = StepOwner::action(id);
        let claim = StepClaim::from_token(lease);
        let tx = self.store.transaction()?;
        held_claim_authority(&tx, id, worker, lease, now)?;
        let transition = step_core::park(&mut ActionStepTransaction { tx: &tx }, owner, claim, name, error, now);
        apply(tx, transition)
    }
}
