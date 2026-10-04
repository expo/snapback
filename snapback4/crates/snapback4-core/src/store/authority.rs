use super::{Store, Tx};
use crate::{
    RuntimeError,
    authority::{AdmissionRecord, AuthorityTransaction, SessionRecord, WorkRecord},
};
use rusqlite::{OptionalExtension, params};

const WORK_COLUMNS: &str = "principal, state, claimed_by, session_digest, lease_until, deadline, family, principal_generation, admitted_expires_at, service_generation";

fn read_work(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkRecord> {
    let family = row.get::<_, Option<String>>(6)?;
    let generation = row.get::<_, Option<i64>>(7)?;
    let expires_at = row.get::<_, Option<i64>>(8)?;
    Ok(WorkRecord {
        principal: row.get(0)?,
        state: row.get(1)?,
        claimed_by: row.get(2)?,
        session_digest: row.get(3)?,
        lease_until: row.get(4)?,
        deadline: row.get(5)?,
        admission: AdmissionRecord { family, generation, expires_at },
        service_generation: row.get(9)?,
    })
}

impl AuthorityTransaction for Tx<'_> {
    fn principal_generation(&self, principal: &str) -> Result<i64, RuntimeError> {
        Ok(self
            .tx
            .query_row(
                "SELECT generation FROM _principal_generations WHERE principal = ?1",
                [principal],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(0))
    }

    fn session_by_digest(&self, digest: &str) -> Result<Option<SessionRecord>, RuntimeError> {
        Ok(self.tx.query_row(
            "SELECT principal, COALESCE(family, token_digest), kind, token_digest, expires_at FROM _sessions WHERE token_digest = ?1",
            [digest],
            |row| Ok(SessionRecord {
                principal: row.get(0)?, family: row.get(1)?, kind: row.get(2)?,
                digest: row.get(3)?, expires_at: row.get(4)?,
            }),
        ).optional()?)
    }

    fn latest_live_family_member(
        &self,
        principal: &str,
        family: &str,
        now: i64,
    ) -> Result<Option<SessionRecord>, RuntimeError> {
        Ok(self.tx.query_row(
            "SELECT principal, COALESCE(family, token_digest), kind, token_digest, expires_at FROM _sessions WHERE principal = ?1 AND COALESCE(family, token_digest) = ?2 AND expires_at > ?3 ORDER BY expires_at DESC LIMIT 1",
            params![principal, family, now],
            |row| Ok(SessionRecord {
                principal: row.get(0)?, family: row.get(1)?, kind: row.get(2)?,
                digest: row.get(3)?, expires_at: row.get(4)?,
            }),
        ).optional()?)
    }

    fn work_by_id(&self, id: &str) -> Result<Option<WorkRecord>, RuntimeError> {
        Ok(self
            .tx
            .query_row(
                &format!("SELECT {WORK_COLUMNS} FROM _requests WHERE id = ?1"),
                [id],
                read_work,
            )
            .optional()?)
    }

    fn work_by_claimed_session_digest(
        &self,
        digest: &str,
    ) -> Result<Option<WorkRecord>, RuntimeError> {
        Ok(self
            .tx
            .query_row(
                &format!("SELECT {WORK_COLUMNS} FROM _requests WHERE session_digest = ?1"),
                [digest],
                read_work,
            )
            .optional()?)
    }

    fn invalidate_session(&self, digest: &str) -> Result<(), RuntimeError> {
        self.conn()
            .execute("DELETE FROM _sessions WHERE token_digest = ?1", [digest])?;
        Ok(())
    }

    fn invalidate_family(&self, principal: &str, family: &str) -> Result<(), RuntimeError> {
        self.conn().execute(
            "DELETE FROM _sessions WHERE principal = ?1 AND COALESCE(family, token_digest) = ?2",
            params![principal, family],
        )?;
        Ok(())
    }
}

impl Store {
    /// A session walk does not read application rows or use the catalog. Polls
    /// can retain this connection across a schema adoption, but never accept
    /// a credential from a replaced store. Keep this transaction private to
    /// the authority walk: ordinary row reads/writes still fence generation.
    // @ref LLP 3000.017#3.3 — poll authentication is independent of application catalog generation.
    pub(crate) fn resolve_session_snapshot(&self, digest: &str, now: i64, expected_store_id: Option<&str>, supervisor_revision: Option<usize>) -> Result<Option<(String, String)>, RuntimeError> {
        self.check_ownership()?;
        let sql = self.conn.unchecked_transaction()?;
        let identity: Option<String> = sql.query_row("SELECT value FROM _meta WHERE key = 'store_id'", [], |row| row.get(0)).optional()?;
        if expected_store_id.is_none() || identity.as_deref() != expected_store_id {
            sql.rollback()?;
            return Ok(None);
        }
        let tx = Tx { activation_scan: None, changes: Default::default(), sequence_table: Default::default(), tx: sql, page_size: self.page_size, catalog: &self.catalog };
        let resolved = crate::identity::resolve_session_tx(&tx, digest, now, supervisor_revision)?;
        tx.rollback()?;
        Ok(resolved)
    }

    /// Expiry pruning follows a completed authority snapshot. Keeping this
    /// best-effort cleanup outside the deferred read transaction avoids a
    /// read-to-write lock upgrade while rechecking the expiry predicate.
    pub(crate) fn invalidate_expired_authority_session(&self, digest: &str, now: i64) -> Result<(), RuntimeError> {
        self.conn.execute(
            "DELETE FROM _sessions WHERE token_digest = ?1 AND expires_at <= ?2",
            params![digest, now],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authority::test_cases;

    fn seeded() -> Store {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        for fact in test_cases::generations() {
            tx.conn().execute(
                "INSERT INTO _principal_generations(principal,generation) VALUES (?1,?2)",
                rusqlite::params![fact.0, fact.1],
            ).unwrap();
        }
        for fact in test_cases::sessions() {
            tx.conn().execute(
                "INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES (?1,?2,?3,?4,?5,?6)",
                rusqlite::params![fact.digest, fact.principal, fact.kind, fact.created_at, fact.expires_at, fact.family],
            ).unwrap();
        }
        for fact in test_cases::work() {
            tx.conn().execute(
                "INSERT INTO _requests(id,name,args,principal,at,state,claimed_by,session_digest,lease_until,deadline,family,principal_generation,admitted_expires_at,service_generation) VALUES (?1,'test','{}',?2,1,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                rusqlite::params![fact.id, fact.principal, fact.state, fact.claimed_by, fact.session_digest, fact.lease_until, fact.deadline, fact.family, fact.generation, fact.admitted_expires_at, fact.service_generation],
            ).unwrap();
        }
        tx.commit().unwrap();
        store
    }

    #[test]
    fn shared_authority_facts_map_on_sqlite() {
        let store = seeded();
        let tx = store.authority_transaction().unwrap();
        test_cases::assert_adapter_facts(&tx);
        tx.rollback().unwrap();
    }

    #[test]
    fn shared_authority_policy_cases_run_on_sqlite() {
        let store = seeded();
        let tx = store.authority_transaction().unwrap();
        test_cases::assert_policy_cases(&tx);
        tx.rollback().unwrap();
    }

    #[test]
    fn shared_authority_invalidations_run_on_sqlite() {
        let mut store = seeded();
        let tx = store.transaction().unwrap();
        test_cases::assert_invalidations(&tx);
        tx.commit().unwrap();
    }
}
