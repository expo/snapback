//! Development-only evidence for refused sessions. Never an authority source.
use super::*;


// @ref LLP 3000.007#20.2 — only trusted dev requests get read-only explanations; absent records remain ambiguous.
/// Called only after authority refused the token. Diagnostic failure must not
/// turn an authentication refusal into disclosure or a different authority result.
pub fn refused(store: &AnyStore, token: &str, now: i64, trusted_dev: bool) -> crate::error::Refusal {
    refused_in(store, token, now, trusted_dev)
}

pub(super) fn refused_in(store: &impl IdentityStore, token: &str, now: i64, trusted_dev: bool) -> crate::error::Refusal {
    let generic = "this session is not live; sign in again";
    let message = if trusted_dev { explanation(store, token, now).unwrap_or(generic) } else { generic };
    crate::error::Refusal::new("E_AUTH", "auth", message).guide(if trusted_dev { "wire" } else { "personas" })
}

fn explanation(store: &impl IdentityStore, token: &str, now: i64) -> Result<&'static str, RuntimeError> {
    let expiry = store.identity_session_expiry(&digest(token))?;
    Ok(match expiry {
        Some(at) if at <= now => "this session expired on the server clock (a dev clock advance can expire sessions); sign in again",
        Some(_) => "this session was signed out, revoked, or replaced by refresh; sign in again and discard the saved token",
        None => "this session is unknown to this store: it may come from an earlier or replaced store or another instance, or have expired or been signed out (including before this server started); sign in again and discard saved tokens from an earlier store. Raw HTTP on dev uses x-snapback-persona: alice; serve uses Authorization: Bearer <token>; snapback4 guide wire shows the literal envelopes",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explanations_never_change_store_schema_or_data_and_absent_records_are_ambiguous() {
        let store = AnyStore::memory().unwrap();
        let session = open_session(&store, "guest:first", "guest", 1_000).unwrap();
        close_session(&store, &session.token).unwrap();
        let expired = open_session(&store, "guest:expired", "guest", 1_000).unwrap();
        let schema = || (match &store { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).conn().prepare("SELECT sql FROM sqlite_schema ORDER BY name").unwrap()
            .query_map([], |r| r.get::<_, Option<String>>(0)).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
        let before = schema();
        let changes = (match &store { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).conn().total_changes();
        for trusted in [true, false] {
            for token in ["unknown", &session.token, &expired.token] {
                let message = refused(&store, token, expired.expires_at, trusted).message;
                if !trusted { assert_eq!(message, "this session is not live; sign in again"); }
                else if token == expired.token { assert!(message.contains("expired on the server clock")); }
                else { assert!(message.contains("unknown to this store") && message.contains("before this server started")); }
            }
        }
        assert_eq!((match &store { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).conn().total_changes(), changes);
        assert_eq!(schema(), before);
    }
}
