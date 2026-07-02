use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use crate::ephemeral::EphemeralCollection;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub const SNAPBACK_SCHEMA_VERSION: &str = "snapback.v0";
pub const TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX: &str = "local-dev-sqlite-ibex";

fn schema_manifest_kind() -> String {
    "schemaManifest".to_owned()
}

fn function_manifest_kind() -> String {
    "functionManifest".to_owned()
}

fn capability_manifest_kind() -> String {
    "capabilityManifest".to_owned()
}

fn snapback_schema_version() -> String {
    SNAPBACK_SCHEMA_VERSION.to_owned()
}

fn local_app_id() -> String {
    "local-app".to_owned()
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct SchemaManifest {
    #[serde(
        default = "schema_manifest_kind",
        rename = "artifactKind",
        alias = "artifact_kind"
    )]
    pub artifact_kind: String,
    #[serde(
        default = "snapback_schema_version",
        rename = "schemaVersion",
        alias = "schema_version"
    )]
    pub schema_version: String,
    #[serde(default = "local_app_id", rename = "appId", alias = "app_id")]
    pub app_id: String,
    #[serde(default, rename = "schemaHash", alias = "schema_hash")]
    pub schema_hash: Option<String>,
    #[serde(default, rename = "inputsHash", alias = "inputs_hash")]
    pub inputs_hash: Option<String>,
    #[serde(default, rename = "generatedAt", alias = "generated_at")]
    pub generated_at: Option<u64>,
    #[serde(default, rename = "sourceHash", alias = "source_hash")]
    pub source_hash: Option<String>,
    #[serde(
        default,
        rename = "artifactDiagnostics",
        alias = "artifact_diagnostics"
    )]
    pub artifact_diagnostics: Vec<Diagnostic>,
    #[serde(default, rename = "targetProfile", alias = "target_profile")]
    pub target_profile: Option<String>,
    #[serde(default, rename = "portabilityFlags", alias = "portability_flags")]
    pub portability_flags: Vec<String>,
    #[serde(
        default,
        rename = "ephemeralCollections",
        alias = "ephemeral_collections"
    )]
    pub ephemeral_collections: Vec<EphemeralCollection>,
    pub tables: Vec<TableManifest>,
}

impl Default for SchemaManifest {
    fn default() -> Self {
        Self {
            artifact_kind: schema_manifest_kind(),
            schema_version: snapback_schema_version(),
            app_id: local_app_id(),
            schema_hash: None,
            inputs_hash: None,
            generated_at: None,
            source_hash: None,
            artifact_diagnostics: Vec::new(),
            target_profile: Some(TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned()),
            portability_flags: Vec::new(),
            ephemeral_collections: Vec::new(),
            tables: Vec::new(),
        }
    }
}

impl SchemaManifest {
    pub fn table(&self, name: &str) -> Option<&TableManifest> {
        self.tables.iter().find(|table| table.name == name)
    }

    pub fn validate_artifact(&self) -> SnapbackResult<()> {
        validate_artifact_header(
            "schema",
            "schemaManifest",
            &self.artifact_kind,
            &self.schema_version,
            self.schema_hash.as_deref(),
            self.inputs_hash.as_deref(),
        )
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct TableManifest {
    pub name: String,
    #[serde(default)]
    pub fields: Vec<FieldManifest>,
    #[serde(default)]
    pub indexes: Vec<IndexManifest>,
    #[serde(default)]
    pub syncable: bool,
}

impl TableManifest {
    pub fn field(&self, name: &str) -> Option<&FieldManifest> {
        self.fields.iter().find(|field| field.name == name)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct FieldManifest {
    pub name: String,
    pub field_type: FieldType,
    #[serde(default)]
    pub optional: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum FieldType {
    String,
    Boolean,
    Integer,
    Real,
    Json,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct IndexManifest {
    pub name: String,
    pub fields: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct FunctionManifest {
    #[serde(
        default = "function_manifest_kind",
        rename = "artifactKind",
        alias = "artifact_kind"
    )]
    pub artifact_kind: String,
    #[serde(
        default = "snapback_schema_version",
        rename = "schemaVersion",
        alias = "schema_version"
    )]
    pub schema_version: String,
    #[serde(default = "local_app_id", rename = "appId", alias = "app_id")]
    pub app_id: String,
    #[serde(default, rename = "bundleHash", alias = "bundle_hash")]
    pub bundle_hash: Option<String>,
    #[serde(default, rename = "inputsHash", alias = "inputs_hash")]
    pub inputs_hash: Option<String>,
    #[serde(default, rename = "generatedAt", alias = "generated_at")]
    pub generated_at: Option<u64>,
    #[serde(
        default,
        rename = "unsupportedDependencyDiagnostics",
        alias = "unsupported_dependency_diagnostics"
    )]
    pub unsupported_dependency_diagnostics: Vec<Diagnostic>,
    #[serde(default)]
    pub functions: Vec<FunctionDefinition>,
    #[serde(default, rename = "cronJobs", alias = "cron_jobs")]
    pub cron_jobs: Vec<CronJobDefinition>,
    /// @ref LLP 0036#declared-configuration-in-the-manifest — declared config
    /// entries ride the generated function manifest the way cron jobs do.
    #[serde(default)]
    pub config: Vec<ConfigEntryDefinition>,
}

impl Default for FunctionManifest {
    fn default() -> Self {
        Self {
            artifact_kind: function_manifest_kind(),
            schema_version: snapback_schema_version(),
            app_id: local_app_id(),
            bundle_hash: None,
            inputs_hash: None,
            generated_at: None,
            unsupported_dependency_diagnostics: Vec::new(),
            functions: Vec::new(),
            cron_jobs: Vec::new(),
            config: Vec::new(),
        }
    }
}

impl FunctionManifest {
    pub fn function(&self, name: &str) -> Option<&FunctionDefinition> {
        self.functions
            .iter()
            .find(|function| function.name == name || function.id.as_deref() == Some(name))
    }

    pub fn validate_artifact(&self) -> SnapbackResult<()> {
        validate_artifact_header(
            "function",
            "functionManifest",
            &self.artifact_kind,
            &self.schema_version,
            self.bundle_hash.as_deref(),
            self.inputs_hash.as_deref(),
        )
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct FunctionDefinition {
    #[serde(default, rename = "id")]
    pub id: Option<String>,
    pub name: String,
    #[serde(default, rename = "exportedName", alias = "exported_name")]
    pub exported_name: Option<String>,
    pub kind: FunctionKind,
    #[serde(default, rename = "sourceSpan", alias = "source_span")]
    pub source_span: Option<SourceSpan>,
    #[serde(
        default,
        rename = "requiredCapabilities",
        alias = "required_capabilities"
    )]
    pub required_capabilities: Vec<String>,
    #[serde(default, rename = "authRequirement", alias = "auth_requirement")]
    pub auth_requirement: Option<String>,
    #[serde(default, rename = "syncabilityClass", alias = "syncability_class")]
    pub syncability_class: Option<String>,
    #[serde(default, rename = "readSetSummary", alias = "read_set_summary")]
    pub read_set_summary: DependencySummary,
    #[serde(default, rename = "writeSetSummary", alias = "write_set_summary")]
    pub write_set_summary: DependencySummary,
    #[serde(
        default,
        rename = "permissionEpochBumps",
        alias = "permission_epoch_bumps"
    )]
    pub permission_epoch_bumps: Vec<PermissionScopeExpr>,
    #[serde(default, rename = "bundleEntrypoint", alias = "bundle_entrypoint")]
    pub bundle_entrypoint: Option<String>,
    /// @ref LLP 0036#declared-configuration-in-the-manifest — D8: the config
    /// entries this function may receive. Declaring an entry makes it exist;
    /// only functions that name it here are granted it at runtime.
    #[serde(default)]
    pub uses: Vec<String>,
    pub runtime: FunctionRuntime,
}

impl FunctionDefinition {
    pub fn new(name: impl Into<String>, kind: FunctionKind, runtime: FunctionRuntime) -> Self {
        let name = name.into();
        let syncability_class = match kind {
            FunctionKind::LiveQuery => "syncable-live",
            FunctionKind::Query => "online-only",
            FunctionKind::Mutation => "mutation",
            FunctionKind::Action => "action",
        };
        Self {
            id: Some(format!("fn:{name}")),
            name: name.clone(),
            exported_name: Some(name.clone()),
            kind,
            source_span: None,
            required_capabilities: Vec::new(),
            auth_requirement: None,
            syncability_class: Some(syncability_class.to_owned()),
            read_set_summary: DependencySummary::default(),
            write_set_summary: DependencySummary::default(),
            permission_epoch_bumps: Vec::new(),
            bundle_entrypoint: Some(name),
            uses: Vec::new(),
            runtime,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum PermissionScopeExpr {
    AuthUser,
    Arg(String),
    Literal(String),
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct SourceSpan {
    pub file: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct DependencySummary {
    #[serde(default, rename = "primaryTable", alias = "primary_table")]
    pub primary_table: Option<String>,
    #[serde(default)]
    pub tables: Vec<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default, rename = "authScopeField", alias = "auth_scope_field")]
    pub auth_scope_field: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum FunctionKind {
    Query,
    Mutation,
    LiveQuery,
    Action,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum FunctionRuntime {
    HostPlan(HandlerPlan),
    IbexModule(IbexModule),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct IbexModule {
    pub source: String,
    pub export: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum HandlerPlan {
    Query(QueryPlan),
    Mutation(MutationPlan),
    Action(ActionPlan),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct ActionPlan {
    #[serde(default)]
    pub steps: Vec<ActionStep>,
    #[serde(default, rename = "returnValue", alias = "return_value")]
    pub return_value: Option<ActionReturnValue>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ActionStep {
    RunMutation {
        name: String,
        #[serde(default)]
        args: BTreeMap<String, ValueExpr>,
        #[serde(default, rename = "bindResultAs", alias = "bind_result_as")]
        bind_result_as: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ActionReturnValue {
    Literal(Value),
    Binding(String),
    LastMutationResult,
    ChangedCount,
}

/// @ref LLP 0028#cron-job-definition — generated function manifests carry
/// source-authored cron jobs beside query/mutation/action handlers.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronJobDefinition {
    pub name: String,
    pub schedule: CronSchedule,
    pub action: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub activation: CronActivationPolicy,
    #[serde(default, rename = "jitterPolicy", alias = "jitter_policy")]
    pub jitter_policy: CronJitterPolicy,
    #[serde(default, rename = "overlapPolicy", alias = "overlap_policy")]
    pub overlap_policy: CronOverlapPolicy,
    #[serde(default, rename = "retryPolicy", alias = "retry_policy")]
    pub retry_policy: CronRetryPolicy,
    #[serde(
        default,
        rename = "requiredCapabilities",
        alias = "required_capabilities"
    )]
    pub required_capabilities: Vec<String>,
    #[serde(default, rename = "targetWakeup", alias = "target_wakeup")]
    pub target_wakeup: Option<CronTargetWakeup>,
    #[serde(default, rename = "sourceSpan", alias = "source_span")]
    pub source_span: Option<SourceSpan>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronSchedule {
    #[serde(default, rename = "everyMs", alias = "every_ms")]
    pub every_ms: Option<u64>,
    #[serde(default)]
    pub cron: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronActivationPolicy {
    pub kind: CronActivationKind,
    #[serde(default, rename = "whileLive", alias = "while_live")]
    pub while_live: Vec<String>,
}

impl Default for CronActivationPolicy {
    fn default() -> Self {
        Self {
            kind: CronActivationKind::Always,
            while_live: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CronActivationKind {
    Always,
    WhileLive,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronJitterPolicy {
    pub enabled: bool,
    #[serde(rename = "maxOffsetMs", alias = "max_offset_ms")]
    pub max_offset_ms: u64,
}

impl Default for CronJitterPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            max_offset_ms: 0,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CronOverlapPolicy {
    NoOverlap,
    Allow,
}

impl Default for CronOverlapPolicy {
    fn default() -> Self {
        Self::NoOverlap
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronRetryPolicy {
    pub mode: CronRetryMode,
}

impl Default for CronRetryPolicy {
    fn default() -> Self {
        Self {
            mode: CronRetryMode::NextTick,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CronRetryMode {
    NextTick,
    Backoff,
}

/// @ref LLP 0036#declared-configuration-in-the-manifest — one declared config
/// entry: names, purposes, and acquisition metadata are app source (public by
/// construction); values never appear in any manifest.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct ConfigEntryDefinition {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    /// Default **true**: misclassification fails safe — forgetting the flag
    /// makes a value more protected, never less (LLP 0036 D5).
    #[serde(default = "default_true")]
    pub secret: bool,
    #[serde(default = "default_true")]
    pub required: bool,
    /// The entry holds an ordered pool of values rotated across invocations.
    #[serde(default)]
    pub pool: bool,
    /// Name of a declared action that test-calls the value (`config.verify`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub probe: Option<String>,
    #[serde(
        default,
        rename = "howToGet",
        alias = "how_to_get",
        skip_serializing_if = "Option::is_none"
    )]
    pub how_to_get: Option<String>,
    /// Structured, agent-readable acquisition metadata (LLP 0036 D6). The host
    /// carries it verbatim to status/wizard consumers; v1 does not interpret it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acquisition: Option<Value>,
    /// Non-secret entries only; carried for forward compatibility. v1 rejects
    /// non-secret entries at manifest validation, so this is always absent in
    /// an accepted manifest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<Value>,
    #[serde(default, rename = "sourceSpan", alias = "source_span")]
    pub source_span: Option<SourceSpan>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CronTargetWakeup {
    pub kind: CronTargetWakeupKind,
    #[serde(default, rename = "needsDurableRunner", alias = "needs_durable_runner")]
    pub needs_durable_runner: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CronTargetWakeupKind {
    IntervalMs,
    CronExpression,
    DynamicAlarm,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct QueryPlan {
    pub table: String,
    #[serde(default)]
    pub filters: Vec<FilterExpr>,
    #[serde(default)]
    pub order: Vec<OrderExpr>,
    pub limit: Option<usize>,
    pub indexed_by: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct FilterExpr {
    pub field: String,
    pub op: FilterOp,
    pub value: ValueExpr,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum FilterOp {
    Eq,
    In,
    Lt,
    Lte,
    Gt,
    Gte,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct OrderExpr {
    pub field: String,
    pub direction: OrderDirection,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum OrderDirection {
    Asc,
    Desc,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct MutationPlan {
    #[serde(default)]
    pub steps: Vec<MutationStep>,
    pub return_value: Option<ReturnValue>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum MutationStep {
    Insert {
        table: String,
        values: BTreeMap<String, ValueExpr>,
        bind_id_as: Option<String>,
    },
    Patch {
        table: String,
        id: ValueExpr,
        values: BTreeMap<String, ValueExpr>,
    },
    Delete {
        table: String,
        id: ValueExpr,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ReturnValue {
    Literal(Value),
    Binding(String),
    Document { table: String, id: ValueExpr },
    ChangedCount,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ValueExpr {
    Arg(String),
    AuthUserId,
    Binding(String),
    Literal(Value),
    RuntimeId,
    RuntimeNow,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct AuthInput {
    pub principal: Option<String>,
    pub session_id: Option<String>,
    pub user_id: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct HandlerInput {
    #[serde(default)]
    pub args: Value,
    #[serde(default)]
    pub auth: AuthInput,
    #[serde(default)]
    pub read_set: Vec<ReadDependency>,
    /// Opaque adapter-stitched correlation (LLP 0034 §3.2, ENG-22478): the
    /// Exact adapter's join keys (`actionInvocationId`, `optimisticWaveId`,
    /// `rootId`, `bindingIds`) live inside. The provider echoes it verbatim
    /// on receipts and never interprets it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct ReadDependency {
    pub table: String,
    pub id: String,
    pub version: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct QueryOutput {
    pub version: u64,
    pub rows: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct MutationOutput {
    pub version: u64,
    pub changed_count: usize,
    pub result: Value,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct SeedData {
    #[serde(default)]
    pub tables: BTreeMap<String, Vec<Map<String, Value>>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CapabilityManifest {
    #[serde(
        default = "capability_manifest_kind",
        rename = "artifactKind",
        alias = "artifact_kind"
    )]
    pub artifact_kind: String,
    #[serde(
        default = "snapback_schema_version",
        rename = "schemaVersion",
        alias = "schema_version"
    )]
    pub schema_version: String,
    #[serde(rename = "targetProfileId", alias = "target_profile_id")]
    pub target_profile_id: String,
    #[serde(rename = "storageEngine", alias = "storage_engine")]
    pub storage_engine: String,
    #[serde(rename = "runtimeEngine", alias = "runtime_engine")]
    pub runtime_engine: String,
    #[serde(rename = "localServerLifecycle", alias = "local_server_lifecycle")]
    pub local_server_lifecycle: bool,
    #[serde(rename = "liveSubscriptions", alias = "live_subscriptions")]
    pub live_subscriptions: bool,
    #[serde(rename = "syncableLiveQueries", alias = "syncable_live_queries")]
    pub syncable_live_queries: bool,
    #[serde(rename = "onlineOnlyQueries", alias = "online_only_queries")]
    pub online_only_queries: bool,
    #[serde(rename = "replaceOnlyQueries", alias = "replace_only_queries")]
    pub replace_only_queries: bool,
    #[serde(default, rename = "ephemeralRealtime", alias = "ephemeral_realtime")]
    pub ephemeral_realtime: bool,
    #[serde(
        default,
        rename = "ephemeralWebSocketPublish",
        alias = "ephemeral_websocket_publish"
    )]
    pub ephemeral_websocket_publish: bool,
    #[serde(
        default,
        rename = "ephemeralLocalRoomAuthority",
        alias = "ephemeral_local_room_authority"
    )]
    pub ephemeral_local_room_authority: bool,
    #[serde(
        default,
        rename = "ephemeralHostedAdapter",
        alias = "ephemeral_hosted_adapter"
    )]
    pub ephemeral_hosted_adapter: bool,
    #[serde(rename = "offlineRetention", alias = "offline_retention")]
    pub offline_retention: bool,
    #[serde(rename = "optimisticReplay", alias = "optimistic_replay")]
    pub optimistic_replay: bool,
    #[serde(rename = "mutationIsolationMode", alias = "mutation_isolation_mode")]
    pub mutation_isolation_mode: String,
    #[serde(rename = "authImpersonation", alias = "auth_impersonation")]
    pub auth_impersonation: bool,
    #[serde(rename = "permissionDiagnostics", alias = "permission_diagnostics")]
    pub permission_diagnostics: bool,
    #[serde(rename = "assetUpload", alias = "asset_upload")]
    pub asset_upload: bool,
    #[serde(rename = "outboundActions", alias = "outbound_actions")]
    pub outbound_actions: bool,
    pub cron: bool,
    pub notifications: bool,
    #[serde(rename = "supportedQueryForms", alias = "supported_query_forms")]
    pub supported_query_forms: Vec<String>,
    #[serde(rename = "portabilityOptOuts", alias = "portability_opt_outs")]
    pub portability_opt_outs: Vec<String>,
    #[serde(rename = "resourceLimits", alias = "resource_limits")]
    pub resource_limits: Vec<ResourceLimit>,
    #[serde(rename = "capabilityGaps", alias = "capability_gaps")]
    pub capability_gaps: Vec<String>,
    /// VM lifecycle for handler execution: `"fresh-per-invocation"` (the
    /// durable default and the only hosted posture) or `"warm-pooled-reset"`
    /// (the DK-4 trusted-local optimization — VM reuse per bundle behind a
    /// verified per-invocation reset). Surfaced so LLP 0012's honesty rule
    /// holds: an agent can see which execution semantics are in force.
    ///
    /// @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 — capability flag.
    #[serde(
        rename = "vmLifecycle",
        alias = "vm_lifecycle",
        default = "vm_lifecycle_fresh"
    )]
    pub vm_lifecycle: String,
}

pub(crate) fn vm_lifecycle_fresh() -> String {
    "fresh-per-invocation".to_owned()
}

pub(crate) const VM_LIFECYCLE_WARM_POOLED_RESET: &str = "warm-pooled-reset";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct ResourceLimit {
    pub name: String,
    pub status: ResourceLimitStatus,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ResourceLimitStatus {
    Enforced,
    Advisory,
    Missing,
}

impl CapabilityManifest {
    pub fn local_v0(capability_gaps: Vec<String>) -> Self {
        Self {
            artifact_kind: capability_manifest_kind(),
            schema_version: snapback_schema_version(),
            target_profile_id: TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            storage_engine: "sqlite".to_owned(),
            runtime_engine: "ibex".to_owned(),
            local_server_lifecycle: true,
            live_subscriptions: true,
            syncable_live_queries: true,
            online_only_queries: true,
            replace_only_queries: true,
            ephemeral_realtime: true,
            ephemeral_websocket_publish: true,
            ephemeral_local_room_authority: true,
            ephemeral_hosted_adapter: false,
            offline_retention: false,
            optimistic_replay: false,
            mutation_isolation_mode: "handler-captured-read-set-validation".to_owned(),
            auth_impersonation: true,
            permission_diagnostics: false,
            asset_upload: false,
            outbound_actions: false,
            cron: true,
            notifications: false,
            supported_query_forms: vec![
                "host-plan-single-table-eq".to_owned(),
                "host-plan-single-table-in".to_owned(),
                "host-plan-single-table-range".to_owned(),
                "host-plan-live-replace".to_owned(),
                "ibex-ctx-db-single-table-eq".to_owned(),
                "ibex-ctx-db-single-table-in".to_owned(),
                "ibex-ctx-db-single-table-range".to_owned(),
                "ibex-live-eq-replace".to_owned(),
                "ibex-live-in-replace".to_owned(),
                "ibex-live-range-replace".to_owned(),
                "ibex-live-limited-boundary-replace".to_owned(),
                "websocket-live-replace".to_owned(),
                "ephemeral-latest-state-local".to_owned(),
                "websocket-ephemeral-publish".to_owned(),
                "cron-fixed-interval-local".to_owned(),
                "cron-calendar-local".to_owned(),
                "cron-action-run-mutation".to_owned(),
            ],
            portability_opt_outs: Vec::new(),
            resource_limits: vec![
                ResourceLimit {
                    name: "wall_clock_timeout".to_owned(),
                    status: ResourceLimitStatus::Missing,
                },
                ResourceLimit {
                    name: "cpu_budget".to_owned(),
                    status: ResourceLimitStatus::Missing,
                },
                ResourceLimit {
                    name: "maximum_result_size".to_owned(),
                    status: ResourceLimitStatus::Advisory,
                },
                ResourceLimit {
                    name: "maximum_subscription_count".to_owned(),
                    status: ResourceLimitStatus::Advisory,
                },
                ResourceLimit {
                    name: "ephemeral_value_size".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "ephemeral_publish_rate".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "ephemeral_durable_lane_priority".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
            ],
            capability_gaps,
            // Conservative default; `LocalSnapback::inspect` overrides it
            // with the live per-instance value (warm pool enabled or not).
            vm_lifecycle: vm_lifecycle_fresh(),
        }
    }
}

fn validate_artifact_header(
    subsystem: &str,
    expected_kind: &str,
    artifact_kind: &str,
    schema_version: &str,
    content_hash: Option<&str>,
    inputs_hash: Option<&str>,
) -> SnapbackResult<()> {
    if artifact_kind != expected_kind {
        return Err(SnapbackError::error(
            format!(
                "SNAPBACK_STALE_{}_ARTIFACT_KIND",
                subsystem.to_ascii_uppercase()
            ),
            subsystem,
            format!("expected {expected_kind} artifact but received {artifact_kind}"),
        )
        .with_artifact_details(
            expected_kind,
            artifact_kind,
            schema_version,
            content_hash,
            inputs_hash,
        ));
    }

    if schema_version != SNAPBACK_SCHEMA_VERSION {
        return Err(SnapbackError::error(
            format!(
                "SNAPBACK_STALE_{}_ARTIFACT_VERSION",
                subsystem.to_ascii_uppercase()
            ),
            subsystem,
            format!("unsupported {expected_kind} schema version {schema_version}"),
        )
        .with_artifact_details(
            expected_kind,
            artifact_kind,
            schema_version,
            content_hash,
            inputs_hash,
        ));
    }

    Ok(())
}

trait ArtifactDiagnosticExt {
    fn with_artifact_details(
        self,
        expected_kind: &str,
        artifact_kind: &str,
        schema_version: &str,
        content_hash: Option<&str>,
        inputs_hash: Option<&str>,
    ) -> Self;
}

impl ArtifactDiagnosticExt for SnapbackError {
    fn with_artifact_details(
        mut self,
        expected_kind: &str,
        artifact_kind: &str,
        schema_version: &str,
        content_hash: Option<&str>,
        inputs_hash: Option<&str>,
    ) -> Self {
        self.diagnostic.details = serde_json::json!({
            "expectedArtifactKind": expected_kind,
            "artifactKind": artifact_kind,
            "expectedSchemaVersion": SNAPBACK_SCHEMA_VERSION,
            "schemaVersion": schema_version,
            "contentHash": content_hash,
            "inputsHash": inputs_hash,
        });
        self
    }
}
