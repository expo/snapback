//! Persistent principals, credentials, and sessions.
// @ref LLP 1001#6-identity-identityrs — authentication is always backed by stored principals.

use crate::principal::PrincipalId;
use crate::registry::Runtime;
use argon2::Argon2;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::sync::LazyLock;
use thiserror::Error;

const SESSION_MILLIS: i64 = 30 * 24 * 60 * 60 * 1_000;
// @ref LLP 1001#6-identity-identityrs — system is one
// reserved principal value, not a principal-kind rule term. The adjacent
// core-owned IR contract is also consumed directly by the TypeScript compiler.
pub const IR_CONTRACT_JSON: &str = include_str!("../ir-contract.json");
pub static SYSTEM_PRINCIPAL_ID: LazyLock<String> = LazyLock::new(|| {
    serde_json::from_str::<serde_json::Value>(IR_CONTRACT_JSON)
        .expect("snapback2-core IR contract must be valid JSON")
        .get("systemPrincipalId")
        .and_then(serde_json::Value::as_str)
        .expect("snapback2-core IR contract must name systemPrincipalId")
        .to_owned()
});
// @ref LLP 1001#6-identity-identityrs — bearer bytes leave identity only once;
// persistence and lookup use a domain-separated digest plus a durable epoch.
const SESSION_TOKEN_DOMAIN: &[u8] = b"snapback2-session-token-v1\0";
const LOGIN_GLOBAL_BUCKET_DOMAIN: &[u8] = b"snapback2-login-throttle-global-v1\0";
const LOGIN_EMAIL_BUCKET_DOMAIN: &[u8] = b"snapback2-login-throttle-email-v1\0";
// Deliberately small fixed v0 limits keep the password-guess fence testable
// without app configuration. Both buckets reset at the exact window boundary.
const LOGIN_THROTTLE_WINDOW_MILLIS: i64 = 60_000;
const LOGIN_GLOBAL_ATTEMPTS: u32 = 8;
const LOGIN_EMAIL_ATTEMPTS: u32 = 3;
pub static CURRENT_VALUE_MODEL_VERSION: LazyLock<String> = LazyLock::new(|| {
    serde_json::from_str::<serde_json::Value>(IR_CONTRACT_JSON)
        .expect("snapback2-core IR contract must be valid JSON")
        .get("valueModelVersion")
        .and_then(serde_json::Value::as_str)
        .expect("snapback2-core IR contract must name valueModelVersion")
        .to_owned()
});
const DUMMY_PASSWORD_HASH: &str = concat!(
    "$argon2id$v=19$m=19456,t=2,p=1$c25hcGJhY2syLWR1bW15$",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
);

#[cfg(debug_assertions)]
std::thread_local! {
    static PASSWORD_VERIFICATION_CALLS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

/// Debug-only test hook for proving that login paths perform password verification.
#[cfg(debug_assertions)]
#[doc(hidden)]
pub fn password_verification_calls() -> u64 {
    PASSWORD_VERIFICATION_CALLS.with(|calls| calls.get())
}

/// Debug-only test hook for the fixed durable login-throttle policy.
#[cfg(debug_assertions)]
#[doc(hidden)]
pub fn login_throttle_policy() -> (u32, u32, i64) {
    (
        LOGIN_GLOBAL_ATTEMPTS,
        LOGIN_EMAIL_ATTEMPTS,
        LOGIN_THROTTLE_WINDOW_MILLIS,
    )
}

/// An authenticated application actor. Construction rejects the reserved
/// system identity, so ordinary callers cannot acquire system authority by
/// choosing a viewer string or principal kind.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Actor {
    id: String,
    kind: String,
}

impl Actor {
    pub fn new(id: impl Into<String>, kind: impl Into<String>) -> Result<Self, ActorError> {
        let id = id.into();
        let kind = kind.into();
        if id == SYSTEM_PRINCIPAL_ID.as_str() || kind == SYSTEM_PRINCIPAL_ID.as_str() {
            return Err(ActorError::ReservedSystem);
        }
        if id.is_empty() {
            return Err(ActorError::Empty);
        }
        Ok(Self { id, kind })
    }

    pub fn user(id: impl Into<String>) -> Result<Self, ActorError> {
        Self::new(id, "user")
    }

    pub fn persona(name: impl AsRef<str>) -> Result<Self, ActorError> {
        Self::new(format!("dev:{}", name.as_ref()), "persona")
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn kind(&self) -> &str {
        &self.kind
    }
}

impl TryFrom<&Principal> for Actor {
    type Error = ActorError;

    fn try_from(principal: &Principal) -> Result<Self, Self::Error> {
        Self::new(principal.id.clone(), principal.kind.clone())
    }
}

#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum ActorError {
    #[error("E_AUTH_RESERVED: the system principal is internal and cannot be an application actor")]
    ReservedSystem,
    #[error("E_AUTH_INVALID: actor id must not be empty")]
    Empty,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Principal {
    pub id: PrincipalId,
    pub kind: String,
    pub name: Option<String>,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub token: String,
    pub principal: Principal,
    pub auth_epoch: u64,
    pub expires_at: i64,
}

impl fmt::Debug for Session {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Session")
            .field("token", &"[REDACTED]")
            .field("principal", &self.principal)
            .field("auth_epoch", &self.auth_epoch)
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAuthority {
    pub principal: Principal,
    pub auth_epoch: u64,
    pub expires_at: i64,
}

#[derive(Debug, Error)]
pub enum IdentityError {
    #[error("E_AUTH_EMAIL_TAKEN: email is already registered")]
    EmailTaken,
    #[error("E_AUTH_PASSWORD_WEAK: password must contain at least 8 characters")]
    PasswordWeak,
    #[error("E_AUTH_INVALID: invalid email or password")]
    Invalid,
    #[error("E_AUTH_GUESTS_OFF: guest authentication is disabled")]
    GuestsOff,
    #[error("E_AUTH_SESSION: session is missing or expired")]
    Session,
    #[error("E_AUTH_STORE: {0}")]
    Store(#[from] rusqlite::Error),
    #[error("E_AUTH_CRYPTO: {0}")]
    Crypto(String),
}

impl Runtime {
    pub fn signup(
        &mut self,
        email: &str,
        password: &str,
        now: i64,
    ) -> Result<Session, IdentityError> {
        if password.chars().count() < 8 {
            return Err(IdentityError::PasswordWeak);
        }
        if !self.generation.schema().auth.password {
            return Err(IdentityError::Invalid);
        }
        let email = normalize_email(email);
        let exists: bool = self.engine.store().conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM _credentials WHERE email = ?1)",
            [&email],
            |row| row.get(0),
        )?;
        if exists {
            return Err(IdentityError::EmailTaken);
        }
        let principal = Principal {
            id: PrincipalId::new(format!("user:{}", random_base64url(16)?)),
            kind: "user".to_owned(),
            name: Some(email.clone()),
        };
        debug_assert!(
            self.engine.store().conn.is_autocommit(),
            "password KDF must run outside SQLite transactions"
        );
        let hash = hash_password(password)?;
        let transaction = self.engine.store_mut().conn.transaction()?;
        transaction.execute(
            "INSERT INTO _principals(id, kind, name, created_at) VALUES (?1, 'user', ?2, ?3)",
            params![principal.id.as_str(), email, now],
        )?;
        transaction.execute(
            "INSERT INTO _credentials(principal, email, hash) VALUES (?1, ?2, ?3)",
            params![principal.id.as_str(), email, hash],
        )?;
        let session = create_session(&transaction, principal, "auth", now, expires(now))?;
        transaction.commit()?;
        Ok(session)
    }

    pub fn login(
        &mut self,
        email: &str,
        password: &str,
        now: i64,
    ) -> Result<Session, IdentityError> {
        if !self.generation.schema().auth.password {
            return Err(IdentityError::Invalid);
        }
        let email = normalize_email(email);
        if !consume_login_attempt(&self.engine.store().conn, &email, now)? {
            return Err(IdentityError::Invalid);
        }
        let credential: Option<(String, String)> = self
            .engine
            .store()
            .conn
            .query_row(
                "SELECT principal, hash FROM _credentials WHERE email = ?1",
                [&email],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let hash = credential
            .as_ref()
            .map_or(DUMMY_PASSWORD_HASH, |(_, hash)| hash.as_str());
        let parsed = PasswordHash::new(hash).unwrap_or_else(|_| {
            PasswordHash::new(DUMMY_PASSWORD_HASH).expect("dummy password hash must be valid")
        });
        debug_assert!(
            self.engine.store().conn.is_autocommit(),
            "password KDF must run outside SQLite transactions"
        );
        let password_valid = verify_password(password, &parsed);
        let Some((principal_id, _)) = credential else {
            return Err(IdentityError::Invalid);
        };
        if !password_valid {
            return Err(IdentityError::Invalid);
        }
        let principal = load_principal(&self.engine.store().conn, &principal_id)?
            .ok_or(IdentityError::Invalid)?;
        let transaction = self.engine.store_mut().conn.transaction()?;
        let session = create_session(&transaction, principal, "auth", now, expires(now))?;
        transaction.commit()?;
        Ok(session)
    }

    pub fn guest(&mut self, now: i64) -> Result<Session, IdentityError> {
        if !self.generation.schema().auth.guests {
            return Err(IdentityError::GuestsOff);
        }
        let principal = Principal {
            id: PrincipalId::new(format!("guest:{}", random_base64url(16)?)),
            kind: "guest".to_owned(),
            name: None,
        };
        let transaction = self.engine.store_mut().conn.transaction()?;
        transaction.execute(
            "INSERT INTO _principals(id, kind, name, created_at) VALUES (?1, 'guest', NULL, ?2)",
            params![principal.id.as_str(), now],
        )?;
        let session = create_session(&transaction, principal, "guest", now, expires(now))?;
        transaction.commit()?;
        Ok(session)
    }

    pub fn ensure_persona(&mut self, name: &str, now: i64) -> Result<Principal, IdentityError> {
        if name.is_empty() {
            return Err(IdentityError::Invalid);
        }
        let principal = Principal {
            id: PrincipalId::new(format!("dev:{name}")),
            kind: "persona".to_owned(),
            name: Some(name.to_owned()),
        };
        self.engine.store().conn.execute(
            "INSERT OR IGNORE INTO _principals(id, kind, name, created_at)
             VALUES (?1, 'persona', ?2, ?3)",
            params![principal.id.as_str(), name, now],
        )?;
        Ok(principal)
    }

    pub fn persona(&mut self, name: &str, now: i64) -> Result<Session, IdentityError> {
        let principal = self.ensure_persona(name, now)?;
        let transaction = self.engine.store_mut().conn.transaction()?;
        let session = create_session(&transaction, principal, "persona", now, expires(now))?;
        transaction.commit()?;
        Ok(session)
    }

    pub fn authenticate(&self, token: &str, now: i64) -> Result<SessionAuthority, IdentityError> {
        let digest = session_token_digest(token);
        let stored =
            load_session(&self.engine.store().conn, &digest)?.ok_or(IdentityError::Session)?;
        if now >= stored.expires_at {
            delete_session(&self.engine.store().conn, stored.auth_epoch, &digest)?;
            return Err(IdentityError::Session);
        }
        if now < stored.created_at {
            return Err(IdentityError::Session);
        }
        stored.authority(&self.engine.store().conn)
    }

    pub fn logout(&mut self, token: &str, now: i64) -> Result<SessionAuthority, IdentityError> {
        let digest = session_token_digest(token);
        let stored =
            load_session(&self.engine.store().conn, &digest)?.ok_or(IdentityError::Session)?;
        if now >= stored.expires_at {
            delete_session(&self.engine.store().conn, stored.auth_epoch, &digest)?;
            return Err(IdentityError::Session);
        }
        if now < stored.created_at {
            return Err(IdentityError::Session);
        }
        let authority = stored.authority(&self.engine.store().conn)?;
        if delete_session(&self.engine.store().conn, stored.auth_epoch, &digest)? != 1 {
            return Err(IdentityError::Session);
        }
        Ok(authority)
    }

    pub fn expire_sessions(&mut self, now: i64) -> Result<Vec<SessionAuthority>, IdentityError> {
        let transaction = self.engine.store_mut().conn.transaction()?;
        let expired = {
            let mut statement = transaction.prepare(
                "SELECT s.auth_epoch, s.expires_at, p.id, p.kind, p.name
                 FROM _sessions AS s
                 JOIN _principals AS p ON p.id = s.principal
                 WHERE s.expires_at <= ?1
                 ORDER BY s.auth_epoch",
            )?;
            statement
                .query_map([now], |row| {
                    let epoch = row.get::<_, i64>(0)?;
                    Ok(SessionAuthority {
                        principal: Principal {
                            id: PrincipalId::new(row.get::<_, String>(2)?),
                            kind: row.get(3)?,
                            name: row.get(4)?,
                        },
                        auth_epoch: positive_epoch(epoch)?,
                        expires_at: row.get(1)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        transaction.execute("DELETE FROM _sessions WHERE expires_at <= ?1", [now])?;
        transaction.commit()?;
        Ok(expired)
    }

    pub fn next_session_expiry(&self) -> Result<Option<i64>, IdentityError> {
        self.engine
            .store()
            .conn
            .query_row("SELECT MIN(expires_at) FROM _sessions", [], |row| {
                row.get(0)
            })
            .map_err(Into::into)
    }

    pub fn principals(&self, kind: Option<&str>) -> Result<Vec<Principal>, IdentityError> {
        let mut principals = Vec::new();
        if let Some(kind) = kind {
            let mut statement =
                self.engine.store().conn.prepare(
                    "SELECT id, kind, name FROM _principals WHERE kind = ?1 ORDER BY id",
                )?;
            let rows = statement.query_map([kind], principal_row)?;
            for row in rows {
                principals.push(row?);
            }
        } else {
            let mut statement = self
                .engine
                .store()
                .conn
                .prepare("SELECT id, kind, name FROM _principals ORDER BY id")?;
            let rows = statement.query_map([], principal_row)?;
            for row in rows {
                principals.push(row?);
            }
        }
        Ok(principals)
    }
}

fn create_session(
    transaction: &rusqlite::Transaction<'_>,
    principal: Principal,
    kind: &str,
    now: i64,
    expires_at: i64,
) -> Result<Session, IdentityError> {
    let token = random_base64url(32)?;
    let token_digest = session_token_digest(&token);
    transaction.execute(
        "INSERT INTO _sessions(token_digest, principal, kind, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            &token_digest[..],
            principal.id.as_str(),
            kind,
            now,
            expires_at
        ],
    )?;
    let auth_epoch = positive_epoch(transaction.last_insert_rowid())?;
    Ok(Session {
        token,
        principal,
        auth_epoch,
        expires_at,
    })
}

#[derive(Debug)]
struct StoredSession {
    auth_epoch: u64,
    principal_id: String,
    created_at: i64,
    expires_at: i64,
}

impl StoredSession {
    fn authority(
        &self,
        connection: &rusqlite::Connection,
    ) -> Result<SessionAuthority, IdentityError> {
        let principal =
            load_principal(connection, &self.principal_id)?.ok_or(IdentityError::Session)?;
        Ok(SessionAuthority {
            principal,
            auth_epoch: self.auth_epoch,
            expires_at: self.expires_at,
        })
    }
}

fn load_session(
    connection: &rusqlite::Connection,
    token_digest: &[u8; 32],
) -> Result<Option<StoredSession>, IdentityError> {
    connection
        .query_row(
            "SELECT auth_epoch, principal, created_at, expires_at
             FROM _sessions WHERE token_digest = ?1",
            [&token_digest[..]],
            |row| {
                Ok(StoredSession {
                    auth_epoch: positive_epoch(row.get(0)?)?,
                    principal_id: row.get(1)?,
                    created_at: row.get(2)?,
                    expires_at: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn delete_session(
    connection: &rusqlite::Connection,
    auth_epoch: u64,
    token_digest: &[u8; 32],
) -> Result<usize, IdentityError> {
    Ok(connection.execute(
        "DELETE FROM _sessions WHERE auth_epoch = ?1 AND token_digest = ?2",
        params![auth_epoch as i64, &token_digest[..]],
    )?)
}

fn positive_epoch(epoch: i64) -> rusqlite::Result<u64> {
    u64::try_from(epoch)
        .ok()
        .filter(|epoch| *epoch > 0)
        .ok_or_else(|| rusqlite::Error::IntegralValueOutOfRange(0, epoch))
}

fn consume_login_attempt(
    connection: &rusqlite::Connection,
    canonical_email: &str,
    now: i64,
) -> Result<bool, IdentityError> {
    // The short transaction ends before either the real or dummy Argon2 check.
    let global = digest_with_domain(LOGIN_GLOBAL_BUCKET_DOMAIN, &[]);
    let email = digest_with_domain(LOGIN_EMAIL_BUCKET_DOMAIN, canonical_email.as_bytes());
    let transaction = connection.unchecked_transaction()?;
    let global_allowed =
        consume_throttle_bucket(&transaction, &global, LOGIN_GLOBAL_ATTEMPTS, now)?;
    let email_allowed = consume_throttle_bucket(&transaction, &email, LOGIN_EMAIL_ATTEMPTS, now)?;
    transaction.commit()?;
    Ok(global_allowed && email_allowed)
}

fn consume_throttle_bucket(
    transaction: &rusqlite::Transaction<'_>,
    digest: &[u8; 32],
    limit: u32,
    now: i64,
) -> Result<bool, rusqlite::Error> {
    let current = transaction
        .query_row(
            "SELECT window_start, attempts FROM _auth_throttle WHERE bucket_digest = ?1",
            [&digest[..]],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?;
    let (window_start, attempts) = current.unwrap_or((now, 0));
    let reset = now >= window_start.saturating_add(LOGIN_THROTTLE_WINDOW_MILLIS);
    let window_start = if reset { now } else { window_start };
    let attempts = if reset { 0 } else { attempts.max(0) };
    let allowed = attempts < i64::from(limit);
    let attempts = if allowed {
        attempts.saturating_add(1)
    } else {
        attempts
    };
    transaction.execute(
        "INSERT INTO _auth_throttle(bucket_digest, window_start, attempts)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(bucket_digest) DO UPDATE SET
            window_start = excluded.window_start,
            attempts = excluded.attempts",
        params![&digest[..], window_start, attempts],
    )?;
    Ok(allowed)
}

fn load_principal(
    connection: &rusqlite::Connection,
    id: &str,
) -> Result<Option<Principal>, IdentityError> {
    connection
        .query_row(
            "SELECT id, kind, name FROM _principals WHERE id = ?1",
            [id],
            principal_row,
        )
        .optional()
        .map_err(Into::into)
}

fn principal_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Principal> {
    Ok(Principal {
        id: PrincipalId::new(row.get::<_, String>(0)?),
        kind: row.get(1)?,
        name: row.get(2)?,
    })
}

fn hash_password(password: &str) -> Result<String, IdentityError> {
    let mut salt = [0_u8; 16];
    getrandom::fill(&mut salt).map_err(|error| IdentityError::Crypto(error.to_string()))?;
    let salt =
        SaltString::encode_b64(&salt).map_err(|error| IdentityError::Crypto(error.to_string()))?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| IdentityError::Crypto(error.to_string()))
}

fn verify_password(password: &str, hash: &PasswordHash<'_>) -> bool {
    #[cfg(debug_assertions)]
    PASSWORD_VERIFICATION_CALLS.with(|calls| calls.set(calls.get().saturating_add(1)));
    Argon2::default()
        .verify_password(password.as_bytes(), hash)
        .is_ok()
}

fn session_token_digest(token: &str) -> [u8; 32] {
    digest_with_domain(SESSION_TOKEN_DOMAIN, token.as_bytes())
}

fn digest_with_domain(domain: &[u8], value: &[u8]) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(domain);
    digest.update(value);
    digest.finalize().into()
}

fn random_base64url(bytes: usize) -> Result<String, IdentityError> {
    let mut random = vec![0_u8; bytes];
    getrandom::fill(&mut random).map_err(|error| IdentityError::Crypto(error.to_string()))?;
    Ok(base64url(&random))
}

fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut encoded = String::with_capacity((bytes.len() * 4).div_ceil(3));
    for chunk in bytes.chunks(3) {
        let a = chunk[0];
        let b = chunk.get(1).copied().unwrap_or(0);
        let c = chunk.get(2).copied().unwrap_or(0);
        encoded.push(ALPHABET[(a >> 2) as usize] as char);
        encoded.push(ALPHABET[(((a & 0x03) << 4) | (b >> 4)) as usize] as char);
        if chunk.len() > 1 {
            encoded.push(ALPHABET[(((b & 0x0f) << 2) | (c >> 6)) as usize] as char);
        }
        if chunk.len() > 2 {
            encoded.push(ALPHABET[(c & 0x3f) as usize] as char);
        }
    }
    encoded
}

fn normalize_email(email: &str) -> String {
    email.trim().to_ascii_lowercase()
}

fn expires(now: i64) -> i64 {
    now.saturating_add(SESSION_MILLIS)
}
