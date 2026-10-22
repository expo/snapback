use super::store::Tx;
use crate::{RuntimeError, authority::SessionScope, engine::session_clock::{ClockMint, ClockSession, SessionClockTransaction, PAGE}};

impl SessionClockTransaction for Tx<'_> {
    fn clock_sessions(&self, read: bool, after: Option<&str>) -> Result<Vec<ClockSession>, RuntimeError> {
        if read && !self.query("SELECT to_regclass('_read_sessions') IS NOT NULL", &[])?[0].get::<_,bool>(0) { return Ok(Vec::new()); }
        let sql = if read {
            "SELECT token_digest,created_at FROM _read_sessions WHERE ($1::text IS NULL OR token_digest > $1) ORDER BY token_digest LIMIT $2"
        } else {
            "SELECT token_digest,created_at FROM _sessions WHERE ($1::text IS NULL OR token_digest > $1) AND COALESCE(family,token_digest) NOT IN (SELECT value FROM _meta WHERE key = 'worker:session-family' UNION SELECT substr(key,15) FROM _meta WHERE key ILIKE 'worker:family:%' COLLATE \"C\") ORDER BY token_digest LIMIT $2"
        };
        Ok(self.query(sql, &[&after, &(PAGE as i64)])?.iter().map(|r| ClockSession { digest: r.get(0), created_at: r.get(1) }).collect())
    }
    fn set_clock_session(&self, digest: &str, scope: SessionScope, created_at: i64, expires_at: i64, cap: Option<i64>) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("preserve staging session")?;
        match scope {
            SessionScope::Full => { self.execute("UPDATE _sessions SET created_at = $2, expires_at = $3 WHERE token_digest = $1", &[&digest,&created_at,&expires_at])?; }
            SessionScope::Read => { self.execute("UPDATE _read_sessions SET created_at = $2, expires_at = $3, cap_expires_at = $4 WHERE token_digest = $1", &[&digest,&created_at,&expires_at,&cap])?; }
        }
        Ok(())
    }
    fn clock_mints(&self, after: Option<(&str, &str)>) -> Result<Vec<ClockMint>, RuntimeError> {
        Ok(self.query("SELECT invocation,intent,principal,family,principal_generation,expires_at FROM _session_mint_bindings WHERE ($1::text IS NULL OR (invocation,intent) > ($1,$2)) AND scope = 'full' ORDER BY invocation,intent LIMIT $3", &[&after.map(|a| a.0),&after.map(|a| a.1), &(PAGE as i64)])?.iter().map(|r| ClockMint { invocation: r.get(0),intent: r.get(1),principal: r.get(2),family: r.get(3),generation: r.get(4),expires_at: r.get(5) }).collect())
    }
    fn set_clock_mint(&self, invocation: &str, intent: &str, expires_at: i64) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("preserve staging mint binding")?;
        self.execute("UPDATE _session_mint_bindings SET expires_at = $3 WHERE invocation = $1 AND intent = $2", &[&invocation,&intent,&expires_at])?;
        Ok(())
    }
}
