use super::Tx;
use crate::{RuntimeError, authority::SessionScope, engine::session_clock::{ClockMint, ClockSession, SessionClockTransaction, PAGE}};
use rusqlite::params;

impl SessionClockTransaction for Tx<'_> {
    fn clock_sessions(&self, read: bool, after: Option<&str>) -> Result<Vec<ClockSession>, RuntimeError> {
        if read && !super::identity::present(self.conn())? { return Ok(Vec::new()); }
        let sql = if read {
            "SELECT token_digest,created_at FROM _read_sessions WHERE (?1 IS NULL OR token_digest > ?1) ORDER BY token_digest LIMIT ?2"
        } else {
            "SELECT token_digest,created_at FROM _sessions WHERE (?1 IS NULL OR token_digest > ?1) AND COALESCE(family,token_digest) NOT IN (SELECT value FROM _meta WHERE key = 'worker:session-family' UNION SELECT substr(key,15) FROM _meta WHERE key LIKE 'worker:family:%') ORDER BY token_digest LIMIT ?2"
        };
        Ok(self.conn().prepare_cached(sql)?.query_map(params![after, PAGE as i64], |r| Ok(ClockSession { digest: r.get(0)?, created_at: r.get(1)? }))?.collect::<Result<_, _>>()?)
    }
    fn set_clock_session(&self, digest: &str, scope: SessionScope, created_at: i64, expires_at: i64, cap: Option<i64>) -> Result<(), RuntimeError> {
        match scope {
            SessionScope::Full => { self.conn().execute("UPDATE _sessions SET created_at = ?2, expires_at = ?3 WHERE token_digest = ?1", params![digest,created_at,expires_at])?; }
            SessionScope::Read => { self.conn().execute("UPDATE _read_sessions SET created_at = ?2, expires_at = ?3, cap_expires_at = ?4 WHERE token_digest = ?1", params![digest,created_at,expires_at,cap])?; }
        }
        Ok(())
    }
    fn clock_mints(&self, after: Option<(&str, &str)>) -> Result<Vec<ClockMint>, RuntimeError> {
        let scope: bool = self.conn().query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('_session_mint_bindings') WHERE name = 'scope')", [], |r| r.get(0))?;
        let sql = if scope {
            "SELECT invocation,intent,principal,family,principal_generation,expires_at FROM _session_mint_bindings WHERE (?1 IS NULL OR (invocation,intent) > (?1,?2)) AND scope = 'full' ORDER BY invocation,intent LIMIT ?3"
        } else {
            "SELECT invocation,intent,principal,family,principal_generation,expires_at FROM _session_mint_bindings WHERE (?1 IS NULL OR (invocation,intent) > (?1,?2)) ORDER BY invocation,intent LIMIT ?3"
        };
        Ok(self.conn().prepare_cached(sql)?.query_map(params![after.map(|a| a.0),after.map(|a| a.1), PAGE as i64], |r| Ok(ClockMint { invocation: r.get(0)?,intent: r.get(1)?,principal: r.get(2)?,family: r.get(3)?,generation: r.get(4)?,expires_at: r.get(5)? }))?.collect::<Result<_, _>>()?)
    }
    fn set_clock_mint(&self, invocation: &str, intent: &str, expires_at: i64) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _session_mint_bindings SET expires_at = ?3 WHERE invocation = ?1 AND intent = ?2", params![invocation,intent,expires_at])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{engine::session_clock::{self, test_cases}, identity::{IdentityTransaction, Session, SessionScope}};
    fn connection(store: &crate::store_port::AnyStore) -> &rusqlite::Connection {
        match store { crate::store_port::AnyStore::Sqlite(store) => store.conn() }
    }
    fn seeded() -> super::super::Store {
        let mut store = super::super::Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        let read = Session { token: "ro.install".into(), principal: "install".into(),kind: "member".into(),expires_at: 1,cap_expires_at: Some(1),scope: SessionScope::Read };
        tx.insert_read_session(&read,0,None).unwrap();
        tx.conn().execute_batch("DELETE FROM _read_sessions").unwrap();
        tx.conn().execute_batch(test_cases::SEED).unwrap();
        tx.commit().unwrap();
        store
    }
    #[test]
    fn staging_clock_preserves_only_live_credentials() {
        let mut store = seeded();
        let tx = store.transaction().unwrap();
        test_cases::preserves_only_live(&tx);
        tx.commit().unwrap();
    }
    #[test]
    fn staging_clock_overflow_refuses_before_any_write() {
        let mut store = seeded();
        let tx = store.transaction().unwrap();
        test_cases::overflow_is_validated_before_writes(&tx);
        tx.rollback().unwrap();
    }
    #[test]
    fn staging_clock_preserves_every_page_and_keeps_read_schema_lazy() {
        let mut store = super::super::Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        for n in 0..(PAGE * 3 + 1) {
            tx.conn().execute("INSERT INTO _sessions VALUES (?1,'alice','member',0,200,?1)", [format!("token-{n:05}")]).unwrap();
        }
        session_clock::preserve(&tx,1_000,100).unwrap();
        let count:i64 = tx.conn().query_row("SELECT count(*) FROM _sessions WHERE expires_at=1200 AND created_at=1000",[],|r|r.get(0)).unwrap();
        assert_eq!(count,(PAGE * 3 + 1) as i64);
        assert!(!super::super::identity::present(tx.conn()).unwrap());
        tx.rollback().unwrap();
    }
    #[test]
    fn staging_clock_read_rotation_retains_the_shifted_absolute_cap() {
        let mut store = super::super::Store::memory().unwrap();
        let token = "ro.capped";
        let read = Session { token: token.into(), principal: "alice".into(), kind: "member".into(), expires_at: 200, cap_expires_at: Some(220), scope: SessionScope::Read };
        let tx = store.transaction().unwrap();
        tx.insert_read_session(&read,10,None).unwrap();
        session_clock::preserve(&tx,1_000,100).unwrap();
        tx.commit().unwrap();
        let store = crate::store_port::AnyStore::from(store);
        let rotated = crate::identity::rotate_session(&store,token,1_150).unwrap().unwrap();
        assert_eq!((rotated.expires_at,rotated.cap_expires_at),(1_220,Some(1_220)));
        assert!(crate::identity::rotate_session(&store,&rotated.token,1_220).unwrap().is_none());
    }
    #[test]
    fn staging_clock_write_failure_rolls_back_and_expire_mode_is_explicit() {
        let store = seeded();
        let mut engine = crate::Engine::new(store,crate::Schema::default(),[]).unwrap();
        connection(engine.store()).execute_batch("CREATE TRIGGER refuse_read BEFORE UPDATE ON _read_sessions BEGIN SELECT RAISE(ABORT,'injected'); END").unwrap();
        assert!(engine.advance_staging_clock_at(1000,100,true).is_err());
        assert_eq!(connection(engine.store()).query_row("SELECT expires_at FROM _sessions WHERE token_digest='full'",[],|r|r.get::<_,i64>(0)).unwrap(),200);
        assert_eq!(connection(engine.store()).query_row("SELECT expires_at FROM _session_mint_bindings WHERE intent='live'",[],|r|r.get::<_,i64>(0)).unwrap(),200);
        connection(engine.store()).execute_batch("DROP TRIGGER refuse_read").unwrap();
        engine.advance_staging_clock_at(1000,100,false).unwrap();
        assert_eq!(connection(engine.store()).query_row("SELECT expires_at FROM _sessions WHERE token_digest='full'",[],|r|r.get::<_,i64>(0)).unwrap(),200);
    }
}
