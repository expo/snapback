//! A bounded storage projection; authority policy remains in the shared resolver.
// @ref LLP 3000.009.001.000.001#32-one-statement-fetches-a-guest-sessions-authority-facts — SQL projects facts; shared Rust policy resolves ordinary kinds and the complete fallback.
use crate::{RuntimeError, authority::{self, AuthorityTransaction, SessionRecord}, metadata::MetadataReader};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct SessionFacts {
    /// Internal revision token; SQLite uses the owned process commit stream.
    pub revision: Option<i64>,
    // At most one row per session table. Preserve the strict duplicate refusal.
    pub head: u64,
    pub sessions: Vec<SessionRecord>,
    pub current_generation: i64,
    pub worker_family: Option<String>,
    pub worker_revision: Option<String>,
    pub family_revision: Option<String>,
    pub store_generation: Option<String>,
    pub store_id: Option<String>,
    pub backend_generation: Option<i64>,
    pub schema_hash: Option<String>,
    pub activation_hash: Option<String>,
    pub device_generation: Option<String>,
}

pub(crate) fn ordinary(facts: &SessionFacts) -> bool {
    // @ref LLP 3000.009.001.000.001#6 — RT3c: account/OIDC users and service
    // seats use the same fixed facts, including supervised worker revisions.
    // Action claims and unnamed kinds retain the complete snapshot resolver.
    facts.sessions.iter().all(|session| matches!(session.kind.as_str(), "guest" | "user" | "member" | "account" | "oidc" | "service"))
}

/// One statement is a complete authority snapshot for these ordinary kinds.
/// Callers must use a transaction and the complete resolver for every other kind.
pub(crate) fn projected(facts: SessionFacts, now: i64, revision: Option<usize>) -> Result<Option<SessionRecord>, RuntimeError> {
    debug_assert!(ordinary(&facts));
    let Some(session) = crate::store_port::single_session(facts.sessions)? else { return Ok(None); };
    if !authority::session_record_live(&session, now, |_| Ok(facts.current_generation))? { return Ok(None); }
    if let Some(revision) = revision {
        if !super::supervisor_current_with(&session.family, revision, facts.worker_family,
            || Ok(facts.worker_revision), || Ok(facts.family_revision))? { return Ok(None); }
    }
    Ok(Some(session))
}

pub(crate) fn resolve(
    tx: &(impl AuthorityTransaction + MetadataReader),
    facts: SessionFacts, now: i64, revision: Option<usize>,
) -> Result<Option<SessionRecord>, RuntimeError> {
    if ordinary(&facts) { return projected(facts, now, revision); }
    let Some(session) = authority::live_session_record(tx, crate::store_port::single_session(facts.sessions)?, now, |principal| tx.principal_generation(principal))? else { return Ok(None); };
    if let Some(revision) = revision {
        if !super::supervisor_current(tx, &session.family, revision)? { return Ok(None); }
    }
    Ok(Some(session))
}

#[cfg(test)]
pub(crate) mod tests;
