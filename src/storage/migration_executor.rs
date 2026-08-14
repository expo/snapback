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
    KeysetAfter, LocalDatabase, MIGRATION_SCAN_MAX_BATCH_BYTES, MIGRATION_SCAN_MAX_BATCH_ROWS,
    MigrationKeysetScanBatch, MigrationKeysetScanCheckpointV1, MigrationKeysetScanRequestV1,
    MigrationScanCeilingsV1, MigrationScanValidatorStateV1, MigrationScanValidatorV1, QueryPlan,
    create_index, create_or_update_table, current_version_on,
    ensure_managed_version_integrity_indexes, eval_expr, next_storage_version, now_millis,
    quote_ident, save_retention_floor_on, schema_table, set_version, sqlite_type,
    timestamp_to_sql_millis, version_to_sql_integer,
};
use crate::commit_envelope::{
    CommitEnvelopeV1, EnvelopeAuthorityFactsV1, EnvelopeCoverageV1, EnvelopeEffectFactsV1,
    EnvelopeFactSetV1, FactProvenanceV1, LaneFactV1, OperationBoundFactsV1, OperationIdentityV1,
    OperationIssuanceV1, OperationKeyV1, OperationOriginatorClassV1, OperationReceiptStateV1,
    OperationReceiptV1, PendingOperationLifecycleV1, PendingOperationTerminalOutcomeV1,
    PendingOperationTerminalSupplementV1, RetainedEnvelopeDetailV1, SnapshotAssociationKindV1,
    StreamQualifiedVersionV1, derive_host_operation_id,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{
    BinaryOp, FieldManifest, HandlerInput, SchemaManifest, TableManifest, UnaryOp, ValueExpr,
};
use crate::migration::{
    MigrationAdmissionV1, MigrationApprovalV1, MigrationAudienceV1, MigrationExecutionStrategy,
    MigrationPlanArtifactV1, MigrationStep, admission_digest, approval_digest,
    validate_approval_shape, validate_plan_artifact, validate_plan_artifact_seal,
};
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Map;
use serde_json::{Value, json};
use std::cell::OnceCell;
use std::collections::{BTreeMap, BTreeSet};

#[cfg(test)]
type MigrationExecutionValueHook = Box<dyn FnMut(&str, Value) -> Value>;

#[cfg(test)]
thread_local! {
    static MIGRATION_EXECUTION_VALUE_HOOK: std::cell::RefCell<Option<MigrationExecutionValueHook>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn install_migration_execution_value_hook(hook: impl FnMut(&str, Value) -> Value + 'static) {
    MIGRATION_EXECUTION_VALUE_HOOK.with(|slot| {
        assert!(
            slot.borrow().is_none(),
            "migration execution hook is exclusive"
        );
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

#[cfg(test)]
fn clear_migration_execution_value_hook() {
    MIGRATION_EXECUTION_VALUE_HOOK.with(|slot| *slot.borrow_mut() = None);
}

fn run_migration_execution_value_hook(field: &str, value: Value) -> Value {
    #[cfg(not(test))]
    let _ = field;
    #[cfg(test)]
    return MIGRATION_EXECUTION_VALUE_HOOK.with(|slot| {
        slot.borrow_mut()
            .as_mut()
            .map_or(value.clone(), |hook| hook(field, value))
    });
    #[cfg(not(test))]
    value
}

pub const MIGRATION_JOURNAL_SCHEMA_VERSION: &str = "migration-journal-v1";
const MIGRATION_HOST_AUTHORITY_INSTANCE_ID_V1: &str = "snapback:migration-executor:v1";
const MIGRATION_HOST_OPERATION_KIND_V1: &str = "migrationTransition";
const MIGRATION_AGGREGATE_LANE_V1: &str = "migrationAggregate";
/// Per-transaction children consume journal-row ordinals from zero upward.
/// The aggregate reserves the unreachable maximum ordinal so its identity is
/// deterministic from the approval operation id without colliding with H1/H2
/// or cleanup transaction carriers.
const MIGRATION_AGGREGATE_COMMIT_ORDINAL_V1: u64 = u64::MAX;
const MIGRATION_PENDING_CAPACITY_V1: u64 = 1;

/// The reserved change-journal table name for schema-transition events.
/// The schema-transition vocabulary now lives with the journal grammar in
/// `crate::storage` (the LLP 0007 amendment made it first-class); these
/// aliases keep the executor's witness sites stable.
#[cfg(test)]
pub use crate::storage::SCHEMA_TRANSITION_JOURNAL_TABLE;
#[cfg(test)]
pub const SCHEMA_RESYNC_OP: &str = crate::storage::SchemaTransitionKind::SchemaResync.as_op();

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
        ("verifying", "verifying"),
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
    // @ref LLP 0163#contract-summary-normative-details-per-llp-0162-0-2 — migration journal
    //   transactions carry authenticated approval-derived host identities,
    //   but stay uncovered until their publication/terminal cuts are atomic.
    /// Authenticated host identity of the physical SQLite transaction that
    /// appended this row. Legacy entries remain readable without one; a new
    /// transaction shares one value across every row it appends.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_operation_identity: Option<OperationIdentityV1>,
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
    /// §7: a rehearsal execution's journal and receipt are marked; a
    /// rehearsal receipt can never satisfy or replay as production apply.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub rehearsal: bool,
    /// Wall time of the final journal entry — the freshness anchor the
    /// production admission checks against the profile's rehearsal max age.
    #[serde(default)]
    pub completed_at_ms: u64,
}

pub const MIGRATION_RECEIPT_SCHEMA_VERSION: &str = "migration-receipt-v1";

/// §7's default recoverability-preflight max age: seven days.
pub const MIGRATION_REHEARSAL_MAX_AGE_MS: u64 = 7 * 24 * 60 * 60 * 1_000;

/// The digest-sealed record of one §6 fast rollback (`generationRepublish`):
/// the republished predecessor generation, the new application version `R`,
/// what was physically restored, and the journal seal. The original forward
/// receipt remains immutable; replaying the completed rollback returns this.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationRollbackReceiptV1 {
    pub version: String,
    pub operation_id: String,
    pub plan_digest: String,
    pub approval_digest: String,
    /// The one new application version the republish allocated.
    pub republished_version: u64,
    pub rollback_timestamp_ms: u64,
    /// The advanced predecessor storage generation; re-migrating requires a
    /// fresh preview bound to it.
    pub restored_storage_generation: u64,
    /// Staged tables restored by physical rename — byte-exact republish.
    pub staged_tables_restored: Vec<String>,
    /// In-place tables whose new columns were cleared and whose unchanged
    /// rows' system fields were restored from the pre-migration checkpoint.
    pub in_place_tables_restored: Vec<String>,
    /// Rows restamped to `R` (§6): zero under full restoration — nothing
    /// user-visible changed from successor back to predecessor beyond the
    /// restoration itself.
    pub restamped_rows: u64,
    pub journal_entries: u64,
    pub journal_digest: String,
}

pub const MIGRATION_ROLLBACK_RECEIPT_SCHEMA_VERSION: &str = "migration-rollback-receipt-v1";

// ---------------------------------------------------------------------------
// Durable fence + lease
// ---------------------------------------------------------------------------

const META_MIGRATION_FENCE: &str = "migration_fence";
const META_MIGRATION_LEASE_EPOCH: &str = "migration_lease_epoch";
const META_STORAGE_GENERATION: &str = "migration_storage_generation";

/// Tables any plan step writes in place (as opposed to a staged
/// generation): the pre-migration checkpoint and the fast rollback's
/// restoration both key on this set.
fn in_place_written_tables(artifact: &MigrationPlanArtifactV1) -> BTreeSet<String> {
    let mut tables = BTreeSet::new();
    for record in &artifact.body.steps {
        match &record.step {
            MigrationStep::AddField { table, .. }
            | MigrationStep::BackfillField { table, .. }
            | MigrationStep::CopyField { table, .. } => {
                tables.insert(table.clone());
            }
            _ => {}
        }
    }
    tables
}

/// In-place destination columns per table — the fast rollback nulls exactly
/// these (they are NEW columns; the §5 proof domain enforces that).
fn in_place_written_columns(artifact: &MigrationPlanArtifactV1) -> Vec<(String, String)> {
    let mut columns = Vec::new();
    for record in &artifact.body.steps {
        match &record.step {
            MigrationStep::AddField { table, field, .. }
            | MigrationStep::BackfillField { table, field, .. }
            | MigrationStep::CopyField { table, field, .. } => {
                columns.push((table.clone(), field.clone()));
            }
            _ => {}
        }
    }
    columns
}

/// A manifest-absent field is not necessarily a fresh physical destination:
/// logical retirement deliberately retains its column through the rollback
/// window. A fresh operation therefore refuses any AddField destination that
/// already exists physically. A resume may accept an existing column only
/// when this exact operation journaled the corresponding AddField in the same
/// transaction that created it; an ops/fence row alone grants no exception.
///
/// @ref LLP 0081#3-typed-migration-steps — v1 in-place backfill/copy targets
///   a new destination; retained predecessor bytes cannot become its seed.
fn enforce_fresh_add_field_destinations(
    tx: &Transaction<'_>,
    artifact: &MigrationPlanArtifactV1,
    operation_id: &str,
) -> SnapbackResult<()> {
    let committed_steps = journal_entries_on(tx, operation_id)?
        .into_iter()
        .filter_map(|entry| {
            let step_id = entry.step_id?;
            match entry.state {
                MigrationExecState::Executing { step, .. }
                    if step == step_id && entry.plan_id == artifact.plan_id =>
                {
                    Some(step_id)
                }
                _ => None,
            }
        })
        .collect::<BTreeSet<_>>();
    for record in &artifact.body.steps {
        let MigrationStep::AddField { table, field, .. } = &record.step else {
            continue;
        };
        let physically_exists = super::physical_columns(tx, table)?.contains_key(field);
        let committed_by_this_step = committed_steps.contains(&record.id);
        if physically_exists && !committed_by_this_step {
            return Err(precondition_failed(format!(
                "step {} requires fresh physical destination {table}.{field}, but that column already exists; use fresh successor storage rather than re-adopting retained bytes",
                record.id
            )));
        }
        if !physically_exists && committed_by_this_step {
            return Err(journal_corrupt(format!(
                "step {} is journaled as committed but physical destination {table}.{field} is absent",
                record.id
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
thread_local! {
    /// Armed kill point: (state kind, remaining matching appends before the
    /// simulated crash). The panic unwinds through the open transaction —
    /// exactly a process death at that durable transition's interior.
    static MIGRATION_KILL_POINT: std::cell::RefCell<Option<(String, u32)>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
pub(crate) fn arm_migration_kill_point(state_kind: &str, nth: u32) {
    MIGRATION_KILL_POINT.with(|slot| {
        *slot.borrow_mut() = Some((state_kind.to_owned(), nth));
    });
}

#[cfg(test)]
pub(crate) fn disarm_migration_kill_point() {
    MIGRATION_KILL_POINT.with(|slot| *slot.borrow_mut() = None);
}

#[cfg(test)]
fn kill_point_check(state_kind: &str) {
    let fire = MIGRATION_KILL_POINT.with(|slot| {
        let mut armed = slot.borrow_mut();
        match armed.as_mut() {
            Some((kind, remaining)) if kind == state_kind => {
                if *remaining == 0 {
                    *armed = None;
                    true
                } else {
                    *remaining -= 1;
                    false
                }
            }
            _ => false,
        }
    });
    if fire {
        panic!("migration kill point: simulated crash inside the {state_kind} transition");
    }
}

#[cfg(not(test))]
fn kill_point_check(_state_kind: &str) {}

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
            serde_json::from_str(&raw)
                .map_err(|_| journal_corrupt("persisted migration fence does not parse".to_owned()))
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
           predecessor_schema_json TEXT,
           state_json TEXT NOT NULL,
           lease_epoch INTEGER NOT NULL,
           cancel_requested INTEGER NOT NULL DEFAULT 0,
           receipt_json TEXT,
           rollback_receipt_json TEXT,
           approval_digest TEXT,
           aggregate_identity_json TEXT
         );
         CREATE TABLE IF NOT EXISTS _snapback_migration_checkpoint (
           operation_id TEXT NOT NULL,
           table_name TEXT NOT NULL,
           row_id TEXT NOT NULL,
           version INTEGER NOT NULL,
           updated_at INTEGER NOT NULL,
           PRIMARY KEY (operation_id, table_name, row_id)
         );",
    )?;
    // A Wave-2 journal predates the rollback-receipt column; additive and
    // idempotent, tolerated as already-present.
    match tx.execute(
        "ALTER TABLE _snapback_migration_ops ADD COLUMN rollback_receipt_json TEXT",
        [],
    ) {
        Ok(_) => {}
        Err(error) if error.to_string().contains("duplicate column name") => {}
        Err(error) => return Err(error.into()),
    }
    // §7 rehearsal marking: same additive-idempotent posture as every
    // ops-table extension.
    match tx.execute(
        "ALTER TABLE _snapback_migration_ops ADD COLUMN rehearsal INTEGER NOT NULL DEFAULT 0",
        [],
    ) {
        Ok(_) => {}
        Err(error) if error.to_string().contains("duplicate column name") => {}
        Err(error) => return Err(error.into()),
    }
    for column in [
        "approval_digest TEXT",
        "aggregate_identity_json TEXT",
        "predecessor_schema_json TEXT",
    ] {
        match tx.execute(
            &format!("ALTER TABLE _snapback_migration_ops ADD COLUMN {column}"),
            [],
        ) {
            Ok(_) => {}
            Err(error) if error.to_string().contains("duplicate column name") => {}
            Err(error) => return Err(error.into()),
        }
    }
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
    host_operation_identity: OnceCell<OperationIdentityV1>,
}

impl JournalHandle<'_> {
    fn latest_state(&self) -> SnapbackResult<Option<MigrationExecState>> {
        latest_state_on(self.tx, &self.operation_id)
    }

    fn host_operation_identity(&self, issued_at_ms: u64) -> SnapbackResult<&OperationIdentityV1> {
        if self.host_operation_identity.get().is_none() {
            let stream_id = crate::seed_identity::strict_current_data_version_stream(self.tx)?
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_OPERATION_STREAM_UNAVAILABLE",
                        "storage",
                        "migration host identity requires an initialized data-version stream",
                    )
                })?;
            let prior_journal_rows: i64 = self.tx.query_row(
                "SELECT COUNT(*) FROM _snapback_migration_journal WHERE operation_id=?1",
                [&self.operation_id],
                |row| row.get(0),
            )?;
            let commit_ordinal = u64::try_from(prior_journal_rows).map_err(|_| {
                journal_corrupt("migration host child ordinal overflowed".to_owned())
            })?;
            let authority = crate::operation_ledger::ensure_host_incarnation_in(
                self.tx,
                &stream_id,
                MIGRATION_HOST_AUTHORITY_INSTANCE_ID_V1,
                issued_at_ms,
            )?;
            let issuance = OperationIssuanceV1::HostIncarnation {
                epoch_id: authority.epoch_id,
                upstream_identity: self.operation_id.clone(),
                commit_ordinal,
                authority_authenticator_digest: authority.authority_authenticator_digest,
            };
            let identity = OperationIdentityV1 {
                schema_version: OperationIdentityV1::SCHEMA_VERSION,
                key: OperationKeyV1 {
                    stream_id,
                    originator_class: OperationOriginatorClassV1::Host,
                    operation_id: derive_host_operation_id(&self.operation_id, commit_ordinal),
                },
                issuance,
                bound_facts: OperationBoundFactsV1 {
                    audience: authority.audience,
                    principal_fingerprint: migration_host_digest(
                        b"snapback:migration-host-principal:v1\n",
                        &json!({ "operationId": self.operation_id }),
                    ),
                    authority_instance_id: authority.authority_instance_id,
                    operation_kind: MIGRATION_HOST_OPERATION_KIND_V1.to_owned(),
                    function_or_command: self.plan_id.clone(),
                    input_fingerprint: migration_host_digest(
                        b"snapback:migration-host-commit:v1\n",
                        &json!({
                            "commitOrdinal": commit_ordinal,
                            "inputVersion": self.input_version,
                            "operationId": self.operation_id,
                            "planId": self.plan_id,
                        }),
                    ),
                },
            };
            crate::operation_ledger::authenticate_host_identity(self.tx, &identity)?;
            self.host_operation_identity.set(identity).map_err(|_| {
                journal_corrupt("migration transaction identity initialized twice".to_owned())
            })?;
        }
        Ok(self
            .host_operation_identity
            .get()
            .expect("migration host identity initialized above"))
    }

    /// Append one durable transition. Validates the fencing token against
    /// the stored lease epoch and the transition against the closed
    /// relation before writing anything.
    fn append(&self, entry_fields: JournalAppend<'_>) -> SnapbackResult<()> {
        kill_point_check(entry_fields.state.kind());
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
        let host_operation_identity = self.host_operation_identity(entry_fields.at_ms)?.clone();
        let entry = MigrationJournalEntryV1 {
            version: MIGRATION_JOURNAL_SCHEMA_VERSION.to_owned(),
            operation_id: self.operation_id.clone(),
            plan_id: self.plan_id.clone(),
            host_operation_identity: Some(host_operation_identity),
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

fn migration_host_digest(domain: &[u8], value: &Value) -> String {
    use sha2::{Digest as _, Sha256};
    let mut digest = Sha256::new();
    digest.update(domain);
    digest.update(serde_json::to_vec(value).expect("migration host identity JSON serializes"));
    format!("sha256:{:x}", digest.finalize())
}

/// Provision the server-owned host epoch before a migration transaction can
/// consume a child ordinal. If that later transaction rolls back, retry sees
/// the same authenticated issuance facts as well as the same operation key.
fn ensure_migration_host_authority(conn: &mut Connection, issued_at_ms: u64) -> SnapbackResult<()> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let stream_id = super::auth_invalidation::ensure_data_version_stream_in(&tx)?;
    crate::operation_ledger::ensure_host_incarnation_in(
        &tx,
        &stream_id,
        MIGRATION_HOST_AUTHORITY_INSTANCE_ID_V1,
        issued_at_ms,
    )?;
    tx.commit()?;
    Ok(())
}

fn migration_aggregate_bound_facts(
    artifact: &MigrationPlanArtifactV1,
    approval: &MigrationApprovalV1,
    authority_audience: &str,
) -> SnapbackResult<OperationBoundFactsV1> {
    Ok(OperationBoundFactsV1 {
        audience: authority_audience.to_owned(),
        principal_fingerprint: migration_host_digest(
            b"snapback:migration-aggregate-principal:v1\n",
            &json!({
                "approver": approval.approver,
                "policyDigest": approval.policy_digest,
            }),
        ),
        authority_instance_id: MIGRATION_HOST_AUTHORITY_INSTANCE_ID_V1.to_owned(),
        operation_kind: MIGRATION_AGGREGATE_LANE_V1.to_owned(),
        function_or_command: artifact.plan_id.clone(),
        input_fingerprint: migration_host_digest(
            b"snapback:migration-aggregate-input:v1\n",
            &json!({
                "approvalDigest": approval_digest(approval)?,
                "operationId": approval.operation_id,
                "planDigest": artifact.plan_digest,
            }),
        ),
    })
}

/// Return the one aggregate identity persisted at H1. A resumed executor uses
/// those original authenticated issuance facts even if the host incarnation
/// rotated between P and T; only request-bound facts are re-derived and
/// compared.
fn migration_aggregate_identity_in(
    tx: &Transaction<'_>,
    artifact: &MigrationPlanArtifactV1,
    approval: &MigrationApprovalV1,
    issued_at_ms: u64,
) -> SnapbackResult<OperationIdentityV1> {
    let stream_id =
        crate::seed_identity::strict_current_data_version_stream(tx)?.ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_OPERATION_STREAM_UNAVAILABLE",
                "storage",
                "migration aggregate identity requires an initialized data-version stream",
            )
        })?;
    let stored: Option<Option<String>> = tx
        .query_row(
            "SELECT aggregate_identity_json FROM _snapback_migration_ops WHERE operation_id=?1",
            [&approval.operation_id],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(Some(stored)) = stored {
        let identity: OperationIdentityV1 = serde_json::from_str(&stored)
            .map_err(|_| journal_corrupt("aggregate identity does not parse".to_owned()))?;
        let recorded_audience = crate::operation_ledger::resolve_operation_audience_for_lookup(
            tx,
            &identity.issuance,
            MIGRATION_HOST_AUTHORITY_INSTANCE_ID_V1,
        )?;
        let expected_bound =
            migration_aggregate_bound_facts(artifact, approval, &recorded_audience)?;
        let exact_source = matches!(
            &identity.issuance,
            OperationIssuanceV1::HostIncarnation {
                upstream_identity,
                commit_ordinal,
                ..
            } if upstream_identity == &approval.operation_id
                && *commit_ordinal == MIGRATION_AGGREGATE_COMMIT_ORDINAL_V1
        );
        if identity.key.stream_id != stream_id
            || identity.key.originator_class != OperationOriginatorClassV1::Host
            || identity.key.operation_id
                != derive_host_operation_id(
                    &approval.operation_id,
                    MIGRATION_AGGREGATE_COMMIT_ORDINAL_V1,
                )
            || identity.bound_facts != expected_bound
            || !exact_source
        {
            return Err(SnapbackError::error(
                "SNAPBACK_CLIENT_MUTATION_ID_REUSED",
                "storage",
                "migration aggregate identity was reused with divergent approval, plan, audience, or principal facts",
            ));
        }
        return Ok(identity);
    }
    let authority = crate::operation_ledger::ensure_host_incarnation_in(
        tx,
        &stream_id,
        MIGRATION_HOST_AUTHORITY_INSTANCE_ID_V1,
        issued_at_ms,
    )?;
    let issuance = OperationIssuanceV1::HostIncarnation {
        epoch_id: authority.epoch_id,
        upstream_identity: approval.operation_id.clone(),
        commit_ordinal: MIGRATION_AGGREGATE_COMMIT_ORDINAL_V1,
        authority_authenticator_digest: authority.authority_authenticator_digest,
    };
    let identity = OperationIdentityV1 {
        schema_version: OperationIdentityV1::SCHEMA_VERSION,
        key: OperationKeyV1 {
            stream_id,
            originator_class: OperationOriginatorClassV1::Host,
            operation_id: derive_host_operation_id(
                &approval.operation_id,
                MIGRATION_AGGREGATE_COMMIT_ORDINAL_V1,
            ),
        },
        issuance,
        bound_facts: migration_aggregate_bound_facts(artifact, approval, &authority.audience)?,
    };
    crate::operation_ledger::authenticate_host_identity(tx, &identity)?;
    Ok(identity)
}

fn prefixed_migration_plan_digest(artifact: &MigrationPlanArtifactV1) -> String {
    format!("sha256:{}", artifact.plan_digest)
}

fn migration_fact_set(domain: &[u8], detail: Value, count: u64) -> EnvelopeFactSetV1 {
    EnvelopeFactSetV1 {
        digest: migration_host_digest(domain, &detail),
        count,
        provenance: FactProvenanceV1::ServerCaptured,
        detail: RetainedEnvelopeDetailV1::InlineRedacted { detail },
    }
}

/// P-side aggregate record. The caller has already published the live schema,
/// application version, and exact schema-transition row in this transaction.
#[allow(
    clippy::too_many_arguments,
    reason = "the pending aggregate commits independent migration facts in one transaction seam"
)]
fn record_migration_pending_aggregate_in(
    tx: &Transaction<'_>,
    artifact: &MigrationPlanArtifactV1,
    approval: &MigrationApprovalV1,
    aggregate_identity: &OperationIdentityV1,
    input_version: u64,
    publication_version: u64,
    transition_body: &crate::storage::SchemaTransitionEventBodyV1,
    recorded_at_ms: u64,
    lease_epoch: u64,
) -> SnapbackResult<()> {
    let transition_count: i64 = tx.query_row(
        "SELECT COUNT(*) FROM _snapback_changes
          WHERE version=?1 AND table_name=?2 AND row_id=?3 AND op=?4",
        params![
            version_to_sql_integer(publication_version)?,
            crate::storage::SCHEMA_TRANSITION_JOURNAL_TABLE,
            approval.operation_id,
            crate::storage::SchemaTransitionKind::SchemaResync.as_op(),
        ],
        |row| row.get(0),
    )?;
    if transition_count != 1 {
        return Err(journal_corrupt(format!(
            "publication P must contain exactly one schema-resync change row (found {transition_count})"
        )));
    }
    let pending_detail = json!({
        "outcome": "pending",
        "publicationVersion": publication_version,
        "state": "published-held",
    });
    let pending_payload = RetainedEnvelopeDetailV1::InlineRedacted {
        detail: pending_detail,
    };
    let retained_pending_projection = serde_json::to_value(&pending_payload)
        .map_err(|_| journal_corrupt("pending receipt projection serialize".to_owned()))?;
    let pending_receipt_digest =
        crate::operation_ledger::pending_operation_receipt_digest(&retained_pending_projection)?;
    let transition_detail = json!({
        "kind": "schema-resync",
        "version": publication_version,
        "body": transition_body,
    });
    let empty = json!([]);
    let coverage_digest = migration_host_digest(
        b"snapback:migration-aggregate-uncovered:v1\n",
        &json!({
            "covered": [],
            "lane": MIGRATION_AGGREGATE_LANE_V1,
            "uncovered": ["migrationTransitionH1", "migrationTransitionH2", "migrationCleanup"],
        }),
    );
    let envelope = CommitEnvelopeV1 {
        schema_version: CommitEnvelopeV1::SCHEMA_VERSION,
        identity: aggregate_identity.clone(),
        snapshot: StreamQualifiedVersionV1 {
            stream_id: aggregate_identity.key.stream_id.clone(),
            version: publication_version,
            association: SnapshotAssociationKindV1::ProducedCommit,
        },
        principal_session_or_invocation_id: approval.approver.clone(),
        authority: EnvelopeAuthorityFactsV1 {
            audience: aggregate_identity.bound_facts.audience.clone(),
            grant_or_policy_identity: LaneFactV1::Defined(approval.policy_digest.clone()),
            fencing_token_or_epoch: LaneFactV1::Defined(format!("migration-lease:{lease_epoch}")),
        },
        executable_artifact_digest: LaneFactV1::NotDefinedForLane,
        argument_digest: migration_host_digest(
            b"snapback:migration-aggregate-arguments:v1\n",
            &json!({
                "approvalDigest": approval_digest(approval)?,
                "operationId": approval.operation_id,
            }),
        ),
        plan_digest: LaneFactV1::Defined(prefixed_migration_plan_digest(artifact)),
        base_version: LaneFactV1::Defined(StreamQualifiedVersionV1 {
            stream_id: aggregate_identity.key.stream_id.clone(),
            version: input_version,
            association: SnapshotAssociationKindV1::ObservedSnapshot,
        }),
        read_set: migration_fact_set(
            b"snapback:migration-aggregate-read-set:v1\n",
            empty.clone(),
            0,
        ),
        write_set: migration_fact_set(
            b"snapback:migration-aggregate-write-set:v1\n",
            json!([transition_detail]),
            u64::try_from(transition_count)
                .map_err(|_| journal_corrupt("publication change count overflow".to_owned()))?,
        ),
        ctx_answers: migration_fact_set(b"snapback:migration-aggregate-ctx:v1\n", empty.clone(), 0),
        effects: EnvelopeEffectFactsV1 {
            facts: migration_fact_set(b"snapback:migration-aggregate-effects:v1\n", empty, 0),
            egress_families: Vec::new(),
            settlement_capabilities: Vec::new(),
        },
        receipt: OperationReceiptV1 {
            state: OperationReceiptStateV1::Pending,
            receipt_digest: pending_receipt_digest.clone(),
            payload: pending_payload,
        },
        coverage: EnvelopeCoverageV1 {
            covered_lanes: Vec::new(),
            uncovered_lanes: vec![MIGRATION_AGGREGATE_LANE_V1.to_owned()],
            coverage_digest,
        },
        recorded_at_ms,
    };
    let lifecycle = PendingOperationLifecycleV1 {
        schema_version: 1,
        lane: MIGRATION_AGGREGATE_LANE_V1.to_owned(),
        identity: aggregate_identity.clone(),
        publication: envelope.snapshot.clone(),
        pending_receipt_digest,
        pending_payload: retained_pending_projection,
        pending_at_ms: recorded_at_ms,
    };
    crate::operation_ledger::record_pending_operation_in(
        tx,
        &envelope,
        &lifecycle,
        MIGRATION_PENDING_CAPACITY_V1,
    )
}

/// T-side digest-linked supplement. The terminal projection is read back from
/// its owning migration receipt columns before this call, so the digest is
/// over retained bytes rather than a caller assertion. Returns false only for
/// a legacy published-held operation created before aggregate P records.
fn finalize_migration_aggregate_in(
    tx: &Transaction<'_>,
    aggregate_identity: &OperationIdentityV1,
    terminal_outcome: PendingOperationTerminalOutcomeV1,
    retained_terminal_projection: &Value,
    terminal_write_detail: &Value,
    terminal_write_count: u64,
    terminal_at_ms: u64,
) -> SnapbackResult<bool> {
    let terminal_write_set_digest = migration_host_digest(
        b"snapback:migration-aggregate-terminal-write-set:v1\n",
        terminal_write_detail,
    );
    let pending = match crate::operation_ledger::lookup_pending_operation(tx, aggregate_identity)? {
        crate::operation_ledger::PendingOperationLookupV1::Novel => return Ok(false),
        crate::operation_ledger::PendingOperationLookupV1::IdentityHorizonPassed => {
            return Err(SnapbackError::error(
                "SNAPBACK_OPERATION_IDENTITY_HORIZON_PASSED",
                "storage",
                "migration aggregate identity is below the retained Host outcome horizon",
            ));
        }
        crate::operation_ledger::PendingOperationLookupV1::Pending(pending) => pending,
        crate::operation_ledger::PendingOperationLookupV1::Terminal(existing) => {
            let expected = crate::operation_ledger::pending_operation_terminal_receipt_digest(
                retained_terminal_projection,
            )?;
            if existing.terminal_outcome == terminal_outcome
                && existing.terminal_receipt_digest == expected
                && existing.terminal_write_set_digest == terminal_write_set_digest
                && existing.terminal_write_set_count == terminal_write_count
            {
                return Ok(true);
            }
            return Err(SnapbackError::error(
                "SNAPBACK_OPERATION_TERMINAL_DIVERGED",
                "storage",
                "migration aggregate already has a different terminal supplement",
            ));
        }
    };
    let terminal_receipt_digest =
        crate::operation_ledger::pending_operation_terminal_receipt_digest(
            retained_terminal_projection,
        )?;
    let transition_digest = crate::operation_ledger::pending_operation_transition_digest(
        aggregate_identity,
        &pending.publication,
        &pending.pending_receipt_digest,
        terminal_outcome,
        &terminal_receipt_digest,
        &terminal_write_set_digest,
        terminal_write_count,
    );
    let supplement = PendingOperationTerminalSupplementV1 {
        schema_version: 1,
        identity: aggregate_identity.clone(),
        publication: pending.publication,
        pending_receipt_digest: pending.pending_receipt_digest,
        terminal_outcome,
        terminal_receipt_digest,
        terminal_write_set_digest,
        terminal_write_set_count: terminal_write_count,
        terminal_at_ms,
        transition_digest,
    };
    crate::operation_ledger::finalize_pending_operation_in(
        tx,
        &supplement,
        retained_terminal_projection,
    )?;
    Ok(true)
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

fn stored_rollback_receipt_on(
    conn: &Connection,
    operation_id: &str,
) -> SnapbackResult<Option<MigrationRollbackReceiptV1>> {
    if !super::sqlite_table_exists(conn, "_snapback_migration_ops")? {
        return Ok(None);
    }
    let stored: Option<Option<String>> = conn
        .query_row(
            "SELECT rollback_receipt_json FROM _snapback_migration_ops WHERE operation_id = ?1",
            params![operation_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(match stored.flatten() {
        Some(raw) => Some(
            serde_json::from_str(&raw)
                .map_err(|_| journal_corrupt("stored rollback receipt is corrupt".to_owned()))?,
        ),
        None => None,
    })
}

fn journal_entries_in_tx(
    tx: &Transaction<'_>,
    operation_id: &str,
) -> SnapbackResult<Vec<MigrationJournalEntryV1>> {
    let mut statement = tx.prepare(
        "SELECT entry_json FROM _snapback_migration_journal WHERE operation_id = ?1 ORDER BY seq",
    )?;
    let mut rows = statement.query(params![operation_id])?;
    let mut entries = Vec::new();
    while let Some(row) = rows.next()? {
        let raw: String = row.get(0)?;
        entries.push(
            serde_json::from_str(&raw)
                .map_err(|_| journal_corrupt("journal entry is corrupt".to_owned()))?,
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
    let rehearsal: bool = conn
        .query_row(
            "SELECT rehearsal FROM _snapback_migration_ops WHERE operation_id = ?1",
            params![operation_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(0)
        != 0;
    let entries_value = serde_json::to_value(&entries)
        .map_err(|_| journal_corrupt("journal entries do not serialize".to_owned()))?;
    let journal_jcs = crate::rqs_contract::jcs(&entries_value)
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
        rehearsal,
        completed_at_ms: last.at_ms,
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
    /// §7 rehearsal mode: `Some` executes the production plan against the
    /// restore-derived target the binding names — and only that target —
    /// with the journal and receipt marked rehearsal. `None` is production
    /// apply.
    pub rehearsal: Option<&'a crate::migration::MigrationRehearsalPlanV1>,
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
    crate::rqs_contract::sha256_identity(&value)
        .map_err(|_| journal_corrupt("schema manifest is not canonicalizable".to_owned()))
}

fn rollback_predecessor_schema(
    conn: &Connection,
    operation_id: &str,
    expected_identity: &str,
    live_schema: &SchemaManifest,
) -> SnapbackResult<SchemaManifest> {
    let persisted: Option<String> = conn
        .query_row(
            "SELECT predecessor_schema_json FROM _snapback_migration_ops \
             WHERE operation_id = ?1",
            params![operation_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    let (schema, source) = match persisted {
        Some(raw) => (
            serde_json::from_str::<SchemaManifest>(&raw).map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_MIGRATION_PREDECESSOR_SCHEMA_UNAVAILABLE",
                    "storage",
                    "the journaled predecessor manifest bytes do not parse; rollback refuses \
                     before changing physical storage",
                )
            })?,
            "journaled predecessor manifest",
        ),
        None => (live_schema.clone(), "live in-memory manifest fallback"),
    };
    let actual_identity = schema_identity(&schema).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_MIGRATION_PREDECESSOR_SCHEMA_UNAVAILABLE",
            "storage",
            format!(
                "the {source} has no valid schema identity; rollback refuses before changing \
                 physical storage"
            ),
        )
    })?;
    if actual_identity != expected_identity {
        return Err(SnapbackError::error(
            "SNAPBACK_MIGRATION_PREDECESSOR_SCHEMA_UNAVAILABLE",
            "storage",
            format!(
                "the {source} identity {actual_identity} does not match the plan's predecessor \
                 schema {expected_identity}; rollback refuses before changing physical storage"
            ),
        ));
    }
    Ok(schema)
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
        let _writer_token = self
            .writer_authority
            .enter(super::write_authority::LocalWriterLaneV1::MigrationExecutor)?;
        let MigrationApplyRequest {
            artifact,
            approval,
            successor_schema,
            audience,
            now_ms,
            rehearsal,
        } = request;
        let predecessor_schema = self.schema.clone();
        let existing_state = latest_state_on(&self.conn, &approval.operation_id)?;
        let resuming_operation = existing_state.is_some();
        let plan_semantics_already_consumed = existing_state.as_ref().is_some_and(|state| {
            state.is_terminal()
                || matches!(
                    state,
                    MigrationExecState::PublishedHeld
                        | MigrationExecState::RollingBack
                        | MigrationExecState::CleanupPending { .. }
                )
        });

        // ---- Static validation and semantic admission (no writes). -------
        if plan_semantics_already_consumed {
            // The exact digest-bound artifact already passed semantic
            // admission against its predecessor. After publication the live
            // manifest is the successor, so re-running predecessor-relative
            // lifecycle checks would reject a legitimate publication,
            // rollback, cleanup, or terminal replay. Recompute the seal here;
            // the stored operation binding below still requires the exact
            // plan digest. Pre-publication resumes re-run the complete
            // semantic check against the still-authoritative predecessor.
            validate_plan_artifact_seal(artifact)?;
        } else if !resuming_operation
            && completed_predecessor_identity(&self.conn, &artifact.plan_digest)?
                .is_some_and(|prior| prior != approval.operation_id)
        {
            // Recompute the seal before trusting its digest as a replay key.
            // The same reviewed plan under a new operation is stale even
            // though the live successor makes predecessor-relative AddField
            // checks fail for a second reason; preserve the stable stale-plan
            // diagnostic and require a fresh preview.
            validate_plan_artifact_seal(artifact)?;
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_PLAN_STALE",
                "storage",
                "this plan already completed under a prior operation; a new operation requires \
                 a new preview against the successor state",
            ));
        } else {
            validate_plan_artifact(artifact, &predecessor_schema, successor_schema)?;
        }
        validate_approval_shape(approval)?;
        if approval.plan_digest != artifact.plan_digest {
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_APPROVAL_REQUIRED",
                "storage",
                "the approval binds a different plan digest; apply never regenerates a plan",
            ));
        }
        match rehearsal {
            None => validate_local_audience(&approval.audience, audience)?,
            Some(rehearsal_plan) => {
                // @ref LLP 0081#7-target-safety-backup-and-secrets — the
                //   rehearsal is not the production plan with its target
                //   silently changed: the binding names the one
                //   restore-derived target it may execute against, the
                //   production approval still authorizes the plan bytes,
                //   and the production audience deliberately does NOT bind
                //   this instance — the binding does.
                rehearsal_plan.validate()?;
                if rehearsal_plan.production_plan_digest != artifact.plan_digest {
                    return Err(SnapbackError::error(
                        "SNAPBACK_MIGRATION_REHEARSAL_INVALID",
                        "storage",
                        "the rehearsal binds a different production plan digest",
                    ));
                }
                if rehearsal_plan.binding.target_profile_id != audience.target_profile_id {
                    return Err(SnapbackError::error(
                        "SNAPBACK_MIGRATION_REHEARSAL_INVALID",
                        "storage",
                        "the rehearsal binding names a different target profile",
                    ));
                }
                if rehearsal_plan.binding.isolated_database_id != audience.database_id {
                    return Err(SnapbackError::error(
                        "SNAPBACK_MIGRATION_REHEARSAL_INVALID",
                        "storage",
                        "a rehearsal executes only against its restore-derived target; \
                         this database is not the bound isolated target",
                    ));
                }
            }
        }
        // This binding is needed before terminal replay because a released
        // replay adopts the caller-supplied successor into the serving handle.
        // Never let a valid receipt become authority for divergent schema
        // bytes merely because execution already completed.
        let successor_identity = schema_identity(successor_schema)?;
        if artifact.body.successor_schema_hash != successor_identity {
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_PLAN_STALE",
                "storage",
                "the staged successor schema does not match the plan's successor binding",
            ));
        }
        // Replay is keyed by operationId + audience and answers BEFORE any
        // staleness comparison: a completed operation returns its prior
        // receipt even though the target now holds the successor schema
        // (LLP 0081 §4).
        if let Some(receipt) = stored_receipt_on(&self.conn, &approval.operation_id)?
            && receipt.state.is_terminal()
        {
            if receipt.plan_digest != artifact.plan_digest
                || receipt.approval_digest != approval_digest(approval)?
                || receipt.audience != approval.audience
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_CLIENT_MUTATION_ID_REUSED",
                    "storage",
                    "completed migration operation identity was reused with divergent plan, approval, or audience facts",
                ));
            }
            if matches!(receipt.state, MigrationExecState::Released) {
                // A caller can lose the response after T committed but before
                // the serving handle adopted the successor. Exact replay is
                // read-only with respect to storage, but it must repair that
                // in-memory serving posture before returning the retained
                // terminal receipt.
                self.schema = successor_schema.clone();
            }
            return Ok(receipt);
        }
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
        validate_supported_steps(artifact)?;

        // ---- Exclusivity. --------------------------------------------------
        if let Some(other) = active_other_operation(&self.conn, &approval.operation_id)? {
            if matches!(
                latest_state_on(&self.conn, &other)?,
                Some(MigrationExecState::PublishedHeld)
            ) {
                return Err(SnapbackError::error(
                    "SNAPBACK_OPERATION_PENDING_CAPACITY_FULL",
                    "storage",
                    "migration aggregate pending capacity is full; new admission refuses rather than evicting or finalizing the held publication",
                ));
            }
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_EXECUTOR_UNAVAILABLE",
                "storage",
                format!("operation {other} already owns this app; only one migration at a time"),
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

        // Provision outside the journal transaction so a rollback cannot
        // rotate the host epoch and change retry issuance facts.
        ensure_migration_host_authority(&mut self.conn, now_ms)?;

        // ---- Admission transaction: lease, fence, journal head. -----------
        let resuming = resuming_operation;
        let (lease_epoch, input_version, admission, aggregate_identity) = {
            let tx = self
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            ensure_migration_tables(&tx)?;
            let aggregate_identity =
                migration_aggregate_identity_in(&tx, artifact, approval, now_ms)?;
            crate::operation_ledger::require_pending_operation_capacity_in(
                &tx,
                MIGRATION_AGGREGATE_LANE_V1,
                &aggregate_identity.bound_facts.audience,
                Some(&aggregate_identity),
                MIGRATION_PENDING_CAPACITY_V1,
            )?;
            let head = current_version_on(&tx)?;
            // Barrier-time resource-ceiling preconditions: growth past the
            // reviewed bounds refuses and requires a new preview/approval.
            enforce_admission_ceilings(&tx, &predecessor_schema, artifact)?;
            enforce_publication_timestamp_floor(&tx, &predecessor_schema, artifact)?;
            enforce_fresh_add_field_destinations(&tx, artifact, &approval.operation_id)?;
            // A republished predecessor advanced its storage generation
            // (LLP 0081 §6): a plan bound to the pre-rollback generation is
            // stale and requires a fresh preview.
            let stored_generation: Option<u64> = tx
                .query_row(
                    "SELECT value FROM _snapback_meta WHERE key = ?1",
                    params![META_STORAGE_GENERATION],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .and_then(|value| value.parse().ok());
            if let Some(stored) = stored_generation
                && stored != artifact.body.predecessor_generation
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_MIGRATION_PLAN_STALE",
                    "storage",
                    format!(
                        "plan binds predecessor storage generation {} but the target holds \
                         {stored}; re-preview against the republished generation",
                        artifact.body.predecessor_generation
                    ),
                ));
            }
            // Pre-migration system-field checkpoint for every table written
            // in place: the §6 rollback expected-value evaluation restores
            // unchanged rows' system fields from exactly this record.
            if !resuming {
                for table in in_place_written_tables(artifact) {
                    if predecessor_schema.table(&table).is_some() {
                        tx.execute(
                            &format!(
                                "INSERT OR IGNORE INTO _snapback_migration_checkpoint \
                                 (operation_id, table_name, row_id, version, updated_at) \
                                 SELECT ?1, ?2, _id, _version, _updatedAt FROM {}",
                                quote_ident(&table)?
                            ),
                            params![approval.operation_id, table],
                        )?;
                    }
                }
            }
            // §6: retained server-resident work must prove its declared
            // posture under the barrier, before the fence admits the plan.
            crate::storage::prove_retained_work_posture(&tx, artifact.body.retained_work_posture)?;
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
            let approval_digest_value = approval_digest(approval)?;
            let aggregate_identity_json = serde_json::to_string(&aggregate_identity)
                .map_err(|_| journal_corrupt("aggregate identity serialize".to_owned()))?;
            let predecessor_schema_json = serde_json::to_string(&predecessor_schema)
                .map_err(|_| journal_corrupt("predecessor schema serialize".to_owned()))?;
            if !resuming {
                tx.execute(
                    "INSERT INTO _snapback_migration_ops(operation_id, audience_json, \
                     plan_digest, state_json, lease_epoch, cancel_requested, rehearsal, \
                     approval_digest, aggregate_identity_json, predecessor_schema_json) \
                     VALUES(?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8, ?9)",
                    params![
                        approval.operation_id,
                        audience_json,
                        artifact.plan_digest,
                        serde_json::to_string(&MigrationExecState::Admitted)
                            .map_err(|_| journal_corrupt("state serialize".to_owned()))?,
                        lease_epoch as i64,
                        i64::from(rehearsal.is_some()),
                        approval_digest_value,
                        aggregate_identity_json,
                        predecessor_schema_json,
                    ],
                )?;
            } else {
                let stored_binding: (String, String, Option<String>) = tx.query_row(
                    "SELECT plan_digest,audience_json,approval_digest
                       FROM _snapback_migration_ops WHERE operation_id=?1",
                    [&approval.operation_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )?;
                if stored_binding.0 != artifact.plan_digest
                    || stored_binding.1 != audience_json
                    || stored_binding
                        .2
                        .as_deref()
                        .is_some_and(|digest| digest != approval_digest_value)
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_CLIENT_MUTATION_ID_REUSED",
                        "storage",
                        "migration operation identity was reused with divergent plan, approval, or audience facts",
                    ));
                }
                tx.execute(
                    "UPDATE _snapback_migration_ops
                        SET lease_epoch=?2,
                            approval_digest=COALESCE(approval_digest,?3),
                            aggregate_identity_json=COALESCE(aggregate_identity_json,?4)
                      WHERE operation_id=?1",
                    params![
                        approval.operation_id,
                        lease_epoch as i64,
                        approval_digest_value,
                        aggregate_identity_json,
                    ],
                )?;
            }
            let journal = JournalHandle {
                tx: &tx,
                operation_id: approval.operation_id.clone(),
                plan_id: artifact.plan_id.clone(),
                lease_epoch,
                input_version: head,
                host_operation_identity: OnceCell::new(),
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
                aggregate_identity,
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
                &aggregate_identity,
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
            &aggregate_identity,
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
        aggregate_identity: &OperationIdentityV1,
        now_ms: u64,
    ) -> SnapbackResult<MigrationReceiptV1> {
        let journal_so_far = journal_entries_on(&self.conn, &approval.operation_id)?;
        let barrier_started_ms = journal_so_far
            .iter()
            .find(|entry| matches!(entry.state, MigrationExecState::Barriered))
            .map(|entry| entry.at_ms)
            .unwrap_or(now_ms);
        let ceiling_ms = artifact.body.ceilings.max_barrier_downtime_ms;
        let publication_version = next_storage_version(input_version)?;
        let mut step_results: BTreeMap<String, Value> = BTreeMap::new();
        // Crash-resume phase skip: a journaled `verifying` means every step
        // completed (re-verify and publish); a journaled `executing(step)`
        // means earlier steps completed (recover their journaled results,
        // resume at that step's own boundary). Replaying a completed step's
        // writes would double effects; replaying its transition would leave
        // the closed relation.
        let mut resume_at_step: Option<String> = None;
        let mut steps_complete = false;
        match journal_so_far.last().map(|entry| &entry.state) {
            Some(MigrationExecState::Executing { step, .. }) => {
                resume_at_step = Some(step.clone());
            }
            Some(MigrationExecState::Verifying) => steps_complete = true,
            _ => {}
        }
        for entry in &journal_so_far {
            if let (Some(step_id), Some(verification)) = (&entry.step_id, &entry.verification) {
                step_results.insert(step_id.clone(), verification.clone());
            }
        }

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

        let mut reached_resume_point = resume_at_step.is_none();
        for (ordinal, record) in artifact.body.steps.iter().enumerate() {
            let step_id = &record.id;
            if steps_complete {
                break;
            }
            if !reached_resume_point {
                if resume_at_step.as_deref() == Some(step_id.as_str()) {
                    reached_resume_point = true;
                } else {
                    // Completed before the crash; its journaled result was
                    // recovered above (batch steps re-derive a resumed
                    // marker when no structural verification was journaled).
                    step_results
                        .entry(step_id.clone())
                        .or_insert_with(|| json!({ "resumed": true }));
                    continue;
                }
            }
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

        // Verifying (LLP 0081 §5): the expected-value evaluator recomputes
        // every proof table's successor content independently from
        // predecessor-derived rows plus the closed plan, and the actual
        // successor digests must match before publication. A digest with no
        // independent expected value is inventory, not proof.
        let data_proof = {
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
                host_operation_identity: OnceCell::new(),
            };
            let proof = run_data_proof(
                &tx,
                &self.schema,
                successor_schema,
                artifact,
                input_version,
                publication_version,
            )?;
            journal.append(JournalAppend {
                verification: Some(&proof),
                at_ms: at,
                barrier_elapsed_ms: Some(elapsed(at)),
                ..JournalAppend::of(&MigrationExecState::Verifying)
            })?;
            tx.commit()?;
            proof
        };
        step_results.insert("§5-data-proof".to_owned(), data_proof);

        // ---- Publication: one transaction, entering published-held. -------
        {
            let at = now_millis();
            check_ceiling(at)?;
            self.check_cancellation(&approval.operation_id)?;
            let tx = self
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            // Swap staged generations into place first: the predecessor
            // table parks under its retired name for the rollback window,
            // and the staged successor takes the live name, so the DDL
            // below applies to the published generation.
            for record in &artifact.body.steps {
                if let MigrationStep::StageTableGeneration { table, generation } = &record.step {
                    let retired = retired_table_name(table, artifact.body.predecessor_generation);
                    if super::sqlite_table_exists(&tx, table)? {
                        tx.execute(
                            &format!(
                                "ALTER TABLE {} RENAME TO {}",
                                quote_ident(table)?,
                                quote_ident(&retired)?
                            ),
                            [],
                        )?;
                    }
                    tx.execute(
                        &format!(
                            "ALTER TABLE {} RENAME TO {}",
                            quote_ident(&staged_table_name(table, *generation))?,
                            quote_ident(table)?
                        ),
                        [],
                    )?;
                    ensure_managed_version_integrity_indexes(&tx, table)?;
                }
            }
            // Publish the successor schema manifest and its additive DDL.
            for table in &successor_schema.tables {
                create_or_update_table(&tx, table)?;
                for index in &table.indexes {
                    create_index(
                        &tx,
                        table,
                        &index.name,
                        &index.fields,
                        index.unique,
                        index.where_applicable,
                    )?;
                }
            }
            // Both manifest slots move together (pre-sessions keeps a
            // byte-equal legacy copy; sessions keeps the poison) — the
            // auth-mode open inspection refuses the store otherwise.
            super::auth_mode::publish_manifest_for_migration(
                &tx,
                &serde_json::to_string(successor_schema)
                    .map_err(|_| journal_corrupt("successor schema serialize".to_owned()))?,
            )?;
            // One successor application version, the typed schema-resync
            // journal event, and the raised retention floor, atomically
            // (the LLP 0007 grammar amendment: the event is a first-class
            // closed-vocabulary operation, not an informal row).
            set_version(&tx, publication_version)?;
            save_retention_floor_on(&tx, publication_version)?;
            let transition_body = crate::storage::SchemaTransitionEventBodyV1 {
                operation_id: approval.operation_id.clone(),
                plan_id: artifact.plan_id.clone(),
                predecessor_schema_hash: artifact.body.predecessor_schema_hash.clone(),
                successor_schema_hash: artifact.body.successor_schema_hash.clone(),
                predecessor_generation: artifact.body.predecessor_generation,
                successor_generation: artifact.body.predecessor_generation + 1,
                retention_floor: publication_version,
                compatibility_posture: artifact.body.compatibility_posture,
            };
            crate::storage::record_schema_transition_event(
                &tx,
                publication_version,
                crate::storage::SchemaTransitionKind::SchemaResync,
                &transition_body,
                now_ms,
            )?;
            let journal = JournalHandle {
                tx: &tx,
                operation_id: approval.operation_id.clone(),
                plan_id: artifact.plan_id.clone(),
                lease_epoch,
                input_version,
                host_operation_identity: OnceCell::new(),
            };
            let cleanup_inventory = cleanup_table_inventory(artifact);
            journal.append(JournalAppend {
                output_version: Some(publication_version),
                verification: Some(&cleanup_inventory),
                at_ms: at,
                barrier_elapsed_ms: Some(elapsed(at)),
                ..JournalAppend::of(&MigrationExecState::PublishedHeld)
            })?;
            // @ref LLP 0163#implementation-record-2026-08-04-migration-aggregate-settlement-tail
            //   — P is one atomic cut: live publication, application version,
            //   schema-resync row, immutable Pending envelope, and lifecycle.
            record_migration_pending_aggregate_in(
                &tx,
                artifact,
                approval,
                aggregate_identity,
                input_version,
                publication_version,
                &transition_body,
                at,
                lease_epoch,
            )?;
            tx.commit()?;
        }

        self.migrate_release_inner(
            artifact,
            approval,
            admission,
            successor_schema,
            lease_epoch,
            input_version,
            aggregate_identity,
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
        aggregate_identity: &OperationIdentityV1,
        _now_ms: u64,
    ) -> SnapbackResult<MigrationReceiptV1> {
        self.migrate_release_inner(
            artifact,
            approval,
            admission,
            successor_schema,
            lease_epoch,
            input_version,
            aggregate_identity,
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
        aggregate_identity: &OperationIdentityV1,
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
                host_operation_identity: OnceCell::new(),
            };
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
            let retained_receipt_json: String = tx.query_row(
                "SELECT receipt_json FROM _snapback_migration_ops WHERE operation_id=?1",
                [&approval.operation_id],
                |row| row.get(0),
            )?;
            let retained_terminal_projection: Value = serde_json::from_str(&retained_receipt_json)
                .map_err(|_| {
                    journal_corrupt("stored terminal receipt does not parse".to_owned())
                })?;
            finalize_migration_aggregate_in(
                &tx,
                aggregate_identity,
                PendingOperationTerminalOutcomeV1::Committed,
                &retained_terminal_projection,
                &json!([]),
                0,
                at,
            )?;
            tx.commit()?;
            receipt
        };
        // Test-only response-loss seam: T is durable before the caller sees
        // its receipt, so retry must return the singleton retained result.
        kill_point_check("terminal-response");
        // The serving handle adopts the successor schema.
        self.schema = successor_schema.clone();
        // The physical cleanup tail (§3/§4): the rollback window closed at
        // release, so parked predecessor generations and artifact-declared
        // retired columns drop now. A tail error leaves the journal at
        // cleanup-pending — reopen resumes the sweep — and never un-releases
        // the already-terminal publication.
        let retired_columns: Vec<(String, String)> = artifact
            .body
            .steps
            .iter()
            .filter_map(|record| match &record.step {
                MigrationStep::RetireField { table, field } => Some((table.clone(), field.clone())),
                _ => None,
            })
            .collect();
        let context = CleanupContext {
            operation_id: approval.operation_id.clone(),
            plan_id: artifact.plan_id.clone(),
            lease_epoch,
            input_version,
        };
        let _ = run_cleanup_tail(
            &mut self.conn,
            &context,
            CleanupTerminal::Released,
            &retired_columns,
            &self.schema.clone(),
        );
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
            host_operation_identity: OnceCell::new(),
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
    /// The §6 fast rollback (`generationRepublish`): available exactly
    /// while the journal shows `published-held` — the fence has kept every
    /// lane closed, so nothing outside it observed the successor. One
    /// transaction republishes the retained predecessor generation,
    /// allocates exactly one new application version `R`, appends the
    /// rollback-resync row, raises the retention floor to `R`, advances the
    /// predecessor storage generation, and seals the rollback receipt. The
    /// rollback command runs under the original operation's approval, which
    /// acknowledged the rollback boundary by declaring the explicit
    /// rollback timestamp.
    pub fn migrate_rollback(
        &mut self,
        artifact: &MigrationPlanArtifactV1,
        approval: &MigrationApprovalV1,
        audience: &ResolvedLocalAudience,
        now_ms: u64,
    ) -> SnapbackResult<MigrationRollbackReceiptV1> {
        let _writer_token = self
            .writer_authority
            .enter(super::write_authority::LocalWriterLaneV1::MigrationExecutor)?;
        validate_approval_shape(approval)?;
        if approval.plan_digest != artifact.plan_digest {
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_APPROVAL_REQUIRED",
                "storage",
                "the approval binds a different plan digest",
            ));
        }
        validate_local_audience(&approval.audience, audience)?;
        // Completed-rollback replay returns the sealed rollback receipt.
        if let Some(receipt) = stored_rollback_receipt_on(&self.conn, &approval.operation_id)? {
            if receipt.plan_digest != artifact.plan_digest
                || receipt.approval_digest != approval_digest(approval)?
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_CLIENT_MUTATION_ID_REUSED",
                    "storage",
                    "completed rollback identity was reused with divergent plan or approval facts",
                ));
            }
            return Ok(receipt);
        }
        let rollback_timestamp_ms =
            artifact
                .body
                .constants
                .rollback_timestamp_ms
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE",
                        "storage",
                        "the plan declares no rollbackTimestampMs; the approval never acknowledged \
                     a fast-rollback boundary — rollback requires a separately approved reverse \
                     plan or restore",
                    )
                })?;
        match latest_state_on(&self.conn, &approval.operation_id)? {
            Some(MigrationExecState::PublishedHeld) => {}
            other => {
                return Err(SnapbackError::error(
                    "SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE",
                    "storage",
                    format!(
                        "fast rollback is available exactly while published-held (found \
                         {:?}); after release, traffic and workers may have issued external \
                         effects, so rollback requires a separately approved reverse plan or \
                         restore from the pre-migration backup",
                        other.map(|state| state.kind().to_owned())
                    ),
                ));
            }
        }

        ensure_migration_host_authority(&mut self.conn, now_ms)?;

        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_migration_tables(&tx)?;
        let predecessor_schema = rollback_predecessor_schema(
            &tx,
            &approval.operation_id,
            &artifact.body.predecessor_schema_hash,
            &self.schema,
        )?;
        let aggregate_identity = migration_aggregate_identity_in(&tx, artifact, approval, now_ms)?;
        let lease_epoch = current_lease_epoch(&tx)? + 1;
        upsert_meta(&tx, META_MIGRATION_LEASE_EPOCH, &lease_epoch.to_string())?;
        let head = current_version_on(&tx)?;
        let republished_version = next_storage_version(head)?;
        let journal = JournalHandle {
            tx: &tx,
            operation_id: approval.operation_id.clone(),
            plan_id: artifact.plan_id.clone(),
            lease_epoch,
            input_version: head,
            host_operation_identity: OnceCell::new(),
        };
        journal.append(JournalAppend {
            at_ms: now_ms,
            ..JournalAppend::of(&MigrationExecState::RollingBack)
        })?;

        // Staged generations: physical rename restores byte-exact bytes.
        let mut staged_restored = Vec::new();
        for record in &artifact.body.steps {
            if let MigrationStep::StageTableGeneration { table, generation } = &record.step {
                tx.execute(
                    &format!(
                        "ALTER TABLE {} RENAME TO {}",
                        quote_ident(table)?,
                        quote_ident(&staged_table_name(table, *generation))?
                    ),
                    [],
                )?;
                let retired = retired_table_name(table, artifact.body.predecessor_generation);
                if super::sqlite_table_exists(&tx, &retired)? {
                    tx.execute(
                        &format!(
                            "ALTER TABLE {} RENAME TO {}",
                            quote_ident(&retired)?,
                            quote_ident(table)?
                        ),
                        [],
                    )?;
                    ensure_managed_version_integrity_indexes(&tx, table)?;
                }
                staged_restored.push(table.clone());
            }
        }

        // In-place tables: clear the new columns and restore unchanged
        // rows' system fields from the pre-migration checkpoint — the §6
        // rollback expected-value evaluation (predecessor-visible content
        // never changed in place, so zero rows restamp to R).
        let mut in_place_restored = BTreeSet::new();
        for (table, column) in in_place_written_columns(artifact) {
            if predecessor_schema.table(&table).is_none() {
                continue;
            }
            tx.execute(
                &format!(
                    "UPDATE {} SET {} = NULL",
                    quote_ident(&table)?,
                    quote_ident(&column)?
                ),
                [],
            )?;
            in_place_restored.insert(table);
        }
        for table in &in_place_restored {
            tx.execute(
                &format!(
                    "UPDATE {} SET _version = checkpoint.version, _updatedAt = \
                     checkpoint.updated_at FROM _snapback_migration_checkpoint AS checkpoint \
                     WHERE checkpoint.operation_id = ?1 AND checkpoint.table_name = ?2 AND \
                     checkpoint.row_id = {}._id",
                    quote_ident(table)?,
                    quote_ident(table)?
                ),
                params![approval.operation_id, table],
            )?;
        }

        // Republish the predecessor: schema manifest, one new version R,
        // the rollback-resync row, the raised floor, and the advanced
        // storage generation — atomically.
        super::auth_mode::publish_manifest_for_migration(
            &tx,
            &serde_json::to_string(&predecessor_schema)
                .map_err(|_| journal_corrupt("predecessor schema serialize".to_owned()))?,
        )?;
        set_version(&tx, republished_version)?;
        save_retention_floor_on(&tx, republished_version)?;
        let restored_storage_generation = artifact.body.predecessor_generation + 1;
        upsert_meta(
            &tx,
            META_STORAGE_GENERATION,
            &restored_storage_generation.to_string(),
        )?;
        // The typed rollback-resync event (the LLP 0007 grammar amendment,
        // first-class like schema-resync). Body fields stay in PLAN
        // orientation — predecessor/successor name the plan's two schemas —
        // and the kind carries the direction: the plan's predecessor was
        // republished, its storage generation advanced to
        // `restored_storage_generation`.
        let rollback_transition_body = crate::storage::SchemaTransitionEventBodyV1 {
            operation_id: approval.operation_id.clone(),
            plan_id: artifact.plan_id.clone(),
            predecessor_schema_hash: artifact.body.predecessor_schema_hash.clone(),
            successor_schema_hash: artifact.body.successor_schema_hash.clone(),
            predecessor_generation: artifact.body.predecessor_generation,
            successor_generation: restored_storage_generation,
            retention_floor: republished_version,
            compatibility_posture: artifact.body.compatibility_posture,
        };
        crate::storage::record_schema_transition_event(
            &tx,
            republished_version,
            crate::storage::SchemaTransitionKind::RollbackResync,
            &rollback_transition_body,
            rollback_timestamp_ms,
        )?;
        let rollback_transition_count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM _snapback_changes
              WHERE version=?1 AND table_name=?2 AND row_id=?3 AND op=?4",
            params![
                version_to_sql_integer(republished_version)?,
                crate::storage::SCHEMA_TRANSITION_JOURNAL_TABLE,
                approval.operation_id,
                crate::storage::SchemaTransitionKind::RollbackResync.as_op(),
            ],
            |row| row.get(0),
        )?;
        if rollback_transition_count != 1 {
            return Err(journal_corrupt(format!(
                "rollback R must contain exactly one rollback-resync change row (found {rollback_transition_count})"
            )));
        }

        journal.append(JournalAppend {
            output_version: Some(republished_version),
            at_ms: now_ms,
            ..JournalAppend::of(&MigrationExecState::RolledBack)
        })?;
        delete_meta(&tx, META_MIGRATION_FENCE)?;

        // Seal both faces: the rollback receipt, and a terminal forward
        // receipt so replaying the completed forward operation answers with
        // its terminal state instead of re-executing.
        let entries = journal_entries_in_tx(&tx, &approval.operation_id)?;
        let entries_value = serde_json::to_value(&entries)
            .map_err(|_| journal_corrupt("journal serialize".to_owned()))?;
        let journal_jcs = crate::rqs_contract::jcs(&entries_value)
            .map_err(|_| journal_corrupt("journal canonicalize".to_owned()))?;
        let journal_digest: String = {
            use sha2::{Digest, Sha256};
            Sha256::digest(journal_jcs.as_bytes())
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect()
        };
        let rollback_receipt = MigrationRollbackReceiptV1 {
            version: MIGRATION_ROLLBACK_RECEIPT_SCHEMA_VERSION.to_owned(),
            operation_id: approval.operation_id.clone(),
            plan_digest: artifact.plan_digest.clone(),
            approval_digest: approval_digest(approval)?,
            republished_version,
            rollback_timestamp_ms,
            restored_storage_generation,
            staged_tables_restored: staged_restored,
            in_place_tables_restored: in_place_restored.into_iter().collect(),
            restamped_rows: 0,
            journal_entries: entries.len() as u64,
            journal_digest,
        };
        let rollback_receipt_json = serde_json::to_string(&rollback_receipt)
            .map_err(|_| journal_corrupt("rollback receipt serialize".to_owned()))?;
        tx.execute(
            "UPDATE _snapback_migration_ops SET rollback_receipt_json = ?2, state_json = ?3 \
             WHERE operation_id = ?1",
            params![
                approval.operation_id,
                rollback_receipt_json,
                serde_json::to_string(&MigrationExecState::RolledBack)
                    .map_err(|_| journal_corrupt("state serialize".to_owned()))?,
            ],
        )?;
        let forward = seal_receipt(
            &tx,
            &approval.operation_id,
            artifact,
            approval,
            &MigrationAdmissionV1 {
                schema_version: crate::migration::MIGRATION_ADMISSION_SCHEMA_VERSION.to_owned(),
                operation_id: approval.operation_id.clone(),
                plan_digest: artifact.plan_digest.clone(),
                approval_digest: approval_digest(approval)?,
                predecessor_head_version: head,
                enforced: artifact.body.ceilings.clone(),
                admitted_at_ms: now_ms,
            },
            BTreeMap::new(),
            None,
        )?;
        store_receipt(&tx, &approval.operation_id, &forward)?;
        let retained: (String, String) = tx.query_row(
            "SELECT receipt_json,rollback_receipt_json FROM _snapback_migration_ops
              WHERE operation_id=?1",
            [&approval.operation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let retained_terminal_projection = json!({
            "forwardReceipt": serde_json::from_str::<Value>(&retained.0)
                .map_err(|_| journal_corrupt("stored forward receipt does not parse".to_owned()))?,
            "rollbackReceipt": serde_json::from_str::<Value>(&retained.1)
                .map_err(|_| journal_corrupt("stored rollback receipt does not parse".to_owned()))?,
        });
        let rollback_write_detail = json!([{
            "kind": "rollback-resync",
            "version": republished_version,
            "body": rollback_transition_body,
        }]);
        finalize_migration_aggregate_in(
            &tx,
            &aggregate_identity,
            PendingOperationTerminalOutcomeV1::RolledBack,
            &retained_terminal_projection,
            &rollback_write_detail,
            u64::try_from(rollback_transition_count)
                .map_err(|_| journal_corrupt("rollback change count overflow".to_owned()))?,
            now_ms,
        )?;
        tx.commit()?;
        self.schema = predecessor_schema.clone();
        kill_point_check("rollback-response");
        // The rollback's cleanup tail: the republished predecessor is
        // authoritative, so orphaned staged successor generations drop.
        // Same resumable posture as the release tail.
        let context = CleanupContext {
            operation_id: approval.operation_id.clone(),
            plan_id: artifact.plan_id.clone(),
            lease_epoch,
            input_version: head,
        };
        let _ = run_cleanup_tail(
            &mut self.conn,
            &context,
            CleanupTerminal::RolledBack,
            &[],
            &predecessor_schema,
        );
        Ok(rollback_receipt)
    }

    pub fn migration_rollback_receipt(
        &self,
        operation_id: &str,
    ) -> SnapbackResult<Option<MigrationRollbackReceiptV1>> {
        stored_rollback_receipt_on(&self.conn, operation_id)
    }

    pub fn migrate_request_cancel(&mut self, operation_id: &str) -> SnapbackResult<()> {
        match latest_state_on(&self.conn, operation_id)? {
            None => Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_EXECUTOR_UNAVAILABLE",
                "storage",
                format!("no journaled operation {operation_id}"),
            )),
            Some(MigrationExecState::PublishedHeld) => Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE",
                "storage",
                "cancellation is pre-publication only; from published-held the exits are \
                     the journaled release or the audited rollback",
            )),
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
        let journal_step = |tx: &Transaction<'_>,
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
                host_operation_identity: OnceCell::new(),
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
                        declared.where_applicable,
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
                    // Cross-table copy corresponds rows by `_id`: the closed
                    // expression evaluates over the SOURCE row and writes the
                    // destination row sharing its id; a destination row with
                    // no source counterpart keeps its value.
                    return self.run_cross_table_copy_batches(
                        &operation_id,
                        source_table,
                        source_field,
                        table,
                        field,
                        expr.as_ref(),
                        successor_schema,
                        constants,
                        publication_version,
                        step_id,
                        &journal_step_wrapper(
                            &operation_id,
                            &plan_id,
                            step_id,
                            lease_epoch,
                            input_version,
                            barrier_started_ms,
                        ),
                    );
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
                let where_applicable = successor_schema
                    .table(table)
                    .and_then(|table| {
                        table
                            .indexes
                            .iter()
                            .find(|index| index.fields == *fields && index.unique)
                    })
                    .is_some_and(|index| index.where_applicable);
                self.run_validation_scan_indexed(
                    successor_schema,
                    table,
                    Some(index),
                    vec![MigrationScanValidatorV1::Unique {
                        field,
                        additional_fields: fields.iter().skip(1).cloned().collect(),
                        where_applicable,
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
                let publication = self.rebuild_projection_if_stale(&plan, "migration")?;
                let verification = json!({
                    "projection": projection_id,
                    "rebuilt": publication.is_some(),
                    "contentDigest": publication
                        .as_ref()
                        .map(|publication| publication.receipt.content_digest.clone()),
                });
                let tx = self
                    .conn
                    .transaction_with_behavior(TransactionBehavior::Immediate)?;
                if let Some(publication) = publication.as_ref() {
                    super::projection_rebuild::apply_projection_publication_in(
                        &tx,
                        std::slice::from_ref(publication),
                    )?;
                }
                journal_step(&tx, 0, None, None, Some(&verification))?;
                tx.commit()?;
                Ok(verification)
            }
            // Staged-generation steps (LLP 0081 §3/§4): the staged table is
            // migration-private — a physical table no schema manifest names,
            // invisible to every fenced application lane — and the swap into
            // place happens only inside the publication transaction.
            MigrationStep::StageTableGeneration { table, generation } => {
                let tx = self
                    .conn
                    .transaction_with_behavior(TransactionBehavior::Immediate)?;
                let successor_table = successor_schema
                    .table(table)
                    .ok_or_else(|| step_failed(step_id, "staged table undeclared on successor"))?;
                let mut staged = successor_table.clone();
                staged.name = staged_table_name(table, *generation);
                create_or_update_table(&tx, &staged)?;
                journal_step(&tx, 0, None, None, Some(&json!({ "staged": staged.name })))?;
                tx.commit()?;
                Ok(json!({ "staged": true }))
            }
            MigrationStep::CopyTable {
                source_table,
                table,
                generation,
                fields,
            } => self.run_staged_copy_batches(
                &operation_id,
                source_table,
                table,
                *generation,
                fields,
                successor_schema,
                constants,
                publication_version,
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
            MigrationStep::RetireGeneration { table, generation } => {
                // Logical retirement only: the physical predecessor bytes
                // survive through the rollback window; the cleanup-pending
                // tail names them for the separately fenced physical drop.
                let tx = self
                    .conn
                    .transaction_with_behavior(TransactionBehavior::Immediate)?;
                let verification = json!({
                    "retired": { "table": table, "generation": generation },
                    "physicalCleanup": "fenced behind the rollback window",
                });
                journal_step(&tx, 0, None, None, Some(&verification))?;
                tx.commit()?;
                Ok(verification)
            }
        }
    }
}

fn cleanup_table_inventory(artifact: &MigrationPlanArtifactV1) -> Value {
    let mut released = BTreeSet::new();
    let mut rolled_back = BTreeSet::new();
    for record in &artifact.body.steps {
        if let MigrationStep::StageTableGeneration { table, generation } = &record.step {
            released.insert(retired_table_name(
                table,
                artifact.body.predecessor_generation,
            ));
            rolled_back.insert(staged_table_name(table, *generation));
        }
    }
    json!({
        "cleanupTables": {
            "released": released,
            "rolledBack": rolled_back,
        }
    })
}

fn cleanup_tables_for_operation(
    conn: &Connection,
    operation_id: &str,
    terminal: CleanupTerminal,
) -> SnapbackResult<Vec<String>> {
    let entries = journal_entries_on(conn, operation_id)?;
    let Some(verification) = entries.iter().rev().find_map(|entry| {
        matches!(entry.state, MigrationExecState::PublishedHeld)
            .then_some(entry.verification.as_ref())
            .flatten()
    }) else {
        // Legacy operations did not journal an owned cleanup inventory.
        // Leaving their residue for inspection is safer than inferring
        // ownership from ambient sqlite_master names.
        return Ok(Vec::new());
    };
    let key = match terminal {
        CleanupTerminal::Released => "released",
        CleanupTerminal::RolledBack => "rolledBack",
    };
    let Some(value) = verification
        .get("cleanupTables")
        .and_then(|tables| tables.get(key))
    else {
        return Ok(Vec::new());
    };
    let Some(values) = value.as_array() else {
        return Err(journal_corrupt(format!(
            "published-held cleanup inventory {key} is not an array"
        )));
    };
    let mut names = BTreeSet::new();
    for value in values {
        let Some(name) = value.as_str() else {
            return Err(journal_corrupt(format!(
                "published-held cleanup inventory {key} contains a non-string table"
            )));
        };
        names.insert(name.to_owned());
    }
    Ok(names.into_iter().collect())
}

/// The physical cleanup tail (LLP 0081 §3/§4): logical retirements keep
/// their storage through the rollback window, and §6's fast rollback exists
/// only in `published-held` — so once the journal reaches `released` the
/// window is closed and the parked predecessor generations (plus, when the
/// artifact is in hand, the logically retired columns) can be physically
/// dropped. From `rolled-back` the garbage is the staged successor instead.
/// Two durable cuts: `cleanup-pending` commits before any physical work, so
/// a crash inside the tail resumes from the journal at reopen; every drop
/// is idempotent; and the tail closes back into the same terminal it
/// extends. Crash-resume needs no artifact: publication journals the exact
/// parked/staged names owned by this operation, so cleanup never infers
/// ownership from an ambient sqlite_master name pattern.
pub(crate) struct CleanupContext {
    pub operation_id: String,
    pub plan_id: String,
    pub lease_epoch: u64,
    pub input_version: u64,
}

pub(crate) fn run_cleanup_tail(
    conn: &mut Connection,
    context: &CleanupContext,
    terminal: CleanupTerminal,
    retired_columns: &[(String, String)],
    schema: &SchemaManifest,
) -> SnapbackResult<Value> {
    ensure_migration_host_authority(conn, now_millis())?;

    // Durable cut 1: the tail's intent survives a crash.
    {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let journal = JournalHandle {
            tx: &tx,
            operation_id: context.operation_id.clone(),
            plan_id: context.plan_id.clone(),
            lease_epoch: context.lease_epoch,
            input_version: context.input_version,
            host_operation_identity: OnceCell::new(),
        };
        journal.append(JournalAppend {
            at_ms: now_millis(),
            ..JournalAppend::of(&MigrationExecState::CleanupPending { terminal })
        })?;
        tx.commit()?;
    }
    kill_point_check("cleanup-pending");
    cleanup_sweep(conn, context, terminal, retired_columns, schema)
}

/// Durable cut 2 of the tail: the physical drops and the terminal-closing
/// journal row commit together. Entered fresh from `run_cleanup_tail` and
/// re-entered by crash recovery, whose journal already shows
/// `cleanup-pending` (the enumerated relation admits no pending→pending
/// self-transition, so resume skips the first cut).
fn cleanup_sweep(
    conn: &mut Connection,
    context: &CleanupContext,
    terminal: CleanupTerminal,
    retired_columns: &[(String, String)],
    schema: &SchemaManifest,
) -> SnapbackResult<Value> {
    // Crash recovery may resume a legacy migration whose original executor
    // never provisioned the host authority. Make the epoch durable before
    // the terminal cleanup transaction starts.
    ensure_migration_host_authority(conn, now_millis())?;

    let terminal_state = match terminal {
        CleanupTerminal::Released => MigrationExecState::Released,
        CleanupTerminal::RolledBack => MigrationExecState::RolledBack,
    };
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut dropped_tables: Vec<String> = Vec::new();
    let mut dropped_columns: Vec<String> = Vec::new();
    for name in cleanup_tables_for_operation(&tx, &context.operation_id, terminal)? {
        if super::sqlite_table_exists(&tx, &name)? {
            tx.execute_batch(&format!(
                "DROP TABLE IF EXISTS {}",
                crate::storage::quote_ident(&name)?
            ))?;
            dropped_tables.push(name);
        }
    }
    if matches!(terminal, CleanupTerminal::Released) {
        for (table, column) in retired_columns {
            // Only a column the authoritative manifest no longer declares is
            // retirement residue; anything else is refused by inspection.
            let declared = schema
                .table(table)
                .is_some_and(|manifest| manifest.field(column).is_some());
            if declared {
                continue;
            }
            let physically_present: bool = {
                let mut statement = tx.prepare(&format!(
                    "SELECT COUNT(*) FROM pragma_table_info({}) WHERE name = ?1",
                    crate::storage::quote_ident(table)?
                ))?;
                statement.query_row(params![column], |row| row.get::<_, i64>(0))? > 0
            };
            if physically_present {
                tx.execute_batch(&format!(
                    "ALTER TABLE {} DROP COLUMN {}",
                    crate::storage::quote_ident(table)?,
                    crate::storage::quote_ident(column)?
                ))?;
                dropped_columns.push(format!("{table}.{column}"));
            }
        }
    }
    tx.execute(
        "DELETE FROM _snapback_migration_checkpoint WHERE operation_id = ?1",
        params![context.operation_id],
    )?;
    let summary = json!({
        "droppedTables": dropped_tables,
        "droppedColumns": dropped_columns,
    });
    let journal = JournalHandle {
        tx: &tx,
        operation_id: context.operation_id.clone(),
        plan_id: context.plan_id.clone(),
        lease_epoch: context.lease_epoch,
        input_version: context.input_version,
        host_operation_identity: OnceCell::new(),
    };
    journal.append(JournalAppend {
        verification: Some(&summary),
        at_ms: now_millis(),
        ..JournalAppend::of(&terminal_state)
    })?;
    tx.commit()?;
    Ok(summary)
}

/// Crash recovery for the cleanup tail: when the newest journal row overall
/// is `cleanup-pending`, resume the physical sweep at reopen (§4: a crash
/// after release reopens only the successor and resumes cleanup). Runs
/// without the artifact — the sweep is inventory-driven; artifact-derived
/// column drops from the interrupted run are re-derived as manifest-absent
/// residue on the next operation, never guessed here.
pub(crate) fn resume_pending_cleanup(
    conn: &mut Connection,
    schema: &SchemaManifest,
) -> SnapbackResult<Option<Value>> {
    if !crate::storage::sqlite_table_exists(conn, "_snapback_migration_journal")? {
        return Ok(None);
    }
    let latest: Option<String> = conn
        .query_row(
            "SELECT entry_json FROM _snapback_migration_journal ORDER BY seq DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let Some(raw) = latest else { return Ok(None) };
    let entry: MigrationJournalEntryV1 = serde_json::from_str(&raw)
        .map_err(|_| journal_corrupt("journal entry does not parse".to_owned()))?;
    let context = CleanupContext {
        operation_id: entry.operation_id.clone(),
        plan_id: entry.plan_id.clone(),
        lease_epoch: entry.lease_epoch,
        input_version: entry.input_version,
    };
    match entry.state {
        // The pending cut committed; only the sweep remains.
        MigrationExecState::CleanupPending { terminal } => {
            cleanup_sweep(conn, &context, terminal, &[], schema).map(Some)
        }
        // A crash in the pending transition's interior loses the pending
        // row itself (the kill fires before the append commits), so a
        // terminal journal resumes when its operation-scoped table inventory
        // or checkpoint rows still contain cleanup work.
        MigrationExecState::Released | MigrationExecState::RolledBack => {
            let terminal = match entry.state {
                MigrationExecState::Released => CleanupTerminal::Released,
                _ => CleanupTerminal::RolledBack,
            };
            let cleanup_tables =
                cleanup_tables_for_operation(conn, &context.operation_id, terminal)?;
            let table_cleanup_exists = cleanup_tables.iter().try_fold(false, |found, name| {
                Ok::<_, SnapbackError>(found || super::sqlite_table_exists(conn, name)?)
            })?;
            let checkpoint_cleanup_exists =
                if super::sqlite_table_exists(conn, "_snapback_migration_checkpoint")? {
                    conn.query_row(
                        "SELECT EXISTS(SELECT 1 FROM _snapback_migration_checkpoint \
                     WHERE operation_id = ?1)",
                        params![context.operation_id],
                        |row| row.get::<_, bool>(0),
                    )?
                } else {
                    false
                };
            if !table_cleanup_exists && !checkpoint_cleanup_exists {
                return Ok(None);
            }
            run_cleanup_tail(conn, &context, terminal, &[], schema).map(Some)
        }
        _ => Ok(None),
    }
}

/// Physical name of a staged successor generation: no schema manifest ever
/// names it, so every fenced application lane is structurally blind to it.
fn staged_table_name(table: &str, generation: u64) -> String {
    format!("{table}__g{generation}")
}

/// Physical name a replaced predecessor generation parks under between
/// publication and cleanup — the rollback window's restore source.
fn retired_table_name(table: &str, generation: u64) -> String {
    format!("{table}__retired_g{generation}")
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
                host_operation_identity: OnceCell::new(),
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
                table_visibility: None,
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
                "migration/backfill-page",
                Some(BACKFILL_BATCH_ROWS),
                boundary.as_ref(),
                true,
                crate::manifest::OrderDirection::Asc,
                None,
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
                    out.push(super::row_to_document_with_staged_nullable_fields(
                        row,
                        table,
                        &columns,
                        &[field],
                    )?);
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
                let value = eval_expr(
                    expr,
                    &input,
                    &bindings,
                    constants.publication_timestamp_ms,
                    None,
                    "migration/backfill-expression",
                )?;
                let field_manifest = table.field(field).ok_or_else(|| {
                    step_failed(step_id, "backfill destination field is undeclared")
                })?;
                let (normalized, sql_value, _) =
                    prepare_migration_field_value(&table.name, field_manifest, &value, step_id)?;
                let existing = row.get(field).cloned().unwrap_or(Value::Null);
                if existing == normalized {
                    continue;
                }
                let mut candidate = row
                    .as_object()
                    .cloned()
                    .ok_or_else(|| journal_corrupt("backfill row is not an object".to_owned()))?;
                candidate.insert(field.to_owned(), normalized);
                validate_migration_structured_row_aggregate(table, &candidate, step_id)?;
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

    /// Staged copy (LLP 0081 §3 CopyTable): deterministic keyset batches
    /// from the source table into the migration-private staged generation.
    /// Inherited rows preserve `_id`/`_createdAt`; a row whose produced
    /// user-visible content differs from its source receives the
    /// publication version and `publicationTimestampMs`; unchanged rows
    /// preserve all four system fields (§4's identity rules).
    #[allow(clippy::too_many_arguments)]
    fn run_staged_copy_batches(
        &mut self,
        operation_id: &str,
        source_table: &str,
        table: &str,
        generation: u64,
        fields: &BTreeMap<String, crate::manifest::ValueExpr>,
        successor_schema: &SchemaManifest,
        constants: &crate::migration::MigrationConstants,
        publication_version: u64,
        step_id: &str,
        journal_step: &JournalStepFn<'_>,
    ) -> SnapbackResult<Value> {
        let staged_name = staged_table_name(table, generation);
        let successor_table = successor_schema
            .table(table)
            .ok_or_else(|| step_failed(step_id, "CopyTable destination undeclared"))?;
        let mut staged_manifest = successor_table.clone();
        staged_manifest.name = staged_name.clone();
        let source_schema = self.schema.clone();
        let mut after: Option<String> =
            resume_backfill_boundary(&self.conn, operation_id, step_id)?;
        let mut batch: u64 = 0;
        let mut rows_copied: u64 = 0;
        let mut rows_restamped: u64 = 0;
        let input = HandlerInput {
            args: Value::Object(constants.values.clone().into_iter().collect()),
            ..HandlerInput::default()
        };
        loop {
            let tx = self
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            let page_rows = read_id_page(&tx, &source_schema, source_table, after.as_deref())?;
            let mut last_id: Option<String> = None;
            for row in &page_rows {
                let id = row
                    .get("_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| journal_corrupt("source row without _id".to_owned()))?
                    .to_owned();
                last_id = Some(id.clone());
                let mut bindings = BTreeMap::new();
                bindings.insert("row".to_owned(), row.clone());
                let mut produced = Map::new();
                let mut content_changed = false;
                for (dest_field, expr) in fields {
                    let value = eval_expr(
                        expr,
                        &input,
                        &bindings,
                        constants.publication_timestamp_ms,
                        None,
                        "migration/backfill-fields",
                    )?;
                    let value = run_migration_execution_value_hook(dest_field, value);
                    if row.get(dest_field).cloned().unwrap_or(Value::Null) != value {
                        content_changed = true;
                    }
                    produced.insert(dest_field.clone(), value);
                }
                let (version, updated_at) = if content_changed {
                    rows_restamped += 1;
                    (publication_version, constants.publication_timestamp_ms)
                } else {
                    (
                        row.get("_version").and_then(Value::as_u64).unwrap_or(0),
                        row.get("_updatedAt").and_then(Value::as_u64).unwrap_or(0),
                    )
                };
                let created_at = row.get("_createdAt").and_then(Value::as_u64).unwrap_or(0);
                insert_staged_row(
                    &tx,
                    &staged_manifest,
                    &id,
                    &produced,
                    version,
                    created_at,
                    updated_at,
                    step_id,
                )?;
                rows_copied += 1;
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
        Ok(json!({
            "rowsCopied": rows_copied,
            "rowsRestamped": rows_restamped,
            "staged": staged_name,
        }))
    }

    /// Cross-table CopyField: rows correspond by `_id`; the expression
    /// evaluates over the source row; destination rows without a source
    /// counterpart are untouched.
    #[allow(clippy::too_many_arguments)]
    fn run_cross_table_copy_batches(
        &mut self,
        operation_id: &str,
        source_table: &str,
        source_field: &str,
        table: &str,
        field: &str,
        expr: Option<&crate::manifest::ValueExpr>,
        successor_schema: &SchemaManifest,
        constants: &crate::migration::MigrationConstants,
        publication_version: u64,
        step_id: &str,
        journal_step: &JournalStepFn<'_>,
    ) -> SnapbackResult<Value> {
        let source_schema = self.schema.clone();
        let dest_schema = effective_barrier_schema(&self.schema, successor_schema, table);
        let copy_expr = expr.cloned().unwrap_or(crate::manifest::ValueExpr::Field {
            base: Box::new(crate::manifest::ValueExpr::Binding("row".to_owned())),
            key: source_field.to_owned(),
        });
        // @ref LLP 0081#4-execution-journaling-and-crash-recovery — resume at
        // the last committed keyset boundary; cross-table copies obey the same
        // batch-atomic cursor contract as backfills and staged table copies.
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
            let page_rows = read_id_page(&tx, &source_schema, source_table, after.as_deref())?;
            let dest_table = schema_table(&dest_schema, table)?;
            let mut last_id: Option<String> = None;
            for row in &page_rows {
                let id = row
                    .get("_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| journal_corrupt("source row without _id".to_owned()))?
                    .to_owned();
                last_id = Some(id.clone());
                let mut bindings = BTreeMap::new();
                bindings.insert("row".to_owned(), row.clone());
                let value = eval_expr(
                    &copy_expr,
                    &input,
                    &bindings,
                    constants.publication_timestamp_ms,
                    None,
                    "migration/copy-expression",
                )?;
                let field_manifest = dest_table
                    .field(field)
                    .ok_or_else(|| step_failed(step_id, "copy destination field is undeclared"))?;
                let (normalized, sql_value, _) = prepare_migration_field_value(
                    &dest_table.name,
                    field_manifest,
                    &value,
                    step_id,
                )?;
                if let Some(mut candidate) =
                    super::get_document_from_tx(&tx, dest_table, &id, publication_version)?
                        .and_then(|value| value.as_object().cloned())
                {
                    candidate.insert(field.to_owned(), normalized);
                    validate_migration_structured_row_aggregate(dest_table, &candidate, step_id)?;
                }
                let written = tx.execute(
                    &format!(
                        "UPDATE {} SET {} = ?1, _version = ?2, _updatedAt = ?3 \
                         WHERE _id = ?4 AND {} IS NOT ?1",
                        quote_ident(&dest_table.name)?,
                        quote_ident(field)?,
                        quote_ident(field)?
                    ),
                    params![
                        sql_value,
                        version_to_sql_integer(publication_version)?,
                        timestamp_to_sql_millis(constants.publication_timestamp_ms)?,
                        id
                    ],
                )?;
                rows_written += written as u64;
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

// The migration expected-value path intentionally owns a second evaluator.
// It must not call storage's `eval_expr` or `value_expr::eval_value_expr`:
// sharing either implementation would turn matching digests into inventory,
// not LLP 0081 independent boundary proof.
//
// @ref LLP 0165#migration-verification-boundary--2026-08-04 — predecessor
//   values are mapped through an independently implemented evaluator.
fn migration_expected_oracle(
    expr: &ValueExpr,
    constants: &Value,
    bindings: &BTreeMap<String, Value>,
) -> SnapbackResult<Value> {
    fn refused(message: impl Into<String>) -> SnapbackError {
        SnapbackError::error(
            "SNAPBACK_MIGRATION_EXPECTED_ORACLE_FAILED",
            "storage",
            message,
        )
    }

    fn lookup<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
        let mut current = value;
        for part in path.split('.') {
            current = current.as_object()?.get(part)?;
        }
        Some(current)
    }

    fn field(value: &Value, key: &str) -> Value {
        match value {
            Value::Object(fields) => fields.get(key).cloned().unwrap_or(Value::Null),
            Value::Array(items) => key
                .parse::<usize>()
                .ok()
                .and_then(|index| items.get(index))
                .cloned()
                .unwrap_or(Value::Null),
            _ => Value::Null,
        }
    }

    fn number(value: &Value) -> Option<f64> {
        value.as_f64()
    }

    fn number_value(value: f64) -> Value {
        const SAFE: f64 = 9_007_199_254_740_992.0;
        if !value.is_finite() {
            Value::Null
        } else if value.fract() == 0.0 && value.abs() <= SAFE {
            json!(value as i64)
        } else {
            serde_json::Number::from_f64(value).map_or(Value::Null, Value::Number)
        }
    }

    fn truthy(value: &Value) -> bool {
        match value {
            Value::Null => false,
            Value::Bool(value) => *value,
            Value::Number(_) => number(value).is_some_and(|value| value != 0.0 && !value.is_nan()),
            Value::String(value) => !value.is_empty(),
            Value::Array(_) | Value::Object(_) => true,
        }
    }

    fn equal(left: &Value, right: &Value) -> bool {
        match (number(left), number(right)) {
            (Some(left), Some(right)) => left == right,
            _ => left == right,
        }
    }

    fn numeric(op: BinaryOp, left: &Value, right: &Value) -> SnapbackResult<Value> {
        if left.is_null() || right.is_null() {
            return Ok(Value::Null);
        }
        let (Some(left), Some(right)) = (number(left), number(right)) else {
            return Err(refused(format!("{op:?} expects numeric operands")));
        };
        Ok(number_value(match op {
            BinaryOp::Add => left + right,
            BinaryOp::Sub => left - right,
            BinaryOp::Mul => left * right,
            BinaryOp::Div => left / right,
            BinaryOp::Mod => left % right,
            _ => unreachable!("numeric oracle only receives arithmetic operators"),
        }))
    }

    fn portable_trim(value: &str) -> String {
        value
            .trim_matches(|ch| {
                matches!(
                    ch,
                    '\u{0009}'..='\u{000D}'
                        | '\u{0020}'
                        | '\u{0085}'
                        | '\u{00A0}'
                        | '\u{1680}'
                        | '\u{2000}'..='\u{200A}'
                        | '\u{2028}'
                        | '\u{2029}'
                        | '\u{202F}'
                        | '\u{205F}'
                        | '\u{3000}'
                )
            })
            .to_owned()
    }

    fn round_ecmascript(value: f64) -> f64 {
        if !value.is_finite() || value == 0.0 || value.fract() == 0.0 {
            return value;
        }
        let lower = value.floor();
        if value - lower < 0.5 {
            lower
        } else {
            lower + 1.0
        }
    }

    fn concat_string(value: &Value) -> SnapbackResult<String> {
        match value {
            Value::Null => Ok("null".to_owned()),
            Value::Bool(value) => Ok(value.to_string()),
            Value::String(value) => Ok(value.clone()),
            Value::Number(_) => number(value)
                .filter(|value| value.is_finite())
                .map(|value| ryu_js::Buffer::new().format(value).to_owned())
                .ok_or_else(|| refused("concat received an unrepresentable number")),
            Value::Array(_) | Value::Object(_) => {
                Err(refused("concat cannot interpolate arrays or objects"))
            }
        }
    }

    fn evaluate(
        expr: &ValueExpr,
        constants: &Value,
        bindings: &BTreeMap<String, Value>,
        depth: usize,
    ) -> SnapbackResult<Value> {
        if depth > crate::value_expr::MAX_EXPR_DEPTH {
            return Err(refused(
                "migration expected expression exceeds the v1 depth bound",
            ));
        }
        let child = |expr| evaluate(expr, constants, bindings, depth + 1);
        match expr {
            ValueExpr::Arg(path) => lookup(constants, path)
                .cloned()
                .ok_or_else(|| refused(format!("migration constant {path} was not provided"))),
            ValueExpr::Binding(name) => bindings
                .get(name)
                .cloned()
                .ok_or_else(|| refused(format!("migration binding {name} was not provided"))),
            ValueExpr::Literal(value) => Ok(value.clone()),
            ValueExpr::Field { base, key } => Ok(field(&child(base)?, key)),
            ValueExpr::Binary { op, left, right } => {
                let left = child(left)?;
                let right = child(right)?;
                match op {
                    BinaryOp::And => Ok(if truthy(&left) { right } else { left }),
                    BinaryOp::Or => Ok(if truthy(&left) { left } else { right }),
                    BinaryOp::Eq => Ok(Value::Bool(equal(&left, &right))),
                    BinaryOp::Ne => Ok(Value::Bool(!equal(&left, &right))),
                    BinaryOp::Add if left.is_string() && right.is_string() => {
                        Ok(Value::String(format!(
                            "{}{}",
                            left.as_str().unwrap_or_default(),
                            right.as_str().unwrap_or_default()
                        )))
                    }
                    BinaryOp::Add
                    | BinaryOp::Sub
                    | BinaryOp::Mul
                    | BinaryOp::Div
                    | BinaryOp::Mod => numeric(*op, &left, &right),
                    BinaryOp::Lt | BinaryOp::Lte | BinaryOp::Gt | BinaryOp::Gte => {
                        if left.is_null() || right.is_null() {
                            return Ok(Value::Null);
                        }
                        let ordering = match (&left, &right) {
                            (Value::String(left), Value::String(right)) => {
                                left.chars().cmp(right.chars())
                            }
                            _ => {
                                let (Some(left), Some(right)) = (number(&left), number(&right))
                                else {
                                    return Err(refused(
                                        "ordering expects two strings or two numbers",
                                    ));
                                };
                                left.partial_cmp(&right).ok_or_else(|| {
                                    refused("ordering received an unordered number")
                                })?
                            }
                        };
                        Ok(Value::Bool(match op {
                            BinaryOp::Lt => ordering.is_lt(),
                            BinaryOp::Lte => ordering.is_le(),
                            BinaryOp::Gt => ordering.is_gt(),
                            BinaryOp::Gte => ordering.is_ge(),
                            _ => unreachable!(),
                        }))
                    }
                }
            }
            ValueExpr::Unary { op, expr } => {
                let value = child(expr)?;
                match op {
                    UnaryOp::Not => Ok(Value::Bool(!truthy(&value))),
                    UnaryOp::Neg if value.is_null() => Ok(Value::Null),
                    UnaryOp::Neg => number(&value)
                        .map(|value| number_value(-value))
                        .ok_or_else(|| refused("Neg expects a number")),
                }
            }
            ValueExpr::If { cond, then, r#else } => {
                if truthy(&child(cond)?) {
                    child(then)
                } else {
                    child(r#else)
                }
            }
            ValueExpr::Concat(parts) => {
                let mut output = String::new();
                for part in parts {
                    output.push_str(&concat_string(&child(part)?)?);
                }
                Ok(Value::String(output))
            }
            ValueExpr::Call { func, args } => {
                let values = args
                    .iter()
                    .map(&child)
                    .collect::<SnapbackResult<Vec<_>>>()?;
                match func.as_str() {
                    "coalesce" => Ok(values
                        .into_iter()
                        .find(|value| !value.is_null())
                        .unwrap_or(Value::Null)),
                    "len" if values.len() == 1 => match &values[0] {
                        Value::Null => Ok(Value::Null),
                        Value::String(value) => Ok(json!(value.encode_utf16().count())),
                        Value::Array(value) => Ok(json!(value.len())),
                        _ => Err(refused("len expects a string or array")),
                    },
                    "trim" | "lower" if values.len() == 1 => match &values[0] {
                        Value::Null => Ok(Value::Null),
                        Value::String(value) => Ok(Value::String(if func == "trim" {
                            portable_trim(value)
                        } else {
                            value.to_lowercase()
                        })),
                        _ => Err(refused(format!("{func} expects a string"))),
                    },
                    "abs" | "round" | "floor" | "ceil" if values.len() == 1 => {
                        if values[0].is_null() {
                            return Ok(Value::Null);
                        }
                        let value = number(&values[0])
                            .ok_or_else(|| refused(format!("{func} expects a number")))?;
                        Ok(number_value(match func.as_str() {
                            "abs" => value.abs(),
                            "round" => round_ecmascript(value),
                            "floor" => value.floor(),
                            "ceil" => value.ceil(),
                            _ => unreachable!(),
                        }))
                    }
                    "min" | "max" if !values.is_empty() => {
                        if values.iter().any(Value::is_null) {
                            return Ok(Value::Null);
                        }
                        let mut best: Option<f64> = None;
                        for value in &values {
                            let value = number(value)
                                .ok_or_else(|| refused(format!("{func} expects numbers")))?;
                            best = Some(match best {
                                None => value,
                                Some(best) if (func == "min") == (value < best) => value,
                                Some(best) => best,
                            });
                        }
                        Ok(number_value(best.expect("non-empty values checked")))
                    }
                    _ => Err(refused(format!(
                        "function {func} has unsupported name or arity in the migration oracle"
                    ))),
                }
            }
            ValueExpr::Record { fields } => {
                let mut output = Map::new();
                for (name, expr) in fields {
                    output.insert(name.clone(), child(expr)?);
                }
                Ok(Value::Object(output))
            }
            ValueExpr::Args
            | ValueExpr::AuthUserId
            | ValueExpr::AuthKind
            | ValueExpr::AuthActorKind
            | ValueExpr::AuthActivityActorKind
            | ValueExpr::AuthActorUserId
            | ValueExpr::AuthGrantId
            | ValueExpr::ClientMutationDigest
            | ValueExpr::AuthIsDelegated
            | ValueExpr::RuntimeId
            | ValueExpr::RuntimeNow
            | ValueExpr::MembershipExists(_) => Err(refused(
                "expression is outside the closed migration expected-value profile",
            )),
        }
    }

    evaluate(expr, constants, bindings, 0)
}

/// How one proof table's successor content derives from predecessor rows.
enum ProofTransform<'a> {
    /// Staged CopyTable: pristine predecessor rows still exist in the
    /// source table; the expected evaluator maps them through the closed
    /// field expressions — fully independent of the executor's writes.
    Staged {
        source_table: &'a str,
        staged_table: String,
        fields: &'a BTreeMap<String, crate::manifest::ValueExpr>,
    },
    /// In-place writes into NEW columns: the predecessor-visible row is the
    /// actual row minus the destination columns, so the expected value
    /// recomputes from expression semantics. Destinations that existed on
    /// the predecessor are outside this proof domain (fail-closed).
    InPlace {
        writes: Vec<(&'a str, &'a crate::manifest::ValueExpr)>,
    },
}

/// The LLP 0081 §5 data proof: for every table the plan marks with
/// `ContentDigest` verification, compute expected logical/system
/// `ContentDigestV1` streams from predecessor-derived rows plus the closed
/// plan, compare with the actual successor streams, and check declared
/// `RowCountMatchesSource` facts. `sampled-audit` bounds the row stream and
/// says so on its face; it is never a proof.
fn run_data_proof(
    tx: &Transaction<'_>,
    predecessor_schema: &SchemaManifest,
    successor_schema: &SchemaManifest,
    artifact: &MigrationPlanArtifactV1,
    barrier_head: u64,
    publication_version: u64,
) -> SnapbackResult<Value> {
    use crate::migration::{MigrationProofMethod, MigrationVerification};
    let constants = &artifact.body.constants;
    let proof_method = artifact.body.proof.method;
    let sample_bound = match proof_method {
        MigrationProofMethod::Full => None,
        MigrationProofMethod::SampledAudit => Some(artifact.body.proof.bound.unwrap_or(0)),
    };

    // Collect proof tables and row-count facts from the per-step
    // verification declarations.
    let mut digest_tables: BTreeSet<String> = BTreeSet::new();
    let mut row_count_facts: Vec<(String, String)> = Vec::new();
    for record in &artifact.body.steps {
        for verification in &record.verification {
            match verification {
                MigrationVerification::ContentDigest { table } => {
                    digest_tables.insert(table.clone());
                }
                MigrationVerification::RowCountMatchesSource {
                    source_table,
                    table,
                } => row_count_facts.push((source_table.clone(), table.clone())),
            }
        }
    }

    let mut tables_proof = serde_json::Map::new();
    for table in &digest_tables {
        // Resolve the transform for this table from the plan's steps.
        let staged = artifact.body.steps.iter().find_map(|record| {
            if let MigrationStep::CopyTable {
                source_table,
                table: dest,
                generation,
                fields,
            } = &record.step
                && dest == table
            {
                Some(ProofTransform::Staged {
                    source_table,
                    staged_table: staged_table_name(dest, *generation),
                    fields,
                })
            } else {
                None
            }
        });
        let transform = match staged {
            Some(transform) => transform,
            None => {
                let mut writes = Vec::new();
                for record in &artifact.body.steps {
                    match &record.step {
                        MigrationStep::AddField {
                            table: dest,
                            field,
                            backfill: Some(expr),
                            ..
                        }
                        | MigrationStep::BackfillField {
                            table: dest,
                            field,
                            expr,
                        } if dest == table => writes.push((field.as_str(), expr)),
                        MigrationStep::CopyField {
                            source_table,
                            table: dest,
                            field,
                            expr: Some(expr),
                            ..
                        } if dest == table && source_table == table => {
                            writes.push((field.as_str(), expr));
                        }
                        _ => {}
                    }
                }
                // Fail-closed proof domain: every in-place destination must
                // be NEW on the successor — a predecessor column's prior
                // bytes are unrecoverable in place, so its digest would be
                // approximate, which §5 refuses.
                if let Some(predecessor_table) = predecessor_schema.table(table) {
                    for (field, _) in &writes {
                        if predecessor_table.field(field).is_some() {
                            return Err(profile_unsupported(
                                "ContentDigest proof over an in-place write to a predecessor \
                                 column is outside v1's proof domain; stage a generation instead",
                            ));
                        }
                    }
                }
                ProofTransform::InPlace { writes }
            }
        };

        let successor_table = successor_schema
            .table(table)
            .ok_or_else(|| profile_unsupported("proof table undeclared on the successor"))?;
        let header = crate::rqs_contract::ContentDigestHeaderV1 {
            algorithm_version: 1,
            plan_digest: artifact.plan_digest.clone(),
            schema_hash: artifact.body.successor_schema_hash.clone(),
            qualified_table: (*table).clone(),
            generation: format!("g{}", artifact.body.predecessor_generation + 1),
            barrier_head,
            publication_version,
            publication_timestamp: constants.publication_timestamp_ms,
        };
        let mut expected_logical = crate::rqs_contract::ContentDigestStream::new(
            crate::rqs_contract::CONTENT_DIGEST_DOMAIN,
            &header,
        );
        let mut expected_system = crate::rqs_contract::ContentDigestStream::new(
            crate::rqs_contract::CONTENT_DIGEST_SYSTEM_DOMAIN,
            &header,
        );
        let mut actual_logical = crate::rqs_contract::ContentDigestStream::new(
            crate::rqs_contract::CONTENT_DIGEST_DOMAIN,
            &header,
        );
        let mut actual_system = crate::rqs_contract::ContentDigestStream::new(
            crate::rqs_contract::CONTENT_DIGEST_SYSTEM_DOMAIN,
            &header,
        );
        let input = HandlerInput {
            args: Value::Object(constants.values.clone().into_iter().collect()),
            ..HandlerInput::default()
        };
        let digest_refused = |_: crate::rqs_contract::MintRefusal| {
            profile_unsupported(
                "a row value is outside the canonical proof domain; refused, never digested \
                 approximately",
            )
        };
        let logical_value = |row: &Value| -> Value {
            let mut fields = serde_json::Map::new();
            for field in &successor_table.fields {
                if let Some(value) = row.get(&field.name)
                    && !value.is_null()
                {
                    fields.insert(field.name.clone(), value.clone());
                }
            }
            if let Some(id) = row.get("_id") {
                fields.insert("_id".to_owned(), id.clone());
            }
            Value::Object(fields)
        };
        let system_value = |row: &Value| -> Value {
            json!({
                "_id": row.get("_id").cloned().unwrap_or(Value::Null),
                "_version": row.get("_version").cloned().unwrap_or(Value::Null),
                "_createdAt": row.get("_createdAt").cloned().unwrap_or(Value::Null),
                "_updatedAt": row.get("_updatedAt").cloned().unwrap_or(Value::Null),
            })
        };

        let mut rows_proven: u64 = 0;
        match &transform {
            ProofTransform::Staged {
                source_table,
                staged_table,
                fields,
            } => {
                // Expected: map pristine source rows through the closed plan.
                let mut after: Option<String> = None;
                'expected: loop {
                    let page =
                        read_id_page(tx, predecessor_schema, source_table, after.as_deref())?;
                    for row in &page {
                        if sample_bound.is_some_and(|bound| rows_proven >= bound) {
                            break 'expected;
                        }
                        let mut bindings = BTreeMap::new();
                        bindings.insert("row".to_owned(), row.clone());
                        let mut produced = serde_json::Map::new();
                        let mut content_changed = false;
                        for (dest, expr) in fields.iter() {
                            let value = migration_expected_oracle(expr, &input.args, &bindings)?;
                            if row.get(dest).cloned().unwrap_or(Value::Null) != value {
                                content_changed = true;
                            }
                            if !value.is_null() {
                                produced.insert(dest.clone(), value);
                            }
                        }
                        produced.insert(
                            "_id".to_owned(),
                            row.get("_id").cloned().unwrap_or(Value::Null),
                        );
                        expected_logical
                            .absorb_row(&Value::Object(produced))
                            .map_err(digest_refused)?;
                        let (version, updated) = if content_changed {
                            (
                                json!(publication_version),
                                json!(constants.publication_timestamp_ms),
                            )
                        } else {
                            (
                                row.get("_version").cloned().unwrap_or(Value::Null),
                                row.get("_updatedAt").cloned().unwrap_or(Value::Null),
                            )
                        };
                        expected_system
                            .absorb_row(&json!({
                                "_id": row.get("_id").cloned().unwrap_or(Value::Null),
                                "_version": version,
                                "_createdAt": row.get("_createdAt").cloned().unwrap_or(Value::Null),
                                "_updatedAt": updated,
                            }))
                            .map_err(digest_refused)?;
                        rows_proven += 1;
                        after = row.get("_id").and_then(Value::as_str).map(str::to_owned);
                    }
                    if page.len() < BACKFILL_BATCH_ROWS {
                        break;
                    }
                }
                // Actual: the staged generation's stored bytes.
                let mut staged_manifest = successor_table.clone();
                staged_manifest.name = staged_table.clone();
                let mut staged_schema = successor_schema.clone();
                staged_schema.tables.push(staged_manifest);
                let mut after: Option<String> = None;
                let mut actual_rows: u64 = 0;
                'actual: loop {
                    let page = read_id_page(tx, &staged_schema, staged_table, after.as_deref())?;
                    for row in &page {
                        if sample_bound.is_some_and(|bound| actual_rows >= bound) {
                            break 'actual;
                        }
                        actual_logical
                            .absorb_row(&logical_value(row))
                            .map_err(digest_refused)?;
                        actual_system
                            .absorb_row(&system_value(row))
                            .map_err(digest_refused)?;
                        actual_rows += 1;
                        after = row.get("_id").and_then(Value::as_str).map(str::to_owned);
                    }
                    if page.len() < BACKFILL_BATCH_ROWS {
                        break;
                    }
                }
            }
            ProofTransform::InPlace { writes } => {
                // One pass: each actual row also yields its expected form —
                // the predecessor-visible reconstruction (actual minus the
                // new destination columns) pushed through the expressions.
                let schema = effective_barrier_schema(predecessor_schema, successor_schema, table);
                let mut after: Option<String> = None;
                'inplace: loop {
                    let page = read_id_page(tx, &schema, table, after.as_deref())?;
                    for row in &page {
                        if sample_bound.is_some_and(|bound| rows_proven >= bound) {
                            break 'inplace;
                        }
                        let mut predecessor_row = row
                            .as_object()
                            .cloned()
                            .ok_or_else(|| journal_corrupt("row is not an object".to_owned()))?;
                        for (dest, _) in writes {
                            predecessor_row.remove(*dest);
                        }
                        let predecessor_value = Value::Object(predecessor_row);
                        let mut bindings = BTreeMap::new();
                        bindings.insert("row".to_owned(), predecessor_value.clone());
                        let mut expected_row =
                            predecessor_value.as_object().cloned().unwrap_or_default();
                        let mut content_changed = false;
                        for (dest, expr) in writes {
                            let value = migration_expected_oracle(expr, &input.args, &bindings)?;
                            if !value.is_null() {
                                content_changed = true;
                                expected_row.insert((*dest).to_owned(), value);
                            }
                        }
                        let expected_value = Value::Object(expected_row);
                        expected_logical
                            .absorb_row(&logical_value(&expected_value))
                            .map_err(digest_refused)?;
                        actual_logical
                            .absorb_row(&logical_value(row))
                            .map_err(digest_refused)?;
                        let (version, updated) = if content_changed {
                            (
                                json!(publication_version),
                                json!(constants.publication_timestamp_ms),
                            )
                        } else {
                            (
                                row.get("_version").cloned().unwrap_or(Value::Null),
                                row.get("_updatedAt").cloned().unwrap_or(Value::Null),
                            )
                        };
                        expected_system
                            .absorb_row(&json!({
                                "_id": row.get("_id").cloned().unwrap_or(Value::Null),
                                "_version": version,
                                "_createdAt": row.get("_createdAt").cloned().unwrap_or(Value::Null),
                                "_updatedAt": updated,
                            }))
                            .map_err(digest_refused)?;
                        actual_system
                            .absorb_row(&system_value(row))
                            .map_err(digest_refused)?;
                        rows_proven += 1;
                        after = row.get("_id").and_then(Value::as_str).map(str::to_owned);
                    }
                    if page.len() < BACKFILL_BATCH_ROWS {
                        break;
                    }
                }
            }
        }

        let expected_logical = expected_logical.finalize();
        let actual_logical = actual_logical.finalize();
        let expected_system = expected_system.finalize();
        let actual_system = actual_system.finalize();
        if expected_logical != actual_logical || expected_system != actual_system {
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_VERIFICATION_FAILED",
                "storage",
                format!(
                    "the successor content of {table} does not match the expected-value \
                     evaluation: logical {expected_logical} vs {actual_logical}, system \
                     {expected_system} vs {actual_system}"
                ),
            ));
        }
        tables_proof.insert(
            (*table).clone(),
            json!({
                "expectedLogicalDigest": expected_logical,
                "actualLogicalDigest": actual_logical,
                "expectedSystemDigest": expected_system,
                "actualSystemDigest": actual_system,
                "matches": true,
                // Retain the original compact fields for v1 receipt readers.
                "logicalDigest": actual_logical,
                "systemDigest": actual_system,
                "rows": rows_proven,
                "rejects": 0,
            }),
        );
    }

    for (source_table, table) in &row_count_facts {
        let staged = artifact.body.steps.iter().find_map(|record| {
            if let MigrationStep::CopyTable {
                table: dest,
                generation,
                ..
            } = &record.step
                && dest == table
            {
                Some(staged_table_name(dest, *generation))
            } else {
                None
            }
        });
        let physical = staged.unwrap_or_else(|| table.clone());
        let count = |name: &str| -> SnapbackResult<u64> {
            Ok(tx.query_row(
                &format!("SELECT COUNT(*) FROM {}", quote_ident(name)?),
                [],
                |row| row.get::<_, i64>(0),
            )? as u64)
        };
        let source = count(source_table)?;
        let destination = count(&physical)?;
        if source != destination {
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_VERIFICATION_FAILED",
                "storage",
                format!(
                    "row count of {table} ({destination}) does not match source \
                     {source_table} ({source})"
                ),
            ));
        }
    }

    Ok(json!({
        "proofClass": match proof_method {
            MigrationProofMethod::Full => "independentBoundaryProof",
            MigrationProofMethod::SampledAudit => "inventory",
        },
        "boundaryDomain": "migration",
        "expectedEvaluatorIndependence": match proof_method {
            MigrationProofMethod::Full => "separateImplementation",
            MigrationProofMethod::SampledAudit => "notApplicable",
        },
        "independenceLimitation": Value::Null,
        "expectedDerivation": match proof_method {
            MigrationProofMethod::Full => Some(
                "predecessor rows plus the closed typed MigrationPlanV1 expected-value evaluator"
            ),
            MigrationProofMethod::SampledAudit => None,
        },
        "proofMethod": match proof_method {
            MigrationProofMethod::Full => "full",
            MigrationProofMethod::SampledAudit => "sampled-audit",
        },
        // §5: a sampled-audit receipt says so on its face — it is a
        // rehearsal/audit label, never a substitute for proof.
        "proofLabel": match proof_method {
            MigrationProofMethod::Full => "independent full-table boundary proof",
            MigrationProofMethod::SampledAudit =>
                "sampled-audit — lower-assurance rehearsal/audit run, NOT a proof",
        },
        "sampleBound": sample_bound,
        "tables": Value::Object(tables_proof),
        "rowCountFacts": row_count_facts.len(),
        "schemaBinding": "predecessor and successor hashes proven at admission",
    }))
}

/// One `_id`-ordered keyset page read inside the executor's transaction.
fn read_id_page(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    table_name: &str,
    after: Option<&str>,
) -> SnapbackResult<Vec<Value>> {
    let table = schema_table(schema, table_name)?;
    let page_plan = QueryPlan {
        table_visibility: None,
        table: table_name.to_owned(),
        filters: Vec::new(),
        membership_filters: Vec::new(),
        order: Vec::new(),
        limit: Some(BACKFILL_BATCH_ROWS),
        indexed_by: None,
    };
    let boundary = after.map(|id| KeysetAfter {
        entries: Vec::new(),
        id: id.to_owned(),
    });
    let (sql, values) = super::build_query_sql(
        table,
        schema,
        &page_plan,
        &HandlerInput::default(),
        &BTreeMap::new(),
        None,
        0,
        None,
        "migration/page",
        Some(BACKFILL_BATCH_ROWS),
        boundary.as_ref(),
        true,
        crate::manifest::OrderDirection::Asc,
        None,
    )?;
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
    Ok(out)
}

/// Insert one row into a staged generation with EXPLICIT system fields —
/// §4's identity rules, never the application insert path's fresh stamps.
#[allow(clippy::too_many_arguments)] // Stable migration-row boundary; regrouping is out of scope here.
fn insert_staged_row(
    tx: &Transaction<'_>,
    staged: &TableManifest,
    id: &str,
    fields: &Map<String, Value>,
    version: u64,
    created_at_ms: u64,
    updated_at_ms: u64,
    step_id: &str,
) -> SnapbackResult<()> {
    let mut columns = vec![
        "_id".to_owned(),
        "_version".to_owned(),
        "_createdAt".to_owned(),
        "_updatedAt".to_owned(),
    ];
    let mut placeholders = vec![
        "?1".to_owned(),
        "?2".to_owned(),
        "?3".to_owned(),
        "?4".to_owned(),
    ];
    let mut values: Vec<SqlValue> = vec![
        SqlValue::Text(id.to_owned()),
        SqlValue::Integer(version_to_sql_integer(version)?),
        SqlValue::Integer(timestamp_to_sql_millis(created_at_ms)?),
        SqlValue::Integer(timestamp_to_sql_millis(updated_at_ms)?),
    ];
    let mut normalized_fields = Map::new();
    for (name, value) in fields {
        let manifest = staged
            .field(name)
            .ok_or_else(|| step_failed(step_id, "staged destination field is undeclared"))?;
        let (normalized, sql_value, _) =
            prepare_migration_field_value(&staged.name, manifest, value, step_id)?;
        columns.push(name.clone());
        placeholders.push(format!("?{}", values.len() + 1));
        values.push(sql_value);
        normalized_fields.insert(name.clone(), normalized);
    }
    validate_migration_structured_row_aggregate(staged, &normalized_fields, step_id)?;
    let column_sql = columns
        .iter()
        .map(|column| quote_ident(column))
        .collect::<SnapbackResult<Vec<_>>>()?
        .join(", ");
    tx.execute(
        &format!(
            "INSERT INTO {} ({column_sql}) VALUES ({})",
            quote_ident(&staged.name)?,
            placeholders.join(", ")
        ),
        super::params_from_iter(values.iter()),
    )?;
    Ok(())
}

/// Migration destinations remain physically nullable until their explicit
/// `ValidateRequired` step. All other declared-value admission still runs at
/// the row write, and its client/schema diagnostic is nested under the typed
/// migration-step failure required by the executor protocol.
///
/// @ref LLP 0081#3-typed-migration-steps — staged nullability is discharged by
///   ValidateRequired; per-row write failures belong to the executing step.
/// @ref LLP 0211#representation-and-write-path — migration writers still use
///   the central fail-closed structured admission and canonicalization seam.
fn prepare_migration_field_value(
    table: &str,
    field: &FieldManifest,
    value: &Value,
    step_id: &str,
) -> SnapbackResult<(Value, SqlValue, usize)> {
    let mut staged_field = field.clone();
    staged_field.optional = true;
    super::prepare_declared_field_value(table, &staged_field, value)
        .map_err(|error| migration_admission_failed(step_id, error))
}

fn validate_migration_structured_row_aggregate(
    table: &TableManifest,
    values: &Map<String, Value>,
    step_id: &str,
) -> SnapbackResult<()> {
    super::validate_structured_row_aggregate(table, values)
        .map(|_| ())
        .map_err(|error| migration_admission_failed(step_id, error))
}

fn migration_admission_failed(step_id: &str, error: SnapbackError) -> SnapbackError {
    let cause_code = error.diagnostic.code;
    let cause_message = error.diagnostic.message;
    let cause_details = error.diagnostic.details;
    step_failed(
        step_id,
        &format!("row admission refused by {cause_code}: {cause_message}"),
    )
    .with_details(json!({
        "causeCode": cause_code,
        "causeDetails": cause_details,
    }))
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
    // Shadow-generation plans stage successor tables beside the live ones
    // and swap at publication; a staged step therefore requires the
    // matching strategy declaration, and vice versa, so the approver's
    // review saw the strategy the executor runs.
    let has_staged = artifact.body.steps.iter().any(|record| {
        matches!(
            record.step,
            MigrationStep::CopyTable { .. }
                | MigrationStep::StageTableGeneration { .. }
                | MigrationStep::RetireGeneration { .. }
        )
    });
    let shadow = matches!(
        artifact.body.execution_strategy,
        MigrationExecutionStrategy::ShadowGeneration
    );
    if has_staged != shadow {
        return Err(profile_unsupported(
            "staged-generation steps and the shadow-generation strategy declaration must \
             appear together",
        ));
    }
    // Rollback requires its explicit timestamp constant at plan time so the
    // approver acknowledged the rollback boundary (LLP 0081 §6).
    if let Some(rollback_ms) = artifact.body.constants.rollback_timestamp_ms
        && rollback_ms < artifact.body.constants.publication_timestamp_ms
    {
        return Err(SnapbackError::error(
            "SNAPBACK_MIGRATION_PLAN_INVALID",
            "storage",
            "rollbackTimestampMs must be at least publicationTimestampMs",
        ));
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
        // A staged CopyTable restamps content-changed rows exactly like an
        // in-place write; its floor is the SOURCE table's maximum, since
        // those are the rows whose successor forms carry the new stamp.
        let table = match &record.step {
            MigrationStep::AddField {
                backfill: Some(_), ..
            }
            | MigrationStep::BackfillField { .. }
            | MigrationStep::CopyField { .. } => record.step.anchor_table().to_owned(),
            MigrationStep::CopyTable { source_table, .. } => source_table.clone(),
            _ => continue,
        };
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

fn active_other_operation(conn: &Connection, operation_id: &str) -> SnapbackResult<Option<String>> {
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

    /// Read-only aggregate settlement lookup. While P is held it returns the
    /// retained `published-held`/outcome-pending lifecycle and never drives
    /// publication or release; after T it returns the digest-linked terminal
    /// supplement.
    pub fn migration_aggregate_lookup(
        &self,
        operation_id: &str,
    ) -> SnapbackResult<Option<crate::operation_ledger::PendingOperationLookupV1>> {
        if !super::sqlite_table_exists(&self.conn, "_snapback_migration_ops")? {
            return Ok(None);
        }
        let has_identity: bool = self.conn.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM pragma_table_info('_snapback_migration_ops')
                WHERE name='aggregate_identity_json'
             )",
            [],
            |row| row.get(0),
        )?;
        if !has_identity {
            return Ok(None);
        }
        let identity: Option<Option<String>> = self
            .conn
            .query_row(
                "SELECT aggregate_identity_json FROM _snapback_migration_ops WHERE operation_id=?1",
                [operation_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(Some(identity)) = identity else {
            return Ok(None);
        };
        let identity: OperationIdentityV1 = serde_json::from_str(&identity)
            .map_err(|_| journal_corrupt("aggregate identity does not parse".to_owned()))?;
        let lookup = crate::operation_ledger::lookup_pending_operation(&self.conn, &identity)?;
        if matches!(
            lookup,
            crate::operation_ledger::PendingOperationLookupV1::Pending(_)
        ) {
            let terminal_receipt_present: bool = self.conn.query_row(
                "SELECT receipt_json IS NOT NULL FROM _snapback_migration_ops
                 WHERE operation_id=?1",
                [operation_id],
                |row| row.get(0),
            )?;
            if terminal_receipt_present {
                return Err(SnapbackError::error(
                    "SNAPBACK_OPERATION_LEDGER_INVALID",
                    "storage",
                    "terminal migration receipt survived without its aggregate supplement",
                ));
            }
        }
        if let crate::operation_ledger::PendingOperationLookupV1::Terminal(terminal) = &lookup {
            // The supplement holds only digests. Recompute the terminal
            // receipt digest from the exact migration receipt bytes still
            // owned by `_snapback_migration_ops`; a swapped or corrupt owner
            // can never authenticate merely because the supplement survived.
            let retained_projection = match terminal.terminal_outcome {
                PendingOperationTerminalOutcomeV1::Committed => {
                    let receipt: String = self.conn.query_row(
                        "SELECT receipt_json FROM _snapback_migration_ops
                         WHERE operation_id=?1 AND receipt_json IS NOT NULL",
                        [operation_id],
                        |row| row.get(0),
                    )?;
                    serde_json::from_str::<Value>(&receipt).map_err(|_| {
                        journal_corrupt("stored terminal receipt does not parse".to_owned())
                    })?
                }
                PendingOperationTerminalOutcomeV1::RolledBack => {
                    let receipts: (String, String) = self.conn.query_row(
                        "SELECT receipt_json,rollback_receipt_json
                         FROM _snapback_migration_ops
                         WHERE operation_id=?1
                           AND receipt_json IS NOT NULL
                           AND rollback_receipt_json IS NOT NULL",
                        [operation_id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )?;
                    json!({
                        "forwardReceipt": serde_json::from_str::<Value>(&receipts.0)
                            .map_err(|_| journal_corrupt("stored forward receipt does not parse".to_owned()))?,
                        "rollbackReceipt": serde_json::from_str::<Value>(&receipts.1)
                            .map_err(|_| journal_corrupt("stored rollback receipt does not parse".to_owned()))?,
                    })
                }
            };
            let retained_digest =
                crate::operation_ledger::pending_operation_terminal_receipt_digest(
                    &retained_projection,
                )?;
            if retained_digest != terminal.terminal_receipt_digest {
                return Err(SnapbackError::error(
                    "SNAPBACK_OPERATION_LEDGER_INVALID",
                    "storage",
                    "migration aggregate terminal supplement does not match its retained receipt bytes",
                ));
            }
        }
        Ok(Some(lookup))
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
        // The receipt seals atomically with publication; the cleanup tail
        // extends the terminal afterwards (§4: the tail ends in the same
        // terminal it extends). The receipt's journal projection is
        // therefore the prefix through the first terminal row — tail rows
        // are post-terminal housekeeping, journaled but outside the seal.
        let terminal_cut = entries
            .iter()
            .position(|entry| {
                matches!(
                    entry.state,
                    MigrationExecState::Released
                        | MigrationExecState::RolledBack
                        | MigrationExecState::Cancelled
                        | MigrationExecState::Abandoned
                )
            })
            .map(|index| index + 1)
            .unwrap_or(entries.len());
        let entries = &entries[..terminal_cut];
        let entries_value = serde_json::to_value(entries)
            .map_err(|_| journal_corrupt("journal serialize".to_owned()))?;
        let journal_jcs = crate::rqs_contract::jcs(&entries_value)
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
        // The §5 data proof rode the Verifying journal entry and the sealed
        // receipt's step results; verify re-presents the recorded proof
        // after re-proving the receipt≡journal seal. Post-release data has
        // legitimately advanced under application traffic, so verify never
        // re-digests live tables against a receipt — the proof is
        // per-migration, at-publication evidence (LLP 0081 §5).
        let data_proof = receipt.step_results.get("§5-data-proof").cloned();
        Ok(json!({
            "operationId": operation_id,
            "journalDigest": recomputed,
            "journalEntries": entries.len(),
            "state": receipt.state.kind(),
            "dataProof": data_proof,
            "rollbackReceipt": stored_rollback_receipt_on(&self.conn, operation_id)?
                .map(|receipt| serde_json::to_value(&receipt).unwrap_or(Value::Null)),
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
        "hostTransactionIdentity": "new entries carry one authenticated Host OperationIdentityV1 per physical journal transaction; parent=approval operationId and ordinal=durable pre-transaction journal row count; legacy entries may omit",
        "aggregateSettlement": {
            "identity": "one approval-operationId-derived authenticated Host identity",
            "publicationCut": "P atomically retains application version, schema-resync row, Pending CommitEnvelopeV1, and pending lifecycle",
            "terminalCut": "T-release or T-rollback atomically appends a digest-linked terminal supplement without rewriting P",
            "terminalOutcomes": ["committed", "rolled-back"],
            "coveredBoundaries": [],
            "uncoveredBoundaries": ["aggregate-P/T", "H1", "H2", "C"],
        },
        "envelopeCoverage": "uncovered — aggregate P/T settlement is implemented for corpus evidence but remains unpublished; H1/H2/C remain carrier-only",
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
        FieldManifest, FieldType, HandlerInput, ResultObjectFieldContract, ResultValueContract,
        SchemaManifest, SeedData, StoredStructuredContractV1, TableManifest, ValueExpr,
    };
    use crate::migration::{
        CompatibilityPosture, MIGRATION_APPROVAL_SCHEMA_VERSION, MIGRATION_PLAN_SCHEMA_VERSION,
        MigrationApprovalV1, MigrationAudienceV1, MigrationBackupRequirement, MigrationCeilings,
        MigrationConstants, MigrationExpectedOutput, MigrationIntent, MigrationPlanArtifactV1,
        MigrationPlanBody, MigrationProof, MigrationProofMethod, RetainedWorkPosture,
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
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
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

    #[test]
    fn staged_migration_copy_canonicalizes_structured_values_before_insert() {
        let contract = StoredStructuredContractV1 {
            version: crate::manifest::STORED_STRUCTURED_CONTRACT_VERSION_V1,
            descriptor: ResultValueContract::Object {
                fields: vec![
                    ResultObjectFieldContract {
                        name: "label".to_owned(),
                        required: true,
                        value: ResultValueContract::String { max_bytes: 64 },
                    },
                    ResultObjectFieldContract {
                        name: "n".to_owned(),
                        required: true,
                        value: ResultValueContract::FiniteReal {
                            min: -100.0,
                            max: 100.0,
                        },
                    },
                ],
                allow_extra: false,
            },
            encoding: crate::manifest::STORED_STRUCTURED_ENCODING_V1.to_owned(),
        };
        let contract_hash = crate::manifest::stored_structured_contract_hash(&contract).unwrap();
        let schema = SchemaManifest {
            tables: vec![TableManifest {
                name: "migrationRows".to_owned(),
                fields: vec![FieldManifest {
                    name: "payload".to_owned(),
                    field_type: FieldType::Structured {
                        contract,
                        contract_hash,
                    },
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
        };
        let mut db = LocalDatabase::memory().unwrap();
        db.apply_schema(schema).unwrap();
        let table = db.schema().table("migrationRows").unwrap().clone();
        let tx = db.conn.transaction().unwrap();
        set_version(&tx, 7).expect("align migration row with storage head");
        let refused = insert_staged_row(
            &tx,
            &table,
            "migration-refused",
            &serde_json::Map::from_iter([(
                "payload".to_owned(),
                json!({ "label": "missing required n" }),
            )]),
            7,
            10,
            11,
            "copy-structured",
        )
        .expect_err("invalid staged structured value must refuse");
        assert_eq!(refused.diagnostic.code, "SNAPBACK_MIGRATION_STEP_FAILED");
        assert_eq!(
            refused.diagnostic.details["causeCode"],
            "SNAPBACK_STRUCTURED_VALUE_INVALID"
        );
        let refused_rows: u64 = tx
            .query_row(
                "SELECT COUNT(*) FROM migrationRows WHERE _id='migration-refused'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(refused_rows, 0, "refused admission must write no row");
        insert_staged_row(
            &tx,
            &table,
            "migration-copy",
            &serde_json::Map::from_iter([(
                "payload".to_owned(),
                json!({ "n": 8.0, "label": "copied" }),
            )]),
            7,
            10,
            11,
            "copy-structured",
        )
        .expect("staged structured copy");
        tx.commit().unwrap();
        let raw: String = db
            .conn
            .query_row(
                "SELECT payload FROM migrationRows WHERE _id='migration-copy'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(raw, r#"{"label":"copied","n":8}"#);
        assert_eq!(
            db.get("migrationRows", "migration-copy").unwrap().unwrap()["payload"],
            json!({ "label": "copied", "n": 8 })
        );
    }

    const PUBLICATION_TS: u64 = 1_900_000_000_000;

    #[test]
    fn cross_table_copy_resumes_after_the_committed_keyset_boundary() {
        let schema = SchemaManifest {
            tables: vec![
                table("source_rows", vec![("value", false)]),
                table("dest_rows", vec![("copied", true)]),
            ],
            ..SchemaManifest::default()
        };
        let mut db = LocalDatabase::memory().expect("memory db");
        db.apply_schema(schema.clone()).expect("schema");
        db.conn
            .execute_batch(
                "INSERT INTO source_rows(_id,_version,_createdAt,_updatedAt,value)
                   VALUES('a',1,1,1,'first'),('b',1,1,1,'second');
                 INSERT INTO dest_rows(_id,_version,_createdAt,_updatedAt,copied)
                   VALUES('a',1,1,1,NULL),('b',1,1,1,NULL);
                 CREATE TABLE _snapback_migration_journal(
                   seq INTEGER PRIMARY KEY AUTOINCREMENT,
                   operation_id TEXT NOT NULL,
                   entry_json TEXT NOT NULL
                 );",
            )
            .expect("fixture rows");
        let entry = MigrationJournalEntryV1 {
            version: MIGRATION_JOURNAL_SCHEMA_VERSION.to_owned(),
            operation_id: "resume-op".to_owned(),
            plan_id: "resume-plan".to_owned(),
            host_operation_identity: None,
            step_id: Some("copy-step".to_owned()),
            attempt: 0,
            state: MigrationExecState::Executing {
                step: "copy-step".to_owned(),
                batch: 0,
            },
            input_version: 1,
            output_version: None,
            cursor: None,
            backfill_after_id: Some("a".to_owned()),
            verification: None,
            error_code: None,
            lease_epoch: 1,
            at_ms: 1,
            barrier_elapsed_ms: None,
        };
        db.conn
            .execute(
                "INSERT INTO _snapback_migration_journal(operation_id,entry_json)
                 VALUES(?1,?2)",
                params![
                    entry.operation_id,
                    serde_json::to_string(&entry).expect("journal JSON")
                ],
            )
            .expect("journal boundary");
        let constants = MigrationConstants {
            publication_timestamp_ms: 2,
            rollback_timestamp_ms: None,
            values: BTreeMap::new(),
        };
        let no_op_journal = |_tx: &Transaction<'_>,
                             _batch: u64,
                             _cursor: Option<&MigrationKeysetScanCheckpointV1>,
                             _after: Option<&str>,
                             _verification: Option<&Value>| { Ok(()) };
        let result = db
            .run_cross_table_copy_batches(
                "resume-op",
                "source_rows",
                "value",
                "dest_rows",
                "copied",
                None,
                &schema,
                &constants,
                2,
                "copy-step",
                &no_op_journal,
            )
            .expect("resume copy");
        assert_eq!(result["rowsWritten"], 1);
        let copied = db
            .conn
            .prepare("SELECT _id,copied FROM dest_rows ORDER BY _id")
            .expect("query")
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .expect("rows")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect");
        assert_eq!(
            copied,
            vec![
                ("a".to_owned(), None),
                ("b".to_owned(), Some("second".to_owned()))
            ]
        );
    }

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
                rehearsal_required: false,
            },
            expected_output: MigrationExpectedOutput {
                schema_hash: schema_identity(successor).expect("successor id"),
                projection_generations: BTreeMap::new(),
            },
            constants: MigrationConstants {
                publication_timestamp_ms: PUBLICATION_TS,
                rollback_timestamp_ms: None,
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
            rehearsal: None,
        })
    }

    fn install_barriered_operation_for_test(
        db: &mut LocalDatabase,
        plan: &MigrationPlanArtifactV1,
        approval: &MigrationApprovalV1,
    ) {
        ensure_migration_host_authority(&mut db.conn, 1).expect("migration host authority");
        let input_version = db.current_version().expect("input version");
        let tx = db
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .expect("barrier transaction");
        ensure_migration_tables(&tx).expect("migration tables");
        upsert_meta(&tx, META_MIGRATION_LEASE_EPOCH, "1").expect("lease epoch");
        upsert_meta(
            &tx,
            META_MIGRATION_FENCE,
            &serde_json::to_string(&MigrationFenceV1 {
                operation_id: approval.operation_id.clone(),
                lease_epoch: 1,
                closed_at_ms: 1,
            })
            .expect("fence JSON"),
        )
        .expect("persist fence");
        tx.execute(
            "INSERT INTO _snapback_migration_ops(
               operation_id,audience_json,plan_digest,state_json,lease_epoch,
               cancel_requested,approval_digest
             ) VALUES(?1,?2,?3,?4,1,0,?5)",
            params![
                approval.operation_id,
                serde_json::to_string(&approval.audience).expect("audience JSON"),
                plan.plan_digest,
                serde_json::to_string(&MigrationExecState::Barriered).expect("state JSON"),
                approval_digest(approval).expect("approval digest"),
            ],
        )
        .expect("operation row");
        let journal = JournalHandle {
            tx: &tx,
            operation_id: approval.operation_id.clone(),
            plan_id: plan.plan_id.clone(),
            lease_epoch: 1,
            input_version,
            host_operation_identity: OnceCell::new(),
        };
        let at = now_millis();
        journal
            .append(JournalAppend {
                at_ms: at,
                ..JournalAppend::of(&MigrationExecState::Admitted)
            })
            .expect("admitted row");
        journal
            .append(JournalAppend {
                at_ms: at,
                ..JournalAppend::of(&MigrationExecState::Barriered)
            })
            .expect("barriered row");
        tx.commit().expect("commit barrier");
    }

    #[test]
    fn llp0163_migration_journal_transactions_use_retry_stable_host_children() {
        let mut db = seeded_db();
        let operation_id = new_operation_id();
        let plan_id = format!("migration-v1:{}", "a".repeat(64));
        ensure_migration_host_authority(&mut db.conn, 1).expect("durable migration host epoch");
        {
            let tx = db
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .expect("admission transaction");
            ensure_migration_tables(&tx).expect("migration tables");
            upsert_meta(&tx, META_MIGRATION_LEASE_EPOCH, "1").expect("lease epoch");
            tx.execute(
                "INSERT INTO _snapback_migration_ops(
                   operation_id,audience_json,plan_digest,state_json,lease_epoch,
                   cancel_requested,rehearsal
                 ) VALUES(?1,'{}','fixture',?2,1,0,0)",
                params![
                    operation_id,
                    serde_json::to_string(&MigrationExecState::Admitted)
                        .expect("initial state JSON")
                ],
            )
            .expect("operation row");
            let journal = JournalHandle {
                tx: &tx,
                operation_id: operation_id.clone(),
                plan_id: plan_id.clone(),
                lease_epoch: 1,
                input_version: 1,
                host_operation_identity: OnceCell::new(),
            };
            journal
                .append(JournalAppend {
                    at_ms: 10,
                    ..JournalAppend::of(&MigrationExecState::Admitted)
                })
                .expect("admitted row");
            journal
                .append(JournalAppend {
                    at_ms: 11,
                    ..JournalAppend::of(&MigrationExecState::Barriered)
                })
                .expect("barriered row");
            tx.commit().expect("admission commit");
        }

        let admitted = journal_entries_on(&db.conn, &operation_id).expect("admission journal");
        assert_eq!(admitted.len(), 2);
        let parent_identity = admitted[0]
            .host_operation_identity
            .as_ref()
            .expect("admission host identity");
        assert_eq!(
            admitted[1].host_operation_identity.as_ref(),
            Some(parent_identity),
            "every journal row in one SQLite transaction shares one child identity"
        );
        let OperationIssuanceV1::HostIncarnation {
            upstream_identity,
            commit_ordinal,
            ..
        } = &parent_identity.issuance
        else {
            panic!("migration journal identity must use host issuance");
        };
        assert_eq!(upstream_identity, &operation_id);
        assert_eq!(*commit_ordinal, 0);
        crate::operation_ledger::authenticate_host_identity(&db.conn, parent_identity)
            .expect("admission host identity authenticates");

        let executing = MigrationExecState::Executing {
            step: "fixture-step".to_owned(),
            batch: 0,
        };
        let rolled_back_identity = {
            let tx = db
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .expect("crashing step transaction");
            let journal = JournalHandle {
                tx: &tx,
                operation_id: operation_id.clone(),
                plan_id: plan_id.clone(),
                lease_epoch: 1,
                input_version: 1,
                host_operation_identity: OnceCell::new(),
            };
            journal
                .append(JournalAppend {
                    step_id: Some("fixture-step"),
                    at_ms: 12,
                    ..JournalAppend::of(&executing)
                })
                .expect("provisional executing row");
            let identity = journal
                .host_operation_identity
                .get()
                .expect("provisional host identity")
                .clone();
            drop(journal);
            tx.rollback().expect("simulated crash rollback");
            identity
        };
        assert_eq!(
            journal_entries_on(&db.conn, &operation_id)
                .expect("rolled-back journal")
                .len(),
            2,
            "a crash leaves neither the transition nor its carrier"
        );

        // A resumed executor owns a new fencing lease, but that attempt-local
        // token cannot change the operation identity of the retried cut.
        {
            let tx = db
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .expect("resume lease transaction");
            upsert_meta(&tx, META_MIGRATION_LEASE_EPOCH, "2").expect("superseding lease");
            tx.commit().expect("resume lease commit");
        }

        {
            let tx = db
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .expect("retry step transaction");
            let journal = JournalHandle {
                tx: &tx,
                operation_id: operation_id.clone(),
                plan_id: plan_id.clone(),
                lease_epoch: 2,
                input_version: 1,
                host_operation_identity: OnceCell::new(),
            };
            journal
                .append(JournalAppend {
                    step_id: Some("fixture-step"),
                    at_ms: 13,
                    ..JournalAppend::of(&executing)
                })
                .expect("retried executing row");
            tx.commit().expect("retry commit");
        }
        let retried = journal_entries_on(&db.conn, &operation_id).expect("retried journal");
        let retry_identity = retried[2]
            .host_operation_identity
            .as_ref()
            .expect("retry host identity");
        assert_eq!(retry_identity, &rolled_back_identity);
        let OperationIssuanceV1::HostIncarnation { commit_ordinal, .. } = &retry_identity.issuance
        else {
            panic!("retry identity must use host issuance");
        };
        assert_eq!(
            *commit_ordinal, 2,
            "the child ordinal is the durable pre-transaction journal-row count"
        );
        crate::operation_ledger::authenticate_host_identity(&db.conn, retry_identity)
            .expect("retry host identity authenticates");
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_commit_envelopes_v1",
                    [],
                    |row| row.get::<_, u64>(0),
                )
                .expect("migration envelope count"),
            0,
            "the carrier remains explicitly uncovered across PublishedHeld/Released"
        );
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
        let plan = fixture_plan(
            &predecessor_schema(),
            &successor_schema(),
            default_ceilings(),
        );
        let approval = approval_for(&plan, now_millis());
        let receipt = apply_fixture(&mut db, &plan, &approval).expect("apply");

        assert_eq!(receipt.state.kind(), "released");
        assert_eq!(receipt.error_code, None);
        let publication = receipt.publication_version.expect("publication version");
        assert_eq!(
            publication,
            head_before + 1,
            "exactly one successor version"
        );
        assert_eq!(db.current_version().expect("head"), publication);
        assert!(db.migration_fence().expect("fence read").is_none());

        let migration_journal = db
            .migration_journal(&approval.operation_id)
            .expect("migration journal");
        let mut first_row_by_child = BTreeMap::<String, usize>::new();
        for (row_index, entry) in migration_journal.iter().enumerate() {
            let identity = entry
                .host_operation_identity
                .as_ref()
                .expect("new production migration row has a host carrier");
            crate::operation_ledger::authenticate_host_identity(&db.conn, identity)
                .expect("production migration carrier authenticates");
            let OperationIssuanceV1::HostIncarnation {
                upstream_identity,
                commit_ordinal,
                ..
            } = &identity.issuance
            else {
                panic!("production migration carrier must use host issuance");
            };
            assert_eq!(upstream_identity, &approval.operation_id);
            let first_row = first_row_by_child
                .entry(identity.key.operation_id.clone())
                .or_insert(row_index);
            assert_eq!(
                usize::try_from(*commit_ordinal).expect("ordinal fits usize"),
                *first_row,
                "each transaction child is derived from its durable pre-transaction row count"
            );
        }

        // Successor schema is authoritative and the rows carry the §4
        // identity rules: changed rows get the publication version and the
        // plan's explicit publication timestamp.
        assert!(
            db.schema()
                .table("items")
                .expect("items")
                .field("note")
                .is_some()
        );
        let rows = db
            .query_reads_read()
            .query(
                &QueryPlan {
                    table_visibility: None,
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
                values: BTreeMap::from([("title".to_owned(), ValueExpr::Literal(json!("three")))]),
                bind_id_as: None,
            }],
            return_value: None,
        };
        let error = db
            .mutation_writes()
            .execute_mutation(&mutation, &HandlerInput::default())
            .expect_err("fenced mutation");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_FENCE_CLOSED");

        // Query lane refuses.
        let error = db
            .query_reads_read()
            .query(
                &QueryPlan {
                    table_visibility: None,
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
            .mutation_writes()
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
                host_operation_identity: OnceCell::new(),
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

    // @ref LLP 0081#3-typed-migration-steps — ValidateRequired reports its
    //   staged NULL facts through the migration step contract; the effective
    //   successor decoder must not preempt them as storage corruption.
    #[test]
    fn validate_required_reports_staged_nulls_as_typed_step_failure() {
        let mut db = seeded_db();
        let mut body = fixture_plan(
            &predecessor_schema(),
            &successor_schema(),
            default_ceilings(),
        )
        .body;
        body.constants
            .values
            .insert("noteDefault".to_owned(), Value::Null);
        let plan = MigrationPlanArtifactV1::seal(body).expect("reseal null backfill");
        let validation_step_id = plan.body.steps[2].id.clone();
        let approval = approval_for(&plan, now_millis());

        let error = apply_fixture(&mut db, &plan, &approval)
            .expect_err("ValidateRequired must reject staged NULLs");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_STEP_FAILED");
        assert!(
            error
                .diagnostic
                .message
                .contains(&format!("validation step {validation_step_id} failed"))
        );
        assert!(error.diagnostic.message.contains("\"violations\":2"));
    }

    // @ref LLP 0081#4-execution-journaling-and-crash-recovery — terminal
    //   replay after reopen trusts the exact admitted plan bytes, but still
    //   verifies the caller-supplied successor before adopting it in memory.
    #[test]
    fn terminal_replay_after_reopen_requires_the_exact_successor() {
        let temp = tempfile::tempdir().expect("temporary database directory");
        let path = temp.path().join("migration.sqlite");
        let mut db = LocalDatabase::open(&path).expect("open file-backed database");
        db.apply_schema(predecessor_schema())
            .expect("apply predecessor schema");
        db.seed(SeedData {
            tables: BTreeMap::from([(
                "items".to_owned(),
                vec![
                    json!({ "title": "one" })
                        .as_object()
                        .cloned()
                        .expect("seed object"),
                ],
            )]),
        })
        .expect("seed predecessor");
        let plan = fixture_plan(
            &predecessor_schema(),
            &successor_schema(),
            default_ceilings(),
        );
        let approval = approval_for(&plan, now_millis());
        let receipt = apply_fixture(&mut db, &plan, &approval).expect("initial apply");
        drop(db);

        let mut reopened = LocalDatabase::open(&path).expect("reopen published database");
        let published_schema = reopened.schema().clone();
        let mut divergent = successor_schema();
        divergent.tables[0].fields.push(FieldManifest {
            name: "unapproved".to_owned(),
            field_type: FieldType::String,
            optional: true,
        });
        let (_, resolved) = audience();
        let error = reopened
            .migrate_apply(MigrationApplyRequest {
                artifact: &plan,
                approval: &approval,
                successor_schema: &divergent,
                audience: &resolved,
                now_ms: now_millis(),
                rehearsal: None,
            })
            .expect_err("terminal replay must refuse divergent successor bytes");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PLAN_STALE");
        assert_eq!(reopened.schema(), &published_schema);

        let replay = apply_fixture(&mut reopened, &plan, &approval)
            .expect("exact terminal replay after reopen");
        assert_eq!(replay, receipt);
        assert_eq!(reopened.schema(), &successor_schema());
    }

    // @ref LLP 0081#4-execution-journaling-and-crash-recovery — a real
    //   reopen at published-held loads the successor manifest under the
    //   durable fence, validates the supplied artifact seal/bindings without
    //   pretending that successor is the predecessor, and only exact replay
    //   may perform the release transition.
    #[test]
    fn published_held_reopen_releases_only_the_exact_artifact() {
        let temp = tempfile::tempdir().expect("temporary database directory");
        let path = temp.path().join("published-held.sqlite");
        let mut db = LocalDatabase::open(&path).expect("open file-backed database");
        db.apply_schema(predecessor_schema())
            .expect("apply predecessor schema");
        db.seed(SeedData {
            tables: BTreeMap::from([(
                "items".to_owned(),
                vec![
                    json!({ "title": "one" })
                        .as_object()
                        .cloned()
                        .expect("seed object"),
                ],
            )]),
        })
        .expect("seed predecessor");
        let plan = fixture_plan(
            &predecessor_schema(),
            &successor_schema(),
            default_ceilings(),
        );
        let approval = approval_for(&plan, now_millis());
        arm_migration_kill_point("released", 0);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            apply_fixture(&mut db, &plan, &approval)
        }));
        disarm_migration_kill_point();
        assert!(outcome.is_err(), "release kill point must fire");
        drop(db);

        let mut reopened = LocalDatabase::open(&path).expect("reopen published-held database");
        assert_eq!(reopened.schema(), &successor_schema());
        assert!(reopened.migration_fence().expect("fence read").is_some());
        assert!(matches!(
            latest_state_for_test(&reopened, &approval.operation_id).expect("state read"),
            Some(MigrationExecState::PublishedHeld)
        ));

        let mut divergent_body = plan.body.clone();
        divergent_body.ceilings.max_writes += 1;
        let divergent = MigrationPlanArtifactV1::seal(divergent_body).expect("reseal divergent");
        let mut divergent_approval = approval.clone();
        divergent_approval.plan_digest = divergent.plan_digest.clone();
        let (_, resolved) = audience();
        let successor = successor_schema();
        let error = reopened
            .migrate_apply(MigrationApplyRequest {
                artifact: &divergent,
                approval: &divergent_approval,
                successor_schema: &successor,
                audience: &resolved,
                now_ms: now_millis(),
                rehearsal: None,
            })
            .expect_err("divergent artifact cannot release a held publication");
        assert_eq!(error.diagnostic.code, "SNAPBACK_CLIENT_MUTATION_ID_REUSED");
        assert!(reopened.migration_fence().expect("fence read").is_some());
        assert!(matches!(
            latest_state_for_test(&reopened, &approval.operation_id).expect("state read"),
            Some(MigrationExecState::PublishedHeld)
        ));

        let receipt = apply_fixture(&mut reopened, &plan, &approval)
            .expect("exact artifact releases after reopen");
        assert_eq!(receipt.state, MigrationExecState::Released);
        assert!(reopened.migration_fence().expect("fence read").is_none());
    }

    #[test]
    fn published_held_reopen_rollback_republishes_the_journaled_predecessor_manifest() {
        let temp = tempfile::tempdir().expect("temporary database directory");
        let path = temp.path().join("published-held-rollback.sqlite");
        let mut db = LocalDatabase::open(&path).expect("open file-backed database");
        db.apply_schema(predecessor_schema())
            .expect("apply predecessor schema");
        db.seed(SeedData {
            tables: BTreeMap::from([(
                "items".to_owned(),
                vec![
                    json!({ "title": "one" })
                        .as_object()
                        .cloned()
                        .expect("seed object"),
                ],
            )]),
        })
        .expect("seed predecessor");
        let plan = staged_plan(Some(PUBLICATION_TS + 1));
        let approval = approval_for(&plan, now_millis());
        arm_migration_kill_point("released", 0);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            staged_apply(&mut db, &plan, &approval)
        }));
        disarm_migration_kill_point();
        assert!(outcome.is_err(), "release kill point must fire");
        drop(db);

        let mut reopened = LocalDatabase::open(&path).expect("reopen published-held database");
        assert_eq!(reopened.schema(), &staged_successor_schema());
        let (_, resolved) = audience();
        reopened
            .migrate_rollback(&plan, &approval, &resolved, now_millis())
            .expect("fresh handle rolls back from journaled predecessor bytes");
        assert_eq!(reopened.schema(), &predecessor_schema());
        drop(reopened);

        let reopened_again = LocalDatabase::open(&path).expect("reopen rolled-back database");
        assert_eq!(
            reopened_again.schema(),
            &predecessor_schema(),
            "the live published manifest is the predecessor, never the successor"
        );
    }

    #[test]
    fn published_held_reopen_without_predecessor_manifest_bytes_fails_closed() {
        let temp = tempfile::tempdir().expect("temporary database directory");
        let path = temp.path().join("legacy-published-held-rollback.sqlite");
        let mut db = LocalDatabase::open(&path).expect("open file-backed database");
        db.apply_schema(predecessor_schema())
            .expect("apply predecessor schema");
        db.seed(SeedData {
            tables: BTreeMap::from([(
                "items".to_owned(),
                vec![
                    json!({ "title": "one" })
                        .as_object()
                        .cloned()
                        .expect("seed object"),
                ],
            )]),
        })
        .expect("seed predecessor");
        let plan = staged_plan(Some(PUBLICATION_TS + 1));
        let approval = approval_for(&plan, now_millis());
        arm_migration_kill_point("released", 0);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            staged_apply(&mut db, &plan, &approval)
        }));
        disarm_migration_kill_point();
        assert!(outcome.is_err(), "release kill point must fire");
        db.conn
            .execute(
                "UPDATE _snapback_migration_ops SET predecessor_schema_json = NULL \
                 WHERE operation_id = ?1",
                params![approval.operation_id],
            )
            .expect("simulate a legacy operation row");
        drop(db);

        let mut reopened = LocalDatabase::open(&path).expect("reopen published-held database");
        assert_eq!(reopened.schema(), &staged_successor_schema());
        let (_, resolved) = audience();
        let error = reopened
            .migrate_rollback(&plan, &approval, &resolved, now_millis())
            .expect_err("legacy reopen cannot guess predecessor bytes from the successor handle");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MIGRATION_PREDECESSOR_SCHEMA_UNAVAILABLE"
        );
        assert_eq!(reopened.schema(), &staged_successor_schema());
        assert!(matches!(
            latest_state_for_test(&reopened, &approval.operation_id).expect("state read"),
            Some(MigrationExecState::PublishedHeld)
        ));
    }

    // @ref LLP 0081#4-execution-journaling-and-crash-recovery — a resume
    //   derives physical staging authority from the exact AddField journal
    //   transaction, never from the operation/fence row alone.
    #[test]
    fn resumed_add_field_requires_its_exact_committed_step() {
        let mut db = seeded_db();
        let plan = fixture_plan(
            &predecessor_schema(),
            &successor_schema(),
            default_ceilings(),
        );
        let approval = approval_for(&plan, now_millis());
        install_barriered_operation_for_test(&mut db, &plan, &approval);
        db.conn
            .execute("ALTER TABLE items ADD COLUMN note TEXT", [])
            .expect("simulate ambient column creation after the barrier");

        let error = apply_fixture(&mut db, &plan, &approval)
            .expect_err("a barriered row alone cannot adopt an ambient column");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MIGRATION_PRECONDITION_FAILED"
        );
        assert!(error.diagnostic.message.contains("already exists"));
        assert!(db.migration_fence().expect("fence read").is_some());
        assert!(matches!(
            latest_state_for_test(&db, &approval.operation_id).expect("state read"),
            Some(MigrationExecState::Barriered)
        ));
    }

    // A transition outside the enumerated relation is refused as corruption.
    #[test]
    fn transition_outside_the_relation_is_corruption() {
        let mut db = seeded_db();
        ensure_migration_host_authority(&mut db.conn, 1).expect("migration host authority");
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
            host_operation_identity: OnceCell::new(),
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
        // Logical retirement can leave a manifest-hidden physical column.
        // Fresh AddField admission refuses those retained bytes instead of
        // silently re-adopting them as a new destination; only the same
        // operation's crash-resume may observe its already-added column.
        let mut db = seeded_db();
        db.conn
            .execute("ALTER TABLE items ADD COLUMN note TEXT", [])
            .expect("simulate a retained retired column");
        let plan = fixture_plan(
            &predecessor_schema(),
            &successor_schema(),
            default_ceilings(),
        );
        let approval = approval_for(&plan, now_millis());
        let error = apply_fixture(&mut db, &plan, &approval)
            .expect_err("fresh admission must refuse a retained physical destination");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MIGRATION_PRECONDITION_FAILED"
        );
        assert!(error.diagnostic.message.contains("already exists"));

        // Resource-ceiling drift refuses at admission.
        let mut db = seeded_db();
        let mut tight = default_ceilings();
        tight.max_affected_rows = 1;
        let plan = fixture_plan(&predecessor_schema(), &successor_schema(), tight);
        let approval = approval_for(&plan, now_millis());
        let error = apply_fixture(&mut db, &plan, &approval).expect_err("ceiling");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MIGRATION_PRECONDITION_FAILED"
        );
        // The refused admission left no fence behind.
        assert!(db.migration_fence().expect("fence").is_none());

        // publicationTimestamp behind an existing _updatedAt refuses.
        let mut db = seeded_db();
        db.conn
            .execute(
                "UPDATE items SET _updatedAt = ?1",
                params![timestamp_to_sql_millis(PUBLICATION_TS + 5).unwrap()],
            )
            .expect("bump updatedAt");
        let plan = fixture_plan(
            &predecessor_schema(),
            &successor_schema(),
            default_ceilings(),
        );
        let approval = approval_for(&plan, now_millis());
        let error = apply_fixture(&mut db, &plan, &approval).expect_err("timestamp floor");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MIGRATION_PRECONDITION_FAILED"
        );

        // Audience mismatch.
        let mut db = seeded_db();
        let plan = fixture_plan(
            &predecessor_schema(),
            &successor_schema(),
            default_ceilings(),
        );
        let mut approval = approval_for(&plan, now_millis());
        approval.audience.database_id = "db-other".to_owned();
        let error = apply_fixture(&mut db, &plan, &approval).expect_err("audience");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_TARGET_MISMATCH");

        // Approval binding a different plan digest.
        let mut db = seeded_db();
        let plan = fixture_plan(
            &predecessor_schema(),
            &successor_schema(),
            default_ceilings(),
        );
        let mut approval = approval_for(&plan, now_millis());
        approval.plan_digest = "0".repeat(64);
        let error = apply_fixture(&mut db, &plan, &approval).expect_err("binding");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MIGRATION_APPROVAL_REQUIRED"
        );

        // Expired approval refuses fresh admission.
        let mut db = seeded_db();
        let plan = fixture_plan(
            &predecessor_schema(),
            &successor_schema(),
            default_ceilings(),
        );
        let mut approval = approval_for(&plan, 1_000);
        approval.expires_at_ms = 2_000;
        let error = apply_fixture(&mut db, &plan, &approval).expect_err("expired");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MIGRATION_APPROVAL_REQUIRED"
        );

        // Predecessor schema drift is stale.
        let mut db = LocalDatabase::memory().expect("memory db");
        let mut drifted = predecessor_schema();
        drifted.tables[0].fields.push(FieldManifest {
            name: "extra".to_owned(),
            field_type: FieldType::String,
            optional: true,
        });
        db.apply_schema(drifted).expect("apply drifted");
        let plan = fixture_plan(
            &predecessor_schema(),
            &successor_schema(),
            default_ceilings(),
        );
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
                rehearsal: None,
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
        assert!(
            db.schema()
                .table("items")
                .expect("items")
                .field("note")
                .is_none()
        );
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
        let plan = fixture_plan(
            &predecessor_schema(),
            &successor_schema(),
            default_ceilings(),
        );
        let approval = approval_for(&plan, now_millis());
        ensure_migration_host_authority(&mut db.conn, 1).expect("migration host authority");
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
                 state_json, lease_epoch, cancel_requested) VALUES(?1, ?2, ?3, ?4, 1, 0)",
                params![
                    approval.operation_id,
                    serde_json::to_string(&approval.audience).expect("audience JSON"),
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
                host_operation_identity: OnceCell::new(),
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
        let other_plan = fixture_plan(
            &predecessor_schema(),
            &successor_schema(),
            default_ceilings(),
        );
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
        let plan = fixture_plan(
            &predecessor_schema(),
            &successor_schema(),
            default_ceilings(),
        );
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
                 state_json, lease_epoch, cancel_requested) VALUES(?1, ?2, ?3, ?4, 9, 0)",
                params![
                    approval2.operation_id,
                    serde_json::to_string(&approval2.audience).expect("audience JSON"),
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
                host_operation_identity: OnceCell::new(),
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
                rehearsal: None,
            })
            .expect("release");
        assert_eq!(released.state.kind(), "released");
        assert!(db.migration_fence().expect("fence").is_none());
    }

    fn staged_successor_schema() -> SchemaManifest {
        // Successor items: title + a new required note, staged as g2.
        let mut schema = predecessor_schema();
        if let Some(items) = schema.tables.iter_mut().find(|t| t.name == "items") {
            items.fields.push(crate::manifest::FieldManifest {
                name: "note".to_owned(),
                field_type: FieldType::String,
                optional: false,
            });
        }
        schema
    }

    fn staged_plan(rollback_ts: Option<u64>) -> MigrationPlanArtifactV1 {
        use crate::migration::MigrationVerification;
        let predecessor = predecessor_schema();
        let successor = staged_successor_schema();
        let intents = vec![MigrationIntent::CopyTableToGeneration {
            table: "items".to_owned(),
            generation: 2,
            source_table: "items".to_owned(),
            fields: BTreeMap::from([
                (
                    "title".to_owned(),
                    ValueExpr::Field {
                        base: Box::new(ValueExpr::Binding("row".to_owned())),
                        key: "title".to_owned(),
                    },
                ),
                ("note".to_owned(), ValueExpr::Arg("noteDefault".to_owned())),
            ]),
        }];
        let mut steps = derive_plan_steps(&successor, &intents).expect("derive steps");
        for record in &mut steps {
            if matches!(record.step, MigrationStep::CopyTable { .. }) {
                record.verification = vec![
                    MigrationVerification::RowCountMatchesSource {
                        source_table: "items".to_owned(),
                        table: "items".to_owned(),
                    },
                    MigrationVerification::ContentDigest {
                        table: "items".to_owned(),
                    },
                ];
            }
        }
        let body = MigrationPlanBody {
            schema_version: MIGRATION_PLAN_SCHEMA_VERSION.to_owned(),
            app: "test-app".to_owned(),
            instance: "memory".to_owned(),
            target_profile_id: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            predecessor_schema_hash: schema_identity(&predecessor).expect("predecessor id"),
            successor_schema_hash: schema_identity(&successor).expect("successor id"),
            predecessor_generation: 1,
            steps,
            execution_strategy: crate::migration::MigrationExecutionStrategy::ShadowGeneration,
            proof: MigrationProof {
                method: MigrationProofMethod::Full,
                bound: None,
            },
            ceilings: default_ceilings(),
            compatibility_posture: CompatibilityPosture::SuccessorOnly,
            retained_work_posture: RetainedWorkPosture::Empty,
            backup: MigrationBackupRequirement {
                required: false,
                checkpoint_label: None,
                rehearsal_required: false,
            },
            expected_output: MigrationExpectedOutput {
                schema_hash: schema_identity(&successor).expect("successor id"),
                projection_generations: BTreeMap::new(),
            },
            constants: MigrationConstants {
                publication_timestamp_ms: PUBLICATION_TS,
                rollback_timestamp_ms: rollback_ts,
                values: BTreeMap::from([("noteDefault".to_owned(), json!("n/a"))]),
            },
            boundaries: Default::default(),
        };
        MigrationPlanArtifactV1::seal(body).expect("seal staged plan")
    }

    fn staged_apply(
        db: &mut LocalDatabase,
        plan: &MigrationPlanArtifactV1,
        approval: &MigrationApprovalV1,
    ) -> SnapbackResult<MigrationReceiptV1> {
        let (_, resolved) = audience();
        let successor = staged_successor_schema();
        db.migrate_apply(MigrationApplyRequest {
            artifact: plan,
            approval,
            successor_schema: &successor,
            audience: &resolved,
            now_ms: now_millis(),
            rehearsal: None,
        })
    }

    fn aggregate_identity_for(db: &LocalDatabase, operation_id: &str) -> OperationIdentityV1 {
        let body: String = db
            .conn
            .query_row(
                "SELECT aggregate_identity_json FROM _snapback_migration_ops
                 WHERE operation_id=?1",
                [operation_id],
                |row| row.get(0),
            )
            .expect("aggregate identity");
        serde_json::from_str(&body).expect("aggregate identity JSON")
    }

    fn scalar_count(db: &LocalDatabase, sql: &str) -> u64 {
        db.conn
            .query_row(sql, [], |row| row.get(0))
            .expect("count query")
    }

    fn crash_after_publication_p(
        db: &mut LocalDatabase,
        plan: &MigrationPlanArtifactV1,
        approval: &MigrationApprovalV1,
    ) {
        arm_migration_kill_point("released", 0);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            staged_apply(db, plan, approval)
        }));
        disarm_migration_kill_point();
        assert!(outcome.is_err(), "release transaction kill point must fire");
        assert_eq!(
            latest_state_for_test(db, &approval.operation_id)
                .expect("state")
                .expect("journaled")
                .kind(),
            "published-held"
        );
    }

    // LLP 0163 amendment corpus: P publishes one successor/version/resync row
    // and one truthful Pending envelope atomically. Lookup and ACK are
    // read-only while held, divergent reuse refuses, lane capacity refuses
    // rather than evicting, and T-release appends one linked terminal record.
    #[test]
    fn llp0163_migration_aggregate_pending_release_corpus() {
        let mut db = seeded_db();
        let head_before = db.current_version().expect("head");
        let plan = staged_plan(None);
        let approval = approval_for(&plan, now_millis());
        crash_after_publication_p(&mut db, &plan, &approval);

        let identity = aggregate_identity_for(&db, &approval.operation_id);
        let pending = match db
            .migration_aggregate_lookup(&approval.operation_id)
            .expect("pending lookup")
            .expect("aggregate identity")
        {
            crate::operation_ledger::PendingOperationLookupV1::Pending(pending) => pending,
            other => panic!("expected pending aggregate, got {other:?}"),
        };
        assert_eq!(pending.identity, identity);
        assert_eq!(pending.publication.version, head_before + 1);
        assert_eq!(pending.pending_payload["detail"]["state"], "published-held");
        assert_eq!(pending.pending_payload["detail"]["outcome"], "pending");

        let envelope_body: String = db
            .conn
            .query_row(
                "SELECT envelope_json FROM _snapback_commit_envelopes_v1
                 WHERE operation_id=?1",
                [&identity.key.operation_id],
                |row| row.get(0),
            )
            .expect("aggregate envelope");
        let envelope: CommitEnvelopeV1 =
            serde_json::from_str(&envelope_body).expect("aggregate envelope JSON");
        assert_eq!(envelope.receipt.state, OperationReceiptStateV1::Pending);
        assert_eq!(envelope.snapshot, pending.publication);
        assert_eq!(envelope.write_set.count, 1);
        assert!(envelope.coverage.covered_lanes.is_empty());
        assert_eq!(
            envelope.coverage.uncovered_lanes,
            vec![MIGRATION_AGGREGATE_LANE_V1.to_owned()]
        );
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_changes
                     WHERE version=?1 AND table_name=?2 AND row_id=?3 AND op=?4",
                    params![
                        version_to_sql_integer(pending.publication.version).expect("version"),
                        crate::storage::SCHEMA_TRANSITION_JOURNAL_TABLE,
                        approval.operation_id,
                        crate::storage::SchemaTransitionKind::SchemaResync.as_op(),
                    ],
                    |row| row.get::<_, u64>(0),
                )
                .expect("P journal count"),
            1
        );
        assert_eq!(
            scalar_count(&db, "SELECT COUNT(*) FROM _snapback_operation_pending_v1"),
            1
        );
        assert_eq!(
            scalar_count(
                &db,
                "SELECT COUNT(*) FROM _snapback_operation_terminal_supplements_v1"
            ),
            0
        );

        // Repeated lookup cannot republish, release, or add another carrier.
        let counts_before = (
            scalar_count(&db, "SELECT COUNT(*) FROM _snapback_changes"),
            scalar_count(&db, "SELECT COUNT(*) FROM _snapback_commit_envelopes_v1"),
            scalar_count(&db, "SELECT COUNT(*) FROM _snapback_operation_pending_v1"),
        );
        for _ in 0..2 {
            assert!(matches!(
                db.migration_aggregate_lookup(&approval.operation_id)
                    .expect("stable pending lookup"),
                Some(crate::operation_ledger::PendingOperationLookupV1::Pending(
                    _
                ))
            ));
        }
        assert_eq!(
            counts_before,
            (
                scalar_count(&db, "SELECT COUNT(*) FROM _snapback_changes"),
                scalar_count(&db, "SELECT COUNT(*) FROM _snapback_commit_envelopes_v1"),
                scalar_count(&db, "SELECT COUNT(*) FROM _snapback_operation_pending_v1"),
            )
        );

        // Pending has no ordinary suppression to ACK/reclaim, and its host
        // lease is effectively unbounded until the terminal supplement.
        {
            let tx = db.conn.transaction().expect("ACK transaction");
            crate::operation_ledger::acknowledge_and_reclaim_in(&tx, &identity, now_millis())
                .expect("pending ACK is inert");
            tx.commit().expect("ACK commit");
        }
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT expires_at_ms FROM _snapback_host_identity_leases_v1
                     WHERE operation_id=?1 AND completed_at_ms IS NULL",
                    [&identity.key.operation_id],
                    |row| row.get::<_, u64>(0),
                )
                .expect("pending lease"),
            crate::operation_ledger::PENDING_HOST_IDENTITY_LEASE_EXPIRY_MS_V1
        );

        let pending_epoch_id = match &identity.issuance {
            OperationIssuanceV1::HostIncarnation { epoch_id, .. } => epoch_id.clone(),
            other => panic!("migration pending identity must be Host-issued, got {other:?}"),
        };
        for (column, moved, restored) in [
            ("lane", "moved-lane", MIGRATION_AGGREGATE_LANE_V1),
            (
                "audience",
                "moved-audience",
                identity.bound_facts.audience.as_str(),
            ),
            ("epoch_id", "moved-epoch", pending_epoch_id.as_str()),
        ] {
            db.conn
                .execute(
                    &format!(
                        "UPDATE _snapback_operation_pending_v1 SET {column}=?1
                          WHERE stream_id=?2 AND originator_class='host' AND operation_id=?3"
                    ),
                    params![moved, identity.key.stream_id, identity.key.operation_id],
                )
                .unwrap_or_else(|error| panic!("move pending {column}: {error}"));
            assert_eq!(
                crate::operation_ledger::require_pending_operation_capacity_in(
                    &db.conn,
                    MIGRATION_AGGREGATE_LANE_V1,
                    &identity.bound_facts.audience,
                    None,
                    1,
                )
                .expect_err("moved pending projection cannot evade the lane budget")
                .diagnostic
                .code,
                "SNAPBACK_OPERATION_LEDGER_INVALID"
            );
            db.conn
                .execute(
                    &format!(
                        "UPDATE _snapback_operation_pending_v1 SET {column}=?1
                          WHERE stream_id=?2 AND originator_class='host' AND operation_id=?3"
                    ),
                    params![restored, identity.key.stream_id, identity.key.operation_id],
                )
                .unwrap_or_else(|error| panic!("restore pending {column}: {error}"));
        }

        let second = approval_for(&plan, now_millis());
        let capacity = staged_apply(&mut db, &plan, &second).expect_err("pending lane full");
        assert_eq!(
            capacity.diagnostic.code,
            "SNAPBACK_OPERATION_PENDING_CAPACITY_FULL"
        );
        let mut divergent_identity = identity.clone();
        divergent_identity
            .bound_facts
            .function_or_command
            .push_str("-divergent");
        let divergent =
            crate::operation_ledger::lookup_pending_operation(&db.conn, &divergent_identity)
                .expect_err("divergent pending identity");
        assert_eq!(
            divergent.diagnostic.code,
            "SNAPBACK_CLIENT_MUTATION_ID_REUSED"
        );

        let released = staged_apply(&mut db, &plan, &approval).expect("release retry");
        let terminal = match db
            .migration_aggregate_lookup(&approval.operation_id)
            .expect("terminal lookup")
            .expect("aggregate identity")
        {
            crate::operation_ledger::PendingOperationLookupV1::Terminal(terminal) => terminal,
            other => panic!("expected terminal aggregate, got {other:?}"),
        };
        assert_eq!(
            terminal.terminal_outcome,
            PendingOperationTerminalOutcomeV1::Committed
        );
        assert_eq!(terminal.terminal_write_set_count, 0);
        assert!(terminal.terminal_at_ms >= pending.pending_at_ms);
        assert_eq!(
            scalar_count(
                &db,
                "SELECT COUNT(*) FROM _snapback_operation_terminal_supplements_v1"
            ),
            1
        );
        assert_eq!(
            scalar_count(
                &db,
                "SELECT COUNT(*) FROM _snapback_operation_suppression_v1"
            ),
            0,
            "the additive terminal carrier does not widen v1 suppression"
        );
        assert_eq!(
            staged_apply(&mut db, &plan, &approval).expect("exact terminal replay"),
            released
        );
        assert_eq!(
            scalar_count(
                &db,
                "SELECT COUNT(*) FROM _snapback_operation_terminal_supplements_v1"
            ),
            1
        );
        let mut divergent_approval = approval.clone();
        divergent_approval.approver = "other-operator".to_owned();
        let divergent = staged_apply(&mut db, &plan, &divergent_approval)
            .expect_err("divergent terminal replay");
        assert_eq!(
            divergent.diagnostic.code,
            "SNAPBACK_CLIENT_MUTATION_ID_REUSED"
        );

        // The additive supplement pins the retired host epoch for the full
        // terminal window, then compacts with its Pending lifecycle and the
        // envelope payload. It is neither forever-retained nor reclaimable
        // while outcome is pending.
        let OperationIssuanceV1::HostIncarnation { epoch_id, .. } = &identity.issuance else {
            panic!("aggregate uses host issuance");
        };
        let epoch_sequence: u64 = db
            .conn
            .query_row(
                "SELECT epoch_sequence FROM _snapback_operation_epochs_v1
                 WHERE originator_class='host' AND audience=?1 AND epoch_id=?2",
                params![identity.bound_facts.audience, epoch_id],
                |row| row.get(0),
            )
            .expect("aggregate epoch sequence");
        let rotate_at = terminal.terminal_at_ms + 1;
        let successor = crate::commit_envelope::IdentityEpochV1 {
            schema_version: 1,
            originator_class: OperationOriginatorClassV1::Host,
            audience: identity.bound_facts.audience.clone(),
            authority_instance_id: "snapback:migration-executor:v1:rotated".to_owned(),
            epoch_id: "migration-aggregate-successor-epoch".to_owned(),
            epoch_sequence: epoch_sequence + 1,
            state: crate::commit_envelope::IdentityEpochStateV1::Open,
            issued_at_ms: rotate_at,
            terminated_at_ms: None,
            authority_authenticator_digest: format!("sha256:{}", "b".repeat(64)),
        };
        {
            let tx = db.conn.transaction().expect("host rotation transaction");
            crate::operation_ledger::rotate_host_incarnation_in(
                &tx,
                &identity.bound_facts.audience,
                epoch_id,
                &successor,
                rotate_at,
            )
            .expect("rotate aggregate host epoch");
            assert!(
                !crate::operation_ledger::close_epoch_if_complete_in(
                    &tx,
                    OperationOriginatorClassV1::Host,
                    &identity.bound_facts.audience,
                    epoch_id,
                    terminal.terminal_at_ms + crate::operation_ledger::HOST_RECEIPT_WINDOW_MS_V1
                        - 1,
                )
                .expect("young supplement pins epoch")
            );
            assert!(
                crate::operation_ledger::close_epoch_if_complete_in(
                    &tx,
                    OperationOriginatorClassV1::Host,
                    &identity.bound_facts.audience,
                    epoch_id,
                    terminal.terminal_at_ms
                        + crate::operation_ledger::HOST_RECEIPT_WINDOW_MS_V1
                        + 1,
                )
                .expect("elapsed supplement compacts")
            );
            tx.commit().expect("host closure commit");
        }
        assert_eq!(
            scalar_count(
                &db,
                "SELECT COUNT(*) FROM _snapback_operation_terminal_supplements_v1"
            ),
            0
        );
        assert_eq!(
            scalar_count(&db, "SELECT COUNT(*) FROM _snapback_operation_pending_v1"),
            0
        );
        let compacted: String = db
            .conn
            .query_row(
                "SELECT envelope_json FROM _snapback_commit_envelopes_v1
                 WHERE operation_id=?1",
                [&identity.key.operation_id],
                |row| row.get(0),
            )
            .expect("compacted aggregate envelope");
        let compacted: CommitEnvelopeV1 =
            serde_json::from_str(&compacted).expect("compacted envelope JSON");
        assert_eq!(compacted.receipt.payload, RetainedEnvelopeDetailV1::Expired);
        assert!(matches!(
            db.migration_aggregate_lookup(&approval.operation_id)
                .expect("closed aggregate lookup"),
            Some(crate::operation_ledger::PendingOperationLookupV1::IdentityHorizonPassed)
        ));
    }

    #[test]
    fn llp0163_migration_aggregate_rejects_swapped_pending_envelope() {
        let mut db = seeded_db();
        let plan = staged_plan(None);
        let approval = approval_for(&plan, now_millis());
        crash_after_publication_p(&mut db, &plan, &approval);
        let identity = aggregate_identity_for(&db, &approval.operation_id);
        let body: String = db
            .conn
            .query_row(
                "SELECT envelope_json FROM _snapback_commit_envelopes_v1
                 WHERE operation_id=?1",
                [&identity.key.operation_id],
                |row| row.get(0),
            )
            .expect("envelope");
        let mut envelope: CommitEnvelopeV1 = serde_json::from_str(&body).expect("envelope JSON");
        envelope.receipt.payload = RetainedEnvelopeDetailV1::InlineRedacted {
            detail: json!({
                "outcome": "pending",
                "publicationVersion": envelope.snapshot.version + 1,
                "state": "published-held",
            }),
        };
        db.conn
            .execute(
                "UPDATE _snapback_commit_envelopes_v1 SET envelope_json=?1
                 WHERE operation_id=?2",
                params![
                    serde_json::to_string(&envelope).expect("mutated envelope JSON"),
                    identity.key.operation_id,
                ],
            )
            .expect("corrupt envelope fixture");
        let error = db
            .migration_aggregate_lookup(&approval.operation_id)
            .expect_err("swapped envelope must refuse");
        assert_eq!(error.diagnostic.code, "SNAPBACK_OPERATION_LEDGER_INVALID");

        let mut terminal_db = seeded_db();
        let terminal_plan = staged_plan(None);
        let terminal_approval = approval_for(&terminal_plan, now_millis());
        staged_apply(&mut terminal_db, &terminal_plan, &terminal_approval)
            .expect("terminal fixture");
        terminal_db
            .conn
            .execute(
                "UPDATE _snapback_migration_ops SET receipt_json='{}'
                 WHERE operation_id=?1",
                [&terminal_approval.operation_id],
            )
            .expect("corrupt terminal receipt fixture");
        let error = terminal_db
            .migration_aggregate_lookup(&terminal_approval.operation_id)
            .expect_err("swapped terminal receipt must refuse");
        assert_eq!(error.diagnostic.code, "SNAPBACK_OPERATION_LEDGER_INVALID");
    }

    #[test]
    fn llp0163_migration_aggregate_publication_and_terminal_response_crashes_are_atomic() {
        // Kill inside P: publication, resync journal, Pending envelope, and
        // lifecycle all roll back together.
        let mut before_p = seeded_db();
        let head = before_p.current_version().expect("head");
        let plan = staged_plan(None);
        let approval = approval_for(&plan, now_millis());
        arm_migration_kill_point("published-held", 0);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            staged_apply(&mut before_p, &plan, &approval)
        }));
        disarm_migration_kill_point();
        assert!(outcome.is_err());
        assert_eq!(
            before_p.current_version().expect("head after P crash"),
            head
        );
        assert_eq!(
            scalar_count(
                &before_p,
                "SELECT COUNT(*) FROM _snapback_operation_pending_v1"
            ),
            0
        );
        assert_eq!(
            scalar_count(
                &before_p,
                "SELECT COUNT(*) FROM _snapback_commit_envelopes_v1"
            ),
            0
        );

        // Lose the response after T-release commits. Lookup is terminal and
        // exact retry returns the singleton receipt without another P or T.
        let mut after_t = seeded_db();
        let plan = staged_plan(None);
        let approval = approval_for(&plan, now_millis());
        arm_migration_kill_point("terminal-response", 0);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            staged_apply(&mut after_t, &plan, &approval)
        }));
        disarm_migration_kill_point();
        assert!(outcome.is_err());
        assert!(matches!(
            after_t
                .migration_aggregate_lookup(&approval.operation_id)
                .expect("terminal lookup after response loss"),
            Some(crate::operation_ledger::PendingOperationLookupV1::Terminal(
                _
            ))
        ));
        let receipt = staged_apply(&mut after_t, &plan, &approval)
            .expect("exact retry after terminal response loss");
        assert_eq!(receipt.state.kind(), "released");
        assert!(
            after_t
                .schema()
                .table("items")
                .expect("items")
                .field("note")
                .is_some(),
            "terminal replay repairs the serving handle's successor posture"
        );
        assert_eq!(
            scalar_count(
                &after_t,
                "SELECT COUNT(*) FROM _snapback_operation_terminal_supplements_v1"
            ),
            1
        );
    }

    #[test]
    fn llp0163_migration_aggregate_rollback_terminal_is_singleton() {
        let mut db = seeded_db();
        let plan = staged_plan(Some(PUBLICATION_TS + 1));
        let approval = approval_for(&plan, now_millis());
        let (_, resolved) = audience();
        crash_after_publication_p(&mut db, &plan, &approval);

        arm_migration_kill_point("rolling-back", 0);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            db.migrate_rollback(&plan, &approval, &resolved, now_millis())
        }));
        disarm_migration_kill_point();
        assert!(outcome.is_err());
        assert!(matches!(
            db.migration_aggregate_lookup(&approval.operation_id)
                .expect("pending after rollback interior crash"),
            Some(crate::operation_ledger::PendingOperationLookupV1::Pending(
                _
            ))
        ));

        arm_migration_kill_point("rollback-response", 0);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            db.migrate_rollback(&plan, &approval, &resolved, now_millis())
        }));
        disarm_migration_kill_point();
        assert!(outcome.is_err(), "rollback response-loss seam must fire");
        let terminal = match db
            .migration_aggregate_lookup(&approval.operation_id)
            .expect("rollback terminal lookup")
            .expect("aggregate")
        {
            crate::operation_ledger::PendingOperationLookupV1::Terminal(terminal) => terminal,
            other => panic!("expected rollback terminal, got {other:?}"),
        };
        assert_eq!(
            terminal.terminal_outcome,
            PendingOperationTerminalOutcomeV1::RolledBack
        );
        assert_eq!(terminal.terminal_write_set_count, 1);
        let rollback = db
            .migrate_rollback(&plan, &approval, &resolved, now_millis())
            .expect("rollback exact replay");
        assert_eq!(
            db.migrate_rollback(&plan, &approval, &resolved, now_millis())
                .expect("second rollback exact replay"),
            rollback
        );
        assert_eq!(
            scalar_count(
                &db,
                "SELECT COUNT(*) FROM _snapback_operation_terminal_supplements_v1"
            ),
            1
        );
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_changes
                     WHERE table_name=?1 AND row_id=?2 AND op=?3",
                    params![
                        crate::storage::SCHEMA_TRANSITION_JOURNAL_TABLE,
                        approval.operation_id,
                        crate::storage::SchemaTransitionKind::RollbackResync.as_op(),
                    ],
                    |row| row.get::<_, u64>(0),
                )
                .expect("R journal count"),
            1
        );
        db.resume_pending_migration_cleanup()
            .expect("resume rollback cleanup");
        assert!(matches!(
            db.migration_aggregate_lookup(&approval.operation_id)
                .expect("terminal survives cleanup resume"),
            Some(crate::operation_ledger::PendingOperationLookupV1::Terminal(
                _
            ))
        ));
    }

    #[test]
    fn migration_expected_oracle_covers_the_closed_expression_profile() {
        let constants = json!({
            "fallback": "n/a",
            "nested": { "number": 3 },
        });
        let bindings = BTreeMap::from([(
            "row".to_owned(),
            json!({ "title": "  HeLLo  ", "n": 5, "missing": null }),
        )]);
        let literal = |value| ValueExpr::Literal(value);
        let field = |key: &str| ValueExpr::Field {
            base: Box::new(ValueExpr::Binding("row".to_owned())),
            key: key.to_owned(),
        };
        let binary = |op, left, right| ValueExpr::Binary {
            op,
            left: Box::new(left),
            right: Box::new(right),
        };
        let cases = vec![
            (ValueExpr::Arg("nested.number".to_owned()), json!(3)),
            (field("absent"), Value::Null),
            (
                binary(BinaryOp::Add, field("n"), literal(json!(2))),
                json!(7),
            ),
            (
                binary(BinaryOp::Add, literal(json!("a")), literal(json!("b"))),
                json!("ab"),
            ),
            (
                binary(BinaryOp::Sub, field("n"), literal(json!(2))),
                json!(3),
            ),
            (
                binary(BinaryOp::Mul, field("n"), literal(json!(2))),
                json!(10),
            ),
            (
                binary(BinaryOp::Div, field("n"), literal(json!(2))),
                json!(2.5),
            ),
            (
                binary(BinaryOp::Mod, field("n"), literal(json!(2))),
                json!(1),
            ),
            (
                binary(BinaryOp::Eq, field("n"), literal(json!(5.0))),
                json!(true),
            ),
            (
                binary(BinaryOp::Ne, field("n"), literal(json!(4))),
                json!(true),
            ),
            (
                binary(BinaryOp::Lt, field("n"), literal(json!(6))),
                json!(true),
            ),
            (
                binary(BinaryOp::Lte, field("n"), literal(json!(5))),
                json!(true),
            ),
            (
                binary(BinaryOp::Gt, field("n"), literal(json!(4))),
                json!(true),
            ),
            (
                binary(BinaryOp::Gte, field("n"), literal(json!(5))),
                json!(true),
            ),
            (
                binary(BinaryOp::And, literal(json!(0)), literal(json!("no"))),
                json!(0),
            ),
            (
                binary(
                    BinaryOp::Or,
                    ValueExpr::Arg("fallback".to_owned()),
                    literal(json!("x")),
                ),
                json!("n/a"),
            ),
            (
                ValueExpr::Unary {
                    op: UnaryOp::Not,
                    expr: Box::new(ValueExpr::Literal(Value::Null)),
                },
                json!(true),
            ),
            (
                ValueExpr::Unary {
                    op: UnaryOp::Neg,
                    expr: Box::new(field("n")),
                },
                json!(-5),
            ),
            (
                ValueExpr::If {
                    cond: Box::new(literal(json!(true))),
                    then: Box::new(ValueExpr::Arg("fallback".to_owned())),
                    r#else: Box::new(literal(json!("wrong"))),
                },
                json!("n/a"),
            ),
            (
                ValueExpr::Concat(vec![literal(json!("v=")), field("n")]),
                json!("v=5"),
            ),
            (
                ValueExpr::Call {
                    func: "trim".to_owned(),
                    args: vec![field("title")],
                },
                json!("HeLLo"),
            ),
            (
                ValueExpr::Call {
                    func: "lower".to_owned(),
                    args: vec![field("title")],
                },
                json!("  hello  "),
            ),
            (
                ValueExpr::Call {
                    func: "len".to_owned(),
                    args: vec![literal(json!("a💾"))],
                },
                json!(3),
            ),
            (
                ValueExpr::Call {
                    func: "coalesce".to_owned(),
                    args: vec![field("missing"), ValueExpr::Arg("fallback".to_owned())],
                },
                json!("n/a"),
            ),
            (
                ValueExpr::Call {
                    func: "abs".to_owned(),
                    args: vec![literal(json!(-2))],
                },
                json!(2),
            ),
            (
                ValueExpr::Call {
                    func: "round".to_owned(),
                    args: vec![literal(json!(-1.5))],
                },
                json!(-1),
            ),
            (
                ValueExpr::Call {
                    func: "floor".to_owned(),
                    args: vec![literal(json!(2.9))],
                },
                json!(2),
            ),
            (
                ValueExpr::Call {
                    func: "ceil".to_owned(),
                    args: vec![literal(json!(2.1))],
                },
                json!(3),
            ),
            (
                ValueExpr::Call {
                    func: "min".to_owned(),
                    args: vec![field("n"), literal(json!(8)), literal(json!(2))],
                },
                json!(2),
            ),
            (
                ValueExpr::Call {
                    func: "max".to_owned(),
                    args: vec![field("n"), literal(json!(8)), literal(json!(2))],
                },
                json!(8),
            ),
            (
                ValueExpr::Record {
                    fields: BTreeMap::from([
                        ("copied".to_owned(), field("n")),
                        ("constant".to_owned(), ValueExpr::Arg("fallback".to_owned())),
                    ]),
                },
                json!({ "constant": "n/a", "copied": 5 }),
            ),
        ];
        let execution_input = HandlerInput {
            args: constants.clone(),
            ..HandlerInput::default()
        };
        for (index, (expr, expected)) in cases.into_iter().enumerate() {
            let oracle = migration_expected_oracle(&expr, &constants, &bindings)
                .unwrap_or_else(|error| panic!("oracle case {index}: {error:?}"));
            assert_eq!(oracle, expected, "explicit oracle case {index}");
            assert_eq!(
                eval_expr(
                    &expr,
                    &execution_input,
                    &bindings,
                    PUBLICATION_TS,
                    None,
                    "migration/oracle-equivalence-corpus",
                )
                .unwrap_or_else(|error| panic!("execution case {index}: {error:?}")),
                oracle,
                "independently implemented evaluators diverged at case {index}"
            );
        }
        assert_eq!(
            migration_expected_oracle(&ValueExpr::RuntimeNow, &constants, &bindings)
                .expect_err("ambient input is outside the oracle")
                .diagnostic
                .code,
            "SNAPBACK_MIGRATION_EXPECTED_ORACLE_FAILED"
        );
    }

    // @ref LLP 0081#3-typed-migration-steps — the staged-generation path.
    // @ref LLP 0081#5-verification-and-data-proof — its independent data proof.
    //   — the staged-generation path end to end: stage, copy through closed
    //   expressions, prove content against the independent expected-value
    //   evaluation, publish by swap, park the predecessor for the rollback
    //   window, and restamp exactly the content-changed rows.
    #[test]
    fn staged_generation_migration_proves_and_publishes() {
        let mut db = seeded_db();
        let before: Vec<Value> = db
            .query_reads_read()
            .query(
                &QueryPlan {
                    table_visibility: None,
                    table: "items".to_owned(),
                    filters: Vec::new(),
                    membership_filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    indexed_by: None,
                },
                &HandlerInput::default(),
            )
            .expect("read predecessor rows")
            .rows;
        let plan = staged_plan(None);
        let approval = approval_for(&plan, now_millis());
        let receipt = staged_apply(&mut db, &plan, &approval).expect("staged apply");
        assert_eq!(receipt.state.kind(), "released");

        // The §5 proof rode the receipt: real digests, zero rejects, full
        // method on its face.
        let proof = receipt
            .step_results
            .get("§5-data-proof")
            .expect("data proof on the receipt");
        assert_eq!(proof["proofMethod"], json!("full"));
        assert_eq!(proof["proofClass"], json!("independentBoundaryProof"));
        assert_eq!(proof["boundaryDomain"], json!("migration"));
        assert_eq!(
            proof["expectedEvaluatorIndependence"],
            json!("separateImplementation")
        );
        assert_eq!(proof["independenceLimitation"], Value::Null);
        assert!(proof["expectedDerivation"].as_str().is_some());
        assert!(
            proof["tables"]["items"]["logicalDigest"]
                .as_str()
                .is_some_and(|digest| digest.starts_with("cdv1:")),
            "{proof}"
        );
        assert_eq!(
            proof["tables"]["items"]["expectedLogicalDigest"],
            proof["tables"]["items"]["actualLogicalDigest"]
        );
        assert_eq!(
            proof["tables"]["items"]["expectedSystemDigest"],
            proof["tables"]["items"]["actualSystemDigest"]
        );
        assert_eq!(proof["tables"]["items"]["matches"], json!(true));
        assert_eq!(proof["tables"]["items"]["rejects"], json!(0));

        // Published by swap: live rows carry the transform; every row's
        // content changed (the new note), so §4 restamps all of them.
        let after: Vec<Value> = db
            .query_reads_read()
            .query(
                &QueryPlan {
                    table_visibility: None,
                    table: "items".to_owned(),
                    filters: Vec::new(),
                    membership_filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    indexed_by: None,
                },
                &HandlerInput::default(),
            )
            .expect("read successor rows")
            .rows;
        assert_eq!(after.len(), before.len());
        for row in &after {
            assert_eq!(row["note"], json!("n/a"));
            assert_eq!(row["_updatedAt"].as_u64(), Some(PUBLICATION_TS));
        }
        // Inherited identities: _id and _createdAt survive the copy.
        for (pre, post) in before.iter().zip(after.iter()) {
            assert_eq!(pre["_id"], post["_id"]);
            assert_eq!(pre["_createdAt"], post["_createdAt"]);
        }
        // The predecessor generation parked for the rollback window and,
        // with the window closed at release, the cleanup tail dropped it.
        assert!(
            !super::super::sqlite_table_exists(&db.conn, "items__retired_g1")
                .expect("retired lookup"),
        );
        let runtime_indexes: Vec<(String, String)> = {
            let mut statement = db
                .conn
                .prepare(
                    "SELECT name, tbl_name FROM sqlite_schema
                     WHERE type = 'index'
                       AND (name GLOB '_snapback_version_domain_*'
                            OR name GLOB '_snapback_version_head_*')
                     ORDER BY name",
                )
                .expect("prepare runtime-index inventory");
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .expect("query runtime-index inventory")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect runtime-index inventory")
        };
        assert_eq!(
            runtime_indexes,
            vec![
                (
                    "_snapback_version_domain_items".to_owned(),
                    "items".to_owned()
                ),
                (
                    "_snapback_version_head_items".to_owned(),
                    "items".to_owned()
                ),
            ],
            "staged publication must leave only final-name runtime indexes"
        );
    }

    // §5: sampled-audit is a separately named lower-assurance class and its
    // receipt says so on its face.
    #[test]
    fn sampled_audit_labels_its_receipt_face() {
        let mut db = seeded_db();
        let mut plan = staged_plan(None);
        let mut body = plan.body.clone();
        body.proof = MigrationProof {
            method: MigrationProofMethod::SampledAudit,
            bound: Some(1),
        };
        plan = MigrationPlanArtifactV1::seal(body).expect("reseal");
        let approval = approval_for(&plan, now_millis());
        let receipt = staged_apply(&mut db, &plan, &approval).expect("sampled apply");
        let proof = receipt.step_results.get("§5-data-proof").expect("proof");
        assert_eq!(proof["proofMethod"], json!("sampled-audit"));
        assert_eq!(proof["proofClass"], json!("inventory"));
        assert_eq!(proof["boundaryDomain"], json!("migration"));
        assert_eq!(
            proof["expectedEvaluatorIndependence"],
            json!("notApplicable")
        );
        assert_eq!(proof["independenceLimitation"], Value::Null);
        assert_eq!(proof["expectedDerivation"], Value::Null);
        assert!(
            proof["proofLabel"]
                .as_str()
                .is_some_and(|label| label.contains("NOT a proof")),
            "{proof}"
        );
        assert_eq!(proof["sampleBound"], json!(1));
    }

    // §5: a successor whose stored bytes diverge from the expected-value
    // evaluation refuses publication.
    #[test]
    fn verification_failure_blocks_publication() {
        let mut db = seeded_db();
        let plan = staged_plan(None);
        // Run the staged steps via the real executor path up to Verifying,
        // then corrupt the staged generation and prove the §5 harness
        // catches it.
        let approval = approval_for(&plan, now_millis());
        // Stage + copy via the real executor path, killed before verifying
        // commits its entry: arm the verifying kill point so apply crashes
        // after the copy batches committed.
        arm_migration_kill_point("verifying", 0);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            staged_apply(&mut db, &plan, &approval)
        }));
        disarm_migration_kill_point();
        assert!(outcome.is_err(), "the armed kill point must fire");
        // Corrupt one staged row.
        db.conn
            .execute("UPDATE items__g2 SET note = 'tampered' WHERE rowid = 1", [])
            .expect("tamper staged row");
        let error = staged_apply(&mut db, &plan, &approval)
            .expect_err("tampered successor bytes must refuse publication");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MIGRATION_VERIFICATION_FAILED"
        );
        // The predecessor remains authoritative.
        assert!(
            !super::super::sqlite_table_exists(&db.conn, "items__retired_g1")
                .expect("retired lookup"),
        );
    }

    #[test]
    fn independent_oracle_detects_executor_semantic_drift_before_publication() {
        let mut db = seeded_db();
        let plan = staged_plan(None);
        let approval = approval_for(&plan, now_millis());
        install_migration_execution_value_hook(|field, value| {
            if field == "note" {
                json!("executor-drift")
            } else {
                value
            }
        });
        let result = staged_apply(&mut db, &plan, &approval);
        clear_migration_execution_value_hook();
        let error = result.expect_err("independent expected semantics must catch executor drift");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MIGRATION_VERIFICATION_FAILED"
        );
        assert!(
            !super::super::sqlite_table_exists(&db.conn, "items__retired_g1")
                .expect("predecessor remains authoritative"),
        );
    }

    // @ref LLP 0081#6-compatibility-and-deployment-ordering — the fast
    //   rollback: available exactly while published-held, republishes the
    //   retained predecessor byte-exactly, allocates one new version R,
    //   raises the floor, advances the storage generation (so re-migrating
    // @ref LLP 0081#3-typed-migration-steps — physical cleanup is
    //   separately fenced after the rollback window: release closes the
    //   window (§6's fast rollback exists only in published-held), the
    //   journaled cleanup-pending tail drops the parked predecessor
    //   generation, a crash inside the tail resumes from the journal, and
    //   the tail is never reachable before a terminal state (the committed
    //   transition relation admits it only from released/rolled-back).
    #[test]
    fn cleanup_tail_drops_parked_generations_and_resumes_after_crash() {
        // Clean release: the parked predecessor generation is dropped and
        // the journal closes the tail back into `released`.
        let mut db = seeded_db();
        let plan = staged_plan(None);
        let approval = approval_for(&plan, now_millis());
        staged_apply(&mut db, &plan, &approval).expect("apply");
        assert!(
            !crate::storage::sqlite_table_exists(&db.conn, "items__retired_g1").expect("inventory"),
            "the parked predecessor drops once the rollback window closes"
        );
        let entries = journal_entries_on(&db.conn, &approval.operation_id).expect("journal");
        let kinds: Vec<&str> = entries.iter().map(|entry| entry.state.kind()).collect();
        assert!(
            kinds
                .windows(2)
                .any(|window| window == ["cleanup-pending", "released"]),
            "the tail closes back into its terminal: {kinds:?}"
        );
        let summary = entries
            .iter()
            .rev()
            .find(|entry| entry.state.kind() == "released")
            .and_then(|entry| entry.verification.clone())
            .expect("the terminal row carries the sweep summary");
        assert_eq!(summary["droppedTables"], json!(["items__retired_g1"]));

        // Crash inside the tail: the publication is already terminal, the
        // journal shows cleanup-pending, the parked bytes survive, and the
        // reopen-time resume completes the sweep.
        let mut crashed = seeded_db();
        let plan = staged_plan(None);
        let approval = approval_for(&plan, now_millis());
        arm_migration_kill_point("cleanup-pending", 0);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            staged_apply(&mut crashed, &plan, &approval)
        }));
        disarm_migration_kill_point();
        assert!(outcome.is_err(), "the armed kill point must fire");
        // The kill fires in the pending transition's interior — before its
        // row commits — so the journal still shows the terminal and the
        // parked bytes survive; resume is inventory-driven.
        assert_eq!(
            latest_state_for_test(&crashed, &approval.operation_id)
                .expect("state")
                .expect("journaled")
                .kind(),
            "released",
        );
        assert!(
            crate::storage::sqlite_table_exists(&crashed.conn, "items__retired_g1")
                .expect("inventory"),
            "the parked bytes survive a crash inside the tail"
        );
        let resumed = crashed
            .resume_pending_migration_cleanup()
            .expect("resume")
            .expect("terminal journal plus garbage inventory resumes");
        assert_eq!(resumed["droppedTables"], json!(["items__retired_g1"]));
        assert_eq!(
            latest_state_for_test(&crashed, &approval.operation_id)
                .expect("state")
                .expect("journaled")
                .kind(),
            "released",
        );
        assert!(
            crashed
                .resume_pending_migration_cleanup()
                .expect("idempotent probe")
                .is_none(),
            "a clean inventory leaves nothing to resume"
        );

        // The other interior: the pending cut commits, the crash lands
        // before the sweep's terminal row — reopen resumes from the
        // journaled cleanup-pending itself.
        let mut held = seeded_db();
        let plan = staged_plan(None);
        let approval = approval_for(&plan, now_millis());
        arm_migration_kill_point("released", 1);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            staged_apply(&mut held, &plan, &approval)
        }));
        disarm_migration_kill_point();
        assert!(outcome.is_err(), "the second released append must kill");
        assert_eq!(
            latest_state_for_test(&held, &approval.operation_id)
                .expect("state")
                .expect("journaled")
                .kind(),
            "cleanup-pending",
        );
        let resumed = held
            .resume_pending_migration_cleanup()
            .expect("resume")
            .expect("a durable pending row resumes");
        assert_eq!(resumed["droppedTables"], json!(["items__retired_g1"]));
        assert_eq!(
            latest_state_for_test(&held, &approval.operation_id)
                .expect("state")
                .expect("journaled")
                .kind(),
            "released",
        );
    }

    #[test]
    fn rollback_cleanup_preserves_unrelated_generation_shaped_user_table() {
        let mut db = seeded_db();
        db.conn
            .execute_batch(
                "CREATE TABLE logs__g2 (message TEXT NOT NULL); \
                 INSERT INTO logs__g2(message) VALUES ('keep me')",
            )
            .expect("create unrelated user table");
        let plan = staged_plan(Some(PUBLICATION_TS + 1));
        let approval = approval_for(&plan, now_millis());
        let (_, resolved) = audience();
        arm_migration_kill_point("released", 0);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            staged_apply(&mut db, &plan, &approval)
        }));
        disarm_migration_kill_point();
        assert!(outcome.is_err(), "release kill point must fire");

        db.migrate_rollback(&plan, &approval, &resolved, now_millis())
            .expect("rollback unrelated migration");
        let retained: String = db
            .conn
            .query_row("SELECT message FROM logs__g2", [], |row| row.get(0))
            .expect("unrelated table and row survive cleanup");
        assert_eq!(retained, "keep me");
    }

    #[test]
    fn terminal_cleanup_purges_only_the_operations_migration_checkpoints() {
        let mut released = seeded_db();
        let release_plan = fixture_plan(
            &predecessor_schema(),
            &successor_schema(),
            default_ceilings(),
        );
        let release_approval = approval_for(&release_plan, now_millis());
        apply_fixture(&mut released, &release_plan, &release_approval).expect("release migration");
        let release_checkpoints: u64 = released
            .conn
            .query_row(
                "SELECT COUNT(*) FROM _snapback_migration_checkpoint \
                 WHERE operation_id = ?1",
                params![release_approval.operation_id],
                |row| row.get(0),
            )
            .expect("released checkpoint count");
        assert_eq!(release_checkpoints, 0);

        let mut rolled_back = seeded_db();
        let rollback_plan = staged_plan(Some(PUBLICATION_TS + 1));
        let rollback_approval = approval_for(&rollback_plan, now_millis());
        arm_migration_kill_point("released", 0);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            staged_apply(&mut rolled_back, &rollback_plan, &rollback_approval)
        }));
        disarm_migration_kill_point();
        assert!(outcome.is_err(), "release kill point must fire");
        rolled_back
            .conn
            .execute(
                "INSERT INTO _snapback_migration_checkpoint( \
                 operation_id, table_name, row_id, version, updated_at) \
                 VALUES(?1, 'items', 'cleanup-proof', 1, 1)",
                params![rollback_approval.operation_id],
            )
            .expect("install rolled-back cleanup checkpoint proof row");
        let held_checkpoints: u64 = rolled_back
            .conn
            .query_row(
                "SELECT COUNT(*) FROM _snapback_migration_checkpoint \
                 WHERE operation_id = ?1",
                params![rollback_approval.operation_id],
                |row| row.get(0),
            )
            .expect("held checkpoint count");
        assert!(held_checkpoints > 0);
        let (_, resolved) = audience();
        rolled_back
            .migrate_rollback(&rollback_plan, &rollback_approval, &resolved, now_millis())
            .expect("rollback migration");
        let rollback_checkpoints: u64 = rolled_back
            .conn
            .query_row(
                "SELECT COUNT(*) FROM _snapback_migration_checkpoint \
                 WHERE operation_id = ?1",
                params![rollback_approval.operation_id],
                |row| row.get(0),
            )
            .expect("rolled-back checkpoint count");
        assert_eq!(rollback_checkpoints, 0);
    }

    //   needs a fresh preview), seals the rollback receipt, and replays
    //   idempotently.
    #[test]
    fn fast_rollback_republishes_the_predecessor() {
        let mut db = seeded_db();
        let before: Vec<Value> = db
            .query_reads_read()
            .query(
                &QueryPlan {
                    table_visibility: None,
                    table: "items".to_owned(),
                    filters: Vec::new(),
                    membership_filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    indexed_by: None,
                },
                &HandlerInput::default(),
            )
            .expect("read predecessor rows")
            .rows;
        let plan = staged_plan(Some(PUBLICATION_TS + 1));
        let approval = approval_for(&plan, now_millis());
        let (_, resolved) = audience();

        // Rollback before published-held refuses.
        let premature = db
            .migrate_rollback(&plan, &approval, &resolved, now_millis())
            .expect_err("rollback needs published-held");
        assert_eq!(
            premature.diagnostic.code,
            "SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE"
        );

        // Reach published-held: kill the released transition's interior.
        arm_migration_kill_point("released", 0);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            staged_apply(&mut db, &plan, &approval)
        }));
        disarm_migration_kill_point();
        assert!(outcome.is_err(), "the armed kill point must fire");
        assert_eq!(
            latest_state_for_test(&db, &approval.operation_id)
                .expect("state")
                .expect("journaled")
                .kind(),
            "published-held",
        );
        // The fence is still closed while held.
        assert!(db.migration_fence().expect("fence").is_some());

        // A kill inside rolling-back leaves published-held intact (the
        // transaction rolled back whole); the retry then succeeds.
        arm_migration_kill_point("rolling-back", 0);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            db.migrate_rollback(&plan, &approval, &resolved, now_millis())
        }));
        disarm_migration_kill_point();
        assert!(outcome.is_err());
        let rollback = db
            .migrate_rollback(&plan, &approval, &resolved, now_millis())
            .expect("fast rollback");
        assert_eq!(rollback.staged_tables_restored, vec!["items".to_owned()]);
        assert_eq!(rollback.restored_storage_generation, 2);
        assert_eq!(rollback.restamped_rows, 0);

        // Byte-exact republish: the predecessor rows are back, system
        // fields untouched; the successor generation is parked staged.
        let after: Vec<Value> = db
            .query_reads_read()
            .query(
                &QueryPlan {
                    table_visibility: None,
                    table: "items".to_owned(),
                    filters: Vec::new(),
                    membership_filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    indexed_by: None,
                },
                &HandlerInput::default(),
            )
            .expect("read republished rows")
            .rows;
        assert_eq!(before, after, "the republish is byte-exact");
        assert!(db.migration_fence().expect("fence").is_none());

        // Replays: rollback returns the sealed rollback receipt; apply
        // returns the terminal forward receipt.
        let replay = db
            .migrate_rollback(&plan, &approval, &resolved, now_millis())
            .expect("rollback replay");
        assert_eq!(replay, rollback);
        let forward = staged_apply(&mut db, &plan, &approval).expect("apply replay");
        assert_eq!(forward.state.kind(), "rolled-back");

        // Re-migrating the republished generation requires a fresh preview:
        // the same plan under a NEW approval is stale against the advanced
        // storage generation.
        let fresh = approval_for(&plan, now_millis());
        let error = staged_apply(&mut db, &plan, &fresh)
            .expect_err("republished generation requires a new preview");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PLAN_STALE");
    }

    // §4: fault injection exercises the interior of every durable
    // transition on the happy path — a simulated crash before each journal
    // append leaves a resumable journal, and resume completes with correct,
    // unduplicated effects.
    #[test]
    fn kill_points_recover_at_every_transition_interior() {
        for (kind, nth) in [
            ("admitted", 0),
            ("barriered", 0),
            ("executing", 0),
            ("executing", 1),
            ("verifying", 0),
            ("published-held", 0),
            ("released", 0),
            ("cleanup-pending", 0),
        ] {
            let mut db = seeded_db();
            let plan = fixture_plan(
                &predecessor_schema(),
                &successor_schema(),
                default_ceilings(),
            );
            let approval = approval_for(&plan, now_millis());
            arm_migration_kill_point(kind, nth);
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                apply_fixture(&mut db, &plan, &approval)
            }));
            disarm_migration_kill_point();
            assert!(
                outcome.is_err(),
                "kill point {kind}#{nth} must fire on the happy path"
            );
            let receipt = apply_fixture(&mut db, &plan, &approval)
                .unwrap_or_else(|error| panic!("resume after {kind}#{nth}: {error:?}"));
            assert_eq!(receipt.state.kind(), "released", "after {kind}#{nth}");
            // Effects exactly once: every row backfilled with the constant,
            // none double-stamped past the publication version.
            let rows = db
                .query_reads_read()
                .query(
                    &QueryPlan {
                        table_visibility: None,
                        table: "items".to_owned(),
                        filters: Vec::new(),
                        membership_filters: Vec::new(),
                        order: Vec::new(),
                        limit: None,
                        indexed_by: None,
                    },
                    &HandlerInput::default(),
                )
                .expect("read rows")
                .rows;
            for row in &rows {
                assert_eq!(row["note"], json!("n/a"), "after {kind}#{nth}");
                assert_eq!(
                    row["_updatedAt"].as_u64(),
                    Some(PUBLICATION_TS),
                    "after {kind}#{nth}"
                );
            }
            assert!(
                db.migration_fence().expect("fence").is_none(),
                "fence clear after {kind}#{nth}"
            );
        }
    }
}
