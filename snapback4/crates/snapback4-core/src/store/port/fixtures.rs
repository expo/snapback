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
    /// Simulate a future W/R mode without exposing its adapter representation.
    pub(crate) fn test_read_index_published_prefix(&mut self) {
        self.test_postgres_handle_mut().store.get_mut().read_publication =
            crate::engine::postgres::store::ReadPublication::PublishedPrefix;
    }
    /// Corrupt/restore only a private fixture's owner projection, without a
    /// revision bump: missing owner evidence must force ordinary validation.
    pub(crate) fn test_owner_holder_projection(&mut self, holder: Option<&str>) -> Result<(), RuntimeError> {
        let store=self.test_postgres_handle_mut().store.get_mut();
        if let Some(holder)=holder {
            store.client.execute("UPDATE _owner SET holder=$1 WHERE singleton", &[&holder])?;
            store.client.batch_execute("ALTER TABLE _owner ALTER COLUMN holder SET NOT NULL")?;
        } else {
            store.client.batch_execute("ALTER TABLE _owner ALTER COLUMN holder DROP NOT NULL; UPDATE _owner SET holder=NULL WHERE singleton")?;
        }
        Ok(())
    }
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
        match self {
            Self::Postgres(super::handles::PostgresStore(handle)) => handle.test_request_owner_loss(),
            _ => Err(RuntimeError::StoreUnsupported { family: "Postgres owner-token fixture" }),
        }
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

/// A private-cluster witness can hold one real COMMIT while the next slot
/// resolves authority. The port exposes rendezvous/corruption operations only.
#[cfg(feature = "postgres")]
pub struct RequestPipelineHold {
    client: postgres::Client,
    key: i64,
    marker: bool,
}
#[cfg(feature = "postgres")]
impl RequestPipelineHold {
    /// Out-of-band witness observation, deliberately outside E's reader gate.
    pub fn counter_value(&mut self) -> Result<i64, RuntimeError> {
        let text: String = self.client.query_one("SELECT data FROM r WHERE t='counters' AND id='c'", &[])?.get(0);
        let value: crate::Value = serde_json::from_str(&text).map_err(|e|RuntimeError::Store(e.to_string()))?;
        Ok(value.field("n")?.as_int()?)
    }
    pub fn waiting(&mut self) -> Result<bool, RuntimeError> {
        Ok(self.client.query_one("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND classid::bigint=$1 AND objid::bigint=$2 AND objsubid=1)",
            &[&((self.key >> 32) & 0xffff_ffff), &(self.key & 0xffff_ffff)])?.get(0))
    }
    pub fn replace_store_id(&mut self, id: &str) -> Result<(), RuntimeError> {
        // Deliberate out-of-band corruption, while the first writer is held.
        self.client.execute("UPDATE _meta SET value=$1 WHERE key='store_id'", &[&id])?;
        Ok(())
    }
    pub fn release(&mut self) -> Result<(), RuntimeError> {
        self.client.query_one("SELECT pg_advisory_unlock($1)", &[&self.key])?;
        Ok(())
    }
}
#[cfg(feature = "postgres")]
impl Drop for RequestPipelineHold {
    fn drop(&mut self) {
        let _ = self.release();
        let _ = self.client.batch_execute(if self.marker {
            "DROP TRIGGER IF EXISTS lev_marker_hold ON _durable; DROP FUNCTION IF EXISTS lev_marker_hold()"
        } else { "DROP TRIGGER IF EXISTS lev_pipeline_hold ON _commits; DROP FUNCTION IF EXISTS lev_pipeline_hold()" });
    }
}
#[cfg(feature = "postgres")]
impl AnyStore {
    pub fn test_request_pipeline_hold(&mut self) -> Result<RequestPipelineHold, RuntimeError> {
        let Self::Postgres(super::handles::PostgresStore(handle)) = self else { panic!("private Postgres fixture") };
        let schema: String = handle.store.get_mut().client.query_one("SELECT current_schema()", &[])?.get(0);
        let mut client = postgres::Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private PG16"), postgres::NoTls)?;
        client.batch_execute(&format!("SET search_path=\"{}\",pg_catalog; SET statement_timeout='10s'; SET lock_timeout='2s'", schema.replace('"', "\"\"")))?;
        let head: i64 = client.query_one("SELECT seq FROM _head WHERE singleton", &[])?.get(0);
        let key = (crate::ids::seed() & i64::MAX as u64) as i64;
        client.query_one("SELECT pg_advisory_lock($1)", &[&key])?;
        client.batch_execute(&format!("CREATE FUNCTION lev_pipeline_hold() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.seq<={} THEN PERFORM pg_advisory_xact_lock({key}::bigint); END IF; RETURN NEW; END $f$; CREATE CONSTRAINT TRIGGER lev_pipeline_hold AFTER INSERT ON _commits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lev_pipeline_hold()", head+2))?;
        Ok(RequestPipelineHold { client, key, marker: false })
    }
}

#[cfg(feature = "postgres")]
impl AnyStore {
    /// Hold E's marker after the data COMMIT; optionally fail the marker.
    pub fn test_request_marker_hold(&mut self, fail: bool) -> Result<RequestPipelineHold, RuntimeError> {
        let Self::Postgres(super::handles::PostgresStore(handle)) = self else { panic!("private Postgres fixture") };
        let schema: String = handle.store.get_mut().client.query_one("SELECT current_schema()", &[])?.get(0);
        let mut client = postgres::Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private PG16"), postgres::NoTls)?;
        client.batch_execute(&format!("SET search_path=\"{}\",pg_catalog; SET statement_timeout='10s'; SET lock_timeout='2s'", schema.replace('"', "\"\"")))?;
        let key = (crate::ids::seed() & i64::MAX as u64) as i64;
        client.query_one("SELECT pg_advisory_lock($1)", &[&key])?;
        let error=if fail {"RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='marker failed after data COMMIT';"} else {""};
        client.batch_execute(&format!("CREATE FUNCTION lev_marker_hold() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_advisory_xact_lock({key}::bigint); {error} RETURN NEW; END $f$; CREATE TRIGGER lev_marker_hold BEFORE UPDATE ON _durable FOR EACH ROW EXECUTE FUNCTION lev_marker_hold()"))?;
        Ok(RequestPipelineHold {client,key,marker:true})
    }
}
