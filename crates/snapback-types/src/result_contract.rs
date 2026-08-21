use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{
    FunctionDefinition, FunctionResultContract, ResultObjectFieldContract, ResultValueContract,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

/// Every handler result, including an `unknown` compatibility result, is
/// bounded before it can be published or committed.
///
/// @ref LLP 0108#final-author-reconciliation-after-round-3 — the Rust host
/// validates the post-JSON value; mutations are checked while effects are
/// still buffered.
pub const MAX_HANDLER_RESULT_BYTES: usize = 4 * 1024 * 1024;
const MAX_RESULT_NODES: usize = 65_536;
const MAX_RESULT_DEPTH: usize = 16;

const MAX_RESULT_BYTES: &str = "maxResultBytes";
const SERIALIZE: &str = "serialize";
const TYPE: &str = "type";
const LITERAL: &str = "literal";
const RANGE: &str = "range";
const MAX_BYTES: &str = "maxBytes";
const MAX_DEPTH: &str = "maxDepth";
const NODE_BUDGET: &str = "nodeBudget";
const MAX_ITEMS: &str = "maxItems";
const MIN_ITEMS: &str = "minItems";
const ARITY: &str = "arity";
const DIMENSIONS: &str = "dimensions";
const REQUIRED_FIELD: &str = "requiredField";
const EXTRA_FIELD: &str = "extraField";
const UNION: &str = "union";

/// A result-contract failure with a closed, value-free constraint vocabulary:
/// `maxResultBytes`, `serialize`, `type`, `literal`, `range`, `maxBytes`,
/// `maxDepth`, `nodeBudget`, `maxItems`, `minItems`, `arity`, `dimensions`,
/// `requiredField`, `extraField`, and `union`. Measurements are aggregate
/// sizes, counts, depths, or budgets only; rejected scalar values never appear.
///
/// @ref LLP 0108#diagnostics — public constraint names are closed and
/// value-free by design, including their optional measurements.
#[derive(Debug)]
struct Violation {
    path: String,
    constraint: &'static str,
    limit: Option<u64>,
    observed: Option<u64>,
}

impl Violation {
    fn at(path: impl Into<String>, constraint: &'static str) -> Self {
        Self {
            path: path.into(),
            constraint,
            limit: None,
            observed: None,
        }
    }

    fn bound(
        path: impl Into<String>,
        constraint: &'static str,
        limit: usize,
        observed: usize,
    ) -> Self {
        Self {
            path: path.into(),
            constraint,
            limit: Some(limit as u64),
            observed: Some(observed as u64),
        }
    }
}

pub fn validate_handler_result(function: &FunctionDefinition, value: &Value) -> SnapbackResult<()> {
    validate_handler_result_contract(
        &function.id,
        function.result_contract_hash.as_deref(),
        &function.result_contract,
        value,
    )
}

/// Validate a result when the commit boundary carries only the frozen result
/// contract identity rather than the complete executable function record.
pub fn validate_handler_result_contract(
    function_id: &str,
    result_contract_hash: Option<&str>,
    result_contract: &FunctionResultContract,
    value: &Value,
) -> SnapbackResult<()> {
    let bytes = serde_json::to_vec(value).map_err(|_| {
        violation(
            function_id,
            result_contract_hash,
            Violation::at("$", SERIALIZE),
        )
    })?;
    if bytes.len() > MAX_HANDLER_RESULT_BYTES {
        return Err(violation(
            function_id,
            result_contract_hash,
            Violation::bound("$", MAX_RESULT_BYTES, MAX_HANDLER_RESULT_BYTES, bytes.len()),
        ));
    }
    let mut budget = ValidationBudget { nodes: 0 };
    match result_contract {
        FunctionResultContract::Unknown => validate_json_budget(value, 0, &mut budget),
        FunctionResultContract::Documents { document, .. } => {
            validate_rows(value, document, None, &mut budget)
        }
        FunctionResultContract::Records { record, rows } => {
            validate_rows(value, record, rows.as_ref(), &mut budget)
        }
        FunctionResultContract::LegacyQueryRowsV0 { row } => {
            validate_rows(value, row, None, &mut budget)
        }
        FunctionResultContract::Document { document, .. } => {
            validate_value(value, document, "$", 0, &mut budget)
        }
        FunctionResultContract::Value { value: contract } => {
            validate_value(value, contract, "$", 0, &mut budget)
        }
    }
    .map_err(|failure| violation(function_id, result_contract_hash, failure))
}

/// Query transport and live-diff machinery remain row-oriented. A declared
/// single-value query therefore carries exactly one internal row, while its
/// authored result contract still validates the scalar value itself.
///
/// @ref LLP 0108#query-single-value-egress--2026-08-15 — the one-row carrier
/// is an internal compatibility envelope, not part of the authored result.
pub fn validate_query_handler_result(
    function: &FunctionDefinition,
    rows: &[Value],
) -> SnapbackResult<()> {
    if matches!(
        function.result_contract,
        FunctionResultContract::Document { .. } | FunctionResultContract::Value { .. }
    ) {
        if rows.len() != 1 {
            return Err(violation(
                &function.id,
                function.result_contract_hash.as_deref(),
                Violation::bound("$", ARITY, 1, rows.len()),
            ));
        }
        return validate_handler_result(function, &rows[0]);
    }
    validate_handler_result(function, &Value::Array(rows.to_vec()))
}

fn validate_rows(
    value: &Value,
    row: &ResultValueContract,
    bound: Option<&crate::manifest::ResultRowsBound>,
    budget: &mut ValidationBudget,
) -> Result<(), Violation> {
    let rows = value.as_array().ok_or_else(|| Violation::at("$", TYPE))?;
    if let Some(bound) = bound {
        if rows.len() < bound.min_items {
            return Err(Violation::bound(
                "$",
                MIN_ITEMS,
                bound.min_items,
                rows.len(),
            ));
        }
        if rows.len() > bound.max_items {
            return Err(Violation::bound(
                "$",
                MAX_ITEMS,
                bound.max_items,
                rows.len(),
            ));
        }
    }
    for (index, value) in rows.iter().enumerate() {
        validate_value(value, row, &format!("$[{index}]"), 1, budget)?;
    }
    Ok(())
}

struct ValidationBudget {
    nodes: usize,
}

fn consume(budget: &mut ValidationBudget, depth: usize, path: &str) -> Result<(), Violation> {
    budget.nodes = budget.nodes.saturating_add(1);
    if budget.nodes > MAX_RESULT_NODES {
        return Err(Violation::bound(
            path,
            NODE_BUDGET,
            MAX_RESULT_NODES,
            budget.nodes,
        ));
    }
    if depth > MAX_RESULT_DEPTH {
        return Err(Violation::bound(path, MAX_DEPTH, MAX_RESULT_DEPTH, depth));
    }
    Ok(())
}

fn validate_value(
    value: &Value,
    contract: &ResultValueContract,
    path: &str,
    depth: usize,
    budget: &mut ValidationBudget,
) -> Result<(), Violation> {
    consume(budget, depth, path)?;
    match contract {
        ResultValueContract::Null if value.is_null() => Ok(()),
        ResultValueContract::Boolean if value.is_boolean() => Ok(()),
        ResultValueContract::String { max_bytes } => {
            let text = value.as_str().ok_or_else(|| Violation::at(path, TYPE))?;
            if text.len() > *max_bytes {
                return Err(Violation::bound(path, MAX_BYTES, *max_bytes, text.len()));
            }
            Ok(())
        }
        ResultValueContract::Integer { min, max } => {
            let Some(number) = value.as_number() else {
                return Err(Violation::at(path, TYPE));
            };
            if let Some(number) = number.as_i64() {
                if number < *min || number > *max {
                    return Err(Violation::at(path, RANGE));
                }
                return Ok(());
            }
            Err(Violation::at(
                path,
                if number.is_u64() { RANGE } else { TYPE },
            ))
        }
        ResultValueContract::FiniteReal { min, max } => {
            let number = value.as_f64().ok_or_else(|| Violation::at(path, TYPE))?;
            if !number.is_finite() || number < *min || number > *max {
                return Err(Violation::at(path, RANGE));
            }
            Ok(())
        }
        ResultValueContract::Principal
        | ResultValueContract::AssetRef
        | ResultValueContract::Id { .. } => value
            .as_str()
            .filter(|text| !text.is_empty())
            .map(|_| ())
            .ok_or_else(|| Violation::at(path, TYPE)),
        ResultValueContract::MediaRefV1 { kinds, .. } => {
            let object = value.as_object().ok_or_else(|| Violation::at(path, TYPE))?;
            if object.len() != 2 {
                return Err(Violation::at(path, TYPE));
            }
            object
                .get("assetId")
                .and_then(Value::as_str)
                .filter(|asset_id| !asset_id.is_empty())
                .ok_or_else(|| Violation::at(path, TYPE))?;
            let kind = object
                .get("kind")
                .and_then(Value::as_str)
                .ok_or_else(|| Violation::at(path, TYPE))?;
            let admitted = kinds.iter().any(|candidate| {
                serde_json::to_value(candidate)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .is_some_and(|candidate| candidate == kind)
            });
            if admitted {
                Ok(())
            } else {
                Err(Violation::at(path, RANGE))
            }
        }
        ResultValueContract::Literal { value: expected } if value == expected => Ok(()),
        ResultValueContract::Literal { .. } => Err(Violation::at(path, LITERAL)),
        ResultValueContract::Json {
            max_depth,
            max_bytes,
        } => {
            let bytes = serde_json::to_vec(value).map_err(|_| Violation::at(path, SERIALIZE))?;
            if bytes.len() > *max_bytes {
                return Err(Violation::bound(path, MAX_BYTES, *max_bytes, bytes.len()));
            }
            validate_json_children_with_limit(value, depth, *max_depth, budget, path)
        }
        ResultValueContract::Array { element, max_items } => {
            let values = value.as_array().ok_or_else(|| Violation::at(path, TYPE))?;
            if values.len() > *max_items {
                return Err(Violation::bound(path, MAX_ITEMS, *max_items, values.len()));
            }
            for (index, value) in values.iter().enumerate() {
                validate_value(
                    value,
                    element,
                    &format!("{path}[{index}]"),
                    depth + 1,
                    budget,
                )?;
            }
            Ok(())
        }
        ResultValueContract::Tuple { elements } => {
            let values = value.as_array().ok_or_else(|| Violation::at(path, TYPE))?;
            if values.len() != elements.len() {
                return Err(Violation::bound(path, ARITY, elements.len(), values.len()));
            }
            for (index, (value, element)) in values.iter().zip(elements).enumerate() {
                validate_value(
                    value,
                    element,
                    &format!("{path}[{index}]"),
                    depth + 1,
                    budget,
                )?;
            }
            Ok(())
        }
        ResultValueContract::Vector { dimensions } => {
            let values = value.as_array().ok_or_else(|| Violation::at(path, TYPE))?;
            if values.len() != *dimensions as usize {
                return Err(Violation::bound(
                    path,
                    DIMENSIONS,
                    *dimensions as usize,
                    values.len(),
                ));
            }
            for (index, value) in values.iter().enumerate() {
                consume(budget, depth + 1, &format!("{path}[{index}]"))?;
                let Some(component) = value.as_f64() else {
                    return Err(Violation::at(path, TYPE));
                };
                if !component.is_finite()
                    || component.abs() > crate::vector::VECTOR_COMPONENT_ABS_MAX
                {
                    return Err(Violation::at(path, RANGE));
                }
            }
            Ok(())
        }
        ResultValueContract::Union { variants } => {
            for variant in variants {
                let mut trial = ValidationBudget {
                    nodes: budget.nodes,
                };
                if validate_value(value, variant, path, depth, &mut trial).is_ok() {
                    budget.nodes = trial.nodes;
                    return Ok(());
                }
            }
            Err(Violation::at(path, UNION))
        }
        ResultValueContract::Object {
            fields,
            allow_extra,
        } => validate_object(value, fields, *allow_extra, path, depth, budget),
        _ => Err(Violation::at(path, TYPE)),
    }
}

fn validate_object(
    value: &Value,
    fields: &[ResultObjectFieldContract],
    allow_extra: bool,
    path: &str,
    depth: usize,
    budget: &mut ValidationBudget,
) -> Result<(), Violation> {
    let object = value.as_object().ok_or_else(|| Violation::at(path, TYPE))?;
    let names = fields
        .iter()
        .map(|field| field.name.as_str())
        .collect::<BTreeSet<_>>();
    if !allow_extra && let Some(name) = object.keys().find(|name| !names.contains(name.as_str())) {
        return Err(Violation::at(
            format!("{path}.{}", path_segment(name)),
            EXTRA_FIELD,
        ));
    }
    for field in fields {
        match object.get(&field.name) {
            Some(value) => validate_value(
                value,
                &field.value,
                &format!("{path}.{}", path_segment(&field.name)),
                depth + 1,
                budget,
            )?,
            None if field.required => {
                return Err(Violation::at(
                    format!("{path}.{}", path_segment(&field.name)),
                    REQUIRED_FIELD,
                ));
            }
            None => {}
        }
    }
    Ok(())
}

fn path_segment(name: &str) -> String {
    if name
        .bytes()
        .all(|byte| byte == b'_' || byte.is_ascii_alphanumeric())
    {
        name.to_owned()
    } else {
        "<field>".to_owned()
    }
}

/// Dynamic JSON-object keys may be application data rather than authored or
/// stored field structure. Keep those keys out of diagnostics while retaining
/// a stable, bounded discriminator that lets repeated failures be correlated.
/// Declared object fields and closed-record extra fields use `path_segment`
/// above and remain legible to the author.
fn dynamic_path_segment(name: &str) -> String {
    let digest = format!("{:x}", Sha256::digest(name.as_bytes()));
    format!("<unknown>#{}", &digest[..12])
}

fn validate_json_budget(
    value: &Value,
    depth: usize,
    budget: &mut ValidationBudget,
) -> Result<(), Violation> {
    validate_json_budget_with_limit(value, depth, MAX_RESULT_DEPTH, budget, "$")
}

fn validate_json_budget_with_limit(
    value: &Value,
    depth: usize,
    max_depth: usize,
    budget: &mut ValidationBudget,
    path: &str,
) -> Result<(), Violation> {
    consume(budget, depth, path)?;
    if depth > max_depth {
        return Err(Violation::bound(path, MAX_DEPTH, max_depth, depth));
    }
    match value {
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                validate_json_budget_with_limit(
                    value,
                    depth + 1,
                    max_depth,
                    budget,
                    &format!("{path}[{index}]"),
                )?;
            }
        }
        Value::Object(object) => {
            for (name, value) in object {
                validate_json_budget_with_limit(
                    value,
                    depth + 1,
                    max_depth,
                    budget,
                    &format!("{path}.{}", dynamic_path_segment(name)),
                )?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_json_children_with_limit(
    value: &Value,
    depth: usize,
    max_depth: usize,
    budget: &mut ValidationBudget,
    path: &str,
) -> Result<(), Violation> {
    if depth > max_depth {
        return Err(Violation::bound(path, MAX_DEPTH, max_depth, depth));
    }
    match value {
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                validate_json_budget_with_limit(
                    value,
                    depth + 1,
                    max_depth,
                    budget,
                    &format!("{path}[{index}]"),
                )?;
            }
        }
        Value::Object(object) => {
            for (name, value) in object {
                validate_json_budget_with_limit(
                    value,
                    depth + 1,
                    max_depth,
                    budget,
                    &format!("{path}.{}", dynamic_path_segment(name)),
                )?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn violation(
    function_id: &str,
    result_contract_hash: Option<&str>,
    failure: Violation,
) -> SnapbackError {
    let mut details = json!({
        "functionId": function_id,
        "resultContractHash": result_contract_hash,
        "path": failure.path,
        "constraint": failure.constraint,
    });
    let object = details
        .as_object_mut()
        .expect("result-contract violation details are an object");
    if let Some(limit) = failure.limit {
        object.insert("limit".to_owned(), json!(limit));
    }
    if let Some(observed) = failure.observed {
        object.insert("observed".to_owned(), json!(observed));
    }

    SnapbackError::error(
        "SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION",
        "runtime",
        format!(
            "handler {:?} returned a value outside its declared result contract",
            function_id
        ),
    )
    .with_details(details)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{FunctionKind, FunctionRuntime, HandlerPlan, QueryPlan};

    fn function(contract: FunctionResultContract) -> FunctionDefinition {
        let mut function = FunctionDefinition::new(
            "rows",
            FunctionKind::Query,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table_visibility: None,
                table: "items".to_owned(),
                filters: Vec::new(),
                membership_filters: Vec::new(),
                order: Vec::new(),
                limit: None,
                indexed_by: None,
            })),
        );
        function.result_contract = contract;
        function.result_contract_hash = Some("sha256:test".to_owned());
        function
    }

    fn assert_redacted(error: &SnapbackError, secret: &str) {
        assert_eq!(
            error.to_string(),
            "SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION: handler \"fn:rows\" returned a value outside its declared result contract"
        );
        let serialized_details =
            serde_json::to_string(&error.diagnostic.details).expect("diagnostic details serialize");
        assert!(!error.to_string().contains(secret));
        assert!(!serialized_details.contains(secret), "{serialized_details}");
    }

    #[test]
    fn nested_type_violation_names_constraint_without_echoing_scalar() {
        let function = function(FunctionResultContract::Value {
            value: ResultValueContract::Object {
                fields: vec![ResultObjectFieldContract {
                    name: "title".to_owned(),
                    required: true,
                    value: ResultValueContract::String { max_bytes: 32 },
                }],
                allow_extra: false,
            },
        });
        let user_number = 987_654_321_u64;
        let error = validate_handler_result(&function, &json!({ "title": user_number }))
            .expect_err("a number is not a declared string");

        assert_eq!(error.diagnostic.details["path"], "$.title");
        assert_eq!(error.diagnostic.details["constraint"], TYPE);
        assert!(error.diagnostic.details.get("limit").is_none());
        assert!(error.diagnostic.details.get("observed").is_none());
        assert_redacted(&error, &user_number.to_string());
    }

    #[test]
    fn scalar_query_validates_exactly_one_internal_row_as_the_authored_value() {
        let function = function(FunctionResultContract::Value {
            value: ResultValueContract::Object {
                fields: vec![ResultObjectFieldContract {
                    name: "title".to_owned(),
                    required: true,
                    value: ResultValueContract::String { max_bytes: 32 },
                }],
                allow_extra: false,
            },
        });
        validate_query_handler_result(&function, &[json!({ "title": "one" })])
            .expect("one internal row validates as one authored object");

        let error = validate_query_handler_result(&function, &[])
            .expect_err("a scalar query cannot lose its internal row");
        assert_eq!(error.diagnostic.details["constraint"], ARITY);
        assert_eq!(error.diagnostic.details["limit"], 1);
        assert_eq!(error.diagnostic.details["observed"], 0);
    }

    #[test]
    fn bounded_json_max_bytes_reports_aggregate_measurements_without_payload() {
        let max_bytes = 64;
        let function = function(FunctionResultContract::Value {
            value: ResultValueContract::Json {
                max_depth: 16,
                max_bytes,
            },
        });
        let marker = "ticket-private-payload";
        let value = json!({ "payload": format!("{marker}-{}", "z".repeat(max_bytes)) });
        let observed = serde_json::to_vec(&value).unwrap().len();
        let error = validate_handler_result(&function, &value)
            .expect_err("encoded JSON exceeds its declared maxBytes");

        assert_eq!(error.diagnostic.details["path"], "$");
        assert_eq!(error.diagnostic.details["constraint"], MAX_BYTES);
        assert_eq!(error.diagnostic.details["limit"], json!(max_bytes));
        assert_eq!(error.diagnostic.details["observed"], json!(observed));
        assert!(observed > max_bytes);
        assert_redacted(&error, marker);
    }

    #[test]
    fn global_result_max_bytes_reports_aggregate_measurements_without_payload() {
        let function = function(FunctionResultContract::Unknown);
        let marker = "private-global-result-payload";
        let value = Value::String(format!("{marker}{}", "z".repeat(MAX_HANDLER_RESULT_BYTES)));
        let observed = serde_json::to_vec(&value).unwrap().len();
        let error = validate_handler_result(&function, &value)
            .expect_err("encoded handler result exceeds the global ceiling");

        assert_eq!(error.diagnostic.details["path"], "$");
        assert_eq!(error.diagnostic.details["constraint"], MAX_RESULT_BYTES);
        assert_eq!(
            error.diagnostic.details["limit"],
            json!(MAX_HANDLER_RESULT_BYTES)
        );
        assert_eq!(error.diagnostic.details["observed"], json!(observed));
        assert!(observed > MAX_HANDLER_RESULT_BYTES);
        assert_redacted(&error, marker);
    }

    #[test]
    fn string_max_bytes_reports_utf8_byte_lengths_without_content() {
        let max_bytes = 4;
        let function = function(FunctionResultContract::Value {
            value: ResultValueContract::String { max_bytes },
        });
        let value = "private-é";
        let error = validate_handler_result(&function, &json!(value))
            .expect_err("string exceeds its declared UTF-8 maxBytes");

        assert_eq!(error.diagnostic.details["constraint"], MAX_BYTES);
        assert_eq!(error.diagnostic.details["limit"], json!(max_bytes));
        assert_eq!(error.diagnostic.details["observed"], json!(value.len()));
        assert_redacted(&error, value);
    }

    #[test]
    fn exact_record_contract_rejects_extra_fields_without_echoing_values() {
        let function = function(FunctionResultContract::Records {
            record: ResultValueContract::Object {
                fields: vec![ResultObjectFieldContract {
                    name: "title".to_owned(),
                    required: true,
                    value: ResultValueContract::String { max_bytes: 8 },
                }],
                allow_extra: false,
            },
            rows: None,
        });
        let error = validate_handler_result(
            &function,
            &json!([{"title": "ok", "secret": "do-not-echo"}]),
        )
        .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION"
        );
        assert_eq!(error.diagnostic.details["path"], "$[0].secret");
        assert_eq!(error.diagnostic.details["constraint"], EXTRA_FIELD);
        assert!(error.diagnostic.details.get("limit").is_none());
        assert!(error.diagnostic.details.get("observed").is_none());
        assert!(error.diagnostic.details.get("pathHash").is_none());
        assert_redacted(&error, "do-not-echo");
    }

    #[test]
    fn exact_record_contract_names_missing_required_field() {
        let function = function(FunctionResultContract::Records {
            record: ResultValueContract::Object {
                fields: vec![ResultObjectFieldContract {
                    name: "title".to_owned(),
                    required: true,
                    value: ResultValueContract::String { max_bytes: 8 },
                }],
                allow_extra: false,
            },
            rows: None,
        });
        let error =
            validate_handler_result(&function, &json!([{}])).expect_err("required title is absent");

        assert_eq!(error.diagnostic.details["path"], "$[0].title");
        assert_eq!(error.diagnostic.details["constraint"], REQUIRED_FIELD);
        assert!(error.diagnostic.details.get("limit").is_none());
        assert!(error.diagnostic.details.get("observed").is_none());
    }

    #[test]
    fn exact_record_contract_names_stored_system_field_and_row() {
        let function = function(FunctionResultContract::Records {
            record: ResultValueContract::Object {
                fields: vec![ResultObjectFieldContract {
                    name: "title".to_owned(),
                    required: true,
                    value: ResultValueContract::String { max_bytes: 8 },
                }],
                allow_extra: false,
            },
            rows: None,
        });
        let error = validate_handler_result(
            &function,
            &json!([
                {"title": "zero"},
                {"title": "one"},
                {"title": "two"},
                {"title": "three", "_version": "do-not-echo-system-value"}
            ]),
        )
        .unwrap_err();

        assert_eq!(error.diagnostic.details["path"], "$[3]._version");
        assert!(!error.to_string().contains("do-not-echo-system-value"));
    }

    #[test]
    fn bounded_json_violation_redacts_dynamic_keys_and_values() {
        let function = function(FunctionResultContract::Value {
            value: ResultValueContract::Json {
                max_depth: 0,
                max_bytes: 1_024,
            },
        });
        let dynamic_key = "private@example.com";
        let offending_value = "do-not-echo-dynamic-value";
        let value = Value::Object(serde_json::Map::from_iter([(
            dynamic_key.to_owned(),
            Value::String(offending_value.to_owned()),
        )]));
        let error = validate_handler_result(&function, &value).unwrap_err();

        let path = error.diagnostic.details["path"]
            .as_str()
            .expect("legible redacted path");
        assert!(path.starts_with("$.<unknown>#"), "{path}");
        assert!(!path.contains(dynamic_key), "{path}");
        assert_eq!(error.diagnostic.details["constraint"], MAX_DEPTH);
        assert_eq!(error.diagnostic.details["limit"], json!(0));
        assert_eq!(error.diagnostic.details["observed"], json!(1));
        assert_redacted(&error, dynamic_key);
        assert_redacted(&error, offending_value);
    }

    #[test]
    fn record_contract_accepts_matching_rows() {
        let function = function(FunctionResultContract::Records {
            record: ResultValueContract::Object {
                fields: vec![ResultObjectFieldContract {
                    name: "title".to_owned(),
                    required: true,
                    value: ResultValueContract::String { max_bytes: 8 },
                }],
                allow_extra: false,
            },
            rows: None,
        });
        validate_handler_result(&function, &json!([{"title": "ok"}])).unwrap();
    }

    #[test]
    fn exact_record_row_bound_rejects_zero_or_two_rows() {
        let function = function(FunctionResultContract::Records {
            record: ResultValueContract::Object {
                fields: vec![ResultObjectFieldContract {
                    name: "title".to_owned(),
                    required: true,
                    value: ResultValueContract::String { max_bytes: 8 },
                }],
                allow_extra: false,
            },
            rows: Some(crate::manifest::ResultRowsBound {
                min_items: 1,
                max_items: 1,
            }),
        });
        let too_few = validate_handler_result(&function, &json!([]))
            .expect_err("rows minItems must be enforced");
        assert_eq!(too_few.diagnostic.details["constraint"], MIN_ITEMS);
        assert_eq!(too_few.diagnostic.details["limit"], json!(1));
        assert_eq!(too_few.diagnostic.details["observed"], json!(0));
        validate_handler_result(&function, &json!([{"title": "one"}])).unwrap();
        let too_many =
            validate_handler_result(&function, &json!([{"title": "one"}, {"title": "two"}]))
                .expect_err("rows maxItems must be enforced");
        assert_eq!(too_many.diagnostic.details["constraint"], MAX_ITEMS);
        assert_eq!(too_many.diagnostic.details["limit"], json!(1));
        assert_eq!(too_many.diagnostic.details["observed"], json!(2));
    }

    #[test]
    fn exact_vector_result_admits_only_d_finite_bounded_components() {
        let function = function(FunctionResultContract::Value {
            value: ResultValueContract::Vector { dimensions: 3 },
        });
        validate_handler_result(&function, &json!([0.0, -0.0, 3.5])).expect("exact D passes");
        for (rejected, constraint, observed) in [
            (json!([0.0, 1.0]), DIMENSIONS, Some(2)),
            (json!([0.0, 1.0, 2.0, 3.0]), DIMENSIONS, Some(4)),
            (
                json!([0.0, 1.0, crate::vector::VECTOR_COMPONENT_ABS_MAX * 2.0]),
                RANGE,
                None,
            ),
        ] {
            let error = validate_handler_result(&function, &rejected)
                .expect_err("D-1, D+1, and out-of-domain components refuse");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION"
            );
            assert_eq!(error.diagnostic.details["constraint"], constraint);
            if let Some(observed) = observed {
                assert_eq!(error.diagnostic.details["limit"], json!(3));
                assert_eq!(error.diagnostic.details["observed"], json!(observed));
            } else {
                assert!(error.diagnostic.details.get("limit").is_none());
                assert!(error.diagnostic.details.get("observed").is_none());
            }
        }
    }

    #[test]
    fn nested_vectors_debit_every_component_from_result_node_budget() {
        let function = function(FunctionResultContract::Records {
            record: ResultValueContract::Object {
                fields: vec![ResultObjectFieldContract {
                    name: "vector".to_owned(),
                    required: true,
                    value: ResultValueContract::Vector { dimensions: 64 },
                }],
                allow_extra: false,
            },
            rows: Some(crate::manifest::ResultRowsBound {
                min_items: 0,
                max_items: 1_024,
            }),
        });
        let rows = vec![json!({ "vector": vec![0.0; 64] }); 1_024];
        let error = validate_handler_result(&function, &Value::Array(rows))
            .expect_err("vector components must not bypass the global node budget");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION"
        );
        assert_eq!(error.diagnostic.details["constraint"], NODE_BUDGET);
        assert_eq!(error.diagnostic.details["limit"], json!(MAX_RESULT_NODES));
        assert_eq!(
            error.diagnostic.details["observed"],
            json!(MAX_RESULT_NODES + 1)
        );
    }

    #[test]
    fn value_contract_matrix_covers_every_recursive_variant() {
        let cases = vec![
            (ResultValueContract::Null, Value::Null, json!(false), TYPE),
            (
                ResultValueContract::Boolean,
                json!(true),
                json!("true"),
                TYPE,
            ),
            (
                ResultValueContract::String { max_bytes: 4 },
                json!("éé"),
                json!("ééé"),
                MAX_BYTES,
            ),
            (
                ResultValueContract::Integer { min: -2, max: 2 },
                json!(2),
                json!(3),
                RANGE,
            ),
            (
                ResultValueContract::FiniteReal {
                    min: -1.5,
                    max: 1.5,
                },
                json!(1.25),
                json!(2.0),
                RANGE,
            ),
            (
                ResultValueContract::Principal,
                json!("usr_1"),
                json!(""),
                TYPE,
            ),
            (
                ResultValueContract::AssetRef,
                json!("asset_0198"),
                json!({"assetId": "asset_0198"}),
                TYPE,
            ),
            (
                ResultValueContract::Id {
                    table: "items".to_owned(),
                },
                json!("item_1"),
                json!(""),
                TYPE,
            ),
            (
                ResultValueContract::Literal {
                    value: json!("ready"),
                },
                json!("ready"),
                json!("waiting"),
                LITERAL,
            ),
            (
                ResultValueContract::Json {
                    max_depth: 1,
                    max_bytes: 64,
                },
                json!({"ok": true}),
                json!({"too": {"deep": true}}),
                MAX_DEPTH,
            ),
            (
                ResultValueContract::Array {
                    element: Box::new(ResultValueContract::Boolean),
                    max_items: 2,
                },
                json!([true, false]),
                json!([true, false, true]),
                MAX_ITEMS,
            ),
            (
                ResultValueContract::Tuple {
                    elements: vec![ResultValueContract::Boolean],
                },
                json!([true]),
                json!([]),
                ARITY,
            ),
            (
                ResultValueContract::Union {
                    variants: vec![ResultValueContract::Null, ResultValueContract::Boolean],
                },
                json!(false),
                json!("neither"),
                UNION,
            ),
            (
                ResultValueContract::Object {
                    fields: vec![
                        ResultObjectFieldContract {
                            name: "required".to_owned(),
                            required: true,
                            value: ResultValueContract::Boolean,
                        },
                        ResultObjectFieldContract {
                            name: "optional".to_owned(),
                            required: false,
                            value: ResultValueContract::String { max_bytes: 4 },
                        },
                    ],
                    allow_extra: false,
                },
                json!({"required": true}),
                json!({"optional": "ok"}),
                REQUIRED_FIELD,
            ),
        ];

        for (contract, accepted, rejected, expected_constraint) in cases {
            let function = function(FunctionResultContract::Value { value: contract });
            validate_handler_result(&function, &accepted)
                .unwrap_or_else(|error| panic!("accepted fixture refused: {error}"));
            let error = validate_handler_result(&function, &rejected)
                .expect_err("rejected fixture passed its result contract");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION"
            );
            assert_eq!(
                error.diagnostic.details["constraint"], expected_constraint,
                "unexpected constraint for rejected fixture {rejected}"
            );
            assert!(
                !error.to_string().contains(&rejected.to_string()),
                "result diagnostics must not echo the rejected value"
            );
        }
    }

    #[test]
    fn scalar_range_violation_never_reports_the_rejected_number() {
        let function = function(FunctionResultContract::Value {
            value: ResultValueContract::Integer { min: -2, max: 2 },
        });
        let rejected = 9_876_543_210_i64;
        let error = validate_handler_result(&function, &json!(rejected))
            .expect_err("out-of-range integer must be refused");

        assert_eq!(error.diagnostic.details["constraint"], RANGE);
        assert!(error.diagnostic.details.get("limit").is_none());
        assert!(error.diagnostic.details.get("observed").is_none());
        assert_redacted(&error, &rejected.to_string());
    }

    #[test]
    fn document_and_legacy_rows_preserve_their_declared_extra_field_posture() {
        let fields = vec![
            ResultObjectFieldContract {
                name: "_id".to_owned(),
                required: true,
                value: ResultValueContract::String { max_bytes: 64 },
            },
            ResultObjectFieldContract {
                name: "title".to_owned(),
                required: true,
                value: ResultValueContract::String { max_bytes: 8 },
            },
        ];
        let document = function(FunctionResultContract::Documents {
            table: "items".to_owned(),
            document: ResultValueContract::Object {
                fields: fields.clone(),
                allow_extra: false,
            },
        });
        validate_handler_result(&document, &json!([{"_id": "item_1", "title": "ok"}]))
            .expect("exact stored document");
        assert!(
            validate_handler_result(
                &document,
                &json!([{"_id": "item_1", "title": "ok", "invented": true}]),
            )
            .is_err(),
            "stored documents cannot invent undeclared system/application fields"
        );

        let legacy = function(FunctionResultContract::LegacyQueryRowsV0 {
            row: ResultValueContract::Object {
                fields,
                allow_extra: true,
            },
        });
        validate_handler_result(
            &legacy,
            &json!([{"_id": "item_1", "title": "ok", "legacyExtra": true}]),
        )
        .expect("legacy query rows retain their documented open-extra compatibility");
    }

    #[test]
    fn bounded_json_root_consumes_the_shared_node_budget_once() {
        let function = function(FunctionResultContract::Value {
            value: ResultValueContract::Json {
                max_depth: 0,
                max_bytes: 8,
            },
        });
        let mut budget = ValidationBudget {
            nodes: MAX_RESULT_NODES - 1,
        };
        validate_value(
            &Value::Null,
            match &function.result_contract {
                FunctionResultContract::Value { value } => value,
                _ => unreachable!(),
            },
            "$",
            0,
            &mut budget,
        )
        .expect("the JSON root was already consumed by the contract dispatcher");
        assert_eq!(budget.nodes, MAX_RESULT_NODES);
    }
}
