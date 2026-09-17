//! Effects: a mutation or a job `emit`s a fact for the outside world and
//! the engine keeps it durably in the same commit (`_outbox`); an external
//! worker holding a service token claims it, does the I/O, and settles it.
//! The engine never calls out itself (no JavaScript, no network in the
//! data plane: `NOT-DOING.md`); it keeps the queue honest: a claim is a
//! lease that expires back to the queue, a failure retries with backoff up
//! to a bound, and every transition is one row the worker can read back.

use super::Engine;
use crate::error::RuntimeError;
use crate::value::{Value, canonical_json};
use crate::{identity, schema::{Schema, WorkSpec}};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub use super::steps::Step as EffectStep;

/// A failed effect retries this many times, then rests as `failed`.
pub const MAX_ATTEMPTS: u32 = 8;
/// The longest a retry waits, whatever the attempt.
pub const MAX_BACKOFF_MS: i64 = 300_000;
/// A lease a worker asks for is held to this.
pub const MAX_LEASE_MS: i64 = 900_000;

/// One queued effect, as the worker and `doctor` see it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EffectRun {
    pub id: String,
    pub effect: String,
    pub payload: Value,
    /// `queued`, `running`, `sent`, `satisfied`, `parked` or `failed`.
    pub state: String,
    /// Claims so far; the current claim counts.
    pub attempts: u32,
    /// The commit that emitted it.
    pub seq: u64,
    pub at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease_until: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claimed_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub work: WorkSpec,
    #[serde(default)]
    pub deadline: Option<i64>,
    #[serde(default)]
    pub release: Option<String>,
    #[serde(default)]
    pub error_code: Option<String>,
    #[serde(default)]
    pub cancelled: bool,
    #[serde(skip)]
    pub(crate) contract: Option<String>,
    /// Returned once on a fenced claim; only its digest is persisted.
    #[serde(skip)]
    pub lease_token: Option<String>,
}

/// What a worker reports back for a claimed effect.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Settled {
    Done { result: Option<Value> },
    Failed { error: String, retry: bool },
}

const COLUMNS: &str = "id, effect, payload, state, attempts, seq, at, next_at, lease_until, claimed_by, result, error, work_spec, deadline, release, error_code, cancelled, contract";

fn legacy_work() -> WorkSpec { let mut work = WorkSpec::default(); work.policy.backoff_ms = 4_000; work }

// @ref LLP 3000.007#20.2 — dev replay counts committed emits without retaining a deliverable payload.
pub(super) fn record(tx: &crate::store::Tx<'_>, outbox: &[super::presence::Emission], seq: u64, now: i64, dev: bool, schema: &Schema) -> Result<(), RuntimeError> {
    if outbox.is_empty() { return Ok(()); }
    let replay = dev && tx.conn().prepare_cached("SELECT EXISTS(SELECT 1 FROM _meta WHERE key = 'dev:replay' AND value = 'true') AND NOT EXISTS(SELECT 1 FROM _meta WHERE key = 'release')")?.query_row([], |row| row.get(0))?;
    if replay {
        tx.conn().execute("INSERT INTO _meta(key, value) VALUES ('dev:suppressed-effects', ?1) ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + CAST(excluded.value AS INTEGER)", [outbox.len().to_string()])?;
    } else {
        // @ref LLP 3000.009#5.2 — release is admission provenance, not an input to the effect compatibility contract.
        let release: Option<String> = tx.conn().query_row("SELECT value FROM _meta WHERE key = 'release'", [], |row| row.get(0)).optional()?;
        for (id, effect, payload, presence) in outbox {
            let work = schema.effect_specs.get(effect).cloned().unwrap_or_else(legacy_work);
            if !work.policy.valid() { return Err(RuntimeError::Schema("the effect policy is outside its bounds".into())); }
            let contract = work.effect_contract(effect, payload);
            tx.conn().execute("INSERT INTO _outbox(id, seq, effect, payload, state, attempts, at, next_at, work_spec, deadline, release, contract) VALUES (?1, ?2, ?3, ?4, 'queued', 0, ?5, ?6, ?7, ?8, ?9, ?10)", params![id, seq as i64, effect, canonical_json(payload), now, presence.values().flatten().max(), canonical_json(&work), work.policy.deadline_ms.map(|ms| now.saturating_add(ms as i64)), release, contract])?;
            for (principal, deadline) in presence {
                let Some(deadline) = deadline else { continue; };
                tx.conn().execute("INSERT INTO _effect_presence(principal, id, deadline) VALUES (?1, ?2, ?3)", params![principal, id, deadline])?;
            }
        }
    }
    Ok(())
}

fn read_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<EffectRun> {
    let payload: String = row.get(2)?;
    let result: Option<String> = row.get(10)?;
    Ok(EffectRun {
        id: row.get(0)?,
        effect: row.get(1)?,
        payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
        state: row.get(3)?,
        attempts: row.get::<_, i64>(4)? as u32,
        seq: row.get::<_, i64>(5)? as u64,
        at: row.get(6)?,
        next_at: row.get(7)?,
        lease_until: row.get(8)?,
        claimed_by: row.get(9)?,
        result: result.and_then(|text| serde_json::from_str(&text).ok()),
        error: row.get(11)?,
        work: row.get::<_, Option<String>>(12)?.map(|text| serde_json::from_str(&text).map_err(|e| rusqlite::Error::FromSqlConversionFailure(12, rusqlite::types::Type::Text, Box::new(e)))).transpose()?.unwrap_or_else(legacy_work),
        deadline: row.get(13)?, release: row.get(14)?, error_code: row.get(15)?, cancelled: row.get(16)?, contract: row.get(17)?, lease_token: None,
    })
}

pub(super) fn auth_error() -> RuntimeError {
    RuntimeError::Auth("this is a worker's door: send a live current service token".into())
}

fn lease_error(id: &str) -> RuntimeError {
    RuntimeError::Structural { code: "E_EFFECT_LEASE", message: format!("effect {id} is not held by this live claim; claim it first and use its current token") }
}

pub(super) fn generation_error() -> RuntimeError {
    RuntimeError::Structural { code: "E_EFFECT_GENERATION", message: "the admitted effect declaration changed; inspect this work before replacing it".into() }
}

fn park_generation(tx: &crate::store::Tx<'_>, id: &str, now: i64) -> Result<(), RuntimeError> {
    tx.conn().execute("UPDATE _outbox SET state = 'parked', error_code = 'E_EFFECT_GENERATION', error = 'the admitted effect declaration changed; inspect this work before replacing it', settled_at = ?2, lease_until = NULL, claimed_by = NULL, lease_digest = NULL, next_at = NULL WHERE id = ?1 AND state IN ('queued', 'running')", params![id, now])?;
    Ok(())
}

// @ref LLP 3000.009#5.2 — live admitted work cannot run under a replacement declaration; terminal evidence stays immutable.
pub(super) fn contract_stands(tx: &crate::store::Tx<'_>, schema: &Schema, run: &EffectRun, now: i64) -> Result<bool, RuntimeError> {
    // NULL is an explicit legacy bypass: pre-contract rows retain their
    // compatibility behavior rather than acquiring a guessed declaration.
    let Some(recorded) = &run.contract else { return Ok(true) };
    let current = schema.effect_specs.get(&run.effect).cloned()
        .or_else(|| schema.effects.contains(&run.effect).then(legacy_work))
        .map(|work| work.effect_contract(&run.effect, &run.payload));
    if current.as_ref() == Some(recorded) { return Ok(true); }
    park_generation(tx, &run.id, now)?;
    Ok(false)
}

pub(super) fn strict_run(tx: &crate::store::Tx<'_>, id: &str) -> Result<EffectRun, RuntimeError> {
    tx.conn().query_row(&format!("SELECT {COLUMNS} FROM _outbox WHERE id = ?1"), [id], read_run).optional()?.ok_or_else(|| RuntimeError::Structural { code: "E_EFFECT_UNKNOWN", message: format!("no effect {id} is queued here") })
}

pub(super) fn held_strict_claim(tx: &crate::store::Tx<'_>, run: &EffectRun, worker: &str, token: &str, now: i64) -> Result<(), RuntimeError> {
    let id = run.id.as_str();
    let token_digest = identity::digest(token);
    let digest: Option<String> = tx.conn().query_row("SELECT lease_digest FROM _outbox WHERE id = ?1", [id], |row| row.get(0))?;
    if run.state != "running" || run.cancelled || run.claimed_by.as_deref() != Some(worker)
        || digest.as_deref() != Some(token_digest.as_str())
        || run.lease_until.is_none_or(|lease| lease <= now)
        || run.deadline.is_some_and(|deadline| deadline <= now)
    { return Err(lease_error(id)); }
    Ok(())
}

/// The wait before attempt `attempts + 1`: doubling from two seconds.
pub fn backoff_ms(attempts: u32) -> i64 {
    (2_000_i64.saturating_mul(1_i64 << attempts.min(20))).min(MAX_BACKOFF_MS)
}

impl Engine {
    /// A held-effects poll still authenticates at a writer boundary. The host
    /// sample is taken once after BEGIN IMMEDIATE; no work is claimed.
    pub fn authorize_effect_poll_strict(&mut self, service_token: &str, sample: impl FnOnce() -> identity::ServiceSample) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        let sample = sample();
        identity::current_service_tx(&tx, service_token, sample)?.ok_or_else(auth_error)?;
        tx.rollback()
    }

    /// Claim up to `limit` queued effects (of one kind, or any) for `worker`
    /// until `now + lease_ms`: oldest first, only those whose backoff has
    /// passed, each counted as an attempt. Two workers never hold one effect.
    pub fn claim_effects(&mut self, worker: &str, effect: Option<&str>, limit: usize, lease_ms: i64, now: i64) -> Result<Vec<EffectRun>, RuntimeError> {
        self.claim_effects_inner(worker, effect, limit, lease_ms, now, false)
    }

    pub fn claim_effects_fenced(&mut self, worker: &str, effect: Option<&str>, limit: usize, lease_ms: i64, now: i64) -> Result<Vec<EffectRun>, RuntimeError> {
        self.claim_effects_inner(worker, effect, limit, lease_ms, now, true)
    }

    fn claim_effects_inner(&mut self, worker: &str, effect: Option<&str>, limit: usize, lease_ms: i64, now: i64, fenced: bool) -> Result<Vec<EffectRun>, RuntimeError> {
        let limit = limit.clamp(1, 100) as i64;
        let lease = lease_ms.clamp(1_000, MAX_LEASE_MS);
        let tx = self.store.transaction()?;
        expire(tx.conn(), now)?;
        let ids: Vec<String> = match effect {
            Some(effect) => tx.conn().prepare("SELECT id FROM _outbox WHERE state = 'queued' AND (next_at IS NULL OR next_at <= ?1) AND effect = ?2 ORDER BY seq, id LIMIT ?3")?.query_map(params![now, effect, limit], |row| row.get(0))?.collect::<Result<_, _>>()?,
            None => tx.conn().prepare("SELECT id FROM _outbox WHERE state = 'queued' AND (next_at IS NULL OR next_at <= ?1) ORDER BY seq, id LIMIT ?2")?.query_map(params![now, limit], |row| row.get(0))?.collect::<Result<_, _>>()?,
        };
        let mut claimed = Vec::with_capacity(ids.len());
        for id in ids {
            let dependencies = tx.conn().prepare("SELECT principal, reconnected FROM _effect_presence WHERE id = ?1")?
                .query_map([&id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?)))?.collect::<Result<Vec<_>, _>>()?;
            let satisfied = dependencies.iter().any(|(principal, reconnected)| *reconnected
                || self.presence.as_ref().is_some_and(|presence| presence.effect_presence(principal).0 > 0));
            tx.conn().execute("DELETE FROM _effect_presence WHERE id = ?1", [&id])?;
            if satisfied {
                let outcome = crate::value::object([("outcome", Value::String("presence_reconnected".into()))]);
                tx.conn().execute("UPDATE _outbox SET state = 'satisfied', result = ?2, next_at = NULL WHERE id = ?1", params![id, canonical_json(&outcome)])?;
                continue;
            }
            let token = if fenced { Some(identity::claim_token()?) } else { None };
            tx.conn().execute("UPDATE _outbox SET state = 'running', attempts = attempts + 1, claimed_by = ?2, lease_until = MIN(?3, COALESCE(deadline, ?3)), next_at = NULL, error = NULL, error_code = NULL, lease_digest = ?4 WHERE id = ?1", params![id, worker, now.saturating_add(lease), token.as_deref().map(identity::digest)])?;
            if let Some(mut run) = tx.conn().query_row(&format!("SELECT {COLUMNS} FROM _outbox WHERE id = ?1"), [&id], read_run).optional()? {
                run.lease_token = token;
                claimed.push(run);
            }
        }
        tx.commit()?;
        Ok(claimed)
    }

    /// HTTP authority path. The deterministic host sample is taken exactly
    /// once, after the immediate transaction begins; direct claim APIs above
    /// deliberately retain their compatibility behavior.
    // @ref LLP 3000.009#5.2 — effect claims bind current service and declaration authority in the claim transaction.
    pub fn claim_effects_strict(&mut self, service_token: &str, effect: Option<&str>, limit: usize, lease_ms: i64, fenced: bool, sample: impl FnOnce() -> identity::ServiceSample) -> Result<Vec<EffectRun>, RuntimeError> {
        let limit = limit.clamp(1, 100) as i64;
        let lease = lease_ms.clamp(1_000, MAX_LEASE_MS);
        let tx = self.store.transaction()?;
        let sample = sample();
        let worker = identity::current_service_tx(&tx, service_token, sample)?.ok_or_else(auth_error)?;
        expire_strict(&tx, &self.schema, sample.now)?;
        let ids: Vec<String> = match effect {
            Some(effect) => tx.conn().prepare("SELECT id FROM _outbox WHERE state = 'queued' AND cancelled = 0 AND (next_at IS NULL OR next_at <= ?1) AND effect = ?2 ORDER BY seq, id LIMIT ?3")?.query_map(params![sample.now, effect, limit], |row| row.get(0))?.collect::<Result<_, _>>()?,
            None => tx.conn().prepare("SELECT id FROM _outbox WHERE state = 'queued' AND cancelled = 0 AND (next_at IS NULL OR next_at <= ?1) ORDER BY seq, id LIMIT ?2")?.query_map(params![sample.now, limit], |row| row.get(0))?.collect::<Result<_, _>>()?,
        };
        let mut claimed = Vec::with_capacity(ids.len());
        for id in ids {
            let run = tx.conn().query_row(&format!("SELECT {COLUMNS} FROM _outbox WHERE id = ?1"), [&id], read_run)?;
            if !contract_stands(&tx, &self.schema, &run, sample.now)? { continue; }
            let dependencies = tx.conn().prepare("SELECT principal, reconnected FROM _effect_presence WHERE id = ?1")?
                .query_map([&id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?)))?.collect::<Result<Vec<_>, _>>()?;
            let satisfied = dependencies.iter().any(|(principal, reconnected)| *reconnected
                || self.presence.as_ref().is_some_and(|presence| presence.effect_presence(principal).0 > 0));
            tx.conn().execute("DELETE FROM _effect_presence WHERE id = ?1", [&id])?;
            if satisfied {
                let outcome = crate::value::object([("outcome", Value::String("presence_reconnected".into()))]);
                tx.conn().execute("UPDATE _outbox SET state = 'satisfied', result = ?2, next_at = NULL WHERE id = ?1", params![id, canonical_json(&outcome)])?;
                continue;
            }
            let token = if fenced { Some(identity::claim_token()?) } else { None };
            tx.conn().execute("UPDATE _outbox SET state = 'running', attempts = attempts + 1, claimed_by = ?2, lease_until = MIN(?3, COALESCE(deadline, ?3)), next_at = NULL, error = NULL, error_code = NULL, lease_digest = ?4 WHERE id = ?1 AND state = 'queued' AND cancelled = 0", params![id, worker, sample.now.saturating_add(lease), token.as_deref().map(identity::digest)])?;
            if let Some(mut run) = tx.conn().query_row(&format!("SELECT {COLUMNS} FROM _outbox WHERE id = ?1"), [&id], read_run).optional()? {
                run.lease_token = token;
                claimed.push(run);
            }
        }
        tx.commit()?;
        Ok(claimed)
    }

    /// Record even a brief reconnect before its grace deadline. The host
    /// calls this under the same engine lock as emission and claiming.
    pub fn presence_reconnected(&mut self, principal: &str, now: i64) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        tx.conn().execute("UPDATE _effect_presence SET reconnected = 1 WHERE principal = ?1 AND deadline >= ?2", params![principal, now])?;
        tx.commit()
    }

    /// Settle a claimed effect: `sent` with the worker's result, or a
    /// failure that goes back to the queue after a backoff (until the
    /// attempts run out) or rests as `failed` when the worker says so.
    pub fn settle_effect(&mut self, id: &str, worker: &str, settled: Settled, now: i64) -> Result<EffectRun, RuntimeError> {
        self.settle_effect_inner(id, worker, None, false, settled, now)
    }

    /// HTTP uses this form. Unfenced legacy claims may settle without a token;
    /// a fenced claim can never be downgraded by omitting its token.
    pub fn settle_effect_claim(&mut self, id: &str, worker: &str, token: Option<&str>, settled: Settled, now: i64) -> Result<EffectRun, RuntimeError> {
        self.settle_effect_inner(id, worker, token, true, settled, now)
    }

    fn settle_effect_inner(&mut self, id: &str, worker: &str, token: Option<&str>, fenced: bool, settled: Settled, now: i64) -> Result<EffectRun, RuntimeError> {
        let tx = self.store.transaction()?;
        expire(tx.conn(), now)?;
        let Some(run) = tx.conn().query_row(&format!("SELECT {COLUMNS} FROM _outbox WHERE id = ?1"), [id], read_run).optional()? else {
            return Err(RuntimeError::Structural { code: "E_EFFECT_UNKNOWN", message: format!("no effect {id} is queued here") });
        };
        if run.state != "running" || run.claimed_by.as_deref() != Some(worker) {
            return Err(RuntimeError::Structural { code: "E_EFFECT_LEASE", message: format!("effect {id} is {} and not claimed by this worker; claim it first", run.state) });
        }
        if fenced {
            let digest: Option<String> = tx.conn().query_row("SELECT lease_digest FROM _outbox WHERE id = ?1", [id], |row| row.get(0))?;
            if digest != token.map(identity::digest) { return Err(RuntimeError::Structural { code: "E_EFFECT_LEASE", message: "settle this effect with the token of its current claim".into() }); }
        }
        match settled {
            Settled::Done { result } => {
                tx.conn().execute("UPDATE _outbox SET state = 'sent', result = ?2, error = NULL, lease_until = NULL WHERE id = ?1", params![id, result.map(|value| canonical_json(&value))])?;
            }
            Settled::Failed { error, retry } => {
                let error: String = error.chars().take(2_000).collect();
                if retry && run.attempts < run.work.policy.max_attempts {
                    tx.conn().execute("UPDATE _outbox SET state = 'queued', error = ?2, next_at = ?3, lease_until = NULL, claimed_by = NULL, lease_digest = NULL WHERE id = ?1", params![id, error, now.saturating_add(run.work.policy.backoff(run.attempts))])?;
                } else {
                    tx.conn().execute("UPDATE _outbox SET state = 'failed', error = ?2, lease_until = NULL WHERE id = ?1", params![id, error])?;
                }
            }
        }
        tx.conn().execute("UPDATE _outbox SET settled_at = CASE WHEN state IN ('sent', 'failed') THEN ?2 ELSE NULL END WHERE id = ?1", params![id, now])?;
        let run = tx.conn().query_row(&format!("SELECT {COLUMNS} FROM _outbox WHERE id = ?1"), [id], read_run)?;
        tx.commit()?;
        Ok(run)
    }

    /// Strict HTTP settlement; unfenced rows still accept the legacy absent
    /// token, while a fenced row can never be downgraded by omission.
    pub fn settle_effect_strict(&mut self, service_token: &str, id: &str, token: Option<&str>, settled: Settled, sample: impl FnOnce() -> identity::ServiceSample) -> Result<EffectRun, RuntimeError> {
        let tx = self.store.transaction()?;
        let sample = sample();
        let worker = identity::current_service_tx(&tx, service_token, sample)?.ok_or_else(auth_error)?;
        let run = strict_run(&tx, id)?;
        if !contract_stands(&tx, &self.schema, &run, sample.now)? {
            tx.commit()?;
            return Err(generation_error());
        }
        let digest: Option<String> = tx.conn().query_row("SELECT lease_digest FROM _outbox WHERE id = ?1", [id], |row| row.get(0))?;
        if run.state != "running" || run.cancelled || run.claimed_by.as_deref() != Some(worker.as_str())
            || digest != token.map(identity::digest) || run.lease_until.is_none_or(|lease| lease <= sample.now)
            || run.deadline.is_some_and(|deadline| deadline <= sample.now)
        { return Err(lease_error(id)); }
        match settled {
            Settled::Done { result } => {
                tx.conn().execute("UPDATE _outbox SET state = 'sent', result = ?2, error = NULL, error_code = NULL, settled_at = ?3, lease_until = NULL, claimed_by = NULL, lease_digest = NULL, next_at = NULL WHERE id = ?1", params![id, result.map(|value| canonical_json(&value)), sample.now])?;
            }
            Settled::Failed { error, retry } => {
                let error: String = error.chars().take(2_000).collect();
                if retry && run.attempts < run.work.policy.max_attempts {
                    tx.conn().execute("UPDATE _outbox SET state = 'queued', error = ?2, error_code = NULL, next_at = ?3, settled_at = NULL, lease_until = NULL, claimed_by = NULL, lease_digest = NULL WHERE id = ?1", params![id, error, sample.now.saturating_add(run.work.policy.backoff(run.attempts))])?;
                } else {
                    tx.conn().execute("UPDATE _outbox SET state = 'failed', error = ?2, settled_at = ?3, next_at = NULL, lease_until = NULL, claimed_by = NULL, lease_digest = NULL WHERE id = ?1", params![id, error, sample.now])?;
                }
            }
        }
        let run = tx.conn().query_row(&format!("SELECT {COLUMNS} FROM _outbox WHERE id = ?1"), [id], read_run)?;
        tx.commit()?;
        Ok(run)
    }

    /// Move held effect/action leases and their delegated viewer sessions
    /// together. Backoffs and ordinary sessions stay put; overdue stays overdue.
    // @ref LLP 3000.007#20.12 — dev advances preserve worker lifetimes without making retries wait longer.
    pub fn advance_worker_leases(&mut self, milliseconds: i64) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        tx.conn().execute("UPDATE _outbox SET lease_until = lease_until + ?1 WHERE state = 'running' AND lease_until IS NOT NULL", [milliseconds])?;
        // Advancing the dev clock cannot extend a claim past its admitting family.
        tx.conn().execute("UPDATE _requests SET lease_until = CASE WHEN family IS NULL OR principal_generation IS NULL OR admitted_expires_at IS NULL THEN lease_until + ?1 ELSE MIN(lease_until + ?1, COALESCE((SELECT MAX(s.expires_at) FROM _sessions s WHERE s.principal = _requests.principal AND COALESCE(s.family, s.token_digest) = _requests.family), lease_until)) END WHERE state = 'running' AND lease_until IS NOT NULL", [milliseconds])?;
        tx.conn().execute("UPDATE _sessions SET expires_at = (SELECT lease_until FROM _requests WHERE session_digest = _sessions.token_digest AND state = 'running') WHERE token_digest IN (SELECT session_digest FROM _requests WHERE state = 'running' AND lease_until IS NOT NULL)", [])?;
        tx.commit()?;
        Ok(())
    }

    /// A claim whose lease ran out goes back to the queue: the worker died
    /// or stalled, and the attempt it took stays counted.
    pub fn requeue_expired_effects(&mut self, now: i64) -> Result<u64, RuntimeError> {
        let tx = self.store.transaction()?;
        let changed = expire(tx.conn(), now)?;
        tx.commit()?;
        Ok(changed)
    }

    pub fn cancel_effect(&mut self, id: &str, now: i64) -> Result<EffectRun, RuntimeError> {
        let tx = self.store.transaction()?;
        let run = tx.conn().query_row(&format!("SELECT {COLUMNS} FROM _outbox WHERE id = ?1"), [id], read_run).optional()?.ok_or_else(|| RuntimeError::Structural { code: "E_EFFECT_UNKNOWN", message: "no effect with this id is available".into() })?;
        if !run.work.policy.cancellable { return Err(RuntimeError::Structural { code: "E_EFFECT_CANCELLATION", message: "this effect declaration does not allow cancellation".into() }); }
        if matches!(run.state.as_str(), "queued" | "running" | "parked") {
            tx.conn().execute("UPDATE _outbox SET state = 'failed', cancelled = 1, error = 'the effect was cancelled; external effects are not undone', error_code = 'E_EFFECT_CANCELLED', settled_at = ?2, lease_until = NULL, claimed_by = NULL, lease_digest = NULL, next_at = NULL WHERE id = ?1", params![id, now])?;
        }
        let run = tx.conn().query_row(&format!("SELECT {COLUMNS} FROM _outbox WHERE id = ?1"), [id], read_run)?;
        tx.commit()?;
        Ok(run)
    }

    /// Queued effects the worker could claim right now, for a long poll.
    pub fn effects_due(&self, effect: Option<&str>, now: i64) -> Result<bool, RuntimeError> {
        let due: i64 = match effect {
            Some(effect) => self.store.conn().query_row("SELECT COUNT(*) FROM (SELECT 1 FROM _outbox WHERE state = 'queued' AND (next_at IS NULL OR next_at <= ?1) AND effect = ?2 LIMIT 1)", params![now, effect], |row| row.get(0))?,
            None => self.store.conn().query_row("SELECT COUNT(*) FROM (SELECT 1 FROM _outbox WHERE state = 'queued' AND (next_at IS NULL OR next_at <= ?1) LIMIT 1)", params![now], |row| row.get(0))?,
        };
        Ok(due > 0)
    }

    /// The most recent effects in one state (or any), newest first.
    pub fn effects(&self, state: Option<&str>, limit: usize) -> Result<Vec<EffectRun>, RuntimeError> {
        let limit = limit.clamp(1, 500) as i64;
        let runs = match state {
            Some(state) => self.store.conn().prepare(&format!("SELECT {COLUMNS} FROM _outbox WHERE state = ?1 ORDER BY seq DESC, id DESC LIMIT ?2"))?.query_map(params![state, limit], read_run)?.collect::<Result<Vec<_>, _>>()?,
            None => self.store.conn().prepare(&format!("SELECT {COLUMNS} FROM _outbox ORDER BY seq DESC, id DESC LIMIT ?1"))?.query_map(params![limit], read_run)?.collect::<Result<Vec<_>, _>>()?,
        };
        Ok(runs)
    }

    /// How many effects sit in each state, plus the durable dev replay suppression count.
    pub fn effect_counts(&self) -> Result<BTreeMap<String, u64>, RuntimeError> {
        let mut statement = self.store.conn().prepare("SELECT state, COUNT(*) FROM _outbox GROUP BY state")?;
        let mut counts = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as u64)))?.collect::<Result<BTreeMap<_, _>, _>>()?;
        let suppressed: i64 = self.store.conn().query_row("SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'dev:suppressed-effects'", [], |row| row.get(0)).optional()?.unwrap_or(0);
        if suppressed > 0 { counts.insert("suppressed".into(), suppressed as u64); }
        Ok(counts)
    }
}

fn expire(conn: &rusqlite::Connection, now: i64) -> Result<u64, RuntimeError> {
    let runs = conn.prepare(&format!("SELECT {COLUMNS} FROM _outbox WHERE state IN ('queued', 'running') AND (deadline <= ?1 OR (state = 'running' AND lease_until < ?1))"))?
        .query_map([now], read_run)?.collect::<Result<Vec<_>, _>>()?;
    for run in &runs {
        expire_run(conn, run, now)?;
    }
    Ok(runs.len() as u64)
}

fn expire_strict(tx: &crate::store::Tx<'_>, schema: &Schema, now: i64) -> Result<u64, RuntimeError> {
    let runs = tx.conn().prepare(&format!("SELECT {COLUMNS} FROM _outbox WHERE state IN ('queued', 'running') AND (deadline <= ?1 OR (state = 'running' AND lease_until < ?1))"))?
        .query_map([now], read_run)?.collect::<Result<Vec<_>, _>>()?;
    for run in &runs {
        if contract_stands(tx, schema, run, now)? { expire_run(tx.conn(), run, now)?; }
    }
    Ok(runs.len() as u64)
}

fn expire_run(conn: &rusqlite::Connection, run: &EffectRun, now: i64) -> Result<(), RuntimeError> {
    let deadline = run.deadline.is_some_and(|deadline| deadline <= now);
    let failed = deadline || run.attempts >= run.work.policy.max_attempts;
    let code = if deadline { Some("E_EFFECT_DEADLINE") } else if failed { Some("E_EFFECT_ATTEMPTS") } else { None };
    conn.execute("UPDATE _outbox SET state = ?2, error = ?3, error_code = ?4, settled_at = ?5, lease_until = NULL, claimed_by = NULL, lease_digest = NULL, next_at = ?6 WHERE id = ?1", params![run.id, if failed { "failed" } else { "queued" }, if deadline { "the effect deadline passed" } else { "the lease expired" }, code, if failed { Some(now) } else { None }, if failed { None } else { Some(now) }])?;
    Ok(())
}
