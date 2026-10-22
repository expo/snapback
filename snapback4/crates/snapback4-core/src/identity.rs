//! Identity (H0, LLP 2000.000 §5.1): principals, sessions and credentials.
//! A development persona is `dev:<name>` and rides a loopback header; a
//! guest is `guest:<id>` minted by the server; a password account is
//! `user:<id>` behind an argon2id hash. A session is a random token whose
//! digest the store keeps; the token itself is never stored. `serve`
//! refuses personas; `dev` admits them.

use crate::metadata::MetadataReader;
use crate::engine::committer::{Committer, Member, Kind};
use crate::error::RuntimeError;
use crate::authority::{self, AuthorityTransaction};
use crate::store_port::{AnyStore, AnyTx};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use sha2::{Digest, Sha256};

pub(super) const DAY_MS: i64 = 86_400_000;
/// Ordinary guest and password sessions expire after one week. Service and
/// application-owned sessions keep the explicit duration their issuer chose.
pub const SESSION_DAYS: i64 = 7;
#[cfg(test)]
pub(crate) mod test_cases;
pub(crate) mod read_sessions;
pub mod diagnostics;
pub use read_sessions::{narrow_session, SessionScope, Capability};

/// Storage facts used by refresh policy. No credential is interpreted by the adapter.
pub(crate) struct FullRotationRecord {
    pub principal: String,
    pub kind: String,
    pub lifetime_ms: i64,
    pub family: String,
}

pub(crate) struct ReadRotationRecord {
    pub principal: String,
    pub kind: String,
    pub family: String,
    pub expires_at: i64,
    pub cap_expires_at: i64,
    pub principal_generation: i64,
    pub current_generation: i64,
}

/// Identity access within a caller-owned transaction.
pub(crate) trait IdentityTransaction {
    fn insert_identity_session(&self, session: &Session, now: i64) -> Result<(), RuntimeError>;
    fn insert_read_session(
        &self,
        session: &Session,
        now: i64,
        family: Option<(&str, i64)>,
    ) -> Result<(), RuntimeError>;
    fn initialize_mint_binding_scope(&self) -> Result<(), RuntimeError>;
    fn mint_binding_record(
        &self,
        invocation: &str,
        intent: &str,
    ) -> Result<Option<SessionMintRecord>, RuntimeError>;
    fn record_session_mint(
        &self,
        invocation: &str,
        intent: &str,
        record: &SessionMintRecord,
    ) -> Result<(), RuntimeError>;
    fn set_identity_session_family(&self, digest: &str, family: &str) -> Result<(), RuntimeError>;
}

/// Composite operations own their transaction explicitly. Validation and token
/// creation callbacks run at their original point within that transaction.
pub(crate) trait IdentityStore {
    /// Convenience write: conflicts fail, but failure atomicity is not part of
    /// the shared contract. SQLite autocommits each statement (expiry sweep and
    /// principal insert can survive a failed session insert); Postgres rolls
    /// the entire head-fenced transaction back. Use the atomic variant when needed.
    fn insert_identity_session(&self, session: &Session, now: i64) -> Result<(), RuntimeError>;
    fn insert_identity_session_atomic(
        &self,
        session: &Session,
        now: i64,
    ) -> Result<(), RuntimeError>;
    /// Convenience deletion across full/read storage. Failure atomicity is not
    /// part of the shared contract: SQLite autocommits the two deletes separately;
    /// Postgres performs both in one head-fenced transaction.
    fn close_identity_session(&self, digest: &str) -> Result<(), RuntimeError>;
    fn full_rotation_record(
        &self,
        digest: &str,
        now: i64,
    ) -> Result<Option<FullRotationRecord>, RuntimeError>;
    fn delete_expired_identity_session(&self, digest: &str, now: i64) -> Result<(), RuntimeError>;
    fn replace_full_session(
        &self,
        old_digest: &str,
        session: &Session,
        family: &str,
        now: i64,
    ) -> Result<bool, RuntimeError>;
    fn signup_identity(
        &self,
        prepared: &PreparedSignup,
        session: &Session,
        now: i64,
        validate: impl FnOnce(Option<String>) -> Result<(), RuntimeError>,
    ) -> Result<(), RuntimeError>;
    fn identity_credential(&self, email: &str) -> Result<Option<Credential>, RuntimeError>;
    fn login_identity(
        &self,
        principal: &str,
        session: &Session,
        now: i64,
        validate: impl FnOnce(Option<String>) -> Result<(), RuntimeError>,
    ) -> Result<(), RuntimeError>;
    /// Read raw facts and run policy before replacing the family, under one writer lock.
    /// `None` from policy leaves the family untouched. Missing storage is an absent row.
    fn rotate_read_session(
        &self,
        digest: &str,
        now: i64,
        mint: impl FnOnce(&ReadRotationRecord) -> Result<Option<Session>, RuntimeError>,
    ) -> Result<Option<Session>, RuntimeError>;
    fn revoke_identity_principal(&self, principal: &str) -> Result<u64, RuntimeError>;
    fn identity_session_expiry(&self, digest: &str) -> Result<Option<i64>, RuntimeError>;
    fn is_supervised_family(&self, digest: &str) -> Result<bool, RuntimeError>;
    fn clear_worker_families(&self) -> Result<(), RuntimeError>;
    fn revoke_worker_family(&self, family: Option<&str>) -> Result<(), RuntimeError>;
    fn mint_supervised_child(
        &self,
        named: bool,
        now: i64,
        revision: usize,
        mint: impl FnOnce() -> Result<Session, RuntimeError>,
    ) -> Result<Session, RuntimeError>;
}

/// Whether a bearer belongs to a host-supervised family (manual seats survive).
pub fn is_supervised_family(store: &AnyStore, token_digest: &str) -> Result<bool, RuntimeError> {
    store.is_supervised_family(token_digest)
}

pub fn clear_worker_families(store: &AnyStore) -> Result<(), RuntimeError> {
    store.clear_worker_families()
}

pub fn revoke_worker_family(store: &AnyStore, family: Option<&str>) -> Result<(), RuntimeError> {
    revoke_worker_family_in(store, family)
}

fn revoke_worker_family_in(store: &impl IdentityStore, family: Option<&str>) -> Result<(), RuntimeError> {
    refuse_nul(&[(family.unwrap_or(""), "a session family cannot contain U+0000")])?;
    store.revoke_worker_family(family)
}

/// Mint a supervised service credential and its marker in one atomic unit.
pub fn mint_supervised_child(
    store: &AnyStore,
    name: Option<&str>,
    now: i64,
    revision: usize,
) -> Result<Session, RuntimeError> {
    let named = name.is_some();
    let name = name.unwrap_or("worker");
    refuse_nul(&[(name, "a service name is 1–64 letters, digits, _ or -")])?;
    if !valid_name(name) {
        return Err(RuntimeError::Auth("a service name is 1–64 letters, digits, _ or -".into()));
    }
    store.mint_supervised_child(named, now, revision, || {
        new_session(&format!("{SERVICE_PREFIX}{name}"), "service", now, 1)
    })
}

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
pub(crate) fn current_service_tx(tx: &AnyTx<'_>, token: &str, sample: ServiceSample) -> Result<Option<String>, RuntimeError> {
    let token_digest = digest(token);
    let Some(session) = authority::live_session(tx, &token_digest, sample.now)? else { return Ok(None) };
    if session.scope != SessionScope::Full || session.kind != "service" || !is_service(&session.principal) { return Ok(None); }
    if !supervisor_current(tx, &session.family, sample.supervisor_revision)? { return Ok(None); }
    Ok(Some(session.principal))
}

// All authenticated doors use the same family fence, in their session snapshot.
// @ref LLP 3000.009#5.3 — failed retirement cannot preserve query authority.
pub(crate) fn supervisor_current(tx: &impl MetadataReader, family: &str, revision: usize) -> Result<bool, RuntimeError> {
    let supervised_family = tx.worker_session_family()?;
    if supervised_family.as_deref() == Some(family)
        && tx.worker_session_revision()?.as_deref() != Some(revision.to_string().as_str())
    {
        return Ok(false);
    }
    // @ref LLP 3000.009#5.3 — each named worker has an independently revoked family.
    if let Some(stored_revision) = tx.worker_family_revision(family)? {
        if stored_revision != revision.to_string() { return Ok(false); }
    }
    Ok(true)
}

fn resolve_session_record_tx(tx: &AnyTx<'_>, token_digest: &str, now: i64, revision: Option<usize>) -> Result<Option<authority::SessionRecord>, RuntimeError> {
    let Some(session) = authority::live_session(tx, token_digest, now)? else { return Ok(None); };
    if let Some(revision) = revision {
        if !supervisor_current(tx, &session.family, revision)? { return Ok(None); }
    }
    Ok(Some(session))
}

pub(crate) fn resolve_session_tx(tx: &AnyTx<'_>, token_digest: &str, now: i64, revision: Option<usize>) -> Result<Option<Capability>, RuntimeError> {
    Ok(resolve_session_record_tx(tx, token_digest, now, revision)?.map(|session| (session.principal, session.kind, session.scope)))
}

// @ref LLP 3000.009.001.000.000#k0a-implementation-note — capability and lifetime reads share one existing authority-snapshot seam.
pub(crate) fn resolve_session_record_snapshot(store: &AnyStore, token_digest: &str, now: i64, revision: Option<usize>, expected_store: Option<&str>) -> Result<Option<authority::SessionRecord>, RuntimeError> {
    store.with_authority_snapshot(|tx| {
        if let Some(expected_store) = expected_store {
            if tx.store_identity()?.as_deref() != Some(expected_store) {
                return Err(RuntimeError::Auth("the serving store identity changed".into()));
            }
        }
        resolve_session_record_tx(tx, token_digest, now, revision)
    })
}

/// Host authentication, including ordinary queries and mutations.
pub fn resolve_supervised(store: &AnyStore, token: &str, sample: ServiceSample) -> Result<Option<Capability>, RuntimeError> {
    Ok(resolve_session_record_snapshot(store, &digest(token), sample.now, Some(sample.supervisor_revision), None)?
        .map(|session| (session.principal, session.kind, session.scope)))
}

pub fn resolve_read_only_supervised(store: &AnyStore, token: &str, sample: ServiceSample, expected_store_id: Option<&str>) -> Result<Option<Capability>, RuntimeError> {
    store.resolve_session_snapshot(&digest(token), sample.now, expected_store_id, Some(sample.supervisor_revision))
}

/// Read-only wrapper for host doors that do not already own a writer
/// transaction. Strict work transitions call `current_service_tx` directly.
pub fn current_service(store: &AnyStore, token: &str, sample: ServiceSample) -> Result<Option<String>, RuntimeError> {
    store.with_authority_snapshot(|tx| {
    let service = current_service_tx(tx, token, sample)?;
    Ok(service)
    })
}

pub use crate::authority::Authority;

pub(crate) fn principal_generation(tx: &AnyTx<'_>, principal: &str) -> Result<i64, RuntimeError> {
    tx.principal_generation(principal)
}

/// Resolve the admitting credential inside the admission transaction.
pub(crate) fn authority(tx: &AnyTx<'_>, token_digest: &str, principal: &str, now: i64) -> Result<Authority, RuntimeError> {
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
    refuse_nul(&[(principal, "a principal is 1–128 printable characters"),
        (kind, "a session kind is 1–64 letters, digits, _ or -")])?;
    Ok(Session {
        principal: principal.to_owned(),
        kind: kind.to_owned(),
        token: base64url(&random_bytes(32)?),
        expires_at: now + days.clamp(1, 3_650) * DAY_MS,
        scope: SessionScope::Full,
        cap_expires_at: None,
    })
}

/// Mint a session for a principal; returns the token exactly once.
pub fn open_session(store: &AnyStore, principal: &str, kind: &str, now: i64,
) -> Result<Session, RuntimeError> {
    let session = new_session(principal, kind, now, SESSION_DAYS)?;
    store.insert_identity_session(&session, now)?;
    Ok(session)
}

/// A claim's non-renewable viewer session. The queue inserts it in the
/// claim transaction and deletes it in the settlement transaction.
// @ref LLP 3000.007#9.2 — the worker borrows the request principal only for its lease.
pub(crate) fn action_session(tx: &impl IdentityTransaction, principal: &str, now: i64, expires_at: i64) -> Result<Session, RuntimeError> {
    refuse_nul(&[(principal, "an action needs a signed-in principal")])?;
    if principal == crate::SYSTEM_PRINCIPAL || !crate::value::identity_fits(principal) {
        return Err(RuntimeError::Auth("an action needs a signed-in principal".into()));
    }
    let mut session = new_session(principal, "action", now, 1)?;
    session.expires_at = expires_at;
    tx.insert_identity_session(&session, now)?;
    Ok(session)
}

/// The principal behind a bearer token, if the session is live.
pub fn resolve(store: &AnyStore, token: &str, now: i64) -> Result<Option<Capability>, RuntimeError> {
    let token_digest = digest(token);
    let resolved = resolve_digest(store, &token_digest, now)?;
    if resolved.is_none() { store.invalidate_expired_authority_session(&token_digest, now)?; }
    Ok(resolved)
}

/// Resolve authority from a detached reader without attempting expired-session
/// maintenance. Application catalog adoption does not revoke sessions; a store
/// identity change does. The serving writer retains custody of cleanup.
// @ref LLP 3000.017#3.3 — ephemeral-only poll wakes finish without the engine mutex.
pub fn resolve_read_only(store: &AnyStore, token: &str, now: i64, expected_store_id: Option<&str>) -> Result<Option<Capability>, RuntimeError> {
    store.resolve_session_snapshot(&digest(token), now, expected_store_id, None)
}

fn resolve_digest(store: &AnyStore, token_digest: &str, now: i64) -> Result<Option<Capability>, RuntimeError> {
    Ok(resolve_session_record_snapshot(store, token_digest, now, None, None)?
        .map(|session| (session.principal, session.kind, session.scope)))
}

pub fn close_session(store: &AnyStore, token: &str) -> Result<(), RuntimeError> {
    store.close_identity_session(&digest(token))
}

/// Authenticate and close one live session family in the same writer
/// transaction. This is the HTTP logout boundary; callers that already own a
/// different authority boundary may continue to use `close_session`.
// @ref LLP 3000.009#5.1 — logout and lost-delivery replacement serialize on the session family.
pub fn logout_session(store: &mut AnyStore, token: &str, now: impl FnOnce() -> i64) -> Result<(), RuntimeError> {
    let token_digest = digest(token);
    Committer::run(store, Member::new(Kind::Direct, |tx| {
        // The successful immediate transaction is the authority linearization
        // point: time spent waiting for its writer lock cannot keep a token live.
        let now = now();
        let Some(session) = tx.live_identity_session(&token_digest, now)? else {
            return Err(RuntimeError::Auth("this session is not live; sign in again".into()));
        };
        tx.invalidate_family(&session.principal, &session.family)?;
        tx.complete(())
    }))
}

/// Replace one live bearer token atomically. The new token keeps the
/// session's originally selected lifetime and starts that lifetime anew.
pub fn rotate_session(
    store: &AnyStore,
    old_token: &str,
    now: i64,
) -> Result<Option<Session>, RuntimeError> {
    rotate_session_in(store, old_token, now)
}

fn rotate_session_in(store: &impl IdentityStore, old_token: &str, now: i64) -> Result<Option<Session>, RuntimeError> {
    // @ref LLP 3000.033#1.3 — read rotation has immutable authority and no foreign sweep.
    if old_token.starts_with("ro.") { return read_sessions::rotate(store, old_token, now); }
    let old_digest = digest(old_token);
    let Some(FullRotationRecord { principal, kind, lifetime_ms, family }) = store.full_rotation_record(&old_digest, now)? else {
        store.delete_expired_identity_session(&old_digest, now)?;
        return Ok(None);
    };
    if refuse_nul(&[(&principal, "a principal is 1–128 printable characters"),
        (&kind, "a session kind is 1–64 letters, digits, _ or -"),
        (&family, "a session family cannot contain U+0000")]).is_err() { return Ok(None); }
    if kind == "action" {
        return Err(RuntimeError::Auth("an action session lasts only for its claim and cannot be refreshed".into()));
    }
    let days = lifetime_ms.div_euclid(DAY_MS).clamp(1, 3_650);
    let session = new_session(&principal, &kind, now, days)?;
    if !store.replace_full_session(&old_digest, &session, &family, now)? { return Ok(None); }
    Ok(Some(session))
}

/// A guest: a principal with no credential, minted on request.
pub fn guest(store: &AnyStore, now: i64, entropy: &mut crate::ids::Mint) -> Result<Session, RuntimeError> {
    guest_scoped(store, now, entropy, SessionScope::Full)
}
pub fn guest_scoped(store: &AnyStore, now: i64, entropy: &mut crate::ids::Mint, scope: SessionScope) -> Result<Session, RuntimeError> {
    let id = crate::ids::mint(now, entropy)?;
    let session = read_sessions::scoped_session(&format!("guest:{id}"), "guest", now, scope)?;
    store.insert_identity_session_atomic(&session, now)?;
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

pub(crate) use crate::authority::refuse_nul;

fn validate_bound_worker(worker: &str) -> Result<(), RuntimeError> {
    refuse_nul(&[(worker, "a worker principal cannot contain U+0000")])
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
    pub(crate) email: String,
    pub(crate) hash: String,
}
#[derive(Clone)]
pub struct Credential {
    pub(crate) principal: String,
    pub(crate) hash: String,
}

// @ref LLP 3000#7-decisions-during-execution — KDF work has no engine or database guard
pub fn prepare_signup(email: &str, password: &str) -> Result<PreparedSignup, RuntimeError> {
    let email = normalized_email(email);
    refuse_nul(&[(&email, "an email address is needed")])?;
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
    store: &AnyStore,
    prepared: PreparedSignup,
    now: i64,
    entropy: &mut crate::ids::Mint,
) -> Result<Session, RuntimeError> {
    finish_signup_scoped(store, prepared, now, entropy, SessionScope::Full)
}
pub fn finish_signup_scoped(store: &AnyStore, prepared: PreparedSignup, now: i64, entropy: &mut crate::ids::Mint, scope: SessionScope) -> Result<Session, RuntimeError> {
    finish_signup_in(store, prepared, now, entropy, scope)
}

fn finish_signup_in(store: &impl IdentityStore, prepared: PreparedSignup, now: i64, entropy: &mut crate::ids::Mint, scope: SessionScope) -> Result<Session, RuntimeError> {
    refuse_nul(&[(&prepared.email, "an email address is needed")])?;
    let principal = format!("user:{}", crate::ids::mint(now, entropy)?);
    let session = read_sessions::scoped_session(&principal, "user", now, scope)?;
    store.signup_identity(&prepared, &session, now, |taken| {
        if taken.is_some() {
            return Err(RuntimeError::Auth("that email already has an account; sign in instead".into()));
        }
        Ok(())
    })?;
    Ok(session)
}

pub fn signup(
    store: &AnyStore,
    email: &str,
    password: &str,
    now: i64,
    entropy: &mut crate::ids::Mint,
) -> Result<Session, RuntimeError> {
    finish_signup(store, prepare_signup(email, password)?, now, entropy)
}

pub fn credential(store: &AnyStore, email: &str) -> Result<Option<Credential>, RuntimeError> {
    credential_in(store, email)
}

fn credential_in(store: &impl IdentityStore, email: &str) -> Result<Option<Credential>, RuntimeError> {
    refuse_nul(&[(email, "an email address is needed")])?;
    let found = store.identity_credential(&normalized_email(email))?;
    if let Some(checked) = &found {
        refuse_nul(&[(&checked.principal, "a principal is 1–128 printable characters")])?;
    }
    Ok(found)
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
pub fn finish_login(store: &AnyStore, checked: Credential, now: i64) -> Result<Session, RuntimeError> {
    finish_login_scoped(store, checked, now, SessionScope::Full)
}
pub fn finish_login_scoped(store: &AnyStore, checked: Credential, now: i64, scope: SessionScope) -> Result<Session, RuntimeError> {
    finish_login_in(store, checked, now, scope)
}

fn finish_login_in(store: &impl IdentityStore, checked: Credential, now: i64, scope: SessionScope) -> Result<Session, RuntimeError> {
    let session = read_sessions::scoped_session(&checked.principal, "user", now, scope)?;
    store.login_identity(&checked.principal, &session, now, |current| {
        if current.as_deref() != Some(checked.hash.as_str()) { return Err(bad_login()); }
        Ok(())
    })?;
    Ok(session)
}
pub fn login(store: &AnyStore, email: &str, password: &str, now: i64,
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
        let store = AnyStore::memory().unwrap();
        let mut entropy = crate::ids::Mint::default();
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
        let store = AnyStore::memory().unwrap();
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
        let kept: i64 = (&store).test_support_conn()
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
        let store = AnyStore::memory().unwrap();
        let mut entropy = crate::ids::Mint::default();
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
        let store = AnyStore::memory().unwrap();
        signup(&store, "a@example.com", "correct horse", 1, &mut crate::ids::Mint::default()).unwrap();
        let found = credential(&store, "a@example.com").unwrap().unwrap();
        verify_password(Some(&found), "correct horse").unwrap();
        (&store).test_support_conn()
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
    principal.starts_with(SERVICE_PREFIX) && crate::value::identity_fits(principal)
}

/// The namespaces the engine mints itself; an application's own accounts
/// live outside them.
const RESERVED_PREFIXES: [&str; 4] = ["dev:", "guest:", "user:", SERVICE_PREFIX];

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// A session for the service `name`, `days` long: what `snapback4 token
/// --service name` prints once and a worker keeps.
pub fn service_session(store: &AnyStore, name: &str, now: i64, days: i64) -> Result<Session, RuntimeError> {
    refuse_nul(&[(name, "a service name is 1–64 letters, digits, _ or -")])?;
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
pub fn custom_session(store: &AnyStore, principal: &str, kind: &str, now: i64, days: i64) -> Result<Session, RuntimeError> {
    validate_custom_session(principal, kind)?;
    open_session_for(store, principal, kind, now, days)
}

pub fn validate_custom_session(principal: &str, kind: &str) -> Result<(), RuntimeError> {
    refuse_nul(&[(principal, "a principal is 1–128 printable characters"),
        (kind, "a session kind is 1–64 letters, digits, _ or -")])?;
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

fn open_session_for(store: &impl IdentityStore, principal: &str, kind: &str, now: i64, days: i64) -> Result<Session, RuntimeError> {
    let session = new_session(principal, kind, now, days)?;
    store.insert_identity_session(&session, now)?;
    Ok(session)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionMintBinding {
    pub invocation_id: String,
    pub intent: String,
    pub replace_lost_delivery: bool,
}

fn validate_mint_binding(binding: &SessionMintBinding) -> Result<(), RuntimeError> {
    refuse_nul(&[(&binding.invocation_id, "binding requires a valid invocationId and intent identity-session/v1"),
        (&binding.intent, "binding requires a valid invocationId and intent identity-session/v1")])
        .map_err(|_| RuntimeError::Input("binding requires a valid invocationId and intent identity-session/v1".into()))?;
    if binding.intent != BOUND_SESSION_INTENT || binding.invocation_id.is_empty() || binding.invocation_id.len() > 128
        || !crate::value::identity_fits(&binding.invocation_id)
    {
        return Err(RuntimeError::Input("binding requires a valid invocationId and intent identity-session/v1".into()));
    }
    Ok(())
}

pub(crate) struct SessionMintRecord {
    pub(crate) input_digest: String,
    pub(crate) scope: String,
    pub(crate) principal: String,
    pub(crate) kind: String,
    pub(crate) days: i64,
    pub(crate) expires_at: i64,
    pub(crate) family: String,
    pub(crate) principal_generation: i64,
}

fn session_mint_authority_error(message: &str) -> RuntimeError {
    RuntimeError::Structural { code: "E_ACTION_AUTHORITY", message: message.into() }
}

/// Mint once for one live action claim, or explicitly replace a response
/// whose delivery was lost. The binding and token family change together.
// @ref LLP 3000.009#5.1 — the identity handoff borrows the transaction-scoped service and action authorities.
pub fn bound_custom_session(
    store: &mut AnyStore,
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
    validate_mint_binding(binding)?;
    validate_bound_worker(worker)?;
    let tx = store.transaction()?;
    let session = bound_custom_session_tx(&tx, service_token, worker, action_lease, principal, kind, now, days, binding)?;
    tx.commit()?;
    Ok(session)
}

// The caller owns the writer fence and commit; both adapters use the same
// service, claim, input-binding and lost-delivery decisions.
#[allow(clippy::too_many_arguments)]
pub(crate) fn bound_custom_session_tx(
    tx: &(impl IdentityTransaction + AuthorityTransaction + crate::engine::actions::requests::RequestsTransaction),
    service_token: &str, worker: &str, action_lease: &str, principal: &str, kind: &str,
    now: impl FnOnce() -> i64, days: i64, binding: &SessionMintBinding,
) -> Result<Session, RuntimeError> {
    validate_custom_session(principal, kind)?;
    validate_mint_binding(binding)?;
    validate_bound_worker(worker)?;
    // @ref LLP 3000.033#1.3 — scope is bound separately; preserve legacy input digests for recoverable full mints.
    let input = serde_json::json!({ "principal": principal, "kind": kind, "days": days });
    let input_digest = crate::store::payload_digest(&input);
    let service_digest = digest(service_token);
    // Sample only after the immediate writer transaction is ours, beside
    // every service, claim, admitting and target-family authority check.
    let now = now();
    let service_is_live = authority::live_service_session(tx, &service_digest, worker, now)?;
    if !service_is_live || !is_service(worker) {
        return Err(RuntimeError::Auth("the service credential is no longer live for this action claim".into()));
    }
    crate::engine::actions::held_claim_authority(tx, &binding.invocation_id, worker, action_lease, now)?;
    let target_generation = tx.principal_generation(principal)?;
    tx.initialize_mint_binding_scope()?;
    let previous = tx.mint_binding_record(&binding.invocation_id, &binding.intent)?;
    let session = match previous {
        None => {
            let session = new_session(principal, kind, now, days)?;
            tx.insert_identity_session(&session, now)?;
            let family = digest(&session.token);
            tx.record_session_mint(&binding.invocation_id, &binding.intent, &SessionMintRecord {
                input_digest: input_digest.clone(), scope: "full".into(), principal: principal.into(),
                kind: kind.into(), days, expires_at: session.expires_at, family,
                principal_generation: target_generation,
            })?;
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
            let family_is_live = !previous.family.contains('\0') && tx
                .latest_live_family_member(principal, &previous.family, now)?
                .is_some_and(|member| member.identity_is_valid());
            if !family_is_live {
                return Err(session_mint_authority_error("the bound session family is no longer live and cannot be recreated"));
            }
            tx.invalidate_family(principal, &previous.family)?;
            let mut session = new_session(principal, kind, now, days)?;
            session.expires_at = previous.expires_at;
            tx.insert_identity_session(&session, now)?;
            tx.set_identity_session_family(&digest(&session.token), &previous.family)?;
            session
        }
    };
    Ok(session)
}

/// End every session of a principal: an account lifecycle event (a lost
/// phone, a removed member) the application's service performs. Returns
/// how many sessions ended.
pub fn revoke_principal(store: &AnyStore, principal: &str) -> Result<u64, RuntimeError> {
    revoke_principal_in(store, principal)
}

fn revoke_principal_in(store: &impl IdentityStore, principal: &str) -> Result<u64, RuntimeError> {
    refuse_nul(&[(principal, "a principal is 1–128 printable characters")])?;
    store.revoke_identity_principal(principal)
}

#[cfg(test)]
mod service_tests {
    use super::*;

    #[test]
    fn services_and_custom_accounts_have_sessions_of_their_own() {
        let store = AnyStore::memory().unwrap();
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
