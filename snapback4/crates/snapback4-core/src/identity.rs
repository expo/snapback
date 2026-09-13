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
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

const DAY_MS: i64 = 86_400_000;
/// Ordinary guest and password sessions expire after one week. Service and
/// application-owned sessions keep the explicit duration their issuer chose.
pub const SESSION_DAYS: i64 = 7;

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

fn new_session(principal: &str, kind: &str, now: i64, days: i64) -> Result<Session, RuntimeError> {
    Ok(Session {
        principal: principal.to_owned(),
        kind: kind.to_owned(),
        token: base64url(&random_bytes(32)?),
        expires_at: now + days.clamp(1, 3_650) * DAY_MS,
    })
}

fn insert_session(conn: &Connection, session: &Session, now: i64) -> Result<(), RuntimeError> {
    conn.execute("DELETE FROM _sessions WHERE expires_at <= ?1", [now])?;
    conn.execute(
        "INSERT OR IGNORE INTO _principals(id, kind, name, created_at) VALUES (?1, ?2, NULL, ?3)",
        params![session.principal, session.kind, now]
    )?;
    conn.execute(
        "INSERT INTO _sessions(token_digest, principal, kind, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![digest(&session.token), session.principal, session.kind, now, session.expires_at],
    )?;
    Ok(())
}

/// Mint a session for a principal; returns the token exactly once.
pub fn open_session(store: &Store, principal: &str, kind: &str, now: i64,
) -> Result<Session, RuntimeError> {
    let session = new_session(principal, kind, now, SESSION_DAYS)?;
    insert_session(store.conn(), &session, now)?;
    Ok(session)
}

/// The principal behind a bearer token, if the session is live.
pub fn resolve(store: &Store, token: &str, now: i64) -> Result<Option<(String, String)>, RuntimeError> {
    let token_digest = digest(token);
    let resolved = store
        .conn()
        .prepare_cached("SELECT principal, kind FROM _sessions WHERE token_digest = ?1 AND expires_at > ?2")?
        .query_row(params![token_digest, now], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .optional()?;
    if resolved.is_none() {
        store.conn().execute(
            "DELETE FROM _sessions WHERE token_digest = ?1 AND expires_at <= ?2",
            params![token_digest, now],
        )?;
    }
    Ok(resolved)
}

pub fn close_session(store: &Store, token: &str) -> Result<(), RuntimeError> {
    store.conn().execute("DELETE FROM _sessions WHERE token_digest = ?1", params![digest(token)])?;
    Ok(())
}

/// Replace one live bearer token atomically. The new token keeps the
/// session's originally selected lifetime and starts that lifetime anew.
pub fn rotate_session(
    store: &Store,
    old_token: &str,
    now: i64,
) -> Result<Option<Session>, RuntimeError> {
    let old_digest = digest(old_token);
    let found: Option<(String, String, i64)> = store.conn().query_row(
        "SELECT principal, kind, expires_at - created_at FROM _sessions WHERE token_digest = ?1 AND expires_at > ?2",
        params![old_digest, now],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional()?;
    let Some((principal, kind, lifetime_ms)) = found else {
        store.conn().execute(
            "DELETE FROM _sessions WHERE token_digest = ?1 AND expires_at <= ?2",
            params![old_digest, now],
        )?;
        return Ok(None);
    };
    let days = lifetime_ms.div_euclid(DAY_MS).clamp(1, 3_650);
    let session = new_session(&principal, &kind, now, days)?;
    let tx = store.conn().unchecked_transaction()?;
    tx.execute("DELETE FROM _sessions WHERE expires_at <= ?1", [now])?;
    let removed = tx.execute(
        "DELETE FROM _sessions WHERE token_digest = ?1 AND expires_at > ?2",
        params![old_digest, now],
    )?;
    if removed == 0 {
        tx.commit()?;
        return Ok(None);
    }
    insert_session(&tx, &session, now)?;
    tx.commit()?;
    Ok(Some(session))
}

/// A guest: a principal with no credential, minted on request.
pub fn guest(store: &Store, now: i64, entropy: &mut u64) -> Result<Session, RuntimeError> {
    let id = crate::ids::mint(now, entropy)?;
    open_session(store, &format!("guest:{id}"), "guest", now)
}

fn hash_password(password: &str) -> Result<String, RuntimeError> {
    let salt = SaltString::encode_b64(&random_bytes(16)?).map_err(|e| RuntimeError::Store(e.to_string()))?;
    Ok(Argon2::default().hash_password(password.as_bytes(), &salt).map_err(|e| RuntimeError::Store(e.to_string()))?.to_string())
}

/// Password input is bounded before any KDF or store lookup.
pub const PASSWORD_MAX_BYTES: usize = 1024;
pub fn normalized_email(email: &str) -> String {
    email.trim().to_ascii_lowercase()
}
pub fn password_bound(password: &str) -> Result<(), RuntimeError> {
    if password.len() > PASSWORD_MAX_BYTES {
        return Err(RuntimeError::Auth(
            "a password is at most 1024 UTF-8 bytes".into()
        ));
    }
    Ok(())
}

pub struct PreparedSignup {
    email: String,
    hash: String,
}
#[derive(Clone)]
pub struct Credential {
    principal: String,
    hash: String,
}

// @ref LLP 3000#7-decisions-during-execution — KDF work has no engine or database guard
pub fn prepare_signup(email: &str, password: &str) -> Result<PreparedSignup, RuntimeError> {
    let email = normalized_email(email);
    if !email.contains('@') || email.len() > 254 {
        return Err(RuntimeError::Auth("an email address is needed".into()));
    }
    password_bound(password)?;
    if password.len() < 8 {
        return Err(RuntimeError::Auth(
            "a password needs at least 8 UTF-8 bytes".into(),
        ));
    }
    Ok(PreparedSignup {
        email,
        hash: hash_password(password)?,
    })
}

/// The uniqueness check, account and initial session commit atomically.
pub fn finish_signup(
    store: &Store,
    prepared: PreparedSignup,
    now: i64,
    entropy: &mut u64,
) -> Result<Session, RuntimeError> {
    let principal = format!("user:{}", crate::ids::mint(now, entropy)?);
    let session = new_session(&principal, "user", now, SESSION_DAYS)?;
    let tx = store.conn().unchecked_transaction()?;
    let taken: Option<String> = tx
        .query_row("SELECT principal FROM _credentials WHERE email = ?1",
            [&prepared.email], |row| row.get(0),
        ).optional()?;
    if taken.is_some() {
        return Err(RuntimeError::Auth("that email already has an account; sign in instead".into()));
    }
    tx.execute("INSERT INTO _principals(id, kind, name, created_at) VALUES (?1, 'user', ?2, ?3)", params![principal, prepared.email, now],
    )?;
    tx.execute("INSERT INTO _credentials(principal, email, hash) VALUES (?1, ?2, ?3)", params![principal, prepared.email, prepared.hash],
    )?;
    insert_session(&tx, &session, now)?;
    tx.commit()?;
    Ok(session)
}

pub fn signup(
    store: &Store,
    email: &str,
    password: &str,
    now: i64,
    entropy: &mut u64,
) -> Result<Session, RuntimeError> {
    finish_signup(store, prepare_signup(email, password)?, now, entropy)
}

pub fn credential(store: &Store, email: &str) -> Result<Option<Credential>, RuntimeError> {
    Ok(store
        .conn()
        .query_row(
            "SELECT principal, hash FROM _credentials WHERE email = ?1",
            [normalized_email(email)],
            |row| {
                Ok(Credential {
                    principal: row.get(0)?,
                    hash: row.get(1)?,
                })
            },
        )
        .optional()?)
}

/// A syntactically valid default-cost Argon2id hash; its deliberately random
/// target is never an account. Unknown emails pay the same verification work.
const DUMMY_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$c25hcGJhY2s0LWR1bW15IQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
pub fn verify_password(found: Option<&Credential>, password: &str) -> Result<(), RuntimeError> {
    password_bound(password)?;
    let parsed = PasswordHash::new(found.map_or(DUMMY_HASH, |c| c.hash.as_str()))
        .map_err(|e| RuntimeError::Store(e.to_string()))?;
    let verified = Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok();
    if found.is_none() || !verified {
        return Err(bad_login());
    }
    Ok(())
}
fn bad_login() -> RuntimeError {
    RuntimeError::Auth("no account matches that email and password".into())
}

/// Recheck the credential after verifying outside the database guard.
pub fn finish_login(store: &Store, checked: Credential, now: i64) -> Result<Session, RuntimeError> {
    let session = new_session(&checked.principal, "user", now, SESSION_DAYS)?;
    let tx = store.conn().unchecked_transaction()?;
    let current: Option<String> = tx
        .query_row(
            "SELECT hash FROM _credentials WHERE principal = ?1",
            [&checked.principal],
            |row| row.get(0),
        )
        .optional()?;
    if current.as_deref() != Some(checked.hash.as_str()) {
        return Err(bad_login());
    }
    insert_session(&tx, &session, now)?;
    tx.commit()?;
    Ok(session)
}
pub fn login(store: &Store, email: &str, password: &str, now: i64,
) -> Result<Session, RuntimeError> {
    password_bound(password)?;
    let found = credential(store, email)?;
    verify_password(found.as_ref(), password)?;
    finish_login(store, found.expect("verified an account"), now)
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
        assert_eq!(session.expires_at, 1_000 + SESSION_DAYS * DAY_MS);
        assert_eq!(resolve(&store, &session.token, 2_000).unwrap(), Some((session.principal.clone(), "guest".into())));
        assert_eq!(resolve(&store, "nope", 2_000).unwrap(), None);
        close_session(&store, &session.token).unwrap();
        assert_eq!(resolve(&store, &session.token, 2_000).unwrap(), None);
    }

    #[test]
    fn rotation_and_revoke_all_end_every_old_bearer() {
        let store = Store::memory().unwrap();
        let original = open_session(&store, "user:one", "user", 1_000).unwrap();
        let rotated = rotate_session(&store, &original.token, 2_000)
            .unwrap()
            .unwrap();
        assert_eq!(rotated.expires_at, 2_000 + SESSION_DAYS * DAY_MS);
        assert_eq!(resolve(&store, &original.token, 2_001).unwrap(), None);
        assert_eq!(
            resolve(&store, &rotated.token, 2_001).unwrap(),
            Some(("user:one".into(), "user".into()))
        );
        assert!(
            rotate_session(&store, &original.token, 2_001)
                .unwrap()
                .is_none()
        );

        let second = open_session(&store, "user:one", "user", 2_002).unwrap();
        assert_eq!(revoke_principal(&store, "user:one").unwrap(), 2);
        assert_eq!(resolve(&store, &rotated.token, 2_003).unwrap(), None);
        assert_eq!(resolve(&store, &second.token, 2_003).unwrap(), None);

        let expired = open_session(&store, "user:expired", "user", 0).unwrap();
        assert_eq!(
            resolve(&store, &expired.token, (SESSION_DAYS + 1) * DAY_MS).unwrap(),
            None
        );
        let kept: i64 = store
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM _sessions WHERE token_digest = ?1",
                [digest(&expired.token)],
                |row| row.get(0)
            )
            .unwrap();
        assert_eq!(kept, 0, "an observed expired session is pruned");
    }

    #[test]
    fn passwords_hash_and_verify() {
        let store = Store::memory().unwrap();
        let mut entropy = 9;
        let session = signup(&store, "Ann@Example.com", "correct horse", 1_000, &mut entropy,
        ).unwrap();
        assert!(session.principal.starts_with("user:"));
        assert!(matches!(signup(&store, "ann@example.com", "another one", 1_000, &mut entropy), Err(RuntimeError::Auth(_))));
        assert!(login(&store, "ann@example.com", "correct horse", 2_000).is_ok());
        assert!(matches!(login(&store, "ann@example.com", "wrong", 2_000), Err(RuntimeError::Auth(_))));
        assert!(matches!(login(&store, "nobody@example.com", "wrong", 2_000), Err(RuntimeError::Auth(_))
        ));
    }

    #[test]
    fn password_bounds_and_credential_recheck() {
        let oversized = "x".repeat(PASSWORD_MAX_BYTES + 1);
        assert!(prepare_signup("a@example.com", &oversized).is_err());
        assert!(verify_password(None, &oversized).is_err());
        let store = Store::memory().unwrap();
        signup(&store, "a@example.com", "correct horse", 1, &mut 1).unwrap();
        let found = credential(&store, "a@example.com").unwrap().unwrap();
        verify_password(Some(&found), "correct horse").unwrap();
        store
            .conn()
            .execute("DELETE FROM _credentials", [])
            .unwrap();
        assert!(matches!(
            finish_login(&store, found, 2),
            Err(RuntimeError::Auth(_))
        ));
        let dummy = PasswordHash::new(DUMMY_HASH).unwrap();
        assert_eq!(dummy.algorithm.as_str(), "argon2id");
        assert_eq!(dummy.params.get_decimal("m"), Some(19456));
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
    let session = new_session(principal, kind, now, days)?;
    insert_session(store.conn(), &session, now)?;
    Ok(session)
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
        assert_eq!(resolve(&store, &ranker.token, 2_000).unwrap(), Some(("service:ranker".into(), "service".into()))
        );
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
        assert!(
            resolve(&store, &ranker.token, 1_000 + 31 * 86_400_000)
                .unwrap()
                .is_none(),
            "a service token expires when told to"
        );
    }
}
