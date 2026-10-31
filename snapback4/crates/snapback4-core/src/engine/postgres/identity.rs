//! Postgres identity storage. Policy callbacks run under the ordinary head fence.
// @ref LLP 3000.009.001.000#31-three-layers — adapters return facts; identity policy stays in shared Rust.
use super::store::{Store, Tx, WriteMode, absent_text_key};
use crate::{
    RuntimeError,
    authority::AuthorityTransaction,
    identity::{
        Credential, FullRotationRecord, IdentityStore, IdentityTransaction, PreparedSignup,
        ReadRotationRecord, Session, SessionMintRecord, SessionScope, digest,
    },
};
use std::cell::RefCell;

// Additive attach-time installation, like _sequences; the versioned internal
// migration runner belongs to a separate P1 slice. The caller holds the head.
pub(super) const DDL: &str = r#"
CREATE TABLE IF NOT EXISTS _principals (id TEXT COLLATE "C" PRIMARY KEY, kind TEXT NOT NULL, name TEXT, created_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS _credentials (principal TEXT COLLATE "C" PRIMARY KEY, email TEXT COLLATE "C" NOT NULL UNIQUE, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS _session_mint_bindings (
    invocation TEXT COLLATE "C" NOT NULL, intent TEXT COLLATE "C" NOT NULL, input_digest TEXT NOT NULL,
    principal TEXT COLLATE "C" NOT NULL, kind TEXT NOT NULL, days BIGINT NOT NULL,
    expires_at BIGINT NOT NULL, family TEXT COLLATE "C" NOT NULL, principal_generation BIGINT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'full', PRIMARY KEY(invocation, intent)
);
CREATE TABLE IF NOT EXISTS _meta (key TEXT COLLATE "C" PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS _sessions_expiry ON _sessions(expires_at);
CREATE INDEX IF NOT EXISTS _sessions_family ON _sessions(principal, family, expires_at);
"#;

pub(super) fn read_sessions_present(tx: &Tx<'_>) -> Result<bool, RuntimeError> {
    Ok(tx.query("SELECT pg_catalog.to_regclass('_read_sessions') IS NOT NULL", &[])?[0].get(0))
}

impl IdentityTransaction for Tx<'_> {
    fn insert_identity_session(&self, session: &Session, now: i64) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("insert identity session")?;
        self.execute("DELETE FROM _sessions WHERE expires_at <= $1", &[&now])?;
        if read_sessions_present(self)? {
            self.execute(
                "DELETE FROM _read_sessions WHERE expires_at <= $1 OR cap_expires_at <= $1",
                &[&now],
            )?;
        }
        // SQLite's INSERT OR IGNORE preserves the first principal's facts.
        self.execute(
            "INSERT INTO _principals(id,kind,name,created_at) VALUES ($1,$2,NULL,$3) ON CONFLICT(id) DO NOTHING",
            &[&session.principal, &session.kind, &now],
        )?;
        if session.scope == SessionScope::Read {
            return self.insert_read_session(session, now, None);
        }
        self.execute_one(
            "INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES ($1,$2,$3,$4,$5,$1)",
            &[&digest(&session.token), &session.principal, &session.kind, &now, &session.expires_at],
        )?;
        Ok(())
    }

    fn insert_read_session(
        &self,
        session: &Session,
        now: i64,
        family: Option<(&str, i64)>,
    ) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("insert read session")?;
        // Attach owns installation. Missing storage after attach is corruption,
        // so the INSERT fails instead of taking DDL locks in this writer.
        let digest = digest(&session.token);
        let generation = match family {
            Some((_, generation)) => generation,
            None => self.principal_generation(&session.principal)?,
        };
        self.execute_one(
            "INSERT INTO _read_sessions(token_digest,principal,kind,family,created_at,expires_at,cap_expires_at,principal_generation) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            &[&digest, &session.principal, &session.kind, &family.map_or(digest.as_str(), |f| f.0), &now, &session.expires_at, &session.cap_expires_at.expect("read cap"), &generation],
        )?;
        Ok(())
    }

    fn initialize_mint_binding_scope(&self) -> Result<(), RuntimeError> {
        // This table is new to this adapter; attach installs scope with it.
        self.require_serialized_head_fence("initialize mint binding scope")
    }

    /// A NUL lookup key is absent without querying.
    fn mint_binding_record(
        &self,
        invocation: &str,
        intent: &str,
    ) -> Result<Option<SessionMintRecord>, RuntimeError> {
        if absent_text_key(&[invocation, intent]) { return Ok(None); }
        Ok(self.query(
            "SELECT input_digest,principal,kind,days,expires_at,family,principal_generation,scope FROM _session_mint_bindings WHERE invocation = $1 AND intent = $2",
            &[&invocation, &intent],
        )?.first().map(|row| SessionMintRecord {
            input_digest: row.get(0), principal: row.get(1), kind: row.get(2), days: row.get(3),
            expires_at: row.get(4), family: row.get(5), principal_generation: row.get(6), scope: row.get(7),
        }))
    }

    fn record_session_mint(
        &self,
        invocation: &str,
        intent: &str,
        record: &SessionMintRecord,
    ) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("record session mint")?;
        self.execute_one(
            "INSERT INTO _session_mint_bindings(invocation,intent,input_digest,principal,kind,days,expires_at,family,principal_generation,scope) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'full')",
            &[&invocation, &intent, &record.input_digest, &record.principal, &record.kind, &record.days, &record.expires_at, &record.family, &record.principal_generation],
        )?;
        Ok(())
    }

    fn set_identity_session_family(&self, digest: &str, family: &str) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("set identity session family")?;
        self.execute(
            "UPDATE _sessions SET family = $2 WHERE token_digest = $1",
            &[&digest, &family],
        )?;
        Ok(())
    }
}

// The driver starts transactions through &mut Store. This borrowed family view
// gives the shared &self port exclusive, scoped access without changing the
// evaluation engine's connection custody or introducing another connection.
fn with_tx<T>(
    store: &RefCell<&mut Store>,
    mode: Option<WriteMode>,
    run: impl FnOnce(&Tx<'_>) -> Result<T, RuntimeError>,
) -> Result<T, RuntimeError> {
    let mut store = store.borrow_mut();
    let tx = store.transaction(mode)?;
    let result = run(&tx)?;
    tx.commit()?;
    Ok(result)
}

fn write<T>(
    store: &RefCell<&mut Store>,
    run: impl FnOnce(&Tx<'_>) -> Result<T, RuntimeError>,
) -> Result<T, RuntimeError> {
    with_tx(store, Some(WriteMode::Serialized), run)
}

impl IdentityStore for RefCell<&mut Store> {
    fn insert_identity_session(&self, session: &Session, now: i64) -> Result<(), RuntimeError> {
        write(self, |tx| tx.insert_identity_session(session, now))
    }

    fn insert_identity_session_atomic(
        &self,
        session: &Session,
        now: i64,
    ) -> Result<(), RuntimeError> {
        write(self, |tx| tx.insert_identity_session(session, now))
    }

    fn close_identity_session(&self, digest: &str) -> Result<(), RuntimeError> {
        write(self, |tx| {
            tx.execute("DELETE FROM _sessions WHERE token_digest = $1", &[&digest])?;
            if read_sessions_present(tx)? {
                tx.execute(
                    "DELETE FROM _read_sessions WHERE token_digest = $1",
                    &[&digest],
                )?;
            }
            Ok(())
        })
    }

    /// A NUL lookup key is absent without querying.
    fn full_rotation_record(
        &self,
        digest: &str,
        now: i64,
    ) -> Result<Option<FullRotationRecord>, RuntimeError> {
        if absent_text_key(&[digest]) { return Ok(None); }
        with_tx(self, None, |tx| {
            Ok(tx.query(
            "SELECT principal,kind,expires_at - created_at,COALESCE(family,token_digest) FROM _sessions WHERE token_digest = $1 AND expires_at > $2",
            &[&digest, &now],
        )?.first().map(|row| FullRotationRecord {
            principal: row.get(0), kind: row.get(1), lifetime_ms: row.get(2), family: row.get(3),
        }))
        })
    }

    fn delete_expired_identity_session(&self, digest: &str, now: i64) -> Result<(), RuntimeError> {
        write(self, |tx| {
            tx.execute(
                "DELETE FROM _sessions WHERE token_digest = $1 AND expires_at <= $2",
                &[&digest, &now],
            )?;
            Ok(())
        })
    }

    fn replace_full_session(
        &self,
        old_digest: &str,
        session: &Session,
        family: &str,
        now: i64,
    ) -> Result<bool, RuntimeError> {
        write(self, |tx| {
            tx.execute("DELETE FROM _sessions WHERE expires_at <= $1", &[&now])?;
            let removed = tx.execute(
                "DELETE FROM _sessions WHERE token_digest = $1 AND expires_at > $2",
                &[&old_digest, &now],
            )?;
            if removed == 0 {
                return Ok(false);
            }
            tx.insert_identity_session(session, now)?;
            tx.set_identity_session_family(&digest(&session.token), family)?;
            Ok(true)
        })
    }

    fn signup_identity(
        &self,
        prepared: &PreparedSignup,
        session: &Session,
        now: i64,
        validate: impl FnOnce(Option<String>) -> Result<(), RuntimeError>,
    ) -> Result<(), RuntimeError> {
        write(self, |tx| {
            let taken = tx
                .query(
                    "SELECT principal FROM _credentials WHERE email = $1",
                    &[&prepared.email],
                )?
                .first()
                .map(|row| row.get(0));
            validate(taken)?;
            tx.execute_one(
                "INSERT INTO _principals(id,kind,name,created_at) VALUES ($1,'user',$2,$3)",
                &[&session.principal, &prepared.email, &now],
            )?;
            tx.execute_one(
                "INSERT INTO _credentials(principal,email,hash) VALUES ($1,$2,$3)",
                &[&session.principal, &prepared.email, &prepared.hash],
            )?;
            tx.insert_identity_session(session, now)
        })
    }

    /// A NUL lookup key is absent without querying.
    fn identity_credential(&self, email: &str) -> Result<Option<Credential>, RuntimeError> {
        if absent_text_key(&[email]) { return Ok(None); }
        with_tx(self, None, |tx| {
            Ok(tx
                .query(
                    "SELECT principal,hash FROM _credentials WHERE email = $1",
                    &[&email],
                )?
                .first()
                .map(|row| Credential {
                    principal: row.get(0),
                    hash: row.get(1),
                }))
        })
    }

    fn login_identity(
        &self,
        principal: &str,
        session: &Session,
        now: i64,
        validate: impl FnOnce(Option<String>) -> Result<(), RuntimeError>,
    ) -> Result<(), RuntimeError> {
        write(self, |tx| {
            let current = tx
                .query(
                    "SELECT hash FROM _credentials WHERE principal = $1",
                    &[&principal],
                )?
                .first()
                .map(|row| row.get(0));
            validate(current)?;
            tx.insert_identity_session(session, now)
        })
    }

    /// A NUL lookup key is absent without querying.
    fn rotate_read_session(
        &self,
        digest: &str,
        now: i64,
        mint: impl FnOnce(&ReadRotationRecord) -> Result<Option<Session>, RuntimeError>,
    ) -> Result<Option<Session>, RuntimeError> {
        if absent_text_key(&[digest]) { return Ok(None); }
        let mut store = self.borrow_mut();
        let tx = store.transaction(Some(WriteMode::Serialized))?;
        let result = (|| -> Result<Option<Session>, RuntimeError> {
            if !read_sessions_present(&tx)? {
                return Ok(None);
            }
            let found = tx.query(
                "SELECT principal,kind,family,expires_at,cap_expires_at,principal_generation,COALESCE((SELECT generation FROM _principal_generations WHERE principal = r.principal),0) FROM _read_sessions r WHERE token_digest = $1",
                &[&digest],
            )?.first().map(|row| ReadRotationRecord {
                principal: row.get(0), kind: row.get(1), family: row.get(2), expires_at: row.get(3),
                cap_expires_at: row.get(4), principal_generation: row.get(5), current_generation: row.get(6),
            });
            let Some(record) = found else {
                return Ok(None);
            };
            let Some(session) = mint(&record)? else {
                return Ok(None);
            };
            tx.execute(
                "DELETE FROM _read_sessions WHERE family = $1 AND principal = $2",
                &[&record.family, &record.principal],
            )?;
            tx.insert_read_session(
                &session,
                now,
                Some((&record.family, record.principal_generation)),
            )?;
            Ok(Some(session))
        })()?;
        if result.is_some() {
            tx.commit()?;
        } else {
            tx.rollback()?;
        }
        Ok(result)
    }

    fn revoke_identity_principal(&self, principal: &str) -> Result<u64, RuntimeError> {
        write(self, |tx| {
            tx.execute_one("INSERT INTO _principal_generations(principal,generation) VALUES ($1,1) ON CONFLICT(principal) DO UPDATE SET generation = _principal_generations.generation + 1", &[&principal])?;
            let mut removed =
                tx.execute("DELETE FROM _sessions WHERE principal = $1", &[&principal])?;
            if read_sessions_present(tx)? {
                removed += tx.execute(
                    "DELETE FROM _read_sessions WHERE principal = $1",
                    &[&principal],
                )?;
            }
            Ok(removed)
        })
    }

    fn delete_identity_principal(&self, principal: &str) -> Result<u64, RuntimeError> {
        write(self, |tx| {
            tx.execute_one("INSERT INTO _principal_generations(principal,generation) VALUES ($1,1) ON CONFLICT(principal) DO UPDATE SET generation = _principal_generations.generation + 1", &[&principal])?;
            let mut removed = tx.execute("DELETE FROM _sessions WHERE principal = $1", &[&principal])?;
            if read_sessions_present(tx)? {
                removed += tx.execute("DELETE FROM _read_sessions WHERE principal = $1", &[&principal])?;
            }
            tx.execute("DELETE FROM _session_mint_bindings WHERE principal = $1", &[&principal])?;
            tx.execute("DELETE FROM _credentials WHERE principal = $1", &[&principal])?;
            tx.execute("DELETE FROM _principals WHERE id = $1", &[&principal])?;
            Ok(removed)
        })
    }

    /// A NUL lookup key is absent without querying.
    fn identity_session_expiry(&self, digest: &str) -> Result<Option<i64>, RuntimeError> {
        if absent_text_key(&[digest]) { return Ok(None); }
        with_tx(self, None, |tx| {
            let expiry = tx
                .query(
                    "SELECT expires_at FROM _sessions WHERE token_digest = $1",
                    &[&digest],
                )?
                .first()
                .map(|row| row.get(0));
            if expiry.is_some() || !read_sessions_present(tx)? {
                return Ok(expiry);
            }
            Ok(tx.query("SELECT LEAST(expires_at,cap_expires_at) FROM _read_sessions WHERE token_digest = $1", &[&digest])?.first().map(|row| row.get(0)))
        })
    }

    /// A NUL digest is absent without querying.
    fn is_supervised_family(&self, digest: &str) -> Result<bool, RuntimeError> {
        if absent_text_key(&[digest]) { return Ok(false); }
        with_tx(self, None, |tx| {
            Ok(tx.query(
            "SELECT EXISTS(SELECT 1 FROM _sessions s JOIN _meta m ON m.key = 'worker:family:' || COALESCE(s.family,s.token_digest) OR (m.key = 'worker:session-family' AND m.value = COALESCE(s.family,s.token_digest)) WHERE s.token_digest = $1)",
            &[&digest],
        )?[0].get(0))
        })
    }

    fn clear_worker_families(&self) -> Result<(), RuntimeError> {
        // SQLite LIKE folds ASCII case. C-collated ILIKE preserves its marker
        // prefix matching, while equality on identity keys stays byte-exact.
        write(self, |tx| {
            tx.execute("DELETE FROM _sessions WHERE principal = 'service:worker' AND COALESCE(family,token_digest) = (SELECT value FROM _meta WHERE key = 'worker:session-family')", &[])?;
            tx.execute("DELETE FROM _meta WHERE key IN ('worker:session-family','worker:session-revision')", &[])?;
            tx.execute("DELETE FROM _sessions WHERE COALESCE(family,token_digest) IN (SELECT substr(key,15) FROM _meta WHERE key ILIKE 'worker:family:%')", &[])?;
            tx.execute("DELETE FROM _meta WHERE key ILIKE 'worker:family:%'", &[])?;
            tx.execute(
                "DELETE FROM _meta WHERE key = 'worker:status' OR key ILIKE 'worker:status:%'",
                &[],
            )?;
            Ok(())
        })
    }

    fn revoke_worker_family(&self, family: Option<&str>) -> Result<(), RuntimeError> {
        write(self, |tx| {
            if let Some(family) = family {
                tx.execute(
                    "DELETE FROM _sessions WHERE COALESCE(family,token_digest) = $1",
                    &[&family],
                )?;
                tx.execute(
                    "DELETE FROM _meta WHERE key = $1",
                    &[&format!("worker:family:{family}")],
                )?;
            } else {
                tx.execute("DELETE FROM _sessions WHERE principal = 'service:worker' AND COALESCE(family,token_digest) = (SELECT value FROM _meta WHERE key = 'worker:session-family')", &[])?;
                tx.execute("DELETE FROM _meta WHERE key IN ('worker:session-family','worker:session-revision')", &[])?;
            }
            Ok(())
        })
    }

    fn mint_supervised_child(
        &self,
        named: bool,
        now: i64,
        revision: usize,
        mint: impl FnOnce() -> Result<Session, RuntimeError>,
    ) -> Result<Session, RuntimeError> {
        write(self, |tx| {
            let session = mint()?;
            tx.insert_identity_session(&session, now)?;
            let family = digest(&session.token);
            if named {
                tx.execute_one("INSERT INTO _meta(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", &[&format!("worker:family:{family}"), &revision.to_string()])?;
            } else {
                tx.execute_one("INSERT INTO _meta(key,value) VALUES ('worker:session-family',$1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", &[&family])?;
                tx.execute_one("INSERT INTO _meta(key,value) VALUES ('worker:session-revision',$1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", &[&revision.to_string()])?;
            }
            Ok(session)
        })
    }
}

impl Tx<'_> {
    pub(super) fn install_read_sessions(&self) -> Result<(), RuntimeError> {
        self.batch(super::store::READ_SESSIONS_DDL)?;
        self.read_sessions_installed.set(true);
        Ok(())
    }
}
