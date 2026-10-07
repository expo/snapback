//! Request/response I/O outside the data plane. Durable admission is at most
//! once; a handler's delivery is at least once, under a fenced viewer lease.
use super::{Context, Engine, effects::MAX_LEASE_MS, validate};
use crate::{RuntimeError, authority::{self, AuthorityTransaction}, identity, ir::{BinaryOp, Expr, Input, Program, ProgramKind, Stmt, UnaryOp}, store::Tx, value::Value};
use crate::schema::{ActionSpec, Schema};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value as Json;
use std::collections::BTreeMap;

pub const SESSION_SECONDS: i64 = 60;

mod steps;
pub use steps::ActionStep;

pub(crate) fn initialize(conn: &Connection) -> Result<(), RuntimeError> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS _requests (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, args TEXT NOT NULL, principal TEXT NOT NULL,
        at INTEGER NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER, lease_until INTEGER, claimed_by TEXT, session_digest TEXT,
        result TEXT, error TEXT);
        CREATE INDEX IF NOT EXISTS _requests_due ON _requests(state, name, at, id);
        CREATE INDEX IF NOT EXISTS _requests_session ON _requests(session_digest);")?;
    let columns: Vec<String> = conn.prepare("SELECT name FROM pragma_table_info('_requests')")?.query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;
    for (column, kind) in [("family", "TEXT"), ("principal_generation", "INTEGER"), ("admitted_expires_at", "INTEGER"), ("args_digest", "TEXT"), ("error_code", "TEXT"), ("settled_at", "INTEGER"), ("spec", "TEXT"), ("contract", "TEXT"), ("deadline", "INTEGER"), ("release", "TEXT"), ("service_generation", "INTEGER"), ("cancelled", "INTEGER NOT NULL DEFAULT 0")] {
        if !columns.iter().any(|name| name == column) { conn.execute_batch(&format!("ALTER TABLE _requests ADD COLUMN {column} {kind};"))?; }
    }
    steps::initialize(conn)?;
    Ok(())
}

#[derive(Clone, Debug, PartialEq)]
pub struct ActionRequest {
    pub id: String,
    pub action: String,
    pub args: BTreeMap<String, Value>,
    pub principal: String,
    pub at: i64,
    pub state: String,
    pub attempt: u32,
    pub lease_until: Option<i64>,
    pub result: Option<Json>,
    pub error: Option<String>,
    pub error_code: Option<String>,
    pub authority: Option<identity::Authority>,
    pub args_digest: Option<String>,
    pub settled_at: Option<i64>,
    pub spec: ActionSpec,
    pub contract: Option<String>,
    pub deadline: Option<i64>,
    pub release: Option<String>,
    pub service_generation: Option<i64>,
    pub cancelled: bool,
}

#[derive(Clone, Debug)]
pub struct ActionClaim {
    pub request: ActionRequest,
    pub session: identity::Session,
    pub now: i64,
}

pub enum ActionSettled {
    Done(Json),
    Failed { error: String, retry: bool },
    Refused { code: &'static str, error: String },
}

const COLUMNS: &str = "id, name, args, principal, at, state, attempts, lease_until, result, error, error_code, family, principal_generation, admitted_expires_at, args_digest, settled_at, spec, contract, deadline, release, service_generation, cancelled";
fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActionRequest> {
    fn decode<T: serde::de::DeserializeOwned>(text: String, col: usize) -> rusqlite::Result<T> {
        serde_json::from_str(&text).map_err(|error| rusqlite::Error::FromSqlConversionFailure(col, rusqlite::types::Type::Text, Box::new(error)))
    }
    Ok(ActionRequest { id: row.get(0)?, action: row.get(1)?, args: decode(row.get(2)?, 2)?, principal: row.get(3)?, at: row.get(4)?, state: row.get(5)?, attempt: row.get::<_, u32>(6)?, lease_until: row.get(7)?, result: row.get::<_, Option<String>>(8)?.map(|s| decode(s, 8)).transpose()?, error: row.get(9)?, error_code: row.get(10)?,
        authority: match (row.get::<_, Option<String>>(11)?, row.get::<_, Option<i64>>(12)?, row.get::<_, Option<i64>>(13)?) {
            (Some(family), Some(generation), Some(expires_at)) => Some(identity::Authority { family, generation, expires_at }),
            _ => None,
        }, args_digest: row.get(14)?, settled_at: row.get(15)?,
        spec: row.get::<_, Option<String>>(16)?.map(|s| decode(s, 16)).transpose()?.unwrap_or_default(),
        contract: row.get(17)?, deadline: row.get(18)?, release: row.get(19)?, service_generation: row.get(20)?, cancelled: row.get(21)?, })
}
pub(super) fn request(conn: &Connection, id: &str) -> Result<Option<ActionRequest>, RuntimeError> {
    Ok(conn.query_row(&format!("SELECT {COLUMNS} FROM _requests WHERE id = ?1"), [id], read).optional()?)
}
fn unknown() -> RuntimeError { RuntimeError::Structural { code: "E_ACTION_UNKNOWN", message: "no action or request with this name and id is available to this viewer".into() } }
fn lease_error() -> RuntimeError { RuntimeError::Structural { code: "E_ACTION_LEASE", message: "this action claim is not live; claim again and settle with its session token in x-snapback-action-lease".into() } }

pub const AUTHORITY_ERROR: &str = "the authority that admitted this action was revoked or has expired";

pub(super) fn authority_expiry(tx: &Tx<'_>, run: &ActionRequest, now: i64) -> Result<Option<i64>, RuntimeError> {
    let Some(work) = tx.work_by_id(&run.id)? else { return Ok(None) };
    authority::work_authority_expiry(tx, &work, now)
}

fn replay(tx: &Tx<'_>, id: &str, principal: &str, name: &str, args: &Json, now: i64) -> Result<Option<ActionRequest>, RuntimeError> {
    let Some(run) = request(tx.conn(), id)? else { return Ok(None); };
    if run.principal != principal || authority_expiry(tx, &run, now)?.is_none() { return Err(unknown()); }
    if run.action != name { return Err(if run.args_digest.is_some() { crate::store::id_reused() } else { unknown() }); }
    if let Some(digest) = &run.args_digest {
        if crate::store::payload_digest(args) != *digest { return Err(crate::store::id_reused()); }
    }
    Ok(Some(run))
}

/// An action's compiled body is only its rule. Refuse any other IR rather
/// than accidentally running data-plane statements as an action.
/// Shared by declaration checking and runtime admission; schedules must not
/// pass `check` only to fail the identical static rule during activation.
pub fn authorize(program: &Program, viewer: &str) -> Result<(), RuntimeError> {
    fn value(expr: &Expr, viewer: &str) -> Option<Value> {
        Some(match expr {
            Expr::Literal(v @ (Value::Bool(_) | Value::Id(_))) => v.clone(),
            Expr::Input(Input::Viewer) => Value::Id(viewer.into()),
            Expr::Unary { op: UnaryOp::Not, value: v } => match value(v, viewer)? { Value::Bool(v) => Value::Bool(!v), _ => return None },
            Expr::Binary { op, left, right } => {
                let (a, b) = (value(left, viewer)?, value(right, viewer)?);
                Value::Bool(match (op, a, b) {
                    (BinaryOp::Eq, a, b) => a == b,
                    (BinaryOp::Ne, a, b) => a != b,
                    (BinaryOp::And, Value::Bool(a), Value::Bool(b)) => a && b,
                    (BinaryOp::Or, Value::Bool(a), Value::Bool(b)) => a || b,
                    _ => return None,
                })
            }
            _ => return None,
        })
    }
    if program.kind != ProgramKind::Action { return Err(unknown()); }
    let allowed = match program.body.as_slice() { [Stmt::Require { condition, .. }] => value(condition, viewer) == Some(Value::Bool(true)), _ => false };
    if !allowed { return Err(RuntimeError::Require { code: "E_RULE".into(), site: Some(format!("actions.{}", program.name)) }); }
    Ok(())
}

fn finish(tx: &Tx<'_>, id: &str, state: &str, code: &str, error: &str, now: i64) -> Result<(), RuntimeError> {
    if let Some(work) = tx.work_by_id(id)? && let Some(digest) = work.session_digest { tx.invalidate_session(&digest)?; }
    // Retain the last claim fence so an in-flight handler may observe cancellation.
    tx.conn().execute("UPDATE _requests SET state = ?2, error_code = ?3, error = ?4, result = NULL, next_at = NULL, settled_at = ?5 WHERE id = ?1", params![id, state, code, error, now])?;
    Ok(())
}

fn expire(tx: &Tx<'_>, now: i64) -> Result<u64, RuntimeError> {
    expire_batch(tx, now, i64::MAX, std::time::Duration::MAX)
}

fn expire_batch(tx: &Tx<'_>, now: i64, limit: i64, budget: std::time::Duration) -> Result<u64, RuntimeError> {
    let started = std::time::Instant::now();
    let runs = tx.conn().prepare(&format!("SELECT {COLUMNS} FROM _requests WHERE state IN ('queued', 'running') AND (deadline <= ?1 OR (state = 'running' AND lease_until <= ?1)) LIMIT ?2"))?
        .query_map([now, limit], read)?.collect::<Result<Vec<_>, _>>()?;
    let mut changed = 0;
    for run in &runs {
        if changed > 0 && started.elapsed() >= budget { break; }
        if run.deadline.is_some_and(|deadline| deadline <= now) {
            finish(tx, &run.id, "failed", "E_ACTION_DEADLINE", "the action deadline passed", now)?;
        } else if run.attempt >= run.spec.work.policy.max_attempts {
            finish(tx, &run.id, "failed", "E_ACTION_ATTEMPTS", "the action exhausted its attempts", now)?;
        } else {
            if let Some(work) = tx.work_by_id(&run.id)? && let Some(digest) = work.session_digest { tx.invalidate_session(&digest)?; }
            tx.conn().execute("UPDATE _requests SET state = 'queued', error = 'the action lease expired', error_code = NULL, next_at = ?2, lease_until = NULL, claimed_by = NULL, session_digest = NULL WHERE id = ?1", params![run.id, now])?;
        }
        changed += 1;
    }
    Ok(changed)
}

/// Delegated credentials remain dependent on the admitted authority in flight,
/// not merely at claim time. Revocation cannot leave a live independent seat.
pub(crate) fn held_claim_authority(tx: &Tx<'_>, id: &str, worker: &str, token: &str, now: i64) -> Result<ActionRequest, RuntimeError> {
    let run = request(tx.conn(), id)?.ok_or_else(unknown)?;
    let digest = identity::digest(token);
    if !authority::held_claim_authority(tx, id, worker, &digest, now)? { return Err(lease_error()); }
    Ok(run)
}

pub(super) fn insert_request(tx: &Tx<'_>, schema: &Schema, program: &Program, id: &str, context: &Context, raw: &Json, service: bool, now: i64) -> Result<(), RuntimeError> {
    let spec = schema.action_specs.get(&program.name).cloned().unwrap_or_default();
    insert_spec(tx, program, id, context, raw, service, &spec, &spec.contract(program), now)
}

/// Routes use the same durable record and authority binding, with their
/// declaration's contract rather than a public action program's contract.
pub(super) fn insert_spec(tx: &Tx<'_>, program: &Program, id: &str, context: &Context, raw: &Json, service: bool, spec: &ActionSpec, contract: &str, now: i64) -> Result<(), RuntimeError> {
    if !spec.work.policy.valid() { return Err(RuntimeError::Schema("the action policy is outside its bounds".into())); }
    let authority = context.session_digest.as_deref().map(|digest| identity::authority(tx, digest, &context.viewer, now)).transpose()?;
    let service_generation = if service { Some(identity::principal_generation(tx, &context.viewer)?) } else { None };
    let release: Option<String> = tx.conn().query_row("SELECT value FROM _meta WHERE key = 'release'", [], |row| row.get(0)).optional()?;
    tx.conn().execute("INSERT INTO _requests(id, name, args, principal, at, state, family, principal_generation, admitted_expires_at, args_digest, spec, contract, deadline, release, service_generation) VALUES (?1, ?2, ?3, ?4, ?5, 'queued', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![id, program.name, serde_json::to_string(&context.args).map_err(|e| RuntimeError::Input(e.to_string()))?, context.viewer, now,
            authority.as_ref().map(|a| &a.family), authority.as_ref().map(|a| a.generation), authority.as_ref().map(|a| a.expires_at), crate::store::payload_digest(raw),
            serde_json::to_string(&spec).map_err(|e| RuntimeError::Schema(e.to_string()))?, contract, spec.work.policy.deadline_ms.map(|ms| now.saturating_add(ms as i64)), release, service_generation])?;
    Ok(())
}

impl Engine {
    // @ref LLP 3000.007#9.2 — durable action admission precedes the worker and survives retries by id.
    pub fn request_action(&mut self, name: &str, id: &str, mut context: Context) -> Result<(ActionRequest, bool), RuntimeError> {
        if context.viewer == crate::SYSTEM_PRINCIPAL || !crate::value::identity_fits(&context.viewer) {
            return Err(RuntimeError::Auth("an action needs a signed-in principal".into()));
        }
        if id.len() > 128 || !crate::value::identity_fits(id) || id.starts_with(super::routes::ID_PREFIX) { return Err(RuntimeError::Input("an action id is 1–128 printable characters, minted by the client; route:v1: is reserved for admitted routes".into())); }
        let now = context.now.unwrap_or_else(crate::now_ms);
        let wire_args = context.wire_args.take().unwrap_or_else(|| Json::Object(crate::wire::map_to_json(&context.args)));
        let tx = self.store.transaction()?;
        if let Some(recorded) = replay(&tx, id, &context.viewer, name, &wire_args, now)? {
            tx.rollback()?;
            return Ok((recorded, true));
        }
        let program = self.programs.get(name).ok_or_else(unknown)?;
        validate::validate_inputs(&self.schema, program, &mut context.args)?;
        authorize(program, &context.viewer)?;
        let args = serde_json::to_string(&context.args).map_err(|e| RuntimeError::Input(e.to_string()))?;
        if args.len() as u64 > self.ceilings.heap_bytes { return Err(RuntimeError::Input("action arguments exceed the heap bound".into())); }
        insert_request(&tx, &self.schema, program, id, &context, &wire_args, false, now)?;
        let run = request(tx.conn(), id)?.ok_or_else(unknown)?;
        tx.commit()?;
        Ok((run, false))
    }

    pub fn action_request(&self, id: &str, principal: &str) -> Result<ActionRequest, RuntimeError> {
        self.action_request_at(id, principal, crate::now_ms())
    }

    pub fn action_request_at(&self, id: &str, principal: &str, now: i64) -> Result<ActionRequest, RuntimeError> {
        let tx = self.store.authority_transaction()?;
        let run = request(tx.conn(), id)?.filter(|run| run.principal == principal).ok_or_else(unknown)?;
        if authority_expiry(&tx, &run, now)?.is_none() { return Err(unknown()); }
        tx.rollback()?;
        Ok(run)
    }

    pub fn replay_action(&self, id: &str, principal: &str, name: &str, args: &Json, now: i64) -> Result<Option<ActionRequest>, RuntimeError> {
        // The public action fast path must not collect private route responses
        // before ingress has authenticated this delivery (including a replay).
        if id.starts_with(super::routes::ID_PREFIX) || name.starts_with(crate::schema::routes::ACTION_PREFIX) { return Err(unknown()); }
        let tx = self.store.authority_transaction()?;
        let answer = replay(&tx, id, principal, name, args, now)?;
        tx.rollback()?;
        Ok(answer)
    }

    /// `session_seconds` is chosen per action by the worker. A lease ends
    /// at the earlier of its requested duration and the viewer session's.
    pub fn claim_actions(&mut self, worker: &str, action: Option<&str>, limit: usize, lease_ms: i64, session_seconds: i64, now: i64) -> Result<Vec<ActionClaim>, RuntimeError> {
        self.claim_selected_actions(worker, action, None, limit, lease_ms, session_seconds, now)
    }

    /// A generated registry polls one bounded name set, not one long poll per
    /// handler. Callers group names by their requested session lifetime.
    // @ref LLP 3000.009#5.1 — bounded claim-only coupling cannot starve route verification.
    pub fn claim_action_set(&mut self, worker: &str, actions: &[String], limit: usize, lease_ms: i64, session_seconds: i64, now: i64) -> Result<Vec<ActionClaim>, RuntimeError> {
        if actions.is_empty() || actions.len() > 128 || actions.iter().any(|name| name.is_empty()) {
            return Err(RuntimeError::Input("claim actions must contain 1–128 nonempty names".into()));
        }
        let names = serde_json::to_string(actions).map_err(|error| RuntimeError::Input(error.to_string()))?;
        self.claim_selected_actions(worker, None, Some(&names), limit, lease_ms, session_seconds, now)
    }

    fn claim_selected_actions(&mut self, worker: &str, action: Option<&str>, names: Option<&str>, limit: usize, lease_ms: i64, session_seconds: i64, now: i64) -> Result<Vec<ActionClaim>, RuntimeError> {
        if !identity::is_service(worker) { return Err(RuntimeError::Auth("actions are claimed by a service".into())); }
        let duration = lease_ms.clamp(1_000, MAX_LEASE_MS).min(session_seconds.clamp(1, MAX_LEASE_MS / 1_000) * 1_000);
        let tx = self.store.transaction()?;
        expire(&tx, now)?;
        let ids: Vec<String> = tx.conn().prepare("SELECT id FROM _requests WHERE state = 'queued' AND (next_at IS NULL OR next_at <= ?1) AND (?2 IS NULL OR name = ?2) AND (?4 IS NULL OR name IN (SELECT value FROM json_each(?4))) ORDER BY at, id LIMIT ?3")?.query_map(params![now, action, limit.clamp(1, 100) as i64, names], |row| row.get(0))?.collect::<Result<_, _>>()?;
        let mut claims = Vec::new();
        for id in ids {
            let run = request(tx.conn(), &id)?.ok_or_else(unknown)?;
            if let Some(contract) = &run.contract {
                let current = if let Some(name) = run.action.strip_prefix(crate::schema::routes::ACTION_PREFIX) {
                    self.schema.routes.get(name).map(|route| route.contract(name))
                } else { self.programs.get(&run.action).map(|program| self.schema.action_specs.get(&run.action).cloned().unwrap_or_default().contract(program)) };
                if current.as_ref() != Some(contract) {
                    finish(&tx, &id, "parked", "E_ACTION_GENERATION", "the admitted action declaration changed; inspect this work before replacing it", now)?;
                    continue;
                }
            }
            // @ref LLP 3000.009#5.1 — a claim borrows only authority that still stands.
            let Some(expiry) = authority_expiry(&tx, &run, now)? else {
                tx.conn().execute("UPDATE _requests SET state = 'failed', error_code = 'E_ACTION_AUTHORITY', error = ?2, settled_at = ?3, next_at = NULL, lease_until = NULL, claimed_by = NULL, session_digest = NULL WHERE id = ?1", params![id, AUTHORITY_ERROR, now])?;
                continue;
            };
            let session = identity::action_session(tx.conn(), &run.principal, now, now.saturating_add(duration).min(expiry).min(run.deadline.unwrap_or(i64::MAX)))?;
            tx.conn().execute("UPDATE _requests SET state = 'running', attempts = attempts + 1, claimed_by = ?2, session_digest = ?3, lease_until = ?4, next_at = NULL, error = NULL, error_code = NULL WHERE id = ?1", params![id, worker, identity::digest(&session.token), session.expires_at])?;
            claims.push(ActionClaim { request: request(tx.conn(), &id)?.ok_or_else(unknown)?, session, now });
        }
        tx.commit()?;
        Ok(claims)
    }

    pub fn settle_action(&mut self, id: &str, worker: &str, lease_token: &str, mut settled: ActionSettled, now: i64) -> Result<ActionRequest, RuntimeError> {
        let tx = self.store.transaction()?;
        let run = held_claim_authority(&tx, id, worker, lease_token, now)?;
        let digest = identity::digest(lease_token);
        let mut application_refusal = None;
        if run.action.starts_with(crate::schema::routes::ACTION_PREFIX) && let ActionSettled::Done(value) = &settled {
            let validated = serde_json::from_value::<crate::schema::routes::RouteResponse>(value.clone()).map_err(|_| "the route response has an invalid envelope".to_owned())
                .and_then(|response| response.validate().map(|_| response));
            match validated {
                Err(message) => {
                    finish(&tx, id, "failed", "E_ROUTE_RESULT", &message, now)?;
                    let run = request(tx.conn(), id)?.ok_or_else(unknown)?;
                    tx.commit()?;
                    return Ok(run);
                }
                Ok(response) if response.status >= 500 => {
                    settled = ActionSettled::Failed { error: format!("route handler answered HTTP {}; no completion was recorded", response.status), retry: true };
                }
                Ok(response) => application_refusal = response.application_refusal,
            }
        }
        // Validate only after proving the claim. An invalid result is terminal:
        // the provider may already have acted, so retrying it would be unsafe.
        // @ref LLP 3000.009#5.1 — settlement validates the admitted result contract.
        let result = if let ActionSettled::Done(value) = &settled {
            let validated = result_json(&self.schema, &run.spec, value.clone(), self.ceilings.output_bytes);
            let validated = match validated {
                Ok(_) if !result_assets(&tx, &run.spec, value)? => Err("a result asset does not match its recorded kind, facts or declared byte bound".into()),
                other => other,
            };
            match validated {
                Ok(result) => Some(result),
                Err(message) => {
                    finish(&tx, id, "failed", "E_ACTION_RESULT", &message, now)?;
                    let run = request(tx.conn(), id)?.ok_or_else(unknown)?;
                    tx.commit()?;
                    return Ok(run);
                }
            }
        } else { None };
        // The claim token fences the attempt even when the next worker
        // uses the same service seat. No secret is persisted in plaintext.
        tx.invalidate_session(&digest)?;
        let (state, error, next_at) = match settled {
            ActionSettled::Done(_) => ("done", application_refusal.clone(), None),
            ActionSettled::Refused { code, error } => {
                finish(&tx, id, "failed", code, &error.chars().take(2_000).collect::<String>(), now)?;
                let run = request(tx.conn(), id)?.ok_or_else(unknown)?;
                tx.commit()?;
                return Ok(run);
            }
            ActionSettled::Failed { error, retry } => {
                let error: String = error.chars().take(2_000).collect();
                if retry && run.attempt < run.spec.work.policy.max_attempts { ("queued", Some(error), Some(now.saturating_add(run.spec.work.policy.backoff(run.attempt)))) }
                else { ("failed", Some(error), None) }
            }
        };
        tx.conn().execute("UPDATE _requests SET state = ?2, result = ?3, error = ?4, next_at = ?5, claimed_by = NULL, session_digest = NULL, lease_until = NULL, error_code = ?7, settled_at = ?6 WHERE id = ?1", params![id, state, result, error, next_at, if state == "queued" { None } else { Some(now) }, application_refusal.as_ref().map(|_| "E_ROUTE_REFUSED")])?;
        let run = request(tx.conn(), id)?.ok_or_else(unknown)?;
        tx.commit()?;
        Ok(run)
    }

    /// Cancellation does not undo external effects. It revokes the delegated
    /// credential now and lets the process observe the cooperative signal.
    pub fn cancel_action(&mut self, id: &str, principal: &str, now: i64) -> Result<ActionRequest, RuntimeError> {
        let tx = self.store.transaction()?;
        let run = request(tx.conn(), id)?.filter(|run| run.principal == principal).ok_or_else(unknown)?;
        if authority_expiry(&tx, &run, now)?.is_none() { return Err(unknown()); }
        if !run.spec.work.policy.cancellable { return Err(RuntimeError::Structural { code: "E_ACTION_CANCELLATION", message: "this action declaration does not allow cancellation".into() }); }
        if matches!(run.state.as_str(), "queued" | "running" | "parked") {
            finish(&tx, id, "failed", "E_ACTION_CANCELLED", "the action was cancelled; external effects are not undone", now)?;
            tx.conn().execute("UPDATE _requests SET cancelled = 1 WHERE id = ?1", [id])?;
        }
        let run = request(tx.conn(), id)?.ok_or_else(unknown)?;
        tx.commit()?;
        Ok(run)
    }

    pub fn action_status(&mut self, id: &str, worker: &str, lease_token: &str, now: i64) -> Result<ActionRequest, RuntimeError> {
        let tx = self.store.transaction()?;
        expire(&tx, now)?;
        let digest = identity::digest(lease_token);
        let matches = tx.work_by_id(id)?.is_some_and(|work| authority::claim_is_owned(&work, worker, &digest));
        if !matches { return Err(lease_error()); }
        let mut run = request(tx.conn(), id)?.ok_or_else(unknown)?;
        if run.state == "running" && authority_expiry(&tx, &run, now)?.is_none() {
            finish(&tx, id, "failed", "E_ACTION_AUTHORITY", AUTHORITY_ERROR, now)?;
            run = request(tx.conn(), id)?.ok_or_else(unknown)?;
        }
        tx.commit()?;
        Ok(run)
    }

    pub fn requeue_expired_actions(&mut self, now: i64) -> Result<u64, RuntimeError> {
        let tx = self.store.transaction()?;
        let changed = expire(&tx, now)?;
        tx.commit()?;
        Ok(changed)
    }

    /// A bounded maintenance pass; claims retain their full expiry checks.
    pub fn requeue_expired_actions_for(&mut self, now: i64, budget: std::time::Duration) -> Result<u64, RuntimeError> {
        let tx = self.store.transaction()?;
        let changed = expire_batch(&tx, now, 256, budget)?;
        tx.commit()?;
        Ok(changed)
    }

    pub fn action_counts(&self) -> Result<BTreeMap<String, u64>, RuntimeError> {
        Ok(self.store.conn().prepare("SELECT state, COUNT(*) FROM _requests GROUP BY state")?.query_map([], |row| Ok((row.get(0)?, row.get::<_, i64>(1)? as u64)))?.collect::<Result<_, _>>()?)
    }
}

fn result_assets(tx: &crate::store::Tx<'_>, spec: &ActionSpec, result: &Json) -> Result<bool, RuntimeError> {
    use crate::{assets::AssetKind, ir::ArgType};
    fn field(tx: &crate::store::Tx<'_>, kind: &ArgType, value: &Json) -> Result<bool, RuntimeError> {
        Ok(match kind {
            ArgType::Optional(_) if value.is_null() => true,
            ArgType::Optional(inner) => field(tx, inner, value)?,
            ArgType::List { of: Some(inner), .. } | ArgType::ListRange { of: Some(inner), .. } => {
                for item in value.as_array().expect("validated list") {
                    if !field(tx, inner, item)? { return Ok(false); }
                }
                true
            }
            ArgType::Image { max, .. } | ArgType::Video { max } => {
                let fields = value.as_object().expect("validated asset");
                let id = fields["id"].as_str().expect("validated asset id");
                let Some(asset) = tx.asset(id)? else { return Ok(false) };
                let wanted = if matches!(kind, ArgType::Image { .. }) { AssetKind::Image } else { AssetKind::Video };
                let facts = crate::wire::to_json(&asset.column_value());
                // Do not expand the handler's result with facts it did not
                // return. Supplied facts must equal the server's metadata;
                // neither a claimed byte count nor extra fields can slip in.
                asset.kind == wanted && asset.bytes <= u64::from(*max)
                    && fields.iter().all(|(key, value)| facts.get(key) == Some(value))
            }
            _ => true,
        })
    }
    if let Some(fields) = &spec.returns {
        for (name, kind) in fields {
            if !field(tx, kind, result.get(name).unwrap_or(&Json::Null))? { return Ok(false); }
        }
    }
    Ok(true)
}

fn result_json(schema: &Schema, spec: &ActionSpec, mut result: Json, ceiling: u64) -> Result<String, String> {
    if let Some(fields) = &spec.returns {
        let object = result.as_object_mut().ok_or("the result must be the declared object")?;
        if object.keys().any(|name| !fields.contains_key(name)) { return Err("the result has undeclared fields".into()); }
        for (name, kind) in fields {
            if kind.is_optional() { object.entry(name.clone()).or_insert(Json::Null); }
            let raw = object.get(name).ok_or_else(|| format!("the result is missing field {name}"))?;
            let value = crate::wire::from_json(kind, raw).map_err(|_| format!("result field {name} does not match its declared type"))?;
            validate::validate_arg(schema, kind, &value, name).map_err(|_| format!("result field {name} does not match its declared type or bound"))?;
        }
    }
    let bytes = serde_json::to_string(&result).map_err(|_| "the result is not JSON")?;
    if bytes.len() as u64 > ceiling { return Err("the result exceeds the output byte ceiling".into()); }
    Ok(bytes)
}
