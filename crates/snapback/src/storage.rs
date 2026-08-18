use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use crate::instance_fork::DerivedForkRuntimeExt as _;
use crate::ephemeral::{validate_collection_definitions, validate_collection_permission_backing};
use crate::manifest::{
    AssetCollectionMutationPlanV1, AssetCollectionOperationV1, AuthInput, AuthMode,
    AuthRequirement, AuthorityProfileHookV1, AuthorityProfileOperationNameV1,
    AuthorityProfileOperationV1, AuthorityProfileTransitionOpV1, CLIENT_MUTATION_ACK_MAX_IDS,
    CTX_ANSWER_LEDGER_MAX_IDS, CTX_ANSWER_LEDGER_VERSION, CtxAnswerLedger, FieldManifest,
    FieldType, FilterOp, FunctionKind, HandlerInput, MembershipManifest, MembershipOp,
    MembershipProvenance, MembershipScope, MembershipTarget, MutationOutput, MutationPlan,
    MutationSettlement, MutationStep, OrderDirection, OrderExpr, OwnerWriteAbsentDispositionV1,
    OwnerWriteCheckV1, PORTABLE_STORAGE_VERSION_MAX, QUERY_INTERNAL_OVERFETCH_MAX,
    QUERY_MAX_FILTER_BINDINGS, QUERY_MAX_IN_ITEMS, QueryOutput, QueryPlan, ReadDependency,
    ResultValueContract, ReturnValue, SchemaManifest, SeedData, SettlementMintObservation,
    SettlementTimeObservation, TableManifest, TableVisibilityV1, ValueExpr,
    canonical_membership_transition_matrix, effective_query_limit, is_user_identifier,
    replay_opaque_id_is_valid, validate_ctx_answer_ledger, validate_portable_timestamp_millis,
    validate_query_plan_shape,
};
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{
    Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior, params,
    params_from_iter,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value, json};
use sha2::{Digest, Sha256};
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};
#[cfg(test)]
use std::sync::{OnceLock, mpsc};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub(crate) const META_FUNCTION_GENERATION: &str = "function_generation";

mod api_envelope_state;
mod asset_attempts;
pub(crate) mod asset_grants;
mod asset_maintenance;
mod asset_reads;
pub(crate) mod auth_catalog_ops;
// @ref LLP 0213#security-boundaries-and-invariants — rehearsal grants and
// accounting are a protected companion catalog, outside app-addressable
// schema and the frozen `_auth_*` catalog shape/version.
pub(crate) mod auth_rehearsal;
// @ref LLP 0055#catalog-and-lifecycle — logical auth transfer carries stable
// identity/recovery facts and scope tombstones while structurally omitting all
// spendable or consent-pending authority.
#[path = "storage/auth_logical_transfer.rs"]
pub(crate) mod auth_logical_transfer;
mod branch_ops;
mod checkpoints;
// The item-3 provider integration consumes these crate-private seams after this
// catalog lane lands; keep the catalog module narrow without making unfinished
// provider routes part of the public storage API in this commit.
#[allow(dead_code)]
#[path = "storage/auth.rs"]
pub(crate) mod auth;
mod connections;
#[path = "storage/generation_commit.rs"]
pub(crate) mod generation_commit;
pub(crate) mod jobs;
mod membership_plans;
mod membership_reads;
pub mod migration_executor;
mod migration_scan;
mod mutation_writes;
mod projection_rebuild;
mod push_registry;
mod query_reads;
mod schema_seed;
mod schema_transition;
mod settlement;
mod versions;

pub use snapback_types::storage::*;
pub use self::jobs::{JobsKernel, JobsReadKernel};
pub use api_envelope_state::{
    ApiEnvelopeCurrentRecord, ApiEnvelopeKernel, ApiEnvelopeReadKernel, ApiEnvelopeStateRecord,
};
pub use asset_attempts::{AssetAttemptsKernel, AssetPreparedVariant, AssetPublishOutcome};
pub use asset_maintenance::AssetMaintenanceKernel;
pub use asset_reads::{AssetDelivery, AssetDeliveryOutcome, AssetReadsKernel};
pub use auth_catalog_ops::AuthCatalogKernel;
#[cfg(test)]
pub(crate) use auth_catalog_ops::{
    insert_test_email_identity, insert_test_external_identity, insert_test_identity_session,
};
pub use branch_ops::{BranchOpsKernel, BranchOpsReadKernel};
pub use checkpoints::{CheckpointsKernel, CheckpointsReadKernel};
use connections::registered_writer_coverage_manifest;
pub use connections::{PooledReader, ReaderPool};
#[allow(unused_imports)] // Preserve the pre-split crate::storage surface.
pub(crate) use connections::{
    RegisteredSystemWriterPurposeV1, RegisteredSystemWriterV1, open_registered_system_writer_v1,
};
pub(crate) use generation_commit::{CommitFunctionGeneration, FunctionGenerationRecord};
pub use membership_plans::{MembershipPlansKernel, MembershipPlansReadKernel};
pub use membership_reads::MembershipReadsKernel;
pub(crate) use migration_scan::migration_keyset_scan_batch_on;
pub use migration_scan::{
    MIGRATION_SCAN_CHECKPOINT_VERSION, MIGRATION_SCAN_MAX_BATCH_BYTES,
    MIGRATION_SCAN_MAX_BATCH_MILLIS, MIGRATION_SCAN_MAX_BATCH_ROWS, MigrationKeysetScanBatch,
    MigrationKeysetScanCheckpointV1, MigrationKeysetScanRequestV1, MigrationScanCeilingsV1,
    MigrationScanValidatorStateV1, MigrationScanValidatorV1,
};
pub use mutation_writes::MutationWritesKernel;
pub(crate) use projection_rebuild::PendingProjectionPublication;
pub use projection_rebuild::ProjectionRebuildReceipt;
use projection_rebuild::{ProjectionEffectCeiling, maintain_projections_in_tx};
pub use push_registry::PushRegistryKernel;
pub use query_reads::{QueryReadsKernel, QueryReadsReadKernel};
pub use schema_seed::SchemaSeedKernel;
#[cfg(test)]
pub(crate) use schema_transition::publish_schema_transition_for_test;
pub use schema_transition::{
    SCHEMA_TRANSITION_JOURNAL_TABLE, SchemaTransitionEventBodyV1, SchemaTransitionEventV1,
    SchemaTransitionKind,
};
pub(crate) use schema_transition::{
    prove_retained_work_posture, record_schema_transition_event, schema_transition_events_on,
};
pub use settlement::{SettlementKernel, SettlementReadKernel};
pub use versions::{VersionsKernel, VersionsReadKernel};

#[cfg(test)]
mod tests;

// Inventory-only rows remain dormant until their named lanes gain envelope
// adapters; keeping them in the closed enum is the honesty mechanism.
#[allow(dead_code)]
mod write_authority;

// @ref LLP 0055#principal-kinds — agent-principal ownership and durable
//   deactivation live in their own module beneath the auth catalog. Grant/token
//   lifecycle (G3/G4) is not wired yet, so the storage methods are dead until
//   the routes land.
#[allow(dead_code)]
#[path = "storage/auth_agents.rs"]
pub(crate) mod auth_agents;

// @ref LLP 0214#8-complete-floor-transition-set — guest, local-password, and
// recovery-code transitions use the protected v3 catalog lane.
#[allow(dead_code)]
#[path = "storage/auth_identity.rs"]
pub(crate) mod auth_identity;

// @ref LLP 0055#credentials-and-tokens — credential rotation, time-only family
//   tombstones, revoke-self, and scoped-token mint/validation live below the
//   protected auth catalog rather than the app-data mutation surface.
#[allow(dead_code)]
#[path = "storage/auth_agent_credentials.rs"]
pub(crate) mod auth_agent_credentials;

// @ref LLP 0055#dated-amendment-per-app-asset-callbacks-service-principal-2026-08-03
//   — the sessions asset runner uses one protected-catalog principal and
//   immutable exact-function grants; it never mints a user session or an
//   owner bearer.
#[path = "storage/auth_asset_callbacks.rs"]
pub(crate) mod auth_asset_callbacks;

// @ref LLP 0055#grants — immutable exact-function scopes bind a durable basis
//   generation; removal and authority-significant manifest changes leave
//   tombstones so old consent cannot revive after re-add or restart.
#[allow(dead_code)]
#[path = "storage/auth_scope_bases.rs"]
pub(crate) mod auth_scope_bases;

// @ref LLP 0055#grants — pairing-code consent and immutable delegated grants
//   are one protected-catalog lifecycle, with concrete scope bases captured at
//   consent and no silent cap eviction.
#[allow(dead_code)]
#[path = "storage/auth_grants.rs"]
pub(crate) mod auth_grants;

// @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08 — integration public identity and reversible admission live in a manifest-activated companion catalog, separate from versioned `_auth_*` shapes.
#[path = "storage/auth_integrations.rs"]
pub(crate) mod auth_integrations;

// @ref LLP 0071#bounded-pre-auth-ledger — declared-client attribution is a
// manifest-activated exact companion, never an account in the frozen auth
// catalog namespace.
#[path = "storage/declared_clients.rs"]
pub(crate) mod declared_clients;

// @ref LLP 0204#d94--shareable-capability-links — bearer hashes and bounded
// use facts live in a manifest-activated exact companion, never app tables.
#[path = "storage/capability_links.rs"]
pub(crate) mod capability_links;

// @ref LLP 0204#d95--approval-gated-effects — approval intents and their
// transition journal are protected manifest-owned state, never app rows.
#[path = "storage/pending_effects.rs"]
pub(crate) mod pending_effects;

// @ref LLP 0204#d93--durable-watches-end-user-automations — standing watch intent, bounded edge
// state, and its firing journal are a manifest-activated protected companion.
#[path = "storage/watches.rs"]
pub(crate) mod watches;

// @ref LLP 0070#webhook-work — logical deliveries and bounded
// attempts are manifest-owned protected evidence; the LLP 0070 jobs table
// remains the scheduler and claim authority.
#[path = "storage/webhooks.rs"]
pub(crate) mod webhooks;

#[path = "storage/ask_spend.rs"]
pub(crate) mod ask_spend;

#[path = "storage/stream_transcripts.rs"]
pub(crate) mod stream_transcripts;

#[allow(dead_code)]
#[path = "storage/auth_rescue.rs"]
pub(crate) mod auth_rescue;

#[path = "storage/auth_mode.rs"]
pub(crate) mod auth_mode;

#[path = "storage/authorization.rs"]
pub(crate) mod authorization;

#[path = "storage/auth_invalidation.rs"]
pub(crate) mod auth_invalidation;

#[path = "storage/auth_sender.rs"]
pub(crate) mod auth_sender;

#[path = "storage/auth_throttle.rs"]
pub(crate) mod auth_throttle;

#[path = "storage/hosted_admission.rs"]
pub(crate) mod hosted_admission;

#[path = "storage/authorized_lease.rs"]
pub(crate) mod authorized_lease;

#[allow(dead_code)] // Called by the ENG-24603 pre-bind/coordinator integration lane.
#[path = "storage/auth_stream.rs"]
pub(crate) mod auth_stream;

#[cfg(test)]
type ResetCommitHook = Box<dyn FnOnce() -> SnapbackResult<()>>;

#[cfg(test)]
thread_local! {
    /// Deterministic failure injection immediately before reset+seed commit.
    /// Thread-local keeps parallel tests from perturbing unrelated databases.
    static BEFORE_RESET_COMMIT_HOOK: std::cell::RefCell<Option<ResetCommitHook>> =
        const { std::cell::RefCell::new(None) };
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OperationEnvelopeCrashPointV1 {
    BeforeSettlement,
    AfterSettlementBeforeEnvelope,
    AfterEnvelopeBeforeCommit,
}

#[cfg(test)]
thread_local! {
    /// Deterministic one-shot rollback seams for LLP 0162's ordinary-writer
    /// atomic-envelope crash corpus. Thread-local isolation keeps concurrent
    /// storage tests independent.
    static OPERATION_ENVELOPE_CRASH_POINT: std::cell::Cell<Option<OperationEnvelopeCrashPointV1>> =
        const { std::cell::Cell::new(None) };
}

#[cfg(test)]
fn inject_operation_envelope_crash_for_test(point: OperationEnvelopeCrashPointV1) {
    OPERATION_ENVELOPE_CRASH_POINT.with(|slot| {
        assert!(slot.get().is_none(), "operation crash cut must be one-shot");
        slot.set(Some(point));
    });
}

fn operation_envelope_crash_cut(point: OperationEnvelopeCrashPointV1) -> SnapbackResult<()> {
    #[cfg(test)]
    if OPERATION_ENVELOPE_CRASH_POINT.with(|slot| {
        if slot.get() == Some(point) {
            slot.set(None);
            true
        } else {
            false
        }
    }) {
        return Err(SnapbackError::error(
            "SNAPBACK_TEST_OPERATION_CRASH_CUT",
            "storage",
            format!("injected operation-envelope crash cut at {point:?}"),
        ));
    }
    let _ = point;
    Ok(())
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AuthorizationCommitFaultForTest {
    BeforeCommit,
    AfterRollback,
    AfterCommit,
}

#[cfg(test)]
thread_local! {
    /// One-shot generic authorization-COMMIT fault. `AfterRollback` and
    /// `AfterCommit` force exact durable predecessor/successor reconciliation.
    static AUTHORIZATION_COMMIT_FAULT: std::cell::Cell<Option<AuthorizationCommitFaultForTest>> =
        const { std::cell::Cell::new(None) };
}

#[cfg(test)]
pub(crate) fn inject_authorization_commit_fault_for_test(fault: AuthorizationCommitFaultForTest) {
    AUTHORIZATION_COMMIT_FAULT.with(|slot| {
        assert!(
            slot.get().is_none(),
            "authorization commit fault must be one-shot"
        );
        slot.set(Some(fault));
    });
}

#[cfg(test)]
pub(crate) fn inject_reset_commit_failure_for_test() {
    BEFORE_RESET_COMMIT_HOOK.with(|slot| {
        assert!(slot.borrow().is_none(), "reset hook must be one-shot");
        *slot.borrow_mut() = Some(Box::new(|| {
            Err(SnapbackError::error(
                "SNAPBACK_ACTION_TIMEOUT",
                "storage",
                "injected reset commit-boundary failure",
            ))
        }));
    });
}

const META_SCHEMA_MANIFEST: &str = "schema_manifest";
const META_CRON_STATE: &str = "cron_state";

pub(crate) fn local_target_app_effective_uncovered_lanes_v1() -> Vec<String> {
    write_authority::local_target_app_effective_uncovered_lanes_v1()
}
// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3 monotonic replay floor:
// the highest change version
// that pruning has removed. A resume from at/above it is guaranteed replayable;
// below it, a change may be gone, so the client must resnapshot.
const META_RETENTION_FLOOR: &str = "retention_floor";
const META_CLIENT_MUTATION_GC_TOTAL: &str = "client_mutation_gc_total";
const META_CLIENT_MUTATION_RECORDS: &str = "client_mutation_records";
const META_CLIENT_MUTATION_BYTES: &str = "client_mutation_bytes";
const META_CLIENT_MUTATION_COUNTERS_VERSION: &str = "client_mutation_counters_version";
const META_SETTLEMENT_FORMAT_EPOCH_V1: &str = "client_mutation_settlement_format_epoch_v1";
const META_SETTLEMENT_NEXT_SEQUENCE_V1: &str = "client_mutation_settlement_next_sequence_v1";
/// V4 charges the complete settlement carrier: the original seven logical
/// fields plus format, one exact eight-byte sequence, and optional seal JSON.
/// Opening a store with any predecessor version rebuilds global/per-authority
/// counters from rows before admitting another settlement.
const CLIENT_MUTATION_COUNTERS_VERSION: u64 = 4;
const LEGACY_SETTLEMENT_FORMAT_V1: &str = "legacy-settlement.v1";
const PLAIN_SETTLEMENT_FORMAT_V1: &str = "plain-settlement.v1";
const MEDIA_SETTLEMENT_FORMAT_V1: &str = "media-projected-settlement.v1";
const TEST_CLIENT_MUTATION_AUTHORITY_INSTANCE_ID: &str = "018f0d90-7b24-7a22-8c33-445566778899";
/// A hard availability bound, deliberately equal to the existing journal
/// version budget. We refuse a new durable identity instead of evicting an
/// unacknowledged result and risking duplicate execution after response loss.
pub const CLIENT_MUTATION_MAX_RECORDS: u64 = 10_000;
/// One retained output is bounded by the portable mutation-plan artifact
/// budget; the aggregate is 1,024 such maximum outputs, matching the bounded
/// replay-ledger/runtime lane. Both are hard refusal limits, never eviction.
pub const CLIENT_MUTATION_MAX_RESULT_BYTES: u64 =
    crate::value_expr::MAX_PLAN_SERIALIZED_BYTES as u64;
pub const CLIENT_MUTATION_MAX_BYTES: u64 = 1_024 * CLIENT_MUTATION_MAX_RESULT_BYTES;
/// One auth context cannot monopolize the global exactly-once ledger. This is
/// deliberately smaller than the global record cap while still allowing a
/// large disconnected queue for one principal.
pub const CLIENT_MUTATION_MAX_RECORDS_PER_AUTH: u64 = 1_024;
/// Per-auth retained results are capped at 128 maximum-sized outputs (8 MiB).
pub const CLIENT_MUTATION_MAX_BYTES_PER_AUTH: u64 = 128 * CLIENT_MUTATION_MAX_RESULT_BYTES;

#[derive(Clone, Copy)]
struct ClientMutationRetentionLimits {
    records: u64,
    bytes: u64,
    records_per_auth: u64,
    bytes_per_auth: u64,
}

#[cfg(test)]
thread_local! {
    /// Small deterministic limits let unit tests exercise N+1 admission
    /// without constructing a 10,000-row / 64-MiB ledger. The override is
    /// thread-local so parallel tests and production behavior are unchanged.
    static CLIENT_MUTATION_TEST_LIMITS: std::cell::Cell<Option<ClientMutationRetentionLimits>> =
        const { std::cell::Cell::new(None) };
}

fn client_mutation_retention_limits() -> ClientMutationRetentionLimits {
    #[cfg(test)]
    if let Some(limits) = CLIENT_MUTATION_TEST_LIMITS.with(std::cell::Cell::get) {
        return limits;
    }
    ClientMutationRetentionLimits {
        records: CLIENT_MUTATION_MAX_RECORDS,
        bytes: CLIENT_MUTATION_MAX_BYTES,
        records_per_auth: CLIENT_MUTATION_MAX_RECORDS_PER_AUTH,
        bytes_per_auth: CLIENT_MUTATION_MAX_BYTES_PER_AUTH,
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClientMutationRetentionInfo {
    pub records: u64,
    pub bytes: u64,
    pub gc_total: u64,
    pub max_records: u64,
    pub max_bytes: u64,
    pub max_result_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct StorageInfo {
    #[serde(rename = "sqlitePath", alias = "sqlite_path")]
    pub sqlite_path: Option<PathBuf>,
    #[schemars(range(max = PORTABLE_STORAGE_VERSION_MAX))]
    pub version: u64,
    pub tables: Vec<String>,
    #[serde(rename = "clientMutationRetention")]
    pub client_mutation_retention: ClientMutationRetentionInfo,
}

/// A page of rows read through the schema-aware storage layer for the admin
/// data explorer.
///
/// @ref LLP 0017#durable-data-exploration-and-edits — exploration reads go
/// through schema-aware storage and expose system fields, never raw SQLite
/// physical details.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct TableScan {
    pub table: String,
    /// Stable display order: `_id`, declared fields, then system timestamps.
    pub columns: Vec<String>,
    pub rows: Vec<Value>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ChangeOp {
    Insert,
    Update,
    Delete,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ChangedRow {
    pub table: String,
    pub id: String,
    pub op: ChangeOp,
    pub row: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub changed_fields: Vec<String>,
}

/// One authoritative change-journal row with the commit version that owns it.
/// Derived catch-up executors consume this narrow carrier instead of reaching
/// into the private `_snapback_changes` grammar themselves.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct VersionedChangedRow {
    pub version: u64,
    pub change: ChangedRow,
}

/// One source-commit seam for all synchronous derived indexes. Query modules
/// consume their own read paths; storage owns the write ordering so adding a
/// later vector query executor cannot accidentally bypass atomic maintenance.
fn maintain_derived_indexes_in_tx(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    changes: &[ChangedRow],
    version: u64,
) -> SnapbackResult<()> {
    crate::search::maintain_search_indexes_in_tx(tx, schema, changes, version)?;
    crate::vector::sqlite::maintain_vector_indexes_in_tx(tx, schema, changes, version)
}

/// Process-local impact metadata for the protected-room commit interlock.
///
/// The durable authorization version intentionally remains one global pair,
/// but an app-data event can still carry enough transaction-local facts to
/// keep unrelated protected rooms live. Activation and destructive boundaries
/// have no safe row selector and therefore conservatively target every room.
///
/// @ref LLP 0053#ephemeral-room-authority-invalidation — writers prepare a
///   dependency selector before commit instead of globally suspending rooms.
#[derive(Clone, Copy, Debug)]
pub(crate) enum AuthorizationCommitImpact<'a> {
    AllProtectedRooms,
    AppWrites {
        schema: &'a SchemaManifest,
        changes: &'a [ChangedRow],
    },
}

/// Conservative process-local room set reserved before entering managed
/// Local/SQLite work. Table hints preserve disjoint protected collections;
/// destructive or metadata-incomplete operations use the explicit all-room
/// form.
#[derive(Clone, Debug)]
pub(crate) enum AuthorizationCommitPreflight {
    NoAuthorizationEvent,
    AllProtectedRooms,
    AppWrites {
        schema: Box<SchemaManifest>,
        changes: Vec<ChangedRow>,
    },
}

pub(crate) fn app_writes_are_authorization_event(
    schema: &SchemaManifest,
    changes: &[ChangedRow],
) -> bool {
    authorization::app_writes_are_authorization_event(schema, changes)
}

/// Marker that this database participates in a process-local authorization
/// sink interlock. The marker intentionally exposes no transaction-time
/// preparation method: callers must install an [`AuthorizationCommitReservation`]
/// before Local and SQLite, and the commit hook may only bind that carrier.
pub(crate) trait AuthorizationCommitInterlock: Send + Sync {}

pub(crate) trait PreparedAuthorizationCommit: Send {
    fn committed(self: Box<Self>, min_commit_version: u64) -> SnapbackResult<()>;
    fn ambiguous(self: Box<Self>);
}

/// An unbound room dependency reserved and quiesced before managed Local work.
/// Binding consumes only transaction-derived immutable data and takes no
/// process mutex; cancellation/finalization is owned after Local release.
pub(crate) trait AuthorizationCommitReservation: Send {
    fn bind(
        self: Box<Self>,
        witness: &AuthorizationCommitWitness,
        impact: AuthorizationCommitImpact<'_>,
    ) -> SnapbackResult<Box<dyn PreparedAuthorizationCommit>>;

    fn cancel(self: Box<Self>);
}

#[derive(Default)]
pub(crate) struct AuthorizationReservationCancellation {
    cancelled: std::sync::atomic::AtomicBool,
}

impl AuthorizationReservationCancellation {
    pub(crate) fn cancel(&self) {
        self.cancelled
            .store(true, std::sync::atomic::Ordering::Release);
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(std::sync::atomic::Ordering::Acquire)
    }
}

thread_local! {
    static MANAGED_AUTHORIZATION_RESERVATION: std::cell::RefCell<Option<Box<dyn AuthorizationCommitReservation>>> =
        const { std::cell::RefCell::new(None) };
}

pub(crate) fn install_managed_authorization_reservation(
    reservation: Box<dyn AuthorizationCommitReservation>,
) {
    MANAGED_AUTHORIZATION_RESERVATION.with(|slot| {
        let previous = slot.borrow_mut().replace(reservation);
        assert!(
            previous.is_none(),
            "managed authorization reservation already installed"
        );
    });
}

pub(crate) fn take_managed_authorization_reservation()
-> Option<Box<dyn AuthorizationCommitReservation>> {
    MANAGED_AUTHORIZATION_RESERVATION.with(|slot| slot.borrow_mut().take())
}

/// Commit with the exact authorization pair observed before this transaction's
/// hook. The predecessor is not derivable from the successor: first activation
/// advances from absent metadata, while destructive boundaries rotate the
/// incarnation.
///
/// @ref LLP 0053#ephemeral-room-authority-invalidation — a failed COMMIT may
///   finalize only after successor proof, and may exact-unmark only after
///   predecessor/rollback proof; every other outcome keeps the ticket pending.
fn commit_with_authorization_interlock(
    tx: Transaction<'_>,
    witness: &AuthorizationCommitWitness,
    impact: AuthorizationCommitImpact<'_>,
    predecessor: Option<AuthorizationVersion>,
    min_commit_version: u64,
    interlock: Option<Arc<dyn AuthorizationCommitInterlock>>,
) -> SnapbackResult<()> {
    let prepared = prepare_authorization_commit_interlock(witness, impact, interlock.as_ref())?;
    commit_with_prepared_authorization_interlock(
        tx,
        witness,
        predecessor,
        min_commit_version,
        prepared,
    )
}

/// Install and drain the targeted room dependency before a caller acquires
/// any process-global commit fence. An affected room may delay this step, so
/// holding the admission-controller mutex here would make unrelated room
/// routes queue behind the affected commit and violate L9.
///
/// @ref LLP 0053#ephemeral-room-authority-invalidation — targeted dependency
///   preparation must not suspend unrelated protected rooms.
pub(super) fn prepare_authorization_commit_interlock(
    witness: &AuthorizationCommitWitness,
    impact: AuthorizationCommitImpact<'_>,
    interlock: Option<&Arc<dyn AuthorizationCommitInterlock>>,
) -> SnapbackResult<Option<Box<dyn PreparedAuthorizationCommit>>> {
    if !witness.event {
        return Ok(None);
    }
    if interlock.is_none() {
        return Ok(None);
    }
    // Any interlocked transaction must arrive with a dependency that was
    // installed and quiesced before SQLite opened. There is intentionally no
    // direct-library fallback here: calling a process interlock now would
    // overlap its registry/condvar with the live transaction.
    let reservation = take_managed_authorization_reservation().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
            "auth",
            "authorization write reached SQLite without an off-Local, off-SQLite room reservation",
        )
    })?;
    reservation.bind(witness, impact).map(Some)
}

/// Commit after any targeted room dependency has already quiesced. Callers
/// that need a global lifecycle fence acquire it immediately before entering
/// this helper, so the fence covers the SQLite cut without covering the room
/// wait.
fn commit_with_prepared_authorization_interlock(
    tx: Transaction<'_>,
    witness: &AuthorizationCommitWitness,
    predecessor: Option<AuthorizationVersion>,
    min_commit_version: u64,
    prepared: Option<Box<dyn PreparedAuthorizationCommit>>,
) -> SnapbackResult<()> {
    let Some(prepared) = prepared else {
        return tx.commit().map_err(Into::into);
    };

    // Keep the Transaction handle so a COMMIT error can be reconciled on the
    // same serialized connection before another supported writer can advance
    // the durable authorization pair. No room/registry lock is held here.
    let commit = commit_authorization_transaction(&tx);
    if commit.is_ok() {
        return prepared.committed(min_commit_version);
    }
    let commit_error = commit.expect_err("checked error outcome");

    if !tx.is_autocommit() && tx.execute_batch("ROLLBACK").is_ok() {
        // SQLite confirmed that this exact transaction rolled back. Dropping
        // the prepared handle compare-removes only its ticket.
        drop(prepared);
        return Err(commit_error);
    }

    if tx.is_autocommit() {
        match auth_stream::read_authorization_version_snapshot(&tx) {
            Ok(actual) if actual == Some(witness.version.clone()) => {
                return prepared.committed(min_commit_version);
            }
            Ok(actual) if actual == predecessor => {
                drop(prepared);
                return Err(commit_error);
            }
            Ok(_) | Err(_) => {}
        }
    }

    // The transaction may have committed, rolled back, or left the connection
    // unreadable. Keep the exact process-local ticket closed; process rebuild
    // is the only safe recovery because owner-level durable-query/schema
    // publication did not complete. No timeout path may reopen it.
    prepared.ambiguous();
    Err(commit_error)
}

fn commit_authorization_transaction(tx: &Transaction<'_>) -> SnapbackResult<()> {
    #[cfg(test)]
    let fault = AUTHORIZATION_COMMIT_FAULT.with(|slot| slot.take());
    #[cfg(test)]
    if fault == Some(AuthorizationCommitFaultForTest::BeforeCommit) {
        return Err(SnapbackError::error(
            "TEST_AUTHORIZATION_COMMIT_FAILURE",
            "auth",
            "injected failure before authorization COMMIT",
        ));
    }

    #[cfg(test)]
    if fault == Some(AuthorizationCommitFaultForTest::AfterRollback) {
        tx.execute_batch("ROLLBACK")?;
        return Err(SnapbackError::error(
            "TEST_AUTHORIZATION_COMMIT_FAILURE",
            "auth",
            "injected authorization COMMIT error after durable rollback",
        ));
    }

    tx.execute_batch("COMMIT")?;

    #[cfg(test)]
    if fault == Some(AuthorizationCommitFaultForTest::AfterCommit) {
        return Err(SnapbackError::error(
            "TEST_AUTHORIZATION_COMMIT_FAILURE",
            "auth",
            "injected lost authorization COMMIT acknowledgement",
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MutationCommit {
    pub output: MutationOutput,
    pub changes: Vec<ChangedRow>,
    #[serde(default)]
    pub read_dependencies: Vec<CapturedReadDependency>,
    #[serde(default)]
    pub write_dependencies: Vec<CapturedWriteDependency>,
    /// Jobs durably enqueued by this commit (LLP 0070's first slice; 0127
    /// decision 7): bounded per-enqueue facts for the mutation receipt.
    /// Empty for every mutation that enqueued nothing.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub job_enqueues: Vec<jobs::JobEnqueueFact>,
    /// Job-state ChangedRows for live fan-out only. Deliberately separate
    /// from `changes`: job rows are receipts-family state, not application
    /// rows, so they never enter OCC validation, projections, search
    /// maintenance, or the version head — only the live matcher.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub job_changes: Vec<ChangedRow>,
    /// Asset ids whose grant-authority projection changed. System state stays
    /// out of app OCC/search paths but invalidates asset live reads.
    #[serde(skip)]
    pub(crate) asset_changes: Vec<String>,
    /// Authority-private facts for sequence allocations committed with this
    /// mutation. The direct receipt carries them; fan-out projection removes
    /// them because the value discloses the number of prior allocations.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sequence_allocations: Vec<SequenceAllocationFact>,
    /// `None` means no commit occurred (dry-run or exact replay). Every fresh
    /// committed app writer returns the pair observed/written in its SQLite
    /// transaction, including ordinary commits that did not advance it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization: Option<AuthorizationCommitWitness>,
    /// Typed authority transitions produced by the central membership writer
    /// seam. Refusals remain `SnapbackError` and therefore retain their stable
    /// declaration-aware diagnostic code without manufacturing a second error
    /// vocabulary.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub authority_transitions: Vec<AuthorityTransitionReceiptV1>,
    /// Server-only post-commit egress carrier. Storage constructs the
    /// result-readiness default; Local replaces it immediately after a real
    /// commit, before preparing live bytes or the caller receipt.
    ///
    /// @ref LLP 0167#observation-semantics--what-a-delay-means — the commit
    ///   group transports one snapshot/basis without changing durable wire.
    #[serde(skip)]
    pub(crate) network_egress: crate::network_profile::MutationEgressBasis,
}

/// A server-admitted lane-L override for one direct RuntimeNow field. The
/// manifest validator proves the structural sink; storage owns the single
/// authoritative sample and records whether that sink actually executed.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SettlementTimePolicy {
    pub field: String,
    pub claimed: u64,
    pub max_skew_ms: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SeedCommit {
    pub output: MutationOutput,
    pub authorization: AuthorizationCommitWitness,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ResetCommit {
    pub seeded: Option<MutationOutput>,
    pub authorization: AuthorizationCommitWitness,
}

struct RetainedClientMutationRow {
    function: String,
    auth_fingerprint: String,
    authority_instance_id: Option<String>,
    input_fingerprint: String,
    operation_issuance_json: Option<String>,
    output_json: String,
    settled_version: SqlValue,
    settled_version_exact: SqlValue,
    settlement_format: Option<String>,
    settlement_record_sequence: SqlValue,
    settlement_projection_seal_json: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SettlementFormatEpochV1 {
    store_scope_id: String,
    legacy_sequence_watermark: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SettlementProjectionSealV1 {
    result_contract_hash: String,
    media_projection_profile_hash: String,
    settlement_id: String,
    settlement_store_scope_id: String,
    settlement_record_sequence: u64,
    settlement_digest: String,
}

struct BufferedCommitOptions<'a> {
    ctx_ledger: Option<CtxAnswerLedger>,
    apply: bool,
    identity: Option<&'a ClientMutationIdentity>,
    media_command: Option<&'a crate::manifest::ResolvedMediaCommandV1>,
    branch_operation: Option<&'a crate::fork_promotion::BranchMutationCommitV1>,
}

pub(crate) struct BufferedCommitPayload {
    pub writes: Vec<BufferedWrite>,
    pub sequence_allocations: Vec<SequenceAllocationFact>,
    pub membership_plans: Vec<AuthorizedMembershipPlan>,
    pub read_dependencies: Vec<CapturedReadDependency>,
    pub result: Value,
    pub ctx_ledger: CtxAnswerLedger,
    /// Buffered `ctx.jobs.enqueue` intents, inserted inside the same SQLite
    /// transaction as the writes above (LLP 0070 §Job identity and enqueue).
    pub job_enqueues: Vec<jobs::BufferedJobEnqueue>,
    /// Producer provenance stamped on every inserted job row (0127 decision
    /// 7). `None` is only legal when `job_enqueues` is empty.
    pub job_producer: Option<jobs::JobProducer>,
    /// Transaction-scoped `ctx.assets.attach` admissions (LLP 0044); never
    /// serialized, never persisted, consumed by the commit hook.
    pub asset_admissions: Vec<crate::assets::AssetAttachmentAdmission>,
    pub asset_grant_ops: Vec<crate::assets::BufferedAssetGrantOp>,
    /// Process-local, take-once proof for `mediaRef.v1` mutation egress. It is
    /// never serialized into any request, ledger, output, or settlement row.
    pub media_projection_proof: Option<crate::runtime::StagedMediaProjectionProofV1>,
    /// Independently reconstructed from the prepared invocation/request
    /// carrier; the storage boundary compares it with the proof before OCC.
    pub expected_media_projection_binding: Option<crate::runtime::MediaProjectionProofBindingV1>,
}

enum MediaProjectionProofAccess<'a> {
    Borrowed {
        proof: &'a crate::runtime::StagedMediaProjectionProofV1,
        expected: &'a crate::runtime::MediaProjectionProofBindingV1,
    },
    Owned {
        proof: crate::runtime::StagedMediaProjectionProofV1,
        expected: crate::runtime::MediaProjectionProofBindingV1,
    },
}

impl MediaProjectionProofAccess<'_> {
    fn proof(&self) -> &crate::runtime::StagedMediaProjectionProofV1 {
        match self {
            Self::Borrowed { proof, .. } => proof,
            Self::Owned { proof, .. } => proof,
        }
    }

    fn expected(&self) -> &crate::runtime::MediaProjectionProofBindingV1 {
        match self {
            Self::Borrowed { expected, .. } => expected,
            Self::Owned { expected, .. } => expected,
        }
    }
}

struct BufferedEffects<'a> {
    writes: Vec<BufferedWrite>,
    sequence_allocations: Vec<SequenceAllocationFact>,
    membership_plans: Vec<AuthorizedMembershipPlan>,
    read_dependencies: Vec<CapturedReadDependency>,
    result: Value,
    job_enqueues: Vec<jobs::BufferedJobEnqueue>,
    job_producer: Option<jobs::JobProducer>,
    asset_admissions: Vec<crate::assets::AssetAttachmentAdmission>,
    asset_grant_ops: Vec<crate::assets::BufferedAssetGrantOp>,
    media_projection: Option<MediaProjectionProofAccess<'a>>,
}

#[derive(Clone, Copy)]
struct MembershipCommitAuthority<'a> {
    gate: MembershipWriteGate,
    writer: Option<&'a MembershipWriter>,
}

impl<'a> MembershipCommitAuthority<'a> {
    const fn deny() -> Self {
        Self {
            gate: MembershipWriteGate::Deny,
            writer: None,
        }
    }

    const fn sanctioned(writer: &'a MembershipWriter) -> Self {
        Self {
            gate: MembershipWriteGate::Sanctioned,
            writer: Some(writer),
        }
    }
}

/// One executed IR mutation plan with its recorded deterministic answers —
/// what the plan wrote (or would write), every host-generated id in answer
/// order, and the frozen evaluation clock. The commit path discards the
/// ledger halves; the dry-run path reports them as `deterministicInputs`
/// (LLP 0051 D8).
pub struct MutationPlanExecution {
    pub commit: MutationCommit,
    /// Host-generated ids in answer order (`Insert`/`InsertEach` row ids) —
    /// the IR half of LLP 0051 D1's one ordered `generatedIds` sequence.
    pub generated_ids: Vec<String>,
    /// The frozen evaluation clock every clock expression answered with.
    pub now_ms: u64,
    /// The database version the plan evaluated against.
    pub snapshot_version: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CapturedWriteDependency {
    pub table: String,
    pub id: String,
    pub op: ChangeOp,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub enum BufferedWrite {
    Insert {
        table: String,
        id: String,
        values: Map<String, Value>,
    },
    Patch {
        table: String,
        id: String,
        values: Map<String, Value>,
    },
    Delete {
        table: String,
        id: String,
    },
}
impl BufferedWrite {
    pub fn table(&self) -> &str {
        match self {
            BufferedWrite::Insert { table, .. }
            | BufferedWrite::Patch { table, .. }
            | BufferedWrite::Delete { table, .. } => table,
        }
    }

    pub fn id(&self) -> &str {
        match self {
            BufferedWrite::Insert { id, .. }
            | BufferedWrite::Patch { id, .. }
            | BufferedWrite::Delete { id, .. } => id,
        }
    }
}

pub struct LocalDatabase {
    conn: Connection,
    /// The connection-local generated writer facade and SQLite authorizer.
    /// It remains dormant until a durable coverage manifest is present.
    writer_authority: write_authority::WriterAuthorityV1,
    path: Option<PathBuf>,
    /// LLP 0158's non-promotable derived-deployment carrier. LLP 0097 branch
    /// state never sets or consults this field.
    derived_fork: Option<crate::instance_fork::DerivedForkRuntime>,
    /// LLP 0164's isolated in-app branch head. It shares the exhaustive host
    /// egress choke with derived forks, but retains its own branch-local proof
    /// and child-version state.
    in_app_branch: Option<crate::fork_promotion::InAppBranchRuntime>,
    schema: SchemaManifest,
    // @ref LLP 0003#database-model — reads use a separate pool of WAL reader
    // connections so queries do not queue behind writes. `None` for in-memory
    // databases, which cannot run WAL; those fall back to the serialized lane.
    reader_pool: Option<Arc<ReaderPool>>,
    /// The LLP 0188 self-hosted replicator, when configured, is the only
    /// authority allowed to checkpoint this WAL. Keeping the fact on the
    /// database prevents a legacy shutdown path from truncating frames before
    /// the replication thread has shipped and head-committed them.
    // @ref LLP 0188#2-integration-point-the-whole-instance-database — the
    // replicator owns every checkpoint while the lane is enabled.
    replication_checkpoint_owner: bool,
    authorization_interlock: Option<Arc<dyn AuthorizationCommitInterlock>>,
    /// One process registry belongs to this database instance. Every AppState
    /// clone borrows this same registry, so constructing another router cannot
    /// replace the interlock beneath already-running service publications.
    service_authority_fences: crate::auth::service_fence::ServiceAuthorityFenceRegistry,
    app_state_graph_claimed: bool,
    /// Active maintained-projection plans (LLP 0080 §5), installed by
    /// function-manifest activation after validation. Every mutation path
    /// consults them so source commits and projection maintenance share one
    /// transaction.
    projections: Arc<Vec<crate::manifest::MaintainedProjectionPlan>>,
    /// Reconciled UTF-8 ceilings for string order fields. Function-manifest
    /// activation installs one value per `(table, field)` only after scanning
    /// the brownfield rows; all shared application writers consult this map.
    /// @ref LLP 0135#4-fold-on-acceptance-amendments-applied-2026-08-02
    order_field_bounds: Arc<BTreeMap<(String, String), u64>>,
    /// Reconciled per-function sequence declarations for the active function
    /// generation. Host plans use this immutable map to resolve the counter's
    /// scope table; handler calls retain their exact function-local access
    /// proof in the runtime context.
    sequence_declarations: Arc<BTreeMap<String, crate::manifest::SequenceDeclaration>>,
}

#[derive(Debug, Clone)]
pub struct ShutdownCheckpointReport {
    pub applicable: bool,
    pub complete: bool,
    pub busy_frames: Option<i64>,
    pub wal_frames: Option<i64>,
    pub checkpointed_frames: Option<i64>,
    pub residual_wal_bytes: Option<u64>,
    pub residual_shm_bytes: Option<u64>,
    pub reader_errors: Vec<String>,
    pub errors: Vec<String>,
}

impl ShutdownCheckpointReport {
    pub fn summary(&self) -> String {
        if !self.applicable {
            return "not applicable to an in-memory store".to_owned();
        }
        format!(
            "complete={}, busy={}, wal_frames={}, checkpointed_frames={}, residual_wal_bytes={}, residual_shm_bytes={}, reader_errors={}, errors={}",
            self.complete,
            self.busy_frames
                .map_or_else(|| "unknown".to_owned(), |value| value.to_string()),
            self.wal_frames
                .map_or_else(|| "unknown".to_owned(), |value| value.to_string()),
            self.checkpointed_frames
                .map_or_else(|| "unknown".to_owned(), |value| value.to_string()),
            self.residual_wal_bytes
                .map_or_else(|| "absent".to_owned(), |value| value.to_string()),
            self.residual_shm_bytes
                .map_or_else(|| "absent".to_owned(), |value| value.to_string()),
            if self.reader_errors.is_empty() {
                "none".to_owned()
            } else {
                self.reader_errors.join(" | ")
            },
            if self.errors.is_empty() {
                "none".to_owned()
            } else {
                self.errors.join(" | ")
            },
        )
    }
}

fn storage_version_corrupt(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_STORAGE_VERSION_CORRUPT",
        "storage",
        message.into(),
    )
}

fn sqlite_table_exists(conn: &Connection, table: &str) -> SnapbackResult<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1",
            params![table],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn sqlite_table_columns(conn: &Connection, table: &str) -> SnapbackResult<BTreeSet<String>> {
    let mut statement = conn.prepare("SELECT name FROM pragma_table_info(?1)")?;
    Ok(statement
        .query_map(params![table], |row| row.get(0))?
        .collect::<Result<BTreeSet<_>, _>>()?)
}

fn require_existing_version_table(conn: &Connection) -> SnapbackResult<u64> {
    if !sqlite_table_exists(conn, "_snapback_version")? {
        return Err(storage_version_corrupt(
            "existing database is missing its global storage version table",
        ));
    }
    let columns = sqlite_table_columns(conn, "_snapback_version")?;
    if !columns.contains("id") || !columns.contains("version") {
        return Err(storage_version_corrupt(
            "global storage version table is missing required columns",
        ));
    }
    let mut statement = conn.prepare("SELECT id, version FROM _snapback_version ORDER BY rowid")?;
    let mut rows = statement.query([])?;
    let Some(row) = rows.next()? else {
        return Err(storage_version_corrupt(
            "existing database is missing its global storage version row",
        ));
    };
    let id: SqlValue = row.get(0)?;
    if id != SqlValue::Integer(1) {
        return Err(storage_version_corrupt(
            "global storage version table does not contain the canonical id",
        ));
    }
    let head = decode_required_storage_version(row.get(1)?, "global storage version")?;
    if rows.next()?.is_some() {
        return Err(storage_version_corrupt(
            "global storage version table contains multiple rows",
        ));
    }
    Ok(head)
}

fn validate_version_column_at_most(
    conn: &Connection,
    table: &str,
    column: &str,
    head: u64,
    committed: bool,
    context: &str,
) -> SnapbackResult<()> {
    if !sqlite_table_exists(conn, table)? {
        return Ok(());
    }
    if !sqlite_table_columns(conn, table)?.contains(column) {
        return Err(storage_version_corrupt(format!(
            "{context} column is missing"
        )));
    }
    let sql = format!(
        "SELECT {} FROM {}",
        quote_ident(column)?,
        quote_ident(table)?
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([], |row| row.get::<_, SqlValue>(0))?;
    for value in rows {
        let version = if committed {
            decode_required_committed_version(value?, context)?
        } else {
            decode_required_storage_version(value?, context)?
        };
        if version > head {
            return Err(storage_version_corrupt(format!(
                "{context} {version} is ahead of global storage head {head}"
            ))
            .with_detail("table", table.to_owned())
            .with_detail("headVersion", head)
            .with_detail("observedVersion", version));
        }
    }
    Ok(())
}

fn validate_retained_mutation_versions(conn: &Connection, head: u64) -> SnapbackResult<()> {
    const TABLE: &str = "_snapback_client_mutations";
    if !sqlite_table_exists(conn, TABLE)? {
        return Ok(());
    }
    let columns = sqlite_table_columns(conn, TABLE)?;
    if !columns.contains("output_json") {
        return Err(storage_version_corrupt(
            "retained mutation table is missing its output column",
        ));
    }
    let has_settled_version = columns.contains("settled_version");
    let has_exact_settled_version = columns.contains("settled_version_exact");
    if has_exact_settled_version && !has_settled_version {
        return Err(storage_version_corrupt(
            "retained mutation table has exact settlement metadata without its predecessor column",
        ));
    }
    let sql = if has_settled_version && has_exact_settled_version {
        "SELECT output_json, settled_version, settled_version_exact \
         FROM _snapback_client_mutations"
    } else if has_settled_version {
        "SELECT output_json, settled_version, NULL FROM _snapback_client_mutations"
    } else {
        "SELECT output_json, NULL, NULL FROM _snapback_client_mutations"
    };
    let mut statement = conn.prepare(sql)?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, SqlValue>(0)?,
            row.get::<_, SqlValue>(1)?,
            row.get::<_, SqlValue>(2)?,
        ))
    })?;
    for row in rows {
        let (output_json, settled_version, exact_settled_version) = row?;
        let output_json =
            decode_required_storage_text(output_json, "retained mutation output JSON")?;
        let output: Value = serde_json::from_str(&output_json)
            .map_err(|_| storage_version_corrupt("retained mutation output JSON is malformed"))?;
        let output_version =
            decode_json_storage_version(output.get("version"), "retained mutation output version")?;
        if output_version > head {
            return Err(storage_version_corrupt(
                "retained mutation output version is ahead of the global storage head",
            )
            .with_detail("headVersion", head)
            .with_detail("outputVersion", output_version));
        }
        if has_settled_version {
            let settled_version = decode_required_storage_version(
                settled_version,
                "retained mutation settlement version",
            )?;
            if settled_version > head {
                return Err(storage_version_corrupt(
                    "retained mutation settlement version is ahead of the global storage head",
                )
                .with_detail("headVersion", head)
                .with_detail("settledVersion", settled_version));
            }
            let exact_settled_version = if has_exact_settled_version {
                decode_optional_storage_version(
                    exact_settled_version,
                    "retained mutation exact settlement version",
                )?
            } else {
                None
            };
            if let Some(exact_settled_version) = exact_settled_version {
                if exact_settled_version > head {
                    return Err(storage_version_corrupt(
                        "retained mutation exact settlement version is ahead of the global storage head",
                    )
                    .with_detail("headVersion", head)
                    .with_detail("exactSettledVersion", exact_settled_version));
                }
                if exact_settled_version != settled_version
                    || exact_settled_version != output_version
                {
                    return Err(storage_version_corrupt(
                        "retained mutation output and authoritative settlement versions disagree",
                    ));
                }
            } else if settled_version != 0 && settled_version != output_version {
                return Err(storage_version_corrupt(
                    "retained mutation output and settlement versions disagree",
                ));
            }
        }
    }
    Ok(())
}

fn validate_retry_episode_versions(conn: &Connection, head: u64) -> SnapbackResult<()> {
    const TABLE: &str = "_snapback_auth_retry_episodes";
    if !sqlite_table_exists(conn, TABLE)? {
        return Ok(());
    }
    if !sqlite_table_columns(conn, TABLE)?.contains("episode_json") {
        return Err(storage_version_corrupt(
            "authorization retry table is missing its episode payload",
        ));
    }
    let mut statement = conn.prepare("SELECT episode_json FROM _snapback_auth_retry_episodes")?;
    let rows = statement.query_map([], |row| row.get::<_, SqlValue>(0))?;
    for encoded in rows {
        let encoded = decode_required_storage_text(encoded?, "authorization retry episode JSON")?;
        let episode: Value = serde_json::from_str(&encoded).map_err(|_| {
            storage_version_corrupt("authorization retry episode JSON is malformed")
        })?;
        let Some(data) = episode.pointer("/witnessFloor/data") else {
            continue;
        };
        if data.is_null() {
            continue;
        }
        let version = decode_json_storage_version(
            data.get("minCommitVersion"),
            "authorization retry data witness version",
        )?;
        if version > head {
            return Err(storage_version_corrupt(
                "authorization retry data witness is ahead of the global storage head",
            )
            .with_detail("headVersion", head)
            .with_detail("witnessVersion", version));
        }
    }
    Ok(())
}

fn validate_existing_storage_ordering(conn: &Connection, head: u64) -> SnapbackResult<()> {
    validate_version_column_at_most(
        conn,
        "_snapback_changes",
        "version",
        head,
        true,
        "change-journal version",
    )?;
    validate_change_journal_head(conn, head)?;
    validate_version_column_at_most(
        conn,
        "_snapback_membership_transitions",
        "commit_version",
        head,
        true,
        "membership transition commit version",
    )?;
    validate_version_column_at_most(
        conn,
        "_snapback_authorized_lease_reservations",
        "snapshot_commit_version",
        head,
        false,
        "authorized lease snapshot version",
    )?;
    for table in physical_user_tables(conn)? {
        if sqlite_table_columns(conn, &table)?.contains("_version") {
            validate_version_column_at_most(
                conn,
                &table,
                "_version",
                head,
                true,
                "managed row storage version",
            )?;
        }
    }
    validate_retained_mutation_versions(conn, head)?;
    validate_retry_episode_versions(conn, head)?;
    if sqlite_table_exists(conn, "_snapback_meta")?
        && sqlite_table_columns(conn, "_snapback_meta")?.contains("value")
    {
        let floor = retention_floor_from_connection(conn)?;
        if floor > head {
            return Err(storage_version_corrupt(
                "change-journal retention floor is ahead of the global storage head",
            )
            .with_detail("headVersion", head)
            .with_detail("retentionFloor", floor));
        }
    }
    Ok(())
}

fn validate_change_journal_head(conn: &Connection, head: u64) -> SnapbackResult<()> {
    if !sqlite_table_exists(conn, "_snapback_changes")? {
        if head == 0 {
            return Ok(());
        }
        return Err(storage_version_corrupt(
            "existing database has a nonzero storage head but no change journal",
        )
        .with_detail("headVersion", head));
    }

    let raw: SqlValue =
        conn.query_row("SELECT MAX(version) FROM _snapback_changes", [], |row| {
            row.get(0)
        })?;
    let journal_head = decode_optional_storage_version(raw, "change-journal high-water")?;
    match (head, journal_head) {
        (0, None) => Ok(()),
        (0, Some(observed)) => Err(storage_version_corrupt(
            "zero storage head unexpectedly has retained change-journal rows",
        )
        .with_detail("headVersion", head)
        .with_detail("journalVersion", observed)),
        (_, Some(observed)) if observed == head => Ok(()),
        (_, observed) => Err(storage_version_corrupt(
            "change-journal high-water does not match the global storage head",
        )
        .with_detail("headVersion", head)
        .with_detail("journalVersion", observed)),
    }
}

fn inspect_storage_for_open(conn: &Connection) -> SnapbackResult<()> {
    with_pinned_read_snapshot(conn, |conn| {
        // LLP 0057's dormant-collision rescue starts from a brownfield database:
        // a foreign `_auth_*` object alone is not evidence that Snapback ever
        // installed a storage-version authority. Requiring a missing head for
        // every non-SQLite object would make the ordinary dev/test rescue route
        // unreachable. Conversely, any Snapback-owned schema object or managed
        // `_version` column proves this is not a fresh adoption and must fail
        // closed if the canonical head is absent.
        let snapback_schema_object = conn
            .query_row(
                "SELECT 1 FROM sqlite_schema \
             WHERE name NOT GLOB 'sqlite_*' \
               AND lower(name) GLOB '_snapback*' \
               AND type IN ('table', 'view', 'index', 'trigger') \
             LIMIT 1",
                [],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        let mut managed_app_schema = false;
        if !snapback_schema_object {
            for table in physical_user_tables(conn)? {
                if sqlite_table_columns(conn, &table)?.contains("_version") {
                    managed_app_schema = true;
                    break;
                }
            }
        }
        if !snapback_schema_object && !managed_app_schema {
            return Ok(());
        }
        let head = require_existing_version_table(conn)?;
        #[cfg(test)]
        notify_storage_read_snapshot_pinned(conn, head);
        validate_existing_storage_ordering(conn, head)?;
        Ok(())
    })
}

impl LocalDatabase {
    pub fn api_envelope(&mut self) -> ApiEnvelopeKernel<'_> {
        ApiEnvelopeKernel::new(self)
    }

    pub fn api_envelope_read(&self) -> ApiEnvelopeReadKernel<'_> {
        ApiEnvelopeReadKernel::new(self)
    }

    pub fn asset_attempts(&mut self) -> AssetAttemptsKernel<'_> {
        AssetAttemptsKernel::new(self)
    }

    pub fn asset_maintenance(&mut self) -> AssetMaintenanceKernel<'_> {
        AssetMaintenanceKernel::new(self)
    }

    pub fn asset_reads(&mut self) -> AssetReadsKernel<'_> {
        AssetReadsKernel::new(self)
    }

    pub fn auth_catalog(&mut self) -> AuthCatalogKernel<'_> {
        AuthCatalogKernel::new(self)
    }

    pub fn auth_catalog_read(&self) -> AuthCatalogKernel<'_> {
        AuthCatalogKernel::new_read(self)
    }

    pub fn branch_ops(&mut self) -> BranchOpsKernel<'_> {
        BranchOpsKernel::new(self)
    }

    pub fn branch_ops_read(&self) -> BranchOpsReadKernel<'_> {
        BranchOpsReadKernel::new(self)
    }

    pub fn membership_plans(&mut self) -> MembershipPlansKernel<'_> {
        MembershipPlansKernel::new(self)
    }

    pub fn membership_plans_read(&self) -> MembershipPlansReadKernel<'_> {
        MembershipPlansReadKernel::new(self)
    }

    pub fn membership_reads(&mut self) -> MembershipReadsKernel<'_> {
        MembershipReadsKernel::new(self)
    }

    pub fn mutation_writes(&mut self) -> MutationWritesKernel<'_> {
        MutationWritesKernel::new(self)
    }

    pub fn jobs(&mut self) -> JobsKernel<'_> {
        JobsKernel::new(self)
    }

    pub fn jobs_read(&self) -> JobsReadKernel<'_> {
        JobsReadKernel::new(self)
    }

    pub fn versions(&mut self) -> VersionsKernel<'_> {
        VersionsKernel::new(self)
    }

    pub fn versions_read(&self) -> VersionsReadKernel<'_> {
        VersionsReadKernel::new(self)
    }

    pub fn checkpoints(&mut self) -> CheckpointsKernel<'_> {
        CheckpointsKernel::new(self)
    }

    pub fn checkpoints_read(&self) -> CheckpointsReadKernel<'_> {
        CheckpointsReadKernel::new(self)
    }

    pub fn settlement(&mut self) -> SettlementKernel<'_> {
        SettlementKernel::new(self)
    }

    pub fn settlement_read(&self) -> SettlementReadKernel<'_> {
        SettlementReadKernel::new(self)
    }

    pub fn push_registry(&mut self) -> PushRegistryKernel<'_> {
        PushRegistryKernel::new(self)
    }

    pub fn query_reads(&mut self) -> QueryReadsKernel<'_> {
        QueryReadsKernel::new(self)
    }

    pub fn query_reads_read(&self) -> QueryReadsReadKernel<'_> {
        QueryReadsReadKernel::new(self)
    }

    pub fn schema_seed(&mut self) -> SchemaSeedKernel<'_> {
        SchemaSeedKernel::new(self)
    }

    pub fn memory() -> SnapbackResult<Self> {
        let conn = Connection::open_in_memory()?;
        let mode_inspection = auth_mode::inspect_for_open(&conn)?;
        let mut db = Self {
            conn,
            writer_authority: write_authority::WriterAuthorityV1::default(),
            path: None,
            derived_fork: None,
            in_app_branch: None,
            schema: SchemaManifest::default(),
            reader_pool: None,
            replication_checkpoint_owner: false,
            authorization_interlock: None,
            service_authority_fences:
                crate::auth::service_fence::ServiceAuthorityFenceRegistry::default(),
            app_state_graph_claimed: false,
            projections: Arc::new(Vec::new()),
            order_field_bounds: Arc::new(BTreeMap::new()),
            sequence_declarations: Arc::new(BTreeMap::new()),
        };
        crate::operation_detail::install(&db.conn, None)?;
        db.configure(false)?;
        db.create_infra()?;
        auth_mode::adopt_after_infra(&mut db, mode_inspection)?;
        db.writer_authority.set_schema(&db.schema)?;
        db.refresh_writer_authority_manifest()?;
        db.writer_authority.install(&db.conn)?;
        Ok(db)
    }

    pub fn open(path: impl AsRef<Path>) -> SnapbackResult<Self> {
        let path = path.as_ref().to_path_buf();
        // @ref LLP 0158#design-sketch — local publication evidence gates boot
        // before SQLite open can perform additive migration.
        let derived_fork = crate::instance_fork::inspect_boot(&path)?;
        let in_app_branch = crate::fork_promotion::inspect_in_app_branch_boot(&path)?;
        if derived_fork.is_some() && in_app_branch.is_some() {
            return Err(SnapbackError::error(
                "SNAPBACK_BRANCH_CUSTODY_INVALID",
                "storage",
                "one database cannot boot as both a derived deployment and an in-app branch",
            ));
        }
        let conn = Connection::open(&path)?;
        // Distinguish a genuinely empty database from an existing database
        // before any additive DDL/default write. Recreating a missing head at
        // zero would make retained rows and journal entries appear uncommitted.
        inspect_storage_for_open(&conn)?;
        // @ref LLP 0058#corrupt-state-boundary — inspect and cross-validate all
        // four mode keys before WAL configuration or any additive infra write.
        let mode_inspection = auth_mode::inspect_for_open(&conn)?;
        // @ref LLP 0057#reservation — a stored manifest is an admission
        // boundary on every reopen, not only when a new schema is applied.
        // Probe and validate it before WAL configuration or any additive infra
        // migration so a reserved-name database reaches the collision-recovery
        // caller without a request-attributable storage mutation.
        let stored_schema = mode_inspection.active_manifest().cloned();
        if let Some(manifest) = &stored_schema {
            validate_schema(manifest)?;
        }
        let mut db = Self {
            conn,
            writer_authority: write_authority::WriterAuthorityV1::default(),
            path: Some(path.clone()),
            derived_fork,
            in_app_branch,
            schema: SchemaManifest::default(),
            reader_pool: None,
            replication_checkpoint_owner: crate::replication::configured_from_env(),
            authorization_interlock: None,
            service_authority_fences:
                crate::auth::service_fence::ServiceAuthorityFenceRegistry::default(),
            app_state_graph_claimed: false,
            projections: Arc::new(Vec::new()),
            order_field_bounds: Arc::new(BTreeMap::new()),
            sequence_declarations: Arc::new(BTreeMap::new()),
        };
        crate::operation_detail::install(&db.conn, Some(&path))?;
        db.configure(true)?;
        db.create_infra()?;
        // `_version` is a plain-JSON client cursor, not an arbitrary SQLite
        // integer. Refuse a negative or non-portable predecessor before this
        // database can publish a read lane or serve any request.
        // @ref LLP 0007#data-model — system versions share the exact portable
        // integer domain on every target.
        with_pinned_read_snapshot(&db.conn, |conn| {
            let head = current_version_on(conn)?;
            // A sibling writer may legitimately advance the head after the
            // mutation-free preflight and before this final snapshot. Validate
            // the complete current cut instead of misclassifying that commit as
            // corruption; malformed predecessor state was already refused
            // before any additive migration ran.
            // @ref LLP 0003#database-model — open validates both sides of
            // additive migration without requiring ordinary writers to stop.
            validate_existing_storage_ordering(conn, head)
        })?;
        db.schema = stored_schema.unwrap_or_default();
        if let Some(push_seam) = &db.schema.push_seam {
            // @ref LLP 0143#d1-device-token-custody — every reopened writer
            // re-arms physical deletion and refuses a non-exact protected
            // catalog before auth adoption can trust attached triggers.
            crate::push::require_secure_delete(&db.conn)?;
            crate::push::validate_exact_schema(&db.conn)?;
            if push_seam.ledger.is_some() {
                crate::push::validate_exact_ledger_schema(&db.conn)?;
            }
        }
        auth_mode::adopt_after_infra(&mut db, mode_inspection)?;
        db.writer_authority.set_schema(&db.schema)?;
        db.refresh_writer_authority_manifest()?;
        db.writer_authority.install(&db.conn)?;
        // The pool is created after configure/create_infra so readers open an
        // existing WAL database with the infra tables committed.
        db.reader_pool = Some(Arc::new(ReaderPool::new(
            path,
            db.replication_checkpoint_owner,
        )));
        Ok(db)
    }

    /// The WAL reader pool for lock-free read-lane queries; `None` for
    /// in-memory databases (no WAL, reads stay on the serialized write lane).
    ///
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6.
    pub fn reader_pool(&self) -> Option<Arc<ReaderPool>> {
        self.reader_pool.clone()
    }

    /// Drain every pooled reader before the replication owner performs its
    /// final ship-and-TRUNCATE sequence. No direct checkpoint is performed
    /// here; the celld-ltx `Db` still holds the checkpoint authority.
    pub(crate) fn prepare_replication_shutdown(&self) -> Vec<String> {
        self.reader_pool
            .as_ref()
            .map_or_else(Vec::new, |pool| pool.close_for_shutdown())
    }

    /// @ref LLP 0003#server-responsibilities — the server owes a checkpointed
    /// single-file store on graceful shutdown when file-backed. Pooled
    /// read-only connections outlive the writable one in `LocalDatabase`'s
    /// field order, so SQLite's close-time checkpoint never runs; drain the
    /// pool first, then checkpoint under an explicit bound.
    pub fn shutdown_checkpoint(&self, bound: Duration) -> ShutdownCheckpointReport {
        let Some(path) = self.path.as_ref() else {
            return ShutdownCheckpointReport {
                applicable: false,
                complete: true,
                busy_frames: None,
                wal_frames: None,
                checkpointed_frames: None,
                residual_wal_bytes: None,
                residual_shm_bytes: None,
                reader_errors: Vec::new(),
                errors: Vec::new(),
            };
        };

        if self.replication_checkpoint_owner {
            return ShutdownCheckpointReport {
                applicable: true,
                complete: false,
                busy_frames: None,
                wal_frames: None,
                checkpointed_frames: None,
                residual_wal_bytes: None,
                residual_shm_bytes: None,
                reader_errors: Vec::new(),
                errors: vec![
                    "replication owns WAL checkpointing; finalize the replication runtime first"
                        .to_owned(),
                ],
            };
        }

        let reader_errors = self
            .reader_pool
            .as_ref()
            .map_or_else(Vec::new, |pool| pool.close_for_shutdown());
        let mut report = ShutdownCheckpointReport {
            applicable: true,
            complete: false,
            busy_frames: None,
            wal_frames: None,
            checkpointed_frames: None,
            residual_wal_bytes: None,
            residual_shm_bytes: None,
            reader_errors,
            errors: Vec::new(),
        };

        let shutdown_maintenance = match self.writer_authority.enter_shutdown_maintenance() {
            Ok(token) => Some(token),
            Err(error) => {
                report.errors.push(format!(
                    "failed to enter shutdown maintenance authority: {error}"
                ));
                None
            }
        };

        // `Connection::busy_timeout` is the direct sqlite3_busy_timeout form
        // of `PRAGMA busy_timeout`; unlike preparing the pragma, it does not
        // needlessly widen the connection authorizer. rusqlite 0.32 accepts an
        // i32 millisecond bound, so clamp before constructing the Duration.
        let timeout_ms = bound.as_millis().min(i32::MAX as u128) as u64;
        if let Err(error) = self.conn.busy_timeout(Duration::from_millis(timeout_ms)) {
            report
                .errors
                .push(format!("failed to set shutdown busy timeout: {error}"));
        }

        match self
            .conn
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            }) {
            Ok((busy, wal, checkpointed)) => {
                report.busy_frames = Some(busy);
                report.wal_frames = Some(wal);
                report.checkpointed_frames = Some(checkpointed);
                if busy == 0 {
                    // DELETE mode releases the WAL and SHM while the writable
                    // connection is still open. The next file-backed open
                    // automatically re-enters WAL in `LocalDatabase::configure`.
                    match self
                        .conn
                        .query_row("PRAGMA journal_mode = DELETE", [], |row| {
                            row.get::<_, String>(0)
                        }) {
                        Ok(mode) if mode.eq_ignore_ascii_case("delete") => {}
                        Ok(mode) => report.errors.push(format!(
                            "shutdown journal mode remained {mode:?} instead of DELETE"
                        )),
                        Err(error) => report.errors.push(format!(
                            "failed to switch shutdown journal mode to DELETE: {error}"
                        )),
                    }
                } else {
                    report.errors.push(format!(
                        "checkpoint reported {busy} busy frame(s); journal_mode switch skipped"
                    ));
                }
            }
            Err(error) => report
                .errors
                .push(format!("shutdown WAL checkpoint failed: {error}")),
        }
        drop(shutdown_maintenance);

        let inspect_sidecar = |suffix: &str, errors: &mut Vec<String>| {
            let mut sidecar = path.as_os_str().to_os_string();
            sidecar.push(suffix);
            let sidecar = PathBuf::from(sidecar);
            match fs::metadata(&sidecar) {
                Ok(metadata) => (Some(metadata.len()), true),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (None, false),
                Err(error) => {
                    errors.push(format!(
                        "failed to inspect shutdown sidecar {}: {error}",
                        sidecar.display()
                    ));
                    (None, true)
                }
            }
        };
        let (residual_wal_bytes, wal_exists) = inspect_sidecar("-wal", &mut report.errors);
        let (residual_shm_bytes, shm_exists) = inspect_sidecar("-shm", &mut report.errors);
        report.residual_wal_bytes = residual_wal_bytes;
        report.residual_shm_bytes = residual_shm_bytes;
        report.complete = report.busy_frames == Some(0)
            && !wal_exists
            && !shm_exists
            && report.reader_errors.is_empty()
            && report.errors.is_empty();
        report
    }

    /// Capture an owned, in-memory read snapshot for detached handler
    /// execution when the live database has no WAL reader pool (`:memory:`).
    /// The backup runs while the caller holds the short instance lock; handler
    /// JavaScript runs only after this owned copy has been returned.
    ///
    /// @ref LLP 0028#execution-the-action-class — ENG-24340 isolates nested
    /// mutation execution from the live in-memory write connection.
    pub(crate) fn detached_read_snapshot(&self) -> SnapbackResult<Self> {
        let mut conn = Connection::open_in_memory()?;
        {
            let backup = rusqlite::backup::Backup::new(&self.conn, &mut conn)?;
            backup.run_to_completion(128, std::time::Duration::from_millis(1), None)?;
        }
        let restored = Self {
            conn,
            writer_authority: write_authority::WriterAuthorityV1::default(),
            path: None,
            derived_fork: self.derived_fork.clone(),
            in_app_branch: self.in_app_branch.clone(),
            schema: self.schema.clone(),
            reader_pool: None,
            replication_checkpoint_owner: false,
            authorization_interlock: None,
            service_authority_fences:
                crate::auth::service_fence::ServiceAuthorityFenceRegistry::default(),
            app_state_graph_claimed: false,
            projections: Arc::new(Vec::new()),
            order_field_bounds: self.order_field_bounds.clone(),
            sequence_declarations: self.sequence_declarations.clone(),
        };
        validate_sequence_activation(
            &restored.conn,
            &restored.schema,
            restored.sequence_declarations.as_ref(),
        )?;
        restored.writer_authority.set_schema(&restored.schema)?;
        restored.refresh_writer_authority_manifest()?;
        restored.writer_authority.install(&restored.conn)?;
        Ok(restored)
    }

    pub(crate) fn install_authorization_interlock(
        &mut self,
        interlock: Arc<dyn AuthorizationCommitInterlock>,
    ) {
        self.authorization_interlock = Some(interlock);
    }

    pub(crate) fn service_authority_fence_registry(
        &self,
    ) -> crate::auth::service_fence::ServiceAuthorityFenceRegistry {
        self.service_authority_fences.clone()
    }

    pub(crate) fn claim_app_state_graph(&mut self) -> bool {
        if self.app_state_graph_claimed {
            false
        } else {
            self.app_state_graph_claimed = true;
            true
        }
    }

    pub fn schema(&self) -> &SchemaManifest {
        &self.schema
    }

    /// File-backed databases publish their canonical storage path to sibling
    /// system stores (notably the auth keyring); memory databases return None.
    /// This does not expose the SQLite connection or an app-data escape hatch.
    #[allow(dead_code)] // Consumed by the ENG-24596 keyring integration lane.
    pub(crate) fn database_path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    pub fn info(&self) -> SnapbackResult<StorageInfo> {
        Ok(StorageInfo {
            sqlite_path: self.path.clone(),
            version: self.current_version()?,
            tables: self
                .schema
                .tables
                .iter()
                .map(|table| table.name.clone())
                .collect(),
            client_mutation_retention: self.settlement_read().client_mutation_retention_info()?,
        })
    }

    pub(crate) fn operation_lane_covered(&self, lane: &str) -> SnapbackResult<bool> {
        let Some(stream_id) = crate::seed_identity::strict_current_data_version_stream(&self.conn)?
        else {
            return Ok(false);
        };
        Ok(
            crate::operation_ledger::active_coverage_manifest(&self.conn, &stream_id)?
                .is_some_and(|manifest| manifest.covered_lanes.iter().any(|value| value == lane)),
        )
    }

    fn refresh_writer_authority_manifest(&self) -> SnapbackResult<()> {
        let manifest = registered_writer_coverage_manifest(&self.conn, self.path.as_deref())?;
        self.writer_authority.set_manifest(manifest)
    }

    fn local_writer_coverage_inventory(
        &self,
    ) -> SnapbackResult<write_authority::LocalWriterCoverageInventoryV1> {
        self.writer_authority.inventory(self)
    }

    /// The app-effective capability projection consumes only the exact
    /// production activation cut: two logical lanes and all four physical
    /// adapters. A subset, superset, test manifest, or stale in-memory writer
    /// authority stays false.
    ///
    /// @ref LLP 0162#acceptance — row 4 requires the closed writer inventory;
    /// app-effective coverage is an intersection with this exact active cut,
    /// never an inference from target support.
    pub(crate) fn agent_safe_exact_operation_coverage_active(&self) -> SnapbackResult<bool> {
        let Some(stream_id) = crate::seed_identity::strict_current_data_version_stream(&self.conn)?
        else {
            return Ok(false);
        };
        let Some(manifest) =
            crate::operation_ledger::active_coverage_manifest(&self.conn, &stream_id)?
        else {
            return Ok(false);
        };
        let expected_lanes = [
            crate::operation_ledger::ORDINARY_MUTATION_LANE_V1,
            crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1,
        ]
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
        let declared_lanes = manifest
            .covered_lanes
            .iter()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>();
        let expected_writers = crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1
            .into_iter()
            .chain(crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1)
            .collect::<std::collections::BTreeSet<_>>();
        let declared_writers = manifest
            .writer_choke_points
            .iter()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>();
        if manifest.covered_lanes.len() != expected_lanes.len()
            || declared_lanes != expected_lanes
            || manifest.writer_choke_points.len() != expected_writers.len()
            || declared_writers != expected_writers
        {
            return Ok(false);
        }

        let inventory = self.local_writer_coverage_inventory()?;
        if inventory.manifest_version.is_none()
            || !inventory.all_physical_writers_enumerated
            || !inventory.all_app_effective_writers_accounted
        {
            return Ok(false);
        }
        let active = inventory
            .entries
            .iter()
            .filter(|entry| entry.declared_covered)
            .map(|entry| (entry.lane, entry.choke_point))
            .collect::<std::collections::BTreeSet<_>>();
        let expected = [
            (
                crate::operation_ledger::ORDINARY_MUTATION_LANE_V1,
                crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1[0],
            ),
            (
                crate::operation_ledger::ORDINARY_MUTATION_LANE_V1,
                crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1[1],
            ),
            (
                crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1,
                crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1[0],
            ),
            (
                crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1,
                crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1[1],
            ),
        ]
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
        Ok(active == expected
            && inventory
                .entries
                .iter()
                .filter(|entry| entry.declared_covered)
                .all(|entry| entry.envelope_mapped && entry.write_authority_enforced))
    }

    /// Verify the exact derived-fork journal-authority cut without projecting
    /// it as LLP 0163 operation-envelope coverage. The logical manifest lanes
    /// are fork-specific; the physical adapter set is the same closed set of
    /// four generated app-row writers enforced by SQLite.
    pub(crate) fn derived_fork_exact_app_row_journal_coverage_active(
        &self,
    ) -> SnapbackResult<bool> {
        let Some(stream_id) = crate::seed_identity::strict_current_data_version_stream(&self.conn)?
        else {
            return Ok(false);
        };
        let Some(manifest) =
            crate::operation_ledger::active_coverage_manifest(&self.conn, &stream_id)?
        else {
            return Ok(false);
        };
        let expected_lanes = [
            crate::operation_ledger::DERIVED_FORK_ORDINARY_APP_ROW_JOURNAL_LANE_V1,
            crate::operation_ledger::DERIVED_FORK_HOST_CHILD_APP_ROW_JOURNAL_LANE_V1,
        ]
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
        let declared_lanes = manifest
            .covered_lanes
            .iter()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>();
        let expected_writers = crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1
            .into_iter()
            .chain(crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1)
            .collect::<std::collections::BTreeSet<_>>();
        let declared_writers = manifest
            .writer_choke_points
            .iter()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>();
        if manifest.covered_lanes.len() != expected_lanes.len()
            || declared_lanes != expected_lanes
            || manifest.writer_choke_points.len() != expected_writers.len()
            || declared_writers != expected_writers
        {
            return Ok(false);
        }

        let inventory = self.local_writer_coverage_inventory()?;
        if inventory.manifest_version.is_none()
            || !inventory.all_physical_writers_enumerated
            || !inventory.all_app_effective_writers_accounted
        {
            return Ok(false);
        }
        let active = inventory
            .entries
            .iter()
            .filter(|entry| entry.declared_covered)
            .map(|entry| (entry.lane, entry.choke_point))
            .collect::<std::collections::BTreeSet<_>>();
        let expected = [
            (
                crate::operation_ledger::ORDINARY_MUTATION_LANE_V1,
                crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1[0],
            ),
            (
                crate::operation_ledger::ORDINARY_MUTATION_LANE_V1,
                crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1[1],
            ),
            (
                crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1,
                crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1[0],
            ),
            (
                crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1,
                crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1[1],
            ),
        ]
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
        Ok(active == expected
            && inventory
                .entries
                .iter()
                .filter(|entry| entry.declared_covered)
                .all(|entry| entry.envelope_mapped && entry.write_authority_enforced))
    }

    #[cfg(test)]
    pub(crate) fn execute_out_of_seam_app_sql_for_test(
        &self,
        sql: &str,
    ) -> rusqlite::Result<usize> {
        self.conn.execute(sql, [])
    }

    #[cfg(test)]
    fn local_writer_coverage_inventory_for_test(
        &self,
    ) -> SnapbackResult<write_authority::LocalWriterCoverageInventoryV1> {
        self.local_writer_coverage_inventory()
    }

    pub(crate) fn current_data_version_stream(&self) -> SnapbackResult<String> {
        crate::seed_identity::strict_current_data_version_stream(&self.conn)?.ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_OPERATION_STREAM_UNAVAILABLE",
                "storage",
                "managed branch creation requires an initialized canonical data-version stream",
            )
        })
    }

    #[cfg(test)]
    pub(crate) fn initialize_data_version_stream_for_test(&mut self) -> SnapbackResult<String> {
        let tx = self.conn.transaction()?;
        let stream_id = auth_invalidation::ensure_data_version_stream_in(&tx)?;
        tx.commit()?;
        Ok(stream_id)
    }

    #[cfg(test)]
    pub(crate) fn install_operation_coverage_for_test(
        &mut self,
        mut lanes: Vec<String>,
        mut writers: Vec<String>,
    ) -> SnapbackResult<()> {
        lanes.sort();
        lanes.dedup();
        writers.sort();
        writers.dedup();
        let manifest = {
            let _writer = self
                .writer_authority
                .enter(write_authority::LocalWriterLaneV1::OperationLedger)?;
            let tx = self.conn.transaction()?;
            let stream_id = auth_invalidation::ensure_data_version_stream_in(&tx)?;
            let manifest_version: i64 = tx.query_row(
                "SELECT COALESCE(MAX(manifest_version), 0) + 1
                 FROM _snapback_operation_coverage_v1",
                [],
                |row| row.get(0),
            )?;
            let manifest_version = u64::try_from(manifest_version).map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_OPERATION_COVERAGE_INVALID",
                    "storage",
                    "test coverage manifest version overflowed",
                )
            })?;
            let manifest = crate::commit_envelope::OperationCoverageManifestV1 {
                schema_version: 1,
                manifest_version,
                stream_id: stream_id.clone(),
                covered_lanes: lanes.clone(),
                writer_choke_points: writers.clone(),
                coverage_digest: crate::operation_ledger::coverage_digest(
                    &stream_id,
                    manifest_version,
                    &lanes,
                    &writers,
                ),
            };
            crate::operation_ledger::register_coverage_in(&tx, &manifest, now_millis())?;
            tx.commit()?;
            manifest
        };
        self.writer_authority.arm_manifest(&self.conn, manifest)?;
        Ok(())
    }

    /// Resume an interrupted migration-cleanup tail at reopen (LLP 0081
    /// §4: a crash after release reopens only the successor and resumes
    /// cleanup). Inventory-driven — no artifact required.
    pub(crate) fn resume_pending_migration_cleanup(&mut self) -> SnapbackResult<Option<Value>> {
        let _writer_token = self
            .writer_authority
            .enter(write_authority::LocalWriterLaneV1::MigrationExecutor)?;
        let schema = self.schema.clone();
        migration_executor::resume_pending_cleanup(&mut self.conn, &schema)
    }

    /// Install the active maintained-projection set (LLP 0080 §5). Called by
    /// function-manifest activation after validation; every mutation path on
    /// this database maintains these outputs in its own commit.
    pub(crate) fn set_projections(
        &mut self,
        plans: Vec<crate::manifest::MaintainedProjectionPlan>,
    ) {
        self.projections = Arc::new(plans);
    }

    /// Refuse adoption when existing rows already exceed a newly declared
    /// order-field ceiling. This is deliberately read-only; callers install
    /// the map only after the complete function generation passes preflight.
    pub(crate) fn validate_order_field_bounds(
        &self,
        bounds: &BTreeMap<(String, String), u64>,
    ) -> SnapbackResult<()> {
        for ((table, field), maximum) in bounds {
            let oversized = self
                .conn
                .query_row(
                    &format!(
                        "SELECT _id FROM {} WHERE {} IS NOT NULL AND length(CAST({} AS BLOB)) > ?1 LIMIT 1",
                        quote_ident(table)?,
                        quote_ident(field)?,
                        quote_ident(field)?,
                    ),
                    params![i64::try_from(*maximum).map_err(|_| {
                        SnapbackError::error(
                            "SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID",
                            "runtime",
                            format!(
                                "order-field bound for {table}.{field} exceeds the SQLite integer domain"
                            ),
                        )
                    })?],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if let Some(row_id) = oversized {
                return Err(order_field_max_encoded_bytes_exceeded(
                    table, field, &row_id, *maximum,
                ));
            }
        }
        Ok(())
    }

    /// Refuse sequence activation over brownfield scope rows until every
    /// present row has exactly one active LLP 0110 incarnation and no active
    /// registry row points at a missing scope. New central-writer inserts
    /// already mint these facts; this gate makes adoption of older rows
    /// explicit instead of silently blessing them.
    ///
    /// @ref LLP 0135#11-counter-identity-and-scope — declaring a counter
    ///   enrolls its scope in the shared relation-incarnation authority, and
    ///   brownfield rows require reviewed backfill before activation.
    pub(crate) fn validate_sequence_scope_activation(
        &self,
        scope_tables: &BTreeSet<String>,
    ) -> SnapbackResult<()> {
        for table in scope_tables {
            let table_sql = quote_ident(table)?;
            let missing_or_duplicate_active = self
                .conn
                .query_row(
                    &format!(
                        "SELECT s._id
                           FROM {table_sql} s
                      LEFT JOIN _snapback_relation_incarnations_v1 r
                             ON r.table_name = ?1
                            AND r.row_id = s._id
                            AND r.active = 1
                       GROUP BY s._id
                         HAVING count(r.incarnation) != 1
                          LIMIT 1"
                    ),
                    params![table],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if let Some(row_id) = missing_or_duplicate_active {
                return Err(SnapbackError::error(
                    "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED",
                    "schema",
                    "each sequence scope row must have exactly one active incarnation",
                )
                .with_details(json!({
                    "scopeTable": table,
                    "rowId": row_id,
                    "direction": "scope-to-registry",
                })));
            }

            let dangling_active = self
                .conn
                .query_row(
                    &format!(
                        "SELECT r.row_id
                           FROM _snapback_relation_incarnations_v1 r
                      LEFT JOIN {table_sql} s ON s._id = r.row_id
                          WHERE r.table_name = ?1
                            AND r.active = 1
                            AND s._id IS NULL
                          LIMIT 1"
                    ),
                    params![table],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if let Some(row_id) = dangling_active {
                return Err(SnapbackError::error(
                    "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED",
                    "schema",
                    "an active sequence scope incarnation has no present row",
                )
                .with_details(json!({
                    "scopeTable": table,
                    "rowId": row_id,
                    "direction": "registry-to-scope",
                })));
            }
            validate_active_sequence_scope_fact_grammar(&self.conn, table)?;
        }
        Ok(())
    }

    /// Pure activation preflight used before projection rebuilds. Missing
    /// markers are provisionally admissible only for an already-active
    /// predecessor scope or a physically empty table; the final installer
    /// persists that authority transactionally after all other preflight work.
    pub(crate) fn validate_sequence_declaration_preflight(
        &self,
        declarations: &BTreeMap<String, crate::manifest::SequenceDeclaration>,
        trusted_active_generation: bool,
    ) -> SnapbackResult<()> {
        let mut predecessor_tables = BTreeSet::new();
        let successor_tables = sequence_scope_tables_from_declarations(declarations);
        if trusted_active_generation {
            predecessor_tables.extend(sequence_scope_tables_from_declarations(
                &self.sequence_declarations,
            ));
            predecessor_tables.extend(successor_tables.iter().copied());
        }
        for table in &successor_tables {
            let enrolled = self
                .conn
                .query_row(
                    "SELECT 1 FROM _snapback_sequence_scope_enrollments_v1 WHERE table_name = ?1",
                    params![table],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if !enrolled
                && !predecessor_tables.contains(table)
                && !schema_relation_parent_tables(&self.schema).contains(table)
            {
                let existing_rows = self.conn.query_row(
                    &format!("SELECT COUNT(*) FROM {}", quote_ident(table)?),
                    [],
                    |row| row.get::<_, i64>(0),
                )?;
                if existing_rows != 0 {
                    return Err(SnapbackError::error(
                        "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED",
                        "schema",
                        "a newly enrolled sequence scope has pre-existing rows without reviewed backfill authority",
                    )
                    .with_details(json!({
                        "parentTable": table,
                        "existingRows": existing_rows,
                        "enrollmentMarker": false,
                    })));
                }
            }
        }
        self.validate_sequence_scope_activation(
            &successor_tables
                .into_iter()
                .map(ToOwned::to_owned)
                .collect(),
        )?;
        validate_sequence_counter_rows(&self.conn, declarations)
    }

    pub(crate) fn set_order_field_bounds(&mut self, bounds: BTreeMap<(String, String), u64>) {
        self.order_field_bounds = Arc::new(bounds);
    }

    #[allow(dead_code)] // retained kernel surface; the staged sequence-declaration callers land next
    pub(crate) fn install_sequence_declarations(
        &mut self,
        declarations: BTreeMap<String, crate::manifest::SequenceDeclaration>,
        trusted_active_generation: bool,
    ) -> SnapbackResult<()> {
        let (predecessor, trusted_relation_parent_tables) =
            self.sequence_activation_predecessor(&declarations, trusted_active_generation);
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        preflight_sequence_enrollments(
            &tx,
            &self.schema,
            &trusted_relation_parent_tables,
            &predecessor,
            &declarations,
        )?;
        validate_sequence_activation(&tx, &self.schema, &declarations)?;
        tx.commit()?;
        self.install_committed_sequence_declarations(declarations);
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn sequence_scope_enrollment_count(&self) -> SnapbackResult<u64> {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM _snapback_sequence_scope_enrollments_v1",
                [],
                |row| row.get(0),
            )
            .map_err(SnapbackError::from)
    }

    /// Admit one approved exact-vector generation rebuild against the active
    /// schema. The executor owns its fixed snapshot and journal-floor lease;
    /// application mutations remain on their ordinary transaction path.
    pub fn begin_vector_rebuild(
        &mut self,
        plan: &crate::vector::VectorRebuildPlanV1,
        approval: &crate::migration::MigrationApprovalV1,
        now_ms: u64,
    ) -> SnapbackResult<crate::vector::VectorRebuildProgressV1> {
        crate::vector::rebuild::begin_rebuild(&mut self.conn, &self.schema, plan, approval, now_ms)
    }

    pub fn resume_vector_rebuild(
        &mut self,
        operation_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::vector::VectorRebuildProgressV1> {
        crate::vector::rebuild::resume_rebuild(&mut self.conn, &self.schema, operation_id, now_ms)
    }

    pub fn activate_vector_rebuild(
        &mut self,
        operation_id: &str,
    ) -> SnapbackResult<crate::vector::VectorRebuildReceiptV1> {
        crate::vector::rebuild::activate_rebuild(&mut self.conn, &self.schema, operation_id)
    }

    pub fn rollback_vector_generation(
        &mut self,
        table: &str,
        index: &str,
    ) -> SnapbackResult<crate::vector::VectorRebuildReceiptV1> {
        crate::vector::rebuild::rollback_generation(&mut self.conn, &self.schema, table, index)
    }

    pub fn inspect_vector_rebuild(
        &self,
        operation_id: &str,
    ) -> SnapbackResult<crate::vector::VectorRebuildProgressV1> {
        crate::vector::rebuild::inspect_rebuild(&self.conn, operation_id)
    }

    #[cfg(test)]
    pub(crate) fn inject_vector_release_drift_for_test(
        &mut self,
        table: &str,
        row_id: &str,
    ) -> SnapbackResult<()> {
        let next = next_storage_version(current_version_on(&self.conn)?)?;
        let table = quote_ident(table)?;
        let tx = self.conn.transaction()?;
        let changed = tx.execute(
            &format!("UPDATE {table} SET \"_version\"=?2 WHERE \"_id\"=?1"),
            params![row_id, version_to_sql_integer(next)?],
        )?;
        if changed != 1 {
            return Err(crate::vector::diagnostics::index_corrupt());
        }
        set_version(&tx, next)?;
        tx.commit()?;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn vector_generation_status_for_test(
        &self,
        table: &str,
        index: &str,
    ) -> SnapbackResult<String> {
        self.conn
            .query_row(
                "SELECT status FROM _snapback_vector_generations
                 WHERE table_name=?1 AND index_name=?2
                 ORDER BY generation DESC LIMIT 1",
                params![table, index],
                |row| row.get(0),
            )
            .map_err(SnapbackError::from)
    }

    /// Quarantine only the generation named by a failed pinned vector read.
    /// Callers invoke this after `with_pinned_read_view` returns, never while
    /// the read transaction that detected corruption is still open.
    pub(crate) fn quarantine_vector_generation(
        &self,
        identity: &crate::vector::sqlite::VectorGenerationIdentity,
    ) -> SnapbackResult<bool> {
        crate::vector::sqlite::quarantine_generation_on(
            &self.conn,
            identity,
            "same-snapshot vector release recheck failed",
        )
    }

    pub(crate) fn room_permission_projection_granted(
        &self,
        table_name: &str,
        subject_field: &str,
        user_id: &str,
        scope_fields: &[(String, String)],
        min_commit_version: u64,
    ) -> SnapbackResult<bool> {
        room_permission_projection_granted_on(
            &self.conn,
            &self.schema,
            table_name,
            subject_field,
            user_id,
            scope_fields,
            min_commit_version,
        )
    }

    pub fn generate_id(&self) -> String {
        new_id()
    }

    pub(in crate::storage) fn replayed_mutation_commit(
        &self,
        identity: &ClientMutationIdentity,
    ) -> SnapbackResult<Option<MutationCommit>> {
        Ok(self
            .settlement_read()
            .client_mutation_result(identity)?
            .map(|output| {
                let sequence_allocations = output.settlement_sequence_allocations.clone();
                MutationCommit {
                    output,
                    changes: Vec::new(),
                    read_dependencies: Vec::new(),
                    write_dependencies: Vec::new(),
                    job_enqueues: Vec::new(),
                    job_changes: Vec::new(),
                    asset_changes: Vec::new(),
                    sequence_allocations,
                    authorization: None,
                    authority_transitions: Vec::new(),
                    network_egress: Default::default(),
                }
            }))
    }

    /// A same-id writer can settle after the optimistic replay lookup but
    /// before this connection acquires SQLite's write transaction. The losing
    /// transaction rolls back at the unique settlement row; turn that race into
    /// the exact durable replay promised by the mutation identity contract.
    ///
    /// @ref LLP 0135#14-idempotent-re-allocation — sequential and concurrent
    ///   duplicate deliveries must replay the same allocated value byte-for-byte.
    pub(in crate::storage) fn replay_after_concurrent_settlement(
        &self,
        identity: &ClientMutationIdentity,
        attempted_error: SnapbackError,
    ) -> SnapbackResult<MutationCommit> {
        match self.replayed_mutation_commit(identity)? {
            Some(commit) => Ok(commit),
            None => Err(attempted_error),
        }
    }

    #[cfg(test)]
    fn execute_mutation_plan_with_lifecycle<G, Check, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        apply: bool,
        identity: Option<&ClientMutationIdentity>,
        check_live: &Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationPlanExecution>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.execute_mutation_plan_with_lifecycle_and_settlement_time(
            if apply {
                write_authority::LocalWriterLaneV1::OrdinaryHostPlan
            } else {
                write_authority::LocalWriterLaneV1::DryRun
            },
            plan,
            input,
            apply,
            identity,
            None,
            None,
            None,
            check_live,
            before_commit,
        )
    }

    // The lifecycle callbacks and settlement policy remain distinct because
    // they guard different commit phases and are independently fault-injected.
    #[allow(clippy::too_many_arguments)]
    pub(in crate::storage) fn execute_mutation_plan_with_lifecycle_and_settlement_time<
        G,
        Check,
        BeforeCommit,
    >(
        &mut self,
        writer_lane: write_authority::LocalWriterLaneV1,
        plan: &MutationPlan,
        input: &HandlerInput,
        apply: bool,
        identity: Option<&ClientMutationIdentity>,
        media_command: Option<&crate::manifest::ResolvedMediaCommandV1>,
        settlement_time: Option<&SettlementTimePolicy>,
        branch_operation: Option<&crate::fork_promotion::BranchMutationCommitV1>,
        check_live: &Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationPlanExecution>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        crate::exec_guard::debug_assert_off_async_worker("a SQLite mutation");
        check_live()?;
        let _writer_token = self.writer_authority.enter(writer_lane)?;
        // @ref LLP 0003#execution-and-write-semantics — one mutation commits all buffered writes at one version.
        let schema = self.schema.clone();
        let projections = self.projections.clone();
        let projection_sources: BTreeSet<String> = projections
            .iter()
            .flat_map(|plan| [plan.root.clone(), plan.joined.clone()])
            .collect();
        // First-touch pre-images of projection-source rows (LLP 0080 §5):
        // the affected-key set closes over the mutation pre-image and the
        // final post-image, so key values that exist only transiently
        // inside the transaction never select an output row.
        let mut projection_pre_images: BTreeMap<(String, String), Option<Map<String, Value>>> =
            BTreeMap::new();
        let replay_ledger = validate_plan_replay_ledger(input)?;
        let now_ms = replay_ledger
            .as_ref()
            .map(|ledger| ledger.now)
            .unwrap_or_else(now_millis);
        validate_portable_timestamp_millis(now_ms)?;
        let settlement_time_skew = settlement_time.map(|policy| now_ms.abs_diff(policy.claimed));
        let settlement_time_within_bound = settlement_time_skew
            .zip(settlement_time)
            .is_some_and(|(skew, policy)| skew <= policy.max_skew_ms);
        let settlement_time_sink_reached = Cell::new(false);
        let authorization_interlock = self.authorization_interlock.clone();
        let enforce_canonical_promotion_reservation =
            self.derived_fork.is_none() && self.in_app_branch.is_none();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        // @ref LLP 0081#4-execution-journaling-and-crash-recovery — the
        //   persisted migration fence closes the mutation lane durably: it
        //   is re-read inside every commit transaction, so a crash between
        //   reopen and resume cannot readmit application writes.
        migration_executor::ensure_migration_fence_open(&tx)?;
        if enforce_canonical_promotion_reservation
            && let Some(stream_id) = crate::seed_identity::strict_current_data_version_stream(&tx)?
        {
            crate::fork_promotion::enforce_canonical_mutation_admission_in(
                &tx,
                &stream_id,
                now_ms as i64,
            )?;
        }
        let current_version = current_version_on(&tx)?;
        #[cfg(test)]
        notify_commit_version_sampled(&tx);
        let next_version = next_storage_version(current_version)?;

        // @ref LLP 0032#phase-2--execution-semantics-honesty — E3 (Option A),
        // ratified-and-extended by LLP 0051 D2: the client-supplied read_set
        // remains the isolation baseline for *plain* plans (their reads happened
        // on the client, so the client declares the baseline and the server
        // enforces it atomically here). Since `Get`/`Guard` landed, a plan is no
        // longer necessarily an unconditional write sequence — plan `Get` reads
        // execute inside this same transaction (they can never be stale relative
        // to the commit, so they need no conflict validation) and are captured
        // server-side into `read_dependencies` for receipts and derived
        // overlays. (Ibex handlers still differ: they read → await → commit
        // across an async window, so their reads are captured server-side and
        // validated in `commit_buffered_writes`.)
        validate_read_set(&tx, &schema, &input.read_set, current_version)?;

        // Fail closed on bounds/profile violations before any step executes.
        crate::value_expr::validate_mutation_plan(plan)?;

        // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
        //   HostPlan cannot authorize a membership write in v1: every generic
        //   form (`Insert`/`Patch`/`Delete`/`DeleteWhere`/`InsertEach`) targeting
        //   a declared membership table is refused, typed, before any step runs.
        //   This path also serves dry-run (apply=false) and nested
        //   action->mutation, so the refusal covers both by construction.
        let mut touched_tables = BTreeSet::new();
        let mut seen_owner_checks = BTreeSet::new();
        for (step_index, step) in plan.steps.iter().enumerate() {
            let target = match step {
                MutationStep::AssetCollection(plan) => Some(plan.child_table.as_str()),
                MutationStep::Insert { table, .. }
                | MutationStep::Patch { table, .. }
                | MutationStep::Delete { table, .. }
                | MutationStep::DeleteWhere { table, .. }
                | MutationStep::InsertEach { table, .. }
                | MutationStep::Get { table, .. }
                | MutationStep::AssertCurrentRelation { table, .. }
                | MutationStep::AssertSourceChanged { table, .. } => Some(table.as_str()),
                MutationStep::AllocateSequence { .. }
                | MutationStep::Guard { .. }
                | MutationStep::Let { .. } => None,
            };
            if let Some(target) = target {
                if matches!(
                    step,
                    MutationStep::AssetCollection(_)
                        | MutationStep::Insert { .. }
                        | MutationStep::Patch { .. }
                        | MutationStep::Delete { .. }
                        | MutationStep::DeleteWhere { .. }
                        | MutationStep::InsertEach { .. }
                ) {
                    enforce_identity_binding_write_seal(&schema, target)?;
                }
                if matches!(
                    step,
                    MutationStep::Insert { .. }
                        | MutationStep::Patch { .. }
                        | MutationStep::Delete { .. }
                        | MutationStep::DeleteWhere { .. }
                        | MutationStep::InsertEach { .. }
                ) && schema
                    .asset_collections
                    .iter()
                    .any(|collection| collection.child_table == target)
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_MEDIA_COLLECTION_RAW_WRITE_REFUSED",
                        "asset-collection",
                        format!(
                            "generic HostPlan writes cannot target framework-owned collection table {target}"
                        ),
                    ));
                }
                touched_tables.insert(target.to_owned());
                let generic_form = match step {
                    MutationStep::Insert { .. } => Some(GenericTableWriteFormV1::Insert),
                    MutationStep::InsertEach { .. } => Some(GenericTableWriteFormV1::InsertEach),
                    MutationStep::Patch { .. } => Some(GenericTableWriteFormV1::Patch),
                    MutationStep::Delete { .. } => Some(GenericTableWriteFormV1::Delete),
                    MutationStep::DeleteWhere { .. } => Some(GenericTableWriteFormV1::DeleteWhere),
                    MutationStep::AssetCollection(_)
                    | MutationStep::AllocateSequence { .. }
                    | MutationStep::Get { .. }
                    | MutationStep::Guard { .. }
                    | MutationStep::AssertCurrentRelation { .. }
                    | MutationStep::Let { .. }
                    | MutationStep::AssertSourceChanged { .. } => None,
                };
                if let Some(form) = generic_form {
                    let table = schema_table(&schema, target)?;
                    // The generic owner dispatcher deliberately yields no
                    // field for authority tables. Preserve the declaration-
                    // owned HostPlan refusal before entering ordinary-table
                    // policy enforcement.
                    //
                    // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default
                    // @ref LLP 0264#d6-authority-tables-and-membershiprole-writes-stay-specialized
                    if table.membership.is_some() {
                        return Err(membership_hostplan_write_denied(target));
                    }
                    if let Some(owner_field) = generic_owner_write_field(table, form)? {
                        match step {
                            MutationStep::Insert { values, .. }
                            | MutationStep::InsertEach { values, .. } => {
                                if let Some(owner) = values.get(owner_field)
                                    && !matches!(owner, ValueExpr::AuthUserId)
                                {
                                    return Err(SnapbackError::error(
                                        "SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED",
                                        "auth",
                                        "HostPlan owner input must be omitted or use the sealed AuthUserId marker",
                                    )
                                    .with_details(json!({
                                        "table": table.name,
                                        "writeForm": form.as_str(),
                                        "ownerField": owner_field,
                                        "stepIndex": step_index,
                                    })));
                                }
                            }
                            MutationStep::Patch { values, .. } => {
                                if values.contains_key(owner_field) {
                                    return Err(SnapbackError::error(
                                        "SNAPBACK_TABLE_WRITE_OWNER_IMMUTABLE",
                                        "auth",
                                        "generic patches cannot change owner identity",
                                    )
                                    .with_details(json!({
                                        "table": table.name,
                                        "writeForm": form.as_str(),
                                        "ownerField": owner_field,
                                        "stepIndex": step_index,
                                    })));
                                }
                                let MutationStep::Patch { id, .. } = step else {
                                    unreachable!()
                                };
                                if !id.owner_write_check_preflight_safe() {
                                    return Err(SnapbackError::error(
                                        "SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE",
                                        "auth",
                                        "ownerWriteCheck target must be resolvable before plan bindings and observations",
                                    )
                                    .with_details(json!({
                                        "table": table.name,
                                        "writeForm": form.as_str(),
                                        "stepIndex": step_index,
                                    })));
                                }
                                seen_owner_checks.insert(step_index);
                            }
                            MutationStep::Delete { id, .. } => {
                                if !id.owner_write_check_preflight_safe() {
                                    return Err(SnapbackError::error(
                                        "SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE",
                                        "auth",
                                        "ownerWriteCheck target must be resolvable before plan bindings and observations",
                                    )
                                    .with_details(json!({
                                        "table": table.name,
                                        "writeForm": form.as_str(),
                                        "stepIndex": step_index,
                                    })));
                                }
                                seen_owner_checks.insert(step_index);
                            }
                            MutationStep::DeleteWhere { .. }
                            | MutationStep::AssetCollection(_)
                            | MutationStep::AllocateSequence { .. }
                            | MutationStep::Get { .. }
                            | MutationStep::Guard { .. }
                            | MutationStep::AssertCurrentRelation { .. }
                            | MutationStep::Let { .. }
                            | MutationStep::AssertSourceChanged { .. } => {}
                        }
                    }
                }
            }
        }
        let mut declared_owner_checks = BTreeSet::new();
        for check in &plan.owner_write_checks {
            if !declared_owner_checks.insert(check.step_index)
                || !seen_owner_checks.contains(&check.step_index)
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE",
                    "auth",
                    "ownerWriteChecks must bind exactly one owner-policy Patch or Delete step",
                )
                .with_details(json!({ "stepIndex": check.step_index })));
            }
            if let OwnerWriteAbsentDispositionV1::Refuse {
                code,
                message,
                details,
                digest,
            } = &check.absent
                && (code.is_empty()
                    || owner_write_disposition_digest(code, message, details)? != *digest)
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE",
                    "auth",
                    "ownerWriteChecks refusal bytes do not match their digest",
                )
                .with_details(json!({ "stepIndex": check.step_index })));
            }
        }
        if declared_owner_checks != seen_owner_checks {
            return Err(SnapbackError::error(
                "SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE",
                "auth",
                "every owner-policy Patch and Delete needs one sealed ownerWriteCheck",
            )
            .with_details(json!({
                "expectedStepIndexes": seen_owner_checks,
                "declaredStepIndexes": declared_owner_checks,
            })));
        }
        if let Some(media) = media_command {
            touched_tables.insert(media.binding.collection.owner_table.clone());
            touched_tables.insert(media.binding.collection.child_table.clone());
            if let crate::manifest::AssetCollectionSharingPlanV1::Derived { table, .. } =
                &media.binding.sharing.plan
            {
                touched_tables.insert(table.clone());
            }
        }
        // Validate every pre-existing row the plan can read, select, patch, or
        // delete before the first step writes at `next_version`. An already
        // forged row exactly at that successor must not become
        // indistinguishable from a legitimate row inserted earlier in this
        // transaction.
        validate_touched_managed_tables(&tx, &schema, &touched_tables, current_version)?;

        let mut bindings = BTreeMap::new();
        let direct_input = input.auth.direct_authorization_baseline().map(|auth| {
            let mut direct = input.clone();
            direct.auth = auth;
            direct
        });
        let mut direct_bindings = direct_input.as_ref().map(|_| BTreeMap::new());
        let mut changes = Vec::new();
        // A no-effect owner check installs an identical-absent view for the
        // remainder of the plan. Every same-target observer consults this set
        // before storage, so a present foreign row cannot reappear after the
        // checked write normalized it to absence.
        //
        // @ref LLP 0264#d4-update-and-delete-check-the-old-row-transactionally
        let mut owner_absent_targets = BTreeSet::<(String, String)>::new();
        let mut sequence_allocation_facts = Vec::new();
        let mut read_dependencies: Vec<CapturedReadDependency> = Vec::new();
        // Every host-generated id in answer order — the IR half of the
        // ctx-answer ledger (LLP 0051 D1's `generatedIds`), reported by
        // dry-run as `deterministicInputs`.
        let plan_ids = RefCell::new(PlanIdSource::new(replay_ledger));
        let next_id = |site: &str| plan_ids.borrow_mut().next_for(site, None);
        // Row ids carry their table's prefix; ids minted inside field
        // expressions go through `next_id` and stay generic (LLP 0148 §D6).
        let next_id_for =
            |site: &str, table: &str| plan_ids.borrow_mut().next_for(site, Some(table));
        let mut collection_result = None;
        let mut asset_changes = BTreeSet::new();

        // Resolve every sealed point-write carrier before any plan step can
        // bind or observe its target. This is the plan-wide identical-absent
        // cut: a later Get/Guard/assertion/return sees the marker instead of a
        // present foreign row, while a declared refusal terminates with the
        // same bytes for missing and not-owned.
        //
        // @ref LLP 0264#d4-update-and-delete-check-the-old-row-transactionally
        for check in &plan.owner_write_checks {
            check_live()?;
            let (table_name, id_expr, write_form) = match &plan.steps[check.step_index] {
                MutationStep::Patch { table, id, .. } => {
                    (table.as_str(), id, GenericTableWriteFormV1::Patch)
                }
                MutationStep::Delete { table, id } => {
                    (table.as_str(), id, GenericTableWriteFormV1::Delete)
                }
                _ => unreachable!("owner-write preflight already bound carrier to point write"),
            };
            let table = schema_table(&schema, table_name)?;
            let Some(owner_field) = generic_owner_write_field(table, write_form)? else {
                return Err(SnapbackError::error(
                    "SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE",
                    "auth",
                    "ownerWriteChecks cannot bind a migration-pending non-owner table",
                )
                .with_details(json!({
                    "table": table.name,
                    "writeForm": write_form.as_str(),
                    "stepIndex": check.step_index,
                })));
            };
            let id = expect_string(
                eval_expr(
                    id_expr,
                    input,
                    &bindings,
                    now_ms,
                    Some(&next_id),
                    &format!("plan/owner-write-checks/{}/id", check.step_index),
                )?,
                "owner write check id",
            )?;
            let old_row = get_document_from_tx(&tx, table, &id, next_version)?;
            if !owner_row_matches(old_row.as_ref(), owner_field, input.auth.user_id.as_deref()) {
                owner_write_refusal(&check.absent)?;
                owner_absent_targets.insert((table.name.clone(), id));
            }
        }

        for (step_index, step) in plan.steps.iter().enumerate() {
            check_live()?;
            let step_site = format!("plan/steps/{step_index}");
            match step {
                MutationStep::AssetCollection(collection_plan) => {
                    enforce_identity_binding_write_seal(&schema, &collection_plan.child_table)?;
                    let (result, changed_assets) = execute_asset_collection_step(
                        &tx,
                        &schema,
                        collection_plan,
                        input,
                        identity,
                        next_version,
                        now_ms,
                        &self.order_field_bounds,
                        &plan_ids,
                        &mut changes,
                        check_live,
                    )?;
                    collection_result = Some(result);
                    asset_changes.extend(changed_assets);
                }
                MutationStep::AllocateSequence {
                    counter,
                    scope,
                    into,
                } => {
                    let declaration = self
                        .sequence_declarations
                        .get(counter)
                        .filter(|declaration| {
                            matches!(
                                declaration.scope_access,
                                crate::manifest::SequenceScopeAccess::ExistingOwner(_)
                            )
                        })
                        .ok_or_else(|| {
                            SnapbackError::error(
                                "SNAPBACK_SEQUENCE_UNDECLARED",
                                "runtime",
                                "HostPlan names a sequence absent from the active function generation",
                            )
                        })?;
                    let scope_row_id = expect_string(
                        eval_expr(
                            scope,
                            input,
                            &bindings,
                            now_ms,
                            Some(&next_id),
                            &format!("{step_site}/allocate-sequence/scope"),
                        )?,
                        "sequence scope id",
                    )?;
                    let allocation = preview_sequence_allocation_on(
                        &tx,
                        &schema,
                        counter,
                        &declaration.scope_table,
                        &scope_row_id,
                    )?;
                    apply_sequence_allocations_in_tx(
                        &tx,
                        &schema,
                        std::slice::from_ref(&allocation),
                    )?;
                    let value = json!(allocation.value);
                    bindings.insert(into.clone(), value.clone());
                    if let Some(direct) = direct_bindings.as_mut() {
                        direct.insert(into.clone(), value);
                    }
                    sequence_allocation_facts.push(allocation);
                }
                MutationStep::Insert {
                    table,
                    values,
                    bind_id_as,
                } => {
                    enforce_identity_binding_write_seal(&schema, table)?;
                    let table = schema_table(&schema, table)?;
                    let owner_field =
                        generic_owner_write_field(table, GenericTableWriteFormV1::Insert)?
                            .map(str::to_owned);
                    // @ref LLP 0056 — a protected resource may not be created
                    //   without seating its bootstrap holder (bootstrap path
                    //   only); a HostPlan generic insert cannot do that.
                    enforce_protected_resource_insert_guard(&schema, &table.name)?;
                    let id = next_id_for(&format!("{step_site}/insert/row-id"), &table.name)?;
                    if let Some(binding) = bind_id_as {
                        let value = Value::String(id.clone());
                        bindings.insert(binding.clone(), value.clone());
                        if let Some(direct) = direct_bindings.as_mut() {
                            direct.insert(binding.clone(), value);
                        }
                    }

                    let mut row = eval_value_map(
                        values,
                        input,
                        &bindings,
                        now_ms,
                        &next_id,
                        &format!("{step_site}/insert/values"),
                        settlement_time,
                        settlement_time_within_bound,
                        &settlement_time_sink_reached,
                    )?;
                    if let Some(owner_field) = owner_field {
                        let principal = input.auth.user_id.as_deref().ok_or_else(|| {
                            SnapbackError::error(
                                "SNAPBACK_AUTH_USER_MISSING",
                                "auth",
                                "an owner-policy insert requires an effective principal",
                            )
                            .with_details(json!({
                                "table": table.name,
                                "writeForm": "insert",
                            }))
                        })?;
                        // The AuthUserId expression is only a compatibility
                        // marker. The transaction owns the authoritative stamp.
                        row.insert(owner_field, Value::String(principal.to_owned()));
                    }
                    let changed_fields = changed_field_names(&row);
                    if projection_sources.contains(&table.name) {
                        projection_pre_images
                            .entry((table.name.clone(), id.clone()))
                            .or_insert(None);
                    }
                    let document = insert_document(
                        &tx,
                        table,
                        &id,
                        &row,
                        next_version,
                        now_ms,
                        &self.order_field_bounds,
                    )?;
                    record_change(
                        &tx,
                        next_version,
                        &table.name,
                        &id,
                        ChangeOp::Insert,
                        Some(&document),
                        now_ms,
                    )?;
                    changes.push(ChangedRow {
                        table: table.name.clone(),
                        id,
                        op: ChangeOp::Insert,
                        row: Some(document),
                        changed_fields,
                    });
                }
                MutationStep::Patch { table, id, values } => {
                    enforce_identity_binding_write_seal(&schema, table)?;
                    let table = schema_table(&schema, table)?;
                    let owner_field =
                        generic_owner_write_field(table, GenericTableWriteFormV1::Patch)?;
                    if values.is_empty() {
                        continue;
                    }
                    let id = expect_string(
                        eval_expr(
                            id,
                            input,
                            &bindings,
                            now_ms,
                            Some(&next_id),
                            &format!("{step_site}/patch/id"),
                        )?,
                        "patch id",
                    )?;
                    if owner_absent_targets.contains(&(table.name.clone(), id.clone())) {
                        continue;
                    }
                    if let Some(owner_field) = owner_field {
                        let old_row = get_document_from_tx(&tx, table, &id, next_version)?;
                        if !owner_row_matches(
                            old_row.as_ref(),
                            owner_field,
                            input.auth.user_id.as_deref(),
                        ) {
                            let check =
                                owner_write_check_for_step(&plan.owner_write_checks, step_index)
                                    .expect("preflight proved the owner check carrier");
                            owner_write_refusal(&check.absent)?;
                            owner_absent_targets.insert((table.name.clone(), id));
                            continue;
                        }
                    }
                    let row = eval_value_map(
                        values,
                        input,
                        &bindings,
                        now_ms,
                        &next_id,
                        &format!("{step_site}/patch/values"),
                        settlement_time,
                        settlement_time_within_bound,
                        &settlement_time_sink_reached,
                    )?;
                    let changed_fields = changed_field_names(&row);
                    if projection_sources.contains(&table.name)
                        && !projection_pre_images.contains_key(&(table.name.clone(), id.clone()))
                    {
                        let pre = get_document_from_tx(&tx, table, &id, next_version)?
                            .and_then(|value| value.as_object().cloned());
                        projection_pre_images.insert((table.name.clone(), id.clone()), pre);
                    }
                    if patch_document(
                        &tx,
                        table,
                        &id,
                        &row,
                        next_version,
                        now_ms,
                        &self.order_field_bounds,
                    )? {
                        let document = get_document_from_tx(&tx, table, &id, next_version)?;
                        record_change(
                            &tx,
                            next_version,
                            &table.name,
                            &id,
                            ChangeOp::Update,
                            document.as_ref(),
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: table.name.clone(),
                            id,
                            op: ChangeOp::Update,
                            row: document,
                            changed_fields,
                        });
                    }
                }
                MutationStep::Delete { table, id } => {
                    enforce_identity_binding_write_seal(&schema, table)?;
                    let table = schema_table(&schema, table)?;
                    let owner_field =
                        generic_owner_write_field(table, GenericTableWriteFormV1::Delete)?;
                    let id = expect_string(
                        eval_expr(
                            id,
                            input,
                            &bindings,
                            now_ms,
                            Some(&next_id),
                            &format!("{step_site}/delete/id"),
                        )?,
                        "delete id",
                    )?;
                    if owner_absent_targets.contains(&(table.name.clone(), id.clone())) {
                        continue;
                    }
                    if let Some(owner_field) = owner_field {
                        let old_row = get_document_from_tx(&tx, table, &id, next_version)?;
                        if !owner_row_matches(
                            old_row.as_ref(),
                            owner_field,
                            input.auth.user_id.as_deref(),
                        ) {
                            let check =
                                owner_write_check_for_step(&plan.owner_write_checks, step_index)
                                    .expect("preflight proved the owner check carrier");
                            owner_write_refusal(&check.absent)?;
                            owner_absent_targets.insert((table.name.clone(), id));
                            continue;
                        }
                    }
                    // @ref LLP 0056 — deleting a resource row does not silently
                    //   orphan its memberships; refuse while any remain (teardown
                    //   via clearForResource is the only path, and it is
                    //   host-bound, not a HostPlan generic delete).
                    enforce_resource_delete_guard(&schema, &tx, &table.name, Some(&id))?;
                    let document = get_document_from_tx(&tx, table, &id, next_version)?;
                    if projection_sources.contains(&table.name)
                        && !projection_pre_images.contains_key(&(table.name.clone(), id.clone()))
                    {
                        projection_pre_images.insert(
                            (table.name.clone(), id.clone()),
                            document
                                .as_ref()
                                .and_then(|value| value.as_object().cloned()),
                        );
                    }
                    if delete_document(&tx, table, &id)? {
                        record_change(
                            &tx,
                            next_version,
                            &table.name,
                            &id,
                            ChangeOp::Delete,
                            None,
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: table.name.clone(),
                            id,
                            op: ChangeOp::Delete,
                            row: document,
                            changed_fields: Vec::new(),
                        });
                    }
                }
                // @ref LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation —
                // Get binds the row or null; missing is data, not failure. The
                // read runs inside the commit transaction (never stale) and is
                // captured server-side for receipts/overlays; a missing row is a
                // MissingRow entry pinned to the table's change version, the
                // per-row validation shape the buffered path already uses.
                MutationStep::Get {
                    table,
                    id,
                    bind_as,
                    else_error,
                } => {
                    let table = schema_table(&schema, table)?;
                    let id = expect_string(
                        eval_expr(
                            id,
                            input,
                            &bindings,
                            now_ms,
                            Some(&next_id),
                            &format!("{step_site}/get/id"),
                        )?,
                        "get id",
                    )?;
                    let document =
                        if owner_absent_targets.contains(&(table.name.clone(), id.clone())) {
                            None
                        } else {
                            get_document_from_tx(&tx, table, &id, next_version)?
                        };
                    let dependency = match &document {
                        Some(_) => CapturedReadDependency {
                            kind: CapturedReadKind::Row,
                            table: Some(table.name.clone()),
                            id: Some(id.clone()),
                            version: get_row_version(&tx, table, &id, next_version)?,
                            predicate: None,
                            rows: Vec::new(),
                            field: None,
                            value: None,
                            order: None,
                            limit: None,
                            result_count: None,
                            boundary: None,
                        },
                        None => CapturedReadDependency {
                            kind: CapturedReadKind::MissingRow,
                            table: Some(table.name.clone()),
                            id: Some(id.clone()),
                            version: Some(table_change_version_from_tx(
                                &tx,
                                &table.name,
                                next_version,
                            )?),
                            predicate: None,
                            rows: Vec::new(),
                            field: None,
                            value: None,
                            order: None,
                            limit: None,
                            result_count: None,
                            boundary: None,
                        },
                    };
                    read_dependencies.push(dependency);
                    match document {
                        Some(row) => {
                            if let Some(direct) = direct_bindings.as_mut() {
                                direct.insert(bind_as.clone(), row.clone());
                            }
                            bindings.insert(bind_as.clone(), row);
                        }
                        None => {
                            if let Some(code) = else_error {
                                return Err(mutation_plan_refusal(
                                    code,
                                    format!("get on {} {id} found no row", table.name),
                                    json!({
                                        "table": table.name,
                                        "id": id,
                                        "step": "Get",
                                    }),
                                ));
                            }
                            bindings.insert(bind_as.clone(), Value::Null);
                            if let Some(direct) = direct_bindings.as_mut() {
                                direct.insert(bind_as.clone(), Value::Null);
                            }
                        }
                    }
                }
                // @ref LLP 0110#protected-relation-incarnation-and-stamping —
                // this host-owned assertion executes inside the same SQLite
                // transaction as the following read/write. It compares both
                // relationship axes to the current active registry token, so
                // a historical orphan cannot regain authority if its parent
                // id is later reused.
                MutationStep::AssertCurrentRelation {
                    table,
                    id,
                    scope_table,
                    scope_id,
                    foreign_key_field,
                    incarnation_field,
                    else_error,
                } => {
                    let table = schema_table(&schema, table)?;
                    let id = expect_string(
                        eval_expr(
                            id,
                            input,
                            &bindings,
                            now_ms,
                            Some(&next_id),
                            &format!("{step_site}/assert-current-relation/id"),
                        )?,
                        "current relation row id",
                    )?;
                    let scope_id = expect_string(
                        eval_expr(
                            scope_id,
                            input,
                            &bindings,
                            now_ms,
                            Some(&next_id),
                            &format!("{step_site}/assert-current-relation/scope-id"),
                        )?,
                        "current relation scope id",
                    )?;
                    if owner_absent_targets.contains(&(table.name.clone(), id.clone())) {
                        return Err(SnapbackError::error(
                            else_error.clone(),
                            "handler",
                            "current relation assertion failed",
                        )
                        .with_details(json!({ "step": "AssertCurrentRelation" })));
                    }
                    let row = get_document_from_tx(&tx, table, &id, next_version)?;
                    let active_incarnation: Option<String> = tx
                        .query_row(
                            "SELECT incarnation
                               FROM _snapback_relation_incarnations_v1
                              WHERE table_name = ?1 AND row_id = ?2 AND active = 1",
                            params![scope_table, &scope_id],
                            |row| row.get(0),
                        )
                        .optional()?;
                    let admitted = row.as_ref().and_then(Value::as_object).is_some_and(|row| {
                        row.get(foreign_key_field).and_then(Value::as_str)
                            == Some(scope_id.as_str())
                            && row.get(incarnation_field).and_then(Value::as_str)
                                == active_incarnation.as_deref()
                            && active_incarnation.is_some()
                    });
                    if !admitted {
                        return Err(SnapbackError::error(
                            else_error.clone(),
                            "handler",
                            "current relation assertion failed",
                        )
                        .with_details(json!({ "step": "AssertCurrentRelation" })));
                    }
                }
                MutationStep::Guard { cond, else_error } => {
                    let admitted = eval_authorization_decision_values(
                        cond,
                        input,
                        &bindings,
                        direct_bindings.as_ref(),
                        now_ms,
                        Some(&next_id),
                        &format!("{step_site}/guard/condition"),
                    )?
                    .iter()
                    .all(crate::value_expr::truthy);
                    if !admitted {
                        return Err(mutation_plan_refusal(
                            else_error,
                            "mutation guard failed",
                            json!({ "step": "Guard" }),
                        ));
                    }
                }
                MutationStep::Let { bind_as, expr } => {
                    let projection_dependent = direct_bindings.as_ref().is_some_and(|direct| {
                        value_expr_depends_on_projection(expr, &bindings, direct)
                    });
                    if projection_dependent && expr.uses_runtime_intrinsic() {
                        return Err(SnapbackError::error(
                            "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED",
                            "auth",
                            "actor-aware authorization bindings cannot depend on runtime clock or id inputs",
                        ));
                    }
                    let value = eval_expr(
                        expr,
                        input,
                        &bindings,
                        now_ms,
                        Some(&next_id),
                        &format!("{step_site}/let/expression"),
                    )?;
                    if let (Some(direct_input), Some(direct_bindings)) =
                        (direct_input.as_ref(), direct_bindings.as_mut())
                    {
                        let direct_value = if projection_dependent {
                            eval_expr(
                                expr,
                                direct_input,
                                direct_bindings,
                                now_ms,
                                Some(&next_id),
                                &format!("{step_site}/let/expression"),
                            )?
                        } else {
                            value.clone()
                        };
                        direct_bindings.insert(bind_as.clone(), direct_value);
                    }
                    bindings.insert(bind_as.clone(), value);
                }
                MutationStep::AssertSourceChanged {
                    table,
                    id,
                    operation,
                } => {
                    let id = expect_string(
                        eval_expr(
                            id,
                            input,
                            &bindings,
                            now_ms,
                            Some(&next_id),
                            &format!("{step_site}/assert-source-changed/id"),
                        )?,
                        "source id",
                    )?;
                    let expected = match operation {
                        crate::manifest::WriteWithActivitySourceOperation::Insert => {
                            ChangeOp::Insert
                        }
                        crate::manifest::WriteWithActivitySourceOperation::Patch => {
                            ChangeOp::Update
                        }
                        crate::manifest::WriteWithActivitySourceOperation::Delete => {
                            ChangeOp::Delete
                        }
                    };
                    let matches = changes
                        .iter()
                        .filter(|change| {
                            change.table == *table && change.id == id && change.op == expected
                        })
                        .count();
                    if matches != 1 {
                        return Err(SnapbackError::error(
                            "SNAPBACK_ACTIVITY_SOURCE_EFFECT_REQUIRED",
                            "mutation",
                            "activity append requires exactly one changed source row",
                        )
                        .with_details(json!({
                            "table": table,
                            "id": id,
                            "operation": operation.as_str(),
                            "matchingEffects": matches,
                        })));
                    }
                }
                MutationStep::DeleteWhere { table, filter } => {
                    enforce_identity_binding_write_seal(&schema, table)?;
                    let table = schema_table(&schema, table)?;
                    let owner_field =
                        generic_owner_write_field(table, GenericTableWriteFormV1::DeleteWhere)?
                            .map(str::to_owned);
                    // Reuse the query WHERE builder so DeleteWhere filters share
                    // matcher/SQL semantics with reads (empty filter = clear).
                    let scan_plan = QueryPlan {
                        table_visibility: owner_field
                            .map(|field| TableVisibilityV1::Owner { field }),
                        table: table.name.clone(),
                        filters: filter.clone(),
                        membership_filters: Vec::new(),
                        order: Vec::new(),
                        limit: None,
                        indexed_by: None,
                    };
                    if query_uses_row_version_for_selection(&scan_plan) {
                        validate_managed_row_versions(&tx, table, next_version)?;
                    }
                    let (sql, params) = build_query_sql(
                        table,
                        &schema,
                        &scan_plan,
                        input,
                        &bindings,
                        direct_bindings.as_ref(),
                        now_ms,
                        Some(&next_id),
                        &format!("{step_site}/delete-where"),
                        None,
                        None,
                        false,
                        None,
                    )?;
                    let rows = {
                        let mut statement = tx.prepare(&sql)?;
                        let columns = statement
                            .column_names()
                            .into_iter()
                            .map(ToOwned::to_owned)
                            .collect::<Vec<_>>();
                        let mut matched = statement.query(params_from_iter(params.iter()))?;
                        let mut rows = Vec::new();
                        while let Some(row) = matched.next()? {
                            check_live()?;
                            rows.push(row_to_document(row, table, &columns)?);
                        }
                        rows
                    };
                    // Row-granular deletes so live_delta membership maintenance
                    // sees each removal, exactly as per-row Delete steps.
                    for row in rows {
                        check_live()?;
                        if projection_sources.contains(&table.name)
                            && let Some(id) = row.get("_id").and_then(Value::as_str)
                        {
                            projection_pre_images
                                .entry((table.name.clone(), id.to_owned()))
                                .or_insert_with(|| row.as_object().cloned());
                        }
                        let Some(id) = row.get("_id").and_then(Value::as_str).map(str::to_owned)
                        else {
                            continue;
                        };
                        // @ref LLP 0056 — a bulk resource delete cannot orphan
                        //   memberships either; each matched resource row is
                        //   guarded exactly like a single Delete.
                        enforce_resource_delete_guard(&schema, &tx, &table.name, Some(&id))?;
                        if delete_document(&tx, table, &id)? {
                            record_change(
                                &tx,
                                next_version,
                                &table.name,
                                &id,
                                ChangeOp::Delete,
                                None,
                                now_ms,
                            )?;
                            changes.push(ChangedRow {
                                table: table.name.clone(),
                                id,
                                op: ChangeOp::Delete,
                                row: Some(row.clone()),
                                changed_fields: Vec::new(),
                            });
                        }
                    }
                }
                MutationStep::InsertEach {
                    table,
                    source,
                    item_as,
                    values,
                } => {
                    enforce_identity_binding_write_seal(&schema, table)?;
                    let table = schema_table(&schema, table)?;
                    let owner_field =
                        generic_owner_write_field(table, GenericTableWriteFormV1::InsertEach)?
                            .map(str::to_owned);
                    let principal = if owner_field.is_some() {
                        Some(input.auth.user_id.as_deref().ok_or_else(|| {
                            SnapbackError::error(
                                "SNAPBACK_AUTH_USER_MISSING",
                                "auth",
                                "an owner-policy insert requires an effective principal",
                            )
                            .with_details(json!({
                                "table": table.name,
                                "writeForm": "insert-each",
                            }))
                        })?)
                    } else {
                        None
                    };
                    enforce_protected_resource_insert_guard(&schema, &table.name)?;
                    let source_value = eval_expr(
                        source,
                        input,
                        &bindings,
                        now_ms,
                        Some(&next_id),
                        &format!("{step_site}/insert-each/source"),
                    )?;
                    let Value::Array(items) = source_value else {
                        return Err(SnapbackError::error(
                            "SNAPBACK_PLAN_SOURCE_INVALID",
                            "runtime",
                            "InsertEach source must evaluate to an array",
                        )
                        .with_details(json!({ "table": table.name })));
                    };
                    if items.len() > crate::value_expr::MAX_INSERT_EACH_FANOUT {
                        return Err(SnapbackError::error(
                            "SNAPBACK_PLAN_BOUNDS",
                            "runtime",
                            format!(
                                "InsertEach fan-out {} exceeds the declared bound ({})",
                                items.len(),
                                crate::value_expr::MAX_INSERT_EACH_FANOUT
                            ),
                        ));
                    }
                    for item in items {
                        check_live()?;
                        // The item binding is scoped to this step's value maps.
                        let mut item_bindings = bindings.clone();
                        item_bindings.insert(item_as.clone(), item);
                        let id =
                            next_id_for(&format!("{step_site}/insert-each/row-id"), &table.name)?;
                        if projection_sources.contains(&table.name) {
                            projection_pre_images
                                .entry((table.name.clone(), id.clone()))
                                .or_insert(None);
                        }
                        let mut row = eval_value_map(
                            values,
                            input,
                            &item_bindings,
                            now_ms,
                            &next_id,
                            &format!("{step_site}/insert-each/values"),
                            settlement_time,
                            settlement_time_within_bound,
                            &settlement_time_sink_reached,
                        )?;
                        if let (Some(owner_field), Some(principal)) =
                            (owner_field.as_ref(), principal)
                        {
                            row.insert(owner_field.clone(), Value::String(principal.to_owned()));
                        }
                        let changed_fields = changed_field_names(&row);
                        let document = insert_document(
                            &tx,
                            table,
                            &id,
                            &row,
                            next_version,
                            now_ms,
                            &self.order_field_bounds,
                        )?;
                        record_change(
                            &tx,
                            next_version,
                            &table.name,
                            &id,
                            ChangeOp::Insert,
                            Some(&document),
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: table.name.clone(),
                            id,
                            op: ChangeOp::Insert,
                            row: Some(document),
                            changed_fields,
                        });
                    }
                }
            }
        }

        let media_result = if media_command.is_some() {
            Some(if let Some(result) = collection_result.clone() {
                result
            } else {
                match &plan.return_value {
                    Some(ReturnValue::Literal(value)) => value.clone(),
                    Some(ReturnValue::Binding(name)) => {
                        bindings.get(name).cloned().unwrap_or(Value::Null)
                    }
                    Some(ReturnValue::Document { table, id }) => {
                        let table = schema_table(&schema, table)?;
                        let id = expect_string(
                            eval_expr(
                                id,
                                input,
                                &bindings,
                                now_ms,
                                Some(&next_id),
                                "plan/return/document/id",
                            )?,
                            "document id",
                        )?;
                        let mut document =
                            if owner_absent_targets.contains(&(table.name.clone(), id.clone())) {
                                Value::Null
                            } else {
                                get_document_from_tx(&tx, table, &id, next_version)?
                                    .unwrap_or(Value::Null)
                            };
                        if !document.is_null() {
                            project_media_fields_on(&tx, table, &mut document)?;
                        }
                        document
                    }
                    Some(ReturnValue::ChangedCount) | None => json!(changes.len()),
                    Some(ReturnValue::Expr(expr)) => eval_expr(
                        expr,
                        input,
                        &bindings,
                        now_ms,
                        Some(&next_id),
                        "plan/return/expression",
                    )?,
                }
            })
        } else {
            None
        };
        if let (Some(media), Some(result)) = (media_command, media_result.as_ref()) {
            asset_changes.extend(execute_media_command_collection_step(
                &tx,
                &schema,
                media,
                input,
                result,
                identity,
                next_version,
                now_ms,
                &self.order_field_bounds,
                &mut changes,
                check_live,
            )?);
        }

        asset_changes.extend(cascade_asset_collection_parent_deletions(
            &tx,
            &schema,
            &mut changes,
            next_version,
            now_ms,
        )?);

        // @ref LLP 0080#5-transactionally-maintained-projections — every
        //   source mutation computes the bounded affected-key set and
        //   updates the outputs in this same transaction and commit
        //   version. Under the serialized writer, running admission here —
        //   after the step loop, before COMMIT — is observationally
        //   equivalent to before-any-write admission: a refusal aborts the
        //   whole transaction atomically, and no reader can observe the
        //   intermediate state.
        if !projections.is_empty() {
            maintain_projections_in_tx(
                &tx,
                &schema,
                &projections,
                &mut changes,
                &projection_pre_images,
                next_version,
                now_ms,
                &self.order_field_bounds,
                ProjectionEffectCeiling::MutationV1,
            )?;
        }
        // @ref LLP 0073#index-maintenance — derived postings are replaced
        // after projection convergence and before the source head publishes;
        // any bound/storage failure aborts the complete mutation.
        maintain_derived_indexes_in_tx(&tx, &schema, &changes, next_version)?;
        // @ref LLP 0044#typed-references-and-atomic-attachment — host plans
        //   have no handler execution to call attach in, so the commit
        //   boundary derives the admission from the field's schema-declared
        //   intent restriction; restriction-less fields refuse here.
        enforce_asset_reference_changes(
            &schema,
            &tx,
            &changes,
            &crate::assets::AssetCommitAuthority {
                path: crate::assets::AssetWritePath::HostPlan,
                principal: input.auth.user_id.as_deref(),
                admissions: &[],
            },
            now_ms,
        )?;
        if !changes.is_empty() || !sequence_allocation_facts.is_empty() || !asset_changes.is_empty()
        {
            set_version(&tx, next_version)?;
        }

        let result = if let Some(result) = media_result {
            result
        } else if let Some(result) = collection_result {
            result
        } else {
            match &plan.return_value {
                Some(ReturnValue::Literal(value)) => value.clone(),
                Some(ReturnValue::Binding(name)) => {
                    bindings.get(name).cloned().unwrap_or(Value::Null)
                }
                Some(ReturnValue::Document { table, id }) => {
                    let table = schema_table(&schema, table)?;
                    let id = expect_string(
                        eval_expr(
                            id,
                            input,
                            &bindings,
                            now_ms,
                            Some(&next_id),
                            "plan/return/document/id",
                        )?,
                        "document id",
                    )?;
                    let mut document = if owner_absent_targets
                        .contains(&(table.name.clone(), id.clone()))
                    {
                        Value::Null
                    } else {
                        get_document_from_tx(&tx, table, &id, next_version)?.unwrap_or(Value::Null)
                    };
                    if !document.is_null() {
                        project_media_fields_on(&tx, table, &mut document)?;
                    }
                    document
                }
                Some(ReturnValue::ChangedCount) | None => json!(changes.len()),
                Some(ReturnValue::Expr(expr)) => eval_expr(
                    expr,
                    input,
                    &bindings,
                    now_ms,
                    Some(&next_id),
                    "plan/return/expression",
                )?,
            }
        };
        let settlement_media = match &plan.return_value {
            Some(ReturnValue::Document { table, .. }) => {
                let table = schema_table(&schema, table)?;
                let contract = crate::manifest::FunctionResultContract::Document {
                    table: table.name.clone(),
                    document: crate::manifest::table_document_value_contract(table),
                };
                let projection_plan = crate::runtime::media_projection_plan(&contract);
                (!projection_plan.occurrences.is_empty()).then(|| SettlementMediaContextV1 {
                    result_contract_hash: crate::manifest::result_contract_hash(&contract)
                        .expect("schema-derived HostPlan media contract is canonical"),
                    plan: projection_plan,
                })
            }
            _ => None,
        };

        plan_ids.borrow().ensure_exact_consumption()?;
        let generated_ids = plan_ids.borrow().generated.clone();

        let version = if changes.is_empty()
            && sequence_allocation_facts.is_empty()
            && asset_changes.is_empty()
        {
            current_version
        } else {
            next_version
        };
        let output_ledger = CtxAnswerLedger {
            version: CTX_ANSWER_LEDGER_VERSION,
            ids: match replay_ledger.as_ref() {
                Some(ledger) => ledger.ids.clone(),
                None => generated_ids.clone(),
            },
            now: now_ms,
            auth_fingerprint: None,
        };
        let output = MutationOutput {
            version,
            changed_count: changes.len(),
            result,
            authority_transitions: Vec::new(),
            ctx_ledger: Some(output_ledger),
            settlement_mint_observations: plan_ids.borrow().observations.clone(),
            settlement_time_observation: settlement_time.map(|policy| {
                let sink_reached = settlement_time_sink_reached.get();
                SettlementTimeObservation {
                    field: policy.field.clone(),
                    claimed: policy.claimed,
                    authoritative_sample: now_ms,
                    skew_ms: settlement_time_skew.expect("policy implies measured skew"),
                    sink_reached,
                    accepted: settlement_time_within_bound && sink_reached,
                }
            }),
            settlement_sequence_allocations: sequence_allocation_facts.clone(),
        };
        let authorization_predecessor = if apply {
            auth_stream::read_authorization_version_on(&tx)?
        } else {
            None
        };
        let authorization = if apply {
            Some(authorization::authorization_commit_hook_in(
                &tx,
                authorization::AuthorizationCommitCause::AppWrites {
                    schema: &schema,
                    changes: &changes,
                },
            )?)
        } else {
            None
        };
        if apply {
            check_live()?;
            let prepared_authorization_commit = prepare_authorization_commit_interlock(
                authorization
                    .as_ref()
                    .expect("an applied mutation has an authorization witness"),
                AuthorizationCommitImpact::AppWrites {
                    schema: &schema,
                    changes: &changes,
                },
                authorization_interlock.as_ref(),
            )?;
            // Targeted room quiescence happens before this process-global
            // fence. The returned guard still lives through tx.commit(), but
            // an affected room cannot make unrelated route admission wait on
            // the admission-controller mutex.
            let _commit_guard = before_commit()?;
            check_live()?;
            if let Some(identity) = identity {
                operation_envelope_crash_cut(OperationEnvelopeCrashPointV1::BeforeSettlement)?;
                record_client_mutation_result(
                    &tx,
                    identity,
                    input,
                    &read_dependencies,
                    &changes,
                    &output,
                    settlement_media.as_ref(),
                )?;
            }
            if let Some(branch_operation) = branch_operation {
                crate::fork_promotion::record_branch_mutation_in(
                    &tx,
                    branch_operation,
                    version,
                    &changes,
                    &output,
                )?;
            }
            commit_with_prepared_authorization_interlock(
                tx,
                authorization
                    .as_ref()
                    .expect("an applied mutation has an authorization witness"),
                authorization_predecessor,
                version,
                prepared_authorization_commit,
            )?;
        } else {
            // Execute-and-discard (LLP 0051 D8): everything above — writes,
            // change-log records, the version bump — evaporates here.
            tx.rollback()?;
        }

        Ok(MutationPlanExecution {
            commit: MutationCommit {
                output,
                write_dependencies: captured_writes_from_changes(&changes),
                changes,
                read_dependencies,
                // IR-plan mutations have no enqueue vocabulary in v1; the
                // jobs surface is JS-tier only (see the LLP 0070 amendment
                // note's callee/producer scoping).
                job_enqueues: Vec::new(),
                job_changes: Vec::new(),
                asset_changes: asset_changes.into_iter().collect(),
                sequence_allocations: sequence_allocation_facts,
                authorization,
                authority_transitions: Vec::new(),
                network_egress: Default::default(),
            },
            generated_ids,
            now_ms,
            snapshot_version: current_version,
        })
    }

    #[allow(
        clippy::too_many_arguments,
        reason = "the lane commit boundary keeps writer, authority, and lifecycle checks explicit"
    )]
    pub(in crate::storage) fn commit_buffered_writes_for_lane<G, Check, BeforeCommit>(
        &mut self,
        input: &HandlerInput,
        payload: BufferedCommitPayload,
        identity: Option<&ClientMutationIdentity>,
        media_command: Option<&crate::manifest::ResolvedMediaCommandV1>,
        lane: CoveredMutationLaneV1,
        branch_operation: Option<&crate::fork_promotion::BranchMutationCommitV1>,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        require_covered_mutation_identity_for_lane(&self.conn, lane, identity)?;
        if let Some(identity) = identity
            && let Some(commit) = self.replayed_mutation_commit(identity)?
        {
            return Ok(commit);
        }
        let BufferedCommitPayload {
            writes,
            sequence_allocations,
            membership_plans,
            read_dependencies,
            result,
            ctx_ledger,
            job_enqueues,
            job_producer,
            asset_admissions,
            asset_grant_ops,
            media_projection_proof,
            expected_media_projection_binding,
        } = payload;
        let media_projection = match (media_projection_proof, expected_media_projection_binding) {
            (Some(proof), Some(expected)) => {
                Some(MediaProjectionProofAccess::Owned { proof, expected })
            }
            (None, None) => None,
            _ => return Err(media_projection_unprovenanced()),
        };
        let attempted = self.apply_buffered_writes_with_lifecycle(
            match lane {
                CoveredMutationLaneV1::Ordinary => {
                    write_authority::LocalWriterLaneV1::OrdinaryIbexBuffered
                }
                CoveredMutationLaneV1::HostChild => {
                    write_authority::LocalWriterLaneV1::HostChildIbexBuffered
                }
            },
            input,
            BufferedEffects {
                writes,
                sequence_allocations,
                membership_plans,
                read_dependencies,
                result,
                job_enqueues,
                job_producer,
                asset_admissions,
                asset_grant_ops,
                media_projection,
            },
            BufferedCommitOptions {
                ctx_ledger: Some(ctx_ledger),
                apply: true,
                identity,
                media_command,
                branch_operation,
            },
            &check_live,
            before_commit,
        );
        match (attempted, identity) {
            (Ok(commit), _) => Ok(commit),
            (Err(error), Some(identity)) => {
                self.replay_after_concurrent_settlement(identity, error)
            }
            (Err(error), None) => Err(error),
        }
    }

    fn apply_buffered_writes_with_lifecycle<G, Check, BeforeCommit>(
        &mut self,
        writer_lane: write_authority::LocalWriterLaneV1,
        input: &HandlerInput,
        effects: BufferedEffects<'_>,
        options: BufferedCommitOptions<'_>,
        check_live: &Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.apply_buffered_writes_with_lifecycle_gated(
            writer_lane,
            input,
            effects,
            options,
            MembershipCommitAuthority::deny(),
            check_live,
            before_commit,
        )
    }

    #[allow(
        clippy::too_many_arguments,
        reason = "the transaction boundary keeps writer, authority, and lifecycle checks explicit"
    )]
    pub(in crate::storage) fn apply_buffered_writes_with_lifecycle_gated<G, Check, BeforeCommit>(
        &mut self,
        writer_lane: write_authority::LocalWriterLaneV1,
        input: &HandlerInput,
        effects: BufferedEffects<'_>,
        options: BufferedCommitOptions<'_>,
        membership_authority: MembershipCommitAuthority<'_>,
        check_live: &Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        crate::exec_guard::debug_assert_off_async_worker("a SQLite commit");
        check_live()?;
        let _writer_token = self.writer_authority.enter(writer_lane)?;
        let BufferedEffects {
            writes,
            sequence_allocations,
            membership_plans,
            mut read_dependencies,
            mut result,
            job_enqueues,
            job_producer,
            asset_admissions,
            asset_grant_ops,
            media_projection,
        } = effects;
        // @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
        // — compare the proof with the independently reconstructed prepared
        // invocation/request binding before any OCC admission or egress work.
        if let Some(media_projection) = media_projection.as_ref() {
            validate_staged_media_projection_binding(
                media_projection.proof(),
                media_projection.expected(),
            )?;
            if options.apply {
                validate_staged_media_projection_commit_identity(
                    media_projection.proof(),
                    options.identity,
                )?;
            }
            validate_staged_media_projection_dependencies(
                media_projection.proof(),
                &read_dependencies,
            )?;
        }
        if !job_enqueues.is_empty() {
            if let Some(runtime) = self.derived_fork() {
                return Err(runtime.deny(
                    crate::instance_fork::EgressFamily::JobsEnqueue,
                    now_millis(),
                ));
            }
            if let Some(runtime) = self.in_app_branch() {
                return Err(runtime.mediate(
                    crate::instance_fork::EgressFamily::JobsEnqueue,
                    now_millis(),
                ));
            }
        }
        if !job_enqueues.is_empty() && job_producer.is_none() {
            return Err(SnapbackError::error(
                "SNAPBACK_JOB_PRODUCER_MISSING",
                "jobs",
                "buffered job enqueues reached commit without producer provenance",
            ));
        }
        for authorized in &membership_plans {
            read_dependencies.extend(authorized.plan.read_dependencies.iter().cloned());
        }
        let mut touched_tables = input
            .read_set
            .iter()
            .map(|dependency| dependency.table.clone())
            .collect::<BTreeSet<_>>();
        touched_tables.extend(
            read_dependencies
                .iter()
                .filter(|dependency| !is_media_projection_dependency(dependency))
                .filter_map(|dependency| dependency.table.clone()),
        );
        touched_tables.extend(writes.iter().map(|write| write.table().to_owned()));
        touched_tables.extend(
            membership_plans
                .iter()
                .flat_map(|authorized| authorized.plan.writes.iter())
                .map(|write| write.table().to_owned()),
        );
        if let Some(media) = options.media_command {
            touched_tables.insert(media.binding.collection.owner_table.clone());
            touched_tables.insert(media.binding.collection.child_table.clone());
            if let crate::manifest::AssetCollectionSharingPlanV1::Derived { table, .. } =
                &media.binding.sharing.plan
            {
                touched_tables.insert(table.clone());
            }
        }
        // @ref LLP 0003#execution-and-write-semantics — JS ctx.db writes are buffered during handler execution and committed once after completion.
        let schema = self.schema.clone();
        let projections = self.projections.clone();
        let projection_sources: BTreeSet<String> = projections
            .iter()
            .flat_map(|plan| [plan.root.clone(), plan.joined.clone()])
            .collect();
        let mut projection_pre_images: BTreeMap<(String, String), Option<Map<String, Value>>> =
            BTreeMap::new();
        // The handler's frozen clock is part of the buffered effect, not a
        // value to rediscover at reconnect/commit time. Replay, optimistic
        // output, persisted system fields, and the journal therefore share
        // one timestamp (LLP 0007 §Timestamps; LLP 0051 D1).
        let now_ms = options
            .ctx_ledger
            .as_ref()
            .or(input.ctx_ledger.as_ref())
            .map(|ledger| ledger.now)
            .unwrap_or_else(now_millis);
        validate_portable_timestamp_millis(now_ms)?;
        let authorization_interlock = self.authorization_interlock.clone();
        let enforce_canonical_promotion_reservation =
            self.derived_fork.is_none() && self.in_app_branch.is_none();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        migration_executor::ensure_migration_fence_open(&tx)?;
        if enforce_canonical_promotion_reservation
            && let Some(stream_id) = crate::seed_identity::strict_current_data_version_stream(&tx)?
        {
            crate::fork_promotion::enforce_canonical_mutation_admission_in(
                &tx,
                &stream_id,
                now_ms as i64,
            )?;
        }
        let current_version = current_version_on(&tx)?;
        let next_version = next_storage_version(current_version)?;

        validate_touched_managed_tables(&tx, &schema, &touched_tables, current_version)?;
        validate_read_set(&tx, &schema, &input.read_set, current_version)?;
        // @ref LLP 0020#phase-3-capture-read-sets-during-handler-execution — handler-captured dependencies are validated at commit so callers no longer own the read-set.
        validate_captured_read_set(&tx, &schema, input, &read_dependencies, current_version)?;

        let mut carried_writes: Vec<_> = writes
            .into_iter()
            .map(|write| {
                (
                    write,
                    membership_authority.gate,
                    membership_authority.writer.cloned(),
                )
            })
            .collect();
        for authorized in membership_plans {
            carried_writes.extend(authorized.plan.writes.into_iter().map(|write| {
                (
                    write,
                    MembershipWriteGate::Sanctioned,
                    Some(authorized.writer.clone()),
                )
            }));
        }

        let mut changes = Vec::new();
        let mut authority_transition_drafts = Vec::new();
        for (mut write, write_gate, write_writer) in carried_writes {
            check_live()?;
            enforce_identity_binding_write_seal(&schema, write.table())?;
            if schema
                .asset_collections
                .iter()
                .any(|collection| collection.child_table == write.table())
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_MEDIA_COLLECTION_RAW_WRITE_REFUSED",
                    "asset-collection",
                    format!(
                        "buffered writes cannot target framework-owned collection table {}",
                        write.table()
                    ),
                ));
            }
            if write_gate == MembershipWriteGate::Sanctioned {
                revalidate_sanctioned_membership_write(&schema, &tx, &write, next_version)?;
            } else {
                // @ref LLP 0264#d5-the-policy-check-is-central-and-exhaustive
                // — re-resolve the installed table policy below every
                // buffered producer, inside the transaction that commits.
                let table = schema_table(&schema, write.table())?;
                let form = match &write {
                    BufferedWrite::Insert { .. } => GenericTableWriteFormV1::Insert,
                    BufferedWrite::Patch { .. } => GenericTableWriteFormV1::Patch,
                    BufferedWrite::Delete { .. } => GenericTableWriteFormV1::Delete,
                };
                if let Some(owner_field) =
                    generic_owner_write_field(table, form)?.map(str::to_owned)
                {
                    match &mut write {
                        BufferedWrite::Insert { values, .. } => {
                            let principal = input.auth.user_id.as_deref().ok_or_else(|| {
                                SnapbackError::error(
                                    "SNAPBACK_AUTH_USER_MISSING",
                                    "auth",
                                    "an owner-policy insert requires an effective principal",
                                )
                                .with_details(json!({
                                    "table": table.name,
                                    "writeForm": "insert",
                                }))
                            })?;
                            if values.contains_key(&owner_field) {
                                return Err(SnapbackError::error(
                                    "SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED",
                                    "auth",
                                    "a buffered insert carried a non-authoritative owner value",
                                )
                                .with_details(json!({
                                    "table": table.name,
                                    "writeForm": "insert",
                                    "ownerField": owner_field,
                                })));
                            }
                            values.insert(owner_field, Value::String(principal.to_owned()));
                        }
                        BufferedWrite::Patch { values, .. } => {
                            if values.contains_key(&owner_field) {
                                return Err(SnapbackError::error(
                                    "SNAPBACK_TABLE_WRITE_OWNER_IMMUTABLE",
                                    "auth",
                                    "generic patches cannot change owner identity",
                                )
                                .with_details(json!({
                                    "table": table.name,
                                    "writeForm": "patch",
                                    "ownerField": owner_field,
                                })));
                            }
                        }
                        BufferedWrite::Delete { .. } => {}
                    }
                }
            }
            // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
            //   the writer-class seam. A raw `ctx.db` membership-table write, and
            //   a resource delete that would orphan memberships, are refused here
            //   below both buffered Ibex writes and HostPlan. `Sanctioned` writes
            //   come from the host-evaluated generated methods, which already
            //   authorized them.
            let guard_op = match &write {
                BufferedWrite::Insert { .. } => MembershipGuardOp::Insert,
                BufferedWrite::Patch { .. } => MembershipGuardOp::Patch,
                BufferedWrite::Delete { .. } => MembershipGuardOp::Delete,
            };
            enforce_membership_write_gate(
                &schema,
                &tx,
                write.table(),
                guard_op,
                Some(write.id()),
                write_gate,
            )?;
            match write {
                BufferedWrite::Insert { table, id, values } => {
                    let table = schema_table(&schema, &table)?;
                    if projection_sources.contains(&table.name) {
                        projection_pre_images
                            .entry((table.name.clone(), id.clone()))
                            .or_insert(None);
                    }
                    let changed_fields = changed_field_names(&values);
                    let document = insert_document(
                        &tx,
                        table,
                        &id,
                        &values,
                        next_version,
                        now_ms,
                        &self.order_field_bounds,
                    )?;
                    if let Some(draft) =
                        authority_transition_receipt_draft(table, None, Some(&document))?
                    {
                        authority_transition_drafts.push(draft);
                    }
                    write_membership_creation_provenance(&tx, table, &id, write_writer.as_ref())?;
                    record_membership_transition(
                        &tx,
                        table,
                        ChangeOp::Insert,
                        None,
                        Some(&document),
                        &changed_fields,
                        next_version,
                        write_writer.as_ref(),
                    )?;
                    record_change(
                        &tx,
                        next_version,
                        &table.name,
                        &id,
                        ChangeOp::Insert,
                        Some(&document),
                        now_ms,
                    )?;
                    changes.push(ChangedRow {
                        table: table.name.clone(),
                        id,
                        op: ChangeOp::Insert,
                        row: Some(document),
                        changed_fields,
                    });
                }
                BufferedWrite::Patch { table, id, values } => {
                    let table = schema_table(&schema, &table)?;
                    if values.is_empty() {
                        continue;
                    }
                    let before = get_document_from_tx(&tx, table, &id, next_version)?;
                    if write_gate == MembershipWriteGate::Deny {
                        if let Some(owner_field) =
                            generic_owner_write_field(table, GenericTableWriteFormV1::Patch)?
                        {
                            if !owner_row_matches(
                                before.as_ref(),
                                owner_field,
                                input.auth.user_id.as_deref(),
                            ) {
                                continue;
                            }
                        }
                    }
                    if projection_sources.contains(&table.name) {
                        projection_pre_images
                            .entry((table.name.clone(), id.clone()))
                            .or_insert_with(|| {
                                before.as_ref().and_then(|value| value.as_object().cloned())
                            });
                    }
                    let changed_fields = changed_field_names(&values);
                    if patch_document(
                        &tx,
                        table,
                        &id,
                        &values,
                        next_version,
                        now_ms,
                        &self.order_field_bounds,
                    )? {
                        let document = get_document_from_tx(&tx, table, &id, next_version)?;
                        if let Some(draft) = authority_transition_receipt_draft(
                            table,
                            before.as_ref(),
                            document.as_ref(),
                        )? {
                            authority_transition_drafts.push(draft);
                        }
                        record_membership_transition(
                            &tx,
                            table,
                            ChangeOp::Update,
                            before.as_ref(),
                            document.as_ref(),
                            &changed_fields,
                            next_version,
                            write_writer.as_ref(),
                        )?;
                        record_change(
                            &tx,
                            next_version,
                            &table.name,
                            &id,
                            ChangeOp::Update,
                            document.as_ref(),
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: table.name.clone(),
                            id,
                            op: ChangeOp::Update,
                            row: document,
                            changed_fields,
                        });
                    }
                }
                BufferedWrite::Delete { table, id } => {
                    let table = schema_table(&schema, &table)?;
                    let document = get_document_from_tx(&tx, table, &id, next_version)?;
                    if write_gate == MembershipWriteGate::Deny {
                        if let Some(owner_field) =
                            generic_owner_write_field(table, GenericTableWriteFormV1::Delete)?
                        {
                            if !owner_row_matches(
                                document.as_ref(),
                                owner_field,
                                input.auth.user_id.as_deref(),
                            ) {
                                continue;
                            }
                        }
                    }
                    if projection_sources.contains(&table.name)
                        && !projection_pre_images.contains_key(&(table.name.clone(), id.clone()))
                    {
                        projection_pre_images.insert(
                            (table.name.clone(), id.clone()),
                            document
                                .as_ref()
                                .and_then(|value| value.as_object().cloned()),
                        );
                    }
                    if delete_document(&tx, table, &id)? {
                        if let Some(draft) =
                            authority_transition_receipt_draft(table, document.as_ref(), None)?
                        {
                            authority_transition_drafts.push(draft);
                        }
                        record_membership_transition(
                            &tx,
                            table,
                            ChangeOp::Delete,
                            document.as_ref(),
                            None,
                            &[],
                            next_version,
                            write_writer.as_ref(),
                        )?;
                        record_change(
                            &tx,
                            next_version,
                            &table.name,
                            &id,
                            ChangeOp::Delete,
                            None,
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: table.name.clone(),
                            id,
                            op: ChangeOp::Delete,
                            row: document,
                            changed_fields: Vec::new(),
                        });
                    }
                }
            }
        }

        let mut asset_changes = BTreeSet::new();
        if let Some(media) = options.media_command {
            asset_changes.extend(execute_media_command_collection_step(
                &tx,
                &schema,
                media,
                input,
                &result,
                options.identity,
                next_version,
                now_ms,
                &self.order_field_bounds,
                &mut changes,
                check_live,
            )?);
        }

        asset_changes.extend(cascade_asset_collection_parent_deletions(
            &tx,
            &schema,
            &mut changes,
            next_version,
            now_ms,
        )?);

        // Re-evaluate the complete protected-holder invariant only when this
        // transaction changed a protected roster or its resource table. This
        // remains the serialized final-state linearization point for every
        // relevant app write without turning unrelated app mutations into an
        // all-resource scan; auth lifecycle writers run the same predicate in
        // their own serialized transaction.
        // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default
        let protected_membership_change = changes.iter().any(|change| {
            schema.tables.iter().any(|table| {
                let protects_final_state = table.authority_profile.is_some()
                    || table
                        .membership
                        .as_ref()
                        .is_some_and(|membership| membership.last_holder.is_some());
                protects_final_state
                    && (table.name == change.table
                        || table.membership.as_ref().is_some_and(|membership| {
                            membership.resource_table.as_deref() == Some(change.table.as_str())
                        }))
            })
        });
        if protected_membership_change {
            auth_agents::validate_protected_membership_final_state(&tx, &schema, next_version)?;
        }

        // @ref LLP 0080#5-transactionally-maintained-projections — the
        //   buffered (Ibex) tier maintains projections in the same commit,
        //   exactly like the HostPlan tier: one implementation, one bound.
        if !projections.is_empty() {
            maintain_projections_in_tx(
                &tx,
                &schema,
                &projections,
                &mut changes,
                &projection_pre_images,
                next_version,
                now_ms,
                &self.order_field_bounds,
                ProjectionEffectCeiling::MutationV1,
            )?;
        }
        maintain_derived_indexes_in_tx(&tx, &schema, &changes, next_version)?;

        // @ref LLP 0044#typed-references-and-atomic-attachment — the commit
        //   hook is the authority: every asset-field write in this changeset
        //   validates its admission and maintains its reverse edge here,
        //   inside the final write lock.
        enforce_asset_reference_changes(
            &schema,
            &tx,
            &changes,
            &crate::assets::AssetCommitAuthority {
                path: crate::assets::AssetWritePath::Handler,
                principal: input.auth.user_id.as_deref(),
                admissions: &asset_admissions,
            },
            now_ms,
        )?;

        // @ref LLP 0210#d5--recipient-scoped-authority-recipe-now-grant-ops-as-the-paved-spelling —
        // grant transitions share the app-write transaction and revalidate
        // owner/principal authority plus quota under this final write lock.
        let explicit_asset_changes = if asset_grant_ops.is_empty() {
            BTreeSet::new()
        } else {
            let principal = input.auth.user_id.as_deref().ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_GRANT_FORBIDDEN",
                    "assets",
                    "asset grant operations require an authenticated principal",
                )
            })?;
            asset_grants::apply_in_tx(&tx, principal, &asset_grant_ops)?
        };
        asset_changes.extend(explicit_asset_changes);

        apply_sequence_allocations_in_tx(&tx, &schema, &sequence_allocations)?;

        if !changes.is_empty() || !sequence_allocations.is_empty() || !asset_changes.is_empty() {
            set_version(&tx, next_version)?;
        }

        let version =
            if changes.is_empty() && sequence_allocations.is_empty() && asset_changes.is_empty() {
                current_version
            } else {
                next_version
            };
        // @ref LLP 0070#job-identity-and-enqueue — enqueue insertion shares
        // this exact transaction: a rollback (validation failure, dry-run, or
        // commit refusal) leaves no job. Runs after app writes so the stamped
        // producer snapshot version equals the receipt's snapshotVersion.
        let (job_enqueue_facts, job_changes) = if job_enqueues.is_empty() {
            (Vec::new(), Vec::new())
        } else {
            let producer = job_producer
                .as_ref()
                .expect("checked above: enqueues carry a producer");
            let status_rows =
                jobs::insert_enqueued_jobs_in_tx(&tx, producer, version, &job_enqueues, now_ms)?;
            let facts = status_rows
                .iter()
                .map(|row| jobs::JobEnqueueFact {
                    job_id: row.job_id.clone(),
                    action: row.action.clone(),
                    available_at_ms: row.available_at_ms,
                })
                .collect();
            let job_changes = status_rows
                .iter()
                .map(|row| ChangedRow {
                    table: jobs::JOBS_STATUS_TABLE.to_owned(),
                    id: row.job_id.clone(),
                    op: ChangeOp::Insert,
                    row: Some(row.to_row_value()),
                    changed_fields: Vec::new(),
                })
                .collect();
            (facts, job_changes)
        };

        // @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
        // — egress runs only after ordinary OCC admission and after this
        // transaction has installed app writes, reference edges, grants, and
        // system metadata. Preview borrows the shared proof; commit consumes
        // its one take-once authority.
        let settlement_media = match media_projection {
            Some(MediaProjectionProofAccess::Owned { proof, .. }) if options.apply => {
                let context = SettlementMediaContextV1 {
                    result_contract_hash: proof.result_contract_hash.clone(),
                    plan: proof.plan.clone(),
                };
                let occurrences = proof.consume_occurrences()?;
                materialize_provenanced_media_result_in_tx(
                    &tx,
                    &schema,
                    next_version,
                    &context.plan,
                    &occurrences,
                    &mut result,
                )?;
                Some(context)
            }
            Some(MediaProjectionProofAccess::Borrowed { proof, .. }) if !options.apply => {
                let context = SettlementMediaContextV1 {
                    result_contract_hash: proof.result_contract_hash.clone(),
                    plan: proof.plan.clone(),
                };
                materialize_provenanced_media_result_in_tx(
                    &tx,
                    &schema,
                    next_version,
                    &context.plan,
                    proof.borrow_occurrences(),
                    &mut result,
                )?;
                Some(context)
            }
            Some(_) => return Err(media_projection_unprovenanced()),
            None => None,
        };
        let mut output = MutationOutput {
            version,
            changed_count: changes.len(),
            result,
            authority_transitions: Vec::new(),
            ctx_ledger: options.ctx_ledger,
            settlement_mint_observations: Vec::new(),
            settlement_time_observation: None,
            settlement_sequence_allocations: sequence_allocations.clone(),
        };
        let authorization_predecessor = if options.apply {
            auth_stream::read_authorization_version_on(&tx)?
        } else {
            None
        };
        let authorization = if options.apply {
            Some(authorization::authorization_commit_hook_in(
                &tx,
                authorization::AuthorizationCommitCause::AppWrites {
                    schema: &schema,
                    changes: &changes,
                },
            )?)
        } else {
            None
        };
        let authority_invalidation_disposition = match authorization.as_ref() {
            Some(witness) if witness.event => {
                AuthorityInvalidationDispositionV1::GlobalAuthorizationEpochAdvanced
            }
            Some(_) => AuthorityInvalidationDispositionV1::NoAuthorizationEvent,
            None => AuthorityInvalidationDispositionV1::PreviewRolledBack,
        };
        let authority_transitions = authority_transition_drafts
            .into_iter()
            .map(|draft| draft.finish(authority_invalidation_disposition.clone()))
            .collect::<Vec<_>>();
        if options.apply {
            output.authority_transitions = authority_transitions.clone();
        }
        if options.apply {
            check_live()?;
            let prepared_authorization_commit = prepare_authorization_commit_interlock(
                authorization
                    .as_ref()
                    .expect("an applied mutation has an authorization witness"),
                AuthorizationCommitImpact::AppWrites {
                    schema: &schema,
                    changes: &changes,
                },
                authorization_interlock.as_ref(),
            )?;
            // No handler/plan or targeted room wait runs under this guard; it
            // linearizes only identity recording plus the final SQLite COMMIT.
            let _commit_guard = before_commit()?;
            check_live()?;
            if let Some(identity) = options.identity {
                operation_envelope_crash_cut(OperationEnvelopeCrashPointV1::BeforeSettlement)?;
                record_client_mutation_result(
                    &tx,
                    identity,
                    input,
                    &read_dependencies,
                    &changes,
                    &output,
                    settlement_media.as_ref(),
                )?;
            }
            if let Some(branch_operation) = options.branch_operation {
                crate::fork_promotion::record_branch_mutation_in(
                    &tx,
                    branch_operation,
                    version,
                    &changes,
                    &output,
                )?;
            }
            commit_with_prepared_authorization_interlock(
                tx,
                authorization
                    .as_ref()
                    .expect("an applied mutation has an authorization witness"),
                authorization_predecessor,
                version,
                prepared_authorization_commit,
            )?;
        } else {
            // Execute-and-discard (LLP 0051 D8): validated and applied above,
            // discarded here.
            tx.rollback()?;
        }

        Ok(MutationCommit {
            output,
            write_dependencies: captured_writes_from_changes(&changes),
            changes,
            read_dependencies,
            job_enqueues: job_enqueue_facts,
            job_changes,
            asset_changes: asset_changes.into_iter().collect(),
            sequence_allocations,
            authorization,
            authority_transitions,
            network_egress: Default::default(),
        })
    }

    fn configure(&mut self, file_backed: bool) -> SnapbackResult<()> {
        self.conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;
            ",
        )?;
        if file_backed {
            self.conn.execute_batch("PRAGMA journal_mode = WAL;")?;
            if self.replication_checkpoint_owner {
                crate::replication::configure_connection_wal_lifetime(&self.conn)?;
                self.conn.execute_batch("PRAGMA wal_autocheckpoint = 0;")?;
            }
        }
        Ok(())
    }

    fn create_infra(&mut self) -> SnapbackResult<()> {
        // @ref LLP 0003#database-model — the local SQLite core owns meta, version, and change tables.
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS _snapback_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            -- @ref LLP 0076#settlement-and-retry — the crash-safe write-ahead
            -- initiationState: a StreamAttemptV1 row is durably pre-marked
            -- before any request bytes reach the outbound stack, so a crash
            -- always leaves the conservative initiation_possible reading for
            -- the startup reconciler.
            CREATE TABLE IF NOT EXISTS _snapback_stream_attempts (
              token TEXT PRIMARY KEY,
              client_key TEXT NOT NULL UNIQUE,
              record_json TEXT NOT NULL,
              updated_at_ms INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS _snapback_version (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              version INTEGER NOT NULL
            );
            INSERT INTO _snapback_version(id, version)
            VALUES(1, 0)
            ON CONFLICT(id) DO NOTHING;
            CREATE TABLE IF NOT EXISTS _snapback_changes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              version INTEGER NOT NULL,
              table_name TEXT NOT NULL,
              row_id TEXT NOT NULL,
              op TEXT NOT NULL,
              row_json TEXT,
              changed_at_ms INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS _snapback_changes_by_version
              ON _snapback_changes(version, id);
            -- @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3: the
            -- per-mutation read-set validation runs MAX(version) WHERE
            -- table_name = ?, which was a full scan on the (version, id) index.
            CREATE INDEX IF NOT EXISTS _snapback_changes_by_table_version
              ON _snapback_changes(table_name, version);
            -- @ref LLP 0056#agents -- full membership provenance is an
            -- append-only durable record, including transitions whose source
            -- membership row is later deleted.
            CREATE TABLE IF NOT EXISTS _snapback_membership_transitions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              declaration_id TEXT NOT NULL,
              op TEXT NOT NULL,
              principal TEXT NOT NULL,
              resource TEXT,
              from_role TEXT,
              to_role TEXT,
              actor TEXT NOT NULL,
              effective TEXT NOT NULL,
              grant_id TEXT,
              commit_version INTEGER NOT NULL CHECK(commit_version >= 0),
              writer_class TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS _snapback_membership_transitions_by_declaration
              ON _snapback_membership_transitions(declaration_id, commit_version, id);
            -- LLP 0043 M2: exactly-once queued replay. The settled output and
            -- data changes are written in one SQLite transaction.
            CREATE TABLE IF NOT EXISTS _snapback_client_mutations (
              client_mutation_id TEXT PRIMARY KEY,
              function TEXT NOT NULL,
              auth_fingerprint TEXT NOT NULL,
              authority_instance_id TEXT,
              input_fingerprint TEXT NOT NULL,
              operation_issuance_json TEXT,
              output_json TEXT NOT NULL,
              settled_at_ms INTEGER NOT NULL,
              settled_version INTEGER NOT NULL DEFAULT 0,
              settled_version_exact INTEGER,
              settlement_format TEXT,
              settlement_record_sequence INTEGER,
              settlement_projection_seal_json TEXT
            );
            CREATE TABLE IF NOT EXISTS _snapback_client_mutation_auth_retention (
              auth_fingerprint TEXT PRIMARY KEY,
              records INTEGER NOT NULL CHECK(records >= 0),
              bytes INTEGER NOT NULL CHECK(bytes >= 0)
            );
            -- @ref LLP 0110#protected-relation-incarnation-and-stamping —
            -- delete/recreate of one logical id mints a distinct incarnation,
            -- so stale children never reconnect to its successor.
            CREATE TABLE IF NOT EXISTS _snapback_relation_incarnations_v1 (
              table_name TEXT NOT NULL,
              row_id TEXT NOT NULL,
              incarnation TEXT NOT NULL,
              active INTEGER NOT NULL CHECK(active IN (0, 1)),
              PRIMARY KEY(table_name, row_id, incarnation)
            );
            CREATE UNIQUE INDEX IF NOT EXISTS
              _snapback_relation_incarnations_v1_active
              ON _snapback_relation_incarnations_v1(table_name, row_id)
              WHERE active = 1;
            -- Enrollment is migration authority, distinct from incidental
            -- incarnation rows produced by the universal central writer.
            CREATE TABLE IF NOT EXISTS _snapback_sequence_scope_enrollments_v1 (
              table_name TEXT PRIMARY KEY,
              enrolled_by TEXT NOT NULL
            );
            -- @ref LLP 0135#11-counter-identity-and-scope — counter state is
            -- protected and keyed by the complete scope-incarnation identity;
            -- delete/recreate therefore starts a distinct counter at 1.
            CREATE TABLE IF NOT EXISTS _snapback_sequence_counters_v1 (
              counter_name TEXT NOT NULL,
              scope_table TEXT NOT NULL,
              scope_row_id TEXT NOT NULL,
              scope_incarnation TEXT NOT NULL,
              next_value INTEGER NOT NULL CHECK(next_value >= 1),
              PRIMARY KEY(counter_name, scope_table, scope_row_id, scope_incarnation)
            );
            -- @ref LLP 0053#invalidation-is-an-obligation-not-a-message —
            -- retry episodes are durable auth-control state, never outbox
            -- messages or process-local timer records.
            CREATE TABLE IF NOT EXISTS _snapback_auth_retry_episodes (
              authority_subject TEXT NOT NULL,
              client_store_id TEXT NOT NULL,
              query_key TEXT NOT NULL,
              episode_json TEXT NOT NULL,
              PRIMARY KEY(authority_subject, client_store_id, query_key)
            );
            CREATE TABLE IF NOT EXISTS _snapback_auth_retry_counters (
              authority_subject TEXT NOT NULL,
              client_store_id TEXT NOT NULL,
              records INTEGER NOT NULL CHECK(records >= 0),
              PRIMARY KEY(authority_subject, client_store_id)
            );
            -- @ref LLP 0053#the-lease-the-only-mechanism-for-the-unreachable-client —
            -- a request id is consumed only at the same linearization point
            -- that rechecks data/auth/activation and the server clock.
            CREATE TABLE IF NOT EXISTS _snapback_authorized_lease_reservations (
              lease_request_id TEXT PRIMARY KEY,
              lease_id TEXT NOT NULL UNIQUE,
              client_store_id TEXT NOT NULL,
              query_key TEXT NOT NULL,
              query_instance_id INTEGER NOT NULL CHECK(query_instance_id > 0),
              principal_id TEXT NOT NULL,
              authorization_incarnation TEXT NOT NULL,
              authorization_epoch INTEGER NOT NULL CHECK(authorization_epoch >= 0),
              version_stream TEXT NOT NULL,
              snapshot_commit_version INTEGER NOT NULL CHECK(snapshot_commit_version >= 0),
              activation_hash TEXT NOT NULL,
              issued_at_server_ms INTEGER NOT NULL CHECK(issued_at_server_ms >= 0),
              authorized_until_server_ms INTEGER NOT NULL CHECK(authorized_until_server_ms > issued_at_server_ms),
              lease_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS _snapback_authorized_lease_expiry
              ON _snapback_authorized_lease_reservations(authorized_until_server_ms);
            ",
        )?;
        crate::proof_checkpoint::create_history_infra(&self.conn)?;
        crate::proof_checkpoint::upgrade_checkpoint_erasure_infra_if_present(&self.conn)?;
        crate::search::sqlite::create_infra(&self.conn)?;
        crate::vector::sqlite::create_infra(&self.conn)?;
        // @ref LLP 0070#job-identity-and-enqueue — the durable one-off job and
        // append-only attempt tables live in the same SQLite database as
        // application data so `ctx.jobs.enqueue` inserts inside the mutation's
        // own transaction.
        jobs::create_jobs_infra(&self.conn)?;
        // Keep corruption preflights O(number of corrupt rows), which is zero
        // for every healthy database. MIN/MAX alone cannot detect an invalid
        // non-high-water predecessor, and scanning a table's entire journal on
        // every captured query would regress the indexed validation path.
        // @ref LLP 0007#commit-version-graduation-dk-2-decided-2026-07-02 —
        // every persisted ordering fact fails closed when consumed.
        let invalid_index_sql: Option<String> = self
            .conn
            .query_row(
                "SELECT sql FROM sqlite_schema \
                 WHERE type = 'index' \
                   AND name = '_snapback_changes_invalid_committed_version'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let expected_max = PORTABLE_STORAGE_VERSION_MAX.to_string();
        let current_predicate = invalid_index_sql.as_ref().is_some_and(|sql| {
            sql.contains("typeof(version) <> 'integer'")
                && sql.contains("version <= 0")
                && sql.contains(&format!("version > {expected_max}"))
        });
        if !current_predicate {
            // The first shipped sentinel used a different name and predicate;
            // an intermediate build may also have created the final name with
            // `< 0`. Rebuild transactionally so `IF NOT EXISTS` cannot preserve
            // an index that omits structurally impossible committed version 0.
            let tx = self
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            tx.execute(
                "DROP INDEX IF EXISTS _snapback_changes_invalid_committed_version",
                [],
            )?;
            tx.execute("DROP INDEX IF EXISTS _snapback_changes_invalid_version", [])?;
            tx.execute(
                &format!(
                    "CREATE INDEX _snapback_changes_invalid_committed_version \
                     ON _snapback_changes(table_name) \
                     WHERE typeof(version) <> 'integer' \
                        OR version <= 0 \
                        OR version > {PORTABLE_STORAGE_VERSION_MAX}"
                ),
                [],
            )?;
            tx.commit()?;
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        for table in physical_user_tables(&tx)? {
            if sqlite_table_columns(&tx, &table)?.contains("_version") {
                ensure_managed_version_integrity_indexes(&tx, &table)?;
            }
        }
        drop_stray_managed_version_integrity_indexes(&tx, None)?;
        tx.commit()?;
        // Older databases predate settlement and authority metadata. SQLite
        // cannot express ADD COLUMN IF NOT EXISTS, so reserve the writer before
        // inspecting and applying these additive ledger migrations. A sibling
        // opener then re-reads the post-commit schema instead of acting on a
        // stale PRAGMA result and failing with a duplicate-column error.
        //
        // @ref LLP 0003#database-model — infrastructure migration inspection
        // and its additive DDL share one serialized SQLite writer boundary.
        #[cfg(test)]
        notify_infra_migration_attempt(&self.conn);
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        #[cfg(test)]
        notify_infra_migration_acquired(&tx);
        let names = sqlite_table_columns(&tx, "_snapback_client_mutations")?;
        if !names.contains("settled_version") {
            tx.execute(
                "ALTER TABLE _snapback_client_mutations
                 ADD COLUMN settled_version INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        if !names.contains("authority_instance_id") {
            tx.execute(
                "ALTER TABLE _snapback_client_mutations
                 ADD COLUMN authority_instance_id TEXT",
                [],
            )?;
        }
        if !names.contains("settled_version_exact") {
            // @ref LLP 0043#milestone-2-queued-mutation-replay — NULL marks a
            // pre-migration row; every new row carries an authoritative exact
            // cursor, including the legitimate version-zero settlement.
            tx.execute(
                "ALTER TABLE _snapback_client_mutations
                 ADD COLUMN settled_version_exact INTEGER",
                [],
            )?;
        }
        if !names.contains("operation_issuance_json") {
            tx.execute(
                "ALTER TABLE _snapback_client_mutations
                 ADD COLUMN operation_issuance_json TEXT",
                [],
            )?;
        }
        if !names.contains("settlement_format") {
            tx.execute(
                "ALTER TABLE _snapback_client_mutations
                 ADD COLUMN settlement_format TEXT",
                [],
            )?;
        }
        if !names.contains("settlement_record_sequence") {
            tx.execute(
                "ALTER TABLE _snapback_client_mutations
                 ADD COLUMN settlement_record_sequence INTEGER",
                [],
            )?;
        }
        if !names.contains("settlement_projection_seal_json") {
            tx.execute(
                "ALTER TABLE _snapback_client_mutations
                 ADD COLUMN settlement_projection_seal_json TEXT",
                [],
            )?;
        }
        // @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
        // — one exclusive migration classifies the complete predecessor set;
        // legacy status is never inferred later from result bytes or null seal
        // fields.
        initialize_settlement_format_epoch_v1(&tx)?;
        tx.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS
               _snapback_client_mutations_by_record_sequence
             ON _snapback_client_mutations(settlement_record_sequence)",
            [],
        )?;
        tx.execute(
            "CREATE INDEX IF NOT EXISTS _snapback_client_mutations_by_settlement
             ON _snapback_client_mutations(settled_version, settled_at_ms)",
            [],
        )?;
        tx.execute(
            "CREATE INDEX IF NOT EXISTS _snapback_client_mutations_by_auth
             ON _snapback_client_mutations(auth_fingerprint)",
            [],
        )?;
        // @ref LLP 0109#151-active-identity-is-stream-keyed — future-unaware
        // predecessor resets remain safe because active identity is keyed by
        // the already-governed data-version stream.
        crate::seed_identity::create_infra(&tx)?;
        crate::assets::create_infra(&tx)?;
        crate::operation_ledger::create_infra(&tx)?;
        tx.commit()?;
        self.ensure_client_mutation_retention_counters()?;
        Ok(())
    }

    /// Install the O(1) retention-accounting metadata for old databases.
    /// Existing ledgers are scanned once when the formula version is old or a
    /// counter is absent/malformed; every later settlement, acknowledgement,
    /// and authority-wide collection uses that same versioned row formula.
    ///
    /// @ref LLP 0043#milestone-2-queued-mutation-replay — refusal limits and
    /// acknowledgement-driven GC must preserve exactly-once settlements.
    fn ensure_client_mutation_retention_counters(&mut self) -> SnapbackResult<()> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let version = optional_meta_u64_lenient(&tx, META_CLIENT_MUTATION_COUNTERS_VERSION)?;
        let records = optional_meta_u64_lenient(&tx, META_CLIENT_MUTATION_RECORDS)?;
        let bytes = optional_meta_u64_lenient(&tx, META_CLIENT_MUTATION_BYTES)?;
        if version != Some(CLIENT_MUTATION_COUNTERS_VERSION) || records.is_none() || bytes.is_none()
        {
            let (records, bytes) = scan_client_mutation_retention_totals(&tx)?;
            save_meta_u64(&tx, META_CLIENT_MUTATION_RECORDS, records)?;
            save_meta_u64(&tx, META_CLIENT_MUTATION_BYTES, bytes)?;
            tx.execute("DELETE FROM _snapback_client_mutation_auth_retention", [])?;
            let auth_fingerprints = {
                let mut statement = tx.prepare(
                    "SELECT DISTINCT auth_fingerprint
                       FROM _snapback_client_mutations
                      ORDER BY auth_fingerprint",
                )?;
                statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?
            };
            for auth_fingerprint in auth_fingerprints {
                let (records, bytes) =
                    scan_client_mutation_retention_totals_for_auth(&tx, Some(&auth_fingerprint))?;
                save_client_mutation_auth_retention_counters(
                    &tx,
                    &auth_fingerprint,
                    records,
                    bytes,
                )?;
            }
            save_meta_u64(
                &tx,
                META_CLIENT_MUTATION_COUNTERS_VERSION,
                CLIENT_MUTATION_COUNTERS_VERSION,
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

/// Continue settlement lookup through LLP 0163's retained operation state
/// after the full `_snapback_client_mutations` payload has been ACK-reclaimed
/// or operator-purged. This runs only after the caller has reconstructed the
/// complete bound identity; it is settlement lookup, never authorization.
///
/// @ref LLP 0162#1-the-universal-commit-envelope — suppression, then compact
///   envelope/tombstone, then epoch floor; a miss below the floor is
///   outcome-unknown and may not dispatch the handler.
fn covered_operation_recovery_result(
    conn: &Connection,
    identity: &ClientMutationIdentity,
) -> SnapbackResult<Option<MutationOutput>> {
    let Some(issuance) = identity.operation_issuance.clone() else {
        return Ok(None);
    };
    let Some(stream_id) = crate::seed_identity::strict_current_data_version_stream(conn)? else {
        return Ok(None);
    };
    let audience = crate::operation_ledger::resolve_operation_audience_for_lookup(
        conn,
        &issuance,
        &identity.authority_instance_id,
    )?;
    let operation = match issuance {
        crate::commit_envelope::OperationIssuanceV1::ClientRange { .. } => {
            crate::commit_envelope::OperationIdentityV1::from_client_mutation(
                stream_id,
                audience,
                issuance,
                identity,
                crate::operation_ledger::ORDINARY_MUTATION_LANE_V1,
            )
        }
        crate::commit_envelope::OperationIssuanceV1::HostIncarnation { .. } => {
            crate::commit_envelope::OperationIdentityV1::from_host_mutation(
                stream_id,
                audience,
                issuance,
                identity,
                crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1,
            )
        }
    };
    match crate::operation_ledger::lookup_operation(conn, &operation)? {
        crate::operation_ledger::OperationLookupV1::Novel => Ok(None),
        crate::operation_ledger::OperationLookupV1::ExactReplay(record) => {
            if record.terminal_outcome
                != crate::commit_envelope::OperationTerminalOutcomeV1::Committed
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_OPERATION_STORED_REFUSAL",
                    "sync",
                    "the covered operation retained a terminal refusal",
                ));
            }
            let retained: crate::commit_envelope::RetainedEnvelopeDetailV1 =
                serde_json::from_value(record.receipt_payload).map_err(|_| {
                    SnapbackError::error(
                        "SNAPBACK_OPERATION_RECEIPT_INVALID",
                        "storage",
                        "the retained operation receipt projection could not be decoded",
                    )
                })?;
            let receipt = match retained {
                crate::commit_envelope::RetainedEnvelopeDetailV1::InlineRedacted { detail } => {
                    detail
                }
                crate::commit_envelope::RetainedEnvelopeDetailV1::ProtectedLane {
                    custody_reference,
                    payload_digest,
                    ..
                } => crate::operation_detail::open(conn, &custody_reference, &payload_digest)?
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_OPERATION_PROTECTED_CUSTODY_UNAVAILABLE",
                            "storage",
                            "the retained operation receipt is unavailable from protected custody",
                        )
                    })?,
                crate::commit_envelope::RetainedEnvelopeDetailV1::Truncated
                | crate::commit_envelope::RetainedEnvelopeDetailV1::Expired => {
                    return Err(SnapbackError::error(
                        "SNAPBACK_OPERATION_RECEIPT_INVALID",
                        "storage",
                        "an exact-replay suppression receipt cannot be truncated or expired",
                    ));
                }
            };
            let output: MutationOutput = serde_json::from_value(receipt).map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_OPERATION_RECEIPT_INVALID",
                    "storage",
                    "the retained operation receipt could not be decoded",
                )
            })?;
            validate_storage_version_at_most(
                output.version,
                current_version_on(conn)?,
                "retained operation receipt version",
            )?;
            Ok(Some(output))
        }
        crate::operation_ledger::OperationLookupV1::ResultExpired {
            outcome,
            receipt_digest,
        } => Err(SnapbackError::error(
            "SNAPBACK_OPERATION_RESULT_EXPIRED",
            "sync",
            "the operation outcome is known but its result payload was reclaimed",
        )
        .with_details(json!({
            "disposition": "result-expired",
            "outcome": match outcome {
                crate::commit_envelope::OperationTerminalOutcomeV1::Committed => "committed",
                crate::commit_envelope::OperationTerminalOutcomeV1::Refused => "refused",
            },
            "receiptDigest": receipt_digest,
        }))),
        crate::operation_ledger::OperationLookupV1::IdentityHorizonPassed => {
            Err(SnapbackError::error(
                "SNAPBACK_OPERATION_IDENTITY_HORIZON_PASSED",
                "sync",
                "the identity epoch is below the retained outcome horizon",
            )
            .with_details(json!({
                "disposition": "identity-horizon-passed",
                "outcome": "unknown",
                "terminal": false,
            })))
        }
    }
}

fn load_schema_manifest_from_connection(
    conn: &Connection,
) -> SnapbackResult<Option<SchemaManifest>> {
    let has_meta = conn
        .query_row(
            "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '_snapback_meta'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !has_meta {
        return Ok(None);
    }

    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            params![META_SCHEMA_MANIFEST],
            |row| row.get(0),
        )
        .optional()?;

    value
        .map(|value| {
            serde_json::from_str(&value).map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_SCHEMA_PARSE_FAILED",
                    "schema",
                    "stored schema manifest could not be parsed",
                )
                .with_detail("error", error.to_string())
            })
        })
        .transpose()
}

/// Read the exact active schema across both legacy and capability-aware auth
/// modes without opening a writer. Derived proof oracles use this to decode
/// physical rows through the same portable type contract as ordinary reads.
pub(crate) fn active_schema_manifest_from_connection(
    conn: &Connection,
) -> SnapbackResult<Option<SchemaManifest>> {
    Ok(auth_mode::inspect_for_open(conn)?
        .active_manifest()
        .cloned())
}

/// Resolve one schema-checked room membership projection on any SQLite
/// connection. A read-lane caller supplies a pinned WAL transaction so the
/// permission row, data head, and authorization witness share one snapshot.
///
/// @ref LLP 0053#ephemeral-room-authority-invalidation — durable room
/// permission lookup must remain on the admitted side of the commit barrier.
pub(crate) fn room_permission_projection_granted_on(
    conn: &Connection,
    schema: &SchemaManifest,
    table_name: &str,
    subject_field: &str,
    user_id: &str,
    scope_fields: &[(String, String)],
    min_commit_version: u64,
) -> SnapbackResult<bool> {
    with_pinned_read_snapshot(conn, |conn| {
        let observed = current_version_on(conn)?;
        if observed < min_commit_version {
            return Err(SnapbackError::error(
                "SNAPBACK_EPHEMERAL_AUTHORITY_PENDING",
                "ephemeral",
                "durable permission snapshot has not reached the room authorization cause",
            )
            .with_detail("observedVersion", observed)
            .with_detail("minCommitVersion", min_commit_version));
        }
        let table = schema_table(schema, table_name)?;
        // The EXISTS result is authorization data. Validate the complete source
        // relation at the pinned head before SQL selection so a corrupt/future
        // row cannot grant authority and then disappear from result decoding.
        validate_managed_row_versions(conn, table, observed)?;
        ensure_field(table, subject_field)?;
        for (field, _) in scope_fields {
            ensure_field(table, field)?;
        }
        let mut predicates = vec![format!("{} = ?1", quote_ident(subject_field)?)];
        for (index, (field, _)) in scope_fields.iter().enumerate() {
            predicates.push(format!("{} = ?{}", quote_ident(field)?, index + 2));
        }
        let sql = format!(
            "SELECT EXISTS(SELECT 1 FROM {} WHERE {} LIMIT 1)",
            quote_ident(table_name)?,
            predicates.join(" AND ")
        );
        let values = std::iter::once(SqlValue::Text(user_id.to_owned()))
            .chain(
                scope_fields
                    .iter()
                    .map(|(_, value)| SqlValue::Text(value.clone())),
            )
            .collect::<Vec<_>>();
        let granted: i64 =
            conn.query_row(&sql, params_from_iter(values.iter()), |row| row.get(0))?;
        Ok(granted != 0)
    })
}

/// Execute one logical read against a single SQLite snapshot. Existing
/// transactions (the WAL reader lane and commit-time validation) are reused;
/// an autocommit connection receives a short deferred read transaction.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6 requires a
/// reported head and every head-bound row/authorization fact to share one
/// snapshot, including direct-library and mutation-planning reads.
fn with_pinned_read_snapshot<T>(
    conn: &Connection,
    read: impl FnOnce(&Connection) -> SnapbackResult<T>,
) -> SnapbackResult<T> {
    if !conn.is_autocommit() {
        return read(conn);
    }
    let tx = conn.unchecked_transaction()?;
    let output = read(&tx)?;
    tx.commit()?;
    Ok(output)
}

/// Read the complete durable authorization witness from the caller's pinned
/// transaction. Missing state is never interpreted as continuity.
pub(crate) fn authorization_version_on(conn: &Connection) -> SnapbackResult<AuthorizationVersion> {
    auth_stream::read_authorization_version_on(conn)?.ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_AUTHORIZATION_VERSION_CORRUPT",
            "auth",
            "authorization-version metadata is missing",
        )
    })
}

/// Read a query plan against any connection: shared by the write lane (the
/// live connection, serialized under the global mutex) and the read lane (a
/// pooled reader inside a pinned WAL read transaction). The version is read
/// before SQL selection so `_version` predicates and every returned row can be
/// checked against the same pinned snapshot head.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6: the
/// version/rows pair must come from one snapshot; the read lane guarantees it
/// with a pinned read transaction instead of the global mutex.
pub(crate) fn query_on(
    conn: &Connection,
    schema: &SchemaManifest,
    plan: &QueryPlan,
    input: &HandlerInput,
) -> SnapbackResult<QueryOutput> {
    query_on_with_storage_limit(conn, schema, plan, input, effective_query_limit(plan))
}

/// A `root-window-v1` keyset boundary: the order-key values and `_id` of the
/// last consumed root. `entries` aligns 1:1 with the plan's `order` fields —
/// a `Value::Null` entry marks a null/absent component, which sorts last
/// under either direction (`NULLS LAST`). The same shape serves both roles:
/// the verified boundary a presented cursor decodes to, and the continuation
/// the executor reports for the next mint.
///
/// @ref LLP 0080#2-portable-evaluation-semantics — continuation follows the
///   root order key from the last consumed root, including roots omitted by
///   an inner join; boundary keys may include fields the projection does not
///   expose.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct KeysetAfter {
    pub entries: Vec<(String, Value)>,
    pub id: String,
}

/// Lower a keyset boundary to one WHERE clause selecting rows strictly after
/// the boundary row under the plan's `(order…, _id ASC)` total order with
/// Snapback's `NULLS LAST` rule. Emitted as a disjunction of prefix-equality
/// clauses so it composes with mixed directions and null boundary
/// components; a plain SQL row-value comparison would inherit SQL null
/// semantics and skip rows.
fn build_keyset_after_sql(
    table: &TableManifest,
    order: &[OrderExpr],
    keyset: &KeysetAfter,
    filter_bindings: &mut usize,
) -> SnapbackResult<(String, Vec<SqlValue>)> {
    if keyset.entries.len() != order.len()
        || keyset
            .entries
            .iter()
            .zip(order)
            .any(|((field, _), order)| field != &order.field)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_KEYSET_INVALID",
            "query",
            "keyset boundary fields must match the plan's order fields exactly",
        ));
    }
    let id_value = Value::String(keyset.id.clone());
    validate_query_filter_value(table, "_id", &id_value)?;

    let mut disjuncts: Vec<String> = Vec::new();
    let mut values: Vec<SqlValue> = Vec::new();
    // Equality clauses (and their bound values) for the already-walked
    // prefix of the order key.
    let mut prefix_clauses: Vec<String> = Vec::new();
    let mut prefix_values: Vec<SqlValue> = Vec::new();

    for ((field, value), order) in keyset.entries.iter().zip(order) {
        ensure_orderable_field(table, field)?;
        validate_query_filter_value(table, field, value)?;
        let ident = quote_ident(field)?;
        let ftype = field_type(table, field);
        if value.is_null() {
            // Nothing sorts after a null component except by later
            // tie-breaks; contribute only the prefix equality.
            prefix_clauses.push(format!("{ident} IS NULL"));
            continue;
        }
        let comparator = match order.direction {
            OrderDirection::Asc => ">",
            OrderDirection::Desc => "<",
        };
        let mut clause = prefix_clauses.clone();
        clause.push(format!("({ident} {comparator} ? OR {ident} IS NULL)"));
        disjuncts.push(format!("({})", clause.join(" AND ")));
        add_query_filter_bindings(filter_bindings, prefix_values.len() + 1, field)?;
        values.extend(prefix_values.iter().cloned());
        values.push(json_to_sql_value(value, ftype)?);

        prefix_clauses.push(format!("{ident} = ?"));
        add_query_filter_bindings(filter_bindings, 1, field)?;
        prefix_values.push(json_to_sql_value(value, ftype)?);
    }

    let mut final_clause = prefix_clauses;
    final_clause.push("\"_id\" > ?".to_owned());
    disjuncts.push(format!("({})", final_clause.join(" AND ")));
    add_query_filter_bindings(filter_bindings, prefix_values.len() + 1, "_id")?;
    values.extend(prefix_values);
    values.push(json_to_sql_value(&id_value, None)?);

    Ok((format!("({})", disjuncts.join(" OR ")), values))
}

/// Validate a decoded cursor boundary against the plan's order schema and
/// build the executor keyset. Every failure means the presented cursor does
/// not fit this plan's order schema — the caller collapses it into the one
/// uniform `SNAPBACK_RELATIONAL_CURSOR_INVALID` refusal (LLP 0080 §2:
/// refused, never repositioned).
pub(crate) fn validate_relational_boundary(
    schema: &SchemaManifest,
    plan: &crate::manifest::RelationalQueryPlan,
    boundary: &[Value],
    id: &str,
) -> SnapbackResult<KeysetAfter> {
    validate_query_keyset_boundary(schema, &plan.root, &plan.order, boundary, id)
}

/// Validate an AEAD-decoded boundary for a closed query profile. This is the
/// common type/order check used by relational and bounded-children cursors;
/// callers still own their uniform public refusal.
pub(crate) fn validate_query_keyset_boundary(
    schema: &SchemaManifest,
    table_name: &str,
    order: &[OrderExpr],
    boundary: &[Value],
    id: &str,
) -> SnapbackResult<KeysetAfter> {
    let table = schema_table(schema, table_name)?;
    if boundary.len() != order.len() {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_KEYSET_INVALID",
            "query",
            "cursor boundary arity does not match the plan's order schema",
        ));
    }
    if id.is_empty() {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_KEYSET_INVALID",
            "query",
            "cursor boundary requires a non-empty _id tie-break",
        ));
    }
    let mut entries = Vec::with_capacity(boundary.len());
    for (value, order_entry) in boundary.iter().zip(order) {
        ensure_orderable_field(table, &order_entry.field)?;
        validate_query_filter_value(table, &order_entry.field, value)?;
        entries.push((order_entry.field.clone(), value.clone()));
    }
    Ok(KeysetAfter {
        entries,
        id: id.to_owned(),
    })
}

/// Validate a decoded standard-pattern cursor boundary against the declared
/// cursor field (LLP 0065): the value must be non-null (the field is
/// required by generation) and satisfy the field's declared type. Failures
/// collapse into the caller's uniform
/// `SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID`.
pub(crate) fn validate_standard_pattern_boundary(
    schema: &SchemaManifest,
    table: &str,
    cursor_field: &str,
    value: &Value,
) -> SnapbackResult<()> {
    let table = schema_table(schema, table)?;
    if value.is_null() {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_KEYSET_INVALID",
            "query",
            "standard-pattern cursor boundary cannot be null",
        ));
    }
    ensure_orderable_field(table, cursor_field)?;
    validate_query_filter_value(table, cursor_field, value)
}

// @ref LLP 0080#1-closed-relational-plan — runtime admission of the closed
//   plan shape: exactly one joined table, 1..=4 equality pairs, take in
//   0..=1024. Structural/type validation beyond this is generation's job;
//   the executor still fails closed on the load-bearing bounds.
fn validate_relational_plan_shape(
    plan: &crate::manifest::RelationalQueryPlan,
) -> SnapbackResult<()> {
    if plan.join_on.is_empty() || plan.join_on.len() > 4 {
        return Err(SnapbackError::error(
            "SNAPBACK_RELATIONAL_PLAN_INVALID",
            "query",
            format!(
                "relational plan requires 1..=4 join equality pairs, got {}",
                plan.join_on.len()
            ),
        ));
    }
    if plan.take > 1024 {
        return Err(SnapbackError::error(
            "SNAPBACK_RELATIONAL_PLAN_INVALID",
            "query",
            format!("relational take must be 0..=1024, got {}", plan.take),
        ));
    }
    if plan.root == plan.joined {
        return Err(SnapbackError::error(
            "SNAPBACK_RELATIONAL_PLAN_INVALID",
            "query",
            "relational root and joined tables must differ in v1".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn query_relational_on(
    db: &DbRead<'_>,
    plan: &crate::manifest::RelationalQueryPlan,
    input: &HandlerInput,
    cursor: Option<&KeysetAfter>,
) -> SnapbackResult<(QueryOutput, Option<KeysetAfter>)> {
    let (output, continuation, _) = query_relational_on_observed(db, plan, input, cursor)?;
    Ok((output, continuation))
}

/// Executor-owned work facts for one relational root window. The composite
/// executor consumes these facts immediately and refuses any implementation
/// drift beyond the owner-pinned per-node ceilings.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct RelationalExecutionObservation {
    pub(crate) examined_root_entries: usize,
    pub(crate) joined_lookups: usize,
}

/// Re-derive one source's restricted policy from the installed schema and
/// refuse any plan-carried disagreement before issuing SQL.
///
/// @ref LLP 0231#d3--composed-into-the-plan-sized-by-a-plan-class-model
fn compose_declared_table_visibility(
    schema: &SchemaManifest,
    table_name: &str,
    carried: &Option<crate::manifest::TableVisibilityV1>,
    surface: &str,
) -> SnapbackResult<Option<crate::manifest::TableVisibilityV1>> {
    let table = schema_table(schema, table_name)?;
    let expected = table
        .visibility
        .as_ref()
        .filter(|visibility| visibility.is_restricted())
        .cloned();
    if carried != &expected {
        return Err(SnapbackError::error(
            "SNAPBACK_TABLE_VISIBILITY_PLAN_MISMATCH",
            "auth",
            format!(
                "{surface} over {table_name} must carry the exact schema-derived restricted table visibility predicate"
            ),
        )
        .with_details(json!({
            "surface": surface,
            "table": table_name,
            "expected": expected,
            "actual": carried,
        })));
    }
    Ok(expected)
}

pub(crate) fn query_relational_on_observed(
    db: &DbRead<'_>,
    plan: &crate::manifest::RelationalQueryPlan,
    input: &HandlerInput,
    cursor: Option<&KeysetAfter>,
) -> SnapbackResult<(
    QueryOutput,
    Option<KeysetAfter>,
    RelationalExecutionObservation,
)> {
    use crate::manifest::{FilterExpr, JoinKind, ProjectionSource};

    validate_relational_plan_shape(plan)?;
    let root_table_visibility = compose_declared_table_visibility(
        db.schema(),
        &plan.root,
        &plan.root_table_visibility,
        "relational root",
    )?;
    let joined_table_visibility = compose_declared_table_visibility(
        db.schema(),
        &plan.joined,
        &plan.joined_table_visibility,
        "relational joined",
    )?;

    // take: 0 returns an empty page and consumes nothing (LLP 0080 §2), but
    // still reports the snapshot version so callers get a coherent cursor.
    let root_window = {
        let mut filters = plan.root_visibility.clone();
        filters.extend(plan.root_filters.iter().cloned());
        let root_plan = QueryPlan {
            // @ref LLP 0231#d3--composed-into-the-plan-sized-by-a-plan-class-model
            // The declared table policy is an additional conjunct beside the
            // relational surface's own root visibility and filters.
            table_visibility: root_table_visibility,
            table: plan.root.clone(),
            filters,
            order: plan.order.clone(),
            limit: Some(plan.take as usize),
            membership_filters: Vec::new(),
            indexed_by: Some(plan.root_index.clone()),
        };
        db.query_keyset(&root_plan, input, cursor)?
    };
    if plan.take == 0 {
        return Ok((
            QueryOutput {
                version: root_window.version,
                rows: Vec::new(),
                cursor: None,
            },
            None,
            RelationalExecutionObservation::default(),
        ));
    }

    // `take` bounds consumed authorized roots, not emitted rows. A full
    // window continues from the last consumed root — even when every root
    // in the window was omitted by an inner join — and a short window is
    // terminal (LLP 0080 §2).
    let continuation = if root_window.rows.len() == plan.take as usize {
        root_window.rows.last().map(|last| {
            let entries = plan
                .order
                .iter()
                .map(|order| {
                    (
                        order.field.clone(),
                        last.get(&order.field).cloned().unwrap_or(Value::Null),
                    )
                })
                .collect();
            let id = last
                .get("_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            KeysetAfter { entries, id }
        })
    } else {
        None
    };

    let mut rows = Vec::with_capacity(root_window.rows.len());
    let mut observation = RelationalExecutionObservation {
        examined_root_entries: root_window.rows.len(),
        joined_lookups: 0,
    };
    for root_row in &root_window.rows {
        // @ref LLP 0157#sbsb2-plaintext-and-budget — one joined-side
        // unique-key decision is charged for every consumed root, including
        // null-key and inner-omitted roots. This is the owner's separate work
        // axis; it never gets folded into examined root entries.
        observation.joined_lookups += 1;
        // A null (or absent) value in any join-key position never matches.
        let mut key_values = Vec::with_capacity(plan.join_on.len());
        let mut null_key = false;
        for pair in &plan.join_on {
            match root_row.get(&pair.root_field) {
                Some(value) if !value.is_null() => key_values.push(value.clone()),
                _ => {
                    null_key = true;
                    break;
                }
            }
        }
        let joined_row = if null_key {
            None
        } else {
            let mut filters: Vec<FilterExpr> = plan
                .join_on
                .iter()
                .zip(key_values)
                .map(|(pair, value)| FilterExpr {
                    field: pair.joined_field.clone(),
                    op: FilterOp::Eq,
                    value: ValueExpr::Literal(value),
                })
                .collect();
            filters.extend(plan.joined_visibility.iter().cloned());
            let lookup = QueryPlan {
                // @ref LLP 0231#d3--composed-into-the-plan-sized-by-a-plan-class-model
                // Hidden joined rows collapse through the same SQL predicate
                // as a single-table read, preserving LLP 0080 absent semantics.
                table_visibility: joined_table_visibility.clone(),
                table: plan.joined.clone(),
                filters,
                order: Vec::new(),
                // limit 2: a second row under the unique joined key is a
                // storage-invariant failure, never a first-row choice
                // (LLP 0080 §2).
                limit: Some(2),
                membership_filters: Vec::new(),
                indexed_by: Some(plan.joined_index.clone()),
            };
            let looked_up = db.query(&lookup, input)?;
            if looked_up.rows.len() > 1 {
                return Err(SnapbackError::error(
                    "SNAPBACK_RELATIONAL_DUPLICATE_UNIQUE_KEY",
                    "query",
                    format!(
                        "two joined rows in {} share the unique key of index {}; \
                         refusing rather than choosing a first row",
                        plan.joined, plan.joined_index
                    ),
                ));
            }
            looked_up.rows.into_iter().next()
        };

        // Invisible behaves as absent: the visibility filters above already
        // collapsed the two cases, so `inner` omits the root (short page, no
        // refill) and `left` nulls every joined leaf.
        if joined_row.is_none() && matches!(plan.join_kind, JoinKind::Inner) {
            continue;
        }

        // Field order inside the JSON value is serde-sorted here; the
        // declaration-order byte rule (RelationalResultEncodingV1) is the
        // wire encoder's contract, not the storage row's. Absent is
        // expressed by omission; a `left` join's missing joined row sets
        // every joined leaf to the null literal (LLP 0080 §2).
        let mut projected = Map::new();
        for leaf in &plan.projection {
            let value = match &leaf.source {
                ProjectionSource::Literal(value) => Some(value.clone()),
                ProjectionSource::RootField(field) => root_row.get(field).cloned(),
                ProjectionSource::JoinedField(field) => match &joined_row {
                    Some(row) => row.get(field).cloned(),
                    None => Some(Value::Null),
                },
            };
            if let Some(value) = value {
                projected.insert(leaf.name.clone(), value);
            }
        }
        rows.push(Value::Object(projected));
    }

    Ok((
        QueryOutput {
            version: root_window.version,
            rows,
            cursor: None,
        },
        continuation,
        observation,
    ))
}

pub(crate) fn query_on_with_storage_limit(
    conn: &Connection,
    schema: &SchemaManifest,
    plan: &QueryPlan,
    input: &HandlerInput,
    storage_limit: usize,
) -> SnapbackResult<QueryOutput> {
    query_on_with_storage_limit_visibility(conn, schema, plan, input, storage_limit, false)
}

/// Test-only instrumentation for the index-served root bound (LLP 0080
/// §Acceptance): each keyset-path query records its table, SQLite
/// fullscan steps, virtual-machine steps, and fetched rows so a witness
/// can prove examined entries stay within the admitted window and no
/// target scans to fill a page.
#[cfg(test)]
#[derive(Clone, Debug)]
pub(crate) struct KeysetScanStats {
    pub table: String,
    pub fullscan_steps: i32,
    pub vm_steps: i32,
    pub fetched_rows: usize,
}

#[cfg(test)]
thread_local! {
    static KEYSET_SCAN_STATS: RefCell<Vec<KeysetScanStats>> = const { RefCell::new(Vec::new()) };
}

#[cfg(test)]
pub(crate) fn take_keyset_scan_stats() -> Vec<KeysetScanStats> {
    KEYSET_SCAN_STATS.with(|stats| stats.borrow_mut().drain(..).collect())
}

/// The relational root window's entry: the generic validated query path with
/// an optional keyset boundary and the always-total `(order…, _id ASC)`
/// ordering `root-window-v1` continuation identity depends on.
pub(crate) fn query_on_keyset(
    conn: &Connection,
    schema: &SchemaManifest,
    plan: &QueryPlan,
    input: &HandlerInput,
    keyset: Option<&KeysetAfter>,
) -> SnapbackResult<QueryOutput> {
    query_on_with_storage_limit_visibility_keyset(
        conn,
        schema,
        plan,
        input,
        effective_query_limit(plan),
        false,
        keyset,
        true,
        None,
    )
}

fn query_on_with_storage_limit_visibility(
    conn: &Connection,
    schema: &SchemaManifest,
    plan: &QueryPlan,
    input: &HandlerInput,
    storage_limit: usize,
    allow_private_membership: bool,
) -> SnapbackResult<QueryOutput> {
    query_on_with_storage_limit_visibility_keyset(
        conn,
        schema,
        plan,
        input,
        storage_limit,
        allow_private_membership,
        None,
        false,
        None,
    )
}

fn query_on_with_examined_entry_ceiling(
    conn: &Connection,
    schema: &SchemaManifest,
    plan: &QueryPlan,
    input: &HandlerInput,
    examined_entry_ceiling: usize,
) -> SnapbackResult<QueryOutput> {
    query_on_with_storage_limit_visibility_keyset(
        conn,
        schema,
        plan,
        input,
        effective_query_limit(plan),
        false,
        None,
        false,
        Some(examined_entry_ceiling),
    )
}

#[allow(clippy::too_many_arguments)]
fn query_on_with_storage_limit_visibility_keyset(
    conn: &Connection,
    schema: &SchemaManifest,
    plan: &QueryPlan,
    input: &HandlerInput,
    storage_limit: usize,
    allow_private_membership: bool,
    keyset: Option<&KeysetAfter>,
    force_id_order: bool,
    examined_entry_ceiling: Option<usize>,
) -> SnapbackResult<QueryOutput> {
    with_pinned_read_snapshot(conn, |conn| {
        crate::exec_guard::debug_assert_off_async_worker("a SQLite query");
        // The query lane consults the persisted migration fence in its own
        // snapshot (LLP 0081 §4's lane registry, enforced per admission).
        migration_executor::ensure_migration_fence_open(conn)?;
        let snapshot_version = current_version_on(conn)?;
        let table = schema_table(schema, &plan.table)?;
        validate_query_plan_shape(plan)?;
        // Membership declarations are authorization data and have no public
        // roster-visibility preset in v1. Refuse every generic primary-table read
        // at the storage boundary, including pinned/live/replay callers. Internal
        // declaration-bound semi-joins are lowered below this boundary and remain
        // deliberately non-recursive.
        // @ref LLP 0056#declaring-a-membership-table — private by default.
        if !allow_private_membership && let Some(membership) = &table.membership {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_READ_PRIVATE",
                &table.name,
                membership.effective_id(&table.name),
                "a membership table cannot be the primary table of a generic query without an explicit visibility preset",
            ));
        }
        // LLP 0056 M3: fail-closed validation of each declaration-bound membership
        // predicate against the schema and the queried table — an unknown
        // declaration, an out-of-vocabulary `hasRole`, or a resource row field that
        // is not a field of the queried table is refused before the query runs.
        for predicate in &plan.membership_filters {
            crate::membership_rules::validate_membership_predicate(schema, table, predicate)?;
            // Correlated membership rows influence which primary rows survive but
            // are not themselves decoded below. Preflight the declaration table at
            // the same pinned head so corrupt authorization data cannot become an
            // invisible SQL-selection side channel.
            let (membership_table, _) =
                crate::membership_rules::find_declaration(schema, &predicate.declaration)
                    .expect("validated membership predicate resolves its declaration");
            validate_managed_row_versions(conn, membership_table, snapshot_version)?;
        }
        if let Some(visibility) = &plan.table_visibility {
            for predicate in visibility.membership_predicates() {
                crate::membership_rules::validate_membership_predicate(schema, table, &predicate)?;
                let (membership_table, _) =
                    crate::membership_rules::find_declaration(schema, &predicate.declaration)
                        .expect("validated table-visibility predicate resolves its declaration");
                validate_managed_row_versions(conn, membership_table, snapshot_version)?;
            }
        }
        if storage_limit > QUERY_INTERNAL_OVERFETCH_MAX {
            return Err(SnapbackError::error(
                "SNAPBACK_QUERY_LIMIT_INVALID",
                "query",
                format!(
                    "internal query overfetch {storage_limit} exceeds {QUERY_INTERNAL_OVERFETCH_MAX}"
                ),
            ));
        }
        validate_query_index(table, plan)?;
        if query_uses_row_version_for_selection(plan) {
            validate_managed_row_versions(conn, table, snapshot_version)?;
        }
        let (sql, values) = build_query_sql(
            table,
            schema,
            plan,
            input,
            &BTreeMap::new(),
            None,
            now_millis(),
            None,
            "query",
            Some(storage_limit),
            keyset,
            force_id_order,
            examined_entry_ceiling.map(|_| "__snapback_single_table_examined_entry_guard"),
        )?;
        let examined_entry_guard_exceeded =
            std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        if let Some(ceiling) = examined_entry_ceiling {
            let examined = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let exceeded = examined_entry_guard_exceeded.clone();
            conn.create_scalar_function(
                "__snapback_single_table_examined_entry_guard",
                0,
                rusqlite::functions::FunctionFlags::SQLITE_UTF8
                    | rusqlite::functions::FunctionFlags::SQLITE_DIRECTONLY,
                move |_| {
                    let entry = examined.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                    if entry > ceiling {
                        exceeded.store(true, std::sync::atomic::Ordering::Relaxed);
                        return Err(rusqlite::Error::UserFunctionError(Box::new(
                            std::io::Error::other("single-table examined-entry ceiling exceeded"),
                        )));
                    }
                    Ok(1_i64)
                },
            )?;
        }
        let mut statement = conn.prepare(&sql)?;
        let columns = statement
            .column_names()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        let mut rows = statement.query(params_from_iter(values.iter()))?;
        let mut output = Vec::new();

        loop {
            let row = match rows.next() {
                Ok(Some(row)) => row,
                Ok(None) => break,
                Err(_)
                    if examined_entry_guard_exceeded.load(std::sync::atomic::Ordering::Relaxed) =>
                {
                    // @ref LLP 0004#dated-owner-amendment-single_table_v11-2026-08-03 —
                    // the non-deterministic SQL guard is the first WHERE term,
                    // so entry 1,025 refuses before application predicates can
                    // examine it. Only the node-class entry point injects it.
                    return Err(SnapbackError::error(
                        "SNAPBACK_SINGLE_TABLE_EXAMINED_ENTRY_CEILING_EXCEEDED",
                        "query",
                        format!(
                            "single-table establishment would examine more than {} storage entries",
                            examined_entry_ceiling.expect("exceeded guard has a ceiling")
                        ),
                    )
                    .with_details(serde_json::json!({
                        "examinedEntryCeiling": examined_entry_ceiling,
                    })));
                }
                Err(error) => return Err(error.into()),
            };
            let mut document = row_to_document(row, table, &columns)?;
            project_media_fields_on(conn, table, &mut document)?;
            validate_document_version_at_most(&document, snapshot_version, &table.name)?;
            output.push(document);
        }
        drop(rows);
        #[cfg(test)]
        {
            let fullscan_steps = statement.get_status(rusqlite::StatementStatus::FullscanStep);
            KEYSET_SCAN_STATS.with(|stats| {
                stats.borrow_mut().push(KeysetScanStats {
                    table: table.name.clone(),
                    fullscan_steps,
                    vm_steps: statement.get_status(rusqlite::StatementStatus::VmStep),
                    fetched_rows: output.len(),
                });
            });
        }

        Ok(QueryOutput {
            version: snapshot_version,
            rows: output,
            cursor: None,
        })
    })
}

pub(crate) fn get_on(
    conn: &Connection,
    schema: &SchemaManifest,
    table: &str,
    id: &str,
) -> SnapbackResult<Option<Value>> {
    with_pinned_read_snapshot(conn, |conn| {
        crate::exec_guard::debug_assert_off_async_worker("a SQLite point read");
        let snapshot_version = current_version_on(conn)?;
        let table = schema_table(schema, table)?;
        if let Some(membership) = &table.membership {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_READ_PRIVATE",
                &table.name,
                membership.effective_id(&table.name),
                "a membership table cannot be read through the generic point-read surface without an explicit visibility preset",
            ));
        }
        let sql = format!("SELECT * FROM {} WHERE _id = ?1", quote_ident(&table.name)?);
        let mut statement = conn.prepare(&sql)?;
        let columns = statement
            .column_names()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        let mut rows = statement.query(params![id])?;
        if let Some(row) = rows.next()? {
            let mut document = row_to_document(row, table, &columns)?;
            project_media_fields_on(conn, table, &mut document)?;
            validate_point_read_identity(&document, id, &table.name)?;
            validate_document_version_at_most(&document, snapshot_version, &table.name)?;
            Ok(Some(document))
        } else {
            Ok(None)
        }
    })
}

pub(crate) fn get_many_on(
    conn: &Connection,
    schema: &SchemaManifest,
    table: &str,
    ids: &[String],
) -> SnapbackResult<Vec<Option<Value>>> {
    let table = schema_table(schema, table)?;
    if let Some(membership) = &table.membership {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_READ_PRIVATE",
            &table.name,
            membership.effective_id(&table.name),
            "a membership table cannot be read through the generic batch-read surface without an explicit visibility preset",
        ));
    }
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let distinct = ids.iter().cloned().collect::<BTreeSet<_>>();
    with_pinned_read_snapshot(conn, |conn| {
        crate::exec_guard::debug_assert_off_async_worker("a SQLite batch point read");
        let snapshot_version = current_version_on(conn)?;
        let placeholders = (1..=distinct.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT * FROM {} WHERE _id IN ({placeholders})",
            quote_ident(&table.name)?
        );
        let values = distinct
            .iter()
            .cloned()
            .map(SqlValue::Text)
            .collect::<Vec<_>>();
        let mut statement = conn.prepare(&sql)?;
        let columns = statement
            .column_names()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        let mut rows = statement.query(params_from_iter(values.iter()))?;
        let mut documents = BTreeMap::new();
        while let Some(row) = rows.next()? {
            let document = row_to_document(row, table, &columns)?;
            let id = document
                .get("_id")
                .and_then(Value::as_str)
                .ok_or_else(|| point_read_identity_corrupt(&table.name))?;
            if !distinct.contains(id) {
                return Err(point_read_identity_corrupt(&table.name));
            }
            validate_point_read_identity(&document, id, &table.name)?;
            validate_document_version_at_most(&document, snapshot_version, &table.name)?;
            documents.insert(id.to_owned(), document);
        }
        Ok(ids.iter().map(|id| documents.get(id).cloned()).collect())
    })
}

#[derive(Clone, Debug)]
struct PreparedUniqueManyKey {
    identity: String,
    values: Vec<SqlValue>,
}

fn unique_many_key_identity(values: &[Value]) -> SnapbackResult<String> {
    crate::rqs_contract::jcs(&Value::Array(values.to_vec())).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_BATCH_READ_KEY_INVALID",
            "storage",
            "ctx.db.uniqueMany key could not be canonically encoded",
        )
    })
}

fn prepare_unique_many_keys(
    table: &TableManifest,
    index_name: &str,
    keys: &[Map<String, Value>],
) -> SnapbackResult<(
    crate::contract_types::IndexManifest,
    Vec<PreparedUniqueManyKey>,
)> {
    validate_user_identifier("index", index_name)?;
    let Some(index) = table.indexes.iter().find(|index| index.name == index_name) else {
        return Err(SnapbackError::error(
            "SNAPBACK_BATCH_READ_INDEX_INVALID",
            "storage",
            format!(
                "ctx.db.uniqueMany names unknown index {index_name:?} on table {:?}",
                table.name
            ),
        )
        .with_details(json!({
            "table": table.name,
            "requestedIndex": index_name,
            "knownUniqueIndexes": table.indexes.iter().filter(|index| index.unique).map(|index| &index.name).collect::<Vec<_>>(),
            "reason": "unknown-index",
        })));
    };
    if !index.unique {
        return Err(SnapbackError::error(
            "SNAPBACK_BATCH_READ_INDEX_INVALID",
            "storage",
            format!(
                "ctx.db.uniqueMany requires a declared unique index; {}.{} is non-unique",
                table.name, index.name
            ),
        )
        .with_details(json!({
            "table": table.name,
            "requestedIndex": index_name,
            "reason": "non-unique-index",
        })));
    }
    let expected = index.fields.iter().cloned().collect::<BTreeSet<_>>();
    let mut prepared = Vec::with_capacity(keys.len());
    for (position, key) in keys.iter().enumerate() {
        let actual = key.keys().cloned().collect::<BTreeSet<_>>();
        if actual != expected {
            return Err(SnapbackError::error(
                "SNAPBACK_BATCH_READ_KEY_INVALID",
                "storage",
                "ctx.db.uniqueMany key must contain exactly the declared index components",
            )
            .with_details(json!({
                "table": table.name,
                "index": index.name,
                "position": position,
                "expectedFields": index.fields,
                "actualFields": key.keys().collect::<Vec<_>>(),
                "reason": "component-set-mismatch",
            })));
        }
        let mut canonical_values = Vec::with_capacity(index.fields.len());
        let mut sql_values = Vec::with_capacity(index.fields.len());
        for field_name in &index.fields {
            let value = key
                .get(field_name)
                .expect("component-set equality proves every declared field is present");
            // @ref LLP 0248#d2-complete-unique-index-batch-reads — a
            // unique-where-applicable key addresses no row unless every
            // declared component participates in the uniqueness invariant.
            if index.where_applicable && value.is_null() {
                return Err(SnapbackError::error(
                    "SNAPBACK_BATCH_READ_KEY_INVALID",
                    "storage",
                    "ctx.db.uniqueMany whereApplicable key components must be present and non-null",
                )
                .with_details(json!({
                    "table": table.name,
                    "index": index.name,
                    "position": position,
                    "field": field_name,
                    "reason": "where-applicable-component-null",
                })));
            }
            validate_query_filter_value(table, field_name, value).map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_BATCH_READ_KEY_INVALID",
                    "storage",
                    "ctx.db.uniqueMany key component is incompatible with its declared field type",
                )
                .with_details(json!({
                    "table": table.name,
                    "index": index.name,
                    "position": position,
                    "field": field_name,
                    "reason": "component-type-invalid",
                    "cause": error.diagnostic.code,
                }))
            })?;
            let field_type = table.field(field_name).map(|field| &field.field_type);
            canonical_values.push(value.clone());
            sql_values.push(json_to_sql_value(value, field_type)?);
        }
        prepared.push(PreparedUniqueManyKey {
            identity: unique_many_key_identity(&canonical_values)?,
            values: sql_values,
        });
    }
    Ok((index.clone(), prepared))
}

pub(crate) fn unique_many_on(
    conn: &Connection,
    schema: &SchemaManifest,
    table_name: &str,
    index_name: &str,
    keys: &[Map<String, Value>],
) -> SnapbackResult<Vec<Option<Value>>> {
    let table = schema_table(schema, table_name)?;
    if let Some(membership) = &table.membership {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_READ_PRIVATE",
            &table.name,
            membership.effective_id(&table.name),
            "a membership table cannot be read through the generic batch-read surface without an explicit visibility preset",
        ));
    }
    // All manifest/key validation intentionally precedes the first SQLite
    // operation. The host has already enforced item/canonical-byte bounds.
    let (index, prepared) = prepare_unique_many_keys(table, index_name, keys)?;
    if prepared.is_empty() {
        return Ok(Vec::new());
    }
    let mut distinct = BTreeMap::new();
    for key in &prepared {
        distinct
            .entry(key.identity.clone())
            .or_insert_with(|| key.values.clone());
    }
    with_pinned_read_snapshot(conn, |conn| {
        crate::exec_guard::debug_assert_off_async_worker("a SQLite unique batch read");
        let snapshot_version = current_version_on(conn)?;
        let max_keys_per_statement = (999 / index.fields.len().max(1)).max(1);
        let distinct_entries = distinct.iter().collect::<Vec<_>>();
        let mut documents = BTreeMap::new();
        for chunk in distinct_entries.chunks(max_keys_per_statement) {
            let mut predicates = Vec::with_capacity(chunk.len());
            let mut values = Vec::with_capacity(chunk.len() * index.fields.len());
            for (_, components) in chunk {
                let mut terms = Vec::with_capacity(index.fields.len());
                for (field, value) in index.fields.iter().zip(components.iter()) {
                    terms.push(format!("{} = ?", quote_ident(field)?));
                    values.push(value.clone());
                }
                predicates.push(format!("({})", terms.join(" AND ")));
            }
            let sql = format!(
                "SELECT * FROM {} WHERE {}",
                quote_ident(&table.name)?,
                predicates.join(" OR ")
            );
            let mut statement = conn.prepare(&sql)?;
            let columns = statement
                .column_names()
                .into_iter()
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>();
            let mut rows = statement.query(params_from_iter(values.iter()))?;
            while let Some(row) = rows.next()? {
                let document = row_to_document(row, table, &columns)?;
                let id = document
                    .get("_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| point_read_identity_corrupt(&table.name))?;
                validate_point_read_identity(&document, id, &table.name)?;
                validate_document_version_at_most(&document, snapshot_version, &table.name)?;
                let key_values = index
                    .fields
                    .iter()
                    .map(|field| document.get(field).cloned().unwrap_or(Value::Null))
                    .collect::<Vec<_>>();
                let identity = unique_many_key_identity(&key_values)?;
                if documents.insert(identity, document).is_some() {
                    return Err(SnapbackError::error(
                        "SNAPBACK_BATCH_READ_UNIQUE_INVARIANT_CORRUPT",
                        "storage",
                        "ctx.db.uniqueMany observed more than one row for a declared unique key",
                    )
                    .with_details(json!({ "table": table.name, "index": index.name })));
                }
            }
        }
        Ok(prepared
            .iter()
            .map(|key| documents.get(&key.identity).cloned())
            .collect())
    })
}

pub(crate) fn current_version_on(conn: &Connection) -> SnapbackResult<u64> {
    crate::exec_guard::debug_assert_off_async_worker("a SQLite version read");
    let version: Option<SqlValue> = conn
        .query_row(
            "SELECT version FROM _snapback_version WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let Some(version) = version else {
        return Err(SnapbackError::error(
            "SNAPBACK_STORAGE_VERSION_CORRUPT",
            "storage",
            "global storage version row is missing",
        ));
    };
    let version = decode_required_storage_version(version, "global storage version")?;
    #[cfg(test)]
    notify_storage_read_snapshot_pinned(conn, version);
    Ok(version)
}

#[cfg(test)]
struct StorageReadSnapshotDebugHook {
    token: Uuid,
    reached: mpsc::Sender<u64>,
    release: mpsc::Receiver<()>,
}

#[cfg(test)]
static STORAGE_READ_SNAPSHOT_DEBUG_HOOKS: OnceLock<
    Mutex<BTreeMap<String, StorageReadSnapshotDebugHook>>,
> = OnceLock::new();

#[cfg(test)]
pub(crate) struct StorageReadSnapshotDebugHookGuard {
    path: String,
    token: Uuid,
}

#[cfg(test)]
impl Drop for StorageReadSnapshotDebugHookGuard {
    fn drop(&mut self) {
        let mut hooks = storage_read_snapshot_debug_hooks()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if hooks
            .get(&self.path)
            .is_some_and(|hook| hook.token == self.token)
        {
            hooks.remove(&self.path);
        }
    }
}

#[cfg(test)]
pub(crate) fn set_storage_read_snapshot_debug_hook(
    db: &LocalDatabase,
    reached: mpsc::Sender<u64>,
    release: mpsc::Receiver<()>,
) -> StorageReadSnapshotDebugHookGuard {
    let path = db
        .conn
        .path()
        .expect("file-backed storage snapshot hook requires a database path")
        .to_owned();
    let token = Uuid::now_v7();
    let previous = storage_read_snapshot_debug_hooks()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(
            path.clone(),
            StorageReadSnapshotDebugHook {
                token,
                reached,
                release,
            },
        );
    assert!(
        previous.is_none(),
        "storage snapshot hook path already in use"
    );
    StorageReadSnapshotDebugHookGuard { path, token }
}

#[cfg(test)]
fn storage_read_snapshot_debug_hooks()
-> &'static Mutex<BTreeMap<String, StorageReadSnapshotDebugHook>> {
    STORAGE_READ_SNAPSHOT_DEBUG_HOOKS.get_or_init(|| Mutex::new(BTreeMap::new()))
}

#[cfg(test)]
fn notify_storage_read_snapshot_pinned(conn: &Connection, version: u64) {
    let hook = {
        let mut hooks = storage_read_snapshot_debug_hooks()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        conn.path().and_then(|path| hooks.remove(path))
    };
    if let Some(hook) = hook
        && hook.reached.send(version).is_ok()
    {
        let _ = hook
            .release
            .recv_timeout(std::time::Duration::from_secs(10));
    }
}

#[cfg(test)]
struct CommitVersionSampleDebugHook {
    path: String,
    reached: mpsc::Sender<()>,
    release: mpsc::Receiver<()>,
}

#[cfg(test)]
static COMMIT_VERSION_SAMPLE_DEBUG_HOOK: OnceLock<Mutex<Option<CommitVersionSampleDebugHook>>> =
    OnceLock::new();

#[cfg(test)]
struct CommitVersionSampleDebugHookGuard;

#[cfg(test)]
impl Drop for CommitVersionSampleDebugHookGuard {
    fn drop(&mut self) {
        *commit_version_sample_debug_hook()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    }
}

#[cfg(test)]
fn set_commit_version_sample_debug_hook(
    conn: &Connection,
    reached: mpsc::Sender<()>,
    release: mpsc::Receiver<()>,
) -> CommitVersionSampleDebugHookGuard {
    let path = conn
        .path()
        .expect("commit-version sample hook requires a file-backed database")
        .to_owned();
    *commit_version_sample_debug_hook()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(CommitVersionSampleDebugHook {
        path,
        reached,
        release,
    });
    CommitVersionSampleDebugHookGuard
}

#[cfg(test)]
fn commit_version_sample_debug_hook() -> &'static Mutex<Option<CommitVersionSampleDebugHook>> {
    COMMIT_VERSION_SAMPLE_DEBUG_HOOK.get_or_init(|| Mutex::new(None))
}

#[cfg(test)]
fn notify_commit_version_sampled(conn: &Connection) {
    let hook = {
        let mut slot = commit_version_sample_debug_hook()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if slot
            .as_ref()
            .is_some_and(|hook| conn.path() == Some(hook.path.as_str()))
        {
            slot.take()
        } else {
            None
        }
    };
    if let Some(hook) = hook
        && hook.reached.send(()).is_ok()
    {
        let _ = hook
            .release
            .recv_timeout(std::time::Duration::from_secs(10));
    }
}

#[cfg(test)]
struct InfraMigrationDebugHook {
    token: Uuid,
    path: String,
    attempts: mpsc::Sender<()>,
    attempt_proceeded: mpsc::Sender<()>,
    attempt_permits: Vec<mpsc::Receiver<()>>,
    acquired: mpsc::Sender<()>,
    release: Option<mpsc::Receiver<()>>,
}

#[cfg(test)]
static INFRA_MIGRATION_DEBUG_HOOK: OnceLock<Mutex<Option<InfraMigrationDebugHook>>> =
    OnceLock::new();

#[cfg(test)]
struct InfraMigrationDebugHookGuard {
    token: Uuid,
}

#[cfg(test)]
impl Drop for InfraMigrationDebugHookGuard {
    fn drop(&mut self) {
        let mut slot = infra_migration_debug_hook()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if slot.as_ref().is_some_and(|hook| hook.token == self.token) {
            *slot = None;
        }
    }
}

#[cfg(test)]
fn set_infra_migration_debug_hook(
    conn: &Connection,
    attempts: mpsc::Sender<()>,
    attempt_proceeded: mpsc::Sender<()>,
    attempt_permits: Vec<mpsc::Receiver<()>>,
    acquired: mpsc::Sender<()>,
    release: mpsc::Receiver<()>,
) -> InfraMigrationDebugHookGuard {
    let token = Uuid::now_v7();
    let hook = InfraMigrationDebugHook {
        token,
        path: conn
            .path()
            .expect("infrastructure migration hook requires a file-backed database")
            .to_owned(),
        attempts,
        attempt_proceeded,
        attempt_permits,
        acquired,
        release: Some(release),
    };
    let previous = infra_migration_debug_hook()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .replace(hook);
    assert!(
        previous.is_none(),
        "infrastructure migration hook already installed"
    );
    InfraMigrationDebugHookGuard { token }
}

#[cfg(test)]
fn infra_migration_debug_hook() -> &'static Mutex<Option<InfraMigrationDebugHook>> {
    INFRA_MIGRATION_DEBUG_HOOK.get_or_init(|| Mutex::new(None))
}

#[cfg(test)]
fn notify_infra_migration_attempt(conn: &Connection) {
    let rendezvous = {
        let mut slot = infra_migration_debug_hook()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        slot.as_mut()
            .filter(|hook| conn.path() == Some(hook.path.as_str()))
            .and_then(|hook| {
                if hook.attempt_permits.is_empty() {
                    return None;
                }
                Some((
                    hook.attempts.clone(),
                    hook.attempt_proceeded.clone(),
                    hook.attempt_permits.remove(0),
                ))
            })
    };
    if let Some((attempts, proceeded, permit)) = rendezvous
        && attempts.send(()).is_ok()
        && permit
            .recv_timeout(std::time::Duration::from_secs(10))
            .is_ok()
    {
        let _ = proceeded.send(());
    }
}

#[cfg(test)]
fn notify_infra_migration_acquired(conn: &Connection) {
    let rendezvous = {
        let mut slot = infra_migration_debug_hook()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        slot.as_mut()
            .filter(|hook| conn.path() == Some(hook.path.as_str()))
            .map(|hook| (hook.acquired.clone(), hook.release.take()))
    };
    if let Some((acquired, release)) = rendezvous
        && acquired.send(()).is_ok()
        && let Some(release) = release
    {
        let _ = release.recv_timeout(std::time::Duration::from_secs(10));
    }
}

/// A read-only storage view for query execution on either lane.
///
/// `Live` borrows the write connection (serialized under the global instance
/// mutex). `Pinned` is a pooled read-only connection inside a WAL read
/// transaction: every read through it (rows, versions, change high-waters)
/// comes from one snapshot. Actions carry no view at all — their `ctx.db`
/// reads route through the action host, which chooses the locking policy per
/// call (ENG-23324).
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6.
pub enum DbRead<'a> {
    Live(&'a LocalDatabase),
    Pinned {
        conn: &'a Connection,
        schema: &'a SchemaManifest,
    },
}

impl DbRead<'_> {
    pub(crate) fn reborrow(&self) -> DbRead<'_> {
        match self {
            DbRead::Live(db) => DbRead::Live(db),
            DbRead::Pinned { conn, schema } => DbRead::Pinned { conn, schema },
        }
    }

    fn live(&self) -> Option<&LocalDatabase> {
        match self {
            DbRead::Live(db) => Some(db),
            DbRead::Pinned { .. } => None,
        }
    }

    /// Execute one compound read against this view's existing snapshot, or
    /// pin an operation-scoped snapshot when the invocation is on the live
    /// serialized connection (mutation lane).
    pub(crate) fn with_pinned_read_view<T>(
        &self,
        read: impl FnOnce(DbRead<'_>) -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        match self {
            DbRead::Pinned { .. } => read(self.reborrow()),
            DbRead::Live(db) => db.query_reads_read().with_pinned_read_view(read),
        }
    }

    /// The schema backing this read view — used by LLP 0056 membership helpers
    /// to resolve a declaration id to its table and field names.
    pub(crate) fn schema(&self) -> &SchemaManifest {
        match self {
            DbRead::Pinned { schema, .. } => schema,
            DbRead::Live(db) => db.schema(),
        }
    }

    /// Durable cursor-custody facts read through the same pinned snapshot as
    /// the membership page query. These are distinct from the legacy
    /// process-local permission-epoch map.
    ///
    /// @ref LLP 0100#5-index-and-continuation-contract — membership keyset
    ///   cursors bind the global AuthorizationVersion and reset-rotated data
    ///   stream observed by the query snapshot.
    pub(crate) fn membership_cursor_custody_snapshot(
        &self,
    ) -> SnapbackResult<(AuthorizationVersion, Option<String>)> {
        let conn = match self {
            DbRead::Pinned { conn, .. } => *conn,
            DbRead::Live(db) => &db.conn,
        };
        Ok((
            authorization_version_on(conn)?,
            crate::seed_identity::strict_current_data_version_stream(conn)?,
        ))
    }

    pub fn query(&self, plan: &QueryPlan, input: &HandlerInput) -> SnapbackResult<QueryOutput> {
        match self {
            DbRead::Pinned { conn, schema } => query_on(conn, schema, plan, input),
            _ => self
                .live()
                .expect("live db")
                .query_reads_read()
                .query(plan, input),
        }
    }

    /// The new node-class establishment entry point. Keeping the ceiling on a
    /// distinct method makes it structurally impossible for the ordinary
    /// application Query/LiveQuery path to inherit the new refusal.
    pub(crate) fn query_with_examined_entry_ceiling(
        &self,
        plan: &QueryPlan,
        input: &HandlerInput,
        ceiling: usize,
    ) -> SnapbackResult<QueryOutput> {
        match self {
            DbRead::Pinned { conn, schema } => {
                query_on_with_examined_entry_ceiling(conn, schema, plan, input, ceiling)
            }
            DbRead::Live(db) => {
                query_on_with_examined_entry_ceiling(&db.conn, &db.schema, plan, input, ceiling)
            }
        }
    }

    pub(crate) fn search(
        &self,
        plan: &crate::search::types::SearchQueryPlanV1,
        input: &HandlerInput,
        authority: &crate::search::sqlite::SearchExecutionAuthority<'_>,
    ) -> SnapbackResult<QueryOutput> {
        match self {
            DbRead::Pinned { conn, schema } => {
                crate::search::query_search_on(conn, schema, plan, input, authority)
            }
            DbRead::Live(db) => with_pinned_read_snapshot(&db.conn, |conn| {
                crate::search::query_search_on(conn, &db.schema, plan, input, authority)
            }),
        }
    }

    /// Run one exact-vector query inside this view's already-pinned snapshot.
    /// The caller retains the private generation identity on corruption and
    /// quarantines it only after the read transaction has ended.
    pub(crate) fn vector(
        &self,
        plan: &crate::vector::VectorQueryPlanV1,
        input: &HandlerInput,
        owner_subject: Option<&str>,
    ) -> Result<
        crate::vector::sqlite::VectorSqliteQueryResultV1,
        crate::vector::sqlite::VectorSqliteQueryFailure,
    > {
        match self {
            DbRead::Pinned { conn, schema } => {
                crate::vector::sqlite::query_vector_on(conn, schema, plan, input, owner_subject)
            }
            DbRead::Live(db) => crate::vector::sqlite::query_vector_on(
                &db.conn,
                &db.schema,
                plan,
                input,
                owner_subject,
            ),
        }
    }

    pub(crate) fn search_database_identity(&self) -> SnapbackResult<String> {
        let conn = match self {
            DbRead::Pinned { conn, .. } => *conn,
            DbRead::Live(db) => &db.conn,
        };
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM _snapback_meta
                 WHERE key = 'auth_invalidation_data_version_stream_v1'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value.unwrap_or_else(|| "search-local-uninitialized-stream".to_owned()))
    }

    /// Keyset-bounded, total-ordered query — the relational root window.
    pub(crate) fn query_keyset(
        &self,
        plan: &QueryPlan,
        input: &HandlerInput,
        keyset: Option<&KeysetAfter>,
    ) -> SnapbackResult<QueryOutput> {
        match self {
            DbRead::Pinned { conn, schema } => query_on_keyset(conn, schema, plan, input, keyset),
            DbRead::Live(db) => query_on_keyset(&db.conn, &db.schema, plan, input, keyset),
        }
    }

    /// Narrow, non-application-returning bypass used only by the declaration-
    /// bound membership evaluator. Keeping this as a distinct method prevents
    /// generic/live/retained query callers from opting around private rosters.
    pub(crate) fn query_private_membership(
        &self,
        plan: &QueryPlan,
        input: &HandlerInput,
    ) -> SnapbackResult<QueryOutput> {
        match self {
            DbRead::Pinned { conn, schema } => query_on_with_storage_limit_visibility(
                conn,
                schema,
                plan,
                input,
                effective_query_limit(plan),
                true,
            ),
            DbRead::Live(db) => query_on_with_storage_limit_visibility(
                &db.conn,
                &db.schema,
                plan,
                input,
                effective_query_limit(plan),
                true,
            ),
        }
    }

    /// Keyset twin of the private membership evaluator read. The boundary is
    /// host-private: a later application surface must wrap it in the existing
    /// custody envelope before returning a continuation token.
    ///
    /// @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface — the
    ///   profile roster is a bounded host-evaluated projection, not a generic
    ///   membership-table read.
    pub(crate) fn query_private_membership_keyset(
        &self,
        plan: &QueryPlan,
        input: &HandlerInput,
        keyset: Option<&KeysetAfter>,
        storage_limit: usize,
    ) -> SnapbackResult<QueryOutput> {
        match self {
            DbRead::Pinned { conn, schema } => query_on_with_storage_limit_visibility_keyset(
                conn,
                schema,
                plan,
                input,
                storage_limit,
                true,
                keyset,
                true,
                None,
            ),
            DbRead::Live(db) => query_on_with_storage_limit_visibility_keyset(
                &db.conn,
                &db.schema,
                plan,
                input,
                storage_limit,
                true,
                keyset,
                true,
                None,
            ),
        }
    }

    pub(crate) fn query_with_storage_limit(
        &self,
        plan: &QueryPlan,
        input: &HandlerInput,
        storage_limit: usize,
    ) -> SnapbackResult<QueryOutput> {
        match self {
            DbRead::Pinned { conn, schema } => {
                query_on_with_storage_limit(conn, schema, plan, input, storage_limit)
            }
            _ => self
                .live()
                .expect("live db")
                .query_reads_read()
                .query_with_storage_limit(plan, input, storage_limit),
        }
    }

    pub fn get(&self, table: &str, id: &str) -> SnapbackResult<Option<Value>> {
        match self {
            DbRead::Pinned { conn, schema } => get_on(conn, schema, table, id),
            _ => self
                .live()
                .expect("live db")
                .query_reads_read()
                .get(table, id),
        }
    }

    pub(crate) fn project_media_document(
        &self,
        table_name: &str,
        document: &mut Value,
    ) -> SnapbackResult<()> {
        let (conn, schema) = match self {
            DbRead::Pinned { conn, schema } => (*conn, *schema),
            DbRead::Live(db) => (&db.conn, &db.schema),
        };
        let table = schema_table(schema, table_name)?;
        project_media_fields_on(conn, table, document)
    }

    pub fn get_many(&self, table: &str, ids: &[String]) -> SnapbackResult<Vec<Option<Value>>> {
        match self {
            DbRead::Pinned { conn, schema } => get_many_on(conn, schema, table, ids),
            DbRead::Live(db) => get_many_on(&db.conn, &db.schema, table, ids),
        }
    }

    pub fn unique_many(
        &self,
        table: &str,
        index: &str,
        keys: &[Map<String, Value>],
    ) -> SnapbackResult<Vec<Option<Value>>> {
        match self {
            DbRead::Pinned { conn, schema } => unique_many_on(conn, schema, table, index, keys),
            DbRead::Live(db) => unique_many_on(&db.conn, &db.schema, table, index, keys),
        }
    }

    pub(crate) fn active_relation_incarnation(
        &self,
        table: &str,
        id: &str,
    ) -> SnapbackResult<Option<String>> {
        let conn = match self {
            DbRead::Pinned { conn, .. } => *conn,
            DbRead::Live(db) => &db.conn,
        };
        Ok(conn
            .query_row(
                "SELECT incarnation
                   FROM _snapback_relation_incarnations_v1
                  WHERE table_name = ?1 AND row_id = ?2 AND active = 1",
                params![table, id],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub(crate) fn sequence_next_value(
        &self,
        counter: &str,
        scope_table: &str,
        scope_row_id: &str,
        scope_incarnation: &str,
    ) -> SnapbackResult<u64> {
        let conn = match self {
            DbRead::Pinned { conn, .. } => *conn,
            DbRead::Live(db) => &db.conn,
        };
        let next = conn
            .query_row(
                "SELECT next_value
                   FROM _snapback_sequence_counters_v1
                  WHERE counter_name = ?1
                    AND scope_table = ?2
                    AND scope_row_id = ?3
                    AND scope_incarnation = ?4",
                params![counter, scope_table, scope_row_id, scope_incarnation],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(1);
        u64::try_from(next).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
                "storage",
                "sequence counter state is outside the non-negative integer domain",
            )
        })
    }

    pub fn table_change_version(&self, table: &str) -> SnapbackResult<u64> {
        match self {
            DbRead::Pinned { conn, schema } => {
                let table = schema_table(schema, table)?;
                table_change_version_from_connection(conn, &table.name)
            }
            _ => self.live().expect("live db").table_change_version(table),
        }
    }

    pub fn current_version(&self) -> SnapbackResult<u64> {
        match self {
            DbRead::Pinned { conn, .. } => current_version_on(conn),
            _ => self.live().expect("live db").current_version(),
        }
    }

    pub(crate) fn conn(&self) -> &Connection {
        match self {
            DbRead::Pinned { conn, .. } => conn,
            DbRead::Live(db) => &db.conn,
        }
    }

    /// Snapshot lookup for `ctx.jobs.enqueue` idempotent reuse (LLP 0070:
    /// same scoped key plus identical canonical bytes return the existing
    /// job). The commit-time check inside the insert transaction remains the
    /// authority; this read only serves the handler-visible fast path.
    pub(crate) fn find_job_by_scoped_idempotency(
        &self,
        queue: &str,
        action: &str,
        idempotency_key: &str,
    ) -> SnapbackResult<Option<jobs::ExistingIdempotentJob>> {
        jobs::find_job_by_scoped_idempotency(self.conn(), queue, action, idempotency_key)
    }

    /// The declared job-status query's read (LLP 0121 option 3): the
    /// privacy-bounded lifecycle projection for one job id.
    pub(crate) fn job_status_row(
        &self,
        job_id: &str,
    ) -> SnapbackResult<Option<jobs::JobStatusRow>> {
        jobs::job_status_row(self.conn(), job_id)
    }
}

trait WithDetail {
    fn with_detail(self, key: &str, value: impl Into<Value>) -> Self;
}

impl WithDetail for SnapbackError {
    fn with_detail(mut self, key: &str, value: impl Into<Value>) -> Self {
        if !self.diagnostic.details.is_object() {
            self.diagnostic.details = Value::Object(Map::new());
        }
        self.diagnostic.details[key] = value.into();
        self
    }
}

/// The reserved caller-class identifiers that a role literal must never
/// shadow: they name caller *classes* in the transition matrix, not roles.
/// @ref LLP 0056#declaring-a-membership-table — `"self"`/`"none"` are reserved.
const MEMBERSHIP_RESERVED_ROLE_NAMES: [&str; 2] = ["self", "none"];

fn membership_error(
    code: &str,
    table: &str,
    declaration: &str,
    message: impl Into<String>,
) -> SnapbackError {
    SnapbackError::error(code, "schema", message.into())
        .with_detail("table", table.to_owned())
        .with_detail("declaration", declaration.to_owned())
}

/// Validate one role literal against the closed-vocabulary rules: non-empty, no
/// reserved caller-class name, no reserved `:` separator, no control
/// characters. Comparison is by **exact decoded value** — no case folding, no
/// Unicode normalization — so two writers can never disagree about whether a
/// role is declared.
///
/// @ref LLP 0056#declaring-a-membership-table — reserved names, the `:`
///   separator, control-character rejection, exact-decoded comparison.
fn validate_membership_role_literal(
    table: &str,
    declaration: &str,
    role: &str,
    axis: &str,
) -> SnapbackResult<()> {
    if role.is_empty() {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_ROLE_EMPTY",
            table,
            declaration,
            format!("{axis} contains an empty role literal"),
        ));
    }
    if MEMBERSHIP_RESERVED_ROLE_NAMES.contains(&role) {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_RESERVED_ROLE",
            table,
            declaration,
            format!(
                "role {role:?} is a reserved caller class in the transition matrix, not a role"
            ),
        )
        .with_detail("role", role.to_owned()));
    }
    if role.contains(':') {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_ROLE_RESERVED_SEPARATOR",
            table,
            declaration,
            format!(
                "role {role:?} contains the reserved ':' separator (reserved for a future \
                 cross-declaration spelling such as \"appRoles:admin\")"
            ),
        )
        .with_detail("role", role.to_owned()));
    }
    if role.chars().any(char::is_control) {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_ROLE_CONTROL_CHARACTER",
            table,
            declaration,
            format!("role {role:?} contains a control character"),
        )
        .with_detail("role", role.to_owned()));
    }
    Ok(())
}

/// Fail-closed structural validation of one `.membership()` declaration. This
/// enforces the closed, non-null, exact-decoded vocabulary, nominal immutable
/// axes, the exact per-operation transition grammar, reserved-name traps,
/// `roles`/`pendingRoles` disjointness, stable-id uniqueness, and both generated
/// index names. Runtime transition authorization is performed by the sanctioned
/// membership write planner below; provenance and invalidation are applied at
/// commit.
fn validate_membership_declaration(
    table: &TableManifest,
    field_names: &BTreeSet<String>,
    physical_index_names: &mut BTreeMap<String, String>,
    declaration_ids: &mut BTreeMap<String, String>,
) -> SnapbackResult<()> {
    let Some(membership) = &table.membership else {
        return Ok(());
    };
    let declaration = membership.effective_id(&table.name).to_owned();

    if let Some(field) = table
        .fields
        .iter()
        .find(|field| MEMBERSHIP_PROVENANCE_COLUMNS.contains(&field.name.as_str()))
    {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_PROVENANCE_FIELD_RESERVED",
            &table.name,
            &declaration,
            format!(
                "field {:?} is host-managed membership provenance and cannot be app-declared",
                field.name
            ),
        )
        .with_detail("field", field.name.clone()));
    }

    // The derivation owns the table: a hand-written permissionBacking is a
    // conflicting second authorization declaration over the same rows.
    // @ref LLP 0056#declaring-a-membership-table — declaring `.membership()`
    //   alongside `permissionBacking` is a typed manifest error.
    if table.permission_backing || table.permission_fields.is_some() {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_PERMISSION_BACKING_CONFLICT",
            &table.name,
            &declaration,
            "a membership table must not also declare permissionBacking/permissionFields; the \
             derivation owns the table",
        ));
    }

    // --- Stable declaration id: shape + manifest-global uniqueness. ---
    if let Some(pinned) = &membership.id
        && !is_identifier(pinned)
    {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_ID_INVALID",
            &table.name,
            &declaration,
            format!("pinned declaration id {pinned:?} is not a valid identifier"),
        ));
    }
    if let Some(previous) = declaration_ids.insert(declaration.clone(), table.name.clone()) {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_ID_COLLISION",
            &table.name,
            &declaration,
            format!(
                "membership declaration id {declaration:?} is already used by table {previous:?}; \
                 ids are unique across the manifest"
            ),
        )
        .with_detail("otherTable", previous));
    }

    // --- Axes: existence, non-optional, correct nominal type, distinctness. ---
    let principal_field =
        require_membership_axis_field(table, &declaration, &membership.principal, "principal")?;
    if principal_field.field_type != FieldType::Principal {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_PRINCIPAL_TYPE",
            &table.name,
            &declaration,
            format!(
                "principal axis {:?} must be declared v.principal(); found {}",
                membership.principal,
                field_type_name(&principal_field.field_type)
            ),
        ));
    }

    let role_field = require_membership_axis_field(table, &declaration, &membership.role, "role")?;
    if role_field.field_type != FieldType::String {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_ROLE_TYPE",
            &table.name,
            &declaration,
            format!(
                "role axis {:?} must be a string; found {}",
                membership.role,
                field_type_name(&role_field.field_type)
            ),
        ));
    }

    let mut axis_fields = vec![membership.principal.as_str(), membership.role.as_str()];
    match membership.scope {
        MembershipScope::Resource => {
            let resource = membership.resource.as_deref().ok_or_else(|| {
                membership_error(
                    "SNAPBACK_MEMBERSHIP_RESOURCE_AXIS_REQUIRED",
                    &table.name,
                    &declaration,
                    "a resource-scoped membership must declare a non-null resource field",
                )
            })?;
            let resource_field =
                require_membership_axis_field(table, &declaration, resource, "resource")?;
            if !matches!(resource_field.field_type, FieldType::Id { .. }) {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_RESOURCE_TYPE",
                    &table.name,
                    &declaration,
                    format!(
                        "resource axis {resource:?} must be declared v.id(resourceTable); found {}",
                        field_type_name(&resource_field.field_type)
                    ),
                ));
            }
            let FieldType::Id {
                table: resource_target,
            } = &resource_field.field_type
            else {
                unreachable!("resource field type checked above")
            };
            let declared_target = membership.resource_table.as_deref().ok_or_else(|| {
                membership_error(
                    "SNAPBACK_MEMBERSHIP_RESOURCE_TABLE_REQUIRED",
                    &table.name,
                    &declaration,
                    "a resource-scoped membership must declare resourceTable",
                )
            })?;
            if resource_target != declared_target {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_RESOURCE_TABLE_MISMATCH",
                    &table.name,
                    &declaration,
                    format!(
                        "resource axis {resource:?} targets {resource_target:?}, but resourceTable is {declared_target:?}"
                    ),
                )
                .with_detail("fieldTarget", resource_target.clone())
                .with_detail("resourceTable", declared_target.to_owned()));
            }
            axis_fields.push(resource);
        }
        MembershipScope::App => {
            if membership.bootstrap_role.is_some() {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_BOOTSTRAP_APP_SCOPE",
                    &table.name,
                    &declaration,
                    "bootstrapRole is not available on scope: \"app\" declarations because the singleton has no resource-creation witness",
                ));
            }
            if membership.resource.is_some() {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_APP_SCOPE_RESOURCE",
                    &table.name,
                    &declaration,
                    "an app-scoped membership (scope: \"app\") must not declare a resource field; \
                     its resource is a system-constant singleton",
                ));
            }
            if membership.resource_table.is_some() {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_APP_SCOPE_RESOURCE_TABLE",
                    &table.name,
                    &declaration,
                    "an app-scoped membership has no resource table",
                ));
            }
        }
    }
    {
        let mut seen = BTreeSet::new();
        for axis in &axis_fields {
            if !seen.insert(*axis) {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_AXIS_COLLISION",
                    &table.name,
                    &declaration,
                    format!("field {axis:?} is used for more than one membership axis"),
                ));
            }
        }
    }

    // --- Role vocabulary: non-empty, valid literals, roles/pending disjoint,
    //     union is closed; confusable near-duplicates refused. ---
    if membership.roles.is_empty() {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_EMPTY_VOCABULARY",
            &table.name,
            &declaration,
            "roles must declare at least one role",
        ));
    }
    let mut roles = BTreeSet::new();
    for role in &membership.roles {
        validate_membership_role_literal(&table.name, &declaration, role, "roles")?;
        if !roles.insert(role.as_str()) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_DUPLICATE_ROLE",
                &table.name,
                &declaration,
                format!("roles repeats {role:?}"),
            ));
        }
    }
    let mut pending = BTreeSet::new();
    for role in membership.pending_roles.iter().flatten() {
        validate_membership_role_literal(&table.name, &declaration, role, "pendingRoles")?;
        if roles.contains(role.as_str()) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_ROLE_PENDING_OVERLAP",
                &table.name,
                &declaration,
                format!("{role:?} appears in both roles and pendingRoles; they must be disjoint"),
            )
            .with_detail("role", role.clone()));
        }
        if !pending.insert(role.as_str()) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_DUPLICATE_ROLE",
                &table.name,
                &declaration,
                format!("pendingRoles repeats {role:?}"),
            ));
        }
    }
    // The closed write vocabulary is `roles ∪ pendingRoles`.
    let vocabulary: BTreeSet<&str> = roles
        .iter()
        .copied()
        .chain(pending.iter().copied())
        .collect();
    // Confusable near-duplicates: two roles that differ only by ASCII case
    // would let a `"Host"` write and a `"host"` write disagree about the same
    // authority. M1 refuses the declaration (fail-closed); broader Unicode
    // confusable folding is a follow-on.
    // @ref LLP 0056#declaring-a-membership-table — confusable near-duplicates.
    let mut folded: BTreeMap<String, &str> = BTreeMap::new();
    for role in &vocabulary {
        let key = role.to_ascii_lowercase();
        if let Some(previous) = folded.insert(key, role)
            && previous != *role
        {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_CONFUSABLE_ROLES",
                &table.name,
                &declaration,
                format!(
                    "roles {previous:?} and {role:?} are confusable (differ only by case); role \
                     comparison is exact-decoded, so both cannot be declared"
                ),
            ));
        }
    }

    // --- bootstrapRole ∈ roles. ---
    if let Some(bootstrap) = &membership.bootstrap_role
        && !roles.contains(bootstrap.as_str())
    {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_BOOTSTRAP_ROLE_UNKNOWN",
            &table.name,
            &declaration,
            format!("bootstrapRole {bootstrap:?} is not one of the declared (non-pending) roles"),
        )
        .with_detail("role", bootstrap.clone()));
    }

    // --- lastHolder: resource-scope only; protect ∈ roles; bootstrapRole == protect. ---
    if let Some(last_holder) = &membership.last_holder {
        if membership.scope == MembershipScope::App {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_LAST_HOLDER_APP_SCOPE",
                &table.name,
                &declaration,
                "lastHolder is not available on scope: \"app\" declarations (the singleton has no \
                 creation event to anchor establishment on)",
            ));
        }
        if !roles.contains(last_holder.protect.as_str()) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_LAST_HOLDER_ROLE_UNKNOWN",
                &table.name,
                &declaration,
                format!(
                    "lastHolder.protect {:?} is not one of the declared (non-pending) roles",
                    last_holder.protect
                ),
            )
            .with_detail("role", last_holder.protect.clone()));
        }
        // Establishment leg: the protected role must be the one the creation
        // witness seats, or the guarantee has no non-vacuous first leg.
        // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
        //   `bootstrapRole == protect` or it is a manifest error.
        if membership.bootstrap_role.as_deref() != Some(last_holder.protect.as_str()) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_LAST_HOLDER_BOOTSTRAP_MISMATCH",
                &table.name,
                &declaration,
                format!(
                    "lastHolder.protect {:?} requires bootstrapRole to seat the same role (found {:?})",
                    last_holder.protect, membership.bootstrap_role
                ),
            ));
        }
    }

    // --- expiry: field is a declared non-axis column; remove-only in v1. ---
    if let Some(expiry) = &membership.expiry {
        let expiry_field = table.field(&expiry.field).ok_or_else(|| {
            membership_error(
                "SNAPBACK_MEMBERSHIP_EXPIRY_FIELD_UNKNOWN",
                &table.name,
                &declaration,
                format!("expiry.field {:?} is not a declared column", expiry.field),
            )
        })?;
        if axis_fields.contains(&expiry.field.as_str()) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_EXPIRY_FIELD_AXIS",
                &table.name,
                &declaration,
                format!(
                    "expiry.field {:?} may not be a membership axis",
                    expiry.field
                ),
            ));
        }
        if expiry_field.field_type != FieldType::Integer || !expiry_field.optional {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_EXPIRY_FIELD_TYPE",
                &table.name,
                &declaration,
                format!(
                    "expiry.field {:?} must be an optional epoch-millisecond Integer",
                    expiry.field
                ),
            )
            .with_detail("field", expiry.field.clone())
            .with_detail("type", field_type_name(&expiry_field.field_type))
            .with_detail("optional", expiry_field.optional));
        }
        // Remove is the only v1 effect: with no declared role ordering the host
        // cannot prove a downgrade is non-escalating.
        // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
        //   remove-only; `downgradeTo:` is a manifest error.
        if expiry.on_expiry != "remove" {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_EXPIRY_EFFECT_UNSUPPORTED",
                &table.name,
                &declaration,
                format!(
                    "expiry.onExpiry {:?} is unsupported; v1 supports only \"remove\" (no declared \
                     role ordering means no provable non-escalation)",
                    expiry.on_expiry
                ),
            ));
        }
    }

    // --- incidental: declared columns, and the hard authorization floor. ---
    for column in membership.incidental.iter().flatten() {
        if !field_names.contains(column) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_INCIDENTAL_UNKNOWN",
                &table.name,
                &declaration,
                format!("incidental names undeclared column {column:?}"),
            ));
        }
        // The floor: the principal/resource/role axes can never be attested
        // incidental. Generated provenance columns are separately reserved and
        // remain permanently below this floor.
        // @ref LLP 0056#invalidation-the-llp-0053-mapping — the incidental floor.
        if axis_fields.contains(&column.as_str()) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_INCIDENTAL_FLOOR",
                &table.name,
                &declaration,
                format!(
                    "column {column:?} is a membership authorization axis and can never be \
                     attested incidental"
                ),
            )
            .with_detail("column", column.clone()));
        }
    }

    // --- Transition shape: exact op grammar, no unknown role in by/from/to,
    //     and no undeclared column in a patch's fields. ---
    for transition in &membership.transitions {
        if transition.by.is_empty() {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_TRANSITION_EMPTY_SET",
                &table.name,
                &declaration,
                format!(
                    "transition {:?} has an empty by set; transition sets must be non-empty",
                    transition.op.as_str()
                ),
            )
            .with_detail("field", "by"));
        }
        for (field, values) in [
            ("from", transition.from.as_ref()),
            ("to", transition.to.as_ref()),
            ("fields", transition.fields.as_ref()),
        ] {
            if values.is_some_and(Vec::is_empty) {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_TRANSITION_EMPTY_SET",
                    &table.name,
                    &declaration,
                    format!(
                        "transition {:?} has an empty {field} set; transition sets must be non-empty",
                        transition.op.as_str()
                    ),
                )
                .with_detail("field", field));
            }
        }

        for by in &transition.by {
            let reserved = MEMBERSHIP_RESERVED_ROLE_NAMES.contains(&by.as_str());
            if !reserved && !vocabulary.contains(by.as_str()) {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_CALLER",
                    &table.name,
                    &declaration,
                    format!(
                        "transition {:?} names caller class {by:?}, which is neither a declared \
                         role nor a reserved class (self/none)",
                        transition.op.as_str()
                    ),
                ));
            }
        }

        let has_none = transition.by.iter().any(|by| by == "none");
        let has_self = transition.by.iter().any(|by| by == "self");
        let has_role = transition
            .by
            .iter()
            .any(|by| vocabulary.contains(by.as_str()));
        let invalid_shape = |reason: &str| {
            membership_error(
                "SNAPBACK_MEMBERSHIP_TRANSITION_GRAMMAR",
                &table.name,
                &declaration,
                format!(
                    "transition {:?} violates the closed per-operation grammar: {reason}",
                    transition.op.as_str()
                ),
            )
        };
        match transition.op {
            MembershipOp::Insert => {
                if has_self {
                    return Err(invalid_shape(
                        "insert cannot use caller class self; self/other is represented by target",
                    ));
                }
                if transition.from.is_some() {
                    return Err(invalid_shape(
                        "insert forbids from because no old row exists",
                    ));
                }
                if transition.to.is_none() {
                    return Err(invalid_shape("insert requires a non-empty to set"));
                }
                if transition.target == MembershipTarget::Own && has_role {
                    return Err(invalid_shape(
                        "a role caller class with target self is unreachable on insert; use none",
                    ));
                }
            }
            MembershipOp::SetRole => {
                if has_none {
                    return Err(invalid_shape(
                        "setRole admits only declared roles or self in by",
                    ));
                }
                if transition.to.is_none() {
                    return Err(invalid_shape("setRole requires a non-empty to set"));
                }
                if transition.fields.is_some() {
                    return Err(invalid_shape("setRole forbids fields"));
                }
                if transition.target == MembershipTarget::Own && has_role {
                    return Err(invalid_shape(
                        "a role caller class with target self is unreachable; self wins",
                    ));
                }
            }
            MembershipOp::Remove => {
                if has_none {
                    return Err(invalid_shape(
                        "remove admits only declared roles or self in by",
                    ));
                }
                if transition.to.is_some() {
                    return Err(invalid_shape("remove forbids to"));
                }
                if transition.fields.is_some() {
                    return Err(invalid_shape("remove forbids fields"));
                }
                if transition.target == MembershipTarget::Own && has_role {
                    return Err(invalid_shape(
                        "a role caller class with target self is unreachable; self wins",
                    ));
                }
            }
            MembershipOp::Patch => {
                if has_none {
                    return Err(invalid_shape(
                        "patch admits only declared roles or self in by",
                    ));
                }
                if transition.to.is_some() {
                    return Err(invalid_shape(
                        "patch forbids to because it never changes role",
                    ));
                }
                if transition.fields.is_none() {
                    return Err(invalid_shape("patch requires a non-empty fields set"));
                }
                if transition.target == MembershipTarget::Own && has_role {
                    return Err(invalid_shape(
                        "a role caller class with target self is unreachable; self wins",
                    ));
                }
            }
        }
        for role in transition
            .from
            .iter()
            .flatten()
            .chain(transition.to.iter().flatten())
        {
            if !vocabulary.contains(role.as_str()) {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_ROLE",
                    &table.name,
                    &declaration,
                    format!(
                        "transition {:?} references role {role:?}, which is not in the closed \
                         vocabulary",
                        transition.op.as_str()
                    ),
                )
                .with_detail("role", role.clone()));
            }
        }
        for column in transition.fields.iter().flatten() {
            if !field_names.contains(column) {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_FIELD",
                    &table.name,
                    &declaration,
                    format!(
                        "transition {:?} patches undeclared column {column:?}",
                        transition.op.as_str()
                    ),
                ));
            }
            if axis_fields.contains(&column.as_str()) {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_TRANSITION_AXIS_FIELD",
                    &table.name,
                    &declaration,
                    format!(
                        "transition {:?} may not patch membership axis {column:?} (axes are \
                         immutable after insert)",
                        transition.op.as_str()
                    ),
                ));
            }
        }
        // `by: self` targeting another principal is contradictory for every
        // target-row operation.
        if matches!(transition.target, MembershipTarget::Other)
            && transition.by.iter().any(|by| by == "self")
        {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_TRANSITION_SELF_ON_OTHER",
                &table.name,
                &declaration,
                format!(
                    "transition {:?} uses caller class \"self\" with target \"other\", which is \
                     contradictory",
                    transition.op.as_str()
                ),
            ));
        }
    }

    // --- Principal-addressed writes activation (LLP 0100 §2). The option is
    //     closed (v1 admits only `remove: true`) and activates only when at
    //     least one transition is a TOTAL other-principal removal: `from`
    //     omitted so no per-role asymmetry can read back a hidden role, and
    //     every carrier caller class a full (non-pending) declared role.
    //     Under `lastHolder`, every carrier caller role must be the protected
    //     role, so an admitted caller is itself a protected holder and the
    //     commit-stage check can never fire as an oracle on this surface.
    // @ref LLP 0100#2-opting-into-principal-addressed-removal — totality is
    //   load-bearing: partial coverage would make removal success/refusal a
    //   hidden-role oracle.
    if let Some(paw) = &membership.principal_addressed_writes {
        let paw_error = |message: String| {
            membership_error(
                "SNAPBACK_MEMBERSHIP_PRINCIPAL_ADDRESSED_INVALID",
                &table.name,
                &declaration,
                message,
            )
        };
        if !paw.remove {
            return Err(paw_error(
                "principalAddressedWrites admits only { remove: true } in v1; remove: false is \
                 refused rather than ignored"
                    .to_owned(),
            ));
        }
        let carriers: Vec<_> = membership
            .transitions
            .iter()
            .filter(|transition| {
                transition.op == MembershipOp::Remove
                    && transition.target == MembershipTarget::Other
                    && transition.from.is_none()
            })
            .collect();
        if carriers.is_empty() {
            return Err(paw_error(
                "principalAddressedWrites.remove requires at least one total other-principal \
                 removal transition (op remove, target other, from omitted); partial `from` \
                 coverage cannot carry a principal-addressed removal"
                    .to_owned(),
            ));
        }
        let pending: BTreeSet<&str> = membership
            .pending_roles
            .iter()
            .flatten()
            .map(String::as_str)
            .collect();
        for transition in &carriers {
            for by in &transition.by {
                if pending.contains(by.as_str()) {
                    return Err(paw_error(format!(
                        "total other-principal removal caller class {by:?} is a pending role; \
                         carriers admit only full declaration roles"
                    )));
                }
                if let Some(last_holder) = &membership.last_holder
                    && by != &last_holder.protect
                {
                    return Err(paw_error(format!(
                        "total other-principal removal caller class {by:?} must be the \
                         lastHolder-protected role {:?}: an admitted caller must itself be a \
                         protected holder so removal cannot empty the protected set",
                        last_holder.protect
                    )));
                }
            }
        }
    }

    // --- Reserve the generated unique index's physical name so a user index
    //     cannot silently collide with it. ---
    for (index_name, _) in [
        membership_unique_index(table),
        membership_reverse_index(table),
    ]
    .into_iter()
    .flatten()
    {
        let physical = format!("{}_{}", table.name, index_name);
        let owner = format!("{}.{} (generated membership index)", table.name, index_name);
        if let Some(previous) = physical_index_names.insert(physical.clone(), owner) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_INDEX_NAME_COLLISION",
                &table.name,
                &declaration,
                format!(
                    "the generated membership index collides with the physical index name \
                     {physical} already used by {previous}"
                ),
            )
            .with_detail("physicalName", physical));
        }
    }

    Ok(())
}

/// Require a membership axis field: declared, and **non-optional** — a nullable
/// key axis silently defeats the unique index (SQLite/Postgres admit multiple
/// NULL-bearing rows), so it is refused at the declaration.
/// @ref LLP 0056#declaring-a-membership-table — key columns are required and
///   non-null; a nullable axis defeats uniqueness.
fn require_membership_axis_field<'a>(
    table: &'a TableManifest,
    declaration: &str,
    field: &str,
    axis: &str,
) -> SnapbackResult<&'a FieldManifest> {
    let manifest = table.field(field).ok_or_else(|| {
        membership_error(
            "SNAPBACK_MEMBERSHIP_AXIS_FIELD_UNKNOWN",
            &table.name,
            declaration,
            format!("{axis} axis references undeclared field {field:?}"),
        )
    })?;
    if manifest.optional {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_OPTIONAL_KEY_AXIS",
            &table.name,
            declaration,
            format!(
                "{axis} axis {field:?} is optional; membership key axes must be non-null or the \
                 uniqueness invariant is silently defeated"
            ),
        )
        .with_detail("field", field.to_owned())
        .with_detail("axis", axis.to_owned()));
    }
    Ok(manifest)
}

fn sqlite_object_exists(tx: &Transaction<'_>, kind: &str, name: &str) -> SnapbackResult<bool> {
    Ok(tx
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = ?1 AND name = ?2",
            params![kind, name],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn nonnull_activation_axis(
    value: Option<String>,
    table: &str,
    declaration: &str,
    axis: &str,
) -> SnapbackResult<String> {
    match value {
        Some(value) if !value.is_empty() => Ok(value),
        _ => Err(membership_error(
            "SNAPBACK_MEMBERSHIP_ACTIVATION_NULL_AXIS",
            table,
            declaration,
            format!(
                "an existing row has a null/empty {axis} axis; a null key axis silently defeats \
                 the membership uniqueness invariant"
            ),
        )
        .with_detail("axis", axis.to_owned())),
    }
}

/// Fail-closed scan of **existing data** when a `.membership()` declaration is
/// activated over a table that already holds rows (the brownfield-adopt path).
/// Refuses activation on: a null/empty key axis, a role outside the closed
/// (exact-decoded) vocabulary — which is also the vocabulary-shrink-with-extant
/// -rows refusal and the `"Host"`-vs-`"host"` refusal — a duplicate
/// `(principal, resource)` pair, a membership referencing a non-existent
/// resource, and (where `lastHolder` is declared) any live resource lacking a
/// holder of the protected role.
///
/// The uniqueness/nullability legs are additionally backstopped by the
/// generated unique index and the non-null columns, but this scan produces a
/// **typed** diagnostic naming the declaration rather than a raw SQLite error.
///
/// The `lastHolder` leg counts **durably recoverable eligible** holders — a
/// catalog principal that is live and, for production agents, owned or backed
/// by a live credential family — by reusing
/// [`auth_agents::principal_is_eligible_on`]. Referential integrity and live-
/// resource enumeration use the declaration's required nominal
/// `resourceTable`/`v.id(...)` binding.
///
/// @ref LLP 0056#declaring-a-membership-table — activation over existing data
///   is fail-closed across vocabulary, uniqueness, nullability, and referential
///   integrity.
pub(super) fn preflight_membership_activation_sources(
    conn: &Connection,
    manifest: &SchemaManifest,
    maximum: u64,
) -> SnapbackResult<()> {
    let mut sources = BTreeSet::new();
    for table in &manifest.tables {
        let Some(membership) = &table.membership else {
            continue;
        };
        sources.insert(table.name.clone());
        if let Some(resource_table) = &membership.resource_table {
            // Resolve the declared binding even when its physical table is new
            // in this activation. Unknown logical targets are never skipped as
            // if they were merely absent DDL.
            schema_table(manifest, resource_table)?;
            sources.insert(resource_table.clone());
        }
    }
    for source in sources {
        if sqlite_table_exists(conn, &source)? {
            let table = schema_table(manifest, &source)?;
            validate_managed_row_versions(conn, table, maximum)?;
        }
    }
    Ok(())
}

fn validate_membership_activation(
    tx: &Transaction<'_>,
    manifest: &SchemaManifest,
    maximum: u64,
) -> SnapbackResult<()> {
    // Every source relation is validated before row selection. The caller
    // separately preflights the predecessor before DDL/seed; this second pass
    // admits transaction-created rows only through the explicit successor
    // maximum and prevents SQL/early-exit logic from hiding malformed rows.
    preflight_membership_activation_sources(tx, manifest, maximum)?;
    for table in &manifest.tables {
        let Some(membership) = &table.membership else {
            continue;
        };
        let declaration = membership.effective_id(&table.name).to_owned();
        if !sqlite_object_exists(tx, "table", &table.name)? {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_ACTIVATION_TABLE_MISSING",
                &table.name,
                &declaration,
                "membership activation ran before its table DDL was installed",
            ));
        }
        let physical = physical_columns(tx, &table.name)?;
        if !physical.contains_key(&membership.principal) || !physical.contains_key(&membership.role)
        {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_ACTIVATION_AXIS_MISSING",
                &table.name,
                &declaration,
                "membership activation ran before its principal/role column DDL was installed",
            ));
        }
        let resource_column = match membership.scope {
            MembershipScope::Resource => {
                let resource = membership
                    .resource
                    .as_deref()
                    .expect("resource axis validated by validate_membership_declaration");
                if !physical.contains_key(resource) {
                    return Err(membership_error(
                        "SNAPBACK_MEMBERSHIP_ACTIVATION_AXIS_MISSING",
                        &table.name,
                        &declaration,
                        format!(
                            "membership activation ran before resource column {resource:?} was installed"
                        ),
                    ));
                }
                Some(resource)
            }
            MembershipScope::App => None,
        };
        let vocabulary: BTreeSet<&str> = membership.vocabulary().collect();
        // Sessions requires a real catalog principal; dev impersonation asserts
        // existence by fiat. The shared predicate additionally accounts for
        // ownership and live credential-family recoverability for agents.
        let require_catalog_principal = manifest.effective_auth_mode() == AuthMode::Sessions;

        let mut select_columns = vec![membership.principal.clone(), membership.role.clone()];
        if let Some(resource) = resource_column {
            select_columns.push(resource.to_owned());
        }
        let quoted = select_columns
            .iter()
            .map(|column| quote_ident(column))
            .collect::<SnapbackResult<Vec<_>>>()?
            .join(", ");
        let sql = format!("SELECT {quoted} FROM {}", quote_ident(&table.name)?);

        let mut seen_pairs: BTreeSet<(String, Option<String>)> = BTreeSet::new();
        let mut referenced_resources: BTreeSet<String> = BTreeSet::new();
        let mut protected_resources: BTreeSet<String> = BTreeSet::new();
        {
            let mut statement = tx.prepare(&sql)?;
            let mut rows = statement.query([])?;
            while let Some(row) = rows.next()? {
                let principal = nonnull_activation_axis(
                    row.get::<_, Option<String>>(0)?,
                    &table.name,
                    &declaration,
                    "principal",
                )?;
                let role = nonnull_activation_axis(
                    row.get::<_, Option<String>>(1)?,
                    &table.name,
                    &declaration,
                    "role",
                )?;
                let resource = if resource_column.is_some() {
                    Some(nonnull_activation_axis(
                        row.get::<_, Option<String>>(2)?,
                        &table.name,
                        &declaration,
                        "resource",
                    )?)
                } else {
                    None
                };

                // Exact-decoded vocabulary: a `"Host"` row against a `"host"`
                // vocabulary fails here, and so does a vocabulary shrink that
                // stranded rows carrying a removed role.
                if !vocabulary.contains(role.as_str()) {
                    return Err(membership_error(
                        "SNAPBACK_MEMBERSHIP_ACTIVATION_UNKNOWN_ROLE",
                        &table.name,
                        &declaration,
                        format!(
                            "an existing row carries role {role:?}, which is not in the closed \
                             vocabulary (comparison is exact-decoded)"
                        ),
                    )
                    .with_detail("role", role));
                }

                if !seen_pairs.insert((principal.clone(), resource.clone())) {
                    return Err(membership_error(
                        "SNAPBACK_MEMBERSHIP_ACTIVATION_DUPLICATE",
                        &table.name,
                        &declaration,
                        "existing rows duplicate a (principal, resource) pair; the membership \
                         uniqueness invariant would be violated",
                    )
                    .with_detail("principal", principal));
                }

                if let Some(resource) = resource {
                    if membership
                        .last_holder
                        .as_ref()
                        .is_some_and(|last_holder| last_holder.protect == role)
                        && crate::storage::auth_agents::principal_is_eligible_on(
                            tx,
                            &principal,
                            require_catalog_principal,
                        )?
                    {
                        protected_resources.insert(resource.clone());
                    }
                    referenced_resources.insert(resource);
                }
            }
        }

        // Referential integrity and the live-resource enumeration both require
        // the resource-table binding.
        if resource_column.is_some() {
            let resource_table = membership.resource_table.as_deref().ok_or_else(|| {
                membership_error(
                    "SNAPBACK_MEMBERSHIP_RESOURCE_TABLE_REQUIRED",
                    &table.name,
                    &declaration,
                    "resource-scoped activation requires resourceTable",
                )
            })?;
            if !sqlite_object_exists(tx, "table", resource_table)? {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_RESOURCE_TABLE_UNKNOWN",
                    &table.name,
                    &declaration,
                    format!("resourceTable {resource_table:?} has no active physical table"),
                )
                .with_detail("resourceTable", resource_table.to_owned()));
            }
            for resource in &referenced_resources {
                if !sqlite_object_exists_row(tx, resource_table, resource)? {
                    return Err(membership_error(
                        "SNAPBACK_MEMBERSHIP_ACTIVATION_DANGLING_RESOURCE",
                        &table.name,
                        &declaration,
                        format!(
                            "a membership references resource {resource:?}, which does not exist \
                             in {resource_table}"
                        ),
                    )
                    .with_detail("resource", resource.clone()));
                }
            }
            if let Some(last_holder) = &membership.last_holder {
                let mut statement =
                    tx.prepare(&format!("SELECT _id FROM {}", quote_ident(resource_table)?))?;
                let mut rows = statement.query([])?;
                while let Some(row) = rows.next()? {
                    let resource: String = row.get(0)?;
                    if !protected_resources.contains(&resource) {
                        return Err(membership_error(
                            "SNAPBACK_MEMBERSHIP_ACTIVATION_UNPROTECTED_RESOURCE",
                            &table.name,
                            &declaration,
                            format!(
                                "live resource {resource:?} has no holder of the protected role \
                                 {:?}",
                                last_holder.protect
                            ),
                        )
                        .with_detail("resource", resource)
                        .with_detail("role", last_holder.protect.clone()));
                    }
                }
            }
        }
    }
    validate_relation_activation(tx, manifest)?;
    Ok(())
}

fn validate_relation_activation(
    tx: &Transaction<'_>,
    manifest: &SchemaManifest,
) -> SnapbackResult<()> {
    let participating_parents = manifest
        .tables
        .iter()
        .flat_map(|child| child.fields.iter())
        .filter_map(|field| match &field.field_type {
            FieldType::RelationIncarnation { parent_table, .. } => Some(parent_table.as_str()),
            _ => None,
        })
        .collect::<BTreeSet<_>>();
    for parent_table in participating_parents {
        let parent_table_sql = quote_ident(parent_table)?;
        let missing_or_duplicate_active = tx
            .query_row(
                &format!(
                    "SELECT p._id
                       FROM {parent_table_sql} p
                  LEFT JOIN _snapback_relation_incarnations_v1 r
                         ON r.table_name = ?1
                        AND r.row_id = p._id
                        AND r.active = 1
                   GROUP BY p._id
                     HAVING count(r.incarnation) != 1
                      LIMIT 1"
                ),
                params![parent_table],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(row_id) = missing_or_duplicate_active {
            return Err(SnapbackError::error(
                "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED",
                "schema",
                "each current relation parent must have exactly one active incarnation",
            )
            .with_details(json!({
                "parentTable": parent_table,
                "rowId": row_id,
                "direction": "parent-to-registry",
            })));
        }

        let dangling_active = tx
            .query_row(
                &format!(
                    "SELECT r.row_id
                       FROM _snapback_relation_incarnations_v1 r
                  LEFT JOIN {parent_table_sql} p ON p._id = r.row_id
                      WHERE r.table_name = ?1
                        AND r.active = 1
                        AND p._id IS NULL
                      LIMIT 1"
                ),
                params![parent_table],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(row_id) = dangling_active {
            return Err(SnapbackError::error(
                "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED",
                "schema",
                "an active relation incarnation has no physically present parent",
            )
            .with_details(json!({
                "parentTable": parent_table,
                "rowId": row_id,
                "direction": "registry-to-parent",
            })));
        }
    }

    for child in &manifest.tables {
        for stamp in &child.fields {
            let FieldType::RelationIncarnation {
                foreign_key_field,
                parent_table,
            } = &stamp.field_type
            else {
                continue;
            };
            let sql = format!(
                "SELECT c._id
                   FROM {child_table} c
              LEFT JOIN {parent_table_sql} p
                     ON p._id = c.{foreign_key}
              LEFT JOIN _snapback_relation_incarnations_v1 r
                     ON r.table_name = ?1
                    AND r.row_id = c.{foreign_key}
                    AND r.incarnation = c.{stamp_field}
                    AND r.active = 1
                  WHERE p._id IS NULL OR r.incarnation IS NULL
                  LIMIT 1",
                child_table = quote_ident(&child.name)?,
                parent_table_sql = quote_ident(parent_table)?,
                foreign_key = quote_ident(foreign_key_field)?,
                stamp_field = quote_ident(&stamp.name)?,
            );
            if let Some(row_id) = tx
                .query_row(&sql, params![parent_table], |row| row.get::<_, String>(0))
                .optional()?
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED",
                    "schema",
                    "existing relation rows are missing a matching active parent incarnation",
                )
                .with_details(json!({
                    "childTable": child.name,
                    "field": stamp.name,
                    "rowId": row_id,
                    "parentTable": parent_table,
                })));
            }
        }
    }
    Ok(())
}

fn sqlite_object_exists_row(tx: &Transaction<'_>, table: &str, id: &str) -> SnapbackResult<bool> {
    Ok(tx
        .query_row(
            &format!("SELECT 1 FROM {} WHERE _id = ?1", quote_ident(table)?),
            params![id],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

#[derive(Clone, Copy)]
enum StructuredDescriptorPosition {
    Root,
    Interior,
    UnionVariant,
}

fn validate_stored_structured_contract(
    table: &str,
    field: &str,
    contract: &crate::manifest::StoredStructuredContractV1,
    contract_hash: &str,
) -> SnapbackResult<()> {
    let invalid = |reason: String| {
        SnapbackError::error(
            "SNAPBACK_STRUCTURED_CONTRACT_INVALID",
            "schema",
            "stored structured field carries an invalid contract",
        )
        .with_detail("table", table.to_owned())
        .with_detail("field", field.to_owned())
        .with_detail("reason", reason)
    };
    if contract.version != crate::manifest::STORED_STRUCTURED_CONTRACT_VERSION_V1 {
        return Err(invalid(format!(
            "version must be {}, got {}",
            crate::manifest::STORED_STRUCTURED_CONTRACT_VERSION_V1,
            contract.version
        )));
    }
    if contract.encoding != crate::manifest::STORED_STRUCTURED_ENCODING_V1 {
        return Err(invalid(format!(
            "encoding must be {:?}, got {:?}",
            crate::manifest::STORED_STRUCTURED_ENCODING_V1,
            contract.encoding
        )));
    }
    let mut object_fields = 0_usize;
    validate_stored_structured_descriptor(
        &contract.descriptor,
        StructuredDescriptorPosition::Root,
        0,
        &mut object_fields,
    )
    .map_err(invalid)?;
    let recomputed = crate::manifest::stored_structured_contract_hash(contract)?;
    if recomputed != contract_hash {
        return Err(SnapbackError::error(
            "SNAPBACK_STRUCTURED_CONTRACT_HASH_INVALID",
            "schema",
            "stored structured contract hash does not authenticate its persisted carrier",
        )
        .with_detail("table", table.to_owned())
        .with_detail("field", field.to_owned())
        .with_detail("declaredHash", contract_hash.to_owned())
        .with_detail("expectedHash", recomputed));
    }
    Ok(())
}

fn validate_stored_structured_descriptor(
    descriptor: &crate::manifest::ResultValueContract,
    position: StructuredDescriptorPosition,
    depth: usize,
    object_fields: &mut usize,
) -> Result<(), String> {
    use crate::manifest::ResultValueContract;
    if depth > 16 {
        return Err("descriptor depth exceeds 16".to_owned());
    }
    if matches!(position, StructuredDescriptorPosition::Root)
        && !matches!(
            descriptor,
            ResultValueContract::Object { .. }
                | ResultValueContract::Array { .. }
                | ResultValueContract::Union { .. }
        )
    {
        return Err("root must be object, array, or non-Enum union".to_owned());
    }
    match descriptor {
        ResultValueContract::Null => {
            if !matches!(position, StructuredDescriptorPosition::UnionVariant) {
                return Err("null node is admitted only as a union variant".to_owned());
            }
        }
        ResultValueContract::Boolean => {}
        ResultValueContract::String { max_bytes } => {
            if *max_bytes > 1024 * 1024 {
                return Err("string maxBytes exceeds 1 MiB".to_owned());
            }
        }
        ResultValueContract::Integer { min, max } => {
            if min > max || *min < PORTABLE_INTEGER_MIN || *max > PORTABLE_INTEGER_MAX {
                return Err("integer bounds are outside the portable safe range".to_owned());
            }
        }
        ResultValueContract::FiniteReal { min, max } => {
            if !min.is_finite() || !max.is_finite() || min > max {
                return Err("finiteReal bounds are invalid".to_owned());
            }
        }
        ResultValueContract::Literal { value } => {
            if value.is_array() || value.is_object() {
                return Err("literal must be a JSON scalar".to_owned());
            }
        }
        ResultValueContract::Array { element, max_items } => {
            if *max_items > 1_024 {
                return Err("array maxItems exceeds 1,024".to_owned());
            }
            validate_stored_structured_descriptor(
                element,
                StructuredDescriptorPosition::Interior,
                depth + 1,
                object_fields,
            )?;
        }
        ResultValueContract::Union { variants } => {
            if variants.len() < 2 || variants.len() > 8 {
                return Err("union must contain 2–8 variants".to_owned());
            }
            if !crate::manifest::stored_structured_union_is_disjoint(variants) {
                return Err("union variants are not syntactically disjoint".to_owned());
            }
            for variant in variants {
                validate_stored_structured_descriptor(
                    variant,
                    StructuredDescriptorPosition::UnionVariant,
                    depth + 1,
                    object_fields,
                )?;
            }
        }
        ResultValueContract::Object {
            fields,
            allow_extra,
        } => {
            if *allow_extra {
                return Err("objects must be closed (allowExtra false)".to_owned());
            }
            *object_fields = object_fields.saturating_add(fields.len());
            if *object_fields > 128 {
                return Err("contract exceeds 128 object fields".to_owned());
            }
            let mut names = BTreeSet::new();
            for member in fields {
                if member.name.is_empty() || !names.insert(member.name.as_str()) {
                    return Err("object field names must be non-empty and unique".to_owned());
                }
                validate_stored_structured_descriptor(
                    &member.value,
                    StructuredDescriptorPosition::Interior,
                    depth + 1,
                    object_fields,
                )?;
            }
        }
        // @ref LLP 0211#declaration-closed-dispatch-closed-interior — a
        // nested principal is a validated nominal snapshot only; structured
        // interiors remain opaque to visibility, lookup, and authority rules.
        ResultValueContract::Principal => {}
        ResultValueContract::AssetRef => {
            return Err("assetRef leaf is not admitted".to_owned());
        }
        ResultValueContract::MediaRefV1 { .. } => {
            return Err("mediaRef.v1 leaf is not admitted".to_owned());
        }
        ResultValueContract::Id { .. } => {
            return Err("id/relation reference leaf is not admitted".to_owned());
        }
        ResultValueContract::Json { .. } => {
            return Err("json escape-hatch leaf is not admitted".to_owned());
        }
        ResultValueContract::Tuple { .. } => {
            return Err("tuple leaf is not admitted".to_owned());
        }
        ResultValueContract::Vector { .. } => {
            return Err("vector leaf is not admitted".to_owned());
        }
        ResultValueContract::PlatformSchemaRef { .. } => {
            return Err("platform schema reference is not admitted".to_owned());
        }
    }
    Ok(())
}

fn expected_authority_profile_operations(
    membership: &MembershipManifest,
) -> Vec<AuthorityProfileOperationV1> {
    // @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface — these
    // are lifecycle affordance names over the same generated references, not
    // additional storage/runtime operations.
    let query = |name| {
        let dedicated = match &name {
            AuthorityProfileOperationNameV1::List => AuthorityProfileHookV1::AuthorityRoster,
            AuthorityProfileOperationNameV1::MyRole => AuthorityProfileHookV1::AuthorityMyRole,
            _ => unreachable!("authority profile query vocabulary is closed"),
        };
        AuthorityProfileOperationV1 {
            name,
            kind: FunctionKind::LiveQuery,
            auth_requirement: AuthRequirement::Authenticated,
            hooks: vec![AuthorityProfileHookV1::Query, dedicated],
            transition_ops: Vec::new(),
        }
    };
    let mutation = |name, transition_op| AuthorityProfileOperationV1 {
        name,
        kind: FunctionKind::Mutation,
        auth_requirement: AuthRequirement::Authenticated,
        hooks: vec![
            AuthorityProfileHookV1::Mutation,
            AuthorityProfileHookV1::AuthorityMutation,
            AuthorityProfileHookV1::OutboxMutationStatus,
            AuthorityProfileHookV1::AuthorityMutationStatus,
        ],
        transition_ops: vec![transition_op],
    };
    let active = membership.roles.iter().collect::<BTreeSet<_>>();
    let pending = membership
        .pending_roles
        .iter()
        .flatten()
        .collect::<BTreeSet<_>>();
    let transitions = &membership.transitions;
    let has_role = |roles: Option<&Vec<String>>, vocabulary: &BTreeSet<&String>| {
        roles.is_some_and(|roles| roles.iter().any(|role| vocabulary.contains(role)))
    };
    let excludes_owner = |roles: Option<&Vec<String>>| {
        roles.is_none_or(|roles| roles.iter().all(|role| role != "owner"))
    };

    let mut operations = vec![
        query(AuthorityProfileOperationNameV1::List),
        query(AuthorityProfileOperationNameV1::MyRole),
    ];
    if transitions.iter().any(|transition| {
        transition.op == MembershipOp::Insert
            && transition.target == MembershipTarget::Other
            && transition
                .to
                .as_ref()
                .is_some_and(|roles| !roles.is_empty())
    }) {
        operations.push(mutation(
            AuthorityProfileOperationNameV1::Invite,
            AuthorityProfileTransitionOpV1::Insert,
        ));
    }
    if transitions.iter().any(|transition| {
        transition.op == MembershipOp::SetRole
            && transition.target == MembershipTarget::Own
            && has_role(transition.from.as_ref(), &pending)
            && has_role(transition.to.as_ref(), &active)
    }) {
        operations.push(mutation(
            AuthorityProfileOperationNameV1::Join,
            AuthorityProfileTransitionOpV1::SetRole,
        ));
    }
    if transitions.iter().any(|transition| {
        transition.op == MembershipOp::Remove
            && transition.target == MembershipTarget::Own
            && transition.from.as_ref().is_some_and(|roles| {
                roles
                    .iter()
                    .any(|role| role != "owner" && active.contains(role))
            })
    }) {
        operations.push(mutation(
            AuthorityProfileOperationNameV1::Leave,
            AuthorityProfileTransitionOpV1::Remove,
        ));
    }
    if transitions.iter().any(|transition| {
        transition.op == MembershipOp::SetRole
            && transition.target == MembershipTarget::Other
            && excludes_owner(transition.from.as_ref())
            && excludes_owner(transition.to.as_ref())
            && transition
                .to
                .as_ref()
                .is_some_and(|roles| !roles.is_empty())
    }) {
        operations.push(mutation(
            AuthorityProfileOperationNameV1::ChangeRole,
            AuthorityProfileTransitionOpV1::SetRole,
        ));
    }
    if membership.roles.iter().any(|role| role == "owner") && membership.roles.len() > 1 {
        operations.push(mutation(
            AuthorityProfileOperationNameV1::TransferOwner,
            AuthorityProfileTransitionOpV1::TransferOwner,
        ));
    }
    if transitions.iter().any(|transition| {
        transition.op == MembershipOp::Remove
            && transition.target == MembershipTarget::Other
            && excludes_owner(transition.from.as_ref())
    }) {
        operations.push(mutation(
            AuthorityProfileOperationNameV1::Remove,
            AuthorityProfileTransitionOpV1::Remove,
        ));
    }
    operations
}

fn validate_authority_profile_role_lattice(table: &TableManifest) -> SnapbackResult<()> {
    let Some(profile) = table.authority_profile.as_ref() else {
        return Ok(());
    };
    let invalid = |reason: &str, expected_order: Vec<String>| {
        SnapbackError::error(
            "SNAPBACK_AUTHORITY_PROFILE_ROLE_LATTICE_INVALID",
            "auth",
            format!(
                "authority profile {} on table {} has a non-canonical role lattice: {reason}",
                profile.id, table.name
            ),
        )
        .with_details(json!({
            "table": table.name,
            "declaration": profile.id,
            "actualOrder": profile
                .role_lattice
                .iter()
                .map(|entry| entry.role.clone())
                .collect::<Vec<_>>(),
            "expectedOrder": expected_order,
            "reason": reason,
        }))
    };
    let relationship_invalid = |property: &str| {
        invalid(
            &format!(
                "profile-membership relationship integrity: {property} must match codegen's canonical membership-backed projection"
            ),
            Vec::new(),
        )
    };
    let Some(membership) = table.membership.as_ref() else {
        return Err(relationship_invalid("membership"));
    };

    // @ref LLP 0240#d1-declare-an-application-authority-profile-at-the-scoped-relation
    // @ref LLP 0240#d2-compile-one-authority-ir-for-read-and-write-decisions
    // — this manifest boundary independently checks every cross-reference
    // emitted by codegen's membership-backed profile: `id`,
    // `membership.declaration`, `tablePolicy.membershipDeclaration`, and the
    // transition projection bind the explicitly pinned declaration id (profile
    // tables never use the ordinary table-name fallback); membership
    // path/predicate and table-policy
    // identities bind their canonical sources; `scopeRelation` binds the
    // table plus resource/principal axes and nominal resource table;
    // `statusPredicates` binds active/pending role sources; the lattice
    // vocabulary and reverse index bind the membership role axis; owner fields
    // bind membership bootstrap/last-holder roles; transition preconditions
    // bind the membership transition source, the complete canonical matrix,
    // provenance mode, expiry presence, and principal-addressed remove opt-in;
    // authorization event fields bind
    // all non-incidental table fields plus enabled provenance; subject
    // derivation binds the membership principal/scope axes; roster fields bind
    // real table fields; `requiredIndexes` exactly describes the real
    // generated unique and reverse membership indexes; and `operations`
    // exactly reflects the admitted transition matrix plus active/pending role
    // vocabulary. Profile-local hierarchy closure, wake-universe constants,
    // and composition classes have no independent membership cross-reference;
    // the closed generation binds
    // their emitted content instead. No emitted profile↔membership relationship
    // is trusted merely because codegen would ordinarily construct it.
    let Some(declaration) = membership.id.as_deref() else {
        return Err(relationship_invalid("membership.id"));
    };
    let manifest_path = format!("tables.{}.membership", table.name);
    for (property, actual, expected) in [
        ("profile.id", profile.id.as_str(), declaration),
        (
            "membership.declaration",
            profile.membership.declaration.as_str(),
            declaration,
        ),
        (
            "membership.manifestPath",
            profile.membership.manifest_path.as_str(),
            manifest_path.as_str(),
        ),
        (
            "membership.predicateIdentity",
            profile.membership.predicate_identity.as_str(),
            "snapback.membership-predicate.v1",
        ),
        (
            "tablePolicy.identity",
            profile.table_policy.identity.as_str(),
            "snapback.table-visibility.v1",
        ),
        (
            "tablePolicy.membershipDeclaration",
            profile.table_policy.membership_declaration.as_str(),
            declaration,
        ),
        (
            "scopeRelation.table",
            profile.scope_relation.table.as_str(),
            table.name.as_str(),
        ),
        (
            "statusPredicates.active",
            profile.status_predicates.active.as_str(),
            "membership.roles",
        ),
        (
            "statusPredicates.invited",
            profile.status_predicates.invited.as_str(),
            "membership.pendingRoles",
        ),
        (
            "transitionPreconditions.source",
            profile.transition_preconditions.source.as_str(),
            "membership.transitions",
        ),
        (
            "transitionPreconditions.membershipDeclarationId",
            profile
                .transition_preconditions
                .membership_declaration_id
                .as_str(),
            declaration,
        ),
        (
            "transitionPreconditions.ownerMutation",
            profile.transition_preconditions.owner_mutation.as_str(),
            "transfer-owner-only",
        ),
        (
            "subjectDerivation.strategy",
            profile.subject_derivation.strategy.as_str(),
            "membership-principal-resource-v1",
        ),
        (
            "subjectDerivation.principalField",
            profile.subject_derivation.principal_field.as_str(),
            membership.principal.as_str(),
        ),
        (
            "scopeRelation.principalKey",
            profile.scope_relation.principal_key.as_str(),
            membership.principal.as_str(),
        ),
    ] {
        if actual != expected {
            return Err(relationship_invalid(property));
        }
    }
    if profile.transition_preconditions.matrix
        != canonical_membership_transition_matrix(&membership.transitions)
    {
        return Err(relationship_invalid(
            "transitionPreconditions.matrix/membership.transitions",
        ));
    }
    if profile.transition_preconditions.provenance != membership.provenance {
        return Err(relationship_invalid(
            "transitionPreconditions.provenance/membership.provenance",
        ));
    }
    if profile.transition_preconditions.expiry_present != membership.expiry.is_some() {
        return Err(relationship_invalid(
            "transitionPreconditions.expiryPresent/membership.expiry",
        ));
    }
    if profile
        .transition_preconditions
        .principal_addressed_writes_remove
        != membership
            .principal_addressed_writes
            .as_ref()
            .map(|writes| writes.remove)
    {
        return Err(relationship_invalid(
            "transitionPreconditions.principalAddressedWritesRemove/membership.principalAddressedWrites.remove",
        ));
    }
    if membership.scope != MembershipScope::Resource {
        return Err(relationship_invalid("membership.scope"));
    }
    let Some(resource_field) = membership.resource.as_deref() else {
        return Err(relationship_invalid("scopeRelation.resourceField"));
    };
    let Some(resource_table) = membership.resource_table.as_deref() else {
        return Err(relationship_invalid("scopeRelation.resourceTable"));
    };
    for (property, actual, expected) in [
        (
            "scopeRelation.resourceField",
            profile.scope_relation.resource_field.as_str(),
            resource_field,
        ),
        (
            "scopeRelation.resourceTable",
            profile.scope_relation.resource_table.as_str(),
            resource_table,
        ),
        (
            "subjectDerivation.scopeField",
            profile.subject_derivation.scope_field.as_str(),
            resource_field,
        ),
    ] {
        if actual != expected {
            return Err(relationship_invalid(property));
        }
    }

    if membership.bootstrap_role.as_deref()
        != Some(profile.owner_bootstrap_invariant.bootstrap_role.as_str())
    {
        return Err(relationship_invalid(
            "ownerBootstrapInvariant.bootstrapRole/membership.bootstrapRole",
        ));
    }
    if membership
        .last_holder
        .as_ref()
        .map(|last| last.protect.as_str())
        != Some(
            profile
                .owner_bootstrap_invariant
                .protected_last_holder_role
                .as_str(),
        )
    {
        return Err(relationship_invalid(
            "ownerBootstrapInvariant.protectedLastHolderRole/membership.lastHolder.protect",
        ));
    }
    let incidental = membership.incidental.as_deref().unwrap_or(&[]);
    let mut authorization_event_fields = table
        .fields
        .iter()
        .map(|field| field.name.clone())
        .filter(|field| !incidental.contains(field))
        .collect::<Vec<_>>();
    if membership.provenance.is_some() {
        authorization_event_fields.extend(MEMBERSHIP_PROVENANCE_COLUMNS.map(str::to_owned));
    }
    if profile.authorization_event_fields != authorization_event_fields {
        return Err(relationship_invalid("authorizationEventFields"));
    }

    let table_fields = table
        .fields
        .iter()
        .map(|field| field.name.as_str())
        .collect::<BTreeSet<_>>();
    if profile.roster.visible_fields.is_empty()
        || profile
            .roster
            .visible_fields
            .iter()
            .collect::<BTreeSet<_>>()
            .len()
            != profile.roster.visible_fields.len()
        || profile
            .roster
            .visible_fields
            .iter()
            .any(|field| !table_fields.contains(field.as_str()))
    {
        return Err(relationship_invalid("roster.visibleFields"));
    }

    if profile.operations != expected_authority_profile_operations(membership) {
        return Err(relationship_invalid("operations/membership.transitions"));
    }

    let (unique_name, unique_fields) =
        membership_unique_index(table).expect("authority profile requires membership indexes");
    let (reverse_name, reverse_fields) =
        membership_reverse_index(table).expect("authority profile requires membership indexes");
    let expected_indexes = [
        (unique_name, unique_fields, true, "principal-in-scope-point"),
        (
            reverse_name,
            reverse_fields,
            false,
            "protected-holders-and-scope-invalidation-range",
        ),
    ];
    if profile.required_indexes.len() != expected_indexes.len() {
        return Err(relationship_invalid("requiredIndexes.length"));
    }
    for (actual, (name, fields, unique, lookup)) in
        profile.required_indexes.iter().zip(expected_indexes)
    {
        let prefix = format!("requiredIndexes.{name}");
        if actual.name != name {
            return Err(relationship_invalid(&format!("{prefix}.name")));
        }
        if actual.fields != fields {
            return Err(relationship_invalid(&format!("{prefix}.fields")));
        }
        if actual.unique != unique {
            return Err(relationship_invalid(&format!("{prefix}.unique")));
        }
        if actual.lookup != lookup {
            return Err(relationship_invalid(&format!("{prefix}.lookup")));
        }
    }

    let roles = profile
        .role_lattice
        .iter()
        .map(|entry| entry.role.clone())
        .collect::<Vec<_>>();
    if roles.is_empty()
        || roles.iter().any(|role| role.is_empty())
        || roles.iter().collect::<BTreeSet<_>>().len() != roles.len()
    {
        return Err(invalid(
            "role-vocabulary integrity: role entries must be non-empty and unique",
            Vec::new(),
        ));
    }

    let role_vocabulary = membership.roles.iter().cloned().collect::<BTreeSet<_>>();
    let lattice_vocabulary = roles.iter().cloned().collect::<BTreeSet<_>>();
    if lattice_vocabulary != role_vocabulary {
        return Err(invalid(
            "role-vocabulary integrity: roleLattice[].role/membership.roles must exactly match active membership roles",
            Vec::new(),
        ));
    }

    for (property, value) in [
        (
            "ownerBootstrapInvariant.role",
            profile.owner_bootstrap_invariant.role.as_str(),
        ),
        (
            "ownerBootstrapInvariant.bootstrapRole",
            profile.owner_bootstrap_invariant.bootstrap_role.as_str(),
        ),
        (
            "ownerBootstrapInvariant.protectedLastHolderRole",
            profile
                .owner_bootstrap_invariant
                .protected_last_holder_role
                .as_str(),
        ),
    ] {
        if value != "owner" {
            return Err(invalid(
                &format!("owner-bootstrap integrity: {property} must be the literal \"owner\""),
                Vec::new(),
            ));
        }
    }

    let mut implications = BTreeMap::new();
    for entry in &profile.role_lattice {
        if entry
            .implies
            .iter()
            .any(|implied| !role_vocabulary.contains(implied))
        {
            return Err(invalid(
                "implies-vocabulary integrity: every implied role must belong to the active role vocabulary",
                Vec::new(),
            ));
        }
        let implied_set = entry.implies.iter().cloned().collect::<BTreeSet<_>>();
        if entry.implies.iter().filter(|role| *role == &entry.role).count() != 1
            || implied_set.len() != entry.implies.len()
        {
            return Err(invalid(
                "self-inclusion integrity: each role must imply itself exactly once and implication entries must be unique",
                Vec::new(),
            ));
        }
        implications.insert(entry.role.clone(), implied_set);
    }

    for (role, implied) in &implications {
        for intermediate in implied {
            let descendants = implications
                .get(intermediate)
                .expect("implied-role vocabulary was validated");
            if !descendants.is_subset(implied) {
                return Err(invalid(
                    "closure transitivity: every role must include all roles implied by each of its implied roles",
                    Vec::new(),
                ));
            }
        }
        if implied.iter().any(|other| {
            other != role
                && implications
                    .get(other)
                    .is_some_and(|other_implied| other_implied.contains(role))
        }) {
            return Err(invalid(
                "acyclicity: distinct roles must not mutually imply one another",
                Vec::new(),
            ));
        }
    }

    let owner_role = &profile.owner_bootstrap_invariant.role;
    if !implications
        .get(owner_role)
        .is_some_and(|implied| role_vocabulary.is_subset(implied))
    {
        return Err(invalid(
            "owner coverage: the declared owner must imply every active role",
            Vec::new(),
        ));
    }

    let mut ordered = profile
        .role_lattice
        .iter()
        .map(|entry| {
            (
                entry.role.clone(),
                implications
                    .get(&entry.role)
                    .expect("lattice role vocabulary was validated")
                    .clone(),
            )
        })
        .collect::<Vec<_>>();
    ordered.sort_by(|(left_role, left_implies), (right_role, right_implies)| {
        let left_strict_superset =
            left_implies.len() > right_implies.len() && right_implies.is_subset(left_implies);
        let right_strict_superset =
            right_implies.len() > left_implies.len() && left_implies.is_subset(right_implies);
        if left_strict_superset {
            std::cmp::Ordering::Less
        } else if right_strict_superset {
            std::cmp::Ordering::Greater
        } else {
            right_implies
                .len()
                .cmp(&left_implies.len())
                // Codegen's `compareCodeUnits` uses JavaScript string order.
                // Match its UTF-16 code-unit tie-break exactly at this trust
                // boundary, including supplementary-plane role names.
                .then_with(|| crate::rqs_contract::cmp_utf16(left_role, right_role))
        }
    });
    let expected_order = ordered
        .into_iter()
        .map(|(role, _)| role)
        .collect::<Vec<_>>();
    // @ref LLP 0240#d1-declare-an-application-authority-profile-at-the-scoped-relation
    // — transferOwner selects the first active non-owner role. The manifest is
    // a trust boundary, so it must preserve codegen's canonical hierarchy-
    // topological order instead of letting hand-authored vector order choose
    // the former owner's successor state.
    if roles.first() != Some(&profile.owner_bootstrap_invariant.role) || roles != expected_order {
        return Err(invalid(
            "entries must be hierarchy-topological (strict supersets first, then larger implied sets, then lexical role)",
            expected_order,
        ));
    }
    Ok(())
}

fn validate_schema(manifest: &SchemaManifest) -> SnapbackResult<()> {
    validate_collection_definitions(&manifest.ephemeral_collections).map_err(|error| {
        SnapbackError::error(error.code.diagnostic_code(), "ephemeral", error.message)
    })?;
    let mut tables = BTreeSet::new();
    // SQLite index names are database-global, and the physical name is
    // `{table}_{index}` joined with `_` — a character both identifiers may
    // contain — so distinct declarations can join to the same physical name
    // (table `foo` + index `bar_baz` vs table `foo_bar` + index `baz`).
    // Validate joined names globally; otherwise the second index would
    // silently never be created (`create_index` would find the first one).
    let mut physical_index_names: BTreeMap<String, String> = BTreeMap::new();
    // Stable membership declaration ids are unique across the whole manifest —
    // a collision is a load error, because helpers, audit rows, room bindings,
    // and future LLP 0055 resource-scope grants reference the id durably.
    // @ref LLP 0056#declaring-a-membership-table — ids are unique across the manifest.
    let mut membership_declaration_ids: BTreeMap<String, String> = BTreeMap::new();
    let framework_collection_tables = manifest
        .asset_collections
        .iter()
        .map(|collection| collection.child_table.as_str())
        .collect::<BTreeSet<_>>();
    for table in &manifest.tables {
        if framework_collection_tables.contains(table.name.as_str()) {
            if !table.name.starts_with("_snapback_asset_collection_")
                || !table
                    .name
                    .bytes()
                    .all(|byte| byte == b'_' || byte.is_ascii_alphanumeric())
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_MEDIA_COLLECTION_MANIFEST_INVALID",
                    "asset-collection",
                    format!("invalid framework-owned collection table {}", table.name),
                ));
            }
        } else {
            validate_user_identifier("table", &table.name)?;
        }
        if !tables.insert(table.name.clone()) {
            return Err(SnapbackError::error(
                "SNAPBACK_SCHEMA_DUPLICATE_TABLE",
                "schema",
                format!("duplicate table {}", table.name),
            ));
        }
        if let Some(history) = &table.history
            && (history.retain_ms == 0
                || history.retain_ms > crate::proof_checkpoint::HISTORY_MAX_RETENTION_MS
                || history.max_versions_per_record == 0
                || history.max_versions_per_record
                    > crate::proof_checkpoint::HISTORY_MAX_VERSIONS_PER_RECORD)
        {
            return Err(SnapbackError::error(
                "SNAPBACK_HISTORY_POLICY_INVALID",
                "schema",
                format!(
                    "table {} history exceeds the finite v1 age or versions-per-record bound",
                    table.name
                ),
            )
            .with_detail("table", table.name.clone()));
        }

        let mut fields = BTreeSet::new();
        for field in &table.fields {
            validate_user_identifier("field", &field.name)?;
            if is_system_field(&field.name) {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_SYSTEM_FIELD",
                    "schema",
                    format!("{} is managed by Snapback", field.name),
                ));
            }
            if !fields.insert(field.name.clone()) {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_DUPLICATE_FIELD",
                    "schema",
                    format!("duplicate field {}.{}", table.name, field.name),
                ));
            }
            if let FieldType::Enum { values } = &field.field_type {
                // Seven, not the argument grammar's eight: an optional field's
                // document contract expands to `null | …`, and LLP 0108 bounds
                // a result union at eight variants. One bound for required and
                // optional fields keeps a later optional-ization from refusing.
                let invalid = if values.len() < 2 || values.len() > 7 {
                    Some(format!(
                        "enum domain must contain 2–7 values, got {}",
                        values.len()
                    ))
                } else if values.iter().any(String::is_empty) {
                    Some("enum domain values must be non-empty".to_owned())
                } else if let Some(value) = values.iter().find(|value| value.len() > 64) {
                    Some(format!(
                        "enum value {value:?} is {} UTF-8 bytes; the maximum is 64",
                        value.len()
                    ))
                } else if values.iter().collect::<BTreeSet<_>>().len() != values.len() {
                    Some("enum domain values must be unique".to_owned())
                } else {
                    None
                };
                if let Some(reason) = invalid {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SCHEMA_ENUM_DOMAIN_INVALID",
                        "schema",
                        format!(
                            "stored enum {}.{} is invalid: {reason}",
                            table.name, field.name
                        ),
                    )
                    .with_detail("table", table.name.clone())
                    .with_detail("field", field.name.clone())
                    .with_detail("reason", reason));
                }
            }
            if let FieldType::Structured {
                contract,
                contract_hash,
            } = &field.field_type
            {
                validate_stored_structured_contract(
                    &table.name,
                    &field.name,
                    contract,
                    contract_hash,
                )?;
            }
            if let FieldType::RelationIncarnation {
                foreign_key_field,
                parent_table,
            } = &field.field_type
            {
                if field.optional {
                    return Err(SnapbackError::error(
                        "SNAPBACK_RELATION_SCHEMA_INVALID",
                        "schema",
                        "relation-incarnation fields must be required",
                    )
                    .with_details(json!({
                        "table": table.name,
                        "field": field.name,
                    })));
                }
                let foreign_key = table.field(foreign_key_field).ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_RELATION_SCHEMA_INVALID",
                        "schema",
                        "relation-incarnation field names an unknown foreign key",
                    )
                    .with_details(json!({
                        "table": table.name,
                        "field": field.name,
                        "foreignKeyField": foreign_key_field,
                    }))
                })?;
                if foreign_key.optional
                    || !matches!(
                        &foreign_key.field_type,
                        FieldType::Id { table } if table == parent_table
                    )
                    || manifest.table(parent_table).is_none()
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_RELATION_SCHEMA_INVALID",
                        "schema",
                        "relation foreign key must be a required id of the declared parent",
                    )
                    .with_details(json!({
                        "table": table.name,
                        "field": field.name,
                        "foreignKeyField": foreign_key_field,
                        "parentTable": parent_table,
                    })));
                }
            }
            if let FieldType::RelationIncarnation {
                foreign_key_field,
                parent_table,
            } = &field.field_type
            {
                let foreign_key = table.field(foreign_key_field).ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_RELATION_SCHEMA_INVALID",
                        "schema",
                        "relation-incarnation field names an unknown foreign key",
                    )
                    .with_details(json!({
                        "table": table.name,
                        "field": field.name,
                        "foreignKeyField": foreign_key_field,
                    }))
                })?;
                if field.optional
                    || foreign_key.optional
                    || !matches!(
                        &foreign_key.field_type,
                        FieldType::Id { table } if table == parent_table
                    )
                    || manifest.table(parent_table).is_none()
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_RELATION_SCHEMA_INVALID",
                        "schema",
                        "relation stamp must be required and pair with a required parent id",
                    )
                    .with_details(json!({
                        "table": table.name,
                        "field": field.name,
                        "foreignKeyField": foreign_key_field,
                        "parentTable": parent_table,
                    })));
                }
            }
        }

        if table.permission_fields.is_some() && !table.permission_backing {
            return Err(SnapbackError::error(
                "SNAPBACK_SCHEMA_PERMISSION_FIELDS_WITHOUT_BACKING",
                "schema",
                format!(
                    "table {} declares permissionFields without permissionBacking",
                    table.name
                ),
            )
            .with_detail("table", table.name.clone()));
        }
        if let Some(permission_fields) = &table.permission_fields {
            let mut seen_permission_fields = BTreeSet::new();
            for field in permission_fields {
                validate_user_identifier("permission field", field)?;
                if !fields.contains(field) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SCHEMA_PERMISSION_FIELD_UNKNOWN",
                        "schema",
                        format!(
                            "table {} permissionFields references unknown field {}",
                            table.name, field
                        ),
                    )
                    .with_detail("table", table.name.clone())
                    .with_detail("field", field.clone()));
                }
                if !seen_permission_fields.insert(field.clone()) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SCHEMA_PERMISSION_FIELD_DUPLICATE",
                        "schema",
                        format!(
                            "table {} permissionFields repeats field {}",
                            table.name, field
                        ),
                    )
                    .with_detail("table", table.name.clone())
                    .with_detail("field", field.clone()));
                }
            }
        }

        let mut indexes = BTreeSet::new();
        for index in &table.indexes {
            validate_user_identifier("index", &index.name)?;
            if !indexes.insert(index.name.clone()) {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_DUPLICATE_INDEX",
                    "schema",
                    format!("duplicate index {}.{}", table.name, index.name),
                ));
            }
            let physical = format!("{}_{}", table.name, index.name);
            let declaration = format!("{}.{}", table.name, index.name);
            if let Some(previous) = physical_index_names.insert(physical.clone(), declaration) {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_INDEX_NAME_COLLISION",
                    "schema",
                    format!(
                        "index {}.{} and {previous} share the physical index name \
                         {physical}; SQLite index names are database-global — \
                         rename one of them",
                        table.name, index.name
                    ),
                )
                .with_detail("physicalName", physical)
                .with_detail(
                    "declarations",
                    json!([previous, format!("{}.{}", table.name, index.name)]),
                ));
            }
            if index.fields.is_empty() {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_EMPTY_INDEX",
                    "schema",
                    format!("index {}.{} has no fields", table.name, index.name),
                ));
            }
            let index_fields = index
                .fields
                .iter()
                .map(|field| ensure_field(table, field))
                .collect::<SnapbackResult<Vec<_>>>()?;
            for (field, field_manifest) in index.fields.iter().zip(index_fields.iter()) {
                if matches!(field_manifest.field_type, FieldType::Structured { .. }) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SCHEMA_STRUCTURED_INDEX_UNSUPPORTED",
                        "schema",
                        "ordinary indexes cannot observe opaque structured fields; declare a scalar projection when indexing is required",
                    )
                    .with_detail("table", table.name.clone())
                    .with_detail("index", index.name.clone())
                    .with_detail("field", field.clone()));
                }
            }
            let has_optional_field = index_fields.iter().any(|field| field.optional);
            let expected_where_applicable = index.unique && has_optional_field;
            if index.where_applicable != expected_where_applicable {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_INDEX_WHERE_APPLICABLE_MISMATCH",
                    "schema",
                    format!(
                        "index {}.{} whereApplicable must be {} for its unique and optional-field declarations",
                        table.name, index.name, expected_where_applicable
                    ),
                )
                .with_detail("table", table.name.clone())
                .with_detail("index", index.name.clone())
                .with_detail("expectedWhereApplicable", expected_where_applicable)
                .with_detail("actualWhereApplicable", index.where_applicable));
            }
        }

        let mut search_names = BTreeSet::new();
        for search in &table.search_indexes {
            validate_user_identifier("search index", &search.name)?;
            if !search_names.insert(search.name.clone()) || indexes.contains(&search.name) {
                return Err(SnapbackError::error(
                    "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
                    "search",
                    format!("duplicate search/index name {}.{}", table.name, search.name),
                ));
            }
            if search.format_version != 1
                || search.semantic_version.is_empty()
                || search.analyzer != crate::search::types::SEARCH_ANALYZER
                || search.analyzer_tables_digest
                    != crate::search::unicode17_generated::ANALYZER_TABLES_DIGEST
                || search.tie_break != "score-desc-row-id-asc.v1"
                || search.text_fields.is_empty()
                || search.text_fields.len() > 16
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
                    "search",
                    format!(
                        "search index {}.{} is outside full-text-search-v1",
                        table.name, search.name
                    ),
                ));
            }
            for (field, text) in &search.text_fields {
                let declared = ensure_field(table, field)?;
                if declared.field_type != FieldType::String
                    || text.weight == 0
                    || text.weight > 64
                    || matches!(
                        text.classification,
                        crate::search::types::SearchFieldClassV1::Sensitive
                            | crate::search::types::SearchFieldClassV1::Forbidden
                    )
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
                        "search",
                        format!(
                            "search text field {}.{}.{} must be a non-sensitive string with weight 1..64",
                            table.name, search.name, field
                        ),
                    ));
                }
            }
            for field in search
                .equality_filters
                .iter()
                .chain(search.stored_fields.iter())
                .chain(search.highlight_fields.iter())
            {
                ensure_field(table, field)?;
            }
            for field in &search.equality_filters {
                let declared = ensure_field(table, field)?;
                if !matches!(
                    declared.field_type,
                    FieldType::String
                        | FieldType::Enum { .. }
                        | FieldType::Boolean
                        | FieldType::Integer
                        | FieldType::Principal
                        | FieldType::Id { .. }
                ) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
                        "search",
                        format!(
                            "search equality field {}.{}.{} must use a portable exact scalar type",
                            table.name, search.name, field
                        ),
                    ));
                }
            }
            for field in &search.stored_fields {
                let declared = ensure_field(table, field)?;
                if matches!(
                    declared.field_type,
                    FieldType::Json | FieldType::Structured { .. }
                ) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
                        "search",
                        format!(
                            "search stored field {}.{}.{} must be a bounded scalar display field",
                            table.name, search.name, field
                        ),
                    ));
                }
            }
            if search
                .highlight_fields
                .iter()
                .any(|field| !search.text_fields.contains_key(field))
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
                    "search",
                    format!(
                        "search index {}.{} highlights must name indexed text fields",
                        table.name, search.name
                    ),
                ));
            }
            for fields in [
                &search.equality_filters,
                &search.stored_fields,
                &search.highlight_fields,
            ] {
                if fields.windows(2).any(|pair| pair[0] >= pair[1]) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
                        "search",
                        format!(
                            "search index {}.{} field sets must be lexically sorted and unique",
                            table.name, search.name
                        ),
                    ));
                }
            }
            let source_limits = &search.source_limits;
            let query_limits = &search.query_limits;
            let cursor_limits = &search.cursor_limits;
            let maintenance_limits = &search.maintenance_limits;
            let live_limits_invalid = search.live_limits.as_ref().is_some_and(|limits| {
                limits.max_live_subscriptions == 0
                    || limits.max_live_subscriptions > 64
                    || limits.max_live_subscriptions_per_connection == 0
                    || limits.max_live_subscriptions_per_connection > 8
                    || limits.max_live_subscriptions_per_connection > limits.max_live_subscriptions
            });
            if source_limits.max_indexed_bytes == 0
                || source_limits.max_indexed_bytes > 32 * 1024
                || source_limits.max_tokens == 0
                || source_limits.max_tokens > 2_048
                || source_limits.max_posting_operations == 0
                || source_limits.max_posting_operations > 4_096
                || query_limits.max_candidate_work == 0
                || query_limits.max_candidate_work > 10_000
                || query_limits.max_prefix_terms == 0
                || query_limits.max_prefix_terms > 256
                || !(1..=64).contains(&query_limits.min_prefix_scalars)
                || cursor_limits.ttl_ms != crate::search::types::SEARCH_CURSOR_TTL_MS
                || cursor_limits.max_bytes as usize != crate::search::types::SEARCH_CURSOR_MAX_BYTES
                || maintenance_limits.search_maintenance_effects == 0
                || maintenance_limits.search_maintenance_effects as usize
                    > crate::search::types::SEARCH_MAX_MAINTENANCE_EFFECTS
                || maintenance_limits.search_posting_ops == 0
                || maintenance_limits.search_posting_ops as usize
                    > crate::search::types::SEARCH_MAX_POSTING_OPS
                || maintenance_limits.search_positions == 0
                || maintenance_limits.search_positions as usize
                    > crate::search::types::SEARCH_MAX_POSITIONS
                || maintenance_limits.search_bytes == 0
                || maintenance_limits.search_bytes as usize
                    > crate::search::types::SEARCH_MAX_BYTES_PER_COMMIT
                || live_limits_invalid
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
                    "search",
                    format!(
                        "search index {}.{} limits exceed or contradict the portable v1 ceilings",
                        table.name, search.name
                    ),
                ));
            }
            match &search.visibility {
                crate::search::types::SearchVisibilityV1::PublicRead => {
                    if search.text_fields.values().any(|field| {
                        field.classification != crate::search::types::SearchFieldClassV1::Public
                    }) {
                        return Err(SnapbackError::error(
                            "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
                            "search",
                            "public-read search admits only public text fields",
                        ));
                    }
                }
                crate::search::types::SearchVisibilityV1::Owner { field } => {
                    let owner = ensure_field(table, field)?;
                    if owner.optional
                        || !matches!(owner.field_type, FieldType::String | FieldType::Principal)
                    {
                        return Err(SnapbackError::error(
                            "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
                            "search",
                            format!(
                                "owner search {}.{} requires a non-optional string/principal owner field",
                                table.name, search.name
                            ),
                        ));
                    }
                }
                crate::search::types::SearchVisibilityV1::Membership {
                    declaration,
                    resource_field,
                    roles,
                } => {
                    let resource = ensure_field(table, resource_field)?;
                    let declared = crate::membership_rules::find_declaration(manifest, declaration);
                    let valid_roles = roles.as_ref().is_none_or(|roles| {
                        !roles.is_empty()
                            && roles.iter().collect::<BTreeSet<_>>().len() == roles.len()
                            && declared.is_some_and(|(_, membership)| {
                                roles
                                    .iter()
                                    .all(|role| membership.vocabulary().any(|known| known == role))
                            })
                    });
                    if resource.optional
                        || !matches!(
                            resource.field_type,
                            FieldType::String | FieldType::Principal | FieldType::Id { .. }
                        )
                        || !declared.is_some_and(|(_, membership)| {
                            membership.scope == MembershipScope::Resource
                        })
                        || !valid_roles
                    {
                        return Err(SnapbackError::error(
                            "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
                            "search",
                            format!(
                                "membership search {}.{} requires one resource-scoped declaration, a required string/principal/id resource field, and declared roles",
                                table.name, search.name
                            ),
                        ));
                    }
                }
            }
        }
        if let Some(limits) = &table.search_live_limits
            && (table.search_indexes.is_empty()
                || limits.max_live_subscriptions_per_table == 0
                || limits.max_live_subscriptions_per_table > 128)
        {
            return Err(SnapbackError::error(
                "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
                "search",
                format!(
                    "table {} searchLiveLimits requires a search index and a 1..128 aggregate ceiling",
                    table.name
                ),
            ));
        }

        validate_membership_declaration(
            table,
            &fields,
            &mut physical_index_names,
            &mut membership_declaration_ids,
        )?;
        validate_authority_profile_role_lattice(table)?;
    }

    // Complete the nominal resource binding after every table name is known.
    // Declaration validation already proves `v.id(table)` agrees with
    // `resourceTable`; this proves that target participates in the activation.
    for table in &manifest.tables {
        let Some(membership) = &table.membership else {
            continue;
        };
        if membership.scope != MembershipScope::Resource {
            continue;
        }
        let declaration = membership.effective_id(&table.name);
        let resource_table = membership.resource_table.as_deref().ok_or_else(|| {
            membership_error(
                "SNAPBACK_MEMBERSHIP_RESOURCE_TABLE_REQUIRED",
                &table.name,
                declaration,
                "a resource-scoped membership must declare resourceTable",
            )
        })?;
        if manifest.table(resource_table).is_none() {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_RESOURCE_TABLE_UNKNOWN",
                &table.name,
                declaration,
                format!("resourceTable {resource_table:?} is not an active table in this schema"),
            )
            .with_detail("resourceTable", resource_table.to_owned()));
        }
    }

    validate_collection_permission_backing(
        &manifest.ephemeral_collections,
        &manifest.tables,
        manifest.effective_auth_mode() == crate::manifest::AuthMode::Sessions,
    )
    .map_err(|error| {
        SnapbackError::error(error.code.diagnostic_code(), "ephemeral", error.message)
    })?;

    Ok(())
}

/// Reject a manifest that redeclares an existing field with a different type.
///
/// The migrator never rewrites stored data, so a retyped field would leave the
/// physical column carrying values encoded under the old declaration while the
/// stored manifest — and every generated client type — promises the new one.
/// Even affinity-preserving changes (string → json, boolean → integer) change
/// how stored values decode, so any declared-type change is refused.
///
/// @ref LLP 0003#database-model — the migrator must "reject type changes that
/// would require rewriting existing data"; the read lane's schema-race safety
/// argument also assumes fields are never retyped.
fn reject_field_retypes(current: &SchemaManifest, next: &SchemaManifest) -> SnapbackResult<()> {
    for table in &next.tables {
        let Some(current_table) = current.tables.iter().find(|t| t.name == table.name) else {
            continue;
        };
        for field in &table.fields {
            let Some(current_field) = current_table.field(&field.name) else {
                continue;
            };
            let enum_transition = matches!(
                (&current_field.field_type, &field.field_type),
                (FieldType::Enum { .. }, FieldType::Enum { .. })
                    | (FieldType::String, FieldType::Enum { .. })
                    | (FieldType::Enum { .. }, FieldType::String)
            );
            if current_field.field_type != field.field_type && !enum_transition {
                let json_to_structured = matches!(
                    (&current_field.field_type, &field.field_type),
                    (FieldType::Json, FieldType::Structured { .. })
                );
                let reason = if json_to_structured {
                    format!(
                        "field {}.{} cannot activate directly from Json to Structured; \
                         every stored value must validate and be rewritten canonically in a \
                         reviewed successor generation — declare ConvertJsonToStructured",
                        table.name, field.name
                    )
                } else {
                    format!(
                        "field {}.{} cannot change type from {} to {}; \
                         retyping stored data is not supported — add a new field instead",
                        table.name,
                        field.name,
                        field_type_name(&current_field.field_type),
                        field_type_name(&field.field_type)
                    )
                };
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_FIELD_RETYPED",
                    "schema",
                    reviewed_migration_next_step(reason),
                )
                .with_detail("table", table.name.clone())
                .with_detail("field", field.name.clone())
                .with_detail("existingType", field_type_name(&current_field.field_type))
                .with_detail("requestedType", field_type_name(&field.field_type)));
            }
        }
    }
    Ok(())
}

/// Prove every representation-preserving enum tightening against the exact
/// predecessor rows before additive DDL or manifest publication. Widening an
/// enum and widening an enum back to String are declaration-only changes.
///
/// @ref LLP 0004#dated-alignment-stored-literal-union-domains-2026-08-08
fn validate_enum_domain_evolution(
    conn: &Connection,
    current: &SchemaManifest,
    next: &SchemaManifest,
) -> SnapbackResult<()> {
    for table in &next.tables {
        let Some(current_table) = current.table(&table.name) else {
            continue;
        };
        for field in &table.fields {
            let Some(previous) = current_table.field(&field.name) else {
                continue;
            };
            let admitted = match (&previous.field_type, &field.field_type) {
                (FieldType::Enum { values: before }, FieldType::Enum { values: after })
                    if before.iter().all(|value| after.contains(value)) =>
                {
                    continue;
                }
                (FieldType::Enum { .. }, FieldType::Enum { values })
                | (FieldType::String, FieldType::Enum { values }) => values,
                (FieldType::Enum { .. }, FieldType::String) => continue,
                _ => continue,
            };

            let placeholders = (1..=admitted.len())
                .map(|index| format!("?{index}"))
                .collect::<Vec<_>>()
                .join(", ");
            let quoted_table = quote_ident(&table.name)?;
            let quoted_field = quote_ident(&field.name)?;
            let offending: Option<String> = conn
                .query_row(
                    &format!(
                        "SELECT {quoted_field} FROM {quoted_table} \
                         WHERE {quoted_field} IS NOT NULL \
                           AND {quoted_field} NOT IN ({placeholders}) \
                         LIMIT 1"
                    ),
                    params_from_iter(admitted.iter()),
                    |row| row.get(0),
                )
                .optional()?;
            if let Some(offending_value) = offending {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_ENUM_DOMAIN_BACKFILL_REQUIRED",
                    "schema",
                    reviewed_migration_next_step(format!(
                        "field {}.{} cannot adopt enum domain {:?} while stored value {:?} is outside it",
                        table.name, field.name, admitted, offending_value
                    )),
                )
                .with_detail("table", table.name.clone())
                .with_detail("field", field.name.clone())
                .with_detail("admitted", admitted.clone())
                .with_detail("offendingValue", offending_value));
            }
        }
    }
    Ok(())
}

/// Attach the reviewed-workflow front door to every refusal that means the
/// additive startup applier cannot safely perform the requested evolution.
///
/// @ref LLP 0160#2-the-ideal-experience-moment-by-moment — Moment 2 requires
/// the applier's non-additive refusal family to name the exact next command.
fn reviewed_migration_next_step(reason: String) -> String {
    format!(
        "{reason}. Run `snapback migrate preview --help` to start the reviewed migration workflow"
    )
}

/// Required fields need a physical invariant, not only a generated type. A
/// nullable column may tighten only when every stored row is already non-null;
/// `create_or_update_table` then rebuilds the table atomically with `NOT NULL`.
/// A new required column still needs an empty table because there is no value
/// to synthesize for existing rows.
fn reject_unsafe_required_field_changes(
    conn: &Connection,
    current: &SchemaManifest,
    next: &SchemaManifest,
) -> SnapbackResult<()> {
    // The additive migrator intentionally preserves removed physical columns.
    // A required column therefore cannot disappear from a still-declared
    // table, or become optional, without leaving a hidden `NOT NULL` constraint
    // that makes otherwise-valid future inserts fail. Refuse that logical
    // weakening until the schema language has an explicit drop/backfill
    // migration. A whole removed table remains dormant and is checked against
    // its surviving physical columns if it is later reintroduced.
    //
    // @ref LLP 0007#schema-evolution — conservative evolution must preserve
    // rollback data without accepting a manifest the physical schema cannot
    // implement.
    for current_table in &current.tables {
        let Some(next_table) = next.table(&current_table.name) else {
            continue;
        };
        for previous in current_table.fields.iter().filter(|field| !field.optional) {
            let requested_change = match next_table.field(&previous.name) {
                None => Some("remove"),
                Some(field) if field.optional => Some("makeOptional"),
                Some(_) => None,
            };
            if let Some(requested_change) = requested_change {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED",
                    "schema",
                    reviewed_migration_next_step(format!(
                        "required field {}.{} cannot be removed or made optional while its preserved SQLite column is NOT NULL; explicit drop/backfill migrations are not supported",
                        current_table.name, previous.name
                    )),
                )
                .with_detail("table", current_table.name.clone())
                .with_detail("field", previous.name.clone())
                .with_detail("requestedChange", requested_change));
            }
        }
    }

    for table in &next.tables {
        let Some(current_table) = current.table(&table.name) else {
            continue;
        };
        for field in &table.fields {
            match current_table.field(&field.name) {
                Some(previous) if !field.optional => {
                    let null_count: i64 = conn.query_row(
                        &format!(
                            "SELECT COUNT(*) FROM {} WHERE {} IS NULL",
                            quote_ident(&table.name)?,
                            quote_ident(&field.name)?
                        ),
                        [],
                        |row| row.get(0),
                    )?;
                    if null_count > 0 {
                        return Err(SnapbackError::error(
                            "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED",
                            "schema",
                            reviewed_migration_next_step(format!(
                                "field {}.{} cannot become physically required while {null_count} stored rows are null",
                                table.name, field.name
                            )),
                        )
                        .with_detail("table", table.name.clone())
                        .with_detail("field", field.name.clone())
                        .with_detail("existingNullRows", null_count)
                        .with_detail("wasOptional", previous.optional));
                    }
                }
                None if !field.optional => {
                    let row_count: i64 = conn.query_row(
                        &format!("SELECT COUNT(*) FROM {}", quote_ident(&table.name)?),
                        [],
                        |row| row.get(0),
                    )?;
                    if row_count > 0 {
                        return Err(SnapbackError::error(
                            "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED",
                            "schema",
                            reviewed_migration_next_step(format!(
                                "required field {}.{} cannot be added to {row_count} existing rows without a default/backfill",
                                table.name, field.name
                            )),
                        )
                        .with_detail("table", table.name.clone())
                        .with_detail("field", field.name.clone())
                        .with_detail("existingRows", row_count));
                    }
                }
                _ => {}
            }
        }
    }
    Ok(())
}

/// The manifest wire name of a field type (matches `FieldType`'s serde
/// serialization), for error messages and diagnostics.
fn field_type_name(field_type: &FieldType) -> &'static str {
    match field_type {
        FieldType::String => "String",
        FieldType::Enum { .. } => "Enum",
        FieldType::Boolean => "Boolean",
        FieldType::Integer => "Integer",
        FieldType::Real => "Real",
        FieldType::Vector { .. } => "Vector",
        FieldType::Json => "Json",
        FieldType::Structured { .. } => "Structured",
        FieldType::Principal => "Principal",
        FieldType::Id { .. } => "Id",
        FieldType::RelationIncarnation { .. } => "RelationIncarnation",
        FieldType::AssetRef { .. } => "AssetRef",
    }
}

fn create_or_update_table(tx: &Transaction<'_>, table: &TableManifest) -> SnapbackResult<()> {
    let mut columns = vec![
        "_id TEXT PRIMARY KEY".to_owned(),
        "_version INTEGER NOT NULL".to_owned(),
        "_createdAt INTEGER NOT NULL".to_owned(),
        "_updatedAt INTEGER NOT NULL".to_owned(),
    ];
    for field in &table.fields {
        columns.push(format!(
            "{} {}{}",
            quote_ident(&field.name)?,
            sqlite_type(&field.field_type),
            if field.optional { "" } else { " NOT NULL" }
        ));
    }
    if table
        .membership
        .as_ref()
        .is_some_and(|membership| membership.provenance.is_some())
    {
        columns.extend(
            MEMBERSHIP_PROVENANCE_COLUMNS
                .iter()
                .map(|column| format!("{} TEXT", quote_ident(column).expect("fixed identifier"))),
        );
    }

    tx.execute(
        &format!(
            "CREATE TABLE IF NOT EXISTS {} ({})",
            quote_ident(&table.name)?,
            columns.join(", ")
        ),
        [],
    )
    .map_err(map_unique_constraint_error)?;

    let existing = physical_columns(tx, &table.name)?;
    for column in existing.values() {
        if !is_system_field(&column.name) && table.field(&column.name).is_none() && column.not_null
        {
            return Err(SnapbackError::error(
                "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED",
                "schema",
                reviewed_migration_next_step(format!(
                    "table {} cannot omit preserved required field {}; its SQLite column is still NOT NULL",
                    table.name, column.name
                )),
            )
            .with_detail("table", table.name.clone())
            .with_detail("field", column.name.clone())
            .with_detail("requestedChange", "remove"));
        }
    }
    for field in &table.fields {
        match existing.get(&field.name) {
            None => {
                tx.execute(
                    &format!(
                        "ALTER TABLE {} ADD COLUMN {} {}{}",
                        quote_ident(&table.name)?,
                        quote_ident(&field.name)?,
                        sqlite_type(&field.field_type),
                        if field.optional { "" } else { " NOT NULL" }
                    ),
                    [],
                )?;
            }
            // @ref LLP 0003#database-model — the migrator is additive-only and
            // must reject type changes that would require rewriting existing
            // data. The physical column keeps its declared affinity forever,
            // so silently accepting a retyped manifest would hand back values
            // decoded under the old declaration while schema and generated
            // types promise the new one.
            Some(column) => {
                let declared = sqlite_type(&field.field_type);
                if !column.declared_type.eq_ignore_ascii_case(declared) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SCHEMA_FIELD_RETYPED",
                        "schema",
                        reviewed_migration_next_step(format!(
                            "field {}.{} cannot change storage type from {} to {}; \
                             retyping stored data is not supported — add a new field instead",
                            table.name, field.name, column.declared_type, declared
                        )),
                    )
                    .with_detail("table", table.name.clone())
                    .with_detail("field", field.name.clone())
                    .with_detail("existingType", column.declared_type.clone())
                    .with_detail("requestedType", declared));
                }
            }
        }
    }

    if table
        .membership
        .as_ref()
        .is_some_and(|membership| membership.provenance.is_some())
    {
        let existing = physical_columns(tx, &table.name)?;
        for column in MEMBERSHIP_PROVENANCE_COLUMNS {
            if !existing.contains_key(column) {
                tx.execute(
                    &format!(
                        "ALTER TABLE {} ADD COLUMN {} TEXT",
                        quote_ident(&table.name)?,
                        quote_ident(column)?
                    ),
                    [],
                )?;
            }
        }
        // Brownfield adoption is allowed: rows predating the declaration get
        // an explicit historical tag instead of blocking activation.
        tx.execute(
            &format!(
                "UPDATE {} SET {} = COALESCE({}, 'preexisting'), {} = COALESCE({}, 'preexisting')",
                quote_ident(&table.name)?,
                quote_ident(MEMBERSHIP_GRANTED_BY_ACTOR)?,
                quote_ident(MEMBERSHIP_GRANTED_BY_ACTOR)?,
                quote_ident(MEMBERSHIP_GRANTED_BY_EFFECTIVE)?,
                quote_ident(MEMBERSHIP_GRANTED_BY_EFFECTIVE)?,
            ),
            [],
        )?;
    }

    // Repair both a safe optional→required evolution and legacy databases
    // whose manifest already said "required" while the physical column was
    // nullable. Validation above proves every affected row is non-null; this
    // rebuild and the manifest write share the surrounding transaction.
    let columns = physical_columns(tx, &table.name)?;
    let required = table
        .fields
        .iter()
        .filter(|field| !field.optional)
        .map(|field| field.name.clone())
        .collect::<BTreeSet<_>>();
    if columns.values().any(|column| {
        required.contains(&column.name) && !column.not_null && column.primary_key == 0
    }) {
        rebuild_table_with_required_columns(tx, &table.name, &columns, &required)?;
    }

    ensure_managed_version_integrity_indexes(tx, &table.name)?;

    Ok(())
}

fn managed_version_integrity_index_names(table: &str) -> (String, String) {
    (
        format!("_snapback_version_domain_{table}"),
        format!("_snapback_version_head_{table}"),
    )
}

fn managed_version_domain_predicate_is_current(sql: Option<&str>) -> bool {
    sql.is_some_and(|sql| {
        sql.contains("typeof(_version) <> 'integer'")
            && sql.contains("_version <= 0")
            && sql.contains(&format!("_version > {PORTABLE_STORAGE_VERSION_MAX}"))
    })
}

fn managed_version_integrity_index_state(
    conn: &Connection,
    table: &str,
) -> SnapbackResult<(bool, bool)> {
    let (domain_name, head_name) = managed_version_integrity_index_names(table);
    let mut statement = conn.prepare_cached(
        "SELECT tbl_name, sql FROM sqlite_schema WHERE type = 'index' AND name = ?1",
    )?;
    let domain: Option<(String, Option<String>)> = statement
        .query_row(params![domain_name], |row| Ok((row.get(0)?, row.get(1)?)))
        .optional()?;
    let head: Option<(String, Option<String>)> = statement
        .query_row(params![head_name], |row| Ok((row.get(0)?, row.get(1)?)))
        .optional()?;
    Ok((
        domain.as_ref().is_some_and(|(owner, sql)| {
            owner == table && managed_version_domain_predicate_is_current(sql.as_deref())
        }),
        head.as_ref().is_some_and(|(owner, _)| owner == table),
    ))
}

fn drop_stray_managed_version_integrity_indexes(
    conn: &Connection,
    table: Option<&str>,
) -> SnapbackResult<()> {
    let mut statement = conn.prepare(
        "SELECT name, tbl_name
         FROM sqlite_schema
         WHERE type = 'index'
           AND (name GLOB '_snapback_version_domain_*'
                OR name GLOB '_snapback_version_head_*')",
    )?;
    let indexes = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    for (name, owner) in indexes {
        if table.is_some_and(|table| table != owner) {
            continue;
        }
        let (expected_domain, expected_head) = managed_version_integrity_index_names(&owner);
        let expected = if name.starts_with("_snapback_version_domain_") {
            expected_domain
        } else {
            expected_head
        };
        if name != expected {
            conn.execute(&format!("DROP INDEX {}", quote_ident(&name)?), [])?;
        }
    }
    Ok(())
}

// @ref LLP 0007#commit-version-graduation-dk-2-decided-2026-07-02 — managed
//   ordering facts need runtime-owned indexes whose physical definitions are
//   reconciled after every table rebuild or rename.
pub(super) fn ensure_managed_version_integrity_indexes(
    conn: &Connection,
    table: &str,
) -> SnapbackResult<()> {
    drop_stray_managed_version_integrity_indexes(conn, Some(table))?;
    let (domain_name, head_name) = managed_version_integrity_index_names(table);
    let (domain_current, head_current) = managed_version_integrity_index_state(conn, table)?;
    if !domain_current {
        conn.execute(
            &format!("DROP INDEX IF EXISTS {}", quote_ident(&domain_name)?),
            [],
        )?;
        conn.execute(
            &format!(
                "CREATE INDEX {} ON {}(_version) \
                 WHERE typeof(_version) <> 'integer' \
                    OR _version <= 0 \
                    OR _version > {PORTABLE_STORAGE_VERSION_MAX}",
                quote_ident(&domain_name)?,
                quote_ident(table)?,
            ),
            [],
        )?;
    }
    if !head_current {
        conn.execute(
            &format!("DROP INDEX IF EXISTS {}", quote_ident(&head_name)?),
            [],
        )?;
        conn.execute(
            &format!(
                "CREATE INDEX {} ON {}(_version)",
                quote_ident(&head_name)?,
                quote_ident(table)?,
            ),
            [],
        )?;
    }
    Ok(())
}

fn rebuild_table_with_required_columns(
    tx: &Transaction<'_>,
    table: &str,
    columns: &BTreeMap<String, PhysicalColumn>,
    required: &BTreeSet<String>,
) -> SnapbackResult<()> {
    for field in required {
        let null_count: i64 = tx.query_row(
            &format!(
                "SELECT COUNT(*) FROM {} WHERE {} IS NULL",
                quote_ident(table)?,
                quote_ident(field)?
            ),
            [],
            |row| row.get(0),
        )?;
        if null_count > 0 {
            return Err(SnapbackError::error(
                "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED",
                "schema",
                reviewed_migration_next_step(format!(
                    "field {table}.{field} cannot become physically required while {null_count} stored rows are null"
                )),
            )
            .with_detail("table", table.to_owned())
            .with_detail("field", field.clone())
            .with_detail("existingNullRows", null_count));
        }
    }

    let temporary = format!("_snapback_rebuild_{}_{}", table, Uuid::now_v7().simple());
    let definitions = columns
        .values()
        .map(|column| {
            let declared_type = safe_rebuild_column_type(column)?;
            let mut definition = format!("{} {}", quote_ident(&column.name)?, declared_type);
            if column.primary_key > 0 {
                definition.push_str(" PRIMARY KEY");
            } else if column.not_null || required.contains(&column.name) {
                definition.push_str(" NOT NULL");
            }
            Ok(definition)
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    let names = columns
        .values()
        .map(|column| quote_ident(&column.name))
        .collect::<SnapbackResult<Vec<_>>>()?;
    tx.execute(
        &format!(
            "CREATE TABLE {} ({})",
            quote_ident(&temporary)?,
            definitions.join(", ")
        ),
        [],
    )?;
    tx.execute(
        &format!(
            "INSERT INTO {} ({}) SELECT {} FROM {}",
            quote_ident(&temporary)?,
            names.join(", "),
            names.join(", "),
            quote_ident(table)?
        ),
        [],
    )?;
    tx.execute(&format!("DROP TABLE {}", quote_ident(table)?), [])?;
    tx.execute(
        &format!(
            "ALTER TABLE {} RENAME TO {}",
            quote_ident(&temporary)?,
            quote_ident(table)?
        ),
        [],
    )?;
    Ok(())
}

fn safe_rebuild_column_type(column: &PhysicalColumn) -> SnapbackResult<&'static str> {
    let canonical = match column.declared_type.trim().to_ascii_uppercase().as_str() {
        "TEXT" => "TEXT",
        "INTEGER" => "INTEGER",
        "REAL" => "REAL",
        _ => {
            return Err(SnapbackError::error(
                "SNAPBACK_SCHEMA_PHYSICAL_COLUMN_INVALID",
                "schema",
                format!(
                    "physical column {} has unsupported declaration {:?}",
                    column.name, column.declared_type
                ),
            ));
        }
    };
    if column.default_sql.is_some() {
        return Err(SnapbackError::error(
            "SNAPBACK_SCHEMA_PHYSICAL_COLUMN_INVALID",
            "schema",
            format!(
                "physical column {} has an unexpected default declaration",
                column.name
            ),
        ));
    }
    match column.name.as_str() {
        "_id" if canonical == "TEXT" && column.primary_key == 1 => {}
        "_version" | "_createdAt" | "_updatedAt"
            if canonical == "INTEGER" && column.primary_key == 0 && column.not_null => {}
        name if !is_system_field(name) && column.primary_key == 0 => {}
        _ => {
            return Err(SnapbackError::error(
                "SNAPBACK_SCHEMA_PHYSICAL_COLUMN_INVALID",
                "schema",
                format!(
                    "physical column {} has unexpected system/primary-key metadata",
                    column.name
                ),
            ));
        }
    }
    Ok(canonical)
}

/// The reserved logical name of the generated membership uniqueness index.
/// `validate_schema` reserves its physical name, so a user index cannot collide
/// with it.
pub(crate) const MEMBERSHIP_UNIQUE_INDEX_NAME: &str = "_membership_pk";
pub(crate) const MEMBERSHIP_REVERSE_INDEX_NAME: &str = "_membership_reverse";
pub(crate) const MEMBERSHIP_GRANTED_BY_ACTOR: &str = "grantedByActor";
pub(crate) const MEMBERSHIP_GRANTED_BY_EFFECTIVE: &str = "grantedByEffective";
pub(crate) const MEMBERSHIP_GRANTED_BY_GRANT: &str = "grantedByGrant";
const MEMBERSHIP_PROVENANCE_COLUMNS: [&str; 3] = [
    MEMBERSHIP_GRANTED_BY_ACTOR,
    MEMBERSHIP_GRANTED_BY_EFFECTIVE,
    MEMBERSHIP_GRANTED_BY_GRANT,
];

/// The generated true-unique index for a membership table: `(principal,
/// resource)` for a resource-scoped declaration, or `(principal)` for
/// `scope: "app"` (whose resource is a system-constant singleton, so a
/// principal holds at most one global role per declaration). `None` for a
/// non-membership table. The non-null key axes — enforced at the declaration —
/// are what keep this index total.
///
/// @ref LLP 0056#declaring-a-membership-table — one row per `(principal,
///   resource)`, delivered by a generated true-unique composite index.
pub(crate) fn membership_unique_index(table: &TableManifest) -> Option<(String, Vec<String>)> {
    let membership = table.membership.as_ref()?;
    let mut fields = vec![membership.principal.clone()];
    if let Some(resource) = &membership.resource {
        fields.push(resource.clone());
    }
    Some((MEMBERSHIP_UNIQUE_INDEX_NAME.to_owned(), fields))
}

/// The resource-leading lookup used by protected-holder checks and membership
/// invalidation. Resource scope gets `(resource, role, principal)`; app scope
/// drops the singleton resource and gets `(role, principal)`.
///
/// @ref LLP 0056#declaring-a-membership-table — generate the reverse covering
///   direction rather than scanning a principal-leading unique index while a
///   writer transaction is held.
pub(crate) fn membership_reverse_index(table: &TableManifest) -> Option<(String, Vec<String>)> {
    let membership = table.membership.as_ref()?;
    let mut fields = Vec::new();
    if let Some(resource) = &membership.resource {
        fields.push(resource.clone());
    }
    fields.push(membership.role.clone());
    fields.push(membership.principal.clone());
    Some((MEMBERSHIP_REVERSE_INDEX_NAME.to_owned(), fields))
}

/// Create or rebuild a declared index so the physical index always matches
/// the manifest.
///
/// SQLite index names are database-global and `CREATE INDEX IF NOT EXISTS`
/// matches on name alone, so a bare create has two silent no-op modes: the
/// physical name may already belong to a stale index (left on another table
/// by an earlier schema epoch), or the index may exist with an outdated
/// field list after the manifest changed. Either way the declared index
/// would never exist, while `validate_query_index` keeps accepting
/// `indexed_by` hints for it (it checks only the manifest). Compare the
/// existing definition from `sqlite_master`/`PRAGMA index_info` and drop and
/// recreate on any mismatch — index rebuilds are non-destructive.
///
/// @ref LLP 0003#database-model — the migrator keeps declared indexes in
/// sync with the manifest rather than treating name existence as done.
fn create_index(
    tx: &Transaction<'_>,
    table: &TableManifest,
    name: &str,
    fields: &[String],
    unique: bool,
    where_applicable: bool,
) -> SnapbackResult<()> {
    let mut columns = fields
        .iter()
        .map(|field| {
            ensure_field(table, field)?;
            quote_ident(field)
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    // A non-unique index appends `_id` so it is a covering, tie-broken key. A
    // **unique** index must not: `_id` is per-row unique, so including it would
    // make the whole key trivially unique and silently defeat the declared
    // uniqueness invariant (LLP 0056 relies on true `(principal, resource)`
    // uniqueness). This split is now the normative rule: every declared index
    // carries a framework-generated implicit trailing ascending `_id`
    // component that is scan-order only — the uniqueness constraint, the
    // complete-ordered-key semantics, and relational output keys stay over
    // the declared fields alone. Optional unique keys use the manifest-pinned
    // all-present predicate below; membership keys remain required and total.
    // @ref LLP 0007#index-contract — implicit trailing `_id` is scan-order
    //   only; unique constraints stay declared-fields-only.
    // @ref LLP 0080#1-closed-relational-plan — the suffix makes the `_id`
    //   tie-break index-servable without becoming author-indexable.
    // @ref LLP 0056#declaring-a-membership-table — membership pair uniqueness
    //   uses the same physical invariant.
    if !unique {
        columns.push(quote_ident("_id")?);
    }

    let where_predicate = if where_applicable {
        Some(
            fields
                .iter()
                .map(|field| Ok(format!("{} IS NOT NULL", quote_ident(field)?)))
                .collect::<SnapbackResult<Vec<_>>>()?
                .join(" AND "),
        )
    } else {
        None
    };
    let physical_name = format!("{}_{}", table.name, name);
    if let Some(existing) = physical_index(tx, &physical_name)? {
        let desired: Vec<String> = if unique {
            fields.to_vec()
        } else {
            fields.iter().cloned().chain(["_id".to_owned()]).collect()
        };
        if existing.table == table.name
            && existing.columns == desired
            && existing.unique == unique
            && existing.where_predicate == where_predicate
        {
            return Ok(());
        }
        tx.execute(&format!("DROP INDEX {}", quote_ident(&physical_name)?), [])?;
    }
    tx.execute(
        &format!(
            "CREATE {}INDEX {} ON {} ({}){}",
            if unique { "UNIQUE " } else { "" },
            quote_ident(&physical_name)?,
            quote_ident(&table.name)?,
            columns.join(", "),
            where_predicate
                .as_ref()
                .map(|predicate| format!(" WHERE {predicate}"))
                .unwrap_or_default()
        ),
        [],
    )
    .map_err(map_unique_constraint_error)?;
    Ok(())
}

/// A physical SQLite index's owning table and ordered column list, read from
/// `sqlite_master` and `PRAGMA index_info` so schema apply can compare it
/// against the manifest's declaration.
struct PhysicalIndex {
    table: String,
    columns: Vec<String>,
    unique: bool,
    where_predicate: Option<String>,
}

fn physical_index(tx: &Transaction<'_>, name: &str) -> SnapbackResult<Option<PhysicalIndex>> {
    let row = tx
        .query_row(
            "SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ?1",
            params![name],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()?;
    let Some((table, sql)) = row else {
        return Ok(None);
    };
    // Our declared indexes always carry `sql`; a NULL sql (an auto-index from a
    // UNIQUE table constraint) never matches a manifest declaration, so
    // treating it as non-unique forces the caller to rebuild — the same
    // conservative posture the column comparison already takes.
    let unique = sql
        .as_deref()
        .is_some_and(|sql| sql.to_ascii_uppercase().contains("CREATE UNIQUE INDEX"));
    let where_predicate = sql.as_deref().and_then(|sql| {
        let upper = sql.to_ascii_uppercase();
        upper
            .find(" WHERE ")
            .map(|offset| sql[offset + " WHERE ".len()..].trim().to_owned())
    });
    let mut statement = tx.prepare(&format!("PRAGMA index_info({})", quote_ident(name)?))?;
    let mut rows = statement.query([])?;
    let mut columns = Vec::new();
    while let Some(row) = rows.next()? {
        // The column name is NULL for rowid or expression members, which a
        // manifest index never declares; mapping those to "" can never match
        // a declared column, so the caller rebuilds the index.
        columns.push(row.get::<_, Option<String>>(2)?.unwrap_or_default());
    }
    Ok(Some(PhysicalIndex {
        table,
        columns,
        unique,
        where_predicate,
    }))
}

/// Existing physical column facts from `PRAGMA table_info`, used both for type
/// checks and for lossless required-field table rebuilds.
struct PhysicalColumn {
    name: String,
    declared_type: String,
    not_null: bool,
    default_sql: Option<String>,
    primary_key: i64,
}

fn physical_user_tables(conn: &Connection) -> SnapbackResult<Vec<String>> {
    let mut statement = conn.prepare(
        "SELECT name
         FROM sqlite_schema
         WHERE type = 'table'
           AND name NOT GLOB 'sqlite_*'
         ORDER BY name",
    )?;
    let tables = statement
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    Ok(tables
        .into_iter()
        .filter(|name| {
            let folded = name.to_ascii_lowercase();
            !folded.starts_with("_snapback") && !is_auth_reserved_identifier(name)
        })
        .collect())
}

fn physical_columns(
    tx: &Transaction<'_>,
    table: &str,
) -> SnapbackResult<BTreeMap<String, PhysicalColumn>> {
    let mut statement = tx.prepare(&format!("PRAGMA table_info({})", quote_ident(table)?))?;
    let mut rows = statement.query([])?;
    let mut columns = BTreeMap::new();
    while let Some(row) = rows.next()? {
        let column = PhysicalColumn {
            name: row.get(1)?,
            declared_type: row.get(2)?,
            not_null: row.get::<_, i64>(3)? != 0,
            default_sql: row.get(4)?,
            primary_key: row.get(5)?,
        };
        columns.insert(column.name.clone(), column);
    }
    Ok(columns)
}

/// Fail closed when a query declares `indexed_by` for an index the table's
/// schema does not define. The v0 SQLite target does not yet consult the hint
/// for planning, but silently accepting an unknown index name is a
/// silent-drop-class violation: the hint would be a no-op the author believes
/// is load-bearing. Validating it here makes the honest state explicit until
/// the hint is wired into planning (or removed).
///
/// @ref LLP 0032#phase-2--execution-semantics-honesty — E5: `indexed_by` is
/// validated rather than silently ignored.
fn validate_query_index(table: &TableManifest, plan: &QueryPlan) -> SnapbackResult<()> {
    let Some(index_name) = &plan.indexed_by else {
        return Ok(());
    };
    validate_user_identifier("index", index_name)?;
    if table.indexes.iter().any(|index| &index.name == index_name) {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_QUERY_UNKNOWN_INDEX",
        "storage",
        format!(
            "query declares index {index_name:?} which table {:?} does not define",
            table.name
        ),
    )
    .with_details(json!({
        "table": table.name,
        "requestedIndex": index_name,
        "knownIndexes": table.indexes.iter().map(|index| &index.name).collect::<Vec<_>>(),
    })))
}

#[allow(clippy::too_many_arguments)]
fn build_query_sql(
    table: &TableManifest,
    schema: &SchemaManifest,
    plan: &QueryPlan,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    direct_bindings: Option<&BTreeMap<String, Value>>,
    now_ms: u64,
    runtime_id: Option<&dyn Fn(&str) -> SnapbackResult<String>>,
    runtime_id_site: &str,
    sql_limit: Option<usize>,
    keyset: Option<&KeysetAfter>,
    force_id_order: bool,
    examined_entry_guard_function: Option<&str>,
) -> SnapbackResult<(String, Vec<SqlValue>)> {
    // Always give the primary table an explicit alias. A membership table may
    // itself be the query's primary table; without distinct aliases the inner
    // membership subquery shadows the outer physical name and turns the
    // resource correlation into `inner.resource = inner.resource`.
    // @ref LLP 0056#rule-helpers — membership predicates correlate against the
    //   actual outer row and remain non-recursive even for a same-table query.
    let outer_alias = quote_ident("__snapback_outer")?;
    let mut sql = format!(
        "SELECT {outer_alias}.* FROM {} AS {outer_alias}",
        quote_ident(&table.name)?
    );
    let mut values = Vec::new();
    // This non-deterministic guard deliberately leads the predicate list. It
    // counts every physical candidate before authored filters inspect it, and
    // is injected only for single-table node establishment/re-establishment.
    let mut where_parts = examined_entry_guard_function
        .map(|name| vec![format!("{name}() = 1")])
        .unwrap_or_default();
    let mut in_items = 0usize;
    let mut filter_bindings = 0usize;

    for (filter_index, filter) in plan.filters.iter().enumerate() {
        let filter_site = format!("{runtime_id_site}/filter/{filter_index}");
        ensure_field_or_system(table, &filter.field)?;
        match filter.op {
            FilterOp::Eq => {
                let field_type = field_type(table, &filter.field);
                for value in eval_authorization_decision_values(
                    &filter.value,
                    input,
                    bindings,
                    direct_bindings,
                    now_ms,
                    runtime_id,
                    &filter_site,
                )? {
                    if value.is_null()
                        && authorization_expr_depends_on_projection(
                            &filter.value,
                            input,
                            bindings,
                            direct_bindings,
                        )
                    {
                        where_parts.push("1 = 0".to_owned());
                        continue;
                    }
                    validate_query_filter_value(table, &filter.field, &value)?;
                    add_query_filter_bindings(&mut filter_bindings, 1, &filter.field)?;
                    values.push(json_to_sql_value(&value, field_type)?);
                    where_parts.push(format!("{} = ?", quote_ident(&filter.field)?));
                }
            }
            FilterOp::In => {
                let field_type = field_type(table, &filter.field);
                for value in eval_authorization_decision_values(
                    &filter.value,
                    input,
                    bindings,
                    direct_bindings,
                    now_ms,
                    runtime_id,
                    &filter_site,
                )? {
                    if value.is_null()
                        && authorization_expr_depends_on_projection(
                            &filter.value,
                            input,
                            bindings,
                            direct_bindings,
                        )
                    {
                        where_parts.push("1 = 0".to_owned());
                        continue;
                    }
                    let Some(items) = value.as_array() else {
                        return Err(SnapbackError::error(
                            "SNAPBACK_QUERY_FILTER_VALUE_INVALID",
                            "query",
                            format!(
                                "query filter {}.{} In expects an array",
                                table.name, filter.field
                            ),
                        )
                        .with_detail("field", Value::String(filter.field.clone()))
                        .with_detail("op", Value::String("In".to_owned()))
                        .with_detail("value", value));
                    };
                    in_items = in_items.saturating_add(items.len());
                    if in_items > QUERY_MAX_IN_ITEMS {
                        return Err(SnapbackError::error(
                            "SNAPBACK_QUERY_IN_ITEMS_EXCEEDED",
                            "query",
                            format!(
                                "query In operands contain {in_items} total items; maxInItems is {QUERY_MAX_IN_ITEMS}"
                            ),
                        )
                        .with_detail("maxInItems", QUERY_MAX_IN_ITEMS as u64));
                    }
                    if matches!(
                        field_type,
                        Some(FieldType::Json | FieldType::Structured { .. })
                    ) {
                        validate_query_filter_value(table, &filter.field, &Value::Null)?;
                    }
                    add_query_filter_bindings(&mut filter_bindings, items.len(), &filter.field)?;
                    if items.is_empty() {
                        where_parts.push("1 = 0".to_owned());
                    } else {
                        for item in items {
                            validate_query_filter_value(table, &filter.field, item)?;
                            values.push(json_to_sql_value(item, field_type)?);
                        }
                        let placeholders =
                            (0..items.len()).map(|_| "?").collect::<Vec<_>>().join(", ");
                        where_parts.push(format!(
                            "{} IN ({placeholders})",
                            quote_ident(&filter.field)?
                        ));
                    }
                }
            }
            FilterOp::Lt | FilterOp::Lte | FilterOp::Gt | FilterOp::Gte => {
                let field_type = field_type(table, &filter.field);
                let op = match filter.op {
                    FilterOp::Lt => "<",
                    FilterOp::Lte => "<=",
                    FilterOp::Gt => ">",
                    FilterOp::Gte => ">=",
                    FilterOp::Eq | FilterOp::In => unreachable!("handled above"),
                };
                for value in eval_authorization_decision_values(
                    &filter.value,
                    input,
                    bindings,
                    direct_bindings,
                    now_ms,
                    runtime_id,
                    &filter_site,
                )? {
                    if value.is_null()
                        && authorization_expr_depends_on_projection(
                            &filter.value,
                            input,
                            bindings,
                            direct_bindings,
                        )
                    {
                        where_parts.push("1 = 0".to_owned());
                        continue;
                    }
                    validate_query_filter_value(table, &filter.field, &value)?;
                    add_query_filter_bindings(&mut filter_bindings, 1, &filter.field)?;
                    values.push(json_to_sql_value(&value, field_type)?);
                    where_parts.push(format!("{} {op} ?", quote_ident(&filter.field)?));
                }
            }
        }
    }

    if let Some(visibility) = &plan.table_visibility {
        let (clause, extra) = build_table_visibility_sql(
            schema,
            table,
            visibility,
            input,
            bindings,
            now_ms,
            runtime_id,
            &format!("{runtime_id_site}/table-visibility"),
            &mut filter_bindings,
        )?;
        where_parts.push(clause);
        values.extend(extra);
    }

    // LLP 0056 M3: lower each declaration-bound membership semi-join to a
    // correlated `EXISTS` over the membership table. Non-recursive by design —
    // SQL applies no row-visibility rules, so a locked-down roster cannot break
    // role evaluation for guests. A row-field resource ref correlates against
    // the outer row; a query-argument ref binds a fixed value.
    // @ref LLP 0056#rule-helpers — the declaration-bound membership predicate.
    for (predicate_index, predicate) in plan.membership_filters.iter().enumerate() {
        let (clause, extra) = build_membership_exists_sql(
            schema,
            table,
            predicate,
            input,
            bindings,
            now_ms,
            runtime_id,
            &format!("{runtime_id_site}/membership/{predicate_index}"),
            &mut filter_bindings,
        )?;
        where_parts.push(clause);
        values.extend(extra);
    }

    if let Some(keyset) = keyset {
        let (clause, keyset_values) =
            build_keyset_after_sql(table, &plan.order, keyset, &mut filter_bindings)?;
        where_parts.push(clause);
        values.extend(keyset_values);
    }

    if !where_parts.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&where_parts.join(" AND "));
    }

    // `force_id_order` (the relational root window) keeps the total order —
    // and therefore its keyset continuation — deterministic even when the
    // plan declares no order fields: `_id ASC` alone is still a total order.
    if !plan.order.is_empty() || force_id_order || keyset.is_some() {
        let mut order_parts = Vec::new();
        for order in &plan.order {
            ensure_orderable_field(table, &order.field)?;
            let direction = match order.direction {
                OrderDirection::Asc => "ASC",
                OrderDirection::Desc => "DESC",
            };
            // Snapback owns ordering semantics: NULL is last in both
            // directions, and `_id` is the final stable tie-break. Do not
            // inherit SQLite's ASC NULL-first default (LLP 0007 §Queries).
            order_parts.push(format!(
                "{} {direction} NULLS LAST",
                quote_ident(&order.field)?
            ));
        }
        order_parts.push("\"_id\" ASC".to_owned());
        sql.push_str(" ORDER BY ");
        sql.push_str(&order_parts.join(", "));
    }

    if let Some(limit) = sql_limit {
        sql.push_str(" LIMIT ");
        sql.push_str(&limit.to_string());
    }

    Ok((sql, values))
}

#[allow(clippy::too_many_arguments)]
fn build_table_visibility_sql(
    schema: &SchemaManifest,
    outer: &TableManifest,
    visibility: &crate::manifest::TableVisibilityV1,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    now_ms: u64,
    runtime_id: Option<&dyn Fn(&str) -> SnapbackResult<String>>,
    runtime_id_site: &str,
    filter_bindings: &mut usize,
) -> SnapbackResult<(String, Vec<SqlValue>)> {
    use crate::manifest::{MembershipPredicate, MembershipResourceRef, TableVisibilityArmV1};

    let owner_clause =
        |field: &str, filter_bindings: &mut usize| -> SnapbackResult<(String, Vec<SqlValue>)> {
            ensure_field_or_system(outer, field)?;
            let Some(user_id) = input.auth.user_id.as_deref() else {
                return Ok(("(0 = 1)".to_owned(), Vec::new()));
            };
            add_query_filter_bindings(filter_bindings, 1, field)?;
            Ok((
                format!(
                    "{}.{} = ?",
                    quote_ident("__snapback_outer")?,
                    quote_ident(field)?
                ),
                vec![json_to_sql_value(
                    &Value::String(user_id.to_owned()),
                    field_type(outer, field),
                )?],
            ))
        };
    let membership_clause = |declaration: &str,
                             resource_field: &str,
                             roles: &Option<Vec<String>>,
                             filter_bindings: &mut usize,
                             site: &str|
     -> SnapbackResult<(String, Vec<SqlValue>)> {
        let predicate = MembershipPredicate {
            declaration: declaration.to_owned(),
            resource: MembershipResourceRef::RowField(resource_field.to_owned()),
            roles: roles.clone(),
        };
        build_membership_exists_sql(
            schema,
            outer,
            &predicate,
            input,
            bindings,
            now_ms,
            runtime_id,
            site,
            filter_bindings,
        )
    };

    match visibility {
        crate::manifest::TableVisibilityV1::PublicRead => Err(SnapbackError::error(
            "SNAPBACK_TABLE_VISIBILITY_PLAN_MISMATCH",
            "auth",
            "a public-read table policy must be omitted from an executable query plan",
        )),
        crate::manifest::TableVisibilityV1::Owner { field } => {
            let (clause, values) = owner_clause(field, filter_bindings)?;
            Ok((format!("({clause})"), values))
        }
        crate::manifest::TableVisibilityV1::Membership {
            declaration,
            resource_field,
            roles,
        } => {
            let (clause, values) = membership_clause(
                declaration,
                resource_field,
                roles,
                filter_bindings,
                &format!("{runtime_id_site}/membership"),
            )?;
            Ok((format!("({clause})"), values))
        }
        crate::manifest::TableVisibilityV1::AnyOf { arms } => {
            let mut clauses = Vec::with_capacity(arms.len());
            let mut values = Vec::new();
            for (index, arm) in arms.iter().enumerate() {
                let (clause, extra) = match arm {
                    TableVisibilityArmV1::Owner { field } => owner_clause(field, filter_bindings)?,
                    TableVisibilityArmV1::Membership {
                        declaration,
                        resource_field,
                        roles,
                    } => membership_clause(
                        declaration,
                        resource_field,
                        roles,
                        filter_bindings,
                        &format!("{runtime_id_site}/membership/{index}"),
                    )?,
                };
                clauses.push(format!("({clause})"));
                values.extend(extra);
            }
            Ok((format!("({})", clauses.join(" OR ")), values))
        }
    }
}

/// Lower one declaration-bound membership semi-join to a correlated `EXISTS`
/// subquery over the membership table (LLP 0056 M3). Returns the WHERE clause
/// and its bound parameters (in SQL order). Fail-closed: an unresolved
/// declaration errors, and an absent effective principal matches no rows.
#[allow(clippy::too_many_arguments)]
fn build_membership_exists_sql(
    schema: &SchemaManifest,
    outer: &TableManifest,
    predicate: &crate::manifest::MembershipPredicate,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    now_ms: u64,
    runtime_id: Option<&dyn Fn(&str) -> SnapbackResult<String>>,
    runtime_id_site: &str,
    filter_bindings: &mut usize,
) -> SnapbackResult<(String, Vec<SqlValue>)> {
    let Some((mtable, membership)) =
        crate::membership_rules::find_declaration(schema, &predicate.declaration)
    else {
        return Err(SnapbackError::error(
            "SNAPBACK_MEMBERSHIP_UNKNOWN_DECLARATION",
            "query",
            format!(
                "membership predicate names declaration {:?}, which is not declared",
                predicate.declaration
            ),
        ));
    };
    // No effective principal → the predicate matches no rows (fail-closed).
    let Some(user_id) = input.auth.user_id.as_deref() else {
        return Ok(("(0 = 1)".to_owned(), Vec::new()));
    };

    let mtable_ident = quote_ident(&mtable.name)?;
    let membership_alias = quote_ident("__snapback_membership")?;
    let principal_ident = quote_ident(&membership.principal)?;
    let role_ident = quote_ident(&membership.role)?;
    let mut params: Vec<SqlValue> = Vec::new();
    let mut conds: Vec<String> = Vec::new();

    // principal = the effective principal.
    add_query_filter_bindings(filter_bindings, 1, &membership.principal)?;
    params.push(json_to_sql_value(
        &Value::String(user_id.to_owned()),
        Some(&FieldType::Principal),
    )?);
    conds.push(format!("{membership_alias}.{principal_ident} = ?"));

    // resource axis (absent for scope: "app").
    if let Some(resource_field) = &membership.resource {
        let resource_ident = quote_ident(resource_field)?;
        match &predicate.resource {
            crate::manifest::MembershipResourceRef::RowField(field) => {
                ensure_field_or_system(outer, field)?;
                conds.push(format!(
                    "{membership_alias}.{resource_ident} = {}.{}",
                    quote_ident("__snapback_outer")?,
                    quote_ident(field)?
                ));
            }
            crate::manifest::MembershipResourceRef::Arg { path, .. } => {
                let value = eval_expr(
                    &ValueExpr::Arg(path.clone()),
                    input,
                    bindings,
                    now_ms,
                    runtime_id,
                    runtime_id_site,
                )?;
                add_query_filter_bindings(filter_bindings, 1, resource_field)?;
                params.push(json_to_sql_value(
                    &value,
                    field_type(mtable, resource_field),
                )?);
                conds.push(format!("{membership_alias}.{resource_ident} = ?"));
            }
        }
    }

    // role IN (...) over the effective roles.
    let roles = crate::membership_rules::effective_roles(membership, predicate.roles.as_deref());
    if roles.is_empty() {
        return Ok(("(0 = 1)".to_owned(), Vec::new()));
    }
    add_query_filter_bindings(filter_bindings, roles.len(), &membership.role)?;
    let mut placeholders = Vec::with_capacity(roles.len());
    for role in &roles {
        params.push(json_to_sql_value(
            &Value::String(role.clone()),
            Some(&FieldType::String),
        )?);
        placeholders.push("?");
    }
    conds.push(format!(
        "{membership_alias}.{role_ident} IN ({})",
        placeholders.join(", ")
    ));

    let clause = format!(
        "EXISTS (SELECT 1 FROM {mtable_ident} AS {membership_alias} WHERE {})",
        conds.join(" AND ")
    );
    Ok((clause, params))
}

fn add_query_filter_bindings(
    total: &mut usize,
    additional: usize,
    field_name: &str,
) -> SnapbackResult<()> {
    *total = total.saturating_add(additional);
    if *total > QUERY_MAX_FILTER_BINDINGS {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED",
            "query",
            format!(
                "query filters bind {} values after {field_name}; maxFilterBindings is {QUERY_MAX_FILTER_BINDINGS}",
                *total
            ),
        )
        .with_detail("maxFilterBindings", QUERY_MAX_FILTER_BINDINGS as u64));
    }
    Ok(())
}

fn validate_query_filter_value(
    table: &TableManifest,
    field_name: &str,
    value: &Value,
) -> SnapbackResult<()> {
    if let Some(field) = table.field(field_name) {
        if matches!(
            field.field_type,
            FieldType::Json | FieldType::Structured { .. }
        ) {
            return Err(SnapbackError::error(
                "SNAPBACK_QUERY_FILTER_UNSUPPORTED_FIELD_TYPE",
                "query",
                format!(
                    "query filter {}.{} has opaque Json/Structured type",
                    table.name, field_name
                ),
            )
            .with_detail("table", table.name.clone())
            .with_detail("field", field_name.to_owned())
            .with_detail("fieldType", field_type_name(&field.field_type)));
        }
        let compatible = if value.is_null() {
            field.optional
        } else {
            match field.field_type {
                FieldType::String
                | FieldType::Enum { .. }
                | FieldType::Principal
                | FieldType::Id { .. }
                | FieldType::RelationIncarnation { .. }
                | FieldType::AssetRef { .. } => value.is_string(),
                FieldType::Boolean => value.is_boolean(),
                FieldType::Integer => portable_integer_value(value).is_some(),
                FieldType::Real => value.as_f64().is_some(),
                FieldType::Vector { .. } => false,
                FieldType::Json | FieldType::Structured { .. } => {
                    unreachable!("opaque filters returned above")
                }
            }
        };
        if compatible {
            return Ok(());
        }
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_FILTER_VALUE_INVALID",
            "query",
            format!(
                "query filter {}.{} has a value incompatible with its declared type",
                table.name, field_name
            ),
        )
        .with_detail("table", table.name.clone())
        .with_detail("field", field_name.to_owned())
        .with_detail("fieldType", format!("{:?}", field.field_type)));
    }

    let compatible = match field_name {
        "_id" => value.is_string(),
        "_version" | "_createdAt" | "_updatedAt" => {
            portable_integer_value(value).is_some_and(|value| value >= 0)
        }
        _ => false,
    };
    if compatible {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_QUERY_FILTER_VALUE_INVALID",
        "query",
        format!(
            "query filter {}.{} has a value incompatible with its system-field type",
            table.name, field_name
        ),
    )
    .with_detail("table", table.name.clone())
    .with_detail("field", field_name.to_owned()))
}

fn validate_read_set(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    read_set: &[ReadDependency],
    maximum: u64,
) -> SnapbackResult<()> {
    // @ref LLP 0081#4-execution-journaling-and-crash-recovery — no
    //   pre-publication baseline replays through the raised retention
    //   floor. The load-bearing case is a baseline that is BOTH pre-floor
    //   AND no longer current: the change journal below the floor is gone,
    //   so the client cannot rebase incrementally and must resync whole. A
    //   baseline that still equals the row's current version passes under
    //   every posture — an unchanged row's pre-publication capture is
    //   byte-identical to (and exactly as safe as) a fresh post-resync
    //   capture, and refusing it would also refuse every compatible
    //   client's post-resnapshot replay of untouched rows, forever.
    //   Compatible postures keep the ordinary conflict rules throughout.
    for dependency in read_set {
        let table = schema_table(schema, &dependency.table)?;
        let current = get_row_version(tx, table, &dependency.id, maximum)?;
        if current == Some(dependency.version) {
            continue;
        }
        // First mismatch decides the outcome (both arms below return), so
        // the transition lookup runs at most once per validation.
        let successor_only_floor = schema_transition_events_on(tx, 0)?
            .into_iter()
            .last()
            .filter(|transition| {
                matches!(
                    transition.body.compatibility_posture,
                    crate::migration::CompatibilityPosture::SuccessorOnly
                )
            })
            .map(|transition| transition.body.retention_floor);
        if let Some(floor) = successor_only_floor
            && dependency.version < floor
        {
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_RESYNC_REQUIRED",
                "storage",
                "this mutation's read baseline predates a successor-only schema publication \
                 and its row has since changed; resync before replaying client-custodied \
                 offline work",
            ));
        }
        {
            return Err(SnapbackError::error(
                "SNAPBACK_MUTATION_CONFLICT",
                "storage",
                "mutation read set changed before commit",
            )
            .with_detail(
                "dependency",
                json!({
                    "table": dependency.table,
                    "id": dependency.id,
                    "expected": dependency.version,
                    "actual": current,
                }),
            ));
        }
    }
    Ok(())
}

/// Asset admission witnesses are LLP 0007 captured read sets, and
/// finalization re-validates them inside its publication transaction (LLP
/// 0044 §Internal model) — same machinery, same conflict semantics, so
/// witness movement surfaces as the ordinary `SNAPBACK_MUTATION_CONFLICT`
/// the finalizer catches to trigger re-validation.
pub(crate) fn validate_asset_witness(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    input: &HandlerInput,
    witness: &[CapturedReadDependency],
) -> SnapbackResult<()> {
    let current_version = current_version_on(tx)?;
    validate_captured_read_set(tx, schema, input, witness, current_version)
}

fn validate_captured_read_set(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    input: &HandlerInput,
    read_set: &[CapturedReadDependency],
    maximum: u64,
) -> SnapbackResult<()> {
    for dependency in read_set {
        match dependency.kind {
            CapturedReadKind::Row => {
                let table_name = dependency_table(dependency)?;
                let id = dependency_id(dependency)?;
                let expected = dependency.version.ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_CAPTURED_READ_INVALID",
                        "storage",
                        "captured row dependency is missing a version",
                    )
                })?;
                let table = schema_table(schema, table_name)?;
                let current = get_row_version(tx, table, id, maximum)?;
                if current != Some(expected) {
                    return Err(captured_conflict(
                        "captured row read changed before commit",
                        dependency,
                        json!({
                            "kind": "row",
                            "table": table_name,
                            "id": id,
                            "expected": expected,
                            "actual": current,
                        }),
                        read_set,
                    ));
                }
            }
            CapturedReadKind::MissingRow => {
                let table_name = dependency_table(dependency)?;
                let id = dependency_id(dependency)?;
                let table = schema_table(schema, table_name)?;
                let current = get_row_version(tx, table, id, maximum)?;
                // @ref LLP 0032#phase-2--execution-semantics-honesty — E4: a
                // "row X was absent" read is invalidated only if X is present
                // now — a current-state check, not a whole-table version bump.
                // A disjoint write that inserts a *different* row no longer
                // conflicts.
                if current.is_some() {
                    return Err(captured_conflict(
                        "captured missing-row read changed before commit",
                        dependency,
                        json!({
                            "kind": "missingRow",
                            "table": table_name,
                            "id": id,
                            "expected": dependency.version,
                            "actual": current,
                        }),
                        read_set,
                    ));
                }
            }
            CapturedReadKind::Query => {
                let table_name = dependency_table(dependency)?;
                let expected = dependency.version.ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_CAPTURED_READ_INVALID",
                        "storage",
                        "captured query dependency is missing a table version",
                    )
                })?;
                schema_table(schema, table_name)?;
                let current = table_change_version_from_tx(tx, table_name, maximum)?;
                if current <= expected {
                    // Fast path: this table has not changed after the sampled
                    // global snapshot. A cold table's preserved high-water can
                    // legitimately precede the global query cursor.
                    continue;
                }
                // @ref LLP 0032#phase-2--execution-semantics-honesty — E4:
                // the table changed, but only conflict if a change since the
                // read actually affects *this query's* result — reuse the live
                // matcher's predicate so a disjoint-row write (one that does not
                // match the query) no longer conflicts every mutation. If the
                // captured version is below the retention floor the intervening
                // changes were pruned and we cannot tell, so conflict
                // conservatively.
                let floor = retention_floor_at_most(tx, maximum)?;
                let affected = if expected.saturating_add(1) < floor {
                    true
                } else {
                    changes_to_table_since(tx, table_name, expected, maximum)?
                        .iter()
                        .any(|change| {
                            crate::live_matcher::query_dependency_change_may_affect(
                                input, dependency, change,
                            )
                        })
                };
                if affected {
                    return Err(captured_conflict(
                        "captured query read changed before commit",
                        dependency,
                        json!({
                            "kind": "query",
                            "table": table_name,
                            "expected": expected,
                            "actual": current,
                            "predicate": dependency.predicate,
                            "rows": dependency.rows,
                        }),
                        read_set,
                    ));
                }
            }
            CapturedReadKind::Auth => {}
            CapturedReadKind::Permission if is_media_projection_dependency(dependency) => {
                // @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
                // — system asset/rendition facts observed while projecting a
                // handler read participate in the ordinary OCC gate. The
                // digest is private dependency identity; movement collapses
                // to the same reject-only mutation conflict as app rows.
                let asset_id = dependency_id(dependency)?;
                let expected = dependency.value.as_ref().and_then(Value::as_str);
                let current = media_projection_fact_digest_on(tx, asset_id).ok();
                if expected.is_none() || current.as_deref() != expected {
                    return Err(captured_conflict(
                        "captured media projection facts changed before commit",
                        dependency,
                        json!({
                            "kind": "mediaProjection",
                            "assetId": asset_id,
                            "moved": true,
                        }),
                        read_set,
                    ));
                }
            }
            CapturedReadKind::Permission => {}
        }
    }
    Ok(())
}

fn dependency_table(dependency: &CapturedReadDependency) -> SnapbackResult<&str> {
    dependency.table.as_deref().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_CAPTURED_READ_INVALID",
            "storage",
            "captured dependency is missing a table",
        )
    })
}

fn dependency_id(dependency: &CapturedReadDependency) -> SnapbackResult<&str> {
    dependency.id.as_deref().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_CAPTURED_READ_INVALID",
            "storage",
            "captured dependency is missing a row id",
        )
    })
}

/// Keep the private asset-fact dependency on its dedicated direct accessor;
/// it is not an application table touch and must never enter `schema_table`.
/// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
fn is_media_projection_dependency(dependency: &CapturedReadDependency) -> bool {
    dependency.kind == CapturedReadKind::Permission
        && dependency.table.as_deref() == Some(crate::assets::ASSET_RECORDS_TABLE)
        && dependency.field.as_deref() == Some(MEDIA_PROJECTION_DEPENDENCY_FIELD_V1)
}

fn captured_conflict(
    message: &str,
    dependency: &CapturedReadDependency,
    details: Value,
    read_set: &[CapturedReadDependency],
) -> SnapbackError {
    SnapbackError::error("SNAPBACK_MUTATION_CONFLICT", "storage", message)
        .with_detail("dependency", details)
        .with_detail("capturedDependency", json!(dependency))
        .with_detail("capturedReads", json!(read_set))
        .with_detail("retryPolicy", "reject")
}

fn get_row_version(
    tx: &Transaction<'_>,
    table: &TableManifest,
    id: &str,
    maximum: u64,
) -> SnapbackResult<Option<u64>> {
    let mut statement = tx.prepare_cached(&format!(
        "SELECT _version FROM {} WHERE _id = ?1",
        quote_ident(&table.name)?
    ))?;
    let version: Option<SqlValue> = statement
        .query_row(params![id], |row| row.get(0))
        .optional()?;
    version
        .map(|version| {
            let version = decode_required_committed_version(version, "row storage version")?;
            validate_storage_version_at_most(version, maximum, "row storage version")?;
            Ok(version)
        })
        .transpose()
}

fn query_uses_row_version_for_selection(plan: &QueryPlan) -> bool {
    plan.filters.iter().any(|filter| filter.field == "_version")
        || plan.order.iter().any(|order| order.field == "_version")
        || plan.membership_filters.iter().any(|predicate| {
            matches!(
                &predicate.resource,
                crate::manifest::MembershipResourceRef::RowField(field) if field == "_version"
            )
        })
}

/// A decoder only sees rows that survive SQL selection. When `_version`
/// itself is a predicate, join, or ordering operand, preflight the table so a
/// corrupt value cannot influence selection and then disappear before decode.
pub(super) fn validate_managed_row_versions(
    conn: &Connection,
    table: &TableManifest,
    maximum: u64,
) -> SnapbackResult<()> {
    validate_managed_table_versions_by_name(conn, &table.name, maximum)
}

pub(super) fn validate_managed_table_versions_by_name(
    conn: &Connection,
    table_name: &str,
    maximum: u64,
) -> SnapbackResult<()> {
    // @ref LLP 0007#commit-version-graduation-dk-2-decided-2026-07-02 — every
    //   persisted row version fails closed, with indexed absence proofs used
    //   only when both runtime-owned indexes are current.
    let (domain_current, head_current) = managed_version_integrity_index_state(conn, table_name)?;
    let invalid = if domain_current && head_current {
        let (domain_name, head_name) = managed_version_integrity_index_names(table_name);
        let domain_predicate = format!(
            "typeof(_version) <> 'integer' OR _version <= 0 OR _version > {PORTABLE_STORAGE_VERSION_MAX}"
        );
        let domain_sql = format!(
            "SELECT _version FROM {} INDEXED BY {} \
             WHERE {domain_predicate} LIMIT 1",
            quote_ident(table_name)?,
            quote_ident(&domain_name)?,
        );
        let mut domain_statement = conn.prepare_cached(&domain_sql)?;
        let domain_invalid: Option<SqlValue> = domain_statement
            .query_row([], |row| row.get(0))
            .optional()?;
        if domain_invalid.is_some() {
            true
        } else {
            let head_sql = format!(
                "SELECT _version FROM {} INDEXED BY {} \
                 WHERE _version > ?1 LIMIT 1",
                quote_ident(table_name)?,
                quote_ident(&head_name)?,
            );
            let mut head_statement = conn.prepare_cached(&head_sql)?;
            let head_invalid: Option<SqlValue> = head_statement
                .query_row(params![version_to_sql_integer(maximum)?], |row| row.get(0))
                .optional()?;
            head_invalid.is_some()
        }
    } else {
        let sql = format!(
            "SELECT 1 FROM {} \
             WHERE typeof(_version) <> 'integer' \
                OR _version <= 0 \
                OR _version > ?1 \
             LIMIT 1",
            quote_ident(table_name)?
        );
        let mut statement = conn.prepare_cached(&sql)?;
        let invalid: Option<i64> = statement
            .query_row(params![version_to_sql_integer(maximum)?], |row| row.get(0))
            .optional()?;
        invalid.is_some()
    };
    if invalid {
        return Err(SnapbackError::error(
            "SNAPBACK_STORAGE_VERSION_CORRUPT",
            "storage",
            format!(
                "managed table {} contains a non-portable row storage version",
                table_name
            ),
        )
        .with_detail("table", table_name.to_owned()));
    }
    Ok(())
}

fn validate_touched_managed_tables(
    conn: &Connection,
    schema: &SchemaManifest,
    touched: &BTreeSet<String>,
    maximum: u64,
) -> SnapbackResult<()> {
    let mut expanded = touched.clone();
    let touches_protected_relation = schema.tables.iter().any(|table| {
        table.membership.as_ref().is_some_and(|membership| {
            membership.last_holder.is_some()
                && (touched.contains(&table.name)
                    || membership
                        .resource_table
                        .as_ref()
                        .is_some_and(|resource| touched.contains(resource)))
        })
    });
    // Membership/resource guards consult both halves of the declared
    // relation. Include the counterpart even when the direct write/read only
    // names one table, so those guard reads cannot be driven by a forged
    // future row.
    for table in &schema.tables {
        let Some(membership) = &table.membership else {
            continue;
        };
        if (touches_protected_relation && membership.last_holder.is_some())
            || expanded.contains(&table.name)
            || membership
                .resource_table
                .as_ref()
                .is_some_and(|resource| expanded.contains(resource))
        {
            expanded.insert(table.name.clone());
            if let Some(resource) = &membership.resource_table {
                expanded.insert(resource.clone());
            }
        }
    }
    for table in expanded {
        let table = schema_table(schema, &table)?;
        validate_managed_row_versions(conn, table, maximum)?;
    }
    Ok(())
}

/// Reject every malformed/out-of-domain journal row, not only the current
/// MAX. `_snapback_changes_invalid_committed_version` is a partial index over precisely
/// this predicate, so the healthy fast path performs an empty index probe.
fn ensure_change_journal_versions_valid(
    conn: &Connection,
    table: Option<&str>,
) -> SnapbackResult<()> {
    let invalid_predicate = format!(
        "typeof(version) <> 'integer' OR version <= 0 OR version > {PORTABLE_STORAGE_VERSION_MAX}"
    );
    let (sql, value) = if let Some(table) = table {
        (
            format!(
                "SELECT version FROM _snapback_changes \
                 INDEXED BY _snapback_changes_invalid_committed_version \
                 WHERE table_name = ?1 AND ({invalid_predicate}) LIMIT 1"
            ),
            Some(table),
        )
    } else {
        (
            format!(
                "SELECT version FROM _snapback_changes \
                 INDEXED BY _snapback_changes_invalid_committed_version \
                 WHERE {invalid_predicate} LIMIT 1"
            ),
            None,
        )
    };
    let invalid: Option<SqlValue> = match value {
        Some(table) => conn
            .query_row(&sql, params![table], |row| row.get(0))
            .optional()?,
        None => conn.query_row(&sql, [], |row| row.get(0)).optional()?,
    };
    if invalid.is_some() {
        let mut error = SnapbackError::error(
            "SNAPBACK_STORAGE_VERSION_CORRUPT",
            "storage",
            "change journal contains a non-portable storage version",
        );
        if let Some(table) = table {
            error = error.with_detail("table", table.to_owned());
        }
        return Err(error);
    }
    Ok(())
}

fn table_change_version_from_connection(conn: &Connection, table: &str) -> SnapbackResult<u64> {
    with_pinned_read_snapshot(conn, |conn| {
        table_change_version_at_most(
            conn,
            table,
            current_version_on(conn)?,
            "table change version",
        )
    })
}

fn table_change_version_at_most(
    conn: &Connection,
    table: &str,
    maximum: u64,
    context: &str,
) -> SnapbackResult<u64> {
    ensure_change_journal_versions_valid(conn, Some(table))?;
    let version: SqlValue = conn.query_row(
        "SELECT MAX(version) FROM _snapback_changes WHERE table_name = ?1",
        params![table],
        |row| row.get(0),
    )?;
    let version = decode_optional_storage_version(version, context)?.unwrap_or(0);
    validate_storage_version_at_most(version, maximum, context)?;
    Ok(version)
}

fn table_change_version_from_tx(
    tx: &Transaction<'_>,
    table: &str,
    maximum: u64,
) -> SnapbackResult<u64> {
    table_change_version_at_most(tx, table, maximum, "transactional table change version")
}

/// The changes to `table` committed after `version`, reconstructed as
/// `ChangedRow`s. `changed_fields` is not journaled, so it is left empty (the
/// matcher treats an update with unknown changed fields conservatively).
///
/// @ref LLP 0032#phase-2--execution-semantics-honesty — E4: predicate-granularity validation.
fn changes_to_table_since(
    tx: &Transaction<'_>,
    table: &str,
    version: u64,
    maximum: u64,
) -> SnapbackResult<Vec<ChangedRow>> {
    let mut statement = tx.prepare_cached(
        "SELECT version, row_id, op, row_json FROM _snapback_changes \
         WHERE table_name = ?1 AND version > ?2 ORDER BY version, id",
    )?;
    let version = version_to_sql_integer(version)?;
    let rows = statement.query_map(params![table, version], |row| {
        let version: SqlValue = row.get(0)?;
        let id: SqlValue = row.get(1)?;
        let op: SqlValue = row.get(2)?;
        let row_json: SqlValue = row.get(3)?;
        Ok((version, id, op, row_json))
    })?;
    let mut changes = Vec::new();
    for row in rows {
        let (version, id, op, row_json) = row?;
        let version =
            decode_required_committed_version(version, "selected change-journal version")?;
        validate_storage_version_at_most(version, maximum, "selected change-journal version")?;
        let id = decode_required_storage_text(id, "change-journal row id")?;
        let op = decode_required_storage_text(op, "change-journal operation")?;
        let row_json = decode_optional_storage_text(row_json, "change-journal row snapshot")?;
        let op = match op.as_str() {
            "insert" => ChangeOp::Insert,
            "update" => ChangeOp::Update,
            "delete" => ChangeOp::Delete,
            _ => {
                return Err(SnapbackError::error(
                    "SNAPBACK_STORAGE_VERSION_CORRUPT",
                    "storage",
                    "change-journal operation is not recognized",
                )
                .with_detail("table", table.to_owned())
                .with_detail("rowId", id)
                .with_detail("op", op));
            }
        };
        // Predicate-granular validation trusts this snapshot to decide whether
        // an intervening insert/update could affect the captured query. A
        // valid journal cursor paired with a forged lower embedded `_version`
        // must not make that change disappear from a version predicate.
        let row = match (&op, row_json) {
            (ChangeOp::Insert | ChangeOp::Update, Some(row_json)) => {
                let row = serde_json::from_str::<Value>(&row_json).map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_STORAGE_VERSION_CORRUPT",
                        "storage",
                        "change-journal row snapshot cannot prove its storage version",
                    )
                    .with_detail("table", table.to_owned())
                    .with_detail("rowId", id.clone())
                    .with_detail("error", error.to_string())
                })?;
                let row_object = row.as_object().ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_STORAGE_VERSION_CORRUPT",
                        "storage",
                        "change-journal row snapshot is not an object",
                    )
                    .with_detail("table", table.to_owned())
                    .with_detail("rowId", id.clone())
                })?;
                let snapshot_id =
                    row_object
                        .get("_id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            SnapbackError::error(
                                "SNAPBACK_STORAGE_VERSION_CORRUPT",
                                "storage",
                                "change-journal row snapshot has no string row id",
                            )
                            .with_detail("table", table.to_owned())
                            .with_detail("rowId", id.clone())
                        })?;
                if snapshot_id != id {
                    return Err(SnapbackError::error(
                        "SNAPBACK_STORAGE_VERSION_CORRUPT",
                        "storage",
                        "change-journal row snapshot id does not match its journal row id",
                    )
                    .with_detail("table", table.to_owned())
                    .with_detail("rowId", id.clone())
                    .with_detail("snapshotRowId", snapshot_id.to_owned()));
                }
                let row_version = decode_json_committed_version(
                    row_object.get("_version"),
                    "change-journal row snapshot version",
                )?;
                if row_version != version {
                    return Err(SnapbackError::error(
                        "SNAPBACK_STORAGE_VERSION_CORRUPT",
                        "storage",
                        "change-journal row snapshot version does not match its journal cursor",
                    )
                    .with_detail("table", table.to_owned())
                    .with_detail("rowId", id.clone())
                    .with_detail("journalVersion", version)
                    .with_detail("rowVersion", row_version));
                }
                Some(row)
            }
            (ChangeOp::Insert | ChangeOp::Update, None) => {
                return Err(SnapbackError::error(
                    "SNAPBACK_STORAGE_VERSION_CORRUPT",
                    "storage",
                    "change-journal write is missing its versioned row snapshot",
                )
                .with_detail("table", table.to_owned())
                .with_detail("rowId", id));
            }
            (ChangeOp::Delete, None) => None,
            (ChangeOp::Delete, Some(_)) => {
                return Err(SnapbackError::error(
                    "SNAPBACK_STORAGE_VERSION_CORRUPT",
                    "storage",
                    "change-journal delete unexpectedly carries a row snapshot",
                )
                .with_detail("table", table.to_owned())
                .with_detail("rowId", id));
            }
        };
        changes.push(ChangedRow {
            table: table.to_owned(),
            id,
            op,
            row,
            changed_fields: Vec::new(),
        });
    }
    Ok(changes)
}

/// Read a complete-commit batch for a derived catch-up executor. The returned
/// cutoff never splits one application commit: if the first outstanding
/// commit alone exceeds `row_limit`, that complete commit is returned so its
/// same-version row coalescing remains deterministic.
///
/// @ref LLP 0073#rebuilds-and-migrations — catch-up advances gap-free from a
///   journal-floor lease and persists one complete source-version boundary.
pub(crate) fn versioned_changes_to_table_batch(
    conn: &Connection,
    table: &str,
    after: u64,
    through: u64,
    row_limit: usize,
) -> SnapbackResult<(Vec<VersionedChangedRow>, u64)> {
    if after > through || row_limit == 0 {
        return Err(SnapbackError::error(
            "SNAPBACK_VECTOR_MAINTENANCE_FAILED",
            "vector",
            "vector catch-up journal range is invalid",
        ));
    }
    ensure_change_journal_versions_valid(conn, Some(table))?;
    validate_storage_version_at_most(after, through, "vector catch-up cursor")?;

    let mut grouped = conn.prepare_cached(
        "SELECT version,COUNT(*) FROM _snapback_changes
         WHERE table_name=?1 AND version>?2 AND version<=?3
         GROUP BY version ORDER BY version",
    )?;
    let groups = grouped.query_map(
        params![
            table,
            version_to_sql_integer(after)?,
            version_to_sql_integer(through)?
        ],
        |row| Ok((row.get::<_, SqlValue>(0)?, row.get::<_, i64>(1)?)),
    )?;
    let mut cutoff = through;
    let mut selected_rows = 0_usize;
    let mut selected_any = false;
    for group in groups {
        let (version, count) = group?;
        let version = decode_required_committed_version(version, "vector catch-up version")?;
        validate_storage_version_at_most(version, through, "vector catch-up version")?;
        let count = usize::try_from(count).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "storage",
                "vector catch-up journal group count is invalid",
            )
        })?;
        if selected_any && selected_rows.saturating_add(count) > row_limit {
            break;
        }
        selected_any = true;
        selected_rows = selected_rows.saturating_add(count);
        cutoff = version;
        if selected_rows >= row_limit {
            break;
        }
    }
    if !selected_any {
        return Ok((Vec::new(), through));
    }

    let mut statement = conn.prepare_cached(
        "SELECT version,row_id,op,row_json FROM _snapback_changes
         WHERE table_name=?1 AND version>?2 AND version<=?3
         ORDER BY version,id",
    )?;
    let rows = statement.query_map(
        params![
            table,
            version_to_sql_integer(after)?,
            version_to_sql_integer(cutoff)?
        ],
        |row| {
            Ok((
                row.get::<_, SqlValue>(0)?,
                row.get::<_, SqlValue>(1)?,
                row.get::<_, SqlValue>(2)?,
                row.get::<_, SqlValue>(3)?,
            ))
        },
    )?;
    let mut out = Vec::new();
    for row in rows {
        let (version, id, op, row_json) = row?;
        let version = decode_required_committed_version(version, "vector catch-up version")?;
        let id = decode_required_storage_text(id, "vector catch-up row id")?;
        let op = decode_required_storage_text(op, "vector catch-up operation")?;
        let row_json = decode_optional_storage_text(row_json, "vector catch-up row snapshot")?;
        let op = match op.as_str() {
            "insert" => ChangeOp::Insert,
            "update" => ChangeOp::Update,
            "delete" => ChangeOp::Delete,
            _ => {
                return Err(storage_version_corrupt(
                    "vector catch-up journal operation is not recognized",
                ));
            }
        };
        let row = match (&op, row_json) {
            (ChangeOp::Insert | ChangeOp::Update, Some(raw)) => {
                let value: Value = serde_json::from_str(&raw).map_err(|_| {
                    storage_version_corrupt("vector catch-up row snapshot is not valid JSON")
                })?;
                let object = value.as_object().ok_or_else(|| {
                    storage_version_corrupt("vector catch-up row snapshot is not an object")
                })?;
                if object.get("_id").and_then(Value::as_str) != Some(id.as_str())
                    || decode_json_committed_version(
                        object.get("_version"),
                        "vector catch-up row version",
                    )? != version
                {
                    return Err(storage_version_corrupt(
                        "vector catch-up row snapshot identity disagrees with the journal",
                    ));
                }
                Some(value)
            }
            (ChangeOp::Delete, None) => None,
            _ => {
                return Err(storage_version_corrupt(
                    "vector catch-up journal row has an invalid snapshot shape",
                ));
            }
        };
        out.push(VersionedChangedRow {
            version,
            change: ChangedRow {
                table: table.to_owned(),
                id,
                op,
                row,
                changed_fields: Vec::new(),
            },
        });
    }
    Ok((out, cutoff))
}

pub(crate) fn change_journal_floor_on(conn: &Connection) -> SnapbackResult<u64> {
    retention_floor_at_most(conn, current_version_on(conn)?)
}

/// The monotonic retention floor recorded by pruning (0 if none). A captured
/// read below it cannot be validated precisely — the changes it would need were
/// pruned — so validation must fall back to a conservative conflict.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3 / E4.
#[cfg(test)]
fn retention_floor_from_tx(tx: &Transaction<'_>) -> SnapbackResult<u64> {
    retention_floor_from_connection(tx)
}

fn retention_floor_at_most(conn: &Connection, maximum: u64) -> SnapbackResult<u64> {
    let floor = retention_floor_from_connection(conn)?;
    validate_storage_version_at_most(floor, maximum, "change-journal retention floor")?;
    Ok(floor)
}

fn retention_floor_from_connection(conn: &Connection) -> SnapbackResult<u64> {
    let value: Option<SqlValue> = conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            params![META_RETENTION_FLOOR],
            |row| row.get(0),
        )
        .optional()?;
    value.map_or(Ok(0), |value| {
        let value = decode_required_storage_text(value, "change-journal retention floor")?;
        let value = value.parse::<i64>().map_err(|_| {
            storage_version_corrupt("change-journal retention floor is not a portable integer")
        })?;
        decode_storage_version(value, "change-journal retention floor")
    })
}

fn save_retention_floor_on(conn: &Connection, floor: u64) -> SnapbackResult<()> {
    version_to_sql_integer(floor)?;
    conn.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![META_RETENTION_FLOOR, floor.to_string()],
    )?;
    Ok(())
}

fn captured_writes_from_changes(changes: &[ChangedRow]) -> Vec<CapturedWriteDependency> {
    changes
        .iter()
        .map(|change| CapturedWriteDependency {
            table: change.table.clone(),
            id: change.id.clone(),
            op: change.op.clone(),
        })
        .collect()
}

fn changed_field_names(values: &Map<String, Value>) -> Vec<String> {
    let mut fields = values.keys().cloned().collect::<Vec<_>>();
    fields.sort();
    fields
}

// Mutation value evaluation carries the settlement-time witness explicitly;
// each argument is independently meaningful at the commit boundary.
#[allow(clippy::too_many_arguments)]
fn eval_value_map(
    values: &BTreeMap<String, ValueExpr>,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    now_ms: u64,
    runtime_id: &dyn Fn(&str) -> SnapbackResult<String>,
    site: &str,
    settlement_time: Option<&SettlementTimePolicy>,
    settlement_time_within_bound: bool,
    settlement_time_sink_reached: &Cell<bool>,
) -> SnapbackResult<Map<String, Value>> {
    let mut output = Map::new();
    for (key, expr) in values {
        let site_key = key.replace('~', "~0").replace('/', "~1");
        let value = if settlement_time.is_some_and(|policy| policy.field == *key)
            && matches!(expr, ValueExpr::RuntimeNow)
        {
            settlement_time_sink_reached.set(true);
            let policy = settlement_time.expect("matched settlement policy");
            if settlement_time_within_bound {
                Value::Number(Number::from(policy.claimed))
            } else {
                eval_expr(
                    expr,
                    input,
                    bindings,
                    now_ms,
                    Some(runtime_id),
                    &format!("{site}/{site_key}"),
                )?
            }
        } else {
            eval_expr(
                expr,
                input,
                bindings,
                now_ms,
                Some(runtime_id),
                &format!("{site}/{site_key}"),
            )?
        };
        output.insert(key.clone(), value);
    }
    Ok(output)
}

// One shared evaluator (crate::value_expr) serves mutation execution, the
// live matcher, and filter→SQL compilation, so semantics cannot drift per
// call site (LLP 0051 D2's analyzability invariant).
fn eval_expr(
    expr: &ValueExpr,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    now_ms: u64,
    runtime_id: Option<&dyn Fn(&str) -> SnapbackResult<String>>,
    site: &str,
) -> SnapbackResult<Value> {
    let default_id = |_path: &str| Ok(new_id());
    let scoped_id = |path: &str| {
        runtime_id
            .unwrap_or(&default_id)(&format!("{site}{path}"))
            .map_err(Into::into)
    };
    let env = crate::value_expr::ExprEnv {
        args: &input.args,
        auth_user_id: input.auth.user_id.as_deref(),
        auth_kind: input.auth.authorization_kind.as_deref(),
        auth_actor_kind: input.auth.authorization_actor_kind.as_deref(),
        auth_activity_actor_kind: input.auth.authorization_activity_actor_kind.as_deref(),
        auth_actor_user_id: input.auth.authorization_actor_user_id.as_deref(),
        auth_grant_id: input.auth.authorization_grant_id.as_deref(),
        client_mutation_digest: input.auth.client_mutation_digest.as_deref(),
        auth_is_delegated: input.auth.authorization_is_delegated,
        bindings: Some(bindings),
        now_ms: Some(now_ms),
        runtime_id: Some(&scoped_id),
    };
    crate::value_expr::eval_value_expr(expr, &env)
        .map_err(|error| crate::diagnostic::SnapbackError::from(error.into_snapback()))
}

/// Evaluate one host-owned declarative authorization decision under the
/// delegated projection and its sealed direct-human baseline. Closed IR lets
/// actor-independent decisions reuse the identical answer; actor-aware nodes
/// are evaluated twice and callers intersect the resulting constraints.
/// Runtime intrinsics are refused before evaluation so the second projection
/// cannot allocate a second id or observe a different clock.
// @ref LLP 0055#resolved-authority-serviceprincipal — single execution, per-decision double authorization, stricter answer wins.
fn eval_authorization_decision_values(
    expr: &ValueExpr,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    direct_bindings: Option<&BTreeMap<String, Value>>,
    now_ms: u64,
    runtime_id: Option<&dyn Fn(&str) -> SnapbackResult<String>>,
    site: &str,
) -> SnapbackResult<Vec<Value>> {
    let is_actor_aware =
        authorization_expr_depends_on_projection(expr, input, bindings, direct_bindings);
    if input.auth.authorization_is_delegated && is_actor_aware && expr.uses_runtime_intrinsic() {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED",
            "auth",
            "actor-aware authorization decisions cannot depend on runtime clock or id inputs",
        ));
    }
    let delegated = eval_expr(expr, input, bindings, now_ms, runtime_id, site)?;
    if !input.auth.authorization_is_delegated || !is_actor_aware {
        return Ok(vec![delegated]);
    }
    let mut direct = input.clone();
    direct.auth = input
        .auth
        .direct_authorization_baseline()
        .expect("delegated authorization input has a direct baseline");
    Ok(vec![
        delegated,
        eval_expr(
            expr,
            &direct,
            direct_bindings.unwrap_or(bindings),
            now_ms,
            runtime_id,
            site,
        )?,
    ])
}

fn authorization_expr_depends_on_projection(
    expr: &ValueExpr,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    direct_bindings: Option<&BTreeMap<String, Value>>,
) -> bool {
    input.auth.authorization_is_delegated
        && direct_bindings.map_or_else(
            || expr.uses_actor_projection(),
            |direct| value_expr_depends_on_projection(expr, bindings, direct),
        )
}

fn value_expr_depends_on_projection(
    expr: &ValueExpr,
    bindings: &BTreeMap<String, Value>,
    direct_bindings: &BTreeMap<String, Value>,
) -> bool {
    match expr {
        ValueExpr::AuthActorKind
        | ValueExpr::AuthActivityActorKind
        | ValueExpr::AuthActorUserId
        | ValueExpr::AuthGrantId
        | ValueExpr::AuthIsDelegated => true,
        ValueExpr::Binding(name) => bindings.get(name) != direct_bindings.get(name),
        ValueExpr::Field { base, .. } => {
            value_expr_depends_on_projection(base, bindings, direct_bindings)
        }
        ValueExpr::Binary { left, right, .. } => {
            value_expr_depends_on_projection(left, bindings, direct_bindings)
                || value_expr_depends_on_projection(right, bindings, direct_bindings)
        }
        ValueExpr::Unary { expr, .. } => {
            value_expr_depends_on_projection(expr, bindings, direct_bindings)
        }
        ValueExpr::If { cond, then, r#else } => {
            value_expr_depends_on_projection(cond, bindings, direct_bindings)
                || value_expr_depends_on_projection(then, bindings, direct_bindings)
                || value_expr_depends_on_projection(r#else, bindings, direct_bindings)
        }
        ValueExpr::Concat(values) | ValueExpr::Call { args: values, .. } => values
            .iter()
            .any(|value| value_expr_depends_on_projection(value, bindings, direct_bindings)),
        ValueExpr::Record { fields } => fields
            .values()
            .any(|value| value_expr_depends_on_projection(value, bindings, direct_bindings)),
        ValueExpr::Arg(_)
        | ValueExpr::Args
        | ValueExpr::AuthUserId
        | ValueExpr::AuthKind
        | ValueExpr::ClientMutationDigest
        | ValueExpr::Literal(_)
        | ValueExpr::RuntimeId
        | ValueExpr::RuntimeNow
        | ValueExpr::MembershipExists(_) => false,
    }
}

fn timestamp_to_sql_millis(value: u64) -> SnapbackResult<i64> {
    validate_portable_timestamp_millis(value)?;
    i64::try_from(value).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_TIMESTAMP_OUT_OF_RANGE",
            "storage",
            format!("runtime timestamp {value} cannot be represented by the storage engine"),
        )
    })
}

fn seed_into_transaction(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    seed: SeedData,
    version: u64,
    order_field_bounds: &BTreeMap<(String, String), u64>,
) -> SnapbackResult<Vec<ChangedRow>> {
    if let Some(table) = seed.tables.keys().find(|table| {
        schema
            .asset_collections
            .iter()
            .any(|collection| collection.child_table == table.as_str())
    }) {
        return Err(SnapbackError::error(
            "SNAPBACK_MEDIA_COLLECTION_RAW_WRITE_REFUSED",
            "asset-collection",
            format!(
                "seed data cannot target framework-owned collection table {table}; use the generated collection operations or asset-cut restore"
            ),
        ));
    }
    // @ref LLP 0109#17-dated-amendment-seed-asset-fixtures-2026-07-31 — by
    //   this point every placeholder must have been resolved by the install
    //   path; legacy and resetInstall paths carry none, so an unresolved
    //   placeholder here is a precise refusal, not a generic validator error.
    for (table_name, rows) in &seed.tables {
        for row in rows {
            for (field_name, value) in row {
                if crate::assets::seed_placeholder_fixture_id(value).is_some() {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SEED_ASSET_FIXTURE_UNRESOLVED",
                        "seed",
                        format!(
                            "{table_name}.{field_name} carries an $assetFixture placeholder; attach the fixtures artifact on the install path — resetInstall and legacy seeds do not carry placeholders"
                        ),
                    ));
                }
            }
        }
    }
    let mut changes = seed_rows_into_transaction(tx, schema, seed, version, order_field_bounds)?;
    let _ =
        cascade_asset_collection_parent_deletions(tx, schema, &mut changes, version, now_millis())?;
    // @ref LLP 0044#typed-references-and-atomic-attachment — seeds run the
    //   same commit-boundary admission under system authority: restricted
    //   fields verify the asset (owner check waived for system custody),
    //   restriction-less fields refuse, and seeded bytes can never enter as
    //   `ready` blobs because a seed writes rows, never blob records.
    enforce_asset_reference_changes(
        schema,
        tx,
        &changes,
        &crate::assets::AssetCommitAuthority {
            path: crate::assets::AssetWritePath::Seed,
            principal: None,
            admissions: &[],
        },
        now_millis(),
    )?;
    changes.shrink_to_fit();
    Ok(changes)
}

fn seed_rows_into_transaction(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    seed: SeedData,
    version: u64,
    order_field_bounds: &BTreeMap<(String, String), u64>,
) -> SnapbackResult<Vec<ChangedRow>> {
    let mut changes = Vec::new();
    let now_ms = now_millis();
    let mut tables = seed.tables.into_iter().collect::<Vec<_>>();
    // Stable parent-before-child order makes automatic stamping apply to seed
    // writers without weakening the write-time parent-existence check.
    tables.sort_by_key(|(table_name, _)| {
        relation_table_depth(schema, table_name, &mut BTreeSet::new())
    });
    for (table_name, rows) in tables {
        // @ref LLP 0214#59-relationship-to-the-guide-binding-gap — all
        //   declarative seed variants converge here. A generated/versioned or
        //   legacy seed is not the verified-provisioning writer and therefore
        //   cannot populate a sealed identity-binding table.
        enforce_identity_binding_write_seal(schema, &table_name)?;
        let table = schema_table(schema, &table_name)?;
        for mut row in rows {
            // Declarative seeds may choose a stable id, but every other
            // system field remains host-owned. Remove the seed identity
            // carrier before entering the same insert validator used by
            // handler/derived writes.
            let id = match row.remove("_id") {
                None => crate::ids::mint_document(&table_name),
                Some(Value::String(id)) if !id.is_empty() => id,
                Some(_) => {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SEED_INVALID",
                        "storage",
                        format!("seed _id for {table_name} must be a nonempty string"),
                    ));
                }
            };
            let changed_fields = changed_field_names(&row);
            let document =
                insert_document(tx, table, &id, &row, version, now_ms, order_field_bounds)?;
            // Fixture seats carry the seed writer's provenance per row
            // (LLP 0109 §8's bulk MembershipWriter::Seed primitive; the
            // 0100 §8b routed lane). The declared provenance columns are
            // host-managed and not app-declared fields, so a fixture row
            // that tries to spoof them already refused in insert_document.
            // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
            //   seed is a privileged non-invocation writer class: no
            //   transition matrix, no transition record (a restore is not a
            //   stream of kicks), provenance stamped.
            if table.membership.is_some() {
                write_membership_creation_provenance(
                    tx,
                    table,
                    &id,
                    Some(&MembershipWriter::Seed),
                )?;
            }
            record_change(
                tx,
                version,
                &table.name,
                &id,
                ChangeOp::Insert,
                Some(&document),
                now_ms,
            )?;
            changes.push(ChangedRow {
                table: table.name.clone(),
                id,
                op: ChangeOp::Insert,
                row: Some(document),
                changed_fields,
            });
        }
    }
    Ok(changes)
}

fn relation_table_depth(
    schema: &SchemaManifest,
    table_name: &str,
    visiting: &mut BTreeSet<String>,
) -> usize {
    if !visiting.insert(table_name.to_owned()) {
        return 0;
    }
    let depth = schema
        .table(table_name)
        .into_iter()
        .flat_map(|table| table.fields.iter())
        .filter_map(|field| match &field.field_type {
            FieldType::RelationIncarnation { parent_table, .. } => Some(parent_table.as_str()),
            _ => None,
        })
        .map(|parent| 1 + relation_table_depth(schema, parent, visiting))
        .max()
        .unwrap_or(0);
    visiting.remove(table_name);
    depth
}

fn version_to_sql_integer(value: u64) -> SnapbackResult<i64> {
    i64::try_from(value)
        .ok()
        .filter(|_| value <= PORTABLE_STORAGE_VERSION_MAX)
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_VERSION_OUT_OF_RANGE",
                "storage",
                format!("version {value} is outside the portable integer domain"),
            )
        })
}

fn decode_storage_version(value: i64, context: &str) -> SnapbackResult<u64> {
    u64::try_from(value)
        .ok()
        .filter(|version| *version <= PORTABLE_STORAGE_VERSION_MAX)
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "storage",
                format!("{context} is outside the portable integer domain"),
            )
        })
}

fn decode_required_storage_version(value: SqlValue, context: &str) -> SnapbackResult<u64> {
    match value {
        SqlValue::Integer(value) => decode_storage_version(value, context),
        SqlValue::Null => Err(SnapbackError::error(
            "SNAPBACK_STORAGE_VERSION_CORRUPT",
            "storage",
            format!("{context} is null"),
        )),
        SqlValue::Real(_) | SqlValue::Text(_) | SqlValue::Blob(_) => Err(SnapbackError::error(
            "SNAPBACK_STORAGE_VERSION_CORRUPT",
            "storage",
            format!("{context} is not an integer"),
        )),
    }
}

fn decode_required_committed_version(value: SqlValue, context: &str) -> SnapbackResult<u64> {
    let version = decode_required_storage_version(value, context)?;
    if version == 0 {
        return Err(SnapbackError::error(
            "SNAPBACK_STORAGE_VERSION_CORRUPT",
            "storage",
            format!("{context} is zero, which cannot identify a committed row"),
        ));
    }
    Ok(version)
}

fn decode_required_storage_text(value: SqlValue, context: &str) -> SnapbackResult<String> {
    match value {
        SqlValue::Text(value) => Ok(value),
        SqlValue::Null | SqlValue::Integer(_) | SqlValue::Real(_) | SqlValue::Blob(_) => {
            Err(SnapbackError::error(
                "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "storage",
                format!("{context} is not SQLite text"),
            ))
        }
    }
}

fn decode_optional_storage_text(value: SqlValue, context: &str) -> SnapbackResult<Option<String>> {
    match value {
        SqlValue::Null => Ok(None),
        value => decode_required_storage_text(value, context).map(Some),
    }
}

fn decode_optional_storage_version(value: SqlValue, context: &str) -> SnapbackResult<Option<u64>> {
    match value {
        SqlValue::Null => Ok(None),
        value => decode_required_storage_version(value, context).map(Some),
    }
}

fn decode_json_storage_version(value: Option<&Value>, context: &str) -> SnapbackResult<u64> {
    value
        .and_then(Value::as_u64)
        .filter(|version| *version <= PORTABLE_STORAGE_VERSION_MAX)
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "storage",
                format!("{context} is not a portable non-negative integer"),
            )
        })
}

fn decode_json_committed_version(value: Option<&Value>, context: &str) -> SnapbackResult<u64> {
    let version = decode_json_storage_version(value, context)?;
    if version == 0 {
        return Err(SnapbackError::error(
            "SNAPBACK_STORAGE_VERSION_CORRUPT",
            "storage",
            format!("{context} is zero, which cannot identify a committed row"),
        ));
    }
    Ok(version)
}

/// A point lookup is an identity boundary, not merely a SQL-selection hint.
/// Return only the exact opaque string id the caller requested even if a
/// future decoder, collation, or storage adapter regresses independently of
/// the `WHERE _id = ?` predicate.
///
/// @ref LLP 0007#ids — portable ids have string representation and equality
/// semantics only; a storage target may not reinterpret either property.
fn validate_point_read_identity(
    document: &Value,
    requested_id: &str,
    table: &str,
) -> SnapbackResult<()> {
    if document.get("_id").and_then(Value::as_str) != Some(requested_id) {
        return Err(point_read_identity_corrupt(table));
    }
    Ok(())
}

#[cold]
fn point_read_identity_corrupt(table: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_STORAGE_ROW_ID_CORRUPT",
        "storage",
        "point read returned a row whose decoded identity differs from the requested id",
    )
    .with_detail("table", table.to_owned())
}

fn validate_document_version_at_most(
    document: &Value,
    maximum: u64,
    table: &str,
) -> SnapbackResult<()> {
    let version = decode_json_committed_version(document.get("_version"), "row storage version")?;
    if version > maximum {
        return Err(SnapbackError::error(
            "SNAPBACK_STORAGE_VERSION_CORRUPT",
            "storage",
            "row storage version is ahead of the global storage head",
        )
        .with_detail("table", table.to_owned())
        .with_detail("rowVersion", version)
        .with_detail("headVersion", maximum));
    }
    Ok(())
}

fn validate_storage_version_at_most(
    version: u64,
    maximum: u64,
    context: &str,
) -> SnapbackResult<()> {
    if version > maximum {
        return Err(storage_version_corrupt(format!(
            "{context} is ahead of the applicable global storage head",
        ))
        .with_detail("headVersion", maximum)
        .with_detail("observedVersion", version));
    }
    Ok(())
}

/// Reserve the next globally ordered storage version before mutation work.
/// The version is serialized as a plain JSON number and compared by JavaScript
/// clients. Exhausting that portable order is terminal even though SQLite and
/// Rust can represent larger integers: a lossy successor would invalidate
/// live/auth commit cuts before the signed storage boundary was reached.
pub(super) fn next_storage_version(current: u64) -> SnapbackResult<u64> {
    current
        .checked_add(1)
        .filter(|next| *next <= PORTABLE_STORAGE_VERSION_MAX)
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_STORAGE_VERSION_EXHAUSTED",
                "storage",
                "storage version cannot advance within the durable ordering domain",
            )
        })
}

// ============================================================================
// LLP 0056: the membership write path
//
// The write surface the review loop reshaped most (§Writes). Its shape here:
//   * a declared transition matrix, closed by default — every fact (caller
//     class, target self/other, old role, new role) is derived by the host from
//     the TARGET ROW READ IN THE SAME TRANSACTION, never from a caller argument;
//   * a writer-class seam below BOTH buffered Ibex writes and HostPlan (the
//     `enforce_membership_write_gate` / HostPlan pre-pass above) — a `ctx.db`-only
//     gate would be a hole;
//   * `lastHolder` counting durably recoverable eligible holders, with captured
//     caller/row/resource facts plus a serialized transaction-final evaluator
//     so concurrent finals and auth-lifecycle changes cannot strand a resource;
//   * creation/deletion witnesses (bootstrap/teardown) bound to the resource row
//     actually appearing/disappearing in this transaction.
//
// The generated JS methods (`ctx.membership.<decl>.*`) dispatch through the
// host-owned command/authority carrier into these methods (see
// `IbexHostContext::handle_host_call`). The system expiry sweep enters through
// the same sanctioned commit and final-state invariant.
// ============================================================================

/// The resolved authority a membership write runs under, mapped from
/// `ResolvedAppAuthority`. The invocation classes carry an effective principal;
/// autonomous service principals additionally retain the grant that authorized
/// them. `System`/`AdminBypass`/`Anonymous` match **no** transition class at all
/// — not even `"none"` (§Writes: "an authority with no effective principal
/// matches _no_ class"). `Seed`/`Import`/`Admin` are the privileged
/// non-invocation writers: they carry their own authority and so bypass the
/// transition matrix, but every table invariant still applies.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the
///   writer-class matrix; userless authorities are refused.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MembershipWriter {
    User {
        effective_principal: String,
    },
    Delegated {
        actor_principal: String,
        effective_principal: String,
        grant_id: String,
        authority_creating_consent: bool,
    },
    Autonomous {
        actor_principal: String,
        grant_id: String,
        authority_creating_consent: bool,
    },
    System,
    AdminBypass,
    Anonymous,
    Seed,
    Import {
        granted_by_actor: String,
        granted_by_effective: String,
        granted_by_grant: Option<String>,
    },
    Admin,
}

impl MembershipWriter {
    /// Map the resolved app authority to a membership writer class. `Session`
    /// and dev-impersonation carry the effective principal; system, adminBypass
    /// (which LLP 0039 projects as anonymous), and anonymous carry none. This is
    /// the seam the LLP 0004 bridge crosses when it wires `ctx.membership.*` to
    /// these host methods.
    pub fn from_resolved(resolved: &crate::auth::invocation::ResolvedAppAuthority) -> Self {
        Self::from_resolved_with_authority_creating(resolved, false)
    }

    pub(crate) fn from_resolved_with_authority_creating(
        resolved: &crate::auth::invocation::ResolvedAppAuthority,
        authority_creating_consent: bool,
    ) -> Self {
        use crate::auth::invocation::ResolvedAppAuthority as Resolved;
        match resolved {
            Resolved::Session { user_id, .. }
            | Resolved::RevalidatedPrincipal { user_id, .. }
            | Resolved::DevImpersonation { user_id, .. } => Self::User {
                effective_principal: user_id.clone(),
            },
            Resolved::ServicePrincipal {
                actor_user_id,
                effective_user_id,
                grant_id,
                ..
            } => effective_user_id.as_ref().map_or_else(
                || Self::Autonomous {
                    actor_principal: actor_user_id.clone(),
                    grant_id: grant_id.clone(),
                    authority_creating_consent,
                },
                |effective_user_id| Self::Delegated {
                    actor_principal: actor_user_id.clone(),
                    effective_principal: effective_user_id.clone(),
                    grant_id: grant_id.clone(),
                    authority_creating_consent,
                },
            ),
            Resolved::System => Self::System,
            Resolved::AdminBypass { .. } => Self::AdminBypass,
            Resolved::Anonymous => Self::Anonymous,
        }
    }

    pub(crate) fn is_service_principal(&self) -> bool {
        matches!(self, Self::Delegated { .. } | Self::Autonomous { .. })
    }

    pub(crate) fn has_authority_creating_consent(&self) -> bool {
        match self {
            Self::Delegated {
                authority_creating_consent,
                ..
            }
            | Self::Autonomous {
                authority_creating_consent,
                ..
            } => *authority_creating_consent,
            _ => false,
        }
    }

    /// The effective principal, or `None` for every userless / non-invocation
    /// writer. A `None` here is what makes an open-join `by: ["none"]` transition
    /// unreachable by a userless authority.
    fn effective_principal(&self) -> Option<&str> {
        match self {
            Self::User {
                effective_principal,
            }
            | Self::Delegated {
                effective_principal,
                ..
            } => Some(effective_principal),
            Self::Autonomous {
                actor_principal, ..
            } => Some(actor_principal),
            _ => None,
        }
    }

    fn is_privileged_noninvocation(&self) -> bool {
        matches!(self, Self::Seed | Self::Import { .. } | Self::Admin)
    }

    fn provenance(&self) -> Option<MembershipWriteProvenance> {
        let values = match self {
            Self::User {
                effective_principal,
            } => MembershipWriteProvenance {
                actor: effective_principal.clone(),
                effective: effective_principal.clone(),
                grant: None,
                writer_class: "invocation".to_owned(),
            },
            Self::Delegated {
                actor_principal,
                effective_principal,
                grant_id,
                ..
            } => MembershipWriteProvenance {
                actor: actor_principal.clone(),
                effective: effective_principal.clone(),
                grant: Some(grant_id.clone()),
                writer_class: "delegated".to_owned(),
            },
            Self::Autonomous {
                actor_principal,
                grant_id,
                ..
            } => MembershipWriteProvenance {
                actor: actor_principal.clone(),
                effective: actor_principal.clone(),
                grant: Some(grant_id.clone()),
                writer_class: "autonomous".to_owned(),
            },
            Self::System => MembershipWriteProvenance::tagged("system"),
            Self::Seed => MembershipWriteProvenance::tagged("seed"),
            Self::Import {
                granted_by_actor,
                granted_by_effective,
                granted_by_grant,
            } => MembershipWriteProvenance {
                actor: granted_by_actor.clone(),
                effective: granted_by_effective.clone(),
                grant: granted_by_grant.clone(),
                writer_class: "import".to_owned(),
            },
            Self::Admin => MembershipWriteProvenance::tagged("hostOps:dataEdit"),
            Self::AdminBypass | Self::Anonymous => return None,
        };
        Some(values)
    }

    /// A minimal handler input carrying just the effective principal so the
    /// sanctioned commit records a coherent auth fingerprint. Membership writes
    /// never carry a client read set (the host derives every fact); the captured
    /// aggregates ride `read_dependencies`.
    fn handler_input(&self) -> HandlerInput {
        let principal = self.effective_principal().map(str::to_owned);
        HandlerInput {
            auth: AuthInput {
                principal: principal.clone(),
                session_id: None,
                user_id: principal,
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct MembershipWriteProvenance {
    actor: String,
    effective: String,
    grant: Option<String>,
    writer_class: String,
}

impl MembershipWriteProvenance {
    fn tagged(tag: &str) -> Self {
        Self {
            actor: tag.to_owned(),
            effective: tag.to_owned(),
            grant: None,
            writer_class: tag.to_owned(),
        }
    }
}

/// The caller's authorization class over a resource, disjoint and totally
/// ordered — `Own` ("self") wins over any `Role`, and `None` is the authenticated
/// member-less member. A userless authority produces no class and never reaches
/// this type.
enum MembershipCallerClass {
    Own,
    Role(String),
    None,
}

impl MembershipCallerClass {
    fn token(&self) -> &str {
        match self {
            Self::Own => "self",
            Self::Role(role) => role,
            Self::None => "none",
        }
    }
}

/// A read of the membership target row: the axes and the row version that the
/// write captures as a snapshot-bound dependency (so a role revoked between the
/// check and commit fails commit-time validation).
struct MembershipTargetRow {
    id: String,
    principal: String,
    resource: Option<String>,
    role: String,
    version: u64,
}

/// The pre-authorized effect of one membership operation: the row writes plus
/// the captured aggregate dependencies, ready to commit under the `Sanctioned`
/// gate. The plan/commit split exists so two concurrent operations can be
/// evaluated against one snapshot and then committed in sequence, exercising the
/// captured-read linearization exactly as the buffered handler path would.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the
///   holder-set / resource-existence reads are captured, not snapshot-only.
#[derive(Clone, Debug)]
pub struct MembershipPlan {
    writes: Vec<BufferedWrite>,
    read_dependencies: Vec<CapturedReadDependency>,
    result: Value,
    /// Rows the expiry sweep skipped because they are the last eligible holder
    /// of a protected role (protection wins over expiry). Empty for every other
    /// operation.
    skipped_protected: Vec<String>,
}

/// A fresh resource may establish one bounded initial roster in its creation
/// commit. The creator's bootstrap seat is additional to this list.
pub(crate) const MEMBERSHIP_BOOTSTRAP_MAX_INITIAL_MEMBERS: usize = 64;

/// A membership effect whose writer was derived from the closed invocation
/// authority by the Rust host. Application code can request a declaration-bound
/// operation, but it cannot construct or alter this carrier.
///
/// @ref LLP 0056#protocol-obligations-deferred-to-implementation — the host-owned writer-authority carrier
///   remains distinct from raw buffered writes through replay, dry-run, and
///   nested mutation commit.
#[derive(Clone, Debug)]
pub(crate) struct AuthorizedMembershipPlan {
    writer: MembershipWriter,
    plan: MembershipPlan,
}

impl AuthorizedMembershipPlan {
    pub(crate) fn user_transition(writer: MembershipWriter, plan: MembershipPlan) -> Self {
        Self { writer, plan }
    }
}

/// A declaration-bound membership operation buffered by the host bridge. Both
/// the table binding and writer are host-derived; only operation arguments come
/// from application code.
#[derive(Clone, Debug)]
pub(crate) struct BufferedMembershipCommand {
    writer: MembershipWriter,
    table: String,
    op: BufferedMembershipOp,
}

#[derive(Clone, Debug)]
enum BufferedMembershipOp {
    Bootstrap {
        resource_id: String,
        values: Map<String, Value>,
        initial_members: Vec<Map<String, Value>>,
    },
    Insert(Map<String, Value>),
    SetRole {
        member_id: String,
        role: String,
    },
    Remove {
        member_id: String,
    },
    Patch {
        member_id: String,
        values: Map<String, Value>,
    },
    SetSelfRole {
        resource: Option<String>,
        role: String,
    },
    RemoveSelf {
        resource: Option<String>,
    },
    PatchSelf {
        resource: Option<String>,
        values: Map<String, Value>,
    },
    RemovePrincipal {
        resource: Option<String>,
        principal: String,
    },
    ChangeRolePrincipal {
        resource: Option<String>,
        principal: String,
        role: String,
    },
    RemoveAuthorityPrincipal {
        resource: Option<String>,
        principal: String,
    },
    TransferOwner {
        resource: Option<String>,
        principal: String,
    },
}

impl BufferedMembershipCommand {
    pub(crate) fn bootstrap(
        writer: MembershipWriter,
        table: String,
        resource_id: String,
        values: Map<String, Value>,
        initial_members: Vec<Map<String, Value>>,
    ) -> Self {
        Self {
            writer,
            table,
            op: BufferedMembershipOp::Bootstrap {
                resource_id,
                values,
                initial_members,
            },
        }
    }

    pub(crate) fn insert(
        writer: MembershipWriter,
        table: String,
        values: Map<String, Value>,
    ) -> Self {
        Self {
            writer,
            table,
            op: BufferedMembershipOp::Insert(values),
        }
    }

    pub(crate) fn set_role(
        writer: MembershipWriter,
        table: String,
        member_id: String,
        role: String,
    ) -> Self {
        Self {
            writer,
            table,
            op: BufferedMembershipOp::SetRole { member_id, role },
        }
    }

    pub(crate) fn remove(writer: MembershipWriter, table: String, member_id: String) -> Self {
        Self {
            writer,
            table,
            op: BufferedMembershipOp::Remove { member_id },
        }
    }

    pub(crate) fn patch(
        writer: MembershipWriter,
        table: String,
        member_id: String,
        values: Map<String, Value>,
    ) -> Self {
        Self {
            writer,
            table,
            op: BufferedMembershipOp::Patch { member_id, values },
        }
    }

    pub(crate) fn set_self_role(
        writer: MembershipWriter,
        table: String,
        resource: Option<String>,
        role: String,
    ) -> Self {
        Self {
            writer,
            table,
            op: BufferedMembershipOp::SetSelfRole { resource, role },
        }
    }

    pub(crate) fn remove_self(
        writer: MembershipWriter,
        table: String,
        resource: Option<String>,
    ) -> Self {
        Self {
            writer,
            table,
            op: BufferedMembershipOp::RemoveSelf { resource },
        }
    }

    pub(crate) fn patch_self(
        writer: MembershipWriter,
        table: String,
        resource: Option<String>,
        values: Map<String, Value>,
    ) -> Self {
        Self {
            writer,
            table,
            op: BufferedMembershipOp::PatchSelf { resource, values },
        }
    }

    pub(crate) fn remove_principal(
        writer: MembershipWriter,
        table: String,
        resource: Option<String>,
        principal: String,
    ) -> Self {
        Self {
            writer,
            table,
            op: BufferedMembershipOp::RemovePrincipal {
                resource,
                principal,
            },
        }
    }

    pub(crate) fn transfer_owner(
        writer: MembershipWriter,
        table: String,
        resource: Option<String>,
        principal: String,
    ) -> Self {
        Self {
            writer,
            table,
            op: BufferedMembershipOp::TransferOwner {
                resource,
                principal,
            },
        }
    }

    pub(crate) fn change_role_principal(
        writer: MembershipWriter,
        table: String,
        resource: Option<String>,
        principal: String,
        role: String,
    ) -> Self {
        Self {
            writer,
            table,
            op: BufferedMembershipOp::ChangeRolePrincipal {
                resource,
                principal,
                role,
            },
        }
    }

    pub(crate) fn remove_authority_principal(
        writer: MembershipWriter,
        table: String,
        resource: Option<String>,
        principal: String,
    ) -> Self {
        Self {
            writer,
            table,
            op: BufferedMembershipOp::RemoveAuthorityPrincipal {
                resource,
                principal,
            },
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MembershipCreationProvenance {
    pub actor: String,
    pub effective: String,
    pub grant: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MembershipTransitionRecord {
    pub declaration: String,
    pub op: String,
    pub principal: String,
    pub resource: Option<String>,
    pub from_role: Option<String>,
    pub to_role: Option<String>,
    pub actor: String,
    pub effective: String,
    pub grant: Option<String>,
    pub commit_version: u64,
    pub writer_class: String,
}

impl MembershipPlan {
    /// Rows the sweep left live because `lastHolder` wins over expiry.
    pub fn skipped_protected(&self) -> &[String] {
        &self.skipped_protected
    }
}

fn mutation_plan_refusal(code: &str, message: impl Into<String>, details: Value) -> SnapbackError {
    // A generated WWA scope read deliberately collapses a missing parent and
    // a present-but-hidden parent to one byte-identical public refusal. The
    // builder assigns this code to both the Get and owner Guard; do not leak
    // which step failed through the message or details carrier.
    //
    // @ref LLP 0135#17-allocation-authority-and-information-flow
    if code == "SNAPBACK_RELATION_PARENT_UNAVAILABLE" {
        return SnapbackError::error(code, "handler", "relation parent unavailable")
            .with_details(json!({ "step": "ScopeAuthority" }));
    }
    SnapbackError::error(code, "handler", message).with_details(details)
}

fn membership_refusal(code: &str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "auth", message)
}

fn resolve_membership_decl<'a>(
    schema: &'a SchemaManifest,
    table: &str,
) -> SnapbackResult<(&'a TableManifest, &'a MembershipManifest)> {
    let table = schema_table(schema, table)?;
    let membership = table.membership.as_ref().ok_or_else(|| {
        membership_refusal(
            "SNAPBACK_MEMBERSHIP_NOT_DECLARED",
            format!("table {} carries no .membership() declaration", table.name),
        )
    })?;
    Ok((table, membership))
}

fn read_membership_row(
    conn: &Connection,
    table: &TableManifest,
    membership: &MembershipManifest,
    id: &str,
) -> SnapbackResult<Option<MembershipTargetRow>> {
    with_pinned_read_snapshot(conn, |conn| {
        read_membership_row_at_most(conn, table, membership, id, current_version_on(conn)?)
    })
}

fn read_membership_row_at_most(
    conn: &Connection,
    table: &TableManifest,
    membership: &MembershipManifest,
    id: &str,
    maximum: u64,
) -> SnapbackResult<Option<MembershipTargetRow>> {
    let mut columns = vec![membership.principal.clone(), membership.role.clone()];
    if let Some(resource) = &membership.resource {
        columns.push(resource.clone());
    }
    let quoted = columns
        .iter()
        .map(|column| quote_ident(column))
        .collect::<SnapbackResult<Vec<_>>>()?
        .join(", ");
    let sql = format!(
        "SELECT {quoted}, _version FROM {} WHERE _id = ?1",
        quote_ident(&table.name)?
    );
    let has_resource = membership.resource.is_some();
    let row: Option<(String, String, Option<String>, SqlValue)> = conn
        .query_row(&sql, params![id], |row| {
            let principal: String = row.get(0)?;
            let role: String = row.get(1)?;
            let (resource, version): (Option<String>, SqlValue) = if has_resource {
                (row.get(2)?, row.get(3)?)
            } else {
                (None, row.get(2)?)
            };
            Ok((principal, role, resource, version))
        })
        .optional()?;
    row.map(|(principal, role, resource, version)| {
        let version = decode_required_committed_version(version, "membership row storage version")?;
        validate_storage_version_at_most(version, maximum, "membership row storage version")?;
        Ok(MembershipTargetRow {
            id: id.to_owned(),
            principal,
            resource,
            role,
            version,
        })
    })
    .transpose()
}

/// The caller's own role over a resource, together with the exact captured
/// `(principal, resource)` lookup that produced it. The empty-result witness is
/// just as load-bearing as a present row: an absent caller class must not remain
/// authorized after a concurrent membership insert.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — stale
///   caller-role decisions are validated at commit on both lookup outcomes.
fn read_caller_role_with_dependency(
    conn: &Connection,
    table: &TableManifest,
    membership: &MembershipManifest,
    resource: Option<&str>,
    principal: &str,
) -> SnapbackResult<(Option<String>, CapturedReadDependency)> {
    let (pair, dependency) =
        read_membership_pair_with_dependency(conn, table, membership, resource, principal)?;
    Ok((pair.map(|(_, role)| role), dependency))
}

/// Resolve one `(principal, resource)` pair to its row id and role, with a
/// captured dependency covering BOTH outcomes: a present lookup captures the
/// exact matched row and role; an absent lookup probes the whole vocabulary so
/// any later membership for the pair invalidates the absence witness. The
/// returned id stays inside the host (LLP 0056's private-roster posture) —
/// callers feed it into the unchanged target-row planners, never to the app.
///
/// @ref LLP 0100#3-host-resolution-and-linearization — both present and
///   absent target lookups are captured, so a concurrent insert, remove, or
///   role change invalidates the command's read set before companion writes
///   can commit against a stale result.
fn read_membership_pair_with_dependency(
    conn: &Connection,
    table: &TableManifest,
    membership: &MembershipManifest,
    resource: Option<&str>,
    principal: &str,
) -> SnapbackResult<(Option<(String, String)>, CapturedReadDependency)> {
    with_pinned_read_snapshot(conn, |conn| {
        let head = current_version_on(conn)?;
        validate_managed_row_versions(conn, table, head)?;
        let (sql, bound): (String, Vec<String>) = match (&membership.resource, resource) {
            (Some(resource_col), Some(resource_value)) => (
                format!(
                    "SELECT _id, {role} FROM {table} WHERE {principal} = ?1 AND {resource} = ?2",
                    role = quote_ident(&membership.role)?,
                    table = quote_ident(&table.name)?,
                    principal = quote_ident(&membership.principal)?,
                    resource = quote_ident(resource_col)?,
                ),
                vec![principal.to_owned(), resource_value.to_owned()],
            ),
            (None, _) => (
                format!(
                    "SELECT _id, {role} FROM {table} WHERE {principal} = ?1",
                    role = quote_ident(&membership.role)?,
                    table = quote_ident(&table.name)?,
                    principal = quote_ident(&membership.principal)?,
                ),
                vec![principal.to_owned()],
            ),
            (Some(_), None) => {
                return Err(membership_refusal(
                    "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING",
                    "resource-scoped caller-role lookup is missing its resource",
                ));
            }
        };
        let row = conn
            .query_row(&sql, params_from_iter(bound.iter()), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .optional()?;
        // A present lookup must capture the exact role that produced the caller
        // class, not merely the existence of some membership row. Otherwise a
        // `host` plan could survive a concurrent demotion to `guest`: the same row
        // id would still match a probe over the declaration's whole vocabulary.
        // An absent lookup deliberately probes the whole vocabulary so any later
        // caller membership invalidates the `none` witness.
        let matched_role = row.as_ref().map(|(_, role)| role.clone());
        let roles = matched_role.clone().map_or_else(
            || membership.vocabulary().map(str::to_owned).collect(),
            |role| vec![role],
        );
        let resource = match (&membership.resource, resource) {
            (Some(_), Some(resource)) => {
                crate::membership_rules::ResourceBinding::Fixed(Value::String(resource.to_owned()))
            }
            (None, _) => crate::membership_rules::ResourceBinding::AppSingleton,
            (Some(_), None) => unreachable!("resource-scoped absence refused above"),
        };
        let probe = crate::membership_rules::membership_probe_plan(
            membership,
            &table.name,
            principal,
            &resource,
            &roles,
        );
        let matching_ids = row
            .as_ref()
            .map(|(id, _)| vec![id.clone()])
            .unwrap_or_default();
        let dependency =
            crate::membership_rules::membership_capture_dependency(&probe, head, matching_ids)?;
        Ok((row, dependency))
    })
}

fn read_resource_version(
    conn: &Connection,
    resource_table: &str,
    resource_id: &str,
) -> SnapbackResult<Option<u64>> {
    with_pinned_read_snapshot(conn, |conn| {
        read_resource_version_at_most(conn, resource_table, resource_id, current_version_on(conn)?)
    })
}

fn read_resource_version_at_most(
    conn: &Connection,
    resource_table: &str,
    resource_id: &str,
    maximum: u64,
) -> SnapbackResult<Option<u64>> {
    let version: Option<SqlValue> = conn
        .query_row(
            &format!(
                "SELECT _version FROM {} WHERE _id = ?1",
                quote_ident(resource_table)?
            ),
            params![resource_id],
            |row| row.get(0),
        )
        .optional()?;
    version
        .map(|version| {
            let version =
                decode_required_committed_version(version, "membership resource storage version")?;
            validate_storage_version_at_most(
                version,
                maximum,
                "membership resource storage version",
            )?;
            Ok(version)
        })
        .transpose()
}

/// Find a transition that authorizes `(op, caller class, target, from, to)`.
/// Closed by default: `None` means refuse. Field-binding is validated by the
/// caller once a candidate op/class/target/role match is found — an op match
/// that fails field-binding is still a refusal, never a silent narrowing.
fn matches_role_lists(
    transition: &crate::manifest::MembershipTransition,
    from: Option<&str>,
    to: Option<&str>,
) -> bool {
    let from_ok = match (from, &transition.from) {
        (None, _) => true,
        (Some(from), Some(list)) => list.iter().any(|role| role == from),
        // `from` is optional for setRole/remove/patch. Omission means any
        // current role; operation-specific required lists are enforced when
        // the manifest is loaded.
        // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default
        (Some(_), None) => true,
    };
    let to_ok = match (to, &transition.to) {
        (None, _) => true,
        (Some(to), Some(list)) => list.iter().any(|role| role == to),
        (Some(_), None) => false,
    };
    from_ok && to_ok
}

impl LocalDatabase {
    pub fn membership_creation_provenance(
        &self,
        table: &str,
        id: &str,
    ) -> SnapbackResult<Option<MembershipCreationProvenance>> {
        let (table, membership) = resolve_membership_decl(&self.schema, table)?;
        if membership.provenance.is_none() {
            return Ok(None);
        }
        self.conn
            .query_row(
                &format!(
                    "SELECT {}, {}, {} FROM {} WHERE _id = ?1",
                    quote_ident(MEMBERSHIP_GRANTED_BY_ACTOR)?,
                    quote_ident(MEMBERSHIP_GRANTED_BY_EFFECTIVE)?,
                    quote_ident(MEMBERSHIP_GRANTED_BY_GRANT)?,
                    quote_ident(&table.name)?,
                ),
                params![id],
                |row| {
                    Ok(MembershipCreationProvenance {
                        actor: row.get(0)?,
                        effective: row.get(1)?,
                        grant: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(SnapbackError::from)
    }

    pub fn membership_transition_log(
        &self,
        declaration: &str,
    ) -> SnapbackResult<Vec<MembershipTransitionRecord>> {
        with_pinned_read_snapshot(&self.conn, |conn| {
            let head = current_version_on(conn)?;
            let mut statement = conn.prepare(
                "SELECT declaration_id, op, principal, resource, from_role, to_role,
                    actor, effective, grant_id, commit_version, writer_class
             FROM _snapback_membership_transitions
             WHERE declaration_id = ?1
             ORDER BY commit_version, id",
            )?;
            type RawTransition = (
                String,
                String,
                String,
                Option<String>,
                Option<String>,
                Option<String>,
                String,
                String,
                Option<String>,
                SqlValue,
                String,
            );
            let rows = statement
                .query_map(params![declaration], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                        row.get(9)?,
                        row.get(10)?,
                    ))
                })?
                .collect::<Result<Vec<RawTransition>, _>>()?;
            rows.into_iter()
                .map(
                    |(
                        declaration,
                        op,
                        principal,
                        resource,
                        from_role,
                        to_role,
                        actor,
                        effective,
                        grant,
                        commit_version,
                        writer_class,
                    )| {
                        let commit_version = decode_required_committed_version(
                            commit_version,
                            "membership transition commit version",
                        )?;
                        validate_storage_version_at_most(
                            commit_version,
                            head,
                            "membership transition commit version",
                        )?;
                        Ok(MembershipTransitionRecord {
                            declaration,
                            op,
                            principal,
                            resource,
                            from_role,
                            to_role,
                            actor,
                            effective,
                            grant,
                            commit_version,
                            writer_class,
                        })
                    },
                )
                .collect()
        })
    }
}

fn protected_role(membership: &MembershipManifest) -> &str {
    membership
        .last_holder
        .as_ref()
        .map(|last| last.protect.as_str())
        .unwrap_or("")
}

fn extract_axis(values: &Map<String, Value>, field: &str, axis: &str) -> SnapbackResult<String> {
    match values.get(field) {
        Some(Value::String(value)) if !value.is_empty() => Ok(value.clone()),
        _ => Err(membership_refusal(
            "SNAPBACK_MEMBERSHIP_NULL_AXIS",
            format!("membership insert is missing a non-null {axis} axis ({field})"),
        )),
    }
}

fn require_in_vocabulary(membership: &MembershipManifest, role: &str) -> SnapbackResult<()> {
    if membership.vocabulary().any(|declared| declared == role) {
        return Ok(());
    }
    Err(membership_refusal(
        "SNAPBACK_MEMBERSHIP_UNKNOWN_ROLE",
        format!("role {role:?} is outside the closed vocabulary (comparison is exact-decoded)"),
    )
    .with_detail("role", role.to_owned()))
}

/// Field-bound insert: the values may carry the axes and only the columns the
/// matched transition names in `fields`. An open-join insert seating its own
/// far-future `expiresAt` is refused because that column is not in the
/// transition's `fields`.
fn enforce_insert_fields(
    membership: &MembershipManifest,
    transition: &crate::manifest::MembershipTransition,
    values: &Map<String, Value>,
) -> SnapbackResult<()> {
    for key in values.keys() {
        if key == &membership.principal
            || key == &membership.role
            || membership.resource.as_deref() == Some(key.as_str())
        {
            continue;
        }
        if !transition.fields.iter().flatten().any(|field| field == key) {
            return Err(membership_refusal(
                "SNAPBACK_MEMBERSHIP_INSERT_FIELD_DENIED",
                format!(
                    "insert may not seat column {key:?}: it is not named in the matched \
                     transition's fields"
                ),
            )
            .with_detail("field", key.clone()));
        }
    }
    Ok(())
}

fn transition_denied(op: MembershipOp, class: &str, target: MembershipTarget) -> SnapbackError {
    membership_refusal(
        "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED",
        format!(
            "no declared transition authorizes op {:?} by caller class {class:?} on target {}",
            op.as_str(),
            match target {
                MembershipTarget::Own => "self",
                MembershipTarget::Other => "other",
            }
        ),
    )
    .with_detail("op", op.as_str())
    .with_detail("callerClass", class.to_owned())
}

/// A raw member id carries no caller-supplied scope. Until a present target row
/// supplies that scope, admission is indeterminable; therefore absence and a
/// present row hidden from this caller share one invariant refusal payload.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the
///   host derives scope and caller class from the target row without turning
///   row existence into a public oracle.
fn member_id_transition_denied(op: MembershipOp) -> SnapbackError {
    membership_refusal(
        "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED",
        format!(
            "no declared transition authorizes member-id operation {:?}",
            op.as_str()
        ),
    )
    .with_detail("op", op.as_str())
}

fn target_row_dependency(table: &str, row: &MembershipTargetRow) -> CapturedReadDependency {
    CapturedReadDependency {
        kind: CapturedReadKind::Row,
        table: Some(table.to_owned()),
        id: Some(row.id.clone()),
        version: Some(row.version),
        predicate: None,
        rows: Vec::new(),
        field: None,
        value: None,
        order: None,
        limit: None,
        result_count: None,
        boundary: None,
    }
}

fn resource_row_dependency(table: &str, id: &str, version: u64) -> CapturedReadDependency {
    CapturedReadDependency {
        kind: CapturedReadKind::Row,
        table: Some(table.to_owned()),
        id: Some(id.to_owned()),
        version: Some(version),
        predicate: None,
        rows: Vec::new(),
        field: None,
        value: None,
        order: None,
        limit: None,
        result_count: None,
        boundary: None,
    }
}

fn resource_missing_dependency(table: &str, id: &str) -> CapturedReadDependency {
    CapturedReadDependency {
        kind: CapturedReadKind::MissingRow,
        table: Some(table.to_owned()),
        id: Some(id.to_owned()),
        version: None,
        predicate: None,
        rows: Vec::new(),
        field: None,
        value: None,
        order: None,
        limit: None,
        result_count: None,
        boundary: None,
    }
}

/// The writer-class gate applied at the buffered-Ibex commit seam. `Deny` is
/// every ordinary writer; `Sanctioned` is the host-evaluated membership engine,
/// which has already authorized its writes.
#[derive(Clone, Copy, PartialEq, Eq)]
enum MembershipWriteGate {
    Deny,
    Sanctioned,
}

#[derive(Clone, Copy)]
enum MembershipGuardOp {
    Insert,
    Patch,
    Delete,
}

/// Recheck invariants whose captured pre-state can be changed by an earlier raw
/// write in this same transaction. Captured dependencies close concurrent
/// races, but validation happens before buffered writes are applied; without
/// this application-point check, a mixed mutation could delete a resource and
/// then spend a previously authorized membership-insert plan against it.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — every
///   writer preserves referential integrity at the central commit seam.
fn revalidate_sanctioned_membership_write(
    schema: &SchemaManifest,
    tx: &Transaction<'_>,
    write: &BufferedWrite,
    maximum: u64,
) -> SnapbackResult<()> {
    let table = write.table();
    let Some(table_manifest) = schema.table(table) else {
        return Ok(());
    };
    let Some(membership) = &table_manifest.membership else {
        return Ok(());
    };

    if let BufferedWrite::Insert { values, .. } = write
        && let (Some(resource_field), Some(resource_table)) =
            (&membership.resource, &membership.resource_table)
    {
        let resource = extract_axis(values, resource_field, "resource")?;
        if read_resource_version_at_most(tx, resource_table, &resource, maximum)?.is_none() {
            return Err(membership_refusal(
                "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING",
                format!(
                    "membership insert names resource {resource:?}, which no longer exists in \
                     {resource_table}"
                ),
            ));
        }
    }

    // Planning-time eligibility is insufficient: an auth-lifecycle transaction
    // can deactivate the target or destroy its final recovery carrier before
    // this serialized commit begins. Recheck every insert/promotion into the
    // protected role against the same transaction snapshot. The complete
    // final-state evaluator below still proves that departures retain a holder;
    // this leg proves that a raced promotion cannot add an ineligible holder
    // merely because some other eligible holder also remains.
    let Some(protected) = membership.last_holder.as_ref().map(|last| &last.protect) else {
        return Ok(());
    };
    let promoted_principal = match write {
        BufferedWrite::Insert { values, .. }
            if values.get(&membership.role).and_then(Value::as_str) == Some(protected.as_str()) =>
        {
            Some(extract_axis(values, &membership.principal, "principal")?)
        }
        BufferedWrite::Patch { id, values, .. }
            if values.get(&membership.role).and_then(Value::as_str) == Some(protected.as_str()) =>
        {
            read_membership_row_at_most(tx, table_manifest, membership, id, maximum)?
                .map(|row| row.principal)
        }
        _ => None,
    };
    if let Some(principal) = promoted_principal
        && !auth_agents::principal_is_eligible_on(
            tx,
            &principal,
            schema.effective_auth_mode() == AuthMode::Sessions,
        )?
    {
        return Err(membership_refusal(
            "SNAPBACK_MEMBERSHIP_INELIGIBLE_HOLDER",
            format!(
                "principal {principal:?} has no durable recovery carrier and cannot enter the \
                 protected role {protected:?}"
            ),
        )
        .with_detail("principal", principal)
        .with_detail("role", protected.clone()));
    }
    Ok(())
}

impl MembershipGuardOp {
    fn as_str(self) -> &'static str {
        match self {
            Self::Insert => "insert",
            Self::Patch => "patch",
            Self::Delete => "delete",
        }
    }
}

/// The buffered-write half of the writer-class seam. Under `Deny`: a raw write to
/// a declared membership table is refused; creating a resource of a
/// `lastHolder`-protected declaration without the bootstrap path is refused; and
/// deleting a resource row that still has memberships is refused (teardown is the
/// only path). `Sanctioned` writes are let through — the engine vouches for them.
fn enforce_membership_write_gate(
    schema: &SchemaManifest,
    tx: &Transaction<'_>,
    table: &str,
    op: MembershipGuardOp,
    row_id: Option<&str>,
    gate: MembershipWriteGate,
) -> SnapbackResult<()> {
    if gate == MembershipWriteGate::Sanctioned {
        return Ok(());
    }
    if schema.table(table).is_some_and(|t| t.membership.is_some()) {
        return Err(membership_raw_write_denied(table, op));
    }
    match op {
        MembershipGuardOp::Insert => enforce_protected_resource_insert_guard(schema, table)?,
        MembershipGuardOp::Delete => enforce_resource_delete_guard(schema, tx, table, row_id)?,
        MembershipGuardOp::Patch => {}
    }
    Ok(())
}

// @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation — deleting a parent
// atomically retires its framework-owned item identities. Otherwise hidden
// orphan rows would keep reverse-reference GC roots alive indefinitely.
fn cascade_asset_collection_parent_deletions(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    changes: &mut Vec<ChangedRow>,
    version: u64,
    now_ms: u64,
) -> SnapbackResult<BTreeSet<String>> {
    let deleted_parents = changes
        .iter()
        .filter(|change| change.op == ChangeOp::Delete)
        .map(|change| (change.table.clone(), change.id.clone()))
        .collect::<BTreeSet<_>>();
    if deleted_parents.is_empty() {
        return Ok(BTreeSet::new());
    }
    let mut affected_assets = BTreeSet::new();
    for collection in &schema.asset_collections {
        let table = schema_table(schema, &collection.child_table)?;
        for (_, parent_id) in deleted_parents
            .iter()
            .filter(|(table, _)| table == &collection.owner_table)
        {
            let sql = format!(
                "SELECT * FROM {} WHERE parentId = ?1 ORDER BY ordinal, _id",
                quote_ident(&table.name)?
            );
            let mut statement = tx.prepare(&sql)?;
            let columns = statement
                .column_names()
                .into_iter()
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>();
            let mut rows = statement.query([parent_id])?;
            let mut items = Vec::new();
            while let Some(row) = rows.next()? {
                let document = row_to_document(row, table, &columns)?;
                let id = document
                    .get("_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        asset_collection_error(
                            "SNAPBACK_MEDIA_COLLECTION_STORAGE_INVALID",
                            "collection item is missing its stable id",
                        )
                    })?
                    .to_owned();
                let asset_id = document
                    .get("assetId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                let ordinal = document
                    .get("ordinal")
                    .and_then(Value::as_u64)
                    .and_then(|value| usize::try_from(value).ok())
                    .unwrap_or_default();
                items.push(AssetCollectionStoredItem {
                    id,
                    asset_id,
                    ordinal,
                    document,
                });
            }
            drop(rows);
            drop(statement);
            let item_ids = items
                .iter()
                .map(|item| item.id.clone())
                .collect::<BTreeSet<_>>();
            affected_assets.extend(asset_grants::revoke_collection_managed_in_tx(
                tx,
                &collection.generation,
                &item_ids,
                now_ms,
            )?);
            for item in items {
                record_asset_collection_delete(tx, table, &item, version, now_ms, changes)?;
            }
        }
    }
    Ok(affected_assets)
}

/// The asset-reference commit hook (LLP 0044 §Typed references; LLP 0007
/// dated amendment 2026-07-31). Runs over the committed change set inside the
/// same transaction, below every write path — buffered Ibex writes, host
/// plans, and seeds — so enforcement lives at the storage boundary, not in a
/// helper. Reverse edges commit in this same changeset, which is what makes
/// `via-references` read grants and reference GC exact.
pub(crate) fn enforce_asset_reference_changes(
    schema: &SchemaManifest,
    tx: &Transaction<'_>,
    changes: &[ChangedRow],
    authority: &crate::assets::AssetCommitAuthority<'_>,
    now_ms: u64,
) -> SnapbackResult<()> {
    use crate::assets::{self, AssetReceiptEventV1, AssetReceiptV1, AssetWritePath};
    let lineage = format!("attach:{}", uuid::Uuid::now_v7());
    for change in changes {
        let Some(table) = schema.table(&change.table) else {
            continue;
        };
        let asset_fields: Vec<&FieldManifest> = table
            .fields
            .iter()
            .filter(|field| matches!(field.field_type, FieldType::AssetRef { .. }))
            .collect();
        if asset_fields.is_empty() {
            continue;
        }
        if change.op == ChangeOp::Delete {
            for edge in assets::load_edges_for_row(tx, &change.table, &change.id)? {
                assets::delete_reference_edge(tx, &edge, now_ms)?;
                assets::write_receipt(
                    tx,
                    &AssetReceiptV1 {
                        receipt_id: uuid::Uuid::now_v7().to_string(),
                        operation_lineage: lineage.clone(),
                        event: AssetReceiptEventV1::ReferenceRemoved,
                        asset_id: Some(edge.asset_id.clone()),
                        attempt_id: None,
                        at_ms: now_ms,
                        details: serde_json::json!({
                            "table": edge.table_name,
                            "rowId": edge.row_id,
                            "fieldPath": edge.field_path,
                            "cause": "row-delete",
                        }),
                    },
                )?;
            }
            continue;
        }
        for field in asset_fields {
            let after = match change.row.as_ref().and_then(|row| row.get(&field.name)) {
                None | Some(Value::Null) => None,
                Some(Value::String(id)) => Some(id.clone()),
                Some(_) => {
                    return Err(SnapbackError::error(
                        "SNAPBACK_ASSET_REF_UNVERIFIED",
                        "assets",
                        format!(
                            "{}.{} is a typed asset reference; the written value is not an asset id",
                            change.table, field.name
                        ),
                    ));
                }
            };
            let existing = assets::load_edge_for_field(tx, &change.table, &change.id, &field.name)?;
            let unchanged = matches!(
                (&existing, &after),
                (Some(edge), Some(id)) if edge.asset_id == *id
            ) || (existing.is_none() && after.is_none());
            if unchanged {
                continue;
            }
            if let Some(edge) = existing {
                assets::delete_reference_edge(tx, &edge, now_ms)?;
                assets::write_receipt(
                    tx,
                    &AssetReceiptV1 {
                        receipt_id: uuid::Uuid::now_v7().to_string(),
                        operation_lineage: lineage.clone(),
                        event: AssetReceiptEventV1::ReferenceRemoved,
                        asset_id: Some(edge.asset_id.clone()),
                        attempt_id: None,
                        at_ms: now_ms,
                        details: serde_json::json!({
                            "table": edge.table_name,
                            "rowId": edge.row_id,
                            "fieldPath": edge.field_path,
                            "cause": "field-change",
                        }),
                    },
                )?;
            }
            let Some(asset_id) = after else {
                continue;
            };
            let restriction = match &field.field_type {
                FieldType::AssetRef { upload, .. } => upload.as_deref(),
                _ => None,
            };
            let admission_upload = match authority.path {
                AssetWritePath::Handler => {
                    let admission = authority
                        .admissions
                        .iter()
                        .find(|admission| admission.asset_id == asset_id)
                        .ok_or_else(|| {
                            SnapbackError::error(
                                "SNAPBACK_ASSET_REF_UNVERIFIED",
                                "assets",
                                format!(
                                    "{}.{} was written without a ctx.assets.attach admission",
                                    change.table, field.name
                                ),
                            )
                        })?;
                    admission.upload.as_deref()
                }
                AssetWritePath::HostPlan | AssetWritePath::Seed => {
                    // Write paths without handler execution derive their
                    // admission from the schema-declared restriction; a
                    // restriction-less field is handler-attach-only.
                    if restriction.is_none() {
                        return Err(SnapbackError::error(
                            "SNAPBACK_ASSET_REF_UNVERIFIED",
                            "assets",
                            format!(
                                "{}.{} carries no upload restriction; only handler-side \
                                 ctx.assets.attach can admit it",
                                change.table, field.name
                            ),
                        ));
                    }
                    None
                }
            };
            let asset = assets::verify_attachment(
                tx,
                &schema.app_id,
                &asset_id,
                restriction,
                admission_upload,
                authority,
            )?;
            if let FieldType::AssetRef {
                media: Some(media), ..
            } = &field.field_type
            {
                // @ref LLP 0244#d3-vmedia-attachment-is-finalized-only-in-v1
                // — the final write lock proves ready primary bytes and their
                //   trusted kind before installing the typed reverse edge.
                if asset.availability != assets::AssetAvailability::Ready {
                    return Err(SnapbackError::error(
                        "SNAPBACK_MEDIA_ASSET_NOT_FINALIZED",
                        "assets",
                        "await asset finalization before writing a v.media() field",
                    ));
                }
                let rendition_id = asset
                    .primary_rendition_id
                    .as_deref()
                    .ok_or_else(assets::media_projection_integrity)?;
                let rendition = assets::load_rendition(tx, rendition_id)?
                    .ok_or_else(assets::media_projection_integrity)?;
                if rendition.state != assets::AssetRenditionState::Ready {
                    return Err(assets::media_projection_integrity());
                }
                let detected = rendition
                    .media_facts
                    .as_ref()
                    .and_then(|facts| facts.get("contentType"))
                    .and_then(Value::as_str)
                    .ok_or_else(assets::media_projection_integrity)?;
                let expected = assets::media_kind_for_detected_content_type(detected);
                let stored = asset
                    .media_kind
                    .ok_or_else(assets::media_projection_integrity)?;
                if stored != expected {
                    return Err(assets::media_projection_integrity());
                }
                if !media.kinds.contains(&stored) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_MEDIA_KIND_NOT_ADMITTED",
                        "assets",
                        "the finalized asset kind is not admitted by this media field",
                    ));
                }
            }
            assets::insert_reference_edge(
                tx,
                &schema.app_id,
                &asset_id,
                &change.table,
                &change.id,
                &field.name,
                now_ms,
            )?;
            assets::write_receipt(
                tx,
                &AssetReceiptV1 {
                    receipt_id: uuid::Uuid::now_v7().to_string(),
                    operation_lineage: lineage.clone(),
                    event: AssetReceiptEventV1::AttachmentCommitted,
                    asset_id: Some(asset_id.clone()),
                    attempt_id: None,
                    at_ms: now_ms,
                    details: serde_json::json!({
                        "table": change.table,
                        "rowId": change.id,
                        "fieldPath": field.name,
                        "lifecycleGeneration": asset.lifecycle_generation,
                    }),
                },
            )?;
        }
    }
    Ok(())
}

/// The asset read-authorization decision (LLP 0044 §Asset read authorization;
/// LLP 0053 dated classification 2026-07-31). Decides only through
/// `assetSharing`-declared analyzable policies; a typed reference on any
/// other table confers nothing (owner-only fallback). Returns the captured
/// dependency set — including the pinned empty-result capture over the
/// reverse-edge index range, so a first attachment moves the dependencies of
/// a decision that previously saw no edges.
pub(crate) struct AssetReadDecision {
    pub authorized: bool,
    /// The captured dependency set; consumed by the live-channel follow-up
    /// and the invalidation tests today.
    #[allow(dead_code)]
    pub dependencies: Vec<CapturedReadDependency>,
}

pub(crate) fn asset_read_authorized(
    schema: &SchemaManifest,
    tx: &Transaction<'_>,
    principal: Option<&str>,
    asset: &crate::assets::AssetRecordV1,
) -> SnapbackResult<AssetReadDecision> {
    use crate::assets::AssetReadAccessPolicy;
    let mut dependencies = vec![CapturedReadDependency {
        kind: CapturedReadKind::Auth,
        table: None,
        id: None,
        version: None,
        predicate: None,
        rows: Vec::new(),
        field: Some("principal".to_owned()),
        value: Some(match principal {
            Some(principal) => Value::String(principal.to_owned()),
            None => Value::Null,
        }),
        order: None,
        limit: None,
        result_count: None,
        boundary: None,
    }];
    let Some(principal) = principal else {
        return Ok(AssetReadDecision {
            authorized: false,
            dependencies,
        });
    };
    if principal == asset.owner_principal {
        return Ok(AssetReadDecision {
            authorized: true,
            dependencies,
        });
    }
    // First-class grant authority is independent of the asset's fallback
    // `owner-only`/`via-references` policy. Capture the empty range and the
    // state in each row key so mint, activation, and revocation all move the
    // authorization witness.
    let mut grant_statement = tx.prepare(
        "SELECT grant_id, state FROM _snapback_asset_grants_v1
         WHERE asset_id = ?1 AND principal = ?2 ORDER BY grant_id",
    )?;
    let grant_rows = grant_statement
        .query_map(rusqlite::params![asset.asset_id, principal], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    dependencies.push(CapturedReadDependency {
        kind: CapturedReadKind::Query,
        table: Some("_snapback_asset_grants_v1".to_owned()),
        id: None,
        version: None,
        predicate: Some(serde_json::json!({
            "assetId": asset.asset_id,
            "principal": principal,
        })),
        rows: grant_rows
            .iter()
            .map(|(grant_id, state)| format!("{grant_id}:{state}"))
            .collect(),
        field: Some("state".to_owned()),
        value: None,
        order: None,
        limit: None,
        result_count: Some(grant_rows.len()),
        boundary: None,
    });
    // Frozen eligibility remains part of the authority decision even if a
    // malformed restore or operator write were ever to leave a stray edge.
    if asset.grants_enabled && grant_rows.iter().any(|(_, state)| state == "active") {
        return Ok(AssetReadDecision {
            authorized: true,
            dependencies,
        });
    }
    if asset.read_access != AssetReadAccessPolicy::ViaReferences {
        return Ok(AssetReadDecision {
            authorized: false,
            dependencies,
        });
    }
    let edges = crate::assets::load_edges_for_asset(tx, &asset.asset_id)?;
    // The pinned reverse-edge range capture: empty results are first-class,
    // so the decision that saw zero edges is invalidated by the first
    // attachment (LLP 0053 §Asset read-authorization inputs).
    dependencies.push(CapturedReadDependency {
        kind: CapturedReadKind::Query,
        table: Some("_snapback_asset_reference_edges_v1".to_owned()),
        id: None,
        version: None,
        predicate: Some(serde_json::json!({ "assetId": asset.asset_id })),
        rows: edges.iter().map(|edge| edge.edge_id.clone()).collect(),
        field: None,
        value: None,
        order: None,
        limit: None,
        result_count: Some(edges.len()),
        boundary: None,
    });
    let mut authorized = false;
    for edge in &edges {
        let Some(table) = schema.table(&edge.table_name) else {
            continue;
        };
        // @ref LLP 0244#d2-kind-is-disclosed-with-field-delivery-policy-produces-denied
        // @ref LLP 0235#22-logical-plan-position-audit — a via-reference edge
        // from a future class-M media field is authority only when that exact
        // field is disclosed in this pinned transaction. The shipped subset
        // has no class-M program, so this refusal-ready branch is dormant.
        if !via_reference_edge_disclosed_v1(table, &edge.field_path, principal) {
            continue;
        }
        let Some(sharing) = table.asset_sharing.as_ref() else {
            // Mixed-table non-bypass: no sharing declaration confers nothing,
            // however broad any other visibility the table declares may be.
            continue;
        };
        match sharing {
            crate::manifest::AssetSharingManifest::PublicRead => {
                authorized = true;
            }
            crate::manifest::AssetSharingManifest::Owner { field } => {
                let row = get_document_from_tx(tx, table, &edge.row_id, u64::MAX)?;
                let matches = row
                    .as_ref()
                    .and_then(|row| row.get(field))
                    .and_then(Value::as_str)
                    == Some(principal);
                dependencies.push(CapturedReadDependency {
                    kind: if row.is_some() {
                        CapturedReadKind::Row
                    } else {
                        CapturedReadKind::MissingRow
                    },
                    table: Some(edge.table_name.clone()),
                    id: Some(edge.row_id.clone()),
                    version: None,
                    predicate: None,
                    rows: Vec::new(),
                    field: Some(field.clone()),
                    value: row.as_ref().and_then(|row| row.get(field)).cloned(),
                    order: None,
                    limit: None,
                    result_count: None,
                    boundary: None,
                });
                if matches {
                    authorized = true;
                }
            }
            crate::manifest::AssetSharingManifest::Membership { membership, roles } => {
                let Some((mtable, declaration)) =
                    crate::membership_rules::find_declaration(schema, membership)
                else {
                    continue;
                };
                let resource_binding = match declaration.resource.as_ref() {
                    Some(_) => {
                        let row = get_document_from_tx(tx, table, &edge.row_id, u64::MAX)?;
                        // The membership resource axis correlates through the
                        // referencing row's resource field when the sharing
                        // table declares one with the same name; absent that,
                        // the row id itself is the resource.
                        let resource = row
                            .and_then(|row| {
                                declaration
                                    .resource
                                    .as_ref()
                                    .and_then(|resource| row.get(resource).cloned())
                            })
                            .unwrap_or_else(|| Value::String(edge.row_id.clone()));
                        crate::membership_rules::ResourceBinding::Fixed(resource)
                    }
                    None => crate::membership_rules::ResourceBinding::AppSingleton,
                };
                let effective_roles =
                    crate::membership_rules::effective_roles(declaration, roles.as_deref());
                let probe = crate::membership_rules::membership_probe_plan(
                    declaration,
                    &mtable.name,
                    principal,
                    &resource_binding,
                    &effective_roles,
                );
                let output = DbRead::Pinned { conn: tx, schema }
                    .query_private_membership(&probe, &HandlerInput::default())?;
                let matching_ids: Vec<String> = output
                    .rows
                    .iter()
                    .filter_map(|row| row.get("_id").and_then(Value::as_str).map(str::to_owned))
                    .collect();
                let role_admits = !matching_ids.is_empty();
                // @ref LLP 0056#what-exists-what-this-adds — membership checks
                //   capture the ordinary Query probe on both outcomes, never
                //   the legacy matcher/validator-dead Permission kind.
                dependencies.push(crate::membership_rules::membership_capture_dependency(
                    &probe,
                    output.version,
                    matching_ids,
                )?);
                if role_admits {
                    authorized = true;
                }
            }
        }
    }
    Ok(AssetReadDecision {
        authorized,
        dependencies,
    })
}

fn via_reference_edge_disclosed_v1(_table: &TableManifest, _field: &str, _principal: &str) -> bool {
    true
}

/// Re-evaluate a previously captured asset read decision's dependency set.
/// Returns true when any dependency moved — the substrate the live channel
/// re-checks on governed boundaries (a first attachment moves the pinned
/// empty edge-range capture; an edge removal, row change, or membership
/// change moves its dependency the same way).
#[allow(dead_code)] // Exercised by tests; the live channel's governed-boundary re-check consumes it next.
pub(crate) fn asset_read_dependencies_moved(
    schema: &SchemaManifest,
    tx: &Transaction<'_>,
    principal: Option<&str>,
    asset: &crate::assets::AssetRecordV1,
    captured: &[CapturedReadDependency],
) -> SnapbackResult<bool> {
    let fresh = asset_read_authorized(schema, tx, principal, asset)?;
    Ok(fresh.dependencies != captured)
}

/// Creating a resource row of a `lastHolder`-protected declaration is refused
/// unless it goes through the bootstrap path (which seats the bootstrap holder
/// in the same transaction). Otherwise the establishment leg would be vacuous —
/// a protected resource could exist with no holder at all.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
///   establishment: creating a protected resource is refused unless the same
///   transaction spends its bootstrap-holder witness.
fn enforce_protected_resource_insert_guard(
    schema: &SchemaManifest,
    resource_table: &str,
) -> SnapbackResult<()> {
    for table in &schema.tables {
        let Some(membership) = &table.membership else {
            continue;
        };
        if membership.last_holder.is_none() {
            continue;
        }
        if membership.resource_table.as_deref() != Some(resource_table) {
            continue;
        }
        return Err(membership_refusal(
            "SNAPBACK_MEMBERSHIP_BOOTSTRAP_REQUIRED",
            format!(
                "creating a resource of the lastHolder-protected declaration {} requires seating \
                 its bootstrap holder in the same transaction (use the bootstrap path)",
                membership.effective_id(&table.name)
            ),
        )
        .with_detail("resourceTable", resource_table.to_owned())
        .with_detail("membershipTable", table.name.clone()));
    }
    Ok(())
}

/// Deleting a resource row does not silently orphan its memberships: refuse while
/// any membership references it. The teardown deletion witness
/// (`clearForResource`) is the only path that clears a roster, and it runs
/// `Sanctioned`, so this guard never fires on the legitimate teardown.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the host
///   refuses the resource delete while memberships remain, typed.
fn enforce_resource_delete_guard(
    schema: &SchemaManifest,
    tx: &Transaction<'_>,
    resource_table: &str,
    row_id: Option<&str>,
) -> SnapbackResult<()> {
    let Some(row_id) = row_id else {
        return Ok(());
    };
    for table in &schema.tables {
        let Some(membership) = &table.membership else {
            continue;
        };
        if membership.scope != MembershipScope::Resource {
            continue;
        }
        if membership.resource_table.as_deref() != Some(resource_table) {
            continue;
        }
        let Some(resource_column) = membership.resource.as_deref() else {
            continue;
        };
        if !sqlite_object_exists(tx, "table", &table.name)? {
            continue;
        }
        let count: i64 = tx.query_row(
            &format!(
                "SELECT COUNT(*) FROM {} WHERE {} = ?1",
                quote_ident(&table.name)?,
                quote_ident(resource_column)?
            ),
            params![row_id],
            |row| row.get(0),
        )?;
        if count > 0 {
            return Err(membership_refusal(
                "SNAPBACK_MEMBERSHIP_RESOURCE_DELETE_BLOCKED",
                format!(
                    "resource {row_id:?} still has {count} membership(s) in {}; clear the roster \
                     through teardown (clearForResource) in the same transaction",
                    table.name
                ),
            )
            .with_detail("resource", row_id.to_owned())
            .with_detail("membershipTable", table.name.clone()));
        }
    }
    Ok(())
}

fn membership_raw_write_denied(table: &str, op: MembershipGuardOp) -> SnapbackError {
    membership_refusal(
        "SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED",
        format!(
            "raw {} on declared membership table {table} is refused; membership rows are written \
             only through the host-evaluated generated methods",
            op.as_str()
        ),
    )
    .with_detail("table", table.to_owned())
    .with_detail("op", op.as_str().to_owned())
}

fn membership_hostplan_write_denied(table: &str) -> SnapbackError {
    membership_refusal(
        "SNAPBACK_MEMBERSHIP_HOSTPLAN_WRITE_DENIED",
        format!(
            "HostPlan cannot authorize a membership write in v1; every generic form targeting the \
             declared membership table {table} is refused"
        ),
    )
    .with_detail("table", table.to_owned())
}

pub(super) fn enforce_identity_binding_write_seal(
    schema: &SchemaManifest,
    table: &str,
) -> SnapbackResult<()> {
    if schema
        .identity_binding_tables
        .iter()
        .any(|binding| binding.table == table)
    {
        // @ref LLP 0214#59-relationship-to-the-guide-binding-gap —
        //   claims never confer binding authority. The seal is checked in
        //   HostPlan preflight, every HostPlan execution arm, the buffered
        //   write path, declarative seed installation, and both maintained-
        //   projection write primitives; the still-open host-invoked
        //   provisioning lane is the only intended future exception.
        // @ref LLP 0226#b-authd7-owner--principal-claims — exposed claims may
        //   inform application behavior but cannot authorize an ordinary write.
        return Err(
            crate::auth::identity_core::AuthClaimsProjection::refuse_binding_write().into(),
        );
    }
    Ok(())
}

fn membership_write_provenance(
    writer: Option<&MembershipWriter>,
) -> SnapbackResult<MembershipWriteProvenance> {
    writer
        .and_then(MembershipWriter::provenance)
        .ok_or_else(|| {
            membership_refusal(
                "SNAPBACK_MEMBERSHIP_PROVENANCE_UNAVAILABLE",
                "a provenance-enabled membership write lacks a resolved writer attribution",
            )
        })
}

fn write_membership_creation_provenance(
    tx: &Transaction<'_>,
    table: &TableManifest,
    id: &str,
    writer: Option<&MembershipWriter>,
) -> SnapbackResult<()> {
    let Some(membership) = &table.membership else {
        return Ok(());
    };
    if membership.provenance.is_none() {
        return Ok(());
    }
    let provenance = membership_write_provenance(writer)?;
    tx.execute(
        &format!(
            "UPDATE {} SET {} = ?1, {} = ?2, {} = ?3 WHERE _id = ?4",
            quote_ident(&table.name)?,
            quote_ident(MEMBERSHIP_GRANTED_BY_ACTOR)?,
            quote_ident(MEMBERSHIP_GRANTED_BY_EFFECTIVE)?,
            quote_ident(MEMBERSHIP_GRANTED_BY_GRANT)?,
        ),
        params![provenance.actor, provenance.effective, provenance.grant, id],
    )?;
    Ok(())
}

fn membership_axis_value(
    row: Option<&Value>,
    field: &str,
    label: &str,
) -> SnapbackResult<Option<String>> {
    let Some(row) = row.and_then(Value::as_object) else {
        return Ok(None);
    };
    row.get(field)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .map(Some)
        .ok_or_else(|| {
            membership_refusal(
                "SNAPBACK_MEMBERSHIP_PROVENANCE_ROW_INVALID",
                format!("membership {label} field {field:?} is absent or not a string"),
            )
        })
}

#[derive(Clone, Debug)]
struct AuthorityTransitionReceiptDraft {
    declaration: String,
    predecessor: Option<AuthorityMembershipStateV1>,
    successor: Option<AuthorityMembershipStateV1>,
    subject: String,
    scope: Option<String>,
}

impl AuthorityTransitionReceiptDraft {
    fn finish(
        self,
        invalidation_disposition: AuthorityInvalidationDispositionV1,
    ) -> AuthorityTransitionReceiptV1 {
        AuthorityTransitionReceiptV1 {
            declaration: self.declaration,
            predecessor: self.predecessor,
            successor: self.successor,
            subject: self.subject,
            scope: self.scope,
            invalidation_disposition,
        }
    }
}

fn authority_membership_state(
    membership: &MembershipManifest,
    row: Option<&Value>,
) -> SnapbackResult<Option<AuthorityMembershipStateV1>> {
    let Some(role) = membership_axis_value(row, &membership.role, "role")? else {
        return Ok(None);
    };
    let status = if membership.roles.iter().any(|candidate| candidate == &role) {
        AuthorityMembershipStatusV1::Active
    } else if membership
        .pending_roles
        .iter()
        .flatten()
        .any(|candidate| candidate == &role)
    {
        AuthorityMembershipStatusV1::Invited
    } else {
        return Err(membership_refusal(
            "SNAPBACK_MEMBERSHIP_UNKNOWN_ROLE",
            format!(
                "membership receipt encountered role {role:?} outside the declaration vocabulary"
            ),
        ));
    };
    Ok(Some(AuthorityMembershipStateV1 { role, status }))
}

fn authority_transition_receipt_draft(
    table: &TableManifest,
    before: Option<&Value>,
    after: Option<&Value>,
) -> SnapbackResult<Option<AuthorityTransitionReceiptDraft>> {
    let Some(membership) = &table.membership else {
        return Ok(None);
    };
    let subject = membership_axis_value(after.or(before), &membership.principal, "principal")?
        .ok_or_else(|| {
            membership_refusal(
                "SNAPBACK_MEMBERSHIP_PROVENANCE_ROW_INVALID",
                "membership receipt lacks a predecessor and successor subject",
            )
        })?;
    let scope = match &membership.resource {
        Some(field) => membership_axis_value(after.or(before), field, "resource")?,
        None => None,
    };
    Ok(Some(AuthorityTransitionReceiptDraft {
        declaration: membership.effective_id(&table.name).to_owned(),
        predecessor: authority_membership_state(membership, before)?,
        successor: authority_membership_state(membership, after)?,
        subject,
        scope,
    }))
}

#[allow(clippy::too_many_arguments)]
fn record_membership_transition(
    tx: &Transaction<'_>,
    table: &TableManifest,
    op: ChangeOp,
    before: Option<&Value>,
    after: Option<&Value>,
    changed_fields: &[String],
    commit_version: u64,
    writer: Option<&MembershipWriter>,
) -> SnapbackResult<()> {
    let Some(membership) = &table.membership else {
        return Ok(());
    };
    if membership.provenance != Some(MembershipProvenance::Full) {
        return Ok(());
    }
    if op == ChangeOp::Update
        && changed_fields
            .iter()
            .all(|field| !table.field_affects_authorization(field))
    {
        return Ok(());
    }
    let provenance = membership_write_provenance(writer)?;
    let current = after.or(before);
    let principal = membership_axis_value(current, &membership.principal, "principal")?
        .expect("membership transition has a row image");
    let resource = membership
        .resource
        .as_deref()
        .map(|field| membership_axis_value(current, field, "resource"))
        .transpose()?
        .flatten();
    let from_role = membership_axis_value(before, &membership.role, "role")?;
    let to_role = membership_axis_value(after, &membership.role, "role")?;
    let op = match op {
        ChangeOp::Insert => "insert",
        ChangeOp::Delete => "remove",
        ChangeOp::Update if changed_fields.contains(&membership.role) => "setRole",
        ChangeOp::Update => "patch",
    };
    tx.execute(
        "INSERT INTO _snapback_membership_transitions(
           declaration_id, op, principal, resource, from_role, to_role,
           actor, effective, grant_id, commit_version, writer_class
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            membership.effective_id(&table.name),
            op,
            principal,
            resource,
            from_role,
            to_role,
            provenance.actor,
            provenance.effective,
            provenance.grant,
            commit_version,
            provenance.writer_class,
        ],
    )?;
    Ok(())
}

fn insert_document(
    tx: &Transaction<'_>,
    table: &TableManifest,
    id: &str,
    row: &Map<String, Value>,
    version: u64,
    now_ms: u64,
    order_field_bounds: &BTreeMap<(String, String), u64>,
) -> SnapbackResult<Value> {
    for key in row.keys() {
        if is_system_field(key) {
            return Err(SnapbackError::error(
                "SNAPBACK_SYSTEM_FIELD_WRITE",
                "storage",
                format!("{key} is managed by Snapback"),
            ));
        }
        let field = ensure_field(table, key)?;
        if matches!(field.field_type, FieldType::RelationIncarnation { .. }) {
            return Err(relation_incarnation_write_protected(table, key));
        }
    }

    let relation_stamps = resolve_relation_stamps(tx, table, row)?;
    let mut document = Map::new();
    document.insert("_id".to_owned(), Value::String(id.to_owned()));
    document.insert("_version".to_owned(), json!(version));
    document.insert("_createdAt".to_owned(), json!(now_ms));
    document.insert("_updatedAt".to_owned(), json!(now_ms));

    let mut columns = vec![
        "_id".to_owned(),
        "_version".to_owned(),
        "_createdAt".to_owned(),
        "_updatedAt".to_owned(),
    ];
    let mut values = vec![
        SqlValue::Text(id.to_owned()),
        SqlValue::Integer(version_to_sql_integer(version)?),
        SqlValue::Integer(timestamp_to_sql_millis(now_ms)?),
        SqlValue::Integer(timestamp_to_sql_millis(now_ms)?),
    ];
    let mut structured_bytes = 0_usize;

    for field in &table.fields {
        let value = match relation_stamps
            .get(&field.name)
            .or_else(|| row.get(&field.name))
        {
            Some(value) => {
                validate_declared_field_value(field, value)?;
                validate_order_field_bound(order_field_bounds, table, id, field, value)?;
                value.clone()
            }
            None if field.optional => Value::Null,
            None => {
                return Err(SnapbackError::error(
                    "SNAPBACK_FIELD_MISSING",
                    "storage",
                    format!("required field {}.{} is missing", table.name, field.name),
                ));
            }
        };
        let (normalized, sql_value, bytes) =
            prepare_declared_field_value(&table.name, field, &value)?;
        structured_bytes = structured_bytes.saturating_add(bytes);
        values.push(sql_value);
        columns.push(field.name.clone());
        document.insert(field.name.clone(), normalized);
    }
    if structured_bytes > MAX_STORED_STRUCTURED_ROW_BYTES {
        return Err(SnapbackError::error(
            "SNAPBACK_STRUCTURED_ROW_BYTES_EXCEEDED",
            "storage",
            "row exceeds the aggregate structured canonical-byte ceiling",
        )
        .with_detail("table", table.name.clone())
        .with_detail("path", "")
        .with_detail("actualBytes", structured_bytes as u64)
        .with_detail("maxBytes", MAX_STORED_STRUCTURED_ROW_BYTES as u64));
    }

    let placeholders = (0..columns.len())
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");
    let quoted_columns = columns
        .iter()
        .map(|column| quote_ident(column))
        .collect::<SnapbackResult<Vec<_>>>()?
        .join(", ");
    let mut statement = tx.prepare_cached(&format!(
        "INSERT INTO {} ({quoted_columns}) VALUES ({placeholders})",
        quote_ident(&table.name)?
    ))?;
    statement
        .execute(params_from_iter(values.iter()))
        .map_err(map_unique_constraint_error)?;
    activate_relation_incarnation(tx, &table.name, id)?;

    Ok(Value::Object(document))
}

fn order_field_max_encoded_bytes_exceeded(
    table: &str,
    field: &str,
    row_id: &str,
    maximum: u64,
) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED",
        "storage",
        "string or id order field exceeds its declared UTF-8 byte ceiling",
    )
    .with_details(json!({
        "table": table,
        "field": field,
        "rowId": row_id,
        "maxEncodedBytes": maximum,
    }))
}

fn validate_order_field_bound(
    bounds: &BTreeMap<(String, String), u64>,
    table: &TableManifest,
    row_id: &str,
    field: &crate::manifest::FieldManifest,
    value: &Value,
) -> SnapbackResult<()> {
    let Some(maximum) = bounds.get(&(table.name.clone(), field.name.clone())) else {
        return Ok(());
    };
    let encoded_bytes = match value {
        Value::Null if field.optional => return Ok(()),
        Value::String(value) => value.len() as u64,
        _ => return Ok(()), // Declared-field validation owns the type refusal.
    };
    if encoded_bytes > *maximum {
        return Err(order_field_max_encoded_bytes_exceeded(
            &table.name,
            &field.name,
            row_id,
            *maximum,
        ));
    }
    Ok(())
}

fn relation_incarnation_write_protected(table: &TableManifest, field: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_RELATION_INCARNATION_WRITE_PROTECTED",
        "storage",
        format!(
            "{}.{} is a framework-owned relation-incarnation stamp",
            table.name, field
        ),
    )
    .with_detail("table", table.name.clone())
    .with_detail("field", field.to_owned())
}

/// Resolve every protected child stamp from an actually-present parent and its
/// one active registry incarnation. A registry row alone is insufficient:
/// parent delete has no referential action, and a dangling/buffered-pending
/// child write must refuse at the write boundary.
///
/// @ref LLP 0110#protected-relation-incarnation-and-stamping — central
/// writers stamp, and missing/inactive parents fail with one public outcome.
fn resolve_relation_stamps(
    tx: &Transaction<'_>,
    table: &TableManifest,
    values: &Map<String, Value>,
) -> SnapbackResult<BTreeMap<String, Value>> {
    let mut resolved = BTreeMap::new();
    for field in &table.fields {
        let FieldType::RelationIncarnation {
            foreign_key_field,
            parent_table,
        } = &field.field_type
        else {
            continue;
        };
        let parent_id = values
            .get(foreign_key_field)
            .and_then(Value::as_str)
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_RELATION_FOREIGN_KEY_INVALID",
                    "storage",
                    format!(
                        "{}.{} must be a nonempty parent id before {} can be stamped",
                        table.name, foreign_key_field, field.name
                    ),
                )
                .with_detail("table", table.name.clone())
                .with_detail("field", foreign_key_field.clone())
            })?;
        let parent_exists = tx
            .query_row(
                &format!(
                    "SELECT 1 FROM {} WHERE _id = ?1",
                    quote_ident(parent_table)?
                ),
                params![parent_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        let incarnation = tx
            .query_row(
                "SELECT incarnation
                   FROM _snapback_relation_incarnations_v1
                  WHERE table_name = ?1 AND row_id = ?2 AND active = 1",
                params![parent_table, parent_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if !parent_exists || incarnation.is_none() {
            return Err(SnapbackError::error(
                "SNAPBACK_RELATION_PARENT_UNAVAILABLE",
                "storage",
                "relation parent is missing or inactive",
            )
            .with_details(json!({
                "childTable": table.name,
                "foreignKeyField": foreign_key_field,
                "parentTable": parent_table,
            })));
        }
        resolved.insert(
            field.name.clone(),
            Value::String(incarnation.expect("checked above")),
        );
    }
    Ok(resolved)
}

fn activate_relation_incarnation(
    tx: &Transaction<'_>,
    table: &str,
    id: &str,
) -> SnapbackResult<String> {
    let sequence_enrolled = tx
        .query_row(
            "SELECT 1 FROM _snapback_sequence_scope_enrollments_v1 WHERE table_name = ?1",
            params![table],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if sequence_enrolled && !replay_opaque_id_is_valid(id) {
        return Err(SnapbackError::error(
            "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
            "storage",
            "sequence scope row id is outside the durable replay grammar",
        )
        .with_details(json!({
            "scopeTable": table,
            "scopeRowId": id,
        })));
    }
    // A predecessor binary cannot clear protected tables introduced after it
    // shipped. Its legacy reset still deletes the application row and rotates
    // the data stream, so a later insert of that row id must retire the stale
    // active stamp before creating the successor incarnation.
    //
    // @ref LLP 0110#protected-relation-incarnation-and-stamping — one active
    // incarnation belongs to the actually-present parent row; delete/recreate
    // always receives a fresh value and never revives predecessor children.
    tx.execute(
        "UPDATE _snapback_relation_incarnations_v1
            SET active = 0
          WHERE table_name = ?1 AND row_id = ?2 AND active = 1",
        params![table, id],
    )?;
    let incarnation = Uuid::now_v7().to_string();
    tx.execute(
        "INSERT INTO _snapback_relation_incarnations_v1(
           table_name, row_id, incarnation, active
         ) VALUES (?1, ?2, ?3, 1)",
        params![table, id, incarnation],
    )
    .map_err(map_unique_constraint_error)?;
    Ok(incarnation)
}

fn deactivate_relation_incarnation(
    tx: &Transaction<'_>,
    table: &str,
    id: &str,
) -> SnapbackResult<()> {
    tx.execute(
        "UPDATE _snapback_relation_incarnations_v1
            SET active = 0
          WHERE table_name = ?1 AND row_id = ?2 AND active = 1",
        params![table, id],
    )?;
    Ok(())
}

/// Read the one allocation that a generated host plan will advance inside its
/// already-open immediate transaction. Unlike the handler path, there is no
/// await window here: preview and compare-and-swap both happen on `tx`.
///
/// @ref LLP 0135#12-allocation-surfaces — generated write-with-activity plans
///   allocate only after their admitted existing-owner proof and commit the
///   counter beside the application writes.
fn preview_sequence_allocation_on(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    counter: &str,
    scope_table: &str,
    scope_row_id: &str,
) -> SnapbackResult<SequenceAllocationFact> {
    let scope = schema_table(schema, scope_table)?;
    let scope_exists = tx
        .query_row(
            &format!("SELECT 1 FROM {} WHERE _id = ?1", quote_ident(&scope.name)?),
            params![scope_row_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    let scope_incarnation = tx
        .query_row(
            "SELECT incarnation
               FROM _snapback_relation_incarnations_v1
              WHERE table_name = ?1 AND row_id = ?2 AND active = 1",
            params![scope_table, scope_row_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if !scope_exists || scope_incarnation.is_none() {
        return Err(SnapbackError::error(
            "SNAPBACK_RELATION_PARENT_UNAVAILABLE",
            "storage",
            "relation parent is missing or inactive",
        ));
    }
    let scope_incarnation = scope_incarnation.expect("checked above");
    let stored = tx
        .query_row(
            "SELECT next_value
               FROM _snapback_sequence_counters_v1
              WHERE counter_name = ?1
                AND scope_table = ?2
                AND scope_row_id = ?3
                AND scope_incarnation = ?4",
            params![counter, scope_table, scope_row_id, scope_incarnation],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(1);
    let value = u64::try_from(stored).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
            "storage",
            "sequence counter state is outside the non-negative integer domain",
        )
    })?;
    if value > SEQUENCE_MAX_SAFE_INTEGER {
        return Err(SnapbackError::error(
            "SNAPBACK_SEQUENCE_EXHAUSTED",
            "storage",
            "sequence counter has exhausted the JavaScript-safe integer domain",
        ));
    }
    let allocation = SequenceAllocationFact {
        counter: counter.to_owned(),
        scope_table: scope_table.to_owned(),
        scope_row_id: scope_row_id.to_owned(),
        scope_incarnation,
        value,
    };
    validate_sequence_allocation_fact(&allocation)?;
    Ok(allocation)
}

fn sequence_scope_tables_from_declarations(
    declarations: &BTreeMap<String, crate::manifest::SequenceDeclaration>,
) -> BTreeSet<&str> {
    declarations
        .values()
        .map(|declaration| declaration.scope_table.as_str())
        .collect()
}

pub(super) fn schema_relation_parent_tables(schema: &SchemaManifest) -> BTreeSet<&str> {
    schema
        .tables
        .iter()
        .flat_map(|table| table.fields.iter())
        .filter_map(|field| match &field.field_type {
            FieldType::RelationIncarnation { parent_table, .. } => Some(parent_table.as_str()),
            _ => None,
        })
        .collect()
}

/// Establish durable adoption authority for function-declared sequence scope
/// tables. A table already participating in the in-memory predecessor may be
/// grandfathered during this additive migration; a genuinely new scope can
/// auto-enroll only while physically empty. Incidental incarnation rows from
/// ordinary writes never constitute reviewed adoption authority.
///
/// @ref LLP 0135#11-counter-identity-and-scope — brownfield sequence scopes
///   require a reviewed enrollment marker before activation.
pub(super) fn preflight_sequence_enrollments(
    tx: &Transaction<'_>,
    successor_schema: &SchemaManifest,
    trusted_relation_parent_tables: &BTreeSet<String>,
    predecessor: &BTreeMap<String, crate::manifest::SequenceDeclaration>,
    successor: &BTreeMap<String, crate::manifest::SequenceDeclaration>,
) -> SnapbackResult<()> {
    let predecessor_tables = sequence_scope_tables_from_declarations(predecessor);
    let successor_tables = sequence_scope_tables_from_declarations(successor);
    for table in &successor_tables {
        schema_table(successor_schema, table)?;
        let enrolled = tx
            .query_row(
                "SELECT 1 FROM _snapback_sequence_scope_enrollments_v1 WHERE table_name = ?1",
                params![table],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if enrolled {
            continue;
        }
        let existing_rows = tx.query_row(
            &format!("SELECT COUNT(*) FROM {}", quote_ident(table)?),
            [],
            |row| row.get::<_, i64>(0),
        )?;
        let enrolled_by = if predecessor_tables.contains(table) {
            "predecessor-function-manifest"
        } else if trusted_relation_parent_tables.contains(*table) {
            "relation-manifest"
        } else if existing_rows == 0 {
            "empty-table"
        } else {
            return Err(SnapbackError::error(
                "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED",
                "schema",
                "a newly enrolled sequence scope has pre-existing rows without reviewed backfill authority",
            )
            .with_details(json!({
                "parentTable": table,
                "existingRows": existing_rows,
                "enrollmentMarker": false,
            })));
        };
        tx.execute(
            "INSERT INTO _snapback_sequence_scope_enrollments_v1(table_name, enrolled_by)
             VALUES(?1, ?2)",
            params![table, enrolled_by],
        )?;
    }

    let mut statement =
        tx.prepare("SELECT table_name FROM _snapback_sequence_scope_enrollments_v1")?;
    let existing = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    for table in existing {
        if !successor_tables.contains(table.as_str()) {
            tx.execute(
                "DELETE FROM _snapback_sequence_scope_enrollments_v1 WHERE table_name = ?1",
                params![table],
            )?;
        }
    }
    Ok(())
}

/// Validate both directions of current scope/incarnation state plus every
/// protected counter row against the exact active function declaration set.
/// This runs at activation and detached restore; removed or retargeted
/// counters require an explicit reviewed migration and cannot be re-adopted.
fn validate_active_sequence_scope_fact_grammar(
    conn: &Connection,
    table: &str,
) -> SnapbackResult<()> {
    let table_sql = quote_ident(table)?;
    let mut statement = conn.prepare(&format!(
        "SELECT s._id, r.incarnation
           FROM {table_sql} s
           JOIN _snapback_relation_incarnations_v1 r
             ON r.table_name = ?1
            AND r.row_id = s._id
            AND r.active = 1"
    ))?;
    let rows = statement.query_map(params![table], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (row_id, incarnation) = row?;
        if !replay_opaque_id_is_valid(&row_id) || !crate::ids::is_canonical_uuid_v7(&incarnation) {
            return Err(SnapbackError::error(
                "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED",
                "schema",
                "sequence scope identity is outside the durable replay grammar",
            )
            .with_details(json!({
                "scopeTable": table,
                "rowId": row_id,
                "scopeReplayable": replay_opaque_id_is_valid(&row_id),
                "incarnationCanonical": crate::ids::is_canonical_uuid_v7(&incarnation),
            })));
        }
    }
    Ok(())
}

pub(super) fn validate_sequence_activation(
    conn: &Connection,
    schema: &SchemaManifest,
    declarations: &BTreeMap<String, crate::manifest::SequenceDeclaration>,
) -> SnapbackResult<()> {
    for table in sequence_scope_tables_from_declarations(declarations) {
        schema_table(schema, table)?;
        let enrolled = conn
            .query_row(
                "SELECT 1 FROM _snapback_sequence_scope_enrollments_v1 WHERE table_name = ?1",
                params![table],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !enrolled {
            return Err(SnapbackError::error(
                "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED",
                "schema",
                "sequence scope lacks a reviewed enrollment marker",
            )
            .with_detail("parentTable", table.to_owned()));
        }
        let table_sql = quote_ident(table)?;
        let missing_or_duplicate_active = conn
            .query_row(
                &format!(
                    "SELECT s._id
                       FROM {table_sql} s
                  LEFT JOIN _snapback_relation_incarnations_v1 r
                         ON r.table_name = ?1
                        AND r.row_id = s._id
                        AND r.active = 1
                   GROUP BY s._id
                     HAVING count(r.incarnation) != 1
                      LIMIT 1"
                ),
                params![table],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(row_id) = missing_or_duplicate_active {
            return Err(SnapbackError::error(
                "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED",
                "schema",
                "each sequence scope row must have exactly one active incarnation",
            )
            .with_details(json!({
                "parentTable": table,
                "rowId": row_id,
                "direction": "scope-to-registry",
            })));
        }
        let dangling_active = conn
            .query_row(
                &format!(
                    "SELECT r.row_id
                       FROM _snapback_relation_incarnations_v1 r
                  LEFT JOIN {table_sql} s ON s._id = r.row_id
                      WHERE r.table_name = ?1
                        AND r.active = 1
                        AND s._id IS NULL
                      LIMIT 1"
                ),
                params![table],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(row_id) = dangling_active {
            return Err(SnapbackError::error(
                "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED",
                "schema",
                "an active sequence scope incarnation has no present row",
            )
            .with_details(json!({
                "parentTable": table,
                "rowId": row_id,
                "direction": "registry-to-scope",
            })));
        }
        validate_active_sequence_scope_fact_grammar(conn, table)?;
    }

    validate_sequence_counter_rows(conn, declarations)
}

fn validate_sequence_counter_rows(
    conn: &Connection,
    declarations: &BTreeMap<String, crate::manifest::SequenceDeclaration>,
) -> SnapbackResult<()> {
    let declared = declarations
        .values()
        .map(|declaration| (declaration.name.as_str(), declaration.scope_table.as_str()))
        .collect::<BTreeSet<_>>();
    let mut statement = conn.prepare(
        "SELECT c.counter_name, c.scope_table, c.scope_row_id, c.scope_incarnation,
                c.next_value, r.incarnation IS NOT NULL
           FROM _snapback_sequence_counters_v1 c
      LEFT JOIN _snapback_relation_incarnations_v1 r
             ON r.table_name = c.scope_table
            AND r.row_id = c.scope_row_id
            AND r.incarnation = c.scope_incarnation",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, bool>(5)?,
        ))
    })?;
    for row in rows {
        let (counter, scope_table, scope_row_id, scope_incarnation, next_value, registry_backed) =
            row?;
        let declared = declared.contains(&(counter.as_str(), scope_table.as_str()));
        let successor_in_domain = u64::try_from(next_value)
            .is_ok_and(|value| (1..=SEQUENCE_MAX_SAFE_INTEGER + 1).contains(&value));
        let scope_replayable = replay_opaque_id_is_valid(&scope_row_id);
        let incarnation_canonical = crate::ids::is_canonical_uuid_v7(&scope_incarnation);
        if !declared
            || !successor_in_domain
            || !registry_backed
            || !scope_replayable
            || !incarnation_canonical
        {
            return Err(SnapbackError::error(
                "SNAPBACK_SEQUENCE_ACTIVATION_STATE_INVALID",
                "schema",
                "protected sequence state does not match the active function declaration scope",
            )
            .with_details(json!({
                "counter": counter,
                "scopeTable": scope_table,
                "scopeRowId": scope_row_id,
                "scopeIncarnation": scope_incarnation,
                "nextValue": next_value,
                "declared": declared,
                "registryBacked": registry_backed,
                "scopeReplayable": scope_replayable,
                "incarnationCanonical": incarnation_canonical,
            })));
        }
    }
    Ok(())
}

pub(super) fn sequence_declarations_from_function_manifest(
    manifest: &crate::manifest::FunctionManifest,
) -> BTreeMap<String, crate::manifest::SequenceDeclaration> {
    manifest
        .functions
        .iter()
        .flat_map(|function| function.sequences.iter().cloned())
        .map(|declaration| (declaration.name.clone(), declaration))
        .collect()
}

/// Validate and advance every tentative sequence value under the same
/// immediate transaction as its application writes. SQLite's writer
/// serialization is the local target's per-scope serialization mechanism;
/// the full identity predicate keeps the rule portable to a future
/// multi-writer compare-and-swap implementation.
///
/// @ref LLP 0135#12-allocation-surfaces — buffered RMW, captured-current at
///   commit, with no durable trace on failure.
/// @ref LLP 0135#15-exhaustion — MAX_SAFE_INTEGER is allocatable and leaves
///   the exactly-representable durable exhausted next value 2^53.
fn apply_sequence_allocations_in_tx(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    allocations: &[SequenceAllocationFact],
) -> SnapbackResult<()> {
    for allocation in allocations {
        if allocation.value > SEQUENCE_MAX_SAFE_INTEGER {
            return Err(SnapbackError::error(
                "SNAPBACK_SEQUENCE_EXHAUSTED",
                "storage",
                "sequence counter has exhausted the JavaScript-safe integer domain",
            ));
        }
        validate_sequence_allocation_fact(allocation)?;
        let scope = schema_table(schema, &allocation.scope_table)?;
        let scope_exists = tx
            .query_row(
                &format!("SELECT 1 FROM {} WHERE _id = ?1", quote_ident(&scope.name)?),
                params![allocation.scope_row_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        let active_incarnation = tx
            .query_row(
                "SELECT incarnation
                   FROM _snapback_relation_incarnations_v1
                  WHERE table_name = ?1 AND row_id = ?2 AND active = 1",
                params![allocation.scope_table, allocation.scope_row_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if !scope_exists
            || active_incarnation.as_deref() != Some(allocation.scope_incarnation.as_str())
        {
            return Err(SnapbackError::error(
                "SNAPBACK_RELATION_PARENT_UNAVAILABLE",
                "storage",
                "relation parent is missing or inactive",
            ));
        }
        let stored = tx
            .query_row(
                "SELECT next_value
                   FROM _snapback_sequence_counters_v1
                  WHERE counter_name = ?1
                    AND scope_table = ?2
                    AND scope_row_id = ?3
                    AND scope_incarnation = ?4",
                params![
                    allocation.counter,
                    allocation.scope_table,
                    allocation.scope_row_id,
                    allocation.scope_incarnation
                ],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        let expected = i64::try_from(allocation.value).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_SEQUENCE_EXHAUSTED",
                "storage",
                "sequence value exceeds the storage integer domain",
            )
        })?;
        if stored.unwrap_or(1) != expected {
            return Err(SnapbackError::error(
                "SNAPBACK_MUTATION_CONFLICT",
                "storage",
                "sequence counter changed since handler execution",
            ));
        }
        let next = expected + 1;
        match stored {
            None => {
                tx.execute(
                    "INSERT INTO _snapback_sequence_counters_v1(
                       counter_name, scope_table, scope_row_id, scope_incarnation, next_value
                     ) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        allocation.counter,
                        allocation.scope_table,
                        allocation.scope_row_id,
                        allocation.scope_incarnation,
                        next
                    ],
                )?;
            }
            Some(_) => {
                let changed = tx.execute(
                    "UPDATE _snapback_sequence_counters_v1
                        SET next_value = ?5
                      WHERE counter_name = ?1
                        AND scope_table = ?2
                        AND scope_row_id = ?3
                        AND scope_incarnation = ?4
                        AND next_value = ?6",
                    params![
                        allocation.counter,
                        allocation.scope_table,
                        allocation.scope_row_id,
                        allocation.scope_incarnation,
                        next,
                        expected
                    ],
                )?;
                if changed != 1 {
                    return Err(SnapbackError::error(
                        "SNAPBACK_MUTATION_CONFLICT",
                        "storage",
                        "sequence counter changed during commit",
                    ));
                }
            }
        }
    }
    Ok(())
}

/// Reclassify a SQLite UNIQUE-constraint failure into a stable, typed
/// conflict. This is error *typing*, not write authorization: it does not
/// change who may write, only how the exactly-one-wins outcome of a true-unique
/// index surfaces. Both an ordinary declared key (LLP 0007) and LLP 0056's
/// generated `(principal, resource)` key therefore yield exactly one row and
/// this one typed conflict when duplicate inserts race.
///
/// @ref LLP 0007#index-contract — ordinary declared uniqueness uses the same
///   stable conflict at activation and commit.
/// @ref LLP 0056#declaring-a-membership-table — exactly-one-wins on concurrent
///   same-pair inserts is delivered by the unique index at serialized commit.
fn map_unique_constraint_error(error: rusqlite::Error) -> SnapbackError {
    if let rusqlite::Error::SqliteFailure(failure, message) = &error
        && failure.code == rusqlite::ErrorCode::ConstraintViolation
    {
        let text = message.clone().unwrap_or_default();
        if text.contains("UNIQUE") {
            return SnapbackError::error(
                "SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION",
                "storage",
                "write violates a unique index (one row per declared key)",
            )
            .with_detail("error", text);
        }
    }
    SnapbackError::from(error)
}

fn patch_document(
    tx: &Transaction<'_>,
    table: &TableManifest,
    id: &str,
    row: &Map<String, Value>,
    version: u64,
    now_ms: u64,
    order_field_bounds: &BTreeMap<(String, String), u64>,
) -> SnapbackResult<bool> {
    // Validate the authored patch before consulting the target row. Missing
    // rows remain soft no-ops only for structurally valid patches, and the
    // same ordered field walk fixes diagnostic precedence for every target.
    for (field, value) in row {
        if is_system_field(field) {
            return Err(SnapbackError::error(
                "SNAPBACK_SYSTEM_FIELD_WRITE",
                "storage",
                format!("{field} is managed by Snapback"),
            ));
        }
        let field_manifest = ensure_field(table, field)?;
        if matches!(
            field_manifest.field_type,
            FieldType::RelationIncarnation { .. }
        ) {
            return Err(relation_incarnation_write_protected(table, field));
        }
        validate_declared_field_value(field_manifest, value)?;
        prepare_declared_field_value(&table.name, field_manifest, value)?;
    }

    let current = get_document_from_tx(tx, table, id, version)?;
    let Some(current) = current.and_then(|value| value.as_object().cloned()) else {
        return Ok(false);
    };
    let mut authored = row.clone();
    // A foreign-key patch always re-derives its protected stamp. Unchanged
    // foreign keys preserve the stamp without consulting the parent.
    let relation_input = table
        .fields
        .iter()
        .filter(|field| match &field.field_type {
            FieldType::RelationIncarnation {
                foreign_key_field, ..
            } => authored.contains_key(foreign_key_field),
            _ => false,
        })
        .map(|field| {
            let FieldType::RelationIncarnation {
                foreign_key_field, ..
            } = &field.field_type
            else {
                unreachable!()
            };
            (
                field.name.clone(),
                foreign_key_field.clone(),
                authored.get(foreign_key_field).cloned(),
            )
        })
        .collect::<Vec<_>>();
    if !relation_input.is_empty() {
        let mut complete_relation_values = current.clone();
        complete_relation_values.extend(authored.clone());
        let stamps = resolve_relation_stamps(tx, table, &complete_relation_values)?;
        for (stamp_field, _, _) in relation_input {
            if let Some(stamp) = stamps.get(&stamp_field) {
                authored.insert(stamp_field, stamp.clone());
            }
        }
    }
    let mut normalized_authored = Map::new();
    let mut prepared_sql = BTreeMap::new();
    for (field_name, value) in &authored {
        let field_manifest = ensure_field(table, field_name)?;
        let (normalized, sql_value, _) =
            prepare_declared_field_value(&table.name, field_manifest, value)?;
        normalized_authored.insert(field_name.clone(), normalized);
        prepared_sql.insert(field_name.clone(), sql_value);
    }
    let mut candidate = current.clone();
    candidate.extend(normalized_authored.clone());
    validate_structured_row_aggregate(table, &candidate)?;
    // A patch is a source effect only when its persisted application fields
    // differ exactly. Empty and storage-equal patches are both no-ops.
    if normalized_authored
        .iter()
        .all(|(field, value)| current.get(field) == Some(value))
    {
        return Ok(false);
    }
    let mut assignments = vec!["_version = ?".to_owned(), "_updatedAt = ?".to_owned()];
    let mut values = vec![
        SqlValue::Integer(version_to_sql_integer(version)?),
        SqlValue::Integer(timestamp_to_sql_millis(now_ms)?),
    ];

    for (field, value) in &normalized_authored {
        if is_system_field(field) {
            return Err(SnapbackError::error(
                "SNAPBACK_SYSTEM_FIELD_WRITE",
                "storage",
                format!("{field} is managed by Snapback"),
            ));
        }
        let field_manifest = ensure_field(table, field)?;
        validate_declared_field_value(field_manifest, value)?;
        validate_order_field_bound(order_field_bounds, table, id, field_manifest, value)?;
        assignments.push(format!("{} = ?", quote_ident(field)?));
        values.push(
            prepared_sql
                .remove(field)
                .expect("normalized authored field carries prepared SQL"),
        );
    }
    values.push(SqlValue::Text(id.to_owned()));

    let mut statement = tx.prepare_cached(&format!(
        "UPDATE {} SET {} WHERE _id = ?",
        quote_ident(&table.name)?,
        assignments.join(", ")
    ))?;
    statement
        .execute(params_from_iter(values.iter()))
        .map_err(map_unique_constraint_error)?;
    Ok(true)
}

fn delete_document(tx: &Transaction<'_>, table: &TableManifest, id: &str) -> SnapbackResult<bool> {
    let mut statement = tx.prepare_cached(&format!(
        "DELETE FROM {} WHERE _id = ?1",
        quote_ident(&table.name)?
    ))?;
    let changed = statement.execute(params![id])?;
    if changed > 0 {
        deactivate_relation_incarnation(tx, &table.name, id)?;
    }
    Ok(changed > 0)
}

fn get_document_from_tx(
    tx: &Transaction<'_>,
    table: &TableManifest,
    id: &str,
    maximum: u64,
) -> SnapbackResult<Option<Value>> {
    let sql = format!("SELECT * FROM {} WHERE _id = ?1", quote_ident(&table.name)?);
    let mut statement = tx.prepare_cached(&sql)?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut rows = statement.query(params![id])?;
    if let Some(row) = rows.next()? {
        let document = row_to_document(row, table, &columns)?;
        validate_document_version_at_most(&document, maximum, &table.name)?;
        Ok(Some(document))
    } else {
        Ok(None)
    }
}

#[derive(Clone)]
struct AssetCollectionStoredItem {
    id: String,
    asset_id: String,
    ordinal: usize,
    document: Value,
}

fn asset_collection_error(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "asset-collection", message)
}

fn collection_descriptor_for_plan<'a>(
    schema: &'a SchemaManifest,
    plan: &AssetCollectionMutationPlanV1,
) -> SnapbackResult<&'a crate::manifest::AssetCollectionManifestV1> {
    use crate::manifest::AssetCollectionOrderV1;
    let descriptor = schema
        .asset_collections
        .iter()
        .find(|collection| collection.name == plan.collection)
        .ok_or_else(|| {
            asset_collection_error(
                "SNAPBACK_MEDIA_COLLECTION_MANIFEST_INVALID",
                "collection mutation names no active descriptor",
            )
        })?;
    let order = match descriptor.order {
        AssetCollectionOrderV1::Manual => "manual",
        AssetCollectionOrderV1::Created => "created",
    };
    let sharing_arg =
        (!matches!(plan.operation, AssetCollectionOperationV1::Reorder)).then_some("sharing");
    let sharing_derivation_tables = descriptor
        .sharing
        .ceiling
        .iter()
        .filter_map(|entry| match &entry.plan {
            crate::manifest::AssetCollectionSharingPlanV1::Derived { table, .. } => {
                Some(table.clone())
            }
            _ => None,
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let sharing_grant_capable = descriptor.sharing.ceiling.iter().any(|entry| {
        matches!(
            entry.plan,
            crate::manifest::AssetCollectionSharingPlanV1::Recipients { .. }
                | crate::manifest::AssetCollectionSharingPlanV1::Derived { .. }
        )
    });
    if plan.generation != descriptor.generation
        || plan.policy_generation != descriptor.generation
        || plan.owner_table != descriptor.owner_table
        || plan.owner_field != descriptor.owner_field
        || plan.child_table != descriptor.child_table
        || plan.parent_id_arg != "parentId"
        || plan.max_items != descriptor.max_items
        || plan.order != order
        || plan.intent != descriptor.intent
        || plan.kinds != descriptor.kinds
        || plan.duplicate_policy != "refuse.v1"
        || plan.sharing_arg.as_deref() != sharing_arg
        || plan.default_sharing_plan != descriptor.sharing.default_plan
        || plan.sharing_derivation_tables != sharing_derivation_tables
        || plan.sharing_grant_capable != sharing_grant_capable
    {
        return Err(asset_collection_error(
            "SNAPBACK_MEDIA_COLLECTION_MANIFEST_INVALID",
            "collection mutation drifted from its active digest-bound descriptor",
        ));
    }
    Ok(descriptor)
}

fn asset_collection_attempt_item_id(
    child_table: &str,
    generation: &str,
    attempt_digest: &str,
    ordinal: usize,
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"snapback:asset-collection-item-id:v1\n");
    let ordinal = ordinal.to_string();
    for part in [generation, attempt_digest, ordinal.as_str()] {
        digest.update((part.len() as u64).to_be_bytes());
        digest.update(part.as_bytes());
    }
    let bytes = digest.finalize();
    let mut body = [0_u8; 16];
    body.copy_from_slice(&bytes[..16]);
    format!(
        "{}_{}",
        crate::ids::table_prefix(child_table),
        crate::ids::encode_body(&body)
    )
}

fn load_asset_collection_items(
    tx: &Transaction<'_>,
    table: &TableManifest,
    parent_table: &str,
    parent_id: &str,
    maximum_version: u64,
) -> SnapbackResult<Vec<AssetCollectionStoredItem>> {
    let sql = format!(
        "SELECT * FROM {} \
          WHERE parentId = ?1 \
            AND parentIncarnation = ( \
              SELECT incarnation FROM _snapback_relation_incarnations_v1 \
               WHERE table_name = ?2 AND row_id = ?1 AND active = 1 \
            ) \
          ORDER BY ordinal ASC, _id ASC",
        quote_ident(&table.name)?
    );
    let mut statement = tx.prepare(&sql)?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut rows = statement.query(params![parent_id, parent_table])?;
    let mut items = Vec::new();
    while let Some(row) = rows.next()? {
        let document = row_to_document(row, table, &columns)?;
        validate_document_version_at_most(&document, maximum_version, &table.name)?;
        let id = document
            .get("_id")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_STORAGE_INVALID",
                    "collection item is missing its stable id",
                )
            })?
            .to_owned();
        let asset_id = document
            .get("assetId")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_STORAGE_INVALID",
                    "collection item is missing its asset id",
                )
            })?
            .to_owned();
        let ordinal = document
            .get("ordinal")
            .and_then(Value::as_i64)
            .and_then(|value| usize::try_from(value).ok())
            .ok_or_else(|| {
                asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_STORAGE_INVALID",
                    "collection item has an invalid ordinal",
                )
            })?;
        items.push(AssetCollectionStoredItem {
            id,
            asset_id,
            ordinal,
            document,
        });
    }
    if items
        .iter()
        .enumerate()
        .any(|(expected, item)| item.ordinal != expected)
        || items
            .iter()
            .map(|item| item.asset_id.as_str())
            .collect::<BTreeSet<_>>()
            .len()
            != items.len()
    {
        return Err(asset_collection_error(
            "SNAPBACK_MEDIA_COLLECTION_STORAGE_INVALID",
            "collection storage has non-contiguous order or duplicate assets",
        ));
    }
    Ok(items)
}

fn finalized_collection_asset_kind(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    plan: &AssetCollectionMutationPlanV1,
    principal: &str,
    asset_id: &str,
) -> SnapbackResult<crate::contract_types::MediaKindV1> {
    use crate::assets::{AssetAvailability, AssetRenditionState, AssetWritePath};
    let authority = crate::assets::AssetCommitAuthority {
        path: AssetWritePath::HostPlan,
        principal: Some(principal),
        admissions: &[],
    };
    let asset = crate::assets::verify_attachment(
        tx,
        &schema.app_id,
        asset_id,
        Some(&plan.intent),
        None,
        &authority,
    )?;
    if asset.availability != AssetAvailability::Ready {
        return Err(SnapbackError::error(
            "SNAPBACK_MEDIA_ASSET_NOT_FINALIZED",
            "assets",
            "await asset finalization before adding it to a media collection",
        ));
    }
    let rendition_id = asset
        .primary_rendition_id
        .as_deref()
        .ok_or_else(crate::assets::media_projection_integrity)?;
    let rendition = crate::assets::load_rendition(tx, rendition_id)?
        .ok_or_else(crate::assets::media_projection_integrity)?;
    if rendition.state != AssetRenditionState::Ready {
        return Err(crate::assets::media_projection_integrity());
    }
    let detected = rendition
        .media_facts
        .as_ref()
        .and_then(|facts| facts.get("contentType"))
        .and_then(Value::as_str)
        .ok_or_else(crate::assets::media_projection_integrity)?;
    let expected = crate::assets::media_kind_for_detected_content_type(detected);
    let stored = asset
        .media_kind
        .ok_or_else(crate::assets::media_projection_integrity)?;
    if stored != expected {
        return Err(crate::assets::media_projection_integrity());
    }
    if !plan.kinds.contains(&stored) {
        return Err(SnapbackError::error(
            "SNAPBACK_MEDIA_KIND_NOT_ADMITTED",
            "assets",
            "the finalized asset kind is not admitted by this media collection",
        ));
    }
    Ok(stored)
}

fn media_kind_label(kind: crate::contract_types::MediaKindV1) -> &'static str {
    match kind {
        crate::contract_types::MediaKindV1::Image => "image",
        crate::contract_types::MediaKindV1::Video => "video",
        crate::contract_types::MediaKindV1::Audio => "audio",
        crate::contract_types::MediaKindV1::File => "file",
    }
}

fn record_asset_collection_insert(
    tx: &Transaction<'_>,
    table: &TableManifest,
    plan: &AssetCollectionMutationPlanV1,
    parent_id: &str,
    id: &str,
    asset_id: &str,
    kind: crate::contract_types::MediaKindV1,
    ordinal: usize,
    version: u64,
    now_ms: u64,
    order_field_bounds: &BTreeMap<(String, String), u64>,
    changes: &mut Vec<ChangedRow>,
) -> SnapbackResult<()> {
    let values = Map::from_iter([
        ("parentId".to_owned(), Value::String(parent_id.to_owned())),
        ("assetId".to_owned(), Value::String(asset_id.to_owned())),
        (
            "kind".to_owned(),
            Value::String(media_kind_label(kind).to_owned()),
        ),
        (
            "policyGeneration".to_owned(),
            Value::String(plan.policy_generation.clone()),
        ),
        ("ordinal".to_owned(), json!(ordinal)),
    ]);
    let changed_fields = changed_field_names(&values);
    let document = insert_document(tx, table, id, &values, version, now_ms, order_field_bounds)?;
    record_change(
        tx,
        version,
        &table.name,
        id,
        ChangeOp::Insert,
        Some(&document),
        now_ms,
    )?;
    changes.push(ChangedRow {
        table: table.name.clone(),
        id: id.to_owned(),
        op: ChangeOp::Insert,
        row: Some(document),
        changed_fields,
    });
    Ok(())
}

fn record_asset_collection_ordinal(
    tx: &Transaction<'_>,
    table: &TableManifest,
    id: &str,
    ordinal: usize,
    version: u64,
    now_ms: u64,
    order_field_bounds: &BTreeMap<(String, String), u64>,
    changes: &mut Vec<ChangedRow>,
) -> SnapbackResult<()> {
    let values = Map::from_iter([("ordinal".to_owned(), json!(ordinal))]);
    if patch_document(tx, table, id, &values, version, now_ms, order_field_bounds)? {
        let document = get_document_from_tx(tx, table, id, version)?.ok_or_else(|| {
            asset_collection_error(
                "SNAPBACK_MEDIA_COLLECTION_STORAGE_INVALID",
                "collection item disappeared while its ordinal was updated",
            )
        })?;
        record_change(
            tx,
            version,
            &table.name,
            id,
            ChangeOp::Update,
            Some(&document),
            now_ms,
        )?;
        changes.push(ChangedRow {
            table: table.name.clone(),
            id: id.to_owned(),
            op: ChangeOp::Update,
            row: Some(document),
            changed_fields: vec!["ordinal".to_owned()],
        });
    }
    Ok(())
}

fn record_asset_collection_delete(
    tx: &Transaction<'_>,
    table: &TableManifest,
    item: &AssetCollectionStoredItem,
    version: u64,
    now_ms: u64,
    changes: &mut Vec<ChangedRow>,
) -> SnapbackResult<()> {
    if delete_document(tx, table, &item.id)? {
        record_change(
            tx,
            version,
            &table.name,
            &item.id,
            ChangeOp::Delete,
            None,
            now_ms,
        )?;
        changes.push(ChangedRow {
            table: table.name.clone(),
            id: item.id.clone(),
            op: ChangeOp::Delete,
            row: Some(item.document.clone()),
            changed_fields: Vec::new(),
        });
    }
    Ok(())
}

#[derive(Clone)]
// @ref LLP 0239#d4-grants-and-authority-are-declarative-at-the-command-edge —
// selections only reconcile collection-owned grants inside the ordinary
// mutation transaction; omission and no-change never mint ambient authority.
struct AssetCollectionSelectedSharing {
    name: String,
    state: Option<crate::assets::AssetGrantState>,
    principals: Vec<String>,
    reconcile_targets: bool,
}

fn asset_collection_recipient_principals(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    _descriptor: &crate::manifest::AssetCollectionManifestV1,
    entry: &crate::manifest::AssetCollectionSharingPlanManifestV1,
    input: &HandlerInput,
    parent_id: &str,
    selection: Option<&Map<String, Value>>,
) -> SnapbackResult<AssetCollectionSelectedSharing> {
    use crate::assets::AssetGrantState;
    use crate::manifest::{
        AssetCollectionGrantStateV1, AssetCollectionSharingPlanV1, FilterExpr, FilterOp,
        OrderDirection, OrderExpr, QueryPlan, ValueExpr,
    };

    let state = |state| match state {
        AssetCollectionGrantStateV1::Active => AssetGrantState::Active,
        AssetCollectionGrantStateV1::Pending => AssetGrantState::Pending,
    };
    let (grant_state, max_recipients, principals, reconcile_targets) = match &entry.plan {
        AssetCollectionSharingPlanV1::None => {
            if selection.is_some_and(|selection| selection.len() != 1) {
                return Err(asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_SHARING_SELECTION_INVALID",
                    "a no-change sharing selection contains only the plan name",
                ));
            }
            (None, 0, Vec::new(), false)
        }
        AssetCollectionSharingPlanV1::OwnerOnly => {
            if selection.is_some_and(|selection| selection.len() != 1) {
                return Err(asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_SHARING_SELECTION_INVALID",
                    "an owner-only sharing selection contains only the plan name",
                ));
            }
            (None, 0, Vec::new(), true)
        }
        AssetCollectionSharingPlanV1::Recipients {
            state: declared_state,
            max_recipients,
        } => {
            let selection = selection.ok_or_else(|| {
                asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_SHARING_SELECTION_INVALID",
                    "a direct-recipient sharing plan cannot be selected by omission",
                )
            })?;
            if selection.len() != 2 {
                return Err(asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_SHARING_SELECTION_INVALID",
                    "a direct-recipient sharing selection contains exactly plan and principals",
                ));
            }
            let values = selection
                .get("principals")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    asset_collection_error(
                        "SNAPBACK_MEDIA_COLLECTION_SHARING_SELECTION_INVALID",
                        "a direct-recipient sharing selection requires a principals array",
                    )
                })?;
            if values.is_empty() || values.len() > usize::from(*max_recipients) {
                return Err(asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_SHARING_SELECTION_INVALID",
                    "the direct recipient list is empty or exceeds its declared bound",
                ));
            }
            let principals = values
                .iter()
                .map(|value| {
                    value
                        .as_str()
                        .filter(|principal| {
                            !principal.trim().is_empty() && principal.len() <= 512
                        })
                        .map(str::to_owned)
                        .ok_or_else(|| {
                            asset_collection_error(
                                "SNAPBACK_MEDIA_COLLECTION_SHARING_SELECTION_INVALID",
                                "recipient principals must be non-empty strings of at most 512 bytes",
                            )
                        })
                })
                .collect::<SnapbackResult<Vec<_>>>()?;
            (
                Some(state(*declared_state)),
                *max_recipients,
                principals,
                true,
            )
        }
        AssetCollectionSharingPlanV1::Derived {
            state: declared_state,
            max_recipients,
            table,
            parent_field,
            principal_field,
            ..
        } => {
            if selection.is_some_and(|selection| selection.len() != 1) {
                return Err(asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_SHARING_SELECTION_INVALID",
                    "a derived sharing selection contains only its plan name",
                ));
            }
            let source = schema.table(table).ok_or_else(|| {
                asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_SHARING_DERIVATION_INVALID",
                    "the sharing derivation source table is unavailable",
                )
            })?;
            let query = QueryPlan {
                table: table.clone(),
                table_visibility: source.visibility.clone(),
                filters: vec![FilterExpr {
                    field: parent_field.clone(),
                    op: FilterOp::Eq,
                    value: ValueExpr::Arg("parentId".to_owned()),
                }],
                membership_filters: Vec::new(),
                order: vec![OrderExpr {
                    field: principal_field.clone(),
                    direction: OrderDirection::Asc,
                    max_encoded_bytes: None,
                }],
                limit: Some(usize::from(*max_recipients) + 1),
                indexed_by: None,
            };
            let mut derivation_input = input.clone();
            derivation_input.args = json!({ "parentId": parent_id });
            let rows = query_on(tx, schema, &query, &derivation_input)?.rows;
            if rows.len() > usize::from(*max_recipients) {
                return Err(asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_SHARING_DERIVATION_INVALID",
                    "the generated recipient derivation exceeds its declared bound",
                ));
            }
            let principals = rows
                .iter()
                .map(|row| {
                    row.get(principal_field)
                        .and_then(Value::as_str)
                        .filter(|principal| !principal.trim().is_empty() && principal.len() <= 512)
                        .map(str::to_owned)
                        .ok_or_else(|| {
                            asset_collection_error(
                                "SNAPBACK_MEDIA_COLLECTION_SHARING_DERIVATION_INVALID",
                                "the generated recipient derivation returned an invalid principal",
                            )
                        })
                })
                .collect::<SnapbackResult<Vec<_>>>()?;
            (
                Some(state(*declared_state)),
                *max_recipients,
                principals,
                true,
            )
        }
        AssetCollectionSharingPlanV1::InheritCommand => {
            return Err(asset_collection_error(
                "SNAPBACK_MEDIA_COLLECTION_COMMAND_BINDING_REQUIRED",
                "inherit-command sharing requires the exact versioned media-command binding that Phase B installs",
            ));
        }
    };
    if principals.iter().collect::<BTreeSet<_>>().len() != principals.len()
        || principals.len() > usize::from(max_recipients)
    {
        return Err(asset_collection_error(
            if matches!(
                entry.plan,
                crate::manifest::AssetCollectionSharingPlanV1::Derived { .. }
            ) {
                "SNAPBACK_MEDIA_COLLECTION_SHARING_DERIVATION_INVALID"
            } else {
                "SNAPBACK_MEDIA_COLLECTION_SHARING_SELECTION_INVALID"
            },
            "the selected sharing plan produced duplicate or over-bound recipients",
        ));
    }
    Ok(AssetCollectionSelectedSharing {
        name: entry.name.clone(),
        state: grant_state,
        principals,
        reconcile_targets,
    })
}

fn select_asset_collection_sharing(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    descriptor: &crate::manifest::AssetCollectionManifestV1,
    plan: &AssetCollectionMutationPlanV1,
    input: &HandlerInput,
    args: &Map<String, Value>,
    parent_id: &str,
) -> SnapbackResult<Option<AssetCollectionSelectedSharing>> {
    let Some(sharing_arg) = plan.sharing_arg.as_deref() else {
        return Ok(None);
    };
    let selection = match args.get(sharing_arg) {
        None => None,
        Some(Value::Object(selection)) => Some(selection),
        Some(_) => {
            return Err(asset_collection_error(
                "SNAPBACK_MEDIA_COLLECTION_SHARING_SELECTION_INVALID",
                "sharing must be an exact generated selection object",
            ));
        }
    };
    let selected_name = match selection {
        Some(selection) => selection
            .get("plan")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_SHARING_SELECTION_INVALID",
                    "an explicit sharing selection requires a string plan name",
                )
            })?,
        None => descriptor.sharing.default_plan.as_str(),
    };
    let entry = descriptor
        .sharing
        .ceiling
        .iter()
        .find(|entry| entry.name == selected_name)
        .ok_or_else(|| {
            asset_collection_error(
                "SNAPBACK_MEDIA_COLLECTION_SHARING_OUTSIDE_CEILING",
                "the selected sharing plan is outside the collection ceiling",
            )
        })?;
    asset_collection_recipient_principals(
        tx, schema, descriptor, entry, input, parent_id, selection,
    )
    .map(Some)
}

fn asset_collection_grant_id(
    generation: &str,
    item_id: &str,
    plan_name: &str,
    principal: &str,
    state: crate::assets::AssetGrantState,
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"snapback:asset-collection-grant-id:v1\n");
    for part in [
        generation,
        item_id,
        plan_name,
        principal,
        match state {
            crate::assets::AssetGrantState::Active => "active",
            crate::assets::AssetGrantState::Pending => "pending",
        },
    ] {
        digest.update((part.len() as u64).to_be_bytes());
        digest.update(part.as_bytes());
    }
    let bytes = digest.finalize();
    let mut body = [0_u8; 16];
    body.copy_from_slice(&bytes[..16]);
    format!("agr_{}", crate::ids::encode_body(&body))
}

fn reconcile_asset_collection_sharing(
    tx: &Transaction<'_>,
    plan: &AssetCollectionMutationPlanV1,
    identity: &ClientMutationIdentity,
    current: &[AssetCollectionStoredItem],
    final_items: &[AssetCollectionStoredItem],
    selected: Option<&AssetCollectionSelectedSharing>,
    principal: &str,
    now_ms: u64,
) -> SnapbackResult<BTreeSet<String>> {
    use crate::assets::BufferedAssetGrantOp;

    if matches!(plan.operation, AssetCollectionOperationV1::Reorder) {
        return Ok(BTreeSet::new());
    }
    let final_ids = final_items
        .iter()
        .map(|item| item.id.as_str())
        .collect::<BTreeSet<_>>();
    let removed = current
        .iter()
        .filter(|item| !final_ids.contains(item.id.as_str()))
        .collect::<Vec<_>>();
    let targets = match plan.operation {
        AssetCollectionOperationV1::Append => final_items
            .iter()
            .filter(|item| !current.iter().any(|prior| prior.id == item.id))
            .collect::<Vec<_>>(),
        AssetCollectionOperationV1::Replace => final_items.iter().collect::<Vec<_>>(),
        AssetCollectionOperationV1::Remove | AssetCollectionOperationV1::Reorder => Vec::new(),
    };
    let reconciled_targets = selected
        .filter(|selected| selected.reconcile_targets)
        .map_or(&[][..], |_| targets.as_slice());
    let scope_ids = removed
        .iter()
        .chain(reconciled_targets.iter())
        .map(|item| item.id.clone())
        .collect::<BTreeSet<_>>();
    if scope_ids.is_empty() {
        return Ok(BTreeSet::new());
    }
    let existing = asset_grants::collection_managed_grants(tx, &plan.generation, &scope_ids)?;
    let mut desired = BTreeMap::new();
    if let Some(selected) = selected
        && let Some(state) = selected.state
    {
        for item in reconciled_targets {
            for recipient in &selected.principals {
                let grant_id = asset_collection_grant_id(
                    &plan.generation,
                    &item.id,
                    &selected.name,
                    recipient,
                    state,
                );
                desired.insert(
                    grant_id,
                    (
                        item.asset_id.clone(),
                        item.id.clone(),
                        recipient.clone(),
                        state,
                    ),
                );
            }
        }
    }
    let existing_by_id = existing
        .iter()
        .map(|grant| (grant.grant_id.clone(), grant))
        .collect::<BTreeMap<_, _>>();
    let mut ops = Vec::new();
    for grant in &existing {
        let keep = desired
            .get(&grant.grant_id)
            .is_some_and(|(asset_id, _, recipient, state)| {
                grant.asset_id == *asset_id
                    && grant.principal == *recipient
                    && grant.state == *state
            });
        if !keep {
            ops.push(BufferedAssetGrantOp::Revoke {
                grant_id: grant.grant_id.clone(),
                at_ms: now_ms,
            });
        }
    }
    for (grant_id, (asset_id, item_id, recipient, state)) in desired {
        let present = existing_by_id.get(&grant_id).is_some_and(|grant| {
            grant.asset_id == asset_id && grant.principal == recipient && grant.state == state
        });
        if !present {
            ops.push(BufferedAssetGrantOp::Grant {
                grant_id,
                asset_id,
                principal: recipient,
                state,
                mutation: format!(
                    "asset-collection.v1|{}|{}|{}|{}",
                    plan.generation,
                    item_id,
                    selected.map_or("none", |selected| selected.name.as_str()),
                    identity.function,
                ),
                at_ms: now_ms,
            });
        }
    }
    if ops.is_empty() {
        Ok(BTreeSet::new())
    } else {
        asset_grants::apply_in_tx(tx, principal, &ops)
    }
}

#[allow(clippy::too_many_arguments)]
fn execute_asset_collection_step<Check>(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    plan: &AssetCollectionMutationPlanV1,
    input: &HandlerInput,
    identity: Option<&ClientMutationIdentity>,
    next_version: u64,
    now_ms: u64,
    order_field_bounds: &BTreeMap<(String, String), u64>,
    plan_ids: &RefCell<PlanIdSource<'_>>,
    changes: &mut Vec<ChangedRow>,
    check_live: &Check,
) -> SnapbackResult<(Value, BTreeSet<String>)>
where
    Check: Fn() -> SnapbackResult<()>,
{
    let descriptor = collection_descriptor_for_plan(schema, plan)?;
    let identity = identity.ok_or_else(|| {
        asset_collection_error(
            "SNAPBACK_MEDIA_COLLECTION_MUTATION_ATTEMPT_REQUIRED",
            "collection mutations require a replay-stable client mutation identity",
        )
    })?;
    let principal = input.auth.user_id.as_deref().ok_or_else(|| {
        asset_collection_error(
            "SNAPBACK_MEDIA_COLLECTION_PARENT_FORBIDDEN",
            "collection mutation requires an authenticated user",
        )
    })?;
    let args = input.args.as_object().ok_or_else(|| {
        asset_collection_error(
            "SNAPBACK_MEDIA_COLLECTION_ARGUMENT_INVALID",
            "collection mutation arguments must be an object",
        )
    })?;
    let parent_id = args
        .get(&plan.parent_id_arg)
        .and_then(Value::as_str)
        .ok_or_else(|| {
            asset_collection_error(
                "SNAPBACK_MEDIA_COLLECTION_ARGUMENT_INVALID",
                "collection mutation requires a parentId string",
            )
        })?;
    let owner_table = schema_table(schema, &plan.owner_table)?;
    let parent =
        get_document_from_tx(tx, owner_table, parent_id, next_version)?.ok_or_else(|| {
            asset_collection_error(
                "SNAPBACK_MEDIA_COLLECTION_PARENT_UNAVAILABLE",
                "collection parent is missing or inactive",
            )
        })?;
    if parent.get(&plan.owner_field).and_then(Value::as_str) != Some(principal) {
        return Err(asset_collection_error(
            "SNAPBACK_MEDIA_COLLECTION_PARENT_FORBIDDEN",
            "caller does not own the collection parent at commit time",
        ));
    }
    let child_table = schema_table(schema, &plan.child_table)?;
    let current =
        load_asset_collection_items(tx, child_table, &plan.owner_table, parent_id, next_version)?;
    if current.len() > usize::from(descriptor.max_items) {
        return Err(asset_collection_error(
            "SNAPBACK_MEDIA_COLLECTION_STORAGE_INVALID",
            "stored collection exceeds its declared maximum",
        ));
    }
    let selected_sharing =
        select_asset_collection_sharing(tx, schema, descriptor, plan, input, args, parent_id)?;
    let input_items = args
        .get(&plan.items_arg)
        .and_then(Value::as_array)
        .ok_or_else(|| {
            asset_collection_error(
                "SNAPBACK_MEDIA_COLLECTION_ARGUMENT_INVALID",
                format!("collection mutation requires an {} array", plan.items_arg),
            )
        })?;
    let requested = input_items
        .iter()
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_ARGUMENT_INVALID",
                    format!("{} entries must be strings", plan.items_arg),
                )
            })
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    if requested.len() > usize::from(plan.max_items) {
        return Err(asset_collection_error(
            "SNAPBACK_MEDIA_COLLECTION_LIMIT_EXCEEDED",
            "collection mutation exceeds its declared item maximum",
        ));
    }
    if requested.iter().collect::<BTreeSet<_>>().len() != requested.len() {
        let code = match plan.operation {
            AssetCollectionOperationV1::Append | AssetCollectionOperationV1::Replace => {
                "SNAPBACK_MEDIA_COLLECTION_DUPLICATE_ASSET"
            }
            AssetCollectionOperationV1::Remove | AssetCollectionOperationV1::Reorder => {
                "SNAPBACK_MEDIA_COLLECTION_DUPLICATE_ITEM"
            }
        };
        return Err(asset_collection_error(
            code,
            "collection mutation contains a duplicate identifier",
        ));
    }
    let attempt_digest = identity.activity_digest();
    let mut final_ids = Vec::new();
    match plan.operation {
        AssetCollectionOperationV1::Append => {
            if current.len() + requested.len() > usize::from(plan.max_items) {
                return Err(asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_LIMIT_EXCEEDED",
                    "append would exceed the collection maximum",
                ));
            }
            let existing = current
                .iter()
                .map(|item| item.asset_id.as_str())
                .collect::<BTreeSet<_>>();
            if requested
                .iter()
                .any(|asset| existing.contains(asset.as_str()))
            {
                return Err(asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_DUPLICATE_ASSET",
                    "append names an asset already attached to this collection",
                ));
            }
            final_ids.extend(current.iter().map(|item| item.id.clone()));
            for (input_ordinal, asset_id) in requested.iter().enumerate() {
                check_live()?;
                let kind = finalized_collection_asset_kind(tx, schema, plan, principal, asset_id)?;
                let site = format!(
                    "asset-collection/{}/append/{input_ordinal}",
                    plan.collection
                );
                let id = asset_collection_attempt_item_id(
                    &plan.child_table,
                    &plan.generation,
                    &attempt_digest,
                    input_ordinal,
                );
                let id = plan_ids.borrow_mut().record_deterministic(&site, id)?;
                record_asset_collection_insert(
                    tx,
                    child_table,
                    plan,
                    parent_id,
                    &id,
                    asset_id,
                    kind,
                    current.len() + input_ordinal,
                    next_version,
                    now_ms,
                    order_field_bounds,
                    changes,
                )?;
                final_ids.push(id);
            }
        }
        AssetCollectionOperationV1::Replace => {
            let by_asset = current
                .iter()
                .map(|item| (item.asset_id.as_str(), item))
                .collect::<BTreeMap<_, _>>();
            let retained = requested
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>();
            for item in current
                .iter()
                .filter(|item| !retained.contains(item.asset_id.as_str()))
            {
                check_live()?;
                record_asset_collection_delete(
                    tx,
                    child_table,
                    item,
                    next_version,
                    now_ms,
                    changes,
                )?;
            }
            // @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation —
            // created order is immutable: retained rows keep their relative
            // creation order and replacement-new rows follow in input order.
            let ordered = if plan.order == "created" {
                current
                    .iter()
                    .filter(|item| retained.contains(item.asset_id.as_str()))
                    .map(|item| {
                        let input_ordinal = requested
                            .iter()
                            .position(|asset| asset == &item.asset_id)
                            .expect("retained asset occurs in replacement input");
                        (item.asset_id.as_str(), input_ordinal)
                    })
                    .chain(
                        requested
                            .iter()
                            .enumerate()
                            .filter(|(_, asset)| !by_asset.contains_key(asset.as_str()))
                            .map(|(input_ordinal, asset)| (asset.as_str(), input_ordinal)),
                    )
                    .collect::<Vec<_>>()
            } else {
                requested
                    .iter()
                    .enumerate()
                    .map(|(input_ordinal, asset)| (asset.as_str(), input_ordinal))
                    .collect::<Vec<_>>()
            };
            for (final_ordinal, (asset_id, input_ordinal)) in ordered.into_iter().enumerate() {
                check_live()?;
                if let Some(item) = by_asset.get(asset_id) {
                    record_asset_collection_ordinal(
                        tx,
                        child_table,
                        &item.id,
                        final_ordinal,
                        next_version,
                        now_ms,
                        order_field_bounds,
                        changes,
                    )?;
                    final_ids.push(item.id.clone());
                } else {
                    let kind =
                        finalized_collection_asset_kind(tx, schema, plan, principal, asset_id)?;
                    let site = format!(
                        "asset-collection/{}/replace/{input_ordinal}",
                        plan.collection
                    );
                    let id = asset_collection_attempt_item_id(
                        &plan.child_table,
                        &plan.generation,
                        &attempt_digest,
                        input_ordinal,
                    );
                    let id = plan_ids.borrow_mut().record_deterministic(&site, id)?;
                    record_asset_collection_insert(
                        tx,
                        child_table,
                        plan,
                        parent_id,
                        &id,
                        asset_id,
                        kind,
                        final_ordinal,
                        next_version,
                        now_ms,
                        order_field_bounds,
                        changes,
                    )?;
                    final_ids.push(id);
                }
            }
        }
        AssetCollectionOperationV1::Remove => {
            let requested = requested
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>();
            let known = current
                .iter()
                .map(|item| item.id.as_str())
                .collect::<BTreeSet<_>>();
            if !requested.is_subset(&known) {
                return Err(asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_ITEM_UNKNOWN",
                    "remove names an item outside the current collection generation",
                ));
            }
            for item in current
                .iter()
                .filter(|item| requested.contains(item.id.as_str()))
            {
                check_live()?;
                record_asset_collection_delete(
                    tx,
                    child_table,
                    item,
                    next_version,
                    now_ms,
                    changes,
                )?;
            }
            for (ordinal, item) in current
                .iter()
                .filter(|item| !requested.contains(item.id.as_str()))
                .enumerate()
            {
                record_asset_collection_ordinal(
                    tx,
                    child_table,
                    &item.id,
                    ordinal,
                    next_version,
                    now_ms,
                    order_field_bounds,
                    changes,
                )?;
                final_ids.push(item.id.clone());
            }
        }
        AssetCollectionOperationV1::Reorder => {
            if plan.order == "created" {
                return Err(asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_CREATED_ORDER_REORDER_REFUSED",
                    "created-order collections do not admit reorder; declare order: \"manual\" for caller-controlled ordering",
                ));
            }
            let current_ids = current
                .iter()
                .map(|item| item.id.as_str())
                .collect::<BTreeSet<_>>();
            let requested_ids = requested
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>();
            if requested.len() != current.len() || requested_ids != current_ids {
                return Err(asset_collection_error(
                    "SNAPBACK_MEDIA_COLLECTION_REORDER_INVALID",
                    "reorder must be an exact permutation of current stable item ids",
                ));
            }
            let by_id = current
                .iter()
                .map(|item| (item.id.as_str(), item))
                .collect::<BTreeMap<_, _>>();
            for (ordinal, id) in requested.iter().enumerate() {
                record_asset_collection_ordinal(
                    tx,
                    child_table,
                    &by_id[id.as_str()].id,
                    ordinal,
                    next_version,
                    now_ms,
                    order_field_bounds,
                    changes,
                )?;
                final_ids.push(id.clone());
            }
        }
    }
    let final_items =
        load_asset_collection_items(tx, child_table, &plan.owner_table, parent_id, next_version)?;
    let asset_changes = reconcile_asset_collection_sharing(
        tx,
        plan,
        identity,
        &current,
        &final_items,
        selected_sharing.as_ref(),
        principal,
        now_ms,
    )?;
    Ok((
        json!({ "parentId": parent_id, "itemIds": final_ids }),
        asset_changes,
    ))
}

#[allow(clippy::too_many_arguments)]
fn execute_media_command_collection_step<Check>(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    media: &crate::manifest::ResolvedMediaCommandV1,
    input: &HandlerInput,
    result: &Value,
    identity: Option<&ClientMutationIdentity>,
    next_version: u64,
    now_ms: u64,
    order_field_bounds: &BTreeMap<(String, String), u64>,
    changes: &mut Vec<ChangedRow>,
    check_live: &Check,
) -> SnapbackResult<BTreeSet<String>>
where
    Check: Fn() -> SnapbackResult<()>,
{
    let parent_id = media
        .binding
        .parent_result_path
        .iter()
        .try_fold(result, |value, component| {
            value.as_object().and_then(|object| object.get(component))
        })
        .and_then(Value::as_str)
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_MEDIA_COMMAND_PARENT_RESULT_INVALID",
                "media-command",
                "mutation result did not preserve the binding's exact parent id path",
            )
        })?
        .to_owned();
    let descriptor = schema
        .asset_collections
        .iter()
        .find(|collection| collection.name == media.binding.collection.name)
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_MEDIA_COMMAND_BINDING_INVALID",
                "media-command",
                "media command collection is absent from the active schema",
            )
        })?;
    let derivation_tables = descriptor
        .sharing
        .ceiling
        .iter()
        .filter_map(|selection| match &selection.plan {
            crate::manifest::AssetCollectionSharingPlanV1::Derived { table, .. } => {
                Some(table.clone())
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    let grant_capable = descriptor.sharing.ceiling.iter().any(|selection| {
        matches!(
            selection.plan,
            crate::manifest::AssetCollectionSharingPlanV1::Recipients { .. }
                | crate::manifest::AssetCollectionSharingPlanV1::Derived { .. }
        )
    });
    let operation = match media.binding.item_identity_plan.operation.as_str() {
        "append" => AssetCollectionOperationV1::Append,
        "replace" => AssetCollectionOperationV1::Replace,
        _ => {
            return Err(SnapbackError::error(
                "SNAPBACK_MEDIA_COMMAND_BINDING_INVALID",
                "media-command",
                "media command binding names an unsupported collection operation",
            ));
        }
    };
    let plan = AssetCollectionMutationPlanV1 {
        collection: media.binding.collection.name.clone(),
        generation: media.binding.collection.generation.clone(),
        operation,
        owner_table: media.binding.collection.owner_table.clone(),
        owner_field: media.binding.collection.owner_field.clone(),
        child_table: media.binding.collection.child_table.clone(),
        parent_id_arg: "parentId".to_owned(),
        items_arg: "assetIds".to_owned(),
        max_items: media.binding.media.max_items,
        order: "manual".to_owned(),
        intent: media.binding.media.intent.clone(),
        kinds: media.binding.media.kinds.clone(),
        duplicate_policy: "refuse.v1".to_owned(),
        policy_generation: media.binding.collection.generation.clone(),
        sharing_arg: Some("sharing".to_owned()),
        default_sharing_plan: descriptor.sharing.default_plan.clone(),
        sharing_derivation_tables: derivation_tables,
        sharing_grant_capable: grant_capable,
    };
    let mut collection_input = input.clone();
    let sharing = if media.binding.principal_input.is_some() {
        json!({
            "plan": media.binding.sharing.name,
            "principals": media.invocation.principals,
        })
    } else {
        json!({ "plan": media.binding.sharing.name })
    };
    collection_input.args = json!({
        "parentId": parent_id,
        "assetIds": media.invocation.items.iter()
            .map(|item| item.asset_id.as_str())
            .collect::<Vec<_>>(),
        "sharing": sharing,
    });
    let collection_change_start = changes.len();
    let plan_ids = RefCell::new(PlanIdSource::new(None));
    let (_collection_result, changed_assets) = execute_asset_collection_step(
        tx,
        schema,
        &plan,
        &collection_input,
        identity,
        next_version,
        now_ms,
        order_field_bounds,
        &plan_ids,
        changes,
        check_live,
    )?;
    plan_ids.borrow().ensure_exact_consumption()?;
    enforce_asset_reference_changes(
        schema,
        tx,
        &changes[collection_change_start..],
        &crate::assets::AssetCommitAuthority {
            path: crate::assets::AssetWritePath::HostPlan,
            principal: input.auth.user_id.as_deref(),
            admissions: &[],
        },
        now_ms,
    )?;
    Ok(changed_assets)
}

#[derive(Clone, Debug)]
struct SettlementMediaContextV1 {
    result_contract_hash: String,
    plan: crate::runtime::MediaProjectionPlanV1,
}

fn media_path_matches(pattern: &[String], actual: &[String]) -> bool {
    pattern.len() == actual.len()
        && pattern
            .iter()
            .zip(actual)
            .all(|(expected, actual)| expected == "*" || expected == actual)
}

fn value_at_media_path_mut<'a>(
    mut value: &'a mut Value,
    path: &[String],
) -> SnapbackResult<&'a mut Value> {
    for component in path {
        value = if let Ok(index) = component.parse::<usize>() {
            value
                .as_array_mut()
                .and_then(|values| values.get_mut(index))
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED",
                        "assets",
                        "media result did not preserve exact host provenance",
                    )
                })?
        } else {
            value
                .as_object_mut()
                .and_then(|object| object.get_mut(component))
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED",
                        "assets",
                        "media result did not preserve exact host provenance",
                    )
                })?
        };
    }
    Ok(value)
}

fn media_projection_unprovenanced() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED",
        "assets",
        "media result did not preserve exact host provenance",
    )
}

fn materialize_provenanced_media_result_in_tx(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    maximum_version: u64,
    plan: &crate::runtime::MediaProjectionPlanV1,
    occurrences: &[crate::runtime::MediaProjectionProofOccurrenceV1],
    result: &mut Value,
) -> SnapbackResult<()> {
    for occurrence in occurrences {
        let semantic = plan
            .occurrences
            .iter()
            .find(|semantic| media_path_matches(&semantic.path, &occurrence.path))
            .ok_or_else(media_projection_unprovenanced)?;
        let ResultValueContract::MediaRefV1 {
            source_table,
            source_field,
            source_field_generation,
            ..
        } = &semantic.node
        else {
            return Err(media_projection_unprovenanced());
        };
        if source_table != &occurrence.source_table
            || source_field != &occurrence.source_field
            || source_field_generation != &occurrence.source_field_generation
        {
            return Err(media_projection_unprovenanced());
        }
        let table = schema_table(schema, source_table)?;
        let field = table
            .fields
            .iter()
            .find(|field| &field.name == source_field)
            .ok_or_else(media_projection_unprovenanced)?;
        let FieldType::AssetRef {
            media: Some(media), ..
        } = &field.field_type
        else {
            return Err(media_projection_unprovenanced());
        };
        if crate::manifest::media_source_field_generation(source_table, field, media)
            != *source_field_generation
        {
            return Err(media_projection_unprovenanced());
        }
        let mut source =
            get_document_from_tx(tx, table, &occurrence.source_row_id, maximum_version)?
                .ok_or_else(media_projection_unprovenanced)?;
        let physical_asset_id = source
            .get(source_field)
            .and_then(Value::as_str)
            .ok_or_else(media_projection_unprovenanced)?;
        if physical_asset_id != occurrence.asset_id {
            return Err(media_projection_unprovenanced());
        }
        project_media_fields_on(tx, table, &mut source)?;
        let projected = source
            .get(source_field)
            .cloned()
            .ok_or_else(media_projection_unprovenanced)?;
        let projected_kind: crate::contract_types::MediaKindV1 = projected
            .get("kind")
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok())
            .ok_or_else(media_projection_unprovenanced)?;
        if projected_kind != occurrence.kind {
            return Err(media_projection_unprovenanced());
        }
        *value_at_media_path_mut(result, &occurrence.path)? = projected;
    }
    Ok(())
}

/// Bind the process-local proof to the captured related-fact identities from
/// the same handler snapshot before ordinary OCC admission evaluates them.
/// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
fn validate_staged_media_projection_dependencies(
    proof: &crate::runtime::StagedMediaProjectionProofV1,
    read_dependencies: &[CapturedReadDependency],
) -> SnapbackResult<()> {
    for occurrence in proof.borrow_occurrences() {
        let bound = read_dependencies.iter().any(|dependency| {
            is_media_projection_dependency(dependency)
                && dependency.id.as_deref() == Some(occurrence.asset_id.as_str())
                && dependency.version == Some(occurrence.snapshot_version)
                && dependency.value.as_ref().and_then(Value::as_str)
                    == Some(occurrence.related_fact_digest.as_str())
        });
        if !bound {
            return Err(media_projection_unprovenanced());
        }
    }
    Ok(())
}

/// The proof cannot establish its own invocation authority. Compare it with
/// the record reconstructed from the current prepared invocation/request
/// carrier before any stale-read validation or result materialization.
/// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
fn validate_staged_media_projection_binding(
    proof: &crate::runtime::StagedMediaProjectionProofV1,
    expected: &crate::runtime::MediaProjectionProofBindingV1,
) -> SnapbackResult<()> {
    if !crate::runtime::is_concrete_function_artifact_generation(
        &proof.binding.function_artifact_generation,
    ) || &proof.binding != expected
        || proof.result_contract_hash != expected.result_contract_hash
    {
        return Err(media_projection_unprovenanced());
    }
    Ok(())
}

/// The request carrier used while executing an action-hosted child is not the
/// authoritative idempotency carrier. Close the proof against the identity
/// independently supplied to this storage call.
/// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
fn validate_staged_media_projection_commit_identity(
    proof: &crate::runtime::StagedMediaProjectionProofV1,
    identity: Option<&ClientMutationIdentity>,
) -> SnapbackResult<()> {
    let expected = match identity {
        Some(identity) => crate::runtime::MediaProjectionClientMutationIdentityV1::ClientMutation(
            identity.activity_digest(),
        ),
        None => crate::runtime::MediaProjectionClientMutationIdentityV1::NoClientIdentity,
    };
    if proof.binding.client_mutation_identity != expected {
        return Err(media_projection_unprovenanced());
    }
    Ok(())
}

/// Replace physical media asset ids with the two-member public projection
/// while the caller's exact read/commit transaction is still pinned.
/// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
pub(crate) fn project_media_fields_on(
    conn: &Connection,
    table: &TableManifest,
    document: &mut Value,
) -> SnapbackResult<()> {
    let object = document
        .as_object_mut()
        .ok_or_else(crate::assets::media_projection_integrity)?;
    for field in &table.fields {
        let FieldType::AssetRef {
            media: Some(media), ..
        } = &field.field_type
        else {
            continue;
        };
        let Some(value) = object.get_mut(&field.name) else {
            return Err(crate::assets::media_projection_integrity());
        };
        if value.is_null() {
            continue;
        }
        // @ref LLP 0244#d2-kind-is-disclosed-with-field-delivery-policy-produces-denied
        // — this dormant class-M seam deliberately does not consult asset
        //   read policy. LLP 0235 activation will replace `true` with the
        //   exact field program without changing the media operator.
        if !media_field_disclosed_v1(&table.name, &field.name) {
            *value = Value::Null;
            continue;
        }
        let asset_id = value
            .as_str()
            .ok_or_else(crate::assets::media_projection_integrity)?
            .to_owned();
        let (stored_kind, _) = media_projection_related_facts_on(conn, &asset_id)?;
        if !media.kinds.contains(&stored_kind) {
            return Err(crate::assets::media_projection_integrity());
        }
        let kind = serde_json::to_value(stored_kind)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .ok_or_else(crate::assets::media_projection_integrity)?;
        *value = serde_json::json!({ "assetId": asset_id, "kind": kind });
    }
    Ok(())
}

pub(crate) const MEDIA_PROJECTION_DEPENDENCY_FIELD_V1: &str = "mediaProjection.v1";

/// Digest the exact finalized asset and primary-rendition facts consumed by
/// `MediaKindProjectV1`. This is deliberately narrower than asset-read policy:
/// delivery authority may move without changing the disclosed coarse kind.
/// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
fn media_projection_related_facts_on(
    conn: &Connection,
    asset_id: &str,
) -> SnapbackResult<(crate::contract_types::MediaKindV1, String)> {
    let asset = conn
        .query_row(
            "SELECT availability, media_kind, record_json
               FROM _snapback_asset_records_v1 WHERE asset_id = ?1",
            [asset_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(crate::assets::media_projection_integrity)?;
    let record: crate::assets::AssetRecordV1 =
        serde_json::from_str(&asset.2).map_err(|_| crate::assets::media_projection_integrity())?;
    let record_kind = record
        .media_kind
        .ok_or_else(crate::assets::media_projection_integrity)?;
    let column_kind: crate::contract_types::MediaKindV1 = asset
        .1
        .as_deref()
        .map(|kind| serde_json::from_value(Value::String(kind.to_owned())))
        .transpose()
        .map_err(|_| crate::assets::media_projection_integrity())?
        .ok_or_else(crate::assets::media_projection_integrity)?;
    let rendition_id = record
        .primary_rendition_id
        .as_deref()
        .ok_or_else(crate::assets::media_projection_integrity)?;
    let rendition = crate::assets::load_rendition(conn, rendition_id)?
        .ok_or_else(crate::assets::media_projection_integrity)?;
    let detected_content_type = rendition
        .media_facts
        .as_ref()
        .and_then(|facts| facts.get("contentType"))
        .and_then(Value::as_str)
        .ok_or_else(crate::assets::media_projection_integrity)?;
    let detected_kind = crate::assets::media_kind_for_detected_content_type(detected_content_type);
    if asset.0 != "ready"
        || record.availability != crate::assets::AssetAvailability::Ready
        || record_kind != column_kind
        || record_kind != detected_kind
        || rendition.asset_id != asset_id
        || rendition.variant_key != crate::assets::ASSET_RENDITION_PRIMARY
        || rendition.state != crate::assets::AssetRenditionState::Ready
    {
        return Err(crate::assets::media_projection_integrity());
    }
    let facts = json!({
        "assetId": asset_id,
        "availability": record.availability,
        "lifecycleGeneration": record.lifecycle_generation,
        "mediaKind": record_kind,
        "primaryRenditionId": rendition_id,
        "renditionState": rendition.state,
        "detectedContentType": detected_content_type,
        "classificationProfile": "detected-content-type.v1",
    });
    let canonical = crate::rqs_contract::jcs(&facts)
        .map_err(|_| crate::assets::media_projection_integrity())?;
    let mut digest = Sha256::new();
    digest.update(b"snapback:media-projection-related-facts:v1\n");
    digest.update(canonical.as_bytes());
    Ok((record_kind, format!("sha256:{:x}", digest.finalize())))
}

pub(crate) fn media_projection_fact_digest_on(
    conn: &Connection,
    asset_id: &str,
) -> SnapbackResult<String> {
    media_projection_related_facts_on(conn, asset_id).map(|(_, digest)| digest)
}

// @ref LLP 0244#d2-kind-is-disclosed-with-field-delivery-policy-produces-denied
// @ref LLP 0235#22-logical-plan-position-audit — class-M is dormant in this
//   shipped subset, but the operator's physical branch is explicit so later
//   activation cannot accidentally turn a masked edge into a metadata probe.
fn media_field_disclosed_v1(_table: &str, _field: &str) -> bool {
    true
}

fn record_change(
    tx: &Transaction<'_>,
    version: u64,
    table: &str,
    id: &str,
    op: ChangeOp,
    row: Option<&Value>,
    now_ms: u64,
) -> SnapbackResult<()> {
    record_change_with_operation_id(tx, version, table, id, op, row, now_ms, None)
}

/// The canonical promotion seam is the only writer outside `LocalDatabase`'s
/// generated mutation executors. It uses the same change/history journal path
/// and binds history rows to the aggregate promotion operation identity.
///
/// @ref LLP 0162#5-promotion-stays-strict-and-merge-free — promotion publishes
/// one canonical version with durable write and operation-envelope truth.
#[allow(clippy::too_many_arguments)]
pub(crate) fn record_promotion_change(
    tx: &Transaction<'_>,
    version: u64,
    table: &str,
    id: &str,
    op: ChangeOp,
    row: Option<&Value>,
    now_ms: u64,
    operation_id: &str,
) -> SnapbackResult<()> {
    record_change_with_operation_id(tx, version, table, id, op, row, now_ms, Some(operation_id))
}

#[allow(clippy::too_many_arguments)]
fn record_change_with_operation_id(
    tx: &Transaction<'_>,
    version: u64,
    table: &str,
    id: &str,
    op: ChangeOp,
    row: Option<&Value>,
    now_ms: u64,
    operation_id: Option<&str>,
) -> SnapbackResult<()> {
    let operation = match op {
        ChangeOp::Insert => "insert",
        ChangeOp::Update => "update",
        ChangeOp::Delete => "delete",
    };
    let row_json = row.map(Value::to_string);
    let version_sql = version_to_sql_integer(version)?;
    let changed_at_sql = timestamp_to_sql_millis(now_ms)?;
    let mut statement = tx.prepare_cached(
        "INSERT INTO _snapback_changes(version, table_name, row_id, op, row_json, changed_at_ms)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
    )?;
    statement.execute(params![
        version_sql,
        table,
        id,
        operation,
        row_json,
        changed_at_sql
    ])?;
    crate::proof_checkpoint::record_history_change(
        tx,
        version,
        table,
        id,
        operation,
        row_json.as_deref(),
        now_ms,
        operation_id,
    )?;
    Ok(())
}

fn set_version(tx: &Transaction<'_>, version: u64) -> SnapbackResult<()> {
    let changed = tx.execute(
        "UPDATE _snapback_version SET version = ?1 WHERE id = 1",
        params![version_to_sql_integer(version)?],
    )?;
    if changed != 1 {
        return Err(storage_version_corrupt(
            "global storage version update did not affect exactly one row",
        )
        .with_detail("updatedRows", changed));
    }
    Ok(())
}

pub(crate) fn set_promotion_version(tx: &Transaction<'_>, version: u64) -> SnapbackResult<()> {
    set_version(tx, version)
}

pub(crate) fn row_to_document(
    row: &rusqlite::Row<'_>,
    table: &TableManifest,
    columns: &[String],
) -> SnapbackResult<Value> {
    row_to_document_with_staged_nullable_fields(row, table, columns, &[])
}

/// Decode one executor-owned migration page while a newly added required
/// field is deliberately nullable between its DDL and backfill steps. This is
/// not an application read relaxation: the migration barrier is closed, the
/// exception is one exact destination field, and every other representation
/// remains strict.
///
/// @ref LLP 0081#4-execution-journaling-and-crash-recovery — staged required
///   columns are added nullable and become authoritative only after backfill,
///   verification, and the publication transaction.
fn row_to_document_with_staged_nullable_fields(
    row: &rusqlite::Row<'_>,
    table: &TableManifest,
    columns: &[String],
    staged_nullable_fields: &[&str],
) -> SnapbackResult<Value> {
    let mut document = Map::new();
    for (index, column) in columns.iter().enumerate() {
        let raw = row.get_ref(index)?;
        let value = if column == "_version" {
            // @ref LLP 0007#commit-version-graduation-dk-2-decided-2026-07-02 —
            // managed-row cursors share the exact portable ordering domain;
            // corruption must not escape through query/get/admin projections.
            let ValueRef::Integer(version) = raw else {
                return Err(SnapbackError::error(
                    "SNAPBACK_STORAGE_VERSION_CORRUPT",
                    "storage",
                    "row storage version is not an integer",
                ));
            };
            Value::Number(Number::from(decode_required_committed_version(
                SqlValue::Integer(version),
                "row storage version",
            )?))
        } else {
            sqlite_to_json_with_staged_null(
                raw,
                table.field(column),
                &table.name,
                column,
                staged_nullable_fields.contains(&column.as_str()),
            )?
        };
        document.insert(column.clone(), value);
    }
    Ok(Value::Object(document))
}

/// Decode only the physical representation the declared portable type writes.
/// SQLite affinity is deliberately permissive, so a direct or damaged writer
/// can otherwise turn `Boolean(2)` into `true`, return a TEXT Integer as a
/// string, or replace invalid UTF-8 before a caller sees the corruption.
///
/// @ref LLP 0007#data-model — the writer and reader must assert one
///   single-sourced physical representation for every portable type.
#[cfg(test)]
fn sqlite_to_json(
    value: ValueRef<'_>,
    field: Option<&FieldManifest>,
    table: &str,
    column: &str,
) -> SnapbackResult<Value> {
    sqlite_to_json_with_staged_null(value, field, table, column, false)
}

fn sqlite_to_json_with_staged_null(
    value: ValueRef<'_>,
    field: Option<&FieldManifest>,
    table: &str,
    column: &str,
    staged_null_allowed: bool,
) -> SnapbackResult<Value> {
    if field.is_none() {
        match column {
            "_id" => {
                let ValueRef::Text(bytes) = value else {
                    return Err(storage_field_corrupt(table, column, "TEXT", value));
                };
                return decode_storage_text(bytes, table, column).map(Value::String);
            }
            "_createdAt" | "_updatedAt" => {
                let ValueRef::Integer(timestamp) = value else {
                    return Err(storage_field_corrupt(
                        table,
                        column,
                        "portable non-negative INTEGER",
                        value,
                    ));
                };
                if !(0..=crate::manifest::PORTABLE_TIMESTAMP_MAX_MS as i64).contains(&timestamp) {
                    return Err(storage_field_corrupt(
                        table,
                        column,
                        "portable non-negative INTEGER",
                        value,
                    ));
                }
                return Ok(Value::Number(Number::from(timestamp)));
            }
            _ => {}
        }
    }

    let Some(field) = field else {
        // Additive schema evolution retains removed physical columns. They no
        // longer have a current declaration to assert, so preserve the legacy
        // scalar decoder while still refusing lossy TEXT and undeclared BLOB.
        return match value {
            ValueRef::Null => Ok(Value::Null),
            ValueRef::Integer(value) => Ok(Value::Number(Number::from(value))),
            ValueRef::Real(value) => Number::from_f64(value).map(Value::Number).ok_or_else(|| {
                storage_field_corrupt(table, column, "finite REAL", ValueRef::Real(value))
            }),
            ValueRef::Text(bytes) => decode_storage_text(bytes, table, column).map(Value::String),
            ValueRef::Blob(_) => Err(storage_field_corrupt(
                table,
                column,
                "portable scalar",
                value,
            )),
        };
    };

    if matches!(value, ValueRef::Null) {
        return if field.optional || staged_null_allowed {
            Ok(Value::Null)
        } else {
            Err(storage_field_corrupt(
                table,
                column,
                sqlite_type(&field.field_type),
                value,
            ))
        };
    }

    match (&field.field_type, value) {
        (
            FieldType::String
            | FieldType::Enum { .. }
            | FieldType::Principal
            | FieldType::Id { .. }
            | FieldType::RelationIncarnation { .. }
            | FieldType::AssetRef { .. },
            ValueRef::Text(bytes),
        ) => decode_storage_text(bytes, table, column).map(Value::String),
        (FieldType::Boolean, ValueRef::Integer(0)) => Ok(Value::Bool(false)),
        (FieldType::Boolean, ValueRef::Integer(1)) => Ok(Value::Bool(true)),
        (FieldType::Integer, ValueRef::Integer(value))
            if (PORTABLE_INTEGER_MIN..=PORTABLE_INTEGER_MAX).contains(&value) =>
        {
            Ok(Value::Number(Number::from(value)))
        }
        (FieldType::Real, ValueRef::Real(value)) => {
            Number::from_f64(value).map(Value::Number).ok_or_else(|| {
                storage_field_corrupt(table, column, "finite REAL", ValueRef::Real(value))
            })
        }
        (FieldType::Json, ValueRef::Text(bytes)) => {
            let text = decode_storage_text(bytes, table, column)?;
            serde_json::from_str(&text).map_err(|error| {
                storage_field_corrupt(table, column, "UTF-8 JSON TEXT", ValueRef::Text(bytes))
                    .with_detail("error", error.to_string())
            })
        }
        (
            FieldType::Structured {
                contract,
                contract_hash,
            },
            ValueRef::Text(bytes),
        ) => {
            let text = decode_storage_text(bytes, table, column)?;
            if text.len() > MAX_STORED_STRUCTURED_VALUE_BYTES {
                return Err(storage_field_corrupt(
                    table,
                    column,
                    "bounded RFC 8785 JSON TEXT",
                    ValueRef::Text(bytes),
                ));
            }
            let value: Value = serde_json::from_str(&text).map_err(|error| {
                storage_field_corrupt(table, column, "RFC 8785 JSON TEXT", ValueRef::Text(bytes))
                    .with_detail("error", error.to_string())
            })?;
            let canonical = crate::rqs_contract::jcs(&value).map_err(|_| {
                storage_field_corrupt(table, column, "RFC 8785 JSON TEXT", ValueRef::Text(bytes))
            })?;
            if canonical.as_bytes() != bytes {
                return Err(storage_field_corrupt(
                    table,
                    column,
                    "canonical RFC 8785 JSON TEXT",
                    ValueRef::Text(bytes),
                ));
            }
            crate::args_contract::validate_stored_structured_value(
                table,
                column,
                contract_hash,
                &contract.descriptor,
                &value,
            )?;
            Ok(value)
        }
        (FieldType::Vector { dimensions }, ValueRef::Blob(bytes)) => {
            let components = crate::vector::storage::decode_vector_binary64_le(bytes, *dimensions)?;
            Ok(Value::Array(
                components
                    .into_iter()
                    .map(|component| {
                        Number::from_f64(component)
                            .map(Value::Number)
                            .ok_or_else(crate::vector::diagnostics::index_corrupt)
                    })
                    .collect::<SnapbackResult<Vec<_>>>()?,
            ))
        }
        (field_type, value) => Err(storage_field_corrupt(
            table,
            column,
            sqlite_type(field_type),
            value,
        )),
    }
}

fn decode_storage_text(bytes: &[u8], table: &str, column: &str) -> SnapbackResult<String> {
    std::str::from_utf8(bytes)
        .map(ToOwned::to_owned)
        .map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_STORAGE_FIELD_CORRUPT",
                "storage",
                "stored TEXT field is not valid UTF-8",
            )
            .with_detail("table", table.to_owned())
            .with_detail("field", column.to_owned())
            .with_detail("expectedStorageClass", "UTF-8 TEXT")
            .with_detail("actualStorageClass", "non-UTF-8 TEXT")
        })
}

fn storage_field_corrupt(
    table: &str,
    column: &str,
    expected: &str,
    actual: ValueRef<'_>,
) -> SnapbackError {
    let actual = match actual {
        ValueRef::Null => "NULL",
        ValueRef::Integer(_) => "INTEGER",
        ValueRef::Real(_) => "REAL",
        ValueRef::Text(_) => "TEXT",
        ValueRef::Blob(_) => "BLOB",
    };
    SnapbackError::error(
        "SNAPBACK_STORAGE_FIELD_CORRUPT",
        "storage",
        "stored field does not match its declared portable representation",
    )
    .with_detail("table", table.to_owned())
    .with_detail("field", column.to_owned())
    .with_detail("expectedStorageClass", expected.to_owned())
    .with_detail("actualStorageClass", actual)
}

// Plain JSON/JavaScript is the v0 portable wire, so declared Integer fields
// use the one range every target represents without aliases. Exact i64 needs
// a future tagged/string encoding rather than target-dependent acceptance.
// @ref LLP 0007#data-model — portable v0 integers are JavaScript-safe signed integers.
const PORTABLE_INTEGER_MAX: i64 = 9_007_199_254_740_991;
const PORTABLE_INTEGER_MIN: i64 = -PORTABLE_INTEGER_MAX;

// OQ3's implementation-time provisional numbers, frozen for Phase A.
// @ref LLP 0211#representation-and-write-path — admission bounds the
// structured contribution without claiming a complete live-envelope bound.
pub(crate) const MAX_STORED_STRUCTURED_VALUE_BYTES: usize = 32 * 1024;
pub(crate) const MAX_STORED_STRUCTURED_ROW_BYTES: usize = 48 * 1024;

fn portable_integer_value(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .filter(|value| (PORTABLE_INTEGER_MIN..=PORTABLE_INTEGER_MAX).contains(value))
        .or_else(|| {
            value.as_u64().and_then(|value| {
                if value <= PORTABLE_INTEGER_MAX as u64 {
                    Some(value as i64)
                } else {
                    None
                }
            })
        })
        .or_else(|| {
            value.as_f64().and_then(|value| {
                if value.is_finite()
                    && value.fract() == 0.0
                    && value >= PORTABLE_INTEGER_MIN as f64
                    && value <= PORTABLE_INTEGER_MAX as f64
                {
                    Some(value as i64)
                } else {
                    None
                }
            })
        })
}

fn json_to_sql_value(value: &Value, field_type: Option<&FieldType>) -> SnapbackResult<SqlValue> {
    json_to_sql_value_with_context(value, field_type, None)
}

fn json_to_sql_value_for_field(
    value: &Value,
    field_type: &FieldType,
    table: &str,
    field: &str,
) -> SnapbackResult<SqlValue> {
    json_to_sql_value_with_context(value, Some(field_type), Some((table, field)))
}

fn json_to_sql_value_with_context(
    value: &Value,
    field_type: Option<&FieldType>,
    write_context: Option<(&str, &str)>,
) -> SnapbackResult<SqlValue> {
    if value.is_null() {
        return Ok(SqlValue::Null);
    }

    match field_type {
        None if value.is_string() => value
            .as_str()
            .map(|value| SqlValue::Text(value.to_owned()))
            .ok_or_else(|| type_error("string", value)),
        None if value.is_boolean() => value
            .as_bool()
            .map(|value| SqlValue::Integer(i64::from(value)))
            .ok_or_else(|| type_error("boolean", value)),
        None if value.as_i64().is_some() || value.as_u64().is_some() => value
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| {
                value.as_u64().and_then(|value| {
                    if value <= i64::MAX as u64 {
                        Some(SqlValue::Integer(value as i64))
                    } else {
                        None
                    }
                })
            })
            .ok_or_else(|| type_error("integer", value)),
        None if value.is_number() => value
            .as_f64()
            .map(SqlValue::Real)
            .ok_or_else(|| type_error("real", value)),
        None => Err(type_error("portable scalar", value)),
        // A principal is nominal typing over the string space: it stores and
        // coerces exactly like a String (LLP 0056 §Declaring a membership table).
        Some(FieldType::AssetRef { media: Some(_), .. }) if !value.is_string() => {
            Err(SnapbackError::error(
                "SNAPBACK_MEDIA_WRITE_FORGED_KIND",
                "assets",
                "v.media() write input must be an asset-id string, not a projected MediaRef",
            ))
        }
        Some(FieldType::String)
        | Some(FieldType::Principal)
        | Some(FieldType::Id { .. })
        | Some(FieldType::RelationIncarnation { .. })
        | Some(FieldType::AssetRef { .. }) => value
            .as_str()
            .map(|value| SqlValue::Text(value.to_owned()))
            .ok_or_else(|| type_error("string", value)),
        Some(FieldType::Enum { values }) => {
            let string = value
                .as_str()
                .ok_or_else(|| type_error("enum string", value))?;
            // @ref LLP 0004#dated-alignment-stored-literal-union-domains-2026-08-08
            //   the central stored-value coercion is the sole domain guard for
            //   inserts, patches, seeds, and every buffered writer.
            if let Some((table, field)) = write_context
                && !values.iter().any(|admitted| admitted == string)
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_FIELD_ENUM_VALUE_INVALID",
                    "storage",
                    format!(
                        "field {table}.{field} must be one of the admitted values {:?}",
                        values
                    ),
                )
                .with_detail("table", table.to_owned())
                .with_detail("field", field.to_owned())
                .with_detail("value", string.to_owned())
                .with_detail("admitted", values.clone()));
            }
            Ok(SqlValue::Text(string.to_owned()))
        }
        Some(FieldType::Boolean) => value
            .as_bool()
            .map(|value| SqlValue::Integer(i64::from(value)))
            .ok_or_else(|| type_error("boolean", value)),
        Some(FieldType::Integer) => portable_integer_value(value)
            .map(SqlValue::Integer)
            .ok_or_else(|| type_error("integer", value)),
        Some(FieldType::Real) => value
            .as_f64()
            .map(SqlValue::Real)
            .ok_or_else(|| type_error("real", value)),
        Some(FieldType::Vector { dimensions }) => {
            let components = value
                .as_array()
                .ok_or_else(crate::vector::diagnostics::value_invalid)?
                .iter()
                .map(|component| {
                    component
                        .as_f64()
                        .ok_or_else(crate::vector::diagnostics::value_invalid)
                })
                .collect::<SnapbackResult<Vec<_>>>()?;
            crate::vector::storage::encode_vector_binary64_le(&components, *dimensions)
                .map(SqlValue::Blob)
        }
        Some(FieldType::Structured {
            contract,
            contract_hash,
        }) => {
            let Some((table, field)) = write_context else {
                return Err(SnapbackError::error(
                    "SNAPBACK_STRUCTURED_WRITE_CONTEXT_MISSING",
                    "storage",
                    "structured values require their declared field context at admission",
                ));
            };
            let (_, canonical) = canonicalize_stored_structured_value(
                table,
                field,
                contract_hash,
                &contract.descriptor,
                value,
            )?;
            Ok(SqlValue::Text(canonical))
        }
        Some(FieldType::Json) => {
            serde_json::to_string(value)
                .map(SqlValue::Text)
                .map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_JSON_SERIALIZE_FAILED",
                        "storage",
                        "JSON field could not be serialized",
                    )
                    .with_detail("error", error.to_string())
                })
        }
    }
}

fn normalize_json_value(value: Value, field_type: &FieldType) -> SnapbackResult<Value> {
    match field_type {
        FieldType::Json => Ok(value),
        FieldType::Structured {
            contract,
            contract_hash,
        } => canonicalize_stored_structured_value(
            "<internal>",
            "<internal>",
            contract_hash,
            &contract.descriptor,
            &value,
        )
        .map(|(value, _)| value),
        FieldType::Enum { .. } => {
            json_to_sql_value(&value, Some(field_type))?;
            Ok(value)
        }
        // @ref LLP 0073#authorization-and-result-release — a validator-accepted
        // integral Real (JSON `5`) would otherwise stay an integer in the
        // in-memory document while the same row reloads from a SQLite REAL
        // column as `5.0`; admission pins the round-trip representation so
        // in-memory and reloaded documents never diverge.
        FieldType::Real if !value.is_null() => value
            .as_f64()
            .and_then(Number::from_f64)
            .map(Value::Number)
            .ok_or_else(|| type_error("real", &value)),
        FieldType::Vector { dimensions } if !value.is_null() => {
            let components = value
                .as_array()
                .ok_or_else(crate::vector::diagnostics::value_invalid)?
                .iter()
                .map(|component| {
                    component
                        .as_f64()
                        .ok_or_else(crate::vector::diagnostics::value_invalid)
                })
                .collect::<SnapbackResult<Vec<_>>>()?;
            let bytes =
                crate::vector::storage::encode_vector_binary64_le(&components, *dimensions)?;
            let canonical = crate::vector::storage::decode_vector_binary64_le(&bytes, *dimensions)?;
            Ok(Value::Array(
                canonical
                    .into_iter()
                    .map(|component| {
                        Number::from_f64(component)
                            .map(Value::Number)
                            .ok_or_else(crate::vector::diagnostics::value_invalid)
                    })
                    .collect::<SnapbackResult<Vec<_>>>()?,
            ))
        }
        _ => {
            json_to_sql_value(&value, Some(field_type))?;
            Ok(value)
        }
    }
}

fn canonicalize_stored_structured_value(
    table: &str,
    field: &str,
    contract_hash: &str,
    descriptor: &crate::manifest::ResultValueContract,
    value: &Value,
) -> SnapbackResult<(Value, String)> {
    crate::args_contract::validate_stored_structured_value(
        table,
        field,
        contract_hash,
        descriptor,
        value,
    )?;
    let canonical = crate::rqs_contract::jcs(value).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_STRUCTURED_VALUE_INVALID",
            "storage",
            "stored structured value is outside the RFC 8785 numeric/string profile",
        )
        .with_detail("table", table.to_owned())
        .with_detail("field", field.to_owned())
        .with_detail("contractHash", contract_hash.to_owned())
        .with_detail("path", "")
    })?;
    if canonical.len() > MAX_STORED_STRUCTURED_VALUE_BYTES {
        return Err(SnapbackError::error(
            "SNAPBACK_STRUCTURED_VALUE_BYTES_EXCEEDED",
            "storage",
            "stored structured value exceeds the canonical-byte ceiling",
        )
        .with_detail("table", table.to_owned())
        .with_detail("field", field.to_owned())
        .with_detail("path", "")
        .with_detail("actualBytes", canonical.len() as u64)
        .with_detail("maxBytes", MAX_STORED_STRUCTURED_VALUE_BYTES as u64));
    }
    // Reparse the exact durable spelling. This is the admission-normalization
    // step: an interior integral Real whose JCS spelling is `5` becomes the
    // same logical integer-valued JSON number an immediate reload observes.
    let normalized = serde_json::from_str(&canonical).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_STRUCTURED_VALUE_INVALID",
            "storage",
            "canonical structured value could not be reparsed",
        )
        .with_detail("table", table.to_owned())
        .with_detail("field", field.to_owned())
        .with_detail("path", "")
        .with_detail("error", error.to_string())
    })?;
    Ok((normalized, canonical))
}

fn prepare_declared_field_value(
    table: &str,
    field: &FieldManifest,
    value: &Value,
) -> SnapbackResult<(Value, SqlValue, usize)> {
    validate_declared_field_value(field, value)?;
    if value.is_null() {
        return Ok((Value::Null, SqlValue::Null, 0));
    }
    if let FieldType::Structured {
        contract,
        contract_hash,
    } = &field.field_type
    {
        let (normalized, canonical) = canonicalize_stored_structured_value(
            table,
            &field.name,
            contract_hash,
            &contract.descriptor,
            value,
        )?;
        let bytes = canonical.len();
        return Ok((normalized, SqlValue::Text(canonical), bytes));
    }
    let sql = json_to_sql_value_for_field(value, &field.field_type, table, &field.name)?;
    let normalized = normalize_json_value(value.clone(), &field.field_type)?;
    Ok((normalized, sql, 0))
}

fn validate_structured_row_aggregate(
    table: &TableManifest,
    values: &Map<String, Value>,
) -> SnapbackResult<usize> {
    let mut total = 0_usize;
    for field in &table.fields {
        if !matches!(field.field_type, FieldType::Structured { .. }) {
            continue;
        }
        let Some(value) = values.get(&field.name) else {
            continue;
        };
        if value.is_null() {
            continue;
        }
        let (_, _, bytes) = prepare_declared_field_value(&table.name, field, value)?;
        total = total.saturating_add(bytes);
    }
    if total > MAX_STORED_STRUCTURED_ROW_BYTES {
        return Err(SnapbackError::error(
            "SNAPBACK_STRUCTURED_ROW_BYTES_EXCEEDED",
            "storage",
            "row exceeds the aggregate structured canonical-byte ceiling",
        )
        .with_detail("table", table.name.clone())
        .with_detail("path", "")
        .with_detail("actualBytes", total as u64)
        .with_detail("maxBytes", MAX_STORED_STRUCTURED_ROW_BYTES as u64));
    }
    Ok(total)
}

fn validate_declared_field_value(field: &FieldManifest, value: &Value) -> SnapbackResult<()> {
    if value.is_null() && !field.optional {
        return Err(type_error(field_type_name(&field.field_type), value));
    }
    Ok(())
}

fn type_error(expected: &str, value: &Value) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_FIELD_TYPE_MISMATCH",
        "storage",
        format!("expected {expected} value"),
    )
    .with_detail("value", value.clone())
}

fn schema_table<'a>(schema: &'a SchemaManifest, table: &str) -> SnapbackResult<&'a TableManifest> {
    if !schema
        .asset_collections
        .iter()
        .any(|collection| collection.child_table == table)
    {
        validate_user_identifier("table", table)?;
    }
    schema.table(table).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_UNKNOWN_TABLE",
            "schema",
            format!("unknown table {table}"),
        )
    })
}

#[derive(Clone, Copy)]
pub(crate) enum GenericTableWriteFormV1 {
    Insert,
    InsertEach,
    Patch,
    Delete,
    DeleteWhere,
}

impl GenericTableWriteFormV1 {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Insert => "insert",
            Self::InsertEach => "insert-each",
            Self::Patch => "patch",
            Self::Delete => "delete",
            Self::DeleteWhere => "delete-where",
        }
    }
}

/// Resolve the one installed table-policy locus for a generic write. This is
/// deliberately below both generated guards and handler-declared write sets.
/// Phase 1a returns `None` only for the declared-non-owner migration window;
/// authority tables and omission still refuse here, while `Some(field)` enters
/// the complete owner enforcement path.
///
/// @ref LLP 0264#d2-v1-default-write-posture-by-policy-kind
/// @ref LLP 0264#d6-authority-tables-and-membershiprole-writes-stay-specialized
/// @ref LLP 0264#migration-and-rollout
pub(crate) fn generic_owner_write_field<'a>(
    table: &'a TableManifest,
    form: GenericTableWriteFormV1,
) -> SnapbackResult<Option<&'a str>> {
    // Authority tables never enter owner enforcement, and their runtime
    // refusal belongs to the pre-existing specialized membership/permission
    // seam (SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED /
    // SNAPBACK_MEMBERSHIP_HOSTPLAN_WRITE_DENIED and the permission-backing
    // guard), which covers every generic path. Codegen still refuses declared
    // writes statically with SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE.
    //
    // @ref LLP 0264#d6-authority-tables-and-membershiprole-writes-stay-specialized
    if table.membership.is_some() || table.permission_backing {
        let _ = form;
        return Ok(None);
    }
    match table.visibility.as_ref() {
        Some(TableVisibilityV1::Owner { field }) => Ok(Some(field)),
        // LLP 0264 Phase 1a stages declared non-owner tables at codegen. They
        // retain the exact pre-0264 runtime path until the corpus closure
        // permits Phase 1b to flip this arm to a refusal.
        Some(
            TableVisibilityV1::PublicRead
            | TableVisibilityV1::Membership { .. }
            | TableVisibilityV1::AnyOf { .. },
        ) => Ok(None),
        None => Err(SnapbackError::error(
            "SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED",
            "auth",
            "generic writes require an installed table policy",
        )
        .with_details(json!({
            "table": table.name,
            "writeForm": form.as_str(),
        }))),
    }
}

fn owner_row_matches(row: Option<&Value>, owner_field: &str, principal: Option<&str>) -> bool {
    row.and_then(Value::as_object)
        .and_then(|row| row.get(owner_field))
        .and_then(Value::as_str)
        .zip(principal)
        .is_some_and(|(owner, principal)| owner == principal)
}

fn owner_write_refusal(disposition: &OwnerWriteAbsentDispositionV1) -> SnapbackResult<()> {
    match disposition {
        OwnerWriteAbsentDispositionV1::NoEffect => Ok(()),
        OwnerWriteAbsentDispositionV1::Refuse {
            code,
            message,
            details,
            ..
        } => Err(SnapbackError::error(code, "handler", message).with_details(details.clone())),
    }
}

fn owner_write_disposition_digest(
    code: &str,
    message: &str,
    details: &Value,
) -> SnapbackResult<String> {
    let bytes = crate::rqs_contract::jcs(&json!({
        "code": code,
        "message": message,
        "details": details,
    }))
    .map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE",
            "auth",
            "owner-write refusal bytes are not canonically serializable",
        )
    })?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn owner_write_check_for_step<'a>(
    checks: &'a [OwnerWriteCheckV1],
    step_index: usize,
) -> Option<&'a OwnerWriteCheckV1> {
    checks.iter().find(|check| check.step_index == step_index)
}

fn ensure_field<'a>(table: &'a TableManifest, field: &str) -> SnapbackResult<&'a FieldManifest> {
    validate_user_identifier("field", field)?;
    table.field(field).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_UNKNOWN_FIELD",
            "schema",
            "the requested field is not in the served table schema",
        )
        .with_details(crate::authoring_suggestion::unknown_schema_field_details(
            table, field,
        ))
    })
}

fn ensure_field_or_system(table: &TableManifest, field: &str) -> SnapbackResult<()> {
    if is_system_field(field) {
        return Ok(());
    }
    ensure_field(table, field).map(|_| ())
}

fn ensure_orderable_field(table: &TableManifest, field: &str) -> SnapbackResult<()> {
    ensure_field_or_system(table, field)?;
    if matches!(
        field_type(table, field),
        Some(FieldType::Json | FieldType::Structured { .. })
    ) {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_ORDER_UNSUPPORTED_FIELD_TYPE",
            "query",
            format!(
                "query order field {}.{field} has opaque Json/Structured type",
                table.name
            ),
        )
        .with_detail("table", table.name.clone())
        .with_detail("field", field.to_owned())
        .with_detail("fieldType", "Json"));
    }
    Ok(())
}

fn field_type<'a>(table: &'a TableManifest, field: &str) -> Option<&'a FieldType> {
    table.field(field).map(|field| &field.field_type)
}

fn is_system_field(field: &str) -> bool {
    matches!(field, "_id" | "_version" | "_createdAt" | "_updatedAt")
}

fn sqlite_type(field_type: &FieldType) -> &'static str {
    match field_type {
        FieldType::String
        | FieldType::Enum { .. }
        | FieldType::Json
        | FieldType::Structured { .. }
        | FieldType::Principal
        | FieldType::Id { .. }
        | FieldType::RelationIncarnation { .. }
        | FieldType::AssetRef { .. } => "TEXT",
        FieldType::Boolean | FieldType::Integer => "INTEGER",
        FieldType::Real => "REAL",
        // The portable v1 storage profile pins vectors to canonical binary64
        // bytes in a BLOB. Target publication remains separately gated; the
        // internal SQLite adapter can build and transactionally maintain its
        // unqualified shadow generations without flipping that claim.
        // @ref LLP 0132#index-maintenance-and-storage
        FieldType::Vector { .. } => "BLOB",
    }
}

fn validate_user_identifier(kind: &str, value: &str) -> SnapbackResult<()> {
    if !is_user_identifier(value) {
        return Err(SnapbackError::error(
            "SNAPBACK_INVALID_IDENTIFIER",
            "schema",
            format!("invalid {kind} identifier {value}"),
        ));
    }
    Ok(())
}

fn validate_retained_sequence_allocations(facts: &[SequenceAllocationFact]) -> SnapbackResult<()> {
    let invalid = || {
        SnapbackError::error(
            "SNAPBACK_CLIENT_MUTATION_RESULT_INVALID",
            "storage",
            "stored client mutation sequence facts are invalid",
        )
    };
    if facts.len() > 1 {
        return Err(invalid());
    }
    for fact in facts {
        if !sequence_allocation_fact_is_valid(fact) {
            return Err(invalid());
        }
    }
    Ok(())
}

fn sequence_allocation_fact_is_valid(fact: &SequenceAllocationFact) -> bool {
    is_user_identifier(&fact.counter)
        && is_user_identifier(&fact.scope_table)
        && replay_opaque_id_is_valid(&fact.scope_row_id)
        && crate::ids::is_canonical_uuid_v7(&fact.scope_incarnation)
        && (1..=SEQUENCE_MAX_SAFE_INTEGER).contains(&fact.value)
}

pub(crate) fn validate_sequence_allocation_fact(
    fact: &SequenceAllocationFact,
) -> SnapbackResult<()> {
    if sequence_allocation_fact_is_valid(fact) {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
        "storage",
        "sequence allocation fact is outside the durable replay grammar",
    ))
}

/// `_auth` is a complete namespace root, and SQLite folds ASCII identifier
/// case. Keep this predicate shared by manifest and runtime name resolvers so
/// no casing variant becomes an alternate path into the protected catalog.
///
/// @ref LLP 0057#reservation — absolute ASCII-case-insensitive reservation.
pub(crate) fn is_auth_reserved_identifier(value: &str) -> bool {
    let folded = value.to_ascii_lowercase();
    folded == "_auth" || folded.starts_with("_auth_")
}

pub(crate) fn quote_ident(value: &str) -> SnapbackResult<String> {
    if !is_identifier(value) {
        return Err(SnapbackError::error(
            "SNAPBACK_INVALID_IDENTIFIER",
            "storage",
            format!("invalid SQL identifier {value}"),
        ));
    }
    Ok(format!("\"{value}\""))
}

fn is_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first == '_' || first.is_ascii_alphabetic()) {
        return false;
    }
    chars.all(|char| char == '_' || char.is_ascii_alphanumeric())
}

fn expect_string(value: Value, label: &str) -> SnapbackResult<String> {
    value.as_str().map(ToOwned::to_owned).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_EXPECTED_STRING",
            "runtime",
            format!("{label} must evaluate to a string"),
        )
    })
}

fn validate_plan_replay_ledger(input: &HandlerInput) -> SnapbackResult<Option<&CtxAnswerLedger>> {
    validate_ctx_answer_ledger(input).map_err(Into::into)
}

struct PlanIdSource<'a> {
    replay: Option<&'a CtxAnswerLedger>,
    cursor: usize,
    generated: Vec<String>,
    occurrences: BTreeMap<String, u32>,
    observations: Vec<SettlementMintObservation>,
}

impl<'a> PlanIdSource<'a> {
    fn new(replay: Option<&'a CtxAnswerLedger>) -> Self {
        Self {
            replay,
            cursor: 0,
            generated: Vec::new(),
            occurrences: BTreeMap::new(),
            observations: Vec::new(),
        }
    }

    /// The ledgered allocator, told both the stable logical mint site and the
    /// table whose id is being minted.
    ///
    /// `Some(table)` mints the table's LLP 0148 prefix; `None` — an id minted
    /// inside a field expression, where no target table is in scope — mints the
    /// generic `id_` prefix rather than guessing a table it would then lie
    /// about.
    ///
    /// The replay arm is deliberately unaffected: on replay the id comes from
    /// the client's ledger, so client and server never both derive a prefix and
    /// cannot disagree about one.
    ///
    /// @ref LLP 0148#d6-app-document-ids-take-a-per-table-prefix
    /// @ref LLP 0133#divergence-on-settle — first-hand observations retain
    ///   exact (site, occurrence) identity; raw answer position is never a
    ///   settlement pairing key. Within one repeated site, occurrence remains
    ///   positional—the explicitly scoped fan-out residue graduated by OQ2.
    fn next_for(&mut self, site: &str, table: Option<&str>) -> SnapbackResult<String> {
        if self.generated.len() >= CTX_ANSWER_LEDGER_MAX_IDS {
            return Err(SnapbackError::error(
                "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED",
                "runtime",
                format!(
                    "mutation requested more than {} host-generated ids",
                    CTX_ANSWER_LEDGER_MAX_IDS
                ),
            ));
        }
        let id = match self.replay {
            Some(ledger) => ledger.ids.get(self.cursor).cloned().ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_CTX_LEDGER_EXHAUSTED",
                    "runtime",
                    format!(
                        "replay consumed all {} ledgered ids and the mutation asked for another",
                        ledger.ids.len()
                    ),
                )
            })?,
            None => match table {
                Some(table) => crate::ids::mint_document(table),
                None => new_id(),
            },
        };
        self.cursor += 1;
        self.generated.push(id.clone());
        let occurrence = self.occurrences.entry(site.to_owned()).or_default();
        self.observations.push(SettlementMintObservation {
            id: id.clone(),
            site: site.to_owned(),
            occurrence: *occurrence,
        });
        *occurrence += 1;
        Ok(id)
    }

    /// Record a D2 id derived from mutation-attempt identity rather than from
    /// wall time. Replay must carry the identical answer at the same site.
    /// @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation
    fn record_deterministic(&mut self, site: &str, id: String) -> SnapbackResult<String> {
        if self.generated.len() >= CTX_ANSWER_LEDGER_MAX_IDS {
            return Err(SnapbackError::error(
                "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED",
                "runtime",
                "mutation requested too many host-generated ids",
            ));
        }
        if let Some(ledger) = self.replay {
            let replayed = ledger.ids.get(self.cursor).ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_CTX_LEDGER_EXHAUSTED",
                    "runtime",
                    "replay omitted a deterministic collection item id",
                )
            })?;
            if replayed != &id {
                return Err(SnapbackError::error(
                    "SNAPBACK_CTX_LEDGER_DIVERGED",
                    "runtime",
                    "replayed collection item id differs from the mutation-attempt derivation",
                ));
            }
        }
        self.cursor += 1;
        self.generated.push(id.clone());
        let occurrence = self.occurrences.entry(site.to_owned()).or_default();
        self.observations.push(SettlementMintObservation {
            id: id.clone(),
            site: site.to_owned(),
            occurrence: *occurrence,
        });
        *occurrence += 1;
        Ok(id)
    }

    fn ensure_exact_consumption(&self) -> SnapbackResult<()> {
        if let Some(ledger) = self.replay
            && self.cursor != ledger.ids.len()
        {
            return Err(SnapbackError::error(
                "SNAPBACK_CTX_LEDGER_UNUSED_IDS",
                "runtime",
                format!(
                    "replay consumed {} of {} ledgered ids; the mutation diverged from its recording",
                    self.cursor,
                    ledger.ids.len()
                ),
            ));
        }
        Ok(())
    }
}

fn validate_client_mutation_identity(identity: &ClientMutationIdentity) -> SnapbackResult<()> {
    if !replay_opaque_id_is_valid(&identity.id) {
        return Err(SnapbackError::error(
            "SNAPBACK_CLIENT_MUTATION_ID_INVALID",
            "sync",
            "client mutation id must match the declared opaque replay-id bounds/alphabet",
        ));
    }
    // Both spellings: the authority instance is `aut_` under LLP 0148, and a
    // mutation retained before it carries a hyphenated UUIDv7. This is a shape
    // check on retained state; the authority comparison itself is unchanged.
    //
    // @ref LLP 0148#d4-the-prefix-is-never-load-bearing
    if !crate::ids::is_minted_identifier(&identity.authority_instance_id) {
        return Err(SnapbackError::error(
            "SNAPBACK_CLIENT_MUTATION_RETENTION_STATE_INVALID",
            "sync",
            "retained client mutation authority instance is not a Snapback identifier",
        ));
    }
    Ok(())
}

fn mutation_input_fingerprint(input: &HandlerInput, settlement: &MutationSettlement) -> String {
    // Correlation is receipt-routing metadata and may legitimately change on
    // app reload. Args, optimistic baseline, and replay ledger identify the
    // logical mutation and must be byte-equivalent after canonical key sort.
    // The all-default lane-Q carrier retains the pre-0133 preimage so an
    // additive server upgrade can still republish already-stored settlements.
    let value = if settlement == &MutationSettlement::default() {
        json!({
            "args": input.args,
            "readSet": input.read_set,
            "ctxLedger": input.ctx_ledger,
        })
    } else {
        json!({
            "args": input.args,
            "readSet": input.read_set,
            "ctxLedger": input.ctx_ledger,
            "settlement": settlement,
        })
    };
    let value = canonical_json(value);
    let encoded = serde_json::to_vec(&value).expect("mutation identity JSON serializes");
    let mut digest = Sha256::new();
    digest.update(encoded);
    format!("sha256:{:x}", digest.finalize())
}

fn canonical_json(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (key, canonical_json(value)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(canonical_json).collect()),
        other => other,
    }
}

/// V4's logical retained-row measure deliberately excludes SQLite row/index
/// overhead. The sequence is always exactly one big-endian/logical u64 (eight
/// bytes), independent of SQLite's variable physical integer encoding.
///
/// @ref LLP 0043#milestone-2-queued-mutation-replay — insertion admission,
/// reconstruction, acknowledgement, and collection share one byte contract.
#[allow(clippy::too_many_arguments)]
fn logical_client_mutation_retained_row_bytes_v4(
    client_mutation_id: &str,
    function: &str,
    auth_fingerprint: &str,
    authority_instance_id: Option<&str>,
    input_fingerprint: &str,
    operation_issuance_json: Option<&str>,
    output_json: &str,
    settlement_format: Option<&str>,
    settlement_record_sequence: SqlValue,
    settlement_projection_seal_json: Option<&str>,
) -> SnapbackResult<u64> {
    let settlement_format = settlement_format.ok_or_else(|| {
        invalid_client_mutation_retention_state(
            "retained settlement format is missing from byte accounting",
        )
    })?;
    match settlement_record_sequence {
        SqlValue::Integer(value)
            if value > 0
                && u64::try_from(value).is_ok_and(|value| value <= SEQUENCE_MAX_SAFE_INTEGER) => {}
        _ => {
            return Err(invalid_client_mutation_retention_state(
                "retained settlement sequence is invalid for byte accounting",
            ));
        }
    }
    let members = [
        client_mutation_id.len() as u64,
        function.len() as u64,
        auth_fingerprint.len() as u64,
        authority_instance_id.map_or(0, |value| value.len() as u64),
        input_fingerprint.len() as u64,
        operation_issuance_json.map_or(0, |value| value.len() as u64),
        output_json.len() as u64,
        settlement_format.len() as u64,
        std::mem::size_of::<u64>() as u64,
        settlement_projection_seal_json.map_or(0, |value| value.len() as u64),
    ];
    members.into_iter().try_fold(0_u64, |total, member| {
        total.checked_add(member).ok_or_else(|| {
            invalid_client_mutation_retention_state(
                "retained settlement byte accounting overflowed",
            )
        })
    })
}

fn scan_client_mutation_retention_totals(conn: &Connection) -> SnapbackResult<(u64, u64)> {
    scan_client_mutation_retention_totals_for_auth(conn, None)
}

fn scan_client_mutation_retention_totals_for_auth(
    conn: &Connection,
    auth_fingerprint: Option<&str>,
) -> SnapbackResult<(u64, u64)> {
    let mut statement = conn.prepare(
        "SELECT client_mutation_id, function, auth_fingerprint,
                authority_instance_id, input_fingerprint,
                operation_issuance_json, output_json, settlement_format,
                settlement_record_sequence, settlement_projection_seal_json
           FROM _snapback_client_mutations
          WHERE (?1 IS NULL OR auth_fingerprint = ?1)
          ORDER BY client_mutation_id",
    )?;
    let mut rows = statement.query(params![auth_fingerprint])?;
    let mut records = 0_u64;
    let mut bytes = 0_u64;
    while let Some(row) = rows.next()? {
        let client_mutation_id: String = row.get(0)?;
        let function: String = row.get(1)?;
        let row_auth_fingerprint: String = row.get(2)?;
        let authority_instance_id: Option<String> = row.get(3)?;
        let input_fingerprint: String = row.get(4)?;
        let operation_issuance_json: Option<String> = row.get(5)?;
        let output_json: String = row.get(6)?;
        let settlement_format: Option<String> = row.get(7)?;
        let settlement_record_sequence: SqlValue = row.get(8)?;
        let settlement_projection_seal_json: Option<String> = row.get(9)?;
        let row_bytes = logical_client_mutation_retained_row_bytes_v4(
            &client_mutation_id,
            &function,
            &row_auth_fingerprint,
            authority_instance_id.as_deref(),
            &input_fingerprint,
            operation_issuance_json.as_deref(),
            &output_json,
            settlement_format.as_deref(),
            settlement_record_sequence,
            settlement_projection_seal_json.as_deref(),
        )?;
        records = records.checked_add(1).ok_or_else(|| {
            invalid_client_mutation_retention_state("retained settlement row count overflowed")
        })?;
        bytes = bytes.checked_add(row_bytes).ok_or_else(|| {
            invalid_client_mutation_retention_state("retained settlement byte total overflowed")
        })?;
    }
    Ok((records, bytes))
}

fn invalid_client_mutation_retention_state(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_CLIENT_MUTATION_RETENTION_STATE_INVALID",
        "storage",
        message,
    )
}

fn meta_text(conn: &Connection, key: &str) -> SnapbackResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()?)
}

/// Startup migration helper: a missing or malformed pre-counter value asks
/// the caller to rebuild from the ledger once. Runtime accounting uses the
/// strict helper below and never treats an invalid counter as zero.
fn optional_meta_u64_lenient(conn: &Connection, key: &str) -> SnapbackResult<Option<u64>> {
    Ok(meta_text(conn, key)?.and_then(|value| value.parse().ok()))
}

fn settlement_integrity_error() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_CLIENT_MUTATION_RESULT_INTEGRITY",
        "storage",
        "stored client mutation settlement failed integrity verification",
    )
}

fn load_settlement_format_epoch_v1(
    conn: &Connection,
) -> SnapbackResult<(SettlementFormatEpochV1, u64)> {
    let epoch_json =
        meta_text(conn, META_SETTLEMENT_FORMAT_EPOCH_V1)?.ok_or_else(settlement_integrity_error)?;
    let epoch: SettlementFormatEpochV1 =
        serde_json::from_str(&epoch_json).map_err(|_| settlement_integrity_error())?;
    if epoch.store_scope_id.is_empty()
        || epoch.legacy_sequence_watermark > SEQUENCE_MAX_SAFE_INTEGER
    {
        return Err(settlement_integrity_error());
    }
    let next = optional_meta_u64(conn, META_SETTLEMENT_NEXT_SEQUENCE_V1)?
        .ok_or_else(settlement_integrity_error)?;
    if next == 0 || next > SEQUENCE_MAX_SAFE_INTEGER || next <= epoch.legacy_sequence_watermark {
        return Err(settlement_integrity_error());
    }
    Ok((epoch, next))
}

fn initialize_settlement_format_epoch_v1(tx: &Transaction<'_>) -> SnapbackResult<()> {
    let epoch_json = meta_text(tx, META_SETTLEMENT_FORMAT_EPOCH_V1)?;
    let next = optional_meta_u64(tx, META_SETTLEMENT_NEXT_SEQUENCE_V1)?;
    match (epoch_json, next) {
        (None, None) => {
            let ids = {
                let mut statement = tx.prepare(
                    "SELECT client_mutation_id
                     FROM _snapback_client_mutations
                     ORDER BY rowid",
                )?;
                statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?
            };
            let watermark = u64::try_from(ids.len()).map_err(|_| settlement_integrity_error())?;
            if watermark >= SEQUENCE_MAX_SAFE_INTEGER {
                return Err(settlement_integrity_error());
            }
            for (index, id) in ids.iter().enumerate() {
                let sequence =
                    u64::try_from(index + 1).map_err(|_| settlement_integrity_error())?;
                tx.execute(
                    "UPDATE _snapback_client_mutations
                     SET settlement_format = ?1,
                         settlement_record_sequence = ?2,
                         settlement_projection_seal_json = NULL
                     WHERE client_mutation_id = ?3",
                    params![
                        LEGACY_SETTLEMENT_FORMAT_V1,
                        i64::try_from(sequence).map_err(|_| settlement_integrity_error())?,
                        id,
                    ],
                )?;
            }
            let epoch = SettlementFormatEpochV1 {
                store_scope_id: Uuid::now_v7().to_string(),
                legacy_sequence_watermark: watermark,
            };
            let epoch_json =
                serde_json::to_string(&epoch).map_err(|_| settlement_integrity_error())?;
            tx.execute(
                "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)",
                params![META_SETTLEMENT_FORMAT_EPOCH_V1, epoch_json],
            )?;
            save_meta_u64(tx, META_SETTLEMENT_NEXT_SEQUENCE_V1, watermark + 1)?;
        }
        (Some(_), Some(_)) => {
            let (epoch, next) = load_settlement_format_epoch_v1(tx)?;
            let invalid: Option<i64> = tx
                .query_row(
                    "SELECT 1 FROM _snapback_client_mutations
                     WHERE settlement_format IS NULL
                        OR settlement_record_sequence IS NULL
                        OR typeof(settlement_record_sequence) <> 'integer'
                        OR settlement_record_sequence <= 0
                        OR settlement_record_sequence >= ?1
                     LIMIT 1",
                    params![i64::try_from(next).map_err(|_| settlement_integrity_error())?],
                    |row| row.get(0),
                )
                .optional()?;
            if invalid.is_some() {
                return Err(settlement_integrity_error());
            }
            let predecessor_misclassified: Option<i64> = tx
                .query_row(
                    "SELECT 1 FROM _snapback_client_mutations
                     WHERE (settlement_record_sequence <= ?1
                            AND settlement_format <> ?2)
                        OR (settlement_record_sequence > ?1
                            AND settlement_format = ?2)
                     LIMIT 1",
                    params![
                        i64::try_from(epoch.legacy_sequence_watermark)
                            .map_err(|_| settlement_integrity_error())?,
                        LEGACY_SETTLEMENT_FORMAT_V1,
                    ],
                    |row| row.get(0),
                )
                .optional()?;
            if predecessor_misclassified.is_some() {
                return Err(settlement_integrity_error());
            }
        }
        _ => return Err(settlement_integrity_error()),
    }
    Ok(())
}

fn settlement_jcs(value: &Value) -> SnapbackResult<String> {
    crate::rqs_contract::jcs(value).map_err(|_| settlement_integrity_error())
}

fn sha256_domain_jcs(domain: &[u8], value: &Value) -> SnapbackResult<String> {
    let canonical = settlement_jcs(value)?;
    let mut digest = Sha256::new();
    digest.update(domain);
    digest.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", digest.finalize()))
}

fn decode_settlement_record_sequence(value: SqlValue) -> SnapbackResult<u64> {
    match value {
        SqlValue::Integer(value) if value > 0 => {
            let value = u64::try_from(value).map_err(|_| settlement_integrity_error())?;
            if value <= SEQUENCE_MAX_SAFE_INTEGER {
                Ok(value)
            } else {
                Err(settlement_integrity_error())
            }
        }
        _ => Err(settlement_integrity_error()),
    }
}

fn verify_retained_settlement_carrier_v1(
    conn: &Connection,
    identity: &ClientMutationIdentity,
    settlement_format: Option<&str>,
    settlement_record_sequence: SqlValue,
    settlement_projection_seal_json: Option<&str>,
    output_json: &str,
) -> SnapbackResult<Value> {
    let (epoch, next) = load_settlement_format_epoch_v1(conn)?;
    let sequence = decode_settlement_record_sequence(settlement_record_sequence)?;
    if sequence >= next {
        return Err(settlement_integrity_error());
    }
    let format = settlement_format.ok_or_else(settlement_integrity_error)?;
    let is_legacy = sequence <= epoch.legacy_sequence_watermark;
    match format {
        LEGACY_SETTLEMENT_FORMAT_V1 if is_legacy => {
            if settlement_projection_seal_json.is_some() {
                return Err(settlement_integrity_error());
            }
            serde_json::from_str(output_json).map_err(|_| settlement_integrity_error())
        }
        PLAIN_SETTLEMENT_FORMAT_V1 if !is_legacy => {
            if settlement_projection_seal_json.is_some() {
                return Err(settlement_integrity_error());
            }
            serde_json::from_str(output_json).map_err(|_| settlement_integrity_error())
        }
        MEDIA_SETTLEMENT_FORMAT_V1 if !is_legacy => {
            let seal_json =
                settlement_projection_seal_json.ok_or_else(settlement_integrity_error)?;
            let seal: SettlementProjectionSealV1 =
                serde_json::from_str(seal_json).map_err(|_| settlement_integrity_error())?;
            if seal.settlement_store_scope_id != epoch.store_scope_id
                || seal.settlement_record_sequence != sequence
                || seal.settlement_id != identity.activity_digest()
            {
                return Err(settlement_integrity_error());
            }
            let output: Value =
                serde_json::from_str(output_json).map_err(|_| settlement_integrity_error())?;
            if settlement_jcs(&output)?.as_bytes() != output_json.as_bytes() {
                return Err(settlement_integrity_error());
            }
            let expected_digest = sha256_domain_jcs(
                b"",
                &json!({
                    "domain": "snapback:client-mutation-settlement:v3",
                    "settlementFormat": MEDIA_SETTLEMENT_FORMAT_V1,
                    "settlementStoreScopeId": seal.settlement_store_scope_id,
                    "settlementRecordSequence": seal.settlement_record_sequence,
                    "settlementId": seal.settlement_id,
                    "resultContractHash": seal.result_contract_hash,
                    "mediaProjectionProfileHash": seal.media_projection_profile_hash,
                    "output": output,
                }),
            )?;
            if expected_digest != seal.settlement_digest {
                return Err(settlement_integrity_error());
            }
            Ok(output)
        }
        _ => Err(settlement_integrity_error()),
    }
}

fn optional_meta_u64(conn: &Connection, key: &str) -> SnapbackResult<Option<u64>> {
    meta_text(conn, key)?
        .map(|value| {
            value.parse::<u64>().map_err(|_| {
                invalid_client_mutation_retention_state(format!(
                    "retention metadata {key} is not an unsigned integer"
                ))
            })
        })
        .transpose()
}

fn client_mutation_retention_counters(conn: &Connection) -> SnapbackResult<(u64, u64)> {
    let records = optional_meta_u64(conn, META_CLIENT_MUTATION_RECORDS)?.ok_or_else(|| {
        invalid_client_mutation_retention_state("retained record counter is missing")
    })?;
    let bytes = optional_meta_u64(conn, META_CLIENT_MUTATION_BYTES)?.ok_or_else(|| {
        invalid_client_mutation_retention_state("retained byte counter is missing")
    })?;
    Ok((records, bytes))
}

fn client_mutation_auth_retention_counters(
    conn: &Connection,
    auth_fingerprint: &str,
) -> SnapbackResult<(u64, u64)> {
    Ok(conn
        .query_row(
            "SELECT records, bytes
             FROM _snapback_client_mutation_auth_retention
             WHERE auth_fingerprint = ?1",
            params![auth_fingerprint],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .unwrap_or((0, 0)))
}

fn save_client_mutation_auth_retention_counters(
    conn: &Connection,
    auth_fingerprint: &str,
    records: u64,
    bytes: u64,
) -> SnapbackResult<()> {
    if records == 0 {
        if bytes != 0 {
            return Err(invalid_client_mutation_retention_state(
                "zero retained auth records had a nonzero byte counter",
            ));
        }
        conn.execute(
            "DELETE FROM _snapback_client_mutation_auth_retention
             WHERE auth_fingerprint = ?1",
            params![auth_fingerprint],
        )?;
    } else {
        conn.execute(
            "INSERT INTO _snapback_client_mutation_auth_retention(
               auth_fingerprint, records, bytes
             ) VALUES(?1, ?2, ?3)
             ON CONFLICT(auth_fingerprint) DO UPDATE SET
               records = excluded.records,
               bytes = excluded.bytes",
            params![auth_fingerprint, records, bytes],
        )?;
    }
    Ok(())
}

fn save_meta_u64(conn: &Connection, key: &str, value: u64) -> SnapbackResult<()> {
    conn.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value.to_string()],
    )?;
    Ok(())
}

fn record_client_mutation_result(
    tx: &Transaction<'_>,
    identity: &ClientMutationIdentity,
    input: &HandlerInput,
    read_dependencies: &[CapturedReadDependency],
    changes: &[ChangedRow],
    output: &MutationOutput,
    settlement_media: Option<&SettlementMediaContextV1>,
) -> SnapbackResult<()> {
    validate_client_mutation_identity(identity)?;
    // The retained row and its first caller-visible result must obey the same
    // replay grammar. Refuse inside the surrounding transaction before an
    // invalid private sequence fact can commit application writes or a counter.
    validate_retained_sequence_allocations(&output.settlement_sequence_allocations)?;
    let (settlement_epoch, settlement_record_sequence) = load_settlement_format_epoch_v1(tx)?;
    let output_value = serde_json::to_value(output).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_CLIENT_MUTATION_RESULT_INVALID",
            "storage",
            "client mutation result could not be represented",
        )
        .with_details(json!({ "error": error.to_string() }))
    })?;
    let settlement_format = if settlement_media.is_some() {
        MEDIA_SETTLEMENT_FORMAT_V1
    } else {
        PLAIN_SETTLEMENT_FORMAT_V1
    };
    let output_json = if settlement_media.is_some() {
        settlement_jcs(&output_value)?
    } else {
        serde_json::to_string(output).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_CLIENT_MUTATION_RESULT_INVALID",
                "storage",
                "client mutation result could not be encoded",
            )
            .with_details(json!({ "error": error.to_string() }))
        })?
    };
    let settlement_projection_seal_json = settlement_media
        .map(|media| {
            let plan_value =
                serde_json::to_value(&media.plan).map_err(|_| settlement_integrity_error())?;
            let media_projection_profile_hash =
                sha256_domain_jcs(b"snapback:media-projection-profile:v1\n", &plan_value)?;
            let settlement_id = identity.activity_digest();
            let settlement_digest = sha256_domain_jcs(
                b"",
                &json!({
                    "domain": "snapback:client-mutation-settlement:v3",
                    "settlementFormat": settlement_format,
                    "settlementStoreScopeId": settlement_epoch.store_scope_id,
                    "settlementRecordSequence": settlement_record_sequence,
                    "settlementId": settlement_id,
                    "resultContractHash": media.result_contract_hash,
                    "mediaProjectionProfileHash": media_projection_profile_hash,
                    "output": output_value,
                }),
            )?;
            let seal = SettlementProjectionSealV1 {
                result_contract_hash: media.result_contract_hash.clone(),
                media_projection_profile_hash,
                settlement_id,
                settlement_store_scope_id: settlement_epoch.store_scope_id.clone(),
                settlement_record_sequence,
                settlement_digest,
            };
            settlement_jcs(&serde_json::to_value(seal).map_err(|_| settlement_integrity_error())?)
        })
        .transpose()?;
    let output_bytes = output_json.len() as u64;
    if output_bytes > CLIENT_MUTATION_MAX_RESULT_BYTES {
        return Err(SnapbackError::error(
            "SNAPBACK_CLIENT_MUTATION_RESULT_TOO_LARGE",
            "sync",
            format!(
                "serialized client mutation result is {output_bytes} bytes; the durable replay cap is {CLIENT_MUTATION_MAX_RESULT_BYTES}"
            ),
        )
        .with_details(json!({
            "bytes": output_bytes,
            "maxBytes": CLIENT_MUTATION_MAX_RESULT_BYTES,
        })));
    }
    let (retained, retained_bytes) = client_mutation_retention_counters(tx)?;
    let (auth_retained, auth_retained_bytes) =
        client_mutation_auth_retention_counters(tx, &identity.auth_fingerprint)?;
    let operation_issuance_json = identity
        .operation_issuance
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| {
            invalid_client_mutation_retention_state(format!(
                "operation issuance could not be encoded: {error}"
            ))
        })?;
    let new_bytes = logical_client_mutation_retained_row_bytes_v4(
        &identity.id,
        &identity.function,
        &identity.auth_fingerprint,
        Some(&identity.authority_instance_id),
        &identity.input_fingerprint,
        operation_issuance_json.as_deref(),
        &output_json,
        Some(settlement_format),
        SqlValue::Integer(
            i64::try_from(settlement_record_sequence).map_err(|_| settlement_integrity_error())?,
        ),
        settlement_projection_seal_json.as_deref(),
    )?;
    let limits = client_mutation_retention_limits();
    let admitted_bytes = retained_bytes.checked_add(new_bytes);
    let auth_admitted_bytes = auth_retained_bytes.checked_add(new_bytes);
    if retained >= limits.records
        || admitted_bytes.is_none_or(|bytes| bytes > limits.bytes)
        || auth_retained >= limits.records_per_auth
        || auth_admitted_bytes.is_none_or(|bytes| bytes > limits.bytes_per_auth)
    {
        let scope = if auth_retained >= limits.records_per_auth
            || auth_admitted_bytes.is_none_or(|bytes| bytes > limits.bytes_per_auth)
        {
            "auth"
        } else {
            "global"
        };
        return Err(SnapbackError::error(
            "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL",
            "sync",
            "durable client-mutation replay retention is full; acknowledge consumed results before submitting another durable id",
        )
        .with_details(json!({
            "records": retained,
            "maxRecords": limits.records,
            "bytes": retained_bytes,
            "incomingBytes": new_bytes,
            "maxBytes": limits.bytes,
            "authRecords": auth_retained,
            "maxAuthRecords": limits.records_per_auth,
            "authBytes": auth_retained_bytes,
            "maxAuthBytes": limits.bytes_per_auth,
            "scope": scope,
        })));
    }
    save_meta_u64(
        tx,
        META_SETTLEMENT_NEXT_SEQUENCE_V1,
        settlement_record_sequence
            .checked_add(1)
            .filter(|next| *next <= SEQUENCE_MAX_SAFE_INTEGER)
            .ok_or_else(settlement_integrity_error)?,
    )?;
    // @ref LLP 0043#milestone-2-queued-mutation-replay — the nullable exact
    // cursor distinguishes a newly authoritative version-zero settlement from
    // predecessor rows whose legacy migration sentinel is also zero.
    tx.execute(
        "INSERT INTO _snapback_client_mutations(
           client_mutation_id, function, auth_fingerprint, authority_instance_id,
           input_fingerprint, operation_issuance_json, output_json, settled_at_ms,
           settled_version, settled_version_exact, settlement_format,
           settlement_record_sequence, settlement_projection_seal_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            identity.id,
            identity.function,
            identity.auth_fingerprint,
            identity.authority_instance_id,
            identity.input_fingerprint,
            operation_issuance_json,
            output_json,
            timestamp_to_sql_millis(now_millis())?,
            version_to_sql_integer(output.version)?,
            version_to_sql_integer(output.version)?,
            settlement_format,
            i64::try_from(settlement_record_sequence).map_err(|_| settlement_integrity_error())?,
            settlement_projection_seal_json,
        ],
    )?;
    save_meta_u64(tx, META_CLIENT_MUTATION_RECORDS, retained + 1)?;
    save_meta_u64(
        tx,
        META_CLIENT_MUTATION_BYTES,
        admitted_bytes.expect("checked by retention admission"),
    )?;
    save_client_mutation_auth_retention_counters(
        tx,
        &identity.auth_fingerprint,
        auth_retained + 1,
        auth_admitted_bytes.expect("checked by per-auth retention admission"),
    )?;
    operation_envelope_crash_cut(OperationEnvelopeCrashPointV1::AfterSettlementBeforeEnvelope)?;
    if identity.operation_issuance.is_some() {
        record_covered_mutation_envelope_in(
            tx,
            identity,
            input,
            read_dependencies,
            changes,
            output,
        )?;
    }
    operation_envelope_crash_cut(OperationEnvelopeCrashPointV1::AfterEnvelopeBeforeCommit)?;
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CoveredMutationLaneV1 {
    Ordinary,
    HostChild,
}

impl CoveredMutationLaneV1 {
    fn name(self) -> &'static str {
        match self {
            Self::Ordinary => crate::operation_ledger::ORDINARY_MUTATION_LANE_V1,
            Self::HostChild => crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1,
        }
    }
}

fn identity_lane(identity: &ClientMutationIdentity) -> Option<CoveredMutationLaneV1> {
    match identity.operation_issuance.as_ref() {
        Some(crate::commit_envelope::OperationIssuanceV1::ClientRange { .. }) => {
            Some(CoveredMutationLaneV1::Ordinary)
        }
        Some(crate::commit_envelope::OperationIssuanceV1::HostIncarnation { .. }) => {
            Some(CoveredMutationLaneV1::HostChild)
        }
        None => None,
    }
}

pub(in crate::storage) fn require_covered_mutation_identity_for_lane(
    conn: &Connection,
    lane: CoveredMutationLaneV1,
    identity: Option<&ClientMutationIdentity>,
) -> SnapbackResult<()> {
    // @ref LLP 0163#contract-summary-normative-details-per-llp-0162-0-2 —
    //   each writer class is covered independently and must carry issuance
    //   from the matching structurally-disjoint namespace.
    let Some(stream_id) = crate::seed_identity::strict_current_data_version_stream(conn)? else {
        return Ok(());
    };
    let covered = crate::operation_ledger::active_coverage_manifest(conn, &stream_id)?.is_some_and(
        |manifest| {
            manifest
                .covered_lanes
                .iter()
                .any(|value| value == lane.name())
        },
    );
    if !covered {
        return Ok(());
    }
    let Some(identity) = identity else {
        return Err(SnapbackError::error(
            "SNAPBACK_OPERATION_IDENTITY_REQUIRED",
            "sync",
            format!(
                "{} coverage is active; this writer must carry a server-issued operation identity",
                lane.name()
            ),
        ));
    };
    if identity_lane(identity) == Some(lane) {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_OPERATION_WRITER_IDENTITY_MISMATCH",
        "sync",
        "operation issuance origin does not match the covered writer lane",
    ))
}

/// The one ordinary-mutation envelope hook. Both HostPlan and Ibex buffered
/// writers call this from their existing transaction after data/journal writes
/// and before COMMIT; a future covered writer must use this hook rather than
/// inserting an envelope independently.
///
/// @ref LLP 0162#1-the-universal-commit-envelope — application data,
///   journal, envelope, suppression, and receipt share one physical commit.
fn record_covered_mutation_envelope_in(
    tx: &Transaction<'_>,
    identity: &ClientMutationIdentity,
    input: &HandlerInput,
    read_dependencies: &[CapturedReadDependency],
    changes: &[ChangedRow],
    output: &MutationOutput,
) -> SnapbackResult<()> {
    use crate::commit_envelope::{
        CommitEnvelopeV1, EnvelopeAuthorityFactsV1, EnvelopeCoverageV1, EnvelopeEffectFactsV1,
        EnvelopeFactSetV1, FactProvenanceV1, LaneFactV1, OperationIdentityV1,
        OperationReceiptStateV1, OperationReceiptV1, RetainedEnvelopeDetailV1,
        SnapshotAssociationKindV1, StreamQualifiedVersionV1,
    };

    let issuance = identity
        .operation_issuance
        .clone()
        .expect("covered hook is called only with issuance facts");
    let stream_id =
        crate::seed_identity::strict_current_data_version_stream(tx)?.ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_OPERATION_STREAM_UNAVAILABLE",
                "storage",
                "covered ordinary mutation requires an initialized data-version stream",
            )
        })?;
    let (audience, operation_identity, operation_lane) = match &issuance {
        crate::commit_envelope::OperationIssuanceV1::ClientRange { .. } => {
            let audience = crate::operation_ledger::resolve_client_range_audience_in(
                tx,
                &issuance,
                &identity.authority_instance_id,
            )?;
            let operation = OperationIdentityV1::from_client_mutation(
                stream_id.clone(),
                audience.clone(),
                issuance,
                identity,
                crate::operation_ledger::ORDINARY_MUTATION_LANE_V1,
            );
            (
                audience,
                operation,
                crate::operation_ledger::ORDINARY_MUTATION_LANE_V1,
            )
        }
        crate::commit_envelope::OperationIssuanceV1::HostIncarnation { .. } => {
            let audience = crate::operation_ledger::resolve_host_incarnation_audience_in(
                tx,
                &issuance,
                &identity.authority_instance_id,
            )?;
            let operation = OperationIdentityV1::from_host_mutation(
                stream_id.clone(),
                audience.clone(),
                issuance,
                identity,
                crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1,
            );
            (
                audience,
                operation,
                crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1,
            )
        }
    };
    let history_operation_id = operation_identity.key.operation_id.clone();
    let manifest =
        crate::operation_ledger::active_coverage_manifest(tx, &stream_id)?.ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_OPERATION_COVERAGE_UNAVAILABLE",
                "storage",
                "covered ordinary mutation has no active stream coverage manifest",
            )
        })?;
    if !manifest
        .covered_lanes
        .iter()
        .any(|lane| lane == operation_lane)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_OPERATION_WRITER_IDENTITY_MISMATCH",
            "storage",
            "operation issuance origin is not covered by the active writer manifest",
        ));
    }
    let read_detail = serde_json::to_value(read_dependencies).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_OPERATION_LEDGER_INVALID",
            "storage",
            "captured mutation reads could not be encoded",
        )
    })?;
    let write_detail = serde_json::to_value(changes).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_OPERATION_LEDGER_INVALID",
            "storage",
            "captured mutation writes could not be encoded",
        )
    })?;
    let ctx_detail = serde_json::to_value(&output.ctx_ledger).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_OPERATION_LEDGER_INVALID",
            "storage",
            "captured ctx answers could not be encoded",
        )
    })?;
    let custody_root = identity.activity_digest();
    let protected_fact_set = |domain: &'static [u8], value: Value, count: u64, name: &str| {
        let digest =
            crate::operation_ledger::digest_fact_set(domain, &canonical_json(value.clone()));
        let detail = if serde_json::to_vec(&value).is_ok_and(|bytes| bytes.len() <= 65_536) {
            let custody_reference = format!("operation-detail:{custody_root}:{name}");
            let payload_bytes =
                crate::operation_detail::seal_in(tx, &custody_reference, &digest, &value)?;
            RetainedEnvelopeDetailV1::ProtectedLane {
                custody_reference,
                payload_digest: digest.clone(),
                payload_bytes,
            }
        } else {
            RetainedEnvelopeDetailV1::Truncated
        };
        Ok::<EnvelopeFactSetV1, SnapbackError>(EnvelopeFactSetV1 {
            digest,
            count,
            provenance: FactProvenanceV1::ServerCaptured,
            detail,
        })
    };
    let inline_public_fact_set =
        |domain: &'static [u8], value: Value, count: u64| EnvelopeFactSetV1 {
            digest: crate::operation_ledger::digest_fact_set(
                domain,
                &canonical_json(value.clone()),
            ),
            count,
            provenance: FactProvenanceV1::ServerCaptured,
            detail: RetainedEnvelopeDetailV1::InlineRedacted { detail: value },
        };
    let output_value = serde_json::to_value(output).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_OPERATION_LEDGER_INVALID",
            "storage",
            "mutation receipt could not be encoded",
        )
    })?;
    let receipt_digest = crate::operation_ledger::digest_fact_set(
        b"snapback:operation-receipt:v1\n",
        &canonical_json(output_value.clone()),
    );
    let receipt_custody_reference = format!("operation-detail:{custody_root}:receipt");
    let receipt_payload_bytes = crate::operation_detail::seal_in(
        tx,
        &receipt_custody_reference,
        &receipt_digest,
        &output_value,
    )?;
    let envelope = CommitEnvelopeV1 {
        schema_version: 1,
        identity: operation_identity,
        snapshot: StreamQualifiedVersionV1 {
            stream_id,
            version: output.version,
            association: if changes.is_empty() {
                SnapshotAssociationKindV1::ObservedSnapshot
            } else {
                SnapshotAssociationKindV1::ProducedCommit
            },
        },
        principal_session_or_invocation_id: identity.authority_instance_id.clone(),
        authority: EnvelopeAuthorityFactsV1 {
            audience,
            grant_or_policy_identity: LaneFactV1::NotDefinedForLane,
            fencing_token_or_epoch: LaneFactV1::Defined(identity.authority_instance_id.clone()),
        },
        executable_artifact_digest: identity
            .artifact_generation_digest
            .clone()
            .map_or(LaneFactV1::NotDefinedForLane, LaneFactV1::Defined),
        argument_digest: crate::operation_ledger::digest_fact_set(
            b"snapback:operation-arguments:v1\n",
            &canonical_json(input.args.clone()),
        ),
        plan_digest: LaneFactV1::NotDefinedForLane,
        base_version: LaneFactV1::NotDefinedForLane,
        read_set: protected_fact_set(
            b"snapback:operation-read-set:v1\n",
            read_detail,
            read_dependencies.len() as u64,
            "reads",
        )?,
        write_set: protected_fact_set(
            b"snapback:operation-write-set:v1\n",
            write_detail,
            changes.len() as u64,
            "writes",
        )?,
        ctx_answers: protected_fact_set(
            b"snapback:operation-ctx-answers:v1\n",
            ctx_detail,
            usize::from(output.ctx_ledger.is_some()) as u64,
            "ctx-answers",
        )?,
        effects: EnvelopeEffectFactsV1 {
            facts: inline_public_fact_set(b"snapback:operation-effects:v1\n", json!([]), 0),
            egress_families: Vec::new(),
            settlement_capabilities: Vec::new(),
        },
        receipt: OperationReceiptV1 {
            state: OperationReceiptStateV1::Committed,
            receipt_digest: receipt_digest.clone(),
            payload: RetainedEnvelopeDetailV1::ProtectedLane {
                custody_reference: receipt_custody_reference,
                payload_digest: receipt_digest,
                payload_bytes: receipt_payload_bytes,
            },
        },
        coverage: EnvelopeCoverageV1 {
            covered_lanes: vec![operation_lane.to_owned()],
            uncovered_lanes: Vec::new(),
            coverage_digest: manifest.coverage_digest,
        },
        recorded_at_ms: now_millis(),
    };
    crate::operation_ledger::record_operation_in(tx, &envelope)?;
    // @ref LLP 0162#6-bounded-history-and-named-checkpoints — retained row
    // versions join to the operation identity inside the same physical commit;
    // tables without an active finite history policy have no rows to update.
    tx.execute(
        "UPDATE _snapback_record_history_v1
            SET operation_id = ?1
          WHERE version = ?2 AND operation_id IS NULL",
        params![
            history_operation_id,
            version_to_sql_integer(output.version)?
        ],
    )?;
    Ok(())
}

/// A generic host-minted id, for the paths where no table is in scope.
///
/// Prefer `crate::ids::mint_document(table)` wherever the target table is
/// known — that is what gives a row's id its table's prefix (LLP 0148 §D6).
///
/// @ref LLP 0148#d5-one-registry-one-minting-helper — mint through the
/// registry, never `format!` a prefix at a call site
pub(crate) fn new_id() -> String {
    crate::ids::mint_time_ordered(crate::ids::Kind::Opaque)
}

/// A fresh-claim-id source over the trusted id allocator, in the closure
/// shape `claim_due_jobs_in_tx` consumes.
fn new_id_source() -> impl FnMut() -> String {
    || new_id()
}

/// The ChangedRow a job lifecycle transition publishes for live matching —
/// the pseudo-table row the declared job-status query captured a dependency
/// on. `changed_fields` names the mutable lifecycle fields so predicate
/// membership checks on immutable identity fields can skip.
pub(crate) fn job_status_changed_row(row: &jobs::JobStatusRow) -> ChangedRow {
    ChangedRow {
        table: jobs::JOBS_STATUS_TABLE.to_owned(),
        id: row.job_id.clone(),
        op: ChangeOp::Update,
        row: Some(row.to_row_value()),
        changed_fields: vec![
            "state".to_owned(),
            "stateVersion".to_owned(),
            "attemptCount".to_owned(),
            "availableAtMs".to_owned(),
            "terminalAtMs".to_owned(),
            "lastErrorCode".to_owned(),
        ],
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
