//! Shared observation-classification contract for telemetry and metering.
//!
//! This module is deliberately pure. It classifies and projects an admitted
//! observation but owns no queue, writer, database, or transport. Telemetry
//! continues to use the lossy sibling-store path in [`crate::telemetry`], and
//! a bill-grade consumer can use the same envelope through its separately
//! reliable LLP 0104 delivery path.
//!
//! @ref LLP 0154#d2--the-observation-span-classification-registry-and-phase-1-kinds —
//!   one versioned vocabulary and projection matrix is shared by telemetry and
//!   metering without making either transport authoritative for the other.
//! @ref LLP 0154#substrate-constraints-what-the-design-must-honor — C7 keeps
//!   this to classification and pure projection; it cannot turn the lossy
//!   telemetry buffer into a bill-grade source.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub const DEFAULT_MAX_DAYS: u32 = 7;
pub const MAX_MAX_DAYS: u32 = 365;
pub const DEFAULT_BUFFER_CAPACITY: usize = 4_096;
pub const DEFAULT_PRIORITY_RESERVE: usize = 512;
pub const DEFAULT_BATCH_SIZE: usize = 256;
pub const DEFAULT_MAX_AGE_MS: u64 = 3_000;
pub const DEFAULT_FILE_SIZE_CAP_BYTES: u64 = 256 * 1024 * 1024;
pub const DEFAULT_HOURLY_DAYS: u32 = 90;
pub const DEFAULT_DAILY_DAYS: u32 = 730;
pub const DEFAULT_TOP_NAMES_PER_HOUR: usize = 200;
pub const DEFAULT_ROLLUP_ROW_CAP: usize = 1_000_000;
pub const DEFAULT_SWEEP_INTERVAL_MS: u64 = 6 * 60 * 60 * 1_000;

fn default_max_days() -> u32 {
    DEFAULT_MAX_DAYS
}
fn default_min_level() -> crate::diagnostic::DiagnosticSeverity {
    crate::diagnostic::DiagnosticSeverity::Info
}
fn default_buffer_capacity() -> usize {
    DEFAULT_BUFFER_CAPACITY
}
fn default_priority_reserve() -> usize {
    DEFAULT_PRIORITY_RESERVE
}
fn default_batch_size() -> usize {
    DEFAULT_BATCH_SIZE
}
fn default_max_age_ms() -> u64 {
    DEFAULT_MAX_AGE_MS
}
fn default_file_size_cap_bytes() -> u64 {
    DEFAULT_FILE_SIZE_CAP_BYTES
}
fn default_hourly_days() -> u32 {
    DEFAULT_HOURLY_DAYS
}
fn default_daily_days() -> u32 {
    DEFAULT_DAILY_DAYS
}
fn default_top_names_per_hour() -> usize {
    DEFAULT_TOP_NAMES_PER_HOUR
}
fn default_rollup_row_cap() -> usize {
    DEFAULT_ROLLUP_ROW_CAP
}
fn default_sweep_interval_ms() -> u64 {
    DEFAULT_SWEEP_INTERVAL_MS
}

/// Deployment-owned telemetry knobs persisted in the existing config sibling.
/// Bounds are resource-safety limits, not commercial entitlements.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryConfig {
    #[serde(default = "default_max_days")]
    pub max_days: u32,
    #[serde(default = "default_min_level")]
    pub min_level: crate::diagnostic::DiagnosticSeverity,
    #[serde(default = "default_buffer_capacity")]
    pub buffer_capacity: usize,
    #[serde(default = "default_priority_reserve")]
    pub priority_reserve: usize,
    #[serde(default = "default_batch_size")]
    pub batch_size: usize,
    #[serde(default = "default_max_age_ms")]
    pub max_age_ms: u64,
    #[serde(default = "default_file_size_cap_bytes")]
    pub file_size_cap_bytes: u64,
    #[serde(default = "default_hourly_days")]
    pub hourly_days: u32,
    #[serde(default = "default_daily_days")]
    pub daily_days: u32,
    #[serde(default = "default_top_names_per_hour")]
    pub top_names_per_hour: usize,
    #[serde(default = "default_rollup_row_cap")]
    pub rollup_row_cap: usize,
    #[serde(default = "default_sweep_interval_ms")]
    pub sweep_interval_ms: u64,
}

impl Default for TelemetryConfig {
    fn default() -> Self {
        Self {
            max_days: default_max_days(),
            min_level: default_min_level(),
            buffer_capacity: default_buffer_capacity(),
            priority_reserve: default_priority_reserve(),
            batch_size: default_batch_size(),
            max_age_ms: default_max_age_ms(),
            file_size_cap_bytes: default_file_size_cap_bytes(),
            hourly_days: default_hourly_days(),
            daily_days: default_daily_days(),
            top_names_per_hour: default_top_names_per_hour(),
            rollup_row_cap: default_rollup_row_cap(),
            sweep_interval_ms: default_sweep_interval_ms(),
        }
    }
}

impl TelemetryConfig {
    pub fn validate(&self) -> crate::diagnostic::SnapbackResult<()> {
        let valid = self.max_days <= MAX_MAX_DAYS
            && self.buffer_capacity > 0
            && self.buffer_capacity <= 1_000_000
            && self.priority_reserve > 0
            && self.priority_reserve < self.buffer_capacity
            && self.batch_size > 0
            && self.batch_size <= 1_024
            && self.max_age_ms > 0
            && self.max_age_ms <= 60_000
            && self.file_size_cap_bytes >= 1024 * 1024
            && self.file_size_cap_bytes <= 16 * 1024 * 1024 * 1024
            && self.hourly_days > 0
            && self.daily_days >= self.hourly_days
            && self.daily_days <= 3_650
            && self.top_names_per_hour > 0
            && self.top_names_per_hour <= 10_000
            && self.rollup_row_cap > 0
            && self.rollup_row_cap <= 10_000_000
            && self.sweep_interval_ms > 0;
        if valid {
            return Ok(());
        }
        Err(crate::diagnostic::SnapbackError::error(
            "SNAPBACK_TELEMETRY_CONFIG_INVALID",
            "telemetry",
            "telemetry configuration is outside the local resource-safety envelope",
        ))
    }
}

/// Bounded caller attribution for an externally exposed invocation.
///
/// This is an observability dimension only. It deliberately rides the
/// loss-tolerant telemetry projection and is never a bill-grade usage fact.
/// Declared callers supply only the digest already projected by their bounded
/// admin ledger; the raw declaration (which contains an e-mail address) never
/// enters this carrier.
///
/// @ref LLP 0204#d7--integration-records-admission-and-metering — external
///   usage is visible per declared caller/integration in the owner console.
/// @ref LLP 0104#2026-08-02-implementation-cross-reference-one-class-seam-separate-sinks —
///   telemetry attribution may shed and cannot prove or supply billable usage.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CallerAttributionV1 {
    lane: &'static str,
    caller_key: String,
    approver_key: Option<String>,
}

impl CallerAttributionV1 {
    pub fn anonymous() -> Self {
        Self {
            lane: "anonymous",
            caller_key: "anonymous".to_owned(),
            approver_key: None,
        }
    }

    pub fn declared(caller_key: String) -> Self {
        Self {
            lane: "declared",
            caller_key,
            approver_key: None,
        }
    }

    pub fn integration(caller_key: String) -> Self {
        Self {
            lane: "integration",
            caller_key,
            approver_key: None,
        }
    }

    pub fn link(caller_key: String) -> Self {
        Self {
            lane: "link",
            caller_key,
            approver_key: None,
        }
    }

    /// Durable watches attribute every standing query and reaction to the
    /// owning principal, never to the scheduler wrapper.
    ///
    /// @ref LLP 0204#d93--durable-watches-end-user-automations — firing telemetry uses the
    /// existing owner/caller attribution lane.
    pub fn owner(caller_key: String) -> Self {
        Self {
            lane: "owner",
            caller_key,
            approver_key: None,
        }
    }

    pub fn first_party() -> Self {
        Self {
            lane: "first-party",
            caller_key: String::new(),
            approver_key: None,
        }
    }

    pub fn from_effect(lane: &str, caller_key: String) -> Self {
        match lane {
            "declared" => Self::declared(caller_key),
            "integration" => Self::integration(caller_key),
            "link" => Self::link(caller_key),
            "anonymous" => Self::anonymous(),
            _ => Self::first_party(),
        }
    }

    pub fn with_approver(mut self, approver_key: String) -> Self {
        self.approver_key = Some(approver_key);
        self
    }

    pub fn details(&self) -> Value {
        let mut details = serde_json::json!({
            "callerLane": self.lane,
            "callerKey": self.caller_key,
        });
        if let Some(approver) = &self.approver_key {
            details["approverKey"] = Value::String(approver.clone());
        }
        details
    }
}

pub const OPERATION_CLASS_REGISTRY_VERSION: u32 = 3;
/// The artifact-format family remains v1; registryVersion carries compatible
/// additive vocabulary revisions within that family.
pub const OPERATION_CLASS_REGISTRY_FILE: &str = "operation-class.v1.json";
pub const PROJECTION_FIXTURE_CORPUS_FILE: &str = "telemetry.projection-fixtures-v1.json";
pub const USAGE_EVENT_SCHEMA_VERSION: &str = "snapback.usage-event.v1";

/// Closed, typed admission key. Its inner spelling is private so production
/// seams cannot stamp the current registry version onto an unregistered or
/// misspelled class.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OperationClassIdV1(&'static str);

impl OperationClassIdV1 {
    pub const FUNCTION_QUERY: Self = Self("function.query");
    pub const FUNCTION_MUTATION: Self = Self("function.mutation");
    pub const FUNCTION_ACTION: Self = Self("function.action");
    pub const FUNCTION_HTTP: Self = Self("function.http");
    pub const HTTP_CARRIER: Self = Self("transport.http-carrier");
    pub const HTTP_STANDALONE: Self = Self("transport.http-standalone");
    pub const LIVE_SUBSCRIBE: Self = Self("live.subscribe");
    pub const LIVE_RESUBSCRIBE: Self = Self("live.resubscribe");
    pub const STREAM_CONNECT: Self = Self("stream.connect");
    pub const JOB_SCHEDULER: Self = Self("job.scheduler");
    pub const REALTIME_DELIVERED: Self = Self("realtime.delivered");
    pub const LIFECYCLE: Self = Self("lifecycle");
    pub const LOG: Self = Self("log");
    pub const DIAGNOSTIC: Self = Self("diagnostic");
    pub const RUNTIME_ELEVATED_READ: Self = Self("runtime.elevated-read");
    pub const INTERNAL_HEALTH: Self = Self("internal.health");
    pub const SYSTEM_CONTROL_API: Self = Self("system.control-api");
    pub const SYSTEM_STATIC_ASSET: Self = Self("system.static-asset");
    pub const SYSTEM_UNMATCHED: Self = Self("system.unmatched");

    pub fn as_str(self) -> &'static str {
        self.0
    }
}

/// Registry-owned admission header created once at the producer seam. The
/// telemetry side consumes `telemetry_kind`; a reliable metering adapter can
/// consume `operation_class` from this same header when that transport lands.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdmittedObservationClassV1 {
    pub observation_id: String,
    pub registry_version: u32,
    pub operation_class: &'static str,
    pub telemetry_kind: String,
    pub telemetry_projection: TelemetryProjectionModeV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TelemetryProjectionModeV1 {
    JoinedTerminal,
    AdmissionTerminal,
    Point,
    CounterOnly,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UsageDispositionV1 {
    Application,
    System,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ObservationStageV1 {
    Admission,
    Terminal,
    Point,
    Counter,
}

impl ObservationStageV1 {
    fn telemetry_phase(self, joined: bool) -> &'static str {
        match (self, joined) {
            (Self::Terminal, true) => "joined",
            (Self::Admission, _) => "admission",
            (Self::Terminal, _) => "terminal",
            (Self::Point, _) => "point",
            (Self::Counter, _) => "counter",
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Admission => "admission",
            Self::Terminal => "terminal",
            Self::Point => "point",
            Self::Counter => "counter",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeterRuleV1 {
    pub metric_id: String,
    pub stage: ObservationStageV1,
    pub unit: String,
    pub derivation: MeterDerivationV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MeterDerivationV1 {
    /// One accepted operation deterministically yields quantity one. Callers
    /// cannot omit or override this customer-facing request fact.
    AcceptedOperation,
    /// Quantity is measured by the owning runtime seam (CPU, transfer, frame
    /// delivery) and is absent when that measurement did not occur.
    Measured,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationClassRuleV1 {
    pub id: String,
    pub telemetry_kind: String,
    pub telemetry_projection: TelemetryProjectionModeV1,
    pub usage_disposition: UsageDispositionV1,
    pub relationship: String,
    pub metering: Vec<MeterRuleV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationClassRegistryV1 {
    pub artifact_version: u32,
    pub registry_version: u32,
    pub usage_event_schema_version: String,
    /// Per-failure classifier vocabulary added by registry v2. Classification
    /// remains an emission-time operation, not a static class-table column.
    pub failure_classifier: crate::error_tracking::FailureClassifierRegistryV1,
    pub classes: Vec<OperationClassRuleV1>,
}

fn meter(
    metric_id: &str,
    stage: ObservationStageV1,
    unit: &str,
    derivation: MeterDerivationV1,
) -> MeterRuleV1 {
    MeterRuleV1 {
        metric_id: metric_id.to_owned(),
        stage,
        unit: unit.to_owned(),
        derivation,
    }
}

fn class(
    id: &str,
    telemetry_kind: &str,
    telemetry_projection: TelemetryProjectionModeV1,
    usage_disposition: UsageDispositionV1,
    relationship: &str,
    metering: Vec<MeterRuleV1>,
) -> OperationClassRuleV1 {
    OperationClassRuleV1 {
        id: id.to_owned(),
        telemetry_kind: telemetry_kind.to_owned(),
        telemetry_projection,
        usage_disposition,
        relationship: relationship.to_owned(),
        metering,
    }
}

/// The full classification table ratified against LLP 0104. Fine-grained
/// class ids preserve the accepted-operation distinction while the
/// `telemetry_kind` column maps them onto LLP 0154's intentionally small raw
/// vocabulary. Registry v2 adds the LLP 0156 failure-classifier vocabulary;
/// registry v3 adds the fact-only elevated-read counter seam.
pub fn operation_class_registry() -> OperationClassRegistryV1 {
    use MeterDerivationV1::{AcceptedOperation, Measured};
    use ObservationStageV1::{Admission, Counter, Terminal};
    use TelemetryProjectionModeV1::{AdmissionTerminal, CounterOnly, JoinedTerminal, Point};
    use UsageDispositionV1::{Application, System};

    let logical_meters = || {
        vec![
            meter("backend_requests", Admission, "request", AcceptedOperation),
            meter("cpu_ms", Terminal, "cpu-ms", Measured),
            meter("data_transfer_bytes", Terminal, "byte", Measured),
        ]
    };
    let backend_request = || {
        vec![meter(
            "backend_requests",
            Admission,
            "request",
            AcceptedOperation,
        )]
    };
    let system = |id: &str, kind: &str, projection| {
        class(id, kind, projection, System, "system", Vec::new())
    };

    OperationClassRegistryV1 {
        artifact_version: 1,
        registry_version: OPERATION_CLASS_REGISTRY_VERSION,
        usage_event_schema_version: USAGE_EVENT_SCHEMA_VERSION.to_owned(),
        failure_classifier: crate::error_tracking::failure_classifier_registry(),
        classes: vec![
            class(
                "function.query",
                "function_run",
                JoinedTerminal,
                Application,
                "logical",
                logical_meters(),
            ),
            class(
                "function.mutation",
                "function_run",
                JoinedTerminal,
                Application,
                "logical",
                logical_meters(),
            ),
            class(
                "function.action",
                "function_run",
                JoinedTerminal,
                Application,
                "logical",
                logical_meters(),
            ),
            class(
                "function.http",
                "function_run",
                JoinedTerminal,
                Application,
                "logical",
                logical_meters(),
            ),
            class(
                "transport.http-carrier",
                "http_request",
                JoinedTerminal,
                Application,
                "carrier",
                Vec::new(),
            ),
            class(
                "transport.http-standalone",
                "http_request",
                JoinedTerminal,
                Application,
                "standalone",
                backend_request(),
            ),
            class(
                "live.subscribe",
                "live_subscribe",
                AdmissionTerminal,
                Application,
                "logical",
                backend_request(),
            ),
            class(
                "live.resubscribe",
                "live_subscribe",
                AdmissionTerminal,
                Application,
                "logical",
                backend_request(),
            ),
            class(
                "stream.connect",
                "ws_connect",
                AdmissionTerminal,
                Application,
                "carrier",
                Vec::new(),
            ),
            class(
                "job.scheduler",
                "job_run",
                JoinedTerminal,
                Application,
                "scheduler",
                Vec::new(),
            ),
            class(
                "realtime.delivered",
                "realtime_message",
                CounterOnly,
                Application,
                "logical",
                vec![meter(
                    "realtime_messages",
                    Counter,
                    "delivered-message",
                    Measured,
                )],
            ),
            system("lifecycle", "lifecycle", Point),
            system("log", "log", Point),
            system("diagnostic", "diagnostic", Point),
            system("runtime.elevated-read", "elevated_read", Point),
            class(
                "platform.export",
                "http_request",
                JoinedTerminal,
                Application,
                "standalone",
                backend_request(),
            ),
            class(
                "platform.restore",
                "http_request",
                JoinedTerminal,
                Application,
                "standalone",
                backend_request(),
            ),
            system("platform.app-create", "http_request", JoinedTerminal),
            system(
                "platform.environment-create",
                "http_request",
                JoinedTerminal,
            ),
            system("platform.code-activate", "http_request", JoinedTerminal),
            system(
                "platform.environment-inspect",
                "http_request",
                JoinedTerminal,
            ),
            system("platform.suspend", "http_request", JoinedTerminal),
            system("platform.delete", "http_request", JoinedTerminal),
            system("platform.transfer", "http_request", JoinedTerminal),
            system(
                "platform.preview-ttl-governance",
                "http_request",
                JoinedTerminal,
            ),
            system("platform.code-push", "http_request", JoinedTerminal),
            system("platform.schema-push", "http_request", JoinedTerminal),
            system("platform.permissions-push", "http_request", JoinedTerminal),
            system("platform.capabilities-read", "http_request", JoinedTerminal),
            system("platform.schema-lockdown", "http_request", JoinedTerminal),
            system("internal.repair", "lifecycle", Point),
            system("internal.health", "http_request", JoinedTerminal),
            system("internal.quota-notice", "diagnostic", Point),
            system("system.console-poll", "http_request", JoinedTerminal),
            system("system.control-api", "http_request", JoinedTerminal),
            system("system.telemetry", "http_request", JoinedTerminal),
            system("system.static-asset", "http_request", JoinedTerminal),
            system("system.unmatched", "http_request", JoinedTerminal),
            system("system.maintenance", "lifecycle", Point),
        ],
    }
}

pub fn operation_class_registry_artifact() -> Value {
    serde_json::to_value(operation_class_registry()).expect("operation-class registry serializes")
}

fn lookup_class(version: u32, id: &str) -> SnapbackResult<OperationClassRuleV1> {
    if version != OPERATION_CLASS_REGISTRY_VERSION {
        return Err(SnapbackError::error(
            "SNAPBACK_OPERATION_CLASS_REGISTRY_UNSUPPORTED",
            "telemetry",
            format!("operation-class registry version {version} is unsupported"),
        ));
    }
    operation_class_registry()
        .classes
        .into_iter()
        .find(|candidate| candidate.id == id)
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_OPERATION_CLASS_UNKNOWN",
                "telemetry",
                format!("operation class {id:?} is not in registry v{version}"),
            )
        })
}

pub fn admit_operation_class(
    class_id: OperationClassIdV1,
    observation_id: String,
) -> SnapbackResult<AdmittedObservationClassV1> {
    let class = lookup_class(OPERATION_CLASS_REGISTRY_VERSION, class_id.as_str())?;
    Ok(AdmittedObservationClassV1 {
        observation_id,
        registry_version: OPERATION_CLASS_REGISTRY_VERSION,
        operation_class: class_id.as_str(),
        telemetry_kind: class.telemetry_kind,
        telemetry_projection: class.telemetry_projection,
    })
}

pub fn telemetry_projection_for_class(
    class_id: OperationClassIdV1,
) -> SnapbackResult<TelemetryProjectionModeV1> {
    Ok(lookup_class(OPERATION_CLASS_REGISTRY_VERSION, class_id.as_str())?.telemetry_projection)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OwnershipIntervalV1 {
    pub id: String,
    pub expo_account_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservationStageRecordV1 {
    pub stage: ObservationStageV1,
    pub recorded_at_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeterFactV1 {
    pub metric_id: String,
    pub stage: ObservationStageV1,
    pub quantity: i64,
    pub unit: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharedObservationEnvelopeV1 {
    pub observation_id: String,
    pub registry_version: u32,
    pub operation_class: String,
    pub generation: String,
    pub app_id: String,
    pub environment: String,
    pub release: Option<String>,
    pub occurred_at_ms: i64,
    pub correlation_id: Option<String>,
    pub ownership_interval: OwnershipIntervalV1,
    pub stages: Vec<ObservationStageRecordV1>,
    pub meter_facts: Vec<MeterFactV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryProjectionRecordV1 {
    pub observation_id: String,
    pub registry_version: u32,
    pub generation: String,
    pub ts_ms: i64,
    pub recorded_ts_ms: i64,
    pub phase: String,
    pub kind: String,
    pub correlation: Option<String>,
    pub release: Option<String>,
    // Composed from row + telemetry_meta at egress, never event-supplied.
    pub app_id: String,
    pub environment: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryCounterProjectionV1 {
    pub observation_id: String,
    pub registry_version: u32,
    pub generation: String,
    pub recorded_ts_ms: i64,
    pub kind: String,
    pub metric_id: String,
    pub quantity: i64,
    pub unit: String,
    pub app_id: String,
    pub environment: String,
    pub release: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UsageEventProjectionV1 {
    pub event_id: String,
    pub schema_version: String,
    pub registry_version: u32,
    pub operation_class: String,
    pub stage: ObservationStageV1,
    pub occurred_at_ms: i64,
    pub observed_at_ms: i64,
    pub expo_app_id: String,
    pub snapback_environment_id: String,
    pub ownership_interval: OwnershipIntervalV1,
    pub release_id: Option<String>,
    pub request_or_job_id: Option<String>,
    pub metric_id: String,
    pub quantity: i64,
    pub unit: String,
    pub source: String,
}

fn stage_recorded_at(
    observation: &SharedObservationEnvelopeV1,
    stage: ObservationStageV1,
) -> SnapbackResult<i64> {
    observation
        .stages
        .iter()
        .find(|record| record.stage == stage)
        .map(|record| record.recorded_at_ms)
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_OBSERVATION_STAGE_MISSING",
                "telemetry",
                format!(
                    "observation {} has no {} stage",
                    observation.observation_id,
                    stage.as_str()
                ),
            )
        })
}

fn validate_stage_records(observation: &SharedObservationEnvelopeV1) -> SnapbackResult<()> {
    let mut stages = BTreeSet::new();
    for record in &observation.stages {
        if !stages.insert(record.stage) {
            return Err(SnapbackError::error(
                "SNAPBACK_OBSERVATION_STAGE_DUPLICATE",
                "telemetry",
                format!(
                    "observation {} repeats its {} stage",
                    observation.observation_id,
                    record.stage.as_str()
                ),
            ));
        }
    }
    Ok(())
}

fn validated_meter_quantities(
    observation: &SharedObservationEnvelopeV1,
    class: &OperationClassRuleV1,
) -> SnapbackResult<Vec<(MeterRuleV1, i64)>> {
    validate_stage_records(observation)?;
    let mut supplied = BTreeMap::new();
    for fact in &observation.meter_facts {
        let key = (fact.metric_id.as_str(), fact.stage);
        if supplied.insert(key, fact).is_some() {
            return Err(SnapbackError::error(
                "SNAPBACK_OPERATION_CLASS_METER_DUPLICATE",
                "telemetry",
                format!(
                    "observation {} repeats metric {} at {}",
                    observation.observation_id,
                    fact.metric_id,
                    fact.stage.as_str()
                ),
            ));
        }
    }
    let allowed = class
        .metering
        .iter()
        .map(|rule| ((rule.metric_id.as_str(), rule.stage), rule))
        .collect::<BTreeMap<_, _>>();
    for (key, fact) in &supplied {
        let Some(rule) = allowed.get(key) else {
            return Err(SnapbackError::error(
                "SNAPBACK_OPERATION_CLASS_METER_NOT_ALLOWED",
                "telemetry",
                format!(
                    "metric {} at {} is not allowed for operation class {}",
                    fact.metric_id,
                    fact.stage.as_str(),
                    class.id
                ),
            ));
        };
        if rule.derivation == MeterDerivationV1::AcceptedOperation {
            return Err(SnapbackError::error(
                "SNAPBACK_OPERATION_CLASS_DERIVED_METER_SUPPLIED",
                "telemetry",
                format!(
                    "metric {} is derived from accepted operation class {}",
                    fact.metric_id, class.id
                ),
            ));
        }
        if rule.unit != fact.unit {
            return Err(SnapbackError::error(
                "SNAPBACK_OPERATION_CLASS_METER_UNIT_INVALID",
                "telemetry",
                format!(
                    "metric {} requires unit {}, not {}",
                    fact.metric_id, rule.unit, fact.unit
                ),
            ));
        }
        if fact.quantity < 0 {
            return Err(SnapbackError::error(
                "SNAPBACK_OPERATION_CLASS_METER_QUANTITY_INVALID",
                "telemetry",
                format!("metric {} has a negative quantity", fact.metric_id),
            ));
        }
    }
    let mut quantities = Vec::new();
    for rule in &class.metering {
        let quantity = match rule.derivation {
            MeterDerivationV1::AcceptedOperation => Some(1),
            MeterDerivationV1::Measured => supplied
                .get(&(rule.metric_id.as_str(), rule.stage))
                .map(|fact| fact.quantity),
        };
        if let Some(quantity) = quantity {
            stage_recorded_at(observation, rule.stage)?;
            quantities.push((rule.clone(), quantity));
        }
    }
    Ok(quantities)
}

/// Lossy-side projection. The returned records are inputs to the existing
/// OBS-01 buffer, not a replacement ingestion path.
pub fn project_telemetry(
    observation: &SharedObservationEnvelopeV1,
) -> SnapbackResult<(
    Vec<TelemetryProjectionRecordV1>,
    Vec<TelemetryCounterProjectionV1>,
)> {
    let class = lookup_class(observation.registry_version, &observation.operation_class)?;
    let meter_quantities = validated_meter_quantities(observation, &class)?;
    let row = |stage: ObservationStageV1, joined: bool| -> SnapbackResult<_> {
        Ok(TelemetryProjectionRecordV1 {
            observation_id: observation.observation_id.clone(),
            registry_version: observation.registry_version,
            generation: observation.generation.clone(),
            ts_ms: observation.occurred_at_ms,
            recorded_ts_ms: stage_recorded_at(observation, stage)?,
            phase: stage.telemetry_phase(joined).to_owned(),
            kind: class.telemetry_kind.clone(),
            correlation: observation.correlation_id.clone(),
            release: observation.release.clone(),
            app_id: observation.app_id.clone(),
            environment: observation.environment.clone(),
        })
    };
    let rows = match class.telemetry_projection {
        TelemetryProjectionModeV1::JoinedTerminal => {
            vec![row(ObservationStageV1::Terminal, true)?]
        }
        TelemetryProjectionModeV1::AdmissionTerminal => vec![
            row(ObservationStageV1::Admission, false)?,
            row(ObservationStageV1::Terminal, false)?,
        ],
        TelemetryProjectionModeV1::Point => vec![row(ObservationStageV1::Point, false)?],
        TelemetryProjectionModeV1::CounterOnly => Vec::new(),
    };
    let counters = if class.telemetry_projection == TelemetryProjectionModeV1::CounterOnly {
        meter_quantities
            .iter()
            .map(|(rule, quantity)| {
                Ok(TelemetryCounterProjectionV1 {
                    observation_id: observation.observation_id.clone(),
                    registry_version: observation.registry_version,
                    generation: observation.generation.clone(),
                    recorded_ts_ms: stage_recorded_at(observation, rule.stage)?,
                    kind: class.telemetry_kind.clone(),
                    metric_id: rule.metric_id.clone(),
                    quantity: *quantity,
                    unit: rule.unit.clone(),
                    app_id: observation.app_id.clone(),
                    environment: observation.environment.clone(),
                    release: observation.release.clone(),
                })
            })
            .collect::<SnapbackResult<Vec<_>>>()?
    } else {
        Vec::new()
    };
    Ok((rows, counters))
}

fn event_id(
    observation_id: &str,
    metric_id: &str,
    stage: ObservationStageV1,
    schema_version: &str,
) -> String {
    // Length framing keeps the normative tuple unambiguous. The domain label
    // prevents these ids from colliding with any other SHA-256 transcript.
    let mut hash = Sha256::new();
    hash.update(b"snapback:usage-event-id:v1");
    for field in [observation_id, metric_id, stage.as_str(), schema_version] {
        hash.update((field.len() as u64).to_be_bytes());
        hash.update(field.as_bytes());
    }
    format!("sha256:{:x}", hash.finalize())
}

/// Reliable-side projection. Callers may retry this pure function freely;
/// deterministic per-metric ids make an at-least-once sink idempotent.
pub fn project_metering(
    observation: &SharedObservationEnvelopeV1,
) -> SnapbackResult<Vec<UsageEventProjectionV1>> {
    let class = lookup_class(observation.registry_version, &observation.operation_class)?;
    let quantities = validated_meter_quantities(observation, &class)?;
    let mut events = Vec::with_capacity(quantities.len());
    for (rule, quantity) in quantities {
        events.push(UsageEventProjectionV1 {
            event_id: event_id(
                &observation.observation_id,
                &rule.metric_id,
                rule.stage,
                USAGE_EVENT_SCHEMA_VERSION,
            ),
            schema_version: USAGE_EVENT_SCHEMA_VERSION.to_owned(),
            registry_version: observation.registry_version,
            operation_class: observation.operation_class.clone(),
            stage: rule.stage,
            occurred_at_ms: observation.occurred_at_ms,
            observed_at_ms: stage_recorded_at(observation, rule.stage)?,
            expo_app_id: observation.app_id.clone(),
            snapback_environment_id: observation.environment.clone(),
            ownership_interval: observation.ownership_interval.clone(),
            release_id: observation.release.clone(),
            request_or_job_id: observation.correlation_id.clone(),
            metric_id: rule.metric_id,
            quantity,
            unit: rule.unit,
            source: "snapback-observation-span".to_owned(),
        });
    }
    Ok(events)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectionFixtureCaseV1 {
    pub name: String,
    pub delivery_attempts: u32,
    pub observations: Vec<SharedObservationEnvelopeV1>,
    pub expected_telemetry: Vec<TelemetryProjectionRecordV1>,
    pub expected_telemetry_counters: Vec<TelemetryCounterProjectionV1>,
    pub expected_metering: Vec<UsageEventProjectionV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectionRejectionFixtureV1 {
    pub name: String,
    pub observation: SharedObservationEnvelopeV1,
    pub expected_code: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoundaryProtocolFixtureV1 {
    pub name: String,
    pub invariant: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectionFixtureCorpusV1 {
    pub artifact_version: u32,
    pub registry_version: u32,
    pub cases: Vec<ProjectionFixtureCaseV1>,
    pub rejections: Vec<ProjectionRejectionFixtureV1>,
    pub boundary_protocol: Vec<BoundaryProtocolFixtureV1>,
}

fn stage(stage: ObservationStageV1, recorded_at_ms: i64) -> ObservationStageRecordV1 {
    ObservationStageRecordV1 {
        stage,
        recorded_at_ms,
    }
}

fn fact(metric_id: &str, stage: ObservationStageV1, quantity: i64, unit: &str) -> MeterFactV1 {
    MeterFactV1 {
        metric_id: metric_id.to_owned(),
        stage,
        quantity,
        unit: unit.to_owned(),
    }
}

fn fixture_observation(
    suffix: &str,
    operation_class: &str,
    stages: Vec<ObservationStageRecordV1>,
    meter_facts: Vec<MeterFactV1>,
    correlation_id: &str,
) -> SharedObservationEnvelopeV1 {
    SharedObservationEnvelopeV1 {
        observation_id: format!("obs_{suffix:0<26}"),
        registry_version: OPERATION_CLASS_REGISTRY_VERSION,
        operation_class: operation_class.to_owned(),
        generation: "gen_01j00000000000000000000000".to_owned(),
        app_id: "app-fixture".to_owned(),
        environment: "environment-fixture".to_owned(),
        release: Some("release-fixture".to_owned()),
        occurred_at_ms: 1_000,
        correlation_id: Some(correlation_id.to_owned()),
        ownership_interval: OwnershipIntervalV1 {
            id: "ownership-interval-fixture".to_owned(),
            expo_account_id: "account-fixture".to_owned(),
        },
        stages,
        meter_facts,
    }
}

fn fixture_case(
    name: &str,
    delivery_attempts: u32,
    observations: Vec<SharedObservationEnvelopeV1>,
) -> ProjectionFixtureCaseV1 {
    let mut expected_telemetry = Vec::new();
    let mut expected_telemetry_counters = Vec::new();
    let mut metering_by_id = BTreeMap::new();
    for observation in &observations {
        let (rows, counters) = project_telemetry(observation).expect("fixture telemetry projects");
        expected_telemetry.extend(rows);
        expected_telemetry_counters.extend(counters);
        for _ in 0..delivery_attempts.max(1) {
            for event in project_metering(observation).expect("fixture metering projects") {
                metering_by_id.insert(event.event_id.clone(), event);
            }
        }
    }
    ProjectionFixtureCaseV1 {
        name: name.to_owned(),
        delivery_attempts,
        observations,
        expected_telemetry,
        expected_telemetry_counters,
        expected_metering: metering_by_id.into_values().collect(),
    }
}

/// Normative shared corpus. It is generated through both pure projections and
/// committed under `schemas/`, so drift in the matrix is review-visible.
pub fn projection_fixture_corpus() -> Value {
    use ObservationStageV1::{Admission, Counter, Point, Terminal};
    let terminal = || vec![stage(Admission, 1_010), stage(Terminal, 1_090)];
    let joined = || vec![stage(Admission, 1_010), stage(Terminal, 1_090)];
    let point = || vec![stage(Point, 1_020)];
    let mut cases = vec![
        fixture_case(
            "derived_multi_metric_event_ids",
            1,
            vec![fixture_observation(
                "multi_metric",
                "function.action",
                terminal(),
                vec![
                    fact("cpu_ms", Terminal, 41, "cpu-ms"),
                    fact("data_transfer_bytes", Terminal, 2_048, "byte"),
                ],
                "request-multi-metric",
            )],
        ),
        fixture_case(
            "no_job_action_double_count",
            1,
            vec![
                fixture_observation(
                    "job_scheduler",
                    "job.scheduler",
                    joined(),
                    Vec::new(),
                    "job-1",
                ),
                fixture_observation(
                    "job_action",
                    "function.action",
                    joined(),
                    Vec::new(),
                    "job-1",
                ),
            ],
        ),
        fixture_case(
            "no_carrier_logical_double_count",
            1,
            vec![
                fixture_observation(
                    "http_carrier",
                    "transport.http-carrier",
                    joined(),
                    Vec::new(),
                    "request-http",
                ),
                fixture_observation(
                    "http_function",
                    "function.http",
                    joined(),
                    Vec::new(),
                    "request-http",
                ),
            ],
        ),
        fixture_case(
            "per_class_record_timing_and_timestamp_semantics",
            1,
            vec![
                fixture_observation(
                    "query",
                    "function.query",
                    joined(),
                    Vec::new(),
                    "request-query",
                ),
                fixture_observation(
                    "http",
                    "transport.http-carrier",
                    joined(),
                    Vec::new(),
                    "request-carrier",
                ),
                fixture_observation(
                    "subscribe",
                    "live.subscribe",
                    terminal(),
                    Vec::new(),
                    "subscription-1",
                ),
                fixture_observation(
                    "socket",
                    "stream.connect",
                    terminal(),
                    Vec::new(),
                    "connection-1",
                ),
                fixture_observation("job", "job.scheduler", joined(), Vec::new(), "job-2"),
                fixture_observation("lifecycle", "lifecycle", point(), Vec::new(), "process-1"),
                fixture_observation("log", "log", point(), Vec::new(), "request-log"),
                fixture_observation(
                    "diagnostic",
                    "diagnostic",
                    point(),
                    Vec::new(),
                    "request-diagnostic",
                ),
                fixture_observation(
                    "realtime",
                    "realtime.delivered",
                    vec![stage(Counter, 1_080)],
                    vec![fact("realtime_messages", Counter, 3, "delivered-message")],
                    "connection-2",
                ),
            ],
        ),
        fixture_case(
            "retry_and_event_id_dedup",
            3,
            vec![fixture_observation(
                "retry",
                "function.mutation",
                joined(),
                Vec::new(),
                "request-retry",
            )],
        ),
        fixture_case(
            "compound_batch_counts_each_accepted_logical_operation",
            1,
            (0..3)
                .map(|index| {
                    fixture_observation(
                        &format!("batch_{index}"),
                        "function.query",
                        joined(),
                        Vec::new(),
                        "request-batch",
                    )
                })
                .collect(),
        ),
        fixture_case(
            "chargeable_platform_subset_only",
            1,
            ["export", "restore"]
                .into_iter()
                .map(|name| {
                    fixture_observation(
                        &format!("platform_{name}"),
                        &format!("platform.{name}"),
                        joined(),
                        Vec::new(),
                        "request-platform",
                    )
                })
                .collect(),
        ),
        fixture_case(
            "nonchargeable_platform_and_system_exclusions",
            1,
            [
                "platform.app-create",
                "platform.environment-create",
                "platform.code-activate",
                "platform.environment-inspect",
                "platform.suspend",
                "platform.delete",
                "platform.transfer",
                "platform.preview-ttl-governance",
                "platform.code-push",
                "platform.schema-push",
                "platform.permissions-push",
                "platform.capabilities-read",
                "platform.schema-lockdown",
                "internal.repair",
                "internal.health",
                "internal.quota-notice",
                "system.console-poll",
                "system.control-api",
                "system.telemetry",
                "system.static-asset",
                "system.unmatched",
                "system.maintenance",
            ]
            .into_iter()
            .enumerate()
            .map(|(index, class)| {
                let projection = lookup_class(OPERATION_CLASS_REGISTRY_VERSION, class)
                    .expect("fixture class")
                    .telemetry_projection;
                let stages = match projection {
                    TelemetryProjectionModeV1::JoinedTerminal => joined(),
                    TelemetryProjectionModeV1::AdmissionTerminal => terminal(),
                    TelemetryProjectionModeV1::Point => point(),
                    TelemetryProjectionModeV1::CounterOnly => vec![stage(Counter, 1_020)],
                };
                fixture_observation(
                    &format!("system_{index}"),
                    class,
                    stages,
                    Vec::new(),
                    "request-system",
                )
            })
            .collect(),
        ),
        fixture_case(
            "row_meta_identity_equals_c7_metering_envelope",
            1,
            vec![fixture_observation(
                "identity",
                "function.query",
                joined(),
                Vec::new(),
                "request-identity",
            )],
        ),
    ];
    cases.sort_by(|left, right| left.name.cmp(&right.name));

    let mut unsupported = fixture_observation(
        "unsupported",
        "function.query",
        joined(),
        Vec::new(),
        "request-version",
    );
    unsupported.registry_version = OPERATION_CLASS_REGISTRY_VERSION + 1;
    let unknown = fixture_observation(
        "unknown",
        "function.unknown",
        joined(),
        Vec::new(),
        "request-unknown",
    );

    let boundary_protocol = [
        (
            "max_days_7_to_1_to_7_without_sweep",
            "retention_floor prevents raw-row resurrection",
        ),
        (
            "max_days_n_to_0_to_n_without_sweep",
            "disable is a durable floor and re-enable exposes only later batches",
        ),
        (
            "clock_rollback_against_retention_floor",
            "new batch stamps remain strictly above the durable floor",
        ),
        (
            "clock_rollback_across_hour_finalization",
            "freshness and pagination order never regress into a finalized hour",
        ),
        (
            "hatch_server_boundary_parity",
            "both readers use telemetry_meta and the visibility views",
        ),
        (
            "mid_hour_maintenance_exactly_once_before_after_restart",
            "every counted-phase row appears in exactly one raw-or-rollup stats partition",
        ),
        (
            "reset_in_flight_generation_race",
            "predecessor rows may land but remain generation-hidden",
        ),
        (
            "raw_tail_stats_across_restart",
            "raw tail above the rollup watermark and durable rollups compose without duplication",
        ),
        (
            "late_completion_recorded_time_bucket",
            "a terminal row buckets by recorded completion time, not admission time",
        ),
        (
            "cap_exhaustion_rolls_before_shed",
            "whole raw intervals cross the rollup watermark before cap eviction",
        ),
        (
            "snapshot_bounded_export",
            "one captured generation, boundary, and max id bound the entire export",
        ),
    ]
    .into_iter()
    .map(|(name, invariant)| BoundaryProtocolFixtureV1 {
        name: name.to_owned(),
        invariant: invariant.to_owned(),
    })
    .collect();

    serde_json::to_value(ProjectionFixtureCorpusV1 {
        artifact_version: 1,
        registry_version: OPERATION_CLASS_REGISTRY_VERSION,
        cases,
        rejections: vec![
            ProjectionRejectionFixtureV1 {
                name: "unsupported_registry_version".to_owned(),
                observation: unsupported,
                expected_code: "SNAPBACK_OPERATION_CLASS_REGISTRY_UNSUPPORTED".to_owned(),
            },
            ProjectionRejectionFixtureV1 {
                name: "unknown_operation_class".to_owned(),
                observation: unknown,
                expected_code: "SNAPBACK_OPERATION_CLASS_UNKNOWN".to_owned(),
            },
        ],
        boundary_protocol,
    })
    .expect("projection fixture corpus serializes")
}

pub fn projection_fixture_corpus_typed() -> ProjectionFixtureCorpusV1 {
    serde_json::from_value(projection_fixture_corpus()).expect("generated fixture corpus parses")
}

/// Re-project and validate a generated case as a consumer would. Metering
/// delivery attempts are deduplicated by event id; telemetry is projected once
/// from the shared span because transport retries are not new observations.
pub fn validate_projection_fixture_case(case: &ProjectionFixtureCaseV1) -> SnapbackResult<()> {
    let mut telemetry = Vec::new();
    let mut counters = Vec::new();
    let mut metering = BTreeMap::new();
    for observation in &case.observations {
        let (rows, projected_counters) = project_telemetry(observation)?;
        telemetry.extend(rows);
        counters.extend(projected_counters);
        for _ in 0..case.delivery_attempts.max(1) {
            for event in project_metering(observation)? {
                metering.insert(event.event_id.clone(), event);
            }
        }
    }
    let metering = metering.into_values().collect::<Vec<_>>();
    if telemetry != case.expected_telemetry
        || counters != case.expected_telemetry_counters
        || metering != case.expected_metering
    {
        return Err(SnapbackError::error(
            "SNAPBACK_OPERATION_CLASS_FIXTURE_MISMATCH",
            "telemetry",
            format!(
                "projection fixture {} does not match its expected outputs",
                case.name
            ),
        ));
    }
    let ids = metering
        .iter()
        .map(|event| event.event_id.as_str())
        .collect::<BTreeSet<_>>();
    if ids.len() != metering.len() {
        return Err(SnapbackError::error(
            "SNAPBACK_OPERATION_CLASS_FIXTURE_DUPLICATE",
            "telemetry",
            format!(
                "projection fixture {} emitted duplicate event ids",
                case.name
            ),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_ids_and_rules_are_unique_and_closed() {
        let registry = operation_class_registry();
        assert_eq!(registry.registry_version, OPERATION_CLASS_REGISTRY_VERSION);
        assert_eq!(OPERATION_CLASS_REGISTRY_FILE, "operation-class.v1.json");
        assert_eq!(
            registry.failure_classifier,
            crate::error_tracking::failure_classifier_registry()
        );
        let ids = registry
            .classes
            .iter()
            .map(|class| class.id.as_str())
            .collect::<BTreeSet<_>>();
        assert_eq!(ids.len(), registry.classes.len());
        for class in &registry.classes {
            let meters = class
                .metering
                .iter()
                .map(|meter| (meter.metric_id.as_str(), meter.stage))
                .collect::<BTreeSet<_>>();
            assert_eq!(meters.len(), class.metering.len(), "{}", class.id);
            if class.usage_disposition == UsageDispositionV1::System {
                assert!(class.metering.is_empty(), "{}", class.id);
            }
        }
        assert_eq!(
            ids,
            [
                "diagnostic",
                "function.action",
                "function.http",
                "function.mutation",
                "function.query",
                "internal.health",
                "internal.quota-notice",
                "internal.repair",
                "job.scheduler",
                "lifecycle",
                "live.resubscribe",
                "live.subscribe",
                "log",
                "platform.app-create",
                "platform.capabilities-read",
                "platform.code-activate",
                "platform.code-push",
                "platform.delete",
                "platform.environment-create",
                "platform.environment-inspect",
                "platform.export",
                "platform.permissions-push",
                "platform.preview-ttl-governance",
                "platform.restore",
                "platform.schema-lockdown",
                "platform.schema-push",
                "platform.suspend",
                "platform.transfer",
                "realtime.delivered",
                "runtime.elevated-read",
                "stream.connect",
                "system.console-poll",
                "system.control-api",
                "system.maintenance",
                "system.static-asset",
                "system.telemetry",
                "system.unmatched",
                "transport.http-carrier",
                "transport.http-standalone",
            ]
            .into_iter()
            .collect(),
            "the v1 class vocabulary is a review-visible closed table"
        );
    }

    #[test]
    fn shared_projection_corpus_reprojects_and_deduplicates() {
        let corpus = projection_fixture_corpus_typed();
        for case in &corpus.cases {
            validate_projection_fixture_case(case).unwrap();
        }
    }

    #[test]
    fn derived_ids_are_per_metric_stage_and_stable_across_retries() {
        let corpus = projection_fixture_corpus_typed();
        let case = corpus
            .cases
            .iter()
            .find(|case| case.name == "derived_multi_metric_event_ids")
            .unwrap();
        assert_eq!(case.expected_metering.len(), 3);
        assert_eq!(
            case.expected_metering
                .iter()
                .map(|event| &event.event_id)
                .collect::<BTreeSet<_>>()
                .len(),
            3
        );
        let retry = corpus
            .cases
            .iter()
            .find(|case| case.name == "retry_and_event_id_dedup")
            .unwrap();
        assert_eq!(retry.delivery_attempts, 3);
        assert_eq!(retry.expected_metering.len(), 1);
        assert_eq!(retry.expected_metering[0].quantity, 1);
        assert_eq!(
            retry.expected_metering[0].stage,
            ObservationStageV1::Admission
        );
    }

    #[test]
    fn accepted_operation_request_is_mandatory_not_caller_supplied() {
        let corpus = projection_fixture_corpus_typed();
        let case = corpus
            .cases
            .iter()
            .find(|case| case.name == "retry_and_event_id_dedup")
            .unwrap();
        assert!(case.observations[0].meter_facts.is_empty());
        assert_eq!(project_metering(&case.observations[0]).unwrap().len(), 1);

        let mut spoofed = case.observations[0].clone();
        spoofed.meter_facts.push(fact(
            "backend_requests",
            ObservationStageV1::Admission,
            99,
            "request",
        ));
        for result in [
            project_metering(&spoofed).map(|_| ()),
            project_telemetry(&spoofed).map(|_| ()),
        ] {
            assert_eq!(
                result.unwrap_err().diagnostic.code,
                "SNAPBACK_OPERATION_CLASS_DERIVED_METER_SUPPLIED"
            );
        }
    }

    #[test]
    fn duplicate_stages_and_meter_facts_fail_before_either_projection() {
        let corpus = projection_fixture_corpus_typed();
        let base = corpus
            .cases
            .iter()
            .find(|case| case.name == "derived_multi_metric_event_ids")
            .unwrap()
            .observations[0]
            .clone();
        let mut duplicate_stage = base.clone();
        duplicate_stage
            .stages
            .push(stage(ObservationStageV1::Terminal, 2_000));
        for result in [
            project_metering(&duplicate_stage).map(|_| ()),
            project_telemetry(&duplicate_stage).map(|_| ()),
        ] {
            assert_eq!(
                result.unwrap_err().diagnostic.code,
                "SNAPBACK_OBSERVATION_STAGE_DUPLICATE"
            );
        }

        let mut duplicate_fact = base;
        duplicate_fact
            .meter_facts
            .push(fact("cpu_ms", ObservationStageV1::Terminal, 42, "cpu-ms"));
        for result in [
            project_metering(&duplicate_fact).map(|_| ()),
            project_telemetry(&duplicate_fact).map(|_| ()),
        ] {
            assert_eq!(
                result.unwrap_err().diagnostic.code,
                "SNAPBACK_OPERATION_CLASS_METER_DUPLICATE"
            );
        }
    }

    #[test]
    fn carrier_and_scheduler_pairs_bill_one_logical_instance() {
        let corpus = projection_fixture_corpus_typed();
        for name in [
            "no_job_action_double_count",
            "no_carrier_logical_double_count",
        ] {
            let case = corpus.cases.iter().find(|case| case.name == name).unwrap();
            assert_eq!(
                case.expected_metering
                    .iter()
                    .filter(|event| event.metric_id == "backend_requests")
                    .map(|event| event.quantity)
                    .sum::<i64>(),
                1,
                "{name}"
            );
        }
    }

    #[test]
    fn exact_projection_timing_is_pinned_per_class() {
        let corpus = projection_fixture_corpus_typed();
        let case = corpus
            .cases
            .iter()
            .find(|case| case.name == "per_class_record_timing_and_timestamp_semantics")
            .unwrap();
        let rows_for = |observation: &str| {
            case.expected_telemetry
                .iter()
                .filter(|row| row.observation_id.contains(observation))
                .map(|row| (row.phase.as_str(), row.ts_ms, row.recorded_ts_ms))
                .collect::<Vec<_>>()
        };
        assert_eq!(rows_for("query"), vec![("joined", 1_000, 1_090)]);
        assert_eq!(
            rows_for("subscribe"),
            vec![("admission", 1_000, 1_010), ("terminal", 1_000, 1_090)]
        );
        assert_eq!(rows_for("lifecycle"), vec![("point", 1_000, 1_020)]);
        assert!(rows_for("realtime").is_empty());
        let realtime = &case.expected_telemetry_counters[0];
        assert_eq!(realtime.recorded_ts_ms, 1_080);
        assert_eq!(realtime.quantity, 3);

        for event in &case.expected_metering {
            assert_eq!(event.occurred_at_ms, 1_000);
            match event.stage {
                ObservationStageV1::Admission => assert_eq!(event.observed_at_ms, 1_010),
                ObservationStageV1::Counter => assert_eq!(event.observed_at_ms, 1_080),
                ObservationStageV1::Terminal => assert_eq!(event.observed_at_ms, 1_090),
                ObservationStageV1::Point => panic!("point classes are not metered"),
            }
        }
    }

    #[test]
    fn oq1_chargeable_subset_matches_llp_0104_exactly() {
        let corpus = projection_fixture_corpus_typed();
        let chargeable = corpus
            .cases
            .iter()
            .find(|case| case.name == "chargeable_platform_subset_only")
            .unwrap();
        assert_eq!(
            chargeable
                .expected_metering
                .iter()
                .map(|event| event.operation_class.as_str())
                .collect::<BTreeSet<_>>(),
            ["platform.export", "platform.restore"]
                .into_iter()
                .collect()
        );
        let exclusions = corpus
            .cases
            .iter()
            .find(|case| case.name == "nonchargeable_platform_and_system_exclusions")
            .unwrap();
        assert!(exclusions.expected_metering.is_empty());
    }

    #[test]
    fn composed_telemetry_identity_equals_c7_metering_identity() {
        let corpus = projection_fixture_corpus_typed();
        let case = corpus
            .cases
            .iter()
            .find(|case| case.name == "row_meta_identity_equals_c7_metering_envelope")
            .unwrap();
        let row = &case.expected_telemetry[0];
        let usage = &case.expected_metering[0];
        assert_eq!(row.app_id, usage.expo_app_id);
        assert_eq!(row.environment, usage.snapback_environment_id);
        assert_eq!(row.release, usage.release_id);
        assert_eq!(row.ts_ms, usage.occurred_at_ms);
    }

    #[test]
    fn registry_version_and_unknown_classes_fail_closed_in_both_projections() {
        let corpus = projection_fixture_corpus_typed();
        for fixture in &corpus.rejections {
            let telemetry = project_telemetry(&fixture.observation).unwrap_err();
            let metering = project_metering(&fixture.observation).unwrap_err();
            assert_eq!(telemetry.diagnostic.code, fixture.expected_code);
            assert_eq!(metering.diagnostic.code, fixture.expected_code);
        }
    }

    #[test]
    fn fixture_artifacts_round_trip_without_loss() {
        let registry: OperationClassRegistryV1 =
            serde_json::from_value(operation_class_registry_artifact()).unwrap();
        assert_eq!(
            serde_json::to_value(registry).unwrap(),
            operation_class_registry_artifact()
        );
        let corpus: ProjectionFixtureCorpusV1 =
            serde_json::from_value(projection_fixture_corpus()).unwrap();
        assert_eq!(
            serde_json::to_value(corpus).unwrap(),
            projection_fixture_corpus()
        );
    }
}
