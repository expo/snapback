//! Dormant Rust reference for LLP 0166's closed `result-transform.v1`.
//!
//! This module is intentionally pure and has no store, admission, or live-path
//! caller. The cross-runtime D5 extension executes it directly as a reference;
//! wiring remains behind the LLP 0166 ship gate.
//!
//! @ref LLP 0166#the-evaluation-model-result-transformv1 — exact record,
//!   single-address input, fixed pipeline, scalar comparator, and overlay split.
//! @ref LLP 0051#d5-conformance-the-corpus-becomes-the-data-tier-contract —
//!   committed cases, version pins, typed refusals, and exact executor parity.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::{BTreeSet, HashSet};

pub const RESULT_TRANSFORM_V1_FORMAT: &str = "snapback.result-transform.v1";
pub const RESULT_TRANSFORM_V1_HASH_DOMAIN: &str = "snapback:result-transform:v1:";
pub const RESULT_TRANSFORM_V1_RUST_EVALUATOR_ID: &str = "snapback.result-transform.rust.v1";
pub const RESULT_TRANSFORM_V1_JAVASCRIPT_EVALUATOR_ID: &str =
    "snapback.result-transform.javascript.v1";
pub const RESULT_TRANSFORM_V1_CORPUS: &str = "snapback-data-tier.result-transform-v1";
pub const RESULT_TRANSFORM_V1_CORPUS_FORMAT_VERSION: u32 = 1;
pub const RESULT_TRANSFORM_V1_PROFILE_VERSION: u32 = 1;
pub const RESULT_TRANSFORM_V1_CORPUS_DIRECTORY: &str =
    "tests/conformance/data-tier/result-transform-v1";
pub const RESULT_TRANSFORM_V1_CORPUS_MANIFEST_FILE: &str =
    "tests/conformance/data-tier/result-transform-v1/corpus.manifest.json";
pub const RESULT_TRANSFORM_V1_CASE_SCHEMA_FILE: &str =
    "schemas/result-transform-v1.case.schema.json";
pub const RESULT_TRANSFORM_V1_CORPUS_SCHEMA_FILE: &str =
    "schemas/result-transform-v1.corpus.schema.json";

pub mod refusal_code {
    pub const PLAN_INVALID: &str = "SNAPBACK_RESULT_TRANSFORM_PLAN_INVALID";
    pub const STAGE_UNKNOWN: &str = "SNAPBACK_RESULT_TRANSFORM_STAGE_UNKNOWN";
    pub const COMPARATOR_UNKNOWN: &str = "SNAPBACK_RESULT_TRANSFORM_COMPARATOR_UNKNOWN";
    pub const NORMALIZATION_UNADMITTED: &str = "SNAPBACK_RESULT_TRANSFORM_NORMALIZATION_UNADMITTED";
    pub const FIELD_UNPROJECTED: &str = "SNAPBACK_RESULT_TRANSFORM_FIELD_UNPROJECTED";
    pub const ORDER_FIELD_DUPLICATE: &str = "SNAPBACK_RESULT_TRANSFORM_ORDER_FIELD_DUPLICATE";
    pub const LIMIT_INVALID: &str = "SNAPBACK_RESULT_TRANSFORM_LIMIT_INVALID";
    pub const CROSS_ADDRESS: &str = "SNAPBACK_RESULT_TRANSFORM_CROSS_ADDRESS";
    pub const NON_SCALAR: &str = "SNAPBACK_RESULT_TRANSFORM_NON_SCALAR";
    pub const BASE_INVALID: &str = "SNAPBACK_RESULT_TRANSFORM_BASE_INVALID";
    pub const MIXED_VERSION: &str = "SNAPBACK_RESULT_TRANSFORM_MIXED_VERSION";
    pub const OVERLAY_INPUT_REQUIRED: &str = "SNAPBACK_RESULT_TRANSFORM_OVERLAY_INPUT_REQUIRED";
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformRefusalV1 {
    pub code: &'static str,
    pub reason: &'static str,
}

impl TransformRefusalV1 {
    fn new(code: &'static str, reason: &'static str) -> Self {
        Self { code, reason }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransformOverlayV1 {
    Apply,
    None,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransformFilterOperatorV1 {
    Eq,
    Ne,
    Lt,
    Lte,
    Gt,
    Gte,
    In,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TransformFilterClauseV1 {
    pub field: String,
    pub op: TransformFilterOperatorV1,
    pub value: Value,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransformOrderDirectionV1 {
    Asc,
    Desc,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransformOrderEntryV1 {
    pub field: String,
    pub direction: TransformOrderDirectionV1,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TransformPlanV1 {
    pub materialization_key: String,
    pub overlay: TransformOverlayV1,
    pub filter: Vec<TransformFilterClauseV1>,
    pub order: Vec<TransformOrderEntryV1>,
    pub limit: Option<u64>,
    canonical_record: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TransformEvaluationV1 {
    pub transform_hash: String,
    pub rows: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultTransformCorpusBaselineV1 {
    pub corpus: String,
    pub manifest_path: String,
    pub cases: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultTransformEvaluatorIdentitiesV1 {
    pub rust: String,
    pub javascript: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultTransformCorpusCaseEntryV1 {
    pub name: String,
    pub path: String,
    pub sha256: String,
    pub transform_hash: Option<String>,
    pub required_capabilities: Vec<String>,
    pub minimum_profile_version: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultTransformCorpusManifestV1 {
    pub artifact_kind: String,
    pub corpus: String,
    pub extension_of: ResultTransformCorpusBaselineV1,
    pub profile: String,
    pub corpus_format_version: u32,
    pub profile_version: u32,
    pub case_schema_path: String,
    pub evaluator_identities: ResultTransformEvaluatorIdentitiesV1,
    pub cases: Vec<ResultTransformCorpusCaseEntryV1>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultTransformCorpusExpectationV1 {
    pub transform_hash: Option<String>,
    pub outcome: Value,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultTransformCorpusCaseV1 {
    pub corpus: String,
    pub corpus_version: u32,
    pub name: String,
    pub notes: String,
    pub plan: Value,
    pub executing_materialization_key: String,
    pub projected_fields: Vec<String>,
    pub base: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_overlay_rows: Option<Vec<Value>>,
    pub expect: ResultTransformCorpusExpectationV1,
}

fn refused(code: &'static str, reason: &'static str) -> TransformRefusalV1 {
    TransformRefusalV1::new(code, reason)
}

fn object<'a>(
    value: &'a Value,
    code: &'static str,
    reason: &'static str,
) -> Result<&'a Map<String, Value>, TransformRefusalV1> {
    value.as_object().ok_or_else(|| refused(code, reason))
}

fn require_fields(
    fields: &Map<String, Value>,
    allowed: &[&str],
    kind: &'static str,
) -> Result<(), TransformRefusalV1> {
    for field in fields.keys() {
        if allowed.contains(&field.as_str()) {
            continue;
        }
        if kind == "plan" && (field == "stages" || field == "pipeline") {
            return Err(refused(refusal_code::STAGE_UNKNOWN, "unknown-stage"));
        }
        if field == "normalization" || field == "normalize" {
            return Err(refused(
                refusal_code::NORMALIZATION_UNADMITTED,
                "normalization-unadmitted",
            ));
        }
        if kind == "order-entry" && field == "comparator" {
            return Err(refused(
                refusal_code::COMPARATOR_UNKNOWN,
                "unknown-comparator",
            ));
        }
        return Err(refused(
            refusal_code::PLAN_INVALID,
            match kind {
                "plan" => "unknown-plan-field",
                "filter-entry" => "unknown-filter-entry-field",
                "order-entry" => "unknown-order-entry-field",
                _ => "unknown-record-field",
            },
        ));
    }
    if allowed.iter().any(|field| !fields.contains_key(*field)) {
        return Err(refused(
            refusal_code::PLAN_INVALID,
            match kind {
                "plan" => "missing-plan-field",
                "filter-entry" => "missing-filter-entry-field",
                "order-entry" => "missing-order-entry-field",
                _ => "missing-record-field",
            },
        ));
    }
    Ok(())
}

fn safe_limit(value: &Value) -> Option<u64> {
    const MAX_SAFE: f64 = 9_007_199_254_740_991.0;
    let number = value.as_f64()?;
    if number.is_finite() && number >= 0.0 && number.fract() == 0.0 && number <= MAX_SAFE {
        Some(number as u64)
    } else {
        None
    }
}

pub fn parse_transform_plan_v1(plan: &Value) -> Result<TransformPlanV1, TransformRefusalV1> {
    let fields = object(plan, refusal_code::PLAN_INVALID, "plan-not-record")?;
    require_fields(
        fields,
        &[
            "format",
            "materializationKey",
            "overlay",
            "filterGrammar",
            "filter",
            "order",
            "limit",
        ],
        "plan",
    )?;
    if fields.get("format").and_then(Value::as_str) != Some(RESULT_TRANSFORM_V1_FORMAT) {
        return Err(refused(refusal_code::PLAN_INVALID, "unknown-format"));
    }
    let materialization_key = fields
        .get("materializationKey")
        .and_then(Value::as_str)
        .ok_or_else(|| refused(refusal_code::PLAN_INVALID, "materialization-key-not-string"))?
        .to_owned();
    let overlay = match fields.get("overlay").and_then(Value::as_str) {
        Some("apply") => TransformOverlayV1::Apply,
        Some("none") => TransformOverlayV1::None,
        _ => return Err(refused(refusal_code::PLAN_INVALID, "unknown-overlay-mode")),
    };
    if fields.get("filterGrammar").and_then(Value::as_str) != Some("basic-v1") {
        return Err(refused(
            refusal_code::PLAN_INVALID,
            "unknown-filter-grammar",
        ));
    }

    let filter_values = fields
        .get("filter")
        .and_then(Value::as_array)
        .ok_or_else(|| refused(refusal_code::PLAN_INVALID, "filter-not-array"))?;
    let mut filter = Vec::with_capacity(filter_values.len());
    for entry in filter_values {
        let entry_fields = object(entry, refusal_code::PLAN_INVALID, "filter-entry-not-record")?;
        require_fields(entry_fields, &["field", "op", "value"], "filter-entry")?;
        let field = entry_fields
            .get("field")
            .and_then(Value::as_str)
            .ok_or_else(|| refused(refusal_code::PLAN_INVALID, "filter-field-not-string"))?
            .to_owned();
        let op = match entry_fields.get("op").and_then(Value::as_str) {
            Some("eq") => TransformFilterOperatorV1::Eq,
            Some("ne") => TransformFilterOperatorV1::Ne,
            Some("lt") => TransformFilterOperatorV1::Lt,
            Some("lte") => TransformFilterOperatorV1::Lte,
            Some("gt") => TransformFilterOperatorV1::Gt,
            Some("gte") => TransformFilterOperatorV1::Gte,
            Some("in") => TransformFilterOperatorV1::In,
            _ => {
                return Err(refused(
                    refusal_code::PLAN_INVALID,
                    "unknown-filter-operator",
                ));
            }
        };
        let value = entry_fields
            .get("value")
            .expect("closed-field check established value")
            .clone();
        if op == TransformFilterOperatorV1::In
            && value.as_array().is_none_or(|items| items.is_empty())
        {
            return Err(refused(
                refusal_code::PLAN_INVALID,
                "in-operand-not-nonempty-array",
            ));
        }
        filter.push(TransformFilterClauseV1 { field, op, value });
    }

    let order_values = fields
        .get("order")
        .and_then(Value::as_array)
        .ok_or_else(|| refused(refusal_code::PLAN_INVALID, "order-not-array"))?;
    let mut order_fields = HashSet::new();
    let mut order = Vec::with_capacity(order_values.len());
    for entry in order_values {
        let entry_fields = object(entry, refusal_code::PLAN_INVALID, "order-entry-not-record")?;
        require_fields(entry_fields, &["field", "direction"], "order-entry")?;
        let field = entry_fields
            .get("field")
            .and_then(Value::as_str)
            .ok_or_else(|| refused(refusal_code::PLAN_INVALID, "order-field-not-string"))?
            .to_owned();
        let direction = match entry_fields.get("direction").and_then(Value::as_str) {
            Some("asc") => TransformOrderDirectionV1::Asc,
            Some("desc") => TransformOrderDirectionV1::Desc,
            _ => {
                return Err(refused(
                    refusal_code::PLAN_INVALID,
                    "unknown-order-direction",
                ));
            }
        };
        if !order_fields.insert(field.clone()) {
            return Err(refused(
                refusal_code::ORDER_FIELD_DUPLICATE,
                "duplicate-order-field",
            ));
        }
        order.push(TransformOrderEntryV1 { field, direction });
    }

    let limit = match fields.get("limit") {
        Some(Value::Null) => None,
        Some(value) => Some(safe_limit(value).ok_or_else(|| {
            refused(
                refusal_code::LIMIT_INVALID,
                "limit-not-nonnegative-safe-integer",
            )
        })?),
        None => unreachable!("closed-field check established limit"),
    };

    Ok(TransformPlanV1 {
        materialization_key,
        overlay,
        filter,
        order,
        limit,
        canonical_record: plan.clone(),
    })
}

fn scalar(value: &Value) -> bool {
    match value {
        Value::Null | Value::Bool(_) | Value::String(_) => true,
        Value::Number(number) => number.as_f64().is_some_and(f64::is_finite),
        Value::Array(_) | Value::Object(_) => false,
    }
}

pub fn validate_transform_plan_v1(
    plan: &Value,
    executing_materialization_key: &str,
    projected_fields: &[String],
) -> Result<TransformPlanV1, TransformRefusalV1> {
    let parsed = parse_transform_plan_v1(plan)?;
    if parsed.materialization_key != executing_materialization_key {
        return Err(refused(
            refusal_code::CROSS_ADDRESS,
            "cross-address-materialization-key",
        ));
    }
    let fields = projected_fields.iter().collect::<BTreeSet<_>>();
    if fields.len() != projected_fields.len() {
        return Err(refused(
            refusal_code::BASE_INVALID,
            "projected-contract-invalid",
        ));
    }
    for clause in &parsed.filter {
        if !fields.contains(&clause.field) {
            return Err(refused(
                refusal_code::FIELD_UNPROJECTED,
                "unprojected-filter-field",
            ));
        }
        if clause.op == TransformFilterOperatorV1::In {
            if clause
                .value
                .as_array()
                .expect("parse checked in array")
                .iter()
                .any(|value| !scalar(value))
            {
                return Err(refused(refusal_code::NON_SCALAR, "non-scalar-in-element"));
            }
        } else if !scalar(&clause.value) {
            return Err(refused(
                refusal_code::NON_SCALAR,
                "non-scalar-filter-operand",
            ));
        }
    }
    for entry in &parsed.order {
        if !fields.contains(&entry.field) {
            return Err(refused(
                refusal_code::FIELD_UNPROJECTED,
                "unprojected-order-field",
            ));
        }
    }
    Ok(parsed)
}

fn compare_utf16(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

fn escape_jcs_string(output: &mut String, value: &str) {
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\u{8}' => output.push_str("\\b"),
            '\u{c}' => output.push_str("\\f"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            control if (control as u32) < 0x20 => {
                output.push_str(&format!("\\u{:04x}", control as u32));
            }
            other => output.push(other),
        }
    }
    output.push('"');
}

fn canonical_json_into(output: &mut String, value: &Value) -> Result<(), TransformRefusalV1> {
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(true) => output.push_str("true"),
        Value::Bool(false) => output.push_str("false"),
        Value::Number(number) => {
            let value = number
                .as_f64()
                .filter(|value| value.is_finite())
                .ok_or_else(|| refused(refusal_code::PLAN_INVALID, "non-canonical-number"))?;
            output.push_str(ryu_js::Buffer::new().format(value));
        }
        Value::String(value) => escape_jcs_string(output, value),
        Value::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                canonical_json_into(output, value)?;
            }
            output.push(']');
        }
        Value::Object(fields) => {
            let mut keys = fields.keys().collect::<Vec<_>>();
            keys.sort_by(|left, right| compare_utf16(left, right));
            output.push('{');
            for (index, key) in keys.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                escape_jcs_string(output, key);
                output.push(':');
                canonical_json_into(output, &fields[key.as_str()])?;
            }
            output.push('}');
        }
    }
    Ok(())
}

pub fn canonical_result_transform_json_v1(value: &Value) -> Result<String, TransformRefusalV1> {
    let mut output = String::new();
    canonical_json_into(&mut output, value)?;
    Ok(output)
}

pub fn transform_hash_v1(plan: &TransformPlanV1) -> Result<String, TransformRefusalV1> {
    let canonical = canonical_result_transform_json_v1(&plan.canonical_record)?;
    let mut hasher = Sha256::new();
    hasher.update(RESULT_TRANSFORM_V1_HASH_DOMAIN.as_bytes());
    hasher.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn base_fields<'a>(
    value: &'a Value,
    allowed: &[&str],
    kind: &'static str,
) -> Result<&'a Map<String, Value>, TransformRefusalV1> {
    let fields = object(
        value,
        refusal_code::BASE_INVALID,
        match kind {
            "base" => "base-not-record",
            "page" => "page-not-record",
            _ => "record-not-record",
        },
    )?;
    if fields
        .keys()
        .any(|field| !allowed.contains(&field.as_str()))
    {
        return Err(refused(
            refusal_code::BASE_INVALID,
            match kind {
                "base" => "unknown-base-field",
                "page" => "unknown-page-field",
                _ => "unknown-record-field",
            },
        ));
    }
    if allowed.iter().any(|field| !fields.contains_key(*field)) {
        return Err(refused(
            refusal_code::BASE_INVALID,
            match kind {
                "base" => "missing-base-field",
                "page" => "missing-page-field",
                _ => "missing-record-field",
            },
        ));
    }
    Ok(fields)
}

fn validate_rows(values: &Value, reason: &'static str) -> Result<Vec<Value>, TransformRefusalV1> {
    let rows = values
        .as_array()
        .ok_or_else(|| refused(refusal_code::BASE_INVALID, reason))?;
    for row in rows {
        if !row.is_object() {
            return Err(refused(refusal_code::BASE_INVALID, "row-not-record"));
        }
        canonical_result_transform_json_v1(row)
            .map_err(|_| refused(refusal_code::BASE_INVALID, "row-not-canonical-client-value"))?;
    }
    Ok(rows.clone())
}

pub fn assemble_result_transform_base_v1(base: &Value) -> Result<Vec<Value>, TransformRefusalV1> {
    let fields = base_fields(base, &["shape", "mode", "pages"], "base")?;
    if fields.get("shape").and_then(Value::as_str) != Some("row-sequence") {
        return Err(refused(refusal_code::BASE_INVALID, "non-row-sequence"));
    }
    let mode = fields
        .get("mode")
        .and_then(Value::as_str)
        .ok_or_else(|| refused(refusal_code::BASE_INVALID, "unknown-base-assembly-mode"))?;
    if mode != "single-page" && mode != "complete-page-set" {
        return Err(refused(
            refusal_code::BASE_INVALID,
            "unknown-base-assembly-mode",
        ));
    }
    let pages = fields
        .get("pages")
        .and_then(Value::as_array)
        .ok_or_else(|| refused(refusal_code::BASE_INVALID, "empty-page-set"))?;
    if pages.is_empty() {
        return Err(refused(refusal_code::BASE_INVALID, "empty-page-set"));
    }
    if mode == "single-page" && pages.len() != 1 {
        return Err(refused(
            refusal_code::BASE_INVALID,
            "single-page-count-invalid",
        ));
    }

    let mut version: Option<&str> = None;
    let mut rows = Vec::new();
    for (index, page) in pages.iter().enumerate() {
        let page = base_fields(page, &["version", "terminal", "rows"], "page")?;
        let page_version = page
            .get("version")
            .and_then(Value::as_str)
            .ok_or_else(|| refused(refusal_code::BASE_INVALID, "page-metadata-invalid"))?;
        let terminal = page
            .get("terminal")
            .and_then(Value::as_bool)
            .ok_or_else(|| refused(refusal_code::BASE_INVALID, "page-metadata-invalid"))?;
        if let Some(version) = version {
            if version != page_version {
                return Err(refused(refusal_code::MIXED_VERSION, "mixed-version-base"));
            }
        } else {
            version = Some(page_version);
        }
        if mode == "complete-page-set" && terminal != (index == pages.len() - 1) {
            return Err(refused(refusal_code::BASE_INVALID, "broken-page-chain"));
        }
        rows.extend(validate_rows(
            page.get("rows")
                .expect("closed-field check established rows"),
            "page-rows-not-array",
        )?);
    }
    Ok(rows)
}

#[derive(Clone, Copy)]
enum ScalarV1<'a> {
    Null,
    Boolean(bool),
    Number(f64),
    String(&'a str),
}

impl ScalarV1<'_> {
    fn rank(self) -> u8 {
        match self {
            Self::Null => 0,
            Self::Boolean(_) => 1,
            Self::Number(_) => 2,
            Self::String(_) => 3,
        }
    }
}

fn scalar_from<'a>(
    value: Option<&'a Value>,
    reason: &'static str,
) -> Result<ScalarV1<'a>, TransformRefusalV1> {
    match value {
        None | Some(Value::Null) => Ok(ScalarV1::Null),
        Some(Value::Bool(value)) => Ok(ScalarV1::Boolean(*value)),
        Some(Value::Number(value)) => value
            .as_f64()
            .filter(|value| value.is_finite())
            .map(ScalarV1::Number)
            .ok_or_else(|| refused(refusal_code::NON_SCALAR, reason)),
        Some(Value::String(value)) => Ok(ScalarV1::String(value)),
        Some(Value::Array(_) | Value::Object(_)) => Err(refused(refusal_code::NON_SCALAR, reason)),
    }
}

fn compare_scalars(left: ScalarV1<'_>, right: ScalarV1<'_>) -> Ordering {
    let rank = left.rank().cmp(&right.rank());
    if rank != Ordering::Equal {
        return rank;
    }
    match (left, right) {
        (ScalarV1::Null, ScalarV1::Null) => Ordering::Equal,
        (ScalarV1::Boolean(left), ScalarV1::Boolean(right)) => left.cmp(&right),
        (ScalarV1::Number(left), ScalarV1::Number(right)) => {
            left.partial_cmp(&right).expect("validated finite numbers")
        }
        (ScalarV1::String(left), ScalarV1::String(right)) => left.as_bytes().cmp(right.as_bytes()),
        _ => unreachable!("equal scalar ranks have the same type"),
    }
}

fn equal_scalars(left: ScalarV1<'_>, right: ScalarV1<'_>) -> bool {
    compare_scalars(left, right) == Ordering::Equal
}

fn row_scalar<'a>(
    row: &'a Value,
    field: &str,
    reason: &'static str,
) -> Result<ScalarV1<'a>, TransformRefusalV1> {
    scalar_from(row.as_object().and_then(|row| row.get(field)), reason)
}

fn filter_matches(
    row_value: ScalarV1<'_>,
    clause: &TransformFilterClauseV1,
) -> Result<bool, TransformRefusalV1> {
    if clause.op == TransformFilterOperatorV1::In {
        for operand in clause.value.as_array().expect("validated in operand") {
            if equal_scalars(
                row_value,
                scalar_from(Some(operand), "non-scalar-in-element")?,
            ) {
                return Ok(true);
            }
        }
        return Ok(false);
    }
    let operand = scalar_from(Some(&clause.value), "non-scalar-filter-operand")?;
    let order = compare_scalars(row_value, operand);
    Ok(match clause.op {
        TransformFilterOperatorV1::Eq => order == Ordering::Equal,
        TransformFilterOperatorV1::Ne => order != Ordering::Equal,
        TransformFilterOperatorV1::Lt => order == Ordering::Less,
        TransformFilterOperatorV1::Lte => order != Ordering::Greater,
        TransformFilterOperatorV1::Gt => order == Ordering::Greater,
        TransformFilterOperatorV1::Gte => order != Ordering::Less,
        TransformFilterOperatorV1::In => unreachable!(),
    })
}

pub fn evaluate_validated_transform_v1(
    plan: &TransformPlanV1,
    base: &Value,
    client_overlay_rows: Option<&[Value]>,
) -> Result<TransformEvaluationV1, TransformRefusalV1> {
    let mut rows = assemble_result_transform_base_v1(base)?;
    if plan.overlay == TransformOverlayV1::Apply {
        let overlay = client_overlay_rows.ok_or_else(|| {
            refused(
                refusal_code::OVERLAY_INPUT_REQUIRED,
                "client-overlay-rows-required",
            )
        })?;
        for row in overlay {
            if !row.is_object() {
                return Err(refused(refusal_code::BASE_INVALID, "row-not-record"));
            }
            canonical_result_transform_json_v1(row).map_err(|_| {
                refused(refusal_code::BASE_INVALID, "row-not-canonical-client-value")
            })?;
        }
        rows = overlay.to_vec();
    }

    if !plan.filter.is_empty() {
        let mut filtered = Vec::with_capacity(rows.len());
        for row in rows {
            let mut matches = true;
            for clause in &plan.filter {
                let value = row_scalar(&row, &clause.field, "non-scalar-filter-field")?;
                if !filter_matches(value, clause)? {
                    matches = false;
                }
            }
            if matches {
                filtered.push(row);
            }
        }
        rows = filtered;
    }

    if !plan.order.is_empty() {
        for row in &rows {
            for entry in &plan.order {
                row_scalar(row, &entry.field, "non-scalar-order-field")?;
            }
        }
        let mut decorated = rows.into_iter().enumerate().collect::<Vec<_>>();
        decorated.sort_by(|(left_index, left), (right_index, right)| {
            for entry in &plan.order {
                let mut order = compare_scalars(
                    row_scalar(left, &entry.field, "non-scalar-order-field")
                        .expect("order fields were prevalidated"),
                    row_scalar(right, &entry.field, "non-scalar-order-field")
                        .expect("order fields were prevalidated"),
                );
                if entry.direction == TransformOrderDirectionV1::Desc {
                    order = order.reverse();
                }
                if order != Ordering::Equal {
                    return order;
                }
            }
            left_index.cmp(right_index)
        });
        rows = decorated.into_iter().map(|(_, row)| row).collect();
    }

    if let Some(limit) = plan.limit
        && limit < rows.len() as u64
    {
        rows.truncate(limit as usize);
    }
    Ok(TransformEvaluationV1 {
        transform_hash: transform_hash_v1(plan)?,
        rows,
    })
}

pub fn evaluate_result_transform_v1(
    plan: &Value,
    executing_materialization_key: &str,
    projected_fields: &[String],
    base: &Value,
    client_overlay_rows: Option<&[Value]>,
) -> Result<TransformEvaluationV1, TransformRefusalV1> {
    let plan = validate_transform_plan_v1(plan, executing_materialization_key, projected_fields)?;
    evaluate_validated_transform_v1(&plan, base, client_overlay_rows)
}

pub fn outcome_value(result: Result<TransformEvaluationV1, TransformRefusalV1>) -> Value {
    match result {
        Ok(evaluation) => serde_json::json!({
            "status": "ok",
            "rows": evaluation.rows,
        }),
        Err(refusal) => serde_json::json!({
            "status": "refused",
            "code": refusal.code,
            "reason": refusal.reason,
        }),
    }
}
