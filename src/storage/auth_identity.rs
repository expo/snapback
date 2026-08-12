//! Protected catalog-v3/v4 guest/password/recovery transition floor.

use super::LocalDatabase;
use super::auth::PasswordIdentifierMode;
use crate::auth::crypto::{CanonicalAddress, RandomSource, SessionBearer};
use crate::auth::identity_core::{
    AssuranceKind, AssuranceProvenance, AssuranceRecord, AuthClaimsProjection, ClaimsIdentity,
    PasswordSecret, RecoveryCodes,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use argon2::{
    Algorithm, Argon2, Params, Version,
    password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac as _};
use rusqlite::{OptionalExtension, Transaction, params};
use sha2::Sha256;
use std::collections::BTreeSet;
use subtle::ConstantTimeEq as _;
use unicode_normalization::UnicodeNormalization as _;
use uuid::Uuid;

const SESSION_IDLE_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
const SESSION_ABSOLUTE_MS: u64 = 90 * 24 * 60 * 60 * 1_000;
const RECOVERY_COUNT: usize = 8;
const COMMON_PASSWORD_LIST_VERSION: u64 = 1;
const COMMON_PASSWORDS: &[&str] = &[
    "123456789012",
    "correcthorsebatterystaple",
    "iloveyou12345",
    "letmein123456",
    "password1234",
    "qwertyuiop12",
];
const RECOVERY_DOMAIN: &[u8] = b"snapback.auth.recovery-code.v1";
const DUMMY_PASSWORD_PHC: &str = "$argon2id$v=19$m=19456,t=2,p=1$HyAhIiMkJSYnKCkqKywtLg$Kwc47BIKhIV7UTbl8eAZf0EL/mFlTXkkO6rPuplXNLc";

/// Versioned policy authority for newly stored password hashes. PHC strings
/// describe individual stored hashes but never choose the active policy.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PasswordHashPolicy {
    version: u64,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
    salt_bytes: usize,
    tag_bytes: usize,
    common_password_list_version: u64,
}

const PASSWORD_HASH_POLICY_V1: PasswordHashPolicy = PasswordHashPolicy {
    version: 1,
    memory_kib: 19_456,
    iterations: 2,
    parallelism: 1,
    salt_bytes: 16,
    tag_bytes: 32,
    common_password_list_version: COMMON_PASSWORD_LIST_VERSION,
};

impl PasswordHashPolicy {
    fn argon2(self) -> Argon2<'static> {
        let params = Params::new(
            self.memory_kib,
            self.iterations,
            self.parallelism,
            Some(self.tag_bytes),
        )
        .expect("ratified password hash policy is a valid Argon2 parameter set");
        Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
    }

    /// Upgrade-on-verify plugs in here: after a successful verification, a
    /// false result causes a replacement PHC to be prepared outside the writer
    /// lock and swapped under the credential-generation compare-and-swap.
    fn matches_phc(self, hash: &PasswordHash) -> bool {
        let Ok(params) = Params::try_from(hash) else {
            return false;
        };
        hash.algorithm.as_str() == "argon2id"
            && hash.version == Some(19)
            && params.m_cost() == self.memory_kib
            && params.t_cost() == self.iterations
            && params.p_cost() == self.parallelism
            && params.output_len() == Some(self.tag_bytes)
            && hash
                .salt
                .as_ref()
                .is_some_and(|salt| salt.len() == self.salt_bytes)
            && hash
                .hash
                .as_ref()
                .is_some_and(|tag| tag.len() == self.tag_bytes)
    }
}

#[derive(Debug)]
pub(crate) struct IdentitySession {
    pub user_id: String,
    pub session_id: String,
    pub bearer: SessionBearer,
    pub recovery_codes: Option<RecoveryCodes>,
}

#[derive(Clone)]
struct PasswordSnapshot {
    user_id: String,
    identity_id: String,
    credential_id: String,
    generation: u64,
    hash_phc: String,
    identifier_mode: PasswordIdentifierMode,
}

struct PasswordIdentifier {
    canonical: String,
    mode: PasswordIdentifierMode,
}

#[derive(Clone, Copy)]
pub(crate) struct RecoveryKeyMaterial<'a> {
    key_id: &'a str,
    key: &'a [u8; 32],
}

impl<'a> RecoveryKeyMaterial<'a> {
    pub(crate) const fn new(key_id: &'a str, key: &'a [u8; 32]) -> Self {
        Self { key_id, key }
    }
}

/// A prepared authority cannot be decoded from a request or constructed by an
/// app handler. The host supplies server-resolved ids from one verified event.
pub(crate) struct VerifiedProvisioningAuthority {
    hook_id: String,
    hook_digest: [u8; 32],
    provisioning_key: String,
    user_id: String,
    identity_id: String,
    assurance_id: String,
    declared_writes: BTreeSet<String>,
}

pub(crate) struct ProvisioningInsert {
    pub table: String,
    pub columns: Vec<(String, String)>,
}

pub(crate) struct VerifiedEmailClaim {
    canonical: CanonicalAddress,
    event_id: String,
    governing_authority: String,
}
pub(crate) fn prepare_verified_email_claim(
    address: &str,
    event_id: &str,
    governing_authority: &str,
) -> SnapbackResult<VerifiedEmailClaim> {
    let canonical = CanonicalAddress::parse(address).map_err(|_| {
        auth_error(
            "SNAPBACK_AUTH_IDENTITY_INVALID",
            "verified identity is invalid",
        )
    })?;
    if event_id.is_empty() || governing_authority.is_empty() {
        return Err(auth_error(
            "SNAPBACK_AUTH_VERIFIED_PROOF_INVALID",
            "verified proof is invalid",
        ));
    }
    Ok(VerifiedEmailClaim {
        canonical,
        event_id: event_id.into(),
        governing_authority: governing_authority.into(),
    })
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ProvisioningOutcome {
    Committed,
    AlreadyCommitted,
}

pub(crate) fn prepare_verified_provisioning(
    hook_id: &str,
    hook_digest: [u8; 32],
    provisioning_key: &str,
    user_id: &str,
    identity_id: &str,
    assurance_id: &str,
    declared_writes: impl IntoIterator<Item = String>,
) -> SnapbackResult<VerifiedProvisioningAuthority> {
    if hook_id.is_empty() || provisioning_key.is_empty() {
        return Err(auth_error(
            "SNAPBACK_AUTH_PROVISIONING_INVALID",
            "verified provisioning authority is invalid",
        ));
    }
    Ok(VerifiedProvisioningAuthority {
        hook_id: hook_id.into(),
        hook_digest,
        provisioning_key: provisioning_key.into(),
        user_id: user_id.into(),
        identity_id: identity_id.into(),
        assurance_id: assurance_id.into(),
        declared_writes: declared_writes.into_iter().collect(),
    })
}

fn quoted_identifier(value: &str) -> SnapbackResult<String> {
    if !crate::manifest::is_user_identifier(value) {
        return Err(auth_error(
            "SNAPBACK_AUTH_PROVISIONING_WRITE_FORBIDDEN",
            "provisioning write identifier is not declared",
        ));
    }
    Ok(format!("\"{value}\""))
}

fn auth_error(code: &'static str, message: &'static str) -> SnapbackError {
    SnapbackError::error(code, "auth", message)
}
fn opaque_id(prefix: &str) -> String {
    format!("{prefix}_{}", Uuid::new_v4().simple())
}

fn canonical_username(value: &str) -> SnapbackResult<String> {
    if value.chars().any(|c| c == '\0' || c.is_control()) {
        return Err(auth_error(
            "SNAPBACK_AUTH_USERNAME_INVALID",
            "username is invalid",
        ));
    }
    let trimmed = value.trim_matches(char::is_whitespace);
    let normalized: String = trimmed.nfc().collect();
    let canonical = normalized.to_lowercase();
    if canonical.is_empty()
        || canonical.len() > 128
        || canonical
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(auth_error(
            "SNAPBACK_AUTH_USERNAME_INVALID",
            "username is invalid",
        ));
    }
    Ok(canonical)
}

fn canonical_password_identifier(
    mode: PasswordIdentifierMode,
    value: &str,
) -> SnapbackResult<PasswordIdentifier> {
    Ok(PasswordIdentifier {
        canonical: canonical_password_identifier_value(mode, value)?,
        mode,
    })
}

pub(super) fn canonical_password_identifier_value(
    mode: PasswordIdentifierMode,
    value: &str,
) -> SnapbackResult<String> {
    let canonical = match mode {
        PasswordIdentifierMode::UsernameV1 => canonical_username(value),
        PasswordIdentifierMode::EmailV1 => CanonicalAddress::parse(value)
            .map(|address| address.as_str().to_owned())
            .map_err(|_| {
                auth_error(
                    "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_INVALID",
                    "password identifier does not satisfy the declared mode",
                )
            }),
    }
    .map_err(|_| {
        auth_error(
            "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_INVALID",
            "password identifier does not satisfy the declared mode",
        )
    })?;
    Ok(canonical)
}

fn require_same_password_identifier_mode(
    conn: &rusqlite::Connection,
    expected: PasswordIdentifierMode,
) -> SnapbackResult<()> {
    if super::auth::identity_floor_password_identifier_mode_on(conn)? == expected {
        return Ok(());
    }
    Err(auth_error(
        "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_MODE_IMMUTABLE",
        "password identifier mode cannot change after auth catalog activation",
    ))
}

fn hash_password(secret: &PasswordSecret, random: &dyn RandomSource) -> SnapbackResult<String> {
    let password = secret.expose_secret();
    if password.len() < 12
        || password.len() > 1_024
        || COMMON_PASSWORDS
            .iter()
            .any(|candidate| candidate == &password)
    {
        return Err(auth_error(
            "SNAPBACK_AUTH_PASSWORD_POLICY",
            "password does not satisfy the active policy",
        ));
    }
    let mut salt = [0_u8; PASSWORD_HASH_POLICY_V1.salt_bytes];
    random.fill(&mut salt).map_err(|_| {
        auth_error(
            "SNAPBACK_AUTH_RANDOM_UNAVAILABLE",
            "secure randomness is unavailable",
        )
    })?;
    PASSWORD_HASH_POLICY_V1
        .argon2()
        .hash_password_with_salt(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| {
            auth_error(
                "SNAPBACK_AUTH_PASSWORD_HASH_UNAVAILABLE",
                "password hashing is unavailable",
            )
        })
}

fn verify_password(secret: &PasswordSecret, hash_phc: &str) -> bool {
    PasswordHash::new(hash_phc).is_ok_and(|hash| {
        PASSWORD_HASH_POLICY_V1
            .argon2()
            .verify_password(secret.expose_secret().as_bytes(), &hash)
            .is_ok()
    })
}

fn password_hash_needs_upgrade(hash_phc: &str) -> bool {
    PasswordHash::new(hash_phc)
        .map(|hash| !PASSWORD_HASH_POLICY_V1.matches_phc(&hash))
        .unwrap_or(true)
}

fn recovery_digest(key: &[u8; 32], code: &str) -> [u8; 32] {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("fixed-size HMAC key");
    mac.update(RECOVERY_DOMAIN);
    mac.update(code.as_bytes());
    mac.finalize().into_bytes().into()
}

fn generate_recovery(
    random: &dyn RandomSource,
    key: &[u8; 32],
) -> SnapbackResult<(RecoveryCodes, Vec<[u8; 32]>)> {
    let mut codes = Vec::with_capacity(RECOVERY_COUNT);
    let mut digests = Vec::with_capacity(RECOVERY_COUNT);
    for _ in 0..RECOVERY_COUNT {
        let mut bytes = [0_u8; 20];
        random.fill(&mut bytes).map_err(|_| {
            auth_error(
                "SNAPBACK_AUTH_RANDOM_UNAVAILABLE",
                "secure randomness is unavailable",
            )
        })?;
        let code = format!("sbrv1_{}", URL_SAFE_NO_PAD.encode(bytes));
        digests.push(recovery_digest(key, &code));
        codes.push(code);
    }
    Ok((RecoveryCodes::new(codes), digests))
}

fn mint_session(random: &dyn RandomSource) -> SnapbackResult<(String, String, SessionBearer)> {
    let bearer = SessionBearer::generate(random).map_err(|_| {
        auth_error(
            "SNAPBACK_AUTH_RANDOM_UNAVAILABLE",
            "secure randomness is unavailable",
        )
    })?;
    Ok((opaque_id("session"), opaque_id("authority"), bearer))
}

fn insert_session(
    tx: &Transaction<'_>,
    user: &str,
    identity: Option<&str>,
    credential: Option<&str>,
    source: &str,
    now: u64,
    random: &dyn RandomSource,
) -> SnapbackResult<(String, SessionBearer)> {
    let (session, authority, bearer) = mint_session(random)?;
    tx.execute("INSERT INTO _auth_sessions(id,user_id,identity_id,credential_id,authn_source,authority_instance_id,token_hash,generation,created_at_ms,last_used_at_ms,expires_at_ms,absolute_expires_at_ms,revoked_at_ms) VALUES(?1,?2,?3,?4,?5,?6,?7,1,?8,?8,?9,?10,NULL)", params![session, user, identity, credential, source, authority, bearer.token_hash().as_bytes().as_slice(), now, now + SESSION_IDLE_MS, now + SESSION_ABSOLUTE_MS])?;
    Ok((session, bearer))
}

fn insert_assurance(
    tx: &Transaction<'_>,
    user: &str,
    session: &str,
    credential: Option<&str>,
    kind: &str,
    now: u64,
    expiry: Option<u64>,
) -> SnapbackResult<()> {
    tx.execute("INSERT INTO _auth_assurances(id,user_id,session_id,identity_id,credential_id,kind,provenance,issued_at_ms,expires_at_ms,governing_authority,revoked_at_ms) VALUES(?1,?2,?3,NULL,?4,?5,?6,?7,?8,NULL,NULL)", params![opaque_id("assurance"), user, session, credential, kind, if credential.is_some() { "credential" } else { "session" }, now, expiry])?;
    Ok(())
}

fn journal(tx: &Transaction<'_>, user: &str, kind: &str, now: u64) -> SnapbackResult<()> {
    tx.execute("INSERT INTO _auth_security_events(id,user_id,kind,cause_class,occurred_at_ms,correlation_id,redacted_metadata) VALUES(?1,?2,?3,'public-transition',?4,?5,?6)", params![opaque_id("event"), user, kind, now, opaque_id("correlation"), r#"{"notificationChannel":"unavailable"}"#])?;
    Ok(())
}

fn insert_recovery_set(
    tx: &Transaction<'_>,
    user: &str,
    key_id: &str,
    digests: &[[u8; 32]],
    reason: &str,
    now: u64,
) -> SnapbackResult<String> {
    let generation: u64 = tx.query_row("SELECT COALESCE(MAX(set_generation),0)+1 FROM _auth_recovery_code_sets r JOIN _auth_credentials c ON c.id=r.credential_id WHERE c.user_id=?1", [user], |row| row.get(0))?;
    tx.execute("UPDATE _auth_credentials SET revoked_at_ms=?2 WHERE user_id=?1 AND kind='recovery-code-set' AND revoked_at_ms IS NULL", params![user, now])?;
    tx.execute("UPDATE _auth_recovery_code_sets SET replaced_at_ms=?2 WHERE credential_id IN (SELECT id FROM _auth_credentials WHERE user_id=?1 AND kind='recovery-code-set') AND replaced_at_ms IS NULL", params![user, now])?;
    let id = opaque_id("recovery");
    tx.execute("INSERT INTO _auth_credentials(id,user_id,kind,generation,created_at_ms) VALUES(?1,?2,'recovery-code-set',?3,?4)", params![id, user, generation, now])?;
    tx.execute("INSERT INTO _auth_recovery_code_sets(credential_id,set_generation,reason,issued_at_ms) VALUES(?1,?2,?3,?4)", params![id, generation, reason, now])?;
    for (ordinal, digest) in digests.iter().enumerate() {
        tx.execute("INSERT INTO _auth_recovery_codes(set_credential_id,ordinal,code_digest,key_id) VALUES(?1,?2,?3,?4)", params![id, ordinal as u64, digest.as_slice(), key_id])?;
    }
    Ok(id)
}

impl LocalDatabase {
    /// @ref LLP 0214#53-sealed-invocation-authority — declared app inserts and the
    /// protected idempotency receipt commit in one host-only transaction.
    pub(crate) fn execute_verified_provisioning(
        &mut self,
        authority: &VerifiedProvisioningAuthority,
        inserts: &[ProvisioningInsert],
        now: u64,
    ) -> SnapbackResult<ProvisioningOutcome> {
        self.with_auth_transaction(|tx|{
            super::auth::require_identity_core_v3_on(tx)?;
            if let Some(existing)=tx.query_row("SELECT hook_digest FROM _auth_provisioning_receipts WHERE provisioning_key=?1",[&authority.provisioning_key],|r|r.get::<_,Vec<u8>>(0)).optional()?{
                if existing.as_slice()==authority.hook_digest{return Ok(ProvisioningOutcome::AlreadyCommitted);}
                return Err(auth_error("SNAPBACK_AUTH_PROVISIONING_REPLAY_MISMATCH","provisioning key was already used by a different hook digest"));
            }
            for insert in inserts{
                if !authority.declared_writes.contains(&insert.table){return Err(auth_error("SNAPBACK_AUTH_PROVISIONING_WRITE_FORBIDDEN","provisioning attempted an undeclared table"));}
                let table=quoted_identifier(&insert.table)?; if insert.columns.is_empty(){return Err(auth_error("SNAPBACK_AUTH_PROVISIONING_WRITE_FORBIDDEN","provisioning insert has no declared columns"));}
                let columns=insert.columns.iter().map(|(name,_)|quoted_identifier(name)).collect::<SnapbackResult<Vec<_>>>()?;
                let binds=(1..=columns.len()).map(|n|format!("?{n}")).collect::<Vec<_>>().join(",");
                let sql=format!("INSERT INTO {table}({}) VALUES({binds})",columns.join(","));
                tx.execute(&sql,rusqlite::params_from_iter(insert.columns.iter().map(|(_,value)|value)))?;
            }
            let app_commit_version=super::current_version_on(tx)?;
            tx.execute("INSERT INTO _auth_provisioning_receipts(provisioning_key,hook_id,hook_digest,user_id,identity_id,assurance_id,committed_at_ms,app_commit_version) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![authority.provisioning_key,authority.hook_id,authority.hook_digest.as_slice(),authority.user_id,authority.identity_id,authority.assurance_id,now,app_commit_version])?;
            journal(tx,&authority.user_id,"identity.provisioned",now)?;
            Ok(ProvisioningOutcome::Committed)
        })
    }
    /// @ref LLP 0214#81-guest-principal-and-session-creation — no caller-selected
    /// principal enters this atomic guest/session/assurance transition.
    pub(crate) fn identity_guest_create(
        &mut self,
        expires_at: u64,
        now: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IdentitySession> {
        let user = opaque_id("user");
        self.with_auth_transaction(|tx| {
            super::auth::require_identity_core_v3_on(tx)?;
            tx.execute("INSERT INTO _auth_users(id,created_at_ms,kind,guest_state,guest_expires_at_ms) VALUES(?1,?2,'human','active',?3)", params![user, now, expires_at])?;
            let (session, bearer) = insert_session(tx, &user, None, None, "guest", now, random)?;
            insert_assurance(tx, &user, &session, None, "authenticated", now, Some(expires_at))?;
            journal(tx, &user, "guest.created", now)?;
            Ok(IdentitySession { user_id: user, session_id: session, bearer, recovery_codes: None })
        })
    }

    pub(crate) fn identity_guest_claim_verified_email(
        &mut self,
        guest: &SessionBearer,
        proof: &VerifiedEmailClaim,
        now: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IdentitySession> {
        self.with_auth_transaction(|tx|{
            super::auth::require_identity_core_v3_on(tx)?;
            let user:Option<String>=tx.query_row("SELECT s.user_id FROM _auth_sessions s JOIN _auth_users u ON u.id=s.user_id WHERE s.token_hash=?1 AND s.revoked_at_ms IS NULL AND s.authn_source='guest' AND u.guest_state='active'",[guest.token_hash().as_bytes().as_slice()],|r|r.get(0)).optional()?;
            let user=user.ok_or_else(||auth_error("SNAPBACK_AUTH_GUEST_SESSION_INVALID","guest session is invalid"))?;
            if tx.query_row("SELECT user_id FROM _auth_identities WHERE provider='email-code' AND subject=?1",[proof.canonical.as_str()],|r|r.get::<_,String>(0)).optional()?.is_some_and(|owner|owner!=user){return Err(auth_error("SNAPBACK_AUTH_GUEST_CLAIM_COLLISION","guest claim collides with an existing principal"));}
            let identity=opaque_id("identity");
            tx.execute("INSERT INTO _auth_identities(id,user_id,kind,provider,subject,canonical_value,created_at_ms,verified_at_ms) VALUES(?1,?2,'email','email-code',?3,?3,?4,?4)",params![identity,user,proof.canonical.as_str(),now])?;
            tx.execute("UPDATE _auth_users SET guest_state='claimed',guest_expires_at_ms=NULL,guest_claimed_at_ms=?2 WHERE id=?1 AND guest_state='active'",params![user,now])?;
            tx.execute("UPDATE _auth_sessions SET revoked_at_ms=?2,generation=generation+1 WHERE user_id=?1 AND revoked_at_ms IS NULL",params![user,now])?;
            let(session,bearer)=insert_session(tx,&user,Some(&identity),None,"identity",now,random)?;
            insert_assurance(tx,&user,&session,None,"authenticated",now,Some(now+SESSION_IDLE_MS))?;
            tx.execute("INSERT INTO _auth_assurances(id,user_id,session_id,identity_id,credential_id,kind,provenance,issued_at_ms,expires_at_ms,governing_authority,revoked_at_ms) VALUES(?1,?2,?3,?4,NULL,'email_verified','delivery',?5,NULL,?6,NULL)",params![opaque_id("assurance"),user,session,identity,now,proof.governing_authority])?;
            journal(tx,&user,"guest.claimed",now)?; let _=&proof.event_id;
            Ok(IdentitySession{user_id:user,session_id:session,bearer,recovery_codes:None})
        })
    }

    /// Local-password claiming preserves the guest user id and refuses an
    /// existing username without merging or switching principals.
    pub(crate) fn identity_guest_claim_password(
        &mut self,
        guest: &SessionBearer,
        username: &str,
        password: &PasswordSecret,
        now: u64,
        random: &dyn RandomSource,
        recovery: RecoveryKeyMaterial<'_>,
    ) -> SnapbackResult<IdentitySession> {
        let identifier = canonical_password_identifier(
            self.identity_floor_password_identifier_mode()?,
            username,
        )?;
        let phc = hash_password(password, random)?; // intentionally outside writer lock
        let (codes, digests) = generate_recovery(random, recovery.key)?;
        self.with_auth_transaction(|tx| {
            super::auth::require_identity_core_v3_on(tx)?;
            require_same_password_identifier_mode(tx, identifier.mode)?;
            let row: Option<(String,String)> = tx.query_row("SELECT s.id,s.user_id FROM _auth_sessions s JOIN _auth_users u ON u.id=s.user_id WHERE s.token_hash=?1 AND s.revoked_at_ms IS NULL AND s.authn_source='guest' AND u.guest_state='active'", [guest.token_hash().as_bytes().as_slice()], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
            let (old_session, user) = row.ok_or_else(|| auth_error("SNAPBACK_AUTH_GUEST_SESSION_INVALID", "guest session is invalid"))?;
            if tx.query_row("SELECT 1 FROM _auth_identities WHERE provider='local-password' AND subject=?1", [&identifier.canonical], |_| Ok(())).optional()?.is_some() { return Err(auth_error("SNAPBACK_AUTH_GUEST_CLAIM_COLLISION", "guest claim collides with an existing principal")); }
            let identity = opaque_id("identity"); let credential = opaque_id("credential");
            tx.execute("INSERT INTO _auth_identities(id,user_id,kind,provider,subject,canonical_value,created_at_ms,verified_at_ms) VALUES(?1,?2,?3,'local-password',?4,?4,?5,?5)", params![identity,user,identifier.mode.identity_kind(),identifier.canonical,now])?;
            tx.execute("INSERT INTO _auth_credentials(id,user_id,kind,created_at_ms) VALUES(?1,?2,'password',?3)", params![credential,user,now])?;
            tx.execute("INSERT INTO _auth_password_credentials(credential_id,algorithm,hash_phc,policy_version,common_password_list_version,changed_at_ms) VALUES(?1,'argon2id',?2,?3,?4,?5)", params![credential,phc,PASSWORD_HASH_POLICY_V1.version,PASSWORD_HASH_POLICY_V1.common_password_list_version,now])?;
            insert_recovery_set(tx, &user, recovery.key_id, &digests, "initial", now)?;
            tx.execute("UPDATE _auth_users SET guest_state='claimed',guest_expires_at_ms=NULL,guest_claimed_at_ms=?2 WHERE id=?1 AND guest_state='active'", params![user,now])?;
            tx.execute("UPDATE _auth_sessions SET revoked_at_ms=?2,generation=generation+1 WHERE user_id=?1 AND revoked_at_ms IS NULL", params![user,now])?;
            let (session,bearer)=insert_session(tx,&user,None,Some(&credential),"credential",now,random)?;
            insert_assurance(tx,&user,&session,Some(&credential),"authenticated",now,Some(now+SESSION_IDLE_MS))?; insert_assurance(tx,&user,&session,Some(&credential),"recent_auth",now,Some(now+10*60*1_000))?;
            journal(tx,&user,"guest.claimed",now)?; let _=old_session;
            Ok(IdentitySession{user_id:user,session_id:session,bearer,recovery_codes:Some(codes)})
        })
    }

    pub(crate) fn identity_password_register(
        &mut self,
        username: &str,
        password: &PasswordSecret,
        now: u64,
        random: &dyn RandomSource,
        key_id: &str,
        recovery_key: &[u8; 32],
    ) -> SnapbackResult<IdentitySession> {
        let identifier = canonical_password_identifier(
            self.identity_floor_password_identifier_mode()?,
            username,
        )?;
        let phc = hash_password(password, random)?;
        let (codes, digests) = generate_recovery(random, recovery_key)?;
        self.with_auth_transaction(|tx| {
            super::auth::require_identity_core_v3_on(tx)?;
            require_same_password_identifier_mode(tx, identifier.mode)?;
            if tx.query_row("SELECT 1 FROM _auth_identities WHERE provider='local-password' AND subject=?1",[&identifier.canonical], |_| Ok(())).optional()?.is_some(){return Err(auth_error("SNAPBACK_AUTH_IDENTITY_COLLISION","identity already exists"));}
            let user=opaque_id("user"); let identity=opaque_id("identity"); let credential=opaque_id("credential");
            tx.execute("INSERT INTO _auth_users(id,created_at_ms,kind,guest_state) VALUES(?1,?2,'human','never')",params![user,now])?;
            tx.execute("INSERT INTO _auth_identities(id,user_id,kind,provider,subject,canonical_value,created_at_ms,verified_at_ms) VALUES(?1,?2,?3,'local-password',?4,?4,?5,?5)",params![identity,user,identifier.mode.identity_kind(),identifier.canonical,now])?;
            tx.execute("INSERT INTO _auth_credentials(id,user_id,kind,created_at_ms) VALUES(?1,?2,'password',?3)",params![credential,user,now])?;
            tx.execute("INSERT INTO _auth_password_credentials VALUES(?1,'argon2id',?2,?3,?4,?5)",params![credential,phc,PASSWORD_HASH_POLICY_V1.version,PASSWORD_HASH_POLICY_V1.common_password_list_version,now])?;
            insert_recovery_set(tx,&user,key_id,&digests,"initial",now)?;
            let(session,bearer)=insert_session(tx,&user,None,Some(&credential),"credential",now,random)?; insert_assurance(tx,&user,&session,Some(&credential),"authenticated",now,Some(now+SESSION_IDLE_MS))?; insert_assurance(tx,&user,&session,Some(&credential),"recent_auth",now,Some(now+600_000))?; journal(tx,&user,"password.account-created",now)?; journal(tx,&user,"recovery-codes.issued",now)?;
            Ok(IdentitySession{user_id:user,session_id:session,bearer,recovery_codes:Some(codes)})
        })
    }

    pub(crate) fn identity_password_set(
        &mut self,
        acting: &SessionBearer,
        username: &str,
        password: &PasswordSecret,
        now: u64,
        random: &dyn RandomSource,
        recovery: RecoveryKeyMaterial<'_>,
    ) -> SnapbackResult<IdentitySession> {
        let identifier = canonical_password_identifier(
            self.identity_floor_password_identifier_mode()?,
            username,
        )?;
        let phc = hash_password(password, random)?;
        let (codes, digests) = generate_recovery(random, recovery.key)?;
        self.with_auth_transaction(|tx| {
            super::auth::require_identity_core_v3_on(tx)?;
            require_same_password_identifier_mode(tx, identifier.mode)?;
            let user: String = tx.query_row(
                "SELECT s.user_id FROM _auth_sessions s JOIN _auth_users u ON u.id=s.user_id WHERE s.token_hash=?1 AND s.revoked_at_ms IS NULL AND s.expires_at_ms>?2 AND u.guest_state<>'active' AND u.deactivated_at_ms IS NULL",
                params![acting.token_hash().as_bytes().as_slice(), now],
                |row| row.get(0),
            ).map_err(|_| auth_error("SNAPBACK_AUTH_SESSION_INVALID", "session is invalid"))?;
            let collision = tx.query_row("SELECT user_id FROM _auth_identities WHERE provider='local-password' AND subject=?1", [&identifier.canonical], |row| row.get::<_,String>(0)).optional()?;
            if collision.is_some_and(|owner| owner != user) {
                return Err(auth_error("SNAPBACK_AUTH_IDENTITY_COLLISION", "identity already exists"));
            }
            let live: u64 = tx.query_row("SELECT COUNT(*) FROM _auth_credentials WHERE user_id=?1 AND kind='password' AND revoked_at_ms IS NULL", [&user], |row| row.get(0))?;
            if live != 0 { return Err(auth_error("SNAPBACK_AUTH_PASSWORD_ALREADY_SET", "principal already has a password")); }
            let identity=opaque_id("identity"); let credential=opaque_id("credential");
            tx.execute("INSERT INTO _auth_identities(id,user_id,kind,provider,subject,canonical_value,created_at_ms,verified_at_ms) VALUES(?1,?2,?3,'local-password',?4,?4,?5,?5)",params![identity,user,identifier.mode.identity_kind(),identifier.canonical,now])?;
            tx.execute("INSERT INTO _auth_credentials(id,user_id,kind,created_at_ms) VALUES(?1,?2,'password',?3)",params![credential,user,now])?;
            tx.execute("INSERT INTO _auth_password_credentials VALUES(?1,'argon2id',?2,?3,?4,?5)",params![credential,phc,PASSWORD_HASH_POLICY_V1.version,PASSWORD_HASH_POLICY_V1.common_password_list_version,now])?;
            insert_recovery_set(tx,&user,recovery.key_id,&digests,"initial",now)?;
            tx.execute("UPDATE _auth_sessions SET revoked_at_ms=?2,generation=generation+1 WHERE user_id=?1 AND revoked_at_ms IS NULL",params![user,now])?;
            let(session,bearer)=insert_session(tx,&user,None,Some(&credential),"credential",now,random)?;
            insert_assurance(tx,&user,&session,Some(&credential),"authenticated",now,Some(now+SESSION_IDLE_MS))?; insert_assurance(tx,&user,&session,Some(&credential),"recent_auth",now,Some(now+600_000))?; journal(tx,&user,"password.set",now)?;
            Ok(IdentitySession{user_id:user,session_id:session,bearer,recovery_codes:Some(codes)})
        })
    }

    pub(crate) fn identity_reap_guests_default_tombstone(
        &mut self,
        now: u64,
    ) -> SnapbackResult<u64> {
        self.with_auth_transaction(|tx|{
            super::auth::require_identity_core_v3_on(tx)?;
            let mut stmt=tx.prepare("SELECT id FROM _auth_users WHERE guest_state='active' AND guest_expires_at_ms<=?1 ORDER BY id")?;
            let users=stmt.query_map([now],|row|row.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?; drop(stmt);
            for user in &users { tx.execute("UPDATE _auth_sessions SET revoked_at_ms=?2,generation=generation+1 WHERE user_id=?1 AND revoked_at_ms IS NULL",params![user,now])?; tx.execute("UPDATE _auth_users SET guest_state='reaped',guest_expires_at_ms=NULL WHERE id=?1 AND guest_state='active'",[user])?; journal(tx,user,"guest.reaped",now)?; }
            Ok(users.len() as u64)
        })
    }

    fn password_snapshot(&self, username: &str) -> SnapbackResult<Option<PasswordSnapshot>> {
        let identifier = canonical_password_identifier(
            self.identity_floor_password_identifier_mode()?,
            username,
        )?;
        self.with_auth_read(|conn| { super::auth::require_identity_core_v3_on(conn)?; require_same_password_identifier_mode(conn, identifier.mode)?; Ok(conn.query_row("SELECT i.user_id,i.id,c.id,c.generation,p.hash_phc FROM _auth_identities i JOIN _auth_credentials c ON c.user_id=i.user_id AND c.kind='password' AND c.revoked_at_ms IS NULL JOIN _auth_password_credentials p ON p.credential_id=c.id JOIN _auth_users u ON u.id=i.user_id WHERE i.provider='local-password' AND i.subject=?1 AND i.disabled_at_ms IS NULL AND u.deactivated_at_ms IS NULL",[identifier.canonical],|r|Ok(PasswordSnapshot{user_id:r.get(0)?,identity_id:r.get(1)?,credential_id:r.get(2)?,generation:r.get(3)?,hash_phc:r.get(4)?,identifier_mode:identifier.mode})).optional()?) })
    }

    pub(crate) fn identity_password_authenticate(
        &mut self,
        username: &str,
        password: &PasswordSecret,
        now: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IdentitySession> {
        let snapshot = self.password_snapshot(username)?;
        let valid = verify_password(
            password,
            snapshot
                .as_ref()
                .map_or(DUMMY_PASSWORD_PHC, |s| s.hash_phc.as_str()),
        );
        if !valid {
            return Err(auth_error(
                "SNAPBACK_AUTH_CREDENTIAL_INVALID",
                "credential is invalid",
            ));
        }
        let s = snapshot.unwrap();
        let _upgrade_on_verify_required = password_hash_needs_upgrade(&s.hash_phc);
        // A later lane prepares the replacement hash here, still outside the
        // writer lock, then swaps it below only if `s.generation` remains the
        // exact predecessor.
        self.with_auth_transaction(|tx| { super::auth::require_identity_core_v3_on(tx)?; require_same_password_identifier_mode(tx, s.identifier_mode)?; let current:Option<(u64,String)>=tx.query_row("SELECT c.generation,p.hash_phc FROM _auth_credentials c JOIN _auth_password_credentials p ON p.credential_id=c.id WHERE c.id=?1 AND c.user_id=?2 AND c.revoked_at_ms IS NULL",params![s.credential_id,s.user_id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?; if current.as_ref()!=Some(&(s.generation,s.hash_phc.clone())) { return Err(auth_error("SNAPBACK_AUTH_CREDENTIAL_INVALID","credential is invalid")); } let(session,bearer)=insert_session(tx,&s.user_id,None,Some(&s.credential_id),"credential",now,random)?; tx.execute("UPDATE _auth_credentials SET last_used_at_ms=?2 WHERE id=?1",params![s.credential_id,now])?; insert_assurance(tx,&s.user_id,&session,Some(&s.credential_id),"authenticated",now,Some(now+SESSION_IDLE_MS))?; insert_assurance(tx,&s.user_id,&session,Some(&s.credential_id),"recent_auth",now,Some(now+600_000))?; journal(tx,&s.user_id,"password.authenticated",now)?; Ok(IdentitySession{user_id:s.user_id,session_id:session,bearer,recovery_codes:None}) })
    }

    pub(crate) fn identity_password_change(
        &mut self,
        username: &str,
        current: &PasswordSecret,
        replacement: &PasswordSecret,
        now: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IdentitySession> {
        let snapshot = self.password_snapshot(username)?;
        if !snapshot
            .as_ref()
            .is_some_and(|s| verify_password(current, &s.hash_phc))
        {
            return Err(auth_error(
                "SNAPBACK_AUTH_CREDENTIAL_INVALID",
                "credential is invalid",
            ));
        }
        let new_phc = hash_password(replacement, random)?;
        let s = snapshot.unwrap();
        self.with_auth_transaction(|tx|{super::auth::require_identity_core_v3_on(tx)?; require_same_password_identifier_mode(tx, s.identifier_mode)?; let changed=tx.execute("UPDATE _auth_password_credentials SET hash_phc=?2,policy_version=?3,common_password_list_version=?4,changed_at_ms=?5 WHERE credential_id=?1 AND hash_phc=?6",params![s.credential_id,new_phc,PASSWORD_HASH_POLICY_V1.version,PASSWORD_HASH_POLICY_V1.common_password_list_version,now,s.hash_phc])?; if changed!=1{return Err(auth_error("SNAPBACK_AUTH_CREDENTIAL_INVALID","credential is invalid"));} let generation_changed=tx.execute("UPDATE _auth_credentials SET generation=generation+1 WHERE id=?1 AND generation=?2",params![s.credential_id,s.generation])?; if generation_changed!=1{return Err(auth_error("SNAPBACK_AUTH_CREDENTIAL_INVALID","credential is invalid"));} tx.execute("UPDATE _auth_sessions SET revoked_at_ms=?2,generation=generation+1 WHERE user_id=?1 AND revoked_at_ms IS NULL",params![s.user_id,now])?; let(session,bearer)=insert_session(tx,&s.user_id,None,Some(&s.credential_id),"credential",now,random)?; insert_assurance(tx,&s.user_id,&session,Some(&s.credential_id),"authenticated",now,Some(now+SESSION_IDLE_MS))?; insert_assurance(tx,&s.user_id,&session,Some(&s.credential_id),"recent_auth",now,Some(now+600_000))?; journal(tx,&s.user_id,"password.changed",now)?; Ok(IdentitySession{user_id:s.user_id,session_id:session,bearer,recovery_codes:None})})
    }

    pub(crate) fn identity_recovery_rotate(
        &mut self,
        user: &str,
        now: u64,
        random: &dyn RandomSource,
        key_id: &str,
        key: &[u8; 32],
    ) -> SnapbackResult<RecoveryCodes> {
        let (codes, digests) = generate_recovery(random, key)?;
        self.with_auth_transaction(|tx|{super::auth::require_identity_core_v3_on(tx)?;insert_recovery_set(tx,user,key_id,&digests,"suspected-disclosure",now)?;tx.execute("UPDATE _auth_sessions SET revoked_at_ms=?2,generation=generation+1 WHERE user_id=?1 AND revoked_at_ms IS NULL",params![user,now])?;journal(tx,user,"recovery-codes.rotated",now)?;Ok(codes)})
    }

    pub(crate) fn identity_recovery_consume(
        &mut self,
        username: &str,
        code: &str,
        now: u64,
        random: &dyn RandomSource,
        key_id: &str,
        key: &[u8; 32],
    ) -> SnapbackResult<IdentitySession> {
        let identifier = canonical_password_identifier(
            self.identity_floor_password_identifier_mode()?,
            username,
        )?;
        let digest = recovery_digest(key, code);
        let (codes, digests) = generate_recovery(random, key)?;
        let candidates = self.with_auth_read(|conn| {
            super::auth::require_identity_core_v3_on(conn)?;
            require_same_password_identifier_mode(conn, identifier.mode)?;
            let mut stmt = conn.prepare(
                "SELECT i.user_id,r.set_credential_id,r.ordinal,r.code_digest
                 FROM _auth_identities i
                 JOIN _auth_credentials c
                   ON c.user_id=i.user_id
                  AND c.kind='recovery-code-set'
                  AND c.revoked_at_ms IS NULL
                 JOIN _auth_recovery_codes r ON r.set_credential_id=c.id
                 JOIN _auth_recovery_code_sets s
                   ON s.credential_id=c.id AND s.replaced_at_ms IS NULL
                 WHERE i.provider='local-password'
                   AND i.subject=?1
                   AND r.key_id=?2
                   AND r.consumed_at_ms IS NULL
                 ORDER BY r.ordinal",
            )?;
            stmt.query_map(params![identifier.canonical, key_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, Vec<u8>>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
        })?;
        let mut matched = None;
        let mut comparison_count = 0_u64;
        for (user, set, ordinal, stored) in candidates {
            let candidate = <[u8; 32]>::try_from(stored.as_slice()).unwrap_or([0; 32]);
            comparison_count += 1;
            if bool::from(candidate.ct_eq(&digest)) {
                matched = Some((user, set, ordinal));
            }
        }
        if comparison_count == 0 {
            let _ = bool::from(<[u8; 32]>::default().ct_eq(&digest));
        }
        let (user, set, ordinal) = matched.ok_or_else(|| {
            auth_error(
                "SNAPBACK_AUTH_RECOVERY_CODE_INVALID",
                "recovery code is invalid",
            )
        })?;
        self.with_auth_transaction(|tx|{super::auth::require_identity_core_v3_on(tx)?;require_same_password_identifier_mode(tx,identifier.mode)?;let changed=tx.execute("UPDATE _auth_recovery_codes SET consumed_at_ms=?4 WHERE set_credential_id=?1 AND ordinal=?2 AND code_digest=?3 AND consumed_at_ms IS NULL",params![set,ordinal,digest.as_slice(),now])?;if changed!=1{return Err(auth_error("SNAPBACK_AUTH_RECOVERY_CODE_INVALID","recovery code is invalid"));}let successor=insert_recovery_set(tx,&user,key_id,&digests,"after-use",now)?;tx.execute("UPDATE _auth_sessions SET revoked_at_ms=?2,generation=generation+1 WHERE user_id=?1 AND revoked_at_ms IS NULL",params![user,now])?;let(session,bearer)=insert_session(tx,&user,None,Some(&successor),"credential",now,random)?;insert_assurance(tx,&user,&session,Some(&successor),"authenticated",now,Some(now+SESSION_IDLE_MS))?;insert_assurance(tx,&user,&session,Some(&successor),"recent_auth",now,Some(now+600_000))?;journal(tx,&user,"recovery-code.used",now)?;Ok(IdentitySession{user_id:user,session_id:session,bearer,recovery_codes:Some(codes)})})
    }

    pub(crate) fn identity_revoke_password(&mut self, user: &str, now: u64) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx|{super::auth::require_identity_core_v3_on(tx)?;let usable:u64=tx.query_row("SELECT COUNT(*) FROM _auth_recovery_codes r JOIN _auth_credentials c ON c.id=r.set_credential_id JOIN _auth_recovery_code_sets s ON s.credential_id=c.id WHERE c.user_id=?1 AND c.revoked_at_ms IS NULL AND s.replaced_at_ms IS NULL AND r.consumed_at_ms IS NULL",[user],|r|r.get(0))?;if usable==0{return Err(auth_error("SNAPBACK_AUTH_LAST_AUTHENTICATOR","cannot remove the last usable authenticator"));}tx.execute("UPDATE _auth_credentials SET revoked_at_ms=?2 WHERE user_id=?1 AND kind='password' AND revoked_at_ms IS NULL",params![user,now])?;Ok(())})
    }

    pub(crate) fn identity_claims(
        &self,
        session_id: &str,
        now: u64,
    ) -> SnapbackResult<AuthClaimsProjection> {
        self.with_auth_read(|conn|{super::auth::require_identity_core_v3_on(conn)?;let user:String=conn.query_row("SELECT user_id FROM _auth_sessions WHERE id=?1 AND revoked_at_ms IS NULL AND expires_at_ms>?2",params![session_id,now],|r|r.get(0))?;let mut identities=vec![];let mut stmt=conn.prepare("SELECT kind,provider,issuer,subject,canonical_value FROM _auth_identities WHERE user_id=?1 AND disabled_at_ms IS NULL ORDER BY kind,provider,subject")?;for row in stmt.query_map([&user],|r|Ok(ClaimsIdentity{kind:r.get(0)?,provider_key:r.get(1)?,issuer:r.get(2)?,subject:r.get(3)?,value:r.get(4)?}))?{identities.push(row?);}let mut assurances=vec![];let mut stmt=conn.prepare("SELECT kind,provenance,issued_at_ms,expires_at_ms,governing_authority FROM _auth_assurances WHERE user_id=?1 AND session_id=?2 AND revoked_at_ms IS NULL AND (expires_at_ms IS NULL OR expires_at_ms>?3)")?;for row in stmt.query_map(params![user,session_id,now],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get(2)?,r.get(3)?,r.get(4)?)))?{let(k,p,issued,expires,governing)=row?;let kind=match k.as_str(){"authenticated"=>AssuranceKind::Authenticated,"email_verified"=>AssuranceKind::EmailVerified,"phone_verified"=>AssuranceKind::PhoneVerified,"recent_auth"=>AssuranceKind::RecentAuth,_=>AssuranceKind::PhishingResistant};let provenance=match p.as_str(){"session"=>AssuranceProvenance::Session,"credential"=>AssuranceProvenance::Credential,"delivery"=>AssuranceProvenance::Delivery,"federation"=>AssuranceProvenance::Federation,"import"=>AssuranceProvenance::Import,_=>AssuranceProvenance::Rehearsal};assurances.push(AssuranceRecord{kind,provenance,issued_at:issued,expires_at:expires,governing_authority:governing});}Ok(AuthClaimsProjection::server_derived(identities,assurances))})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::{CryptoError, RandomSource};
    use std::sync::atomic::{AtomicU64, Ordering};

    struct CounterRandom(AtomicU64);
    impl CounterRandom {
        fn new() -> Self {
            Self(AtomicU64::new(1))
        }
    }
    impl RandomSource for CounterRandom {
        fn fill(&self, out: &mut [u8]) -> Result<(), CryptoError> {
            let call = self.0.fetch_add(1, Ordering::Relaxed);
            for (index, byte) in out.iter_mut().enumerate() {
                *byte = call.wrapping_mul(31).wrapping_add(index as u64) as u8;
            }
            Ok(())
        }
    }
    fn ready() -> LocalDatabase {
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog().unwrap();
        db
    }
    fn ready_with_mode(mode: PasswordIdentifierMode) -> LocalDatabase {
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog_with_password_identifier_mode(mode)
            .unwrap();
        db
    }
    fn password(value: &str) -> PasswordSecret {
        PasswordSecret::new(value.into())
    }

    #[test]
    fn guest_create_claim_is_continuous_and_collision_is_atomic() {
        let random = CounterRandom::new();
        let key = [7; 32];
        let mut db = ready();
        let existing = db
            .identity_password_register(
                "taken",
                &password("strong-existing-secret-1"),
                1,
                &random,
                "key-1",
                &key,
            )
            .unwrap();
        let guest = db.identity_guest_create(50_000, 2, &random).unwrap();
        let error = db
            .identity_guest_claim_password(
                &guest.bearer,
                "taken",
                &password("strong-guest-secret-22"),
                3,
                &random,
                RecoveryKeyMaterial::new("key-1", &key),
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_GUEST_CLAIM_COLLISION");
        let claimed = db
            .identity_guest_claim_password(
                &guest.bearer,
                "new-name",
                &password("strong-guest-secret-22"),
                4,
                &random,
                RecoveryKeyMaterial::new("key-1", &key),
            )
            .unwrap();
        assert_eq!(claimed.user_id, guest.user_id);
        assert_ne!(claimed.user_id, existing.user_id);

        let email_guest = db.identity_guest_create(50_000, 4, &random).unwrap();
        let proof =
            prepare_verified_email_claim("Verified@Example.com", "event-1", "email-code:built-in")
                .unwrap();
        let email_claimed = db
            .identity_guest_claim_verified_email(&email_guest.bearer, &proof, 5, &random)
            .unwrap();
        assert_eq!(email_claimed.user_id, email_guest.user_id);
        let collision_guest = db.identity_guest_create(50_000, 5, &random).unwrap();
        assert_eq!(
            db.identity_guest_claim_verified_email(&collision_guest.bearer, &proof, 6, &random)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_GUEST_CLAIM_COLLISION"
        );

        let settable = db.identity_guest_create(60, 7, &random).unwrap();
        db.with_auth_transaction(|tx|{tx.execute("UPDATE _auth_users SET guest_state='claimed',guest_expires_at_ms=NULL,guest_claimed_at_ms=7 WHERE id=?1",[&settable.user_id])?;Ok(())}).unwrap();
        let set = db
            .identity_password_set(
                &settable.bearer,
                "set-name",
                &password("strong-password-set-123"),
                8,
                &random,
                RecoveryKeyMaterial::new("key-1", &key),
            )
            .unwrap();
        assert_eq!(set.user_id, settable.user_id);

        let reapable = db.identity_guest_create(8, 7, &random).unwrap();
        assert_eq!(db.identity_reap_guests_default_tombstone(9).unwrap(), 1);
        assert_eq!(
            db.identity_guest_claim_password(
                &reapable.bearer,
                "too-late",
                &password("strong-too-late-secret"),
                10,
                &random,
                RecoveryKeyMaterial::new("key-1", &key)
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_GUEST_SESSION_INVALID"
        );
    }

    #[test]
    fn password_auth_change_recovery_rotation_and_claims_floor() {
        let random = CounterRandom::new();
        let key = [9; 32];
        let mut db = ready();
        let registered = db
            .identity_password_register(
                "Person",
                &password("strong-register-secret-1"),
                10,
                &random,
                "key-1",
                &key,
            )
            .unwrap();
        assert_eq!(
            db.identity_password_authenticate(
                "missing",
                &password("strong-register-secret-1"),
                11,
                &random
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_CREDENTIAL_INVALID"
        );
        let authenticated = db
            .identity_password_authenticate(
                "person",
                &password("strong-register-secret-1"),
                12,
                &random,
            )
            .unwrap();
        let claims = db.identity_claims(&authenticated.session_id, 12).unwrap();
        assert_eq!(claims.identities[0].provider_key, "local-password");
        assert_eq!(
            claims.assurances[0].provenance,
            AssuranceProvenance::Credential
        );
        db.identity_password_change(
            "person",
            &password("strong-register-secret-1"),
            &password("strong-replacement-secret-2"),
            13,
            &random,
        )
        .unwrap();
        assert_eq!(
            db.identity_password_authenticate(
                "person",
                &password("strong-register-secret-1"),
                14,
                &random
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_CREDENTIAL_INVALID"
        );
        let first_code = registered.recovery_codes.as_ref().unwrap().expose_once()[0].clone();
        let recovered = db
            .identity_recovery_consume("person", &first_code, 15, &random, "key-1", &key)
            .unwrap();
        assert!(recovered.recovery_codes.is_some());
        assert_eq!(
            db.identity_recovery_consume("person", &first_code, 16, &random, "key-1", &key)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_RECOVERY_CODE_INVALID"
        );
        assert_eq!(
            db.identity_recovery_rotate(&registered.user_id, 17, &random, "key-1", &key)
                .unwrap()
                .expose_once()
                .len(),
            RECOVERY_COUNT
        );
    }

    #[test]
    fn email_v1_is_provider_scoped_and_never_confers_email_verified_assurance() {
        let random = CounterRandom::new();
        let key = [11; 32];
        let mut db = ready_with_mode(PasswordIdentifierMode::EmailV1);
        let registered = db
            .identity_password_register(
                "  TÉST@Example.COM  ",
                &password("strong-email-password-1"),
                10,
                &random,
                "key-1",
                &key,
            )
            .unwrap();
        assert_eq!(
            db.identity_password_register(
                "te\u{301}st@example.com",
                &password("strong-email-password-2"),
                11,
                &random,
                "key-1",
                &key,
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_IDENTITY_COLLISION"
        );
        let authenticated = db
            .identity_password_authenticate(
                "TÉST@EXAMPLE.COM",
                &password("strong-email-password-1"),
                12,
                &random,
            )
            .unwrap();
        let claims = db.identity_claims(&authenticated.session_id, 12).unwrap();
        let local = claims
            .identities
            .iter()
            .find(|identity| identity.provider_key == "local-password")
            .unwrap();
        assert_eq!(local.kind, "email");
        assert_eq!(local.subject, "tést@example.com");
        assert!(
            claims
                .assurances
                .iter()
                .all(|assurance| assurance.kind != AssuranceKind::EmailVerified),
            "password possession must not create email-verified assurance"
        );
        let (local_verified_at, local_user): (u64, String) = db
            .with_auth_read(|conn| {
                Ok(conn.query_row(
                    "SELECT verified_at_ms,user_id FROM _auth_identities
                     WHERE provider='local-password' AND subject='tést@example.com'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?)
            })
            .unwrap();
        assert_eq!(
            local_verified_at, 10,
            "local verified_at is creation time only"
        );
        assert_eq!(local_user, registered.user_id);

        let email_guest = db.identity_guest_create(50_000, 13, &random).unwrap();
        let proof = prepare_verified_email_claim(
            "TE\u{301}ST@example.com",
            "email-event-1",
            "email-code:built-in",
        )
        .unwrap();
        let email_claimed = db
            .identity_guest_claim_verified_email(&email_guest.bearer, &proof, 14, &random)
            .expect("local-password identity must not satisfy email-code lookup");
        assert_ne!(email_claimed.user_id, registered.user_id);
        let providers = db
            .with_auth_read(|conn| {
                let mut statement = conn.prepare(
                    "SELECT provider,user_id FROM _auth_identities
                     WHERE subject='tést@example.com' ORDER BY provider",
                )?;
                Ok(statement
                    .query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?)
            })
            .unwrap();
        assert_eq!(providers.len(), 2);
        assert_eq!(providers[0].0, "email-code");
        assert_eq!(providers[0].1, email_claimed.user_id);
        assert_eq!(providers[1].0, "local-password");
        assert_eq!(providers[1].1, registered.user_id);

        assert_eq!(
            db.identity_password_authenticate(
                "not-an-email",
                &password("strong-email-password-1"),
                15,
                &random,
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_INVALID"
        );
    }

    #[test]
    fn password_hash_policy_v1_is_explicit_in_every_new_phc() {
        let phc =
            hash_password(&password("strong-policy-password-1"), &CounterRandom::new()).unwrap();
        let hash = PasswordHash::new(&phc).unwrap();
        let params = Params::try_from(&hash).unwrap();
        assert_eq!(hash.algorithm.as_str(), "argon2id");
        assert_eq!(hash.version, Some(19));
        assert_eq!(params.m_cost(), 19_456);
        assert_eq!(params.t_cost(), 2);
        assert_eq!(params.p_cost(), 1);
        assert_eq!(params.output_len(), Some(32));
        assert_eq!(hash.salt.as_ref().unwrap().len(), 16);
        assert_eq!(hash.hash.as_ref().unwrap().len(), 32);
        assert!(!password_hash_needs_upgrade(&phc));
        assert!(!password_hash_needs_upgrade(DUMMY_PASSWORD_PHC));
    }

    #[test]
    fn last_authenticator_refusal_rolls_back() {
        let random = CounterRandom::new();
        let key = [3; 32];
        let mut db = ready();
        let account = db
            .identity_password_register(
                "sole",
                &password("strong-sole-secret-123"),
                1,
                &random,
                "key-1",
                &key,
            )
            .unwrap();
        db.with_auth_transaction(|tx| { tx.execute("UPDATE _auth_credentials SET revoked_at_ms=2 WHERE user_id=?1 AND kind='recovery-code-set'",[&account.user_id])?; Ok(()) }).unwrap();
        assert_eq!(
            db.identity_revoke_password(&account.user_id, 3)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_LAST_AUTHENTICATOR"
        );
        assert!(
            db.identity_password_authenticate(
                "sole",
                &password("strong-sole-secret-123"),
                4,
                &random
            )
            .is_ok()
        );
    }

    #[test]
    fn verified_provisioning_is_sealed_idempotent_and_atomic() {
        let random = CounterRandom::new();
        let key = [4; 32];
        let mut db = ready();
        let account = db
            .identity_password_register(
                "provision",
                &password("strong-provision-secret-1"),
                1,
                &random,
                "key-1",
                &key,
            )
            .unwrap();
        let (identity, assurance) = db
            .with_auth_read(|conn| {
                Ok((
                    conn.query_row(
                        "SELECT id FROM _auth_identities WHERE user_id=?1",
                        [&account.user_id],
                        |r| r.get::<_, String>(0),
                    )?,
                    conn.query_row(
                        "SELECT id FROM _auth_assurances WHERE user_id=?1 ORDER BY id LIMIT 1",
                        [&account.user_id],
                        |r| r.get::<_, String>(0),
                    )?,
                ))
            })
            .unwrap();
        db.with_auth_transaction(|tx| {
            tx.execute_batch("CREATE TABLE profile(id TEXT PRIMARY KEY, owner TEXT NOT NULL)")?;
            Ok(())
        })
        .unwrap();
        let authority = prepare_verified_provisioning(
            "hook-1",
            [1; 32],
            "provision-1",
            &account.user_id,
            &identity,
            &assurance,
            ["profile".into()],
        )
        .unwrap();
        let insert = ProvisioningInsert {
            table: "profile".into(),
            columns: vec![
                ("id".into(), "p1".into()),
                ("owner".into(), account.user_id.clone()),
            ],
        };
        assert_eq!(
            db.execute_verified_provisioning(&authority, &[insert], 2)
                .unwrap(),
            ProvisioningOutcome::Committed
        );
        assert_eq!(
            db.execute_verified_provisioning(&authority, &[], 3)
                .unwrap(),
            ProvisioningOutcome::AlreadyCommitted
        );
        let mismatch = prepare_verified_provisioning(
            "hook-1",
            [2; 32],
            "provision-1",
            &account.user_id,
            &identity,
            &assurance,
            ["profile".into()],
        )
        .unwrap();
        assert_eq!(
            db.execute_verified_provisioning(&mismatch, &[], 4)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_PROVISIONING_REPLAY_MISMATCH"
        );
        let atomic = prepare_verified_provisioning(
            "hook-1",
            [3; 32],
            "provision-atomic",
            &account.user_id,
            &identity,
            &assurance,
            ["profile".into()],
        )
        .unwrap();
        let first = ProvisioningInsert {
            table: "profile".into(),
            columns: vec![
                ("id".into(), "p2".into()),
                ("owner".into(), account.user_id.clone()),
            ],
        };
        let duplicate = ProvisioningInsert {
            table: "profile".into(),
            columns: vec![
                ("id".into(), "p2".into()),
                ("owner".into(), account.user_id.clone()),
            ],
        };
        assert!(
            db.execute_verified_provisioning(&atomic, &[first, duplicate], 5)
                .is_err()
        );
        let count: u64 = db
            .with_auth_read(|conn| {
                Ok(
                    conn.query_row("SELECT COUNT(*) FROM profile WHERE id='p2'", [], |r| {
                        r.get(0)
                    })?,
                )
            })
            .unwrap();
        assert_eq!(count, 0);
    }
}
