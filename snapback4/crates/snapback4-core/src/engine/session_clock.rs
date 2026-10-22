//! Staging clock preservation: one shared authority decision on both stores.
use crate::{RuntimeError, authority::{self, AuthorityTransaction, SessionScope}};
use super::{Engine, effects::OutboxTransaction};

pub(crate) const PAGE: usize = 128;

pub(crate) struct ClockSession {
    pub digest: String,
    pub created_at: i64,
}

pub(crate) struct ClockMint {
    pub invocation: String,
    pub intent: String,
    pub principal: String,
    pub family: String,
    pub generation: i64,
    pub expires_at: i64,
}

/// Bounded facts and exact timestamp writes, under the existing writer fence.
/// Worker-marked families are excluded from this enumeration: their timestamps
/// remain owned by the existing worker-lease primitive.
pub(crate) trait SessionClockTransaction: AuthorityTransaction {
    fn clock_sessions(&self, read: bool, after: Option<&str>) -> Result<Vec<ClockSession>, RuntimeError>;
    fn set_clock_session(&self, digest: &str, scope: SessionScope, created_at: i64, expires_at: i64, cap: Option<i64>) -> Result<(), RuntimeError>;
    fn clock_mints(&self, after: Option<(&str, &str)>) -> Result<Vec<ClockMint>, RuntimeError>;
    fn set_clock_mint(&self, invocation: &str, intent: &str, expires_at: i64) -> Result<(), RuntimeError>;
}

fn shifted(value: i64, delta: i64) -> Result<i64, RuntimeError> {
    value.checked_add(delta).ok_or_else(|| RuntimeError::Input("staging clock advance overflows a session timestamp; use a smaller advance".into()))
}

fn sessions(tx: &impl SessionClockTransaction, delta: i64, before: i64, apply: bool) -> Result<(), RuntimeError> {
    for read in [false, true] {
        let mut after = None;
        loop {
            let page = tx.clock_sessions(read, after.as_deref())?;
            if page.is_empty() { break; }
            for candidate in &page {
                let Some(session) = authority::live_session(tx, &candidate.digest, before)? else { continue; };
                // Delegated action credentials remain capped by their claim and
                // product deadline. The worker primitive owns their lease shift.
                if session.kind == "action" || (session.scope == SessionScope::Read) != read { continue; }
                let created_at = shifted(candidate.created_at, delta)?;
                let expires_at = shifted(session.expires_at, delta)?;
                let cap = session.cap_expires_at.map(|cap| shifted(cap, delta)).transpose()?;
                if apply { tx.set_clock_session(&candidate.digest, session.scope, created_at, expires_at, cap)?; }
            }
            after = page.last().map(|s| s.digest.clone());
        }
    }
    Ok(())
}

fn mints(tx: &impl SessionClockTransaction, delta: i64, before: i64, apply: bool) -> Result<(), RuntimeError> {
    let mut after: Option<(String, String)> = None;
    loop {
        let page = tx.clock_mints(after.as_ref().map(|(invocation, intent)| (invocation.as_str(), intent.as_str())))?;
        if page.is_empty() { break; }
        for mint in &page {
            if mint.expires_at <= before || authority::family_authority_expiry(tx, &mint.principal, &mint.family, mint.generation, before)?.is_none() { continue; }
            let expires_at = shifted(mint.expires_at, delta)?;
            if apply { tx.set_clock_mint(&mint.invocation, &mint.intent, expires_at)?; }
        }
        after = page.last().map(|m| (m.invocation.clone(), m.intent.clone()));
    }
    Ok(())
}

// @ref LLP 3000.000.000.001#11-wave-22-loop-repairs-dx6 — staging can preserve live credential lifetime while moving application time.
pub(crate) fn preserve(tx: &impl SessionClockTransaction, delta: i64, before: i64) -> Result<(), RuntimeError> {
    if delta < 0 { return Err(RuntimeError::Input("staging clock advance must be non-negative".into())); }
    // Validate the complete change with bounded pages before the first write.
    // The writer transaction gives both passes the same authority snapshot;
    // shifts never change token keys, scope, family or revocation generations.
    sessions(tx, delta, before, false)?;
    mints(tx, delta, before, false)?;
    mints(tx, delta, before, true)?;
    sessions(tx, delta, before, true)
}

impl Engine {
    /// Staging preserves credential lifetime by default; explicit expiry proofs
    /// pass false. Application deadlines and retry backoffs continue to advance.
    pub fn advance_staging_clock_at(&mut self, milliseconds: i64, before: i64, preserve_sessions: bool) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        if preserve_sessions { preserve(&tx, milliseconds, before)?; }
        tx.shift_worker_leases(milliseconds, before)?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod test_cases;
