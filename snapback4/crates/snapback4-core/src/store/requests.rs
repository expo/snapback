//! SQLite access for durable action and route requests.
// @ref LLP 3000.009.001.000#3.3 — request storage moves without changing action policy.
use super::{Store, Tx};
use crate::{
    RuntimeError,
    engine::actions::{
        ActionRequest,
        requests::{NewRequest, RequestSettlement, RequestsStore, RequestsTransaction},
    },
    identity,
};
use rusqlite::{Connection, OptionalExtension, params};

pub(crate) fn initialize(conn: &Connection) -> Result<(), RuntimeError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _requests (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, args TEXT NOT NULL, principal TEXT NOT NULL,
        at INTEGER NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER, lease_until INTEGER, claimed_by TEXT, session_digest TEXT,
        result TEXT, error TEXT);
        CREATE INDEX IF NOT EXISTS _requests_due ON _requests(state, name, at, id);
        CREATE INDEX IF NOT EXISTS _requests_session ON _requests(session_digest);",
    )?;
    let columns: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('_requests')")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    for (column, kind) in [
        ("family", "TEXT"),
        ("principal_generation", "INTEGER"),
        ("admitted_expires_at", "INTEGER"),
        ("args_digest", "TEXT"),
        ("error_code", "TEXT"),
        ("settled_at", "INTEGER"),
        ("spec", "TEXT"),
        ("contract", "TEXT"),
        ("deadline", "INTEGER"),
        ("release", "TEXT"),
        ("service_generation", "INTEGER"),
        ("cancelled", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        if !columns.iter().any(|name| name == column) {
            conn.execute_batch(&format!(
                "ALTER TABLE _requests ADD COLUMN {column} {kind};"
            ))?;
        }
    }
    crate::store::steps::initialize_actions(conn)?;
    Ok(())
}

const COLUMNS: &str = "id, name, args, principal, at, state, attempts, lease_until, result, error, error_code, family, principal_generation, admitted_expires_at, args_digest, settled_at, spec, contract, deadline, release, service_generation, cancelled";
fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActionRequest> {
    fn decode<T: serde::de::DeserializeOwned>(text: String, col: usize) -> rusqlite::Result<T> {
        serde_json::from_str(&text).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                col,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
    }
    Ok(ActionRequest {
        id: row.get(0)?,
        action: row.get(1)?,
        args: decode(row.get(2)?, 2)?,
        principal: row.get(3)?,
        at: row.get(4)?,
        state: row.get(5)?,
        attempt: row.get::<_, u32>(6)?,
        lease_until: row.get(7)?,
        result: row
            .get::<_, Option<String>>(8)?
            .map(|s| decode(s, 8))
            .transpose()?,
        error: row.get(9)?,
        error_code: row.get(10)?,
        authority: match (
            row.get::<_, Option<String>>(11)?,
            row.get::<_, Option<i64>>(12)?,
            row.get::<_, Option<i64>>(13)?,
        ) {
            (Some(family), Some(generation), Some(expires_at)) => Some(identity::Authority {
                family,
                generation,
                expires_at,
            }),
            _ => None,
        },
        args_digest: row.get(14)?,
        settled_at: row.get(15)?,
        spec: row
            .get::<_, Option<String>>(16)?
            .map(|s| decode(s, 16))
            .transpose()?
            .unwrap_or_default(),
        contract: row.get(17)?,
        deadline: row.get(18)?,
        release: row.get(19)?,
        service_generation: row.get(20)?,
        cancelled: row.get(21)?,
    })
}

impl RequestsTransaction for Tx<'_> {
    fn request(&self, id: &str) -> Result<Option<ActionRequest>, RuntimeError> {
        Ok(self
            .conn()
            .query_row(
                &format!("SELECT {COLUMNS} FROM _requests WHERE id = ?1"),
                [id],
                read,
            )
            .optional()?)
    }

    fn request_release(&self) -> Result<Option<String>, RuntimeError> {
        Ok(self
            .conn()
            .query_row("SELECT value FROM _meta WHERE key = 'release'", [], |row| {
                row.get(0)
            })
            .optional()?)
    }

    fn insert_request(&self, request: &NewRequest<'_>) -> Result<(), RuntimeError> {
        self.conn().execute("INSERT INTO _requests(id, name, args, principal, at, state, family, principal_generation, admitted_expires_at, args_digest, spec, contract, deadline, release, service_generation) VALUES (?1, ?2, ?3, ?4, ?5, 'queued', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![request.id, request.action, request.args, request.principal, request.at,
                request.authority.map(|a| &a.family), request.authority.map(|a| a.generation), request.authority.map(|a| a.expires_at), request.args_digest,
                request.spec, request.contract, request.deadline, request.release, request.service_generation])?;
        Ok(())
    }

    fn expired_requests(&self, now: i64, limit: i64) -> Result<Vec<ActionRequest>, RuntimeError> {
        Ok(self.conn().prepare(&format!("SELECT {COLUMNS} FROM _requests WHERE state IN ('queued', 'running') AND (deadline <= ?1 OR (state = 'running' AND lease_until <= ?1)) LIMIT ?2"))?
            .query_map([now, limit], read)?.collect::<Result<Vec<_>, _>>()?)
    }

    fn finish_request(
        &self,
        id: &str,
        state: &str,
        code: &str,
        error: &str,
        now: i64,
    ) -> Result<(), RuntimeError> {
        // Retain the last claim fence so an in-flight handler may observe cancellation.
        self.conn().execute("UPDATE _requests SET state = ?2, error_code = ?3, error = ?4, result = NULL, next_at = NULL, settled_at = ?5 WHERE id = ?1", params![id, state, code, error, now])?;
        Ok(())
    }

    fn requeue_request(&self, id: &str, now: i64) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _requests SET state = 'queued', error = 'the action lease expired', error_code = NULL, next_at = ?2, lease_until = NULL, claimed_by = NULL, session_digest = NULL WHERE id = ?1", params![id, now])?;
        Ok(())
    }

    fn due_requests(
        &self,
        now: i64,
        action: Option<&str>,
        names: Option<&str>,
        limit: i64,
    ) -> Result<Vec<String>, RuntimeError> {
        Ok(self.conn().prepare("SELECT id FROM _requests WHERE state = 'queued' AND (next_at IS NULL OR next_at <= ?1) AND (?2 IS NULL OR name = ?2) AND (?4 IS NULL OR name IN (SELECT value FROM json_each(?4))) ORDER BY at, id LIMIT ?3")?.query_map(params![now, action, limit, names], |row| row.get(0))?.collect::<Result<_, _>>()?)
    }

    fn fail_request_authority(&self, id: &str, error: &str, now: i64) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _requests SET state = 'failed', error_code = 'E_ACTION_AUTHORITY', error = ?2, settled_at = ?3, next_at = NULL, lease_until = NULL, claimed_by = NULL, session_digest = NULL WHERE id = ?1", params![id, error, now])?;
        Ok(())
    }

    fn claim_request(
        &self,
        id: &str,
        worker: &str,
        session_digest: &str,
        lease_until: i64,
    ) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _requests SET state = 'running', attempts = attempts + 1, claimed_by = ?2, session_digest = ?3, lease_until = ?4, next_at = NULL, error = NULL, error_code = NULL WHERE id = ?1", params![id, worker, session_digest, lease_until])?;
        Ok(())
    }

    fn settle_request(
        &self,
        id: &str,
        settled: &RequestSettlement<'_>,
    ) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _requests SET state = ?2, result = ?3, error = ?4, next_at = ?5, claimed_by = NULL, session_digest = NULL, lease_until = NULL, error_code = ?7, settled_at = ?6 WHERE id = ?1", params![id, settled.state, settled.result, settled.error, settled.next_at, settled.settled_at, settled.error_code])?;
        Ok(())
    }

    fn cancel_request(&self, id: &str) -> Result<(), RuntimeError> {
        self.conn()
            .execute("UPDATE _requests SET cancelled = 1 WHERE id = ?1", [id])?;
        Ok(())
    }
}

impl RequestsStore for Store {
    fn request_counts(&self) -> Result<std::collections::BTreeMap<String, u64>, RuntimeError> {
        Ok(self
            .conn()
            .prepare("SELECT state, COUNT(*) FROM _requests GROUP BY state")?
            .query_map([], |row| Ok((row.get(0)?, row.get::<_, i64>(1)? as u64)))?
            .collect::<Result<_, _>>()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::actions::requests::test_cases;

    #[test]
    fn request_finish_and_settlement_contract() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        test_cases::finish_and_settle(&tx);
        tx.commit().unwrap();
        assert_eq!(
            store.request_counts().unwrap(),
            std::collections::BTreeMap::from([("done".into(), 1)])
        );
    }

    #[test]
    fn request_selection_and_rollback_contract() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        test_cases::selection(&tx);
        tx.rollback().unwrap();
        assert!(store.request_counts().unwrap().is_empty());
    }
}
