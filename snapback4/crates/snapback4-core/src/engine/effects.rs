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
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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
    /// `queued`, `running`, `sent` or `failed`.
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
}

/// What a worker reports back for a claimed effect.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Settled {
    Done { result: Option<Value> },
    Failed { error: String, retry: bool },
}

const COLUMNS: &str = "id, effect, payload, state, attempts, seq, at, next_at, lease_until, claimed_by, result, error";

// @ref LLP 3000.007#20.2 — dev replay counts committed emits without retaining a deliverable payload.
pub(super) fn record(tx: &crate::store::Tx<'_>, outbox: &[(String, String, Value)], seq: u64, now: i64, dev: bool) -> Result<(), RuntimeError> {
    if outbox.is_empty() { return Ok(()); }
    let replay = dev && tx.conn().prepare_cached("SELECT EXISTS(SELECT 1 FROM _meta WHERE key = 'dev:replay' AND value = 'true') AND NOT EXISTS(SELECT 1 FROM _meta WHERE key = 'release')")?.query_row([], |row| row.get(0))?;
    if replay {
        tx.conn().execute("INSERT INTO _meta(key, value) VALUES ('dev:suppressed-effects', ?1) ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + CAST(excluded.value AS INTEGER)", [outbox.len().to_string()])?;
    } else {
        for (id, effect, payload) in outbox {
            tx.conn().execute("INSERT INTO _outbox(id, seq, effect, payload, state, attempts, at) VALUES (?1, ?2, ?3, ?4, 'queued', 0, ?5)", params![id, seq as i64, effect, canonical_json(payload), now])?;
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
    })
}

/// The wait before attempt `attempts + 1`: doubling from two seconds.
pub fn backoff_ms(attempts: u32) -> i64 {
    (2_000_i64.saturating_mul(1_i64 << attempts.min(20))).min(MAX_BACKOFF_MS)
}

impl Engine {
    /// Claim up to `limit` queued effects (of one kind, or any) for `worker`
    /// until `now + lease_ms`: oldest first, only those whose backoff has
    /// passed, each counted as an attempt. Two workers never hold one effect.
    pub fn claim_effects(&mut self, worker: &str, effect: Option<&str>, limit: usize, lease_ms: i64, now: i64) -> Result<Vec<EffectRun>, RuntimeError> {
        let limit = limit.clamp(1, 100) as i64;
        let lease = lease_ms.clamp(1_000, MAX_LEASE_MS);
        let tx = self.store.transaction()?;
        let ids: Vec<String> = match effect {
            Some(effect) => tx.conn().prepare("SELECT id FROM _outbox WHERE state = 'queued' AND (next_at IS NULL OR next_at <= ?1) AND effect = ?2 ORDER BY seq, id LIMIT ?3")?.query_map(params![now, effect, limit], |row| row.get(0))?.collect::<Result<_, _>>()?,
            None => tx.conn().prepare("SELECT id FROM _outbox WHERE state = 'queued' AND (next_at IS NULL OR next_at <= ?1) ORDER BY seq, id LIMIT ?2")?.query_map(params![now, limit], |row| row.get(0))?.collect::<Result<_, _>>()?,
        };
        let mut claimed = Vec::with_capacity(ids.len());
        for id in ids {
            tx.conn().execute("UPDATE _outbox SET state = 'running', attempts = attempts + 1, claimed_by = ?2, lease_until = ?3, next_at = NULL, error = NULL WHERE id = ?1", params![id, worker, now + lease])?;
            if let Some(run) = tx.conn().query_row(&format!("SELECT {COLUMNS} FROM _outbox WHERE id = ?1"), [&id], read_run).optional()? {
                claimed.push(run);
            }
        }
        tx.commit()?;
        Ok(claimed)
    }

    /// Settle a claimed effect: `sent` with the worker's result, or a
    /// failure that goes back to the queue after a backoff (until the
    /// attempts run out) or rests as `failed` when the worker says so.
    pub fn settle_effect(&mut self, id: &str, worker: &str, settled: Settled, now: i64) -> Result<EffectRun, RuntimeError> {
        let tx = self.store.transaction()?;
        let Some(run) = tx.conn().query_row(&format!("SELECT {COLUMNS} FROM _outbox WHERE id = ?1"), [id], read_run).optional()? else {
            return Err(RuntimeError::Structural { code: "E_EFFECT_UNKNOWN", message: format!("no effect {id} is queued here") });
        };
        if run.state != "running" || run.claimed_by.as_deref() != Some(worker) {
            return Err(RuntimeError::Structural { code: "E_EFFECT_LEASE", message: format!("effect {id} is {} and not claimed by this worker; claim it first", run.state) });
        }
        match settled {
            Settled::Done { result } => {
                tx.conn().execute("UPDATE _outbox SET state = 'sent', result = ?2, error = NULL, lease_until = NULL WHERE id = ?1", params![id, result.map(|value| canonical_json(&value))])?;
            }
            Settled::Failed { error, retry } => {
                let error: String = error.chars().take(2_000).collect();
                if retry && run.attempts < MAX_ATTEMPTS {
                    tx.conn().execute("UPDATE _outbox SET state = 'queued', error = ?2, next_at = ?3, lease_until = NULL, claimed_by = NULL WHERE id = ?1", params![id, error, now + backoff_ms(run.attempts)])?;
                } else {
                    tx.conn().execute("UPDATE _outbox SET state = 'failed', error = ?2, lease_until = NULL WHERE id = ?1", params![id, error])?;
                }
            }
        }
        let run = tx.conn().query_row(&format!("SELECT {COLUMNS} FROM _outbox WHERE id = ?1"), [id], read_run)?;
        tx.commit()?;
        Ok(run)
    }

    /// Move held leases with an explicit development clock advance. Backoff
    /// timestamps stay put; a lease already overdue remains overdue afterward.
    pub fn advance_effect_leases(&mut self, milliseconds: i64) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        tx.conn().execute("UPDATE _outbox SET lease_until = lease_until + ?1 WHERE state = 'running' AND lease_until IS NOT NULL", [milliseconds])?;
        tx.commit()?;
        Ok(())
    }

    /// A claim whose lease ran out goes back to the queue: the worker died
    /// or stalled, and the attempt it took stays counted.
    pub fn requeue_expired_effects(&mut self, now: i64) -> Result<u64, RuntimeError> {
        let tx = self.store.transaction()?;
        let changed = tx.conn().execute("UPDATE _outbox SET state = CASE WHEN attempts >= ?2 THEN 'failed' ELSE 'queued' END, error = COALESCE(error, 'the lease expired'), lease_until = NULL, claimed_by = NULL, next_at = ?1 WHERE state = 'running' AND lease_until IS NOT NULL AND lease_until < ?1", params![now, MAX_ATTEMPTS as i64])?;
        tx.commit()?;
        Ok(changed as u64)
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
