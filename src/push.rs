//! Platform-owned Expo push-token custody.
//!
//! This module is deliberately registry-only. Provider transmission and the
//! handoff ledger remain absent until later LLP 0143 slices; nothing here
//! upgrades the first-class `notifications` capability.
//!
//! @ref LLP 0143#d1-device-token-custody — token bytes remain in a protected
//!   system table, with one live owner and generation-fenced retirement.

use crate::auth::wire::SecretInput;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::ids::{self, Kind};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::sync::OnceLock;

pub(crate) const PUSH_TOKEN_MAX_BYTES: usize = 1_024;
pub(crate) const PUSH_INSTALLATION_MAX_BYTES: usize = 64;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushAppScopeV1 {
    pub eas_project_id: String,
    pub application_id: String,
    pub environment: String,
}

impl PushAppScopeV1 {
    pub(crate) fn validate(&self) -> SnapbackResult<()> {
        for (field, value) in [
            ("easProjectId", &self.eas_project_id),
            ("applicationId", &self.application_id),
            ("environment", &self.environment),
        ] {
            if value.is_empty()
                || value.len() > 255
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"._-:".contains(&byte))
            {
                return Err(invalid(format!(
                    "push appScope.{field} must be 1..255 ASCII letters, digits, '.', '_', '-', or ':'"
                )));
            }
        }
        Ok(())
    }

    fn identity(&self) -> String {
        format!(
            "{}:{}|{}:{}|{}:{}",
            self.eas_project_id.len(),
            self.eas_project_id,
            self.application_id.len(),
            self.application_id,
            self.environment.len(),
            self.environment,
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushRegistryDeclarationV1 {
    pub idle_retention_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushSeamDeclarationV1 {
    pub app_scope: PushAppScopeV1,
    pub registry: PushRegistryDeclarationV1,
}

impl PushSeamDeclarationV1 {
    pub(crate) fn validate(&self) -> SnapbackResult<()> {
        self.app_scope.validate()?;
        if !(86_400_000..=31_536_000_000).contains(&self.registry.idle_retention_ms) {
            return Err(invalid(
                "push registry idleRetentionMs must be between one day and one year",
            ));
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RegisterPushTokenRequest {
    pub(crate) installation_id: String,
    pub(crate) token: SecretInput,
}

impl std::fmt::Debug for RegisterPushTokenRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RegisterPushTokenRequest")
            .field("installation_id", &self.installation_id)
            .field("token", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UnregisterPushTokenRequest {
    pub(crate) installation_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PushTokenRegistrationResponse {
    pub(crate) token_id: String,
    pub(crate) installation_id: String,
    pub(crate) registered_at: u64,
    pub(crate) rotated: bool,
    pub(crate) ownership_transferred: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PushTokenUnregisterResponse {
    pub(crate) token_id: Option<String>,
    pub(crate) retired: bool,
}

pub(crate) struct Registration<'a> {
    pub(crate) declaration: &'a PushSeamDeclarationV1,
    pub(crate) principal_id: &'a str,
    pub(crate) session_id: &'a str,
    pub(crate) session_generation: u64,
    pub(crate) installation_id: &'a str,
    pub(crate) token: &'a str,
    pub(crate) now_ms: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PushRegistryInspectionV1 {
    pub live_tokens: u64,
    pub retired_tokens: u64,
    pub retirement_reasons: BTreeMap<String, u64>,
}

const SESSION_TERMINAL_TRIGGER_SQL: &str = "
CREATE TRIGGER IF NOT EXISTS _snapback_push_session_terminal_v1
  AFTER UPDATE OF generation, revoked_at_ms ON _auth_sessions
  WHEN NEW.revoked_at_ms IS NOT NULL
    AND (OLD.revoked_at_ms IS NULL OR NEW.generation != OLD.generation)
BEGIN
  UPDATE _snapback_push_tokens_v1
  SET retired_at_ms = NEW.revoked_at_ms,
      retirement_reason = 'session-ended',
      retirement_reference = OLD.id,
      token_bytes = '', token_hash = zeroblob(32)
  WHERE session_id = OLD.id AND session_generation = OLD.generation
    AND retired_at_ms IS NULL;
END;";

const CLOCK_FLOOR_INSERT_TRIGGER_SQL: &str = "
CREATE TRIGGER IF NOT EXISTS _snapback_push_clock_floor_insert_v1
  AFTER INSERT ON _snapback_meta
  WHEN NEW.key = 'auth_session_clock_floor_ms'
BEGIN
  UPDATE _snapback_push_tokens_v1
  SET retired_at_ms = CAST(NEW.value AS INTEGER),
      retirement_reason = 'session-expired',
      retirement_reference = session_id,
      token_bytes = '', token_hash = zeroblob(32)
  WHERE retired_at_ms IS NULL AND EXISTS(
    SELECT 1 FROM _auth_sessions AS session
    WHERE session.id = _snapback_push_tokens_v1.session_id
      AND session.generation = _snapback_push_tokens_v1.session_generation
      AND session.expires_at_ms <= CAST(NEW.value AS INTEGER)
  );
END;";

const CLOCK_FLOOR_UPDATE_TRIGGER_SQL: &str = "
CREATE TRIGGER IF NOT EXISTS _snapback_push_clock_floor_update_v1
  AFTER UPDATE OF value ON _snapback_meta
  WHEN NEW.key = 'auth_session_clock_floor_ms'
BEGIN
  UPDATE _snapback_push_tokens_v1
  SET retired_at_ms = CAST(NEW.value AS INTEGER),
      retirement_reason = 'session-expired',
      retirement_reference = session_id,
      token_bytes = '', token_hash = zeroblob(32)
  WHERE retired_at_ms IS NULL AND EXISTS(
    SELECT 1 FROM _auth_sessions AS session
    WHERE session.id = _snapback_push_tokens_v1.session_id
      AND session.generation = _snapback_push_tokens_v1.session_generation
      AND session.expires_at_ms <= CAST(NEW.value AS INTEGER)
  );
END;";

const REGISTRY_TABLE_SQL: &str = "
CREATE TABLE IF NOT EXISTS _snapback_push_tokens_v1 (
  id TEXT NOT NULL PRIMARY KEY,
  app_scope TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  token_hash BLOB NOT NULL CHECK(length(token_hash) = 32),
  token_bytes TEXT NOT NULL,
  session_id TEXT NOT NULL,
  session_generation INTEGER NOT NULL CHECK(session_generation >= 1),
  registered_at_ms INTEGER NOT NULL CHECK(registered_at_ms >= 0),
  last_registered_at_ms INTEGER NOT NULL CHECK(last_registered_at_ms >= registered_at_ms),
  last_successful_handoff_at_ms INTEGER,
  retired_at_ms INTEGER,
  retirement_reason TEXT,
  retirement_reference TEXT,
  CHECK((retired_at_ms IS NULL) = (retirement_reason IS NULL))
);";

const OWNER_LIVE_INDEX_SQL: &str = "
CREATE UNIQUE INDEX IF NOT EXISTS _snapback_push_tokens_v1_owner_live
  ON _snapback_push_tokens_v1(app_scope, principal_id, installation_id)
  WHERE retired_at_ms IS NULL;";

const BYTES_LIVE_INDEX_SQL: &str = "
CREATE UNIQUE INDEX IF NOT EXISTS _snapback_push_tokens_v1_bytes_live
  ON _snapback_push_tokens_v1(token_hash)
  WHERE retired_at_ms IS NULL;";

const SESSION_LIVE_INDEX_SQL: &str = "
CREATE INDEX IF NOT EXISTS _snapback_push_tokens_v1_session_live
  ON _snapback_push_tokens_v1(session_id, session_generation)
  WHERE retired_at_ms IS NULL;";

const IDLE_LIVE_INDEX_SQL: &str = "
CREATE INDEX IF NOT EXISTS _snapback_push_tokens_v1_idle_live
  ON _snapback_push_tokens_v1(last_registered_at_ms, id)
  WHERE retired_at_ms IS NULL;";

pub(crate) fn require_secure_delete(conn: &Connection) -> SnapbackResult<()> {
    conn.execute_batch("PRAGMA secure_delete = ON;")?;
    let enabled: i64 = conn.query_row("PRAGMA secure_delete", [], |row| row.get(0))?;
    if enabled != 1 {
        return Err(corrupt(
            "push-token custody requires SQLite secure deletion",
        ));
    }
    Ok(())
}

pub(crate) fn create_infra(conn: &Connection) -> SnapbackResult<()> {
    require_secure_delete(conn)?;
    conn.execute_batch(REGISTRY_TABLE_SQL)?;
    conn.execute_batch(OWNER_LIVE_INDEX_SQL)?;
    conn.execute_batch(BYTES_LIVE_INDEX_SQL)?;
    conn.execute_batch(SESSION_LIVE_INDEX_SQL)?;
    conn.execute_batch(IDLE_LIVE_INDEX_SQL)?;
    conn.execute_batch(SESSION_TERMINAL_TRIGGER_SQL)?;
    conn.execute_batch(CLOCK_FLOOR_INSERT_TRIGGER_SQL)?;
    conn.execute_batch(CLOCK_FLOOR_UPDATE_TRIGGER_SQL)?;
    validate_exact_schema(conn)?;
    Ok(())
}

/// Refuse a preexisting or subsequently tampered protected catalog rather
/// than allowing `CREATE IF NOT EXISTS` to adopt a lookalike custody shape.
/// Callers invoke this only for a declared seam; the undeclared path performs
/// no registry inventory query.
///
/// @ref LLP 0143#d1-device-token-custody — protected token storage is an
///   exact platform catalog, not an adoptable application-owned lookalike.
pub(crate) fn validate_exact_schema(conn: &Connection) -> SnapbackResult<()> {
    let actual = registry_shape(conn)
        .map_err(|_| corrupt("push-token custody catalog physical shape could not be inspected"))?;
    let expected = expected_registry_shape()
        .map_err(|_| corrupt("push-token custody reference catalog could not be constructed"))?;
    if actual != *expected {
        return Err(corrupt(
            "push-token custody catalog differs from the exact protected shape",
        ));
    }
    Ok(())
}

#[derive(Debug, Eq, PartialEq)]
struct RegistryShape {
    objects: BTreeMap<String, RegistryObjectShape>,
    columns: Vec<ColumnShape>,
    foreign_keys: Vec<ForeignKeyShape>,
    indexes: BTreeMap<String, IndexShape>,
}

#[derive(Debug, Eq, PartialEq)]
struct RegistryObjectShape {
    kind: String,
    table: String,
    sql: Option<String>,
}

#[derive(Debug, Eq, PartialEq)]
struct ColumnShape {
    position: i64,
    name: String,
    declared_type: String,
    not_null: bool,
    default_sql: Option<String>,
    primary_key_position: i64,
    hidden: i64,
}

#[derive(Debug, Eq, PartialEq, Ord, PartialOrd)]
struct ForeignKeyShape {
    id: i64,
    sequence: i64,
    target_table: String,
    from_column: String,
    to_column: String,
    on_update: String,
    on_delete: String,
    match_name: String,
}

#[derive(Debug, Eq, PartialEq)]
struct IndexShape {
    list_entry: Option<(bool, String, bool)>,
    columns: Vec<IndexColumnShape>,
}

#[derive(Debug, Eq, PartialEq)]
struct IndexColumnShape {
    sequence: i64,
    column_id: i64,
    name: Option<String>,
    descending: bool,
    collation: String,
    key_column: bool,
}

fn expected_registry_shape() -> SnapbackResult<&'static RegistryShape> {
    static EXPECTED: OnceLock<Result<RegistryShape, SnapbackError>> = OnceLock::new();
    match EXPECTED.get_or_init(|| {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "CREATE TABLE _auth_sessions(
               id TEXT, generation INTEGER, revoked_at_ms INTEGER, expires_at_ms INTEGER
             );
             CREATE TABLE _snapback_meta(key TEXT, value TEXT);",
        )?;
        conn.execute_batch(REGISTRY_TABLE_SQL)?;
        conn.execute_batch(OWNER_LIVE_INDEX_SQL)?;
        conn.execute_batch(BYTES_LIVE_INDEX_SQL)?;
        conn.execute_batch(SESSION_LIVE_INDEX_SQL)?;
        conn.execute_batch(IDLE_LIVE_INDEX_SQL)?;
        conn.execute_batch(SESSION_TERMINAL_TRIGGER_SQL)?;
        conn.execute_batch(CLOCK_FLOOR_INSERT_TRIGGER_SQL)?;
        conn.execute_batch(CLOCK_FLOOR_UPDATE_TRIGGER_SQL)?;
        registry_shape(&conn)
    }) {
        Ok(shape) => Ok(shape),
        Err(error) => Err(error.clone()),
    }
}

fn registry_shape(conn: &Connection) -> SnapbackResult<RegistryShape> {
    const INDEX_NAMES: [&str; 5] = [
        "sqlite_autoindex__snapback_push_tokens_v1_1",
        "_snapback_push_tokens_v1_owner_live",
        "_snapback_push_tokens_v1_bytes_live",
        "_snapback_push_tokens_v1_session_live",
        "_snapback_push_tokens_v1_idle_live",
    ];

    let mut objects = BTreeMap::new();
    let mut statement = conn.prepare(
        "SELECT type, name, tbl_name, sql
         FROM sqlite_schema
         WHERE name GLOB '_snapback_push_*'
            OR tbl_name = '_snapback_push_tokens_v1'
         ORDER BY type, name",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    for row in rows {
        let (kind, name, table, sql) = row?;
        objects.insert(name, RegistryObjectShape { kind, table, sql });
    }

    let mut column_statement = conn.prepare("PRAGMA table_xinfo('_snapback_push_tokens_v1')")?;
    let columns = column_statement
        .query_map([], |row| {
            Ok(ColumnShape {
                position: row.get(0)?,
                name: row.get(1)?,
                declared_type: row.get(2)?,
                not_null: row.get::<_, i64>(3)? != 0,
                default_sql: row.get(4)?,
                primary_key_position: row.get(5)?,
                hidden: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut foreign_key_statement =
        conn.prepare("PRAGMA foreign_key_list('_snapback_push_tokens_v1')")?;
    let mut foreign_keys = foreign_key_statement
        .query_map([], |row| {
            Ok(ForeignKeyShape {
                id: row.get(0)?,
                sequence: row.get(1)?,
                target_table: row.get(2)?,
                from_column: row.get(3)?,
                to_column: row.get(4)?,
                on_update: row.get(5)?,
                on_delete: row.get(6)?,
                match_name: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    foreign_keys.sort();

    let mut indexes = BTreeMap::new();
    for name in INDEX_NAMES {
        let mut list_statement = conn.prepare("PRAGMA index_list('_snapback_push_tokens_v1')")?;
        let mut list_rows = list_statement.query([])?;
        let mut list_entry = None;
        while let Some(row) = list_rows.next()? {
            if row.get::<_, String>(1)? == name {
                list_entry = Some((
                    row.get::<_, i64>(2)? != 0,
                    row.get(3)?,
                    row.get::<_, i64>(4)? != 0,
                ));
                break;
            }
        }
        let pragma = format!("PRAGMA index_xinfo('{name}')");
        let mut column_statement = conn.prepare(&pragma)?;
        let columns = column_statement
            .query_map([], |row| {
                Ok(IndexColumnShape {
                    sequence: row.get(0)?,
                    column_id: row.get(1)?,
                    name: row.get(2)?,
                    descending: row.get::<_, i64>(3)? != 0,
                    collation: row.get(4)?,
                    key_column: row.get::<_, i64>(5)? != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        indexes.insert(
            name.to_owned(),
            IndexShape {
                list_entry,
                columns,
            },
        );
    }
    Ok(RegistryShape {
        objects,
        columns,
        foreign_keys,
        indexes,
    })
}

pub(crate) fn is_exact_auth_lifecycle_trigger(name: &str, table: &str, sql: Option<&str>) -> bool {
    matches!(
        (name, table),
        ("_snapback_push_session_terminal_v1", "_auth_sessions")
            | ("_snapback_push_clock_floor_insert_v1", "_snapback_meta")
            | ("_snapback_push_clock_floor_update_v1", "_snapback_meta")
    ) && expected_registry_shape()
        .ok()
        .and_then(|shape| shape.objects.get(name))
        .is_some_and(|object| {
            object.kind == "trigger" && object.table == table && object.sql.as_deref() == sql
        })
}

/// Install or remove the registry as part of schema activation. Undeclared
/// applications retain no table, triggers, maintenance work, or inspection
/// query. A changed app scope cannot strand a live owner under the old scope.
pub(crate) fn activate_manifest_in(
    tx: &Transaction<'_>,
    declaration: Option<&PushSeamDeclarationV1>,
) -> SnapbackResult<()> {
    let Some(declaration) = declaration else {
        // DROP is a custody erasure, not merely a schema transition. Ensure
        // current table cells/pages are physically overwritten so a later
        // auth backup cannot copy plaintext from the source freelist after the
        // declaration and table are gone.
        require_secure_delete(tx)?;
        tx.execute_batch(
            "DROP TRIGGER IF EXISTS _snapback_push_session_terminal_v1;
             DROP TRIGGER IF EXISTS _snapback_push_clock_floor_insert_v1;
             DROP TRIGGER IF EXISTS _snapback_push_clock_floor_update_v1;
             DROP TABLE IF EXISTS _snapback_push_tokens_v1;",
        )?;
        return Ok(());
    };
    declaration.validate()?;
    create_infra(tx)?;
    let app_scope = declaration.app_scope.identity();
    let mismatched_live: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM _snapback_push_tokens_v1
           WHERE retired_at_ms IS NULL AND app_scope != ?1
         )",
        params![app_scope],
        |row| row.get(0),
    )?;
    if mismatched_live {
        return Err(SnapbackError::error(
            "SNAPBACK_PUSH_APP_SCOPE_CHANGE_BLOCKED",
            "push",
            "push appScope cannot change while the prior scope has live token custody",
        ));
    }
    Ok(())
}

pub(crate) fn inspect(conn: &Connection) -> SnapbackResult<PushRegistryInspectionV1> {
    validate_exact_schema(conn)?;
    let (live_tokens, retired_tokens) = conn.query_row(
        "SELECT
           COALESCE(SUM(CASE WHEN retired_at_ms IS NULL THEN 1 ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN retired_at_ms IS NOT NULL THEN 1 ELSE 0 END), 0)
         FROM _snapback_push_tokens_v1",
        [],
        |row| Ok((row.get::<_, u64>(0)?, row.get::<_, u64>(1)?)),
    )?;
    let mut retirement_reasons = BTreeMap::new();
    let mut statement = conn.prepare(
        "SELECT retirement_reason, COUNT(*)
         FROM _snapback_push_tokens_v1
         WHERE retired_at_ms IS NOT NULL
         GROUP BY retirement_reason ORDER BY retirement_reason",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
    })?;
    for row in rows {
        let (reason, count) = row?;
        validate_retirement_reason(&reason)?;
        retirement_reasons.insert(reason, count);
    }
    Ok(PushRegistryInspectionV1 {
        live_tokens,
        retired_tokens,
        retirement_reasons,
    })
}

pub(crate) fn register_in(
    tx: &Transaction<'_>,
    registration: Registration<'_>,
) -> SnapbackResult<PushTokenRegistrationResponse> {
    registration.declaration.validate()?;
    validate_installation_id(registration.installation_id)?;
    validate_token(registration.token)?;
    crate::manifest::validate_portable_timestamp_millis(registration.now_ms)?;
    if registration.session_generation == 0
        || registration.session_generation > crate::manifest::PORTABLE_TIMESTAMP_MAX_MS
    {
        return Err(invalid("push registration session generation is invalid"));
    }
    let app_scope = registration.declaration.app_scope.identity();
    let token_hash = Sha256::digest(registration.token.as_bytes());
    retire_idle_in(tx, registration.declaration, registration.now_ms)?;

    // Resolve, never infer, the exact live session generation. A stale request
    // cannot resurrect custody after logout or rotation of authority.
    let session_matches: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM _auth_sessions
           WHERE id = ?1 AND user_id = ?2 AND generation = ?3
             AND revoked_at_ms IS NULL
             AND MAX(
               ?4,
               COALESCE((
                 SELECT CAST(value AS INTEGER) FROM _snapback_meta
                 WHERE key = 'auth_session_clock_floor_ms'
               ), 0)
             ) < expires_at_ms
         )",
        params![
            registration.session_id,
            registration.principal_id,
            registration.session_generation as i64,
            registration.now_ms as i64,
        ],
        |row| row.get(0),
    )?;
    if !session_matches {
        return Err(SnapbackError::error(
            "SNAPBACK_PUSH_SESSION_STALE",
            "push",
            "push-token registration requires the current live session generation",
        ));
    }

    let collision: Option<(String, String)> = tx
        .query_row(
            "SELECT id, app_scope FROM _snapback_push_tokens_v1
             WHERE token_hash = ?1 AND retired_at_ms IS NULL",
            params![token_hash.as_slice()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if collision
        .as_ref()
        .is_some_and(|(_, existing_scope)| existing_scope != &app_scope)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_PUSH_TOKEN_SCOPE_COLLISION",
            "push",
            "an Expo token collided across declared app scopes; registration was refused",
        )
        .with_details(json!({
            "indicator": "push-token-cross-app-scope-collision",
            "action": "registration-refused",
        })));
    }

    let predecessor: Option<(String, Vec<u8>, String)> = tx
        .query_row(
            "SELECT id, token_hash, principal_id
             FROM _snapback_push_tokens_v1
             WHERE app_scope = ?1 AND principal_id = ?2 AND installation_id = ?3
               AND retired_at_ms IS NULL",
            params![
                app_scope,
                registration.principal_id,
                registration.installation_id
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;

    let mut ownership_transferred = false;
    if let Some((collision_id, _)) = collision.as_ref() {
        let same_owner = predecessor
            .as_ref()
            .is_some_and(|(id, _, _)| id == collision_id);
        if !same_owner {
            let changed = retire_exact_in(
                tx,
                collision_id,
                registration.now_ms,
                "ownership-transferred",
                Some(registration.session_id),
            )?;
            if changed != 1 {
                return Err(corrupt("live token owner changed during registration"));
            }
            ownership_transferred = true;
        }
    }

    let rotated = predecessor
        .as_ref()
        .is_some_and(|(_, predecessor_hash, _)| {
            predecessor_hash.as_slice() != token_hash.as_slice()
        });
    if let Some((id, _, _)) = predecessor.as_ref() {
        let changed = tx.execute(
            "UPDATE _snapback_push_tokens_v1
             SET token_hash = ?1, token_bytes = ?2, session_id = ?3,
                 session_generation = ?4, last_registered_at_ms = ?5
             WHERE id = ?6 AND retired_at_ms IS NULL",
            params![
                token_hash.as_slice(),
                registration.token,
                registration.session_id,
                registration.session_generation as i64,
                registration.now_ms as i64,
                id,
            ],
        )?;
        if changed != 1 {
            return Err(corrupt("push-token rotation lost its live owner"));
        }
        return Ok(PushTokenRegistrationResponse {
            token_id: id.clone(),
            installation_id: registration.installation_id.to_owned(),
            registered_at: registration.now_ms,
            rotated,
            ownership_transferred,
        });
    }

    let token_id = ids::mint_time_ordered(Kind::PushToken);
    tx.execute(
        "INSERT INTO _snapback_push_tokens_v1(
           id, app_scope, principal_id, installation_id, token_hash, token_bytes,
           session_id, session_generation, registered_at_ms, last_registered_at_ms
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            token_id,
            app_scope,
            registration.principal_id,
            registration.installation_id,
            token_hash.as_slice(),
            registration.token,
            registration.session_id,
            registration.session_generation as i64,
            registration.now_ms as i64,
        ],
    )?;
    Ok(PushTokenRegistrationResponse {
        token_id,
        installation_id: registration.installation_id.to_owned(),
        registered_at: registration.now_ms,
        rotated: false,
        ownership_transferred,
    })
}

pub(crate) fn unregister_in(
    tx: &Transaction<'_>,
    declaration: &PushSeamDeclarationV1,
    principal_id: &str,
    session_id: &str,
    session_generation: u64,
    installation_id: &str,
    now_ms: u64,
) -> SnapbackResult<PushTokenUnregisterResponse> {
    declaration.validate()?;
    validate_installation_id(installation_id)?;
    crate::manifest::validate_portable_timestamp_millis(now_ms)?;
    let app_scope = declaration.app_scope.identity();
    let token_id: Option<String> = tx
        .query_row(
            "SELECT id FROM _snapback_push_tokens_v1
             WHERE app_scope = ?1 AND principal_id = ?2 AND installation_id = ?3
               AND session_id = ?4 AND session_generation = ?5
               AND retired_at_ms IS NULL",
            params![
                app_scope,
                principal_id,
                installation_id,
                session_id,
                session_generation as i64,
            ],
            |row| row.get(0),
        )
        .optional()?;
    let retired = match token_id.as_deref() {
        Some(id) => retire_exact_in(tx, id, now_ms, "explicit-unregister", None)? == 1,
        None => false,
    };
    Ok(PushTokenUnregisterResponse { token_id, retired })
}

// The send slice is the first production caller; keep the validated retirement
// transition here so it cannot grow a second custody path there.
#[allow(dead_code)]
pub(crate) fn retire_provider_token_in(
    tx: &Transaction<'_>,
    token_id: &str,
    retired_at_ms: u64,
    provider_reference: &str,
) -> SnapbackResult<bool> {
    if !ids::looks_like(Kind::PushToken, token_id) || !valid_provider_reference(provider_reference)
    {
        return Err(invalid(
            "provider retirement requires a token id and provider reference",
        ));
    }
    Ok(retire_exact_in(
        tx,
        token_id,
        retired_at_ms,
        "device-not-registered",
        Some(provider_reference),
    )? == 1)
}

fn valid_provider_reference(reference: &str) -> bool {
    let body = reference
        .strip_prefix("ticket:")
        .or_else(|| reference.strip_prefix("receipt:"));
    reference.len() <= 255
        && body.is_some_and(|body| {
            !body.is_empty()
                && body
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
}

/// Retire installations whose last registry or handoff activity is outside
/// the app-declared window. The periodic auth maintenance lane calls this even
/// when no registration traffic arrives; registration also invokes it as an
/// opportunistic bound-preserving backstop.
///
/// @ref LLP 0143#d1-device-token-custody — reinstall/token rotation can strand
///   a predecessor, so boundedness is a declared maintenance rule.
pub(crate) fn retire_idle_in(
    tx: &Transaction<'_>,
    declaration: &PushSeamDeclarationV1,
    now_ms: u64,
) -> SnapbackResult<usize> {
    declaration.validate()?;
    crate::manifest::validate_portable_timestamp_millis(now_ms)?;
    let Some(cutoff_ms) = now_ms.checked_sub(declaration.registry.idle_retention_ms) else {
        return Ok(0);
    };
    let app_scope = declaration.app_scope.identity();
    Ok(tx.execute(
        "UPDATE _snapback_push_tokens_v1
         SET retired_at_ms = ?1, retirement_reason = 'idle-retention',
             retirement_reference = NULL, token_bytes = '', token_hash = zeroblob(32)
         WHERE app_scope = ?2 AND retired_at_ms IS NULL
           AND MAX(last_registered_at_ms,
                   COALESCE(last_successful_handoff_at_ms, last_registered_at_ms)) <= ?3",
        params![now_ms as i64, app_scope, cutoff_ms as i64],
    )?)
}

pub(crate) fn clear_in(tx: &Transaction<'_>) -> SnapbackResult<()> {
    require_secure_delete(tx)?;
    tx.execute("DELETE FROM _snapback_push_tokens_v1", [])?;
    Ok(())
}

fn retire_exact_in(
    tx: &Transaction<'_>,
    token_id: &str,
    retired_at_ms: u64,
    reason: &str,
    reference: Option<&str>,
) -> SnapbackResult<usize> {
    validate_retirement_reason(reason)?;
    Ok(tx.execute(
        "UPDATE _snapback_push_tokens_v1
         SET retired_at_ms = ?1, retirement_reason = ?2, retirement_reference = ?3,
             token_bytes = '', token_hash = zeroblob(32)
         WHERE id = ?4 AND retired_at_ms IS NULL",
        params![retired_at_ms as i64, reason, reference, token_id],
    )?)
}

fn validate_token(token: &str) -> SnapbackResult<()> {
    let wrapped = token
        .strip_prefix("ExponentPushToken[")
        .or_else(|| token.strip_prefix("ExpoPushToken["))
        .and_then(|rest| rest.strip_suffix(']'));
    if token.is_empty()
        || token.len() > PUSH_TOKEN_MAX_BYTES
        || wrapped.is_none_or(|body| {
            body.is_empty()
                || !body
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
    {
        return Err(invalid(
            "push token is not a bounded Expo push-token spelling",
        ));
    }
    Ok(())
}

fn validate_installation_id(installation_id: &str) -> SnapbackResult<()> {
    if installation_id.len() <= PUSH_INSTALLATION_MAX_BYTES
        && ids::looks_like(Kind::Installation, installation_id)
    {
        return Ok(());
    }
    Err(invalid(
        "installationId is not a platform-minted installation identifier",
    ))
}

fn validate_retirement_reason(reason: &str) -> SnapbackResult<()> {
    match reason {
        "explicit-unregister"
        | "ownership-transferred"
        | "session-ended"
        | "session-expired"
        | "idle-retention"
        | "device-not-registered" => Ok(()),
        _ => Err(corrupt("push-token retirement reason is not allowlisted")),
    }
}

fn invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_PUSH_TOKEN_INVALID", "push", message)
}

fn corrupt(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_PUSH_REGISTRY_CORRUPT", "push", message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::session_projection::RevocationReason;
    use crate::storage::LocalDatabase;

    fn declaration(environment: &str, idle_retention_ms: u64) -> PushSeamDeclarationV1 {
        PushSeamDeclarationV1 {
            app_scope: PushAppScopeV1 {
                eas_project_id: "eas-fixture".into(),
                application_id: "com.example.fixture".into(),
                environment: environment.into(),
            },
            registry: PushRegistryDeclarationV1 { idle_retention_ms },
        }
    }

    fn registry_database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("database");
        db.activate_current_auth_catalog().expect("auth catalog");
        let declaration = declaration("preview", 86_400_000);
        db.activate_push_registry_for_test(declaration)
            .expect("push registry activation");
        db
    }

    fn insert_session(
        db: &mut LocalDatabase,
        principal_id: &str,
        session_id: &str,
        generation: u64,
        expires_at_ms: u64,
        discriminator: u8,
    ) {
        db.with_auth_transaction(|tx| {
            let identity_id = format!("identity-{discriminator}");
            tx.execute(
                "INSERT OR IGNORE INTO _auth_users(id, created_at_ms) VALUES(?1, 0)",
                params![principal_id],
            )?;
            tx.execute(
                "INSERT OR IGNORE INTO _auth_identities(
                   id, user_id, provider, subject, verified_at_ms
                 ) VALUES(?1, ?2, 'email-code', ?3, 0)",
                params![
                    identity_id,
                    principal_id,
                    format!("user-{discriminator}@example.com")
                ],
            )?;
            tx.execute(
                "INSERT INTO _auth_sessions(
                   id, user_id, identity_id, authority_instance_id, token_hash,
                   generation, created_at_ms, last_used_at_ms, expires_at_ms,
                   absolute_expires_at_ms, revoked_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, 0, 0, ?7, ?7, NULL)",
                params![
                    session_id,
                    principal_id,
                    identity_id,
                    format!("authority-{discriminator}"),
                    vec![discriminator; 32],
                    generation as i64,
                    expires_at_ms as i64,
                ],
            )?;
            Ok(())
        })
        .expect("insert session");
    }

    fn register(
        db: &mut LocalDatabase,
        declaration: &PushSeamDeclarationV1,
        principal_id: &str,
        session_id: &str,
        session_generation: u64,
        installation_id: &str,
        token: &str,
        now_ms: u64,
    ) -> SnapbackResult<PushTokenRegistrationResponse> {
        db.with_auth_transaction(|tx| {
            register_in(
                tx,
                Registration {
                    declaration,
                    principal_id,
                    session_id,
                    session_generation,
                    installation_id,
                    token,
                    now_ms,
                },
            )
        })
    }

    #[test]
    fn token_validator_is_closed_and_never_echoes_bytes() {
        assert!(validate_token("ExponentPushToken[fixture_123]").is_ok());
        assert!(validate_token("ExpoPushToken[fixture-123]").is_ok());
        let secret = "ExponentPushToken[do-not-echo]";
        let error = validate_token(secret.trim_end_matches(']')).unwrap_err();
        assert!(!format!("{error:?}").contains("do-not-echo"));
    }

    #[test]
    fn undeclared_database_has_no_registry_storage_or_lifecycle_triggers() {
        let mut db = LocalDatabase::memory().expect("undeclared database");
        db.activate_current_auth_catalog().expect("auth catalog");
        let push_objects = |db: &mut LocalDatabase| -> Vec<String> {
            db.with_auth_read(|conn| {
                let mut statement = conn.prepare(
                    "SELECT name FROM sqlite_schema
                     WHERE name LIKE '_snapback_push_%' ORDER BY name",
                )?;
                Ok(statement
                    .query_map([], |row| row.get(0))?
                    .collect::<Result<Vec<_>, _>>()?)
            })
            .expect("push object inventory")
        };
        assert!(push_objects(&mut db).is_empty());
        assert_eq!(
            db.push_registry_inspection()
                .expect("zero-cost inspection projection"),
            PushRegistryInspectionV1::default()
        );

        db.activate_push_registry_for_test(declaration("preview", 86_400_000))
            .expect("declared activation");
        assert!(!push_objects(&mut db).is_empty());
        db.with_auth_transaction(|tx| activate_manifest_in(tx, None))
            .expect("declaration removal");
        assert!(push_objects(&mut db).is_empty());
    }

    #[test]
    fn activation_refuses_a_preexisting_non_exact_registry_table() {
        let mut db = LocalDatabase::memory().expect("database");
        db.activate_current_auth_catalog().expect("auth catalog");
        let tampered_table = REGISTRY_TABLE_SQL.replace(
            "retirement_reference TEXT,",
            "retirement_reference TEXT, tampered_column TEXT,",
        );
        db.with_auth_transaction(|tx| {
            tx.execute_batch(&tampered_table)?;
            Ok(())
        })
        .expect("preexisting lookalike table");

        let error = db
            .with_auth_transaction(|tx| {
                activate_manifest_in(tx, Some(&declaration("preview", 86_400_000)))
            })
            .expect_err("CREATE IF NOT EXISTS must not adopt a lookalike table");
        assert_eq!(error.diagnostic.code, "SNAPBACK_PUSH_REGISTRY_CORRUPT");
    }

    #[test]
    fn inspection_refuses_tampered_registry_index_and_trigger() {
        let mut index_db = registry_database();
        index_db
            .with_auth_transaction(|tx| {
                tx.execute_batch(
                    "DROP INDEX _snapback_push_tokens_v1_owner_live;
                     CREATE UNIQUE INDEX _snapback_push_tokens_v1_owner_live
                       ON _snapback_push_tokens_v1(app_scope, token_hash)
                       WHERE retired_at_ms IS NULL;",
                )?;
                let expected_sql = expected_registry_shape()?
                    .objects
                    .get("_snapback_push_tokens_v1_owner_live")
                    .and_then(|object| object.sql.as_deref())
                    .ok_or_else(|| corrupt("test reference index SQL is missing"))?;
                tx.execute_batch("PRAGMA writable_schema = ON;")?;
                tx.execute(
                    "UPDATE sqlite_schema SET sql = ?1
                     WHERE name = '_snapback_push_tokens_v1_owner_live'",
                    params![expected_sql],
                )?;
                tx.execute_batch("PRAGMA writable_schema = OFF;")?;
                Ok(())
            })
            .expect("tamper physical registry index while forging expected SQL text");
        let index_error = index_db
            .push_registry_inspection()
            .expect_err("physical index shape defeats forged sqlite_schema text");
        assert_eq!(
            index_error.diagnostic.code,
            "SNAPBACK_PUSH_REGISTRY_CORRUPT"
        );

        let mut trigger_db = registry_database();
        trigger_db
            .with_auth_transaction(|tx| {
                tx.execute_batch(
                    "DROP TRIGGER _snapback_push_session_terminal_v1;
                     CREATE TRIGGER _snapback_push_session_terminal_v1
                       AFTER DELETE ON _auth_sessions
                     BEGIN
                       SELECT 1;
                     END;",
                )?;
                Ok(())
            })
            .expect("tamper lifecycle trigger");
        let trigger_error = trigger_db
            .push_registry_inspection()
            .expect_err("non-exact attached trigger refuses");
        assert_eq!(
            trigger_error.diagnostic.code,
            "SNAPBACK_PUSH_REGISTRY_CORRUPT"
        );
    }

    #[test]
    fn provider_retirement_is_idempotent_and_erases_token_bytes() {
        let mut db = LocalDatabase::memory().expect("database");
        db.activate_current_auth_catalog().expect("auth catalog");
        db.activate_push_registry_for_test(declaration("preview", 86_400_000))
            .expect("push registry");
        let token_id = ids::mint_time_ordered(Kind::PushToken);
        db.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _snapback_push_tokens_v1(
                   id, app_scope, principal_id, installation_id, token_hash, token_bytes,
                   session_id, session_generation, registered_at_ms, last_registered_at_ms
                 ) VALUES(?1, 'scope', 'user', 'installation', zeroblob(32), ?2,
                          'session', 1, 1, 1)",
                params![token_id, "ExponentPushToken[secret]"],
            )?;
            assert!(retire_provider_token_in(tx, &token_id, 2, "ticket:t1")?);
            assert!(!retire_provider_token_in(tx, &token_id, 3, "receipt:r1")?);
            let arbitrary = retire_provider_token_in(
                tx,
                &token_id,
                4,
                "Expo said token ExponentPushToken[secret] failed",
            )
            .expect_err("free-text provider prose is not an evidence reference");
            assert_eq!(arbitrary.diagnostic.code, "SNAPBACK_PUSH_TOKEN_INVALID");
            assert!(!format!("{arbitrary:?}").contains("ExponentPushToken"));
            let row: (String, String, String) = tx.query_row(
                "SELECT token_bytes, retirement_reason, retirement_reference
                 FROM _snapback_push_tokens_v1 WHERE id = ?1",
                params![token_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            assert_eq!(
                row,
                (
                    String::new(),
                    "device-not-registered".into(),
                    "ticket:t1".into()
                )
            );
            Ok(())
        })
        .expect("retirement transaction");
    }

    #[test]
    fn registration_is_idempotent_rotates_atomically_and_enforces_single_owner() {
        let mut db = registry_database();
        insert_session(&mut db, "user-a", "session-a", 1, 1_000_000_000, 1);
        insert_session(&mut db, "user-b", "session-b", 1, 1_000_000_000, 2);
        let scope = declaration("preview", 86_400_000);
        let installation_a = ids::mint(Kind::Installation).expect("installation a");
        let installation_b = ids::mint(Kind::Installation).expect("installation b");
        let first_token = "ExponentPushToken[first_secret]";
        let rotated_token = "ExponentPushToken[rotated_secret]";

        let first = register(
            &mut db,
            &scope,
            "user-a",
            "session-a",
            1,
            &installation_a,
            first_token,
            100,
        )
        .expect("first registration");
        let repeated = register(
            &mut db,
            &scope,
            "user-a",
            "session-a",
            1,
            &installation_a,
            first_token,
            101,
        )
        .expect("idempotent registration");
        assert_eq!(repeated.token_id, first.token_id);
        assert!(!repeated.rotated);

        let rotated = register(
            &mut db,
            &scope,
            "user-a",
            "session-a",
            1,
            &installation_a,
            rotated_token,
            102,
        )
        .expect("atomic rotation");
        assert_eq!(rotated.token_id, first.token_id);
        assert!(rotated.rotated);

        let transferred = register(
            &mut db,
            &scope,
            "user-b",
            "session-b",
            1,
            &installation_b,
            rotated_token,
            103,
        )
        .expect("same-scope ownership transfer");
        assert_ne!(transferred.token_id, first.token_id);
        assert!(transferred.ownership_transferred);

        let (live, predecessor): (i64, (String, String)) = db
            .with_auth_read(|conn| {
                let live = conn.query_row(
                    "SELECT COUNT(*) FROM _snapback_push_tokens_v1 WHERE retired_at_ms IS NULL",
                    [],
                    |row| row.get(0),
                )?;
                let predecessor = conn.query_row(
                    "SELECT token_bytes, retirement_reason FROM _snapback_push_tokens_v1 WHERE id = ?1",
                    params![first.token_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                Ok((live, predecessor))
            })
            .expect("registry facts");
        assert_eq!(live, 1);
        assert_eq!(predecessor, (String::new(), "ownership-transferred".into()));

        let other_scope = declaration("production", 86_400_000);
        let activation_error = db
            .with_auth_transaction(|tx| activate_manifest_in(tx, Some(&other_scope)))
            .expect_err("live old scope blocks schema activation");
        assert_eq!(
            activation_error.diagnostic.code,
            "SNAPBACK_PUSH_APP_SCOPE_CHANGE_BLOCKED"
        );
        let collision = register(
            &mut db,
            &other_scope,
            "user-a",
            "session-a",
            1,
            &installation_a,
            rotated_token,
            104,
        )
        .expect_err("cross-scope token collision refuses");
        assert_eq!(
            collision.diagnostic.code,
            "SNAPBACK_PUSH_TOKEN_SCOPE_COLLISION"
        );
        assert_eq!(
            collision.diagnostic.details,
            json!({
                "indicator": "push-token-cross-app-scope-collision",
                "action": "registration-refused",
            })
        );
        let encoded = serde_json::to_string(&collision).expect("diagnostic serialization");
        assert!(!encoded.contains("rotated_secret"));

        let inspection = db.push_registry_inspection().expect("operator inspection");
        assert_eq!(inspection.live_tokens, 1);
        assert_eq!(inspection.retired_tokens, 1);
        assert_eq!(inspection.retirement_reasons["ownership-transferred"], 1);
        let inspection_json = serde_json::to_string(&inspection).expect("inspection json");
        assert!(!inspection_json.contains("PushToken"));
        assert!(!inspection_json.contains("secret"));
    }

    #[test]
    fn durable_session_end_retires_exact_generation_and_stale_registration_cannot_resurrect() {
        let mut db = registry_database();
        let logout_session = ids::mint(Kind::Session).expect("logout session");
        let sibling_session = ids::mint(Kind::Session).expect("sibling session");
        insert_session(&mut db, "user-a", &logout_session, 1, 1_000_000_000, 3);
        insert_session(&mut db, "user-a", &sibling_session, 1, 1_000_000_000, 4);
        let scope = declaration("preview", 86_400_000);
        let logout_installation = ids::mint(Kind::Installation).expect("logout installation");
        let sibling_installation = ids::mint(Kind::Installation).expect("sibling installation");
        register(
            &mut db,
            &scope,
            "user-a",
            &logout_session,
            1,
            &logout_installation,
            "ExponentPushToken[logout_secret]",
            100,
        )
        .expect("logout registration");
        register(
            &mut db,
            &scope,
            "user-a",
            &sibling_session,
            1,
            &sibling_installation,
            "ExponentPushToken[sibling_secret]",
            100,
        )
        .expect("sibling registration");

        db.with_auth_transaction(|tx| {
            tx.execute(
                "UPDATE _auth_sessions SET generation = 2, revoked_at_ms = 200
                 WHERE id = ?1 AND generation = 1",
                params![logout_session],
            )?;
            crate::storage::auth::write_session_terminal_cause_in(
                tx,
                &logout_session,
                2,
                200,
                RevocationReason::Logout,
            )
        })
        .expect("logout commit");

        let facts: Vec<(String, Option<String>, String)> = db
            .with_auth_read(|conn| {
                let mut statement = conn.prepare(
                    "SELECT session_id, retirement_reason, token_bytes
                     FROM _snapback_push_tokens_v1 ORDER BY session_id",
                )?;
                Ok(statement
                    .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                    .collect::<Result<Vec<_>, _>>()?)
            })
            .expect("session retirement facts");
        let facts = facts
            .into_iter()
            .map(|(session_id, reason, bytes)| (session_id, (reason, bytes)))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            facts[logout_session.as_str()],
            (Some("session-ended".into()), String::new())
        );
        assert_eq!(
            facts[sibling_session.as_str()],
            (None, "ExponentPushToken[sibling_secret]".into())
        );
        let stale = register(
            &mut db,
            &scope,
            "user-a",
            &logout_session,
            1,
            &logout_installation,
            "ExponentPushToken[resurrection_secret]",
            201,
        )
        .expect_err("stale generation loses to logout");
        assert_eq!(stale.diagnostic.code, "SNAPBACK_PUSH_SESSION_STALE");

        // The same storage hook owns an administrator/durable revocation;
        // exact predecessor generation remains the invariant, not the cause.
        db.with_auth_transaction(|tx| {
            tx.execute(
                "UPDATE _auth_sessions SET generation = 2, revoked_at_ms = 202
                 WHERE id = ?1 AND generation = 1",
                params![sibling_session],
            )?;
            crate::storage::auth::write_session_terminal_cause_in(
                tx,
                &sibling_session,
                2,
                202,
                RevocationReason::DurableRevocation,
            )
        })
        .expect("administrator durable-revocation commit");
        assert_eq!(
            db.push_registry_inspection()
                .expect("inspection after durable revocation")
                .retirement_reasons["session-ended"],
            2
        );
    }

    #[test]
    fn auth_clock_frontier_retires_expiry_in_its_exact_commit() {
        let mut db = registry_database();
        insert_session(&mut db, "user-a", "expiring-session", 1, 500, 5);
        let scope = declaration("preview", 86_400_000);
        let installation = ids::mint(Kind::Installation).expect("expiry installation");
        register(
            &mut db,
            &scope,
            "user-a",
            "expiring-session",
            1,
            &installation,
            "ExponentPushToken[expiry_secret]",
            100,
        )
        .expect("expiry registration");
        db.advance_auth_session_clock_floor(499)
            .expect("pre-expiry frontier");
        assert_eq!(db.push_registry_inspection().unwrap().live_tokens, 1);
        db.advance_auth_session_clock_floor(500)
            .expect("expiry frontier commit");
        let inspection = db.push_registry_inspection().unwrap();
        assert_eq!(inspection.live_tokens, 0);
        assert_eq!(inspection.retirement_reasons["session-expired"], 1);
        let bytes: String = db
            .with_auth_read(|conn| {
                Ok(conn.query_row(
                    "SELECT token_bytes FROM _snapback_push_tokens_v1",
                    [],
                    |row| row.get(0),
                )?)
            })
            .unwrap();
        assert!(bytes.is_empty());
        let stale = register(
            &mut db,
            &scope,
            "user-a",
            "expiring-session",
            1,
            &installation,
            "ExponentPushToken[expiry_resurrection_secret]",
            499,
        )
        .expect_err("durable expiry floor blocks registration after wall-clock rollback");
        assert_eq!(stale.diagnostic.code, "SNAPBACK_PUSH_SESSION_STALE");
        assert_eq!(db.push_registry_inspection().unwrap().live_tokens, 0);
    }

    #[test]
    fn declared_idle_retention_retires_only_outside_the_window() {
        let mut db = registry_database();
        insert_session(&mut db, "user-a", "idle-session", 1, 1_000_000_000, 6);
        let retention = 86_400_000;
        let scope = declaration("preview", retention);
        let installation = ids::mint(Kind::Installation).expect("idle installation");
        register(
            &mut db,
            &scope,
            "user-a",
            "idle-session",
            1,
            &installation,
            "ExponentPushToken[idle_secret]",
            100,
        )
        .expect("idle registration");
        db.with_auth_transaction(|tx| {
            assert_eq!(retire_idle_in(tx, &scope, retention + 99)?, 0);
            assert_eq!(retire_idle_in(tx, &scope, retention + 100)?, 1);
            Ok(())
        })
        .expect("idle maintenance");
        let inspection = db.push_registry_inspection().unwrap();
        assert_eq!(inspection.live_tokens, 0);
        assert_eq!(inspection.retirement_reasons["idle-retention"], 1);
    }
}
