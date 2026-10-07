//! Development-only evidence for refused sessions. Never an authority source.
use super::*;

// @ref LLP 3000.007#20.2 — dev remembers bounded retired-token digests; serve discloses no token standing.
pub fn configure(store: &Store, dev: bool) -> Result<(), RuntimeError> {
    let conn = store.conn();
    if !dev {
        conn.execute_batch("DROP TRIGGER IF EXISTS _dev_sessions_end;
            DROP TRIGGER IF EXISTS _dev_read_sessions_end;
            DROP TABLE IF EXISTS _dev_session_ends;")?;
        return Ok(());
    }
    conn.execute_batch("CREATE TABLE IF NOT EXISTS _dev_session_ends (
        n INTEGER PRIMARY KEY AUTOINCREMENT, digest TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL
    );")?;
    install(conn, "_sessions", "_dev_sessions_end", "OLD.expires_at")?;
    read_table(conn)
}

fn install(conn: &Connection, table: &str, trigger: &str, expiry: &str) -> Result<(), RuntimeError> {
    // All identifiers/expressions are module constants, never request inputs.
    conn.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS {trigger} AFTER DELETE ON {table} BEGIN
        INSERT OR REPLACE INTO _dev_session_ends(digest, expires_at) VALUES (OLD.token_digest, {expiry});
        DELETE FROM _dev_session_ends WHERE n <= (SELECT MAX(n) - 4096 FROM _dev_session_ends);
    END;"))?;
    Ok(())
}

pub(super) fn read_table(conn: &Connection) -> Result<(), RuntimeError> {
    if present(conn, "_dev_session_ends")? && present(conn, "_read_sessions")? {
        install(conn, "_read_sessions", "_dev_read_sessions_end", "MIN(OLD.expires_at, OLD.cap_expires_at)")?;
    }
    Ok(())
}

fn present(conn: &Connection, table: &str) -> Result<bool, RuntimeError> {
    Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)", [table], |r| r.get(0))?)
}

/// Called only after authority refused the token. Diagnostic failure must not
/// turn an authentication refusal into disclosure or a different authority result.
pub fn refused(store: &Store, token: &str, now: i64, dev: bool) -> crate::error::Refusal {
    let generic = "this session is not live; sign in again";
    let message = if dev { explanation(store, token, now).unwrap_or(generic) } else { generic };
    crate::error::Refusal::new("E_AUTH", "auth", message).guide("personas")
}

fn explanation(store: &Store, token: &str, now: i64) -> Result<&'static str, RuntimeError> {
    let conn = store.conn();
    let digest = digest(token);
    let mut expiry: Option<i64> = conn.query_row("SELECT expires_at FROM _sessions WHERE token_digest = ?1", [&digest], |r| r.get(0)).optional()?;
    if expiry.is_none() && present(conn, "_read_sessions")? {
        expiry = conn.query_row("SELECT MIN(expires_at, cap_expires_at) FROM _read_sessions WHERE token_digest = ?1", [&digest], |r| r.get(0)).optional()?;
    }
    if expiry.is_none() && present(conn, "_dev_session_ends")? {
        expiry = conn.query_row("SELECT expires_at FROM _dev_session_ends WHERE digest = ?1", [&digest], |r| r.get(0)).optional()?;
    }
    Ok(match expiry {
        Some(at) if at <= now => "this session expired on the server clock (a dev clock advance can expire sessions); sign in again",
        Some(_) => "this session was signed out, revoked, or replaced by refresh; sign in again and discard the saved token",
        None => "this session is unknown to this store (it may belong to a replaced store or another instance); sign in again and discard saved tokens from an earlier store",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retirement_evidence_is_bounded_digest_only_and_removed_for_serve() {
        let store = Store::memory().unwrap();
        configure(&store, true).unwrap();
        let first = open_session(&store, "guest:first", "guest", 1_000).unwrap();
        close_session(&store, &first.token).unwrap();
        assert!(refused(&store, &first.token, 2_000, true).message.contains("revoked"));
        assert!(refused(&store, &first.token, first.expires_at, true).message.contains("expired"));
        let serialized: String = store.conn().query_row("SELECT digest FROM _dev_session_ends", [], |r| r.get(0)).unwrap();
        assert_eq!(serialized, digest(&first.token));
        assert_ne!(serialized, first.token);
        for _ in 0..4096 {
            let session = open_session(&store, "guest:next", "guest", 1_000).unwrap();
            close_session(&store, &session.token).unwrap();
        }
        assert_eq!(store.conn().query_row("SELECT COUNT(*) FROM _dev_session_ends", [], |r| r.get::<_, i64>(0)).unwrap(), 4096);
        assert!(refused(&store, &first.token, 2_000, true).message.contains("unknown to this store"));
        configure(&store, false).unwrap();
        assert!(!present(store.conn(), "_dev_session_ends").unwrap());
        assert_eq!(refused(&store, &first.token, 2_000, false).message, "this session is not live; sign in again");
    }
}
