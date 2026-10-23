use super::{Store, Tx};
use super::identity as read_sessions;
use crate::{
    RuntimeError,
    authority::{AdmissionRecord, AuthorityTransaction, SessionRecord, WorkRecord},
};
use rusqlite::{OptionalExtension, params};


// @ref LLP 3000.009.001.000.001#32-one-statement-fetches-a-guest-sessions-authority-facts — PK lookups bound the union to two rows; no authority decisions in SQL.
const FULL_FACTS: &str = "WITH sessions AS (SELECT principal, COALESCE(family, token_digest) AS family, kind, token_digest, expires_at, 0 AS scope, NULL AS cap_expires_at, NULL AS principal_generation FROM _sessions WHERE token_digest = ?1)
SELECT s.principal, s.family, s.kind, s.token_digest, s.expires_at, s.scope,
       s.cap_expires_at, s.principal_generation, COALESCE(g.generation, 0),
       (SELECT value FROM _meta WHERE key = 'worker:session-family'),
       (SELECT value FROM _meta WHERE key = 'worker:session-revision'),
       (SELECT value FROM _meta WHERE key = 'worker:family:' || s.family),
       (SELECT value FROM _meta WHERE key = 'generation'),
       (SELECT value FROM _meta WHERE key = 'store_id'),
       NULL,
       (SELECT value FROM _meta WHERE key = 'schema_hash'),
       (SELECT value FROM _meta WHERE key = 'activation_hash'),
       (SELECT value FROM _meta WHERE key = 'device:generation')
FROM (SELECT 1) AS anchor LEFT JOIN sessions s ON true
LEFT JOIN _principal_generations g ON g.principal = s.principal";
const READ_FACTS: &str = "WITH sessions AS (SELECT principal, COALESCE(family, token_digest) AS family, kind, token_digest, expires_at, 0 AS scope, NULL AS cap_expires_at, NULL AS principal_generation FROM _sessions WHERE token_digest = ?1 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE token_digest = ?1)
SELECT s.principal, s.family, s.kind, s.token_digest, s.expires_at, s.scope,
       s.cap_expires_at, s.principal_generation, COALESCE(g.generation, 0),
       (SELECT value FROM _meta WHERE key = 'worker:session-family'),
       (SELECT value FROM _meta WHERE key = 'worker:session-revision'),
       (SELECT value FROM _meta WHERE key = 'worker:family:' || s.family),
       (SELECT value FROM _meta WHERE key = 'generation'),
       (SELECT value FROM _meta WHERE key = 'store_id'),
       NULL,
       (SELECT value FROM _meta WHERE key = 'schema_hash'),
       (SELECT value FROM _meta WHERE key = 'activation_hash'),
       (SELECT value FROM _meta WHERE key = 'device:generation')
FROM (SELECT 1) AS anchor LEFT JOIN sessions s ON true
LEFT JOIN _principal_generations g ON g.principal = s.principal";

impl Tx<'_> {
    pub(crate) fn session_authority_facts(&self, digest: &str) -> Result<crate::identity::facts::SessionFacts, RuntimeError> {
        crate::authority::refuse_nul(&[(digest, "a session digest cannot contain U+0000")])?;
        let read = self.read_sessions_installed.get() || self.read_sessions_at_start;
        let mut statement = self.conn().prepare_cached(if read { READ_FACTS } else { FULL_FACTS })?;
        let mut rows = statement.query([digest])?;
        let mut facts = None;
        while let Some(row) = rows.next()? {
            let result = facts.get_or_insert_with(|| crate::identity::facts::SessionFacts {
                sessions: Vec::new(), current_generation: 0, worker_family: None,
                worker_revision: None, family_revision: None, store_generation: None, store_id: None,
                backend_generation: None, schema_hash: None, activation_hash: None, device_generation: None,
            });
            result.current_generation = row.get(8)?;
            result.worker_family = row.get(9)?; result.worker_revision = row.get(10)?;
            result.family_revision = row.get(11)?; result.store_generation = row.get(12)?; result.store_id = row.get(13)?;
            result.backend_generation = row.get(14)?; result.schema_hash = row.get(15)?;
            result.activation_hash = row.get(16)?; result.device_generation = row.get(17)?;
            if row.get::<_, Option<String>>(0)?.is_some() {
                result.sessions.push(SessionRecord {
                    principal: row.get(0)?, family: row.get(1)?, kind: row.get(2)?, digest: row.get(3)?,
                    expires_at: row.get(4)?, scope: if row.get::<_, i64>(5)? == 1 { crate::authority::SessionScope::Read } else { crate::authority::SessionScope::Full },
                    cap_expires_at: row.get(6)?, principal_generation: row.get(7)?,
                });
            }
        }
        Ok(facts.expect("anchor returns metadata even for an absent token"))
    }
}

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
        // Missing read-session storage carries no authority and never creates it.
        let sql = if read_sessions::present(self.conn())? {
            "SELECT principal, COALESCE(family, token_digest), kind, token_digest, expires_at, 0, NULL, NULL FROM _sessions WHERE token_digest = ?1 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE token_digest = ?1"
        } else {
            "SELECT principal, COALESCE(family, token_digest), kind, token_digest, expires_at, 0, NULL, NULL FROM _sessions WHERE token_digest = ?1"
        };
        Ok(self.tx.query_one(
            sql,
            [digest],
            |row| {
                Ok(SessionRecord {
                principal: row.get(0)?, family: row.get(1)?, kind: row.get(2)?,
                digest: row.get(3)?, expires_at: row.get(4)?,
                scope: if row.get::<_, i64>(5)? == 1 { crate::identity::SessionScope::Read } else { crate::identity::SessionScope::Full },
                cap_expires_at: row.get(6)?, principal_generation: row.get(7)?,
            })
            }).optional()?)
    }

    // @ref LLP 3000.009.001.000#91-adapter-parity-rules — digest and scope break expiry ties across both tables.
    fn latest_live_family_member(
        &self,
        principal: &str,
        family: &str,
        now: i64,
    ) -> Result<Option<SessionRecord>, RuntimeError> {
        // Missing read-session storage carries no authority and never creates it.
        let sql = if read_sessions::present(self.conn())? {
            "SELECT principal, COALESCE(family, token_digest), kind, token_digest, expires_at, 0, NULL, NULL FROM _sessions WHERE principal = ?1 AND COALESCE(family, token_digest) = ?2 AND expires_at > ?3 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE principal = ?1 AND family = ?2 AND expires_at > ?3 ORDER BY expires_at DESC, token_digest ASC, 6 ASC LIMIT 1"
        } else {
            "SELECT principal, COALESCE(family, token_digest), kind, token_digest, expires_at, 0, NULL, NULL FROM _sessions WHERE principal = ?1 AND COALESCE(family, token_digest) = ?2 AND expires_at > ?3 ORDER BY expires_at DESC, token_digest ASC, 6 ASC LIMIT 1"
        };
        Ok(self.tx.query_row(
            sql,
            params![principal, family, now],
            |row| {
                Ok(SessionRecord {
                principal: row.get(0)?, family: row.get(1)?, kind: row.get(2)?,
                digest: row.get(3)?, expires_at: row.get(4)?,
                scope: if row.get::<_, i64>(5)? == 1 { crate::identity::SessionScope::Read } else { crate::identity::SessionScope::Full },
                cap_expires_at: row.get(6)?, principal_generation: row.get(7)?,
            })
            }).optional()?)
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
                &format!("SELECT {WORK_COLUMNS} FROM _requests WHERE session_digest = ?1 ORDER BY id LIMIT 1"),
                [digest],
                read_work,
            )
            .optional()?)
    }

    fn invalidate_session(&self, digest: &str) -> Result<(), RuntimeError> {
        self.conn()
            .execute("DELETE FROM _sessions WHERE token_digest = ?1", [digest])?;
        if read_sessions::present(self.conn())? {
            self.conn().execute("DELETE FROM _read_sessions WHERE token_digest = ?1", [digest])?;
        }
        Ok(())
    }

    fn invalidate_family(&self, principal: &str, family: &str) -> Result<(), RuntimeError> {
        self.conn().execute(
            "DELETE FROM _sessions WHERE principal = ?1 AND COALESCE(family, token_digest) = ?2",
            params![principal, family],
        )?;
        if read_sessions::present(self.conn())? {
            self.conn().execute("DELETE FROM _read_sessions WHERE principal = ?1 AND family = ?2", params![principal, family])?;
        }
        Ok(())
    }
}

impl Store {
    pub(crate) fn session_authority_transaction(&self, digest: &str, validate_generation: bool) -> Result<(Tx<'_>, crate::identity::facts::SessionFacts), RuntimeError> {
        self.check_ownership()?;
        let sql = self.conn.unchecked_transaction()?;
        // Hold only until the SELECT pins the schema and authority snapshot.
        let read_storage = self.read_sessions.snapshot()?;
        let tx = Tx { read_sessions: &self.read_sessions, read_sessions_installed: Default::default(), read_sessions_at_start: *read_storage, read_sessions_installation: Default::default(), activation_scan: None, changes: Default::default(), sequence_table: Default::default(), tx: sql, page_size: self.page_size, server: self.server, catalog: &self.catalog };
        let facts = tx.session_authority_facts(digest)?;
        if validate_generation && (facts.schema_hash.clone(), facts.activation_hash.clone(), facts.store_generation.clone(), facts.device_generation.clone()) != self.identity {
            return Err(RuntimeError::Generation("the store adopted another backend; reopen this engine".into()));
        }
        Ok((tx, facts))
    }

    /// Detached authority is catalog-independent, but bound to this incarnation.
    // @ref LLP 3000.017#3.3 — poll authentication is independent of application catalog generation.
    pub(crate) fn resolve_session_snapshot(&self, digest: &str, now: i64, expected_store_id: Option<&str>, supervisor_revision: Option<usize>) -> Result<Option<crate::identity::Capability>, RuntimeError> {
        let (tx, facts) = self.session_authority_transaction(digest, false)?;
        if expected_store_id.is_none() || facts.store_id.as_deref() != expected_store_id {
            tx.rollback()?;
            return Ok(None);
        }
        let tx = crate::store_port::AnyTx::from_sqlite(tx);
        let resolved = crate::identity::facts::resolve(&tx, facts, now, supervisor_revision)?
            .map(|s| (s.principal, s.kind, s.scope));
        tx.rollback()?;
        Ok(resolved)
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

#[cfg(test)]
mod facts_tests {
    use super::*;
    use crate::{identity::{self, IdentityTransaction, Session, SessionScope}, round_trips::Scope};

    #[test]
    fn authority_facts_equivalence_sqlite_generated_matrix() {
        let mut total = 0;
        for read_storage in [false, true] {
            let mut store = Store::memory().unwrap();
            if read_storage {
                let tx = store.transaction().unwrap();
                tx.insert_read_session(&Session { principal: "member:install".into(), kind: "member".into(), token: "ro.install".into(), expires_at: 10000, cap_expires_at: Some(10000), scope: SessionScope::Read }, 0, None).unwrap();
                tx.commit().unwrap();
            }
            for case in identity::facts::tests::cases(read_storage) {
                let tx = store.transaction().unwrap();
                tx.conn().execute_batch(&case.seed()).unwrap();
                identity::facts::tests::compare(&tx, |digest| tx.session_authority_facts(digest), &case);
                let scope = Scope::begin();
                tx.session_authority_facts("digest").unwrap();
                assert_eq!(scope.counts().sqlite, 1);
                drop(scope);
                tx.rollback().unwrap();
                total += 1;
            }
        }
        println!("SQLite authority facts: {total} generated states; one SELECT each");
    }

    #[test]
    fn authority_facts_lazy_install_reaches_existing_reader_and_rollback_does_not() {
        let root = std::env::temp_dir().join(format!("rt3a-lazy-{}", crate::ids::seed()));
        std::fs::create_dir(&root).unwrap();
        let mut store = Store::open(&root.join("store.sqlite")).unwrap();
        let reader = store.reader().unwrap();
        let session = Session { principal: "member:read".into(), kind: "member".into(), token: "ro.lazy".into(), expires_at: 10000, cap_expires_at: Some(10000), scope: SessionScope::Read };
        let tx = store.transaction().unwrap();
        tx.savepoint("install").unwrap();
        tx.insert_read_session(&session, 0, None).unwrap();
        tx.rollback_to("install").unwrap();
        assert!(tx.session_authority_facts(&identity::digest(&session.token)).unwrap().sessions.is_empty());
        tx.commit().unwrap();
        assert!(!read_sessions::present(&store.conn).unwrap());
        let tx = store.transaction().unwrap();
        tx.insert_read_session(&session, 0, None).unwrap();
        tx.rollback().unwrap();
        assert!(!read_sessions::present(&store.conn).unwrap());
        let held = reader.authority_transaction().unwrap();
        let tx = store.transaction().unwrap();
        tx.insert_read_session(&session, 0, None).unwrap();
        tx.commit().unwrap();
        assert!(held.session_authority_facts(&identity::digest(&session.token)).unwrap().sessions.is_empty(), "old snapshot preserves absent storage");
        held.rollback().unwrap();
        let store_id = store.store_id().unwrap();
        assert!(reader.resolve_session_snapshot(&identity::digest(&session.token), 1000, Some(&store_id), Some(7)).unwrap().is_some());
        drop(reader); drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
}
