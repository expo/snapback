//! Manifest-activated integration registration records.
//!
//! Integration identity remains a `kind = 'agent'` row in `_auth_users`.
//! This companion catalog records only the public registration and its
//! reversible admission state; installation authority remains an LLP 0055
//! delegated grant proven by its approved pairing request.

use super::{LocalDatabase, SnapbackResult};
use crate::diagnostic::SnapbackError;
use crate::manifest::SchemaManifest;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest as _, Sha256};
use subtle::ConstantTimeEq as _;
use zeroize::Zeroizing;

pub const INTEGRATION_RECORD_TABLE: &str = "_snapback_integration_records";
pub const OAUTH_AUTHORIZATION_TABLE: &str = "_snapback_oauth_authorizations";
const MAX_DISPLAY_NAME_BYTES: usize = 200;
const MAX_ORIGIN_BYTES: usize = 2_048;
const MAX_REDIRECT_URIS: usize = 16;
const MAX_REDIRECT_URI_BYTES: usize = 2_048;
const MAX_REDIRECT_URIS_JSON_BYTES: usize = 16 * 1_024;
const MAX_PROVENANCE_BYTES: usize = 16 * 1_024;
pub const OAUTH_AUTHORIZATION_REQUEST_TTL_MS: u64 = 10 * 60 * 1_000;
pub const OAUTH_AUTHORIZATION_CODE_TTL_MS: u64 = 60 * 1_000;
pub const OAUTH_BEARER_TOKEN_TTL_MS: u64 = 15 * 60 * 1_000;

const RECORD_TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS _snapback_integration_records (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 64),
  principal_user_id TEXT NOT NULL UNIQUE CHECK(length(principal_user_id) BETWEEN 1 AND 64),
  display_name TEXT CHECK(display_name IS NULL OR length(CAST(display_name AS BLOB)) <= 200),
  origin TEXT CHECK(origin IS NULL OR length(CAST(origin AS BLOB)) <= 2048),
  redirect_uris_json TEXT CHECK(redirect_uris_json IS NULL OR length(CAST(redirect_uris_json AS BLOB)) <= 16384),
  status TEXT NOT NULL CHECK(status IN ('active', 'suspended', 'revoked')),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms BETWEEN created_at_ms AND 9007199254740991),
  provenance TEXT NOT NULL CHECK(length(CAST(provenance AS BLOB)) BETWEEN 1 AND 16384),
  owner_claim_state TEXT NOT NULL CHECK(owner_claim_state IN ('provisional', 'unclaimed', 'claimed')),
  FOREIGN KEY(principal_user_id) REFERENCES _auth_users(id) ON DELETE RESTRICT
);
"#;

const STATUS_INDEX_SQL: &str = r#"
CREATE INDEX IF NOT EXISTS _snapback_integration_records_status
  ON _snapback_integration_records(status, principal_user_id);
"#;

const OAUTH_AUTHORIZATION_TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS _snapback_oauth_authorizations (
  request_id TEXT NOT NULL PRIMARY KEY CHECK(length(request_id) BETWEEN 1 AND 128),
  client_id TEXT NOT NULL CHECK(length(client_id) BETWEEN 1 AND 64),
  principal_user_id TEXT NOT NULL CHECK(length(principal_user_id) BETWEEN 1 AND 64),
  consenting_user_id TEXT NOT NULL CHECK(length(consenting_user_id) BETWEEN 1 AND 64),
  redirect_uri TEXT NOT NULL CHECK(length(CAST(redirect_uri AS BLOB)) BETWEEN 1 AND 2048),
  code_challenge TEXT NOT NULL CHECK(length(code_challenge) = 43),
  bundle_names_json TEXT NOT NULL CHECK(length(CAST(bundle_names_json AS BLOB)) BETWEEN 2 AND 16384),
  oauth_state TEXT CHECK(oauth_state IS NULL OR length(CAST(oauth_state AS BLOB)) <= 2048),
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'exchanged', 'denied')),
  code_hash BLOB CHECK(code_hash IS NULL OR length(code_hash) = 32),
  grant_id TEXT,
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms > created_at_ms AND expires_at_ms <= 9007199254740991),
  code_expires_at_ms INTEGER CHECK(code_expires_at_ms IS NULL OR (code_expires_at_ms > created_at_ms AND code_expires_at_ms <= 9007199254740991)),
  consumed_at_ms INTEGER CHECK(consumed_at_ms IS NULL OR (consumed_at_ms >= created_at_ms AND consumed_at_ms <= 9007199254740991)),
  FOREIGN KEY(client_id) REFERENCES _snapback_integration_records(id) ON DELETE RESTRICT,
  FOREIGN KEY(principal_user_id) REFERENCES _auth_users(id) ON DELETE RESTRICT,
  FOREIGN KEY(consenting_user_id) REFERENCES _auth_users(id) ON DELETE RESTRICT,
  FOREIGN KEY(request_id) REFERENCES _auth_pairing_requests(id) ON DELETE RESTRICT,
  FOREIGN KEY(grant_id) REFERENCES _auth_grants(id) ON DELETE RESTRICT
);
"#;

const OAUTH_AUTHORIZATION_EXPIRY_INDEX_SQL: &str = r#"
CREATE INDEX IF NOT EXISTS _snapback_oauth_authorizations_expiry
  ON _snapback_oauth_authorizations(status, expires_at_ms, code_expires_at_ms);
"#;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentRegistrationClass {
    #[default]
    Agent,
    Integration,
}

impl AgentRegistrationClass {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Integration => "integration",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IntegrationStatus {
    Active,
    Suspended,
    Revoked,
}

impl IntegrationStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Suspended => "suspended",
            Self::Revoked => "revoked",
        }
    }

    fn parse(value: &str) -> SnapbackResult<Self> {
        match value {
            "active" => Ok(Self::Active),
            "suspended" => Ok(Self::Suspended),
            "revoked" => Ok(Self::Revoked),
            _ => Err(integration_state_corrupt()),
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct IntegrationRegistrationFacts {
    pub origin: Option<String>,
    pub redirect_uris: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegrationRecord {
    pub integration_id: String,
    pub principal_user_id: String,
    pub status: IntegrationStatus,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationAdminRecord {
    pub integration_id: String,
    pub principal_user_id: String,
    pub display_name: Option<String>,
    pub status: String,
    pub owner_claim_state: String,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OAuthIntegrationClient {
    pub client_id: String,
    pub principal_user_id: String,
    pub display_name: Option<String>,
    pub redirect_uris: Vec<String>,
    pub status: IntegrationStatus,
}

pub struct OAuthAuthorizationCode(Zeroizing<String>);

impl OAuthAuthorizationCode {
    fn generate(random: &dyn crate::auth::crypto::RandomSource) -> SnapbackResult<Self> {
        let mut bytes = [0_u8; 32];
        random.fill(&mut bytes).map_err(|_| oauth_server_error())?;
        let code = format!("sboac_{}", URL_SAFE_NO_PAD.encode(bytes));
        bytes.fill(0);
        Ok(Self(Zeroizing::new(code)))
    }

    pub fn expose_secret(&self) -> &str {
        self.0.as_str()
    }

    fn token_hash(&self) -> [u8; 32] {
        Sha256::digest(self.expose_secret().as_bytes()).into()
    }
}

impl std::fmt::Debug for OAuthAuthorizationCode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("OAuthAuthorizationCode([REDACTED])")
    }
}

#[derive(Debug)]
pub struct BegunOAuthAuthorization {
    pub request_id: String,
    pub client: OAuthIntegrationClient,
    pub bundle_names: Vec<String>,
    pub scopes: Vec<super::auth_grants::ExactGrantScope>,
}

#[derive(Debug)]
pub struct IssuedOAuthAuthorization {
    pub code: OAuthAuthorizationCode,
    pub redirect_uri: String,
    pub oauth_state: Option<String>,
}

#[derive(Debug)]
pub struct DeniedOAuthAuthorization {
    pub redirect_uri: String,
    pub oauth_state: Option<String>,
}

#[derive(Debug)]
pub(super) struct ConsumedOAuthAuthorization {
    pub grant_id: String,
    pub principal_user_id: String,
}

pub fn manifest_enabled(manifest: &SchemaManifest) -> bool {
    manifest.api.as_ref().is_some_and(|api| api.enabled)
}

fn oauth_enabled(manifest: &SchemaManifest) -> bool {
    manifest.oauth_manifest().is_some()
}

/// Install/remove the exact companion catalog in the same schema activation
/// transaction as app tables and the push registry.
///
/// @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08 — integration records are app-scoped reserved state and class invariants are checked before admission opens.
pub(crate) fn activate_manifest_in(
    tx: &Transaction<'_>,
    manifest: &SchemaManifest,
) -> SnapbackResult<()> {
    if !manifest_enabled(manifest) {
        tx.execute_batch(
            "DROP TABLE IF EXISTS _snapback_oauth_authorizations;
             DROP TABLE IF EXISTS _snapback_integration_records;",
        )?;
        return Ok(());
    }
    tx.execute_batch(RECORD_TABLE_SQL)?;
    tx.execute_batch(STATUS_INDEX_SQL)?;
    if oauth_enabled(manifest) {
        tx.execute_batch(OAUTH_AUTHORIZATION_TABLE_SQL)?;
        tx.execute_batch(OAUTH_AUTHORIZATION_EXPIRY_INDEX_SQL)?;
    } else {
        tx.execute_batch("DROP TABLE IF EXISTS _snapback_oauth_authorizations;")?;
    }
    validate_exact_schema(tx)?;
    validate_class_invariants_on(tx, manifest)
}

pub(super) fn validate_exact_schema(conn: &Connection) -> SnapbackResult<()> {
    let reference = Connection::open_in_memory()?;
    reference.execute_batch(RECORD_TABLE_SQL)?;
    reference.execute_batch(STATUS_INDEX_SQL)?;
    if table_exists(conn, OAUTH_AUTHORIZATION_TABLE)? {
        reference.execute_batch(OAUTH_AUTHORIZATION_TABLE_SQL)?;
        reference.execute_batch(OAUTH_AUTHORIZATION_EXPIRY_INDEX_SQL)?;
    }
    if catalog_objects(conn)? != catalog_objects(&reference)? {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_INTEGRATION_CATALOG_CORRUPT",
            "auth",
            "integration registration catalog differs from the exact protected shape",
        ));
    }
    Ok(())
}

fn catalog_objects(conn: &Connection) -> SnapbackResult<Vec<(String, String, String, String)>> {
    let mut statement = conn.prepare(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_schema
         WHERE name IN ('_snapback_integration_records', '_snapback_oauth_authorizations')
            OR tbl_name IN ('_snapback_integration_records', '_snapback_oauth_authorizations')
         ORDER BY type, name",
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn table_exists(conn: &Connection, table: &str) -> SnapbackResult<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1",
            params![table],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

pub(super) fn create_record_on(
    tx: &Transaction<'_>,
    principal_user_id: &str,
    display_name: Option<&str>,
    facts: &IntegrationRegistrationFacts,
    provenance: &str,
    provisional: bool,
    now_ms: u64,
) -> SnapbackResult<String> {
    if !table_exists(tx, INTEGRATION_RECORD_TABLE)? {
        return Err(integration_unavailable());
    }
    validate_registration_facts(display_name, facts, provenance)?;
    let integration_id = crate::ids::mint_time_ordered(crate::ids::Kind::Integration);
    let redirect_uris_json = (!facts.redirect_uris.is_empty())
        .then(|| serde_json::to_string(&facts.redirect_uris))
        .transpose()
        .map_err(|_| integration_request_invalid())?;
    tx.execute(
        "INSERT INTO _snapback_integration_records(
           id, principal_user_id, display_name, origin, redirect_uris_json,
           status, created_at_ms, updated_at_ms, provenance, owner_claim_state
         ) VALUES(?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6, ?7, ?8)",
        params![
            integration_id,
            principal_user_id,
            display_name,
            facts.origin,
            redirect_uris_json,
            now_ms as i64,
            provenance,
            if provisional {
                "provisional"
            } else {
                "unclaimed"
            },
        ],
    )?;
    Ok(integration_id)
}

pub(super) fn validate_registration_template_suppressed_on(
    conn: &Connection,
    principal_user_id: &str,
) -> SnapbackResult<()> {
    refuse_template_grant_on(conn, principal_user_id, "registration")
}

/// The owner re-credential implementation must call this before publishing a
/// replacement family. Keeping a named second-site guard now prevents that
/// future transaction from reusing ordinary-agent template behavior.
///
/// @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08 — re-credential/re-apply may not restore an autonomous template for integrations.
#[allow(dead_code)]
pub(super) fn validate_recredential_template_suppressed_on(
    conn: &Connection,
    principal_user_id: &str,
) -> SnapbackResult<()> {
    if record_for_principal_on(conn, principal_user_id)?.is_none()
        && !principal_has_integration_class_on(conn, principal_user_id)?
    {
        return Ok(());
    }
    refuse_template_grant_on(conn, principal_user_id, "recredential")
}

fn refuse_template_grant_on(
    conn: &Connection,
    principal_user_id: &str,
    site: &str,
) -> SnapbackResult<()> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM _auth_grants
             WHERE actor_user_id = ?1 AND revoked_at_ms IS NULL
               AND (created_by = 'auth.agents.template'
                    OR created_by LIKE 'auth.agents.template:%')
             LIMIT 1",
            params![principal_user_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if exists {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_INTEGRATION_TEMPLATE_FORBIDDEN",
            "auth",
            "integration-class principals cannot receive autonomous agent templates",
        )
        .with_details(json!({ "userId": principal_user_id, "site": site })));
    }
    Ok(())
}

fn validate_registration_facts(
    display_name: Option<&str>,
    facts: &IntegrationRegistrationFacts,
    provenance: &str,
) -> SnapbackResult<()> {
    let bounded = display_name.is_none_or(|value| value.len() <= MAX_DISPLAY_NAME_BYTES)
        && facts
            .origin
            .as_ref()
            .is_none_or(|value| value.len() <= MAX_ORIGIN_BYTES)
        && facts.redirect_uris.len() <= MAX_REDIRECT_URIS
        && facts
            .redirect_uris
            .iter()
            .all(|value| value.len() <= MAX_REDIRECT_URI_BYTES)
        && provenance.len() <= MAX_PROVENANCE_BYTES;
    let redirect_bytes = serde_json::to_vec(&facts.redirect_uris)
        .map_err(|_| integration_request_invalid())?
        .len();
    if !bounded || redirect_bytes > MAX_REDIRECT_URIS_JSON_BYTES {
        return Err(integration_request_invalid());
    }
    if facts
        .redirect_uris
        .iter()
        .any(|redirect_uri| validate_oauth_redirect_uri(redirect_uri).is_err())
    {
        return Err(oauth_redirect_uri_invalid());
    }
    Ok(())
}

/// RFC 7591 registration accepts confidential HTTPS redirects and native
/// loopback redirects only. The exact registered string is retained and later
/// compared byte-for-byte at authorization and exchange.
pub fn validate_oauth_redirect_uri(value: &str) -> SnapbackResult<()> {
    if value.is_empty() || value.len() > MAX_REDIRECT_URI_BYTES || value.contains('#') {
        return Err(oauth_redirect_uri_invalid());
    }
    let uri = value
        .parse::<http::Uri>()
        .map_err(|_| oauth_redirect_uri_invalid())?;
    let scheme = uri.scheme_str().ok_or_else(oauth_redirect_uri_invalid)?;
    let authority = uri.authority().ok_or_else(oauth_redirect_uri_invalid)?;
    if authority.as_str().contains('@') || authority.host().is_empty() {
        return Err(oauth_redirect_uri_invalid());
    }
    let host = authority.host().trim_matches(['[', ']']);
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if scheme != "https" && !(scheme == "http" && loopback) {
        return Err(oauth_redirect_uri_invalid());
    }
    Ok(())
}

fn oauth_client_on(conn: &Connection, client_id: &str) -> SnapbackResult<OAuthIntegrationClient> {
    let row = conn
        .query_row(
            "SELECT id, principal_user_id, display_name, redirect_uris_json, status
             FROM _snapback_integration_records WHERE id = ?1",
            params![client_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(oauth_invalid_client)?;
    let redirect_uris = row
        .3
        .map(|encoded| serde_json::from_str::<Vec<String>>(&encoded))
        .transpose()
        .map_err(|_| integration_state_corrupt())?
        .unwrap_or_default();
    let client = OAuthIntegrationClient {
        client_id: row.0,
        principal_user_id: row.1,
        display_name: row.2,
        redirect_uris,
        status: IntegrationStatus::parse(&row.4)?,
    };
    match client.status {
        IntegrationStatus::Active => Ok(client),
        IntegrationStatus::Suspended => Err(integration_suspended(&client.principal_user_id)),
        IntegrationStatus::Revoked => Err(integration_revoked(&client.principal_user_id)),
    }
}

pub(super) fn record_for_principal_on(
    conn: &Connection,
    principal_user_id: &str,
) -> SnapbackResult<Option<IntegrationRecord>> {
    if !table_exists(conn, INTEGRATION_RECORD_TABLE)? {
        return Ok(None);
    }
    conn.query_row(
        "SELECT id, principal_user_id, status
         FROM _snapback_integration_records WHERE principal_user_id = ?1",
        params![principal_user_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        },
    )
    .optional()?
    .map(|(integration_id, principal_user_id, status)| {
        Ok(IntegrationRecord {
            integration_id,
            principal_user_id,
            status: IntegrationStatus::parse(&status)?,
        })
    })
    .transpose()
}

fn list_admin_records_on(conn: &Connection) -> SnapbackResult<Vec<IntegrationAdminRecord>> {
    if !table_exists(conn, INTEGRATION_RECORD_TABLE)? {
        return Ok(Vec::new());
    }
    let mut statement = conn.prepare(
        "SELECT id,principal_user_id,display_name,status,owner_claim_state,created_at_ms,updated_at_ms
         FROM _snapback_integration_records ORDER BY updated_at_ms DESC,id",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(
            |(
                integration_id,
                principal_user_id,
                display_name,
                status,
                owner_claim_state,
                created_at_ms,
                updated_at_ms,
            )| {
                let status = IntegrationStatus::parse(&status)?;
                if !matches!(
                    owner_claim_state.as_str(),
                    "provisional" | "unclaimed" | "claimed"
                ) {
                    return Err(integration_state_corrupt());
                }
                Ok(IntegrationAdminRecord {
                    integration_id,
                    principal_user_id,
                    display_name,
                    status: status.as_str().to_owned(),
                    owner_claim_state,
                    created_at_ms: created_at_ms as u64,
                    updated_at_ms: updated_at_ms as u64,
                })
            },
        )
        .collect()
}

fn principal_has_integration_class_on(
    conn: &Connection,
    principal_user_id: &str,
) -> SnapbackResult<bool> {
    Ok(conn
        .query_row(
            "SELECT CASE
               WHEN registration_provenance IS NOT NULL
                AND json_valid(registration_provenance)
               THEN COALESCE(json_extract(registration_provenance, '$.class') = 'integration', 0)
               ELSE 0
             END
             FROM _auth_users WHERE id = ?1 AND kind = 'agent'",
            params![principal_user_id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(false))
}

pub(super) fn require_record_on(
    conn: &Connection,
    principal_user_id: &str,
) -> SnapbackResult<IntegrationRecord> {
    match record_for_principal_on(conn, principal_user_id)? {
        Some(record) => Ok(record),
        None if principal_has_integration_class_on(conn, principal_user_id)? => {
            Err(integration_unavailable())
        }
        None => Err(integration_unknown(principal_user_id)),
    }
}

/// Admission predicate shared by minting and both installation-ceremony arms.
///
/// @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08 — suspension is reversible admission state and must be named as suspension, never revocation.
pub(super) fn require_active_if_integration_on(
    conn: &Connection,
    principal_user_id: &str,
) -> SnapbackResult<Option<IntegrationRecord>> {
    let Some(record) = record_for_principal_on(conn, principal_user_id)? else {
        if principal_has_integration_class_on(conn, principal_user_id)? {
            return Err(integration_unavailable());
        }
        return Ok(None);
    };
    match record.status {
        IntegrationStatus::Active => Ok(Some(record)),
        IntegrationStatus::Suspended => Err(integration_suspended(principal_user_id)),
        IntegrationStatus::Revoked => Err(integration_revoked(principal_user_id)),
    }
}

/// An integration can mint only from the approved pairing lineage that binds
/// this actor to the effective consenting user.
///
/// @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08 — integration credentials are delegation-only and mint solely against live installation grants.
pub(super) fn require_installation_grant_if_integration_on(
    conn: &Connection,
    actor_user_id: &str,
    grant_id: &str,
) -> SnapbackResult<()> {
    if require_active_if_integration_on(conn, actor_user_id)?.is_none() {
        return Ok(());
    }
    let grant = conn
        .query_row(
            "SELECT actor_user_id, effective_user_id FROM _auth_grants WHERE id = ?1",
            params![grant_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()?;
    let Some((grant_actor, effective_user_id)) = grant else {
        return Err(integration_installation_grant_required(
            actor_user_id,
            "grant_unknown",
        ));
    };
    if grant_actor != actor_user_id {
        return Err(integration_installation_grant_required(
            actor_user_id,
            "actor_mismatch",
        ));
    }
    let Some(effective_user_id) = effective_user_id else {
        return Err(integration_installation_grant_required(
            actor_user_id,
            "autonomous",
        ));
    };
    let exact_lineage = conn
        .query_row(
            "SELECT 1 FROM _auth_pairing_requests
             WHERE grant_id = ?1 AND state = 'approved'
               AND agent_user_id = ?2 AND minted_by_user_id = ?3",
            params![grant_id, actor_user_id, effective_user_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if exact_lineage {
        Ok(())
    } else {
        Err(integration_installation_grant_required(
            actor_user_id,
            "installation_lineage_mismatch",
        ))
    }
}

pub(super) fn mark_revoked_on(
    tx: &Transaction<'_>,
    principal_user_id: &str,
    now_ms: u64,
) -> SnapbackResult<IntegrationRecord> {
    let record = require_record_on(tx, principal_user_id)?;
    tx.execute(
        "UPDATE _snapback_integration_records
         SET status = 'revoked', updated_at_ms = MAX(updated_at_ms, ?1)
         WHERE principal_user_id = ?2",
        params![now_ms as i64, principal_user_id],
    )?;
    Ok(IntegrationRecord {
        status: IntegrationStatus::Revoked,
        ..record
    })
}

fn validate_pkce_challenge(challenge: &str) -> SnapbackResult<()> {
    let decoded = URL_SAFE_NO_PAD
        .decode(challenge)
        .map_err(|_| oauth_request_invalid())?;
    if challenge.len() != 43 || decoded.len() != 32 || URL_SAFE_NO_PAD.encode(decoded) != challenge
    {
        return Err(oauth_request_invalid());
    }
    Ok(())
}

fn validate_pkce_verifier(verifier: &str) -> SnapbackResult<()> {
    let valid = (43..=128).contains(&verifier.len())
        && verifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~'));
    if valid {
        Ok(())
    } else {
        Err(oauth_grant_invalid())
    }
}

fn oauth_bundle_scope_requests(
    manifest: &SchemaManifest,
    bundle_names: &[String],
) -> SnapbackResult<Vec<String>> {
    let oauth = manifest.oauth_manifest().ok_or_else(oauth_unavailable)?;
    if bundle_names.is_empty() || bundle_names.len() > 64 {
        return Err(oauth_scope_invalid());
    }
    let mut requested = std::collections::BTreeSet::new();
    for bundle_name in bundle_names {
        let bundle = oauth
            .bundles
            .get(bundle_name)
            .ok_or_else(oauth_scope_invalid)?;
        requested.extend(bundle.functions.iter().cloned());
    }
    Ok(requested.into_iter().collect())
}

pub(super) fn consume_oauth_authorization_code_on(
    tx: &Transaction<'_>,
    raw_code: &str,
    client_id: &str,
    redirect_uri: &str,
    verifier: &str,
    now_ms: u64,
) -> SnapbackResult<ConsumedOAuthAuthorization> {
    validate_pkce_verifier(verifier)?;
    let presented_hash: [u8; 32] = Sha256::digest(raw_code.as_bytes()).into();
    let row = tx
        .query_row(
            "SELECT client_id, principal_user_id, redirect_uri, code_challenge,
                    status, code_hash, grant_id, code_expires_at_ms
             FROM _snapback_oauth_authorizations WHERE code_hash = ?1",
            params![presented_hash.as_slice()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Vec<u8>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                ))
            },
        )
        .optional()?;
    let Some(row) = row else {
        let _ = [0_u8; 32].ct_eq(&presented_hash);
        return Err(oauth_grant_invalid());
    };
    if row.5.len() != 32 || !bool::from(row.5.as_slice().ct_eq(&presented_hash)) {
        return Err(oauth_state_corrupt());
    }
    let verifier_challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    if row.0 != client_id
        || row.2 != redirect_uri
        || row.4 != "approved"
        || row
            .7
            .is_none_or(|expiry| expiry < 0 || expiry as u64 <= now_ms)
        || !bool::from(row.3.as_bytes().ct_eq(verifier_challenge.as_bytes()))
    {
        return Err(oauth_grant_invalid());
    }
    let grant_id = row.6.ok_or_else(oauth_state_corrupt)?;
    oauth_client_on(tx, client_id)?;
    let changed = tx.execute(
        "UPDATE _snapback_oauth_authorizations
         SET status = 'exchanged', consumed_at_ms = ?1
         WHERE code_hash = ?2 AND status = 'approved'
           AND code_expires_at_ms > ?1",
        params![now_ms as i64, presented_hash.as_slice()],
    )?;
    if changed != 1 {
        return Err(oauth_grant_invalid());
    }
    Ok(ConsumedOAuthAuthorization {
        grant_id,
        principal_user_id: row.1,
    })
}

impl LocalDatabase {
    pub fn oauth_bundle_names_for_grant(&self, grant_id: &str) -> SnapbackResult<Vec<String>> {
        let encoded = self
            .conn
            .query_row(
                "SELECT bundle_names_json FROM _snapback_oauth_authorizations
                 WHERE grant_id = ?1 AND status = 'exchanged'",
                params![grant_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(oauth_grant_invalid)?;
        serde_json::from_str(&encoded).map_err(|_| oauth_state_corrupt())
    }

    /// Create the OAuth consent record and the ordinary grant request it
    /// delegates to in one transaction. OAuth never grows a parallel grant
    /// authority model: bundle names are compiled to the existing exact
    /// function/kind/basis scopes here.
    ///
    /// @ref LLP 0204#d8--authority-acquisition-the-ceremony-and-the-facade — facade consent must resolve through the existing grant machinery.
    #[allow(clippy::too_many_arguments)] // Stable OAuth authorization boundary; regrouping is out of scope here.
    pub fn begin_oauth_authorization(
        &mut self,
        consenting_user_id: &str,
        client_id: &str,
        redirect_uri: &str,
        bundle_names: &[String],
        code_challenge: &str,
        oauth_state: Option<&str>,
        now_ms: u64,
        random: &dyn crate::auth::crypto::RandomSource,
    ) -> SnapbackResult<BegunOAuthAuthorization> {
        validate_pkce_challenge(code_challenge)?;
        if oauth_state.is_some_and(|state| state.len() > 2_048) {
            return Err(oauth_request_invalid());
        }
        let requested = oauth_bundle_scope_requests(&self.schema, bundle_names)?;
        let app_id = self.schema.app_id.clone();
        let expires_at_ms = now_ms
            .checked_add(OAUTH_AUTHORIZATION_REQUEST_TTL_MS)
            .filter(|expiry| *expiry <= super::MAX_AUTHORIZATION_EPOCH)
            .ok_or_else(oauth_server_error)?;
        self.observe_agent_authorization_clock(now_ms)?;
        let request_id = crate::ids::mint_time_ordered(crate::ids::Kind::GrantRequest);
        let mut inert_pairing_hash = [0_u8; 32];
        random
            .fill(&mut inert_pairing_hash)
            .map_err(|_| oauth_server_error())?;
        let outcome = self.with_auth_transaction(|tx| {
            super::auth_agent_credentials::require_agent_clock_on(tx, now_ms)?;
            let human = tx
                .query_row(
                    "SELECT 1 FROM _auth_users WHERE id = ?1 AND kind = 'human'",
                    params![consenting_user_id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if !human {
                return Err(oauth_access_denied());
            }
            let client = oauth_client_on(tx, client_id)?;
            if !client
                .redirect_uris
                .iter()
                .any(|registered| registered == redirect_uri)
            {
                return Err(oauth_redirect_uri_invalid());
            }
            let scopes =
                super::auth_grants::resolve_exact_function_names_on(tx, &app_id, &requested)?;
            let scopes_json = super::auth_grants::canonical_scopes_json(&scopes)?;
            let bundle_names_json =
                serde_json::to_string(bundle_names).map_err(|_| oauth_state_corrupt())?;
            tx.execute(
                "INSERT INTO _auth_pairing_requests(
                   id, code_hash, minted_by_user_id, agent_user_id,
                   requested_scopes, state, attempts, created_at_ms,
                   expires_at_ms, consumed_at_ms, grant_id
                 ) VALUES(?1, ?2, ?3, ?4, ?5, 'pending', 0, ?6, ?7, ?6, NULL)",
                params![
                    request_id,
                    inert_pairing_hash.as_slice(),
                    consenting_user_id,
                    client.principal_user_id,
                    scopes_json,
                    now_ms as i64,
                    expires_at_ms as i64,
                ],
            )?;
            tx.execute(
                "INSERT INTO _snapback_oauth_authorizations(
                   request_id, client_id, principal_user_id, consenting_user_id,
                   redirect_uri, code_challenge, bundle_names_json, oauth_state,
                   status, code_hash, grant_id, created_at_ms, expires_at_ms,
                   code_expires_at_ms, consumed_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                          'pending', NULL, NULL, ?9, ?10, NULL, NULL)",
                params![
                    request_id,
                    client.client_id,
                    client.principal_user_id,
                    consenting_user_id,
                    redirect_uri,
                    code_challenge,
                    bundle_names_json,
                    oauth_state,
                    now_ms as i64,
                    expires_at_ms as i64,
                ],
            )?;
            Ok(BegunOAuthAuthorization {
                request_id: request_id.clone(),
                client,
                bundle_names: bundle_names.to_vec(),
                scopes,
            })
        });
        inert_pairing_hash.fill(0);
        outcome
    }

    /// Seal one already-approved ordinary grant behind a 60-second,
    /// single-use authorization code. The raw code is never persisted.
    pub fn issue_oauth_authorization_code(
        &mut self,
        consenting_user_id: &str,
        request_id: &str,
        now_ms: u64,
        random: &dyn crate::auth::crypto::RandomSource,
    ) -> SnapbackResult<IssuedOAuthAuthorization> {
        self.observe_agent_authorization_clock(now_ms)?;
        let code = OAuthAuthorizationCode::generate(random)?;
        let code_hash = code.token_hash();
        let code_expires_at_ms = now_ms
            .checked_add(OAUTH_AUTHORIZATION_CODE_TTL_MS)
            .filter(|expiry| *expiry <= super::MAX_AUTHORIZATION_EPOCH)
            .ok_or_else(oauth_server_error)?;
        self.with_auth_transaction(|tx| {
            super::auth_agent_credentials::require_agent_clock_on(tx, now_ms)?;
            let row = tx
                .query_row(
                    "SELECT o.client_id, o.redirect_uri, o.oauth_state,
                            o.status, p.grant_id
                     FROM _snapback_oauth_authorizations AS o
                     JOIN _auth_pairing_requests AS p ON p.id = o.request_id
                     WHERE o.request_id = ?1 AND o.consenting_user_id = ?2
                       AND p.state = 'approved'",
                    params![request_id, consenting_user_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, Option<String>>(4)?,
                        ))
                    },
                )
                .optional()?
                .ok_or_else(oauth_grant_invalid)?;
            if row.3 != "pending" {
                return Err(oauth_grant_invalid());
            }
            oauth_client_on(tx, &row.0)?;
            let grant_id = row.4.ok_or_else(oauth_state_corrupt)?;
            let changed = tx.execute(
                "UPDATE _snapback_oauth_authorizations
                 SET status = 'approved', code_hash = ?1, grant_id = ?2,
                     code_expires_at_ms = ?3
                 WHERE request_id = ?4 AND status = 'pending'",
                params![
                    code_hash.as_slice(),
                    grant_id,
                    code_expires_at_ms as i64,
                    request_id,
                ],
            )?;
            if changed != 1 {
                return Err(oauth_grant_invalid());
            }
            Ok(IssuedOAuthAuthorization {
                code,
                redirect_uri: row.1,
                oauth_state: row.2,
            })
        })
    }

    pub fn deny_oauth_authorization(
        &mut self,
        consenting_user_id: &str,
        request_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<DeniedOAuthAuthorization> {
        self.observe_agent_authorization_clock(now_ms)?;
        self.with_auth_transaction(|tx| {
            super::auth_agent_credentials::require_agent_clock_on(tx, now_ms)?;
            let redirect = tx
                .query_row(
                    "SELECT redirect_uri, oauth_state
                     FROM _snapback_oauth_authorizations
                     WHERE request_id = ?1 AND consenting_user_id = ?2
                       AND status = 'pending' AND expires_at_ms > ?3",
                    params![request_id, consenting_user_id, now_ms as i64],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .optional()?
                .ok_or_else(oauth_grant_invalid)?;
            let changed = tx.execute(
                "UPDATE _snapback_oauth_authorizations SET status = 'denied'
                 WHERE request_id = ?1 AND consenting_user_id = ?2
                   AND status = 'pending' AND expires_at_ms > ?3",
                params![request_id, consenting_user_id, now_ms as i64],
            )?;
            if changed != 1 {
                return Err(oauth_grant_invalid());
            }
            tx.execute(
                "UPDATE _auth_pairing_requests SET state = 'denied'
                 WHERE id = ?1 AND minted_by_user_id = ?2 AND state = 'pending'",
                params![request_id, consenting_user_id],
            )?;
            Ok(DeniedOAuthAuthorization {
                redirect_uri: redirect.0,
                oauth_state: redirect.1,
            })
        })
    }

    /// Re-read the reversible integration admission fact at an app-lock
    /// revalidation boundary. Ordinary agents remain an exact no-op.
    pub fn require_active_integration_if_present(
        &self,
        principal_user_id: &str,
    ) -> SnapbackResult<()> {
        require_active_if_integration_on(&self.conn, principal_user_id).map(|_| ())
    }

    pub fn integration_record_if_present(
        &self,
        principal_user_id: &str,
    ) -> SnapbackResult<Option<IntegrationRecord>> {
        record_for_principal_on(&self.conn, principal_user_id)
    }

    pub fn list_integrations(&self) -> SnapbackResult<Vec<IntegrationAdminRecord>> {
        list_admin_records_on(&self.conn)
    }

    /// @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08 — suspend/resume changes admission only and cannot resurrect a retired registration.
    pub fn set_integration_suspended(
        &mut self,
        principal_user_id: &str,
        suspended: bool,
        now_ms: u64,
    ) -> SnapbackResult<IntegrationRecord> {
        self.with_auth_transaction(|tx| {
            let record = require_record_on(tx, principal_user_id)?;
            if record.status == IntegrationStatus::Revoked {
                return Err(integration_revoked(principal_user_id));
            }
            let status = if suspended {
                IntegrationStatus::Suspended
            } else {
                IntegrationStatus::Active
            };
            tx.execute(
                "UPDATE _snapback_integration_records
                 SET status = ?1, updated_at_ms = MAX(updated_at_ms, ?2)
                 WHERE principal_user_id = ?3",
                params![status.as_str(), now_ms as i64, principal_user_id],
            )?;
            Ok(IntegrationRecord { status, ..record })
        })
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn integration_record_for_test(
        &self,
        principal_user_id: &str,
    ) -> SnapbackResult<Option<IntegrationRecord>> {
        record_for_principal_on(&self.conn, principal_user_id)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn integration_grant_revoked_for_test(&self, grant_id: &str) -> SnapbackResult<bool> {
        Ok(self.conn.query_row(
            "SELECT revoked_at_ms IS NOT NULL FROM _auth_grants WHERE id = ?1",
            params![grant_id],
            |row| row.get(0),
        )?)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn oauth_registration_facts_for_test(
        &self,
        client_id: &str,
    ) -> SnapbackResult<(String, String, String)> {
        self.conn
            .query_row(
                "SELECT principal_user_id, owner_claim_state, redirect_uris_json
             FROM _snapback_integration_records WHERE id = ?1",
                params![client_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(Into::into)
    }
}

/// Validate imported/activated authority instead of deleting or reinterpreting
/// it. The first named principal is returned for explicit operator repair.
///
/// @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08 — activation refuses integration autonomous grants/memberships and malformed installation lineage.
pub(crate) fn validate_class_invariants_on(
    conn: &Connection,
    manifest: &SchemaManifest,
) -> SnapbackResult<()> {
    if !table_exists(conn, INTEGRATION_RECORD_TABLE)? || !table_exists(conn, "_auth_users")? {
        return Ok(());
    }
    let missing_record = conn
        .query_row(
            "SELECT u.id
             FROM _auth_users AS u
             LEFT JOIN _snapback_integration_records AS r
               ON r.principal_user_id = u.id
             WHERE u.kind = 'agent'
               AND CASE
                 WHEN u.registration_provenance IS NOT NULL
                  AND json_valid(u.registration_provenance)
                 THEN COALESCE(json_extract(u.registration_provenance, '$.class') = 'integration', 0)
                 ELSE 0
               END
               AND r.id IS NULL
             ORDER BY u.id LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(principal) = missing_record {
        return Err(integration_class_invalid(
            &principal,
            "registration_record_missing",
        ));
    }
    let violation: Option<(String, String)> = conn
        .query_row(
            "SELECT r.principal_user_id,
                    CASE
                      WHEN u.id IS NULL OR u.kind <> 'agent' THEN 'principal_not_agent'
                      WHEN u.owner_user_id IS NOT NULL THEN 'owner_seated'
                      WHEN CASE
                        WHEN json_valid(u.registration_provenance)
                        THEN COALESCE(json_extract(u.registration_provenance, '$.class') <> 'integration', 1)
                        ELSE 1
                      END THEN 'registration_class_mismatch'
                      WHEN EXISTS(
                        SELECT 1 FROM _auth_grants AS g
                        WHERE g.actor_user_id = r.principal_user_id
                          AND g.revoked_at_ms IS NULL
                          AND g.effective_user_id IS NULL
                      ) THEN 'autonomous_grant'
                      WHEN EXISTS(
                        SELECT 1 FROM _auth_grants AS g
                        WHERE g.actor_user_id = r.principal_user_id
                          AND g.revoked_at_ms IS NULL
                          AND (g.created_by = 'auth.agents.template'
                               OR g.created_by LIKE 'auth.agents.template:%')
                      ) THEN 'template_grant'
                      WHEN EXISTS(
                        SELECT 1 FROM _auth_grants AS g
                        WHERE g.actor_user_id = r.principal_user_id
                          AND g.revoked_at_ms IS NULL
                          AND g.effective_user_id IS NOT NULL
                          AND NOT EXISTS(
                            SELECT 1 FROM _auth_pairing_requests AS p
                            WHERE p.grant_id = g.id AND p.state = 'approved'
                              AND p.agent_user_id = r.principal_user_id
                              AND p.minted_by_user_id = g.effective_user_id
                          )
                      ) THEN 'installation_lineage_mismatch'
                    END AS reason
             FROM _snapback_integration_records AS r
             LEFT JOIN _auth_users AS u ON u.id = r.principal_user_id
             WHERE reason IS NOT NULL
             ORDER BY r.principal_user_id LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((principal, reason)) = violation {
        return Err(integration_class_invalid(&principal, &reason));
    }
    for table in &manifest.tables {
        let Some(membership) = &table.membership else {
            continue;
        };
        if !table_exists(conn, &table.name)? {
            continue;
        }
        let sql = format!(
            "SELECT m.{principal} FROM {table} AS m
             JOIN _snapback_integration_records AS r
               ON r.principal_user_id = m.{principal}
             ORDER BY m.{principal} LIMIT 1",
            principal = quote_ident(&membership.principal),
            table = quote_ident(&table.name),
        );
        if let Some(principal) = conn
            .query_row(&sql, [], |row| row.get::<_, String>(0))
            .optional()?
        {
            return Err(integration_class_invalid(
                &principal,
                "autonomous_membership",
            ));
        }
    }
    Ok(())
}

fn quote_ident(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

pub fn integration_unknown(principal_user_id: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_INTEGRATION_UNKNOWN",
        "auth",
        "no integration-class principal exists for the named user id",
    )
    .with_details(json!({ "userId": principal_user_id }))
}

pub fn integration_suspended(principal_user_id: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_INTEGRATION_SUSPENDED",
        "auth",
        "the integration is suspended; ask an app operator to resume integration admission",
    )
    .with_details(json!({ "userId": principal_user_id, "status": "suspended", "operatorAction": "auth.integrationResume" }))
}

pub fn integration_revoked(principal_user_id: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_INTEGRATION_REVOKED",
        "auth",
        "the integration registration is terminally revoked",
    )
    .with_details(json!({ "userId": principal_user_id, "status": "revoked" }))
}

fn integration_unavailable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_INTEGRATION_UNAVAILABLE",
        "auth",
        "integration registration requires an enabled api declaration",
    )
}

fn integration_request_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_INTEGRATION_REQUEST_INVALID",
        "auth",
        "integration registration fields exceed the bounded request contract",
    )
}

pub fn integration_facts_for_agent() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_INTEGRATION_REQUEST_INVALID",
        "auth",
        "integration origin or redirect facts require class integration",
    )
}

fn integration_installation_grant_required(principal_user_id: &str, reason: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_INTEGRATION_INSTALLATION_REQUIRED",
        "auth",
        "integration credentials may mint only from a live user-consented installation grant",
    )
    .with_details(json!({ "userId": principal_user_id, "reason": reason }))
}

fn integration_class_invalid(principal_user_id: &str, reason: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_INTEGRATION_CLASS_INVALID",
        "auth",
        format!("integration principal {principal_user_id} violates the delegation-only class invariant and requires explicit repair"),
    )
    .with_details(json!({ "userId": principal_user_id, "reason": reason }))
}

fn integration_state_corrupt() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_INTEGRATION_CATALOG_CORRUPT",
        "auth",
        "integration registration state is corrupt",
    )
}

pub fn oauth_unavailable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_OAUTH_UNAVAILABLE",
        "auth",
        "the local OAuth facade is not enabled by the active schema manifest",
    )
}

pub fn oauth_invalid_client() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_OAUTH_INVALID_CLIENT",
        "auth",
        "the OAuth client registration is unknown or unavailable",
    )
}

pub fn oauth_redirect_uri_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_OAUTH_REDIRECT_URI_INVALID",
        "auth",
        "the OAuth redirect URI is invalid or does not exactly match its registration",
    )
}

pub fn oauth_request_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_OAUTH_REQUEST_INVALID",
        "auth",
        "the OAuth request is malformed or uses an unsupported parameter",
    )
}

pub fn oauth_scope_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_OAUTH_SCOPE_INVALID",
        "auth",
        "the OAuth scope contains an unknown bundle",
    )
}

pub fn oauth_access_denied() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_OAUTH_ACCESS_DENIED",
        "auth",
        "the current user did not approve this OAuth authorization",
    )
}

pub fn oauth_grant_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_OAUTH_GRANT_INVALID",
        "auth",
        "the OAuth authorization code is invalid, expired, consumed, or incorrectly bound",
    )
}

pub fn oauth_state_corrupt() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_OAUTH_STATE_CORRUPT",
        "auth",
        "durable OAuth facade state is corrupt",
    )
}

pub fn oauth_server_error() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_OAUTH_SERVER_ERROR",
        "auth",
        "the OAuth facade could not complete the request",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::{CreationInvitation, CryptoError, RandomSource};
    use crate::contract_types::ServerProfile;
    use crate::manifest::AgentsMode;
    use crate::storage::auth_agents::AgentRegistration;
    use serde_json::json;
    use std::sync::atomic::{AtomicU8, Ordering};

    struct CounterRandom(AtomicU8);

    impl CounterRandom {
        fn new() -> Self {
            Self(AtomicU8::new(1))
        }
    }

    impl RandomSource for CounterRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
            destination.fill(self.0.fetch_add(1, Ordering::SeqCst));
            Ok(())
        }
    }

    fn api_manifest() -> SchemaManifest {
        let mut manifest: SchemaManifest = serde_json::from_value(json!({ "tables": [] })).unwrap();
        manifest.api = Some(crate::contract_types::ApiManifest {
            enabled: true,
            ..Default::default()
        });
        manifest
    }

    fn oauth_api_manifest() -> SchemaManifest {
        let mut manifest = api_manifest();
        let api = manifest.api.as_mut().unwrap();
        api.functions.insert(
            "query-a".to_owned(),
            crate::contract_types::ApiFunctionExposure {
                expose: true,
                since: None,
                approval: None,
            },
        );
        api.oauth = Some(crate::contract_types::ApiOAuthManifest {
            enabled: true,
            bearer: true,
            bundles: std::collections::BTreeMap::from([(
                "read".to_owned(),
                crate::contract_types::ApiOAuthBundle {
                    functions: vec!["query-a".to_owned()],
                },
            )]),
        });
        manifest
    }

    fn ready_database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog().unwrap();
        db.with_auth_transaction(|tx| {
            activate_manifest_in(tx, &api_manifest())?;
            crate::storage::declared_clients::activate_manifest_in(tx, &api_manifest())
        })
        .unwrap();
        db
    }

    fn oauth_ready_database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog().unwrap();
        let manifest = oauth_api_manifest();
        db.with_auth_transaction(|tx| activate_manifest_in(tx, &manifest))
            .unwrap();
        db.replace_active_schema(manifest);
        db.conn
            .execute(
                "INSERT INTO _auth_scope_bases(
                   function_id, kind, generation, present, authority_creating
                 ) VALUES('query-a', 'query', 1, 1, 0)",
                [],
            )
            .unwrap();
        db
    }

    fn register_integration(
        db: &mut LocalDatabase,
        random: &dyn RandomSource,
    ) -> crate::storage::auth_agent_credentials::IssuedAgentCredential {
        db.register_agent_principal_with_class(
            AgentsMode::Open,
            None,
            Some("Example Integration".to_owned()),
            Some("ops@example.test".to_owned()),
            AgentRegistrationClass::Integration,
            IntegrationRegistrationFacts {
                origin: Some("https://example.test".to_owned()),
                redirect_uris: vec!["https://example.test/callback".to_owned()],
            },
            ServerProfile::Test,
            1_000,
            random,
        )
        .unwrap()
    }

    fn seed_human(db: &LocalDatabase, user_id: &str) {
        db.conn
            .execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, 0)",
                params![user_id],
            )
            .unwrap();
    }

    fn seed_agent(db: &mut LocalDatabase, user_id: &str) {
        db.create_agent_principal(
            user_id,
            0,
            &AgentRegistration {
                display_name: None,
                operator_contact: None,
                registration_provenance: json!({"class": "agent"}).to_string(),
                owner_user_id: None,
            },
        )
        .unwrap();
    }

    fn seed_grant(
        db: &LocalDatabase,
        id: &str,
        actor: &str,
        effective: Option<&str>,
        pairing_id: Option<&str>,
        tag: u8,
    ) {
        db.conn
            .execute(
                "INSERT OR IGNORE INTO _auth_scope_bases(
                   function_id, kind, generation, present, authority_creating
                 ) VALUES('query-a', 'query', 0, 1, 0)",
                [],
            )
            .unwrap();
        db.conn
            .execute(
                "INSERT INTO _auth_grants(
                   id, actor_user_id, effective_user_id, scopes, created_at_ms,
                   expires_at_ms, revoked_at_ms, created_by, request_id,
                   consent_digest, last_used_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, 1000, ?5, NULL, 'pairing:test', ?6, ?7, 1000)",
                params![
                    id,
                    actor,
                    effective,
                    r#"[{"fn":"query-a","kind":"query","basis":0,"authorityCreating":false}]"#,
                    effective.map(|_| 20_000_i64),
                    pairing_id,
                    effective.map(|_| vec![tag; 32]),
                ],
            )
            .unwrap();
        if let (Some(pairing_id), Some(effective)) = (pairing_id, effective) {
            db.conn
                .execute(
                    "INSERT INTO _auth_pairing_requests(
                       id, code_hash, minted_by_user_id, agent_user_id,
                       requested_scopes, state, attempts, created_at_ms,
                       expires_at_ms, consumed_at_ms, grant_id
                     ) VALUES(?1, ?2, ?3, ?4, ?5, 'approved', 0, 900, 20000, 1000, ?6)",
                    params![
                        pairing_id,
                        vec![tag; 32],
                        effective,
                        actor,
                        r#"[{"fn":"query-a","kind":"query","basis":0,"authorityCreating":false}]"#,
                        id,
                    ],
                )
                .unwrap();
        }
    }

    #[test]
    fn manifest_activation_installs_and_removes_exact_catalog() {
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog().unwrap();
        let mut manifest: SchemaManifest = serde_json::from_value(json!({ "tables": [] })).unwrap();
        manifest.api = Some(crate::contract_types::ApiManifest {
            enabled: true,
            ..Default::default()
        });
        db.with_auth_transaction(|tx| activate_manifest_in(tx, &manifest))
            .unwrap();
        assert!(table_exists(&db.conn, INTEGRATION_RECORD_TABLE).unwrap());
        manifest.api.as_mut().unwrap().enabled = false;
        db.with_auth_transaction(|tx| activate_manifest_in(tx, &manifest))
            .unwrap();
        assert!(!table_exists(&db.conn, INTEGRATION_RECORD_TABLE).unwrap());
    }

    #[test]
    fn oauth_code_is_pkce_bound_single_use_short_lived_and_mints_the_existing_carrier() {
        let random = CounterRandom::new();
        let mut db = oauth_ready_database();
        seed_human(&db, "user-oauth");
        let integration = register_integration(&mut db, &random);
        let record = db
            .integration_record_if_present(&integration.user_id)
            .unwrap()
            .expect("integration record");
        let verifier = "v".repeat(43);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let begun = db
            .begin_oauth_authorization(
                "user-oauth",
                &record.integration_id,
                "https://example.test/callback",
                &["read".to_owned()],
                &challenge,
                Some("round-trip"),
                1_001,
                &random,
            )
            .expect("begin consent");
        let approval = db
            .approve_grant_request(
                "user-oauth",
                "session-oauth",
                &begun.request_id,
                None,
                None,
                1_002,
            )
            .expect("approve through ordinary grant machinery");
        let grant_id = match approval {
            crate::storage::auth_grants::GrantApproval::Created(grant)
            | crate::storage::auth_grants::GrantApproval::Existing(grant) => grant.grant_id,
        };
        let issued = db
            .issue_oauth_authorization_code("user-oauth", &begun.request_id, 1_003, &random)
            .expect("issue short authorization code");
        let raw_code = issued.code.expose_secret().to_owned();

        let wrong = db
            .mint_scoped_token_for_oauth_code(
                &raw_code,
                &record.integration_id,
                "https://example.test/callback",
                &"x".repeat(43),
                1_004,
                &random,
            )
            .unwrap_err();
        assert_eq!(wrong.diagnostic.code, "SNAPBACK_AUTH_OAUTH_GRANT_INVALID");

        let token = db
            .mint_scoped_token_for_oauth_code(
                &raw_code,
                &record.integration_id,
                "https://example.test/callback",
                &verifier,
                1_005,
                &random,
            )
            .expect("exchange into existing scoped token machinery");
        assert_eq!(token.grant_id, grant_id);
        assert_eq!(token.actor_user_id, integration.user_id);
        assert_eq!(token.effective_user_id.as_deref(), Some("user-oauth"));
        assert_eq!(token.expires_at_ms - 1_005, OAUTH_BEARER_TOKEN_TTL_MS);
        assert_eq!(
            db.oauth_bundle_names_for_grant(&grant_id).unwrap(),
            vec!["read"]
        );

        let reused = db
            .mint_scoped_token_for_oauth_code(
                &raw_code,
                &record.integration_id,
                "https://example.test/callback",
                &verifier,
                1_006,
                &random,
            )
            .unwrap_err();
        assert_eq!(reused.diagnostic.code, "SNAPBACK_AUTH_OAUTH_GRANT_INVALID");

        let expiring = db
            .begin_oauth_authorization(
                "user-oauth",
                &record.integration_id,
                "https://example.test/callback",
                &["read".to_owned()],
                &challenge,
                None,
                1_007,
                &random,
            )
            .expect("begin expiring authorization");
        db.approve_grant_request(
            "user-oauth",
            "session-oauth",
            &expiring.request_id,
            None,
            None,
            1_008,
        )
        .expect("approve expiring authorization");
        let expired_code = db
            .issue_oauth_authorization_code("user-oauth", &expiring.request_id, 1_009, &random)
            .expect("issue expiring authorization code")
            .code
            .expose_secret()
            .to_owned();
        let expired = db
            .mint_scoped_token_for_oauth_code(
                &expired_code,
                &record.integration_id,
                "https://example.test/callback",
                &verifier,
                61_010,
                &random,
            )
            .unwrap_err();
        assert_eq!(expired.diagnostic.code, "SNAPBACK_AUTH_OAUTH_GRANT_INVALID");

        let revocation = db
            .oauth_revoke_scoped_token(&token.secret, true, 61_011)
            .expect("possession can revoke the carrier and installation grant");
        assert_eq!(revocation.grant_id, grant_id);
        assert!(db.integration_grant_revoked_for_test(&grant_id).unwrap());
    }

    #[test]
    fn oauth_redirect_validation_and_integration_status_gates_are_fail_closed() {
        for invalid in [
            "http://example.test/callback",
            "https://example.test/callback#fragment",
            "custom://localhost/callback",
        ] {
            assert_eq!(
                validate_oauth_redirect_uri(invalid)
                    .unwrap_err()
                    .diagnostic
                    .code,
                "SNAPBACK_AUTH_OAUTH_REDIRECT_URI_INVALID"
            );
        }
        validate_oauth_redirect_uri("https://example.test/callback").unwrap();
        validate_oauth_redirect_uri("http://127.0.0.1:4321/callback").unwrap();

        let random = CounterRandom::new();
        let mut db = oauth_ready_database();
        seed_human(&db, "user-oauth");
        let integration = register_integration(&mut db, &random);
        let record = db
            .integration_record_if_present(&integration.user_id)
            .unwrap()
            .unwrap();
        db.set_integration_suspended(&integration.user_id, true, 1_001)
            .unwrap();
        let verifier = "v".repeat(43);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let error = db
            .begin_oauth_authorization(
                "user-oauth",
                &record.integration_id,
                "https://example.test/callback",
                &["read".to_owned()],
                &challenge,
                None,
                1_002,
                &random,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_INTEGRATION_SUSPENDED");

        db.set_integration_suspended(&integration.user_id, false, 1_003)
            .unwrap();
        let begun = db
            .begin_oauth_authorization(
                "user-oauth",
                &record.integration_id,
                "https://example.test/callback",
                &["read".to_owned()],
                &challenge,
                None,
                1_004,
                &random,
            )
            .unwrap();
        db.approve_grant_request(
            "user-oauth",
            "session-oauth",
            &begun.request_id,
            None,
            None,
            1_005,
        )
        .unwrap();
        let code = db
            .issue_oauth_authorization_code("user-oauth", &begun.request_id, 1_006, &random)
            .unwrap()
            .code
            .expose_secret()
            .to_owned();
        db.set_integration_suspended(&integration.user_id, true, 1_007)
            .unwrap();
        let suspended_exchange = db
            .mint_scoped_token_for_oauth_code(
                &code,
                &record.integration_id,
                "https://example.test/callback",
                &verifier,
                1_008,
                &random,
            )
            .unwrap_err();
        assert_eq!(
            suspended_exchange.diagnostic.code,
            "SNAPBACK_AUTH_INTEGRATION_SUSPENDED"
        );
        db.set_integration_suspended(&integration.user_id, false, 1_009)
            .unwrap();
        let token = db
            .mint_scoped_token_for_oauth_code(
                &code,
                &record.integration_id,
                "https://example.test/callback",
                &verifier,
                1_010,
                &random,
            )
            .expect("resume restores exchange for the still-single-use code");
        db.revoke_grant_for_user("user-oauth", &token.grant_id, 1_011)
            .unwrap();
        assert!(db.resolve_scoped_token(&token.secret, 1_012).is_err());

        let retire_candidate = db
            .begin_oauth_authorization(
                "user-oauth",
                &record.integration_id,
                "https://example.test/callback",
                &["read".to_owned()],
                &challenge,
                None,
                1_013,
                &random,
            )
            .unwrap();
        db.approve_grant_request(
            "user-oauth",
            "session-oauth",
            &retire_candidate.request_id,
            None,
            None,
            1_014,
        )
        .unwrap();
        let retire_code = db
            .issue_oauth_authorization_code(
                "user-oauth",
                &retire_candidate.request_id,
                1_015,
                &random,
            )
            .unwrap()
            .code
            .expose_secret()
            .to_owned();
        let retire_token = db
            .mint_scoped_token_for_oauth_code(
                &retire_code,
                &record.integration_id,
                "https://example.test/callback",
                &verifier,
                1_016,
                &random,
            )
            .unwrap();

        let revoked_candidate = db
            .begin_oauth_authorization(
                "user-oauth",
                &record.integration_id,
                "https://example.test/callback",
                &["read".to_owned()],
                &challenge,
                None,
                1_017,
                &random,
            )
            .unwrap();
        db.approve_grant_request(
            "user-oauth",
            "session-oauth",
            &revoked_candidate.request_id,
            None,
            None,
            1_018,
        )
        .unwrap();
        let revoked_code = db
            .issue_oauth_authorization_code(
                "user-oauth",
                &revoked_candidate.request_id,
                1_019,
                &random,
            )
            .unwrap()
            .code
            .expose_secret()
            .to_owned();
        db.retire_integration_credential_family(&integration.secret, 1_020)
            .unwrap();
        assert!(
            db.resolve_scoped_token(&retire_token.secret, 1_021)
                .is_err()
        );
        let revoked_exchange = db
            .mint_scoped_token_for_oauth_code(
                &revoked_code,
                &record.integration_id,
                "https://example.test/callback",
                &verifier,
                1_021,
                &random,
            )
            .unwrap_err();
        assert_eq!(
            revoked_exchange.diagnostic.code,
            "SNAPBACK_AUTH_INTEGRATION_REVOKED"
        );
    }

    #[test]
    fn removing_the_api_catalog_cannot_downgrade_an_integration_to_an_ordinary_agent() {
        let random = CounterRandom::new();
        let mut db = ready_database();
        let integration = register_integration(&mut db, &random);
        seed_grant(&db, "grant-autonomous", &integration.user_id, None, None, 3);
        let mut disabled = api_manifest();
        disabled.api.as_mut().unwrap().enabled = false;
        db.with_auth_transaction(|tx| activate_manifest_in(tx, &disabled))
            .unwrap();
        let error = db
            .mint_scoped_token(
                &integration.secret,
                "grant-autonomous",
                Some(1_000),
                1_010,
                &random,
            )
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_INTEGRATION_UNAVAILABLE"
        );
        let reactivation = db
            .with_auth_transaction(|tx| activate_manifest_in(tx, &api_manifest()))
            .unwrap_err();
        assert_eq!(
            reactivation.diagnostic.code,
            "SNAPBACK_AUTH_INTEGRATION_CLASS_INVALID"
        );
        assert_eq!(
            reactivation.diagnostic.details["reason"],
            "registration_record_missing"
        );
    }

    #[test]
    fn integration_registration_is_unowned_provisional_and_records_public_facts() {
        let random = CounterRandom::new();
        let mut db = ready_database();
        let issued = register_integration(&mut db, &random);
        let (owner, provenance): (Option<String>, String) = db
            .conn
            .query_row(
                "SELECT owner_user_id, registration_provenance FROM _auth_users WHERE id = ?1",
                params![issued.user_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(owner, None);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&provenance).unwrap()["class"],
            "integration"
        );
        let (integration_id, status, claim, origin, redirects): (
            String,
            String,
            String,
            Option<String>,
            Option<String>,
        ) = db
            .conn
            .query_row(
                "SELECT id, status, owner_claim_state, origin, redirect_uris_json
                 FROM _snapback_integration_records WHERE principal_user_id = ?1",
                params![issued.user_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert!(integration_id.starts_with("intg_"));
        assert_eq!(status, "active");
        assert_eq!(claim, "provisional");
        assert_eq!(origin.as_deref(), Some("https://example.test"));
        assert!(redirects.unwrap().contains("/callback"));
    }

    #[test]
    fn integration_registration_never_claims_matching_declared_history() {
        let random = CounterRandom::new();
        let mut db = ready_database();
        let declared_id = "example integration/ops@example.test";
        let observed = db.observe_declared_client(declared_id, 900, 1).unwrap();
        assert!(matches!(
            observed,
            crate::storage::declared_clients::DeclaredClientObservation::Observed(_)
        ));
        let before = db
            .set_declared_client_status(
                declared_id,
                crate::storage::declared_clients::DeclaredClientStatus::Blessed,
            )
            .unwrap();
        let integration = register_integration(&mut db, &random);
        let after = db
            .declared_client_for_admission(declared_id, 1_000)
            .unwrap()
            .expect("declared history remains a separate row");
        assert_eq!(after, before);
        assert_eq!(after.status.as_str(), "blessed");
        assert_eq!(after.request_count, 1);
        assert!(
            db.integration_record_if_present(&integration.user_id)
                .unwrap()
                .is_some(),
            "registration creates only the fresh key-bound integration record"
        );
    }

    #[test]
    fn invited_integration_records_inviter_without_seating_an_owner() {
        let random = CounterRandom::new();
        let mut db = ready_database();
        seed_human(&db, "user-a");
        let invitation = CreationInvitation::generate(&random).unwrap();
        db.conn
            .execute(
                "INSERT INTO _auth_agent_invitations(
                   id, token_hash, class, created_by, minted_profile,
                   agent_user_id, created_at_ms, expires_at_ms,
                   revoked_at_ms, consumed_at_ms, consumed_by
                 ) VALUES('invitation-a', ?1, 'creation', 'user-a', 'test',
                          NULL, 1000, 20000, NULL, NULL, NULL)",
                params![invitation.token_hash().as_bytes()],
            )
            .unwrap();
        let issued = db
            .register_agent_principal_with_class(
                AgentsMode::Invited,
                Some(&invitation),
                Some("Invited Integration".to_owned()),
                None,
                AgentRegistrationClass::Integration,
                IntegrationRegistrationFacts::default(),
                ServerProfile::Test,
                1_001,
                &random,
            )
            .unwrap();
        let (owner, provenance): (Option<String>, String) = db
            .conn
            .query_row(
                "SELECT owner_user_id, registration_provenance
                 FROM _auth_users WHERE id = ?1",
                params![issued.user_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(owner, None);
        let provenance: serde_json::Value = serde_json::from_str(&provenance).unwrap();
        assert_eq!(provenance["class"], "integration");
        assert_eq!(provenance["inviter"], "user-a");
        let claim: String = db
            .conn
            .query_row(
                "SELECT owner_claim_state FROM _snapback_integration_records
                 WHERE principal_user_id = ?1",
                params![issued.user_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(claim, "unclaimed");
    }

    #[test]
    fn integration_mints_only_from_exact_installation_lineage_and_plain_agent_is_unchanged() {
        let random = CounterRandom::new();
        let mut db = ready_database();
        let integration = register_integration(&mut db, &random);
        seed_human(&db, "user-a");
        seed_grant(
            &db,
            "grant-install",
            &integration.user_id,
            Some("user-a"),
            Some("pair-install"),
            10,
        );
        db.mint_scoped_token(
            &integration.secret,
            "grant-install",
            Some(1_000),
            1_001,
            &random,
        )
        .unwrap();

        seed_grant(
            &db,
            "grant-autonomous",
            &integration.user_id,
            None,
            None,
            11,
        );
        let autonomous = db
            .mint_scoped_token(
                &integration.secret,
                "grant-autonomous",
                Some(1_000),
                1_002,
                &random,
            )
            .unwrap_err();
        assert_eq!(
            autonomous.diagnostic.code,
            "SNAPBACK_AUTH_INTEGRATION_INSTALLATION_REQUIRED"
        );

        seed_agent(&mut db, "agent-other");
        seed_grant(&db, "grant-wrong-actor", "agent-other", None, None, 12);
        let wrong_actor = db
            .mint_scoped_token(
                &integration.secret,
                "grant-wrong-actor",
                Some(1_000),
                1_003,
                &random,
            )
            .unwrap_err();
        assert_eq!(
            wrong_actor.diagnostic.code,
            "SNAPBACK_AUTH_INTEGRATION_INSTALLATION_REQUIRED"
        );
        assert_eq!(wrong_actor.diagnostic.details["reason"], "actor_mismatch");

        let plain = db
            .issue_initial_agent_credential("agent-other", 1_004, &random)
            .unwrap();
        db.mint_scoped_token(
            &plain.secret,
            "grant-wrong-actor",
            Some(1_000),
            1_005,
            &random,
        )
        .expect("ordinary autonomous agent mint remains supported");
    }

    #[test]
    fn suspension_gates_mint_and_ceremony_then_resume_restores_admission() {
        let random = CounterRandom::new();
        let mut db = ready_database();
        let integration = register_integration(&mut db, &random);
        seed_human(&db, "user-a");
        seed_grant(
            &db,
            "grant-install",
            &integration.user_id,
            Some("user-a"),
            Some("pair-install"),
            20,
        );
        db.set_integration_suspended(&integration.user_id, true, 1_010)
            .unwrap();
        let mint = db
            .mint_scoped_token(
                &integration.secret,
                "grant-install",
                Some(1_000),
                1_011,
                &random,
            )
            .unwrap_err();
        assert_eq!(mint.diagnostic.code, "SNAPBACK_AUTH_INTEGRATION_SUSPENDED");
        assert!(mint.diagnostic.message.contains("suspended"));
        assert!(!mint.diagnostic.message.contains("revok"));
        let ceremony =
            require_active_if_integration_on(&db.conn, &integration.user_id).unwrap_err();
        assert_eq!(
            ceremony.diagnostic.details["operatorAction"],
            "auth.integrationResume"
        );
        db.set_integration_suspended(&integration.user_id, false, 1_012)
            .unwrap();
        db.mint_scoped_token(
            &integration.secret,
            "grant-install",
            Some(1_000),
            1_013,
            &random,
        )
        .expect("resume removes only the integration admission block");
    }

    #[test]
    fn retirement_atomically_revokes_record_family_tokens_and_installations() {
        let random = CounterRandom::new();
        let mut db = ready_database();
        let integration = register_integration(&mut db, &random);
        seed_human(&db, "user-a");
        seed_grant(
            &db,
            "grant-install",
            &integration.user_id,
            Some("user-a"),
            Some("pair-install"),
            30,
        );
        let token = db
            .mint_scoped_token(
                &integration.secret,
                "grant-install",
                Some(1_000),
                1_001,
                &random,
            )
            .unwrap();
        db.resolve_scoped_token(&token.secret, 1_002).unwrap();
        let retired = db
            .retire_integration_credential_family(&integration.secret, 1_003)
            .unwrap();
        assert_eq!(
            retired.user_id.as_deref(),
            Some(integration.user_id.as_str())
        );
        assert!(retired.grant_ids.contains(&"grant-install".to_owned()));
        assert_eq!(
            db.integration_record_for_test(&integration.user_id)
                .unwrap()
                .unwrap()
                .status,
            IntegrationStatus::Revoked
        );
        let (credential_revoked, grant_revoked, token_revoked): (
            Option<i64>,
            Option<i64>,
            Option<i64>,
        ) = db
            .conn
            .query_row(
                "SELECT c.revoked_at_ms, g.revoked_at_ms, t.revoked_at_ms
                 FROM _auth_agent_credentials AS c
                 JOIN _auth_grants AS g ON g.actor_user_id = c.user_id
                 JOIN _auth_grant_tokens AS t ON t.grant_id = g.id
                 WHERE c.user_id = ?1 AND g.id = 'grant-install'",
                params![integration.user_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (credential_revoked, grant_revoked, token_revoked),
            (Some(1_003), Some(1_003), Some(1_003))
        );
        assert!(db.resolve_scoped_token(&token.secret, 1_004).is_err());
        db.retire_integration_credential_family(&integration.secret, 1_005)
            .expect("terminal retry is idempotent");
    }

    #[test]
    fn activation_refuses_an_integration_with_autonomous_authority() {
        let random = CounterRandom::new();
        let mut db = ready_database();
        let integration = register_integration(&mut db, &random);
        seed_grant(
            &db,
            "grant-autonomous",
            &integration.user_id,
            None,
            None,
            40,
        );
        let error = db
            .with_auth_transaction(|tx| activate_manifest_in(tx, &api_manifest()))
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_INTEGRATION_CLASS_INVALID"
        );
        assert_eq!(error.diagnostic.details["userId"], integration.user_id);
        assert_eq!(error.diagnostic.details["reason"], "autonomous_grant");
    }
}
impl super::ServingDatabase {
    #[allow(clippy::too_many_arguments)]
    pub fn begin_oauth_authorization(
        &mut self,
        consenting_user_id: &str,
        client_id: &str,
        redirect_uri: &str,
        bundle_names: &[String],
        code_challenge: &str,
        oauth_state: Option<&str>,
        now_ms: u64,
        random: &dyn crate::auth::crypto::RandomSource,
    ) -> SnapbackResult<BegunOAuthAuthorization> {
        self.db.begin_oauth_authorization(
            consenting_user_id,
            client_id,
            redirect_uri,
            bundle_names,
            code_challenge,
            oauth_state,
            now_ms,
            random,
        )
    }
    pub fn issue_oauth_authorization_code(
        &mut self,
        consenting_user_id: &str,
        request_id: &str,
        now_ms: u64,
        random: &dyn crate::auth::crypto::RandomSource,
    ) -> SnapbackResult<IssuedOAuthAuthorization> {
        self.db
            .issue_oauth_authorization_code(consenting_user_id, request_id, now_ms, random)
    }
    pub fn deny_oauth_authorization(
        &mut self,
        consenting_user_id: &str,
        request_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<DeniedOAuthAuthorization> {
        self.db
            .deny_oauth_authorization(consenting_user_id, request_id, now_ms)
    }
    pub fn set_integration_suspended(
        &mut self,
        principal_user_id: &str,
        suspended: bool,
        now_ms: u64,
    ) -> SnapbackResult<IntegrationRecord> {
        self.db
            .set_integration_suspended(principal_user_id, suspended, now_ms)
    }
}
