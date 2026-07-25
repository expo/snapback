//! The LLP 0081 §4 durable migration executor on the local SQLite profile.
//!
//! One IMMEDIATE transaction per durable transition: the journal, the ops
//! row, the fence, and the physical work of a batch commit together or not
//! at all. The state set and transition relation are closed by the
//! committed journal schema (`schemas/migration.journal.schema.json`), and
//! a transition outside the enumeration is refused as corruption.
//!
//! @ref LLP 0081#4-execution-journaling-and-crash-recovery — the closed
//!   durable state machine, the persisted lane fence, batch atomicity, the
//!   `published-held` publication posture, and the enforced downtime
//!   ceiling.

use super::{
    KeysetAfter, LocalDatabase, META_SCHEMA_MANIFEST, MIGRATION_SCAN_MAX_BATCH_BYTES,
    MIGRATION_SCAN_MAX_BATCH_ROWS, MigrationKeysetScanBatch, MigrationKeysetScanCheckpointV1,
    MigrationKeysetScanRequestV1, MigrationScanCeilingsV1, MigrationScanValidatorStateV1,
    MigrationScanValidatorV1, QueryPlan, create_index, create_or_update_table,
    current_version_on, eval_expr, next_storage_version,
    now_millis, quote_ident, save_retention_floor_on, schema_table,
    set_version, sqlite_type, timestamp_to_sql_millis, version_to_sql_integer,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{HandlerInput, SchemaManifest};
use crate::migration::{
    MigrationAdmissionV1, MigrationApprovalV1, MigrationAudienceV1, MigrationExecutionStrategy,
    MigrationPlanArtifactV1, MigrationStep, admission_digest, approval_digest,
    validate_approval_shape, validate_plan_artifact,
};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub const MIGRATION_JOURNAL_SCHEMA_VERSION: &str = "migration-journal-v1";

/// The reserved change-journal table name for schema-transition events.
/// Application tables cannot collide: `_snapback_`-prefixed names are the
/// storage layer's own namespace, and the per-table strict operation parser
/// never queries this name.
pub const SCHEMA_TRANSITION_JOURNAL_TABLE: &str = "_snapback_schema";
pub const SCHEMA_RESYNC_OP: &str = "schema-resync";

// ---------------------------------------------------------------------------
// The closed state machine
// ---------------------------------------------------------------------------

/// §4's closed durable state set, spelled exactly as the RFC names them.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "state")]
pub enum MigrationExecState {
    #[serde(rename = "admitted")]
    Admitted,
    #[serde(rename = "barriered")]
    Barriered,
    #[serde(rename = "executing")]
    Executing { step: String, batch: u64 },
    #[serde(rename = "verifying")]
    Verifying,
    #[serde(rename = "published-held")]
    PublishedHeld,
    #[serde(rename = "released")]
    Released,
    #[serde(rename = "rolling-back")]
    RollingBack,
    #[serde(rename = "rolled-back")]
    RolledBack,
    #[serde(rename = "cancel_requested")]
    CancelRequested,
    #[serde(rename = "aborting")]
    Aborting,
    #[serde(rename = "cancelled")]
    Cancelled,
    #[serde(rename = "abandoned")]
    Abandoned,
    #[serde(rename = "cleanup-pending")]
    CleanupPending { terminal: CleanupTerminal },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CleanupTerminal {
    #[serde(rename = "released")]
    Released,
    #[serde(rename = "rolled-back")]
    RolledBack,
}

impl MigrationExecState {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Admitted => "admitted",
            Self::Barriered => "barriered",
            Self::Executing { .. } => "executing",
            Self::Verifying => "verifying",
            Self::PublishedHeld => "published-held",
            Self::Released => "released",
            Self::RollingBack => "rolling-back",
            Self::RolledBack => "rolled-back",
            Self::CancelRequested => "cancel_requested",
            Self::Aborting => "aborting",
            Self::Cancelled => "cancelled",
            Self::Abandoned => "abandoned",
            Self::CleanupPending { .. } => "cleanup-pending",
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Released | Self::RolledBack | Self::Cancelled | Self::Abandoned
        )
    }
}

/// The complete transition relation, closed by the committed journal schema.
/// `executing → executing` is the batch/step advance; `cleanup-pending`
/// extends exactly the terminal it was entered from and ends in that same
/// terminal (checked beyond this pair table at append time).
pub fn migration_transition_relation() -> &'static [(&'static str, &'static str)] {
    &[
        ("admitted", "barriered"),
        ("admitted", "cancel_requested"),
        ("admitted", "abandoned"),
        ("barriered", "executing"),
        ("barriered", "verifying"),
        ("barriered", "cancel_requested"),
        ("barriered", "aborting"),
        ("barriered", "abandoned"),
        ("executing", "executing"),
        ("executing", "verifying"),
        ("executing", "cancel_requested"),
        ("executing", "aborting"),
        ("executing", "abandoned"),
        ("verifying", "published-held"),
        ("verifying", "cancel_requested"),
        ("verifying", "aborting"),
        ("verifying", "abandoned"),
        ("published-held", "released"),
        ("published-held", "rolling-back"),
        ("rolling-back", "rolled-back"),
        ("cancel_requested", "aborting"),
        ("cancel_requested", "abandoned"),
        ("aborting", "cancelled"),
        ("aborting", "abandoned"),
        ("released", "cleanup-pending"),
        ("rolled-back", "cleanup-pending"),
        ("cleanup-pending", "released"),
        ("cleanup-pending", "rolled-back"),
    ]
}

fn transition_admitted(from: &MigrationExecState, to: &MigrationExecState) -> bool {
    let pair_admitted = migration_transition_relation()
        .iter()
        .any(|(a, b)| *a == from.kind() && *b == to.kind());
    if !pair_admitted {
        return false;
    }
    // The cleanup tail ends in the same terminal state it extends.
    match (from, to) {
        (MigrationExecState::Released, MigrationExecState::CleanupPending { terminal }) => {
            *terminal == CleanupTerminal::Released
        }
        (MigrationExecState::RolledBack, MigrationExecState::CleanupPending { terminal }) => {
            *terminal == CleanupTerminal::RolledBack
        }
        (MigrationExecState::CleanupPending { terminal }, MigrationExecState::Released) => {
            *terminal == CleanupTerminal::Released
        }
        (MigrationExecState::CleanupPending { terminal }, MigrationExecState::RolledBack) => {
            *terminal == CleanupTerminal::RolledBack
        }
        _ => true,
    }
}

/// One durable journal entry: identity, state, progress, and the fencing
/// token, exactly §4's field list for the local profile.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationJournalEntryV1 {
    pub version: String,
    pub operation_id: String,
    pub plan_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    pub attempt: u64,
    pub state: MigrationExecState,
    /// Predecessor head at admission (the input generation identity).
    pub input_version: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_version: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<MigrationKeysetScanCheckpointV1>,
    /// In-place backfill batches checkpoint a bare keyset boundary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backfill_after_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    /// The fencing token: the lease epoch this executor instance holds.
    pub lease_epoch: u64,
    pub at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub barrier_elapsed_ms: Option<u64>,
}

/// The wave-2 receipt: a digest-sealed projection of the durable journal.
/// Verification/rollback postures gain their full §5/§6 faces in Wave 3;
/// nothing here is assembled from process memory.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationReceiptV1 {
    pub version: String,
    pub operation_id: String,
    pub plan_id: String,
    pub plan_digest: String,
    pub approval_digest: String,
    pub admission_digest: String,
    pub audience: MigrationAudienceV1,
    pub generator_is_approver: bool,
    pub state: MigrationExecState,
    pub input_version: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publication_version: Option<u64>,
    pub journal_entries: u64,
    /// SHA-256 (bare hex) over the JCS bytes of the journal-entry array —
    /// the receipt is the journal's projection, sealed.
    pub journal_digest: String,
    pub barrier_duration_ms: u64,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub step_results: BTreeMap<String, Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

pub const MIGRATION_RECEIPT_SCHEMA_VERSION: &str = "migration-receipt-v1";

// ---------------------------------------------------------------------------
// Durable fence + lease
// ---------------------------------------------------------------------------

const META_MIGRATION_FENCE: &str = "migration_fence";
const META_MIGRATION_LEASE_EPOCH: &str = "migration_lease_epoch";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationFenceV1 {
    pub operation_id: String,
    pub lease_epoch: u64,
    pub closed_at_ms: u64,
}

pub(crate) fn migration_fence_on(conn: &Connection) -> SnapbackResult<Option<MigrationFenceV1>> {
    if !super::sqlite_table_exists(conn, "_snapback_meta")? {
        return Ok(None);
    }
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            params![META_MIGRATION_FENCE],
            |row| row.get(0),
        )
        .optional()?;
    stored
        .map(|raw| {
            serde_json::from_str(&raw).map_err(|_| {
                journal_corrupt("persisted migration fence does not parse".to_owned())
            })
        })
        .transpose()
}

fn fence_closed(operation_id: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_MIGRATION_FENCE_CLOSED",
        "storage",
        format!(
            "a migration ({operation_id}) holds the exclusive barrier; application lanes are \
             fenced until its journal reaches a terminal state"
        ),
    )
}

/// The per-admission durable fence check every registered lane performs.
/// Stronger than §4's consult-before-opening minimum: on the local profile
/// each admission re-reads the persisted fence inside its own snapshot, so
/// a crash between reopen and resume cannot readmit any lane.
pub(crate) fn ensure_migration_fence_open(conn: &Connection) -> SnapbackResult<()> {
    match migration_fence_on(conn)? {
        Some(fence) => Err(fence_closed(&fence.operation_id)),
        None => Ok(()),
    }
}

fn journal_corrupt(detail: String) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_MIGRATION_JOURNAL_CORRUPT",
        "storage",
        format!("migration journal corruption: {detail}"),
    )
}

fn precondition_failed(detail: String) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_MIGRATION_PRECONDITION_FAILED",
        "storage",
        format!("migration admission precondition failed: {detail}"),
    )
}

fn executor_stale(detail: String) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_MIGRATION_EXECUTOR_STALE",
        "storage",
        format!("superseded migration executor refused: {detail}"),
    )
}

fn ensure_migration_tables(tx: &Transaction<'_>) -> SnapbackResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS _snapback_migration_journal (
           seq INTEGER PRIMARY KEY AUTOINCREMENT,
           operation_id TEXT NOT NULL,
           entry_json TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS _snapback_migration_journal_by_op
           ON _snapback_migration_journal(operation_id, seq);
         CREATE TABLE IF NOT EXISTS _snapback_migration_ops (
           operation_id TEXT PRIMARY KEY,
           audience_json TEXT NOT NULL,
           plan_digest TEXT NOT NULL,
           state_json TEXT NOT NULL,
           lease_epoch INTEGER NOT NULL,
           cancel_requested INTEGER NOT NULL DEFAULT 0,
           receipt_json TEXT
         );",
    )?;
    Ok(())
}

fn upsert_meta(tx: &Transaction<'_>, key: &str, value: &str) -> SnapbackResult<()> {
    tx.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

fn delete_meta(tx: &Transaction<'_>, key: &str) -> SnapbackResult<()> {
    tx.execute("DELETE FROM _snapback_meta WHERE key = ?1", params![key])?;
    Ok(())
}

fn current_lease_epoch(conn: &Connection) -> SnapbackResult<u64> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            params![META_MIGRATION_LEASE_EPOCH],
            |row| row.get(0),
        )
        .optional()?;
    Ok(stored.and_then(|value| value.parse().ok()).unwrap_or(0))
}

// ---------------------------------------------------------------------------
// Journal plumbing
// ---------------------------------------------------------------------------

struct JournalHandle<'a> {
    tx: &'a Transaction<'a>,
    operation_id: String,
    plan_id: String,
    lease_epoch: u64,
    input_version: u64,
}

impl JournalHandle<'_> {
    fn latest_state(&self) -> SnapbackResult<Option<MigrationExecState>> {
        latest_state_on(self.tx, &self.operation_id)
    }

    /// Append one durable transition. Validates the fencing token against
    /// the stored lease epoch and the transition against the closed
    /// relation before writing anything.
    fn append(&self, entry_fields: JournalAppend<'_>) -> SnapbackResult<()> {
        let stored_epoch = current_lease_epoch(self.tx)?;
        if stored_epoch != self.lease_epoch {
            return Err(executor_stale(format!(
                "stored lease epoch {stored_epoch} does not match this executor's token {}",
                self.lease_epoch
            )));
        }
        if let Some(previous) = self.latest_state()? {
            if !transition_admitted(&previous, entry_fields.state) {
                return Err(journal_corrupt(format!(
                    "transition {} -> {} is outside the enumerated relation",
                    previous.kind(),
                    entry_fields.state.kind()
                )));
            }
        } else if !matches!(entry_fields.state, MigrationExecState::Admitted) {
            return Err(journal_corrupt(
                "the first journal entry of an operation must be admitted".to_owned(),
            ));
        }
        let entry = MigrationJournalEntryV1 {
            version: MIGRATION_JOURNAL_SCHEMA_VERSION.to_owned(),
            operation_id: self.operation_id.clone(),
            plan_id: self.plan_id.clone(),
            step_id: entry_fields.step_id.map(str::to_owned),
            attempt: entry_fields.attempt,
            state: entry_fields.state.clone(),
            input_version: self.input_version,
            output_version: entry_fields.output_version,
            cursor: entry_fields.cursor.cloned(),
            backfill_after_id: entry_fields.backfill_after_id.map(str::to_owned),
            verification: entry_fields.verification.cloned(),
            error_code: entry_fields.error_code.map(str::to_owned),
            lease_epoch: self.lease_epoch,
            at_ms: entry_fields.at_ms,
            barrier_elapsed_ms: entry_fields.barrier_elapsed_ms,
        };
        let entry_json = serde_json::to_string(&entry)
            .map_err(|_| journal_corrupt("journal entry does not serialize".to_owned()))?;
        self.tx.execute(
            "INSERT INTO _snapback_migration_journal(operation_id, entry_json) VALUES(?1, ?2)",
            params![self.operation_id, entry_json],
        )?;
        let state_json = serde_json::to_string(&entry.state)
            .map_err(|_| journal_corrupt("state does not serialize".to_owned()))?;
        self.tx.execute(
            "UPDATE _snapback_migration_ops SET state_json = ?2 WHERE operation_id = ?1",
            params![self.operation_id, state_json],
        )?;
        Ok(())
    }
}

struct JournalAppend<'a> {
    step_id: Option<&'a str>,
    attempt: u64,
    state: &'a MigrationExecState,
    output_version: Option<u64>,
    cursor: Option<&'a MigrationKeysetScanCheckpointV1>,
    backfill_after_id: Option<&'a str>,
    verification: Option<&'a Value>,
    error_code: Option<&'a str>,
    at_ms: u64,
    barrier_elapsed_ms: Option<u64>,
}

impl<'a> JournalAppend<'a> {
    fn of(state: &'a MigrationExecState) -> Self {
        Self {
            step_id: None,
            attempt: 0,
            state,
            output_version: None,
            cursor: None,
            backfill_after_id: None,
            verification: None,
            error_code: None,
            at_ms: 0,
            barrier_elapsed_ms: None,
        }
    }
}

fn latest_state_on(
    conn: &Connection,
    operation_id: &str,
) -> SnapbackResult<Option<MigrationExecState>> {
    if !super::sqlite_table_exists(conn, "_snapback_migration_journal")? {
        return Ok(None);
    }
    let stored: Option<String> = conn
        .query_row(
            "SELECT entry_json FROM _snapback_migration_journal
             WHERE operation_id = ?1 ORDER BY seq DESC LIMIT 1",
            params![operation_id],
            |row| row.get(0),
        )
        .optional()?;
    stored
        .map(|raw| {
            serde_json::from_str::<MigrationJournalEntryV1>(&raw)
                .map(|entry| entry.state)
                .map_err(|_| journal_corrupt("journal entry does not parse".to_owned()))
        })
        .transpose()
}

fn journal_entries_on(
    conn: &Connection,
    operation_id: &str,
) -> SnapbackResult<Vec<MigrationJournalEntryV1>> {
    if !super::sqlite_table_exists(conn, "_snapback_migration_journal")? {
        return Ok(Vec::new());
    }
    let mut statement = conn.prepare(
        "SELECT entry_json FROM _snapback_migration_journal
         WHERE operation_id = ?1 ORDER BY seq",
    )?;
    let rows = statement.query_map(params![operation_id], |row| row.get::<_, String>(0))?;
    let mut entries = Vec::new();
    for row in rows {
        entries.push(
            serde_json::from_str(&row?)
                .map_err(|_| journal_corrupt("journal entry does not parse".to_owned()))?,
        );
    }
    Ok(entries)
}

fn stored_receipt_on(
    conn: &Connection,
    operation_id: &str,
) -> SnapbackResult<Option<MigrationReceiptV1>> {
    if !super::sqlite_table_exists(conn, "_snapback_migration_ops")? {
        return Ok(None);
    }
    let stored: Option<Option<String>> = conn
        .query_row(
            "SELECT receipt_json FROM _snapback_migration_ops WHERE operation_id = ?1",
            params![operation_id],
            |row| row.get(0),
        )
        .optional()?;
    match stored.flatten() {
        None => Ok(None),
        Some(raw) => Ok(Some(serde_json::from_str(&raw).map_err(|_| {
            journal_corrupt("stored receipt does not parse".to_owned())
        })?)),
    }
}

fn seal_receipt(
    conn: &Connection,
    operation_id: &str,
    plan: &MigrationPlanArtifactV1,
    approval: &MigrationApprovalV1,
    admission: &MigrationAdmissionV1,
    step_results: BTreeMap<String, Value>,
    error_code: Option<String>,
) -> SnapbackResult<MigrationReceiptV1> {
    let entries = journal_entries_on(conn, operation_id)?;
    let last = entries
        .last()
        .ok_or_else(|| journal_corrupt("an operation without journal entries".to_owned()))?;
    let entries_value = serde_json::to_value(&entries)
        .map_err(|_| journal_corrupt("journal entries do not serialize".to_owned()))?;
    let journal_jcs = crate::rqs::jcs(&entries_value)
        .map_err(|_| journal_corrupt("journal entries are not canonicalizable".to_owned()))?;
    let journal_digest = {
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(journal_jcs.as_bytes());
        digest.iter().map(|byte| format!("{byte:02x}")).collect()
    };
    let barrier_start = entries
        .iter()
        .find(|entry| matches!(entry.state, MigrationExecState::Barriered))
        .map(|entry| entry.at_ms);
    let barrier_end = entries.last().map(|entry| entry.at_ms);
    let publication_version = entries.iter().find_map(|entry| {
        matches!(entry.state, MigrationExecState::PublishedHeld)
            .then_some(entry.output_version)
            .flatten()
    });
    Ok(MigrationReceiptV1 {
        version: MIGRATION_RECEIPT_SCHEMA_VERSION.to_owned(),
        operation_id: operation_id.to_owned(),
        plan_id: plan.plan_id.clone(),
        plan_digest: plan.plan_digest.clone(),
        approval_digest: approval_digest(approval)?,
        admission_digest: admission_digest(admission)?,
        audience: approval.audience.clone(),
        generator_is_approver: approval.generator_is_approver,
        state: last.state.clone(),
        input_version: last.input_version,
        publication_version,
        journal_entries: entries.len() as u64,
        journal_digest,
        barrier_duration_ms: barrier_end
            .zip(barrier_start)
            .map(|(end, start)| end.saturating_sub(start))
            .unwrap_or(0),
        step_results,
        error_code,
    })
}

fn store_receipt(
    tx: &Transaction<'_>,
    operation_id: &str,
    receipt: &MigrationReceiptV1,
) -> SnapbackResult<()> {
    let receipt_json = serde_json::to_string(receipt)
        .map_err(|_| journal_corrupt("receipt does not serialize".to_owned()))?;
    tx.execute(
        "UPDATE _snapback_migration_ops SET receipt_json = ?2 WHERE operation_id = ?1",
        params![operation_id, receipt_json],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// The executor
// ---------------------------------------------------------------------------

/// Batch size for in-place backfill batches on the local profile.
const BACKFILL_BATCH_ROWS: usize = 512;

/// The resolved local audience the approval must equal (LLP 0072 identities
/// as the local profile binds them).
pub struct ResolvedLocalAudience {
    pub database_id: String,
    pub stream_incarnation: String,
    pub activation_generation: u64,
    pub target_profile_id: String,
}

pub struct MigrationApplyRequest<'a> {
    pub artifact: &'a MigrationPlanArtifactV1,
    pub approval: &'a MigrationApprovalV1,
    /// The staged successor schema manifest; its identity must equal the
    /// plan's `successorSchemaHash` binding.
    pub successor_schema: &'a SchemaManifest,
    pub audience: &'a ResolvedLocalAudience,
    pub now_ms: u64,
}

/// The pinned schema-identity rule for audience/staleness comparison: the
/// manifest's own codegen-supplied `schemaHash` when present, else the
/// canonical `sha256_identity` of the manifest value. Both plans and
/// staleness checks use this one rule.
pub fn schema_identity(manifest: &SchemaManifest) -> SnapbackResult<String> {
    if let Some(hash) = manifest.schema_hash.as_deref()
        && !hash.is_empty()
    {
        return Ok(hash.to_owned());
    }
    let value = serde_json::to_value(manifest)
        .map_err(|_| journal_corrupt("schema manifest does not serialize".to_owned()))?;
    crate::rqs::sha256_identity(&value)
        .map_err(|_| journal_corrupt("schema manifest is not canonicalizable".to_owned()))
}

impl LocalDatabase {
    /// Admit and execute one approved migration under the local exclusive
    /// barrier. Resumable: re-running the same `operationId` resumes from
    /// the journal (a completed operation returns its prior receipt), and a
    /// resume supersedes any earlier executor instance by bumping the lease
    /// epoch — the stale token can no longer advance the machine.
    pub fn migrate_apply(
        &mut self,
        request: MigrationApplyRequest<'_>,
    ) -> SnapbackResult<MigrationReceiptV1> {
        let MigrationApplyRequest {
            artifact,
            approval,
            successor_schema,
            audience,
            now_ms,
        } = request;
        let predecessor_schema = self.schema.clone();

        // ---- Static validation and semantic admission (no writes). -------
        validate_plan_artifact(artifact, &predecessor_schema, successor_schema)?;
        validate_approval_shape(approval)?;
        if approval.plan_digest != artifact.plan_digest {
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_APPROVAL_REQUIRED",
                "storage",
                "the approval binds a different plan digest; apply never regenerates a plan",
            ));
        }
        validate_local_audience(&approval.audience, audience)?;
        // Replay is keyed by operationId + audience and answers BEFORE any
        // staleness comparison: a completed operation returns its prior
        // receipt even though the target now holds the successor schema
        // (LLP 0081 §4).
        if let Some(receipt) = stored_receipt_on(&self.conn, &approval.operation_id)?
            && receipt.state.is_terminal()
        {
            return Ok(receipt);
        }
        let resuming_operation = latest_state_on(&self.conn, &approval.operation_id)?.is_some();
        let predecessor_identity = schema_identity(&predecessor_schema)?;
        if !resuming_operation && artifact.body.predecessor_schema_hash != predecessor_identity {
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_PLAN_STALE",
                "storage",
                format!(
                    "plan binds predecessor schema {} but the target holds {}; re-preview and \
                     re-approve",
                    artifact.body.predecessor_schema_hash, predecessor_identity
                ),
            ));
        }
        let successor_identity = schema_identity(successor_schema)?;
        if artifact.body.successor_schema_hash != successor_identity {
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_PLAN_STALE",
                "storage",
                "the staged successor schema does not match the plan's successor binding",
            ));
        }
        validate_supported_steps(artifact)?;

        // ---- Exclusivity. --------------------------------------------------
        if let Some(other) = active_other_operation(&self.conn, &approval.operation_id)? {
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_EXECUTOR_UNAVAILABLE",
                "storage",
                format!("operation {other} already owns this app; only one migration at a time"),
            ));
        }
        // The same plan under a new approval is a new operation and is
        // stale against a completed predecessor identity.
        if completed_predecessor_identity(&self.conn, &artifact.plan_digest)?
            .is_some_and(|prior| prior != approval.operation_id)
        {
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_PLAN_STALE",
                "storage",
                "this plan already completed under a prior operation; a new operation requires \
                 a new preview against the successor state",
            ));
        }
        if approval.expires_at_ms < now_ms && !resuming_operation {
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_APPROVAL_REQUIRED",
                "storage",
                "the approval expired before admission; an already-admitted operation is \
                 never stranded, but a new admission needs a fresh approval",
            ));
        }

        // ---- Admission transaction: lease, fence, journal head. -----------
        let resuming = resuming_operation;
        let (lease_epoch, input_version, admission) = {
            let tx = self
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            ensure_migration_tables(&tx)?;
            let head = current_version_on(&tx)?;
            // Barrier-time resource-ceiling preconditions: growth past the
            // reviewed bounds refuses and requires a new preview/approval.
            enforce_admission_ceilings(&tx, &predecessor_schema, artifact)?;
            enforce_publication_timestamp_floor(&tx, &predecessor_schema, artifact)?;
            let lease_epoch = current_lease_epoch(&tx)? + 1;
            upsert_meta(&tx, META_MIGRATION_LEASE_EPOCH, &lease_epoch.to_string())?;
            let fence = MigrationFenceV1 {
                operation_id: approval.operation_id.clone(),
                lease_epoch,
                closed_at_ms: now_ms,
            };
            upsert_meta(
                &tx,
                META_MIGRATION_FENCE,
                &serde_json::to_string(&fence)
                    .map_err(|_| journal_corrupt("fence does not serialize".to_owned()))?,
            )?;
            let admission = MigrationAdmissionV1 {
                schema_version: crate::migration::MIGRATION_ADMISSION_SCHEMA_VERSION.to_owned(),
                operation_id: approval.operation_id.clone(),
                plan_digest: artifact.plan_digest.clone(),
                approval_digest: approval_digest(approval)?,
                predecessor_head_version: head,
                enforced: artifact.body.ceilings.clone(),
                admitted_at_ms: now_ms,
            };
            let audience_json = serde_json::to_string(&approval.audience)
                .map_err(|_| journal_corrupt("audience does not serialize".to_owned()))?;
            if !resuming {
                tx.execute(
                    "INSERT INTO _snapback_migration_ops(operation_id, audience_json, \
                     plan_digest, state_json, lease_epoch, cancel_requested) \
                     VALUES(?1, ?2, ?3, ?4, ?5, 0)",
                    params![
                        approval.operation_id,
                        audience_json,
                        artifact.plan_digest,
                        serde_json::to_string(&MigrationExecState::Admitted)
                            .map_err(|_| journal_corrupt("state serialize".to_owned()))?,
                        lease_epoch as i64,
                    ],
                )?;
            } else {
                tx.execute(
                    "UPDATE _snapback_migration_ops SET lease_epoch = ?2 WHERE operation_id = ?1",
                    params![approval.operation_id, lease_epoch as i64],
                )?;
            }
            let journal = JournalHandle {
                tx: &tx,
                operation_id: approval.operation_id.clone(),
                plan_id: artifact.plan_id.clone(),
                lease_epoch,
                input_version: head,
            };
            if !resuming {
                journal.append(JournalAppend {
                    at_ms: now_ms,
                    ..JournalAppend::of(&MigrationExecState::Admitted)
                })?;
                journal.append(JournalAppend {
                    at_ms: now_ms,
                    ..JournalAppend::of(&MigrationExecState::Barriered)
                })?;
            }
            tx.commit()?;
            (
                lease_epoch,
                if resuming {
                    journal_entries_on(&self.conn, &approval.operation_id)?
                        .first()
                        .map(|entry| entry.input_version)
                        .unwrap_or(head)
                } else {
                    head
                },
                admission,
            )
        };

        // published-held resume: the only exits are release or rollback;
        // re-running apply IS the explicit release decision.
        if let Some(MigrationExecState::PublishedHeld) =
            latest_state_on(&self.conn, &approval.operation_id)?
        {
            // A held publication whose journal record lost its output
            // version violates the atomicity contract: fail closed for
            // inspection, never guess from physical tables.
            let held_has_version = journal_entries_on(&self.conn, &approval.operation_id)?
                .iter()
                .any(|entry| {
                    matches!(entry.state, MigrationExecState::PublishedHeld)
                        && entry.output_version.is_some()
                });
            if !held_has_version {
                return Err(SnapbackError::error(
                    "SNAPBACK_MIGRATION_PUBLICATION_AMBIGUOUS",
                    "storage",
                    "the journal holds published-held without a publication version; \
                     inspect the target before resuming",
                ));
            }
            return self.migrate_release(
                artifact,
                approval,
                &admission,
                successor_schema,
                lease_epoch,
                input_version,
                now_ms,
            );
        }

        let outcome = self.execute_admitted(
            artifact,
            approval,
            &admission,
            successor_schema,
            lease_epoch,
            input_version,
            now_ms,
        );
        match outcome {
            Ok(receipt) => Ok(receipt),
            Err(error) => {
                // Safe abort: journal the failure to a terminal state, clear
                // the fence, and leave the predecessor authoritative. A
                // corruption/stale-token error must not itself journal.
                let code = error.diagnostic.code.clone();
                if code != "SNAPBACK_MIGRATION_JOURNAL_CORRUPT"
                    && code != "SNAPBACK_MIGRATION_EXECUTOR_STALE"
                {
                    let _ = self.abort_to_cancelled(
                        artifact,
                        approval,
                        &admission,
                        lease_epoch,
                        input_version,
                        &code,
                        now_ms,
                    );
                }
                Err(error)
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn execute_admitted(
        &mut self,
        artifact: &MigrationPlanArtifactV1,
        approval: &MigrationApprovalV1,
        admission: &MigrationAdmissionV1,
        successor_schema: &SchemaManifest,
        lease_epoch: u64,
        input_version: u64,
        now_ms: u64,
    ) -> SnapbackResult<MigrationReceiptV1> {
        let barrier_started_ms = journal_entries_on(&self.conn, &approval.operation_id)?
            .iter()
            .find(|entry| matches!(entry.state, MigrationExecState::Barriered))
            .map(|entry| entry.at_ms)
            .unwrap_or(now_ms);
        let ceiling_ms = artifact.body.ceilings.max_barrier_downtime_ms;
        let publication_version = next_storage_version(input_version)?;
        let mut step_results: BTreeMap<String, Value> = BTreeMap::new();

        let elapsed = |at: u64| at.saturating_sub(barrier_started_ms);
        let check_ceiling = |at: u64| -> SnapbackResult<()> {
            if elapsed(at) > ceiling_ms {
                Err(SnapbackError::error(
                    "SNAPBACK_MIGRATION_BARRIER_FAILED",
                    "storage",
                    format!(
                        "barrier downtime {}ms exceeded the approved ceiling {}ms before \
                         publication; the predecessor remains authoritative",
                        elapsed(at),
                        ceiling_ms
                    ),
                ))
            } else {
                Ok(())
            }
        };

        for (ordinal, record) in artifact.body.steps.iter().enumerate() {
            let step_id = &record.id;
            let at = now_millis();
            check_ceiling(at)?;
            self.check_cancellation(&approval.operation_id)?;
            let verification = self.execute_step(
                artifact,
                approval,
                successor_schema,
                &record.step,
                step_id,
                ordinal as u64,
                lease_epoch,
                input_version,
                publication_version,
                barrier_started_ms,
            )?;
            step_results.insert(step_id.clone(), verification);
        }

        // Verifying: the wave-2 verification face is the per-step validator
        // results; the §5 expected-value/content-digest proof harness is the
        // Wave 3 verification lane.
        {
            let at = now_millis();
            check_ceiling(at)?;
            let tx = self
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            let journal = JournalHandle {
                tx: &tx,
                operation_id: approval.operation_id.clone(),
                plan_id: artifact.plan_id.clone(),
                lease_epoch,
                input_version,
            };
            journal.append(JournalAppend {
                at_ms: at,
                barrier_elapsed_ms: Some(elapsed(at)),
                ..JournalAppend::of(&MigrationExecState::Verifying)
            })?;
            tx.commit()?;
        }

        // ---- Publication: one transaction, entering published-held. -------
        {
            let at = now_millis();
            check_ceiling(at)?;
            self.check_cancellation(&approval.operation_id)?;
            let tx = self
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            // Publish the successor schema manifest and its additive DDL.
            for table in &successor_schema.tables {
                create_or_update_table(&tx, table)?;
                for index in &table.indexes {
                    create_index(&tx, table, &index.name, &index.fields, index.unique)?;
                }
            }
            upsert_meta(
                &tx,
                META_SCHEMA_MANIFEST,
                &serde_json::to_string(successor_schema)
                    .map_err(|_| journal_corrupt("successor schema serialize".to_owned()))?,
            )?;
            // One successor application version, the schema-resync journal
            // event, and the raised retention floor, atomically.
            set_version(&tx, publication_version)?;
            save_retention_floor_on(&tx, publication_version)?;
            let resync = json!({
                "operationId": approval.operation_id,
                "planId": artifact.plan_id,
                "predecessorSchemaHash": artifact.body.predecessor_schema_hash,
                "successorSchemaHash": artifact.body.successor_schema_hash,
                "predecessorGeneration": artifact.body.predecessor_generation,
                "retentionFloor": publication_version,
            });
            tx.execute(
                "INSERT INTO _snapback_changes(version, table_name, row_id, op, row_json, \
                 changed_at_ms) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    version_to_sql_integer(publication_version)?,
                    SCHEMA_TRANSITION_JOURNAL_TABLE,
                    approval.operation_id,
                    SCHEMA_RESYNC_OP,
                    resync.to_string(),
                    timestamp_to_sql_millis(now_ms)?,
                ],
            )?;
            let journal = JournalHandle {
                tx: &tx,
                operation_id: approval.operation_id.clone(),
                plan_id: artifact.plan_id.clone(),
                lease_epoch,
                input_version,
            };
            journal.append(JournalAppend {
                output_version: Some(publication_version),
                at_ms: at,
                barrier_elapsed_ms: Some(elapsed(at)),
                ..JournalAppend::of(&MigrationExecState::PublishedHeld)
            })?;
            tx.commit()?;
        }

        self.migrate_release_inner(
            artifact,
            approval,
            admission,
            successor_schema,
            lease_epoch,
            input_version,
            step_results,
        )
    }

    /// The explicit release from `published-held`: open the fence, journal
    /// the release and its cleanup tail, seal and store the receipt.
    #[allow(clippy::too_many_arguments)]
    fn migrate_release(
        &mut self,
        artifact: &MigrationPlanArtifactV1,
        approval: &MigrationApprovalV1,
        admission: &MigrationAdmissionV1,
        successor_schema: &SchemaManifest,
        lease_epoch: u64,
        input_version: u64,
        _now_ms: u64,
    ) -> SnapbackResult<MigrationReceiptV1> {
        self.migrate_release_inner(
            artifact,
            approval,
            admission,
            successor_schema,
            lease_epoch,
            input_version,
            BTreeMap::new(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn migrate_release_inner(
        &mut self,
        artifact: &MigrationPlanArtifactV1,
        approval: &MigrationApprovalV1,
        admission: &MigrationAdmissionV1,
        successor_schema: &SchemaManifest,
        lease_epoch: u64,
        input_version: u64,
        step_results: BTreeMap<String, Value>,
    ) -> SnapbackResult<MigrationReceiptV1> {
        let at = now_millis();
        let receipt = {
            let tx = self
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            let journal = JournalHandle {
                tx: &tx,
                operation_id: approval.operation_id.clone(),
                plan_id: artifact.plan_id.clone(),
                lease_epoch,
                input_version,
            };
            journal.append(JournalAppend {
                at_ms: at,
                ..JournalAppend::of(&MigrationExecState::Released)
            })?;
            // The cleanup tail: logical retirements keep their physical
            // storage through the rollback window; the physical drop is the
            // Wave 3 cleanup lane. The tail closes back into the same
            // terminal it extends.
            let cleanup = MigrationExecState::CleanupPending {
                terminal: CleanupTerminal::Released,
            };
            journal.append(JournalAppend {
                at_ms: at,
                ..JournalAppend::of(&cleanup)
            })?;
            journal.append(JournalAppend {
                at_ms: at,
                ..JournalAppend::of(&MigrationExecState::Released)
            })?;
            delete_meta(&tx, META_MIGRATION_FENCE)?;
            let receipt = seal_receipt(
                &tx,
                &approval.operation_id,
                artifact,
                approval,
                admission,
                step_results,
                None,
            )?;
            store_receipt(&tx, &approval.operation_id, &receipt)?;
            tx.commit()?;
            receipt
        };
        // The serving handle adopts the successor schema.
        self.schema = successor_schema.clone();
        Ok(receipt)
    }

    #[allow(clippy::too_many_arguments)]
    fn abort_to_cancelled(
        &mut self,
        artifact: &MigrationPlanArtifactV1,
        approval: &MigrationApprovalV1,
        admission: &MigrationAdmissionV1,
        lease_epoch: u64,
        input_version: u64,
        error_code: &str,
        _now_ms: u64,
    ) -> SnapbackResult<MigrationReceiptV1> {
        let at = now_millis();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let journal = JournalHandle {
            tx: &tx,
            operation_id: approval.operation_id.clone(),
            plan_id: artifact.plan_id.clone(),
            lease_epoch,
            input_version,
        };
        let latest = journal.latest_state()?;
        if !matches!(latest, Some(MigrationExecState::CancelRequested)) {
            journal.append(JournalAppend {
                error_code: Some(error_code),
                at_ms: at,
                ..JournalAppend::of(&MigrationExecState::CancelRequested)
            })?;
        }
        journal.append(JournalAppend {
            error_code: Some(error_code),
            at_ms: at,
            ..JournalAppend::of(&MigrationExecState::Aborting)
        })?;
        journal.append(JournalAppend {
            error_code: Some(error_code),
            at_ms: at,
            ..JournalAppend::of(&MigrationExecState::Cancelled)
        })?;
        delete_meta(&tx, META_MIGRATION_FENCE)?;
        let receipt = seal_receipt(
            &tx,
            &approval.operation_id,
            artifact,
            approval,
            admission,
            BTreeMap::new(),
            Some(error_code.to_owned()),
        )?;
        store_receipt(&tx, &approval.operation_id, &receipt)?;
        tx.commit()?;
        Ok(receipt)
    }

    fn check_cancellation(&self, operation_id: &str) -> SnapbackResult<()> {
        let requested: Option<i64> = self
            .conn
            .query_row(
                "SELECT cancel_requested FROM _snapback_migration_ops WHERE operation_id = ?1",
                params![operation_id],
                |row| row.get(0),
            )
            .optional()?;
        if requested.unwrap_or(0) != 0 {
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_CANCELLED",
                "storage",
                "cancellation was requested and is admitted at this pre-publication boundary",
            ));
        }
        Ok(())
    }

    /// Request cancellation at the next admitted boundary (pre-publication
    /// only). Never leaves the machine outside a named state.
    pub fn migrate_request_cancel(&mut self, operation_id: &str) -> SnapbackResult<()> {
        match latest_state_on(&self.conn, operation_id)? {
            None => Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_EXECUTOR_UNAVAILABLE",
                "storage",
                format!("no journaled operation {operation_id}"),
            )),
            Some(MigrationExecState::PublishedHeld) => {
                Err(SnapbackError::error(
                    "SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE",
                    "storage",
                    "cancellation is pre-publication only; from published-held the exits are \
                     the journaled release or the audited rollback",
                ))
            }
            Some(state) if state.is_terminal() => Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_EXECUTOR_UNAVAILABLE",
                "storage",
                format!("operation {operation_id} already reached {}", state.kind()),
            )),
            Some(_) => {
                self.conn.execute(
                    "UPDATE _snapback_migration_ops SET cancel_requested = 1 \
                     WHERE operation_id = ?1",
                    params![operation_id],
                )?;
                Ok(())
            }
        }
    }

    /// One step, executed under the barrier. Single-transaction steps run
    /// whole; batched steps commit shadow writes + cursor + journal per
    /// batch. Returns the step's journaled verification value.
    #[allow(clippy::too_many_arguments)]
    fn execute_step(
        &mut self,
        artifact: &MigrationPlanArtifactV1,
        approval: &MigrationApprovalV1,
        successor_schema: &SchemaManifest,
        step: &MigrationStep,
        step_id: &str,
        _ordinal: u64,
        lease_epoch: u64,
        input_version: u64,
        publication_version: u64,
        barrier_started_ms: u64,
    ) -> SnapbackResult<Value> {
        let operation_id = approval.operation_id.clone();
        let plan_id = artifact.plan_id.clone();
        let constants = &artifact.body.constants;
        let journal_step =
            |tx: &Transaction<'_>,
             batch: u64,
             cursor: Option<&MigrationKeysetScanCheckpointV1>,
             after_id: Option<&str>,
             verification: Option<&Value>|
             -> SnapbackResult<()> {
                let at = now_millis();
                let journal = JournalHandle {
                    tx,
                    operation_id: operation_id.clone(),
                    plan_id: plan_id.clone(),
                    lease_epoch,
                    input_version,
                };
                let state = MigrationExecState::Executing {
                    step: step_id.to_owned(),
                    batch,
                };
                journal.append(JournalAppend {
                    step_id: Some(step_id),
                    cursor,
                    backfill_after_id: after_id,
                    verification,
                    at_ms: at,
                    barrier_elapsed_ms: Some(at.saturating_sub(barrier_started_ms)),
                    ..JournalAppend::of(&state)
                })
            };

        match step {
            // Structural steps: the physical DDL lands at publication (the
            // successor manifest is authoritative); executing them journals
            // the intent and, for additive columns, prepares the nullable
            // physical column the backfill batches write into.
            MigrationStep::CreateTable { .. }
            | MigrationStep::CreateIndex { .. }
            | MigrationStep::MakeRequired { .. }
            | MigrationStep::CreateUniqueIndex { .. }
            | MigrationStep::RetireField { .. }
            | MigrationStep::RetireTable { .. } => {
                let tx = self
                    .conn
                    .transaction_with_behavior(TransactionBehavior::Immediate)?;
                if let MigrationStep::CreateUniqueIndex { table, index, .. } = step {
                    // The uniqueness proof (ValidateUnique) has already run
                    // in planner order; the physical unique index lands now
                    // so a violated invariant fails here, not at publication.
                    let successor_table = successor_schema.table(table).ok_or_else(|| {
                        step_failed(step_id, "unique index on undeclared successor table")
                    })?;
                    let declared = successor_table
                        .indexes
                        .iter()
                        .find(|candidate| candidate.name == *index)
                        .ok_or_else(|| {
                            step_failed(step_id, "unique index is not declared on the successor")
                        })?;
                    create_index(
                        &tx,
                        successor_table,
                        &declared.name,
                        &declared.fields,
                        declared.unique,
                    )?;
                }
                journal_step(&tx, 0, None, None, Some(&json!({ "structural": true })))?;
                tx.commit()?;
                Ok(json!({ "structural": true }))
            }
            MigrationStep::AddField {
                table,
                field,
                field_type,
                optional,
                backfill,
            } => {
                {
                    let tx = self
                        .conn
                        .transaction_with_behavior(TransactionBehavior::Immediate)?;
                    add_nullable_column(&tx, table, field, field_type)?;
                    journal_step(&tx, 0, None, None, None)?;
                    tx.commit()?;
                }
                let verification = match backfill {
                    Some(expr) => self.run_backfill_batches(
                        &operation_id,
                        step_id,
                        successor_schema,
                        table,
                        field,
                        expr,
                        constants,
                        publication_version,
                        &journal_step_wrapper(
                            &operation_id,
                            &plan_id,
                            step_id,
                            lease_epoch,
                            input_version,
                            barrier_started_ms,
                        ),
                    )?,
                    None => {
                        if !*optional {
                            return Err(step_failed(
                                step_id,
                                "a required added field needs a backfill expression",
                            ));
                        }
                        json!({ "rowsWritten": 0 })
                    }
                };
                Ok(verification)
            }
            MigrationStep::BackfillField { table, field, expr } => self.run_backfill_batches(
                &operation_id,
                step_id,
                successor_schema,
                table,
                field,
                expr,
                constants,
                publication_version,
                &journal_step_wrapper(
                    &operation_id,
                    &plan_id,
                    step_id,
                    lease_epoch,
                    input_version,
                    barrier_started_ms,
                ),
            ),
            MigrationStep::CopyField {
                source_table,
                source_field,
                table,
                field,
                expr,
            } => {
                if source_table != table {
                    return Err(profile_unsupported(
                        "cross-table CopyField is not admitted by this wave's local profile",
                    ));
                }
                let copy_expr = expr.clone().unwrap_or(crate::manifest::ValueExpr::Field {
                    base: Box::new(crate::manifest::ValueExpr::Binding("row".to_owned())),
                    key: source_field.clone(),
                });
                self.run_backfill_batches(
                    &operation_id,
                    step_id,
                    successor_schema,
                    table,
                    field,
                    &copy_expr,
                    constants,
                    publication_version,
                    &journal_step_wrapper(
                        &operation_id,
                        &plan_id,
                        step_id,
                        lease_epoch,
                        input_version,
                        barrier_started_ms,
                    ),
                )
            }
            MigrationStep::ValidateRequired { table, field } => self.run_validation_scan(
                successor_schema,
                table,
                vec![MigrationScanValidatorV1::NonNull {
                    field: field.clone(),
                }],
                step_id,
                &journal_step_wrapper(
                    &operation_id,
                    &plan_id,
                    step_id,
                    lease_epoch,
                    input_version,
                    barrier_started_ms,
                ),
            ),
            MigrationStep::ValidateUnique { table, fields } => {
                // The scan's uniqueness validator requires the leading scan
                // index; without a declared index over exactly these fields
                // the proof scans in `_id` order and accumulates a seen-set
                // bound — refused as unsupported to keep the proof honest.
                let predecessor = self.schema.clone();
                let scan_index = predecessor
                    .table(table)
                    .and_then(|t| {
                        t.indexes
                            .iter()
                            .find(|index| index.fields == *fields)
                            .map(|index| index.name.clone())
                    })
                    .or_else(|| {
                        successor_schema.table(table).and_then(|t| {
                            t.indexes
                                .iter()
                                .find(|index| index.fields == *fields)
                                .map(|index| index.name.clone())
                        })
                    });
                let Some(index) = scan_index else {
                    return Err(profile_unsupported(
                        "ValidateUnique requires a declared index over exactly the validated \
                         fields on this profile",
                    ));
                };
                let field = fields.first().cloned().ok_or_else(|| {
                    step_failed(step_id, "ValidateUnique requires at least one field")
                })?;
                self.run_validation_scan_indexed(
                    successor_schema,
                    table,
                    Some(index),
                    vec![MigrationScanValidatorV1::Unique { field }],
                    step_id,
                    &journal_step_wrapper(
                        &operation_id,
                        &plan_id,
                        step_id,
                        lease_epoch,
                        input_version,
                        barrier_started_ms,
                    ),
                )
            }
            MigrationStep::RebuildMaintainedProjection { projection_id } => {
                let plan = self
                    .projections
                    .iter()
                    .find(|plan| plan.id == *projection_id)
                    .cloned()
                    .ok_or_else(|| {
                        step_failed(step_id, "the projection is not active on this instance")
                    })?;
                let receipt = self.rebuild_projection_if_stale(&plan, "migration")?;
                let verification = json!({
                    "projection": projection_id,
                    "rebuilt": receipt.is_some(),
                    "contentDigest": receipt.as_ref().map(|r| r.content_digest.clone()),
                });
                let tx = self
                    .conn
                    .transaction_with_behavior(TransactionBehavior::Immediate)?;
                journal_step(&tx, 0, None, None, Some(&verification))?;
                tx.commit()?;
                Ok(verification)
            }
            MigrationStep::CopyTable { .. }
            | MigrationStep::StageTableGeneration { .. }
            | MigrationStep::RetireGeneration { .. } => Err(profile_unsupported(
                "staged-generation steps are not admitted by this wave's local profile",
            )),
        }
    }
}

type JournalStepFn<'a> = dyn Fn(
        &Transaction<'_>,
        u64,
        Option<&MigrationKeysetScanCheckpointV1>,
        Option<&str>,
        Option<&Value>,
    ) -> SnapbackResult<()>
    + 'a;

#[allow(clippy::too_many_arguments)]
fn journal_step_wrapper<'a>(
    operation_id: &'a str,
    plan_id: &'a str,
    step_id: &'a str,
    lease_epoch: u64,
    input_version: u64,
    barrier_started_ms: u64,
) -> Box<JournalStepFn<'a>> {
    Box::new(
        move |tx: &Transaction<'_>,
              batch: u64,
              cursor: Option<&MigrationKeysetScanCheckpointV1>,
              after_id: Option<&str>,
              verification: Option<&Value>|
              -> SnapbackResult<()> {
            let at = now_millis();
            let journal = JournalHandle {
                tx,
                operation_id: operation_id.to_owned(),
                plan_id: plan_id.to_owned(),
                lease_epoch,
                input_version,
            };
            let state = MigrationExecState::Executing {
                step: step_id.to_owned(),
                batch,
            };
            journal.append(JournalAppend {
                step_id: Some(step_id),
                cursor,
                backfill_after_id: after_id,
                verification,
                at_ms: at,
                barrier_elapsed_ms: Some(at.saturating_sub(barrier_started_ms)),
                ..JournalAppend::of(&state)
            })
        },
    )
}

impl LocalDatabase {
    /// In-place batched backfill: each batch reads one keyset page in `_id`
    /// order, evaluates the closed expression over `{row, constants}`,
    /// writes changed destinations with the §4 system-identity rule
    /// (`_version` = publication version, `_updatedAt` = the plan's
    /// `publicationTimestampMs`), and commits writes + boundary + journal in
    /// one transaction. Pre-publication these writes live in a column the
    /// predecessor manifest does not expose — the parked shadow.
    #[allow(clippy::too_many_arguments)]
    fn run_backfill_batches(
        &mut self,
        operation_id: &str,
        step_id: &str,
        successor_schema: &SchemaManifest,
        table_name: &str,
        field: &str,
        expr: &crate::manifest::ValueExpr,
        constants: &crate::migration::MigrationConstants,
        publication_version: u64,
        journal_step: &JournalStepFn<'_>,
    ) -> SnapbackResult<Value> {
        let schema = effective_barrier_schema(&self.schema, successor_schema, table_name);
        let mut after: Option<String> =
            resume_backfill_boundary(&self.conn, operation_id, step_id)?;
        let mut batch: u64 = 0;
        let mut rows_written: u64 = 0;
        let input = HandlerInput {
            args: Value::Object(constants.values.clone().into_iter().collect()),
            ..HandlerInput::default()
        };
        loop {
            let tx = self
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            let table = schema_table(&schema, table_name)?;
            let page_plan = QueryPlan {
                table: table_name.to_owned(),
                filters: Vec::new(),
                membership_filters: Vec::new(),
                order: Vec::new(),
                limit: Some(BACKFILL_BATCH_ROWS),
                indexed_by: None,
            };
            let boundary = after.as_ref().map(|id| KeysetAfter {
                entries: Vec::new(),
                id: id.clone(),
            });
            // Executor-privileged page read: the application query lane is
            // fenced during the barrier, so the executor reads its own
            // keyset pages directly inside its transaction.
            let (sql, values) = super::build_query_sql(
                table,
                &schema,
                &page_plan,
                &input,
                &BTreeMap::new(),
                None,
                constants.publication_timestamp_ms,
                None,
                Some(BACKFILL_BATCH_ROWS),
                boundary.as_ref(),
                true,
            )?;
            let page_rows: Vec<Value> = {
                let mut statement = tx.prepare(&sql)?;
                let columns = statement
                    .column_names()
                    .into_iter()
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>();
                let mut rows = statement.query(super::params_from_iter(values.iter()))?;
                let mut out = Vec::new();
                while let Some(row) = rows.next()? {
                    out.push(super::row_to_document(row, table, &columns)?);
                }
                out
            };
            let mut last_id: Option<String> = None;
            for row in &page_rows {
                let id = row
                    .get("_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| journal_corrupt("row without _id".to_owned()))?
                    .to_owned();
                last_id = Some(id.clone());
                let mut bindings = BTreeMap::new();
                bindings.insert("row".to_owned(), row.clone());
                let value = eval_expr(expr, &input, &bindings, constants.publication_timestamp_ms, None)?;
                let existing = row.get(field).cloned().unwrap_or(Value::Null);
                if existing == value {
                    continue;
                }
                let field_manifest = table.field(field);
                let sql_value = super::json_to_sql_value(
                    &value,
                    field_manifest.map(|f| &f.field_type),
                )?;
                tx.execute(
                    &format!(
                        "UPDATE {} SET {} = ?1, _version = ?2, _updatedAt = ?3 WHERE _id = ?4",
                        quote_ident(&table.name)?,
                        quote_ident(field)?
                    ),
                    params![
                        sql_value,
                        version_to_sql_integer(publication_version)?,
                        timestamp_to_sql_millis(constants.publication_timestamp_ms)?,
                        id
                    ],
                )?;
                rows_written += 1;
            }
            let done = page_rows.len() < BACKFILL_BATCH_ROWS;
            if let Some(id) = &last_id {
                after = Some(id.clone());
            }
            journal_step(&tx, batch, None, after.as_deref(), None)?;
            tx.commit()?;
            batch += 1;
            if done {
                break;
            }
        }
        Ok(json!({ "rowsWritten": rows_written }))
    }

    fn run_validation_scan(
        &mut self,
        successor_schema: &SchemaManifest,
        table: &str,
        validators: Vec<MigrationScanValidatorV1>,
        step_id: &str,
        journal_step: &JournalStepFn<'_>,
    ) -> SnapbackResult<Value> {
        self.run_validation_scan_indexed(
            successor_schema,
            table,
            None,
            validators,
            step_id,
            journal_step,
        )
    }

    /// Full-table proof scans through `MigrationKeysetScanV1`, one batch per
    /// transaction with the checkpoint journaled — the §4 batch-atomicity
    /// rule applied to reads.
    #[allow(clippy::too_many_arguments)]
    fn run_validation_scan_indexed(
        &mut self,
        successor_schema: &SchemaManifest,
        table: &str,
        index: Option<String>,
        validators: Vec<MigrationScanValidatorV1>,
        step_id: &str,
        journal_step: &JournalStepFn<'_>,
    ) -> SnapbackResult<Value> {
        let schema = effective_barrier_schema(&self.schema, successor_schema, table);
        let request = MigrationKeysetScanRequestV1 {
            table: table.to_owned(),
            index,
            validators,
            digest: None,
            ceilings: MigrationScanCeilingsV1 {
                max_batch_rows: MIGRATION_SCAN_MAX_BATCH_ROWS,
                max_batch_bytes: MIGRATION_SCAN_MAX_BATCH_BYTES,
                max_batch_millis: 60_000,
            },
        };
        let mut checkpoint: Option<MigrationKeysetScanCheckpointV1> = None;
        let mut batch: u64 = 0;
        loop {
            let tx = self
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            let outcome: MigrationKeysetScanBatch =
                super::migration_keyset_scan_batch_on(&tx, &schema, &request, checkpoint.as_ref())?;
            journal_step(&tx, batch, Some(&outcome.checkpoint), None, None)?;
            tx.commit()?;
            batch += 1;
            let done = outcome.done;
            checkpoint = Some(outcome.checkpoint);
            if done {
                break;
            }
        }
        let final_checkpoint =
            checkpoint.ok_or_else(|| journal_corrupt("scan finished without state".to_owned()))?;
        let verification = serde_json::to_value(&final_checkpoint.validators)
            .map_err(|_| journal_corrupt("validator state serialize".to_owned()))?;
        for validator in &final_checkpoint.validators {
            let violations = match validator {
                MigrationScanValidatorStateV1::NonNull { violations, .. } => *violations,
                MigrationScanValidatorStateV1::Unique { duplicates, .. } => *duplicates,
            };
            if violations > 0 {
                return Err(SnapbackError::error(
                    "SNAPBACK_MIGRATION_STEP_FAILED",
                    "storage",
                    format!("validation step {step_id} failed: {verification}"),
                ));
            }
        }
        Ok(verification)
    }
}

/// The effective schema during the barrier: the predecessor's tables with
/// the successor's field declarations unioned in (columns added earlier in
/// this plan are visible; retired columns remain until cleanup).
fn effective_barrier_schema(
    predecessor: &SchemaManifest,
    successor: &SchemaManifest,
    table_name: &str,
) -> SchemaManifest {
    let mut schema = predecessor.clone();
    if let Some(effective) = schema.tables.iter_mut().find(|t| t.name == table_name)
        && let Some(successor_table) = successor.table(table_name)
    {
        for successor_field in &successor_table.fields {
            match effective
                .fields
                .iter_mut()
                .find(|f| f.name == successor_field.name)
            {
                Some(existing) => *existing = successor_field.clone(),
                None => effective.fields.push(successor_field.clone()),
            }
        }
    }
    schema
}

fn resume_backfill_boundary(
    conn: &Connection,
    operation_id: &str,
    step_id: &str,
) -> SnapbackResult<Option<String>> {
    // Resume replays only uncommitted ranges: the latest journaled
    // backfill boundary for THIS operation and step, if any.
    if !super::sqlite_table_exists(conn, "_snapback_migration_journal")? {
        return Ok(None);
    }
    let stored: Option<String> = conn
        .query_row(
            "SELECT entry_json FROM _snapback_migration_journal
             WHERE operation_id = ?1 ORDER BY seq DESC LIMIT 1",
            params![operation_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(stored
        .and_then(|raw| serde_json::from_str::<MigrationJournalEntryV1>(&raw).ok())
        .filter(|entry| entry.step_id.as_deref() == Some(step_id))
        .and_then(|entry| entry.backfill_after_id))
}

fn add_nullable_column(
    tx: &Transaction<'_>,
    table: &str,
    field: &str,
    field_type: &crate::manifest::FieldType,
) -> SnapbackResult<()> {
    let existing = super::physical_columns(tx, table)?;
    if existing.contains_key(field) {
        return Ok(());
    }
    // Always physically nullable pre-publication: requiredness is a
    // manifest-level fact proven by ValidateRequired before MakeRequired.
    tx.execute(
        &format!(
            "ALTER TABLE {} ADD COLUMN {} {}",
            quote_ident(table)?,
            quote_ident(field)?,
            sqlite_type(field_type)
        ),
        [],
    )?;
    Ok(())
}

fn step_failed(step_id: &str, detail: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_MIGRATION_STEP_FAILED",
        "storage",
        format!("migration step {step_id} failed: {detail}"),
    )
}

fn profile_unsupported(detail: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_MIGRATION_PROFILE_UNSUPPORTED",
        "storage",
        detail.to_owned(),
    )
}

fn validate_local_audience(
    approved: &MigrationAudienceV1,
    resolved: &ResolvedLocalAudience,
) -> SnapbackResult<()> {
    let mismatch = |axis: &str| {
        SnapbackError::error(
            "SNAPBACK_MIGRATION_TARGET_MISMATCH",
            "storage",
            format!("approval audience does not bind this target: {axis} differs"),
        )
    };
    if approved.database_id != resolved.database_id {
        return Err(mismatch("databaseId"));
    }
    if approved.stream_incarnation != resolved.stream_incarnation {
        return Err(mismatch("streamIncarnation"));
    }
    if approved.activation_generation != resolved.activation_generation {
        return Err(mismatch("activationGeneration"));
    }
    if approved.target_profile_id != resolved.target_profile_id {
        return Err(mismatch("targetProfileId"));
    }
    Ok(())
}

fn validate_supported_steps(artifact: &MigrationPlanArtifactV1) -> SnapbackResult<()> {
    if matches!(
        artifact.body.execution_strategy,
        MigrationExecutionStrategy::ShadowGeneration
    ) {
        return Err(profile_unsupported(
            "the shadow-generation strategy is not admitted by this wave's local profile; \
             single-transaction plans with batched in-place backfill are",
        ));
    }
    for record in &artifact.body.steps {
        if matches!(
            record.step,
            MigrationStep::CopyTable { .. }
                | MigrationStep::StageTableGeneration { .. }
                | MigrationStep::RetireGeneration { .. }
        ) {
            return Err(profile_unsupported(
                "staged-generation steps are not admitted by this wave's local profile",
            ));
        }
        if let MigrationStep::CopyField {
            source_table,
            table,
            ..
        } = &record.step
            && source_table != table
        {
            return Err(profile_unsupported(
                "cross-table CopyField is not admitted by this wave's local profile",
            ));
        }
    }
    Ok(())
}

fn enforce_admission_ceilings(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    artifact: &MigrationPlanArtifactV1,
) -> SnapbackResult<()> {
    // The barrier-time precondition: the predecessor must not have grown
    // past what the approver reviewed. Affected-row bound = the row count
    // of every table a step reads or writes.
    let mut affected: u64 = 0;
    let mut counted = std::collections::BTreeSet::new();
    for record in &artifact.body.steps {
        let table = record.step.anchor_table().to_owned();
        if !counted.insert(table.clone()) {
            continue;
        }
        if schema.table(&table).is_none() {
            continue;
        }
        let count: i64 = tx.query_row(
            &format!("SELECT COUNT(*) FROM {}", quote_ident(&table)?),
            [],
            |row| row.get(0),
        )?;
        affected = affected.saturating_add(count as u64);
    }
    if affected > artifact.body.ceilings.max_affected_rows {
        return Err(precondition_failed(format!(
            "the predecessor holds {affected} rows across the plan's tables; the approved \
             ceiling is {}",
            artifact.body.ceilings.max_affected_rows
        )));
    }
    Ok(())
}

fn enforce_publication_timestamp_floor(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    artifact: &MigrationPlanArtifactV1,
) -> SnapbackResult<()> {
    // §4: a row's visible timestamp never moves backward — the plan's
    // publicationTimestamp must be at least the maximum `_updatedAt` among
    // rows the plan changes.
    let mut checked = std::collections::BTreeSet::new();
    for record in &artifact.body.steps {
        let writes_rows = matches!(
            record.step,
            MigrationStep::AddField { backfill: Some(_), .. }
                | MigrationStep::BackfillField { .. }
                | MigrationStep::CopyField { .. }
        );
        if !writes_rows {
            continue;
        }
        let table = record.step.anchor_table().to_owned();
        if !checked.insert(table.clone()) || schema.table(&table).is_none() {
            continue;
        }
        let max_updated: Option<i64> = tx
            .query_row(
                &format!("SELECT MAX(_updatedAt) FROM {}", quote_ident(&table)?),
                [],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        if let Some(max_updated) = max_updated
            && (max_updated as u64) > artifact.body.constants.publication_timestamp_ms
        {
            return Err(precondition_failed(format!(
                "publicationTimestampMs {} is behind the maximum _updatedAt {} in {}; a \
                 visible timestamp never moves backward",
                artifact.body.constants.publication_timestamp_ms, max_updated, table
            )));
        }
    }
    Ok(())
}

fn active_other_operation(
    conn: &Connection,
    operation_id: &str,
) -> SnapbackResult<Option<String>> {
    if !super::sqlite_table_exists(conn, "_snapback_migration_ops")? {
        return Ok(None);
    }
    let mut statement = conn.prepare(
        "SELECT operation_id, state_json FROM _snapback_migration_ops
         WHERE operation_id != ?1",
    )?;
    let rows = statement.query_map(params![operation_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (other, state_json) = row?;
        let state: MigrationExecState = serde_json::from_str(&state_json)
            .map_err(|_| journal_corrupt("ops state does not parse".to_owned()))?;
        if !state.is_terminal() {
            return Ok(Some(other));
        }
    }
    Ok(None)
}

fn completed_predecessor_identity(
    conn: &Connection,
    plan_digest: &str,
) -> SnapbackResult<Option<String>> {
    if !super::sqlite_table_exists(conn, "_snapback_migration_ops")? {
        return Ok(None);
    }
    let mut statement = conn.prepare(
        "SELECT operation_id, state_json FROM _snapback_migration_ops WHERE plan_digest = ?1",
    )?;
    let rows = statement.query_map(params![plan_digest], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (operation, state_json) = row?;
        let state: MigrationExecState = serde_json::from_str(&state_json)
            .map_err(|_| journal_corrupt("ops state does not parse".to_owned()))?;
        if matches!(state, MigrationExecState::Released) {
            return Ok(Some(operation));
        }
    }
    Ok(None)
}

/// Public journal/receipt readers for the CLI and verification surfaces.
impl LocalDatabase {
    /// The per-admission fence check for lanes that do not pass through a
    /// storage transaction before their effect (cron claims, action
    /// staging, ephemeral publish, live subscribe/resume registration).
    pub(crate) fn ensure_migration_lane_open(&self) -> SnapbackResult<()> {
        ensure_migration_fence_open(&self.conn)
    }

    pub fn migration_receipt(
        &self,
        operation_id: &str,
    ) -> SnapbackResult<Option<MigrationReceiptV1>> {
        stored_receipt_on(&self.conn, operation_id)
    }

    pub fn migration_journal(
        &self,
        operation_id: &str,
    ) -> SnapbackResult<Vec<MigrationJournalEntryV1>> {
        journal_entries_on(&self.conn, operation_id)
    }

    pub fn migration_fence(&self) -> SnapbackResult<Option<MigrationFenceV1>> {
        migration_fence_on(&self.conn)
    }

    /// Verify that a stored receipt still byte-equals its journal
    /// projection — the wave-2 `migrate verify` face. The §5 data proof
    /// (expected values, content digests over generations) is the Wave 3
    /// verification lane and refuses honestly until it lands.
    pub fn migration_verify_receipt(&self, operation_id: &str) -> SnapbackResult<Value> {
        let receipt = stored_receipt_on(&self.conn, operation_id)?.ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_MIGRATION_EXECUTOR_UNAVAILABLE",
                "storage",
                format!("no receipt for operation {operation_id}"),
            )
        })?;
        let entries = journal_entries_on(&self.conn, operation_id)?;
        let entries_value = serde_json::to_value(&entries)
            .map_err(|_| journal_corrupt("journal serialize".to_owned()))?;
        let journal_jcs = crate::rqs::jcs(&entries_value)
            .map_err(|_| journal_corrupt("journal canonicalize".to_owned()))?;
        let recomputed: String = {
            use sha2::{Digest, Sha256};
            Sha256::digest(journal_jcs.as_bytes())
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect()
        };
        if recomputed != receipt.journal_digest {
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_VERIFICATION_FAILED",
                "storage",
                "the stored receipt does not equal its journal projection",
            ));
        }
        Ok(json!({
            "operationId": operation_id,
            "journalDigest": recomputed,
            "journalEntries": entries.len(),
            "state": receipt.state.kind(),
            "dataProof": "the §5 expected-value/content-digest proof lands with Wave 3",
        }))
    }
}

/// The committed journal-schema artifact: states, the closed transition
/// relation, and the entry shape, generated through this module so the
/// enumeration cannot drift from the refusal check.
pub fn migration_journal_artifact() -> Value {
    json!({
        "version": MIGRATION_JOURNAL_SCHEMA_VERSION,
        "authority": "llp/0081-reviewed-storage-evolution-and-migrations.rfc.md#4-execution-journaling-and-crash-recovery",
        "states": [
            "admitted", "barriered", "executing", "verifying", "published-held",
            "released", "rolling-back", "rolled-back", "cancel_requested",
            "aborting", "cancelled", "abandoned", "cleanup-pending",
        ],
        "terminalStates": ["released", "rolled-back", "cancelled", "abandoned"],
        "transitions": migration_transition_relation()
            .iter()
            .map(|(from, to)| json!({ "from": from, "to": to }))
            .collect::<Vec<_>>(),
        "cleanupTailRule": "cleanup-pending extends exactly the terminal it was entered from and ends in that same terminal",
        "fencingToken": "leaseEpoch — validated against the stored epoch before every append",
    })
}

#[cfg(test)]
impl LocalDatabase {
    /// Test-only: persist a fence + non-terminal ops row so reopen-path
    /// witnesses can prove the durable closure without running a real
    /// migration to a crash point.
    pub(crate) fn install_migration_fence_for_test(
        &mut self,
        operation_id: &str,
    ) -> SnapbackResult<()> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_migration_tables(&tx)?;
        upsert_meta(&tx, META_MIGRATION_LEASE_EPOCH, "1")?;
        upsert_meta(
            &tx,
            META_MIGRATION_FENCE,
            &serde_json::to_string(&MigrationFenceV1 {
                operation_id: operation_id.to_owned(),
                lease_epoch: 1,
                closed_at_ms: 1,
            })
            .map_err(|_| journal_corrupt("fence serialize".to_owned()))?,
        )?;
        tx.execute(
            "INSERT INTO _snapback_migration_ops(operation_id, audience_json, plan_digest,              state_json, lease_epoch, cancel_requested) VALUES(?1, '{}', 'd', ?2, 1, 0)",
            params![
                operation_id,
                serde_json::to_string(&MigrationExecState::Barriered)
                    .map_err(|_| journal_corrupt("state serialize".to_owned()))?
            ],
        )?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
pub(crate) fn latest_state_for_test(
    db: &LocalDatabase,
    operation_id: &str,
) -> SnapbackResult<Option<MigrationExecState>> {
    latest_state_on(&db.conn, operation_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{
        FieldManifest, FieldType, HandlerInput, SchemaManifest, SeedData, TableManifest, ValueExpr,
    };
    use crate::migration::{
        MIGRATION_APPROVAL_SCHEMA_VERSION, MIGRATION_PLAN_SCHEMA_VERSION, MigrationApprovalV1,
        MigrationAudienceV1, MigrationBackupRequirement, MigrationCeilings, MigrationConstants,
        MigrationExpectedOutput, MigrationIntent, MigrationPlanArtifactV1, MigrationPlanBody,
        MigrationProof, MigrationProofMethod, CompatibilityPosture, RetainedWorkPosture,
        derive_plan_steps, new_operation_id,
    };
    use serde_json::json;
    use std::collections::BTreeMap;

    fn table(name: &str, fields: Vec<(&str, bool)>) -> TableManifest {
        TableManifest {
            name: name.to_owned(),
            fields: fields
                .into_iter()
                .map(|(field, optional)| FieldManifest {
                    name: field.to_owned(),
                    field_type: FieldType::String,
                    optional,
                })
                .collect(),
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            membership: None,
        }
    }

    fn predecessor_schema() -> SchemaManifest {
        SchemaManifest {
            tables: vec![table("items", vec![("title", false)])],
            ..SchemaManifest::default()
        }
    }

    fn successor_schema() -> SchemaManifest {
        SchemaManifest {
            tables: vec![table("items", vec![("title", false), ("note", false)])],
            ..SchemaManifest::default()
        }
    }

    const PUBLICATION_TS: u64 = 1_900_000_000_000;

    fn fixture_plan(
        predecessor: &SchemaManifest,
        successor: &SchemaManifest,
        ceilings: MigrationCeilings,
    ) -> MigrationPlanArtifactV1 {
        let intents = vec![MigrationIntent::AddRequiredField {
            table: "items".to_owned(),
            field: "note".to_owned(),
            field_type: FieldType::String,
            backfill: ValueExpr::Arg("noteDefault".to_owned()),
        }];
        let steps = derive_plan_steps(successor, &intents).expect("derive steps");
        let body = MigrationPlanBody {
            schema_version: MIGRATION_PLAN_SCHEMA_VERSION.to_owned(),
            app: "test-app".to_owned(),
            instance: "memory".to_owned(),
            target_profile_id: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            predecessor_schema_hash: schema_identity(predecessor).expect("predecessor id"),
            successor_schema_hash: schema_identity(successor).expect("successor id"),
            predecessor_generation: 1,
            steps,
            execution_strategy: crate::migration::MigrationExecutionStrategy::SingleTransaction,
            proof: MigrationProof {
                method: MigrationProofMethod::Full,
                bound: None,
            },
            ceilings,
            compatibility_posture: CompatibilityPosture::SuccessorOnly,
            retained_work_posture: RetainedWorkPosture::Empty,
            backup: MigrationBackupRequirement {
                required: false,
                checkpoint_label: None,
            },
            expected_output: MigrationExpectedOutput {
                schema_hash: schema_identity(successor).expect("successor id"),
                projection_generations: BTreeMap::new(),
            },
            constants: MigrationConstants {
                publication_timestamp_ms: PUBLICATION_TS,
                values: BTreeMap::from([("noteDefault".to_owned(), json!("n/a"))]),
            },
            boundaries: Default::default(),
        };
        MigrationPlanArtifactV1::seal(body).expect("seal plan")
    }

    fn default_ceilings() -> MigrationCeilings {
        MigrationCeilings {
            max_affected_rows: 10_000,
            max_bytes: 64 * 1024 * 1024,
            max_writes: 10_000,
            max_barrier_downtime_ms: 60_000,
        }
    }

    fn audience() -> (MigrationAudienceV1, ResolvedLocalAudience) {
        let approved = MigrationAudienceV1 {
            project_id: None,
            target_id: None,
            environment_id: None,
            deployment_id: None,
            release_id: None,
            database_id: "db-1".to_owned(),
            stream_incarnation: "stream-1".to_owned(),
            activation_generation: 1,
            target_profile_id: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
        };
        let resolved = ResolvedLocalAudience {
            database_id: "db-1".to_owned(),
            stream_incarnation: "stream-1".to_owned(),
            activation_generation: 1,
            target_profile_id: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
        };
        (approved, resolved)
    }

    fn approval_for(plan: &MigrationPlanArtifactV1, now_ms: u64) -> MigrationApprovalV1 {
        let (approved_audience, _) = audience();
        MigrationApprovalV1 {
            schema_version: MIGRATION_APPROVAL_SCHEMA_VERSION.to_owned(),
            plan_digest: plan.plan_digest.clone(),
            observation_digest: "0".repeat(64),
            policy_digest: "local-operator-policy-v1".to_owned(),
            audience: approved_audience,
            approver: "operator".to_owned(),
            generator_is_approver: true,
            issued_at_ms: now_ms,
            expires_at_ms: now_ms + 86_400_000,
            operation_id: new_operation_id(),
        }
    }

    fn seeded_db() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory db");
        db.apply_schema(predecessor_schema()).expect("apply schema");
        db.seed(SeedData {
            tables: BTreeMap::from([(
                "items".to_owned(),
                vec![
                    json!({ "title": "one" }).as_object().cloned().unwrap(),
                    json!({ "title": "two" }).as_object().cloned().unwrap(),
                ],
            )]),
        })
        .expect("seed");
        db
    }

    fn apply_fixture(
        db: &mut LocalDatabase,
        plan: &MigrationPlanArtifactV1,
        approval: &MigrationApprovalV1,
    ) -> SnapbackResult<MigrationReceiptV1> {
        let (_, resolved) = audience();
        let successor = successor_schema();
        db.migrate_apply(MigrationApplyRequest {
            artifact: plan,
            approval,
            successor_schema: &successor,
            audience: &resolved,
            now_ms: now_millis(),
        })
    }

    // @ref LLP 0081#4-execution-journaling-and-crash-recovery — the happy
    //   path end to end: admission, barrier, batched backfill, validation,
    //   one publication transaction (successor manifest + version boundary
    //   + retention floor + the typed schema-resync journal row), the
    //   published-held → released exit, the sealed receipt, and the §4
    //   system-identity rules for changed rows.
    #[test]
    fn migrate_apply_end_to_end_publishes_and_releases() {
        let mut db = seeded_db();
        let head_before = db.current_version().expect("head");
        let plan = fixture_plan(&predecessor_schema(), &successor_schema(), default_ceilings());
        let approval = approval_for(&plan, now_millis());
        let receipt = apply_fixture(&mut db, &plan, &approval).expect("apply");

        assert_eq!(receipt.state.kind(), "released");
        assert_eq!(receipt.error_code, None);
        let publication = receipt.publication_version.expect("publication version");
        assert_eq!(publication, head_before + 1, "exactly one successor version");
        assert_eq!(db.current_version().expect("head"), publication);
        assert!(db.migration_fence().expect("fence read").is_none());

        // Successor schema is authoritative and the rows carry the §4
        // identity rules: changed rows get the publication version and the
        // plan's explicit publication timestamp.
        assert!(db.schema().table("items").expect("items").field("note").is_some());
        let rows = db
            .query(
                &QueryPlan {
                    table: "items".to_owned(),
                    filters: Vec::new(),
                    membership_filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    indexed_by: None,
                },
                &HandlerInput::default(),
            )
            .expect("read items")
            .rows;
        assert_eq!(rows.len(), 2);
        for row in &rows {
            assert_eq!(row["note"], json!("n/a"));
            assert_eq!(row["_version"].as_u64(), Some(publication));
            assert_eq!(row["_updatedAt"].as_u64(), Some(PUBLICATION_TS));
        }

        // The schema-resync journal row keeps the head/high-water cut.
        let resync: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM _snapback_changes WHERE table_name = ?1 AND op = ?2",
                params![SCHEMA_TRANSITION_JOURNAL_TABLE, SCHEMA_RESYNC_OP],
                |row| row.get(0),
            )
            .expect("resync count");
        assert_eq!(resync, 1);

        // Receipt is the journal's sealed projection and verify agrees.
        let verified = db
            .migration_verify_receipt(&approval.operation_id)
            .expect("verify");
        assert_eq!(verified["state"], json!("released"));

        // Replaying the completed operation returns the prior receipt.
        let replay = apply_fixture(&mut db, &plan, &approval).expect("replay");
        assert_eq!(replay, receipt);

        // The same plan under a NEW approval is stale against the
        // completed predecessor identity.
        let second = approval_for(&plan, now_millis());
        let error = apply_fixture(&mut db, &plan, &second).expect_err("stale");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PLAN_STALE");
    }

    // @ref LLP 0081#4-execution-journaling-and-crash-recovery — the
    //   persisted fence closes every registered storage lane per admission
    //   and survives reopen: a crash between reopen and resume cannot
    //   readmit application traffic.
    #[test]
    fn migration_fence_closes_lanes_and_survives_reopen() {
        let mut db = seeded_db();
        // Manufacture an admitted-but-unfinished operation: fence + ops row.
        {
            let tx = db
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .expect("tx");
            ensure_migration_tables(&tx).expect("tables");
            upsert_meta(&tx, META_MIGRATION_LEASE_EPOCH, "1").expect("epoch");
            upsert_meta(
                &tx,
                META_MIGRATION_FENCE,
                &serde_json::to_string(&MigrationFenceV1 {
                    operation_id: "operation-v1:test".to_owned(),
                    lease_epoch: 1,
                    closed_at_ms: 1,
                })
                .expect("fence json"),
            )
            .expect("fence");
            tx.execute(
                "INSERT INTO _snapback_migration_ops(operation_id, audience_json, plan_digest, \
                 state_json, lease_epoch, cancel_requested) VALUES(?1, '{}', 'd', ?2, 1, 0)",
                params![
                    "operation-v1:test",
                    serde_json::to_string(&MigrationExecState::Barriered).unwrap()
                ],
            )
            .expect("ops row");
            tx.commit().expect("commit");
        }

        // Mutation lane refuses.
        let mutation = crate::manifest::MutationPlan {
            steps: vec![crate::manifest::MutationStep::Insert {
                table: "items".to_owned(),
                values: BTreeMap::from([(
                    "title".to_owned(),
                    ValueExpr::Literal(json!("three")),
                )]),
                bind_id_as: None,
            }],
            return_value: None,
        };
        let error = db
            .execute_mutation(&mutation, &HandlerInput::default())
            .expect_err("fenced mutation");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_FENCE_CLOSED");

        // Query lane refuses.
        let error = db
            .query(
                &QueryPlan {
                    table: "items".to_owned(),
                    filters: Vec::new(),
                    membership_filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    indexed_by: None,
                },
                &HandlerInput::default(),
            )
            .expect_err("fenced query");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_FENCE_CLOSED");

        // Buffered (Ibex) lane refuses.
        let error = db
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![crate::storage::BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: "x".to_owned(),
                    values: serde_json::Map::new(),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect_err("fenced buffered commit");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_FENCE_CLOSED");

        // The durable fence is visible to reopen-time construction.
        assert!(db.migration_fence().expect("fence").is_some());
    }

    // Stale fencing token: a superseded executor cannot advance the machine.
    #[test]
    fn stale_lease_epoch_cannot_append() {
        let mut db = seeded_db();
        {
            let tx = db
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .expect("tx");
            ensure_migration_tables(&tx).expect("tables");
            upsert_meta(&tx, META_MIGRATION_LEASE_EPOCH, "2").expect("epoch");
            tx.execute(
                "INSERT INTO _snapback_migration_ops(operation_id, audience_json, plan_digest, \
                 state_json, lease_epoch, cancel_requested) VALUES(?1, '{}', 'd', ?2, 2, 0)",
                params![
                    "operation-v1:stale",
                    serde_json::to_string(&MigrationExecState::Admitted).unwrap()
                ],
            )
            .expect("ops row");
            let stale = JournalHandle {
                tx: &tx,
                operation_id: "operation-v1:stale".to_owned(),
                plan_id: "migration-v1:x".to_owned(),
                lease_epoch: 1,
                input_version: 0,
            };
            let error = stale
                .append(JournalAppend {
                    at_ms: 1,
                    ..JournalAppend::of(&MigrationExecState::Admitted)
                })
                .expect_err("stale token");
            assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_EXECUTOR_STALE");
            tx.commit().expect("commit");
        }
    }

    // A transition outside the enumerated relation is refused as corruption.
    #[test]
    fn transition_outside_the_relation_is_corruption() {
        let mut db = seeded_db();
        let tx = db
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .expect("tx");
        ensure_migration_tables(&tx).expect("tables");
        upsert_meta(&tx, META_MIGRATION_LEASE_EPOCH, "1").expect("epoch");
        tx.execute(
            "INSERT INTO _snapback_migration_ops(operation_id, audience_json, plan_digest, \
             state_json, lease_epoch, cancel_requested) VALUES(?1, '{}', 'd', ?2, 1, 0)",
            params![
                "operation-v1:bad",
                serde_json::to_string(&MigrationExecState::Admitted).unwrap()
            ],
        )
        .expect("ops row");
        let journal = JournalHandle {
            tx: &tx,
            operation_id: "operation-v1:bad".to_owned(),
            plan_id: "migration-v1:x".to_owned(),
            lease_epoch: 1,
            input_version: 0,
        };
        journal
            .append(JournalAppend {
                at_ms: 1,
                ..JournalAppend::of(&MigrationExecState::Admitted)
            })
            .expect("admitted");
        let error = journal
            .append(JournalAppend {
                at_ms: 2,
                ..JournalAppend::of(&MigrationExecState::Released)
            })
            .expect_err("admitted -> released is outside the relation");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_JOURNAL_CORRUPT");
    }

    // Admission refusals: ceilings, timestamp floor, audience, staleness,
    // approval binding, expiry.
    #[test]
    fn admission_refusals_hold() {
        // Resource-ceiling drift refuses at admission.
        let mut db = seeded_db();
        let mut tight = default_ceilings();
        tight.max_affected_rows = 1;
        let plan = fixture_plan(&predecessor_schema(), &successor_schema(), tight);
        let approval = approval_for(&plan, now_millis());
        let error = apply_fixture(&mut db, &plan, &approval).expect_err("ceiling");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PRECONDITION_FAILED");
        // The refused admission left no fence behind.
        assert!(db.migration_fence().expect("fence").is_none());

        // publicationTimestamp behind an existing _updatedAt refuses.
        let mut db = seeded_db();
        db.conn
            .execute("UPDATE items SET _updatedAt = ?1", params![
                timestamp_to_sql_millis(PUBLICATION_TS + 5).unwrap()
            ])
            .expect("bump updatedAt");
        let plan = fixture_plan(&predecessor_schema(), &successor_schema(), default_ceilings());
        let approval = approval_for(&plan, now_millis());
        let error = apply_fixture(&mut db, &plan, &approval).expect_err("timestamp floor");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PRECONDITION_FAILED");

        // Audience mismatch.
        let mut db = seeded_db();
        let plan = fixture_plan(&predecessor_schema(), &successor_schema(), default_ceilings());
        let mut approval = approval_for(&plan, now_millis());
        approval.audience.database_id = "db-other".to_owned();
        let error = apply_fixture(&mut db, &plan, &approval).expect_err("audience");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_TARGET_MISMATCH");

        // Approval binding a different plan digest.
        let mut db = seeded_db();
        let plan = fixture_plan(&predecessor_schema(), &successor_schema(), default_ceilings());
        let mut approval = approval_for(&plan, now_millis());
        approval.plan_digest = "0".repeat(64);
        let error = apply_fixture(&mut db, &plan, &approval).expect_err("binding");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_APPROVAL_REQUIRED");

        // Expired approval refuses fresh admission.
        let mut db = seeded_db();
        let plan = fixture_plan(&predecessor_schema(), &successor_schema(), default_ceilings());
        let mut approval = approval_for(&plan, 1_000);
        approval.expires_at_ms = 2_000;
        let error = apply_fixture(&mut db, &plan, &approval).expect_err("expired");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_APPROVAL_REQUIRED");

        // Predecessor schema drift is stale.
        let mut db = LocalDatabase::memory().expect("memory db");
        let mut drifted = predecessor_schema();
        drifted.tables[0].fields.push(FieldManifest {
            name: "extra".to_owned(),
            field_type: FieldType::String,
            optional: true,
        });
        db.apply_schema(drifted).expect("apply drifted");
        let plan = fixture_plan(&predecessor_schema(), &successor_schema(), default_ceilings());
        let approval = approval_for(&plan, now_millis());
        let (_, resolved) = audience();
        let successor = successor_schema();
        let error = db
            .migrate_apply(MigrationApplyRequest {
                artifact: &plan,
                approval: &approval,
                successor_schema: &successor,
                audience: &resolved,
                now_ms: now_millis(),
            })
            .expect_err("stale predecessor");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PLAN_STALE");
    }

    // Downtime ceiling: a zero ceiling aborts safely pre-publication — the
    // predecessor stays authoritative, the fence clears, and the journal
    // reaches a terminal state carrying the barrier failure.
    #[test]
    fn downtime_ceiling_aborts_safely_before_publication() {
        let mut db = seeded_db();
        let head_before = db.current_version().expect("head");
        let mut ceilings = default_ceilings();
        ceilings.max_barrier_downtime_ms = 0;
        let plan = fixture_plan(&predecessor_schema(), &successor_schema(), ceilings);
        let approval = approval_for(&plan, now_millis());
        let error = apply_fixture(&mut db, &plan, &approval).expect_err("ceiling abort");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_BARRIER_FAILED");
        assert!(db.migration_fence().expect("fence").is_none());
        assert_eq!(db.current_version().expect("head"), head_before);
        assert!(db.schema().table("items").expect("items").field("note").is_none());
        let state = latest_state_for_test(&db, &approval.operation_id)
            .expect("state")
            .expect("journaled");
        assert_eq!(state.kind(), "cancelled");
        let receipt = db
            .migration_receipt(&approval.operation_id)
            .expect("receipt read")
            .expect("terminal receipt");
        assert_eq!(
            receipt.error_code.as_deref(),
            Some("SNAPBACK_MIGRATION_BARRIER_FAILED")
        );
    }

    // Cancellation is admitted at pre-publication boundaries and reaches
    // `cancelled` with a terminal receipt; a second migration cannot own
    // the app while one is non-terminal.
    #[test]
    fn cancellation_and_exclusivity() {
        let mut db = seeded_db();
        let plan = fixture_plan(&predecessor_schema(), &successor_schema(), default_ceilings());
        let approval = approval_for(&plan, now_millis());
        // Manufacture an admitted non-terminal operation with a cancel
        // request already recorded, then resume: the executor honors the
        // cancel at its first boundary.
        {
            let tx = db
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .expect("tx");
            ensure_migration_tables(&tx).expect("tables");
            upsert_meta(&tx, META_MIGRATION_LEASE_EPOCH, "1").expect("epoch");
            upsert_meta(
                &tx,
                META_MIGRATION_FENCE,
                &serde_json::to_string(&MigrationFenceV1 {
                    operation_id: approval.operation_id.clone(),
                    lease_epoch: 1,
                    closed_at_ms: 1,
                })
                .expect("fence json"),
            )
            .expect("fence");
            tx.execute(
                "INSERT INTO _snapback_migration_ops(operation_id, audience_json, plan_digest, \
                 state_json, lease_epoch, cancel_requested) VALUES(?1, '{}', ?2, ?3, 1, 0)",
                params![
                    approval.operation_id,
                    plan.plan_digest,
                    serde_json::to_string(&MigrationExecState::Barriered).unwrap()
                ],
            )
            .expect("ops row");
            let journal = JournalHandle {
                tx: &tx,
                operation_id: approval.operation_id.clone(),
                plan_id: plan.plan_id.clone(),
                lease_epoch: 1,
                input_version: 1,
            };
            let at = now_millis();
            journal
                .append(JournalAppend {
                    at_ms: at,
                    ..JournalAppend::of(&MigrationExecState::Admitted)
                })
                .expect("admitted");
            journal
                .append(JournalAppend {
                    at_ms: at,
                    ..JournalAppend::of(&MigrationExecState::Barriered)
                })
                .expect("barriered");
            tx.commit().expect("commit");
        }
        // Exclusivity: a different operation refuses while this one is open.
        let other_plan =
            fixture_plan(&predecessor_schema(), &successor_schema(), default_ceilings());
        let other = approval_for(&other_plan, now_millis());
        let error = apply_fixture(&mut db, &other_plan, &other).expect_err("exclusive");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MIGRATION_EXECUTOR_UNAVAILABLE"
        );

        db.migrate_request_cancel(&approval.operation_id)
            .expect("request cancel");
        let error = apply_fixture(&mut db, &plan, &approval).expect_err("cancelled");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_CANCELLED");
        let state = latest_state_for_test(&db, &approval.operation_id)
            .expect("state")
            .expect("journaled");
        assert_eq!(state.kind(), "cancelled");
        assert!(db.migration_fence().expect("fence").is_none());
    }

    // A crash while published-held reopens still fenced; re-running apply
    // is the explicit release decision, and the successor becomes
    // authoritative exactly once.
    #[test]
    fn published_held_resume_releases() {
        let mut db = seeded_db();
        let plan = fixture_plan(&predecessor_schema(), &successor_schema(), default_ceilings());
        let approval = approval_for(&plan, now_millis());

        // Run the real executor up to publication by replaying the
        // happy-path prefix, then rewind the release: simulate the crash by
        // reconstructing the journal at published-held with the fence
        // still closed.
        let receipt = apply_fixture(&mut db, &plan, &approval).expect("apply");
        assert_eq!(receipt.state.kind(), "released");
        let publication = receipt.publication_version.expect("publication");

        // Manufacture the held state for a SECOND operation over the
        // successor: journal shows published-held with its output version
        // and the fence closed — resume must release, not re-execute.
        let successor = successor_schema();
        let plan2 = {
            let intents = vec![MigrationIntent::AddOptionalField {
                table: "items".to_owned(),
                field: "flag".to_owned(),
                field_type: FieldType::String,
            }];
            let mut wider = successor.clone();
            wider.tables[0].fields.push(FieldManifest {
                name: "flag".to_owned(),
                field_type: FieldType::String,
                optional: true,
            });
            let steps = derive_plan_steps(&wider, &intents).expect("derive");
            let mut body = fixture_plan(&successor, &wider, default_ceilings()).body;
            body.steps = steps;
            body.predecessor_schema_hash = schema_identity(&successor).expect("id");
            body.successor_schema_hash = schema_identity(&wider).expect("id");
            body.expected_output.schema_hash = schema_identity(&wider).expect("id");
            (MigrationPlanArtifactV1::seal(body).expect("seal"), wider)
        };
        let (plan2, wider) = plan2;
        let approval2 = approval_for(&plan2, now_millis());
        {
            let tx = db
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .expect("tx");
            upsert_meta(&tx, META_MIGRATION_LEASE_EPOCH, "9").expect("epoch");
            upsert_meta(
                &tx,
                META_MIGRATION_FENCE,
                &serde_json::to_string(&MigrationFenceV1 {
                    operation_id: approval2.operation_id.clone(),
                    lease_epoch: 9,
                    closed_at_ms: 1,
                })
                .expect("fence json"),
            )
            .expect("fence");
            tx.execute(
                "INSERT INTO _snapback_migration_ops(operation_id, audience_json, plan_digest, \
                 state_json, lease_epoch, cancel_requested) VALUES(?1, '{}', ?2, ?3, 9, 0)",
                params![
                    approval2.operation_id,
                    plan2.plan_digest,
                    serde_json::to_string(&MigrationExecState::PublishedHeld).unwrap()
                ],
            )
            .expect("ops row");
            let journal = JournalHandle {
                tx: &tx,
                operation_id: approval2.operation_id.clone(),
                plan_id: plan2.plan_id.clone(),
                lease_epoch: 9,
                input_version: publication,
            };
            journal
                .append(JournalAppend {
                    at_ms: 1,
                    ..JournalAppend::of(&MigrationExecState::Admitted)
                })
                .expect("admitted");
            journal
                .append(JournalAppend {
                    at_ms: 1,
                    ..JournalAppend::of(&MigrationExecState::Barriered)
                })
                .expect("barriered");
            journal
                .append(JournalAppend {
                    at_ms: 1,
                    ..JournalAppend::of(&MigrationExecState::Verifying)
                })
                .expect("verifying");
            journal
                .append(JournalAppend {
                    output_version: Some(publication + 1),
                    at_ms: 1,
                    ..JournalAppend::of(&MigrationExecState::PublishedHeld)
                })
                .expect("held");
            tx.commit().expect("commit");
        }
        // Fenced while held.
        assert!(db.migration_fence().expect("fence").is_some());
        // Cancellation from published-held is refused.
        let error = db
            .migrate_request_cancel(&approval2.operation_id)
            .expect_err("held cancel");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE"
        );
        // Resume releases explicitly.
        let (_, resolved) = audience();
        let released = db
            .migrate_apply(MigrationApplyRequest {
                artifact: &plan2,
                approval: &approval2,
                successor_schema: &wider,
                audience: &resolved,
                now_ms: now_millis(),
            })
            .expect("release");
        assert_eq!(released.state.kind(), "released");
        assert!(db.migration_fence().expect("fence").is_none());
    }
}
