//! A bounded storage projection; authority policy remains in the shared resolver.
// @ref LLP 3000.009.001.000.001#32-one-statement-fetches-a-guest-sessions-authority-facts — no policy in SQL and no authority boundary changes.
use crate::{RuntimeError, authority::{self, AuthorityTransaction, SessionRecord}, metadata::MetadataReader};

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct SessionFacts {
    // At most one row per session table. Preserve the strict duplicate refusal.
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

pub(crate) fn resolve(
    tx: &(impl AuthorityTransaction + MetadataReader),
    mut facts: SessionFacts, now: i64, revision: Option<usize>,
) -> Result<Option<SessionRecord>, RuntimeError> {
    if facts.sessions.len() > 1 {
        return Err(RuntimeError::Sql(rusqlite::Error::QueryReturnedMoreThanOneRow));
    }
    let session = facts.sessions.pop();
    // These ordinary kinds need only the projected facts. Other kinds retain
    // every shared resolver read, notably action claims and delegation walks.
    let ordinary = session.as_ref().is_some_and(|s| matches!(s.kind.as_str(), "guest" | "user" | "member"));
    let Some(session) = authority::live_session_record(tx, session, now, |principal| {
        if ordinary { Ok(facts.current_generation) } else { tx.principal_generation(principal) }
    })? else { return Ok(None); };
    if let Some(revision) = revision {
        let current = if ordinary {
            super::supervisor_current_with(&session.family, revision, facts.worker_family,
                || Ok(facts.worker_revision), || Ok(facts.family_revision))?
        } else { super::supervisor_current(tx, &session.family, revision)? };
        if !current { return Ok(None); }
    }
    Ok(Some(session))
}

#[cfg(test)]
pub(crate) mod tests;
