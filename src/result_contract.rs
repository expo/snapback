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

pub fn validate_handler_result(function: &FunctionDefinition, value: &Value) -> SnapbackResult<()> {
    let bytes = serde_json::to_vec(value).map_err(|_| violation(function, "$"))?;
    if bytes.len() > MAX_HANDLER_RESULT_BYTES {
        return Err(violation(function, "$"));
    }
    let mut budget = ValidationBudget { nodes: 0 };
    match &function.result_contract {
        FunctionResultContract::Unknown => validate_json_budget(value, 0, &mut budget),
        FunctionResultContract::Documents { document, .. } => {
            validate_rows(function, value, document, None, &mut budget)
        }
        FunctionResultContract::Records { record, rows } => {
            validate_rows(function, value, record, rows.as_ref(), &mut budget)
        }
        FunctionResultContract::LegacyQueryRowsV0 { row } => {
            validate_rows(function, value, row, None, &mut budget)
        }
        FunctionResultContract::Document { document, .. } => {
            validate_value(function, value, document, "$", 0, &mut budget)
        }
        FunctionResultContract::Value { value: contract } => {
            validate_value(function, value, contract, "$", 0, &mut budget)
        }
    }
    .map_err(|path| violation(function, &path))
}

fn validate_rows(
    function: &FunctionDefinition,
    value: &Value,
    row: &ResultValueContract,
    bound: Option<&crate::manifest::ResultRowsBound>,
    budget: &mut ValidationBudget,
) -> Result<(), String> {
    let rows = value.as_array().ok_or_else(|| "$".to_owned())?;
    if bound.is_some_and(|bound| rows.len() < bound.min_items || rows.len() > bound.max_items) {
        return Err("$".to_owned());
    }
    for (index, value) in rows.iter().enumerate() {
        validate_value(function, value, row, &format!("$[{index}]"), 1, budget)?;
    }
    Ok(())
}

struct ValidationBudget {
    nodes: usize,
}

fn consume(budget: &mut ValidationBudget, depth: usize, path: &str) -> Result<(), String> {
    budget.nodes = budget.nodes.saturating_add(1);
    if budget.nodes > MAX_RESULT_NODES || depth > MAX_RESULT_DEPTH {
        Err(path.to_owned())
    } else {
        Ok(())
    }
}

fn validate_value(
    function: &FunctionDefinition,
    value: &Value,
    contract: &ResultValueContract,
    path: &str,
    depth: usize,
    budget: &mut ValidationBudget,
) -> Result<(), String> {
    let _ = function;
    consume(budget, depth, path)?;
    match contract {
        ResultValueContract::Null if value.is_null() => Ok(()),
        ResultValueContract::Boolean if value.is_boolean() => Ok(()),
        ResultValueContract::String { max_bytes } => value
            .as_str()
            .filter(|text| text.len() <= *max_bytes)
            .map(|_| ())
            .ok_or_else(|| path.to_owned()),
        ResultValueContract::Integer { min, max } => value
            .as_i64()
            .filter(|number| number >= min && number <= max)
            .map(|_| ())
            .ok_or_else(|| path.to_owned()),
        ResultValueContract::FiniteReal { min, max } => value
            .as_f64()
            .filter(|number| number.is_finite() && number >= min && number <= max)
            .map(|_| ())
            .ok_or_else(|| path.to_owned()),
        ResultValueContract::Principal | ResultValueContract::Id { .. } => value
            .as_str()
            .filter(|text| !text.is_empty())
            .map(|_| ())
            .ok_or_else(|| path.to_owned()),
        ResultValueContract::Literal { value: expected } if value == expected => Ok(()),
        ResultValueContract::Json {
            max_depth,
            max_bytes,
        } => {
            if serde_json::to_vec(value).map_or(true, |bytes| bytes.len() > *max_bytes) {
                return Err(path.to_owned());
            }
            validate_json_children_with_limit(value, depth, *max_depth, budget, path)
        }
        ResultValueContract::Array { element, max_items } => {
            let values = value.as_array().ok_or_else(|| path.to_owned())?;
            if values.len() > *max_items {
                return Err(path.to_owned());
            }
            for (index, value) in values.iter().enumerate() {
                validate_value(
                    function,
                    value,
                    element,
                    &format!("{path}[{index}]"),
                    depth + 1,
                    budget,
                )?;
            }
            Ok(())
        }
        ResultValueContract::Union { variants } => {
            for variant in variants {
                let mut trial = ValidationBudget {
                    nodes: budget.nodes,
                };
                if validate_value(function, value, variant, path, depth, &mut trial).is_ok() {
                    budget.nodes = trial.nodes;
                    return Ok(());
                }
            }
            Err(path.to_owned())
        }
        ResultValueContract::Object {
            fields,
            allow_extra,
        } => validate_object(function, value, fields, *allow_extra, path, depth, budget),
        _ => Err(path.to_owned()),
    }
}

fn validate_object(
    function: &FunctionDefinition,
    value: &Value,
    fields: &[ResultObjectFieldContract],
    allow_extra: bool,
    path: &str,
    depth: usize,
    budget: &mut ValidationBudget,
) -> Result<(), String> {
    let object = value.as_object().ok_or_else(|| path.to_owned())?;
    let names = fields
        .iter()
        .map(|field| field.name.as_str())
        .collect::<BTreeSet<_>>();
    if !allow_extra && let Some(name) = object.keys().find(|name| !names.contains(name.as_str())) {
        return Err(format!("{path}.{}", path_segment(name)));
    }
    for field in fields {
        match object.get(&field.name) {
            Some(value) => validate_value(
                function,
                value,
                &field.value,
                &format!("{path}.{}", path_segment(&field.name)),
                depth + 1,
                budget,
            )?,
            None if field.required => {
                return Err(format!("{path}.{}", path_segment(&field.name)));
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

fn validate_json_budget(
    value: &Value,
    depth: usize,
    budget: &mut ValidationBudget,
) -> Result<(), String> {
    validate_json_budget_with_limit(value, depth, MAX_RESULT_DEPTH, budget, "$")
}

fn validate_json_budget_with_limit(
    value: &Value,
    depth: usize,
    max_depth: usize,
    budget: &mut ValidationBudget,
    path: &str,
) -> Result<(), String> {
    consume(budget, depth, path)?;
    if depth > max_depth {
        return Err(path.to_owned());
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
                    &format!("{path}.{}", path_segment(name)),
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
) -> Result<(), String> {
    if depth > max_depth {
        return Err(path.to_owned());
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
                    &format!("{path}.{}", path_segment(name)),
                )?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn violation(function: &FunctionDefinition, path: &str) -> SnapbackError {
    let path_hash = Sha256::digest(path.as_bytes());
    SnapbackError::error(
        "SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION",
        "runtime",
        format!(
            "handler {:?} returned a value outside its declared result contract",
            function.id
        ),
    )
    .with_details(json!({
        "functionId": function.id,
        "resultContractHash": function.result_contract_hash,
        "pathHash": format!("sha256:{path_hash:x}"),
    }))
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
        assert!(!error.to_string().contains("do-not-echo"));
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
        assert!(validate_handler_result(&function, &json!([])).is_err());
        validate_handler_result(&function, &json!([{"title": "one"}])).unwrap();
        assert!(
            validate_handler_result(&function, &json!([{"title": "one"}, {"title": "two"}]))
                .is_err()
        );
    }

    #[test]
    fn value_contract_matrix_covers_every_recursive_variant() {
        let cases = vec![
            (ResultValueContract::Null, Value::Null, json!(false)),
            (ResultValueContract::Boolean, json!(true), json!("true")),
            (
                ResultValueContract::String { max_bytes: 4 },
                json!("éé"),
                json!("ééé"),
            ),
            (
                ResultValueContract::Integer { min: -2, max: 2 },
                json!(2),
                json!(3),
            ),
            (
                ResultValueContract::FiniteReal {
                    min: -1.5,
                    max: 1.5,
                },
                json!(1.25),
                json!(2.0),
            ),
            (ResultValueContract::Principal, json!("usr_1"), json!("")),
            (
                ResultValueContract::Id {
                    table: "items".to_owned(),
                },
                json!("item_1"),
                json!(""),
            ),
            (
                ResultValueContract::Literal {
                    value: json!("ready"),
                },
                json!("ready"),
                json!("waiting"),
            ),
            (
                ResultValueContract::Json {
                    max_depth: 1,
                    max_bytes: 64,
                },
                json!({"ok": true}),
                json!({"too": {"deep": true}}),
            ),
            (
                ResultValueContract::Array {
                    element: Box::new(ResultValueContract::Boolean),
                    max_items: 2,
                },
                json!([true, false]),
                json!([true, false, true]),
            ),
            (
                ResultValueContract::Union {
                    variants: vec![ResultValueContract::Null, ResultValueContract::Boolean],
                },
                json!(false),
                json!("neither"),
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
            ),
        ];

        for (contract, accepted, rejected) in cases {
            let function = function(FunctionResultContract::Value { value: contract });
            validate_handler_result(&function, &accepted)
                .unwrap_or_else(|error| panic!("accepted fixture refused: {error}"));
            let error = validate_handler_result(&function, &rejected)
                .expect_err("rejected fixture passed its result contract");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION"
            );
            assert!(
                !error.to_string().contains(&rejected.to_string()),
                "result diagnostics must not echo the rejected value"
            );
        }
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
            &function,
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
