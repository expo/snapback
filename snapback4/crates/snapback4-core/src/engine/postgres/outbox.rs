//! Postgres outbox facts and transitions; shared effects policy owns refusals.
// @ref LLP 3000.009.001.000#91-adapter-parity-rules — head-fenced writes, typed limits and explicit result shapes.
use super::store::{Tx, signed};
use crate::metadata::{MetadataReader, DevMetadata};
use crate::{RuntimeError, engine::effects::{EffectRun, NewEffect, ExpiredEffect, OutboxTransaction, legacy_work}, value::{Value, canonical_json}};

macro_rules! runs {
    ($suffix:literal) => { concat!("SELECT id, effect, payload, state, attempts, seq, at, next_at, lease_until, claimed_by, result, error, work_spec, deadline, release, error_code, cancelled, contract FROM _outbox ", $suffix) };
}

pub(super) use runs;

// @ref LLP 3000.009.001.000#91-adapter-parity-rules — impossible Postgres keys are absent without a statement.
pub(super) fn absent_key(key: Option<&str>) -> bool {
    key.is_some_and(|key| key.contains('\0'))
}

pub(super) fn read_run(row: super::store::Row) -> Result<EffectRun, RuntimeError> {
    let payload: &str = row.get(2);
    let result: Option<&str> = row.get(10);
    let work: Option<&str> = row.get(12);
    Ok(EffectRun {
        id: row.get(0), effect: row.get(1), payload: serde_json::from_str(payload).unwrap_or(Value::Null),
        state: row.get(3), attempts: row.get::<_, i64>(4) as u32, seq: row.get::<_, i64>(5) as u64,
        at: row.get(6), next_at: row.get(7), lease_until: row.get(8), claimed_by: row.get(9),
        result: result.and_then(|text| serde_json::from_str(text).ok()), error: row.get(11),
        work: work.map(super::store::decode).transpose()?.unwrap_or_else(legacy_work),
        deadline: row.get(13), release: row.get(14), error_code: row.get(15), cancelled: row.get(16),
        contract: row.get(17), declaration_contract: None, lease_token: None,
    })
}

impl OutboxTransaction for Tx<'_> {
    fn replay_suppresses(&self) -> Result<bool, RuntimeError> {
        Ok(self.dev_value(DevMetadata::Replay)?.as_deref() == Some("true") && self.release_value()?.is_none())
    }
    fn suppress_effects(&self, count: usize) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("suppress effects")?;
        self.execute_one("INSERT INTO _meta(key,value) VALUES ('dev:suppressed-effects',$1) ON CONFLICT(key) DO UPDATE SET value = ((_meta.value::bigint) + (excluded.value::bigint))::text", &[&count.to_string()])?;
        Ok(())
    }
    fn effect_release(&self) -> Result<Option<String>, RuntimeError> {
        self.release_value()
    }
    fn insert_effect(&self, effect: &NewEffect<'_>) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("insert effect")?;
        self.ensure_active()?;
        {
            let mut tail = self.tail.borrow_mut();
            if let Some(commit) = &tail.commit {
                if commit.seq != effect.seq || commit.at != effect.now { return Err(RuntimeError::Store("effect does not match commit tail".into())); }
                tail.effects.push(super::tail::Effect {
                    id: effect.id.into(), effect: effect.effect.into(), payload: canonical_json(effect.payload),
                    next_at: effect.next_at, work: canonical_json(effect.work), deadline: effect.deadline,
                    contract: effect.contract.into(), presence: Vec::new(), release: Some(effect.release.map(str::to_owned)),
                });
                return Ok(());
            }
        }
        self.execute_one("INSERT INTO _outbox(id,seq,effect,payload,state,attempts,at,next_at,work_spec,deadline,release,contract) VALUES ($1,$2,$3,$4,'queued',0,$5,$6,$7,$8,$9,$10)", &[&effect.id, &signed(effect.seq)?, &effect.effect, &canonical_json(effect.payload), &effect.now, &effect.next_at, &canonical_json(effect.work), &effect.deadline, &effect.release, &effect.contract])?;
        Ok(())
    }
    fn insert_effect_presence(&self, principal: &str, id: &str, deadline: i64) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("insert effect presence")?;
        self.ensure_active()?;
        if let Some(effect) = self.tail.borrow_mut().effects.iter_mut().find(|e| e.id == id) {
            effect.presence.push((principal.into(), deadline));
            return Ok(());
        }
        self.execute_one("INSERT INTO _effect_presence(principal,id,deadline) VALUES ($1,$2,$3)", &[&principal, &id, &deadline])?;
        Ok(())
    }
    fn park_effect_generation(&self, id: &str, now: i64) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("park effect generation")?;
        self.execute("UPDATE _outbox SET state = 'parked', error_code = 'E_EFFECT_GENERATION', error = 'the admitted effect declaration changed; inspect this work before replacing it', settled_at = $2, lease_until = NULL, claimed_by = NULL, lease_digest = NULL, next_at = NULL WHERE id = $1 AND state IN ('queued','running')", &[&id, &now])?;
        Ok(())
    }
    fn effect_run(&self, id: &str) -> Result<Option<EffectRun>, RuntimeError> {
        if absent_key(Some(id)) { return Ok(None); }
        self.query(runs!("WHERE id = $1"), &[&id])?.into_iter().next().map(read_run).transpose()
    }
    fn effect_lease_digest(&self, id: &str) -> Result<Option<String>, RuntimeError> {
        if absent_key(Some(id)) { return Err(RuntimeError::Sql(rusqlite::Error::QueryReturnedNoRows)); }
        self.query("SELECT lease_digest FROM _outbox WHERE id = $1", &[&id])?.first().map(|r| r.get(0)).ok_or_else(|| RuntimeError::Sql(rusqlite::Error::QueryReturnedNoRows))
    }
    fn effect_candidates(&self, effect: Option<&str>, now: i64, limit: u64) -> Result<Vec<String>, RuntimeError> {
        if absent_key(effect) { return Ok(Vec::new()); }
        Ok(self.query("SELECT id FROM _outbox WHERE state = 'queued' AND (next_at IS NULL OR next_at <= $1) AND ($2::text IS NULL OR effect = $2) ORDER BY seq, id LIMIT $3", &[&now, &effect, &(limit.min(i64::MAX as u64) as i64)])?.into_iter().map(|r| r.get(0)).collect())
    }
    fn strict_effect_candidates(&self, effect: Option<&str>, now: i64, limit: u64) -> Result<Vec<String>, RuntimeError> {
        if absent_key(effect) { return Ok(Vec::new()); }
        Ok(self.query("SELECT id FROM _outbox WHERE state = 'queued' AND NOT cancelled AND (next_at IS NULL OR next_at <= $1) AND ($2::text IS NULL OR effect = $2) ORDER BY seq, id LIMIT $3", &[&now, &effect, &(limit.min(i64::MAX as u64) as i64)])?.into_iter().map(|r| r.get(0)).collect())
    }
    fn effect_presence_satisfied(&self, id: &str) -> Result<bool, RuntimeError> {
        if absent_key(Some(id)) { return Ok(false); }
        Ok(self.query("SELECT EXISTS(SELECT 1 FROM _effect_presence WHERE id = $1 AND reconnected)", &[&id])?[0].get(0))
    }
    fn clear_effect_presence(&self, id: &str) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("clear effect presence")?;
        self.execute("DELETE FROM _effect_presence WHERE id = $1", &[&id])?;
        Ok(())
    }
    fn satisfy_effect(&self, id: &str, outcome: &Value) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("satisfy effect")?;
        self.execute("UPDATE _outbox SET state = 'satisfied', result = $2, next_at = NULL WHERE id = $1", &[&id, &canonical_json(outcome)])?;
        Ok(())
    }
    fn claim_effect(&self, id: &str, worker: &str, lease_until: i64, digest: Option<&str>) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("claim effect")?;
        self.execute("UPDATE _outbox SET state = 'running', attempts = attempts + 1, claimed_by = $2, lease_until = LEAST($3, COALESCE(deadline,$3)), next_at = NULL, error = NULL, error_code = NULL, lease_digest = $4 WHERE id = $1", &[&id, &worker, &lease_until, &digest])?;
        Ok(())
    }
    fn claim_effect_strict(&self, id: &str, worker: &str, lease_until: i64, digest: Option<&str>) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("claim effect strict")?;
        self.execute("UPDATE _outbox SET state = 'running', attempts = attempts + 1, claimed_by = $2, lease_until = LEAST($3, COALESCE(deadline,$3)), next_at = NULL, error = NULL, error_code = NULL, lease_digest = $4 WHERE id = $1 AND state = 'queued' AND NOT cancelled", &[&id, &worker, &lease_until, &digest])?;
        Ok(())
    }
    fn required_effect_run(&self, id: &str) -> Result<EffectRun, RuntimeError> {
        self.effect_run(id)?.ok_or_else(|| RuntimeError::Sql(rusqlite::Error::QueryReturnedNoRows))
    }
    fn effect_presence(&self, id: &str) -> Result<Vec<(String, bool)>, RuntimeError> {
        if absent_key(Some(id)) { return Ok(Vec::new()); }
        Ok(self.query("SELECT principal,reconnected FROM _effect_presence WHERE id = $1 ORDER BY principal", &[&id])?.into_iter().map(|r| (r.get(0), r.get(1))).collect())
    }
    fn pending_effect_presence(&self, principal: &str, now: i64) -> Result<bool, RuntimeError> {
        if absent_key(Some(principal)) { return Ok(false); }
        Ok(self.query("SELECT EXISTS(SELECT 1 FROM _effect_presence WHERE principal = $1 AND deadline >= $2 AND NOT reconnected)", &[&principal, &now])?[0].get(0))
    }
    fn reconnect_effect_presence(&self, principal: &str, now: i64) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("reconnect effect presence")?;
        if absent_key(Some(principal)) { return Ok(()); }
        self.execute("UPDATE _effect_presence SET reconnected = true WHERE principal = $1 AND deadline >= $2", &[&principal, &now])?;
        Ok(())
    }
    fn send_effect(&self, id: &str, result: Option<&Value>) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("send effect")?;
        self.execute("UPDATE _outbox SET state = 'sent', result = $2, error = NULL, lease_until = NULL WHERE id = $1", &[&id, &result.map(canonical_json)])?;
        Ok(())
    }
    fn retry_effect(&self, id: &str, error: &str, next_at: i64) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("retry effect")?;
        self.execute("UPDATE _outbox SET state = 'queued', error = $2, next_at = $3, lease_until = NULL, claimed_by = NULL, lease_digest = NULL WHERE id = $1", &[&id, &error, &next_at])?;
        Ok(())
    }
    fn fail_effect(&self, id: &str, error: &str) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("fail effect")?;
        self.execute("UPDATE _outbox SET state = 'failed', error = $2, lease_until = NULL WHERE id = $1", &[&id, &error])?;
        Ok(())
    }
    fn mark_effect_settled(&self, id: &str, now: i64) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("mark effect settled")?;
        self.execute("UPDATE _outbox SET settled_at = CASE WHEN state IN ('sent','failed') THEN $2::bigint ELSE NULL END WHERE id = $1", &[&id, &now])?;
        Ok(())
    }
    fn send_effect_strict(&self, id: &str, result: Option<&Value>, now: i64) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("send effect strict")?;
        self.execute("UPDATE _outbox SET state = 'sent', result = $2, error = NULL, error_code = NULL, settled_at = $3, lease_until = NULL, claimed_by = NULL, lease_digest = NULL, next_at = NULL WHERE id = $1", &[&id, &result.map(canonical_json), &now])?;
        Ok(())
    }
    fn retry_effect_strict(&self, id: &str, error: &str, next_at: i64) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("retry effect strict")?;
        self.execute("UPDATE _outbox SET state = 'queued', error = $2, error_code = NULL, next_at = $3, settled_at = NULL, lease_until = NULL, claimed_by = NULL, lease_digest = NULL WHERE id = $1", &[&id, &error, &next_at])?;
        Ok(())
    }
    fn fail_effect_strict(&self, id: &str, error: &str, now: i64) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("fail effect strict")?;
        self.execute("UPDATE _outbox SET state = 'failed', error = $2, settled_at = $3, next_at = NULL, lease_until = NULL, claimed_by = NULL, lease_digest = NULL WHERE id = $1", &[&id, &error, &now])?;
        Ok(())
    }
    fn finalize_effect_cancellation(&self, id: &str, now: i64) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("finalize effect cancellation")?;
        self.execute("UPDATE _outbox SET state = 'failed', error = 'the effect was cancelled; external effects are not undone', error_code = 'E_EFFECT_CANCELLED', settled_at = $2, lease_until = NULL, claimed_by = NULL, lease_digest = NULL, next_at = NULL WHERE id = $1", &[&id, &now])?;
        Ok(())
    }
    fn cancel_effect(&self, id: &str, now: i64) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("cancel effect")?;
        self.execute("UPDATE _outbox SET state = 'failed', cancelled = true, error = 'the effect was cancelled; external effects are not undone', error_code = 'E_EFFECT_CANCELLED', settled_at = $2, lease_until = NULL, claimed_by = NULL, lease_digest = NULL, next_at = NULL WHERE id = $1", &[&id, &now])?;
        Ok(())
    }
    fn shift_worker_leases(&self, milliseconds: i64, before: i64) -> Result<(), RuntimeError> {
        let (bound, end) = crate::engine::effects::lease_shift_bounds(milliseconds);
        self.require_serialized_head_fence("shift worker leases")?;
        // SQLite LIKE folds ASCII only. C-collated ILIKE preserves that marker rule.
        self.execute("UPDATE _sessions SET expires_at = CASE WHEN ($1::bigint >= 0 AND expires_at > $2) OR ($1::bigint < 0 AND expires_at < $2) THEN $3 ELSE expires_at + $1 END WHERE expires_at > $4 AND COALESCE(family,token_digest) IN (SELECT value FROM _meta WHERE key = 'worker:session-family' UNION SELECT substr(key,15) FROM _meta WHERE key ILIKE 'worker:family:%' COLLATE \"C\")", &[&milliseconds, &bound, &end, &before])?;
        self.execute("UPDATE _outbox SET lease_until = CASE WHEN ($1::bigint >= 0 AND lease_until > $2) OR ($1::bigint < 0 AND lease_until < $2) THEN $3 ELSE lease_until + $1 END WHERE state = 'running' AND lease_until IS NOT NULL", &[&milliseconds, &bound, &end])?;
        self.execute("UPDATE _requests SET lease_until = CASE WHEN family IS NULL OR principal_generation IS NULL OR admitted_expires_at IS NULL THEN CASE WHEN ($1::bigint >= 0 AND lease_until > $2) OR ($1::bigint < 0 AND lease_until < $2) THEN $3 ELSE lease_until + $1 END ELSE LEAST(CASE WHEN ($1::bigint >= 0 AND lease_until > $2) OR ($1::bigint < 0 AND lease_until < $2) THEN $3 ELSE lease_until + $1 END, COALESCE((SELECT MAX(s.expires_at) FROM _sessions s WHERE s.principal = _requests.principal AND COALESCE(s.family,s.token_digest) = _requests.family), lease_until)) END WHERE state = 'running' AND lease_until IS NOT NULL", &[&milliseconds, &bound, &end])?;
        self.execute("UPDATE _sessions SET expires_at = (SELECT lease_until FROM _requests WHERE session_digest = _sessions.token_digest AND state = 'running') WHERE token_digest IN (SELECT session_digest FROM _requests WHERE state = 'running' AND lease_until IS NOT NULL)", &[])?;
        Ok(())
    }
    fn expired_effects(&self, now: i64, limit: u64) -> Result<Vec<EffectRun>, RuntimeError> {
        self.query(runs!("WHERE state IN ('queued','running') AND (deadline <= $1 OR (state = 'running' AND lease_until < $1)) ORDER BY seq, id LIMIT $2"), &[&now, &(limit.min(i64::MAX as u64) as i64)])?.into_iter().map(read_run).collect()
    }
    fn expired_effects_strict(&self, now: i64) -> Result<Vec<EffectRun>, RuntimeError> {
        self.query(runs!("WHERE state IN ('queued','running') AND (deadline <= $1 OR (state = 'running' AND lease_until < $1)) ORDER BY seq, id"), &[&now])?.into_iter().map(read_run).collect()
    }
    fn expire_effect(&self, update: &ExpiredEffect<'_>) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("expire effect")?;
        self.execute("UPDATE _outbox SET state = $2, error = $3, error_code = $4, settled_at = $5, lease_until = NULL, claimed_by = NULL, lease_digest = NULL, next_at = $6 WHERE id = $1", &[&update.id, &update.state, &update.error, &update.code, &update.settled_at, &update.next_at])?;
        Ok(())
    }
    fn replay_deployed(&self) -> Result<bool, RuntimeError> {
        Ok(self.release_value()?.is_some())
    }
}
