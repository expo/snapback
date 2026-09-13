//! Identity (H0, LLP 2000.000 §5.1): principals, sessions and credentials.
//! A development persona is `dev:<name>` and rides a loopback header; a
//! guest is `guest:<id>` minted by the server; a password account is
//! `user:<id>` behind an argon2id hash. A session is a random token whose
//! digest the store keeps; the token itself is never stored. `serve`
//! refuses personas; `dev` admits them.

use crate::error::RuntimeError;
use crate::store::Store;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rusqlite::{OptionalExtension, params};
use sha2::{Digest, Sha256};

pub const SESSION_DAYS: i64 = 90;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Session {
    pub principal: String,
    pub kind: String,
    pub token: String,
    pub expires_at: i64,
}

fn random_bytes(n: usize) -> Result<Vec<u8>, RuntimeError> {
    let mut bytes = vec![0u8; n];
    getrandom::fill(&mut bytes).map_err(|e| RuntimeError::Store(format!("entropy: {e}")))?;
    Ok(bytes)
}

fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let value = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        out.push(ALPHABET[((value >> 18) & 63) as usize] as char);
        out.push(ALPHABET[((value >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[((value >> 6) & 63) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[(value & 63) as usize] as char);
        }
    }
    out
}

fn digest(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

/// Mint a session for a principal; returns the token exactly once.
pub fn open_session(store: &Store, principal: &str, kind: &str, now: i64) -> Result<Session, RuntimeError> {
    let token = base64url(&random_bytes(32)?);
    let expires_at = now + SESSION_DAYS * 86_400_000;
    store.conn().execute("INSERT OR IGNORE INTO _principals(id, kind, name, created_at) VALUES (?1, ?2, NULL, ?3)", params![principal, kind, now])?;
    store.conn().execute("INSERT INTO _sessions(token_digest, principal, kind, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![digest(&token), principal, kind, now, expires_at])?;
    Ok(Session { principal: principal.to_owned(), kind: kind.to_owned(), token, expires_at })
}

/// The principal behind a bearer token, if the session is live.
pub fn resolve(store: &Store, token: &str, now: i64) -> Result<Option<(String, String)>, RuntimeError> {
    Ok(store
        .conn()
        .prepare_cached("SELECT principal, kind FROM _sessions WHERE token_digest = ?1 AND expires_at > ?2")?
        .query_row(params![digest(token), now], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .optional()?)
}

pub fn close_session(store: &Store, token: &str) -> Result<(), RuntimeError> {
    store.conn().execute("DELETE FROM _sessions WHERE token_digest = ?1", params![digest(token)])?;
    Ok(())
}

/// A guest: a principal with no credential, minted on request.
pub fn guest(store: &Store, now: i64, entropy: &mut u64) -> Result<Session, RuntimeError> {
    let id = crate::ids::mint(now, entropy);
    open_session(store, &format!("guest:{id}"), "guest", now)
}

fn hash_password(password: &str) -> Result<String, RuntimeError> {
    let salt = SaltString::encode_b64(&random_bytes(16)?).map_err(|e| RuntimeError::Store(e.to_string()))?;
    Ok(Argon2::default().hash_password(password.as_bytes(), &salt).map_err(|e| RuntimeError::Store(e.to_string()))?.to_string())
}

/// Create a password account. Refuses a taken email with `E_AUTH`.
pub fn signup(store: &Store, email: &str, password: &str, now: i64, entropy: &mut u64) -> Result<Session, RuntimeError> {
    let email = email.trim().to_ascii_lowercase();
    if !email.contains('@') || email.len() > 254 {
        return Err(RuntimeError::Auth("an email address is needed".into()));
    }
    if password.len() < 8 {
        return Err(RuntimeError::Auth("a password needs at least 8 characters".into()));
    }
    let taken: Option<String> = store.conn().query_row("SELECT principal FROM _credentials WHERE email = ?1", params![email], |row| row.get(0)).optional()?;
    if taken.is_some() {
        return Err(RuntimeError::Auth("that email already has an account; sign in instead".into()));
    }
    let principal = format!("user:{}", crate::ids::mint(now, entropy));
    let hash = hash_password(password)?;
    store.conn().execute("INSERT INTO _principals(id, kind, name, created_at) VALUES (?1, 'user', ?2, ?3)", params![principal, email, now])?;
    store.conn().execute("INSERT INTO _credentials(principal, email, hash) VALUES (?1, ?2, ?3)", params![principal, email, hash])?;
    open_session(store, &principal, "user", now)
}

/// Sign in with a password. One refusal for a wrong email or password.
pub fn login(store: &Store, email: &str, password: &str, now: i64) -> Result<Session, RuntimeError> {
    let email = email.trim().to_ascii_lowercase();
    let found: Option<(String, String)> = store.conn().query_row("SELECT principal, hash FROM _credentials WHERE email = ?1", params![email], |row| Ok((row.get(0)?, row.get(1)?))).optional()?;
    let Some((principal, hash)) = found else {
        return Err(RuntimeError::Auth("no account matches that email and password".into()));
    };
    let parsed = PasswordHash::new(&hash).map_err(|e| RuntimeError::Store(e.to_string()))?;
    if Argon2::default().verify_password(password.as_bytes(), &parsed).is_err() {
        return Err(RuntimeError::Auth("no account matches that email and password".into()));
    }
    open_session(store, &principal, "user", now)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sessions_resolve_until_closed() {
        let store = Store::memory().unwrap();
        let mut entropy = 7;
        let session = guest(&store, 1_000, &mut entropy).unwrap();
        assert!(session.principal.starts_with("guest:"));
        assert_eq!(resolve(&store, &session.token, 2_000).unwrap(), Some((session.principal.clone(), "guest".into())));
        assert_eq!(resolve(&store, "nope", 2_000).unwrap(), None);
        close_session(&store, &session.token).unwrap();
        assert_eq!(resolve(&store, &session.token, 2_000).unwrap(), None);
    }

    #[test]
    fn passwords_hash_and_verify() {
        let store = Store::memory().unwrap();
        let mut entropy = 9;
        let session = signup(&store, "Ann@Example.com", "correct horse", 1_000, &mut entropy).unwrap();
        assert!(session.principal.starts_with("user:"));
        assert!(matches!(signup(&store, "ann@example.com", "another one", 1_000, &mut entropy), Err(RuntimeError::Auth(_))));
        assert!(login(&store, "ann@example.com", "correct horse", 2_000).is_ok());
        assert!(matches!(login(&store, "ann@example.com", "wrong", 2_000), Err(RuntimeError::Auth(_))));
        assert!(matches!(login(&store, "nobody@example.com", "wrong", 2_000), Err(RuntimeError::Auth(_))));
    }
}

/// The namespace of a worker's principal: `service:<name>`. A service is
/// admitted by a rule like any principal (`insert <- viewer =
/// 'service:ranker'`), claims effects, and mints sessions for the accounts
/// an application authenticates itself.
pub const SERVICE_PREFIX: &str = "service:";

pub fn is_service(principal: &str) -> bool {
    principal.starts_with(SERVICE_PREFIX)
}

/// The namespaces the engine mints itself; an application's own accounts
/// live outside them.
const RESERVED_PREFIXES: [&str; 4] = ["dev:", "guest:", "user:", SERVICE_PREFIX];

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// A session for the service `name`, `days` long: what `snapback4 token
/// --service name` prints once and a worker keeps.
pub fn service_session(store: &Store, name: &str, now: i64, days: i64) -> Result<Session, RuntimeError> {
    if !valid_name(name) {
        return Err(RuntimeError::Auth("a service name is 1–64 letters, digits, _ or -".into()));
    }
    open_session_for(store, &format!("{SERVICE_PREFIX}{name}"), "service", now, days)
}

/// A session for a principal the application authenticated itself (a phone
/// number it verified, an account in its own directory): the application's
/// service mints it and hands the token to that user's device, which then
/// talks to the server directly. The principal is the application's own
/// name for the account (`member:42`), outside the engine's namespaces.
pub fn custom_session(store: &Store, principal: &str, kind: &str, now: i64, days: i64) -> Result<Session, RuntimeError> {
    if principal == crate::SYSTEM_PRINCIPAL || RESERVED_PREFIXES.iter().any(|prefix| principal.starts_with(prefix)) {
        return Err(RuntimeError::Auth(format!("{principal} is a principal the engine mints itself; name the account in your own namespace (`member:42`)")));
    }
    if !crate::value::identity_fits(principal) || principal.len() > 128 {
        return Err(RuntimeError::Auth("a principal is 1–128 printable characters".into()));
    }
    if !valid_name(kind) {
        return Err(RuntimeError::Auth("a session kind is 1–64 letters, digits, _ or -".into()));
    }
    open_session_for(store, principal, kind, now, days)
}

fn open_session_for(store: &Store, principal: &str, kind: &str, now: i64, days: i64) -> Result<Session, RuntimeError> {
    let days = days.clamp(1, 3_650);
    let token = base64url(&random_bytes(32)?);
    let expires_at = now + days * 86_400_000;
    store.conn().execute("INSERT OR IGNORE INTO _principals(id, kind, name, created_at) VALUES (?1, ?2, NULL, ?3)", params![principal, kind, now])?;
    store.conn().execute("INSERT INTO _sessions(token_digest, principal, kind, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![digest(&token), principal, kind, now, expires_at])?;
    Ok(Session { principal: principal.to_owned(), kind: kind.to_owned(), token, expires_at })
}

/// End every session of a principal: an account lifecycle event (a lost
/// phone, a removed member) the application's service performs. Returns
/// how many sessions ended.
pub fn revoke_principal(store: &Store, principal: &str) -> Result<u64, RuntimeError> {
    Ok(store.conn().execute("DELETE FROM _sessions WHERE principal = ?1", params![principal])? as u64)
}

#[cfg(test)]
mod service_tests {
    use super::*;

    #[test]
    fn services_and_custom_accounts_have_sessions_of_their_own() {
        let store = Store::memory().unwrap();
        let ranker = service_session(&store, "ranker", 1_000, 30).unwrap();
        assert_eq!((ranker.principal.as_str(), ranker.kind.as_str()), ("service:ranker", "service"));
        assert!(is_service(&ranker.principal));
        assert_eq!(resolve(&store, &ranker.token, 2_000).unwrap(), Some(("service:ranker".into(), "service".into())));
        assert!(resolve(&store, &ranker.token, 1_000 + 31 * 86_400_000).unwrap().is_none(), "a service token expires when told to");
        assert!(matches!(service_session(&store, "not a name", 1_000, 30), Err(RuntimeError::Auth(_))));
        let member = custom_session(&store, "member:42", "member", 1_000, 30).unwrap();
        assert!(!is_service(&member.principal));
        assert_eq!(resolve(&store, &member.token, 2_000).unwrap(), Some(("member:42".into(), "member".into())));
        assert!(matches!(custom_session(&store, "user:42", "member", 1_000, 30), Err(RuntimeError::Auth(_))), "the engine's namespaces are its own");
        assert!(matches!(custom_session(&store, "system", "member", 1_000, 30), Err(RuntimeError::Auth(_))));
        let second = custom_session(&store, "member:42", "member", 1_500, 30).unwrap();
        assert_eq!(revoke_principal(&store, "member:42").unwrap(), 2);
        assert!(resolve(&store, &second.token, 2_000).unwrap().is_none());
        assert!(resolve(&store, &ranker.token, 2_000).unwrap().is_some(), "another principal's sessions stand");
    }
}
