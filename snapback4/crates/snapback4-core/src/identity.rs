//! Identity (H0, LLP 2000.000 §5.1): principals, sessions and credentials.
//! A development persona is `dev:<name>` and rides a loopback header; a
//! guest is `guest:<id>` minted by the server; a password account is
//! `user:<id>` behind an argon2id hash. A session is a random token whose
//! digest the store keeps; the token itself is never stored. `serve`
//! refuses personas; `dev` admits them.

use crate::error::RuntimeError;
use crate::authority::{self, AuthorityTransaction};
use crate::store::{Store, Tx};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

pub(super) const DAY_MS: i64 = 86_400_000;
/// Ordinary guest and password sessions expire after one week. Service and
/// application-owned sessions keep the explicit duration their issuer chose.
pub const SESSION_DAYS: i64 = 7;
mod read_sessions;
pub use read_sessions::{narrow_session, SessionScope, Capability};

pub const BOUND_SESSION_INTENT: &str = "identity-session/v1";

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Session {
    pub principal: String,
    pub kind: String,
    pub token: String,
    pub expires_at: i64,
    pub scope: SessionScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cap_expires_at: Option<i64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ServiceSample {
    pub now: i64,
    pub supervisor_revision: usize,
}

/// Resolve one live service seat and apply the host supervisor marker when
/// this is the supervised worker family. Manually provisioned seats retain
/// their ordinary live-session semantics.
// @ref LLP 3000.009#16 — the deployment-trusted worker credential is current only for its supervising revision.
pub(crate) fn current_service_tx(tx: &Tx<'_>, token: &str, sample: ServiceSample) -> Result<Option<String>, RuntimeError> {
    let token_digest = digest(token);
    let Some(session) = authority::live_session(tx, &token_digest, sample.now)? else { return Ok(None) };
    if session.scope != SessionScope::Full || session.kind != "service" || !is_service(&session.principal) { return Ok(None); }
    if !supervisor_current(tx, &session.family, sample.supervisor_revision)? { return Ok(None); }
    Ok(Some(session.principal))
}

// All authenticated doors use the same family fence, in their session snapshot.
// @ref LLP 3000.009#5.3 — failed retirement cannot preserve query authority.
pub(crate) fn supervisor_current(tx: &Tx<'_>, family: &str, revision: usize) -> Result<bool, RuntimeError> {
    let supervised_family = tx.meta("worker:session-family")?;
    if supervised_family.as_deref() == Some(family)
        && tx.meta("worker:session-revision")?.as_deref() != Some(revision.to_string().as_str())
    {
        return Ok(false);
    }
    // @ref LLP 3000.009#5.3 — each named worker has an independently revoked family.
    if let Some(stored_revision) = tx.meta(&format!("worker:family:{}", family))? {
        if stored_revision != revision.to_string() { return Ok(false); }
    }
    Ok(true)
}

pub(crate) fn resolve_session_tx(tx: &Tx<'_>, token_digest: &str, now: i64, revision: Option<usize>) -> Result<Option<Capability>, RuntimeError> {
    let Some(session) = authority::live_session(tx, token_digest, now)? else { return Ok(None); };
    if let Some(revision) = revision {
        if !supervisor_current(tx, &session.family, revision)? { return Ok(None); }
    }
    Ok(Some((session.principal, session.kind, session.scope)))
}

/// Host authentication, including ordinary queries and mutations.
pub fn resolve_supervised(store: &Store, token: &str, sample: ServiceSample) -> Result<Option<Capability>, RuntimeError> {
    let tx = store.authority_transaction()?;
    let resolved = resolve_session_tx(&tx, &digest(token), sample.now, Some(sample.supervisor_revision))?;
    tx.rollback()?;
    Ok(resolved)
}

pub fn resolve_read_only_supervised(store: &Store, token: &str, sample: ServiceSample, expected_store_id: Option<&str>) -> Result<Option<Capability>, RuntimeError> {
    store.resolve_session_snapshot(&digest(token), sample.now, expected_store_id, Some(sample.supervisor_revision))
}

/// Read-only wrapper for host doors that do not already own a writer
/// transaction. Strict work transitions call `current_service_tx` directly.
pub fn current_service(store: &Store, token: &str, sample: ServiceSample) -> Result<Option<String>, RuntimeError> {
    let tx = store.authority_transaction()?;
    let service = current_service_tx(&tx, token, sample)?;
    tx.rollback()?;
    Ok(service)
}

// @ref LLP 3000.009#5.1 — refresh preserves admission authority; revocation changes its generation.
pub(crate) fn initialize(conn: &Connection) -> Result<(), RuntimeError> {
    let columns: Vec<String> = conn.prepare("SELECT name FROM pragma_table_info('_sessions')")?
        .query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;
    if !columns.iter().any(|name| name == "family") {
        conn.execute_batch("ALTER TABLE _sessions ADD COLUMN family TEXT;")?;
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS _sessions_family ON _sessions(principal, family, expires_at);
        CREATE TABLE IF NOT EXISTS _principal_generations (principal TEXT PRIMARY KEY, generation INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS _session_mint_bindings (
            invocation TEXT NOT NULL, intent TEXT NOT NULL, input_digest TEXT NOT NULL,
            principal TEXT NOT NULL, kind TEXT NOT NULL, days INTEGER NOT NULL,
            expires_at INTEGER NOT NULL, family TEXT NOT NULL, principal_generation INTEGER NOT NULL,
            PRIMARY KEY(invocation, intent)
        ) WITHOUT ROWID;")?;
    read_sessions::initialize(conn)?;
    Ok(())
}

pub use crate::authority::Authority;

pub(crate) fn principal_generation(tx: &Tx<'_>, principal: &str) -> Result<i64, RuntimeError> {
    tx.principal_generation(principal)
}

/// Resolve the admitting credential inside the admission transaction.
pub(crate) fn authority(tx: &Tx<'_>, token_digest: &str, principal: &str, now: i64) -> Result<Authority, RuntimeError> {
    match authority::admission_authority(tx, token_digest, principal, now)? {
        authority::AdmissionStanding::SessionNotLive => Err(RuntimeError::Auth("the admitting session is no longer live".into())),
        authority::AdmissionStanding::AuthorityNotLive => Err(RuntimeError::Auth("the admitting session's authority is no longer live".into())),
        authority::AdmissionStanding::Live(binding) => Ok(binding),
    }
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

pub(crate) fn claim_token() -> Result<String, RuntimeError> { Ok(base64url(&random_bytes(32)?)) }

pub(crate) fn digest(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

fn new_session(principal: &str, kind: &str, now: i64, days: i64) -> Result<Session, RuntimeError> {
    Ok(Session {
        principal: principal.to_owned(),
        kind: kind.to_owned(),
        token: base64url(&random_bytes(32)?),
        expires_at: now + days.clamp(1, 3_650) * DAY_MS,
        scope: SessionScope::Full,
        cap_expires_at: None,
    })
}

fn insert_session(conn: &Connection, session: &Session, now: i64) -> Result<(), RuntimeError> {
    conn.execute("DELETE FROM _sessions WHERE expires_at <= ?1", [now])?;
    conn.execute(
        "INSERT OR IGNORE INTO _principals(id, kind, name, created_at) VALUES (?1, ?2, NULL, ?3)",
        params![session.principal, session.kind, now]
    )?;
    if session.scope == SessionScope::Read {
        return read_sessions::insert(conn, session, now, None);
    }
    conn.execute(
        "INSERT INTO _sessions(token_digest, principal, kind, created_at, expires_at, family) VALUES (?1, ?2, ?3, ?4, ?5, ?1)",
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

/// A claim's non-renewable viewer session. The queue inserts it in the
/// claim transaction and deletes it in the settlement transaction.
// @ref LLP 3000.007#9.2 — the worker borrows the request principal only for its lease.
pub(crate) fn action_session(conn: &Connection, principal: &str, now: i64, expires_at: i64) -> Result<Session, RuntimeError> {
    if principal == crate::SYSTEM_PRINCIPAL || !crate::value::identity_fits(principal) {
        return Err(RuntimeError::Auth("an action needs a signed-in principal".into()));
    }
    let mut session = new_session(principal, "action", now, 1)?;
    session.expires_at = expires_at;
    insert_session(conn, &session, now)?;
    Ok(session)
}

/// The principal behind a bearer token, if the session is live.
pub fn resolve(store: &Store, token: &str, now: i64) -> Result<Option<Capability>, RuntimeError> {
    let token_digest = digest(token);
    let resolved = resolve_digest(store, &token_digest, now)?;
    if resolved.is_none() { store.invalidate_expired_authority_session(&token_digest, now)?; }
    Ok(resolved)
}

/// Resolve authority from a detached reader without attempting expired-session
/// maintenance. Application catalog adoption does not revoke sessions; a store
/// identity change does. The serving writer retains custody of cleanup.
// @ref LLP 3000.017#3.3 — ephemeral-only poll wakes finish without the engine mutex.
pub fn resolve_read_only(store: &Store, token: &str, now: i64, expected_store_id: Option<&str>) -> Result<Option<Capability>, RuntimeError> {
    store.resolve_session_snapshot(&digest(token), now, expected_store_id, None)
}

fn resolve_digest(store: &Store, token_digest: &str, now: i64) -> Result<Option<Capability>, RuntimeError> {
    let tx = store.authority_transaction()?;
    let resolved = authority::live_session(&tx, token_digest, now)?.map(|session| (session.principal, session.kind, session.scope));
    tx.rollback()?;
    Ok(resolved)
}

pub fn close_session(store: &Store, token: &str) -> Result<(), RuntimeError> {
    store.conn().execute("DELETE FROM _sessions WHERE token_digest = ?1", params![digest(token)])?;
    store.conn().execute("DELETE FROM _read_sessions WHERE token_digest = ?1", params![digest(token)])?;
    Ok(())
}

/// Authenticate and close one live session family in the same writer
/// transaction. This is the HTTP logout boundary; callers that already own a
/// different authority boundary may continue to use `close_session`.
// @ref LLP 3000.009#5.1 — logout and lost-delivery replacement serialize on the session family.
pub fn logout_session(store: &mut Store, token: &str, now: impl FnOnce() -> i64) -> Result<(), RuntimeError> {
    let token_digest = digest(token);
    let tx = store.transaction()?;
    // The successful immediate transaction is the authority linearization
    // point: time spent waiting for its writer lock cannot keep a token live.
    let now = now();
    let Some(session) = authority::live_session(&tx, &token_digest, now)? else {
        return Err(RuntimeError::Auth("this session is not live; sign in again".into()));
    };
    tx.invalidate_family(&session.principal, &session.family)?;
    tx.commit()?;
    Ok(())
}

/// Replace one live bearer token atomically. The new token keeps the
/// session's originally selected lifetime and starts that lifetime anew.
pub fn rotate_session(
    store: &Store,
    old_token: &str,
    now: i64,
) -> Result<Option<Session>, RuntimeError> {
    // @ref LLP 3000.033#1.3 — read rotation has immutable authority and no foreign sweep.
    if old_token.starts_with("ro.") { return read_sessions::rotate(store, old_token, now); }
    let old_digest = digest(old_token);
    let found: Option<(String, String, i64, String)> = store.conn().query_row(
        "SELECT principal, kind, expires_at - created_at, COALESCE(family, token_digest) FROM _sessions WHERE token_digest = ?1 AND expires_at > ?2",
        params![old_digest, now],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).optional()?;
    let Some((principal, kind, lifetime_ms, family)) = found else {
        store.conn().execute(
            "DELETE FROM _sessions WHERE token_digest = ?1 AND expires_at <= ?2",
            params![old_digest, now],
        )?;
        return Ok(None);
    };
    if kind == "action" {
        return Err(RuntimeError::Auth("an action session lasts only for its claim and cannot be refreshed".into()));
    }
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
    tx.execute("UPDATE _sessions SET family = ?2 WHERE token_digest = ?1", params![digest(&session.token), family])?;
    tx.commit()?;
    Ok(Some(session))
}

/// A guest: a principal with no credential, minted on request.
pub fn guest(store: &Store, now: i64, entropy: &mut u64) -> Result<Session, RuntimeError> {
    guest_scoped(store, now, entropy, SessionScope::Full)
}
pub fn guest_scoped(store: &Store, now: i64, entropy: &mut u64, scope: SessionScope) -> Result<Session, RuntimeError> {
    let id = crate::ids::mint(now, entropy)?;
    let session = read_sessions::scoped_session(&format!("guest:{id}"), "guest", now, scope)?;
    let tx = store.conn().unchecked_transaction()?;
    insert_session(&tx, &session, now)?;
    tx.commit()?;
    Ok(session)
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
    // The minimum counts Unicode scalar values; the maximum still bounds UTF-8 bytes.
    if password.chars().count() < 8 {
        return Err(RuntimeError::Auth(
            "a password needs at least 8 characters".into(),
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
    finish_signup_scoped(store, prepared, now, entropy, SessionScope::Full)
}
pub fn finish_signup_scoped(store: &Store, prepared: PreparedSignup, now: i64, entropy: &mut u64, scope: SessionScope) -> Result<Session, RuntimeError> {
    let principal = format!("user:{}", crate::ids::mint(now, entropy)?);
    let session = read_sessions::scoped_session(&principal, "user", now, scope)?;
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
    finish_login_scoped(store, checked, now, SessionScope::Full)
}
pub fn finish_login_scoped(store: &Store, checked: Credential, now: i64, scope: SessionScope) -> Result<Session, RuntimeError> {
    let session = read_sessions::scoped_session(&checked.principal, "user", now, scope)?;
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
        assert_eq!(resolve(&store, &session.token, 2_000).unwrap(), Some((session.principal.clone(), "guest".into(), SessionScope::Full)));
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
            Some(("user:one".into(), "user".into(), SessionScope::Full))
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
    validate_custom_session(principal, kind)?;
    open_session_for(store, principal, kind, now, days)
}

pub fn validate_custom_session(principal: &str, kind: &str) -> Result<(), RuntimeError> {
    if principal == crate::SYSTEM_PRINCIPAL || RESERVED_PREFIXES.iter().any(|prefix| principal.starts_with(prefix)) {
        return Err(RuntimeError::Auth(format!("{principal} is a principal the engine mints itself; name the account in your own namespace (`member:42`)")));
    }
    if !crate::value::identity_fits(principal) || principal.len() > 128 {
        return Err(RuntimeError::Auth("a principal is 1–128 printable characters".into()));
    }
    if !valid_name(kind) {
        return Err(RuntimeError::Auth("a session kind is 1–64 letters, digits, _ or -".into()));
    }
    Ok(())
}

fn open_session_for(store: &Store, principal: &str, kind: &str, now: i64, days: i64) -> Result<Session, RuntimeError> {
    let session = new_session(principal, kind, now, days)?;
    insert_session(store.conn(), &session, now)?;
    Ok(session)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionMintBinding {
    pub invocation_id: String,
    pub intent: String,
    pub replace_lost_delivery: bool,
}

struct SessionMintRecord {
    input_digest: String,
    scope: String,
    principal: String,
    kind: String,
    days: i64,
    expires_at: i64,
    family: String,
    principal_generation: i64,
}

fn mint_binding_record(conn: &Connection, invocation: &str, intent: &str) -> Result<Option<SessionMintRecord>, RuntimeError> {
    Ok(conn.query_row(
        "SELECT input_digest, principal, kind, days, expires_at, family, principal_generation, scope FROM _session_mint_bindings WHERE invocation = ?1 AND intent = ?2",
        params![invocation, intent],
        |row| Ok(SessionMintRecord { scope: row.get(7)?, input_digest: row.get(0)?, principal: row.get(1)?, kind: row.get(2)?, days: row.get(3)?, expires_at: row.get(4)?, family: row.get(5)?, principal_generation: row.get(6)? }),
    ).optional()?)
}

fn session_mint_authority_error(message: &str) -> RuntimeError {
    RuntimeError::Structural { code: "E_ACTION_AUTHORITY", message: message.into() }
}

/// Mint once for one live action claim, or explicitly replace a response
/// whose delivery was lost. The binding and token family change together.
// @ref LLP 3000.009#5.1 — the identity handoff borrows the transaction-scoped service and action authorities.
pub fn bound_custom_session(
    store: &mut Store,
    service_token: &str,
    worker: &str,
    action_lease: &str,
    principal: &str,
    kind: &str,
    now: impl FnOnce() -> i64,
    days: i64,
    binding: &SessionMintBinding,
) -> Result<Session, RuntimeError> {
    validate_custom_session(principal, kind)?;
    if binding.intent != BOUND_SESSION_INTENT || binding.invocation_id.is_empty() || binding.invocation_id.len() > 128
        || !crate::value::identity_fits(&binding.invocation_id)
    {
        return Err(RuntimeError::Input("binding requires a valid invocationId and intent identity-session/v1".into()));
    }
    // @ref LLP 3000.033#1.3 — scope is bound separately; preserve legacy input digests for recoverable full mints.
    let input = serde_json::json!({ "principal": principal, "kind": kind, "days": days });
    let input_digest = crate::store::payload_digest(&input);
    let service_digest = digest(service_token);
    let tx = store.transaction()?;
    // Sample only after the immediate writer transaction is ours, beside
    // every service, claim, admitting and target-family authority check.
    let now = now();
    let service_is_live = authority::live_service_session(&tx, &service_digest, worker, now)?;
    if !service_is_live || !is_service(worker) {
        return Err(RuntimeError::Auth("the service credential is no longer live for this action claim".into()));
    }
    crate::engine::actions::held_claim_authority(&tx, &binding.invocation_id, worker, action_lease, now)?;
    let target_generation = principal_generation(&tx, principal)?;
    let previous = mint_binding_record(tx.conn(), &binding.invocation_id, &binding.intent)?;
    let session = match previous {
        None => {
            let session = new_session(principal, kind, now, days)?;
            insert_session(tx.conn(), &session, now)?;
            let family = digest(&session.token);
            tx.conn().execute(
                "INSERT INTO _session_mint_bindings(invocation, intent, input_digest, principal, kind, days, expires_at, family, principal_generation, scope) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'full')",
                params![binding.invocation_id, binding.intent, input_digest, principal, kind, days, session.expires_at, family, target_generation],
            )?;
            session
        }
        Some(previous) => {
            if previous.scope != "full" || previous.input_digest != input_digest || previous.principal != principal
                || previous.kind != kind || previous.days != days
            {
                return Err(RuntimeError::Input("this action intent already binds different session inputs".into()));
            }
            if !binding.replace_lost_delivery {
                return Err(RuntimeError::Input("this action intent already minted a session; delivery is ambiguous, so recover it explicitly".into()));
            }
            if previous.expires_at <= now || previous.principal_generation != target_generation {
                return Err(session_mint_authority_error("the bound session authority expired or was revoked and cannot be recreated"));
            }
            let family_is_live = tx.latest_live_family_member(principal, &previous.family, now)?.is_some();
            if !family_is_live {
                return Err(session_mint_authority_error("the bound session family is no longer live and cannot be recreated"));
            }
            tx.invalidate_family(principal, &previous.family)?;
            let mut session = new_session(principal, kind, now, days)?;
            session.expires_at = previous.expires_at;
            insert_session(tx.conn(), &session, now)?;
            tx.conn().execute(
                "UPDATE _sessions SET family = ?2 WHERE token_digest = ?1",
                params![digest(&session.token), previous.family],
            )?;
            session
        }
    };
    tx.commit()?;
    Ok(session)
}

/// End every session of a principal: an account lifecycle event (a lost
/// phone, a removed member) the application's service performs. Returns
/// how many sessions ended.
pub fn revoke_principal(store: &Store, principal: &str) -> Result<u64, RuntimeError> {
    let tx = store.conn().unchecked_transaction()?;
    tx.execute("INSERT INTO _principal_generations(principal, generation) VALUES (?1, 1) ON CONFLICT(principal) DO UPDATE SET generation = generation + 1", [principal])?;
    let removed = tx.execute("DELETE FROM _sessions WHERE principal = ?1", params![principal])? as u64
        + tx.execute("DELETE FROM _read_sessions WHERE principal = ?1", params![principal])? as u64;
    tx.commit()?;
    Ok(removed)
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
        assert_eq!(resolve(&store, &ranker.token, 2_000).unwrap(), Some(("service:ranker".into(), "service".into(), SessionScope::Full))
        );
        assert!(matches!(service_session(&store, "not a name", 1_000, 30), Err(RuntimeError::Auth(_))));
        let member = custom_session(&store, "member:42", "member", 1_000, 30).unwrap();
        assert!(!is_service(&member.principal));
        assert_eq!(resolve(&store, &member.token, 2_000).unwrap(), Some(("member:42".into(), "member".into(), SessionScope::Full)));
        assert!(matches!(custom_session(&store, "user:42", "member", 1_000, 30), Err(RuntimeError::Auth(_))), "the engine's namespaces are its own");
        assert!(matches!(custom_session(&store, "system", "member", 1_000, 30), Err(RuntimeError::Auth(_))));
        assert_eq!(custom_session(&store, "member:short", "member", 1_000, 0).unwrap().expires_at, 1_000 + DAY_MS);
        assert_eq!(custom_session(&store, "member:long", "member", 1_000, 3_651).unwrap().expires_at, 1_000 + 3_650 * DAY_MS);
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
