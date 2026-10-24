//! SQLite identity access. Identity policy stays in `crate::identity`.
// @ref LLP 3000.009.001.000#33-extraction-first-with-no-behavior-change — preserve statement order and transaction modes.
use super::{Store, Tx};
use crate::{
    RuntimeError,
    identity::{
        Credential, FullRotationRecord, IdentityStore, IdentityTransaction, PreparedSignup,
        ReadRotationRecord, Session, SessionMintRecord, SessionScope, digest,
    },
};
use rusqlite::{Connection, OptionalExtension, params};

// @ref LLP 3000.009#5.1 — refresh preserves admission authority; revocation changes its generation.
pub(super) fn initialize(conn: &Connection) -> Result<(), RuntimeError> {
    let columns: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('_sessions')")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    if !columns.iter().any(|name| name == "family") {
        conn.execute_batch("ALTER TABLE _sessions ADD COLUMN family TEXT;")?;
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS _sessions_family ON _sessions(principal, family, expires_at);
        CREATE TABLE IF NOT EXISTS _principal_generations (principal TEXT PRIMARY KEY, generation INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS _session_mint_bindings (
            invocation TEXT NOT NULL, intent TEXT NOT NULL, input_digest TEXT NOT NULL,
            principal TEXT NOT NULL, kind TEXT NOT NULL, days INTEGER NOT NULL,
            expires_at INTEGER NOT NULL, family TEXT NOT NULL, principal_generation INTEGER NOT NULL,
            PRIMARY KEY(invocation, intent)
        ) WITHOUT ROWID;")?;
    Ok(())
}

fn insert_session(conn: &Connection, session: &Session, now: i64) -> Result<(), RuntimeError> {
    conn.execute("DELETE FROM _sessions WHERE expires_at <= ?1", [now])?;
    // @ref LLP 3000.033#1.3 — sign-in collects expired families; read rotation
    // remains limited to its own family, including at the immutable cap.
    if present(conn)? {
        conn.execute(
            "DELETE FROM _read_sessions WHERE expires_at <= ?1 OR cap_expires_at <= ?1",
            [now],
        )?;
    }
    conn.execute(
        "INSERT OR IGNORE INTO _principals(id, kind, name, created_at) VALUES (?1, ?2, NULL, ?3)",
        params![session.principal, session.kind, now],
    )?;
    if session.scope == SessionScope::Read {
        return insert_read(conn, session, now, None);
    }
    conn.execute(
        "INSERT INTO _sessions(token_digest, principal, kind, created_at, expires_at, family) VALUES (?1, ?2, ?3, ?4, ?5, ?1)",
        params![digest(&session.token), session.principal, session.kind, now, session.expires_at],
    )?;
    Ok(())
}

fn mint_binding_record(
    conn: &Connection,
    invocation: &str,
    intent: &str,
) -> Result<Option<SessionMintRecord>, RuntimeError> {
    Ok(conn.query_row(
        "SELECT input_digest, principal, kind, days, expires_at, family, principal_generation, scope FROM _session_mint_bindings WHERE invocation = ?1 AND intent = ?2",
        params![invocation, intent],
        |row| Ok(SessionMintRecord { scope: row.get(7)?, input_digest: row.get(0)?, principal: row.get(1)?, kind: row.get(2)?, days: row.get(3)?, expires_at: row.get(4)?, family: row.get(5)?, principal_generation: row.get(6)? }),
    ).optional()?)
}

// @ref LLP 3000.033#1.3 — only minting installs read-session storage.
pub(crate) fn present(conn: &Connection) -> Result<bool, RuntimeError> {
    Ok(conn.prepare_cached("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '_read_sessions')")?.query_row([], |r| r.get(0))?)
}

// @ref LLP 3000.033#1.3 — first mint installs storage; opening and refused operations preserve its absence.
fn initialize_read(conn: &Connection) -> Result<(), RuntimeError> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS _read_sessions (
        token_digest TEXT PRIMARY KEY, principal TEXT NOT NULL, kind TEXT NOT NULL,
        family TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        cap_expires_at INTEGER NOT NULL, principal_generation INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS _read_sessions_family ON _read_sessions(principal, family, expires_at);")?;
    Ok(())
}

pub(super) fn initialize_binding_scope(conn: &Connection) -> Result<(), RuntimeError> {
    let has_scope: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('_session_mint_bindings') WHERE name = 'scope')", [], |r| r.get(0))?;
    if !has_scope {
        conn.execute_batch(
            "ALTER TABLE _session_mint_bindings ADD COLUMN scope TEXT NOT NULL DEFAULT 'full';",
        )?;
    }
    Ok(())
}

fn insert_read(
    conn: &Connection,
    session: &Session,
    now: i64,
    family: Option<(&str, i64)>,
) -> Result<(), RuntimeError> {
    if !present(conn)? { initialize_read(conn)?; }
    let digest = digest(&session.token);
    let generation: i64 = match family {
        Some((_, generation)) => generation,
        None => conn
            .query_row(
                "SELECT generation FROM _principal_generations WHERE principal = ?1",
                [&session.principal],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(0),
    };
    conn.execute("INSERT INTO _read_sessions(token_digest, principal, kind, family, created_at, expires_at, cap_expires_at, principal_generation) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![digest, session.principal, session.kind, family.map_or(digest.as_str(), |f| f.0), now, session.expires_at, session.cap_expires_at.expect("read cap"), generation])?;
    Ok(())
}

fn set_family(conn: &Connection, digest: &str, family: &str) -> Result<(), RuntimeError> {
    conn.execute(
        "UPDATE _sessions SET family = ?2 WHERE token_digest = ?1",
        params![digest, family],
    )?;
    Ok(())
}

impl IdentityTransaction for Tx<'_> {
    fn insert_identity_session(&self, session: &Session, now: i64) -> Result<(), RuntimeError> {
        if session.scope == SessionScope::Read { self.prepare_read_session_storage()?; }
        insert_session(self.conn(), session, now)?;
        if session.scope == SessionScope::Read { self.read_sessions_installed.set(true); }
        Ok(())
    }
    fn insert_read_session(
        &self,
        session: &Session,
        now: i64,
        family: Option<(&str, i64)>,
    ) -> Result<(), RuntimeError> {
        self.prepare_read_session_storage()?;
        insert_read(self.conn(), session, now, family)?;
        self.read_sessions_installed.set(true);
        Ok(())
    }
    fn initialize_mint_binding_scope(&self) -> Result<(), RuntimeError> {
        initialize_binding_scope(self.conn())
    }
    fn mint_binding_record(
        &self,
        invocation: &str,
        intent: &str,
    ) -> Result<Option<SessionMintRecord>, RuntimeError> {
        mint_binding_record(self.conn(), invocation, intent)
    }
    fn record_session_mint(
        &self,
        invocation: &str,
        intent: &str,
        record: &SessionMintRecord,
    ) -> Result<(), RuntimeError> {
        self.conn().execute(
            "INSERT INTO _session_mint_bindings(invocation, intent, input_digest, principal, kind, days, expires_at, family, principal_generation, scope) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'full')",
            params![invocation, intent, record.input_digest, record.principal, record.kind, record.days, record.expires_at, record.family, record.principal_generation],
        )?;
        Ok(())
    }
    fn set_identity_session_family(&self, digest: &str, family: &str) -> Result<(), RuntimeError> {
        set_family(self.conn(), digest, family)
    }
}

impl IdentityStore for Store {
    fn insert_identity_session(&self, session: &Session, now: i64) -> Result<(), RuntimeError> {
        let mut storage = if session.scope == SessionScope::Read { Some(self.read_sessions.install()?) } else { None };
        insert_session(&self.conn, session, now)?;
        if let Some(storage) = storage.as_mut() { **storage = true; }
        Ok(())
    }
    fn insert_identity_session_atomic(
        &self,
        session: &Session,
        now: i64,
    ) -> Result<(), RuntimeError> {
        let tx = self.conn.unchecked_transaction()?;
        let mut storage = if session.scope == SessionScope::Read { Some(self.read_sessions.install()?) } else { None };
        insert_session(&tx, session, now)?;
        tx.commit()?;
        if let Some(storage) = storage.as_mut() { **storage = true; }
        Ok(())
    }
    fn close_identity_session(&self, digest: &str) -> Result<(), RuntimeError> {
        self.conn.execute(
            "DELETE FROM _sessions WHERE token_digest = ?1",
            params![digest],
        )?;
        if present(&self.conn)? {
            self.conn.execute(
                "DELETE FROM _read_sessions WHERE token_digest = ?1",
                params![digest],
            )?;
        }
        Ok(())
    }
    fn full_rotation_record(
        &self,
        digest: &str,
        now: i64,
    ) -> Result<Option<FullRotationRecord>, RuntimeError> {
        Ok(self.conn.query_row(
            "SELECT principal, kind, expires_at - created_at, COALESCE(family, token_digest) FROM _sessions WHERE token_digest = ?1 AND expires_at > ?2",
            params![digest, now],
            |row| Ok(FullRotationRecord { principal: row.get(0)?, kind: row.get(1)?, lifetime_ms: row.get(2)?, family: row.get(3)? }),
        ).optional()?)
    }
    fn delete_expired_identity_session(&self, digest: &str, now: i64) -> Result<(), RuntimeError> {
        self.conn.execute(
            "DELETE FROM _sessions WHERE token_digest = ?1 AND expires_at <= ?2",
            params![digest, now],
        )?;
        Ok(())
    }
    fn replace_full_session(
        &self,
        old_digest: &str,
        session: &Session,
        family: &str,
        now: i64,
    ) -> Result<bool, RuntimeError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM _sessions WHERE expires_at <= ?1", [now])?;
        let removed = tx.execute(
            "DELETE FROM _sessions WHERE token_digest = ?1 AND expires_at > ?2",
            params![old_digest, now],
        )?;
        if removed == 0 {
            tx.commit()?;
            return Ok(false);
        }
        let mut storage = if session.scope == SessionScope::Read { Some(self.read_sessions.install()?) } else { None };
        insert_session(&tx, session, now)?;
        set_family(&tx, &digest(&session.token), family)?;
        tx.commit()?;
        if let Some(storage) = storage.as_mut() { **storage = true; }
        Ok(true)
    }
    fn signup_identity(
        &self,
        prepared: &PreparedSignup,
        session: &Session,
        now: i64,
        validate: impl FnOnce(Option<String>) -> Result<(), RuntimeError>,
    ) -> Result<(), RuntimeError> {
        let tx = self.conn.unchecked_transaction()?;
        let taken = tx
            .query_row(
                "SELECT principal FROM _credentials WHERE email = ?1",
                [&prepared.email],
                |row| row.get(0),
            )
            .optional()?;
        validate(taken)?;
        tx.execute(
            "INSERT INTO _principals(id, kind, name, created_at) VALUES (?1, 'user', ?2, ?3)",
            params![session.principal, prepared.email, now],
        )?;
        tx.execute(
            "INSERT INTO _credentials(principal, email, hash) VALUES (?1, ?2, ?3)",
            params![session.principal, prepared.email, prepared.hash],
        )?;
        let mut storage = if session.scope == SessionScope::Read { Some(self.read_sessions.install()?) } else { None };
        insert_session(&tx, session, now)?;
        tx.commit()?;
        if let Some(storage) = storage.as_mut() { **storage = true; }
        Ok(())
    }
    fn identity_credential(&self, email: &str) -> Result<Option<Credential>, RuntimeError> {
        Ok(self
            .conn
            .query_row(
                "SELECT principal, hash FROM _credentials WHERE email = ?1",
                [email],
                |row| {
                    Ok(Credential {
                        principal: row.get(0)?,
                        hash: row.get(1)?,
                    })
                },
            )
            .optional()?)
    }
    fn login_identity(
        &self,
        principal: &str,
        session: &Session,
        now: i64,
        validate: impl FnOnce(Option<String>) -> Result<(), RuntimeError>,
    ) -> Result<(), RuntimeError> {
        let tx = self.conn.unchecked_transaction()?;
        let current = tx
            .query_row(
                "SELECT hash FROM _credentials WHERE principal = ?1",
                [principal],
                |row| row.get(0),
            )
            .optional()?;
        validate(current)?;
        let mut storage = if session.scope == SessionScope::Read { Some(self.read_sessions.install()?) } else { None };
        insert_session(&tx, session, now)?;
        tx.commit()?;
        if let Some(storage) = storage.as_mut() { **storage = true; }
        Ok(())
    }
    fn rotate_read_session(
        &self,
        digest: &str,
        now: i64,
        mint: impl FnOnce(&ReadRotationRecord) -> Result<Option<Session>, RuntimeError>,
    ) -> Result<Option<Session>, RuntimeError> {
        let tx = rusqlite::Transaction::new_unchecked(
            &self.conn,
            rusqlite::TransactionBehavior::Immediate,
        )?;
        if !present(&tx)? {
            return Ok(None);
        }
        let found = tx.query_row(
            "SELECT principal, kind, family, expires_at, cap_expires_at, principal_generation,
         COALESCE((SELECT generation FROM _principal_generations WHERE principal = r.principal), 0)
         FROM _read_sessions r WHERE token_digest = ?1",
            params![digest], |r| Ok(ReadRotationRecord { principal: r.get(0)?, kind: r.get(1)?, family: r.get(2)?, expires_at: r.get(3)?, cap_expires_at: r.get(4)?, principal_generation: r.get(5)?, current_generation: r.get(6)? })).optional()?;
        let Some(record) = found else {
            return Ok(None);
        };
        let Some(session) = mint(&record)? else { return Ok(None); };
        tx.execute(
            "DELETE FROM _read_sessions WHERE family = ?1 AND principal = ?2",
            params![record.family, record.principal],
        )?;
        insert_read(
            &tx,
            &session,
            now,
            Some((&record.family, record.principal_generation)),
        )?;
        tx.commit()?;
        Ok(Some(session))
    }
    fn revoke_identity_principal(&self, principal: &str) -> Result<u64, RuntimeError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("INSERT INTO _principal_generations(principal, generation) VALUES (?1, 1) ON CONFLICT(principal) DO UPDATE SET generation = generation + 1", [principal])?;
        let mut removed = tx.execute(
            "DELETE FROM _sessions WHERE principal = ?1",
            params![principal],
        )? as u64;
        if present(&tx)? {
            removed += tx.execute(
                "DELETE FROM _read_sessions WHERE principal = ?1",
                params![principal],
            )? as u64;
        }
        tx.commit()?;
        Ok(removed)
    }
    fn identity_session_expiry(&self, digest: &str) -> Result<Option<i64>, RuntimeError> {
        let mut expiry = self
            .conn
            .query_row(
                "SELECT expires_at FROM _sessions WHERE token_digest = ?1",
                [digest],
                |r| r.get(0),
            )
            .optional()?;
        if expiry.is_none()
            && self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)",
                ["_read_sessions"],
                |r| r.get::<_, bool>(0),
            )?
        {
            expiry = self.conn.query_row("SELECT MIN(expires_at, cap_expires_at) FROM _read_sessions WHERE token_digest = ?1", [digest], |r| r.get(0)).optional()?;
        }
        Ok(expiry)
    }
    fn is_supervised_family(&self, digest: &str) -> Result<bool, RuntimeError> {
        Ok(self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM _sessions s JOIN _meta m
                 ON m.key = 'worker:family:' || COALESCE(s.family, s.token_digest)
                 OR (m.key = 'worker:session-family' AND m.value = COALESCE(s.family, s.token_digest))
                 WHERE s.token_digest = ?1)",
            [digest], |row| row.get(0),
        )?)
    }
    fn clear_worker_families(&self) -> Result<(), RuntimeError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM _sessions WHERE principal = 'service:worker' AND COALESCE(family, token_digest) = (SELECT value FROM _meta WHERE key = 'worker:session-family')", [])?;
        tx.execute(
            "DELETE FROM _meta WHERE key IN ('worker:session-family', 'worker:session-revision')",
            [],
        )?;
        tx.execute("DELETE FROM _sessions WHERE COALESCE(family, token_digest) IN (SELECT substr(key, 15) FROM _meta WHERE key LIKE 'worker:family:%')", [])?;
        tx.execute("DELETE FROM _meta WHERE key LIKE 'worker:family:%'", [])?;
        // The next supervisor owns fresh reports, including removed declarations.
        tx.execute(
            "DELETE FROM _meta WHERE key = 'worker:status' OR key LIKE 'worker:status:%'",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }
    fn revoke_worker_family(&self, family: Option<&str>) -> Result<(), RuntimeError> {
        let tx = self.conn.unchecked_transaction()?;
        if let Some(family) = family {
            tx.execute(
                "DELETE FROM _sessions WHERE COALESCE(family, token_digest) = ?1",
                [family],
            )?;
            tx.execute(
                "DELETE FROM _meta WHERE key = ?1",
                [format!("worker:family:{family}")],
            )?;
        } else {
            tx.execute("DELETE FROM _sessions WHERE principal = 'service:worker' AND COALESCE(family, token_digest) = (SELECT value FROM _meta WHERE key = 'worker:session-family')", [])?;
            tx.execute("DELETE FROM _meta WHERE key IN ('worker:session-family', 'worker:session-revision')", [])?;
        }
        tx.commit()?;
        Ok(())
    }
    // Credential and ownership marker commit together, including failed ownership checks.
    fn mint_supervised_child(
        &self,
        named: bool,
        now: i64,
        revision: usize,
        mint: impl FnOnce() -> Result<Session, RuntimeError>,
    ) -> Result<Session, RuntimeError> {
        let tx = self.conn.unchecked_transaction()?;
        let session = mint()?;
        insert_session(&tx, &session, now)?;
        let family = digest(&session.token);
        if named {
            self.check_ownership()?;
            tx.execute("INSERT INTO _meta(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![format!("worker:family:{family}"), revision.to_string()])?;
        } else {
            self.check_ownership()?;
            tx.execute("INSERT INTO _meta(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params!["worker:session-family", family])?;
            self.check_ownership()?;
            tx.execute("INSERT INTO _meta(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params!["worker:session-revision", revision.to_string()])?;
        }
        tx.commit()?;
        Ok(session)
    }
}

#[cfg(test)]
impl crate::identity::test_cases::RotationFixture for Store {
    fn seed_read_family(&self, session: &Session, generation: i64) {
        insert_read(&self.conn, session, 1_000, Some((&digest(&session.token), generation))).unwrap();
        self.read_sessions.publish(true);
    }
    fn drop_read_sessions(&self) {
        self.conn.execute_batch("DROP TABLE IF EXISTS _read_sessions").unwrap();
        self.read_sessions.publish(false);
    }
    fn read_sessions_present(&self) -> bool { present(&self.conn).unwrap() }
}

#[cfg(test)]
impl crate::identity::test_cases::IdentityFixture for Store {
    type Transaction<'a> = Tx<'a>;
    fn with_identity_tx<T>(&self, run: impl FnOnce(&Tx<'_>) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        let tx = self.authority_transaction()?;
        let result = run(&tx)?;
        tx.commit()?;
        Ok(result)
    }
    fn principal_facts(&self, principal: &str) -> Option<(String, Option<String>, i64)> {
        self.conn.query_row("SELECT kind,name,created_at FROM _principals WHERE id = ?1", [principal], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional().unwrap()
    }
    fn principal_ids(&self) -> Vec<String> {
        self.conn.prepare("SELECT id FROM _principals ORDER BY id").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap()
    }
    fn identity_row_counts(&self) -> [i64; 6] {
        ["_principals", "_principal_generations", "_sessions", "_read_sessions", "_credentials", "_session_mint_bindings"].map(|table| {
            if table == "_read_sessions" && !present(&self.conn).unwrap() { return 0; }
            self.conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0)).unwrap()
        })
    }
    fn null_full_family(&self, digest: &str) {
        self.conn.execute("UPDATE _sessions SET family = NULL WHERE token_digest = ?1", [digest]).unwrap();
    }
    fn set_worker_meta(&self, key: &str, value: &str) { self.set_meta(key, value).unwrap(); }
    fn worker_meta(&self, key: &str) -> Option<String> { self.meta(key).unwrap() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::test_cases;

    #[test]
    fn bound_action_kind_lost_delivery_recovers() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        test_cases::assert_bound_recovery(&tx, false);
        tx.commit().unwrap();
    }

    #[test]
    fn bound_read_only_family_lost_delivery_recovers() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        test_cases::assert_bound_recovery(&tx, true);
        tx.commit().unwrap();
    }

    #[test]
    fn shared_digest_in_both_session_tables_refused() {
        test_cases::assert_digest_in_both_session_tables_refused(&Store::memory().unwrap());
    }

    #[test]
    fn shared_nul_inputs_refused() {
        test_cases::assert_nul_inputs_refused(&Store::memory().unwrap());
    }
    #[test]
    fn shared_convenience_insert_conflict() {
        test_cases::assert_convenience_insert_conflict(&Store::memory().unwrap());
    }
    #[test]
    fn shared_missing_read_storage_created_on_insert() {
        test_cases::assert_missing_read_storage_created_on_insert(&Store::memory().unwrap());
    }

    #[test]
    fn shared_read_rotation_expired_refusal() {
        refusal_rolls_back(test_cases::RotationRefusal::Expired);
    }
    #[test]
    fn shared_read_rotation_cap_expired_refusal() {
        refusal_rolls_back(test_cases::RotationRefusal::CapExpired);
    }
    #[test]
    fn shared_read_rotation_stale_generation_refusal() {
        refusal_rolls_back(test_cases::RotationRefusal::StaleGeneration);
    }
    #[test]
    fn shared_read_rotation_missing_table_refusal() {
        refusal_rolls_back(test_cases::RotationRefusal::MissingTable);
    }

    #[test]
    fn shared_diagnostics() {
        test_cases::assert_diagnostics(&Store::memory().unwrap());
    }

    #[test]
    fn shared_latest_family_ties() {
        test_cases::assert_latest_family_ties(&Store::memory().unwrap());
    }

    fn refusal_rolls_back(refusal: test_cases::RotationRefusal) {
        use rusqlite::hooks::{AuthAction, AuthContext, Authorization, TransactionOperation};
        use std::sync::{Arc, Mutex};
        let store = Store::memory().unwrap();
        let endings = Arc::new(Mutex::new(Vec::new()));
        let observed = endings.clone();
        store.conn.authorizer(Some(move |ctx: AuthContext<'_>| {
            if let AuthAction::Transaction { operation } = ctx.action {
                observed.lock().unwrap().push(operation);
            }
            Authorization::Allow
        })).unwrap();
        test_cases::assert_read_rotation_refusal(&store, refusal);
        assert_eq!(endings.lock().unwrap().last(), Some(&TransactionOperation::Rollback),
            "a refused rotation must ROLLBACK, including an unchanged transaction");
    }

    #[test]
    fn shared_transaction_contract() {
        test_cases::assert_transaction_contract(&Store::memory().unwrap());
    }

    #[test]
    fn shared_mint_bindings() {
        test_cases::assert_mint_bindings(&Store::memory().unwrap());
    }

    #[test]
    fn shared_conflicts_and_collation() {
        test_cases::assert_conflicts_and_collation(&Store::memory().unwrap());
    }

    #[test]
    fn shared_nulls_counts_and_timestamps() {
        test_cases::assert_nulls_counts_and_timestamps(&Store::memory().unwrap());
    }

    #[test]
    fn shared_read_family_isolation() {
        test_cases::assert_read_family_isolation(&Store::memory().unwrap());
    }

    #[test]
    fn shared_worker_markers() {
        test_cases::assert_worker_markers(&Store::memory().unwrap());
    }

    #[test]
    fn shared_refresh_rollback_cases_run_on_sqlite() {
        test_cases::assert_refresh_rollback(&Store::memory().unwrap());
    }

    #[test]
    fn shared_credential_and_read_rotation_cases_run_on_sqlite() {
        test_cases::assert_credential_policy(&Store::memory().unwrap());
    }

    #[test]
    fn shared_worker_family_cases_run_on_sqlite() {
        test_cases::assert_worker_families(&Store::memory().unwrap());
    }
}

#[cfg(test)]
mod legacy_tests;

impl Store {
    // Identity composites historically use unchecked transactions, without the
    // application catalog fence. Do not substitute the engine's write opener.
    pub(crate) fn identity_member_transaction(&self, immediate: bool) -> Result<Tx<'_>, RuntimeError> {
        let tx = rusqlite::Transaction::new_unchecked(&self.conn, if immediate {
            rusqlite::TransactionBehavior::Immediate
        } else { rusqlite::TransactionBehavior::Deferred })?;
        Ok(Tx { lifecycle: false, read_sessions: &self.read_sessions, read_sessions_installed: Default::default(), read_sessions_at_start: self.read_sessions.present(), read_sessions_installation: Default::default(), activation_scan: None, changes: Default::default(), sequence_table: Default::default(),
            tx, page_size: self.page_size, server: self.server, catalog: &self.catalog })
    }
}

impl Tx<'_> {
    pub(crate) fn prepare_read_session_storage(&self) -> Result<(), RuntimeError> {
        if !self.read_sessions_at_start && self.read_sessions_installation.borrow().is_none() {
            *self.read_sessions_installation.borrow_mut() = Some(self.read_sessions.install()?);
        }
        Ok(())
    }
    pub(crate) fn note_read_session_storage(&self) { self.read_sessions_installed.set(true); }
}
