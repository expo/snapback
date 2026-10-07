//! Authority facts on the caller-owned Postgres transaction.

use super::store::Tx;
use crate::{
    RuntimeError,
    authority::{AdmissionRecord, AuthorityTransaction, SessionRecord, WorkRecord},
};

const WORK_BY_ID: &str = "SELECT principal, state, claimed_by, session_digest, lease_until, deadline, family, principal_generation, admitted_expires_at, service_generation FROM _requests WHERE id = $1";
const WORK_BY_SESSION: &str = "SELECT principal, state, claimed_by, session_digest, lease_until, deadline, family, principal_generation, admitted_expires_at, service_generation FROM _requests WHERE session_digest = $1 LIMIT 1";

fn read_session(row: &postgres::Row) -> SessionRecord {
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

fn read_work(row: &postgres::Row) -> WorkRecord {
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
    fn principal_generation(&self, principal: &str) -> Result<i64, RuntimeError> {
        Ok(self
            .query("SELECT generation FROM _principal_generations WHERE principal = $1", &[&principal])?
            .first()
            .map(|row| row.get(0))
            .unwrap_or(0))
    }

    fn session_by_digest(&self, digest: &str) -> Result<Option<SessionRecord>, RuntimeError> {
        Ok(self
            .query(
                "SELECT principal, COALESCE(family, token_digest), kind, token_digest, expires_at, 0, NULL::BIGINT, NULL::BIGINT FROM _sessions WHERE token_digest = $1 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE token_digest = $1",
                &[&digest],
            )?
            .first()
            .map(read_session))
    }

    fn latest_live_family_member(
        &self,
        principal: &str,
        family: &str,
        now: i64,
    ) -> Result<Option<SessionRecord>, RuntimeError> {
        Ok(self
            .query(
                "SELECT principal, COALESCE(family, token_digest), kind, token_digest, expires_at, 0, NULL::BIGINT, NULL::BIGINT FROM _sessions WHERE principal = $1 AND COALESCE(family, token_digest) = $2 AND expires_at > $3 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE principal = $1 AND family = $2 AND expires_at > $3 ORDER BY expires_at DESC LIMIT 1",
                &[&principal, &family, &now],
            )?
            .first()
            .map(read_session))
    }

    fn work_by_id(&self, id: &str) -> Result<Option<WorkRecord>, RuntimeError> {
        Ok(self.query(WORK_BY_ID, &[&id])?.first().map(read_work))
    }

    fn work_by_claimed_session_digest(
        &self,
        digest: &str,
    ) -> Result<Option<WorkRecord>, RuntimeError> {
        Ok(self.query(WORK_BY_SESSION, &[&digest])?.first().map(read_work))
    }

    fn invalidate_session(&self, digest: &str) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence()?;
        self.execute("DELETE FROM _sessions WHERE token_digest = $1", &[&digest])?;
        self.execute("DELETE FROM _read_sessions WHERE token_digest = $1", &[&digest])?;
        Ok(())
    }

    fn invalidate_family(&self, principal: &str, family: &str) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence()?;
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
    fn require_serialized_head_fence(&self) -> Result<(), RuntimeError> {
        if !self.serialized_head.get() {
            return Err(RuntimeError::Store(
                "Postgres authority invalidation requires the serialized shared-head fence".into(),
            ));
        }
        Ok(())
    }
}
