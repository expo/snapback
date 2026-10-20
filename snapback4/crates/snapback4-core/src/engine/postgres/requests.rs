//! Durable request facts on the caller-owned Postgres transaction.
//! Claim authority, lease bounds, retries and step parking stay in `actions`.
// @ref LLP 3000.009.001.000#3.1 — adapters store facts; shared Rust chooses transitions.
use super::store::{Store, Tx, decode};
use crate::{
    RuntimeError,
    engine::actions::{
        ActionRequest,
        requests::{
            NewRequest, RequestSettlement, RequestsStore, RequestsTransaction, diagnostic_text,
            validate_text,
        },
    },
    identity::Authority,
};
use std::collections::BTreeMap;

/// Called by attach after locking `_head`, in its physical-upgrade transaction.
// @ref LLP 3000.009.001.000#4.1 — request upgrades join the existing head-fenced adoption.
pub(super) fn initialize(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    for (column, kind) in [
        ("family", "TEXT COLLATE \"C\""),
        ("principal_generation", "BIGINT"),
        ("admitted_expires_at", "BIGINT"),
        ("args_digest", "TEXT"),
        ("error_code", "TEXT"),
        ("settled_at", "BIGINT"),
        ("spec", "TEXT"),
        ("contract", "TEXT"),
        ("deadline", "BIGINT"),
        ("release", "TEXT"),
        ("service_generation", "BIGINT"),
        ("cancelled", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ] {
        // A no-op ALTER would still take an exclusive table lock on reopen.
        let exists: bool = tx.query(
            "SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid = '_requests'::regclass AND attname = $1 AND NOT attisdropped)",
            &[&column],
        )?[0].get(0);
        if !exists {
            tx.batch(&format!("ALTER TABLE _requests ADD COLUMN {column} {kind}"))?;
        }
    }
    // The release family will populate the same metadata key as SQLite. An
    // evaluation store without an active release returns None, never a guess.
    tx.batch("CREATE TABLE IF NOT EXISTS _meta (key TEXT COLLATE \"C\" PRIMARY KEY, value TEXT NOT NULL)")?;
    Ok(())
}

fn read(row: &postgres::Row) -> Result<ActionRequest, RuntimeError> {
    let authority = match (
        row.try_get::<_, Option<String>>("family")?,
        row.try_get::<_, Option<i64>>("principal_generation")?,
        row.try_get::<_, Option<i64>>("admitted_expires_at")?,
    ) {
        (Some(family), Some(generation), Some(expires_at)) => Some(Authority {
            family,
            generation,
            expires_at,
        }),
        _ => None,
    };
    Ok(ActionRequest {
        id: row.try_get("id")?,
        action: row.try_get("name")?,
        args: decode(row.try_get("args")?)?,
        principal: row.try_get("principal")?,
        at: row.try_get("at")?,
        state: row.try_get("state")?,
        // Preserve the public SQLite error variant for this legacy row reader.
        attempt: {
            let attempts: i64 = row.try_get("attempts")?;
            u32::try_from(attempts).map_err(|_| {
                RuntimeError::Sql(rusqlite::Error::IntegralValueOutOfRange(6, attempts))
            })?
        },
        lease_until: row.try_get("lease_until")?,
        result: row
            .try_get::<_, Option<&str>>("result")?
            .map(decode)
            .transpose()?,
        error: row.try_get("error")?,
        error_code: row.try_get("error_code")?,
        authority,
        args_digest: row.try_get("args_digest")?,
        settled_at: row.try_get("settled_at")?,
        spec: row
            .try_get::<_, Option<&str>>("spec")?
            .map(decode)
            .transpose()?
            .unwrap_or_default(),
        contract: row.try_get("contract")?,
        deadline: row.try_get("deadline")?,
        release: row.try_get("release")?,
        service_generation: row.try_get("service_generation")?,
        cancelled: row.try_get("cancelled")?,
    })
}

impl RequestsTransaction for Tx<'_> {
    fn request(&self, id: &str) -> Result<Option<ActionRequest>, RuntimeError> {
        validate_text(&[id])?;
        self.query("SELECT id, name, args, principal, at, state, attempts, lease_until, result, error, error_code, family, principal_generation, admitted_expires_at, args_digest, settled_at, spec, contract, deadline, release, service_generation, cancelled FROM _requests WHERE id = $1", &[&id])?
            .first()
            .map(read)
            .transpose()
    }

    fn request_release(&self) -> Result<Option<String>, RuntimeError> {
        Ok(self
            .query("SELECT value FROM _meta WHERE key = 'release'", &[])?
            .first()
            .map(|row| row.get(0)))
    }

    fn insert_request(&self, request: &NewRequest<'_>) -> Result<(), RuntimeError> {
        request.validate()?;
        self.require_serialized_head_fence("insert request")?;
        self.execute("INSERT INTO _requests(id, name, args, principal, at, state, family, principal_generation, admitted_expires_at, args_digest, spec, contract, deadline, release, service_generation) VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7, $8, $9, $10, $11, $12, $13, $14)",
            &[&request.id, &request.action, &request.args, &request.principal, &request.at,
                &request.authority.map(|a| &a.family), &request.authority.map(|a| a.generation), &request.authority.map(|a| a.expires_at), &request.args_digest,
                &request.spec, &request.contract, &request.deadline, &request.release, &request.service_generation])?;
        Ok(())
    }

    fn expired_requests(&self, now: i64, limit: u64) -> Result<Vec<ActionRequest>, RuntimeError> {
        let limit = limit.min(i64::MAX as u64) as i64;
        self.query("SELECT id, name, args, principal, at, state, attempts, lease_until, result, error, error_code, family, principal_generation, admitted_expires_at, args_digest, settled_at, spec, contract, deadline, release, service_generation, cancelled FROM _requests WHERE state IN ('queued', 'running') AND (deadline <= $1 OR (state = 'running' AND lease_until <= $1)) ORDER BY at, id LIMIT $2", &[&now, &limit])?
            .iter().map(read).collect()
    }

    fn finish_request(
        &self,
        id: &str,
        state: &str,
        code: &str,
        error: &str,
        now: i64,
    ) -> Result<(), RuntimeError> {
        validate_text(&[id, state, code])?;
        let error = diagnostic_text(error);
        let error = error.as_ref();
        self.require_serialized_head_fence("finish request")?;
        // The shared finish helper revokes the delegated credential first.
        // Preserve its last claim fence for cooperative cancellation/step park.
        self.execute("UPDATE _requests SET state = $2, error_code = $3, error = $4, result = NULL, next_at = NULL, settled_at = $5 WHERE id = $1", &[&id, &state, &code, &error, &now])?;
        Ok(())
    }

    fn requeue_request(&self, id: &str, now: i64) -> Result<(), RuntimeError> {
        validate_text(&[id])?;
        self.require_serialized_head_fence("requeue request")?;
        self.execute("UPDATE _requests SET state = 'queued', error = 'the action lease expired', error_code = NULL, next_at = $2, lease_until = NULL, claimed_by = NULL, session_digest = NULL WHERE id = $1", &[&id, &now])?;
        Ok(())
    }

    fn due_requests(
        &self,
        now: i64,
        action: Option<&str>,
        names: Option<&[String]>,
        limit: u64,
    ) -> Result<Vec<String>, RuntimeError> {
        validate_text(&[action.unwrap_or("")])?;
        if let Some(names) = names {
            for name in names {
                validate_text(&[name])?;
            }
        }
        let limit = limit.min(i64::MAX as u64) as i64;
        // Explicit casts keep optional parameters typed even when NULL is sent.
        Ok(self.query("SELECT id FROM _requests WHERE state = 'queued' AND (next_at IS NULL OR next_at <= $1) AND ($2::text IS NULL OR name = $2) AND ($4::text[] IS NULL OR name = ANY($4::text[])) ORDER BY at, id LIMIT $3",
            &[&now, &action, &limit, &names])?.iter().map(|row| row.get(0)).collect())
    }

    fn fail_request_authority(&self, id: &str, error: &str, now: i64) -> Result<(), RuntimeError> {
        validate_text(&[id])?;
        let error = diagnostic_text(error);
        let error = error.as_ref();
        self.require_serialized_head_fence("fail request authority")?;
        self.execute("UPDATE _requests SET state = 'failed', error_code = 'E_ACTION_AUTHORITY', error = $2, settled_at = $3, next_at = NULL, lease_until = NULL, claimed_by = NULL, session_digest = NULL WHERE id = $1", &[&id, &error, &now])?;
        Ok(())
    }

    fn claim_request(
        &self,
        id: &str,
        worker: &str,
        session_digest: &str,
        lease_until: i64,
    ) -> Result<(), RuntimeError> {
        validate_text(&[id, worker, session_digest])?;
        self.require_serialized_head_fence("claim request")?;
        // As on SQLite, selection and this update share the writer fence.
        // Authority and lease validation belong to the caller before this write.
        self.execute("UPDATE _requests SET state = 'running', attempts = attempts + 1, claimed_by = $2, session_digest = $3, lease_until = $4, next_at = NULL, error = NULL, error_code = NULL WHERE id = $1", &[&id, &worker, &session_digest, &lease_until])?;
        Ok(())
    }

    fn settle_request(
        &self,
        id: &str,
        settled: &RequestSettlement<'_>,
    ) -> Result<(), RuntimeError> {
        validate_text(&[id, settled.state, settled.error_code.unwrap_or("")])?;
        let error = settled.error.map(diagnostic_text);
        let error = error.as_deref();
        self.require_serialized_head_fence("settle request")?;
        self.execute("UPDATE _requests SET state = $2, result = $3, error = $4, next_at = $5, claimed_by = NULL, session_digest = NULL, lease_until = NULL, error_code = $7, settled_at = $6 WHERE id = $1", &[&id, &settled.state, &settled.result, &error, &settled.next_at, &settled.settled_at, &settled.error_code])?;
        Ok(())
    }

    fn cancel_request(&self, id: &str) -> Result<(), RuntimeError> {
        validate_text(&[id])?;
        self.require_serialized_head_fence("cancel request")?;
        self.execute(
            "UPDATE _requests SET cancelled = TRUE WHERE id = $1",
            &[&id],
        )?;
        Ok(())
    }
}

impl RequestsStore for Store {
    fn request_counts(&mut self) -> Result<BTreeMap<String, u64>, RuntimeError> {
        let tx = self.transaction(None)?;
        let counts = tx
            .query("SELECT state, COUNT(*) FROM _requests GROUP BY state", &[])?
            .iter()
            .map(|row| (row.get(0), row.get::<_, i64>(1) as u64))
            .collect();
        tx.rollback()?;
        Ok(counts)
    }
}
