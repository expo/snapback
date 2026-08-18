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
pub use snapback_types::error_tracking::*;
use std::collections::BTreeMap;
#[cfg(test)]
use std::collections::BTreeSet;
use std::sync::OnceLock;
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

pub(crate) fn lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

pub(crate) const EXISTING_ALLOWLIST_PRIORITY: &[&str] = &[
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

pub(crate) const FAILURE_DETAIL_KEYS: &[&str] = &[
    "platformCode",
    "statusClass",
    "failure_disposition",
    "issue_eligible",
    "classifier_version",
    "fp_branch",
    "fp_version",
    "fp_hash",
    "predecessor_fp_version",
    "predecessor_fp_hash",
    "appCode",
    "errorClass",
    "subsystem",
    "function",
    "name",
    "appDetails",
    "messageTemplate",
    "message",
    "stack",
    "rejectionCarriers",
    "detailFlags",
];

/// Closed structural discriminator for the fingerprint tuple already chosen
/// at the emission seam. The flusher validates the carrier against this stamp
/// but never chooses or recomputes a branch.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FingerprintBranchV1 {
    TypedRefusal,
    AppRefusal,
    Exception,
    Transport,
    Diagnostic,
}

pub(crate) fn is_failure_detail_key(key: &str) -> bool {
    FAILURE_DETAIL_KEYS.contains(&key) || EXISTING_ALLOWLIST_PRIORITY.contains(&key)
}

const FAILURE_DETAIL_FLAG_KEYS: &[&str] = &[
    "functionTruncated",
    "nameTruncated",
    "messageTemplateTruncated",
    "messageTruncated",
    "stackTruncated",
    "appDetailsDropped",
    "attemptDropped",
    "causeDropped",
    "levelDropped",
    "methodDropped",
    "rawPathDropped",
    "refererDropped",
    "severityDropped",
    "triggerDropped",
    "userAgentDropped",
];

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FailureDetailsInputV1 {
    pub platform_code: Option<String>,
    pub classification: FailureClassificationV1,
    pub fingerprint_branch: FingerprintBranchV1,
    pub fingerprint_version: Option<u32>,
    pub fingerprint_hash: Option<String>,
    pub predecessor_fingerprint_version: Option<u32>,
    pub predecessor_fingerprint_hash: Option<String>,
    pub status_class: Option<u16>,
    pub app_code: Option<String>,
    pub error_class: Option<String>,
    pub subsystem: Option<String>,
    pub function: Option<String>,
    pub name: Option<String>,
    #[serde(default)]
    pub existing_allowlist: BTreeMap<String, Value>,
    pub app_details: Option<Value>,
    pub message_template: Option<String>,
    pub message: Option<String>,
    pub stack: Option<String>,
    /// The complete ordered carrier for a terminal with multiple unhandled
    /// rejections. The singular fields above remain the first-rejection
    /// fingerprint/exemplar authority.
    pub rejection_carriers: Option<Vec<FailureCarrierV1>>,
    #[serde(default)]
    pub message_extraction_truncated: bool,
    #[serde(default)]
    pub stack_extraction_truncated: bool,
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

/// The already-decided subset of an eligible failure row that the telemetry
/// flusher is allowed to materialize. Classification and fingerprinting stay
/// at the emission seam; this parser only validates their closed carrier.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct MaterializedFailureStampV1 {
    pub platform_code: Option<String>,
    pub failure_disposition: FailureDispositionV1,
    pub classifier_version: u32,
    pub fingerprint_branch: FingerprintBranchV1,
    pub fingerprint_version: u32,
    pub fingerprint_hash: [u8; 16],
    pub predecessor_fingerprint: Option<(u32, [u8; 16])>,
    pub status_class: Option<u16>,
    pub app_code: Option<String>,
    pub error_class: Option<String>,
    pub subsystem: Option<String>,
    pub message_template: Option<String>,
    pub stack_head: Option<String>,
    pub template_truncated: bool,
    pub stack_truncated: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum FailureStampMaterializationV1 {
    NotEligible,
    MalformedEligible,
    Eligible(MaterializedFailureStampV1),
}

fn parse_lower_hex_16(value: &str) -> Option<[u8; 16]> {
    if value.len() != 32
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return None;
    }
    let mut decoded = [0_u8; 16];
    for (index, slot) in decoded.iter_mut().enumerate() {
        let pair = &value[index * 2..index * 2 + 2];
        *slot = u8::from_str_radix(pair, 16).ok()?;
    }
    Some(decoded)
}

fn optional_string(object: &Map<String, Value>, key: &str) -> Option<Option<String>> {
    match object.get(key) {
        None | Some(Value::Null) => Some(None),
        Some(Value::String(value)) => Some(Some(value.clone())),
        Some(_) => None,
    }
}

fn detail_flag(object: &Map<String, Value>, key: &str) -> Option<bool> {
    let Value::Object(flags) = object.get("detailFlags")? else {
        return None;
    };
    flags.get(key)?.as_bool()
}

fn platform_code_is_valid(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 256
        && code
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
}

fn subsystem_is_valid(subsystem: &str) -> bool {
    !subsystem.is_empty()
        && subsystem.len() <= 64
        && subsystem
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_lowercase())
        && subsystem.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
        })
}

fn detail_flags_are_closed(object: &Map<String, Value>) -> bool {
    let Some(Value::Object(flags)) = object.get("detailFlags") else {
        return false;
    };
    flags.len() == FAILURE_DETAIL_FLAG_KEYS.len()
        && FAILURE_DETAIL_FLAG_KEYS
            .iter()
            .all(|key| flags.get(*key).is_some_and(Value::is_boolean))
}

/// Validate one failure-details object without deriving missing semantics.
/// A literal `issue_eligible: true` opts into strict validation; malformed
/// eligible carriers remain raw telemetry and are counted by the store.
pub(crate) fn materialize_failure_stamp_v1(
    details: Option<&Value>,
) -> FailureStampMaterializationV1 {
    let Some(Value::Object(object)) = details else {
        return FailureStampMaterializationV1::NotEligible;
    };
    if object.get("issue_eligible") != Some(&Value::Bool(true)) {
        return FailureStampMaterializationV1::NotEligible;
    }

    let parsed = (|| {
        if !object.keys().all(|key| is_failure_detail_key(key)) || !detail_flags_are_closed(object)
        {
            return None;
        }
        let platform_code = optional_string(object, "platformCode")?;
        if platform_code
            .as_deref()
            .is_some_and(|code| !platform_code_is_valid(code))
        {
            return None;
        }
        let failure_disposition = serde_json::from_value::<FailureDispositionV1>(
            object.get("failure_disposition")?.clone(),
        )
        .ok()?;
        if matches!(
            failure_disposition,
            FailureDispositionV1::CallerError | FailureDispositionV1::Cancellation
        ) {
            return None;
        }
        let classifier_version = u32::try_from(object.get("classifier_version")?.as_u64()?).ok()?;
        if classifier_version != CLASSIFIER_VERSION {
            return None;
        }
        let fingerprint_branch =
            serde_json::from_value::<FingerprintBranchV1>(object.get("fp_branch")?.clone()).ok()?;
        let status_class = match object.get("statusClass") {
            None => None,
            Some(value) => Some(u16::try_from(value.as_u64()?).ok()?),
        };
        let fingerprint_version = u32::try_from(object.get("fp_version")?.as_u64()?).ok()?;
        if fingerprint_version == 0 {
            return None;
        }
        let fingerprint_hash = parse_lower_hex_16(object.get("fp_hash")?.as_str()?)?;
        let predecessor_version = match object.get("predecessor_fp_version") {
            None => None,
            Some(value) => Some(u32::try_from(value.as_u64()?).ok()?),
        };
        let predecessor_hash = match object.get("predecessor_fp_hash") {
            None => None,
            Some(value) => Some(parse_lower_hex_16(value.as_str()?)?),
        };
        let predecessor_fingerprint = match (predecessor_version, predecessor_hash) {
            (None, None) => None,
            (Some(version), Some(hash)) if version > 0 => Some((version, hash)),
            _ => return None,
        };
        let app_code = optional_string(object, "appCode")?;
        if app_code
            .as_deref()
            .is_some_and(|code| !app_refusal_code_is_valid(code))
            || (failure_disposition == FailureDispositionV1::AppRefusal && app_code.is_none())
        {
            return None;
        }
        let error_class = optional_string(object, "errorClass")?;
        if error_class.as_deref().is_some_and(|class| {
            class != UNCLASSIFIED_ERROR_CLASS && validated_error_class(Some(class)) != class
        }) {
            return None;
        }
        let subsystem = optional_string(object, "subsystem")?;
        if subsystem
            .as_deref()
            .is_some_and(|subsystem| !subsystem_is_valid(subsystem))
        {
            return None;
        }
        let rejection_carriers = match object.get("rejectionCarriers") {
            None => None,
            Some(value) => {
                let carriers =
                    serde_json::from_value::<Vec<FailureCarrierV1>>(value.clone()).ok()?;
                if carriers.len() < 2
                    || carriers.iter().any(|carrier| {
                        (carrier.error_class != UNCLASSIFIED_ERROR_CLASS
                            && validated_error_class(Some(&carrier.error_class))
                                != carrier.error_class)
                            || carrier
                                .message
                                .as_ref()
                                .is_some_and(|message| message.len() > FAILURE_EXTRACTION_MAX_BYTES)
                            || carrier
                                .stack
                                .as_ref()
                                .is_some_and(|stack| stack.len() > FAILURE_EXTRACTION_MAX_BYTES)
                    })
                {
                    return None;
                }
                Some(carriers)
            }
        };
        let branch_is_valid = match fingerprint_branch {
            FingerprintBranchV1::TypedRefusal => {
                platform_code.is_some()
                    && failure_disposition != FailureDispositionV1::AppRefusal
                    && status_class.is_none()
                    && app_code.is_none()
                    && error_class.is_none()
                    && subsystem.is_none()
                    && rejection_carriers.is_none()
            }
            FingerprintBranchV1::AppRefusal => {
                platform_code.as_deref() == Some("SNAPBACK_APP_REFUSAL")
                    && failure_disposition == FailureDispositionV1::AppRefusal
                    && status_class.is_none()
                    && app_code.is_some()
                    && error_class.is_none()
                    && subsystem.is_none()
                    && rejection_carriers.is_none()
            }
            FingerprintBranchV1::Exception => {
                platform_code.is_some()
                    && failure_disposition != FailureDispositionV1::AppRefusal
                    && status_class.is_none()
                    && app_code.is_none()
                    && error_class.is_some()
                    && subsystem.is_none()
                    && rejection_carriers.as_ref().is_none_or(|carriers| {
                        carriers.first().map(|carrier| carrier.error_class.as_str())
                            == error_class.as_deref()
                    })
            }
            FingerprintBranchV1::Transport => {
                platform_code.is_none()
                    && failure_disposition == FailureDispositionV1::Fault
                    && status_class == Some(5)
                    && app_code.is_none()
                    && error_class.is_none()
                    && subsystem.is_none()
                    && rejection_carriers.is_none()
            }
            FingerprintBranchV1::Diagnostic => {
                platform_code.is_some()
                    && failure_disposition != FailureDispositionV1::AppRefusal
                    && status_class.is_none()
                    && app_code.is_none()
                    && error_class.is_none()
                    && subsystem.is_some()
                    && rejection_carriers.is_none()
            }
        };
        if !branch_is_valid {
            return None;
        }
        Some(MaterializedFailureStampV1 {
            platform_code,
            failure_disposition,
            classifier_version,
            fingerprint_branch,
            fingerprint_version,
            fingerprint_hash,
            predecessor_fingerprint,
            status_class,
            app_code,
            error_class,
            subsystem,
            message_template: optional_string(object, "messageTemplate")?,
            stack_head: optional_string(object, "stack")?,
            template_truncated: detail_flag(object, "messageTemplateTruncated")?,
            stack_truncated: detail_flag(object, "stackTruncated")?,
        })
    })();
    parsed.map_or(
        FailureStampMaterializationV1::MalformedEligible,
        FailureStampMaterializationV1::Eligible,
    )
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

#[derive(Clone, Copy)]
enum RejectionCarrierTextField {
    Message,
    Stack,
}

fn set_rejection_carrier_text(
    carrier: &mut FailureCarrierV1,
    field: RejectionCarrierTextField,
    value: Option<String>,
    truncated: bool,
) {
    match field {
        RejectionCarrierTextField::Message => {
            carrier.message = value;
            carrier.message_extraction_truncated = truncated;
        }
        RejectionCarrierTextField::Stack => {
            carrier.stack = value;
            carrier.stack_extraction_truncated = truncated;
        }
    }
}

fn refresh_rejection_carriers(
    details: &mut BTreeMap<String, Value>,
    carriers: &[FailureCarrierV1],
) {
    details.insert("rejectionCarriers".to_owned(), json!(carriers));
}

/// Reserve every carrier entry and its queue order inside the fixed details
/// budget before allocating optional raw text. An empty string plus a true
/// truncation witness preserves that a field existed even when no bytes remain
/// for it; `None` continues to mean the field was absent at extraction.
fn reserve_ordered_rejection_carriers(
    details: &mut BTreeMap<String, Value>,
    source: &[FailureCarrierV1],
) -> Result<Vec<FailureCarrierV1>, DetailsAllocationErrorV1> {
    let carriers = source
        .iter()
        .map(|carrier| FailureCarrierV1 {
            error_class: carrier.error_class.clone(),
            message: carrier.message.as_ref().map(|_| String::new()),
            stack: carrier.stack.as_ref().map(|_| String::new()),
            message_extraction_truncated: carrier.message_extraction_truncated
                || carrier
                    .message
                    .as_ref()
                    .is_some_and(|value| !value.is_empty()),
            stack_extraction_truncated: carrier.stack_extraction_truncated
                || carrier
                    .stack
                    .as_ref()
                    .is_some_and(|value| !value.is_empty()),
        })
        .collect::<Vec<_>>();
    refresh_rejection_carriers(details, &carriers);
    if serialized_len(details) > FAILURE_DETAILS_MAX_BYTES {
        details.remove("rejectionCarriers");
        return Err(DetailsAllocationErrorV1::RequiredFieldsExceedBudget);
    }
    Ok(carriers)
}

/// Fill reserved carrier message/stack slots in first-carrier-first order
/// after the pre-existing LLP 0154 detail priorities have been allocated.
/// Every cut is UTF-8-safe and witnessed on the affected carrier entry.
fn fill_ordered_rejection_carrier_text(
    details: &mut BTreeMap<String, Value>,
    source: &[FailureCarrierV1],
    carriers: &mut Vec<FailureCarrierV1>,
) {
    for index in 0..source.len() {
        for field in [
            RejectionCarrierTextField::Message,
            RejectionCarrierTextField::Stack,
        ] {
            let (Some(value), extraction_truncated) = (match field {
                RejectionCarrierTextField::Message => (
                    source[index].message.as_deref(),
                    source[index].message_extraction_truncated,
                ),
                RejectionCarrierTextField::Stack => (
                    source[index].stack.as_deref(),
                    source[index].stack_extraction_truncated,
                ),
            }) else {
                continue;
            };

            let mut full = carriers.to_vec();
            set_rejection_carrier_text(
                &mut full[index],
                field,
                Some(value.to_owned()),
                extraction_truncated,
            );
            refresh_rejection_carriers(details, &full);
            if serialized_len(details) <= FAILURE_DETAILS_MAX_BYTES {
                *carriers = full;
                continue;
            }

            let boundaries = value
                .char_indices()
                .map(|(position, _)| position)
                .chain(std::iter::once(value.len()))
                .collect::<Vec<_>>();
            let mut low = 0usize;
            let mut high = boundaries.len();
            let mut best = carriers.to_vec();
            while low < high {
                let middle = (low + high) / 2;
                let mut candidate = carriers.to_vec();
                set_rejection_carrier_text(
                    &mut candidate[index],
                    field,
                    Some(value[..boundaries[middle]].to_owned()),
                    true,
                );
                refresh_rejection_carriers(details, &candidate);
                if serialized_len(details) <= FAILURE_DETAILS_MAX_BYTES {
                    best = candidate;
                    low = middle + 1;
                } else {
                    high = middle;
                }
            }
            *carriers = best;
            refresh_rejection_carriers(details, carriers);
        }
    }
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
        let pretruncated = match key {
            "message" => input.message_extraction_truncated,
            "stack" => input.stack_extraction_truncated,
            _ => false,
        };
        flags.insert(flag_name(key, "Truncated"), pretruncated);
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
        ("fp_branch".to_owned(), json!(input.fingerprint_branch)),
        ("detailFlags".to_owned(), flags_value(&flags)),
    ]);
    if let Some(platform_code) = input.platform_code.as_deref() {
        details.insert("platformCode".to_owned(), json!(platform_code));
    }
    if let Some(status_class) = input.status_class {
        details.insert("statusClass".to_owned(), json!(status_class));
    }
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
        ("subsystem", input.subsystem.as_deref()),
    ] {
        if let Some(value) = value
            && !try_insert_whole(&mut details, key, Value::String(value.to_owned()))
        {
            return Err(DetailsAllocationErrorV1::RequiredFieldsExceedBudget);
        }
    }

    let mut allocated_rejection_carriers = input
        .rejection_carriers
        .as_deref()
        .map(|carriers| reserve_ordered_rejection_carriers(&mut details, carriers))
        .transpose()?;

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

    if let (Some(source), Some(carriers)) = (
        input.rejection_carriers.as_deref(),
        allocated_rejection_carriers.as_mut(),
    ) {
        fill_ordered_rejection_carrier_text(&mut details, source, carriers);
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
        platform_code: Some("SNAPBACK_HANDLER_FAILED".to_owned()),
        classification: FailureClassificationV1 {
            failure_disposition: FailureDispositionV1::Fault,
            issue_eligible: true,
            classifier_version: 1,
        },
        fingerprint_branch: FingerprintBranchV1::Exception,
        fingerprint_version: Some(1),
        fingerprint_hash: Some("0123456789abcdef0123456789abcdef".to_owned()),
        predecessor_fingerprint_version: None,
        predecessor_fingerprint_hash: None,
        status_class: None,
        app_code: None,
        error_class: Some("TypeError".to_owned()),
        subsystem: None,
        function: Some("messages.send".to_owned()),
        name: Some("messages.send".to_owned()),
        existing_allowlist: BTreeMap::from([("attempt".to_owned(), json!(3))]),
        app_details: Some(json!({"large": large})),
        message_template: Some("failed for <email>".to_owned()),
        message: Some("failed for alice@example.com".to_owned()),
        stack: Some("frame\n".repeat(2_000)),
        rejection_carriers: None,
        message_extraction_truncated: false,
        stack_extraction_truncated: false,
    })
    .expect("fixture allocation fits required fields");
    let rejection_carriers = vec![
        FailureCarrierV1 {
            error_class: "TypeError".to_owned(),
            message: Some("first rejection 123".to_owned()),
            stack: Some("at first (handler.js:1:1)".to_owned()),
            message_extraction_truncated: false,
            stack_extraction_truncated: false,
        },
        FailureCarrierV1 {
            error_class: "RangeError".to_owned(),
            message: Some("second rejection 456".to_owned()),
            stack: Some("at second (handler.js:2:1)".to_owned()),
            message_extraction_truncated: false,
            stack_extraction_truncated: false,
        },
    ];
    let first_fingerprint_input = FingerprintInputV1::Exception {
        scheme_version: FINGERPRINT_VERSION,
        kind: Some("function_run".to_owned()),
        name: Some("actions.multiReject".to_owned()),
        error_class: Some(rejection_carriers[0].error_class.clone()),
        message_template: rejection_carriers[0]
            .message
            .as_deref()
            .map(normalize_message_v1),
    };
    let first_fingerprint = fingerprint_v1(&first_fingerprint_input);
    let multi_rejection = allocate_failure_details(&FailureDetailsInputV1 {
        platform_code: Some("SNAPBACK_HANDLER_UNHANDLED_REJECTION".to_owned()),
        classification: FailureClassificationV1 {
            failure_disposition: FailureDispositionV1::Fault,
            issue_eligible: true,
            classifier_version: CLASSIFIER_VERSION,
        },
        fingerprint_branch: FingerprintBranchV1::Exception,
        fingerprint_version: Some(FINGERPRINT_VERSION),
        fingerprint_hash: Some(lower_hex(&first_fingerprint.truncated)),
        predecessor_fingerprint_version: None,
        predecessor_fingerprint_hash: None,
        status_class: None,
        app_code: None,
        error_class: Some(rejection_carriers[0].error_class.clone()),
        subsystem: None,
        function: Some("actions.multiReject".to_owned()),
        name: None,
        existing_allowlist: BTreeMap::new(),
        app_details: None,
        message_template: rejection_carriers[0]
            .message
            .as_deref()
            .map(normalize_message_v1),
        message: rejection_carriers[0].message.clone(),
        stack: rejection_carriers[0].stack.clone(),
        rejection_carriers: Some(rejection_carriers),
        message_extraction_truncated: false,
        stack_extraction_truncated: false,
    })
    .expect("multi-rejection fixture retains its ordered carrier");
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
        "multiRejection": {
            "fingerprintInput": first_fingerprint_input,
            "details": multi_rejection.details,
            "serializedBytes": multi_rejection.serialized_bytes,
            "expectedSemantics": {
                "observationCount": 1,
                "groupMembershipCount": 1,
                "occurrenceIncrement": 1,
                "exemplarCount": 1,
            },
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

    fn eligible_failure_details() -> Value {
        allocate_failure_details(&FailureDetailsInputV1 {
            platform_code: Some("SNAPBACK_HANDLER_FAILED".to_owned()),
            classification: FailureClassificationV1 {
                failure_disposition: FailureDispositionV1::Fault,
                issue_eligible: true,
                classifier_version: CLASSIFIER_VERSION,
            },
            fingerprint_branch: FingerprintBranchV1::Exception,
            fingerprint_version: Some(FINGERPRINT_VERSION),
            fingerprint_hash: Some("0123456789abcdef0123456789abcdef".to_owned()),
            predecessor_fingerprint_version: None,
            predecessor_fingerprint_hash: None,
            status_class: None,
            app_code: None,
            error_class: Some("TypeError".to_owned()),
            subsystem: None,
            function: Some("messages.send".to_owned()),
            name: Some("messages.send".to_owned()),
            existing_allowlist: BTreeMap::new(),
            app_details: None,
            message_template: Some("failed for <email>".to_owned()),
            message: None,
            stack: Some("at messages.send".to_owned()),
            rejection_carriers: None,
            message_extraction_truncated: false,
            stack_extraction_truncated: false,
        })
        .expect("eligible fixture fits the closed carrier")
        .details
    }

    fn multi_rejection_details_input(
        rejection_carriers: Vec<FailureCarrierV1>,
    ) -> FailureDetailsInputV1 {
        let first = rejection_carriers
            .first()
            .expect("multi-rejection fixture has a first carrier");
        let error_class = first.error_class.clone();
        let message = first.message.clone();
        let stack = first.stack.clone();
        let message_template = message.as_deref().map(normalize_message_v1);
        let fingerprint = fingerprint_v1(&FingerprintInputV1::Exception {
            scheme_version: FINGERPRINT_VERSION,
            kind: Some("function_run".to_owned()),
            name: Some("actions.multiReject".to_owned()),
            error_class: Some(error_class.clone()),
            message_template: message_template.clone(),
        });
        FailureDetailsInputV1 {
            platform_code: Some("SNAPBACK_HANDLER_UNHANDLED_REJECTION".to_owned()),
            classification: FailureClassificationV1 {
                failure_disposition: FailureDispositionV1::Fault,
                issue_eligible: true,
                classifier_version: CLASSIFIER_VERSION,
            },
            fingerprint_branch: FingerprintBranchV1::Exception,
            fingerprint_version: Some(FINGERPRINT_VERSION),
            fingerprint_hash: Some(lower_hex(&fingerprint.truncated)),
            predecessor_fingerprint_version: None,
            predecessor_fingerprint_hash: None,
            status_class: None,
            app_code: None,
            error_class: Some(error_class),
            subsystem: None,
            function: Some("actions.multiReject".to_owned()),
            name: None,
            existing_allowlist: BTreeMap::new(),
            app_details: None,
            message_template,
            message,
            stack,
            rejection_carriers: Some(rejection_carriers),
            message_extraction_truncated: false,
            stack_extraction_truncated: false,
        }
    }

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
            platform_code: Some("SNAPBACK_HANDLER_FAILED".to_owned()),
            classification: FailureClassificationV1 {
                failure_disposition: FailureDispositionV1::Fault,
                issue_eligible: true,
                classifier_version: 1,
            },
            fingerprint_branch: FingerprintBranchV1::Exception,
            fingerprint_version: Some(1),
            fingerprint_hash: Some("f".repeat(32)),
            predecessor_fingerprint_version: None,
            predecessor_fingerprint_hash: None,
            status_class: None,
            app_code: None,
            error_class: Some("TypeError".to_owned()),
            subsystem: None,
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
            rejection_carriers: None,
            message_extraction_truncated: false,
            stack_extraction_truncated: false,
        };
        let first = allocate_failure_details(&input).unwrap();
        let second = allocate_failure_details(&input).unwrap();
        assert_eq!(first, second);
        assert!(first.serialized_bytes <= FAILURE_DETAILS_MAX_BYTES);
        assert_eq!(first.details["detailFlags"]["appDetailsDropped"], true);
        assert_eq!(first.details["detailFlags"]["functionTruncated"], true);
        assert_eq!(
            first.details["detailFlags"]["messageTemplateTruncated"],
            true
        );
        assert_eq!(first.details["detailFlags"]["messageTruncated"], true);
        assert_eq!(first.details["detailFlags"]["stackTruncated"], true);
        assert!(first.details.get("platformCode").is_some());
        assert!(first.details.get("fp_hash").is_some());
        assert!(first.details.get("notAllowed").is_none());
        for value in first.details.as_object().unwrap().values() {
            if let Some(text) = value.as_str() {
                assert!(std::str::from_utf8(text.as_bytes()).is_ok());
            }
        }
    }

    #[test]
    fn multi_rejection_allocation_retains_order_and_first_authority() {
        let carriers = vec![
            FailureCarrierV1 {
                error_class: "TypeError".to_owned(),
                message: Some("first rejection 123".to_owned()),
                stack: Some("at first (handler.js:1:1)".to_owned()),
                message_extraction_truncated: false,
                stack_extraction_truncated: false,
            },
            FailureCarrierV1 {
                error_class: "RangeError".to_owned(),
                message: Some("second rejection 456".to_owned()),
                stack: Some("at second (handler.js:2:1)".to_owned()),
                message_extraction_truncated: false,
                stack_extraction_truncated: false,
            },
        ];
        let allocated = allocate_failure_details(&multi_rejection_details_input(carriers.clone()))
            .expect("well-formed multi-rejection details fit");
        assert_eq!(allocated.details["errorClass"], "TypeError");
        assert_eq!(
            allocated.details["messageTemplate"],
            "first rejection <digits>"
        );
        assert_eq!(allocated.details["rejectionCarriers"], json!(carriers));
        assert!(matches!(
            materialize_failure_stamp_v1(Some(&allocated.details)),
            FailureStampMaterializationV1::Eligible(_)
        ));
    }

    #[test]
    fn multi_rejection_allocation_reserves_every_entry_before_raw_text() {
        let long = "☃".repeat(6_000);
        let carriers = ["TypeError", "RangeError", "ReferenceError"]
            .into_iter()
            .map(|error_class| FailureCarrierV1 {
                error_class: error_class.to_owned(),
                message: Some(long.clone()),
                stack: Some(long.clone()),
                message_extraction_truncated: true,
                stack_extraction_truncated: true,
            })
            .collect::<Vec<_>>();
        let allocated = allocate_failure_details(&multi_rejection_details_input(carriers))
            .expect("ordered carrier metadata is required and bounded");
        assert!(allocated.serialized_bytes <= FAILURE_DETAILS_MAX_BYTES);
        assert!(allocated.details.get("messageTemplate").is_some());
        let retained = allocated.details["rejectionCarriers"].as_array().unwrap();
        assert_eq!(retained.len(), 3);
        assert_eq!(retained[0]["errorClass"], "TypeError");
        assert_eq!(retained[1]["errorClass"], "RangeError");
        assert_eq!(retained[2]["errorClass"], "ReferenceError");
        for carrier in retained {
            assert_eq!(carrier["messageExtractionTruncated"], true);
            assert_eq!(carrier["stackExtractionTruncated"], true);
        }
    }

    #[test]
    fn malformed_multi_rejection_carriers_still_fail_closed() {
        let carriers = vec![
            extract_failure_carrier(Some("TypeError"), Some("first rejection"), Some("at first")),
            extract_failure_carrier(
                Some("RangeError"),
                Some("second rejection"),
                Some("at second"),
            ),
        ];
        let details = allocate_failure_details(&multi_rejection_details_input(carriers))
            .unwrap()
            .details;

        let mut singleton = details.clone();
        singleton["rejectionCarriers"].as_array_mut().unwrap().pop();
        assert_eq!(
            materialize_failure_stamp_v1(Some(&singleton)),
            FailureStampMaterializationV1::MalformedEligible
        );

        let mut wrong_authority = details.clone();
        wrong_authority["rejectionCarriers"][0]["errorClass"] = json!("RangeError");
        assert_eq!(
            materialize_failure_stamp_v1(Some(&wrong_authority)),
            FailureStampMaterializationV1::MalformedEligible
        );

        let mut invalid_class = details;
        invalid_class["rejectionCarriers"][1]["errorClass"] = json!("bad-class");
        assert_eq!(
            materialize_failure_stamp_v1(Some(&invalid_class)),
            FailureStampMaterializationV1::MalformedEligible
        );
    }

    #[test]
    fn flusher_materializes_only_a_complete_closed_eligible_stamp() {
        let details = eligible_failure_details();
        let FailureStampMaterializationV1::Eligible(stamp) =
            materialize_failure_stamp_v1(Some(&details))
        else {
            panic!("allocator output must be accepted without recomputation");
        };
        assert_eq!(
            stamp.platform_code.as_deref(),
            Some("SNAPBACK_HANDLER_FAILED")
        );
        assert_eq!(stamp.failure_disposition, FailureDispositionV1::Fault);
        assert_eq!(stamp.classifier_version, CLASSIFIER_VERSION);
        assert_eq!(stamp.fingerprint_version, FINGERPRINT_VERSION);
        assert_eq!(
            stamp.fingerprint_hash,
            [
                0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab,
                0xcd, 0xef,
            ]
        );
        assert_eq!(stamp.subsystem, None);

        let mut seam_decided = details;
        seam_decided["platformCode"] = json!("SNAPBACK_DIFFERENT_FAULT");
        let FailureStampMaterializationV1::Eligible(stamp) =
            materialize_failure_stamp_v1(Some(&seam_decided))
        else {
            panic!("a valid closed stamp remains materializable");
        };
        assert_eq!(
            stamp.platform_code.as_deref(),
            Some("SNAPBACK_DIFFERENT_FAULT")
        );
        assert_eq!(
            stamp.fingerprint_hash,
            [
                0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab,
                0xcd, 0xef,
            ],
            "the store validates the emitted hash; it never recomputes it"
        );
    }

    #[test]
    fn malformed_eligible_stamps_fail_closed_without_impersonation() {
        let base = eligible_failure_details();
        let malformed = |mutate: fn(&mut Value)| {
            let mut candidate = base.clone();
            mutate(&mut candidate);
            assert_eq!(
                materialize_failure_stamp_v1(Some(&candidate)),
                FailureStampMaterializationV1::MalformedEligible
            );
        };

        for code in ["", "snapback_lowercase", "SNAPBACK-BAD"] {
            let mut candidate = base.clone();
            candidate["platformCode"] = json!(code);
            assert_eq!(
                materialize_failure_stamp_v1(Some(&candidate)),
                FailureStampMaterializationV1::MalformedEligible,
                "invalid platform code {code:?}"
            );
        }
        for version in [0, CLASSIFIER_VERSION + 1] {
            let mut candidate = base.clone();
            candidate["classifier_version"] = json!(version);
            assert_eq!(
                materialize_failure_stamp_v1(Some(&candidate)),
                FailureStampMaterializationV1::MalformedEligible
            );
        }
        malformed(|value| value["fp_version"] = json!(0));
        malformed(|value| value["fp_hash"] = json!("ABCDEF0123456789ABCDEF0123456789"));
        malformed(|value| value["errorClass"] = json!("bad-class"));
        malformed(|value| value["errorClass"] = json!(""));
        malformed(|value| value["subsystem"] = json!("Functions"));
        malformed(|value| value["predecessor_fp_version"] = json!(1));
        malformed(|value| value["predecessor_fp_hash"] = json!("f".repeat(32)));
        malformed(|value| value["failure_disposition"] = json!("caller_error"));
        malformed(|value| value["failure_disposition"] = json!("cancellation"));
        malformed(|value| value["detailFlags"] = json!(false));
        malformed(|value| value["detailFlags"]["stackTruncated"] = json!("false"));
        malformed(|value| value["detailFlags"]["unknownFlag"] = json!(false));
        malformed(|value| value["arbitraryClassifierStamp"] = json!(true));
        malformed(|value| value["fp_branch"] = json!("typed_refusal"));
        malformed(|value| value["fp_branch"] = json!("diagnostic"));
        malformed(|value| value["fp_branch"] = json!("transport"));
        malformed(|value| {
            value["fp_branch"] = json!("app_refusal");
            value["failure_disposition"] = json!("app_refusal");
            value["platformCode"] = json!("SNAPBACK_APP_REFUSAL");
            value["appCode"] = json!("STALE_MOVE");
        });

        let mut code_less_transport = base.clone();
        code_less_transport
            .as_object_mut()
            .unwrap()
            .remove("platformCode");
        code_less_transport
            .as_object_mut()
            .unwrap()
            .remove("errorClass");
        code_less_transport
            .as_object_mut()
            .unwrap()
            .remove("subsystem");
        code_less_transport["fp_branch"] = json!("transport");
        code_less_transport["statusClass"] = json!(5);
        let FailureStampMaterializationV1::Eligible(transport) =
            materialize_failure_stamp_v1(Some(&code_less_transport))
        else {
            panic!("a code-less 5xx transport fault is a complete eligible branch");
        };
        assert_eq!(transport.platform_code, None);
        assert_eq!(transport.status_class, Some(5));
        assert_eq!(transport.fingerprint_branch, FingerprintBranchV1::Transport);

        let mut typed = base.clone();
        typed.as_object_mut().unwrap().remove("errorClass");
        typed["fp_branch"] = json!("typed_refusal");
        assert!(matches!(
            materialize_failure_stamp_v1(Some(&typed)),
            FailureStampMaterializationV1::Eligible(_)
        ));
        let mut diagnostic = typed.clone();
        diagnostic["fp_branch"] = json!("diagnostic");
        diagnostic["subsystem"] = json!("telemetry");
        assert!(matches!(
            materialize_failure_stamp_v1(Some(&diagnostic)),
            FailureStampMaterializationV1::Eligible(_)
        ));
        let mut app_refusal = typed.clone();
        app_refusal["fp_branch"] = json!("app_refusal");
        app_refusal["failure_disposition"] = json!("app_refusal");
        app_refusal["platformCode"] = json!("SNAPBACK_APP_REFUSAL");
        app_refusal["appCode"] = json!("STALE_MOVE");
        assert!(matches!(
            materialize_failure_stamp_v1(Some(&app_refusal)),
            FailureStampMaterializationV1::Eligible(_)
        ));

        for (branch, valid, forbidden) in [
            (
                "typed_refusal",
                &typed,
                vec![
                    ("appCode", json!("STALE_MOVE")),
                    ("errorClass", json!("TypeError")),
                    ("subsystem", json!("functions")),
                    ("statusClass", json!(5)),
                ],
            ),
            (
                "app_refusal",
                &app_refusal,
                vec![
                    ("errorClass", json!("TypeError")),
                    ("subsystem", json!("functions")),
                    ("statusClass", json!(5)),
                ],
            ),
            (
                "exception",
                &base,
                vec![
                    ("appCode", json!("STALE_MOVE")),
                    ("subsystem", json!("functions")),
                    ("statusClass", json!(5)),
                ],
            ),
            (
                "transport",
                &code_less_transport,
                vec![
                    ("platformCode", json!("SNAPBACK_HANDLER_FAILED")),
                    ("appCode", json!("STALE_MOVE")),
                    ("errorClass", json!("TypeError")),
                    ("subsystem", json!("functions")),
                ],
            ),
            (
                "diagnostic",
                &diagnostic,
                vec![
                    ("appCode", json!("STALE_MOVE")),
                    ("errorClass", json!("TypeError")),
                    ("statusClass", json!(5)),
                ],
            ),
        ] {
            for (key, value) in forbidden {
                let mut confused = valid.clone();
                confused[key] = value;
                assert_eq!(
                    materialize_failure_stamp_v1(Some(&confused)),
                    FailureStampMaterializationV1::MalformedEligible,
                    "{branch} must reject foreign facet {key}"
                );
            }
        }
        let mut diagnostic_without_subsystem = diagnostic.clone();
        diagnostic_without_subsystem
            .as_object_mut()
            .unwrap()
            .remove("subsystem");
        assert_eq!(
            materialize_failure_stamp_v1(Some(&diagnostic_without_subsystem)),
            FailureStampMaterializationV1::MalformedEligible
        );

        let mut missing_non_transport_code = base.clone();
        missing_non_transport_code
            .as_object_mut()
            .unwrap()
            .remove("platformCode");
        assert_eq!(
            materialize_failure_stamp_v1(Some(&missing_non_transport_code)),
            FailureStampMaterializationV1::MalformedEligible
        );
        code_less_transport["statusClass"] = json!(4);
        assert_eq!(
            materialize_failure_stamp_v1(Some(&code_less_transport)),
            FailureStampMaterializationV1::MalformedEligible
        );

        let mut sentinel = base.clone();
        sentinel["errorClass"] = json!(UNCLASSIFIED_ERROR_CLASS);
        assert!(matches!(
            materialize_failure_stamp_v1(Some(&sentinel)),
            FailureStampMaterializationV1::Eligible(_)
        ));
        let mut not_eligible = base;
        not_eligible["issue_eligible"] = json!(false);
        assert_eq!(
            materialize_failure_stamp_v1(Some(&not_eligible)),
            FailureStampMaterializationV1::NotEligible
        );
    }

    #[test]
    fn reserved_detail_vocabulary_is_unique() {
        assert_eq!(
            FAILURE_DETAIL_KEYS.iter().collect::<BTreeSet<_>>().len(),
            FAILURE_DETAIL_KEYS.len()
        );
    }
}
