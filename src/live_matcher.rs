use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{
    FilterOp, FunctionDefinition, FunctionRuntime, HandlerInput, HandlerPlan, QueryOutput,
    QueryPlan, ValueExpr,
};
use crate::storage::{
    CapturedReadDependency, CapturedReadKind, ChangeOp, ChangedRow, LocalDatabase,
};
use serde_json::{Value, json};

pub(crate) fn query_dependencies_from_plan(
    plan: &QueryPlan,
    input: &HandlerInput,
    output: &QueryOutput,
    db: &LocalDatabase,
) -> SnapbackResult<Vec<CapturedReadDependency>> {
    let mut dependencies = Vec::new();
    if let Some(user_id) = input.auth.user_id.as_deref() {
        dependencies.push(CapturedReadDependency {
            kind: CapturedReadKind::Auth,
            table: None,
            id: None,
            version: None,
            predicate: None,
            rows: Vec::new(),
            field: Some("userId".to_owned()),
            value: Some(Value::String(user_id.to_owned())),
        });
    }

    let mut rows = Vec::new();
    for row in &output.rows {
        if let Some(id) = row.get("_id").and_then(Value::as_str) {
            rows.push(id.to_owned());
            if let Some(version) = row.get("_version").and_then(Value::as_u64) {
                dependencies.push(CapturedReadDependency {
                    kind: CapturedReadKind::Row,
                    table: Some(plan.table.clone()),
                    id: Some(id.to_owned()),
                    version: Some(version),
                    predicate: None,
                    rows: Vec::new(),
                    field: None,
                    value: None,
                });
            }
        }
    }

    let predicate = serde_json::to_value(plan).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_CAPTURED_READ_SERIALIZE_FAILED",
            "runtime",
            "query dependency could not be serialized",
        )
        .with_details(json!({ "error": error.to_string() }))
    })?;
    dependencies.push(CapturedReadDependency {
        kind: CapturedReadKind::Query,
        table: Some(plan.table.clone()),
        id: None,
        version: Some(db.table_change_version(&plan.table)?),
        predicate: Some(predicate),
        rows,
        field: None,
        value: None,
    });

    Ok(dependencies)
}

/// @ref LLP 0020#phase-4-upgrade-realtime-from-v0-outbox-to-app-grade-live-delivery — the realtime matcher reuses captured query dependencies and keeps a conservative replace fallback.
pub(crate) fn live_subscription_may_be_affected(
    definition: &FunctionDefinition,
    input: &HandlerInput,
    read_dependencies: &[CapturedReadDependency],
    changes: &[ChangedRow],
) -> bool {
    if changes.is_empty() {
        return true;
    }
    if let Some(matched) =
        live_subscription_may_be_affected_by_dependencies(input, read_dependencies, changes)
    {
        return matched;
    }
    match &definition.runtime {
        FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) => changes
            .iter()
            .any(|change| change_may_affect_query_plan(plan, input, change)),
        FunctionRuntime::IbexModule(_) => {
            let tables = &definition.read_set_summary.tables;
            let relevant = changes
                .iter()
                .filter(|change| tables.is_empty() || tables.contains(&change.table))
                .collect::<Vec<_>>();
            if relevant.is_empty() {
                return false;
            }
            if definition.read_set_summary.auth_scope_field.as_deref() == Some("userId") {
                if let Some(user_id) = input.auth.user_id.as_deref() {
                    if relevant.iter().all(|change| {
                        field_scope_change_is_disjoint(
                            change,
                            "userId",
                            &Value::String(user_id.to_owned()),
                        )
                    }) {
                        return false;
                    }
                }
            }
            true
        }
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(_)) => true,
    }
}

fn live_subscription_may_be_affected_by_dependencies(
    input: &HandlerInput,
    read_dependencies: &[CapturedReadDependency],
    changes: &[ChangedRow],
) -> Option<bool> {
    let query_dependencies = read_dependencies
        .iter()
        .filter(|dependency| dependency.kind == CapturedReadKind::Query)
        .collect::<Vec<_>>();
    if query_dependencies.is_empty() {
        return None;
    }

    for dependency in query_dependencies {
        let Some(table) = dependency.table.as_deref() else {
            return Some(true);
        };
        for change in changes.iter().filter(|change| change.table == table) {
            if query_dependency_change_may_affect(input, dependency, change) {
                return Some(true);
            }
        }
    }

    Some(false)
}

fn query_dependency_change_may_affect(
    input: &HandlerInput,
    dependency: &CapturedReadDependency,
    change: &ChangedRow,
) -> bool {
    let Some(predicate) = dependency.predicate.as_ref() else {
        return true;
    };
    let Ok(plan) = serde_json::from_value::<QueryPlan>(predicate.clone()) else {
        return true;
    };
    change_may_affect_query_plan(&plan, input, change)
}

fn change_may_affect_query_plan(
    plan: &QueryPlan,
    input: &HandlerInput,
    change: &ChangedRow,
) -> bool {
    if change.table != plan.table {
        return false;
    }
    let Some(row) = change.row.as_ref() else {
        return true;
    };
    match row_matches_query_filters(plan, input, row) {
        None => true,
        Some(true) => true,
        Some(false) => update_may_have_changed_query_membership(plan, change),
    }
}

fn row_matches_query_filters(plan: &QueryPlan, input: &HandlerInput, row: &Value) -> Option<bool> {
    for filter in &plan.filters {
        if filter.op != FilterOp::Eq {
            return None;
        }
        let actual = row.get(&filter.field)?;
        let expected = eval_match_expr(&filter.value, input)?;
        if !values_equal(actual, &expected) {
            return Some(false);
        }
    }
    Some(true)
}

fn update_may_have_changed_query_membership(plan: &QueryPlan, change: &ChangedRow) -> bool {
    if change.op != ChangeOp::Update {
        return false;
    }
    if change.changed_fields.is_empty() {
        return true;
    }
    plan.filters
        .iter()
        .any(|filter| change.changed_fields.contains(&filter.field))
}

fn field_scope_change_is_disjoint(change: &ChangedRow, field: &str, expected: &Value) -> bool {
    let Some(row) = change.row.as_ref() else {
        return false;
    };
    let Some(actual) = row.get(field) else {
        return false;
    };
    if values_equal(actual, expected) {
        return false;
    }
    if change.op == ChangeOp::Update {
        if change.changed_fields.is_empty()
            || change.changed_fields.iter().any(|name| name == field)
        {
            return false;
        }
    }
    true
}

fn eval_match_expr(expr: &ValueExpr, input: &HandlerInput) -> Option<Value> {
    match expr {
        ValueExpr::Arg(name) => input.args.get(name).cloned(),
        ValueExpr::AuthUserId => input.auth.user_id.clone().map(Value::String),
        ValueExpr::Literal(value) => Some(value.clone()),
        ValueExpr::Binding(_) | ValueExpr::RuntimeId | ValueExpr::RuntimeNow => None,
    }
}

fn values_equal(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        _ => actual == expected,
    }
}
