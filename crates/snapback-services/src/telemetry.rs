//! Loss-tolerant local telemetry storage.
//!
//! The store is a sibling SQLite database, never an attachment or table in the
//! app database. Producers enqueue bounded records; one event-armed worker
//! flushes batches and performs rollup/retention maintenance on that sibling
//! connection only.
//!
//! @ref LLP 0154#d1--telemetry-store-a-sibling-sqlite-database-generation-bound —
//!   generation-bound sibling storage and visibility views are the durable
//!   read boundary.
//! @ref LLP 0154#d3--write-path-buffered-batched-priority-aware-event-driven —
//!   producers never touch SQLite and failures retain reserved capacity.
//! @ref LLP 0154#d4--maintenance-rides-the-flush-path-no-cron — retention and
//!   rollups are post-flush work, never a periodic app-database job.

use crate::diagnostic::{Diagnostic, DiagnosticSeverity, SnapbackError, SnapbackResult};
use crate::error_tracking::{
    AppRefusalTrackingV1, CarrierCategoryV1, EXISTING_ALLOWLIST_PRIORITY, FINGERPRINT_VERSION,
    FailureClassifierInputV1, FailureDetailsInputV1, FailureDispositionV1,
    FailureStampMaterializationV1, FingerprintBranchV1, FingerprintInputV1,
    MaterializedFailureStampV1, PrivateFailureContextV1, allocate_failure_details,
    classify_failure, fingerprint_v1, is_failure_detail_key, lower_hex,
    materialize_failure_stamp_v1, normalize_message_v1,
};
use crate::ids::{self, Kind as IdKind};
use crate::telemetry_contract::{
    AdmittedObservationClassV1, OperationClassIdV1, TelemetryProjectionModeV1,
    admit_operation_class, telemetry_projection_for_class,
};
pub use crate::telemetry_contract::{
    CallerAttributionV1, DEFAULT_BATCH_SIZE, DEFAULT_BUFFER_CAPACITY, DEFAULT_DAILY_DAYS,
    DEFAULT_FILE_SIZE_CAP_BYTES, DEFAULT_HOURLY_DAYS, DEFAULT_MAX_AGE_MS, DEFAULT_MAX_DAYS,
    DEFAULT_PRIORITY_RESERVE, DEFAULT_ROLLUP_ROW_CAP, DEFAULT_SWEEP_INTERVAL_MS,
    DEFAULT_TOP_NAMES_PER_HOUR, MAX_MAX_DAYS, TelemetryConfig,
};
use rusqlite::{Connection, OpenFlags, OptionalExtension, Transaction, params, params_from_iter};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DAY_MS: i64 = 86_400_000;
const HOUR_MS: i64 = 3_600_000;
const DETAILS_MAX_BYTES: usize = 8 * 1024;
const NAME_MAX_BYTES: usize = 3_000;
const CORRELATION_MAX_BYTES: usize = 512;
const CODE_MAX_BYTES: usize = 256;
const LARGE_SWEEP_ROWS: usize = 1_000;
const FILE_CAP_FIXED_RESERVE_BYTES: u64 = 128 * 1024;
const ERROR_GROUP_CAP: usize = 1_000;
const ERROR_EXEMPLAR_DEPTH: usize = 5;
const ERROR_EXEMPLAR_BYTES: usize = 32 * 1024;
const ERROR_TRANSITIONS_PER_GROUP: usize = 100;
const ERROR_TRANSITIONS_GLOBAL: usize = 10_000;
const RELEASE_ACTIVATION_CAP: usize = 2_000;

#[cfg(feature = "benchmark-support")]
#[path = "telemetry_benchmark_support.rs"]
pub mod benchmark_support;

/// Trusted identity of the app/environment that owns one telemetry sibling.
/// These values are never accepted from an event payload and are never
/// truncated: rows inherit them from `telemetry_meta` only when exported.
///
/// @ref LLP 0154#d1--telemetry-store-a-sibling-sqlite-database-generation-bound —
///   one store binding supplies app/environment identity for every row.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TelemetryStoreIdentity {
    app_id: String,
    environment_id: String,
}

impl TelemetryStoreIdentity {
    pub(crate) fn new(
        app_id: impl Into<String>,
        environment_id: impl Into<String>,
    ) -> SnapbackResult<Self> {
        let identity = Self {
            app_id: app_id.into(),
            environment_id: environment_id.into(),
        };
        if identity.app_id.trim().is_empty() || identity.environment_id.trim().is_empty() {
            return Err(SnapbackError::error(
                "SNAPBACK_TELEMETRY_IDENTITY_INVALID",
                "telemetry",
                "telemetry store identity requires non-empty app and environment values",
            ));
        }
        Ok(identity)
    }

    pub fn environment_id(&self) -> &str {
        &self.environment_id
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Priority {
    Normal,
    Reserved,
}

impl Priority {
    fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Reserved => "reserved",
        }
    }
}

/// Unpublished inter-crate seam for higher-layer attribution adapters.
/// The public Snapback façade keeps this trait crate-private, so the formerly
/// crate-private constructors do not become supported API accidentally.
pub trait CallerAttributionLocalExt: Sized {
    fn anonymous() -> Self;
    fn declared(caller_key: String) -> Self;
    fn integration(caller_key: String) -> Self;
    fn link(caller_key: String) -> Self;
    fn owner(caller_key: String) -> Self;
    fn first_party() -> Self;
    fn from_effect(lane: &str, caller_key: String) -> Self;
    fn with_approver(self, approver_key: String) -> Self;
    fn details(&self) -> Value;
}

impl CallerAttributionLocalExt for CallerAttributionV1 {
    fn anonymous() -> Self {
        Self::anonymous()
    }

    fn declared(caller_key: String) -> Self {
        Self::declared(caller_key)
    }

    fn integration(caller_key: String) -> Self {
        Self::integration(caller_key)
    }

    fn link(caller_key: String) -> Self {
        Self::link(caller_key)
    }

    fn owner(caller_key: String) -> Self {
        Self::owner(caller_key)
    }

    fn first_party() -> Self {
        Self::first_party()
    }

    fn from_effect(lane: &str, caller_key: String) -> Self {
        Self::from_effect(lane, caller_key)
    }

    fn with_approver(self, approver_key: String) -> Self {
        self.with_approver(approver_key)
    }

    fn details(&self) -> Value {
        self.details()
    }
}

/// Unpublished inter-crate constructor seam for the trusted store identity.
pub trait TelemetryStoreIdentityLocalExt: Sized {
    fn new(app_id: impl Into<String>, environment_id: impl Into<String>) -> SnapbackResult<Self>;
}

impl TelemetryStoreIdentityLocalExt for TelemetryStoreIdentity {
    fn new(app_id: impl Into<String>, environment_id: impl Into<String>) -> SnapbackResult<Self> {
        Self::new(app_id, environment_id)
    }
}

/// Unpublished inter-crate seam for the error-aware terminal observation.
pub trait ObservationSpanLocalExt {
    fn finish_error(self, status: Option<i64>, error: &mut SnapbackError, details: Option<Value>);
}

impl ObservationSpanLocalExt for ObservationSpan {
    fn finish_error(self, status: Option<i64>, error: &mut SnapbackError, details: Option<Value>) {
        self.finish_error(status, error, details);
    }
}

/// Unpublished inter-crate service seam for engine/server telemetry wiring.
pub trait TelemetryLocalExt: Sized {
    fn in_memory_with_identity(
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self>;
    fn open_for_database_with_identity(
        database_path: &Path,
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self>;
    fn start_classified_span(
        &self,
        class_id: OperationClassIdV1,
        name: &str,
        correlation: Option<&str>,
        details: Option<Value>,
    ) -> ObservationSpan;
    #[allow(clippy::too_many_arguments)]
    fn point_classified(
        &self,
        class_id: OperationClassIdV1,
        name: &str,
        status: Option<i64>,
        code: Option<&str>,
        correlation: Option<&str>,
        details: Option<Value>,
        priority: Priority,
    );
    fn set_release(&self, release: Option<&str>);
    fn record_process_ready(&self);
    fn elevated_read(&self, function: &str, member: &str, correlation: Option<&str>);
    fn standalone_diagnostic(&self, diagnostic: &Diagnostic);
    fn finish_generation_transition_with_identity(
        &self,
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
    ) -> SnapbackResult<()>;
}

impl TelemetryLocalExt for Telemetry {
    fn in_memory_with_identity(
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        Self::in_memory_with_identity(app_db_incarnation, identity, config)
    }

    fn open_for_database_with_identity(
        database_path: &Path,
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        Self::open_for_database_with_identity(database_path, app_db_incarnation, identity, config)
    }

    fn start_classified_span(
        &self,
        class_id: OperationClassIdV1,
        name: &str,
        correlation: Option<&str>,
        details: Option<Value>,
    ) -> ObservationSpan {
        self.start_classified_span(class_id, name, correlation, details)
    }

    fn point_classified(
        &self,
        class_id: OperationClassIdV1,
        name: &str,
        status: Option<i64>,
        code: Option<&str>,
        correlation: Option<&str>,
        details: Option<Value>,
        priority: Priority,
    ) {
        self.point_classified(class_id, name, status, code, correlation, details, priority);
    }

    fn set_release(&self, release: Option<&str>) {
        self.set_release(release);
    }

    fn record_process_ready(&self) {
        self.record_process_ready();
    }

    fn elevated_read(&self, function: &str, member: &str, correlation: Option<&str>) {
        self.elevated_read(function, member, correlation);
    }

    fn standalone_diagnostic(&self, diagnostic: &Diagnostic) {
        self.standalone_diagnostic(diagnostic);
    }

    fn finish_generation_transition_with_identity(
        &self,
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
    ) -> SnapbackResult<()> {
        self.finish_generation_transition_with_identity(app_db_incarnation, identity)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Phase {
    Point,
    Admission,
    Terminal,
    Joined,
}

impl Phase {
    fn as_str(self) -> &'static str {
        match self {
            Self::Point => "point",
            Self::Admission => "admission",
            Self::Terminal => "terminal",
            Self::Joined => "joined",
        }
    }
}

#[derive(Clone, Debug)]
struct Event {
    sequence: u64,
    admission: AdmittedObservationClassV1,
    phase: Phase,
    generation: String,
    ts_ms: i64,
    name: String,
    status: Option<i64>,
    duration_ms: Option<f64>,
    code: Option<String>,
    correlation: Option<String>,
    // @ref LLP 0154#d2--the-observation-span-classification-registry-and-phase-1-kinds —
    //   release is exact first-class identity captured at admission, not a
    //   capped detail or an export-time ambient value.
    release: Option<String>,
    details: Option<Value>,
    priority: Priority,
    enqueued_at: Instant,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ErrorIssueState {
    Open,
    Resolved,
    Ignored,
    Regressed,
}

impl ErrorIssueState {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Resolved => "resolved",
            Self::Ignored => "ignored",
            Self::Regressed => "regressed",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "open" => Some(Self::Open),
            "resolved" => Some(Self::Resolved),
            "ignored" => Some(Self::Ignored),
            "regressed" => Some(Self::Regressed),
            _ => None,
        }
    }
}

fn authored_transition_allowed(from: ErrorIssueState, to: ErrorIssueState) -> bool {
    matches!(
        (from, to),
        (
            ErrorIssueState::Open,
            ErrorIssueState::Resolved | ErrorIssueState::Ignored
        ) | (
            ErrorIssueState::Resolved,
            ErrorIssueState::Open | ErrorIssueState::Ignored
        ) | (ErrorIssueState::Ignored, ErrorIssueState::Open)
            | (
                ErrorIssueState::Regressed,
                ErrorIssueState::Open | ErrorIssueState::Resolved | ErrorIssueState::Ignored
            )
    )
}

fn advance_error_state_seq(state_seq: i64) -> SnapbackResult<i64> {
    if state_seq < 0 {
        return Err(SnapbackError::error(
            "SNAPBACK_ERROR_STATE_SEQUENCE_INVALID",
            "telemetry",
            "error issue state sequence must be nonnegative",
        ));
    }
    state_seq.checked_add(1).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_ERROR_STATE_SEQUENCE_EXHAUSTED",
            "telemetry",
            "error issue state sequence exhausted SQLite's integer range",
        )
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ErrorTransitionResult {
    Applied {
        issue: String,
        state: ErrorIssueState,
        state_seq: i64,
    },
    Conflict {
        issue: String,
        state: ErrorIssueState,
        state_seq: i64,
    },
    Invalid {
        issue: String,
        state: ErrorIssueState,
        state_seq: i64,
    },
    Missing {
        issue: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ErrorBulkTransitionResult {
    pub release: String,
    pub activation_seq: Option<i64>,
    pub activation_floor_seq: i64,
    pub known_release: bool,
    pub rows: Vec<ErrorTransitionResult>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ErrorTransitionHistoryFloor {
    pub floor_seq: i64,
    pub history_truncated: bool,
}

fn project_error_issue_state(state: ErrorIssueState) -> crate::errors_query::ErrorsIssueStateV1 {
    match state {
        ErrorIssueState::Open => crate::errors_query::ErrorsIssueStateV1::Open,
        ErrorIssueState::Resolved => crate::errors_query::ErrorsIssueStateV1::Resolved,
        ErrorIssueState::Ignored => crate::errors_query::ErrorsIssueStateV1::Ignored,
        ErrorIssueState::Regressed => crate::errors_query::ErrorsIssueStateV1::Regressed,
    }
}

fn authored_error_target(
    state: crate::errors_query::ErrorsIssueStateV1,
) -> SnapbackResult<ErrorIssueState> {
    match state {
        crate::errors_query::ErrorsIssueStateV1::Open => Ok(ErrorIssueState::Open),
        crate::errors_query::ErrorsIssueStateV1::Resolved => Ok(ErrorIssueState::Resolved),
        crate::errors_query::ErrorsIssueStateV1::Ignored => Ok(ErrorIssueState::Ignored),
        crate::errors_query::ErrorsIssueStateV1::Regressed => Err(SnapbackError::error(
            "SNAPBACK_ERROR_TRANSITION_INVALID",
            "telemetry",
            "regressed is a flusher-owned transition target",
        )),
    }
}

fn project_transition_result(
    result: ErrorTransitionResult,
) -> crate::errors_query::ErrorTransitionResultV1 {
    use crate::errors_query::{ErrorTransitionOutcomeV1, ErrorTransitionResultV1};
    match result {
        ErrorTransitionResult::Applied {
            issue,
            state,
            state_seq,
        } => ErrorTransitionResultV1 {
            issue,
            outcome: ErrorTransitionOutcomeV1::Applied,
            state: Some(project_error_issue_state(state)),
            state_seq: Some(state_seq),
        },
        ErrorTransitionResult::Conflict {
            issue,
            state,
            state_seq,
        } => ErrorTransitionResultV1 {
            issue,
            outcome: ErrorTransitionOutcomeV1::Conflict,
            state: Some(project_error_issue_state(state)),
            state_seq: Some(state_seq),
        },
        ErrorTransitionResult::Invalid {
            issue,
            state,
            state_seq,
        } => ErrorTransitionResultV1 {
            issue,
            outcome: ErrorTransitionOutcomeV1::Invalid,
            state: Some(project_error_issue_state(state)),
            state_seq: Some(state_seq),
        },
        ErrorTransitionResult::Missing { issue } => ErrorTransitionResultV1 {
            issue,
            outcome: ErrorTransitionOutcomeV1::Missing,
            state: None,
            state_seq: None,
        },
    }
}

struct ErrorIssueTransition<'a> {
    issue: &'a str,
    to: ErrorIssueState,
    expect_seq: i64,
    barrier: Option<i64>,
    release: Option<&'a str>,
    actor: &'a str,
}

struct ErrorTransitionRow<'a> {
    issue: &'a str,
    seq: i64,
    from: ErrorIssueState,
    to: ErrorIssueState,
    at_ms: i64,
    actor: &'a str,
    release: Option<&'a str>,
}

fn failed_observation(status: Option<i64>, code: Option<&str>) -> bool {
    code.is_some() || status.is_some_and(|status| status >= 400)
}

fn http_status_class(status: Option<i64>) -> Option<u16> {
    status
        .filter(|status| (400..600).contains(status))
        .map(|status| u16::try_from(status / 100).expect("bounded HTTP status class"))
}

fn detail_string<'a>(object: Option<&'a Map<String, Value>>, key: &str) -> Option<&'a str> {
    object
        .and_then(|object| object.get(key))
        .and_then(Value::as_str)
}

fn fallback_failure_details(
    classification: crate::error_tracking::FailureClassificationV1,
    branch: FingerprintBranchV1,
) -> Value {
    // A fixed-field allocation failure is not expected under the admitted
    // grammars. Preserve the classifier result and opt-in marker so E1 counts
    // an eligible malformed stamp instead of grouping guessed identity.
    json!({
        "failure_disposition": classification.failure_disposition,
        "issue_eligible": classification.issue_eligible,
        "classifier_version": classification.classifier_version,
        "fp_branch": branch,
    })
}

/// Enrich one already-failed observation at its producer seam. Classification
/// precedes fingerprint selection, which precedes the closed 8 KiB allocator;
/// the flush transaction is only allowed to validate and fold these stamps.
///
/// @ref LLP 0156#e01--the-failure-classifier-and-issue-eligibility — the
///   exhaustive first-match classifier runs once, before fingerprinting.
/// @ref LLP 0156#e02--the-failure-carrier — runtime-private carrier text is
///   consumed here and allocated into the existing raw telemetry details tier.
/// @ref LLP 0156#e11--fingerprint-at-the-seam-group-in-the-flush-transaction —
///   only structurally complete eligible failures receive a producer stamp.
fn failure_details_at_emission(
    admission: &AdmittedObservationClassV1,
    event_name: &str,
    status: Option<i64>,
    code: Option<&str>,
    details: Option<Value>,
    diagnostic: Option<&Diagnostic>,
    private_failure: Option<PrivateFailureContextV1>,
) -> Value {
    let supplied = details.as_ref().and_then(Value::as_object);
    let diagnostic_details = diagnostic.and_then(|diagnostic| diagnostic.details.as_object());
    let field =
        |key| detail_string(diagnostic_details, key).or_else(|| detail_string(supplied, key));
    let function = field("function").map(str::to_owned);
    let decoder_name = field("name").map(str::to_owned);
    let app_code = field("appCode").map(str::to_owned);
    let app_details = diagnostic_details
        .and_then(|object| object.get("appDetails"))
        .or_else(|| supplied.and_then(|object| object.get("appDetails")))
        .cloned();

    let mut existing_allowlist = BTreeMap::new();
    for key in EXISTING_ALLOWLIST_PRIORITY {
        if let Some(value) = diagnostic_details
            .and_then(|object| object.get(*key))
            .or_else(|| supplied.and_then(|object| object.get(*key)))
        {
            existing_allowlist.insert((*key).to_owned(), value.clone());
        }
    }

    let private_failure = private_failure.unwrap_or_default();
    let tracking = private_failure.app_refusal_tracking;
    // @ref LLP 0156#amendment-2026-08-03-multi-rejection-fingerprint-authority —
    //   queue order makes the first rejection the singular fingerprint and
    //   exemplar authority while the complete vector remains raw-tier facts.
    let carrier = private_failure.carriers.first();
    let rejection_carriers =
        (private_failure.carriers.len() > 1).then(|| private_failure.carriers.clone());
    let transport = admission.operation_class.starts_with("transport.") && code.is_none();
    let carrier_category = if tracking.is_some() {
        CarrierCategoryV1::AppRefusal
    } else if !private_failure.carriers.is_empty() {
        CarrierCategoryV1::Exception
    } else if transport {
        CarrierCategoryV1::Transport
    } else {
        CarrierCategoryV1::Diagnostic
    };
    let status_class = transport.then(|| http_status_class(status)).flatten();
    let classification = classify_failure(&FailureClassifierInputV1 {
        operation_class: admission.operation_class.to_owned(),
        name: Some(event_name.to_owned()),
        platform_code: code.map(str::to_owned),
        status_class,
        carrier_category,
        app_code: app_code.clone(),
        app_refusal_admitted: tracking.is_some(),
        app_refusal_tracked: tracking == Some(AppRefusalTrackingV1::Tracked),
    });

    let branch = match carrier_category {
        CarrierCategoryV1::AppRefusal => FingerprintBranchV1::AppRefusal,
        CarrierCategoryV1::Exception => FingerprintBranchV1::Exception,
        CarrierCategoryV1::Transport => FingerprintBranchV1::Transport,
        CarrierCategoryV1::Diagnostic
            if admission.operation_class == OperationClassIdV1::DIAGNOSTIC.as_str() =>
        {
            FingerprintBranchV1::Diagnostic
        }
        CarrierCategoryV1::Diagnostic => FingerprintBranchV1::TypedRefusal,
    };
    let raw_message = carrier
        .and_then(|carrier| carrier.message.clone())
        .or_else(|| field("message").map(str::to_owned))
        .or_else(|| diagnostic.map(|diagnostic| diagnostic.message.clone()));
    let message_template = (branch == FingerprintBranchV1::Exception)
        .then(|| raw_message.as_deref().map(normalize_message_v1))
        .flatten();
    let subsystem = (branch == FingerprintBranchV1::Diagnostic)
        .then(|| diagnostic.map(|diagnostic| diagnostic.subsystem.clone()))
        .flatten();

    let fingerprint_input = if classification.issue_eligible {
        match branch {
            FingerprintBranchV1::TypedRefusal => {
                code.map(|code| FingerprintInputV1::TypedRefusal {
                    scheme_version: FINGERPRINT_VERSION,
                    kind: Some(admission.telemetry_kind.clone()),
                    name: Some(event_name.to_owned()),
                    code: Some(code.to_owned()),
                })
            }
            FingerprintBranchV1::AppRefusal => {
                app_code
                    .as_ref()
                    .map(|app_code| FingerprintInputV1::AppRefusal {
                        scheme_version: FINGERPRINT_VERSION,
                        kind: Some(admission.telemetry_kind.clone()),
                        name: Some(event_name.to_owned()),
                        app_code: Some(app_code.clone()),
                    })
            }
            FingerprintBranchV1::Exception => {
                carrier
                    .zip(code)
                    .map(|(carrier, _)| FingerprintInputV1::Exception {
                        scheme_version: FINGERPRINT_VERSION,
                        kind: Some(admission.telemetry_kind.clone()),
                        name: Some(event_name.to_owned()),
                        error_class: Some(carrier.error_class.clone()),
                        message_template: message_template.clone(),
                    })
            }
            FingerprintBranchV1::Transport => {
                (status_class == Some(5)).then(|| FingerprintInputV1::Transport {
                    scheme_version: FINGERPRINT_VERSION,
                    kind: Some(admission.telemetry_kind.clone()),
                    name: Some(event_name.to_owned()),
                    status_class,
                })
            }
            FingerprintBranchV1::Diagnostic => {
                code.zip(subsystem.as_ref()).map(|(code, subsystem)| {
                    FingerprintInputV1::Diagnostic {
                        scheme_version: FINGERPRINT_VERSION,
                        name: Some(event_name.to_owned()),
                        subsystem: Some(subsystem.clone()),
                        code: Some(code.to_owned()),
                    }
                })
            }
        }
    } else {
        None
    };
    let fingerprint = fingerprint_input.as_ref().map(fingerprint_v1);
    let fingerprint_hash = fingerprint
        .as_ref()
        .map(|fingerprint| lower_hex(&fingerprint.truncated));

    let input = FailureDetailsInputV1 {
        platform_code: (branch != FingerprintBranchV1::Transport)
            .then(|| code.map(str::to_owned))
            .flatten(),
        classification,
        fingerprint_branch: branch,
        fingerprint_version: fingerprint.as_ref().map(|_| FINGERPRINT_VERSION),
        fingerprint_hash,
        predecessor_fingerprint_version: None,
        predecessor_fingerprint_hash: None,
        status_class: (branch == FingerprintBranchV1::Transport)
            .then_some(status_class)
            .flatten(),
        app_code: (branch == FingerprintBranchV1::AppRefusal)
            .then_some(app_code)
            .flatten(),
        error_class: (branch == FingerprintBranchV1::Exception)
            .then(|| carrier.map(|carrier| carrier.error_class.clone()))
            .flatten(),
        subsystem,
        function,
        name: decoder_name,
        existing_allowlist,
        app_details,
        message_template,
        message: raw_message,
        stack: carrier.and_then(|carrier| carrier.stack.clone()),
        rejection_carriers,
        message_extraction_truncated: carrier
            .is_some_and(|carrier| carrier.message_extraction_truncated),
        stack_extraction_truncated: carrier
            .is_some_and(|carrier| carrier.stack_extraction_truncated),
    };
    allocate_failure_details(&input)
        .map(|allocated| allocated.details)
        .unwrap_or_else(|_| fallback_failure_details(input.classification, branch))
}

#[derive(Debug)]
pub struct ObservationSpan {
    telemetry: Telemetry,
    admission: Option<AdmittedObservationClassV1>,
    generation: String,
    ts_ms: i64,
    started: Instant,
    name: String,
    correlation: Option<String>,
    release: Option<String>,
    details: Option<Value>,
    long_lived: bool,
    active: bool,
}

impl ObservationSpan {
    pub fn finish(mut self, status: Option<i64>, code: Option<&str>, details: Option<Value>) {
        self.finish_inner(status, code, details, None, None);
    }

    pub(crate) fn finish_error(
        mut self,
        status: Option<i64>,
        error: &mut SnapbackError,
        details: Option<Value>,
    ) {
        let private_failure = error.take_private_failure_context();
        self.finish_inner(
            status,
            Some(&error.diagnostic.code),
            details,
            Some(&error.diagnostic),
            private_failure,
        );
    }

    fn finish_inner(
        &mut self,
        status: Option<i64>,
        code: Option<&str>,
        details: Option<Value>,
        diagnostic: Option<&Diagnostic>,
        private_failure: Option<PrivateFailureContextV1>,
    ) {
        if !self.active {
            return;
        }
        self.active = false;
        let Some(admission) = self.admission.clone() else {
            return;
        };
        let phase = if self.long_lived {
            Phase::Terminal
        } else {
            Phase::Joined
        };
        let priority = if phase == Phase::Terminal
            || code.is_some()
            || status.is_some_and(|value| value >= 500)
        {
            Priority::Reserved
        } else {
            Priority::Normal
        };
        let details = details.or_else(|| self.details.clone());
        let details = if failed_observation(status, code) {
            Some(failure_details_at_emission(
                &admission,
                &self.name,
                status,
                code,
                details,
                diagnostic,
                private_failure,
            ))
        } else {
            details
        };
        self.telemetry.enqueue_bound(Event {
            sequence: 0,
            admission,
            phase,
            generation: self.generation.clone(),
            ts_ms: self.ts_ms,
            name: self.name.clone(),
            status,
            duration_ms: Some(self.started.elapsed().as_secs_f64() * 1000.0),
            code: code.map(|value| cap(value, CODE_MAX_BYTES)),
            correlation: self.correlation.clone(),
            release: self.release.clone(),
            details: scrub_details(details),
            priority,
            enqueued_at: Instant::now(),
        });
    }
}

impl Drop for ObservationSpan {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        self.active = false;
        let Some(admission) = self.admission.clone() else {
            return;
        };
        self.telemetry.enqueue_bound(Event {
            sequence: 0,
            admission,
            phase: if self.long_lived {
                Phase::Terminal
            } else {
                Phase::Joined
            },
            generation: self.generation.clone(),
            ts_ms: self.ts_ms,
            name: self.name.clone(),
            status: Some(499),
            duration_ms: Some(self.started.elapsed().as_secs_f64() * 1000.0),
            code: None,
            correlation: self.correlation.clone(),
            release: self.release.clone(),
            details: scrub_details(Some(json!({ "cause": "cancelled" })))
                .or_else(|| self.details.clone()),
            priority: Priority::Reserved,
            enqueued_at: Instant::now(),
        });
    }
}

#[derive(Clone, Debug, Default, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BufferDiagnostics {
    pub depth: usize,
    pub normal_depth: usize,
    pub reserved_depth: usize,
    pub drops_since_boot: BTreeMap<String, u64>,
    pub last_flush_watermark: Option<i64>,
}

#[derive(Default)]
struct Buffer {
    normal: VecDeque<Event>,
    reserved: VecDeque<Event>,
    next_sequence: u64,
    current_generation: String,
    accepting: bool,
    generation_fenced: bool,
    config_fenced: bool,
    shutdown: bool,
    drops_since_boot: BTreeMap<String, u64>,
    pending_drop_counters: BTreeMap<String, u64>,
    pending_drop_since: Option<Instant>,
    last_flush_watermark: Option<i64>,
}

impl Buffer {
    fn len(&self) -> usize {
        self.normal.len() + self.reserved.len()
    }

    fn oldest(&self) -> Option<Instant> {
        self.normal
            .front()
            .map(|event| event.enqueued_at)
            .into_iter()
            .chain(self.reserved.front().map(|event| event.enqueued_at))
            .chain(self.pending_drop_since)
            .min()
    }

    fn has_work(&self) -> bool {
        self.len() > 0 || !self.pending_drop_counters.is_empty()
    }

    fn count_drop(&mut self, event: &Event, reason: &str) {
        let key = format!(
            "{}:{}:{reason}",
            event.admission.telemetry_kind,
            event.priority.as_str()
        );
        *self.drops_since_boot.entry(key.clone()).or_default() += 1;
        *self.pending_drop_counters.entry(key).or_default() += 1;
        self.pending_drop_since.get_or_insert_with(Instant::now);
    }

    fn take_drop_counters(&mut self) -> BTreeMap<String, u64> {
        self.pending_drop_since = None;
        std::mem::take(&mut self.pending_drop_counters)
    }

    fn restore_drop_counters(&mut self, counters: BTreeMap<String, u64>) {
        if counters.is_empty() {
            return;
        }
        self.pending_drop_since.get_or_insert_with(Instant::now);
        for (key, count) in counters {
            *self.pending_drop_counters.entry(key).or_default() += count;
        }
    }

    fn drain_batch(&mut self, maximum: usize) -> Vec<Event> {
        let mut events = Vec::with_capacity(maximum.min(self.len()));
        while events.len() < maximum {
            let take_reserved = match (self.normal.front(), self.reserved.front()) {
                (Some(normal), Some(reserved)) => reserved.sequence < normal.sequence,
                (None, Some(_)) => true,
                (Some(_), None) => false,
                (None, None) => break,
            };
            events.push(if take_reserved {
                self.reserved.pop_front().expect("reserved front exists")
            } else {
                self.normal.pop_front().expect("normal front exists")
            });
        }
        events
    }
}

struct Shared {
    buffer: Mutex<Buffer>,
    wake: Condvar,
    store: Mutex<Store>,
    flush_gate: Mutex<()>,
    config: RwLock<TelemetryConfig>,
    release: RwLock<Option<String>>,
    worker_started: AtomicBool,
    worker_handle: Mutex<Option<std::thread::JoinHandle<()>>>,
    shutdown_flush_failed: AtomicBool,
    boot_maintenance_pending: AtomicBool,
    ready_recorded: AtomicBool,
}

#[derive(Default)]
struct FlushOutcome {
    watermark: Option<i64>,
    cap_drops: BTreeMap<String, u64>,
    replacement_generation: Option<String>,
    enqueue_high_water: Option<u64>,
}

struct Producer {
    shared: Arc<Shared>,
}

impl Drop for Producer {
    fn drop(&mut self) {
        let config = self
            .shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let panicking = std::thread::panicking();
        let release = self
            .shared
            .release
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let mut graceful_admitted = false;
        {
            let mut buffer = self
                .shared
                .buffer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            // @ref LLP 0154#d2--the-observation-span-classification-registry-and-phase-1-kinds —
            //   final producer ownership is the graceful-process boundary;
            //   its allowlisted marker drains before the durable clean bit.
            if !panicking
                && config.max_days > 0
                && buffer.accepting
                && let Ok(observation) = ids::mint(IdKind::Observation)
                && let Ok(admission) =
                    admit_operation_class(OperationClassIdV1::LIFECYCLE, observation)
            {
                let generation = buffer.current_generation.clone();
                let event = Event {
                    sequence: 0,
                    admission,
                    phase: Phase::Point,
                    generation,
                    ts_ms: wall_now_ms(),
                    name: "graceful_shutdown".to_owned(),
                    status: Some(200),
                    duration_ms: None,
                    code: None,
                    correlation: None,
                    release,
                    details: None,
                    priority: Priority::Reserved,
                    enqueued_at: Instant::now(),
                };
                enqueue_locked(&mut buffer, &config, event);
                graceful_admitted = true;
            }
            buffer.shutdown = true;
        }
        self.shared.wake.notify_all();
        if let Some(handle) = self
            .shared
            .worker_handle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            let _ = handle.join();
        }
        // No worker is created for an otherwise idle producer. Drain its
        // graceful marker synchronously; a failed drain deliberately leaves
        // the durable ownership bit unclean for the next boot to detect.
        let mut drained = true;
        loop {
            let has_work = self
                .shared
                .buffer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .has_work();
            if !has_work {
                break;
            }
            if flush_shared(&self.shared, false).is_err() {
                drained = false;
                break;
            }
        }
        if drained
            && !panicking
            && !self.shared.shutdown_flush_failed.load(Ordering::Acquire)
            && (config.max_days == 0 || graceful_admitted)
        {
            let _ = self
                .shared
                .store
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .mark_clean_shutdown(wall_now_ms());
        }
    }
}

/// Cloneable fire-and-forget producer. The worker owns no producer handle, so
/// the final clone's drop is a real graceful-drain signal.
#[derive(Clone)]
pub struct Telemetry {
    producer: Arc<Producer>,
}

/// Closed durable telemetry identity facts used by cross-crate tests.
#[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TelemetryMetaForTest {
    pub generation: String,
    pub app_id: Option<String>,
    pub environment: Option<String>,
    pub retention_floor: i64,
}

impl std::fmt::Debug for Telemetry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Telemetry")
            .field("diagnostics", &self.diagnostics())
            .finish()
    }
}

impl Telemetry {
    /// Probe a sibling's committed identity without exposing its connection.
    /// A store whose schema or singleton row has not committed yet returns
    /// `None`, which lets startup tests wait on the typed boundary.
    ///
    /// @ref LLP 0285#53-defect-3--the-caller-selectable-raw-sqlite-feature —
    /// callers receive identity facts, never raw SQLite authority.
    #[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
    pub fn durable_meta_for_database_for_test(
        database_path: &Path,
    ) -> SnapbackResult<Option<TelemetryMetaForTest>> {
        let path = Self::path_for_database(database_path);
        if !path.exists() {
            return Ok(None);
        }
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        let has_meta = connection
            .query_row(
                "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='telemetry_meta'",
                [],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !has_meta {
            return Ok(None);
        }
        telemetry_meta_for_test_on(&connection)
    }

    pub fn in_memory(app_db_incarnation: &str, config: TelemetryConfig) -> SnapbackResult<Self> {
        Self::from_store(
            Store::memory_unbound(app_db_incarnation, config.clone())?,
            config,
        )
    }

    pub(crate) fn in_memory_with_identity(
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        Self::from_store(
            Store::memory_with_identity(app_db_incarnation, identity, config.clone())?,
            config,
        )
    }

    pub fn open_for_database(
        database_path: &Path,
        app_db_incarnation: &str,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        let path = telemetry_path(database_path);
        Self::from_store(
            Store::open_unbound(path, app_db_incarnation, config.clone())?,
            config,
        )
    }

    pub(crate) fn open_for_database_with_identity(
        database_path: &Path,
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        let path = telemetry_path(database_path);
        Self::from_store(
            Store::open_with_identity(path, app_db_incarnation, identity, config.clone())?,
            config,
        )
    }

    fn from_store(store: Store, config: TelemetryConfig) -> SnapbackResult<Self> {
        config.validate()?;
        let generation = store.generation.clone();
        let unclean_predecessor = store.unclean_predecessor;
        let enabled = config.max_days > 0;
        let enqueue_seed = store.enqueue_sequence_seed()?;
        let shared = Arc::new(Shared {
            buffer: Mutex::new(Buffer {
                current_generation: generation,
                accepting: config.max_days > 0,
                next_sequence: enqueue_seed,
                ..Buffer::default()
            }),
            wake: Condvar::new(),
            store: Mutex::new(store),
            flush_gate: Mutex::new(()),
            config: RwLock::new(config),
            release: RwLock::new(None),
            worker_started: AtomicBool::new(false),
            worker_handle: Mutex::new(None),
            shutdown_flush_failed: AtomicBool::new(false),
            boot_maintenance_pending: AtomicBool::new(true),
            ready_recorded: AtomicBool::new(false),
        });
        let telemetry = Self {
            producer: Arc::new(Producer { shared }),
        };
        if unclean_predecessor && enabled {
            telemetry.point_classified(
                OperationClassIdV1::LIFECYCLE,
                "detected_unclean_predecessor",
                Some(200),
                None,
                None,
                None,
                Priority::Reserved,
            );
        }
        Ok(telemetry)
    }

    pub fn path_for_database(database_path: &Path) -> PathBuf {
        telemetry_path(database_path)
    }

    #[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
    pub fn start_span(
        &self,
        kind: &str,
        name: &str,
        correlation: Option<&str>,
        details: Option<Value>,
        long_lived: bool,
    ) -> ObservationSpan {
        let class_id = match (kind, long_lived) {
            ("function_run", false) => OperationClassIdV1::FUNCTION_QUERY,
            ("http_request", false) => OperationClassIdV1::HTTP_CARRIER,
            ("live_subscribe", true) => OperationClassIdV1::LIVE_SUBSCRIBE,
            ("ws_connect", true) => OperationClassIdV1::STREAM_CONNECT,
            ("job_run", false) => OperationClassIdV1::JOB_SCHEDULER,
            _ => OperationClassIdV1::SYSTEM_UNMATCHED,
        };
        self.start_span_with_class(class_id, name, correlation, details, long_lived)
    }

    /// Admit one registry-owned operation class. The exact class and its
    /// telemetry kind are resolved together before either projection sees the
    /// observation; production callers never supply a free-form kind string.
    pub(crate) fn start_classified_span(
        &self,
        class_id: OperationClassIdV1,
        name: &str,
        correlation: Option<&str>,
        details: Option<Value>,
    ) -> ObservationSpan {
        let long_lived = telemetry_projection_for_class(class_id)
            .map(|projection| projection == TelemetryProjectionModeV1::AdmissionTerminal)
            .unwrap_or(false);
        self.start_span_with_class(class_id, name, correlation, details, long_lived)
    }

    fn start_span_with_class(
        &self,
        class_id: OperationClassIdV1,
        name: &str,
        correlation: Option<&str>,
        details: Option<Value>,
        long_lived: bool,
    ) -> ObservationSpan {
        // Telemetry is loss-tolerant: an unavailable OS CSPRNG drops this
        // observation instead of weakening LLP 0154's random-body identity
        // contract or failing an application operation.
        let admission = ids::mint(IdKind::Observation)
            .ok()
            .and_then(|observation| admit_operation_class(class_id, observation).ok());
        let ts_ms = wall_now_ms();
        let details = scrub_details(details);
        let release = self.current_release();
        let admission_event = (long_lived && admission.is_some()).then(|| Event {
            sequence: 0,
            admission: admission
                .clone()
                .expect("checked classified telemetry observation"),
            phase: Phase::Admission,
            generation: String::new(),
            ts_ms,
            name: cap(name, NAME_MAX_BYTES),
            status: None,
            duration_ms: None,
            code: None,
            correlation: correlation.map(|value| cap(value, CORRELATION_MAX_BYTES)),
            release: release.clone(),
            details: details.clone(),
            // D3 reserves capacity for failures and terminal outcomes. A
            // long-lived admission is successful high-volume evidence until
            // its terminal says otherwise, so it must compete in Normal.
            priority: Priority::Normal,
            enqueued_at: Instant::now(),
        });
        let generation = self.admit_span(admission_event);
        let active = generation.is_some() && admission.is_some();
        ObservationSpan {
            telemetry: self.clone(),
            admission,
            generation: generation.unwrap_or_default(),
            ts_ms,
            started: Instant::now(),
            name: cap(name, NAME_MAX_BYTES),
            correlation: correlation.map(|value| cap(value, CORRELATION_MAX_BYTES)),
            release,
            details: if long_lived { None } else { details },
            long_lived,
            active,
        }
    }

    #[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
    // The public observation seam keeps the complete closed point shape
    // explicit so producers cannot smuggle fields through an options bag.
    #[allow(clippy::too_many_arguments)]
    pub fn point(
        &self,
        kind: &str,
        name: &str,
        status: Option<i64>,
        code: Option<&str>,
        correlation: Option<&str>,
        details: Option<Value>,
        priority: Priority,
    ) {
        let class_id = match kind {
            "lifecycle" => OperationClassIdV1::LIFECYCLE,
            "log" => OperationClassIdV1::LOG,
            "diagnostic" => OperationClassIdV1::DIAGNOSTIC,
            _ => OperationClassIdV1::SYSTEM_UNMATCHED,
        };
        self.point_classified(class_id, name, status, code, correlation, details, priority);
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn point_classified(
        &self,
        class_id: OperationClassIdV1,
        name: &str,
        status: Option<i64>,
        code: Option<&str>,
        correlation: Option<&str>,
        details: Option<Value>,
        priority: Priority,
    ) {
        self.point_classified_inner(
            class_id,
            name,
            status,
            code,
            correlation,
            details,
            priority,
            None,
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn point_classified_inner(
        &self,
        class_id: OperationClassIdV1,
        name: &str,
        status: Option<i64>,
        code: Option<&str>,
        correlation: Option<&str>,
        details: Option<Value>,
        priority: Priority,
        diagnostic: Option<&Diagnostic>,
    ) {
        let Ok(observation) = ids::mint(IdKind::Observation) else {
            return;
        };
        let Ok(admission) = admit_operation_class(class_id, observation) else {
            return;
        };
        let name = cap(name, NAME_MAX_BYTES);
        let details = if failed_observation(status, code) {
            Some(failure_details_at_emission(
                &admission, &name, status, code, details, diagnostic, None,
            ))
        } else {
            details
        };
        self.enqueue_current(Event {
            sequence: 0,
            admission,
            phase: Phase::Point,
            generation: String::new(),
            ts_ms: wall_now_ms(),
            name,
            status,
            duration_ms: None,
            code: code.map(|value| cap(value, CODE_MAX_BYTES)),
            correlation: correlation.map(|value| cap(value, CORRELATION_MAX_BYTES)),
            release: self.current_release(),
            details: scrub_details(details),
            priority,
            enqueued_at: Instant::now(),
        });
    }

    /// Publish the release identity used by subsequent admissions. Spans keep
    /// the exact release captured at admission even if activation changes
    /// while they are in flight.
    pub(crate) fn set_release(&self, release: Option<&str>) {
        *self
            .producer
            .shared
            .release
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = release.map(str::to_owned);
    }

    fn current_release(&self) -> Option<String> {
        self.producer
            .shared
            .release
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Apply one authored issue transition directly on the telemetry owner.
    /// The admission lock is held only long enough to capture the resolve
    /// barrier; SQLite remains entirely off the producer critical section.
    ///
    /// @ref LLP 0156#e13--the-issue-state-machine — resolve barriers use the
    ///   live enqueue counter and advance its durable high-water atomically.
    #[allow(dead_code)] // The E1 typed surface lands in the following tranche.
    pub(crate) fn transition_error_issue(
        &self,
        issue: &str,
        to: ErrorIssueState,
        expect_seq: i64,
    ) -> SnapbackResult<ErrorTransitionResult> {
        let _flush = self
            .producer
            .shared
            .flush_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let barrier = if to == ErrorIssueState::Resolved {
            Some(self.capture_enqueue_sequence()?)
        } else {
            None
        };
        let release = self.current_release();
        self.producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .transition_error_issue(
                ErrorIssueTransition {
                    issue,
                    to,
                    expect_seq,
                    barrier,
                    release: release.as_deref(),
                    actor: "admin",
                },
                wall_now_ms(),
            )
    }

    /// Resolve the release-selector snapshot in one serialized transaction.
    #[allow(dead_code)] // The E1 typed surface lands in the following tranche.
    pub(crate) fn resolve_errors_open_before(
        &self,
        release: &str,
    ) -> SnapbackResult<ErrorBulkTransitionResult> {
        let _flush = self
            .producer
            .shared
            .flush_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let barrier = self.capture_enqueue_sequence()?;
        self.producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .resolve_errors_open_before(release, barrier, wall_now_ms())
    }

    fn capture_enqueue_sequence(&self) -> SnapbackResult<i64> {
        let sequence = self
            .producer
            .shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .next_sequence;
        i64::try_from(sequence).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_TELEMETRY_SEQUENCE_EXHAUSTED",
                "telemetry",
                "telemetry enqueue sequence exceeded SQLite's integer range",
            )
        })
    }

    /// Publish process readiness once at the authoritative surface cut. Both
    /// listener bind and direct-Service poll readiness share this authority.
    pub(crate) fn record_process_ready(&self) {
        if self
            .producer
            .shared
            .ready_recorded
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            self.point_classified(
                OperationClassIdV1::LIFECYCLE,
                "process_ready",
                Some(200),
                None,
                None,
                None,
                Priority::Reserved,
            );
        }
    }

    /// Capture the existing `runtime.log` host call. The allowlist stores only
    /// level and capped authored output; Phase 1 has no subject or IP field.
    pub fn runtime_log(&self, level: &str, message: &Value, correlation: Option<&str>) {
        let config = self
            .producer
            .shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let severity = log_severity(level);
        if severity_rank(severity) < severity_rank(config.min_level) {
            return;
        }
        self.point_classified(
            OperationClassIdV1::LOG,
            level,
            None,
            None,
            correlation,
            Some(json!({ "level": level, "message": message })),
            Priority::Normal,
        );
    }

    /// Record one executed `ctx.db.elevated` read at the trusted host seam.
    /// Two names make the existing bounded `telemetry.stats` named-count
    /// projection directly answer totals by function and by member without a
    /// new read endpoint or sensitive argument capture.
    ///
    /// @ref LLP 0231#d7--handler-reads-are-scoped-unless-the-call-site-is-explicitly-elevated — observation records
    ///   use of the explicit escape hatch; it does not adjudicate that use.
    pub(crate) fn elevated_read(&self, function: &str, member: &str, correlation: Option<&str>) {
        for name in [format!("function:{function}"), format!("member:{member}")] {
            self.point_classified(
                OperationClassIdV1::RUNTIME_ELEVATED_READ,
                &name,
                None,
                None,
                correlation,
                None,
                Priority::Normal,
            );
        }
    }

    /// Record an unattached diagnostic at the emission boundary. Phase 1
    /// admits only Warning+ diagnostics, further narrowed by `min_level`;
    /// informational diagnostics remain available through the existing
    /// recent-diagnostics ring without entering telemetry.
    pub(crate) fn standalone_diagnostic(&self, diagnostic: &Diagnostic) {
        let config = self
            .producer
            .shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let threshold =
            severity_rank(config.min_level.clone()).max(severity_rank(DiagnosticSeverity::Warning));
        if severity_rank(diagnostic.severity.clone()) < threshold {
            return;
        }
        drop(config);
        let failure = matches!(
            &diagnostic.severity,
            DiagnosticSeverity::Error | DiagnosticSeverity::Fatal
        );
        self.point_classified_inner(
            OperationClassIdV1::DIAGNOSTIC,
            &diagnostic.code,
            Some(if failure { 500 } else { 200 }),
            Some(&diagnostic.code),
            None,
            Some(json!({ "severity": diagnostic.severity.clone() })),
            Priority::Reserved,
            Some(diagnostic),
        );
    }

    /// Admit a span and capture its generation at the same buffer-lock
    /// linearization point. A reset can therefore occur entirely before or
    /// after admission, never between the generation read and admission.
    fn admit_span(&self, mut admission: Option<Event>) -> Option<String> {
        let shared = &self.producer.shared;
        let config = shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut buffer = shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !buffer.accepting || config.max_days == 0 || buffer.shutdown {
            return None;
        }
        let generation = buffer.current_generation.clone();
        let should_wake = admission.as_mut().is_some_and(|event| {
            event.generation = generation.clone();
            enqueue_locked(&mut buffer, &config, event.clone())
        });
        drop(buffer);
        drop(config);
        if admission.is_some() {
            self.ensure_worker();
            if should_wake {
                shared.wake.notify_one();
            }
        }
        Some(generation)
    }

    fn enqueue_current(&self, event: Event) {
        self.enqueue(event, true);
    }

    fn enqueue_bound(&self, event: Event) {
        self.enqueue(event, false);
    }

    fn enqueue(&self, mut event: Event, bind_current_generation: bool) {
        let shared = &self.producer.shared;
        let config = shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut buffer = shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if config.max_days == 0 || buffer.shutdown {
            return;
        }
        if !buffer.accepting {
            let reason = if buffer.generation_fenced {
                "generationFence"
            } else if buffer.config_fenced {
                "configTransition"
            } else {
                "admissionClosed"
            };
            buffer.count_drop(&event, reason);
            drop(buffer);
            drop(config);
            self.ensure_worker();
            shared.wake.notify_one();
            return;
        }
        if bind_current_generation {
            event.generation = buffer.current_generation.clone();
        }
        let should_wake = enqueue_locked(&mut buffer, &config, event);
        drop(buffer);
        drop(config);
        self.ensure_worker();
        if should_wake {
            shared.wake.notify_one();
        }
    }

    fn ensure_worker(&self) {
        let shared = self.producer.shared.clone();
        if shared
            .worker_started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }
        let worker_shared = shared.clone();
        let spawn = std::thread::Builder::new()
            .name("snapback-telemetry".to_owned())
            .spawn(move || worker(worker_shared));
        let Ok(handle) = spawn else {
            self.producer
                .shared
                .worker_started
                .store(false, Ordering::Release);
            let mut buffer = self
                .producer
                .shared
                .buffer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let drained = buffer.drain_batch(usize::MAX);
            for event in drained {
                buffer.count_drop(&event, "workerUnavailable");
            }
            return;
        };
        *shared
            .worker_handle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(handle);
    }

    /// Reset/restore phase 1: stop admission and discard everything not yet
    /// handed to the flusher. A concurrently flushing old-generation batch may
    /// still commit; the visibility view makes it harmless.
    pub fn begin_generation_transition(&self) {
        let mut buffer = self
            .producer
            .shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        buffer.generation_fenced = true;
        buffer.accepting = false;
        let drained = buffer.drain_batch(usize::MAX);
        for event in drained {
            buffer.count_drop(&event, "generationFence");
        }
        let has_drop_counters = !buffer.pending_drop_counters.is_empty();
        drop(buffer);
        if has_drop_counters {
            self.ensure_worker();
            self.producer.shared.wake.notify_one();
        }
    }

    /// Reset/restore phase 2: durably bind a freshly minted generation to the
    /// committed app incarnation before producer admission reopens.
    pub fn finish_generation_transition(&self, app_db_incarnation: &str) -> SnapbackResult<()> {
        let identity = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .identity
            .clone();
        self.finish_generation_transition_inner(app_db_incarnation, identity)
    }

    pub(crate) fn finish_generation_transition_with_identity(
        &self,
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
    ) -> SnapbackResult<()> {
        self.finish_generation_transition_inner(app_db_incarnation, Some(identity))
    }

    fn finish_generation_transition_inner(
        &self,
        app_db_incarnation: &str,
        identity: Option<TelemetryStoreIdentity>,
    ) -> SnapbackResult<()> {
        let generation = {
            let mut store = self
                .producer
                .shared
                .store
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            store.rebind_with_optional_identity(app_db_incarnation, identity, wall_now_ms())?;
            store.generation.clone()
        };
        let enabled = self
            .producer
            .shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .max_days
            > 0;
        let mut buffer = self
            .producer
            .shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        buffer.current_generation = generation;
        buffer.generation_fenced = false;
        buffer.accepting = enabled && !buffer.config_fenced;
        Ok(())
    }

    pub fn cancel_generation_transition(&self) {
        let enabled = self
            .producer
            .shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .max_days
            > 0;
        let mut buffer = self
            .producer
            .shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        buffer.generation_fenced = false;
        buffer.accepting = enabled && !buffer.config_fenced;
    }

    pub fn update_config(&self, config: TelemetryConfig) -> SnapbackResult<()> {
        config.validate()?;
        let had_drops = {
            let mut buffer = self
                .producer
                .shared
                .buffer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            buffer.config_fenced = true;
            buffer.accepting = false;
            let drained = buffer.drain_batch(usize::MAX);
            for event in drained {
                buffer.count_drop(&event, "configTransition");
            }
            !buffer.pending_drop_counters.is_empty()
        };
        if had_drops {
            self.ensure_worker();
            self.producer.shared.wake.notify_one();
        }
        let old_enabled = self
            .producer
            .shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .max_days
            > 0;
        let (replacement_generation, enqueue_seed) = {
            let mut store = self
                .producer
                .shared
                .store
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Err(error) = store.update_config(config.clone(), wall_now_ms()) {
                let mut buffer = self
                    .producer
                    .shared
                    .buffer
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                buffer.config_fenced = false;
                buffer.accepting = old_enabled && !buffer.generation_fenced;
                self.producer.shared.wake.notify_all();
                return Err(error);
            }
            (
                store.replacement_generation.take(),
                store.enqueue_sequence_seed()?,
            )
        };
        *self
            .producer
            .shared
            .config
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = config.clone();
        let mut buffer = self
            .producer
            .shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(generation) = replacement_generation {
            buffer.current_generation = generation;
        }
        buffer.next_sequence = buffer.next_sequence.max(enqueue_seed);
        buffer.config_fenced = false;
        buffer.accepting = config.max_days > 0 && !buffer.generation_fenced;
        drop(buffer);
        self.producer.shared.wake.notify_all();
        Ok(())
    }

    #[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
    pub fn fail_next_config_update_for_test(&self) {
        self.producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .fail_update_config = true;
    }

    pub fn force_flush(&self) -> SnapbackResult<()> {
        let mut force_maintenance = true;
        loop {
            flush_shared(&self.producer.shared, force_maintenance)?;
            force_maintenance = false;
            let has_work = self
                .producer
                .shared
                .buffer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .has_work();
            if !has_work {
                return Ok(());
            }
        }
    }

    pub fn diagnostics(&self) -> BufferDiagnostics {
        let buffer = self
            .producer
            .shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        BufferDiagnostics {
            depth: buffer.len(),
            normal_depth: buffer.normal.len(),
            reserved_depth: buffer.reserved.len(),
            drops_since_boot: buffer.drops_since_boot.clone(),
            last_flush_watermark: buffer.last_flush_watermark,
        }
    }

    /// Read one bounded page from the existing generation-bound visibility
    /// view. Querying first drains the in-process buffer through the ordinary
    /// OBS-01 flush path; it never writes through a second seam.
    ///
    /// @ref LLP 0154#d5--the-query-contract-typed-operations-projected-everywhere — typed events use
    ///   deterministic `(recorded_ts_ms,id)` ordering and a bounded page.
    pub fn query_events(
        &self,
        request: &crate::telemetry_query::TelemetryEventsRequestV1,
    ) -> SnapbackResult<crate::telemetry_query::TelemetryEventsResponseV1> {
        self.force_flush()?;
        let diagnostics = self.diagnostics();
        let context = crate::telemetry_query::QueryContext {
            drops_since_boot: diagnostics.drops_since_boot,
            last_flush_watermark: diagnostics.last_flush_watermark,
        };
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store.ensure_connection(wall_now_ms())?;
        crate::telemetry_query::query_events(connection, request, &context)
    }

    /// Answer aggregate telemetry from one SQLite read owner: rollups through
    /// their durable watermark plus the visible raw tail above it.
    ///
    /// @ref LLP 0154#d5--the-query-contract-typed-operations-projected-everywhere — stats never add two
    ///   independently observed answers or overlap the rollup/raw partitions.
    pub fn query_stats(
        &self,
        request: &crate::telemetry_query::TelemetryStatsRequestV1,
    ) -> SnapbackResult<crate::telemetry_query::TelemetryStatsResponseV1> {
        self.force_flush()?;
        let diagnostics = self.diagnostics();
        let context = crate::telemetry_query::QueryContext {
            drops_since_boot: diagnostics.drops_since_boot,
            last_flush_watermark: diagnostics.last_flush_watermark,
        };
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store.ensure_connection(wall_now_ms())?;
        crate::telemetry_query::query_stats(connection, request, &context)
    }

    /// Read the structural-only issue list from the existing error-group
    /// visibility view. This is an ordinary OperatorMetadata read: templates,
    /// messages, and stacks do not occur in its DTO.
    ///
    /// @ref LLP 0156#e14--surface-typed-operations-projected-everywhere-d5-discipline — the
    ///   closed list is cursor-bounded and release-sequence aware.
    pub fn query_error_issues(
        &self,
        request: &crate::errors_query::ErrorsIssuesRequestV1,
    ) -> SnapbackResult<crate::errors_query::ErrorsIssuesResponseV1> {
        self.force_flush()?;
        let diagnostics = self.diagnostics();
        let context = crate::telemetry_query::QueryContext {
            drops_since_boot: diagnostics.drops_since_boot,
            last_flush_watermark: diagnostics.last_flush_watermark,
        };
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store.ensure_connection(wall_now_ms())?;
        crate::errors_query::query_issues(connection, request, &context)
    }

    /// Read one raw-tier issue detail with retained exemplars and transition
    /// history. Carrier authorization is intentionally outside this core so
    /// HTTP, CLI, and MCP all call the same operation.
    pub fn query_error_issue(
        &self,
        request: &crate::errors_query::ErrorsIssueRequestV1,
    ) -> SnapbackResult<crate::errors_query::ErrorsIssueResponseV1> {
        self.force_flush()?;
        let diagnostics = self.diagnostics();
        let context = crate::telemetry_query::QueryContext {
            drops_since_boot: diagnostics.drops_since_boot,
            last_flush_watermark: diagnostics.last_flush_watermark,
        };
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store.ensure_connection(wall_now_ms())?;
        crate::errors_query::query_issue(connection, request, &context)
    }

    /// Apply either the single CAS form or the one-transaction release
    /// selector form, then project the shared transition result contract.
    ///
    /// @ref LLP 0156#e13--the-issue-state-machine — callers provide a CAS for
    ///   one row; the bulk selector supplies its own atomic snapshot.
    pub fn transition_errors(
        &self,
        request: &crate::errors_query::ErrorsTransitionRequestV1,
    ) -> SnapbackResult<crate::errors_query::ErrorsTransitionResponseV1> {
        use crate::errors_query::ErrorsIssueStateV1;

        if let crate::errors_query::ErrorsTransitionRequestV1::Single(single) = request {
            crate::errors_query::validate_issue_id(&single.issue)?;
        }

        let (release, activation_seq, rows) = match request {
            crate::errors_query::ErrorsTransitionRequestV1::Single(single)
                if single.expect_seq >= 0 =>
            {
                let to = authored_error_target(single.to)?;
                let row = self.transition_error_issue(&single.issue, to, single.expect_seq)?;
                (None, None, vec![project_transition_result(row)])
            }
            crate::errors_query::ErrorsTransitionRequestV1::Bulk(bulk)
                if bulk.to == ErrorsIssueStateV1::Resolved =>
            {
                if bulk.selector.open_before.is_empty() {
                    return Err(SnapbackError::error(
                        "SNAPBACK_ERROR_TRANSITION_INVALID",
                        "telemetry",
                        "bulk errors transition requires a nonempty openBefore release",
                    ));
                }
                let result = self.resolve_errors_open_before(&bulk.selector.open_before)?;
                if !result.known_release {
                    let known_releases = self.error_known_releases()?;
                    return Err(SnapbackError::error(
                        "SNAPBACK_ERROR_RELEASE_UNKNOWN_OR_PRUNED",
                        "telemetry",
                        "bulk error transition release is unknown or below the retained activation floor",
                    )
                    .with_details(json!({
                        "release": bulk.selector.open_before,
                        "knownReleases": known_releases,
                        "activationFloorSeq": result.activation_floor_seq,
                    })));
                }
                (
                    Some(result.release),
                    result.activation_seq,
                    result
                        .rows
                        .into_iter()
                        .map(project_transition_result)
                        .collect(),
                )
            }
            _ => {
                return Err(SnapbackError::error(
                    "SNAPBACK_ERROR_TRANSITION_INVALID",
                    "telemetry",
                    "errors transition requires exactly one of {issue, expectSeq} or {selector}",
                ));
            }
        };
        let diagnostics = self.diagnostics();
        let context = crate::telemetry_query::QueryContext {
            drops_since_boot: diagnostics.drops_since_boot,
            last_flush_watermark: diagnostics.last_flush_watermark,
        };
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store.ensure_connection(wall_now_ms())?;
        Ok(crate::errors_query::ErrorsTransitionResponseV1 {
            schema_version: "snapback.errors.transition.v1".to_owned(),
            release,
            activation_seq,
            activation_floor_seq: crate::errors_query::activation_floor(connection)?,
            rows,
            variance: crate::errors_query::transition_variance(connection, &context)?,
        })
    }

    fn error_known_releases(&self) -> SnapbackResult<Vec<String>> {
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store.ensure_connection(wall_now_ms())?;
        let response = crate::errors_query::query_issues(
            connection,
            &crate::errors_query::ErrorsIssuesRequestV1 {
                limit: 1,
                ..Default::default()
            },
            &crate::telemetry_query::QueryContext {
                drops_since_boot: BTreeMap::new(),
                last_flush_watermark: None,
            },
        )?;
        Ok(response.known_releases)
    }

    /// Freeze one export snapshot and its self-describing NDJSON header.
    ///
    /// @ref LLP 0154#d9--export-not-retention — export stamps trusted
    ///   store-level app/environment identity onto every emitted event.
    pub fn begin_export(
        &self,
        request: &crate::telemetry_query::TelemetryExportRequestV1,
    ) -> SnapbackResult<crate::telemetry_query::TelemetryExportHeaderV1> {
        self.force_flush()?;
        let diagnostics = self.diagnostics();
        let context = crate::telemetry_query::QueryContext {
            drops_since_boot: diagnostics.drops_since_boot,
            last_flush_watermark: diagnostics.last_flush_watermark,
        };
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store.ensure_connection(wall_now_ms())?;
        crate::telemetry_query::begin_export(connection, request, &context)
    }

    /// Read one bounded page that cannot advance beyond a previously frozen
    /// export snapshot. Callers unfold pages into NDJSON; no page or core API
    /// materializes the complete export.
    pub fn export_page(
        &self,
        request: &crate::telemetry_query::TelemetryExportRequestV1,
        header: &crate::telemetry_query::TelemetryExportHeaderV1,
        after: Option<&crate::telemetry_query::TelemetryCursorV1>,
        limit: usize,
    ) -> SnapbackResult<crate::telemetry_query::TelemetryExportPageV1> {
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store.ensure_connection(wall_now_ms())?;
        crate::telemetry_query::export_page(connection, request, header, after, limit)
    }

    /// Return one finite JSON export page for agent carriers. Unlike the
    /// HTTP/CLI NDJSON stream, every call declares and proves its row and byte
    /// ceiling and advances only with a startup-bound continuation token.
    pub fn agent_export_page(
        &self,
        request: &crate::telemetry_query::TelemetryAgentExportRequestV1,
        continuation_key: &[u8; 32],
    ) -> SnapbackResult<crate::telemetry_query::TelemetryAgentExportPageV1> {
        self.force_flush()?;
        let diagnostics = self.diagnostics();
        let context = crate::telemetry_query::QueryContext {
            drops_since_boot: diagnostics.drops_since_boot,
            last_flush_watermark: diagnostics.last_flush_watermark,
        };
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store.ensure_connection(wall_now_ms())?;
        crate::telemetry_query::agent_export_page(connection, request, &context, continuation_key)
    }

    #[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
    pub fn event_count_for_test(&self, kind: &str, name: &str, phase: &str) -> i64 {
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store
            .ensure_connection(wall_now_ms())
            .expect("open telemetry store for test query");
        connection
            .query_row(
                "SELECT count(*) FROM telemetry_events_visible WHERE kind=?1 AND name=?2 AND phase=?3",
                params![kind, name, phase],
                |row| row.get(0),
            )
            .expect("query telemetry event count")
    }

    #[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
    pub fn event_outcomes_for_test(
        &self,
        kind: &str,
        name: &str,
        phase: &str,
    ) -> Vec<(Option<i64>, Option<String>)> {
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store
            .ensure_connection(wall_now_ms())
            .expect("open telemetry store for test outcome query");
        connection
            .prepare(
                "SELECT status,code FROM telemetry_events_visible WHERE kind=?1 AND name=?2 AND phase=?3 ORDER BY id",
            )
            .expect("prepare telemetry outcome query")
            .query_map(params![kind, name, phase], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query telemetry outcomes")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect telemetry outcomes")
    }

    #[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
    pub fn event_details_for_test(&self, kind: &str, name: &str) -> Vec<Option<Value>> {
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store
            .ensure_connection(wall_now_ms())
            .expect("open telemetry store for test details query");
        connection
            .prepare(
                "SELECT details FROM telemetry_events_visible WHERE kind=?1 AND name=?2 ORDER BY id",
            )
            .expect("prepare telemetry details query")
            .query_map(params![kind, name], |row| row.get::<_, Option<String>>(0))
            .expect("query telemetry details")
            .map(|details| {
                details.map(|details| {
                    details
                        .map(|details| serde_json::from_str(&details).expect("telemetry details JSON"))
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .expect("collect telemetry details")
    }

    #[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
    pub fn event_releases_for_test(&self, kind: &str, name: &str) -> Vec<Option<String>> {
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store
            .ensure_connection(wall_now_ms())
            .expect("open telemetry store for test release query");
        connection
            .prepare(
                "SELECT release FROM telemetry_events_visible WHERE kind=?1 AND name=?2 ORDER BY id",
            )
            .expect("prepare telemetry release query")
            .query_map(params![kind, name], |row| row.get(0))
            .expect("query telemetry releases")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect telemetry releases")
    }

    /// Return the committed store identity and retention floor through a
    /// closed value probe.
    #[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
    pub fn durable_meta_for_test(&self) -> SnapbackResult<TelemetryMetaForTest> {
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store.ensure_connection(wall_now_ms())?;
        telemetry_meta_for_test_on(connection)?.ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_TELEMETRY_IDENTITY_UNBOUND",
                "telemetry",
                "telemetry metadata singleton is absent",
            )
        })
    }

    /// Return the bounded visible error-group names needed by grouping tests.
    #[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
    pub fn error_group_names_for_test(&self) -> SnapbackResult<Vec<String>> {
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store.ensure_connection(wall_now_ms())?;
        Ok(connection
            .prepare("SELECT name FROM error_groups_visible ORDER BY name")?
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?)
    }

    /// Compare retained physical events with the current generation's visible
    /// projection without exposing the sibling connection.
    #[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
    pub fn physical_and_visible_event_counts_for_test(&self) -> SnapbackResult<(i64, i64)> {
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store.ensure_connection(wall_now_ms())?;
        Ok((
            connection.query_row("SELECT count(*) FROM telemetry_events", [], |row| {
                row.get(0)
            })?,
            connection.query_row("SELECT count(*) FROM telemetry_events_visible", [], |row| {
                row.get(0)
            })?,
        ))
    }
}

#[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
fn telemetry_meta_for_test_on(
    connection: &Connection,
) -> SnapbackResult<Option<TelemetryMetaForTest>> {
    Ok(connection
        .query_row(
            "SELECT generation,app_id,environment,retention_floor
             FROM telemetry_meta WHERE singleton=1",
            [],
            |row| {
                Ok(TelemetryMetaForTest {
                    generation: row.get(0)?,
                    app_id: row.get(1)?,
                    environment: row.get(2)?,
                    retention_floor: row.get(3)?,
                })
            },
        )
        .optional()?)
}

fn enqueue_locked(buffer: &mut Buffer, config: &TelemetryConfig, mut event: Event) -> bool {
    if buffer.next_sequence >= i64::MAX as u64 {
        buffer.count_drop(&event, "sequenceExhausted");
        return true;
    }
    buffer.next_sequence += 1;
    event.sequence = buffer.next_sequence;
    let normal_limit = config
        .buffer_capacity
        .saturating_sub(config.priority_reserve);
    match event.priority {
        Priority::Normal => {
            if buffer.len() >= config.buffer_capacity && buffer.normal.is_empty() {
                buffer.count_drop(&event, "reservedProtectedDropIncoming");
                return true;
            }
            if (buffer.normal.len() >= normal_limit || buffer.len() >= config.buffer_capacity)
                && let Some(dropped) = buffer.normal.pop_front()
            {
                buffer.count_drop(&dropped, "bufferFullDropOldest");
            }
            buffer.normal.push_back(event);
        }
        Priority::Reserved => {
            if buffer.len() >= config.buffer_capacity {
                if let Some(dropped) = buffer.normal.pop_front() {
                    buffer.count_drop(&dropped, "priorityDisplacedNormal");
                } else if let Some(dropped) = buffer.reserved.pop_front() {
                    buffer.count_drop(&dropped, "reservedFullDropOldest");
                }
            }
            buffer.reserved.push_back(event);
        }
    }
    buffer.len() >= config.batch_size || buffer.len() == 1
}

fn worker(shared: Arc<Shared>) {
    loop {
        let config = shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let mut buffer = shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while buffer.len() < config.batch_size && !buffer.shutdown {
            let Some(oldest) = buffer.oldest() else {
                buffer = shared
                    .wake
                    .wait(buffer)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                continue;
            };
            let age = oldest.elapsed();
            let maximum = Duration::from_millis(config.max_age_ms);
            if age >= maximum {
                break;
            }
            let waited = shared
                .wake
                .wait_timeout(buffer, maximum - age)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            buffer = waited.0;
        }
        let shutdown = buffer.shutdown;
        let has_work = buffer.has_work();
        drop(buffer);
        if has_work && flush_shared(&shared, false).is_err() && shutdown {
            shared.shutdown_flush_failed.store(true, Ordering::Release);
            break;
        }
        if shutdown {
            let remaining = shared
                .buffer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .has_work();
            if !remaining {
                break;
            }
        }
    }
}

fn flush_shared(shared: &Arc<Shared>, force_maintenance: bool) -> SnapbackResult<()> {
    // Serialize drain + commit, not just SQLite access. `force_flush` can then
    // observe an actually empty producer rather than an empty buffer whose
    // batch is still in flight on another worker.
    let _flush = shared
        .flush_gate
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let config = shared
        .config
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    let (events, counters) = {
        let mut buffer = shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let events = buffer.drain_batch(config.batch_size.max(1));
        let counters = buffer.take_drop_counters();
        (events, counters)
    };
    if events.is_empty() && counters.is_empty() && !force_maintenance {
        return Ok(());
    }
    let boot_maintenance =
        config.max_days > 0 && shared.boot_maintenance_pending.load(Ordering::Acquire);
    let result = shared
        .store
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .flush(
            events.clone(),
            counters.clone(),
            wall_now_ms(),
            force_maintenance || boot_maintenance,
        );
    match result {
        Ok(outcome) => {
            if boot_maintenance {
                shared
                    .boot_maintenance_pending
                    .store(false, Ordering::Release);
            }
            let mut buffer = shared
                .buffer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(generation) = outcome.replacement_generation {
                buffer.current_generation = generation.clone();
                for event in std::mem::take(&mut buffer.normal) {
                    if event.generation == generation {
                        buffer.normal.push_back(event);
                    } else {
                        buffer.count_drop(&event, "storeReplaced");
                    }
                }
                for event in std::mem::take(&mut buffer.reserved) {
                    if event.generation == generation {
                        buffer.reserved.push_back(event);
                    } else {
                        buffer.count_drop(&event, "storeReplaced");
                    }
                }
                if buffer.shutdown {
                    shared.shutdown_flush_failed.store(true, Ordering::Release);
                }
            }
            if let Some(enqueue_high_water) = outcome.enqueue_high_water {
                buffer.next_sequence = buffer.next_sequence.max(enqueue_high_water);
            }
            if let Some(watermark) = outcome.watermark {
                buffer.last_flush_watermark = Some(
                    buffer
                        .last_flush_watermark
                        .map_or(watermark, |previous| previous.max(watermark)),
                );
            }
            for (key, count) in outcome.cap_drops {
                *buffer.drops_since_boot.entry(key).or_default() += count;
            }
            Ok(())
        }
        Err(error) => {
            let mut buffer = shared
                .buffer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            for event in events {
                buffer.count_drop(&event, "flushFailed");
            }
            buffer.restore_drop_counters(counters);
            Err(error)
        }
    }
}

fn telemetry_path(database_path: &Path) -> PathBuf {
    let mut name = database_path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "snapback".to_owned());
    name.push_str(".telemetry");
    database_path.with_file_name(name)
}

fn wall_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn sqlite_enqueue_sequence(sequence: u64) -> SnapbackResult<i64> {
    i64::try_from(sequence).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_TELEMETRY_SEQUENCE_EXHAUSTED",
            "telemetry",
            "telemetry enqueue sequence exceeded SQLite's integer range",
        )
    })
}

fn cap(value: &str, maximum: usize) -> String {
    if value.len() <= maximum {
        return value.to_owned();
    }
    let mut end = maximum;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_owned()
}

fn scrub_details(details: Option<Value>) -> Option<Value> {
    let Value::Object(input) = details? else {
        return None;
    };
    let legacy_allowed = BTreeSet::from([
        "attempt",
        "approverKey",
        "callerKey",
        "callerLane",
        "cause",
        "level",
        "message",
        "method",
        // @ref LLP 0167#honesty-requirements — latency-bearing HTTP spans
        //   retain the immutable egress profile snapshot that caused it.
        "networkProfile",
        "rawPath",
        "referer",
        "severity",
        "trigger",
        "userAgent",
    ]);
    let failure_shaped = input.contains_key("issue_eligible")
        || input.contains_key("failure_disposition")
        || input.contains_key("fp_hash");
    let mut output = Map::new();
    for (key, mut value) in input {
        if !legacy_allowed.contains(key.as_str())
            && !(failure_shaped && is_failure_detail_key(&key))
        {
            continue;
        }
        if failure_shaped {
            output.insert(key, value);
            continue;
        }
        cap_json_strings(
            &mut value,
            if key == "rawPath" {
                NAME_MAX_BYTES
            } else {
                2_000
            },
        );
        if key == "rawPath"
            && let Some(path) = value.as_str()
        {
            value = Value::String(path.split('?').next().unwrap_or(path).to_owned());
        }
        output.insert(key, value);
    }
    let mut value = Value::Object(output);
    if failure_shaped {
        // @ref LLP 0154#amendment-2026-08-02-error-classifier-vocabulary-and-failure-details-allocation —
        //   the closed failure allocator has already applied its canonical
        //   byte budget and per-field flags. Re-truncating here would make the
        //   carrier contradict those stamps.
        if serde_json::to_vec(&value).map_or(usize::MAX, |bytes| bytes.len()) <= DETAILS_MAX_BYTES {
            return Some(value);
        }
        // Preserve only the opt-in marker so the flush transaction records a
        // malformed eligible carrier instead of silently treating it as an
        // ordinary raw event.
        return Some(json!({ "issue_eligible": true }));
    }
    while serde_json::to_vec(&value).map_or(0, |bytes| bytes.len()) > DETAILS_MAX_BYTES {
        let Value::Object(map) = &mut value else {
            break;
        };
        let Some(last) = map.keys().next_back().cloned() else {
            break;
        };
        map.remove(&last);
    }
    Some(value)
}

fn cap_json_strings(value: &mut Value, maximum: usize) {
    match value {
        Value::String(text) => *text = cap(text, maximum),
        Value::Array(values) => {
            for value in values {
                cap_json_strings(value, maximum);
            }
        }
        Value::Object(values) => {
            for value in values.values_mut() {
                cap_json_strings(value, maximum);
            }
        }
        _ => {}
    }
}

fn log_severity(level: &str) -> DiagnosticSeverity {
    match level {
        "warn" | "warning" => DiagnosticSeverity::Warning,
        "error" => DiagnosticSeverity::Error,
        "fatal" => DiagnosticSeverity::Fatal,
        _ => DiagnosticSeverity::Info,
    }
}

fn severity_rank(severity: DiagnosticSeverity) -> u8 {
    match severity {
        DiagnosticSeverity::Info => 0,
        DiagnosticSeverity::Warning => 1,
        DiagnosticSeverity::Error => 2,
        DiagnosticSeverity::Fatal => 3,
    }
}

struct Store {
    path: Option<PathBuf>,
    path_identity: Option<TelemetryFileIdentity>,
    conn: Option<Connection>,
    generation: String,
    app_db_incarnation: String,
    identity: Option<TelemetryStoreIdentity>,
    config: TelemetryConfig,
    unclean_predecessor: bool,
    replacement_generation: Option<String>,
    #[cfg(test)]
    fail_before_commit: bool,
    #[cfg(test)]
    fail_rebind: bool,
    #[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
    fail_update_config: bool,
    #[cfg(test)]
    force_file_cap_estimator_miss: bool,
    #[cfg(test)]
    fail_postcommit_cap_recovery: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TelemetryFileIdentity {
    #[cfg(unix)]
    Unix { device: u64, inode: u64 },
    #[cfg(not(unix))]
    Present,
}

impl Store {
    #[cfg(test)]
    fn memory(app_db_incarnation: &str, config: TelemetryConfig) -> SnapbackResult<Self> {
        Self::memory_unbound(app_db_incarnation, config)
    }

    fn memory_unbound(app_db_incarnation: &str, config: TelemetryConfig) -> SnapbackResult<Self> {
        Self::memory_inner(app_db_incarnation, None, config)
    }

    fn memory_with_identity(
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        Self::memory_inner(app_db_incarnation, Some(identity), config)
    }

    fn memory_inner(
        app_db_incarnation: &str,
        identity: Option<TelemetryStoreIdentity>,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        config.validate()?;
        let conn = Connection::open_in_memory()?;
        configure_connection(&conn)?;
        create_schema(&conn)?;
        let generation = ids::mint(IdKind::Generation)?;
        initialize_meta(
            &conn,
            &generation,
            app_db_incarnation,
            identity.as_ref(),
            &config,
            wall_now_ms(),
        )?;
        Ok(Self {
            path: None,
            path_identity: None,
            conn: Some(conn),
            generation,
            app_db_incarnation: app_db_incarnation.to_owned(),
            identity,
            config,
            unclean_predecessor: false,
            replacement_generation: None,
            #[cfg(test)]
            fail_before_commit: false,
            #[cfg(test)]
            fail_rebind: false,
            #[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
            fail_update_config: false,
            #[cfg(test)]
            force_file_cap_estimator_miss: false,
            #[cfg(test)]
            fail_postcommit_cap_recovery: false,
        })
    }

    #[cfg(test)]
    fn open(
        path: PathBuf,
        app_db_incarnation: &str,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        Self::open_unbound(path, app_db_incarnation, config)
    }

    fn open_unbound(
        path: PathBuf,
        app_db_incarnation: &str,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        Self::open_inner(path, app_db_incarnation, None, config)
    }

    fn open_with_identity(
        path: PathBuf,
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        Self::open_inner(path, app_db_incarnation, Some(identity), config)
    }

    fn open_inner(
        path: PathBuf,
        app_db_incarnation: &str,
        identity: Option<TelemetryStoreIdentity>,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        config.validate()?;
        let mut store = Self {
            path: Some(path.clone()),
            path_identity: None,
            conn: None,
            generation: ids::mint(IdKind::Generation)?,
            app_db_incarnation: app_db_incarnation.to_owned(),
            identity,
            config,
            unclean_predecessor: false,
            replacement_generation: None,
            #[cfg(test)]
            fail_before_commit: false,
            #[cfg(test)]
            fail_rebind: false,
            #[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
            fail_update_config: false,
            #[cfg(test)]
            force_file_cap_estimator_miss: false,
            #[cfg(test)]
            fail_postcommit_cap_recovery: false,
        };
        if path.exists() {
            let conn = open_owner_only(&path)?;
            configure_connection(&conn)?;
            create_schema(&conn)?;
            store.path_identity = telemetry_file_identity(&path)?;
            store.conn = Some(conn);
            store.bind_existing_or_initialize(wall_now_ms())?;
        }
        Ok(store)
    }

    fn ensure_connection(&mut self, now_ms: i64) -> SnapbackResult<&mut Connection> {
        if self.conn.is_some()
            && let Some(path) = self.path.as_ref()
            && telemetry_file_identity(path)? != self.path_identity
        {
            // The operator may delete or atomically replace the sibling at
            // any time. Never keep writing an unlinked SQLite inode: release
            // the old connection and bind a fresh store on the next write.
            self.conn.take();
            self.path_identity = None;
            self.generation = ids::mint(IdKind::Generation)?;
            let conn = open_owner_only(path)?;
            configure_connection(&conn)?;
            create_schema(&conn)?;
            self.path_identity = telemetry_file_identity(path)?;
            self.conn = Some(conn);
            self.bind_replacement(now_ms)?;
            self.replacement_generation = Some(self.generation.clone());
        }
        if self.conn.is_none() {
            let conn = match &self.path {
                Some(path) => open_owner_only(path)?,
                None => Connection::open_in_memory()?,
            };
            configure_connection(&conn)?;
            create_schema(&conn)?;
            initialize_meta(
                &conn,
                &self.generation,
                &self.app_db_incarnation,
                self.identity.as_ref(),
                &self.config,
                now_ms,
            )?;
            if let Some(path) = self.path.as_ref() {
                self.path_identity = telemetry_file_identity(path)?;
            }
            self.conn = Some(conn);
        }
        Ok(self.conn.as_mut().expect("connection initialized"))
    }

    fn enqueue_sequence_seed(&self) -> SnapbackResult<u64> {
        let Some(conn) = self.conn.as_ref() else {
            // Preserve D1's absent-until-first-write behavior for a new file.
            return Ok(0);
        };
        let seed: i64 = conn.query_row(
            "SELECT max(
               enqueue_high_water,
               coalesce((SELECT max(resolved_seq) FROM error_groups WHERE generation=telemetry_meta.generation),0)
             ) FROM telemetry_meta WHERE singleton=1",
            [],
            |row| row.get(0),
        )?;
        u64::try_from(seed).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_TELEMETRY_SEQUENCE_INVALID",
                "telemetry",
                "telemetry enqueue high-water must be nonnegative",
            )
        })
    }

    fn bind_existing_or_initialize(&mut self, now_ms: i64) -> SnapbackResult<()> {
        let config = self.config.clone();
        let current_generation = self.generation.clone();
        let current_incarnation = self.app_db_incarnation.clone();
        let current_identity = self.identity.clone();
        let conn = self.conn.as_mut().expect("existing telemetry connection");
        type TelemetryMetaIdentityRow = (String, String, Option<String>, Option<String>, i64, i64);
        let row: Option<TelemetryMetaIdentityRow> = conn
            .query_row(
                "SELECT generation, app_db_incarnation, app_id, environment, observation_clock_ms, clean_shutdown FROM telemetry_meta WHERE singleton = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            )
            .optional()?;
        match row {
            None => initialize_meta(
                conn,
                &current_generation,
                &current_incarnation,
                current_identity.as_ref(),
                &config,
                now_ms,
            )?,
            Some((generation, incarnation, app_id, environment, high_water, clean_shutdown))
                if incarnation == current_incarnation
                    && match current_identity.as_ref() {
                        Some(identity) => {
                            app_id.as_deref() == Some(identity.app_id.as_str())
                                && environment.as_deref() == Some(identity.environment_id.as_str())
                        }
                        None => app_id.is_none() && environment.is_none(),
                    } =>
            {
                self.generation = generation;
                self.unclean_predecessor = clean_shutdown == 0;
                let clock = now_ms.max(high_water.saturating_add(1));
                advance_boundary(conn, &config, clock)?;
            }
            Some((
                _generation,
                _incarnation,
                _stored_app_id,
                _stored_environment,
                high_water,
                clean_shutdown,
            )) => {
                self.unclean_predecessor = clean_shutdown == 0;
                let generation = ids::mint(IdKind::Generation)?;
                let clock = now_ms.max(high_water.saturating_add(1));
                let app_id = current_identity
                    .as_ref()
                    .map(|identity| identity.app_id.as_str());
                let environment = current_identity
                    .as_ref()
                    .map(|identity| identity.environment_id.as_str());
                conn.execute(
                    "UPDATE telemetry_meta SET generation=?1, app_db_incarnation=?2, app_id=?3, environment=?4, max_days_mirror=?5, observation_clock_ms=?6, retention_floor=max(retention_floor, ?7), rollup_watermark_id=0, last_sweep_ms=0, aggregate_floor_hourly=0, aggregate_floor_daily=0, overflow_fold_count=0, classifier_disposition_mismatch_count=0, malformed_error_stamp_count=0, release_activation_floor_seq=0 WHERE singleton=1",
                    params![generation, current_incarnation, app_id, environment, config.max_days, clock, boundary_for(&config, clock)],
                )?;
                self.generation = generation;
            }
        }
        // Claim this boot after reading the predecessor's final disposition.
        // A process death leaves zero behind; only a fully drained final
        // producer is allowed to publish one.
        conn.execute(
            "UPDATE telemetry_meta SET clean_shutdown=0 WHERE singleton=1",
            [],
        )?;
        Ok(())
    }

    fn bind_replacement(&mut self, now_ms: i64) -> SnapbackResult<()> {
        let generation = self.generation.clone();
        let incarnation = self.app_db_incarnation.clone();
        let identity = self.identity.clone();
        let config = self.config.clone();
        let conn = self.conn.as_mut().expect("replacement connection");
        let row: Option<(i64, Option<String>, Option<String>)> = conn
            .query_row(
                "SELECT observation_clock_ms,app_id,environment FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        if let Some((high_water, _stored_app_id, _stored_environment)) = row {
            let clock = now_ms.max(high_water.saturating_add(1));
            let app_id = identity.as_ref().map(|identity| identity.app_id.as_str());
            let environment = identity
                .as_ref()
                .map(|identity| identity.environment_id.as_str());
            conn.execute(
                "UPDATE telemetry_meta SET generation=?1, app_db_incarnation=?2, app_id=?3, environment=?4, max_days_mirror=?5, observation_clock_ms=?6, retention_floor=max(retention_floor,?7), rollup_watermark_id=0, last_sweep_ms=0, aggregate_floor_hourly=0, aggregate_floor_daily=0, overflow_fold_count=0, classifier_disposition_mismatch_count=0, malformed_error_stamp_count=0, release_activation_floor_seq=0, clean_shutdown=0 WHERE singleton=1",
                params![generation, incarnation, app_id, environment, config.max_days, clock, boundary_for(&config, clock)],
            )?;
        } else {
            initialize_meta(
                conn,
                &generation,
                &incarnation,
                identity.as_ref(),
                &config,
                now_ms,
            )?;
        }
        Ok(())
    }

    /// Compose the store-scoped identity into one export record at the egress
    /// boundary. The eventual streaming exporter calls this while holding the
    /// same Store owner used for its visibility-view snapshot; event payloads
    /// cannot supply or override either identity field.
    ///
    /// @ref LLP 0154#d9--export-not-retention — exports are self-describing,
    ///   with app/environment read from the sibling's pinned meta authority.
    #[allow(dead_code)] // Consumed by the obs-03 streaming exporter lane.
    fn stamp_export_record(
        &mut self,
        record: &mut Map<String, Value>,
        now_ms: i64,
    ) -> SnapbackResult<()> {
        let (app_id, environment): (Option<String>, Option<String>) =
            self.ensure_connection(now_ms)?.query_row(
                "SELECT app_id,environment FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
        let (Some(app_id), Some(environment)) = (app_id, environment) else {
            return Err(SnapbackError::error(
                "SNAPBACK_TELEMETRY_IDENTITY_UNBOUND",
                "telemetry",
                "telemetry export requires a trusted app/environment store binding",
            ));
        };
        let identity = TelemetryStoreIdentity::new(app_id, environment)?;
        record.insert("appId".to_owned(), Value::String(identity.app_id));
        record.insert(
            "environment".to_owned(),
            Value::String(identity.environment_id),
        );
        Ok(())
    }

    fn mark_clean_shutdown(&mut self, now_ms: i64) -> SnapbackResult<()> {
        // max_days=0 is a true off switch: do not create a telemetry sibling
        // merely to record the absence of telemetry. An existing sibling can
        // still close its already-claimed ownership bit.
        if self.conn.is_none() && self.path.as_ref().is_some_and(|path| !path.exists()) {
            return Ok(());
        }
        self.ensure_connection(now_ms)?.execute(
            "UPDATE telemetry_meta SET clean_shutdown=1 WHERE singleton=1",
            [],
        )?;
        Ok(())
    }

    #[cfg(test)]
    fn rebind(&mut self, app_db_incarnation: &str, now_ms: i64) -> SnapbackResult<()> {
        self.rebind_with_optional_identity(app_db_incarnation, self.identity.clone(), now_ms)
    }

    #[cfg(test)]
    fn rebind_with_identity(
        &mut self,
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
        now_ms: i64,
    ) -> SnapbackResult<()> {
        self.rebind_with_optional_identity(app_db_incarnation, Some(identity), now_ms)
    }

    fn rebind_with_optional_identity(
        &mut self,
        app_db_incarnation: &str,
        identity: Option<TelemetryStoreIdentity>,
        now_ms: i64,
    ) -> SnapbackResult<()> {
        let generation = ids::mint(IdKind::Generation)?;
        let incarnation = app_db_incarnation.to_owned();
        let config = self.config.clone();
        if self.conn.is_none() && self.path.as_ref().is_some_and(|path| !path.exists()) {
            self.generation = generation;
            self.app_db_incarnation = incarnation;
            self.identity = identity;
            return Ok(());
        }
        #[cfg(test)]
        let fail_rebind = self.fail_rebind;
        let conn = self.ensure_connection(now_ms)?;
        let previous_clock: i64 = conn.query_row(
            "SELECT observation_clock_ms FROM telemetry_meta WHERE singleton=1",
            [],
            |row| row.get(0),
        )?;
        let clock = now_ms.max(previous_clock.saturating_add(1));
        #[cfg(test)]
        if fail_rebind {
            return Err(SnapbackError::error(
                "SNAPBACK_TELEMETRY_TEST_REBIND_FAILED",
                "telemetry",
                "injected telemetry rebind failure",
            ));
        }
        let app_id = identity.as_ref().map(|identity| identity.app_id.as_str());
        let environment = identity
            .as_ref()
            .map(|identity| identity.environment_id.as_str());
        conn.execute(
            "UPDATE telemetry_meta SET generation=?1, app_db_incarnation=?2, app_id=?3, environment=?4, max_days_mirror=?5, observation_clock_ms=?6, retention_floor=max(retention_floor, ?7), rollup_watermark_id=0, last_sweep_ms=0, aggregate_floor_hourly=0, aggregate_floor_daily=0, overflow_fold_count=0, classifier_disposition_mismatch_count=0, malformed_error_stamp_count=0, release_activation_floor_seq=0 WHERE singleton=1",
            params![generation, incarnation, app_id, environment, config.max_days, clock, boundary_for(&config, clock)],
        )?;
        self.generation = generation;
        self.app_db_incarnation = incarnation;
        self.identity = identity;
        self.replacement_generation = None;
        Ok(())
    }

    fn update_config(&mut self, config: TelemetryConfig, now_ms: i64) -> SnapbackResult<()> {
        config.validate()?;
        if self.conn.is_none() && self.path.as_ref().is_some_and(|path| !path.exists()) {
            self.config = config;
            return Ok(());
        }
        #[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
        let fail_update_config = std::mem::take(&mut self.fail_update_config);
        let conn = self.ensure_connection(now_ms)?;
        let high_water: i64 = conn.query_row(
            "SELECT observation_clock_ms FROM telemetry_meta WHERE singleton=1",
            [],
            |row| row.get(0),
        )?;
        let clock = now_ms.max(high_water);
        let floor = if config.max_days == 0 {
            clock
        } else {
            boundary_for(&config, clock)
        };
        #[cfg(any(test, feature = "test-support", feature = "remainder-tests"))]
        if fail_update_config {
            return Err(SnapbackError::error(
                "SNAPBACK_TELEMETRY_TEST_CONFIG_FAILED",
                "telemetry",
                "injected telemetry config failure",
            ));
        }
        conn.execute(
            "UPDATE telemetry_meta SET max_days_mirror=?1, retention_floor=max(retention_floor, ?2), observation_clock_ms=?3, hourly_days=?4, daily_days=?5 WHERE singleton=1",
            params![config.max_days, floor, clock, config.hourly_days, config.daily_days],
        )?;
        self.config = config;
        Ok(())
    }

    fn transition_error_issue(
        &mut self,
        transition: ErrorIssueTransition<'_>,
        now_ms: i64,
    ) -> SnapbackResult<ErrorTransitionResult> {
        let ErrorIssueTransition {
            issue,
            to,
            expect_seq,
            barrier,
            release,
            actor,
        } = transition;
        let generation = self.generation.clone();
        let conn = self.ensure_connection(now_ms)?;
        let tx = conn.transaction()?;
        let clock: i64 = tx.query_row(
            "SELECT observation_clock_ms FROM telemetry_meta WHERE singleton=1",
            [],
            |row| row.get(0),
        )?;
        let at_ms = now_ms.max(clock);
        let row: Option<(String, i64)> = tx
            .query_row(
                "SELECT state,state_seq FROM error_groups
                 WHERE generation=?1 AND issue=?2
                   AND (SELECT max_days_mirror FROM telemetry_meta WHERE singleton=1)>0
                   AND last_seen_ms > (
                     SELECT observation_clock_ms-daily_days*86400000
                     FROM telemetry_meta WHERE singleton=1
                   )",
                params![generation, issue],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((state, state_seq)) = row else {
            tx.commit()?;
            return Ok(ErrorTransitionResult::Missing {
                issue: issue.to_owned(),
            });
        };
        let state = ErrorIssueState::parse(&state).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_ERROR_GROUP_STATE_INVALID",
                "telemetry",
                "error group contains an invalid state",
            )
        })?;
        if state_seq != expect_seq {
            tx.commit()?;
            return Ok(ErrorTransitionResult::Conflict {
                issue: issue.to_owned(),
                state,
                state_seq,
            });
        }
        if !authored_transition_allowed(state, to) {
            tx.commit()?;
            return Ok(ErrorTransitionResult::Invalid {
                issue: issue.to_owned(),
                state,
                state_seq,
            });
        }
        if to == ErrorIssueState::Resolved {
            let barrier = barrier.ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_ERROR_RESOLVE_BARRIER_MISSING",
                    "telemetry",
                    "resolving an error issue requires an enqueue barrier",
                )
            })?;
            tx.execute(
                "UPDATE telemetry_meta SET enqueue_high_water=max(enqueue_high_water,?1) WHERE singleton=1",
                params![barrier],
            )?;
        }
        let next_seq = advance_error_state_seq(state_seq)?;
        let changed = tx.execute(
            "UPDATE error_groups SET
               state=?1,state_seq=?2,state_ms=?3,
               resolved_seq=CASE WHEN ?1='resolved' THEN ?4 ELSE resolved_seq END,
               resolved_release=CASE WHEN ?1='resolved' THEN ?5 ELSE resolved_release END
             WHERE generation=?6 AND issue=?7 AND state_seq=?8",
            params![
                to.as_str(),
                next_seq,
                at_ms,
                barrier,
                release,
                generation,
                issue,
                state_seq
            ],
        )?;
        if changed != 1 {
            return Err(SnapbackError::error(
                "SNAPBACK_ERROR_TRANSITION_SERIALIZATION_FAILED",
                "telemetry",
                "serialized issue transition lost its state sequence",
            ));
        }
        append_error_transition(
            &tx,
            &generation,
            ErrorTransitionRow {
                issue,
                seq: next_seq,
                from: state,
                to,
                at_ms,
                actor,
                release,
            },
        )?;
        enforce_global_transition_cap(&tx)?;
        tx.commit()?;
        Ok(ErrorTransitionResult::Applied {
            issue: issue.to_owned(),
            state: to,
            state_seq: next_seq,
        })
    }

    #[allow(dead_code)] // Consumed by the E1 typed issue-detail surface tranche.
    fn error_transition_history_floor(
        &mut self,
        issue: &str,
        now_ms: i64,
    ) -> SnapbackResult<Option<ErrorTransitionHistoryFloor>> {
        let conn = self.ensure_connection(now_ms)?;
        let row: Option<(i64, Option<i64>)> = conn
            .query_row(
                "SELECT g.state_seq,min(t.seq)
                 FROM error_groups_visible g
                 LEFT JOIN error_transitions_visible t
                   ON t.generation=g.generation AND t.issue=g.issue
                 WHERE g.issue=?1 GROUP BY g.generation,g.issue,g.state_seq",
                params![issue],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        Ok(row.map(|(state_seq, minimum)| ErrorTransitionHistoryFloor {
            floor_seq: minimum.unwrap_or(state_seq),
            history_truncated: state_seq > 0 && minimum.is_none_or(|minimum| minimum > 1),
        }))
    }

    fn resolve_errors_open_before(
        &mut self,
        release: &str,
        barrier: i64,
        now_ms: i64,
    ) -> SnapbackResult<ErrorBulkTransitionResult> {
        let generation = self.generation.clone();
        let conn = self.ensure_connection(now_ms)?;
        let tx = conn.transaction()?;
        let (clock, floor): (i64, i64) = tx.query_row(
            "SELECT observation_clock_ms,release_activation_floor_seq FROM telemetry_meta WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let activation_seq: Option<i64> = tx
            .query_row(
                "SELECT activated_seq FROM release_activations
                 WHERE generation=?1 AND release=?2 AND activated_seq>?3
                   AND (SELECT max_days_mirror FROM telemetry_meta WHERE singleton=1)>0
                   AND last_activated_ms>(
                     SELECT observation_clock_ms-daily_days*86400000
                     FROM telemetry_meta WHERE singleton=1
                   )",
                params![generation, release, floor],
                |row| row.get(0),
            )
            .optional()?;
        let Some(activation_seq) = activation_seq else {
            tx.commit()?;
            return Ok(ErrorBulkTransitionResult {
                release: release.to_owned(),
                activation_seq: None,
                activation_floor_seq: floor,
                known_release: false,
                rows: Vec::new(),
            });
        };
        let rows = {
            let mut statement = tx.prepare(
                "SELECT issue,state,state_seq FROM error_groups
                 WHERE generation=?1 AND last_seen_seq<?2
                   AND last_seen_ms>(
                     SELECT observation_clock_ms-daily_days*86400000
                     FROM telemetry_meta WHERE singleton=1
                   )
                 ORDER BY last_seen_seq,issue",
            )?;
            statement
                .query_map(params![generation, activation_seq], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        tx.execute(
            "UPDATE telemetry_meta SET enqueue_high_water=max(enqueue_high_water,?1) WHERE singleton=1",
            params![barrier],
        )?;
        let at_ms = now_ms.max(clock);
        let mut outcomes = Vec::with_capacity(rows.len());
        for (issue, state, state_seq) in rows {
            let state = ErrorIssueState::parse(&state).ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_ERROR_GROUP_STATE_INVALID",
                    "telemetry",
                    "error group contains an invalid state",
                )
            })?;
            if !matches!(state, ErrorIssueState::Open | ErrorIssueState::Regressed) {
                outcomes.push(ErrorTransitionResult::Invalid {
                    issue,
                    state,
                    state_seq,
                });
                continue;
            }
            let next_seq = advance_error_state_seq(state_seq)?;
            tx.execute(
                "UPDATE error_groups SET state='resolved',state_seq=?1,state_ms=?2,
                   resolved_seq=?3,resolved_release=?4
                 WHERE generation=?5 AND issue=?6 AND state_seq=?7",
                params![
                    next_seq, at_ms, barrier, release, generation, issue, state_seq
                ],
            )?;
            append_error_transition(
                &tx,
                &generation,
                ErrorTransitionRow {
                    issue: &issue,
                    seq: next_seq,
                    from: state,
                    to: ErrorIssueState::Resolved,
                    at_ms,
                    actor: "deploy-hook",
                    release: Some(release),
                },
            )?;
            outcomes.push(ErrorTransitionResult::Applied {
                issue,
                state: ErrorIssueState::Resolved,
                state_seq: next_seq,
            });
        }
        enforce_global_transition_cap(&tx)?;
        tx.commit()?;
        Ok(ErrorBulkTransitionResult {
            release: release.to_owned(),
            activation_seq: Some(activation_seq),
            activation_floor_seq: floor,
            known_release: true,
            rows: outcomes,
        })
    }

    fn flush(
        &mut self,
        events: Vec<Event>,
        mut drops: BTreeMap<String, u64>,
        now_ms: i64,
        force_maintenance: bool,
    ) -> SnapbackResult<FlushOutcome> {
        let config = self.config.clone();
        let drained_enqueue_high_water = events
            .iter()
            .map(|event| sqlite_enqueue_sequence(event.sequence))
            .collect::<SnapbackResult<Vec<_>>>()?
            .into_iter()
            .max();
        if config.max_days == 0 && events.is_empty() && drops.is_empty() {
            return Ok(FlushOutcome::default());
        }
        let path = self.path.clone();
        #[cfg(test)]
        let fail_before_commit = self.fail_before_commit;
        #[cfg(test)]
        let force_file_cap_estimator_miss = self.force_file_cap_estimator_miss;
        #[cfg(not(test))]
        let force_file_cap_estimator_miss = false;
        #[cfg(test)]
        let fail_postcommit_cap_recovery = self.fail_postcommit_cap_recovery;
        #[cfg(not(test))]
        let fail_postcommit_cap_recovery = false;
        self.ensure_connection(now_ms)?;
        let replacement_generation = self.replacement_generation.take();
        let mut replacement_drops = BTreeMap::new();
        let events = if replacement_generation.is_some() {
            for event in &events {
                let key = format!(
                    "{}:{}:storeReplaced",
                    event.admission.telemetry_kind,
                    event.priority.as_str()
                );
                *replacement_drops.entry(key).or_default() += 1;
            }
            Vec::new()
        } else {
            events
        };
        let conn = self.conn.as_mut().expect("connection initialized");
        let mut committed_cap_drops = replacement_drops.clone();
        let (events, cap_pressure) = if force_file_cap_estimator_miss {
            (events, false)
        } else if let Some(path) = path.as_ref() {
            select_events_under_file_cap(
                conn,
                path,
                config.file_size_cap_bytes,
                events,
                &mut committed_cap_drops,
            )?
        } else {
            (events, false)
        };
        merge_counter_maps(&mut drops, &committed_cap_drops);
        let tx = conn.transaction()?;
        // @ref LLP 0154#amendment-2026-08-02-internal-flush-witness-and-retained-evidence-carrier —
        //   C2's one boot settle write needs a production-owned transaction witness.
        // This sequence advances in the exact transaction that persists the
        // batch; unlike recorded timestamps, it cannot collapse two commits or
        // split one commit.
        let flush_sequence: i64 = tx.query_row(
            "UPDATE telemetry_meta SET flush_commit_sequence=flush_commit_sequence+1 WHERE singleton=1 RETURNING flush_commit_sequence",
            [],
            |row| row.get(0),
        )?;
        if let Some(enqueue_high_water) = drained_enqueue_high_water {
            // @ref LLP 0156#e13--the-issue-state-machine — durable sequence
            //   authority covers every drained admission, including rows the
            //   file-cap policy sheds before persistence.
            tx.execute(
                "UPDATE telemetry_meta SET enqueue_high_water=max(enqueue_high_water,?1) WHERE singleton=1",
                params![enqueue_high_water],
            )?;
        }
        let high_water: i64 = tx.query_row(
            "SELECT observation_clock_ms FROM telemetry_meta WHERE singleton=1",
            [],
            |row| row.get(0),
        )?;
        let stamp = now_ms.max(high_water.saturating_add(1));
        advance_boundary_tx(&tx, &config, stamp)?;

        let mut inserted = false;
        if !events.is_empty() && config.max_days > 0 {
            insert_batch(&tx, &events, stamp, flush_sequence)?;
            materialize_error_tracking(&tx, &events, &config, stamp)?;
            inserted = true;
        }
        merge_drop_counters(&tx, &drops)?;

        let last_sweep: i64 = tx.query_row(
            "SELECT last_sweep_ms FROM telemetry_meta WHERE singleton=1",
            [],
            |row| row.get(0),
        )?;
        let crossed_hour = hour_start(last_sweep) != hour_start(stamp);
        let swept = if force_maintenance
            || cap_pressure
            || last_sweep == 0
            || stamp.saturating_sub(last_sweep) >= config.sweep_interval_ms as i64
            || crossed_hour
        {
            maintain(&tx, &config, stamp)?
        } else {
            0
        };
        #[cfg(test)]
        if fail_before_commit {
            return Err(SnapbackError::error(
                "SNAPBACK_TELEMETRY_TEST_FLUSH_FAILED",
                "telemetry",
                "injected failure before telemetry flush commit",
            ));
        }
        let durable_enqueue_high_water: i64 = tx.query_row(
            "SELECT enqueue_high_water FROM telemetry_meta WHERE singleton=1",
            [],
            |row| row.get(0),
        )?;
        tx.commit()?;
        if swept >= LARGE_SWEEP_ROWS {
            // Large retention/compaction sweeps can strand many WAL frames.
            // Checkpoint and refresh planner statistics only after the sweep
            // transaction commits; there is no timer or second worker.
            let _ = conn.execute_batch("PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE);");
        }
        if let Some(path) = path.as_ref()
            && (cap_pressure || telemetry_file_bytes(path) > config.file_size_cap_bytes)
        {
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
            let recovery_drops =
                enforce_physical_file_cap(conn, path, &config, stamp, fail_postcommit_cap_recovery);
            merge_counter_maps(&mut committed_cap_drops, &recovery_drops);
        }
        Ok(FlushOutcome {
            watermark: inserted.then_some(stamp),
            cap_drops: committed_cap_drops,
            replacement_generation,
            enqueue_high_water: Some(u64::try_from(durable_enqueue_high_water).map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_TELEMETRY_SEQUENCE_INVALID",
                    "telemetry",
                    "telemetry enqueue high-water must be nonnegative",
                )
            })?),
        })
    }
}

fn telemetry_file_identity(path: &Path) -> SnapbackResult<Option<TelemetryFileIdentity>> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(telemetry_io(path, "stat", error)),
    };
    if !metadata.file_type().is_file() {
        return Err(telemetry_io(
            path,
            "validate",
            std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "telemetry store must be a regular file, not a symlink or special file",
            ),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        // SAFETY: geteuid has no preconditions and reads process identity.
        let effective_uid = unsafe { libc::geteuid() };
        if metadata.uid() != effective_uid || metadata.nlink() != 1 {
            return Err(telemetry_io(
                path,
                "validate",
                std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    format!(
                        "telemetry store must be owned by uid {effective_uid} and have exactly one hard link"
                    ),
                ),
            ));
        }
        Ok(Some(TelemetryFileIdentity::Unix {
            device: metadata.dev(),
            inode: metadata.ino(),
        }))
    }
    #[cfg(not(unix))]
    {
        let _ = metadata;
        Ok(Some(TelemetryFileIdentity::Present))
    }
}

fn open_owner_only(path: &Path) -> SnapbackResult<Connection> {
    let missing = match fs::symlink_metadata(path) {
        Ok(_) => false,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(error) => return Err(telemetry_io(path, "stat", error)),
    };
    if missing {
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
            options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        match options.open(path) {
            Ok(file) => drop(file),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(telemetry_io(path, "create", error)),
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt as _, OpenOptionsExt as _};
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)
            .map_err(|error| telemetry_io(path, "open", error))?;
        if file
            .metadata()
            .map_err(|error| telemetry_io(path, "stat", error))?
            .nlink()
            != 1
        {
            return Err(telemetry_io(
                path,
                "validate",
                std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "telemetry store must have exactly one hard link",
                ),
            ));
        }
        crate::secure_file::validate_and_repair_owner_only(&file)
            .map_err(|error| telemetry_io(path, "validate", error))?;
    }
    let before = telemetry_file_identity(path)?.ok_or_else(|| {
        telemetry_io(
            path,
            "open",
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "telemetry store disappeared before SQLite open",
            ),
        )
    })?;
    let sqlite_path =
        fs::canonicalize(path).map_err(|error| telemetry_io(path, "canonicalize", error))?;
    let connection = Connection::open_with_flags(
        &sqlite_path,
        OpenFlags::default() | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    let after = telemetry_file_identity(path)?.ok_or_else(|| {
        telemetry_io(
            path,
            "open",
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "telemetry store disappeared during SQLite open",
            ),
        )
    })?;
    if before != after {
        return Err(telemetry_io(
            path,
            "open",
            std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "telemetry store path changed during SQLite open",
            ),
        ));
    }
    Ok(connection)
}

fn telemetry_io(path: &Path, operation: &str, error: std::io::Error) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_TELEMETRY_STORE_IO",
        "telemetry",
        format!("telemetry store {operation} failed for {}", path.display()),
    )
    .with_details(json!({ "error": error.to_string() }))
}

fn configure_connection(conn: &Connection) -> SnapbackResult<()> {
    conn.busy_timeout(Duration::from_secs(5))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;",
    )?;
    Ok(())
}

fn create_schema(conn: &Connection) -> SnapbackResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS telemetry_meta (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          generation TEXT NOT NULL,
          app_db_incarnation TEXT NOT NULL,
          app_id TEXT,
          environment TEXT,
          max_days_mirror INTEGER NOT NULL,
          retention_floor INTEGER NOT NULL,
          observation_clock_ms INTEGER NOT NULL,
          aggregate_floor_hourly INTEGER NOT NULL,
          aggregate_floor_daily INTEGER NOT NULL,
          rollup_watermark_id INTEGER NOT NULL,
          flush_commit_sequence INTEGER NOT NULL DEFAULT 0,
          enqueue_high_water INTEGER NOT NULL DEFAULT 0,
          overflow_fold_count INTEGER NOT NULL DEFAULT 0,
          classifier_disposition_mismatch_count INTEGER NOT NULL DEFAULT 0,
          malformed_error_stamp_count INTEGER NOT NULL DEFAULT 0,
          release_activation_floor_seq INTEGER NOT NULL DEFAULT 0,
          rollout_from_version INTEGER,
          rollout_to_version INTEGER,
          rollout_started_ms INTEGER,
          rollout_expires_ms INTEGER,
          last_sweep_ms INTEGER NOT NULL,
          drop_counters_lifetime TEXT NOT NULL,
          hourly_days INTEGER NOT NULL,
          daily_days INTEGER NOT NULL,
          clean_shutdown INTEGER NOT NULL DEFAULT 1 CHECK (clean_shutdown IN (0, 1))
        );
        CREATE TABLE IF NOT EXISTS telemetry_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          observation TEXT NOT NULL,
          phase TEXT NOT NULL,
          generation TEXT NOT NULL,
          class_v INTEGER NOT NULL,
          ts_ms INTEGER NOT NULL,
          recorded_ts_ms INTEGER NOT NULL,
          flush_sequence INTEGER NOT NULL DEFAULT 0,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          status INTEGER,
          duration_ms REAL,
          subject TEXT CHECK (subject IS NULL),
          code TEXT,
          correlation TEXT,
          release TEXT,
          details TEXT
        );
        CREATE INDEX IF NOT EXISTS telemetry_events_order
          ON telemetry_events(generation, recorded_ts_ms, id);
        CREATE TABLE IF NOT EXISTS telemetry_rollup_hourly (
          generation TEXT NOT NULL,
          bucket_start_ms INTEGER NOT NULL,
          bucket_end_ms INTEGER NOT NULL,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          count INTEGER NOT NULL,
          error_count INTEGER NOT NULL,
          latency_histogram TEXT NOT NULL,
          coverage_start_ms INTEGER NOT NULL,
          coverage_end_ms INTEGER NOT NULL,
          watermark_id INTEGER NOT NULL,
          finalized INTEGER NOT NULL,
          folded_count INTEGER NOT NULL,
          PRIMARY KEY(generation, bucket_start_ms, kind, name)
        );
        CREATE TABLE IF NOT EXISTS telemetry_rollup_daily (
          generation TEXT NOT NULL,
          bucket_start_ms INTEGER NOT NULL,
          bucket_end_ms INTEGER NOT NULL,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          count INTEGER NOT NULL,
          error_count INTEGER NOT NULL,
          latency_histogram TEXT NOT NULL,
          coverage_start_ms INTEGER NOT NULL,
          coverage_end_ms INTEGER NOT NULL,
          watermark_id INTEGER NOT NULL,
          folded_count INTEGER NOT NULL,
          PRIMARY KEY(generation, bucket_start_ms, kind, name)
        );
        CREATE TABLE IF NOT EXISTS telemetry_caller_rollup_hourly (
          generation TEXT NOT NULL,
          bucket_start_ms INTEGER NOT NULL,
          bucket_end_ms INTEGER NOT NULL,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          caller_lane TEXT NOT NULL
            CHECK(caller_lane IN ('anonymous','declared','integration','link','first-party')),
          caller_key TEXT NOT NULL,
          count INTEGER NOT NULL,
          error_count INTEGER NOT NULL,
          latency_histogram TEXT NOT NULL,
          coverage_start_ms INTEGER NOT NULL,
          coverage_end_ms INTEGER NOT NULL,
          watermark_id INTEGER NOT NULL,
          finalized INTEGER NOT NULL,
          folded_count INTEGER NOT NULL,
          PRIMARY KEY(generation, bucket_start_ms, kind, name, caller_lane, caller_key)
        );
        CREATE TABLE IF NOT EXISTS telemetry_caller_rollup_daily (
          generation TEXT NOT NULL,
          bucket_start_ms INTEGER NOT NULL,
          bucket_end_ms INTEGER NOT NULL,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          caller_lane TEXT NOT NULL
            CHECK(caller_lane IN ('anonymous','declared','integration','link','first-party')),
          caller_key TEXT NOT NULL,
          count INTEGER NOT NULL,
          error_count INTEGER NOT NULL,
          latency_histogram TEXT NOT NULL,
          coverage_start_ms INTEGER NOT NULL,
          coverage_end_ms INTEGER NOT NULL,
          watermark_id INTEGER NOT NULL,
          folded_count INTEGER NOT NULL,
          PRIMARY KEY(generation, bucket_start_ms, kind, name, caller_lane, caller_key)
        );
        CREATE TABLE IF NOT EXISTS error_groups (
          issue TEXT NOT NULL,
          generation TEXT NOT NULL,
          fp_version INTEGER NOT NULL,
          fp_hash BLOB NOT NULL CHECK(length(fp_hash)=16),
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          code TEXT,
          error_class TEXT,
          status_class INTEGER,
          subsystem TEXT,
          failure_disposition TEXT NOT NULL,
          classifier_v INTEGER NOT NULL,
          first_seen_ms INTEGER NOT NULL,
          last_seen_ms INTEGER NOT NULL,
          first_seen_seq INTEGER NOT NULL,
          last_seen_seq INTEGER NOT NULL,
          last_regressed_seq INTEGER,
          first_release TEXT,
          last_release TEXT,
          count INTEGER NOT NULL,
          suppressed_cooldown_count INTEGER NOT NULL DEFAULT 0,
          suppressed_rollout_count INTEGER NOT NULL DEFAULT 0,
          exemplar_depth_drop_count INTEGER NOT NULL DEFAULT 0,
          exemplar_byte_drop_count INTEGER NOT NULL DEFAULT 0,
          exemplar_flush_drop_count INTEGER NOT NULL DEFAULT 0,
          state TEXT NOT NULL CHECK(state IN ('open','resolved','ignored','regressed')),
          state_seq INTEGER NOT NULL DEFAULT 0,
          state_ms INTEGER,
          resolved_seq INTEGER,
          resolved_release TEXT,
          PRIMARY KEY(generation, issue),
          UNIQUE(generation, fp_version, fp_hash)
        );
        CREATE INDEX IF NOT EXISTS error_groups_horizon
          ON error_groups(generation, last_seen_ms);
        CREATE TABLE IF NOT EXISTS error_exemplars (
          issue TEXT NOT NULL,
          generation TEXT NOT NULL,
          observation TEXT NOT NULL,
          recorded_ts_ms INTEGER NOT NULL,
          recorded_seq INTEGER NOT NULL,
          release TEXT,
          title_template TEXT,
          template_truncated INTEGER NOT NULL DEFAULT 0 CHECK(template_truncated IN (0,1)),
          stack_head TEXT,
          stack_truncated INTEGER NOT NULL DEFAULT 0 CHECK(stack_truncated IN (0,1)),
          PRIMARY KEY(generation, issue, observation),
          FOREIGN KEY(generation, issue) REFERENCES error_groups(generation, issue) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS error_exemplars_order
          ON error_exemplars(generation, issue, recorded_seq);
        CREATE TABLE IF NOT EXISTS error_transitions (
          generation TEXT NOT NULL,
          issue TEXT NOT NULL,
          seq INTEGER NOT NULL,
          from_state TEXT NOT NULL,
          to_state TEXT NOT NULL,
          at_ms INTEGER NOT NULL,
          actor TEXT NOT NULL CHECK(actor IN ('admin','flusher','deploy-hook')),
          release TEXT,
          PRIMARY KEY(generation, issue, seq),
          FOREIGN KEY(generation, issue) REFERENCES error_groups(generation, issue) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS release_activations (
          generation TEXT NOT NULL,
          release TEXT NOT NULL,
          activated_ms INTEGER NOT NULL,
          activated_seq INTEGER NOT NULL,
          last_activated_ms INTEGER NOT NULL,
          last_activated_seq INTEGER NOT NULL,
          PRIMARY KEY(generation, release)
        );
        CREATE INDEX IF NOT EXISTS release_activations_order
          ON release_activations(generation, activated_seq);
        DROP VIEW IF EXISTS telemetry_events_visible;
        CREATE VIEW telemetry_events_visible AS
          SELECT e.id, e.observation, e.phase, e.generation, e.class_v,
                 e.ts_ms, e.recorded_ts_ms, e.kind, e.name, e.status,
                 e.duration_ms, e.subject, e.code, e.correlation, e.release,
                 e.details
          FROM telemetry_events e, telemetry_meta m
          WHERE m.singleton=1
            AND m.max_days_mirror > 0
            AND e.generation=m.generation
            AND e.recorded_ts_ms > max(
              m.observation_clock_ms - m.max_days_mirror * 86400000,
              m.retention_floor
            );
        DROP VIEW IF EXISTS telemetry_rollup_visible;
        CREATE VIEW telemetry_rollup_visible AS
          SELECT 'hourly' AS tier, h.generation, h.bucket_start_ms, h.bucket_end_ms,
                 h.kind, h.name, h.count, h.error_count, h.latency_histogram,
                 h.coverage_start_ms, h.coverage_end_ms, h.watermark_id,
                 h.folded_count
          FROM telemetry_rollup_hourly h, telemetry_meta m
          WHERE m.singleton=1 AND m.max_days_mirror > 0
            AND h.generation=m.generation
            AND h.bucket_end_ms > max(
              m.aggregate_floor_hourly,
              m.observation_clock_ms - m.hourly_days * 86400000
            )
          UNION ALL
          SELECT 'daily', d.generation, d.bucket_start_ms, d.bucket_end_ms,
                 d.kind, d.name, d.count, d.error_count, d.latency_histogram,
                 d.coverage_start_ms, d.coverage_end_ms, d.watermark_id,
                 d.folded_count
          FROM telemetry_rollup_daily d, telemetry_meta m
          WHERE m.singleton=1 AND m.max_days_mirror > 0
            AND d.generation=m.generation
            AND d.bucket_end_ms > max(
              m.aggregate_floor_daily,
              m.observation_clock_ms - m.daily_days * 86400000
            );
        DROP VIEW IF EXISTS telemetry_caller_rollup_visible;
        CREATE VIEW telemetry_caller_rollup_visible AS
          SELECT 'hourly' AS tier, h.generation, h.bucket_start_ms, h.bucket_end_ms,
                 h.kind, h.name, h.caller_lane, h.caller_key, h.count, h.error_count,
                 h.latency_histogram, h.coverage_start_ms, h.coverage_end_ms,
                 h.watermark_id, h.folded_count
          FROM telemetry_caller_rollup_hourly h, telemetry_meta m
          WHERE m.singleton=1 AND m.max_days_mirror > 0
            AND h.generation=m.generation
            AND h.bucket_end_ms > max(
              m.aggregate_floor_hourly,
              m.observation_clock_ms - m.hourly_days * 86400000
            )
          UNION ALL
          SELECT 'daily', d.generation, d.bucket_start_ms, d.bucket_end_ms,
                 d.kind, d.name, d.caller_lane, d.caller_key, d.count, d.error_count,
                 d.latency_histogram, d.coverage_start_ms, d.coverage_end_ms,
                 d.watermark_id, d.folded_count
          FROM telemetry_caller_rollup_daily d, telemetry_meta m
          WHERE m.singleton=1 AND m.max_days_mirror > 0
            AND d.generation=m.generation
            AND d.bucket_end_ms > max(
              m.aggregate_floor_daily,
              m.observation_clock_ms - m.daily_days * 86400000
            );
        ",
    )?;
    let meta_columns = conn
        .prepare("PRAGMA table_info(telemetry_meta)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<BTreeSet<_>, _>>()?;
    if !meta_columns.contains("clean_shutdown") {
        // Existing stores predate crash ownership. Defaulting their first
        // observation to clean avoids fabricating an unclean predecessor at
        // upgrade; this boot immediately claims the bit afterward.
        conn.execute(
            "ALTER TABLE telemetry_meta ADD COLUMN clean_shutdown INTEGER NOT NULL DEFAULT 1 CHECK (clean_shutdown IN (0, 1))",
            [],
        )?;
    }
    // @ref LLP 0154#d1--telemetry-store-a-sibling-sqlite-database-generation-bound —
    //   identity is pinned once in meta, never copied from an event payload.
    //   NULL migration values force an explicitly identified boot down its
    //   generation-rotating rebind path, so legacy rows cannot be relabeled.
    if !meta_columns.contains("app_id") {
        conn.execute("ALTER TABLE telemetry_meta ADD COLUMN app_id TEXT", [])?;
    }
    if !meta_columns.contains("environment") {
        conn.execute("ALTER TABLE telemetry_meta ADD COLUMN environment TEXT", [])?;
    }
    if !meta_columns.contains("flush_commit_sequence") {
        conn.execute(
            "ALTER TABLE telemetry_meta ADD COLUMN flush_commit_sequence INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    for (column, definition) in [
        ("enqueue_high_water", "INTEGER NOT NULL DEFAULT 0"),
        ("overflow_fold_count", "INTEGER NOT NULL DEFAULT 0"),
        (
            "classifier_disposition_mismatch_count",
            "INTEGER NOT NULL DEFAULT 0",
        ),
        ("malformed_error_stamp_count", "INTEGER NOT NULL DEFAULT 0"),
        ("release_activation_floor_seq", "INTEGER NOT NULL DEFAULT 0"),
        ("rollout_from_version", "INTEGER"),
        ("rollout_to_version", "INTEGER"),
        ("rollout_started_ms", "INTEGER"),
        ("rollout_expires_ms", "INTEGER"),
    ] {
        if !meta_columns.contains(column) {
            conn.execute(
                &format!("ALTER TABLE telemetry_meta ADD COLUMN {column} {definition}"),
                [],
            )?;
        }
    }
    let event_columns = conn
        .prepare("PRAGMA table_info(telemetry_events)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<BTreeSet<_>, _>>()?;
    if !event_columns.contains("release") {
        conn.execute("ALTER TABLE telemetry_events ADD COLUMN release TEXT", [])?;
    }
    if !event_columns.contains("flush_sequence") {
        conn.execute(
            "ALTER TABLE telemetry_events ADD COLUMN flush_sequence INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    conn.execute_batch(
        "
        DROP VIEW IF EXISTS error_groups_visible;
        CREATE VIEW error_groups_visible AS
          SELECT g.*
          FROM error_groups g, telemetry_meta m
          WHERE m.singleton=1
            AND m.max_days_mirror > 0
            AND g.generation=m.generation
            AND g.last_seen_ms > m.observation_clock_ms - m.daily_days * 86400000;
        DROP VIEW IF EXISTS error_exemplars_visible;
        CREATE VIEW error_exemplars_visible AS
          SELECT x.*
          FROM error_exemplars x
          JOIN error_groups g ON g.generation=x.generation AND g.issue=x.issue
          JOIN telemetry_meta m ON m.singleton=1
          WHERE m.max_days_mirror > 0
            AND x.generation=m.generation
            AND g.last_seen_ms > m.observation_clock_ms - m.daily_days * 86400000
            AND x.recorded_ts_ms > max(
              m.observation_clock_ms - m.max_days_mirror * 86400000,
              m.retention_floor
            );
        DROP VIEW IF EXISTS error_transitions_visible;
        CREATE VIEW error_transitions_visible AS
          SELECT t.*
          FROM error_transitions t
          JOIN error_groups g ON g.generation=t.generation AND g.issue=t.issue
          JOIN telemetry_meta m ON m.singleton=1
          WHERE m.max_days_mirror > 0
            AND t.generation=m.generation
            AND g.last_seen_ms > m.observation_clock_ms - m.daily_days * 86400000;
        DROP VIEW IF EXISTS release_activations_visible;
        CREATE VIEW release_activations_visible AS
          SELECT a.*
          FROM release_activations a, telemetry_meta m
          WHERE m.singleton=1
            AND m.max_days_mirror > 0
            AND a.generation=m.generation
            AND a.last_activated_ms > m.observation_clock_ms - m.daily_days * 86400000
            AND a.activated_seq > m.release_activation_floor_seq;
        ",
    )?;
    Ok(())
}

fn initialize_meta(
    conn: &Connection,
    generation: &str,
    incarnation: &str,
    identity: Option<&TelemetryStoreIdentity>,
    config: &TelemetryConfig,
    now_ms: i64,
) -> SnapbackResult<()> {
    let floor = if config.max_days == 0 {
        now_ms
    } else {
        boundary_for(config, now_ms)
    };
    conn.execute(
        "INSERT OR IGNORE INTO telemetry_meta(singleton,generation,app_db_incarnation,app_id,environment,max_days_mirror,retention_floor,observation_clock_ms,aggregate_floor_hourly,aggregate_floor_daily,rollup_watermark_id,last_sweep_ms,drop_counters_lifetime,hourly_days,daily_days,clean_shutdown) VALUES(1,?1,?2,?3,?4,?5,?6,?7,0,0,0,0,'{}',?8,?9,0)",
        params![generation, incarnation, identity.map(|identity| identity.app_id.as_str()), identity.map(|identity| identity.environment_id.as_str()), config.max_days, floor, now_ms, config.hourly_days, config.daily_days],
    )?;
    Ok(())
}

fn advance_boundary(conn: &Connection, config: &TelemetryConfig, clock: i64) -> SnapbackResult<()> {
    let floor = if config.max_days == 0 {
        clock
    } else {
        boundary_for(config, clock)
    };
    conn.execute(
        "UPDATE telemetry_meta SET observation_clock_ms=?1,max_days_mirror=?2,retention_floor=max(retention_floor,?3),hourly_days=?4,daily_days=?5 WHERE singleton=1",
        params![clock, config.max_days, floor, config.hourly_days, config.daily_days],
    )?;
    Ok(())
}

fn advance_boundary_tx(
    tx: &Transaction<'_>,
    config: &TelemetryConfig,
    clock: i64,
) -> SnapbackResult<()> {
    let floor = if config.max_days == 0 {
        clock
    } else {
        boundary_for(config, clock)
    };
    tx.execute(
        "UPDATE telemetry_meta SET observation_clock_ms=?1,max_days_mirror=?2,retention_floor=max(retention_floor,?3),hourly_days=?4,daily_days=?5 WHERE singleton=1",
        params![clock, config.max_days, floor, config.hourly_days, config.daily_days],
    )?;
    Ok(())
}

fn boundary_for(config: &TelemetryConfig, clock: i64) -> i64 {
    clock.saturating_sub(i64::from(config.max_days).saturating_mul(DAY_MS))
}

fn insert_batch(
    tx: &Transaction<'_>,
    events: &[Event],
    stamp: i64,
    flush_sequence: i64,
) -> SnapbackResult<()> {
    let mut sql = String::from(
        "INSERT INTO telemetry_events(observation,phase,generation,class_v,ts_ms,recorded_ts_ms,flush_sequence,kind,name,status,duration_ms,subject,code,correlation,release,details) VALUES ",
    );
    let mut values = Vec::<rusqlite::types::Value>::with_capacity(events.len() * 15);
    for (index, event) in events.iter().enumerate() {
        if index > 0 {
            sql.push(',');
        }
        sql.push_str("(?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?)");
        values.extend([
            event.admission.observation_id.clone().into(),
            event.phase.as_str().to_owned().into(),
            event.generation.clone().into(),
            i64::from(event.admission.registry_version).into(),
            event.ts_ms.into(),
            stamp.into(),
            flush_sequence.into(),
            event.admission.telemetry_kind.clone().into(),
            event.name.clone().into(),
            event.status.into(),
            event.duration_ms.into(),
            event.code.clone().into(),
            event.correlation.clone().into(),
            event.release.clone().into(),
            event
                .details
                .as_ref()
                .and_then(|value| serde_json::to_string(value).ok())
                .into(),
        ]);
    }
    tx.execute(&sql, params_from_iter(values))?;
    Ok(())
}

#[derive(Clone, Debug)]
struct PersistedErrorGroup {
    issue: String,
    failure_disposition: String,
    state: ErrorIssueState,
    state_seq: i64,
    resolved_seq: Option<i64>,
}

fn error_group_boundary(config: &TelemetryConfig, clock: i64) -> i64 {
    clock.saturating_sub(i64::from(config.daily_days).saturating_mul(DAY_MS))
}

/// Materialize only already-decided eligible stamps. Raw telemetry insertion,
/// group counts, exemplars, activations, and regression edges share the one
/// OBS flush transaction, so a crash cannot split their evidence.
///
/// @ref LLP 0156#e11--fingerprint-at-the-seam-group-in-the-flush-transaction —
///   classification and fingerprinting are emission-seam decisions; the
///   flusher validates and folds their closed stamps without recomputation.
fn materialize_error_tracking(
    tx: &Transaction<'_>,
    events: &[Event],
    config: &TelemetryConfig,
    stamp: i64,
) -> SnapbackResult<()> {
    let generation: String = tx.query_row(
        "SELECT generation FROM telemetry_meta WHERE singleton=1",
        [],
        |row| row.get(0),
    )?;
    let horizon = error_group_boundary(config, stamp);
    sweep_error_groups(tx, &generation, horizon)?;
    sweep_release_activations(tx, &generation, horizon)?;

    for event in events {
        if event.generation == generation
            && event.admission.telemetry_kind == "lifecycle"
            && event.name == "release_activation"
            && let Some(release) = event.release.as_deref()
        {
            upsert_release_activation(tx, &generation, release, event, stamp)?;
        }
    }
    enforce_release_activation_cap(tx, &generation)?;

    let mut exemplar_attempts = BTreeMap::<String, usize>::new();
    for event in events {
        if event.generation != generation {
            continue;
        }
        let failure = match materialize_failure_stamp_v1(event.details.as_ref()) {
            FailureStampMaterializationV1::NotEligible => continue,
            FailureStampMaterializationV1::MalformedEligible => {
                tx.execute(
                    "UPDATE telemetry_meta SET malformed_error_stamp_count=malformed_error_stamp_count+1 WHERE singleton=1",
                    [],
                )?;
                continue;
            }
            FailureStampMaterializationV1::Eligible(failure) => failure,
        };
        fold_eligible_failure(
            tx,
            &generation,
            event,
            &failure,
            stamp,
            &mut exemplar_attempts,
        )?;
    }
    enforce_global_transition_cap(tx)?;
    Ok(())
}

fn persisted_error_group(
    tx: &Transaction<'_>,
    generation: &str,
    failure: &MaterializedFailureStampV1,
) -> SnapbackResult<Option<PersistedErrorGroup>> {
    tx.query_row(
        "SELECT issue,failure_disposition,state,state_seq,resolved_seq
         FROM error_groups
         WHERE generation=?1 AND fp_version=?2 AND fp_hash=?3",
        params![
            generation,
            i64::from(failure.fingerprint_version),
            failure.fingerprint_hash.as_slice()
        ],
        |row| {
            let state = row.get::<_, String>(2)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                state,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<i64>>(4)?,
            ))
        },
    )
    .optional()?
    .map(
        |(issue, failure_disposition, state, state_seq, resolved_seq)| {
            let state = ErrorIssueState::parse(&state).ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_ERROR_GROUP_STATE_INVALID",
                    "telemetry",
                    "error group contains an invalid state",
                )
            })?;
            Ok(PersistedErrorGroup {
                issue,
                failure_disposition,
                state,
                state_seq,
                resolved_seq,
            })
        },
    )
    .transpose()
}

fn fold_eligible_failure(
    tx: &Transaction<'_>,
    generation: &str,
    event: &Event,
    failure: &MaterializedFailureStampV1,
    stamp: i64,
    exemplar_attempts: &mut BTreeMap<String, usize>,
) -> SnapbackResult<()> {
    let sequence = sqlite_enqueue_sequence(event.sequence)?;
    let disposition = failure.failure_disposition.as_str();
    let mut group = persisted_error_group(tx, generation, failure)?;
    if let Some(existing) = group.as_ref()
        && existing.failure_disposition != disposition
    {
        tx.execute(
            "UPDATE telemetry_meta SET classifier_disposition_mismatch_count=classifier_disposition_mismatch_count+1 WHERE singleton=1",
            [],
        )?;
        return Ok(());
    }

    if group.is_none() {
        let count: i64 = tx.query_row(
            "SELECT count(*) FROM error_groups WHERE generation=?1",
            params![generation],
            |row| row.get(0),
        )?;
        if count >= ERROR_GROUP_CAP as i64 {
            tx.execute(
                "UPDATE telemetry_meta SET overflow_fold_count=overflow_fold_count+1 WHERE singleton=1",
                [],
            )?;
            return Ok(());
        }
        let issue = ids::mint(IdKind::Issue)?;
        let rollout_suppressed = rollout_predecessor_exists(tx, generation, event, failure)?;
        let code = if failure.failure_disposition == FailureDispositionV1::AppRefusal {
            failure.app_code.as_deref()
        } else {
            failure.platform_code.as_deref()
        };
        let status_class = failure.status_class;
        tx.execute(
            "INSERT INTO error_groups(
               issue,generation,fp_version,fp_hash,kind,name,code,error_class,status_class,subsystem,
               failure_disposition,classifier_v,first_seen_ms,last_seen_ms,first_seen_seq,last_seen_seq,
               first_release,last_release,count,suppressed_rollout_count,state,state_seq
             ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13,?14,?14,?15,?15,1,?16,'open',0)",
            params![
                issue,
                generation,
                i64::from(failure.fingerprint_version),
                failure.fingerprint_hash.as_slice(),
                event.admission.telemetry_kind,
                event.name,
                code,
                failure.error_class,
                status_class,
                failure.subsystem,
                disposition,
                i64::from(failure.classifier_version),
                stamp,
                sequence,
                event.release,
                i64::from(rollout_suppressed),
            ],
        )?;
        group = Some(PersistedErrorGroup {
            issue,
            failure_disposition: disposition.to_owned(),
            state: ErrorIssueState::Open,
            state_seq: 0,
            resolved_seq: None,
        });
    } else if let Some(existing) = group.as_ref() {
        tx.execute(
            "UPDATE error_groups
             SET last_seen_ms=max(last_seen_ms,?1), last_seen_seq=max(last_seen_seq,?2),
                 last_release=?3, count=count+1
             WHERE generation=?4 AND issue=?5",
            params![stamp, sequence, event.release, generation, existing.issue],
        )?;
    }

    let mut group = group.expect("group inserted or loaded");
    if group.state == ErrorIssueState::Resolved
        && group.resolved_seq.is_some_and(|barrier| sequence > barrier)
    {
        let next_seq = advance_error_state_seq(group.state_seq)?;
        let changed = tx.execute(
            "UPDATE error_groups
             SET state='regressed',state_seq=?1,state_ms=?2,last_regressed_seq=?3
             WHERE generation=?4 AND issue=?5 AND state='resolved' AND state_seq=?6",
            params![
                next_seq,
                stamp,
                sequence,
                generation,
                group.issue,
                group.state_seq
            ],
        )?;
        if changed == 1 {
            append_error_transition(
                tx,
                generation,
                ErrorTransitionRow {
                    issue: &group.issue,
                    seq: next_seq,
                    from: ErrorIssueState::Resolved,
                    to: ErrorIssueState::Regressed,
                    at_ms: stamp,
                    actor: "flusher",
                    release: event.release.as_deref(),
                },
            )?;
            group.state = ErrorIssueState::Regressed;
            group.state_seq = next_seq;
        }
    }
    insert_error_exemplar(
        tx,
        generation,
        &group.issue,
        event,
        failure,
        stamp,
        exemplar_attempts,
    )?;
    Ok(())
}

fn rollout_predecessor_exists(
    tx: &Transaction<'_>,
    generation: &str,
    event: &Event,
    failure: &MaterializedFailureStampV1,
) -> SnapbackResult<bool> {
    type Rollout = (Option<i64>, Option<i64>, Option<i64>, Option<i64>);
    let rollout: Rollout = tx.query_row(
        "SELECT rollout_from_version,rollout_to_version,rollout_started_ms,rollout_expires_ms
         FROM telemetry_meta WHERE singleton=1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    let (from, to, started, expires) = match rollout {
        (None, None, None, None) => return Ok(false),
        (Some(from), Some(to), Some(started), Some(expires))
            if from > 0 && to > 0 && from != to && started < expires =>
        {
            (from, to, started, expires)
        }
        _ => {
            return Err(SnapbackError::error(
                "SNAPBACK_ERROR_ROLLOUT_INVALID",
                "telemetry",
                "fingerprint rollout bounds must be complete and ordered",
            ));
        }
    };
    let Some((predecessor_version, predecessor_hash)) = failure.predecessor_fingerprint else {
        return Ok(false);
    };
    if i64::from(failure.fingerprint_version) != to
        || i64::from(predecessor_version) != from
        || event.ts_ms < started
        || event.ts_ms >= expires
    {
        return Ok(false);
    }
    let exists: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM error_groups
           WHERE generation=?1 AND fp_version=?2 AND fp_hash=?3
         )",
        params![generation, from, predecessor_hash.as_slice()],
        |row| row.get(0),
    )?;
    Ok(exists)
}

fn insert_error_exemplar(
    tx: &Transaction<'_>,
    generation: &str,
    issue: &str,
    event: &Event,
    failure: &MaterializedFailureStampV1,
    stamp: i64,
    attempts: &mut BTreeMap<String, usize>,
) -> SnapbackResult<()> {
    let duplicate: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM error_exemplars WHERE generation=?1 AND issue=?2 AND observation=?3)",
        params![generation, issue, event.admission.observation_id],
        |row| row.get(0),
    )?;
    if duplicate {
        return Ok(());
    }

    let (mut depth, mut bytes): (i64, i64) = tx.query_row(
        "SELECT count(*),coalesce(sum(
           coalesce(length(CAST(title_template AS BLOB)),0) +
           coalesce(length(CAST(stack_head AS BLOB)),0)
         ),0)
         FROM error_exemplars WHERE generation=?1 AND issue=?2",
        params![generation, issue],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let incoming_bytes = failure
        .message_template
        .as_ref()
        .map_or(0, |value| value.len())
        .saturating_add(failure.stack_head.as_ref().map_or(0, |value| value.len()));

    if incoming_bytes > ERROR_EXEMPLAR_BYTES {
        tx.execute(
            "UPDATE error_groups SET exemplar_byte_drop_count=exemplar_byte_drop_count+1
             WHERE generation=?1 AND issue=?2",
            params![generation, issue],
        )?;
        return Ok(());
    }

    let inserted = attempts.entry(issue.to_owned()).or_default();
    if *inserted >= ERROR_EXEMPLAR_DEPTH {
        tx.execute(
            "UPDATE error_groups SET exemplar_flush_drop_count=exemplar_flush_drop_count+1
             WHERE generation=?1 AND issue=?2",
            params![generation, issue],
        )?;
        return Ok(());
    }

    if depth >= ERROR_EXEMPLAR_DEPTH as i64
        && let Some(removed) = delete_oldest_exemplar(tx, generation, issue)?
    {
        depth -= 1;
        bytes = bytes.saturating_sub(removed);
        tx.execute(
            "UPDATE error_groups SET exemplar_depth_drop_count=exemplar_depth_drop_count+1
             WHERE generation=?1 AND issue=?2",
            params![generation, issue],
        )?;
    }
    while depth > 0 && bytes.saturating_add(incoming_bytes as i64) > ERROR_EXEMPLAR_BYTES as i64 {
        let Some(removed) = delete_oldest_exemplar(tx, generation, issue)? else {
            break;
        };
        depth -= 1;
        bytes = bytes.saturating_sub(removed);
        tx.execute(
            "UPDATE error_groups SET exemplar_byte_drop_count=exemplar_byte_drop_count+1
             WHERE generation=?1 AND issue=?2",
            params![generation, issue],
        )?;
    }
    tx.execute(
        "INSERT INTO error_exemplars(
           issue,generation,observation,recorded_ts_ms,recorded_seq,release,title_template,
           template_truncated,stack_head,stack_truncated
         ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            issue,
            generation,
            event.admission.observation_id,
            stamp,
            sqlite_enqueue_sequence(event.sequence)?,
            event.release,
            failure.message_template,
            i64::from(failure.template_truncated),
            failure.stack_head,
            i64::from(failure.stack_truncated),
        ],
    )?;
    *inserted += 1;
    Ok(())
}

fn delete_oldest_exemplar(
    tx: &Transaction<'_>,
    generation: &str,
    issue: &str,
) -> SnapbackResult<Option<i64>> {
    let oldest: Option<(String, i64)> = tx
        .query_row(
            "SELECT observation,
                    coalesce(length(CAST(title_template AS BLOB)),0) +
                    coalesce(length(CAST(stack_head AS BLOB)),0)
             FROM error_exemplars
             WHERE generation=?1 AND issue=?2
             ORDER BY recorded_seq,observation LIMIT 1",
            params![generation, issue],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((observation, bytes)) = oldest else {
        return Ok(None);
    };
    tx.execute(
        "DELETE FROM error_exemplars WHERE generation=?1 AND issue=?2 AND observation=?3",
        params![generation, issue, observation],
    )?;
    Ok(Some(bytes))
}

fn upsert_release_activation(
    tx: &Transaction<'_>,
    generation: &str,
    release: &str,
    event: &Event,
    stamp: i64,
) -> SnapbackResult<()> {
    let sequence = sqlite_enqueue_sequence(event.sequence)?;
    tx.execute(
        "INSERT INTO release_activations(
           generation,release,activated_ms,activated_seq,last_activated_ms,last_activated_seq
         ) VALUES(?1,?2,?3,?4,?3,?4)
         ON CONFLICT(generation,release) DO UPDATE SET
           last_activated_ms=CASE
             WHEN excluded.last_activated_seq>release_activations.last_activated_seq
             THEN excluded.last_activated_ms ELSE release_activations.last_activated_ms END,
           last_activated_seq=max(release_activations.last_activated_seq,excluded.last_activated_seq)",
        params![generation, release, stamp, sequence],
    )?;
    Ok(())
}

fn sweep_error_groups(
    tx: &Transaction<'_>,
    generation: &str,
    horizon: i64,
) -> SnapbackResult<usize> {
    Ok(tx.execute(
        "DELETE FROM error_groups WHERE generation<>?1 OR (generation=?1 AND last_seen_ms<=?2)",
        params![generation, horizon],
    )?)
}

fn sweep_release_activations(
    tx: &Transaction<'_>,
    generation: &str,
    horizon: i64,
) -> SnapbackResult<usize> {
    let floor: i64 = tx.query_row(
        "SELECT coalesce(max(activated_seq),-1) FROM release_activations
         WHERE generation=?1 AND last_activated_ms<=?2",
        params![generation, horizon],
        |row| row.get(0),
    )?;
    let mut swept = tx.execute(
        "DELETE FROM release_activations WHERE generation<>?1",
        params![generation],
    )?;
    swept = swept.saturating_add(tx.execute(
        "DELETE FROM release_activations WHERE generation=?1 AND last_activated_ms<=?2",
        params![generation, horizon],
    )?);
    if floor >= 0 {
        tx.execute(
            "UPDATE telemetry_meta SET release_activation_floor_seq=max(release_activation_floor_seq,?1) WHERE singleton=1",
            params![floor],
        )?;
    }
    Ok(swept)
}

fn enforce_release_activation_cap(tx: &Transaction<'_>, generation: &str) -> SnapbackResult<usize> {
    let count: i64 = tx.query_row(
        "SELECT count(*) FROM release_activations WHERE generation=?1",
        params![generation],
        |row| row.get(0),
    )?;
    if count <= RELEASE_ACTIVATION_CAP as i64 {
        return Ok(0);
    }
    let excess = count - RELEASE_ACTIVATION_CAP as i64;
    let floor: i64 = tx.query_row(
        "SELECT max(activated_seq) FROM (
           SELECT activated_seq FROM release_activations
           WHERE generation=?1 ORDER BY activated_seq,release LIMIT ?2
         )",
        params![generation, excess],
        |row| row.get(0),
    )?;
    let swept = tx.execute(
        "DELETE FROM release_activations
         WHERE generation=?1 AND release IN (
           SELECT release FROM release_activations
           WHERE generation=?1 ORDER BY activated_seq,release LIMIT ?2
         )",
        params![generation, excess],
    )?;
    tx.execute(
        "UPDATE telemetry_meta SET release_activation_floor_seq=max(release_activation_floor_seq,?1) WHERE singleton=1",
        params![floor],
    )?;
    Ok(swept)
}

fn append_error_transition(
    tx: &Transaction<'_>,
    generation: &str,
    row: ErrorTransitionRow<'_>,
) -> SnapbackResult<()> {
    let ErrorTransitionRow {
        issue,
        seq,
        from,
        to,
        at_ms,
        actor,
        release,
    } = row;
    tx.execute(
        "INSERT INTO error_transitions(generation,issue,seq,from_state,to_state,at_ms,actor,release)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![generation, issue, seq, from.as_str(), to.as_str(), at_ms, actor, release],
    )?;
    tx.execute(
        "DELETE FROM error_transitions
         WHERE generation=?1 AND issue=?2 AND seq IN (
           SELECT seq FROM error_transitions WHERE generation=?1 AND issue=?2
           ORDER BY seq DESC LIMIT -1 OFFSET ?3
         )",
        params![generation, issue, ERROR_TRANSITIONS_PER_GROUP as i64],
    )?;
    Ok(())
}

fn enforce_global_transition_cap(tx: &Transaction<'_>) -> SnapbackResult<usize> {
    let count: i64 = tx.query_row("SELECT count(*) FROM error_transitions", [], |row| {
        row.get(0)
    })?;
    if count <= ERROR_TRANSITIONS_GLOBAL as i64 {
        return Ok(0);
    }
    let excess = count - ERROR_TRANSITIONS_GLOBAL as i64;
    Ok(tx.execute(
        "DELETE FROM error_transitions WHERE rowid IN (
           SELECT rowid FROM error_transitions ORDER BY rowid LIMIT ?1
         )",
        params![excess],
    )?)
}

fn merge_drop_counters(
    tx: &Transaction<'_>,
    increments: &BTreeMap<String, u64>,
) -> SnapbackResult<()> {
    if increments.is_empty() {
        return Ok(());
    }
    let encoded: String = tx.query_row(
        "SELECT drop_counters_lifetime FROM telemetry_meta WHERE singleton=1",
        [],
        |row| row.get(0),
    )?;
    let mut counters: BTreeMap<String, u64> = serde_json::from_str(&encoded).unwrap_or_default();
    for (key, count) in increments {
        *counters.entry(key.clone()).or_default() = counters
            .get(key)
            .copied()
            .unwrap_or_default()
            .saturating_add(*count);
    }
    tx.execute(
        "UPDATE telemetry_meta SET drop_counters_lifetime=?1 WHERE singleton=1",
        params![serde_json::to_string(&counters).expect("drop counters serialize")],
    )?;
    Ok(())
}

fn merge_counter_maps(target: &mut BTreeMap<String, u64>, increments: &BTreeMap<String, u64>) {
    for (key, count) in increments {
        let entry = target.entry(key.clone()).or_default();
        *entry = entry.saturating_add(*count);
    }
}

#[derive(Clone, Debug, Default)]
struct Aggregate {
    count: u64,
    errors: u64,
    histogram: [u64; 17],
    coverage_start: i64,
    coverage_end: i64,
    watermark: i64,
    folded: u64,
}

fn histogram_index(duration_ms: f64) -> usize {
    if !duration_ms.is_finite() || duration_ms < 0.0 {
        return 16;
    }
    let mut bound = 1.0;
    for index in 0..16 {
        if duration_ms <= bound {
            return index;
        }
        bound *= 2.0;
    }
    16
}

fn hour_start(timestamp: i64) -> i64 {
    timestamp.div_euclid(HOUR_MS) * HOUR_MS
}

fn day_start(timestamp: i64) -> i64 {
    timestamp.div_euclid(DAY_MS) * DAY_MS
}

fn caller_attribution_from_details(details: Option<&str>) -> Option<(String, String)> {
    let object = serde_json::from_str::<Value>(details?).ok()?;
    let lane = object.get("callerLane")?.as_str()?;
    let key = object.get("callerKey")?.as_str()?;
    let valid = match lane {
        "anonymous" => key == "anonymous",
        "first-party" => key.is_empty(),
        "declared" | "integration" | "link" => !key.is_empty() && key.len() <= 512,
        _ => false,
    };
    valid.then(|| (lane.to_owned(), key.to_owned()))
}

fn maintain(tx: &Transaction<'_>, config: &TelemetryConfig, clock: i64) -> SnapbackResult<usize> {
    let (generation, watermark): (String, i64) = tx.query_row(
        "SELECT generation,rollup_watermark_id FROM telemetry_meta WHERE singleton=1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let rows = {
        let mut statement = tx.prepare(
            "SELECT id,recorded_ts_ms,phase,kind,name,status,duration_ms,code,details FROM telemetry_events WHERE generation=?1 AND id>?2 ORDER BY id",
        )?;
        statement
            .query_map(params![generation, watermark], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, Option<f64>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    let maximum_id = rows.last().map(|row| row.0).unwrap_or(watermark);
    let mut aggregates: BTreeMap<(i64, String, String), Aggregate> = BTreeMap::new();
    let mut caller_aggregates: BTreeMap<(i64, String, String, String, String), Aggregate> =
        BTreeMap::new();
    for (id, recorded, phase, kind, name, status, duration, code, details) in rows {
        let counted = matches!(phase.as_str(), "point" | "joined" | "terminal");
        if !counted {
            continue;
        }
        let caller = caller_attribution_from_details(details.as_deref());
        let key = (hour_start(recorded), kind.clone(), name.clone());
        let entry = aggregates.entry(key).or_insert_with(|| Aggregate {
            coverage_start: recorded,
            coverage_end: recorded,
            ..Aggregate::default()
        });
        entry.count += 1;
        entry.errors += u64::from(code.is_some() || status.is_some_and(|value| value >= 500));
        if let Some(duration) = duration {
            entry.histogram[histogram_index(duration)] += 1;
        }
        entry.coverage_start = entry.coverage_start.min(recorded);
        entry.coverage_end = entry.coverage_end.max(recorded);
        entry.watermark = entry.watermark.max(id);
        if let Some((lane, caller_key)) = caller {
            let key = (hour_start(recorded), kind, name, lane, caller_key);
            let entry = caller_aggregates.entry(key).or_insert_with(|| Aggregate {
                coverage_start: recorded,
                coverage_end: recorded,
                ..Aggregate::default()
            });
            entry.count += 1;
            entry.errors += u64::from(code.is_some() || status.is_some_and(|value| value >= 500));
            if let Some(duration) = duration {
                entry.histogram[histogram_index(duration)] += 1;
            }
            entry.coverage_start = entry.coverage_start.min(recorded);
            entry.coverage_end = entry.coverage_end.max(recorded);
            entry.watermark = entry.watermark.max(id);
        }
    }
    for ((bucket, kind, name), aggregate) in aggregates {
        upsert_hourly(tx, &generation, bucket, &kind, &name, aggregate, clock)?;
    }
    for ((bucket, kind, name, lane, caller_key), aggregate) in caller_aggregates {
        upsert_caller_hourly(
            tx,
            &generation,
            bucket,
            &kind,
            &name,
            &lane,
            &caller_key,
            aggregate,
            clock,
        )?;
    }
    tx.execute(
        "UPDATE telemetry_meta SET rollup_watermark_id=?1 WHERE singleton=1",
        params![maximum_id],
    )?;
    tx.execute(
        "UPDATE telemetry_rollup_hourly SET finalized=1 WHERE generation=?1 AND bucket_end_ms<=?2",
        params![generation, hour_start(clock)],
    )?;
    tx.execute(
        "UPDATE telemetry_caller_rollup_hourly SET finalized=1 WHERE generation=?1 AND bucket_end_ms<=?2",
        params![generation, hour_start(clock)],
    )?;
    fold_finalized_heavy_hitters(tx, &generation, config.top_names_per_hour, clock)?;
    fold_finalized_caller_heavy_hitters(tx, &generation, config.top_names_per_hour, clock)?;

    let mut swept = compact_hourly(tx, &generation, config, clock)?;
    swept = swept.saturating_add(evict_daily_horizon(tx, &generation, config, clock)?);
    swept = swept.saturating_add(tx.execute(
        "DELETE FROM telemetry_rollup_hourly WHERE generation<>?1",
        params![generation],
    )?);
    swept = swept.saturating_add(tx.execute(
        "DELETE FROM telemetry_rollup_daily WHERE generation<>?1",
        params![generation],
    )?);
    swept = swept.saturating_add(tx.execute(
        "DELETE FROM telemetry_caller_rollup_hourly WHERE generation<>?1",
        params![generation],
    )?);
    swept = swept.saturating_add(tx.execute(
        "DELETE FROM telemetry_caller_rollup_daily WHERE generation<>?1",
        params![generation],
    )?);
    swept = swept.saturating_add(enforce_rollup_cap(tx, &generation, config.rollup_row_cap)?);

    let boundary = boundary_for(config, clock);
    swept = swept.saturating_add(sweep_error_groups(
        tx,
        &generation,
        error_group_boundary(config, clock),
    )?);
    swept = swept.saturating_add(sweep_release_activations(
        tx,
        &generation,
        error_group_boundary(config, clock),
    )?);
    swept = swept.saturating_add(enforce_release_activation_cap(tx, &generation)?);
    swept = swept.saturating_add(tx.execute(
        "DELETE FROM error_exemplars
         WHERE generation<>?1 OR (generation=?1 AND recorded_ts_ms<=max(
           ?2,(SELECT retention_floor FROM telemetry_meta WHERE singleton=1)
         ))",
        params![generation, boundary],
    )?);
    swept = swept.saturating_add(tx.execute(
        "DELETE FROM telemetry_events WHERE generation<>?2 OR (generation=?2 AND id<=?1 AND recorded_ts_ms<=?3)",
        params![maximum_id, generation, boundary],
    )?);
    tx.execute(
        "UPDATE telemetry_meta SET retention_floor=max(retention_floor,?1),last_sweep_ms=?2 WHERE singleton=1",
        params![boundary, clock],
    )?;
    Ok(swept)
}

fn fold_finalized_heavy_hitters(
    tx: &Transaction<'_>,
    generation: &str,
    maximum: usize,
    clock: i64,
) -> SnapbackResult<()> {
    let groups = {
        let mut statement = tx.prepare(
            "SELECT DISTINCT bucket_start_ms,kind FROM telemetry_rollup_hourly WHERE generation=?1 AND finalized=1",
        )?;
        statement
            .query_map(params![generation], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    for (bucket, kind) in groups {
        let rows = {
            let mut statement = tx.prepare(
                "SELECT name,count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count FROM telemetry_rollup_hourly WHERE generation=?1 AND bucket_start_ms=?2 AND kind=?3 AND name<>'_other' ORDER BY count DESC,name",
            )?;
            statement
                .query_map(params![generation, bucket, kind], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        Aggregate {
                            count: row.get::<_, i64>(1)? as u64,
                            errors: row.get::<_, i64>(2)? as u64,
                            histogram: decode_histogram(&row.get::<_, String>(3)?),
                            coverage_start: row.get(4)?,
                            coverage_end: row.get(5)?,
                            watermark: row.get(6)?,
                            folded: row.get::<_, i64>(7)? as u64,
                        },
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        if rows.len() <= maximum {
            continue;
        }
        let mut folded = Aggregate::default();
        let mut initialized = false;
        for (name, aggregate) in rows.into_iter().skip(maximum) {
            tx.execute(
                "DELETE FROM telemetry_rollup_hourly WHERE generation=?1 AND bucket_start_ms=?2 AND kind=?3 AND name=?4",
                params![generation, bucket, kind, name],
            )?;
            merge_aggregate(&mut folded, &aggregate, &mut initialized);
            folded.folded = folded.folded.saturating_add(aggregate.count);
        }
        if initialized {
            upsert_hourly(tx, generation, bucket, &kind, "_other", folded, clock)?;
        }
    }
    Ok(())
}

fn fold_finalized_caller_heavy_hitters(
    tx: &Transaction<'_>,
    generation: &str,
    maximum: usize,
    clock: i64,
) -> SnapbackResult<()> {
    let groups = {
        let mut statement = tx.prepare(
            "SELECT DISTINCT bucket_start_ms,kind,caller_lane,caller_key FROM telemetry_caller_rollup_hourly WHERE generation=?1 AND finalized=1",
        )?;
        statement
            .query_map(params![generation], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    for (bucket, kind, lane, caller_key) in groups {
        let rows = {
            let mut statement = tx.prepare(
                "SELECT name,count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count FROM telemetry_caller_rollup_hourly WHERE generation=?1 AND bucket_start_ms=?2 AND kind=?3 AND caller_lane=?4 AND caller_key=?5 AND name<>'_other' ORDER BY count DESC,name",
            )?;
            statement
                .query_map(params![generation, bucket, kind, lane, caller_key], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        Aggregate {
                            count: row.get::<_, i64>(1)? as u64,
                            errors: row.get::<_, i64>(2)? as u64,
                            histogram: decode_histogram(&row.get::<_, String>(3)?),
                            coverage_start: row.get(4)?,
                            coverage_end: row.get(5)?,
                            watermark: row.get(6)?,
                            folded: row.get::<_, i64>(7)? as u64,
                        },
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        if rows.len() <= maximum {
            continue;
        }
        let mut folded = Aggregate::default();
        let mut initialized = false;
        for (name, aggregate) in rows.into_iter().skip(maximum) {
            tx.execute(
                "DELETE FROM telemetry_caller_rollup_hourly WHERE generation=?1 AND bucket_start_ms=?2 AND kind=?3 AND name=?4 AND caller_lane=?5 AND caller_key=?6",
                params![generation, bucket, kind, name, lane, caller_key],
            )?;
            merge_aggregate(&mut folded, &aggregate, &mut initialized);
            folded.folded = folded.folded.saturating_add(aggregate.count);
        }
        if initialized {
            upsert_caller_hourly(
                tx,
                generation,
                bucket,
                &kind,
                "_other",
                &lane,
                &caller_key,
                folded,
                clock,
            )?;
        }
    }
    Ok(())
}

fn merge_aggregate(target: &mut Aggregate, source: &Aggregate, initialized: &mut bool) {
    target.count = target.count.saturating_add(source.count);
    target.errors = target.errors.saturating_add(source.errors);
    target.folded = target.folded.saturating_add(source.folded);
    for (target, source) in target.histogram.iter_mut().zip(source.histogram) {
        *target = target.saturating_add(source);
    }
    if !*initialized {
        target.coverage_start = source.coverage_start;
        target.coverage_end = source.coverage_end;
        *initialized = true;
    } else {
        target.coverage_start = target.coverage_start.min(source.coverage_start);
        target.coverage_end = target.coverage_end.max(source.coverage_end);
    }
    target.watermark = target.watermark.max(source.watermark);
}

fn decode_histogram(encoded: &str) -> [u64; 17] {
    serde_json::from_str::<Vec<u64>>(encoded)
        .ok()
        .filter(|values| values.len() == 17)
        .map(|values| core::array::from_fn(|index| values[index]))
        .unwrap_or([0; 17])
}

fn upsert_hourly(
    tx: &Transaction<'_>,
    generation: &str,
    bucket: i64,
    kind: &str,
    name: &str,
    mut aggregate: Aggregate,
    clock: i64,
) -> SnapbackResult<()> {
    let existing: Option<(i64, i64, String, i64, i64, i64, i64)> = tx
        .query_row(
            "SELECT count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count FROM telemetry_rollup_hourly WHERE generation=?1 AND bucket_start_ms=?2 AND kind=?3 AND name=?4",
            params![generation, bucket, kind, name],
            |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?)),
        )
        .optional()?;
    if let Some((count, errors, histogram, start, end, watermark, folded)) = existing {
        aggregate.count += count as u64;
        aggregate.errors += errors as u64;
        aggregate.folded += folded as u64;
        for (target, value) in aggregate
            .histogram
            .iter_mut()
            .zip(decode_histogram(&histogram))
        {
            *target += value;
        }
        aggregate.coverage_start = aggregate.coverage_start.min(start);
        aggregate.coverage_end = aggregate.coverage_end.max(end);
        aggregate.watermark = aggregate.watermark.max(watermark);
    }
    tx.execute(
        "INSERT OR REPLACE INTO telemetry_rollup_hourly(generation,bucket_start_ms,bucket_end_ms,kind,name,count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,finalized,folded_count) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        params![generation,bucket,bucket.saturating_add(HOUR_MS),kind,name,aggregate.count,aggregate.errors,serde_json::to_string(&aggregate.histogram.as_slice()).expect("histogram serializes"),aggregate.coverage_start,aggregate.coverage_end,aggregate.watermark,i64::from(bucket.saturating_add(HOUR_MS)<=hour_start(clock)),aggregate.folded],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)] // Stable rollup persistence boundary; regrouping is out of scope here.
fn upsert_caller_hourly(
    tx: &Transaction<'_>,
    generation: &str,
    bucket: i64,
    kind: &str,
    name: &str,
    lane: &str,
    caller_key: &str,
    mut aggregate: Aggregate,
    clock: i64,
) -> SnapbackResult<()> {
    let existing: Option<(i64, i64, String, i64, i64, i64, i64)> = tx
        .query_row(
            "SELECT count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count FROM telemetry_caller_rollup_hourly WHERE generation=?1 AND bucket_start_ms=?2 AND kind=?3 AND name=?4 AND caller_lane=?5 AND caller_key=?6",
            params![generation, bucket, kind, name, lane, caller_key],
            |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?)),
        )
        .optional()?;
    if let Some((count, errors, histogram, start, end, watermark, folded)) = existing {
        aggregate.count += count as u64;
        aggregate.errors += errors as u64;
        aggregate.folded += folded as u64;
        for (target, value) in aggregate
            .histogram
            .iter_mut()
            .zip(decode_histogram(&histogram))
        {
            *target += value;
        }
        aggregate.coverage_start = aggregate.coverage_start.min(start);
        aggregate.coverage_end = aggregate.coverage_end.max(end);
        aggregate.watermark = aggregate.watermark.max(watermark);
    }
    tx.execute(
        "INSERT OR REPLACE INTO telemetry_caller_rollup_hourly(generation,bucket_start_ms,bucket_end_ms,kind,name,caller_lane,caller_key,count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,finalized,folded_count) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        params![generation,bucket,bucket.saturating_add(HOUR_MS),kind,name,lane,caller_key,aggregate.count,aggregate.errors,serde_json::to_string(&aggregate.histogram.as_slice()).expect("histogram serializes"),aggregate.coverage_start,aggregate.coverage_end,aggregate.watermark,i64::from(bucket.saturating_add(HOUR_MS)<=hour_start(clock)),aggregate.folded],
    )?;
    Ok(())
}

fn compact_hourly(
    tx: &Transaction<'_>,
    generation: &str,
    config: &TelemetryConfig,
    clock: i64,
) -> SnapbackResult<usize> {
    let cutoff = clock.saturating_sub(i64::from(config.hourly_days) * DAY_MS);
    let rows = {
        let mut statement = tx.prepare("SELECT bucket_start_ms,bucket_end_ms,kind,name,count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count FROM telemetry_rollup_hourly WHERE generation=?1 AND bucket_end_ms<=?2 ORDER BY bucket_start_ms")?;
        statement
            .query_map(params![generation, cutoff], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, i64>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, i64>(10)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    let mut daily: BTreeMap<(i64, String, String), Aggregate> = BTreeMap::new();
    let mut hourly_floor = None;
    for (start, end, kind, name, count, errors, hist, start_cov, end_cov, watermark, folded) in rows
    {
        hourly_floor = Some(hourly_floor.unwrap_or(0_i64).max(end));
        let entry = daily
            .entry((day_start(start), kind, name))
            .or_insert_with(|| Aggregate {
                coverage_start: start_cov,
                coverage_end: end_cov,
                ..Aggregate::default()
            });
        entry.count += count as u64;
        entry.errors += errors as u64;
        entry.folded += folded as u64;
        for (target, value) in entry.histogram.iter_mut().zip(decode_histogram(&hist)) {
            *target += value;
        }
        entry.coverage_start = entry.coverage_start.min(start_cov);
        entry.coverage_end = entry.coverage_end.max(end_cov);
        entry.watermark = entry.watermark.max(watermark);
    }
    for ((day, kind, name), aggregate) in daily {
        upsert_daily(tx, generation, day, &kind, &name, aggregate)?;
    }
    let mut swept = 0;
    if let Some(floor) = hourly_floor {
        swept = tx.execute(
            "DELETE FROM telemetry_rollup_hourly WHERE generation=?1 AND bucket_end_ms<=?2",
            params![generation, floor],
        )?;
        let caller_rows = {
            let mut statement = tx.prepare("SELECT bucket_start_ms,kind,name,caller_lane,caller_key,count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count FROM telemetry_caller_rollup_hourly WHERE generation=?1 AND bucket_end_ms<=?2 ORDER BY bucket_start_ms")?;
            statement
                .query_map(params![generation, floor], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, i64>(8)?,
                        row.get::<_, i64>(9)?,
                        row.get::<_, i64>(10)?,
                        row.get::<_, i64>(11)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        let mut caller_daily: BTreeMap<(i64, String, String, String, String), Aggregate> =
            BTreeMap::new();
        for (
            start,
            kind,
            name,
            lane,
            caller_key,
            count,
            errors,
            hist,
            start_cov,
            end_cov,
            watermark,
            folded,
        ) in caller_rows
        {
            let entry = caller_daily
                .entry((day_start(start), kind, name, lane, caller_key))
                .or_insert_with(|| Aggregate {
                    coverage_start: start_cov,
                    coverage_end: end_cov,
                    ..Aggregate::default()
                });
            entry.count += count as u64;
            entry.errors += errors as u64;
            entry.folded += folded as u64;
            for (target, value) in entry.histogram.iter_mut().zip(decode_histogram(&hist)) {
                *target += value;
            }
            entry.coverage_start = entry.coverage_start.min(start_cov);
            entry.coverage_end = entry.coverage_end.max(end_cov);
            entry.watermark = entry.watermark.max(watermark);
        }
        for ((day, kind, name, lane, caller_key), aggregate) in caller_daily {
            upsert_caller_daily(
                tx,
                generation,
                day,
                &kind,
                &name,
                &lane,
                &caller_key,
                aggregate,
            )?;
        }
        swept = swept.saturating_add(tx.execute(
            "DELETE FROM telemetry_caller_rollup_hourly WHERE generation=?1 AND bucket_end_ms<=?2",
            params![generation, floor],
        )?);
        tx.execute("UPDATE telemetry_meta SET aggregate_floor_hourly=max(aggregate_floor_hourly,?1) WHERE singleton=1",params![floor])?;
    }
    Ok(swept)
}

fn upsert_daily(
    tx: &Transaction<'_>,
    generation: &str,
    bucket: i64,
    kind: &str,
    name: &str,
    mut aggregate: Aggregate,
) -> SnapbackResult<()> {
    let existing: Option<(i64,i64,String,i64,i64,i64,i64)> = tx.query_row(
        "SELECT count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count FROM telemetry_rollup_daily WHERE generation=?1 AND bucket_start_ms=?2 AND kind=?3 AND name=?4",
        params![generation,bucket,kind,name],
        |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?)),
    ).optional()?;
    if let Some((count, errors, hist, start, end, watermark, folded)) = existing {
        aggregate.count += count as u64;
        aggregate.errors += errors as u64;
        aggregate.folded += folded as u64;
        for (target, value) in aggregate.histogram.iter_mut().zip(decode_histogram(&hist)) {
            *target += value;
        }
        aggregate.coverage_start = aggregate.coverage_start.min(start);
        aggregate.coverage_end = aggregate.coverage_end.max(end);
        aggregate.watermark = aggregate.watermark.max(watermark);
    }
    tx.execute("INSERT OR REPLACE INTO telemetry_rollup_daily(generation,bucket_start_ms,bucket_end_ms,kind,name,count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![generation,bucket,bucket.saturating_add(DAY_MS),kind,name,aggregate.count,aggregate.errors,serde_json::to_string(&aggregate.histogram.as_slice()).expect("histogram serializes"),aggregate.coverage_start,aggregate.coverage_end,aggregate.watermark,aggregate.folded])?;
    Ok(())
}

#[allow(clippy::too_many_arguments)] // Stable rollup persistence boundary; regrouping is out of scope here.
fn upsert_caller_daily(
    tx: &Transaction<'_>,
    generation: &str,
    bucket: i64,
    kind: &str,
    name: &str,
    lane: &str,
    caller_key: &str,
    mut aggregate: Aggregate,
) -> SnapbackResult<()> {
    let existing: Option<(i64, i64, String, i64, i64, i64, i64)> = tx
        .query_row(
            "SELECT count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count FROM telemetry_caller_rollup_daily WHERE generation=?1 AND bucket_start_ms=?2 AND kind=?3 AND name=?4 AND caller_lane=?5 AND caller_key=?6",
            params![generation, bucket, kind, name, lane, caller_key],
            |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?)),
        )
        .optional()?;
    if let Some((count, errors, hist, start, end, watermark, folded)) = existing {
        aggregate.count += count as u64;
        aggregate.errors += errors as u64;
        aggregate.folded += folded as u64;
        for (target, value) in aggregate.histogram.iter_mut().zip(decode_histogram(&hist)) {
            *target += value;
        }
        aggregate.coverage_start = aggregate.coverage_start.min(start);
        aggregate.coverage_end = aggregate.coverage_end.max(end);
        aggregate.watermark = aggregate.watermark.max(watermark);
    }
    tx.execute(
        "INSERT OR REPLACE INTO telemetry_caller_rollup_daily(generation,bucket_start_ms,bucket_end_ms,kind,name,caller_lane,caller_key,count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
        params![generation,bucket,bucket.saturating_add(DAY_MS),kind,name,lane,caller_key,aggregate.count,aggregate.errors,serde_json::to_string(&aggregate.histogram.as_slice()).expect("histogram serializes"),aggregate.coverage_start,aggregate.coverage_end,aggregate.watermark,aggregate.folded],
    )?;
    Ok(())
}

fn evict_daily_horizon(
    tx: &Transaction<'_>,
    generation: &str,
    config: &TelemetryConfig,
    clock: i64,
) -> SnapbackResult<usize> {
    let cutoff = clock.saturating_sub(i64::from(config.daily_days) * DAY_MS);
    let floor:Option<i64>=tx.query_row("SELECT max(bucket_end_ms) FROM telemetry_rollup_daily WHERE generation=?1 AND bucket_end_ms<=?2",params![generation,cutoff],|row|row.get(0))?;
    let mut swept = 0;
    if let Some(floor) = floor {
        swept = tx.execute(
            "DELETE FROM telemetry_rollup_daily WHERE generation=?1 AND bucket_end_ms<=?2",
            params![generation, floor],
        )?;
        swept = swept.saturating_add(tx.execute(
            "DELETE FROM telemetry_caller_rollup_daily WHERE generation=?1 AND bucket_end_ms<=?2",
            params![generation, floor],
        )?);
        tx.execute("UPDATE telemetry_meta SET aggregate_floor_daily=max(aggregate_floor_daily,?1) WHERE singleton=1",params![floor])?;
    }
    Ok(swept)
}

fn enforce_rollup_cap(tx: &Transaction<'_>, generation: &str, cap: usize) -> SnapbackResult<usize> {
    let mut swept = 0usize;
    loop {
        let count:i64=tx.query_row("SELECT (SELECT count(*) FROM telemetry_rollup_hourly WHERE generation=?1)+(SELECT count(*) FROM telemetry_rollup_daily WHERE generation=?1)+(SELECT count(*) FROM telemetry_caller_rollup_hourly WHERE generation=?1)+(SELECT count(*) FROM telemetry_caller_rollup_daily WHERE generation=?1)",params![generation],|row|row.get(0))?;
        if count <= cap as i64 {
            break;
        }
        let oldest:Option<(String,i64,i64)>=tx.query_row(
            "SELECT tier,bucket_start_ms,bucket_end_ms FROM (SELECT 'hourly' tier,bucket_start_ms,bucket_end_ms FROM telemetry_rollup_hourly WHERE generation=?1 UNION ALL SELECT 'daily',bucket_start_ms,bucket_end_ms FROM telemetry_rollup_daily WHERE generation=?1) ORDER BY bucket_start_ms,tier LIMIT 1",
            params![generation],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional()?;
        let Some((tier, start, end)) = oldest else {
            break;
        };
        let (table, caller_table, floor_column) = if tier == "hourly" {
            (
                "telemetry_rollup_hourly",
                "telemetry_caller_rollup_hourly",
                "aggregate_floor_hourly",
            )
        } else {
            (
                "telemetry_rollup_daily",
                "telemetry_caller_rollup_daily",
                "aggregate_floor_daily",
            )
        };
        swept = swept.saturating_add(tx.execute(
            &format!("DELETE FROM {table} WHERE generation=?1 AND bucket_start_ms=?2"),
            params![generation, start],
        )?);
        swept = swept.saturating_add(tx.execute(
            &format!("DELETE FROM {caller_table} WHERE generation=?1 AND bucket_start_ms=?2"),
            params![generation, start],
        )?);
        tx.execute(
            &format!(
                "UPDATE telemetry_meta SET {floor_column}=max({floor_column},?1) WHERE singleton=1"
            ),
            params![end],
        )?;
    }
    Ok(swept)
}

fn event_storage_upper_bound(event: &Event) -> u64 {
    let payload = event
        .admission
        .observation_id
        .len()
        .saturating_add(event.generation.len())
        .saturating_add(event.admission.telemetry_kind.len())
        .saturating_add(event.name.len())
        .saturating_add(event.code.as_ref().map_or(0, String::len))
        .saturating_add(event.correlation.as_ref().map_or(0, String::len))
        .saturating_add(
            event
                .details
                .as_ref()
                .and_then(|value| serde_json::to_vec(value).ok())
                .map_or(0, |value| value.len()),
        )
        .saturating_add(512) as u64;
    payload
        .saturating_add(4_095)
        .div_ceil(4_096)
        .saturating_mul(4_096)
        .saturating_add(8_192)
}

fn select_events_under_file_cap(
    conn: &Connection,
    path: &Path,
    cap: u64,
    events: Vec<Event>,
    drops: &mut BTreeMap<String, u64>,
) -> SnapbackResult<(Vec<Event>, bool)> {
    let estimate = events.iter().fold(0_u64, |total, event| {
        total.saturating_add(event_storage_upper_bound(event))
    });
    let mut physical = telemetry_file_bytes(path);
    if physical
        .saturating_add(FILE_CAP_FIXED_RESERVE_BYTES)
        .saturating_add(estimate)
        <= cap
    {
        return Ok((events, false));
    }

    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    physical = telemetry_file_bytes(path);
    let mut available = cap.saturating_sub(physical.saturating_add(FILE_CAP_FIXED_RESERVE_BYTES));
    let mut candidates = events.into_iter().enumerate().collect::<Vec<_>>();
    candidates.sort_by(|(left_index, left), (right_index, right)| {
        let left_rank = u8::from(left.priority == Priority::Reserved);
        let right_rank = u8::from(right.priority == Priority::Reserved);
        right_rank
            .cmp(&left_rank)
            .then_with(|| right_index.cmp(left_index))
    });
    let mut retained = Vec::new();
    for (index, event) in candidates {
        let bytes = event_storage_upper_bound(&event);
        if bytes <= available {
            available -= bytes;
            retained.push((index, event));
        } else {
            let key = format!(
                "{}:{}:fileCap",
                event.admission.telemetry_kind,
                event.priority.as_str()
            );
            *drops.entry(key).or_default() += 1;
        }
    }
    retained.sort_by_key(|(index, _)| *index);
    Ok((retained.into_iter().map(|(_, event)| event).collect(), true))
}

fn enforce_physical_file_cap(
    conn: &mut Connection,
    path: &Path,
    config: &TelemetryConfig,
    clock: i64,
    fail_injected: bool,
) -> BTreeMap<String, u64> {
    let mut committed_drops = BTreeMap::new();
    while telemetry_file_bytes(path) > config.file_size_cap_bytes {
        if fail_injected {
            merge_counter_maps(&mut committed_drops, &record_postcommit_cap_failure(conn));
            break;
        }
        let step = match file_cap_recovery_step(conn, config, clock) {
            Ok(step) => step,
            Err(_) => {
                merge_counter_maps(&mut committed_drops, &record_postcommit_cap_failure(conn));
                break;
            }
        };
        merge_counter_maps(&mut committed_drops, &step);
        if conn
            .execute_batch("VACUUM; PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE);")
            .is_err()
        {
            merge_counter_maps(&mut committed_drops, &record_postcommit_cap_failure(conn));
            break;
        }
    }
    committed_drops
}

fn file_cap_recovery_step(
    conn: &mut Connection,
    config: &TelemetryConfig,
    clock: i64,
) -> SnapbackResult<BTreeMap<String, u64>> {
    let tx = conn.transaction()?;
    // This is deliberately unconditional. The physical post-check is the
    // estimator-miss path, so the preflight may not have armed maintenance;
    // every raw interval must cross the rollup watermark before deletion.
    maintain(&tx, config, clock)?;
    let generation: String = tx.query_row(
        "SELECT generation FROM telemetry_meta WHERE singleton=1",
        [],
        |row| row.get(0),
    )?;
    let oldest_raw: Option<i64> = tx.query_row(
        "SELECT min(recorded_ts_ms) FROM telemetry_events WHERE generation=?1",
        params![generation],
        |row| row.get(0),
    )?;
    let mut cap_drops = BTreeMap::new();
    let swept = if let Some(oldest) = oldest_raw {
        let interval_end = hour_start(oldest).saturating_add(HOUR_MS);
        {
            let mut statement = tx.prepare(
                "SELECT kind,count(*) FROM telemetry_events WHERE generation=?1 AND recorded_ts_ms<=?2 GROUP BY kind",
            )?;
            for row in statement.query_map(params![generation, interval_end], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })? {
                let (kind, count) = row?;
                cap_drops.insert(
                    format!("{kind}:unknown:fileCapIntervalEvicted"),
                    count.max(0) as u64,
                );
            }
        }
        let swept = tx.execute(
            "DELETE FROM telemetry_events WHERE generation=?1 AND recorded_ts_ms<=?2",
            params![generation, interval_end],
        )?;
        tx.execute(
            "DELETE FROM error_exemplars WHERE generation=?1 AND recorded_ts_ms<=?2",
            params![generation, interval_end],
        )?;
        tx.execute(
            "UPDATE telemetry_meta SET retention_floor=max(retention_floor,?1) WHERE singleton=1",
            params![interval_end],
        )?;
        swept
    } else {
        let oldest: Option<(String, i64, i64)> = tx
            .query_row(
                "SELECT tier,bucket_start_ms,bucket_end_ms FROM (SELECT 'hourly' tier,bucket_start_ms,bucket_end_ms FROM telemetry_rollup_hourly WHERE generation=?1 UNION ALL SELECT 'daily',bucket_start_ms,bucket_end_ms FROM telemetry_rollup_daily WHERE generation=?1) ORDER BY bucket_start_ms,tier LIMIT 1",
                params![generation],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let Some((tier, start, end)) = oldest else {
            return Err(SnapbackError::error(
                "SNAPBACK_TELEMETRY_FILE_CAP_UNSATISFIABLE",
                "telemetry",
                "telemetry schema and metadata exceed the configured file cap",
            ));
        };
        let (table, caller_table, floor) = if tier == "hourly" {
            (
                "telemetry_rollup_hourly",
                "telemetry_caller_rollup_hourly",
                "aggregate_floor_hourly",
            )
        } else {
            (
                "telemetry_rollup_daily",
                "telemetry_caller_rollup_daily",
                "aggregate_floor_daily",
            )
        };
        {
            let mut statement = tx.prepare(&format!(
                "SELECT kind,sum(count) FROM {table} WHERE generation=?1 AND bucket_start_ms=?2 GROUP BY kind"
            ))?;
            for row in statement.query_map(params![generation, start], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })? {
                let (kind, count) = row?;
                cap_drops.insert(
                    format!("{kind}:unknown:fileCapIntervalEvicted"),
                    count.max(0) as u64,
                );
            }
        }
        let mut swept = tx.execute(
            &format!("DELETE FROM {table} WHERE generation=?1 AND bucket_start_ms=?2"),
            params![generation, start],
        )?;
        swept = swept.saturating_add(tx.execute(
            &format!("DELETE FROM {caller_table} WHERE generation=?1 AND bucket_start_ms=?2"),
            params![generation, start],
        )?);
        tx.execute(
            &format!("UPDATE telemetry_meta SET {floor}=max({floor},?1) WHERE singleton=1"),
            params![end],
        )?;
        swept
    };
    if swept == 0 {
        return Err(SnapbackError::error(
            "SNAPBACK_TELEMETRY_FILE_CAP_UNSATISFIABLE",
            "telemetry",
            "telemetry could not shed a whole retained interval under file-cap pressure",
        ));
    }
    merge_drop_counters(&tx, &cap_drops)?;
    tx.execute(
        "UPDATE telemetry_meta SET last_sweep_ms=max(last_sweep_ms,?1) WHERE singleton=1",
        params![clock],
    )?;
    tx.commit()?;
    Ok(cap_drops)
}

fn record_postcommit_cap_failure(conn: &mut Connection) -> BTreeMap<String, u64> {
    let counters = BTreeMap::from([("telemetry:reserved:fileCapMaintenanceFailed".to_owned(), 1)]);
    if let Ok(tx) = conn.transaction()
        && merge_drop_counters(&tx, &counters).is_ok()
    {
        let _ = tx.commit();
    }
    counters
}

fn telemetry_file_bytes(path: &Path) -> u64 {
    [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ]
    .iter()
    .filter_map(|path| fs::metadata(path).ok())
    .map(|metadata| metadata.len())
    .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error_tracking::{
        CLASSIFIER_VERSION, FINGERPRINT_VERSION, FailureClassificationV1, FailureDetailsInputV1,
        allocate_failure_details,
    };

    fn config() -> TelemetryConfig {
        TelemetryConfig {
            batch_size: 64,
            max_age_ms: 60_000,
            ..TelemetryConfig::default()
        }
    }

    fn identity(
        app_id: impl Into<String>,
        environment: impl Into<String>,
    ) -> TelemetryStoreIdentity {
        TelemetryStoreIdentity::new(app_id, environment).unwrap()
    }

    fn joined(generation: &str, kind: &str, sequence: u64) -> Event {
        Event {
            sequence,
            admission: AdmittedObservationClassV1 {
                observation_id: ids::mint(IdKind::Observation).expect("test CSPRNG"),
                registry_version: crate::telemetry_contract::OPERATION_CLASS_REGISTRY_VERSION,
                operation_class: "test.fixture",
                telemetry_kind: kind.to_owned(),
                telemetry_projection: TelemetryProjectionModeV1::JoinedTerminal,
            },
            phase: Phase::Joined,
            generation: generation.to_owned(),
            ts_ms: 1_000,
            name: "fixture".to_owned(),
            status: Some(200),
            duration_ms: Some(4.0),
            code: None,
            correlation: None,
            release: None,
            details: None,
            priority: Priority::Normal,
            enqueued_at: Instant::now(),
        }
    }

    fn joined_named(generation: &str, kind: &str, name: &str, sequence: u64) -> Event {
        let mut event = joined(generation, kind, sequence);
        event.name = name.to_owned();
        event
    }

    fn eligible_failure_event(
        generation: &str,
        sequence: u64,
        fingerprint_version: u32,
        fingerprint_hash: &str,
        disposition: FailureDispositionV1,
        predecessor: Option<(u32, &str)>,
        message_template: Option<String>,
    ) -> Event {
        let allocation = allocate_failure_details(&FailureDetailsInputV1 {
            platform_code: Some("SNAPBACK_HANDLER_FAILED".to_owned()),
            classification: FailureClassificationV1 {
                failure_disposition: disposition,
                issue_eligible: true,
                classifier_version: CLASSIFIER_VERSION,
            },
            fingerprint_branch: crate::error_tracking::FingerprintBranchV1::Diagnostic,
            fingerprint_version: Some(fingerprint_version),
            fingerprint_hash: Some(fingerprint_hash.to_owned()),
            predecessor_fingerprint_version: predecessor.map(|value| value.0),
            predecessor_fingerprint_hash: predecessor.map(|value| value.1.to_owned()),
            status_class: None,
            app_code: None,
            error_class: None,
            subsystem: Some("functions".to_owned()),
            function: Some("messages.send".to_owned()),
            name: Some("messages.send".to_owned()),
            existing_allowlist: BTreeMap::new(),
            app_details: None,
            message_template,
            message: None,
            stack: Some("at messages.send".to_owned()),
            rejection_carriers: None,
            message_extraction_truncated: false,
            stack_extraction_truncated: false,
        })
        .expect("eligible failure fixture fits the carrier");
        let mut event = joined_named(generation, "diagnostic", "messages.send", sequence);
        event.status = Some(500);
        event.code = Some("SNAPBACK_HANDLER_FAILED".to_owned());
        event.details = Some(allocation.details);
        event
    }

    fn release_activation_event(generation: &str, sequence: u64, release: &str) -> Event {
        let mut event = joined_named(generation, "lifecycle", "release_activation", sequence);
        event.phase = Phase::Point;
        event.release = Some(release.to_owned());
        event
    }

    #[test]
    fn release_is_first_class_exact_and_admission_bound() {
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app-release", "preview-release"),
            config(),
        )
        .unwrap();
        telemetry.point(
            "lifecycle",
            "before_activation",
            Some(200),
            None,
            None,
            None,
            Priority::Reserved,
        );

        let predecessor = "release-a".repeat(1_024);
        let successor = "release-b".repeat(1_024);
        telemetry.set_release(Some(&predecessor));
        let span = telemetry.start_span(
            "live_subscribe",
            "release_capture",
            None,
            Some(json!({ "release": "payload-spoof", "cause": "fixture" })),
            true,
        );
        telemetry.set_release(Some(&successor));
        span.finish(
            Some(200),
            None,
            Some(json!({ "release": "terminal-spoof", "cause": "completed" })),
        );
        telemetry.point(
            "lifecycle",
            "after_activation",
            Some(200),
            None,
            None,
            Some(json!({ "release": "point-spoof" })),
            Priority::Reserved,
        );
        telemetry.force_flush().unwrap();

        let store = telemetry.producer.shared.store.lock().unwrap();
        let conn = store.conn.as_ref().unwrap();
        let before: Option<String> = conn
            .query_row(
                "SELECT release FROM telemetry_events WHERE name='before_activation'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(before, None, "pre-activation rows carry NULL release");
        let span_rows = conn
            .prepare(
                "SELECT phase,release,details FROM telemetry_events WHERE name='release_capture' ORDER BY id",
            )
            .unwrap()
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(span_rows.len(), 2);
        assert!(
            span_rows
                .iter()
                .all(|(_, release, _)| release.as_deref() == Some(predecessor.as_str())),
            "both admission and terminal retain the exact admission release"
        );
        for (_, _, details) in span_rows {
            let details: Value = serde_json::from_str(details.as_deref().unwrap()).unwrap();
            assert!(details.get("release").is_none());
        }
        let (release, details): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT release,details FROM telemetry_events WHERE name='after_activation'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(release.as_deref(), Some(successor.as_str()));
        let details: Value = serde_json::from_str(details.as_deref().unwrap()).unwrap();
        assert!(details.get("release").is_none());
    }

    #[test]
    fn meta_identity_is_exact_store_scoped_and_stamped_only_at_export() {
        let app_id = "app-identity".repeat(1_024);
        let environment = "environment-identity".repeat(1_024);
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity(app_id.clone(), environment.clone()),
            config(),
        )
        .unwrap();
        telemetry.point(
            "function_run",
            "identity_fixture",
            Some(200),
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();

        let mut store = telemetry.producer.shared.store.lock().unwrap();
        let conn = store.conn.as_ref().unwrap();
        let durable: (String, String) = conn
            .query_row(
                "SELECT app_id,environment FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(durable, (app_id.clone(), environment.clone()));
        let event_columns = conn
            .prepare("PRAGMA table_info(telemetry_events)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<BTreeSet<_>, _>>()
            .unwrap();
        assert!(!event_columns.contains("app_id"));
        assert!(!event_columns.contains("environment"));

        let mut record = json!({
            "observation": "obs_fixture",
            "appId": "payload-spoof",
            "environment": "payload-spoof"
        })
        .as_object()
        .unwrap()
        .clone();
        store
            .stamp_export_record(&mut record, wall_now_ms())
            .unwrap();
        assert_eq!(record["appId"], app_id);
        assert_eq!(record["environment"], environment);
    }

    #[test]
    fn unbound_store_never_fabricates_export_identity() {
        let telemetry =
            Telemetry::in_memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let mut record = Map::new();
        let error = telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .stamp_export_record(&mut record, wall_now_ms())
            .expect_err("missing production environment source fails closed");
        assert_eq!(error.diagnostic.code, "SNAPBACK_TELEMETRY_IDENTITY_UNBOUND");
        assert!(record.get("appId").is_none());
        assert!(record.get("environment").is_none());
    }

    #[test]
    fn typed_events_cursor_stats_and_export_share_the_visible_store() {
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app-query", "preview-query"),
            config(),
        )
        .unwrap();
        for (name, status, duration) in [("one", 200, 2.0), ("two", 500, 16.0)] {
            let mut event = joined("ignored", "http_request", 0);
            event.name = name.to_owned();
            event.status = Some(status);
            event.duration_ms = Some(duration);
            if status >= 500 {
                event.code = Some("SNAPBACK_FIXTURE_FAILED".to_owned());
            }
            telemetry.enqueue(event, true);
        }

        let first = telemetry
            .query_events(&crate::telemetry_query::TelemetryEventsRequestV1 {
                filter: crate::telemetry_query::TelemetryFilterV1 {
                    kind: Some("http_request".to_owned()),
                    ..Default::default()
                },
                limit: 1,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(first.events.len(), 1);
        let cursor = first.next_cursor.expect("bounded first page has cursor");
        let second = telemetry
            .query_events(&crate::telemetry_query::TelemetryEventsRequestV1 {
                filter: crate::telemetry_query::TelemetryFilterV1 {
                    kind: Some("http_request".to_owned()),
                    ..Default::default()
                },
                cursor_recorded_ts_ms: Some(cursor.recorded_ts_ms),
                cursor_id: Some(cursor.id),
                order: crate::telemetry_query::TelemetryEventOrderV1::Asc,
                limit: 1,
            })
            .unwrap();
        assert_eq!(second.events.len(), 1);
        assert_ne!(first.events[0].id, second.events[0].id);

        let newest = telemetry
            .query_events(&crate::telemetry_query::TelemetryEventsRequestV1 {
                filter: crate::telemetry_query::TelemetryFilterV1 {
                    kind: Some("http_request".to_owned()),
                    ..Default::default()
                },
                order: crate::telemetry_query::TelemetryEventOrderV1::Desc,
                limit: 1,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(
            newest.order,
            crate::telemetry_query::TelemetryEventOrderV1::Desc
        );
        assert_eq!(newest.events[0].id, second.events[0].id);
        let older_cursor = newest
            .next_cursor
            .expect("newest-first page continues older");
        let older = telemetry
            .query_events(&crate::telemetry_query::TelemetryEventsRequestV1 {
                filter: crate::telemetry_query::TelemetryFilterV1 {
                    kind: Some("http_request".to_owned()),
                    ..Default::default()
                },
                cursor_recorded_ts_ms: Some(older_cursor.recorded_ts_ms),
                cursor_id: Some(older_cursor.id),
                order: crate::telemetry_query::TelemetryEventOrderV1::Desc,
                limit: 1,
            })
            .unwrap();
        assert_eq!(older.events[0].id, first.events[0].id);

        let stats = telemetry
            .query_stats(&crate::telemetry_query::TelemetryStatsRequestV1 {
                filter: crate::telemetry_query::TelemetryStatsFilterV1 {
                    kind: Some("http_request".to_owned()),
                    ..Default::default()
                },
                ..Default::default()
            })
            .unwrap();
        assert_eq!(
            stats
                .status_counts
                .iter()
                .map(|count| (count.status_class.as_str(), count.count))
                .collect::<Vec<_>>(),
            [("ok", 1), ("error", 1)]
        );
        assert_eq!(stats.coverage.raw_tail_rows, 0);
        assert!(stats.coverage.rollup_rows > 0);

        let export_request = crate::telemetry_query::TelemetryExportRequestV1 {
            filter: crate::telemetry_query::TelemetryFilterV1 {
                kind: Some("http_request".to_owned()),
                ..Default::default()
            },
        };
        let header = telemetry.begin_export(&export_request).unwrap();
        telemetry.point(
            "http_request",
            "after_snapshot",
            Some(200),
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();
        let first_page = telemetry
            .export_page(&export_request, &header, None, 1)
            .unwrap();
        let second_page = telemetry
            .export_page(&export_request, &header, first_page.next_cursor.as_ref(), 1)
            .unwrap();
        assert_eq!(first_page.records.len(), 1);
        assert_eq!(second_page.records.len(), 1);
        assert!(second_page.next_cursor.is_none());
        let records = first_page
            .records
            .iter()
            .chain(&second_page.records)
            .collect::<Vec<_>>();
        assert!(
            records
                .iter()
                .all(|record| record.event.name != "after_snapshot")
        );
        for record in serde_json::to_value(&records).unwrap().as_array().unwrap() {
            assert_eq!(record["appId"], "app-query");
            assert_eq!(record["environment"], "preview-query");
        }
    }

    #[test]
    fn caller_rollups_group_filter_and_never_store_raw_declared_ids() {
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app-callers", "preview-callers"),
            config(),
        )
        .unwrap();
        let raw_declared_id = "agent test caller <caller@example.test>";
        let declared_key = "vR4Tof7xOOZJgFJ5wj3-yQufXiMPicPrThTlYByE8ZM";
        for (name, attribution) in [
            (
                "declared-call",
                CallerAttributionV1::declared(declared_key.to_owned()),
            ),
            (
                "declared-call",
                CallerAttributionV1::declared(declared_key.to_owned()),
            ),
            (
                "integration-call",
                CallerAttributionV1::integration("int_test".to_owned()),
            ),
            (
                "link-call",
                CallerAttributionV1::link("cplk_test".to_owned()),
            ),
            ("anonymous-call", CallerAttributionV1::anonymous()),
            ("first-party-call", CallerAttributionV1::first_party()),
        ] {
            let mut event = joined_named("ignored", "function_run", name, 0);
            event.details = Some(attribution.details());
            telemetry.enqueue(event, true);
        }
        telemetry.force_flush().unwrap();

        {
            let store = telemetry.producer.shared.store.lock().unwrap();
            let connection = store.conn.as_ref().unwrap();
            let declared: (i64, i64) = connection
                .query_row(
                    "SELECT count(*),coalesce(sum(count),0)
                     FROM telemetry_caller_rollup_hourly
                     WHERE caller_lane='declared' AND caller_key=?1",
                    params![declared_key],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();
            assert_eq!(declared, (1, 2), "same caller and bucket share one row");
            let callers: i64 = connection
                .query_row(
                    "SELECT count(DISTINCT caller_lane || ':' || caller_key)
                     FROM telemetry_caller_rollup_hourly",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(callers, 5, "different caller facts retain separate rows");
            let raw_matches: i64 = connection
                .query_row(
                    "SELECT count(*) FROM telemetry_events
                     WHERE instr(coalesce(details,''),?1)>0",
                    params![raw_declared_id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(raw_matches, 0, "raw declared e-mail never enters telemetry");
        }

        let grouped = telemetry
            .query_stats(&crate::telemetry_query::TelemetryStatsRequestV1 {
                filter: crate::telemetry_query::TelemetryStatsFilterV1 {
                    kind: Some("function_run".to_owned()),
                    ..Default::default()
                },
                group_by_caller: true,
            })
            .unwrap();
        assert_eq!(
            grouped
                .caller_counts
                .iter()
                .map(|row| (row.lane.as_str(), row.caller_key.as_str(), row.count))
                .collect::<Vec<_>>(),
            [
                ("anonymous", "anonymous", 1),
                ("declared", declared_key, 2),
                ("first-party", "", 1),
                ("integration", "int_test", 1),
                ("link", "cplk_test", 1),
            ]
        );

        let filtered = telemetry
            .query_stats(&crate::telemetry_query::TelemetryStatsRequestV1 {
                filter: crate::telemetry_query::TelemetryStatsFilterV1 {
                    kind: Some("function_run".to_owned()),
                    caller_key: Some(declared_key.to_owned()),
                    lane: Some("declared".to_owned()),
                    ..Default::default()
                },
                group_by_caller: false,
            })
            .unwrap();
        assert_eq!(
            filtered
                .status_counts
                .iter()
                .map(|row| row.count)
                .sum::<u64>(),
            2
        );
        assert!(filtered.caller_counts.is_empty());
    }

    #[test]
    fn agent_export_pages_are_bounded_snapshot_frozen_and_token_authenticated() {
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app-agent-export", "preview-agent-export"),
            config(),
        )
        .unwrap();
        for name in ["agent-one", "agent-two"] {
            telemetry.point(
                "http_request",
                name,
                Some(200),
                None,
                None,
                None,
                Priority::Normal,
            );
        }
        let key = [41_u8; 32];
        let first = telemetry
            .agent_export_page(
                &crate::telemetry_query::TelemetryAgentExportRequestV1 {
                    filter: crate::telemetry_query::TelemetryFilterV1 {
                        kind: Some("http_request".to_owned()),
                        ..Default::default()
                    },
                    max_rows: 1,
                    ..Default::default()
                },
                &key,
            )
            .unwrap();
        assert_eq!(first.page_rows, 1);
        assert_eq!(first.records.len(), 1);
        assert!(first.truncated);
        assert!(first.page_bytes <= first.declared_bounds.max_bytes);
        assert_eq!(serde_json::to_vec(&first).unwrap().len(), first.page_bytes);

        telemetry.point(
            "http_request",
            "after-agent-snapshot",
            Some(200),
            None,
            None,
            None,
            Priority::Normal,
        );
        let token = first.continuation_token.clone().unwrap();
        let second = telemetry
            .agent_export_page(
                &crate::telemetry_query::TelemetryAgentExportRequestV1 {
                    continuation_token: Some(token.clone()),
                    max_rows: 1,
                    ..Default::default()
                },
                &key,
            )
            .unwrap();
        assert_eq!(second.header.snapshot, first.header.snapshot);
        assert_eq!(second.page_rows, 1);
        assert!(!second.truncated);
        assert!(second.continuation_token.is_none());
        assert!(
            first
                .records
                .iter()
                .chain(&second.records)
                .all(|record| record.event.name != "after-agent-snapshot")
        );

        telemetry.begin_generation_transition();
        telemetry
            .finish_generation_transition("01900000-0000-7000-8000-000000000002")
            .unwrap();
        let stale = telemetry
            .agent_export_page(
                &crate::telemetry_query::TelemetryAgentExportRequestV1 {
                    continuation_token: Some(token.clone()),
                    ..Default::default()
                },
                &key,
            )
            .expect_err("reset-bound token must not resume in a new generation");
        assert_eq!(
            stale.diagnostic.code,
            "SNAPBACK_TELEMETRY_EXPORT_CONTINUATION_STALE"
        );

        let mut tampered = token.into_bytes();
        let last = tampered.last_mut().unwrap();
        *last = if *last == b'A' { b'B' } else { b'A' };
        let error = telemetry
            .agent_export_page(
                &crate::telemetry_query::TelemetryAgentExportRequestV1 {
                    continuation_token: Some(String::from_utf8(tampered).unwrap()),
                    ..Default::default()
                },
                &key,
            )
            .expect_err("tampered continuation must fail closed");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_TELEMETRY_EXPORT_CONTINUATION_INVALID"
        );
    }

    #[test]
    fn streaming_export_snapshot_rejects_generation_rebind_between_pages() {
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app-stream-reset", "preview-stream-reset"),
            config(),
        )
        .unwrap();
        for name in ["before-reset-one", "before-reset-two"] {
            telemetry.point("log", name, None, None, None, None, Priority::Normal);
        }
        let request = crate::telemetry_query::TelemetryExportRequestV1::default();
        let header = telemetry.begin_export(&request).unwrap();
        let first = telemetry.export_page(&request, &header, None, 1).unwrap();
        let cursor = first.next_cursor.expect("two rows require a second page");

        telemetry.begin_generation_transition();
        telemetry
            .finish_generation_transition("01900000-0000-7000-8000-000000000002")
            .unwrap();
        telemetry.point(
            "log",
            "successor-generation",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        let error = telemetry
            .export_page(&request, &header, Some(&cursor), 1)
            .expect_err("a frozen stream may not cross a generation/app-incarnation rebind");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_TELEMETRY_EXPORT_SNAPSHOT_STALE"
        );
    }

    #[test]
    fn typed_read_freshness_survives_a_clean_process_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("freshness.sqlite3");
        let incarnation = "01900000-0000-7000-8000-000000000001";
        let telemetry = Telemetry::open_for_database(&app_path, incarnation, config()).unwrap();
        telemetry.point(
            "http_request",
            "persisted-freshness",
            Some(200),
            None,
            None,
            None,
            Priority::Normal,
        );
        let before = telemetry
            .query_events(&crate::telemetry_query::TelemetryEventsRequestV1::default())
            .unwrap()
            .variance
            .freshness_watermark
            .expect("flushed event establishes freshness");
        drop(telemetry);

        let reopened = Telemetry::open_for_database(&app_path, incarnation, config()).unwrap();
        assert_eq!(
            reopened.diagnostics().last_flush_watermark,
            None,
            "a new process has no inherited in-memory watermark"
        );
        let events_freshness = reopened
            .query_events(&crate::telemetry_query::TelemetryEventsRequestV1::default())
            .unwrap()
            .variance
            .freshness_watermark
            .expect("events recover persisted freshness");
        let stats_freshness = reopened
            .query_stats(&crate::telemetry_query::TelemetryStatsRequestV1::default())
            .unwrap()
            .variance
            .freshness_watermark
            .expect("stats recover persisted freshness");
        assert!(events_freshness >= before);
        assert!(stats_freshness >= before);
    }

    #[test]
    fn stats_historical_partial_window_snaps_and_reports_its_actual_coverage() {
        let mut query_config = config();
        query_config.max_days = 1;
        query_config.hourly_days = 1;
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app-stats", "preview-stats"),
            query_config.clone(),
        )
        .unwrap();
        let base = wall_now_ms();
        let (generation, first_recorded, second_recorded) = {
            let mut store = telemetry.producer.shared.store.lock().unwrap();
            let generation = store.generation.clone();
            store
                .flush(
                    vec![joined_named(&generation, "http_request", "old-route", 1)],
                    BTreeMap::new(),
                    base,
                    true,
                )
                .unwrap();
            let first_recorded = store
                .conn
                .as_ref()
                .unwrap()
                .query_row(
                    "SELECT min(recorded_ts_ms) FROM telemetry_events WHERE name='old-route'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap();
            let mut failed = joined_named(&generation, "http_request", "old-route", 2);
            failed.status = Some(500);
            failed.code = Some("SNAPBACK_OLD_FAILED".to_owned());
            store
                .flush(vec![failed], BTreeMap::new(), base + 1_000, true)
                .unwrap();
            let second_recorded = store
                .conn
                .as_ref()
                .unwrap()
                .query_row(
                    "SELECT max(recorded_ts_ms) FROM telemetry_events WHERE name='old-route'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap();
            let compact_clock = base + 2 * DAY_MS;
            let tx = store.conn.as_mut().unwrap().transaction().unwrap();
            maintain(&tx, &query_config, compact_clock).unwrap();
            tx.commit().unwrap();
            store
                .flush(
                    vec![joined_named(&generation, "http_request", "new-ok", 3)],
                    BTreeMap::new(),
                    compact_clock + 1_000,
                    true,
                )
                .unwrap();
            store
                .conn
                .as_ref()
                .unwrap()
                .execute(
                    "UPDATE telemetry_rollup_daily SET folded_count=3 WHERE name='old-route'",
                    [],
                )
                .unwrap();
            (generation, first_recorded, second_recorded)
        };
        assert!(!generation.is_empty());

        let stats = telemetry
            .query_stats(&crate::telemetry_query::TelemetryStatsRequestV1 {
                filter: crate::telemetry_query::TelemetryStatsFilterV1 {
                    kind: Some("http_request".to_owned()),
                    from_ms: Some(first_recorded + 1),
                    to_ms: Some(second_recorded + 2 * DAY_MS),
                    ..Default::default()
                },
                ..Default::default()
            })
            .unwrap();
        assert!(stats.coverage.partitions.iter().any(|p| p.tier == "daily"));
        assert!(
            stats.coverage.raw_edge_rows > 0,
            "the newer partial hourly bucket remains within raw retention and is substituted"
        );
        assert_eq!(
            stats.variance.field_exactness["statusCounts"],
            "exactAtReportedSnappedBucketWindow"
        );
        assert_eq!(
            stats.variance.truncation["partialBucketOverlap"],
            json!(true)
        );
        assert_eq!(
            stats.variance.truncation["heavyHittersFoldedAsOther"],
            json!(true)
        );
        assert_eq!(stats.variance.truncation["foldedCount"], json!(3));
        assert_eq!(
            stats.variance.truncation["snappedToBucketBoundaries"],
            json!(true)
        );
        assert!(
            stats
                .coverage
                .start_ms
                .is_some_and(|start| start <= first_recorded)
        );
        assert_eq!(
            stats.variance.truncation["reportedWindow"]["startMs"],
            json!(stats.coverage.start_ms)
        );
        assert!(stats.variance.truncation["histogramPercentileErrorBounds"].is_object());
    }

    #[test]
    fn stats_partial_retained_edge_uses_raw_rows_without_double_counting() {
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app-stats-edge", "preview-stats-edge"),
            config(),
        )
        .unwrap();
        let base = wall_now_ms();
        let (second_recorded, third_recorded) = {
            let mut store = telemetry.producer.shared.store.lock().unwrap();
            let generation = store.generation.clone();
            store
                .flush(
                    vec![joined_named(&generation, "http_request", "edge-route", 1)],
                    BTreeMap::new(),
                    base,
                    true,
                )
                .unwrap();
            store
                .flush(
                    vec![joined_named(&generation, "http_request", "edge-route", 2)],
                    BTreeMap::new(),
                    base + 1,
                    true,
                )
                .unwrap();
            let second_recorded = store
                .conn
                .as_ref()
                .unwrap()
                .query_row(
                    "SELECT max(recorded_ts_ms) FROM telemetry_events WHERE name='edge-route'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap();
            store
                .flush(
                    vec![joined_named(&generation, "http_request", "edge-route", 3)],
                    BTreeMap::new(),
                    base + 2,
                    false,
                )
                .unwrap();
            let third_recorded = store
                .conn
                .as_ref()
                .unwrap()
                .query_row(
                    "SELECT max(recorded_ts_ms) FROM telemetry_events WHERE name='edge-route'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap();
            (second_recorded, third_recorded)
        };

        let stats = telemetry
            .query_stats(&crate::telemetry_query::TelemetryStatsRequestV1 {
                filter: crate::telemetry_query::TelemetryStatsFilterV1 {
                    kind: Some("http_request".to_owned()),
                    from_ms: Some(second_recorded),
                    to_ms: Some(third_recorded),
                    ..Default::default()
                },
                ..Default::default()
            })
            .unwrap();
        let total = stats
            .status_counts
            .iter()
            .map(|entry| entry.count)
            .sum::<u64>();
        assert_eq!(total, 2, "the excluded first rolled row must not leak in");
        assert_eq!(stats.coverage.rollup_rows, 0);
        assert_eq!(
            stats.coverage.raw_edge_rows, 2,
            "the public typed read flushes and rolls the pending third event before composing"
        );
        assert_eq!(stats.coverage.raw_tail_rows, 0);
        assert_eq!(stats.coverage.start_ms, Some(second_recorded));
        assert_eq!(stats.coverage.end_ms, Some(third_recorded));
        assert_eq!(
            stats.variance.truncation["rawEdgeSubstitution"],
            json!(true)
        );
        assert_eq!(
            stats.variance.truncation["snappedToBucketBoundaries"],
            json!(false)
        );
        assert_eq!(
            stats.variance.field_exactness["statusCounts"],
            "exactDisjointRollupsPlusRawTailAndRetainedEdges"
        );
        assert_eq!(
            stats
                .named_counts
                .iter()
                .find(|entry| entry.name == "edge-route")
                .map(|entry| entry.count),
            Some(2)
        );
        assert_eq!(stats.series.iter().map(|point| point.count).sum::<u64>(), 2);
    }

    #[test]
    fn stats_retained_edge_substitution_is_bucket_wide_across_names() {
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app-stats-edge-names", "preview-stats-edge-names"),
            config(),
        )
        .unwrap();
        let base = wall_now_ms();
        let (from, to) = {
            let mut store = telemetry.producer.shared.store.lock().unwrap();
            let generation = store.generation.clone();
            for (name, offset) in [("wide", 0), ("narrow", 1), ("narrow", 2), ("wide", 3)] {
                store
                    .flush(
                        vec![joined_named(&generation, "http_request", name, offset + 1)],
                        BTreeMap::new(),
                        base + i64::try_from(offset).unwrap(),
                        true,
                    )
                    .unwrap();
            }
            let connection = store.conn.as_ref().unwrap();
            let from = connection
                .query_row(
                    "SELECT min(recorded_ts_ms) FROM telemetry_events WHERE name='narrow'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap();
            let to = connection
                .query_row(
                    "SELECT max(recorded_ts_ms) FROM telemetry_events WHERE name='wide'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap();
            (from, to)
        };

        let stats = telemetry
            .query_stats(&crate::telemetry_query::TelemetryStatsRequestV1 {
                filter: crate::telemetry_query::TelemetryStatsFilterV1 {
                    kind: Some("http_request".to_owned()),
                    from_ms: Some(from),
                    to_ms: Some(to),
                    ..Default::default()
                },
                ..Default::default()
            })
            .unwrap();
        assert_eq!(
            stats
                .status_counts
                .iter()
                .map(|entry| entry.count)
                .sum::<u64>(),
            3,
            "the narrow-name rollup must not overlap the wide-name raw substitution"
        );
        assert_eq!(stats.coverage.rollup_rows, 0);
        assert_eq!(stats.coverage.raw_edge_rows, 3);
        assert_eq!(
            stats
                .named_counts
                .iter()
                .map(|entry| (entry.name.as_str(), entry.count))
                .collect::<BTreeMap<_, _>>(),
            BTreeMap::from([("narrow", 2), ("wide", 1)])
        );
    }

    #[test]
    fn named_stats_filter_reports_when_heavy_hitter_folding_can_hide_the_name() {
        let mut query_config = config();
        query_config.top_names_per_hour = 1;
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app-folded", "preview-folded"),
            query_config.clone(),
        )
        .unwrap();
        let base = wall_now_ms();
        {
            let mut store = telemetry.producer.shared.store.lock().unwrap();
            let generation = store.generation.clone();
            store
                .flush(
                    vec![
                        joined_named(&generation, "http_request", "kept-name", 1),
                        joined_named(&generation, "http_request", "z-folded-name", 2),
                    ],
                    BTreeMap::new(),
                    base,
                    true,
                )
                .unwrap();
            let tx = store.conn.as_mut().unwrap().transaction().unwrap();
            maintain(&tx, &query_config, base + HOUR_MS).unwrap();
            tx.commit().unwrap();
        }
        let stats = telemetry
            .query_stats(&crate::telemetry_query::TelemetryStatsRequestV1 {
                filter: crate::telemetry_query::TelemetryStatsFilterV1 {
                    kind: Some("http_request".to_owned()),
                    name: Some("z-folded-name".to_owned()),
                    ..Default::default()
                },
                ..Default::default()
            })
            .unwrap();
        assert!(stats.status_counts.is_empty());
        assert_eq!(
            stats.variance.field_exactness["statusCounts"],
            "boundedByHeavyHitterFolding"
        );
        assert_eq!(
            stats.variance.truncation["namedFilterMayBeFolded"],
            json!(true)
        );
        assert!(stats.variance.truncation["foldedCount"].as_u64().unwrap() > 0);
    }

    #[test]
    fn stats_refuses_raw_tail_above_the_explicit_work_bound() {
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app-stats-bound", "preview-stats-bound"),
            config(),
        )
        .unwrap();
        let error = {
            let mut store = telemetry.producer.shared.store.lock().unwrap();
            let generation = store.generation.clone();
            let base = wall_now_ms();
            let transaction = store.conn.as_mut().unwrap().transaction().unwrap();
            {
                let mut insert = transaction
                    .prepare(
                        "INSERT INTO telemetry_events(observation,phase,generation,class_v,ts_ms,recorded_ts_ms,kind,name,status,duration_ms,subject,code,correlation,release,details) VALUES(?1,'joined',?2,1,?3,?3,'http_request','bounded-route',200,1.0,NULL,NULL,NULL,NULL,NULL)",
                    )
                    .unwrap();
                for index in 0..=crate::telemetry_query::MAX_STATS_RAW_TAIL_ROWS {
                    insert
                        .execute(rusqlite::params![
                            format!("obs-stats-bound-{index}"),
                            generation,
                            base + i64::try_from(index + 1).unwrap(),
                        ])
                        .unwrap();
                }
            }
            transaction.commit().unwrap();
            let connection = store.conn.as_ref().unwrap();
            crate::telemetry_query::query_stats(
                connection,
                &crate::telemetry_query::TelemetryStatsRequestV1::default(),
                &crate::telemetry_query::QueryContext {
                    drops_since_boot: BTreeMap::new(),
                    last_flush_watermark: None,
                },
            )
            .expect_err("an unbounded raw tail must require a narrower filter")
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_TELEMETRY_STATS_WORK_LIMIT_EXCEEDED"
        );
        assert_eq!(
            error.diagnostic.details["maximumRows"],
            json!(crate::telemetry_query::MAX_STATS_RAW_TAIL_ROWS)
        );
    }

    #[test]
    fn typed_query_validation_fails_before_store_read() {
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app-query", "preview-query"),
            config(),
        )
        .unwrap();
        let error = telemetry
            .query_events(&crate::telemetry_query::TelemetryEventsRequestV1 {
                cursor_recorded_ts_ms: Some(1),
                cursor_id: None,
                ..Default::default()
            })
            .expect_err("half cursor refuses");
        assert_eq!(error.diagnostic.code, "SNAPBACK_TELEMETRY_QUERY_INVALID");
    }

    #[test]
    fn explicit_store_identity_rejects_empty_axes() {
        for (app_id, environment) in [("", "preview"), ("app", ""), ("   ", "preview")] {
            let error = TelemetryStoreIdentity::new(app_id, environment)
                .expect_err("an empty identity axis is not a trusted store binding");
            assert_eq!(error.diagnostic.code, "SNAPBACK_TELEMETRY_IDENTITY_INVALID");
        }
    }

    #[test]
    fn corrupt_pinned_identity_cannot_become_a_self_describing_export() {
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app", "preview"),
            config(),
        )
        .unwrap();
        let mut store = telemetry.producer.shared.store.lock().unwrap();
        for (app_id, environment) in [("", "preview"), ("app", "   ")] {
            store
                .conn
                .as_ref()
                .unwrap()
                .execute(
                    "UPDATE telemetry_meta SET app_id=?1,environment=?2 WHERE singleton=1",
                    params![app_id, environment],
                )
                .unwrap();
            let mut record = Map::new();
            let error = store
                .stamp_export_record(&mut record, wall_now_ms())
                .expect_err("corrupt pinned identity fails closed at egress");
            assert_eq!(error.diagnostic.code, "SNAPBACK_TELEMETRY_IDENTITY_INVALID");
            assert!(record.get("appId").is_none());
            assert!(record.get("environment").is_none());
        }
    }

    #[test]
    fn priority_buffer_sheds_normal_oldest_before_reserved() {
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                buffer_capacity: 4,
                priority_reserve: 2,
                batch_size: 64,
                ..config()
            },
        )
        .unwrap();
        telemetry.point("log", "one", None, None, None, None, Priority::Normal);
        telemetry.point("log", "two", None, None, None, None, Priority::Normal);
        telemetry.point("log", "three", None, None, None, None, Priority::Normal);
        telemetry.point(
            "diagnostic",
            "failure",
            Some(500),
            Some("E"),
            None,
            None,
            Priority::Reserved,
        );
        let diagnostics = telemetry.diagnostics();
        assert_eq!(diagnostics.normal_depth, 2);
        assert_eq!(diagnostics.reserved_depth, 1);
        assert_eq!(diagnostics.drops_since_boot.values().sum::<u64>(), 1);
    }

    #[test]
    fn long_lived_admissions_cannot_consume_or_evict_failure_reserve() {
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                buffer_capacity: 4,
                priority_reserve: 2,
                batch_size: 64,
                ..config()
            },
        )
        .unwrap();
        for name in ["failure-one", "failure-two"] {
            telemetry.point(
                "diagnostic",
                name,
                Some(500),
                Some("SNAPBACK_TEST_FAILURE"),
                None,
                None,
                Priority::Reserved,
            );
        }
        let spans = (0..8)
            .map(|index| {
                telemetry.start_span("ws_connect", &format!("socket-{index}"), None, None, true)
            })
            .collect::<Vec<_>>();

        let diagnostics = telemetry.diagnostics();
        assert_eq!(diagnostics.depth, 4);
        assert_eq!(diagnostics.normal_depth, 2);
        assert_eq!(diagnostics.reserved_depth, 2);
        assert_eq!(diagnostics.drops_since_boot.values().sum::<u64>(), 6);
        let buffer = telemetry.producer.shared.buffer.lock().unwrap();
        assert_eq!(
            buffer
                .reserved
                .iter()
                .map(|event| event.name.as_str())
                .collect::<Vec<_>>(),
            ["failure-one", "failure-two"],
            "admission pressure cannot consume or evict failure reserve"
        );
        assert!(
            buffer
                .normal
                .iter()
                .all(|event| event.phase == Phase::Admission),
            "long-lived admissions remain in the normal class"
        );
        drop(buffer);
        for span in spans {
            span.finish(Some(200), None, None);
        }
    }

    #[test]
    fn reserved_saturation_never_allows_normal_to_exceed_total_capacity() {
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                buffer_capacity: 4,
                priority_reserve: 2,
                batch_size: 64,
                ..config()
            },
        )
        .unwrap();
        for name in ["a", "b", "c", "d"] {
            telemetry.point(
                "diagnostic",
                name,
                Some(500),
                Some("E"),
                None,
                None,
                Priority::Reserved,
            );
        }
        telemetry.point("log", "late", None, None, None, None, Priority::Normal);
        let diagnostics = telemetry.diagnostics();
        assert_eq!(diagnostics.depth, 4);
        assert_eq!(diagnostics.reserved_depth, 4);
        assert_eq!(diagnostics.normal_depth, 0);
        assert_eq!(diagnostics.drops_since_boot.values().sum::<u64>(), 1);
    }

    #[test]
    fn current_admission_stamps_generation_at_the_enqueue_linearization_point() {
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                batch_size: 64,
                ..config()
            },
        )
        .unwrap();
        let predecessor = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        telemetry.begin_generation_transition();
        telemetry
            .finish_generation_transition_with_identity(
                "01900000-0000-7000-8000-000000000002",
                identity("generation-app", "generation-environment"),
            )
            .unwrap();
        let successor = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();

        // Model a producer that prepared an event before the rotation but did
        // not reach the admission lock until afterward. Current-generation
        // admissions must be rebound at that lock, never retain the stale tag.
        telemetry.enqueue_current(joined(&predecessor, "function_run", 1));
        let admitted_generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .normal
            .front()
            .unwrap()
            .generation
            .clone();
        assert_ne!(predecessor, successor);
        assert_eq!(admitted_generation, successor);
    }

    #[test]
    fn force_flush_and_shutdown_drain_more_than_one_batch() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let config = TelemetryConfig {
            buffer_capacity: 16,
            priority_reserve: 2,
            batch_size: 2,
            max_age_ms: 60_000,
            ..TelemetryConfig::default()
        };
        let telemetry = Telemetry::open_for_database(
            &app_path,
            "01900000-0000-7000-8000-000000000001",
            config.clone(),
        )
        .unwrap();
        let generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        {
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            for sequence in 1..=5 {
                enqueue_locked(
                    &mut buffer,
                    &config,
                    joined(&generation, "function_run", sequence),
                );
            }
        }
        telemetry.force_flush().unwrap();
        let count: i64 = telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT count(*) FROM telemetry_events", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 5, "force_flush must drain every queued batch");
        let (flush_commits, event_flushes): (i64, i64) = telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT
                   (SELECT flush_commit_sequence FROM telemetry_meta WHERE singleton=1),
                   count(DISTINCT flush_sequence)
                 FROM telemetry_events",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            flush_commits, 3,
            "one durable sequence per flush transaction"
        );
        assert_eq!(event_flushes, 3, "events retain their transaction sequence");

        {
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            for sequence in 6..=10 {
                enqueue_locked(
                    &mut buffer,
                    &config,
                    joined(&generation, "function_run", sequence),
                );
            }
        }
        telemetry.ensure_worker();
        drop(telemetry);

        let conn = Connection::open(telemetry_path).unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM telemetry_events", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            count, 11,
            "final producer drop drains work plus graceful shutdown"
        );
        let clean: i64 = conn
            .query_row(
                "SELECT clean_shutdown FROM telemetry_meta WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(clean, 1, "clean publishes only after the drain commits");
    }

    #[test]
    fn successful_long_lived_terminal_uses_reserved_capacity() {
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                buffer_capacity: 4,
                priority_reserve: 2,
                batch_size: 64,
                max_age_ms: 60_000,
                ..config()
            },
        )
        .unwrap();
        let span = telemetry.start_span("live_subscribe", "query", None, None, true);
        for name in ["one", "two", "three"] {
            telemetry.point("log", name, None, None, None, None, Priority::Normal);
        }
        span.finish(Some(200), None, Some(json!({ "cause": "unsubscribed" })));
        let buffer = telemetry.producer.shared.buffer.lock().unwrap();
        assert!(
            buffer
                .reserved
                .iter()
                .any(|event| event.phase == Phase::Terminal && event.status == Some(200)),
            "successful terminal survives normal-pressure shedding"
        );
    }

    #[test]
    fn dropped_short_span_records_one_reserved_cancellation() {
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                batch_size: 64,
                max_age_ms: 60_000,
                ..config()
            },
        )
        .unwrap();
        let span = telemetry.start_span("http_request", "/cancelled", None, None, false);
        drop(span);
        let buffer = telemetry.producer.shared.buffer.lock().unwrap();
        let cancelled = buffer
            .reserved
            .iter()
            .filter(|event| {
                event.phase == Phase::Joined
                    && event.status == Some(499)
                    && event.name == "/cancelled"
            })
            .collect::<Vec<_>>();
        assert_eq!(cancelled.len(), 1);
        assert_eq!(cancelled[0].code, None);
        assert_eq!(cancelled[0].details.as_ref().unwrap()["cause"], "cancelled");
    }

    #[test]
    fn bound_terminals_rejected_during_fences_are_counted() {
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                batch_size: 64,
                max_age_ms: 60_000,
                ..config()
            },
        )
        .unwrap();
        let generation_span =
            telemetry.start_span("live_subscribe", "generation", None, None, true);
        telemetry.begin_generation_transition();
        generation_span.finish(Some(200), None, Some(json!({ "cause": "reset" })));

        telemetry.cancel_generation_transition();
        let config_span = telemetry.start_span("ws_connect", "config", None, None, true);
        {
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            buffer.config_fenced = true;
            buffer.accepting = false;
        }
        config_span.finish(Some(200), None, Some(json!({ "cause": "disconnected" })));

        let diagnostics = telemetry.diagnostics();
        assert_eq!(
            diagnostics
                .drops_since_boot
                .get("live_subscribe:reserved:generationFence"),
            Some(&1),
            "the late terminal is counted against reserved capacity"
        );
        assert_eq!(
            diagnostics
                .drops_since_boot
                .get("live_subscribe:normal:generationFence"),
            Some(&1),
            "the drained admission is counted against normal capacity"
        );
        assert_eq!(
            diagnostics
                .drops_since_boot
                .get("ws_connect:reserved:configTransition"),
            Some(&1)
        );
    }

    #[test]
    fn disabled_force_flush_preserves_first_enabled_boot_maintenance() {
        let mut disabled = config();
        disabled.max_days = 0;
        let telemetry =
            Telemetry::in_memory("01900000-0000-7000-8000-000000000001", disabled.clone()).unwrap();
        telemetry.force_flush().unwrap();
        assert!(
            telemetry
                .producer
                .shared
                .boot_maintenance_pending
                .load(Ordering::Acquire),
            "the whole-subsystem off switch cannot consume boot maintenance"
        );
        disabled.max_days = 7;
        telemetry.update_config(disabled).unwrap();
        telemetry.point(
            "log",
            "first_enabled",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();
        assert!(
            !telemetry
                .producer
                .shared
                .boot_maintenance_pending
                .load(Ordering::Acquire),
            "the first enabled flush consumes boot maintenance"
        );
    }

    #[test]
    fn clean_and_unclean_boot_ownership_and_disabled_mode_are_exact() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let incarnation = "01900000-0000-7000-8000-000000000001";

        let clean = Telemetry::open_for_database(&app_path, incarnation, config()).unwrap();
        drop(clean);
        let reopened = Telemetry::open_for_database(&app_path, incarnation, config()).unwrap();
        reopened.force_flush().unwrap();
        let clean_detection: i64 = reopened
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM telemetry_events WHERE name='detected_unclean_predecessor'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(clean_detection, 0, "a clean predecessor is not accused");
        drop(reopened);

        Connection::open(&telemetry_path)
            .unwrap()
            .execute(
                "UPDATE telemetry_meta SET clean_shutdown=0 WHERE singleton=1",
                [],
            )
            .unwrap();
        let crashed = Telemetry::open_for_database(&app_path, incarnation, config()).unwrap();
        crashed.force_flush().unwrap();
        let crash_detection: i64 = crashed
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM telemetry_events WHERE name='detected_unclean_predecessor'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(crash_detection, 1, "the next boot records one crash marker");
        drop(crashed);

        let disabled_app = dir.path().join("disabled.sqlite3");
        let disabled_path = Telemetry::path_for_database(&disabled_app);
        let disabled = Telemetry::open_for_database(
            &disabled_app,
            incarnation,
            TelemetryConfig {
                max_days: 0,
                ..config()
            },
        )
        .unwrap();
        drop(disabled);
        assert!(
            !disabled_path.exists(),
            "max_days=0 does not create persistence solely for boot ownership"
        );
    }

    #[test]
    fn legacy_store_migration_adds_observability_and_error_store_without_relabeling_rows() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("legacy.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let predecessor_generation = ids::mint(IdKind::Generation).unwrap();
        let incarnation = "01900000-0000-7000-8000-000000000001";
        let now = wall_now_ms();
        let conn = Connection::open(&telemetry_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE telemetry_meta (
               singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
               generation TEXT NOT NULL,
               app_db_incarnation TEXT NOT NULL,
               max_days_mirror INTEGER NOT NULL,
               retention_floor INTEGER NOT NULL,
               observation_clock_ms INTEGER NOT NULL,
               aggregate_floor_hourly INTEGER NOT NULL,
               aggregate_floor_daily INTEGER NOT NULL,
               rollup_watermark_id INTEGER NOT NULL,
               last_sweep_ms INTEGER NOT NULL,
               drop_counters_lifetime TEXT NOT NULL,
               hourly_days INTEGER NOT NULL,
               daily_days INTEGER NOT NULL,
               clean_shutdown INTEGER NOT NULL DEFAULT 1 CHECK (clean_shutdown IN (0, 1))
             );
             CREATE TABLE telemetry_events (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               observation TEXT NOT NULL,
               phase TEXT NOT NULL,
               generation TEXT NOT NULL,
               class_v INTEGER NOT NULL,
               ts_ms INTEGER NOT NULL,
               recorded_ts_ms INTEGER NOT NULL,
               kind TEXT NOT NULL,
               name TEXT NOT NULL,
               status INTEGER,
               duration_ms REAL,
               subject TEXT CHECK (subject IS NULL),
               code TEXT,
               correlation TEXT,
               details TEXT
             );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO telemetry_meta(singleton,generation,app_db_incarnation,max_days_mirror,retention_floor,observation_clock_ms,aggregate_floor_hourly,aggregate_floor_daily,rollup_watermark_id,last_sweep_ms,drop_counters_lifetime,hourly_days,daily_days,clean_shutdown) VALUES(1,?1,?2,7,0,?3,0,0,0,0,'{}',90,730,1)",
            params![predecessor_generation, incarnation, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO telemetry_events(observation,phase,generation,class_v,ts_ms,recorded_ts_ms,kind,name,status,duration_ms,subject,code,correlation,details) VALUES(?1,'joined',?2,1,?3,?3,'function_run','legacy',200,1.0,NULL,NULL,NULL,NULL)",
            params![ids::mint(IdKind::Observation).unwrap(), predecessor_generation, now],
        )
        .unwrap();
        drop(conn);

        let app_id = "migration-app".repeat(512);
        let environment = "migration-environment".repeat(512);
        let telemetry = Telemetry::open_for_database_with_identity(
            &app_path,
            incarnation,
            identity(app_id.clone(), environment.clone()),
            config(),
        )
        .unwrap();
        let store = telemetry.producer.shared.store.lock().unwrap();
        let conn = store.conn.as_ref().unwrap();
        let meta_columns = conn
            .prepare("PRAGMA table_info(telemetry_meta)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<BTreeSet<_>, _>>()
            .unwrap();
        assert!(meta_columns.contains("app_id"));
        assert!(meta_columns.contains("environment"));
        assert!(meta_columns.contains("flush_commit_sequence"));
        for column in [
            "enqueue_high_water",
            "overflow_fold_count",
            "classifier_disposition_mismatch_count",
            "malformed_error_stamp_count",
            "release_activation_floor_seq",
            "rollout_from_version",
            "rollout_to_version",
            "rollout_started_ms",
            "rollout_expires_ms",
        ] {
            assert!(meta_columns.contains(column), "missing migrated {column}");
        }
        let event_columns = conn
            .prepare("PRAGMA table_info(telemetry_events)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<BTreeSet<_>, _>>()
            .unwrap();
        assert!(event_columns.contains("release"));
        assert!(event_columns.contains("flush_sequence"));
        for relation in [
            "error_groups",
            "error_exemplars",
            "error_transitions",
            "release_activations",
            "error_groups_visible",
            "error_exemplars_visible",
            "error_transitions_visible",
            "release_activations_visible",
        ] {
            assert_eq!(
                conn.query_row(
                    "SELECT count(*) FROM sqlite_master WHERE name=?1",
                    params![relation],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
                1,
                "missing migrated relation {relation}"
            );
        }
        let exemplar_columns = conn
            .prepare("PRAGMA table_info(error_exemplars)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<BTreeSet<_>, _>>()
            .unwrap();
        assert!(exemplar_columns.contains("recorded_seq"));
        let group_columns = conn
            .prepare("PRAGMA table_info(error_groups)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<BTreeSet<_>, _>>()
            .unwrap();
        for column in [
            "exemplar_depth_drop_count",
            "exemplar_byte_drop_count",
            "exemplar_flush_drop_count",
        ] {
            assert!(group_columns.contains(column));
        }
        let visible_columns = conn
            .prepare("PRAGMA table_info(telemetry_events_visible)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<BTreeSet<_>, _>>()
            .unwrap();
        assert!(
            !visible_columns.contains("flush_sequence"),
            "the proof-only transaction witness is absent from the public view"
        );
        let (generation, durable_app, durable_environment): (String, String, String) = conn
            .query_row(
                "SELECT generation,app_id,environment FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_ne!(generation, predecessor_generation);
        assert_eq!((durable_app, durable_environment), (app_id, environment));
        let (release, visible): (Option<String>, i64) = conn
            .query_row(
                "SELECT
                   (SELECT release FROM telemetry_events WHERE name='legacy'),
                   (SELECT count(*) FROM telemetry_events_visible WHERE name='legacy')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(release, None, "pre-column rows migrate as NULL release");
        let (flush_commit_sequence, legacy_flush_sequence): (i64, i64) = conn
            .query_row(
                "SELECT
                   flush_commit_sequence,
                   (SELECT flush_sequence FROM telemetry_events WHERE name='legacy')
                 FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            flush_commit_sequence, 0,
            "migration itself is not an event flush"
        );
        assert_eq!(
            legacy_flush_sequence, 0,
            "legacy rows have no fabricated flush witness"
        );
        assert_eq!(
            visible, 0,
            "identity-less predecessor rows are hidden, never relabeled"
        );
    }

    #[test]
    fn failed_shutdown_drain_never_marks_the_predecessor_clean() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let telemetry = Telemetry::open_for_database(
            &app_path,
            "01900000-0000-7000-8000-000000000001",
            config(),
        )
        .unwrap();
        telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .fail_before_commit = true;
        drop(telemetry);
        let conn = Connection::open(telemetry_path).unwrap();
        let clean: i64 = conn
            .query_row(
                "SELECT clean_shutdown FROM telemetry_meta WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(clean, 0, "failed graceful flush remains detectably unclean");
        let graceful: i64 = conn
            .query_row(
                "SELECT count(*) FROM telemetry_events WHERE name='graceful_shutdown'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(graceful, 0, "a rolled-back marker cannot authorize clean");
    }

    #[test]
    fn deleting_live_sibling_regenerates_on_the_next_write() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let telemetry = Telemetry::open_for_database(
            &app_path,
            "01900000-0000-7000-8000-000000000001",
            config(),
        )
        .unwrap();
        let predecessor_generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        telemetry.point(
            "log",
            "before_delete",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();
        for path in [
            telemetry_path.clone(),
            PathBuf::from(format!("{}-wal", telemetry_path.display())),
            PathBuf::from(format!("{}-shm", telemetry_path.display())),
        ] {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => panic!("remove telemetry sibling: {error}"),
            }
        }
        telemetry.point(
            "log",
            "delete_detection_batch",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();
        telemetry.point(
            "log",
            "after_delete",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();
        let successor_generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        assert_ne!(predecessor_generation, successor_generation);
        assert!(
            telemetry_path.exists(),
            "the next write recreates the sibling"
        );
        let conn = Connection::open(&telemetry_path).unwrap();
        let (detection_rows, visible, durable_generation, lifetime): (i64, i64, String, String) =
            conn.query_row(
                "SELECT
                    (SELECT count(*) FROM telemetry_events WHERE name='delete_detection_batch'),
                    (SELECT count(*) FROM telemetry_events_visible WHERE name='after_delete'),
                    generation,
                    drop_counters_lifetime
                 FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            detection_rows, 0,
            "the replacement-detection batch is dropped"
        );
        assert_eq!(visible, 1, "the regenerated write is durably visible");
        assert_eq!(durable_generation, successor_generation);
        let key = "log:normal:storeReplaced";
        assert_eq!(telemetry.diagnostics().drops_since_boot.get(key), Some(&1));
        let lifetime: BTreeMap<String, u64> = serde_json::from_str(&lifetime).unwrap();
        assert_eq!(lifetime.get(key), Some(&1));
    }

    #[cfg(unix)]
    #[test]
    fn telemetry_store_refuses_symlink_to_app_database_without_mutating_it() {
        use std::os::unix::fs::{MetadataExt as _, symlink};

        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let app = Connection::open(&app_path).unwrap();
        app.execute_batch(
            "CREATE TABLE app_only(value TEXT); INSERT INTO app_only VALUES('safe');",
        )
        .unwrap();
        drop(app);
        let mode_before = fs::metadata(&app_path).unwrap().mode();
        symlink(&app_path, &telemetry_path).unwrap();

        assert!(
            Telemetry::open_for_database(
                &app_path,
                "01900000-0000-7000-8000-000000000001",
                config(),
            )
            .is_err()
        );
        let app = Connection::open(&app_path).unwrap();
        let value: String = app
            .query_row("SELECT value FROM app_only", [], |row| row.get(0))
            .unwrap();
        let telemetry_tables: i64 = app
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name LIKE 'telemetry_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value, "safe");
        assert_eq!(telemetry_tables, 0);
        assert_eq!(fs::metadata(&app_path).unwrap().mode(), mode_before);
    }

    #[cfg(unix)]
    #[test]
    fn telemetry_store_refuses_hardlink_to_app_database_without_mutating_it() {
        use std::os::unix::fs::MetadataExt as _;

        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let app = Connection::open(&app_path).unwrap();
        app.execute_batch(
            "CREATE TABLE app_only(value TEXT); INSERT INTO app_only VALUES('safe');",
        )
        .unwrap();
        drop(app);
        let mode_before = fs::metadata(&app_path).unwrap().mode();
        fs::hard_link(&app_path, &telemetry_path).unwrap();

        assert!(
            Telemetry::open_for_database(
                &app_path,
                "01900000-0000-7000-8000-000000000001",
                config(),
            )
            .is_err()
        );
        let app = Connection::open(&app_path).unwrap();
        let value: String = app
            .query_row("SELECT value FROM app_only", [], |row| row.get(0))
            .unwrap();
        let telemetry_tables: i64 = app
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name LIKE 'telemetry_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value, "safe");
        assert_eq!(telemetry_tables, 0);
        assert_eq!(fs::metadata(&app_path).unwrap().mode(), mode_before);
    }

    #[test]
    fn replacing_live_sibling_mints_fresh_generation_for_later_flushes() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let replacement_app = dir.path().join("replacement.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let replacement_path = Telemetry::path_for_database(&replacement_app);
        let incarnation = "01900000-0000-7000-8000-000000000001";
        let telemetry = Telemetry::open_for_database(&app_path, incarnation, config()).unwrap();
        let predecessor_generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        telemetry.point("log", "seed", None, None, None, None, Priority::Normal);
        telemetry.force_flush().unwrap();

        let replacement =
            Telemetry::open_for_database(&replacement_app, incarnation, config()).unwrap();
        replacement.point(
            "log",
            "replacement_seed",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        replacement.force_flush().unwrap();
        drop(replacement);
        fs::rename(&replacement_path, &telemetry_path).unwrap();

        telemetry.point(
            "log",
            "replacement_detection_batch",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();
        let successor_generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        assert_ne!(predecessor_generation, successor_generation);
        telemetry.point(
            "log",
            "after_replace_one",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();
        telemetry.point(
            "log",
            "after_replace_two",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();

        let conn = Connection::open(&telemetry_path).unwrap();
        let (detection_rows, visible, durable_generation, lifetime):
            (i64, i64, String, String) = conn
            .query_row(
                "SELECT
                    (SELECT count(*) FROM telemetry_events WHERE name='replacement_detection_batch'),
                    (SELECT count(*) FROM telemetry_events_visible WHERE name IN ('after_replace_one','after_replace_two')),
                    generation,
                    drop_counters_lifetime
                 FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            detection_rows, 0,
            "the replacement-detection batch is dropped"
        );
        assert_eq!(visible, 2, "later batches retain the rebound generation");
        assert_eq!(durable_generation, successor_generation);
        let key = "log:normal:storeReplaced";
        assert_eq!(telemetry.diagnostics().drops_since_boot.get(key), Some(&1));
        let lifetime: BTreeMap<String, u64> = serde_json::from_str(&lifetime).unwrap();
        assert_eq!(lifetime.get(key), Some(&1));
        let replacement_visible: i64 = conn
            .query_row(
                "SELECT count(*) FROM telemetry_events_visible WHERE name='replacement_seed'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(replacement_visible, 0, "replacement rows stay invisible");
    }

    #[test]
    fn panic_drop_preserves_unclean_boot_detection() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let incarnation = "01900000-0000-7000-8000-000000000001";
        let panic = std::panic::catch_unwind({
            let app_path = app_path.clone();
            move || {
                let telemetry =
                    Telemetry::open_for_database(&app_path, incarnation, config()).unwrap();
                telemetry.point(
                    "log",
                    "panic_probe",
                    None,
                    None,
                    None,
                    None,
                    Priority::Normal,
                );
                telemetry.force_flush().unwrap();
                panic!("simulated process panic");
            }
        });
        assert!(panic.is_err());
        let reopened = Telemetry::open_for_database(&app_path, incarnation, config()).unwrap();
        reopened.force_flush().unwrap();
        let detected: i64 = reopened
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM telemetry_events WHERE name='detected_unclean_predecessor'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(detected, 1);
    }

    #[test]
    fn drop_counters_alone_arm_the_worker_and_persist() {
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                batch_size: 64,
                max_age_ms: 1,
                ..TelemetryConfig::default()
            },
        )
        .unwrap();
        let generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        {
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            buffer.count_drop(&joined(&generation, "function_run", 1), "generationFence");
        }
        telemetry.ensure_worker();
        telemetry.producer.shared.wake.notify_one();

        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            let encoded: String = telemetry
                .producer
                .shared
                .store
                .lock()
                .unwrap()
                .conn
                .as_ref()
                .unwrap()
                .query_row(
                    "SELECT drop_counters_lifetime FROM telemetry_meta WHERE singleton=1",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            let counters: BTreeMap<String, u64> = serde_json::from_str(&encoded).unwrap();
            if counters.values().sum::<u64>() == 1 {
                break;
            }
            assert!(Instant::now() < deadline, "drop-only work never flushed");
            std::thread::yield_now();
        }
    }

    #[test]
    fn rebind_and_config_failures_leave_memory_and_meta_consistent() {
        let mut store = Store::memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let original_generation = store.generation.clone();
        let original_incarnation = store.app_db_incarnation.clone();
        let original_config = store.config.clone();
        store.fail_rebind = true;
        assert!(
            store
                .rebind("01900000-0000-7000-8000-000000000002", wall_now_ms())
                .is_err()
        );
        let durable_binding: (String, String) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT generation,app_db_incarnation FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(store.generation, original_generation);
        assert_eq!(store.app_db_incarnation, original_incarnation);
        assert_eq!(durable_binding, (original_generation, original_incarnation));

        store.fail_rebind = false;
        store.fail_update_config = true;
        let mut replacement = original_config.clone();
        replacement.max_days = 30;
        assert!(store.update_config(replacement, wall_now_ms()).is_err());
        let durable_max_days: u32 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT max_days_mirror FROM telemetry_meta WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(store.config, original_config);
        assert_eq!(durable_max_days, original_config.max_days);
    }

    #[test]
    fn config_disable_transition_drops_predecessor_work_without_resurrection() {
        let enabled = TelemetryConfig {
            batch_size: 64,
            max_age_ms: 60_000,
            ..TelemetryConfig::default()
        };
        let telemetry =
            Telemetry::in_memory("01900000-0000-7000-8000-000000000001", enabled.clone()).unwrap();
        let generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        {
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            enqueue_locked(&mut buffer, &enabled, joined(&generation, "pre_disable", 1));
        }

        telemetry
            .update_config(TelemetryConfig {
                max_days: 0,
                ..enabled.clone()
            })
            .unwrap();
        telemetry.point(
            "function_run",
            "while_disabled",
            Some(200),
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.update_config(enabled).unwrap();
        telemetry.point(
            "function_run",
            "after_reenable",
            Some(200),
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();

        let store = telemetry.producer.shared.store.lock().unwrap();
        let names = store
            .conn
            .as_ref()
            .unwrap()
            .prepare("SELECT name FROM telemetry_events_visible ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(names, vec!["after_reenable"]);
    }

    #[test]
    fn flush_is_atomic_when_commit_fails() {
        let mut store = Store::memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        store.fail_before_commit = true;
        assert!(
            store
                .flush(
                    vec![joined(&generation, "function_run", 1)],
                    BTreeMap::new(),
                    2_000,
                    false
                )
                .is_err()
        );
        let (count, flush_commit_sequence): (i64, i64) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT
                   (SELECT count(*) FROM telemetry_events),
                   flush_commit_sequence
                 FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(count, 0);
        assert_eq!(
            flush_commit_sequence, 0,
            "a rolled-back transaction cannot fabricate a flush witness"
        );
    }

    #[test]
    fn max_days_7_to_1_to_7_without_sweep_never_resurrects_raw_rows() {
        let mut store = Store::memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        let day = DAY_MS;
        let base: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT observation_clock_ms FROM telemetry_meta",
                [],
                |row| row.get(0),
            )
            .unwrap();
        store
            .flush(
                vec![joined(&generation, "function_run", 1)],
                BTreeMap::new(),
                base + day,
                false,
            )
            .unwrap();
        store
            .update_config(
                TelemetryConfig {
                    max_days: 1,
                    ..config()
                },
                base + 10 * day,
            )
            .unwrap();
        store
            .update_config(
                TelemetryConfig {
                    max_days: 7,
                    ..config()
                },
                base + 10 * day,
            )
            .unwrap();
        let (raw, visible): (i64, i64) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT (SELECT count(*) FROM telemetry_events),
                        (SELECT count(*) FROM telemetry_events_visible)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            raw, 1,
            "no maintenance sweep occurred during the transition"
        );
        assert_eq!(
            visible, 0,
            "raising retention cannot resurrect a hidden raw row"
        );
    }

    #[test]
    fn max_days_n_to_0_to_n_without_sweep_exposes_only_later_batches() {
        let mut store = Store::memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        let base: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT observation_clock_ms FROM telemetry_meta",
                [],
                |row| row.get(0),
            )
            .unwrap();
        store
            .flush(
                vec![joined_named(
                    &generation,
                    "function_run",
                    "before_disable",
                    1,
                )],
                BTreeMap::new(),
                base + 1,
                false,
            )
            .unwrap();
        store
            .update_config(
                TelemetryConfig {
                    max_days: 0,
                    ..config()
                },
                base + 100,
            )
            .unwrap();
        store
            .update_config(
                TelemetryConfig {
                    max_days: 7,
                    ..config()
                },
                base - HOUR_MS,
            )
            .unwrap();
        store
            .flush(
                vec![joined_named(
                    &generation,
                    "function_run",
                    "after_reenable",
                    2,
                )],
                BTreeMap::new(),
                base - HOUR_MS,
                false,
            )
            .unwrap();
        let (raw, visible, recorded, floor): (i64, i64, i64, i64) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT
                   (SELECT count(*) FROM telemetry_events),
                   (SELECT count(*) FROM telemetry_events_visible),
                   (SELECT recorded_ts_ms FROM telemetry_events WHERE name='after_reenable'),
                   retention_floor
                 FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            raw, 2,
            "no intervening sweep physically deletes the predecessor"
        );
        assert_eq!(visible, 1, "only the post-enable batch is visible");
        assert!(
            recorded > floor,
            "rollback still issues a stamp above the disable floor"
        );
    }

    #[test]
    fn clock_rollback_against_retention_floor_never_resurrects_hidden_rows() {
        let mut store = Store::memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        let base: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT observation_clock_ms FROM telemetry_meta",
                [],
                |row| row.get(0),
            )
            .unwrap();
        store
            .flush(
                vec![joined_named(&generation, "function_run", "before_floor", 1)],
                BTreeMap::new(),
                base + DAY_MS,
                false,
            )
            .unwrap();
        store
            .update_config(
                TelemetryConfig {
                    max_days: 1,
                    ..config()
                },
                base + 10 * DAY_MS,
            )
            .unwrap();
        let (floor, prior_clock): (i64, i64) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT retention_floor,observation_clock_ms FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        store
            .flush(
                vec![joined_named(
                    &generation,
                    "function_run",
                    "after_rollback",
                    2,
                )],
                BTreeMap::new(),
                base.saturating_sub(10 * DAY_MS),
                false,
            )
            .unwrap();
        let (current_floor, clock, visible, recorded): (i64, i64, i64, i64) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT retention_floor,
                        observation_clock_ms,
                        (SELECT count(*) FROM telemetry_events_visible),
                        (SELECT recorded_ts_ms FROM telemetry_events WHERE name='after_rollback')
                 FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert!(
            current_floor >= floor,
            "wall-clock rollback cannot relax the floor"
        );
        assert!(clock > prior_clock, "freshness high-water remains monotone");
        assert!(
            recorded > current_floor,
            "the later batch receives a post-floor cursor"
        );
        assert_eq!(visible, 1, "only the later batch remains visible");
    }

    #[test]
    fn reset_in_flight_generation_race_hides_predecessor_rows() {
        let mut store = Store::memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let predecessor = store.generation.clone();
        store
            .rebind("01900000-0000-7000-8000-000000000002", 2_000)
            .unwrap();
        let clock: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT observation_clock_ms FROM telemetry_meta",
                [],
                |row| row.get(0),
            )
            .unwrap();
        store
            .conn
            .as_ref()
            .unwrap()
            .execute("UPDATE telemetry_meta SET last_sweep_ms=?1", params![clock])
            .unwrap();
        store
            .flush(
                vec![joined(&predecessor, "function_run", 1)],
                BTreeMap::new(),
                clock + 1,
                false,
            )
            .unwrap();
        let visible: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT count(*) FROM telemetry_events_visible", [], |row| {
                row.get(0)
            })
            .unwrap();
        let total: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT count(*) FROM telemetry_events", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(total, 1);
        assert_eq!(visible, 0);
    }

    #[test]
    fn explicit_rebind_rotates_generation_and_replaces_identity_atomically() {
        let predecessor_identity = identity("app-before", "environment-before");
        let successor_identity =
            identity("app-after".repeat(1_024), "environment-after".repeat(1_024));
        let mut store = Store::memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            predecessor_identity,
            config(),
        )
        .unwrap();
        let predecessor_generation = store.generation.clone();
        store
            .flush(
                vec![joined(&predecessor_generation, "function_run", 1)],
                BTreeMap::new(),
                wall_now_ms(),
                false,
            )
            .unwrap();
        store
            .rebind_with_identity(
                "01900000-0000-7000-8000-000000000002",
                successor_identity.clone(),
                wall_now_ms(),
            )
            .unwrap();
        assert_ne!(store.generation, predecessor_generation);
        assert_eq!(store.identity.as_ref(), Some(&successor_identity));
        let durable: (String, String, String) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT generation,app_id,environment FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(durable.0, store.generation);
        assert_eq!(durable.1, successor_identity.app_id);
        assert_eq!(durable.2, successor_identity.environment_id);
        let visible: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT count(*) FROM telemetry_events_visible", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(visible, 0, "predecessor rows stay generation-hidden");
    }

    #[test]
    fn maintenance_rolls_before_retention_and_views_are_generation_scoped() {
        let mut store = Store::memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        store
            .flush(
                vec![joined(&generation, "function_run", 1)],
                BTreeMap::new(),
                10 * DAY_MS,
                true,
            )
            .unwrap();
        let watermark: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT rollup_watermark_id FROM telemetry_meta",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let rollups: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT count(*) FROM telemetry_rollup_visible", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert!(watermark > 0);
        assert_eq!(rollups, 1);
    }

    #[test]
    fn finalized_hour_top_names_reconcile_across_multiple_flushes() {
        let mut store = Store::memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                top_names_per_hour: 2,
                ..config()
            },
        )
        .unwrap();
        let generation = store.generation.clone();
        let base: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT observation_clock_ms FROM telemetry_meta",
                [],
                |row| row.get(0),
            )
            .unwrap();
        store
            .flush(
                vec![
                    joined_named(&generation, "function_run", "alpha", 1),
                    joined_named(&generation, "function_run", "bravo", 2),
                ],
                BTreeMap::new(),
                base + 1,
                true,
            )
            .unwrap();
        store
            .flush(
                vec![
                    joined_named(&generation, "function_run", "charlie", 3),
                    joined_named(&generation, "function_run", "delta", 4),
                ],
                BTreeMap::new(),
                base + 2,
                true,
            )
            .unwrap();
        let before_finalization: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM telemetry_rollup_hourly WHERE generation=?1 AND kind='function_run'",
                params![generation],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(before_finalization, 4);

        store
            .flush(
                Vec::new(),
                BTreeMap::new(),
                hour_start(base).saturating_add(HOUR_MS + 1),
                true,
            )
            .unwrap();
        let (rows, total, folded): (i64, i64, i64) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT count(*),sum(count),sum(CASE WHEN name='_other' THEN folded_count ELSE 0 END) FROM telemetry_rollup_hourly WHERE generation=?1 AND kind='function_run'",
                params![generation],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(rows, 3, "two names plus the additive _other row");
        assert_eq!(total, 4);
        assert_eq!(folded, 2);
    }

    #[test]
    fn clock_rollback_across_hour_finalization_never_regresses_cursor_or_freshness() {
        let mut store = Store::memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        let base: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT observation_clock_ms FROM telemetry_meta",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let first_hour = hour_start(base).saturating_add(HOUR_MS);
        store
            .flush(
                vec![joined_named(&generation, "function_run", "finalized", 1)],
                BTreeMap::new(),
                first_hour + 100,
                true,
            )
            .unwrap();
        let next_hour = first_hour.saturating_add(HOUR_MS);
        store
            .flush(Vec::new(), BTreeMap::new(), next_hour + 100, true)
            .unwrap();
        let (prior_clock, prior_recorded, prior_id): (i64, i64, i64) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT observation_clock_ms,
                        (SELECT max(recorded_ts_ms) FROM telemetry_events),
                        (SELECT max(id) FROM telemetry_events)
                 FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();

        store
            .flush(
                vec![joined_named(
                    &generation,
                    "function_run",
                    "after_rollback",
                    2,
                )],
                BTreeMap::new(),
                base.saturating_sub(HOUR_MS),
                true,
            )
            .unwrap();
        let (clock, recorded, id, finalized): (i64, i64, i64, i64) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT (SELECT observation_clock_ms FROM telemetry_meta),
                        e.recorded_ts_ms,
                        e.id,
                        coalesce((SELECT finalized FROM telemetry_rollup_hourly
                                  WHERE generation=e.generation
                                    AND kind=e.kind
                                    AND name=e.name
                                    AND bucket_start_ms=(e.recorded_ts_ms / 3600000) * 3600000),0)
                 FROM telemetry_events e WHERE e.name='after_rollback'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert!(clock > prior_clock, "freshness high-water is monotone");
        assert!(
            (recorded, id) > (prior_recorded, prior_id),
            "cursor order is monotone"
        );
        assert_eq!(finalized, 0, "rollback cannot insert into a finalized hour");
    }

    #[test]
    fn hatch_and_server_share_the_same_generation_and_retention_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("telemetry.sqlite3");
        let mut store = Store::open(
            path.clone(),
            "01900000-0000-7000-8000-000000000001",
            config(),
        )
        .unwrap();
        let predecessor = store.generation.clone();
        store
            .flush(
                vec![joined_named(&predecessor, "function_run", "predecessor", 1)],
                BTreeMap::new(),
                wall_now_ms(),
                false,
            )
            .unwrap();
        store
            .rebind("01900000-0000-7000-8000-000000000002", wall_now_ms())
            .unwrap();
        let successor = store.generation.clone();
        store
            .flush(
                vec![joined_named(&successor, "function_run", "successor", 2)],
                BTreeMap::new(),
                wall_now_ms(),
                false,
            )
            .unwrap();
        let server = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT count(*),min(name),max(name) FROM telemetry_events_visible",
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .unwrap();
        let hatch = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .unwrap()
        .query_row(
            "SELECT count(*),min(name),max(name) FROM telemetry_events_visible",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .unwrap();
        assert_eq!(server, (1, "successor".to_owned(), "successor".to_owned()));
        assert_eq!(hatch, server);
    }

    #[test]
    fn raw_tail_stats_compose_across_restart_without_double_count() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("telemetry.sqlite3");
        let config = config();
        let mut store = Store::open(
            path.clone(),
            "01900000-0000-7000-8000-000000000001",
            config.clone(),
        )
        .unwrap();
        store.ensure_connection(wall_now_ms()).unwrap();
        let generation = store.generation.clone();
        let base: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT observation_clock_ms FROM telemetry_meta",
                [],
                |row| row.get(0),
            )
            .unwrap();
        store
            .flush(
                vec![joined_named(&generation, "function_run", "rolled", 1)],
                BTreeMap::new(),
                base + 1,
                true,
            )
            .unwrap();
        store
            .flush(
                vec![joined_named(&generation, "function_run", "raw_tail", 2)],
                BTreeMap::new(),
                base + 2,
                false,
            )
            .unwrap();
        drop(store);

        let mut store = Store::open(path, "01900000-0000-7000-8000-000000000001", config).unwrap();
        store.ensure_connection(base + 3).unwrap();
        let (rollup, raw_tail, watermark): (i64, i64, i64) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT
                   (SELECT coalesce(sum(count),0) FROM telemetry_rollup_visible WHERE kind='function_run'),
                   (SELECT count(*) FROM telemetry_events_visible
                    WHERE kind='function_run' AND phase IN ('point','joined','terminal')
                      AND id>(SELECT rollup_watermark_id FROM telemetry_meta)),
                   rollup_watermark_id
                 FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!((rollup, raw_tail), (1, 1));
        let before = crate::telemetry_query::query_stats(
            store.conn.as_ref().unwrap(),
            &crate::telemetry_query::TelemetryStatsRequestV1 {
                filter: crate::telemetry_query::TelemetryStatsFilterV1 {
                    kind: Some("function_run".to_owned()),
                    ..Default::default()
                },
                ..Default::default()
            },
            &crate::telemetry_query::QueryContext {
                drops_since_boot: BTreeMap::new(),
                last_flush_watermark: None,
            },
        )
        .unwrap();
        assert_eq!(
            before
                .status_counts
                .iter()
                .map(|entry| entry.count)
                .sum::<u64>(),
            2,
            "a reopened reader composes the durable rollup and raw tail once each"
        );
        assert_eq!(
            (before.coverage.rollup_rows, before.coverage.raw_tail_rows),
            (1, 1)
        );
        store
            .flush(Vec::new(), BTreeMap::new(), base + 3, true)
            .unwrap();
        let (after_rollup, after_tail, after_watermark): (i64, i64, i64) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT
                   (SELECT coalesce(sum(count),0) FROM telemetry_rollup_visible WHERE kind='function_run'),
                   (SELECT count(*) FROM telemetry_events_visible
                    WHERE kind='function_run' AND phase IN ('point','joined','terminal')
                      AND id>(SELECT rollup_watermark_id FROM telemetry_meta)),
                   rollup_watermark_id
                 FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!((after_rollup, after_tail), (2, 0));
        assert!(after_watermark > watermark);
        let after = crate::telemetry_query::query_stats(
            store.conn.as_ref().unwrap(),
            &crate::telemetry_query::TelemetryStatsRequestV1 {
                filter: crate::telemetry_query::TelemetryStatsFilterV1 {
                    kind: Some("function_run".to_owned()),
                    ..Default::default()
                },
                ..Default::default()
            },
            &crate::telemetry_query::QueryContext {
                drops_since_boot: BTreeMap::new(),
                last_flush_watermark: None,
            },
        )
        .unwrap();
        assert_eq!(
            after
                .status_counts
                .iter()
                .map(|entry| entry.count)
                .sum::<u64>(),
            2,
            "advancing the watermark after restart preserves the total"
        );
        assert_eq!(
            (after.coverage.rollup_rows, after.coverage.raw_tail_rows),
            (2, 0)
        );
    }

    #[test]
    fn late_completion_buckets_by_recorded_time_not_admission_time() {
        let mut store = Store::memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        let base: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT observation_clock_ms FROM telemetry_meta",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let completion = hour_start(base).saturating_add(2 * HOUR_MS + 100);
        let mut event = joined_named(&generation, "function_run", "late_completion", 1);
        event.ts_ms = hour_start(base).saturating_sub(7 * DAY_MS);
        store
            .flush(vec![event], BTreeMap::new(), completion, true)
            .unwrap();
        let (admitted, recorded, bucket): (i64, i64, i64) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT e.ts_ms,e.recorded_ts_ms,r.bucket_start_ms
                 FROM telemetry_events e JOIN telemetry_rollup_hourly r
                   ON r.generation=e.generation AND r.kind=e.kind AND r.name=e.name
                 WHERE e.name='late_completion'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(bucket, hour_start(recorded));
        assert_ne!(bucket, hour_start(admitted));
    }

    #[test]
    fn mid_hour_maintenance_counts_each_phase_exactly_once_before_and_after_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("telemetry.sqlite3");
        let config = config();
        let mut store = Store::open(
            path.clone(),
            "01900000-0000-7000-8000-000000000001",
            config.clone(),
        )
        .unwrap();
        store.ensure_connection(wall_now_ms()).unwrap();
        let generation = store.generation.clone();
        let mut point = joined_named(&generation, "phase_fixture", "point", 1);
        point.phase = Phase::Point;
        let mut admission = joined_named(&generation, "phase_fixture", "admission", 2);
        admission.phase = Phase::Admission;
        let mut terminal = joined_named(&generation, "phase_fixture", "terminal", 3);
        terminal.phase = Phase::Terminal;
        let joined = joined_named(&generation, "phase_fixture", "joined", 4);
        let base: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT observation_clock_ms FROM telemetry_meta",
                [],
                |row| row.get(0),
            )
            .unwrap();
        store
            .flush(
                vec![point, admission, terminal, joined],
                BTreeMap::new(),
                hour_start(base).saturating_add(HOUR_MS / 2),
                true,
            )
            .unwrap();
        let stats_partition = |conn: &Connection| {
            conn.query_row(
                "SELECT
                   (SELECT coalesce(sum(count),0) FROM telemetry_rollup_visible WHERE kind='phase_fixture') +
                   (SELECT count(*) FROM telemetry_events_visible
                    WHERE kind='phase_fixture' AND phase IN ('point','joined','terminal')
                      AND id>(SELECT rollup_watermark_id FROM telemetry_meta))",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap()
        };
        assert_eq!(stats_partition(store.conn.as_ref().unwrap()), 3);
        drop(store);
        let mut store = Store::open(path, "01900000-0000-7000-8000-000000000001", config).unwrap();
        store.ensure_connection(base + 1).unwrap();
        assert_eq!(stats_partition(store.conn.as_ref().unwrap()), 3);
    }

    #[test]
    fn snapshot_bounded_export_excludes_later_rows_and_generations() {
        let mut store = Store::memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        let base: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT observation_clock_ms FROM telemetry_meta",
                [],
                |row| row.get(0),
            )
            .unwrap();
        store
            .flush(
                vec![
                    joined_named(&generation, "function_run", "snapshot_a", 1),
                    joined_named(&generation, "function_run", "snapshot_b", 2),
                ],
                BTreeMap::new(),
                base + 1,
                false,
            )
            .unwrap();
        let (snapshot_generation, snapshot_boundary, snapshot_max_id): (String, i64, i64) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT generation,
                        max(retention_floor,observation_clock_ms - max_days_mirror * 86400000),
                        (SELECT max(id) FROM telemetry_events_visible)
                 FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        store
            .flush(
                vec![joined_named(
                    &generation,
                    "function_run",
                    "after_snapshot",
                    3,
                )],
                BTreeMap::new(),
                base + 2,
                false,
            )
            .unwrap();
        store
            .rebind("01900000-0000-7000-8000-000000000002", base + 3)
            .unwrap();
        let names = store
            .conn
            .as_ref()
            .unwrap()
            .prepare(
                "SELECT name FROM telemetry_events
                 WHERE generation=?1 AND recorded_ts_ms>?2 AND id<=?3
                 ORDER BY recorded_ts_ms,id",
            )
            .unwrap()
            .query_map(
                params![snapshot_generation, snapshot_boundary, snapshot_max_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(names, vec!["snapshot_a", "snapshot_b"]);
    }

    #[test]
    fn persisted_rows_pin_the_registry_version() {
        let mut store = Store::memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        store
            .flush(
                vec![joined(&generation, "function_run", 1)],
                BTreeMap::new(),
                wall_now_ms(),
                false,
            )
            .unwrap();
        let class_v: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT class_v FROM telemetry_events", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            class_v,
            i64::from(crate::telemetry_contract::OPERATION_CLASS_REGISTRY_VERSION)
        );
    }

    #[test]
    fn large_sweep_truncates_wal_after_commit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("telemetry.sqlite3");
        let mut store = Store::open(
            path.clone(),
            "01900000-0000-7000-8000-000000000001",
            config(),
        )
        .unwrap();
        let generation = store.generation.clone();
        let base = wall_now_ms();
        let events = (0..LARGE_SWEEP_ROWS)
            .map(|sequence| joined(&generation, "function_run", sequence as u64))
            .collect();
        store.flush(events, BTreeMap::new(), base, true).unwrap();
        store
            .flush(
                Vec::new(),
                BTreeMap::new(),
                base + i64::from(DEFAULT_MAX_DAYS + 1) * DAY_MS,
                true,
            )
            .unwrap();
        let wal = PathBuf::from(format!("{}-wal", path.display()));
        assert_eq!(fs::metadata(wal).map_or(0, |metadata| metadata.len()), 0);
    }

    #[test]
    fn file_cap_sheds_one_batch_without_physical_overshoot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("telemetry.sqlite3");
        let cap = 1024 * 1024;
        let mut store = Store::open(
            path.clone(),
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                file_size_cap_bytes: cap,
                ..config()
            },
        )
        .unwrap();
        let generation = store.generation.clone();
        let mut events = (0..20)
            .map(|sequence| {
                let mut event = joined_named(&generation, "reserved_fixture", "reserved", sequence);
                event.priority = Priority::Reserved;
                event
            })
            .collect::<Vec<_>>();
        events.extend((20..320).map(|sequence| {
            let mut event = joined_named(&generation, "normal_fixture", "normal", sequence);
            event.details = Some(json!({ "message": "x".repeat(6_000) }));
            event
        }));
        store
            .flush(events, BTreeMap::new(), wall_now_ms(), true)
            .unwrap();

        let bytes = telemetry_file_bytes(&path);
        let conn = store.conn.as_ref().unwrap();
        let reserved: i64 = conn
            .query_row(
                "SELECT count(*) FROM telemetry_events WHERE kind='reserved_fixture'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let encoded: String = conn
            .query_row(
                "SELECT drop_counters_lifetime FROM telemetry_meta WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let drops: BTreeMap<String, u64> = serde_json::from_str(&encoded).unwrap();
        assert!(bytes <= cap, "{bytes} physical bytes exceeded {cap}");
        assert_eq!(reserved, 20, "reserved events are selected before normal");
        assert!(drops.values().sum::<u64>() > 0);
    }

    #[test]
    fn cap_exhaustion_rolls_before_raw_interval_eviction() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let cap = 1024 * 1024;
        let config = TelemetryConfig {
            buffer_capacity: 400,
            priority_reserve: 20,
            batch_size: 400,
            file_size_cap_bytes: cap,
            ..config()
        };
        let telemetry = Telemetry::open_for_database(
            &app_path,
            "01900000-0000-7000-8000-000000000001",
            config.clone(),
        )
        .unwrap();
        let generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();

        // Prime last_sweep so the tested flush reaches the physical-cap
        // fallback without the ordinary flush transaction doing maintenance.
        {
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            enqueue_locked(
                &mut buffer,
                &config,
                joined_named(&generation, "seed_fixture", "seed", 0),
            );
        }
        flush_shared(&telemetry.producer.shared, false).unwrap();
        let prior_watermark = telemetry.diagnostics().last_flush_watermark;
        {
            let mut store = telemetry.producer.shared.store.lock().unwrap();
            let high_water: i64 = store
                .conn
                .as_ref()
                .unwrap()
                .query_row(
                    "SELECT observation_clock_ms FROM telemetry_meta WHERE singleton=1",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            let next_hour = hour_start(high_water).saturating_add(HOUR_MS + 1_000);
            store
                .conn
                .as_ref()
                .unwrap()
                .execute(
                    "UPDATE telemetry_meta SET observation_clock_ms=?1,last_sweep_ms=?1 WHERE singleton=1",
                    params![next_hour],
                )
                .unwrap();
            store.force_file_cap_estimator_miss = true;
        }
        {
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            for sequence in 1..=300 {
                let mut event =
                    joined_named(&generation, "normal_fixture", "estimator_miss", sequence);
                event.details = Some(json!({ "message": "x".repeat(6_000) }));
                enqueue_locked(&mut buffer, &config, event);
            }
        }

        flush_shared(&telemetry.producer.shared, false).unwrap();

        let diagnostics = telemetry.diagnostics();
        let fallback_key = "normal_fixture:unknown:fileCapIntervalEvicted";
        assert_eq!(diagnostics.drops_since_boot.get(fallback_key), Some(&300));
        assert!(
            diagnostics
                .drops_since_boot
                .keys()
                .all(|key| !key.ends_with(":fileCap") && !key.ends_with(":flushFailed")),
            "estimator-miss recovery must not be reported as preflight shedding or flush failure"
        );
        assert!(diagnostics.last_flush_watermark >= prior_watermark);

        let conn = Connection::open(&telemetry_path).unwrap();
        let rolled: i64 = conn
            .query_row(
                "SELECT coalesce(sum(count),0) FROM telemetry_rollup_hourly WHERE generation=?1 AND kind='normal_fixture'",
                params![generation],
                |row| row.get(0),
            )
            .unwrap();
        let raw: i64 = conn
            .query_row(
                "SELECT count(*) FROM telemetry_events WHERE generation=?1 AND kind='normal_fixture'",
                params![generation],
                |row| row.get(0),
            )
            .unwrap();
        let (floor, watermark, encoded): (i64, i64, String) = conn
            .query_row(
                "SELECT retention_floor,rollup_watermark_id,drop_counters_lifetime FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let lifetime: BTreeMap<String, u64> = serde_json::from_str(&encoded).unwrap();
        assert_eq!(rolled, 300, "raw rows must be rolled before cap eviction");
        assert_eq!(raw, 0, "the fallback evicts a complete raw interval");
        assert!(floor > 0, "whole-interval eviction advances the raw floor");
        assert!(
            watermark >= 301,
            "rollup watermark covers every committed row"
        );
        assert_eq!(lifetime.get(fallback_key), Some(&300));
        assert!(telemetry_file_bytes(&telemetry_path) <= cap);

        flush_shared(&telemetry.producer.shared, true).unwrap();
        assert_eq!(
            telemetry.diagnostics().last_flush_watermark,
            diagnostics.last_flush_watermark,
            "maintenance-only commits must not clear the last event watermark"
        );
    }

    #[test]
    fn file_cap_interval_eviction_counts_and_deletes_the_strict_floor_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("telemetry.sqlite3");
        let config = config();
        let mut store =
            Store::open(path, "01900000-0000-7000-8000-000000000001", config.clone()).unwrap();
        let generation = store.generation.clone();
        let boundary = hour_start(wall_now_ms()).saturating_add(HOUR_MS);
        store
            .flush(
                (0..3)
                    .map(|sequence| joined(&generation, "boundary_fixture", sequence))
                    .collect(),
                BTreeMap::new(),
                boundary.saturating_add(2),
                false,
            )
            .unwrap();
        let conn = store.conn.as_mut().unwrap();
        let ids = conn
            .prepare("SELECT id FROM telemetry_events WHERE generation=?1 ORDER BY id LIMIT 3")
            .unwrap()
            .query_map(params![generation], |row| row.get::<_, i64>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(ids.len(), 3);
        for (id, recorded) in ids.into_iter().zip([
            boundary.saturating_sub(1),
            boundary,
            boundary.saturating_add(1),
        ]) {
            conn.execute(
                "UPDATE telemetry_events SET recorded_ts_ms=?1 WHERE id=?2",
                params![recorded, id],
            )
            .unwrap();
        }

        let drops = file_cap_recovery_step(conn, &config, boundary.saturating_add(2)).unwrap();
        assert_eq!(
            drops.get("boundary_fixture:unknown:fileCapIntervalEvicted"),
            Some(&2),
            "the row exactly at the strict floor is counted as evicted"
        );
        let (raw, visible, floor): (i64, i64, i64) = conn
            .query_row(
                "SELECT
                   (SELECT count(*) FROM telemetry_events WHERE generation=?1 AND kind='boundary_fixture'),
                   (SELECT count(*) FROM telemetry_events_visible WHERE kind='boundary_fixture'),
                   retention_floor
                 FROM telemetry_meta WHERE singleton=1",
                params![generation],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(floor, boundary);
        assert_eq!(raw, 1, "only the row strictly above the floor remains");
        assert_eq!(
            visible, 1,
            "physical deletion matches strict view visibility"
        );
        let surviving_recorded: i64 = conn
            .query_row(
                "SELECT recorded_ts_ms FROM telemetry_events WHERE generation=?1 AND kind='boundary_fixture'",
                params![generation],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(surviving_recorded, boundary.saturating_add(1));
    }

    #[test]
    fn postcommit_cap_recovery_failure_is_not_a_flush_failure() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let config = TelemetryConfig {
            buffer_capacity: 400,
            priority_reserve: 20,
            batch_size: 400,
            file_size_cap_bytes: 1024 * 1024,
            ..config()
        };
        let telemetry = Telemetry::open_for_database(
            &app_path,
            "01900000-0000-7000-8000-000000000001",
            config.clone(),
        )
        .unwrap();
        let generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        {
            let mut store = telemetry.producer.shared.store.lock().unwrap();
            store.force_file_cap_estimator_miss = true;
            store.fail_postcommit_cap_recovery = true;
        }
        {
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            for sequence in 1..=300 {
                let mut event = joined_named(
                    &generation,
                    "normal_fixture",
                    "postcommit_failure",
                    sequence,
                );
                event.details = Some(json!({ "message": "x".repeat(6_000) }));
                enqueue_locked(&mut buffer, &config, event);
            }
        }

        flush_shared(&telemetry.producer.shared, false).unwrap();

        let diagnostics = telemetry.diagnostics();
        let failure_key = "telemetry:reserved:fileCapMaintenanceFailed";
        assert_eq!(diagnostics.drops_since_boot.get(failure_key), Some(&1));
        assert!(
            diagnostics
                .drops_since_boot
                .keys()
                .all(|key| !key.ends_with(":flushFailed")),
            "a postcommit cap recovery error must not reclassify committed events"
        );
        let store = telemetry.producer.shared.store.lock().unwrap();
        let committed: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM telemetry_events WHERE generation=?1 AND kind='normal_fixture'",
                params![generation],
                |row| row.get(0),
            )
            .unwrap();
        let encoded: String = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT drop_counters_lifetime FROM telemetry_meta WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let lifetime: BTreeMap<String, u64> = serde_json::from_str(&encoded).unwrap();
        assert_eq!(
            committed, 300,
            "the original flush committed before recovery"
        );
        assert_eq!(lifetime.get(failure_key), Some(&1));
        assert!(
            lifetime.keys().all(|key| !key.ends_with(":flushFailed")),
            "lifetime accounting must not contain a false precommit failure"
        );
    }

    #[test]
    fn producer_stamps_single_and_multi_carriers_with_first_rejection_authority() {
        let telemetry =
            Telemetry::in_memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let carrier = |error_class: &str, message: &str| crate::error_tracking::FailureCarrierV1 {
            error_class: error_class.to_owned(),
            message: Some(message.to_owned()),
            stack: Some("at handler (app.js:1:1)".to_owned()),
            message_extraction_truncated: false,
            stack_extraction_truncated: false,
        };

        let span = telemetry.start_classified_span(
            OperationClassIdV1::FUNCTION_QUERY,
            "messages.send",
            None,
            None,
        );
        let mut exception_carrier = carrier("TypeError", "recipient 123 is missing");
        exception_carrier.message_extraction_truncated = true;
        let mut exception = SnapbackError::error(
            "SNAPBACK_HANDLER_FAILED",
            "runtime",
            "JavaScript handler failed",
        )
        .with_details(json!({ "function": "messages.send" }))
        .with_private_failure_context(PrivateFailureContextV1 {
            carriers: vec![exception_carrier],
            app_refusal_tracking: None,
        });
        span.finish_error(Some(500), &mut exception, None);
        assert!(
            exception.private_failure_context().is_none(),
            "the producer consumes the serde-skipped private carrier"
        );

        for (name, tracking) in [
            ("moves.tracked", AppRefusalTrackingV1::Tracked),
            ("moves.untracked", AppRefusalTrackingV1::AdmittedUntracked),
        ] {
            let span = telemetry.start_classified_span(
                OperationClassIdV1::FUNCTION_MUTATION,
                name,
                None,
                None,
            );
            let mut refusal =
                SnapbackError::error("SNAPBACK_APP_REFUSAL", "runtime", "application refusal")
                    .with_details(json!({
                        "function": name,
                        "appCode": "STALE_MOVE",
                        "appDetails": { "revision": 9 },
                    }))
                    .with_private_failure_context(PrivateFailureContextV1 {
                        carriers: vec![carrier("AppRefusal", "move revision 9 is stale")],
                        app_refusal_tracking: Some(tracking),
                    });
            span.finish_error(Some(500), &mut refusal, None);
        }

        let ordered_rejections = vec![
            carrier("TypeError", "first rejection"),
            carrier("RangeError", "second rejection"),
        ];
        let expected_multi_hash = lower_hex(
            &fingerprint_v1(&FingerprintInputV1::Exception {
                scheme_version: FINGERPRINT_VERSION,
                kind: Some("function_run".to_owned()),
                name: Some("actions.multiReject".to_owned()),
                error_class: Some(ordered_rejections[0].error_class.clone()),
                message_template: Some(normalize_message_v1(
                    ordered_rejections[0].message.as_deref().unwrap(),
                )),
            })
            .truncated,
        );
        let span = telemetry.start_classified_span(
            OperationClassIdV1::FUNCTION_ACTION,
            "actions.multiReject",
            None,
            None,
        );
        let mut matching_single = SnapbackError::error(
            "SNAPBACK_HANDLER_UNHANDLED_REJECTION",
            "runtime",
            "handler completed with an unhandled promise rejection",
        )
        .with_details(json!({ "function": "actions.multiReject" }))
        .with_private_failure_context(PrivateFailureContextV1 {
            carriers: vec![ordered_rejections[0].clone()],
            app_refusal_tracking: None,
        });
        span.finish_error(Some(500), &mut matching_single, None);

        let span = telemetry.start_classified_span(
            OperationClassIdV1::FUNCTION_ACTION,
            "actions.multiReject",
            None,
            None,
        );
        let mut multiple = SnapbackError::error(
            "SNAPBACK_HANDLER_UNHANDLED_REJECTION",
            "runtime",
            "handler completed with unhandled promise rejections",
        )
        .with_details(json!({ "function": "actions.multiReject" }))
        .with_private_failure_context(PrivateFailureContextV1 {
            carriers: ordered_rejections.clone(),
            app_refusal_tracking: None,
        });
        span.finish_error(Some(500), &mut multiple, None);

        let span = telemetry.start_classified_span(
            OperationClassIdV1::HTTP_STANDALONE,
            "/upstream",
            None,
            Some(json!({ "method": "GET" })),
        );
        span.finish(Some(503), None, None);
        telemetry.standalone_diagnostic(&Diagnostic::error(
            "SNAPBACK_EMISSION_TEST_FAILURE",
            "telemetry",
            "standalone diagnostic fixture",
        ));

        telemetry.force_flush().unwrap();
        let store = telemetry.producer.shared.store.lock().unwrap();
        let conn = store.conn.as_ref().unwrap();
        let details_for = |name: &str| -> Value {
            let encoded: String = conn
                .query_row(
                    "SELECT details FROM telemetry_events_visible WHERE name=?1 ORDER BY id DESC LIMIT 1",
                    params![name],
                    |row| row.get(0),
                )
                .unwrap();
            serde_json::from_str(&encoded).unwrap()
        };
        let exception_details = details_for("messages.send");
        assert_eq!(exception_details["failure_disposition"], "fault");
        assert_eq!(exception_details["fp_branch"], "exception");
        assert!(exception_details["fp_hash"].as_str().is_some());
        assert_eq!(
            exception_details["messageTemplate"],
            "recipient <digits> is missing"
        );
        assert_eq!(
            exception_details["detailFlags"]["messageTruncated"], true,
            "the allocation retains extraction-time truncation witnesses",
        );
        assert_eq!(details_for("moves.tracked")["issue_eligible"], true);
        let untracked = details_for("moves.untracked");
        assert_eq!(untracked["failure_disposition"], "app_refusal");
        assert_eq!(untracked["issue_eligible"], false);
        assert!(untracked.get("fp_hash").is_none());
        let multiple = details_for("actions.multiReject");
        assert_eq!(multiple["failure_disposition"], "fault");
        assert_eq!(multiple["issue_eligible"], true);
        assert_eq!(multiple["fp_branch"], "exception");
        assert_eq!(multiple["fp_version"], FINGERPRINT_VERSION);
        assert_eq!(multiple["fp_hash"], expected_multi_hash);
        assert_eq!(multiple["errorClass"], "TypeError");
        assert_eq!(multiple["messageTemplate"], "first rejection");
        assert_eq!(multiple["rejectionCarriers"], json!(ordered_rejections));

        let groups = conn
            .prepare("SELECT kind,name,failure_disposition FROM error_groups_visible ORDER BY name")
            .unwrap()
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            groups,
            vec![
                (
                    "http_request".to_owned(),
                    "/upstream".to_owned(),
                    "fault".to_owned(),
                ),
                (
                    "diagnostic".to_owned(),
                    "SNAPBACK_EMISSION_TEST_FAILURE".to_owned(),
                    "fault".to_owned(),
                ),
                (
                    "function_run".to_owned(),
                    "actions.multiReject".to_owned(),
                    "fault".to_owned(),
                ),
                (
                    "function_run".to_owned(),
                    "messages.send".to_owned(),
                    "fault".to_owned(),
                ),
                (
                    "function_run".to_owned(),
                    "moves.tracked".to_owned(),
                    "app_refusal".to_owned(),
                ),
            ]
        );
        let multi_group: (i64, String) = conn
            .query_row(
                "SELECT count,lower(hex(fp_hash)) FROM error_groups_visible WHERE name='actions.multiReject'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            multi_group,
            (2, expected_multi_hash),
            "the matching single terminal and one multi terminal each contribute one occurrence to the first-rejection group"
        );
        let multi_group_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM error_groups_visible WHERE name='actions.multiReject'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            multi_group_count, 1,
            "the multi terminal joins the corresponding single-rejection group"
        );
        let multi_raw_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM telemetry_events_visible WHERE name='actions.multiReject'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            multi_raw_count, 2,
            "two handler terminals remain two observations; the multi terminal is not split"
        );
        let multi_exemplars: Vec<(String, String)> = conn
            .prepare(
                "SELECT title_template,stack_head FROM error_exemplars_visible WHERE issue=(SELECT issue FROM error_groups_visible WHERE name='actions.multiReject')",
            )
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            multi_exemplars.len(),
            2,
            "the single and multi terminal each retain one first-rejection exemplar"
        );
        assert!(multi_exemplars.iter().all(|exemplar| exemplar
            == &(
                "first rejection".to_owned(),
                "at handler (app.js:1:1)".to_owned(),
            )));
        let malformed: i64 = conn
            .query_row(
                "SELECT malformed_error_stamp_count FROM telemetry_meta WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            malformed, 0,
            "a well-formed ordered vector is not malformed"
        );
    }

    #[test]
    fn nested_logical_and_http_carrier_failures_form_distinct_groups() {
        let telemetry =
            Telemetry::in_memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let correlation = "nested-http-failure";
        let logical = telemetry.start_classified_span(
            OperationClassIdV1::FUNCTION_HTTP,
            "webhooks.ingest",
            Some(correlation),
            None,
        );
        let mut error = SnapbackError::error(
            "SNAPBACK_HANDLER_FAILED",
            "runtime",
            "JavaScript handler failed",
        )
        .with_details(json!({ "function": "webhooks.ingest" }))
        .with_private_failure_context(PrivateFailureContextV1 {
            carriers: vec![crate::error_tracking::FailureCarrierV1 {
                error_class: "TypeError".to_owned(),
                message: Some("payload 42 failed".to_owned()),
                stack: None,
                message_extraction_truncated: false,
                stack_extraction_truncated: false,
            }],
            app_refusal_tracking: None,
        });
        logical.finish_error(Some(500), &mut error, None);

        let carrier = telemetry.start_classified_span(
            OperationClassIdV1::HTTP_CARRIER,
            "/functions/:name",
            Some(correlation),
            Some(json!({ "method": "POST" })),
        );
        carrier.finish(Some(500), Some("SNAPBACK_HANDLER_FAILED"), None);
        telemetry.force_flush().unwrap();

        let store = telemetry.producer.shared.store.lock().unwrap();
        let conn = store.conn.as_ref().unwrap();
        let raw_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM telemetry_events_visible WHERE correlation=?1 AND status=500",
                params![correlation],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(raw_count, 2, "one logical and one carrier terminal emit");
        let groups = conn
            .prepare(
                "SELECT kind,name,code,error_class,status_class FROM error_groups_visible WHERE name IN ('webhooks.ingest','/functions/:name') ORDER BY kind",
            )
            .unwrap()
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            groups,
            vec![
                (
                    "function_run".to_owned(),
                    "webhooks.ingest".to_owned(),
                    Some("SNAPBACK_HANDLER_FAILED".to_owned()),
                    Some("TypeError".to_owned()),
                    None,
                ),
                (
                    "http_request".to_owned(),
                    "/functions/:name".to_owned(),
                    Some("SNAPBACK_HANDLER_FAILED".to_owned()),
                    None,
                    None,
                ),
            ],
            "the existing nested seams intentionally retain two distinct identities",
        );
    }

    #[test]
    fn error_group_fold_is_atomic_and_malformed_or_mismatched_stamps_do_not_mutate_it() {
        let mut store =
            Store::memory_unbound("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        let hash = "0123456789abcdef0123456789abcdef";
        let first = eligible_failure_event(
            &generation,
            1,
            FINGERPRINT_VERSION,
            hash,
            FailureDispositionV1::Fault,
            None,
            Some("failure <digits>".to_owned()),
        );
        let activation = release_activation_event(&generation, 2, "release-atomic");
        store.fail_before_commit = true;
        assert!(
            store
                .flush(
                    vec![first.clone(), activation.clone()],
                    BTreeMap::new(),
                    10_000,
                    false,
                )
                .is_err()
        );
        {
            let conn = store.conn.as_ref().unwrap();
            assert_eq!(
                conn.query_row("SELECT count(*) FROM telemetry_events", [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            assert_eq!(
                conn.query_row("SELECT count(*) FROM error_groups", [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            assert_eq!(
                conn.query_row("SELECT count(*) FROM release_activations", [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                0,
                "activation rows vanish with their raw row and group fold"
            );
            let witness: (i64, i64) = conn
                .query_row(
                    "SELECT flush_commit_sequence,enqueue_high_water FROM telemetry_meta WHERE singleton=1",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();
            assert_eq!(witness, (0, 0));
        }

        store.fail_before_commit = false;
        store
            .flush(vec![first, activation], BTreeMap::new(), 10_001, false)
            .unwrap();
        assert_eq!(
            store
                .conn
                .as_ref()
                .unwrap()
                .query_row("SELECT count(*) FROM release_activations", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1,
            "activation commits with its raw row and group fold"
        );
        store
            .flush(
                vec![eligible_failure_event(
                    &generation,
                    3,
                    FINGERPRINT_VERSION,
                    hash,
                    FailureDispositionV1::Fault,
                    None,
                    Some("failure <digits>".to_owned()),
                )],
                BTreeMap::new(),
                10_002,
                false,
            )
            .unwrap();
        store
            .flush(
                vec![eligible_failure_event(
                    &generation,
                    4,
                    FINGERPRINT_VERSION,
                    hash,
                    FailureDispositionV1::Timeout,
                    None,
                    Some("timeout <digits>".to_owned()),
                )],
                BTreeMap::new(),
                10_003,
                false,
            )
            .unwrap();
        let mut malformed = eligible_failure_event(
            &generation,
            5,
            FINGERPRINT_VERSION,
            &"1".repeat(32),
            FailureDispositionV1::Fault,
            None,
            None,
        );
        malformed.details.as_mut().unwrap()["classifier_version"] = json!(0);
        store
            .flush(vec![malformed], BTreeMap::new(), 10_004, false)
            .unwrap();

        let conn = store.conn.as_ref().unwrap();
        let group: (i64, i64, i64, String, String) = conn
            .query_row(
                "SELECT count,first_seen_seq,last_seen_seq,failure_disposition,subsystem
                 FROM error_groups",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(group, (2, 1, 3, "fault".to_owned(), "functions".to_owned()));
        let counters: (i64, i64, i64) = conn
            .query_row(
                "SELECT classifier_disposition_mismatch_count,malformed_error_stamp_count,enqueue_high_water
                 FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(counters, (1, 1, 5));
        assert_eq!(
            conn.query_row("SELECT count(*) FROM telemetry_events", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            5,
            "malformed and mismatched carriers remain available as raw telemetry"
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM error_exemplars", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }

    #[test]
    fn code_less_transport_fault_materializes_from_its_stamped_status_branch() {
        let mut store =
            Store::memory_unbound("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        let mut event = eligible_failure_event(
            &generation,
            1,
            1,
            "0123456789abcdef0123456789abcdef",
            FailureDispositionV1::Fault,
            None,
            None,
        );
        event.admission.telemetry_kind = "http_request".to_owned();
        event.name = "/hooks/:provider".to_owned();
        event.code = None;
        let details = event.details.as_mut().unwrap().as_object_mut().unwrap();
        details.remove("platformCode");
        details.remove("subsystem");
        details.insert("fp_branch".to_owned(), json!("transport"));
        details.insert("statusClass".to_owned(), json!(5));
        store
            .flush(vec![event], BTreeMap::new(), 15_000, false)
            .unwrap();
        let group: (Option<String>, Option<i64>, String, String) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT code,status_class,kind,name FROM error_groups",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            group,
            (
                None,
                Some(5),
                "http_request".to_owned(),
                "/hooks/:provider".to_owned(),
            )
        );
    }

    #[test]
    fn release_activation_order_uses_sequences_and_same_hash_republication_is_genuine() {
        let mut store =
            Store::memory_unbound("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        let first_a = release_activation_event(&generation, 1, "release-a");
        let first_b = release_activation_event(&generation, 2, "release-b");
        let second_a = release_activation_event(&generation, 3, "release-a");
        store
            .flush(
                vec![first_a.clone(), first_b, second_a],
                BTreeMap::new(),
                20_000,
                false,
            )
            .unwrap();
        let first_activation_ms = {
            let conn = store.conn.as_ref().unwrap();
            let a: (i64, i64, i64, i64) = conn
                .query_row(
                    "SELECT activated_ms,activated_seq,last_activated_ms,last_activated_seq
                     FROM release_activations WHERE release='release-a'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .unwrap();
            assert_eq!((a.1, a.3), (1, 3));
            assert_eq!(a.0, a.2, "one flush has one observation-clock stamp");
            let order = conn
                .prepare(
                    "SELECT release,activated_seq FROM release_activations ORDER BY activated_seq",
                )
                .unwrap()
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            assert_eq!(
                order,
                vec![("release-a".to_owned(), 1), ("release-b".to_owned(), 2)]
            );
            a.0
        };

        let conn = store.conn.as_mut().unwrap();
        let tx = conn.transaction().unwrap();
        upsert_release_activation(&tx, &generation, "release-a", &first_a, 99_000).unwrap();
        tx.commit().unwrap();
        let replayed: (i64, i64) = conn
            .query_row(
                "SELECT last_activated_ms,last_activated_seq FROM release_activations
                 WHERE release='release-a'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            replayed,
            (first_activation_ms, 3),
            "re-applying the exact older row cannot move last activation backward or restamp it"
        );
    }

    #[test]
    fn rollout_suppression_uses_the_exact_half_open_event_time_window() {
        let mut store =
            Store::memory_unbound("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        let predecessor_hash = "0123456789abcdef0123456789abcdef";
        store
            .flush(
                vec![eligible_failure_event(
                    &generation,
                    1,
                    1,
                    predecessor_hash,
                    FailureDispositionV1::Fault,
                    None,
                    None,
                )],
                BTreeMap::new(),
                30_000,
                false,
            )
            .unwrap();
        store
            .conn
            .as_ref()
            .unwrap()
            .execute("DELETE FROM error_exemplars", [])
            .unwrap();
        store
            .conn
            .as_ref()
            .unwrap()
            .execute(
                "UPDATE telemetry_meta SET rollout_from_version=1,rollout_to_version=2,
                   rollout_started_ms=100,rollout_expires_ms=200 WHERE singleton=1",
                [],
            )
            .unwrap();

        let mut at_start = eligible_failure_event(
            &generation,
            2,
            2,
            &"1".repeat(32),
            FailureDispositionV1::Fault,
            Some((1, predecessor_hash)),
            None,
        );
        at_start.ts_ms = 100;
        let mut at_end = eligible_failure_event(
            &generation,
            3,
            2,
            &"2".repeat(32),
            FailureDispositionV1::Fault,
            Some((1, predecessor_hash)),
            None,
        );
        at_end.ts_ms = 200;
        store.fail_before_commit = true;
        assert!(
            store
                .flush(vec![at_start.clone()], BTreeMap::new(), 30_001, false)
                .is_err()
        );
        {
            let conn = store.conn.as_ref().unwrap();
            assert_eq!(
                conn.query_row(
                    "SELECT count(*) FROM error_groups WHERE fp_version=2",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
                0,
                "a suppressed successor group and its counter vanish together"
            );
        }
        store.fail_before_commit = false;
        store
            .flush(vec![at_start, at_end], BTreeMap::new(), 30_001, false)
            .unwrap();

        let conn = store.conn.as_ref().unwrap();
        let counts = conn
            .prepare(
                "SELECT hex(fp_hash),suppressed_rollout_count FROM error_groups
                 WHERE fp_version=2 ORDER BY fp_hash",
            )
            .unwrap()
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            counts,
            vec![("11".repeat(16), 1), ("22".repeat(16), 0)],
            "the predecessor group survives raw exemplar aging; started_ms is inclusive and expires_ms is exclusive on event.ts_ms"
        );
        let versions = conn
            .prepare(
                "SELECT fp_version,count(*) FROM error_groups
                 GROUP BY fp_version ORDER BY fp_version",
            )
            .unwrap()
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            versions,
            vec![(1, 1), (2, 2)],
            "fingerprint-version rollout creates successor groups without relabeling the predecessor"
        );
        let visible = crate::errors_query::query_issues(
            conn,
            &crate::errors_query::ErrorsIssuesRequestV1::default(),
            &crate::telemetry_query::QueryContext {
                drops_since_boot: BTreeMap::new(),
                last_flush_watermark: None,
            },
        )
        .unwrap();
        assert_eq!(visible.variance.suppression_counters["rollout"], 1);
    }

    #[test]
    fn exemplar_limits_count_flush_depth_and_utf8_byte_decisions_separately() {
        let mut store =
            Store::memory_unbound("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        let hash = "0123456789abcdef0123456789abcdef";
        let one_batch = (1..=6)
            .map(|sequence| {
                eligible_failure_event(
                    &generation,
                    sequence,
                    1,
                    hash,
                    FailureDispositionV1::Fault,
                    None,
                    Some("small".to_owned()),
                )
            })
            .collect();
        store
            .flush(one_batch, BTreeMap::new(), 40_000, false)
            .unwrap();
        store
            .flush(
                vec![eligible_failure_event(
                    &generation,
                    7,
                    1,
                    hash,
                    FailureDispositionV1::Fault,
                    None,
                    Some("small".to_owned()),
                )],
                BTreeMap::new(),
                40_001,
                false,
            )
            .unwrap();
        {
            let conn = store.conn.as_ref().unwrap();
            let limits: (i64, i64, i64, i64) = conn
                .query_row(
                    "SELECT exemplar_flush_drop_count,exemplar_depth_drop_count,
                            exemplar_byte_drop_count,
                            (SELECT count(*) FROM error_exemplars)
                     FROM error_groups",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .unwrap();
            assert_eq!(limits, (1, 1, 0, 5));
            let sequences = conn
                .prepare("SELECT recorded_seq FROM error_exemplars ORDER BY recorded_seq")
                .unwrap()
                .query_map([], |row| row.get::<_, i64>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            assert_eq!(sequences, vec![2, 3, 4, 5, 7]);
        }

        let byte_hash = "fedcba9876543210fedcba9876543210";
        for sequence in 8..=12 {
            store
                .flush(
                    vec![eligible_failure_event(
                        &generation,
                        sequence,
                        1,
                        byte_hash,
                        FailureDispositionV1::Fault,
                        None,
                        Some("é".repeat(3_500)),
                    )],
                    BTreeMap::new(),
                    40_000 + sequence as i64,
                    false,
                )
                .unwrap();
        }
        let conn = store.conn.as_ref().unwrap();
        let bytes: (i64, i64, i64) = conn
            .query_row(
                "SELECT exemplar_byte_drop_count,
                        (SELECT count(*) FROM error_exemplars x
                         WHERE x.generation=g.generation AND x.issue=g.issue),
                        (SELECT coalesce(sum(length(CAST(title_template AS BLOB))+
                                              length(CAST(stack_head AS BLOB))),0)
                         FROM error_exemplars x
                         WHERE x.generation=g.generation AND x.issue=g.issue)
                 FROM error_groups g WHERE fp_hash=?1",
                params![vec![
                    0xfe_u8, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10, 0xfe, 0xdc, 0xba, 0x98,
                    0x76, 0x54, 0x32, 0x10,
                ]],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert!(bytes.0 >= 1);
        assert!(bytes.1 <= ERROR_EXEMPLAR_DEPTH as i64);
        assert!(
            bytes.2 <= ERROR_EXEMPLAR_BYTES as i64,
            "SQLite BLOB length counts UTF-8 bytes"
        );

        let mixed_hash = "00112233445566778899aabbccddeeff";
        let mut oversized = eligible_failure_event(
            &generation,
            13,
            1,
            mixed_hash,
            FailureDispositionV1::Fault,
            None,
            Some("small".to_owned()),
        );
        oversized.details.as_mut().unwrap()["messageTemplate"] =
            json!("x".repeat(ERROR_EXEMPLAR_BYTES + 1));
        let valid = eligible_failure_event(
            &generation,
            14,
            1,
            mixed_hash,
            FailureDispositionV1::Fault,
            None,
            Some("valid".to_owned()),
        );
        let mut duplicate = valid.clone();
        duplicate.sequence = 15;
        let mut mixed = vec![oversized, valid, duplicate];
        mixed.extend((16..=19).map(|sequence| {
            eligible_failure_event(
                &generation,
                sequence,
                1,
                mixed_hash,
                FailureDispositionV1::Fault,
                None,
                Some("valid".to_owned()),
            )
        }));
        store.flush(mixed, BTreeMap::new(), 40_020, false).unwrap();
        let mixed_limits: (i64, i64, i64) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT exemplar_byte_drop_count,exemplar_flush_drop_count,
                        (SELECT count(*) FROM error_exemplars x
                         WHERE x.generation=g.generation AND x.issue=g.issue)
                 FROM error_groups g WHERE fp_hash=?1",
                params![vec![
                    0x00_u8, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb,
                    0xcc, 0xdd, 0xee, 0xff,
                ]],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            mixed_limits,
            (1, 0, 5),
            "oversized and duplicate attempts do not consume the five successful-insert slots"
        );
    }

    #[test]
    fn sequence_exhaustion_fails_closed_before_tokens_repeat() {
        assert_eq!(
            advance_error_state_seq(-1).unwrap_err().diagnostic.code,
            "SNAPBACK_ERROR_STATE_SEQUENCE_INVALID"
        );
        assert_eq!(
            advance_error_state_seq(i64::MAX)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_ERROR_STATE_SEQUENCE_EXHAUSTED"
        );

        let generation = "gen_sequence_fixture";
        let policy = config();
        let mut buffer = Buffer {
            current_generation: generation.to_owned(),
            next_sequence: i64::MAX as u64 - 1,
            ..Buffer::default()
        };
        enqueue_locked(&mut buffer, &policy, joined(generation, "function_run", 0));
        enqueue_locked(&mut buffer, &policy, joined(generation, "function_run", 0));
        assert_eq!(buffer.len(), 1);
        assert_eq!(buffer.normal.front().unwrap().sequence, i64::MAX as u64);
        assert_eq!(buffer.next_sequence, i64::MAX as u64);
        assert_eq!(
            buffer
                .pending_drop_counters
                .get("function_run:normal:sequenceExhausted"),
            Some(&1)
        );
    }

    #[test]
    fn resolve_barrier_orders_unflushed_admissions_and_preserves_history_until_reresolve() {
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app-errors", "preview-errors"),
            config(),
        )
        .unwrap();
        let generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        let hash = "0123456789abcdef0123456789abcdef";
        telemetry.enqueue(
            eligible_failure_event(
                &generation,
                0,
                1,
                hash,
                FailureDispositionV1::Fault,
                None,
                None,
            ),
            true,
        );
        telemetry.force_flush().unwrap();
        let issue: String = telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT issue FROM error_groups", [], |row| row.get(0))
            .unwrap();

        telemetry.enqueue(
            eligible_failure_event(
                &generation,
                0,
                1,
                hash,
                FailureDispositionV1::Fault,
                None,
                None,
            ),
            true,
        );
        telemetry.set_release(Some("release-resolve-a"));
        assert!(matches!(
            telemetry
                .transition_error_issue(&issue, ErrorIssueState::Resolved, 0)
                .unwrap(),
            ErrorTransitionResult::Applied { state_seq: 1, .. }
        ));
        assert!(matches!(
            telemetry
                .transition_error_issue(&issue, ErrorIssueState::Ignored, 0)
                .unwrap(),
            ErrorTransitionResult::Conflict {
                state: ErrorIssueState::Resolved,
                state_seq: 1,
                ..
            }
        ));
        telemetry.force_flush().unwrap();
        let overtaken: (String, i64, Option<i64>, i64) = telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT state,resolved_seq,last_regressed_seq,count FROM error_groups",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            overtaken,
            ("resolved".to_owned(), 2, None, 2),
            "an occurrence admitted before the resolve barrier cannot regress when it flushes afterward"
        );
        telemetry.enqueue(
            eligible_failure_event(
                &generation,
                0,
                1,
                hash,
                FailureDispositionV1::Fault,
                None,
                None,
            ),
            true,
        );
        telemetry.force_flush().unwrap();
        let first_resolve: (String, i64, i64, String) = telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT state,state_seq,resolved_seq,resolved_release FROM error_groups",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            first_resolve,
            ("regressed".to_owned(), 2, 2, "release-resolve-a".to_owned())
        );

        assert!(matches!(
            telemetry
                .transition_error_issue(&issue, ErrorIssueState::Ignored, 2)
                .unwrap(),
            ErrorTransitionResult::Applied { state_seq: 3, .. }
        ));
        assert!(matches!(
            telemetry
                .transition_error_issue(&issue, ErrorIssueState::Open, 3)
                .unwrap(),
            ErrorTransitionResult::Applied { state_seq: 4, .. }
        ));
        telemetry.set_release(Some("release-resolve-b"));
        assert!(matches!(
            telemetry
                .transition_error_issue(&issue, ErrorIssueState::Resolved, 4)
                .unwrap(),
            ErrorTransitionResult::Applied { state_seq: 5, .. }
        ));
        let final_state: (String, i64, i64, String) = telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT state,state_seq,resolved_seq,resolved_release FROM error_groups",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(final_state.0, "resolved");
        assert_eq!(final_state.1, 5);
        assert!(final_state.2 >= first_resolve.2);
        assert_eq!(final_state.3, "release-resolve-b");
    }

    #[test]
    fn direct_transition_gate_keeps_a_post_capture_enqueue_ahead_of_the_next_flush() {
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app-gate", "preview-gate"),
            config(),
        )
        .unwrap();
        let generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        let hash = "0123456789abcdef0123456789abcdef";
        telemetry.enqueue(
            eligible_failure_event(
                &generation,
                0,
                1,
                hash,
                FailureDispositionV1::Fault,
                None,
                None,
            ),
            true,
        );
        telemetry.force_flush().unwrap();
        let issue: String = telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT issue FROM error_groups", [], |row| row.get(0))
            .unwrap();

        let gate = telemetry.producer.shared.flush_gate.lock().unwrap();
        let barrier = telemetry.capture_enqueue_sequence().unwrap();
        {
            let policy = telemetry.producer.shared.config.read().unwrap().clone();
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            enqueue_locked(
                &mut buffer,
                &policy,
                eligible_failure_event(
                    &generation,
                    0,
                    1,
                    hash,
                    FailureDispositionV1::Fault,
                    None,
                    None,
                ),
            );
            assert_eq!(buffer.next_sequence, u64::try_from(barrier).unwrap() + 1);
        }
        telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .transition_error_issue(
                ErrorIssueTransition {
                    issue: &issue,
                    to: ErrorIssueState::Resolved,
                    expect_seq: 0,
                    barrier: Some(barrier),
                    release: Some("release-gate"),
                    actor: "admin",
                },
                wall_now_ms(),
            )
            .unwrap();
        drop(gate);
        telemetry.force_flush().unwrap();

        let state: (String, i64, i64) = telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT state,resolved_seq,last_regressed_seq FROM error_groups",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(state, ("regressed".to_owned(), barrier, barrier + 1));
    }

    #[test]
    fn bulk_resolve_uses_the_exact_activation_sequence_and_reports_unknown_selectors() {
        let mut store =
            Store::memory_unbound("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        let before_hash = "0123456789abcdef0123456789abcdef";
        let skipped_hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let after_hash = "fedcba9876543210fedcba9876543210";
        store
            .flush(
                vec![
                    eligible_failure_event(
                        &generation,
                        1,
                        1,
                        before_hash,
                        FailureDispositionV1::Fault,
                        None,
                        None,
                    ),
                    eligible_failure_event(
                        &generation,
                        2,
                        1,
                        skipped_hash,
                        FailureDispositionV1::Fault,
                        None,
                        None,
                    ),
                    release_activation_event(&generation, 3, "release-bulk"),
                    eligible_failure_event(
                        &generation,
                        4,
                        1,
                        after_hash,
                        FailureDispositionV1::Fault,
                        None,
                        None,
                    ),
                ],
                BTreeMap::new(),
                50_000,
                false,
            )
            .unwrap();
        let skipped_issue: String = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT issue FROM error_groups WHERE last_seen_seq=2",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(matches!(
            store
                .transition_error_issue(
                    ErrorIssueTransition {
                        issue: &skipped_issue,
                        to: ErrorIssueState::Ignored,
                        expect_seq: 0,
                        barrier: None,
                        release: None,
                        actor: "admin",
                    },
                    50_001,
                )
                .unwrap(),
            ErrorTransitionResult::Applied {
                state: ErrorIssueState::Ignored,
                ..
            }
        ));
        let result = store
            .resolve_errors_open_before("release-bulk", 4, 50_002)
            .unwrap();
        assert!(result.known_release);
        assert_eq!(result.activation_seq, Some(3));
        assert_eq!(result.rows.len(), 2);
        assert!(result.rows.iter().any(|row| matches!(
            row,
            ErrorTransitionResult::Applied {
                state: ErrorIssueState::Resolved,
                ..
            }
        )));
        assert!(result.rows.iter().any(|row| matches!(
            row,
            ErrorTransitionResult::Invalid {
                state: ErrorIssueState::Ignored,
                ..
            }
        )));
        let states = store
            .conn
            .as_ref()
            .unwrap()
            .prepare("SELECT last_seen_seq,state,resolved_release FROM error_groups ORDER BY last_seen_seq")
            .unwrap()
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            states,
            vec![
                (1, "resolved".to_owned(), Some("release-bulk".to_owned())),
                (2, "ignored".to_owned(), None),
                (4, "open".to_owned(), None),
            ]
        );
        let unknown = store
            .resolve_errors_open_before("unknown-release", 4, 50_003)
            .unwrap();
        assert!(!unknown.known_release);
        assert!(unknown.rows.is_empty());
    }

    #[test]
    fn typed_errors_operations_preserve_since_raw_tier_and_bulk_selector_semantics() {
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app-errors-api", "preview-errors-api"),
            config(),
        )
        .unwrap();
        let generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        telemetry.enqueue(
            release_activation_event(&generation, 0, "release-before"),
            true,
        );
        let mut old = eligible_failure_event(
            &generation,
            0,
            1,
            "0123456789abcdef0123456789abcdef",
            FailureDispositionV1::Fault,
            None,
            Some("database timeout {number}".to_owned()),
        );
        old.release = Some("release-before".to_owned());
        telemetry.enqueue(old, true);
        let mut bridge_before = eligible_failure_event(
            &generation,
            0,
            1,
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            FailureDispositionV1::Fault,
            None,
            Some("bridge before deploy {number}".to_owned()),
        );
        bridge_before.release = Some("release-before".to_owned());
        telemetry.enqueue(bridge_before, true);
        telemetry.enqueue(
            release_activation_event(&generation, 0, "release-errors-api"),
            true,
        );
        let mut bridge_after = eligible_failure_event(
            &generation,
            0,
            1,
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            FailureDispositionV1::Fault,
            None,
            Some("bridge after deploy {number}".to_owned()),
        );
        bridge_after.release = Some("release-errors-api".to_owned());
        telemetry.enqueue(bridge_after, true);
        let mut successor = eligible_failure_event(
            &generation,
            0,
            1,
            "fedcba9876543210fedcba9876543210",
            FailureDispositionV1::Fault,
            None,
            Some("successor timeout {number}".to_owned()),
        );
        successor.release = Some("release-errors-api".to_owned());
        successor.correlation = Some("corr_fixture".to_owned());
        telemetry.enqueue(successor, true);
        telemetry.force_flush().unwrap();

        let all = telemetry
            .query_error_issues(&crate::errors_query::ErrorsIssuesRequestV1::default())
            .unwrap();
        assert_eq!(all.issues.len(), 3);
        assert_eq!(
            all.known_releases,
            vec!["release-before", "release-errors-api"]
        );
        assert_eq!(all.variance.transition_history_floor_seq, None);
        let bridge_issue = all
            .issues
            .iter()
            .find(|issue| issue.first_seen_seq == 3)
            .unwrap()
            .issue
            .clone();
        let structural = serde_json::to_string(&all).unwrap();
        assert!(!structural.contains("titleTemplate"));
        assert!(!structural.contains("stackHead"));

        let since = telemetry
            .query_error_issues(&crate::errors_query::ErrorsIssuesRequestV1 {
                since: Some("release-errors-api".to_owned()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(since.issues.len(), 1);
        assert!(since.issues[0].first_seen_seq >= 4);
        let first_release = telemetry
            .query_error_issues(&crate::errors_query::ErrorsIssuesRequestV1 {
                release: Some("release-before".to_owned()),
                ..Default::default()
            })
            .unwrap();
        let last_release = telemetry
            .query_error_issues(&crate::errors_query::ErrorsIssuesRequestV1 {
                release: Some("release-errors-api".to_owned()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(first_release.issues.len(), 2);
        assert_eq!(last_release.issues.len(), 2);
        assert_eq!(
            first_release
                .issues
                .iter()
                .filter(|first| last_release
                    .issues
                    .iter()
                    .any(|last| last.issue == first.issue))
                .count(),
            1,
            "release= matches first_release or last_release equality; it does not substitute activation ordering"
        );
        let first_page = telemetry
            .query_error_issues(&crate::errors_query::ErrorsIssuesRequestV1 {
                limit: 1,
                ..Default::default()
            })
            .unwrap();
        let cursor = first_page.next_cursor.expect("three issues yield a cursor");
        let spliced = telemetry
            .query_error_issues(&crate::errors_query::ErrorsIssuesRequestV1 {
                kind: Some("different-kind".to_owned()),
                cursor: Some(cursor),
                limit: 1,
                ..Default::default()
            })
            .unwrap_err();
        assert_eq!(spliced.diagnostic.code, "SNAPBACK_ERRORS_QUERY_INVALID");
        let detail = telemetry
            .query_error_issue(&crate::errors_query::ErrorsIssueRequestV1 {
                issue: since.issues[0].issue.clone(),
            })
            .unwrap();
        assert_eq!(detail.exemplars.len(), 1);
        assert_eq!(
            detail.exemplars[0].title_template.as_deref(),
            Some("successor timeout {number}")
        );
        assert_eq!(
            detail.exemplars[0].telemetry_events_query.operation,
            "telemetry.events"
        );
        let recorded_ts_ms = detail.exemplars[0].recorded_ts_ms;
        assert_eq!(
            detail.exemplars[0].telemetry_events_query.input,
            json!({
                "correlation": "corr_fixture",
                "fromMs": recorded_ts_ms.saturating_sub(60_000).max(0),
                "toMs": recorded_ts_ms.saturating_add(60_000),
                "order": "asc",
                "limit": 100,
            }),
            "raw detail must return the pinned ready-to-run correlation query"
        );
        assert!(!detail.variance.exemplar_stale);
        assert_eq!(detail.variance.transition_history_floor_seq, Some(0));
        assert!(
            !detail.variance.transition_history_truncated,
            "a fresh state_seq=0 group reports an exact, untruncated transition floor"
        );
        {
            let mut store = telemetry
                .producer
                .shared
                .store
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let connection = store.ensure_connection(wall_now_ms()).unwrap();
            connection
                .execute(
                    "DELETE FROM error_exemplars WHERE issue=?1",
                    params![since.issues[0].issue],
                )
                .unwrap();
        }
        let aged_out = telemetry
            .query_error_issue(&crate::errors_query::ErrorsIssueRequestV1 {
                issue: since.issues[0].issue.clone(),
            })
            .unwrap();
        assert!(aged_out.exemplars.is_empty());
        assert!(
            aged_out.variance.exemplar_stale,
            "stale means the group survives after every raw exemplar aged out"
        );
        telemetry.set_release(Some("release-errors-api"));
        assert!(matches!(
            telemetry
                .transition_error_issue(&bridge_issue, ErrorIssueState::Resolved, 0)
                .unwrap(),
            ErrorTransitionResult::Applied { state_seq: 1, .. }
        ));
        let mut bridge_recurrence = eligible_failure_event(
            &generation,
            0,
            1,
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            FailureDispositionV1::Fault,
            None,
            Some("bridge after deploy {number}".to_owned()),
        );
        bridge_recurrence.release = Some("release-errors-api".to_owned());
        telemetry.enqueue(bridge_recurrence, true);
        telemetry.force_flush().unwrap();
        let mut state = ErrorIssueState::Regressed;
        for expect_seq in 2..=102 {
            let to = if state == ErrorIssueState::Resolved {
                ErrorIssueState::Open
            } else {
                ErrorIssueState::Resolved
            };
            assert!(matches!(
                telemetry
                    .transition_error_issue(&bridge_issue, to, expect_seq)
                    .unwrap(),
                ErrorTransitionResult::Applied { .. }
            ));
            state = to;
        }
        let pruned_detail = telemetry
            .query_error_issue(&crate::errors_query::ErrorsIssueRequestV1 {
                issue: bridge_issue.clone(),
            })
            .unwrap();
        assert!(pruned_detail.variance.transition_history_truncated);
        assert!(
            pruned_detail
                .variance
                .transition_history_floor_seq
                .is_some_and(|floor| floor > 1)
        );
        let since_after_pruning = telemetry
            .query_error_issues(&crate::errors_query::ErrorsIssuesRequestV1 {
                since: Some("release-errors-api".to_owned()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(since_after_pruning.issues.len(), 2);
        assert!(
            since_after_pruning
                .issues
                .iter()
                .any(|issue| issue.issue == bridge_issue
                    && issue.last_regressed_seq.is_some_and(|seq| seq > 4)),
            "since remains a group-sequence predicate after transition history pruning"
        );
        let wrong_kind = telemetry
            .query_error_issue(&crate::errors_query::ErrorsIssueRequestV1 {
                issue: "obs_00000000000000000000000000".to_owned(),
            })
            .unwrap_err();
        assert_eq!(
            wrong_kind.diagnostic.code,
            "SNAPBACK_ERROR_ISSUE_ID_INVALID"
        );
        let malformed = telemetry
            .transition_errors(&crate::errors_query::ErrorsTransitionRequestV1::Single(
                crate::errors_query::ErrorsSingleTransitionRequestV1 {
                    issue: "iss_not-crockford".to_owned(),
                    to: crate::errors_query::ErrorsIssueStateV1::Resolved,
                    expect_seq: 0,
                },
            ))
            .unwrap_err();
        assert_eq!(malformed.diagnostic.code, "SNAPBACK_ERROR_ISSUE_ID_INVALID");

        let bulk = telemetry
            .transition_errors(&crate::errors_query::ErrorsTransitionRequestV1::Bulk(
                crate::errors_query::ErrorsBulkTransitionRequestV1 {
                    selector: crate::errors_query::ErrorsTransitionSelectorV1 {
                        open_before: "release-errors-api".to_owned(),
                    },
                    to: crate::errors_query::ErrorsIssueStateV1::Resolved,
                },
            ))
            .unwrap();
        assert_eq!(bulk.activation_seq, Some(4));
        assert_eq!(bulk.rows.len(), 1);
        assert_eq!(
            bulk.rows[0].outcome,
            crate::errors_query::ErrorTransitionOutcomeV1::Applied
        );
        let unknown = telemetry
            .query_error_issues(&crate::errors_query::ErrorsIssuesRequestV1 {
                since: Some("release-unknown".to_owned()),
                ..Default::default()
            })
            .unwrap_err();
        assert_eq!(
            unknown.diagnostic.code,
            "SNAPBACK_ERROR_RELEASE_UNKNOWN_OR_PRUNED"
        );
        assert_eq!(
            unknown.diagnostic.details["knownReleases"],
            json!(["release-before", "release-errors-api"])
        );
        let unknown_release = telemetry
            .query_error_issues(&crate::errors_query::ErrorsIssuesRequestV1 {
                release: Some("release-unknown".to_owned()),
                ..Default::default()
            })
            .unwrap_err();
        assert_eq!(
            unknown_release.diagnostic.code,
            "SNAPBACK_ERROR_RELEASE_UNKNOWN_OR_PRUNED"
        );
        {
            let mut store = telemetry
                .producer
                .shared
                .store
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let connection = store.ensure_connection(wall_now_ms()).unwrap();
            connection
                .execute(
                    "UPDATE telemetry_meta SET release_activation_floor_seq=1 WHERE singleton=1",
                    [],
                )
                .unwrap();
        }
        let below_floor = telemetry
            .query_error_issues(&crate::errors_query::ErrorsIssuesRequestV1 {
                release: Some("release-before".to_owned()),
                ..Default::default()
            })
            .unwrap_err();
        assert_eq!(
            below_floor.diagnostic.code,
            "SNAPBACK_ERROR_RELEASE_UNKNOWN_OR_PRUNED"
        );
        assert_eq!(
            below_floor.diagnostic.details["knownReleases"],
            json!(["release-errors-api"])
        );
    }

    #[test]
    fn error_views_enforce_disable_generation_group_horizon_and_raw_floor_strictly() {
        let mut store =
            Store::memory_unbound("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        store
            .flush(
                vec![
                    eligible_failure_event(
                        &generation,
                        1,
                        1,
                        "0123456789abcdef0123456789abcdef",
                        FailureDispositionV1::Fault,
                        None,
                        None,
                    ),
                    release_activation_event(&generation, 2, "release-visible"),
                ],
                BTreeMap::new(),
                60_000,
                false,
            )
            .unwrap();
        let conn = store.conn.as_ref().unwrap();
        for view in [
            "error_groups_visible",
            "error_exemplars_visible",
            "error_transitions_visible",
            "release_activations_visible",
        ] {
            let count: i64 = conn
                .query_row(&format!("SELECT count(*) FROM {view}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            if view != "error_transitions_visible" {
                assert_eq!(count, 1, "{view}");
            }
        }
        conn.execute(
            "UPDATE telemetry_meta SET max_days_mirror=0 WHERE singleton=1",
            [],
        )
        .unwrap();
        for view in [
            "error_groups_visible",
            "error_exemplars_visible",
            "error_transitions_visible",
            "release_activations_visible",
        ] {
            assert_eq!(
                conn.query_row(&format!("SELECT count(*) FROM {view}"), [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                0,
                "disabled {view}"
            );
        }

        let clock: i64 = conn
            .query_row(
                "SELECT observation_clock_ms FROM telemetry_meta WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let group_boundary = clock - i64::from(config().daily_days) * DAY_MS;
        let raw_boundary = clock - i64::from(config().max_days) * DAY_MS;
        conn.execute(
            "UPDATE telemetry_meta SET max_days_mirror=?1,retention_floor=?2 WHERE singleton=1",
            params![config().max_days, raw_boundary],
        )
        .unwrap();
        let expired_issue: String = conn
            .query_row("SELECT issue FROM error_groups", [], |row| row.get(0))
            .unwrap();
        conn.execute(
            "UPDATE error_exemplars SET recorded_ts_ms=?1",
            params![raw_boundary],
        )
        .unwrap();
        let raw_aged = crate::errors_query::query_issue(
            conn,
            &crate::errors_query::ErrorsIssueRequestV1 {
                issue: expired_issue.clone(),
            },
            &crate::telemetry_query::QueryContext {
                drops_since_boot: BTreeMap::new(),
                last_flush_watermark: None,
            },
        )
        .unwrap();
        assert!(raw_aged.exemplars.is_empty());
        assert!(
            raw_aged.variance.exemplar_stale,
            "the detail response labels a surviving group after its exemplar crosses the strict raw floor"
        );
        conn.execute(
            "UPDATE error_groups SET last_seen_ms=?1",
            params![group_boundary],
        )
        .unwrap();
        conn.execute(
            "UPDATE release_activations SET last_activated_ms=?1",
            params![group_boundary],
        )
        .unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM error_groups_visible", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM error_exemplars_visible", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM release_activations_visible",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM error_groups", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1,
            "strict read boundaries hide stale keys before the maintenance sweep"
        );
        store
            .flush(
                vec![eligible_failure_event(
                    &generation,
                    3,
                    1,
                    "0123456789abcdef0123456789abcdef",
                    FailureDispositionV1::Fault,
                    None,
                    None,
                )],
                BTreeMap::new(),
                clock + 1,
                false,
            )
            .unwrap();
        let recurrent_issue: String = store
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT issue FROM error_groups", [], |row| row.get(0))
            .unwrap();
        assert_ne!(
            recurrent_issue, expired_issue,
            "a recurrence after the group horizon mints a fresh issue identity"
        );
        let response = crate::errors_query::query_issues(
            store.conn.as_ref().unwrap(),
            &crate::errors_query::ErrorsIssuesRequestV1::default(),
            &crate::telemetry_query::QueryContext {
                drops_since_boot: BTreeMap::new(),
                last_flush_watermark: None,
            },
        )
        .unwrap();
        assert_eq!(response.issues.len(), 1);
        assert_eq!(
            response.variance.group_horizon_start_ms,
            clock + 1 - i64::from(config().daily_days) * DAY_MS,
            "the issue response exposes the exact horizon used to forget the old group"
        );
    }

    #[test]
    fn restart_seed_makes_the_first_post_crash_failure_regress_past_a_lost_admission() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("restart.telemetry");
        let policy = config();
        let incarnation = "01900000-0000-7000-8000-000000000001";
        let hash = "0123456789abcdef0123456789abcdef";
        let base = wall_now_ms();
        let issue = {
            let mut store = Store::open(path.clone(), incarnation, policy.clone()).unwrap();
            let generation = store.generation.clone();
            store
                .flush(
                    vec![eligible_failure_event(
                        &generation,
                        1,
                        1,
                        hash,
                        FailureDispositionV1::Fault,
                        None,
                        None,
                    )],
                    BTreeMap::new(),
                    base,
                    false,
                )
                .unwrap();
            let issue: String = store
                .conn
                .as_ref()
                .unwrap()
                .query_row("SELECT issue FROM error_groups", [], |row| row.get(0))
                .unwrap();
            let telemetry = Telemetry::from_store(store, policy.clone()).unwrap();
            {
                let active_policy = telemetry.producer.shared.config.read().unwrap().clone();
                let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
                enqueue_locked(
                    &mut buffer,
                    &active_policy,
                    eligible_failure_event(
                        &generation,
                        0,
                        1,
                        hash,
                        FailureDispositionV1::Fault,
                        None,
                        None,
                    ),
                );
                assert_eq!(
                    buffer.len(),
                    1,
                    "one admitted occurrence is still unflushed"
                );
                assert_eq!(buffer.next_sequence, 2);
            }
            telemetry.set_release(Some("release-before-crash"));
            assert!(matches!(
                telemetry
                    .transition_error_issue(&issue, ErrorIssueState::Resolved, 0)
                    .unwrap(),
                ErrorTransitionResult::Applied { state_seq: 1, .. }
            ));
            assert_eq!(
                telemetry.producer.shared.buffer.lock().unwrap().len(),
                1,
                "resolve commits without flushing the earlier admission"
            );
            assert_eq!(
                telemetry
                    .producer
                    .shared
                    .store
                    .lock()
                    .unwrap()
                    .enqueue_sequence_seed()
                    .unwrap(),
                2,
                "the resolve transaction durably advances the admission high-water"
            );
            // Model process loss exactly: do not run Producer::drop, whose
            // graceful-shutdown contract would flush this admission.
            std::mem::forget(telemetry);
            issue
        };

        let store = Store::open(path, incarnation, policy.clone()).unwrap();
        assert_eq!(store.enqueue_sequence_seed().unwrap(), 2);
        let generation = store.generation.clone();
        let telemetry = Telemetry::from_store(store, policy).unwrap();
        telemetry.enqueue(
            eligible_failure_event(
                &generation,
                0,
                1,
                hash,
                FailureDispositionV1::Fault,
                None,
                None,
            ),
            true,
        );
        telemetry.force_flush().unwrap();
        let state: (String, i64, i64, i64) = telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT state,resolved_seq,last_regressed_seq,count FROM error_groups WHERE issue=?1",
                params![issue],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(state.0, "regressed");
        assert_eq!(state.1, 2);
        assert!(
            state.2 > state.1,
            "the first post-restart failure follows both the durable barrier and any boot marker"
        );
        assert_eq!(state.3, 2);
    }

    #[test]
    fn group_and_activation_caps_fold_or_prune_with_visible_counters_and_floor() {
        let mut store =
            Store::memory_unbound("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        let group_events = (0..=ERROR_GROUP_CAP)
            .map(|index| {
                eligible_failure_event(
                    &generation,
                    index as u64 + 1,
                    1,
                    &format!("{index:032x}"),
                    FailureDispositionV1::Fault,
                    None,
                    None,
                )
            })
            .collect::<Vec<_>>();
        let activation_start = group_events.len() as u64 + 1;
        store
            .flush(group_events, BTreeMap::new(), 80_000, false)
            .unwrap();
        let activation_events = (0..=RELEASE_ACTIVATION_CAP)
            .map(|index| {
                release_activation_event(
                    &generation,
                    activation_start + index as u64,
                    &format!("release-{index:04}"),
                )
            })
            .collect::<Vec<_>>();
        store
            .flush(activation_events, BTreeMap::new(), 80_001, false)
            .unwrap();
        let conn = store.conn.as_ref().unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM error_groups", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            ERROR_GROUP_CAP as i64
        );
        let meta: (i64, i64) = conn
            .query_row(
                "SELECT overflow_fold_count,release_activation_floor_seq FROM telemetry_meta",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(meta.0, 1);
        assert_eq!(meta.1, activation_start as i64);
        assert_eq!(
            conn.query_row("SELECT count(*) FROM release_activations", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            RELEASE_ACTIVATION_CAP as i64
        );
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM error_groups WHERE fp_hash=?1",
                params![
                    vec![0_u8; 14]
                        .into_iter()
                        .chain([0x03, 0xe8])
                        .collect::<Vec<_>>()
                ],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            0,
            "the over-cap fingerprint has no group row"
        );
        let visible = crate::errors_query::query_issues(
            conn,
            &crate::errors_query::ErrorsIssuesRequestV1 {
                limit: crate::errors_query::MAX_ISSUE_LIMIT,
                ..Default::default()
            },
            &crate::telemetry_query::QueryContext {
                drops_since_boot: BTreeMap::new(),
                last_flush_watermark: None,
            },
        )
        .unwrap();
        assert_eq!(visible.variance.overflow_fold_count, 1);
        assert_eq!(
            visible.variance.overflow_fold_scope,
            "cumulativeSinceGenerationStart"
        );
        assert!(
            visible.next_cursor.is_some(),
            "the visible groups remain honestly paginated"
        );
        let _ = conn;
        let below_floor = store
            .resolve_errors_open_before("release-0000", activation_start as i64, 80_002)
            .unwrap();
        assert!(!below_floor.known_release);
        assert_eq!(below_floor.activation_floor_seq, activation_start as i64);
    }

    #[test]
    fn generation_rotation_isolates_then_sweeps_error_state_and_resets_floors() {
        let mut store =
            Store::memory_unbound("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let old_generation = store.generation.clone();
        let hash = "0123456789abcdef0123456789abcdef";
        store
            .flush(
                vec![
                    eligible_failure_event(
                        &old_generation,
                        1,
                        1,
                        hash,
                        FailureDispositionV1::Fault,
                        None,
                        None,
                    ),
                    release_activation_event(&old_generation, 2, "release-old"),
                ],
                BTreeMap::new(),
                90_000,
                false,
            )
            .unwrap();
        let old_issue: String = store
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT issue FROM error_groups", [], |row| row.get(0))
            .unwrap();
        store
            .conn
            .as_ref()
            .unwrap()
            .execute(
                "UPDATE telemetry_meta SET overflow_fold_count=7,release_activation_floor_seq=2",
                [],
            )
            .unwrap();
        store
            .rebind("01900000-0000-7000-8000-000000000002", 90_001)
            .unwrap();
        let new_generation = store.generation.clone();
        assert_ne!(old_generation, new_generation);
        let visible: (i64, i64, i64, i64) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT (SELECT count(*) FROM error_groups_visible),
                        (SELECT count(*) FROM release_activations_visible),
                        overflow_fold_count,release_activation_floor_seq FROM telemetry_meta",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(visible, (0, 0, 0, 0));
        store
            .flush(
                vec![eligible_failure_event(
                    &new_generation,
                    3,
                    1,
                    hash,
                    FailureDispositionV1::Fault,
                    None,
                    None,
                )],
                BTreeMap::new(),
                90_002,
                false,
            )
            .unwrap();
        let conn = store.conn.as_ref().unwrap();
        let new_issue: String = conn
            .query_row("SELECT issue FROM error_groups", [], |row| row.get(0))
            .unwrap();
        assert_ne!(old_issue, new_issue);
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM error_groups WHERE generation<>?1",
                params![new_generation],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM release_activations", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        let response = crate::errors_query::query_issues(
            conn,
            &crate::errors_query::ErrorsIssuesRequestV1::default(),
            &crate::telemetry_query::QueryContext {
                drops_since_boot: BTreeMap::new(),
                last_flush_watermark: None,
            },
        )
        .unwrap();
        assert_eq!(response.variance.overflow_fold_count, 0);
        assert_eq!(response.issues.len(), 1);
    }

    #[test]
    fn transition_history_cap_has_a_derived_non_drifting_floor() {
        let mut store =
            Store::memory_unbound("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        store
            .flush(
                vec![eligible_failure_event(
                    &generation,
                    1,
                    1,
                    "0123456789abcdef0123456789abcdef",
                    FailureDispositionV1::Fault,
                    None,
                    None,
                )],
                BTreeMap::new(),
                100_000,
                false,
            )
            .unwrap();
        let issue: String = store
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT issue FROM error_groups", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            store
                .error_transition_history_floor(&issue, 100_000)
                .unwrap()
                .unwrap(),
            ErrorTransitionHistoryFloor {
                floor_seq: 0,
                history_truncated: false,
            },
            "a fresh group exposes floor zero without a truncation claim"
        );
        let mut state = ErrorIssueState::Open;
        for state_seq in 0..102 {
            let to = if state == ErrorIssueState::Open {
                ErrorIssueState::Resolved
            } else {
                ErrorIssueState::Open
            };
            store
                .transition_error_issue(
                    ErrorIssueTransition {
                        issue: &issue,
                        to,
                        expect_seq: state_seq,
                        barrier: (to == ErrorIssueState::Resolved).then_some(1),
                        release: Some("release-history"),
                        actor: "admin",
                    },
                    100_001 + state_seq,
                )
                .unwrap();
            state = to;
        }
        let history: (i64, i64, i64) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT count(*),min(seq),max(seq) FROM error_transitions WHERE issue=?1",
                params![issue],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(history, (ERROR_TRANSITIONS_PER_GROUP as i64, 3, 102));
        let floor = store
            .error_transition_history_floor(&issue, 100_200)
            .unwrap()
            .unwrap();
        assert_eq!(
            floor,
            ErrorTransitionHistoryFloor {
                floor_seq: 3,
                history_truncated: true,
            }
        );
        let detail = crate::errors_query::query_issue(
            store.conn.as_ref().unwrap(),
            &crate::errors_query::ErrorsIssueRequestV1 {
                issue: issue.clone(),
            },
            &crate::telemetry_query::QueryContext {
                drops_since_boot: BTreeMap::new(),
                last_flush_watermark: None,
            },
        )
        .unwrap();
        assert_eq!(detail.variance.transition_history_floor_seq, Some(3));
        assert!(detail.variance.transition_history_truncated);
        store
            .conn
            .as_ref()
            .unwrap()
            .execute(
                "DELETE FROM error_transitions WHERE issue=?1",
                params![issue],
            )
            .unwrap();
        assert_eq!(
            store
                .error_transition_history_floor(&issue, 100_201)
                .unwrap()
                .unwrap(),
            ErrorTransitionHistoryFloor {
                floor_seq: 102,
                history_truncated: true,
            }
        );
    }

    #[test]
    fn identifier_prefixes_are_registered_and_minted() {
        assert_eq!(IdKind::Observation.prefix(), "obs");
        assert_eq!(IdKind::Generation.prefix(), "gen");
        assert!(ids::mint(IdKind::Observation).unwrap().starts_with("obs_"));
        assert!(ids::mint(IdKind::Generation).unwrap().starts_with("gen_"));
    }

    #[test]
    fn standalone_diagnostics_apply_warning_floor_and_configured_minimum() {
        let mut policy = config();
        policy.min_level = DiagnosticSeverity::Error;
        policy.buffer_capacity = 4;
        policy.priority_reserve = 2;
        policy.batch_size = 64;
        policy.max_age_ms = 60_000;
        let telemetry =
            Telemetry::in_memory("01900000-0000-7000-8000-000000000001", policy.clone()).unwrap();

        let diagnostic = |code, severity| {
            Diagnostic::new(code, severity, "test", "diagnostic fixture", json!({}))
        };
        telemetry.standalone_diagnostic(&diagnostic("INFO_SUPPRESSED", DiagnosticSeverity::Info));
        telemetry.standalone_diagnostic(&diagnostic(
            "WARNING_SUPPRESSED",
            DiagnosticSeverity::Warning,
        ));
        telemetry.standalone_diagnostic(&diagnostic("ERROR_RECORDED", DiagnosticSeverity::Error));
        telemetry.force_flush().unwrap();

        let recorded = || {
            let store = telemetry.producer.shared.store.lock().unwrap();
            store
                .conn
                .as_ref()
                .unwrap()
                .prepare(
                    "SELECT name,code FROM telemetry_events_visible WHERE kind='diagnostic' ORDER BY id",
                )
                .unwrap()
                .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(
            recorded(),
            vec![("ERROR_RECORDED".to_owned(), "ERROR_RECORDED".to_owned())]
        );

        policy.min_level = DiagnosticSeverity::Info;
        telemetry.update_config(policy).unwrap();
        telemetry.standalone_diagnostic(&diagnostic(
            "INFO_STILL_SUPPRESSED",
            DiagnosticSeverity::Info,
        ));
        telemetry
            .standalone_diagnostic(&diagnostic("WARNING_RECORDED", DiagnosticSeverity::Warning));
        for name in ["pressure_one", "pressure_two", "pressure_three"] {
            telemetry.point("log", name, None, None, None, None, Priority::Normal);
        }
        telemetry.force_flush().unwrap();
        assert_eq!(
            recorded(),
            vec![
                ("ERROR_RECORDED".to_owned(), "ERROR_RECORDED".to_owned()),
                ("WARNING_RECORDED".to_owned(), "WARNING_RECORDED".to_owned()),
            ],
            "Warning is reserved with its stable code under normal pressure"
        );
    }
}
