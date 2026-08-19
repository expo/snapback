//! Manifest-activated storage for LLP 0204 v1 shareable capability links.
//!
//! The raw bearer is returned by the mint operation and never stored. SQLite
//! retains a domain-separated hash plus a short lookup prefix; resolution
//! still constant-time compares the complete hash before returning a row.

use super::{LocalDatabase, SnapbackResult};
use crate::diagnostic::SnapbackError;
use crate::manifest::SchemaManifest;
use base64::Engine as _;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::Serialize;
use sha2::{Digest as _, Sha256};

pub const CAPABILITY_LINK_TABLE: &str = "_snapback_capability_links";
pub const CAPABILITY_LINK_TOKEN_PREFIX: &str = "sbl_";
pub const CAPABILITY_LINK_PINNED_ARGS_MAX_BYTES: usize = 256 * 1024;
pub const CAPABILITY_LINK_CALLER_ARGS_MAX_BYTES: usize = 16 * 1024;
const TOKEN_BYTES: usize = 32;
const TOKEN_LOOKUP_BYTES: usize = 16;
const MAX_SAFE_COUNTER: u64 = 9_007_199_254_740_991;

const TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS _snapback_capability_links (
  id TEXT NOT NULL PRIMARY KEY,
  token_lookup BLOB NOT NULL UNIQUE CHECK(length(token_lookup) = 16),
  token_hash BLOB NOT NULL CHECK(length(token_hash) = 32),
  minter_principal_id TEXT NOT NULL,
  minter_session_id TEXT NOT NULL,
  minter_authority_instance_id TEXT NOT NULL,
  function_id TEXT NOT NULL,
  function_name TEXT NOT NULL,
  function_kind TEXT NOT NULL CHECK(function_kind IN ('query', 'mutation', 'action')),
  pinned_args_json TEXT NOT NULL
    CHECK(length(CAST(pinned_args_json AS BLOB)) <= 262144),
  caller_args_json TEXT NOT NULL
    CHECK(length(CAST(caller_args_json AS BLOB)) <= 16384),
  expires_at_ms INTEGER NOT NULL
    CHECK(expires_at_ms BETWEEN 0 AND 9007199254740991),
  remaining_uses INTEGER
    CHECK(remaining_uses IS NULL OR remaining_uses BETWEEN 0 AND 9007199254740991),
  approval_per_use INTEGER NOT NULL DEFAULT 0 CHECK(approval_per_use IN (0, 1)),
  status TEXT NOT NULL CHECK(status IN ('active', 'revoked')),
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  updated_at_ms INTEGER NOT NULL
    CHECK(updated_at_ms BETWEEN created_at_ms AND 9007199254740991),
  use_count INTEGER NOT NULL DEFAULT 0
    CHECK(use_count BETWEEN 0 AND 9007199254740991),
  last_used_at_ms INTEGER
    CHECK(last_used_at_ms IS NULL OR last_used_at_ms BETWEEN created_at_ms AND 9007199254740991),
  last_outcome TEXT CHECK(last_outcome IS NULL OR length(CAST(last_outcome AS BLOB)) <= 128)
);
"#;

const MINTER_INDEX_SQL: &str = r#"
CREATE INDEX IF NOT EXISTS _snapback_capability_links_minter
  ON _snapback_capability_links(minter_principal_id, status, expires_at_ms, id);
"#;

const EXPIRY_INDEX_SQL: &str = r#"
CREATE INDEX IF NOT EXISTS _snapback_capability_links_expiry
  ON _snapback_capability_links(status, expires_at_ms, id);
"#;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CapabilityLinkFunctionKind {
    Query,
    Mutation,
    Action,
}

impl CapabilityLinkFunctionKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Query => "query",
            Self::Mutation => "mutation",
            Self::Action => "action",
        }
    }

    fn parse(value: &str) -> SnapbackResult<Self> {
        match value {
            "query" => Ok(Self::Query),
            "mutation" => Ok(Self::Mutation),
            "action" => Ok(Self::Action),
            _ => Err(catalog_corrupt()),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityLinkRecord {
    pub id: String,
    #[serde(skip_serializing)]
    pub minter_principal_id: String,
    #[serde(skip_serializing)]
    pub minter_session_id: String,
    #[serde(skip_serializing)]
    pub minter_authority_instance_id: String,
    pub function_id: String,
    pub function_name: String,
    pub function_kind: CapabilityLinkFunctionKind,
    #[serde(skip_serializing)]
    pub pinned_args_json: String,
    pub caller_args: Vec<String>,
    pub expires_at_ms: u64,
    pub remaining_uses: Option<u64>,
    pub approval_per_use: bool,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub use_count: u64,
    pub last_used_at_ms: Option<u64>,
    pub last_outcome: Option<String>,
}

#[derive(Clone, Debug)]
pub struct MintCapabilityLink {
    pub minter_principal_id: String,
    pub minter_session_id: String,
    pub minter_authority_instance_id: String,
    pub function_id: String,
    pub function_name: String,
    pub function_kind: CapabilityLinkFunctionKind,
    pub pinned_args_json: String,
    pub caller_args: Vec<String>,
    pub expires_at_ms: u64,
    pub remaining_uses: Option<u64>,
    pub approval_per_use: bool,
    pub now_ms: u64,
}

#[derive(Clone, Debug)]
pub struct MintedCapabilityLink {
    pub record: CapabilityLinkRecord,
    pub token: String,
}

#[derive(Clone, Debug)]
pub struct CapabilityLinkUse {
    pub ordinal: u64,
}

pub fn manifest_enabled(manifest: &SchemaManifest) -> bool {
    manifest.api.as_ref().is_some_and(|api| api.enabled)
}

/// @ref LLP 0204#d94--shareable-capability-links — link state exists only for
/// an activated external API surface and disappears when that surface closes.
pub(crate) fn activate_manifest_in(
    tx: &Transaction<'_>,
    manifest: &SchemaManifest,
) -> SnapbackResult<()> {
    if !manifest_enabled(manifest) {
        tx.execute_batch("DROP TABLE IF EXISTS _snapback_capability_links;")?;
        return Ok(());
    }
    tx.execute_batch(TABLE_SQL)?;
    if !table_has_column(tx, "approval_per_use")? {
        tx.execute_batch(
            "DROP INDEX IF EXISTS _snapback_capability_links_minter;
             DROP INDEX IF EXISTS _snapback_capability_links_expiry;
             ALTER TABLE _snapback_capability_links RENAME TO _snapback_capability_links_previous;",
        )?;
        tx.execute_batch(TABLE_SQL)?;
        tx.execute_batch(
            "INSERT INTO _snapback_capability_links(
               id, token_lookup, token_hash, minter_principal_id,
               minter_session_id, minter_authority_instance_id, function_id,
               function_name, function_kind, pinned_args_json, caller_args_json,
               expires_at_ms, remaining_uses, approval_per_use, status,
               created_at_ms, updated_at_ms, use_count, last_used_at_ms,
               last_outcome)
             SELECT id, token_lookup, token_hash, minter_principal_id,
               minter_session_id, minter_authority_instance_id, function_id,
               function_name, function_kind, pinned_args_json, caller_args_json,
               expires_at_ms, remaining_uses, 0, status, created_at_ms,
               updated_at_ms, use_count, last_used_at_ms, last_outcome
             FROM _snapback_capability_links_previous;
             DROP TABLE _snapback_capability_links_previous;",
        )?;
    }
    tx.execute_batch(MINTER_INDEX_SQL)?;
    tx.execute_batch(EXPIRY_INDEX_SQL)?;
    validate_exact_schema(tx)
}

fn table_has_column(conn: &Connection, column: &str) -> SnapbackResult<bool> {
    let mut statement = conn.prepare("PRAGMA table_info(_snapback_capability_links)")?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(names.iter().any(|name| name == column))
}

pub(super) fn validate_exact_schema(conn: &Connection) -> SnapbackResult<()> {
    let reference = Connection::open_in_memory()?;
    reference.execute_batch("PRAGMA foreign_keys = ON;")?;
    reference.execute_batch(
        "CREATE TABLE _auth_users(id TEXT NOT NULL PRIMARY KEY, kind TEXT, deactivated_at_ms INTEGER);",
    )?;
    reference.execute_batch(TABLE_SQL)?;
    reference.execute_batch(MINTER_INDEX_SQL)?;
    reference.execute_batch(EXPIRY_INDEX_SQL)?;
    if catalog_objects(conn)? != catalog_objects(&reference)? {
        return Err(catalog_corrupt());
    }
    Ok(())
}

fn catalog_objects(conn: &Connection) -> SnapbackResult<Vec<(String, String, String, String)>> {
    let mut statement = conn.prepare(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_schema
         WHERE name = '_snapback_capability_links'
            OR tbl_name = '_snapback_capability_links'
         ORDER BY type, name",
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn table_exists(conn: &Connection) -> SnapbackResult<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1",
            params![CAPABILITY_LINK_TABLE],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn generate_token() -> SnapbackResult<String> {
    let mut bytes = [0_u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_RANDOM_UNAVAILABLE",
            "capability-links",
            "the operating system CSPRNG did not produce a capability-link token",
        )
    })?;
    Ok(format!(
        "{CAPABILITY_LINK_TOKEN_PREFIX}{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    ))
}

fn presented_hash(token: &str) -> Option<[u8; 32]> {
    let encoded = token.strip_prefix(CAPABILITY_LINK_TOKEN_PREFIX)?;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded)
        .ok()?;
    if decoded.len() != TOKEN_BYTES
        || base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&decoded) != encoded
    {
        return None;
    }
    let mut hasher = Sha256::new();
    hasher.update(b"snapback:capability-link-token:v1\n");
    hasher.update(token.as_bytes());
    Some(hasher.finalize().into())
}

pub fn token_has_closed_shape(token: &str) -> bool {
    presented_hash(token).is_some()
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn row_for_id_on(conn: &Connection, id: &str) -> SnapbackResult<Option<CapabilityLinkRecord>> {
    conn.query_row(
        "SELECT id, minter_principal_id, minter_session_id,
                minter_authority_instance_id, function_id, function_name,
                function_kind, pinned_args_json, caller_args_json,
                expires_at_ms, remaining_uses, approval_per_use, created_at_ms,
                updated_at_ms, use_count, last_used_at_ms, last_outcome
         FROM _snapback_capability_links WHERE id = ?1",
        params![id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, i64>(9)? as u64,
                row.get::<_, Option<i64>>(10)?.map(|value| value as u64),
                row.get::<_, i64>(11)? != 0,
                row.get::<_, i64>(12)? as u64,
                row.get::<_, i64>(13)? as u64,
                row.get::<_, i64>(14)? as u64,
                row.get::<_, Option<i64>>(15)?.map(|value| value as u64),
                row.get::<_, Option<String>>(16)?,
            ))
        },
    )
    .optional()?
    .map(|row| {
        let caller_args =
            serde_json::from_str::<Vec<String>>(&row.8).map_err(|_| catalog_corrupt())?;
        Ok(CapabilityLinkRecord {
            id: row.0,
            minter_principal_id: row.1,
            minter_session_id: row.2,
            minter_authority_instance_id: row.3,
            function_id: row.4,
            function_name: row.5,
            function_kind: CapabilityLinkFunctionKind::parse(&row.6)?,
            pinned_args_json: row.7,
            caller_args,
            expires_at_ms: row.9,
            remaining_uses: row.10,
            approval_per_use: row.11,
            created_at_ms: row.12,
            updated_at_ms: row.13,
            use_count: row.14,
            last_used_at_ms: row.15,
            last_outcome: row.16,
        })
    })
    .transpose()
}

fn resolve_on(conn: &Connection, token: &str, now_ms: u64) -> SnapbackResult<CapabilityLinkRecord> {
    let hash = presented_hash(token).ok_or_else(unavailable)?;
    let lookup = &hash[..TOKEN_LOOKUP_BYTES];
    let candidate: Option<(String, Vec<u8>)> = conn
        .query_row(
            "SELECT id, token_hash FROM _snapback_capability_links WHERE token_lookup = ?1",
            params![lookup],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (id, stored_hash) = candidate.ok_or_else(unavailable)?;
    if !constant_time_eq(&stored_hash, &hash) {
        return Err(unavailable());
    }
    let valid: Option<()> = conn
        .query_row(
            "SELECT 1 FROM _snapback_capability_links AS l
             JOIN _auth_users AS u ON u.id = l.minter_principal_id
             WHERE l.id = ?1 AND l.status = 'active' AND l.expires_at_ms > ?2
               AND (l.remaining_uses IS NULL OR l.remaining_uses > 0)
               AND u.kind = 'human' AND u.deactivated_at_ms IS NULL",
            params![id, now_ms as i64],
            |_| Ok(()),
        )
        .optional()?;
    if valid.is_none() {
        return Err(unavailable());
    }
    row_for_id_on(conn, &id)?.ok_or_else(catalog_corrupt)
}

impl LocalDatabase {
    pub fn mint_capability_link(
        &mut self,
        request: MintCapabilityLink,
    ) -> SnapbackResult<MintedCapabilityLink> {
        if !table_exists(&self.conn)? {
            return Err(unavailable());
        }
        if request.pinned_args_json.len() > CAPABILITY_LINK_PINNED_ARGS_MAX_BYTES {
            return Err(input_invalid(
                "pinnedArgs exceeds the capability-link storage bound",
            ));
        }
        let caller_args_json = serde_json::to_string(&request.caller_args)
            .map_err(|_| input_invalid("callerArgs does not serialize"))?;
        if caller_args_json.len() > CAPABILITY_LINK_CALLER_ARGS_MAX_BYTES {
            return Err(input_invalid(
                "callerArgs exceeds the capability-link storage bound",
            ));
        }
        let token = generate_token()?;
        let hash = presented_hash(&token).expect("fresh token has the closed shape");
        let id = crate::ids::mint_time_ordered(crate::ids::Kind::CapabilityLink);
        let id_for_read = id.clone();
        let token_lookup = hash[..TOKEN_LOOKUP_BYTES].to_vec();
        let token_hash = hash.to_vec();
        self.with_auth_transaction(|tx| {
            let principal_live: Option<()> = tx
                .query_row(
                    "SELECT 1 FROM _auth_users
                     WHERE id = ?1 AND kind = 'human' AND deactivated_at_ms IS NULL",
                    params![request.minter_principal_id],
                    |_| Ok(()),
                )
                .optional()?;
            if principal_live.is_none() {
                return Err(SnapbackError::error(
                    "SNAPBACK_CAPABILITY_LINK_MINTER_INVALID",
                    "capability-links",
                    "capability-link minting requires a live session principal",
                ));
            }
            tx.execute(
                "INSERT INTO _snapback_capability_links(
                   id, token_lookup, token_hash, minter_principal_id,
                   minter_session_id, minter_authority_instance_id,
                   function_id, function_name, function_kind, pinned_args_json,
                   caller_args_json, expires_at_ms, remaining_uses, status,
                   approval_per_use, created_at_ms, updated_at_ms, use_count
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                          ?12, ?13, 'active', ?14, ?15, ?15, 0)",
                params![
                    id,
                    token_lookup,
                    token_hash,
                    request.minter_principal_id,
                    request.minter_session_id,
                    request.minter_authority_instance_id,
                    request.function_id,
                    request.function_name,
                    request.function_kind.as_str(),
                    request.pinned_args_json,
                    caller_args_json,
                    request.expires_at_ms as i64,
                    request.remaining_uses.map(|value| value as i64),
                    i64::from(request.approval_per_use),
                    request.now_ms as i64,
                ],
            )?;
            Ok(())
        })?;
        Ok(MintedCapabilityLink {
            record: row_for_id_on(&self.conn, &id_for_read)?.ok_or_else(catalog_corrupt)?,
            token,
        })
    }

    /// Resolve without changing any durable fact. Unknown, revoked, expired,
    /// exhausted, and dead-lineage links deliberately share one refusal.
    pub fn resolve_capability_link(
        &self,
        token: &str,
        now_ms: u64,
    ) -> SnapbackResult<CapabilityLinkRecord> {
        if !table_exists(&self.conn)? {
            return Err(unavailable());
        }
        resolve_on(&self.conn, token, now_ms)
    }

    /// Revalidate a link-originated approval against the live minter lineage.
    /// Exhaustion is intentionally irrelevant here: the invocation consumed
    /// its use before creating the pending effect.
    pub fn capability_link_effect_origin(
        &self,
        id: &str,
        now_ms: u64,
    ) -> SnapbackResult<CapabilityLinkRecord> {
        let live: Option<()> = self
            .conn
            .query_row(
                "SELECT 1 FROM _snapback_capability_links AS l
             JOIN _auth_users AS u ON u.id = l.minter_principal_id
             WHERE l.id = ?1 AND l.status = 'active' AND l.expires_at_ms > ?2
               AND u.kind = 'human' AND u.deactivated_at_ms IS NULL",
                params![id, now_ms as i64],
                |_| Ok(()),
            )
            .optional()?;
        if live.is_none() {
            return Err(unavailable());
        }
        row_for_id_on(&self.conn, id)?.ok_or_else(catalog_corrupt)
    }

    /// Atomically consume one use. The principal-validity and revocation
    /// predicates are repeated inside this immediate transaction, which is the
    /// CAS fence preventing a single-use link from double firing.
    ///
    /// @ref LLP 0150#dated-amendment-llp-0204-capability-link-bearer-exception-2026-08-08
    pub fn consume_capability_link_use(
        &mut self,
        id: &str,
        now_ms: u64,
    ) -> SnapbackResult<CapabilityLinkUse> {
        let id = id.to_owned();
        self.with_auth_transaction(|tx| {
            let changed = tx.execute(
                "UPDATE _snapback_capability_links
                 SET remaining_uses = CASE
                       WHEN remaining_uses IS NULL THEN NULL
                       ELSE remaining_uses - 1 END,
                     use_count = CASE WHEN use_count < ?1 THEN use_count + 1 ELSE use_count END,
                     last_used_at_ms = ?2, last_outcome = 'admitted', updated_at_ms = ?2
                 WHERE id = ?3 AND status = 'active' AND expires_at_ms > ?2
                   AND (remaining_uses IS NULL OR remaining_uses > 0)
                   AND EXISTS(
                     SELECT 1 FROM _auth_users AS u
                     WHERE u.id = minter_principal_id
                       AND u.kind = 'human' AND u.deactivated_at_ms IS NULL
                   )",
                params![MAX_SAFE_COUNTER as i64, now_ms as i64, id],
            )?;
            if changed != 1 {
                return Err(unavailable());
            }
            let record = row_for_id_on(tx, &id)?.ok_or_else(catalog_corrupt)?;
            Ok(CapabilityLinkUse {
                ordinal: record.use_count,
            })
        })
    }

    pub fn settle_capability_link_use(
        &mut self,
        id: &str,
        ordinal: u64,
        outcome: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        let outcome = if outcome.len() <= 128 {
            outcome
        } else {
            "failed"
        };
        self.with_auth_transaction(|tx| {
            tx.execute(
                "UPDATE _snapback_capability_links
                 SET last_outcome = ?1, updated_at_ms = MAX(updated_at_ms, ?2)
                 WHERE id = ?3 AND use_count = ?4",
                params![outcome, now_ms as i64, id, ordinal as i64],
            )?;
            Ok(())
        })
    }

    pub fn revoke_capability_link(
        &mut self,
        id: &str,
        minter_principal_id: &str,
        minter_session_id: &str,
        minter_authority_instance_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        let changed = self.with_auth_transaction(|tx| {
            Ok(tx.execute(
                "UPDATE _snapback_capability_links
                 SET status = 'revoked', updated_at_ms = ?1
                 WHERE id = ?2 AND status = 'active'
                   AND minter_principal_id = ?3 AND minter_session_id = ?4
                   AND minter_authority_instance_id = ?5",
                params![
                    now_ms as i64,
                    id,
                    minter_principal_id,
                    minter_session_id,
                    minter_authority_instance_id,
                ],
            )?)
        })?;
        if changed == 1 {
            Ok(())
        } else {
            Err(SnapbackError::error(
                "SNAPBACK_CAPABILITY_LINK_REVOKE_DENIED",
                "capability-links",
                "only the exact minting session may revoke an active capability link",
            ))
        }
    }
}

fn unavailable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_CAPABILITY_LINK_UNAVAILABLE",
        "capability-links",
        "the capability link is unavailable",
    )
}

fn input_invalid(message: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_CAPABILITY_LINK_INPUT_INVALID",
        "capability-links",
        message,
    )
}

fn catalog_corrupt() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_CAPABILITY_LINK_CATALOG_CORRUPT",
        "capability-links",
        "capability-link catalog differs from the exact protected shape",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("capability-link database");
        db.activate_current_auth_catalog()
            .expect("activate minter catalog");
        db.conn
            .execute_batch(TABLE_SQL)
            .expect("activate link table");
        db.conn
            .execute_batch(MINTER_INDEX_SQL)
            .expect("activate minter index");
        db.conn
            .execute_batch(EXPIRY_INDEX_SQL)
            .expect("activate expiry index");
        db.conn
            .execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES('human-a', 1)",
                [],
            )
            .expect("seed human minter");
        db
    }

    fn mint(db: &mut LocalDatabase, expires_at_ms: u64, uses: Option<u64>) -> MintedCapabilityLink {
        db.mint_capability_link(MintCapabilityLink {
            minter_principal_id: "human-a".to_owned(),
            minter_session_id: "session-a".to_owned(),
            minter_authority_instance_id: "authority-a".to_owned(),
            function_id: "fn:publicQuery".to_owned(),
            function_name: "publicQuery".to_owned(),
            function_kind: CapabilityLinkFunctionKind::Query,
            pinned_args_json: r#"{"pinned":"value"}"#.to_owned(),
            caller_args: vec!["caller".to_owned()],
            expires_at_ms,
            remaining_uses: uses,
            approval_per_use: false,
            now_ms: 10,
        })
        .expect("mint capability link")
    }

    #[test]
    fn protected_table_activation_tracks_api_enabled_exactly() {
        let mut db = LocalDatabase::memory().expect("capability-link database");
        db.activate_current_auth_catalog()
            .expect("activate auth catalog");
        let manifest = |enabled| SchemaManifest {
            api: Some(crate::manifest::ApiManifest {
                enabled,
                ..crate::manifest::ApiManifest::default()
            }),
            ..SchemaManifest::default()
        };
        db.with_auth_transaction(|tx| activate_manifest_in(tx, &manifest(false)))
            .unwrap();
        assert!(!table_exists(&db.conn).unwrap());
        db.with_auth_transaction(|tx| activate_manifest_in(tx, &manifest(true)))
            .unwrap();
        assert!(table_exists(&db.conn).unwrap());
        db.with_auth_transaction(|tx| activate_manifest_in(tx, &manifest(false)))
            .unwrap();
        assert!(!table_exists(&db.conn).unwrap());
    }

    #[test]
    fn bearer_is_returned_once_but_never_persisted_and_landing_is_inert() {
        let mut db = ready();
        let minted = mint(&mut db, 1_000, Some(2));
        assert!(token_has_closed_shape(&minted.token));
        assert!(
            !serde_json::to_string(&minted.record)
                .unwrap()
                .contains(&minted.token)
        );
        let stored: (String, String, i64) = db
            .conn
            .query_row(
                "SELECT hex(token_lookup), hex(token_hash), use_count
                 FROM _snapback_capability_links WHERE id = ?1",
                params![minted.record.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert!(!stored.0.contains(&minted.token));
        assert!(!stored.1.contains(&minted.token));
        assert_eq!(stored.2, 0);

        let first = db.resolve_capability_link(&minted.token, 11).unwrap();
        let second = db.resolve_capability_link(&minted.token, 12).unwrap();
        assert_eq!(first.use_count, 0);
        assert_eq!(second.use_count, 0);
        assert_eq!(first.remaining_uses, Some(2));
        assert_eq!(second.remaining_uses, Some(2));
    }

    #[test]
    fn unknown_revoked_expired_exhausted_and_dead_lineage_are_one_refusal() {
        let mut db = ready();
        let revoked = mint(&mut db, 1_000, Some(1));
        db.revoke_capability_link(
            &revoked.record.id,
            "human-a",
            "session-a",
            "authority-a",
            20,
        )
        .unwrap();
        let expired = mint(&mut db, 20, Some(1));
        let exhausted = mint(&mut db, 1_000, Some(1));
        db.consume_capability_link_use(&exhausted.record.id, 20)
            .unwrap();
        let dead = mint(&mut db, 1_000, Some(1));
        db.conn
            .execute("DELETE FROM _auth_users WHERE id = 'human-a'", [])
            .unwrap();
        for error in [
            db.resolve_capability_link("sbl_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", 21)
                .unwrap_err(),
            db.resolve_capability_link(&revoked.token, 21).unwrap_err(),
            db.resolve_capability_link(&expired.token, 21).unwrap_err(),
            db.resolve_capability_link(&exhausted.token, 21)
                .unwrap_err(),
            db.resolve_capability_link(&dead.token, 21).unwrap_err(),
        ] {
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_CAPABILITY_LINK_UNAVAILABLE"
            );
            assert_eq!(
                error.diagnostic.message,
                "the capability link is unavailable"
            );
            assert_eq!(error.diagnostic.details, serde_json::json!({}));
        }
    }

    #[test]
    fn only_exact_minting_session_can_revoke() {
        let mut db = ready();
        let minted = mint(&mut db, 1_000, Some(1));
        let error = db
            .revoke_capability_link(&minted.record.id, "human-a", "session-b", "authority-b", 20)
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CAPABILITY_LINK_REVOKE_DENIED"
        );
        db.resolve_capability_link(&minted.token, 21).unwrap();
    }

    #[test]
    fn single_use_compare_and_swap_admits_exactly_one_competing_consumer() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("capability-link.sqlite");
        let mut db = LocalDatabase::open(&path).unwrap();
        db.activate_current_auth_catalog().unwrap();
        db.conn.execute_batch(TABLE_SQL).unwrap();
        db.conn.execute_batch(MINTER_INDEX_SQL).unwrap();
        db.conn.execute_batch(EXPIRY_INDEX_SQL).unwrap();
        db.conn
            .execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES('human-a', 1)",
                [],
            )
            .unwrap();
        let minted = mint(&mut db, 1_000, Some(1));
        let id = minted.record.id;
        drop(db);

        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let contenders = [0, 1].map(|_| {
            let path = path.clone();
            let barrier = barrier.clone();
            let id = id.clone();
            std::thread::spawn(move || {
                let mut db = LocalDatabase::open(path).unwrap();
                barrier.wait();
                db.consume_capability_link_use(&id, 20)
            })
        });
        let results = contenders.map(|thread| thread.join().unwrap());
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        let refusal = results
            .iter()
            .find_map(|result| result.as_ref().err())
            .expect("one contender is refused");
        assert_eq!(
            refusal.diagnostic.code,
            "SNAPBACK_CAPABILITY_LINK_UNAVAILABLE"
        );
    }
}
