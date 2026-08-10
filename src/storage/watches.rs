//! Manifest-activated protected storage for LLP 0204 durable watches.

use super::{LocalDatabase, SnapbackResult};
use crate::diagnostic::SnapbackError;
use crate::jobs::{BufferedJobEnqueue, JobProducer};
use crate::manifest::SchemaManifest;
use crate::storage::CapturedReadDependency;
use crate::watches::{
    FIRING_JOURNAL_LIMIT, INTERNAL_EVALUATION_ACTION, WatchAuthorityMode, WatchFunctionKind,
    WatchOwnerKind, WatchStatus, catalog_corrupt,
};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use rusqlite::types::Value as SqlValue;
use serde::Serialize;
use serde_json::{Value, json};

pub(crate) const WATCH_TABLE: &str = "_snapback_watches";
#[cfg(test)]
const WATCH_FIRING_TABLE: &str = "_snapback_watch_firings";
#[cfg(test)]
const MAX_SAFE_COUNTER: u64 = 9_007_199_254_740_991;

const TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS _snapback_watches (
  id TEXT NOT NULL PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK(owner_kind IN ('user', 'integration')),
  owner_principal_id TEXT NOT NULL,
  owner_authority_instance_id TEXT NOT NULL,
  authority_mode TEXT NOT NULL CHECK(authority_mode IN ('capturedGrant', 'revalidatePrincipal')),
  anchor_grant_id TEXT,
  anchor_expires_at_ms INTEGER NOT NULL CHECK(anchor_expires_at_ms BETWEEN 0 AND 9007199254740991),
  query_function_id TEXT NOT NULL,
  query_function_name TEXT NOT NULL,
  query_basis INTEGER NOT NULL CHECK(query_basis BETWEEN 0 AND 9007199254740991),
  query_args_json TEXT NOT NULL CHECK(length(CAST(query_args_json AS BLOB)) <= 65536),
  query_args_digest TEXT NOT NULL,
  read_dependencies_json TEXT NOT NULL CHECK(length(CAST(read_dependencies_json AS BLOB)) <= 262144),
  predicate_json TEXT NOT NULL CHECK(length(CAST(predicate_json AS BLOB)) <= 16384),
  reaction_kind TEXT NOT NULL CHECK(reaction_kind = 'function'),
  reaction_function_id TEXT NOT NULL,
  reaction_function_name TEXT NOT NULL,
  reaction_function_kind TEXT NOT NULL CHECK(reaction_function_kind IN ('query', 'mutation', 'action')),
  reaction_basis INTEGER NOT NULL CHECK(reaction_basis BETWEEN 0 AND 9007199254740991),
  reaction_args_json TEXT NOT NULL CHECK(length(CAST(reaction_args_json AS BLOB)) <= 65536),
  reaction_args_digest TEXT NOT NULL,
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
  CHECK((owner_kind = 'user' AND authority_mode = 'revalidatePrincipal' AND anchor_grant_id IS NULL)
     OR (owner_kind = 'integration' AND authority_mode = 'capturedGrant' AND anchor_grant_id IS NOT NULL))
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
pub(crate) struct CreateWatchRecord {
    pub id: String,
    pub owner_kind: WatchOwnerKind,
    pub owner_principal_id: String,
    pub owner_authority_instance_id: String,
    pub authority_mode: WatchAuthorityMode,
    pub anchor_grant_id: Option<String>,
    pub anchor_expires_at_ms: u64,
    pub query_function_id: String,
    pub query_function_name: String,
    pub query_basis: u64,
    pub query_args_json: String,
    pub query_args_digest: String,
    pub read_dependencies: Vec<CapturedReadDependency>,
    pub predicate_json: String,
    pub reaction_function_id: String,
    pub reaction_function_name: String,
    pub reaction_function_kind: WatchFunctionKind,
    pub reaction_basis: u64,
    pub reaction_args_json: String,
    pub reaction_args_digest: String,
    pub daily_firing_budget: u32,
    pub debounce_ms: u64,
    pub initial_predicate_state: bool,
    pub now_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WatchFiringRecord {
    pub ordinal: u64,
    pub job_id: String,
    pub fired_at_ms: u64,
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic_code: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WatchRecord {
    pub id: String,
    pub owner_kind: WatchOwnerKind,
    #[serde(skip_serializing)]
    pub owner_principal_id: String,
    #[serde(skip_serializing)]
    pub owner_authority_instance_id: String,
    pub authority_mode: WatchAuthorityMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_grant_id: Option<String>,
    pub anchor_expires_at_ms: u64,
    pub query_function_id: String,
    pub query_function_name: String,
    pub query_basis: u64,
    pub query_args: Value,
    pub query_args_digest: String,
    #[serde(skip_serializing)]
    pub read_dependencies: Vec<CapturedReadDependency>,
    pub predicate: Value,
    pub reaction_kind: String,
    pub reaction_function_id: String,
    pub reaction_function_name: String,
    pub reaction_function_kind: WatchFunctionKind,
    pub reaction_basis: u64,
    pub reaction_args: Value,
    pub reaction_args_digest: String,
    pub status: WatchStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notification: Option<Value>,
    pub daily_firing_budget: u32,
    pub firings_today: u32,
    pub debounce_ms: u64,
    pub pending: bool,
    pub last_predicate_state: bool,
    pub evaluation_count: u64,
    pub coalesced_invalidation_count: u64,
    pub firing_count: u64,
    pub last_evaluated_at_ms: Option<u64>,
    pub last_fired_at_ms: Option<u64>,
    pub last_firing_outcome: Option<String>,
    pub last_diagnostic_code: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub recent_firings: Vec<WatchFiringRecord>,
    #[serde(skip_serializing)]
    pub pending_job_id: Option<String>,
    #[serde(skip_serializing)]
    pub pending_firing_ordinal: Option<u64>,
    #[serde(skip_serializing)]
    pub pending_firing_job_id: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) enum EvaluationDecision {
    NoFire,
    Fire { ordinal: u64 },
    SuspendedBudget,
    Stale,
}

pub(crate) fn manifest_enabled(manifest: &SchemaManifest) -> bool {
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
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?
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
    pub(crate) fn create_watch(&mut self, request: CreateWatchRecord) -> SnapbackResult<WatchRecord> {
        if !table_exists(&self.conn)? {
            return Err(SnapbackError::error(
                "SNAPBACK_API_NOT_ENABLED",
                "watches",
                "durable watches require manifest api.enabled",
            ));
        }
        let dependencies_json = serde_json::to_string(&request.read_dependencies)
            .map_err(|_| catalog_corrupt())?;
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "INSERT INTO _snapback_watches (
               id, owner_kind, owner_principal_id, owner_authority_instance_id,
               authority_mode, anchor_grant_id, anchor_expires_at_ms,
               query_function_id, query_function_name, query_basis, query_args_json,
               query_args_digest, read_dependencies_json, predicate_json,
               reaction_kind, reaction_function_id, reaction_function_name,
               reaction_function_kind, reaction_basis, reaction_args_json,
               reaction_args_digest, status, status_reason, notification_json,
               daily_firing_budget, budget_day, firings_today, debounce_ms,
               next_evaluation_at_ms, pending_job_id, dirty_while_pending,
               pending_firing_ordinal, pending_firing_job_id, last_predicate_state,
               evaluation_count, coalesced_invalidation_count, firing_count,
               journal_count, last_evaluated_at_ms, last_fired_at_ms,
               last_firing_outcome, last_diagnostic_code, created_at_ms, updated_at_ms
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
               'function', ?15, ?16, ?17, ?18, ?19, ?20, 'active', NULL, NULL,
               ?21, ?22, 0, ?23, ?24, NULL, 0, NULL, NULL, ?25, 0, 0, 0, 0,
               NULL, NULL, NULL, NULL, ?24, ?24)",
            params![
                request.id,
                owner_kind_name(request.owner_kind),
                request.owner_principal_id,
                request.owner_authority_instance_id,
                authority_mode_name(request.authority_mode),
                request.anchor_grant_id,
                request.anchor_expires_at_ms,
                request.query_function_id,
                request.query_function_name,
                request.query_basis,
                request.query_args_json,
                request.query_args_digest,
                dependencies_json,
                request.predicate_json,
                request.reaction_function_id,
                request.reaction_function_name,
                request.reaction_function_kind.as_str(),
                request.reaction_basis,
                request.reaction_args_json,
                request.reaction_args_digest,
                request.daily_firing_budget,
                crate::watches::utc_day(request.now_ms),
                request.debounce_ms,
                request.now_ms,
                i64::from(request.initial_predicate_state),
            ],
        )?;
        tx.commit()?;
        self.watch_for_owner(&request.id, &request.owner_principal_id)?
            .ok_or_else(catalog_corrupt)
    }

    pub(crate) fn list_watches_for_owner(&self, owner: &str) -> SnapbackResult<Vec<WatchRecord>> {
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

    pub(crate) fn watch_for_owner(&self, id: &str, owner: &str) -> SnapbackResult<Option<WatchRecord>> {
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

    pub(crate) fn active_watches(&self) -> SnapbackResult<Vec<WatchRecord>> {
        if !table_exists(&self.conn)? {
            return Ok(Vec::new());
        }
        let mut statement = self.conn.prepare(
            "SELECT id FROM _snapback_watches WHERE status = 'active' ORDER BY id",
        )?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids.into_iter()
            .map(|id| row_for_id_on(&self.conn, &id)?.ok_or_else(catalog_corrupt))
            .collect()
    }

    pub(crate) fn watch_owner_is_active(&self, owner: &str) -> SnapbackResult<bool> {
        Ok(self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM _auth_users
             WHERE id = ?1 AND kind = 'human' AND deactivated_at_ms IS NULL)",
            params![owner],
            |row| row.get::<_, i64>(0),
        )? != 0)
    }

    pub(crate) fn transition_watch(
        &mut self,
        id: &str,
        owner: &str,
        target: WatchStatus,
        now_ms: u64,
    ) -> SnapbackResult<WatchRecord> {
        let current = self.watch_for_owner(id, owner)?.ok_or_else(watch_not_found)?;
        let allowed = matches!(
            (current.status, target),
            (WatchStatus::Active, WatchStatus::Suspended)
                | (WatchStatus::Suspended, WatchStatus::Active)
                | (WatchStatus::Active | WatchStatus::Suspended, WatchStatus::Dead)
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
    pub(crate) fn schedule_watch_evaluation(&mut self, id: &str, now_ms: u64) -> SnapbackResult<bool> {
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let state = tx
            .query_row(
                "SELECT pending_job_id, next_evaluation_at_ms, status
                 FROM _snapback_watches WHERE id = ?1",
                params![id],
                |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, u64>(1)?, row.get::<_, String>(2)?)),
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

    pub(crate) fn begin_watch_evaluation(
        &mut self,
        id: &str,
        job_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<Option<WatchRecord>> {
        let record = row_for_id_on(&self.conn, id)?;
        let Some(record) = record else { return Ok(None) };
        if record.status != WatchStatus::Active || record.pending_job_id.as_deref() != Some(job_id) {
            return Ok(None);
        }
        if now_ms >= record.anchor_expires_at_ms {
            self.mark_watch_dead(id, "anchor_expired", "SNAPBACK_WATCH_AUTHORITY_DEAD", now_ms)?;
            return Ok(None);
        }
        self.conn.execute(
            "UPDATE _snapback_watches SET dirty_while_pending = 0, updated_at_ms = ?1 WHERE id = ?2",
            params![now_ms, id],
        )?;
        row_for_id_on(&self.conn, id)
    }

    pub(crate) fn decide_watch_evaluation(
        &mut self,
        id: &str,
        job_id: &str,
        predicate_state: bool,
        dependencies: &[CapturedReadDependency],
        now_ms: u64,
    ) -> SnapbackResult<EvaluationDecision> {
        let dependencies_json = serde_json::to_string(dependencies).map_err(|_| catalog_corrupt())?;
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let state = tx
            .query_row(
                "SELECT status, pending_job_id, last_predicate_state, daily_firing_budget,
                        budget_day, firings_today, journal_count
                 FROM _snapback_watches WHERE id = ?1",
                params![id],
                |row| Ok((
                    row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, i64>(2)?,
                    row.get::<_, u32>(3)?, row.get::<_, u64>(4)?, row.get::<_, u32>(5)?, row.get::<_, u64>(6)?,
                )),
            )
            .optional()?;
        let Some((status, pending, previous, budget, budget_day, firings_today, journal_count)) = state else {
            tx.commit()?;
            return Ok(EvaluationDecision::Stale);
        };
        if status != "active" || pending.as_deref() != Some(job_id) {
            tx.commit()?;
            return Ok(EvaluationDecision::Stale);
        }
        let today = crate::watches::utc_day(now_ms);
        let current_firings = if budget_day == today { firings_today } else { 0 };
        let edge = previous == 0 && predicate_state;
        tx.execute(
            "UPDATE _snapback_watches SET read_dependencies_json = ?1,
             last_predicate_state = ?2, evaluation_count = evaluation_count + 1,
             last_evaluated_at_ms = ?3, next_evaluation_at_ms = ?4,
             budget_day = ?5, firings_today = ?6, updated_at_ms = ?3
             WHERE id = ?7",
            params![dependencies_json, i64::from(predicate_state), now_ms, now_ms.saturating_add(
                tx.query_row("SELECT debounce_ms FROM _snapback_watches WHERE id = ?1", params![id], |row| row.get::<_, u64>(0))?
            ), today, current_firings, id],
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
            insert_firing(&tx, id, ordinal, job_id, now_ms, "budget_suspended", Some("SNAPBACK_WATCH_BUDGET_EXHAUSTED"))?;
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
                params![current_firings.saturating_add(1), ordinal, job_id, now_ms, id],
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

    pub(crate) fn finish_watch_evaluation_failure(
        &mut self,
        id: &str,
        job_id: &str,
        code: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        finish_without_fire_on(&tx, id, job_id, now_ms, "evaluation_failed", Some(code))?;
        tx.commit()?;
        Ok(())
    }

    pub(crate) fn record_watch_evaluation_retry(
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

    pub(crate) fn record_watch_firing_retry(
        &mut self,
        id: &str,
        job_id: &str,
        ordinal: u64,
        code: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
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

    pub(crate) fn settle_watch_firing(
        &mut self,
        id: &str,
        job_id: &str,
        ordinal: u64,
        outcome: &str,
        diagnostic_code: Option<&str>,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
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

    pub(crate) fn mark_watch_dead(
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
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
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
            params![reason, notification.to_string(), diagnostic_code, now_ms, id],
        )?;
        tx.commit()?;
        Ok(())
    }
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
        queue: crate::jobs::JOBS_DEFAULT_QUEUE.to_owned(),
        action: INTERNAL_EVALUATION_ACTION.to_owned(),
        args: json!({ "watchId": watch_id }),
        idempotency_key: Some(format!("watch:{watch_id}:{job_id}")),
        max_attempts: crate::jobs::JOBS_MAX_ATTEMPTS_CEILING,
        available_at_ms,
        push_grant: None,
        rehearsal_provenance: None,
    };
    crate::jobs::insert_enqueued_jobs_in_tx(
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
                    authority_mode, anchor_grant_id, anchor_expires_at_ms,
                    query_function_id, query_function_name, query_basis, query_args_json,
                    query_args_digest, read_dependencies_json, predicate_json,
                    reaction_function_id, reaction_function_name, reaction_function_kind,
                    reaction_basis, reaction_args_json, reaction_args_digest, status,
                    status_reason, notification_json, daily_firing_budget, firings_today,
                    debounce_ms, pending_job_id, dirty_while_pending, pending_firing_ordinal,
                    pending_firing_job_id, last_predicate_state, evaluation_count,
                    coalesced_invalidation_count, firing_count, last_evaluated_at_ms,
                    last_fired_at_ms, last_firing_outcome, last_diagnostic_code,
                    created_at_ms, updated_at_ms
             FROM _snapback_watches WHERE id = ?1",
            params![id],
            |row| {
                Ok((0..39)
                    .map(|index| row.get::<_, SqlValue>(index))
                    .collect::<Result<Vec<_>, _>>()?)
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
    let query_args = serde_json::from_str(&text(9)?).map_err(|_| catalog_corrupt())?;
    let read_dependencies = serde_json::from_str(&text(11)?).map_err(|_| catalog_corrupt())?;
    let predicate = serde_json::from_str(&text(12)?).map_err(|_| catalog_corrupt())?;
    let reaction_args = serde_json::from_str(&text(17)?).map_err(|_| catalog_corrupt())?;
    let notification = optional_text(21)?
        .map(|value| serde_json::from_str(&value).map_err(|_| catalog_corrupt()))
        .transpose()?;
    let recent_firings = recent_firings(conn, id)?;
    let _dirty_while_pending = integer(26)?;
    Ok(Some(WatchRecord {
        id: id.to_owned(), owner_kind, owner_principal_id: text(1)?,
        owner_authority_instance_id: text(2)?, authority_mode,
        anchor_grant_id: optional_text(4)?, anchor_expires_at_ms: integer(5)?,
        query_function_id: text(6)?, query_function_name: text(7)?, query_basis: integer(8)?,
        query_args, query_args_digest: text(10)?, read_dependencies, predicate,
        reaction_kind: "function".to_owned(), reaction_function_id: text(13)?,
        reaction_function_name: text(14)?, reaction_function_kind: WatchFunctionKind::parse(&text(15)?)?,
        reaction_basis: integer(16)?, reaction_args, reaction_args_digest: text(18)?,
        status: WatchStatus::parse(&text(19)?)?, status_reason: optional_text(20)?, notification,
        daily_firing_budget: integer(22)? as u32, firings_today: integer(23)? as u32,
        debounce_ms: integer(24)?, pending: optional_text(25)?.is_some(),
        pending_firing_ordinal: optional_integer(27)?,
        pending_firing_job_id: optional_text(28)?, last_predicate_state: integer(29)? != 0,
        evaluation_count: integer(30)?, coalesced_invalidation_count: integer(31)?,
        firing_count: integer(32)?, last_evaluated_at_ms: optional_integer(33)?,
        last_fired_at_ms: optional_integer(34)?, last_firing_outcome: optional_text(35)?,
        last_diagnostic_code: optional_text(36)?, created_at_ms: integer(37)?, updated_at_ms: integer(38)?,
        recent_firings, pending_job_id: optional_text(25)?,
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
                ordinal: row.get(0)?, job_id: row.get(1)?, fired_at_ms: row.get(2)?,
                outcome: row.get(3)?, diagnostic_code: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

pub(crate) fn watch_not_found() -> SnapbackError {
    SnapbackError::error("SNAPBACK_WATCH_NOT_FOUND", "watches", "the watch does not exist")
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
