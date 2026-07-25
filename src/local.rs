use crate::admin::ServerProfile;
use crate::auth::admission::AdmissionLease;
use crate::auth::admission::{
    AdmissionController, AdmissionEffectGuard, ModeCommitFailure, ModeTransitionGuard,
};
use crate::auth::descriptor::{descriptor_for_authority, require_current_descriptor};
use crate::auth::invalidation::{
    AuthorizationInvalidationConnection, AuthorizationInvalidationProjection, CompositeWitness,
    DataWitness, InvalidationDisposition, LiveInvalidationIssuer, ObligationExpectation,
    ObligationRegistry, QueryNamespace, ResolutionKind, RetryEpisode, RetryEpisodeKey,
    RetryReservation, RetryReservationKind, ScopeId, ScopeRetirement, ScopeRetirementCandidate,
};
use crate::auth::invocation::{
    InvocationGate, InvocationSource, PreparedAuthority, PreparedInvocation, ResolvedAppAuthority,
    RetainedLiveAuthority, WireAuthorityFields,
};
use crate::auth::lease::{
    AuthorizedLease, AuthorizedLeaseConfig, AuthorizedLeaseData, AuthorizedLeaseIssue,
    AuthorizedLeaseRequestIdentity, authorized_lease_activation_hash,
};
use crate::auth::mode::{
    AuthModeStateRecord, DeploymentIdentity, STARTUP_ARTIFACT_FORMAT_VERSION, StartupArtifacts,
};
use crate::auth::service_fence::{ServiceAuthorityActResolution, ServiceAuthorityDisposition};
use crate::config::{ConfigStore, VerificationRecord};
use crate::cron::{
    CronInspectState, CronRunClaim, CronRunMetadata, CronRunOutcome, CronRunRecord, CronRunTrigger,
    LocalCronRuntime, validate_cron_manifest,
};
use crate::diagnostic::{
    Diagnostic, DiagnosticSeverity, PublicDiagnostic, SnapbackError, SnapbackResult,
};
use crate::ephemeral::{
    AuthContext, CollectionEnsureOutcome, DeleteRequest, DeliveryNotifier, EphemeralCollection,
    EphemeralDiagnostics, EphemeralMessage, LocalEphemeralBackend, PublishOutcome, PublishRequest,
    RealtimeEnvelope, RealtimePublicationPermit, RoomPermissionProjection,
    RoomSubscriberResolution, SubscribeRequest, validate_collection_definitions,
    validate_collection_permission_backing,
};
use crate::live_matcher::{
    LiveDeltaKind, LiveDeltaOutcome, compute_live_delta, live_subscription_may_be_affected,
    query_dependencies_from_plan,
};
use crate::live_wire::{
    AuthorizationInvalidationSnapshot, LiveDeltaOpKind, LiveDeltaWireOp, LiveEnvelope,
    LiveSocketServerFrame, MutationReceiptOutcome, Receipt, ResumeFromToken, ResumeMeta,
    ResumeWire, SubscriptionReceiptEvent,
};
use crate::manifest::{
    ActionPlan, ActionReturnValue, ActionStep, AuthInput, AuthMode, AuthorityDescriptor,
    CTX_ANSWER_LEDGER_MAX_IDS, CapabilityManifest, CtxAnswerLedger, FunctionDefinition,
    FunctionKind, FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, MutationOutput,
    MutationStep, PermissionScopeExpr, PublicFunctionManifest, PublicSchemaManifest, QueryOutput,
    QueryPlan, SNAPBACK_SCHEMA_VERSION, SchemaManifest, SeedData,
    TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX, ValueExpr, auth_fingerprint, ctx_ledger_version,
    legacy_auth_fingerprint,
};
use crate::runtime::{
    CapabilityState, ExecutedIbexMutation, IbexActionHost, IbexCliCapability,
    IbexSubmoduleCapability, RuntimeCapabilities, RuntimeManager,
};
use crate::storage::auth_mode::{DurableModeCommit, NetworkDeploymentCommit, NetworkSeedOutcome};
use crate::storage::{
    BufferedCommitPayload, CapturedReadDependency, CapturedReadKind, CapturedWriteDependency,
    ChangedRow, ClientMutationIdentity, DbRead, LocalDatabase, MutationCommit, ReaderPool,
    StorageInfo, TableScan,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::marker::PhantomData;
use std::ops::Deref;
use std::path::Path;
use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};
use std::sync::{Arc, PoisonError, RwLock, Weak};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const MAX_RECENT_DIAGNOSTICS: usize = 100;
const MAINTENANCE_DIAGNOSTIC_MIN_INTERVAL_MS: u64 = 60_000;
static NEXT_APP_GENERATION: AtomicU64 = AtomicU64::new(1);

/// Hard retained durable-live ceilings for the canonical local server. These
/// match the hosted coordinator so changing targets cannot silently multiply
/// one connection's authority or the process-wide matcher/fan-out workload.
/// Admission happens before the initial snapshot query and never evicts an
/// existing subscription.
///
/// @ref LLP 0031#connection-capability-grants — durable subscriptions are
/// bounded globally and per granted connection.
pub const MAX_LIVE_SUBSCRIPTIONS: usize = 2_048;
pub const MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION: usize = 64;
const MAX_PENDING_LOCAL_LIVE_EFFECTS: usize = MAX_LIVE_SUBSCRIPTIONS;

const LOCAL_LIVE_STAGE_PENDING: u8 = 0;
const LOCAL_LIVE_STAGE_COMMITTED: u8 = 1;
const LOCAL_LIVE_STAGE_ABANDONED: u8 = 2;
const LOCAL_LIVE_STAGE_TERMINAL: u8 = 3;
const LOCAL_LIVE_STAGE_FINALIZING: u8 = 4;
const LOCAL_LIVE_STAGE_FINALIZED: u8 = 5;

#[cfg(test)]
thread_local! {
    /// Focused guarded-commit tests install a one-shot assertion here. It runs
    /// after the SQLite commit callback's guard has dropped and immediately
    /// before permission/live postcommit work begins.
    static BEFORE_MUTATION_POSTCOMMIT_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
    static BEFORE_QUERY_RESULT_HANDOFF_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
    static BEFORE_ACTION_RESULT_HANDOFF_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
    static BEFORE_CONFIG_VERIFY_PUBLICATION_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
    static FAIL_NEXT_LIVE_SCOPE_REGISTRATION: std::cell::Cell<bool> =
        const { std::cell::Cell::new(false) };
    static FAIL_NEXT_SCOPE_RETIREMENT_AUTH: std::cell::Cell<bool> =
        const { std::cell::Cell::new(false) };
}

fn reserve_unique_generation(counter: &AtomicU64) -> SnapbackResult<u64> {
    counter
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
            current.checked_add(1)
        })
        .map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_APP_GENERATION_EXHAUSTED",
                "runtime",
                "the process app-generation space is exhausted",
            )
        })
}

fn next_app_generation() -> SnapbackResult<u64> {
    reserve_unique_generation(&NEXT_APP_GENERATION)
}

fn next_secret_read_reset_generation(current: u64) -> SnapbackResult<u64> {
    current.checked_add(1).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_ADMIN_SECRET_READ_GENERATION_EXHAUSTED",
            "admin-secret-read",
            "the secret-read reset-generation space is exhausted",
        )
    })
}

/// Receipt retention (LLP 0034 §3 / ENG-22478): bounded in-memory rings — one
/// global ring for connectionless facts (mutation receipts, disposed-on-
/// disconnect markers) and one ring per live connection (subscription
/// lifecycle). Dropped with the connection; never durable.
///
/// Privacy (§3.3): receipts carry opaque ids, versions, table names, and the
/// verbatim adapter correlation object — never ephemeral payload values and
/// never auth identities beyond what the adapter itself chose to put in its
/// opaque correlation.
const RECEIPT_RING_CAP: usize = 256;

#[derive(Default)]
struct ReceiptLog {
    global: VecDeque<Value>,
    per_connection: BTreeMap<String, VecDeque<Value>>,
}

impl ReceiptLog {
    fn push_global(&mut self, receipt: Value) {
        push_capped(&mut self.global, receipt);
    }

    fn push_connection(&mut self, connection_id: &str, receipt: Value) {
        push_capped(
            self.per_connection
                .entry(connection_id.to_owned())
                .or_default(),
            receipt,
        );
    }

    fn drop_connection(&mut self, connection_id: &str) {
        self.per_connection.remove(connection_id);
    }

    fn snapshot(&self, connection_id: Option<&str>) -> Value {
        match connection_id {
            Some(id) => json!({
                "connection": id,
                "receipts": self
                    .per_connection
                    .get(id)
                    .map(|ring| ring.iter().cloned().collect::<Vec<_>>())
                    .unwrap_or_default(),
            }),
            None => json!({
                "global": self.global.iter().cloned().collect::<Vec<_>>(),
                "connections": self
                    .per_connection
                    .iter()
                    .map(|(id, ring)| (id.clone(), Value::Array(ring.iter().cloned().collect())))
                    .collect::<serde_json::Map<_, _>>(),
            }),
        }
    }
}

fn push_capped(ring: &mut VecDeque<Value>, receipt: Value) {
    ring.push_back(receipt);
    while ring.len() > RECEIPT_RING_CAP {
        ring.pop_front();
    }
}

/// The answer one `mutationDryRun` execution produced (LLP 0051 D8 /
/// Increment 4). The host-ops layer projects this into the wire
/// `DryRunReport`; this type is the execution-side truth.
#[derive(Debug)]
pub struct MutationDryRunOutcome {
    /// Which execution tier answered: `hostPlan` (IR) or `ibexModule`.
    pub tier: &'static str,
    /// Whether the identical commit path would have committed.
    pub would_commit: bool,
    /// True when the failure was a permission-class pre-execution gate,
    /// distinct from an app-level handler outcome.
    pub denied: bool,
    /// The failure diagnostic when `would_commit` is false — the same
    /// diagnostic a real commit would have raised.
    pub failure: Option<Diagnostic>,
    /// `valid` | `stale` | `notChecked` (LLP 0024 §Dry-Run values;
    /// `unsupported` is never produced by a served tier).
    pub read_set_validation: &'static str,
    /// The database version the dry-run evaluated against.
    pub snapshot_version: u64,
    /// The handler's return value.
    pub result: Value,
    /// The discarded writes, row-granular.
    pub changes: Vec<ChangedRow>,
    /// Read dependencies captured during execution.
    pub read_dependencies: Vec<CapturedReadDependency>,
    /// The recorded ctx-answer ledger — `deterministicInputs` literally
    /// (LLP 0051 D8).
    pub ledger: Option<CtxAnswerLedger>,
    /// Advisory diagnostics that do not affect `would_commit`.
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct InspectState {
    #[serde(rename = "artifactKind")]
    pub artifact_kind: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "targetProfileId")]
    pub target_profile_id: String,
    pub target: String,
    pub storage: StorageInfo,
    pub runtime: RuntimeCapabilities,
    pub schema: SchemaManifest,
    pub functions: FunctionManifest,
    #[serde(rename = "capabilityManifest")]
    pub capability_manifest: CapabilityManifest,
    pub subscriptions: Vec<LiveSubscriptionInfo>,
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L2 connection
    // reaper counters (counts only; no connection ids beyond the trimmed public
    // subscription list).
    #[serde(rename = "activeConnections")]
    pub active_connections: usize,
    #[serde(rename = "reapedConnections")]
    pub reaped_connections: u64,
    #[serde(rename = "liveDelivery")]
    pub live_delivery: LiveDeliveryStats,
    pub ephemeral: EphemeralDiagnostics,
    pub cron: CronInspectState,
    pub maintenance: MaintenanceDiagnostics,
    #[serde(rename = "recentDiagnostics", alias = "recent_diagnostics")]
    pub recent_diagnostics: Vec<Diagnostic>,
    #[serde(rename = "capabilityGaps", alias = "capability_gaps")]
    pub capability_gaps: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LiveSubscriptionInfo {
    pub id: String,
    pub connection_id: String,
    pub function: String,
}

/// The public projection of [`InspectState`] served at the root `/inspect` and
/// `/`. It is a typed allowlist: the `From<InspectState>` below destructures the
/// full struct, so a newly-added `InspectState` (or `StorageInfo`,
/// `LiveSubscriptionInfo`) field is a compile error here rather than a silent
/// leak. Sensitive facts are deliberately dropped and live only in the gated
/// `/_snapback/api/inspect` twin: `subscriptions[].connection_id` (the
/// enumerate-and-disconnect vector — LLP 0031 D2/D3), the absolute
/// `storage.sqlite_path` and runtime executable/submodule paths (environment
/// leaks), per-room ephemeral identities, mutation-retention internals, and the
/// executable handler bodies inside `functions` (`IbexModule.source` /
/// `HandlerPlan` bodies — a source disclosure, ENG-23441; see
/// [`PublicFunctionManifest`]). Free-form diagnostic message/details and cron
/// run results are also gated because producers may include source paths or
/// application values.
///
/// @ref LLP 0031#resolved-decisions — D3: public `/inspect` is trimmed to an identity descriptor; the trim is guarded by a typed projection.
/// @ref LLP 0036#runtime-exposure-d5-d8 — secret-like runtime diagnostics are redacted before retention and never projected anonymously as raw text.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicInspect {
    #[serde(rename = "artifactKind")]
    pub artifact_kind: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "targetProfileId")]
    pub target_profile_id: String,
    pub target: String,
    pub storage: PublicStorageInfo,
    pub runtime: PublicRuntimeCapabilities,
    pub schema: PublicSchemaManifest,
    pub functions: PublicFunctionManifest,
    #[serde(rename = "capabilityManifest")]
    pub capability_manifest: CapabilityManifest,
    pub subscriptions: Vec<PublicSubscriptionInfo>,
    #[serde(rename = "activeConnections")]
    pub active_connections: usize,
    #[serde(rename = "reapedConnections")]
    pub reaped_connections: u64,
    #[serde(rename = "liveDelivery")]
    pub live_delivery: LiveDeliveryStats,
    pub ephemeral: PublicEphemeralDiagnostics,
    pub cron: PublicCronInspectState,
    pub maintenance: MaintenanceDiagnostics,
    #[serde(rename = "recentDiagnostics", alias = "recent_diagnostics")]
    pub recent_diagnostics: Vec<PublicDiagnostic>,
    #[serde(rename = "capabilityGaps", alias = "capability_gaps")]
    pub capability_gaps: Vec<String>,
}

/// Public storage facts: the change version and table list, never the on-disk path.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicStorageInfo {
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub version: u64,
    pub tables: Vec<String>,
}

/// Runtime capability posture safe for unauthenticated inspection. Absolute
/// executable/submodule paths remain on the gated inspect endpoint.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicRuntimeCapabilities {
    pub canonical_engine: String,
    pub ibex_submodule: PublicIbexSubmoduleCapability,
    pub ibex_cli: PublicIbexCliCapability,
    pub host_plan_runtime: bool,
    pub ibex_ctx_db_host_bridge: CapabilityState,
    pub async_handler_completion: CapabilityState,
    pub sqlite_lock_held_across_async: CapabilityState,
    pub mutation_dry_run: bool,
}

#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicIbexSubmoduleCapability {
    pub present: bool,
}

#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicIbexCliCapability {
    pub available: bool,
    pub version: Option<String>,
}

impl From<RuntimeCapabilities> for PublicRuntimeCapabilities {
    fn from(runtime: RuntimeCapabilities) -> Self {
        let RuntimeCapabilities {
            canonical_engine,
            ibex_submodule,
            ibex_cli,
            host_plan_runtime,
            ibex_ctx_db_host_bridge,
            async_handler_completion,
            sqlite_lock_held_across_async,
            mutation_dry_run,
        } = runtime;
        let IbexSubmoduleCapability { present, path: _ } = ibex_submodule;
        let IbexCliCapability {
            available,
            path: _,
            version,
        } = ibex_cli;
        Self {
            canonical_engine,
            ibex_submodule: PublicIbexSubmoduleCapability { present },
            ibex_cli: PublicIbexCliCapability { available, version },
            host_plan_runtime,
            ibex_ctx_db_host_bridge,
            async_handler_completion,
            sqlite_lock_held_across_async,
            mutation_dry_run,
        }
    }
}

/// Aggregate ephemeral health facts safe for unauthenticated inspection.
/// Per-room identities, routing keys, scopes, and epochs stay on the gated
/// admin endpoint because they can encode tenant and application data.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicEphemeralDiagnostics {
    pub room_count: usize,
    pub entry_count: usize,
    pub subscriber_count: usize,
    pub value_bytes: usize,
    pub retained_bytes: usize,
    pub outbox_retained_bytes: usize,
    pub pending_ephemeral_keys: usize,
    pub pending_durable_messages: usize,
    pub pending_resync_messages: usize,
    pub rejected_publishes: u64,
    pub rate_limited_publishes: u64,
    pub oversized_publishes: u64,
    pub unauthorized_requests: u64,
    pub metadata_rejections: u64,
    pub expired_entries: u64,
    pub disconnected_entries: u64,
    pub coalesced_updates: u64,
    pub resync_required: u64,
    pub outbox_overflows: u64,
    pub limit_rejections: u64,
    pub generation_exhaustions: u64,
}

impl From<EphemeralDiagnostics> for PublicEphemeralDiagnostics {
    fn from(diagnostics: EphemeralDiagnostics) -> Self {
        // Exhaustive by design: adding a diagnostic requires an explicit
        // public/private classification here.
        let EphemeralDiagnostics {
            room_count,
            entry_count,
            subscriber_count,
            value_bytes,
            retained_bytes,
            outbox_retained_bytes,
            active_rooms: _,
            pending_ephemeral_keys,
            pending_durable_messages,
            pending_resync_messages,
            rejected_publishes,
            rate_limited_publishes,
            oversized_publishes,
            unauthorized_requests,
            metadata_rejections,
            expired_entries,
            disconnected_entries,
            coalesced_updates,
            resync_required,
            outbox_overflows,
            limit_rejections,
            generation_exhaustions,
            last_generation_exhaustion: _,
        } = diagnostics;
        Self {
            room_count,
            entry_count,
            subscriber_count,
            value_bytes,
            retained_bytes,
            outbox_retained_bytes,
            pending_ephemeral_keys,
            pending_durable_messages,
            pending_resync_messages,
            rejected_publishes,
            rate_limited_publishes,
            oversized_publishes,
            unauthorized_requests,
            metadata_rejections,
            expired_entries,
            disconnected_entries,
            coalesced_updates,
            resync_required,
            outbox_overflows,
            limit_rejections,
            generation_exhaustions,
        }
    }
}

/// Public subscription facts: id and function, never the owning connection id.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicSubscriptionInfo {
    pub id: String,
    pub function: String,
}

/// Public cron posture: aggregate state only. Run records, result values,
/// error messages, diagnostic details, run ids, and slot/idempotency keys stay
/// on the gated administrative inspect surface because handler-controlled text
/// can contain credentials or application data.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicCronInspectState {
    pub artifact_kind: String,
    pub schema_version: String,
    pub job_count: usize,
    pub failed_job_count: usize,
    pub in_flight_job_count: usize,
}

/// Closed, monotonic maintenance health facts. Error text and room identities
/// stay in the gated diagnostic ring; this projection is safe for public
/// inspection and sufficient to distinguish healthy retry from a persistent
/// maintenance failure.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceDiagnostics {
    pub permission_resolution_failures: u64,
    pub journal_prune_failures: u64,
    pub last_permission_resolution_failure_ms: Option<u64>,
    pub last_journal_prune_failure_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MaintenanceOperation {
    PermissionResolution,
    JournalPrune,
}

impl From<CronInspectState> for PublicCronInspectState {
    fn from(cron: CronInspectState) -> Self {
        let CronInspectState {
            artifact_kind,
            schema_version,
            jobs,
            recent_runs: _,
            diagnostics: _,
        } = cron;
        Self {
            artifact_kind,
            schema_version,
            job_count: jobs.len(),
            failed_job_count: jobs
                .iter()
                .filter(|job| job.last_outcome == Some(CronRunOutcome::Failed))
                .count(),
            in_flight_job_count: jobs
                .iter()
                .filter(|job| job.in_flight_run_id.is_some())
                .count(),
        }
    }
}

impl From<InspectState> for PublicInspect {
    fn from(inspect: InspectState) -> Self {
        // Exhaustive destructures below are load-bearing: a new field on any of
        // these structs must be classified here, not leak by default.
        let InspectState {
            artifact_kind,
            schema_version,
            target_profile_id,
            target,
            storage,
            runtime,
            schema,
            functions,
            capability_manifest,
            subscriptions,
            active_connections,
            reaped_connections,
            live_delivery,
            ephemeral,
            cron,
            maintenance,
            recent_diagnostics,
            capability_gaps,
        } = inspect;
        let StorageInfo {
            sqlite_path: _,
            version,
            tables,
            client_mutation_retention: _,
        } = storage;
        PublicInspect {
            artifact_kind,
            schema_version,
            target_profile_id,
            target,
            storage: PublicStorageInfo { version, tables },
            runtime: runtime.into(),
            schema: schema.into(),
            functions: functions.into(),
            capability_manifest,
            subscriptions: subscriptions
                .into_iter()
                .map(
                    |LiveSubscriptionInfo {
                         id,
                         connection_id: _,
                         function,
                     }| PublicSubscriptionInfo { id, function },
                )
                .collect(),
            active_connections,
            reaped_connections,
            live_delivery,
            ephemeral: ephemeral.into(),
            cron: cron.into(),
            maintenance,
            recent_diagnostics: recent_diagnostics.into_iter().map(Into::into).collect(),
            capability_gaps,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct LiveSubscribeInput {
    pub connection_id: String,
    #[serde(default)]
    pub input: HandlerInput,
    /// Store-owned identity for an auth-scoped live materialization. It is
    /// ignored for explicitly authority-independent functions and required in
    /// sessions mode for every other live function.
    #[serde(
        default,
        rename = "authorizationNamespace",
        alias = "authorization_namespace"
    )]
    pub authorization_namespace: Option<QueryNamespace>,
    /// Explicit supersession (ENG-22478 review fix A): the kit names the
    /// subscription its OWN resubscribe replaces; the server disposes exactly
    /// that id. Plain duplicate subscribes (two components sharing a query)
    /// coexist — supersession is never inferred from matching identity.
    #[serde(default)]
    pub supersedes: Option<String>,
    /// RQS token resume (LLP 0091 §0B.4): not a new route — the token seeds
    /// this ordinary subscribe. Admission per LLP 0090 D1.1; every refusal
    /// answers with rung 3 (a fresh snapshot), never a subscription failure.
    #[serde(
        default,
        rename = "resumeFromToken",
        alias = "resume_from_token",
        skip_serializing_if = "Option::is_none"
    )]
    pub resume_from_token: Option<ResumeFromToken>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct LiveSubscribeOutput {
    pub subscription_id: String,
    /// Absent exactly when the subscribe was answered without rows (LLP 0090
    /// D1.3): rung-1 `CurrentAsOf` (held rows are current) or rung-2 delta
    /// replay (the witness verified). The answer rides the durable lane —
    /// the `current_as_of` or replay `live_delta` envelope carries the fresh
    /// token. Only a resume-capable caller can receive the absent form.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<QueryOutput>,
    /// Fresh resume token for `rqsEligible` subscriptions answered with rows
    /// (the "initial `LiveReplace`" mint of LLP 0091 §0A.5 on this arm).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resume: Option<ResumeWire>,
    /// Per-cause `SNAPBACK_RESUME_*` code when a presented token was refused
    /// (LLP 0091 §0B.6) — an observability fact; the subscribe itself
    /// succeeded with rung 3.
    #[serde(
        default,
        rename = "resumeRefusal",
        skip_serializing_if = "Option::is_none"
    )]
    pub resume_refusal: Option<String>,
    #[serde(default)]
    #[schemars(schema_with = "portable_permission_epoch_map_schema")]
    pub permission_epochs: BTreeMap<String, u64>,
    /// Server half of the 'established' receipt (LLP 0034 §3.2, ENG-22478).
    // @ref LLP 0094#0d--subscription-receipt-typing-implemented — the typed
    //   Receipt union rides the subscribe output; no longer an untyped seam.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipt: Option<Receipt>,
    #[serde(
        default,
        rename = "authorizationScope",
        skip_serializing_if = "Option::is_none"
    )]
    pub authorization_scope: Option<ScopeId>,
    #[serde(
        default,
        rename = "authorizationInvalidation",
        skip_serializing_if = "Option::is_none"
    )]
    pub authorization_invalidation: Option<AuthorizationInvalidationProjection>,
    #[serde(
        default,
        rename = "scopeRetirements",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub scope_retirements: Vec<ScopeRetirement>,
}

#[derive(Clone, Debug)]
pub(crate) struct LiveTransportPublication<T> {
    pub(crate) output: T,
    pub(crate) authorization: Option<crate::storage::AuthorizationVersion>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct LiveResumeInput {
    pub subscription_id: String,
    pub connection_id: String,
    #[serde(default)]
    pub auth: AuthInput,
    #[serde(
        default,
        rename = "recorded_permission_epochs",
        alias = "recordedPermissionEpochs"
    )]
    #[schemars(schema_with = "portable_permission_epoch_map_schema")]
    pub recorded_permission_epochs: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct LiveResumeOutput {
    pub subscription_id: String,
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<QueryOutput>,
    #[serde(default)]
    #[schemars(schema_with = "portable_permission_epoch_map_schema")]
    pub permission_epochs: BTreeMap<String, u64>,
    #[serde(
        default,
        rename = "authorizationScope",
        skip_serializing_if = "Option::is_none"
    )]
    pub authorization_scope: Option<ScopeId>,
    #[serde(
        default,
        rename = "authorizationInvalidation",
        skip_serializing_if = "Option::is_none"
    )]
    pub authorization_invalidation: Option<AuthorizationInvalidationProjection>,
    #[serde(
        default,
        rename = "scopeRetirements",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub scope_retirements: Vec<ScopeRetirement>,
}

fn portable_permission_epoch_map_schema(
    _generator: &mut schemars::SchemaGenerator,
) -> schemars::Schema {
    schemars::json_schema!({
        "type": "object",
        "additionalProperties": {
            "type": "integer",
            "format": "uint64",
            "minimum": 0,
            "maximum": crate::manifest::PORTABLE_STORAGE_VERSION_MAX
        }
    })
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct LiveUnsubscribeInput {
    pub subscription_id: String,
    pub connection_id: String,
    #[serde(default)]
    pub auth: AuthInput,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct LiveUnsubscribeOutput {
    pub subscription_id: String,
    pub disposed: bool,
    // @ref LLP 0094#0d--subscription-receipt-typing-implemented — typed
    //   Receipt on the unsubscribe output, matching the subscribe half.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipt: Option<Receipt>,
    #[serde(
        default,
        rename = "scopeRetirement",
        skip_serializing_if = "Option::is_none"
    )]
    pub scope_retirement: Option<ScopeRetirement>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationInvalidationAckInput {
    pub connection_id: String,
    pub ack_token: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationInvalidationAckOutput {
    pub outcome: String,
}

/// An explicit operator/user retry names one exact live query and one fresh
/// idempotency key. The server derives the durable retry key from the retained
/// subscription authority; no caller-provided authority subject or canonical
/// query key is trusted.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationInvalidationManualRetryInput {
    pub connection_id: String,
    pub subscription_id: String,
    pub manual_retry_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationInvalidationManualRetryOutput {
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_episode_id: Option<String>,
}

/// The legacy v0-dev compatibility form of the single idempotent
/// ensure-everything operation. The HTTP boundary wraps this in the closed
/// [`EnsureAppRequest`] family; keeping the effect payload as its own type lets
/// the local provisioning core remain shared by legacy dev startup and the
/// explicitly privileged `provision` branch.
///
/// @ref LLP 0034#103-operational-follow-ups-2026-07-02-eng-22527 — inspect
/// first, provision only missing halves, and seed only if every target is
/// empty.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EnsureAppInput {
    #[serde(default)]
    pub schema: Option<SchemaManifest>,
    #[serde(default)]
    pub functions: Option<FunctionManifest>,
    #[serde(default)]
    pub seed: Option<SeedData>,
    /// The route→query manifest (LLP 0092 §0C.1), ensured beside the
    /// functions manifest on the local dev loop. Sessions-mode complete-pair
    /// provisioning of routes rides the Cloudflare/deploy work of LLP 0090
    /// rollout step 4.
    #[serde(default)]
    pub routes: Option<crate::bundle::RoutesManifest>,
}

/// Auth mode explicitly named by an ensure intent. This is a wire fact, not
/// the persisted staged-mode state; item 4 wires the latter into the server's
/// [`crate::server::PolicyAuthPosture`] seam.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum EnsureAppMode {
    Dev,
    Sessions,
}

impl EnsureAppMode {
    fn artifact_version(self) -> &'static str {
        match self {
            Self::Dev => SNAPBACK_SCHEMA_VERSION,
            Self::Sessions => "snapback.v1",
        }
    }

    pub(crate) const fn auth_mode(self) -> AuthMode {
        match self {
            Self::Dev => AuthMode::Dev,
            Self::Sessions => AuthMode::Sessions,
        }
    }
}

/// Identity-only schema half accepted by the Public `attest` branch.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnsureAppSchemaIdentity {
    pub artifact_kind: String,
    pub schema_version: String,
    pub app_id: String,
    pub schema_hash: String,
    pub inputs_hash: String,
}

/// Identity-only function half accepted by the Public `attest` branch.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnsureAppFunctionIdentity {
    pub artifact_kind: String,
    pub schema_version: String,
    pub app_id: String,
    pub bundle_hash: String,
    pub inputs_hash: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EnsureAppPairIdentity {
    pub schema: EnsureAppSchemaIdentity,
    pub functions: EnsureAppFunctionIdentity,
}

/// Explicit ensure intents. `deny_unknown_fields` is load-bearing: an attest
/// request cannot smuggle a manifest or seed, and a future mode-stage field
/// cannot silently fall through to the legacy compatibility branch.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "intent", rename_all = "lowercase", deny_unknown_fields)]
pub enum EnsureAppExplicitInput {
    Attest {
        #[serde(rename = "requestedMode")]
        requested_mode: EnsureAppMode,
        pair: Box<EnsureAppPairIdentity>,
    },
    Provision {
        #[serde(rename = "requestedMode")]
        requested_mode: EnsureAppMode,
        #[serde(default)]
        schema: Option<Box<SchemaManifest>>,
        #[serde(default)]
        functions: Option<Box<FunctionManifest>>,
        #[serde(default)]
        seed: Option<Box<SeedData>>,
    },
}

/// Closed `/app/ensure` request family. Explicit variants are attempted first;
/// because the legacy object also denies unknown fields, the presence of an
/// invalid or unknown `intent` can never fall back to legacy provisioning.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(untagged)]
pub enum EnsureAppRequest {
    Explicit(EnsureAppExplicitInput),
    Legacy(Box<EnsureAppInput>),
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum EnsureAppIntent {
    Attest,
    Provision,
}

/// The coherent loaded identity projected by Public attestation.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnsureAppActiveIdentity {
    pub schema_version: String,
    pub app_id: String,
    pub schema_hash: String,
    pub bundle_hash: String,
    pub inputs_hash: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EnsureAppAttestOutcome {
    pub intent: EnsureAppIntent,
    pub matched: bool,
    pub active: EnsureAppActiveIdentity,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EnsureAppOutcome {
    /// 'matched' | 'provisioned' | 'gated' | 'skipped-absent'
    pub schema: String,
    /// 'matched' | 'provisioned' | 'gated' | 'skipped-absent'
    pub functions: String,
    /// 'seeded' | 'skipped-nonempty' | 'gated' | 'skipped-absent'
    pub seed: String,
    /// 'matched' | 'provisioned' | 'gated' — absent when no routes manifest
    /// was posted (LLP 0092 §0C.1 ensure admission).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub routes: Option<String>,
    /// The server profile the decision ran under.
    pub profile: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EnsureAppProvisionOutcome {
    pub intent: EnsureAppIntent,
    pub schema: String,
    pub functions: String,
    pub seed: String,
    pub profile: String,
}

impl From<EnsureAppOutcome> for EnsureAppProvisionOutcome {
    fn from(outcome: EnsureAppOutcome) -> Self {
        Self {
            intent: EnsureAppIntent::Provision,
            schema: outcome.schema,
            functions: outcome.functions,
            seed: outcome.seed,
            profile: outcome.profile,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(untagged)]
pub enum EnsureAppResponse {
    Attest(EnsureAppAttestOutcome),
    Provision(EnsureAppProvisionOutcome),
    Legacy(EnsureAppOutcome),
}

/// A complete candidate pair that passed every artifact- and target-owned
/// preflight predicate. The HTTP mode-change path deliberately carries this
/// owned value across admission quiescence, then repeats preflight under the
/// global write lane before storage may commit it.
#[derive(Clone, Debug)]
pub(crate) struct PreparedAuthProvision {
    requested_mode: AuthMode,
    artifacts: StartupArtifacts,
    deployment: DeploymentIdentity,
}

#[derive(Clone, Debug)]
pub(crate) struct AuthProvisionCommit {
    pub(crate) outcome: EnsureAppProvisionOutcome,
    pub(crate) state: AuthModeStateRecord,
    pub(crate) diagnostics: Vec<Diagnostic>,
}

impl PreparedAuthProvision {
    pub(crate) fn requested_mode(&self) -> AuthMode {
        self.requested_mode
    }
}

#[derive(Clone, Debug)]
struct PreflightedArtifactPair {
    deployment: DeploymentIdentity,
    schema: SchemaManifest,
    prepared_functions: PreparedFunctionGeneration,
}

/// A manifest whose executable modules have already evaluated in isolated,
/// effectless VMs and whose exports exist. Keeping it in the preflight cache
/// does not make it callable; publication remains a separate post-commit cut.
#[derive(Clone, Debug)]
struct PreparedFunctionGeneration {
    manifest: FunctionManifest,
}

fn ensure_request_invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_REQUEST_JSON_INVALID",
        "server",
        "request body was not valid JSON for this operation",
    )
    .with_details(json!({ "error": message.into() }))
}

fn require_nonempty_ensure_identity(value: &str, field: &str) -> SnapbackResult<()> {
    if value.is_empty() {
        return Err(ensure_request_invalid(format!(
            "app.ensure identity field {field} must not be empty"
        )));
    }
    Ok(())
}

impl EnsureAppPairIdentity {
    fn normalized(&self, requested_mode: EnsureAppMode) -> SnapbackResult<EnsureAppActiveIdentity> {
        if self.schema.artifact_kind != "schemaManifest" {
            return Err(ensure_request_invalid(
                "app.ensure attest schema.artifactKind must be schemaManifest",
            ));
        }
        if self.functions.artifact_kind != "functionManifest" {
            return Err(ensure_request_invalid(
                "app.ensure attest functions.artifactKind must be functionManifest",
            ));
        }
        for (value, field) in [
            (&self.schema.schema_version, "pair.schema.schemaVersion"),
            (&self.schema.app_id, "pair.schema.appId"),
            (&self.schema.schema_hash, "pair.schema.schemaHash"),
            (&self.schema.inputs_hash, "pair.schema.inputsHash"),
            (
                &self.functions.schema_version,
                "pair.functions.schemaVersion",
            ),
            (&self.functions.app_id, "pair.functions.appId"),
            (&self.functions.bundle_hash, "pair.functions.bundleHash"),
            (&self.functions.inputs_hash, "pair.functions.inputsHash"),
        ] {
            require_nonempty_ensure_identity(value, field)?;
        }
        if self.schema.schema_version != requested_mode.artifact_version()
            || self.functions.schema_version != requested_mode.artifact_version()
        {
            return Err(ensure_request_invalid(format!(
                "app.ensure {:?} attestation requires {} artifacts",
                requested_mode,
                requested_mode.artifact_version()
            )));
        }
        if self.schema.schema_version != self.functions.schema_version
            || self.schema.app_id != self.functions.app_id
            || self.schema.inputs_hash != self.functions.inputs_hash
        {
            return Err(ensure_request_invalid(
                "app.ensure attestation requires a coherent schema/function identity pair",
            ));
        }
        Ok(EnsureAppActiveIdentity {
            schema_version: self.schema.schema_version.clone(),
            app_id: self.schema.app_id.clone(),
            schema_hash: self.schema.schema_hash.clone(),
            bundle_hash: self.functions.bundle_hash.clone(),
            inputs_hash: self.schema.inputs_hash.clone(),
        })
    }
}

impl EnsureAppExplicitInput {
    /// Validate intent-local shape before the provisioning core can inspect a
    /// loaded hash or take an effect. Complete persisted candidate-pair and
    /// target-capability preflight remains item 4's staged-mode work.
    pub fn validate(&self) -> SnapbackResult<()> {
        match self {
            Self::Attest {
                requested_mode,
                pair,
            } => {
                if *requested_mode != EnsureAppMode::Sessions {
                    return Err(ensure_request_invalid(
                        "explicit app.ensure attest is defined only for requestedMode sessions; v0-dev uses the legacy compatibility form",
                    ));
                }
                pair.normalized(*requested_mode)?;
                Ok(())
            }
            Self::Provision {
                requested_mode,
                schema,
                functions,
                seed,
            } => {
                if schema.is_none() && functions.is_none() && seed.is_none() {
                    return Err(ensure_request_invalid(
                        "app.ensure provision requires at least one of schema, functions, or seed",
                    ));
                }
                let expected = requested_mode.artifact_version();
                if let Some(schema) = schema
                    && schema.schema_version != expected
                {
                    return Err(ensure_request_invalid(format!(
                        "app.ensure {:?} provision requires schemaVersion {expected}",
                        requested_mode
                    )));
                }
                if let Some(functions) = functions
                    && functions.schema_version != expected
                {
                    return Err(ensure_request_invalid(format!(
                        "app.ensure {:?} provision requires function schemaVersion {expected}",
                        requested_mode
                    )));
                }
                if let (Some(schema), Some(functions)) = (schema, functions)
                    && (schema.schema_version != functions.schema_version
                        || schema.app_id != functions.app_id
                        || schema.inputs_hash != functions.inputs_hash)
                {
                    return Err(ensure_request_invalid(
                        "app.ensure provision requires a coherent schema/function artifact pair",
                    ));
                }
                Ok(())
            }
        }
    }
}

impl EnsureAppInput {
    fn validate_artifacts(&self) -> SnapbackResult<()> {
        if let Some(schema) = &self.schema {
            schema.validate_artifact()?;
        }
        if let Some(functions) = &self.functions {
            functions.validate_artifact()?;
        }
        if let Some(routes) = &self.routes {
            // Shape half only; validation against the served functions
            // manifest runs at install, after the functions half applies.
            crate::bundle::validate_routes_manifest_shape(routes).map_err(|message| {
                SnapbackError::error("SNAPBACK_ROUTES_MANIFEST_INVALID", "runtime", message)
            })?;
        }
        Ok(())
    }
}

// The live fan-out envelope types (`live_replace` / `live_delta` /
// `resync_required`) moved to `crate::live_wire` (LLP 0051 D4 / ENG-23891):
// they are schema-governed wire shapes now, generated into
// `schemas/live.envelope.schema.json` and drift-gated.

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LiveDeliveryStats {
    pub total_fanout_attempts: u64,
    pub total_deliveries: u64,
    pub total_skipped: u64,
    // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D4:
    // post-commit fan-out failures are per-subscription diagnostics, counted
    // here, never a failure of the already-committed mutation.
    pub total_failed: u64,
    pub last_fanout_subscriptions: usize,
    pub last_deliveries: usize,
    pub last_skipped: usize,
    pub last_failed: usize,
    /// The deliberately coarse v1 authorization blast radius, reported both
    /// globally and against each stable membership declaration that caused an
    /// event. These are cumulative runtime-epoch counters; delivery-frame
    /// counters above retain their existing reset semantics.
    ///
    /// @ref LLP 0056#invalidation-the-llp-0053-mapping -- make membership churn's global
    ///   quarantine cost measurable before declaration-scoped narrowing.
    #[serde(default)]
    pub authorization_blast_radius: AuthorizationBlastRadiusStats,
    /// RQS resume/refresh observability (LLP 0090 §Scalability: counters land
    /// with rollout step 1). Cumulative runtime-epoch counters.
    #[serde(default)]
    pub resume: RqsResumeStats,
}

/// Resume attempted/admitted/refused (by per-cause `SNAPBACK_RESUME_*` code),
/// rung taken, journal distance, and token refresh overhead.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RqsResumeStats {
    /// Subscribes that presented `resumeFromToken`.
    pub attempted: u64,
    /// Rung-1 `CurrentAsOf` answers (LLP 0090 D1.3).
    pub current_as_of_answers: u64,
    /// Rung-2 delta-replay answers (LLP 0090 D1.3 / rollout step 6): the
    /// witness verified and a `live_delta` answered the resume.
    #[serde(default)]
    pub delta_replay_answers: u64,
    /// Total `live_delta` ops replayed by rung-2 answers.
    #[serde(default)]
    pub replay_ops: u64,
    /// Estimated bytes avoided by rung-2 answers versus a rung-3
    /// replacement: serialized replacement rows minus the serialized delta
    /// envelope, saturating at zero per answer.
    #[serde(default)]
    pub replay_bytes_avoided: u64,
    /// Token presented, answered with rung 3 (refusal or no available proof).
    pub fresh_replace_answers: u64,
    /// Refusals by `SNAPBACK_RESUME_*` code (LLP 0091 §0B.6).
    pub refused: BTreeMap<String, u64>,
    /// Rung-1 table-set fall-throughs: journal floor held but no certified
    /// dependency-summary artifact exists yet (cluster 0C), so the answer is
    /// rung 3. Not a token refusal — its own telemetry cause.
    pub no_certified_summary: u64,
    /// Tokens minted on the live path (subscribe answers + envelope refresh).
    pub tokens_minted: u64,
    /// Refreshed tokens attached to `live_replace`/`live_delta` envelopes.
    pub tokens_refreshed: u64,
    /// Rows/args the 0A canonicalization refused at mint (`resume` absent).
    pub mint_refusals: u64,
    /// Journal distance (head − token version) of the last presented token.
    pub last_journal_distance: u64,
    /// Maximum observed journal distance.
    pub max_journal_distance: u64,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationBlastRadiusStats {
    pub global: AuthorizationBlastRadiusCounters,
    pub membership_declarations: BTreeMap<String, AuthorizationBlastRadiusCounters>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationBlastRadiusCounters {
    pub version_advances: u64,
    pub quarantined_subscriptions: u64,
    pub resnapshots: u64,
}

impl AuthorizationBlastRadiusStats {
    fn for_event(
        &mut self,
        declarations: &[String],
        update: impl Fn(&mut AuthorizationBlastRadiusCounters),
    ) {
        update(&mut self.global);
        for declaration in declarations {
            update(
                self.membership_declarations
                    .entry(declaration.clone())
                    .or_default(),
            );
        }
    }
}

/// The result of running a generated function from the admin function runner.
///
/// Carries the function's declared read-set and write-set beside the outcome so
/// a "declared namespace does not match what the handler touches" mismatch is
/// visible — the Valet "counts stuck at zero" failure class.
///
/// @ref LLP 0017#function-runner-and-code-runner — the first code runner is a
/// generated-function runner that surfaces read/write sets and diagnostics.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FunctionRunResult {
    pub ok: bool,
    pub function: String,
    pub kind: Option<FunctionKind>,
    pub reads: Vec<String>,
    pub writes: Vec<String>,
    #[serde(default)]
    pub captured_reads: Vec<CapturedReadDependency>,
    #[serde(default)]
    pub captured_writes: Vec<CapturedWriteDependency>,
    /// Envelope-level audit fact for session-mode operator invocation. The
    /// handler input remains anonymous; this records that access came through
    /// the explicit administrative bypass rather than an app principal.
    #[serde(default, rename = "adminBypass", skip_serializing_if = "bool_is_false")]
    pub admin_bypass: bool,
    pub elapsed_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<Diagnostic>,
}

fn bool_is_false(value: &bool) -> bool {
    !*value
}

/// How a staged action must execute.
///
/// Staging runs under the global instance mutex. Managed server callers run a
/// `HostPlan` one exact reserved mutation at a time and run `Detached` Ibex
/// actions on a watchdogged thread; direct-library callers keep their
/// synchronous borrow and use the compatibility reservation path. Nested Ibex
/// mutations execute against an isolated read view and reacquire the mutex
/// only for preview/commit; raw action `ctx.db` calls are rejected before host
/// dispatch (ENG-23324 / ENG-24339 / ENG-24340).
// This crate-private carrier is destructured by the local, admin, and server
// execution seams. Boxing only one prepared arm would add heap allocation to
// every host-plan action and obscure the explicit staging contract.
#[allow(clippy::large_enum_variant)]
pub(crate) enum StagedAction {
    /// Host-plan actions run bounded mutation steps with no egress. Managed
    /// callers release Local for each room reservation; direct callers remain
    /// synchronous through [`LocalSnapback::invoke_action_prepared`].
    HostPlan(PreparedInvocation),
    /// Ibex-module actions may perform egress; everything the runtime needs
    /// is cloned out so the run can proceed without borrowing the instance.
    Detached(Box<DetachedIbexAction>),
}

pub(crate) enum StagedRecordedMutation {
    Done(Box<(SnapbackResult<MutationOutput>, Receipt)>),
    Ready(Box<StagedRecordedMutationCommit>),
}

pub(crate) struct StagedRecordedMutationCommit {
    name: String,
    transport: String,
    correlation: Option<Value>,
    receipt_mutation_id: String,
    input: HandlerInput,
    prepared: PreparedInvocation,
    identity: Option<ClientMutationIdentity>,
    epoch_scopes: BTreeSet<String>,
    execution: StagedMutationExecution,
}

struct MutationReceiptPublication<'a> {
    name: &'a str,
    transport: &'a str,
    correlation: Option<Value>,
    mutation_id: String,
    admission: &'a AdmissionLease,
    effect: &'static str,
}

impl<'a> MutationReceiptPublication<'a> {
    fn new(
        name: &'a str,
        transport: &'a str,
        correlation: Option<Value>,
        mutation_id: String,
        admission: &'a AdmissionLease,
    ) -> Self {
        Self {
            name,
            transport,
            correlation,
            mutation_id,
            admission,
            effect: "mutation receipt publication",
        }
    }

    fn with_effect(mut self, effect: &'static str) -> Self {
        self.effect = effect;
        self
    }
}

enum StagedMutationExecution {
    HostPlan(crate::manifest::MutationPlan),
    Buffered(BufferedCommitPayload),
}

/// A durable cron claim paired with its process-local finite admission root.
/// Only the `CronRunClaim` is persisted; the lease lives solely in this
/// execution carrier and fences handler and finish publication together.
pub(crate) struct AdmittedCronClaim {
    claim: CronRunClaim,
    admission: AdmissionLease,
}

impl AdmittedCronClaim {
    pub(crate) fn admission_lease(&self) -> &AdmissionLease {
        &self.admission
    }
}

impl Deref for AdmittedCronClaim {
    type Target = CronRunClaim;

    fn deref(&self) -> &Self::Target {
        &self.claim
    }
}

pub(crate) struct DetachedIbexAction {
    pub module: crate::manifest::IbexModule,
    pub grants: Value,
    pub redactor: crate::config::SecretRedactor,
    pub runtime: RuntimeManager,
    /// Exact function authority prepared before the action leaves the
    /// instance lock. Nested mutations inherit from this value.
    pub invocation: PreparedInvocation,
    /// Generation of the code/schema/reset boundary that authorized this
    /// action. Every later host call and final successful completion must still
    /// observe this exact generation.
    pub app_generation: u64,
    pub app_generation_fence: Arc<AtomicU64>,
}

// As above, the prepared arm is the ordinary in-lock path; keep its stable
// cross-module carrier allocation-free.
#[allow(clippy::large_enum_variant)]
pub(crate) enum StagedNestedMutation {
    InLock(StagedHostPlanNestedMutation),
    Detached(Box<DetachedIbexMutation>),
}

pub(crate) struct StagedHostPlanNestedMutation {
    pub preflight: crate::storage::AuthorizationCommitPreflight,
    pub input: HandlerInput,
    pub invocation: PreparedInvocation,
}

pub(crate) struct DetachedIbexMutation {
    pub binding: DetachedMutationBinding,
    pub read: DetachedMutationRead,
}

pub(crate) struct DetachedMutationBinding {
    pub function: FunctionDefinition,
    pub invocation: PreparedInvocation,
    pub schema: SchemaManifest,
    pub app_generation: u64,
    pub epoch_scopes: BTreeSet<String>,
}

pub(crate) enum DetachedMutationRead {
    Lane(ReadLane),
    Snapshot(Box<LocalDatabase>),
}

/// Staging outcome for the app-action envelope surface: either a ready
/// (error) envelope, or the envelope inputs plus the execution mode.
// This is a cross-module staging protocol whose ready arm is consumed by both
// admin and server runners. Preserve that explicit internal signature.
#[allow(clippy::large_enum_variant)]
pub(crate) enum StagedAppAction {
    Done(Box<FunctionRunResult>),
    Ready(AppActionStage),
}

pub(crate) struct AppActionStage {
    pub reads: Vec<String>,
    pub writes: Vec<String>,
    pub mode: StagedAction,
}

/// A bounded HostPlan action detached from the managed `LocalSnapback` guard.
/// The server evaluates and commits one `RunMutation` step at a time through
/// the authorization-reservation protocol; the captured generation prevents
/// a reload/reset from splicing a later function generation into the plan.
#[derive(Clone)]
pub(crate) struct ManagedHostPlanAction {
    pub(crate) plan: ActionPlan,
    pub(crate) input: HandlerInput,
    pub(crate) metadata: CronRunMetadata,
    pub(crate) invocation: PreparedInvocation,
    pub(crate) app_generation: u64,
    pub(crate) app_generation_fence: Arc<AtomicU64>,
    redactor: crate::config::SecretRedactor,
}

/// Staging outcome for a config-verify probe run (ENG-23493): entry checks
/// and the cooldown claim happen under the lock; a probe that cannot even
/// stage (unknown function, non-action) is recorded as a failed verification
/// in the same lock window, so `Done` carries a finished outcome.
pub(crate) enum StagedConfigVerify {
    Done(Box<ConfigVerifyOutcome>),
    Ready(Box<ConfigVerifyStage>),
}

pub(crate) struct ConfigVerifyStage {
    pub probe: String,
    /// Opaque identity of the exact entry value the probe is exercising.
    pub entry_revision: u64,
    /// Cooldown-claim wall time; also the `at_ms` of the eventual record.
    pub started_ms: u64,
    pub input: HandlerInput,
    pub metadata: CronRunMetadata,
    pub mode: StagedAction,
    pub admission: AdmissionLease,
}

/// Assemble the `FunctionRunResult` envelope for an action run — shared by
/// the in-lock path and the server's detached path (ENG-23324).
pub(crate) fn action_run_result(
    name: &str,
    reads: Vec<String>,
    writes: Vec<String>,
    elapsed_ms: u64,
    result: SnapbackResult<Value>,
) -> FunctionRunResult {
    let base = FunctionRunResult {
        ok: true,
        function: name.to_owned(),
        kind: Some(FunctionKind::Action),
        reads,
        writes,
        captured_reads: Vec::new(),
        captured_writes: Vec::new(),
        admin_bypass: false,
        elapsed_ms,
        version: None,
        changed_count: None,
        rows: None,
        result: None,
        diagnostic: None,
    };
    match result {
        Ok(value) => FunctionRunResult {
            result: Some(value),
            ..base
        },
        Err(error) => FunctionRunResult {
            ok: false,
            diagnostic: Some(error.diagnostic),
            ..base
        },
    }
}

fn function_run_admission_failure(name: &str, error: SnapbackError) -> FunctionRunResult {
    FunctionRunResult {
        ok: false,
        function: name.to_owned(),
        kind: None,
        reads: Vec::new(),
        writes: Vec::new(),
        captured_reads: Vec::new(),
        captured_writes: Vec::new(),
        admin_bypass: false,
        elapsed_ms: 0,
        version: None,
        changed_count: None,
        rows: None,
        result: None,
        diagnostic: Some(error.diagnostic),
    }
}

/// The metadata a manually triggered (non-cron) action run carries; `prefix`
/// names the triggering surface (`action` for the app-data route, `admin`
/// for the function runner).
pub(crate) fn manual_action_metadata(prefix: &str, name: &str) -> CronRunMetadata {
    let now = now_millis();
    CronRunMetadata {
        job_name: format!("{prefix}:{name}"),
        run_id: format!("{prefix}:{name}:{now}"),
        scheduled_at_ms: None,
        due_at_ms: now,
        idempotency_key: format!("{prefix}:{name}:manual"),
        slot_key: format!("{prefix}:{name}:manual"),
        attempt: 1,
        trigger: CronRunTrigger::Manual,
    }
}

/// The handler input a claimed cron run passes to its action.
pub(crate) fn cron_claim_input(claim: &CronRunClaim) -> HandlerInput {
    HandlerInput {
        args: json!({
            "run": claim.metadata,
            "job": claim.job.name,
        }),
        auth: Default::default(),
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

/// Shared per-connection last-seen map for the L2 reaper. Ephemeral
/// operations and outbox drains count as liveness but no longer take the
/// global write mutex (L9), so the map is a small internally locked handle
/// shared between `LocalSnapback` (which reaps on the write lane) and the
/// server's lock-free ephemeral paths.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L2: liveness
/// touching survives the ephemeral paths leaving the global mutex.
#[derive(Clone, Default)]
pub struct ConnectionActivity {
    last_seen: Arc<StdMutex<BTreeMap<String, u64>>>,
}

impl ConnectionActivity {
    pub fn touch(&self, connection_id: &str, now_ms: u64) {
        self.lock().insert(connection_id.to_owned(), now_ms);
    }

    /// Linearize an operation against reaping. The activity lock is held
    /// through `act`; disconnect removes activity before taking any room or
    /// outbox lock, so the shared order is activity → ephemeral state.
    fn act_if_active<T>(
        &self,
        connection_id: &str,
        now_ms: u64,
        act: impl FnOnce() -> T,
    ) -> Option<T> {
        let mut activity = self.lock();
        if !activity.contains_key(connection_id) {
            return None;
        }
        let output = act();
        activity.insert(connection_id.to_owned(), now_ms);
        Some(output)
    }

    fn remove(&self, connection_id: &str) {
        self.lock().remove(connection_id);
    }

    fn len(&self) -> usize {
        self.lock().len()
    }

    #[cfg(test)]
    fn contains(&self, connection_id: &str) -> bool {
        self.lock().contains_key(connection_id)
    }

    fn stale_ids(&self, cutoff_ms: u64) -> Vec<String> {
        self.lock()
            .iter()
            .filter(|(_, seen)| **seen < cutoff_ms)
            .map(|(id, _)| id.clone())
            .collect()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, BTreeMap<String, u64>> {
        self.last_seen
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

/// The server-facing ephemeral handle: the internally synchronized room
/// authority plus the connection-activity map, so ephemeral operations,
/// collection ensure, and outbox drains proceed without the global write
/// mutex while still counting as liveness for the L2 reaper. These are pure
/// memory operations (no Hermes, no SQLite) — outside the L7 exec guard's
/// blocking classes — so they run inline on async workers by design.
///
/// @ref LLP 0026#as-built-sharded-local-room-authority-written-2026-07-02-before-the-l9-implementation — the server surface off the global mutex.
#[derive(Clone)]
pub struct EphemeralApi {
    store: LocalEphemeralBackend,
    activity: ConnectionActivity,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct DisconnectedConnectionTopology {
    dropped_subscriptions: usize,
    dropped_effect_fences: BTreeSet<crate::ephemeral::ConnectionEffectFence>,
}

impl EphemeralApi {
    pub(crate) fn reserve_authorization_commit(
        &self,
        preflight: crate::storage::AuthorizationCommitPreflight,
        cancellation: Arc<crate::storage::AuthorizationReservationCancellation>,
    ) -> SnapbackResult<Box<dyn crate::storage::AuthorizationCommitReservation>> {
        self.store
            .reserve_authorization_commit(preflight, cancellation)
    }

    /// Remove liveness first, then wipe every room, outbox, notifier-side
    /// wake, and rate-bucket effect owned by the connection. This handle is
    /// deliberately usable without `LocalSnapback`, so transport teardown
    /// never holds Local while acquiring ephemeral shard locks.
    pub fn disconnect(&self, connection_id: &str, now_ms: u64) {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "EphemeralApi::disconnect",
        );
        self.activity.remove(connection_id);
        self.store.disconnect(connection_id, now_ms);
    }

    /// Whole-ID cleanup for a registry-retired grant whose removal already
    /// enabled mint-only containment. This preserves any exact typed terminal
    /// notifier event and emits no disconnected-resync wake.
    pub(crate) fn disconnect_terminal_retired(&self, connection_id: &str, now_ms: u64) {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "EphemeralApi::disconnect_terminal_retired",
        );
        self.activity.remove(connection_id);
        self.store
            .disconnect_terminal_retired(connection_id, now_ms);
    }

    fn disconnect_guarded(&self, connection_id: &str, now_ms: u64) -> bool {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "EphemeralApi::disconnect_guarded",
        );
        self.activity.remove(connection_id);
        self.store.disconnect_guarded(connection_id, now_ms)
    }

    pub(crate) fn stale_connection_ids(&self, now_ms: u64, ttl_ms: u64) -> Vec<String> {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "EphemeralApi::stale_connection_ids",
        );
        self.activity.stale_ids(now_ms.saturating_sub(ttl_ms))
    }

    pub(crate) fn enqueue_disconnected_subscription_resync(
        &self,
        connection_id: &str,
        topology: &DisconnectedConnectionTopology,
    ) {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "EphemeralApi::enqueue_disconnected_subscription_resync",
        );
        if topology.dropped_subscriptions == 0
            || !self.store.delivery_notifier().is_registered(connection_id)
        {
            return;
        }
        let payload = serde_json::to_vec(&json!({
            "kind": "resync_required",
            "reason": "disconnected",
            "clearRetained": true,
        }))
        .unwrap_or_default();
        if topology.dropped_effect_fences.is_empty() {
            self.store
                .enqueue_durable(connection_id.to_owned(), payload);
        } else {
            for effect_fence in &topology.dropped_effect_fences {
                self.store.enqueue_durable_bound(
                    connection_id.to_owned(),
                    payload.clone(),
                    effect_fence.clone(),
                );
            }
        }
    }

    pub fn collection_requires_room_permission(&self, name: &str) -> bool {
        self.store.collection_requires_room_permission(name)
    }

    pub(crate) fn collection_definition(&self, name: &str) -> Option<EphemeralCollection> {
        self.store.collection_definition(name)
    }

    pub(crate) fn begin_server_authorized_room_act(
        &self,
        collection: &str,
        scope: &crate::ephemeral::Scope,
    ) -> Result<Option<crate::ephemeral::RoomAuthorityPermit>, crate::ephemeral::EphemeralError>
    {
        self.store
            .begin_server_authorized_room_act(collection, scope)
    }

    #[cfg(test)]
    pub(crate) fn authorization_expectation_for_test(
        &self,
    ) -> Option<crate::storage::AuthorizationVersion> {
        self.store.authorization_expectation_for_test()
    }

    #[cfg(test)]
    pub(crate) fn install_frame_before_first_enqueue_hook_for_test(
        &self,
        reached: std::sync::mpsc::SyncSender<EphemeralMessage>,
        release: std::sync::mpsc::Receiver<()>,
    ) {
        self.store
            .install_frame_before_first_enqueue_hook_for_test(reached, release);
    }

    // Touch-after-success (MEDIUM finding 2): the activity touch happens
    // *after* the store op registers/enqueues, so a registration that
    // survives a racing write-lane `disconnect` (which removes activity
    // before it removes registrations) always has a live activity entry.
    // Registering an entry the L2 reaper can never see — a zombie subscriber
    // whose room never prunes — is thereby impossible. A failed op still
    // touches: the caller was demonstrably alive and a rejected publish must
    // not make a live connection look reapable.
    pub fn publish(
        &self,
        request: PublishRequest,
        now_ms: u64,
    ) -> Result<PublishOutcome, crate::ephemeral::EphemeralError> {
        self.publish_with_room_authority(request, now_ms, None)
    }

    pub(crate) fn publish_with_room_authority(
        &self,
        request: PublishRequest,
        now_ms: u64,
        room_authority: Option<&crate::ephemeral::RoomAuthorityPermit>,
    ) -> Result<PublishOutcome, crate::ephemeral::EphemeralError> {
        let connection_id = request.connection_id.clone();
        let outcome = self
            .store
            .publish_with_room_authority(request, now_ms, room_authority);
        self.activity.touch(&connection_id, now_ms);
        outcome
    }

    pub fn subscribe(
        &self,
        request: SubscribeRequest,
        now_ms: u64,
    ) -> Result<EphemeralMessage, crate::ephemeral::EphemeralError> {
        self.subscribe_with_room_authority(request, now_ms, None)
    }

    pub(crate) fn subscribe_with_room_authority(
        &self,
        request: SubscribeRequest,
        now_ms: u64,
        room_authority: Option<&crate::ephemeral::RoomAuthorityPermit>,
    ) -> Result<EphemeralMessage, crate::ephemeral::EphemeralError> {
        let connection_id = request.connection_id.clone();
        let outcome = self
            .store
            .subscribe_with_room_authority(request, now_ms, room_authority);
        self.activity.touch(&connection_id, now_ms);
        outcome
    }

    pub(crate) fn subscribe_with_room_authority_and_effect_fence(
        &self,
        request: SubscribeRequest,
        now_ms: u64,
        room_authority: Option<&crate::ephemeral::RoomAuthorityPermit>,
        effect_fence: crate::ephemeral::ConnectionEffectFence,
    ) -> Result<EphemeralMessage, crate::ephemeral::EphemeralError> {
        let connection_id = request.connection_id.clone();
        let outcome = self.store.subscribe_with_room_authority_and_effect_fence(
            request,
            now_ms,
            room_authority,
            Some(effect_fence),
        );
        self.activity.touch(&connection_id, now_ms);
        outcome
    }

    pub fn delete(
        &self,
        request: DeleteRequest,
        now_ms: u64,
    ) -> Result<Option<EphemeralMessage>, crate::ephemeral::EphemeralError> {
        self.delete_with_room_authority(request, now_ms, None)
    }

    pub(crate) fn delete_with_room_authority(
        &self,
        request: DeleteRequest,
        now_ms: u64,
        room_authority: Option<&crate::ephemeral::RoomAuthorityPermit>,
    ) -> Result<Option<EphemeralMessage>, crate::ephemeral::EphemeralError> {
        let connection_id = request.connection_id.clone();
        let outcome = self
            .store
            .delete_with_room_authority(request, now_ms, room_authority);
        self.activity.touch(&connection_id, now_ms);
        outcome
    }

    /// Stop observing a room (ENG-22527 item 3 / SECURITY). Removes only this
    /// connection's subscriber registration — published entries are untouched
    /// — and prunes the room if it is now empty. Reached only over the shared
    /// live socket, where `handle_live_socket_text` has already bound the
    /// requester to `request.connection_id`; there is no public HTTP route, so
    /// a participant cannot evict another connection. Touch-after-success
    /// (finding 2), consistent with the other ops.
    pub fn unsubscribe(
        &self,
        request: SubscribeRequest,
        now_ms: u64,
    ) -> Result<bool, crate::ephemeral::EphemeralError> {
        self.unsubscribe_with_room_authority(request, now_ms, None)
    }

    pub(crate) fn unsubscribe_with_room_authority(
        &self,
        request: SubscribeRequest,
        now_ms: u64,
        room_authority: Option<&crate::ephemeral::RoomAuthorityPermit>,
    ) -> Result<bool, crate::ephemeral::EphemeralError> {
        let connection_id = request.connection_id.clone();
        let removed = self
            .store
            .unsubscribe_with_room_authority(request, room_authority)?;
        self.activity.touch(&connection_id, now_ms);
        Ok(removed)
    }

    pub fn ensure_collections(
        &self,
        collections: Vec<EphemeralCollection>,
    ) -> Result<CollectionEnsureOutcome, crate::ephemeral::EphemeralError> {
        self.store.ensure_collections(collections)
    }

    /// Drain compatibility traffic from a connection's outbox. Once session
    /// authorization fencing is installed, auth-scoped durable data and
    /// protected-room frames remain queued; transport embeddings use
    /// [`Self::drain_outbox_for_send`] and retain its wrappers through send. A
    /// poll is still an L2 liveness signal. Touch-after-drain means a race with
    /// `disconnect` can re-add only a bare, reapable activity entry.
    pub fn drain_outbox(&self, connection_id: &str) -> Vec<RealtimeEnvelope> {
        let drained = self.store.drain_outbox(connection_id);
        self.activity.touch(connection_id, now_millis());
        drained
    }

    /// Guarded destructive drain for embedding-owned transports. Every
    /// returned value must remain alive until its envelope reaches the final
    /// transport sink.
    pub fn drain_outbox_for_send(
        &self,
        connection_id: &str,
    ) -> Vec<crate::ephemeral::AdmittedRealtimeEnvelope> {
        let drained = self.store.drain_outbox_for_send(connection_id);
        self.activity.touch(connection_id, now_millis());
        drained
    }

    /// Compatibility HTTP poll that distinguishes a live empty/unfenced queue
    /// from an extinct connection. `None` is a typed resnapshot boundary; a
    /// sessions transport publishes app data through the guarded drain.
    pub fn drain_outbox_if_active(&self, connection_id: &str) -> Option<Vec<RealtimeEnvelope>> {
        self.activity
            .act_if_active(connection_id, now_millis(), || {
                self.store.drain_outbox(connection_id)
            })
    }

    #[cfg(test)]
    pub(crate) fn drain_outbox_for_send_bound_if_active(
        &self,
        connection_id: &str,
        effect_fence: &crate::ephemeral::ConnectionEffectFence,
    ) -> Option<Vec<crate::ephemeral::AdmittedRealtimeEnvelope>> {
        self.activity
            .act_if_active(connection_id, now_millis(), || {
                self.store
                    .drain_outbox_for_send_bound(connection_id, effect_fence)
            })
    }

    pub(crate) fn drain_outbox_for_send_bound_if_active_with_handoff_limit(
        &self,
        connection_id: &str,
        effect_fence: &crate::ephemeral::ConnectionEffectFence,
        max_handoff_bytes: usize,
    ) -> Option<Vec<crate::ephemeral::AdmittedRealtimeEnvelope>> {
        self.activity
            .act_if_active(connection_id, now_millis(), || {
                self.store.drain_outbox_for_send_bound_with_handoff_limit(
                    connection_id,
                    effect_fence,
                    max_handoff_bytes,
                )
            })
    }

    pub(crate) fn has_eligible_recovery_marker_bound_if_active(
        &self,
        connection_id: &str,
        effect_fence: &crate::ephemeral::ConnectionEffectFence,
    ) -> Option<bool> {
        self.activity
            .act_if_active(connection_id, now_millis(), || {
                self.store
                    .has_eligible_recovery_marker_bound(connection_id, effect_fence)
            })
    }

    pub(crate) fn acknowledge_outbox_handoff_bound(
        &self,
        connection_id: &str,
        effect_fence: &crate::ephemeral::ConnectionEffectFence,
        leases: &[crate::ephemeral::OutboxDrainLease],
    ) -> bool {
        self.store
            .acknowledge_outbox_handoff_bound(connection_id, effect_fence, leases)
    }

    pub(crate) fn try_offer_outbox_projection_bound<T>(
        &self,
        connection_id: &str,
        effect_fence: &crate::ephemeral::ConnectionEffectFence,
        value: T,
        offer: impl FnOnce(T) -> Result<(), T>,
    ) -> crate::ephemeral::OutboxLeaseCommit<T> {
        self.store
            .try_offer_projection_bound(connection_id, effect_fence, value, offer)
    }

    #[cfg(test)]
    pub(crate) fn drain_outbox_for_send_if_active(
        &self,
        connection_id: &str,
    ) -> Option<Vec<crate::ephemeral::AdmittedRealtimeEnvelope>> {
        self.activity
            .act_if_active(connection_id, now_millis(), || {
                self.store.drain_outbox_for_send(connection_id)
            })
    }

    /// Compatibility drain for a WS push task. In sessions it extracts only
    /// unfenced traffic; real app-data publication uses the guarded sibling.
    /// Unlike an HTTP poll, this is server-initiated — the 30s safety net may
    /// call it after a peer silently vanishes. Touch activity only when work
    /// drains, or a dead idle peer would be immortal against the L2 reaper.
    pub fn drain_live_stream_if_current(
        &self,
        connection_id: &str,
        generation: u64,
    ) -> Option<Vec<String>> {
        let drained = self
            .store
            .drain_outbox_if_current(connection_id, generation)?;
        if !drained.is_empty() {
            self.activity.touch(connection_id, now_millis());
        }
        Some(drained.into_iter().filter_map(live_stream_text).collect())
    }

    /// Generation-bound guarded drain for an embedding-owned WebSocket (or
    /// equivalent push transport). Retain each admitted wrapper through send.
    pub fn drain_live_stream_for_send_if_current(
        &self,
        connection_id: &str,
        generation: u64,
    ) -> Option<Vec<crate::ephemeral::AdmittedRealtimeEnvelope>> {
        let drained = self
            .store
            .drain_outbox_for_send_if_current(connection_id, generation)?;
        if !drained.is_empty() {
            self.activity.touch(connection_id, now_millis());
        }
        Some(drained)
    }

    pub(crate) fn drain_live_stream_for_send_bound_if_current_with_handoff_limit(
        &self,
        connection_id: &str,
        generation: u64,
        effect_fence: &crate::ephemeral::ConnectionEffectFence,
        max_handoff_bytes: usize,
    ) -> Option<Vec<crate::ephemeral::AdmittedRealtimeEnvelope>> {
        let drained = self
            .store
            .drain_outbox_for_send_bound_if_current_with_handoff_limit(
                connection_id,
                generation,
                effect_fence,
                max_handoff_bytes,
            )?;
        if !drained.is_empty() {
            self.activity.touch(connection_id, now_millis());
        }
        Some(drained)
    }

    pub(crate) fn begin_final_send(
        &self,
        envelope: &RealtimeEnvelope,
    ) -> Result<Option<RealtimePublicationPermit>, crate::ephemeral::EphemeralError> {
        self.store.begin_final_send(envelope)
    }

    #[cfg(test)]
    pub(crate) fn prepare_room_authorization_event_for_test(
        &self,
        authorization: crate::storage::AuthorizationVersion,
    ) -> SnapbackResult<crate::ephemeral::RoomDependencyTicket> {
        self.store.prepare_room_authorization_event(authorization)
    }

    #[cfg(test)]
    pub(crate) fn rollback_room_authorization_event_for_test(
        &self,
        ticket: &crate::ephemeral::RoomDependencyTicket,
    ) -> bool {
        self.store.rollback_room_authorization_event(ticket)
    }

    /// Embedded/test compatibility drain without socket-generation ownership.
    /// WebSocket app-data composition must use
    /// [`Self::drain_live_stream_for_send_if_current`].
    pub fn drain_live_stream(&self, connection_id: &str) -> Vec<String> {
        let drained = self.store.drain_outbox(connection_id);
        if !drained.is_empty() {
            self.activity.touch(connection_id, now_millis());
        }
        drained.into_iter().filter_map(live_stream_text).collect()
    }

    /// Record client-initiated liveness for the L2 reaper — the WS task calls
    /// this on incoming frames (e.g. the Pong answering a safety-net Ping).
    /// Same touch-after-op shape as `drain_outbox`: racing a `disconnect` it
    /// re-adds only a bare activity entry (self-healing, reapable).
    pub fn touch_connection(&self, connection_id: &str) {
        self.activity.touch(connection_id, now_millis());
    }

    pub fn cleanup_expired(&self, now_ms: u64) {
        self.store.cleanup_expired(now_ms);
    }

    /// Gather shard diagnostics without the global Local writer. Server
    /// inspect/receipts composition invokes this in the post-Local blocking
    /// phase; direct embedded callers may invoke it synchronously.
    pub(crate) fn diagnostics(&self) -> EphemeralDiagnostics {
        self.store.diagnostics()
    }

    pub(crate) fn purge_connection_effects(
        &self,
        connection_id: &str,
        effect_fence: &crate::ephemeral::ConnectionEffectFence,
    ) {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "EphemeralApi::purge_connection_effects",
        );
        self.store
            .purge_connection_effects(connection_id, effect_fence);
    }

    pub(crate) fn purge_connection_effects_silently(
        &self,
        connection_id: &str,
        effect_fence: &crate::ephemeral::ConnectionEffectFence,
    ) {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "EphemeralApi::purge_connection_effects_silently",
        );
        self.store
            .purge_connection_effects_silently(connection_id, effect_fence);
    }

    #[cfg(test)]
    pub(crate) fn active_connection_count_for_test(&self) -> usize {
        self.activity.len()
    }

    #[cfg(test)]
    pub(crate) fn has_connection_residue_for_test(&self, connection_id: &str) -> bool {
        self.activity.contains(connection_id)
            || self.store.has_connection_residue_for_test(connection_id)
    }

    pub(crate) fn pending_room_reauthorizations(
        &self,
    ) -> Vec<crate::ephemeral::PendingRoomReauthorization> {
        self.store.pending_room_reauthorizations()
    }

    pub(crate) fn complete_room_reauthorization(
        &self,
        room_id: &crate::ephemeral::RoomId,
        room_authority_generation: u64,
        resolutions: Vec<crate::ephemeral::RoomSubscriberResolution>,
    ) -> SnapbackResult<bool> {
        self.store
            .complete_room_reauthorization(room_id, room_authority_generation, resolutions)
    }

    /// The delivery notifier the WebSocket task registers with (L8).
    pub fn delivery_notifier(&self) -> Arc<DeliveryNotifier> {
        self.store.delivery_notifier()
    }

    pub(crate) fn subscription_requires_permission(&self, collection: &str) -> Option<bool> {
        self.store.subscription_requires_permission(collection)
    }

    #[cfg(test)]
    pub(crate) fn enqueue_durable_for_test(&self, connection_id: &str, payload: Vec<u8>) {
        self.store
            .enqueue_durable(connection_id.to_owned(), payload);
    }

    #[cfg(test)]
    pub(crate) fn enqueue_durable_bound_for_test(
        &self,
        connection_id: &str,
        payload: Vec<u8>,
        effect_fence: crate::ephemeral::ConnectionEffectFence,
    ) {
        self.store
            .enqueue_durable_bound(connection_id.to_owned(), payload, effect_fence);
    }

    #[cfg(test)]
    pub(crate) fn overflow_outbox_for_test(
        &self,
        connection_id: &str,
        effect_fence: Option<crate::ephemeral::ConnectionEffectFence>,
    ) {
        self.store
            .overflow_outbox_for_test(connection_id, effect_fence);
    }

    #[cfg(test)]
    pub(crate) fn enqueue_ephemeral_for_test(
        &self,
        connection_id: &str,
        message: crate::ephemeral::EphemeralMessage,
        effect_fence: Option<crate::ephemeral::ConnectionEffectFence>,
    ) {
        self.store
            .enqueue_ephemeral_for_test(connection_id, message, effect_fence);
    }
}

/// One entry's LLP 0036 status: names and states only — never values.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ConfigEntryStatus {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    pub secret: bool,
    pub required: bool,
    pub pool: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probe: Option<String>,
    #[serde(rename = "howToGet", skip_serializing_if = "Option::is_none")]
    pub how_to_get: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acquisition: Option<Value>,
    pub set: bool,
    #[serde(rename = "memberCount")]
    pub member_count: usize,
    #[serde(rename = "lastChangedMs", skip_serializing_if = "Option::is_none")]
    pub last_changed_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified: Option<ConfigVerificationStatus>,
    #[serde(rename = "applyState")]
    pub apply_state: String,
}

/// Closed public projection of a stored verification record. Probe messages
/// are handler-controlled text and therefore stay in operator-local storage;
/// AdminRead responses expose only the finite state and timestamp.
///
/// @ref LLP 0031#independent-policy-axes — config status remains AdminRead only
/// because this type cannot carry handler output or configured values.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ConfigVerificationStatus {
    pub ok: bool,
    #[serde(rename = "atMs", alias = "at_ms")]
    pub at_ms: u64,
}

impl From<&VerificationRecord> for ConfigVerificationStatus {
    fn from(record: &VerificationRecord) -> Self {
        Self {
            ok: record.ok,
            at_ms: record.at_ms,
        }
    }
}

/// The `config.status` payload (LLP 0036 §Operations and projections).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ConfigStatus {
    pub generation: u64,
    #[serde(rename = "backendClass")]
    pub backend_class: String,
    /// ENG-22752: whether any app has loaded a functions manifest on this
    /// instance yet. With inspect-first boot the answer is "no" until the app
    /// page is opened once, so empty `entries` means "nothing declared *yet*"
    /// rather than "this app declares no configuration" — the setup wizard
    /// needs the distinction to say which one is true.
    #[serde(rename = "appProvisioned", default)]
    pub app_provisioned: bool,
    pub entries: Vec<ConfigEntryStatus>,
    #[serde(rename = "requiredMissing")]
    pub required_missing: Vec<String>,
}

/// The `config.plan` dry-run facts (LLP 0036 §Operations and projections).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ConfigPlan {
    #[serde(rename = "backendClass")]
    pub backend_class: String,
    #[serde(rename = "writeLocus")]
    pub write_locus: String,
    #[serde(rename = "appliesImmediately")]
    pub applies_immediately: bool,
    #[serde(rename = "valueWritesAccepted")]
    pub value_writes_accepted: bool,
    pub generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
    #[serde(rename = "wouldApplyState")]
    pub would_apply_state: String,
}

/// The `config.set` / `config.unset` envelope facts — never values.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ConfigWriteOutcome {
    pub entry: String,
    #[serde(rename = "applyState")]
    pub apply_state: String,
    #[serde(rename = "valueChanged")]
    pub value_changed: bool,
    pub generation: u64,
}

/// The `config.verify` envelope facts.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ConfigVerifyOutcome {
    pub entry: String,
    pub ok: bool,
    pub verified: ConfigVerificationStatus,
    pub generation: u64,
}

pub struct LocalSnapback {
    db: LocalDatabase,
    /// Process-unique registry namespace for this instance's StreamAttemptV1
    /// records (LLP 0076). A monotonic nonce, never a pointer: allocator
    /// reuse must not let a new instance observe a dead instance's live
    /// registry entries.
    stream_attempt_namespace: usize,
    functions: FunctionManifest,
    // Complete pairs proven by this process. Durable deployment identities
    // are hashes, not manifest bodies, so they can never supply a missing
    // `/app/ensure` half after restart. The cache is deliberately tiny: at
    // most the active and requested deployment can be useful.
    // @ref LLP 0058#complete-candidate-pair-preflight — one-half provisioning may use only a same-boot, fully preflighted sibling.
    preflighted_artifact_pairs: VecDeque<PreflightedArtifactPair>,
    // ENG-22752: starts false and flips when the first functions manifest
    // loads (provision/ensure). Distinguishes "no app has booted yet" from
    // "the loaded app declares no config" for `config_status` consumers —
    // the empty default manifest is indistinguishable by content alone.
    functions_loaded: bool,
    // @ref LLP 0036#the-store-and-the-target-seam-d1-d2-d7 — the config store
    // is deployment state beside the database, never inside it; `reset()`
    // deliberately does not touch it (D2).
    config: ConfigStore,
    runtime: RuntimeManager,
    ephemeral: LocalEphemeralBackend,
    // Physical mutex ownership is released before committed ephemeral
    // projections run. This clone-shared barrier keeps the logical managed
    // writer closed until those projections finish.
    // @ref LLP 0059#locking-and-linearization — after-Local projection never
    // overlaps a successor managed Local operation.
    managed_local_handoff: Arc<crate::exec_guard::ManagedLocalHandoff>,
    cron: LocalCronRuntime,
    subscriptions: BTreeMap<String, LiveSubscription>,
    // Prepared connection-bound effects live outside the published
    // subscription/obligation indexes. The map retains only weak lifecycle
    // controls; dropping every transport handle therefore makes an abandoned
    // stage collectible even if a caller is cancelled before explicit cleanup.
    pending_local_live_effects: BTreeMap<String, PendingLocalLiveEffectRegistration>,
    permission_epochs: BTreeMap<String, u64>,
    live_delivery: LiveDeliveryStats,
    recent_diagnostics: VecDeque<Diagnostic>,
    cron_tick_errors: u64,
    maintenance: MaintenanceDiagnostics,
    maintenance_permission_reported_at_ms: Option<u64>,
    maintenance_prune_reported_at_ms: Option<u64>,
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L5: idle means
    // idle. `cron_active` lets the 1s ticker skip the global lock entirely when
    // no cron jobs are loaded; the persisted cron state is written only when it
    // changes, so an idle instance performs no periodic disk writes.
    cron_active: Arc<AtomicBool>,
    last_persisted_cron: Option<Value>,
    cron_state_writes: u64,
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L2: last-seen
    // time per connection, so HTTP-polling clients that vanish without calling
    // disconnect can be reaped (their subscriptions and ephemeral state torn
    // down) instead of living forever. Shared (not exclusive to this struct)
    // because after L9 the ephemeral/drain server paths touch liveness without
    // taking the global mutex.
    connections_last_seen: ConnectionActivity,
    reaped_connections: u64,
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6: the
    // read-lane snapshot of the non-DB state a query needs. The write side
    // refreshes these after each relevant commit, while still holding the
    // global mutex, so refreshes are ordered; readers clone the Arcs/maps and
    // never take the global mutex.
    read_manifests: Arc<RwLock<Arc<ReadManifests>>>,
    read_epochs: Arc<RwLock<Arc<BTreeMap<String, u64>>>>,
    // Clone-shared demand projection for transport drains. A connection with
    // no durable auth-scoped query has no invalidation obligation to rerun, so
    // its ephemeral-only HTTP/WS drain must not enter the global writer lane.
    auth_scoped_live_connections: Arc<RwLock<Arc<BTreeSet<String>>>>,
    receipts: ReceiptLog,
    // The RQS resume keyring — a dedicated ring and file beside the database,
    // never the auth keyring (LLP 0091 §0A.1 custody). Surviving restart is
    // what keeps dev-loop restarts from refusing outstanding tokens. Shared
    // with the lock-free read lane, which MACs and verifies relational
    // pagination cursors (LLP 0080 §2) without the global writer mutex.
    resume_keyring: Arc<RwLock<crate::rqs::ResumeKeyring>>,
    // Rung-2 witness caps and the replay-vs-replace threshold (LLP 0090
    // D1.3; server policy knobs with LLP 0091 rung-2 amendment defaults).
    rqs_replay_policy: RqsReplayPolicy,
    // Cached local-arm `generation` digest (LLP 0091 §0A.6): content-derived
    // from the served manifests; recomputed after every manifest/auth-mode
    // change (the invalidation sites set this back to `None`), so a no-op
    // ensure reproduces the identical digest.
    rqs_generation: Option<String>,
    // The served route→query manifest and its canonical hash (LLP 0092
    // §0C.1), installed through ensure beside the functions manifest. The
    // hash is the `routeManifestHash` component of `resumeConfig` in the
    // generation digest; while served, the bundle endpoint resolves entries
    // from it exclusively and refuses the inline `devManifestEntry` form.
    routes: Option<crate::bundle::RoutesManifest>,
    routes_manifest_hash: Option<String>,
    // @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 —
    // per-instance warm VM pool (never process-global: two local app
    // instances must not share loaded code state). Shared with the read lane.
    warm_vms: Arc<crate::warm_vm::WarmVmPool>,
    // @ref LLP 0058#stage-ordering — every finite app-data, cron, nested, and
    // live-rerun entry holds one process-local admission epoch through its
    // final commit/publication boundary.
    admission: AdmissionController,
    // Changes whenever loaded code/schema or the destructive app state
    // boundary changes. Detached nested mutations bind this value at staging
    // and must still match at commit (ENG-24340).
    app_generation: u64,
    app_generation_fence: Arc<AtomicU64>,
    // Dedicated destructive-reset boundary for secret-read leases. Unlike
    // `app_generation`, schema/function reloads do not invalidate leases;
    // only a committed reset advances this fence.
    // @ref LLP 0039#protocol-obligations-deferred-to-implementation — derived
    // secret-read authority is reset-bounded independently of code reloads.
    secret_read_reset_generation: Arc<AtomicU64>,
    /// Installed only after a durable boot reservation and protocol-key
    /// authentication complete. Session-mode auth-scoped live admission is
    /// unavailable while this is absent.
    auth_invalidation: Option<LocalInvalidationState>,
}

struct LocalInvalidationState {
    issuer: LiveInvalidationIssuer,
    obligations: ObligationRegistry,
    version_stream: String,
    next_cause_sequence: u64,
}

impl LocalInvalidationState {
    fn accepts_connection(&self, connection: &AuthorizationInvalidationConnection) -> bool {
        let current = &self.obligations.expectation().authorization;
        connection.protocol_version == crate::auth::invalidation::AUTH_INVALIDATION_PROTOCOL_VERSION
            && connection.issuer_id == self.issuer.authenticated().issuer_id
            && connection.authorization.incarnation == current.incarnation
            && connection.authorization.epoch <= current.epoch
            && connection.version_stream == self.version_stream
    }

    fn reserve_cause_sequence(&mut self) -> SnapbackResult<u64> {
        let current = self.next_cause_sequence;
        self.next_cause_sequence = current
            .checked_add(1)
            .filter(|value| *value <= crate::auth::invalidation::MAX_PROTOCOL_COUNTER)
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_INVALIDATION_CAUSE_EXHAUSTED",
                    "auth",
                    "authorization invalidation cause sequence exhausted",
                )
            })?;
        Ok(current)
    }

    fn witness(&self, min_commit_version: u64) -> CompositeWitness {
        CompositeWitness {
            authorization: self.obligations.expectation().authorization.clone(),
            data: Some(DataWitness {
                version_stream: self.version_stream.clone(),
                min_commit_version,
            }),
        }
    }

    fn prepare_scope_retirement_authenticated(
        &self,
        scope: &ScopeId,
    ) -> SnapbackResult<(Option<ScopeRetirementCandidate>, Option<ScopeRetirement>)> {
        #[cfg(test)]
        if FAIL_NEXT_SCOPE_RETIREMENT_AUTH.with(|fail| fail.replace(false)) {
            return Err(SnapbackError::error(
                "SNAPBACK_TEST_SCOPE_RETIREMENT_AUTH_FAILED",
                "test",
                "injected authenticated scope-retirement failure",
            ));
        }
        let candidate = self.obligations.preview_scope_retirement(scope);
        let retirement = candidate
            .as_ref()
            .map(|candidate| {
                self.issuer.authenticate_scope_retirement(
                    candidate.namespace.clone(),
                    candidate.retire_through_scope_sequence,
                )
            })
            .transpose()?;
        Ok((candidate, retirement))
    }

    fn commit_scope_retirement(
        &mut self,
        scope: &ScopeId,
        expected: &Option<ScopeRetirementCandidate>,
    ) {
        let actual = self.obligations.retire_scope(scope);
        assert_eq!(
            &actual, expected,
            "authenticated scope retirement frontier changed during commit"
        );
    }
}

/// Durable half of a coordinator-owned destructive reset. These process-local
/// generation changes remain unpublished until the authorization stream has
/// finalized its exact successor.
#[derive(Debug)]
pub(crate) struct CoordinatedResetCommit {
    seeded: Option<MutationOutput>,
    app_generation: u64,
    secret_read_generation: u64,
    next_secret_read_generation: u64,
}

#[derive(Clone, Debug)]
struct LiveSubscription {
    id: String,
    connection_id: String,
    function: String,
    authority: RetainedLiveAuthority,
    input: HandlerInput,
    read_dependencies: Vec<CapturedReadDependency>,
    authorization: Option<LiveSubscriptionAuthorization>,
    effect_fence: Option<crate::ephemeral::ConnectionEffectFence>,
    /// RQS token-refresh state, present iff the subscription is `rqsEligible`
    /// (LLP 0090 D1): the server-held digest accumulator plus the query/args
    /// identity every refreshed token binds. Minting is suppressed entirely
    /// when absent — auth-scoped subscriptions never carry it.
    rqs: Option<RqsLiveState>,
}

/// Server-side RQS refresh state for one eligible live subscription.
#[derive(Clone, Debug)]
struct RqsLiveState {
    query_artifact: String,
    args_hash: String,
    digest: crate::rqs::ResultDigest,
}

/// Rung-2 replay policy (LLP 0090 D1.3 / LLP 0091 rung-2 amendment):
/// server-side knobs, defaulted from the amendment's pinned values.
#[derive(Clone, Copy, Debug)]
pub struct RqsReplayPolicy {
    /// Witness entry cap (`SNAPBACK_RESUME_WITNESS_OVERSIZE` above it).
    pub max_witness_entries: usize,
    /// Witness serialized-bytes cap (same refusal code).
    pub max_witness_bytes: usize,
    /// Replay-vs-replace cost heuristic: replay is admitted only while the
    /// journal-affected distinct id count is at most
    /// `max(1, witness_count * percent / 100)`; above that the server
    /// answers rung 3 under `SNAPBACK_RESUME_POLICY_REPLACED`. Default 100:
    /// once more rows were touched than the client ever held, the delta
    /// cannot be smaller than the replacement, so replaying only adds
    /// verification work on top of the same bytes.
    pub replay_affected_percent: u32,
}

impl Default for RqsReplayPolicy {
    fn default() -> Self {
        Self {
            max_witness_entries: crate::rqs::RESUME_WITNESS_MAX_ENTRIES,
            max_witness_bytes: crate::rqs::RESUME_WITNESS_MAX_WIRE_BYTES,
            replay_affected_percent: 100,
        }
    }
}

/// The `rqsEligible` predicate and digest-kind selector — the derived
/// served-manifest fact of LLP 0092 §0C.2 (ENG-25448 landed the cluster-0C
/// derivation, replacing the interim step-1 predicate with the strictly
/// tighter form that also requires the LLP 0053 closed-inputs proof — the
/// complete `singleTable` read summary). See
/// [`crate::manifest::rqs_eligible_digest_kind`].
fn rqs_eligibility(function: &FunctionDefinition) -> Option<crate::rqs::DigestKind> {
    crate::manifest::rqs_eligible_digest_kind(function)
}

fn routes_manifest_error(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_ROUTES_MANIFEST_INVALID", "runtime", message.into())
}

/// Collect the arg names a plan value expression reads (the AST-derived
/// required-arg set for LLP 0092 §0E.6 coverage checking).
fn collect_value_expr_arg_names(value: &ValueExpr, out: &mut BTreeSet<String>) {
    match value {
        ValueExpr::Arg(name) => {
            out.insert(name.clone());
        }
        ValueExpr::Args
        | ValueExpr::AuthUserId
        | ValueExpr::AuthKind
        | ValueExpr::AuthActorKind
        | ValueExpr::AuthIsDelegated
        | ValueExpr::RuntimeId
        | ValueExpr::RuntimeNow
        | ValueExpr::Binding(_)
        | ValueExpr::Literal(_)
        | ValueExpr::MembershipExists(_) => {}
        ValueExpr::Field { base, .. } => collect_value_expr_arg_names(base, out),
        ValueExpr::Binary { left, right, .. } => {
            collect_value_expr_arg_names(left, out);
            collect_value_expr_arg_names(right, out);
        }
        ValueExpr::Unary { expr, .. } => collect_value_expr_arg_names(expr, out),
        ValueExpr::If { cond, then, r#else } => {
            collect_value_expr_arg_names(cond, out);
            collect_value_expr_arg_names(then, out);
            collect_value_expr_arg_names(r#else, out);
        }
        ValueExpr::Concat(values) | ValueExpr::Call { args: values, .. } => {
            for value in values {
                collect_value_expr_arg_names(value, out);
            }
        }
        ValueExpr::Record { fields } => {
            for value in fields.values() {
                collect_value_expr_arg_names(value, out);
            }
        }
    }
}

impl LiveSubscription {
    /// @ref LLP 0058#live-owner-and-replacement-predicate — a retained live
    /// owner is the resolved authority *and* exact connection grant. `None`
    /// remains the explicit unbound dev/test compatibility owner.
    fn is_owned_by(
        &self,
        authority: &PreparedAuthority,
        effect_fence: Option<&crate::ephemeral::ConnectionEffectFence>,
    ) -> bool {
        self.authority.matches(authority) && self.effect_fence.as_ref() == effect_fence
    }
}

#[derive(Clone, Debug)]
struct LiveSubscriptionAuthorization {
    scope_id: ScopeId,
    namespace: QueryNamespace,
    authority_subject: String,
    owner_continuity_id: String,
}

/// Register-mode target for [`LocalSnapback::evaluate_bundle`]: the freshly
/// minted pending-registration connection every bundle subscription binds to
/// (LLP 0031 dated amendment — the one sanctioned socketless-demand owner).
#[derive(Clone, Debug)]
pub(crate) struct BundleRegisterTarget {
    pub(crate) connection_id: String,
    pub(crate) effect_fence: crate::ephemeral::ConnectionEffectFence,
    pub(crate) invalidation_connection: Option<AuthorizationInvalidationConnection>,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct LiveInvalidationAdmission {
    pub(crate) connection: Option<AuthorizationInvalidationConnection>,
    pub(crate) effect_fence: Option<crate::ephemeral::ConnectionEffectFence>,
    #[cfg(test)]
    pub(crate) session_mode: bool,
}

/// Cloneable ownership token for a connection-bound local effect that has
/// reserved its target but has not crossed the exact connection-act cut yet.
/// The transport calls [`Self::try_commit`] while it owns stream/session,
/// registry, and mode admission; that method is one lock-free
/// compare/exchange and never enters SQLite, Hermes, or LocalSnapback.
///
/// Local finalization consumes the prepared plan only after that cut. A
/// terminal connection purge changes the same state to `TERMINAL`, so a purge
/// that wins before finalization cannot be followed by a stale subscription or
/// obligation insertion.
///
/// The expensive local operation intentionally runs only after that cut. This
/// avoids holding auth fences across LocalSnapback while ensuring its query
/// snapshot cannot miss a mutation that committed while the effect was merely
/// pending. Terminal teardown either marks the committed stage before its
/// local claim or waits for the local operation and then purges its effects.
///
/// @ref LLP 0059#locking-and-linearization — connection acts perform one
/// bounded in-memory ownership transfer and never wait on LocalSnapback.
pub(crate) struct StagedLocalLiveEffect<T> {
    stage_id: String,
    control: Arc<LocalLiveStageControl>,
    plan: Arc<T>,
}

impl<T> Clone for StagedLocalLiveEffect<T> {
    fn clone(&self) -> Self {
        Self {
            stage_id: self.stage_id.clone(),
            control: self.control.clone(),
            plan: self.plan.clone(),
        }
    }
}

impl<T> std::fmt::Debug for StagedLocalLiveEffect<T> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("StagedLocalLiveEffect")
            .field("stage_id", &self.stage_id)
            .field("state", &self.control.state.load(Ordering::Acquire))
            .finish_non_exhaustive()
    }
}

impl<T> StagedLocalLiveEffect<T> {
    pub(crate) fn try_commit(
        &self,
        connection_id: &str,
        effect_fence: &crate::ephemeral::ConnectionEffectFence,
    ) -> SnapbackResult<()> {
        if self.control.connection_id != connection_id || &self.control.effect_fence != effect_fence
        {
            return Err(SnapbackError::error(
                "SNAPBACK_LIVE_STAGE_BINDING_MISMATCH",
                "realtime",
                "the staged live effect belongs to a different exact connection grant",
            ));
        }
        match self.control.state.compare_exchange(
            LOCAL_LIVE_STAGE_PENDING,
            LOCAL_LIVE_STAGE_COMMITTED,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_)
            | Err(
                LOCAL_LIVE_STAGE_COMMITTED
                | LOCAL_LIVE_STAGE_FINALIZING
                | LOCAL_LIVE_STAGE_FINALIZED,
            ) => Ok(()),
            Err(LOCAL_LIVE_STAGE_ABANDONED | LOCAL_LIVE_STAGE_TERMINAL) => {
                Err(local_live_stage_unavailable())
            }
            Err(_) => Err(local_live_stage_corrupt()),
        }
    }

    /// Abandon a stage whose exact connection act refused. Staging has not
    /// executed any query, database write, obligation mutation, or fanout.
    pub(crate) fn abandon(&self) -> bool {
        match self.control.state.compare_exchange(
            LOCAL_LIVE_STAGE_PENDING,
            LOCAL_LIVE_STAGE_ABANDONED,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) | Err(LOCAL_LIVE_STAGE_ABANDONED | LOCAL_LIVE_STAGE_TERMINAL) => true,
            Err(
                LOCAL_LIVE_STAGE_COMMITTED
                | LOCAL_LIVE_STAGE_FINALIZING
                | LOCAL_LIVE_STAGE_FINALIZED,
            ) => false,
            Err(_) => false,
        }
    }

    fn plan(&self) -> &T {
        &self.plan
    }
}

#[derive(Debug)]
struct LocalLiveStageControl {
    state: AtomicU8,
    connection_id: String,
    effect_fence: crate::ephemeral::ConnectionEffectFence,
}

struct LocalLiveFinalizationClaim {
    control: Arc<LocalLiveStageControl>,
    completed: bool,
}

impl LocalLiveFinalizationClaim {
    fn complete(mut self) -> SnapbackResult<()> {
        self.control
            .state
            .compare_exchange(
                LOCAL_LIVE_STAGE_FINALIZING,
                LOCAL_LIVE_STAGE_FINALIZED,
                Ordering::Release,
                Ordering::Acquire,
            )
            .map_err(|_| local_live_stage_corrupt())?;
        self.completed = true;
        Ok(())
    }
}

impl Drop for LocalLiveFinalizationClaim {
    fn drop(&mut self) {
        if !self.completed {
            let _ = self.control.state.compare_exchange(
                LOCAL_LIVE_STAGE_FINALIZING,
                LOCAL_LIVE_STAGE_COMMITTED,
                Ordering::Release,
                Ordering::Acquire,
            );
        }
    }
}

#[derive(Debug)]
struct PendingLocalLiveEffectRegistration {
    connection_id: String,
    effect_fence: crate::ephemeral::ConnectionEffectFence,
    reserved_subscription_slots: usize,
    reservation_keys: BTreeSet<String>,
    control: Weak<LocalLiveStageControl>,
}

#[derive(Clone)]
pub(crate) struct PreparedLiveSubscribePlan {
    name: String,
    input: LiveSubscribeInput,
    authority: PreparedAuthority,
    invalidation: LiveInvalidationAdmission,
}

pub(crate) type PreparedLiveSubscribe = StagedLocalLiveEffect<PreparedLiveSubscribePlan>;

#[derive(Clone)]
pub(crate) struct PreparedLiveResumePlan {
    name: String,
    input: LiveResumeInput,
    authority: PreparedAuthority,
    invalidation: LiveInvalidationAdmission,
}

pub(crate) type PreparedLiveResume = StagedLocalLiveEffect<PreparedLiveResumePlan>;

#[derive(Clone)]
pub(crate) struct PreparedLiveUnsubscribePlan {
    name: String,
    input: LiveUnsubscribeInput,
    authority: PreparedAuthority,
    effect_fence: crate::ephemeral::ConnectionEffectFence,
}

pub(crate) type PreparedLiveUnsubscribe = StagedLocalLiveEffect<PreparedLiveUnsubscribePlan>;

#[derive(Clone)]
pub(crate) struct PreparedAuthorizationInvalidationAckPlan {
    input: AuthorizationInvalidationAckInput,
    connection: AuthorizationInvalidationConnection,
    admission: AdmissionLease,
}

pub(crate) type PreparedAuthorizationInvalidationAck =
    StagedLocalLiveEffect<PreparedAuthorizationInvalidationAckPlan>;

#[derive(Clone)]
pub(crate) struct PreparedAuthorizationInvalidationManualRetryPlan {
    input: AuthorizationInvalidationManualRetryInput,
    connection: AuthorizationInvalidationConnection,
    authority: PreparedAuthority,
    effect_fence: crate::ephemeral::ConnectionEffectFence,
}

pub(crate) type PreparedAuthorizationInvalidationManualRetry =
    StagedLocalLiveEffect<PreparedAuthorizationInvalidationManualRetryPlan>;

fn local_live_stage_unavailable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_LIVE_STAGE_UNAVAILABLE",
        "realtime",
        "the staged live effect lost its exact connection before publication",
    )
}

fn local_live_stage_corrupt() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_LIVE_STAGE_CORRUPT",
        "realtime",
        "the staged live effect entered an invalid lifecycle state",
    )
}

pub(crate) struct QueryInvocation {
    pub(crate) output: QueryOutput,
    pub(crate) read_dependencies: Vec<CapturedReadDependency>,
}

/// First phase of an authorized retained snapshot. It crosses the app-lock
/// release needed to preserve provider-before-app lock ordering, but remains
/// bound to the original admission epoch and complete unsigned lease issue.
pub(crate) struct AuthorizedLeaseCapture {
    pub(crate) output: QueryOutput,
    pub(crate) issue: AuthorizedLeaseIssue,
    pub(crate) target_profile_id: String,
    pub(crate) app_id: String,
    admission: AdmissionLease,
}

struct AuthorizationResolutionFailure {
    error: SnapbackError,
    retry_episode_id: Option<String>,
}

/// Outcome of the DK-3 op-log delta fast path for one subscription.
enum DeltaFanout {
    /// A `live_delta` was enqueued and the subscription's membership updated.
    Delivered,
    /// The commit did not change this subscription's result — nothing to send.
    NoChange,
    /// The delta could not be serialized (reported as a fan-out failure).
    Failed(SnapbackError),
}

struct LocalIbexActionHost<'a> {
    // SAFETY invariant for the raw action host bridge:
    // - constructed only inside `LocalSnapback::invoke_action` from `&'a mut self`;
    // - never sent to another thread and used only by synchronous Ibex host calls
    //   during that one action invocation;
    // - every trait operation derives from this same provenance root only for
    //   the duration of its synchronous call.
    //
    // The S5.D1 nested-action test exercises the important behavioral edge:
    // a JS action can call back into an Ibex mutation and then make a second host
    // call after the nested invocation returns without losing or aliasing context.
    snapback: *mut LocalSnapback,
    authority: PreparedAuthority,
    _marker: PhantomData<&'a mut LocalSnapback>,
}

impl IbexActionHost for LocalIbexActionHost<'_> {
    fn validate_host_call(&mut self, _op: &str) -> SnapbackResult<()> {
        // In-process action invocation retains the instance borrow for the
        // whole run, so no schema/function/reset drift can interleave.
        self.authority
            .validate_admission("action host call or nested entry")
    }

    fn run_mutation(&mut self, name: &str, input: HandlerInput) -> SnapbackResult<MutationOutput> {
        // @ref LLP 0028#execution-the-action-class — actions commit durable
        // writes by invoking ordinary mutations, preserving the commit/fan-out path.
        // @ref LLP 0058#complete-gate-coverage — nested mutations inherit the
        // already-resolved outer authority and apply the target requirement.
        // The embedded runtime calls host functions synchronously on the same
        // thread; this pointer is valid only for the duration of one action run.
        let authority = self
            .authority
            .inherit_for(InvocationSource::NestedMutation)?;
        unsafe { (&mut *self.snapback).invoke_mutation_with_authority(name, input, authority) }
    }
}

fn managed_action_generation_conflict(staged: u64, current: u64) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ACTION_GENERATION_CONFLICT",
        "runtime",
        "app code, schema, or state reset changed while the action was running",
    )
    .with_details(json!({
        "stagedAppGeneration": staged,
        "currentAppGeneration": current,
    }))
}

impl ManagedHostPlanAction {
    pub(crate) fn validate_generation(&self) -> SnapbackResult<()> {
        let current = self.app_generation_fence.load(Ordering::SeqCst);
        if current != self.app_generation {
            return Err(managed_action_generation_conflict(
                self.app_generation,
                current,
            ));
        }
        Ok(())
    }

    pub(crate) fn finish(&self, result: SnapbackResult<Value>) -> SnapbackResult<Value> {
        let result = result
            .and_then(|value| self.validate_generation().map(|()| value))
            .map_err(|error| self.redactor.redact_error(error));
        #[cfg(test)]
        BEFORE_ACTION_RESULT_HANDOFF_HOOK.with(|slot| {
            if let Some(hook) = slot.borrow_mut().take() {
                hook();
            }
        });
        let _publication = self.invocation.effect_guard("action result handoff")?;
        result
    }
}

impl LocalSnapback {
    pub fn memory() -> SnapbackResult<Self> {
        Self::from_database(LocalDatabase::memory()?)
    }

    pub fn open(path: impl AsRef<Path>) -> SnapbackResult<Self> {
        let config = ConfigStore::open_for_database(path.as_ref())?;
        let mut snapback = Self::from_database(LocalDatabase::open(path)?)?;
        snapback.config = config;
        Ok(snapback)
    }

    /// Internal provider/lifecycle lane for protected auth transactions.
    /// Callers must acquire the auth-maintenance/address coordination guards
    /// before taking the outer app-instance lock that lends this database.
    /// The returned storage type exposes only exact-catalog auth operations;
    /// it does not expose a raw SQLite connection to the server layer.
    // @ref LLP 0057#catalog-write-and-lifecycle-rules — auth state bypasses app journals, receipts, versions, and live delivery.
    // @ref LLP 0057#concurrency-locks-and-linearization — provider coordination precedes the outer app/database lock.
    pub(crate) fn auth_database_mut(&mut self) -> &mut LocalDatabase {
        &mut self.db
    }

    /// Revalidate the exact finite service carrier while the caller owns the
    /// app lock. Terminal auth writers use that same outer lock and premark
    /// the process fence before commit, so a successful check linearizes every
    /// subsequent synchronous app effect in this lock hold before termination.
    pub(crate) fn validate_prepared_service_authority(
        &self,
        authority: &PreparedAuthority,
    ) -> SnapbackResult<()> {
        let ResolvedAppAuthority::ServicePrincipal {
            actor_user_id,
            effective_user_id,
            grant_id,
            token_id,
            credential_id,
            credential_generation,
            token_expires_at_ms,
            ..
        } = authority.resolved()
        else {
            return Ok(());
        };
        let (now_ms, monotonic_now) = authority.service_clock_sample(now_millis(), Instant::now());
        let witness = match authority.resolve_service_authority_act(now_ms, monotonic_now)? {
            Some(ServiceAuthorityActResolution::Current(witness)) => witness,
            Some(ServiceAuthorityActResolution::Terminal(disposition)) => {
                let wire = match disposition {
                    ServiceAuthorityDisposition::Carrier => "carrier",
                    ServiceAuthorityDisposition::DurableDelete => "durableDelete",
                };
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
                    "auth",
                    "scoped agent token authority is no longer current",
                )
                .with_details(json!({ "authorityDisposition": wire })));
            }
            Some(ServiceAuthorityActResolution::Unavailable) => {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                    "auth",
                    "finite service authority termination is unresolved",
                ));
            }
            None => {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                    "auth",
                    "finite service authority has no exact process fence",
                ));
            }
        };
        if witness.actor_user_id() != actor_user_id
            || witness.effective_user_id() != effective_user_id.as_deref()
            || witness.grant_id() != grant_id
            || witness.token_id() != token_id
            || witness.credential_id() != credential_id
            || witness.credential_generation() != *credential_generation
            || witness.expires_at_ms() != *token_expires_at_ms
        {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "finite service authority disagrees with its exact process fence",
            ));
        }
        if !self.db.retained_service_authority_is_live_readonly(
            crate::storage::auth_agent_credentials::RetainedServiceAuthority {
                actor_user_id,
                credential_id,
                credential_generation: *credential_generation,
                grant_id,
                token_id,
                effective_user_id: effective_user_id.as_deref(),
            },
            now_ms,
        )? {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
                "auth",
                "scoped agent token authority is no longer current",
            )
            .with_details(json!({ "authorityDisposition": "carrier" })));
        }
        Ok(())
    }

    pub(crate) fn persist_and_validate_prepared_service_authority(
        &mut self,
        authority: &PreparedAuthority,
    ) -> SnapbackResult<()> {
        self.persist_service_deadline_if_due(authority)?;
        self.validate_prepared_service_authority(authority)
    }

    pub(crate) fn persist_service_deadline_if_due(
        &mut self,
        authority: &PreparedAuthority,
    ) -> SnapbackResult<()> {
        let (now_ms, monotonic_now) = authority.service_clock_sample(now_millis(), Instant::now());
        if let Some(deadline) =
            authority.expired_service_deadline_terminal(now_ms, monotonic_now)?
        {
            // A managed server caller cannot terminalize while it owns Local:
            // the exact async gate must close/drain every affected token before
            // the write, and the independently owned server task must retain the
            // complete token set through lifecycle propagation. Fail this act
            // closed; the registered HTTP middleware or live observer performs
            // that owned terminal transaction after Local is released. Direct
            // embedders have no retained server lifecycle graph and preserve the
            // synchronous persistence seam below.
            //
            // @ref LLP 0059#finite-service-authority-fence — process premark,
            // drain, durable write, and propagation are one owned choreography.
            if crate::exec_guard::local_write_scope_active() {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                    "auth",
                    "finite service authority expiry requires the owned terminal path",
                ));
            }
            self.db.terminalize_expired_service_authority(&deadline)?;
        }
        Ok(())
    }

    /// Host-owned StreamAttemptV1 persistence (LLP 0076): the detached action
    /// host performs these short writes under the instance lock. The durable
    /// row — not the in-process registry — is what the startup reconciler
    /// reads after a crash, so the pre-mark must commit before the upstream
    /// send.
    pub(crate) fn stream_attempt_record(
        &self,
        client_key: &str,
    ) -> SnapbackResult<Option<(String, String)>> {
        self.db.stream_attempt_by_client_key(client_key)
    }

    pub(crate) fn stream_attempt_namespace(&self) -> usize {
        self.stream_attempt_namespace
    }

    /// Resolve every declared capability requirement against the served
    /// instance manifest (LLP 0076 §Target contract): the same
    /// instance-live declaration `/inspect` reports, never a static
    /// committed artifact. Unknown (non-registry) strings are left to the
    /// v1 grammar validation; a registry id the live instance does not
    /// support is a fatal admission error.
    fn validate_required_capabilities_against_instance(
        &self,
        manifest: &FunctionManifest,
    ) -> Vec<Diagnostic> {
        let served = crate::manifest::CapabilityManifest::local_v0_instance(
            self.capability_gaps(),
            crate::runtime::outbound_actions_enabled(),
        );
        // @ref LLP 0058#capability-maturity — an experimental entry is not
        // plain support: the requirement admits only when the artifact
        // acknowledges the experimental contract it binds to.
        let acknowledged = manifest.acknowledged_capability_ids();
        let mut diagnostics = Vec::new();
        let mut check = |owner: &str, capability: &str| {
            let Ok(id) = capability.parse::<crate::manifest::TargetCapabilityId>() else {
                return;
            };
            if !served.supported_capabilities.contains(&id) {
                diagnostics.push(Diagnostic::error(
                    "SNAPBACK_CAPABILITY_UNSUPPORTED",
                    "runtime",
                    format!(
                        "{owner} requires capability {capability}, which the served instance manifest does not support"
                    ),
                ));
            } else if id.maturity() != crate::manifest::CapabilityMaturity::Stable
                && !acknowledged.contains(&id)
            {
                diagnostics.push(Diagnostic::error(
                    "SNAPBACK_CAPABILITY_UNSUPPORTED",
                    "runtime",
                    format!(
                        "{owner} requires capability {capability}, which this target supports only at {} maturity; the artifact must list it in acknowledgedExperimentalCapabilities",
                        id.maturity().as_str()
                    ),
                ));
            }
        };
        for function in &manifest.functions {
            for capability in &function.required_capabilities {
                check(&format!("function {}", function.name), capability);
            }
        }
        for job in &manifest.cron_jobs {
            for capability in &job.required_capabilities {
                check(&format!("cron job {}", job.name), capability);
            }
        }
        diagnostics
    }

    pub(crate) fn persist_stream_attempts(
        &mut self,
        rows: &[(String, String, String)],
    ) -> SnapbackResult<()> {
        self.db.upsert_stream_attempts(rows, now_millis())
    }

    /// Revalidate the durable and carrier axes before every retained live
    /// computation. Session authority is fenced by the projection; service
    /// authority is checked directly against the protected catalog without
    /// recovering or retaining its bearer.
    // @ref LLP 0055#ending-authority-revocation-expiry-deactivation — retained service authority and immutable scope shapes end as host-trusted terminal deletes.
    fn prepare_live_rerun_authority(
        &mut self,
        retained: &RetainedLiveAuthority,
        admission: AdmissionLease,
    ) -> SnapbackResult<PreparedAuthority> {
        if let ResolvedAppAuthority::ServicePrincipal {
            actor_user_id,
            credential_id,
            credential_generation,
            grant_id,
            token_id,
            effective_user_id,
            ..
        } = retained.resolved()
        {
            if !self.db.retained_service_authority_is_live(
                crate::storage::auth_agent_credentials::RetainedServiceAuthority {
                    actor_user_id,
                    credential_id,
                    credential_generation: *credential_generation,
                    grant_id,
                    token_id,
                    effective_user_id: effective_user_id.as_deref(),
                },
                now_millis(),
            )? {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
                    "auth",
                    "the retained service-principal authority is no longer current",
                )
                .into_trusted_permission_denial());
            }
            let scope = retained.matched_grant_scope().ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_GRANT_SCOPE_DENIED",
                    "auth",
                    "the retained live owner has no exact function scope",
                )
                .with_details(json!({ "reason": "missing_retained_entry" }))
                .into_trusted_permission_denial()
            })?;
            let current = self.db.current_auth_scope_basis(
                scope.function_id(),
                scope.kind(),
                scope.authority_creating(),
            )?;
            if current != Some(scope.basis()) {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_GRANT_SCOPE_DENIED",
                    "auth",
                    "the retained grant scope is terminally invalid",
                )
                .with_details(json!({ "reason": "terminally_invalid_entry" }))
                .into_trusted_permission_denial());
            }
        }
        let prepared = retained.prepare_rerun(admission)?;
        self.persist_and_validate_prepared_service_authority(&prepared)?;
        Ok(prepared)
    }

    /// Cloneable process-local admission authority for HTTP composition.
    // Retained as the direct LocalSnapback embedding seam; the production
    // router currently obtains the same controller from its ReadLane.
    #[allow(dead_code)]
    pub(crate) fn admission_controller(&self) -> AdmissionController {
        self.admission.clone()
    }

    /// Compatibility embedding seam: legacy callers may request dev
    /// authority only through this instance's exact-mode controller. A
    /// settled Sessions instance rejects the request before app code runs.
    pub(crate) fn prepare_legacy_dev_authority(
        &self,
        source: InvocationSource,
        profile: ServerProfile,
        input: &HandlerInput,
    ) -> SnapbackResult<PreparedAuthority> {
        InvocationGate::prepare_admitted_dev_input(
            source,
            profile,
            input,
            self.admission.admit_dev()?,
        )
    }

    /// Close app-data/cron/live/nested admission and wait for the finite
    /// current epoch before a staged-mode transaction takes the write lane.
    // Retained for embedders that stage directly against LocalSnapback; the
    // shipped router begins transitions through its cloned controller.
    #[allow(dead_code)]
    pub(crate) fn begin_auth_mode_transition(&self) -> SnapbackResult<ModeTransitionGuard> {
        self.admission.begin_transition()
    }

    /// Pre-bind only: align process admission with the final durable record
    /// after startup composition may have staged, consumed, or unstaged it.
    #[cfg(test)]
    pub(crate) fn synchronize_auth_mode_admission(
        &self,
        state: &crate::auth::mode::AuthModeStateRecord,
    ) -> SnapbackResult<crate::auth::admission::AdmissionSnapshot> {
        self.admission.synchronize_mode_state(state)
    }

    /// Validate one complete cold-start/provisioning pair without changing
    /// schema, functions, cron, config, or auth-mode state. The returned
    /// identity is safe to pin durably only because every artifact-owned and
    /// target-owned predicate has already run against these exact values.
    // @ref LLP 0058#complete-candidate-pair-preflight — hashes are evidence only after the complete pair and target capability registry validate.
    pub(crate) fn preflight_auth_artifacts(
        &mut self,
        artifacts: &StartupArtifacts,
        requested_mode: AuthMode,
    ) -> SnapbackResult<DeploymentIdentity> {
        artifacts.schema.validate_artifact()?;
        artifacts.functions.validate_artifact()?;
        validate_collection_definitions(&artifacts.schema.ephemeral_collections)
            .map_err(ephemeral_manifest_error)?;
        validate_collection_permission_backing(
            &artifacts.schema.ephemeral_collections,
            &artifacts.schema.tables,
            requested_mode == AuthMode::Sessions,
        )
        .map_err(ephemeral_manifest_error)?;

        let deployment = artifacts.deployment_identity(requested_mode)?;
        let target = CapabilityManifest::local_v0_declared();
        // @ref LLP 0058#capability-maturity — the artifact pair's
        // experimental acknowledgments (declared on the function manifest,
        // covering the pair) accompany every requirement, including the
        // schema-level ones: schema and functions are one generated unit.
        let acknowledged = artifacts.functions.acknowledged_capability_ids();
        target.require_capabilities(
            artifacts
                .schema
                .required_capabilities
                .iter()
                .map(String::as_str)
                .chain(
                    artifacts.functions.functions.iter().flat_map(|function| {
                        function.required_capabilities.iter().map(String::as_str)
                    }),
                )
                .chain(
                    artifacts
                        .functions
                        .cron_jobs
                        .iter()
                        .flat_map(|job| job.required_capabilities.iter().map(String::as_str)),
                ),
            &acknowledged,
        )?;
        validate_function_schema_references(&artifacts.functions, &artifacts.schema)?;
        let cron_diagnostics = validate_cron_manifest(&artifacts.functions);
        if let Some(diagnostic) = cron_diagnostics.iter().find(|diagnostic| {
            matches!(
                diagnostic.severity,
                DiagnosticSeverity::Error | DiagnosticSeverity::Fatal
            )
        }) {
            return Err(SnapbackError::new(diagnostic.clone()));
        }
        if requested_mode == AuthMode::Sessions {
            // This read-only shape check catches exact-object and dormant
            // namespace collisions before staging can make the app pending.
            self.db.inspect_auth_catalog()?;
        }
        for function in &artifacts.functions.functions {
            if let FunctionRuntime::IbexModule(module) = &function.runtime {
                crate::runtime::prepare_ibex_module(module, &function.kind)?;
            }
        }
        self.remember_preflighted_pair(
            deployment.clone(),
            artifacts.schema.clone(),
            artifacts.functions.clone(),
        );
        Ok(deployment)
    }

    fn remember_preflighted_pair(
        &mut self,
        deployment: DeploymentIdentity,
        schema: SchemaManifest,
        functions: FunctionManifest,
    ) {
        self.preflighted_artifact_pairs
            .retain(|pair| pair.deployment != deployment);
        self.preflighted_artifact_pairs
            .push_back(PreflightedArtifactPair {
                deployment,
                schema,
                prepared_functions: PreparedFunctionGeneration {
                    manifest: functions,
                },
            });
        while self.preflighted_artifact_pairs.len() > 2 {
            self.preflighted_artifact_pairs.pop_front();
        }
    }

    pub(crate) fn install_auth_invalidation(
        &mut self,
        issuer: LiveInvalidationIssuer,
        authorization: crate::storage::AuthorizationVersion,
        version_stream: String,
    ) -> SnapbackResult<()> {
        issuer.install_authorization_expectation(authorization.clone())?;
        issuer.install_version_stream(version_stream.clone())?;
        let obligations = ObligationRegistry::new(ObligationExpectation {
            authorization,
            version_stream: Some(version_stream.clone()),
            issuer_id: Some(issuer.authenticated().issuer_id.clone()),
        })?;
        self.auth_invalidation = Some(LocalInvalidationState {
            issuer: issuer.clone(),
            obligations,
            version_stream,
            next_cause_sequence: 1,
        });
        let ephemeral = self.ephemeral.clone();
        crate::exec_guard::run_or_defer_after_local(move || {
            ephemeral.install_authorization_issuer(issuer);
        });
        self.db
            .install_authorization_interlock(Arc::new(self.ephemeral.clone()));
        Ok(())
    }

    /// Remove every process-local issuer projection after a durable reset
    /// whose successor cannot be reconstructed exactly. The coordinator stays
    /// globally closed; clearing both query and room leaves no lower-level
    /// embedding path holding a usable issuer for either incarnation.
    pub(crate) fn clear_auth_invalidation_after_failed_reset(&mut self) {
        self.auth_invalidation = None;
        let ephemeral = self.ephemeral.clone();
        crate::exec_guard::run_or_defer_after_local(move || {
            ephemeral.clear_authorization_issuer();
        });
    }

    /// Compatibility orchestration for synchronous embedders that own a
    /// `LocalSnapback` directly instead of entering through the managed server
    /// write lane. The room dependency is installed and quiesced before the
    /// logical Local scope begins; SQLite may only bind that already-prepared
    /// carrier. Committed issuer/notifier/room effects are then drained after
    /// the scope ends, even when the transaction body unwinds.
    ///
    /// Managed callers already own a `LocalSnapbackWriteScope` and must have
    /// installed their exact carrier before taking Local. In that case this
    /// helper deliberately does no fallback work: in-lock action/nested seams
    /// must be routed through their own staged protocol, never hidden behind a
    /// second reservation.
    ///
    /// @ref LLP 0059#locking-and-linearization — direct and managed writes use
    /// the same off-Local reservation and after-Local publication boundary.
    fn try_with_direct_authorization_write<R>(
        &mut self,
        preflight: crate::storage::AuthorizationCommitPreflight,
        work: impl FnOnce(&mut Self) -> R,
    ) -> SnapbackResult<R> {
        if crate::exec_guard::local_write_scope_active() {
            return Ok(work(self));
        }

        let cancellation =
            Arc::new(crate::storage::AuthorizationReservationCancellation::default());
        let reservation = self
            .ephemeral
            .reserve_authorization_commit(preflight, cancellation)?;
        crate::storage::install_managed_authorization_reservation(reservation);

        let mut local_scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| work(self)));
        let unused = crate::storage::take_managed_authorization_reservation();
        let after_local = local_scope.take_after_local_batch();
        drop(local_scope);

        if let Some(unused) = unused {
            unused.cancel();
        }
        crate::exec_guard::run_after_local_batch(after_local);

        match outcome {
            Ok(output) => Ok(output),
            Err(panic) => std::panic::resume_unwind(panic),
        }
    }

    pub fn apply_schema(&mut self, manifest: SchemaManifest) -> SnapbackResult<Vec<Diagnostic>> {
        manifest.validate_artifact()?;
        validate_collection_definitions(&manifest.ephemeral_collections)
            .map_err(ephemeral_manifest_error)?;
        validate_collection_permission_backing(
            &manifest.ephemeral_collections,
            &manifest.tables,
            manifest.effective_auth_mode() == AuthMode::Sessions,
        )
        .map_err(ephemeral_manifest_error)?;
        self.try_with_direct_authorization_write(
            crate::storage::AuthorizationCommitPreflight::AllProtectedRooms,
            move |snapback| {
                let ephemeral_collections = manifest.ephemeral_collections.clone();
                let generation = next_app_generation()?;
                let mut diagnostics = snapback.db.apply_schema(manifest)?;
                let ephemeral = snapback.ephemeral.clone();
                crate::exec_guard::run_or_defer_after_local(move || {
                    ephemeral
                        .replace_collections(ephemeral_collections)
                        .expect("prevalidated ephemeral definitions publish infallibly");
                });
                snapback.install_app_generation(generation);
                snapback.refresh_read_manifests();
                // Schema-driven route-param typing depends on the schema
                // (LLP 0092 §0E.6): a served route manifest that no longer
                // validates against the new schema drops fail-closed.
                if let Some(routes) = snapback.routes.clone()
                    && let Err(error) = snapback.validate_routes_manifest(&routes)
                {
                    snapback.routes = None;
                    snapback.routes_manifest_hash = None;
                    diagnostics.push(Diagnostic::warning(
                        "SNAPBACK_ROUTES_MANIFEST_INVALID",
                        "runtime",
                        format!(
                            "served route manifest dropped: it no longer validates against the new schema ({})",
                            error.diagnostic.message
                        ),
                    ));
                }
                snapback.record_diagnostics(diagnostics.clone());
                Ok(diagnostics)
            },
        )?
    }

    pub fn load_functions(&mut self, manifest: FunctionManifest) -> Vec<Diagnostic> {
        if let Err(error) = manifest.validate_artifact() {
            let diagnostic = error.diagnostic;
            self.record_diagnostics(vec![diagnostic.clone()]);
            return vec![diagnostic];
        }

        let mut preflight = Vec::new();
        if let Err(error) = validate_function_schema_references(&manifest, self.db.schema()) {
            preflight.push(error.diagnostic);
        }
        // @ref LLP 0076#target-contract — capability admission resolves
        // against the SAME served instance manifest `/inspect` reports for
        // this exact process, before any handler or nested-mutation code can
        // run. Every local loader path (raw dev, provisioning, embedding)
        // funnels through here, so a stream-requiring artifact cannot be
        // installed on an egress-disabled instance.
        preflight.extend(self.validate_required_capabilities_against_instance(&manifest));
        preflight.extend(validate_cron_manifest(&manifest));
        if preflight
            .iter()
            .any(|diagnostic| diagnostic.severity == DiagnosticSeverity::Error)
        {
            self.record_diagnostics(preflight.clone());
            return preflight;
        }

        let generation = match next_app_generation() {
            Ok(generation) => generation,
            Err(error) => {
                let diagnostic = error.diagnostic;
                self.record_diagnostics(vec![diagnostic.clone()]);
                return vec![diagnostic];
            }
        };

        self.functions = manifest;
        self.functions_loaded = true;
        self.install_app_generation(generation);
        // New code means new warm-VM setup state; content keying already
        // prevents stale reuse, clearing also frees the old VMs' memory.
        self.warm_vms.clear();
        let mut diagnostics = preflight;
        // A served route manifest that no longer validates against the new
        // functions manifest is dropped fail-closed (LLP 0092 §0C.1): stale
        // entries must not keep resolving; Channel A degrades to the shell
        // and bundles answer ROUTE_UNKNOWN until a coherent manifest is
        // ensured again.
        if let Some(routes) = self.routes.clone()
            && let Err(error) = self.validate_routes_manifest(&routes)
        {
            self.routes = None;
            self.routes_manifest_hash = None;
            diagnostics.push(Diagnostic::warning(
                "SNAPBACK_ROUTES_MANIFEST_INVALID",
                "runtime",
                format!(
                    "served route manifest dropped: it no longer validates against the new functions manifest ({})",
                    error.diagnostic.message
                ),
            ));
        }

        if self
            .functions
            .functions
            .iter()
            .any(|function| matches!(function.runtime, FunctionRuntime::IbexModule(_)))
        {
            diagnostics.push(Diagnostic::info(
                "SNAPBACK_IBEX_FUNCTIONS_LOADED",
                "runtime",
                "Ibex handler modules loaded for embedded ctx.db execution",
            ));
        }

        diagnostics.extend(self.cron.reconcile(&self.functions));
        diagnostics.extend(self.reconcile_config());
        diagnostics.extend(self.runtime.diagnostics());
        self.refresh_read_manifests();
        self.refresh_cron_active();
        if let Err(error) = self.persist_cron_state() {
            diagnostics.push(error.diagnostic);
        }
        self.record_diagnostics(diagnostics.clone());
        diagnostics
    }

    /// Legacy raw function publication is a dev-only embedding seam. Every
    /// sessions deployment must enter through complete-pair provisioning and
    /// own the activation transition; pending/quarantined state cannot use a
    /// raw swap as a recovery side door.
    pub(crate) fn load_functions_in_settled_dev(
        &mut self,
        manifest: FunctionManifest,
    ) -> SnapbackResult<Vec<Diagnostic>> {
        // A raw loader has no sibling artifact with which to prove a complete
        // deployment pair. It is therefore only the legacy v0-dev seam; a v1
        // function half must go through complete-pair provisioning.
        // @ref LLP 0058#the-two-admissible-tuples — v1-dev is never an
        // admissible tuple, including when activeDeployment is still null.
        if manifest.schema_version != crate::manifest::SNAPBACK_SCHEMA_VERSION {
            return Err(SnapbackError::error(
                "SNAPBACK_CAPABILITY_UNSUPPORTED",
                "auth",
                "raw dev function loading accepts only snapback.v0 artifacts",
            )
            .with_details(serde_json::json!({
                "authMode": "dev",
                "schemaVersion": manifest.schema_version,
                "expectedSchemaVersion": crate::manifest::SNAPBACK_SCHEMA_VERSION,
            })));
        }
        let admission = self.admission.admit_dev()?;
        let state = self.db.auth_mode_snapshot()?.state;
        if state.active != state.desired
            || state.mode_state != crate::auth::mode::AuthModeStatus::Settled
            || state.app_data_availability != crate::auth::mode::AppDataAvailability::Available
        {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_MODE_PENDING",
                "auth",
                "raw functions.load is unavailable while auth mode is not settled and available",
            ));
        }
        if state.active != AuthMode::Dev {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "sessions functions.load requires complete-pair activation coordination",
            ));
        }
        let _publication = admission.effect_guard("raw dev function publication")?;
        Ok(self.load_functions(manifest))
    }

    /// Publish a function generation and its committed schema's collection
    /// projection after both passed
    /// [`Self::preflight_auth_artifacts`] against the schema now committed by
    /// a startup, staged-mode, or same-mode network transaction. Artifact
    /// validation is complete before this call; managed server work defers the
    /// ephemeral lifecycle projection until Local is released while retaining
    /// the logical writer/admission barrier through completion. Secondary
    /// cron/config persistence failures remain ordinary diagnostics after the
    /// generation is live.
    // @ref LLP 0058#same-mode-provisioning — network same-mode activation keeps admission closed through collection and function publication.
    // @ref LLP 0058#consume-ordering-dev-to-sessions — the prepared generation publishes only after the durable consume cut.
    pub(crate) fn publish_preflighted_functions(
        &mut self,
        manifest: FunctionManifest,
        generation: u64,
    ) -> Vec<Diagnostic> {
        debug_assert!(manifest.validate_artifact().is_ok());
        debug_assert!(validate_function_schema_references(&manifest, self.db.schema()).is_ok());
        debug_assert!(!validate_cron_manifest(&manifest).iter().any(|diagnostic| {
            matches!(
                diagnostic.severity,
                DiagnosticSeverity::Error | DiagnosticSeverity::Fatal
            )
        }));

        let ephemeral = self.ephemeral.clone();
        let ephemeral_collections = self.db.schema().ephemeral_collections.clone();
        crate::exec_guard::run_or_defer_after_local(move || {
            ephemeral
                .replace_collections(ephemeral_collections)
                .expect("preflighted ephemeral definitions publish infallibly");
        });

        self.functions = manifest;
        self.functions_loaded = true;
        self.install_app_generation(generation);
        self.warm_vms.clear();
        let mut diagnostics = Vec::new();
        if self
            .functions
            .functions
            .iter()
            .any(|function| matches!(function.runtime, FunctionRuntime::IbexModule(_)))
        {
            diagnostics.push(Diagnostic::info(
                "SNAPBACK_IBEX_FUNCTIONS_LOADED",
                "runtime",
                "Ibex handler modules loaded for embedded ctx.db execution",
            ));
        }
        diagnostics.extend(self.cron.reconcile(&self.functions));
        diagnostics.extend(self.reconcile_config());
        diagnostics.extend(self.runtime.diagnostics());
        self.refresh_read_manifests();
        self.refresh_cron_active();
        if let Err(error) = self.persist_cron_state() {
            diagnostics.push(error.diagnostic);
        }
        self.record_diagnostics(diagnostics.clone());
        diagnostics
    }

    /// Reserve the non-reusable process generation before a durable mode cut.
    /// A failed transaction may waste a generation, but no committed cut can
    /// reach the otherwise-infallible publication step and discover wrap.
    pub(crate) fn reserve_function_publication_generation(&self) -> SnapbackResult<u64> {
        next_app_generation()
    }

    /// Retain serve-time diagnostics in the same bounded ring as runtime
    /// diagnostics. The caller supplies already-redacted closed facts; this
    /// seam deliberately accepts no path or keyring error carrier.
    pub(crate) fn record_startup_diagnostics(&mut self, diagnostics: &[Diagnostic]) {
        self.record_diagnostics(diagnostics.to_vec());
    }

    pub fn reset(&mut self) -> SnapbackResult<()> {
        self.reset_with_seed(None).map(|_| ())
    }

    /// Atomically reset durable app data and optionally install a seed, then
    /// advance the in-memory lifecycle boundary only after SQLite commits.
    /// A rejected seed therefore preserves both the old database and every
    /// subscription/runtime generation that describes it.
    pub fn reset_with_seed(
        &mut self,
        seed: Option<SeedData>,
    ) -> SnapbackResult<Option<MutationOutput>> {
        if crate::exec_guard::local_write_scope_active() {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                "auth",
                "direct reset cannot prepare its authorization stream while a managed Local writer is active",
            ));
        }

        // A direct embedder has no server-owned projection coordinator. Build
        // its minimal stream-only coordinator and premark it before entering
        // the direct Local/SQLite scope; finalization likewise happens only
        // after that scope and every committed after-Local effect have ended.
        let incarnation = self.db.ensure_authorization_stream_incarnation()?;
        let source = crate::auth::session_projection::ProjectionSource {
            authorization_stream_value:
                crate::auth::session_projection::AuthorizationStreamRecord::new(incarnation)
                    .encode_bytes()?,
            restore_declaration_id: None,
            users: Vec::new(),
            identities: Vec::new(),
            sessions: Vec::new(),
            superseded_tokens: Vec::new(),
        };
        let projection =
            crate::auth::session_projection::SessionProjection::rebuild_with_fresh_startup_id(
                source,
                now_millis(),
                Instant::now(),
            )?;
        let coordinator = Arc::new(crate::auth::coordinator::AuthCoordinator::new(projection)?);
        let carrier = coordinator.premark_stream_reset_if_drained()?;
        let predecessor = carrier.predecessor().clone();
        let successor = carrier.successor().clone();

        let attempt = self.try_with_direct_authorization_write(
            crate::storage::AuthorizationCommitPreflight::AllProtectedRooms,
            move |snapback| match snapback.attempt_reset_with_seed_and_authorization_stream(
                seed,
                &predecessor,
                &successor,
            ) {
                crate::storage::auth::AuthTransactionAttempt::Committed(committed) => {
                    crate::storage::auth::AuthTransactionAttempt::Committed(
                        snapback.publish_coordinated_reset(committed),
                    )
                }
                crate::storage::auth::AuthTransactionAttempt::RolledBack(error) => {
                    crate::storage::auth::AuthTransactionAttempt::RolledBack(error)
                }
                crate::storage::auth::AuthTransactionAttempt::CommitUncertain(error) => {
                    crate::storage::auth::AuthTransactionAttempt::CommitUncertain(error)
                }
            },
        );
        let attempt = match attempt {
            Ok(attempt) => attempt,
            Err(error) => crate::storage::auth::AuthTransactionAttempt::RolledBack(error),
        };
        coordinator.finish_stream_reset(carrier, attempt)
    }

    /// Perform the destructive database half of a coordinator-premarked reset.
    /// In-memory generations move only when the durable stream successor is
    /// known to have committed (including exact post-COMMIT reconciliation).
    pub(crate) fn attempt_reset_with_seed_and_authorization_stream(
        &mut self,
        seed: Option<SeedData>,
        predecessor: &crate::auth::session_projection::AuthorizationStreamIncarnation,
        successor: &crate::auth::session_projection::AuthorizationStreamIncarnation,
    ) -> crate::storage::auth::AuthTransactionAttempt<CoordinatedResetCommit> {
        use crate::storage::auth::AuthTransactionAttempt;

        let app_generation = match next_app_generation() {
            Ok(generation) => generation,
            Err(error) => return AuthTransactionAttempt::RolledBack(error),
        };
        let secret_read_generation = self.secret_read_reset_generation.load(Ordering::Acquire);
        let next_secret_read_generation =
            match next_secret_read_reset_generation(secret_read_generation) {
                Ok(generation) => generation,
                Err(error) => return AuthTransactionAttempt::RolledBack(error),
            };
        match self
            .db
            .attempt_reset_and_seed_with_authorization_stream(seed, predecessor, successor)
        {
            AuthTransactionAttempt::Committed(seeded) => {
                AuthTransactionAttempt::Committed(CoordinatedResetCommit {
                    seeded,
                    app_generation,
                    secret_read_generation,
                    next_secret_read_generation,
                })
            }
            AuthTransactionAttempt::RolledBack(error) => AuthTransactionAttempt::RolledBack(error),
            AuthTransactionAttempt::CommitUncertain(error) => {
                AuthTransactionAttempt::CommitUncertain(error)
            }
        }
    }

    /// Publish reset-owned process state while the coordinator's stream
    /// mutation ticket still blocks predecessor and successor publication.
    /// The server installs a freshly authenticated successor issuer after
    /// this clears the predecessor state, then finalizes the coordinator as
    /// the last step that reopens app authority.
    pub(crate) fn publish_coordinated_reset(
        &mut self,
        committed: CoordinatedResetCommit,
    ) -> Option<MutationOutput> {
        self.finish_committed_reset(
            committed.app_generation,
            committed.secret_read_generation,
            committed.next_secret_read_generation,
        );
        committed.seeded
    }

    fn finish_committed_reset(
        &mut self,
        app_generation: u64,
        secret_read_generation: u64,
        next_secret_read_generation: u64,
    ) {
        let exchanged = self.secret_read_reset_generation.compare_exchange(
            secret_read_generation,
            next_secret_read_generation,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
        debug_assert_eq!(exchanged, Ok(secret_read_generation));
        self.install_app_generation(app_generation);
        self.warm_vms.clear();
        self.terminalize_all_local_live_effects();
        // ENG-23333: capture the live subscriptions being dropped so their
        // clients can be told. Clearing the map alone leaves every connected
        // client's WebSocket open on subscription ids that no longer exist
        // server-side — no future commit (including a post-reset seed) would
        // ever deliver to them, so a tab would render pre-reset data forever,
        // indistinguishable from a healthy idle app.
        let dropped_subscriptions: Vec<LiveSubscription> =
            self.subscriptions.values().cloned().collect();
        self.subscriptions.clear();
        self.refresh_auth_scoped_live_connections();
        // The authenticated issuer names the pre-reset authorization
        // incarnation. Reset terminates those scopes; coordinated server reset
        // installs a freshly reserved successor before reopening authority.
        self.auth_invalidation = None;
        self.permission_epochs.clear();
        self.refresh_read_epochs();
        self.cron.reset_runtime_state(&self.functions);
        self.live_delivery = LiveDeliveryStats::default();
        // Signal the dropped subscriptions AFTER `reset_runtime_state`: the
        // ephemeral reset clears every connection outbox, so anything
        // enqueued earlier would be wiped.
        // @ref LLP 0008#realtime-delivery — resync sentinels: a dropped
        // subscription must get a resync signal, never a silent freeze.
        // Counters were just reset, so the reset's own signals are counted —
        // the same convention as the ephemeral reset's `Restarted` resyncs.
        // Each client gets a `resync_required`
        // (reason "reset") on its still-open connection so it re-snapshots
        // instead of silently freezing, and the global receipts ring gets the
        // same `disposed` markers `disconnect` pushes.
        let mut reset_signals = Vec::with_capacity(dropped_subscriptions.len());
        if !dropped_subscriptions.is_empty() {
            self.live_delivery.total_fanout_attempts += dropped_subscriptions.len() as u64;
            self.live_delivery.last_fanout_subscriptions = dropped_subscriptions.len();
            let now_ms = now_millis();
            for subscription in &dropped_subscriptions {
                self.receipts.push_global(
                    Receipt::Subscription {
                        event: SubscriptionReceiptEvent::Disposed,
                        reason: Some("reset".to_owned()),
                        subscription_id: Some(subscription.id.clone()),
                        superseded_by: None,
                        lane: None,
                        binding_id: None,
                        collection: None,
                        removed: None,
                        scope: subscription.input.args.clone(),
                        snapshot_version: None,
                        correlation: None,
                        received_at_ms: now_ms,
                    }
                    .into_value(),
                );
                let Ok(payload) = serde_json::to_vec(&LiveEnvelope::ResyncRequired {
                    reason: "reset".to_owned(),
                    subscription_id: Some(subscription.id.clone()),
                    scope: Some(String::new()),
                    epoch: Some(0),
                    clear_retained: true,
                }) else {
                    continue;
                };
                reset_signals.push((
                    subscription.connection_id.clone(),
                    subscription.effect_fence.clone(),
                    payload,
                ));
                self.live_delivery.total_deliveries += 1;
                self.live_delivery.last_deliveries += 1;
            }
        }
        // Runtime reset and its durable dropped-subscription sentinels are one
        // ordered after-Local effect: enqueueing before the reset would lose
        // the sentinels, while running either half beneath Local would take
        // lifecycle/room/notifier locks. Direct-library reset executes this
        // closure synchronously.
        // @ref LLP 0059#reset-restore-and-stream-publication — the stream
        // ticket remains closed until the successor runtime projection ends.
        let ephemeral = self.ephemeral.clone();
        crate::exec_guard::run_or_defer_after_local(move || {
            ephemeral.reset_runtime_state();
            for (connection_id, effect_fence, payload) in reset_signals {
                match effect_fence {
                    Some(effect_fence) => {
                        ephemeral.enqueue_durable_bound(connection_id, payload, effect_fence);
                    }
                    None => {
                        ephemeral.enqueue_durable(connection_id, payload);
                    }
                }
            }
        });
        // Clearing subscriptions can disarm a demand-gated cron job (L5).
        self.refresh_cron_active();
        // The durable reset has already committed. A secondary cron-state
        // persistence failure is diagnostic-only: returning an error here
        // would falsely imply the destructive operation rolled back.
        if let Err(error) = self.persist_cron_state() {
            self.record_diagnostics(vec![error.diagnostic]);
        }
    }

    pub(crate) fn app_generation(&self) -> u64 {
        self.app_generation
    }

    fn install_app_generation(&mut self, generation: u64) {
        self.app_generation = generation;
        self.app_generation_fence
            .store(generation, Ordering::SeqCst);
        // Loaded code/schema (or the destructive app-state boundary) changed:
        // recompute the content-derived RQS `generation` lazily. A no-op
        // ensure recomputes the identical digest, so outstanding resume
        // tokens keep verifying (LLP 0091 §0A.6).
        self.rqs_generation = None;
    }

    fn resolve_complete_provision_pair(
        &self,
        requested_mode: AuthMode,
        schema: Option<SchemaManifest>,
        functions: Option<FunctionManifest>,
        seed: Option<SeedData>,
        state: &AuthModeStateRecord,
    ) -> SnapbackResult<StartupArtifacts> {
        let (schema, functions) = match (schema, functions) {
            (Some(schema), Some(functions)) => {
                return Ok(StartupArtifacts {
                    format_version: STARTUP_ARTIFACT_FORMAT_VERSION,
                    schema,
                    functions,
                    seed,
                });
            }
            pair => pair,
        };

        let sibling_identity = if requested_mode == state.active {
            state.active_deployment.as_ref()
        } else if requested_mode == state.desired {
            state.requested_deployment.as_ref()
        } else {
            None
        };
        let sibling = sibling_identity.and_then(|identity| {
            self.preflighted_artifact_pairs
                .iter()
                .rev()
                .find(|pair| &pair.deployment == identity)
        });
        let Some(sibling) = sibling else {
            return Err(SnapbackError::error(
                "SNAPBACK_CAPABILITY_UNSUPPORTED",
                "auth-mode",
                "a partial provision requires the complete preflighted sibling pair from this process",
            ));
        };

        Ok(StartupArtifacts {
            format_version: STARTUP_ARTIFACT_FORMAT_VERSION,
            schema: schema.unwrap_or_else(|| sibling.schema.clone()),
            functions: functions.unwrap_or_else(|| sibling.prepared_functions.manifest.clone()),
            seed,
        })
    }

    fn require_provision_posture(
        state: &AuthModeStateRecord,
        requested_mode: AuthMode,
    ) -> SnapbackResult<()> {
        use crate::auth::mode::AuthModeStatus;

        match state.mode_state {
            AuthModeStatus::Settled => Ok(()),
            AuthModeStatus::PendingRestart | AuthModeStatus::Quarantined
                if requested_mode == state.desired && requested_mode != state.active =>
            {
                Ok(())
            }
            AuthModeStatus::PendingRestart | AuthModeStatus::Quarantined => {
                Err(SnapbackError::error(
                    "SNAPBACK_AUTH_MODE_PENDING",
                    "auth-mode",
                    "a pending auth-mode transition may only be corrected by re-staging its desired mode",
                ))
            }
        }
    }

    /// First, read-only provisioning pass. It resolves any same-boot sibling,
    /// validates the complete pair and target registry, and returns owned
    /// bytes that can cross the admission barrier. No schema, function,
    /// mode-state, or seed effect occurs here.
    // @ref LLP 0058#stage-ordering — mode staging preflights before closing admission and repeats under the write lane.
    pub(crate) fn prepare_auth_provision(
        &mut self,
        requested_mode: EnsureAppMode,
        schema: Option<SchemaManifest>,
        functions: Option<FunctionManifest>,
        seed: Option<SeedData>,
    ) -> SnapbackResult<PreparedAuthProvision> {
        let requested_mode = requested_mode.auth_mode();
        let snapshot = self.db.auth_mode_snapshot()?;
        Self::require_provision_posture(&snapshot.state, requested_mode)?;
        let artifacts = self.resolve_complete_provision_pair(
            requested_mode,
            schema,
            functions,
            seed,
            &snapshot.state,
        )?;
        let deployment = self.preflight_auth_artifacts(&artifacts, requested_mode)?;
        Ok(PreparedAuthProvision {
            requested_mode,
            artifacts,
            deployment,
        })
    }

    /// State-sensitive second pass and atomic durable cut. A caller staging a
    /// mode change or activating a same-mode Sessions deployment must hold the
    /// transition guard supplied by the admission controller. Same-mode dev
    /// callers remain serialized by the app write lane alone.
    #[cfg(test)]
    pub(crate) fn commit_auth_provision(
        &mut self,
        prepared: PreparedAuthProvision,
        profile: &str,
    ) -> SnapbackResult<(EnsureAppProvisionOutcome, AuthModeStateRecord)> {
        self.commit_auth_provision_classified(prepared, profile, None)
            .map(|committed| (committed.outcome, committed.state))
            .map_err(ModeCommitFailure::into_error)
    }

    pub(crate) fn commit_auth_provision_classified(
        &mut self,
        prepared: PreparedAuthProvision,
        profile: &str,
        activation_admission: Option<&AdmissionLease>,
    ) -> Result<AuthProvisionCommit, ModeCommitFailure> {
        if crate::exec_guard::local_write_scope_active() {
            return self.commit_auth_provision_classified_in_scope(
                prepared,
                profile,
                activation_admission,
            );
        }
        match self.try_with_direct_authorization_write(
            crate::storage::AuthorizationCommitPreflight::AllProtectedRooms,
            move |snapback| {
                snapback.commit_auth_provision_classified_in_scope(
                    prepared,
                    profile,
                    activation_admission,
                )
            },
        ) {
            Ok(committed) => committed,
            Err(error) => Err(ModeCommitFailure::RolledBack(error)),
        }
    }

    fn commit_auth_provision_classified_in_scope(
        &mut self,
        prepared: PreparedAuthProvision,
        profile: &str,
        activation_admission: Option<&AdmissionLease>,
    ) -> Result<AuthProvisionCommit, ModeCommitFailure> {
        let before = self
            .db
            .auth_mode_snapshot()
            .map_err(ModeCommitFailure::RolledBack)?;
        Self::require_provision_posture(&before.state, prepared.requested_mode)
            .map_err(ModeCommitFailure::RolledBack)?;
        let observed = self
            .preflight_auth_artifacts(&prepared.artifacts, prepared.requested_mode)
            .map_err(ModeCommitFailure::RolledBack)?;
        if observed != prepared.deployment {
            return Err(ModeCommitFailure::RolledBack(
                crate::auth::mode::mode_corrupt(
                    "prepared provisioning identity changed between preflight passes",
                ),
            ));
        }
        if before.state.active == AuthMode::Sessions
            && prepared.requested_mode == before.state.active
            && activation_admission.is_none()
        {
            return Err(ModeCommitFailure::RolledBack(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth-mode",
                "same-mode sessions provisioning requires the closed activation admission",
            )));
        }

        let comparison = if prepared.requested_mode == before.state.active {
            before.state.active_deployment.as_ref()
        } else {
            before.state.requested_deployment.as_ref()
        };
        let schema_matched = comparison
            .is_some_and(|identity| identity.schema_hash == prepared.deployment.schema_hash);
        let functions_matched = comparison
            .is_some_and(|identity| identity.bundle_hash == prepared.deployment.bundle_hash);

        let (seed_outcome, state, diagnostics) = if prepared.requested_mode == before.state.active {
            let publication_generation = self
                .reserve_function_publication_generation()
                .map_err(ModeCommitFailure::RolledBack)?;
            let committed = self
                .db
                .apply_same_mode_network_deployment_with_functions_classified(
                    prepared.deployment,
                    prepared.artifacts.schema,
                    prepared.artifacts.functions.clone(),
                    prepared.artifacts.seed,
                );
            let NetworkDeploymentCommit {
                seed_outcome,
                activation_changed,
                state,
                authorization,
            } = match committed {
                DurableModeCommit::Committed(committed) => committed,
                DurableModeCommit::RolledBack(error) => {
                    return Err(ModeCommitFailure::RolledBack(error));
                }
                DurableModeCommit::Uncertain(error) => {
                    return Err(ModeCommitFailure::Uncertain(error));
                }
            };
            let diagnostics = self.publish_preflighted_functions(
                prepared.artifacts.functions,
                publication_generation,
            );
            if before.state.active == AuthMode::Sessions
                && (activation_changed || seed_outcome == NetworkSeedOutcome::Seeded)
            {
                // @ref LLP 0058#same-mode-provisioning — publish the prepared
                // generation, project this transaction's exact auth event,
                // and invalidate retained authority-independent snapshots
                // while ordinary successor admission is still closed.
                let admission = activation_admission.expect(
                    "settled sessions activation checked transition-owned admission before commit",
                );
                self.begin_live_delivery_frame(self.subscriptions.len());
                if activation_changed {
                    self.invalidate_unscoped_live_subscriptions_for_activation(admission)
                        .map_err(ModeCommitFailure::Uncertain)?;
                }
                let already_resynced = if let Some(authorization) =
                    authorization.as_ref().filter(|event| event.witness.event)
                {
                    self.notify_authorization_activation_in_frame(
                        &authorization.witness,
                        authorization.min_commit_version,
                        admission,
                    )
                    .map_err(ModeCommitFailure::Uncertain)?
                } else {
                    BTreeSet::new()
                };
                if seed_outcome == NetworkSeedOutcome::Seeded {
                    let frame_version = self
                        .db
                        .current_version()
                        .map_err(ModeCommitFailure::Uncertain)?;
                    self.notify_live_subscriptions_in_frame(
                        &[],
                        &already_resynced,
                        frame_version,
                        admission,
                    )
                    .map_err(ModeCommitFailure::Uncertain)?;
                }
            }
            (seed_outcome.as_str(), state, diagnostics)
        } else {
            let seeded = prepared.artifacts.seed.is_some();
            let committed = self.db.stage_auth_mode_with_functions_classified(
                prepared.deployment,
                prepared.artifacts.schema,
                &prepared.artifacts.functions,
                prepared.artifacts.seed,
            );
            let state = match committed {
                DurableModeCommit::Committed(committed) => committed,
                DurableModeCommit::RolledBack(error) => {
                    return Err(ModeCommitFailure::RolledBack(error));
                }
                DurableModeCommit::Uncertain(error) => {
                    return Err(ModeCommitFailure::Uncertain(error));
                }
            };
            (
                if seeded { "seeded" } else { "skipped-absent" },
                state,
                Vec::new(),
            )
        };
        Ok(AuthProvisionCommit {
            outcome: EnsureAppProvisionOutcome {
                intent: EnsureAppIntent::Provision,
                schema: if schema_matched {
                    "matched"
                } else {
                    "provisioned"
                }
                .to_owned(),
                functions: if functions_matched {
                    "matched"
                } else {
                    "provisioned"
                }
                .to_owned(),
                seed: seed_outcome.to_owned(),
                profile: profile.to_owned(),
            },
            state,
            diagnostics,
        })
    }

    /// ENG-22527: the ensure-everything mount-lifecycle operation. Inspects
    /// the loaded schemaHash/bundleHash against the posted generated
    /// manifests; provisions ONLY the missing/mismatched halves (when the
    /// profile allows provisioning — otherwise those halves report 'gated');
    /// seeds server-side only when every seed target table is empty (the
    /// true seed-without-reset path).
    pub fn ensure_app(
        &mut self,
        input: EnsureAppInput,
        provisioning_allowed: bool,
        profile: &str,
    ) -> SnapbackResult<EnsureAppOutcome> {
        // Validate every posted artifact before the first hash comparison or
        // effect. In particular, a matching hash is attestation evidence, not
        // permission to bypass an unsupported artifact version; validating
        // both halves up front also prevents a valid schema from applying
        // before an invalid function artifact is rejected.
        if let Err(error) = input.validate_artifacts() {
            // Preserve load_functions' diagnostic trail while moving the
            // validation itself ahead of every hash comparison and effect.
            // Schema-header failures gain the same rejected-artifact record.
            self.record_diagnostics(vec![error.diagnostic.clone()]);
            return Err(error);
        }

        let schema_outcome = match input.schema {
            None => "skipped-absent",
            Some(manifest) => {
                let loaded = self.db.schema().schema_hash.clone();
                if loaded.as_deref() == manifest.schema_hash.as_deref() && loaded.is_some() {
                    "matched"
                } else if provisioning_allowed {
                    // apply_schema is additive for tables and identity-guarded
                    // for ephemeral collections (replace_collections no-ops on
                    // identical definitions — live rooms survive a matched
                    // ensure by construction; LLP 0025).
                    self.apply_schema(manifest)?;
                    "provisioned"
                } else {
                    "gated"
                }
            }
        };

        let functions_outcome = match input.functions {
            None => "skipped-absent",
            Some(manifest) => {
                let loaded = self.functions.bundle_hash.clone();
                if loaded.as_deref() == manifest.bundle_hash.as_deref() && loaded.is_some() {
                    "matched"
                } else if provisioning_allowed {
                    let diagnostics = self.load_functions(manifest);
                    if let Some(error) = diagnostics.iter().find(|diagnostic| {
                        matches!(
                            diagnostic.severity,
                            DiagnosticSeverity::Error | DiagnosticSeverity::Fatal
                        )
                    }) {
                        return Err(SnapbackError::new(error.clone()));
                    }
                    "provisioned"
                } else {
                    "gated"
                }
            }
        };

        // Routes install after the functions half so validation runs against
        // the manifest this same ensure just applied (LLP 0092 §0C.1).
        let routes_outcome = match input.routes {
            None => None,
            Some(manifest) => {
                let incoming_hash = serde_json::to_value(&manifest)
                    .ok()
                    .and_then(|value| crate::rqs::sha256_identity(&value).ok());
                if incoming_hash.is_some() && incoming_hash == self.routes_manifest_hash {
                    Some("matched")
                } else if provisioning_allowed {
                    self.install_routes_manifest(manifest)?;
                    Some("provisioned")
                } else {
                    Some("gated")
                }
            }
        };

        let seed_outcome = match input.seed {
            None => "skipped-absent",
            // Gate BEFORE the emptiness scan (ENG-22527 FIX 2): when
            // provisioning is disallowed the schema half is also gated, so its
            // tables were never created — scanning them would raise
            // SNAPBACK_UNKNOWN_TABLE and turn the primary fresh-prod mount into
            // a 500 instead of an honest seed:"gated". Report gated and never
            // touch the store.
            Some(_) if !provisioning_allowed => "gated",
            Some(seed) => {
                let mut all_empty = true;
                for table in seed.tables.keys() {
                    let scan = self.db.scan_table(table, 1, 0)?;
                    if !scan.rows.is_empty() {
                        all_empty = false;
                        break;
                    }
                }
                if !all_empty {
                    // Seed-if-empty, never reset-then-seed (LLP 0034 §5 edit
                    // 2): existing data always wins.
                    "skipped-nonempty"
                } else {
                    self.seed(seed)?;
                    "seeded"
                }
            }
        };

        Ok(EnsureAppOutcome {
            schema: schema_outcome.to_owned(),
            functions: functions_outcome.to_owned(),
            seed: seed_outcome.to_owned(),
            routes: routes_outcome.map(str::to_owned),
            profile: profile.to_owned(),
        })
    }

    /// Compare an identity-only pair against the currently loaded artifacts.
    /// This path is observational by construction: it has no manifest or seed
    /// input and takes `&self`, so Public attestation cannot stage or mutate.
    pub fn attest_app(
        &self,
        requested_mode: EnsureAppMode,
        pair: EnsureAppPairIdentity,
    ) -> SnapbackResult<EnsureAppAttestOutcome> {
        let requested = pair.normalized(requested_mode)?;
        let requested_deployment = DeploymentIdentity {
            schema_version: requested.schema_version.clone(),
            auth_mode: requested_mode.auth_mode(),
            app_id: requested.app_id.clone(),
            schema_hash: requested.schema_hash.clone(),
            bundle_hash: requested.bundle_hash.clone(),
            inputs_hash: requested.inputs_hash.clone(),
        };
        requested_deployment.validate().map_err(|_| {
            ensure_request_invalid(
                "app.ensure attestation identity is not valid for its requested auth mode",
            )
        })?;

        let snapshot = self.db.auth_mode_snapshot()?;
        if snapshot.state.mode_state != crate::auth::mode::AuthModeStatus::Settled
            || snapshot.state.active != requested_mode.auth_mode()
            || snapshot.state.desired != requested_mode.auth_mode()
        {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "app.ensure attestation requires a settled active mode matching requestedMode",
            ));
        }
        let active_deployment = snapshot.state.active_deployment.ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "app.ensure attestation requires a complete coherent active artifact pair",
            )
        })?;
        let active = EnsureAppActiveIdentity {
            schema_version: active_deployment.schema_version,
            app_id: active_deployment.app_id,
            schema_hash: active_deployment.schema_hash,
            bundle_hash: active_deployment.bundle_hash,
            inputs_hash: active_deployment.inputs_hash,
        };
        Ok(EnsureAppAttestOutcome {
            intent: EnsureAppIntent::Attest,
            matched: active == requested,
            active,
        })
    }

    pub fn seed(&mut self, seed: SeedData) -> SnapbackResult<MutationOutput> {
        let preflight = self.authorization_commit_preflight_for_seed(&seed)?;
        self.try_with_direct_authorization_write(preflight, move |snapback| {
            let output = snapback.db.seed(seed)?;
            snapback.notify_live_subscriptions(&[]);
            Ok(output)
        })?
    }

    // Cheap identity/artifact facts for host-ops envelopes (LLP 0032 P6):
    // every envelope carries them, so they must not pay inspect()'s price.

    pub fn loaded_app_id(&self) -> String {
        self.db.schema().app_id.clone()
    }

    pub fn loaded_schema_hash(&self) -> Option<String> {
        self.db.schema().schema_hash.clone()
    }

    pub fn loaded_bundle_hash(&self) -> Option<String> {
        self.functions.bundle_hash.clone()
    }

    pub fn durable_version(&self) -> SnapbackResult<u64> {
        self.db.current_version()
    }

    pub fn acknowledge_client_mutations(
        &mut self,
        auth: &AuthInput,
        ids: &[String],
    ) -> SnapbackResult<u64> {
        let current = self
            .db
            .acknowledge_client_mutations(&auth_fingerprint(auth), ids)?;
        let legacy = self
            .db
            .acknowledge_client_mutations(&legacy_auth_fingerprint(auth), ids)?;
        current.checked_add(legacy).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_CLIENT_MUTATION_RETENTION_STATE_INVALID",
                "storage",
                "acknowledged settlement count overflowed across auth aliases",
            )
        })
    }

    pub(crate) fn acknowledge_client_mutations_with_authority(
        &mut self,
        authority: &PreparedAuthority,
        ids: &[String],
    ) -> SnapbackResult<u64> {
        authority.validate_admission("client mutation acknowledgement")?;
        self.persist_and_validate_prepared_service_authority(authority)?;
        let auth = authority.canonical_auth_input();
        let incarnation = self.db.ensure_authorization_stream_incarnation()?;
        let descriptor = descriptor_for_authority(authority, incarnation.as_str())?;
        let _effect = authority.effect_guard("client mutation acknowledgement transaction")?;
        let current = self.db.acknowledge_client_mutations_for_authority(
            &auth_fingerprint(&auth),
            &descriptor.authority_instance_id,
            ids,
        )?;
        let legacy = self.db.acknowledge_client_mutations_for_authority(
            &legacy_auth_fingerprint(&auth),
            &descriptor.authority_instance_id,
            ids,
        )?;
        current.checked_add(legacy).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_CLIENT_MUTATION_RETENTION_STATE_INVALID",
                "storage",
                "acknowledged settlement count overflowed across auth aliases",
            )
        })
    }

    /// Administrative recovery for settlements whose original client can no
    /// longer deliver an acknowledgement. The HTTP boundary supplies an
    /// `AuthInput`, never a caller-chosen raw fingerprint, so targeted purge
    /// uses exactly the same canonical identity as commit and ACK.
    pub fn purge_client_mutation_settlements(
        &mut self,
        auth: Option<&AuthInput>,
    ) -> SnapbackResult<u64> {
        let Some(auth) = auth else {
            return self.db.purge_client_mutation_settlements(None);
        };
        let current = self
            .db
            .purge_client_mutation_settlements(Some(&auth_fingerprint(auth)))?;
        let legacy = self
            .db
            .purge_client_mutation_settlements(Some(&legacy_auth_fingerprint(auth)))?;
        current.checked_add(legacy).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_CLIENT_MUTATION_RETENTION_STATE_INVALID",
                "storage",
                "purged settlement count overflowed across auth aliases",
            )
        })
    }

    pub fn function_definition(&self, name: &str) -> Option<&FunctionDefinition> {
        self.functions.function(name)
    }

    pub fn inspect(&mut self) -> SnapbackResult<InspectState> {
        let mut inspect = self.inspect_core()?;
        inspect.ephemeral = self.ephemeral.diagnostics();
        Ok(inspect)
    }

    /// Capture Local/SQLite-owned inspect state only. Managed server callers
    /// release Local before composing [`EphemeralDiagnostics`] on their
    /// blocking owner; direct-library [`Self::inspect`] remains synchronous.
    pub(crate) fn inspect_core(&mut self) -> SnapbackResult<InspectState> {
        // @ref LLP 0010#v0-implementation-charter — missing non-v0 capabilities must be reported explicitly.
        let capability_gaps = self.capability_gaps();
        // @ref LLP 0076#target-contract — the served manifest is instance-live:
        // it reflects whether THIS process enabled outbound egress and so the
        // bounded response-stream profile, not the conservative declaration.
        let mut capability_manifest = CapabilityManifest::local_v0_instance(
            capability_gaps.clone(),
            crate::runtime::outbound_actions_enabled(),
        );
        // @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 —
        // report the live VM lifecycle honestly (warm is opt-out-able via
        // SNAPBACK_FRESH_VM=1, so this is per-instance state, not a constant).
        if self.warm_vms.enabled() {
            capability_manifest.vm_lifecycle =
                crate::manifest::VM_LIFECYCLE_WARM_POOLED_RESET.to_owned();
        }
        let active_live_functions = self.active_live_functions();
        let cron = self
            .cron
            .inspect(&self.functions, &active_live_functions, now_millis());

        Ok(InspectState {
            artifact_kind: "runtimeState".to_owned(),
            schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
            target_profile_id: TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            target: TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            storage: self.db.info()?,
            runtime: self.runtime.capabilities().clone(),
            schema: self.db.schema().clone(),
            functions: self.functions.clone(),
            capability_manifest,
            subscriptions: self
                .subscriptions
                .values()
                .map(|subscription| LiveSubscriptionInfo {
                    id: subscription.id.clone(),
                    connection_id: subscription.connection_id.clone(),
                    function: subscription.function.clone(),
                })
                .collect(),
            active_connections: self.connections_last_seen.len(),
            reaped_connections: self.reaped_connections,
            live_delivery: self.live_delivery.clone(),
            ephemeral: EphemeralDiagnostics::default(),
            cron,
            maintenance: self.maintenance.clone(),
            recent_diagnostics: self.recent_diagnostics.iter().cloned().collect(),
            capability_gaps,
        })
    }

    fn capability_gaps(&self) -> Vec<String> {
        // The declared gap list is owned by the manifest module (the single
        // source the committed capability artifact is generated from —
        // LLP 0032 P2); only instance-live adjustments happen here.
        let mut capability_gaps = crate::manifest::local_v0_default_capability_gaps();
        if self.runtime.capabilities().ibex_cli.available {
            capability_gaps.retain(|gap| gap != "ibex_cli");
        } else {
            capability_gaps.push("ibex_cli".to_owned());
        }
        if crate::runtime::outbound_actions_enabled() {
            capability_gaps
                .retain(|gap| gap != "outbound_actions" && gap != "bounded_response_stream_v1");
        }
        capability_gaps
    }

    pub fn invoke_query(&self, name: &str, input: HandlerInput) -> SnapbackResult<QueryOutput> {
        Ok(self
            .invoke_query_with_dependencies_from_source(name, input, InvocationSource::LocalQuery)?
            .output)
    }

    pub(crate) fn invoke_query_with_dependencies_from_source(
        &self,
        name: &str,
        input: HandlerInput,
        source: InvocationSource,
    ) -> SnapbackResult<QueryInvocation> {
        let authority = InvocationGate::prepare_admitted_dev_input(
            source,
            ServerProfile::Dev,
            &input,
            self.admission.admit_dev()?,
        )?;
        self.invoke_query_with_dependencies_prepared(name, input, authority)
    }

    pub(crate) fn invoke_query_with_dependencies_prepared(
        &self,
        name: &str,
        input: HandlerInput,
        authority: PreparedAuthority,
    ) -> SnapbackResult<QueryInvocation> {
        self.validate_prepared_service_authority(&authority)?;
        let function = self.function(name)?;
        let prepared = InvocationGate::prepare_function(authority, function)?;
        let input = prepared.canonicalize_input(input);
        execute_query_invocation(
            function,
            name,
            DbRead::Live(&self.db),
            &self.permission_epochs,
            input,
            &prepared,
            Some(&self.warm_vms),
            Some(RelationalCursorAuthority {
                app_id: &self.functions.app_id,
                keyring: &self.resume_keyring,
            }),
        )
    }

    /// Execute the only full revalidation path permitted to mint an
    /// AuthorizedLease. Query result, data head, authorization pair,
    /// activation, issuer, and target-scoped obligation state are captured
    /// while the app instance is one coherent read. Signing happens only after
    /// this method releases the app lock; final reservation rechecks every
    /// fact.
    ///
    /// @ref LLP 0053#the-lease-the-only-mechanism-for-the-unreachable-client —
    /// opaque/undeclared queries cannot retain, and a pending invalidation
    /// capable of quarantining/deleting this exact query can never ride a
    /// lease-bearing snapshot; unrelated users' obligations do not fence it
    /// (ENG-24989).
    pub(crate) fn capture_authorized_lease_query(
        &self,
        name: &str,
        input: HandlerInput,
        authority: PreparedAuthority,
        request: AuthorizedLeaseRequestIdentity,
    ) -> SnapbackResult<AuthorizedLeaseCapture> {
        request.validate()?;
        authority.validate_admission("authorized lease full-query capture")?;
        let function = self.function(name)?;
        if !function.is_user_scoped_retainable_query() {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTHORIZED_LEASE_QUERY_NOT_RETAINABLE",
                "auth",
                "authorized leases require a declared userId-only retainable query",
            ));
        }
        let (
            principal_id,
            session_id_at_issue,
            provider_key,
            session_not_after_ms,
            provider_not_after_ms,
            authority_instance_id,
        ) = match authority.resolved() {
            ResolvedAppAuthority::Session {
                user_id,
                session_id,
                provider,
                authority_instance_id,
                session_not_after_ms,
                provider_not_after_ms,
                ..
            } => (
                user_id.clone(),
                Some(session_id.clone()),
                Some(provider.clone()),
                Some(*session_not_after_ms),
                *provider_not_after_ms,
                Some(authority_instance_id.clone()),
            ),
            _ => {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTHORIZED_LEASE_AUTHORITY_INVALID",
                    "auth",
                    "authorized retained queries require resolved session authority",
                ));
            }
        };
        let invalidation = self.auth_invalidation.as_ref().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTHORIZED_LEASE_UNAVAILABLE",
                "auth",
                "authorization invalidation state is unavailable",
            )
        })?;
        let lease_target = QueryNamespace {
            client_store_id: request.client_store_id.clone(),
            query_key: request.query_key.clone(),
            query_instance_id: request.query_instance_id,
        };
        if invalidation.obligations.blocks_lease_target(&lease_target) {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_PENDING",
                "auth",
                "an authorization/query/connection obligation is pending for this query",
            ));
        }
        let deployment = self
            .db
            .auth_mode_snapshot()?
            .state
            .active_deployment
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTHORIZED_LEASE_UNAVAILABLE",
                    "auth",
                    "active deployment identity is unavailable",
                )
            })?;
        if deployment.auth_mode != AuthMode::Sessions {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTHORIZED_LEASE_AUTHORITY_INVALID",
                "auth",
                "authorized leases are unavailable outside sessions mode",
            ));
        }
        let target_profile_id = self
            .db
            .schema()
            .target_profile
            .clone()
            .unwrap_or_else(|| TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned());
        let issuer_id = invalidation.issuer.authenticated().issuer_id.clone();
        let authorization = invalidation.obligations.expectation().authorization.clone();
        let version_stream = invalidation.version_stream.clone();
        let admission = authority.admission_lease().clone();
        let output = self
            .invoke_query_with_dependencies_prepared(name, input, authority)?
            .output;
        if output.version != self.db.current_version()? {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTHORIZED_LEASE_STALE",
                "auth",
                "full query did not finish at the current data head",
            ));
        }
        // This guard covers the capture boundary. The cloned lease remains
        // live across signing and is consumed again at final reservation.
        {
            let _capture = admission.effect_guard("authorized lease full-query capture")?;
        }
        Ok(AuthorizedLeaseCapture {
            issue: AuthorizedLeaseIssue {
                lease_id: format!("lease_{}", Uuid::now_v7().simple()),
                lease_request_id: request.lease_request_id,
                issuer_id,
                client_store_id: request.client_store_id,
                query_key: request.query_key,
                query_instance_id: request.query_instance_id,
                principal_id,
                session_id_at_issue,
                provider_key,
                authorization,
                data: AuthorizedLeaseData {
                    version_stream,
                    snapshot_commit_version: output.version,
                },
                activation_hash: authorized_lease_activation_hash(&deployment),
                session_not_after_ms,
                provider_not_after_ms,
                authority_instance_id,
            },
            output,
            target_profile_id,
            app_id: deployment.app_id,
            admission,
        })
    }

    /// Reacquire the app lane after keyring signing and consume the one-shot
    /// reservation only if the capture still exactly names the current head,
    /// auth pair, activation, issuer, and target-scoped empty obligation set.
    /// Rechecking here means an obligation for this exact query that races
    /// the capture/signing window still wins over the lease.
    pub(crate) fn reserve_captured_authorized_lease(
        &mut self,
        capture: AuthorizedLeaseCapture,
        lease: &AuthorizedLease,
        config: AuthorizedLeaseConfig,
        issued_at_server_ms: u64,
    ) -> SnapbackResult<QueryOutput> {
        capture
            .issue
            .require_issued_lease(lease, issued_at_server_ms)?;
        capture.admission.validate("authorized lease reservation")?;
        // @ref LLP 0053#the-lease-the-only-mechanism-for-the-unreachable-client —
        // the reservation proof blocks only obligations capable of
        // quarantining/deleting this exact query instance (ENG-24989).
        let lease_target = QueryNamespace {
            client_store_id: capture.issue.client_store_id.clone(),
            query_key: capture.issue.query_key.clone(),
            query_instance_id: capture.issue.query_instance_id,
        };
        let no_pending_obligation = self
            .auth_invalidation
            .as_ref()
            .is_some_and(|state| !state.obligations.blocks_lease_target(&lease_target));
        let current_issuer_id = self
            .auth_invalidation
            .as_ref()
            .map(|state| state.issuer.authenticated().issuer_id.clone())
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTHORIZED_LEASE_UNAVAILABLE",
                    "auth",
                    "authorization invalidation state is unavailable",
                )
            })?;
        let _reservation = capture
            .admission
            .effect_guard("authorized lease reservation transaction")?;
        self.db.reserve_authorized_lease(
            lease,
            config,
            issued_at_server_ms,
            no_pending_obligation,
            &current_issuer_id,
        )?;
        Ok(capture.output)
    }

    pub fn invoke_mutation(
        &mut self,
        name: &str,
        input: HandlerInput,
    ) -> SnapbackResult<MutationOutput> {
        self.invoke_mutation_recording_from_source(name, input, InvocationSource::LocalMutation)
            .0
    }

    pub(crate) fn invoke_mutation_with_authority(
        &mut self,
        name: &str,
        input: HandlerInput,
        authority: PreparedAuthority,
    ) -> SnapbackResult<MutationOutput> {
        self.invoke_mutation_recording_with_authority(name, input, None, "local", authority)
            .0
    }

    /// The mutation choke point with receipt emission (LLP 0034 §3.2,
    /// ENG-22478). Every mutation — HTTP, action-hosted, cron-driven —
    /// produces a MutationReceipt with the provider-owned fields; the opaque
    /// adapter correlation from the input is echoed verbatim. The receipt is
    /// retained in the global ring and returned so the HTTP handler can ride
    /// it on the response.
    pub fn invoke_mutation_recording(
        &mut self,
        name: &str,
        input: HandlerInput,
    ) -> (SnapbackResult<MutationOutput>, Receipt) {
        self.invoke_mutation_recording_from_source(name, input, InvocationSource::LocalMutation)
    }

    fn invoke_mutation_recording_from_source(
        &mut self,
        name: &str,
        input: HandlerInput,
        source: InvocationSource,
    ) -> (SnapbackResult<MutationOutput>, Receipt) {
        self.invoke_mutation_recording_with_id_from_source(name, input, None, "local", source)
    }

    pub fn invoke_mutation_recording_with_transport(
        &mut self,
        name: &str,
        input: HandlerInput,
        transport: &str,
    ) -> (SnapbackResult<MutationOutput>, Receipt) {
        self.invoke_mutation_recording_with_id_from_source(
            name,
            input,
            None,
            transport,
            InvocationSource::LocalMutation,
        )
    }

    pub fn invoke_mutation_recording_with_id(
        &mut self,
        name: &str,
        input: HandlerInput,
        client_mutation_id: Option<String>,
        transport: &str,
    ) -> (SnapbackResult<MutationOutput>, Receipt) {
        self.invoke_mutation_recording_with_id_from_source(
            name,
            input,
            client_mutation_id,
            transport,
            InvocationSource::LocalMutation,
        )
    }

    pub(crate) fn invoke_mutation_recording_with_id_from_source(
        &mut self,
        name: &str,
        input: HandlerInput,
        client_mutation_id: Option<String>,
        transport: &str,
        source: InvocationSource,
    ) -> (SnapbackResult<MutationOutput>, Receipt) {
        self.invoke_mutation_recording_with_id_and_descriptor_from_source(
            name,
            input,
            client_mutation_id,
            None,
            transport,
            source,
        )
    }

    pub(crate) fn invoke_mutation_recording_with_id_and_descriptor_from_source(
        &mut self,
        name: &str,
        input: HandlerInput,
        client_mutation_id: Option<String>,
        authority_descriptor: Option<AuthorityDescriptor>,
        transport: &str,
        source: InvocationSource,
    ) -> (SnapbackResult<MutationOutput>, Receipt) {
        let authority = self.admission.admit_dev().and_then(|admission| {
            InvocationGate::prepare_admitted_dev_input(
                source,
                ServerProfile::Dev,
                &input,
                admission,
            )
        });
        match authority {
            Ok(authority) => self.invoke_mutation_recording_with_authority_descriptor(
                name,
                input,
                client_mutation_id,
                authority_descriptor,
                transport,
                authority,
            ),
            Err(error) => {
                let correlation = capped_correlation(input.correlation.clone());
                let receipt_mutation_id = client_mutation_id
                    .unwrap_or_else(|| format!("mut_{}", Uuid::now_v7().simple()));
                self.record_mutation_commit(
                    name,
                    transport,
                    correlation,
                    receipt_mutation_id,
                    Err(error),
                    false,
                )
            }
        }
    }

    pub(crate) fn invoke_mutation_recording_with_authority(
        &mut self,
        name: &str,
        input: HandlerInput,
        client_mutation_id: Option<String>,
        transport: &str,
        authority: PreparedAuthority,
    ) -> (SnapbackResult<MutationOutput>, Receipt) {
        self.invoke_mutation_recording_with_authority_descriptor(
            name,
            input,
            client_mutation_id,
            None,
            transport,
            authority,
        )
    }

    /// HTTP/Contract queued replay entry point. A live credential has already
    /// become `authority`; only then do we compare the non-authorizing
    /// descriptor. Session-mode queued work requires it, while dev-mode
    /// callers that predate protocol v1 remain compatible until they opt in.
    ///
    /// @ref LLP 0039#replay-parity-and-the-authority-instance-id — first and
    /// duplicate deliveries share one pre-effect descriptor check.
    pub(crate) fn invoke_mutation_recording_with_authority_descriptor(
        &mut self,
        name: &str,
        input: HandlerInput,
        client_mutation_id: Option<String>,
        authority_descriptor: Option<AuthorityDescriptor>,
        transport: &str,
        authority: PreparedAuthority,
    ) -> (SnapbackResult<MutationOutput>, Receipt) {
        // Managed transport/action hosts must stage outside Local themselves;
        // this compatibility path is only allowed to create a reservation
        // while the direct embedder owns the instance without a Local scope.
        if crate::exec_guard::local_write_scope_active() {
            return self.invoke_mutation_recording_with_authority_descriptor_in_scope(
                name,
                input,
                client_mutation_id,
                authority_descriptor,
                transport,
                authority,
            );
        }

        let admission = authority.admission_lease().clone();
        let correlation = capped_correlation(input.correlation.clone());
        let receipt_mutation_id = client_mutation_id
            .clone()
            .unwrap_or_else(|| format!("mut_{}", Uuid::now_v7().simple()));
        let staged = self.stage_recorded_authorization_mutation(
            name,
            input,
            client_mutation_id,
            authority_descriptor,
            &[],
            transport,
            authority,
        );
        let (preflight, staged) = match staged {
            Ok(staged) => staged,
            Err(error) => {
                return self.record_mutation_commit_after_publication_guard(
                    MutationReceiptPublication::new(
                        name,
                        transport,
                        correlation,
                        receipt_mutation_id,
                        &admission,
                    ),
                    Err(error),
                );
            }
        };
        let committed = self.try_with_direct_authorization_write(preflight, move |snapback| {
            snapback.commit_staged_recorded_authorization_mutation(staged)
        });
        match committed {
            Ok(Ok(recorded)) => recorded,
            Ok(Err(error)) | Err(error) => self.record_mutation_commit_after_publication_guard(
                MutationReceiptPublication::new(
                    name,
                    transport,
                    correlation,
                    receipt_mutation_id,
                    &admission,
                ),
                Err(error),
            ),
        }
    }

    /// The already-staged/managed compatibility body. Callers reaching this
    /// under a Local scope are responsible for having installed a carrier;
    /// this method never performs an in-lock reservation fallback.
    #[allow(clippy::too_many_arguments)]
    fn invoke_mutation_recording_with_authority_descriptor_in_scope(
        &mut self,
        name: &str,
        input: HandlerInput,
        client_mutation_id: Option<String>,
        authority_descriptor: Option<AuthorityDescriptor>,
        transport: &str,
        authority: PreparedAuthority,
    ) -> (SnapbackResult<MutationOutput>, Receipt) {
        let admission = authority.admission_lease().clone();
        let correlation = capped_correlation(input.correlation.clone());
        let receipt_mutation_id = client_mutation_id
            .clone()
            .unwrap_or_else(|| format!("mut_{}", Uuid::now_v7().simple()));
        let result = self.invoke_mutation_commit_with_id_and_authority(
            name,
            input,
            client_mutation_id,
            authority_descriptor,
            authority,
        );
        self.record_mutation_commit_after_publication_guard(
            MutationReceiptPublication::new(
                name,
                transport,
                correlation,
                receipt_mutation_id,
                &admission,
            ),
            result,
        )
    }

    /// HTTP queued-delivery entry point with receipt-proven piggyback ACKs.
    /// The shared function gate and descriptor comparison run before the ACK
    /// transaction, so a stale or malformed queued request has no settlement
    /// side effect. The ordinary mutation path above delegates with no ACKs.
    ///
    /// @ref LLP 0043#milestone-2-queued-mutation-replay — descriptor
    /// comparison precedes settlement lookup and every request effect.
    // These fields are deliberately independent wire/effect axes. Collapsing
    // them into an opaque options bag would weaken the queued replay seam for
    // the sake of Clippy's one-argument-over default.
    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn invoke_mutation_recording_with_authority_descriptor_and_acknowledgements(
        &mut self,
        name: &str,
        input: HandlerInput,
        client_mutation_id: Option<String>,
        authority_descriptor: Option<AuthorityDescriptor>,
        acknowledged_client_mutation_ids: &[String],
        transport: &str,
        authority: PreparedAuthority,
    ) -> SnapbackResult<(SnapbackResult<MutationOutput>, Receipt)> {
        let function = self.function(name)?.clone();
        let prepared = InvocationGate::prepare_function(authority.clone(), &function)?;
        if client_mutation_id.is_some() {
            let incarnation = self.db.ensure_authorization_stream_incarnation()?;
            let expected = descriptor_for_authority(prepared.authority(), incarnation.as_str())?;
            if prepared.authority().active_mode() == AuthMode::Sessions
                || authority_descriptor.is_some()
            {
                require_current_descriptor(authority_descriptor.as_ref(), &expected)?;
            }
        }
        if !acknowledged_client_mutation_ids.is_empty() {
            self.acknowledge_client_mutations_with_authority(
                prepared.authority(),
                acknowledged_client_mutation_ids,
            )?;
        }
        Ok(self.invoke_mutation_recording_with_authority_descriptor(
            name,
            input,
            client_mutation_id,
            authority_descriptor,
            transport,
            authority,
        ))
    }

    /// Execute a mutation handler at most once, then preview only its stored
    /// plan or already-buffered effects to obtain the exact protected-room
    /// selector. The returned carrier owns no open SQLite transaction and can
    /// cross the off-Local room-quiescence phase safely.
    ///
    /// @ref LLP 0059#locking-and-linearization — exact room dependency
    ///   planning precedes both managed Local commit work and SQLite.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn stage_recorded_authorization_mutation(
        &mut self,
        name: &str,
        input: HandlerInput,
        client_mutation_id: Option<String>,
        authority_descriptor: Option<AuthorityDescriptor>,
        acknowledged_client_mutation_ids: &[String],
        transport: &str,
        authority: PreparedAuthority,
    ) -> SnapbackResult<(
        crate::storage::AuthorizationCommitPreflight,
        StagedRecordedMutation,
    )> {
        let function = self.function(name)?.clone();
        let prepared = InvocationGate::prepare_function(authority.clone(), &function)?;
        // The live credential/grant is authorizing; the queued descriptor is
        // only a non-authorizing replay axis. Preserve the ordinary mutation
        // gate order so credential-generation drift cannot be disguised as a
        // descriptor mismatch.
        self.persist_and_validate_prepared_service_authority(prepared.authority())?;
        refuse_unprovenanced_host_plan_authority_creation(&prepared, &function, self.db.schema())?;
        if client_mutation_id.is_some() {
            let incarnation = self.db.ensure_authorization_stream_incarnation()?;
            let expected = descriptor_for_authority(prepared.authority(), incarnation.as_str())?;
            if prepared.authority().active_mode() == AuthMode::Sessions
                || authority_descriptor.is_some()
            {
                require_current_descriptor(authority_descriptor.as_ref(), &expected)?;
            }
        }
        if !acknowledged_client_mutation_ids.is_empty() {
            self.acknowledge_client_mutations_with_authority(
                prepared.authority(),
                acknowledged_client_mutation_ids,
            )?;
        }

        let admission = prepared.admission_lease().clone();
        let correlation = capped_correlation(input.correlation.clone());
        let receipt_mutation_id = client_mutation_id
            .clone()
            .unwrap_or_else(|| format!("mut_{}", Uuid::now_v7().simple()));
        let error_correlation = correlation.clone();
        let error_receipt_mutation_id = receipt_mutation_id.clone();
        let staged = (|| -> SnapbackResult<_> {
            let mut input = prepared.canonicalize_input(input);
            let identity = if let Some(id) = client_mutation_id {
                let incarnation = self.db.ensure_authorization_stream_incarnation()?;
                let expected =
                    descriptor_for_authority(prepared.authority(), incarnation.as_str())?;
                Some(ClientMutationIdentity::for_authority(
                    id,
                    name.to_owned(),
                    &input,
                    expected.authority_instance_id,
                ))
            } else {
                None
            };
            if let Some(identity) = identity.as_ref()
                && let Some(output) = self.db.client_mutation_result(identity)?
            {
                let commit = MutationCommit {
                    output,
                    changes: Vec::new(),
                    read_dependencies: Vec::new(),
                    write_dependencies: Vec::new(),
                    authorization: None,
                };
                let recorded = self.record_mutation_commit_after_publication_guard(
                    MutationReceiptPublication::new(
                        name,
                        transport,
                        correlation.clone(),
                        receipt_mutation_id.clone(),
                        &admission,
                    ),
                    Ok(commit),
                );
                return Ok((
                    self.authorization_commit_preflight_for_changes(Vec::new()),
                    StagedRecordedMutation::Done(Box::new(recorded)),
                ));
            }
            let epoch_scopes = evaluate_permission_epoch_scopes(&function, &input)?;
            let (preflight, execution) = match &function.runtime {
                FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan)) => {
                    let preview = self.db.dry_run_mutation(plan, &input)?;
                    input.ctx_ledger = Some(CtxAnswerLedger {
                        version: ctx_ledger_version(),
                        ids: preview.generated_ids,
                        now: preview.now_ms,
                        auth_fingerprint: None,
                    });
                    (
                        self.authorization_commit_preflight_for_changes(preview.commit.changes),
                        StagedMutationExecution::HostPlan(plan.clone()),
                    )
                }
                FunctionRuntime::IbexModule(module) => {
                    let executed = crate::runtime::execute_ibex_mutation_prepared(
                        module,
                        input.clone(),
                        &prepared,
                        DbRead::Live(&self.db),
                        Some(&self.warm_vms),
                        None,
                    )?;
                    let membership_plans = self
                        .db
                        .authorize_membership_commands(executed.membership_commands)?;
                    let payload = BufferedCommitPayload {
                        writes: executed.writes,
                        membership_plans,
                        read_dependencies: executed.reads,
                        result: executed.result,
                        ctx_ledger: executed.ctx_ledger,
                    };
                    let preview = self.db.dry_run_buffered_writes(
                        &input,
                        payload.writes.clone(),
                        payload.membership_plans.clone(),
                        payload.read_dependencies.clone(),
                        payload.result.clone(),
                        payload.ctx_ledger.clone(),
                    )?;
                    (
                        self.authorization_commit_preflight_for_changes(preview.changes),
                        StagedMutationExecution::Buffered(payload),
                    )
                }
                _ => {
                    return Err(SnapbackError::error(
                        "SNAPBACK_FUNCTION_KIND_MISMATCH",
                        "runtime",
                        format!("{name} is not a mutation"),
                    ));
                }
            };
            Ok((
                preflight,
                StagedRecordedMutation::Ready(Box::new(StagedRecordedMutationCommit {
                    name: name.to_owned(),
                    transport: transport.to_owned(),
                    correlation,
                    receipt_mutation_id,
                    input,
                    prepared,
                    identity,
                    epoch_scopes,
                    execution,
                })),
            ))
        })();

        match staged {
            Ok(staged) => Ok(staged),
            Err(error) => {
                let recorded = self.record_mutation_commit_after_publication_guard(
                    MutationReceiptPublication::new(
                        name,
                        transport,
                        error_correlation,
                        error_receipt_mutation_id,
                        &admission,
                    ),
                    Err(error),
                );
                Ok((
                    self.authorization_commit_preflight_for_changes(Vec::new()),
                    StagedRecordedMutation::Done(Box::new(recorded)),
                ))
            }
        }
    }

    pub(crate) fn commit_staged_recorded_authorization_mutation(
        &mut self,
        staged: StagedRecordedMutation,
    ) -> SnapbackResult<(SnapbackResult<MutationOutput>, Receipt)> {
        let staged = match staged {
            StagedRecordedMutation::Done(recorded) => return Ok(*recorded),
            StagedRecordedMutation::Ready(staged) => staged,
        };
        let StagedRecordedMutationCommit {
            name,
            transport,
            correlation,
            receipt_mutation_id,
            input,
            prepared,
            identity,
            epoch_scopes,
            execution,
        } = *staged;
        let admission = prepared.admission_lease().clone();
        self.ensure_permission_epoch_capacity(&epoch_scopes)?;
        let result = match execution {
            StagedMutationExecution::HostPlan(plan) => match identity.as_ref() {
                Some(identity) => {
                    self.db
                        .execute_mutation_idempotent_guarded(&plan, &input, identity, || {
                            prepared.effect_guard("idempotent mutation transaction")
                        })
                }
                None => self.db.execute_mutation_guarded(
                    &plan,
                    &input,
                    || Ok(()),
                    || prepared.effect_guard("mutation transaction"),
                ),
            },
            StagedMutationExecution::Buffered(payload) => {
                self.db.commit_buffered_writes_idempotent_guarded(
                    &input,
                    payload,
                    identity.as_ref(),
                    || Ok(()),
                    || prepared.effect_guard("ibex mutation transaction"),
                )
            }
        }
        .and_then(|commit| self.finish_mutation_commit(epoch_scopes, commit, &admission));
        let recorded = self.record_mutation_commit_after_publication_guard(
            MutationReceiptPublication::new(
                &name,
                &transport,
                correlation,
                receipt_mutation_id,
                &admission,
            ),
            result,
        );
        Ok(recorded)
    }

    fn record_mutation_commit(
        &mut self,
        name: &str,
        transport: &str,
        correlation: Option<Value>,
        receipt_mutation_id: String,
        result: SnapbackResult<MutationCommit>,
        retain: bool,
    ) -> (SnapbackResult<MutationOutput>, Receipt) {
        // affectedTables from DECLARED writes; a function that declares none
        // yields an EXPLICITLY-unknown receipt (`affectedTables: null`),
        // never a silently-empty list (LLP 0034 §3.2 / Exact 0263 honesty).
        let affected_tables: Option<Vec<String>> = self
            .functions
            .function(name)
            .map(|function| function.write_set_summary.tables.clone())
            .filter(|tables| !tables.is_empty());
        let (outcome, rollback_reason, snapshot_version, result) = match result {
            Ok(commit) => (
                MutationReceiptOutcome::Confirmed,
                None,
                Some(commit.output.version),
                Ok(commit),
            ),
            Err(error) => match self.db.current_version() {
                Ok(version) => (
                    MutationReceiptOutcome::Rejected,
                    // The diagnostic CODE only — messages may embed argument
                    // values (§3.3 privacy).
                    Some(error.diagnostic.code.clone()),
                    Some(version),
                    Err(error),
                ),
                Err(version_error) => (
                    MutationReceiptOutcome::Rejected,
                    Some(version_error.diagnostic.code.clone()),
                    None,
                    Err(version_error),
                ),
            },
        };
        let receipt = Receipt::Mutation {
            mutation_id: receipt_mutation_id,
            mutation: name.to_owned(),
            outcome,
            rollback_reason,
            affected_tables,
            snapshot_version,
            transport: transport.to_owned(),
            correlation: correlation.unwrap_or(Value::Null),
            received_at_ms: now_millis(),
        };
        if retain {
            self.receipts.push_global(receipt.clone().into_value());
        }
        (result.map(|commit| commit.output), receipt)
    }

    /// Publish a mutation receipt without allowing a post-COMMIT admission
    /// failure to rewrite durable truth. A failed publication guard suppresses
    /// retention and caller-visible output, but an existing commit still
    /// produces a Confirmed receipt at its exact version.
    fn record_mutation_commit_after_publication_guard(
        &mut self,
        publication: MutationReceiptPublication<'_>,
        result: SnapbackResult<MutationCommit>,
    ) -> (SnapbackResult<MutationOutput>, Receipt) {
        let MutationReceiptPublication {
            name,
            transport,
            correlation,
            mutation_id,
            admission,
            effect,
        } = publication;
        match admission.effect_guard(effect) {
            Ok(_publication) => {
                self.record_mutation_commit(name, transport, correlation, mutation_id, result, true)
            }
            Err(publication_error) => {
                self.record_diagnostics(vec![publication_error.diagnostic.clone()]);
                match result {
                    Ok(commit) => {
                        let (_, receipt) = self.record_mutation_commit(
                            name,
                            transport,
                            correlation,
                            mutation_id,
                            Ok(commit),
                            false,
                        );
                        (Err(publication_error), receipt)
                    }
                    Err(_) => self.record_mutation_commit(
                        name,
                        transport,
                        correlation,
                        mutation_id,
                        Err(publication_error),
                        false,
                    ),
                }
            }
        }
    }

    /// Host-plan mutation invoked from a detached action. Plan/data iteration
    /// remains outside the action commit gate and polls the shared lifecycle;
    /// `before_commit` returns the guard held only across SQLite COMMIT.
    pub(crate) fn invoke_host_plan_mutation_guarded<G, Check, BeforeCommit>(
        &mut self,
        name: &str,
        input: HandlerInput,
        prepared: PreparedInvocation,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationOutput>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        prepared.validate_admission("nested host-plan mutation")?;
        let admission = prepared.admission_lease().clone();
        let input = prepared.canonicalize_input(input);
        let correlation = capped_correlation(input.correlation.clone());
        let receipt_mutation_id = format!("mut_{}", Uuid::now_v7().simple());
        let result = self.invoke_host_plan_mutation_commit_guarded(
            name,
            input,
            &prepared,
            check_live,
            before_commit,
        );
        self.record_mutation_commit_after_publication_guard(
            MutationReceiptPublication::new(
                name,
                "local",
                correlation,
                receipt_mutation_id,
                &admission,
            )
            .with_effect("nested mutation receipt publication"),
            result,
        )
        .0
    }

    /// Receipt retention surface (LLP 0034 §3 / ENG-22478): the bounded rings,
    /// filtered to one connection when requested. Dev/debug read — served by
    /// the admin API (LLP 0031 SystemApi class).
    pub fn receipts_snapshot(&self, connection_id: Option<&str>) -> Value {
        self.receipts.snapshot(connection_id)
    }

    fn invoke_mutation_commit_with_id_and_authority(
        &mut self,
        name: &str,
        input: HandlerInput,
        client_mutation_id: Option<String>,
        authority_descriptor: Option<AuthorityDescriptor>,
        authority: PreparedAuthority,
    ) -> SnapbackResult<MutationCommit> {
        // @ref LLP 0058#gate-algorithm — function lookup and requirement
        // enforcement precede replay-settlement lookup and every effect.
        let function = self.function(name)?.clone();
        let prepared = InvocationGate::prepare_function(authority, &function)?;
        self.persist_and_validate_prepared_service_authority(prepared.authority())?;
        refuse_unprovenanced_host_plan_authority_creation(&prepared, &function, self.db.schema())?;
        let admission = prepared.admission_lease().clone();
        let input = prepared.canonicalize_input(input);
        let identity = if let Some(id) = client_mutation_id {
            let incarnation = self.db.ensure_authorization_stream_incarnation()?;
            let expected = descriptor_for_authority(prepared.authority(), incarnation.as_str())?;
            if prepared.authority().active_mode() == AuthMode::Sessions
                || authority_descriptor.is_some()
            {
                require_current_descriptor(authority_descriptor.as_ref(), &expected)?;
            }
            Some(ClientMutationIdentity::for_authority(
                id,
                name.to_owned(),
                &input,
                expected.authority_instance_id,
            ))
        } else {
            None
        };
        if let Some(identity) = identity.as_ref()
            && let Some(output) = self.db.client_mutation_result(identity)?
        {
            return Ok(MutationCommit {
                output,
                changes: Vec::new(),
                read_dependencies: Vec::new(),
                write_dependencies: Vec::new(),
                authorization: None,
            });
        }
        // Legacy function-declared permission-epoch scopes are evaluated
        // BEFORE the mutation executes. This compatibility resync map is not
        // LLP 0053's durable global AuthorizationVersion, which advances in
        // the storage transaction hook.
        // (ENG-23329): scope evaluation can fail (missing auth user, missing
        // arg, empty scope), and an error raised after `tx.commit()` would
        // report a durably-committed mutation as rejected and skip the live
        // fan-out entirely. Failing fast here means no write ever happens for
        // a mutation whose declared epoch bumps cannot be resolved, and the
        // post-commit path below is infallible by construction.
        let epoch_scopes = evaluate_permission_epoch_scopes(&function, &input)?;
        self.ensure_permission_epoch_capacity(&epoch_scopes)?;
        let commit = match &function.runtime {
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan)) => match identity.as_ref() {
                Some(identity) => {
                    self.db
                        .execute_mutation_idempotent_guarded(plan, &input, identity, || {
                            prepared.effect_guard("idempotent mutation transaction")
                        })?
                }
                None => self.db.execute_mutation_guarded(
                    plan,
                    &input,
                    || Ok(()),
                    || prepared.effect_guard("mutation transaction"),
                )?,
            },
            FunctionRuntime::IbexModule(module) => self.runtime.invoke_ibex_mutation_prepared(
                module,
                input.clone(),
                &prepared,
                &mut self.db,
                Some(&self.warm_vms),
                identity.as_ref(),
            )?,
            _ => {
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_KIND_MISMATCH",
                    "runtime",
                    format!("{name} is not a mutation"),
                ));
            }
        };

        self.finish_mutation_commit(epoch_scopes, commit, &admission)
    }

    fn invoke_host_plan_mutation_commit_guarded<G, Check, BeforeCommit>(
        &mut self,
        name: &str,
        input: HandlerInput,
        prepared: &PreparedInvocation,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        prepared.validate_admission("nested host-plan mutation execution")?;
        self.persist_and_validate_prepared_service_authority(prepared.authority())?;
        check_live()?;
        let function = self.function(name)?.clone();
        if function.kind != FunctionKind::Mutation {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_KIND_MISMATCH",
                "runtime",
                format!("{name} is not a mutation"),
            ));
        }
        refuse_unprovenanced_host_plan_authority_creation(prepared, &function, self.db.schema())?;
        let epoch_scopes = evaluate_permission_epoch_scopes(&function, &input)?;
        self.ensure_permission_epoch_capacity(&epoch_scopes)?;
        let FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan)) = &function.runtime else {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_KIND_MISMATCH",
                "runtime",
                format!("{name} is not a host-plan mutation"),
            ));
        };
        let commit = self
            .db
            .execute_mutation_guarded(plan, &input, check_live, || {
                let admission_guard = prepared
                    .admission_lease()
                    .effect_guard("nested host-plan transaction")?;
                let caller_guard = before_commit()?;
                Ok((admission_guard, caller_guard))
            })?;
        self.finish_mutation_commit(epoch_scopes, commit, prepared.admission_lease())
    }

    fn finish_mutation_commit(
        &mut self,
        epoch_scopes: BTreeSet<String>,
        commit: MutationCommit,
        admission: &AdmissionLease,
    ) -> SnapbackResult<MutationCommit> {
        #[cfg(test)]
        BEFORE_MUTATION_POSTCOMMIT_HOOK.with(|slot| {
            if let Some(hook) = slot.borrow_mut().take() {
                hook();
            }
        });
        let frame_version = commit.output.version;
        // This is internal invalidation truth derived from the already-durable
        // commit, not an app-visible publication. Capacity was proved before
        // execution, so it must advance even if the caller's admission lease
        // ends immediately after COMMIT.
        let permission_changes = if commit.output.changed_count > 0 {
            self.advance_permission_epochs(&epoch_scopes)
        } else {
            Vec::new()
        };
        if !permission_changes.is_empty() {
            self.refresh_read_epochs();
        }
        let postcommit = (|| -> SnapbackResult<()> {
            // The transaction already committed. Re-read only to prove that
            // the durable head still names this exact frame; corruption or an
            // impossible mismatch suppresses publication but cannot turn the
            // confirmed mutation into a rejection.
            let observed = self.db.current_version()?;
            if observed != frame_version {
                return Err(SnapbackError::error(
                    "SNAPBACK_STORAGE_VERSION_CORRUPT",
                    "storage",
                    "post-commit storage head does not match the committed mutation version",
                )
                .with_details(json!({
                    "committedVersion": frame_version,
                    "observedVersion": observed,
                })));
            }
            let authorization_event = commit
                .authorization
                .as_ref()
                .filter(|authorization| authorization.event && self.auth_invalidation.is_some());
            if !permission_changes.is_empty()
                || !commit.changes.is_empty()
                || authorization_event.is_some()
            {
                self.begin_live_delivery_frame(self.subscriptions.len());
                let mut resynced = self.notify_permission_resyncs_in_frame(
                    &permission_changes,
                    frame_version,
                    admission,
                )?;
                if let Some(authorization) = authorization_event {
                    resynced.extend(self.notify_authorization_event_in_frame(
                        authorization,
                        frame_version,
                        admission,
                    )?);
                }
                if !commit.changes.is_empty() || authorization_event.is_some() {
                    self.notify_live_subscriptions_in_frame(
                        &commit.changes,
                        &resynced,
                        frame_version,
                        admission,
                    )?;
                }
            }
            Ok(())
        })();
        if let Err(error) = postcommit {
            self.record_diagnostics(vec![error.diagnostic]);
        }
        Ok(commit)
    }

    pub(crate) fn commit_detached_ibex_mutation_guarded<G, Check, BeforeCommit>(
        &mut self,
        name: &str,
        input: HandlerInput,
        binding: DetachedMutationBinding,
        executed: ExecutedIbexMutation,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationOutput>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        let admission = binding.invocation.admission_lease().clone();
        admission.validate("detached nested mutation commit")?;
        self.persist_and_validate_prepared_service_authority(binding.invocation.authority())?;
        check_live()?;
        let input = binding.invocation.canonicalize_input(input);
        let function = self.function(name)?.clone();
        if function != binding.function
            || self.db.schema() != &binding.schema
            || self.app_generation != binding.app_generation
        {
            return Err(SnapbackError::error(
                "SNAPBACK_MUTATION_CONFLICT",
                "runtime",
                format!(
                    "app code or schema changed while action-hosted mutation {name} was running"
                ),
            ));
        }
        let membership_plans = self
            .db
            .authorize_membership_commands(executed.membership_commands)?;
        self.ensure_permission_epoch_capacity(&binding.epoch_scopes)?;
        let commit = self.db.commit_buffered_writes_idempotent_guarded(
            &input,
            BufferedCommitPayload {
                writes: executed.writes,
                membership_plans,
                read_dependencies: executed.reads,
                result: executed.result,
                ctx_ledger: executed.ctx_ledger,
            },
            None,
            check_live,
            || {
                let admission_guard =
                    admission.effect_guard("detached nested mutation transaction")?;
                let caller_guard = before_commit()?;
                Ok((admission_guard, caller_guard))
            },
        )?;
        Ok(self
            .finish_mutation_commit(binding.epoch_scopes, commit, &admission)?
            .output)
    }

    /// `mutationDryRun` (LLP 0051 D8 / Increment 4): execute the mutation
    /// through the SAME tier path as a commit — the IR step loop or the real
    /// Ibex handler over the buffered ctx — and discard the writes. No epoch
    /// advance, no live fan-out, no receipt: nothing observed a change.
    ///
    /// Execution-level failures fold into the outcome (`wouldCommit: false`
    /// plus the same diagnostic a real commit would raise); `Err` here means
    /// the dry-run could not even be attempted (unknown function, wrong
    /// kind).
    ///
    /// @ref LLP 0051#d8-the-agent-surface-dry-run-becomes-cheap-and-trustworthy —
    ///   execute-and-discard on the buffered substrate with ledgers.
    pub fn dry_run_mutation(
        &mut self,
        name: &str,
        input: HandlerInput,
    ) -> SnapbackResult<MutationDryRunOutcome> {
        let authority = InvocationGate::prepare_admitted_dev_input(
            InvocationSource::LocalMutation,
            ServerProfile::Dev,
            &input,
            self.admission.admit_dev()?,
        )?;
        self.dry_run_mutation_with_authority(name, input, authority)
    }

    pub(crate) fn dry_run_mutation_with_authority(
        &mut self,
        name: &str,
        input: HandlerInput,
        authority: PreparedAuthority,
    ) -> SnapbackResult<MutationDryRunOutcome> {
        let function = self.function(name)?.clone();
        let prepared = InvocationGate::prepare_function(authority, &function)?;
        let input = prepared.canonicalize_input(input);
        let snapshot_version = self.db.current_version()?;
        let read_set_checked = !input.read_set.is_empty();
        let tier = match &function.runtime {
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(_)) => "hostPlan",
            FunctionRuntime::IbexModule(_) => "ibexModule",
            _ => {
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_KIND_MISMATCH",
                    "runtime",
                    format!("{name} is not a mutation"),
                ));
            }
        };
        // The same pre-execution gate as a real commit (ENG-23329): a
        // mutation whose declared epoch bumps cannot be resolved is denied
        // before any step executes.
        if let Err(error) = evaluate_permission_epoch_scopes(&function, &input) {
            return Ok(MutationDryRunOutcome {
                tier,
                would_commit: false,
                denied: true,
                failure: Some(error.diagnostic),
                read_set_validation: "notChecked",
                snapshot_version,
                result: Value::Null,
                changes: Vec::new(),
                read_dependencies: Vec::new(),
                ledger: None,
                diagnostics: Vec::new(),
            });
        }
        let execution = match &function.runtime {
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan)) => {
                self.db.dry_run_mutation(plan, &input).map(|execution| {
                    let mut diagnostics = Vec::new();
                    // The IR ledger honors D1's declared id bound: past it the
                    // ledger is elided (with a diagnostic), never truncated —
                    // a partial `deterministicInputs` would read as complete.
                    let ledger = if execution.generated_ids.len() > CTX_ANSWER_LEDGER_MAX_IDS {
                        diagnostics.push(
                            Diagnostic::warning(
                                "SNAPBACK_DRY_RUN_LEDGER_ELIDED",
                                "runtime",
                                format!(
                                    "dry-run generated {} ids, past the declared ledger bound ({}); deterministicInputs elided",
                                    execution.generated_ids.len(),
                                    CTX_ANSWER_LEDGER_MAX_IDS
                                ),
                            ),
                        );
                        None
                    } else {
                        Some(CtxAnswerLedger {
                            version: ctx_ledger_version(),
                            ids: execution.generated_ids,
                            now: execution.now_ms,
                            auth_fingerprint: None,
                        })
                    };
                    (execution.commit, ledger, diagnostics)
                })
            }
            FunctionRuntime::IbexModule(module) => self
                .runtime
                .dry_run_ibex_mutation_prepared(
                    module,
                    input.clone(),
                    &prepared,
                    &mut self.db,
                    Some(&self.warm_vms),
                )
                .map(|mut commit| {
                    let ledger = commit.output.ctx_ledger.take();
                    (commit, ledger, Vec::new())
                }),
            _ => unreachable!("tier matched above"),
        };
        match execution {
            Ok((commit, ledger, diagnostics)) => Ok(MutationDryRunOutcome {
                tier,
                would_commit: true,
                denied: false,
                failure: None,
                read_set_validation: if read_set_checked || !commit.read_dependencies.is_empty() {
                    "valid"
                } else {
                    "notChecked"
                },
                snapshot_version,
                result: commit.output.result.clone(),
                changes: commit.changes,
                read_dependencies: commit.read_dependencies,
                ledger,
                diagnostics,
            }),
            Err(error) => {
                // Read-set validation runs first inside the transaction, so a
                // conflict code means "stale baseline"; any later failure
                // implies the checked baseline (if any) validated.
                let stale = error.diagnostic.code == "SNAPBACK_MUTATION_CONFLICT";
                Ok(MutationDryRunOutcome {
                    tier,
                    would_commit: false,
                    denied: false,
                    failure: Some(error.diagnostic),
                    read_set_validation: if stale {
                        "stale"
                    } else if read_set_checked {
                        "valid"
                    } else {
                        "notChecked"
                    },
                    snapshot_version,
                    result: Value::Null,
                    changes: Vec::new(),
                    read_dependencies: Vec::new(),
                    ledger: None,
                    diagnostics: Vec::new(),
                })
            }
        }
    }

    /// The local-arm `generation` digest (LLP 0091 §0A.6): content-derived
    /// from the served manifests and resume-relevant config, recomputed after
    /// every ensure (`install_app_generation` clears the cache). A no-op
    /// ensure reproduces identical components and therefore an identical
    /// digest, so dev-loop ensures do not needlessly refuse tokens.
    pub fn rqs_generation_digest(&mut self) -> SnapbackResult<String> {
        if let Some(generation) = &self.rqs_generation {
            return Ok(generation.clone());
        }
        let canonical_identity = |value: &Value| -> SnapbackResult<String> {
            crate::rqs::sha256_identity(value).map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_RESUME_GENERATION_UNAVAILABLE",
                    "realtime",
                    "served manifest could not be canonically hashed for the resume generation",
                )
            })
        };
        let deployment_identity = format!("local:{}", env!("CARGO_PKG_VERSION"));
        let schema_identity = self
            .db
            .schema()
            .schema_hash
            .clone()
            .unwrap_or_else(|| "absent".to_owned());
        let manifest_value = |value: Result<Value, serde_json::Error>| -> SnapbackResult<Value> {
            value.map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_RESUME_GENERATION_UNAVAILABLE",
                    "realtime",
                    "served manifest could not be serialized for the resume generation",
                )
                .with_details(json!({ "error": error.to_string() }))
            })
        };
        let functions_identity =
            canonical_identity(&manifest_value(serde_json::to_value(&self.functions))?)?;
        let mut capability_manifest = CapabilityManifest::local_v0_instance(
            self.capability_gaps(),
            crate::runtime::outbound_actions_enabled(),
        );
        if self.warm_vms.enabled() {
            capability_manifest.vm_lifecycle =
                crate::manifest::VM_LIFECYCLE_WARM_POOLED_RESET.to_owned();
        }
        let capability_identity =
            canonical_identity(&manifest_value(serde_json::to_value(&capability_manifest))?)?;
        let auth_mode = self.db.auth_mode_snapshot()?.state.active.as_str();
        // The journal prune policy is a per-call maintenance argument rather
        // than a named durable policy; its identity stays a pinned literal
        // until that artifact exists, so changing the model rotates the
        // generation through this string. `routeManifestHash` is the served
        // route manifest's canonical hash (LLP 0092 §0C.1), or the pinned
        // "absent" literal when no route manifest is served.
        let route_manifest_hash = self
            .routes_manifest_hash
            .clone()
            .unwrap_or_else(|| "absent".to_owned());
        let resume_config = crate::rqs::resume_config_identity(
            "caller-supplied-v0",
            auth_mode,
            &route_manifest_hash,
        );
        let generation = crate::rqs::generation_digest(
            &deployment_identity,
            &schema_identity,
            &functions_identity,
            &capability_identity,
            &resume_config,
        );
        self.rqs_generation = Some(generation.clone());
        Ok(generation)
    }

    /// Install the served route→query manifest (LLP 0092 §0C.1 admission on
    /// the local arm's ensure path): shape validation, then validation
    /// against the served functions manifest. Installing (or replacing) the
    /// manifest rotates the RQS `generation` through `routeManifestHash`.
    pub fn install_routes_manifest(
        &mut self,
        manifest: crate::bundle::RoutesManifest,
    ) -> SnapbackResult<()> {
        self.validate_routes_manifest(&manifest)?;
        let value = serde_json::to_value(&manifest).map_err(|error| {
            routes_manifest_error(format!("routes manifest is not serializable: {error}"))
        })?;
        let hash = crate::rqs::sha256_identity(&value).map_err(|_| {
            routes_manifest_error("routes manifest is not canonically hashable".to_owned())
        })?;
        self.routes = Some(manifest);
        self.routes_manifest_hash = Some(hash);
        // Route-manifest identity is a `generation` component (LLP 0091
        // §0A.6 resumeConfig): outstanding tokens minted under the previous
        // route manifest refuse stale rather than resuming across it.
        self.rqs_generation = None;
        Ok(())
    }

    /// The served route manifest, if any (the bundle endpoint and tests).
    pub fn routes_manifest(&self) -> Option<&crate::bundle::RoutesManifest> {
        self.routes.as_ref()
    }

    /// LLP 0092 §0C.1 install-time validation against the served functions
    /// manifest: every named function exists and is a query; every `$param`
    /// reference targets a schema-typable top-level arg (the AST-derived
    /// per-arg decode types of §0E.6); and every arg the query's plan reads
    /// is covered by the mapping. Failures refuse the manifest with the
    /// coded load error — per 0090 D1.4, manifest presence authorizes
    /// preload selection only.
    fn validate_routes_manifest(
        &self,
        manifest: &crate::bundle::RoutesManifest,
    ) -> SnapbackResult<()> {
        crate::bundle::validate_routes_manifest_shape(manifest)
            .map_err(routes_manifest_error)?;
        if manifest.app != self.functions.app_id {
            return Err(routes_manifest_error(format!(
                "routes manifest app {:?} does not match the served functions manifest app {:?}",
                manifest.app, self.functions.app_id
            )));
        }
        for entry in &manifest.routes {
            for spec in &entry.queries {
                let Some(function) = self.functions.function(&spec.function) else {
                    return Err(routes_manifest_error(format!(
                        "route {:?} names unknown function {:?}",
                        entry.route, spec.function
                    )));
                };
                if !matches!(
                    function.kind,
                    crate::manifest::FunctionKind::Query | crate::manifest::FunctionKind::LiveQuery
                ) {
                    return Err(routes_manifest_error(format!(
                        "route {:?} names non-query function {:?}",
                        entry.route, spec.function
                    )));
                }
                let arg_types = crate::bundle::function_route_arg_types(function, self.db.schema());
                if let Value::Object(map) = &spec.args {
                    for (key, value) in map {
                        let Value::Object(inner) = value else { continue };
                        if inner.contains_key("$param") && !arg_types.contains_key(key.as_str()) {
                            return Err(routes_manifest_error(format!(
                                "route {:?} query {:?} references param into arg {:?}, which has no schema-derived string/number/boolean type",
                                entry.route, spec.function, key
                            )));
                        }
                    }
                }
                // Coverage: every arg the plan's filters read must appear in
                // the mapping (LLP 0092 §0E.6's required-arg rule, over the
                // AST-derived required set).
                if let crate::manifest::FunctionRuntime::HostPlan(
                    crate::manifest::HandlerPlan::Query(plan),
                ) = &function.runtime
                {
                    let mut required = std::collections::BTreeSet::new();
                    for filter in &plan.filters {
                        collect_value_expr_arg_names(&filter.value, &mut required);
                    }
                    for name in required {
                        let covered = matches!(&spec.args, Value::Object(map) if map.contains_key(&name));
                        if !covered {
                            return Err(routes_manifest_error(format!(
                                "route {:?} query {:?} does not cover required arg {:?}",
                                entry.route, spec.function, name
                            )));
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Mint one shared resume token at `(queryArtifact, argsHash, version,
    /// contentDigest)` (LLP 0090 D1: one mint per result-change, shared
    /// across the fan-out — the optional `cache` carries the sharing within
    /// one commit frame). Returns `None` on any mint impediment: minting is
    /// best-effort and its absence only costs a future resume.
    fn mint_resume_wire(
        &mut self,
        query_artifact: &str,
        args_hash: &str,
        version: u64,
        digest_kind: crate::rqs::DigestKind,
        content_digest: String,
    ) -> Option<ResumeWire> {
        let app = self.functions.app_id.clone();
        let generation = self.rqs_generation_digest().ok()?;
        let version_stream = self.db.data_version_stream().ok()?;
        let now = now_millis();
        let (key_id, key) = self
            .resume_keyring
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .active(now)?;
        let body = crate::rqs::ResumeTokenBody {
            app: app.clone(),
            generation: generation.clone(),
            version_stream: version_stream.clone(),
            version,
            query_artifact: query_artifact.to_owned(),
            args_hash: args_hash.to_owned(),
            digest_kind: digest_kind.as_str().to_owned(),
            content_digest: content_digest.clone(),
            issued_at: now,
            auth_partition: None,
        };
        let token = crate::rqs::mint_token_wire(key.as_ref(), &key_id, &body);
        if token.len() > crate::rqs::RESUME_TOKEN_MAX_WIRE_BYTES {
            // A token the server itself would refuse must never be minted.
            return None;
        }
        self.live_delivery.resume.tokens_minted += 1;
        Some(ResumeWire {
            token,
            meta: ResumeMeta {
                app,
                version,
                content_digest,
                generation,
                version_stream,
                query_artifact: query_artifact.to_owned(),
                args_hash: args_hash.to_owned(),
            },
        })
    }

    /// LLP 0090 D1.1 admission for a presented resume token: cryptographic
    /// verification, then every identity axis against the served instance
    /// and the subscription being opened. Any `Err` answers with rung 3
    /// under its per-cause code — never a subscribe failure.
    fn admit_resume_token(
        &mut self,
        presented: &ResumeFromToken,
        function: &FunctionDefinition,
        args: &Value,
        eligibility: Option<crate::rqs::DigestKind>,
    ) -> Result<crate::rqs::ResumeTokenBody, &'static str> {
        use crate::rqs::refusal;
        let now = now_millis();
        let body = crate::rqs::decode_and_verify(
            &presented.resume.token,
            &self
                .resume_keyring
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
            now,
            crate::rqs::RESUME_TOKEN_MAX_AGE_MS,
        )?;
        if body.auth_partition.is_some() {
            // Reserved v2 door: absent in v1 (LLP 0091 §0A.1). A partitioned
            // token cannot be admitted by a v1 server.
            return Err(refusal::TOKEN_MALFORMED);
        }
        if body.app != self.functions.app_id {
            return Err(refusal::APP_MISMATCH);
        }
        let generation = self
            .rqs_generation_digest()
            .map_err(|_| refusal::GENERATION_STALE)?;
        if body.generation != generation {
            return Err(refusal::GENERATION_STALE);
        }
        let version_stream = self
            .db
            .data_version_stream()
            .map_err(|_| refusal::STREAM_MISMATCH)?;
        if body.version_stream != version_stream {
            return Err(refusal::STREAM_MISMATCH);
        }
        let query_artifact = serde_json::to_value(function)
            .ok()
            .and_then(|value| crate::rqs::query_artifact_hash(&value).ok())
            .ok_or(refusal::QUERY_MISMATCH)?;
        if body.query_artifact != query_artifact {
            return Err(refusal::QUERY_MISMATCH);
        }
        let args_hash = crate::rqs::args_hash(args).map_err(|_| refusal::QUERY_MISMATCH)?;
        if body.args_hash != args_hash {
            return Err(refusal::QUERY_MISMATCH);
        }
        // Interim eligibility, tightened by ENG-25448 (cluster 0C).
        let Some(kind) = eligibility else {
            return Err(refusal::NOT_ELIGIBLE);
        };
        if body.digest_kind != kind.as_str()
            || !body
                .content_digest
                .starts_with(&format!("{}:", kind.as_str()))
        {
            return Err(refusal::DIGEST_KIND_MISMATCH);
        }
        let head = self
            .db
            .current_version()
            .map_err(|_| refusal::VERSION_IMPLAUSIBLE)?;
        if body.version > head {
            return Err(refusal::VERSION_IMPLAUSIBLE);
        }
        Ok(body)
    }

    /// Rung-2 delta replay for an admitted `mset1` token with a membership
    /// witness (LLP 0090 D1.3, rollout steps 5a+6). Preconditions the caller
    /// established: the token passed D1.1 admission, its `version` is within
    /// the journal floor, the query is DK-3-analyzable unordered (`mset1`),
    /// and a fresh token was mintable at head.
    ///
    /// Sequence: (1) enforce the witness caps, (2) decode fail-closed, (3)
    /// verify the witness aggregate equals the MAC-bound `contentDigest`
    /// root BEFORE any replay — token and witness are jointly verifiable and
    /// the keyed leaf defeats hash permutation, (4) diff the witnessed old
    /// membership against the current post-image result over exactly the
    /// journal-affected row ids (exits are derivable because the witness
    /// names old hashes), under the replay-vs-replace policy threshold, and
    /// (5) require the updated accumulator — witnessed leaves subtracted and
    /// post-image leaves added for affected ids only, untouched leaves kept
    /// — to reproduce the fresh head digest. Any refusal answers rung 3: a
    /// full replacement, which by construction can never suppress a removal.
    ///
    /// @ref LLP 0090#d13-replay-admission-ladder — rung-2 witness semantics
    ///   and the accumulator-update rule this implements.
    fn rqs_attempt_delta_replay(
        &self,
        witness: &crate::live_wire::MembershipWitnessWire,
        body: &crate::rqs::ResumeTokenBody,
        function: &FunctionDefinition,
        state: &RqsLiveState,
        current_rows: &[Value],
    ) -> Result<Vec<LiveDeltaWireOp>, &'static str> {
        use crate::rqs::refusal;
        let wire_bytes = serde_json::to_vec(witness)
            .map(|bytes| bytes.len())
            .unwrap_or(usize::MAX);
        if wire_bytes > self.rqs_replay_policy.max_witness_bytes {
            return Err(refusal::WITNESS_OVERSIZE);
        }
        let pairs =
            crate::rqs::decode_witness(witness, self.rqs_replay_policy.max_witness_entries)?;
        let mut accumulator = crate::rqs::witness_state(&pairs);
        if accumulator.root() != body.content_digest {
            return Err(refusal::WITNESS_ROOT_MISMATCH);
        }
        // The eligibility gate guarantees an analyzable single-table plan.
        let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &function.runtime else {
            return Err(refusal::WITNESS_INVALID);
        };
        let threshold = std::cmp::max(
            1,
            (pairs.len() as u64)
                .saturating_mul(u64::from(self.rqs_replay_policy.replay_affected_percent))
                / 100,
        ) as usize;
        let affected = self
            .db
            .changed_row_ids_for_table_since(&plan.table, body.version, threshold)
            .map_err(|_| refusal::JOURNAL_FLOOR)?;
        if affected.len() > threshold {
            return Err(refusal::POLICY_REPLACED);
        }
        let witnessed: HashMap<&str, &[u8; 32]> = pairs
            .iter()
            .map(|pair| (pair.id.as_str(), &pair.row_hash))
            .collect();
        let current_by_id: HashMap<&str, &Value> = current_rows
            .iter()
            .filter_map(|row| crate::rqs::row_wire_id(row).map(|id| (id, row)))
            .collect();
        let mut ops = Vec::new();
        for id in &affected {
            let old_hash = witnessed.get(id.as_str()).copied();
            let new_hash = state.digest.row_hash_for(id);
            match (old_hash, new_hash) {
                // Touched, but in the result on neither side (never matched
                // the predicate, or entered and left inside the gap).
                (None, None) => {}
                // Predicate exit or delete while offline: exactly removed.
                (Some(old_hash), None) => {
                    accumulator.remove_leaf(&crate::rqs::leaf(id, old_hash));
                    ops.push(LiveDeltaWireOp {
                        op: LiveDeltaOpKind::Remove,
                        id: id.clone(),
                        row: None,
                    });
                }
                // Entered the result while offline.
                (None, Some(new_hash)) => {
                    let Some(row) = current_by_id.get(id.as_str()) else {
                        return Err(refusal::WITNESS_REPLAY_DIVERGED);
                    };
                    accumulator.add_leaf(&crate::rqs::leaf(id, new_hash));
                    ops.push(LiveDeltaWireOp {
                        op: LiveDeltaOpKind::Add,
                        id: id.clone(),
                        row: Some((*row).clone()),
                    });
                }
                // Held on both sides: an op only when the content changed
                // (a touched-but-reverted row stays silent).
                (Some(old_hash), Some(new_hash)) => {
                    if old_hash != new_hash {
                        let Some(row) = current_by_id.get(id.as_str()) else {
                            return Err(refusal::WITNESS_REPLAY_DIVERGED);
                        };
                        accumulator.remove_leaf(&crate::rqs::leaf(id, old_hash));
                        accumulator.add_leaf(&crate::rqs::leaf(id, new_hash));
                        ops.push(LiveDeltaWireOp {
                            op: LiveDeltaOpKind::Update,
                            id: id.clone(),
                            row: Some((*row).clone()),
                        });
                    }
                }
            }
        }
        // The minted root must still contain every untouched witness leaf
        // and nothing else — any divergence (journal incompleteness, an
        // impure query, a wrong-but-root-matching witness) refuses to rung 3
        // instead of ratifying a wrong replay.
        if accumulator.root() != state.digest.published() {
            return Err(refusal::WITNESS_REPLAY_DIVERGED);
        }
        Ok(ops)
    }

    /// Resolve a bundle request's route entry (LLP 0092 §0C.1/§0D.1): while
    /// a route manifest is served it is the ONLY source of entries — the
    /// endpoint matches the presented pattern by string equality and the
    /// inline `devManifestEntry` form is refused by design. Without a served
    /// manifest the clearly-marked inline dev/test form is required.
    pub fn resolve_bundle_route(
        &self,
        route: &str,
        dev_manifest_entry: Option<&crate::bundle::BundleRouteEntry>,
    ) -> SnapbackResult<crate::bundle::BundleRouteEntry> {
        use crate::bundle::code;
        let refuse = |code: &'static str, message: &str| {
            SnapbackError::error(code, "realtime", message.to_owned())
        };
        match &self.routes {
            Some(manifest) => {
                if dev_manifest_entry.is_some() {
                    return Err(refuse(
                        code::ENTRY_INVALID,
                        "devManifestEntry is refused while a served route manifest exists (LLP 0092 §0C.1)",
                    ));
                }
                manifest
                    .routes
                    .iter()
                    .find(|entry| entry.route == route)
                    .cloned()
                    .ok_or_else(|| {
                        refuse(
                            code::ROUTE_UNKNOWN,
                            "route pattern is absent from the served route manifest",
                        )
                    })
            }
            None => dev_manifest_entry.cloned().ok_or_else(|| {
                refuse(
                    code::ROUTE_UNKNOWN,
                    "no served route manifest holds this route (inline devManifestEntry required on an instance serving no route manifest)",
                )
            }),
        }
    }

    /// The anonymous-read admission fact (LLP 0092 §0D.1): every query the
    /// entry names carries the codegen-compiled `publicInline` disclosure
    /// fact in the served functions manifest. Checked against the served
    /// facts, never the route-manifest author's word (0090 Authorization
    /// scope).
    pub fn bundle_entry_public_inline(&self, entry: &crate::bundle::BundleRouteEntry) -> bool {
        !entry.queries.is_empty()
            && entry.queries.iter().all(|spec| {
                self.functions
                    .function(&spec.function)
                    .is_some_and(|function| function.public_inline)
            })
    }

    /// Dev-authority read-mode bundle evaluation (the library/test seam,
    /// mirroring [`Self::subscribe_live`]). Production HTTP composition
    /// prepares its authority in the route middleware and calls
    /// `evaluate_bundle` directly.
    pub fn app_bundle_read_dev(
        &mut self,
        entry: &crate::bundle::BundleRouteEntry,
        params: &std::collections::BTreeMap<String, String>,
        request_route: &str,
        auth: &AuthInput,
    ) -> SnapbackResult<crate::bundle::BundleResponse> {
        let admission = self.admission.admit_dev()?;
        let authority = InvocationGate::prepare_admitted_authority(
            InvocationSource::HttpQuery,
            AuthMode::Dev,
            ServerProfile::Dev,
            admission,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::dev_from_auth(auth),
        )?;
        self.evaluate_bundle(entry, params, request_route, auth, &authority, None)
    }

    /// Evaluate one bundle route entry — every query at one commit cut
    /// (LLP 0090 D1.2's single-commit invariant; LLP 0092 §0D.5). On this
    /// arm the cut is the instance's exclusive borrow: every mutation path
    /// requires the same `&mut LocalSnapback` access this method holds, so
    /// no commit can fall between entry evaluations. Read mode therefore
    /// runs on the serialized lane rather than the concurrent read lane —
    /// correctness-identical to §0D.5's pinned-read-snapshot phrasing, with
    /// the read-lane concurrency left as follow-up work.
    ///
    /// Atomic failure: any coded refusal returns with **no** entry results;
    /// in register mode the caller-supplied connection's topology is purged
    /// before returning, so a failed bundle strands no server state
    /// (LLP 0031 dated amendment).
    ///
    /// @ref LLP 0092#0d2-atomicity-limits-and-the-snapback_bundle_-registry —
    ///   limits and per-cause codes; the closed per-entry union of §0D.1.
    pub(crate) fn evaluate_bundle(
        &mut self,
        entry: &crate::bundle::BundleRouteEntry,
        params: &std::collections::BTreeMap<String, String>,
        request_route: &str,
        auth: &AuthInput,
        authority: &PreparedAuthority,
        register: Option<crate::local::BundleRegisterTarget>,
    ) -> SnapbackResult<crate::bundle::BundleResponse> {
        use crate::bundle::{self, code};
        let refuse = |code: &'static str, message: &str| {
            SnapbackError::error(code, "realtime", message.to_owned())
        };
        let started = std::time::Instant::now();
        bundle::validate_entry_against_params(entry, request_route, params)
            .map_err(|code| refuse(code, "bundle route entry refused"))?;
        let commit_version = self
            .db
            .current_version()
            .map_err(|_| refuse(code::QUERY_FAILED, "bundle commit version unavailable"))?;
        let generation = self
            .rqs_generation_digest()
            .map_err(|_| refuse(code::QUERY_FAILED, "bundle generation unavailable"))?;
        let version_stream = self
            .db
            .data_version_stream()
            .map_err(|_| refuse(code::QUERY_FAILED, "bundle version stream unavailable"))?;

        let mut entries = Vec::with_capacity(entry.queries.len());
        let mut total_rows = 0_usize;
        let mut total_bytes = 0_usize;
        // Register-mode unwind: purge the freshly minted connection's whole
        // topology, retiring any auth scopes the partial registration
        // created. The connection exists only for this bundle, so purging it
        // is exactly the amendment's "strands no server state".
        let unwind = |snapback: &mut Self, error: SnapbackError| -> SnapbackError {
            if let Some(target) = &register {
                snapback.purge_connection_topology(&target.connection_id, &target.effect_fence);
            }
            error
        };
        let result = (|snapback: &mut Self| -> SnapbackResult<Vec<crate::bundle::BundleEntry>> {
            for spec in &entry.queries {
                if started.elapsed().as_millis() as u64 > bundle::BUNDLE_MAX_EVAL_MS {
                    return Err(refuse(
                        code::LIMIT_TIME,
                        "bundle evaluation wall time exceeded",
                    ));
                }
                let function = snapback
                    .function(&spec.function)
                    .map_err(|_| {
                        refuse(
                            code::ENTRY_INVALID,
                            "bundle entry names an unknown function",
                        )
                    })?
                    .clone();
                let is_query =
                    matches!(function.kind, FunctionKind::Query | FunctionKind::LiveQuery);
                if !is_query {
                    return Err(refuse(
                        code::ENTRY_INVALID,
                        "bundle entries may name queries only",
                    ));
                }
                if register.is_some() && function.kind != FunctionKind::LiveQuery {
                    return Err(refuse(
                        code::ENTRY_INVALID,
                        "register mode requires live queries",
                    ));
                }
                // Schema-driven per-arg decode (LLP 0092 §0E.6): references
                // decode by the AST-derived type of their target arg.
                let arg_types = bundle::function_route_arg_types(&function, snapback.db.schema());
                let args = bundle::substitute_params_v1(&spec.args, params, &arg_types)
                    .map_err(|code| refuse(code, "bundle args mapping refused"))?;
                let (rows, resume, subscription_id, authorization) = match &register {
                    None => {
                        let input = HandlerInput {
                            args: args.clone(),
                            auth: auth.clone(),
                            read_set: Vec::new(),
                            correlation: None,
                            ctx_ledger: None,
                        };
                        let invocation = snapback
                            .invoke_query_with_dependencies_prepared(
                                &spec.function,
                                input,
                                authority.clone(),
                            )
                            .map_err(|error| {
                                refuse(code::QUERY_FAILED, "bundle entry evaluation failed")
                                    .with_details(json!({
                                        "function": spec.function,
                                        "cause": error.diagnostic.code,
                                    }))
                            })?;
                        let rows = invocation.output.rows;
                        // `resume` presence keys on the interim `rqsEligible`
                        // predicate and nothing else (LLP 0092 §0D.1).
                        let resume = rqs_eligibility(&function).and_then(|kind| {
                            let digest = crate::rqs::ResultDigest::from_rows(kind, &rows).ok()?;
                            let query_artifact = serde_json::to_value(&function)
                                .ok()
                                .and_then(|value| crate::rqs::query_artifact_hash(&value).ok())?;
                            let args_hash = crate::rqs::args_hash(&args).ok()?;
                            snapback.mint_resume_wire(
                                &query_artifact,
                                &args_hash,
                                commit_version,
                                kind,
                                digest.published(),
                            )
                        });
                        (rows, resume, None, None)
                    }
                    Some(target) => {
                        let admission = snapback
                            .admission
                            .admit_for_mode(authority.active_mode())
                            .map_err(|error| {
                                refuse(code::QUERY_FAILED, "bundle admission unavailable")
                                    .with_details(json!({ "cause": error.diagnostic.code }))
                            })?;
                        let sub_authority = InvocationGate::prepare_admitted_authority(
                            InvocationSource::LiveInitialQuery,
                            authority.active_mode(),
                            authority.profile(),
                            admission,
                            &WireAuthorityFields::default(),
                            authority.resolved().clone(),
                        )
                        .map_err(|error| {
                            refuse(code::QUERY_FAILED, "bundle register authority refused")
                                .with_details(json!({ "cause": error.diagnostic.code }))
                        })?;
                        let sub_input = LiveSubscribeInput {
                            connection_id: target.connection_id.clone(),
                            input: HandlerInput {
                                args: args.clone(),
                                auth: auth.clone(),
                                read_set: Vec::new(),
                                correlation: None,
                                ctx_ledger: None,
                            },
                            authorization_namespace: None,
                            supersedes: None,
                            resume_from_token: None,
                        };
                        let invalidation = LiveInvalidationAdmission {
                            connection: target.invalidation_connection.clone(),
                            effect_fence: Some(target.effect_fence.clone()),
                            #[cfg(test)]
                            session_mode: false,
                        };
                        let output = snapback
                            .subscribe_live_prepared_with_invalidation(
                                &spec.function,
                                sub_input,
                                sub_authority,
                                invalidation,
                            )
                            .map_err(|error| {
                                refuse(code::QUERY_FAILED, "bundle registration failed")
                                    .with_details(json!({
                                        "function": spec.function,
                                        "cause": error.diagnostic.code,
                                    }))
                            })?;
                        let rows = output
                            .snapshot
                            .map(|snapshot| snapshot.rows)
                            .unwrap_or_default();
                        let authorization = output.authorization_scope.as_ref().map(|scope| {
                            json!({
                                "scope": scope,
                                "invalidation": output.authorization_invalidation,
                            })
                        });
                        (
                            rows,
                            output.resume,
                            Some(output.subscription_id),
                            authorization,
                        )
                    }
                };
                total_rows += rows.len();
                if total_rows > bundle::BUNDLE_MAX_ROWS {
                    return Err(refuse(code::LIMIT_ROWS, "bundle row limit exceeded"));
                }
                total_bytes += serde_json::to_vec(&rows)
                    .map(|bytes| bytes.len())
                    .unwrap_or(0);
                if total_bytes > bundle::BUNDLE_MAX_BYTES {
                    return Err(refuse(code::LIMIT_BYTES, "bundle byte limit exceeded"));
                }
                if started.elapsed().as_millis() as u64 > bundle::BUNDLE_MAX_EVAL_MS {
                    return Err(refuse(
                        code::LIMIT_TIME,
                        "bundle evaluation wall time exceeded",
                    ));
                }
                entries.push(crate::bundle::BundleEntry {
                    function: spec.function.clone(),
                    args,
                    rows,
                    resume,
                    subscription_id,
                    authorization,
                });
            }
            Ok(entries)
        })(self);
        let entries = match result {
            Ok(entries) => entries,
            Err(error) => return Err(unwind(self, error)),
        };
        Ok(crate::bundle::BundleResponse {
            commit_version,
            generation,
            version_stream,
            entries,
            connection: None,
        })
    }

    pub fn subscribe_live(
        &mut self,
        name: &str,
        input: LiveSubscribeInput,
    ) -> SnapbackResult<LiveSubscribeOutput> {
        let admission = self.admission.admit_dev()?;
        let authority = InvocationGate::prepare_admitted_authority(
            InvocationSource::LiveInitialQuery,
            AuthMode::Dev,
            ServerProfile::Dev,
            admission,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::dev_from_auth(&input.input.auth),
        )?;
        self.subscribe_live_prepared_with_invalidation(
            name,
            input,
            authority,
            LiveInvalidationAdmission::default(),
        )
    }

    // Compatibility seam for direct prepared callers; production needs the
    // richer invalidation admission and calls the method below.
    #[allow(dead_code)]
    pub(crate) fn subscribe_live_prepared(
        &mut self,
        name: &str,
        input: LiveSubscribeInput,
        authority: PreparedAuthority,
    ) -> SnapbackResult<LiveSubscribeOutput> {
        self.subscribe_live_prepared_with_invalidation(
            name,
            input,
            authority,
            LiveInvalidationAdmission::default(),
        )
    }

    /// Compatibility scaffold for protocol unit tests. Production composition
    /// always supplies a server-prepared authority through the method below.
    #[cfg(test)]
    pub(crate) fn subscribe_live_with_invalidation(
        &mut self,
        name: &str,
        input: LiveSubscribeInput,
        invalidation: LiveInvalidationAdmission,
    ) -> SnapbackResult<LiveSubscribeOutput> {
        let active_mode = if invalidation.session_mode {
            AuthMode::Sessions
        } else {
            AuthMode::Dev
        };
        let resolved = if active_mode == AuthMode::Sessions {
            ResolvedAppAuthority::Anonymous
        } else {
            ResolvedAppAuthority::dev_from_auth(&input.input.auth)
        };
        let authority = InvocationGate::prepare_authority(
            InvocationSource::LiveInitialQuery,
            active_mode,
            ServerProfile::Test,
            0,
            0,
            &WireAuthorityFields::default(),
            resolved,
        )?;
        self.subscribe_live_prepared_with_invalidation(name, input, authority, invalidation)
    }

    fn stage_local_live_effect<T>(
        &mut self,
        connection_id: String,
        effect_fence: crate::ephemeral::ConnectionEffectFence,
        reserved_subscription_slots: usize,
        reservation_keys: impl IntoIterator<Item = String>,
        plan: T,
    ) -> SnapbackResult<StagedLocalLiveEffect<T>> {
        let stale_stage_ids = self
            .pending_local_live_effects
            .iter()
            .filter_map(|(stage_id, registration)| {
                let stale = registration.control.upgrade().is_none_or(|control| {
                    matches!(
                        control.state.load(Ordering::Acquire),
                        LOCAL_LIVE_STAGE_ABANDONED
                            | LOCAL_LIVE_STAGE_TERMINAL
                            | LOCAL_LIVE_STAGE_FINALIZED
                    )
                });
                stale.then(|| stage_id.clone())
            })
            .collect::<Vec<_>>();
        for stage_id in stale_stage_ids {
            self.pending_local_live_effects.remove(&stage_id);
        }
        if self.pending_local_live_effects.len() >= MAX_PENDING_LOCAL_LIVE_EFFECTS {
            return Err(SnapbackError::error(
                "SNAPBACK_LIVE_STAGE_CAPACITY",
                "realtime",
                "the pending local live-effect registry is at capacity",
            )
            .with_details(json!({ "limit": MAX_PENDING_LOCAL_LIVE_EFFECTS })));
        }
        let reservation_keys = reservation_keys.into_iter().collect::<BTreeSet<_>>();
        if self
            .pending_local_live_effects
            .values()
            .any(|registration| !registration.reservation_keys.is_disjoint(&reservation_keys))
        {
            return Err(SnapbackError::error(
                "SNAPBACK_LIVE_STAGE_CONFLICT",
                "realtime",
                "another staged live effect owns the same subscription or obligation precondition",
            ));
        }
        if reserved_subscription_slots > 0 {
            let pending_global = self
                .pending_local_live_effects
                .values()
                .map(|registration| registration.reserved_subscription_slots)
                .sum::<usize>();
            if self
                .subscriptions
                .len()
                .saturating_add(pending_global)
                .saturating_add(reserved_subscription_slots)
                > MAX_LIVE_SUBSCRIPTIONS
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT",
                    "realtime",
                    format!(
                        "the durable subscription registry is limited to {MAX_LIVE_SUBSCRIPTIONS} rows"
                    ),
                )
                .with_details(json!({ "limit": MAX_LIVE_SUBSCRIPTIONS })));
            }
            let published_connection = self
                .subscriptions
                .values()
                .filter(|subscription| subscription.connection_id == connection_id)
                .count();
            let pending_connection = self
                .pending_local_live_effects
                .values()
                .filter(|registration| registration.connection_id == connection_id)
                .map(|registration| registration.reserved_subscription_slots)
                .sum::<usize>();
            if published_connection
                .saturating_add(pending_connection)
                .saturating_add(reserved_subscription_slots)
                > MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT",
                    "realtime",
                    format!(
                        "one connection is limited to {MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION} durable subscriptions"
                    ),
                )
                .with_details(json!({ "limit": MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION })));
            }
        }
        let stage_id = format!("live_stage_{}", Uuid::now_v7().simple());
        let control = Arc::new(LocalLiveStageControl {
            state: AtomicU8::new(LOCAL_LIVE_STAGE_PENDING),
            connection_id: connection_id.clone(),
            effect_fence: effect_fence.clone(),
        });
        let replaced = self.pending_local_live_effects.insert(
            stage_id.clone(),
            PendingLocalLiveEffectRegistration {
                connection_id,
                effect_fence,
                reserved_subscription_slots,
                reservation_keys,
                control: Arc::downgrade(&control),
            },
        );
        debug_assert!(replaced.is_none(), "UUIDv7 live stage id was reused");
        Ok(StagedLocalLiveEffect {
            stage_id,
            control,
            plan: Arc::new(plan),
        })
    }

    fn claim_local_live_effect<T>(
        &mut self,
        stage: &StagedLocalLiveEffect<T>,
    ) -> SnapbackResult<LocalLiveFinalizationClaim> {
        let registered = self
            .pending_local_live_effects
            .get(&stage.stage_id)
            .and_then(|registration| registration.control.upgrade())
            .is_some_and(|control| Arc::ptr_eq(&control, &stage.control));
        if !registered {
            return Err(local_live_stage_unavailable());
        }
        match stage.control.state.compare_exchange(
            LOCAL_LIVE_STAGE_COMMITTED,
            LOCAL_LIVE_STAGE_FINALIZING,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => Ok(LocalLiveFinalizationClaim {
                control: stage.control.clone(),
                completed: false,
            }),
            Err(LOCAL_LIVE_STAGE_ABANDONED | LOCAL_LIVE_STAGE_TERMINAL) => {
                Err(local_live_stage_unavailable())
            }
            Err(_) => Err(local_live_stage_corrupt()),
        }
    }

    fn complete_local_live_effect<T>(
        &mut self,
        stage: &StagedLocalLiveEffect<T>,
        claim: LocalLiveFinalizationClaim,
    ) -> SnapbackResult<()> {
        let registered = self
            .pending_local_live_effects
            .get(&stage.stage_id)
            .and_then(|registration| registration.control.upgrade())
            .is_some_and(|control| Arc::ptr_eq(&control, &stage.control));
        if !registered || !Arc::ptr_eq(&claim.control, &stage.control) {
            return Err(local_live_stage_corrupt());
        }
        claim.complete()?;
        self.pending_local_live_effects.remove(&stage.stage_id);
        Ok(())
    }

    pub(crate) fn abandon_prepared_live_effect<T>(&mut self, stage: &StagedLocalLiveEffect<T>) {
        stage.abandon();
        if matches!(
            stage.control.state.load(Ordering::Acquire),
            LOCAL_LIVE_STAGE_ABANDONED | LOCAL_LIVE_STAGE_TERMINAL
        ) {
            self.pending_local_live_effects.remove(&stage.stage_id);
        }
    }

    #[cfg(test)]
    pub(crate) fn staged_live_effect_counts_for_test(&self) -> (usize, usize) {
        (
            self.pending_local_live_effects.len(),
            self.subscriptions.len(),
        )
    }

    fn finalize_prepared_live_effect<T: Clone, R>(
        &mut self,
        stage: &StagedLocalLiveEffect<T>,
        operation: impl FnOnce(&mut Self, T) -> SnapbackResult<R>,
    ) -> SnapbackResult<R> {
        let claim = self.claim_local_live_effect(stage)?;
        let plan = stage.plan().clone();
        let result = operation(self, plan);
        // An operation error is a consumed connection act, not a retryable
        // committed stage. Marking it finalized also releases reservations.
        self.complete_local_live_effect(stage, claim)?;
        result
    }

    fn terminalize_local_live_effects(
        &mut self,
        connection_id: &str,
        effect_fence: Option<&crate::ephemeral::ConnectionEffectFence>,
    ) {
        let terminal_stage_ids = self
            .pending_local_live_effects
            .iter()
            .filter(|(_, registration)| {
                registration.connection_id == connection_id
                    && effect_fence.is_none_or(|expected| &registration.effect_fence == expected)
            })
            .map(|(stage_id, _)| stage_id.clone())
            .collect::<Vec<_>>();
        for stage_id in terminal_stage_ids {
            if let Some(registration) = self.pending_local_live_effects.remove(&stage_id)
                && let Some(control) = registration.control.upgrade()
            {
                loop {
                    let observed = control.state.load(Ordering::Acquire);
                    if matches!(
                        observed,
                        LOCAL_LIVE_STAGE_ABANDONED
                            | LOCAL_LIVE_STAGE_TERMINAL
                            | LOCAL_LIVE_STAGE_FINALIZED
                    ) {
                        break;
                    }
                    if observed == LOCAL_LIVE_STAGE_FINALIZING {
                        // Finalization and topology purge both require
                        // `&mut LocalSnapback`, so this state cannot be
                        // observed by another local owner.
                        debug_assert!(false, "live stage finalization overlapped terminal purge");
                        break;
                    }
                    if control
                        .state
                        .compare_exchange(
                            observed,
                            LOCAL_LIVE_STAGE_TERMINAL,
                            Ordering::AcqRel,
                            Ordering::Acquire,
                        )
                        .is_ok()
                    {
                        break;
                    }
                }
            }
        }
    }

    fn terminalize_all_local_live_effects(&mut self) {
        let registrations = std::mem::take(&mut self.pending_local_live_effects);
        for registration in registrations.into_values() {
            if let Some(control) = registration.control.upgrade() {
                let _ =
                    control
                        .state
                        .fetch_update(
                            Ordering::AcqRel,
                            Ordering::Acquire,
                            |observed| match observed {
                                LOCAL_LIVE_STAGE_PENDING | LOCAL_LIVE_STAGE_COMMITTED => {
                                    Some(LOCAL_LIVE_STAGE_TERMINAL)
                                }
                                _ => None,
                            },
                        );
            }
        }
    }

    pub(crate) fn subscribe_live_prepared_with_invalidation(
        &mut self,
        name: &str,
        input: LiveSubscribeInput,
        authority: PreparedAuthority,
        invalidation: LiveInvalidationAdmission,
    ) -> SnapbackResult<LiveSubscribeOutput> {
        if authority.source() != InvocationSource::LiveInitialQuery {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_SOURCE_INVALID",
                "auth",
                "live subscribe requires LiveInitialQuery authority",
            ));
        }
        authority.validate_admission("live subscribe preparation")?;
        let effect_fence = invalidation.effect_fence.clone();
        let authority_subject = authority.resolved().invalidation_subject();
        let function = self.function(name)?.clone();
        if function.kind != FunctionKind::LiveQuery {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_NOT_LIVE",
                "runtime",
                format!("{name} is not a live query"),
            ));
        }
        let prepared_invocation = InvocationGate::prepare_function(authority.clone(), &function)?;
        let retained_authority = prepared_invocation.retain_live_owner()?;
        self.prepare_live_rerun_authority(
            &retained_authority,
            authority.admission_lease().clone(),
        )?;
        let publication_authority = authority.clone();
        // @ref LLP 0053#invalidation-is-an-obligation-not-a-message — an
        // auth-scoped live subscription is admitted only when its connection
        // negotiated the exact protocol and supplied a stable query namespace.
        self.touch_connection(&input.connection_id, now_millis());
        let auth_scoped =
            authority.active_mode() == AuthMode::Sessions && !function.authority_independent;
        if auth_scoped && self.auth_invalidation.is_none() {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                "auth",
                "session-mode auth-scoped live queries require the installed invalidation protocol",
            ));
        }
        let authorization_admission = if auth_scoped {
            let connection = invalidation.connection.ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
                    "auth",
                    "auth-scoped live queries require authInvalidationProtocol: 1",
                )
            })?;
            if connection.protocol_version
                != crate::auth::invalidation::AUTH_INVALIDATION_PROTOCOL_VERSION
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
                    "auth",
                    "auth-scoped live queries require authInvalidationProtocol: 1",
                ));
            }
            let namespace = input.authorization_namespace.clone().ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED",
                    "auth",
                    "auth-scoped live queries require authorizationNamespace",
                )
            })?;
            namespace.validate()?;
            let state = self
                .auth_invalidation
                .as_ref()
                .expect("auth-scoped admission checked installed state");
            if !state.accepts_connection(&connection) {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
                    "auth",
                    "connection invalidation expectation is not current",
                ));
            }
            Some((connection, namespace))
        } else {
            None
        };

        let subscription_input = retained_authority.canonicalize_input(input.input);

        // RQS eligibility + token admission (LLP 0090 D1.1 / rollout step 1).
        // Eligibility keys minting AND admission alike; auth-scoped
        // subscriptions can never be eligible, so minting is suppressed for
        // them by construction. Every token refusal answers with rung 3.
        let rqs_eligibility = rqs_eligibility(&function);
        let mut resume_refusal: Option<&'static str> = None;
        let mut admitted_resume: Option<crate::rqs::ResumeTokenBody> = None;
        if let Some(presented) = input.resume_from_token.as_ref() {
            self.live_delivery.resume.attempted += 1;
            match self.admit_resume_token(
                presented,
                &function,
                &subscription_input.args,
                rqs_eligibility,
            ) {
                Ok(body) => admitted_resume = Some(body),
                Err(code) => {
                    resume_refusal = Some(code);
                    *self
                        .live_delivery
                        .resume
                        .refused
                        .entry(code.to_owned())
                        .or_default() += 1;
                }
            }
        }

        // A valid explicit supersession is a net-zero replacement. Identify
        // it before admission, but do not remove it until the new snapshot
        // succeeds: a query failure must leave the old live authority intact.
        // Unknown ids remain the protocol's documented quiet no-op and do not
        // release capacity. Known foreign owners fail closed.
        let superseded_subscription_id = match input.supersedes.as_ref() {
            Some(old_id) => match self.subscriptions.get(old_id) {
                Some(existing)
                    if existing.connection_id == input.connection_id
                        && existing.is_owned_by(&authority, effect_fence.as_ref()) =>
                {
                    Some(old_id.clone())
                }
                Some(existing) => return Err(live_owner_mismatch(&existing.id)),
                None => None,
            },
            None => None,
        };
        let release = usize::from(superseded_subscription_id.is_some());

        // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — retained
        // resource tables must have hard refusal limits. Check before running
        // the initial query so a caller at capacity cannot spend handler/DB
        // work on a snapshot the server is forbidden to retain.
        if self.subscriptions.len().saturating_sub(release) >= MAX_LIVE_SUBSCRIPTIONS {
            return Err(SnapbackError::error(
                "SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT",
                "realtime",
                format!(
                    "the durable subscription registry is limited to {MAX_LIVE_SUBSCRIPTIONS} rows"
                ),
            )
            .with_details(json!({ "limit": MAX_LIVE_SUBSCRIPTIONS })));
        }
        let connection_subscriptions = self
            .subscriptions
            .values()
            .filter(|subscription| subscription.connection_id == input.connection_id)
            .count()
            .saturating_sub(release);
        if connection_subscriptions >= MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION {
            return Err(SnapbackError::error(
                "SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT",
                "realtime",
                format!(
                    "one connection is limited to {MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION} durable subscriptions"
                ),
            )
            .with_details(json!({
                "limit": MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION,
            })));
        }

        let query = execute_query_invocation(
            &function,
            name,
            DbRead::Live(&self.db),
            &self.permission_epochs,
            subscription_input.clone(),
            &prepared_invocation,
            Some(&self.warm_vms),
            Some(RelationalCursorAuthority {
                app_id: &self.functions.app_id,
                keyring: &self.resume_keyring,
            }),
        )?;
        let permission_epochs = permission_epochs_from_dependencies(&query.read_dependencies);

        // Server-held RQS digest state for eligible subscriptions, the fresh
        // token, and the admission-ladder rung (LLP 0090 D1.3, rungs 1 & 3).
        // Everything from proof to registration happens under this one &mut
        // cut — the local arm's serialization cut — so no commit can fall
        // between proof, registration, and the answer (the atomicity rule).
        let head_version = query.output.version;
        let rqs_state = rqs_eligibility.and_then(|kind| {
            let query_artifact = serde_json::to_value(&function)
                .ok()
                .and_then(|value| crate::rqs::query_artifact_hash(&value).ok());
            let args_hash = crate::rqs::args_hash(&subscription_input.args).ok();
            match (
                query_artifact,
                args_hash,
                crate::rqs::ResultDigest::from_rows(kind, &query.output.rows),
            ) {
                (Some(query_artifact), Some(args_hash), Ok(digest)) => Some(RqsLiveState {
                    query_artifact,
                    args_hash,
                    digest,
                }),
                _ => {
                    // Mint-time refusal (LLP 0091 §0A.2): no token, never a
                    // wrong digest.
                    self.live_delivery.resume.mint_refusals += 1;
                    None
                }
            }
        });
        let mut fresh_resume = rqs_state.as_ref().and_then(|state| {
            self.mint_resume_wire(
                &state.query_artifact,
                &state.args_hash,
                head_version,
                state.digest.kind,
                state.digest.published(),
            )
        });
        let mut answer_current_as_of = false;
        let mut answer_delta: Option<Vec<LiveDeltaWireOp>> = None;
        if let Some(body) = admitted_resume.as_ref() {
            let distance = head_version.saturating_sub(body.version);
            self.live_delivery.resume.last_journal_distance = distance;
            self.live_delivery.resume.max_journal_distance =
                self.live_delivery.resume.max_journal_distance.max(distance);
            let current_digest = rqs_state.as_ref().map(|state| state.digest.published());
            let refuse = |stats: &mut LiveDeliveryStats, code: &'static str| {
                *stats.resume.refused.entry(code.to_owned()).or_default() += 1;
                Some(code)
            };
            if body.version == head_version
                && current_digest.as_deref() == Some(body.content_digest.as_str())
                && fresh_resume.is_some()
            {
                // Rung 1, global no-commit proof: nothing committed since the
                // token's version, so the caller's held rows are current.
                answer_current_as_of = true;
            } else if body.version == head_version {
                // Same version, different digest: the result is not a pure
                // function of (state, args) after all — fail closed to rung 3
                // (counted under the policy-replacement code; the registry
                // has no more specific cause).
                resume_refusal = refuse(
                    &mut self.live_delivery,
                    crate::rqs::refusal::POLICY_REPLACED,
                );
            } else {
                match self.journal_resume_requires_resnapshot(body.version) {
                    Ok(false) => {
                        // The journal floor holds. Rung 2 (LLP 0090 D1.3,
                        // steps 5a+6): a DK-3-analyzable unordered (`mset1`)
                        // query with a client membership witness replays
                        // exact deltas; without a witness (or for `seq1`)
                        // the rung-1 table-set arm still always falls
                        // through to rung 3 — no complete certified
                        // dependency-summary artifact exists yet (cluster
                        // 0C) — under its own telemetry cause.
                        let witness = input
                            .resume_from_token
                            .as_ref()
                            .and_then(|presented| presented.membership_witness.as_ref());
                        let replay = match (witness, rqs_state.as_ref(), fresh_resume.as_ref()) {
                            (Some(witness), Some(state), Some(_))
                                if state.digest.kind == crate::rqs::DigestKind::Mset1 =>
                            {
                                Some(self.rqs_attempt_delta_replay(
                                    witness,
                                    body,
                                    &function,
                                    state,
                                    &query.output.rows,
                                ))
                            }
                            _ => None,
                        };
                        match replay {
                            Some(Ok(ops)) if ops.is_empty() => {
                                // Every journal-affected row reverted or
                                // never intersected the result: the held
                                // rows are current at head — the verified
                                // witness upgrades the answer to rung 1.
                                answer_current_as_of = true;
                            }
                            Some(Ok(ops)) => answer_delta = Some(ops),
                            Some(Err(code)) => {
                                resume_refusal = refuse(&mut self.live_delivery, code);
                            }
                            None => {
                                self.live_delivery.resume.no_certified_summary += 1;
                            }
                        }
                    }
                    _ => {
                        resume_refusal =
                            refuse(&mut self.live_delivery, crate::rqs::refusal::JOURNAL_FLOOR);
                    }
                }
            }
        }
        if input.resume_from_token.is_some() {
            if answer_current_as_of {
                self.live_delivery.resume.current_as_of_answers += 1;
            } else if answer_delta.is_some() {
                self.live_delivery.resume.delta_replay_answers += 1;
            } else {
                self.live_delivery.resume.fresh_replace_answers += 1;
            }
        }
        // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S2:
        // subscription ids are unguessable bearer capabilities, not enumerable
        // counters; they share the runtime's UUIDv7 id source.
        let subscription_id = format!("sub_{}", Uuid::now_v7().simple());
        let _publication = publication_authority.effect_guard("live subscribe publication")?;
        self.touch_connection(&input.connection_id, now_millis());
        let mut authorization_scope = None;
        let mut authorization_invalidation = None;
        let mut scope_retirements = Vec::new();
        let mut registered_scope_cleanup = None;
        let subscription_authorization =
            if let Some((connection, namespace)) = authorization_admission {
                let state = self
                    .auth_invalidation
                    .as_mut()
                    .expect("auth-scoped admission checked installed state");
                let scope_id = ScopeId::Subscription {
                    issuer_id: connection.issuer_id.clone(),
                    namespace: namespace.clone(),
                    scope_sequence: state.issuer.reserve_scope_sequence()?,
                    connection_generation: connection.connection_generation,
                    subscription_id: subscription_id.clone(),
                };
                let connection_scope = ScopeId::Connection {
                    issuer_id: connection.issuer_id,
                    connection_generation: connection.connection_generation,
                };
                let owner_continuity_id = format!("owner_{}", Uuid::now_v7().simple());
                let registration = (|| {
                    state
                        .obligations
                        .register_live_scope(scope_id.clone(), owner_continuity_id.clone())?;
                    let inherited = state
                        .obligations
                        .register_connection_child(&connection_scope, scope_id.clone())?
                        .is_some();
                    #[cfg(test)]
                    if FAIL_NEXT_LIVE_SCOPE_REGISTRATION.with(|fail| fail.replace(false)) {
                        return Err(SnapbackError::error(
                            "SNAPBACK_TEST_LIVE_SCOPE_REGISTRATION_FAILED",
                            "test",
                            "injected failure after live scope child registration",
                        ));
                    }
                    if inherited {
                        let witness = CompositeWitness {
                            authorization: state.obligations.expectation().authorization.clone(),
                            data: Some(DataWitness {
                                version_stream: state.version_stream.clone(),
                                min_commit_version: query.output.version,
                            }),
                        };
                        state.obligations.issue_resolution(
                            &scope_id,
                            ResolutionKind::Snapshot,
                            witness,
                        )?;
                        authorization_invalidation = state.obligations.projection(&scope_id);
                    }
                    Ok::<(), SnapbackError>(())
                })();
                if let Err(error) = registration {
                    state
                        .obligations
                        .rollback_unpublished_live_scope(&scope_id, &connection_scope);
                    return Err(error);
                }
                registered_scope_cleanup = Some((scope_id.clone(), connection_scope));
                authorization_scope = Some(scope_id.clone());
                Some(LiveSubscriptionAuthorization {
                    scope_id,
                    namespace,
                    authority_subject,
                    owner_continuity_id,
                })
            } else {
                None
            };

        // Superseded-subscription GC, EXPLICIT protocol (LLP 0034 §10.1
        // residual; ENG-22478 review fix A): the kit names the subscription
        // its own resubscribe replaces and the server disposes exactly that
        // id — never inferred from matching identity, so two legitimate
        // identical subscribers (two components sharing a query on one
        // connection) coexist. An unknown id is a quiet no-op: reconnects
        // race disconnect teardown, which may have dropped it already.
        if let Some(old_id) = superseded_subscription_id {
            let retired_scope = self
                .subscriptions
                .get(&old_id)
                .and_then(|subscription| subscription.authorization.as_ref())
                .cloned()
                .map(|authorization| authorization.scope_id);
            let prepared_retirement =
                match (self.auth_invalidation.as_ref(), retired_scope.as_ref()) {
                    (Some(state), Some(scope)) => {
                        match state.prepare_scope_retirement_authenticated(scope) {
                            Ok((candidate, retirement)) => {
                                Some((scope.clone(), candidate, retirement))
                            }
                            Err(error) => {
                                if let (Some(state), Some((scope, connection_scope))) = (
                                    self.auth_invalidation.as_mut(),
                                    registered_scope_cleanup.as_ref(),
                                ) {
                                    state
                                        .obligations
                                        .rollback_unpublished_live_scope(scope, connection_scope);
                                }
                                return Err(error);
                            }
                        }
                    }
                    _ => None,
                };
            self.subscriptions.remove(&old_id);
            if let (Some(state), Some((scope, candidate, retirement))) =
                (self.auth_invalidation.as_mut(), prepared_retirement)
            {
                state.commit_scope_retirement(&scope, &candidate);
                scope_retirements.extend(retirement);
            }
            let receipt = Receipt::Subscription {
                event: SubscriptionReceiptEvent::Disposed,
                reason: Some("superseded".to_owned()),
                subscription_id: Some(old_id),
                superseded_by: Some(subscription_id.clone()),
                lane: None,
                binding_id: None,
                collection: None,
                removed: None,
                scope: subscription_input.args.clone(),
                snapshot_version: Some(query.output.version),
                correlation: None,
                received_at_ms: now_millis(),
            }
            .into_value();
            self.receipts.push_connection(&input.connection_id, receipt);
        }

        if subscription_authorization.is_some() {
            // Publish demand before the durable-live registration becomes
            // externally visible. A transient false positive only takes the
            // conservative writer path; a false negative could skip a
            // required level-triggered rerun.
            self.premark_auth_scoped_live_connection(&input.connection_id);
        }
        self.subscriptions.insert(
            subscription_id.clone(),
            LiveSubscription {
                id: subscription_id.clone(),
                connection_id: input.connection_id.clone(),
                function: name.to_owned(),
                authority: retained_authority,
                input: subscription_input.clone(),
                read_dependencies: query.read_dependencies,
                authorization: subscription_authorization,
                effect_fence,
                rqs: rqs_state,
            },
        );
        self.refresh_auth_scoped_live_connections();
        // A new subscription can arm a demand-gated cron job (L5).
        self.refresh_cron_active();

        // Server half of the 'established' receipt (LLP 0034 §3.2): scope is
        // REQUIRED (the subscription's routing/scope args); the adapter's
        // opaque correlation is echoed verbatim; transport is a kit fact and
        // is stitched there.
        let receipt = Receipt::Subscription {
            event: SubscriptionReceiptEvent::Established,
            reason: None,
            subscription_id: Some(subscription_id.clone()),
            superseded_by: None,
            lane: None,
            binding_id: None,
            collection: None,
            removed: None,
            scope: subscription_input.args.clone(),
            snapshot_version: Some(query.output.version),
            // Always present on established receipts (null when the adapter
            // sent none) — the pre-typed wire emitted the key unconditionally.
            correlation: Some(
                capped_correlation(subscription_input.correlation.clone()).unwrap_or(Value::Null),
            ),
            received_at_ms: now_millis(),
        };
        self.receipts
            .push_connection(&input.connection_id, receipt.clone().into_value());

        // Rung-1 answer: enqueue the `current_as_of` durable envelope (with
        // its mandatory fresh token) in the same &mut cut that registered the
        // subscription, and omit rows from the subscribe output entirely —
        // the caller's held rows are current as of `head_version`.
        let answered_without_rows = answer_current_as_of || answer_delta.is_some();
        if answer_current_as_of {
            let envelope = LiveEnvelope::CurrentAsOf {
                subscription_id: subscription_id.clone(),
                function: name.to_owned(),
                version: head_version,
                resume: fresh_resume
                    .take()
                    .expect("rung-1 admission requires a minted fresh token"),
            };
            if let Ok(payload) = serde_json::to_vec(&envelope)
                && let Some(subscription) = self.subscriptions.get(&subscription_id)
            {
                self.enqueue_subscription_durable(subscription, payload);
            }
        } else if let Some(ops) = answer_delta.take() {
            // Rung-2 answer (LLP 0090 D1.3): the exact replay frame — with
            // its mandatory fresh token minted from the updated accumulator
            // — rides the durable lane inside the same registration cut; the
            // subscribe output carries no rows.
            self.live_delivery.resume.replay_ops += ops.len() as u64;
            // Bytes-avoided estimate compares payload content only (rows vs
            // ops); envelope overhead and the fresh token are identical
            // between a rung-2 and a rung-3 answer.
            let replaced_bytes = serde_json::to_vec(&query.output.rows)
                .map(|bytes| bytes.len() as u64)
                .unwrap_or(0);
            let replay_bytes = serde_json::to_vec(&ops)
                .map(|bytes| bytes.len() as u64)
                .unwrap_or(replaced_bytes);
            self.live_delivery.resume.replay_bytes_avoided +=
                replaced_bytes.saturating_sub(replay_bytes);
            let envelope = LiveEnvelope::LiveDelta {
                subscription_id: subscription_id.clone(),
                function: name.to_owned(),
                version: head_version,
                ops,
                resume: Some(
                    fresh_resume
                        .take()
                        .expect("rung-2 admission requires a minted fresh token"),
                ),
            };
            if let Ok(payload) = serde_json::to_vec(&envelope)
                && let Some(subscription) = self.subscriptions.get(&subscription_id)
            {
                self.enqueue_subscription_durable(subscription, payload);
            }
        }

        Ok(LiveSubscribeOutput {
            subscription_id,
            snapshot: (!answered_without_rows).then_some(query.output),
            resume: fresh_resume,
            resume_refusal: resume_refusal.map(str::to_owned),
            permission_epochs,
            receipt: Some(receipt),
            authorization_scope,
            authorization_invalidation,
            scope_retirements,
        })
    }

    /// Reserve a connection-bound subscribe without running the initial query
    /// or mutating live/obligation state. The query runs only after the exact
    /// connection act commits, so pending subscriptions cannot miss mutation
    /// fanout between preparation and publication.
    pub(crate) fn prepare_subscribe_live_for_transport(
        &mut self,
        name: String,
        input: LiveSubscribeInput,
        authority: PreparedAuthority,
        invalidation: LiveInvalidationAdmission,
    ) -> SnapbackResult<PreparedLiveSubscribe> {
        if authority.source() != InvocationSource::LiveInitialQuery {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_SOURCE_INVALID",
                "auth",
                "live subscribe requires LiveInitialQuery authority",
            ));
        }
        authority.validate_admission("live subscribe staging")?;
        let effect_fence = invalidation.effect_fence.clone().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_LIVE_STAGE_FENCE_REQUIRED",
                "realtime",
                "transport live subscribe staging requires an exact connection effect fence",
            )
        })?;
        let mut reservation_keys = Vec::new();
        let reserved_subscription_slots = match input.supersedes.as_ref() {
            Some(subscription_id) => match self.subscriptions.get(subscription_id) {
                Some(subscription)
                    if subscription.connection_id == input.connection_id
                        && subscription.is_owned_by(&authority, Some(&effect_fence)) =>
                {
                    reservation_keys.push(format!("subscription:{subscription_id}"));
                    0
                }
                Some(subscription) => return Err(live_owner_mismatch(&subscription.id)),
                None => 1,
            },
            None => 1,
        };
        self.stage_local_live_effect(
            input.connection_id.clone(),
            effect_fence,
            reserved_subscription_slots,
            reservation_keys,
            PreparedLiveSubscribePlan {
                name,
                input,
                authority,
                invalidation,
            },
        )
    }

    pub(crate) fn finalize_subscribe_live_for_transport(
        &mut self,
        staged: &PreparedLiveSubscribe,
    ) -> SnapbackResult<LiveTransportPublication<LiveSubscribeOutput>> {
        self.finalize_prepared_live_effect(staged, |snapback, plan| {
            snapback.subscribe_live_for_transport(
                &plan.name,
                plan.input,
                plan.authority,
                plan.invalidation,
            )
        })
    }

    pub(crate) fn subscribe_live_for_transport(
        &mut self,
        name: &str,
        input: LiveSubscribeInput,
        authority: PreparedAuthority,
        invalidation: LiveInvalidationAdmission,
    ) -> SnapbackResult<LiveTransportPublication<LiveSubscribeOutput>> {
        let output =
            self.subscribe_live_prepared_with_invalidation(name, input, authority, invalidation)?;
        let authorization = output.authorization_scope.as_ref().and_then(|_| {
            self.auth_invalidation
                .as_ref()
                .map(|state| state.obligations.expectation().authorization.clone())
        });
        Ok(LiveTransportPublication {
            output,
            authorization,
        })
    }

    /// Explicit unsubscribe (LLP 0034 §10.1 residual, ENG-22478): dispose one
    /// live subscription. Ownership mirrors `resume_live` — once a principal
    /// owns the subscription the caller must present that principal.
    pub fn unsubscribe_live(
        &mut self,
        name: &str,
        input: LiveUnsubscribeInput,
    ) -> SnapbackResult<LiveUnsubscribeOutput> {
        let admission = self.admission.admit_dev()?;
        let authority = InvocationGate::prepare_admitted_authority(
            InvocationSource::LiveUnsubscribe,
            AuthMode::Dev,
            ServerProfile::Dev,
            admission,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::dev_from_auth(&input.auth),
        )?;
        self.unsubscribe_live_prepared(name, input, authority, None)
    }

    pub(crate) fn unsubscribe_live_prepared(
        &mut self,
        name: &str,
        input: LiveUnsubscribeInput,
        authority: PreparedAuthority,
        effect_fence: Option<&crate::ephemeral::ConnectionEffectFence>,
    ) -> SnapbackResult<LiveUnsubscribeOutput> {
        if authority.source() != InvocationSource::LiveUnsubscribe {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_SOURCE_INVALID",
                "auth",
                "live unsubscribe requires LiveUnsubscribe authority",
            ));
        }
        authority.validate_admission("live unsubscribe preparation")?;
        let subscription = self
            .subscriptions
            .get(&input.subscription_id)
            .cloned()
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_UNKNOWN_SUBSCRIPTION",
                    "realtime",
                    format!("unknown live subscription {}", input.subscription_id),
                )
            })?;
        if subscription.function != name {
            return Err(SnapbackError::error(
                "SNAPBACK_LIVE_RESUME_FUNCTION_MISMATCH",
                "realtime",
                format!(
                    "subscription {} belongs to {}, not {name}",
                    subscription.id, subscription.function
                ),
            ));
        }
        if !subscription.is_owned_by(&authority, effect_fence) {
            return Err(live_owner_mismatch(&subscription.id));
        }

        let snapshot_version = self.db.current_version()?;
        let _publication = authority.effect_guard("live unsubscribe publication")?;
        let prepared_retirement = match (
            self.auth_invalidation.as_ref(),
            subscription.authorization.as_ref(),
        ) {
            (Some(state), Some(authorization)) => {
                let (candidate, retirement) =
                    state.prepare_scope_retirement_authenticated(&authorization.scope_id)?;
                Some((authorization.scope_id.clone(), candidate, retirement))
            }
            _ => None,
        };
        // No fallible step remains after the retained producer is removed.
        self.touch_connection(&input.connection_id, now_millis());
        self.subscriptions.remove(&subscription.id);
        self.refresh_auth_scoped_live_connections();
        let scope_retirement = match (self.auth_invalidation.as_mut(), prepared_retirement) {
            (Some(state), Some((scope, candidate, retirement))) => {
                state.commit_scope_retirement(&scope, &candidate);
                retirement
            }
            _ => None,
        };
        // Losing the last watcher of a demand-gated live query disarms cron.
        self.refresh_cron_active();
        let receipt = Receipt::Subscription {
            event: SubscriptionReceiptEvent::Disposed,
            reason: Some("unsubscribed".to_owned()),
            subscription_id: Some(subscription.id.clone()),
            superseded_by: None,
            lane: None,
            binding_id: None,
            collection: None,
            removed: None,
            scope: subscription.input.args.clone(),
            snapshot_version: Some(snapshot_version),
            correlation: None,
            received_at_ms: now_millis(),
        };
        self.receipts
            .push_connection(&subscription.connection_id, receipt.clone().into_value());
        Ok(LiveUnsubscribeOutput {
            subscription_id: subscription.id,
            disposed: true,
            receipt: Some(receipt),
            scope_retirement,
        })
    }

    pub(crate) fn prepare_unsubscribe_live_for_transport(
        &mut self,
        name: String,
        input: LiveUnsubscribeInput,
        authority: PreparedAuthority,
        effect_fence: crate::ephemeral::ConnectionEffectFence,
    ) -> SnapbackResult<PreparedLiveUnsubscribe> {
        if authority.source() != InvocationSource::LiveUnsubscribe {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_SOURCE_INVALID",
                "auth",
                "live unsubscribe requires LiveUnsubscribe authority",
            ));
        }
        authority.validate_admission("live unsubscribe staging")?;
        self.stage_local_live_effect(
            input.connection_id.clone(),
            effect_fence.clone(),
            0,
            [format!("subscription:{}", input.subscription_id)],
            PreparedLiveUnsubscribePlan {
                name,
                input,
                authority,
                effect_fence,
            },
        )
    }

    pub(crate) fn finalize_unsubscribe_live_for_transport(
        &mut self,
        staged: &PreparedLiveUnsubscribe,
    ) -> SnapbackResult<LiveUnsubscribeOutput> {
        self.finalize_prepared_live_effect(staged, |snapback, plan| {
            snapback.unsubscribe_live_prepared(
                &plan.name,
                plan.input,
                plan.authority,
                Some(&plan.effect_fence),
            )
        })
    }

    /// The request itself is the client's assertion that its serialized
    /// disposition/snapshot transition committed. There is deliberately no
    /// caller-controlled `applied` boolean: only an exact token bound to this
    /// negotiated connection can compare-and-discharge the current revision.
    pub(crate) fn acknowledge_authorization_invalidation(
        &mut self,
        input: AuthorizationInvalidationAckInput,
        connection: AuthorizationInvalidationConnection,
        admission: &AdmissionLease,
    ) -> SnapbackResult<AuthorizationInvalidationAckOutput> {
        let _publication = admission.effect_guard("authorization invalidation acknowledgement")?;
        self.touch_connection(&input.connection_id, now_millis());
        let state = self.auth_invalidation.as_mut().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                "auth",
                "authorization invalidation is not installed",
            )
        })?;
        if !state.accepts_connection(&connection) {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
                "auth",
                "connection invalidation expectation is not current",
            ));
        }
        let outcome = state.obligations.acknowledge_subscription(
            &connection.issuer_id,
            connection.connection_generation,
            &input.ack_token,
        )?;
        Ok(AuthorizationInvalidationAckOutput {
            outcome: match outcome {
                crate::auth::invalidation::AcknowledgeOutcome::Discharged => "discharged",
                crate::auth::invalidation::AcknowledgeOutcome::Duplicate => "duplicate",
                crate::auth::invalidation::AcknowledgeOutcome::Stale => "stale",
            }
            .to_owned(),
        })
    }

    pub(crate) fn prepare_authorization_invalidation_ack_for_transport(
        &mut self,
        input: AuthorizationInvalidationAckInput,
        connection: AuthorizationInvalidationConnection,
        admission: AdmissionLease,
        effect_fence: crate::ephemeral::ConnectionEffectFence,
    ) -> SnapbackResult<PreparedAuthorizationInvalidationAck> {
        self.stage_local_live_effect(
            input.connection_id.clone(),
            effect_fence,
            0,
            [format!(
                "authorization-ack:{}:{}:{}:{}:{}",
                connection.issuer_id.authorization_incarnation,
                connection.issuer_id.boot_sequence,
                connection.issuer_id.boot_nonce,
                connection.connection_generation,
                input.ack_token
            )],
            PreparedAuthorizationInvalidationAckPlan {
                input,
                connection,
                admission,
            },
        )
    }

    pub(crate) fn finalize_authorization_invalidation_ack_for_transport(
        &mut self,
        staged: &PreparedAuthorizationInvalidationAck,
    ) -> SnapbackResult<AuthorizationInvalidationAckOutput> {
        self.finalize_prepared_live_effect(staged, |snapback, plan| {
            snapback.acknowledge_authorization_invalidation(
                plan.input,
                plan.connection,
                &plan.admission,
            )
        })
    }

    /// Open a new bounded retry episode only through an explicit, exact-owner
    /// operation. Reconnect, subscribe, resume, revision changes, and ordinary
    /// re-fire all remain attached to the exhausted durable episode.
    ///
    /// @ref LLP 0053#invalidation-is-an-obligation-not-a-message — manual retry
    /// is authority-checked and idempotent, and replaces the same durable key.
    pub(crate) fn manual_retry_authorization_invalidation(
        &mut self,
        input: AuthorizationInvalidationManualRetryInput,
        connection: AuthorizationInvalidationConnection,
        authority: PreparedAuthority,
    ) -> SnapbackResult<AuthorizationInvalidationManualRetryOutput> {
        if authority.source() != InvocationSource::StandaloneAcknowledgement {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_SOURCE_INVALID",
                "auth",
                "authorization invalidation manual retry requires standalone acknowledgement authority",
            ));
        }
        authority.validate_admission("authorization invalidation manual retry")?;
        self.touch_connection(&input.connection_id, now_millis());
        let subscription = self
            .subscriptions
            .get(&input.subscription_id)
            .cloned()
            .ok_or_else(auth_resnapshot_required)?;
        if subscription.connection_id != input.connection_id
            || !subscription.authority.matches(&authority)
        {
            return Err(SnapbackError::error(
                "SNAPBACK_LIVE_RESUME_OWNERSHIP",
                "realtime",
                "authorization invalidation retry belongs to a different live owner",
            ));
        }
        let subscription_authorization = subscription.authorization.as_ref().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                "auth",
                "manual authorization retry requires an auth-scoped subscription",
            )
        })?;
        let state = self.auth_invalidation.as_ref().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                "auth",
                "authorization invalidation is not installed",
            )
        })?;
        if !state.accepts_connection(&connection)
            || !matches!(
                &subscription_authorization.scope_id,
                ScopeId::Subscription {
                    issuer_id,
                    connection_generation,
                    ..
                } if issuer_id == &connection.issuer_id
                    && *connection_generation == connection.connection_generation
            )
        {
            return Err(auth_resnapshot_required());
        }
        let witness_floor = state
            .obligations
            .pending(&subscription_authorization.scope_id)
            .map(|pending| pending.witness.clone())
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_RETRY_NOT_PENDING",
                    "auth",
                    "manual retry requires a current unresolved authorization obligation",
                )
            })?;
        let key = Self::authorization_retry_key(&subscription)
            .expect("auth-scoped subscription has a retry key");
        let reservation = {
            let _effect =
                authority.effect_guard("authorization manual retry reservation transaction")?;
            self.db.with_invalidation_retry_episode(&key, |registry| {
                registry.manual_retry(&key, input.manual_retry_id, now_millis())
            })?
        };
        let episode = match reservation {
            RetryReservation::Attached(episode) => {
                return Ok(AuthorizationInvalidationManualRetryOutput {
                    outcome: "attached".to_owned(),
                    retry_episode_id: Some(episode.episode_id),
                });
            }
            RetryReservation::Reserved(episode) => episode,
            RetryReservation::Exhausted(_) => {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_RETRY_EXHAUSTED",
                    "auth",
                    "manual retry reservation remained exhausted",
                ));
            }
        };
        let retry_episode_id = episode.episode_id.clone();
        match self.invoke_authorization_resolution_with_episode(
            &subscription,
            witness_floor,
            authority.admission_lease(),
            key,
            episode,
        ) {
            Ok(query) => {
                self.deliver_authorization_snapshot(
                    &subscription,
                    query,
                    "manual_retry",
                    false,
                    authority.admission_lease(),
                )?;
                Ok(AuthorizationInvalidationManualRetryOutput {
                    outcome: "resolved".to_owned(),
                    retry_episode_id: Some(retry_episode_id),
                })
            }
            Err(failure) => {
                let terminal = failure.error.is_trusted_permission_denial();
                self.fail_subscription_fanout_with_retry(
                    &subscription,
                    if terminal {
                        "authorization_manual_retry_denied"
                    } else {
                        "authorization_manual_retry_failed"
                    },
                    failure.error,
                    failure.retry_episode_id.clone(),
                    None,
                    authority.admission_lease(),
                );
                Ok(AuthorizationInvalidationManualRetryOutput {
                    outcome: if terminal { "denied" } else { "exhausted" }.to_owned(),
                    retry_episode_id: failure.retry_episode_id,
                })
            }
        }
    }

    pub(crate) fn prepare_authorization_invalidation_manual_retry_for_transport(
        &mut self,
        input: AuthorizationInvalidationManualRetryInput,
        connection: AuthorizationInvalidationConnection,
        authority: PreparedAuthority,
        effect_fence: crate::ephemeral::ConnectionEffectFence,
    ) -> SnapbackResult<PreparedAuthorizationInvalidationManualRetry> {
        if authority.source() != InvocationSource::StandaloneAcknowledgement {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_SOURCE_INVALID",
                "auth",
                "authorization invalidation manual retry requires standalone acknowledgement authority",
            ));
        }
        authority.validate_admission("authorization invalidation manual retry staging")?;
        self.stage_local_live_effect(
            input.connection_id.clone(),
            effect_fence.clone(),
            0,
            [format!("subscription:{}", input.subscription_id)],
            PreparedAuthorizationInvalidationManualRetryPlan {
                input,
                connection,
                authority,
                effect_fence,
            },
        )
    }

    pub(crate) fn finalize_authorization_invalidation_manual_retry_for_transport(
        &mut self,
        staged: &PreparedAuthorizationInvalidationManualRetry,
    ) -> SnapbackResult<AuthorizationInvalidationManualRetryOutput> {
        self.finalize_prepared_live_effect(staged, |snapback, plan| {
            let subscription = snapback
                .subscriptions
                .get(&plan.input.subscription_id)
                .ok_or_else(auth_resnapshot_required)?;
            if subscription.connection_id != plan.input.connection_id
                || !subscription.is_owned_by(&plan.authority, Some(&plan.effect_fence))
            {
                return Err(live_owner_mismatch(&plan.input.subscription_id));
            }
            snapback.manual_retry_authorization_invalidation(
                plan.input,
                plan.connection,
                plan.authority,
            )
        })
    }

    /// @ref LLP 0020#remaining-phase-4-design-dependency-vocabulary-and-auth-epochs — retained resume compares client-recorded permission epochs before trusting retained rows.
    /// @ref LLP 0053#invalidation-is-an-obligation-not-a-message — an
    /// auth-scoped reconnect gets a fresh connection-bound scope and snapshot;
    /// any pending obligation transfers instead of disappearing with the socket.
    pub fn resume_live(
        &mut self,
        name: &str,
        input: LiveResumeInput,
    ) -> SnapbackResult<LiveResumeOutput> {
        let admission = self.admission.admit_dev()?;
        let authority = InvocationGate::prepare_admitted_authority(
            InvocationSource::LiveResume,
            AuthMode::Dev,
            ServerProfile::Dev,
            admission,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::dev_from_auth(&input.auth),
        )?;
        self.resume_live_prepared_with_invalidation(
            name,
            input,
            authority,
            LiveInvalidationAdmission::default(),
        )
    }

    // Compatibility seam matching subscribe_live_prepared; production binds
    // invalidation state explicitly through the method below.
    #[allow(dead_code)]
    pub(crate) fn resume_live_prepared(
        &mut self,
        name: &str,
        input: LiveResumeInput,
        authority: PreparedAuthority,
    ) -> SnapbackResult<LiveResumeOutput> {
        self.resume_live_prepared_with_invalidation(
            name,
            input,
            authority,
            LiveInvalidationAdmission::default(),
        )
    }

    pub(crate) fn resume_live_prepared_with_invalidation(
        &mut self,
        name: &str,
        input: LiveResumeInput,
        authority: PreparedAuthority,
        invalidation: LiveInvalidationAdmission,
    ) -> SnapbackResult<LiveResumeOutput> {
        if authority.source() != InvocationSource::LiveResume {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_SOURCE_INVALID",
                "auth",
                "live resume requires LiveResume authority",
            ));
        }
        authority.validate_admission("live resume preparation")?;
        self.touch_connection(&input.connection_id, now_millis());
        let mut subscription = self
            .subscriptions
            .get(&input.subscription_id)
            .cloned()
            .ok_or_else(|| {
                if authority.active_mode() == AuthMode::Sessions {
                    auth_resnapshot_required()
                } else {
                    SnapbackError::error(
                        "SNAPBACK_UNKNOWN_SUBSCRIPTION",
                        "realtime",
                        format!("unknown live subscription {}", input.subscription_id),
                    )
                }
            })?;
        if subscription.function != name {
            return Err(SnapbackError::error(
                "SNAPBACK_LIVE_RESUME_FUNCTION_MISMATCH",
                "realtime",
                format!(
                    "subscription {} belongs to {}, not {name}",
                    subscription.id, subscription.function
                ),
            ));
        }

        if !subscription.is_owned_by(&authority, invalidation.effect_fence.as_ref()) {
            return Err(live_owner_mismatch(&subscription.id));
        }
        let predecessor_subscription = subscription.clone();

        // @ref LLP 0059#durable-and-ephemeral-outboxes — reconnect stages the
        // successor connection and exact effect fence privately, then moves
        // the retained producer before any successor-owned frame is exposed.
        subscription.connection_id = input.connection_id.clone();
        if invalidation.effect_fence.is_some() {
            subscription.effect_fence = invalidation.effect_fence.clone();
        }

        if let Some(mut authorization) = subscription.authorization.take() {
            if authority.active_mode() != AuthMode::Sessions {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                    "auth",
                    "an auth-scoped subscription cannot resume outside its session authority",
                ));
            }
            let connection = invalidation.connection.ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
                    "auth",
                    "auth-scoped live resume requires authInvalidationProtocol: 1",
                )
            })?;
            let state = self.auth_invalidation.as_ref().ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                    "auth",
                    "authorization invalidation is not installed",
                )
            })?;
            if !state.accepts_connection(&connection) {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
                    "auth",
                    "connection invalidation expectation is not current",
                ));
            }

            let connection_changed = !matches!(
                &authorization.scope_id,
                ScopeId::Subscription {
                    issuer_id,
                    connection_generation,
                    ..
                } if issuer_id == &connection.issuer_id
                    && *connection_generation == connection.connection_generation
            );
            // Read the durable floor before changing retained ownership. A read
            // failure must leave the exact predecessor scope/fence untouched.
            let floor = self.db.current_version()?;
            let retry_floor = state.witness(floor);
            let predecessor_scope = authorization.scope_id.clone();
            let replacement_stage = if connection_changed {
                // Register a quarantined successor without retiring or
                // repointing the retained predecessor. It is private staging:
                // no successor-fenced frame is enqueued until the fresh query,
                // authenticated retirement proof, and retry resolution are all
                // ready to commit. Failed staging is removed in O(log N), while
                // its reserved identity remains spent.
                let state = self
                    .auth_invalidation
                    .as_mut()
                    .expect("resume checked installed invalidation state");
                let previous = state.obligations.pending(&predecessor_scope).cloned();
                let replacement = ScopeId::Subscription {
                    issuer_id: connection.issuer_id.clone(),
                    namespace: authorization.namespace.clone(),
                    scope_sequence: state.issuer.reserve_scope_sequence()?,
                    connection_generation: connection.connection_generation,
                    subscription_id: subscription.id.clone(),
                };
                let connection_scope = ScopeId::Connection {
                    issuer_id: connection.issuer_id.clone(),
                    connection_generation: connection.connection_generation,
                };
                let owner_continuity_id = format!("owner_{}", Uuid::now_v7().simple());
                let transfer_cause = if previous.is_some() {
                    Some(state.reserve_cause_sequence()?)
                } else {
                    None
                };
                let fresh_cause = state.reserve_cause_sequence()?;
                let staged = (|| {
                    state
                        .obligations
                        .register_live_scope(replacement.clone(), owner_continuity_id.clone())?;
                    state
                        .obligations
                        .register_connection_child(&connection_scope, replacement.clone())?;
                    if let (Some(previous), Some(cause)) = (previous, transfer_cause) {
                        state.obligations.raise(
                            replacement.clone(),
                            cause,
                            format!("resume:transfer:{cause}"),
                            previous.max_disposition,
                            previous.witness,
                            previous.retry_episode_id,
                        )?;
                    }
                    state.obligations.raise(
                        replacement.clone(),
                        fresh_cause,
                        format!("resume:fresh:{fresh_cause}"),
                        InvalidationDisposition::Quarantine,
                        retry_floor.clone(),
                        None,
                    )?;
                    Ok::<(), SnapbackError>(())
                })();
                if let Err(error) = staged {
                    state
                        .obligations
                        .rollback_unpublished_live_scope(&replacement, &connection_scope);
                    return Err(error);
                }
                authorization.owner_continuity_id = owner_continuity_id;
                authorization.scope_id = replacement.clone();
                Some((replacement, connection_scope))
            } else {
                let state = self
                    .auth_invalidation
                    .as_mut()
                    .expect("resume checked installed invalidation state");
                let cause = state.reserve_cause_sequence()?;
                state.obligations.raise(
                    authorization.scope_id.clone(),
                    cause,
                    format!("resume:fresh:{cause}"),
                    InvalidationDisposition::Quarantine,
                    retry_floor.clone(),
                    None,
                )?;
                None
            };

            subscription.authorization = Some(authorization.clone());
            let query = match self.invoke_authorization_resolution(
                &subscription,
                retry_floor,
                authority.admission_lease(),
            ) {
                Ok(query) => query,
                Err(failure) => {
                    let error = failure.error.clone();
                    if let Some((replacement, connection_scope)) = replacement_stage.as_ref() {
                        self.auth_invalidation
                            .as_mut()
                            .expect("state remains installed")
                            .obligations
                            .rollback_unpublished_live_scope(replacement, connection_scope);
                    }
                    // The failed attempt exposed no replacement identity. Keep
                    // the exact retained predecessor as cleanup/delivery owner
                    // and make its already-known client view fail closed.
                    self.fail_subscription_fanout_with_retry(
                        &predecessor_subscription,
                        "authorization_resume_failed",
                        failure.error,
                        failure.retry_episode_id,
                        None,
                        authority.admission_lease(),
                    );
                    return Err(error);
                }
            };
            let permission_epochs = permission_epochs_from_dependencies(&query.read_dependencies);
            let _publication = match authority.effect_guard("live authorization resume publication")
            {
                Ok(publication) => publication,
                Err(error) => {
                    if let Some((replacement, connection_scope)) = replacement_stage.as_ref() {
                        self.auth_invalidation
                            .as_mut()
                            .expect("state remains installed")
                            .obligations
                            .rollback_unpublished_live_scope(replacement, connection_scope);
                    }
                    return Err(error);
                }
            };
            let resolution_witness = self
                .auth_invalidation
                .as_ref()
                .expect("state remains installed")
                .witness(query.output.version);
            let resolution = {
                let state = self
                    .auth_invalidation
                    .as_mut()
                    .expect("state remains installed");
                state.obligations.issue_resolution(
                    &authorization.scope_id,
                    ResolutionKind::Snapshot,
                    resolution_witness.clone(),
                )
            };
            if let Err(error) = resolution {
                if let Some((replacement, connection_scope)) = replacement_stage.as_ref() {
                    self.auth_invalidation
                        .as_mut()
                        .expect("state remains installed")
                        .obligations
                        .rollback_unpublished_live_scope(replacement, connection_scope);
                }
                return Err(error);
            }
            let (retirement_candidate, retirement) = if connection_changed {
                let state = self
                    .auth_invalidation
                    .as_ref()
                    .expect("state remains installed");
                let candidate = state
                    .obligations
                    .preview_scope_retirement(&predecessor_scope);
                let retirement = candidate
                    .as_ref()
                    .map(|candidate| {
                        state.issuer.authenticate_scope_retirement(
                            candidate.namespace.clone(),
                            candidate.retire_through_scope_sequence,
                        )
                    })
                    .transpose();
                match retirement {
                    Ok(retirement) => (candidate, retirement),
                    Err(error) => {
                        if let Some((replacement, connection_scope)) = replacement_stage.as_ref() {
                            self.auth_invalidation
                                .as_mut()
                                .expect("state remains installed")
                                .obligations
                                .rollback_unpublished_live_scope(replacement, connection_scope);
                        }
                        return Err(error);
                    }
                }
            } else {
                (None, None)
            };
            let authorization_invalidation = self
                .auth_invalidation
                .as_ref()
                .expect("state remains installed")
                .obligations
                .projection(&authorization.scope_id)
                .expect("fresh quarantine and snapshot resolution remain projected");
            let invalidation_payload =
                match serde_json::to_vec(&LiveEnvelope::authorization_invalidation(
                    authorization_invalidation.obligation.clone(),
                    // This durable frame is only a level-triggered wake hint.
                    // The complete snapshot ticket and its rows travel
                    // together in the successful resume response below.
                    None,
                    None,
                )) {
                    Ok(payload) => payload,
                    Err(error) => {
                        if let Some((replacement, connection_scope)) = replacement_stage.as_ref() {
                            self.auth_invalidation
                                .as_mut()
                                .expect("state remains installed")
                                .obligations
                                .rollback_unpublished_live_scope(replacement, connection_scope);
                        }
                        return Err(SnapbackError::error(
                            "SNAPBACK_AUTH_INVALIDATION_SERIALIZE_FAILED",
                            "realtime",
                            "authorization resume invalidation could not be serialized",
                        )
                        .with_details(json!({ "error": error.to_string() })));
                    }
                };
            let predecessor_is_current =
                self.subscriptions
                    .get(&subscription.id)
                    .is_some_and(|stored| {
                        stored.connection_id == predecessor_subscription.connection_id
                            && stored.effect_fence == predecessor_subscription.effect_fence
                            && stored.authorization.as_ref().is_some_and(|authorization| {
                                authorization.scope_id == predecessor_scope
                            })
                    });
            let precommit = if !predecessor_is_current {
                Err(SnapbackError::error(
                    "SNAPBACK_AUTH_INVALIDATION_CORRUPT",
                    "auth",
                    "retained live predecessor changed before resume transfer commit",
                ))
            } else if connection_changed {
                self.auth_invalidation
                    .as_ref()
                    .expect("state remains installed")
                    .obligations
                    .require_scope_retirement_preview(&predecessor_scope, &retirement_candidate)
            } else {
                Ok(())
            };
            if let Err(error) = precommit {
                if let Some((replacement, connection_scope)) = replacement_stage.as_ref() {
                    self.auth_invalidation
                        .as_mut()
                        .expect("state remains installed")
                        .obligations
                        .rollback_unpublished_live_scope(replacement, connection_scope);
                }
                return Err(error);
            }
            if let Err(error) = self.resolve_authorization_retry_episode(
                &subscription,
                &resolution_witness,
                &_publication,
            ) {
                if let Some((replacement, connection_scope)) = replacement_stage.as_ref() {
                    self.auth_invalidation
                        .as_mut()
                        .expect("state remains installed")
                        .obligations
                        .rollback_unpublished_live_scope(replacement, connection_scope);
                }
                return Err(error);
            }

            // No fallible step remains. Retire and persist the predecessor only
            // after the authenticated frontier and complete successor response
            // are ready, then expose the successor fence and obligation as one
            // commit. A response that returns Err never exposes a replacement
            // scope and therefore owes the client no retirement frontier.
            if connection_changed {
                let actual = self
                    .auth_invalidation
                    .as_mut()
                    .expect("state remains installed")
                    .obligations
                    .retire_scope(&predecessor_scope);
                assert_eq!(
                    actual, retirement_candidate,
                    "validated live scope retirement frontier changed during commit"
                );
            }
            self.premark_auth_scoped_live_connection(&input.connection_id);
            let stored = self
                .subscriptions
                .get_mut(&subscription.id)
                .expect("preflight validated retained live predecessor presence");
            stored.connection_id = input.connection_id;
            stored.read_dependencies = query.read_dependencies;
            stored.authorization = Some(authorization.clone());
            stored.effect_fence = subscription.effect_fence.clone();
            self.refresh_auth_scoped_live_connections();
            self.enqueue_subscription_durable(&subscription, invalidation_payload);
            return Ok(LiveResumeOutput {
                subscription_id: subscription.id,
                mode: "resnapshot".to_owned(),
                reason: Some("authorization_revalidation".to_owned()),
                snapshot: Some(query.output),
                permission_epochs,
                authorization_scope: Some(authorization.scope_id.clone()),
                authorization_invalidation: Some(authorization_invalidation),
                scope_retirements: retirement.into_iter().collect(),
            });
        }

        // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S2:
        // resume re-points a subscription's stream, so once a principal owns
        // the subscription the caller must present that principal; the
        // unguessable id alone is not ownership.
        if !subscription.authority.matches(&authority) {
            return Err(SnapbackError::error(
                "SNAPBACK_LIVE_RESUME_OWNERSHIP",
                "realtime",
                format!(
                    "subscription {} is owned by a different principal",
                    subscription.id
                ),
            ));
        }

        if self.resume_requires_resnapshot(&subscription, &input.recorded_permission_epochs) {
            let rerun = self.prepare_live_rerun_authority(
                &subscription.authority,
                authority.admission_lease().clone(),
            )?;
            let query = self.invoke_query_with_dependencies_prepared(
                &subscription.function,
                subscription.input.clone(),
                rerun,
            )?;
            let permission_epochs = permission_epochs_from_dependencies(&query.read_dependencies);
            let _publication = authority.effect_guard("live resume resnapshot publication")?;
            self.touch_connection(&input.connection_id, now_millis());
            if let Some(stored) = self.subscriptions.get_mut(&subscription.id) {
                stored.connection_id = input.connection_id;
                stored.read_dependencies = query.read_dependencies;
                stored.effect_fence = subscription.effect_fence.clone();
            }
            return Ok(LiveResumeOutput {
                subscription_id: subscription.id,
                mode: "resnapshot".to_owned(),
                reason: Some("permission_epoch_changed".to_owned()),
                snapshot: Some(query.output),
                permission_epochs,
                authorization_scope: None,
                authorization_invalidation: None,
                scope_retirements: Vec::new(),
            });
        }

        let permission_epochs =
            current_permission_epochs_for_dependencies(&subscription.read_dependencies, |scope| {
                self.permission_epoch(scope)
            });
        let _publication = authority.effect_guard("live resume publication")?;
        self.touch_connection(&input.connection_id, now_millis());
        if let Some(stored) = self.subscriptions.get_mut(&subscription.id) {
            stored.connection_id = input.connection_id;
            stored.effect_fence = subscription.effect_fence;
        }
        Ok(LiveResumeOutput {
            subscription_id: subscription.id,
            mode: "retained".to_owned(),
            reason: None,
            snapshot: None,
            permission_epochs,
            authorization_scope: None,
            authorization_invalidation: None,
            scope_retirements: Vec::new(),
        })
    }

    pub(crate) fn prepare_resume_live_for_transport(
        &mut self,
        name: String,
        input: LiveResumeInput,
        authority: PreparedAuthority,
        invalidation: LiveInvalidationAdmission,
    ) -> SnapbackResult<PreparedLiveResume> {
        if authority.source() != InvocationSource::LiveResume {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_SOURCE_INVALID",
                "auth",
                "live resume requires LiveResume authority",
            ));
        }
        authority.validate_admission("live resume staging")?;
        let effect_fence = invalidation.effect_fence.clone().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_LIVE_STAGE_FENCE_REQUIRED",
                "realtime",
                "transport live resume staging requires an exact connection effect fence",
            )
        })?;
        self.stage_local_live_effect(
            input.connection_id.clone(),
            effect_fence,
            0,
            [format!("subscription:{}", input.subscription_id)],
            PreparedLiveResumePlan {
                name,
                input,
                authority,
                invalidation,
            },
        )
    }

    pub(crate) fn finalize_resume_live_for_transport(
        &mut self,
        staged: &PreparedLiveResume,
    ) -> SnapbackResult<LiveTransportPublication<LiveResumeOutput>> {
        self.finalize_prepared_live_effect(staged, |snapback, plan| {
            snapback.resume_live_for_transport(
                &plan.name,
                plan.input,
                plan.authority,
                plan.invalidation,
            )
        })
    }

    pub(crate) fn resume_live_for_transport(
        &mut self,
        name: &str,
        input: LiveResumeInput,
        authority: PreparedAuthority,
        invalidation: LiveInvalidationAdmission,
    ) -> SnapbackResult<LiveTransportPublication<LiveResumeOutput>> {
        let output =
            self.resume_live_prepared_with_invalidation(name, input, authority, invalidation)?;
        let authorization = output.authorization_scope.as_ref().and_then(|_| {
            self.auth_invalidation
                .as_ref()
                .map(|state| state.obligations.expectation().authorization.clone())
        });
        Ok(LiveTransportPublication {
            output,
            authorization,
        })
    }

    /// Read a page of a table through the schema-aware storage layer for the
    /// admin data explorer.
    ///
    /// @ref LLP 0017#durable-data-exploration-and-edits — read-only exploration
    /// is the paved path; raw engine access is a separate opt-out.
    pub fn scan_table(
        &self,
        table: &str,
        limit: usize,
        offset: usize,
    ) -> SnapbackResult<TableScan> {
        self.db.scan_table(table, limit, offset)
    }

    /// Run a generated query or mutation through the *same* invocation path as
    /// generated clients, returning a unified envelope with the declared
    /// read/write sets, timing, and any diagnostic instead of an HTTP error — so
    /// the runner can show conflicts and failures inline.
    ///
    /// @ref LLP 0017#function-runner-and-code-runner — generated-function runner
    /// over the normal invocation path; not an arbitrary-JavaScript eval.
    pub fn run_function(&mut self, name: &str, input: HandlerInput) -> FunctionRunResult {
        let authority = match self.admission.admit_dev().and_then(|admission| {
            InvocationGate::prepare_admitted_dev_input(
                InvocationSource::DirectAdminRunner,
                ServerProfile::Dev,
                &input,
                admission,
            )
        }) {
            Ok(authority) => authority,
            Err(error) => return function_run_admission_failure(name, error),
        };
        self.run_function_with_authority(name, input, authority)
    }

    pub(crate) fn run_function_with_authority(
        &mut self,
        name: &str,
        input: HandlerInput,
        authority: PreparedAuthority,
    ) -> FunctionRunResult {
        let started = Instant::now();
        let Some(definition) = self.functions.function(name).cloned() else {
            return FunctionRunResult {
                ok: false,
                function: name.to_owned(),
                kind: None,
                reads: Vec::new(),
                writes: Vec::new(),
                captured_reads: Vec::new(),
                captured_writes: Vec::new(),
                admin_bypass: false,
                elapsed_ms: elapsed_ms(started),
                version: None,
                changed_count: None,
                rows: None,
                result: None,
                diagnostic: Some(
                    SnapbackError::error(
                        "SNAPBACK_UNKNOWN_FUNCTION",
                        "runtime",
                        format!("unknown function {name}"),
                    )
                    .diagnostic,
                ),
            };
        };
        let prepared = match InvocationGate::prepare_function(authority, &definition) {
            Ok(prepared) => prepared,
            Err(error) => {
                return FunctionRunResult {
                    ok: false,
                    function: name.to_owned(),
                    kind: Some(definition.kind.clone()),
                    reads: Vec::new(),
                    writes: Vec::new(),
                    captured_reads: Vec::new(),
                    captured_writes: Vec::new(),
                    admin_bypass: false,
                    elapsed_ms: elapsed_ms(started),
                    version: None,
                    changed_count: None,
                    rows: None,
                    result: None,
                    diagnostic: Some(error.diagnostic),
                };
            }
        };
        let input = prepared.canonicalize_input(input);

        let (reads, writes) = plan_io(&definition);
        let kind = definition.kind.clone();
        let base = FunctionRunResult {
            ok: true,
            function: name.to_owned(),
            kind: Some(kind.clone()),
            reads,
            writes,
            captured_reads: Vec::new(),
            captured_writes: Vec::new(),
            admin_bypass: false,
            elapsed_ms: 0,
            version: None,
            changed_count: None,
            rows: None,
            result: None,
            diagnostic: None,
        };

        match kind {
            FunctionKind::Query | FunctionKind::LiveQuery => {
                match self.invoke_query_with_dependencies_prepared(
                    name,
                    input,
                    prepared.authority().clone(),
                ) {
                    Ok(invocation) => FunctionRunResult {
                        elapsed_ms: elapsed_ms(started),
                        version: Some(invocation.output.version),
                        rows: Some(invocation.output.rows),
                        captured_reads: invocation.read_dependencies,
                        ..base
                    },
                    Err(error) => FunctionRunResult {
                        ok: false,
                        elapsed_ms: elapsed_ms(started),
                        diagnostic: Some(error.diagnostic),
                        ..base
                    },
                }
            }
            FunctionKind::Mutation => match self.invoke_mutation_commit_with_id_and_authority(
                name,
                input,
                None,
                None,
                prepared.authority().clone(),
            ) {
                Ok(commit) => FunctionRunResult {
                    elapsed_ms: elapsed_ms(started),
                    version: Some(commit.output.version),
                    changed_count: Some(commit.output.changed_count),
                    result: Some(commit.output.result),
                    captured_reads: commit.read_dependencies,
                    captured_writes: commit.write_dependencies,
                    ..base
                },
                Err(error) => FunctionRunResult {
                    ok: false,
                    elapsed_ms: elapsed_ms(started),
                    diagnostic: Some(error.diagnostic),
                    ..base
                },
            },
            FunctionKind::Action => {
                let metadata = manual_action_metadata("admin", name);
                match self.invoke_action_prepared(name, input, metadata, prepared) {
                    Ok(result) => FunctionRunResult {
                        elapsed_ms: elapsed_ms(started),
                        result: Some(result),
                        ..base
                    },
                    Err(error) => FunctionRunResult {
                        ok: false,
                        elapsed_ms: elapsed_ms(started),
                        diagnostic: Some(error.diagnostic),
                        ..base
                    },
                }
            }
        }
    }

    pub(crate) fn function_declared_read_tables(&self, name: &str) -> Vec<String> {
        self.functions
            .function(name)
            .map(|definition| plan_io(definition).0)
            .unwrap_or_default()
    }

    pub(crate) fn authorization_reservation_snapshot(
        &self,
    ) -> SnapbackResult<(u64, crate::storage::AuthorizationVersion)> {
        self.db.authorization_reservation_snapshot()
    }

    pub(crate) fn authorization_commit_preflight_for_changes(
        &self,
        changes: Vec<ChangedRow>,
    ) -> crate::storage::AuthorizationCommitPreflight {
        if crate::storage::app_writes_are_authorization_event(self.db.schema(), &changes) {
            crate::storage::AuthorizationCommitPreflight::AppWrites {
                schema: Box::new(self.db.schema().clone()),
                changes,
            }
        } else {
            crate::storage::AuthorizationCommitPreflight::NoAuthorizationEvent
        }
    }

    pub(crate) fn authorization_commit_preflight_for_seed(
        &mut self,
        seed: &SeedData,
    ) -> SnapbackResult<crate::storage::AuthorizationCommitPreflight> {
        let changes = self.db.preview_seed_changes(seed.clone())?;
        Ok(self.authorization_commit_preflight_for_changes(changes))
    }

    /// Run an app-data action through the normal action invocation path without
    /// borrowing the admin function runner's metadata. Non-actions return a
    /// diagnostic envelope and are never executed.
    ///
    /// @ref LLP 0028#open-questions — actions are useful
    /// for app-triggered egress, not only scheduled cron runs.
    pub fn run_app_action(&mut self, name: &str, input: HandlerInput) -> FunctionRunResult {
        let started = Instant::now();
        let authority = match self.admission.admit_dev().and_then(|admission| {
            InvocationGate::prepare_admitted_dev_input(
                InvocationSource::LocalAction,
                ServerProfile::Dev,
                &input,
                admission,
            )
        }) {
            Ok(authority) => authority,
            Err(error) => {
                return action_run_result(
                    name,
                    Vec::new(),
                    Vec::new(),
                    elapsed_ms(started),
                    Err(error),
                );
            }
        };
        let stage = match self.stage_app_action_with_authority(name, authority) {
            StagedAppAction::Done(result) => return *result,
            StagedAppAction::Ready(stage) => stage,
        };
        let metadata = manual_action_metadata("action", name);
        let result = match stage.mode {
            StagedAction::HostPlan(prepared) => {
                self.invoke_action_prepared(name, input, metadata, prepared)
            }
            StagedAction::Detached(action) => {
                self.invoke_action_prepared(name, input, metadata, action.invocation.clone())
            }
        };
        action_run_result(name, stage.reads, stage.writes, elapsed_ms(started), result)
    }

    /// Stage an app-action run: resolve the function, reject non-actions with
    /// a ready envelope, and clone out what a detached execution needs. Runs
    /// under the global mutex; the returned stage does not borrow the
    /// instance (ENG-23324).
    pub(crate) fn stage_app_action_with_authority(
        &mut self,
        name: &str,
        authority: PreparedAuthority,
    ) -> StagedAppAction {
        let started = Instant::now();
        let Some(definition) = self.functions.function(name).cloned() else {
            return StagedAppAction::Done(Box::new(FunctionRunResult {
                ok: false,
                function: name.to_owned(),
                kind: None,
                reads: Vec::new(),
                writes: Vec::new(),
                captured_reads: Vec::new(),
                captured_writes: Vec::new(),
                admin_bypass: false,
                elapsed_ms: elapsed_ms(started),
                version: None,
                changed_count: None,
                rows: None,
                result: None,
                diagnostic: Some(
                    SnapbackError::error(
                        "SNAPBACK_UNKNOWN_FUNCTION",
                        "runtime",
                        format!("unknown function {name}"),
                    )
                    .diagnostic,
                ),
            }));
        };

        let (reads, writes) = plan_io(&definition);
        let prepared = match InvocationGate::prepare_function(authority, &definition) {
            Ok(prepared) => prepared,
            Err(error) => {
                return StagedAppAction::Done(Box::new(FunctionRunResult {
                    ok: false,
                    function: name.to_owned(),
                    kind: Some(definition.kind.clone()),
                    reads,
                    writes,
                    captured_reads: Vec::new(),
                    captured_writes: Vec::new(),
                    admin_bypass: false,
                    elapsed_ms: elapsed_ms(started),
                    version: None,
                    changed_count: None,
                    rows: None,
                    result: None,
                    diagnostic: Some(error.diagnostic),
                }));
            }
        };
        if let Err(error) =
            self.persist_and_validate_prepared_service_authority(prepared.authority())
        {
            return StagedAppAction::Done(Box::new(FunctionRunResult {
                ok: false,
                function: name.to_owned(),
                kind: Some(definition.kind.clone()),
                reads,
                writes,
                captured_reads: Vec::new(),
                captured_writes: Vec::new(),
                admin_bypass: false,
                elapsed_ms: elapsed_ms(started),
                version: None,
                changed_count: None,
                rows: None,
                result: None,
                diagnostic: Some(error.diagnostic),
            }));
        }
        if !matches!(definition.kind, FunctionKind::Action) {
            return StagedAppAction::Done(Box::new(FunctionRunResult {
                ok: false,
                function: name.to_owned(),
                kind: Some(definition.kind.clone()),
                reads,
                writes,
                captured_reads: Vec::new(),
                captured_writes: Vec::new(),
                admin_bypass: false,
                elapsed_ms: elapsed_ms(started),
                version: None,
                changed_count: None,
                rows: None,
                result: None,
                diagnostic: Some(
                    SnapbackError::error(
                        "SNAPBACK_FUNCTION_KIND_MISMATCH",
                        "runtime",
                        format!("{name} is not an action"),
                    )
                    .diagnostic,
                ),
            }));
        }

        let mode = self.staged_mode(&definition, prepared);
        StagedAppAction::Ready(AppActionStage {
            reads,
            writes,
            mode,
        })
    }

    /// Stage one action invocation for the cron flow (no envelope shaping):
    /// unknown functions and non-actions are `SnapbackError`s, exactly as
    /// `invoke_action` would report them (ENG-23324).
    #[cfg(test)]
    pub(crate) fn stage_action_invocation(&mut self, name: &str) -> SnapbackResult<StagedAction> {
        let admission = self.admission.admit()?;
        self.stage_action_invocation_with_admission(name, admission)
    }

    pub(crate) fn stage_action_invocation_with_admission(
        &mut self,
        name: &str,
        admission: AdmissionLease,
    ) -> SnapbackResult<StagedAction> {
        let function = self.function(name)?.clone();
        admission.validate("cron action staging")?;
        let active_mode = admission
            .active_mode()
            .expect("LocalSnapback admissions are always controller-managed");
        let authority = InvocationGate::prepare_admitted_authority(
            InvocationSource::Cron,
            active_mode,
            ServerProfile::Dev,
            admission,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::System,
        )?;
        let prepared = InvocationGate::prepare_function(authority, &function)?;
        Ok(self.staged_mode(&function, prepared))
    }

    fn staged_mode(
        &mut self,
        definition: &FunctionDefinition,
        invocation: PreparedInvocation,
    ) -> StagedAction {
        match &definition.runtime {
            FunctionRuntime::IbexModule(module) => {
                StagedAction::Detached(Box::new(DetachedIbexAction {
                    module: module.clone(),
                    // @ref LLP 0036#runtime-exposure-d5-d8 — grants are
                    // computed per invocation from the function's `uses`
                    // declaration, at staging time, under the lock.
                    grants: self.config_grants(definition),
                    // Preserve the same staging-time secret identities for
                    // diagnostic scrubbing even if config rotates/unsets while
                    // this detached invocation is running.
                    redactor: self.config.secret_redactor_for(&definition.uses),
                    runtime: self.runtime.clone(),
                    invocation,
                    app_generation: self.app_generation,
                    app_generation_fence: self.app_generation_fence.clone(),
                }))
            }
            _ => StagedAction::HostPlan(invocation),
        }
    }

    pub(crate) fn stage_nested_mutation(
        &mut self,
        name: &str,
        input: &HandlerInput,
        authority: PreparedAuthority,
    ) -> SnapbackResult<StagedNestedMutation> {
        let function = self.function(name)?.clone();
        let invocation = InvocationGate::prepare_function(authority, &function)?;
        self.persist_and_validate_prepared_service_authority(invocation.authority())?;
        let canonical_input = invocation.canonicalize_input(input.clone());
        match &function.runtime {
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan)) => {
                refuse_unprovenanced_host_plan_authority_creation(
                    &invocation,
                    &function,
                    self.db.schema(),
                )?;
                let _epoch_scopes = evaluate_permission_epoch_scopes(&function, &canonical_input)?;
                let preview = self.db.dry_run_mutation(plan, &canonical_input)?;
                let mut replay_input = canonical_input;
                replay_input.ctx_ledger = Some(CtxAnswerLedger {
                    version: ctx_ledger_version(),
                    ids: preview.generated_ids,
                    now: preview.now_ms,
                    auth_fingerprint: None,
                });
                Ok(StagedNestedMutation::InLock(StagedHostPlanNestedMutation {
                    preflight: self
                        .authorization_commit_preflight_for_changes(preview.commit.changes),
                    input: replay_input,
                    invocation,
                }))
            }
            FunctionRuntime::IbexModule(_) => {
                // Preserve the ordinary mutation contract: resolve and
                // validate permission-epoch scopes before any handler code
                // executes. The resolved set rides the detached effect to its
                // bounded commit window.
                let epoch_scopes = evaluate_permission_epoch_scopes(&function, &canonical_input)?;
                let read = if self.db.reader_pool().is_some() {
                    DetachedMutationRead::Lane(self.read_lane())
                } else {
                    DetachedMutationRead::Snapshot(Box::new(self.db.detached_read_snapshot()?))
                };
                Ok(StagedNestedMutation::Detached(Box::new(
                    DetachedIbexMutation {
                        binding: DetachedMutationBinding {
                            function,
                            invocation,
                            schema: self.db.schema().clone(),
                            app_generation: self.app_generation,
                            epoch_scopes,
                        },
                        read,
                    },
                )))
            }
            _ => Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_KIND_MISMATCH",
                "runtime",
                format!("{name} is not a mutation"),
            )),
        }
    }

    /// Preview one already-executed detached Ibex mutation in the short Local
    /// window after handler execution. This derives the exact room selector
    /// without opening a transaction that survives the return.
    ///
    /// @ref LLP 0059#authorization-write-handoff — a one-shot Ibex handler is
    ///   buffered once, previewed under Local, then quiesced with Local absent.
    pub(crate) fn preview_detached_nested_authorization_mutation(
        &mut self,
        name: &str,
        input: &HandlerInput,
        binding: &DetachedMutationBinding,
        executed: &ExecutedIbexMutation,
    ) -> SnapbackResult<crate::storage::AuthorizationCommitPreflight> {
        binding
            .invocation
            .validate_admission("detached nested mutation preview")?;
        self.persist_and_validate_prepared_service_authority(binding.invocation.authority())?;
        let function = self.function(name)?.clone();
        if function != binding.function
            || self.db.schema() != &binding.schema
            || self.app_generation != binding.app_generation
        {
            return Err(SnapbackError::error(
                "SNAPBACK_MUTATION_CONFLICT",
                "runtime",
                format!(
                    "app code or schema changed while action-hosted mutation {name} was running"
                ),
            ));
        }
        let canonical_input = binding.invocation.canonicalize_input(input.clone());
        let membership_plans = self
            .db
            .authorize_membership_commands(executed.membership_commands.clone())?;
        let preview = self.db.dry_run_buffered_writes(
            &canonical_input,
            executed.writes.clone(),
            membership_plans,
            executed.reads.clone(),
            executed.result.clone(),
            executed.ctx_ledger.clone(),
        )?;
        Ok(self.authorization_commit_preflight_for_changes(preview.changes))
    }
    /// Validate declared config entries fail-closed, validate per-function
    /// `uses` grants, and run the one-time deprecated env-blob import.
    ///
    /// @ref LLP 0036#declared-configuration-in-the-manifest — manifest load
    /// rejects invalid declarations the way cron validation does; a rejected
    /// entry is removed from the effective declaration set rather than half
    /// working.
    fn reconcile_config(&mut self) -> Vec<Diagnostic> {
        let mut diagnostics = Vec::new();
        let mut accepted: Vec<crate::manifest::ConfigEntryDefinition> = Vec::new();
        let mut seen = std::collections::BTreeSet::new();

        for entry in self.functions.config.clone() {
            if entry.name.is_empty()
                || !entry
                    .name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
                diagnostics.push(
                    SnapbackError::error(
                        "SNAPBACK_CONFIG_ENTRY_INVALID",
                        "config",
                        format!(
                            "config entry name {:?} is invalid; entry names use [A-Za-z0-9_-]",
                            entry.name
                        ),
                    )
                    .diagnostic,
                );
                continue;
            }
            if !seen.insert(entry.name.clone()) {
                diagnostics.push(
                    SnapbackError::error(
                        "SNAPBACK_CONFIG_ENTRY_INVALID",
                        "config",
                        format!("config entry {} is declared more than once", entry.name),
                    )
                    .diagnostic,
                );
                continue;
            }
            // @ref LLP 0036#implementation-order — the v1 slice is secret
            // entries only; non-secret entries fail closed at validation (the
            // cron Backoff precedent), never half-work.
            if !entry.secret {
                diagnostics.push(
                    SnapbackError::error(
                        "SNAPBACK_CONFIG_NON_SECRET_UNIMPLEMENTED",
                        "config",
                        format!(
                            "config entry {} declares secret: false, but non-secret config \
                             entries are not implemented yet; declare it secret or remove it",
                            entry.name
                        ),
                    )
                    .diagnostic,
                );
                continue;
            }
            if entry.default.is_some() {
                diagnostics.push(
                    SnapbackError::error(
                        "SNAPBACK_CONFIG_DEFAULT_UNIMPLEMENTED",
                        "config",
                        format!(
                            "config entry {} declares a default, which only non-secret entries \
                             may carry — and those are not implemented yet",
                            entry.name
                        ),
                    )
                    .diagnostic,
                );
                continue;
            }
            if let Some(probe) = &entry.probe {
                match self.functions.function(probe) {
                    Some(function) if matches!(function.kind, FunctionKind::Action) => {}
                    Some(_) => {
                        diagnostics.push(
                            SnapbackError::error(
                                "SNAPBACK_CONFIG_PROBE_INVALID",
                                "config",
                                format!(
                                    "config entry {} names probe {probe}, which is not an action",
                                    entry.name
                                ),
                            )
                            .diagnostic,
                        );
                        continue;
                    }
                    None => {
                        diagnostics.push(
                            SnapbackError::error(
                                "SNAPBACK_CONFIG_PROBE_INVALID",
                                "config",
                                format!(
                                    "config entry {} names unknown probe function {probe}",
                                    entry.name
                                ),
                            )
                            .diagnostic,
                        );
                        continue;
                    }
                }
            }
            accepted.push(entry);
        }

        let declared: std::collections::BTreeSet<&str> =
            accepted.iter().map(|entry| entry.name.as_str()).collect();
        for function in &self.functions.functions {
            for name in &function.uses {
                if !declared.contains(name.as_str()) {
                    diagnostics.push(
                        SnapbackError::error(
                            "SNAPBACK_CONFIG_USES_UNKNOWN",
                            "config",
                            format!(
                                "function {} declares uses: {name}, which is not a declared \
                                 config entry; access will fail with SNAPBACK_CONFIG_UNDECLARED",
                                function.name
                            ),
                        )
                        .diagnostic,
                    );
                }
            }
        }
        self.functions.config = accepted;

        // One-time import from the deprecated env blob (LLP 0036 v1 slice
        // item 2): declared names only, never after the store's first write.
        if let Ok(blob_raw) = std::env::var("SNAPBACK_ACTION_SECRETS")
            && !blob_raw.trim().is_empty()
        {
            diagnostics.push(Diagnostic::warning(
                "SNAPBACK_ACTION_SECRETS_DEPRECATED",
                "config",
                "SNAPBACK_ACTION_SECRETS is deprecated; values are imported once into the \
                 config store — manage them via the setup wizard or /_snapback/api/config/*",
            ));
            match serde_json::from_str::<Value>(&blob_raw) {
                Ok(Value::Object(blob)) => {
                    let declared_names: Vec<String> = self
                        .functions
                        .config
                        .iter()
                        .map(|entry| entry.name.clone())
                        .collect();
                    match self
                        .config
                        .import_env_blob(&blob, &declared_names, now_millis())
                    {
                        Ok(outcome) => {
                            if !outcome.imported.is_empty() || !outcome.ignored.is_empty() {
                                diagnostics.push(
                                    Diagnostic::info(
                                        "SNAPBACK_CONFIG_ENV_IMPORTED",
                                        "config",
                                        "imported deprecated SNAPBACK_ACTION_SECRETS values into \
                                         the config store",
                                    )
                                    .with_details(json!({
                                        "imported": outcome.imported,
                                        "ignored": outcome.ignored,
                                        "skippedExistingStore": outcome.skipped_existing_store,
                                    })),
                                );
                            }
                        }
                        Err(error) => diagnostics.push(error.diagnostic),
                    }
                }
                _ => diagnostics.push(Diagnostic::warning(
                    "SNAPBACK_ACTION_SECRETS_INVALID",
                    "config",
                    "SNAPBACK_ACTION_SECRETS is set but is not a JSON object; nothing imported",
                )),
            }
        }

        let missing = self.required_missing_config();
        if !missing.is_empty() {
            diagnostics.push(
                Diagnostic::warning(
                    "SNAPBACK_CONFIG_REQUIRED_MISSING",
                    "config",
                    format!(
                        "{} required config entr{} missing ({}); open the setup wizard at \
                         /_snapback/admin/setup",
                        missing.len(),
                        if missing.len() == 1 {
                            "y is"
                        } else {
                            "ies are"
                        },
                        missing.join(", ")
                    ),
                )
                .with_details(json!({ "entries": missing })),
            );
        }

        diagnostics
    }

    /// Names of required, declared entries with no stored value.
    pub fn required_missing_config(&self) -> Vec<String> {
        self.functions
            .config
            .iter()
            .filter(|entry| entry.required && self.config.values(&entry.name).is_none())
            .map(|entry| entry.name.clone())
            .collect()
    }

    fn config_definition(
        &self,
        name: &str,
    ) -> SnapbackResult<&crate::manifest::ConfigEntryDefinition> {
        self.functions
            .config
            .iter()
            .find(|entry| entry.name == name)
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_CONFIG_UNDECLARED",
                    "config",
                    format!("{name} is not a declared config entry"),
                )
            })
    }

    /// The full LLP 0036 status primitive: declared × set × verified ×
    /// applied, names and states only — never values.
    pub fn config_status(&self) -> ConfigStatus {
        let entries = self
            .functions
            .config
            .iter()
            .map(|def| {
                let stored = self.config.entry(&def.name);
                ConfigEntryStatus {
                    name: def.name.clone(),
                    description: def.description.clone(),
                    purpose: def.purpose.clone(),
                    secret: def.secret,
                    required: def.required,
                    pool: def.pool,
                    probe: def.probe.clone(),
                    how_to_get: def.how_to_get.clone(),
                    acquisition: def.acquisition.clone(),
                    set: stored.is_some(),
                    member_count: stored.map(|entry| entry.member_count()).unwrap_or(0),
                    last_changed_ms: stored.map(|entry| entry.set_at_ms),
                    source: stored.map(|entry| entry.source.clone()),
                    verified: stored
                        .and_then(|entry| entry.verified.as_ref())
                        .map(ConfigVerificationStatus::from),
                    // v1 is local-file-immediate: every write applies at once.
                    apply_state: "applied".to_owned(),
                }
            })
            .collect();
        ConfigStatus {
            generation: self.config.generation(),
            backend_class: if self.config.is_persistent() {
                "local-file-immediate".to_owned()
            } else {
                "in-memory".to_owned()
            },
            app_provisioned: self.functions_loaded,
            entries,
            required_missing: self.required_missing_config(),
        }
    }

    /// `config.plan` facts for this target: v1 is always the in-server,
    /// immediately-applying `local-file-immediate` locus, and saying so pins
    /// the contract hosted backends will answer differently.
    ///
    /// @ref LLP 0036#operations-and-projections-llp-0024 — dry-run: no write.
    pub fn config_plan(
        &self,
        entry: Option<&str>,
        value_writes_accepted: bool,
    ) -> SnapbackResult<ConfigPlan> {
        if let Some(name) = entry {
            self.config_definition(name)?;
        }
        Ok(ConfigPlan {
            backend_class: if self.config.is_persistent() {
                "local-file-immediate".to_owned()
            } else {
                "in-memory".to_owned()
            },
            write_locus: "in-server".to_owned(),
            applies_immediately: true,
            value_writes_accepted,
            generation: self.config.generation(),
            entry: entry.map(str::to_owned),
            would_apply_state: "applied".to_owned(),
        })
    }

    /// Set a declared entry (replace, or append a pool member). Audit facts —
    /// never values — land in the diagnostics ring.
    pub fn set_config_entry(
        &mut self,
        name: &str,
        values: Vec<String>,
        append: bool,
        source: &str,
    ) -> SnapbackResult<ConfigWriteOutcome> {
        let pool = self.config_definition(name)?.pool;
        if !pool && (values.len() > 1 || append) {
            return Err(SnapbackError::error(
                "SNAPBACK_CONFIG_VALUE_INVALID",
                "config",
                format!("config entry {name} is not a pool; set exactly one value"),
            ));
        }
        let outcome = self
            .config
            .set(name, values, append, source, now_millis())?;
        self.record_diagnostics(vec![
            Diagnostic::info(
                "SNAPBACK_CONFIG_WRITE",
                "config",
                format!("config entry {name} set via {source}"),
            )
            .with_details(json!({
                "entry": name,
                "operation": "set",
                "valueChanged": outcome.value_changed,
                "source": source,
            })),
        ]);
        Ok(ConfigWriteOutcome {
            entry: name.to_owned(),
            apply_state: "applied".to_owned(),
            value_changed: outcome.value_changed,
            generation: outcome.generation,
        })
    }

    /// Remove an entry's stored value. Deliberately works for names that are
    /// no longer declared, so stale values can always be cleaned up.
    pub fn unset_config_entry(
        &mut self,
        name: &str,
        source: &str,
    ) -> SnapbackResult<ConfigWriteOutcome> {
        let outcome = self.config.unset(name)?;
        self.record_diagnostics(vec![
            Diagnostic::info(
                "SNAPBACK_CONFIG_WRITE",
                "config",
                format!("config entry {name} unset via {source}"),
            )
            .with_details(json!({
                "entry": name,
                "operation": "unset",
                "valueChanged": outcome.value_changed,
                "source": source,
            })),
        ]);
        Ok(ConfigWriteOutcome {
            entry: name.to_owned(),
            apply_state: "applied".to_owned(),
            value_changed: outcome.value_changed,
            generation: outcome.generation,
        })
    }

    /// Run an entry's probe action and record the verification outcome, all
    /// under the caller's borrow. The server route instead stages with
    /// [`Self::stage_config_verify`], runs an Ibex probe detached under the
    /// action watchdog, and records with [`Self::finish_config_verify`]
    /// (ENG-23493); this in-lock convenience remains for embedded use and
    /// tests.
    ///
    /// @ref LLP 0036#operations-and-projections-llp-0024 — probes run only on
    /// explicit verify, under cooldown, as ordinary actions with no special
    /// network powers; results land in verification state, never raw in logs.
    pub fn verify_config_entry(&mut self, name: &str) -> SnapbackResult<ConfigVerifyOutcome> {
        match self.stage_config_verify(name)? {
            StagedConfigVerify::Done(outcome) => Ok(*outcome),
            StagedConfigVerify::Ready(stage) => {
                let admission = stage.admission.clone();
                let result = match stage.mode {
                    StagedAction::HostPlan(prepared) => self.invoke_action_prepared(
                        &stage.probe,
                        stage.input,
                        stage.metadata,
                        prepared,
                    ),
                    StagedAction::Detached(action) => self.invoke_action_prepared(
                        &stage.probe,
                        stage.input,
                        stage.metadata,
                        action.invocation,
                    ),
                };
                self.finish_config_verify(
                    name,
                    stage.entry_revision,
                    stage.started_ms,
                    result,
                    admission,
                )
            }
        }
    }

    /// Stage a config-verify probe run: entry checks and the cooldown claim
    /// happen here, under the global mutex, so concurrent verifies linearize
    /// through the cooldown stamp even when the probe itself runs off-lock
    /// (ENG-23493).
    pub(crate) fn stage_config_verify(&mut self, name: &str) -> SnapbackResult<StagedConfigVerify> {
        let admission = self.admission.admit()?;
        let definition = self.config_definition(name)?.clone();
        let Some(probe) = definition.probe.clone() else {
            return Err(SnapbackError::error(
                "SNAPBACK_CONFIG_PROBE_MISSING",
                "config",
                format!("config entry {name} declares no probe action"),
            ));
        };
        if self.config.values(name).is_none() {
            return Err(SnapbackError::error(
                "SNAPBACK_CONFIG_MISSING",
                "config",
                format!("config entry {name} has no value set; set it before verifying"),
            ));
        }
        let entry_revision = self.config.entry_revision(name).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_CONFIG_MISSING",
                "config",
                format!("config entry {name} disappeared before verification staged"),
            )
        })?;
        let now = now_millis();
        {
            let _claim = admission.effect_guard("config verification cooldown claim")?;
            self.config.check_verify_cooldown(name, now)?;
        }
        let metadata = CronRunMetadata {
            job_name: format!("config-verify:{name}"),
            run_id: format!("config-verify:{name}:{now}"),
            scheduled_at_ms: None,
            due_at_ms: now,
            idempotency_key: format!("config-verify:{name}:{now}"),
            slot_key: format!("config-verify:{name}"),
            attempt: 1,
            trigger: CronRunTrigger::Manual,
        };
        let input = HandlerInput {
            args: json!({ "entry": name }),
            auth: Default::default(),
            read_set: Vec::new(),
            correlation: None,
            ctx_ledger: None,
        };
        let mode = match self.stage_action_invocation_with_admission(&probe, admission.clone()) {
            Ok(mode) => mode,
            // A probe that cannot stage (unknown function, non-action) is a
            // failed verification, exactly as the in-lock run reported it.
            Err(error) => {
                return Ok(StagedConfigVerify::Done(Box::new(
                    self.finish_config_verify(name, entry_revision, now, Err(error), admission)?,
                )));
            }
        };
        Ok(StagedConfigVerify::Ready(Box::new(ConfigVerifyStage {
            probe,
            entry_revision,
            started_ms: now,
            input,
            metadata,
            mode,
            admission,
        })))
    }

    /// Record the outcome of a probe run — in-lock or detached — as the
    /// entry's verification state and shape the `config.verify` envelope.
    pub(crate) fn finish_config_verify(
        &mut self,
        name: &str,
        entry_revision: u64,
        at_ms: u64,
        result: SnapbackResult<Value>,
        admission: AdmissionLease,
    ) -> SnapbackResult<ConfigVerifyOutcome> {
        #[cfg(test)]
        BEFORE_CONFIG_VERIFY_PUBLICATION_HOOK.with(|slot| {
            if let Some(hook) = slot.borrow_mut().take() {
                hook();
            }
        });
        let _publication = admission.effect_guard("config verification publication")?;
        let record = match result {
            Ok(value) => {
                let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(true);
                let diagnostic = if ok {
                    None
                } else {
                    Some(
                        self.config.redact_text(
                            value
                                .get("message")
                                .and_then(Value::as_str)
                                .unwrap_or("probe reported failure"),
                        ),
                    )
                };
                VerificationRecord {
                    ok,
                    at_ms,
                    diagnostic,
                }
            }
            Err(error) => {
                let error = self.config.redact_diagnostic(error.diagnostic);
                VerificationRecord {
                    ok: false,
                    at_ms,
                    diagnostic: Some(format!("{}: {}", error.code, error.message)),
                }
            }
        };
        if !self
            .config
            .record_verification_if_revision(name, entry_revision, record.clone())?
        {
            return Err(SnapbackError::error(
                "SNAPBACK_CONFIG_VERIFY_STALE",
                "config",
                format!(
                    "config entry {name} changed while its probe was running; the result was discarded"
                ),
            ));
        }
        self.record_diagnostics(vec![
            Diagnostic::info(
                "SNAPBACK_CONFIG_VERIFY",
                "config",
                format!(
                    "config entry {name} verification {}",
                    if record.ok { "succeeded" } else { "failed" }
                ),
            )
            .with_details(json!({ "entry": name, "ok": record.ok })),
        ]);
        Ok(ConfigVerifyOutcome {
            entry: name.to_owned(),
            ok: record.ok,
            verified: ConfigVerificationStatus::from(&record),
            generation: self.config.generation(),
        })
    }

    /// The granted-config payload for one action invocation: the function's
    /// `uses` entries (plus the entry a probe verifies, implicitly), with
    /// value material and a rotation cursor for pools.
    ///
    /// @ref LLP 0036#runtime-exposure-d5-d8 — grants are computed host-side
    /// per invocation; handler code never sees undeclared entries.
    fn config_grants(&mut self, function: &crate::manifest::FunctionDefinition) -> Value {
        let mut names: Vec<String> = function.uses.clone();
        for entry in &self.functions.config {
            if entry.probe.as_deref() == Some(function.name.as_str())
                && !names.contains(&entry.name)
            {
                names.push(entry.name.clone());
            }
        }
        let granted_defs: Vec<(String, bool)> = names
            .iter()
            .filter_map(|name| {
                self.functions
                    .config
                    .iter()
                    .find(|entry| &entry.name == name)
                    .map(|entry| (entry.name.clone(), entry.pool))
            })
            .collect();
        let mut entries = serde_json::Map::new();
        for (name, pool) in granted_defs {
            let values: Option<Vec<String>> = self.config.values(&name).map(<[String]>::to_vec);
            let granted = match values {
                Some(values) if !values.is_empty() => {
                    let cursor = if pool {
                        self.config.next_rotation_cursor(&name)
                    } else {
                        0
                    };
                    json!({ "set": true, "values": values, "cursor": cursor })
                }
                _ => json!({ "set": false }),
            };
            entries.insert(name, granted);
        }
        json!({ "entries": entries })
    }

    /// The kind of a loaded function, if any. Used by the admin function runner
    /// to decide whether a run is a read (query) or a write (mutation).
    pub fn function_kind(&self, name: &str) -> Option<FunctionKind> {
        self.functions
            .function(name)
            .map(|function| function.kind.clone())
    }

    pub fn register_ephemeral_collection(
        &mut self,
        collection: EphemeralCollection,
    ) -> Result<(), crate::ephemeral::EphemeralError> {
        validate_collection_definitions(std::slice::from_ref(&collection))?;
        // @ref LLP 0053#ephemeral-room-authority-invalidation — dynamic
        // registration must preserve the same permissionFields/projection
        // closure as manifest publication or invalidation can miss a room.
        validate_collection_permission_backing(
            std::slice::from_ref(&collection),
            &self.db.schema().tables,
            self.db.schema().effective_auth_mode() == AuthMode::Sessions,
        )?;
        self.ephemeral.register_collection(collection)
    }

    pub fn ensure_ephemeral_collections(
        &mut self,
        collections: Vec<EphemeralCollection>,
    ) -> Result<CollectionEnsureOutcome, crate::ephemeral::EphemeralError> {
        validate_collection_definitions(&collections)?;
        validate_collection_permission_backing(
            &collections,
            &self.db.schema().tables,
            self.db.schema().effective_auth_mode() == AuthMode::Sessions,
        )?;
        self.ephemeral.ensure_collections(collections)
    }

    pub fn publish_ephemeral(
        &mut self,
        request: PublishRequest,
        now_ms: u64,
    ) -> Result<PublishOutcome, crate::ephemeral::EphemeralError> {
        self.touch_connection(&request.connection_id, now_ms);
        self.ephemeral.publish(request, now_ms)
    }

    pub fn subscribe_ephemeral(
        &mut self,
        request: SubscribeRequest,
        now_ms: u64,
    ) -> Result<EphemeralMessage, crate::ephemeral::EphemeralError> {
        self.touch_connection(&request.connection_id, now_ms);
        self.ephemeral.subscribe(request, now_ms)
    }

    pub fn delete_ephemeral(
        &mut self,
        request: DeleteRequest,
        now_ms: u64,
    ) -> Result<Option<EphemeralMessage>, crate::ephemeral::EphemeralError> {
        self.touch_connection(&request.connection_id, now_ms);
        self.ephemeral.delete(request, now_ms)
    }

    /// Direct-library compatibility orchestrator. Production transport code
    /// uses the explicit [`EphemeralApi::disconnect`] and
    /// [`Self::disconnect_topology_for_transport`] phases because it owns a
    /// `LocalSnapbackWriteScope`; invoking this compatibility seam from such a
    /// scope fails loudly in debug/test builds.
    pub fn disconnect(&mut self, connection_id: &str, now_ms: u64) {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "LocalSnapback::disconnect compatibility orchestration",
        );
        let ephemeral = self.ephemeral_api();
        ephemeral.disconnect(connection_id, now_ms);
        let topology = self.disconnect_topology_for_transport(connection_id, now_ms);
        ephemeral.enqueue_disconnected_subscription_resync(connection_id, &topology);
    }

    /// Direct-library compatibility form of generation-guarded teardown. The
    /// production WebSocket path performs its guarded ephemeral phase before
    /// taking LocalSnapback and calls only the topology method below.
    pub fn disconnect_guarded(&mut self, connection_id: &str, now_ms: u64) {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "LocalSnapback::disconnect_guarded compatibility orchestration",
        );
        let ephemeral = self.ephemeral_api();
        ephemeral.disconnect_guarded(connection_id, now_ms);
        self.disconnect_topology_for_transport(connection_id, now_ms);
    }

    /// Retire only LocalSnapback-owned connection topology. Callers must run
    /// the [`EphemeralApi`] disconnect phase outside Local before entering
    /// this method; no activity, notifier, room, outbox, or rate-bucket lock
    /// is acquired here.
    pub(crate) fn disconnect_topology_for_transport(
        &mut self,
        connection_id: &str,
        now_ms: u64,
    ) -> DisconnectedConnectionTopology {
        self.terminalize_local_live_effects(connection_id, None);
        // A connection's durable live subscriptions are dead once the connection
        // goes away — there is no way to deliver further deltas. Dropping them lets
        // a demand-activated cron job deactivate when its last watcher leaves.
        // @ref LLP 0028#activation-policy — whileLive activation must report
        //   inactive:no-demand once no subscription to the named live query remains.
        // Disposed-by-disconnect markers go to the GLOBAL ring (the
        // connection's own ring dies with it) — LLP 0034 §3 / ENG-22478.
        // No storage read here: disconnect runs on the WebSocket teardown
        // path (an async worker; the L7 exec guard forbids rusqlite there),
        // and a version-at-death fact is cosmetic — null is the honest value.
        let mut dropped_subscriptions = 0_usize;
        let dropped_effect_fences = self
            .subscriptions
            .values()
            .filter(|subscription| subscription.connection_id == connection_id)
            .filter_map(|subscription| subscription.effect_fence.clone())
            .collect::<BTreeSet<_>>();
        let retired_authorization_scopes = self
            .subscriptions
            .values()
            .filter(|subscription| subscription.connection_id == connection_id)
            .filter_map(|subscription| {
                subscription
                    .authorization
                    .as_ref()
                    .map(|authorization| authorization.scope_id.clone())
            })
            .collect::<Vec<_>>();
        for subscription in self
            .subscriptions
            .values()
            .filter(|subscription| subscription.connection_id == connection_id)
        {
            dropped_subscriptions += 1;
            self.receipts.push_global(
                Receipt::Subscription {
                    event: SubscriptionReceiptEvent::Disposed,
                    reason: Some("disconnected".to_owned()),
                    subscription_id: Some(subscription.id.clone()),
                    superseded_by: None,
                    lane: None,
                    binding_id: None,
                    collection: None,
                    removed: None,
                    scope: subscription.input.args.clone(),
                    snapshot_version: None,
                    correlation: None,
                    received_at_ms: now_ms,
                }
                .into_value(),
            );
        }
        self.subscriptions
            .retain(|_, subscription| subscription.connection_id != connection_id);
        self.refresh_auth_scoped_live_connections();
        if let Some(state) = self.auth_invalidation.as_mut() {
            for scope in retired_authorization_scopes {
                let _ = state.obligations.retire_scope(&scope);
            }
        }
        self.receipts.drop_connection(connection_id);
        // Losing the last watcher of a demand-gated live query disarms its cron
        // job (L5).
        self.refresh_cron_active();
        DisconnectedConnectionTopology {
            dropped_subscriptions,
            dropped_effect_fences,
        }
    }

    /// Ephemeral delivery diagnostics for the receipts surface (LLP 0034
    /// §3.2: coalesced_updates as a receipt-visible fact).
    pub fn ephemeral_diagnostics(&mut self) -> EphemeralDiagnostics {
        self.ephemeral.diagnostics()
    }

    pub fn cleanup_ephemeral(&mut self, now_ms: u64) {
        self.ephemeral.cleanup_expired(now_ms);
    }

    /// Tick the cron scheduler, routing the tick machinery's *own* errors
    /// (claim/persist failures) into the diagnostics ring with a counter
    /// instead of dropping them. Failed cron *runs* already record diagnostics
    /// inside `execute_cron_claims`; this closes the gap where `tick_cron`'s
    /// Err was silently swallowed by the 1s ticker.
    ///
    /// @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D11.
    pub fn tick_cron_recording(&mut self, now_ms: u64) -> Vec<CronRunRecord> {
        match self.tick_cron(now_ms) {
            Ok(records) => records,
            Err(error) => {
                self.record_cron_tick_error(error);
                Vec::new()
            }
        }
    }

    /// Count of swallowed-then-recorded cron tick errors, surfaced for tests
    /// and inspection.
    pub fn cron_tick_errors(&self) -> u64 {
        self.cron_tick_errors
    }

    pub fn tick_cron(&mut self, now_ms: u64) -> SnapbackResult<Vec<CronRunRecord>> {
        let claims = self.claim_due_cron_runs(now_ms)?;
        self.execute_cron_claims(claims)
    }

    /// Claim (and persist) the due cron runs without executing them. The
    /// server's detached cron flow uses this as the first lock window; the
    /// claims then execute off the global mutex and land back through
    /// [`Self::finish_cron_claim`] (ENG-23324).
    pub(crate) fn claim_due_cron_runs(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<Vec<AdmittedCronClaim>> {
        // Admission precedes the scheduler mutation and its durable claim
        // write. If a close races while a multi-job batch is being assembled,
        // acquisition of any remaining per-claim root fails and the in-memory
        // scheduler rolls back before persistence.
        let first_admission = self.admission.admit()?;
        let active_live_functions = self.active_live_functions();
        let before_claim = self.cron.clone();
        let claims = self
            .cron
            .claim_due_runs(&self.functions, &active_live_functions, now_ms);
        if claims.is_empty() {
            let effect = match first_admission.effect_guard("cron scheduler state publication") {
                Ok(effect) => effect,
                Err(error) => {
                    self.cron = before_claim;
                    return Err(error);
                }
            };
            if let Err(error) = self.persist_cron_state() {
                self.cron = before_claim;
                return Err(error);
            }
            drop(effect);
            return Ok(Vec::new());
        }
        let mut admissions = Vec::with_capacity(claims.len());
        admissions.push(first_admission);
        for _ in 1..claims.len() {
            match self.admission.admit() {
                Ok(admission) => admissions.push(admission),
                Err(error) => {
                    self.cron = before_claim;
                    return Err(error);
                }
            }
        }
        let effect = match admissions[0].effect_guard("cron claim publication") {
            Ok(effect) => effect,
            Err(error) => {
                self.cron = before_claim;
                return Err(error);
            }
        };
        if let Err(error) = self.persist_cron_state() {
            self.cron = before_claim;
            return Err(error);
        }
        drop(effect);
        Ok(claims
            .into_iter()
            .zip(admissions)
            .map(|(claim, admission)| AdmittedCronClaim { claim, admission })
            .collect())
    }

    /// Claim (and persist) a manual run of one cron job — the detached-flow
    /// counterpart of [`Self::run_cron_job_now`]'s claim step (ENG-23324).
    pub(crate) fn claim_manual_cron_run(
        &mut self,
        name: &str,
        now_ms: u64,
    ) -> SnapbackResult<AdmittedCronClaim> {
        let admission = self.admission.admit()?;
        let before_claim = self.cron.clone();
        let claim = self.cron.claim_manual_run(&self.functions, name, now_ms)?;
        let effect = match admission.effect_guard("manual cron claim publication") {
            Ok(effect) => effect,
            Err(error) => {
                self.cron = before_claim;
                return Err(error);
            }
        };
        if let Err(error) = self.persist_cron_state() {
            self.cron = before_claim;
            return Err(error);
        }
        drop(effect);
        Ok(AdmittedCronClaim { claim, admission })
    }

    /// Route a cron tick's *machinery* error (claim/persist/finish failure)
    /// into the diagnostics ring with a counter — the same policy as
    /// [`Self::tick_cron_recording`], callable from the server's detached
    /// cron flow.
    pub(crate) fn record_cron_tick_error(&mut self, error: SnapbackError) {
        self.cron_tick_errors += 1;
        self.record_diagnostics(vec![error.diagnostic]);
    }

    /// Record a retryable maintenance failure without retaining the underlying
    /// error message (which may contain room identity or application text).
    /// Counters advance for every failure; the bounded diagnostic ring receives
    /// at most one classification per operation per minute.
    pub(crate) fn record_maintenance_error(
        &mut self,
        operation: MaintenanceOperation,
        error: &SnapbackError,
        now_ms: u64,
    ) {
        let (count, last_failure, last_reported, code, message) = match operation {
            MaintenanceOperation::PermissionResolution => (
                &mut self.maintenance.permission_resolution_failures,
                &mut self.maintenance.last_permission_resolution_failure_ms,
                &mut self.maintenance_permission_reported_at_ms,
                "SNAPBACK_MAINTENANCE_PERMISSION_RESOLUTION_FAILED",
                "maintenance permission resolution failed; retry remains pending",
            ),
            MaintenanceOperation::JournalPrune => (
                &mut self.maintenance.journal_prune_failures,
                &mut self.maintenance.last_journal_prune_failure_ms,
                &mut self.maintenance_prune_reported_at_ms,
                "SNAPBACK_MAINTENANCE_JOURNAL_PRUNE_FAILED",
                "change-journal pruning failed; retry remains scheduled",
            ),
        };
        *count = count.saturating_add(1);
        *last_failure = Some(now_ms);
        let should_report = last_reported.is_none_or(|reported| {
            now_ms.saturating_sub(reported) >= MAINTENANCE_DIAGNOSTIC_MIN_INTERVAL_MS
        });
        if should_report {
            *last_reported = Some(now_ms);
            let diagnostic =
                Diagnostic::warning(code, "maintenance", message).with_details(json!({
                    "causeCode": error.diagnostic.code.clone(),
                    "failureCount": *count,
                }));
            self.record_diagnostics(vec![diagnostic]);
        }
    }

    pub fn run_cron_job_now(&mut self, name: &str, now_ms: u64) -> SnapbackResult<CronRunRecord> {
        let claim = self.claim_manual_cron_run(name, now_ms)?;
        let mut records = self.execute_cron_claims(vec![claim])?;
        records.pop().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_CRON_RUN_RECORD_MISSING",
                "cron",
                format!("cron job {name} did not produce a run record"),
            )
        })
    }

    pub fn drain_outbox(&mut self, connection_id: &str) -> Vec<RealtimeEnvelope> {
        // An unfenced poll remains a liveness signal but cannot extract app
        // data whose final publication must cross an authorization fence.
        self.touch_connection(connection_id, now_millis());
        self.ephemeral.drain_outbox(connection_id)
    }

    /// Guarded destructive drain for an embedding-owned transport. Retain
    /// each returned wrapper through the final transport sink.
    pub fn drain_outbox_for_send(
        &mut self,
        connection_id: &str,
    ) -> Vec<crate::ephemeral::AdmittedRealtimeEnvelope> {
        self.touch_connection(connection_id, now_millis());
        self.ephemeral.drain_outbox_for_send(connection_id)
    }

    fn enqueue_subscription_durable(
        &self,
        subscription: &LiveSubscription,
        payload: Vec<u8>,
    ) -> crate::ephemeral::DurableEnqueueOutcome {
        match subscription.effect_fence.clone() {
            Some(effect_fence) => self.ephemeral.enqueue_durable_bound(
                subscription.connection_id.clone(),
                payload,
                effect_fence,
            ),
            None => self
                .ephemeral
                .enqueue_durable(subscription.connection_id.clone(), payload),
        }
    }

    fn enqueue_subscription_authorized_durable(
        &self,
        subscription: &LiveSubscription,
        payload: Vec<u8>,
        authorization: crate::storage::AuthorizationVersion,
    ) -> crate::ephemeral::DurableEnqueueOutcome {
        match subscription.effect_fence.clone() {
            Some(effect_fence) => self.ephemeral.enqueue_authorized_durable_bound(
                subscription.connection_id.clone(),
                payload,
                authorization,
                effect_fence,
            ),
            None => self.ephemeral.enqueue_authorized_durable(
                subscription.connection_id.clone(),
                payload,
                authorization,
            ),
        }
    }

    #[cfg(test)]
    pub(crate) fn purge_connection_effects(
        &mut self,
        connection_id: &str,
        effect_fence: &crate::ephemeral::ConnectionEffectFence,
    ) {
        self.purge_connection_topology(connection_id, effect_fence);
        self.ephemeral
            .purge_connection_effects(connection_id, effect_fence);
    }

    /// Retire only global-mutex-owned subscription and invalidation topology.
    /// Terminal lifecycle code performs the room/outbox purge separately
    /// before acquiring `SharedSnapback`, preserving the no-overlap lock rule.
    ///
    /// @ref LLP 0059#prohibited-overlap — terminal topology cleanup never
    /// reacquires room/outbox authority beneath the global writer mutex.
    pub(crate) fn purge_connection_topology(
        &mut self,
        connection_id: &str,
        effect_fence: &crate::ephemeral::ConnectionEffectFence,
    ) {
        self.terminalize_local_live_effects(connection_id, Some(effect_fence));
        let retired_scopes = self
            .subscriptions
            .values()
            .filter(|subscription| {
                subscription.connection_id == connection_id
                    && subscription.effect_fence.as_ref() == Some(effect_fence)
            })
            .filter_map(|subscription| {
                subscription
                    .authorization
                    .as_ref()
                    .map(|authorization| authorization.scope_id.clone())
            })
            .collect::<Vec<_>>();
        self.subscriptions.retain(|_, subscription| {
            subscription.connection_id != connection_id
                || subscription.effect_fence.as_ref() != Some(effect_fence)
        });
        if let Some(state) = self.auth_invalidation.as_mut() {
            for scope in retired_scopes {
                let _ = state.obligations.retire_scope(&scope);
            }
        }
        self.refresh_auth_scoped_live_connections();
        self.refresh_cron_active();
    }

    /// Record connection activity for the L2 reaper.
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L2 liveness.
    fn touch_connection(&mut self, connection_id: &str, now_ms: u64) {
        self.connections_last_seen.touch(connection_id, now_ms);
    }

    /// The lock-free ephemeral lane handle for the server: room authority plus
    /// liveness map, cloneable and usable from any thread without the global
    /// mutex (LLP 0026 Phase 2 / LLP 0032 L9).
    pub fn ephemeral_api(&self) -> EphemeralApi {
        EphemeralApi {
            store: self.ephemeral.clone(),
            activity: self.connections_last_seen.clone(),
        }
    }

    pub(crate) fn managed_local_handoff(&self) -> Arc<crate::exec_guard::ManagedLocalHandoff> {
        self.managed_local_handoff.clone()
    }

    #[cfg(test)]
    pub(crate) fn auth_invalidation_expectation_for_test(
        &self,
    ) -> Option<crate::storage::AuthorizationVersion> {
        self.auth_invalidation
            .as_ref()
            .map(|state| state.obligations.expectation().authorization.clone())
    }

    // Compatibility projection for callers that do not consume the observed
    // authorization version returned by authorize_ephemeral_room_observed.
    #[allow(dead_code)]
    pub(crate) fn authorize_ephemeral_room(
        &self,
        collection_name: &str,
        scope: &crate::ephemeral::Scope,
        base_auth: AuthContext,
    ) -> SnapbackResult<AuthContext> {
        self.authorize_ephemeral_room_observed(collection_name, scope, base_auth)
            .map(|(auth, _)| auth)
    }

    /// Resolve one protected room permission together with the exact
    /// authorization epoch observed by the durable read. The transport uses
    /// that witness after acquiring its room permit: equality linearizes the
    /// read before a later commit, while drift forces a fresh read.
    pub(crate) fn authorize_ephemeral_room_observed(
        &self,
        collection_name: &str,
        scope: &crate::ephemeral::Scope,
        base_auth: AuthContext,
    ) -> SnapbackResult<(AuthContext, crate::storage::AuthorizationVersion)> {
        let collection = self
            .ephemeral
            .collection_definition(collection_name)
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_EPHEMERAL_UNKNOWN_COLLECTION",
                    "ephemeral",
                    "ephemeral collection is not loaded",
                )
            })?;
        if !self
            .ephemeral
            .collection_requires_room_permission(collection_name)
        {
            let authorization = self
                .auth_invalidation
                .as_ref()
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                        "auth",
                        "room authorization requires installed invalidation state",
                    )
                })?
                .issuer
                .authorization_expectation()?;
            return Ok((base_auth, authorization));
        }
        let projection = collection.permission_backing.as_ref().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                "auth",
                "protected room lacks its durable permissionBacking projection",
            )
        })?;
        if !self.room_permission_projection_granted(
            projection,
            scope,
            &base_auth,
            self.db.current_version()?,
        )? {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_PERMISSION_DENIED",
                "auth",
                "durable room permission was denied",
            ));
        }
        let authorization = self
            .auth_invalidation
            .as_ref()
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                    "auth",
                    "protected room authorization requires installed invalidation state",
                )
            })?
            .issuer
            .authorization_expectation()?;
        Ok((
            collection.grant_projected_room_permission(base_auth, scope),
            authorization,
        ))
    }

    #[cfg(test)]
    pub(crate) fn reauthorize_pending_ephemeral_rooms<Resolve>(
        &mut self,
        mut resolve_connection: Resolve,
    ) -> SnapbackResult<usize>
    where
        Resolve: FnMut(&str, &AuthContext) -> SnapbackResult<Option<AuthContext>>,
    {
        let pending = self.ephemeral.pending_room_reauthorizations();
        let mut completed = 0_usize;
        for room in pending {
            let fresh = room
                .subscribers
                .iter()
                .map(|subscriber| {
                    resolve_connection(&subscriber.connection_id, &subscriber.previous_auth)
                })
                .collect::<SnapbackResult<Vec<_>>>()?;
            let room_id = room.room.clone();
            let generation = room.obligation.room_authority_generation;
            let resolutions = self.resolve_pending_ephemeral_room_permissions(room, fresh)?;
            if self
                .ephemeral
                .complete_room_reauthorization(&room_id, generation, resolutions)?
            {
                completed = completed.saturating_add(1);
            }
        }
        Ok(completed)
    }

    pub(crate) fn resolve_pending_ephemeral_room_permissions(
        &self,
        room: crate::ephemeral::PendingRoomReauthorization,
        fresh_authorities: Vec<Option<AuthContext>>,
    ) -> SnapbackResult<Vec<RoomSubscriberResolution>> {
        if room.subscribers.len() != fresh_authorities.len() {
            return Err(SnapbackError::error(
                "SNAPBACK_EPHEMERAL_REAUTHORIZATION_INCOMPLETE",
                "ephemeral",
                "room permission phase requires one authority result per snapshotted subscriber",
            ));
        }
        let collection = self
            .ephemeral
            .collection_definition(&room.room.collection)
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_EPHEMERAL_UNKNOWN_COLLECTION",
                    "ephemeral",
                    "pending room collection is no longer loaded",
                )
            })?;
        let projection = collection.permission_backing.as_ref().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                "auth",
                "pending protected room lacks its durable permissionBacking projection",
            )
        })?;
        let mut resolutions = Vec::with_capacity(room.subscribers.len());
        for (subscriber, fresh) in room.subscribers.into_iter().zip(fresh_authorities) {
            let Some(fresh) = fresh else {
                resolutions.push(RoomSubscriberResolution::Denied {
                    connection_id: subscriber.connection_id,
                    expected_effect_fence: subscriber.effect_fence,
                });
                continue;
            };
            let granted = self.room_permission_projection_granted(
                projection,
                &room.room.scope,
                &fresh,
                room.obligation.min_commit_version,
            )?;
            if granted {
                resolutions.push(RoomSubscriberResolution::Authorized {
                    connection_id: subscriber.connection_id,
                    expected_effect_fence: subscriber.effect_fence,
                    auth: collection.grant_projected_room_permission(fresh, &room.room.scope),
                });
            } else {
                resolutions.push(RoomSubscriberResolution::Denied {
                    connection_id: subscriber.connection_id,
                    expected_effect_fence: subscriber.effect_fence,
                });
            }
        }
        Ok(resolutions)
    }

    fn room_permission_projection_granted(
        &self,
        projection: &RoomPermissionProjection,
        scope: &crate::ephemeral::Scope,
        auth: &AuthContext,
        min_commit_version: u64,
    ) -> SnapbackResult<bool> {
        let Some(user_id) = auth.user_id.as_deref() else {
            return Ok(false);
        };
        let scope_fields = projection
            .scope_fields
            .iter()
            .map(|(scope_field, table_field)| {
                scope
                    .get(scope_field)
                    .map(|value| (table_field.clone(), value.to_owned()))
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_EPHEMERAL_INVALID_SCOPE",
                            "ephemeral",
                            "room scope does not satisfy its permissionBacking projection",
                        )
                    })
            })
            .collect::<SnapbackResult<Vec<_>>>()?;
        self.db.room_permission_projection_granted(
            &projection.table,
            &projection.subject_field,
            user_id,
            &scope_fields,
            min_commit_version,
        )
    }

    /// Direct-library compatibility reaper. Server maintenance discovers and
    /// disconnects stale ids through [`EphemeralApi`] before entering Local;
    /// this combined form is forbidden from a managed Local writer scope.
    pub fn reap_stale_connections(&mut self, now_ms: u64, ttl_ms: u64) -> usize {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "LocalSnapback::reap_stale_connections compatibility orchestration",
        );
        let ephemeral = self.ephemeral_api();
        let stale = ephemeral.stale_connection_ids(now_ms, ttl_ms);
        for connection_id in &stale {
            ephemeral.disconnect(connection_id, now_ms);
        }
        for connection_id in &stale {
            let topology = self.disconnect_topology_for_transport(connection_id, now_ms);
            ephemeral.enqueue_disconnected_subscription_resync(connection_id, &topology);
        }
        self.record_reaped_connections(stale.len());
        stale.len()
    }

    /// Record topology retirements selected by the off-Local activity reaper.
    /// Stale-id discovery and [`EphemeralApi::disconnect`] happen before the
    /// server enters LocalSnapback; this method preserves `/inspect` counters
    /// without reacquiring any activity or ephemeral shard lock.
    pub(crate) fn record_reaped_connections(&mut self, count: usize) {
        self.reaped_connections = self.reaped_connections.saturating_add(count as u64);
    }

    pub fn active_connection_count(&self) -> usize {
        self.connections_last_seen.len()
    }

    pub fn reaped_connection_count(&self) -> u64 {
        self.reaped_connections
    }

    /// Prune the change journal to its retention window (L3). Delegates to
    /// storage; called from the periodic maintenance worker.
    pub fn prune_change_journal(
        &self,
        now_ms: u64,
        retain_versions: u64,
        retain_ms: u64,
    ) -> SnapbackResult<u64> {
        self.db
            .prune_change_journal(now_ms, retain_versions, retain_ms)
    }

    pub fn change_journal_len(&self) -> SnapbackResult<u64> {
        self.db.change_journal_len()
    }

    pub fn journal_floor_version(&self) -> SnapbackResult<u64> {
        self.db.journal_floor_version()
    }

    /// Whether a version-based resume from `from_version` must resnapshot
    /// because the journal no longer retains the needed changes (L3).
    pub fn journal_resume_requires_resnapshot(&self, from_version: u64) -> SnapbackResult<bool> {
        self.db.resume_requires_resnapshot(from_version)
    }

    pub fn explain_table_change_version_plan(&self, table: &str) -> SnapbackResult<String> {
        self.db.explain_table_change_version_plan(table)
    }

    pub fn table_change_version(&self, table: &str) -> SnapbackResult<u64> {
        self.db.table_change_version(table)
    }

    /// The delivery notifier the WebSocket task registers with, so a push wakes
    /// it immediately instead of waiting for a poll (L8).
    pub fn delivery_notifier(&self) -> Arc<DeliveryNotifier> {
        self.ephemeral.delivery_notifier()
    }

    pub fn drain_live_stream(&mut self, connection_id: &str) -> Vec<String> {
        self.drain_outbox(connection_id)
            .into_iter()
            .filter_map(live_stream_text)
            .collect()
    }

    fn from_database(mut db: LocalDatabase) -> SnapbackResult<Self> {
        // LocalSnapback is the auth-capable embedding boundary. Complete the
        // explicit stream migration here, before the instance can disappear
        // behind a managed server mutex; managed authorization writes may then
        // stage an exact predecessor snapshot without attempting SQLite setup
        // while Local is held.
        // @ref LLP 0059#durable-authorization-stream — both dev and sessions
        // create the stream record before an app-data listener can bind.
        db.ensure_authorization_stream_incarnation()?;
        // @ref LLP 0076#settlement-and-retry — the startup reconciler: a
        // persisted StreamAttemptV1 row whose runner died with its process is
        // settled `failed` with the conservative effect fact folded from the
        // write-ahead cursor pre-marks, so a durable winner exists before any
        // new runner can start against the same client key.
        {
            let rows = db.load_stream_attempts()?;
            let mut reconciled = Vec::new();
            for (token, client_key, record_json) in rows {
                if let Some(updated) =
                    crate::stream_attempt::reconcile_orphaned_record(&record_json)
                {
                    reconciled.push((token, client_key, updated));
                }
            }
            if !reconciled.is_empty() {
                db.upsert_stream_attempts(&reconciled, now_millis())?;
            }
        }
        let runtime = RuntimeManager::detect();
        let cron = LocalCronRuntime::from_persisted(db.load_cron_state()?)?;
        let auth_mode = db.auth_mode_snapshot()?.state;
        let admission = AdmissionController::from_mode_state(&auth_mode)?;
        let mut recent_diagnostics = VecDeque::new();
        for diagnostic in runtime.diagnostics() {
            recent_diagnostics.push_back(diagnostic);
        }

        let read_manifests = Arc::new(RwLock::new(Arc::new(ReadManifests {
            functions: FunctionManifest::default(),
            schema: db.schema().clone(),
            capabilities: runtime.capabilities().clone(),
        })));

        let app_generation = next_app_generation()?;
        // @ref LLP 0091#0a1-token-envelope-mac-keyring-custody-expiry — the
        // local-arm resume keyring is a `secure_file` sidecar beside the
        // database, separate from the auth keyring; in-memory instances mint
        // a per-process ring (their tokens die with the process — fine, key
        // loss is availability-only).
        let resume_keyring = Arc::new(RwLock::new(match db.database_path() {
            Some(path) => crate::rqs::ResumeKeyring::load_or_create(
                path.with_file_name(crate::rqs::RESUME_KEYRING_FILE_NAME),
                now_millis(),
            ),
            None => crate::rqs::ResumeKeyring::in_memory(now_millis()),
        }));
        static STREAM_ATTEMPT_NAMESPACE: std::sync::atomic::AtomicUsize =
            std::sync::atomic::AtomicUsize::new(1);
        Ok(Self {
            db,
            stream_attempt_namespace: STREAM_ATTEMPT_NAMESPACE
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            functions: FunctionManifest::default(),
            preflighted_artifact_pairs: VecDeque::new(),
            functions_loaded: false,
            config: ConfigStore::in_memory(),
            runtime,
            ephemeral: LocalEphemeralBackend::new(),
            managed_local_handoff: Arc::new(crate::exec_guard::ManagedLocalHandoff::default()),
            cron,
            subscriptions: BTreeMap::new(),
            pending_local_live_effects: BTreeMap::new(),
            permission_epochs: BTreeMap::new(),
            live_delivery: LiveDeliveryStats::default(),
            recent_diagnostics,
            cron_tick_errors: 0,
            maintenance: MaintenanceDiagnostics::default(),
            maintenance_permission_reported_at_ms: None,
            maintenance_prune_reported_at_ms: None,
            cron_active: Arc::new(AtomicBool::new(false)),
            last_persisted_cron: None,
            cron_state_writes: 0,
            connections_last_seen: ConnectionActivity::default(),
            reaped_connections: 0,
            warm_vms: Arc::new(crate::warm_vm::WarmVmPool::from_env()),
            admission,
            app_generation,
            app_generation_fence: Arc::new(AtomicU64::new(app_generation)),
            secret_read_reset_generation: Arc::new(AtomicU64::new(1)),
            auth_invalidation: None,
            read_manifests,
            read_epochs: Arc::new(RwLock::new(Arc::new(BTreeMap::new()))),
            auth_scoped_live_connections: Arc::new(RwLock::new(Arc::new(BTreeSet::new()))),
            receipts: ReceiptLog::default(),
            resume_keyring,
            rqs_replay_policy: RqsReplayPolicy::default(),
            rqs_generation: None,
            routes: None,
            routes_manifest_hash: None,
        })
    }

    fn function(&self, name: &str) -> SnapbackResult<&crate::manifest::FunctionDefinition> {
        self.functions.function(name).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_UNKNOWN_FUNCTION",
                "runtime",
                format!("unknown function {name}"),
            )
        })
    }

    pub(crate) fn function_is_authority_independent(&self, name: &str) -> bool {
        self.functions
            .function(name)
            .is_some_and(|function| function.authority_independent)
    }

    /// A handle to the lock-free read lane. Cloneable; shares the manifest
    /// snapshot, permission-epoch snapshot, and the WAL reader pool (which is
    /// `None` for in-memory databases — callers fall back to the write lane).
    ///
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6.
    pub fn read_lane(&self) -> ReadLane {
        ReadLane {
            manifests: self.read_manifests.clone(),
            epochs: self.read_epochs.clone(),
            auth_scoped_live_connections: self.auth_scoped_live_connections.clone(),
            pool: self.db.reader_pool(),
            warm_vms: self.warm_vms.clone(),
            admission: self.admission.clone(),
            secret_read_reset_generation: self.secret_read_reset_generation.clone(),
            resume_keyring: self.resume_keyring.clone(),
        }
    }

    fn premark_auth_scoped_live_connection(&self, connection_id: &str) {
        let mut projection = self
            .auth_scoped_live_connections
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if projection.contains(connection_id) {
            return;
        }
        let mut next = projection.as_ref().clone();
        next.insert(connection_id.to_owned());
        *projection = Arc::new(next);
    }

    fn refresh_auth_scoped_live_connections(&self) {
        let next = self
            .subscriptions
            .values()
            .filter(|subscription| subscription.authorization.is_some())
            .map(|subscription| subscription.connection_id.clone())
            .collect::<BTreeSet<_>>();
        *self
            .auth_scoped_live_connections
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Arc::new(next);
    }

    /// Force the fresh-VM path for this instance (what `SNAPBACK_FRESH_VM=1`
    /// samples into at construction). Used by the bench harness to keep the
    /// `vm_cost_us` metric's fresh-create definition, and by tests to pin the
    /// opt-out semantics without process-global env mutation.
    pub(crate) fn set_warm_vms_enabled(&self, enabled: bool) {
        self.warm_vms.set_enabled(enabled);
    }

    /// Refresh the read lane's manifest snapshot. Called after schema or
    /// function loads commit, while the caller still holds the global mutex,
    /// so successive refreshes cannot reorder. A reader that raced the commit
    /// sees the previous snapshot — indistinguishable from having arrived a
    /// moment earlier.
    fn refresh_read_manifests(&self) {
        let snapshot = Arc::new(ReadManifests {
            functions: self.functions.clone(),
            schema: self.db.schema().clone(),
            capabilities: self.runtime.capabilities().clone(),
        });
        *self
            .read_manifests
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = snapshot;
    }

    /// Refresh the read lane's permission-epoch snapshot after epochs advance
    /// (post-commit, still under the global mutex — same ordering argument as
    /// [`Self::refresh_read_manifests`]).
    fn refresh_read_epochs(&self) {
        let snapshot = Arc::new(self.permission_epochs.clone());
        *self
            .read_epochs
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = snapshot;
    }

    fn execute_cron_claims(
        &mut self,
        claims: Vec<AdmittedCronClaim>,
    ) -> SnapbackResult<Vec<CronRunRecord>> {
        let mut records = Vec::new();
        for claim in claims {
            let started_wall_ms = now_millis();
            let function = self.function(&claim.job.action)?.clone();
            let admission = claim.admission_lease().clone();
            let active_mode = admission
                .active_mode()
                .expect("LocalSnapback admissions are always controller-managed");
            let authority = InvocationGate::prepare_admitted_authority(
                InvocationSource::Cron,
                active_mode,
                ServerProfile::Dev,
                admission,
                &WireAuthorityFields::default(),
                ResolvedAppAuthority::System,
            )?;
            let prepared = InvocationGate::prepare_function(authority, &function)?;
            let result = self
                .invoke_action_prepared(
                    &claim.job.action,
                    cron_claim_input(&claim),
                    claim.metadata.clone(),
                    prepared,
                )
                .map_err(|error| error.diagnostic);
            records.push(self.finish_cron_claim(claim, started_wall_ms, result)?);
        }
        Ok(records)
    }

    /// Record the outcome of one claimed cron run: finish the claim, persist
    /// cron state, and route a failed run's diagnostic into the ring. Split
    /// from [`Self::execute_cron_claims`] so the server can execute the claim
    /// *between* the claim and finish lock windows — off the global mutex —
    /// for Ibex actions that may perform egress (ENG-23324).
    pub(crate) fn finish_cron_claim(
        &mut self,
        claim: AdmittedCronClaim,
        started_wall_ms: u64,
        result: Result<Value, Diagnostic>,
    ) -> SnapbackResult<CronRunRecord> {
        let admission = claim.admission_lease().clone();
        let _publication = admission.effect_guard("cron result ledger publication")?;
        // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D8
        // (semantics LLP 0029 G6): measure real wall-clock around the run so
        // durationMs is not always zero. finished_at stays logically
        // consistent with the claim's start (start + elapsed), so a run's
        // duration reflects actual execution time on any clock the caller
        // stamped the claim with.
        let result = result.map_err(|diagnostic| self.config.redact_diagnostic(diagnostic));
        let elapsed_ms = now_millis().saturating_sub(started_wall_ms);
        let finished_at_ms = claim.started_at_ms.saturating_add(elapsed_ms);
        let record = self.cron.finish_run(claim.claim, finished_at_ms, result);
        self.persist_cron_state()?;
        if record.outcome == CronRunOutcome::Failed
            && let Some(diagnostic) = &record.diagnostic
        {
            self.record_diagnostics(vec![diagnostic.clone()]);
        }
        Ok(record)
    }

    /// Capture a stored HostPlan action for managed execution without keeping
    /// the global instance mutex across its sequence of nested commits. Each
    /// step is staged and reserved independently by
    /// [`Self::stage_managed_host_plan_action_step`].
    ///
    /// @ref LLP 0059#authorization-write-handoff — capture generation-bound
    ///   immutable action state before any per-step off-Local room wait.
    pub(crate) fn stage_managed_host_plan_action(
        &mut self,
        name: &str,
        input: HandlerInput,
        metadata: CronRunMetadata,
        prepared: PreparedInvocation,
    ) -> SnapbackResult<ManagedHostPlanAction> {
        prepared.validate_admission("action execution")?;
        self.persist_and_validate_prepared_service_authority(prepared.authority())?;
        let function = self.function(name)?.clone();
        if prepared.function_id() != function.id
            && prepared.function_id() != format!("fn:{}", function.name)
        {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_FUNCTION_MISMATCH",
                "auth",
                "prepared invocation does not match the action target",
            ));
        }
        let FunctionRuntime::HostPlan(HandlerPlan::Action(plan)) = &function.runtime else {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_KIND_MISMATCH",
                "runtime",
                format!("{name} is not a host-plan action"),
            ));
        };
        Ok(ManagedHostPlanAction {
            plan: plan.clone(),
            input: prepared.canonicalize_input(input),
            metadata,
            invocation: prepared,
            app_generation: self.app_generation,
            app_generation_fence: self.app_generation_fence.clone(),
            redactor: self.config.secret_redactor_for(&function.uses),
        })
    }

    /// Evaluate one HostPlan action step and execute/dry-run its target
    /// mutation exactly once to derive the transaction's protected-room
    /// selector. The returned mutation carrier owns no SQLite transaction.
    ///
    /// @ref LLP 0059#authorization-write-handoff — each action step previews
    ///   exact changed rows and crosses the reservation boundary independently.
    pub(crate) fn stage_managed_host_plan_action_step(
        &mut self,
        action: &ManagedHostPlanAction,
        step: &ActionStep,
        bindings: &BTreeMap<String, Value>,
    ) -> SnapbackResult<(
        crate::storage::AuthorizationCommitPreflight,
        StagedRecordedMutation,
    )> {
        action.validate_generation()?;
        if self.app_generation != action.app_generation {
            return Err(managed_action_generation_conflict(
                action.app_generation,
                self.app_generation,
            ));
        }
        action
            .invocation
            .validate_admission("action step staging")?;
        let ActionStep::RunMutation { name, args, .. } = step;
        let mutation_args =
            eval_action_args(args, &action.input, bindings, &action.metadata, self)?;
        let authority = action
            .invocation
            .inherit_authority_for(InvocationSource::NestedMutation)?;
        self.stage_recorded_authorization_mutation(
            name,
            HandlerInput {
                args: Value::Object(mutation_args),
                auth: action.input.auth.clone(),
                read_set: Vec::new(),
                correlation: None,
                ctx_ledger: None,
            },
            None,
            None,
            &[],
            "local",
            authority,
        )
    }

    pub(crate) fn invoke_action_prepared(
        &mut self,
        name: &str,
        input: HandlerInput,
        metadata: CronRunMetadata,
        prepared: PreparedInvocation,
    ) -> SnapbackResult<Value> {
        prepared.validate_admission("action execution")?;
        self.persist_and_validate_prepared_service_authority(prepared.authority())?;
        let function = self.function(name)?.clone();
        if prepared.function_id() != function.id
            && prepared.function_id() != format!("fn:{}", function.name)
        {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_FUNCTION_MISMATCH",
                "auth",
                "prepared invocation does not match the action target",
            ));
        }
        let input = prepared.canonicalize_input(input);
        let invocation_redactor = self.config.secret_redactor_for(&function.uses);
        let result = match (&function.kind, &function.runtime) {
            (FunctionKind::Action, FunctionRuntime::HostPlan(HandlerPlan::Action(plan))) => {
                self.invoke_action_plan(plan, input, metadata, &prepared)
            }
            (FunctionKind::Action, FunctionRuntime::IbexModule(module)) => {
                let runtime = self.runtime.clone();
                // @ref LLP 0036#runtime-exposure-d5-d8 — grants are computed
                // per invocation from the function's `uses` declaration; the
                // store is read through on every run (no caching), leaving VM
                // reuse questions to the DK-4 machinery.
                let grants = self.config_grants(&function);
                // One provenance root: runMutation (and the trait's unreachable
                // raw-read defense) derives a reference from this *mut for one
                // synchronous call, so no borrow outlives a later write.
                let snapback = self as *mut LocalSnapback;
                let mut host = LocalIbexActionHost {
                    snapback,
                    authority: prepared.authority().clone(),
                    _marker: PhantomData,
                };
                runtime.invoke_ibex_action_prepared(
                    module, input, &prepared, metadata, &mut host, grants, None,
                )
            }
            _ => Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_KIND_MISMATCH",
                "runtime",
                format!("{name} is not an action"),
            )),
        };
        let result = result.map_err(|error| {
            // In-lock actions cannot race config rotation, but scrub at the
            // creation boundary so no public envelope observes raw secret
            // text before a later retention sink gets a chance to redact it.
            invocation_redactor.redact_error(error)
        });
        #[cfg(test)]
        BEFORE_ACTION_RESULT_HANDOFF_HOOK.with(|slot| {
            if let Some(hook) = slot.borrow_mut().take() {
                hook();
            }
        });
        let _publication = prepared.effect_guard("action result handoff")?;
        result
    }

    fn invoke_action_plan(
        &mut self,
        plan: &ActionPlan,
        input: HandlerInput,
        metadata: CronRunMetadata,
        prepared: &PreparedInvocation,
    ) -> SnapbackResult<Value> {
        let mut bindings = BTreeMap::new();
        let mut last_result = Value::Null;
        let mut changed_count = 0usize;
        for step in &plan.steps {
            match step {
                ActionStep::RunMutation {
                    name,
                    args,
                    bind_result_as,
                } => {
                    let mutation_args = eval_action_args(args, &input, &bindings, &metadata, self)?;
                    let authority =
                        prepared.inherit_authority_for(InvocationSource::NestedMutation)?;
                    let output = self.invoke_mutation_with_authority(
                        name,
                        HandlerInput {
                            args: Value::Object(mutation_args),
                            auth: input.auth.clone(),
                            read_set: Vec::new(),
                            correlation: None,
                            ctx_ledger: None,
                        },
                        authority,
                    )?;
                    changed_count += output.changed_count;
                    last_result = output.result;
                    if let Some(binding) = bind_result_as {
                        bindings.insert(binding.clone(), last_result.clone());
                    }
                }
            }
        }
        match &plan.return_value {
            Some(ActionReturnValue::Literal(value)) => Ok(value.clone()),
            Some(ActionReturnValue::Binding(name)) => {
                bindings.get(name).cloned().ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_BINDING_MISSING",
                        "runtime",
                        format!("action binding {name} was not available"),
                    )
                })
            }
            Some(ActionReturnValue::ChangedCount) => Ok(json!(changed_count)),
            Some(ActionReturnValue::LastMutationResult) | None => Ok(last_result),
        }
    }

    fn active_live_functions(&self) -> BTreeSet<String> {
        self.subscriptions
            .values()
            .map(|subscription| subscription.function.clone())
            .collect()
    }

    /// Persist the cron state to SQLite only when it has actually changed. An
    /// idle instance ticks with no due jobs, which does not mutate the cron
    /// state, so this becomes a no-op — no periodic disk write.
    ///
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L5.
    fn persist_cron_state(&mut self) -> SnapbackResult<()> {
        let value = self.cron.persisted_value()?;
        if self.last_persisted_cron.as_ref() == Some(&value) {
            return Ok(());
        }
        self.db.save_cron_state(&value)?;
        self.last_persisted_cron = Some(value);
        self.cron_state_writes += 1;
        Ok(())
    }

    /// A lock-free flag the cron ticker checks to skip the global lock when no
    /// cron job is armed (scale-to-zero).
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L5 idle-cost gate.
    pub fn cron_activity_flag(&self) -> Arc<AtomicBool> {
        self.cron_active.clone()
    }

    /// Recompute whether any cron job is armed. Arming depends on the function
    /// manifest and the set of live-query subscriptions, so this is called when
    /// either changes — never per tick.
    ///
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L5.
    fn refresh_cron_active(&mut self) {
        let active_live_functions = self.active_live_functions();
        let armed = self.cron.any_armed(&self.functions, &active_live_functions);
        self.cron_active.store(armed, Ordering::Relaxed);
    }

    /// Count of cron-state disk writes — a test hook for the idle-instance
    /// zero-periodic-writes assertion.
    pub fn cron_state_writes(&self) -> u64 {
        self.cron_state_writes
    }

    /// Fan a committed changeset out to live subscriptions. The mutation has
    /// already committed by the time this runs, so a single subscription's
    /// re-run or serialization failure must never fail the mutation or abort
    /// the loop and starve the remaining subscribers — each failure is a
    /// recorded diagnostic plus a resync signal to that one subscriber.
    ///
    /// @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D4.
    /// @ref LLP 0003#realtime-pipeline — post-commit fan-out error contract.
    fn notify_live_subscriptions(&mut self, changes: &[ChangedRow]) {
        if changes.is_empty() && self.subscriptions.is_empty() {
            return;
        }

        let Ok(admission) = self.admission.admit() else {
            return;
        };
        let frame_version = match self.db.current_version() {
            Ok(version) => version,
            Err(error) => {
                self.record_diagnostics(vec![error.diagnostic]);
                return;
            }
        };

        self.begin_live_delivery_frame(self.subscriptions.len());
        if let Err(error) = self.notify_live_subscriptions_in_frame(
            changes,
            &BTreeSet::new(),
            frame_version,
            &admission,
        ) {
            self.record_diagnostics(vec![error.diagnostic]);
        }
    }

    fn begin_live_delivery_frame(&mut self, subscriptions: usize) {
        self.live_delivery.total_fanout_attempts += subscriptions as u64;
        self.live_delivery.last_fanout_subscriptions = subscriptions;
        self.live_delivery.last_deliveries = 0;
        self.live_delivery.last_skipped = 0;
        self.live_delivery.last_failed = 0;
    }

    fn authorization_retry_key(subscription: &LiveSubscription) -> Option<RetryEpisodeKey> {
        let authorization = subscription.authorization.as_ref()?;
        Some(RetryEpisodeKey {
            authority_subject: authorization.authority_subject.clone(),
            client_store_id: authorization.namespace.client_store_id.clone(),
            query_key: authorization.namespace.query_key.clone(),
        })
    }

    // @ref LLP 0058#gate-algorithm — retry-registry writes are durable auth
    // effects, so each transaction must revalidate the admitted epoch at its
    // own publication boundary.
    fn run_authorization_retry_transaction<T>(
        &mut self,
        admission: &AdmissionLease,
        effect: &'static str,
        retry_episode_id: Option<String>,
        operation: impl FnOnce(&mut LocalDatabase) -> SnapbackResult<T>,
    ) -> Result<T, AuthorizationResolutionFailure> {
        let _effect =
            admission
                .effect_guard(effect)
                .map_err(|error| AuthorizationResolutionFailure {
                    error,
                    retry_episode_id: retry_episode_id.clone(),
                })?;
        operation(&mut self.db).map_err(|error| AuthorizationResolutionFailure {
            error,
            retry_episode_id,
        })
    }

    fn invoke_authorization_resolution(
        &mut self,
        subscription: &LiveSubscription,
        witness_floor: CompositeWitness,
        admission: &AdmissionLease,
    ) -> Result<QueryInvocation, AuthorizationResolutionFailure> {
        // @ref LLP 0053#invalidation-is-an-obligation-not-a-message — retry
        // episodes are durable, bounded obligations; an untrusted application
        // error can quarantine but cannot manufacture terminal deletion proof.
        let key = Self::authorization_retry_key(subscription).expect("auth-scoped subscription");
        let now = now_millis();
        let initial = self.run_authorization_retry_transaction(
            admission,
            "authorization retry initial reservation transaction",
            None,
            |database| {
                database.with_invalidation_retry_episode(&key, |registry| {
                    registry.reserve(
                        key.clone(),
                        witness_floor.clone(),
                        now,
                        RetryReservationKind::Initial,
                    )
                })
            },
        );
        let episode = match initial {
            Ok(RetryReservation::Reserved(episode)) => episode,
            Ok(RetryReservation::Attached(_)) => {
                match self.run_authorization_retry_transaction(
                    admission,
                    "authorization retry automatic reservation transaction",
                    None,
                    |database| {
                        database.with_invalidation_retry_episode(&key, |registry| {
                            registry.reserve(
                                key.clone(),
                                witness_floor.clone(),
                                now_millis(),
                                RetryReservationKind::Automatic,
                            )
                        })
                    },
                ) {
                    Ok(RetryReservation::Reserved(episode)) => episode,
                    Ok(RetryReservation::Attached(episode))
                    | Ok(RetryReservation::Exhausted(episode)) => {
                        return Err(AuthorizationResolutionFailure {
                            error: SnapbackError::error(
                                "SNAPBACK_AUTH_RETRY_EXHAUSTED",
                                "auth",
                                "authorization revalidation retry budget is exhausted",
                            ),
                            retry_episode_id: Some(episode.episode_id),
                        });
                    }
                    Err(failure) => return Err(failure),
                }
            }
            Ok(RetryReservation::Exhausted(episode)) => {
                return Err(AuthorizationResolutionFailure {
                    error: SnapbackError::error(
                        "SNAPBACK_AUTH_RETRY_EXHAUSTED",
                        "auth",
                        "authorization revalidation retry budget is exhausted",
                    ),
                    retry_episode_id: Some(episode.episode_id),
                });
            }
            Err(failure) => return Err(failure),
        };

        self.invoke_authorization_resolution_with_episode(
            subscription,
            witness_floor,
            admission,
            key,
            episode,
        )
    }

    /// Execute a previously reserved retry attempt and any remaining automatic
    /// attempts in its fixed window. Manual retry uses this same body after it
    /// atomically replaces the exhausted episode, so it cannot accidentally
    /// spend an extra attempt merely by re-entering the normal reservation
    /// path.
    fn invoke_authorization_resolution_with_episode(
        &mut self,
        subscription: &LiveSubscription,
        witness_floor: CompositeWitness,
        admission: &AdmissionLease,
        key: RetryEpisodeKey,
        mut episode: RetryEpisode,
    ) -> Result<QueryInvocation, AuthorizationResolutionFailure> {
        loop {
            match self
                .prepare_live_rerun_authority(&subscription.authority, admission.clone())
                .and_then(|authority| {
                    self.invoke_query_with_dependencies_prepared(
                        &subscription.function,
                        subscription.input.clone(),
                        authority,
                    )
                }) {
                Ok(query) => return Ok(query),
                Err(error) => {
                    // Only the host-owned, non-serializable denial brand may
                    // produce a terminal delete. Application diagnostics with
                    // the same public code remain ordinary retryable errors.
                    if error.is_trusted_permission_denial() {
                        return Err(AuthorizationResolutionFailure {
                            error,
                            retry_episode_id: Some(episode.episode_id),
                        });
                    }
                    let failure = self.run_authorization_retry_transaction(
                        admission,
                        "authorization retry failure transaction",
                        Some(episode.episode_id.clone()),
                        |database| {
                            database.with_invalidation_retry_episode(&key, |registry| {
                                registry.record_failure(&key, now_millis())
                            })
                        },
                    );
                    failure?;
                    let reservation = self.run_authorization_retry_transaction(
                        admission,
                        "authorization retry automatic reservation transaction",
                        Some(episode.episode_id.clone()),
                        |database| {
                            database.with_invalidation_retry_episode(&key, |registry| {
                                registry.reserve(
                                    key.clone(),
                                    witness_floor.clone(),
                                    now_millis(),
                                    RetryReservationKind::Automatic,
                                )
                            })
                        },
                    );
                    match reservation {
                        Ok(RetryReservation::Reserved(next)) => episode = next,
                        Ok(RetryReservation::Attached(current))
                        | Ok(RetryReservation::Exhausted(current)) => {
                            return Err(AuthorizationResolutionFailure {
                                error,
                                retry_episode_id: Some(current.episode_id),
                            });
                        }
                        Err(failure) => return Err(failure),
                    }
                }
            }
        }
    }

    fn resolve_authorization_retry_episode(
        &mut self,
        subscription: &LiveSubscription,
        proof: &CompositeWitness,
        _publication: &AdmissionEffectGuard<'_>,
    ) -> SnapbackResult<()> {
        let Some(key) = Self::authorization_retry_key(subscription) else {
            return Ok(());
        };
        self.db.with_invalidation_retry_episode(&key, |registry| {
            registry.resolve(&key, proof);
            Ok(())
        })
    }

    fn deliver_authorization_snapshot(
        &mut self,
        subscription: &LiveSubscription,
        query: QueryInvocation,
        cause_label: &str,
        raise_cause: bool,
        admission: &AdmissionLease,
    ) -> SnapbackResult<()> {
        let _publication = admission.effect_guard("authorization snapshot publication")?;
        let authorization = subscription.authorization.as_ref().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_CORRUPT",
                "auth",
                "authorization snapshot requires an auth-scoped subscription",
            )
        })?;
        let snapshot_version = query.output.version;
        let (projection, proof) = {
            let state = self.auth_invalidation.as_mut().ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                    "auth",
                    "authorization invalidation is not installed",
                )
            })?;
            let witness = state.witness(snapshot_version);
            if raise_cause {
                let cause = state.reserve_cause_sequence()?;
                state.obligations.raise(
                    authorization.scope_id.clone(),
                    cause,
                    format!("{cause_label}:{cause}"),
                    InvalidationDisposition::Quarantine,
                    witness.clone(),
                    None,
                )?;
            }
            state.obligations.issue_resolution(
                &authorization.scope_id,
                ResolutionKind::Snapshot,
                witness.clone(),
            )?;
            (
                state
                    .obligations
                    .projection(&authorization.scope_id)
                    .expect("a just-raised obligation has a projection"),
                witness,
            )
        };
        // The durable episode closes only after its proof has transferred to
        // the still-live obligation and exact ACK ticket above.
        self.resolve_authorization_retry_episode(subscription, &proof, &_publication)?;
        let payload = serde_json::to_vec(&LiveEnvelope::authorization_invalidation(
            projection.obligation,
            projection.resolution,
            Some(AuthorizationInvalidationSnapshot {
                subscription_id: subscription.id.clone(),
                function: subscription.function.clone(),
                version: snapshot_version,
                rows: query.output.rows,
            }),
        ))
        .map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_SERIALIZE_FAILED",
                "realtime",
                "authorization invalidation snapshot could not be serialized",
            )
            .with_details(json!({ "error": error.to_string() }))
        })?;
        if let Some(stored) = self.subscriptions.get_mut(&subscription.id) {
            stored.read_dependencies = query.read_dependencies;
        }
        let enqueue = self.enqueue_subscription_authorized_durable(
            subscription,
            payload,
            proof.authorization,
        );
        if enqueue.overflowed_now {
            self.raise_connection_overflow(&subscription.connection_id, snapshot_version)?;
        }
        Ok(())
    }

    fn raise_connection_overflow(
        &mut self,
        connection_id: &str,
        min_commit_version: u64,
    ) -> SnapbackResult<()> {
        // @ref LLP 0053#invalidation-is-an-obligation-not-a-message — overflow
        // is projected as a connection root with one exact child per current
        // auth-scoped query; one child's ACK cannot discharge its siblings.
        let subscriptions = self
            .subscriptions
            .values()
            .filter(|subscription| subscription.connection_id == connection_id)
            .filter(|subscription| subscription.authorization.is_some())
            .cloned()
            .collect::<Vec<_>>();
        if subscriptions.is_empty() {
            return Ok(());
        }
        let groups = subscriptions.iter().fold(
            BTreeMap::<(crate::auth::invalidation::IssuerId, u64), Vec<ScopeId>>::new(),
            |mut groups, subscription| {
                let scope = &subscription
                    .authorization
                    .as_ref()
                    .expect("filtered authorized subscription")
                    .scope_id;
                if let ScopeId::Subscription {
                    issuer_id,
                    connection_generation,
                    ..
                } = scope
                {
                    groups
                        .entry((issuer_id.clone(), *connection_generation))
                        .or_default()
                        .push(scope.clone());
                }
                groups
            },
        );
        let mut projections = Vec::new();
        let state = self.auth_invalidation.as_mut().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                "auth",
                "authorization invalidation is not installed",
            )
        })?;
        for ((issuer_id, connection_generation), children) in groups {
            let root = ScopeId::Connection {
                issuer_id,
                connection_generation,
            };
            let cause = state.reserve_cause_sequence()?;
            let witness = state.witness(min_commit_version);
            state.obligations.raise(
                root.clone(),
                cause,
                format!("overflow:{cause}"),
                InvalidationDisposition::Quarantine,
                witness,
                None,
            )?;
            for child in children {
                state
                    .obligations
                    .register_connection_child(&root, child.clone())?;
                if let Some(projection) = state.obligations.projection(&child) {
                    let subscription = subscriptions
                        .iter()
                        .find(|subscription| {
                            subscription
                                .authorization
                                .as_ref()
                                .is_some_and(|authorization| authorization.scope_id == child)
                        })
                        .expect("group child came from a retained subscription")
                        .clone();
                    projections.push((subscription, projection));
                }
            }
        }
        for (subscription, projection) in projections {
            if let Ok(payload) = serde_json::to_vec(&LiveEnvelope::authorization_invalidation(
                projection.obligation,
                projection.resolution,
                None,
            )) {
                self.enqueue_subscription_durable(&subscription, payload);
            }
        }
        Ok(())
    }

    /// Reproject truth before every connected delivery boundary. Returns true
    /// when at least one hint was parked behind a sticky overflow sentinel, so
    /// the caller can drain the sentinel and immediately project once more.
    ///
    /// @ref LLP 0053#invalidation-is-an-obligation-not-a-message — delivery is
    /// a wakeup hint; pending obligations are the persistent source of truth.
    pub(crate) fn reproject_authorization_invalidations(
        &mut self,
        connection_id: &str,
        admission: &AdmissionLease,
    ) -> SnapbackResult<bool> {
        let _publication = admission.effect_guard("authorization invalidation hint publication")?;
        let subscriptions = self
            .subscriptions
            .values()
            .filter(|subscription| subscription.connection_id == connection_id)
            .filter(|subscription| subscription.authorization.is_some())
            .cloned()
            .collect::<Vec<_>>();
        let projections = self
            .auth_invalidation
            .as_ref()
            .map(|state| {
                subscriptions
                    .iter()
                    .filter_map(|subscription| {
                        let scope = &subscription.authorization.as_ref()?.scope_id;
                        state
                            .obligations
                            .projection(scope)
                            .map(|projection| (subscription.clone(), projection))
                    })
                    .map(|(subscription, mut projection)| {
                        // A snapshot ticket is useful only in the atomic frame
                        // that also carries the rows it proves. Wakeup hints
                        // re-project the obligation alone; the drain boundary
                        // below performs a fresh rerun and emits the complete
                        // snapshot + exact ticket. Terminal-delete tickets are
                        // already complete without row payload and remain
                        // level-triggered here.
                        if projection
                            .resolution
                            .as_ref()
                            .is_some_and(|ticket| ticket.kind == ResolutionKind::Snapshot)
                        {
                            projection.resolution = None;
                        }
                        (subscription, projection)
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut parked = false;
        for (subscription, projection) in projections {
            if let Ok(payload) = serde_json::to_vec(&LiveEnvelope::authorization_invalidation(
                projection.obligation,
                projection.resolution,
                None,
            )) {
                parked |= self
                    .enqueue_subscription_durable(&subscription, payload)
                    .parked_behind_overflow;
            }
        }
        Ok(parked)
    }

    pub(crate) fn authorization_invalidation_frames(
        &mut self,
        connection_id: &str,
        admission: &AdmissionLease,
    ) -> SnapbackResult<Vec<crate::ephemeral::DurableMessage>> {
        self.authorization_invalidation_frames_with_handoff_limit(
            connection_id,
            admission,
            crate::ephemeral::MAX_OUTBOX_HANDOFF_BYTES,
        )
    }

    pub(crate) fn authorization_invalidation_frames_with_handoff_limit(
        &mut self,
        connection_id: &str,
        admission: &AdmissionLease,
        max_handoff_bytes: usize,
    ) -> SnapbackResult<Vec<crate::ephemeral::DurableMessage>> {
        // @ref LLP 0058#gate-algorithm — a re-query validates and publishes
        // through the same admission lease itself. Never hold the admission
        // mutex while invoking it: managed leases use a non-reentrant mutex,
        // so the outer drain must compute first and acquire only narrow guards
        // at the obligation/ticket publication cuts below.
        admission.validate("authorization invalidation drain preparation")?;
        let subscriptions = self
            .subscriptions
            .values()
            .filter(|subscription| subscription.connection_id == connection_id)
            .filter(|subscription| subscription.authorization.is_some())
            .cloned()
            .collect::<Vec<_>>();
        let mut frames = Vec::new();
        let mut handoff_bytes = crate::ephemeral::OUTBOX_HANDOFF_BATCH_OVERHEAD;
        let max_handoff_bytes = max_handoff_bytes.min(crate::ephemeral::MAX_OUTBOX_HANDOFF_BYTES);
        let mut append_frame = |message: crate::ephemeral::DurableMessage| -> SnapbackResult<bool> {
            let estimated = crate::ephemeral::estimated_durable_handoff_bytes(&message);
            if handoff_bytes.saturating_add(estimated) > max_handoff_bytes {
                if frames.is_empty() {
                    return Err(SnapbackError::error(
                        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                        "auth",
                        "one authorization invalidation projection exceeds the 64 MiB transport handoff ceiling",
                    ));
                }
                return Ok(false);
            }
            handoff_bytes = handoff_bytes.saturating_add(estimated);
            frames.push(message);
            Ok(true)
        };
        'subscriptions: for subscription in subscriptions {
            let scope = &subscription
                .authorization
                .as_ref()
                .expect("filtered auth-scoped subscription")
                .scope_id;
            let Some(pending) = self
                .auth_invalidation
                .as_ref()
                .and_then(|state| state.obligations.pending(scope))
                .cloned()
            else {
                continue;
            };
            // A trusted terminal denial already carries its complete delete
            // proof. Re-fire that level-triggered truth verbatim; never turn
            // it back into an application re-query or a snapshot ticket.
            {
                let _publication = admission
                    .effect_guard("authorization terminal invalidation drain publication")?;
                if let Some(projection) = self
                    .auth_invalidation
                    .as_ref()
                    .and_then(|state| state.obligations.projection(scope))
                    .filter(|projection| {
                        projection.resolution.as_ref().is_some_and(|resolution| {
                            resolution.kind == ResolutionKind::TerminalDelete
                        })
                    })
                {
                    if let Ok(frame) =
                        serde_json::to_vec(&LiveEnvelope::authorization_invalidation(
                            projection.obligation,
                            projection.resolution,
                            None,
                        ))
                        && !append_frame(crate::ephemeral::DurableMessage::new(frame))?
                    {
                        break 'subscriptions;
                    }
                    continue;
                }
            }
            match self.invoke_authorization_resolution(
                &subscription,
                pending.witness.clone(),
                admission,
            ) {
                Ok(query) => {
                    let _publication =
                        admission.effect_guard("authorization snapshot drain publication")?;
                    let snapshot_version = query.output.version;
                    let proof = self
                        .auth_invalidation
                        .as_ref()
                        .expect("pending obligation has installed state")
                        .witness(snapshot_version);
                    let projection = {
                        let state = self
                            .auth_invalidation
                            .as_mut()
                            .expect("pending obligation has installed state");
                        if state
                            .obligations
                            .issue_resolution(scope, ResolutionKind::Snapshot, proof.clone())
                            .is_err()
                        {
                            continue;
                        }
                        state.obligations.projection(scope)
                    };
                    if self
                        .resolve_authorization_retry_episode(&subscription, &proof, &_publication)
                        .is_err()
                    {
                        continue;
                    }
                    if let Some(stored) = self.subscriptions.get_mut(&subscription.id) {
                        stored.read_dependencies = query.read_dependencies;
                    }
                    if let Some(projection) = projection
                        && let Ok(frame) =
                            serde_json::to_vec(&LiveEnvelope::authorization_invalidation(
                                projection.obligation,
                                projection.resolution,
                                Some(AuthorizationInvalidationSnapshot {
                                    subscription_id: subscription.id.clone(),
                                    function: subscription.function.clone(),
                                    version: snapshot_version,
                                    rows: query.output.rows,
                                }),
                            ))
                        && !append_frame(crate::ephemeral::DurableMessage::authorized(
                            frame,
                            proof.authorization,
                        ))?
                    {
                        break 'subscriptions;
                    }
                }
                Err(failure) => {
                    if failure.error.is_trusted_permission_denial() {
                        self.fail_subscription_fanout_with_retry(
                            &subscription,
                            "authorization_terminal_denial",
                            failure.error,
                            failure.retry_episode_id,
                            None,
                            admission,
                        );
                        let _publication =
                            admission.effect_guard("authorization denial drain publication")?;
                        if let Some(projection) = self
                            .auth_invalidation
                            .as_ref()
                            .and_then(|state| state.obligations.projection(scope))
                            && let Ok(frame) =
                                serde_json::to_vec(&LiveEnvelope::authorization_invalidation(
                                    projection.obligation,
                                    projection.resolution,
                                    None,
                                ))
                            && !append_frame(crate::ephemeral::DurableMessage::new(frame))?
                        {
                            break 'subscriptions;
                        }
                        continue;
                    }
                    let _publication =
                        admission.effect_guard("authorization retry drain publication")?;
                    let projection = self.auth_invalidation.as_mut().and_then(|state| {
                        let current = state.obligations.pending(scope)?;
                        if current.retry_episode_id == failure.retry_episode_id {
                            return state.obligations.projection(scope);
                        }
                        let cause = state.reserve_cause_sequence().ok()?;
                        state
                            .obligations
                            .raise(
                                scope.clone(),
                                cause,
                                format!("retry:error:{cause}"),
                                InvalidationDisposition::Quarantine,
                                pending.witness,
                                failure.retry_episode_id,
                            )
                            .ok()?;
                        state.obligations.projection(scope)
                    });
                    if let Some(projection) = projection
                        && let Ok(frame) =
                            serde_json::to_vec(&LiveEnvelope::authorization_invalidation(
                                projection.obligation,
                                projection.resolution,
                                None,
                            ))
                        && !append_frame(crate::ephemeral::DurableMessage::new(frame))?
                    {
                        break 'subscriptions;
                    }
                }
            }
        }
        Ok(frames)
    }

    fn notify_authorization_event_in_frame(
        &mut self,
        authorization: &crate::storage::AuthorizationCommitWitness,
        min_commit_version: u64,
        admission: &AdmissionLease,
    ) -> SnapbackResult<BTreeSet<String>> {
        self.notify_authorization_event_in_frame_with_policy(
            authorization,
            min_commit_version,
            admission,
            false,
        )
    }

    /// Activation is still inside the closed transition after its durable
    /// cut. Unlike ordinary post-commit mutation fanout, no projection error
    /// may be downgraded to a diagnostic: the caller must keep successor
    /// admission closed until restart/reconciliation can recover it.
    fn notify_authorization_activation_in_frame(
        &mut self,
        authorization: &crate::storage::AuthorizationCommitWitness,
        min_commit_version: u64,
        admission: &AdmissionLease,
    ) -> SnapbackResult<BTreeSet<String>> {
        self.notify_authorization_event_in_frame_with_policy(
            authorization,
            min_commit_version,
            admission,
            true,
        )
    }

    fn notify_authorization_event_in_frame_with_policy(
        &mut self,
        authorization: &crate::storage::AuthorizationCommitWitness,
        min_commit_version: u64,
        admission: &AdmissionLease,
        fail_closed_on_preprojection_error: bool,
    ) -> SnapbackResult<BTreeSet<String>> {
        // The authenticated issuer is shared process state. The durable room
        // interlock owns advancing it in the ordered after-Local commit
        // callback; taking its RwLock here would nest process authority under
        // managed Local. This Local-owned obligation projection can advance
        // now: admission and the room ticket stay closed until the issuer and
        // room successor finish outside Local.
        // @ref LLP 0059#locking-and-linearization — issuer publication is an
        //   after-Local effect of the known durable commit.
        self.auth_invalidation
            .as_mut()
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                    "auth",
                    "authorization event cannot advance without invalidation state",
                )
            })
            .and_then(|state| {
                state
                    .obligations
                    .advance_authenticated_authorization(authorization.version.clone())
            })?;
        self.live_delivery.authorization_blast_radius.for_event(
            &authorization.membership_declarations,
            |counters| {
                counters.version_advances += 1;
            },
        );
        let subscriptions = self
            .subscriptions
            .values()
            .filter(|subscription| subscription.authorization.is_some())
            .cloned()
            .collect::<Vec<_>>();
        if subscriptions.is_empty() {
            return Ok(BTreeSet::new());
        }

        let mut preprojected = Vec::with_capacity(subscriptions.len());
        for subscription in &subscriptions {
            let projected = (|| -> SnapbackResult<AuthorizationInvalidationProjection> {
                let state = self.auth_invalidation.as_mut().ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                        "auth",
                        "authorization event cannot project without invalidation state",
                    )
                })?;
                let scope = &subscription
                    .authorization
                    .as_ref()
                    .expect("filtered auth-scoped subscription")
                    .scope_id;
                let cause = state.reserve_cause_sequence()?;
                let witness = state.witness(min_commit_version);
                state.obligations.raise(
                    scope.clone(),
                    cause,
                    format!("authorization:{cause}"),
                    InvalidationDisposition::Quarantine,
                    witness,
                    None,
                )?;
                Ok(state
                    .obligations
                    .projection(scope)
                    .expect("a just-raised obligation has a projection"))
            })();
            match projected {
                Ok(projection) => preprojected.push((subscription.clone(), projection)),
                Err(error) if fail_closed_on_preprojection_error => return Err(error),
                Err(error) => self.record_diagnostics(vec![error.diagnostic]),
            }
        }
        self.live_delivery.authorization_blast_radius.for_event(
            &authorization.membership_declarations,
            |counters| {
                counters.quarantined_subscriptions += preprojected.len() as u64;
            },
        );
        let handled = preprojected
            .iter()
            .map(|(subscription, _)| subscription.id.clone())
            .collect::<BTreeSet<_>>();
        for (subscription, projection) in preprojected {
            if let Ok(payload) = serde_json::to_vec(&LiveEnvelope::authorization_invalidation(
                projection.obligation,
                projection.resolution,
                None,
            )) {
                let _publication =
                    match admission.effect_guard("authorization obligation publication") {
                        Ok(publication) => publication,
                        Err(error) => {
                            self.fail_subscription_fanout(
                                &subscription,
                                "authorization_obligation_publication_failed",
                                error,
                                Some(min_commit_version),
                                admission,
                            );
                            continue;
                        }
                    };
                let enqueue = self.enqueue_subscription_durable(&subscription, payload);
                if enqueue.overflowed_now {
                    let _ = self
                        .raise_connection_overflow(&subscription.connection_id, min_commit_version);
                }
            }
        }

        for subscription in subscriptions {
            if !handled.contains(&subscription.id) {
                continue;
            }
            let floor = self
                .auth_invalidation
                .as_ref()
                .map(|state| state.witness(min_commit_version))
                .expect("authorization event requires installed state");
            match self.invoke_authorization_resolution(&subscription, floor, admission) {
                Ok(query) => match self.deliver_authorization_snapshot(
                    &subscription,
                    query,
                    "authorization",
                    false,
                    admission,
                ) {
                    Ok(()) => {
                        self.live_delivery.total_deliveries += 1;
                        self.live_delivery.last_deliveries += 1;
                        self.live_delivery.authorization_blast_radius.for_event(
                            &authorization.membership_declarations,
                            |counters| {
                                counters.resnapshots += 1;
                            },
                        );
                    }
                    Err(error) => self.fail_subscription_fanout(
                        &subscription,
                        "authorization_invalidation_failed",
                        error,
                        Some(min_commit_version),
                        admission,
                    ),
                },
                Err(failure) => self.fail_subscription_fanout_with_retry(
                    &subscription,
                    "authorization_refresh_failed",
                    failure.error,
                    failure.retry_episode_id,
                    Some(min_commit_version),
                    admission,
                ),
            }
        }
        Ok(handled)
    }

    /// A sessions-mode deployment swap can change or remove a function that
    /// was previously proved `authorityIndependent`. Such a retained live
    /// query owns no authorization scope, so it cannot safely inherit the
    /// deployment event's obligation. Retire every unscoped predecessor
    /// subscription and enqueue a clear-retained resync while the activation
    /// projection lease is still the sole admitted root. The client may then
    /// establish a successor subscription under the new manifest after the
    /// controller reopens.
    fn invalidate_unscoped_live_subscriptions_for_activation(
        &mut self,
        admission: &AdmissionLease,
    ) -> SnapbackResult<()> {
        let subscriptions = self
            .subscriptions
            .values()
            .filter(|subscription| subscription.authorization.is_none())
            .cloned()
            .collect::<Vec<_>>();
        if subscriptions.is_empty() {
            return Ok(());
        }

        let payloads = subscriptions
            .iter()
            .map(|subscription| {
                serde_json::to_vec(&LiveEnvelope::ResyncRequired {
                    reason: "auth_deployment_activated".to_owned(),
                    subscription_id: Some(subscription.id.clone()),
                    scope: Some(String::new()),
                    epoch: Some(0),
                    clear_retained: true,
                })
                .map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_LIVE_UPDATE_SERIALIZE_FAILED",
                        "realtime",
                        "activation resync message could not be serialized",
                    )
                    .with_details(json!({ "error": error.to_string() }))
                })
            })
            .collect::<SnapbackResult<Vec<_>>>()?;

        let snapshot_version = Some(self.db.current_version()?);
        let _publication = admission.effect_guard("activation live resync publication")?;
        let received_at_ms = now_millis();
        let overflowed_effects = subscriptions
            .iter()
            .map(|subscription| {
                (
                    subscription.connection_id.clone(),
                    subscription.effect_fence.clone(),
                )
            })
            .collect::<BTreeSet<_>>()
            .into_iter()
            .filter(|(connection_id, effect_fence)| {
                self.ephemeral
                    .invalidate_durable_backlog_for_activation(connection_id, effect_fence.as_ref())
            })
            .collect::<BTreeSet<_>>();
        for (subscription, payload) in subscriptions.iter().zip(payloads) {
            self.subscriptions.remove(&subscription.id);
            self.receipts.push_global(
                Receipt::Subscription {
                    event: SubscriptionReceiptEvent::Disposed,
                    reason: Some("auth_deployment_activated".to_owned()),
                    subscription_id: Some(subscription.id.clone()),
                    superseded_by: None,
                    lane: None,
                    binding_id: None,
                    collection: None,
                    removed: None,
                    scope: subscription.input.args.clone(),
                    snapshot_version,
                    correlation: None,
                    received_at_ms,
                }
                .into_value(),
            );
            if !overflowed_effects.contains(&(
                subscription.connection_id.clone(),
                subscription.effect_fence.clone(),
            )) {
                self.enqueue_subscription_durable(subscription, payload);
                self.live_delivery.total_deliveries += 1;
                self.live_delivery.last_deliveries += 1;
            }
        }
        self.live_delivery.total_deliveries += overflowed_effects.len() as u64;
        self.live_delivery.last_deliveries += overflowed_effects.len();
        self.refresh_auth_scoped_live_connections();
        self.refresh_cron_active();
        Ok(())
    }

    fn notify_live_subscriptions_in_frame(
        &mut self,
        changes: &[ChangedRow],
        already_resynced: &BTreeSet<String>,
        frame_version: u64,
        admission: &AdmissionLease,
    ) -> SnapbackResult<()> {
        // Cheap affected prefilter over borrowed subscriptions: only the
        // survivors are cloned for the mutable delivery loop below (ENG-23334
        // — the old upfront `values().cloned()` deep-copied every retained
        // result-membership id vector on every commit, even when all
        // subscribers were skipped as unaffected). The checks read only
        // `self.functions`, `self.permission_epochs`, and each subscription's
        // own captured dependencies — none of which the delivery loop changes
        // for *other* subscriptions — so filtering before delivering is
        // equivalent to the old interleaved order.
        //
        // @ref LLP 0008#decision-dk-3--delta-shape-and-read-lane-2026-07-01 —
        // op-log delta fast path: for an analyzable HostPlan single-table
        // query, ship the classified add/update/remove ops instead of
        // re-running the query in a VM. Extract the plan here (an owned
        // clone, cheap) so the immutable `function` borrow ends before the
        // delivery loop takes `&mut self`. `try_live_delta_fanout` returns
        // `Some` when it owns the subscription's delivery and `None` when the
        // caller must fall back to the re-query + `live_replace` path.
        // Empty `changes` is the seed/refresh signal (`seed()` calls
        // `notify_live_subscriptions(&[])` with no change list): it means
        // "re-evaluate from scratch", which only the re-query + replace
        // path can honour (the matcher treats empty `changes` as affected).
        // Skipping the delta path here keeps seed delivering to HostPlan
        // subscribers (DK-3 review finding C).
        let mut skipped = 0u64;
        let mut affected: Vec<(LiveSubscription, Option<QueryPlan>)> = Vec::new();
        for subscription in self.subscriptions.values() {
            if already_resynced.contains(&subscription.id) {
                continue;
            }
            let Some(function) = self.functions.function(&subscription.function) else {
                skipped += 1;
                continue;
            };
            if self.subscription_has_stale_permission(subscription) {
                skipped += 1;
                continue;
            }
            if !live_subscription_may_be_affected(
                function,
                &subscription.input,
                &subscription.read_dependencies,
                changes,
            ) {
                skipped += 1;
                continue;
            }
            let delta_plan = match &function.runtime {
                // @ref LLP 0056#what-exists-what-this-adds — membership-gated
                // (semi-join) queries ride the conservative re-query/
                // `live_replace` lane, never incremental deltas: the delta
                // classifier evaluates only ordinary filters, so admitting a
                // membership-gated plan here either over-delivers rows the
                // subscriber's membership predicate excludes or swallows
                // membership-table-only visibility transitions as `NoChange`
                // (LLP 0067 §F2a records both directions).
                // @ref LLP 0065#4-capability-and-llp-0053-composition — generated
                // standard patterns claim no skip and no live_delta: §4's
                // conservative resnapshot governs every delivery, so a
                // pattern-identified function never enters the delta lane
                // even when its plan shape (unordered, below-cap — the
                // unique lookup) would otherwise qualify.
                FunctionRuntime::HostPlan(HandlerPlan::Query(plan))
                    if !changes.is_empty()
                        && plan.membership_filters.is_empty()
                        && function.standard_pattern.is_none() =>
                {
                    Some(plan.clone())
                }
                _ => None,
            };
            affected.push((subscription.clone(), delta_plan));
        }
        self.live_delivery.total_skipped += skipped;
        self.live_delivery.last_skipped += skipped as usize;

        // One RQS mint per (queryArtifact, argsHash, version, contentDigest)
        // is shared across the entire fan-out of this commit frame (LLP 0090
        // D1: refresh overhead is per result-change, not per subscriber).
        let mut resume_mint_cache: HashMap<(String, String, u64, String), Option<ResumeWire>> =
            HashMap::new();
        for (subscription, delta_plan) in affected {
            if let Err(error) =
                self.prepare_live_rerun_authority(&subscription.authority, admission.clone())
            {
                self.fail_subscription_fanout(
                    &subscription,
                    "live_authority_ended",
                    error,
                    Some(frame_version),
                    admission,
                );
                continue;
            }
            if let Some(plan) = &delta_plan {
                let delta = match self.try_live_delta_fanout(
                    &subscription,
                    plan,
                    changes,
                    frame_version,
                    admission,
                    &mut resume_mint_cache,
                ) {
                    Ok(delta) => delta,
                    Err(error) => {
                        self.fail_subscription_fanout(
                            &subscription,
                            "live_delta_publication_failed",
                            error,
                            Some(frame_version),
                            admission,
                        );
                        continue;
                    }
                };
                match delta {
                    Some(DeltaFanout::Delivered) => {
                        self.live_delivery.total_deliveries += 1;
                        self.live_delivery.last_deliveries += 1;
                        continue;
                    }
                    Some(DeltaFanout::NoChange) => {
                        self.live_delivery.total_skipped += 1;
                        self.live_delivery.last_skipped += 1;
                        continue;
                    }
                    Some(DeltaFanout::Failed(error)) => {
                        self.fail_subscription_fanout(
                            &subscription,
                            "live_delta_failed",
                            error,
                            Some(frame_version),
                            admission,
                        );
                        continue;
                    }
                    None => {}
                }
            }

            let query = if subscription.authorization.is_some() {
                let floor = self
                    .auth_invalidation
                    .as_ref()
                    .map(|state| state.witness(frame_version))
                    .expect("auth-scoped subscription requires installed state");
                match self.invoke_authorization_resolution(&subscription, floor, admission) {
                    Ok(query) => query,
                    Err(failure) => {
                        self.fail_subscription_fanout_with_retry(
                            &subscription,
                            "live_refresh_failed",
                            failure.error,
                            failure.retry_episode_id,
                            Some(frame_version),
                            admission,
                        );
                        continue;
                    }
                }
            } else {
                match self
                    .prepare_live_rerun_authority(&subscription.authority, admission.clone())
                    .and_then(|authority| {
                        self.invoke_query_with_dependencies_prepared(
                            &subscription.function,
                            subscription.input.clone(),
                            authority,
                        )
                    }) {
                    Ok(query) => query,
                    Err(error) => {
                        self.fail_subscription_fanout(
                            &subscription,
                            "live_refresh_failed",
                            error,
                            Some(frame_version),
                            admission,
                        );
                        continue;
                    }
                }
            };
            if subscription.authorization.is_some() {
                match self.deliver_authorization_snapshot(
                    &subscription,
                    query,
                    "replace",
                    true,
                    admission,
                ) {
                    Ok(()) => {
                        self.live_delivery.total_deliveries += 1;
                        self.live_delivery.last_deliveries += 1;
                    }
                    Err(error) => self.fail_subscription_fanout(
                        &subscription,
                        "authorization_invalidation_failed",
                        error,
                        Some(frame_version),
                        admission,
                    ),
                }
                continue;
            }
            // RQS token refresh on the replace lane (LLP 0091 §0A.5): every
            // result-changing durable envelope for an eligible subscription
            // carries a fresh token minted at the new (version, digest),
            // shared per identity tuple across the fan-out via the frame
            // cache. `seq1` (ordered/replace-only) digests recompute exactly
            // here — their only refresh boundary.
            let resume = if let Some(state) = subscription.rqs.as_ref() {
                match crate::rqs::ResultDigest::from_rows(state.digest.kind, &query.output.rows) {
                    Ok(digest) => {
                        let wire = self.refreshed_resume(
                            &state.query_artifact,
                            &state.args_hash,
                            query.output.version,
                            digest.kind,
                            digest.published(),
                            &mut resume_mint_cache,
                        );
                        if let Some(stored) = self.subscriptions.get_mut(&subscription.id)
                            && let Some(stored_state) = stored.rqs.as_mut()
                        {
                            stored_state.digest = digest;
                        }
                        wire
                    }
                    Err(_) => {
                        self.live_delivery.resume.mint_refusals += 1;
                        None
                    }
                }
            } else {
                None
            };
            let payload = match serde_json::to_vec(&LiveEnvelope::LiveReplace {
                subscription_id: subscription.id.clone(),
                function: subscription.function.clone(),
                version: query.output.version,
                rows: query.output.rows,
                resume,
            }) {
                Ok(payload) => payload,
                Err(error) => {
                    self.fail_subscription_fanout(
                        &subscription,
                        "live_serialize_failed",
                        SnapbackError::error(
                            "SNAPBACK_LIVE_UPDATE_SERIALIZE_FAILED",
                            "realtime",
                            "live query update could not be serialized",
                        )
                        .with_details(json!({ "error": error.to_string() })),
                        Some(frame_version),
                        admission,
                    );
                    continue;
                }
            };
            let _publication = match admission.effect_guard("live replacement publication") {
                Ok(publication) => publication,
                Err(error) => {
                    self.fail_subscription_fanout(
                        &subscription,
                        "live_replacement_publication_failed",
                        error,
                        Some(frame_version),
                        admission,
                    );
                    continue;
                }
            };
            let enqueue = {
                if let Some(stored) = self.subscriptions.get_mut(&subscription.id) {
                    stored.read_dependencies = query.read_dependencies;
                }
                self.enqueue_subscription_durable(&subscription, payload)
            };
            if enqueue.overflowed_now
                && let Err(error) = self
                    .raise_connection_overflow(&subscription.connection_id, query.output.version)
            {
                self.fail_subscription_fanout(
                    &subscription,
                    "authorization_overflow_projection_failed",
                    error,
                    Some(frame_version),
                    admission,
                );
                continue;
            }
            self.live_delivery.total_deliveries += 1;
            self.live_delivery.last_deliveries += 1;
        }
        Ok(())
    }

    /// Try the DK-3 op-log delta fast path for one affected subscription.
    ///
    /// Returns `None` if the subscription is not delta-eligible (not a
    /// `HostPlan` single-table query, no captured membership, or the query is
    /// ordered/limited/un-analyzable so `compute_live_delta` yields `Replace`);
    /// the caller then uses the re-query + `live_replace` path. Returns `Some`
    /// once it has taken ownership of the subscription's delivery:
    /// `Delivered` (a `live_delta` was enqueued and membership updated),
    /// `NoChange` (the commit did not change this subscription's result), or
    /// `Failed` (serialization error — reported as a fan-out failure).
    ///
    /// @ref LLP 0008#decision-dk-3--delta-shape-and-read-lane-2026-07-01
    /// Mint (or reuse from the frame cache) the shared refreshed resume
    /// token for one `(queryArtifact, argsHash, version, contentDigest)`
    /// tuple (LLP 0091 §0A.5 refresh rule).
    fn refreshed_resume(
        &mut self,
        query_artifact: &str,
        args_hash: &str,
        version: u64,
        kind: crate::rqs::DigestKind,
        content_digest: String,
        cache: &mut HashMap<(String, String, u64, String), Option<ResumeWire>>,
    ) -> Option<ResumeWire> {
        let key = (
            query_artifact.to_owned(),
            args_hash.to_owned(),
            version,
            content_digest.clone(),
        );
        let minted = match cache.get(&key) {
            Some(shared) => shared.clone(),
            None => {
                let minted =
                    self.mint_resume_wire(query_artifact, args_hash, version, kind, content_digest);
                cache.insert(key, minted.clone());
                minted
            }
        };
        if minted.is_some() {
            self.live_delivery.resume.tokens_refreshed += 1;
        }
        minted
    }

    fn try_live_delta_fanout(
        &mut self,
        subscription: &LiveSubscription,
        plan: &QueryPlan,
        changes: &[ChangedRow],
        frame_version: u64,
        admission: &AdmissionLease,
        resume_mint_cache: &mut HashMap<(String, String, u64, String), Option<ResumeWire>>,
    ) -> SnapbackResult<Option<DeltaFanout>> {
        // The subscription must carry a captured Query dependency (its current
        // result membership); a subscription established before this change, or
        // one whose snapshot captured no query dependency, falls back.
        let Some(query_dep_index) = subscription
            .read_dependencies
            .iter()
            .position(|dependency| {
                dependency.kind == CapturedReadKind::Query
                    && dependency.table.as_deref() == Some(plan.table.as_str())
            })
        else {
            return Ok(None);
        };
        let prior_ids: BTreeSet<String> = subscription.read_dependencies[query_dep_index]
            .rows
            .iter()
            .cloned()
            .collect();

        let ops = match compute_live_delta(plan, &subscription.input, &prior_ids, changes) {
            LiveDeltaOutcome::Delta(ops) => ops,
            LiveDeltaOutcome::Replace => return Ok(None),
        };
        if ops.is_empty() {
            // The matcher flagged the subscription as possibly affected, but no
            // committed row actually enters/leaves/updates its result. Nothing
            // to deliver — no re-query needed either. A `NoChange` settle is
            // itself a claim ("this commit does not change the result"), so
            // debug builds assert it against a fresh re-query: previously this
            // early return sat before the L4 oracle's only call site, which is
            // how the membership-gated freeze stayed invisible even in tests
            // (LLP 0067 §F2a).
            #[cfg(debug_assertions)]
            self.debug_assert_delta_membership_converges(subscription, query_dep_index, admission);
            return Ok(Some(DeltaFanout::NoChange));
        }
        // @ref LLP 0053#negative-deltas-are-obligations-positive-deltas-are-best-effort — a removal on an auth-scoped result takes the full obligation-backed snapshot path.
        if subscription.authorization.is_some()
            && ops
                .iter()
                .any(|operation| operation.kind == LiveDeltaKind::Remove)
        {
            return Ok(None);
        }

        let wire_ops: Vec<LiveDeltaWireOp> = ops
            .iter()
            .map(|op| LiveDeltaWireOp {
                op: match op.kind {
                    LiveDeltaKind::Add => LiveDeltaOpKind::Add,
                    LiveDeltaKind::Update => LiveDeltaOpKind::Update,
                    LiveDeltaKind::Remove => LiveDeltaOpKind::Remove,
                },
                id: op.id.clone(),
                row: op.row.clone(),
            })
            .collect();

        // RQS token refresh on the delta lane (LLP 0090 D1): apply the ops
        // to the held accumulator state — O(changed rows) — and mint the
        // shared fresh token at the new (version, digest). The updated state
        // commits into the stored subscription below, in the same guarded
        // block as the membership update, so digest state and membership
        // advance together.
        let mut refreshed_digest = None;
        let resume = if let Some(state) = subscription.rqs.as_ref() {
            let mut digest = state.digest.clone();
            match digest.apply_delta_ops(&wire_ops) {
                Ok(()) => {
                    let wire = self.refreshed_resume(
                        &state.query_artifact,
                        &state.args_hash,
                        frame_version,
                        digest.kind,
                        digest.published(),
                        resume_mint_cache,
                    );
                    refreshed_digest = Some(digest);
                    wire
                }
                Err(_) => {
                    self.live_delivery.resume.mint_refusals += 1;
                    None
                }
            }
        } else {
            None
        };
        let payload = match serde_json::to_vec(&LiveEnvelope::LiveDelta {
            subscription_id: subscription.id.clone(),
            function: subscription.function.clone(),
            version: frame_version,
            ops: wire_ops,
            resume,
        }) {
            Ok(payload) => payload,
            Err(error) => {
                return Ok(Some(DeltaFanout::Failed(
                    SnapbackError::error(
                        "SNAPBACK_LIVE_DELTA_SERIALIZE_FAILED",
                        "realtime",
                        "live query delta could not be serialized",
                    )
                    .with_details(json!({ "error": error.to_string() })),
                )));
            }
        };

        // Maintain this subscription's membership by applying the ops to its
        // captured Query dependency — no re-query. Add/remove change the id
        // set; update leaves membership unchanged. The exact applied commit
        // frame is a conservative cursor inseparable from these ops; sampling a
        // later table head could skip a sibling writer the delta never applied.
        let enqueue = {
            let _publication = admission.effect_guard("live delta publication")?;
            if let Some(stored) = self.subscriptions.get_mut(&subscription.id)
                && let Some(dependency) = stored.read_dependencies.get_mut(query_dep_index)
            {
                let mut removes: HashSet<&str> = HashSet::new();
                let mut adds: Vec<String> = Vec::new();
                for op in &ops {
                    match op.kind {
                        LiveDeltaKind::Add => {
                            adds.push(op.id.clone());
                        }
                        LiveDeltaKind::Remove => {
                            removes.insert(op.id.as_str());
                        }
                        LiveDeltaKind::Update => {}
                    }
                }
                if !removes.is_empty() {
                    dependency.rows.retain(|id| !removes.contains(id.as_str()));
                }
                if !adds.is_empty() {
                    let mut existing: HashSet<String> = dependency.rows.iter().cloned().collect();
                    for id in &adds {
                        if existing.insert(id.clone()) {
                            dependency.rows.push(id.clone());
                        }
                    }
                }
                dependency.version = Some(frame_version);
            }
            if let Some(digest) = refreshed_digest.take()
                && let Some(stored) = self.subscriptions.get_mut(&subscription.id)
                && let Some(state) = stored.rqs.as_mut()
            {
                state.digest = digest;
            }
            if subscription.authorization.is_some() {
                let authorization = self
                    .auth_invalidation
                    .as_ref()
                    .expect("auth-scoped live delta requires installed invalidation state")
                    .obligations
                    .expectation()
                    .authorization
                    .clone();
                self.enqueue_subscription_authorized_durable(subscription, payload, authorization)
            } else {
                self.enqueue_subscription_durable(subscription, payload)
            }
        };

        // Convergence gate (debug/test only): the delta-maintained member set
        // must equal what a fresh re-query would produce. Free in release; any
        // membership drift fails the test that exercises this path. (L4 parity
        // pattern.)
        #[cfg(debug_assertions)]
        self.debug_assert_delta_membership_converges(subscription, query_dep_index, admission);

        if enqueue.overflowed_now
            && let Err(error) =
                self.raise_connection_overflow(&subscription.connection_id, frame_version)
        {
            return Ok(Some(DeltaFanout::Failed(error)));
        }
        Ok(Some(DeltaFanout::Delivered))
    }

    /// Debug-only: re-run the subscription's query and assert the
    /// delta-maintained membership (the captured Query dependency's `rows`)
    /// equals the fresh result's ids. Catches any op-application drift.
    #[cfg(debug_assertions)]
    fn debug_assert_delta_membership_converges(
        &mut self,
        subscription: &LiveSubscription,
        query_dep_index: usize,
        admission: &AdmissionLease,
    ) {
        let Ok(fresh) = self
            .prepare_live_rerun_authority(&subscription.authority, admission.clone())
            .and_then(|authority| {
                self.invoke_query_with_dependencies_prepared(
                    &subscription.function,
                    subscription.input.clone(),
                    authority,
                )
            })
        else {
            return;
        };
        let fresh_ids: BTreeSet<&str> = fresh
            .read_dependencies
            .iter()
            .find(|dependency| dependency.kind == CapturedReadKind::Query)
            .map(|dependency| dependency.rows.iter().map(String::as_str).collect())
            .unwrap_or_default();
        let maintained_ids: BTreeSet<&str> = self
            .subscriptions
            .get(&subscription.id)
            .and_then(|stored| stored.read_dependencies.get(query_dep_index))
            .map(|dependency| dependency.rows.iter().map(String::as_str).collect())
            .unwrap_or_default();
        debug_assert_eq!(
            maintained_ids, fresh_ids,
            "live_delta membership drifted from a fresh re-query for subscription {}",
            subscription.id
        );
    }

    /// Record a post-commit fan-out failure for one subscription: a diagnostic
    /// in the ring, a failure counter, and a best-effort `resync_required`
    /// signal so the client re-snapshots instead of silently freezing. Never
    /// propagates — the mutation already committed.
    ///
    /// @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D4.
    fn fail_subscription_fanout(
        &mut self,
        subscription: &LiveSubscription,
        reason: &str,
        error: SnapbackError,
        min_commit_version: Option<u64>,
        admission: &AdmissionLease,
    ) {
        self.fail_subscription_fanout_with_retry(
            subscription,
            reason,
            error,
            None,
            min_commit_version,
            admission,
        );
    }

    fn fail_subscription_fanout_with_retry(
        &mut self,
        subscription: &LiveSubscription,
        reason: &str,
        error: SnapbackError,
        retry_episode_id: Option<String>,
        min_commit_version: Option<u64>,
        admission: &AdmissionLease,
    ) {
        self.live_delivery.total_failed += 1;
        self.live_delivery.last_failed += 1;
        let terminal_denial = error.is_trusted_permission_denial();
        let mut diagnostic = error.diagnostic;
        diagnostic.details = json!({
            "subscriptionId": subscription.id,
            "function": subscription.function,
            "reason": reason,
            "error": diagnostic.details,
        });
        self.record_diagnostics(vec![diagnostic]);
        let recovery = (|| -> SnapbackResult<()> {
            // A caller at a known committed frame must not re-read a damaged
            // head and then turn an already-confirmed mutation into an error.
            // Non-postcommit callers still fail closed on a missing cursor;
            // the wrapper records that recovery failure without propagating.
            let min_commit_version = match min_commit_version {
                Some(version) => version,
                None => self.db.current_version()?,
            };
            let _publication = admission.effect_guard("live failure/resync publication")?;
            if let Some(authorization) = subscription.authorization.as_ref() {
                let projected = self.auth_invalidation.as_mut().and_then(|state| {
                    let cause = state.reserve_cause_sequence().ok()?;
                    let witness = state.witness(min_commit_version);
                    state
                        .obligations
                        .raise(
                            authorization.scope_id.clone(),
                            cause,
                            format!("error:{cause}"),
                            if terminal_denial {
                                InvalidationDisposition::Delete
                            } else {
                                InvalidationDisposition::Quarantine
                            },
                            witness.clone(),
                            retry_episode_id,
                        )
                        .ok()?;
                    if terminal_denial {
                        state
                            .obligations
                            .issue_resolution(
                                &authorization.scope_id,
                                ResolutionKind::TerminalDelete,
                                witness.clone(),
                            )
                            .ok()?;
                    }
                    Some((
                        state.obligations.projection(&authorization.scope_id)?,
                        witness,
                    ))
                });
                if let Some((projection, witness)) = projected {
                    // A terminal denial closes the durable retry episode only
                    // after the delete proof has transferred to an exact-ACK
                    // ticket. Sending remains level-triggered and best effort.
                    if terminal_denial
                        && let Err(error) = self.resolve_authorization_retry_episode(
                            subscription,
                            &witness,
                            &_publication,
                        )
                    {
                        self.record_diagnostics(vec![error.diagnostic]);
                    }
                    if let Ok(payload) =
                        serde_json::to_vec(&LiveEnvelope::authorization_invalidation(
                            projection.obligation,
                            projection.resolution,
                            None,
                        ))
                    {
                        let enqueue = self.enqueue_subscription_durable(subscription, payload);
                        if enqueue.overflowed_now {
                            let _ = self.raise_connection_overflow(
                                &subscription.connection_id,
                                min_commit_version,
                            );
                        }
                    }
                }
            }
            if subscription.authorization.is_none()
                && let Ok(payload) = serde_json::to_vec(&LiveEnvelope::ResyncRequired {
                    reason: reason.to_owned(),
                    subscription_id: Some(subscription.id.clone()),
                    scope: Some(String::new()),
                    epoch: Some(0),
                    clear_retained: true,
                })
            {
                let enqueue = self.enqueue_subscription_durable(subscription, payload);
                if enqueue.overflowed_now {
                    let _ = self
                        .raise_connection_overflow(&subscription.connection_id, min_commit_version);
                }
            }
            Ok(())
        })();
        if let Err(error) = recovery {
            self.record_diagnostics(vec![error.diagnostic]);
        }
    }

    fn permission_epoch(&self, scope: &str) -> u64 {
        self.permission_epochs.get(scope).copied().unwrap_or(0)
    }

    /// Prove that every compatibility permission epoch can advance before a
    /// durable mutation starts. `finish_mutation_commit` runs after SQLite
    /// COMMIT and therefore cannot truthfully return an exhaustion error.
    /// Local serializes this preflight with the matching commit and the
    /// postcommit increment, so the proof cannot go stale in between.
    ///
    /// @ref LLP 0020#remaining-phase-4-design-dependency-vocabulary-and-auth-epochs — permission epochs are portable, precommit authorization identities.
    fn ensure_permission_epoch_capacity(&self, scopes: &BTreeSet<String>) -> SnapbackResult<()> {
        if let Some(scope) = scopes.iter().find(|scope| {
            self.permission_epoch(scope) >= crate::manifest::PORTABLE_STORAGE_VERSION_MAX
        }) {
            return Err(SnapbackError::error(
                "SNAPBACK_PERMISSION_EPOCH_EXHAUSTED",
                "realtime",
                format!(
                    "permission epoch for scope {scope} cannot advance within the portable integer domain"
                ),
            ));
        }
        Ok(())
    }

    /// Advance epochs for scopes already resolved pre-execution by
    /// [`evaluate_permission_epoch_scopes`]. Infallible on purpose: this runs
    /// after the mutation has durably committed, where an error return would
    /// misreport the committed write as rejected (ENG-23329).
    fn advance_permission_epochs(&mut self, scopes: &BTreeSet<String>) -> Vec<(String, u64)> {
        let mut changes = Vec::new();
        for scope in scopes {
            let epoch = self.permission_epochs.entry(scope.clone()).or_insert(0);
            *epoch = epoch
                .checked_add(1)
                .filter(|next| *next <= crate::manifest::PORTABLE_STORAGE_VERSION_MAX)
                .expect("permission epoch capacity is preflighted under Local before commit");
            changes.push((scope.clone(), *epoch));
        }
        changes
    }

    /// Post-commit permission-epoch resync fan-out. Like
    /// [`Self::notify_live_subscriptions`], a per-subscription serialization
    /// failure is a recorded diagnostic, never a failure of the committed
    /// mutation.
    ///
    /// @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D4.
    fn notify_permission_resyncs_in_frame(
        &mut self,
        changes: &[(String, u64)],
        frame_version: u64,
        admission: &AdmissionLease,
    ) -> SnapbackResult<BTreeSet<String>> {
        let mut resynced = BTreeSet::new();
        if changes.is_empty() || self.subscriptions.is_empty() {
            return Ok(resynced);
        }

        // Same prefilter shape as `notify_live_subscriptions` (ENG-23334):
        // the staleness check only borrows, so clone just the subscriptions
        // whose captured permission epochs the commit actually outran.
        let mut stale: Vec<(LiveSubscription, String, u64)> = Vec::new();
        for subscription in self.subscriptions.values() {
            if subscription.authorization.is_some() {
                continue;
            }
            let Some((scope, epoch)) = subscription_stale_permission_change(subscription, changes)
            else {
                continue;
            };
            stale.push((subscription.clone(), scope.clone(), *epoch));
        }

        for (subscription, scope, epoch) in stale {
            let payload = match serde_json::to_vec(&LiveEnvelope::ResyncRequired {
                reason: "permission_epoch_changed".to_owned(),
                subscription_id: Some(subscription.id.clone()),
                scope: Some(scope.clone()),
                epoch: Some(epoch),
                clear_retained: true,
            }) {
                Ok(payload) => payload,
                Err(error) => {
                    self.fail_subscription_fanout(
                        &subscription,
                        "permission_resync_serialize_failed",
                        SnapbackError::error(
                            "SNAPBACK_LIVE_UPDATE_SERIALIZE_FAILED",
                            "realtime",
                            "live resync message could not be serialized",
                        )
                        .with_details(json!({ "error": error.to_string() })),
                        Some(frame_version),
                        admission,
                    );
                    continue;
                }
            };
            let _publication = match admission.effect_guard("permission resync publication") {
                Ok(publication) => publication,
                Err(error) => {
                    self.fail_subscription_fanout(
                        &subscription,
                        "permission_resync_publication_failed",
                        error,
                        Some(frame_version),
                        admission,
                    );
                    continue;
                }
            };
            let enqueue = self.enqueue_subscription_durable(&subscription, payload);
            if enqueue.overflowed_now {
                let _ = self.raise_connection_overflow(&subscription.connection_id, frame_version);
            }
            self.live_delivery.total_deliveries += 1;
            self.live_delivery.last_deliveries += 1;
            resynced.insert(subscription.id);
        }
        Ok(resynced)
    }

    fn subscription_has_stale_permission(&self, subscription: &LiveSubscription) -> bool {
        subscription
            .read_dependencies
            .iter()
            .filter(|dependency| dependency.kind == CapturedReadKind::Permission)
            .any(|dependency| {
                let Some(scope) = dependency.value.as_ref().and_then(Value::as_str) else {
                    return true;
                };
                let Some(captured_epoch) = dependency.version else {
                    return true;
                };
                self.permission_epoch(scope) > captured_epoch
            })
    }

    fn resume_requires_resnapshot(
        &self,
        subscription: &LiveSubscription,
        recorded_permission_epochs: &BTreeMap<String, u64>,
    ) -> bool {
        subscription
            .read_dependencies
            .iter()
            .filter(|dependency| dependency.kind == CapturedReadKind::Permission)
            .any(|dependency| {
                let Some(scope) = dependency.value.as_ref().and_then(Value::as_str) else {
                    return true;
                };
                let Some(captured_epoch) = dependency.version else {
                    return true;
                };
                let current_epoch = self.permission_epoch(scope);
                recorded_permission_epochs.get(scope).copied() != Some(current_epoch)
                    || current_epoch != captured_epoch
            })
    }

    fn record_diagnostics(&mut self, diagnostics: Vec<Diagnostic>) {
        for diagnostic in diagnostics {
            let diagnostic = self.config.redact_diagnostic(diagnostic);
            self.recent_diagnostics.push_back(diagnostic);
            while self.recent_diagnostics.len() > MAX_RECENT_DIAGNOSTICS {
                let evict = self
                    .recent_diagnostics
                    .iter()
                    .position(|diagnostic| {
                        !matches!(
                            diagnostic.severity,
                            DiagnosticSeverity::Error | DiagnosticSeverity::Fatal
                        )
                    })
                    .unwrap_or(0);
                self.recent_diagnostics.remove(evict);
            }
        }
    }
}

/// Cap the echoed correlation (ENG-22478 review fix H): the rings are
/// bounded by COUNT, so an unbounded opaque echo could still pin
/// RECEIPT_RING_CAP x correlation-size bytes per ring. Oversized correlation
/// is replaced by an honest truncation marker.
const CORRELATION_ECHO_MAX_BYTES: usize = 4_096;

fn capped_correlation(correlation: Option<Value>) -> Option<Value> {
    let correlation = correlation?;
    let size = serde_json::to_string(&correlation)
        .map(|serialized| serialized.len())
        .unwrap_or(usize::MAX);
    if size > CORRELATION_ECHO_MAX_BYTES {
        return Some(json!({ "correlationTruncated": true, "bytes": size }));
    }
    Some(correlation)
}

fn user_permission_scope(user_id: &str) -> String {
    format!("user:{user_id}")
}

/// The manifest state a read-only query invocation needs, published as one
/// immutable snapshot so the read lane swaps it in O(1) and never blocks on
/// (or observes a partially-applied) manifest load.
struct ReadManifests {
    functions: FunctionManifest,
    schema: SchemaManifest,
    capabilities: RuntimeCapabilities,
}

/// The lock-free read lane (LLP 0032 L6): `/query` and `/health` execute
/// through this handle without taking the global write mutex. Data reads go to
/// the WAL reader pool inside a pinned read transaction; manifests and
/// permission epochs come from snapshots the write lane refreshes post-commit.
///
/// For in-memory databases (`pool: None`) the lane reports itself unavailable
/// and callers use the serialized write lane instead.
///
/// @ref LLP 0003#database-model — reads use a separate pool of WAL reader
/// connections so queries do not queue behind writes.
#[derive(Clone)]
pub struct ReadLane {
    manifests: Arc<RwLock<Arc<ReadManifests>>>,
    epochs: Arc<RwLock<Arc<BTreeMap<String, u64>>>>,
    auth_scoped_live_connections: Arc<RwLock<Arc<BTreeSet<String>>>>,
    pool: Option<Arc<ReaderPool>>,
    // Shared with the write lane: concurrent readers check out distinct VMs
    // (exclusive ownership per checkout), warming extras on miss up to the
    // pool bound.
    warm_vms: Arc<crate::warm_vm::WarmVmPool>,
    admission: AdmissionController,
    secret_read_reset_generation: Arc<AtomicU64>,
    // Shared with the write lane: relational pagination cursors are MAC'd
    // with the resume keyring, and the read lane serves `/query` (LLP 0080
    // §2 cursors) without the global mutex.
    resume_keyring: Arc<RwLock<crate::rqs::ResumeKeyring>>,
}

/// What the read lane can serve for `/health` without the global mutex.
pub struct ReadHealth {
    pub version: u64,
    pub capabilities: RuntimeCapabilities,
}

impl ReadLane {
    pub(crate) fn admission_controller(&self) -> AdmissionController {
        self.admission.clone()
    }

    pub(crate) fn secret_read_reset_generation(&self) -> Arc<AtomicU64> {
        self.secret_read_reset_generation.clone()
    }

    /// Whether the lock-free lane exists for this instance (file-backed WAL
    /// database). When false, callers must use the write lane.
    pub fn available(&self) -> bool {
        self.pool.is_some()
    }

    pub(crate) fn connection_has_auth_scoped_live(&self, connection_id: &str) -> bool {
        self.auth_scoped_live_connections
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains(connection_id)
    }

    /// Resolve one protected ephemeral-room grant without taking the global
    /// writer mutex. The permission row and authorization pair are read from
    /// one pinned WAL snapshot while the transport retains the room's
    /// precommit permit, so a stale lookup cannot cross the causing commit.
    ///
    /// @ref LLP 0053#ephemeral-room-authority-invalidation — lookup, room act,
    /// and final publication stay on one side of the targeted commit barrier.
    pub(crate) fn authorize_ephemeral_room_observed(
        &self,
        collection: EphemeralCollection,
        scope: crate::ephemeral::Scope,
        base_auth: AuthContext,
    ) -> SnapbackResult<(AuthContext, crate::storage::AuthorizationVersion)> {
        let projection = collection.permission_backing.as_ref().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                "auth",
                "protected room lacks its durable permissionBacking projection",
            )
        })?;
        let Some(user_id) = base_auth.user_id.as_deref() else {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_PERMISSION_DENIED",
                "auth",
                "durable room permission was denied",
            ));
        };
        let scope_fields = projection
            .scope_fields
            .iter()
            .map(|(scope_field, table_field)| {
                scope
                    .get(scope_field)
                    .map(|value| (table_field.clone(), value.to_owned()))
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_EPHEMERAL_INVALID_SCOPE",
                            "ephemeral",
                            "room scope does not satisfy its permissionBacking projection",
                        )
                    })
            })
            .collect::<SnapbackResult<Vec<_>>>()?;
        let pool = self.pool.as_ref().ok_or_else(read_lane_unavailable)?;
        let manifests = self.manifests();
        let reader = pool.checkout()?;
        let tx = reader.conn().unchecked_transaction()?;
        crate::storage::current_version_on(&tx)?;
        let granted = crate::storage::room_permission_projection_granted_on(
            &tx,
            &manifests.schema,
            &projection.table,
            &projection.subject_field,
            user_id,
            &scope_fields,
            0,
        )?;
        let authorization = crate::storage::authorization_version_on(&tx)?;
        tx.commit()?;
        if !granted {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_PERMISSION_DENIED",
                "auth",
                "durable room permission was denied",
            ));
        }
        Ok((
            collection.grant_projected_room_permission(base_auth, &scope),
            authorization,
        ))
    }

    fn manifests(&self) -> Arc<ReadManifests> {
        self.manifests
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Run a read-only query without the global mutex.
    ///
    /// Ordering matters: the permission-epoch snapshot is taken **before** the
    /// data snapshot pins. If an epoch bump races in between, the recorded
    /// epoch is older than the data and at worst conflicts/resyncs
    /// conservatively; the reverse order could label pre-bump data with a
    /// post-bump epoch and mask a permission resync.
    ///
    /// Known bounded edge (this arc's review): the manifest snapshot is cloned
    /// before the data snapshot pins, so a reader racing an `apply_schema` can
    /// decode post-migration rows with the pre-migration schema. The migrator
    /// is additive-only (create table / add column, never drop or retype), so
    /// the worst case is a new column surfacing untyped or as NULL for the
    /// microseconds between the DDL commit and this clone — never a query
    /// error or a torn row.
    ///
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6: the
    /// whole invocation — every `ctx.db` host call and the reported version —
    /// runs inside one pinned WAL read transaction.
    pub fn invoke_query(&self, name: &str, input: HandlerInput) -> SnapbackResult<QueryOutput> {
        self.invoke_query_from_source(name, input, InvocationSource::LocalQuery)
    }

    pub(crate) fn invoke_query_from_source(
        &self,
        name: &str,
        input: HandlerInput,
        source: InvocationSource,
    ) -> SnapbackResult<QueryOutput> {
        let authority = InvocationGate::prepare_admitted_dev_input(
            source,
            ServerProfile::Dev,
            &input,
            self.admission.admit_dev()?,
        )?;
        self.invoke_query_prepared(name, input, authority)
    }

    pub(crate) fn invoke_query_prepared(
        &self,
        name: &str,
        input: HandlerInput,
        authority: PreparedAuthority,
    ) -> SnapbackResult<QueryOutput> {
        let pool = self.pool.as_ref().ok_or_else(read_lane_unavailable)?;
        let manifests = self.manifests();
        let epochs = self
            .epochs
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let function = manifests.functions.function(name).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_UNKNOWN_FUNCTION",
                "runtime",
                format!("unknown function {name}"),
            )
        })?;
        let prepared = InvocationGate::prepare_function(authority, function)?;
        let input = prepared.canonicalize_input(input);

        let reader = pool.checkout()?;
        let tx = reader.conn().unchecked_transaction()?;
        // Pin the WAL snapshot now (the first read fixes it), before any
        // handler work, so rows, captured read versions, and the reported
        // version all come from this snapshot.
        crate::storage::current_version_on(&tx)?;
        let invocation = execute_query_invocation(
            function,
            name,
            DbRead::Pinned {
                conn: &tx,
                schema: &manifests.schema,
            },
            epochs.as_ref(),
            input,
            &prepared,
            Some(&self.warm_vms),
            Some(RelationalCursorAuthority {
                app_id: &manifests.functions.app_id,
                keyring: &self.resume_keyring,
            }),
        )?;
        Ok(invocation.output)
    }

    pub(crate) fn execute_detached_ibex_mutation(
        &self,
        module: &crate::manifest::IbexModule,
        input: HandlerInput,
        prepared: &PreparedInvocation,
        schema: &SchemaManifest,
        deadline: Instant,
    ) -> SnapbackResult<ExecutedIbexMutation> {
        let pool = self.pool.as_ref().ok_or_else(read_lane_unavailable)?;
        let reader = pool.checkout()?;
        let tx = reader.conn().unchecked_transaction()?;
        crate::storage::current_version_on(&tx)?;
        crate::runtime::execute_ibex_mutation_prepared(
            module,
            input,
            prepared,
            DbRead::Pinned { conn: &tx, schema },
            None,
            Some(deadline),
        )
    }

    /// Serve the `/health` payload without the global mutex.
    pub fn health(&self) -> SnapbackResult<ReadHealth> {
        let pool = self.pool.as_ref().ok_or_else(read_lane_unavailable)?;
        let manifests = self.manifests();
        let reader = pool.checkout()?;
        Ok(ReadHealth {
            version: crate::storage::current_version_on(reader.conn())?,
            capabilities: manifests.capabilities.clone(),
        })
    }
}

fn ephemeral_manifest_error(error: crate::ephemeral::EphemeralError) -> SnapbackError {
    SnapbackError::error(error.code.diagnostic_code(), "ephemeral", error.message)
}

/// Whole-manifest schema-reference preflight. Invocation-time checks remain as
/// defense in depth, but a malformed direct artifact must not replace a known
/// good function/config/cron generation and fail only on its first call.
fn validate_function_schema_references(
    manifest: &FunctionManifest,
    schema: &SchemaManifest,
) -> SnapbackResult<()> {
    let table = |name: &str| {
        schema.table(name).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID",
                "runtime",
                format!("function manifest references unknown table {name}"),
            )
        })
    };
    let field = |table_name: &str, field_name: &str| -> SnapbackResult<()> {
        let table = table(table_name)?;
        if matches!(field_name, "_id" | "_version" | "_createdAt" | "_updatedAt")
            || table.field(field_name).is_some()
        {
            Ok(())
        } else {
            Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID",
                "runtime",
                format!("function manifest references unknown field {table_name}.{field_name}"),
            ))
        }
    };
    let query = |plan: &QueryPlan| -> SnapbackResult<()> {
        crate::manifest::validate_query_plan_shape(plan)?;
        let table_manifest = table(&plan.table)?;
        // A membership table is authorization data first and application data
        // second. Until an explicit, closed row-visibility preset is carried by
        // the declaration, generated/direct HostPlan readers (including live
        // and retainable queries) may not expose it as their primary table.
        // The storage boundary separately fences dynamic/Ibex reads, while
        // internal declaration-bound probes bypass visibility non-recursively.
        // @ref LLP 0056#declaring-a-membership-table — roster reads are private
        //   by default on the enforceable direct/live/retained surfaces.
        if let Some(membership) = &table_manifest.membership {
            return Err(SnapbackError::error(
                "SNAPBACK_MEMBERSHIP_READ_PRIVATE",
                "runtime",
                format!(
                    "function manifest cannot expose membership declaration {:?} as a direct query primary table without an explicit visibility preset",
                    membership.effective_id(&table_manifest.name)
                ),
            )
            .with_details(json!({
                "table": table_manifest.name,
                "declaration": membership.effective_id(&table_manifest.name),
            })));
        }
        if let Some(index) = &plan.indexed_by
            && !table_manifest
                .indexes
                .iter()
                .any(|candidate| &candidate.name == index)
        {
            return Err(SnapbackError::error(
                "SNAPBACK_QUERY_UNKNOWN_INDEX",
                "runtime",
                format!("query references unknown index {}.{index}", plan.table),
            ));
        }
        for filter in &plan.filters {
            field(&plan.table, &filter.field)?;
        }
        for order in &plan.order {
            field(&plan.table, &order.field)?;
            if table_manifest
                .field(&order.field)
                .is_some_and(|declared| declared.field_type == crate::manifest::FieldType::Json)
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_QUERY_ORDER_UNSUPPORTED_FIELD_TYPE",
                    "runtime",
                    format!(
                        "query cannot order by Json field {}.{}",
                        plan.table, order.field
                    ),
                ));
            }
        }
        for predicate in &plan.membership_filters {
            crate::membership_rules::validate_membership_predicate(
                schema,
                table_manifest,
                predicate,
            )?;
        }
        Ok(())
    };

    for function in &manifest.functions {
        match &function.runtime {
            FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) => query(plan)?,
            // @ref LLP 0080#1-closed-relational-plan — activation validates
            //   the root window exactly like a single-table plan (fields,
            //   membership privacy, Json-order refusal, named root index)
            //   and proves the joined side: fields exist, the membership
            //   privacy rule holds, and the named joined index is unique
            //   with its complete ordered key exactly the joined-field
            //   sequence — the cardinality proof, checked from declarations,
            //   never assumed.
            FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan)) => {
                let mut root_filters = plan.root_visibility.clone();
                root_filters.extend(plan.root_filters.iter().cloned());
                query(&QueryPlan {
                    table: plan.root.clone(),
                    filters: root_filters,
                    order: plan.order.clone(),
                    limit: Some(plan.take as usize),
                    membership_filters: Vec::new(),
                    indexed_by: Some(plan.root_index.clone()),
                })?;
                for pair in &plan.join_on {
                    field(&plan.root, &pair.root_field)?;
                }
                let mut joined_filters: Vec<crate::manifest::FilterExpr> = plan
                    .join_on
                    .iter()
                    .map(|pair| crate::manifest::FilterExpr {
                        field: pair.joined_field.clone(),
                        op: crate::manifest::FilterOp::Eq,
                        value: ValueExpr::Literal(Value::Null),
                    })
                    .collect();
                joined_filters.extend(plan.joined_visibility.iter().cloned());
                query(&QueryPlan {
                    table: plan.joined.clone(),
                    filters: joined_filters,
                    order: Vec::new(),
                    limit: Some(1),
                    membership_filters: Vec::new(),
                    indexed_by: None,
                })?;
                let joined_table = table(&plan.joined)?;
                let key: Vec<&str> = plan
                    .join_on
                    .iter()
                    .map(|pair| pair.joined_field.as_str())
                    .collect();
                let proven = joined_table.indexes.iter().any(|candidate| {
                    candidate.name == plan.joined_index
                        && candidate.unique
                        && candidate.fields.iter().map(String::as_str).collect::<Vec<_>>() == key
                });
                if !proven {
                    return Err(SnapbackError::error(
                        "SNAPBACK_RELATIONAL_CARDINALITY_UNPROVEN",
                        "runtime",
                        format!(
                            "relational plan for {} requires unique index {}.{} whose complete \
                             ordered key is exactly the joined-field sequence",
                            function.name, plan.joined, plan.joined_index
                        ),
                    ));
                }
                for leaf in &plan.projection {
                    match &leaf.source {
                        crate::manifest::ProjectionSource::RootField(name) => {
                            field(&plan.root, name)?;
                        }
                        crate::manifest::ProjectionSource::JoinedField(name) => {
                            field(&plan.joined, name)?;
                        }
                        crate::manifest::ProjectionSource::Literal(_) => {}
                    }
                }
            }
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan)) => {
                for step in &plan.steps {
                    match step {
                        MutationStep::Insert {
                            table: name,
                            values,
                            ..
                        }
                        | MutationStep::Patch {
                            table: name,
                            values,
                            ..
                        }
                        | MutationStep::InsertEach {
                            table: name,
                            values,
                            ..
                        } => {
                            table(name)?;
                            for field_name in values.keys() {
                                field(name, field_name)?;
                            }
                        }
                        MutationStep::Delete { table: name, .. }
                        | MutationStep::Get { table: name, .. } => {
                            table(name)?;
                        }
                        MutationStep::DeleteWhere {
                            table: name,
                            filter: filters,
                        } => {
                            table(name)?;
                            for filter in filters {
                                field(name, &filter.field)?;
                            }
                        }
                        MutationStep::Guard { .. } | MutationStep::Let { .. } => {}
                    }
                }
                if let Some(crate::manifest::ReturnValue::Document { table: name, .. }) =
                    &plan.return_value
                {
                    table(name)?;
                }
            }
            FunctionRuntime::HostPlan(HandlerPlan::Action(_)) | FunctionRuntime::IbexModule(_) => {}
        }
        for dependency in function
            .read_set_summary
            .tables
            .iter()
            .chain(function.write_set_summary.tables.iter())
            .chain(function.read_set_summary.primary_table.iter())
            .chain(function.write_set_summary.primary_table.iter())
        {
            table(dependency)?;
        }
        if let Some(auth_scope_field) = &function.read_set_summary.auth_scope_field {
            let primary_table = function
                .read_set_summary
                .primary_table
                .as_deref()
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID",
                        "runtime",
                        format!(
                            "function {} declares authScopeField without a primary read table",
                            function.name
                        ),
                    )
                })?;
            field(primary_table, auth_scope_field)?;
        }
    }
    Ok(())
}

fn read_lane_unavailable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_READ_LANE_UNAVAILABLE",
        "storage",
        "the lock-free read lane requires a file-backed WAL database",
    )
}

/// What the relational-cursor layer needs from the serving instance: the
/// app identity the cursor binds and the resume keyring that MACs it.
/// Possession of a cursor grants no authority — the binding digest re-proves
/// plan, arguments, and authority partition on every presentation.
#[derive(Clone, Copy)]
pub(crate) struct RelationalCursorAuthority<'a> {
    pub(crate) app_id: &'a str,
    pub(crate) keyring: &'a RwLock<crate::rqs::ResumeKeyring>,
}

/// The one uniform cursor refusal (LLP 0080 §2): malformed, cross-plan,
/// cross-argument-set, cross-authority, stale-authority, and
/// order-schema-invalid boundaries must stay byte-indistinguishable, so
/// every class produces this exact error and no per-cause detail.
fn relational_cursor_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_RELATIONAL_CURSOR_INVALID",
        "query",
        "relational cursor is not valid for this plan, argument set, and caller; \
         request the first page without a cursor",
    )
}

fn relational_cursor_mint_unavailable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_RELATIONAL_CURSOR_MINT_UNAVAILABLE",
        "query",
        "a full relational page could not mint its continuation cursor; retry the request",
    )
}

/// The one uniform standard-pattern cursor refusal (LLP 0065): malformed,
/// cross-plan, and cross-owner presentations must stay
/// byte-indistinguishable, so every class produces this exact error.
fn standard_pattern_cursor_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID",
        "query",
        "pagination cursor is not valid for this operation and caller; \
         request the first page again",
    )
}

fn standard_pattern_cursor_mint_unavailable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_STANDARD_PATTERN_CURSOR_MINT_UNAVAILABLE",
        "query",
        "a full page could not mint its continuation cursor; retry the request",
    )
}

/// The generated `defineOwnedKeysetPages` facts the runtime recovers from a
/// standard-pattern function's own plan: the strict continuation filter
/// names the cursor argument, the (single) order field is the cursor field,
/// and the plan limit is the page size. Recovered rather than re-declared so
/// the manifest stays closed and the two can never disagree.
struct StandardPatternKeysetFacts<'a> {
    cursor_arg: Option<&'a str>,
    cursor_field: &'a str,
    page_limit: usize,
}

fn standard_pattern_keyset_facts<'a>(
    function: &'a FunctionDefinition,
    plan: &'a QueryPlan,
) -> Option<StandardPatternKeysetFacts<'a>> {
    let pattern = function.standard_pattern.as_ref()?;
    if pattern.helper != "owned-keyset-pages.v1" {
        return None;
    }
    let order = plan.order.first()?;
    let page_limit = plan.limit?;
    let mut cursor_arg = None;
    for filter in &plan.filters {
        let strict = matches!(
            (&filter.op, &order.direction),
            (crate::manifest::FilterOp::Gt, crate::manifest::OrderDirection::Asc)
                | (crate::manifest::FilterOp::Lt, crate::manifest::OrderDirection::Desc)
        );
        if filter.field == order.field
            && strict
            && let ValueExpr::Arg(name) = &filter.value
        {
            cursor_arg = Some(name.as_str());
        }
    }
    Some(StandardPatternKeysetFacts {
        cursor_arg,
        cursor_field: &order.field,
        page_limit,
    })
}

/// The standard-pattern cursor binding digest (LLP 0065): app, the *pair*
/// plan identity, and the caller's authority partition. A keyset pair's
/// first and next functions share everything except the strict
/// continuation filter, so the binding covers the plan with that filter
/// excluded — a cursor minted by `first` continues through `next`, while a
/// different table, index, order, direction, page size, visibility, or
/// pattern profile still refuses. The deployment/database axis rides the
/// per-instance MAC keyring rather than the digest.
fn standard_pattern_cursor_binding(
    app_id: &str,
    function: &FunctionDefinition,
    plan: &QueryPlan,
    facts: &StandardPatternKeysetFacts<'_>,
    input: &HandlerInput,
    permission_epochs: &BTreeMap<String, u64>,
) -> Result<String, ()> {
    let pattern = function.standard_pattern.as_ref().ok_or(())?;
    let shared_filters: Vec<Value> = plan
        .filters
        .iter()
        .filter(|filter| {
            !(filter.field == facts.cursor_field
                && matches!(
                    filter.op,
                    crate::manifest::FilterOp::Gt | crate::manifest::FilterOp::Lt
                )
                && matches!(&filter.value, ValueExpr::Arg(_)))
        })
        .map(|filter| serde_json::to_value(filter).unwrap_or(Value::Null))
        .collect();
    let epochs: Value = match input.auth.user_id.as_deref() {
        Some(user_id) => {
            let scope = user_permission_scope(user_id);
            let epoch = permission_epochs.get(&scope).copied().unwrap_or(0);
            json!({ scope: epoch })
        }
        None => json!({}),
    };
    let binding = json!({
        "app": app_id,
        "helper": pattern.helper,
        "profile": pattern.profile,
        "table": plan.table,
        "index": plan.indexed_by,
        "order": serde_json::to_value(&plan.order).map_err(|_| ())?,
        "limit": plan.limit,
        "filters": shared_filters,
        "authority": {
            "fingerprint": crate::manifest::auth_fingerprint(&input.auth),
            "epochs": epochs,
        },
    });
    crate::rqs::sha256_identity(&binding).map_err(|_| ())
}

/// The canonical cursor binding digest (LLP 0080 §2): the cursor binds the
/// app, the plan, the normalized non-cursor arguments, the order schema, and
/// the caller's authority partition (auth fingerprint plus the caller's
/// permission-scope epoch, which rolls on authorization change — the
/// stale-authority refusal).
fn relational_cursor_binding(
    app_id: &str,
    plan: &crate::manifest::RelationalQueryPlan,
    input: &HandlerInput,
    permission_epochs: &BTreeMap<String, u64>,
    schema: &SchemaManifest,
) -> Result<String, ()> {
    let root_table = schema.tables.iter().find(|table| table.name == plan.root);
    let order_schema: Vec<Value> = plan
        .order
        .iter()
        .map(|order| {
            let declared = root_table
                .and_then(|table| table.field(&order.field))
                .map(|field| {
                    serde_json::to_value(&field.field_type).unwrap_or(Value::Null)
                })
                .unwrap_or_else(|| Value::String("system".to_owned()));
            json!({
                "field": order.field,
                "direction": match order.direction {
                    crate::manifest::OrderDirection::Asc => "asc",
                    crate::manifest::OrderDirection::Desc => "desc",
                },
                "type": declared,
            })
        })
        .collect();
    let mut args = input.args.clone();
    if let Value::Object(map) = &mut args {
        map.remove("cursor");
    }
    let epochs: Value = match input.auth.user_id.as_deref() {
        Some(user_id) => {
            let scope = user_permission_scope(user_id);
            let epoch = permission_epochs.get(&scope).copied().unwrap_or(0);
            json!({ scope: epoch })
        }
        None => json!({}),
    };
    let binding = json!({
        "app": app_id,
        "plan": serde_json::to_value(plan).map_err(|_| ())?,
        "args": args,
        "orderSchema": order_schema,
        "authority": {
            "fingerprint": crate::manifest::auth_fingerprint(&input.auth),
            "epochs": epochs,
        },
    });
    crate::rqs::sha256_identity(&binding).map_err(|_| ())
}

/// Execute a query-shaped invocation against any read view: the write lane
/// passes the live connection and its own epoch map; the read lane passes a
/// pinned reader and its snapshots. One implementation, so the two lanes
/// cannot drift.
#[allow(clippy::too_many_arguments)]
fn execute_query_invocation(
    function: &FunctionDefinition,
    name: &str,
    db: DbRead<'_>,
    permission_epochs: &BTreeMap<String, u64>,
    input: HandlerInput,
    prepared: &PreparedInvocation,
    warm_vms: Option<&crate::warm_vm::WarmVmPool>,
    cursor_authority: Option<RelationalCursorAuthority<'_>>,
) -> SnapbackResult<QueryInvocation> {
    if let DbRead::Live(live) = db {
        return live.with_pinned_read_view(|db| {
            execute_query_invocation(
                function,
                name,
                db,
                permission_epochs,
                input,
                prepared,
                warm_vms,
                cursor_authority,
            )
        });
    }
    prepared.validate_admission("query execution")?;
    let invocation = match (&function.kind, &function.runtime) {
        (
            FunctionKind::Query | FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::Query(plan)),
        ) => {
            // @ref LLP 0065#3-common-pattern-contracts — defineOwnedKeysetPages
            //   continuation is an opaque versioned cursor: the runtime
            //   verifies the presented token (MAC + binding over app, plan
            //   identity, and authority partition), substitutes the bound
            //   boundary value for the cursor argument, and mints the next
            //   continuation for a full page. Malformed, cross-plan, and
            //   cross-owner presentations refuse byte-identically and are
            //   never repositioned.
            let keyset = standard_pattern_keyset_facts(function, plan);
            let mut input = input;
            if let Some(facts) = &keyset
                && let Some(arg_name) = facts.cursor_arg
            {
                match input.args.get(arg_name).cloned() {
                    None | Some(Value::Null) => {}
                    Some(Value::String(token)) => {
                        let authority =
                            cursor_authority.ok_or_else(standard_pattern_cursor_invalid)?;
                        let body = crate::rqs::decode_and_verify_standard_pattern_cursor(
                            &token,
                            &authority
                                .keyring
                                .read()
                                .unwrap_or_else(|poisoned| poisoned.into_inner()),
                            now_millis(),
                            crate::rqs::RELATIONAL_CURSOR_MAX_AGE_MS,
                        )
                        .map_err(|_| standard_pattern_cursor_invalid())?;
                        let binding = standard_pattern_cursor_binding(
                            authority.app_id,
                            function,
                            plan,
                            facts,
                            &input,
                            permission_epochs,
                        )
                        .map_err(|()| standard_pattern_cursor_invalid())?;
                        if body.app != authority.app_id || body.binding != binding {
                            return Err(standard_pattern_cursor_invalid());
                        }
                        crate::storage::validate_standard_pattern_boundary(
                            db.schema(),
                            &plan.table,
                            facts.cursor_field,
                            &body.boundary,
                        )
                        .map_err(|_| standard_pattern_cursor_invalid())?;
                        if let Value::Object(args) = &mut input.args {
                            args.insert(arg_name.to_owned(), body.boundary);
                        }
                    }
                    Some(_) => return Err(standard_pattern_cursor_invalid()),
                }
            }
            let mut output = db.query(plan, &input)?;
            if let Some(facts) = &keyset
                && facts.page_limit > 0
                && output.rows.len() == facts.page_limit
            {
                // A full page must carry its continuation (mirrors the
                // relational rule): mint failure fails the request rather
                // than misreporting the page as terminal.
                let boundary = output
                    .rows
                    .last()
                    .and_then(|row| row.get(facts.cursor_field).cloned())
                    .filter(|value| !value.is_null())
                    .ok_or_else(standard_pattern_cursor_mint_unavailable)?;
                let authority =
                    cursor_authority.ok_or_else(standard_pattern_cursor_mint_unavailable)?;
                let binding = standard_pattern_cursor_binding(
                    authority.app_id,
                    function,
                    plan,
                    facts,
                    &input,
                    permission_epochs,
                )
                .map_err(|()| standard_pattern_cursor_mint_unavailable())?;
                let (key_id, key) = authority
                    .keyring
                    .read()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .active_current()
                    .ok_or_else(standard_pattern_cursor_mint_unavailable)?;
                let body = crate::rqs::StandardPatternCursorBody {
                    app: authority.app_id.to_owned(),
                    binding,
                    boundary,
                    issued_at: now_millis(),
                };
                output.cursor = Some(
                    crate::rqs::mint_standard_pattern_cursor(key.as_ref(), &key_id, &body)
                        .ok_or_else(standard_pattern_cursor_mint_unavailable)?,
                );
            }
            let mut read_dependencies = query_dependencies_from_plan(plan, &input, &output, &db)?;
            add_permission_dependencies_with(permission_epochs, &input, &mut read_dependencies);
            Ok(QueryInvocation {
                output,
                read_dependencies,
            })
        }
        (
            FunctionKind::Query | FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan)),
        ) => {
            // @ref LLP 0080#2-portable-evaluation-semantics — opaque
            //   versioned cursor: verify the presented cursor's MAC and
            //   binding digest, validate its boundary against the order
            //   schema, execute from that boundary, and mint the
            //   continuation for a full page. All six refusal classes
            //   collapse into the one byte-identical refusal and are never
            //   repositioned.
            let presented = match input.args.get("cursor") {
                None | Some(Value::Null) => None,
                Some(Value::String(token)) => Some(token.clone()),
                Some(_) => return Err(relational_cursor_invalid()),
            };
            let keyset = match presented {
                None => None,
                Some(token) => {
                    let authority = cursor_authority.ok_or_else(relational_cursor_invalid)?;
                    let body = crate::rqs::decode_and_verify_relational_cursor(
                        &token,
                        &authority
                            .keyring
                            .read()
                            .unwrap_or_else(|poisoned| poisoned.into_inner()),
                        now_millis(),
                        crate::rqs::RELATIONAL_CURSOR_MAX_AGE_MS,
                    )
                    .map_err(|_| relational_cursor_invalid())?;
                    let binding = relational_cursor_binding(
                        authority.app_id,
                        plan,
                        &input,
                        permission_epochs,
                        db.schema(),
                    )
                    .map_err(|()| relational_cursor_invalid())?;
                    if body.app != authority.app_id || body.binding != binding {
                        return Err(relational_cursor_invalid());
                    }
                    Some(
                        crate::storage::validate_relational_boundary(
                            db.schema(),
                            plan,
                            &body.boundary,
                            &body.id,
                        )
                        .map_err(|_| relational_cursor_invalid())?,
                    )
                }
            };
            // @ref LLP 0080#4-live-and-retained-capability — relational reads
            //   deliberately capture no Query-kind dependency: the matcher
            //   then falls through to the table-granular runtime arm, so any
            //   commit touching either declared source resnapshots and no
            //   proved-disjoint skip is claimed.
            let (mut output, continuation) =
                crate::storage::query_relational_on(&db, plan, &input, keyset.as_ref())?;
            if let Some(boundary) = continuation {
                // A full page must carry its continuation: silently omitting
                // it would misreport the page as terminal, so mint failure
                // fails the request rather than the pagination contract.
                let authority =
                    cursor_authority.ok_or_else(relational_cursor_mint_unavailable)?;
                let binding = relational_cursor_binding(
                    authority.app_id,
                    plan,
                    &input,
                    permission_epochs,
                    db.schema(),
                )
                .map_err(|()| relational_cursor_mint_unavailable())?;
                let (key_id, key) = authority
                    .keyring
                    .read()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .active_current()
                    .ok_or_else(relational_cursor_mint_unavailable)?;
                let body = crate::rqs::RelationalCursorBody {
                    app: authority.app_id.to_owned(),
                    binding,
                    boundary: boundary.entries.into_iter().map(|(_, value)| value).collect(),
                    id: boundary.id,
                    issued_at: now_millis(),
                };
                output.cursor = Some(
                    crate::rqs::mint_relational_cursor(key.as_ref(), &key_id, &body)
                        .ok_or_else(relational_cursor_mint_unavailable)?,
                );
            }
            let mut read_dependencies = Vec::new();
            if let Some(user_id) = input.auth.user_id.as_deref() {
                read_dependencies.push(CapturedReadDependency {
                    kind: CapturedReadKind::Auth,
                    table: None,
                    id: None,
                    version: None,
                    predicate: None,
                    rows: Vec::new(),
                    field: Some("userId".to_owned()),
                    value: Some(Value::String(user_id.to_owned())),
                    order: None,
                    limit: None,
                    result_count: None,
                    boundary: None,
                });
            }
            add_permission_dependencies_with(permission_epochs, &input, &mut read_dependencies);
            Ok(QueryInvocation {
                output,
                read_dependencies,
            })
        }
        (FunctionKind::Query | FunctionKind::LiveQuery, FunctionRuntime::IbexModule(module)) => {
            let protected_query_profile = function.is_protected_query();
            let run = crate::runtime::run_ibex_query_with_reads_prepared(
                module,
                input.clone(),
                prepared,
                db,
                if protected_query_profile {
                    None
                } else {
                    warm_vms
                },
                protected_query_profile,
            )?;
            let mut read_dependencies = run.read_dependencies;
            add_permission_dependencies_with(permission_epochs, &input, &mut read_dependencies);
            Ok(QueryInvocation {
                output: run.output,
                read_dependencies,
            })
        }
        _ => Err(SnapbackError::error(
            "SNAPBACK_FUNCTION_KIND_MISMATCH",
            "runtime",
            format!("{name} is not a query"),
        )),
    }?;
    #[cfg(test)]
    BEFORE_QUERY_RESULT_HANDOFF_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook();
        }
    });
    let _publication = prepared.effect_guard("query result handoff")?;
    Ok(invocation)
}

fn add_permission_dependencies_with(
    permission_epochs: &BTreeMap<String, u64>,
    input: &HandlerInput,
    dependencies: &mut Vec<CapturedReadDependency>,
) {
    let Some(user_id) = input.auth.user_id.as_deref() else {
        return;
    };
    let scope = user_permission_scope(user_id);
    if dependencies.iter().any(|dependency| {
        dependency.kind == CapturedReadKind::Permission
            && dependency.value.as_ref().and_then(Value::as_str) == Some(scope.as_str())
    }) {
        return;
    }
    dependencies.push(CapturedReadDependency {
        kind: CapturedReadKind::Permission,
        table: None,
        id: None,
        version: Some(permission_epochs.get(&scope).copied().unwrap_or(0)),
        predicate: None,
        rows: Vec::new(),
        field: Some("scope".to_owned()),
        value: Some(Value::String(scope)),
        order: None,
        limit: None,
        result_count: None,
        boundary: None,
    });
}

fn permission_epochs_from_dependencies(
    dependencies: &[CapturedReadDependency],
) -> BTreeMap<String, u64> {
    let mut epochs = BTreeMap::new();
    for dependency in dependencies
        .iter()
        .filter(|dependency| dependency.kind == CapturedReadKind::Permission)
    {
        let Some(scope) = dependency.value.as_ref().and_then(Value::as_str) else {
            continue;
        };
        let Some(epoch) = dependency.version else {
            continue;
        };
        epochs.insert(scope.to_owned(), epoch);
    }
    epochs
}

fn current_permission_epochs_for_dependencies(
    dependencies: &[CapturedReadDependency],
    current_epoch: impl Fn(&str) -> u64,
) -> BTreeMap<String, u64> {
    let mut epochs = BTreeMap::new();
    for dependency in dependencies
        .iter()
        .filter(|dependency| dependency.kind == CapturedReadKind::Permission)
    {
        let Some(scope) = dependency.value.as_ref().and_then(Value::as_str) else {
            continue;
        };
        let epoch = dependency.version.unwrap_or_else(|| current_epoch(scope));
        epochs.insert(scope.to_owned(), epoch);
    }
    epochs
}

/// Resolve every declared `permission_epoch_bumps` scope for a mutation
/// invocation. Called pre-execution so a scope that cannot be evaluated
/// (missing auth user, missing arg, empty scope) rejects the mutation before
/// any write, never after commit (ENG-23329).
fn evaluate_permission_epoch_scopes(
    function: &FunctionDefinition,
    input: &HandlerInput,
) -> SnapbackResult<BTreeSet<String>> {
    let mut scopes = BTreeSet::new();
    for expr in &function.permission_epoch_bumps {
        scopes.insert(evaluate_permission_scope(expr, input)?);
    }
    Ok(scopes)
}

fn evaluate_permission_scope(
    expr: &PermissionScopeExpr,
    input: &HandlerInput,
) -> SnapbackResult<String> {
    let scope = match expr {
        PermissionScopeExpr::AuthUser => {
            let Some(user_id) = input.auth.user_id.as_deref() else {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_USER_MISSING",
                    "runtime",
                    "permission scope requires an authenticated user",
                ));
            };
            user_permission_scope(user_id)
        }
        PermissionScopeExpr::Arg(path) => {
            lookup_arg_string(&input.args, path).ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_PERMISSION_SCOPE_MISSING",
                    "runtime",
                    "permission scope argument is missing or is not a string",
                )
                .with_details(json!({ "path": path }))
            })?
        }
        PermissionScopeExpr::Literal(scope) => scope.clone(),
    };

    if scope.is_empty() {
        return Err(SnapbackError::error(
            "SNAPBACK_PERMISSION_SCOPE_MISSING",
            "runtime",
            "permission scope is empty",
        ));
    }

    Ok(scope)
}

fn lookup_arg_string(args: &Value, path: &str) -> Option<String> {
    if path.is_empty() {
        return None;
    }

    let mut current = args;
    for segment in path.split('.') {
        current = current.get(segment)?;
    }
    current.as_str().map(ToOwned::to_owned)
}

fn subscription_stale_permission_change<'a>(
    subscription: &LiveSubscription,
    changes: &'a [(String, u64)],
) -> Option<(&'a String, &'a u64)> {
    for dependency in subscription
        .read_dependencies
        .iter()
        .filter(|dependency| dependency.kind == CapturedReadKind::Permission)
    {
        let Some(scope) = dependency.value.as_ref().and_then(Value::as_str) else {
            continue;
        };
        let captured_epoch = dependency.version.unwrap_or_default();
        for (changed_scope, epoch) in changes {
            if changed_scope == scope && *epoch > captured_epoch {
                return Some((changed_scope, epoch));
            }
        }
    }
    None
}

fn eval_action_args(
    args: &BTreeMap<String, ValueExpr>,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    metadata: &CronRunMetadata,
    snapback: &LocalSnapback,
) -> SnapbackResult<Map<String, Value>> {
    let mut output = Map::new();
    for (name, expr) in args {
        output.insert(
            name.clone(),
            eval_action_expr(expr, input, bindings, metadata, snapback)?,
        );
    }
    Ok(output)
}

// Delegates to the shared profile evaluator; only the intrinsic sources
// differ here (cron actions stamp `RuntimeNow` from the run's due time and
// draw ids from the store's generator).
fn eval_action_expr(
    expr: &ValueExpr,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    metadata: &CronRunMetadata,
    snapback: &LocalSnapback,
) -> SnapbackResult<Value> {
    let generate_id = || Ok(snapback.db.generate_id());
    let env = crate::value_expr::ExprEnv {
        args: &input.args,
        auth_user_id: input.auth.user_id.as_deref(),
        auth_kind: input.auth.authorization_kind.as_deref(),
        auth_actor_kind: input.auth.authorization_actor_kind.as_deref(),
        auth_is_delegated: input.auth.authorization_is_delegated,
        bindings: Some(bindings),
        now_ms: Some(metadata.due_at_ms),
        runtime_id: Some(&generate_id),
    };
    crate::value_expr::eval_value_expr(expr, &env).map_err(|error| error.into_snapback())
}

fn plan_io(definition: &FunctionDefinition) -> (Vec<String>, Vec<String>) {
    match &definition.runtime {
        FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) => {
            (vec![plan.table.clone()], Vec::new())
        }
        FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan)) => {
            (vec![plan.root.clone(), plan.joined.clone()], Vec::new())
        }
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan)) => {
            let mut reads = BTreeSet::new();
            let mut writes = BTreeSet::new();
            for step in &plan.steps {
                match step {
                    MutationStep::Insert { table, .. } | MutationStep::InsertEach { table, .. } => {
                        writes.insert(table.clone());
                    }
                    MutationStep::Patch { table, .. }
                    | MutationStep::Delete { table, .. }
                    | MutationStep::DeleteWhere { table, .. } => {
                        reads.insert(table.clone());
                        writes.insert(table.clone());
                    }
                    MutationStep::Get { table, .. } => {
                        reads.insert(table.clone());
                    }
                    MutationStep::Guard { .. } | MutationStep::Let { .. } => {}
                }
            }
            (reads.into_iter().collect(), writes.into_iter().collect())
        }
        FunctionRuntime::HostPlan(HandlerPlan::Action(_)) => (
            definition.read_set_summary.tables.clone(),
            definition.write_set_summary.tables.clone(),
        ),
        FunctionRuntime::IbexModule(_) => (
            definition.read_set_summary.tables.clone(),
            definition.write_set_summary.tables.clone(),
        ),
    }
}

/// HostPlan writes do not traverse the Ibex host-call dispatcher and cannot
/// attach LLP 0056's full provenance. Refuse their permission-backing effects
/// under service-principal authority at the last runtime seam before plan
/// execution; ordinary app-data HostPlans and every human invocation remain
/// unchanged.
///
/// @ref LLP 0055#grants — non-provenanced permission-backing writes have no
///   consentable service-principal lane in v1.
fn refuse_unprovenanced_host_plan_authority_creation(
    prepared: &PreparedInvocation,
    function: &FunctionDefinition,
    schema: &SchemaManifest,
) -> SnapbackResult<()> {
    if !matches!(
        prepared.authority().resolved(),
        ResolvedAppAuthority::ServicePrincipal { .. }
    ) || !matches!(
        function.runtime,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(_))
    ) {
        return Ok(());
    }
    let (_, writes) = plan_io(function);
    if let Some(table) = writes.iter().find_map(|name| {
        schema
            .tables
            .iter()
            .find(|table| table.name == *name && table.is_permission_backing())
    }) {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED",
            "auth",
            "service-principal HostPlan writes to permission-backing tables are unavailable without full provenance",
        )
        .with_details(json!({
            "reason": "permission_backing_provenance_unavailable",
            "table": table.name,
        })));
    }
    Ok(())
}

pub(crate) fn live_stream_text(envelope: RealtimeEnvelope) -> Option<String> {
    match envelope {
        RealtimeEnvelope::Durable(message) => String::from_utf8(message.payload)
            .or_else(|error| {
                serde_json::to_string(&LiveSocketServerFrame::DurableBytes {
                    payload: error.into_bytes(),
                })
            })
            .ok(),
        RealtimeEnvelope::Ephemeral(message) => {
            serde_json::to_string(&LiveSocketServerFrame::Ephemeral { message }).ok()
        }
    }
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis() as u64
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn auth_resnapshot_required() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_RESNAPSHOT_REQUIRED",
        "auth",
        "the authorization scope is unknown, retired, or belongs to an extinct connection; establish a fresh snapshot",
    )
    .with_details(json!({ "reason": "unknownOrReaped" }))
}

fn live_owner_mismatch(subscription_id: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_LIVE_RESUME_OWNERSHIP",
        "realtime",
        format!("subscription {subscription_id} is owned by a different live owner"),
    )
}

#[cfg(test)]
mod authorization_acceptance;

#[cfg(test)]
mod auth_room_kick_acceptance;

#[cfg(test)]
mod tests {
    use super::{
        AuthorizationBlastRadiusStats, AuthorizationInvalidationAckInput,
        BEFORE_ACTION_RESULT_HANDOFF_HOOK, BEFORE_CONFIG_VERIFY_PUBLICATION_HOOK,
        BEFORE_MUTATION_POSTCOMMIT_HOOK, BEFORE_QUERY_RESULT_HANDOFF_HOOK, DetachedIbexMutation,
        DetachedMutationRead, EnsureAppMode, FAIL_NEXT_LIVE_SCOPE_REGISTRATION,
        FAIL_NEXT_SCOPE_RETIREMENT_AUTH, LiveInvalidationAdmission, LiveResumeInput,
        LiveSubscribeInput, LiveUnsubscribeInput, LocalSnapback, MAX_LIVE_SUBSCRIPTIONS,
        MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION, MaintenanceOperation, PublicInspect,
        RetryEpisodeKey, RetryReservationKind, SnapbackError, StagedNestedMutation,
        next_secret_read_reset_generation, now_millis,
        refuse_unprovenanced_host_plan_authority_creation, reserve_unique_generation,
        validate_function_schema_references,
    };
    use crate::admin::ServerProfile;
    use crate::auth::admission::AdmissionController;
    use crate::auth::crypto::{CryptoError, RandomSource};
    use crate::auth::invalidation::{
        AuthorizationInvalidationConnection, InvalidationDisposition, LiveInvalidationIssuer,
        QueryNamespace, ResolutionKind, ScopeId,
    };
    use crate::auth::invocation::{
        InvocationGate, InvocationSource, PreparedAuthority, PreparedInvocation,
        ResolvedAppAuthority, ResolvedGrantScope, WireAuthorityFields,
    };
    use crate::auth::mode::{
        AuthModeStateRecord, AuthProgramReadiness, DeploymentIdentity, FUNCTION_V1_PREFIX,
        INPUTS_V1_PREFIX, SCHEMA_V1_PREFIX,
    };
    use crate::manifest::{
        ActionPlan, AuthInput, AuthManifest, AuthMode, AuthorityDescriptor, ConfigEntryDefinition,
        CronActivationPolicy, CronJitterPolicy, CronJobDefinition, CronOverlapPolicy,
        CronRetryMode, CronRetryPolicy, CronSchedule, CtxAnswerLedger, FieldManifest, FieldType,
        FilterExpr, FilterOp, FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime,
        HandlerInput, HandlerPlan, IbexModule, IndexManifest, MembershipManifest,
        MembershipPredicate, MembershipResourceRef, MembershipScope, MutationPlan, MutationStep,
        PermissionScopeExpr, QueryPlan, ReturnValue, SchemaManifest, SeedData, TableManifest,
        ValueExpr, ctx_ledger_version,
    };
    use crate::runtime::ExecutedIbexMutation;
    use crate::storage::BufferedWrite;
    use crate::storage::auth_grants::{ExactGrantScope, ScopedFunctionKind};
    use serde_json::{Map, Value, json};
    use std::collections::{BTreeMap, BTreeSet};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};
    use std::time::{Duration, Instant};

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

    #[test]
    fn direct_live_and_retainable_membership_readers_fail_closed_at_load() {
        let schema = SchemaManifest {
            tables: vec![TableManifest {
                name: "app_roles".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "userId".to_owned(),
                        field_type: FieldType::Principal,
                        optional: false,
                    },
                    FieldManifest {
                        name: "role".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                membership: Some(MembershipManifest {
                    id: None,
                    principal: "userId".to_owned(),
                    resource: None,
                    role: "role".to_owned(),
                    roles: vec!["admin".to_owned()],
                    pending_roles: None,
                    bootstrap_role: None,
                    last_holder: None,
                    expiry: None,
                    incidental: None,
                    provenance: None,
                    transitions: Vec::new(),
                    scope: MembershipScope::App,
                    resource_table: None,
                }),
            }],
            ..SchemaManifest::default()
        };
        for (kind, retainable) in [
            (FunctionKind::Query, false),
            (FunctionKind::LiveQuery, false),
            (FunctionKind::Query, true),
        ] {
            let mut function = FunctionDefinition::new(
                format!("reader-{kind:?}-{retainable}"),
                kind,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table: "app_roles".to_owned(),
                    filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                })),
            );
            function.retainable = retainable;
            let manifest = FunctionManifest {
                functions: vec![function],
                ..FunctionManifest::default()
            };
            let error = validate_function_schema_references(&manifest, &schema)
                .expect_err("membership roster primary readers are private");
            assert_eq!(error.diagnostic.code, "SNAPBACK_MEMBERSHIP_READ_PRIVATE");
        }
    }

    #[test]
    fn hand_written_membership_arg_with_wrong_nominal_table_fails_at_load() {
        let events = TableManifest {
            name: "events".to_owned(),
            fields: Vec::new(),
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            membership: None,
        };
        let members = TableManifest {
            name: "event_members".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "userId".to_owned(),
                    field_type: FieldType::Principal,
                    optional: false,
                },
                FieldManifest {
                    name: "eventId".to_owned(),
                    field_type: FieldType::Id {
                        table: "events".to_owned(),
                    },
                    optional: false,
                },
                FieldManifest {
                    name: "role".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
            ],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            membership: Some(MembershipManifest {
                id: Some("event_members".to_owned()),
                principal: "userId".to_owned(),
                resource: Some("eventId".to_owned()),
                role: "role".to_owned(),
                roles: vec!["host".to_owned()],
                pending_roles: None,
                bootstrap_role: None,
                last_holder: None,
                expiry: None,
                incidental: None,
                provenance: None,
                transitions: Vec::new(),
                scope: MembershipScope::Resource,
                resource_table: Some("events".to_owned()),
            }),
        };
        let schema = SchemaManifest {
            tables: vec![events, members],
            ..SchemaManifest::default()
        };
        let function = FunctionDefinition::new(
            "events-for-project-id",
            FunctionKind::Query,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table: "events".to_owned(),
                filters: Vec::new(),
                order: Vec::new(),
                limit: None,
                membership_filters: vec![MembershipPredicate {
                    declaration: "event_members".to_owned(),
                    resource: MembershipResourceRef::Arg {
                        path: "projectId".to_owned(),
                        resource_table: Some("projects".to_owned()),
                    },
                    roles: None,
                }],
                indexed_by: None,
            })),
        );
        let manifest = FunctionManifest {
            functions: vec![function],
            ..FunctionManifest::default()
        };

        let error = validate_function_schema_references(&manifest, &schema)
            .expect_err("a forged Id<projects> resource argument must fail artifact load");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_RESOURCE_REF_INVALID"
        );
    }

    #[test]
    fn maintenance_failures_are_counted_redacted_and_rate_limited() {
        let mut snapback = LocalSnapback::memory().expect("memory snapback");
        let sensitive = SnapbackError::error(
            "SNAPBACK_TEST_MAINTENANCE_CAUSE",
            "test",
            "room-secret must not be retained",
        );
        let initial_diagnostics = snapback.recent_diagnostics.len();

        snapback.record_maintenance_error(
            MaintenanceOperation::PermissionResolution,
            &sensitive,
            1_000,
        );
        snapback.record_maintenance_error(
            MaintenanceOperation::PermissionResolution,
            &sensitive,
            2_000,
        );
        snapback.record_maintenance_error(
            MaintenanceOperation::PermissionResolution,
            &sensitive,
            61_000,
        );
        snapback.record_maintenance_error(MaintenanceOperation::JournalPrune, &sensitive, 3_000);

        assert_eq!(snapback.maintenance.permission_resolution_failures, 3);
        assert_eq!(snapback.maintenance.journal_prune_failures, 1);
        assert_eq!(
            snapback.maintenance.last_permission_resolution_failure_ms,
            Some(61_000)
        );
        assert_eq!(
            snapback.maintenance.last_journal_prune_failure_ms,
            Some(3_000)
        );
        let maintenance = snapback
            .recent_diagnostics
            .iter()
            .skip(initial_diagnostics)
            .collect::<Vec<_>>();
        assert_eq!(maintenance.len(), 3, "one per rate-limit window and kind");
        assert_eq!(maintenance[0].details["failureCount"], 1);
        assert_eq!(maintenance[1].details["failureCount"], 3);
        assert_eq!(maintenance[2].details["failureCount"], 1);
        assert!(maintenance.iter().all(|diagnostic| {
            diagnostic.details["causeCode"] == "SNAPBACK_TEST_MAINTENANCE_CAUSE"
                && !diagnostic.message.contains("room-secret")
                && !diagnostic.details.to_string().contains("room-secret")
        }));

        let public: PublicInspect = snapback.inspect().expect("inspect").into();
        assert_eq!(public.maintenance, snapback.maintenance);
    }

    fn drain_live_stream_through_test_sink(
        snapback: &mut LocalSnapback,
        connection_id: &str,
    ) -> Vec<String> {
        snapback
            .drain_outbox_for_send(connection_id)
            .into_iter()
            .filter_map(|admitted| {
                let (envelope, permit) = admitted.into_parts();
                let frame = super::live_stream_text(envelope);
                drop(permit);
                frame
            })
            .collect()
    }

    fn drain_live_stream_through_fenced_test_sink(
        snapback: &LocalSnapback,
        connection_id: &str,
        effect_fence: &crate::ephemeral::ConnectionEffectFence,
    ) -> Vec<String> {
        snapback
            .ephemeral
            .drain_outbox_for_send_bound(connection_id, effect_fence)
            .into_iter()
            .filter_map(|admitted| {
                let (envelope, permit) = admitted.into_parts();
                let frame = super::live_stream_text(envelope);
                drop(permit);
                frame
            })
            .collect()
    }

    fn auth_artifact_pair(mode: AuthMode, marker: char) -> (SchemaManifest, FunctionManifest) {
        let (schema_version, auth, schema_hash, bundle_hash, inputs_hash, required_capabilities) =
            match mode {
                AuthMode::Dev => (
                    "snapback.v0".to_owned(),
                    None,
                    format!("sha256:schema-{marker}"),
                    format!("sha256:functions-{marker}"),
                    "sha256:inputs-shared".to_owned(),
                    Vec::new(),
                ),
                AuthMode::Sessions => (
                    "snapback.v1".to_owned(),
                    Some(AuthManifest {
                        mode: AuthMode::Sessions,
                    }),
                    format!(
                        "{}{}",
                        crate::auth::mode::SCHEMA_V1_PREFIX,
                        marker.to_string().repeat(64)
                    ),
                    format!(
                        "{}{}",
                        crate::auth::mode::FUNCTION_V1_PREFIX,
                        marker.to_string().repeat(64)
                    ),
                    format!(
                        "{}{}",
                        crate::auth::mode::INPUTS_V1_PREFIX,
                        marker.to_string().repeat(64)
                    ),
                    vec!["auth.sessions.v1".to_owned()],
                ),
            };
        (
            SchemaManifest {
                schema_version: schema_version.clone(),
                app_id: "mode-provision-test".to_owned(),
                auth,
                required_capabilities,
                schema_hash: Some(schema_hash),
                inputs_hash: Some(inputs_hash.clone()),
                ..SchemaManifest::default()
            },
            FunctionManifest {
                schema_version,
                app_id: "mode-provision-test".to_owned(),
                bundle_hash: Some(bundle_hash),
                inputs_hash: Some(inputs_hash),
                ..FunctionManifest::default()
            },
        )
    }

    #[test]
    fn network_mode_provision_requires_first_sessions_pair_and_stages_without_publish() {
        let mut snapback = LocalSnapback::memory().unwrap();
        let (schema, functions) = auth_artifact_pair(AuthMode::Sessions, 'a');
        let error = snapback
            .prepare_auth_provision(EnsureAppMode::Sessions, Some(schema.clone()), None, None)
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_CAPABILITY_UNSUPPORTED");
        assert_eq!(
            snapback.db.auth_mode_snapshot().unwrap().state.mode_state,
            crate::auth::mode::AuthModeStatus::Settled
        );

        let prepared = snapback
            .prepare_auth_provision(
                EnsureAppMode::Sessions,
                Some(schema),
                Some(functions.clone()),
                None,
            )
            .unwrap();
        let (outcome, state) = snapback.commit_auth_provision(prepared, "test").unwrap();
        assert_eq!(
            state.mode_state,
            crate::auth::mode::AuthModeStatus::PendingRestart
        );
        assert_eq!(state.active, AuthMode::Dev);
        assert_eq!(state.desired, AuthMode::Sessions);
        assert_eq!(outcome.schema, "provisioned");
        assert_eq!(outcome.functions, "provisioned");
        assert_ne!(snapback.functions.bundle_hash, functions.bundle_hash);
    }

    #[test]
    fn sessions_preflight_prepares_module_source_and_export_before_staging() {
        for (source, export, expected) in [
            ("globalThis. = 1;", "broken", "SNAPBACK_HANDLER_FAILED"),
            (
                "globalThis.__snapbackHandlers = {};",
                "missing",
                "SNAPBACK_HANDLER_EXPORT_MISSING",
            ),
        ] {
            let mut snapback = LocalSnapback::memory().unwrap();
            let (schema, mut functions) = auth_artifact_pair(AuthMode::Sessions, 'a');
            functions.functions.push(FunctionDefinition::new(
                export,
                FunctionKind::Query,
                FunctionRuntime::IbexModule(IbexModule {
                    source: source.to_owned(),
                    export: export.to_owned(),
                }),
            ));
            let artifacts = crate::auth::mode::StartupArtifacts {
                format_version: crate::auth::mode::STARTUP_ARTIFACT_FORMAT_VERSION,
                schema,
                functions,
                seed: None,
            };
            let error = snapback
                .preflight_auth_artifacts(&artifacts, AuthMode::Sessions)
                .expect_err("unprepared executable generation must fail preflight");
            assert_eq!(error.diagnostic.code, expected);
            assert_eq!(
                snapback
                    .auth_database_mut()
                    .auth_mode_snapshot()
                    .unwrap()
                    .state,
                AuthModeStateRecord::initial_dev(None)
            );
            assert!(snapback.function_kind(export).is_none());
        }
    }

    #[test]
    fn network_one_half_update_uses_only_same_boot_preflighted_sibling() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("one-half.sqlite3");
        let (schema, functions) = auth_artifact_pair(AuthMode::Dev, 'a');
        let mut snapback = LocalSnapback::open(&path).unwrap();
        let prepared = snapback
            .prepare_auth_provision(
                EnsureAppMode::Dev,
                Some(schema),
                Some(functions.clone()),
                None,
            )
            .unwrap();
        snapback.commit_auth_provision(prepared, "test").unwrap();

        let (mut updated_schema, _) = auth_artifact_pair(AuthMode::Dev, 'b');
        // Keep the pair-level input identity equal to the loaded sibling.
        updated_schema.inputs_hash = functions.inputs_hash.clone();
        let prepared = snapback
            .prepare_auth_provision(EnsureAppMode::Dev, Some(updated_schema), None, None)
            .unwrap();
        let (outcome, _) = snapback.commit_auth_provision(prepared, "test").unwrap();
        assert_eq!(outcome.schema, "provisioned");
        assert_eq!(outcome.functions, "matched");
        drop(snapback);

        let mut reopened = LocalSnapback::open(&path).unwrap();
        let (another_schema, _) = auth_artifact_pair(AuthMode::Dev, 'c');
        let error = reopened
            .prepare_auth_provision(EnsureAppMode::Dev, Some(another_schema), None, None)
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_CAPABILITY_UNSUPPORTED");
    }

    #[test]
    fn authorization_reservation_data_and_auth_frontiers_share_one_snapshot() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("authorization-pair.sqlite3");
        let mut reader = LocalSnapback::open(&path).expect("open reader");
        reader
            .apply_schema(SchemaManifest {
                tables: vec![TableManifest {
                    name: "permissions".to_owned(),
                    fields: vec![FieldManifest {
                        name: "subject".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    }],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: true,
                    permission_fields: None,
                    membership: None,
                }],
                ..SchemaManifest::default()
            })
            .expect("apply permission schema");
        let baseline = reader
            .authorization_reservation_snapshot()
            .expect("baseline authorization pair");

        let (reached_tx, reached_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let _hook = crate::storage::set_storage_read_snapshot_debug_hook(
            &reader.db, reached_tx, release_rx,
        );
        let writer_path = path.clone();
        let writer = std::thread::spawn(move || {
            reached_rx
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("reader pins the predecessor data head");
            let mut writer = LocalSnapback::open(writer_path).expect("open sibling writer");
            writer
                .db
                .seed_with_authorization(SeedData {
                    tables: BTreeMap::from([(
                        "permissions".to_owned(),
                        vec![Map::from_iter([
                            ("_id".to_owned(), json!("permission")),
                            ("subject".to_owned(), json!("user")),
                        ])],
                    )]),
                })
                .expect("commit authorization-affecting sibling write");
            let successor = writer
                .authorization_reservation_snapshot()
                .expect("successor authorization pair");
            release_tx.send(()).expect("release pinned reader");
            successor
        });

        let pinned = reader
            .authorization_reservation_snapshot()
            .expect("snapshot-bound authorization pair");
        let successor = writer.join().expect("writer joins");
        assert_eq!(pinned, baseline);
        assert_eq!(successor.0, baseline.0 + 1);
        assert_eq!(successor.1.incarnation, baseline.1.incarnation);
        assert_eq!(successor.1.epoch, baseline.1.epoch + 1);
        assert_eq!(
            reader.authorization_reservation_snapshot().unwrap(),
            successor
        );
    }

    fn sessions_activation_pair(
        bundle_marker: char,
        hide_rows: bool,
    ) -> (SchemaManifest, FunctionManifest) {
        let (mut schema, mut functions) = auth_artifact_pair(AuthMode::Sessions, 'a');
        schema.tables = vec![TableManifest {
            name: "items".to_owned(),
            fields: vec![FieldManifest {
                name: "value".to_owned(),
                field_type: FieldType::String,
                optional: false,
            }],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            membership: None,
        }];
        functions.bundle_hash = Some(format!(
            "{}{}",
            FUNCTION_V1_PREFIX,
            bundle_marker.to_string().repeat(64)
        ));
        functions.functions = vec![FunctionDefinition::new(
            "listItems",
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table: "items".to_owned(),
                filters: hide_rows
                    .then(|| FilterExpr {
                        field: "value".to_owned(),
                        op: FilterOp::Eq,
                        value: ValueExpr::Literal(json!("never-visible")),
                    })
                    .into_iter()
                    .collect(),
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            })),
        )];
        (schema, functions)
    }

    fn settled_sessions_activation_snapback(
        schema: SchemaManifest,
        predecessor_functions: FunctionManifest,
    ) -> LocalSnapback {
        let mut snapback = LocalSnapback::memory().expect("memory activation fixture");
        let prepared = snapback
            .prepare_auth_provision(
                EnsureAppMode::Sessions,
                Some(schema),
                Some(predecessor_functions.clone()),
                Some(crate::manifest::SeedData {
                    tables: BTreeMap::from([(
                        "items".to_owned(),
                        vec![serde_json::Map::from_iter([(
                            "value".to_owned(),
                            json!("predecessor-visible"),
                        )])],
                    )]),
                }),
            )
            .expect("preflight initial complete sessions pair");
        let (_, pending) = snapback
            .commit_auth_provision(prepared, "test")
            .expect("stage initial sessions pair");
        assert_eq!(
            pending.mode_state,
            crate::auth::mode::AuthModeStatus::PendingRestart
        );
        let readiness = AuthProgramReadiness::new(true, true, true, true, true, true, true);
        let settled = snapback
            .auth_database_mut()
            .consume_sessions_auth_mode_with_functions(&readiness, &predecessor_functions)
            .expect("consume initial sessions pair");
        snapback
            .synchronize_auth_mode_admission(&settled)
            .expect("publish settled sessions admission");
        let diagnostics = snapback.publish_preflighted_functions(predecessor_functions, 41);
        assert!(
            diagnostics.iter().all(|diagnostic| !matches!(
                diagnostic.severity,
                crate::diagnostic::DiagnosticSeverity::Error
                    | crate::diagnostic::DiagnosticSeverity::Fatal
            )),
            "initial sessions functions must publish: {diagnostics:?}"
        );
        snapback
    }

    fn scoped_live_authority(snapback: &mut LocalSnapback) -> PreparedAuthority {
        let random = CounterRandom::new();
        let now_ms = now_millis();
        let (resolved, service_publication) = {
            let db = snapback.auth_database_mut();
            db.with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_users(
                       id, created_at_ms, kind, display_name, operator_contact,
                       registration_provenance, deactivated_at_ms, owner_user_id
                     ) VALUES('activation-owner', ?1, 'human', NULL, NULL, NULL, NULL, NULL)",
                    rusqlite::params![now_ms as i64],
                )?;
                Ok(())
            })
            .expect("create activation owner");
            db.create_agent_principal(
                "activation-agent",
                now_ms,
                &crate::storage::auth_agents::AgentRegistration {
                    display_name: Some("Activation agent".to_owned()),
                    operator_contact: None,
                    registration_provenance: r#"{"source":"activation-test"}"#.to_owned(),
                    owner_user_id: Some("activation-owner".to_owned()),
                },
            )
            .expect("create activation agent");
            let credential = db
                .issue_initial_agent_credential("activation-agent", now_ms, &random)
                .expect("issue activation credential");
            db.with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT OR IGNORE INTO _auth_scope_bases(
                       function_id, kind, generation, present, authority_creating
                     ) VALUES('fn:unrelatedLive', 'liveQuery', 0, 1, 0)",
                    [],
                )?;
                tx.execute(
                    "INSERT INTO _auth_grants(
                       id, actor_user_id, effective_user_id, scopes, created_at_ms,
                       expires_at_ms, revoked_at_ms, created_by, request_id,
                       consent_digest, last_used_at_ms
                     ) VALUES('activation-grant', 'activation-agent', 'activation-owner', ?1,
                              ?2, ?3, NULL, 'test', NULL, NULL, ?2)",
                    rusqlite::params![
                        r#"[{"fn":"fn:listItems","kind":"liveQuery","basis":0,"authorityCreating":false},{"fn":"fn:unrelatedLive","kind":"liveQuery","basis":0,"authorityCreating":false}]"#,
                        now_ms as i64,
                        now_ms.saturating_add(60_000) as i64,
                    ],
                )?;
                Ok(())
            })
            .expect("create activation grant");
            let token = db
                .mint_scoped_token(
                    &credential.secret,
                    "activation-grant",
                    Some(60_000),
                    now_ms,
                    &random,
                )
                .expect("mint activation token");
            let resolved = db
                .resolve_scoped_token(&token.secret, now_ms)
                .expect("resolve activation token");
            let publication = db
                .service_authority_fence_registry()
                .register(
                    crate::auth::service_fence::ServiceAuthorityWitness::from_resolved(&resolved),
                    now_ms,
                    Instant::now(),
                )
                .expect("register activation token fence");
            (resolved, publication)
        };
        let admission = snapback
            .admission
            .admit_for_mode(AuthMode::Sessions)
            .expect("admit service live owner");
        InvocationGate::prepare_admitted_authority(
            InvocationSource::LiveInitialQuery,
            AuthMode::Sessions,
            ServerProfile::Test,
            admission,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::from_scoped_token(resolved),
        )
        .expect("prepare service live authority")
        .with_service_publication(service_publication)
    }

    #[test]
    fn retained_service_live_revalidates_only_its_matched_grant_entry() {
        let (schema, mut predecessor_functions) = sessions_activation_pair('b', false);
        predecessor_functions
            .functions
            .push(FunctionDefinition::new(
                "unrelatedLive",
                FunctionKind::LiveQuery,
                predecessor_functions.functions[0].runtime.clone(),
            ));
        let mut snapback = settled_sessions_activation_snapback(schema, predecessor_functions);
        let connection = install_test_invalidation(&mut snapback);
        let authority = scoped_live_authority(&mut snapback);
        let subscribed = snapback
            .subscribe_live_prepared_with_invalidation(
                "listItems",
                LiveSubscribeInput {
                    connection_id: "matched-scope-live".to_owned(),
                    input: HandlerInput::default(),
                    authorization_namespace: Some(test_authorization_namespace(93)),
                    supersedes: None,
                    resume_from_token: None,
                },
                authority.clone(),
                LiveInvalidationAdmission {
                    session_mode: true,
                    connection: Some(connection.clone()),
                    effect_fence: None,
                },
            )
            .expect("subscribe under the listItems entry");
        let retained = snapback
            .subscriptions
            .get(&subscribed.subscription_id)
            .expect("retained subscription")
            .authority
            .clone();
        assert_eq!(
            retained
                .matched_grant_scope()
                .expect("service live retains its exact entry")
                .function_id(),
            "fn:listItems"
        );
        let unrelated = snapback
            .subscribe_live_prepared_with_invalidation(
                "unrelatedLive",
                LiveSubscribeInput {
                    connection_id: "matched-scope-live".to_owned(),
                    input: HandlerInput::default(),
                    authorization_namespace: Some(test_authorization_namespace(94)),
                    supersedes: None,
                    resume_from_token: None,
                },
                authority,
                LiveInvalidationAdmission {
                    session_mode: true,
                    connection: Some(connection),
                    effect_fence: None,
                },
            )
            .expect("subscribe under the unrelatedLive entry");
        let unrelated_retained = snapback
            .subscriptions
            .get(&unrelated.subscription_id)
            .expect("retained unrelated subscription")
            .authority
            .clone();
        assert_eq!(
            unrelated_retained
                .matched_grant_scope()
                .expect("second service live retains its exact entry")
                .function_id(),
            "fn:unrelatedLive"
        );

        snapback
            .auth_database_mut()
            .with_auth_transaction(|tx| {
                tx.execute(
                    "UPDATE _auth_scope_bases
                     SET generation = generation + 1, present = 0
                     WHERE function_id = 'fn:unrelatedLive'
                       AND kind = 'liveQuery' AND authority_creating = 0",
                    [],
                )?;
                Ok(())
            })
            .expect("tombstone unrelated grant entry");
        let unrelated_admission = snapback
            .admission
            .admit_for_mode(AuthMode::Sessions)
            .expect("fresh unrelated rerun admission");
        let unrelated_error = snapback
            .prepare_live_rerun_authority(&unrelated_retained, unrelated_admission)
            .expect_err("the tombstoned B entry terminates B");
        assert_eq!(
            unrelated_error.diagnostic.code,
            "SNAPBACK_AUTH_GRANT_SCOPE_DENIED"
        );

        let admission = snapback
            .admission
            .admit_for_mode(AuthMode::Sessions)
            .expect("fresh rerun admission");
        let rerun = snapback
            .prepare_live_rerun_authority(&retained, admission)
            .expect("unrelated scope tombstone does not end listItems");
        let mut inserted = BTreeMap::new();
        inserted.insert(
            "value".to_owned(),
            ValueExpr::Literal(json!("visible-after-b-tombstone")),
        );
        snapback
            .db
            .execute_mutation(
                &MutationPlan {
                    steps: vec![MutationStep::Insert {
                        table: "items".to_owned(),
                        values: inserted,
                        bind_id_as: None,
                    }],
                    return_value: Some(ReturnValue::ChangedCount),
                },
                &HandlerInput::default(),
            )
            .expect("commit a data update after B terminates");
        let rerun = snapback
            .invoke_query_with_dependencies_prepared("listItems", HandlerInput::default(), rerun)
            .expect("A remains live and reruns after B terminates");
        assert!(
            rerun
                .output
                .rows
                .iter()
                .any(|row| { row["value"] == json!("visible-after-b-tombstone") })
        );

        snapback
            .auth_database_mut()
            .with_auth_transaction(|tx| {
                tx.execute(
                    "UPDATE _auth_scope_bases
                     SET generation = generation + 1, present = 0
                     WHERE function_id = 'fn:listItems'
                       AND kind = 'liveQuery' AND authority_creating = 0",
                    [],
                )?;
                Ok(())
            })
            .expect("tombstone matched grant entry");
        let admission = snapback
            .admission
            .admit_for_mode(AuthMode::Sessions)
            .expect("fresh terminal rerun admission");
        let error = snapback
            .prepare_live_rerun_authority(&retained, admission)
            .expect_err("matched scope tombstone ends listItems");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_GRANT_SCOPE_DENIED");
    }

    #[test]
    fn same_mode_sessions_activation_projects_live_successor_before_reopening() {
        let (schema, predecessor_functions) = sessions_activation_pair('b', false);
        let mut snapback = settled_sessions_activation_snapback(schema, predecessor_functions);

        let connection = install_test_invalidation(&mut snapback);
        let subscribed = snapback
            .subscribe_live_with_invalidation(
                "listItems",
                LiveSubscribeInput {
                    connection_id: "activation-live".to_owned(),
                    input: HandlerInput::default(),
                    authorization_namespace: Some(test_authorization_namespace(90)),
                    supersedes: None,
                    resume_from_token: None,
                },
                LiveInvalidationAdmission {
                    session_mode: true,
                    connection: Some(connection),
                    effect_fence: None,
                },
            )
            .expect("subscribe under predecessor deployment");
        assert_eq!(subscribed.snapshot.as_ref().unwrap().rows.len(), 1);
        assert!(
            drain_live_stream_through_test_sink(&mut snapback, "activation-live").is_empty(),
            "the activation test starts with an empty delivery queue"
        );
        let predecessor_authorization = snapback
            .auth_invalidation
            .as_ref()
            .expect("installed invalidation state")
            .obligations
            .expectation()
            .authorization
            .clone();

        let (_, mut successor_functions) = sessions_activation_pair('d', true);
        successor_functions.functions[0].authority_creating = true;
        let successor_bundle = successor_functions.bundle_hash.clone();
        let prepared = snapback
            .prepare_auth_provision(
                EnsureAppMode::Sessions,
                None,
                Some(successor_functions),
                None,
            )
            .expect("preflight one-half successor through cached complete pair");
        let controller = snapback.admission.clone();
        let transition = controller
            .begin_transition()
            .expect("close and drain predecessor admission");
        let (committed, state, reopened) = transition
            .commit_and_project_mode_state(|projection_admission| {
                let committed = snapback.commit_auth_provision_classified(
                    prepared,
                    "test",
                    Some(projection_admission),
                )?;
                let state = committed.state.clone();
                Ok((committed, state))
            })
            .and_then(|committed| committed.publish_successor())
            .expect("commit and project successor activation");

        assert_eq!(committed.state, state);
        assert_eq!(
            snapback
                .auth_database_mut()
                .current_auth_scope_basis("fn:listItems", &FunctionKind::LiveQuery, true)
                .expect("read committed authority-creating basis"),
            Some(1)
        );
        assert_eq!(
            snapback
                .auth_database_mut()
                .current_auth_scope_basis("fn:listItems", &FunctionKind::LiveQuery, false)
                .expect("old marker shape is terminal"),
            None
        );
        assert_eq!(
            state.active_deployment.unwrap().bundle_hash,
            successor_bundle.unwrap()
        );
        assert!(reopened.accepting);
        assert_eq!(reopened.in_flight, 0);
        let durable_authorization = snapback
            .auth_database_mut()
            .authorization_version()
            .expect("durable successor authorization");
        let projected_authorization = snapback
            .auth_invalidation
            .as_ref()
            .expect("installed invalidation state")
            .obligations
            .expectation()
            .authorization
            .clone();
        assert_eq!(projected_authorization, durable_authorization);
        assert_eq!(
            projected_authorization.epoch,
            predecessor_authorization.epoch + 1
        );

        let frames = drain_live_stream_through_test_sink(&mut snapback, "activation-live");
        let successor = frames
            .iter()
            .filter_map(|frame| serde_json::from_str::<Value>(frame).ok())
            .find(|frame| {
                frame["kind"] == "authorization_invalidation" && frame.get("snapshot").is_some()
            })
            .expect("activation projects a successor snapshot before admission reopens");
        assert_eq!(successor["snapshot"]["rows"], json!([]));
        assert_eq!(
            successor["obligation"]["witness"]["authorization"]["epoch"],
            projected_authorization.epoch
        );
        assert!(
            frames
                .iter()
                .all(|frame| !frame.contains("\"kind\":\"live_delta\"")),
            "deployment authorization changes never escape as an unfenced live delta"
        );
    }

    #[test]
    fn same_mode_activation_terminally_deletes_live_service_scope_tombstones() {
        let (schema, predecessor_functions) = sessions_activation_pair('b', false);
        let mut snapback = settled_sessions_activation_snapback(schema, predecessor_functions);
        let connection = install_test_invalidation(&mut snapback);
        let authority = scoped_live_authority(&mut snapback);
        let subscribed = snapback
            .subscribe_live_prepared_with_invalidation(
                "listItems",
                LiveSubscribeInput {
                    connection_id: "activation-service-live".to_owned(),
                    input: HandlerInput::default(),
                    authorization_namespace: Some(test_authorization_namespace(94)),
                    supersedes: None,
                    resume_from_token: None,
                },
                authority,
                LiveInvalidationAdmission {
                    session_mode: true,
                    connection: Some(connection),
                    effect_fence: None,
                },
            )
            .expect("subscribe service owner under predecessor scope basis");
        assert!(subscribed.authorization_scope.is_some());
        assert!(
            drain_live_stream_through_test_sink(&mut snapback, "activation-service-live")
                .is_empty()
        );

        let (_, mut successor_functions) = sessions_activation_pair('d', true);
        successor_functions.functions[0].authority_creating = true;
        let prepared = snapback
            .prepare_auth_provision(
                EnsureAppMode::Sessions,
                None,
                Some(successor_functions),
                None,
            )
            .expect("preflight successor that tombstones the retained scope shape");
        let transition = snapback
            .admission
            .clone()
            .begin_transition()
            .expect("close predecessor admission");
        transition
            .commit_and_project_mode_state(|projection_admission| {
                let committed = snapback.commit_auth_provision_classified(
                    prepared,
                    "test",
                    Some(projection_admission),
                )?;
                Ok(((), committed.state))
            })
            .and_then(|committed| committed.publish_successor())
            .expect("commit scope tombstone and terminal live projection");

        let frames = drain_live_stream_through_test_sink(&mut snapback, "activation-service-live");
        let terminal = frames
            .iter()
            .filter_map(|frame| serde_json::from_str::<Value>(frame).ok())
            .find(|frame| {
                frame["kind"] == "authorization_invalidation"
                    && frame["resolution"]["kind"] == "terminalDelete"
            })
            .expect("scope tombstone projects an immediate terminal delete");
        assert_eq!(terminal["obligation"]["maxDisposition"], "delete");
        assert!(
            terminal.get("snapshot").is_none(),
            "a terminal scope cannot publish a successor snapshot"
        );
        assert_eq!(
            snapback
                .auth_database_mut()
                .current_auth_scope_basis("fn:listItems", &FunctionKind::LiveQuery, false)
                .expect("read predecessor scope basis"),
            None
        );
    }

    #[test]
    fn real_sessions_activation_keeps_removed_function_basis_terminal_across_readd() {
        let (schema, predecessor_functions) = sessions_activation_pair('b', false);
        let mut snapback =
            settled_sessions_activation_snapback(schema, predecessor_functions.clone());
        install_test_invalidation(&mut snapback);
        assert_eq!(
            snapback
                .auth_database_mut()
                .current_auth_scope_basis("fn:listItems", &FunctionKind::LiveQuery, false)
                .unwrap(),
            Some(0)
        );
        let initial_authorization = snapback
            .auth_database_mut()
            .authorization_version()
            .unwrap();

        let mut removed = predecessor_functions.clone();
        removed.bundle_hash = Some(format!("{FUNCTION_V1_PREFIX}{}", "e".repeat(64)));
        removed.functions.clear();
        let prepared = snapback
            .prepare_auth_provision(EnsureAppMode::Sessions, None, Some(removed), None)
            .unwrap();
        let transition = snapback.admission.clone().begin_transition().unwrap();
        transition
            .commit_and_project_mode_state(|projection_admission| {
                let committed = snapback.commit_auth_provision_classified(
                    prepared,
                    "test",
                    Some(projection_admission),
                )?;
                Ok(((), committed.state))
            })
            .and_then(|committed| committed.publish_successor())
            .expect("remove function through real sessions activation");
        assert_eq!(
            snapback
                .auth_database_mut()
                .current_auth_scope_basis("fn:listItems", &FunctionKind::LiveQuery, false)
                .unwrap(),
            None
        );
        let removed_authorization = snapback
            .auth_database_mut()
            .authorization_version()
            .unwrap();
        assert_eq!(removed_authorization.epoch, initial_authorization.epoch + 1);

        let mut readded = predecessor_functions;
        readded.bundle_hash = Some(format!("{FUNCTION_V1_PREFIX}{}", "f".repeat(64)));
        let prepared = snapback
            .prepare_auth_provision(EnsureAppMode::Sessions, None, Some(readded), None)
            .unwrap();
        let transition = snapback.admission.clone().begin_transition().unwrap();
        transition
            .commit_and_project_mode_state(|projection_admission| {
                let committed = snapback.commit_auth_provision_classified(
                    prepared,
                    "test",
                    Some(projection_admission),
                )?;
                Ok(((), committed.state))
            })
            .and_then(|committed| committed.publish_successor())
            .expect("re-add function through real sessions activation");
        assert_eq!(
            snapback
                .auth_database_mut()
                .current_auth_scope_basis("fn:listItems", &FunctionKind::LiveQuery, false)
                .unwrap(),
            Some(1),
            "re-add resumes at the removal tombstone generation"
        );
        let readded_authorization = snapback
            .auth_database_mut()
            .authorization_version()
            .unwrap();
        assert_eq!(readded_authorization.epoch, initial_authorization.epoch + 2);
    }

    #[test]
    fn same_mode_sessions_activation_projection_error_stays_closed() {
        let (schema, predecessor_functions) = sessions_activation_pair('b', false);
        let mut snapback = settled_sessions_activation_snapback(schema, predecessor_functions);
        let connection = install_test_invalidation(&mut snapback);
        let subscribed = snapback
            .subscribe_live_with_invalidation(
                "listItems",
                LiveSubscribeInput {
                    connection_id: "activation-exhausted".to_owned(),
                    input: HandlerInput::default(),
                    authorization_namespace: Some(test_authorization_namespace(91)),
                    supersedes: None,
                    resume_from_token: None,
                },
                LiveInvalidationAdmission {
                    session_mode: true,
                    connection: Some(connection),
                    effect_fence: None,
                },
            )
            .expect("subscribe auth-scoped predecessor");
        snapback
            .auth_invalidation
            .as_mut()
            .expect("installed invalidation state")
            .next_cause_sequence = crate::auth::invalidation::MAX_PROTOCOL_COUNTER;

        let (_, successor_functions) = sessions_activation_pair('e', true);
        let successor_bundle = successor_functions.bundle_hash.clone().unwrap();
        let prepared = snapback
            .prepare_auth_provision(
                EnsureAppMode::Sessions,
                None,
                Some(successor_functions),
                None,
            )
            .expect("preflight successor");
        let controller = snapback.admission.clone();
        let transition = controller.begin_transition().expect("close predecessor");
        let error = transition
            .commit_and_project_mode_state(|projection_admission| {
                let committed = snapback.commit_auth_provision_classified(
                    prepared,
                    "test",
                    Some(projection_admission),
                )?;
                let state = committed.state.clone();
                Ok((committed, state))
            })
            .expect_err("projection exhaustion must fail the activation");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_INVALIDATION_CAUSE_EXHAUSTED"
        );
        assert!(!controller.snapshot().accepting);
        assert!(
            snapback
                .subscriptions
                .contains_key(&subscribed.subscription_id)
        );
        assert_eq!(
            snapback
                .auth_database_mut()
                .auth_mode_snapshot()
                .expect("durable successor")
                .state
                .active_deployment
                .expect("successor deployment")
                .bundle_hash,
            successor_bundle
        );
    }

    #[test]
    fn activation_terminally_resyncs_unscoped_live_queries_changed_or_removed() {
        let (schema, mut predecessor_functions) = sessions_activation_pair('b', false);
        let independent = |name: &str| {
            let mut function = FunctionDefinition::new(
                name,
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table: "items".to_owned(),
                    filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                })),
            );
            function.authority_independent = true;
            function.auth_requirement = Some(crate::manifest::AuthRequirement::Public);
            function
        };
        predecessor_functions.functions = vec![
            independent("independentChanged"),
            independent("independentRemoved"),
        ];
        let mut snapback =
            settled_sessions_activation_snapback(schema, predecessor_functions.clone());
        let connection = install_test_invalidation(&mut snapback);
        let changed_fence = crate::ephemeral::ConnectionEffectFence::anonymous(
            "activation-incarnation",
            "activation-changed-grant",
        );
        let removed_fence = crate::ephemeral::ConnectionEffectFence::anonymous(
            "activation-incarnation",
            "activation-removed-grant",
        );
        let subscribe =
            |snapback: &mut LocalSnapback,
             name: &str,
             connection_id: &str,
             effect_fence: crate::ephemeral::ConnectionEffectFence| {
                snapback
                    .subscribe_live_with_invalidation(
                        name,
                        LiveSubscribeInput {
                            connection_id: connection_id.to_owned(),
                            input: HandlerInput::default(),
                            authorization_namespace: None,
                            supersedes: None,
                            resume_from_token: None,
                        },
                        LiveInvalidationAdmission {
                            session_mode: true,
                            connection: Some(connection.clone()),
                            effect_fence: Some(effect_fence),
                        },
                    )
                    .expect("subscribe authority-independent predecessor")
            };
        let changed = subscribe(
            &mut snapback,
            "independentChanged",
            "activation-independent-changed",
            changed_fence.clone(),
        );
        let removed = subscribe(
            &mut snapback,
            "independentRemoved",
            "activation-independent-removed",
            removed_fence.clone(),
        );
        assert!(
            snapback
                .subscriptions
                .values()
                .all(|subscription| subscription.authorization.is_none())
        );
        drain_live_stream_through_fenced_test_sink(
            &snapback,
            "activation-independent-changed",
            &changed_fence,
        );
        drain_live_stream_through_fenced_test_sink(
            &snapback,
            "activation-independent-removed",
            &removed_fence,
        );
        let changed_subscription = snapback
            .subscriptions
            .get(&changed.subscription_id)
            .expect("changed predecessor remains live")
            .clone();
        snapback.enqueue_subscription_durable(
            &changed_subscription,
            serde_json::to_vec(&crate::live_wire::LiveEnvelope::LiveReplace {
                subscription_id: changed.subscription_id.clone(),
                function: "independentChanged".to_owned(),
                version: 1,
                rows: vec![json!({ "value": "queued-predecessor" })],
                resume: None,
            })
            .expect("serialize queued predecessor frame"),
        );

        let mut protected = FunctionDefinition::new(
            "independentChanged",
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table: "items".to_owned(),
                filters: Vec::new(),
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            })),
        );
        protected.auth_requirement = Some(crate::manifest::AuthRequirement::Authenticated);
        let mut successor_functions = predecessor_functions;
        successor_functions.bundle_hash = Some(format!("{}{}", FUNCTION_V1_PREFIX, "f".repeat(64)));
        successor_functions.functions = vec![protected];
        let prepared = snapback
            .prepare_auth_provision(
                EnsureAppMode::Sessions,
                None,
                Some(successor_functions),
                None,
            )
            .expect("preflight protected successor");
        let controller = snapback.admission.clone();
        let transition = controller.begin_transition().expect("close predecessor");
        transition
            .commit_and_project_mode_state(|projection_admission| {
                let committed = snapback.commit_auth_provision_classified(
                    prepared,
                    "test",
                    Some(projection_admission),
                )?;
                let state = committed.state.clone();
                Ok((committed, state))
            })
            .and_then(|committed| committed.publish_successor())
            .expect("activate protected successor");

        assert!(
            !snapback
                .subscriptions
                .contains_key(&changed.subscription_id)
        );
        assert!(
            !snapback
                .subscriptions
                .contains_key(&removed.subscription_id)
        );
        let changed_frames = drain_live_stream_through_fenced_test_sink(
            &snapback,
            "activation-independent-changed",
            &changed_fence,
        );
        assert!(changed_frames.iter().all(|frame| {
            serde_json::from_str::<Value>(frame).is_ok_and(|frame| frame["kind"] != "live_replace")
        }));
        assert!(changed_frames.iter().any(|frame| {
            serde_json::from_str::<Value>(frame).is_ok_and(|frame| {
                frame["kind"] == "resync_required"
                    && frame["reason"] == "outbox_overflow"
                    && frame["subscription_id"].is_null()
                    && frame["clear_retained"] == true
            })
        }));

        let removed_frames = drain_live_stream_through_fenced_test_sink(
            &snapback,
            "activation-independent-removed",
            &removed_fence,
        );
        assert!(removed_frames.iter().any(|frame| {
            serde_json::from_str::<Value>(frame).is_ok_and(|frame| {
                frame["kind"] == "resync_required"
                    && frame["reason"] == "auth_deployment_activated"
                    && frame["subscription_id"] == removed.subscription_id
                    && frame["clear_retained"] == true
            })
        }));
    }

    #[test]
    fn data_only_same_mode_seed_refreshes_auth_scoped_live_before_reopening() {
        let (mut schema, mut functions) = sessions_activation_pair('b', false);
        schema.tables.push(TableManifest {
            name: "freshItems".to_owned(),
            fields: vec![FieldManifest {
                name: "value".to_owned(),
                field_type: FieldType::String,
                optional: false,
            }],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            membership: None,
        });
        let function = functions
            .functions
            .first_mut()
            .expect("activation live function");
        function.runtime = FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table: "freshItems".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        }));
        let mut snapback = settled_sessions_activation_snapback(schema, functions);
        let connection = install_test_invalidation(&mut snapback);
        let subscribed = snapback
            .subscribe_live_with_invalidation(
                "listItems",
                LiveSubscribeInput {
                    connection_id: "activation-data-seed".to_owned(),
                    input: HandlerInput::default(),
                    authorization_namespace: Some(test_authorization_namespace(92)),
                    supersedes: None,
                    resume_from_token: None,
                },
                LiveInvalidationAdmission {
                    session_mode: true,
                    connection: Some(connection),
                    effect_fence: None,
                },
            )
            .expect("subscribe empty auth-scoped result");
        assert!(subscribed.snapshot.as_ref().unwrap().rows.is_empty());
        drain_live_stream_through_test_sink(&mut snapback, "activation-data-seed");
        let predecessor_authorization = snapback
            .auth_invalidation
            .as_ref()
            .expect("installed invalidation state")
            .obligations
            .expectation()
            .authorization
            .clone();

        let prepared = snapback
            .prepare_auth_provision(
                EnsureAppMode::Sessions,
                None,
                None,
                Some(SeedData {
                    tables: BTreeMap::from([(
                        "freshItems".to_owned(),
                        vec![Map::from_iter([(
                            "value".to_owned(),
                            json!("seed-visible"),
                        )])],
                    )]),
                }),
            )
            .expect("preflight data-only seed against cached pair");
        let controller = snapback.admission.clone();
        let transition = controller.begin_transition().expect("close predecessor");
        let (committed, _, reopened) = transition
            .commit_and_project_mode_state(|projection_admission| {
                let committed = snapback.commit_auth_provision_classified(
                    prepared,
                    "test",
                    Some(projection_admission),
                )?;
                let state = committed.state.clone();
                Ok((committed, state))
            })
            .and_then(|committed| committed.publish_successor())
            .expect("seed and refresh under closed activation");
        assert_eq!(committed.outcome.seed, "seeded");
        assert!(reopened.accepting);
        assert_eq!(
            snapback
                .auth_invalidation
                .as_ref()
                .expect("installed invalidation state")
                .obligations
                .expectation()
                .authorization,
            predecessor_authorization,
            "ordinary seed rows do not fabricate an authorization epoch"
        );
        let frames = drain_live_stream_through_test_sink(&mut snapback, "activation-data-seed");
        assert!(frames.iter().any(|frame| {
            serde_json::from_str::<Value>(frame).is_ok_and(|frame| {
                frame["kind"] == "authorization_invalidation"
                    && frame["snapshot"]["rows"]
                        .as_array()
                        .is_some_and(|rows| rows.len() == 1)
            })
        }));
    }

    const SCHEMA_RELOAD_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async insertOld(ctx) {
    return await ctx.db.insert('items', { value: 'old-schema' });
  },
  async readNewTable(ctx) {
    return (await ctx.db.query('new_items').collect()).length;
  }
};
"#;

    fn settled_sessions_state() -> AuthModeStateRecord {
        let digest = |prefix: &str, byte: char| format!("{prefix}{}", byte.to_string().repeat(64));
        let deployment = DeploymentIdentity {
            schema_version: "snapback.v1".to_owned(),
            auth_mode: AuthMode::Sessions,
            app_id: "app".to_owned(),
            schema_hash: digest(SCHEMA_V1_PREFIX, 'a'),
            bundle_hash: digest(FUNCTION_V1_PREFIX, 'b'),
            inputs_hash: digest(INPUTS_V1_PREFIX, 'c'),
        };
        let mut state = AuthModeStateRecord::initial_dev(Some(deployment.clone()));
        state.transition_generation = 4;
        state.active = AuthMode::Sessions;
        state.desired = AuthMode::Sessions;
        state.sessions_ever_activated = true;
        state.active_deployment = Some(deployment);
        state
            .validate_shape()
            .expect("valid settled Sessions state");
        state
    }

    fn cron_gate_snapback() -> LocalSnapback {
        let manifest = FunctionManifest {
            functions: vec![FunctionDefinition::new(
                "cronAction",
                FunctionKind::Action,
                FunctionRuntime::HostPlan(HandlerPlan::Action(ActionPlan {
                    steps: Vec::new(),
                    return_value: None,
                })),
            )],
            cron_jobs: vec![CronJobDefinition {
                name: "gatedCron".to_owned(),
                schedule: CronSchedule {
                    every_ms: Some(60_000),
                    cron: None,
                },
                action: "cronAction".to_owned(),
                enabled: true,
                activation: CronActivationPolicy::default(),
                jitter_policy: CronJitterPolicy {
                    enabled: false,
                    max_offset_ms: 0,
                },
                overlap_policy: CronOverlapPolicy::NoOverlap,
                retry_policy: CronRetryPolicy {
                    mode: CronRetryMode::NextTick,
                },
                required_capabilities: Vec::new(),
                target_wakeup: None,
                source_span: None,
            }],
            ..FunctionManifest::default()
        };
        let mut snapback = LocalSnapback::memory().expect("memory cron gate fixture");
        let diagnostics = snapback.load_functions(manifest);
        assert!(
            diagnostics
                .iter()
                .all(|diagnostic| diagnostic.severity
                    != crate::diagnostic::DiagnosticSeverity::Error),
            "cron gate fixture must load: {diagnostics:?}"
        );
        snapback
    }

    #[test]
    fn stream_requiring_artifact_is_refused_against_the_served_instance_manifest() {
        // @ref LLP 0076#target-contract — the outbound-disabled negative
        // admission witness: with egress off in THIS process, the served
        // instance manifest does not support bounded_response_stream_v1 and
        // the loader refuses the artifact before any handler can run.
        assert!(
            std::env::var("SNAPBACK_OUTBOUND_ACTIONS").is_err(),
            "lib tests run with egress disabled"
        );
        let mut action = FunctionDefinition::new(
            "streamRequiring",
            FunctionKind::Action,
            FunctionRuntime::IbexModule(IbexModule {
                source:
                    "globalThis.__snapbackHandlers = { async streamRequiring() { return null; } };"
                        .to_owned(),
                export: "streamRequiring".to_owned(),
            }),
        );
        action.required_capabilities = vec!["bounded_response_stream_v1".to_owned()];
        let mut snapback = LocalSnapback::memory().expect("memory instance");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![action],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics.iter().any(|diagnostic| {
                diagnostic.code == "SNAPBACK_CAPABILITY_UNSUPPORTED"
                    && diagnostic.severity == crate::diagnostic::DiagnosticSeverity::Error
            }),
            "egress-disabled admission must refuse: {diagnostics:?}"
        );
        // Nothing was installed: the function is unknown to the instance.
        let run = snapback.run_function("streamRequiring", HandlerInput::default());
        assert!(!run.ok, "refused artifact must not be invocable");
    }

    #[test]
    fn raw_dev_function_loader_rejects_sessions_half_before_publication() {
        let mut snapback = LocalSnapback::memory().unwrap();
        let before = snapback.functions.clone();
        let manifest = FunctionManifest {
            schema_version: crate::manifest::SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
            ..FunctionManifest::default()
        };
        let error = snapback
            .load_functions_in_settled_dev(manifest)
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_CAPABILITY_UNSUPPORTED");
        assert_eq!(snapback.functions, before);
    }

    #[test]
    fn closed_admission_cannot_mutate_or_persist_scheduled_or_manual_cron_claim() {
        let mut snapback = cron_gate_snapback();
        let before = snapback.cron.persisted_value().unwrap();
        let writes = snapback.cron_state_writes();
        let guard = snapback.admission.begin_transition().unwrap();

        let Err(scheduled_error) = snapback.claim_due_cron_runs(0) else {
            panic!("closed scheduled claim must fail");
        };
        assert_eq!(
            scheduled_error.diagnostic.code,
            "SNAPBACK_AUTH_MODE_PENDING"
        );
        let Err(manual_error) = snapback.claim_manual_cron_run("gatedCron", 0) else {
            panic!("closed manual claim must fail");
        };
        assert_eq!(manual_error.diagnostic.code, "SNAPBACK_AUTH_MODE_PENDING");
        assert_eq!(snapback.cron.persisted_value().unwrap(), before);
        assert_eq!(snapback.cron_state_writes(), writes);
        drop(guard);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn admitted_cron_claim_may_finish_while_transition_drains() {
        let mut snapback = cron_gate_snapback();
        let claim = snapback
            .claim_manual_cron_run("gatedCron", 10)
            .expect("admitted manual claim");
        let controller = snapback.admission.clone();
        let (closed_tx, closed_rx) = tokio::sync::oneshot::channel();
        let transition = tokio::spawn(async move {
            controller
                .begin_transition_async(move || {
                    let _ = closed_tx.send(());
                    Ok(())
                })
                .await
        });
        closed_rx.await.expect("transition published close");
        assert!(!snapback.admission.snapshot().accepting);

        let record = snapback
            .finish_cron_claim(claim, super::now_millis(), Ok(json!({ "ok": true })))
            .expect("old admitted claim linearizes finish before retirement");
        assert_eq!(record.outcome, crate::cron::CronRunOutcome::Succeeded);
        let guard = transition
            .await
            .expect("transition task")
            .expect("claim drained");
        guard.abort_and_reopen().expect("reopen after test drain");
    }

    #[test]
    fn timeout_retirement_suppresses_cron_finish_and_result_ledger_publication() {
        let mut snapback = cron_gate_snapback();
        let claim = snapback
            .claim_manual_cron_run("gatedCron", 20)
            .expect("admitted manual claim");
        let before = snapback.cron.persisted_value().unwrap();
        let writes = snapback.cron_state_writes();
        let error = snapback
            .admission
            .retire_current_epoch_for_test()
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT"
        );

        assert_eq!(
            snapback
                .finish_cron_claim(claim, super::now_millis(), Ok(json!({ "ok": true })))
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_MODE_PENDING"
        );
        assert_eq!(snapback.cron.persisted_value().unwrap(), before);
        assert_eq!(snapback.cron_state_writes(), writes);
    }

    fn result_handoff_snapback() -> LocalSnapback {
        let mut snapback = LocalSnapback::memory().expect("memory result handoff fixture");
        snapback
            .apply_schema(reload_schema("result-handoff-schema", false))
            .expect("apply result handoff schema");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![
                FunctionDefinition::new(
                    "listItems",
                    FunctionKind::Query,
                    FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                        table: "items".to_owned(),
                        filters: Vec::new(),
                        order: Vec::new(),
                        limit: None,
                        membership_filters: Vec::new(),
                        indexed_by: None,
                    })),
                ),
                FunctionDefinition::new(
                    "emptyAction",
                    FunctionKind::Action,
                    FunctionRuntime::HostPlan(HandlerPlan::Action(ActionPlan {
                        steps: Vec::new(),
                        return_value: None,
                    })),
                ),
            ],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics
                .iter()
                .all(|diagnostic| diagnostic.severity
                    != crate::diagnostic::DiagnosticSeverity::Error),
            "result handoff fixture must load: {diagnostics:?}"
        );
        snapback
    }

    // @ref LLP 0080#1-closed-relational-plan — end-to-end: activation
    //   validation admits a proven plan and refuses an unproven cardinality
    //   claim; invocation routes through the root-window executor with the
    //   caller's authority.
    #[test]
    fn relational_query_validates_and_invokes_end_to_end() {
        use crate::manifest::{
            FieldManifest, FieldType, IndexManifest, JoinEquality, JoinKind, ProjectionLeaf,
            ProjectionSource, RelationalQueryPlan, TableManifest,
        };
        let string = |name: &str, optional: bool| FieldManifest {
            name: name.to_owned(),
            field_type: FieldType::String,
            optional,
        };
        let schema = SchemaManifest {
            tables: vec![
                TableManifest {
                    name: "books".to_owned(),
                    fields: vec![
                        string("title", false),
                        string("authorSlug", true),
                        string("ownerId", false),
                    ],
                    indexes: vec![IndexManifest {
                        name: "by_owner_title".to_owned(),
                        fields: vec!["ownerId".to_owned(), "title".to_owned()],
                        unique: false,
                    }],
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    membership: None,
                },
                TableManifest {
                    name: "authors".to_owned(),
                    fields: vec![
                        string("slug", false),
                        string("name", false),
                        string("ownerId", false),
                    ],
                    indexes: vec![IndexManifest {
                        name: "by_slug".to_owned(),
                        fields: vec!["slug".to_owned()],
                        unique: true,
                    }],
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    membership: None,
                },
            ],
            ..SchemaManifest::default()
        };
        let owner_filter = |field: &str| FilterExpr {
            field: field.to_owned(),
            op: FilterOp::Eq,
            value: ValueExpr::AuthUserId,
        };
        let plan = RelationalQueryPlan {
            root: "books".to_owned(),
            root_alias: "book".to_owned(),
            joined: "authors".to_owned(),
            joined_alias: "author".to_owned(),
            join_kind: JoinKind::Inner,
            join_on: vec![JoinEquality {
                root_field: "authorSlug".to_owned(),
                joined_field: "slug".to_owned(),
            }],
            root_filters: Vec::new(),
            root_visibility: vec![owner_filter("ownerId")],
            joined_visibility: vec![owner_filter("ownerId")],
            projection: vec![
                ProjectionLeaf {
                    name: "title".to_owned(),
                    source: ProjectionSource::RootField("title".to_owned()),
                },
                ProjectionLeaf {
                    name: "authorName".to_owned(),
                    source: ProjectionSource::JoinedField("name".to_owned()),
                },
            ],
            order: vec![crate::manifest::OrderExpr {
                field: "title".to_owned(),
                direction: crate::manifest::OrderDirection::Asc,
            }],
            take: 10,
            root_index: "by_owner_title".to_owned(),
            joined_index: "by_slug".to_owned(),
        };

        let mut snapback = LocalSnapback::memory().expect("memory relational fixture");
        snapback.apply_schema(schema).expect("apply relational schema");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![FunctionDefinition::new(
                "booksWithAuthors",
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan.clone())),
            )],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics
                .iter()
                .all(|d| d.severity != crate::diagnostic::DiagnosticSeverity::Error),
            "proven relational plan must activate: {diagnostics:?}"
        );

        let row = |fields: Value| fields.as_object().cloned().expect("seed row");
        snapback
            .seed(crate::manifest::SeedData {
                tables: BTreeMap::from([
                    (
                        "books".to_owned(),
                        vec![
                            row(json!({ "title": "alpha", "authorSlug": "ada", "ownerId": "user-a" })),
                            row(json!({ "title": "beta", "authorSlug": "grace", "ownerId": "user-a" })),
                        ],
                    ),
                    (
                        "authors".to_owned(),
                        vec![
                            row(json!({ "slug": "ada", "name": "Ada", "ownerId": "user-a" })),
                            row(json!({ "slug": "grace", "name": "Grace", "ownerId": "user-b" })),
                        ],
                    ),
                ]),
            })
            .expect("seed relational rows");

        let output = snapback
            .invoke_query(
                "booksWithAuthors",
                HandlerInput {
                    auth: AuthInput {
                        user_id: Some("user-a".to_owned()),
                        ..AuthInput::default()
                    },
                    ..HandlerInput::default()
                },
            )
            .expect("relational invocation");
        assert_eq!(
            output.rows,
            vec![json!({ "authorName": "Ada", "title": "alpha" })],
            "inner join omits the invisible author's book without refill",
        );

        // An unproven cardinality claim (non-unique joined index) is refused
        // at activation, before any invocation exists.
        let mut unproven_schema_snapback =
            LocalSnapback::memory().expect("memory unproven fixture");
        let mut unproven_schema = SchemaManifest {
            tables: Vec::new(),
            ..SchemaManifest::default()
        };
        // Same schema but the joined index loses uniqueness.
        unproven_schema.tables = vec![
            TableManifest {
                name: "books".to_owned(),
                fields: vec![
                    string("title", false),
                    string("authorSlug", true),
                    string("ownerId", false),
                ],
                indexes: vec![IndexManifest {
                    name: "by_owner_title".to_owned(),
                    fields: vec!["ownerId".to_owned(), "title".to_owned()],
                    unique: false,
                }],
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                membership: None,
            },
            TableManifest {
                name: "authors".to_owned(),
                fields: vec![
                    string("slug", false),
                    string("name", false),
                    string("ownerId", false),
                ],
                indexes: vec![IndexManifest {
                    name: "by_slug".to_owned(),
                    fields: vec!["slug".to_owned()],
                    unique: false,
                }],
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                membership: None,
            },
        ];
        unproven_schema_snapback
            .apply_schema(unproven_schema)
            .expect("apply unproven schema");
        let diagnostics = unproven_schema_snapback.load_functions(FunctionManifest {
            functions: vec![FunctionDefinition::new(
                "booksWithAuthors",
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan)),
            )],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics.iter().any(|d| d
                .message
                .contains("SNAPBACK_RELATIONAL_CARDINALITY_UNPROVEN")
                || d.code == "SNAPBACK_RELATIONAL_CARDINALITY_UNPROVEN"),
            "non-unique joined index must refuse activation: {diagnostics:?}"
        );
    }

    // @ref LLP 0080#2-portable-evaluation-semantics — the opaque versioned
    //   cursor end to end: a full page mints a continuation bound to the
    //   app, plan, argument set, order schema, and authority partition;
    //   presenting it resumes from the last consumed root; and the refusal
    //   classes — malformed, tampered, cross-plan, cross-authority — all
    //   answer with one byte-identical SNAPBACK_RELATIONAL_CURSOR_INVALID.
    #[test]
    fn relational_cursor_pages_and_refuses_end_to_end() {
        use crate::manifest::{
            FieldManifest, FieldType, IndexManifest, JoinEquality, JoinKind, ProjectionLeaf,
            ProjectionSource, RelationalQueryPlan, TableManifest,
        };
        let string = |name: &str, optional: bool| FieldManifest {
            name: name.to_owned(),
            field_type: FieldType::String,
            optional,
        };
        let schema = SchemaManifest {
            tables: vec![
                TableManifest {
                    name: "books".to_owned(),
                    fields: vec![
                        string("title", false),
                        string("authorSlug", true),
                        string("ownerId", false),
                    ],
                    indexes: vec![IndexManifest {
                        name: "by_owner_title".to_owned(),
                        fields: vec!["ownerId".to_owned(), "title".to_owned()],
                        unique: false,
                    }],
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    membership: None,
                },
                TableManifest {
                    name: "authors".to_owned(),
                    fields: vec![
                        string("slug", false),
                        string("name", false),
                        string("ownerId", false),
                    ],
                    indexes: vec![IndexManifest {
                        name: "by_slug".to_owned(),
                        fields: vec!["slug".to_owned()],
                        unique: true,
                    }],
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    membership: None,
                },
            ],
            ..SchemaManifest::default()
        };
        let owner_filter = |field: &str| FilterExpr {
            field: field.to_owned(),
            op: FilterOp::Eq,
            value: ValueExpr::AuthUserId,
        };
        let plan = |join_kind: JoinKind| RelationalQueryPlan {
            root: "books".to_owned(),
            root_alias: "book".to_owned(),
            joined: "authors".to_owned(),
            joined_alias: "author".to_owned(),
            join_kind,
            join_on: vec![JoinEquality {
                root_field: "authorSlug".to_owned(),
                joined_field: "slug".to_owned(),
            }],
            root_filters: Vec::new(),
            root_visibility: vec![owner_filter("ownerId")],
            joined_visibility: Vec::new(),
            projection: vec![ProjectionLeaf {
                name: "title".to_owned(),
                source: ProjectionSource::RootField("title".to_owned()),
            }],
            order: vec![crate::manifest::OrderExpr {
                field: "title".to_owned(),
                direction: crate::manifest::OrderDirection::Asc,
            }],
            take: 1,
            root_index: "by_owner_title".to_owned(),
            joined_index: "by_slug".to_owned(),
        };

        let mut snapback = LocalSnapback::memory().expect("memory cursor fixture");
        snapback.apply_schema(schema).expect("apply cursor schema");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![
                FunctionDefinition::new(
                    "pagedBooks",
                    FunctionKind::LiveQuery,
                    FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan(
                        JoinKind::Inner,
                    ))),
                ),
                FunctionDefinition::new(
                    "pagedBooksLeft",
                    FunctionKind::LiveQuery,
                    FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan(JoinKind::Left))),
                ),
            ],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics
                .iter()
                .all(|d| d.severity != crate::diagnostic::DiagnosticSeverity::Error),
            "cursor fixture must activate: {diagnostics:?}"
        );
        let row = |fields: Value| fields.as_object().cloned().expect("seed row");
        snapback
            .seed(crate::manifest::SeedData {
                tables: BTreeMap::from([
                    (
                        "books".to_owned(),
                        vec![
                            row(json!({ "title": "alpha", "authorSlug": "ada", "ownerId": "user-a" })),
                            row(json!({ "title": "beta", "authorSlug": "ada", "ownerId": "user-a" })),
                            row(json!({ "title": "gamma", "authorSlug": "ada", "ownerId": "user-a" })),
                        ],
                    ),
                    (
                        "authors".to_owned(),
                        vec![row(
                            json!({ "slug": "ada", "name": "Ada", "ownerId": "user-a" }),
                        )],
                    ),
                ]),
            })
            .expect("seed cursor rows");

        let input = |user: &str, session: &str, args: Value| HandlerInput {
            args,
            auth: AuthInput {
                user_id: Some(user.to_owned()),
                session_id: Some(session.to_owned()),
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        };

        // Page walk: alpha → beta → gamma → terminal.
        let page1 = snapback
            .invoke_query("pagedBooks", input("user-a", "s1", json!({})))
            .expect("first page");
        assert_eq!(page1.rows, vec![json!({ "title": "alpha" })]);
        let cursor1 = page1.cursor.expect("full page mints a continuation");
        assert!(
            cursor1.starts_with("sbrc1."),
            "cursor is versioned wire opaque: {cursor1}"
        );
        let page2 = snapback
            .invoke_query(
                "pagedBooks",
                input("user-a", "s1", json!({ "cursor": cursor1 })),
            )
            .expect("second page");
        assert_eq!(page2.rows, vec![json!({ "title": "beta" })]);
        let cursor2 = page2.cursor.expect("second continuation");
        let page3 = snapback
            .invoke_query(
                "pagedBooks",
                input("user-a", "s1", json!({ "cursor": cursor2 })),
            )
            .expect("third page");
        assert_eq!(page3.rows, vec![json!({ "title": "gamma" })]);
        let cursor3 = page3.cursor.expect("third continuation");
        let page4 = snapback
            .invoke_query(
                "pagedBooks",
                input("user-a", "s1", json!({ "cursor": cursor3.clone() })),
            )
            .expect("terminal page");
        assert!(page4.rows.is_empty());
        assert!(page4.cursor.is_none(), "a short page is terminal");

        // Refusal classes, each byte-identical to the others.
        let refusal = |snapback: &LocalSnapback, args: Value, user: &str, session: &str, function: &str| {
            match snapback.invoke_query(function, input(user, session, args.clone())) {
                Err(error) => error,
                Ok(output) => panic!(
                    "cursor presentation must refuse: {function} {user}/{session} {args} -> {output:?}"
                ),
            }
        };
        let malformed = refusal(&snapback, json!({ "cursor": "sbrc1.garbage" }), "user-a", "s1", "pagedBooks");
        assert_eq!(malformed.diagnostic.code, "SNAPBACK_RELATIONAL_CURSOR_INVALID");
        let non_string = refusal(&snapback, json!({ "cursor": 7 }), "user-a", "s1", "pagedBooks");
        // Tampered body: flip the boundary bytes, keep the MAC.
        let mut parts: Vec<String> = cursor3.split('.').map(str::to_owned).collect();
        parts[2] = {
            use base64::Engine as _;
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(br#"{"app":"x","binding":"y","boundary":["zz"],"id":"b9","issuedAt":1}"#)
        };
        let tampered = refusal(
            &snapback,
            json!({ "cursor": parts.join(".") }),
            "user-a",
            "s1",
            "pagedBooks",
        );
        // Cross-plan: the same caller's cursor presented to a different plan.
        let cross_plan = refusal(
            &snapback,
            json!({ "cursor": cursor3.clone() }),
            "user-a",
            "s1",
            "pagedBooksLeft",
        );
        // Cross-authority: another user, and the same user after a session
        // (authority partition) transition.
        let cross_user = refusal(
            &snapback,
            json!({ "cursor": cursor3.clone() }),
            "user-b",
            "s1",
            "pagedBooks",
        );
        // Stale authority: an authorization change rolls the caller's
        // permission-scope epoch (the dev-admitted path canonicalizes the
        // session away, so the epoch is the partition signal here), and a
        // cursor minted before the transition is refused after it.
        snapback
            .permission_epochs
            .insert(super::user_permission_scope("user-a"), 7);
        let stale_authority =
            refusal(&snapback, json!({ "cursor": cursor3 }), "user-a", "s1", "pagedBooks");
        for refused in [
            &non_string,
            &tampered,
            &cross_plan,
            &cross_user,
            &stale_authority,
        ] {
            assert_eq!(
                (refused.diagnostic.code.as_str(), refused.diagnostic.message.as_str()),
                (
                    malformed.diagnostic.code.as_str(),
                    malformed.diagnostic.message.as_str()
                ),
                "every cursor refusal class is byte-indistinguishable",
            );
        }
    }

    // @ref LLP 0080#2-portable-evaluation-semantics — evaluator parity on
    //   the local target: the write lane and the lock-free read lane share
    //   one relational implementation, so the same plan produces the same
    //   RelationalResultEncodingV1 bytes on both, and a continuation minted
    //   by one lane resumes through the other (shared keyring + binding).
    //   The buffered read-your-writes overlay is witnessed separately as
    //   unreachable: ctx.db host calls admit only single-table plans.
    #[test]
    fn relational_lanes_share_bytes_and_cursors() {
        use crate::manifest::{
            FieldManifest, FieldType, IndexManifest, JoinEquality, JoinKind, ProjectionLeaf,
            ProjectionSource, RelationalQueryPlan, TableManifest,
        };
        let dir =
            std::env::temp_dir().join(format!("snapback-rel-lanes-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create test dir");
        let path = dir.join("rel-lanes.sqlite");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(dir.join("resume-keyring.json"));

        let string = |name: &str, optional: bool| FieldManifest {
            name: name.to_owned(),
            field_type: FieldType::String,
            optional,
        };
        let schema = SchemaManifest {
            tables: vec![
                TableManifest {
                    name: "books".to_owned(),
                    fields: vec![
                        string("title", false),
                        string("authorSlug", true),
                        string("ownerId", false),
                    ],
                    indexes: vec![IndexManifest {
                        name: "by_owner_title".to_owned(),
                        fields: vec!["ownerId".to_owned(), "title".to_owned()],
                        unique: false,
                    }],
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    membership: None,
                },
                TableManifest {
                    name: "authors".to_owned(),
                    fields: vec![
                        string("slug", false),
                        string("name", false),
                        string("ownerId", false),
                    ],
                    indexes: vec![IndexManifest {
                        name: "by_slug".to_owned(),
                        fields: vec!["slug".to_owned(), ],
                        unique: true,
                    }],
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    membership: None,
                },
            ],
            ..SchemaManifest::default()
        };
        let owner_filter = |field: &str| FilterExpr {
            field: field.to_owned(),
            op: FilterOp::Eq,
            value: ValueExpr::AuthUserId,
        };
        let plan = RelationalQueryPlan {
            root: "books".to_owned(),
            root_alias: "book".to_owned(),
            joined: "authors".to_owned(),
            joined_alias: "author".to_owned(),
            join_kind: JoinKind::Inner,
            join_on: vec![JoinEquality {
                root_field: "authorSlug".to_owned(),
                joined_field: "slug".to_owned(),
            }],
            root_filters: Vec::new(),
            root_visibility: vec![owner_filter("ownerId")],
            joined_visibility: Vec::new(),
            projection: vec![ProjectionLeaf {
                name: "title".to_owned(),
                source: ProjectionSource::RootField("title".to_owned()),
            }],
            order: vec![crate::manifest::OrderExpr {
                field: "title".to_owned(),
                direction: crate::manifest::OrderDirection::Asc,
            }],
            take: 1,
            root_index: "by_owner_title".to_owned(),
            joined_index: "by_slug".to_owned(),
        };

        let mut snapback = LocalSnapback::open(&path).expect("open file-backed fixture");
        snapback.apply_schema(schema).expect("apply schema");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![FunctionDefinition::new(
                "pagedBooks",
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan)),
            )],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics
                .iter()
                .all(|d| d.severity != crate::diagnostic::DiagnosticSeverity::Error),
            "lane fixture must activate: {diagnostics:?}"
        );
        let row = |fields: Value| fields.as_object().cloned().expect("seed row");
        snapback
            .seed(crate::manifest::SeedData {
                tables: BTreeMap::from([
                    (
                        "books".to_owned(),
                        vec![
                            row(json!({ "title": "alpha", "authorSlug": "ada", "ownerId": "user-a" })),
                            row(json!({ "title": "beta", "authorSlug": "ada", "ownerId": "user-a" })),
                        ],
                    ),
                    (
                        "authors".to_owned(),
                        vec![row(
                            json!({ "slug": "ada", "name": "Ada", "ownerId": "user-a" }),
                        )],
                    ),
                ]),
            })
            .expect("seed lane rows");
        let lane = snapback.read_lane();
        assert!(lane.available(), "file-backed fixture has a read lane");

        let input = |args: Value| HandlerInput {
            args,
            auth: AuthInput {
                user_id: Some("user-a".to_owned()),
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let field_order = vec!["title".to_owned()];
        let write_page = snapback
            .invoke_query("pagedBooks", input(json!({})))
            .expect("write-lane page");
        let read_page = lane
            .invoke_query("pagedBooks", input(json!({})))
            .expect("read-lane page");
        assert_eq!(
            crate::rqs::relational_result_encoding_v1(&field_order, &write_page.rows)
                .expect("write rows encode"),
            crate::rqs::relational_result_encoding_v1(&field_order, &read_page.rows)
                .expect("read rows encode"),
            "both lanes produce identical RelationalResultEncodingV1 bytes",
        );

        // Cross-lane continuation: a cursor minted on the read lane resumes
        // on the write lane, and vice versa — one keyring, one binding.
        let read_cursor = read_page.cursor.expect("read lane mints");
        let write_cursor = write_page.cursor.expect("write lane mints");
        let via_write = snapback
            .invoke_query("pagedBooks", input(json!({ "cursor": read_cursor })))
            .expect("read-lane cursor resumes on the write lane");
        let via_read = lane
            .invoke_query("pagedBooks", input(json!({ "cursor": write_cursor })))
            .expect("write-lane cursor resumes on the read lane");
        assert_eq!(
            crate::rqs::relational_result_encoding_v1(&field_order, &via_write.rows)
                .expect("write continuation encodes"),
            crate::rqs::relational_result_encoding_v1(&field_order, &via_read.rows)
                .expect("read continuation encodes"),
        );
        assert_eq!(via_write.rows[0]["title"], json!("beta"));
    }

    fn relational_live_fixture_functions(
        plan_take: u32,
    ) -> (SchemaManifest, FunctionManifest) {
        use crate::manifest::{
            FieldManifest, FieldType, IndexManifest, JoinEquality, JoinKind, ProjectionLeaf,
            ProjectionSource, RelationalQueryPlan, TableManifest,
        };
        let string = |name: &str, optional: bool| FieldManifest {
            name: name.to_owned(),
            field_type: FieldType::String,
            optional,
        };
        let schema = SchemaManifest {
            tables: vec![
                TableManifest {
                    name: "books".to_owned(),
                    fields: vec![
                        string("title", false),
                        string("authorSlug", true),
                        string("ownerId", false),
                    ],
                    indexes: vec![IndexManifest {
                        name: "by_owner_title".to_owned(),
                        fields: vec!["ownerId".to_owned(), "title".to_owned()],
                        unique: false,
                    }],
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    membership: None,
                },
                TableManifest {
                    name: "authors".to_owned(),
                    fields: vec![
                        string("slug", false),
                        string("name", false),
                        string("ownerId", false),
                    ],
                    indexes: vec![IndexManifest {
                        name: "by_slug".to_owned(),
                        fields: vec!["slug".to_owned()],
                        unique: true,
                    }],
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    membership: None,
                },
            ],
            ..SchemaManifest::default()
        };
        let plan = RelationalQueryPlan {
            root: "books".to_owned(),
            root_alias: "book".to_owned(),
            joined: "authors".to_owned(),
            joined_alias: "author".to_owned(),
            join_kind: JoinKind::Inner,
            join_on: vec![JoinEquality {
                root_field: "authorSlug".to_owned(),
                joined_field: "slug".to_owned(),
            }],
            root_filters: Vec::new(),
            root_visibility: vec![FilterExpr {
                field: "ownerId".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::AuthUserId,
            }],
            joined_visibility: Vec::new(),
            projection: vec![ProjectionLeaf {
                name: "title".to_owned(),
                source: ProjectionSource::RootField("title".to_owned()),
            }],
            order: vec![crate::manifest::OrderExpr {
                field: "title".to_owned(),
                direction: crate::manifest::OrderDirection::Asc,
            }],
            take: plan_take,
            root_index: "by_owner_title".to_owned(),
            joined_index: "by_slug".to_owned(),
        };
        let insert = |name: &str, table: &str, fields: &[(&str, ValueExpr)]| {
            FunctionDefinition::new(
                name,
                FunctionKind::Mutation,
                FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                    steps: vec![MutationStep::Insert {
                        table: table.to_owned(),
                        values: fields
                            .iter()
                            .map(|(field, value)| ((*field).to_owned(), value.clone()))
                            .collect(),
                        bind_id_as: None,
                    }],
                    return_value: None,
                })),
            )
        };
        let functions = FunctionManifest {
            functions: vec![
                FunctionDefinition::new(
                    "booksWithAuthors",
                    FunctionKind::LiveQuery,
                    FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan)),
                ),
                insert(
                    "addBook",
                    "books",
                    &[
                        ("title", ValueExpr::Arg("title".to_owned())),
                        ("authorSlug", ValueExpr::Arg("slug".to_owned())),
                        ("ownerId", ValueExpr::Literal(json!("user-a"))),
                    ],
                ),
                insert(
                    "addAuthor",
                    "authors",
                    &[
                        ("slug", ValueExpr::Arg("slug".to_owned())),
                        ("name", ValueExpr::Arg("name".to_owned())),
                        ("ownerId", ValueExpr::Literal(json!("user-a"))),
                    ],
                ),
            ],
            ..FunctionManifest::default()
        };
        (schema, functions)
    }

    // @ref LLP 0080#4-live-and-retained-capability — live inheritance is
    //   deliberately conservative: a commit touching either declared source
    //   table (including the absent-unique-lookup direction — a joined row
    //   appearing for a previously missing key) causes an authoritative
    //   resnapshot delivered as live_replace, and no live_delta is ever
    //   claimed for a relational subscription.
    #[test]
    fn relational_live_replaces_on_both_tables_and_never_claims_delta() {
        let (schema, functions) = relational_live_fixture_functions(10);
        let mut snapback = LocalSnapback::memory().expect("memory live fixture");
        snapback.apply_schema(schema).expect("apply live schema");
        let diagnostics = snapback.load_functions(functions);
        assert!(
            diagnostics
                .iter()
                .all(|d| d.severity != crate::diagnostic::DiagnosticSeverity::Error),
            "live fixture must activate: {diagnostics:?}"
        );
        let row = |fields: Value| fields.as_object().cloned().expect("seed row");
        snapback
            .seed(crate::manifest::SeedData {
                tables: BTreeMap::from([
                    (
                        "books".to_owned(),
                        vec![row(
                            json!({ "title": "alpha", "authorSlug": "ada", "ownerId": "user-a" }),
                        )],
                    ),
                    (
                        "authors".to_owned(),
                        vec![row(
                            json!({ "slug": "ada", "name": "Ada", "ownerId": "user-a" }),
                        )],
                    ),
                ]),
            })
            .expect("seed live rows");

        let subscribed = snapback
            .subscribe_live(
                "booksWithAuthors",
                LiveSubscribeInput {
                    connection_id: "conn-rel".to_owned(),
                    input: HandlerInput {
                        auth: AuthInput {
                            user_id: Some("user-a".to_owned()),
                            ..AuthInput::default()
                        },
                        ..HandlerInput::default()
                    },
                    authorization_namespace: None,
                    supersedes: None,
                    resume_from_token: None,
                },
            )
            .expect("subscribe relational");
        let snapshot = subscribed.snapshot.expect("initial snapshot");
        assert_eq!(snapshot.rows, vec![json!({ "title": "alpha" })]);

        let titles = |envelope: &Value| {
            envelope["rows"]
                .as_array()
                .expect("rows")
                .iter()
                .map(|row| row["title"].clone())
                .collect::<Vec<_>>()
        };

        // Root-table commit: replacement fires even though the new root is
        // omitted by the inner join (no author row yet).
        snapback
            .invoke_mutation(
                "addBook",
                HandlerInput {
                    args: json!({ "title": "beta", "slug": "grace" }),
                    ..HandlerInput::default()
                },
            )
            .expect("insert root row");
        let after_root = rqs_drained_envelopes(&mut snapback, "conn-rel");
        assert!(!after_root.is_empty(), "root commit must replace");
        for envelope in &after_root {
            assert_eq!(
                envelope["kind"], "live_replace",
                "relational subscriptions never claim live_delta: {envelope}"
            );
        }
        assert_eq!(
            titles(after_root.last().expect("replacement")),
            vec![json!("alpha")],
        );

        // Joined-table commit — the absent unique lookup gains a row, and
        // the previously omitted root appears in the replacement.
        snapback
            .invoke_mutation(
                "addAuthor",
                HandlerInput {
                    args: json!({ "slug": "grace", "name": "Grace" }),
                    ..HandlerInput::default()
                },
            )
            .expect("insert joined row");
        let after_joined = rqs_drained_envelopes(&mut snapback, "conn-rel");
        assert!(!after_joined.is_empty(), "joined commit must replace");
        for envelope in &after_joined {
            assert_eq!(envelope["kind"], "live_replace");
        }
        assert_eq!(
            titles(after_joined.last().expect("replacement")),
            vec![json!("alpha"), json!("beta")],
        );
    }

    // @ref LLP 0065#1-fact-classes — the runtime checks observed
    //   operations are a subset of the admitted EffectCeilingV1 and fails
    //   closed on mismatch: a doctored artifact that under-declares its
    //   ceiling refuses activation, and the exact generated ceiling passes.
    #[test]
    fn effect_ceiling_subset_check_fails_closed_on_mismatch() {
        use crate::manifest::{EffectCeiling, EffectCeilingRead, EffectCeilingWrite};
        let (schema, functions) = relational_live_fixture_functions(10);
        let mut add_book = functions.functions[1].clone();
        assert_eq!(add_book.name, "addBook");

        // The exact ceiling the walker would emit for addBook: one insert
        // into books, no reads, no host ops, no authorization inputs.
        add_book.effect_ceiling = Some(EffectCeiling {
            version: "EffectCeilingV1".to_owned(),
            basis: "static".to_owned(),
            reads: Vec::new(),
            writes: vec![EffectCeilingWrite {
                table: "books".to_owned(),
                operations: vec!["insert".to_owned()],
            }],
            host_operations: Vec::new(),
            authorization_inputs: Vec::new(),
        });
        let mut snapback = LocalSnapback::memory().expect("memory ceiling fixture");
        snapback
            .apply_schema(schema.clone())
            .expect("apply ceiling schema");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![add_book.clone()],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics
                .iter()
                .all(|d| d.severity != crate::diagnostic::DiagnosticSeverity::Error),
            "the exact ceiling must activate: {diagnostics:?}"
        );

        // Fault: the same plan with an under-declared ceiling (writes a
        // table the ceiling does not admit) refuses activation.
        let mut doctored = add_book;
        doctored.effect_ceiling = Some(EffectCeiling {
            version: "EffectCeilingV1".to_owned(),
            basis: "static".to_owned(),
            reads: Vec::new(),
            writes: vec![EffectCeilingWrite {
                table: "authors".to_owned(),
                operations: vec!["insert".to_owned()],
            }],
            host_operations: Vec::new(),
            authorization_inputs: Vec::new(),
        });
        let mut snapback = LocalSnapback::memory().expect("memory fault fixture");
        snapback.apply_schema(schema.clone()).expect("apply fault schema");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![doctored],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics.iter().any(|d| {
                d.code == "SNAPBACK_FUNCTION_EFFECT_CEILING_EXCEEDED"
                    || d.message
                        .contains("SNAPBACK_FUNCTION_EFFECT_CEILING_EXCEEDED")
            }),
            "an out-of-ceiling write must refuse activation: {diagnostics:?}"
        );

        // The same subset rule covers authorization inputs: an owner-filtered
        // relational read observing AuthUserId refuses under a ceiling that
        // omits it.
        let mut relational = functions.functions[0].clone();
        relational.effect_ceiling = Some(EffectCeiling {
            version: "EffectCeilingV1".to_owned(),
            basis: "static".to_owned(),
            reads: vec![
                EffectCeilingRead {
                    table: "books".to_owned(),
                    access: "query".to_owned(),
                    index: Some("by_owner_title".to_owned()),
                },
                EffectCeilingRead {
                    table: "authors".to_owned(),
                    access: "query".to_owned(),
                    index: Some("by_slug".to_owned()),
                },
            ],
            writes: Vec::new(),
            host_operations: Vec::new(),
            authorization_inputs: Vec::new(),
        });
        let mut snapback = LocalSnapback::memory().expect("memory auth-input fixture");
        snapback.apply_schema(schema).expect("apply auth-input schema");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![relational],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics.iter().any(|d| {
                d.code == "SNAPBACK_FUNCTION_EFFECT_CEILING_EXCEEDED"
                    || d.message
                        .contains("SNAPBACK_FUNCTION_EFFECT_CEILING_EXCEEDED")
            }),
            "an undeclared authorization input must refuse activation: {diagnostics:?}"
        );
    }

    // The Rust subset check and codegen's EffectCeilingV1 walker must stay
    //   mirror images: every committed generated manifest activates without
    //   a ceiling-exceeded refusal. A divergence in either direction fails
    //   here before it ships.
    #[test]
    fn generated_demo_manifests_pass_the_effect_ceiling_subset_check() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        for demo in [
            "demos/competitive-checkpoint/snapback/generated",
            "demos/todo-v2/snapback/generated",
            "demos/todo/snapback/generated",
        ] {
            let read = |file: &str| {
                std::fs::read_to_string(root.join(demo).join(file))
                    .unwrap_or_else(|error| panic!("read {demo}/{file}: {error}"))
            };
            let schema: SchemaManifest = serde_json::from_str(&read("schema.manifest.json"))
                .unwrap_or_else(|error| panic!("parse {demo} schema: {error}"));
            let functions: FunctionManifest =
                serde_json::from_str(&read("functions.manifest.json"))
                    .unwrap_or_else(|error| panic!("parse {demo} functions: {error}"));
            let mut snapback = LocalSnapback::memory().expect("memory demo fixture");
            let _ = snapback.apply_schema(schema);
            let diagnostics = snapback.load_functions(functions);
            assert!(
                diagnostics.iter().all(|d| {
                    d.code != "SNAPBACK_FUNCTION_EFFECT_CEILING_EXCEEDED"
                        && !d
                            .message
                            .contains("SNAPBACK_FUNCTION_EFFECT_CEILING_EXCEEDED")
                }),
                "{demo}: generated ceilings must satisfy the runtime subset \
                 check: {diagnostics:?}"
            );
        }
    }

    // @ref LLP 0065#3-common-pattern-contracts — the same-subject two-app
    //   domain negative: cursors are bound to the application authority
    //   domain, so a continuation minted by one app instance is refused by
    //   another even for the same subject, plan shape, and function name.
    #[test]
    fn standard_pattern_cursor_never_crosses_the_app_domain() {
        let build = |app_id: &str| {
            let (schema, functions) = relational_live_fixture_functions(1);
            let mut manifest = FunctionManifest {
                functions: functions.functions,
                ..FunctionManifest::default()
            };
            manifest.app_id = app_id.to_owned();
            let mut snapback = LocalSnapback::memory().expect("memory app fixture");
            snapback.apply_schema(schema).expect("apply app schema");
            let diagnostics = snapback.load_functions(manifest);
            assert!(
                diagnostics
                    .iter()
                    .all(|d| d.severity != crate::diagnostic::DiagnosticSeverity::Error),
                "app fixture must activate: {diagnostics:?}"
            );
            let row = |fields: Value| fields.as_object().cloned().expect("seed row");
            snapback
                .seed(crate::manifest::SeedData {
                    tables: BTreeMap::from([
                        (
                            "books".to_owned(),
                            vec![
                                row(json!({ "title": "alpha", "authorSlug": "ada", "ownerId": "user-a" })),
                                row(json!({ "title": "beta", "authorSlug": "ada", "ownerId": "user-a" })),
                            ],
                        ),
                        (
                            "authors".to_owned(),
                            vec![row(
                                json!({ "slug": "ada", "name": "Ada", "ownerId": "user-a" }),
                            )],
                        ),
                    ]),
                })
                .expect("seed app rows");
            snapback
        };
        let input = |args: Value| HandlerInput {
            args,
            auth: AuthInput {
                user_id: Some("user-a".to_owned()),
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let app_a = build("app-a");
        let app_b = build("app-b");
        let page = app_a
            .invoke_query("booksWithAuthors", input(json!({})))
            .expect("app-a first page");
        let cursor = page.cursor.expect("app-a continuation");
        // Same subject, same function name, same plan shape — different
        // application authority domain: refused, never repositioned.
        let error = app_b
            .invoke_query("booksWithAuthors", input(json!({ "cursor": cursor.clone() })))
            .expect_err("cross-app cursor must refuse");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_RELATIONAL_CURSOR_INVALID"
        );
        // And the home app still accepts it.
        let resumed = app_a
            .invoke_query("booksWithAuthors", input(json!({ "cursor": cursor })))
            .expect("home app resumes");
        assert_eq!(resumed.rows, vec![json!({ "title": "beta" })]);
    }

    // @ref LLP 0080#4-live-and-retained-capability — the load-time
    //   narrowings: an all-public relational plan stays
    //   authority-partition-scoped (never authorityIndependent), and
    //   retention is the closed default-deny capability — v1 authoring
    //   admits only `none`, with its own honest refusal reason.
    #[test]
    fn relational_live_narrowings_hold_at_load() {
        let (schema, functions) = relational_live_fixture_functions(10);
        let relational = functions.functions[0].clone();

        let mut independent = relational.clone();
        independent.authority_independent = true;
        independent.auth_requirement = Some(crate::manifest::AuthRequirement::Public);
        let mut snapback = LocalSnapback::memory().expect("memory narrowing fixture");
        snapback
            .apply_schema(schema.clone())
            .expect("apply narrowing schema");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![independent],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics.iter().any(|d| {
                d.code == "SNAPBACK_AUTHORITY_INDEPENDENT_INVALID"
                    || d.message.contains("SNAPBACK_AUTHORITY_INDEPENDENT_INVALID")
            }),
            "a relational plan must not claim authorityIndependent: {diagnostics:?}"
        );

        let mut retainable = relational;
        retainable.retainable = true;
        let mut snapback = LocalSnapback::memory().expect("memory retention fixture");
        snapback.apply_schema(schema).expect("apply retention schema");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![retainable],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics.iter().any(|d| {
                (d.code == "SNAPBACK_AUTH_UNDECLARABLE_RETENTION"
                    || d.message.contains("SNAPBACK_AUTH_UNDECLARABLE_RETENTION"))
                    && d.message.contains("relationalRetentionNone")
            }),
            "relational retention is default-deny with an honest reason: {diagnostics:?}"
        );
    }

    // @ref LLP 0065#4-capability-and-llp-0053-composition — a generated
    //   standard pattern claims no skip and no live_delta: the identical
    //   plan shape rides the delta lane without the pattern identity and
    //   the conservative live_replace lane with it, and the capability
    //   artifact records both the conservative delivery and the disabled
    //   authScopeField disjointness-skip refinement.
    #[test]
    fn standard_pattern_live_is_conservative_and_recorded() {
        use crate::manifest::{FieldManifest, FieldType, StandardPatternIdentity, TableManifest};
        let schema = SchemaManifest {
            tables: vec![TableManifest {
                name: "todos".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "ownerId".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "slug".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                membership: None,
            }],
            ..SchemaManifest::default()
        };
        let lookup_plan = QueryPlan {
            table: "todos".to_owned(),
            filters: vec![
                FilterExpr {
                    field: "ownerId".to_owned(),
                    op: FilterOp::Eq,
                    value: ValueExpr::AuthUserId,
                },
                FilterExpr {
                    field: "slug".to_owned(),
                    op: FilterOp::Eq,
                    value: ValueExpr::Arg("slug".to_owned()),
                },
            ],
            membership_filters: Vec::new(),
            order: Vec::new(),
            limit: Some(1),
            indexed_by: None,
        };
        let mut pattern = FunctionDefinition::new(
            "lookupPattern",
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::Query(lookup_plan.clone())),
        );
        pattern.standard_pattern = Some(StandardPatternIdentity {
            helper: "owned-unique-lookup.v1".to_owned(),
            profile: "owner.v1".to_owned(),
        });
        let control = FunctionDefinition::new(
            "lookupControl",
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::Query(lookup_plan)),
        );
        let add = FunctionDefinition::new(
            "addTodo",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                steps: vec![MutationStep::Insert {
                    table: "todos".to_owned(),
                    values: BTreeMap::from([
                        (
                            "ownerId".to_owned(),
                            ValueExpr::Literal(json!("user-a")),
                        ),
                        ("slug".to_owned(), ValueExpr::Arg("slug".to_owned())),
                    ]),
                    bind_id_as: None,
                }],
                return_value: None,
            })),
        );

        let mut snapback = LocalSnapback::memory().expect("memory pattern-live fixture");
        snapback.apply_schema(schema).expect("apply pattern-live schema");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![pattern, control, add],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics
                .iter()
                .all(|d| d.severity != crate::diagnostic::DiagnosticSeverity::Error),
            "pattern-live fixture must activate: {diagnostics:?}"
        );
        let subscribe = |snapback: &mut LocalSnapback, name: &str| {
            snapback
                .subscribe_live(
                    name,
                    LiveSubscribeInput {
                        connection_id: "conn-pattern-live".to_owned(),
                        input: HandlerInput {
                            args: json!({ "slug": "x" }),
                            auth: AuthInput {
                                user_id: Some("user-a".to_owned()),
                                ..AuthInput::default()
                            },
                            ..HandlerInput::default()
                        },
                        authorization_namespace: None,
                        supersedes: None,
                        resume_from_token: None,
                    },
                )
                .expect("subscribe pattern-live")
        };
        subscribe(&mut snapback, "lookupPattern");
        subscribe(&mut snapback, "lookupControl");
        snapback
            .invoke_mutation(
                "addTodo",
                HandlerInput {
                    args: json!({ "slug": "x" }),
                    ..HandlerInput::default()
                },
            )
            .expect("insert matching row");
        let envelopes = rqs_drained_envelopes(&mut snapback, "conn-pattern-live");
        let kind_for = |function: &str| {
            envelopes
                .iter()
                .find(|envelope| envelope["function"] == function)
                .unwrap_or_else(|| panic!("{function} delivery missing: {envelopes:?}"))["kind"]
                .clone()
        };
        assert_eq!(
            kind_for("lookupControl"),
            json!("live_delta"),
            "the identical shape without the identity keeps the delta lane",
        );
        assert_eq!(
            kind_for("lookupPattern"),
            json!("live_replace"),
            "a pattern-identified function never claims live_delta",
        );

        // The capability artifact records the posture (LLP 0065 §4) — and
        // the narrow Cloudflare proof, which has no pattern runtime,
        // deliberately claims nothing.
        let local = crate::manifest::CapabilityManifest::local_v0_declared();
        let facts = local.standard_patterns.expect("local pattern facts");
        assert_eq!(facts.live_delivery, "conservative-resnapshot");
        assert_eq!(facts.auth_scope_disjointness_skip, "disabled");
        assert!(
            crate::manifest::CapabilityManifest::cloudflare_do_sqlite_v8_declared()
                .standard_patterns
                .is_none()
        );
    }

    // @ref LLP 0065#3-common-pattern-contracts — defineOwnedKeysetPages'
    //   continuation is an opaque versioned cursor bound to the app, the
    //   pair plan identity, and the caller's authority partition: first
    //   mints, next continues, a short page is terminal, and malformed,
    //   raw-value, cross-pair, cross-owner, and stale-authority
    //   presentations refuse byte-identically with
    //   SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID.
    #[test]
    fn standard_pattern_keyset_cursor_pages_and_refuses_end_to_end() {
        use crate::manifest::{
            FieldManifest, FieldType, IndexManifest, StandardPatternIdentity, TableManifest,
        };
        let table = |name: &str, index: &str| TableManifest {
            name: name.to_owned(),
            fields: vec![
                FieldManifest {
                    name: "ownerId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "pageKey".to_owned(),
                    field_type: FieldType::Integer,
                    optional: false,
                },
            ],
            indexes: vec![IndexManifest {
                name: index.to_owned(),
                fields: vec!["ownerId".to_owned(), "pageKey".to_owned()],
                unique: true,
            }],
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            membership: None,
        };
        let schema = SchemaManifest {
            tables: vec![
                table("pages", "by_owner_page_key"),
                table("others", "by_owner_other_key"),
            ],
            ..SchemaManifest::default()
        };
        let owner_filter = FilterExpr {
            field: "ownerId".to_owned(),
            op: FilterOp::Eq,
            value: ValueExpr::AuthUserId,
        };
        let keyset_pair = |table: &str, index: &str, first: &str, next: &str| {
            let base_plan = |with_cursor: bool| QueryPlan {
                table: table.to_owned(),
                filters: if with_cursor {
                    vec![
                        owner_filter.clone(),
                        FilterExpr {
                            field: "pageKey".to_owned(),
                            op: FilterOp::Gt,
                            value: ValueExpr::Arg("after".to_owned()),
                        },
                    ]
                } else {
                    vec![owner_filter.clone()]
                },
                membership_filters: Vec::new(),
                order: vec![crate::manifest::OrderExpr {
                    field: "pageKey".to_owned(),
                    direction: crate::manifest::OrderDirection::Asc,
                }],
                limit: Some(2),
                indexed_by: Some(index.to_owned()),
            };
            let pattern = || {
                Some(StandardPatternIdentity {
                    helper: "owned-keyset-pages.v1".to_owned(),
                    profile: "owner.v1".to_owned(),
                })
            };
            let mut first_def = FunctionDefinition::new(
                first,
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::Query(base_plan(false))),
            );
            first_def.standard_pattern = pattern();
            let mut next_def = FunctionDefinition::new(
                next,
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::Query(base_plan(true))),
            );
            next_def.standard_pattern = pattern();
            [first_def, next_def]
        };
        let [first_pages, next_pages] =
            keyset_pair("pages", "by_owner_page_key", "firstPages", "nextPages");
        let [first_other, next_other] =
            keyset_pair("others", "by_owner_other_key", "firstOther", "nextOther");

        let mut snapback = LocalSnapback::memory().expect("memory keyset fixture");
        snapback.apply_schema(schema).expect("apply keyset schema");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![first_pages, next_pages, first_other, next_other],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics
                .iter()
                .all(|d| d.severity != crate::diagnostic::DiagnosticSeverity::Error),
            "keyset fixture must activate: {diagnostics:?}"
        );
        let row = |owner: &str, key: i64| {
            json!({ "ownerId": owner, "pageKey": key })
                .as_object()
                .cloned()
                .expect("seed row")
        };
        snapback
            .seed(crate::manifest::SeedData {
                tables: BTreeMap::from([
                    (
                        "pages".to_owned(),
                        (1..=5).map(|key| row("user-a", key)).collect(),
                    ),
                    ("others".to_owned(), vec![row("user-a", 1)]),
                ]),
            })
            .expect("seed keyset rows");

        let input = |user: &str, args: Value| HandlerInput {
            args,
            auth: AuthInput {
                user_id: Some(user.to_owned()),
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let keys = |output: &crate::manifest::QueryOutput| {
            output
                .rows
                .iter()
                .map(|row| row["pageKey"].as_i64().expect("page key"))
                .collect::<Vec<_>>()
        };

        // first → [1,2] + cursor; next → [3,4] + cursor; next → [5] terminal.
        let page1 = snapback
            .invoke_query("firstPages", input("user-a", json!({})))
            .expect("first page");
        assert_eq!(keys(&page1), vec![1, 2]);
        let cursor1 = page1.cursor.expect("full first page mints a continuation");
        assert!(
            cursor1.starts_with("sbpc1."),
            "cursor is versioned wire opaque: {cursor1}"
        );
        let page2 = snapback
            .invoke_query("nextPages", input("user-a", json!({ "after": cursor1.clone() })))
            .expect("second page");
        assert_eq!(keys(&page2), vec![3, 4]);
        let cursor2 = page2.cursor.expect("full next page mints a continuation");
        let page3 = snapback
            .invoke_query("nextPages", input("user-a", json!({ "after": cursor2 })))
            .expect("terminal page");
        assert_eq!(keys(&page3), vec![5]);
        assert!(page3.cursor.is_none(), "a short page is terminal");

        // Refusal classes, byte-identical to one another.
        let refusal = |snapback: &LocalSnapback, user: &str, args: Value, function: &str| {
            match snapback.invoke_query(function, input(user, args.clone())) {
                Err(error) => error,
                Ok(output) => panic!(
                    "cursor presentation must refuse: {function} {user} {args} -> {output:?}"
                ),
            }
        };
        let malformed = refusal(
            &snapback,
            "user-a",
            json!({ "after": "sbpc1.garbage" }),
            "nextPages",
        );
        assert_eq!(
            malformed.diagnostic.code,
            "SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID"
        );
        // A raw boundary value — the pre-opaque wire shape — is refused, not
        // silently honored: pagination is cursor-in, cursor-out only.
        let raw_value = refusal(&snapback, "user-a", json!({ "after": 2 }), "nextPages");
        // Cross-pair: a pages cursor presented to the others pair.
        let cross_pair = refusal(
            &snapback,
            "user-a",
            json!({ "after": cursor1.clone() }),
            "nextOther",
        );
        // Cross-owner: another caller presents the cursor.
        let cross_owner = refusal(
            &snapback,
            "user-b",
            json!({ "after": cursor1.clone() }),
            "nextPages",
        );
        // Stale authority: the caller's permission-scope epoch rolled.
        snapback
            .permission_epochs
            .insert(super::user_permission_scope("user-a"), 3);
        let stale = refusal(&snapback, "user-a", json!({ "after": cursor1 }), "nextPages");
        for refused in [&raw_value, &cross_pair, &cross_owner, &stale] {
            assert_eq!(
                (
                    refused.diagnostic.code.as_str(),
                    refused.diagnostic.message.as_str()
                ),
                (
                    malformed.diagnostic.code.as_str(),
                    malformed.diagnostic.message.as_str()
                ),
                "every standard-pattern cursor refusal class is byte-indistinguishable",
            );
        }
    }

    #[test]
    fn retirement_at_local_query_and_action_handoff_suppresses_results() {
        let mut snapback = result_handoff_snapback();
        let query_controller = snapback.admission.clone();
        BEFORE_QUERY_RESULT_HANDOFF_HOOK.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                assert_eq!(
                    query_controller
                        .retire_current_epoch_for_test()
                        .unwrap_err()
                        .diagnostic
                        .code,
                    "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT"
                );
            }));
        });
        assert_eq!(
            snapback
                .invoke_query("listItems", HandlerInput::default())
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_MODE_PENDING"
        );

        let action_controller = snapback.admission.clone();
        BEFORE_ACTION_RESULT_HANDOFF_HOOK.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                assert_eq!(
                    action_controller
                        .retire_current_epoch_for_test()
                        .unwrap_err()
                        .diagnostic
                        .code,
                    "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT"
                );
            }));
        });
        assert_eq!(
            snapback
                .run_app_action("emptyAction", HandlerInput::default())
                .diagnostic
                .expect("retired action result")
                .code,
            "SNAPBACK_AUTH_MODE_PENDING"
        );
    }

    fn config_verify_gate_snapback() -> LocalSnapback {
        let mut probe = FunctionDefinition::new(
            "configProbe",
            FunctionKind::Action,
            FunctionRuntime::HostPlan(HandlerPlan::Action(ActionPlan {
                steps: Vec::new(),
                return_value: None,
            })),
        );
        probe.uses = vec!["gateKey".to_owned()];
        let mut snapback = LocalSnapback::memory().expect("memory config verify gate fixture");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![probe],
            config: vec![ConfigEntryDefinition {
                name: "gateKey".to_owned(),
                description: None,
                purpose: None,
                secret: true,
                required: false,
                pool: false,
                probe: Some("configProbe".to_owned()),
                how_to_get: None,
                acquisition: None,
                default: None,
                source_span: None,
            }],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics
                .iter()
                .all(|diagnostic| diagnostic.severity
                    != crate::diagnostic::DiagnosticSeverity::Error),
            "config verify gate fixture must load: {diagnostics:?}"
        );
        snapback
            .set_config_entry("gateKey", vec!["secret".to_owned()], false, "test")
            .expect("set config fixture value");
        snapback
    }

    #[test]
    fn config_verify_admission_precedes_cooldown_and_retirement_suppresses_finish() {
        let mut snapback = config_verify_gate_snapback();
        let guard = snapback.admission.begin_transition().unwrap();
        let Err(error) = snapback.stage_config_verify("gateKey") else {
            panic!("closed config verification must fail before staging");
        };
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_MODE_PENDING");
        drop(guard);

        let stage = match snapback
            .stage_config_verify("gateKey")
            .expect("closed attempt did not claim cooldown")
        {
            super::StagedConfigVerify::Ready(stage) => stage,
            super::StagedConfigVerify::Done(_) => panic!("valid probe must stage"),
        };
        let admission = stage.admission.clone();
        let revision = stage.entry_revision;
        let started = stage.started_ms;
        drop(stage);
        let diagnostics_before = snapback.recent_diagnostics.len();
        assert!(snapback.config.entry("gateKey").unwrap().verified.is_none());
        let controller = snapback.admission.clone();
        BEFORE_CONFIG_VERIFY_PUBLICATION_HOOK.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                assert_eq!(
                    controller
                        .retire_current_epoch_for_test()
                        .unwrap_err()
                        .diagnostic
                        .code,
                    "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT"
                );
            }));
        });
        assert_eq!(
            snapback
                .finish_config_verify(
                    "gateKey",
                    revision,
                    started,
                    Ok(json!({ "ok": true })),
                    admission,
                )
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_MODE_PENDING"
        );
        assert!(snapback.config.entry("gateKey").unwrap().verified.is_none());
        assert_eq!(snapback.recent_diagnostics.len(), diagnostics_before);
    }

    #[test]
    fn legacy_local_and_read_lane_apis_reject_settled_sessions_mode() {
        let mut snapback = LocalSnapback::memory().expect("memory snapback");
        snapback
            .synchronize_auth_mode_admission(&settled_sessions_state())
            .expect("publish exact Sessions mode");

        let assert_mode_rejection = |error: crate::diagnostic::SnapbackError| {
            assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_POLICY_UNAVAILABLE");
        };
        assert_mode_rejection(
            snapback
                .invoke_query("missing", HandlerInput::default())
                .unwrap_err(),
        );
        assert_mode_rejection(
            snapback
                .invoke_mutation("missing", HandlerInput::default())
                .unwrap_err(),
        );
        assert_mode_rejection(
            snapback
                .dry_run_mutation("missing", HandlerInput::default())
                .unwrap_err(),
        );
        assert_eq!(
            snapback
                .run_function("missing", HandlerInput::default())
                .diagnostic
                .expect("runner rejection")
                .code,
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );
        assert_eq!(
            snapback
                .run_app_action("missing", HandlerInput::default())
                .diagnostic
                .expect("action rejection")
                .code,
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );
        assert_mode_rejection(
            snapback
                .read_lane()
                .invoke_query("missing", HandlerInput::default())
                .unwrap_err(),
        );
    }

    #[test]
    fn authority_generation_counters_refuse_before_wrap_or_reuse() {
        let counter = AtomicU64::new(u64::MAX - 1);
        assert_eq!(reserve_unique_generation(&counter).unwrap(), u64::MAX - 1);
        assert_eq!(counter.load(Ordering::Relaxed), u64::MAX);
        assert_eq!(
            reserve_unique_generation(&counter)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_APP_GENERATION_EXHAUSTED"
        );
        assert_eq!(counter.load(Ordering::Relaxed), u64::MAX);
        assert_eq!(
            next_secret_read_reset_generation(u64::MAX)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_ADMIN_SECRET_READ_GENERATION_EXHAUSTED"
        );
    }

    fn reload_schema(hash: &str, include_extra: bool) -> SchemaManifest {
        let fields = vec![FieldManifest {
            name: "value".to_owned(),
            field_type: FieldType::String,
            optional: false,
        }];
        let mut tables = vec![TableManifest {
            name: "items".to_owned(),
            fields,
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            membership: None,
        }];
        if include_extra {
            tables.push(TableManifest {
                name: "new_items".to_owned(),
                fields: vec![FieldManifest {
                    name: "extra".to_owned(),
                    field_type: FieldType::Boolean,
                    optional: true,
                }],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                membership: None,
            });
        }
        SchemaManifest {
            schema_hash: Some(hash.to_owned()),
            tables,
            ..SchemaManifest::default()
        }
    }

    fn reload_functions() -> FunctionManifest {
        let define = |name: &str| {
            FunctionDefinition::new(
                name,
                FunctionKind::Mutation,
                FunctionRuntime::IbexModule(IbexModule {
                    source: SCHEMA_RELOAD_SOURCE.to_owned(),
                    export: name.to_owned(),
                }),
            )
        };
        FunctionManifest {
            functions: vec![define("insertOld"), define("readNewTable")],
            ..FunctionManifest::default()
        }
    }

    fn guarded_functions() -> FunctionManifest {
        let mut values = BTreeMap::new();
        values.insert("value".to_owned(), ValueExpr::Literal(json!("guarded")));
        FunctionManifest {
            functions: vec![
                FunctionDefinition::new(
                    "hostInsert",
                    FunctionKind::Mutation,
                    FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                        steps: vec![MutationStep::Insert {
                            table: "items".to_owned(),
                            values,
                            bind_id_as: None,
                        }],
                        return_value: Some(ReturnValue::ChangedCount),
                    })),
                ),
                FunctionDefinition::new(
                    "ibexInsert",
                    FunctionKind::Mutation,
                    FunctionRuntime::IbexModule(IbexModule {
                        source: "globalThis.__snapbackHandlers = { async ibexInsert() { return null; } };"
                            .to_owned(),
                        export: "ibexInsert".to_owned(),
                    }),
                ),
            ],
            ..FunctionManifest::default()
        }
    }

    fn guarded_snapback() -> LocalSnapback {
        let mut snapback = LocalSnapback::memory().expect("memory snapback");
        snapback
            .apply_schema(reload_schema("guarded-schema", false))
            .expect("apply guarded schema");
        snapback.load_functions(guarded_functions());
        snapback
    }

    fn permission_epoch_guarded_snapback() -> LocalSnapback {
        let mut snapback = LocalSnapback::memory().expect("memory snapback");
        snapback
            .apply_schema(reload_schema("permission-epoch-guarded", false))
            .expect("apply guarded schema");
        let mut functions = guarded_functions();
        for function in &mut functions.functions {
            function.permission_epoch_bumps =
                vec![PermissionScopeExpr::Literal("permission:test".to_owned())];
        }
        snapback.load_functions(functions);
        snapback
    }

    fn session_authority(authority_instance_id: &str) -> PreparedAuthority {
        InvocationGate::prepare_authority(
            InvocationSource::HttpMutation,
            crate::manifest::AuthMode::Sessions,
            ServerProfile::Test,
            1,
            1,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::Session {
                user_id: "018f0d90-7b21-7a22-8c33-445566778899".to_owned(),
                session_id: "018f0d90-7b22-7a22-8c33-445566778899".to_owned(),
                provider: "email-code".to_owned(),
                generation: 1,
                authority_instance_id: authority_instance_id.to_owned(),
                session_not_after_ms: 10_000,
                provider_not_after_ms: None,
            },
        )
        .expect("prepare session authority")
    }

    fn descriptor(authority_instance_id: &str) -> AuthorityDescriptor {
        AuthorityDescriptor {
            descriptor_version: 1,
            authority_instance_id: authority_instance_id.to_owned(),
            session_generation: 1,
        }
    }

    const SERVICE_REPLAY_EXPIRES_AT_MS: u64 = 2_000_000_000_000;

    fn install_service_replay_auth(snapback: &mut LocalSnapback) {
        let now_ms = now_millis();
        let db = snapback.auth_database_mut();
        db.activate_current_auth_catalog()
            .expect("activate service replay auth catalog");
        db.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES('user-a', ?1, 'human', NULL, NULL, NULL, NULL, NULL)",
                rusqlite::params![now_ms as i64],
            )?;
            tx.execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES('agent-a', ?1, 'agent', 'Agent A', NULL, 'test', NULL, NULL)",
                rusqlite::params![now_ms as i64],
            )?;
            tx.execute(
                "INSERT INTO _auth_agent_credentials(
                   id, user_id, secret_hash, generation, created_at_ms,
                   rotated_at_ms, last_used_at_ms, revoked_at_ms
                 ) VALUES('credential-a', 'agent-a', ?1, 1, ?2, ?2, ?2, NULL)",
                rusqlite::params![vec![0x41_u8; 32], now_ms as i64],
            )?;
            tx.execute(
                "INSERT INTO _auth_scope_bases(
                   function_id, kind, generation, present, authority_creating
                 ) VALUES('fn:hostInsert', 'mutation', 0, 1, 0)",
                [],
            )?;
            for grant_id in ["grant-a", "grant-b"] {
                tx.execute(
                    "INSERT INTO _auth_grants(
                       id, actor_user_id, effective_user_id, scopes, created_at_ms,
                       expires_at_ms, revoked_at_ms, created_by, request_id,
                       consent_digest, last_used_at_ms
                     ) VALUES(?1, 'agent-a', 'user-a', ?2, ?3, ?4, NULL,
                              'test', NULL, NULL, ?3)",
                    rusqlite::params![
                        grant_id,
                        r#"[{"fn":"fn:hostInsert","kind":"mutation","basis":0,"authorityCreating":false}]"#,
                        now_ms as i64,
                        SERVICE_REPLAY_EXPIRES_AT_MS as i64,
                    ],
                )?;
            }
            for (index, (token_id, grant_id)) in [
                ("token-a", "grant-a"),
                ("token-b", "grant-a"),
                ("token-c", "grant-a"),
                ("token-e", "grant-b"),
                ("token-x", "grant-b"),
                ("token-y", "grant-a"),
            ]
            .into_iter()
            .enumerate()
            {
                tx.execute(
                    "INSERT INTO _auth_grant_tokens(
                       id, token_hash, grant_id, credential_id,
                       credential_generation, created_at_ms, expires_at_ms,
                       revoked_at_ms
                     ) VALUES(?1, ?2, ?3, 'credential-a', 1, ?4, ?5, NULL)",
                    rusqlite::params![
                        token_id,
                        vec![u8::try_from(index + 1).expect("small token fixture index"); 32],
                        grant_id,
                        now_ms as i64,
                        SERVICE_REPLAY_EXPIRES_AT_MS as i64,
                    ],
                )?;
            }
            Ok(())
        })
        .expect("install current service replay authority");
    }

    fn service_mutation_authority(
        service_fences: &crate::auth::service_fence::ServiceAuthorityFenceRegistry,
        token_id: &str,
        credential_generation: u64,
        grant_id: &str,
    ) -> PreparedAuthority {
        let resolved = crate::storage::auth_agent_credentials::ResolvedScopedToken {
            token_id: token_id.to_owned(),
            grant_id: grant_id.to_owned(),
            actor_user_id: "agent-a".to_owned(),
            effective_user_id: Some("user-a".to_owned()),
            credential_id: "credential-a".to_owned(),
            credential_generation,
            scopes: vec![crate::storage::auth_grants::ExactGrantScope {
                function_id: "fn:hostInsert".to_owned(),
                kind: crate::storage::auth_grants::ScopedFunctionKind::Mutation,
                basis: 0,
                authority_creating: false,
            }],
            expires_at_ms: SERVICE_REPLAY_EXPIRES_AT_MS,
            grant_expires_at_ms: Some(SERVICE_REPLAY_EXPIRES_AT_MS),
        };
        let publication = service_fences
            .register(
                crate::auth::service_fence::ServiceAuthorityWitness::from_resolved(&resolved),
                now_millis(),
                Instant::now(),
            )
            .expect("register service replay token fence");
        InvocationGate::prepare_authority(
            InvocationSource::HttpMutation,
            crate::manifest::AuthMode::Sessions,
            ServerProfile::Test,
            1,
            1,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::from_scoped_token(resolved),
        )
        .expect("prepare service authority")
        .with_service_publication(publication)
    }

    #[test]
    fn dynamic_ephemeral_registration_preserves_permission_projection_closure() {
        let mut snapback = LocalSnapback::memory().expect("memory snapback");
        snapback
            .apply_schema(SchemaManifest {
                tables: vec![TableManifest {
                    name: "memberships".to_owned(),
                    fields: vec![
                        FieldManifest {
                            name: "gameId".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                        FieldManifest {
                            name: "userId".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                    ],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: true,
                    permission_fields: Some(vec!["gameId".to_owned()]),
                    membership: None,
                }],
                ..SchemaManifest::default()
            })
            .expect("apply permission-backing table");
        let inconsistent =
            crate::ephemeral::EphemeralCollection::local_cursor("gamePresence", "gameId")
                .require_room_permission("game")
                .permission_backed_by(crate::ephemeral::RoomPermissionProjection {
                    table: "memberships".to_owned(),
                    subject_field: "userId".to_owned(),
                    scope_fields: BTreeMap::from([("gameId".to_owned(), "gameId".to_owned())]),
                });

        let register_error = snapback
            .register_ephemeral_collection(inconsistent.clone())
            .expect_err("dynamic registration cannot bypass permissionFields closure");
        assert_eq!(
            register_error.code,
            crate::ephemeral::EphemeralErrorCode::IncompatibleCollectionDefinition
        );
        let ensure_error = snapback
            .ensure_ephemeral_collections(vec![inconsistent])
            .expect_err("dynamic ensure cannot bypass permissionFields closure");
        assert_eq!(
            ensure_error.code,
            crate::ephemeral::EphemeralErrorCode::IncompatibleCollectionDefinition
        );
    }

    #[test]
    fn queued_mutation_descriptor_is_enforced_before_first_and_duplicate_effects() {
        const FIRST: &str = "018f0d90-7b24-7a22-8c33-445566778899";
        const SECOND: &str = "018f0d90-7b25-7a22-8c33-445566778899";
        let mut snapback = guarded_snapback();

        for supplied in [None, Some(descriptor(SECOND))] {
            let (result, _) = snapback.invoke_mutation_recording_with_authority_descriptor(
                "hostInsert",
                input(),
                Some("cm_first_delivery".to_owned()),
                supplied,
                "http",
                session_authority(FIRST),
            );
            assert_eq!(
                result.expect_err("stale first delivery").diagnostic.code,
                "SNAPBACK_AUTH_STALE_RESULT"
            );
            assert_eq!(snapback.durable_version().unwrap(), 0);
            assert_eq!(snapback.db.scan_table("items", 10, 0).unwrap().total, 0);
        }

        snapback
            .invoke_mutation_recording_with_authority_descriptor(
                "hostInsert",
                input(),
                Some("cm_first_delivery".to_owned()),
                Some(descriptor(FIRST)),
                "http",
                session_authority(FIRST),
            )
            .0
            .expect("matching first delivery");
        assert_eq!(snapback.durable_version().unwrap(), 1);

        let stale_with_ack = snapback
            .invoke_mutation_recording_with_authority_descriptor_and_acknowledgements(
                "hostInsert",
                input(),
                Some("cm_stale_ack_carrier".to_owned()),
                Some(descriptor(SECOND)),
                &["cm_first_delivery".to_owned()],
                "http",
                session_authority(FIRST),
            )
            .expect_err("descriptor mismatch must precede piggyback ACK and receipt");
        assert_eq!(stale_with_ack.diagnostic.code, "SNAPBACK_AUTH_STALE_RESULT");
        snapback
            .invoke_mutation_recording_with_authority_descriptor(
                "hostInsert",
                input(),
                Some("cm_first_delivery".to_owned()),
                Some(descriptor(FIRST)),
                "http",
                session_authority(FIRST),
            )
            .0
            .expect("stale carrier did not consume the existing settlement");
        assert_eq!(
            snapback.db.scan_table("items", 10, 0).unwrap().total,
            1,
            "duplicate settlement must remain after a stale piggyback carrier"
        );

        let duplicate = snapback
            .invoke_mutation_recording_with_authority_descriptor(
                "hostInsert",
                input(),
                Some("cm_first_delivery".to_owned()),
                Some(descriptor(SECOND)),
                "http",
                session_authority(SECOND),
            )
            .0
            .expect_err("settlement belongs to the first authority instance");
        assert_eq!(duplicate.diagnostic.code, "SNAPBACK_AUTH_STALE_RESULT");
        assert_eq!(
            duplicate.diagnostic.details["reason"],
            "authority_instance_mismatch"
        );
        assert_eq!(snapback.durable_version().unwrap(), 1);
        assert_eq!(snapback.db.scan_table("items", 10, 0).unwrap().total, 1);
    }

    #[test]
    fn service_queued_replay_survives_token_churn_and_refuses_durable_axis_drift() {
        const INCARNATION: &str = "018f0d90-7b21-7a22-8c33-445566778899";
        let mut snapback = guarded_snapback();
        install_service_replay_auth(&mut snapback);
        let service_fences = snapback.db.service_authority_fence_registry();
        let first = service_mutation_authority(&service_fences, "token-a", 1, "grant-a");
        let descriptor = crate::auth::descriptor::descriptor_for_resolved_authority(
            first.resolved(),
            INCARNATION,
        )
        .expect("service descriptor");

        let first_result = snapback
            .invoke_mutation_recording_with_authority_descriptor(
                "hostInsert",
                input(),
                Some("cm_service_token_churn".to_owned()),
                Some(descriptor.clone()),
                "http",
                service_mutation_authority(&service_fences, "token-b", 1, "grant-a"),
            )
            .0
            .expect("replacement token settles queued work");
        let duplicate = snapback
            .invoke_mutation_recording_with_authority_descriptor(
                "hostInsert",
                input(),
                Some("cm_service_token_churn".to_owned()),
                Some(descriptor.clone()),
                "http",
                service_mutation_authority(&service_fences, "token-c", 1, "grant-a"),
            )
            .0
            .expect("another token reads the durable settlement");
        assert_eq!(duplicate.result, first_result.result);
        assert_eq!(snapback.db.scan_table("items", 10, 0).unwrap().total, 1);
        assert_eq!(
            snapback
                .acknowledge_client_mutations_with_authority(
                    &service_mutation_authority(&service_fences, "token-x", 1, "grant-b"),
                    &["cm_service_token_churn".to_owned()],
                )
                .unwrap(),
            0,
            "another durable grant cannot acknowledge this settlement"
        );
        assert_eq!(
            snapback
                .acknowledge_client_mutations_with_authority(
                    &service_mutation_authority(&service_fences, "token-y", 1, "grant-a"),
                    &["cm_service_token_churn".to_owned()],
                )
                .unwrap(),
            1,
            "token churn on the same durable grant can acknowledge"
        );

        for (authority, expected_code) in [
            (
                service_mutation_authority(&service_fences, "token-d", 2, "grant-a"),
                "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
            ),
            (
                service_mutation_authority(&service_fences, "token-e", 1, "grant-b"),
                "SNAPBACK_AUTH_STALE_RESULT",
            ),
        ] {
            let result = snapback
                .invoke_mutation_recording_with_authority_descriptor(
                    "hostInsert",
                    input(),
                    Some("cm_service_drift".to_owned()),
                    Some(descriptor.clone()),
                    "http",
                    authority,
                )
                .0
                .expect_err("durable authority drift is stale");
            assert_eq!(result.diagnostic.code, expected_code);
        }
        assert_eq!(snapback.db.scan_table("items", 10, 0).unwrap().total, 1);
    }

    fn live_limit_snapback() -> LocalSnapback {
        let mut snapback = LocalSnapback::memory().expect("memory snapback");
        snapback
            .apply_schema(SchemaManifest {
                schema_hash: Some("live-limits-schema".to_owned()),
                tables: vec![TableManifest {
                    name: "items".to_owned(),
                    fields: vec![FieldManifest {
                        name: "value".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    }],
                    indexes: vec![IndexManifest {
                        name: "by_value".to_owned(),
                        fields: vec!["value".to_owned()],
                        unique: false,
                    }],
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    membership: None,
                }],
                ..SchemaManifest::default()
            })
            .expect("apply live limit schema");
        let list = FunctionDefinition::new(
            "listItems",
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table: "items".to_owned(),
                filters: Vec::new(),
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            })),
        );
        let requires_arg = FunctionDefinition::new(
            "listItemsByValue",
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table: "items".to_owned(),
                filters: vec![FilterExpr {
                    field: "value".to_owned(),
                    op: FilterOp::Eq,
                    value: ValueExpr::Arg("value".to_owned()),
                }],
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: Some("by_value".to_owned()),
            })),
        );
        let mut insert_values = BTreeMap::new();
        insert_values.insert("value".to_owned(), ValueExpr::Arg("value".to_owned()));
        let insert = FunctionDefinition::new(
            "insertItem",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                steps: vec![MutationStep::Insert {
                    table: "items".to_owned(),
                    values: insert_values,
                    bind_id_as: None,
                }],
                return_value: Some(ReturnValue::ChangedCount),
            })),
        );
        let delete = FunctionDefinition::new(
            "deleteItem",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                steps: vec![MutationStep::Delete {
                    table: "items".to_owned(),
                    id: ValueExpr::Arg("id".to_owned()),
                }],
                return_value: Some(ReturnValue::ChangedCount),
            })),
        );
        let diagnostics = snapback.load_functions(FunctionManifest {
            bundle_hash: Some("live-limits-functions".to_owned()),
            functions: vec![list, requires_arg, insert, delete],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics
                .iter()
                .all(|diagnostic| { diagnostic.code == "SNAPBACK_IBEX_CLI_UNAVAILABLE" }),
            "unexpected function diagnostics: {diagnostics:?}"
        );
        snapback
    }

    fn live_limit_input(connection_id: &str, args: serde_json::Value) -> LiveSubscribeInput {
        LiveSubscribeInput {
            connection_id: connection_id.to_owned(),
            input: HandlerInput {
                args,
                ..HandlerInput::default()
            },
            authorization_namespace: None,
            supersedes: None,
            resume_from_token: None,
        }
    }

    fn install_test_invalidation(
        snapback: &mut LocalSnapback,
    ) -> AuthorizationInvalidationConnection {
        let (authorization, version_stream, boot_sequence) = snapback
            .auth_database_mut()
            .reserve_invalidation_boot_issuer()
            .expect("reserve test issuer");
        let issuer_id = crate::auth::invalidation::IssuerId::fresh(
            authorization.incarnation.clone(),
            boot_sequence,
        )
        .expect("test issuer id");
        let authenticator =
            crate::auth::invalidation::IssuerAuthenticator::new("test-protocol-key", [0x5a; 32])
                .expect("test authenticator");
        let authenticated = authenticator
            .authenticate(issuer_id, "test-target", "test-app")
            .expect("authenticate test issuer");
        let issuer = LiveInvalidationIssuer::with_authenticator(
            authenticated,
            authenticator,
            "test-target",
            "test-app",
        )
        .expect("live test issuer");
        let descriptor = AuthorizationInvalidationConnection {
            protocol_version: crate::auth::invalidation::AUTH_INVALIDATION_PROTOCOL_VERSION,
            issuer_id: issuer.authenticated().issuer_id.clone(),
            connection_generation: issuer
                .reserve_connection_generation()
                .expect("test connection generation"),
            authorization: authorization.clone(),
            version_stream: version_stream.clone(),
            issuer_retirement: None,
        };
        snapback
            .install_auth_invalidation(issuer, authorization, version_stream)
            .expect("install test invalidation");
        descriptor
    }

    fn test_authorization_namespace(instance: u64) -> QueryNamespace {
        QueryNamespace {
            client_store_id: "store_test".to_owned(),
            query_key: "listItems:{}".to_owned(),
            query_instance_id: instance,
        }
    }

    fn test_session_authority(source: InvocationSource) -> PreparedAuthority {
        InvocationGate::prepare_authority(
            source,
            AuthMode::Sessions,
            ServerProfile::Test,
            0,
            0,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::Anonymous,
        )
        .expect("prepare exact test session authority")
    }

    fn test_live_session_authority(
        source: InvocationSource,
        user_id: &str,
        generation: u64,
        session_not_after_ms: u64,
        provider_not_after_ms: Option<u64>,
    ) -> PreparedAuthority {
        InvocationGate::prepare_authority(
            source,
            AuthMode::Sessions,
            ServerProfile::Test,
            0,
            0,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::Session {
                user_id: user_id.to_owned(),
                session_id: "live-owner-session".to_owned(),
                provider: "email-code".to_owned(),
                generation,
                authority_instance_id: "live-owner-authority".to_owned(),
                session_not_after_ms,
                provider_not_after_ms,
            },
        )
        .expect("prepare retained live session authority")
    }

    fn test_dev_authority(source: InvocationSource) -> PreparedAuthority {
        InvocationGate::prepare_authority(
            source,
            AuthMode::Dev,
            ServerProfile::Test,
            0,
            0,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::dev_from_auth(&AuthInput::default()),
        )
        .expect("prepare exact test dev authority")
    }

    fn test_session_admission() -> crate::auth::admission::AdmissionLease {
        test_session_authority(InvocationSource::LiveInitialQuery)
            .admission_lease()
            .clone()
    }

    fn managed_session_admission() -> crate::auth::admission::AdmissionLease {
        AdmissionController::from_mode_state(&settled_sessions_state())
            .expect("managed Sessions admission controller")
            .admit_for_mode(AuthMode::Sessions)
            .expect("managed Sessions admission")
    }

    fn invoke_test_session_mutation(
        snapback: &mut LocalSnapback,
        name: &str,
        input: HandlerInput,
    ) -> crate::diagnostic::SnapbackResult<crate::manifest::MutationOutput> {
        snapback.invoke_mutation_with_authority(
            name,
            input,
            test_session_authority(InvocationSource::HttpMutation),
        )
    }

    fn two_pending_projection_fixture(
        connection_id: &str,
    ) -> (LocalSnapback, AuthorizationInvalidationConnection) {
        let mut snapback = live_limit_snapback();
        snapback
            .invoke_mutation(
                "insertItem",
                HandlerInput {
                    args: json!({ "value": "visible" }),
                    ..HandlerInput::default()
                },
            )
            .expect("insert projection fixture row");
        let row_id = snapback
            .invoke_query("listItems", HandlerInput::default())
            .expect("query projection fixture row")
            .rows[0]["_id"]
            .as_str()
            .expect("row id")
            .to_owned();
        let connection = install_test_invalidation(&mut snapback);
        for instance in [70, 71] {
            snapback
                .subscribe_live_with_invalidation(
                    "listItems",
                    LiveSubscribeInput {
                        connection_id: connection_id.to_owned(),
                        input: HandlerInput::default(),
                        authorization_namespace: Some(test_authorization_namespace(instance)),
                        supersedes: None,
                        resume_from_token: None,
                    },
                    LiveInvalidationAdmission {
                        session_mode: true,
                        connection: Some(connection.clone()),
                        effect_fence: None,
                    },
                )
                .expect("install auth-scoped projection fixture");
        }
        invoke_test_session_mutation(
            &mut snapback,
            "deleteItem",
            HandlerInput {
                args: json!({ "id": row_id }),
                ..HandlerInput::default()
            },
        )
        .expect("raise projection obligations");
        (snapback, connection)
    }

    #[test]
    fn session_live_requires_installed_and_negotiated_invalidation() {
        let mut snapback = live_limit_snapback();
        let input = LiveSubscribeInput {
            connection_id: "session-capability".to_owned(),
            input: HandlerInput::default(),
            authorization_namespace: Some(test_authorization_namespace(1)),
            supersedes: None,
            resume_from_token: None,
        };
        let unavailable = snapback
            .subscribe_live_with_invalidation(
                "listItems",
                input.clone(),
                LiveInvalidationAdmission {
                    session_mode: true,
                    ..LiveInvalidationAdmission::default()
                },
            )
            .expect_err("missing server invalidation is unavailable");
        assert_eq!(
            unavailable.diagnostic.code,
            "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE"
        );

        let connection = install_test_invalidation(&mut snapback);
        let unsupported = snapback
            .subscribe_live_with_invalidation(
                "listItems",
                input.clone(),
                LiveInvalidationAdmission {
                    session_mode: true,
                    ..LiveInvalidationAdmission::default()
                },
            )
            .expect_err("legacy session client is refused");
        assert_eq!(
            unsupported.diagnostic.code,
            "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED"
        );

        let subscribed = snapback
            .subscribe_live_with_invalidation(
                "listItems",
                input,
                LiveInvalidationAdmission {
                    session_mode: true,
                    connection: Some(connection),
                    effect_fence: None,
                },
            )
            .expect("negotiated session subscription");
        assert!(matches!(
            subscribed.authorization_scope,
            Some(ScopeId::Subscription { .. })
        ));
    }

    #[test]
    fn auth_scoped_removal_is_atomic_obligation_and_exact_ack() {
        let mut snapback = live_limit_snapback();
        snapback
            .invoke_mutation(
                "insertItem",
                HandlerInput {
                    args: json!({ "value": "visible" }),
                    ..HandlerInput::default()
                },
            )
            .expect("insert visible row");
        let row_id = snapback
            .invoke_query("listItems", HandlerInput::default())
            .expect("query inserted row")
            .rows[0]["_id"]
            .as_str()
            .expect("row id")
            .to_owned();
        let connection = install_test_invalidation(&mut snapback);
        let admission = managed_session_admission();
        let subscribed = snapback
            .subscribe_live_with_invalidation(
                "listItems",
                LiveSubscribeInput {
                    connection_id: "session-remove".to_owned(),
                    input: HandlerInput::default(),
                    authorization_namespace: Some(test_authorization_namespace(2)),
                    supersedes: None,
                    resume_from_token: None,
                },
                LiveInvalidationAdmission {
                    session_mode: true,
                    connection: Some(connection.clone()),
                    effect_fence: None,
                },
            )
            .expect("auth-scoped subscription");
        assert!(drain_live_stream_through_test_sink(&mut snapback, "session-remove").is_empty());

        invoke_test_session_mutation(
            &mut snapback,
            "deleteItem",
            HandlerInput {
                args: json!({ "id": row_id }),
                ..HandlerInput::default()
            },
        )
        .expect("delete visible row");
        let messages = drain_live_stream_through_test_sink(&mut snapback, "session-remove");
        let frame = messages
            .iter()
            .filter_map(|message| serde_json::from_str::<Value>(message).ok())
            .find(|message| message["kind"] == "authorization_invalidation")
            .expect("obligation-backed removal frame");
        assert_eq!(frame["obligation"]["maxDisposition"], "quarantine");
        assert_eq!(frame["resolution"]["kind"], "snapshot");
        assert_eq!(frame["snapshot"]["rows"], json!([]));
        assert!(
            messages
                .iter()
                .all(|message| !message.contains("\"kind\":\"live_delta\"")),
            "negative auth delta must not escape as best-effort live_delta"
        );
        snapback
            .reproject_authorization_invalidations("session-remove", &admission)
            .expect("reproject pending truth");
        let hint = drain_live_stream_through_test_sink(&mut snapback, "session-remove")
            .into_iter()
            .filter_map(|message| serde_json::from_str::<Value>(&message).ok())
            .find(|message| message["kind"] == "authorization_invalidation")
            .expect("level-triggered obligation hint");
        assert!(
            hint.get("resolution").is_none() && hint.get("snapshot").is_none(),
            "a snapshot resolution must never be projected without its atomic rows"
        );
        let rerun = snapback
            .authorization_invalidation_frames("session-remove", &admission)
            .expect("managed admission reruns pending authorization");
        let rerun = serde_json::from_slice::<Value>(
            &rerun
                .first()
                .expect("managed drain emits the fresh snapshot")
                .payload,
        )
        .expect("managed drain frame JSON");
        assert_eq!(rerun["snapshot"]["rows"], json!([]));
        let ack_token = rerun["resolution"]["ackToken"]
            .as_str()
            .expect("managed rerun ack token")
            .to_owned();
        let ack = snapback
            .acknowledge_authorization_invalidation(
                AuthorizationInvalidationAckInput {
                    connection_id: "session-remove".to_owned(),
                    ack_token: ack_token.clone(),
                },
                connection.clone(),
                &admission,
            )
            .expect("exact ack");
        assert_eq!(ack.outcome, "discharged");
        let duplicate = snapback
            .acknowledge_authorization_invalidation(
                AuthorizationInvalidationAckInput {
                    connection_id: "session-remove".to_owned(),
                    ack_token,
                },
                connection,
                &admission,
            )
            .expect("duplicate ack");
        assert_eq!(duplicate.outcome, "duplicate");
        assert!(
            snapback
                .authorization_invalidation_frames("session-remove", &admission)
                .expect("drain invalidation frames")
                .is_empty(),
            "successful exact ACK discharges the level-triggered projection"
        );
        assert_eq!(
            subscribed
                .authorization_scope
                .expect("subscription scope")
                .validate(),
            Ok(())
        );
    }

    #[test]
    fn overflow_root_waits_for_every_auth_scoped_child() {
        let mut snapback = live_limit_snapback();
        snapback
            .invoke_mutation(
                "insertItem",
                HandlerInput {
                    args: json!({ "value": "visible" }),
                    ..HandlerInput::default()
                },
            )
            .expect("insert visible row");
        let row_id = snapback
            .invoke_query("listItems", HandlerInput::default())
            .expect("query row")
            .rows[0]["_id"]
            .as_str()
            .expect("row id")
            .to_owned();
        let connection = install_test_invalidation(&mut snapback);
        let admission = test_session_admission();
        for instance in [10, 11] {
            snapback
                .subscribe_live_with_invalidation(
                    "listItems",
                    LiveSubscribeInput {
                        connection_id: "session-overflow".to_owned(),
                        input: HandlerInput::default(),
                        authorization_namespace: Some(test_authorization_namespace(instance)),
                        supersedes: None,
                        resume_from_token: None,
                    },
                    LiveInvalidationAdmission {
                        session_mode: true,
                        connection: Some(connection.clone()),
                        effect_fence: None,
                    },
                )
                .expect("auth-scoped subscription");
        }
        for _ in 0..1_024 {
            snapback
                .ephemeral
                .enqueue_durable("session-overflow", b"{}".to_vec());
        }
        invoke_test_session_mutation(
            &mut snapback,
            "deleteItem",
            HandlerInput {
                args: json!({ "id": row_id }),
                ..HandlerInput::default()
            },
        )
        .expect("delete triggers overflow");
        let overflow = snapback.drain_live_stream("session-overflow");
        let overflow_sentinel_observed = overflow
            .iter()
            .any(|frame| frame.contains("outbox_overflow"));
        assert!(
            overflow_sentinel_observed,
            "bounded queue must expose its overflow sentinel"
        );

        let frames = snapback
            .authorization_invalidation_frames("session-overflow", &admission)
            .expect("drain overflow invalidations");
        assert_eq!(frames.len(), 2, "one exact child per auth-scoped query");
        let tokens = frames
            .iter()
            .map(|frame| serde_json::from_slice::<Value>(&frame.payload).expect("frame JSON"))
            .map(|frame| {
                frame["resolution"]["ackToken"]
                    .as_str()
                    .expect("resolution token")
                    .to_owned()
            })
            .collect::<Vec<_>>();
        snapback
            .acknowledge_authorization_invalidation(
                AuthorizationInvalidationAckInput {
                    connection_id: "session-overflow".to_owned(),
                    ack_token: tokens[0].clone(),
                },
                connection.clone(),
                &admission,
            )
            .expect("first child ack");
        let remaining_after_first_ack = snapback
            .authorization_invalidation_frames("session-overflow", &admission)
            .expect("drain remaining invalidation")
            .len();
        assert_eq!(
            remaining_after_first_ack, 1,
            "one query ACK cannot clear its sibling or the projection root"
        );
        snapback
            .acknowledge_authorization_invalidation(
                AuthorizationInvalidationAckInput {
                    connection_id: "session-overflow".to_owned(),
                    ack_token: tokens[1].clone(),
                },
                connection,
                &admission,
            )
            .expect("second child ack");
        let remaining_after_all_acks = snapback
            .authorization_invalidation_frames("session-overflow", &admission)
            .expect("drain discharged invalidations")
            .len();
        assert_eq!(
            remaining_after_all_acks, 0,
            "root clears only after every current child discharges"
        );
        println!(
            "SNAPBACK_AUTH_ACCEPTANCE_OVERFLOW_RECEIPT={}",
            json!({
                "overflowSentinelObserved": overflow_sentinel_observed,
                "authScopedChildren": tokens.len(),
                "remainingAfterFirstAck": remaining_after_first_ack,
                "remainingAfterAllAcks": remaining_after_all_acks,
            })
        );
    }

    #[test]
    fn aggregate_projection_handoff_is_a_bounded_prefix_and_suffix_stays_pending() {
        let connection_id = "session-projection-prefix";
        let (mut snapback, connection) = two_pending_projection_fixture(connection_id);
        let admission = test_session_admission();
        let full = snapback
            .authorization_invalidation_frames(connection_id, &admission)
            .expect("measure complete pending projection set");
        assert_eq!(full.len(), 2);
        let first_estimate = crate::ephemeral::estimated_durable_handoff_bytes(&full[0]);
        let limit = crate::ephemeral::OUTBOX_HANDOFF_BATCH_OVERHEAD.saturating_add(first_estimate);

        let prefix = snapback
            .authorization_invalidation_frames_with_handoff_limit(connection_id, &admission, limit)
            .expect("bounded projection prefix");
        assert_eq!(prefix.len(), 1, "the second projection is deferred");
        let retained_estimate = prefix.iter().fold(
            crate::ephemeral::OUTBOX_HANDOFF_BATCH_OVERHEAD,
            |total, frame| {
                total.saturating_add(crate::ephemeral::estimated_durable_handoff_bytes(frame))
            },
        );
        assert!(retained_estimate <= limit);
        let projected = serde_json::from_slice::<Value>(&prefix[0].payload).expect("frame JSON");
        let first_token = projected["resolution"]["ackToken"]
            .as_str()
            .expect("first resolution token")
            .to_owned();
        snapback
            .acknowledge_authorization_invalidation(
                AuthorizationInvalidationAckInput {
                    connection_id: connection_id.to_owned(),
                    ack_token: first_token,
                },
                connection,
                &admission,
            )
            .expect("discharge the emitted prefix");

        let suffix = snapback
            .authorization_invalidation_frames_with_handoff_limit(connection_id, &admission, limit)
            .expect("deferred suffix regenerates");
        assert_eq!(suffix.len(), 1, "the deferred sibling remains pending");
    }

    #[test]
    fn one_projection_over_handoff_limit_fails_closed_and_remains_pending() {
        let connection_id = "session-projection-oversized";
        let (mut snapback, _connection) = two_pending_projection_fixture(connection_id);
        let admission = test_session_admission();
        let full = snapback
            .authorization_invalidation_frames(connection_id, &admission)
            .expect("measure pending projection");
        let first_estimate = crate::ephemeral::estimated_durable_handoff_bytes(&full[0]);
        let too_small = crate::ephemeral::OUTBOX_HANDOFF_BATCH_OVERHEAD
            .saturating_add(first_estimate)
            .saturating_sub(1);
        let error = snapback
            .authorization_invalidation_frames_with_handoff_limit(
                connection_id,
                &admission,
                too_small,
            )
            .expect_err("one unsplittable projection must fail closed");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
        assert_eq!(
            snapback
                .authorization_invalidation_frames(connection_id, &admission)
                .expect("failed projection remains level-triggered")
                .len(),
            2
        );
    }

    #[test]
    fn permission_backing_event_quarantines_even_a_positive_delta() {
        let mut snapback = live_limit_snapback();
        snapback
            .apply_schema(SchemaManifest {
                schema_hash: Some("permission-backing-live-schema".to_owned()),
                tables: vec![TableManifest {
                    name: "items".to_owned(),
                    fields: vec![FieldManifest {
                        name: "value".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    }],
                    indexes: vec![IndexManifest {
                        name: "by_value".to_owned(),
                        fields: vec!["value".to_owned()],
                        unique: false,
                    }],
                    syncable: true,
                    permission_backing: true,
                    permission_fields: None,
                    membership: None,
                }],
                ..SchemaManifest::default()
            })
            .expect("mark permission-backing table");
        let connection = install_test_invalidation(&mut snapback);
        let initial_epoch = snapback
            .auth_invalidation
            .as_ref()
            .expect("invalidation state")
            .obligations
            .expectation()
            .authorization
            .epoch;
        snapback
            .subscribe_live_with_invalidation(
                "listItems",
                LiveSubscribeInput {
                    connection_id: "session-permission-event".to_owned(),
                    input: HandlerInput::default(),
                    authorization_namespace: Some(test_authorization_namespace(20)),
                    supersedes: None,
                    resume_from_token: None,
                },
                LiveInvalidationAdmission {
                    session_mode: true,
                    connection: Some(connection),
                    effect_fence: None,
                },
            )
            .expect("auth-scoped subscription");
        invoke_test_session_mutation(
            &mut snapback,
            "insertItem",
            HandlerInput {
                args: json!({ "value": "newly-visible" }),
                ..HandlerInput::default()
            },
        )
        .expect("permission-backing insert");
        let messages = snapback.drain_live_stream("session-permission-event");
        let frame = messages
            .iter()
            .filter_map(|message| serde_json::from_str::<Value>(message).ok())
            .find(|message| message["kind"] == "authorization_invalidation")
            .expect("coarse authorization obligation");
        assert_eq!(frame["obligation"]["maxDisposition"], "quarantine");
        assert_eq!(
            frame["obligation"]["witness"]["authorization"]["epoch"],
            initial_epoch + 1
        );
        assert!(
            messages
                .iter()
                .all(|message| !message.contains("\"kind\":\"live_delta\"")),
            "coarse authorization events override positive-delta best effort"
        );
        let blast_radius = &snapback.live_delivery.authorization_blast_radius;
        assert_eq!(blast_radius.global.version_advances, 1);
        assert_eq!(blast_radius.global.quarantined_subscriptions, 1);
        assert_eq!(blast_radius.global.resnapshots, 1);
        assert!(blast_radius.membership_declarations.is_empty());
    }

    #[test]
    fn blast_radius_counters_attribute_each_membership_declaration_and_global_total() {
        let mut stats = AuthorizationBlastRadiusStats::default();
        let declarations = ["board-members".to_owned(), "org-members".to_owned()];
        stats.for_event(&declarations, |counters| {
            counters.version_advances += 1;
            counters.quarantined_subscriptions += 3;
            counters.resnapshots += 2;
        });

        assert_eq!(stats.global.version_advances, 1);
        assert_eq!(stats.global.quarantined_subscriptions, 3);
        assert_eq!(stats.global.resnapshots, 2);
        assert_eq!(stats.membership_declarations.len(), 2);
        for declaration in declarations {
            assert_eq!(stats.membership_declarations[&declaration], stats.global);
        }
    }

    #[test]
    fn authorization_expectation_advances_without_live_subscribers() {
        let mut snapback = live_limit_snapback();
        snapback
            .apply_schema(SchemaManifest {
                schema_hash: Some("permission-backing-no-live-schema".to_owned()),
                tables: vec![TableManifest {
                    name: "items".to_owned(),
                    fields: vec![FieldManifest {
                        name: "value".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    }],
                    indexes: vec![IndexManifest {
                        name: "by_value".to_owned(),
                        fields: vec!["value".to_owned()],
                        unique: false,
                    }],
                    syncable: true,
                    permission_backing: true,
                    permission_fields: None,
                    membership: None,
                }],
                ..SchemaManifest::default()
            })
            .expect("mark permission-backing table");
        install_test_invalidation(&mut snapback);
        let before = snapback
            .auth_invalidation
            .as_ref()
            .expect("invalidation state")
            .obligations
            .expectation()
            .authorization
            .clone();
        assert!(snapback.subscriptions.is_empty());

        invoke_test_session_mutation(
            &mut snapback,
            "insertItem",
            HandlerInput {
                args: json!({ "value": "authorization-event" }),
                ..HandlerInput::default()
            },
        )
        .expect("permission-backing insert");

        let expected = snapback
            .auth_database_mut()
            .authorization_version()
            .expect("durable authorization version");
        let actual = &snapback
            .auth_invalidation
            .as_ref()
            .expect("invalidation state")
            .obligations
            .expectation()
            .authorization;
        assert_eq!(actual, &expected);
        assert_eq!(actual.epoch, before.epoch + 1);
    }

    #[test]
    fn auth_requery_error_uses_one_durable_three_attempt_episode() {
        let mut snapback = live_limit_snapback();
        let connection = install_test_invalidation(&mut snapback);
        let subscribed = snapback
            .subscribe_live_with_invalidation(
                "listItemsByValue",
                LiveSubscribeInput {
                    connection_id: "session-retry".to_owned(),
                    input: HandlerInput {
                        args: json!({ "value": "target" }),
                        ..HandlerInput::default()
                    },
                    authorization_namespace: Some(QueryNamespace {
                        client_store_id: "store_retry".to_owned(),
                        query_key: "listItemsByValue:{target}".to_owned(),
                        query_instance_id: 30,
                    }),
                    supersedes: None,
                    resume_from_token: None,
                },
                LiveInvalidationAdmission {
                    session_mode: true,
                    connection: Some(connection),
                    effect_fence: None,
                },
            )
            .expect("initial snapshot succeeds");
        snapback
            .subscriptions
            .get_mut(&subscribed.subscription_id)
            .expect("stored subscription")
            .input
            .args = json!({});
        invoke_test_session_mutation(
            &mut snapback,
            "insertItem",
            HandlerInput {
                args: json!({ "value": "target" }),
                ..HandlerInput::default()
            },
        )
        .expect("commit survives fanout failure");
        let scope = subscribed.authorization_scope.expect("auth scope");
        let pending = snapback
            .auth_invalidation
            .as_ref()
            .expect("state")
            .obligations
            .pending(&scope)
            .expect("quarantine obligation")
            .clone();
        assert_eq!(pending.max_disposition, InvalidationDisposition::Quarantine);
        let retry_id = pending
            .retry_episode_id
            .clone()
            .expect("durable retry episode id");
        let episode = snapback
            .auth_database_mut()
            .read_invalidation_retry_registry(|registry| {
                Ok(registry
                    .episodes()
                    .values()
                    .next()
                    .cloned()
                    .expect("stored retry episode"))
            })
            .expect("read retry registry");
        assert_eq!(episode.episode_id, retry_id);
        assert_eq!(
            episode.attempts_reserved,
            crate::auth::invalidation::AUTH_ERROR_ATTEMPTS_TOTAL
        );
        let revision = pending.revision;
        let admission = test_session_admission();
        let frames = snapback
            .authorization_invalidation_frames("session-retry", &admission)
            .expect("drain retry invalidation");
        assert_eq!(frames.len(), 1);
        let still_pending = snapback
            .auth_invalidation
            .as_ref()
            .expect("state")
            .obligations
            .pending(&scope)
            .expect("still quarantined");
        assert_eq!(still_pending.revision, revision);
        assert_eq!(
            still_pending.retry_episode_id.as_deref(),
            Some(retry_id.as_str())
        );
    }

    #[test]
    fn retired_auth_epoch_cannot_commit_retry_registry_state() {
        let mut snapback = live_limit_snapback();
        let _connection = install_test_invalidation(&mut snapback);
        let controller = AdmissionController::from_mode_state(&settled_sessions_state())
            .expect("managed Sessions admission controller");
        let admission = controller
            .admit_for_mode(AuthMode::Sessions)
            .expect("managed Sessions admission");
        assert_eq!(
            controller
                .retire_current_epoch_for_test()
                .expect_err("outstanding admission forces test retirement")
                .diagnostic
                .code,
            "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT"
        );

        let key = RetryEpisodeKey {
            authority_subject: "sha256:retired-subject".to_owned(),
            client_store_id: "store_retired".to_owned(),
            query_key: "listItems:{}".to_owned(),
        };
        let witness = snapback
            .auth_invalidation
            .as_ref()
            .expect("installed invalidation state")
            .witness(0);
        let before = snapback
            .auth_database_mut()
            .read_invalidation_retry_registry(|registry| Ok(registry.episodes().len()))
            .expect("read retry registry");
        let failure = snapback
            .run_authorization_retry_transaction(
                &admission,
                "retired authorization retry transaction",
                None,
                |database| {
                    database.with_invalidation_retry_episode(&key, |registry| {
                        registry.reserve(
                            key.clone(),
                            witness,
                            now_millis(),
                            RetryReservationKind::Initial,
                        )
                    })
                },
            )
            .expect_err("retired epoch must fail before the durable transaction");
        assert_eq!(failure.error.diagnostic.code, "SNAPBACK_AUTH_MODE_PENDING");
        let after = snapback
            .auth_database_mut()
            .read_invalidation_retry_registry(|registry| Ok(registry.episodes().len()))
            .expect("read retry registry");
        assert_eq!(after, before);
    }

    /// Base instant for the durable lease-test session rows; far enough in the
    /// future that real `now_millis()` samples stay below the session expiry.
    const LEASE_SESSION_BASE_MS: u64 = 1_900_000_000_000;
    const LEASE_SESSION_NOT_AFTER_MS: u64 = LEASE_SESSION_BASE_MS + 86_400_000;
    const LEASE_AUTHORITY_INSTANCE: &str = "01890f3c-9d5b-7000-8000-000000000004";

    /// A settled sessions-mode snapback with one durable session and one
    /// declared userId-only retainable query, the full environment
    /// `capture_authorized_lease_query`/`reserve_captured_authorized_lease`
    /// demand.
    fn retainable_sessions_snapback() -> LocalSnapback {
        let digest = |prefix: &str, byte: char| format!("{prefix}{}", byte.to_string().repeat(64));
        let deployment = DeploymentIdentity {
            schema_version: "snapback.v1".to_owned(),
            auth_mode: AuthMode::Sessions,
            app_id: "lease-app".to_owned(),
            schema_hash: digest(SCHEMA_V1_PREFIX, 'a'),
            bundle_hash: digest(FUNCTION_V1_PREFIX, 'b'),
            inputs_hash: digest(INPUTS_V1_PREFIX, 'c'),
        };
        let items = TableManifest {
            name: "items".to_owned(),
            fields: vec![FieldManifest {
                name: "owner".to_owned(),
                field_type: FieldType::String,
                optional: false,
            }],
            indexes: vec![IndexManifest {
                name: "by_owner".to_owned(),
                fields: vec!["owner".to_owned()],
                unique: false,
            }],
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            membership: None,
        };

        let mut snapback = LocalSnapback::memory().expect("memory snapback");
        snapback
            .apply_schema(SchemaManifest {
                schema_hash: Some(deployment.schema_hash.clone()),
                tables: vec![items.clone()],
                ..SchemaManifest::default()
            })
            .expect("apply lease schema");
        let mut retained = FunctionDefinition::new(
            "listOwned",
            FunctionKind::Query,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table: "items".to_owned(),
                filters: vec![FilterExpr {
                    field: "owner".to_owned(),
                    op: FilterOp::Eq,
                    value: ValueExpr::AuthUserId,
                }],
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: Some("by_owner".to_owned()),
            })),
        );
        retained.retainable = true;
        retained.authorization_dependence =
            vec![crate::manifest::AuthorizationInputDimension::UserId];
        retained.read_set_summary = crate::manifest::DependencySummary {
            primary_table: Some("items".to_owned()),
            tables: vec!["items".to_owned()],
            mode: Some("singleTable".to_owned()),
            auth_scope_field: None,
        };
        let diagnostics = snapback.load_functions(FunctionManifest {
            bundle_hash: Some(deployment.bundle_hash.clone()),
            functions: vec![retained],
            ..FunctionManifest::default()
        });
        assert!(
            diagnostics
                .iter()
                .all(|diagnostic| diagnostic.code == "SNAPBACK_IBEX_CLI_UNAVAILABLE"),
            "unexpected function diagnostics: {diagnostics:?}"
        );

        let sessions_manifest = SchemaManifest {
            schema_version: "snapback.v1".to_owned(),
            app_id: "lease-app".to_owned(),
            auth: Some(AuthManifest {
                mode: AuthMode::Sessions,
            }),
            schema_hash: Some(deployment.schema_hash.clone()),
            inputs_hash: Some(deployment.inputs_hash.clone()),
            tables: vec![items],
            ..SchemaManifest::default()
        };
        let db = snapback.auth_database_mut();
        db.stage_auth_mode(deployment, sessions_manifest, None)
            .expect("stage sessions mode");
        db.consume_sessions_auth_mode(&AuthProgramReadiness::new(
            true, true, true, true, true, true, true,
        ))
        .expect("consume sessions mode");
        db.activate_current_auth_catalog()
            .expect("activate auth catalog");
        db.with_auth_transaction(|tx| {
            use rusqlite::params;
            tx.execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, ?2)",
                params!["user_1", LEASE_SESSION_BASE_MS as i64 - 1],
            )?;
            tx.execute(
                "INSERT INTO _auth_identities(
                   id, user_id, provider, subject, verified_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5)",
                params![
                    "identity_1",
                    "user_1",
                    "email-code",
                    "lease@example.test",
                    LEASE_SESSION_BASE_MS as i64 - 1,
                ],
            )?;
            tx.execute(
                "INSERT INTO _auth_sessions(
                   id, user_id, identity_id, authority_instance_id, token_hash,
                   generation, created_at_ms, last_used_at_ms, expires_at_ms,
                   absolute_expires_at_ms, revoked_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, ?7, ?8, NULL)",
                params![
                    "session_1",
                    "user_1",
                    "identity_1",
                    LEASE_AUTHORITY_INSTANCE,
                    vec![0x71_u8; 32],
                    LEASE_SESSION_BASE_MS as i64 - 1,
                    LEASE_SESSION_NOT_AFTER_MS as i64,
                    (LEASE_SESSION_BASE_MS + 2 * 86_400_000) as i64,
                ],
            )?;
            Ok(())
        })
        .expect("insert lease session rows");
        snapback
    }

    fn lease_session_authority() -> PreparedAuthority {
        InvocationGate::prepare_authority(
            InvocationSource::HttpQuery,
            AuthMode::Sessions,
            ServerProfile::Test,
            0,
            0,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::Session {
                user_id: "user_1".to_owned(),
                session_id: "session_1".to_owned(),
                provider: "email-code".to_owned(),
                generation: 1,
                authority_instance_id: LEASE_AUTHORITY_INSTANCE.to_owned(),
                session_not_after_ms: LEASE_SESSION_NOT_AFTER_MS,
                provider_not_after_ms: None,
            },
        )
        .expect("prepare lease session authority")
    }

    fn lease_target_namespace() -> QueryNamespace {
        QueryNamespace {
            client_store_id: "store_lease".to_owned(),
            query_key: "listOwned:{}".to_owned(),
            query_instance_id: 41,
        }
    }

    fn lease_request(request_id: &str) -> crate::auth::lease::AuthorizedLeaseRequestIdentity {
        let target = lease_target_namespace();
        crate::auth::lease::AuthorizedLeaseRequestIdentity {
            lease_request_id: request_id.to_owned(),
            client_store_id: target.client_store_id,
            query_key: target.query_key,
            query_instance_id: target.query_instance_id,
        }
    }

    fn raise_client_query_obligation(snapback: &mut LocalSnapback, namespace: QueryNamespace) {
        let state = snapback
            .auth_invalidation
            .as_mut()
            .expect("installed invalidation state");
        let witness = state.witness(0);
        let cause = state.reserve_cause_sequence().expect("cause sequence");
        state
            .obligations
            .raise(
                ScopeId::ClientQuery { namespace },
                cause,
                format!("test:{cause}"),
                InvalidationDisposition::Quarantine,
                witness,
                None,
            )
            .expect("raise test obligation");
    }

    fn discharge_client_query_obligation(snapback: &mut LocalSnapback, namespace: QueryNamespace) {
        let state = snapback
            .auth_invalidation
            .as_mut()
            .expect("installed invalidation state");
        let witness = state.witness(0);
        let scope = ScopeId::ClientQuery { namespace };
        let ticket = state
            .obligations
            .issue_resolution(&scope, ResolutionKind::Snapshot, witness)
            .expect("issue test resolution");
        assert!(matches!(
            state
                .obligations
                .acknowledge(&ticket.ack_token, true)
                .expect("acknowledge test resolution"),
            crate::auth::invalidation::AcknowledgeOutcome::Discharged
        ));
    }

    fn sign_captured_lease(
        capture: &super::AuthorizedLeaseCapture,
        issued_at_server_ms: u64,
    ) -> crate::auth::lease::AuthorizedLease {
        crate::auth::lease::AuthorizedLeaseAuthenticator::from_test_key(
            "sbak_AQEBAQEBAQEBAQEBAQEBAQ",
            [0x31; 32],
        )
        .issue(
            capture.issue.clone(),
            crate::auth::lease::AuthorizedLeaseConfig::default(),
            issued_at_server_ms,
            &capture.target_profile_id,
            &capture.app_id,
        )
        .expect("sign captured lease")
    }

    /// ENG-24989: one user's unresolved obligation must not deny lease
    /// issuance for every other user and query; only an obligation capable of
    /// quarantining/deleting the exact lease target blocks (LLP 0053 issuance
    /// proof item 4).
    #[test]
    fn authorized_lease_capture_ignores_unrelated_obligations_and_blocks_matching_ones() {
        let mut snapback = retainable_sessions_snapback();
        let _connection = install_test_invalidation(&mut snapback);

        // User A withholds ACKs for a different client store, and for the
        // same canonical key at a different query instance.
        let mut other_store = lease_target_namespace();
        other_store.client_store_id = "store_other_user".to_owned();
        raise_client_query_obligation(&mut snapback, other_store);
        let mut other_instance = lease_target_namespace();
        other_instance.query_instance_id += 1;
        raise_client_query_obligation(&mut snapback, other_instance);

        // User B's lease for an untouched target still issues end to end.
        let capture = snapback
            .capture_authorized_lease_query(
                "listOwned",
                HandlerInput::default(),
                lease_session_authority(),
                lease_request("req_unrelated_1"),
            )
            .expect("unrelated obligations must not block capture");
        let issued_at = now_millis();
        let lease = sign_captured_lease(&capture, issued_at);
        snapback
            .reserve_captured_authorized_lease(
                capture,
                &lease,
                crate::auth::lease::AuthorizedLeaseConfig::default(),
                issued_at,
            )
            .expect("unrelated obligations must not block reservation");

        // An obligation for the exact target namespace still fails capture
        // closed.
        raise_client_query_obligation(&mut snapback, lease_target_namespace());
        let error = snapback
            .capture_authorized_lease_query(
                "listOwned",
                HandlerInput::default(),
                lease_session_authority(),
                lease_request("req_matching_1"),
            )
            .map(|_| ())
            .expect_err("a matching obligation must block capture");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_INVALIDATION_PENDING");
    }

    /// ENG-24989: the reservation-time recheck stays in place, so a matching
    /// obligation racing the capture/signing window still wins — while an
    /// unrelated obligation raised in that window does not.
    #[test]
    fn authorized_lease_reservation_recheck_is_scoped_to_the_lease_target() {
        let mut snapback = retainable_sessions_snapback();
        let _connection = install_test_invalidation(&mut snapback);

        let capture = snapback
            .capture_authorized_lease_query(
                "listOwned",
                HandlerInput::default(),
                lease_session_authority(),
                lease_request("req_race_matching"),
            )
            .expect("clean capture");
        raise_client_query_obligation(&mut snapback, lease_target_namespace());
        let issued_at = now_millis();
        let lease = sign_captured_lease(&capture, issued_at);
        let error = snapback
            .reserve_captured_authorized_lease(
                capture,
                &lease,
                crate::auth::lease::AuthorizedLeaseConfig::default(),
                issued_at,
            )
            .expect_err("a racing matching obligation must fail the reservation");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTHORIZED_LEASE_STALE");

        // Once that exact obligation is applied and ACKed, a fresh capture
        // succeeds even when an unrelated obligation races the same window.
        discharge_client_query_obligation(&mut snapback, lease_target_namespace());
        let capture = snapback
            .capture_authorized_lease_query(
                "listOwned",
                HandlerInput::default(),
                lease_session_authority(),
                lease_request("req_race_unrelated"),
            )
            .expect("discharged target allows a fresh capture");
        let mut unrelated = lease_target_namespace();
        unrelated.client_store_id = "store_other_user".to_owned();
        raise_client_query_obligation(&mut snapback, unrelated);
        let issued_at = now_millis();
        let lease = sign_captured_lease(&capture, issued_at);
        snapback
            .reserve_captured_authorized_lease(
                capture,
                &lease,
                crate::auth::lease::AuthorizedLeaseConfig::default(),
                issued_at,
            )
            .expect("a racing unrelated obligation must not fail the reservation");
    }

    /// ENG-24990: refiring one exhausted retry key while 10,000 episodes are
    /// retained must not monopolize the app SQLite writer; unrelated
    /// mutations continue within the local runtime latency budget.
    #[test]
    fn retry_churn_at_the_global_cap_does_not_starve_unrelated_mutations() {
        let mut snapback = live_limit_snapback();
        let mut episodes = BTreeMap::new();
        let witness = crate::auth::invalidation::CompositeWitness {
            authorization: crate::storage::AuthorizationVersion {
                incarnation: "018f0d90-7b11-7a22-8c33-445566778899".to_owned(),
                epoch: 0,
            },
            data: Some(crate::auth::invalidation::DataWitness {
                version_stream: "stream-A".to_owned(),
                min_commit_version: 0,
            }),
        };
        for store in 0..10_u32 {
            for query in 0..1_000_u32 {
                let key = RetryEpisodeKey {
                    authority_subject: format!("user-{store}"),
                    client_store_id: format!("store-{store}"),
                    query_key: format!("todos-{query}:{{}}"),
                };
                episodes.insert(
                    key.clone(),
                    crate::auth::invalidation::RetryEpisode {
                        episode_id: format!("retry-{store}-{query}"),
                        key,
                        witness_floor: witness.clone(),
                        first_attempt_reserved_at_ms: 1_000,
                        first_failure_at_ms: Some(1_000),
                        attempts_reserved: crate::auth::invalidation::AUTH_ERROR_ATTEMPTS_TOTAL,
                        deadline_ms: Some(16_000),
                        manual_retry_id: None,
                        last_reservation_at_ms: 1_000,
                    },
                );
            }
        }
        let target = episodes.keys().nth(5_005).cloned().expect("target key");
        snapback
            .auth_database_mut()
            .seed_invalidation_retry_episodes_for_test(&episodes, 1_000_000)
            .expect("seed retry episodes");

        // Interleave production-shaped exhausted refires (initial reattach,
        // then automatic exhaustion — the exact transactions
        // invoke_authorization_resolution performs) with unrelated mutations.
        // LLP 0035 benchmarks the local target against a ~10ms interactive
        // budget; the pre-fix full-table rewrite spent two 10,000-row
        // rewrite transactions per refire on this same writer.
        let budget = Duration::from_millis(100);
        let mut now = 1_000_000_u64;
        for round in 0..5 {
            now += 1;
            let churn_started = Instant::now();
            let initial = snapback
                .auth_database_mut()
                .with_invalidation_retry_episode(&target, |registry| {
                    registry.reserve(
                        target.clone(),
                        witness.clone(),
                        now,
                        RetryReservationKind::Initial,
                    )
                })
                .expect("initial refire reservation");
            assert!(matches!(
                initial,
                crate::auth::invalidation::RetryReservation::Attached(_)
            ));
            now += 1;
            let automatic = snapback
                .auth_database_mut()
                .with_invalidation_retry_episode(&target, |registry| {
                    registry.reserve(
                        target.clone(),
                        witness.clone(),
                        now,
                        RetryReservationKind::Automatic,
                    )
                })
                .expect("automatic refire reservation");
            assert!(matches!(
                automatic,
                crate::auth::invalidation::RetryReservation::Exhausted(_)
            ));
            let churn_elapsed = churn_started.elapsed();
            assert!(
                churn_elapsed < budget,
                "round {round}: exhausted refire held the writer for {churn_elapsed:?}",
            );

            let mutation_started = Instant::now();
            invoke_test_session_mutation(
                &mut snapback,
                "insertItem",
                HandlerInput {
                    args: json!({ "value": format!("row-{round}") }),
                    ..HandlerInput::default()
                },
            )
            .expect("unrelated mutation under retry churn");
            let mutation_elapsed = mutation_started.elapsed();
            assert!(
                mutation_elapsed < budget,
                "round {round}: unrelated mutation took {mutation_elapsed:?} under churn",
            );
        }
        assert_eq!(
            snapback
                .auth_database_mut()
                .invalidation_retry_episode_count()
                .expect("episode count"),
            10_000,
            "refire churn must not evict or duplicate episodes",
        );
    }

    #[test]
    fn only_host_branded_permission_denial_issues_terminal_delete() {
        let mut snapback = live_limit_snapback();
        let connection = install_test_invalidation(&mut snapback);
        let admission = test_session_admission();
        let subscribe = |snapback: &mut LocalSnapback, instance, connection_id: &str| {
            snapback
                .subscribe_live_with_invalidation(
                    "listItems",
                    LiveSubscribeInput {
                        connection_id: connection_id.to_owned(),
                        input: HandlerInput::default(),
                        authorization_namespace: Some(test_authorization_namespace(instance)),
                        supersedes: None,
                        resume_from_token: None,
                    },
                    LiveInvalidationAdmission {
                        session_mode: true,
                        connection: Some(connection.clone()),
                        effect_fence: None,
                    },
                )
                .expect("auth-scoped subscription")
        };

        let terminal = subscribe(&mut snapback, 31, "session-terminal");
        let terminal_subscription = snapback
            .subscriptions
            .get(&terminal.subscription_id)
            .expect("stored terminal subscription")
            .clone();
        snapback.fail_subscription_fanout_with_retry(
            &terminal_subscription,
            "test_terminal_denial",
            SnapbackError::trusted_permission_denied("trusted policy denied"),
            None,
            None,
            &admission,
        );
        let terminal_scope = terminal.authorization_scope.expect("terminal scope");
        let projection = snapback
            .auth_invalidation
            .as_ref()
            .expect("invalidation state")
            .obligations
            .projection(&terminal_scope)
            .expect("terminal projection");
        assert_eq!(
            projection.obligation.max_disposition,
            InvalidationDisposition::Delete
        );
        assert_eq!(
            projection
                .resolution
                .as_ref()
                .expect("terminal delete ticket")
                .kind,
            ResolutionKind::TerminalDelete
        );
        let first = snapback
            .authorization_invalidation_frames("session-terminal", &admission)
            .expect("first terminal re-fire");
        let second = snapback
            .authorization_invalidation_frames("session-terminal", &admission)
            .expect("second terminal re-fire");
        assert_eq!(first, second, "terminal truth re-fires without re-querying");

        let forged = subscribe(&mut snapback, 32, "session-forged");
        let forged_subscription = snapback
            .subscriptions
            .get(&forged.subscription_id)
            .expect("stored forged subscription")
            .clone();
        snapback.fail_subscription_fanout_with_retry(
            &forged_subscription,
            "test_forged_denial",
            SnapbackError::error(
                "SNAPBACK_AUTH_PERMISSION_DENIED",
                "auth",
                "application supplied the public code",
            ),
            None,
            None,
            &admission,
        );
        let forged_projection = snapback
            .auth_invalidation
            .as_ref()
            .expect("invalidation state")
            .obligations
            .projection(&forged.authorization_scope.expect("forged scope"))
            .expect("forged projection");
        assert_eq!(
            forged_projection.obligation.max_disposition,
            InvalidationDisposition::Quarantine
        );
        assert!(forged_projection.resolution.is_none());
    }

    #[test]
    fn live_subscription_connection_limit_releases_on_failure_unsubscribe_and_disconnect() {
        let mut snapback = live_limit_snapback();

        // A failed initial query never reserves or retains capacity.
        let failed = snapback
            .subscribe_live("listItemsByValue", live_limit_input("bounded", json!({})))
            .expect_err("missing query arg");
        assert_eq!(failed.diagnostic.code, "SNAPBACK_ARG_MISSING");
        assert!(snapback.subscriptions.is_empty());

        let mut ids = Vec::new();
        for _ in 0..MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION {
            ids.push(
                snapback
                    .subscribe_live("listItems", live_limit_input("bounded", json!({})))
                    .expect("admit subscription below the per-connection limit")
                    .subscription_id,
            );
        }
        assert_eq!(
            snapback.subscriptions.len(),
            MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION
        );

        // Admission precedes initial query execution: although this input is
        // missing a required query arg, capacity is the stable refusal.
        let refused = snapback
            .subscribe_live("listItemsByValue", live_limit_input("bounded", json!({})))
            .expect_err("per-connection limit");
        assert_eq!(
            refused.diagnostic.code,
            "SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT"
        );
        assert_eq!(
            refused.diagnostic.details["limit"],
            MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION
        );
        assert_eq!(
            snapback.subscriptions.len(),
            MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION
        );

        // A net-zero replacement is admitted before the query, but failure
        // must not destroy the old subscription or consume another slot.
        let superseded = ids.remove(0);
        let mut failed_replacement = live_limit_input("bounded", json!({}));
        failed_replacement.supersedes = Some(superseded.clone());
        let failed = snapback
            .subscribe_live("listItemsByValue", failed_replacement)
            .expect_err("replacement snapshot failure");
        assert_eq!(failed.diagnostic.code, "SNAPBACK_ARG_MISSING");
        assert!(snapback.subscriptions.contains_key(&superseded));
        assert_eq!(
            snapback.subscriptions.len(),
            MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION
        );

        // Explicit same-owner supersession is net-zero and therefore remains
        // available at the ceiling.
        let mut replacement = live_limit_input("bounded", json!({}));
        replacement.supersedes = Some(superseded.clone());
        let replacement = snapback
            .subscribe_live("listItems", replacement)
            .expect("net-zero replacement at the limit");
        assert!(!snapback.subscriptions.contains_key(&superseded));
        assert!(
            snapback
                .subscriptions
                .contains_key(&replacement.subscription_id)
        );
        assert_eq!(
            snapback.subscriptions.len(),
            MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION
        );

        snapback
            .unsubscribe_live(
                "listItems",
                LiveUnsubscribeInput {
                    subscription_id: replacement.subscription_id,
                    connection_id: "bounded".to_owned(),
                    auth: Default::default(),
                },
            )
            .expect("unsubscribe releases one slot");
        assert_eq!(
            snapback.subscriptions.len(),
            MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION - 1
        );
        snapback
            .subscribe_live("listItems", live_limit_input("bounded", json!({})))
            .expect("reuse unsubscribed slot");

        snapback.disconnect_topology_for_transport("bounded", 1);
        assert!(snapback.subscriptions.is_empty());
        snapback
            .subscribe_live("listItems", live_limit_input("bounded", json!({})))
            .expect("reuse capacity released by disconnect");
    }

    #[test]
    fn live_subscription_global_limit_releases_on_disconnect() {
        let mut snapback = live_limit_snapback();
        assert_eq!(
            MAX_LIVE_SUBSCRIPTIONS % MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION,
            0,
            "test expects the global cap to divide into full connections"
        );
        let connection_count = MAX_LIVE_SUBSCRIPTIONS / MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION;
        for connection in 0..connection_count {
            let connection_id = format!("global-{connection}");
            for _ in 0..MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION {
                snapback
                    .subscribe_live("listItems", live_limit_input(&connection_id, json!({})))
                    .expect("admit subscription below the global limit");
            }
        }
        assert_eq!(snapback.subscriptions.len(), MAX_LIVE_SUBSCRIPTIONS);

        // The full registry refuses before evaluating the intentionally
        // invalid initial query, proving the expensive snapshot is not run.
        let refused = snapback
            .subscribe_live(
                "listItemsByValue",
                live_limit_input("global-overflow", json!({})),
            )
            .expect_err("global limit");
        assert_eq!(
            refused.diagnostic.code,
            "SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT"
        );
        assert_eq!(refused.diagnostic.details["limit"], MAX_LIVE_SUBSCRIPTIONS);
        assert_eq!(snapback.subscriptions.len(), MAX_LIVE_SUBSCRIPTIONS);

        snapback.disconnect_topology_for_transport("global-0", 1);
        assert_eq!(
            snapback.subscriptions.len(),
            MAX_LIVE_SUBSCRIPTIONS - MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION
        );
        snapback
            .subscribe_live("listItems", live_limit_input("global-overflow", json!({})))
            .expect("reuse capacity released by disconnect");
    }

    #[test]
    fn reset_commit_failure_preserves_runtime_generation_and_live_subscription() {
        let mut snapback = LocalSnapback::memory().expect("memory snapback");
        snapback
            .apply_schema(reload_schema("reset-failure-schema", false))
            .expect("apply schema");
        let mut functions = guarded_functions();
        functions.functions.push(FunctionDefinition::new(
            "listItems",
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table: "items".to_owned(),
                filters: Vec::new(),
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            })),
        ));
        snapback.load_functions(functions);
        snapback
            .invoke_mutation("hostInsert", HandlerInput::default())
            .expect("seed row");
        let subscription = snapback
            .subscribe_live(
                "listItems",
                LiveSubscribeInput {
                    connection_id: "reset-failure-client".to_owned(),
                    input: HandlerInput::default(),
                    authorization_namespace: None,
                    supersedes: None,
                    resume_from_token: None,
                },
            )
            .expect("subscribe");
        let generation = snapback.app_generation();

        crate::storage::inject_reset_commit_failure_for_test();
        let error = snapback
            .reset()
            .expect_err("commit-boundary failure rejects reset");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");
        assert_eq!(snapback.app_generation(), generation);
        assert!(
            snapback
                .subscriptions
                .contains_key(&subscription.subscription_id)
        );
        assert_eq!(
            snapback
                .invoke_query("listItems", HandlerInput::default())
                .expect("prior generation remains usable")
                .rows
                .len(),
            1
        );
    }

    fn cancelled() -> crate::diagnostic::SnapbackError {
        crate::diagnostic::SnapbackError::error(
            "SNAPBACK_ACTION_TIMEOUT",
            "runtime",
            "guarded local commit test cancellation",
        )
    }

    struct GateScopeProbe {
        active: Arc<AtomicBool>,
    }

    impl Drop for GateScopeProbe {
        fn drop(&mut self) {
            self.active.store(false, Ordering::SeqCst);
        }
    }

    fn install_postcommit_gate_assertion(active: Arc<AtomicBool>, observed: Arc<AtomicBool>) {
        BEFORE_MUTATION_POSTCOMMIT_HOOK.with(|slot| {
            assert!(slot.borrow().is_none(), "postcommit hook must be one-shot");
            *slot.borrow_mut() = Some(Box::new(move || {
                assert!(
                    !active.load(Ordering::SeqCst),
                    "commit gate guard must drop before permission/live fan-out"
                );
                observed.store(true, Ordering::SeqCst);
            }));
        });
    }

    fn input() -> HandlerInput {
        HandlerInput {
            args: json!({}),
            auth: Default::default(),
            read_set: Vec::new(),
            correlation: None,
            ctx_ledger: None,
        }
    }

    fn nested_authority() -> PreparedAuthority {
        InvocationGate::prepare_dev_input(
            InvocationSource::LocalMutation,
            ServerProfile::Test,
            &input(),
        )
        .expect("prepare nested test authority")
        .inherit_for(InvocationSource::NestedMutation)
        .expect("inherit nested test authority")
    }

    #[test]
    fn service_principal_host_plan_permission_backing_write_is_refused_without_provenance() {
        let schema = SchemaManifest {
            tables: vec![TableManifest {
                name: "custom_acl".to_owned(),
                fields: vec![FieldManifest {
                    name: "ownerId".to_owned(),
                    field_type: FieldType::Principal,
                    optional: false,
                }],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: true,
                permission_fields: Some(vec!["ownerId".to_owned()]),
                membership: None,
            }],
            ..SchemaManifest::default()
        };
        let mut values = BTreeMap::new();
        values.insert("ownerId".to_owned(), ValueExpr::Literal(json!("alice")));
        let mut function = FunctionDefinition::new(
            "seatAcl",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                steps: vec![MutationStep::Insert {
                    table: "custom_acl".to_owned(),
                    values,
                    bind_id_as: None,
                }],
                return_value: Some(ReturnValue::ChangedCount),
            })),
        );
        function.authority_creating = true;
        let scope = ResolvedGrantScope::from_exact(ExactGrantScope {
            function_id: function.id.clone(),
            kind: ScopedFunctionKind::Mutation,
            basis: 0,
            authority_creating: true,
        });
        let authority = InvocationGate::prepare_authority(
            InvocationSource::HttpMutation,
            AuthMode::Sessions,
            ServerProfile::Test,
            1,
            1,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::ServicePrincipal {
                actor_user_id: "agent-a".to_owned(),
                credential_id: "credential-a".to_owned(),
                credential_generation: 1,
                grant_id: "grant-a".to_owned(),
                token_id: "token-a".to_owned(),
                effective_user_id: Some("alice".to_owned()),
                scopes: vec![scope],
                token_expires_at_ms: 10_000,
            },
        )
        .expect("prepared service authority");
        let prepared = InvocationGate::prepare_function(authority, &function)
            .expect("explicit authority-creating scope");
        let error =
            refuse_unprovenanced_host_plan_authority_creation(&prepared, &function, &schema)
                .expect_err("HostPlan has no full-provenance service lane");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED"
        );
        assert_eq!(
            error.diagnostic.details["reason"],
            "permission_backing_provenance_unavailable"
        );
    }

    fn prepared_mutation(snapback: &LocalSnapback, name: &str) -> PreparedInvocation {
        InvocationGate::prepare_function(
            nested_authority(),
            snapback.function(name).expect("test mutation exists"),
        )
        .expect("prepare test mutation")
    }

    fn detached(snapback: &mut LocalSnapback, name: &str) -> Box<DetachedIbexMutation> {
        match snapback
            .stage_nested_mutation(name, &input(), nested_authority())
            .expect("stage nested mutation")
        {
            StagedNestedMutation::Detached(staged) => staged,
            StagedNestedMutation::InLock(_) => panic!("Ibex mutation must detach"),
        }
    }

    fn executed_insert() -> ExecutedIbexMutation {
        let mut values = serde_json::Map::new();
        values.insert("value".to_owned(), json!("guarded"));
        ExecutedIbexMutation {
            writes: vec![BufferedWrite::Insert {
                table: "items".to_owned(),
                id: "guarded_item".to_owned(),
                values,
            }],
            membership_commands: Vec::new(),
            reads: Vec::new(),
            result: json!("guarded_item"),
            ctx_ledger: CtxAnswerLedger {
                version: ctx_ledger_version(),
                ids: Vec::new(),
                now: 0,
                auth_fingerprint: None,
            },
        }
    }

    #[test]
    fn guarded_host_plan_local_path_rolls_back_and_releases_gate_before_postcommit() {
        let mut cancelled_snapback = guarded_snapback();
        let error = cancelled_snapback
            .invoke_host_plan_mutation_guarded(
                "hostInsert",
                input(),
                prepared_mutation(&cancelled_snapback, "hostInsert"),
                || Ok(()),
                || -> crate::diagnostic::SnapbackResult<()> { Err(cancelled()) },
            )
            .expect_err("precommit cancellation must reject the host plan");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");
        assert_eq!(cancelled_snapback.durable_version().unwrap(), 0);
        assert_eq!(
            cancelled_snapback
                .db
                .scan_table("items", 10, 0)
                .expect("cancelled scan")
                .total,
            0
        );
        let receipts = cancelled_snapback.receipts_snapshot(None);
        let receipt = receipts["global"]
            .as_array()
            .and_then(|items| items.last())
            .expect("rejected host-plan receipt");
        assert_eq!(receipt["rollbackReason"], "SNAPBACK_ACTION_TIMEOUT");

        let mut committed = guarded_snapback();
        let active = Arc::new(AtomicBool::new(false));
        let observed = Arc::new(AtomicBool::new(false));
        install_postcommit_gate_assertion(active.clone(), observed.clone());
        committed
            .invoke_host_plan_mutation_guarded(
                "hostInsert",
                input(),
                prepared_mutation(&committed, "hostInsert"),
                || Ok(()),
                {
                    let active = active.clone();
                    move || {
                        active.store(true, Ordering::SeqCst);
                        Ok(GateScopeProbe { active })
                    }
                },
            )
            .expect("guarded host-plan commit");
        assert!(observed.load(Ordering::SeqCst));
        assert!(!active.load(Ordering::SeqCst));
        assert_eq!(committed.durable_version().unwrap(), 1);
    }

    #[test]
    fn postcommit_head_corruption_preserves_confirmed_receipt_and_durable_truth() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("postcommit-head.sqlite3");
        let mut snapback = LocalSnapback::open(&path).expect("file-backed snapback");
        snapback
            .apply_schema(reload_schema("postcommit-head", false))
            .unwrap();
        snapback.load_functions(guarded_functions());

        let corrupt_path = path.clone();
        BEFORE_MUTATION_POSTCOMMIT_HOOK.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                rusqlite::Connection::open(corrupt_path)
                    .unwrap()
                    .execute("UPDATE _snapback_version SET version = 0 WHERE id = 1", [])
                    .unwrap();
            }));
        });
        let authority = InvocationGate::prepare_dev_input(
            InvocationSource::LocalMutation,
            ServerProfile::Test,
            &input(),
        )
        .unwrap();
        let (result, receipt) = snapback.invoke_mutation_recording_with_authority_descriptor(
            "hostInsert",
            input(),
            None,
            None,
            "test",
            authority,
        );
        let output = result.expect("the committed mutation remains durable truth");
        assert_eq!(output.version, 1);
        match receipt {
            crate::live_wire::Receipt::Mutation {
                outcome,
                snapshot_version,
                rollback_reason,
                ..
            } => {
                assert_eq!(outcome, crate::live_wire::MutationReceiptOutcome::Confirmed);
                assert_eq!(snapshot_version, Some(1));
                assert_eq!(rollback_reason, None);
            }
            _ => panic!("expected mutation receipt"),
        }
        assert!(
            snapback
                .recent_diagnostics
                .iter()
                .any(|diagnostic| { diagnostic.code == "SNAPBACK_STORAGE_VERSION_CORRUPT" })
        );

        let raw = rusqlite::Connection::open(&path).unwrap();
        let row_count: i64 = raw
            .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
            .unwrap();
        let journal_count: i64 = raw
            .query_row(
                "SELECT COUNT(*) FROM _snapback_changes WHERE version = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(row_count, 1);
        assert_eq!(journal_count, 1);
    }

    #[test]
    fn postcommit_publication_guard_failure_confirms_without_retaining_sensitive_output() {
        let mut snapback = permission_epoch_guarded_snapback();
        let controller = AdmissionController::new(0, true).unwrap();
        let lease = controller.admit_dev().unwrap();
        let authority = InvocationGate::prepare_admitted_dev_input(
            InvocationSource::LocalMutation,
            ServerProfile::Test,
            &input(),
            lease,
        )
        .unwrap();
        let controller_for_hook = controller.clone();
        BEFORE_MUTATION_POSTCOMMIT_HOOK.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                let error = controller_for_hook
                    .retire_current_epoch_for_test()
                    .expect_err("the in-flight mutation forces retirement timeout");
                assert_eq!(
                    error.diagnostic.code,
                    "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT"
                );
            }));
        });

        let (result, receipt) = snapback.invoke_mutation_recording_with_authority_descriptor(
            "hostInsert",
            input(),
            None,
            None,
            "test",
            authority,
        );
        assert!(
            result.is_err(),
            "caller-visible mutation output is suppressed after the authority cut"
        );
        match receipt {
            crate::live_wire::Receipt::Mutation {
                outcome,
                snapshot_version,
                rollback_reason,
                ..
            } => {
                assert_eq!(outcome, crate::live_wire::MutationReceiptOutcome::Confirmed);
                assert_eq!(snapshot_version, Some(1));
                assert_eq!(rollback_reason, None);
            }
            _ => panic!("expected mutation receipt"),
        }
        assert_eq!(snapback.durable_version().unwrap(), 1);
        assert_eq!(snapback.db.scan_table("items", 10, 0).unwrap().total, 1);
        assert_eq!(snapback.permission_epoch("permission:test"), 1);
        assert!(
            snapback.receipts_snapshot(None)["global"]
                .as_array()
                .is_some_and(Vec::is_empty),
            "a failed publication guard must not retain the receipt or handler output"
        );
        assert!(snapback.recent_diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "SNAPBACK_AUTH_MODE_CHANGED"
                || diagnostic.code == "SNAPBACK_AUTH_MODE_PENDING"
        }));
    }

    #[test]
    fn guarded_buffered_local_path_rolls_back_and_releases_gate_before_postcommit() {
        let mut cancelled_snapback = guarded_snapback();
        let DetachedIbexMutation {
            binding,
            read: _read,
        } = *detached(&mut cancelled_snapback, "ibexInsert");
        let error = cancelled_snapback
            .commit_detached_ibex_mutation_guarded(
                "ibexInsert",
                input(),
                binding,
                executed_insert(),
                || Ok(()),
                || -> crate::diagnostic::SnapbackResult<()> { Err(cancelled()) },
            )
            .expect_err("precommit cancellation must reject buffered writes");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");
        assert_eq!(cancelled_snapback.durable_version().unwrap(), 0);
        assert_eq!(
            cancelled_snapback
                .db
                .scan_table("items", 10, 0)
                .expect("cancelled scan")
                .total,
            0
        );

        let mut committed = guarded_snapback();
        let DetachedIbexMutation {
            binding,
            read: _read,
        } = *detached(&mut committed, "ibexInsert");
        let active = Arc::new(AtomicBool::new(false));
        let observed = Arc::new(AtomicBool::new(false));
        install_postcommit_gate_assertion(active.clone(), observed.clone());
        committed
            .commit_detached_ibex_mutation_guarded(
                "ibexInsert",
                input(),
                binding,
                executed_insert(),
                || Ok(()),
                {
                    let active = active.clone();
                    move || {
                        active.store(true, Ordering::SeqCst);
                        Ok(GateScopeProbe { active })
                    }
                },
            )
            .expect("guarded buffered commit");
        assert!(observed.load(Ordering::SeqCst));
        assert!(!active.load(Ordering::SeqCst));
        assert_eq!(committed.durable_version().unwrap(), 1);
    }

    #[test]
    fn permission_epoch_commits_max_once_then_refuses_before_durable_host_write() {
        let mut snapback = permission_epoch_guarded_snapback();
        snapback.permission_epochs.insert(
            "permission:test".to_owned(),
            crate::manifest::PORTABLE_STORAGE_VERSION_MAX - 1,
        );

        snapback
            .invoke_mutation("hostInsert", input())
            .expect("the final portable epoch commits");
        assert_eq!(
            snapback.permission_epoch("permission:test"),
            crate::manifest::PORTABLE_STORAGE_VERSION_MAX
        );
        let committed_version = snapback.durable_version().unwrap();
        let committed_rows = snapback
            .db
            .scan_table("items", 10, 0)
            .expect("scan committed row")
            .total;

        let error = snapback
            .invoke_mutation("hostInsert", input())
            .expect_err("an exhausted permission epoch refuses the transaction");
        assert_eq!(error.diagnostic.code, "SNAPBACK_PERMISSION_EPOCH_EXHAUSTED");
        assert_eq!(snapback.durable_version().unwrap(), committed_version);
        assert_eq!(
            snapback
                .db
                .scan_table("items", 10, 0)
                .expect("scan preserved rows")
                .total,
            committed_rows
        );
        assert_eq!(
            snapback.permission_epoch("permission:test"),
            crate::manifest::PORTABLE_STORAGE_VERSION_MAX
        );
    }

    #[test]
    fn permission_epoch_exhaustion_refuses_guarded_and_detached_commit_seams() {
        let mut host = permission_epoch_guarded_snapback();
        host.permission_epochs.insert(
            "permission:test".to_owned(),
            crate::manifest::PORTABLE_STORAGE_VERSION_MAX,
        );
        let error = host
            .invoke_host_plan_mutation_guarded(
                "hostInsert",
                input(),
                prepared_mutation(&host, "hostInsert"),
                || Ok(()),
                || Ok(()),
            )
            .expect_err("guarded HostPlan refuses before SQLite");
        assert_eq!(error.diagnostic.code, "SNAPBACK_PERMISSION_EPOCH_EXHAUSTED");
        assert_eq!(host.durable_version().unwrap(), 0);
        assert_eq!(host.db.scan_table("items", 10, 0).unwrap().total, 0);

        let mut buffered = permission_epoch_guarded_snapback();
        buffered.permission_epochs.insert(
            "permission:test".to_owned(),
            crate::manifest::PORTABLE_STORAGE_VERSION_MAX,
        );
        let DetachedIbexMutation {
            binding,
            read: _read,
        } = *detached(&mut buffered, "ibexInsert");
        let error = buffered
            .commit_detached_ibex_mutation_guarded(
                "ibexInsert",
                input(),
                binding,
                executed_insert(),
                || Ok(()),
                || Ok(()),
            )
            .expect_err("detached buffered commit refuses before SQLite");
        assert_eq!(error.diagnostic.code, "SNAPBACK_PERMISSION_EPOCH_EXHAUSTED");
        assert_eq!(buffered.durable_version().unwrap(), 0);
        assert_eq!(buffered.db.scan_table("items", 10, 0).unwrap().total, 0);
    }

    #[test]
    fn permission_epoch_capacity_preflights_every_mutation_commit_seam() {
        let source = include_str!("local.rs");
        for needle in [
            "pub(crate) fn commit_staged_recorded_authorization_mutation",
            "fn invoke_mutation_commit_with_id_and_authority",
            "fn invoke_host_plan_mutation_commit_guarded",
            "pub(crate) fn commit_detached_ibex_mutation_guarded",
        ] {
            let start = source.find(needle).expect("commit seam remains in source");
            let body = &source[start..];
            let end = body
                .find("\n    fn ")
                .or_else(|| body.find("\n    pub(crate) fn "))
                .unwrap_or(body.len());
            assert!(
                body[..end].contains("ensure_permission_epoch_capacity"),
                "{needle} must preflight permission epoch capacity before durable commit"
            );
        }
    }

    #[test]
    fn detached_mutation_binds_schema_and_app_generation_across_reload() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut snapback =
            LocalSnapback::open(dir.path().join("reload.sqlite")).expect("file-backed snapback");
        snapback
            .apply_schema(reload_schema("schema-v1", false))
            .expect("apply v1");
        snapback.load_functions(reload_functions());

        let old_insert = detached(&mut snapback, "insertOld");
        let new_table_read = detached(&mut snapback, "readNewTable");
        snapback
            .apply_schema(reload_schema("schema-v2", true))
            .expect("apply v2 while mutations are detached");

        let deadline = Instant::now() + Duration::from_secs(5);
        let DetachedIbexMutation { binding, read } = *new_table_read;
        let module = match &binding.function.runtime {
            FunctionRuntime::IbexModule(module) => module,
            _ => unreachable!(),
        };
        let read = match read {
            DetachedMutationRead::Lane(read) => read,
            DetachedMutationRead::Snapshot(_) => panic!("file database must use WAL read lane"),
        };
        let error = match read.execute_detached_ibex_mutation(
            module,
            input(),
            &binding.invocation,
            &binding.schema,
            deadline,
        ) {
            Ok(_) => panic!("staged v1 execution must not see v2's new table"),
            Err(error) => error,
        };
        let diagnostic = serde_json::to_string(&error.diagnostic).expect("diagnostic json");
        assert!(
            diagnostic.contains("SNAPBACK_UNKNOWN_TABLE") || diagnostic.contains("new_items"),
            "execution must use the staged schema: {diagnostic}"
        );

        let DetachedIbexMutation { binding, read } = *old_insert;
        let module = match &binding.function.runtime {
            FunctionRuntime::IbexModule(module) => module,
            _ => unreachable!(),
        };
        let read = match read {
            DetachedMutationRead::Lane(read) => read,
            DetachedMutationRead::Snapshot(_) => panic!("file database must use WAL read lane"),
        };
        let executed = read
            .execute_detached_ibex_mutation(
                module,
                input(),
                &binding.invocation,
                &binding.schema,
                deadline,
            )
            .expect("old-schema-compatible handler executes against staged schema");
        let error = snapback
            .commit_detached_ibex_mutation_guarded(
                "insertOld",
                input(),
                binding,
                executed,
                || Ok(()),
                || Ok(()),
            )
            .expect_err("schema/app generation changed before commit");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
    }

    #[test]
    fn staged_subscribe_queries_after_the_exact_act_cut() {
        let mut snapback = live_limit_snapback();
        let fence = crate::ephemeral::ConnectionEffectFence::anonymous(
            "stage-query-incarnation",
            "stage-query-grant",
        );
        let staged = snapback
            .prepare_subscribe_live_for_transport(
                "listItems".to_owned(),
                live_limit_input("stage-query", json!({})),
                test_dev_authority(InvocationSource::LiveInitialQuery),
                LiveInvalidationAdmission {
                    connection: None,
                    effect_fence: Some(fence.clone()),
                    session_mode: false,
                },
            )
            .expect("reserve subscribe without querying");
        assert!(snapback.subscriptions.is_empty());

        snapback
            .invoke_mutation(
                "insertItem",
                HandlerInput {
                    args: json!({ "value": "after-prepare" }),
                    ..HandlerInput::default()
                },
            )
            .expect("mutation between preparation and exact act");
        staged
            .try_commit("stage-query", &fence)
            .expect("exact act commits");
        let publication = snapback
            .finalize_subscribe_live_for_transport(&staged)
            .expect("post-act query and publication");
        assert_eq!(publication.output.snapshot.as_ref().unwrap().rows.len(), 1);
        assert_eq!(
            publication.output.snapshot.as_ref().unwrap().rows[0]["value"],
            json!("after-prepare")
        );
    }

    #[test]
    fn staged_live_effect_binding_terminal_and_one_shot_lifecycle() {
        let mut snapback = live_limit_snapback();
        let fence = crate::ephemeral::ConnectionEffectFence::anonymous(
            "stage-life-incarnation",
            "stage-life-grant",
        );
        let other_fence = crate::ephemeral::ConnectionEffectFence::anonymous(
            "stage-life-incarnation",
            "stage-life-other-grant",
        );
        let prepare = |snapback: &mut LocalSnapback, connection_id: &str| {
            snapback.prepare_subscribe_live_for_transport(
                "listItems".to_owned(),
                live_limit_input(connection_id, json!({})),
                test_dev_authority(InvocationSource::LiveInitialQuery),
                LiveInvalidationAdmission {
                    connection: None,
                    effect_fence: Some(fence.clone()),
                    session_mode: false,
                },
            )
        };

        let wrong_binding = prepare(&mut snapback, "stage-binding").expect("stage binding");
        assert_eq!(
            wrong_binding
                .try_commit("another-connection", &fence)
                .expect_err("wrong connection must not commit")
                .diagnostic
                .code,
            "SNAPBACK_LIVE_STAGE_BINDING_MISMATCH"
        );
        assert_eq!(
            wrong_binding
                .try_commit("stage-binding", &other_fence)
                .expect_err("wrong fence must not commit")
                .diagnostic
                .code,
            "SNAPBACK_LIVE_STAGE_BINDING_MISMATCH"
        );
        snapback.abandon_prepared_live_effect(&wrong_binding);

        let before_cut = prepare(&mut snapback, "terminal-before").expect("stage before terminal");
        snapback.purge_connection_topology("terminal-before", &fence);
        assert_eq!(
            before_cut
                .try_commit("terminal-before", &fence)
                .expect_err("terminal-before-cut wins")
                .diagnostic
                .code,
            "SNAPBACK_LIVE_STAGE_UNAVAILABLE"
        );
        assert!(
            snapback
                .finalize_subscribe_live_for_transport(&before_cut)
                .is_err()
        );

        let after_cut = prepare(&mut snapback, "terminal-after").expect("stage after terminal");
        after_cut
            .try_commit("terminal-after", &fence)
            .expect("CAS wins first");
        snapback.purge_connection_topology("terminal-after", &fence);
        assert_eq!(
            snapback
                .finalize_subscribe_live_for_transport(&after_cut)
                .expect_err("terminal purge before Local claim wins")
                .diagnostic
                .code,
            "SNAPBACK_LIVE_STAGE_UNAVAILABLE"
        );

        let one_shot = prepare(&mut snapback, "one-shot").expect("stage one-shot");
        one_shot
            .try_commit("one-shot", &fence)
            .expect("commit one-shot");
        snapback
            .finalize_subscribe_live_for_transport(&one_shot)
            .expect("first finalize publishes");
        assert!(
            snapback
                .finalize_subscribe_live_for_transport(&one_shot)
                .is_err(),
            "a consumed stage cannot publish twice"
        );
        assert!(!one_shot.abandon(), "a finalized stage cannot be abandoned");
        assert_eq!(
            snapback
                .subscriptions
                .values()
                .filter(|subscription| subscription.connection_id == "one-shot")
                .count(),
            1
        );
        snapback.ephemeral.enqueue_durable_bound(
            "one-shot".to_owned(),
            b"post-finalize".to_vec(),
            fence.clone(),
        );
        let ephemeral = snapback.ephemeral_api();
        snapback.purge_connection_topology("one-shot", &fence);
        ephemeral.purge_connection_effects("one-shot", &fence);
        assert!(
            !snapback
                .subscriptions
                .values()
                .any(|subscription| subscription.connection_id == "one-shot")
        );
        assert_eq!(
            snapback.ephemeral.diagnostics().pending_durable_messages,
            0,
            "the post-Local exact-fence sweep removes finalization's backlog"
        );
    }

    #[test]
    fn staged_live_effects_reserve_capacity_and_subscription_targets() {
        let mut snapback = live_limit_snapback();
        let fence = crate::ephemeral::ConnectionEffectFence::anonymous(
            "stage-capacity-incarnation",
            "stage-capacity-grant",
        );
        let mut stages = Vec::new();
        for index in 0..MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION {
            stages.push(
                snapback
                    .prepare_subscribe_live_for_transport(
                        "listItems".to_owned(),
                        live_limit_input("stage-capacity", json!({ "index": index })),
                        test_dev_authority(InvocationSource::LiveInitialQuery),
                        LiveInvalidationAdmission {
                            connection: None,
                            effect_fence: Some(fence.clone()),
                            session_mode: false,
                        },
                    )
                    .expect("pending subscription consumes one slot"),
            );
        }
        assert_eq!(
            snapback
                .prepare_subscribe_live_for_transport(
                    "listItems".to_owned(),
                    live_limit_input("stage-capacity", json!({ "overflow": true })),
                    test_dev_authority(InvocationSource::LiveInitialQuery),
                    LiveInvalidationAdmission {
                        connection: None,
                        effect_fence: Some(fence.clone()),
                        session_mode: false,
                    },
                )
                .expect_err("pending stages count against per-connection capacity")
                .diagnostic
                .code,
            "SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT"
        );
        for stage in &stages {
            snapback.abandon_prepared_live_effect(stage);
        }

        let resume = snapback
            .prepare_resume_live_for_transport(
                "listItems".to_owned(),
                LiveResumeInput {
                    subscription_id: "sub_reserved_target".to_owned(),
                    connection_id: "stage-target".to_owned(),
                    auth: AuthInput::default(),
                    recorded_permission_epochs: BTreeMap::new(),
                },
                test_dev_authority(InvocationSource::LiveResume),
                LiveInvalidationAdmission {
                    connection: None,
                    effect_fence: Some(fence.clone()),
                    session_mode: false,
                },
            )
            .expect("reserve resume target");
        assert_eq!(
            snapback
                .prepare_unsubscribe_live_for_transport(
                    "listItems".to_owned(),
                    LiveUnsubscribeInput {
                        subscription_id: "sub_reserved_target".to_owned(),
                        connection_id: "stage-target".to_owned(),
                        auth: AuthInput::default(),
                    },
                    test_dev_authority(InvocationSource::LiveUnsubscribe),
                    fence,
                )
                .expect_err("one target cannot have two pending lifecycle acts")
                .diagnostic
                .code,
            "SNAPBACK_LIVE_STAGE_CONFLICT"
        );
        snapback.abandon_prepared_live_effect(&resume);
    }

    #[test]
    fn transport_disconnect_topology_never_touches_ephemeral_or_activity_state() {
        let mut snapback = live_limit_snapback();
        let fence = crate::ephemeral::ConnectionEffectFence::anonymous(
            "disconnect-split-incarnation",
            "disconnect-split-grant",
        );
        snapback
            .subscribe_live_with_invalidation(
                "listItems",
                live_limit_input("disconnect-split", json!({})),
                LiveInvalidationAdmission {
                    connection: None,
                    effect_fence: Some(fence.clone()),
                    session_mode: false,
                },
            )
            .expect("fenced subscription");
        snapback.ephemeral.enqueue_durable_bound(
            "disconnect-split".to_owned(),
            b"survives-local-phase".to_vec(),
            fence.clone(),
        );
        assert_eq!(snapback.active_connection_count(), 1);
        assert_eq!(snapback.ephemeral.diagnostics().pending_durable_messages, 1);

        let topology = snapback.disconnect_topology_for_transport("disconnect-split", now_millis());
        assert_eq!(topology.dropped_subscriptions, 1);
        assert_eq!(topology.dropped_effect_fences, BTreeSet::from([fence]));
        assert_eq!(snapback.active_connection_count(), 1);
        assert_eq!(
            snapback.ephemeral.diagnostics().pending_durable_messages,
            1,
            "the Local-only phase must not acquire or mutate the outbox"
        );

        snapback
            .ephemeral_api()
            .disconnect("disconnect-split", now_millis());
        assert_eq!(snapback.active_connection_count(), 0);
        assert_eq!(snapback.ephemeral.diagnostics().pending_durable_messages, 0);
    }

    #[test]
    fn direct_disconnect_compatibility_sequences_both_teardown_phases() {
        let mut snapback = live_limit_snapback();
        let subscribed = snapback
            .subscribe_live(
                "listItems",
                live_limit_input("direct-disconnect", json!({})),
            )
            .expect("direct subscription");
        snapback
            .ephemeral
            .enqueue_durable("direct-disconnect".to_owned(), b"discard-me".to_vec());
        assert!(
            snapback
                .subscriptions
                .contains_key(&subscribed.subscription_id)
        );
        assert_eq!(snapback.active_connection_count(), 1);

        snapback.disconnect("direct-disconnect", now_millis());

        assert!(
            !snapback
                .subscriptions
                .contains_key(&subscribed.subscription_id)
        );
        assert_eq!(snapback.active_connection_count(), 0);
        assert_eq!(snapback.ephemeral.diagnostics().pending_durable_messages, 0);
    }

    #[test]
    #[should_panic(
        expected = "LocalSnapback::disconnect compatibility orchestration entered while LocalSnapback write scope"
    )]
    fn direct_disconnect_compatibility_rejects_managed_writer_overlap() {
        let mut snapback = live_limit_snapback();
        let _local_scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        snapback.disconnect("forbidden-overlap", now_millis());
    }

    #[test]
    #[should_panic(expected = "EphemeralApi::disconnect entered while LocalSnapback write scope")]
    fn ephemeral_disconnect_rejects_local_writer_overlap() {
        let snapback = live_limit_snapback();
        let ephemeral = snapback.ephemeral_api();
        let _local_scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        ephemeral.disconnect("forbidden-overlap", now_millis());
    }

    #[test]
    fn live_scope_failures_roll_back_or_preserve_the_exact_predecessor() {
        let mut snapback = live_limit_snapback();
        let connection = install_test_invalidation(&mut snapback);
        let fence = crate::ephemeral::ConnectionEffectFence::anonymous(
            "scope-rollback-incarnation",
            "scope-rollback-grant",
        );
        let subscribe = |instance, supersedes| LiveSubscribeInput {
            connection_id: "scope-rollback".to_owned(),
            input: HandlerInput::default(),
            authorization_namespace: Some(test_authorization_namespace(instance)),
            supersedes,
            resume_from_token: None,
        };
        let invalidation = || LiveInvalidationAdmission {
            connection: Some(connection.clone()),
            effect_fence: Some(fence.clone()),
            session_mode: true,
        };

        FAIL_NEXT_LIVE_SCOPE_REGISTRATION.with(|fail| fail.set(true));
        assert_eq!(
            snapback
                .subscribe_live_with_invalidation("listItems", subscribe(300, None), invalidation())
                .expect_err("partial scope registration is rolled back")
                .diagnostic
                .code,
            "SNAPBACK_TEST_LIVE_SCOPE_REGISTRATION_FAILED"
        );
        assert!(snapback.subscriptions.is_empty());
        assert!(
            snapback
                .auth_invalidation
                .as_ref()
                .expect("installed invalidation")
                .obligations
                .active_subscription_scopes_for_test()
                .is_empty()
        );

        let predecessor = snapback
            .subscribe_live_with_invalidation("listItems", subscribe(301, None), invalidation())
            .expect("establish predecessor");
        let predecessor_scope = predecessor
            .authorization_scope
            .clone()
            .expect("auth-scoped predecessor");

        FAIL_NEXT_SCOPE_RETIREMENT_AUTH.with(|fail| fail.set(true));
        assert_eq!(
            snapback
                .subscribe_live_with_invalidation(
                    "listItems",
                    subscribe(302, Some(predecessor.subscription_id.clone())),
                    invalidation(),
                )
                .expect_err("failed retirement authentication preserves predecessor")
                .diagnostic
                .code,
            "SNAPBACK_TEST_SCOPE_RETIREMENT_AUTH_FAILED"
        );
        assert_eq!(snapback.subscriptions.len(), 1);
        assert!(
            snapback
                .subscriptions
                .contains_key(&predecessor.subscription_id)
        );
        assert_eq!(
            snapback
                .auth_invalidation
                .as_ref()
                .expect("installed invalidation")
                .obligations
                .active_subscription_scopes_for_test(),
            vec![predecessor_scope.clone()]
        );

        FAIL_NEXT_SCOPE_RETIREMENT_AUTH.with(|fail| fail.set(true));
        assert_eq!(
            snapback
                .unsubscribe_live_prepared(
                    "listItems",
                    LiveUnsubscribeInput {
                        subscription_id: predecessor.subscription_id.clone(),
                        connection_id: "scope-rollback".to_owned(),
                        auth: AuthInput::default(),
                    },
                    test_session_authority(InvocationSource::LiveUnsubscribe),
                    Some(&fence),
                )
                .expect_err("failed retirement authentication precedes removal")
                .diagnostic
                .code,
            "SNAPBACK_TEST_SCOPE_RETIREMENT_AUTH_FAILED"
        );
        assert!(
            snapback
                .subscriptions
                .contains_key(&predecessor.subscription_id)
        );
        assert_eq!(
            snapback
                .auth_invalidation
                .as_ref()
                .expect("installed invalidation")
                .obligations
                .active_subscription_scopes_for_test(),
            vec![predecessor_scope]
        );
    }

    /// A rerun already staged when revocation retired its subscription may
    /// still finish computing. Its effect remains predecessor-owned and can
    /// never cross a successor drain on the same readable id.
    #[test]
    fn post_revocation_rerun_cannot_publish_into_reused_connection() {
        let mut snapback = live_limit_snapback();
        let connection = install_test_invalidation(&mut snapback);
        let predecessor = crate::ephemeral::ConnectionEffectFence::session(
            "incarnation",
            "grant-old",
            "session",
            1,
        );
        let successor = crate::ephemeral::ConnectionEffectFence::session(
            "incarnation",
            "grant-new",
            "session",
            2,
        );
        let output = snapback
            .subscribe_live_with_invalidation(
                "listItems",
                LiveSubscribeInput {
                    connection_id: "reused-rerun".to_owned(),
                    input: HandlerInput::default(),
                    authorization_namespace: Some(test_authorization_namespace(91)),
                    supersedes: None,
                    resume_from_token: None,
                },
                LiveInvalidationAdmission {
                    connection: Some(connection),
                    effect_fence: Some(predecessor.clone()),
                    session_mode: true,
                },
            )
            .expect("predecessor subscription");
        let stale = snapback
            .subscriptions
            .get(&output.subscription_id)
            .expect("retained predecessor")
            .clone();

        snapback.purge_connection_effects("reused-rerun", &predecessor);
        assert!(!snapback.subscriptions.contains_key(&output.subscription_id));
        snapback.enqueue_subscription_durable(&stale, b"stale-rerun".to_vec());
        let mut replacement = stale;
        replacement.effect_fence = Some(successor.clone());
        snapback.enqueue_subscription_durable(&replacement, b"successor".to_vec());

        let payloads = snapback
            .ephemeral
            .drain_outbox_for_send_bound("reused-rerun", &successor)
            .into_iter()
            .filter_map(|admitted| match admitted.into_parts().0 {
                crate::ephemeral::RealtimeEnvelope::Durable(message) => Some(message.payload),
                crate::ephemeral::RealtimeEnvelope::Ephemeral(_) => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(payloads, vec![b"successor".to_vec()]);
    }

    #[test]
    fn live_resume_requires_the_exact_connection_grant() {
        let mut snapback = live_limit_snapback();
        let connection = install_test_invalidation(&mut snapback);
        let owner_fence = crate::ephemeral::ConnectionEffectFence::anonymous(
            "live-owner-incarnation",
            "resume-owner-grant",
        );
        let other_fence = crate::ephemeral::ConnectionEffectFence::anonymous(
            "live-owner-incarnation",
            "resume-other-grant",
        );
        let subscribed = snapback
            .subscribe_live_with_invalidation(
                "listItems",
                LiveSubscribeInput {
                    connection_id: "resume-owner".to_owned(),
                    input: HandlerInput::default(),
                    authorization_namespace: Some(test_authorization_namespace(200)),
                    supersedes: None,
                    resume_from_token: None,
                },
                LiveInvalidationAdmission {
                    connection: Some(connection.clone()),
                    effect_fence: Some(owner_fence.clone()),
                    session_mode: true,
                },
            )
            .expect("owner subscription");
        let resume = || LiveResumeInput {
            subscription_id: subscribed.subscription_id.clone(),
            connection_id: "resume-owner".to_owned(),
            auth: AuthInput::default(),
            recorded_permission_epochs: subscribed.permission_epochs.clone(),
        };

        let error = snapback
            .resume_live_prepared_with_invalidation(
                "listItems",
                resume(),
                test_session_authority(InvocationSource::LiveResume),
                LiveInvalidationAdmission {
                    connection: Some(connection.clone()),
                    effect_fence: Some(other_fence),
                    session_mode: true,
                },
            )
            .expect_err("same authority under another grant cannot resume");
        assert_eq!(error.diagnostic.code, "SNAPBACK_LIVE_RESUME_OWNERSHIP");
        assert_eq!(
            snapback
                .subscriptions
                .get(&subscribed.subscription_id)
                .expect("failed hijack preserves owner")
                .effect_fence
                .as_ref(),
            Some(&owner_fence),
        );

        let resumed = snapback
            .resume_live_prepared_with_invalidation(
                "listItems",
                resume(),
                test_session_authority(InvocationSource::LiveResume),
                LiveInvalidationAdmission {
                    connection: Some(connection),
                    effect_fence: Some(owner_fence),
                    session_mode: true,
                },
            )
            .expect("the exact owner grant may resume");
        assert_eq!(resumed.subscription_id, subscribed.subscription_id);
    }

    #[test]
    fn live_unsubscribe_requires_the_exact_connection_grant() {
        let mut snapback = live_limit_snapback();
        let connection = install_test_invalidation(&mut snapback);
        let owner_fence = crate::ephemeral::ConnectionEffectFence::anonymous(
            "live-owner-incarnation",
            "unsubscribe-owner-grant",
        );
        let other_fence = crate::ephemeral::ConnectionEffectFence::anonymous(
            "live-owner-incarnation",
            "unsubscribe-other-grant",
        );
        let subscribed = snapback
            .subscribe_live_with_invalidation(
                "listItems",
                LiveSubscribeInput {
                    connection_id: "unsubscribe-owner".to_owned(),
                    input: HandlerInput::default(),
                    authorization_namespace: Some(test_authorization_namespace(201)),
                    supersedes: None,
                    resume_from_token: None,
                },
                LiveInvalidationAdmission {
                    connection: Some(connection),
                    effect_fence: Some(owner_fence.clone()),
                    session_mode: true,
                },
            )
            .expect("owner subscription");
        let unsubscribe = || LiveUnsubscribeInput {
            subscription_id: subscribed.subscription_id.clone(),
            connection_id: "unsubscribe-owner".to_owned(),
            auth: AuthInput::default(),
        };

        let error = snapback
            .unsubscribe_live_prepared(
                "listItems",
                unsubscribe(),
                test_session_authority(InvocationSource::LiveUnsubscribe),
                Some(&other_fence),
            )
            .expect_err("same authority under another grant cannot unsubscribe");
        assert_eq!(error.diagnostic.code, "SNAPBACK_LIVE_RESUME_OWNERSHIP");
        assert!(
            snapback
                .subscriptions
                .contains_key(&subscribed.subscription_id)
        );

        let disposed = snapback
            .unsubscribe_live_prepared(
                "listItems",
                unsubscribe(),
                test_session_authority(InvocationSource::LiveUnsubscribe),
                Some(&owner_fence),
            )
            .expect("the exact owner grant may unsubscribe");
        assert!(disposed.disposed);
        assert!(
            !snapback
                .subscriptions
                .contains_key(&subscribed.subscription_id)
        );
    }

    #[test]
    fn live_unsubscribe_owner_survives_session_deadline_extension() {
        let mut snapback = live_limit_snapback();
        let connection = install_test_invalidation(&mut snapback);
        let owner_fence = crate::ephemeral::ConnectionEffectFence::session(
            "live-owner-incarnation",
            "deadline-owner-grant",
            "live-owner-session",
            7,
        );
        let other_fence = crate::ephemeral::ConnectionEffectFence::session(
            "live-owner-incarnation",
            "deadline-other-grant",
            "live-owner-session",
            7,
        );
        let subscribed = snapback
            .subscribe_live_prepared_with_invalidation(
                "listItems",
                LiveSubscribeInput {
                    connection_id: "deadline-owner".to_owned(),
                    input: HandlerInput::default(),
                    authorization_namespace: Some(test_authorization_namespace(202)),
                    supersedes: None,
                    resume_from_token: None,
                },
                test_live_session_authority(
                    InvocationSource::LiveInitialQuery,
                    "live-owner-user",
                    7,
                    10_000,
                    Some(9_000),
                ),
                LiveInvalidationAdmission {
                    connection: Some(connection),
                    effect_fence: Some(owner_fence.clone()),
                    session_mode: true,
                },
            )
            .expect("subscribe under the predecessor deadline snapshot");
        let unsubscribe = || LiveUnsubscribeInput {
            subscription_id: subscribed.subscription_id.clone(),
            connection_id: "deadline-owner".to_owned(),
            auth: AuthInput::default(),
        };

        for (label, authority, fence) in [
            (
                "generation",
                test_live_session_authority(
                    InvocationSource::LiveUnsubscribe,
                    "live-owner-user",
                    8,
                    20_000,
                    Some(19_000),
                ),
                &owner_fence,
            ),
            (
                "user",
                test_live_session_authority(
                    InvocationSource::LiveUnsubscribe,
                    "other-live-owner-user",
                    7,
                    20_000,
                    Some(19_000),
                ),
                &owner_fence,
            ),
            (
                "connection grant",
                test_live_session_authority(
                    InvocationSource::LiveUnsubscribe,
                    "live-owner-user",
                    7,
                    20_000,
                    Some(19_000),
                ),
                &other_fence,
            ),
        ] {
            let error = snapback
                .unsubscribe_live_prepared("listItems", unsubscribe(), authority, Some(fence))
                .expect_err(&format!("a changed {label} cannot unsubscribe"));
            assert_eq!(error.diagnostic.code, "SNAPBACK_LIVE_RESUME_OWNERSHIP");
            assert!(
                snapback
                    .subscriptions
                    .contains_key(&subscribed.subscription_id),
                "a refused {label} owner must preserve the subscription",
            );
        }

        let disposed = snapback
            .unsubscribe_live_prepared(
                "listItems",
                unsubscribe(),
                test_live_session_authority(
                    InvocationSource::LiveUnsubscribe,
                    "live-owner-user",
                    7,
                    20_000,
                    Some(19_000),
                ),
                Some(&owner_fence),
            )
            .expect("the stable session key and exact grant survive deadline extension");
        assert!(disposed.disposed);
        assert!(
            !snapback
                .subscriptions
                .contains_key(&subscribed.subscription_id)
        );
    }

    #[test]
    fn live_supersession_requires_the_exact_connection_grant() {
        let mut snapback = live_limit_snapback();
        let connection = install_test_invalidation(&mut snapback);
        let owner_fence = crate::ephemeral::ConnectionEffectFence::anonymous(
            "live-owner-incarnation",
            "supersede-owner-grant",
        );
        let other_fence = crate::ephemeral::ConnectionEffectFence::anonymous(
            "live-owner-incarnation",
            "supersede-other-grant",
        );
        let subscribed = snapback
            .subscribe_live_with_invalidation(
                "listItems",
                LiveSubscribeInput {
                    connection_id: "supersede-owner".to_owned(),
                    input: HandlerInput::default(),
                    authorization_namespace: Some(test_authorization_namespace(202)),
                    supersedes: None,
                    resume_from_token: None,
                },
                LiveInvalidationAdmission {
                    connection: Some(connection.clone()),
                    effect_fence: Some(owner_fence.clone()),
                    session_mode: true,
                },
            )
            .expect("owner subscription");
        let replacement = |instance| LiveSubscribeInput {
            connection_id: "supersede-owner".to_owned(),
            input: HandlerInput::default(),
            authorization_namespace: Some(test_authorization_namespace(instance)),
            supersedes: Some(subscribed.subscription_id.clone()),
            resume_from_token: None,
        };

        let error = snapback
            .subscribe_live_with_invalidation(
                "listItems",
                replacement(203),
                LiveInvalidationAdmission {
                    connection: Some(connection.clone()),
                    effect_fence: Some(other_fence),
                    session_mode: true,
                },
            )
            .expect_err("same authority under another grant cannot supersede");
        assert_eq!(error.diagnostic.code, "SNAPBACK_LIVE_RESUME_OWNERSHIP");
        assert_eq!(snapback.subscriptions.len(), 1);
        assert!(
            snapback
                .subscriptions
                .contains_key(&subscribed.subscription_id)
        );

        let successor = snapback
            .subscribe_live_with_invalidation(
                "listItems",
                replacement(204),
                LiveInvalidationAdmission {
                    connection: Some(connection),
                    effect_fence: Some(owner_fence),
                    session_mode: true,
                },
            )
            .expect("the exact owner grant may supersede");
        assert_ne!(successor.subscription_id, subscribed.subscription_id);
        assert_eq!(snapback.subscriptions.len(), 1);
        assert!(
            !snapback
                .subscriptions
                .contains_key(&subscribed.subscription_id)
        );
        assert!(
            snapback
                .subscriptions
                .contains_key(&successor.subscription_id)
        );
    }

    #[test]
    fn terminal_topology_purge_does_not_reenter_room_or_outbox_cleanup() {
        let mut snapback = live_limit_snapback();
        let connection = install_test_invalidation(&mut snapback);
        let fence = crate::ephemeral::ConnectionEffectFence::session(
            "incarnation",
            "grant-old",
            "session",
            1,
        );
        let output = snapback
            .subscribe_live_with_invalidation(
                "listItems",
                LiveSubscribeInput {
                    connection_id: "split-terminal-purge".to_owned(),
                    input: HandlerInput::default(),
                    authorization_namespace: Some(test_authorization_namespace(92)),
                    supersedes: None,
                    resume_from_token: None,
                },
                LiveInvalidationAdmission {
                    connection: Some(connection),
                    effect_fence: Some(fence.clone()),
                    session_mode: true,
                },
            )
            .expect("predecessor subscription");
        snapback.ephemeral.enqueue_durable_bound(
            "split-terminal-purge",
            b"predecessor-effect".to_vec(),
            fence.clone(),
        );

        snapback.purge_connection_topology("split-terminal-purge", &fence);
        assert!(!snapback.subscriptions.contains_key(&output.subscription_id));
        assert!(
            snapback.ephemeral.diagnostics().pending_durable_messages > 0,
            "global topology retirement deliberately leaves lock-free effect cleanup to its caller"
        );

        snapback
            .ephemeral
            .purge_connection_effects("split-terminal-purge", &fence);
        assert!(
            snapback
                .ephemeral
                .drain_outbox_for_send_bound("split-terminal-purge", &fence)
                .is_empty()
        );
    }

    #[test]
    fn changed_invalidation_generation_live_resume_keeps_exact_grant_owner() {
        let mut snapback = live_limit_snapback();
        let connection = install_test_invalidation(&mut snapback);
        let owner_fence = crate::ephemeral::ConnectionEffectFence::session(
            "incarnation",
            "grant-owner",
            "session",
            1,
        );
        let subscribed = snapback
            .subscribe_live_with_invalidation(
                "listItems",
                LiveSubscribeInput {
                    connection_id: "reused-resume".to_owned(),
                    input: HandlerInput::default(),
                    authorization_namespace: Some(test_authorization_namespace(92)),
                    supersedes: None,
                    resume_from_token: None,
                },
                LiveInvalidationAdmission {
                    connection: Some(connection.clone()),
                    effect_fence: Some(owner_fence.clone()),
                    session_mode: true,
                },
            )
            .expect("predecessor subscription");
        let predecessor_scope = subscribed
            .authorization_scope
            .clone()
            .expect("auth-scoped predecessor");
        let mut successor_connection = connection;
        successor_connection.connection_generation = successor_connection
            .connection_generation
            .checked_add(1)
            .expect("test connection generation");

        let output = snapback
            .resume_live_prepared_with_invalidation(
                "listItems",
                LiveResumeInput {
                    subscription_id: subscribed.subscription_id.clone(),
                    connection_id: "reused-resume".to_owned(),
                    auth: AuthInput::default(),
                    recorded_permission_epochs: subscribed.permission_epochs,
                },
                test_session_authority(InvocationSource::LiveResume),
                LiveInvalidationAdmission {
                    connection: Some(successor_connection.clone()),
                    effect_fence: Some(owner_fence.clone()),
                    session_mode: true,
                },
            )
            .expect("successor resume");
        let successor_scope = output
            .authorization_scope
            .clone()
            .expect("auth-scoped successor");
        assert_ne!(successor_scope, predecessor_scope);
        assert!(matches!(
            &successor_scope,
            ScopeId::Subscription {
                connection_generation,
                ..
            } if *connection_generation == successor_connection.connection_generation
        ));
        assert_eq!(output.scope_retirements.len(), 1);
        assert_eq!(
            output.scope_retirements[0].retire_through_scope_sequence,
            match predecessor_scope {
                ScopeId::Subscription { scope_sequence, .. } => scope_sequence,
                _ => unreachable!("subscription scope"),
            },
        );

        let resumed = snapback
            .subscriptions
            .get(&subscribed.subscription_id)
            .expect("retained successor")
            .clone();
        assert_eq!(resumed.effect_fence.as_ref(), Some(&owner_fence));
        assert_eq!(
            resumed
                .authorization
                .as_ref()
                .expect("successor authorization")
                .scope_id,
            successor_scope,
        );
        assert_eq!(
            snapback
                .auth_invalidation
                .as_ref()
                .expect("installed invalidation state")
                .obligations
                .active_subscription_scopes_for_test(),
            vec![successor_scope],
        );
        snapback.enqueue_subscription_durable(&resumed, b"after-resume".to_vec());
        let payloads = snapback
            .ephemeral
            .drain_outbox_for_send_bound("reused-resume", &owner_fence)
            .into_iter()
            .filter_map(|admitted| match admitted.into_parts().0 {
                crate::ephemeral::RealtimeEnvelope::Durable(message) => Some(message.payload),
                crate::ephemeral::RealtimeEnvelope::Ephemeral(_) => None,
            })
            .collect::<Vec<_>>();
        assert!(payloads.iter().any(|payload| payload == b"after-resume"));
    }

    #[test]
    fn changed_generation_failed_resume_rolls_back_unpublished_successor_scope() {
        let mut snapback = live_limit_snapback();
        let predecessor_connection = install_test_invalidation(&mut snapback);
        let predecessor_fence = crate::ephemeral::ConnectionEffectFence::session(
            "incarnation",
            "grant-old",
            "session",
            1,
        );
        let subscribed = snapback
            .subscribe_live_with_invalidation(
                "listItemsByValue",
                LiveSubscribeInput {
                    connection_id: "resume-predecessor".to_owned(),
                    input: HandlerInput {
                        args: json!({ "value": "retained" }),
                        ..HandlerInput::default()
                    },
                    authorization_namespace: Some(test_authorization_namespace(93)),
                    supersedes: None,
                    resume_from_token: None,
                },
                LiveInvalidationAdmission {
                    connection: Some(predecessor_connection.clone()),
                    effect_fence: Some(predecessor_fence.clone()),
                    session_mode: true,
                },
            )
            .expect("predecessor subscription");
        let predecessor_scope = snapback
            .subscriptions
            .get(&subscribed.subscription_id)
            .and_then(|subscription| subscription.authorization.as_ref())
            .expect("retained predecessor authority")
            .scope_id
            .clone();

        // Force only the resume-side fresh query to fail after retained state
        // and its predecessor scope already exist.
        snapback
            .subscriptions
            .get_mut(&subscribed.subscription_id)
            .expect("retained predecessor")
            .input
            .args = json!({});
        let mut successor_connection = predecessor_connection;
        successor_connection.connection_generation = successor_connection
            .connection_generation
            .checked_add(1)
            .expect("test connection generation");
        let resume = || LiveResumeInput {
            subscription_id: subscribed.subscription_id.clone(),
            connection_id: "resume-successor".to_owned(),
            auth: AuthInput::default(),
            recorded_permission_epochs: subscribed.permission_epochs.clone(),
        };

        for _ in 0..2 {
            let error = snapback
                .resume_live_prepared_with_invalidation(
                    "listItemsByValue",
                    resume(),
                    test_session_authority(InvocationSource::LiveResume),
                    LiveInvalidationAdmission {
                        connection: Some(successor_connection.clone()),
                        effect_fence: Some(predecessor_fence.clone()),
                        session_mode: true,
                    },
                )
                .expect_err("the resume-side query is deliberately invalid");
            assert!(matches!(
                error.diagnostic.code.as_str(),
                "SNAPBACK_ARG_MISSING" | "SNAPBACK_AUTH_RETRY_EXHAUSTED"
            ));

            let stored = snapback
                .subscriptions
                .get(&subscribed.subscription_id)
                .expect("failed resume keeps the exact predecessor owner");
            assert_eq!(stored.connection_id, "resume-predecessor");
            assert_eq!(stored.effect_fence.as_ref(), Some(&predecessor_fence));
            let scope = stored
                .authorization
                .as_ref()
                .expect("auth-scoped retained owner")
                .scope_id
                .clone();
            assert_eq!(scope, predecessor_scope);

            let obligations = &snapback
                .auth_invalidation
                .as_ref()
                .expect("installed invalidation state")
                .obligations;
            let pending = obligations.pending_all();
            assert_eq!(pending.len(), 1, "one retained owner has one obligation");
            assert_eq!(pending[0].scope_id, predecessor_scope);
            assert_eq!(
                obligations.active_subscription_scopes_for_test(),
                vec![predecessor_scope.clone()],
                "failed attempts must not retain registered-but-unowned successors",
            );

            // An Err response has no authenticated scope-retirement field. It
            // therefore must not expose the replacement identity through the
            // successor outbox either: client custody continues to own exactly
            // the predecessor scope and needs no missing retirement frontier.
            assert!(
                snapback
                    .ephemeral
                    .drain_outbox_for_send_bound("resume-successor", &predecessor_fence)
                    .is_empty(),
                "an unpublished replacement cannot escape on its successor fence",
            );
        }

        snapback.purge_connection_effects("resume-predecessor", &predecessor_fence);
        assert!(
            !snapback
                .subscriptions
                .contains_key(&subscribed.subscription_id)
        );
        let obligations = &snapback
            .auth_invalidation
            .as_ref()
            .expect("installed invalidation state")
            .obligations;
        assert!(
            obligations.pending_all().is_empty(),
            "predecessor cleanup owner must retire its only obligation"
        );
        assert!(
            obligations.active_subscription_scopes_for_test().is_empty(),
            "predecessor cleanup must retire its only active scope"
        );
    }

    #[test]
    fn same_scope_failed_resume_keeps_failure_hint_on_retained_effect_fence() {
        let mut snapback = live_limit_snapback();
        let connection = install_test_invalidation(&mut snapback);
        let predecessor_fence = crate::ephemeral::ConnectionEffectFence::session(
            "incarnation",
            "grant-old",
            "session",
            1,
        );
        let subscribed = snapback
            .subscribe_live_with_invalidation(
                "listItemsByValue",
                LiveSubscribeInput {
                    connection_id: "same-scope-predecessor".to_owned(),
                    input: HandlerInput {
                        args: json!({ "value": "retained" }),
                        ..HandlerInput::default()
                    },
                    authorization_namespace: Some(test_authorization_namespace(94)),
                    supersedes: None,
                    resume_from_token: None,
                },
                LiveInvalidationAdmission {
                    connection: Some(connection.clone()),
                    effect_fence: Some(predecessor_fence.clone()),
                    session_mode: true,
                },
            )
            .expect("predecessor subscription");
        let predecessor_scope = subscribed
            .authorization_scope
            .clone()
            .expect("auth-scoped predecessor");
        snapback
            .subscriptions
            .get_mut(&subscribed.subscription_id)
            .expect("retained predecessor")
            .input
            .args = json!({});

        snapback
            .resume_live_prepared_with_invalidation(
                "listItemsByValue",
                LiveResumeInput {
                    subscription_id: subscribed.subscription_id.clone(),
                    connection_id: "same-scope-predecessor".to_owned(),
                    auth: AuthInput::default(),
                    recorded_permission_epochs: subscribed.permission_epochs,
                },
                test_session_authority(InvocationSource::LiveResume),
                LiveInvalidationAdmission {
                    connection: Some(connection),
                    effect_fence: Some(predecessor_fence.clone()),
                    session_mode: true,
                },
            )
            .expect_err("the resume-side query is deliberately invalid");

        let stored = snapback
            .subscriptions
            .get(&subscribed.subscription_id)
            .expect("failed resume keeps predecessor owner");
        assert_eq!(stored.connection_id, "same-scope-predecessor");
        assert_eq!(stored.effect_fence.as_ref(), Some(&predecessor_fence));
        assert_eq!(
            stored
                .authorization
                .as_ref()
                .expect("retained authorization")
                .scope_id,
            predecessor_scope,
        );
        assert!(
            !snapback
                .ephemeral
                .drain_outbox_for_send_bound("same-scope-predecessor", &predecessor_fence)
                .is_empty(),
            "the retained predecessor fence receives the fail-closed hint",
        );
    }

    // ------------------------------------------------------------------
    // RQS resumeFromToken admission, rungs 1 & 3, token refresh (LLP 0090
    // rollout step 1; contract LLP 0091). Acceptance list: LLP 0090
    // "Rollout sketch" step 1.
    // ------------------------------------------------------------------

    fn rqs_schema() -> SchemaManifest {
        SchemaManifest {
            schema_hash: Some("rqs-schema-v0".to_owned()),
            tables: vec![TableManifest {
                name: "todos".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "title".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "rank".to_owned(),
                        field_type: FieldType::Integer,
                        optional: true,
                    },
                ],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                membership: None,
            }],
            ..SchemaManifest::default()
        }
    }

    fn rqs_public_live_query(name: &str, ordered: bool) -> FunctionDefinition {
        let mut function = FunctionDefinition::new(
            name,
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table: "todos".to_owned(),
                filters: Vec::new(),
                order: if ordered {
                    vec![crate::manifest::OrderExpr {
                        field: "rank".to_owned(),
                        direction: crate::manifest::OrderDirection::Asc,
                    }]
                } else {
                    Vec::new()
                },
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            })),
        );
        function.authority_independent = true;
        function.auth_requirement = Some(crate::manifest::AuthRequirement::Public);
        // The LLP 0092 §0C.2 closed-inputs proof: eligibility derivation
        // requires the complete `singleTable` summary codegen always emits.
        function.read_set_summary = crate::manifest::DependencySummary {
            primary_table: Some("todos".to_owned()),
            tables: vec!["todos".to_owned()],
            mode: Some("singleTable".to_owned()),
            auth_scope_field: None,
        };
        function
    }

    fn rqs_functions() -> FunctionManifest {
        let create = FunctionDefinition::new(
            "createTodo",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                steps: vec![MutationStep::Insert {
                    table: "todos".to_owned(),
                    values: BTreeMap::from([
                        ("title".to_owned(), ValueExpr::Arg("title".to_owned())),
                        (
                            "rank".to_owned(),
                            ValueExpr::Literal(Value::Number(1.into())),
                        ),
                    ]),
                    bind_id_as: Some("todoId".to_owned()),
                }],
                return_value: Some(crate::manifest::ReturnValue::Binding("todoId".to_owned())),
            })),
        );
        let mut scoped = FunctionDefinition::new(
            "listMineOnly",
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table: "todos".to_owned(),
                filters: vec![FilterExpr {
                    field: "title".to_owned(),
                    op: FilterOp::Eq,
                    value: ValueExpr::AuthUserId,
                }],
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            })),
        );
        scoped.authorization_dependence =
            vec![crate::manifest::AuthorizationInputDimension::UserId];
        // Predicate-scoped public query for the rung-2 exit fixtures: only
        // rank == 1 rows are in the result, so a rank change is a predicate
        // exit (the row still exists, but left the result while offline).
        let mut visible = rqs_public_live_query("listVisibleTodos", false);
        if let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &mut visible.runtime {
            plan.filters.push(FilterExpr {
                field: "rank".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Literal(Value::Number(1.into())),
            });
        }
        let set_rank = FunctionDefinition::new(
            "setRank",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                steps: vec![MutationStep::Patch {
                    table: "todos".to_owned(),
                    id: ValueExpr::Arg("id".to_owned()),
                    values: BTreeMap::from([("rank".to_owned(), ValueExpr::Arg("rank".to_owned()))]),
                }],
                return_value: None,
            })),
        );
        let set_title = FunctionDefinition::new(
            "setTitle",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                steps: vec![MutationStep::Patch {
                    table: "todos".to_owned(),
                    id: ValueExpr::Arg("id".to_owned()),
                    values: BTreeMap::from([(
                        "title".to_owned(),
                        ValueExpr::Arg("title".to_owned()),
                    )]),
                }],
                return_value: None,
            })),
        );
        FunctionManifest {
            bundle_hash: Some("rqs-functions-v0".to_owned()),
            functions: vec![
                rqs_public_live_query("listPublicTodos", false),
                rqs_public_live_query("listRankedTodos", true),
                visible,
                scoped,
                create,
                set_rank,
                set_title,
            ],
            ..FunctionManifest::default()
        }
    }

    fn rqs_snapback() -> LocalSnapback {
        let mut snapback = LocalSnapback::memory().expect("memory snapback");
        snapback.apply_schema(rqs_schema()).expect("apply schema");
        let diagnostics = snapback.load_functions(rqs_functions());
        assert!(
            diagnostics
                .iter()
                .all(|diagnostic| diagnostic.code == "SNAPBACK_IBEX_CLI_UNAVAILABLE"),
            "unexpected load diagnostics: {diagnostics:?}"
        );
        snapback
    }

    fn rqs_subscribe_input(
        connection_id: &str,
        resume: Option<crate::live_wire::ResumeFromToken>,
    ) -> LiveSubscribeInput {
        LiveSubscribeInput {
            connection_id: connection_id.to_owned(),
            input: HandlerInput::default(),
            authorization_namespace: None,
            supersedes: None,
            resume_from_token: resume,
        }
    }

    fn rqs_wrap(resume: crate::live_wire::ResumeWire) -> Option<crate::live_wire::ResumeFromToken> {
        Some(crate::live_wire::ResumeFromToken {
            resume,
            membership_witness: None,
        })
    }

    fn rqs_wrap_with_witness(
        resume: crate::live_wire::ResumeWire,
        witness: crate::live_wire::MembershipWitnessWire,
    ) -> Option<crate::live_wire::ResumeFromToken> {
        Some(crate::live_wire::ResumeFromToken {
            resume,
            membership_witness: Some(witness),
        })
    }

    /// The witness a well-behaved client derives from held wire rows: exact
    /// `(rowId, oldRowHash)` pairs in ascending id order with an explicit
    /// count (LLP 0091 rung-2 amendment).
    fn rqs_witness_of_rows(rows: &[Value]) -> crate::live_wire::MembershipWitnessWire {
        use base64::Engine as _;
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        let mut entries: Vec<crate::live_wire::MembershipWitnessEntry> = rows
            .iter()
            .map(|row| crate::live_wire::MembershipWitnessEntry {
                id: crate::rqs::row_wire_id(row).expect("wire row id").to_owned(),
                old_row_hash: URL_SAFE_NO_PAD.encode(crate::rqs::row_hash(row).expect("row hash")),
            })
            .collect();
        entries.sort_by(|a, b| a.id.encode_utf16().cmp(b.id.encode_utf16()));
        crate::live_wire::MembershipWitnessWire {
            count: entries.len() as u32,
            entries,
        }
    }

    fn rqs_user_input(user_id: &str) -> HandlerInput {
        HandlerInput {
            auth: AuthInput {
                principal: Some(user_id.to_owned()),
                user_id: Some(user_id.to_owned()),
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        }
    }

    fn rqs_drained_envelopes(snapback: &mut LocalSnapback, connection_id: &str) -> Vec<Value> {
        snapback
            .drain_live_stream(connection_id)
            .into_iter()
            .map(|text| serde_json::from_str(&text).expect("durable envelope json"))
            .collect()
    }

    fn rqs_resume_from_value(value: &Value) -> crate::live_wire::ResumeWire {
        serde_json::from_value(value.clone()).expect("resume wire decodes")
    }

    #[test]
    fn rqs_interim_eligibility_fails_closed_on_opaque_and_ambient_plans() {
        // Opaque runtime declared authority-independent: no journal proof or
        // replay is sound, so eligibility must refuse even though the
        // declaration claims independence (LLP 0090 Authorization scope).
        let mut opaque = FunctionDefinition::new(
            "opaqueDeclared",
            FunctionKind::LiveQuery,
            FunctionRuntime::IbexModule(IbexModule {
                source: "globalThis.__snapbackHandlers = {};".to_owned(),
                export: "opaqueDeclared".to_owned(),
            }),
        );
        opaque.authority_independent = true;
        opaque.auth_requirement = Some(crate::manifest::AuthRequirement::Public);
        assert!(super::rqs_eligibility(&opaque).is_none());

        // Time-dependent filter (RuntimeNow): not a pure function of
        // (database state, args) — fail closed.
        let mut time_dependent = rqs_public_live_query("timeDependent", false);
        if let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &mut time_dependent.runtime {
            plan.filters.push(FilterExpr {
                field: "rank".to_owned(),
                op: FilterOp::Lt,
                value: ValueExpr::RuntimeNow,
            });
        }
        assert!(super::rqs_eligibility(&time_dependent).is_none());

        // Undeclared queries stay ineligible; declared unordered takes mset1
        // and ordered takes seq1 (the LLP 0091 §0A.4 kind selector).
        assert!(
            super::rqs_eligibility(&FunctionDefinition::new(
                "undeclared",
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table: "todos".to_owned(),
                    filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                })),
            ))
            .is_none()
        );
        assert_eq!(
            super::rqs_eligibility(&rqs_public_live_query("u", false)),
            Some(crate::rqs::DigestKind::Mset1)
        );
        assert_eq!(
            super::rqs_eligibility(&rqs_public_live_query("o", true)),
            Some(crate::rqs::DigestKind::Seq1)
        );
    }

    #[test]
    fn rqs_idle_resume_answers_current_as_of_with_zero_rows_and_token_advance() {
        let mut snapback = rqs_snapback();
        let first = snapback
            .subscribe_live("listPublicTodos", rqs_subscribe_input("conn-a", None))
            .expect("fresh subscribe");
        let minted = first
            .resume
            .clone()
            .expect("eligible subscribe mints a token");
        assert!(minted.token.starts_with("sbrt1.sbrq_"));
        assert_eq!(
            minted.meta.version,
            first.snapshot.as_ref().unwrap().version
        );
        assert!(minted.meta.content_digest.starts_with("mset1:"));

        // Idle resume: nothing committed since the token — rung 1.
        let resumed = snapback
            .subscribe_live(
                "listPublicTodos",
                rqs_subscribe_input("conn-b", rqs_wrap(minted.clone())),
            )
            .expect("token resume subscribe");
        assert!(resumed.snapshot.is_none(), "rung 1 sends zero rows");
        assert!(
            resumed.resume.is_none(),
            "the fresh token rides CurrentAsOf"
        );
        assert_eq!(resumed.resume_refusal, None);
        let envelopes = rqs_drained_envelopes(&mut snapback, "conn-b");
        assert_eq!(envelopes.len(), 1);
        assert_eq!(envelopes[0]["kind"], "current_as_of");
        assert_eq!(
            envelopes[0]["subscription_id"],
            json!(resumed.subscription_id)
        );
        assert_eq!(envelopes[0]["version"], minted.meta.version);
        // The fresh token is minted at the same (version, digest) — its
        // bytes differ only by issuedAt, so two mints inside one millisecond
        // are legitimately identical (the shared-mint rule). Assert the
        // advance semantics, not byte inequality.
        let advanced = rqs_resume_from_value(&envelopes[0]["resume"]);
        assert!(advanced.token.starts_with("sbrt1.sbrq_"));
        assert_eq!(advanced.meta.version, minted.meta.version);
        assert_eq!(advanced.meta.content_digest, minted.meta.content_digest);

        let stats = &snapback.live_delivery.resume;
        assert_eq!(stats.attempted, 1);
        assert_eq!(stats.current_as_of_answers, 1);
        assert_eq!(stats.fresh_replace_answers, 0);
        assert_eq!(stats.last_journal_distance, 0);
    }

    #[test]
    fn rqs_tokens_refresh_across_delta_replace_and_current_as_of() {
        let mut snapback = rqs_snapback();
        // Unordered (mset1) subscription refreshes through live_delta.
        let unordered = snapback
            .subscribe_live("listPublicTodos", rqs_subscribe_input("conn-a", None))
            .expect("subscribe unordered");
        let initial = unordered.resume.clone().expect("initial mint");
        // Ordered (seq1) subscription refreshes through live_replace.
        let ordered = snapback
            .subscribe_live("listRankedTodos", rqs_subscribe_input("conn-a", None))
            .expect("subscribe ordered");
        let ordered_initial = ordered.resume.clone().expect("ordered initial mint");
        assert!(ordered_initial.meta.content_digest.starts_with("seq1:"));

        snapback
            .invoke_mutation(
                "createTodo",
                HandlerInput {
                    args: json!({ "title": "one" }),
                    ..HandlerInput::default()
                },
            )
            .expect("create todo");

        let envelopes = rqs_drained_envelopes(&mut snapback, "conn-a");
        assert_eq!(envelopes.len(), 2);
        let delta = envelopes
            .iter()
            .find(|envelope| envelope["kind"] == "live_delta")
            .expect("unordered subscription refreshes via delta");
        let replace = envelopes
            .iter()
            .find(|envelope| envelope["kind"] == "live_replace")
            .expect("ordered subscription refreshes via replace");
        let refreshed = rqs_resume_from_value(&delta["resume"]);
        assert_eq!(refreshed.meta.version, delta["version"].as_u64().unwrap());
        assert_ne!(refreshed.meta.content_digest, initial.meta.content_digest);
        let ordered_refreshed = rqs_resume_from_value(&replace["resume"]);
        assert!(ordered_refreshed.meta.content_digest.starts_with("seq1:"));
        assert_ne!(
            ordered_refreshed.meta.content_digest,
            ordered_initial.meta.content_digest
        );

        // The refreshed delta token resumes rung-1 — and CurrentAsOf itself
        // carries the next fresh token (the third refresh boundary).
        let resumed = snapback
            .subscribe_live(
                "listPublicTodos",
                rqs_subscribe_input("conn-b", rqs_wrap(refreshed.clone())),
            )
            .expect("resume at refreshed token");
        assert!(resumed.snapshot.is_none());
        let envelopes = rqs_drained_envelopes(&mut snapback, "conn-b");
        assert_eq!(envelopes[0]["kind"], "current_as_of");
        let advanced = rqs_resume_from_value(&envelopes[0]["resume"]);
        assert!(advanced.token.starts_with("sbrt1.sbrq_"));
        assert_eq!(advanced.meta.content_digest, refreshed.meta.content_digest);
    }

    #[test]
    fn rqs_stale_token_takes_rung3_and_table_set_falls_through_without_summary() {
        let mut snapback = rqs_snapback();
        let first = snapback
            .subscribe_live("listPublicTodos", rqs_subscribe_input("conn-a", None))
            .expect("subscribe");
        let stale = first.resume.clone().expect("initial mint");

        snapback
            .invoke_mutation(
                "createTodo",
                HandlerInput {
                    args: json!({ "title": "advance" }),
                    ..HandlerInput::default()
                },
            )
            .expect("advance head");

        let resumed = snapback
            .subscribe_live(
                "listPublicTodos",
                rqs_subscribe_input("conn-b", rqs_wrap(stale.clone())),
            )
            .expect("stale resume subscribe");
        // Journal floor holds, but no certified dependency summary exists
        // (cluster 0C), so the table-set arm always falls through to rung 3.
        let snapshot = resumed.snapshot.as_ref().expect("rung 3 sends rows");
        assert_eq!(snapshot.rows.len(), 1);
        assert!(resumed.resume.is_some(), "rung 3 still refreshes the token");
        assert_eq!(
            resumed.resume_refusal, None,
            "fall-through is not a refusal"
        );
        let stats = &snapback.live_delivery.resume;
        assert_eq!(stats.no_certified_summary, 1);
        assert_eq!(stats.fresh_replace_answers, 1);
        assert_eq!(stats.current_as_of_answers, 0);
        assert_eq!(stats.last_journal_distance, 1);

        // Journal floor miss: prune everything, then the same stale token
        // refuses with the floor code (still answered with rows).
        snapback
            .invoke_mutation(
                "createTodo",
                HandlerInput {
                    args: json!({ "title": "advance again" }),
                    ..HandlerInput::default()
                },
            )
            .expect("advance head again");
        snapback
            .prune_change_journal(now_millis() + 60_000, 0, 0)
            .expect("prune journal");
        let refused = snapback
            .subscribe_live(
                "listPublicTodos",
                rqs_subscribe_input("conn-c", rqs_wrap(stale)),
            )
            .expect("floor-refused resume subscribe");
        assert!(refused.snapshot.is_some());
        assert_eq!(
            refused.resume_refusal.as_deref(),
            Some("SNAPBACK_RESUME_JOURNAL_FLOOR")
        );
        assert_eq!(
            snapback.live_delivery.resume.refused["SNAPBACK_RESUME_JOURNAL_FLOOR"],
            1
        );
    }

    #[test]
    fn rqs_refusals_are_per_cause_and_never_fail_the_subscribe() {
        let mut snapback = rqs_snapback();
        let first = snapback
            .subscribe_live("listPublicTodos", rqs_subscribe_input("conn-a", None))
            .expect("subscribe");
        let good = first.resume.clone().expect("mint");

        // Malformed garbage.
        let mut garbage = good.clone();
        garbage.token = "not-a-token".to_owned();
        let refused = snapback
            .subscribe_live(
                "listPublicTodos",
                rqs_subscribe_input("conn-b", rqs_wrap(garbage)),
            )
            .expect("malformed token still subscribes");
        assert_eq!(
            refused.resume_refusal.as_deref(),
            Some("SNAPBACK_RESUME_TOKEN_MALFORMED")
        );
        assert!(refused.snapshot.is_some());

        // Args mismatch: the token binds the exact canonical args.
        let refused = snapback
            .subscribe_live(
                "listPublicTodos",
                LiveSubscribeInput {
                    connection_id: "conn-c".to_owned(),
                    input: HandlerInput {
                        args: json!({ "cursor": 5 }),
                        ..HandlerInput::default()
                    },
                    authorization_namespace: None,
                    supersedes: None,
                    resume_from_token: rqs_wrap(good.clone()),
                },
            )
            .expect("args-mismatch subscribe");
        assert_eq!(
            refused.resume_refusal.as_deref(),
            Some("SNAPBACK_RESUME_QUERY_MISMATCH")
        );

        // Hand-crafted bodies signed by the live keyring exercise the
        // remaining per-cause codes admission can reach. The base body
        // mirrors the genuinely minted token's identity axes exactly, so
        // each case's single perturbed field is the refusing axis.
        let now = now_millis();
        let base_body = crate::rqs::ResumeTokenBody {
            app: good.meta.app.clone(),
            generation: good.meta.generation.clone(),
            version_stream: good.meta.version_stream.clone(),
            version: good.meta.version,
            query_artifact: good.meta.query_artifact.clone(),
            args_hash: good.meta.args_hash.clone(),
            digest_kind: "mset1".to_owned(),
            content_digest: good.meta.content_digest.clone(),
            issued_at: now,
            auth_partition: None,
        };
        let (key_id, key) = snapback
            .resume_keyring
            .write()
            .expect("keyring lock")
            .active(now)
            .expect("active key");
        let mint = |body: &crate::rqs::ResumeTokenBody| crate::live_wire::ResumeWire {
            token: crate::rqs::mint_token_wire(key.as_ref(), &key_id, body),
            meta: crate::live_wire::ResumeMeta {
                app: body.app.clone(),
                version: body.version,
                content_digest: body.content_digest.clone(),
                generation: body.generation.clone(),
                version_stream: body.version_stream.clone(),
                query_artifact: body.query_artifact.clone(),
                args_hash: body.args_hash.clone(),
            },
        };

        let cases: Vec<(crate::rqs::ResumeTokenBody, &str)> = vec![
            (
                crate::rqs::ResumeTokenBody {
                    app: "someone-elses-app".to_owned(),
                    ..base_body.clone()
                },
                "SNAPBACK_RESUME_APP_MISMATCH",
            ),
            (
                crate::rqs::ResumeTokenBody {
                    generation: "gen1:0000".to_owned(),
                    ..base_body.clone()
                },
                "SNAPBACK_RESUME_GENERATION_STALE",
            ),
            (
                crate::rqs::ResumeTokenBody {
                    version_stream: "not-the-stream".to_owned(),
                    ..base_body.clone()
                },
                "SNAPBACK_RESUME_STREAM_MISMATCH",
            ),
            (
                crate::rqs::ResumeTokenBody {
                    digest_kind: "seq1".to_owned(),
                    ..base_body.clone()
                },
                "SNAPBACK_RESUME_DIGEST_KIND_MISMATCH",
            ),
            (
                crate::rqs::ResumeTokenBody {
                    version: 40_000,
                    ..base_body.clone()
                },
                "SNAPBACK_RESUME_VERSION_IMPLAUSIBLE",
            ),
        ];
        for (index, (body, expected)) in cases.into_iter().enumerate() {
            let wire = mint(&body);
            let refused = snapback
                .subscribe_live(
                    "listPublicTodos",
                    rqs_subscribe_input(&format!("conn-case-{index}"), rqs_wrap(wire)),
                )
                .expect("refused token still subscribes");
            assert_eq!(refused.resume_refusal.as_deref(), Some(expected));
            assert!(refused.snapshot.is_some(), "every refusal answers rung 3");
            assert_eq!(snapback.live_delivery.resume.refused[expected], 1);
        }

        // Eligibility: a well-formed token naming an auth-dependent query is
        // NOT_ELIGIBLE (its artifact/args must match that query for the
        // eligibility check to be the refusing axis).
        let scoped = snapback.function("listMineOnly").expect("function").clone();
        let scoped_artifact =
            crate::rqs::query_artifact_hash(&serde_json::to_value(&scoped).unwrap()).unwrap();
        let ineligible = crate::rqs::ResumeTokenBody {
            query_artifact: scoped_artifact,
            ..base_body.clone()
        };
        let wire = mint(&ineligible);
        let refused = snapback
            .subscribe_live(
                "listMineOnly",
                LiveSubscribeInput {
                    connection_id: "conn-ineligible".to_owned(),
                    input: rqs_user_input("user_1"),
                    authorization_namespace: None,
                    supersedes: None,
                    resume_from_token: rqs_wrap(wire),
                },
            )
            .expect("ineligible subscribe");
        assert_eq!(
            refused.resume_refusal.as_deref(),
            Some("SNAPBACK_RESUME_NOT_ELIGIBLE")
        );
        assert!(refused.resume.is_none(), "no token is ever minted for it");
    }

    #[test]
    fn rqs_auth_dependent_subscriptions_never_mint() {
        let mut snapback = rqs_snapback();
        let scoped = snapback
            .subscribe_live(
                "listMineOnly",
                LiveSubscribeInput {
                    connection_id: "conn-a".to_owned(),
                    input: rqs_user_input("user_1"),
                    authorization_namespace: None,
                    supersedes: None,
                    resume_from_token: None,
                },
            )
            .expect("subscribe auth-dependent query");
        assert!(scoped.resume.is_none());
        assert!(scoped.snapshot.is_some());
        // And its fan-out envelopes carry no resume either.
        snapback
            .invoke_mutation(
                "createTodo",
                HandlerInput {
                    args: json!({ "title": "x" }),
                    ..HandlerInput::default()
                },
            )
            .expect("mutate");
        for envelope in rqs_drained_envelopes(&mut snapback, "conn-a") {
            assert!(envelope.get("resume").is_none());
        }
        assert_eq!(snapback.live_delivery.resume.tokens_minted, 0);
    }

    #[test]
    fn rqs_mutation_after_answer_and_register_loses_no_ops() {
        let mut snapback = rqs_snapback();
        let first = snapback
            .subscribe_live("listPublicTodos", rqs_subscribe_input("conn-a", None))
            .expect("subscribe");
        let minted = first.resume.clone().expect("mint");

        // Answer-and-register happens under one &mut cut; the next mutation
        // must fan out to the resumed subscription with nothing skipped.
        let resumed = snapback
            .subscribe_live(
                "listPublicTodos",
                rqs_subscribe_input("conn-b", rqs_wrap(minted)),
            )
            .expect("resume");
        assert!(resumed.snapshot.is_none(), "rung-1 answer");

        snapback
            .invoke_mutation(
                "createTodo",
                HandlerInput {
                    args: json!({ "title": "raced" }),
                    ..HandlerInput::default()
                },
            )
            .expect("mutate after registration");

        let envelopes = rqs_drained_envelopes(&mut snapback, "conn-b");
        assert_eq!(envelopes[0]["kind"], "current_as_of");
        let delta = envelopes
            .iter()
            .find(|envelope| envelope["kind"] == "live_delta")
            .expect("the racing mutation reaches the resumed subscription");
        let ops = delta["ops"].as_array().unwrap();
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0]["op"], "add");
        assert_eq!(ops[0]["row"]["title"], "raced");
        // The delta also refreshed the token past the CurrentAsOf version.
        let refreshed = rqs_resume_from_value(&delta["resume"]);
        assert!(refreshed.meta.version > 0);
    }

    fn rqs_create_todo(snapback: &mut LocalSnapback, title: &str) {
        snapback
            .invoke_mutation(
                "createTodo",
                HandlerInput {
                    args: json!({ "title": title }),
                    ..HandlerInput::default()
                },
            )
            .expect("create todo");
    }

    fn rqs_row_id_by_title(rows: &[Value], title: &str) -> String {
        rows.iter()
            .find(|row| row["title"] == json!(title))
            .and_then(|row| row["_id"].as_str())
            .expect("row id by title")
            .to_owned()
    }

    #[test]
    fn rqs_delta_replay_resumes_including_predicate_exit_rows() {
        // LLP 0090 rollout step 6: a DK-3-eligible fixture resumes via
        // deltas, including a row that left the result while offline via a
        // predicate exit — exactly removed, never silently retained.
        let mut snapback = rqs_snapback();
        // The untouched row carries real weight so the bytes-avoided
        // estimate is visibly positive: replay never resends it.
        let keep_title = format!("keep-{}", "x".repeat(400));
        rqs_create_todo(&mut snapback, &keep_title);
        rqs_create_todo(&mut snapback, "exit");
        rqs_create_todo(&mut snapback, "change");
        let first = snapback
            .subscribe_live("listVisibleTodos", rqs_subscribe_input("conn-a", None))
            .expect("subscribe");
        let held = first.snapshot.as_ref().expect("rows").rows.clone();
        assert_eq!(held.len(), 3);
        let token = first.resume.clone().expect("mint");
        let id_exit = rqs_row_id_by_title(&held, "exit");
        let id_change = rqs_row_id_by_title(&held, "change");

        // Offline gap: one predicate exit, one content change, one enter.
        snapback
            .invoke_mutation(
                "setRank",
                HandlerInput {
                    args: json!({ "id": id_exit, "rank": 2 }),
                    ..HandlerInput::default()
                },
            )
            .expect("predicate exit");
        snapback
            .invoke_mutation(
                "setTitle",
                HandlerInput {
                    args: json!({ "id": id_change, "title": "changed" }),
                    ..HandlerInput::default()
                },
            )
            .expect("content change");
        rqs_create_todo(&mut snapback, "entered");

        let resumed = snapback
            .subscribe_live(
                "listVisibleTodos",
                rqs_subscribe_input(
                    "conn-b",
                    rqs_wrap_with_witness(token, rqs_witness_of_rows(&held)),
                ),
            )
            .expect("witness resume");
        assert!(resumed.snapshot.is_none(), "rung 2 sends no rows inline");
        assert!(resumed.resume.is_none(), "the fresh token rides the delta");
        assert_eq!(resumed.resume_refusal, None);

        let envelopes = rqs_drained_envelopes(&mut snapback, "conn-b");
        assert_eq!(envelopes.len(), 1);
        assert_eq!(envelopes[0]["kind"], "live_delta");
        let ops = envelopes[0]["ops"].as_array().unwrap();
        assert_eq!(ops.len(), 3);
        let op_for = |id: &str| {
            ops.iter()
                .find(|op| op["id"] == json!(id))
                .unwrap_or_else(|| panic!("op for {id}"))
        };
        let exit_op = op_for(&id_exit);
        assert_eq!(exit_op["op"], "remove");
        assert!(exit_op.get("row").is_none(), "removals carry no row");
        assert_eq!(op_for(&id_change)["op"], "update");
        assert_eq!(op_for(&id_change)["row"]["title"], "changed");
        let enter_op = ops
            .iter()
            .find(|op| op["op"] == "add")
            .expect("enter op");
        assert_eq!(enter_op["row"]["title"], "entered");

        // The fresh token was minted from the updated accumulator and
        // matches the exact current result (client post-replay verification
        // target, T8).
        let fresh = rqs_resume_from_value(&envelopes[0]["resume"]);
        let current = snapback
            .subscribe_live("listVisibleTodos", rqs_subscribe_input("conn-c", None))
            .expect("current snapshot");
        let expected = crate::rqs::ResultDigest::from_rows(
            crate::rqs::DigestKind::Mset1,
            &current.snapshot.as_ref().unwrap().rows,
        )
        .unwrap();
        assert_eq!(fresh.meta.content_digest, expected.published());
        assert_eq!(
            fresh.meta.version,
            envelopes[0]["version"].as_u64().unwrap()
        );

        let stats = &snapback.live_delivery.resume;
        assert_eq!(stats.attempted, 1);
        assert_eq!(stats.delta_replay_answers, 1);
        assert_eq!(stats.replay_ops, 3);
        assert!(stats.replay_bytes_avoided > 0, "3 ops beat a 3-row replace");
        assert_eq!(stats.current_as_of_answers, 0);
        assert_eq!(stats.fresh_replace_answers, 0);
    }

    #[test]
    fn rqs_delta_replay_strict_subset_mints_root_with_untouched_leaves() {
        // The accumulator-update rule (LLP 0090 D1.3, v0.6 correction): only
        // journal-affected ids are touched, so the minted root still
        // contains the untouched rows' leaves.
        let mut snapback = rqs_snapback();
        rqs_create_todo(&mut snapback, "a");
        rqs_create_todo(&mut snapback, "b");
        rqs_create_todo(&mut snapback, "c");
        let first = snapback
            .subscribe_live("listPublicTodos", rqs_subscribe_input("conn-a", None))
            .expect("subscribe");
        let held = first.snapshot.as_ref().expect("rows").rows.clone();
        let token = first.resume.clone().expect("mint");
        let id_b = rqs_row_id_by_title(&held, "b");
        snapback
            .invoke_mutation(
                "setTitle",
                HandlerInput {
                    args: json!({ "id": id_b, "title": "b2" }),
                    ..HandlerInput::default()
                },
            )
            .expect("strict-subset change");

        let resumed = snapback
            .subscribe_live(
                "listPublicTodos",
                rqs_subscribe_input(
                    "conn-b",
                    rqs_wrap_with_witness(token, rqs_witness_of_rows(&held)),
                ),
            )
            .expect("witness resume");
        assert!(resumed.snapshot.is_none());
        let envelopes = rqs_drained_envelopes(&mut snapback, "conn-b");
        assert_eq!(envelopes[0]["kind"], "live_delta");
        let ops = envelopes[0]["ops"].as_array().unwrap();
        assert_eq!(ops.len(), 1, "only the changed row is replayed");
        assert_eq!(ops[0]["id"], json!(id_b));
        assert_eq!(ops[0]["op"], "update");

        // Applying the op to the held rows client-side reproduces the fresh
        // root: the untouched a/c leaves are still in it.
        let fresh = rqs_resume_from_value(&envelopes[0]["resume"]);
        let replayed: Vec<Value> = held
            .iter()
            .map(|row| {
                if row["_id"] == json!(id_b) {
                    ops[0]["row"].clone()
                } else {
                    row.clone()
                }
            })
            .collect();
        let recomputed =
            crate::rqs::ResultDigest::from_rows(crate::rqs::DigestKind::Mset1, &replayed).unwrap();
        assert_eq!(fresh.meta.content_digest, recomputed.published());
    }

    #[test]
    fn rqs_replay_with_no_result_intersection_upgrades_to_current_as_of() {
        // Journal-affected rows that never intersected the result (created
        // outside the predicate) yield an empty replay: the verified witness
        // proves the held rows current — a CurrentAsOf answer, zero ops.
        let mut snapback = rqs_snapback();
        rqs_create_todo(&mut snapback, "held");
        let first = snapback
            .subscribe_live("listVisibleTodos", rqs_subscribe_input("conn-a", None))
            .expect("subscribe");
        let held = first.snapshot.as_ref().expect("rows").rows.clone();
        let token = first.resume.clone().expect("mint");
        // A new row that immediately leaves the predicate: journal-affected,
        // in the result on neither side of the gap.
        rqs_create_todo(&mut snapback, "outside");
        let outside = snapback
            .subscribe_live("listPublicTodos", rqs_subscribe_input("conn-x", None))
            .expect("lookup");
        let id_outside =
            rqs_row_id_by_title(&outside.snapshot.as_ref().unwrap().rows, "outside");
        snapback
            .invoke_mutation(
                "setRank",
                HandlerInput {
                    args: json!({ "id": id_outside, "rank": 2 }),
                    ..HandlerInput::default()
                },
            )
            .expect("leave predicate");

        let resumed = snapback
            .subscribe_live(
                "listVisibleTodos",
                rqs_subscribe_input(
                    "conn-b",
                    rqs_wrap_with_witness(token, rqs_witness_of_rows(&held)),
                ),
            )
            .expect("witness resume");
        assert!(resumed.snapshot.is_none());
        let envelopes = rqs_drained_envelopes(&mut snapback, "conn-b");
        assert_eq!(envelopes[0]["kind"], "current_as_of");
        assert_eq!(snapback.live_delivery.resume.current_as_of_answers, 1);
        assert_eq!(snapback.live_delivery.resume.delta_replay_answers, 0);
    }

    #[test]
    fn rqs_witness_over_cap_or_ambiguous_refuses_to_rung3() {
        let mut snapback = rqs_snapback();
        rqs_create_todo(&mut snapback, "a");
        rqs_create_todo(&mut snapback, "b");
        rqs_create_todo(&mut snapback, "c");
        let first = snapback
            .subscribe_live("listPublicTodos", rqs_subscribe_input("conn-a", None))
            .expect("subscribe");
        let held = first.snapshot.as_ref().expect("rows").rows.clone();
        let token = first.resume.clone().expect("mint");
        rqs_create_todo(&mut snapback, "advance");

        // Entry cap (server policy knob): over the cap refuses OVERSIZE and
        // answers rung 3 with full rows.
        snapback.rqs_replay_policy.max_witness_entries = 2;
        let refused = snapback
            .subscribe_live(
                "listPublicTodos",
                rqs_subscribe_input(
                    "conn-b",
                    rqs_wrap_with_witness(token.clone(), rqs_witness_of_rows(&held)),
                ),
            )
            .expect("over-cap subscribe");
        assert_eq!(
            refused.resume_refusal.as_deref(),
            Some("SNAPBACK_RESUME_WITNESS_OVERSIZE")
        );
        assert_eq!(refused.snapshot.as_ref().unwrap().rows.len(), 4);
        snapback.rqs_replay_policy = super::RqsReplayPolicy::default();

        // Byte cap independently refuses.
        snapback.rqs_replay_policy.max_witness_bytes = 16;
        let refused = snapback
            .subscribe_live(
                "listPublicTodos",
                rqs_subscribe_input(
                    "conn-c",
                    rqs_wrap_with_witness(token.clone(), rqs_witness_of_rows(&held)),
                ),
            )
            .expect("over-byte subscribe");
        assert_eq!(
            refused.resume_refusal.as_deref(),
            Some("SNAPBACK_RESUME_WITNESS_OVERSIZE")
        );
        snapback.rqs_replay_policy = super::RqsReplayPolicy::default();

        // Decode ambiguity: an explicit count that disagrees with the
        // entries (truncation) refuses INVALID — never a best-guess replay.
        let mut truncated = rqs_witness_of_rows(&held);
        truncated.count += 1;
        let refused = snapback
            .subscribe_live(
                "listPublicTodos",
                rqs_subscribe_input("conn-d", rqs_wrap_with_witness(token.clone(), truncated)),
            )
            .expect("count-mismatch subscribe");
        assert_eq!(
            refused.resume_refusal.as_deref(),
            Some("SNAPBACK_RESUME_WITNESS_INVALID")
        );
        assert!(refused.snapshot.is_some());

        // Out-of-order entries (which also catches duplicates) are ambiguity.
        let mut unordered = rqs_witness_of_rows(&held);
        unordered.entries.reverse();
        let refused = snapback
            .subscribe_live(
                "listPublicTodos",
                rqs_subscribe_input("conn-e", rqs_wrap_with_witness(token.clone(), unordered)),
            )
            .expect("out-of-order subscribe");
        assert_eq!(
            refused.resume_refusal.as_deref(),
            Some("SNAPBACK_RESUME_WITNESS_INVALID")
        );

        // Duplicate id.
        let mut duplicated = rqs_witness_of_rows(&held);
        duplicated.entries[1] = duplicated.entries[0].clone();
        let refused = snapback
            .subscribe_live(
                "listPublicTodos",
                rqs_subscribe_input("conn-f", rqs_wrap_with_witness(token, duplicated)),
            )
            .expect("duplicate-id subscribe");
        assert_eq!(
            refused.resume_refusal.as_deref(),
            Some("SNAPBACK_RESUME_WITNESS_INVALID")
        );
        assert_eq!(
            snapback.live_delivery.resume.refused["SNAPBACK_RESUME_WITNESS_OVERSIZE"],
            2
        );
        assert_eq!(
            snapback.live_delivery.resume.refused["SNAPBACK_RESUME_WITNESS_INVALID"],
            3
        );
        assert_eq!(snapback.live_delivery.resume.delta_replay_answers, 0);
    }

    #[test]
    fn rqs_adversarial_witnesses_never_suppress_a_removal() {
        // Rollout step 6's adversarial fixtures: omitted, extra,
        // substituted, correct-id/wrong-hash, and hash-permutation witnesses
        // all fail the MAC-bound root check before any replay is admitted —
        // and every refusal answers with the full fresh snapshot, so the
        // offline removal is delivered regardless.
        let mut snapback = rqs_snapback();
        rqs_create_todo(&mut snapback, "a");
        rqs_create_todo(&mut snapback, "b");
        rqs_create_todo(&mut snapback, "c");
        let first = snapback
            .subscribe_live("listVisibleTodos", rqs_subscribe_input("conn-a", None))
            .expect("subscribe");
        let held = first.snapshot.as_ref().expect("rows").rows.clone();
        let token = first.resume.clone().expect("mint");
        let id_removed = rqs_row_id_by_title(&held, "b");
        // The offline removal a lying witness must not be able to suppress.
        snapback
            .invoke_mutation(
                "setRank",
                HandlerInput {
                    args: json!({ "id": id_removed, "rank": 2 }),
                    ..HandlerInput::default()
                },
            )
            .expect("predicate exit");

        let honest = rqs_witness_of_rows(&held);
        let mut cases: Vec<(&str, crate::live_wire::MembershipWitnessWire)> = Vec::new();
        // Omitted: the removed row's entry is missing (a witness that never
        // admits having held it).
        let mut omitted = honest.clone();
        omitted
            .entries
            .retain(|entry| entry.id != id_removed);
        omitted.count = omitted.entries.len() as u32;
        cases.push(("omitted", omitted));
        // Extra: a fabricated held row.
        let mut extra = honest.clone();
        extra.entries.push(crate::live_wire::MembershipWitnessEntry {
            id: "zzz-fabricated".to_owned(),
            old_row_hash: {
                use base64::Engine as _;
                base64::engine::general_purpose::URL_SAFE_NO_PAD
                    .encode(crate::rqs::row_hash(&json!({ "_id": "zzz-fabricated" })).unwrap())
            },
        });
        extra.count = extra.entries.len() as u32;
        cases.push(("extra", extra));
        // Substituted: one entry's hash replaced with a hash of different
        // content (correct id, wrong hash).
        let mut substituted = honest.clone();
        let target = substituted
            .entries
            .iter_mut()
            .find(|entry| entry.id == id_removed)
            .unwrap();
        target.old_row_hash = {
            use base64::Engine as _;
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(crate::rqs::row_hash(&json!({ "_id": id_removed, "forged": true })).unwrap())
        };
        cases.push(("correct-id-wrong-hash", substituted));
        // Hash permutation: two valid hashes swapped between valid ids — the
        // keyed leaf makes this fail even though the hash multiset matches.
        let mut permuted = honest.clone();
        let swap = permuted.entries[0].old_row_hash.clone();
        permuted.entries[0].old_row_hash = permuted.entries[2].old_row_hash.clone();
        permuted.entries[2].old_row_hash = swap;
        cases.push(("hash-permutation", permuted));

        for (index, (label, witness)) in cases.into_iter().enumerate() {
            let refused = snapback
                .subscribe_live(
                    "listVisibleTodos",
                    rqs_subscribe_input(
                        &format!("conn-adv-{index}"),
                        rqs_wrap_with_witness(token.clone(), witness),
                    ),
                )
                .unwrap_or_else(|_| panic!("adversarial witness {label} still subscribes"));
            assert_eq!(
                refused.resume_refusal.as_deref(),
                Some("SNAPBACK_RESUME_WITNESS_ROOT_MISMATCH"),
                "{label} must fail the joint root check"
            );
            let rows = &refused.snapshot.as_ref().expect("rung 3 rows").rows;
            assert!(
                rows.iter().all(|row| row["_id"] != json!(id_removed.as_str())),
                "{label}: the removal is delivered by replacement, never suppressed"
            );
        }
        assert_eq!(
            snapback.live_delivery.resume.refused["SNAPBACK_RESUME_WITNESS_ROOT_MISMATCH"],
            4
        );
        assert_eq!(snapback.live_delivery.resume.delta_replay_answers, 0);
    }

    #[test]
    fn rqs_replay_vs_replace_policy_knob_is_honored() {
        let mut snapback = rqs_snapback();
        rqs_create_todo(&mut snapback, "one");
        rqs_create_todo(&mut snapback, "two");
        let first = snapback
            .subscribe_live("listPublicTodos", rqs_subscribe_input("conn-a", None))
            .expect("subscribe");
        let held = first.snapshot.as_ref().expect("rows").rows.clone();
        let token = first.resume.clone().expect("mint");
        // Three journal-affected rows against a 2-entry witness: over the
        // default 100% threshold (max(1, 2*100/100) = 2), so the server
        // chooses replacement — the delta could not be smaller than the
        // replacement.
        rqs_create_todo(&mut snapback, "three");
        rqs_create_todo(&mut snapback, "four");
        rqs_create_todo(&mut snapback, "five");
        let replaced = snapback
            .subscribe_live(
                "listPublicTodos",
                rqs_subscribe_input(
                    "conn-b",
                    rqs_wrap_with_witness(token.clone(), rqs_witness_of_rows(&held)),
                ),
            )
            .expect("policy-replaced subscribe");
        assert_eq!(
            replaced.resume_refusal.as_deref(),
            Some("SNAPBACK_RESUME_POLICY_REPLACED")
        );
        assert_eq!(replaced.snapshot.as_ref().unwrap().rows.len(), 5);
        assert_eq!(
            snapback.live_delivery.resume.refused["SNAPBACK_RESUME_POLICY_REPLACED"],
            1
        );

        // Raising the knob admits the same replay: 3 affected ≤ max(1,
        // 2*300/100) = 6.
        snapback.rqs_replay_policy.replay_affected_percent = 300;
        let replayed = snapback
            .subscribe_live(
                "listPublicTodos",
                rqs_subscribe_input(
                    "conn-c",
                    rqs_wrap_with_witness(token, rqs_witness_of_rows(&held)),
                ),
            )
            .expect("policy-admitted subscribe");
        assert!(replayed.snapshot.is_none());
        assert_eq!(replayed.resume_refusal, None);
        let envelopes = rqs_drained_envelopes(&mut snapback, "conn-c");
        assert_eq!(envelopes[0]["kind"], "live_delta");
        assert_eq!(envelopes[0]["ops"].as_array().unwrap().len(), 3);
        assert_eq!(snapback.live_delivery.resume.delta_replay_answers, 1);
        assert_eq!(snapback.live_delivery.resume.replay_ops, 3);
    }

    #[test]
    fn rqs_resume_keyring_survives_restart_on_disk() {
        let dir = std::env::temp_dir().join(format!("snapback-rqs-restart-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create test dir");
        let path = dir.join("rqs-restart.sqlite");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(dir.join("resume-keyring.json"));

        let minted = {
            let mut snapback = LocalSnapback::open(&path).expect("open snapback");
            snapback.apply_schema(rqs_schema()).expect("apply schema");
            let diagnostics = snapback.load_functions(rqs_functions());
            assert!(
                diagnostics
                    .iter()
                    .all(|diagnostic| diagnostic.code == "SNAPBACK_IBEX_CLI_UNAVAILABLE")
            );
            snapback
                .subscribe_live("listPublicTodos", rqs_subscribe_input("conn-a", None))
                .expect("subscribe")
                .resume
                .expect("mint")
        };

        // Dev-loop restart: same database, fresh process state. The
        // resume-keyring file (and the content-derived generation) keep the
        // outstanding token admissible — rung 1.
        let mut reopened = LocalSnapback::open(&path).expect("reopen snapback");
        reopened.apply_schema(rqs_schema()).expect("reapply schema");
        let diagnostics = reopened.load_functions(rqs_functions());
        assert!(
            diagnostics
                .iter()
                .all(|diagnostic| diagnostic.code == "SNAPBACK_IBEX_CLI_UNAVAILABLE")
        );
        let resumed = reopened
            .subscribe_live(
                "listPublicTodos",
                rqs_subscribe_input("conn-b", rqs_wrap(minted)),
            )
            .expect("resume after restart");
        assert!(
            resumed.snapshot.is_none(),
            "restart preserves the ring and generation: {:?}",
            resumed.resume_refusal
        );

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(dir.join("resume-keyring.json"));
    }
}
