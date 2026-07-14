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
    RetryReservation, RetryReservationKind, ScopeId, ScopeRetirement,
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
    RealtimeEnvelope, RoomPermissionProjection, RoomSubscriberResolution, SubscribeRequest,
    validate_collection_definitions, validate_collection_permission_backing,
};
use crate::live_matcher::{
    LiveDeltaKind, LiveDeltaOutcome, compute_live_delta, live_subscription_may_be_affected,
    query_dependencies_from_plan,
};
use crate::live_wire::{
    AuthorizationInvalidationSnapshot, LiveDeltaOpKind, LiveDeltaWireOp, LiveEnvelope,
    LiveSocketServerFrame, MutationReceiptOutcome, Receipt, SubscriptionReceiptEvent,
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
use crate::storage::auth_mode::DurableModeCommit;
use crate::storage::{
    BufferedCommitPayload, CapturedReadDependency, CapturedReadKind, CapturedWriteDependency,
    ChangedRow, ClientMutationIdentity, DbRead, LocalDatabase, MutationCommit, ReaderPool,
    StorageInfo, TableScan,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet, HashSet, VecDeque};
use std::marker::PhantomData;
use std::ops::Deref;
use std::path::Path;
use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, PoisonError, RwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const MAX_RECENT_DIAGNOSTICS: usize = 100;
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
    #[serde(rename = "recentDiagnostics", alias = "recent_diagnostics")]
    pub recent_diagnostics: Vec<PublicDiagnostic>,
    #[serde(rename = "capabilityGaps", alias = "capability_gaps")]
    pub capability_gaps: Vec<String>,
}

/// Public storage facts: the change version and table list, never the on-disk path.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicStorageInfo {
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
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct LiveSubscribeOutput {
    pub subscription_id: String,
    pub snapshot: QueryOutput,
    #[serde(default)]
    pub permission_epochs: BTreeMap<String, u64>,
    /// Server half of the 'established' receipt (LLP 0034 §3.2, ENG-22478).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipt: Option<Value>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipt: Option<Value>,
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

impl PreparedAuthProvision {
    pub(crate) fn requested_mode(&self) -> AuthMode {
        self.requested_mode
    }
}

#[derive(Clone, Debug)]
struct PreflightedArtifactPair {
    deployment: DeploymentIdentity,
    schema: SchemaManifest,
    functions: FunctionManifest,
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
/// Staging runs under the global instance mutex; execution of the
/// `Detached` arm deliberately does not — the server runs Ibex actions on a
/// watchdogged thread. Nested mutations execute against an isolated read view
/// and reacquire the mutex only for commit; raw action `ctx.db` calls are
/// rejected before host dispatch (ENG-23324 / ENG-24339 / ENG-24340).
pub(crate) enum StagedAction {
    /// Host-plan actions run bounded mutation steps with no egress; they
    /// execute under the lock exactly as before.
    InLock(PreparedInvocation),
    /// Ibex-module actions may perform egress; everything the runtime needs
    /// is cloned out so the run can proceed without borrowing the instance.
    Detached(Box<DetachedIbexAction>),
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

impl StagedAction {
    pub(crate) fn admission_lease(&self) -> &crate::auth::admission::AdmissionLease {
        match self {
            Self::InLock(invocation) => invocation.admission_lease(),
            Self::Detached(action) => action.invocation.admission_lease(),
        }
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

pub(crate) enum StagedNestedMutation {
    InLock(PreparedInvocation),
    Detached(Box<DetachedIbexMutation>),
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
pub(crate) enum StagedAppAction {
    Done(Box<FunctionRunResult>),
    Ready(AppActionStage),
}

pub(crate) struct AppActionStage {
    pub reads: Vec<String>,
    pub writes: Vec<String>,
    pub mode: StagedAction,
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

impl EphemeralApi {
    pub fn collection_requires_room_permission(&self, name: &str) -> bool {
        self.store.collection_requires_room_permission(name)
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
        let connection_id = request.connection_id.clone();
        let outcome = self.store.publish(request, now_ms);
        self.activity.touch(&connection_id, now_ms);
        outcome
    }

    pub fn subscribe(
        &self,
        request: SubscribeRequest,
        now_ms: u64,
    ) -> Result<EphemeralMessage, crate::ephemeral::EphemeralError> {
        let connection_id = request.connection_id.clone();
        let outcome = self.store.subscribe(request, now_ms);
        self.activity.touch(&connection_id, now_ms);
        outcome
    }

    pub fn delete(
        &self,
        request: DeleteRequest,
        now_ms: u64,
    ) -> Result<Option<EphemeralMessage>, crate::ephemeral::EphemeralError> {
        let connection_id = request.connection_id.clone();
        let outcome = self.store.delete(request, now_ms);
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
        let connection_id = request.connection_id.clone();
        let removed = self.store.unsubscribe(request)?;
        self.activity.touch(&connection_id, now_ms);
        Ok(removed)
    }

    pub fn ensure_collections(
        &self,
        collections: Vec<EphemeralCollection>,
    ) -> Result<CollectionEnsureOutcome, crate::ephemeral::EphemeralError> {
        self.store.ensure_collections(collections)
    }

    /// Drain a connection's outbox. A poll for updates is a liveness signal
    /// for an HTTP-polling client (L2). Touch-after-drain, consistent with the
    /// other ops (finding 2): a drain racing a `disconnect` re-adds only a
    /// bare activity entry (self-healing, reapable), never a registration the
    /// reaper cannot see.
    pub fn drain_outbox(&self, connection_id: &str) -> Vec<RealtimeEnvelope> {
        let drained = self.store.drain_outbox(connection_id);
        self.activity.touch(connection_id, now_millis());
        drained
    }

    /// Destructive HTTP drain that distinguishes a live empty queue from an
    /// extinct connection. `None` is a typed resnapshot boundary at the HTTP
    /// adapter; it must never be serialized as a healthy `[]`.
    pub fn drain_outbox_if_active(&self, connection_id: &str) -> Option<Vec<RealtimeEnvelope>> {
        self.activity
            .act_if_active(connection_id, now_millis(), || {
                self.store.drain_outbox(connection_id)
            })
    }

    pub(crate) fn drain_outbox_for_send_if_active(
        &self,
        connection_id: &str,
    ) -> Option<Vec<crate::ephemeral::AdmittedRealtimeEnvelope>> {
        self.activity
            .act_if_active(connection_id, now_millis(), || {
                self.store.drain_outbox_for_send(connection_id)
            })
    }

    /// Drain for the WS push task. Unlike `drain_outbox` (an HTTP poll, which
    /// is client-initiated and therefore liveness), this drain is
    /// *server-initiated* — the 30s safety net calls it even when the peer has
    /// silently vanished. Touch activity only when something was actually
    /// drained for delivery; an empty drain must not refresh the connection,
    /// or a dead idle WS peer is immortal against the L2 reaper (ENG-23424).
    /// Client liveness on the WS path comes from `touch_connection` instead.
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

    pub(crate) fn drain_live_stream_for_send_if_current(
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

    pub(crate) fn begin_final_send(
        &self,
        envelope: &RealtimeEnvelope,
    ) -> Result<Option<crate::ephemeral::RoomAuthorityPermit>, crate::ephemeral::EphemeralError>
    {
        self.store.begin_final_send(envelope)
    }

    /// Embedded/test compatibility drain without socket-generation ownership.
    /// WebSocket composition must use `drain_live_stream_if_current`.
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
    functions: FunctionManifest,
    // Complete pairs proven by this process. Durable deployment identities
    // are hashes, not manifest bodies, so they can never supply a missing
    // `/app/ensure` half after restart. The cache is deliberately tiny: at
    // most the active and requested deployment can be useful.
    // @ref LLP 0055#complete-candidate-pair-preflight — one-half provisioning may use only a same-boot, fully preflighted sibling.
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
    cron: LocalCronRuntime,
    subscriptions: BTreeMap<String, LiveSubscription>,
    permission_epochs: BTreeMap<String, u64>,
    live_delivery: LiveDeliveryStats,
    recent_diagnostics: VecDeque<Diagnostic>,
    cron_tick_errors: u64,
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
    receipts: ReceiptLog,
    // @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 —
    // per-instance warm VM pool (never process-global: two local app
    // instances must not share loaded code state). Shared with the read lane.
    warm_vms: Arc<crate::warm_vm::WarmVmPool>,
    // @ref LLP 0055#stage-ordering — every finite app-data, cron, nested, and
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

    fn retire_scope_authenticated(
        &mut self,
        scope: &ScopeId,
    ) -> SnapbackResult<Option<ScopeRetirement>> {
        self.obligations
            .retire_scope(scope)
            .map(|candidate| {
                self.issuer.authenticate_scope_retirement(
                    candidate.namespace,
                    candidate.retire_through_scope_sequence,
                )
            })
            .transpose()
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
}

#[derive(Clone, Debug)]
struct LiveSubscriptionAuthorization {
    scope_id: ScopeId,
    namespace: QueryNamespace,
    authority_subject: String,
    owner_continuity_id: String,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct LiveInvalidationAdmission {
    pub(crate) connection: Option<AuthorizationInvalidationConnection>,
    #[cfg(test)]
    pub(crate) session_mode: bool,
    #[cfg(test)]
    pub(crate) authority_subject: Option<String>,
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
        // @ref LLP 0055#complete-gate-coverage — nested mutations inherit the
        // already-resolved outer authority and apply the target requirement.
        // The embedded runtime calls host functions synchronously on the same
        // thread; this pointer is valid only for the duration of one action run.
        let authority = self
            .authority
            .inherit_for(InvocationSource::NestedMutation)?;
        unsafe { (&mut *self.snapback).invoke_mutation_with_authority(name, input, authority) }
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
    // @ref LLP 0054#catalog-write-and-lifecycle-rules — auth state bypasses app journals, receipts, versions, and live delivery.
    // @ref LLP 0054#concurrency-locks-and-linearization — provider coordination precedes the outer app/database lock.
    pub(crate) fn auth_database_mut(&mut self) -> &mut LocalDatabase {
        &mut self.db
    }

    /// Cloneable process-local admission authority for HTTP composition.
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
    pub(crate) fn begin_auth_mode_transition(&self) -> SnapbackResult<ModeTransitionGuard> {
        self.admission.begin_transition()
    }

    /// Pre-bind only: align process admission with the final durable record
    /// after startup composition may have staged, consumed, or unstaged it.
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
    // @ref LLP 0055#complete-candidate-pair-preflight — hashes are evidence only after the complete pair and target capability registry validate.
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
                functions,
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
        self.ephemeral.install_authorization_issuer(issuer);
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
        self.ephemeral.clear_authorization_issuer();
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
        let ephemeral_collections = manifest.ephemeral_collections.clone();
        let generation = next_app_generation()?;
        let diagnostics = self.db.apply_schema(manifest)?;
        self.ephemeral
            .replace_collections(ephemeral_collections)
            .map_err(ephemeral_manifest_error)?;
        self.install_app_generation(generation);
        self.refresh_read_manifests();
        self.record_diagnostics(diagnostics.clone());
        Ok(diagnostics)
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

    /// Publish a function generation that passed
    /// [`Self::preflight_auth_artifacts`] against the schema now committed by
    /// the staged-mode transaction. The swap itself contains no fallible
    /// artifact or schema-reference work; secondary cron/config persistence
    /// failures remain ordinary diagnostics after the generation is live.
    // @ref LLP 0055#consume-ordering-dev-to-sessions — the prepared generation publishes only after the durable consume cut.
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

        // Startup constructs an empty process-local ephemeral backend, so the
        // already-validated committed schema cannot conflict with a live room.
        // Network staging uses the admission barrier instead of this pre-bind
        // publication seam.
        self.ephemeral
            .replace_collections(self.db.schema().ephemeral_collections.clone())
            .expect("pre-bind validated ephemeral definitions publish infallibly");

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
        let app_generation = next_app_generation()?;
        let secret_read_generation = self.secret_read_reset_generation.load(Ordering::Acquire);
        let next_secret_read_generation =
            next_secret_read_reset_generation(secret_read_generation)?;
        let seeded = self.db.reset_and_seed(seed)?;
        self.finish_committed_reset(
            app_generation,
            secret_read_generation,
            next_secret_read_generation,
        );
        Ok(seeded)
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
        // ENG-23333: capture the live subscriptions being dropped so their
        // clients can be told. Clearing the map alone leaves every connected
        // client's WebSocket open on subscription ids that no longer exist
        // server-side — no future commit (including a post-reset seed) would
        // ever deliver to them, so a tab would render pre-reset data forever,
        // indistinguishable from a healthy idle app.
        let dropped_subscriptions: Vec<LiveSubscription> =
            self.subscriptions.values().cloned().collect();
        self.subscriptions.clear();
        // The authenticated issuer names the pre-reset authorization
        // incarnation. Reset terminates those scopes; coordinated server reset
        // installs a freshly reserved successor before reopening authority.
        self.auth_invalidation = None;
        self.permission_epochs.clear();
        self.refresh_read_epochs();
        self.ephemeral.reset_runtime_state();
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
                self.ephemeral
                    .enqueue_durable(subscription.connection_id.clone(), payload);
                self.live_delivery.total_deliveries += 1;
                self.live_delivery.last_deliveries += 1;
            }
        }
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
    }

    fn resolve_complete_provision_pair(
        &self,
        requested_mode: AuthMode,
        schema: Option<SchemaManifest>,
        functions: Option<FunctionManifest>,
        seed: Option<SeedData>,
        state: &AuthModeStateRecord,
    ) -> SnapbackResult<StartupArtifacts> {
        if schema.is_some() && functions.is_some() {
            return Ok(StartupArtifacts {
                format_version: STARTUP_ARTIFACT_FORMAT_VERSION,
                schema: schema.expect("checked complete schema half"),
                functions: functions.expect("checked complete function half"),
                seed,
            });
        }

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
            functions: functions.unwrap_or_else(|| sibling.functions.clone()),
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
    // @ref LLP 0055#stage-ordering — mode staging preflights before closing admission and repeats under the write lane.
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
    /// mode change must hold the transition guard supplied by the admission
    /// controller; same-mode callers remain serialized by the app write lane.
    pub(crate) fn commit_auth_provision(
        &mut self,
        prepared: PreparedAuthProvision,
        profile: &str,
    ) -> SnapbackResult<(EnsureAppProvisionOutcome, AuthModeStateRecord)> {
        self.commit_auth_provision_classified(prepared, profile)
            .map_err(ModeCommitFailure::into_error)
    }

    pub(crate) fn commit_auth_provision_classified(
        &mut self,
        prepared: PreparedAuthProvision,
        profile: &str,
    ) -> Result<(EnsureAppProvisionOutcome, AuthModeStateRecord), ModeCommitFailure> {
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

        let comparison = if prepared.requested_mode == before.state.active {
            before.state.active_deployment.as_ref()
        } else {
            before.state.requested_deployment.as_ref()
        };
        let schema_matched = comparison
            .is_some_and(|identity| identity.schema_hash == prepared.deployment.schema_hash);
        let functions_matched = comparison
            .is_some_and(|identity| identity.bundle_hash == prepared.deployment.bundle_hash);

        let (seed_outcome, state) = if prepared.requested_mode == before.state.active {
            let publication_generation = self
                .reserve_function_publication_generation()
                .map_err(ModeCommitFailure::RolledBack)?;
            let committed = self.db.apply_same_mode_network_deployment_classified(
                prepared.deployment,
                prepared.artifacts.schema,
                prepared.artifacts.seed,
            );
            let (seed_outcome, state) = match committed {
                DurableModeCommit::Committed(committed) => committed,
                DurableModeCommit::RolledBack(error) => {
                    return Err(ModeCommitFailure::RolledBack(error));
                }
                DurableModeCommit::Uncertain(error) => {
                    return Err(ModeCommitFailure::Uncertain(error));
                }
            };
            self.publish_preflighted_functions(
                prepared.artifacts.functions,
                publication_generation,
            );
            (seed_outcome.as_str(), state)
        } else {
            let seeded = prepared.artifacts.seed.is_some();
            let committed = self.db.stage_auth_mode_classified(
                prepared.deployment,
                prepared.artifacts.schema,
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
            (if seeded { "seeded" } else { "skipped-absent" }, state)
        };
        Ok((
            EnsureAppProvisionOutcome {
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
        ))
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
        let output = self.db.seed(seed)?;
        self.notify_live_subscriptions(&[]);
        Ok(output)
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

    pub fn durable_version(&self) -> Option<u64> {
        self.db.info().ok().map(|info| info.version)
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
        let auth = authority.canonical_auth_input();
        let _effect = authority.effect_guard("client mutation acknowledgement transaction")?;
        self.acknowledge_client_mutations(&auth, ids)
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
        // @ref LLP 0010#v0-implementation-charter — missing non-v0 capabilities must be reported explicitly.
        let capability_gaps = self.capability_gaps();
        let mut capability_manifest = CapabilityManifest::local_v0(capability_gaps.clone());
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
            ephemeral: self.ephemeral.diagnostics(),
            cron,
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
        )
    }

    /// Execute the only full revalidation path permitted to mint an
    /// AuthorizedLease. Query result, data head, authorization pair,
    /// activation, issuer, and empty-obligation state are captured while the
    /// app instance is one coherent read. Signing happens only after this
    /// method releases the app lock; final reservation rechecks every fact.
    ///
    /// @ref LLP 0053#the-lease-the-only-mechanism-for-the-unreachable-client —
    /// opaque/undeclared queries cannot retain, and a pending invalidation can
    /// never ride a lease-bearing snapshot.
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
        if !invalidation.obligations.pending_all().is_empty() {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_PENDING",
                "auth",
                "an authorization/query/connection obligation is pending",
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
    /// auth pair, activation, issuer, and empty obligation set.
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
        let no_pending_obligation = self
            .auth_invalidation
            .as_ref()
            .is_some_and(|state| state.obligations.pending_all().is_empty());
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
        match admission.effect_guard("mutation receipt publication") {
            Ok(_publication) => self.record_mutation_commit(
                name,
                transport,
                correlation,
                receipt_mutation_id,
                result,
                true,
            ),
            Err(error) => self.record_mutation_commit(
                name,
                transport,
                correlation,
                receipt_mutation_id,
                Err(error),
                false,
            ),
        }
    }

    /// HTTP queued-delivery entry point with receipt-proven piggyback ACKs.
    /// The shared function gate and descriptor comparison run before the ACK
    /// transaction, so a stale or malformed queued request has no settlement
    /// side effect. The ordinary mutation path above delegates with no ACKs.
    ///
    /// @ref LLP 0043#milestone-2-queued-mutation-replay — descriptor
    /// comparison precedes settlement lookup and every request effect.
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
        let (outcome, rollback_reason, snapshot_version) = match &result {
            Ok(commit) => (
                MutationReceiptOutcome::Confirmed,
                None,
                commit.output.version,
            ),
            Err(error) => (
                MutationReceiptOutcome::Rejected,
                // The diagnostic CODE only — messages may embed argument
                // values (§3.3 privacy).
                Some(error.diagnostic.code.clone()),
                self.db.current_version().unwrap_or(0),
            ),
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
            &admission,
            check_live,
            before_commit,
        );
        match admission.effect_guard("nested mutation receipt publication") {
            Ok(_publication) => {
                self.record_mutation_commit(
                    name,
                    "local",
                    correlation,
                    receipt_mutation_id,
                    result,
                    true,
                )
                .0
            }
            Err(error) => {
                self.record_mutation_commit(
                    name,
                    "local",
                    correlation,
                    receipt_mutation_id,
                    Err(error),
                    false,
                )
                .0
            }
        }
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
        // @ref LLP 0055#gate-algorithm — function lookup and requirement
        // enforcement precede replay-settlement lookup and every effect.
        let function = self.function(name)?.clone();
        let prepared = InvocationGate::prepare_function(authority, &function)?;
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
        let commit = match &function.runtime {
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan)) => match identity.as_ref() {
                Some(identity) => {
                    let _effect = prepared.effect_guard("idempotent mutation transaction")?;
                    self.db
                        .execute_mutation_idempotent(plan, &input, identity)?
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
        admission: &AdmissionLease,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        admission.validate("nested host-plan mutation execution")?;
        check_live()?;
        let function = self.function(name)?.clone();
        if function.kind != FunctionKind::Mutation {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_KIND_MISMATCH",
                "runtime",
                format!("{name} is not a mutation"),
            ));
        }
        let epoch_scopes = evaluate_permission_epoch_scopes(&function, &input)?;
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
                let admission_guard = admission.effect_guard("nested host-plan transaction")?;
                let caller_guard = before_commit()?;
                Ok((admission_guard, caller_guard))
            })?;
        self.finish_mutation_commit(epoch_scopes, commit, admission)
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
        let permission_changes = {
            let _effect = admission.effect_guard("permission epoch publication")?;
            let changes = if commit.output.changed_count > 0 {
                self.advance_permission_epochs(&epoch_scopes)
            } else {
                Vec::new()
            };
            if !changes.is_empty() {
                self.refresh_read_epochs();
            }
            changes
        };
        let authorization_event = commit
            .authorization
            .as_ref()
            .filter(|authorization| authorization.event && self.auth_invalidation.is_some());
        if !permission_changes.is_empty()
            || !commit.changes.is_empty()
            || authorization_event.is_some()
        {
            self.begin_live_delivery_frame(self.subscriptions.len());
            let mut resynced =
                self.notify_permission_resyncs_in_frame(&permission_changes, admission)?;
            if let Some(authorization) = authorization_event {
                resynced.extend(self.notify_authorization_event_in_frame(
                    authorization,
                    commit.output.version,
                    admission,
                )?);
            }
            if !commit.changes.is_empty() {
                self.notify_live_subscriptions_in_frame(&commit.changes, &resynced, admission)?;
            }
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
        let commit = self.db.commit_buffered_writes_idempotent_guarded(
            &input,
            BufferedCommitPayload {
                writes: executed.writes,
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
        let snapshot_version = self.db.current_version().unwrap_or(0);
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
    fn subscribe_live_with_invalidation(
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
        let authority_subject = authority.resolved().invalidation_subject();
        let retained_authority = authority.retain_live_owner()?;
        let publication_authority = authority.clone();
        // @ref LLP 0053#invalidation-is-an-obligation-not-a-message — an
        // auth-scoped live subscription is admitted only when its connection
        // negotiated the exact protocol and supplied a stable query namespace.
        self.touch_connection(&input.connection_id, now_millis());
        let function = self.function(name)?;
        if function.kind != FunctionKind::LiveQuery {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_NOT_LIVE",
                "runtime",
                format!("{name} is not a live query"),
            ));
        }
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

        // A valid explicit supersession is a net-zero replacement. Identify
        // it before admission, but do not remove it until the new snapshot
        // succeeds: a query failure must leave the old live authority intact.
        // Unknown or foreign ids remain the protocol's documented quiet
        // no-op and therefore do not release capacity.
        let superseded_subscription_id = input.supersedes.as_ref().and_then(|old_id| {
            self.subscriptions.get(old_id).and_then(|existing| {
                let same_connection = existing.connection_id == input.connection_id;
                let same_owner = existing.authority.matches(&authority);
                (same_connection && same_owner).then(|| old_id.clone())
            })
        });
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

        let query = self.invoke_query_with_dependencies_prepared(
            name,
            subscription_input.clone(),
            authority,
        )?;
        let permission_epochs = permission_epochs_from_dependencies(&query.read_dependencies);
        // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S2:
        // subscription ids are unguessable bearer capabilities, not enumerable
        // counters; they share the runtime's UUIDv7 id source.
        let subscription_id = format!("sub_{}", Uuid::now_v7().simple());
        let _publication = publication_authority.effect_guard("live subscribe publication")?;
        self.touch_connection(&input.connection_id, now_millis());
        let mut authorization_scope = None;
        let mut authorization_invalidation = None;
        let mut scope_retirements = Vec::new();
        let subscription_authorization = if let Some((connection, namespace)) =
            authorization_admission
        {
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
            state
                .obligations
                .register_live_scope(scope_id.clone(), owner_continuity_id.clone())?;
            if state
                .obligations
                .register_connection_child(&connection_scope, scope_id.clone())?
                .is_some()
            {
                let witness = CompositeWitness {
                    authorization: state.obligations.expectation().authorization.clone(),
                    data: Some(DataWitness {
                        version_stream: state.version_stream.clone(),
                        min_commit_version: query.output.version,
                    }),
                };
                state
                    .obligations
                    .issue_resolution(&scope_id, ResolutionKind::Snapshot, witness)?;
                authorization_invalidation = state.obligations.projection(&scope_id);
            }
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
                .remove(&old_id)
                .and_then(|subscription| subscription.authorization)
                .map(|authorization| authorization.scope_id);
            if let (Some(state), Some(scope)) =
                (self.auth_invalidation.as_mut(), retired_scope.as_ref())
            {
                if let Some(retirement) = state.retire_scope_authenticated(scope)? {
                    scope_retirements.push(retirement);
                }
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
            },
        );
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
        }
        .into_value();
        self.receipts
            .push_connection(&input.connection_id, receipt.clone());

        Ok(LiveSubscribeOutput {
            subscription_id,
            snapshot: query.output,
            permission_epochs,
            receipt: Some(receipt),
            authorization_scope,
            authorization_invalidation,
            scope_retirements,
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
        self.unsubscribe_live_prepared(name, input, authority)
    }

    pub(crate) fn unsubscribe_live_prepared(
        &mut self,
        name: &str,
        input: LiveUnsubscribeInput,
        authority: PreparedAuthority,
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

        let _publication = authority.effect_guard("live unsubscribe publication")?;
        self.touch_connection(&input.connection_id, now_millis());
        self.subscriptions.remove(&subscription.id);
        let scope_retirement = if let (Some(state), Some(authorization)) = (
            self.auth_invalidation.as_mut(),
            subscription.authorization.as_ref(),
        ) {
            state.retire_scope_authenticated(&authorization.scope_id)?
        } else {
            None
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
            snapshot_version: Some(self.db.current_version().unwrap_or(0)),
            correlation: None,
            received_at_ms: now_millis(),
        }
        .into_value();
        self.receipts
            .push_connection(&subscription.connection_id, receipt.clone());
        Ok(LiveUnsubscribeOutput {
            subscription_id: subscription.id,
            disposed: true,
            receipt: Some(receipt),
            scope_retirement,
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
            self.db.with_invalidation_retry_registry(|registry| {
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
                    authority.admission_lease(),
                )?;
                Ok(AuthorizationInvalidationManualRetryOutput {
                    outcome: if terminal { "denied" } else { "exhausted" }.to_owned(),
                    retry_episode_id: failure.retry_episode_id,
                })
            }
        }
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

        if let Some(mut authorization) = subscription.authorization.take() {
            let mut scope_retirements = Vec::new();
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

            let connection_changed = !matches!(
                &authorization.scope_id,
                ScopeId::Subscription {
                    issuer_id,
                    connection_generation,
                    ..
                } if issuer_id == &connection.issuer_id
                    && *connection_generation == connection.connection_generation
            );
            if connection_changed {
                let previous = state.obligations.pending(&authorization.scope_id).cloned();
                if let Some(retirement) =
                    state.retire_scope_authenticated(&authorization.scope_id)?
                {
                    scope_retirements.push(retirement);
                }
                let replacement = ScopeId::Subscription {
                    issuer_id: connection.issuer_id.clone(),
                    namespace: authorization.namespace.clone(),
                    scope_sequence: state.issuer.reserve_scope_sequence()?,
                    connection_generation: connection.connection_generation,
                    subscription_id: subscription.id.clone(),
                };
                let connection_scope = ScopeId::Connection {
                    issuer_id: connection.issuer_id,
                    connection_generation: connection.connection_generation,
                };
                authorization.owner_continuity_id = format!("owner_{}", Uuid::now_v7().simple());
                state.obligations.register_live_scope(
                    replacement.clone(),
                    authorization.owner_continuity_id.clone(),
                )?;
                state
                    .obligations
                    .register_connection_child(&connection_scope, replacement.clone())?;
                if let Some(previous) = previous {
                    let cause = state.reserve_cause_sequence()?;
                    state.obligations.raise(
                        replacement.clone(),
                        cause,
                        format!("resume:transfer:{cause}"),
                        previous.max_disposition,
                        previous.witness,
                        previous.retry_episode_id,
                    )?;
                }
                authorization.scope_id = replacement;
            }

            // A session-mode resume never trusts retained rows merely because
            // epochs compare equal. Install an exact obligation before the
            // fresh query so a failed invocation leaves the old view hidden.
            let floor = self.db.current_version()?;
            let cause = state.reserve_cause_sequence()?;
            let witness = state.witness(floor);
            let retry_floor = witness.clone();
            state.obligations.raise(
                authorization.scope_id.clone(),
                cause,
                format!("resume:fresh:{cause}"),
                InvalidationDisposition::Quarantine,
                witness,
                None,
            )?;
            if let Some(projection) = state.obligations.projection(&authorization.scope_id)
                && let Ok(payload) = serde_json::to_vec(&LiveEnvelope::AuthorizationInvalidation {
                    obligation: projection.obligation,
                    resolution: projection.resolution,
                    snapshot: None,
                })
            {
                self.ephemeral
                    .enqueue_durable(input.connection_id.clone(), payload);
            }

            subscription.authorization = Some(authorization.clone());
            let query = match self.invoke_authorization_resolution(
                &subscription,
                retry_floor,
                authority.admission_lease(),
            ) {
                Ok(query) => query,
                Err(failure) => {
                    let error = failure.error.clone();
                    self.fail_subscription_fanout_with_retry(
                        &subscription,
                        "authorization_resume_failed",
                        failure.error,
                        failure.retry_episode_id,
                        authority.admission_lease(),
                    )?;
                    return Err(error);
                }
            };
            let permission_epochs = permission_epochs_from_dependencies(&query.read_dependencies);
            let _publication = authority.effect_guard("live authorization resume publication")?;
            let resolution_witness = self
                .auth_invalidation
                .as_ref()
                .expect("state remains installed")
                .witness(query.output.version);
            let authorization_invalidation = {
                let state = self
                    .auth_invalidation
                    .as_mut()
                    .expect("state remains installed");
                state.obligations.issue_resolution(
                    &authorization.scope_id,
                    ResolutionKind::Snapshot,
                    resolution_witness.clone(),
                )?;
                state.obligations.projection(&authorization.scope_id)
            };
            self.resolve_authorization_retry_episode(
                &subscription,
                &resolution_witness,
                &_publication,
            )?;
            if let Some(stored) = self.subscriptions.get_mut(&subscription.id) {
                stored.connection_id = input.connection_id;
                stored.read_dependencies = query.read_dependencies;
                stored.authorization = Some(authorization.clone());
            }
            return Ok(LiveResumeOutput {
                subscription_id: subscription.id,
                mode: "resnapshot".to_owned(),
                reason: Some("authorization_revalidation".to_owned()),
                snapshot: Some(query.output),
                permission_epochs,
                authorization_scope: Some(authorization.scope_id.clone()),
                authorization_invalidation,
                scope_retirements,
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
            let rerun = subscription
                .authority
                .prepare_rerun(authority.admission_lease().clone())?;
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
            StagedAction::InLock(prepared) => {
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
            _ => StagedAction::InLock(invocation),
        }
    }

    pub(crate) fn stage_nested_mutation(
        &self,
        name: &str,
        input: &HandlerInput,
        authority: PreparedAuthority,
    ) -> SnapbackResult<StagedNestedMutation> {
        let function = self.function(name)?.clone();
        let invocation = InvocationGate::prepare_function(authority, &function)?;
        let canonical_input = invocation.canonicalize_input(input.clone());
        match &function.runtime {
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(_)) => {
                Ok(StagedNestedMutation::InLock(invocation))
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
                    StagedAction::InLock(prepared) => self.invoke_action_prepared(
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
        self.ephemeral.register_collection(collection)
    }

    pub fn ensure_ephemeral_collections(
        &mut self,
        collections: Vec<EphemeralCollection>,
    ) -> Result<CollectionEnsureOutcome, crate::ephemeral::EphemeralError> {
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

    pub fn disconnect(&mut self, connection_id: &str, now_ms: u64) {
        self.disconnect_inner(connection_id, now_ms, false);
    }

    /// Generation-guarded disconnect for the WS teardown path (ENG-23426):
    /// the caller proved ownership with `DeliveryNotifier::unregister` while
    /// already holding the global write mutex, so the durable wipe below is
    /// atomic against fresh `subscribe_live` calls (they serialize behind
    /// the same mutex, and a reconnect registers its socket before it
    /// re-subscribes). The ephemeral wipe runs off that mutex, so it uses
    /// `LocalEphemeralBackend::disconnect_guarded`, which aborts step-by-step
    /// if a reconnect re-registers the id mid-wipe. The reaper and the admin
    /// disconnect route keep the unconditional `disconnect`: they must tear
    /// down even a connection with a live registration.
    pub fn disconnect_guarded(&mut self, connection_id: &str, now_ms: u64) {
        self.disconnect_inner(connection_id, now_ms, true);
    }

    fn disconnect_inner(&mut self, connection_id: &str, now_ms: u64, guarded: bool) {
        // Remove the liveness entry FIRST, before tearing down any ephemeral
        // registration/outbox or durable subscription (MEDIUM finding 2). The
        // ephemeral store is off the global mutex, so an async-worker
        // `EphemeralApi::subscribe` can interleave with this write-lane
        // teardown. Ordering both operations so a surviving registration
        // implies a surviving activity entry: disconnect removes activity
        // before it removes registrations, and `EphemeralApi` ops touch
        // activity *after* the store op succeeds (touch-after-success). The
        // only reachable residual — an activity entry with no registration —
        // is self-healing: the L2 reaper reaps it with an idempotent
        // disconnect. The banned state — a registration with no activity
        // entry, an unreapable zombie subscriber whose room never prunes —
        // cannot occur.
        // (On the guarded path an aborted ephemeral wipe can leave the NEW
        // registration briefly without an activity entry; that is the
        // self-healing residual — the live socket's next pong/op/drain
        // touches it back within the 30s safety-net cadence.)
        self.connections_last_seen.remove(connection_id);
        if guarded {
            self.ephemeral.disconnect_guarded(connection_id, now_ms);
        } else {
            self.ephemeral.disconnect(connection_id, now_ms);
        }
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
        if let Some(state) = self.auth_invalidation.as_mut() {
            for scope in retired_authorization_scopes {
                let _ = state.obligations.retire_scope(&scope);
            }
        }
        self.receipts.drop_connection(connection_id);
        // ENG-23427: an unconditional disconnect (the L2 reaper, or the admin
        // route) that destroyed durable subscriptions while the connection
        // still owns a delivery registration ran under an OPEN socket — the
        // pump task is merely parked (e.g. blocked in `sender.send` on a peer
        // that stopped reading past the idle TTL), so no socket event will
        // ever tell the client its subscriptions are gone. Enqueue one
        // connection-wide durable `resync_required` sentinel (no
        // `subscription_id` — the client re-snapshots every handle on the
        // connection, the L1 overflow-sentinel shape) into the fresh outbox;
        // `enqueue_durable` stores a wake permit, so when the peer resumes
        // reading the pump drains the sentinel instead of resuming a
        // silently-stale connection. The guarded (WS teardown) path never
        // signals: there a surviving registration can only be a reconnect's.
        //
        // @ref LLP 0008#realtime-delivery — a dropped subscription gets a
        // resync signal, never a silent freeze.
        // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L2
        // reap-under-open-socket fix (ENG-23427).
        if !guarded
            && dropped_subscriptions > 0
            && self
                .ephemeral
                .delivery_notifier()
                .is_registered(connection_id)
        {
            let payload = serde_json::to_vec(&json!({
                "kind": "resync_required",
                "reason": "disconnected",
                "clearRetained": true,
            }))
            .unwrap_or_default();
            self.ephemeral
                .enqueue_durable(connection_id.to_owned(), payload);
        }
        // Losing the last watcher of a demand-gated live query disarms its cron
        // job (L5).
        self.refresh_cron_active();
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
        // A poll for updates is a liveness signal for an HTTP-polling client.
        self.touch_connection(connection_id, now_millis());
        self.ephemeral.drain_outbox(connection_id)
    }

    /// Record connection activity for the L2 reaper. @ref LLP 0032 L2.
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

    #[cfg(test)]
    pub(crate) fn auth_invalidation_expectation_for_test(
        &self,
    ) -> Option<crate::storage::AuthorizationVersion> {
        self.auth_invalidation
            .as_ref()
            .map(|state| state.obligations.expectation().authorization.clone())
    }

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
            for subscriber in room.subscribers {
                let fresh =
                    resolve_connection(&subscriber.connection_id, &subscriber.previous_auth)?;
                let Some(fresh) = fresh else {
                    resolutions.push(RoomSubscriberResolution::Denied {
                        connection_id: subscriber.connection_id,
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
                        auth: collection.grant_projected_room_permission(fresh, &room.room.scope),
                    });
                } else {
                    resolutions.push(RoomSubscriberResolution::Denied {
                        connection_id: subscriber.connection_id,
                    });
                }
            }
            if self.ephemeral.complete_room_reauthorization(
                &room.room,
                room.obligation.room_authority_generation,
                resolutions,
            )? {
                completed = completed.saturating_add(1);
            }
        }
        Ok(completed)
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

    /// Reap connections idle longer than `ttl_ms`: tear down each one's live
    /// subscriptions and ephemeral state (as an explicit disconnect would) and
    /// count it. The safety net for HTTP-polling clients that vanish without
    /// disconnecting; WS clients are already reaped on socket close.
    ///
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L2.
    pub fn reap_stale_connections(&mut self, now_ms: u64, ttl_ms: u64) -> usize {
        let cutoff = now_ms.saturating_sub(ttl_ms);
        let stale = self.connections_last_seen.stale_ids(cutoff);
        for id in &stale {
            // disconnect removes the connection from connections_last_seen too.
            self.disconnect(id, now_ms);
        }
        self.reaped_connections += stale.len() as u64;
        stale.len()
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

    fn from_database(db: LocalDatabase) -> SnapbackResult<Self> {
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
        Ok(Self {
            db,
            functions: FunctionManifest::default(),
            preflighted_artifact_pairs: VecDeque::new(),
            functions_loaded: false,
            config: ConfigStore::in_memory(),
            runtime,
            ephemeral: LocalEphemeralBackend::new(),
            cron,
            subscriptions: BTreeMap::new(),
            permission_epochs: BTreeMap::new(),
            live_delivery: LiveDeliveryStats::default(),
            recent_diagnostics,
            cron_tick_errors: 0,
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
            receipts: ReceiptLog::default(),
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
            pool: self.db.reader_pool(),
            warm_vms: self.warm_vms.clone(),
            admission: self.admission.clone(),
            secret_read_reset_generation: self.secret_read_reset_generation.clone(),
        }
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

    pub(crate) fn invoke_action_prepared(
        &mut self,
        name: &str,
        input: HandlerInput,
        metadata: CronRunMetadata,
        prepared: PreparedInvocation,
    ) -> SnapbackResult<Value> {
        prepared.validate_admission("action execution")?;
        let function = self.function(name)?.clone();
        if prepared.function_id()
            != function
                .id
                .as_deref()
                .unwrap_or_else(|| function.name.as_str())
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
    /// cron job is armed (scale-to-zero). @ref LLP 0032 L5.
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

        self.begin_live_delivery_frame(self.subscriptions.len());
        let _ = self.notify_live_subscriptions_in_frame(changes, &BTreeSet::new(), &admission);
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

    // @ref LLP 0055#gate-algorithm — retry-registry writes are durable auth
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
                database.with_invalidation_retry_registry(|registry| {
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
                        database.with_invalidation_retry_registry(|registry| {
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
            match subscription
                .authority
                .prepare_rerun(admission.clone())
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
                            database.with_invalidation_retry_registry(|registry| {
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
                            database.with_invalidation_retry_registry(|registry| {
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
        self.db.with_invalidation_retry_registry(|registry| {
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
        let payload = serde_json::to_vec(&LiveEnvelope::AuthorizationInvalidation {
            obligation: projection.obligation,
            resolution: projection.resolution,
            snapshot: Some(AuthorizationInvalidationSnapshot {
                subscription_id: subscription.id.clone(),
                function: subscription.function.clone(),
                version: snapshot_version,
                rows: query.output.rows,
            }),
        })
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
        let enqueue = self
            .ephemeral
            .enqueue_durable(subscription.connection_id.clone(), payload);
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
            .filter_map(|subscription| {
                subscription
                    .authorization
                    .as_ref()
                    .map(|authorization| authorization.scope_id.clone())
            })
            .collect::<Vec<_>>();
        if subscriptions.is_empty() {
            return Ok(());
        }
        let groups = subscriptions.iter().fold(
            BTreeMap::<(crate::auth::invalidation::IssuerId, u64), Vec<ScopeId>>::new(),
            |mut groups, scope| {
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
                    projections.push(projection);
                }
            }
        }
        for projection in projections {
            if let Ok(payload) = serde_json::to_vec(&LiveEnvelope::AuthorizationInvalidation {
                obligation: projection.obligation,
                resolution: projection.resolution,
                snapshot: None,
            }) {
                self.ephemeral
                    .enqueue_durable(connection_id.to_owned(), payload);
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
        let scopes = self
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
        let projections = self
            .auth_invalidation
            .as_ref()
            .map(|state| {
                scopes
                    .iter()
                    .filter_map(|scope| state.obligations.projection(scope))
                    .map(|mut projection| {
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
                        projection
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut parked = false;
        for projection in projections {
            if let Ok(payload) = serde_json::to_vec(&LiveEnvelope::AuthorizationInvalidation {
                obligation: projection.obligation,
                resolution: projection.resolution,
                snapshot: None,
            }) {
                parked |= self
                    .ephemeral
                    .enqueue_durable(connection_id.to_owned(), payload)
                    .parked_behind_overflow;
            }
        }
        Ok(parked)
    }

    pub(crate) fn authorization_invalidation_frames(
        &mut self,
        connection_id: &str,
        admission: &AdmissionLease,
    ) -> SnapbackResult<Vec<String>> {
        // @ref LLP 0055#gate-algorithm — a re-query validates and publishes
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
        for subscription in subscriptions {
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
                        serde_json::to_string(&LiveEnvelope::AuthorizationInvalidation {
                            obligation: projection.obligation,
                            resolution: projection.resolution,
                            snapshot: None,
                        })
                    {
                        frames.push(frame);
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
                            serde_json::to_string(&LiveEnvelope::AuthorizationInvalidation {
                                obligation: projection.obligation,
                                resolution: projection.resolution,
                                snapshot: Some(AuthorizationInvalidationSnapshot {
                                    subscription_id: subscription.id.clone(),
                                    function: subscription.function.clone(),
                                    version: snapshot_version,
                                    rows: query.output.rows,
                                }),
                            })
                    {
                        frames.push(frame);
                    }
                }
                Err(failure) => {
                    if failure.error.is_trusted_permission_denial() {
                        self.fail_subscription_fanout_with_retry(
                            &subscription,
                            "authorization_terminal_denial",
                            failure.error,
                            failure.retry_episode_id,
                            admission,
                        )?;
                        let _publication =
                            admission.effect_guard("authorization denial drain publication")?;
                        if let Some(projection) = self
                            .auth_invalidation
                            .as_ref()
                            .and_then(|state| state.obligations.projection(scope))
                            && let Ok(frame) =
                                serde_json::to_string(&LiveEnvelope::AuthorizationInvalidation {
                                    obligation: projection.obligation,
                                    resolution: projection.resolution,
                                    snapshot: None,
                                })
                        {
                            frames.push(frame);
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
                            serde_json::to_string(&LiveEnvelope::AuthorizationInvalidation {
                                obligation: projection.obligation,
                                resolution: projection.resolution,
                                snapshot: None,
                            })
                    {
                        frames.push(frame);
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
        // The authenticated expectation is process state, not a projection of
        // the current subscriber set. Advance it even with zero live queries
        // so a later subscription cannot start under a pre-event epoch.
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
                    .issuer
                    .install_authorization_expectation(authorization.version.clone())?;
                state
                    .obligations
                    .advance_authenticated_authorization(authorization.version.clone())
            })?;
        let subscriptions = self
            .subscriptions
            .values()
            .filter(|subscription| subscription.authorization.is_some())
            .cloned()
            .collect::<Vec<_>>();
        if subscriptions.is_empty() {
            return Ok(BTreeSet::new());
        }

        let preprojected =
            (|| -> SnapbackResult<Vec<(String, AuthorizationInvalidationProjection)>> {
                let state = self.auth_invalidation.as_mut().ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
                        "auth",
                        "authorization event cannot project without invalidation state",
                    )
                })?;
                let mut projections = Vec::with_capacity(subscriptions.len());
                for subscription in &subscriptions {
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
                    projections.push((
                        subscription.connection_id.clone(),
                        state
                            .obligations
                            .projection(scope)
                            .expect("a just-raised obligation has a projection"),
                    ));
                }
                Ok(projections)
            })();
        let preprojected = match preprojected {
            Ok(projections) => projections,
            Err(error) => {
                self.record_diagnostics(vec![error.diagnostic]);
                return Ok(subscriptions
                    .into_iter()
                    .map(|subscription| subscription.id)
                    .collect());
            }
        };
        for (connection_id, projection) in preprojected {
            if let Ok(payload) = serde_json::to_vec(&LiveEnvelope::AuthorizationInvalidation {
                obligation: projection.obligation,
                resolution: projection.resolution,
                snapshot: None,
            }) {
                let enqueue = self
                    .ephemeral
                    .enqueue_durable(connection_id.clone(), payload);
                if enqueue.overflowed_now {
                    let _ = self.raise_connection_overflow(&connection_id, min_commit_version);
                }
            }
        }

        let mut handled = BTreeSet::new();
        for subscription in subscriptions {
            handled.insert(subscription.id.clone());
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
                    }
                    Err(error) => self.fail_subscription_fanout(
                        &subscription,
                        "authorization_invalidation_failed",
                        error,
                        admission,
                    )?,
                },
                Err(failure) => self.fail_subscription_fanout_with_retry(
                    &subscription,
                    "authorization_refresh_failed",
                    failure.error,
                    failure.retry_episode_id,
                    admission,
                )?,
            }
        }
        Ok(handled)
    }

    fn notify_live_subscriptions_in_frame(
        &mut self,
        changes: &[ChangedRow],
        already_resynced: &BTreeSet<String>,
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
                FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) if !changes.is_empty() => {
                    Some(plan.clone())
                }
                _ => None,
            };
            affected.push((subscription.clone(), delta_plan));
        }
        self.live_delivery.total_skipped += skipped;
        self.live_delivery.last_skipped += skipped as usize;

        for (subscription, delta_plan) in affected {
            if let Some(plan) = &delta_plan {
                match self.try_live_delta_fanout(&subscription, plan, changes, admission)? {
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
                            admission,
                        )?;
                        continue;
                    }
                    None => {}
                }
            }

            let query = if subscription.authorization.is_some() {
                let floor = self
                    .auth_invalidation
                    .as_ref()
                    .map(|state| state.witness(self.db.current_version().unwrap_or(0)))
                    .expect("auth-scoped subscription requires installed state");
                match self.invoke_authorization_resolution(&subscription, floor, admission) {
                    Ok(query) => query,
                    Err(failure) => {
                        self.fail_subscription_fanout_with_retry(
                            &subscription,
                            "live_refresh_failed",
                            failure.error,
                            failure.retry_episode_id,
                            admission,
                        )?;
                        continue;
                    }
                }
            } else {
                match subscription
                    .authority
                    .prepare_rerun(admission.clone())
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
                            admission,
                        )?;
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
                        admission,
                    )?,
                }
                continue;
            }
            let payload = match serde_json::to_vec(&LiveEnvelope::LiveReplace {
                subscription_id: subscription.id.clone(),
                function: subscription.function.clone(),
                version: query.output.version,
                rows: query.output.rows,
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
                        admission,
                    )?;
                    continue;
                }
            };
            let enqueue = {
                let _publication = admission.effect_guard("live replacement publication")?;
                if let Some(stored) = self.subscriptions.get_mut(&subscription.id) {
                    stored.read_dependencies = query.read_dependencies;
                }
                self.ephemeral
                    .enqueue_durable(subscription.connection_id.clone(), payload)
            };
            if enqueue.overflowed_now
                && let Err(error) = self
                    .raise_connection_overflow(&subscription.connection_id, query.output.version)
            {
                self.fail_subscription_fanout(
                    &subscription,
                    "authorization_overflow_projection_failed",
                    error,
                    admission,
                )?;
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
    fn try_live_delta_fanout(
        &mut self,
        subscription: &LiveSubscription,
        plan: &QueryPlan,
        changes: &[ChangedRow],
        admission: &AdmissionLease,
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
            // to deliver — no re-query needed either.
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

        // The commit version: read once on the write lane (this runs under the
        // global mutex right after commit, so it is exactly the commit's
        // version). If the read fails, fall back to the re-query path, which
        // carries its own version.
        let Some(version) = self.db.current_version().ok() else {
            return Ok(None);
        };

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

        let payload = match serde_json::to_vec(&LiveEnvelope::LiveDelta {
            subscription_id: subscription.id.clone(),
            function: subscription.function.clone(),
            version,
            ops: wire_ops,
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
        // set; update leaves membership unchanged. Refresh the dependency's
        // table-change version so the matcher's next affected-check is accurate.
        let enqueue = {
            let _publication = admission.effect_guard("live delta publication")?;
            let fresh_table_version = self.db.table_change_version(&plan.table).ok();
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
                if let Some(fresh) = fresh_table_version {
                    dependency.version = Some(fresh);
                }
            }
            self.ephemeral
                .enqueue_durable(subscription.connection_id.clone(), payload)
        };

        // Convergence gate (debug/test only): the delta-maintained member set
        // must equal what a fresh re-query would produce. Free in release; any
        // membership drift fails the test that exercises this path. (L4 parity
        // pattern.)
        #[cfg(debug_assertions)]
        self.debug_assert_delta_membership_converges(subscription, query_dep_index, admission);

        if enqueue.overflowed_now
            && let Err(error) = self.raise_connection_overflow(&subscription.connection_id, version)
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
        &self,
        subscription: &LiveSubscription,
        query_dep_index: usize,
        admission: &AdmissionLease,
    ) {
        let Ok(fresh) = subscription
            .authority
            .prepare_rerun(admission.clone())
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
        admission: &AdmissionLease,
    ) -> SnapbackResult<()> {
        self.fail_subscription_fanout_with_retry(subscription, reason, error, None, admission)
    }

    fn fail_subscription_fanout_with_retry(
        &mut self,
        subscription: &LiveSubscription,
        reason: &str,
        error: SnapbackError,
        retry_episode_id: Option<String>,
        admission: &AdmissionLease,
    ) -> SnapbackResult<()> {
        let _publication = admission.effect_guard("live failure/resync publication")?;
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
        if let Some(authorization) = subscription.authorization.as_ref() {
            let min_commit_version = self.db.current_version().unwrap_or(0);
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
                if let Ok(payload) = serde_json::to_vec(&LiveEnvelope::AuthorizationInvalidation {
                    obligation: projection.obligation,
                    resolution: projection.resolution,
                    snapshot: None,
                }) {
                    let enqueue = self
                        .ephemeral
                        .enqueue_durable(subscription.connection_id.clone(), payload);
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
            let enqueue = self
                .ephemeral
                .enqueue_durable(subscription.connection_id.clone(), payload);
            if enqueue.overflowed_now {
                let floor = self.db.current_version().unwrap_or(0);
                let _ = self.raise_connection_overflow(&subscription.connection_id, floor);
            }
        }
        Ok(())
    }

    fn permission_epoch(&self, scope: &str) -> u64 {
        self.permission_epochs.get(scope).copied().unwrap_or(0)
    }

    /// Advance epochs for scopes already resolved pre-execution by
    /// [`evaluate_permission_epoch_scopes`]. Infallible on purpose: this runs
    /// after the mutation has durably committed, where an error return would
    /// misreport the committed write as rejected (ENG-23329).
    fn advance_permission_epochs(&mut self, scopes: &BTreeSet<String>) -> Vec<(String, u64)> {
        let mut changes = Vec::new();
        for scope in scopes {
            let epoch = self.permission_epochs.entry(scope.clone()).or_insert(0);
            *epoch += 1;
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
                        admission,
                    )?;
                    continue;
                }
            };
            let enqueue = {
                let _publication = admission.effect_guard("permission resync publication")?;
                self.ephemeral
                    .enqueue_durable(subscription.connection_id.clone(), payload)
            };
            if enqueue.overflowed_now {
                let floor = self.db.current_version().unwrap_or(0);
                let _ = self.raise_connection_overflow(&subscription.connection_id, floor);
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
    pool: Option<Arc<ReaderPool>>,
    // Shared with the write lane: concurrent readers check out distinct VMs
    // (exclusive ownership per checkout), warming extras on miss up to the
    // pool bound.
    warm_vms: Arc<crate::warm_vm::WarmVmPool>,
    admission: AdmissionController,
    secret_read_reset_generation: Arc<AtomicU64>,
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
        Ok(())
    };

    for function in &manifest.functions {
        match &function.runtime {
            FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) => query(plan)?,
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

/// Execute a query-shaped invocation against any read view: the write lane
/// passes the live connection and its own epoch map; the read lane passes a
/// pinned reader and its snapshots. One implementation, so the two lanes
/// cannot drift.
fn execute_query_invocation(
    function: &FunctionDefinition,
    name: &str,
    db: DbRead<'_>,
    permission_epochs: &BTreeMap<String, u64>,
    input: HandlerInput,
    prepared: &PreparedInvocation,
    warm_vms: Option<&crate::warm_vm::WarmVmPool>,
) -> SnapbackResult<QueryInvocation> {
    prepared.validate_admission("query execution")?;
    let invocation = match (&function.kind, &function.runtime) {
        (
            FunctionKind::Query | FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::Query(plan)),
        ) => {
            let output = db.query(plan, &input)?;
            let mut read_dependencies = query_dependencies_from_plan(plan, &input, &output, &db)?;
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

#[cfg(test)]
mod tests {
    use super::{
        AuthorizationInvalidationAckInput, BEFORE_ACTION_RESULT_HANDOFF_HOOK,
        BEFORE_CONFIG_VERIFY_PUBLICATION_HOOK, BEFORE_MUTATION_POSTCOMMIT_HOOK,
        BEFORE_QUERY_RESULT_HANDOFF_HOOK, DetachedIbexMutation, DetachedMutationRead,
        EnsureAppMode, LiveInvalidationAdmission, LiveSubscribeInput, LiveUnsubscribeInput,
        LocalSnapback, MAX_LIVE_SUBSCRIPTIONS, MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION,
        RetryEpisodeKey, RetryReservationKind, SnapbackError, StagedNestedMutation,
        next_secret_read_reset_generation, now_millis, reserve_unique_generation,
    };
    use crate::admin::ServerProfile;
    use crate::auth::admission::AdmissionController;
    use crate::auth::invalidation::{
        AuthorizationInvalidationConnection, InvalidationDisposition, LiveInvalidationIssuer,
        QueryNamespace, ResolutionKind, ScopeId,
    };
    use crate::auth::invocation::{
        InvocationGate, InvocationSource, PreparedAuthority, PreparedInvocation,
        ResolvedAppAuthority, WireAuthorityFields,
    };
    use crate::auth::mode::{
        AuthModeStateRecord, DeploymentIdentity, FUNCTION_V1_PREFIX, INPUTS_V1_PREFIX,
        SCHEMA_V1_PREFIX,
    };
    use crate::manifest::{
        ActionPlan, AuthManifest, AuthMode, AuthorityDescriptor, ConfigEntryDefinition,
        CronActivationPolicy, CronJitterPolicy, CronJobDefinition, CronOverlapPolicy,
        CronRetryMode, CronRetryPolicy, CronSchedule, CtxAnswerLedger, FieldManifest, FieldType,
        FilterExpr, FilterOp, FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime,
        HandlerInput, HandlerPlan, IbexModule, IndexManifest, MutationPlan, MutationStep,
        QueryPlan, ReturnValue, SchemaManifest, TableManifest, ValueExpr, ctx_ledger_version,
    };
    use crate::runtime::ExecutedIbexMutation;
    use crate::storage::BufferedWrite;
    use serde_json::{Value, json};
    use std::collections::BTreeMap;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::time::{Duration, Instant};

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
            assert_eq!(snapback.durable_version(), Some(0));
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
        assert_eq!(snapback.durable_version(), Some(1));

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
        assert_eq!(snapback.durable_version(), Some(1));
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
                    }],
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
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
        let authenticated =
            crate::auth::invalidation::IssuerAuthenticator::new("test-protocol-key", [0x5a; 32])
                .expect("test authenticator")
                .authenticate(issuer_id, "test-target", "test-app")
                .expect("authenticate test issuer");
        let issuer = LiveInvalidationIssuer::new(authenticated).expect("live test issuer");
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

    #[test]
    fn session_live_requires_installed_and_negotiated_invalidation() {
        let mut snapback = live_limit_snapback();
        let input = LiveSubscribeInput {
            connection_id: "session-capability".to_owned(),
            input: HandlerInput::default(),
            authorization_namespace: Some(test_authorization_namespace(1)),
            supersedes: None,
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
                    authority_subject: Some("sha256:test-subject".to_owned()),
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
                },
                LiveInvalidationAdmission {
                    session_mode: true,
                    connection: Some(connection.clone()),
                    authority_subject: Some("sha256:test-subject".to_owned()),
                },
            )
            .expect("auth-scoped subscription");
        assert!(snapback.drain_live_stream("session-remove").is_empty());

        invoke_test_session_mutation(
            &mut snapback,
            "deleteItem",
            HandlerInput {
                args: json!({ "id": row_id }),
                ..HandlerInput::default()
            },
        )
        .expect("delete visible row");
        let messages = snapback.drain_live_stream("session-remove");
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
        let hint = snapback
            .drain_live_stream("session-remove")
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
        let rerun = serde_json::from_str::<Value>(
            rerun
                .first()
                .expect("managed drain emits the fresh snapshot"),
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
                    },
                    LiveInvalidationAdmission {
                        session_mode: true,
                        connection: Some(connection.clone()),
                        authority_subject: Some("sha256:overflow-subject".to_owned()),
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
        assert!(
            overflow
                .iter()
                .any(|frame| frame.contains("outbox_overflow")),
            "bounded queue must expose its overflow sentinel"
        );

        let frames = snapback
            .authorization_invalidation_frames("session-overflow", &admission)
            .expect("drain overflow invalidations");
        assert_eq!(frames.len(), 2, "one exact child per auth-scoped query");
        let tokens = frames
            .iter()
            .map(|frame| serde_json::from_str::<Value>(frame).expect("frame JSON"))
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
        assert_eq!(
            snapback
                .authorization_invalidation_frames("session-overflow", &admission)
                .expect("drain remaining invalidation")
                .len(),
            1,
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
        assert!(
            snapback
                .authorization_invalidation_frames("session-overflow", &admission)
                .expect("drain discharged invalidations")
                .is_empty(),
            "root clears only after every current child discharges"
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
                    }],
                    syncable: true,
                    permission_backing: true,
                    permission_fields: None,
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
                },
                LiveInvalidationAdmission {
                    session_mode: true,
                    connection: Some(connection),
                    authority_subject: Some("sha256:permission-subject".to_owned()),
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
                    }],
                    syncable: true,
                    permission_backing: true,
                    permission_fields: None,
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
                },
                LiveInvalidationAdmission {
                    session_mode: true,
                    connection: Some(connection),
                    authority_subject: Some("sha256:retry-subject".to_owned()),
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
            .with_invalidation_retry_registry(|registry| {
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
            .with_invalidation_retry_registry(|registry| Ok(registry.episodes().len()))
            .expect("read retry registry");
        let failure = snapback
            .run_authorization_retry_transaction(
                &admission,
                "retired authorization retry transaction",
                None,
                |database| {
                    database.with_invalidation_retry_registry(|registry| {
                        registry.reserve(key, witness, now_millis(), RetryReservationKind::Initial)
                    })
                },
            )
            .expect_err("retired epoch must fail before the durable transaction");
        assert_eq!(failure.error.diagnostic.code, "SNAPBACK_AUTH_MODE_PENDING");
        let after = snapback
            .auth_database_mut()
            .with_invalidation_retry_registry(|registry| Ok(registry.episodes().len()))
            .expect("read retry registry");
        assert_eq!(after, before);
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
                    },
                    LiveInvalidationAdmission {
                        session_mode: true,
                        connection: Some(connection.clone()),
                        authority_subject: Some("sha256:terminal-subject".to_owned()),
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
        snapback
            .fail_subscription_fanout_with_retry(
                &terminal_subscription,
                "test_terminal_denial",
                SnapbackError::trusted_permission_denied("trusted policy denied"),
                None,
                &admission,
            )
            .expect("publish trusted terminal denial");
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
        snapback
            .fail_subscription_fanout_with_retry(
                &forged_subscription,
                "test_forged_denial",
                SnapbackError::error(
                    "SNAPBACK_AUTH_PERMISSION_DENIED",
                    "auth",
                    "application supplied the public code",
                ),
                None,
                &admission,
            )
            .expect("publish forged-code quarantine");
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

        snapback.disconnect("bounded", 1);
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

        snapback.disconnect("global-0", 1);
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

    fn prepared_mutation(snapback: &LocalSnapback, name: &str) -> PreparedInvocation {
        InvocationGate::prepare_function(
            nested_authority(),
            snapback.function(name).expect("test mutation exists"),
        )
        .expect("prepare test mutation")
    }

    fn detached(snapback: &LocalSnapback, name: &str) -> Box<DetachedIbexMutation> {
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
        assert_eq!(cancelled_snapback.durable_version(), Some(0));
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
        assert_eq!(committed.durable_version(), Some(1));
    }

    #[test]
    fn guarded_buffered_local_path_rolls_back_and_releases_gate_before_postcommit() {
        let mut cancelled_snapback = guarded_snapback();
        let DetachedIbexMutation {
            binding,
            read: _read,
        } = *detached(&cancelled_snapback, "ibexInsert");
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
        assert_eq!(cancelled_snapback.durable_version(), Some(0));
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
        } = *detached(&committed, "ibexInsert");
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
        assert_eq!(committed.durable_version(), Some(1));
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

        let old_insert = detached(&snapback, "insertOld");
        let new_table_read = detached(&snapback, "readNewTable");
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
}
