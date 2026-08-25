use super::*;

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
    /// Canonical identity of the served route manifest, or `absent`.
    /// Public because it binds generated route references without disclosing
    /// route names or arguments.
    #[serde(rename = "routeManifestHash")]
    pub route_manifest_hash: String,
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
    #[serde(rename = "liveMatcher")]
    pub live_matcher: LiveMatcherDecisionStats,
    #[serde(rename = "liveEvaluation")]
    pub live_evaluation: LiveEvaluationStats,
    #[serde(rename = "liveCoalesce")]
    pub live_coalesce: crate::live_coalesce::LiveCoalesceStats,
    #[serde(rename = "liveSettlement")]
    pub live_settlement: LiveSettlementStats,
    #[serde(rename = "liveAuthority")]
    pub live_authority: LiveAuthorityLaneStats,
    #[serde(rename = "liveWatermarks")]
    pub live_watermarks: LiveWatermarkStats,
    /// Pull-only, process-local cost diagnostics. The exhaustive
    /// `PublicInspect` projection below deliberately drops this entire field.
    #[serde(rename = "runtimeCost")]
    pub runtime_cost: RuntimeCostSnapshotV1,
    pub ephemeral: EphemeralDiagnostics,
    pub cron: CronInspectState,
    pub maintenance: MaintenanceDiagnostics,
    /// Local-development equivalent-work facts. This field is deliberately
    /// dropped by `PublicInspect`; hosted/default-prod recorders stay off.
    #[serde(rename = "equivalentWork")]
    pub equivalent_work: EquivalentWorkInspect,
    /// Current loss-tolerant telemetry producer state. Raw retained events do
    /// not appear here; this is the D3 buffer depth/drop/freshness instant.
    pub telemetry: crate::telemetry::BufferDiagnostics,
    #[serde(rename = "pushRegistry")]
    pub push_registry: crate::push::PushRegistryInspectionV1,
    #[serde(rename = "recentDiagnostics", alias = "recent_diagnostics")]
    pub recent_diagnostics: Vec<Diagnostic>,
    #[serde(rename = "capabilityGaps", alias = "capability_gaps")]
    pub capability_gaps: Vec<String>,
}

/// Bounded, value-free mutation no-op counters (LLP 0267 §§7.5-7.7).
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EquivalentWorkInspect {
    pub enabled: bool,
    pub key_capacity: usize,
    pub noop_commits: Vec<NoopCommitFact>,
    pub other_keys: EquivalentWorkOtherKeys,
    pub evicted_keys: u64,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NoopCommitFact {
    pub function_id: String,
    pub count: u64,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EquivalentWorkOtherKeys {
    pub noop_commits: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LiveSubscriptionInfo {
    pub id: String,
    pub connection_id: String,
    pub function: String,
}

/// Structured receipt for `debug.live.forceResync` (LLP 0184 §B). Names the
/// consumed target by id, never a live token/credential; the operator/test
/// `reason` is recorded verbatim so the receipt is auditable without source
/// archaeology.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForceLiveResyncReceipt {
    pub connection_id: String,
    pub subscription_id: String,
    pub function: String,
    pub reason: String,
    #[serde(rename = "clearRetained")]
    pub clear_retained: bool,
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
    #[serde(rename = "routeManifestHash")]
    pub route_manifest_hash: String,
    pub subscriptions: Vec<PublicSubscriptionInfo>,
    #[serde(rename = "activeConnections")]
    pub active_connections: usize,
    #[serde(rename = "reapedConnections")]
    pub reaped_connections: u64,
    #[serde(rename = "liveDelivery")]
    pub live_delivery: LiveDeliveryStats,
    #[serde(rename = "liveMatcher")]
    pub live_matcher: LiveMatcherDecisionStats,
    #[serde(rename = "liveEvaluation")]
    pub live_evaluation: LiveEvaluationStats,
    #[serde(rename = "liveCoalesce")]
    pub live_coalesce: crate::live_coalesce::LiveCoalesceStats,
    #[serde(rename = "liveSettlement")]
    pub live_settlement: LiveSettlementStats,
    #[serde(rename = "liveAuthority")]
    pub live_authority: LiveAuthorityLaneStats,
    #[serde(rename = "liveWatermarks")]
    pub live_watermarks: LiveWatermarkStats,
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
pub enum MaintenanceOperation {
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
            route_manifest_hash,
            subscriptions,
            active_connections,
            reaped_connections,
            live_delivery,
            live_matcher,
            live_evaluation,
            live_coalesce,
            live_settlement,
            live_authority,
            live_watermarks,
            runtime_cost: _,
            ephemeral,
            cron,
            maintenance,
            equivalent_work: _,
            telemetry: _,
            push_registry: _,
            recent_diagnostics,
            capability_gaps,
        } = inspect;
        let StorageInfo {
            sqlite_path: _,
            version,
            tables,
            client_mutation_retention: _,
        } = storage;
        let exposed_names = schema.uses_exposed_only_disclosure().then(|| {
            functions
                .functions
                .iter()
                .filter(|function| {
                    function
                        .api_exposure
                        .as_ref()
                        .is_some_and(|exposure| exposure.expose)
                })
                .map(|function| function.name.clone())
                .collect::<std::collections::BTreeSet<_>>()
        });
        let public_functions =
            crate::manifest::public_function_manifest_for_schema(&schema, functions);
        PublicInspect {
            artifact_kind,
            schema_version,
            target_profile_id,
            target,
            storage: PublicStorageInfo { version, tables },
            runtime: runtime.into(),
            schema: schema.into(),
            functions: public_functions,
            capability_manifest,
            route_manifest_hash,
            subscriptions: subscriptions
                .into_iter()
                .filter(|subscription| {
                    exposed_names
                        .as_ref()
                        .is_none_or(|names| names.contains(&subscription.function))
                })
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
            live_matcher,
            live_evaluation,
            live_coalesce,
            live_settlement,
            live_authority,
            live_watermarks,
            ephemeral: ephemeral.into(),
            cron: cron.into(),
            maintenance,
            recent_diagnostics: recent_diagnostics.into_iter().map(Into::into).collect(),
            capability_gaps,
        }
    }
}
