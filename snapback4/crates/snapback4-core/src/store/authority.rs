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
       (SELECT value FROM _meta WHERE key = 'device:generation'),
       (SELECT COALESCE(MAX(seq), 0) FROM _commits)
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
       (SELECT value FROM _meta WHERE key = 'device:generation'),
       (SELECT COALESCE(MAX(seq), 0) FROM _commits)
FROM (SELECT 1) AS anchor LEFT JOIN sessions s ON true
LEFT JOIN _principal_generations g ON g.principal = s.principal";

const BATCH_FULL_FACTS: &str = "WITH sessions AS (SELECT principal, COALESCE(family, token_digest) AS family, kind, token_digest, expires_at, 0 AS scope, NULL AS cap_expires_at, NULL AS principal_generation FROM _sessions WHERE token_digest IN (SELECT value FROM json_each(?1)))
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
       (SELECT value FROM _meta WHERE key = 'device:generation'),
       (SELECT COALESCE(MAX(seq), 0) FROM _commits), req.value
FROM json_each(?1) AS req LEFT JOIN sessions s ON s.token_digest = req.value
LEFT JOIN _principal_generations g ON g.principal = s.principal";
const BATCH_READ_FACTS: &str = "WITH sessions AS (SELECT principal, COALESCE(family, token_digest) AS family, kind, token_digest, expires_at, 0 AS scope, NULL AS cap_expires_at, NULL AS principal_generation FROM _sessions WHERE token_digest IN (SELECT value FROM json_each(?1)) UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE token_digest IN (SELECT value FROM json_each(?1)))
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
       (SELECT value FROM _meta WHERE key = 'device:generation'),
       (SELECT COALESCE(MAX(seq), 0) FROM _commits), req.value
FROM json_each(?1) AS req LEFT JOIN sessions s ON s.token_digest = req.value
LEFT JOIN _principal_generations g ON g.principal = s.principal";

impl Tx<'_> {
    // @ref LLP 3000.009.001.000.002#sqlite-overlay-layout-proof — a qualified wave cannot change managed authority; members still resolve these facts with fresh clocks.
    pub(crate) fn batch_authority_facts(&self, requests: &[crate::store_port::batch::Request]) -> Result<Vec<crate::store_port::batch::Facts>, RuntimeError> {
        use std::collections::{BTreeMap, BTreeSet};
        let digests: BTreeSet<&str> = requests.iter().filter_map(|r| r.digest.as_deref()).filter(|d| !d.contains('\0')).collect();
        if digests.is_empty() { return Ok(requests.iter().map(|_| Default::default()).collect()); }
        let encoded = serde_json::to_string(&digests).map_err(|e| RuntimeError::Store(e.to_string()))?;
        let mut read = self.read_sessions_at_start || self.read_sessions_installed.get();
        let mut facts = BTreeMap::new();
        loop {
            facts.clear();
            let mut stmt = self.conn().prepare_cached(if read { BATCH_READ_FACTS } else { BATCH_FULL_FACTS })?;
            let mut rows = stmt.query([&encoded])?;
            while let Some(row) = rows.next()? { append_fact_row(row, facts.entry(row.get::<_, String>(19)?).or_insert(None))?; }
            if !read && facts.values().any(|f| f.as_ref().is_some_and(|f| f.sessions.is_empty())) && read_sessions::present(self.conn())? {
                read = true; self.read_sessions_installed.set(true); continue;
            }
            break;
        }
        Ok(requests.iter().map(|r| crate::store_port::batch::Facts { authority: r.digest.as_ref().and_then(|d| facts.get(d).and_then(|f| f.clone()).map(|f| (d.clone(), f))), ..Default::default() }).collect())
    }
    pub(crate) fn session_authority_facts(&self, digest: &str) -> Result<crate::identity::facts::SessionFacts, RuntimeError> {
        let mut facts = fetch(self.conn(), digest, self.read_sessions_installed.get() || self.read_sessions_at_start, &self.read_sessions_installed)?;
        // @ref LLP 3000.009.001.000.002#sqlite-durable-write-cycle — serial members see the buffered predecessor's logical head before the physical tail is flushed.
        if let Some(batch) = self.group_tail.borrow().as_ref() { facts.head = batch.head; }
        Ok(facts)
    }
}
impl Store {
    pub(crate) fn ingress_session_authority_facts(&self, digest: &str) -> Result<crate::identity::facts::SessionFacts, RuntimeError> {
        if digest.contains('\0') { return Ok(Default::default()); }
        self.check_ownership()?;
        let storage = self.read_sessions.snapshot()?;
        let discovered = std::cell::Cell::new(false);
        let facts = fetch(&self.conn, digest, *storage, &discovered);
        drop(storage);
        if discovered.get() { self.read_sessions.publish(true); }
        facts
    }
}
fn fetch(conn: &rusqlite::Connection, digest: &str, read: bool, discovered: &std::cell::Cell<bool>) -> Result<crate::identity::facts::SessionFacts, RuntimeError> {
        // A raw digest is an optional lookup key, never an admitted identity.
        if digest.contains('\0') { return Ok(Default::default()); }
        let mut statement = conn.prepare_cached(if read { READ_FACTS } else { FULL_FACTS })?;
        let mut rows = statement.query([digest])?;
        let mut facts = None;
        while let Some(row) = rows.next()? {
            // Keep the anchor cursor alive: catalog discovery and the read-arm
            // retry must borrow this snapshot even for autocommit ingress.
            if !read && row.get::<_, Option<String>>(0)?.is_none() && read_sessions::present(conn)? {
                discovered.set(true);
                return fetch(conn, digest, true, discovered);
            }
            append_fact_row(row, &mut facts)?;
        }
        Ok(facts.expect("anchor returns metadata even for an absent token"))
}

fn append_fact_row(row: &rusqlite::Row<'_>, facts: &mut Option<crate::identity::facts::SessionFacts>) -> rusqlite::Result<()> {
            let result = facts.get_or_insert_with(|| crate::identity::facts::SessionFacts {
                revision: None,
                head: 0, sessions: Vec::new(), current_generation: 0, worker_family: None,
                worker_revision: None, family_revision: None, store_generation: None, store_id: None,
                backend_generation: None, schema_hash: None, activation_hash: None, device_generation: None,
            });
            result.head = row.get::<_, i64>(18)? as u64;
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
    Ok(())
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
    // The caller validates the complete local revision before and after using
    // these frozen authority facts. BEGIN DEFERRED performs no database read.
    pub(crate) fn cached_authority_transaction(&mut self) -> Result<Tx<'_>, RuntimeError> {
        self.check_ownership()?;
        let sql = self.conn.transaction_with_behavior(rusqlite::TransactionBehavior::Deferred)?;
        let read_storage = self.read_sessions.snapshot()?;
        Ok(Tx { cache_revision: &self.cache_revision, handlers: &self.handlers, group_tail: Default::default(), lifecycle: false, read_sessions: &self.read_sessions, read_sessions_installed: Default::default(), read_sessions_at_start: *read_storage, read_sessions_installation: Default::default(), activation_scan: None, changes: Default::default(), sequence_table: Default::default(), tx: sql, page_size: self.page_size, server: self.server, catalog: &self.catalog })
    }
    pub(crate) fn session_authority_transaction(&self, digest: &str, validate_generation: bool) -> Result<(Tx<'_>, crate::identity::facts::SessionFacts), RuntimeError> {
        self.check_ownership()?;
        let cache_before = self.cache_revision.sample();
        let sql = self.conn.unchecked_transaction()?;
        // Hold only until the SELECT pins the schema and authority snapshot.
        let read_storage = self.read_sessions.snapshot()?;
        let tx = Tx { cache_revision: &self.cache_revision, handlers: &self.handlers, group_tail: Default::default(), lifecycle: false, read_sessions: &self.read_sessions, read_sessions_installed: Default::default(), read_sessions_at_start: *read_storage, read_sessions_installation: Default::default(), activation_scan: None, changes: Default::default(), sequence_table: Default::default(), tx: sql, page_size: self.page_size, server: self.server, catalog: &self.catalog };
        let mut facts = tx.session_authority_facts(digest)?;
        if self.cache_scope().is_some() {
            facts.revision = self.cache_revision.snapshot(cache_before);
            facts.backend_generation = facts.store_generation.as_deref().and_then(|g| g.parse().ok());
        }
        drop(read_storage);
        // This dedicated snapshot has no writes: discovery observes committed
        // storage, so later snapshots can use the one-statement hit path.
        if tx.read_sessions_installed.get() { self.read_sessions.publish(true); }
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
    fn sqlite_batch_authority_facts_match_scalar_full_read_absent_and_duplicate() {
        use crate::store_port::batch::Request;
        for read_storage in [false, true] {
            let mut store = Store::memory().unwrap();
            if read_storage {
                let tx = store.transaction().unwrap();
                tx.insert_read_session(&Session { principal: "member:install".into(), kind: "member".into(), token: "ro.install".into(), expires_at: 10000, cap_expires_at: Some(10000), scope: SessionScope::Read }, 0, None).unwrap();
                tx.commit().unwrap();
            }
            for (n, case) in identity::facts::tests::cases(read_storage).into_iter().enumerate() {
                if n % 131 != 0 && case.edge == 0 { continue; }
                let tx = store.transaction().unwrap();
                tx.conn().execute_batch(&case.seed()).unwrap();
                let requests: Vec<_> = [Some("digest"), Some("absent"), Some("digest"), None].into_iter().map(|d| Request { digest: d.map(str::to_owned), principal: "member:matrix".into(), id: None }).collect();
                let batched = tx.batch_authority_facts(&requests).unwrap();
                for (request, facts) in requests.iter().zip(batched) {
                    match request.digest.as_deref() {
                        Some(d) => assert_eq!(facts.authority.unwrap(), (d.to_owned(), tx.session_authority_facts(d).unwrap()), "{case:?}"),
                        None => assert!(facts.authority.is_none()),
                    }
                }
                assert!(tx.batch_authority_facts(&[]).unwrap().is_empty());
                tx.rollback().unwrap();
            }
        }
    }

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
                identity::facts::tests::compare(&tx, &tx, |digest| tx.session_authority_facts(digest), &case);
                let scope = Scope::begin();
                tx.session_authority_facts("digest").unwrap();
                assert_eq!(scope.counts().sqlite, if !read_storage && case.state == 2 { 2 } else { 1 });
                drop(scope);
                tx.rollback().unwrap();
                total += 1;
            }
        }
        println!("SQLite authority facts: {total} generated states; hits use one SELECT");
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
    #[test]
    fn authority_facts_forks_retain_live_read_sessions() {
        let mut store = Store::memory().unwrap();
        let session = Session { principal: "member:fork".into(), kind: "member".into(), token: "ro.fork".into(), expires_at: 10000, cap_expires_at: Some(10000), scope: SessionScope::Read };
        let tx = store.transaction().unwrap();
        tx.insert_read_session(&session, 0, None).unwrap();
        tx.commit().unwrap();
        let fork = store.fork_memory().unwrap();
        assert!(fork.read_sessions.present());
        let (tx, facts) = fork.session_authority_transaction(&identity::digest(&session.token), true).unwrap();
        assert!(identity::facts::resolve(&tx, facts, 1000, None).unwrap().is_some());
        tx.rollback().unwrap();
        let engine = crate::Engine::memory(crate::Schema::default(), []).unwrap();
        use crate::identity::IdentityStore;
        engine.store().insert_identity_session_atomic(&session, 0).unwrap();
        let fork = engine.fork_fixture().unwrap();
        assert!(identity::resolve(fork.store(), &session.token, 1000).unwrap().is_some());
    }

    #[test]
    fn authority_facts_independent_sqlite_handles_discover_lazy_storage() {
        let root = std::env::temp_dir().join(format!("rt3a-independent-{}", crate::ids::seed()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("store.sqlite");
        let mut writer = Store::open(&path).unwrap();
        let reader = Store::open_read_only(&path).unwrap();
        let attached = Store::open(&path).unwrap(); // prepare() has an independent flag too.
        assert!(!reader.read_sessions.present());
        assert!(!attached.read_sessions.present());
        let session = Session { principal: "member:independent".into(), kind: "member".into(), token: "ro.independent".into(), expires_at: 10000, cap_expires_at: Some(10000), scope: SessionScope::Read };
        let held = reader.authority_transaction().unwrap();
        let tx = writer.transaction().unwrap();
        tx.insert_read_session(&session, 0, None).unwrap();
        tx.commit().unwrap();
        assert!(held.session_authority_facts(&identity::digest(&session.token)).unwrap().sessions.is_empty());
        held.rollback().unwrap();
        for reader in [&reader, &attached] {
            let store_id = writer.store_id().unwrap();
            assert!(reader.resolve_session_snapshot(&identity::digest(&session.token), 1000, Some(&store_id), None).unwrap().is_some());
            assert!(reader.read_sessions.present());
            let tx = reader.authority_transaction().unwrap();
            let scope = Scope::begin();
            assert_eq!(tx.session_authority_facts(&identity::digest(&session.token)).unwrap().sessions.len(), 1);
            assert_eq!(scope.counts().sqlite, 1);
            drop(scope);
            tx.rollback().unwrap();
        }
        drop(reader); drop(attached); drop(writer);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ingress_discovers_storage_on_an_independent_sqlite_handle() {
        let root = std::env::temp_dir().join(format!("rt3br-ingress-{}", crate::ids::seed()));
        std::fs::create_dir(&root).unwrap();
        let mut writer = Store::open(&root.join("store.sqlite")).unwrap();
        let reader = Store::open_read_only(&root.join("store.sqlite")).unwrap();
        let session = Session { principal: "member:ingress".into(), kind: "member".into(), token: "ro.ingress".into(), expires_at: 10000, cap_expires_at: Some(10000), scope: SessionScope::Read };
        let tx = writer.transaction().unwrap();
        tx.insert_read_session(&session, 0, None).unwrap();
        tx.commit().unwrap();
        let digest = identity::digest(&session.token);
        let scope = Scope::begin();
        assert_eq!(reader.ingress_session_authority_facts(&digest).unwrap().sessions.len(), 1);
        assert_eq!(scope.counts().sqlite, 3, "miss, catalog, retry in the held anchor snapshot");
        drop(scope);
        let scope = Scope::begin();
        assert_eq!(reader.ingress_session_authority_facts(&digest).unwrap().sessions.len(), 1);
        assert!(reader.ingress_session_authority_facts("raw\0digest").unwrap().sessions.is_empty());
        assert_eq!(scope.counts().sqlite, 1, "known-storage hit plus zero-query NUL absence");
        drop(scope);
        drop(reader); drop(writer);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn authority_facts_raw_nul_digest_is_absent_without_querying_sqlite() {
        let store = Store::memory().unwrap();
        let tx = crate::store_port::AnyTx::from_sqlite(store.authority_transaction().unwrap());
        let scope = Scope::begin();
        assert!(identity::resolve_session_tx(&tx, "raw\0digest", 1000, None).unwrap().is_none());
        assert!(tx.session_authority_facts("raw\0digest").unwrap().sessions.is_empty());
        assert_eq!(scope.counts().sqlite, 0);
        drop(scope);
        tx.rollback().unwrap();
    }

    #[test]
    fn snapshot_openers_treat_a_raw_nul_digest_as_absent_without_querying() {
        let store: crate::store_port::AnyStore = Store::memory().unwrap().into();
        let scope = Scope::begin();
        assert!(identity::resolve_session_record_snapshot(&store, "raw\0digest", 1000, None, None).unwrap().is_none());
        assert!(store.resolve_session_snapshot("raw\0digest", 1000, Some("store"), None).unwrap().is_none());
        assert_eq!(scope.counts().sqlite, 0);
    }

}
