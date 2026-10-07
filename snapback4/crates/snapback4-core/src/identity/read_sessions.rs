//! Read capabilities are kept outside the legacy full-session table.
use super::*;

pub use crate::authority::SessionScope;
pub type Capability = (String, String, SessionScope);

// @ref LLP 3000.033#1.3 — opening a legacy store must not install auth schema
// before a later adoption can refuse. Only minting creates this table.
pub(crate) fn present(conn: &Connection) -> Result<bool, RuntimeError> {
    Ok(conn.prepare_cached("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '_read_sessions')")?.query_row([], |r| r.get(0))?)
}

// @ref LLP 3000.033#1.3 — old executables cannot resolve read tokens; the captured
// generation also prevents resurrection after logoutAll during a downgrade.
fn initialize(conn: &Connection) -> Result<(), RuntimeError> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS _read_sessions (
        token_digest TEXT PRIMARY KEY, principal TEXT NOT NULL, kind TEXT NOT NULL,
        family TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        cap_expires_at INTEGER NOT NULL, principal_generation INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS _read_sessions_family ON _read_sessions(principal, family, expires_at);")?;
    diagnostics::read_table(conn)?;
    Ok(())
}

pub(super) fn initialize_binding_scope(conn: &Connection) -> Result<(), RuntimeError> {
    let has_scope: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('_session_mint_bindings') WHERE name = 'scope')", [], |r| r.get(0))?;
    if !has_scope { conn.execute_batch("ALTER TABLE _session_mint_bindings ADD COLUMN scope TEXT NOT NULL DEFAULT 'full';")?; }
    Ok(())
}

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

pub(super) fn insert(conn: &Connection, session: &Session, now: i64, family: Option<(&str, i64)>) -> Result<(), RuntimeError> {
    initialize(conn)?;
    let digest = digest(&session.token);
    let generation: i64 = match family { Some((_, generation)) => generation, None => conn.query_row("SELECT generation FROM _principal_generations WHERE principal = ?1", [&session.principal], |r| r.get(0)).optional()?.unwrap_or(0) };
    conn.execute("INSERT INTO _read_sessions(token_digest, principal, kind, family, created_at, expires_at, cap_expires_at, principal_generation) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![digest, session.principal, session.kind, family.map_or(digest.as_str(), |f| f.0), now, session.expires_at, session.cap_expires_at.expect("read cap"), generation])?;
    Ok(())
}

// @ref LLP 3000.033#1.3 — lock, sample, authorize and mint in one writer
// transaction; a waiting narrow cannot escape revocation or parent expiry.
pub fn narrow_session(store: &mut Store, token: &str, sample: impl FnOnce() -> ServiceSample) -> Result<Session, RuntimeError> {
    let tx = store.transaction()?;
    let sample = sample();
    let parent = authority::live_session(&tx, &digest(token), sample.now)?
        .ok_or_else(|| RuntimeError::Auth("this session is not live; sign in again".into()))?;
    if parent.scope != SessionScope::Full || matches!(parent.kind.as_str(), "service" | "action")
        || tx.meta("worker:session-family")?.as_deref() == Some(parent.family.as_str())
        || tx.meta(&format!("worker:family:{}", parent.family))?.is_some()
        || !supervisor_current(&tx, &parent.family, sample.supervisor_revision)? {
        return Err(RuntimeError::Auth("only an ordinary full session can narrow; service, action and supervised sessions cannot".into()));
    }
    let mut session = scoped_session(&parent.principal, &parent.kind, sample.now, SessionScope::Read)?;
    session.cap_expires_at = Some(parent.expires_at);
    session.expires_at = session.expires_at.min(parent.expires_at);
    insert(tx.conn(), &session, sample.now, None)?;
    tx.commit()?;
    Ok(session)
}

// @ref LLP 3000.033#1.3 — no lifetime floor, no cap movement, no sweep outside
// this family. A live at-cap credential may explicitly rotate without extending.
pub(super) fn rotate(store: &Store, token: &str, now: i64) -> Result<Option<Session>, RuntimeError> {
    let tx = rusqlite::Transaction::new_unchecked(store.conn(), rusqlite::TransactionBehavior::Immediate)?;
    if !present(&tx)? { return Ok(None); }
    let found: Option<(String, String, String, i64, i64)> = tx.query_row(
        "SELECT principal, kind, family, cap_expires_at, principal_generation FROM _read_sessions r
         WHERE token_digest = ?1 AND expires_at > ?2 AND cap_expires_at > ?2
         AND principal_generation >= COALESCE((SELECT generation FROM _principal_generations WHERE principal = r.principal), 0)",
        params![digest(token), now], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).optional()?;
    let Some((principal, kind, family, cap, generation)) = found else { return Ok(None); };
    let mut session = scoped_session(&principal, &kind, now, SessionScope::Read)?;
    session.cap_expires_at = Some(cap);
    session.expires_at = session.expires_at.min(cap);
    tx.execute("DELETE FROM _read_sessions WHERE family = ?1 AND principal = ?2", params![family, principal])?;
    insert(&tx, &session, now, Some((&family, generation)))?;
    tx.commit()?;
    Ok(Some(session))
}
