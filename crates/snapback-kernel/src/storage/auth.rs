//! Protected SQLite auth catalog and the direct storage lane beneath app data.
//!
//! @ref LLP 0057#reserved-namespace-and-catalog-recognition — catalog state is
//! inspected without mutation and recognized exactly before auth effects run.
//! @ref LLP 0057#catalog-write-and-lifecycle-rules — auth writes never use app
//! mutation, journal, version, receipt, or live-delivery machinery.

use super::{LocalDatabase, is_auth_reserved_identifier};
use crate::auth::mode::{PASSWORD_PROVIDER_REQUIRES_V4_CODE, PasswordProviderReadiness};
use crate::contract_types::{
    RevocationReason, SESSION_TERMINAL_CAUSE_META_PREFIX, SessionTerminalCauseRecord,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use rusqlite::{
    Connection, DatabaseName, OpenFlags, OptionalExtension, Transaction, TransactionBehavior,
    params,
};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::path::Path;
use std::sync::OnceLock;

/// The catalog version this binary creates. Password-identifier activation
/// moves fresh stores to v4 while exact v1/v2/v3 stores remain recognized
/// without migration.
///
/// @ref LLP 0214#31-version-policy — predecessor catalogs are recognized
/// without mutation; fresh activation writes the new marker last.
pub const AUTH_CATALOG_VERSION: &str = "4";
/// The frozen predecessor version. A v2-aware binary still **recognizes** an
/// existing v1 catalog (sessions keep working); agent operations require v2. A
/// first-class v1→v2 migration is deferred (LLP 0057 pins "a future migration
/// changes the marker first-class"); until it lands, an existing v1 catalog is
/// legacy and agent surfaces are unavailable on it.
pub const AUTH_CATALOG_VERSION_V1: &str = "1";
pub const AUTH_CATALOG_VERSION_V2: &str = "2";
pub const AUTH_CATALOG_VERSION_V3: &str = "3";
pub const AUTH_GC_BATCH: usize = 512;
const META_AUTH_CATALOG_VERSION: &str = "auth_catalog_version";
const META_AUTH_PASSWORD_IDENTIFIER_MODE: &str = "auth_password_identifier_mode";
pub(super) const META_AUTH_RESTORE_DECLARATION_ID: &str = "auth_restore_declaration_id";
/// Durable non-decreasing floor for every auth lifetime decision that reads
/// the wall clock. Persisted so a backward wall-clock move across restart can
/// never make the effective epoch fall below one the process already used.
/// @ref LLP 0059#durable-session-clock-floor
const META_AUTH_SESSION_CLOCK_FLOOR_MS: &str = "auth_session_clock_floor_ms";
const MAX_SAFE_TIMESTAMP_MS: u64 = 9_007_199_254_740_991;
#[cfg(any(test, feature = "test-support"))]
fn auth_activation_steps() -> usize {
    catalog_tables(CURRENT_CATALOG).count() + catalog_indexes(CURRENT_CATALOG).count() + 2
}

#[cfg(any(test, feature = "test-support"))]
thread_local! {
    static FAIL_AUTH_ACTIVATION_AFTER_STEP: std::cell::Cell<Option<usize>> =
        const { std::cell::Cell::new(None) };
    static FAIL_AUTH_RESTORE_AFTER_STEP: std::cell::Cell<Option<usize>> =
        const { std::cell::Cell::new(None) };
}

#[cfg(any(test, feature = "test-support"))]
thread_local! {
    static INJECT_SERVICE_ROLLBACK_UNCERTAINTY: std::cell::Cell<bool> = const {
        std::cell::Cell::new(false)
    };
}

#[cfg(any(test, feature = "test-support"))]
pub fn inject_service_rollback_uncertainty_for_test() {
    INJECT_SERVICE_ROLLBACK_UNCERTAINTY.with(|slot| {
        assert!(
            !slot.replace(true),
            "service rollback fault must be one-shot"
        );
    });
}

#[cfg(any(test, feature = "test-support"))]
fn take_service_rollback_uncertainty_for_test() -> bool {
    INJECT_SERVICE_ROLLBACK_UNCERTAINTY.with(|slot| slot.replace(false))
}

#[cfg(any(test, feature = "test-support"))]
fn inject_auth_activation_failure_after_step(step: usize) {
    FAIL_AUTH_ACTIVATION_AFTER_STEP.with(|slot| {
        assert!(
            slot.get().is_none(),
            "auth activation hook must be one-shot"
        );
        slot.set(Some(step));
    });
}

fn activation_step_completed(step: usize) -> SnapbackResult<()> {
    #[cfg(not(any(test, feature = "test-support")))]
    let _ = step;
    #[cfg(any(test, feature = "test-support"))]
    FAIL_AUTH_ACTIVATION_AFTER_STEP.with(|slot| {
        if slot.get() == Some(step) {
            slot.set(None);
            return Err(SnapbackError::error(
                "TEST_AUTH_ACTIVATION_FAILURE",
                "auth",
                "injected auth-catalog activation failure",
            ));
        }
        Ok(())
    })?;
    Ok(())
}

#[cfg(any(test, feature = "test-support"))]
fn inject_auth_restore_failure_after_step(step: usize) {
    FAIL_AUTH_RESTORE_AFTER_STEP.with(|slot| {
        assert!(slot.get().is_none(), "auth restore hook must be one-shot");
        slot.set(Some(step));
    });
}

fn restore_transaction_step_completed(step: usize) -> SnapbackResult<()> {
    #[cfg(not(any(test, feature = "test-support")))]
    let _ = step;
    #[cfg(any(test, feature = "test-support"))]
    FAIL_AUTH_RESTORE_AFTER_STEP.with(|slot| {
        if slot.get() == Some(step) {
            slot.set(None);
            return Err(SnapbackError::error(
                "TEST_AUTH_RESTORE_TRANSACTION_FAILURE",
                "auth-restore",
                "injected declared-restore transaction failure",
            ));
        }
        Ok(())
    })?;
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthCatalogState {
    Uninitialized,
    /// A recognized, exact catalog version 1 (pre-agent). Sessions resolve; the
    /// LLP 0055 agent surfaces are unavailable until a v1→v2 migration lands.
    ReadyV1,
    /// A recognized, exact catalog version 2 — the current shape, with agent
    /// principal columns and the six agent catalog tables. Identity-core
    /// surfaces refuse this recognition-only predecessor.
    ReadyV2,
    /// A recognized exact catalog version 3 with split principals, identity
    /// links, credentials, assurances, and the carried v2 agent objects.
    ReadyV3,
    /// A recognized exact catalog version 4. It carries v3 unchanged and adds
    /// password lockout state plus one immutable identifier-mode declaration.
    ReadyV4,
}

impl AuthCatalogState {
    /// Whether the catalog is a recognized, usable version for the session and
    /// identity surfaces common to every version. Version-specific surfaces
    /// (agent operations) take a stricter check.
    pub fn is_ready(self) -> bool {
        matches!(
            self,
            Self::ReadyV1 | Self::ReadyV2 | Self::ReadyV3 | Self::ReadyV4
        )
    }
}

/// The canonicalization contract chosen once when catalog v4 is activated.
/// Its stored spelling is a versioned protocol value, not presentation text.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PasswordIdentifierMode {
    UsernameV1,
    EmailV1,
}

impl PasswordIdentifierMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::UsernameV1 => "username-v1",
            Self::EmailV1 => "email-v1",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "username-v1" => Some(Self::UsernameV1),
            "email-v1" => Some(Self::EmailV1),
            _ => None,
        }
    }

    pub const fn identity_kind(self) -> &'static str {
        match self {
            Self::UsernameV1 => "username",
            Self::EmailV1 => "email",
        }
    }
}

impl From<crate::manifest::AuthPasswordIdentifierMode> for PasswordIdentifierMode {
    fn from(mode: crate::manifest::AuthPasswordIdentifierMode) -> Self {
        match mode {
            crate::manifest::AuthPasswordIdentifierMode::UsernameV1 => Self::UsernameV1,
            crate::manifest::AuthPasswordIdentifierMode::EmailV1 => Self::EmailV1,
        }
    }
}

/// One recognized catalog version: its marker value and its exact table/index
/// shape. Recognition compares stored SQL text and the physical pragma shape
/// against the descriptor for the marked version.
struct CatalogSchema {
    version: &'static str,
    tables: &'static [ExpectedTable],
    indexes: &'static [ExpectedIndex],
}

const CATALOG_V1: CatalogSchema = CatalogSchema {
    version: AUTH_CATALOG_VERSION_V1,
    tables: AUTH_TABLES_V1,
    indexes: AUTH_INDEXES_V1,
};

const CATALOG_V2: CatalogSchema = CatalogSchema {
    version: AUTH_CATALOG_VERSION_V2,
    tables: AUTH_TABLES_V2,
    indexes: AUTH_INDEXES_V2,
};

const CATALOG_V3: CatalogSchema = CatalogSchema {
    version: AUTH_CATALOG_VERSION_V3,
    tables: AUTH_TABLES_V3_CORE,
    indexes: AUTH_INDEXES_V3_ADDITIONS,
};

const CATALOG_V4: CatalogSchema = CatalogSchema {
    version: AUTH_CATALOG_VERSION,
    tables: AUTH_TABLES_V4_ADDITIONS,
    indexes: &[],
};

/// The version a fresh activation creates.
const CURRENT_CATALOG: &CatalogSchema = &CATALOG_V4;

/// V3 replaces the first five v2 core tables and carries the remaining LLP
/// 0055 objects unchanged. Its named indexes carry every v2 index unchanged
/// and append only identity-core indexes.
fn catalog_tables(
    schema: &'static CatalogSchema,
) -> Box<dyn Iterator<Item = &'static ExpectedTable>> {
    if schema.version == CATALOG_V3.version {
        Box::new(schema.tables.iter().chain(AUTH_TABLES_V2[5..].iter()))
    } else if schema.version == CATALOG_V4.version {
        Box::new(
            AUTH_TABLES_V3_CORE
                .iter()
                .chain(AUTH_TABLES_V2[5..].iter())
                .chain(schema.tables.iter()),
        )
    } else {
        Box::new(schema.tables.iter())
    }
}

fn catalog_indexes(
    schema: &'static CatalogSchema,
) -> Box<dyn Iterator<Item = &'static ExpectedIndex>> {
    if schema.version == CATALOG_V3.version {
        Box::new(AUTH_INDEXES_V2.iter().chain(schema.indexes.iter()))
    } else if schema.version == CATALOG_V4.version {
        Box::new(
            AUTH_INDEXES_V2
                .iter()
                .chain(AUTH_INDEXES_V3_ADDITIONS.iter())
                .chain(schema.indexes.iter()),
        )
    } else {
        Box::new(schema.indexes.iter())
    }
}

/// Return the canonical protected-table inventory for one exact recognized
/// catalog. Backup format 2 records this list so its v3 claim is closed over
/// the complete physical catalog rather than only the numeric marker.
pub fn auth_catalog_table_names(state: AuthCatalogState) -> Option<Vec<&'static str>> {
    let schema = match state {
        AuthCatalogState::ReadyV1 => &CATALOG_V1,
        AuthCatalogState::ReadyV2 => &CATALOG_V2,
        AuthCatalogState::ReadyV3 => &CATALOG_V3,
        AuthCatalogState::ReadyV4 => &CATALOG_V4,
        AuthCatalogState::Uninitialized => return None,
    };
    Some(catalog_tables(schema).map(|table| table.name).collect())
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct AuthGcResult {
    pub challenges_deleted: usize,
    pub sessions_deleted: usize,
    pub immediate_retry: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthRestoreResult {
    Applied {
        sessions_revoked: usize,
        challenges_deleted: usize,
    },
    AlreadyApplied,
}

/// Persist the committed terminal cause in the same SQLite transaction that
/// advances a session to its revoked generation. Frozen auth catalogs v1/v2
/// retain their exact table shapes; this versioned metadata witness supplies
/// the cause that `revoked_at_ms` alone cannot represent across restart.
pub(crate) fn write_session_terminal_cause_in(
    tx: &Transaction<'_>,
    session_id: &str,
    generation: u64,
    revoked_at_ms: u64,
    reason: RevocationReason,
) -> SnapbackResult<()> {
    let record = SessionTerminalCauseRecord::new(session_id, generation, revoked_at_ms, reason)?;
    let changed = tx.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)",
        params![
            SessionTerminalCauseRecord::meta_key(session_id)?,
            record.encode_string()?,
        ],
    )?;
    if changed != 1 {
        return Err(corrupt(
            "a session terminal-cause witness could not be persisted",
        ));
    }
    Ok(())
}

pub(crate) fn session_terminal_cause_matches_on(
    conn: &Connection,
    session_id: &str,
    generation: u64,
    revoked_at_ms: u64,
    reason: RevocationReason,
) -> SnapbackResult<bool> {
    Ok(
        read_session_terminal_cause_on(conn, session_id, generation, revoked_at_ms)?
            == Some(reason),
    )
}

/// Recover only an exact cause witness for this durable terminal row. A
/// missing or stale/mismatched record is legacy/uncertain authority and must
/// be classified as carrier loss by callers; malformed metadata is catalog
/// corruption and remains an availability failure.
pub(crate) fn read_session_terminal_cause_on(
    conn: &Connection,
    session_id: &str,
    generation: u64,
    revoked_at_ms: u64,
) -> SnapbackResult<Option<RevocationReason>> {
    let raw: Option<(String, Vec<u8>)> = conn
        .query_row(
            "SELECT typeof(value), CAST(value AS BLOB)
             FROM _snapback_meta WHERE key = ?1",
            params![SessionTerminalCauseRecord::meta_key(session_id)?],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((storage_class, bytes)) = raw else {
        return Ok(None);
    };
    if storage_class != "text" {
        return Err(corrupt(
            "a session terminal-cause witness is not stored as SQLite text",
        ));
    }
    let record = SessionTerminalCauseRecord::parse_exact(&bytes)?;
    Ok((record.session_id() == session_id
        && record.generation() == generation
        && record.revoked_at_ms() == revoked_at_ms)
        .then(|| record.reason()))
}

/// Commit certainty for an item-5 two-phase auth mutation. Body/begin errors
/// are known rollbacks and may exact-unmark their projection ticket. A commit
/// error is conservatively ambiguous and must reconcile or fail closed.
pub enum AuthTransactionAttempt<T> {
    Committed(T),
    RolledBack(SnapbackError),
    CommitUncertain(SnapbackError),
}

/// A finite service-authority transaction carries its exact process-fence
/// ticket through an indeterminate COMMIT. Operation-specific reconciliation
/// can then settle that ticket without blocking unrelated tokens or clearing a
/// sibling mutation's marker. `None` is used only by deterministic tests that
/// inject uncertainty after a real successful commit.
pub enum ServiceAuthTransactionAttempt<T> {
    Committed(T),
    RolledBack(SnapbackError),
    CommitUncertain {
        error: SnapbackError,
        terminal: Option<crate::auth::service_fence::PreparedServiceAuthorityTerminal>,
    },
}

struct ExpectedTable {
    name: &'static str,
    sql: &'static str,
}

struct ExpectedIndex {
    name: &'static str,
    table: &'static str,
    sql: &'static str,
}

/// The frozen version-1 table set, retained verbatim so a v2-aware binary still
/// recognizes a legacy v1 catalog exactly. It must never drift.
const AUTH_TABLES_V1: &[ExpectedTable] = &[
    ExpectedTable {
        name: "_auth_users",
        sql: r#"
CREATE TABLE "_auth_users" (
  id TEXT NOT NULL PRIMARY KEY,
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991)
)
"#,
    },
    ExpectedTable {
        name: "_auth_identities",
        sql: r#"
CREATE TABLE "_auth_identities" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(length(provider) > 0),
  subject TEXT NOT NULL CHECK(length(subject) > 0),
  verified_at_ms INTEGER NOT NULL
    CHECK(verified_at_ms BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY(user_id) REFERENCES "_auth_users"(id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_sessions",
        sql: r#"
CREATE TABLE "_auth_sessions" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  authority_instance_id TEXT NOT NULL,
  token_hash BLOB NOT NULL CHECK(length(token_hash) = 32),
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  last_used_at_ms INTEGER NOT NULL
    CHECK(last_used_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL
    CHECK(expires_at_ms BETWEEN 0 AND 9007199254740991),
  absolute_expires_at_ms INTEGER NOT NULL
    CHECK(absolute_expires_at_ms BETWEEN 0 AND 9007199254740991),
  revoked_at_ms INTEGER
    CHECK(revoked_at_ms IS NULL OR revoked_at_ms BETWEEN 0 AND 9007199254740991),
  CHECK(created_at_ms <= last_used_at_ms),
  CHECK(last_used_at_ms <= expires_at_ms),
  CHECK(expires_at_ms <= absolute_expires_at_ms),
  CHECK(revoked_at_ms IS NULL OR created_at_ms <= revoked_at_ms),
  FOREIGN KEY(user_id) REFERENCES "_auth_users"(id) ON DELETE CASCADE,
  FOREIGN KEY(identity_id, user_id)
    REFERENCES "_auth_identities"(id, user_id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_session_tokens",
        sql: r#"
CREATE TABLE "_auth_session_tokens" (
  token_hash BLOB NOT NULL PRIMARY KEY CHECK(length(token_hash) = 32),
  session_id TEXT NOT NULL,
  superseded_at_ms INTEGER NOT NULL
    CHECK(superseded_at_ms BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY(session_id) REFERENCES "_auth_sessions"(id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_verification_codes",
        sql: r#"
CREATE TABLE "_auth_verification_codes" (
  challenge_id TEXT NOT NULL PRIMARY KEY,
  canonical_address TEXT NOT NULL CHECK(length(canonical_address) > 0),
  code_digest BLOB NOT NULL CHECK(length(code_digest) = 32),
  key_id TEXT NOT NULL CHECK(length(key_id) > 0),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  requested_at_ms INTEGER NOT NULL
    CHECK(requested_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL
    CHECK(expires_at_ms BETWEEN 0 AND 9007199254740991),
  consumed_at_ms INTEGER
    CHECK(consumed_at_ms IS NULL OR consumed_at_ms BETWEEN 0 AND 9007199254740991),
  superseded_by TEXT,
  CHECK(attempts >= 0 AND attempts <= max_attempts),
  CHECK(max_attempts = 5),
  CHECK(requested_at_ms <= expires_at_ms),
  CHECK(consumed_at_ms IS NULL OR consumed_at_ms >= requested_at_ms),
  CHECK(consumed_at_ms IS NULL OR superseded_by IS NULL)
)
"#,
    },
];

/// The frozen version-1 index set. Never drift (see [`AUTH_TABLES_V1`]).
const AUTH_INDEXES_V1: &[ExpectedIndex] = &[
    ExpectedIndex {
        name: "_auth_identities_provider_subject_uq",
        table: "_auth_identities",
        sql: r#"CREATE UNIQUE INDEX "_auth_identities_provider_subject_uq"
  ON "_auth_identities"(provider, subject)"#,
    },
    ExpectedIndex {
        name: "_auth_identities_id_user_uq",
        table: "_auth_identities",
        sql: r#"CREATE UNIQUE INDEX "_auth_identities_id_user_uq"
  ON "_auth_identities"(id, user_id)"#,
    },
    ExpectedIndex {
        name: "_auth_identities_user",
        table: "_auth_identities",
        sql: r#"CREATE INDEX "_auth_identities_user"
  ON "_auth_identities"(user_id, id)"#,
    },
    ExpectedIndex {
        name: "_auth_sessions_token_uq",
        table: "_auth_sessions",
        sql: r#"CREATE UNIQUE INDEX "_auth_sessions_token_uq"
  ON "_auth_sessions"(token_hash)"#,
    },
    ExpectedIndex {
        name: "_auth_sessions_authority_instance_uq",
        table: "_auth_sessions",
        sql: r#"CREATE UNIQUE INDEX "_auth_sessions_authority_instance_uq"
  ON "_auth_sessions"(authority_instance_id)"#,
    },
    ExpectedIndex {
        name: "_auth_sessions_user_live",
        table: "_auth_sessions",
        sql: r#"CREATE INDEX "_auth_sessions_user_live"
  ON "_auth_sessions"(user_id, created_at_ms, id)
  WHERE revoked_at_ms IS NULL"#,
    },
    ExpectedIndex {
        name: "_auth_sessions_absolute_expiry",
        table: "_auth_sessions",
        sql: r#"CREATE INDEX "_auth_sessions_absolute_expiry"
  ON "_auth_sessions"(absolute_expires_at_ms, id)"#,
    },
    ExpectedIndex {
        name: "_auth_session_tokens_session",
        table: "_auth_session_tokens",
        sql: r#"CREATE INDEX "_auth_session_tokens_session"
  ON "_auth_session_tokens"(session_id, superseded_at_ms, token_hash)"#,
    },
    ExpectedIndex {
        name: "_auth_verification_codes_one_active",
        table: "_auth_verification_codes",
        sql: r#"CREATE UNIQUE INDEX "_auth_verification_codes_one_active"
  ON "_auth_verification_codes"(canonical_address)
  WHERE consumed_at_ms IS NULL AND superseded_by IS NULL"#,
    },
    ExpectedIndex {
        name: "_auth_verification_codes_address_requested",
        table: "_auth_verification_codes",
        sql: r#"CREATE INDEX "_auth_verification_codes_address_requested"
  ON "_auth_verification_codes"(canonical_address, requested_at_ms)"#,
    },
    ExpectedIndex {
        name: "_auth_verification_codes_requested",
        table: "_auth_verification_codes",
        sql: r#"CREATE INDEX "_auth_verification_codes_requested"
  ON "_auth_verification_codes"(requested_at_ms, challenge_id)"#,
    },
    ExpectedIndex {
        name: "_auth_verification_codes_expiry",
        table: "_auth_verification_codes",
        sql: r#"CREATE INDEX "_auth_verification_codes_expiry"
  ON "_auth_verification_codes"(expires_at_ms, challenge_id)"#,
    },
];

/// The current (version-2) table set: version 1 with the LLP 0055 agent columns
/// on `_auth_users`, plus the six agent catalog tables. Fresh activation creates
/// exactly this shape and recognition validates a `"2"` marker against it.
///
/// @ref LLP 0055#catalog-and-lifecycle — `_auth_grants`, `_auth_agent_credentials`,
///   `_auth_grant_tokens`, `_auth_agent_invitations`, `_auth_pairing_requests`,
///   and `_auth_scope_bases` join the protected `_auth_*` catalog; the six-table
///   lifecycle (grants/tokens/consent) lands in G3/G4 — G1 owns only the shape.
const AUTH_TABLES_V2: &[ExpectedTable] = &[
    ExpectedTable {
        name: "_auth_users",
        // @ref LLP 0055#principal-kinds — `kind` is immutable and defaults
        //   `human`; agents additionally carry `display_name`,
        //   `operator_contact`, an immutable `registration_provenance`,
        //   `deactivated_at_ms`, and a nullable `owner_user_id`. The biconditional
        //   checks pin human⇔no-provenance and agent⇔has-provenance, and confine
        //   deactivation/ownership to agents. Immutability of `kind` and
        //   `registration_provenance` is an application invariant (create-only).
        sql: r#"
CREATE TABLE "_auth_users" (
  id TEXT NOT NULL PRIMARY KEY,
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  kind TEXT NOT NULL DEFAULT 'human' CHECK(kind IN ('human', 'agent')),
  display_name TEXT,
  operator_contact TEXT,
  registration_provenance TEXT,
  deactivated_at_ms INTEGER
    CHECK(deactivated_at_ms IS NULL OR deactivated_at_ms BETWEEN 0 AND 9007199254740991),
  owner_user_id TEXT,
  CHECK(kind = 'agent' OR registration_provenance IS NULL),
  CHECK(kind = 'human' OR registration_provenance IS NOT NULL),
  CHECK(kind = 'agent' OR deactivated_at_ms IS NULL),
  CHECK(kind = 'agent' OR owner_user_id IS NULL),
  CHECK(owner_user_id IS NULL OR owner_user_id <> id),
  FOREIGN KEY(owner_user_id) REFERENCES "_auth_users"(id) ON DELETE SET NULL
)
"#,
    },
    ExpectedTable {
        name: "_auth_identities",
        sql: r#"
CREATE TABLE "_auth_identities" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(length(provider) > 0),
  subject TEXT NOT NULL CHECK(length(subject) > 0),
  verified_at_ms INTEGER NOT NULL
    CHECK(verified_at_ms BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY(user_id) REFERENCES "_auth_users"(id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_sessions",
        sql: r#"
CREATE TABLE "_auth_sessions" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  authority_instance_id TEXT NOT NULL,
  token_hash BLOB NOT NULL CHECK(length(token_hash) = 32),
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  last_used_at_ms INTEGER NOT NULL
    CHECK(last_used_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL
    CHECK(expires_at_ms BETWEEN 0 AND 9007199254740991),
  absolute_expires_at_ms INTEGER NOT NULL
    CHECK(absolute_expires_at_ms BETWEEN 0 AND 9007199254740991),
  revoked_at_ms INTEGER
    CHECK(revoked_at_ms IS NULL OR revoked_at_ms BETWEEN 0 AND 9007199254740991),
  CHECK(created_at_ms <= last_used_at_ms),
  CHECK(last_used_at_ms <= expires_at_ms),
  CHECK(expires_at_ms <= absolute_expires_at_ms),
  CHECK(revoked_at_ms IS NULL OR created_at_ms <= revoked_at_ms),
  FOREIGN KEY(user_id) REFERENCES "_auth_users"(id) ON DELETE CASCADE,
  FOREIGN KEY(identity_id, user_id)
    REFERENCES "_auth_identities"(id, user_id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_session_tokens",
        sql: r#"
CREATE TABLE "_auth_session_tokens" (
  token_hash BLOB NOT NULL PRIMARY KEY CHECK(length(token_hash) = 32),
  session_id TEXT NOT NULL,
  superseded_at_ms INTEGER NOT NULL
    CHECK(superseded_at_ms BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY(session_id) REFERENCES "_auth_sessions"(id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_verification_codes",
        sql: r#"
CREATE TABLE "_auth_verification_codes" (
  challenge_id TEXT NOT NULL PRIMARY KEY,
  canonical_address TEXT NOT NULL CHECK(length(canonical_address) > 0),
  code_digest BLOB NOT NULL CHECK(length(code_digest) = 32),
  key_id TEXT NOT NULL CHECK(length(key_id) > 0),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  requested_at_ms INTEGER NOT NULL
    CHECK(requested_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL
    CHECK(expires_at_ms BETWEEN 0 AND 9007199254740991),
  consumed_at_ms INTEGER
    CHECK(consumed_at_ms IS NULL OR consumed_at_ms BETWEEN 0 AND 9007199254740991),
  superseded_by TEXT,
  CHECK(attempts >= 0 AND attempts <= max_attempts),
  CHECK(max_attempts = 5),
  CHECK(requested_at_ms <= expires_at_ms),
  CHECK(consumed_at_ms IS NULL OR consumed_at_ms >= requested_at_ms),
  CHECK(consumed_at_ms IS NULL OR superseded_by IS NULL)
)
"#,
    },
    // @ref LLP 0055#credentials-and-tokens — at most one live agent credential
    //   per principal (the partial unique index below); id is stable across
    //   rotation. Rotation/revoke-self and the tombstoned family window are G4.
    ExpectedTable {
        name: "_auth_agent_credentials",
        sql: r#"
CREATE TABLE "_auth_agent_credentials" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  secret_hash BLOB NOT NULL CHECK(length(secret_hash) = 32),
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  rotated_at_ms INTEGER NOT NULL
    CHECK(rotated_at_ms BETWEEN 0 AND 9007199254740991),
  last_used_at_ms INTEGER NOT NULL
    CHECK(last_used_at_ms BETWEEN 0 AND 9007199254740991),
  revoked_at_ms INTEGER
    CHECK(revoked_at_ms IS NULL OR revoked_at_ms BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY(user_id) REFERENCES "_auth_users"(id) ON DELETE CASCADE
)
"#,
    },
    // @ref LLP 0055#grants — grants are immutable: created, then revoked or
    //   expired. Delegated grants (effective_user_id NOT NULL) MUST carry an
    //   expiry; autonomous ones (NULL) may be indefinite. `scopes` is canonical
    //   structured JSON; `created_by` is a tagged provenance string.
    ExpectedTable {
        name: "_auth_grants",
        sql: r#"
CREATE TABLE "_auth_grants" (
  id TEXT NOT NULL PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  effective_user_id TEXT,
  scopes TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER
    CHECK(expires_at_ms IS NULL OR expires_at_ms BETWEEN 0 AND 9007199254740991),
  revoked_at_ms INTEGER
    CHECK(revoked_at_ms IS NULL OR revoked_at_ms BETWEEN 0 AND 9007199254740991),
  created_by TEXT NOT NULL,
  request_id TEXT,
  consent_digest BLOB CHECK(consent_digest IS NULL OR length(consent_digest) = 32),
  last_used_at_ms INTEGER NOT NULL
    CHECK(last_used_at_ms BETWEEN 0 AND 9007199254740991),
  CHECK(effective_user_id IS NULL OR expires_at_ms IS NOT NULL),
  FOREIGN KEY(actor_user_id) REFERENCES "_auth_users"(id) ON DELETE CASCADE,
  FOREIGN KEY(effective_user_id) REFERENCES "_auth_users"(id) ON DELETE CASCADE
)
"#,
    },
    // @ref LLP 0055#credentials-and-tokens — a scoped token binds exactly one
    //   grant and records its minting credential id + generation for the durable
    //   authority axis. Per-invocation validation and settlement are G3/G4.
    ExpectedTable {
        name: "_auth_grant_tokens",
        sql: r#"
CREATE TABLE "_auth_grant_tokens" (
  id TEXT NOT NULL PRIMARY KEY,
  token_hash BLOB NOT NULL CHECK(length(token_hash) = 32),
  grant_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  credential_generation INTEGER NOT NULL CHECK(credential_generation >= 1),
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL
    CHECK(expires_at_ms BETWEEN 0 AND 9007199254740991),
  revoked_at_ms INTEGER
    CHECK(revoked_at_ms IS NULL OR revoked_at_ms BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY(grant_id) REFERENCES "_auth_grants"(id) ON DELETE CASCADE,
  FOREIGN KEY(credential_id) REFERENCES "_auth_agent_credentials"(id) ON DELETE CASCADE
)
"#,
    },
    // @ref LLP 0055#grants — creation (`sbagi_`) and recovery (`sbagr_`)
    //   invitations are distinct classes with distinct routes; `minted_profile`
    //   records the profile at mint so the effect site can refuse a
    //   demo→reboot→prod laundering path. Consumption/lifecycle is G3.
    ExpectedTable {
        name: "_auth_agent_invitations",
        sql: r#"
CREATE TABLE "_auth_agent_invitations" (
  id TEXT NOT NULL PRIMARY KEY,
  token_hash BLOB NOT NULL CHECK(length(token_hash) = 32),
  class TEXT NOT NULL CHECK(class IN ('creation', 'recovery')),
  created_by TEXT NOT NULL,
  minted_profile TEXT NOT NULL CHECK(length(minted_profile) > 0),
  agent_user_id TEXT,
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL
    CHECK(expires_at_ms BETWEEN 0 AND 9007199254740991),
  revoked_at_ms INTEGER
    CHECK(revoked_at_ms IS NULL OR revoked_at_ms BETWEEN 0 AND 9007199254740991),
  consumed_at_ms INTEGER
    CHECK(consumed_at_ms IS NULL OR consumed_at_ms BETWEEN 0 AND 9007199254740991),
  consumed_by TEXT,
  CHECK((class = 'recovery') = (agent_user_id IS NOT NULL)),
  CHECK(consumed_at_ms IS NULL OR revoked_at_ms IS NULL),
  FOREIGN KEY(agent_user_id) REFERENCES "_auth_users"(id) ON DELETE CASCADE
)
"#,
    },
    // @ref LLP 0055#grants — the user-minted pairing code is the consent secret;
    //   these rows are the pending consent records. Single-use CAS, the attempt
    //   ceiling, and approval→grant are G3.
    ExpectedTable {
        name: "_auth_pairing_requests",
        sql: r#"
CREATE TABLE "_auth_pairing_requests" (
  id TEXT NOT NULL PRIMARY KEY,
  code_hash BLOB NOT NULL CHECK(length(code_hash) = 32),
  minted_by_user_id TEXT NOT NULL,
  agent_user_id TEXT,
  requested_scopes TEXT,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending', 'approved', 'denied')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0 AND attempts <= 5),
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL
    CHECK(expires_at_ms BETWEEN 0 AND 9007199254740991),
  consumed_at_ms INTEGER
    CHECK(consumed_at_ms IS NULL OR consumed_at_ms BETWEEN 0 AND 9007199254740991),
  grant_id TEXT,
  FOREIGN KEY(minted_by_user_id) REFERENCES "_auth_users"(id) ON DELETE CASCADE,
  FOREIGN KEY(agent_user_id) REFERENCES "_auth_users"(id) ON DELETE CASCADE,
  FOREIGN KEY(grant_id) REFERENCES "_auth_grants"(id) ON DELETE SET NULL
)
"#,
    },
    // @ref LLP 0055#grants — `_auth_scope_bases` is a durable tombstone table:
    //   one row per function id carrying the basis `generation`, whether the
    //   function is currently `present`, and whether it is `authority_creating`.
    //   It is NEVER garbage-collected — a removed-then-readded function id must
    //   resume above its stale basis so old consent cannot revive. The activation
    //   re-validation that advances the basis is G3 (LLP 0053 event 2).
    ExpectedTable {
        name: "_auth_scope_bases",
        sql: r#"
CREATE TABLE "_auth_scope_bases" (
  function_id TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL CHECK(length(kind) > 0),
  generation INTEGER NOT NULL CHECK(generation >= 0),
  present INTEGER NOT NULL CHECK(present IN (0, 1)),
  authority_creating INTEGER NOT NULL CHECK(authority_creating IN (0, 1))
)
"#,
    },
];

/// The current (version-2) index set: the version-1 indexes plus the agent
/// tables' indexes (chiefly the at-most-one-live-credential partial unique index
/// and the token/invitation/pairing-code lookup uniqueness).
const AUTH_INDEXES_V2: &[ExpectedIndex] = &[
    ExpectedIndex {
        name: "_auth_identities_provider_subject_uq",
        table: "_auth_identities",
        sql: r#"CREATE UNIQUE INDEX "_auth_identities_provider_subject_uq"
  ON "_auth_identities"(provider, subject)"#,
    },
    ExpectedIndex {
        name: "_auth_identities_id_user_uq",
        table: "_auth_identities",
        sql: r#"CREATE UNIQUE INDEX "_auth_identities_id_user_uq"
  ON "_auth_identities"(id, user_id)"#,
    },
    ExpectedIndex {
        name: "_auth_identities_user",
        table: "_auth_identities",
        sql: r#"CREATE INDEX "_auth_identities_user"
  ON "_auth_identities"(user_id, id)"#,
    },
    ExpectedIndex {
        name: "_auth_sessions_token_uq",
        table: "_auth_sessions",
        sql: r#"CREATE UNIQUE INDEX "_auth_sessions_token_uq"
  ON "_auth_sessions"(token_hash)"#,
    },
    ExpectedIndex {
        name: "_auth_sessions_authority_instance_uq",
        table: "_auth_sessions",
        sql: r#"CREATE UNIQUE INDEX "_auth_sessions_authority_instance_uq"
  ON "_auth_sessions"(authority_instance_id)"#,
    },
    ExpectedIndex {
        name: "_auth_sessions_user_live",
        table: "_auth_sessions",
        sql: r#"CREATE INDEX "_auth_sessions_user_live"
  ON "_auth_sessions"(user_id, created_at_ms, id)
  WHERE revoked_at_ms IS NULL"#,
    },
    ExpectedIndex {
        name: "_auth_sessions_absolute_expiry",
        table: "_auth_sessions",
        sql: r#"CREATE INDEX "_auth_sessions_absolute_expiry"
  ON "_auth_sessions"(absolute_expires_at_ms, id)"#,
    },
    ExpectedIndex {
        name: "_auth_session_tokens_session",
        table: "_auth_session_tokens",
        sql: r#"CREATE INDEX "_auth_session_tokens_session"
  ON "_auth_session_tokens"(session_id, superseded_at_ms, token_hash)"#,
    },
    ExpectedIndex {
        name: "_auth_verification_codes_one_active",
        table: "_auth_verification_codes",
        sql: r#"CREATE UNIQUE INDEX "_auth_verification_codes_one_active"
  ON "_auth_verification_codes"(canonical_address)
  WHERE consumed_at_ms IS NULL AND superseded_by IS NULL"#,
    },
    ExpectedIndex {
        name: "_auth_verification_codes_address_requested",
        table: "_auth_verification_codes",
        sql: r#"CREATE INDEX "_auth_verification_codes_address_requested"
  ON "_auth_verification_codes"(canonical_address, requested_at_ms)"#,
    },
    ExpectedIndex {
        name: "_auth_verification_codes_requested",
        table: "_auth_verification_codes",
        sql: r#"CREATE INDEX "_auth_verification_codes_requested"
  ON "_auth_verification_codes"(requested_at_ms, challenge_id)"#,
    },
    ExpectedIndex {
        name: "_auth_verification_codes_expiry",
        table: "_auth_verification_codes",
        sql: r#"CREATE INDEX "_auth_verification_codes_expiry"
  ON "_auth_verification_codes"(expires_at_ms, challenge_id)"#,
    },
    ExpectedIndex {
        name: "_auth_agent_credentials_user_live",
        table: "_auth_agent_credentials",
        sql: r#"CREATE UNIQUE INDEX "_auth_agent_credentials_user_live"
  ON "_auth_agent_credentials"(user_id)
  WHERE revoked_at_ms IS NULL"#,
    },
    ExpectedIndex {
        name: "_auth_agent_credentials_user",
        table: "_auth_agent_credentials",
        sql: r#"CREATE INDEX "_auth_agent_credentials_user"
  ON "_auth_agent_credentials"(user_id, id)"#,
    },
    ExpectedIndex {
        name: "_auth_grants_actor_live",
        table: "_auth_grants",
        sql: r#"CREATE INDEX "_auth_grants_actor_live"
  ON "_auth_grants"(actor_user_id, created_at_ms, id)
  WHERE revoked_at_ms IS NULL"#,
    },
    ExpectedIndex {
        name: "_auth_grants_effective_live",
        table: "_auth_grants",
        sql: r#"CREATE INDEX "_auth_grants_effective_live"
  ON "_auth_grants"(effective_user_id, created_at_ms, id)
  WHERE revoked_at_ms IS NULL AND effective_user_id IS NOT NULL"#,
    },
    ExpectedIndex {
        name: "_auth_grants_expiry",
        table: "_auth_grants",
        sql: r#"CREATE INDEX "_auth_grants_expiry"
  ON "_auth_grants"(expires_at_ms, id)"#,
    },
    ExpectedIndex {
        name: "_auth_grant_tokens_token_uq",
        table: "_auth_grant_tokens",
        sql: r#"CREATE UNIQUE INDEX "_auth_grant_tokens_token_uq"
  ON "_auth_grant_tokens"(token_hash)"#,
    },
    ExpectedIndex {
        name: "_auth_grant_tokens_grant_live",
        table: "_auth_grant_tokens",
        sql: r#"CREATE INDEX "_auth_grant_tokens_grant_live"
  ON "_auth_grant_tokens"(grant_id, created_at_ms, id)
  WHERE revoked_at_ms IS NULL"#,
    },
    ExpectedIndex {
        name: "_auth_grant_tokens_expiry",
        table: "_auth_grant_tokens",
        sql: r#"CREATE INDEX "_auth_grant_tokens_expiry"
  ON "_auth_grant_tokens"(expires_at_ms, id)"#,
    },
    ExpectedIndex {
        name: "_auth_agent_invitations_token_uq",
        table: "_auth_agent_invitations",
        sql: r#"CREATE UNIQUE INDEX "_auth_agent_invitations_token_uq"
  ON "_auth_agent_invitations"(token_hash)"#,
    },
    ExpectedIndex {
        name: "_auth_agent_invitations_agent",
        table: "_auth_agent_invitations",
        sql: r#"CREATE INDEX "_auth_agent_invitations_agent"
  ON "_auth_agent_invitations"(agent_user_id, id)
  WHERE agent_user_id IS NOT NULL"#,
    },
    ExpectedIndex {
        name: "_auth_agent_invitations_expiry",
        table: "_auth_agent_invitations",
        sql: r#"CREATE INDEX "_auth_agent_invitations_expiry"
  ON "_auth_agent_invitations"(expires_at_ms, id)"#,
    },
    ExpectedIndex {
        name: "_auth_pairing_requests_code_uq",
        table: "_auth_pairing_requests",
        sql: r#"CREATE UNIQUE INDEX "_auth_pairing_requests_code_uq"
  ON "_auth_pairing_requests"(code_hash)"#,
    },
    ExpectedIndex {
        name: "_auth_pairing_requests_minter",
        table: "_auth_pairing_requests",
        sql: r#"CREATE INDEX "_auth_pairing_requests_minter"
  ON "_auth_pairing_requests"(minted_by_user_id, created_at_ms, id)"#,
    },
    ExpectedIndex {
        name: "_auth_pairing_requests_expiry",
        table: "_auth_pairing_requests",
        sql: r#"CREATE INDEX "_auth_pairing_requests_expiry"
  ON "_auth_pairing_requests"(expires_at_ms, id)"#,
    },
];

/// Catalog-v3 identity-core tables. The LLP 0055 agent tables are composed
/// from `AUTH_TABLES_V2[5..]` by [`catalog_tables`] so there is only one frozen
/// spelling for every carried object.
///
/// @ref LLP 0214#33-four-storage-layers — principals, identity links,
/// credentials/typed material, and assurances remain physically distinct.
const AUTH_TABLES_V3_CORE: &[ExpectedTable] = &[
    ExpectedTable {
        name: "_auth_users",
        sql: r#"
CREATE TABLE "_auth_users" (
  id TEXT NOT NULL PRIMARY KEY,
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  kind TEXT NOT NULL DEFAULT 'human'
    CHECK(kind IN ('human', 'agent')),
  display_name TEXT,
  operator_contact TEXT,
  registration_provenance TEXT,
  deactivated_at_ms INTEGER
    CHECK(deactivated_at_ms IS NULL
      OR deactivated_at_ms BETWEEN 0 AND 9007199254740991),
  owner_user_id TEXT,
  guest_state TEXT NOT NULL DEFAULT 'never'
    CHECK(guest_state IN ('never', 'active', 'claimed', 'reaped')),
  guest_expires_at_ms INTEGER
    CHECK(guest_expires_at_ms IS NULL
      OR guest_expires_at_ms BETWEEN 0 AND 9007199254740991),
  guest_claimed_at_ms INTEGER
    CHECK(guest_claimed_at_ms IS NULL
      OR guest_claimed_at_ms BETWEEN 0 AND 9007199254740991),
  CHECK(kind = 'agent' OR registration_provenance IS NULL),
  CHECK(kind = 'human' OR registration_provenance IS NOT NULL),
  CHECK(kind = 'agent' OR deactivated_at_ms IS NULL),
  CHECK(kind = 'agent' OR owner_user_id IS NULL),
  CHECK(owner_user_id IS NULL OR owner_user_id <> id),
  CHECK(kind = 'human' OR guest_state = 'never'),
  CHECK((guest_state = 'active') = (guest_expires_at_ms IS NOT NULL)),
  CHECK((guest_state = 'claimed') = (guest_claimed_at_ms IS NOT NULL)),
  CHECK(guest_claimed_at_ms IS NULL
    OR guest_claimed_at_ms >= created_at_ms),
  FOREIGN KEY(owner_user_id)
    REFERENCES "_auth_users"(id) ON DELETE SET NULL
)
"#,
    },
    ExpectedTable {
        name: "_auth_identities",
        sql: r#"
CREATE TABLE "_auth_identities" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK(kind IN ('email', 'phone', 'oidc', 'oauth2',
                   'username', 'external')),
  provider TEXT NOT NULL CHECK(length(provider) > 0),
  issuer TEXT,
  subject TEXT NOT NULL CHECK(length(subject) > 0),
  canonical_value TEXT,
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  verified_at_ms INTEGER NOT NULL
    CHECK(verified_at_ms BETWEEN 0 AND 9007199254740991),
  disabled_at_ms INTEGER
    CHECK(disabled_at_ms IS NULL
      OR disabled_at_ms BETWEEN 0 AND 9007199254740991),
  CHECK(created_at_ms <= verified_at_ms),
  CHECK(kind = 'oidc' OR issuer IS NULL),
  CHECK(kind <> 'oidc' OR issuer IS NOT NULL),
  FOREIGN KEY(user_id)
    REFERENCES "_auth_users"(id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_credentials",
        sql: r#"
CREATE TABLE "_auth_credentials" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK(kind IN ('password', 'passkey', 'recovery-code-set')),
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  last_used_at_ms INTEGER
    CHECK(last_used_at_ms IS NULL
      OR last_used_at_ms BETWEEN 0 AND 9007199254740991),
  revoked_at_ms INTEGER
    CHECK(revoked_at_ms IS NULL
      OR revoked_at_ms BETWEEN 0 AND 9007199254740991),
  CHECK(last_used_at_ms IS NULL OR created_at_ms <= last_used_at_ms),
  CHECK(revoked_at_ms IS NULL OR created_at_ms <= revoked_at_ms),
  FOREIGN KEY(user_id)
    REFERENCES "_auth_users"(id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_password_credentials",
        sql: r#"
CREATE TABLE "_auth_password_credentials" (
  credential_id TEXT NOT NULL PRIMARY KEY,
  algorithm TEXT NOT NULL CHECK(algorithm = 'argon2id'),
  hash_phc TEXT NOT NULL CHECK(length(hash_phc) > 0),
  policy_version INTEGER NOT NULL CHECK(policy_version >= 1),
  common_password_list_version INTEGER NOT NULL
    CHECK(common_password_list_version >= 1),
  changed_at_ms INTEGER NOT NULL
    CHECK(changed_at_ms BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY(credential_id)
    REFERENCES "_auth_credentials"(id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_passkey_credentials",
        sql: r#"
CREATE TABLE "_auth_passkey_credentials" (
  credential_id TEXT NOT NULL PRIMARY KEY,
  webauthn_credential_id BLOB NOT NULL
    CHECK(length(webauthn_credential_id) > 0),
  public_key_cose BLOB NOT NULL
    CHECK(length(public_key_cose) > 0),
  sign_count INTEGER NOT NULL CHECK(sign_count >= 0),
  rp_id TEXT NOT NULL CHECK(length(rp_id) > 0),
  user_handle BLOB NOT NULL CHECK(length(user_handle) > 0),
  transports TEXT NOT NULL,
  FOREIGN KEY(credential_id)
    REFERENCES "_auth_credentials"(id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_recovery_code_sets",
        sql: r#"
CREATE TABLE "_auth_recovery_code_sets" (
  credential_id TEXT NOT NULL PRIMARY KEY,
  set_generation INTEGER NOT NULL CHECK(set_generation >= 1),
  reason TEXT NOT NULL
    CHECK(reason IN ('initial', 'after-use', 'suspected-disclosure',
                     'operator-recovery')),
  issued_at_ms INTEGER NOT NULL
    CHECK(issued_at_ms BETWEEN 0 AND 9007199254740991),
  replaced_at_ms INTEGER
    CHECK(replaced_at_ms IS NULL
      OR replaced_at_ms BETWEEN 0 AND 9007199254740991),
  CHECK(replaced_at_ms IS NULL OR issued_at_ms <= replaced_at_ms),
  FOREIGN KEY(credential_id)
    REFERENCES "_auth_credentials"(id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_recovery_codes",
        sql: r#"
CREATE TABLE "_auth_recovery_codes" (
  set_credential_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  code_digest BLOB NOT NULL CHECK(length(code_digest) = 32),
  key_id TEXT NOT NULL CHECK(length(key_id) > 0),
  consumed_at_ms INTEGER
    CHECK(consumed_at_ms IS NULL
      OR consumed_at_ms BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(set_credential_id, ordinal),
  FOREIGN KEY(set_credential_id)
    REFERENCES "_auth_recovery_code_sets"(credential_id)
    ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_sessions",
        sql: r#"
CREATE TABLE "_auth_sessions" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  identity_id TEXT,
  credential_id TEXT,
  authn_source TEXT NOT NULL
    CHECK(authn_source IN ('guest', 'identity', 'credential')),
  authority_instance_id TEXT NOT NULL,
  token_hash BLOB NOT NULL CHECK(length(token_hash) = 32),
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  last_used_at_ms INTEGER NOT NULL
    CHECK(last_used_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL
    CHECK(expires_at_ms BETWEEN 0 AND 9007199254740991),
  absolute_expires_at_ms INTEGER NOT NULL
    CHECK(absolute_expires_at_ms BETWEEN 0 AND 9007199254740991),
  revoked_at_ms INTEGER
    CHECK(revoked_at_ms IS NULL
      OR revoked_at_ms BETWEEN 0 AND 9007199254740991),
  CHECK(created_at_ms <= last_used_at_ms),
  CHECK(last_used_at_ms <= expires_at_ms),
  CHECK(expires_at_ms <= absolute_expires_at_ms),
  CHECK(revoked_at_ms IS NULL OR created_at_ms <= revoked_at_ms),
  CHECK(
    (authn_source = 'guest'
      AND identity_id IS NULL AND credential_id IS NULL)
    OR
    (authn_source = 'identity'
      AND identity_id IS NOT NULL AND credential_id IS NULL)
    OR
    (authn_source = 'credential'
      AND identity_id IS NULL AND credential_id IS NOT NULL)
  ),
  FOREIGN KEY(user_id)
    REFERENCES "_auth_users"(id) ON DELETE CASCADE,
  FOREIGN KEY(identity_id, user_id)
    REFERENCES "_auth_identities"(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY(credential_id, user_id)
    REFERENCES "_auth_credentials"(id, user_id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_session_tokens",
        sql: AUTH_TABLES_V1[3].sql,
    },
    ExpectedTable {
        name: "_auth_verification_codes",
        sql: AUTH_TABLES_V1[4].sql,
    },
    ExpectedTable {
        name: "_auth_assurances",
        sql: r#"
CREATE TABLE "_auth_assurances" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT,
  identity_id TEXT,
  credential_id TEXT,
  kind TEXT NOT NULL
    CHECK(kind IN ('authenticated', 'email_verified', 'phone_verified',
                   'recent_auth', 'phishing_resistant')),
  provenance TEXT NOT NULL
    CHECK(provenance IN ('session', 'credential', 'delivery',
                         'federation', 'import', 'rehearsal')),
  issued_at_ms INTEGER NOT NULL
    CHECK(issued_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER
    CHECK(expires_at_ms IS NULL
      OR expires_at_ms BETWEEN 0 AND 9007199254740991),
  governing_authority TEXT,
  revoked_at_ms INTEGER
    CHECK(revoked_at_ms IS NULL
      OR revoked_at_ms BETWEEN 0 AND 9007199254740991),
  CHECK(expires_at_ms IS NULL OR issued_at_ms <= expires_at_ms),
  CHECK(revoked_at_ms IS NULL OR issued_at_ms <= revoked_at_ms),
  CHECK(provenance NOT IN ('delivery', 'federation', 'import', 'rehearsal')
    OR governing_authority IS NOT NULL),
  FOREIGN KEY(user_id)
    REFERENCES "_auth_users"(id) ON DELETE CASCADE,
  FOREIGN KEY(identity_id, user_id)
    REFERENCES "_auth_identities"(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY(credential_id, user_id)
    REFERENCES "_auth_credentials"(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY(session_id)
    REFERENCES "_auth_sessions"(id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_provisioning_receipts",
        sql: r#"
CREATE TABLE "_auth_provisioning_receipts" (
  provisioning_key TEXT NOT NULL PRIMARY KEY,
  hook_id TEXT NOT NULL,
  hook_digest BLOB NOT NULL CHECK(length(hook_digest) = 32),
  user_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  assurance_id TEXT NOT NULL,
  committed_at_ms INTEGER NOT NULL
    CHECK(committed_at_ms BETWEEN 0 AND 9007199254740991),
  app_commit_version INTEGER NOT NULL CHECK(app_commit_version >= 0),
  FOREIGN KEY(user_id)
    REFERENCES "_auth_users"(id) ON DELETE CASCADE,
  FOREIGN KEY(identity_id)
    REFERENCES "_auth_identities"(id) ON DELETE CASCADE,
  FOREIGN KEY(assurance_id)
    REFERENCES "_auth_assurances"(id) ON DELETE CASCADE
)
"#,
    },
    ExpectedTable {
        name: "_auth_security_events",
        sql: r#"
CREATE TABLE "_auth_security_events" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT,
  kind TEXT NOT NULL CHECK(length(kind) > 0),
  cause_class TEXT NOT NULL CHECK(length(cause_class) > 0),
  identity_id TEXT,
  credential_id TEXT,
  session_id TEXT,
  occurred_at_ms INTEGER NOT NULL
    CHECK(occurred_at_ms BETWEEN 0 AND 9007199254740991),
  correlation_id TEXT NOT NULL CHECK(length(correlation_id) > 0),
  redacted_metadata TEXT NOT NULL,
  FOREIGN KEY(user_id)
    REFERENCES "_auth_users"(id) ON DELETE SET NULL
)
"#,
    },
];

/// Catalog v4 carries the complete frozen v3 inventory and appends only the
/// account-existence-blind password lockout ledger. The canonical address is
/// protected catalog data in the same custody class as identity subjects.
///
/// @ref LLP 0214#20-amendment-2026-08-10-reconciliation-with-llp-0227 — the
/// attempt relation is lockout state only and never becomes a rate-budget
/// authority.
const AUTH_TABLES_V4_ADDITIONS: &[ExpectedTable] = &[ExpectedTable {
    name: "_auth_password_attempts",
    sql: r#"
CREATE TABLE "_auth_password_attempts" (
  address TEXT NOT NULL PRIMARY KEY
    CHECK(length(address) BETWEEN 1 AND 320),
  window_start_ms INTEGER NOT NULL
    CHECK(window_start_ms BETWEEN 0 AND 9007199254740991),
  failed_count INTEGER NOT NULL DEFAULT 0
    CHECK(failed_count BETWEEN 0 AND 9007199254740991),
  locked_until_ms INTEGER
    CHECK(locked_until_ms IS NULL
      OR locked_until_ms BETWEEN 0 AND 9007199254740991),
  CHECK(locked_until_ms IS NULL OR window_start_ms <= locked_until_ms)
)
"#,
}];

const AUTH_INDEXES_V3_ADDITIONS: &[ExpectedIndex] = &[
    ExpectedIndex {
        name: "_auth_credentials_id_user_uq",
        table: "_auth_credentials",
        sql: r#"CREATE UNIQUE INDEX "_auth_credentials_id_user_uq"
  ON "_auth_credentials"(id, user_id)"#,
    },
    ExpectedIndex {
        name: "_auth_credentials_user_live",
        table: "_auth_credentials",
        sql: r#"CREATE INDEX "_auth_credentials_user_live"
  ON "_auth_credentials"(user_id, kind, id)
  WHERE revoked_at_ms IS NULL"#,
    },
    ExpectedIndex {
        name: "_auth_password_one_live_per_user",
        table: "_auth_credentials",
        sql: r#"CREATE UNIQUE INDEX "_auth_password_one_live_per_user"
  ON "_auth_credentials"(user_id)
  WHERE kind = 'password' AND revoked_at_ms IS NULL"#,
    },
    ExpectedIndex {
        name: "_auth_passkey_credential_id_uq",
        table: "_auth_passkey_credentials",
        sql: r#"CREATE UNIQUE INDEX "_auth_passkey_credential_id_uq"
  ON "_auth_passkey_credentials"(webauthn_credential_id)"#,
    },
    ExpectedIndex {
        name: "_auth_recovery_codes_digest_uq",
        table: "_auth_recovery_codes",
        sql: r#"CREATE UNIQUE INDEX "_auth_recovery_codes_digest_uq"
  ON "_auth_recovery_codes"(code_digest)"#,
    },
    ExpectedIndex {
        name: "_auth_assurances_user_kind",
        table: "_auth_assurances",
        sql: r#"CREATE INDEX "_auth_assurances_user_kind"
  ON "_auth_assurances"(user_id, kind, issued_at_ms, id)"#,
    },
    ExpectedIndex {
        name: "_auth_assurances_session",
        table: "_auth_assurances",
        sql: r#"CREATE INDEX "_auth_assurances_session"
  ON "_auth_assurances"(session_id, kind, id)"#,
    },
];

#[derive(Debug)]
struct SchemaObject {
    kind: String,
    name: String,
    table: String,
    sql: Option<String>,
}

#[derive(Debug, Eq, PartialEq)]
struct CatalogShape {
    tables: BTreeMap<String, TableShape>,
    indexes: BTreeMap<String, IndexShape>,
}

#[derive(Debug, Eq, PartialEq)]
struct TableShape {
    normalized_sql: String,
    columns: Vec<ColumnShape>,
    foreign_keys: Vec<ForeignKeyShape>,
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

#[derive(Debug, Eq, PartialEq)]
struct ForeignKeyShape {
    id: i64,
    sequence: i64,
    target_table: String,
    from_column: String,
    to_column: Option<String>,
    on_update: String,
    on_delete: String,
    match_name: String,
}

#[derive(Debug, Eq, PartialEq)]
struct IndexShape {
    normalized_sql: String,
    table: String,
    unique: bool,
    origin: String,
    partial: bool,
    columns: Vec<IndexColumnShape>,
}

#[derive(Debug, Eq, PartialEq)]
struct IndexColumnShape {
    sequence: i64,
    column_id: i64,
    name: Option<String>,
    descending: bool,
    collation: Option<String>,
    key_column: bool,
}

impl LocalDatabase {
    /// Inspect the protected catalog without creating metadata, opening a
    /// transaction, or otherwise writing a WAL frame.
    pub fn inspect_auth_catalog(&self) -> SnapbackResult<AuthCatalogState> {
        inspect_auth_catalog_on(&self.conn)
    }

    pub fn auth_catalog_ready(&self) -> SnapbackResult<bool> {
        Ok(self.inspect_auth_catalog()?.is_ready())
    }

    /// Install the current auth catalog after the caller has established a
    /// usable keyring. Keeping keyring creation outside this method makes the
    /// required keyring-before-DDL ordering explicit at the integration seam. A
    /// recognized catalog of any version is left in place (a first-class v1→v2
    /// migration is deferred; see [`AUTH_CATALOG_VERSION_V1`]).
    pub fn activate_current_auth_catalog(&mut self) -> SnapbackResult<()> {
        match self.inspect_auth_catalog()? {
            AuthCatalogState::ReadyV1
            | AuthCatalogState::ReadyV2
            | AuthCatalogState::ReadyV3
            | AuthCatalogState::ReadyV4 => {
                return Ok(());
            }
            AuthCatalogState::Uninitialized => {}
        }

        self.activate_new_auth_catalog(PasswordIdentifierMode::UsernameV1)
    }

    /// Activate catalog v4 with an explicit, immutable password identifier
    /// mode. Later calls may confirm the declaration but cannot change it.
    pub fn activate_current_auth_catalog_with_password_identifier_mode(
        &mut self,
        mode: PasswordIdentifierMode,
    ) -> SnapbackResult<()> {
        match self.inspect_auth_catalog()? {
            AuthCatalogState::ReadyV4 => {
                let existing = read_password_identifier_mode_on(&self.conn)?;
                if existing == mode {
                    return Ok(());
                }
                return Err(password_identifier_mode_immutable());
            }
            AuthCatalogState::ReadyV1 | AuthCatalogState::ReadyV2 | AuthCatalogState::ReadyV3 => {
                return Err(password_requires_v4());
            }
            AuthCatalogState::Uninitialized => {}
        }

        self.activate_new_auth_catalog(mode)
    }

    fn activate_new_auth_catalog(&mut self, mode: PasswordIdentifierMode) -> SnapbackResult<()> {
        let authorization_interlock = self.authorization_interlock.clone();
        let commit_authority_identity = self.commit_authority_identity.clone();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        activate_current_auth_catalog_with_password_identifier_mode_in(&tx, mode)?;
        let authorization_predecessor = super::auth_stream::read_authorization_version_on(&tx)?;
        let authorization = super::authorization::authorization_commit_hook_in(
            &tx,
            super::authorization::AuthorizationCommitCause::Activation,
        )?;
        let min_commit_version = super::current_version_on(&tx)?;
        super::commit_with_authorization_interlock(
            tx,
            &authorization,
            super::AuthorizationCommitImpact::AllProtectedRooms,
            authorization_predecessor,
            min_commit_version,
            authorization_interlock,
            &commit_authority_identity,
        )?;
        require_ready_on(&self.conn)
    }

    /// Read the immutable mode directly from the exact catalog. This is a
    /// read-only operation and does not open a transaction, so readiness
    /// reporting can use it without mutating predecessor stores.
    pub fn auth_password_identifier_mode(&self) -> SnapbackResult<PasswordIdentifierMode> {
        require_password_identifier_mode_on(&self.conn)
    }

    /// Resolve the canonicalization contract used by the already-shipped
    /// catalog-v3 identity floor. V3 remains frozen at its original implicit
    /// username-v1 behavior; only v4 has a first-class stored declaration.
    pub(super) fn identity_floor_password_identifier_mode(
        &self,
    ) -> SnapbackResult<PasswordIdentifierMode> {
        identity_floor_password_identifier_mode_on(&self.conn)
    }

    pub fn auth_password_provider_readiness(&self) -> SnapbackResult<PasswordProviderReadiness> {
        Ok(match self.inspect_auth_catalog()? {
            AuthCatalogState::ReadyV4 => PasswordProviderReadiness::ready(
                read_password_identifier_mode_on(&self.conn)?.as_str(),
            ),
            AuthCatalogState::ReadyV1 => PasswordProviderReadiness::requires_v4(Some(1)),
            AuthCatalogState::ReadyV2 => PasswordProviderReadiness::requires_v4(Some(2)),
            AuthCatalogState::ReadyV3 => PasswordProviderReadiness::requires_v4(Some(3)),
            AuthCatalogState::Uninitialized => PasswordProviderReadiness::requires_v4(None),
        })
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_password_attempt_for_test(
        &mut self,
        address: &str,
        window_start_ms: u64,
        failed_count: u64,
        locked_until_ms: Option<u64>,
    ) -> SnapbackResult<()> {
        require_password_identifier_mode_on(&self.conn)?;
        self.conn.execute(
            "INSERT INTO _auth_password_attempts(
               address,window_start_ms,failed_count,locked_until_ms
             ) VALUES(?1,?2,?3,?4)",
            params![address, window_start_ms, failed_count, locked_until_ms],
        )?;
        Ok(())
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn password_attempt_for_test(
        &self,
        address: &str,
    ) -> SnapbackResult<Option<(u64, u64, Option<u64>)>> {
        require_password_identifier_mode_on(&self.conn)?;
        Ok(self
            .conn
            .query_row(
                "SELECT window_start_ms,failed_count,locked_until_ms
                 FROM _auth_password_attempts WHERE address=?1",
                [address],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_large_backup_fixture_for_test(&mut self) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute_batch(
                "CREATE TABLE backup_large_app_fixture(
                   id INTEGER PRIMARY KEY,
                   payload BLOB NOT NULL
                 );
                 INSERT INTO backup_large_app_fixture(payload)
                   VALUES(zeroblob(1048576));",
            )?;
            Ok(())
        })
    }

    /// Return the exact logical state used to prove an auth backup restored
    /// every protected table plus its large app-data fixture.
    ///
    /// @ref LLP 0285#53-defect-3--the-caller-selectable-raw-sqlite-feature —
    /// backup tests receive typed values, never a raw database handle.
    #[cfg(any(test, feature = "test-support"))]
    pub fn auth_backup_fixture_state_for_test(
        &self,
        address: &str,
    ) -> SnapbackResult<(BTreeMap<String, u64>, Option<(u64, u64, Option<u64>)>, u64)> {
        const TABLES: &[&str] = &[
            "_auth_credentials",
            "_auth_recovery_code_sets",
            "_auth_recovery_codes",
            "_auth_assurances",
            "_auth_security_events",
            "_auth_password_attempts",
        ];
        require_password_identifier_mode_on(&self.conn)?;
        let mut counts = BTreeMap::new();
        for table in TABLES {
            counts.insert(
                (*table).to_owned(),
                self.conn
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                        row.get(0)
                    })?,
            );
        }
        let attempt = self.password_attempt_for_test(address)?;
        let payload_bytes = self.conn.query_row(
            "SELECT length(payload) FROM backup_large_app_fixture",
            [],
            |row| row.get(0),
        )?;
        Ok((counts, attempt, payload_bytes))
    }

    /// Run a read through the protected lane. No raw connection accessor is
    /// exposed; callers must cross an exact recognized-catalog check for every
    /// operation.
    ///
    /// New callers outside the storage kernel are forbidden; enter through
    /// the typed kernels (LLP 0199 owner #2).
    pub(super) fn with_auth_read<T>(
        &self,
        operation: impl FnOnce(&Connection) -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        require_ready_on(&self.conn)?;
        operation(&self.conn)
    }

    /// Run one direct auth mutation as an IMMEDIATE transaction. `Ok(T)` is a
    /// committed outcome (including provider-level negative outcome enums);
    /// `Err` drops and rolls the transaction back.
    ///
    /// New callers outside the storage kernel are forbidden; enter through
    /// the typed kernels (LLP 0199 owner #2).
    pub(super) fn with_auth_transaction<T>(
        &mut self,
        operation: impl FnOnce(&Transaction<'_>) -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_ready_on(&tx)?;
        let output = operation(&tx)?;
        super::observe_durable_commit_for_test();
        tx.commit()?;
        Ok(output)
    }

    /// Run one direct auth transaction while preserving commit certainty for
    /// the coordinator. No projection/topology value enters this method; the
    /// caller has already installed a ticket and released every fence lock.
    ///
    /// @ref LLP 0059#rollback-and-ambiguous-commit — only a proven rollback
    /// exact-unmarks; a commit error is reconciled or left unavailable.
    ///
    /// New callers outside the storage kernel are forbidden; enter through
    /// the typed kernels (LLP 0199 owner #2).
    pub(super) fn attempt_auth_transaction<T>(
        &mut self,
        operation: impl FnOnce(&Transaction<'_>) -> SnapbackResult<T>,
    ) -> AuthTransactionAttempt<T> {
        let tx = match self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
        {
            Ok(tx) => tx,
            Err(error) => return AuthTransactionAttempt::RolledBack(error.into()),
        };
        if let Err(error) = require_ready_on(&tx) {
            return rollback_auth_transaction(tx, error);
        }
        let output = match operation(&tx) {
            Ok(output) => output,
            Err(error) => return rollback_auth_transaction(tx, error),
        };
        super::observe_durable_commit_for_test();
        match tx.commit() {
            Ok(()) => AuthTransactionAttempt::Committed(output),
            Err(error) => AuthTransactionAttempt::CommitUncertain(error.into()),
        }
    }

    /// Commit a durable service-authority ending through the process-local
    /// token-fence interlock. `plan` is a read-only immutable affected-id
    /// phase: its exact token fences are blocked before `operation` may write.
    /// A body failure therefore already owns the exact ticket needed to stay
    /// fail-closed if SQLite cannot prove rollback, without quarantining
    /// unrelated service authorities.
    ///
    /// @ref LLP 0059#finite-service-authority-fence — exact affected ids are
    /// planned read-only and premarked before the first durable ending write.
    pub(crate) fn attempt_auth_transaction_with_service_terminal<T>(
        &mut self,
        disposition: crate::auth::service_authority_contract::ServiceAuthorityDisposition,
        plan: impl FnOnce(&Transaction<'_>) -> SnapbackResult<Vec<String>>,
        operation: impl FnOnce(&Transaction<'_>) -> SnapbackResult<T>,
    ) -> ServiceAuthTransactionAttempt<T> {
        let tx = match self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
        {
            Ok(tx) => tx,
            Err(error) => return ServiceAuthTransactionAttempt::RolledBack(error.into()),
        };
        if let Err(error) = require_ready_on(&tx) {
            return rollback_unprepared_service_auth_transaction(tx, error);
        }
        let token_ids = match plan(&tx) {
            Ok(token_ids) => token_ids,
            Err(error) => return rollback_unprepared_service_auth_transaction(tx, error),
        };
        let Some(interlock) = self.service_authority_fences.as_ref() else {
            return rollback_unprepared_service_auth_transaction(
                tx,
                SnapbackError::error(
                    "SNAPBACK_SERVICE_AUTHORITY_UNAVAILABLE",
                    "auth",
                    "service-authority commit interlock is not installed",
                ),
            );
        };
        let mut prepared = match interlock.prepare_terminal(&token_ids, disposition) {
            Ok(prepared) => prepared,
            Err(error) => return rollback_unprepared_service_auth_transaction(tx, error),
        };
        let output = match operation(&tx) {
            Ok(output) => output,
            Err(error) => {
                return rollback_prepared_service_auth_transaction(tx, error, prepared);
            }
        };
        super::observe_durable_commit_for_test();
        match tx.commit() {
            Ok(()) => match prepared.committed() {
                Ok(()) => ServiceAuthTransactionAttempt::Committed(output),
                Err(error) => ServiceAuthTransactionAttempt::CommitUncertain {
                    error,
                    terminal: None,
                },
            },
            Err(error) => {
                prepared.mark_ambiguous();
                ServiceAuthTransactionAttempt::CommitUncertain {
                    error: error.into(),
                    terminal: Some(prepared),
                }
            }
        }
    }

    /// Settle the exact process ticket after an operation-specific durable
    /// reread proves the outcome of an ambiguous SQLite COMMIT. A failed or
    /// inconclusive reread deliberately leaves the ticket pending.
    pub(crate) fn reconcile_ambiguous_service_terminal(
        &self,
        prepared: Option<crate::auth::service_fence::PreparedServiceAuthorityTerminal>,
        committed: bool,
    ) -> SnapbackResult<()> {
        let Some(prepared) = prepared else {
            // Deterministic test injection can report uncertainty after a real
            // successful COMMIT; that ticket was already settled synchronously.
            return Ok(());
        };
        if committed {
            prepared.committed()
        } else {
            prepared.rolled_back();
            Ok(())
        }
    }

    /// Read the durable non-decreasing auth-clock floor. A missing key means
    /// no floor has been recorded yet and returns zero. Corrupt or
    /// out-of-range values fail closed as catalog corruption.
    ///
    /// @ref LLP 0059#durable-session-clock-floor — restart seeds the process
    /// clock floor from this value so a lower wall sample cannot revive
    /// terminal authority.
    pub fn auth_session_clock_floor(&self) -> SnapbackResult<u64> {
        self.with_auth_read(read_session_clock_floor_on)
    }

    /// Raise the durable auth-clock floor to at least `observed_ms` and return
    /// the resulting floor. The floor only ever moves forward; a lower
    /// `observed_ms` (a backward wall-clock sample) leaves the stored value
    /// unchanged and still returns the higher persisted floor.
    ///
    /// @ref LLP 0059#durable-session-clock-floor — every startup and every
    /// maintenance pass advances this monotone floor.
    pub fn advance_auth_session_clock_floor(&mut self, observed_ms: u64) -> SnapbackResult<u64> {
        if observed_ms > MAX_SAFE_TIMESTAMP_MS {
            return Err(corrupt(
                "auth session clock floor time is outside the portable timestamp range",
            ));
        }
        self.with_auth_transaction(|tx| advance_session_clock_floor_on(tx, observed_ms))
    }

    /// Delete expired durable auth state in bounded direct-path batches. The
    /// same maintenance transaction advances the durable auth-clock floor so
    /// the running process's forward progress survives restart.
    pub fn auth_gc(&mut self, now_ms: u64) -> SnapbackResult<AuthGcResult> {
        if now_ms > MAX_SAFE_TIMESTAMP_MS {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_CATALOG_CORRUPT",
                "auth",
                "auth garbage-collection time is outside the portable timestamp range",
            ));
        }
        self.with_auth_transaction(|tx| {
            // @ref LLP 0059#durable-session-clock-floor — persist the advancing
            // clock floor atomically with reclamation so a later restart cannot
            // sample below it.
            advance_session_clock_floor_on(tx, now_ms)?;
            let orphan_tombstones: i64 = tx.query_row(
                "SELECT COUNT(*)
                 FROM _auth_session_tokens AS token
                 LEFT JOIN _auth_sessions AS session ON session.id = token.session_id
                 WHERE session.id IS NULL",
                [],
                |row| row.get(0),
            )?;
            if orphan_tombstones != 0 {
                return Err(corrupt(
                    "auth catalog contains an orphan session-token tombstone",
                ));
            }

            let challenges_deleted = tx.execute(
                "DELETE FROM _auth_verification_codes
                 WHERE challenge_id IN (
                   SELECT challenge_id FROM _auth_verification_codes
                   WHERE expires_at_ms <= ?1
                   ORDER BY expires_at_ms, challenge_id
                   LIMIT ?2
                 )",
                params![now_ms as i64, AUTH_GC_BATCH as i64],
            )?;
            tx.execute(
                "DELETE FROM _snapback_meta
                 WHERE key IN (
                   SELECT ?3 || id FROM _auth_sessions
                   WHERE absolute_expires_at_ms <= ?1
                   ORDER BY absolute_expires_at_ms, id
                   LIMIT ?2
                 )",
                params![
                    now_ms as i64,
                    AUTH_GC_BATCH as i64,
                    SESSION_TERMINAL_CAUSE_META_PREFIX,
                ],
            )?;
            let sessions_deleted = tx.execute(
                "DELETE FROM _auth_sessions
                 WHERE id IN (
                   SELECT id FROM _auth_sessions
                   WHERE absolute_expires_at_ms <= ?1
                   ORDER BY absolute_expires_at_ms, id
                   LIMIT ?2
                 )",
                params![now_ms as i64, AUTH_GC_BATCH as i64],
            )?;
            Ok(AuthGcResult {
                challenges_deleted,
                sessions_deleted,
                immediate_retry: challenges_deleted == AUTH_GC_BATCH
                    || sessions_deleted == AUTH_GC_BATCH,
            })
        })
    }

    /// Prove whether a retained verification challenge still names a key.
    /// The keyring maintenance caller holds the keyring lock before crossing
    /// this read seam, preserving the global keyring-before-SQLite lock order.
    pub fn auth_key_is_referenced(&self, key_id: &str) -> SnapbackResult<bool> {
        self.with_auth_read(|conn| {
            Ok(retained_key_ids_on(conn)?
                .iter()
                .any(|retained| retained == key_id))
        })
    }

    /// Enumerate only distinct retained key references for quiesced physical
    /// backup validation. Callers must keep the values internal and redacted.
    pub fn auth_retained_key_ids(&self) -> SnapbackResult<Vec<String>> {
        self.with_auth_read(retained_key_ids_on)
    }

    /// Apply one destructive restore declaration atomically. The durable
    /// declaration marker is deliberately the final statement, so retry after
    /// an ambiguous post-commit failure is an exact idempotent no-op.
    pub fn apply_auth_restore_declaration(
        &mut self,
        declaration_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<AuthRestoreResult> {
        validate_restore_declaration(declaration_id)?;
        if now_ms > 9_007_199_254_740_991 {
            return Err(restore_invalid(
                "declared restore time is outside the portable timestamp range",
            ));
        }
        let schema = self.schema.clone();
        let authorization_interlock = self.authorization_interlock.clone();
        let commit_authority_identity = self.commit_authority_identity.clone();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_ready_on(&tx)?;
        let catalog = inspect_auth_catalog_on(&tx)?;
        let applied: Option<String> = tx
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![META_AUTH_RESTORE_DECLARATION_ID],
                |row| row.get(0),
            )
            .optional()?;
        if applied.as_deref() == Some(declaration_id) {
            tx.commit()?;
            return Ok(AuthRestoreResult::AlreadyApplied);
        }

        // A restored database may contain timestamps ahead of the current
        // host clock. Derive the destructive cut from durable authority, not
        // the raw sample, and advance the shared frontier in this transaction
        // before any session terminal state is written.
        // @ref LLP 0059#durable-session-clock-floor — restore must resume at
        // or above every restored durable auth timestamp, not merely session
        // creation time, before it writes terminal state or reseeds the floor.
        let restored_catalog_frontier = restored_auth_timestamp_frontier_on(&tx, catalog)?;
        let sampled_restore_now_ms = read_session_clock_floor_on(&tx)?.max(now_ms);
        let restore_now_ms = sampled_restore_now_ms.max(restored_catalog_frontier);
        // A future restored authority deadline can deliberately move the
        // durable clock ahead of the real elapsed time so session revocation
        // remains representable. Preserve v4's physically backed-up lockout
        // state across only that artificial jump: natural time between backup
        // and restore still ages the window normally.
        // @ref LLP 0214#21-amendment-2026-08-11-catalog-v4-and-what-the-reconciliation-actually-cost — physical backup carries the password-attempt ledger.
        rebase_password_attempts_for_restore_in(
            &tx,
            catalog,
            restore_now_ms - sampled_restore_now_ms,
        )?;
        advance_session_clock_floor_on(&tx, restore_now_ms)?;

        let sessions_revoked =
            revoke_all_sessions_in(&tx, restore_now_ms, RevocationReason::Restore)?;
        restore_transaction_step_completed(0)?;
        let challenges_deleted = tx.execute("DELETE FROM _auth_verification_codes", [])?;
        if matches!(
            catalog,
            AuthCatalogState::ReadyV2 | AuthCatalogState::ReadyV3 | AuthCatalogState::ReadyV4
        ) {
            // Restore terminates every v2 bearer and consent authority, not
            // only browser sessions. Deleting child rows before their parents
            // makes pre-backup agent credentials, scoped tokens, invitations,
            // and pairing secrets permanently non-actionable after restart.
            terminate_agent_authority_in(&tx)?;
        }
        // A destructive restore may delete the sole live credential family of
        // an unowned protected holder. Refuse that final state atomically; the
        // caller must first seat a durably recoverable replacement (or use a
        // future explicit emergency transfer/quarantine carrier).
        // @ref LLP 0055#ending-authority-revocation-expiry-deactivation
        super::auth_agents::validate_protected_membership_final_state(
            &tx,
            &schema,
            super::current_version_on(&tx)?,
        )?;
        restore_transaction_step_completed(1)?;

        // Capture the exact durable predecessor before the destructive hook
        // rotates the authorization incarnation. A COMMIT error can reopen
        // the room ticket only if this exact pair is observed again.
        let authorization_predecessor = super::auth_stream::read_authorization_version_on(&tx)?;

        // @ref LLP 0059#reset-restore-and-stream-publication — a first
        // application rotates authorization authority in this same
        // destructive transaction; an idempotent declaration returns above
        // without rotating again. The closed hook also produces the exact
        // pre-commit witness consumed by LLP 0053's room sink barrier.
        let authorization = super::authorization::authorization_commit_hook_in(
            &tx,
            super::authorization::AuthorizationCommitCause::DestructiveBoundary,
        )?;
        super::auth_invalidation::clear_retry_episodes_in(&tx)?;
        super::authorized_lease::clear_authorized_lease_reservations_in(&tx)?;
        super::auth_invalidation::rotate_data_version_stream_in(&tx)?;
        restore_transaction_step_completed(2)?;

        // @ref LLP 0057#restore — the declaration id is written last in the
        // same transaction as revocation and challenge destruction.
        tx.execute(
            "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![META_AUTH_RESTORE_DECLARATION_ID, declaration_id],
        )?;
        restore_transaction_step_completed(3)?;
        let min_commit_version = super::current_version_on(&tx)?;
        super::commit_with_authorization_interlock(
            tx,
            &authorization,
            super::AuthorizationCommitImpact::AllProtectedRooms,
            authorization_predecessor,
            min_commit_version,
            authorization_interlock,
            &commit_authority_identity,
        )?;
        Ok(AuthRestoreResult::Applied {
            sessions_revoked,
            challenges_deleted,
        })
    }

    /// Auth backup's catalog-readiness wrapper around the generic image copy.
    /// The auth unit asserts an exact recognized catalog on both sides of the
    /// copy; whole-store export shares the capture but makes no such claim,
    /// because a store with a dormant catalog is still a copyable store.
    /// @ref LLP 0192#d-2-the-store-export-verb — the shared capture is
    /// catalog-agnostic; only this wrapper adds the auth-unit proof.
    pub fn backup_auth_catalog_into(&self, image: &File) -> SnapbackResult<()> {
        require_ready_on(&self.conn)?;
        self.backup_database_image_into(image)?;
        // Prove the normalized image reopens standalone and still carries an
        // exact recognized catalog, again without touching any pathname.
        let check = open_backup_image_connection(image, true)?;
        if !inspect_auth_catalog_on(&check)?.is_ready() {
            return Err(backup_invalid(
                "backup database image is not an exact recognized auth catalog",
            ));
        }
        Ok(())
    }

    #[cfg(any(test, feature = "test-support"))]
    fn backup_auth_catalog_after_forced_initialization_failure(
        &self,
        image: &File,
    ) -> SnapbackResult<()> {
        require_ready_on(&self.conn)?;
        self.backup_database_image_into_inner(image, true)?;
        let check = open_backup_image_connection(image, true)?;
        if !inspect_auth_catalog_on(&check)?.is_ready() {
            return Err(backup_invalid(
                "backup database image is not an exact recognized auth catalog",
            ));
        }
        Ok(())
    }

    /// Produce a complete database image with SQLite's online-backup API into
    /// a caller-created staging descriptor. The caller owns the exclusive
    /// maintenance boundary, the retained keyring bytes, and the pinned
    /// staging identities; SQLite binds to the exact descriptor-created inode
    /// and never reopens the staging pathname. SQLite builds the snapshot in
    /// a private memory database and serialization writes it only through the
    /// retained staging descriptor, so a swapped or symlinked path can never
    /// receive source pages.
    ///
    /// @ref LLP 0057#consistent-backup — the staged image stays the exact
    /// secure unit created by the command; no page is copied through a
    /// pathname an attacker could redirect.
    pub fn backup_database_image_into(&self, image: &File) -> SnapbackResult<()> {
        self.backup_database_image_into_inner(image, false)
    }

    fn backup_database_image_into_inner(
        &self,
        image: &File,
        mut force_first_initialization_failure: bool,
    ) -> SnapbackResult<()> {
        // Derive the export scrub from physical custody, not the in-memory
        // manifest projection. A crashed or tampered schema transition must
        // fail toward removing a protected table, never toward exporting it.
        let scrub_push_registry: bool = self.conn.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM sqlite_schema
               WHERE type = 'table' AND name = '_snapback_push_tokens_v1'
             )",
            [],
            |row| row.get(0),
        )?;
        // The copy journals in private memory: no `-journal`/`-wal` sidecar is
        // ever created or read, which removes the hot-journal/WAL injection
        // surface a swapped staging directory would otherwise offer. A failed
        // copy never writes the staged inode; artifact durability comes from
        // the explicit descriptor fsync and publication rename.
        //
        // `sqlite3_backup_init` can exceptionally return NULL while leaving
        // only the destination connection's stale "not an error" state. That
        // was observed after earlier suite operations even though the exact
        // same backup passed in isolation. No page has moved when init fails,
        // so discard it and make one bounded attempt from a fresh private
        // connection. Step/copy failures are never retried.
        let source_page_size: i64 = self
            .conn
            .query_row("PRAGMA page_size", [], |row| row.get(0))?;
        let mut copied = None;
        for initialization_attempt in 0..2 {
            // macOS exposes a retained file as `/dev/fd/N`, but SQLite opens
            // that alias read-only for pager writes. Copy into a private
            // memory database first, then serialize its completed snapshot
            // directly to the caller's pinned descriptor. No replaceable
            // pathname ever receives a source page.
            let mut output = Connection::open_in_memory()?;
            output.pragma_update(None, "page_size", source_page_size)?;
            let journal_mode: String =
                output.query_row("PRAGMA journal_mode = MEMORY", [], |row| row.get(0))?;
            if !journal_mode.eq_ignore_ascii_case("memory") {
                return Err(backup_invalid(
                    "backup database image could not be made self-contained",
                ));
            }
            if force_first_initialization_failure {
                force_first_initialization_failure = false;
                continue;
            }

            match copy_backup_pages(&self.conn, &mut output) {
                Ok(()) => {
                    copied = Some(output);
                    break;
                }
                Err(BackupCopyFailure::Initialization(_error)) if initialization_attempt == 0 => {
                    // No page has moved; discard the private destination and
                    // make one bounded initialization attempt from a fresh DB.
                }
                Err(BackupCopyFailure::Initialization(error))
                | Err(BackupCopyFailure::Copy(error)) => return Err(error.into()),
                Err(BackupCopyFailure::Incomplete) => {
                    return Err(backup_invalid(
                        "backup database image copy did not complete",
                    ));
                }
            }
        }
        let output = copied.ok_or_else(|| {
            backup_invalid("backup database image initialization did not complete")
        })?;
        // @ref LLP 0143#d1-device-token-custody — auth backup is an export
        // surface; the staged copy retains registry schema but never custody
        // rows or provider token bytes. Sanitize the completed private copy
        // before any bytes reach the staged descriptor.
        if scrub_push_registry {
            let journal_mode: String =
                output.query_row("PRAGMA journal_mode = MEMORY", [], |row| row.get(0))?;
            if !journal_mode.eq_ignore_ascii_case("memory") {
                return Err(backup_invalid(
                    "backup database image could not be made self-contained",
                ));
            }
            // A logical DELETE is not an export boundary: ordinary SQLite
            // deletion can leave the token payload recoverable in free cells
            // or freelist pages. Require physical overwrite semantics on the
            // descriptor-bound staged image before removing custody rows.
            output.execute_batch("PRAGMA secure_delete = ON;")?;
            let secure_delete: i64 =
                output.query_row("PRAGMA secure_delete", [], |row| row.get(0))?;
            if secure_delete != 1 {
                return Err(backup_invalid(
                    "backup database could not enable secure token deletion",
                ));
            }
            for table in [
                "_snapback_push_messages_v1",
                "_snapback_push_batches_v1",
                "_snapback_push_intents_v1",
                "_snapback_push_tokens_v1",
            ] {
                let exists: bool = output.query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)",
                    params![table],
                    |row| row.get(0),
                )?;
                if exists {
                    output.execute(&format!("DELETE FROM {table}"), [])?;
                }
            }
        }
        let serialized = output.serialize(DatabaseName::Main)?;
        let header_versions = serialized.get(18..20).ok_or_else(|| {
            backup_invalid("backup database image could not be made self-contained")
        })?;
        if !matches!(header_versions, [1, 1] | [2, 2]) {
            return Err(backup_invalid(
                "backup database image could not be made self-contained",
            ));
        }
        use std::io::{Seek as _, Write as _};
        let mut image_writer = image
            .try_clone()
            .map_err(|_| backup_invalid("backup database descriptor could not be retained"))?;
        image_writer
            .set_len(0)
            .and_then(|_| image_writer.seek(std::io::SeekFrom::Start(0)).map(|_| ()))
            .and_then(|_| {
                image_writer.write_all(&serialized[..18])?;
                image_writer.write_all(&[1, 1])?;
                image_writer.write_all(&serialized[20..])
            })
            .and_then(|_| image_writer.sync_all())
            .map_err(|_| backup_invalid("could not write the backup database image"))?;
        // Prove the normalized image reopens standalone and reads its own
        // schema, again without touching any pathname. Catalog-shape claims
        // belong to the callers that actually make them.
        let check = open_backup_image_connection(image, true)?;
        check.query_row("SELECT COUNT(*) FROM sqlite_schema", [], |row| {
            row.get::<_, i64>(0)
        })?;
        Ok(())
    }

    /// Inspect a physical backup image without configuring SQLite, opening a
    /// WAL writer, or otherwise mutating the candidate artifact.
    pub fn inspect_auth_catalog_file_read_only(path: &Path) -> SnapbackResult<AuthCatalogState> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        inspect_auth_catalog_on(&conn)
    }

    /// Inspect the exact already-open restore image. The pathname in the
    /// staging directory is never reopened, so a concurrent entry swap cannot
    /// redirect catalog authority validation.
    pub fn inspect_auth_catalog_descriptor_read_only(
        image: &File,
    ) -> SnapbackResult<AuthCatalogState> {
        let conn = open_backup_image_connection(image, true)?;
        inspect_auth_catalog_on(&conn)
    }

    pub fn auth_password_identifier_mode_descriptor_read_only(
        image: &File,
    ) -> SnapbackResult<PasswordIdentifierMode> {
        let conn = open_backup_image_connection(image, true)?;
        require_password_identifier_mode_on(&conn)
    }

    pub fn auth_retained_key_ids_file_read_only(path: &Path) -> SnapbackResult<Vec<String>> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        require_ready_on(&conn)?;
        retained_key_ids_on(&conn)
    }

    pub fn auth_retained_key_ids_descriptor_read_only(image: &File) -> SnapbackResult<Vec<String>> {
        let conn = open_backup_image_connection(image, true)?;
        require_ready_on(&conn)?;
        retained_key_ids_on(&conn)
    }
}

/// A failed operation is not a proven rollback until SQLite confirms the
/// rollback. `Transaction::drop` intentionally ignores rollback failures, so
/// relying on drop could exact-unmark a projection ticket while the durable
/// outcome remained uncertain.
///
/// @ref LLP 0059#rollback-and-ambiguous-commit — exact compare-unmark requires
/// a known rollback or an exact durable predecessor proof.
fn rollback_auth_transaction<T>(
    tx: Transaction<'_>,
    operation_error: SnapbackError,
) -> AuthTransactionAttempt<T> {
    match tx.rollback() {
        Ok(()) => AuthTransactionAttempt::RolledBack(operation_error),
        Err(error) => AuthTransactionAttempt::CommitUncertain(
            SnapbackError::error(
                "SNAPBACK_AUTH_REVOCATION_UNCERTAIN",
                "auth",
                "authentication transaction rollback could not be proven",
            )
            .with_details(json!({ "sqlite": error.to_string() })),
        ),
    }
}

fn rollback_unprepared_service_auth_transaction<T>(
    tx: Transaction<'_>,
    operation_error: SnapbackError,
) -> ServiceAuthTransactionAttempt<T> {
    match rollback_auth_transaction::<T>(tx, operation_error) {
        AuthTransactionAttempt::RolledBack(error) => {
            ServiceAuthTransactionAttempt::RolledBack(error)
        }
        AuthTransactionAttempt::CommitUncertain(error) => {
            ServiceAuthTransactionAttempt::CommitUncertain {
                error,
                terminal: None,
            }
        }
        AuthTransactionAttempt::Committed(_) => unreachable!("rollback cannot report a commit"),
    }
}

fn rollback_prepared_service_auth_transaction<T>(
    tx: Transaction<'_>,
    operation_error: SnapbackError,
    mut prepared: crate::auth::service_fence::PreparedServiceAuthorityTerminal,
) -> ServiceAuthTransactionAttempt<T> {
    let rollback = tx.rollback();
    #[cfg(any(test, feature = "test-support"))]
    let rollback = if take_service_rollback_uncertainty_for_test() && rollback.is_ok() {
        Err(rusqlite::Error::ExecuteReturnedResults)
    } else {
        rollback
    };
    match rollback {
        Ok(()) => {
            prepared.rolled_back();
            ServiceAuthTransactionAttempt::RolledBack(operation_error)
        }
        Err(error) => {
            prepared.mark_ambiguous();
            ServiceAuthTransactionAttempt::CommitUncertain {
                error: SnapbackError::error(
                    "SNAPBACK_AUTH_REVOCATION_UNCERTAIN",
                    "auth",
                    "service-authority transaction rollback could not be proven",
                )
                .with_details(json!({ "sqlite": error.to_string() })),
                terminal: Some(prepared),
            }
        }
    }
}

/// Open a SQLite connection bound to the exact open descriptor rather than a
/// pathname. The kernel resolves `/dev/fd` (macOS) and `/proc/self/fd`
/// (Linux) to the descriptor's inode, so no rename or symlink in the staging
/// parent can redirect where SQLite reads or writes.
#[cfg(any(target_vendor = "apple", target_os = "linux"))]
fn open_backup_image_connection(image: &File, read_only: bool) -> SnapbackResult<Connection> {
    use std::os::fd::AsRawFd as _;

    #[cfg(target_vendor = "apple")]
    let path = format!("/dev/fd/{}", image.as_raw_fd());
    #[cfg(target_os = "linux")]
    let path = format!("/proc/self/fd/{}", image.as_raw_fd());
    let flags = if read_only {
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX
    } else {
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX
    };
    Ok(Connection::open_with_flags(path, flags)?)
}

#[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
fn open_backup_image_connection(_image: &File, _read_only: bool) -> SnapbackResult<Connection> {
    Err(backup_invalid(
        "descriptor-bound backup images are unsupported on this host",
    ))
}

enum BackupCopyFailure {
    Initialization(rusqlite::Error),
    Copy(rusqlite::Error),
    Incomplete,
}

fn copy_backup_pages(
    source: &Connection,
    destination: &mut Connection,
) -> Result<(), BackupCopyFailure> {
    let backup = rusqlite::backup::Backup::new(source, destination)
        .map_err(BackupCopyFailure::Initialization)?;
    match backup.step(-1).map_err(BackupCopyFailure::Copy)? {
        rusqlite::backup::StepResult::Done => Ok(()),
        rusqlite::backup::StepResult::More
        | rusqlite::backup::StepResult::Busy
        | rusqlite::backup::StepResult::Locked => Err(BackupCopyFailure::Incomplete),
        _ => Err(BackupCopyFailure::Incomplete),
    }
}

/// Install the current catalog inside a caller-owned transaction. The caller
/// has already established usable keyring state; this seam lets LLP 0058 commit
/// catalog activation together with manifest relocation and mode settlement.
pub(super) fn activate_current_auth_catalog_in(tx: &Transaction<'_>) -> SnapbackResult<()> {
    match inspect_auth_catalog_on(tx)? {
        AuthCatalogState::ReadyV1
        | AuthCatalogState::ReadyV2
        | AuthCatalogState::ReadyV3
        | AuthCatalogState::ReadyV4 => {
            return Ok(());
        }
        AuthCatalogState::Uninitialized => {}
    }

    activate_current_auth_catalog_with_password_identifier_mode_in(
        tx,
        PasswordIdentifierMode::UsernameV1,
    )
}

pub(super) fn activate_current_auth_catalog_with_password_identifier_mode_in(
    tx: &Transaction<'_>,
    mode: PasswordIdentifierMode,
) -> SnapbackResult<()> {
    match inspect_auth_catalog_on(tx)? {
        AuthCatalogState::ReadyV4 => {
            if read_password_identifier_mode_on(tx)? == mode {
                return Ok(());
            }
            return Err(password_identifier_mode_immutable());
        }
        AuthCatalogState::ReadyV1 | AuthCatalogState::ReadyV2 | AuthCatalogState::ReadyV3 => {
            return Err(password_requires_v4());
        }
        AuthCatalogState::Uninitialized => {}
    }

    let mut activation_step = 0;
    for table in catalog_tables(CURRENT_CATALOG) {
        tx.execute_batch(table.sql)?;
        activation_step_completed(activation_step)?;
        activation_step += 1;
    }
    for index in catalog_indexes(CURRENT_CATALOG) {
        tx.execute_batch(index.sql)?;
        activation_step_completed(activation_step)?;
        activation_step += 1;
    }
    tx.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)",
        params![META_AUTH_PASSWORD_IDENTIFIER_MODE, mode.as_str()],
    )?;
    activation_step_completed(activation_step)?;
    activation_step += 1;
    // The version marker remains the final catalog statement. The immutable
    // identifier declaration is already durable in the same transaction.
    tx.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)",
        params![META_AUTH_CATALOG_VERSION, AUTH_CATALOG_VERSION],
    )?;
    activation_step_completed(activation_step)?;
    require_ready_on(tx)
}

pub(super) fn require_password_identifier_mode_declaration_on(
    connection: &Connection,
    mode: PasswordIdentifierMode,
    explicitly_declared: bool,
) -> SnapbackResult<()> {
    match inspect_auth_catalog_on(connection)? {
        AuthCatalogState::ReadyV4 if explicitly_declared => {
            if read_password_identifier_mode_on(connection)? == mode {
                Ok(())
            } else {
                Err(password_identifier_mode_immutable())
            }
        }
        AuthCatalogState::ReadyV4 => Ok(()),
        AuthCatalogState::ReadyV1 | AuthCatalogState::ReadyV2 | AuthCatalogState::ReadyV3
            if explicitly_declared =>
        {
            Err(password_requires_v4())
        }
        AuthCatalogState::ReadyV1
        | AuthCatalogState::ReadyV2
        | AuthCatalogState::ReadyV3
        | AuthCatalogState::Uninitialized => Ok(()),
    }
}

/// Install the exact frozen version-1 catalog for compatibility fixtures.
/// Production activation must always use [`activate_current_auth_catalog_in`]
/// and therefore create the current version instead.
///
/// @ref LLP 0057#catalog-version-1 — version 1 is recognition-only test input,
/// never a fresh production activation target.
#[cfg(any(test, feature = "test-support"))]
pub fn install_frozen_v1_catalog_fixture(database: &mut LocalDatabase) -> SnapbackResult<()> {
    if database.inspect_auth_catalog()? != AuthCatalogState::Uninitialized {
        return Err(corrupt(
            "frozen-v1 fixture requires an uninitialized auth catalog",
        ));
    }
    let tx = database
        .conn
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    for table in catalog_tables(&CATALOG_V1) {
        tx.execute_batch(table.sql)?;
    }
    for index in catalog_indexes(&CATALOG_V1) {
        tx.execute_batch(index.sql)?;
    }
    tx.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)",
        params![META_AUTH_CATALOG_VERSION, AUTH_CATALOG_VERSION_V1],
    )?;
    require_ready_on(&tx)?;
    tx.commit()?;
    Ok(())
}

impl super::ServingDatabase {
    #[cfg(any(test, feature = "test-support"))]
    pub fn install_frozen_v1_catalog_fixture(&mut self) -> SnapbackResult<()> {
        install_frozen_v1_catalog_fixture(&mut self.db)
    }
}

/// Install the exact frozen version-2 catalog for recognition/no-migration
/// compatibility tests. Production activation never targets this descriptor.
#[cfg(any(test, feature = "test-support"))]
pub fn install_frozen_v2_catalog_fixture(database: &mut LocalDatabase) -> SnapbackResult<()> {
    if database.inspect_auth_catalog()? != AuthCatalogState::Uninitialized {
        return Err(corrupt(
            "frozen-v2 fixture requires an uninitialized auth catalog",
        ));
    }
    let tx = database
        .conn
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    for table in catalog_tables(&CATALOG_V2) {
        tx.execute_batch(table.sql)?;
    }
    for index in catalog_indexes(&CATALOG_V2) {
        tx.execute_batch(index.sql)?;
    }
    tx.execute(
        "INSERT INTO _snapback_meta(key,value) VALUES(?1,?2)",
        params![META_AUTH_CATALOG_VERSION, AUTH_CATALOG_VERSION_V2],
    )?;
    require_ready_on(&tx)?;
    tx.commit()?;
    Ok(())
}

/// Install the exact shipped version-3 catalog for no-silent-migration and
/// older-binary recognition fixtures. It deliberately has no identifier-mode
/// metadata because that declaration first exists in version 4.
#[cfg(any(test, feature = "test-support"))]
pub fn install_frozen_v3_catalog_fixture(database: &mut LocalDatabase) -> SnapbackResult<()> {
    if database.inspect_auth_catalog()? != AuthCatalogState::Uninitialized {
        return Err(corrupt(
            "frozen-v3 fixture requires an uninitialized auth catalog",
        ));
    }
    let tx = database
        .conn
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    for table in catalog_tables(&CATALOG_V3) {
        tx.execute_batch(table.sql)?;
    }
    for index in catalog_indexes(&CATALOG_V3) {
        tx.execute_batch(index.sql)?;
    }
    tx.execute(
        "INSERT INTO _snapback_meta(key,value) VALUES(?1,?2)",
        params![META_AUTH_CATALOG_VERSION, AUTH_CATALOG_VERSION_V3],
    )?;
    require_ready_on(&tx)?;
    tx.commit()?;
    Ok(())
}

/// Revoke every still-live session inside a caller-owned downgrade
/// transaction. This matches declared-restore generation semantics without
/// creating a restore marker or deleting identity rows.
pub(super) fn revoke_all_sessions_in(
    tx: &Transaction<'_>,
    now_ms: u64,
    reason: RevocationReason,
) -> SnapbackResult<usize> {
    require_ready_on(tx)?;
    let exhausted: i64 = tx.query_row(
        "SELECT COUNT(*) FROM _auth_sessions
         WHERE revoked_at_ms IS NULL AND generation >= 9007199254740991",
        [],
        |row| row.get(0),
    )?;
    if exhausted != 0 {
        return Err(corrupt(
            "auth catalog contains an unrevoked session with an exhausted generation",
        ));
    }
    let mut statement = tx.prepare(
        "SELECT id, generation FROM _auth_sessions
         WHERE revoked_at_ms IS NULL ORDER BY id",
    )?;
    let sessions = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    for (session_id, generation) in &sessions {
        let successor_generation = u64::try_from(*generation)
            .ok()
            .and_then(|generation| generation.checked_add(1))
            .filter(|generation| *generation <= MAX_SAFE_TIMESTAMP_MS)
            .ok_or_else(|| corrupt("auth catalog contains a session with an invalid generation"))?;
        write_session_terminal_cause_in(tx, session_id, successor_generation, now_ms, reason)?;
    }
    let changed = tx.execute(
        "UPDATE _auth_sessions
         SET revoked_at_ms = ?1, generation = generation + 1
         WHERE revoked_at_ms IS NULL",
        params![now_ms as i64],
    )?;
    if changed != sessions.len() {
        return Err(corrupt(
            "bulk session revocation did not match its terminal-cause witnesses",
        ));
    }
    Ok(changed)
}

fn retained_key_ids_on(conn: &Connection) -> SnapbackResult<Vec<String>> {
    let catalog = inspect_auth_catalog_on(conn)?;
    let sql = match catalog {
        AuthCatalogState::ReadyV3 | AuthCatalogState::ReadyV4 => {
            // Recovery-code digests are keyed durable credential state. A
            // backup or rotation that inventories only email challenges can
            // strand those digests from the exact keyring bytes they require.
            // @ref LLP 0214#39-recovery-code-state — every stored recovery-code
            // digest retains its key id in the protected catalog.
            "SELECT key_id FROM _auth_verification_codes
             UNION
             SELECT key_id FROM _auth_recovery_codes
             ORDER BY key_id"
        }
        AuthCatalogState::ReadyV1 | AuthCatalogState::ReadyV2 => {
            "SELECT DISTINCT key_id FROM _auth_verification_codes ORDER BY key_id"
        }
        AuthCatalogState::Uninitialized => {
            return Err(corrupt("auth catalog is not initialized"));
        }
    };
    let mut statement = conn.prepare(sql)?;
    Ok(statement
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?)
}

fn validate_restore_declaration(declaration_id: &str) -> SnapbackResult<()> {
    if crate::ids::is_minted_identifier(declaration_id) {
        return Ok(());
    }
    Err(restore_invalid(
        "restore declaration id is not a Snapback identifier",
    ))
}

fn backup_invalid(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_BACKUP_INVALID", "auth-backup", message)
}

fn restore_invalid(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_BACKUP_INVALID", "auth-restore", message)
}

/// Return the maximum timestamp committed anywhere in a recognized auth
/// catalog. Keep this inventory explicit: schema recognition pins the columns,
/// and restore must fail closed if a restored value escapes the portable
/// nonnegative timestamp domain.
fn restored_auth_timestamp_frontier_on(
    conn: &Connection,
    catalog: AuthCatalogState,
) -> SnapbackResult<u64> {
    const V1_COLUMNS: &[(&str, &str)] = &[
        ("_auth_users", "created_at_ms"),
        ("_auth_identities", "verified_at_ms"),
        ("_auth_sessions", "created_at_ms"),
        ("_auth_sessions", "last_used_at_ms"),
        ("_auth_sessions", "expires_at_ms"),
        ("_auth_sessions", "absolute_expires_at_ms"),
        ("_auth_sessions", "revoked_at_ms"),
        ("_auth_session_tokens", "superseded_at_ms"),
        ("_auth_verification_codes", "requested_at_ms"),
        ("_auth_verification_codes", "expires_at_ms"),
        ("_auth_verification_codes", "consumed_at_ms"),
    ];
    const V2_COLUMNS: &[(&str, &str)] = &[
        ("_auth_users", "deactivated_at_ms"),
        ("_auth_agent_credentials", "created_at_ms"),
        ("_auth_agent_credentials", "rotated_at_ms"),
        ("_auth_agent_credentials", "last_used_at_ms"),
        ("_auth_agent_credentials", "revoked_at_ms"),
        ("_auth_grants", "created_at_ms"),
        ("_auth_grants", "expires_at_ms"),
        ("_auth_grants", "revoked_at_ms"),
        ("_auth_grants", "last_used_at_ms"),
        ("_auth_grant_tokens", "created_at_ms"),
        ("_auth_grant_tokens", "expires_at_ms"),
        ("_auth_grant_tokens", "revoked_at_ms"),
        ("_auth_agent_invitations", "created_at_ms"),
        ("_auth_agent_invitations", "expires_at_ms"),
        ("_auth_agent_invitations", "revoked_at_ms"),
        ("_auth_agent_invitations", "consumed_at_ms"),
        ("_auth_pairing_requests", "created_at_ms"),
        ("_auth_pairing_requests", "expires_at_ms"),
        ("_auth_pairing_requests", "consumed_at_ms"),
    ];
    const V3_COLUMNS: &[(&str, &str)] = &[
        ("_auth_users", "guest_expires_at_ms"),
        ("_auth_users", "guest_claimed_at_ms"),
        ("_auth_identities", "created_at_ms"),
        ("_auth_identities", "disabled_at_ms"),
        ("_auth_credentials", "created_at_ms"),
        ("_auth_credentials", "last_used_at_ms"),
        ("_auth_credentials", "revoked_at_ms"),
        ("_auth_password_credentials", "changed_at_ms"),
        ("_auth_recovery_code_sets", "issued_at_ms"),
        ("_auth_recovery_code_sets", "replaced_at_ms"),
        ("_auth_recovery_codes", "consumed_at_ms"),
        ("_auth_assurances", "issued_at_ms"),
        ("_auth_assurances", "expires_at_ms"),
        ("_auth_assurances", "revoked_at_ms"),
        ("_auth_provisioning_receipts", "committed_at_ms"),
        ("_auth_security_events", "occurred_at_ms"),
    ];
    const V4_COLUMNS: &[(&str, &str)] = &[
        ("_auth_password_attempts", "window_start_ms"),
        ("_auth_password_attempts", "locked_until_ms"),
    ];

    let mut frontier = 0;
    let columns = V1_COLUMNS
        .iter()
        .copied()
        .chain(
            matches!(
                catalog,
                AuthCatalogState::ReadyV2 | AuthCatalogState::ReadyV3 | AuthCatalogState::ReadyV4
            )
            .then_some(V2_COLUMNS)
            .into_iter()
            .flatten()
            .copied(),
        )
        .chain(
            matches!(
                catalog,
                AuthCatalogState::ReadyV3 | AuthCatalogState::ReadyV4
            )
            .then_some(V3_COLUMNS)
            .into_iter()
            .flatten()
            .copied(),
        )
        .chain(
            (catalog == AuthCatalogState::ReadyV4)
                .then_some(V4_COLUMNS)
                .into_iter()
                .flatten()
                .copied(),
        );
    for (table, column) in columns {
        // SQLite's dynamic typing means MAX alone is not a validator: a
        // positive integer can sort above a negative corrupt value, and a
        // restored database may have been produced with CHECK constraints
        // ignored. Inspect every non-NULL cell before deriving the aggregate.
        let invalid_sql = format!(
            "SELECT EXISTS(
               SELECT 1 FROM \"{table}\"
               WHERE \"{column}\" IS NOT NULL
                 AND (
                   typeof(\"{column}\") <> 'integer'
                   OR \"{column}\" NOT BETWEEN 0 AND {MAX_SAFE_TIMESTAMP_MS}
                 )
             )"
        );
        let invalid: i64 = conn.query_row(&invalid_sql, [], |row| row.get(0))?;
        if invalid != 0 {
            return Err(corrupt(
                "auth catalog contains a non-integer or out-of-range durable timestamp",
            ));
        }
        let sql = format!("SELECT MAX(\"{column}\") FROM \"{table}\"");
        let value: Option<i64> = conn.query_row(&sql, [], |row| row.get(0))?;
        if let Some(value) = value {
            let value = u64::try_from(value)
                .map_err(|_| corrupt("auth catalog contains a negative durable timestamp"))?;
            if value > MAX_SAFE_TIMESTAMP_MS {
                return Err(corrupt(
                    "auth catalog contains a timestamp outside the portable range",
                ));
            }
            frontier = frontier.max(value);
        }
    }
    Ok(frontier)
}

fn rebase_password_attempts_for_restore_in(
    tx: &Transaction<'_>,
    catalog: AuthCatalogState,
    artificial_clock_advance_ms: u64,
) -> SnapbackResult<()> {
    if catalog != AuthCatalogState::ReadyV4 || artificial_clock_advance_ms == 0 {
        return Ok(());
    }
    let maximum_predecessor = MAX_SAFE_TIMESTAMP_MS - artificial_clock_advance_ms;
    let would_overflow: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM _auth_password_attempts
           WHERE window_start_ms > ?1
              OR (locked_until_ms IS NOT NULL AND locked_until_ms > ?1)
         )",
        params![maximum_predecessor as i64],
        |row| row.get(0),
    )?;
    if would_overflow {
        return Err(corrupt(
            "restored password-attempt time cannot be rebased within the portable range",
        ));
    }
    tx.execute(
        "UPDATE _auth_password_attempts
         SET window_start_ms = window_start_ms + ?1,
             locked_until_ms = CASE
               WHEN locked_until_ms IS NULL THEN NULL
               ELSE locked_until_ms + ?1
             END",
        params![artificial_clock_advance_ms as i64],
    )?;
    Ok(())
}

/// Terminate bearer and pending-consent authority without deleting agent
/// principals or the never-GC'd scope-basis tombstones.
///
/// @ref LLP 0055#companion-obligations — sessions-to-dev downgrade and
/// declared restore must not allow pre-transition agent authority to revive.
pub(super) fn terminate_agent_authority_in(tx: &Transaction<'_>) -> SnapbackResult<()> {
    for table in [
        "_auth_grant_tokens",
        "_auth_pairing_requests",
        "_auth_grants",
        "_auth_agent_invitations",
        "_auth_agent_credentials",
    ] {
        tx.execute(&format!("DELETE FROM \"{table}\""), [])?;
    }
    Ok(())
}

/// Reset helper called from the ordinary app-reset transaction. A dormant
/// unmarked collision is not auth-owned and is deliberately left untouched.
///
/// @ref LLP 0055#catalog-and-lifecycle — `app.reset` wipes agents, grants,
///   credentials, tokens, invitations, and pairing requests with the rest. The
///   `_auth_scope_bases` tombstone is cleared too: a reset app has no functions
///   or consent for a stale basis to revive against.
pub(super) fn reset_auth_catalog_in(tx: &Transaction<'_>) -> SnapbackResult<()> {
    let Some(marker) = auth_catalog_marker(tx)? else {
        return Ok(());
    };
    require_ready_on(tx)?;
    super::auth_rehearsal::terminalize_rehearsal_authority_for_reset_in(tx)?;
    tx.execute(
        "DELETE FROM _snapback_meta WHERE substr(key, 1, ?1) = ?2",
        params![
            SESSION_TERMINAL_CAUSE_META_PREFIX.len() as i64,
            SESSION_TERMINAL_CAUSE_META_PREFIX,
        ],
    )?;
    // Agent tables exist only from version 2 onward; clear them first (children
    // before the `_auth_users` parent they reference).
    if matches!(
        marker.as_str(),
        AUTH_CATALOG_VERSION_V2 | AUTH_CATALOG_VERSION_V3 | AUTH_CATALOG_VERSION
    ) {
        for table in [
            "_auth_grant_tokens",
            "_auth_pairing_requests",
            "_auth_grants",
            "_auth_agent_invitations",
            "_auth_agent_credentials",
            "_auth_scope_bases",
        ] {
            tx.execute(&format!("DELETE FROM \"{table}\""), [])?;
        }
    }
    if marker == CATALOG_V3.version || marker == CATALOG_V4.version {
        if marker == CATALOG_V4.version {
            tx.execute("DELETE FROM _auth_password_attempts", [])?;
        }
        // @ref LLP 0214#315-activation-reset-backup-and-export — v3 identity-core
        // children are erased before sessions, identities, and principals;
        // DDL and the version marker survive reset.
        for table in [
            "_auth_security_events",
            "_auth_provisioning_receipts",
            "_auth_assurances",
            "_auth_recovery_codes",
            "_auth_recovery_code_sets",
            "_auth_passkey_credentials",
            "_auth_password_credentials",
        ] {
            tx.execute(&format!("DELETE FROM \"{table}\""), [])?;
        }
        for table in [
            "_auth_verification_codes",
            "_auth_session_tokens",
            "_auth_sessions",
            "_auth_credentials",
            "_auth_identities",
            "_auth_users",
        ] {
            tx.execute(&format!("DELETE FROM \"{table}\""), [])?;
        }
        return Ok(());
    }
    for table in [
        "_auth_verification_codes",
        "_auth_session_tokens",
        "_auth_sessions",
        "_auth_identities",
        "_auth_users",
    ] {
        tx.execute(&format!("DELETE FROM \"{table}\""), [])?;
    }
    Ok(())
}

pub(super) fn inspect_auth_catalog_on(conn: &Connection) -> SnapbackResult<AuthCatalogState> {
    let objects = schema_objects(conn)?;
    let marker = auth_catalog_marker_from_objects(conn, &objects)?;
    match marker.as_deref() {
        Some(version) if version == CATALOG_V4.version => {
            validate_exact(conn, &objects, &CATALOG_V4)?;
            read_password_identifier_mode_on(conn)?;
            Ok(AuthCatalogState::ReadyV4)
        }
        Some(version) if version == CATALOG_V3.version => {
            validate_exact(conn, &objects, &CATALOG_V3)?;
            Ok(AuthCatalogState::ReadyV3)
        }
        // The current version this binary creates and treats as agent-capable.
        Some(version) if version == CATALOG_V2.version => {
            validate_exact(conn, &objects, &CATALOG_V2)?;
            Ok(AuthCatalogState::ReadyV2)
        }
        // A recognized legacy catalog: sessions resolve, agents are unavailable
        // until a first-class v1→v2 migration lands.
        Some(version) if version == CATALOG_V1.version => {
            validate_exact(conn, &objects, &CATALOG_V1)?;
            Ok(AuthCatalogState::ReadyV1)
        }
        // @ref LLP 0055#catalog-and-lifecycle — refuse-at-open: any marker above
        //   this binary's understanding fails closed rather than reopening the
        //   database "without agents" and silently stranding live grants. This is
        //   the same wall that makes an older (v1-only) binary reject a v2 marker.
        Some(version) => Err(SnapbackError::error(
            "SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED",
            "auth",
            "auth catalog marker names an unsupported version",
        )
        .with_details(json!({ "catalogVersion": version }))),
        None => {
            if let Some(object) = objects
                .iter()
                .find(|object| object.kind == "table" && is_auth_reserved_identifier(&object.name))
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_TABLE_COLLISION",
                    "auth",
                    "an unowned physical table uses the protected auth namespace",
                )
                .with_details(json!({ "objectKind": "table", "objectName": object.name })));
            }
            if let Some(object) = objects.iter().find(|object| {
                catalog_indexes(CURRENT_CATALOG)
                    .any(|index| index.name.eq_ignore_ascii_case(&object.name))
            }) {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION",
                    "auth",
                    "an exact auth-catalog object name is already foreign-owned",
                )
                .with_details(json!({
                    "objectKind": object.kind,
                    "objectName": object.name,
                    "owningTable": object.table,
                })));
            }
            Ok(AuthCatalogState::Uninitialized)
        }
    }
}

/// Rescue is intentionally limited to table collisions. An exact v1 global
/// object name remains an offline-repair condition even when an unrelated
/// table collision would otherwise be copyable.
pub(super) fn reject_exact_auth_catalog_object_collision(conn: &Connection) -> SnapbackResult<()> {
    if let Some(object) = schema_objects(conn)?.into_iter().find(|object| {
        catalog_indexes(CURRENT_CATALOG).any(|index| index.name.eq_ignore_ascii_case(&object.name))
    }) {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION",
            "auth",
            "an exact auth-catalog object name is already foreign-owned",
        )
        .with_details(json!({
            "objectKind": object.kind,
            "objectName": object.name,
            "owningTable": object.table,
        })));
    }
    Ok(())
}

fn require_ready_on(conn: &Connection) -> SnapbackResult<()> {
    if inspect_auth_catalog_on(conn)?.is_ready() {
        Ok(())
    } else {
        Err(corrupt("auth catalog is not initialized"))
    }
}

/// Identity-core writes are intentionally unavailable on exact predecessor
/// catalogs. Recognition never doubles as migration.
///
/// @ref LLP 0214#31-version-policy — v1/v2 keep their existing behavior and every
/// v3-only surface refuses with the shared typed compatibility diagnostic.
pub(super) fn require_identity_core_v3_on(conn: &Connection) -> SnapbackResult<()> {
    match inspect_auth_catalog_on(conn)? {
        AuthCatalogState::ReadyV3 | AuthCatalogState::ReadyV4 => Ok(()),
        AuthCatalogState::ReadyV1 | AuthCatalogState::ReadyV2 => Err(SnapbackError::error(
            "SNAPBACK_AUTH_IDENTITY_CORE_REQUIRES_V3",
            "auth",
            "identity-core operations require auth catalog version 3",
        )),
        AuthCatalogState::Uninitialized => Err(corrupt("auth catalog is not initialized")),
    }
}

fn validate_exact(
    conn: &Connection,
    objects: &[SchemaObject],
    schema: &'static CatalogSchema,
) -> SnapbackResult<()> {
    let by_name = objects
        .iter()
        .map(|object| (object.name.as_str(), object))
        .collect::<BTreeMap<_, _>>();
    let expected_tables = catalog_tables(schema)
        .map(|table| table.name)
        .collect::<BTreeSet<_>>();
    let expected_indexes = catalog_indexes(schema)
        .map(|index| index.name)
        .collect::<BTreeSet<_>>();

    // @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08 — the manifest-owned integration companion is recognized and validated exactly without changing the frozen auth catalog version or `_auth_*` shapes.
    if objects.iter().any(|object| {
        object.kind == "table" && object.name == super::auth_integrations::INTEGRATION_RECORD_TABLE
    }) {
        super::auth_integrations::validate_exact_schema(conn)?;
    }
    // @ref LLP 0071#bounded-pre-auth-ledger — recognize only the exact
    // manifest-owned declared ledger without changing `_auth_*` catalog v2.
    if objects.iter().any(|object| {
        object.kind == "table" && object.name == super::declared_clients::DECLARED_CLIENT_TABLE
    }) {
        super::declared_clients::validate_exact_schema(conn)?;
    }
    // @ref LLP 0204#d94--shareable-capability-links — recognize only the
    // exact manifest-owned link companion; the frozen `_auth_*` catalog does
    // not absorb bearer-link state.
    if objects.iter().any(|object| {
        object.kind == "table" && object.name == super::capability_links::CAPABILITY_LINK_TABLE
    }) {
        super::capability_links::validate_exact_schema(conn)?;
    }
    // @ref LLP 0204#d95--approval-gated-effects — recognize the exact
    // manifest-owned approval companion without widening the auth catalog.
    if objects.iter().any(|object| {
        object.kind == "table" && object.name == super::pending_effects::PENDING_EFFECT_TABLE
    }) {
        super::pending_effects::validate_exact_schema(conn)?;
    }
    // @ref LLP 0204#d91--streaming-conversations — the
    // function-manifest companion is recognized only in its exact shape.
    if objects.iter().any(|object| {
        object.kind == "table" && object.name == super::stream_transcripts::STREAM_TRANSCRIPT_TABLE
    }) {
        super::stream_transcripts::validate_exact_schema(conn)?;
    }

    for table in catalog_tables(schema) {
        let Some(object) = by_name.get(table.name) else {
            return Err(corrupt_with_object(
                "auth catalog table is missing",
                "table",
                table.name,
            ));
        };
        if object.kind != "table"
            || object.table != table.name
            || object.sql.as_deref().map(normalize_schema_sql)
                != Some(normalize_schema_sql(table.sql))
        {
            return Err(corrupt_with_object(
                "auth catalog table definition differs from the recognized version",
                &object.kind,
                table.name,
            ));
        }
    }

    for object in objects {
        if object.kind == "table"
            && is_auth_reserved_identifier(&object.name)
            && !expected_tables.contains(object.name.as_str())
        {
            return Err(corrupt_with_object(
                "marked auth catalog has an unexpected protected table",
                "table",
                &object.name,
            ));
        }
    }

    for index in catalog_indexes(schema) {
        let Some(object) = by_name.get(index.name) else {
            return Err(corrupt_with_object(
                "auth catalog index is missing",
                "index",
                index.name,
            ));
        };
        if object.kind != "index"
            || object.table != index.table
            || object.sql.as_deref().map(normalize_schema_sql)
                != Some(normalize_schema_sql(index.sql))
        {
            return Err(corrupt_with_object(
                "auth catalog index definition differs from the recognized version",
                &object.kind,
                index.name,
            ));
        }
    }

    // Ignore only SQLite-owned primary-key autoindexes. Every other object
    // attached to a catalog table must be one of the named indexes.
    for object in objects {
        if !expected_tables.contains(object.table.as_str()) || object.kind == "table" {
            continue;
        }
        let sqlite_autoindex = object.kind == "index"
            && object.name.starts_with("sqlite_autoindex_")
            && object.sql.is_none();
        if sqlite_autoindex {
            continue;
        }
        if object.kind == "index" && expected_indexes.contains(object.name.as_str()) {
            continue;
        }
        let declared_push_registry = objects.iter().any(|candidate| {
            candidate.kind == "table" && candidate.name == "_snapback_push_tokens_v1"
        });
        if declared_push_registry
            && object.kind == "trigger"
            && crate::push::is_exact_auth_lifecycle_trigger(
                &object.name,
                &object.table,
                object.sql.as_deref(),
            )
        {
            continue;
        }
        return Err(corrupt_with_object(
            "marked auth catalog has an unexpected attached object",
            &object.kind,
            &object.name,
        ));
    }

    // The SQL text comparison above pins every CHECK expression. The pragma
    // shape additionally proves declared types/nullability/defaults/PKs,
    // foreign keys, uniqueness, indexed columns/collations/order, and partial
    // predicates against a once-built exact reference catalog for the marked
    // version. This avoids trusting writable-schema text that does not match
    // the physical btree.
    if catalog_shape(conn, objects, schema)? != *expected_catalog_shape(schema)? {
        return Err(corrupt(
            "auth catalog physical constraints differ from the recognized version",
        ));
    }

    Ok(())
}

fn expected_catalog_shape(schema: &'static CatalogSchema) -> SnapbackResult<&'static CatalogShape> {
    // One memoized reference shape per recognized version. `version` is the
    // stable discriminator (`CATALOG_V1`/`CATALOG_V2`).
    static EXPECTED_V1: OnceLock<Result<CatalogShape, SnapbackError>> = OnceLock::new();
    static EXPECTED_V2: OnceLock<Result<CatalogShape, SnapbackError>> = OnceLock::new();
    static EXPECTED_V3: OnceLock<Result<CatalogShape, SnapbackError>> = OnceLock::new();
    static EXPECTED_V4: OnceLock<Result<CatalogShape, SnapbackError>> = OnceLock::new();
    let cell = if schema.version == CATALOG_V1.version {
        &EXPECTED_V1
    } else if schema.version == CATALOG_V2.version {
        &EXPECTED_V2
    } else if schema.version == CATALOG_V3.version {
        &EXPECTED_V3
    } else {
        &EXPECTED_V4
    };
    match cell.get_or_init(|| {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        for table in catalog_tables(schema) {
            conn.execute_batch(table.sql)?;
        }
        for index in catalog_indexes(schema) {
            conn.execute_batch(index.sql)?;
        }
        let objects = schema_objects(&conn)?;
        catalog_shape(&conn, &objects, schema)
    }) {
        Ok(shape) => Ok(shape),
        Err(error) => Err(error.clone()),
    }
}

fn catalog_shape(
    conn: &Connection,
    objects: &[SchemaObject],
    schema: &'static CatalogSchema,
) -> SnapbackResult<CatalogShape> {
    let objects_by_name = objects
        .iter()
        .map(|object| (object.name.as_str(), object))
        .collect::<BTreeMap<_, _>>();
    let mut tables = BTreeMap::new();
    for expected in catalog_tables(schema) {
        let object = objects_by_name.get(expected.name).ok_or_else(|| {
            corrupt_with_object("auth catalog table is missing", "table", expected.name)
        })?;
        tables.insert(
            expected.name.to_owned(),
            TableShape {
                normalized_sql: object
                    .sql
                    .as_deref()
                    .map(normalize_schema_sql)
                    .unwrap_or_default(),
                columns: table_columns(conn, expected.name)?,
                foreign_keys: table_foreign_keys(conn, expected.name)?,
            },
        );
    }

    let mut indexes = BTreeMap::new();
    for expected in catalog_indexes(schema) {
        let object = objects_by_name.get(expected.name).ok_or_else(|| {
            corrupt_with_object("auth catalog index is missing", "index", expected.name)
        })?;
        let (unique, origin, partial) = index_list_entry(conn, expected.table, expected.name)?
            .ok_or_else(|| {
                corrupt_with_object(
                    "auth catalog index is not attached to its declared table",
                    "index",
                    expected.name,
                )
            })?;
        indexes.insert(
            expected.name.to_owned(),
            IndexShape {
                normalized_sql: object
                    .sql
                    .as_deref()
                    .map(normalize_schema_sql)
                    .unwrap_or_default(),
                table: object.table.clone(),
                unique,
                origin,
                partial,
                columns: index_columns(conn, expected.name)?,
            },
        );
    }
    Ok(CatalogShape { tables, indexes })
}

fn table_columns(conn: &Connection, table: &str) -> SnapbackResult<Vec<ColumnShape>> {
    let mut statement = conn.prepare(&format!(
        "PRAGMA table_xinfo({})",
        crate::auth::rescue::quote_identifier(table)
    ))?;
    Ok(statement
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
        .collect::<Result<Vec<_>, _>>()?)
}

fn table_foreign_keys(conn: &Connection, table: &str) -> SnapbackResult<Vec<ForeignKeyShape>> {
    let mut statement = conn.prepare(&format!(
        "PRAGMA foreign_key_list({})",
        crate::auth::rescue::quote_identifier(table)
    ))?;
    let mut keys = statement
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
    keys.sort_by(|left, right| {
        (&left.id, &left.sequence, &left.from_column).cmp(&(
            &right.id,
            &right.sequence,
            &right.from_column,
        ))
    });
    Ok(keys)
}

fn index_list_entry(
    conn: &Connection,
    table: &str,
    index: &str,
) -> SnapbackResult<Option<(bool, String, bool)>> {
    let mut statement = conn.prepare(&format!(
        "PRAGMA index_list({})",
        crate::auth::rescue::quote_identifier(table)
    ))?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == index {
            return Ok(Some((
                row.get::<_, i64>(2)? != 0,
                row.get(3)?,
                row.get::<_, i64>(4)? != 0,
            )));
        }
    }
    Ok(None)
}

fn index_columns(conn: &Connection, index: &str) -> SnapbackResult<Vec<IndexColumnShape>> {
    let mut statement = conn.prepare(&format!(
        "PRAGMA index_xinfo({})",
        crate::auth::rescue::quote_identifier(index)
    ))?;
    Ok(statement
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
        .collect::<Result<Vec<_>, _>>()?)
}

fn schema_objects(conn: &Connection) -> SnapbackResult<Vec<SchemaObject>> {
    let mut statement = conn.prepare(
        "SELECT type, name, tbl_name, sql
         FROM sqlite_schema
         ORDER BY type, name",
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok(SchemaObject {
                kind: row.get(0)?,
                name: row.get(1)?,
                table: row.get(2)?,
                sql: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

pub(super) fn auth_catalog_marker(conn: &Connection) -> SnapbackResult<Option<String>> {
    let objects = schema_objects(conn)?;
    auth_catalog_marker_from_objects(conn, &objects)
}

fn auth_catalog_marker_from_objects(
    conn: &Connection,
    objects: &[SchemaObject],
) -> SnapbackResult<Option<String>> {
    let has_meta = objects
        .iter()
        .any(|object| object.kind == "table" && object.name == "_snapback_meta");
    if !has_meta {
        return Ok(None);
    }
    Ok(conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            params![META_AUTH_CATALOG_VERSION],
            |row| row.get(0),
        )
        .optional()?)
}

fn read_password_identifier_mode_on(conn: &Connection) -> SnapbackResult<PasswordIdentifierMode> {
    let stored = conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            params![META_AUTH_PASSWORD_IDENTIFIER_MODE],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    stored
        .as_deref()
        .and_then(PasswordIdentifierMode::parse)
        .ok_or_else(|| corrupt("catalog v4 lacks a valid password identifier mode"))
}

/// Return the v4-only canonicalization declaration without opening a
/// transaction. Predecessor catalogs remain recognized, but password-provider
/// paths that need this declaration refuse with one stable readiness code.
pub(super) fn require_password_identifier_mode_on(
    conn: &Connection,
) -> SnapbackResult<PasswordIdentifierMode> {
    match inspect_auth_catalog_on(conn)? {
        AuthCatalogState::ReadyV4 => read_password_identifier_mode_on(conn),
        AuthCatalogState::ReadyV1 | AuthCatalogState::ReadyV2 | AuthCatalogState::ReadyV3 => {
            Err(password_requires_v4())
        }
        AuthCatalogState::Uninitialized => Err(corrupt("auth catalog is not initialized")),
    }
}

/// Preserve the exact behavior of the password/recovery storage floor that
/// shipped with catalog v3 while keeping the first-class provider gated on
/// v4 readiness. No row is synthesized and no predecessor catalog migrates.
pub(super) fn identity_floor_password_identifier_mode_on(
    conn: &Connection,
) -> SnapbackResult<PasswordIdentifierMode> {
    match inspect_auth_catalog_on(conn)? {
        AuthCatalogState::ReadyV4 => read_password_identifier_mode_on(conn),
        AuthCatalogState::ReadyV3 => Ok(PasswordIdentifierMode::UsernameV1),
        AuthCatalogState::ReadyV1 | AuthCatalogState::ReadyV2 => Err(password_requires_v4()),
        AuthCatalogState::Uninitialized => Err(corrupt("auth catalog is not initialized")),
    }
}

fn password_requires_v4() -> SnapbackError {
    SnapbackError::error(
        PASSWORD_PROVIDER_REQUIRES_V4_CODE,
        "auth",
        "password identifier mode requires auth catalog version 4",
    )
}

fn password_identifier_mode_immutable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_MODE_IMMUTABLE",
        "auth",
        "password identifier mode cannot change after auth catalog activation",
    )
}

/// Test the marker wall from the perspective of the shipped v3 recognizer.
/// A v3-era binary has no descriptor for marker 4 and therefore refuses before
/// attempting to interpret any v4 table or metadata.
#[cfg(any(test, feature = "test-support"))]
fn inspect_auth_catalog_as_v3_era_binary(conn: &Connection) -> SnapbackResult<AuthCatalogState> {
    let objects = schema_objects(conn)?;
    if auth_catalog_marker_from_objects(conn, &objects)?.as_deref() == Some(CATALOG_V4.version) {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED",
            "auth",
            "auth catalog marker names an unsupported version",
        ));
    }
    inspect_auth_catalog_on(conn)
}

fn normalize_schema_sql(sql: &str) -> String {
    sql.trim()
        .trim_end_matches(';')
        .chars()
        .filter(|character| !character.is_ascii_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}

/// Read the persisted auth-clock floor within a caller-owned transaction.
/// A missing key is the zero floor; any stored value is validated as an
/// in-range non-negative integer or fails closed as catalog corruption.
pub(super) fn read_session_clock_floor_on(conn: &Connection) -> SnapbackResult<u64> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            params![META_AUTH_SESSION_CLOCK_FLOOR_MS],
            |row| row.get(0),
        )
        .optional()?;
    match stored {
        None => Ok(0),
        Some(text) => {
            let value: u64 = text
                .parse()
                .ok()
                .filter(|value| *value <= MAX_SAFE_TIMESTAMP_MS)
                .ok_or_else(|| corrupt("auth session clock floor is not a portable timestamp"))?;
            Ok(value)
        }
    }
}

/// Raise the persisted auth-clock floor to at least `observed_ms` and return
/// the resulting floor. The stored value never decreases.
pub(super) fn advance_session_clock_floor_on(
    tx: &Transaction<'_>,
    observed_ms: u64,
) -> SnapbackResult<u64> {
    let current = read_session_clock_floor_on(tx)?;
    let floor = current.max(observed_ms);
    if floor != current {
        tx.execute(
            "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![META_AUTH_SESSION_CLOCK_FLOOR_MS, floor.to_string()],
        )?;
    }
    Ok(floor)
}

fn corrupt(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_CATALOG_CORRUPT", "auth", message)
}

fn corrupt_with_object(message: &str, kind: &str, name: &str) -> SnapbackError {
    corrupt(message).with_details(json!({ "objectKind": kind, "objectName": name }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{FieldManifest, FieldType, IndexManifest, SchemaManifest, TableManifest};
    use crate::storage::auth_mode::{
        META_AUTH_MODE_STATE, META_CAPABILITY_AWARE_SCHEMA_MANIFEST, META_STAGED_AUTH_MODE_MANIFEST,
    };
    use serde_json::to_string;
    use std::fs;

    fn catalog_database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        assert_eq!(
            db.inspect_auth_catalog().expect("inspect empty catalog"),
            AuthCatalogState::Uninitialized
        );
        db.activate_current_auth_catalog()
            .expect("activate catalog");
        db
    }

    fn row_count(db: &LocalDatabase, table: &str) -> i64 {
        db.conn
            .query_row(&format!("SELECT COUNT(*) FROM \"{table}\""), [], |row| {
                row.get(0)
            })
            .expect("count rows")
    }

    #[test]
    fn catalog_pragma_helpers_quote_embedded_double_quotes() {
        let conn = Connection::open_in_memory().expect("memory database");
        let parent = "parent\"table";
        let child = "child\"table";
        let index = "child\"index";
        conn.execute_batch(&format!(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE {}(id TEXT PRIMARY KEY);
             CREATE TABLE {}(
               id TEXT PRIMARY KEY,
               parent_id TEXT,
               FOREIGN KEY(parent_id) REFERENCES {}(id)
             );
             CREATE INDEX {} ON {}(parent_id);",
            crate::auth::rescue::quote_identifier(parent),
            crate::auth::rescue::quote_identifier(child),
            crate::auth::rescue::quote_identifier(parent),
            crate::auth::rescue::quote_identifier(index),
            crate::auth::rescue::quote_identifier(child),
        ))
        .expect("quoted schema");

        assert_eq!(table_columns(&conn, child).expect("columns").len(), 2);
        let foreign_keys = table_foreign_keys(&conn, child).expect("foreign keys");
        assert_eq!(foreign_keys.len(), 1);
        assert_eq!(foreign_keys[0].target_table, parent);
        assert!(
            !index_list_entry(&conn, child, index)
                .expect("index list")
                .expect("index present")
                .0
        );
        assert!(
            index_columns(&conn, index)
                .expect("index columns")
                .iter()
                .any(|column| column.name.as_deref() == Some("parent_id"))
        );
    }

    #[test]
    fn service_rollback_uncertainty_carries_the_exact_planned_terminal() {
        let mut db = catalog_database();
        let interlock =
            crate::auth::service_fence::RecordingServiceAuthorityCommitInterlock::default();
        let authority = db
            .claim_kernel_commit_authority()
            .expect("kernel authority");
        db.install_service_authority_commit_interlock(
            &authority.binding(),
            interlock.bind(&authority),
        )
        .expect("bind service terminal interlock");

        inject_service_rollback_uncertainty_for_test();
        let attempt: ServiceAuthTransactionAttempt<()> = db
            .attempt_auth_transaction_with_service_terminal(
                crate::auth::service_authority_contract::ServiceAuthorityDisposition::Carrier,
                |_tx| Ok(vec!["token-exact".to_owned()]),
                |tx| {
                    tx.execute(
                        "INSERT INTO _snapback_meta(key, value) VALUES('service-test', 'written')",
                        [],
                    )?;
                    Err(SnapbackError::error(
                        "TEST_SERVICE_BODY_FAILURE",
                        "auth",
                        "injected failure after the exact terminal plan",
                    ))
                },
            );
        let ServiceAuthTransactionAttempt::CommitUncertain { terminal, .. } = attempt else {
            panic!("injected rollback acknowledgement must be uncertain");
        };
        assert_eq!(
            interlock.plans(),
            vec![(
                vec!["token-exact".to_owned()],
                crate::auth::service_authority_contract::ServiceAuthorityDisposition::Carrier,
            )]
        );
        assert_eq!(interlock.ambiguous(), 1);
        assert_eq!(interlock.rolled_back(), 0);
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT value FROM _snapback_meta WHERE key = 'service-test'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .unwrap(),
            None,
            "the injected uncertainty follows a real rollback"
        );

        db.reconcile_ambiguous_service_terminal(terminal, false)
            .expect("exact durable predecessor settles only its ticket");
        assert_eq!(interlock.rolled_back(), 1);
    }

    #[test]
    fn frozen_v1_reopens_without_migration_and_refuses_agent_surfaces() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("frozen-v1.sqlite3");
        let mut database = LocalDatabase::open(&path).unwrap();
        install_frozen_v1_catalog_fixture(&mut database).unwrap();
        assert_eq!(
            database.inspect_auth_catalog().unwrap(),
            AuthCatalogState::ReadyV1
        );
        drop(database);

        let mut reopened = LocalDatabase::open(&path).unwrap();
        assert_eq!(
            reopened.inspect_auth_catalog().unwrap(),
            AuthCatalogState::ReadyV1
        );
        reopened.activate_current_auth_catalog().unwrap();
        assert_eq!(
            reopened.inspect_auth_catalog().unwrap(),
            AuthCatalogState::ReadyV1,
            "current activation must not silently migrate a frozen v1 catalog"
        );
        assert_eq!(
            auth_catalog_marker(&reopened.conn).unwrap().as_deref(),
            Some(AUTH_CATALOG_VERSION_V1)
        );

        let registration = crate::storage::auth_agents::AgentRegistration {
            display_name: Some("legacy agent".to_owned()),
            operator_contact: None,
            registration_provenance: r#"{"createdBy":"operator"}"#.to_owned(),
            owner_user_id: None,
        };
        reopened
            .create_agent_principal("agent-on-v1", 1, &registration)
            .expect_err("agent creation must be unavailable on the frozen v1 shape");
        assert_eq!(row_count(&reopened, "_auth_users"), 0);
        let agent_tables: i64 = reopened
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema
                 WHERE type = 'table' AND name IN (
                   '_auth_grants', '_auth_agent_credentials', '_auth_grant_tokens',
                   '_auth_agent_invitations', '_auth_pairing_requests', '_auth_scope_bases'
                 )",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(agent_tables, 0);
    }

    #[test]
    fn frozen_v2_reopens_without_silent_identity_core_migration() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("frozen-v2.sqlite3");
        let mut database = LocalDatabase::open(&path).unwrap();
        install_frozen_v2_catalog_fixture(&mut database).unwrap();
        drop(database);
        let mut reopened = LocalDatabase::open(&path).unwrap();
        assert_eq!(
            reopened.inspect_auth_catalog().unwrap(),
            AuthCatalogState::ReadyV2
        );
        reopened.activate_current_auth_catalog().unwrap();
        assert_eq!(
            reopened.inspect_auth_catalog().unwrap(),
            AuthCatalogState::ReadyV2
        );
        assert_eq!(
            require_identity_core_v3_on(&reopened.conn)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_IDENTITY_CORE_REQUIRES_V3"
        );
        assert_eq!(
            auth_catalog_marker(&reopened.conn).unwrap().as_deref(),
            Some(AUTH_CATALOG_VERSION_V2)
        );
    }

    #[test]
    fn fresh_activation_creates_exact_v4_and_v3_remains_usable_without_migration() {
        let mut fresh = LocalDatabase::memory().unwrap();
        fresh
            .activate_current_auth_catalog_with_password_identifier_mode(
                PasswordIdentifierMode::EmailV1,
            )
            .unwrap();
        assert_eq!(
            fresh.inspect_auth_catalog().unwrap(),
            AuthCatalogState::ReadyV4
        );
        assert_eq!(
            fresh.auth_password_identifier_mode().unwrap(),
            PasswordIdentifierMode::EmailV1
        );
        assert_eq!(
            auth_catalog_marker(&fresh.conn).unwrap().as_deref(),
            Some(AUTH_CATALOG_VERSION)
        );
        assert!(
            auth_catalog_table_names(AuthCatalogState::ReadyV4)
                .unwrap()
                .contains(&"_auth_password_attempts")
        );
        assert_eq!(
            inspect_auth_catalog_as_v3_era_binary(&fresh.conn)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED"
        );
        assert_eq!(
            fresh
                .activate_current_auth_catalog_with_password_identifier_mode(
                    PasswordIdentifierMode::UsernameV1,
                )
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_MODE_IMMUTABLE"
        );

        let mut frozen = LocalDatabase::memory().unwrap();
        install_frozen_v3_catalog_fixture(&mut frozen).unwrap();
        frozen.activate_current_auth_catalog().unwrap();
        assert_eq!(
            frozen.inspect_auth_catalog().unwrap(),
            AuthCatalogState::ReadyV3
        );
        let guest = frozen
            .identity_guest_create(10_000, 1, &crate::auth::crypto::OsRandom)
            .expect("v3 identity-core guest path remains usable");
        assert!(!guest.user_id.is_empty());
        let legacy_password = frozen
            .identity_password_register(
                "legacy-user",
                &crate::auth::identity_core::PasswordSecret::new(
                    "strong-legacy-password-1".to_owned(),
                ),
                2,
                &crate::auth::crypto::OsRandom,
                "key-1",
                &[7; 32],
            )
            .expect("v3 username-v1 password floor remains usable");
        assert!(!legacy_password.user_id.is_empty());
        assert_eq!(
            frozen
                .auth_password_identifier_mode()
                .unwrap_err()
                .diagnostic
                .code,
            PASSWORD_PROVIDER_REQUIRES_V4_CODE,
            "the first-class identifier declaration remains a v4-only path"
        );
        assert_eq!(
            frozen
                .activate_current_auth_catalog_with_password_identifier_mode(
                    PasswordIdentifierMode::EmailV1,
                )
                .unwrap_err()
                .diagnostic
                .code,
            PASSWORD_PROVIDER_REQUIRES_V4_CODE
        );
        let readiness = frozen.auth_password_provider_readiness().unwrap();
        assert!(!readiness.ready);
        assert_eq!(readiness.catalog_version, Some(3));
        assert_eq!(
            readiness.refusal_code.as_deref(),
            Some(PASSWORD_PROVIDER_REQUIRES_V4_CODE)
        );
    }

    #[test]
    fn auth_session_clock_floor_is_durable_and_never_decreases() {
        let mut db = catalog_database();
        assert_eq!(
            db.auth_session_clock_floor().unwrap(),
            0,
            "an unrecorded floor reads as zero"
        );

        assert_eq!(db.advance_auth_session_clock_floor(250).unwrap(), 250);
        assert_eq!(db.auth_session_clock_floor().unwrap(), 250);

        // A lower observation (a backward wall-clock sample) never lowers the
        // durable floor and still reports the higher persisted value.
        assert_eq!(db.advance_auth_session_clock_floor(150).unwrap(), 250);
        assert_eq!(db.auth_session_clock_floor().unwrap(), 250);

        // Forward progress advances it.
        assert_eq!(db.advance_auth_session_clock_floor(400).unwrap(), 400);
        assert_eq!(db.auth_session_clock_floor().unwrap(), 400);

        // GC also advances the same durable floor.
        db.auth_gc(600).unwrap();
        assert_eq!(db.auth_session_clock_floor().unwrap(), 600);
        db.auth_gc(500).unwrap();
        assert_eq!(
            db.auth_session_clock_floor().unwrap(),
            600,
            "a GC pass at a lower epoch never rolls the floor back"
        );

        // Out-of-range observations fail closed.
        assert_eq!(
            db.advance_auth_session_clock_floor(MAX_SAFE_TIMESTAMP_MS + 1)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_CATALOG_CORRUPT"
        );

        // A corrupt stored value fails closed on read.
        db.conn
            .execute(
                "INSERT INTO _snapback_meta(key, value) VALUES(?1, 'not-a-number')
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![META_AUTH_SESSION_CLOCK_FLOOR_MS],
            )
            .unwrap();
        assert_eq!(
            db.auth_session_clock_floor().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_CATALOG_CORRUPT"
        );
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn auth_backup_excludes_push_registry_custody_rows() {
        use std::os::unix::fs::FileExt as _;

        let mut db = catalog_database();
        db.activate_push_registry_for_test(crate::push::PushSeamDeclarationV1 {
            app_scope: crate::push::PushAppScopeV1 {
                eas_project_id: "eas-backup".into(),
                application_id: "com.example.backup".into(),
                environment: "test".into(),
            },
            registry: crate::push::PushRegistryDeclarationV1 {
                idle_retention_ms: 86_400_000,
            },
            audiences: std::collections::BTreeMap::new(),
            uses: Vec::new(),
            ledger: None,
        })
        .expect("push registry");
        db.conn
            .execute(
                "INSERT INTO _snapback_push_tokens_v1(
                   id, app_scope, principal_id, installation_id, token_hash, token_bytes,
                   session_id, session_generation, registered_at_ms, last_registered_at_ms
                 ) VALUES(?1, 'scope', 'user', 'installation', ?2, ?3,
                          'session', 1, 1, 1)",
                params![
                    crate::ids::mint_time_ordered(crate::ids::Kind::PushToken),
                    vec![7_u8; 32],
                    "ExponentPushToken[backup_must_not_export]",
                ],
            )
            .expect("protected token fixture");

        // Production backup members are named, owner-only files retained by
        // descriptor until publication. Match that contract here: an
        // anonymous tempfile cannot be opened by SQLite through
        // `/proc/self/fd` on Linux even though the raw descriptor is valid.
        let image = tempfile::NamedTempFile::new().expect("backup image");
        db.backup_auth_catalog_after_forced_initialization_failure(image.as_file())
            .expect("auth backup");
        let backup = open_backup_image_connection(image.as_file(), true).expect("open backup");
        let rows: i64 = backup
            .query_row("SELECT COUNT(*) FROM _snapback_push_tokens_v1", [], |row| {
                row.get(0)
            })
            .expect("backup registry count");
        assert_eq!(rows, 0, "auth export retains no push custody rows");
        drop(backup);

        let mut raw_image =
            vec![0_u8; image.as_file().metadata().expect("backup metadata").len() as usize];
        image
            .as_file()
            .read_exact_at(&mut raw_image, 0)
            .expect("read raw backup image");
        let forbidden = b"backup_must_not_export";
        assert!(
            !raw_image
                .windows(forbidden.len())
                .any(|window| window == forbidden),
            "auth export retains push-token plaintext in SQLite free space"
        );

        // Removing the declaration drops the table before a later backup can
        // see it. That DROP must itself be a physical erasure boundary; the
        // next export gets no table-shaped second chance to scrub old pages.
        db.with_auth_transaction(|tx| crate::push::activate_manifest_in(tx, None))
            .expect("remove push declaration storage");
        let post_removal_image = tempfile::NamedTempFile::new().expect("post-removal backup image");
        db.backup_auth_catalog_into(post_removal_image.as_file())
            .expect("post-removal auth backup");
        let mut raw_post_removal = vec![
            0_u8;
            post_removal_image
                .as_file()
                .metadata()
                .expect("post-removal backup metadata")
                .len() as usize
        ];
        post_removal_image
            .as_file()
            .read_exact_at(&mut raw_post_removal, 0)
            .expect("read raw post-removal backup image");
        assert!(
            !raw_post_removal
                .windows(forbidden.len())
                .any(|window| window == forbidden),
            "post-declaration-removal auth export retains push-token plaintext"
        );
    }

    #[test]
    fn declared_restore_purges_every_v2_agent_authority_class() {
        let mut db = catalog_database();
        db.conn
            .execute_batch(
                "INSERT INTO _auth_users(id, created_at_ms, kind)
                   VALUES('human', 1, 'human');
                 INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, registration_provenance
                 ) VALUES('agent', 1, 'agent', 'Agent', 'test');
                 INSERT INTO _auth_agent_credentials(
                   id, user_id, secret_hash, generation, created_at_ms,
                   rotated_at_ms, last_used_at_ms
                 ) VALUES('credential', 'agent', zeroblob(32), 1, 1, 1, 1);
                 INSERT INTO _auth_grants(
                   id, actor_user_id, effective_user_id, scopes, created_at_ms,
                   expires_at_ms, created_by, last_used_at_ms
                 ) VALUES('grant', 'agent', NULL, '[]', 1, NULL, 'test', 1);
                 INSERT INTO _auth_grant_tokens(
                   id, token_hash, grant_id, credential_id,
                   credential_generation, created_at_ms, expires_at_ms
                 ) VALUES('token', zeroblob(32), 'grant', 'credential', 1, 1, 1000);
                 INSERT INTO _auth_agent_invitations(
                   id, token_hash, class, created_by, minted_profile,
                   created_at_ms, expires_at_ms
                 ) VALUES('invitation', zeroblob(32), 'creation', 'test', 'dev', 1, 1000);
                 INSERT INTO _auth_pairing_requests(
                   id, code_hash, minted_by_user_id, agent_user_id,
                   requested_scopes, state, created_at_ms, expires_at_ms
                 ) VALUES('pairing', zeroblob(32), 'human', 'agent', '[]', 'pending', 1, 1000);",
            )
            .unwrap();

        db.apply_auth_restore_declaration("0197f862-f196-7bb2-b3f0-2a67185dfd20", 100)
            .unwrap();

        for table in [
            "_auth_grant_tokens",
            "_auth_pairing_requests",
            "_auth_grants",
            "_auth_agent_invitations",
            "_auth_agent_credentials",
        ] {
            assert_eq!(row_count(&db, table), 0, "restore purged {table}");
        }
        assert_eq!(
            row_count(&db, "_auth_users"),
            2,
            "principals are not bearers"
        );
    }

    #[test]
    fn declared_restore_uses_non_creation_timestamp_frontier_when_host_clock_is_lower() {
        let mut db = catalog_database();
        db.initialize_sender_proof_after_hosted_preflight()
            .expect("initialize restored sender authority");
        let sender_thumbprint = "A".repeat(43);
        db.with_auth_transaction(|tx| {
            tx.execute("INSERT INTO _auth_users(id, created_at_ms) VALUES('user-restore-clock', 900)", [])?;
            tx.execute(
                "INSERT INTO _auth_identities(id, user_id, kind, provider, subject, canonical_value, created_at_ms, verified_at_ms)
                 VALUES('identity-restore-clock', 'user-restore-clock', 'email', 'email-code', 'restore-clock@example.com', 'restore-clock@example.com', 900, 900)",
                [],
            )?;
            tx.execute(
                "INSERT INTO _auth_sessions(
                   id, user_id, identity_id, credential_id, authn_source, authority_instance_id, token_hash,
                   generation, created_at_ms, last_used_at_ms, expires_at_ms,
                   absolute_expires_at_ms, revoked_at_ms
                 ) VALUES(
                   '01890f47-0000-7000-8000-000000000021', 'user-restore-clock', 'identity-restore-clock', NULL, 'identity',
                   'authority-restore-clock', ?1, 1, 900, 900, 1000, 1100, NULL
                 )",
                params![vec![7_u8; 32]],
            )?;
            tx.execute(
                "INSERT INTO _snapback_sender_family_binding(
                   session_id, protocol_version, jwk_thumbprint
                 ) VALUES(
                   '01890f47-0000-7000-8000-000000000021', 2, ?1
                 )",
                params![sender_thumbprint],
            )?;
            Ok(())
        })
        .unwrap();
        db.insert_password_attempt_for_test("restore-clock@example.com", 90, 9, None)
            .unwrap();
        assert_eq!(
            crate::auth::sender_proof::sender_constraint_for_presented_token(
                &db.conn,
                &[7_u8; 32],
                900,
                true,
            )
            .unwrap(),
            Some(sender_thumbprint),
        );

        db.apply_auth_restore_declaration("0197f862-f196-7bb2-b3f0-2a67185dfd18", 100)
            .unwrap();
        let revoked_at: i64 = db
            .conn
            .query_row(
                "SELECT revoked_at_ms FROM _auth_sessions WHERE id = '01890f47-0000-7000-8000-000000000021'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(revoked_at, 1100);
        assert_eq!(db.auth_session_clock_floor().unwrap(), 1100);
        assert_eq!(
            db.password_attempt_for_test("restore-clock@example.com")
                .unwrap(),
            Some((1090, 9, None)),
            "the artificial restore-floor jump must not age out physical lockout state",
        );
        assert_eq!(
            crate::auth::sender_proof::sender_constraint_for_presented_token(
                &db.conn,
                &[7_u8; 32],
                1_100,
                true,
            )
            .unwrap(),
            None,
            "declared restore cannot revive a pre-restore sender-bound token",
        );
    }

    #[test]
    fn declared_restore_uses_v2_agent_timestamp_frontier_before_purge() {
        let mut db = catalog_database();
        db.conn
            .execute_batch(
                "INSERT INTO _auth_agent_invitations(
                   id, token_hash, class, created_by, minted_profile,
                   created_at_ms, expires_at_ms
                 ) VALUES('future-invitation', zeroblob(32), 'creation', 'test', 'dev', 10, 1700);",
            )
            .unwrap();

        db.apply_auth_restore_declaration("0197f862-f196-7bb2-b3f0-2a67185dfd19", 100)
            .unwrap();

        assert_eq!(row_count(&db, "_auth_agent_invitations"), 0);
        assert_eq!(db.auth_session_clock_floor().unwrap(), 1700);
    }

    #[test]
    fn declared_restore_rejects_each_malformed_timestamp_before_any_effect() {
        for malformed in ["-1", "'not-an-integer'"] {
            let mut db = catalog_database();
            db.with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES('valid-user', 10)",
                    [],
                )?;
                tx.execute(
                    "INSERT INTO _auth_identities(
                       id, user_id, kind, provider, subject, canonical_value, created_at_ms, verified_at_ms
                     ) VALUES('valid-identity', 'valid-user', 'email', 'email-code', 'valid@example.com', 'valid@example.com', 10, 10)",
                    [],
                )?;
                tx.execute(
                    "INSERT INTO _auth_sessions(
                       id, user_id, identity_id, credential_id, authn_source, authority_instance_id, token_hash,
                       generation, created_at_ms, last_used_at_ms, expires_at_ms,
                       absolute_expires_at_ms
                     ) VALUES(
                       'valid-session', 'valid-user', 'valid-identity', NULL, 'identity',
                       'valid-authority', ?1, 1, 10, 10, 100, 200
                     )",
                    params![vec![3_u8; 32]],
                )?;
                tx.execute(
                    "INSERT INTO _auth_verification_codes(
                       challenge_id, canonical_address, code_digest, key_id,
                       requested_at_ms, expires_at_ms
                     ) VALUES('valid-challenge', 'valid@example.com', ?1, 'key', 10, 100)",
                    params![vec![4_u8; 32]],
                )?;
                Ok(())
            })
            .unwrap();
            db.conn
                .execute_batch(&format!(
                    "PRAGMA ignore_check_constraints = ON;
                     INSERT INTO _auth_users(id, created_at_ms)
                       VALUES('malformed-user', {malformed});
                     PRAGMA ignore_check_constraints = OFF;"
                ))
                .unwrap();

            let predecessor_version = db.authorization_version().unwrap();
            let predecessor_floor = db.auth_session_clock_floor().unwrap();
            let error = db
                .apply_auth_restore_declaration(
                    &crate::ids::mint_time_ordered(crate::ids::Kind::Declaration),
                    50,
                )
                .expect_err("every malformed restored timestamp must fail closed");
            assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_CATALOG_CORRUPT");
            assert_eq!(
                db.conn
                    .query_row(
                        "SELECT generation, revoked_at_ms FROM _auth_sessions
                         WHERE id = 'valid-session'",
                        [],
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?)),
                    )
                    .unwrap(),
                (1, None),
                "restore refusal must not revoke the valid positive row"
            );
            assert_eq!(row_count(&db, "_auth_verification_codes"), 1);
            assert_eq!(db.auth_session_clock_floor().unwrap(), predecessor_floor);
            assert_eq!(db.authorization_version().unwrap(), predecessor_version);
            assert_eq!(
                db.conn
                    .query_row(
                        "SELECT value FROM _snapback_meta WHERE key = ?1",
                        params![META_AUTH_RESTORE_DECLARATION_ID],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()
                    .unwrap(),
                None
            );
        }
    }

    #[test]
    fn declared_restore_ready_v1_uses_nullable_timestamp_frontier() {
        let mut db = LocalDatabase::memory().unwrap();
        install_frozen_v1_catalog_fixture(&mut db).unwrap();
        db.conn
            .execute_batch(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES('v1-user', 10);
                 INSERT INTO _auth_identities(
                   id, user_id, provider, subject, verified_at_ms
                 ) VALUES('v1-identity', 'v1-user', 'email-code', 'v1@example.com', 10);
                 INSERT INTO _auth_sessions(
                   id, user_id, identity_id, authority_instance_id, token_hash,
                   generation, created_at_ms, last_used_at_ms, expires_at_ms,
                   absolute_expires_at_ms, revoked_at_ms
                 ) VALUES(
                   'v1-terminal', 'v1-user', 'v1-identity', 'v1-terminal-authority',
                   randomblob(32), 2, 10, 10, 100, 200, 1700
                 );
                 INSERT INTO _auth_sessions(
                   id, user_id, identity_id, authority_instance_id, token_hash,
                   generation, created_at_ms, last_used_at_ms, expires_at_ms,
                   absolute_expires_at_ms
                 ) VALUES(
                   '01890f47-0000-7000-8000-000000000022', 'v1-user', 'v1-identity', 'v1-live-authority',
                   randomblob(32), 1, 10, 10, 100, 200
                 );",
            )
            .unwrap();

        db.apply_auth_restore_declaration(
            &crate::ids::mint_time_ordered(crate::ids::Kind::Declaration),
            50,
        )
        .unwrap();

        assert_eq!(
            db.inspect_auth_catalog().unwrap(),
            AuthCatalogState::ReadyV1
        );
        assert_eq!(auth_catalog_marker(&db.conn).unwrap().as_deref(), Some("1"));
        assert_eq!(db.auth_session_clock_floor().unwrap(), 1700);
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT generation, revoked_at_ms FROM _auth_sessions WHERE id = '01890f47-0000-7000-8000-000000000022'",
                    [],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                )
                .unwrap(),
            (2, 1700)
        );
    }

    #[test]
    fn recognizes_uninitialized_collision_object_collision_and_exact_v1() {
        let mut db = LocalDatabase::memory().expect("memory database");
        let version_before = db.current_version().expect("app version before activation");
        let journal_before: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| {
                row.get(0)
            })
            .expect("journal before activation");
        assert_eq!(
            db.inspect_auth_catalog().expect("uninitialized"),
            AuthCatalogState::Uninitialized
        );

        db.conn
            .execute("CREATE TABLE \"_AuTh_Legacy\" (id TEXT)", [])
            .expect("create collision");
        let error = db
            .inspect_auth_catalog()
            .expect_err("reserved table must collide");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_TABLE_COLLISION");
        db.conn
            .execute("DROP TABLE \"_AuTh_Legacy\"", [])
            .expect("drop collision");

        db.conn
            .execute("CREATE TABLE ordinary (id TEXT)", [])
            .expect("ordinary table");
        db.conn
            .execute(
                "CREATE INDEX \"_AUTH_SESSIONS_TOKEN_UQ\" ON ordinary(id)",
                [],
            )
            .expect("foreign mixed-case exact index");
        let error = db
            .inspect_auth_catalog()
            .expect_err("exact catalog object collision");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION"
        );
        db.conn
            .execute("DROP INDEX \"_AUTH_SESSIONS_TOKEN_UQ\"", [])
            .expect("drop foreign index");
        db.conn
            .execute("DROP TABLE ordinary", [])
            .expect("drop ordinary table");

        db.activate_current_auth_catalog()
            .expect("activate exact catalog");
        assert_eq!(
            db.inspect_auth_catalog().expect("ready catalog"),
            AuthCatalogState::ReadyV4
        );
        assert!(db.auth_catalog_ready().expect("ready predicate"));
        assert_eq!(
            db.current_version().expect("app version after activation"),
            version_before
        );
        assert_eq!(
            db.conn
                .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| row
                    .get::<_, i64>(0))
                .expect("journal after activation"),
            journal_before
        );
    }

    #[test]
    fn stage_inspection_is_file_and_wal_read_only() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("inspect-read-only.sqlite3");
        let db = LocalDatabase::open(&path).expect("file database");
        db.conn
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .expect("checkpoint before measurement");
        let wal = path.with_extension("sqlite3-wal");
        let file_len = fs::metadata(&path).expect("database metadata").len();
        let wal_len = fs::metadata(&wal)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let total_changes: i64 = db
            .conn
            .query_row("SELECT total_changes()", [], |row| row.get(0))
            .expect("total changes before inspection");

        assert_eq!(
            db.inspect_auth_catalog().expect("read-only inspection"),
            AuthCatalogState::Uninitialized
        );

        assert_eq!(
            db.conn
                .query_row("SELECT total_changes()", [], |row| row.get::<_, i64>(0))
                .expect("total changes after inspection"),
            total_changes
        );
        assert_eq!(
            fs::metadata(&path).expect("database metadata").len(),
            file_len
        );
        assert_eq!(
            fs::metadata(&wal)
                .map(|metadata| metadata.len())
                .unwrap_or(0),
            wal_len
        );
    }

    #[test]
    fn activation_failure_at_every_ddl_boundary_rolls_back_to_uninitialized() {
        for step in 0..auth_activation_steps() {
            let mut db = LocalDatabase::memory().expect("memory database");
            inject_auth_activation_failure_after_step(step);
            let error = db
                .activate_current_auth_catalog()
                .expect_err("injected activation must fail");
            assert_eq!(error.diagnostic.code, "TEST_AUTH_ACTIVATION_FAILURE");
            assert_eq!(
                db.inspect_auth_catalog().expect("rolled-back catalog"),
                AuthCatalogState::Uninitialized,
                "activation step {step} left durable catalog state"
            );
        }
    }

    #[test]
    fn marker_version_and_every_marked_schema_drift_fail_closed() {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.conn
            .execute(
                // A version above this binary's understanding (v2) — the
                // refuse-at-open case: it must fail closed, not adopt.
                "INSERT INTO _snapback_meta(key, value) VALUES(?1, '99')",
                params![META_AUTH_CATALOG_VERSION],
            )
            .expect("unknown marker");
        let error = db
            .inspect_auth_catalog()
            .expect_err("unknown version must fail");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED"
        );

        db.conn
            .execute(
                "DELETE FROM _snapback_meta WHERE key = ?1",
                params![META_AUTH_CATALOG_VERSION],
            )
            .expect("clear marker");
        db.activate_current_auth_catalog()
            .expect("activate catalog");
        db.conn
            .execute("DROP INDEX \"_auth_sessions_token_uq\"", [])
            .expect("corrupt index");
        let error = db
            .inspect_auth_catalog()
            .expect_err("missing index must be corruption");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_CATALOG_CORRUPT");

        let db = catalog_database();
        db.conn
            .execute(
                "CREATE INDEX extra_auth_index ON _auth_users(created_at_ms)",
                [],
            )
            .expect("extra attached index");
        let error = db
            .inspect_auth_catalog()
            .expect_err("extra attached index must be corruption");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_CATALOG_CORRUPT");

        let db = catalog_database();
        db.conn
            .execute("CREATE TABLE _auth_future(id TEXT)", [])
            .expect("extra protected table");
        let error = db
            .inspect_auth_catalog()
            .expect_err("extra protected table must be corruption");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_CATALOG_CORRUPT");
    }

    #[test]
    fn physical_index_shape_cannot_be_forged_by_expected_schema_text() {
        let db = catalog_database();
        db.conn
            .execute("DROP INDEX \"_auth_sessions_token_uq\"", [])
            .expect("drop expected index");
        db.conn
            .execute(
                "CREATE UNIQUE INDEX \"_auth_sessions_token_uq\"
                 ON \"_auth_sessions\"(user_id)",
                [],
            )
            .expect("create wrong physical index");
        let expected_sql = AUTH_INDEXES_V2
            .iter()
            .find(|index| index.name == "_auth_sessions_token_uq")
            .expect("expected index")
            .sql;
        db.conn
            .execute_batch("PRAGMA writable_schema = ON;")
            .expect("enable in-memory corruption fixture");
        db.conn
            .execute(
                "UPDATE sqlite_schema SET sql = ?1 WHERE name = '_auth_sessions_token_uq'",
                params![expected_sql],
            )
            .expect("forge expected schema text");
        db.conn
            .execute_batch("PRAGMA writable_schema = OFF;")
            .expect("disable corruption fixture");

        let error = db
            .inspect_auth_catalog()
            .expect_err("physical index columns must still be compared");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_CATALOG_CORRUPT");
    }

    #[test]
    fn unmarked_exact_catalog_is_collision_not_adoption() {
        let db = catalog_database();
        db.conn
            .execute(
                "DELETE FROM _snapback_meta WHERE key = ?1",
                params![META_AUTH_CATALOG_VERSION],
            )
            .expect("remove marker");
        let error = db
            .inspect_auth_catalog()
            .expect_err("unmarked catalog must not be adopted");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_TABLE_COLLISION");
    }

    #[test]
    fn direct_auth_transactions_commit_ok_roll_back_err_and_never_touch_app_stream() {
        let mut db = catalog_database();
        let version_before = db.current_version().expect("version");
        let journal_before: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| {
                row.get(0)
            })
            .expect("journal count");

        let outcome = db
            .with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES('user-1', 0)",
                    [],
                )?;
                Ok("committed-negative-outcome")
            })
            .expect("Ok outcome commits");
        assert_eq!(outcome, "committed-negative-outcome");
        assert_eq!(row_count(&db, "_auth_users"), 1);

        let error = db
            .with_auth_transaction::<()>(|tx| {
                tx.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES('user-2', 0)",
                    [],
                )?;
                Err(SnapbackError::error("TEST_ROLLBACK", "test", "roll back"))
            })
            .expect_err("Err outcome rolls back");
        assert_eq!(error.diagnostic.code, "TEST_ROLLBACK");
        assert_eq!(row_count(&db, "_auth_users"), 1);
        assert_eq!(db.current_version().expect("version"), version_before);
        let journal_after: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| {
                row.get(0)
            })
            .expect("journal count");
        assert_eq!(journal_after, journal_before);
    }

    #[test]
    fn declared_restore_failure_at_every_boundary_rolls_back_all_effects() {
        for step in 0..=3 {
            let mut db = catalog_database();
            db.with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES('user-1', 0)",
                    [],
                )?;
                tx.execute(
                    "INSERT INTO _auth_identities(
                       id, user_id, kind, provider, subject, canonical_value, created_at_ms, verified_at_ms
                     ) VALUES('identity-1', 'user-1', 'email', 'email-code', 'person@example.com', 'person@example.com', 0, 0)",
                    [],
                )?;
                tx.execute(
                    "INSERT INTO _auth_sessions(
                       id, user_id, identity_id, credential_id, authn_source, authority_instance_id, token_hash,
                       generation, created_at_ms, last_used_at_ms, expires_at_ms,
                       absolute_expires_at_ms, revoked_at_ms
                     ) VALUES(
                       '01890f47-0000-7000-8000-000000000023', 'user-1', 'identity-1', NULL, 'identity', 'authority-1', ?1,
                       1, 0, 0, 1000, 2000, NULL
                     )",
                    params![vec![7_u8; 32]],
                )?;
                tx.execute(
                    "INSERT INTO _auth_verification_codes(
                       challenge_id, canonical_address, code_digest, key_id,
                       attempts, max_attempts, requested_at_ms, expires_at_ms,
                       consumed_at_ms, superseded_by
                     ) VALUES(
                       'challenge-1', 'person@example.com', ?1, 'key-1',
                       0, 5, 0, 1000, NULL, NULL
                     )",
                    params![vec![9_u8; 32]],
                )?;
                Ok(())
            })
            .expect("seed restore rows");
            let predecessor_version = db.authorization_version().unwrap();

            inject_auth_restore_failure_after_step(step);
            let declaration_id = crate::ids::mint_time_ordered(crate::ids::Kind::Declaration);
            let error = db
                .apply_auth_restore_declaration(&declaration_id, 100)
                .expect_err("injected restore transaction must fail");
            assert_eq!(
                error.diagnostic.code,
                "TEST_AUTH_RESTORE_TRANSACTION_FAILURE"
            );
            let session: (i64, Option<i64>) = db
                .conn
                .query_row(
                    "SELECT generation, revoked_at_ms FROM _auth_sessions WHERE id = '01890f47-0000-7000-8000-000000000023'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .expect("session survives rollback");
            assert_eq!(session, (1, None));
            assert_eq!(row_count(&db, "_auth_verification_codes"), 1);
            let marker: Option<String> = db
                .conn
                .query_row(
                    "SELECT value FROM _snapback_meta WHERE key = ?1",
                    params![META_AUTH_RESTORE_DECLARATION_ID],
                    |row| row.get(0),
                )
                .optional()
                .expect("restore marker query");
            assert_eq!(marker, None);
            assert_eq!(db.authorization_version().unwrap(), predecessor_version);
        }
    }

    #[test]
    fn reset_and_gc_preserve_catalog_and_bypass_app_stream() {
        let mut db = catalog_database();
        db.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES('user-1', 0)",
                [],
            )?;
            tx.execute(
                "INSERT INTO _auth_identities(id, user_id, kind, provider, subject, canonical_value, created_at_ms, verified_at_ms)
                 VALUES('identity-1', 'user-1', 'email', 'email-code', 'person@example.com', 'person@example.com', 0, 0)",
                [],
            )?;
            tx.execute(
                "INSERT INTO _auth_sessions(
                   id, user_id, identity_id, credential_id, authn_source, authority_instance_id, token_hash,
                   generation, created_at_ms, last_used_at_ms, expires_at_ms,
                   absolute_expires_at_ms, revoked_at_ms
                 ) VALUES(
                   'session-1', 'user-1', 'identity-1', NULL, 'identity', 'authority-1', ?1,
                   1, 0, 0, 1, 1, NULL
                 )",
                params![vec![7_u8; 32]],
            )?;
            tx.execute(
                "INSERT INTO _auth_session_tokens(token_hash, session_id, superseded_at_ms)
                 VALUES(?1, 'session-1', 0)",
                params![vec![8_u8; 32]],
            )?;
            tx.execute(
                "INSERT INTO _auth_verification_codes(
                   challenge_id, canonical_address, code_digest, key_id,
                   attempts, max_attempts, requested_at_ms, expires_at_ms,
                   consumed_at_ms, superseded_by
                 ) VALUES(
                   'challenge-1', 'person@example.com', ?1, 'key-1',
                   0, 5, 0, 1, NULL, NULL
                 )",
                params![vec![9_u8; 32]],
            )?;
            Ok(())
        })
        .expect("seed auth rows");

        let gc = db.auth_gc(1).expect("collect expired auth rows");
        assert_eq!(gc.challenges_deleted, 1);
        assert_eq!(gc.sessions_deleted, 1);
        assert!(!gc.immediate_retry);
        assert_eq!(row_count(&db, "_auth_session_tokens"), 0);
        assert_eq!(db.current_version().expect("version"), 0);
        assert_eq!(
            db.conn
                .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| row
                    .get::<_, i64>(0))
                .expect("journal count"),
            0
        );

        db.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES('user-2', 0)",
                [],
            )?;
            Ok(())
        })
        .expect("seed reset row");
        db.schema_seed().reset().expect("reset app and auth");
        assert_eq!(row_count(&db, "_auth_users"), 0);
        assert_eq!(
            db.inspect_auth_catalog().expect("catalog survives reset"),
            AuthCatalogState::ReadyV4
        );
    }

    #[test]
    fn gc_is_bounded_and_schedules_an_immediate_followup_at_the_batch_edge() {
        let mut db = catalog_database();
        db.with_auth_transaction(|tx| {
            for index in 0..=AUTH_GC_BATCH {
                tx.execute(
                    "INSERT INTO _auth_verification_codes(
                       challenge_id, canonical_address, code_digest, key_id,
                       attempts, max_attempts, requested_at_ms, expires_at_ms,
                       consumed_at_ms, superseded_by
                     ) VALUES(?1, ?2, ?3, 'key-1', 0, 5, 0, 1, NULL, NULL)",
                    params![
                        format!("challenge-{index}"),
                        format!("person-{index}@example.com"),
                        vec![index as u8; 32],
                    ],
                )?;
            }
            Ok(())
        })
        .expect("seed one over a GC batch");

        let first = db.auth_gc(1).expect("first bounded GC pass");
        assert_eq!(first.challenges_deleted, AUTH_GC_BATCH);
        assert!(first.immediate_retry);
        assert_eq!(row_count(&db, "_auth_verification_codes"), 1);

        let second = db.auth_gc(1).expect("second GC pass");
        assert_eq!(second.challenges_deleted, 1);
        assert!(!second.immediate_retry);
        assert_eq!(row_count(&db, "_auth_verification_codes"), 0);
        assert_eq!(db.current_version().expect("app version"), 0);
    }

    #[test]
    fn reserved_manifest_names_reject_apply_reopen_and_runtime_resolution() {
        for (kind, manifest) in [
            (
                "table",
                SchemaManifest {
                    tables: vec![TableManifest {
                        name: "_AuTh_Users".to_owned(),
                        fields: Vec::new(),
                        indexes: Vec::new(),
                        syncable: false,
                        permission_backing: false,
                        permission_fields: None,
                        search_indexes: Vec::new(),
                        vector_indexes: Vec::new(),
                        search_live_limits: None,
                        membership: None,
                        authority_profile: None,
                        asset_sharing: None,
                        visibility: None,
                        history: None,
                    }],
                    ..SchemaManifest::default()
                },
            ),
            (
                "field",
                SchemaManifest {
                    tables: vec![TableManifest {
                        name: "items".to_owned(),
                        fields: vec![FieldManifest {
                            name: "_AUTH_subject".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        }],
                        indexes: Vec::new(),
                        syncable: false,
                        permission_backing: false,
                        permission_fields: None,
                        search_indexes: Vec::new(),
                        vector_indexes: Vec::new(),
                        search_live_limits: None,
                        membership: None,
                        authority_profile: None,
                        asset_sharing: None,
                        visibility: None,
                        history: None,
                    }],
                    ..SchemaManifest::default()
                },
            ),
            (
                "index",
                SchemaManifest {
                    tables: vec![TableManifest {
                        name: "items".to_owned(),
                        fields: vec![FieldManifest {
                            name: "value".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        }],
                        indexes: vec![IndexManifest {
                            name: "_auth_lookup".to_owned(),
                            fields: vec!["value".to_owned()],
                            unique: false,
                            where_applicable: false,
                        }],
                        syncable: false,
                        permission_backing: false,
                        permission_fields: None,
                        search_indexes: Vec::new(),
                        vector_indexes: Vec::new(),
                        search_live_limits: None,
                        membership: None,
                        authority_profile: None,
                        asset_sharing: None,
                        visibility: None,
                        history: None,
                    }],
                    ..SchemaManifest::default()
                },
            ),
        ] {
            let mut db = LocalDatabase::memory().expect("memory database");
            let error = db
                .schema_seed()
                .apply_schema(manifest.clone())
                .expect_err("reserved manifest apply must fail");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_INVALID_IDENTIFIER",
                "{kind}"
            );

            let directory = tempfile::tempdir().expect("tempdir");
            let path = directory.path().join(format!("reserved-{kind}.sqlite3"));
            let db = LocalDatabase::open(&path).expect("file database");
            db.conn
                .execute(
                    "DELETE FROM _snapback_meta WHERE key IN (?1, ?2, ?3)",
                    params![
                        META_AUTH_MODE_STATE,
                        META_CAPABILITY_AWARE_SCHEMA_MANIFEST,
                        META_STAGED_AUTH_MODE_MANIFEST,
                    ],
                )
                .expect("remove managed-mode metadata from legacy fixture");
            db.conn
                .execute(
                    "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)",
                    params![
                        super::super::META_SCHEMA_MANIFEST,
                        to_string(&manifest).expect("manifest json")
                    ],
                )
                .expect("plant stored manifest");
            drop(db);
            let error = LocalDatabase::open(&path)
                .err()
                .expect("reserved stored manifest must fail reopen");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_INVALID_IDENTIFIER",
                "{kind}"
            );
        }

        let db = LocalDatabase::memory().expect("memory database");
        let error = db
            .query_reads_read()
            .get("_aUtH_users", "anything")
            .expect_err("runtime resolver must reject protected table");
        assert_eq!(error.diagnostic.code, "SNAPBACK_INVALID_IDENTIFIER");
    }
}
impl super::ServingDatabase {
    pub fn advance_auth_session_clock_floor(&mut self, observed_ms: u64) -> SnapbackResult<u64> {
        self.db.advance_auth_session_clock_floor(observed_ms)
    }
}

impl super::ServingDatabase {
    pub fn activate_current_auth_catalog(&mut self) -> SnapbackResult<()> {
        self.db.activate_current_auth_catalog()
    }

    pub fn auth_gc(&mut self, now_ms: u64) -> SnapbackResult<AuthGcResult> {
        self.db.auth_gc(now_ms)
    }

    pub fn apply_auth_restore_declaration(
        &mut self,
        declaration_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<AuthRestoreResult> {
        self.db
            .apply_auth_restore_declaration(declaration_id, now_ms)
    }
}
impl super::ServingDatabase {
    pub fn activate_current_auth_catalog_with_password_identifier_mode(
        &mut self,
        mode: PasswordIdentifierMode,
    ) -> SnapbackResult<()> {
        self.db
            .activate_current_auth_catalog_with_password_identifier_mode(mode)
    }
    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_password_attempt_for_test(
        &mut self,
        address: &str,
        window_start_ms: u64,
        failed_count: u64,
        locked_until_ms: Option<u64>,
    ) -> SnapbackResult<()> {
        self.db.insert_password_attempt_for_test(
            address,
            window_start_ms,
            failed_count,
            locked_until_ms,
        )
    }
}
impl super::ServingDatabase {
    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_large_backup_fixture_for_test(&mut self) -> SnapbackResult<()> {
        self.db.insert_large_backup_fixture_for_test()
    }
}
