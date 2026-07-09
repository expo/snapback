use crate::config::{ConfigStore, VerificationRecord};
use crate::cron::{
    CronInspectState, CronRunClaim, CronRunMetadata, CronRunOutcome, CronRunRecord, CronRunTrigger,
    LocalCronRuntime,
};
use crate::diagnostic::{Diagnostic, DiagnosticSeverity, SnapbackError, SnapbackResult};
use crate::ephemeral::{
    CollectionEnsureOutcome, DeleteRequest, DeliveryNotifier, EphemeralCollection,
    EphemeralDiagnostics, EphemeralMessage, LocalEphemeralBackend, PublishOutcome, PublishRequest,
    RealtimeEnvelope, SubscribeRequest,
};
use crate::live_matcher::{
    LiveDeltaKind, LiveDeltaOutcome, compute_live_delta, live_subscription_may_be_affected,
    query_dependencies_from_plan,
};
use crate::live_wire::{
    LiveDeltaOpKind, LiveDeltaWireOp, LiveEnvelope, LiveSocketServerFrame, MutationReceiptOutcome,
    Receipt, SubscriptionReceiptEvent,
};
use crate::manifest::{
    ActionPlan, ActionReturnValue, ActionStep, AuthInput, CapabilityManifest, FunctionDefinition,
    FunctionKind, FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, MutationOutput,
    MutationStep, PermissionScopeExpr, PublicFunctionManifest, QueryOutput, QueryPlan,
    SNAPBACK_SCHEMA_VERSION, SchemaManifest, SeedData, TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX,
    ValueExpr,
};
use crate::runtime::{IbexActionHost, RuntimeCapabilities, RuntimeManager};
use crate::storage::{
    CapturedReadDependency, CapturedReadKind, CapturedWriteDependency, ChangedRow, DbRead,
    LocalDatabase, MutationCommit, ReaderPool, StorageInfo, TableScan,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet, HashSet, VecDeque};
use std::marker::PhantomData;
use std::path::Path;
use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, PoisonError, RwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const MAX_RECENT_DIAGNOSTICS: usize = 100;

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
/// leak. Three facts are deliberately dropped and live only in the gated
/// `/_snapback/api/inspect` twin: `subscriptions[].connection_id` (the
/// enumerate-and-disconnect vector — LLP 0031 D2/D3), the absolute
/// `storage.sqlite_path` (an environment leak), and the executable handler
/// bodies inside `functions` (`IbexModule.source` / `HandlerPlan` bodies — a
/// source disclosure, ENG-23441; see [`PublicFunctionManifest`]).
///
/// @ref LLP 0031#resolved-decisions — D3: public `/inspect` is trimmed to an identity descriptor; the trim is guarded by a typed projection.
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
    pub runtime: RuntimeCapabilities,
    pub schema: SchemaManifest,
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
    pub ephemeral: EphemeralDiagnostics,
    pub cron: CronInspectState,
    #[serde(rename = "recentDiagnostics", alias = "recent_diagnostics")]
    pub recent_diagnostics: Vec<Diagnostic>,
    #[serde(rename = "capabilityGaps", alias = "capability_gaps")]
    pub capability_gaps: Vec<String>,
}

/// Public storage facts: the change version and table list, never the on-disk path.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct PublicStorageInfo {
    pub version: u64,
    pub tables: Vec<String>,
}

/// Public subscription facts: id and function, never the owning connection id.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicSubscriptionInfo {
    pub id: String,
    pub function: String,
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
        } = storage;
        PublicInspect {
            artifact_kind,
            schema_version,
            target_profile_id,
            target,
            storage: PublicStorageInfo { version, tables },
            runtime,
            schema,
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
            ephemeral,
            cron,
            recent_diagnostics,
            capability_gaps,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct LiveSubscribeInput {
    pub connection_id: String,
    #[serde(default)]
    pub input: HandlerInput,
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
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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
}

/// The single idempotent ensure-everything operation (LLP 0034 §5 D4
/// residual, ENG-22527): "is this backend provisioned for this manifest?" as
/// ONE call that inspects, provisions only what is missing/mismatched, and
/// seeds only-if-empty — never reset-then-seed, never replace-clearing live
/// rooms beyond the identity-guarded collection replace apply_schema already
/// performs.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct EnsureAppInput {
    #[serde(default)]
    pub schema: Option<SchemaManifest>,
    #[serde(default)]
    pub functions: Option<FunctionManifest>,
    #[serde(default)]
    pub seed: Option<SeedData>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

/// How a staged action must execute.
///
/// Staging runs under the global instance mutex; execution of the
/// `Detached` arm deliberately does not — the server runs Ibex actions on a
/// watchdogged thread whose host calls reacquire the mutex per call, so a
/// hung outbound fetch can no longer wedge writes, cron, and in-memory
/// queries (ENG-23324).
pub(crate) enum StagedAction {
    /// Host-plan actions run bounded mutation steps with no egress; they
    /// execute under the lock exactly as before.
    InLock,
    /// Ibex-module actions may perform egress; everything the runtime needs
    /// is cloned out so the run can proceed without borrowing the instance.
    Detached(Box<DetachedIbexAction>),
}

pub(crate) struct DetachedIbexAction {
    pub module: crate::manifest::IbexModule,
    pub grants: Value,
    pub runtime: RuntimeManager,
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
    /// Cooldown-claim wall time; also the `at_ms` of the eventual record.
    pub started_ms: u64,
    pub input: HandlerInput,
    pub metadata: CronRunMetadata,
    pub mode: StagedAction,
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
        ctx_ledger: None,    }
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

    /// Drain for the WS push task. Unlike `drain_outbox` (an HTTP poll, which
    /// is client-initiated and therefore liveness), this drain is
    /// *server-initiated* — the 30s safety net calls it even when the peer has
    /// silently vanished. Touch activity only when something was actually
    /// drained for delivery; an empty drain must not refresh the connection,
    /// or a dead idle WS peer is immortal against the L2 reaper (ENG-23424).
    /// Client liveness on the WS path comes from `touch_connection` instead.
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
    pub verified: Option<VerificationRecord>,
    #[serde(rename = "applyState")]
    pub apply_state: String,
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
    pub verified: VerificationRecord,
    pub generation: u64,
}

pub struct LocalSnapback {
    db: LocalDatabase,
    functions: FunctionManifest,
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
}

#[derive(Clone, Debug)]
struct LiveSubscription {
    id: String,
    connection_id: String,
    function: String,
    input: HandlerInput,
    read_dependencies: Vec<CapturedReadDependency>,
}

struct QueryInvocation {
    output: QueryOutput,
    read_dependencies: Vec<CapturedReadDependency>,
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
    // - the read-only db pointer handed to the runtime is derived from this same
    //   provenance root before any host call can reborrow `self`.
    //
    // The S5.D1 nested-action test exercises the important behavioral edge:
    // a JS action can call back into an Ibex mutation and then make a second host
    // call after the nested invocation returns without losing or aliasing context.
    snapback: *mut LocalSnapback,
    _marker: PhantomData<&'a mut LocalSnapback>,
}

impl IbexActionHost for LocalIbexActionHost<'_> {
    fn run_mutation(&mut self, name: &str, input: HandlerInput) -> SnapbackResult<MutationOutput> {
        // @ref LLP 0028#execution-the-action-class — actions commit durable
        // writes by invoking ordinary mutations, preserving the commit/fan-out path.
        // The embedded runtime calls host functions synchronously on the same
        // thread; this pointer is valid only for the duration of one action run.
        unsafe { (&mut *self.snapback).invoke_mutation(name, input) }
    }

    // The reads below derive their reference from the same provenance root as
    // `run_mutation`'s write, one synchronous host call at a time — no read
    // borrow is ever held across a mutation, which is what keeps the aliasing
    // sound under Stacked Borrows (ENG-23324 removed the long-lived raw db
    // pointer this path used to carry).
    fn query(&mut self, plan: &QueryPlan, input: &HandlerInput) -> SnapbackResult<QueryOutput> {
        unsafe { (*self.snapback).db.query(plan, input) }
    }

    fn get(&mut self, table: &str, id: &str) -> SnapbackResult<Option<Value>> {
        unsafe { (*self.snapback).db.get(table, id) }
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

    pub fn apply_schema(&mut self, manifest: SchemaManifest) -> SnapbackResult<Vec<Diagnostic>> {
        manifest.validate_artifact()?;
        let ephemeral_collections = manifest.ephemeral_collections.clone();
        let diagnostics = self.db.apply_schema(manifest)?;
        self.ephemeral.replace_collections(ephemeral_collections);
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

        self.functions = manifest;
        self.functions_loaded = true;
        // New code means new warm-VM setup state; content keying already
        // prevents stale reuse, clearing also frees the old VMs' memory.
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

    pub fn reset(&mut self) -> SnapbackResult<()> {
        self.db.reset()?;
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
        self.persist_cron_state()?;
        Ok(())
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
                    if let Some(error) = diagnostics
                        .iter()
                        .find(|diagnostic| matches!(diagnostic.severity, DiagnosticSeverity::Fatal))
                    {
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
        Ok(self.invoke_query_with_dependencies(name, input)?.output)
    }

    fn invoke_query_with_dependencies(
        &self,
        name: &str,
        input: HandlerInput,
    ) -> SnapbackResult<QueryInvocation> {
        let function = self.function(name)?;
        execute_query_invocation(
            function,
            name,
            DbRead::Live(&self.db),
            &self.permission_epochs,
            input,
            Some(&self.warm_vms),
        )
    }

    pub fn invoke_mutation(
        &mut self,
        name: &str,
        input: HandlerInput,
    ) -> SnapbackResult<MutationOutput> {
        self.invoke_mutation_recording(name, input).0
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
    ) -> (SnapbackResult<MutationOutput>, Value) {
        self.invoke_mutation_recording_with_transport(name, input, "local")
    }

    pub fn invoke_mutation_recording_with_transport(
        &mut self,
        name: &str,
        input: HandlerInput,
        transport: &str,
    ) -> (SnapbackResult<MutationOutput>, Value) {
        let correlation = capped_correlation(input.correlation.clone());
        // affectedTables from DECLARED writes; a function that declares none
        // yields an EXPLICITLY-unknown receipt (`affectedTables: null`),
        // never a silently-empty list (LLP 0034 §3.2 / Exact 0263 honesty).
        let affected_tables: Option<Vec<String>> = self
            .functions
            .function(name)
            .map(|function| function.write_set_summary.tables.clone())
            .filter(|tables| !tables.is_empty());
        let result = self.invoke_mutation_commit(name, input);
        let (outcome, rollback_reason, snapshot_version) = match &result {
            Ok(commit) => (MutationReceiptOutcome::Confirmed, None, commit.output.version),
            Err(error) => (
                MutationReceiptOutcome::Rejected,
                // The diagnostic CODE only — messages may embed argument
                // values (§3.3 privacy).
                Some(error.diagnostic.code.clone()),
                self.db.current_version().unwrap_or(0),
            ),
        };
        let receipt = Receipt::Mutation {
            mutation_id: format!("mut_{}", Uuid::now_v7().simple()),
            mutation: name.to_owned(),
            outcome,
            rollback_reason,
            affected_tables,
            snapshot_version,
            transport: transport.to_owned(),
            correlation: correlation.unwrap_or(Value::Null),
            received_at_ms: now_millis(),
        }
        .into_value();
        self.receipts.push_global(receipt.clone());
        (result.map(|commit| commit.output), receipt)
    }

    /// Receipt retention surface (LLP 0034 §3 / ENG-22478): the bounded rings,
    /// filtered to one connection when requested. Dev/debug read — served by
    /// the admin API (LLP 0031 SystemApi class).
    pub fn receipts_snapshot(&self, connection_id: Option<&str>) -> Value {
        self.receipts.snapshot(connection_id)
    }

    fn invoke_mutation_commit(
        &mut self,
        name: &str,
        input: HandlerInput,
    ) -> SnapbackResult<MutationCommit> {
        let function = self.function(name)?.clone();
        if function.kind != FunctionKind::Mutation {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_KIND_MISMATCH",
                "runtime",
                format!("{name} is not a mutation"),
            ));
        }
        // Permission-epoch scopes are evaluated BEFORE the mutation executes
        // (ENG-23329): scope evaluation can fail (missing auth user, missing
        // arg, empty scope), and an error raised after `tx.commit()` would
        // report a durably-committed mutation as rejected and skip the live
        // fan-out entirely. Failing fast here means no write ever happens for
        // a mutation whose declared epoch bumps cannot be resolved, and the
        // post-commit path below is infallible by construction.
        let epoch_scopes = evaluate_permission_epoch_scopes(&function, &input)?;
        let commit = match &function.runtime {
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan)) => {
                self.db.execute_mutation(plan, &input)?
            }
            FunctionRuntime::IbexModule(module) => self.runtime.invoke_ibex_mutation(
                module,
                input.clone(),
                &mut self.db,
                Some(&self.warm_vms),
            )?,
            _ => {
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_KIND_MISMATCH",
                    "runtime",
                    format!("{name} is not a mutation"),
                ));
            }
        };

        let permission_changes = if commit.output.changed_count > 0 {
            self.advance_permission_epochs(&epoch_scopes)
        } else {
            Vec::new()
        };
        if !permission_changes.is_empty() {
            self.refresh_read_epochs();
        }
        if !permission_changes.is_empty() || !commit.changes.is_empty() {
            self.begin_live_delivery_frame(self.subscriptions.len());
            let resynced = self.notify_permission_resyncs_in_frame(&permission_changes);
            if !commit.changes.is_empty() {
                self.notify_live_subscriptions_in_frame(&commit.changes, &resynced);
            }
        }
        Ok(commit)
    }

    pub fn subscribe_live(
        &mut self,
        name: &str,
        input: LiveSubscribeInput,
    ) -> SnapbackResult<LiveSubscribeOutput> {
        self.touch_connection(&input.connection_id, now_millis());
        let function = self.function(name)?;
        if function.kind != FunctionKind::LiveQuery {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_NOT_LIVE",
                "runtime",
                format!("{name} is not a live query"),
            ));
        }

        let subscription_input = input.input;
        let query = self.invoke_query_with_dependencies(name, subscription_input.clone())?;
        let permission_epochs = permission_epochs_from_dependencies(&query.read_dependencies);
        // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S2:
        // subscription ids are unguessable bearer capabilities, not enumerable
        // counters; they share the runtime's UUIDv7 id source.
        let subscription_id = format!("sub_{}", Uuid::now_v7().simple());

        // Superseded-subscription GC, EXPLICIT protocol (LLP 0034 §10.1
        // residual; ENG-22478 review fix A): the kit names the subscription
        // its own resubscribe replaces and the server disposes exactly that
        // id — never inferred from matching identity, so two legitimate
        // identical subscribers (two components sharing a query on one
        // connection) coexist. An unknown id is a quiet no-op: reconnects
        // race disconnect teardown, which may have dropped it already.
        if let Some(old_id) = &input.supersedes
            && let Some(existing) = self.subscriptions.get(old_id)
        {
            let owner = &existing.input.auth;
            let same_connection = existing.connection_id == input.connection_id;
            let same_owner = owner.principal == subscription_input.auth.principal
                && owner.user_id == subscription_input.auth.user_id;
            if same_connection && same_owner {
                self.subscriptions.remove(old_id);
                let receipt = Receipt::Subscription {
                    event: SubscriptionReceiptEvent::Disposed,
                    reason: Some("superseded".to_owned()),
                    subscription_id: Some(old_id.clone()),
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
        }

        self.subscriptions.insert(
            subscription_id.clone(),
            LiveSubscription {
                id: subscription_id.clone(),
                connection_id: input.connection_id.clone(),
                function: name.to_owned(),
                input: subscription_input.clone(),
                read_dependencies: query.read_dependencies,
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
        self.touch_connection(&input.connection_id, now_millis());
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
        let owner = &subscription.input.auth;
        if (owner.principal.is_some() || owner.user_id.is_some())
            && (owner.principal != input.auth.principal || owner.user_id != input.auth.user_id)
        {
            return Err(SnapbackError::error(
                "SNAPBACK_LIVE_RESUME_OWNERSHIP",
                "realtime",
                format!(
                    "subscription {} is owned by a different principal",
                    subscription.id
                ),
            ));
        }

        self.subscriptions.remove(&subscription.id);
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
        })
    }

    /// @ref LLP 0020#remaining-phase-4-design-dependency-vocabulary-and-auth-epochs — retained resume compares client-recorded permission epochs before trusting retained rows.
    pub fn resume_live(
        &mut self,
        name: &str,
        input: LiveResumeInput,
    ) -> SnapbackResult<LiveResumeOutput> {
        self.touch_connection(&input.connection_id, now_millis());
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

        // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S2:
        // resume re-points a subscription's stream, so once a principal owns
        // the subscription the caller must present that principal; the
        // unguessable id alone is not ownership.
        let owner = &subscription.input.auth;
        if (owner.principal.is_some() || owner.user_id.is_some())
            && (owner.principal != input.auth.principal || owner.user_id != input.auth.user_id)
        {
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
            let query = self.invoke_query_with_dependencies(
                &subscription.function,
                subscription.input.clone(),
            )?;
            let permission_epochs = permission_epochs_from_dependencies(&query.read_dependencies);
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
            });
        }

        let permission_epochs =
            current_permission_epochs_for_dependencies(&subscription.read_dependencies, |scope| {
                self.permission_epoch(scope)
            });
        if let Some(stored) = self.subscriptions.get_mut(&subscription.id) {
            stored.connection_id = input.connection_id;
        }
        Ok(LiveResumeOutput {
            subscription_id: subscription.id,
            mode: "retained".to_owned(),
            reason: None,
            snapshot: None,
            permission_epochs,
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
            elapsed_ms: 0,
            version: None,
            changed_count: None,
            rows: None,
            result: None,
            diagnostic: None,
        };

        match kind {
            FunctionKind::Query | FunctionKind::LiveQuery => match self.invoke_query(name, input) {
                Ok(output) => FunctionRunResult {
                    elapsed_ms: elapsed_ms(started),
                    version: Some(output.version),
                    rows: Some(output.rows),
                    ..base
                },
                Err(error) => FunctionRunResult {
                    ok: false,
                    elapsed_ms: elapsed_ms(started),
                    diagnostic: Some(error.diagnostic),
                    ..base
                },
            },
            FunctionKind::Mutation => match self.invoke_mutation_commit(name, input) {
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
                match self.invoke_action(name, input, metadata) {
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

    /// Run an app-data action through the normal action invocation path without
    /// borrowing the admin function runner's metadata. Non-actions return a
    /// diagnostic envelope and are never executed.
    ///
    /// @ref LLP 0028#open-questions — actions are useful
    /// for app-triggered egress, not only scheduled cron runs.
    pub fn run_app_action(&mut self, name: &str, input: HandlerInput) -> FunctionRunResult {
        let started = Instant::now();
        let stage = match self.stage_app_action(name) {
            StagedAppAction::Done(result) => return *result,
            StagedAppAction::Ready(stage) => stage,
        };
        let metadata = manual_action_metadata("action", name);
        let result = self.invoke_action(name, input, metadata);
        action_run_result(name, stage.reads, stage.writes, elapsed_ms(started), result)
    }

    /// Stage an app-action run: resolve the function, reject non-actions with
    /// a ready envelope, and clone out what a detached execution needs. Runs
    /// under the global mutex; the returned stage does not borrow the
    /// instance (ENG-23324).
    pub(crate) fn stage_app_action(&mut self, name: &str) -> StagedAppAction {
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
        if !matches!(definition.kind, FunctionKind::Action) {
            return StagedAppAction::Done(Box::new(FunctionRunResult {
                ok: false,
                function: name.to_owned(),
                kind: Some(definition.kind.clone()),
                reads,
                writes,
                captured_reads: Vec::new(),
                captured_writes: Vec::new(),
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

        let mode = self.staged_mode(&definition);
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
        let function = self.function(name)?.clone();
        if !matches!(function.kind, FunctionKind::Action) {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_KIND_MISMATCH",
                "runtime",
                format!("{name} is not an action"),
            ));
        }
        Ok(self.staged_mode(&function))
    }

    fn staged_mode(&mut self, definition: &FunctionDefinition) -> StagedAction {
        match &definition.runtime {
            FunctionRuntime::IbexModule(module) => {
                StagedAction::Detached(Box::new(DetachedIbexAction {
                    module: module.clone(),
                    // @ref LLP 0036#runtime-exposure-d5-d8 — grants are
                    // computed per invocation from the function's `uses`
                    // declaration, at staging time, under the lock.
                    grants: self.config_grants(definition),
                    runtime: self.runtime.clone(),
                }))
            }
            _ => StagedAction::InLock,
        }
    }

    /// One-call read accessors for the detached action host: each `ctx.db`
    /// host call of a detached action takes the global mutex just long enough
    /// for one read (ENG-23324).
    pub(crate) fn db_query(
        &self,
        plan: &QueryPlan,
        input: &HandlerInput,
    ) -> SnapbackResult<QueryOutput> {
        self.db.query(plan, input)
    }

    pub(crate) fn db_get(&self, table: &str, id: &str) -> SnapbackResult<Option<Value>> {
        self.db.get(table, id)
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
                    verified: stored.and_then(|entry| entry.verified.clone()),
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
                let result = self.invoke_action(&stage.probe, stage.input, stage.metadata);
                self.finish_config_verify(name, stage.started_ms, result)
            }
        }
    }

    /// Stage a config-verify probe run: entry checks and the cooldown claim
    /// happen here, under the global mutex, so concurrent verifies linearize
    /// through the cooldown stamp even when the probe itself runs off-lock
    /// (ENG-23493).
    pub(crate) fn stage_config_verify(&mut self, name: &str) -> SnapbackResult<StagedConfigVerify> {
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
        let now = now_millis();
        self.config.check_verify_cooldown(name, now)?;
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
            ctx_ledger: None,        };
        let mode = match self.stage_action_invocation(&probe) {
            Ok(mode) => mode,
            // A probe that cannot stage (unknown function, non-action) is a
            // failed verification, exactly as the in-lock run reported it.
            Err(error) => {
                return Ok(StagedConfigVerify::Done(Box::new(
                    self.finish_config_verify(name, now, Err(error))?,
                )));
            }
        };
        Ok(StagedConfigVerify::Ready(Box::new(ConfigVerifyStage {
            probe,
            started_ms: now,
            input,
            metadata,
            mode,
        })))
    }

    /// Record the outcome of a probe run — in-lock or detached — as the
    /// entry's verification state and shape the `config.verify` envelope.
    pub(crate) fn finish_config_verify(
        &mut self,
        name: &str,
        at_ms: u64,
        result: SnapbackResult<Value>,
    ) -> SnapbackResult<ConfigVerifyOutcome> {
        let record = match result {
            Ok(value) => {
                let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(true);
                let diagnostic = if ok {
                    None
                } else {
                    Some(
                        value
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("probe reported failure")
                            .to_owned(),
                    )
                };
                VerificationRecord {
                    ok,
                    at_ms,
                    diagnostic,
                }
            }
            Err(error) => VerificationRecord {
                ok: false,
                at_ms,
                diagnostic: Some(format!(
                    "{}: {}",
                    error.diagnostic.code, error.diagnostic.message
                )),
            },
        };
        self.config.record_verification(name, record.clone())?;
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
            verified: record,
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

    pub fn register_ephemeral_collection(&mut self, collection: EphemeralCollection) {
        self.ephemeral.register_collection(collection);
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
    pub(crate) fn claim_due_cron_runs(&mut self, now_ms: u64) -> SnapbackResult<Vec<CronRunClaim>> {
        let active_live_functions = self.active_live_functions();
        let before_claim = self.cron.clone();
        let claims = self
            .cron
            .claim_due_runs(&self.functions, &active_live_functions, now_ms);
        if let Err(error) = self.persist_cron_state() {
            self.cron = before_claim;
            return Err(error);
        }
        Ok(claims)
    }

    /// Claim (and persist) a manual run of one cron job — the detached-flow
    /// counterpart of [`Self::run_cron_job_now`]'s claim step (ENG-23324).
    pub(crate) fn claim_manual_cron_run(
        &mut self,
        name: &str,
        now_ms: u64,
    ) -> SnapbackResult<CronRunClaim> {
        let before_claim = self.cron.clone();
        let claim = self.cron.claim_manual_run(&self.functions, name, now_ms)?;
        if let Err(error) = self.persist_cron_state() {
            self.cron = before_claim;
            return Err(error);
        }
        Ok(claim)
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
        let cron = LocalCronRuntime::from_persisted(db.load_cron_state()?);
        let mut recent_diagnostics = VecDeque::new();
        for diagnostic in runtime.diagnostics() {
            recent_diagnostics.push_back(diagnostic);
        }

        let read_manifests = Arc::new(RwLock::new(Arc::new(ReadManifests {
            functions: FunctionManifest::default(),
            schema: db.schema().clone(),
            capabilities: runtime.capabilities().clone(),
        })));

        Ok(Self {
            db,
            functions: FunctionManifest::default(),
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
        claims: Vec<CronRunClaim>,
    ) -> SnapbackResult<Vec<CronRunRecord>> {
        let mut records = Vec::new();
        for claim in claims {
            let started_wall_ms = now_millis();
            let result = self
                .invoke_action(
                    &claim.job.action,
                    cron_claim_input(&claim),
                    claim.metadata.clone(),
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
        claim: CronRunClaim,
        started_wall_ms: u64,
        result: Result<Value, Diagnostic>,
    ) -> SnapbackResult<CronRunRecord> {
        // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D8
        // (semantics LLP 0029 G6): measure real wall-clock around the run so
        // durationMs is not always zero. finished_at stays logically
        // consistent with the claim's start (start + elapsed), so a run's
        // duration reflects actual execution time on any clock the caller
        // stamped the claim with.
        let elapsed_ms = now_millis().saturating_sub(started_wall_ms);
        let finished_at_ms = claim.started_at_ms.saturating_add(elapsed_ms);
        let record = self.cron.finish_run(claim, finished_at_ms, result);
        self.persist_cron_state()?;
        if record.outcome == CronRunOutcome::Failed
            && let Some(diagnostic) = &record.diagnostic
        {
            self.record_diagnostics(vec![diagnostic.clone()]);
        }
        Ok(record)
    }

    pub(crate) fn invoke_action(
        &mut self,
        name: &str,
        input: HandlerInput,
        metadata: CronRunMetadata,
    ) -> SnapbackResult<Value> {
        let function = self.function(name)?.clone();
        match (&function.kind, &function.runtime) {
            (FunctionKind::Action, FunctionRuntime::HostPlan(HandlerPlan::Action(plan))) => {
                self.invoke_action_plan(plan, input, metadata)
            }
            (FunctionKind::Action, FunctionRuntime::IbexModule(module)) => {
                let runtime = self.runtime.clone();
                // @ref LLP 0036#runtime-exposure-d5-d8 — grants are computed
                // per invocation from the function's `uses` declaration; the
                // store is read through on every run (no caching), leaving VM
                // reuse questions to the DK-4 machinery.
                let grants = self.config_grants(&function);
                // One provenance root: every host call — mutation writes and
                // ctx.db reads alike — derives its reference from this *mut
                // per call, so no read borrow outlives a write under Stacked
                // Borrows. Host calls remain synchronous on this thread.
                let snapback = self as *mut LocalSnapback;
                let mut host = LocalIbexActionHost {
                    snapback,
                    _marker: PhantomData,
                };
                runtime.invoke_ibex_action(module, input, metadata, &mut host, grants)
            }
            _ => Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_KIND_MISMATCH",
                "runtime",
                format!("{name} is not an action"),
            )),
        }
    }

    fn invoke_action_plan(
        &mut self,
        plan: &ActionPlan,
        input: HandlerInput,
        metadata: CronRunMetadata,
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
                    let output = self.invoke_mutation(
                        name,
                        HandlerInput {
                            args: Value::Object(mutation_args),
                            auth: input.auth.clone(),
                            read_set: Vec::new(),
                            correlation: None,
                            ctx_ledger: None,                        },
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

        self.begin_live_delivery_frame(self.subscriptions.len());
        self.notify_live_subscriptions_in_frame(changes, &BTreeSet::new());
    }

    fn begin_live_delivery_frame(&mut self, subscriptions: usize) {
        self.live_delivery.total_fanout_attempts += subscriptions as u64;
        self.live_delivery.last_fanout_subscriptions = subscriptions;
        self.live_delivery.last_deliveries = 0;
        self.live_delivery.last_skipped = 0;
        self.live_delivery.last_failed = 0;
    }

    fn notify_live_subscriptions_in_frame(
        &mut self,
        changes: &[ChangedRow],
        already_resynced: &BTreeSet<String>,
    ) {
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
                match self.try_live_delta_fanout(&subscription, plan, changes) {
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
                        self.fail_subscription_fanout(&subscription, "live_delta_failed", error);
                        continue;
                    }
                    None => {}
                }
            }

            let query = match self
                .invoke_query_with_dependencies(&subscription.function, subscription.input.clone())
            {
                Ok(query) => query,
                Err(error) => {
                    self.fail_subscription_fanout(&subscription, "live_refresh_failed", error);
                    continue;
                }
            };
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
                    );
                    continue;
                }
            };
            if let Some(stored) = self.subscriptions.get_mut(&subscription.id) {
                stored.read_dependencies = query.read_dependencies;
            }
            self.ephemeral
                .enqueue_durable(subscription.connection_id, payload);
            self.live_delivery.total_deliveries += 1;
            self.live_delivery.last_deliveries += 1;
        }
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
    ) -> Option<DeltaFanout> {
        // The subscription must carry a captured Query dependency (its current
        // result membership); a subscription established before this change, or
        // one whose snapshot captured no query dependency, falls back.
        let query_dep_index = subscription
            .read_dependencies
            .iter()
            .position(|dependency| {
                dependency.kind == CapturedReadKind::Query
                    && dependency.table.as_deref() == Some(plan.table.as_str())
            })?;
        let prior_ids: BTreeSet<String> = subscription.read_dependencies[query_dep_index]
            .rows
            .iter()
            .cloned()
            .collect();

        let ops = match compute_live_delta(plan, &subscription.input, &prior_ids, changes) {
            LiveDeltaOutcome::Delta(ops) => ops,
            LiveDeltaOutcome::Replace => return None,
        };
        if ops.is_empty() {
            // The matcher flagged the subscription as possibly affected, but no
            // committed row actually enters/leaves/updates its result. Nothing
            // to deliver — no re-query needed either.
            return Some(DeltaFanout::NoChange);
        }

        // The commit version: read once on the write lane (this runs under the
        // global mutex right after commit, so it is exactly the commit's
        // version). If the read fails, fall back to the re-query path, which
        // carries its own version.
        let version = self.db.current_version().ok()?;

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
                return Some(DeltaFanout::Failed(
                    SnapbackError::error(
                        "SNAPBACK_LIVE_DELTA_SERIALIZE_FAILED",
                        "realtime",
                        "live query delta could not be serialized",
                    )
                    .with_details(json!({ "error": error.to_string() })),
                ));
            }
        };

        // Maintain this subscription's membership by applying the ops to its
        // captured Query dependency — no re-query. Add/remove change the id
        // set; update leaves membership unchanged. Refresh the dependency's
        // table-change version so the matcher's next affected-check is accurate.
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

        // Convergence gate (debug/test only): the delta-maintained member set
        // must equal what a fresh re-query would produce. Free in release; any
        // membership drift fails the test that exercises this path. (L4 parity
        // pattern.)
        #[cfg(debug_assertions)]
        self.debug_assert_delta_membership_converges(subscription, query_dep_index);

        self.ephemeral
            .enqueue_durable(subscription.connection_id.clone(), payload);
        Some(DeltaFanout::Delivered)
    }

    /// Debug-only: re-run the subscription's query and assert the
    /// delta-maintained membership (the captured Query dependency's `rows`)
    /// equals the fresh result's ids. Catches any op-application drift.
    #[cfg(debug_assertions)]
    fn debug_assert_delta_membership_converges(
        &self,
        subscription: &LiveSubscription,
        query_dep_index: usize,
    ) {
        let Ok(fresh) =
            self.invoke_query_with_dependencies(&subscription.function, subscription.input.clone())
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
    ) {
        self.live_delivery.total_failed += 1;
        self.live_delivery.last_failed += 1;
        let mut diagnostic = error.diagnostic;
        diagnostic.details = json!({
            "subscriptionId": subscription.id,
            "function": subscription.function,
            "reason": reason,
            "error": diagnostic.details,
        });
        self.record_diagnostics(vec![diagnostic]);
        if let Ok(payload) = serde_json::to_vec(&LiveEnvelope::ResyncRequired {
            reason: reason.to_owned(),
            subscription_id: Some(subscription.id.clone()),
            scope: Some(String::new()),
            epoch: Some(0),
            clear_retained: true,
        }) {
            self.ephemeral
                .enqueue_durable(subscription.connection_id.clone(), payload);
        }
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
    ) -> BTreeSet<String> {
        let mut resynced = BTreeSet::new();
        if changes.is_empty() || self.subscriptions.is_empty() {
            return resynced;
        }

        // Same prefilter shape as `notify_live_subscriptions` (ENG-23334):
        // the staleness check only borrows, so clone just the subscriptions
        // whose captured permission epochs the commit actually outran.
        let mut stale: Vec<(LiveSubscription, String, u64)> = Vec::new();
        for subscription in self.subscriptions.values() {
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
                    );
                    continue;
                }
            };
            self.ephemeral
                .enqueue_durable(subscription.connection_id, payload);
            self.live_delivery.total_deliveries += 1;
            self.live_delivery.last_deliveries += 1;
            resynced.insert(subscription.id);
        }
        resynced
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
}

/// What the read lane can serve for `/health` without the global mutex.
pub struct ReadHealth {
    pub version: u64,
    pub capabilities: RuntimeCapabilities,
}

impl ReadLane {
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
            Some(&self.warm_vms),
        )?;
        Ok(invocation.output)
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
    warm_vms: Option<&crate::warm_vm::WarmVmPool>,
) -> SnapbackResult<QueryInvocation> {
    match (&function.kind, &function.runtime) {
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
            let run =
                crate::runtime::run_ibex_query_with_reads(module, input.clone(), db, warm_vms)?;
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
    }
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
    let generate_id = || snapback.db.generate_id();
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
                    MutationStep::Insert { table, .. }
                    | MutationStep::InsertEach { table, .. } => {
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

fn live_stream_text(envelope: RealtimeEnvelope) -> Option<String> {
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
