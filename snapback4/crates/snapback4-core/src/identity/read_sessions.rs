//! Read capabilities are kept outside the legacy full-session table.
use super::*;

pub use crate::authority::SessionScope;
pub type Capability = (String, String, SessionScope);

pub(super) fn scoped_session(principal: &str, kind: &str, now: i64, scope: SessionScope) -> Result<Session, RuntimeError> {
    let mut session = new_session(principal, kind, now, SESSION_DAYS)?;
    if scope == SessionScope::Read {
        if matches!(kind, "service" | "action") { return Err(RuntimeError::Auth("service and action sessions cannot be read sessions".into())); }
        session.scope = scope;
        session.token.insert_str(0, "ro.");
        session.cap_expires_at = Some(session.expires_at);
    }
    Ok(session)
}

// @ref LLP 3000.033#1.3 — lock, sample, authorize and mint in one writer
// transaction; a waiting narrow cannot escape revocation or parent expiry.
pub fn narrow_session(store: &mut Store, token: &str, sample: impl FnOnce() -> ServiceSample) -> Result<Session, RuntimeError> {
    let tx = store.transaction()?;
    let sample = sample();
    let parent = authority::live_session(&tx, &digest(token), sample.now)?
        .ok_or_else(|| RuntimeError::Auth("this session is not live; sign in again".into()))?;
    if parent.scope != SessionScope::Full || matches!(parent.kind.as_str(), "service" | "action")
        || tx.worker_session_family()?.as_deref() == Some(parent.family.as_str())
        || tx.worker_family_revision(&parent.family)?.is_some()
        || !supervisor_current(&tx, &parent.family, sample.supervisor_revision)? {
        return Err(RuntimeError::Auth("only an ordinary full session can narrow; service, action and supervised sessions cannot".into()));
    }
    let mut session = scoped_session(&parent.principal, &parent.kind, sample.now, SessionScope::Read)?;
    session.cap_expires_at = Some(parent.expires_at);
    session.expires_at = session.expires_at.min(parent.expires_at);
    tx.insert_read_session(&session, sample.now, None)?;
    tx.commit()?;
    Ok(session)
}

// @ref LLP 3000.033#1.3 — no lifetime floor, no cap movement, no sweep outside
// this family. A live at-cap credential may explicitly rotate without extending.
pub(super) fn rotate(store: &impl IdentityStore, token: &str, now: i64) -> Result<Option<Session>, RuntimeError> {
    store.rotate_read_session(&digest(token), now, |record| {
        let mut session = scoped_session(&record.principal, &record.kind, now, SessionScope::Read)?;
        session.cap_expires_at = Some(record.cap);
        session.expires_at = session.expires_at.min(record.cap);
        Ok(session)
    })
}
