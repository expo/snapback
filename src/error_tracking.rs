//! Pure error-tracking contracts shared by capture seams and artifact consumers.
//!
//! This module deliberately owns no telemetry storage or runtime integration.
//! It freezes the first classifier, carrier, fingerprint, and details-allocation
//! contracts so later tranches can wire them without inventing policy at each
//! emission seam.
//!
//! @ref LLP 0156#e01--the-failure-classifier-and-issue-eligibility — exhaustive
//!   first-match classification is stamped at emission and never recomputed.
//! @ref LLP 0156#e02--the-failure-carrier — carrier text and details allocation
//!   are bounded before persistence.
//! @ref LLP 0156#e11--fingerprint-at-the-seam-group-in-the-flush-transaction —
//!   branch-tagged SHA-256 inputs are byte-pinned across implementations.

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest as _, Sha256};
use std::collections::BTreeMap;
#[cfg(test)]
use std::collections::BTreeSet;
use std::sync::OnceLock;

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
    "SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT",
    "SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT",
];

pub const CALLER_ERROR_CODES: &[&str] = &[
    "SNAPBACK_ACTION_STREAM_INVALID",
    "SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED",
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
    "SNAPBACK_FIELD_MISSING",
    "SNAPBACK_FIELD_TYPE_MISMATCH",
    "SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION",
    "SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED",
    "SNAPBACK_HANDLER_CAPABILITY_DENIED",
    "SNAPBACK_HANDLER_WRITE_IN_QUERY",
    "SNAPBACK_INVALID_FLOAT",
    "SNAPBACK_INVALID_IDENTIFIER",
    "SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED",
    "SNAPBACK_QUERY_FILTER_VALUE_INVALID",
    "SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED",
    "SNAPBACK_QUERY_IN_ITEMS_EXCEEDED",
    "SNAPBACK_QUERY_LIMIT_INVALID",
    "SNAPBACK_REQUEST_BODY_TIMEOUT",
    "SNAPBACK_REQUEST_JSON_INVALID",
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

/// Validates handler-controlled exception names into the one bounded carrier
/// vocabulary. The sentinel is deliberately reserved and can only be emitted
/// by this validator.
pub fn validated_error_class(raw: Option<&str>) -> String {
    let Some(raw) = raw else {
        return UNCLASSIFIED_ERROR_CLASS.to_owned();
    };
    let bytes = raw.as_bytes();
    let first_is_valid = bytes
        .first()
        .is_some_and(|byte| byte.is_ascii_alphabetic() || matches!(*byte, b'_' | b'$'));
    if raw != UNCLASSIFIED_ERROR_CLASS
        && raw.len() <= 64
        && first_is_valid
        && bytes[1..]
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(*byte, b'_' | b'$'))
    {
        raw.to_owned()
    } else {
        UNCLASSIFIED_ERROR_CLASS.to_owned()
    }
}

fn utf8_prefix(value: &str, maximum: usize) -> (&str, bool) {
    if value.len() <= maximum {
        return (value, false);
    }
    let mut end = maximum;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    (&value[..end], true)
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

pub fn extract_failure_carrier(
    error_class: Option<&str>,
    message: Option<&str>,
    stack: Option<&str>,
) -> FailureCarrierV1 {
    let (message, message_extraction_truncated) = message
        .map(|value| {
            let (value, truncated) = utf8_prefix(value, FAILURE_EXTRACTION_MAX_BYTES);
            (Some(value.to_owned()), truncated)
        })
        .unwrap_or((None, false));
    let (stack, stack_extraction_truncated) = stack
        .map(|value| {
            let (value, truncated) = utf8_prefix(value, FAILURE_EXTRACTION_MAX_BYTES);
            (Some(value.to_owned()), truncated)
        })
        .unwrap_or((None, false));
    FailureCarrierV1 {
        error_class: validated_error_class(error_class),
        message,
        stack,
        message_extraction_truncated,
        stack_extraction_truncated,
    }
}

fn normalizer_regex() -> &'static Regex {
    static NORMALIZER: OnceLock<Regex> = OnceLock::new();
    NORMALIZER.get_or_init(|| {
        Regex::new(
            r#"(?i)"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:0X)?[0-9A-HJKMNP-TV-Z]+"#,
        )
        .expect("fingerprint normalizer regex is valid")
    })
}

/// Fingerprint normalizer v1. Its replacement classes are intentionally
/// limited to the four classes named in LLP 0156; additions require a scheme
/// version bump.
pub fn normalize_message_v1(message: &str) -> String {
    normalizer_regex()
        .replace_all(message, |captures: &regex::Captures<'_>| {
            let token = captures.get(0).expect("whole match").as_str();
            if token.starts_with('\'') || token.starts_with('"') {
                "<quoted>".to_owned()
            } else if token.contains('@') {
                "<email>".to_owned()
            } else if ((token.starts_with("0x") || token.starts_with("0X"))
                && token.len() >= 10
                && token[2..].bytes().all(|byte| byte.is_ascii_hexdigit()))
                || (token.len() >= 8
                    && token.bytes().all(|byte| byte.is_ascii_hexdigit())
                    && token
                        .bytes()
                        .any(|byte| matches!(byte, b'a'..=b'f' | b'A'..=b'F')))
            {
                "<hex>".to_owned()
            } else if token.len() >= 12 && token.bytes().any(|byte| byte.is_ascii_alphabetic()) {
                "<base32>".to_owned()
            } else if token.bytes().all(|byte| byte.is_ascii_digit()) {
                "<digits>".to_owned()
            } else {
                token.to_owned()
            }
        })
        .into_owned()
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "branch",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum FingerprintInputV1 {
    TypedRefusal {
        scheme_version: u32,
        kind: Option<String>,
        name: Option<String>,
        code: Option<String>,
    },
    AppRefusal {
        scheme_version: u32,
        kind: Option<String>,
        name: Option<String>,
        app_code: Option<String>,
    },
    Exception {
        scheme_version: u32,
        kind: Option<String>,
        name: Option<String>,
        error_class: Option<String>,
        message_template: Option<String>,
    },
    Transport {
        scheme_version: u32,
        kind: Option<String>,
        name: Option<String>,
        status_class: Option<u16>,
    },
    Diagnostic {
        scheme_version: u32,
        name: Option<String>,
        subsystem: Option<String>,
        code: Option<String>,
    },
}

impl FingerprintInputV1 {
    fn tag_and_fields(&self) -> (u8, Vec<Option<String>>) {
        match self {
            Self::TypedRefusal {
                scheme_version,
                kind,
                name,
                code,
            } => (
                0x01,
                vec![
                    Some(scheme_version.to_string()),
                    kind.clone(),
                    name.clone(),
                    code.clone(),
                ],
            ),
            Self::AppRefusal {
                scheme_version,
                kind,
                name,
                app_code,
            } => (
                0x02,
                vec![
                    Some(scheme_version.to_string()),
                    kind.clone(),
                    name.clone(),
                    app_code.clone(),
                ],
            ),
            Self::Exception {
                scheme_version,
                kind,
                name,
                error_class,
                message_template,
            } => (
                0x03,
                vec![
                    Some(scheme_version.to_string()),
                    kind.clone(),
                    name.clone(),
                    error_class.clone(),
                    message_template.clone(),
                ],
            ),
            Self::Transport {
                scheme_version,
                kind,
                name,
                status_class,
            } => (
                0x04,
                vec![
                    Some(scheme_version.to_string()),
                    kind.clone(),
                    name.clone(),
                    status_class.map(|value| value.to_string()),
                ],
            ),
            Self::Diagnostic {
                scheme_version,
                name,
                subsystem,
                code,
            } => (
                0x05,
                vec![
                    Some(scheme_version.to_string()),
                    Some("diagnostic".to_owned()),
                    name.clone(),
                    subsystem.clone(),
                    code.clone(),
                ],
            ),
        }
    }
}

pub fn encode_fingerprint_v1(input: &FingerprintInputV1) -> Vec<u8> {
    let (tag, fields) = input.tag_and_fields();
    let mut encoded = vec![tag];
    for field in fields {
        match field {
            None => encoded.push(0x00),
            Some(field) => {
                let bytes = field.as_bytes();
                let length = u32::try_from(bytes.len()).expect("fingerprint field fits u32");
                encoded.push(0x01);
                encoded.extend_from_slice(&length.to_be_bytes());
                encoded.extend_from_slice(bytes);
            }
        }
    }
    encoded
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FingerprintV1 {
    pub full_sha256: [u8; 32],
    pub truncated: [u8; 16],
}

pub fn fingerprint_v1(input: &FingerprintInputV1) -> FingerprintV1 {
    let digest: [u8; 32] = Sha256::digest(encode_fingerprint_v1(input)).into();
    let mut truncated = [0; 16];
    truncated.copy_from_slice(&digest[..16]);
    FingerprintV1 {
        full_sha256: digest,
        truncated,
    }
}

fn lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

const EXISTING_ALLOWLIST_PRIORITY: &[&str] = &[
    "attempt",
    "cause",
    "level",
    "method",
    "rawPath",
    "referer",
    "severity",
    "trigger",
    "userAgent",
];

#[cfg(test)]
const RESERVED_DETAIL_KEYS: &[&str] = &[
    "platformCode",
    "failure_disposition",
    "issue_eligible",
    "classifier_version",
    "fp_version",
    "fp_hash",
    "predecessor_fp_version",
    "predecessor_fp_hash",
    "appCode",
    "errorClass",
    "function",
    "name",
    "appDetails",
    "messageTemplate",
    "message",
    "stack",
    "detailFlags",
];

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FailureDetailsInputV1 {
    pub platform_code: String,
    pub classification: FailureClassificationV1,
    pub fingerprint_version: Option<u32>,
    pub fingerprint_hash: Option<String>,
    pub predecessor_fingerprint_version: Option<u32>,
    pub predecessor_fingerprint_hash: Option<String>,
    pub app_code: Option<String>,
    pub error_class: Option<String>,
    pub function: Option<String>,
    pub name: Option<String>,
    #[serde(default)]
    pub existing_allowlist: BTreeMap<String, Value>,
    pub app_details: Option<Value>,
    pub message_template: Option<String>,
    pub message: Option<String>,
    pub stack: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DetailsAllocationErrorV1 {
    RequiredFieldsExceedBudget,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AllocatedFailureDetailsV1 {
    pub details: Value,
    pub serialized_bytes: usize,
}

fn flag_name(key: &str, suffix: &str) -> String {
    format!("{key}{suffix}")
}

fn flags_value(flags: &BTreeMap<String, bool>) -> Value {
    Value::Object(
        flags
            .iter()
            .map(|(key, value)| (key.clone(), Value::Bool(*value)))
            .collect(),
    )
}

fn serialized_len(details: &BTreeMap<String, Value>) -> usize {
    serde_json::to_vec(details)
        .expect("failure details serialize")
        .len()
}

fn refresh_flags(details: &mut BTreeMap<String, Value>, flags: &BTreeMap<String, bool>) {
    details.insert("detailFlags".to_owned(), flags_value(flags));
}

fn try_insert_whole(details: &mut BTreeMap<String, Value>, key: &str, value: Value) -> bool {
    details.insert(key.to_owned(), value);
    if serialized_len(details) <= FAILURE_DETAILS_MAX_BYTES {
        true
    } else {
        details.remove(key);
        false
    }
}

fn insert_bounded_string(
    details: &mut BTreeMap<String, Value>,
    flags: &mut BTreeMap<String, bool>,
    key: &str,
    value: &str,
) {
    if try_insert_whole(details, key, Value::String(value.to_owned())) {
        return;
    }
    let flag = flag_name(key, "Truncated");
    flags.insert(flag, true);
    refresh_flags(details, flags);

    let boundaries = value
        .char_indices()
        .map(|(index, _)| index)
        .chain(std::iter::once(value.len()))
        .collect::<Vec<_>>();
    let mut low = 0usize;
    let mut high = boundaries.len();
    while low < high {
        let middle = (low + high) / 2;
        let fits = try_insert_whole(
            details,
            key,
            Value::String(value[..boundaries[middle]].to_owned()),
        );
        details.remove(key);
        if fits {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    if low > 0 {
        let end = boundaries[low - 1];
        let _ = try_insert_whole(details, key, Value::String(value[..end].to_owned()));
    }
}

/// Allocate the complete failure details object in one deterministic priority
/// pass. `detailFlags` is reserved before any optional field is considered.
pub fn allocate_failure_details(
    input: &FailureDetailsInputV1,
) -> Result<AllocatedFailureDetailsV1, DetailsAllocationErrorV1> {
    let mut flags = BTreeMap::new();
    for key in ["function", "name", "messageTemplate", "message", "stack"] {
        flags.insert(flag_name(key, "Truncated"), false);
    }
    for key in EXISTING_ALLOWLIST_PRIORITY {
        flags.insert(flag_name(key, "Dropped"), false);
    }
    flags.insert("appDetailsDropped".to_owned(), false);

    let mut details = BTreeMap::from([
        (
            "classifier_version".to_owned(),
            json!(input.classification.classifier_version),
        ),
        (
            "failure_disposition".to_owned(),
            json!(input.classification.failure_disposition),
        ),
        (
            "issue_eligible".to_owned(),
            json!(input.classification.issue_eligible),
        ),
        ("platformCode".to_owned(), json!(input.platform_code)),
        ("detailFlags".to_owned(), flags_value(&flags)),
    ]);
    for (key, value) in [
        ("fp_version", input.fingerprint_version.map(Value::from)),
        ("fp_hash", input.fingerprint_hash.clone().map(Value::String)),
        (
            "predecessor_fp_version",
            input.predecessor_fingerprint_version.map(Value::from),
        ),
        (
            "predecessor_fp_hash",
            input
                .predecessor_fingerprint_hash
                .clone()
                .map(Value::String),
        ),
    ] {
        if let Some(value) = value {
            details.insert(key.to_owned(), value);
        }
    }
    if serialized_len(&details) > FAILURE_DETAILS_MAX_BYTES {
        return Err(DetailsAllocationErrorV1::RequiredFieldsExceedBudget);
    }

    for (key, value) in [
        ("appCode", input.app_code.as_deref()),
        ("errorClass", input.error_class.as_deref()),
    ] {
        if let Some(value) = value {
            if !try_insert_whole(&mut details, key, Value::String(value.to_owned())) {
                return Err(DetailsAllocationErrorV1::RequiredFieldsExceedBudget);
            }
        }
    }

    for (key, value) in [
        ("function", input.function.as_deref()),
        ("name", input.name.as_deref()),
    ] {
        if let Some(value) = value {
            insert_bounded_string(&mut details, &mut flags, key, value);
        }
    }

    for key in EXISTING_ALLOWLIST_PRIORITY {
        let Some(value) = input.existing_allowlist.get(*key) else {
            continue;
        };
        if !try_insert_whole(&mut details, key, value.clone()) {
            flags.insert(flag_name(key, "Dropped"), true);
            refresh_flags(&mut details, &flags);
        }
    }

    if let Some(value) = input.app_details.clone()
        && !try_insert_whole(&mut details, "appDetails", value)
    {
        flags.insert("appDetailsDropped".to_owned(), true);
        refresh_flags(&mut details, &flags);
    }

    for (key, value) in [
        ("messageTemplate", input.message_template.as_deref()),
        ("message", input.message.as_deref()),
        ("stack", input.stack.as_deref()),
    ] {
        if let Some(value) = value {
            insert_bounded_string(&mut details, &mut flags, key, value);
        }
    }

    refresh_flags(&mut details, &flags);
    let serialized_bytes = serialized_len(&details);
    debug_assert!(serialized_bytes <= FAILURE_DETAILS_MAX_BYTES);
    Ok(AllocatedFailureDetailsV1 {
        details: Value::Object(details.into_iter().collect::<Map<_, _>>()),
        serialized_bytes,
    })
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClassifierFixtureCaseV1 {
    name: String,
    input: FailureClassifierInputV1,
    expected: FailureClassificationV1,
}

#[derive(Clone, Copy)]
enum FixtureSignalOracleV1 {
    AppRefusal,
    Fixed(FailureDispositionV1, bool),
    Transport4xx,
    ResidualFault,
    Unmatched,
}

struct FixtureSignalV1<'a> {
    label: String,
    platform_code: Option<&'a str>,
    status_class: Option<u16>,
    app_code: Option<&'a str>,
    app_refusal_admitted: bool,
    unmatched_name: bool,
    oracle: FixtureSignalOracleV1,
}

/// An intentionally separate fixture oracle. It carries expected outcomes as
/// data rather than calling the production classifier while generating them.
fn fixture_oracle(
    signal: FixtureSignalOracleV1,
    carrier: CarrierCategoryV1,
    tracked: bool,
) -> FailureClassificationV1 {
    let (failure_disposition, issue_eligible) = match signal {
        FixtureSignalOracleV1::AppRefusal if carrier == CarrierCategoryV1::AppRefusal => {
            (FailureDispositionV1::AppRefusal, tracked)
        }
        FixtureSignalOracleV1::AppRefusal | FixtureSignalOracleV1::ResidualFault => {
            (FailureDispositionV1::Fault, true)
        }
        FixtureSignalOracleV1::Fixed(disposition, eligible) => (disposition, eligible),
        FixtureSignalOracleV1::Transport4xx if carrier == CarrierCategoryV1::Transport => {
            (FailureDispositionV1::CallerError, false)
        }
        FixtureSignalOracleV1::Transport4xx => (FailureDispositionV1::Fault, true),
        FixtureSignalOracleV1::Unmatched => (FailureDispositionV1::CallerError, false),
    };
    FailureClassificationV1 {
        failure_disposition,
        issue_eligible,
        classifier_version: 1,
    }
}

pub fn classifier_fixture_artifact() -> Value {
    let phase_one = [
        ("function_run", "function.query"),
        ("http_request", "transport.http-standalone"),
        ("live_subscribe", "live.subscribe"),
        ("ws_connect", "stream.connect"),
        ("job_run", "job.scheduler"),
        ("lifecycle", "lifecycle"),
        ("log", "log"),
        ("diagnostic", "diagnostic"),
    ];
    let mut signals = vec![FixtureSignalV1 {
        label: "app_refusal".to_owned(),
        platform_code: Some("SNAPBACK_APP_REFUSAL"),
        status_class: None,
        app_code: Some("STALE_MOVE"),
        app_refusal_admitted: true,
        unmatched_name: false,
        oracle: FixtureSignalOracleV1::AppRefusal,
    }];
    for (family, codes, disposition, eligible) in [
        (
            "cancellation",
            CANCELLATION_CODES,
            FailureDispositionV1::Cancellation,
            false,
        ),
        (
            "timeout",
            TIMEOUT_CODES,
            FailureDispositionV1::Timeout,
            true,
        ),
        (
            "overload",
            OVERLOAD_CODES,
            FailureDispositionV1::Overload,
            true,
        ),
        (
            "caller_code",
            CALLER_ERROR_CODES,
            FailureDispositionV1::CallerError,
            false,
        ),
    ] {
        signals.extend(codes.iter().map(|code| FixtureSignalV1 {
            label: format!("{family}.{code}"),
            platform_code: Some(*code),
            status_class: None,
            app_code: None,
            app_refusal_admitted: false,
            unmatched_name: false,
            oracle: FixtureSignalOracleV1::Fixed(disposition, eligible),
        }));
    }
    signals.extend([
        FixtureSignalV1 {
            label: "http_4xx".to_owned(),
            platform_code: None,
            status_class: Some(4),
            app_code: None,
            app_refusal_admitted: false,
            unmatched_name: false,
            oracle: FixtureSignalOracleV1::Transport4xx,
        },
        FixtureSignalV1 {
            label: "http_5xx".to_owned(),
            platform_code: None,
            status_class: Some(5),
            app_code: None,
            app_refusal_admitted: false,
            unmatched_name: false,
            oracle: FixtureSignalOracleV1::ResidualFault,
        },
        FixtureSignalV1 {
            label: "residual.SNAPBACK_HANDLER_FAILED".to_owned(),
            platform_code: Some("SNAPBACK_HANDLER_FAILED"),
            status_class: Some(4),
            app_code: None,
            app_refusal_admitted: false,
            unmatched_name: false,
            oracle: FixtureSignalOracleV1::ResidualFault,
        },
        FixtureSignalV1 {
            label: "residual.SNAPBACK_UNHANDLED_REJECTION".to_owned(),
            platform_code: Some("SNAPBACK_UNHANDLED_REJECTION"),
            status_class: Some(4),
            app_code: None,
            app_refusal_admitted: false,
            unmatched_name: false,
            oracle: FixtureSignalOracleV1::ResidualFault,
        },
        FixtureSignalV1 {
            label: "unmatched".to_owned(),
            platform_code: Some("SNAPBACK_HANDLER_FAILED"),
            status_class: Some(5),
            app_code: None,
            app_refusal_admitted: false,
            unmatched_name: true,
            oracle: FixtureSignalOracleV1::Unmatched,
        },
    ]);
    let carriers = [
        CarrierCategoryV1::Diagnostic,
        CarrierCategoryV1::AppRefusal,
        CarrierCategoryV1::Exception,
        CarrierCategoryV1::Transport,
    ];
    let mut cases = Vec::new();
    for (kind, operation_class) in phase_one {
        for signal in &signals {
            for carrier_category in carriers {
                for tracked in [false, true] {
                    let input = FailureClassifierInputV1 {
                        operation_class: operation_class.to_owned(),
                        name: Some(if signal.unmatched_name {
                            "_unmatched".to_owned()
                        } else {
                            format!("{kind}.fixture")
                        }),
                        platform_code: signal.platform_code.map(str::to_owned),
                        status_class: signal.status_class,
                        carrier_category,
                        app_code: signal.app_code.map(str::to_owned),
                        app_refusal_admitted: signal.app_refusal_admitted,
                        app_refusal_tracked: tracked,
                    };
                    cases.push(ClassifierFixtureCaseV1 {
                        name: format!(
                            "{kind}.{}.{carrier_category:?}.tracked-{tracked}",
                            signal.label
                        ),
                        expected: fixture_oracle(signal.oracle, carrier_category, tracked),
                        input,
                    });
                }
            }
        }
    }
    json!({
        "artifactVersion": 1,
        "classifierVersion": CLASSIFIER_VERSION,
        "cases": cases,
    })
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FingerprintVectorV1 {
    name: String,
    input: FingerprintInputV1,
    encoded_hex: String,
    sha256: String,
    fingerprint_hash: String,
}

pub fn fingerprint_vector_artifact() -> Value {
    let inputs = [
        (
            "typed-refusal",
            FingerprintInputV1::TypedRefusal {
                scheme_version: 1,
                kind: Some("function_run".to_owned()),
                name: Some("messages.send".to_owned()),
                code: Some("SNAPBACK_HANDLER_FAILED".to_owned()),
            },
        ),
        (
            "app-refusal",
            FingerprintInputV1::AppRefusal {
                scheme_version: 1,
                kind: Some("function_run".to_owned()),
                name: Some("moves.apply".to_owned()),
                app_code: Some("STALE_MOVE".to_owned()),
            },
        ),
        (
            "exception-unicode",
            FingerprintInputV1::Exception {
                scheme_version: 1,
                kind: Some("function_run".to_owned()),
                name: Some("messages.send".to_owned()),
                error_class: Some("TypeError".to_owned()),
                message_template: Some("échec <digits> ☃".to_owned()),
            },
        ),
        (
            "transport",
            FingerprintInputV1::Transport {
                scheme_version: 1,
                kind: Some("http_request".to_owned()),
                name: Some("/hooks/:provider".to_owned()),
                status_class: Some(5),
            },
        ),
        (
            "diagnostic",
            FingerprintInputV1::Diagnostic {
                scheme_version: 1,
                name: Some("background.flush".to_owned()),
                subsystem: Some("telemetry".to_owned()),
                code: Some("SNAPBACK_TELEMETRY_FLUSH_FAILED".to_owned()),
            },
        ),
        (
            "absent-name",
            FingerprintInputV1::TypedRefusal {
                scheme_version: 1,
                kind: Some("function_run".to_owned()),
                name: None,
                code: Some("SNAPBACK_HANDLER_FAILED".to_owned()),
            },
        ),
        (
            "empty-name",
            FingerprintInputV1::TypedRefusal {
                scheme_version: 1,
                kind: Some("function_run".to_owned()),
                name: Some(String::new()),
                code: Some("SNAPBACK_HANDLER_FAILED".to_owned()),
            },
        ),
    ];
    let vectors = inputs
        .into_iter()
        .map(|(name, input)| {
            let encoded = encode_fingerprint_v1(&input);
            let fingerprint = fingerprint_v1(&input);
            FingerprintVectorV1 {
                name: name.to_owned(),
                input,
                encoded_hex: lower_hex(&encoded),
                sha256: lower_hex(&fingerprint.full_sha256),
                fingerprint_hash: lower_hex(&fingerprint.truncated),
            }
        })
        .collect::<Vec<_>>();
    json!({
        "artifactVersion": 1,
        "fingerprintVersion": FINGERPRINT_VERSION,
        "encoding": "branch-tag + repeated presence-byte/(u32be-length + exact UTF-8)",
        "vectors": vectors,
    })
}

pub fn carrier_fixture_artifact() -> Value {
    let large = "☃".repeat(4_000);
    let allocation = allocate_failure_details(&FailureDetailsInputV1 {
        platform_code: "SNAPBACK_HANDLER_FAILED".to_owned(),
        classification: FailureClassificationV1 {
            failure_disposition: FailureDispositionV1::Fault,
            issue_eligible: true,
            classifier_version: 1,
        },
        fingerprint_version: Some(1),
        fingerprint_hash: Some("0123456789abcdef0123456789abcdef".to_owned()),
        predecessor_fingerprint_version: None,
        predecessor_fingerprint_hash: None,
        app_code: None,
        error_class: Some("TypeError".to_owned()),
        function: Some("messages.send".to_owned()),
        name: Some("messages.send".to_owned()),
        existing_allowlist: BTreeMap::from([("attempt".to_owned(), json!(3))]),
        app_details: Some(json!({"large": large})),
        message_template: Some("failed for <email>".to_owned()),
        message: Some("failed for alice@example.com".to_owned()),
        stack: Some("frame\n".repeat(2_000)),
    })
    .expect("fixture allocation fits required fields");
    json!({
        "artifactVersion": 1,
        "limits": {
            "extractionBytes": FAILURE_EXTRACTION_MAX_BYTES,
            "detailsBytes": FAILURE_DETAILS_MAX_BYTES,
        },
        "errorClassCases": [
            {"input": "TypeError", "expected": "TypeError"},
            {"input": "$Domain_Error2", "expected": "$Domain_Error2"},
            {"input": "unclassified", "expected": "unclassified"},
            {"input": "bad-name", "expected": "unclassified"},
            {"input": null, "expected": "unclassified"},
        ],
        "normalizerCases": [
            {
                "input": "user alice@example.com id 123 and 0xdeadbeef said \"hello\" token 01ARZ3NDEKTSV4RRFFQ69G5FAV",
                "expected": "user <email> id <digits> and <hex> said <quoted> token <base32>"
            },
            {"input": "é 42", "expected": "é <digits>"},
        ],
        "allocation": {
            "details": allocation.details,
            "serializedBytes": allocation.serialized_bytes,
        },
    })
}

pub fn artifact_instances() -> Vec<(&'static str, Value)> {
    vec![
        (CLASSIFIER_FIXTURE_FILE, classifier_fixture_artifact()),
        (FINGERPRINT_VECTOR_FILE, fingerprint_vector_artifact()),
        (CARRIER_FIXTURE_FILE, carrier_fixture_artifact()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closed_memberships_are_sorted_unique_and_disjoint() {
        let mut all = BTreeSet::new();
        for membership in [
            CANCELLATION_CODES,
            TIMEOUT_CODES,
            OVERLOAD_CODES,
            CALLER_ERROR_CODES,
        ] {
            assert!(membership.windows(2).all(|pair| pair[0] < pair[1]));
            for code in membership {
                assert!(all.insert(*code), "duplicate classifier membership {code}");
            }
        }
    }

    #[test]
    fn classifier_precedence_and_opt_in_are_pinned() {
        let mut input = FailureClassifierInputV1 {
            operation_class: "function.query".to_owned(),
            name: Some("messages.send".to_owned()),
            platform_code: Some("SNAPBACK_APP_REFUSAL".to_owned()),
            status_class: Some(5),
            carrier_category: CarrierCategoryV1::AppRefusal,
            app_code: Some("STALE_MOVE".to_owned()),
            app_refusal_admitted: true,
            app_refusal_tracked: false,
        };
        assert_eq!(
            classify_failure(&input),
            FailureClassificationV1 {
                failure_disposition: FailureDispositionV1::AppRefusal,
                issue_eligible: false,
                classifier_version: 1,
            }
        );
        input.app_refusal_tracked = true;
        assert!(classify_failure(&input).issue_eligible);

        input.platform_code = Some(TIMEOUT_CODES[0].to_owned());
        input.carrier_category = CarrierCategoryV1::Transport;
        assert_eq!(
            classify_failure(&input).failure_disposition,
            FailureDispositionV1::Timeout
        );
        input.operation_class = "transport.http-standalone".to_owned();
        input.name = Some("_unmatched".to_owned());
        input.platform_code = Some("SNAPBACK_HANDLER_FAILED".to_owned());
        assert_eq!(
            classify_failure(&input).failure_disposition,
            FailureDispositionV1::CallerError
        );
    }

    #[test]
    fn projected_400_handler_faults_do_not_become_caller_errors() {
        for code in ["SNAPBACK_HANDLER_FAILED", "SNAPBACK_UNHANDLED_REJECTION"] {
            let logical = FailureClassifierInputV1 {
                operation_class: "function.query".to_owned(),
                name: Some("messages.send".to_owned()),
                platform_code: Some(code.to_owned()),
                status_class: Some(4),
                carrier_category: CarrierCategoryV1::Exception,
                app_code: None,
                app_refusal_admitted: false,
                app_refusal_tracked: false,
            };
            assert_eq!(
                classify_failure(&logical).failure_disposition,
                FailureDispositionV1::Fault,
                "{code}"
            );
        }

        let caller = FailureClassifierInputV1 {
            operation_class: "transport.http-standalone".to_owned(),
            name: Some("/api/messages".to_owned()),
            platform_code: Some("SNAPBACK_REQUEST_BODY_TIMEOUT".to_owned()),
            status_class: Some(4),
            carrier_category: CarrierCategoryV1::Transport,
            app_code: None,
            app_refusal_admitted: false,
            app_refusal_tracked: false,
        };
        assert_eq!(
            classify_failure(&caller).failure_disposition,
            FailureDispositionV1::CallerError
        );

        let unmatched = FailureClassifierInputV1 {
            name: Some("_unmatched".to_owned()),
            platform_code: None,
            status_class: Some(5),
            ..caller
        };
        assert_eq!(
            classify_failure(&unmatched).failure_disposition,
            FailureDispositionV1::CallerError
        );
    }

    #[test]
    fn full_classifier_corpus_replays() {
        let artifact = classifier_fixture_artifact();
        let cases: Vec<ClassifierFixtureCaseV1> =
            serde_json::from_value(artifact["cases"].clone()).unwrap();
        let signal_count = 1
            + CANCELLATION_CODES.len()
            + TIMEOUT_CODES.len()
            + OVERLOAD_CODES.len()
            + CALLER_ERROR_CODES.len()
            + 5;
        assert_eq!(cases.len(), 8 * signal_count * 4 * 2);
        for case in cases {
            assert_eq!(
                classify_failure(&case.input),
                case.expected,
                "{}",
                case.name
            );
        }
    }

    #[test]
    fn carrier_validation_normalization_and_extraction_are_bounded() {
        assert_eq!(validated_error_class(Some("TypeError")), "TypeError");
        assert_eq!(validated_error_class(Some("unclassified")), "unclassified");
        assert_eq!(validated_error_class(Some("bad-name")), "unclassified");
        assert_eq!(
            normalize_message_v1("id 123, user a@b.dev, hex deadbeef, said 'yes'"),
            "id <digits>, user <email>, hex <hex>, said <quoted>"
        );
        let long = "☃".repeat(6_000);
        let carrier = extract_failure_carrier(Some("TypeError"), Some(&long), Some(&long));
        assert!(carrier.message_extraction_truncated && carrier.stack_extraction_truncated);
        assert!(carrier.message.unwrap().len() <= FAILURE_EXTRACTION_MAX_BYTES);
        assert!(carrier.stack.unwrap().len() <= FAILURE_EXTRACTION_MAX_BYTES);
    }

    #[test]
    fn fingerprint_vectors_pin_tags_utf8_and_absence() {
        let artifact = fingerprint_vector_artifact();
        let vectors: Vec<FingerprintVectorV1> =
            serde_json::from_value(artifact["vectors"].clone()).unwrap();
        for vector in &vectors {
            let encoded = encode_fingerprint_v1(&vector.input);
            let fingerprint = fingerprint_v1(&vector.input);
            assert_eq!(lower_hex(&encoded), vector.encoded_hex);
            assert_eq!(lower_hex(&fingerprint.full_sha256), vector.sha256);
            assert_eq!(lower_hex(&fingerprint.truncated), vector.fingerprint_hash);
        }
        assert_ne!(vectors[5].fingerprint_hash, vectors[6].fingerprint_hash);
    }

    #[test]
    fn allocator_is_utf8_safe_whole_drop_and_deterministic() {
        let input = FailureDetailsInputV1 {
            platform_code: "SNAPBACK_HANDLER_FAILED".to_owned(),
            classification: FailureClassificationV1 {
                failure_disposition: FailureDispositionV1::Fault,
                issue_eligible: true,
                classifier_version: 1,
            },
            fingerprint_version: Some(1),
            fingerprint_hash: Some("f".repeat(32)),
            predecessor_fingerprint_version: None,
            predecessor_fingerprint_hash: None,
            app_code: None,
            error_class: Some("TypeError".to_owned()),
            function: Some("functions/very-long".repeat(800)),
            name: Some("name".to_owned()),
            existing_allowlist: BTreeMap::from([
                ("attempt".to_owned(), json!(4)),
                ("notAllowed".to_owned(), json!("discarded")),
            ]),
            app_details: Some(json!({"snow": "☃".repeat(4_000)})),
            message_template: Some("template".to_owned()),
            message: Some("é".repeat(5_000)),
            stack: Some("stack\n".repeat(2_000)),
        };
        let first = allocate_failure_details(&input).unwrap();
        let second = allocate_failure_details(&input).unwrap();
        assert_eq!(first, second);
        assert!(first.serialized_bytes <= FAILURE_DETAILS_MAX_BYTES);
        assert_eq!(first.details["detailFlags"]["appDetailsDropped"], true);
        assert!(first.details.get("notAllowed").is_none());
        for value in first.details.as_object().unwrap().values() {
            if let Some(text) = value.as_str() {
                assert!(std::str::from_utf8(text.as_bytes()).is_ok());
            }
        }
    }

    #[test]
    fn reserved_detail_vocabulary_is_unique() {
        assert_eq!(
            RESERVED_DETAIL_KEYS.iter().collect::<BTreeSet<_>>().len(),
            RESERVED_DETAIL_KEYS.len()
        );
    }
}
