//! Identity access for direct members. SQL stays inside the store adapter;
//! shared orchestration preserves each existing durable boundary.
// @ref LLP 3000.009.001.000.000#3.7 — explicit dispositions and restricted family operations, including non-sequenced writes.
#[cfg(feature = "postgres")]
use super::handles::PostgresTx;
use super::handles::{SqliteStore, SqliteTx};
use crate::{
    RuntimeError,
    engine::committer::{Committer, Kind, Member},
    identity::{
        IdentityTransaction, PreparedSignup, ReadRotationRecord, Session, SessionScope, digest,
    },
    store_port::{AnyStore, AnyTx, IdentitySource},
};
use rusqlite::{OptionalExtension, params};

// Match the adapter's execute_one contract without exposing its raw method.
#[cfg(feature = "postgres")]
fn one_row(result: Result<u64, RuntimeError>) -> Result<u64, RuntimeError> {
    let rows = result?;
    if rows != 1 {
        return Err(RuntimeError::Store(format!(
            "expected one affected row, got {rows}"
        )));
    }
    Ok(rows)
}

/// The individual writes of SQLite's convenience mint/close are separate
/// members: an error must retain earlier autocommitted statements.
pub(crate) enum SessionEdit<'a> {
    InitializeReadTable,
    InitializeReadIndex,
    ReadToken(&'a Session, i64, i64),
    SweepFull(i64),
    SweepRead(i64),
    Principal(&'a Session, i64),
    Token(&'a Session, i64),
    DeleteFull(&'a str),
    DeleteRead(&'a str),
    DeleteExpired(&'a str, i64),
    DeleteLive(&'a str, i64),
    DeleteReadFamily(&'a str, &'a str),
    Generation(&'a str),
    RevokeFull(&'a str),
    RevokeRead(&'a str),
}
impl AnyTx<'_> {
    pub(crate) fn read_session_storage(&self) -> Result<bool, RuntimeError> {
        match self {
            Self::Sqlite(SqliteTx(tx)) => crate::store::identity::present(tx.conn()),
            #[cfg(feature = "postgres")]
            Self::Postgres(PostgresTx(tx)) => {
                Ok(tx.query("SELECT to_regclass('_read_sessions') IS NOT NULL", &[])?[0].get(0))
            }
        }
    }
    pub(crate) fn edit_session(&self, edit: SessionEdit<'_>) -> Result<u64, RuntimeError> {
        use SessionEdit::*;
        Ok(match self {
            Self::Sqlite(SqliteTx(tx)) => {
                let conn = tx.conn();
                (match edit {
                    InitializeReadTable => { tx.prepare_read_session_storage()?; conn.execute("CREATE TABLE IF NOT EXISTS _read_sessions (
        token_digest TEXT PRIMARY KEY, principal TEXT NOT NULL, kind TEXT NOT NULL,
        family TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        cap_expires_at INTEGER NOT NULL, principal_generation INTEGER NOT NULL
    )", []).map(|n| { tx.note_read_session_storage(); n })? },
                    InitializeReadIndex => conn.execute("CREATE INDEX IF NOT EXISTS _read_sessions_family ON _read_sessions(principal, family, expires_at)", [])?,
                    ReadToken(s, now, generation) => conn.execute("INSERT INTO _read_sessions(token_digest, principal, kind, family, created_at, expires_at, cap_expires_at, principal_generation) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)", params![digest(&s.token), s.principal, s.kind, digest(&s.token), now, s.expires_at, s.cap_expires_at.expect("read cap"), generation])?,

                    SweepFull(now) => conn.execute("DELETE FROM _sessions WHERE expires_at <= ?1", [now])?,
                    SweepRead(now) => conn.execute("DELETE FROM _read_sessions WHERE expires_at <= ?1 OR cap_expires_at <= ?1", [now])?,
                    Principal(s, now) => conn.execute("INSERT OR IGNORE INTO _principals(id, kind, name, created_at) VALUES (?1, ?2, NULL, ?3)", params![s.principal, s.kind, now])?,
                    Token(s, now) if s.scope == SessionScope::Read => { tx.insert_read_session(s, now, None)?; 0 },
                    Token(s, now) => conn.execute("INSERT INTO _sessions(token_digest, principal, kind, created_at, expires_at, family) VALUES (?1, ?2, ?3, ?4, ?5, ?1)", params![digest(&s.token), s.principal, s.kind, now, s.expires_at])?,
                    DeleteFull(d) => conn.execute("DELETE FROM _sessions WHERE token_digest = ?1", params![d])?,
                    DeleteRead(d) => conn.execute("DELETE FROM _read_sessions WHERE token_digest = ?1", params![d])?,
                    DeleteExpired(d, now) => conn.execute("DELETE FROM _sessions WHERE token_digest = ?1 AND expires_at <= ?2", params![d, now])?,
                    DeleteLive(d, now) => conn.execute("DELETE FROM _sessions WHERE token_digest = ?1 AND expires_at > ?2", params![d, now])?,
                    DeleteReadFamily(family, principal) => conn.execute("DELETE FROM _read_sessions WHERE family = ?1 AND principal = ?2", params![family, principal])?,
                    Generation(p) => conn.execute("INSERT INTO _principal_generations(principal, generation) VALUES (?1, 1) ON CONFLICT(principal) DO UPDATE SET generation = generation + 1", [p])?,
                    RevokeFull(p) => conn.execute("DELETE FROM _sessions WHERE principal = ?1", params![p])?,
                    RevokeRead(p) => conn.execute("DELETE FROM _read_sessions WHERE principal = ?1", params![p])?,
                }) as u64
            }
            #[cfg(feature = "postgres")]
            Self::Postgres(PostgresTx(tx)) => match edit {
                InitializeReadTable | InitializeReadIndex | ReadToken(..) => return Err(RuntimeError::StoreUnsupported { family: "sqlite-convenience-identity" }),

                SweepFull(now) => tx.execute("DELETE FROM _sessions WHERE expires_at <= $1", &[&now])?,
                SweepRead(now) => tx.execute("DELETE FROM _read_sessions WHERE expires_at <= $1 OR cap_expires_at <= $1", &[&now])?,
                Principal(s, now) => tx.execute("INSERT INTO _principals(id,kind,name,created_at) VALUES ($1,$2,NULL,$3) ON CONFLICT(id) DO NOTHING", &[&s.principal, &s.kind, &now])?,
                Token(s, now) if s.scope == SessionScope::Read => { tx.insert_read_session(s, now, None)?; 0 },
                Token(s, now) => one_row(tx.execute("INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES ($1,$2,$3,$4,$5,$1)", &[&digest(&s.token), &s.principal, &s.kind, &now, &s.expires_at]))?,
                DeleteFull(d) => tx.execute("DELETE FROM _sessions WHERE token_digest = $1", &[&d])?,
                DeleteRead(d) => tx.execute("DELETE FROM _read_sessions WHERE token_digest = $1", &[&d])?,
                DeleteExpired(d, now) => tx.execute("DELETE FROM _sessions WHERE token_digest = $1 AND expires_at <= $2", &[&d, &now])?,
                DeleteLive(d, now) => tx.execute("DELETE FROM _sessions WHERE token_digest = $1 AND expires_at > $2", &[&d, &now])?,
                DeleteReadFamily(family, principal) => tx.execute("DELETE FROM _read_sessions WHERE family = $1 AND principal = $2", &[&family, &principal])?,
                Generation(p) => one_row(tx.execute("INSERT INTO _principal_generations(principal,generation) VALUES ($1,1) ON CONFLICT(principal) DO UPDATE SET generation = _principal_generations.generation + 1", &[&p]))?,
                RevokeFull(p) => tx.execute("DELETE FROM _sessions WHERE principal = $1", &[&p])?,
                RevokeRead(p) => tx.execute("DELETE FROM _read_sessions WHERE principal = $1", &[&p])?,
            }
        })
    }
    pub(crate) fn clear_worker_identity(&self) -> Result<(), RuntimeError> {
        match self {
            Self::Sqlite(SqliteTx(tx)) => {
                for sql in [
                    "DELETE FROM _sessions WHERE principal = 'service:worker' AND COALESCE(family, token_digest) = (SELECT value FROM _meta WHERE key = 'worker:session-family')",
                    "DELETE FROM _meta WHERE key IN ('worker:session-family', 'worker:session-revision')",
                    "DELETE FROM _sessions WHERE COALESCE(family, token_digest) IN (SELECT substr(key, 15) FROM _meta WHERE key LIKE 'worker:family:%')",
                    "DELETE FROM _meta WHERE key LIKE 'worker:family:%'",
                    "DELETE FROM _meta WHERE key = 'worker:status' OR key LIKE 'worker:status:%'",
                ] {
                    tx.conn().execute(sql, [])?;
                }
            }
            #[cfg(feature = "postgres")]
            Self::Postgres(PostgresTx(tx)) => {
                for sql in [
                    "DELETE FROM _sessions WHERE principal = 'service:worker' AND COALESCE(family,token_digest) = (SELECT value FROM _meta WHERE key = 'worker:session-family')",
                    "DELETE FROM _meta WHERE key IN ('worker:session-family','worker:session-revision')",
                    "DELETE FROM _sessions WHERE COALESCE(family,token_digest) IN (SELECT substr(key,15) FROM _meta WHERE key ILIKE 'worker:family:%')",
                    "DELETE FROM _meta WHERE key ILIKE 'worker:family:%'",
                    "DELETE FROM _meta WHERE key = 'worker:status' OR key ILIKE 'worker:status:%'",
                ] {
                    tx.execute(sql, &[])?;
                }
            }
        }
        Ok(())
    }
    pub(crate) fn signup_taken(&self, email: &str) -> Result<Option<String>, RuntimeError> {
        match self {
            Self::Sqlite(SqliteTx(tx)) => Ok(tx
                .conn()
                .query_row(
                    "SELECT principal FROM _credentials WHERE email = ?1",
                    [email],
                    |r| r.get(0),
                )
                .optional()?),
            #[cfg(feature = "postgres")]
            Self::Postgres(PostgresTx(tx)) => Ok(tx
                .query(
                    "SELECT principal FROM _credentials WHERE email = $1",
                    &[&email],
                )?
                .first()
                .map(|r| r.get(0))),
        }
    }
    pub(crate) fn signup_account(
        &self,
        prepared: &PreparedSignup,
        session: &Session,
        now: i64,
    ) -> Result<(), RuntimeError> {
        match self {
            Self::Sqlite(SqliteTx(tx)) => {
                tx.conn().execute("INSERT INTO _principals(id, kind, name, created_at) VALUES (?1, 'user', ?2, ?3)", params![session.principal, prepared.email, now])?;
                tx.conn().execute(
                    "INSERT INTO _credentials(principal, email, hash) VALUES (?1, ?2, ?3)",
                    params![session.principal, prepared.email, prepared.hash],
                )?;
            }
            #[cfg(feature = "postgres")]
            Self::Postgres(PostgresTx(tx)) => {
                one_row(tx.execute(
                    "INSERT INTO _principals(id,kind,name,created_at) VALUES ($1,'user',$2,$3)",
                    &[&session.principal, &prepared.email, &now],
                ))?;
                one_row(tx.execute(
                    "INSERT INTO _credentials(principal,email,hash) VALUES ($1,$2,$3)",
                    &[&session.principal, &prepared.email, &prepared.hash],
                ))?;
            }
        }
        Ok(())
    }
    pub(crate) fn login_hash(&self, principal: &str) -> Result<Option<String>, RuntimeError> {
        match self {
            Self::Sqlite(SqliteTx(tx)) => Ok(tx
                .conn()
                .query_row(
                    "SELECT hash FROM _credentials WHERE principal = ?1",
                    [principal],
                    |r| r.get(0),
                )
                .optional()?),
            #[cfg(feature = "postgres")]
            Self::Postgres(PostgresTx(tx)) => Ok(tx
                .query(
                    "SELECT hash FROM _credentials WHERE principal = $1",
                    &[&principal],
                )?
                .first()
                .map(|r| r.get(0))),
        }
    }
    pub(crate) fn read_rotation(
        &self,
        digest: &str,
    ) -> Result<Option<ReadRotationRecord>, RuntimeError> {
        if !self.read_session_storage()? {
            return Ok(None);
        }
        match self {
            Self::Sqlite(SqliteTx(tx)) => Ok(tx.conn().query_row(
                "SELECT principal, kind, family, expires_at, cap_expires_at, principal_generation,
         COALESCE((SELECT generation FROM _principal_generations WHERE principal = r.principal), 0)
         FROM _read_sessions r WHERE token_digest = ?1", params![digest], |r| Ok(ReadRotationRecord { principal: r.get(0)?, kind: r.get(1)?, family: r.get(2)?, expires_at: r.get(3)?, cap_expires_at: r.get(4)?, principal_generation: r.get(5)?, current_generation: r.get(6)? })).optional()?),
            #[cfg(feature = "postgres")]
            Self::Postgres(PostgresTx(tx)) => Ok(tx.query("SELECT principal,kind,family,expires_at,cap_expires_at,principal_generation,COALESCE((SELECT generation FROM _principal_generations WHERE principal = r.principal),0) FROM _read_sessions r WHERE token_digest = $1", &[&digest])?.first().map(|r| ReadRotationRecord { principal: r.get(0), kind: r.get(1), family: r.get(2), expires_at: r.get(3), cap_expires_at: r.get(4), principal_generation: r.get(5), current_generation: r.get(6) })),
        }
    }
}

impl AnyStore {
    fn session_edit_member(&self, edit: SessionEdit<'_>) -> Result<(), RuntimeError> {
        Committer::run(
            IdentitySource(self, false),
            Member::new(Kind::Direct, |tx| {
                tx.edit_session(edit)?;
                tx.complete(())
            }),
        )
    }
    pub(crate) fn insert_session_member(
        &self,
        session: &Session,
        now: i64,
        atomic: bool,
    ) -> Result<(), RuntimeError> {
        if !atomic {
            match self {
                Self::Sqlite(SqliteStore(store)) => {
                    // Retain convenience mint's partial durability and statement order.
                    self.session_edit_member(SessionEdit::SweepFull(now))?;
                    if crate::store::identity::present(store.conn())? {
                        self.session_edit_member(SessionEdit::SweepRead(now))?;
                    }
                    self.session_edit_member(SessionEdit::Principal(session, now))?;
                    if session.scope == SessionScope::Read {
                        if !crate::store::identity::present(store.conn())? {
                            self.session_edit_member(SessionEdit::InitializeReadTable)?;
                            self.session_edit_member(SessionEdit::InitializeReadIndex)?;
                        }
                        let generation = store.conn().query_row(
                            "SELECT generation FROM _principal_generations WHERE principal = ?1",
                            [&session.principal], |r| r.get(0)).optional()?.unwrap_or(0);
                        return self
                            .session_edit_member(SessionEdit::ReadToken(session, now, generation));
                    }
                    return self.session_edit_member(SessionEdit::Token(session, now));
                }
                #[cfg(feature = "postgres")]
                Self::Postgres(_) => {}
            }
        }
        Committer::run(
            IdentitySource(self, false),
            Member::new(Kind::Direct, |tx| {
                tx.insert_identity_session(session, now)?;
                tx.complete(())
            }),
        )
    }
    pub(crate) fn close_session_member(&self, digest: &str) -> Result<(), RuntimeError> {
        match self {
            Self::Sqlite(SqliteStore(store)) => {
                self.session_edit_member(SessionEdit::DeleteFull(digest))?;
                if crate::store::identity::present(store.conn())? {
                    self.session_edit_member(SessionEdit::DeleteRead(digest))?;
                }
                Ok(())
            }
            #[cfg(feature = "postgres")]
            Self::Postgres(_) => Committer::run(
                IdentitySource(self, false),
                Member::new(Kind::Direct, |tx| {
                    tx.invalidate_session(digest)?;
                    tx.complete(())
                }),
            ),
        }
    }

    pub(crate) fn delete_expired_session_member(
        &self,
        digest: &str,
        now: i64,
    ) -> Result<(), RuntimeError> {
        self.session_edit_member(SessionEdit::DeleteExpired(digest, now))
    }
    pub(crate) fn replace_session_member(
        &self,
        old_digest: &str,
        session: &Session,
        family: &str,
        now: i64,
    ) -> Result<bool, RuntimeError> {
        Committer::run(
            IdentitySource(self, false),
            Member::new(Kind::Direct, |tx| {
                tx.edit_session(SessionEdit::SweepFull(now))?;
                if tx.edit_session(SessionEdit::DeleteLive(old_digest, now))? == 0 {
                    return tx.complete(false);
                }
                tx.insert_identity_session(session, now)?;
                tx.set_identity_session_family(&digest(&session.token), family)?;
                tx.complete(true)
            }),
        )
    }
    pub(crate) fn signup_member(
        &self,
        prepared: &PreparedSignup,
        session: &Session,
        now: i64,
        validate: impl FnOnce(Option<String>) -> Result<(), RuntimeError>,
    ) -> Result<(), RuntimeError> {
        Committer::run(
            IdentitySource(self, false),
            Member::new(Kind::Direct, |tx| {
                validate(tx.signup_taken(&prepared.email)?)?;
                tx.signup_account(prepared, session, now)?;
                tx.insert_identity_session(session, now)?;
                tx.complete(())
            }),
        )
    }
    pub(crate) fn login_member(
        &self,
        principal: &str,
        session: &Session,
        now: i64,
        validate: impl FnOnce(Option<String>) -> Result<(), RuntimeError>,
    ) -> Result<(), RuntimeError> {
        Committer::run(
            IdentitySource(self, false),
            Member::new(Kind::Direct, |tx| {
                validate(tx.login_hash(principal)?)?;
                tx.insert_identity_session(session, now)?;
                tx.complete(())
            }),
        )
    }
    pub(crate) fn rotate_read_member(
        &self,
        digest: &str,
        now: i64,
        mint: impl FnOnce(&ReadRotationRecord) -> Result<Option<Session>, RuntimeError>,
    ) -> Result<Option<Session>, RuntimeError> {
        // Postgres's NUL lookup policy precedes transaction opening.
        #[cfg(feature = "postgres")]
        if matches!(self, Self::Postgres(_)) && digest.contains('\0') {
            return Ok(None);
        }
        Committer::run(
            IdentitySource(self, true),
            Member::new(Kind::Direct, |tx| {
                let Some(record) = tx.read_rotation(digest)? else {
                    return tx.abort(None);
                };
                let Some(session) = mint(&record)? else {
                    return tx.abort(None);
                };
                tx.edit_session(SessionEdit::DeleteReadFamily(
                    &record.family,
                    &record.principal,
                ))?;
                tx.insert_read_session(
                    &session,
                    now,
                    Some((&record.family, record.principal_generation)),
                )?;
                tx.complete(Some(session))
            }),
        )
    }
    pub(crate) fn clear_worker_identity_member(&self) -> Result<(), RuntimeError> {
        Committer::run(
            IdentitySource(self, false),
            Member::new(Kind::Direct, |tx| {
                tx.clear_worker_identity()?;
                tx.complete(())
            }),
        )
    }
    pub(crate) fn revoke_principal_member(&self, principal: &str) -> Result<u64, RuntimeError> {
        Committer::run(
            IdentitySource(self, false),
            Member::new(Kind::Direct, |tx| {
                tx.edit_session(SessionEdit::Generation(principal))?;
                let mut removed = tx.edit_session(SessionEdit::RevokeFull(principal))?;
                if tx.read_session_storage()? {
                    removed += tx.edit_session(SessionEdit::RevokeRead(principal))?;
                }
                tx.complete(removed)
            }),
        )
    }
}

#[cfg(test)]
#[path = "../identity_member_tests.rs"]
mod tests;
