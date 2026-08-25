//! Pure error-tracking contracts shared by capture seams and artifact consumers.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const CLASSIFIER_VERSION: u32 = 1;
pub const FINGERPRINT_VERSION: u32 = 1;
pub const FAILURE_EXTRACTION_MAX_BYTES: usize = 16 * 1024;
pub const FAILURE_DETAILS_MAX_BYTES: usize = 8 * 1024;
pub const UNCLASSIFIED_ERROR_CLASS: &str = "unclassified";

pub const CLASSIFIER_FIXTURE_FILE: &str = "error-classification.fixtures-v1.json";
pub const FINGERPRINT_VECTOR_FILE: &str = "error-fingerprint.vectors-v1.json";
pub const CARRIER_FIXTURE_FILE: &str = "error-carrier.fixtures-v1.json";

pub const CANCELLATION_CODES: &[&str] = &[
    "SNAPBACK_ACTION_STREAM_CANCELLED",
    "SNAPBACK_AUTH_RESERVATION_CANCELLED",
    "SNAPBACK_MIGRATION_CANCELLED",
    "SNAPBACK_OPERATION_CANCELLED",
    "SNAPBACK_STREAM_CANCELLED",
];

pub const TIMEOUT_CODES: &[&str] = &[
    "SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT",
    "SNAPBACK_ACTION_STREAM_TIMEOUT",
    "SNAPBACK_ACTION_TIMEOUT",
    "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT",
    "SNAPBACK_HANDLER_DID_NOT_SETTLE",
    "SNAPBACK_HANDLER_WALL_CLOCK_EXCEEDED",
];

pub const OVERLOAD_CODES: &[&str] = &[
    "SNAPBACK_ACTION_CAPACITY_EXCEEDED",
    "SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED",
    "SNAPBACK_AUTH_THROTTLED",
    "SNAPBACK_BUNDLE_PENDING_CAPACITY",
    "SNAPBACK_BUNDLE_RATE_LIMITED",
    "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL",
    "SNAPBACK_CRON_DISPATCH_CAPACITY_EXCEEDED",
    "SNAPBACK_CRON_RUN_CAPACITY_EXCEEDED",
    "SNAPBACK_EPHEMERAL_RATE_LIMITED",
    "SNAPBACK_LIVE_STAGE_CAPACITY",
    "SNAPBACK_OVERLOADED",
    "SNAPBACK_STREAM_RATE_LIMITED",
    "SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT",
    "SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT",
];

pub const CALLER_ERROR_CODES: &[&str] = &[
    "SNAPBACK_ACTION_STREAM_INVALID",
    "SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED",
    "SNAPBACK_ACTION_STREAM_SSRF_REFUSED",
    "SNAPBACK_ARG_MISSING",
    "SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED",
    "SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY",
    "SNAPBACK_AUTH_GRANT_SCOPE_DENIED",
    "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED",
    "SNAPBACK_AUTH_PERMISSION_DENIED",
    "SNAPBACK_AUTH_REQUIRED",
    "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
    "SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED",
    "SNAPBACK_CTX_LEDGER_EXHAUSTED",
    "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED",
    "SNAPBACK_EXPECTED_STRING",
    "SNAPBACK_FIELD_ENUM_VALUE_INVALID",
    "SNAPBACK_FIELD_MISSING",
    "SNAPBACK_FIELD_TYPE_MISMATCH",
    "SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION",
    "SNAPBACK_FUNCTION_STREAM_KIND_INVALID",
    "SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED",
    "SNAPBACK_HANDLER_CAPABILITY_DENIED",
    "SNAPBACK_HANDLER_EVAL_OUTPUT_TOO_LARGE",
    "SNAPBACK_HANDLER_WRITE_IN_QUERY",
    "SNAPBACK_HOST_FETCH_SSRF_REFUSED",
    // diagnostics-registry: received SNAPBACK_INVALID_FLOAT
    "SNAPBACK_INVALID_FLOAT",
    "SNAPBACK_INVALID_IDENTIFIER",
    "SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED",
    "SNAPBACK_QUERY_FILTER_VALUE_INVALID",
    "SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED",
    "SNAPBACK_QUERY_IN_ITEMS_EXCEEDED",
    "SNAPBACK_QUERY_LIMIT_INVALID",
    "SNAPBACK_REQUEST_BODY_TIMEOUT",
    "SNAPBACK_REQUEST_JSON_INVALID",
    "SNAPBACK_SINGLE_TABLE_EXAMINED_ENTRY_CEILING_EXCEEDED",
    "SNAPBACK_STREAM_ATTEMPT_LIMIT_EXCEEDED",
    "SNAPBACK_STREAM_ATTEMPT_NOT_FOUND",
    "SNAPBACK_STREAM_CHUNK_INVALID",
    "SNAPBACK_STREAM_CHUNK_TOO_LARGE",
    "SNAPBACK_STREAM_FORBIDDEN",
    "SNAPBACK_STREAM_INITIATOR_REQUIRED",
    "SNAPBACK_STREAM_NOT_DECLARED",
    "SNAPBACK_STREAM_RUNNER_FENCED",
    "SNAPBACK_STREAM_TERMINAL",
    "SNAPBACK_STREAM_TRANSCRIPT_FORBIDDEN",
    "SNAPBACK_STREAM_TRANSCRIPT_NOT_FOUND",
    "SNAPBACK_UNKNOWN_FIELD",
    "SNAPBACK_UNKNOWN_FUNCTION",
    "SNAPBACK_UNKNOWN_TABLE",
    "SNAPBACK_VALUE_TOO_LARGE",
];

/// The closed failure-carrier category vocabulary supplied to classifier v1.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CarrierCategoryV1 {
    Diagnostic,
    AppRefusal,
    Exception,
    Transport,
}

/// A failure's semantic disposition. This is distinct from LLP 0154's usage
/// disposition axis.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureDispositionV1 {
    Fault,
    AppRefusal,
    CallerError,
    Cancellation,
    Timeout,
    Overload,
}

impl FailureDispositionV1 {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Fault => "fault",
            Self::AppRefusal => "app_refusal",
            Self::CallerError => "caller_error",
            Self::Cancellation => "cancellation",
            Self::Timeout => "timeout",
            Self::Overload => "overload",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FailureClassifierInputV1 {
    pub operation_class: String,
    /// The registry-admitted function/route/pattern name. The unmatched-route
    /// sentinel lives on this axis, not in the operation-class vocabulary.
    pub name: Option<String>,
    pub platform_code: Option<String>,
    /// HTTP status class, represented as 4 or 5 rather than a specific status.
    pub status_class: Option<u16>,
    pub carrier_category: CarrierCategoryV1,
    pub app_code: Option<String>,
    pub app_refusal_admitted: bool,
    pub app_refusal_tracked: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FailureClassificationV1 {
    pub failure_disposition: FailureDispositionV1,
    pub issue_eligible: bool,
    pub classifier_version: u32,
}

fn is_code_member(code: Option<&str>, membership: &[&str]) -> bool {
    code.is_some_and(|code| membership.binary_search(&code).is_ok())
}

/// LLP 0108's application-refusal code grammar.
pub fn app_refusal_code_is_valid(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 64
        && !code.starts_with("SNAPBACK_")
        && code
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
}

/// Classify one already-admitted failure. The order here is the normative
/// first-match order and is repeated verbatim in the registry artifact.
pub fn classify_failure(input: &FailureClassifierInputV1) -> FailureClassificationV1 {
    let code = input.platform_code.as_deref();
    let (failure_disposition, issue_eligible) = if input.carrier_category
        == CarrierCategoryV1::AppRefusal
        && code == Some("SNAPBACK_APP_REFUSAL")
        && input.app_refusal_admitted
        && input
            .app_code
            .as_deref()
            .is_some_and(app_refusal_code_is_valid)
    {
        (FailureDispositionV1::AppRefusal, input.app_refusal_tracked)
    } else if is_code_member(code, CANCELLATION_CODES) {
        (FailureDispositionV1::Cancellation, false)
    } else if is_code_member(code, TIMEOUT_CODES) {
        (FailureDispositionV1::Timeout, true)
    } else if is_code_member(code, OVERLOAD_CODES) {
        (FailureDispositionV1::Overload, true)
    } else if (input.carrier_category == CarrierCategoryV1::Transport
        && input.platform_code.is_none()
        && input.status_class == Some(4))
        || is_code_member(code, CALLER_ERROR_CODES)
        || input.name.as_deref() == Some("_unmatched")
    {
        (FailureDispositionV1::CallerError, false)
    } else {
        (FailureDispositionV1::Fault, true)
    };
    FailureClassificationV1 {
        failure_disposition,
        issue_eligible,
        classifier_version: CLASSIFIER_VERSION,
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FailureClassifierRegistryV1 {
    pub classifier_version: u32,
    pub carrier_categories: Vec<String>,
    pub failure_dispositions: Vec<String>,
    pub output_fields: Vec<String>,
    pub precedence: Vec<ClassifierArmV1>,
    pub closed_code_memberships: BTreeMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClassifierArmV1 {
    pub order: u32,
    pub arm: String,
    pub failure_disposition: FailureDispositionV1,
    pub issue_eligible_by_default: bool,
}

pub fn failure_classifier_registry() -> FailureClassifierRegistryV1 {
    let memberships = [
        ("cancellation", CANCELLATION_CODES),
        ("timeout", TIMEOUT_CODES),
        ("overload", OVERLOAD_CODES),
        ("caller_error", CALLER_ERROR_CODES),
    ]
    .into_iter()
    .map(|(name, values)| {
        (
            name.to_owned(),
            values.iter().map(|value| (*value).to_owned()).collect(),
        )
    })
    .collect();
    FailureClassifierRegistryV1 {
        classifier_version: CLASSIFIER_VERSION,
        carrier_categories: ["diagnostic", "app_refusal", "exception", "transport"]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        failure_dispositions: [
            "fault",
            "app_refusal",
            "caller_error",
            "cancellation",
            "timeout",
            "overload",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect(),
        output_fields: [
            "failure_disposition",
            "issue_eligible",
            "classifier_version",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect(),
        precedence: [
            (
                1,
                "declared_refusal",
                FailureDispositionV1::AppRefusal,
                false,
            ),
            (2, "cancellation", FailureDispositionV1::Cancellation, false),
            (3, "timeout", FailureDispositionV1::Timeout, true),
            (4, "overload", FailureDispositionV1::Overload, true),
            (5, "caller_error", FailureDispositionV1::CallerError, false),
            (6, "fault_residual", FailureDispositionV1::Fault, true),
        ]
        .into_iter()
        .map(
            |(order, arm, failure_disposition, issue_eligible_by_default)| ClassifierArmV1 {
                order,
                arm: arm.to_owned(),
                failure_disposition,
                issue_eligible_by_default,
            },
        )
        .collect(),
        closed_code_memberships: memberships,
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FailureCarrierV1 {
    pub error_class: String,
    pub message: Option<String>,
    pub stack: Option<String>,
    pub message_extraction_truncated: bool,
    pub stack_extraction_truncated: bool,
}

/// Host-admitted application-refusal tracking state. Admission and tracking
/// are deliberately distinct: every value here was admitted against the
/// function's `refusals`, while only `Tracked` was also present in its
/// immutable `trackedRefusals` authority.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppRefusalTrackingV1 {
    AdmittedUntracked,
    Tracked,
}

/// Runtime-private failure context carried beside a public Diagnostic. It is
/// never serialized; the later D-05 emission tranche consumes it at the
/// observation seam. A vector is required because Ibex can report more than
/// one unhandled rejection in deterministic queue order.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct PrivateFailureContextV1 {
    pub carriers: Vec<FailureCarrierV1>,
    pub app_refusal_tracking: Option<AppRefusalTrackingV1>,
}
