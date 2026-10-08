//! Development-only evidence for refused sessions. Never an authority source.
use super::*;

fn present(conn: &Connection, table: &str) -> Result<bool, RuntimeError> {
    Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)", [table], |r| r.get(0))?)
}

// @ref LLP 3000.007#20.2 — only trusted dev requests get read-only explanations; absent records remain ambiguous.
/// Called only after authority refused the token. Diagnostic failure must not
/// turn an authentication refusal into disclosure or a different authority result.
pub fn refused(store: &Store, token: &str, now: i64, trusted_dev: bool) -> crate::error::Refusal {
    let generic = "this session is not live; sign in again";
    let message = if trusted_dev { explanation(store, token, now).unwrap_or(generic) } else { generic };
    crate::error::Refusal::new("E_AUTH", "auth", message).guide("personas")
}

fn explanation(store: &Store, token: &str, now: i64) -> Result<&'static str, RuntimeError> {
    let conn = store.conn();
    let digest = digest(token);
    let mut expiry: Option<i64> = conn.query_row("SELECT expires_at FROM _sessions WHERE token_digest = ?1", [&digest], |r| r.get(0)).optional()?;
    if expiry.is_none() && present(conn, "_read_sessions")? {
        expiry = conn.query_row("SELECT MIN(expires_at, cap_expires_at) FROM _read_sessions WHERE token_digest = ?1", [&digest], |r| r.get(0)).optional()?;
    }
    Ok(match expiry {
        Some(at) if at <= now => "this session expired on the server clock (a dev clock advance can expire sessions); sign in again",
        Some(_) => "this session was signed out, revoked, or replaced by refresh; sign in again and discard the saved token",
        None => "this session is unknown to this store: it may come from an earlier or replaced store or another instance, or have expired or been signed out (including before this server started); sign in again and discard saved tokens from an earlier store",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explanations_never_change_store_schema_or_data_and_absent_records_are_ambiguous() {
        let store = Store::memory().unwrap();
        let session = open_session(&store, "guest:first", "guest", 1_000).unwrap();
        close_session(&store, &session.token).unwrap();
        let expired = open_session(&store, "guest:expired", "guest", 1_000).unwrap();
        let schema = || store.conn().prepare("SELECT sql FROM sqlite_schema ORDER BY name").unwrap()
            .query_map([], |r| r.get::<_, Option<String>>(0)).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
        let before = schema();
        let changes = store.conn().total_changes();
        for trusted in [true, false] {
            for token in ["unknown", &session.token, &expired.token] {
                let message = refused(&store, token, expired.expires_at, trusted).message;
                if !trusted { assert_eq!(message, "this session is not live; sign in again"); }
                else if token == expired.token { assert!(message.contains("expired on the server clock")); }
                else { assert!(message.contains("unknown to this store") && message.contains("before this server started")); }
            }
        }
        assert_eq!(store.conn().total_changes(), changes);
        assert_eq!(schema(), before);
    }
}
