//! SQLite adapters for the shared durable external-step policy.
//! Borrow the authorized writer transaction so parent finishing has no commit gap.
// @ref LLP 3000.009.001.000#3.3 — only access moves; engine/steps retains the transitions.
use super::Tx;
use crate::{
    RuntimeError,
    engine::steps::{
        self as step_core, PreparedBegin, StepClaim, StepOwner, StepRecord, StepState,
        StepTransaction,
    },
};
use rusqlite::{Connection, OptionalExtension, params};

pub(crate) fn initialize_actions(conn: &Connection) -> Result<(), RuntimeError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _action_steps (
        invocation TEXT NOT NULL, name TEXT NOT NULL, input_digest TEXT NOT NULL,
        provider_key TEXT NOT NULL, state TEXT NOT NULL, claim_digest TEXT NOT NULL,
        result TEXT, at INTEGER NOT NULL, settled_at INTEGER, error TEXT,
        PRIMARY KEY(invocation, name));",
    )?;
    Ok(())
}

pub(crate) struct ActionStepTransaction<'tx, 'store> {
    pub(crate) tx: &'tx Tx<'store>,
}

impl StepTransaction for ActionStepTransaction<'_, '_> {
    fn record(&self, owner: StepOwner<'_>, name: &str) -> Result<Option<StepRecord>, RuntimeError> {
        debug_assert_eq!(owner.kind, step_core::WorkKind::Action);
        let row: Option<(String, String, String, String, Option<String>)> = self.tx.conn().query_row(
            "SELECT input_digest, provider_key, state, claim_digest, result FROM _action_steps WHERE invocation = ?1 AND name = ?2",
            params![owner.id, name],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).optional()?;
        row.map(|(input_digest, provider_key, state, claim, result)| {
            Ok(StepRecord {
                input_digest,
                provider_key,
                state: StepState::from_stored(state),
                claim: StepClaim::from_digest(claim),
                result: result
                    .map(|text| {
                        serde_json::from_str(&text).map_err(|_| {
                            RuntimeError::Store("invalid persisted step result".into())
                        })
                    })
                    .transpose()?,
            })
        })
        .transpose()
    }

    fn insert(
        &mut self,
        owner: StepOwner<'_>,
        step: &PreparedBegin<'_>,
        at: i64,
    ) -> Result<(), RuntimeError> {
        self.tx.conn().execute(
            "INSERT INTO _action_steps(invocation, name, input_digest, provider_key, state, claim_digest, at) VALUES (?1, ?2, ?3, ?4, 'started', ?5, ?6)",
            params![owner.id, step.name, step.input_digest(), step.provider_key(), step.claim().digest(), at],
        )?;
        Ok(())
    }

    fn take_over(
        &mut self,
        owner: StepOwner<'_>,
        name: &str,
        claim: &StepClaim,
    ) -> Result<(), RuntimeError> {
        self.tx.conn().execute(
            "UPDATE _action_steps SET state = 'started', claim_digest = ?3, error = NULL WHERE invocation = ?1 AND name = ?2",
            params![owner.id, name, claim.digest()],
        )?;
        Ok(())
    }

    fn complete(
        &mut self,
        owner: StepOwner<'_>,
        name: &str,
        result: &str,
        at: i64,
    ) -> Result<(), RuntimeError> {
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

    fn finish_parked(
        &mut self,
        owner: StepOwner<'_>,
        code: &str,
        error: &str,
        at: i64,
    ) -> Result<(), RuntimeError> {
        crate::engine::actions::finish(self.tx, owner.id, "parked", code, error, at)
    }
}

pub(crate) struct EffectStepTransaction<'tx, 'store> {
    pub(crate) tx: &'tx Tx<'store>,
}

impl StepTransaction for EffectStepTransaction<'_, '_> {
    fn record(&self, owner: StepOwner<'_>, name: &str) -> Result<Option<StepRecord>, RuntimeError> {
        debug_assert_eq!(owner.kind, step_core::WorkKind::Effect);
        let row: Option<(String, String, String, String, Option<String>)> = self.tx.conn().query_row(
            "SELECT input_digest, provider_key, state, claim_digest, result FROM _effect_steps WHERE effect_id = ?1 AND name = ?2",
            params![owner.id, name],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).optional()?;
        row.map(|(input_digest, provider_key, state, claim, result)| {
            Ok(StepRecord {
                input_digest,
                provider_key,
                state: StepState::from_stored(state),
                claim: StepClaim::from_digest(claim),
                result: result
                    .map(|text| {
                        serde_json::from_str(&text).map_err(|_| {
                            RuntimeError::Store("invalid persisted effect step result".into())
                        })
                    })
                    .transpose()?,
            })
        })
        .transpose()
    }

    fn insert(
        &mut self,
        owner: StepOwner<'_>,
        step: &PreparedBegin<'_>,
        at: i64,
    ) -> Result<(), RuntimeError> {
        self.tx.conn().execute(
            "INSERT INTO _effect_steps(effect_id, name, input_digest, provider_key, state, claim_digest, at) VALUES (?1, ?2, ?3, ?4, 'started', ?5, ?6)",
            params![owner.id, step.name, step.input_digest(), step.provider_key(), step.claim().digest(), at],
        )?;
        Ok(())
    }

    fn take_over(
        &mut self,
        owner: StepOwner<'_>,
        name: &str,
        claim: &StepClaim,
    ) -> Result<(), RuntimeError> {
        self.tx.conn().execute("UPDATE _effect_steps SET state = 'started', claim_digest = ?3, error = NULL WHERE effect_id = ?1 AND name = ?2", params![owner.id, name, claim.digest()])?;
        Ok(())
    }

    fn complete(
        &mut self,
        owner: StepOwner<'_>,
        name: &str,
        result: &str,
        at: i64,
    ) -> Result<(), RuntimeError> {
        self.tx.conn().execute("UPDATE _effect_steps SET state = 'done', result = ?3, settled_at = ?4, error = NULL WHERE effect_id = ?1 AND name = ?2", params![owner.id, name, result, at])?;
        Ok(())
    }

    fn park(&mut self, owner: StepOwner<'_>, name: &str, error: &str) -> Result<(), RuntimeError> {
        self.tx.conn().execute("UPDATE _effect_steps SET state = 'parked', error = ?3 WHERE effect_id = ?1 AND name = ?2", params![owner.id, name, error])?;
        Ok(())
    }

    fn finish_parked(
        &mut self,
        owner: StepOwner<'_>,
        code: &str,
        error: &str,
        at: i64,
    ) -> Result<(), RuntimeError> {
        // The shared code is authoritative: uncertainty is E_STEP_PARKED,
        // while an oversized recorded result is E_STEP_RESULT.
        self.tx.conn().execute("UPDATE _outbox SET state = 'parked', error_code = ?2, error = ?3, settled_at = ?4, lease_until = NULL, claimed_by = NULL, lease_digest = NULL, next_at = NULL WHERE id = ?1", params![owner.id, code, error, at])?;
        Ok(())
    }
}
