//! Debug-only corruption hooks; no backend owning handle is exposed.
// @ref LLP 3000.009.001.000#3.4 — explicit fixture connections stay debug-only; owning payloads remain opaque.
use super::handles::{AnyStore, AnyTx, SqliteStore, SqliteTx};
use crate::RuntimeError;
macro_rules! fixture_access {
    ($handle:ty, $wrapper:ident) => {
        impl $handle {
            pub fn test_support_conn(&self) -> &rusqlite::Connection {
                match self { Self::Sqlite($wrapper(inner)) => inner.test_support_conn(), #[cfg(feature = "postgres")] Self::Postgres(_) => panic!("SQLite fixture") }
            }
            pub fn test_support_write_count(&self, table: &str, columns: Vec<(i32, rusqlite::types::Value)>, actions: &[&str]) -> std::sync::Arc<std::sync::atomic::AtomicUsize> {
                match self { Self::Sqlite($wrapper(inner)) => inner.test_support_write_count(table, columns, actions), #[cfg(feature = "postgres")] Self::Postgres(_) => panic!("SQLite fixture") }
            }
            pub fn test_support_meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
                match self { Self::Sqlite($wrapper(inner)) => inner.test_support_meta(key), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "sqlite-fixture" }) }
            }
            pub fn test_support_set_meta(&self, key: &str, value: &str) -> Result<(), RuntimeError> {
                match self { Self::Sqlite($wrapper(inner)) => inner.test_support_set_meta(key, value), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "sqlite-fixture" }) }
            }
        }
    };
}
fixture_access!(AnyStore, SqliteStore);
fixture_access!(AnyTx<'_>, SqliteTx);

#[cfg(all(test, feature = "postgres"))]
impl AnyStore {
    pub(crate) fn test_postgres_handle(&self) -> &crate::engine::postgres::Handle {
        match self { Self::Postgres(super::handles::PostgresStore(h)) => h, _ => panic!("Postgres fixture") }
    }
    pub(crate) fn test_postgres_handle_mut(&mut self) -> &mut crate::engine::postgres::Handle {
        match self { Self::Postgres(super::handles::PostgresStore(h)) => h, _ => panic!("Postgres fixture") }
    }
}
#[cfg(all(test, feature = "postgres"))]
impl<'store> AnyTx<'store> {
    pub(crate) fn test_postgres_tx(&self) -> &crate::engine::postgres::store::Tx<'store> {
        match self { Self::Postgres(super::handles::PostgresTx(tx)) => tx, _ => panic!("Postgres fixture") }
    }
}

impl<'store> super::handles::ReadSnapshot<'store> {
    pub fn test_support_conn(&self) -> &rusqlite::Connection { self.tx.test_support_conn() }
    #[cfg(all(test, feature = "postgres"))]
    pub(crate) fn test_postgres_tx(&self) -> &crate::engine::postgres::store::Tx<'store> {
        self.tx.test_postgres_tx()
    }
}

// These typed corruptions exist only in test-support. No SQL or backend
// handle crosses the port, including in the HTTP boundary witnesses.
impl AnyStore {
    pub fn test_request_store_id(&mut self, id: &str) -> Result<(), RuntimeError> {
        let tx = self.transaction()?;
        match &tx {
            AnyTx::Sqlite(SqliteTx(inner)) => { inner.conn().execute("UPDATE _meta SET value=?1 WHERE key='store_id'", [id])?; }
            #[cfg(feature = "postgres")]
            AnyTx::Postgres(super::handles::PostgresTx(inner)) => { inner.execute("UPDATE _meta SET value=$1 WHERE key='store_id'", &[&id])?; }
        }
        tx.commit()
    }

    pub fn test_request_read_scope(&mut self, token: &str, duplicate: bool) -> Result<(), RuntimeError> {
        use crate::{authority::AuthorityTransaction, identity::IdentityTransaction};
        let digest = crate::identity::digest(token);
        let tx = self.transaction()?;
        let facts = tx.session_authority_facts(&digest)?;
        let old = facts.sessions.first().expect("test credential");
        let session = crate::identity::Session { principal: old.principal.clone(), kind: old.kind.clone(), token: token.into(), expires_at: old.expires_at, scope: crate::identity::SessionScope::Read, cap_expires_at: Some(old.expires_at) };
        let generation = facts.current_generation;
        if !duplicate { tx.invalidate_session(&digest)?; }
        tx.insert_read_session(&session, 0, Some((&old.family, generation)))?;
        tx.commit()
    }

    pub fn test_request_kind(&mut self, token: &str, kind: &str) -> Result<(), RuntimeError> {
        let digest = crate::identity::digest(token);
        let tx = self.transaction()?;
        match &tx {
            AnyTx::Sqlite(SqliteTx(inner)) => { inner.conn().execute("UPDATE _sessions SET kind=?1 WHERE token_digest=?2", [kind, &digest])?; }
            #[cfg(feature = "postgres")]
            AnyTx::Postgres(super::handles::PostgresTx(inner)) => { inner.execute("UPDATE _sessions SET kind=$1 WHERE token_digest=$2", &[&kind, &digest])?; }
        }
        tx.commit()
    }

    /// Same-token ordinary -> action corruption with a controllable claim.
    pub fn test_request_action_claim(&mut self, token: &str, now: i64, live: bool) -> Result<(), RuntimeError> {
        use crate::authority::AuthorityTransaction;
        let digest = crate::identity::digest(token);
        let tx = self.transaction()?;
        let principal = tx.session_authority_facts(&digest)?.sessions[0].principal.clone();
        let state = if live {"running"} else {"done"};
        let lease = now + 60_000;
        match &tx {
            AnyTx::Sqlite(SqliteTx(inner)) => {
                inner.conn().execute("UPDATE _sessions SET kind='action' WHERE token_digest=?1", [&digest])?;
                inner.conn().execute("INSERT INTO _requests(id,name,args,principal,at,state,claimed_by,session_digest,lease_until,deadline) VALUES ('lev-claim','test','{}',?1,?2,?3,'worker',?4,?5,?5) ON CONFLICT(id) DO UPDATE SET state=excluded.state", rusqlite::params![principal,now,state,digest,lease])?;
            }
            #[cfg(feature = "postgres")]
            AnyTx::Postgres(super::handles::PostgresTx(inner)) => {
                inner.execute("UPDATE _sessions SET kind='action' WHERE token_digest=$1", &[&digest])?;
                inner.execute("INSERT INTO _requests(id,name,args,principal,at,state,claimed_by,session_digest,lease_until,deadline) VALUES ('lev-claim','test','{}',$1,$2,$3,'worker',$4,$5,$5) ON CONFLICT(id) DO UPDATE SET state=excluded.state", &[&principal,&now,&state,&digest,&lease])?;
            }
        }
        tx.commit()
    }

    /// Advance revocation generation without deleting the session row.
    pub fn test_request_principal_generation(&mut self, token: &str) -> Result<(), RuntimeError> {
        use crate::authority::AuthorityTransaction;
        let tx = self.transaction()?;
        let facts = tx.session_authority_facts(&crate::identity::digest(token))?;
        let principal = &facts.sessions.first().expect("test credential remains stored").principal;
        let generation = facts.current_generation + 1;
        match &tx {
            AnyTx::Sqlite(SqliteTx(inner)) => { inner.conn().execute("INSERT INTO _principal_generations(principal,generation) VALUES (?1,?2) ON CONFLICT(principal) DO UPDATE SET generation=excluded.generation", rusqlite::params![principal,generation])?; }
            #[cfg(feature = "postgres")]
            AnyTx::Postgres(super::handles::PostgresTx(inner)) => { inner.execute("INSERT INTO _principal_generations(principal,generation) VALUES ($1,$2) ON CONFLICT(principal) DO UPDATE SET generation=excluded.generation", &[principal,&generation])?; }
        }
        assert_eq!(tx.session_authority_facts(&crate::identity::digest(token))?.sessions, facts.sessions,
            "generation-only fixture preserves session rows");
        tx.commit()
    }

    #[cfg(feature = "postgres")]
    pub fn test_request_owner_loss(&mut self) -> Result<(), RuntimeError> {
        let tx = self.transaction()?;
        match &tx {
            AnyTx::Postgres(super::handles::PostgresTx(inner)) => {
                inner.query("SELECT token FROM _owner WHERE singleton FOR UPDATE", &[])?;
                inner.execute("UPDATE _owner SET token=token+1 WHERE singleton", &[])?;
            }
            _ => return Err(RuntimeError::StoreUnsupported { family: "Postgres owner-token fixture" }),
        }
        tx.commit()
    }
}

#[cfg(test)]
impl AnyStore {
    pub(crate) fn test_with_sqlite<T>(&self, run: impl FnOnce(&crate::store::Store) -> T) -> T {
        match self { Self::Sqlite(SqliteStore(store)) => run(store), #[cfg(feature = "postgres")] Self::Postgres(_) => panic!("SQLite fixture") }
    }
    pub(crate) fn test_with_sqlite_mut<T>(&mut self, run: impl FnOnce(&mut crate::store::Store) -> T) -> T {
        match self { Self::Sqlite(SqliteStore(store)) => run(store), #[cfg(feature = "postgres")] Self::Postgres(_) => panic!("SQLite fixture") }
    }
}

// A typed fault hook keeps host tests from opening a new raw database lane.
impl AnyStore {
    pub fn test_staging_clock_write_failure(&self, fail: bool) -> Result<(), RuntimeError> {
        let sql = if fail {
            "CREATE TRIGGER refuse_clock BEFORE INSERT ON _meta WHEN NEW.key = 'dev:staging-clock' BEGIN SELECT RAISE(ABORT,'injected checkpoint failure'); END;"
        } else { "DROP TRIGGER refuse_clock" };
        match self {
            Self::Sqlite(SqliteStore(inner)) => { inner.test_support_conn().execute_batch(sql)?; Ok(()) },
            #[cfg(feature = "postgres")]
            Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "sqlite-fixture" }),
        }
    }
}
