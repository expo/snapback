//! Per-invocation argument-shape validation at the Rust ingress seam.
//!
//! This is LLP 0131's genuinely new evidence boundary: before this module no
//! server-side per-invocation args-shape validation existed for declared
//! `v.*` arguments — even scalars (LLP 0117 finding 4). Every fresh
//! invocation admission lane (direct function run, server query/mutation/
//! action requests, live subscribe argument binding, search invocation,
//! offline-outbox replay — which arrives as a fresh mutation request)
//! validates the complete args object against the function's declared
//! `argsContract` before handler dispatch, plan execution, or any buffered
//! write. Exact replay of a retained mutation result under its original
//! identity releases the original bytes without re-running this seam
//! (LLP 0131 replay lane 2; the mutation lane checks settlement before
//! calling here).
//!
//! The search request parse (`SearchRequestV1`) also lives here so the
//! `PlatformSchemaRef` delegation and `query_search_on`'s full-request parse
//! share one path-carrying serde authority instead of two divergent parses.
//!
//! Diagnostic precedence is node-scoped (LLP 0131 §Diagnostics): a
//! `PlatformSchemaRef` node's violations surface under the owning parser's
//! stable public code (`SNAPBACK_SEARCH_QUERY_INVALID`) with the bounded
//! pointer; every other node refuses
//! `SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION` — search `limit`/`after`
//! included for v2-descriptor apps, while pre-v2 apps keep the legacy search
//! codes through the unchanged `query_search_on` checks.
//!
//! @ref LLP 0131#runtime-ingress-validation — fail-closed, path-carrying,
//!   never echoing the rejected value; `PlatformSchemaRef` delegates to the
//!   owning Rust parser's deserialization upgraded with the failing pointer.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{
    FunctionArgsContract, FunctionDefinition, ResultValueContract, SCHEMA_REF_SEARCH_QUERY_AST_V1,
};
use crate::search::types::{SearchQueryAstV1, SearchRequestV1};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

/// Complete-args ceiling (LLP 0131 §Runtime ingress validation): the profile
/// maximum, pending open question 3's benchmark adjudication; transports may
/// bound lower (the 64 KiB live-socket frame cap already does).
pub const MAX_FUNCTION_ARGS_BYTES: usize = 1024 * 1024;
const MAX_ARGS_NODES: usize = 65_536;
const MAX_ARGS_DEPTH: usize = 16;
// LLP 0108's bounded-pointer profile: maximum 17 segments and 256 UTF-8
// bytes; a deeper or longer path emits the bounded ancestor followed by one
// literal `/<truncated>` segment after reserving space for that suffix.
const MAX_POINTER_SEGMENTS: usize = 17;
const MAX_POINTER_BYTES: usize = 256;
const TRUNCATED_SEGMENT: &str = "/<truncated>";

/// One pointer segment. Declared names use normal RFC 6901 escaping; unknown
/// application-controlled keys are hashed (LLP 0108's redaction rule);
/// indexes are numeric.
#[derive(Clone, Debug)]
enum PointerSegment {
    Declared(String),
    UnknownKey(String),
    Index(usize),
}

impl PointerSegment {
    fn render(&self) -> String {
        match self {
            Self::Declared(name) => name.replace('~', "~0").replace('/', "~1"),
            Self::UnknownKey(name) => {
                let digest = Sha256::digest(name.as_bytes());
                let hex = format!("{digest:x}");
                format!("<unknown>#{}", &hex[..12])
            }
            Self::Index(index) => index.to_string(),
        }
    }
}

/// Render a bounded RFC 6901 pointer under LLP 0108's segment/byte maxima.
fn bounded_pointer(segments: &[PointerSegment]) -> String {
    let mut pointer = String::new();
    for (position, segment) in segments.iter().enumerate() {
        if position >= MAX_POINTER_SEGMENTS {
            pointer.push_str(TRUNCATED_SEGMENT);
            return pointer;
        }
        let rendered = segment.render();
        if pointer.len() + 1 + rendered.len() + TRUNCATED_SEGMENT.len() > MAX_POINTER_BYTES
            && position + 1 < segments.len()
        {
            pointer.push_str(TRUNCATED_SEGMENT);
            return pointer;
        }
        if pointer.len() + 1 + rendered.len() > MAX_POINTER_BYTES {
            pointer.push_str(TRUNCATED_SEGMENT);
            return pointer;
        }
        pointer.push('/');
        pointer.push_str(&rendered);
    }
    pointer
}

/// A deterministic structural refusal: the failing pointer, the expected
/// node kind, and the actual JSON kind — never the rejected value.
struct ArgsViolation {
    pointer: String,
    expected: &'static str,
    actual: &'static str,
    failed_variants: Option<usize>,
    unknown_field: Option<UnknownFieldContext>,
    bound: Option<ArgsBoundViolation>,
}

#[derive(Clone, Copy)]
enum ArgsBoundViolation {
    Bytes {
        kind: &'static str,
        actual: usize,
        maximum: usize,
    },
    Items {
        kind: &'static str,
        actual: usize,
        maximum: usize,
    },
}

struct UnknownFieldContext {
    guessed: String,
    available: Vec<crate::manifest::ResultObjectFieldContract>,
}

impl ArgsViolation {
    fn at(segments: &[PointerSegment], expected: &'static str, actual: &'static str) -> Self {
        Self {
            pointer: bounded_pointer(segments),
            expected,
            actual,
            failed_variants: None,
            unknown_field: None,
            bound: None,
        }
    }

    fn with_byte_bound(mut self, kind: &'static str, actual: usize, maximum: usize) -> Self {
        self.bound = Some(ArgsBoundViolation::Bytes {
            kind,
            actual,
            maximum,
        });
        self
    }

    fn with_item_bound(mut self, kind: &'static str, actual: usize, maximum: usize) -> Self {
        self.bound = Some(ArgsBoundViolation::Items {
            kind,
            actual,
            maximum,
        });
        self
    }

    fn with_unknown_field(
        mut self,
        guessed: &str,
        available: &[crate::manifest::ResultObjectFieldContract],
    ) -> Self {
        self.unknown_field = Some(UnknownFieldContext {
            guessed: guessed.to_owned(),
            available: available.to_vec(),
        });
        self
    }
}

enum ArgsFailure {
    Shape(ArgsViolation),
    /// A `PlatformSchemaRef` delegation refusal carrying the referenced
    /// grammar's own public diagnostic (`SNAPBACK_SEARCH_QUERY_INVALID`).
    Delegated(Box<SnapbackError>),
}

impl From<ArgsViolation> for ArgsFailure {
    fn from(violation: ArgsViolation) -> Self {
        Self::Shape(violation)
    }
}

/// Validate one fresh invocation's arguments against the function's declared
/// argument contract. Functions from pre-LLP 0131 manifests carry no
/// descriptor and pass through unchanged (their lanes keep pre-v2 behavior).
pub fn validate_function_args(function: &FunctionDefinition, args: &Value) -> SnapbackResult<()> {
    let Some(contract) = &function.args_contract else {
        return Ok(());
    };
    if serde_json::to_vec(args).map_or(true, |bytes| bytes.len() > MAX_FUNCTION_ARGS_BYTES) {
        return Err(violation(
            function,
            ArgsViolation {
                pointer: String::new(),
                expected: "object",
                actual: "oversized",
                failed_variants: None,
                unknown_field: None,
                bound: None,
            },
        ));
    }
    match validate_args_root(args, contract) {
        Ok(()) => Ok(()),
        Err(ArgsFailure::Shape(shape)) => Err(violation(function, shape)),
        Err(ArgsFailure::Delegated(error)) => Err(*error),
    }
}

/// Run the shared recursive value-contract validator for one stored
/// structured field. The caller owns canonicalization and byte/row ceilings;
/// this seam owns the exact shape and RFC 6901 refusal pointer.
///
/// @ref LLP 0211#representation-and-write-path — stored values reuse CV-4a's
///   fail-closed recursive validator rather than growing a second runtime
///   grammar.
pub fn validate_stored_structured_value(
    table: &str,
    field: &str,
    contract_hash: &str,
    descriptor: &ResultValueContract,
    value: &Value,
) -> SnapbackResult<()> {
    let mut budget = 0_usize;
    match validate_node(value, descriptor, &[], 0, &mut budget) {
        Ok(()) => Ok(()),
        Err(ArgsFailure::Shape(shape)) => {
            let ArgsViolation {
                pointer,
                expected,
                actual,
                failed_variants,
                bound,
                ..
            } = shape;
            let mut details = json!({
                "table": table,
                "field": field,
                "fieldPath": format!("{table}.{field}{pointer}"),
                "contractHash": contract_hash,
                "path": pointer,
                "expected": expected,
                "actual": actual,
            });
            if let (Some(map), Some(failed)) = (details.as_object_mut(), failed_variants) {
                map.insert("failedVariants".to_owned(), json!(failed));
            }
            if let (Some(map), Some(bound)) = (details.as_object_mut(), bound) {
                add_bound_details(map, bound);
                map.insert(
                    "repair".to_owned(),
                    json!("shorten the bounded child value or represent the collection as bounded child rows/scalar columns; see guide/getting-started/your-first-backend.md#structured-stored-values"),
                );
                map.insert(
                    "guide".to_owned(),
                    json!("guide/getting-started/your-first-backend.md#structured-stored-values"),
                );
            }
            let message = if bound.is_some() {
                "stored structured value exceeds its declared child or collection bound"
            } else {
                "stored structured value does not satisfy its declared shape"
            };
            Err(
                SnapbackError::error("SNAPBACK_STRUCTURED_VALUE_INVALID", "storage", message)
                    .with_details(details),
            )
        }
        Err(ArgsFailure::Delegated(_)) => Err(SnapbackError::error(
            "SNAPBACK_STRUCTURED_CONTRACT_INVALID",
            "schema",
            "stored structured descriptors cannot delegate to platform schemas",
        )
        .with_details(json!({
            "table": table,
            "field": field,
            "contractHash": contract_hash,
        }))),
    }
}

/// Validate a capability-link argument template without inventing placeholder
/// values for fields the possessor will supply later. Pinned values are
/// checked at their exact declared nodes, every caller-supplied name must be a
/// declared root field, and every required field must be covered by one side.
/// The complete merged object still re-enters [`validate_function_args`] at
/// invocation time.
///
/// @ref LLP 0204#d94--shareable-capability-links — pinned and caller-supplied
/// arguments are one schema-validated template; pinned values win on merge.
pub fn validate_function_args_template(
    function: &FunctionDefinition,
    pinned_args: &Value,
    caller_args: &BTreeSet<String>,
) -> SnapbackResult<()> {
    let Some(contract) = &function.args_contract else {
        if caller_args.is_empty() {
            return validate_function_args(function, pinned_args);
        }
        return Err(SnapbackError::error(
            "SNAPBACK_CAPABILITY_LINK_ARGS_CONTRACT_REQUIRED",
            "capability-links",
            "callerArgs requires the function to publish an argsContract",
        ));
    };
    if serde_json::to_vec(pinned_args).map_or(true, |bytes| bytes.len() > MAX_FUNCTION_ARGS_BYTES) {
        return Err(violation(
            function,
            ArgsViolation {
                pointer: String::new(),
                expected: "object",
                actual: "oversized",
                failed_variants: None,
                unknown_field: None,
                bound: None,
            },
        ));
    }
    let empty = serde_json::Map::new();
    let pinned = match pinned_args {
        Value::Null => &empty,
        Value::Object(object) => object,
        other => {
            return Err(violation(
                function,
                ArgsViolation::at(&[], "object", json_kind(other)),
            ));
        }
    };
    let declared = contract
        .fields
        .iter()
        .map(|field| field.name.as_str())
        .collect::<BTreeSet<_>>();
    if let Some(name) = caller_args
        .iter()
        .find(|name| !declared.contains(name.as_str()))
    {
        return Err(violation(
            function,
            ArgsViolation::at(
                &[PointerSegment::UnknownKey(name.clone())],
                "declared argument",
                "undeclared",
            )
            .with_unknown_field(name, &contract.fields),
        ));
    }
    if let Some(name) = pinned.keys().find(|name| !declared.contains(name.as_str())) {
        return Err(violation(
            function,
            ArgsViolation::at(
                &[PointerSegment::UnknownKey(name.clone())],
                "declared argument",
                "undeclared",
            )
            .with_unknown_field(name, &contract.fields),
        ));
    }
    let mut budget = 0_usize;
    for field in &contract.fields {
        let path = vec![PointerSegment::Declared(field.name.clone())];
        match pinned.get(&field.name) {
            Some(value) => {
                validate_node(value, &field.value, &path, 0, &mut budget).map_err(|failure| {
                    match failure {
                        ArgsFailure::Shape(shape) => violation(function, shape),
                        ArgsFailure::Delegated(error) => *error,
                    }
                })?
            }
            None if field.required && !caller_args.contains(&field.name) => {
                return Err(violation(
                    function,
                    ArgsViolation::at(&path, node_kind(&field.value), "missing"),
                ));
            }
            None => {}
        }
    }
    Ok(())
}

fn validate_args_root(args: &Value, contract: &FunctionArgsContract) -> Result<(), ArgsFailure> {
    // An absent-args invocation arrives as JSON null (`HandlerInput::default`);
    // it is the empty args object. Everything else must be one closed object
    // — an empty declared root included (undeclared properties refuse).
    let empty = serde_json::Map::new();
    let object = match args {
        Value::Null => &empty,
        Value::Object(object) => object,
        other => {
            return Err(ArgsViolation::at(&[], "object", json_kind(other)).into());
        }
    };
    let declared = contract
        .fields
        .iter()
        .map(|field| field.name.as_str())
        .collect::<BTreeSet<_>>();
    // Closed root: undeclared properties refuse with the root-level pointer.
    if let Some(name) = object.keys().find(|name| !declared.contains(name.as_str())) {
        return Err(ArgsViolation::at(
            &[PointerSegment::UnknownKey(name.clone())],
            "declared argument",
            "undeclared",
        )
        .with_unknown_field(name, &contract.fields)
        .into());
    }
    let mut budget = 0_usize;
    for field in &contract.fields {
        let path = vec![PointerSegment::Declared(field.name.clone())];
        match object.get(&field.name) {
            Some(value) => validate_node(value, &field.value, &path, 0, &mut budget)?,
            None if field.required => {
                return Err(ArgsViolation::at(&path, node_kind(&field.value), "missing").into());
            }
            None => {}
        }
    }
    Ok(())
}

fn consume(budget: &mut usize, depth: usize, path: &[PointerSegment]) -> Result<(), ArgsFailure> {
    *budget = budget.saturating_add(1);
    if *budget > MAX_ARGS_NODES || depth > MAX_ARGS_DEPTH {
        return Err(ArgsViolation::at(path, "bounded value", "over-budget").into());
    }
    Ok(())
}

fn validate_node(
    value: &Value,
    contract: &ResultValueContract,
    path: &[PointerSegment],
    depth: usize,
    budget: &mut usize,
) -> Result<(), ArgsFailure> {
    consume(budget, depth, path)?;
    let mismatch =
        || -> ArgsFailure { ArgsViolation::at(path, node_kind(contract), json_kind(value)).into() };
    match contract {
        ResultValueContract::Null => value.is_null().then_some(()).ok_or_else(mismatch),
        ResultValueContract::Boolean => value.is_boolean().then_some(()).ok_or_else(mismatch),
        ResultValueContract::String { max_bytes } => {
            let Some(text) = value.as_str() else {
                return Err(mismatch());
            };
            if text.len() > *max_bytes {
                return Err(ArgsViolation::at(
                    path,
                    "string within declared maxBytes",
                    "oversized string",
                )
                .with_byte_bound("child", text.len(), *max_bytes)
                .into());
            }
            Ok(())
        }
        ResultValueContract::Integer { min, max } => value
            .as_i64()
            .filter(|number| number >= min && number <= max)
            .map(|_| ())
            .ok_or_else(mismatch),
        ResultValueContract::FiniteReal { min, max } => value
            .as_f64()
            .filter(|number| number.is_finite() && number >= min && number <= max)
            .map(|_| ())
            .ok_or_else(mismatch),
        ResultValueContract::Principal
        | ResultValueContract::AssetRef
        | ResultValueContract::Id { .. } => value
            .as_str()
            .filter(|text| !text.is_empty())
            .map(|_| ())
            .ok_or_else(mismatch),
        ResultValueContract::MediaRefV1 { .. } => Err(mismatch()),
        ResultValueContract::Literal { value: expected } => {
            (value == expected).then_some(()).ok_or_else(mismatch)
        }
        ResultValueContract::Json {
            max_depth,
            max_bytes,
        } => {
            let actual_bytes = serde_json::to_vec(value).map_or(usize::MAX, |bytes| bytes.len());
            if actual_bytes > *max_bytes {
                return Err(ArgsViolation::at(
                    path,
                    "json within declared maxBytes",
                    "oversized json",
                )
                .with_byte_bound("child", actual_bytes, *max_bytes)
                .into());
            }
            validate_json_budget(value, depth, *max_depth, path, budget)
        }
        ResultValueContract::Array { element, max_items } => {
            let values = value.as_array().ok_or_else(mismatch)?;
            if values.len() > *max_items {
                return Err(ArgsViolation::at(
                    path,
                    "array within declared maxItems",
                    "oversized array",
                )
                .with_item_bound("collection", values.len(), *max_items)
                .into());
            }
            for (index, value) in values.iter().enumerate() {
                let mut child = path.to_vec();
                child.push(PointerSegment::Index(index));
                validate_node(value, element, &child, depth + 1, budget)?;
            }
            Ok(())
        }
        ResultValueContract::Tuple { elements } => {
            let values = value.as_array().ok_or_else(mismatch)?;
            if values.len() != elements.len() {
                return Err(mismatch());
            }
            for (index, (value, element)) in values.iter().zip(elements).enumerate() {
                let mut child = path.to_vec();
                child.push(PointerSegment::Index(index));
                validate_node(value, element, &child, depth + 1, budget)?;
            }
            Ok(())
        }
        ResultValueContract::Vector { dimensions } => {
            let values = value.as_array().ok_or_else(mismatch)?;
            if values.len() != *dimensions as usize {
                return Err(mismatch());
            }
            for (index, value) in values.iter().enumerate() {
                let mut child = path.to_vec();
                child.push(PointerSegment::Index(index));
                consume(budget, depth + 1, &child)?;
                let Some(component) = value.as_f64() else {
                    return Err(mismatch());
                };
                if !component.is_finite()
                    || component.abs() > crate::vector::types::VECTOR_COMPONENT_ABS_MAX
                {
                    return Err(mismatch());
                }
            }
            Ok(())
        }
        // LLP 0108's union diagnostic rule: declaration order, first
        // deterministic failure wins — the refusal reports the first
        // variant's first failure plus the bounded count of failed variants.
        ResultValueContract::Union { variants } => {
            let mut first_failure: Option<ArgsViolation> = None;
            for variant in variants {
                let mut trial = *budget;
                match validate_node(value, variant, path, depth, &mut trial) {
                    Ok(()) => {
                        *budget = trial;
                        return Ok(());
                    }
                    Err(ArgsFailure::Shape(shape)) => {
                        if first_failure.is_none() {
                            first_failure = Some(shape);
                        }
                    }
                    Err(delegated @ ArgsFailure::Delegated(_)) => return Err(delegated),
                }
            }
            let mut failure =
                first_failure.unwrap_or_else(|| ArgsViolation::at(path, "union", json_kind(value)));
            failure.failed_variants = Some(variants.len());
            Err(failure.into())
        }
        ResultValueContract::Object {
            fields,
            allow_extra,
        } => {
            let object = value.as_object().ok_or_else(mismatch)?;
            let names = fields
                .iter()
                .map(|field| field.name.as_str())
                .collect::<BTreeSet<_>>();
            if !*allow_extra
                && let Some(name) = object.keys().find(|name| !names.contains(name.as_str()))
            {
                let mut child = path.to_vec();
                child.push(PointerSegment::UnknownKey(name.clone()));
                return Err(ArgsViolation::at(&child, "declared field", "undeclared")
                    .with_unknown_field(name, fields)
                    .into());
            }
            for field in fields {
                let mut child = path.to_vec();
                child.push(PointerSegment::Declared(field.name.clone()));
                match object.get(&field.name) {
                    Some(value) => validate_node(value, &field.value, &child, depth + 1, budget)?,
                    None if field.required => {
                        return Err(
                            ArgsViolation::at(&child, node_kind(&field.value), "missing").into(),
                        );
                    }
                    None => {}
                }
            }
            Ok(())
        }
        // @ref LLP 0131#diagnostics — node-scoped precedence: the owning
        // parser stays the single authority for a referenced grammar, and
        // its refusal keeps its own stable public code, upgraded with the
        // bounded pointer (argument-position prefix joined with the inner
        // parser path).
        ResultValueContract::PlatformSchemaRef { schema, .. } => {
            if schema == SCHEMA_REF_SEARCH_QUERY_AST_V1 {
                parse_search_query_ast(value, &bounded_pointer(path))
                    .map(|_| ())
                    .map_err(|error| ArgsFailure::Delegated(Box::new(error)))
            } else {
                // Unregistered ids are refused at manifest load; reaching one
                // here is a defect, refused fail-closed.
                Err(mismatch())
            }
        }
    }
}

fn validate_json_budget(
    value: &Value,
    depth: usize,
    max_depth: usize,
    path: &[PointerSegment],
    budget: &mut usize,
) -> Result<(), ArgsFailure> {
    if depth > max_depth {
        return Err(ArgsViolation::at(path, "bounded json", "over-depth").into());
    }
    match value {
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                let mut child = path.to_vec();
                child.push(PointerSegment::Index(index));
                consume(budget, depth + 1, &child)?;
                validate_json_budget(value, depth + 1, max_depth, &child, budget)?;
            }
        }
        Value::Object(object) => {
            for (name, value) in object {
                let mut child = path.to_vec();
                child.push(PointerSegment::UnknownKey(name.clone()));
                consume(budget, depth + 1, &child)?;
                validate_json_budget(value, depth + 1, max_depth, &child, budget)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Parse one search query AST value through the owning serde grammar,
/// carrying the failing bounded pointer (argument-position prefix joined
/// with the serde-reported inner path) instead of discarding the error.
pub fn parse_search_query_ast(value: &Value, prefix: &str) -> SnapbackResult<SearchQueryAstV1> {
    let deserializer = value.clone();
    serde_path_to_error::deserialize::<_, SearchQueryAstV1>(deserializer)
        .map_err(|error| search_query_invalid(prefix, error.path()))
}

/// Parse the complete `{query, limit?, after?}` search request through the
/// same path-carrying seam (`query_search_on`'s single-authority parse; the
/// pre-v2 lane for apps without a carried descriptor).
pub fn parse_search_request(args: &Value) -> SnapbackResult<SearchRequestV1> {
    let deserializer = args.clone();
    serde_path_to_error::deserialize::<_, SearchRequestV1>(deserializer)
        .map_err(|error| search_query_invalid("", error.path()))
}

fn search_query_invalid(prefix: &str, serde_path: &serde_path_to_error::Path) -> SnapbackError {
    let mut segments = Vec::new();
    for segment in serde_path.iter() {
        match segment {
            serde_path_to_error::Segment::Seq { index } => {
                segments.push(PointerSegment::Index(*index));
            }
            serde_path_to_error::Segment::Map { key } => {
                // Grammar-owned member names; app-controlled bytes cannot
                // appear here because the grammar's maps are closed structs.
                segments.push(PointerSegment::Declared(key.clone()));
            }
            serde_path_to_error::Segment::Enum { variant } => {
                segments.push(PointerSegment::Declared(variant.to_string()));
            }
            serde_path_to_error::Segment::Unknown => {
                segments.push(PointerSegment::Declared("<unknown>".to_owned()));
            }
        }
    }
    let inner = bounded_pointer(&segments);
    let pointer = format!("{prefix}{inner}");
    // The pointer is structural; the serde message itself can echo values,
    // so only the pointer is carried (LLP 0108's redaction rule).
    SnapbackError::error(
        "SNAPBACK_SEARCH_QUERY_INVALID",
        "search",
        "search arguments must be {query, limit?, after?} with a well-formed query AST",
    )
    .with_details(json!({ "path": pointer }))
}

fn json_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn node_kind(contract: &ResultValueContract) -> &'static str {
    match contract {
        ResultValueContract::Null => "null",
        ResultValueContract::Boolean => "boolean",
        ResultValueContract::String { .. } => "string",
        ResultValueContract::Integer { .. } => "integer",
        ResultValueContract::FiniteReal { .. } => "finiteReal",
        ResultValueContract::Principal => "principal",
        ResultValueContract::AssetRef => "assetRef",
        ResultValueContract::MediaRefV1 { .. } => "mediaRef.v1",
        ResultValueContract::Id { .. } => "id",
        ResultValueContract::Literal { .. } => "literal",
        ResultValueContract::Json { .. } => "json",
        ResultValueContract::Array { .. } => "array",
        ResultValueContract::Tuple { .. } => "tuple",
        ResultValueContract::Vector { .. } => "vector",
        ResultValueContract::Union { .. } => "union",
        ResultValueContract::Object { .. } => "object",
        ResultValueContract::PlatformSchemaRef { .. } => "platformSchemaRef",
    }
}

fn violation(function: &FunctionDefinition, shape: ArgsViolation) -> SnapbackError {
    let ArgsViolation {
        pointer,
        expected,
        actual,
        failed_variants,
        unknown_field,
        bound,
    } = shape;
    let mut details = json!({
        "functionId": function.id,
        "kind": function.kind,
        "argsContractHash": function.args_contract_hash,
        "path": pointer,
        "expected": expected,
        "actual": actual,
    });
    if let (Some(map), Some(failed)) = (details.as_object_mut(), failed_variants) {
        map.insert("failedVariants".to_owned(), json!(failed));
    }
    if let (Some(map), Some(bound)) = (details.as_object_mut(), bound) {
        add_bound_details(map, bound);
    }
    if let Some(map) = details.as_object_mut() {
        let unknown_field = unknown_field
            .as_ref()
            .map(|unknown| (unknown.guessed.as_str(), unknown.available.as_slice()));
        crate::authoring_suggestion::enrich_argument_details(map, function, unknown_field);
    }
    SnapbackError::error(
        "SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION",
        "runtime",
        "the function was invoked with arguments outside its served contract",
    )
    .with_details(details)
}

fn add_bound_details(details: &mut serde_json::Map<String, Value>, bound: ArgsBoundViolation) {
    match bound {
        ArgsBoundViolation::Bytes {
            kind,
            actual,
            maximum,
        } => {
            details.insert("boundKind".to_owned(), json!(kind));
            details.insert("actualBytes".to_owned(), json!(actual));
            details.insert("maxBytes".to_owned(), json!(maximum));
        }
        ArgsBoundViolation::Items {
            kind,
            actual,
            maximum,
        } => {
            details.insert("boundKind".to_owned(), json!(kind));
            details.insert("actualItems".to_owned(), json!(actual));
            details.insert("maxItems".to_owned(), json!(maximum));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{
        FunctionKind, FunctionRuntime, HandlerPlan, MutationPlan, ResultObjectFieldContract,
        SchemaRefAuthority, args_contract_hash,
    };

    fn function(contract: FunctionArgsContract) -> FunctionDefinition {
        let mut function = FunctionDefinition::new(
            "recordSplit",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                owner_write_checks: Vec::new(),
                steps: Vec::new(),
                return_value: None,
            })),
        );
        function.args_contract_hash = Some(args_contract_hash(&contract).expect("hash"));
        function.args_contract = Some(contract);
        function
    }

    fn field(name: &str, required: bool, value: ResultValueContract) -> ResultObjectFieldContract {
        ResultObjectFieldContract {
            name: name.to_owned(),
            required,
            value,
        }
    }

    fn split_vector_contract() -> FunctionArgsContract {
        // The Split-Ledger shape: `splits: v.array(v.object({...}), {maxItems})`.
        FunctionArgsContract {
            fields: vec![
                field(
                    "note",
                    false,
                    ResultValueContract::String { max_bytes: 256 },
                ),
                field(
                    "splits",
                    true,
                    ResultValueContract::Array {
                        max_items: 16,
                        element: Box::new(ResultValueContract::Object {
                            allow_extra: false,
                            fields: vec![
                                field(
                                    "participant",
                                    true,
                                    ResultValueContract::String { max_bytes: 64 },
                                ),
                                field(
                                    "amountCents",
                                    true,
                                    ResultValueContract::Integer {
                                        min: 0,
                                        max: 9_007_199_254_740_991,
                                    },
                                ),
                            ],
                        }),
                    },
                ),
            ],
        }
    }

    #[test]
    fn valid_split_vector_passes() {
        let function = function(split_vector_contract());
        validate_function_args(
            &function,
            &json!({
                "splits": [
                    { "participant": "ada", "amountCents": 1250 },
                    { "participant": "grace", "amountCents": 750 },
                ],
            }),
        )
        .expect("valid nested vector");
    }

    #[test]
    fn capability_link_template_splits_required_fields_and_validates_pins() {
        let function = function(split_vector_contract());
        validate_function_args_template(
            &function,
            &json!({ "note": "pinned" }),
            &BTreeSet::from(["splits".to_owned(), "note".to_owned()]),
        )
        .expect("caller subset covers the required unpinned field");
        let missing = validate_function_args_template(
            &function,
            &json!({ "note": "pinned" }),
            &BTreeSet::new(),
        )
        .expect_err("required field must be pinned or caller-supplied");
        assert_eq!(missing.diagnostic.details["path"], "/splits");
        let invalid_pin = validate_function_args_template(
            &function,
            &json!({ "note": 42 }),
            &BTreeSet::from(["splits".to_owned()]),
        )
        .expect_err("pinned values enter their declared node validator");
        assert_eq!(invalid_pin.diagnostic.details["path"], "/note");
    }

    #[test]
    fn capability_link_caller_subset_requires_a_published_contract() {
        let mut legacy = function(split_vector_contract());
        legacy.args_contract = None;
        let error = validate_function_args_template(
            &legacy,
            &json!({}),
            &BTreeSet::from(["splits".to_owned()]),
        )
        .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CAPABILITY_LINK_ARGS_CONTRACT_REQUIRED"
        );
    }

    #[test]
    fn exact_vector_argument_admits_only_d_finite_bounded_components() {
        let function = function(FunctionArgsContract {
            fields: vec![field(
                "vector",
                true,
                ResultValueContract::Vector { dimensions: 3 },
            )],
        });
        validate_function_args(&function, &json!({ "vector": [0.0, -0.0, 3.5] }))
            .expect("exact D passes");
        for rejected in [
            json!({ "vector": [0.0, 1.0] }),
            json!({ "vector": [0.0, 1.0, 2.0, 3.0] }),
            json!({ "vector": [0.0, 1.0, crate::vector::types::VECTOR_COMPONENT_ABS_MAX * 2.0] }),
        ] {
            let error = validate_function_args(&function, &rejected)
                .expect_err("D-1, D+1, and out-of-domain components refuse");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION"
            );
            assert_eq!(error.diagnostic.details["path"], "/vector");
            assert_eq!(error.diagnostic.details["expected"], "vector");
        }
    }

    #[test]
    fn nested_vectors_debit_every_component_from_argument_node_budget() {
        let function = function(FunctionArgsContract {
            fields: vec![field(
                "vectors",
                true,
                ResultValueContract::Array {
                    element: Box::new(ResultValueContract::Vector { dimensions: 64 }),
                    max_items: 1_024,
                },
            )],
        });
        let vectors = vec![Value::Array(vec![json!(0.0); 64]); 1_024];
        let error = validate_function_args(&function, &json!({ "vectors": vectors }))
            .expect_err("vector components must not bypass the global node budget");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION"
        );
        assert_eq!(error.diagnostic.details["actual"], "over-budget");
    }

    #[test]
    fn wrong_kind_nested_element_refuses_with_exact_pointer() {
        let function = function(split_vector_contract());
        let error = validate_function_args(
            &function,
            &json!({
                "splits": [
                    { "participant": "ada", "amountCents": 1250 },
                    { "participant": "grace", "amountCents": 750 },
                    { "participant": "alan", "amountCents": "not-a-number" },
                ],
            }),
        )
        .expect_err("wrong-kind nested element");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION"
        );
        let details = &error.diagnostic.details;
        assert_eq!(details["path"], "/splits/2/amountCents");
        assert_eq!(details["expected"], "integer");
        assert_eq!(details["actual"], "string");
        assert!(
            !serde_json::to_string(&error.diagnostic)
                .expect("diagnostic serializes")
                .contains("not-a-number"),
            "diagnostics must not echo the rejected value"
        );
    }

    #[test]
    fn undeclared_root_property_refuses_with_hashed_unknown_key() {
        let function = function(split_vector_contract());
        let mut error = None;
        for _ in 0..3 {
            error = Some(
                validate_function_args(&function, &json!({ "splits": [], "extra": true }))
                    .expect_err("undeclared root property"),
            );
        }
        let error = error.expect("three refusals produce a final diagnostic");
        let details = &error.diagnostic.details;
        let path = details["path"].as_str().expect("path");
        assert!(
            path.starts_with("/<unknown>#"),
            "unknown application-controlled keys are hashed, got {path}"
        );
        assert_eq!(details["actual"], "undeclared");
        let splits = details["candidateFields"]
            .as_array()
            .unwrap()
            .iter()
            .find(|candidate| candidate["name"] == "splits")
            .expect("served split field is suggested");
        assert_eq!(splits["expected"], "array");
        assert_eq!(
            details["artifactHash"],
            function.args_contract_hash.as_deref().unwrap()
        );
        assert_eq!(
            details["expectedArgumentContract"],
            serde_json::to_value(function.args_contract.as_ref().unwrap()).unwrap()
        );
        assert!(
            details["localMissSummary"]["sameMissCount"]
                .as_u64()
                .unwrap()
                >= 3
        );
        assert_eq!(details["localMissSummary"]["capacity"], 128);
        assert!(
            !serde_json::to_string(&error.diagnostic)
                .expect("diagnostic serializes")
                .contains("extra"),
            "the rejected field name must not be disclosed"
        );
    }

    #[test]
    fn empty_declared_root_still_refuses_undeclared_properties() {
        let function = function(FunctionArgsContract { fields: Vec::new() });
        validate_function_args(&function, &json!({})).expect("empty root");
        validate_function_args(&function, &Value::Null).expect("absent args");
        let error = validate_function_args(&function, &json!({ "anything": 1 }))
            .expect_err("undeclared property against the empty root");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION"
        );
    }

    #[test]
    fn missing_required_argument_refuses() {
        let function = function(split_vector_contract());
        let error =
            validate_function_args(&function, &json!({})).expect_err("missing required arg");
        let details = &error.diagnostic.details;
        assert_eq!(details["path"], "/splits");
        assert_eq!(details["actual"], "missing");
    }

    #[test]
    fn scalar_evidence_addition_refuses_wrong_kind_scalar() {
        // A pre-existing scalar-args shape: this refusal demonstrably did not
        // occur before the ingress seam existed (LLP 0117 finding 4).
        let function = function(FunctionArgsContract {
            fields: vec![field(
                "title",
                true,
                ResultValueContract::String { max_bytes: 256 },
            )],
        });
        let error = validate_function_args(&function, &json!({ "title": 42 }))
            .expect_err("wrong-kind scalar");
        let details = &error.diagnostic.details;
        assert_eq!(details["path"], "/title");
        assert_eq!(details["expected"], "string");
        assert_eq!(details["actual"], "number");
        assert_eq!(details["candidateFields"][0]["name"], "title");
        assert_eq!(details["candidateFields"][0]["expected"], "string");
        assert!(details["expectedArgumentContract"].is_object());
    }

    #[test]
    fn declared_bounds_replace_same_kind_expected_actual_pairs_with_measured_facts() {
        let function = function(FunctionArgsContract {
            fields: vec![
                field("title", true, ResultValueContract::String { max_bytes: 3 }),
                field(
                    "tags",
                    true,
                    ResultValueContract::Array {
                        element: Box::new(ResultValueContract::String { max_bytes: 8 }),
                        max_items: 1,
                    },
                ),
            ],
        });
        let bytes = validate_function_args(&function, &json!({ "title": "four", "tags": [] }))
            .expect_err("string byte bound refuses");
        assert_eq!(
            bytes.diagnostic.details["expected"],
            "string within declared maxBytes"
        );
        assert_eq!(bytes.diagnostic.details["actual"], "oversized string");
        assert_eq!(bytes.diagnostic.details["boundKind"], "child");
        assert_eq!(bytes.diagnostic.details["actualBytes"], 4);
        assert_eq!(bytes.diagnostic.details["maxBytes"], 3);

        let items =
            validate_function_args(&function, &json!({ "title": "ok", "tags": ["one", "two"] }))
                .expect_err("array item bound refuses");
        assert_eq!(
            items.diagnostic.details["expected"],
            "array within declared maxItems"
        );
        assert_eq!(items.diagnostic.details["actual"], "oversized array");
        assert_eq!(items.diagnostic.details["boundKind"], "collection");
        assert_eq!(items.diagnostic.details["actualItems"], 2);
        assert_eq!(items.diagnostic.details["maxItems"], 1);
    }

    #[test]
    fn command_mutation_asset_ref_argument_admits_only_nonempty_ids() {
        let function = function(FunctionArgsContract {
            fields: vec![field("image", true, ResultValueContract::AssetRef)],
        });
        validate_function_args(&function, &json!({ "image": "asset-1" })).expect("opaque asset id");
        for rejected in [json!({ "image": "" }), json!({ "image": 42 })] {
            let error = validate_function_args(&function, &rejected)
                .expect_err("empty or non-string asset refs refuse");
            assert_eq!(error.diagnostic.details["path"], "/image");
            assert_eq!(error.diagnostic.details["expected"], "assetRef");
        }
    }

    #[test]
    fn null_args_are_the_empty_object() {
        let optional_only = function(FunctionArgsContract {
            fields: vec![field(
                "limit",
                false,
                ResultValueContract::Integer { min: 1, max: 50 },
            )],
        });
        validate_function_args(&optional_only, &Value::Null).expect("absent args");
        let required = function(split_vector_contract());
        validate_function_args(&required, &Value::Null).expect_err("missing required");
    }

    // @ref LLP 0131#ruling-2-item-2--explicit-null-optionals-canonical-form-projection
    // — optionality admits omission, not null outside the inner contract.
    #[test]
    fn optional_non_null_argument_refuses_explicit_null() {
        let function = function(FunctionArgsContract {
            fields: vec![field(
                "limit",
                false,
                ResultValueContract::Integer { min: 1, max: 50 },
            )],
        });
        let error = validate_function_args(&function, &json!({ "limit": null }))
            .expect_err("explicit null is not an omitted optional integer");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION"
        );
        assert_eq!(error.diagnostic.details["path"], "/limit");
        assert_eq!(error.diagnostic.details["expected"], "integer");
        assert_eq!(error.diagnostic.details["actual"], "null");
    }

    #[test]
    fn legacy_function_without_descriptor_passes_through() {
        let mut legacy = function(split_vector_contract());
        legacy.args_contract = None;
        validate_function_args(&legacy, &json!({ "anything": ["goes"] }))
            .expect("pre-v2 manifests keep their behavior until regenerated");
    }

    #[test]
    fn platform_schema_ref_argument_delegates_with_owner_code_and_pointer() {
        let contract = FunctionArgsContract {
            fields: vec![field(
                "query",
                true,
                ResultValueContract::PlatformSchemaRef {
                    authority: SchemaRefAuthority::Platform,
                    schema: SCHEMA_REF_SEARCH_QUERY_AST_V1.to_owned(),
                },
            )],
        };
        let function = function(contract);
        validate_function_args(
            &function,
            &json!({ "query": { "all": [ { "Term": { "value": "hello" } } ] } }),
        )
        .expect("well-formed AST");
        let error = validate_function_args(
            &function,
            &json!({ "query": { "all": [ { "Term": { "value": "hello", "nope": 1 } } ] } }),
        )
        .expect_err("unknown atom field refuses");
        // Node-scoped precedence: the delegated node keeps the owning
        // parser's stable public code, with the /query pointer prefix.
        assert_eq!(error.diagnostic.code, "SNAPBACK_SEARCH_QUERY_INVALID");
        let details = &error.diagnostic.details;
        let path = details["path"].as_str().expect("path");
        assert!(
            path.starts_with("/query"),
            "delegated refusal carries the argument-position pointer prefix: {path}"
        );
    }

    #[test]
    fn search_scalar_bounds_refuse_with_the_generic_code_for_v2_apps() {
        // The recorded LLP 0073 consequence: under the seam, search's scalar
        // limit/after refusals carry the generic args code, while pre-v2
        // apps (no descriptor) keep SNAPBACK_SEARCH_QUERY_INVALID through
        // query_search_on's unchanged checks.
        let contract = FunctionArgsContract {
            fields: vec![
                field(
                    "query",
                    true,
                    ResultValueContract::PlatformSchemaRef {
                        authority: SchemaRefAuthority::Platform,
                        schema: SCHEMA_REF_SEARCH_QUERY_AST_V1.to_owned(),
                    },
                ),
                field(
                    "limit",
                    false,
                    ResultValueContract::Integer { min: 1, max: 50 },
                ),
                field(
                    "after",
                    false,
                    ResultValueContract::String { max_bytes: 2_048 },
                ),
            ],
        };
        let function = function(contract);
        let error =
            validate_function_args(&function, &json!({ "query": { "all": [] }, "limit": 0 }))
                .expect_err("limit below bound");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION"
        );
        assert_eq!(error.diagnostic.details["path"], "/limit");
    }

    #[test]
    fn union_reports_first_variant_failure_and_failed_count() {
        let contract = FunctionArgsContract {
            fields: vec![field(
                "mode",
                true,
                ResultValueContract::Union {
                    variants: vec![
                        ResultValueContract::Literal {
                            value: json!("even"),
                        },
                        ResultValueContract::Literal {
                            value: json!("manual"),
                        },
                    ],
                },
            )],
        };
        let function = function(contract);
        validate_function_args(&function, &json!({ "mode": "even" })).expect("literal variant");
        let error = validate_function_args(&function, &json!({ "mode": "thirds" }))
            .expect_err("outside the union");
        let details = &error.diagnostic.details;
        assert_eq!(details["path"], "/mode");
        assert_eq!(details["expected"], "literal");
        assert_eq!(details["failedVariants"], 2);
    }

    #[test]
    fn v2_witness_agrees_with_the_javascript_golden() {
        // Cross-language canonical-form golden (LLP 0131 acceptance 7): the
        // same descriptor must hash identically under Rust JCS and the JS
        // generator's canonicalization. The pinned value is the
        // `every-node-kind` golden in
        // packages/snapback-codegen/args-contract-goldens.test.mjs.
        let contract: FunctionArgsContract = serde_json::from_value(json!({
            "fields": [
                { "name": "title", "required": true, "value": { "kind": "string", "maxBytes": 128 } },
                { "name": "done", "required": true, "value": { "kind": "boolean" } },
                { "name": "count", "required": true, "value": { "kind": "integer", "min": 0, "max": 100 } },
                { "name": "ratio", "required": true, "value": { "kind": "finiteReal", "min": -1.5, "max": 1.5 } },
                { "name": "owner", "required": true, "value": { "kind": "principal" } },
                { "name": "row", "required": true, "value": { "kind": "id", "table": "rows" } },
                { "name": "mode", "required": true, "value": { "kind": "union", "variants": [
                    { "kind": "literal", "value": "even" },
                    { "kind": "literal", "value": "manual" },
                ] } },
                { "name": "zero", "required": true, "value": { "kind": "literal", "value": 0.5 } },
                { "name": "nothing", "required": true, "value": { "kind": "null" } },
                { "name": "blob", "required": true, "value": { "kind": "json", "maxDepth": 4, "maxBytes": 1024 } },
                { "name": "splits", "required": true, "value": { "kind": "array", "maxItems": 16, "element": {
                    "kind": "object", "allowExtra": false, "fields": [
                        { "name": "participant", "required": true, "value": { "kind": "string", "maxBytes": 1048576 } },
                        { "name": "amountCents", "required": true, "value": { "kind": "integer", "min": -9007199254740991_i64, "max": 9007199254740991_i64 } },
                        { "name": "note", "required": false, "value": { "kind": "string", "maxBytes": 64 } },
                    ],
                } } },
            ],
        }))
        .expect("golden descriptor deserializes");
        assert_eq!(
            args_contract_hash(&contract).expect("hash"),
            "sha256:ff03e0c25f4b4d847a149ba49cc2e648fe496fdc292f67ce98ebcd5a336057d7",
        );
        assert_eq!(
            args_contract_hash(&FunctionArgsContract { fields: Vec::new() }).expect("hash"),
            "sha256:2ed03ebf770f260ecd637e5f3309b67cf21119731f97265c55332273c25272ac",
        );
    }

    #[test]
    fn pointer_truncation_bounds_deep_paths() {
        let segments: Vec<PointerSegment> = (0..40).map(PointerSegment::Index).collect();
        let pointer = bounded_pointer(&segments);
        assert!(pointer.ends_with(TRUNCATED_SEGMENT));
        assert!(pointer.len() <= MAX_POINTER_BYTES + TRUNCATED_SEGMENT.len());
    }

    /// LLP 0131 acceptance 12 — the preregistered hot-path budget on the
    /// reference profile (release build, native evaluator, Apple
    /// M-series-class hardware): added per-invocation ingress latency p95 ≤
    /// 100 µs for the scalar profile, ≤ 1 ms for the 64 KiB structured
    /// profile, and the 1 MiB complete-args ceiling is admitted only if a
    /// 1 MiB payload validates at p95 ≤ 16 ms. Ignored by default (a debug
    /// build is not the reference profile); run with
    /// `cargo test --release --lib args_contract_hot_path -- --ignored`.
    #[test]
    #[ignore = "reference-profile benchmark; run in release per LLP 0131 acceptance 12"]
    fn args_contract_hot_path_budget() {
        let p95 = |function: &FunctionDefinition, args: &Value| -> std::time::Duration {
            let mut samples = Vec::with_capacity(512);
            for _ in 0..512 {
                let started = std::time::Instant::now();
                validate_function_args(function, args).expect("benchmark payload validates");
                samples.push(started.elapsed());
            }
            samples.sort();
            samples[(samples.len() * 95) / 100]
        };

        let scalar = function(FunctionArgsContract {
            fields: vec![
                field("a", true, ResultValueContract::String { max_bytes: 256 }),
                field(
                    "b",
                    true,
                    ResultValueContract::Integer {
                        min: 0,
                        max: 1_000_000,
                    },
                ),
                field("c", true, ResultValueContract::Boolean),
                field(
                    "d",
                    true,
                    ResultValueContract::FiniteReal {
                        min: -1.0e9,
                        max: 1.0e9,
                    },
                ),
                field("e", false, ResultValueContract::String { max_bytes: 64 }),
            ],
        });
        let scalar_args = json!({ "a": "hello", "b": 42, "c": true, "d": 3.5, "e": "x" });
        let scalar_p95 = p95(&scalar, &scalar_args);

        // Structured profile: an array of padded objects nested under seven
        // wrapper objects (total depth ≥ 8 per the preregistered profile).
        let element = ResultValueContract::Object {
            allow_extra: false,
            fields: vec![
                field(
                    "participant",
                    true,
                    ResultValueContract::String { max_bytes: 64 },
                ),
                field(
                    "amountCents",
                    true,
                    ResultValueContract::Integer {
                        min: 0,
                        max: 9_007_199_254_740_991,
                    },
                ),
                field(
                    "memo",
                    false,
                    ResultValueContract::String {
                        max_bytes: 1024 * 1024,
                    },
                ),
            ],
        };
        let mut nested_node = ResultValueContract::Array {
            max_items: 1_024,
            element: Box::new(element),
        };
        for _ in 0..7 {
            nested_node = ResultValueContract::Object {
                allow_extra: false,
                fields: vec![field("nest", true, nested_node)],
            };
        }
        let wide = function(FunctionArgsContract {
            fields: vec![field("payload", true, nested_node)],
        });
        let structured_args = |count: usize, memo_bytes: usize| -> Value {
            let memo = "x".repeat(memo_bytes);
            let splits = (0..count)
                .map(|_| json!({ "participant": "participant-name", "amountCents": 1250, "memo": memo }))
                .collect::<Vec<_>>();
            let mut nested = Value::Array(splits);
            for _ in 0..7 {
                nested = json!({ "nest": nested });
            }
            json!({ "payload": nested })
        };
        // ~100 bytes/element × 640 ≈ 64 KiB; ~2 KiB/element × 512 ≈ 1 MiB.
        let structured_p95 = p95(&wide, &structured_args(640, 48));
        let ceiling_p95 = p95(&wide, &structured_args(500, 2000));

        eprintln!(
            "args ingress p95 — scalar: {scalar_p95:?}, 64KiB structured: {structured_p95:?}, ~1MiB: {ceiling_p95:?}"
        );
        assert!(
            scalar_p95 <= std::time::Duration::from_micros(100),
            "scalar profile exceeded 100µs: {scalar_p95:?}"
        );
        assert!(
            structured_p95 <= std::time::Duration::from_millis(1),
            "64 KiB structured profile exceeded 1ms: {structured_p95:?}"
        );
        assert!(
            ceiling_p95 <= std::time::Duration::from_millis(16),
            "1 MiB ceiling profile exceeded 16ms: {ceiling_p95:?}"
        );
    }
}
