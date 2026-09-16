//! A step records its start before I/O and its outcome afterwards. No database
//! transaction spans the provider call. Uncertain I/O is reconciled or parked.
use super::*;
use serde::Serialize;

pub(super) fn initialize(conn: &Connection) -> Result<(), RuntimeError> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS _action_steps (
        invocation TEXT NOT NULL, name TEXT NOT NULL, input_digest TEXT NOT NULL,
        provider_key TEXT NOT NULL, state TEXT NOT NULL, claim_digest TEXT NOT NULL,
        result TEXT, at INTEGER NOT NULL, settled_at INTEGER, error TEXT,
        PRIMARY KEY(invocation, name));")?;
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ActionStep {
    pub state: String,
    pub key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Json>,
}

fn invalid(code: &'static str, message: &str) -> RuntimeError {
    RuntimeError::Structural { code, message: message.into() }
}

fn name_fits(name: &str) -> Result<(), RuntimeError> {
    if name.len() > 128 || !crate::value::identity_fits(name) {
        return Err(invalid("E_STEP_INPUT", "a step name is 1–128 printable characters"));
    }
    Ok(())
}

struct Record { digest: String, key: String, state: String, claim: String, result: Option<Json> }

fn record(conn: &Connection, id: &str, name: &str) -> Result<Option<Record>, RuntimeError> {
    let row: Option<(String, String, String, String, Option<String>)> = conn.query_row(
        "SELECT input_digest, provider_key, state, claim_digest, result FROM _action_steps WHERE invocation = ?1 AND name = ?2",
        params![id, name], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).optional()?;
    row.map(|(digest, key, state, claim, result)| Ok(Record { digest, key, state, claim,
        result: result.map(|text| serde_json::from_str(&text).map_err(|_| RuntimeError::Store("invalid persisted step result".into()))).transpose()? })).transpose()
}

impl Engine {
    // @ref LLP 3000.009#5.1 — completed steps replay; changed inputs refuse; uncertainty never repeats blindly.
    pub fn begin_action_step(&mut self, id: &str, worker: &str, lease: &str, name: &str, input: &Json, reconcile: bool, now: i64) -> Result<ActionStep, RuntimeError> {
        name_fits(name)?;
        if serde_json::to_vec(input).map_err(|_| invalid("E_STEP_INPUT", "step input must be JSON"))?.len() as u64 > self.ceilings.heap_bytes {
            return Err(invalid("E_STEP_INPUT", "step input exceeds the heap byte ceiling"));
        }
        let digest = crate::store::payload_digest(input);
        let claim = identity::digest(lease);
        let tx = self.store.transaction()?;
        held(tx.conn(), id, worker, lease, now)?;
        let answer = if let Some(previous) = record(tx.conn(), id, name)? {
            if previous.digest != digest { return Err(invalid("E_STEP_INPUT", "this step name already binds another input")); }
            if previous.state == "done" {
                ActionStep { state: "done".into(), key: previous.key, result: previous.result }
            } else if previous.claim == claim {
                return Err(invalid("E_STEP_BUSY", "this attempt already started the step; join its in-flight call"));
            } else if reconcile {
                tx.conn().execute("UPDATE _action_steps SET state = 'started', claim_digest = ?3, error = NULL WHERE invocation = ?1 AND name = ?2", params![id, name, claim])?;
                ActionStep { state: "reconcile".into(), key: previous.key, result: None }
            } else {
                tx.conn().execute("UPDATE _action_steps SET state = 'parked', error = 'no recorded outcome; reconciliation required' WHERE invocation = ?1 AND name = ?2", params![id, name])?;
                finish(tx.conn(), id, "parked", "E_STEP_PARKED", "an external step has no recorded outcome; reconcile its provider key or inspect it before replacing this work", now)?;
                tx.commit()?;
                return Err(invalid("E_STEP_PARKED", "the invocation is parked: an external step needs reconciliation"));
            }
        } else {
            let key = crate::store::payload_digest(&serde_json::json!(["snapback4:step:v1", id, name]));
            tx.conn().execute("INSERT INTO _action_steps(invocation, name, input_digest, provider_key, state, claim_digest, at) VALUES (?1, ?2, ?3, ?4, 'started', ?5, ?6)", params![id, name, digest, key, claim, now])?;
            ActionStep { state: "run".into(), key, result: None }
        };
        tx.commit()?;
        Ok(answer)
    }

    pub fn complete_action_step(&mut self, id: &str, worker: &str, lease: &str, name: &str, result: &Json, now: i64) -> Result<ActionStep, RuntimeError> {
        name_fits(name)?;
        let bytes = serde_json::to_string(result).map_err(|_| invalid("E_STEP_RESULT", "a step result must be JSON"))?;
        let tx = self.store.transaction()?;
        held(tx.conn(), id, worker, lease, now)?;
        let previous = record(tx.conn(), id, name)?.ok_or_else(|| invalid("E_STEP_UNKNOWN", "begin the step before recording its outcome"))?;
        if previous.claim != identity::digest(lease) { return Err(lease_error()); }
        if bytes.len() as u64 > self.ceilings.output_bytes {
            tx.conn().execute("UPDATE _action_steps SET state = 'parked', error = 'result exceeds output byte ceiling' WHERE invocation = ?1 AND name = ?2", params![id, name])?;
            finish(tx.conn(), id, "parked", "E_STEP_RESULT", "a step outcome exceeds the output byte ceiling; inspect the provider before replacing this work", now)?;
            tx.commit()?;
            return Err(invalid("E_STEP_RESULT", "the invocation is parked: the external step outcome exceeds the output byte ceiling"));
        }
        if previous.state == "done" {
            if previous.result.as_ref().map(crate::store::payload_digest) != Some(crate::store::payload_digest(result)) {
                return Err(invalid("E_STEP_RESULT", "the step already has a different recorded outcome"));
            }
        } else if previous.state == "started" {
            tx.conn().execute("UPDATE _action_steps SET state = 'done', result = ?3, settled_at = ?4, error = NULL WHERE invocation = ?1 AND name = ?2", params![id, name, bytes, now])?;
        } else { return Err(invalid("E_STEP_PARKED", "the step is parked")); }
        tx.commit()?;
        Ok(ActionStep { state: "done".into(), key: previous.key, result: Some(result.clone()) })
    }

    pub fn park_action_step(&mut self, id: &str, worker: &str, lease: &str, name: &str, error: &str, now: i64) -> Result<(), RuntimeError> {
        name_fits(name)?;
        let tx = self.store.transaction()?;
        held(tx.conn(), id, worker, lease, now)?;
        let previous = record(tx.conn(), id, name)?.ok_or_else(|| invalid("E_STEP_UNKNOWN", "begin the step before parking it"))?;
        if previous.claim != identity::digest(lease) || previous.state != "started" { return Err(lease_error()); }
        let error: String = error.chars().take(2_000).collect();
        tx.conn().execute("UPDATE _action_steps SET state = 'parked', error = ?3 WHERE invocation = ?1 AND name = ?2", params![id, name, error])?;
        finish(tx.conn(), id, "parked", "E_STEP_PARKED", "the handler could not reconcile an external step; inspect it before replacing this work", now)?;
        tx.commit()
    }
}
