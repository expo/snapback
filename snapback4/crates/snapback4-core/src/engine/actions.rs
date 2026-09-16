//! Request/response I/O outside the data plane. Durable admission is at most
//! once; a handler's delivery is at least once, under a fenced viewer lease.
use super::{Context, Engine, effects::{MAX_ATTEMPTS, MAX_LEASE_MS, backoff_ms}, validate};
use crate::{RuntimeError, identity, ir::{BinaryOp, Expr, Input, Program, ProgramKind, Stmt, UnaryOp}, value::Value};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value as Json;
use std::collections::BTreeMap;

pub const SESSION_SECONDS: i64 = 60;

pub(crate) fn initialize(conn: &Connection) -> Result<(), RuntimeError> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS _requests (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, args TEXT NOT NULL, principal TEXT NOT NULL,
        at INTEGER NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER, lease_until INTEGER, claimed_by TEXT, session_digest TEXT,
        result TEXT, error TEXT);
        CREATE INDEX IF NOT EXISTS _requests_due ON _requests(state, name, at, id);
        CREATE INDEX IF NOT EXISTS _requests_session ON _requests(session_digest);")?;
    let columns: Vec<String> = conn.prepare("SELECT name FROM pragma_table_info('_requests')")?.query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;
    for (column, kind) in [("family", "TEXT"), ("principal_generation", "INTEGER"), ("admitted_expires_at", "INTEGER"), ("args_digest", "TEXT"), ("error_code", "TEXT"), ("settled_at", "INTEGER")] {
        if !columns.iter().any(|name| name == column) { conn.execute_batch(&format!("ALTER TABLE _requests ADD COLUMN {column} {kind};"))?; }
    }
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
}

#[derive(Clone, Debug)]
pub struct ActionClaim {
    pub request: ActionRequest,
    pub session: identity::Session,
}

pub enum ActionSettled {
    Done(Json),
    Failed { error: String, retry: bool },
}

const COLUMNS: &str = "id, name, args, principal, at, state, attempts, lease_until, result, error, error_code, family, principal_generation, admitted_expires_at, args_digest, settled_at";
fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActionRequest> {
    fn decode<T: serde::de::DeserializeOwned>(text: String, col: usize) -> rusqlite::Result<T> {
        serde_json::from_str(&text).map_err(|error| rusqlite::Error::FromSqlConversionFailure(col, rusqlite::types::Type::Text, Box::new(error)))
    }
    Ok(ActionRequest { id: row.get(0)?, action: row.get(1)?, args: decode(row.get(2)?, 2)?, principal: row.get(3)?, at: row.get(4)?, state: row.get(5)?, attempt: row.get::<_, u32>(6)?, lease_until: row.get(7)?, result: row.get::<_, Option<String>>(8)?.map(|s| decode(s, 8)).transpose()?, error: row.get(9)?, error_code: row.get(10)?,
        authority: match (row.get::<_, Option<String>>(11)?, row.get::<_, Option<i64>>(12)?, row.get::<_, Option<i64>>(13)?) {
            (Some(family), Some(generation), Some(expires_at)) => Some(identity::Authority { family, generation, expires_at }),
            _ => None,
        }, args_digest: row.get(14)?, settled_at: row.get(15)?, })
}
fn request(conn: &Connection, id: &str) -> Result<Option<ActionRequest>, RuntimeError> {
    Ok(conn.query_row(&format!("SELECT {COLUMNS} FROM _requests WHERE id = ?1"), [id], read).optional()?)
}
fn unknown() -> RuntimeError { RuntimeError::Structural { code: "E_ACTION_UNKNOWN", message: "no action or request with this name and id is available to this viewer".into() } }
fn lease_error() -> RuntimeError { RuntimeError::Structural { code: "E_ACTION_LEASE", message: "this action claim is not live; claim again and settle with its session token in x-snapback-action-lease".into() } }

pub const AUTHORITY_ERROR: &str = "the authority that admitted this action was revoked or has expired";

fn authority_expiry(conn: &Connection, run: &ActionRequest, now: i64) -> Result<Option<i64>, RuntimeError> {
    match &run.authority {
        Some(binding) => identity::authority_expiry(conn, &run.principal, &binding.family, binding.generation, now),
        None => Ok(Some(i64::MAX)), // Legacy rows and development personas have no recorded session.
    }
}

fn replay(conn: &Connection, id: &str, principal: &str, name: &str, args: &Json, now: i64) -> Result<Option<ActionRequest>, RuntimeError> {
    let Some(run) = request(conn, id)? else { return Ok(None); };
    if run.principal != principal || authority_expiry(conn, &run, now)?.is_none() { return Err(unknown()); }
    if run.action != name { return Err(if run.args_digest.is_some() { crate::store::id_reused() } else { unknown() }); }
    if let Some(digest) = &run.args_digest {
        if crate::store::payload_digest(args) != *digest { return Err(crate::store::id_reused()); }
    }
    Ok(Some(run))
}

/// An action's compiled body is only its rule. Refuse any other IR rather
/// than accidentally running data-plane statements as an action.
fn authorize(program: &Program, viewer: &str) -> Result<(), RuntimeError> {
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

fn expire(conn: &Connection, now: i64) -> Result<u64, RuntimeError> {
    conn.execute("DELETE FROM _sessions WHERE token_digest IN (SELECT session_digest FROM _requests WHERE state = 'running' AND lease_until <= ?1)", [now])?;
    Ok(conn.execute("UPDATE _requests SET state = CASE WHEN attempts >= ?2 THEN 'failed' ELSE 'queued' END, error = 'the action lease expired', error_code = NULL, settled_at = CASE WHEN attempts >= ?2 THEN ?1 ELSE NULL END, next_at = ?1, lease_until = NULL, claimed_by = NULL, session_digest = NULL WHERE state = 'running' AND lease_until <= ?1", params![now, MAX_ATTEMPTS])? as u64)
}

impl Engine {
    // @ref LLP 3000.007#9.2 — durable action admission precedes the worker and survives retries by id.
    pub fn request_action(&mut self, name: &str, id: &str, mut context: Context) -> Result<(ActionRequest, bool), RuntimeError> {
        if context.viewer == crate::SYSTEM_PRINCIPAL || !crate::value::identity_fits(&context.viewer) {
            return Err(RuntimeError::Auth("an action needs a signed-in principal".into()));
        }
        if id.len() > 128 || !crate::value::identity_fits(id) { return Err(RuntimeError::Input("an action id is 1–128 printable characters, minted by the client".into())); }
        let now = context.now.unwrap_or_else(crate::now_ms);
        let wire_args = context.wire_args.take().unwrap_or_else(|| Json::Object(crate::wire::map_to_json(&context.args)));
        let tx = self.store.transaction()?;
        if let Some(recorded) = replay(tx.conn(), id, &context.viewer, name, &wire_args, now)? {
            tx.rollback()?;
            return Ok((recorded, true));
        }
        let program = self.programs.get(name).ok_or_else(unknown)?;
        validate::validate_inputs(&self.schema, program, &mut context.args)?;
        authorize(program, &context.viewer)?;
        let args = serde_json::to_string(&context.args).map_err(|e| RuntimeError::Input(e.to_string()))?;
        if args.len() as u64 > self.ceilings.heap_bytes { return Err(RuntimeError::Input("action arguments exceed the heap bound".into())); }
        let authority = context.session_digest.as_deref().map(|digest| identity::authority(tx.conn(), digest, &context.viewer, now)).transpose()?;
        tx.conn().execute("INSERT INTO _requests(id, name, args, principal, at, state, family, principal_generation, admitted_expires_at, args_digest) VALUES (?1, ?2, ?3, ?4, ?5, 'queued', ?6, ?7, ?8, ?9)",
            params![id, name, args, context.viewer, now, authority.as_ref().map(|a| &a.family), authority.as_ref().map(|a| a.generation), authority.as_ref().map(|a| a.expires_at), crate::store::payload_digest(&wire_args)])?;
        let run = request(tx.conn(), id)?.ok_or_else(unknown)?;
        tx.commit()?;
        Ok((run, false))
    }

    pub fn action_request(&self, id: &str, principal: &str) -> Result<ActionRequest, RuntimeError> {
        self.action_request_at(id, principal, crate::now_ms())
    }

    pub fn action_request_at(&self, id: &str, principal: &str, now: i64) -> Result<ActionRequest, RuntimeError> {
        let run = request(self.store.conn(), id)?.filter(|run| run.principal == principal).ok_or_else(unknown)?;
        if authority_expiry(self.store.conn(), &run, now)?.is_none() { return Err(unknown()); }
        Ok(run)
    }

    pub fn replay_action(&self, id: &str, principal: &str, name: &str, args: &Json, now: i64) -> Result<Option<ActionRequest>, RuntimeError> {
        replay(self.store.conn(), id, principal, name, args, now)
    }

    /// `session_seconds` is chosen per action by the worker. A lease ends
    /// at the earlier of its requested duration and the viewer session's.
    pub fn claim_actions(&mut self, worker: &str, action: Option<&str>, limit: usize, lease_ms: i64, session_seconds: i64, now: i64) -> Result<Vec<ActionClaim>, RuntimeError> {
        if !identity::is_service(worker) { return Err(RuntimeError::Auth("actions are claimed by a service".into())); }
        let duration = lease_ms.clamp(1_000, MAX_LEASE_MS).min(session_seconds.clamp(1, MAX_LEASE_MS / 1_000) * 1_000);
        let tx = self.store.transaction()?;
        expire(tx.conn(), now)?;
        let ids: Vec<String> = tx.conn().prepare("SELECT id FROM _requests WHERE state = 'queued' AND (next_at IS NULL OR next_at <= ?1) AND (?2 IS NULL OR name = ?2) ORDER BY at, id LIMIT ?3")?.query_map(params![now, action, limit.clamp(1, 100) as i64], |row| row.get(0))?.collect::<Result<_, _>>()?;
        let mut claims = Vec::new();
        for id in ids {
            let run = request(tx.conn(), &id)?.ok_or_else(unknown)?;
            // @ref LLP 3000.009#5.1 — a claim borrows only authority that still stands.
            let Some(expiry) = authority_expiry(tx.conn(), &run, now)? else {
                tx.conn().execute("UPDATE _requests SET state = 'failed', error_code = 'E_ACTION_AUTHORITY', error = ?2, settled_at = ?3, next_at = NULL, lease_until = NULL, claimed_by = NULL, session_digest = NULL WHERE id = ?1", params![id, AUTHORITY_ERROR, now])?;
                continue;
            };
            let session = identity::action_session(tx.conn(), &run.principal, now, now.saturating_add(duration).min(expiry))?;
            tx.conn().execute("UPDATE _requests SET state = 'running', attempts = attempts + 1, claimed_by = ?2, session_digest = ?3, lease_until = ?4, next_at = NULL, error = NULL, error_code = NULL WHERE id = ?1", params![id, worker, identity::digest(&session.token), session.expires_at])?;
            claims.push(ActionClaim { request: request(tx.conn(), &id)?.ok_or_else(unknown)?, session });
        }
        tx.commit()?;
        Ok(claims)
    }

    pub fn settle_action(&mut self, id: &str, worker: &str, lease_token: &str, settled: ActionSettled, now: i64) -> Result<ActionRequest, RuntimeError> {
        let result = match &settled {
            ActionSettled::Done(result) => {
                let bytes = serde_json::to_string(result).map_err(|e| RuntimeError::Input(e.to_string()))?;
                if bytes.len() as u64 > self.ceilings.output_bytes { return Err(RuntimeError::Bound { kind: crate::error::MeterKind::OutputBytes, actual: bytes.len() as u64, ceiling: self.ceilings.output_bytes, site: format!("actions.{id}.result") }); }
                Some(bytes)
            }
            _ => None,
        };
        let tx = self.store.transaction()?;
        let run = request(tx.conn(), id)?.ok_or_else(unknown)?;
        let digest = identity::digest(lease_token);
        let held: bool = tx.conn().query_row("SELECT state = 'running' AND claimed_by = ?2 AND session_digest = ?3 AND lease_until > ?4 FROM _requests WHERE id = ?1", params![id, worker, digest, now], |row| row.get::<_, Option<bool>>(0))?.unwrap_or(false);
        if !held { return Err(lease_error()); }
        // The claim token fences the attempt even when the next worker
        // uses the same service seat. No secret is persisted in plaintext.
        tx.conn().execute("DELETE FROM _sessions WHERE token_digest = ?1", [&digest])?;
        let (state, error, next_at) = match settled {
            ActionSettled::Done(_) => ("done", None, None),
            ActionSettled::Failed { error, retry } => {
                let error: String = error.chars().take(2_000).collect();
                if retry && run.attempt < MAX_ATTEMPTS { ("queued", Some(error), Some(now.saturating_add(backoff_ms(run.attempt.saturating_sub(1))))) }
                else { ("failed", Some(error), None) }
            }
        };
        tx.conn().execute("UPDATE _requests SET state = ?2, result = ?3, error = ?4, next_at = ?5, claimed_by = NULL, session_digest = NULL, lease_until = NULL, error_code = NULL, settled_at = ?6 WHERE id = ?1", params![id, state, result, error, next_at, if state == "queued" { None } else { Some(now) }])?;
        let run = request(tx.conn(), id)?.ok_or_else(unknown)?;
        tx.commit()?;
        Ok(run)
    }

    pub fn requeue_expired_actions(&mut self, now: i64) -> Result<u64, RuntimeError> {
        let tx = self.store.transaction()?;
        let changed = expire(tx.conn(), now)?;
        tx.commit()?;
        Ok(changed)
    }

    pub fn action_counts(&self) -> Result<BTreeMap<String, u64>, RuntimeError> {
        Ok(self.store.conn().prepare("SELECT state, COUNT(*) FROM _requests GROUP BY state")?.query_map([], |row| Ok((row.get(0)?, row.get::<_, i64>(1)? as u64)))?.collect::<Result<_, _>>()?)
    }
}
