//! Authority facts on the caller-owned Postgres transaction.

use super::store::{Tx, absent_text_key};
use crate::{
    RuntimeError,
    authority::{AdmissionRecord, AuthorityTransaction, SessionRecord, WorkRecord},
};


// @ref LLP 3000.009.001.000.001#32-one-statement-fetches-a-guest-sessions-authority-facts — PK lookups bound the union to two rows; no authority decisions in SQL.
const FULL_FACTS: &str = "WITH sessions AS (SELECT principal, COALESCE(family, token_digest) AS family, kind, token_digest, expires_at, 0 AS scope, NULL::BIGINT AS cap_expires_at, NULL::BIGINT AS principal_generation FROM _sessions WHERE token_digest = $1)
SELECT s.principal, s.family, s.kind, s.token_digest, s.expires_at, s.scope,
       s.cap_expires_at, s.principal_generation, COALESCE(g.generation, 0),
       (SELECT value FROM _meta WHERE key = 'worker:session-family'),
       (SELECT value FROM _meta WHERE key = 'worker:session-revision'),
       (SELECT value FROM _meta WHERE key = 'worker:family:' || s.family),
       (SELECT value FROM _meta WHERE key = 'generation'),
       (SELECT value FROM _meta WHERE key = 'store_id'),
       (SELECT generation FROM _backend WHERE singleton),
       NULL::TEXT, NULL::TEXT, NULL::TEXT,
       (SELECT seq FROM _head WHERE singleton)
FROM (SELECT 1) AS anchor LEFT JOIN sessions s ON true
LEFT JOIN _principal_generations g ON g.principal = s.principal";
const READ_FACTS: &str = "WITH sessions AS (SELECT principal, COALESCE(family, token_digest) AS family, kind, token_digest, expires_at, 0 AS scope, NULL::BIGINT AS cap_expires_at, NULL::BIGINT AS principal_generation FROM _sessions WHERE token_digest = $1 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE token_digest = $1)
SELECT s.principal, s.family, s.kind, s.token_digest, s.expires_at, s.scope,
       s.cap_expires_at, s.principal_generation, COALESCE(g.generation, 0),
       (SELECT value FROM _meta WHERE key = 'worker:session-family'),
       (SELECT value FROM _meta WHERE key = 'worker:session-revision'),
       (SELECT value FROM _meta WHERE key = 'worker:family:' || s.family),
       (SELECT value FROM _meta WHERE key = 'generation'),
       (SELECT value FROM _meta WHERE key = 'store_id'),
       (SELECT generation FROM _backend WHERE singleton),
       NULL::TEXT, NULL::TEXT, NULL::TEXT,
       (SELECT seq FROM _head WHERE singleton)
FROM (SELECT 1) AS anchor LEFT JOIN sessions s ON true
LEFT JOIN _principal_generations g ON g.principal = s.principal";

impl Tx<'_> {
    pub(crate) fn session_authority_facts(&self, digest: &str) -> Result<crate::identity::facts::SessionFacts, RuntimeError> {
        if absent_text_key(&[digest]) { return Ok(Default::default()); }
        let read = self.read_sessions.get() || self.read_sessions_installed.get();
        let facts = self.fetch_session_authority_facts(digest, read)?;
        if !read && facts.sessions.is_empty() && super::identity::read_sessions_present(self)? {
            self.read_sessions_installed.set(true);
            return self.fetch_session_authority_facts(digest, true);
        }
        Ok(facts)
    }

    fn fetch_session_authority_facts(&self, digest: &str, read: bool) -> Result<crate::identity::facts::SessionFacts, RuntimeError> {
        Ok(session_facts_rows(self.query(session_facts_sql(read), &[&digest])?))
    }
}

pub(super) fn session_facts_sql(read: bool) -> &'static str { if read { READ_FACTS } else { FULL_FACTS } }
pub(super) fn session_facts_rows(rows: Vec<super::store::Row>) -> crate::identity::facts::SessionFacts {
        let row = &rows[0]; // The anchor also returns metadata for an absent token.
        crate::identity::facts::SessionFacts {
            head: row.get::<_, i64>(18) as u64,
            sessions: rows.iter().filter(|r| r.get::<_, Option<String>>(0).is_some()).map(read_session).collect(),
            current_generation: row.get(8), worker_family: row.get(9), worker_revision: row.get(10),
            family_revision: row.get(11), store_generation: row.get(12), store_id: row.get(13),
            backend_generation: row.get(14), schema_hash: row.get(15), activation_hash: row.get(16), device_generation: row.get(17),
        }
}

const WORK_BY_ID: &str = "SELECT principal, state, claimed_by, session_digest, lease_until, deadline, family, principal_generation, admitted_expires_at, service_generation FROM _requests WHERE id = $1";
const WORK_BY_SESSION: &str = "SELECT principal, state, claimed_by, session_digest, lease_until, deadline, family, principal_generation, admitted_expires_at, service_generation FROM _requests WHERE session_digest = $1 ORDER BY id LIMIT 1";

fn read_session(row: &super::store::Row) -> SessionRecord {
    SessionRecord {
        principal: row.get(0),
        family: row.get(1),
        kind: row.get(2),
        digest: row.get(3),
        expires_at: row.get(4),
        scope: if row.get::<_, i32>(5) == 1 { crate::identity::SessionScope::Read } else { crate::identity::SessionScope::Full },
        cap_expires_at: row.get(6), principal_generation: row.get(7),
    }
}

fn read_work(row: &super::store::Row) -> WorkRecord {
    WorkRecord {
        principal: row.get(0),
        state: row.get(1),
        claimed_by: row.get(2),
        session_digest: row.get(3),
        lease_until: row.get(4),
        deadline: row.get(5),
        admission: AdmissionRecord {
            family: row.get(6),
            generation: row.get(7),
            expires_at: row.get(8),
        },
        service_generation: row.get(9),
    }
}

impl AuthorityTransaction for Tx<'_> {
    /// A NUL principal has no generation row; return the absent default without querying.
    fn principal_generation(&self, principal: &str) -> Result<i64, RuntimeError> {
        if absent_text_key(&[principal]) { return Ok(0); }
        Ok(self
            .query("SELECT generation FROM _principal_generations WHERE principal = $1", &[&principal])?
            .first()
            .map(|row| row.get(0))
            .unwrap_or(0))
    }

    /// A NUL lookup key is absent without querying.
    fn session_by_digest(&self, digest: &str) -> Result<Option<SessionRecord>, RuntimeError> {
        if absent_text_key(&[digest]) { return Ok(None); }
        let rows = self.query(
                if self.read_sessions.get() || self.read_sessions_installed.get() {
                    "SELECT principal, COALESCE(family, token_digest), kind, token_digest, expires_at, 0, NULL::BIGINT, NULL::BIGINT FROM _sessions WHERE token_digest = $1 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE token_digest = $1"
                } else {
                    "SELECT principal, COALESCE(family, token_digest), kind, token_digest, expires_at, 0, NULL::BIGINT, NULL::BIGINT FROM _sessions WHERE token_digest = $1"
                },
                &[&digest],
            )?;
        if rows.len() > 1 {
            // Match SQLite's strict single-row lookup, including RuntimeError
            // shape, instead of silently granting the full-session branch.
            return Err(RuntimeError::Sql(rusqlite::Error::QueryReturnedMoreThanOneRow));
        }
        Ok(rows.first().map(read_session))
    }

    // @ref LLP 3000.009.001.000#91-adapter-parity-rules — digest and scope break expiry ties across both tables.
    /// A NUL lookup key is absent without querying.
    fn latest_live_family_member(
        &self,
        principal: &str,
        family: &str,
        now: i64,
    ) -> Result<Option<SessionRecord>, RuntimeError> {
        if absent_text_key(&[principal, family]) { return Ok(None); }
        Ok(self
            .query(
                if self.read_sessions.get() || self.read_sessions_installed.get() {
                    "SELECT principal, COALESCE(family, token_digest), kind, token_digest, expires_at, 0, NULL::BIGINT, NULL::BIGINT FROM _sessions WHERE principal = $1 AND COALESCE(family, token_digest) = $2 AND expires_at > $3 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE principal = $1 AND family = $2 AND expires_at > $3 ORDER BY expires_at DESC, token_digest ASC, 6 ASC LIMIT 1"
                } else {
                    "SELECT principal, COALESCE(family, token_digest), kind, token_digest, expires_at, 0, NULL::BIGINT, NULL::BIGINT FROM _sessions WHERE principal = $1 AND COALESCE(family, token_digest) = $2 AND expires_at > $3 ORDER BY expires_at DESC, token_digest ASC, 6 ASC LIMIT 1"
                },
                &[&principal, &family, &now],
            )?
            .first()
            .map(read_session))
    }

    /// A NUL lookup key is absent without querying.
    fn work_by_id(&self, id: &str) -> Result<Option<WorkRecord>, RuntimeError> {
        if absent_text_key(&[id]) { return Ok(None); }
        Ok(self.query(WORK_BY_ID, &[&id])?.first().map(read_work))
    }

    /// A NUL lookup key is absent without querying.
    fn work_by_claimed_session_digest(
        &self,
        digest: &str,
    ) -> Result<Option<WorkRecord>, RuntimeError> {
        if absent_text_key(&[digest]) { return Ok(None); }
        Ok(self.query(WORK_BY_SESSION, &[&digest])?.first().map(read_work))
    }

    fn invalidate_session(&self, digest: &str) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("invalidate session")?;
        self.execute("DELETE FROM _sessions WHERE token_digest = $1", &[&digest])?;
        self.execute("DELETE FROM _read_sessions WHERE token_digest = $1", &[&digest])?;
        Ok(())
    }

    fn invalidate_family(&self, principal: &str, family: &str) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("invalidate family")?;
        self.execute(
            "DELETE FROM _sessions WHERE principal = $1 AND COALESCE(family, token_digest) = $2",
            &[&principal, &family],
        )?;
        self.execute("DELETE FROM _read_sessions WHERE principal = $1 AND family = $2", &[&principal, &family])?;
        Ok(())
    }
}

impl Tx<'_> {
    // @ref LLP 3000.009#4.4 — every durable authority mutation joins the
    // shared commit order; read-only and optimistic serializable walks cannot mutate it.
    pub(super) fn require_serialized_head_fence(&self, operation: &str) -> Result<(), RuntimeError> {
        if !self.serialized_head.get() {
            return Err(RuntimeError::Store(
                format!("Postgres {operation} requires the serialized shared-head fence"),
            ));
        }
        Ok(())
    }
}

// The matrix baseline deliberately probes the catalog and retains separate
// session/generation/worker reads. It never consults either fast-path flag.
#[cfg(test)]
pub(super) struct Baseline<'a, 'b>(pub &'a Tx<'b>);
#[cfg(test)]
impl AuthorityTransaction for Baseline<'_, '_> {
    /// A NUL lookup key is absent without querying.
    fn session_by_digest(&self, digest: &str) -> Result<Option<SessionRecord>, RuntimeError> {
        if absent_text_key(&[digest]) { return Ok(None); }
        let rows = self.0.query(
                if super::identity::read_sessions_present(self.0)? {
                    "SELECT principal, COALESCE(family, token_digest), kind, token_digest, expires_at, 0, NULL::BIGINT, NULL::BIGINT FROM _sessions WHERE token_digest = $1 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE token_digest = $1"
                } else {
                    "SELECT principal, COALESCE(family, token_digest), kind, token_digest, expires_at, 0, NULL::BIGINT, NULL::BIGINT FROM _sessions WHERE token_digest = $1"
                },
                &[&digest],
            )?;
        if rows.len() > 1 {
            // Match SQLite's strict single-row lookup, including RuntimeError
            // shape, instead of silently granting the full-session branch.
            return Err(RuntimeError::Sql(rusqlite::Error::QueryReturnedMoreThanOneRow));
        }
        Ok(rows.first().map(read_session))
    }

    // @ref LLP 3000.009.001.000#91-adapter-parity-rules — digest and scope break expiry ties across both tables.
    /// A NUL lookup key is absent without querying.
    fn latest_live_family_member(
        &self,
        principal: &str,
        family: &str,
        now: i64,
    ) -> Result<Option<SessionRecord>, RuntimeError> {
        if absent_text_key(&[principal, family]) { return Ok(None); }
        Ok(self.0
            .query(
                if super::identity::read_sessions_present(self.0)? {
                    "SELECT principal, COALESCE(family, token_digest), kind, token_digest, expires_at, 0, NULL::BIGINT, NULL::BIGINT FROM _sessions WHERE principal = $1 AND COALESCE(family, token_digest) = $2 AND expires_at > $3 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE principal = $1 AND family = $2 AND expires_at > $3 ORDER BY expires_at DESC, token_digest ASC, 6 ASC LIMIT 1"
                } else {
                    "SELECT principal, COALESCE(family, token_digest), kind, token_digest, expires_at, 0, NULL::BIGINT, NULL::BIGINT FROM _sessions WHERE principal = $1 AND COALESCE(family, token_digest) = $2 AND expires_at > $3 ORDER BY expires_at DESC, token_digest ASC, 6 ASC LIMIT 1"
                },
                &[&principal, &family, &now],
            )?
            .first()
            .map(read_session))
    }


    fn principal_generation(&self, principal: &str) -> Result<i64, RuntimeError> { self.0.principal_generation(principal) }
    fn work_by_id(&self, id: &str) -> Result<Option<WorkRecord>, RuntimeError> { self.0.work_by_id(id) }
    fn work_by_claimed_session_digest(&self, digest: &str) -> Result<Option<WorkRecord>, RuntimeError> { self.0.work_by_claimed_session_digest(digest) }
    fn invalidate_session(&self, _: &str) -> Result<(), RuntimeError> { unreachable!("read-only baseline") }
    fn invalidate_family(&self, _: &str, _: &str) -> Result<(), RuntimeError> { unreachable!("read-only baseline") }
}
