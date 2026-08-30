//! Persistent principals, credentials, and sessions.
// @ref LLP 1001#6-identity-identityrs — authentication is always backed by stored principals.

use crate::principal::PrincipalId;
use crate::registry::Runtime;
use argon2::Argon2;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const SESSION_MILLIS: i64 = 30 * 24 * 60 * 60 * 1_000;
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Principal {
    pub id: PrincipalId,
    pub kind: String,
    pub name: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub token: String,
    pub principal: Principal,
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
        if !self.generation.schema.auth.password {
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
        if !self.generation.schema.auth.password {
            return Err(IdentityError::Invalid);
        }
        let email = normalize_email(email);
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
        if !self.generation.schema.auth.guests {
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

    pub fn persona(&mut self, name: &str, now: i64) -> Result<Session, IdentityError> {
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
        let existing: Option<(String, i64)> = self
            .engine
            .store()
            .conn
            .query_row(
                "SELECT token, expires_at FROM _sessions
                 WHERE principal = ?1 AND kind = 'persona' ORDER BY created_at LIMIT 1",
                [principal.id.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((token, expires_at)) = existing {
            return Ok(Session {
                token,
                principal,
                expires_at,
            });
        }
        let transaction = self.engine.store_mut().conn.transaction()?;
        let session = create_session(&transaction, principal, "persona", now, i64::MAX)?;
        transaction.commit()?;
        Ok(session)
    }

    pub fn authenticate(&self, token: &str, now: i64) -> Result<Principal, IdentityError> {
        let principal_id: Option<String> = self
            .engine
            .store()
            .conn
            .query_row(
                "SELECT principal FROM _sessions WHERE token = ?1 AND expires_at >= ?2",
                params![token, now],
                |row| row.get(0),
            )
            .optional()?;
        let principal_id = principal_id.ok_or(IdentityError::Session)?;
        load_principal(&self.engine.store().conn, &principal_id)?.ok_or(IdentityError::Session)
    }

    pub fn logout(&mut self, token: &str) -> Result<(), IdentityError> {
        self.engine
            .store_mut()
            .conn
            .execute("DELETE FROM _sessions WHERE token = ?1", [token])?;
        Ok(())
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
    transaction.execute(
        "INSERT INTO _sessions(token, principal, kind, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![token, principal.id.as_str(), kind, now, expires_at],
    )?;
    Ok(Session {
        token,
        principal,
        expires_at,
    })
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
