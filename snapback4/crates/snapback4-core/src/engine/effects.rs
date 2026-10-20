//! Effects: a mutation or a job `emit`s a fact for the outside world and
//! the engine keeps it durably in the same commit (`_outbox`); an external
//! worker holding a service token claims it, does the I/O, and settles it.
//! The engine never calls out itself (no JavaScript, no network in the
//! data plane: `NOT-DOING.md`); it keeps the queue honest: a claim is a
//! lease that expires back to the queue, a failure retries with backoff up
//! to a bound, and every transition is one row the worker can read back.

use super::Engine;
use crate::error::RuntimeError;
use crate::value::Value;
use crate::{identity, schema::{Schema, WorkSpec}};
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
    /// Derived from the current declaration and returned on a strict claim.
    #[serde(skip)]
    pub declaration_contract: Option<String>,
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


/// A prepared admission; policy and canonical payload values come from the engine.
pub(crate) struct NewEffect<'a> {
    pub id: &'a str, pub seq: u64, pub effect: &'a str, pub payload: &'a Value,
    pub now: i64, pub next_at: Option<i64>, pub work: &'a WorkSpec,
    pub deadline: Option<i64>, pub release: Option<&'a str>, pub contract: &'a str,
}

pub(crate) struct ExpiredEffect<'a> {
    pub id: &'a str, pub state: &'a str, pub error: &'a str, pub code: Option<&'a str>,
    pub settled_at: Option<i64>, pub next_at: Option<i64>,
}

/// Durable outbox access within the caller's existing transaction.
/// Lifecycle policy stays here. Any adapter error terminates the caller's
/// transaction: roll it back instead of attempting another operation.
pub(crate) trait OutboxTransaction {
    fn replay_suppresses(&self) -> Result<bool, RuntimeError>;
    fn suppress_effects(&self, count: usize) -> Result<(), RuntimeError>;
    fn effect_release(&self) -> Result<Option<String>, RuntimeError>;
    fn insert_effect(&self, effect: &NewEffect<'_>) -> Result<(), RuntimeError>;
    fn insert_effect_presence(&self, principal: &str, id: &str, deadline: i64) -> Result<(), RuntimeError>;
    fn park_effect_generation(&self, id: &str, now: i64) -> Result<(), RuntimeError>;
    fn effect_run(&self, id: &str) -> Result<Option<EffectRun>, RuntimeError>;
    fn effect_lease_digest(&self, id: &str) -> Result<Option<String>, RuntimeError>;
    fn effect_candidates(&self, effect: Option<&str>, now: i64, limit: u64) -> Result<Vec<String>, RuntimeError>;
    fn strict_effect_candidates(&self, effect: Option<&str>, now: i64, limit: u64) -> Result<Vec<String>, RuntimeError>;
    fn effect_presence_satisfied(&self, id: &str) -> Result<bool, RuntimeError>;
    fn clear_effect_presence(&self, id: &str) -> Result<(), RuntimeError>;
    fn satisfy_effect(&self, id: &str, outcome: &Value) -> Result<(), RuntimeError>;
    fn claim_effect(&self, id: &str, worker: &str, lease_until: i64, digest: Option<&str>) -> Result<(), RuntimeError>;
    fn claim_effect_strict(&self, id: &str, worker: &str, lease_until: i64, digest: Option<&str>) -> Result<(), RuntimeError>;
    fn required_effect_run(&self, id: &str) -> Result<EffectRun, RuntimeError>;
    fn effect_presence(&self, id: &str) -> Result<Vec<(String, bool)>, RuntimeError>;
    fn pending_effect_presence(&self, principal: &str, now: i64) -> Result<bool, RuntimeError>;
    fn reconnect_effect_presence(&self, principal: &str, now: i64) -> Result<(), RuntimeError>;
    fn send_effect(&self, id: &str, result: Option<&Value>) -> Result<(), RuntimeError>;
    fn retry_effect(&self, id: &str, error: &str, next_at: i64) -> Result<(), RuntimeError>;
    fn fail_effect(&self, id: &str, error: &str) -> Result<(), RuntimeError>;
    fn mark_effect_settled(&self, id: &str, now: i64) -> Result<(), RuntimeError>;
    fn send_effect_strict(&self, id: &str, result: Option<&Value>, now: i64) -> Result<(), RuntimeError>;
    fn retry_effect_strict(&self, id: &str, error: &str, next_at: i64) -> Result<(), RuntimeError>;
    fn fail_effect_strict(&self, id: &str, error: &str, now: i64) -> Result<(), RuntimeError>;
    fn finalize_effect_cancellation(&self, id: &str, now: i64) -> Result<(), RuntimeError>;
    fn cancel_effect(&self, id: &str, now: i64) -> Result<(), RuntimeError>;
    /// Atomically shift `_outbox`/`_requests` leases and supervised/delegated
    /// `_sessions`, using the worker-family markers in `_meta`.
    fn shift_worker_leases(&self, milliseconds: i64, before: i64) -> Result<(), RuntimeError>;
    fn expired_effects(&self, now: i64, limit: u64) -> Result<Vec<EffectRun>, RuntimeError>;
    fn expired_effects_strict(&self, now: i64) -> Result<Vec<EffectRun>, RuntimeError>;
    fn expire_effect(&self, update: &ExpiredEffect<'_>) -> Result<(), RuntimeError>;
    fn replay_deployed(&self) -> Result<bool, RuntimeError>;
}

/// A health read keeps counts and grace deferrals in one snapshot. The nested
/// error retains the advisory deferral diagnostic's original display text.
#[derive(Debug)]
pub struct EffectHealth {
    pub counts: BTreeMap<String, u64>,
    pub deferred: Result<(u64, Option<i64>), String>,
}

/// Snapshot reads and the dev replay write on either adapter.
pub(crate) trait OutboxStore {
    fn effects_due(&self, effect: Option<&str>, now: i64) -> Result<bool, RuntimeError>;
    fn list_effects(&self, state: Option<&str>, limit: u64) -> Result<Vec<EffectRun>, RuntimeError>;
    fn effect_counts(&self) -> Result<BTreeMap<String, u64>, RuntimeError>;
    fn effect_health(&self, now: i64) -> Result<EffectHealth, RuntimeError>;
    fn set_effect_replay(&self, replay: bool, check: impl FnOnce(bool) -> Result<(), RuntimeError>) -> Result<(), RuntimeError>;
}

pub(crate) fn legacy_work() -> WorkSpec { let mut work = WorkSpec::default(); work.policy.backoff_ms = 4_000; work }

// @ref LLP 3000.007#20.2 — dev replay counts committed emits without retaining a deliverable payload.
pub(super) fn record(tx: &impl OutboxTransaction, outbox: &[super::presence::Emission], seq: u64, now: i64, dev: bool, schema: &Schema) -> Result<(), RuntimeError> {
    if outbox.is_empty() { return Ok(()); }
    validate_emissions(outbox, seq)?;
    let replay = dev && tx.replay_suppresses()?;
    if replay {
        tx.suppress_effects(outbox.len())?;
    } else {
        // @ref LLP 3000.009#5.2 — release is admission provenance, not an input to the effect compatibility contract.
        let release: Option<String> = tx.effect_release()?;
        for (id, effect, payload, presence) in outbox {
            let (work, deadline, contract) = admission(schema, effect, payload, now)?;
            tx.insert_effect(&NewEffect { id, seq, effect, payload, now, next_at: presence.values().flatten().max().copied(), work: &work, deadline, release: release.as_deref(), contract: &contract })?;
            for (principal, deadline) in presence {
                let Some(deadline) = deadline else { continue; };
                tx.insert_effect_presence(principal, id, *deadline)?;
            }
        }
    }
    Ok(())
}

// @ref LLP 3000.009.001.000#91-adapter-parity-rules — admission validates new text; existing row lookups remain byte exact.
pub(super) fn validate_new_text(text: &str) -> Result<(), RuntimeError> {
    if text.contains('\0') { return Err(RuntimeError::Input("effect identifiers and names cannot contain U+0000".into())); }
    Ok(())
}

pub(super) fn validate_emissions(outbox: &[super::presence::Emission], seq: u64) -> Result<(), RuntimeError> {
    if seq > i64::MAX as u64 { return Err(RuntimeError::Input("effect sequence exceeds signed 64-bit storage".into())); }
    for (id, effect, _, presence) in outbox {
        validate_new_text(id)?;
        validate_new_text(effect)?;
        for (principal, deadline) in presence {
            if deadline.is_some() { validate_new_text(principal)?; }
        }
    }
    Ok(())
}

// Shared by the ordinary recorder and the Postgres batched tail.
pub(super) fn admission(schema: &Schema, effect: &str, payload: &Value, now: i64) -> Result<(WorkSpec, Option<i64>, String), RuntimeError> {
    let work = schema.effect_specs.get(effect).cloned().unwrap_or_else(legacy_work);
    if !work.policy.valid() { return Err(RuntimeError::Schema("the effect policy is outside its bounds".into())); }
    let deadline = work.policy.deadline_ms.map(|ms| now.saturating_add(ms as i64));
    let contract = work.effect_contract(effect, payload);
    Ok((work, deadline, contract))
}

// @ref LLP 3000.009.001.000#91-adapter-parity-rules — normalize diagnostics before the character bound, never JSON values.
pub(super) fn diagnostic(error: &str) -> String {
    error.chars().map(|c| if c == '\0' { '\u{fffd}' } else { c }).take(2_000).collect()
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

fn current_declaration_contract(schema: &Schema, effect: &str) -> Option<String> {
    schema.effect_specs.get(effect).cloned()
        .or_else(|| schema.effects.iter().any(|declared| declared == effect).then(legacy_work))
        .map(|work| work.effect_declaration_contract(effect))
}

fn require_declaration_contract(schema: &Schema, effect: Option<&str>, supplied: Option<&str>, fenced: bool) -> Result<(), RuntimeError> {
    let Some(supplied) = supplied else { return Ok(()) };
    let Some(effect) = effect.filter(|effect| !effect.is_empty()).filter(|_| fenced) else {
        return Err(RuntimeError::Input("declarationContract requires one nonempty effect and fenced true".into()));
    };
    if current_declaration_contract(schema, effect).as_deref() != Some(supplied) { return Err(generation_error()); }
    Ok(())
}

fn park_generation(tx: &impl OutboxTransaction, id: &str, now: i64) -> Result<(), RuntimeError> {
    tx.park_effect_generation(id, now)?;
    Ok(())
}

// @ref LLP 3000.009#5.2 — live admitted work cannot run under a replacement declaration; terminal evidence stays immutable.
pub(super) fn contract_stands(tx: &impl OutboxTransaction, schema: &Schema, run: &EffectRun, now: i64) -> Result<bool, RuntimeError> {
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

pub(super) fn strict_run(tx: &impl OutboxTransaction, id: &str) -> Result<EffectRun, RuntimeError> {
    tx.effect_run(id)?.ok_or_else(|| RuntimeError::Structural { code: "E_EFFECT_UNKNOWN", message: format!("no effect {id} is queued here") })
}

pub(super) fn held_strict_claim(tx: &impl OutboxTransaction, run: &EffectRun, worker: &str, token: &str, now: i64) -> Result<(), RuntimeError> {
    let id = run.id.as_str();
    let token_digest = identity::digest(token);
    let digest: Option<String> = tx.effect_lease_digest(id)?;
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
    pub fn authorize_effect_poll_strict(&mut self, service_token: &str, effect: Option<&str>, declaration_contract: Option<&str>, fenced: bool, sample: impl FnOnce() -> identity::ServiceSample) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        let sample = sample();
        identity::current_service_tx(&tx, service_token, sample)?.ok_or_else(auth_error)?;
        require_declaration_contract(&self.schema, effect, declaration_contract, fenced)?;
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
        validate_new_text(worker)?;
        let limit = limit.clamp(1, 100) as u64;
        let lease = lease_ms.clamp(1_000, MAX_LEASE_MS);
        let tx = self.store.transaction()?;
        expire(&tx, now)?;
        let ids = tx.effect_candidates(effect, now, limit)?;
        let mut claimed = Vec::with_capacity(ids.len());
        for id in ids {
            let satisfied: bool = tx.effect_presence_satisfied(&id)?;
            tx.clear_effect_presence(&id)?;
            if satisfied {
                let outcome = crate::value::object([("outcome", Value::String("presence_reconnected".into()))]);
                tx.satisfy_effect(&id, &outcome)?;
                continue;
            }
            let token = if fenced { Some(identity::claim_token()?) } else { None };
            tx.claim_effect(&id, worker, now.saturating_add(lease), token.as_deref().map(identity::digest).as_deref())?;
            if let Some(mut run) = tx.effect_run(&id)? {
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
    pub fn claim_effects_strict(&mut self, service_token: &str, effect: Option<&str>, limit: usize, lease_ms: i64, fenced: bool, declaration_contract: Option<&str>, sample: impl FnOnce() -> identity::ServiceSample) -> Result<Vec<EffectRun>, RuntimeError> {
        let limit = limit.clamp(1, 100) as u64;
        let lease = lease_ms.clamp(1_000, MAX_LEASE_MS);
        let tx = self.store.transaction()?;
        let sample = sample();
        let worker = identity::current_service_tx(&tx, service_token, sample)?.ok_or_else(auth_error)?;
        // @ref LLP 3000.009#9 — generated workers prove their exact current
        // named declaration before queue maintenance can mutate any work.
        require_declaration_contract(&self.schema, effect, declaration_contract, fenced)?;
        expire_strict(&tx, &self.schema, sample.now)?;
        let ids = tx.strict_effect_candidates(effect, sample.now, limit)?;
        let mut claimed = Vec::with_capacity(ids.len());
        for id in ids {
            let run = tx.required_effect_run(&id)?;
            if !contract_stands(&tx, &self.schema, &run, sample.now)? { continue; }
            let dependencies = tx.effect_presence(&id)?;
            let satisfied = dependencies.iter().any(|(principal, reconnected)| *reconnected
                || self.presence.as_ref().is_some_and(|presence| presence.effect_presence(principal).0 > 0));
            tx.clear_effect_presence(&id)?;
            if satisfied {
                let outcome = crate::value::object([("outcome", Value::String("presence_reconnected".into()))]);
                tx.satisfy_effect(&id, &outcome)?;
                continue;
            }
            let token = if fenced { Some(identity::claim_token()?) } else { None };
            tx.claim_effect_strict(&id, &worker, sample.now.saturating_add(lease), token.as_deref().map(identity::digest).as_deref())?;
            if let Some(mut run) = tx.effect_run(&id)? {
                run.lease_token = token;
                run.declaration_contract = current_declaration_contract(&self.schema, &run.effect);
                claimed.push(run);
            }
        }
        tx.commit()?;
        Ok(claimed)
    }

    /// Record even a brief reconnect before its grace deadline. The host
    /// calls this under the same engine lock as emission and claiming.
    pub fn presence_reconnected(&mut self, principal: &str, now: i64) -> Result<(), RuntimeError> {
        let read = self.store.read_transaction()?;
        let pending: bool = read.pending_effect_presence(principal, now)?;
        read.rollback()?;
        if !pending { return Ok(()); }
        let tx = self.store.transaction()?;
        tx.reconnect_effect_presence(principal, now)?;
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
        expire(&tx, now)?;
        let Some(run) = tx.effect_run(id)? else {
            return Err(RuntimeError::Structural { code: "E_EFFECT_UNKNOWN", message: format!("no effect {id} is queued here") });
        };
        if run.state != "running" || run.claimed_by.as_deref() != Some(worker) {
            return Err(RuntimeError::Structural { code: "E_EFFECT_LEASE", message: format!("effect {id} is {} and not claimed by this worker; claim it first", run.state) });
        }
        if fenced {
            let digest: Option<String> = tx.effect_lease_digest(id)?;
            if digest != token.map(identity::digest) { return Err(RuntimeError::Structural { code: "E_EFFECT_LEASE", message: "settle this effect with the token of its current claim".into() }); }
        }
        match settled {
            Settled::Done { result } => {
                tx.send_effect(id, result.as_ref())?;
            }
            Settled::Failed { error, retry } => {
                let error = diagnostic(&error);
                if retry && run.attempts < run.work.policy.max_attempts {
                    tx.retry_effect(id, &error, now.saturating_add(run.work.policy.backoff(run.attempts)))?;
                } else {
                    tx.fail_effect(id, &error)?;
                }
            }
        }
        tx.mark_effect_settled(id, now)?;
        let run = tx.required_effect_run(id)?;
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
        let digest: Option<String> = tx.effect_lease_digest(id)?;
        if run.state != "running" || run.cancelled || run.claimed_by.as_deref() != Some(worker.as_str())
            || digest != token.map(identity::digest) || run.lease_until.is_none_or(|lease| lease <= sample.now)
            || run.deadline.is_some_and(|deadline| deadline <= sample.now)
        { return Err(lease_error(id)); }
        match settled {
            Settled::Done { result } => {
                tx.send_effect_strict(id, result.as_ref(), sample.now)?;
            }
            Settled::Failed { error, retry } => {
                let error = diagnostic(&error);
                if retry && run.attempts < run.work.policy.max_attempts {
                    tx.retry_effect_strict(id, &error, sample.now.saturating_add(run.work.policy.backoff(run.attempts)))?;
                } else {
                    tx.fail_effect_strict(id, &error, sample.now)?;
                }
            }
        }
        let run = tx.required_effect_run(id)?;
        tx.commit()?;
        Ok(run)
    }

    /// Read only safe effect lifecycle metadata. This deliberately finalizes
    /// only this row's deadline/cancellation and never performs queue expiry.
    // @ref LLP 3000.009#5.2 — status observes a claim without creating successor authority.
    pub fn effect_status_strict(&mut self, service_token: &str, id: &str, token: &str, sample: impl FnOnce() -> identity::ServiceSample) -> Result<EffectRun, RuntimeError> {
        let tx = self.store.transaction()?;
        let sample = sample();
        let worker = identity::current_service_tx(&tx, service_token, sample)?.ok_or_else(auth_error)?;
        let mut run = strict_run(&tx, id)?;
        if !contract_stands(&tx, &self.schema, &run, sample.now)? {
            tx.commit()?;
            return Err(generation_error());
        }
        if run.state == "running" {
            let digest: Option<String> = tx.effect_lease_digest(id)?;
            if run.claimed_by.as_deref() != Some(worker.as_str()) || digest.as_deref() != Some(identity::digest(token).as_str()) {
                return Err(lease_error(id));
            }
            if run.cancelled {
                tx.finalize_effect_cancellation(id, sample.now)?;
            } else if run.deadline.is_some_and(|deadline| deadline <= sample.now) {
                expire_run(&tx, &run, sample.now)?;
            } else if run.lease_until.is_none_or(|lease| lease <= sample.now) {
                return Err(lease_error(id));
            }
            run = strict_run(&tx, id)?;
        } else if run.state == "queued" {
            return Err(lease_error(id));
        }
        tx.commit()?;
        Ok(run)
    }

    /// Move held effect/action leases and their delegated viewer sessions
    /// together. Backoffs and ordinary sessions stay put; overdue stays overdue.
    // @ref LLP 3000.007#20.12 — dev advances preserve worker lifetimes without making retries wait longer.
    pub fn advance_worker_leases(&mut self, milliseconds: i64) -> Result<(), RuntimeError> {
        self.advance_worker_leases_at(milliseconds, crate::now_ms())
    }
    // @ref LLP 3000.001.000#workers — keep live supervised bearers valid until their orderly clock-revision replacement.
    pub fn advance_worker_leases_at(&mut self, milliseconds: i64, before: i64) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        tx.shift_worker_leases(milliseconds, before)?;
        tx.commit()?;
        Ok(())
    }

    /// A claim whose lease ran out goes back to the queue: the worker died
    /// or stalled, and the attempt it took stays counted.
    pub fn requeue_expired_effects(&mut self, now: i64) -> Result<u64, RuntimeError> {
        let tx = self.store.transaction()?;
        let changed = expire(&tx, now)?;
        tx.commit()?;
        Ok(changed)
    }

    /// A bounded maintenance pass; settlement still checks the live lease.
    pub fn requeue_expired_effects_for(&mut self, now: i64, budget: std::time::Duration) -> Result<u64, RuntimeError> {
        let tx = self.store.transaction()?;
        let changed = expire_batch(&tx, now, 256, budget)?;
        tx.commit()?;
        Ok(changed)
    }

    pub fn cancel_effect(&mut self, id: &str, now: i64) -> Result<EffectRun, RuntimeError> {
        let tx = self.store.transaction()?;
        let run = cancel(&tx,id,now)?;
        tx.commit()?;
        Ok(run)
    }

    /// Queued effects the worker could claim right now, for a long poll.
    pub fn effects_due(&self, effect: Option<&str>, now: i64) -> Result<bool, RuntimeError> {
        self.store.effects_due(effect, now)
    }

    /// The most recent effects in one state (or any), newest first.
    pub fn effects(&self, state: Option<&str>, limit: usize) -> Result<Vec<EffectRun>, RuntimeError> {
        let limit = limit.clamp(1, 500) as u64;
        self.store.list_effects(state, limit)
    }

    /// How many effects sit in each state, plus the durable dev replay suppression count.
    pub fn effect_counts(&self) -> Result<BTreeMap<String, u64>, RuntimeError> {
        self.store.effect_counts()
    }
}

fn expire(tx: &impl OutboxTransaction, now: i64) -> Result<u64, RuntimeError> {
    expire_batch(tx, now, u64::MAX, std::time::Duration::MAX)
}

fn expire_batch(tx: &impl OutboxTransaction, now: i64, limit: u64, budget: std::time::Duration) -> Result<u64, RuntimeError> {
    let started = std::time::Instant::now();
    let runs = tx.expired_effects(now, limit)?;
    let mut changed = 0;
    for run in &runs {
        if changed > 0 && started.elapsed() >= budget { break; }
        expire_run(tx, run, now)?;
        changed += 1;
    }
    Ok(changed)
}

fn expire_strict(tx: &impl OutboxTransaction, schema: &Schema, now: i64) -> Result<u64, RuntimeError> {
    let runs = tx.expired_effects_strict(now)?;
    for run in &runs {
        if contract_stands(tx, schema, run, now)? { expire_run(tx, run, now)?; }
    }
    Ok(runs.len() as u64)
}

fn expire_run(tx: &impl OutboxTransaction, run: &EffectRun, now: i64) -> Result<(), RuntimeError> {
    let deadline = run.deadline.is_some_and(|deadline| deadline <= now);
    let failed = deadline || run.attempts >= run.work.policy.max_attempts;
    let code = if deadline { Some("E_EFFECT_DEADLINE") } else if failed { Some("E_EFFECT_ATTEMPTS") } else { None };
    tx.expire_effect(&ExpiredEffect { id: &run.id, state: if failed { "failed" } else { "queued" }, error: if deadline { "the effect deadline passed" } else { "the lease expired" }, code, settled_at: if failed { Some(now) } else { None }, next_at: if failed { None } else { Some(now) } })?;
    Ok(())
}

pub(super) fn cancel(tx: &impl OutboxTransaction, id: &str, now: i64) -> Result<EffectRun, RuntimeError> {
    let run = tx.effect_run(id)?.ok_or_else(|| RuntimeError::Structural { code: "E_EFFECT_UNKNOWN", message: "no effect with this id is available".into() })?;
    if !run.work.policy.cancellable { return Err(RuntimeError::Structural { code: "E_EFFECT_CANCELLATION", message: "this effect declaration does not allow cancellation".into() }); }
    if matches!(run.state.as_str(), "queued" | "running" | "parked") { tx.cancel_effect(id,now)?; }
    tx.required_effect_run(id)
}

fn require_dev_store(deployed: bool) -> Result<(), RuntimeError> {
    if deployed { return Err(RuntimeError::Generation("this store belongs to a deployment; use `deploy` to activate source and `serve` to run it".into())); }
    Ok(())
}

impl crate::store::Tx<'_> {
    /// Assert dev replay authority inside an existing schedule transaction.
    pub fn require_dev_replay_store(&self) -> Result<(), RuntimeError> {
        require_dev_store(self.replay_deployed()?)
    }
}

impl Engine {
    /// Set replay suppression with the deployment check in one immediate write.
    /// Local `run` shares the policy; only the owning dev start replaces it,
    /// and the durable suppression count survives.
    pub fn set_effect_replay(&self, replay: bool) -> Result<(), RuntimeError> {
        self.store.set_effect_replay(replay, require_dev_store)
    }

    /// Counts and presence deferrals from one read snapshot.
    pub fn effect_health(&self, now: i64) -> Result<EffectHealth, RuntimeError> {
        self.store.effect_health(now)
    }
}

#[cfg(test)]
pub(crate) mod test_cases;
