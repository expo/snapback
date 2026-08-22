//! Manifest-activated protected storage for LLP 0204 durable watches.

use super::jobs::{BufferedJobEnqueue, JobProducer};
use super::{LocalDatabase, SnapbackResult};
use crate::diagnostic::SnapbackError;
use crate::manifest::SchemaManifest;
use crate::storage::CapturedReadDependency;
use crate::watches::{
    FIRING_JOURNAL_LIMIT, INTERNAL_EVALUATION_ACTION, WatchAuthorityMode, WatchFunctionKind,
    WatchOwnerKind, WatchReactionKind, WatchStatus, catalog_corrupt,
};
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub use snapback_types::storage::watches::{WatchFiringRecord, WatchRecord};

pub const WATCH_TABLE: &str = "_snapback_watches";
#[cfg(any(test, feature = "test-support"))]
const WATCH_FIRING_TABLE: &str = "_snapback_watch_firings";
#[cfg(any(test, feature = "test-support"))]
const MAX_SAFE_COUNTER: u64 = 9_007_199_254_740_991;

const TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS _snapback_watches (
  id TEXT NOT NULL PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK(owner_kind IN ('user', 'integration')),
  owner_principal_id TEXT NOT NULL,
  owner_authority_instance_id TEXT NOT NULL,
  authority_mode TEXT NOT NULL CHECK(authority_mode IN ('capturedGrant', 'revalidatePrincipal')),
  anchor_grant_id TEXT,
  installation_grant_id TEXT,
  anchor_expires_at_ms INTEGER NOT NULL CHECK(anchor_expires_at_ms BETWEEN 0 AND 9007199254740991),
  query_function_id TEXT NOT NULL,
  query_function_name TEXT NOT NULL,
  query_basis INTEGER NOT NULL CHECK(query_basis BETWEEN 0 AND 9007199254740991),
  query_args_json TEXT NOT NULL CHECK(length(CAST(query_args_json AS BLOB)) <= 65536),
  query_args_digest TEXT NOT NULL,
  read_dependencies_json TEXT NOT NULL CHECK(length(CAST(read_dependencies_json AS BLOB)) <= 262144),
  predicate_json TEXT NOT NULL CHECK(length(CAST(predicate_json AS BLOB)) <= 16384),
  reaction_kind TEXT NOT NULL CHECK(reaction_kind IN ('function', 'webhook')),
  reaction_function_id TEXT NOT NULL,
  reaction_function_name TEXT NOT NULL,
  reaction_function_kind TEXT NOT NULL CHECK(reaction_function_kind IN ('query', 'mutation', 'action')),
  reaction_basis INTEGER NOT NULL CHECK(reaction_basis BETWEEN 0 AND 9007199254740991),
  reaction_args_json TEXT NOT NULL CHECK(length(CAST(reaction_args_json AS BLOB)) <= 65536),
  reaction_args_digest TEXT NOT NULL,
  webhook_url TEXT CHECK(webhook_url IS NULL OR length(CAST(webhook_url AS BLOB)) <= 2048),
  webhook_secret_ref TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'suspended', 'dead')),
  status_reason TEXT,
  notification_json TEXT,
  daily_firing_budget INTEGER NOT NULL CHECK(daily_firing_budget BETWEEN 1 AND 1000),
  budget_day INTEGER NOT NULL CHECK(budget_day BETWEEN 0 AND 9007199254740991),
  firings_today INTEGER NOT NULL DEFAULT 0 CHECK(firings_today BETWEEN 0 AND 1000),
  debounce_ms INTEGER NOT NULL CHECK(debounce_ms BETWEEN 5000 AND 2592000000),
  next_evaluation_at_ms INTEGER NOT NULL CHECK(next_evaluation_at_ms BETWEEN 0 AND 9007199254740991),
  pending_job_id TEXT,
  dirty_while_pending INTEGER NOT NULL DEFAULT 0 CHECK(dirty_while_pending IN (0, 1)),
  pending_firing_ordinal INTEGER,
  pending_firing_job_id TEXT,
  last_predicate_state INTEGER NOT NULL CHECK(last_predicate_state IN (0, 1)),
  evaluation_count INTEGER NOT NULL DEFAULT 0 CHECK(evaluation_count BETWEEN 0 AND 9007199254740991),
  coalesced_invalidation_count INTEGER NOT NULL DEFAULT 0 CHECK(coalesced_invalidation_count BETWEEN 0 AND 9007199254740991),
  firing_count INTEGER NOT NULL DEFAULT 0 CHECK(firing_count BETWEEN 0 AND 9007199254740991),
  journal_count INTEGER NOT NULL DEFAULT 0 CHECK(journal_count BETWEEN 0 AND 9007199254740991),
  last_evaluated_at_ms INTEGER,
  last_fired_at_ms INTEGER,
  last_firing_outcome TEXT,
  last_diagnostic_code TEXT,
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms BETWEEN created_at_ms AND 9007199254740991),
  CHECK((owner_kind = 'user' AND authority_mode = 'revalidatePrincipal'
           AND anchor_grant_id IS NULL AND installation_grant_id IS NULL)
     OR (owner_kind = 'integration' AND authority_mode = 'capturedGrant'
           AND anchor_grant_id IS NOT NULL AND installation_grant_id IS NOT NULL)),
  CHECK((reaction_kind = 'function' AND webhook_url IS NULL AND webhook_secret_ref IS NULL)
     OR (reaction_kind = 'webhook' AND webhook_url IS NOT NULL AND webhook_secret_ref IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS _snapback_watches_owner
  ON _snapback_watches(owner_principal_id, status, id);
CREATE INDEX IF NOT EXISTS _snapback_watches_active
  ON _snapback_watches(status, next_evaluation_at_ms, id);
CREATE TABLE IF NOT EXISTS _snapback_watch_firings (
  watch_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 9007199254740991),
  job_id TEXT NOT NULL,
  fired_at_ms INTEGER NOT NULL CHECK(fired_at_ms BETWEEN 0 AND 9007199254740991),
  outcome TEXT NOT NULL CHECK(length(CAST(outcome AS BLOB)) <= 64),
  diagnostic_code TEXT CHECK(length(CAST(diagnostic_code AS BLOB)) <= 128),
  PRIMARY KEY(watch_id, ordinal),
  FOREIGN KEY(watch_id) REFERENCES _snapback_watches(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS _snapback_watch_firings_recent
  ON _snapback_watch_firings(watch_id, ordinal DESC);
"#;

#[derive(Clone, Debug)]
pub struct CreateWatchRecord {
    pub id: String,
    pub owner_kind: WatchOwnerKind,
    pub owner_principal_id: String,
    pub owner_authority_instance_id: String,
    pub authority_mode: WatchAuthorityMode,
    pub anchor_grant_id: Option<String>,
    pub installation_grant_id: Option<String>,
    pub anchor_effective_user_id: Option<String>,
    pub anchor_scopes: Vec<crate::storage::auth_grants::ExactGrantScope>,
    pub anchor_expires_at_ms: u64,
    pub query_function_id: String,
    pub query_function_name: String,
    pub query_basis: u64,
    pub query_args_json: String,
    pub query_args_digest: String,
    pub read_dependencies: Vec<CapturedReadDependency>,
    pub predicate_json: String,
    pub reaction_kind: WatchReactionKind,
    pub reaction_function_id: String,
    pub reaction_function_name: String,
    pub reaction_function_kind: WatchFunctionKind,
    pub reaction_basis: u64,
    pub reaction_args_json: String,
    pub reaction_args_digest: String,
    pub webhook_url: Option<String>,
    pub webhook_secret_ref: Option<String>,
    pub daily_firing_budget: u32,
    pub debounce_ms: u64,
    pub initial_predicate_state: bool,
    pub now_ms: u64,
}

#[derive(Clone, Debug)]
pub enum EvaluationDecision {
    NoFire,
    Fire { ordinal: u64 },
    SuspendedBudget,
    Stale,
}

#[derive(Clone, Debug)]
pub struct WatchAnchorAuthority {
    pub actor_user_id: String,
    pub effective_user_id: String,
    pub grant_id: String,
    pub scopes: Vec<crate::storage::auth_grants::ExactGrantScope>,
    pub expires_at_ms: u64,
    pub integration_status: crate::storage::auth_integrations::IntegrationStatus,
}

pub fn manifest_enabled(manifest: &SchemaManifest) -> bool {
    manifest.api.as_ref().is_some_and(|api| api.enabled)
}

/// @ref LLP 0204#d93--durable-watches-end-user-automations — watch state exists exactly while the
/// app's external API is activated; disabling that surface drops the catalog.
pub(crate) fn activate_manifest_in(
    tx: &Transaction<'_>,
    manifest: &SchemaManifest,
) -> SnapbackResult<()> {
    if !manifest_enabled(manifest) {
        tx.execute_batch(
            "DROP TABLE IF EXISTS _snapback_watch_firings;
             DROP TABLE IF EXISTS _snapback_watches;",
        )?;
        return Ok(());
    }
    tx.execute_batch(TABLE_SQL)?;
    validate_exact_schema(tx)
}

pub(super) fn validate_exact_schema(conn: &Connection) -> SnapbackResult<()> {
    let reference = Connection::open_in_memory()?;
    reference.execute_batch("PRAGMA foreign_keys = ON;")?;
    reference.execute_batch(TABLE_SQL)?;
    if catalog_objects(conn)? != catalog_objects(&reference)? {
        return Err(catalog_corrupt());
    }
    Ok(())
}

fn catalog_objects(conn: &Connection) -> SnapbackResult<Vec<(String, String, String, String)>> {
    let mut statement = conn.prepare(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_schema
         WHERE name IN ('_snapback_watches', '_snapback_watch_firings')
            OR tbl_name IN ('_snapback_watches', '_snapback_watch_firings')
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
            params![WATCH_TABLE],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn owner_kind_name(kind: WatchOwnerKind) -> &'static str {
    match kind {
        WatchOwnerKind::User => "user",
        WatchOwnerKind::Integration => "integration",
    }
}

fn authority_mode_name(mode: WatchAuthorityMode) -> &'static str {
    match mode {
        WatchAuthorityMode::CapturedGrant => "capturedGrant",
        WatchAuthorityMode::RevalidatePrincipal => "revalidatePrincipal",
    }
}

impl LocalDatabase {
    pub fn create_watch(&mut self, request: CreateWatchRecord) -> SnapbackResult<WatchRecord> {
        self.create_watch_guarded(request, || Ok(()))
    }

    /// Commit the watch row and optional exact anchor grant beneath the
    /// caller's final commit guard. Secret preparation and the initial query
    /// remain outside this transaction and outside the guard.
    ///
    /// @ref LLP 0058#split-phase-authorized-effect-fence — session or scoped
    /// integration management authority is reserved before Local.
    pub fn create_watch_guarded<G, BeforeCommit>(
        &mut self,
        request: CreateWatchRecord,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<WatchRecord>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        if !table_exists(&self.conn)? {
            return Err(SnapbackError::error(
                "SNAPBACK_API_NOT_ENABLED",
                "watches",
                "durable watches require manifest api.enabled",
            ));
        }
        let dependencies_json =
            serde_json::to_string(&request.read_dependencies).map_err(|_| catalog_corrupt())?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if request.owner_kind == WatchOwnerKind::Integration {
            mint_watch_anchor_on(&tx, &request)?;
        } else if request.anchor_effective_user_id.is_some() || !request.anchor_scopes.is_empty() {
            return Err(catalog_corrupt());
        }
        tx.execute(
            "INSERT INTO _snapback_watches (
               id, owner_kind, owner_principal_id, owner_authority_instance_id,
               authority_mode, anchor_grant_id, installation_grant_id, anchor_expires_at_ms,
               query_function_id, query_function_name, query_basis, query_args_json,
               query_args_digest, read_dependencies_json, predicate_json,
               reaction_kind, reaction_function_id, reaction_function_name,
               reaction_function_kind, reaction_basis, reaction_args_json,
               reaction_args_digest, webhook_url, webhook_secret_ref,
               status, status_reason, notification_json,
               daily_firing_budget, budget_day, firings_today, debounce_ms,
               next_evaluation_at_ms, pending_job_id, dirty_while_pending,
               pending_firing_ordinal, pending_firing_job_id, last_predicate_state,
               evaluation_count, coalesced_invalidation_count, firing_count,
               journal_count, last_evaluated_at_ms, last_fired_at_ms,
               last_firing_outcome, last_diagnostic_code, created_at_ms, updated_at_ms
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
               ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24,
               'active', NULL, NULL, ?25, ?26, 0, ?27, ?28, NULL, 0, NULL, NULL,
               ?29, 0, 0, 0, 0, NULL, NULL, NULL, NULL, ?28, ?28)",
            params![
                request.id,
                owner_kind_name(request.owner_kind),
                request.owner_principal_id,
                request.owner_authority_instance_id,
                authority_mode_name(request.authority_mode),
                request.anchor_grant_id,
                request.installation_grant_id,
                request.anchor_expires_at_ms,
                request.query_function_id,
                request.query_function_name,
                request.query_basis,
                request.query_args_json,
                request.query_args_digest,
                dependencies_json,
                request.predicate_json,
                request.reaction_kind.as_str(),
                request.reaction_function_id,
                request.reaction_function_name,
                request.reaction_function_kind.as_str(),
                request.reaction_basis,
                request.reaction_args_json,
                request.reaction_args_digest,
                request.webhook_url,
                request.webhook_secret_ref,
                request.daily_firing_budget,
                crate::watches::utc_day(request.now_ms),
                request.debounce_ms,
                request.now_ms,
                i64::from(request.initial_predicate_state),
            ],
        )?;
        #[cfg(any(test, feature = "test-support"))]
        super::observe_durable_commit_for_test();
        let _commit_guard = before_commit()?;
        tx.commit()?;
        self.watch_for_owner(&request.id, &request.owner_principal_id)?
            .ok_or_else(catalog_corrupt)
    }

    pub fn list_watches_for_owner(&self, owner: &str) -> SnapbackResult<Vec<WatchRecord>> {
        if !table_exists(&self.conn)? {
            return Ok(Vec::new());
        }
        let mut statement = self.conn.prepare(
            "SELECT id FROM _snapback_watches WHERE owner_principal_id = ?1 ORDER BY created_at_ms, id",
        )?;
        let ids = statement
            .query_map(params![owner], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids.into_iter()
            .map(|id| row_for_id_on(&self.conn, &id)?.ok_or_else(catalog_corrupt))
            .collect()
    }

    pub fn watch_for_owner(&self, id: &str, owner: &str) -> SnapbackResult<Option<WatchRecord>> {
        let record = row_for_id_on(&self.conn, id)?;
        match record {
            Some(record) if record.owner_principal_id == owner => Ok(Some(record)),
            Some(_) => Err(SnapbackError::error(
                "SNAPBACK_WATCH_OWNER_DENIED",
                "watches",
                "the watch belongs to a different owner",
            )),
            None => Ok(None),
        }
    }

    pub fn active_watches(&self) -> SnapbackResult<Vec<WatchRecord>> {
        if !table_exists(&self.conn)? {
            return Ok(Vec::new());
        }
        let mut statement = self
            .conn
            .prepare("SELECT id FROM _snapback_watches WHERE status = 'active' ORDER BY id")?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids.into_iter()
            .map(|id| row_for_id_on(&self.conn, &id)?.ok_or_else(catalog_corrupt))
            .collect()
    }

    pub fn watch_for_execution(&self, id: &str) -> SnapbackResult<Option<WatchRecord>> {
        row_for_id_on(&self.conn, id)
    }

    pub fn watch_owner_is_active(&self, owner: &str) -> SnapbackResult<bool> {
        Ok(self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM _auth_users
             WHERE id = ?1 AND kind = 'human' AND deactivated_at_ms IS NULL)",
            params![owner],
            |row| row.get::<_, i64>(0),
        )? != 0)
    }

    /// Reload the watchAnchor, its parent installation consent, integration
    /// admission, and every exact scope basis in one protected read cut.
    ///
    /// @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08
    /// — captured watch authority is credential-free but never
    /// revalidation-free: no wildcard or stale installation survives.
    pub fn revalidate_watch_anchor(
        &mut self,
        record: &WatchRecord,
        now_ms: u64,
    ) -> SnapbackResult<Option<WatchAnchorAuthority>> {
        if record.owner_kind != WatchOwnerKind::Integration {
            return Ok(None);
        }
        let Some(anchor_grant_id) = record.anchor_grant_id.as_deref() else {
            return Err(catalog_corrupt());
        };
        let Some(installation_grant_id) = record.installation_grant_id.as_deref() else {
            return Err(catalog_corrupt());
        };
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let integration = match super::auth_integrations::require_active_if_integration_on(
            &tx,
            &record.owner_principal_id,
        ) {
            Ok(Some(integration_record))
                if integration_record.integration_id == record.owner_authority_instance_id =>
            {
                integration_record
            }
            Ok(_) | Err(_) => return Ok(None),
        };
        if super::auth_integrations::require_installation_grant_if_integration_on(
            &tx,
            &record.owner_principal_id,
            installation_grant_id,
        )
        .is_err()
        {
            return Ok(None);
        }
        let installation_live = tx
            .query_row(
                "SELECT revoked_at_ms IS NULL AND expires_at_ms > ?1
             FROM _auth_grants WHERE id = ?2 AND actor_user_id = ?3",
                params![now_ms, installation_grant_id, record.owner_principal_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?
            .unwrap_or(false);
        if !installation_live {
            return Ok(None);
        }
        let anchor = tx
            .query_row(
                "SELECT actor_user_id, effective_user_id, scopes, expires_at_ms,
                    revoked_at_ms, created_by, consent_digest
             FROM _auth_grants WHERE id = ?1",
                params![anchor_grant_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, u64>(3)?,
                        row.get::<_, Option<u64>>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, Vec<u8>>(6)?,
                    ))
                },
            )
            .optional()?;
        let Some((actor, effective, encoded, expires_at_ms, revoked, created_by, digest)) = anchor
        else {
            return Ok(None);
        };
        if actor != record.owner_principal_id
            || revoked.is_some()
            || expires_at_ms <= now_ms
            || expires_at_ms != record.anchor_expires_at_ms
            || created_by != format!("watchAnchor:{}", record.id)
        {
            return Ok(None);
        }
        let scopes = super::auth_grants::current_grant_scopes_on(&tx, &encoded)?;
        if !anchor_scopes_cover_record(&scopes, record)
            || digest.as_slice() != watch_anchor_digest(record, &effective, &encoded)?.as_slice()
        {
            return Ok(None);
        }
        tx.commit()?;
        Ok(Some(WatchAnchorAuthority {
            actor_user_id: actor,
            effective_user_id: effective,
            grant_id: anchor_grant_id.to_owned(),
            scopes,
            expires_at_ms,
            integration_status: integration.status,
        }))
    }

    pub fn renew_watch_anchor_for_user(
        &mut self,
        id: &str,
        effective_user_id: &str,
        ttl_ms: u64,
        now_ms: u64,
    ) -> SnapbackResult<WatchRecord> {
        if ttl_ms == 0 || ttl_ms > crate::watches::RENEWAL_CEILING_MS {
            return Err(SnapbackError::error(
                "SNAPBACK_WATCH_RENEWAL_INVALID",
                "watches",
                "watchAnchor renewal must be positive and no more than 365 days",
            ));
        }
        let record = row_for_id_on(&self.conn, id)?.ok_or_else(watch_not_found)?;
        if record.owner_kind != WatchOwnerKind::Integration || record.status == WatchStatus::Dead {
            return Err(SnapbackError::error(
                "SNAPBACK_WATCH_RENEWAL_DENIED",
                "watches",
                "only a live integration watch's consenting user can renew its anchor",
            ));
        }
        let anchor = self
            .revalidate_watch_anchor(&record, now_ms)?
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_WATCH_AUTHORITY_DEAD",
                    "watches",
                    "watchAnchor is no longer renewable",
                )
            })?;
        if anchor.effective_user_id != effective_user_id {
            return Err(SnapbackError::error(
                "SNAPBACK_WATCH_RENEWAL_DENIED",
                "watches",
                "the current session did not grant this watchAnchor",
            ));
        }
        let expires_at_ms = now_ms
            .checked_add(ttl_ms)
            .filter(|value| *value <= 9_007_199_254_740_991)
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_WATCH_RENEWAL_INVALID",
                    "watches",
                    "renewal expiry overflows portable time",
                )
            })?;
        let old_grant_id = record
            .anchor_grant_id
            .as_deref()
            .ok_or_else(catalog_corrupt)?;
        let new_grant_id = crate::ids::mint_time_ordered(crate::ids::Kind::Grant);
        let encoded = super::auth_grants::canonical_scopes_json(&anchor.scopes)?;
        let digest = anchor_binding_digest(
            &record.id,
            effective_user_id,
            &encoded,
            &record.query_args_digest,
            &record.reaction_args_digest,
            record.webhook_url.as_deref(),
            record
                .installation_grant_id
                .as_deref()
                .ok_or_else(catalog_corrupt)?,
            expires_at_ms,
        )?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = tx.execute(
            "UPDATE _auth_grants SET revoked_at_ms = ?1
             WHERE id = ?2 AND effective_user_id = ?3 AND revoked_at_ms IS NULL
               AND expires_at_ms > ?1",
            params![now_ms, old_grant_id, effective_user_id],
        )?;
        if changed != 1 {
            return Err(SnapbackError::error(
                "SNAPBACK_WATCH_AUTHORITY_DEAD",
                "watches",
                "watchAnchor ended during renewal",
            ));
        }
        tx.execute(
            "INSERT INTO _auth_grants(
               id, actor_user_id, effective_user_id, scopes, created_at_ms,
               expires_at_ms, revoked_at_ms, created_by, request_id,
               consent_digest, last_used_at_ms
             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, NULL, ?8, ?5)",
            params![
                new_grant_id,
                record.owner_principal_id,
                effective_user_id,
                encoded,
                now_ms,
                expires_at_ms,
                format!("watchAnchor:{}", record.id),
                digest.as_slice(),
            ],
        )?;
        tx.execute(
            "UPDATE _snapback_watches SET anchor_grant_id = ?1,
             anchor_expires_at_ms = ?2, updated_at_ms = ?3 WHERE id = ?4",
            params![new_grant_id, expires_at_ms, now_ms, id],
        )?;
        tx.commit()?;
        row_for_id_on(&self.conn, id)?.ok_or_else(catalog_corrupt)
    }

    pub fn transition_watch(
        &mut self,
        id: &str,
        owner: &str,
        target: WatchStatus,
        now_ms: u64,
    ) -> SnapbackResult<WatchRecord> {
        let current = self
            .watch_for_owner(id, owner)?
            .ok_or_else(watch_not_found)?;
        let allowed = matches!(
            (current.status, target),
            (WatchStatus::Active, WatchStatus::Suspended)
                | (WatchStatus::Suspended, WatchStatus::Active)
                | (
                    WatchStatus::Active | WatchStatus::Suspended,
                    WatchStatus::Dead
                )
        );
        if !allowed {
            return Err(SnapbackError::error(
                "SNAPBACK_WATCH_STATUS_INVALID",
                "watches",
                "the requested watch state transition is not allowed",
            ));
        }
        let reason = match target {
            WatchStatus::Suspended => Some("owner_suspended"),
            WatchStatus::Dead => Some("owner_deleted"),
            WatchStatus::Active => None,
        };
        self.conn.execute(
            "UPDATE _snapback_watches SET status = ?1, status_reason = ?2,
             notification_json = CASE WHEN ?1 = 'active' THEN NULL ELSE notification_json END,
             pending_job_id = NULL, dirty_while_pending = 0,
             pending_firing_ordinal = NULL, pending_firing_job_id = NULL,
             updated_at_ms = ?3 WHERE id = ?4 AND owner_principal_id = ?5",
            params![target.as_str(), reason, now_ms, id, owner],
        )?;
        row_for_id_on(&self.conn, id)?.ok_or_else(catalog_corrupt)
    }

    /// Enqueue exactly one evaluation job, or fold a new invalidation into the
    /// existing durable pending bit. The watch update and LLP 0070 enqueue are
    /// one SQLite transaction.
    ///
    /// @ref LLP 0204#d93--durable-watches-end-user-automations — invalidations wake durable work;
    /// the five-second floor coalesces storms without a polling loop.
    pub fn schedule_watch_evaluation(&mut self, id: &str, now_ms: u64) -> SnapbackResult<bool> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let state = tx
            .query_row(
                "SELECT pending_job_id, next_evaluation_at_ms, status
                 FROM _snapback_watches WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, u64>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((pending, next_at, status)) = state else {
            tx.commit()?;
            return Ok(false);
        };
        if status != "active" {
            tx.commit()?;
            return Ok(false);
        }
        if pending.is_some() {
            tx.execute(
                "UPDATE _snapback_watches SET dirty_while_pending = 1,
                 coalesced_invalidation_count = coalesced_invalidation_count + 1,
                 updated_at_ms = ?1 WHERE id = ?2",
                params![now_ms, id],
            )?;
            tx.commit()?;
            return Ok(false);
        }
        enqueue_on(&tx, id, now_ms, now_ms.max(next_at))?;
        tx.commit()?;
        Ok(true)
    }

    pub fn begin_watch_evaluation(
        &mut self,
        id: &str,
        job_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<Option<WatchRecord>> {
        let record = row_for_id_on(&self.conn, id)?;
        let Some(record) = record else {
            return Ok(None);
        };
        if record.status != WatchStatus::Active || record.pending_job_id.as_deref() != Some(job_id)
        {
            return Ok(None);
        }
        if now_ms >= record.anchor_expires_at_ms {
            self.mark_watch_dead(
                id,
                "anchor_expired",
                "SNAPBACK_WATCH_AUTHORITY_DEAD",
                now_ms,
            )?;
            return Ok(None);
        }
        self.conn.execute(
            "UPDATE _snapback_watches SET dirty_while_pending = 0, updated_at_ms = ?1 WHERE id = ?2",
            params![now_ms, id],
        )?;
        row_for_id_on(&self.conn, id)
    }

    pub fn decide_watch_evaluation(
        &mut self,
        id: &str,
        job_id: &str,
        predicate_state: bool,
        dependencies: &[CapturedReadDependency],
        now_ms: u64,
    ) -> SnapbackResult<EvaluationDecision> {
        let dependencies_json =
            serde_json::to_string(dependencies).map_err(|_| catalog_corrupt())?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let state = tx
            .query_row(
                "SELECT status, pending_job_id, last_predicate_state, daily_firing_budget,
                        budget_day, firings_today, journal_count
                 FROM _snapback_watches WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, u32>(3)?,
                        row.get::<_, u64>(4)?,
                        row.get::<_, u32>(5)?,
                        row.get::<_, u64>(6)?,
                    ))
                },
            )
            .optional()?;
        let Some((status, pending, previous, budget, budget_day, firings_today, journal_count)) =
            state
        else {
            tx.commit()?;
            return Ok(EvaluationDecision::Stale);
        };
        if status != "active" || pending.as_deref() != Some(job_id) {
            tx.commit()?;
            return Ok(EvaluationDecision::Stale);
        }
        let today = crate::watches::utc_day(now_ms);
        let current_firings = if budget_day == today {
            firings_today
        } else {
            0
        };
        let edge = previous == 0 && predicate_state;
        tx.execute(
            "UPDATE _snapback_watches SET read_dependencies_json = ?1,
             last_predicate_state = ?2, evaluation_count = evaluation_count + 1,
             last_evaluated_at_ms = ?3, next_evaluation_at_ms = ?4,
             budget_day = ?5, firings_today = ?6, updated_at_ms = ?3
             WHERE id = ?7",
            params![
                dependencies_json,
                i64::from(predicate_state),
                now_ms,
                now_ms.saturating_add(tx.query_row(
                    "SELECT debounce_ms FROM _snapback_watches WHERE id = ?1",
                    params![id],
                    |row| row.get::<_, u64>(0)
                )?),
                today,
                current_firings,
                id
            ],
        )?;
        // @ref LLP 0204#open-questions — OQ10 makes budget exhaustion a
        // visible suspension and journal fact, never a silent dropped firing.
        if edge && current_firings >= budget {
            let ordinal = journal_count.saturating_add(1);
            let notification = json!({
                "kind": "watchSuspended",
                "reason": "dailyFiringBudgetExhausted",
                "atMs": now_ms,
                "dailyFiringBudget": budget,
            });
            tx.execute(
                "UPDATE _snapback_watches SET status = 'suspended',
                 status_reason = 'daily_firing_budget_exhausted', notification_json = ?1,
                 pending_job_id = NULL, dirty_while_pending = 0,
                 last_firing_outcome = 'budget_suspended',
                 last_diagnostic_code = 'SNAPBACK_WATCH_BUDGET_EXHAUSTED',
                 journal_count = ?2, updated_at_ms = ?3 WHERE id = ?4",
                params![notification.to_string(), ordinal, now_ms, id],
            )?;
            insert_firing(
                &tx,
                id,
                ordinal,
                job_id,
                now_ms,
                "budget_suspended",
                Some("SNAPBACK_WATCH_BUDGET_EXHAUSTED"),
            )?;
            trim_firings(&tx, id)?;
            tx.commit()?;
            return Ok(EvaluationDecision::SuspendedBudget);
        }
        if edge {
            let ordinal = journal_count.saturating_add(1);
            tx.execute(
                "UPDATE _snapback_watches SET firings_today = ?1,
                 firing_count = firing_count + 1, journal_count = ?2,
                 pending_firing_ordinal = ?2, pending_firing_job_id = ?3,
                 last_fired_at_ms = ?4, last_firing_outcome = 'admitted',
                 last_diagnostic_code = NULL, updated_at_ms = ?4 WHERE id = ?5",
                params![
                    current_firings.saturating_add(1),
                    ordinal,
                    job_id,
                    now_ms,
                    id
                ],
            )?;
            insert_firing(&tx, id, ordinal, job_id, now_ms, "admitted", None)?;
            trim_firings(&tx, id)?;
            tx.commit()?;
            return Ok(EvaluationDecision::Fire { ordinal });
        }
        finish_without_fire_on(&tx, id, job_id, now_ms, "evaluated", None)?;
        tx.commit()?;
        Ok(EvaluationDecision::NoFire)
    }

    pub fn finish_watch_evaluation_failure(
        &mut self,
        id: &str,
        job_id: &str,
        code: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        finish_without_fire_on(&tx, id, job_id, now_ms, "evaluation_failed", Some(code))?;
        tx.commit()?;
        Ok(())
    }

    pub fn record_watch_evaluation_retry(
        &mut self,
        id: &str,
        job_id: &str,
        code: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.conn.execute(
            "UPDATE _snapback_watches SET last_firing_outcome = 'evaluation_retrying',
             last_diagnostic_code = ?1, updated_at_ms = ?2
             WHERE id = ?3 AND pending_job_id = ?4",
            params![code, now_ms, id, job_id],
        )?;
        Ok(())
    }

    pub fn record_watch_firing_retry(
        &mut self,
        id: &str,
        job_id: &str,
        ordinal: u64,
        code: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "UPDATE _snapback_watch_firings SET outcome = 'retrying', diagnostic_code = ?1
             WHERE watch_id = ?2 AND ordinal = ?3 AND job_id = ?4",
            params![code, id, ordinal, job_id],
        )?;
        tx.execute(
            "UPDATE _snapback_watches SET last_firing_outcome = 'retrying',
             last_diagnostic_code = ?1, updated_at_ms = ?2
             WHERE id = ?3 AND pending_job_id = ?4
               AND pending_firing_ordinal = ?5 AND pending_firing_job_id = ?4",
            params![code, now_ms, id, job_id, ordinal],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn settle_watch_firing(
        &mut self,
        id: &str,
        job_id: &str,
        ordinal: u64,
        outcome: &str,
        diagnostic_code: Option<&str>,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let matches: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM _snapback_watches
             WHERE id = ?1 AND pending_job_id = ?2 AND pending_firing_job_id = ?2
               AND pending_firing_ordinal = ?3)",
            params![id, job_id, ordinal],
            |row| row.get::<_, i64>(0),
        )? != 0;
        if !matches {
            tx.commit()?;
            return Ok(());
        }
        tx.execute(
            "UPDATE _snapback_watch_firings SET outcome = ?1, diagnostic_code = ?2
             WHERE watch_id = ?3 AND ordinal = ?4",
            params![outcome, diagnostic_code, id, ordinal],
        )?;
        tx.execute(
            "UPDATE _snapback_watches SET pending_firing_ordinal = NULL,
             pending_firing_job_id = NULL, last_firing_outcome = ?1,
             last_diagnostic_code = ?2, updated_at_ms = ?3 WHERE id = ?4",
            params![outcome, diagnostic_code, now_ms, id],
        )?;
        finish_without_fire_on(&tx, id, job_id, now_ms, outcome, diagnostic_code)?;
        tx.commit()?;
        Ok(())
    }

    pub fn mark_watch_dead(
        &mut self,
        id: &str,
        reason: &str,
        diagnostic_code: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        let notification = json!({
            "kind": "watchDead",
            "reason": reason,
            "atMs": now_ms,
            "diagnosticCode": diagnostic_code,
        });
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "UPDATE _snapback_watch_firings SET outcome = 'dead', diagnostic_code = ?1
             WHERE watch_id = ?2 AND ordinal = (
               SELECT pending_firing_ordinal FROM _snapback_watches WHERE id = ?2
             ) AND job_id = (
               SELECT pending_firing_job_id FROM _snapback_watches WHERE id = ?2
             )",
            params![diagnostic_code, id],
        )?;
        tx.execute(
            "UPDATE _snapback_watches SET status = 'dead', status_reason = ?1,
             notification_json = ?2, pending_job_id = NULL, dirty_while_pending = 0,
             pending_firing_ordinal = NULL, pending_firing_job_id = NULL,
             last_firing_outcome = 'dead', last_diagnostic_code = ?3,
            updated_at_ms = ?4 WHERE id = ?5",
            params![
                reason,
                notification.to_string(),
                diagnostic_code,
                now_ms,
                id
            ],
        )?;
        tx.commit()?;
        Ok(())
    }
}

fn mint_watch_anchor_on(tx: &Transaction<'_>, request: &CreateWatchRecord) -> SnapbackResult<()> {
    let anchor_grant_id = request
        .anchor_grant_id
        .as_deref()
        .ok_or_else(catalog_corrupt)?;
    let installation_grant_id = request
        .installation_grant_id
        .as_deref()
        .ok_or_else(catalog_corrupt)?;
    let effective_user_id = request
        .anchor_effective_user_id
        .as_deref()
        .ok_or_else(catalog_corrupt)?;
    let integration = super::auth_integrations::require_active_if_integration_on(
        tx,
        &request.owner_principal_id,
    )?
    .ok_or_else(|| anchor_scope_mismatch("watch owner is not an active integration"))?;
    if integration.integration_id != request.owner_authority_instance_id {
        return Err(anchor_scope_mismatch("integration record binding changed"));
    }
    super::auth_integrations::require_installation_grant_if_integration_on(
        tx,
        &request.owner_principal_id,
        installation_grant_id,
    )?;
    let (
        installation_effective,
        installation_scopes_json,
        installation_expires,
        installation_revoked,
    ) = tx
        .query_row(
            "SELECT effective_user_id, scopes, expires_at_ms, revoked_at_ms
             FROM _auth_grants WHERE id = ?1 AND actor_user_id = ?2",
            params![installation_grant_id, request.owner_principal_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, Option<u64>>(3)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| anchor_scope_mismatch("installation grant is unavailable"))?;
    if installation_effective != effective_user_id
        || installation_revoked.is_some()
        || installation_expires <= request.now_ms
    {
        return Err(anchor_scope_mismatch(
            "installation consent is no longer live",
        ));
    }
    let mut anchor_scopes = request.anchor_scopes.clone();
    anchor_scopes.sort();
    anchor_scopes.dedup();
    if anchor_scopes.is_empty() || anchor_scopes != request.anchor_scopes {
        return Err(anchor_scope_mismatch(
            "watchAnchor scopes must be sorted, unique, and non-empty",
        ));
    }
    let installation_scopes =
        super::auth_grants::current_grant_scopes_on(tx, &installation_scopes_json)?;
    if anchor_scopes
        .iter()
        .any(|scope| !installation_scopes.contains(scope))
    {
        return Err(anchor_scope_mismatch(
            "installation grant does not cover the watch scope",
        ));
    }
    if !request_scopes_cover_watch(&anchor_scopes, request) {
        return Err(anchor_scope_mismatch(
            "watchAnchor does not exactly cover query and reaction",
        ));
    }
    let encoded = super::auth_grants::canonical_scopes_json(&anchor_scopes)?;
    let live_actor: u64 = tx.query_row(
        "SELECT COUNT(*) FROM _auth_grants WHERE actor_user_id = ?1
         AND revoked_at_ms IS NULL AND (expires_at_ms IS NULL OR expires_at_ms > ?2)",
        params![request.owner_principal_id, request.now_ms],
        |row| row.get(0),
    )?;
    let live_effective: u64 = tx.query_row(
        "SELECT COUNT(*) FROM _auth_grants WHERE effective_user_id = ?1
         AND revoked_at_ms IS NULL AND expires_at_ms > ?2",
        params![effective_user_id, request.now_ms],
        |row| row.get(0),
    )?;
    if live_actor >= crate::storage::auth_grants::GRANT_LIVE_CAP_PER_ACTOR
        || live_effective >= crate::storage::auth_grants::DELEGATED_GRANT_LIVE_CAP_PER_USER
    {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_GRANT_CAP",
            "auth",
            "live grant capacity is exhausted",
        ));
    }
    let digest = watch_anchor_request_digest(request, effective_user_id, &encoded)?;
    tx.execute(
        "INSERT INTO _auth_grants(
           id, actor_user_id, effective_user_id, scopes, created_at_ms,
           expires_at_ms, revoked_at_ms, created_by, request_id,
           consent_digest, last_used_at_ms
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, NULL, ?8, ?5)",
        params![
            anchor_grant_id,
            request.owner_principal_id,
            effective_user_id,
            encoded,
            request.now_ms,
            request.anchor_expires_at_ms,
            format!("watchAnchor:{}", request.id),
            digest.as_slice(),
        ],
    )?;
    Ok(())
}

fn request_scopes_cover_watch(
    scopes: &[crate::storage::auth_grants::ExactGrantScope],
    request: &CreateWatchRecord,
) -> bool {
    let expected_count = if request.reaction_kind == WatchReactionKind::Function {
        2
    } else {
        1
    };
    scopes.len() == expected_count
        && scopes.iter().any(|scope| {
            scope.function_id == request.query_function_id
                && scope.kind == crate::storage::auth_grants::ScopedFunctionKind::LiveQuery
                && scope.basis == request.query_basis
        })
        && (request.reaction_kind == WatchReactionKind::Webhook
            || scopes.iter().any(|scope| {
                scope.function_id == request.reaction_function_id
                    && scoped_kind_matches_watch(scope.kind, request.reaction_function_kind)
                    && scope.basis == request.reaction_basis
            }))
}

fn anchor_scopes_cover_record(
    scopes: &[crate::storage::auth_grants::ExactGrantScope],
    record: &WatchRecord,
) -> bool {
    let expected_count = if record.reaction_kind == WatchReactionKind::Function {
        2
    } else {
        1
    };
    scopes.len() == expected_count
        && scopes.iter().any(|scope| {
            scope.function_id == record.query_function_id
                && scope.kind == crate::storage::auth_grants::ScopedFunctionKind::LiveQuery
                && scope.basis == record.query_basis
        })
        && (record.reaction_kind == WatchReactionKind::Webhook
            || scopes.iter().any(|scope| {
                scope.function_id == record.reaction_function_id
                    && scoped_kind_matches_watch(scope.kind, record.reaction_function_kind)
                    && scope.basis == record.reaction_basis
            }))
}

fn watch_anchor_request_digest(
    request: &CreateWatchRecord,
    effective_user_id: &str,
    scopes_json: &str,
) -> SnapbackResult<[u8; 32]> {
    anchor_binding_digest(
        &request.id,
        effective_user_id,
        scopes_json,
        &request.query_args_digest,
        &request.reaction_args_digest,
        request.webhook_url.as_deref(),
        request
            .installation_grant_id
            .as_deref()
            .ok_or_else(catalog_corrupt)?,
        request.anchor_expires_at_ms,
    )
}

fn watch_anchor_digest(
    record: &WatchRecord,
    effective_user_id: &str,
    scopes_json: &str,
) -> SnapbackResult<[u8; 32]> {
    anchor_binding_digest(
        &record.id,
        effective_user_id,
        scopes_json,
        &record.query_args_digest,
        &record.reaction_args_digest,
        record.webhook_url.as_deref(),
        record
            .installation_grant_id
            .as_deref()
            .ok_or_else(catalog_corrupt)?,
        record.anchor_expires_at_ms,
    )
}

#[allow(clippy::too_many_arguments)] // established internal signature; regrouping is out of scope for the lint sweep
fn anchor_binding_digest(
    watch_id: &str,
    effective_user_id: &str,
    scopes_json: &str,
    query_args_digest: &str,
    reaction_digest: &str,
    webhook_url: Option<&str>,
    installation_grant_id: &str,
    expires_at_ms: u64,
) -> SnapbackResult<[u8; 32]> {
    let encoded = serde_json::to_vec(&json!({
        "profile": "watchAnchor.v1",
        "watchId": watch_id,
        "effectiveUserId": effective_user_id,
        "scopes": serde_json::from_str::<Value>(scopes_json).map_err(|_| catalog_corrupt())?,
        "queryArgsDigest": query_args_digest,
        "reactionDigest": reaction_digest,
        "webhookUrl": webhook_url,
        "installationGrantId": installation_grant_id,
        "expiresAtMs": expires_at_ms,
    }))
    .map_err(|_| catalog_corrupt())?;
    Ok(Sha256::digest(encoded).into())
}

fn anchor_scope_mismatch(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_WATCH_ANCHOR_SCOPE_MISMATCH", "watches", message)
}

fn scoped_kind_matches_watch(
    scoped: crate::storage::auth_grants::ScopedFunctionKind,
    watch: WatchFunctionKind,
) -> bool {
    matches!(
        (scoped, watch),
        (
            crate::storage::auth_grants::ScopedFunctionKind::Query,
            WatchFunctionKind::Query
        ) | (
            crate::storage::auth_grants::ScopedFunctionKind::Mutation,
            WatchFunctionKind::Mutation
        ) | (
            crate::storage::auth_grants::ScopedFunctionKind::Action,
            WatchFunctionKind::Action
        )
    )
}

pub(super) fn mark_watches_dead_for_grant_on(
    tx: &Transaction<'_>,
    grant_id: &str,
    now_ms: u64,
) -> SnapbackResult<()> {
    if !table_exists(tx)? {
        return Ok(());
    }
    let notification = json!({
        "kind": "watchDead",
        "reason": "grantRevoked",
        "atMs": now_ms,
        "diagnosticCode": "SNAPBACK_WATCH_AUTHORITY_DEAD",
    });
    tx.execute(
        "UPDATE _snapback_watches SET status = 'dead', status_reason = 'grant_revoked',
         notification_json = ?1, pending_job_id = NULL, dirty_while_pending = 0,
         pending_firing_ordinal = NULL, pending_firing_job_id = NULL,
         last_firing_outcome = 'dead', last_diagnostic_code = 'SNAPBACK_WATCH_AUTHORITY_DEAD',
         updated_at_ms = MAX(updated_at_ms, ?2)
         WHERE status != 'dead' AND (anchor_grant_id = ?3 OR installation_grant_id = ?3)",
        params![notification.to_string(), now_ms, grant_id],
    )?;
    Ok(())
}

fn enqueue_on(
    conn: &Connection,
    watch_id: &str,
    enqueued_at_ms: u64,
    available_at_ms: u64,
) -> SnapbackResult<()> {
    // @ref LLP 0070#job-identity-and-enqueue — watch evaluation is an
    // ordinary durable queued intent with immutable args and attempt receipts.
    let job_id = crate::ids::mint_time_ordered(crate::ids::Kind::Job);
    let enqueue = BufferedJobEnqueue {
        job_id: job_id.clone(),
        queue: super::jobs::JOBS_DEFAULT_QUEUE.to_owned(),
        action: INTERNAL_EVALUATION_ACTION.to_owned(),
        args: json!({ "watchId": watch_id }),
        idempotency_key: Some(format!("watch:{watch_id}:{job_id}")),
        max_attempts: super::jobs::JOBS_MAX_ATTEMPTS_CEILING,
        available_at_ms,
        push_grant: None,
        rehearsal_provenance: None,
    };
    super::jobs::insert_enqueued_jobs_in_tx(
        conn,
        &JobProducer {
            mutation_id: format!("watch:{watch_id}"),
            function: INTERNAL_EVALUATION_ACTION.to_owned(),
            principal: None,
        },
        0,
        &[enqueue],
        enqueued_at_ms,
    )?;
    conn.execute(
        "UPDATE _snapback_watches SET pending_job_id = ?1, dirty_while_pending = 0,
         updated_at_ms = MAX(updated_at_ms, ?2) WHERE id = ?3 AND status = 'active'",
        params![job_id, enqueued_at_ms, watch_id],
    )?;
    Ok(())
}

fn finish_without_fire_on(
    conn: &Connection,
    id: &str,
    job_id: &str,
    now_ms: u64,
    outcome: &str,
    diagnostic_code: Option<&str>,
) -> SnapbackResult<()> {
    let dirty: bool = conn
        .query_row(
            "SELECT dirty_while_pending FROM _snapback_watches
             WHERE id = ?1 AND pending_job_id = ?2",
            params![id, job_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some_and(|dirty| dirty != 0);
    conn.execute(
        "UPDATE _snapback_watches SET pending_job_id = NULL, dirty_while_pending = 0,
         last_firing_outcome = ?1, last_diagnostic_code = ?2, updated_at_ms = ?3
         WHERE id = ?4 AND pending_job_id = ?5",
        params![outcome, diagnostic_code, now_ms, id, job_id],
    )?;
    if dirty {
        let next_at = conn.query_row(
            "SELECT next_evaluation_at_ms FROM _snapback_watches WHERE id = ?1 AND status = 'active'",
            params![id],
            |row| row.get::<_, u64>(0),
        ).optional()?;
        if let Some(next_at) = next_at {
            enqueue_on(conn, id, now_ms, now_ms.max(next_at))?;
        }
    }
    Ok(())
}

fn insert_firing(
    conn: &Connection,
    id: &str,
    ordinal: u64,
    job_id: &str,
    now_ms: u64,
    outcome: &str,
    diagnostic_code: Option<&str>,
) -> SnapbackResult<()> {
    conn.execute(
        "INSERT INTO _snapback_watch_firings
         (watch_id, ordinal, job_id, fired_at_ms, outcome, diagnostic_code)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, ordinal, job_id, now_ms, outcome, diagnostic_code],
    )?;
    Ok(())
}

fn trim_firings(conn: &Connection, id: &str) -> SnapbackResult<()> {
    conn.execute(
        "DELETE FROM _snapback_watch_firings WHERE watch_id = ?1 AND ordinal NOT IN (
           SELECT ordinal FROM _snapback_watch_firings WHERE watch_id = ?1
           ORDER BY ordinal DESC LIMIT ?2
         )",
        params![id, FIRING_JOURNAL_LIMIT],
    )?;
    Ok(())
}

fn row_for_id_on(conn: &Connection, id: &str) -> SnapbackResult<Option<WatchRecord>> {
    let raw = conn
        .query_row(
            "SELECT owner_kind, owner_principal_id, owner_authority_instance_id,
                    authority_mode, anchor_grant_id, installation_grant_id, anchor_expires_at_ms,
                    query_function_id, query_function_name, query_basis, query_args_json,
                    query_args_digest, read_dependencies_json, predicate_json,
                    reaction_kind, reaction_function_id, reaction_function_name, reaction_function_kind,
                    reaction_basis, reaction_args_json, reaction_args_digest,
                    webhook_url, webhook_secret_ref, status,
                    status_reason, notification_json, daily_firing_budget, firings_today,
                    debounce_ms, pending_job_id, dirty_while_pending, pending_firing_ordinal,
                    pending_firing_job_id, last_predicate_state, evaluation_count,
                    coalesced_invalidation_count, firing_count, last_evaluated_at_ms,
                    last_fired_at_ms, last_firing_outcome, last_diagnostic_code,
                    created_at_ms, updated_at_ms
             FROM _snapback_watches WHERE id = ?1",
            params![id],
            |row| {
                (0..43)
                    .map(|index| row.get::<_, SqlValue>(index))
                    .collect::<Result<Vec<_>, _>>()
            },
        )
        .optional()?;
    let Some(values) = raw else { return Ok(None) };
    let text = |index: usize| match &values[index] {
        SqlValue::Text(value) => Ok(value.clone()),
        _ => Err(catalog_corrupt()),
    };
    let optional_text = |index: usize| match &values[index] {
        SqlValue::Null => Ok(None),
        _ => text(index).map(Some),
    };
    let integer = |index: usize| match &values[index] {
        SqlValue::Integer(value) if *value >= 0 => Ok(*value as u64),
        _ => Err(catalog_corrupt()),
    };
    let optional_integer = |index: usize| match &values[index] {
        SqlValue::Null => Ok(None),
        _ => integer(index).map(Some),
    };
    let owner_kind = match text(0)?.as_str() {
        "user" => WatchOwnerKind::User,
        "integration" => WatchOwnerKind::Integration,
        _ => return Err(catalog_corrupt()),
    };
    let authority_mode = match text(3)?.as_str() {
        "capturedGrant" => WatchAuthorityMode::CapturedGrant,
        "revalidatePrincipal" => WatchAuthorityMode::RevalidatePrincipal,
        _ => return Err(catalog_corrupt()),
    };
    let query_args = serde_json::from_str(&text(10)?).map_err(|_| catalog_corrupt())?;
    let read_dependencies = serde_json::from_str(&text(12)?).map_err(|_| catalog_corrupt())?;
    let predicate = serde_json::from_str(&text(13)?).map_err(|_| catalog_corrupt())?;
    let reaction_args = serde_json::from_str(&text(19)?).map_err(|_| catalog_corrupt())?;
    let notification = optional_text(25)?
        .map(|value| serde_json::from_str(&value).map_err(|_| catalog_corrupt()))
        .transpose()?;
    let recent_firings = recent_firings(conn, id)?;
    let _dirty_while_pending = integer(30)?;
    Ok(Some(WatchRecord {
        id: id.to_owned(),
        owner_kind,
        owner_principal_id: text(1)?,
        owner_authority_instance_id: text(2)?,
        authority_mode,
        anchor_grant_id: optional_text(4)?,
        installation_grant_id: optional_text(5)?,
        anchor_expires_at_ms: integer(6)?,
        query_function_id: text(7)?,
        query_function_name: text(8)?,
        query_basis: integer(9)?,
        query_args,
        query_args_digest: text(11)?,
        read_dependencies,
        predicate,
        reaction_kind: WatchReactionKind::parse(&text(14)?)?,
        reaction_function_id: text(15)?,
        reaction_function_name: text(16)?,
        reaction_function_kind: WatchFunctionKind::parse(&text(17)?)?,
        reaction_basis: integer(18)?,
        reaction_args,
        reaction_args_digest: text(20)?,
        webhook_url: optional_text(21)?,
        webhook_secret_ref: optional_text(22)?,
        status: WatchStatus::parse(&text(23)?)?,
        status_reason: optional_text(24)?,
        notification,
        daily_firing_budget: integer(26)? as u32,
        firings_today: integer(27)? as u32,
        debounce_ms: integer(28)?,
        pending: optional_text(29)?.is_some(),
        pending_firing_ordinal: optional_integer(31)?,
        pending_firing_job_id: optional_text(32)?,
        last_predicate_state: integer(33)? != 0,
        evaluation_count: integer(34)?,
        coalesced_invalidation_count: integer(35)?,
        firing_count: integer(36)?,
        last_evaluated_at_ms: optional_integer(37)?,
        last_fired_at_ms: optional_integer(38)?,
        last_firing_outcome: optional_text(39)?,
        last_diagnostic_code: optional_text(40)?,
        created_at_ms: integer(41)?,
        updated_at_ms: integer(42)?,
        recent_firings,
        pending_job_id: optional_text(29)?,
    }))
}

fn recent_firings(conn: &Connection, id: &str) -> SnapbackResult<Vec<WatchFiringRecord>> {
    let mut statement = conn.prepare(
        "SELECT ordinal, job_id, fired_at_ms, outcome, diagnostic_code
         FROM _snapback_watch_firings WHERE watch_id = ?1 ORDER BY ordinal DESC LIMIT ?2",
    )?;
    Ok(statement
        .query_map(params![id, FIRING_JOURNAL_LIMIT], |row| {
            Ok(WatchFiringRecord {
                ordinal: row.get(0)?,
                job_id: row.get(1)?,
                fired_at_ms: row.get(2)?,
                outcome: row.get(3)?,
                diagnostic_code: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

pub fn watch_not_found() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_WATCH_NOT_FOUND",
        "watches",
        "the watch does not exist",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_NOW_MS: u64 = 1_000;

    fn integration_watch_database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("watch database");
        db.activate_current_auth_catalog()
            .expect("activate auth catalog");
        let manifest = SchemaManifest {
            api: Some(crate::manifest::ApiManifest {
                enabled: true,
                ..crate::manifest::ApiManifest::default()
            }),
            ..SchemaManifest::default()
        };
        db.with_auth_transaction(|tx| {
            crate::storage::auth_integrations::activate_manifest_in(tx, &manifest)?;
            activate_manifest_in(tx, &manifest)
        })
        .expect("activate integration and watch catalogs");
        db.conn
            .execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES('consenting-user', 0)",
                [],
            )
            .expect("seed consenting user");
        db.create_agent_principal(
            "integration-principal",
            0,
            &crate::storage::auth_agents::AgentRegistration {
                display_name: Some("Test Integration".to_owned()),
                operator_contact: None,
                registration_provenance: json!({"class": "integration"}).to_string(),
                owner_user_id: None,
            },
        )
        .expect("seed integration principal");
        db.conn
            .execute(
                "INSERT INTO _snapback_integration_records(
                   id, principal_user_id, display_name, origin, redirect_uris_json,
                   status, created_at_ms, updated_at_ms, provenance, owner_claim_state
                 ) VALUES(
                   'integration-record', 'integration-principal', 'Test Integration',
                   'https://integration.example', '[]', 'active', 0, 0,
                   '{\"source\":\"watch-test\"}', 'claimed'
                 )",
                [],
            )
            .expect("seed integration record");
        for (function_id, kind, generation) in [
            ("query-function", "liveQuery", 3_u64),
            ("reaction-function", "action", 4_u64),
        ] {
            db.conn
                .execute(
                    "INSERT INTO _auth_scope_bases(
                       function_id, kind, generation, present, authority_creating
                     ) VALUES(?1, ?2, ?3, 1, 0)",
                    params![function_id, kind, generation],
                )
                .expect("seed exact scope basis");
        }
        let scopes_json = crate::storage::auth_grants::canonical_scopes_json(&test_scopes())
            .expect("canonical installation scopes");
        db.conn
            .execute(
                "INSERT INTO _auth_grants(
                   id, actor_user_id, effective_user_id, scopes, created_at_ms,
                   expires_at_ms, revoked_at_ms, created_by, request_id,
                   consent_digest, last_used_at_ms
                 ) VALUES(
                   'installation-grant', 'integration-principal', 'consenting-user',
                   ?1, ?2, ?3, NULL, 'pairing:test', 'installation-pairing', ?4, ?2
                 )",
                params![
                    scopes_json,
                    TEST_NOW_MS,
                    TEST_NOW_MS + 2 * crate::watches::RENEWAL_CEILING_MS,
                    vec![7_u8; 32],
                ],
            )
            .expect("seed installation grant");
        db.conn
            .execute(
                "INSERT INTO _auth_pairing_requests(
                   id, code_hash, minted_by_user_id, agent_user_id,
                   requested_scopes, state, attempts, created_at_ms,
                   expires_at_ms, consumed_at_ms, grant_id
                 ) VALUES(
                   'installation-pairing', ?1, 'consenting-user',
                   'integration-principal', ?2, 'approved', 0, 0, ?3, ?4,
                   'installation-grant'
                 )",
                params![
                    vec![8_u8; 32],
                    scopes_json,
                    TEST_NOW_MS + 2 * crate::watches::RENEWAL_CEILING_MS,
                    TEST_NOW_MS,
                ],
            )
            .expect("seed installation lineage");
        db
    }

    fn test_scopes() -> Vec<crate::storage::auth_grants::ExactGrantScope> {
        vec![
            crate::storage::auth_grants::ExactGrantScope {
                function_id: "query-function".to_owned(),
                kind: crate::storage::auth_grants::ScopedFunctionKind::LiveQuery,
                basis: 3,
                authority_creating: false,
            },
            crate::storage::auth_grants::ExactGrantScope {
                function_id: "reaction-function".to_owned(),
                kind: crate::storage::auth_grants::ScopedFunctionKind::Action,
                basis: 4,
                authority_creating: false,
            },
        ]
    }

    fn integration_watch_request(id: &str, anchor_grant_id: &str) -> CreateWatchRecord {
        CreateWatchRecord {
            id: id.to_owned(),
            owner_kind: WatchOwnerKind::Integration,
            owner_principal_id: "integration-principal".to_owned(),
            owner_authority_instance_id: "integration-record".to_owned(),
            authority_mode: WatchAuthorityMode::CapturedGrant,
            anchor_grant_id: Some(anchor_grant_id.to_owned()),
            installation_grant_id: Some("installation-grant".to_owned()),
            anchor_effective_user_id: Some("consenting-user".to_owned()),
            anchor_scopes: test_scopes(),
            anchor_expires_at_ms: TEST_NOW_MS + crate::watches::ANCHOR_LIFETIME_MS,
            query_function_id: "query-function".to_owned(),
            query_function_name: "currentValue".to_owned(),
            query_basis: 3,
            query_args_json: "{\"account\":\"a\"}".to_owned(),
            query_args_digest: "query-args-digest".to_owned(),
            read_dependencies: Vec::new(),
            predicate_json: "{\"path\":\"/ready\",\"op\":\"eq\",\"value\":true}".to_owned(),
            reaction_kind: WatchReactionKind::Function,
            reaction_function_id: "reaction-function".to_owned(),
            reaction_function_name: "notify".to_owned(),
            reaction_function_kind: WatchFunctionKind::Action,
            reaction_basis: 4,
            reaction_args_json: "{\"channel\":\"ops\"}".to_owned(),
            reaction_args_digest: "reaction-args-digest".to_owned(),
            webhook_url: None,
            webhook_secret_ref: None,
            daily_firing_budget: 10,
            debounce_ms: crate::watches::MIN_DEBOUNCE_MS,
            initial_predicate_state: false,
            now_ms: TEST_NOW_MS,
        }
    }

    fn table_exists(conn: &Connection, table: &str) -> bool {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            [table],
            |row| row.get(0),
        )
        .expect("inspect watch table")
    }

    #[test]
    fn constants_fit_sqlite_portable_integer_contract() {
        assert!((FIRING_JOURNAL_LIMIT as u64) < MAX_SAFE_COUNTER);
    }

    #[test]
    fn protected_tables_activation_tracks_api_enabled_exactly() {
        let mut db = LocalDatabase::memory().expect("watch database");
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
        assert!(!table_exists(&db.conn, WATCH_TABLE));
        assert!(!table_exists(&db.conn, WATCH_FIRING_TABLE));
        db.with_auth_transaction(|tx| activate_manifest_in(tx, &manifest(true)))
            .unwrap();
        assert!(table_exists(&db.conn, WATCH_TABLE));
        assert!(table_exists(&db.conn, WATCH_FIRING_TABLE));
        db.with_auth_transaction(|tx| activate_manifest_in(tx, &manifest(false)))
            .unwrap();
        assert!(!table_exists(&db.conn, WATCH_TABLE));
        assert!(!table_exists(&db.conn, WATCH_FIRING_TABLE));
    }

    #[test]
    fn integration_watch_mints_exact_watch_bound_anchor_and_refuses_scope_drift() {
        let mut db = integration_watch_database();
        let record = db
            .create_watch(integration_watch_request("watch-one", "watch-anchor-one"))
            .expect("create integration watch");
        assert_eq!(record.owner_kind, WatchOwnerKind::Integration);
        assert_eq!(record.authority_mode, WatchAuthorityMode::CapturedGrant);
        assert_eq!(record.anchor_grant_id.as_deref(), Some("watch-anchor-one"));
        let (effective_user, encoded_scopes, created_by, expires_at_ms, digest): (
            String,
            String,
            String,
            u64,
            Vec<u8>,
        ) = db
            .conn
            .query_row(
                "SELECT effective_user_id, scopes, created_by, expires_at_ms, consent_digest
                 FROM _auth_grants WHERE id = 'watch-anchor-one'",
                [],
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
            .expect("read minted watchAnchor");
        assert_eq!(effective_user, "consenting-user");
        assert_eq!(
            crate::storage::auth_grants::parse_scopes_json(&encoded_scopes).unwrap(),
            test_scopes(),
        );
        assert_eq!(created_by, "watchAnchor:watch-one");
        assert_eq!(
            expires_at_ms,
            TEST_NOW_MS + crate::watches::ANCHOR_LIFETIME_MS,
        );
        assert_eq!(digest.len(), 32);
        assert!(
            db.revalidate_watch_anchor(&record, TEST_NOW_MS + 1)
                .unwrap()
                .is_some()
        );

        let mut under_scoped = integration_watch_request("watch-two", "watch-anchor-two");
        under_scoped.anchor_scopes.pop();
        let error = db.create_watch(under_scoped).unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_WATCH_ANCHOR_SCOPE_MISMATCH"
        );
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT COUNT(*) FROM _auth_grants WHERE id = 'watch-anchor-two'",
                    [],
                    |row| row.get::<_, u64>(0),
                )
                .unwrap(),
            0,
            "failed creation rolls back both anchor and watch",
        );

        db.conn
            .execute(
                "UPDATE _auth_scope_bases SET generation = 5 WHERE function_id = 'query-function'",
                [],
            )
            .unwrap();
        assert!(
            db.revalidate_watch_anchor(&record, TEST_NOW_MS + 2)
                .unwrap()
                .is_none(),
            "an immutable anchor cannot survive exact-scope basis drift",
        );
    }

    #[test]
    fn watch_anchor_renewal_obeys_ceiling_and_user_revocation_kills_queued_watch() {
        let mut db = integration_watch_database();
        let original = db
            .create_watch(integration_watch_request(
                "watch-renew",
                "watch-anchor-original",
            ))
            .expect("create renewable integration watch");
        let error = db
            .renew_watch_anchor_for_user(
                &original.id,
                "consenting-user",
                crate::watches::RENEWAL_CEILING_MS + 1,
                TEST_NOW_MS + 10,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_WATCH_RENEWAL_INVALID");

        let renewed = db
            .renew_watch_anchor_for_user(
                &original.id,
                "consenting-user",
                crate::watches::RENEWAL_CEILING_MS,
                TEST_NOW_MS + 20,
            )
            .expect("renew within the published ceiling");
        assert_ne!(renewed.anchor_grant_id, original.anchor_grant_id);
        assert_eq!(
            renewed.anchor_expires_at_ms,
            TEST_NOW_MS + 20 + crate::watches::RENEWAL_CEILING_MS,
        );
        assert!(
            db.schedule_watch_evaluation(&renewed.id, TEST_NOW_MS + 30)
                .unwrap()
        );
        assert!(
            db.watch_for_execution(&renewed.id)
                .unwrap()
                .unwrap()
                .pending
        );

        db.revoke_grant_for_user(
            "consenting-user",
            renewed.anchor_grant_id.as_deref().unwrap(),
            TEST_NOW_MS + 40,
        )
        .expect("consenting user revokes watchAnchor");
        let dead = db.watch_for_execution(&renewed.id).unwrap().unwrap();
        assert_eq!(dead.status, WatchStatus::Dead);
        assert!(!dead.pending);
        assert_eq!(
            dead.last_diagnostic_code.as_deref(),
            Some("SNAPBACK_WATCH_AUTHORITY_DEAD")
        );
        assert!(
            db.revalidate_watch_anchor(&dead, TEST_NOW_MS + 41)
                .unwrap()
                .is_none()
        );
    }
}
impl super::ServingDatabase {
    pub fn create_watch(&mut self, request: CreateWatchRecord) -> SnapbackResult<WatchRecord> {
        self.db.create_watch(request)
    }
    pub fn create_watch_guarded<G, BeforeCommit>(
        &mut self,
        request: CreateWatchRecord,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<WatchRecord>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.create_watch_guarded(request, before_commit)
    }
    pub fn revalidate_watch_anchor(
        &mut self,
        record: &WatchRecord,
        now_ms: u64,
    ) -> SnapbackResult<Option<WatchAnchorAuthority>> {
        self.db.revalidate_watch_anchor(record, now_ms)
    }
    pub fn renew_watch_anchor_for_user(
        &mut self,
        id: &str,
        effective_user_id: &str,
        ttl_ms: u64,
        now_ms: u64,
    ) -> SnapbackResult<WatchRecord> {
        self.db
            .renew_watch_anchor_for_user(id, effective_user_id, ttl_ms, now_ms)
    }
    pub fn transition_watch(
        &mut self,
        id: &str,
        owner: &str,
        target: WatchStatus,
        now_ms: u64,
    ) -> SnapbackResult<WatchRecord> {
        self.db.transition_watch(id, owner, target, now_ms)
    }
    pub fn schedule_watch_evaluation(&mut self, id: &str, now_ms: u64) -> SnapbackResult<bool> {
        self.db.schedule_watch_evaluation(id, now_ms)
    }
    pub fn begin_watch_evaluation(
        &mut self,
        id: &str,
        job_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<Option<WatchRecord>> {
        self.db.begin_watch_evaluation(id, job_id, now_ms)
    }
    pub fn decide_watch_evaluation(
        &mut self,
        id: &str,
        job_id: &str,
        predicate_state: bool,
        dependencies: &[CapturedReadDependency],
        now_ms: u64,
    ) -> SnapbackResult<EvaluationDecision> {
        self.db
            .decide_watch_evaluation(id, job_id, predicate_state, dependencies, now_ms)
    }
    pub fn finish_watch_evaluation_failure(
        &mut self,
        id: &str,
        job_id: &str,
        code: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db
            .finish_watch_evaluation_failure(id, job_id, code, now_ms)
    }
    pub fn record_watch_evaluation_retry(
        &mut self,
        id: &str,
        job_id: &str,
        code: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db
            .record_watch_evaluation_retry(id, job_id, code, now_ms)
    }
    pub fn record_watch_firing_retry(
        &mut self,
        id: &str,
        job_id: &str,
        ordinal: u64,
        code: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db
            .record_watch_firing_retry(id, job_id, ordinal, code, now_ms)
    }
    pub fn settle_watch_firing(
        &mut self,
        id: &str,
        job_id: &str,
        ordinal: u64,
        outcome: &str,
        diagnostic_code: Option<&str>,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db
            .settle_watch_firing(id, job_id, ordinal, outcome, diagnostic_code, now_ms)
    }
    pub fn mark_watch_dead(
        &mut self,
        id: &str,
        reason: &str,
        diagnostic_code: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db.mark_watch_dead(id, reason, diagnostic_code, now_ms)
    }
}
