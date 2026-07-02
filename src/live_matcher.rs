use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{
    FilterExpr, FilterOp, FunctionDefinition, FunctionRuntime, HandlerInput, HandlerPlan,
    OrderDirection, QueryOutput, QueryPlan, ValueExpr,
};
use crate::storage::{
    CapturedReadDependency, CapturedReadKind, ChangeOp, ChangedRow, LocalDatabase,
};
use serde_json::{Value, json};
use std::cmp::Ordering;

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
            order: None,
            limit: None,
            result_count: None,
            boundary: None,
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
                    order: None,
                    limit: None,
                    result_count: None,
                    boundary: None,
                });
            }
        }
    }

    let (order, limit, result_count, boundary) = query_dependency_metadata(plan, &output.rows)?;
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
        order,
        limit,
        result_count,
        boundary,
    });

    Ok(dependencies)
}

pub(crate) fn query_dependency_metadata(
    plan: &QueryPlan,
    rows: &[Value],
) -> SnapbackResult<(Option<Value>, Option<usize>, Option<usize>, Option<Value>)> {
    let order = if plan.order.is_empty() {
        None
    } else {
        Some(serde_json::to_value(&plan.order).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_CAPTURED_READ_SERIALIZE_FAILED",
                "runtime",
                "query order dependency could not be serialized",
            )
            .with_details(json!({ "error": error.to_string() }))
        })?)
    };
    Ok((
        order,
        plan.limit,
        Some(rows.len()),
        query_boundary(plan, rows),
    ))
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
            .any(|change| change_may_affect_query_plan(plan, input, change, None)),
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
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(_))
        | FunctionRuntime::HostPlan(HandlerPlan::Action(_)) => true,
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

/// Whether a committed change may affect the query described by a captured
/// query read dependency. Reused by commit-time read-set validation (LLP 0032
/// E4) so a disjoint-row write that does not match the query's predicate stops
/// conflicting — the same predicate the live matcher uses to decide delivery.
///
/// @ref LLP 0020#phase-3-capture-read-sets-during-handler-execution — one extractor, three consumers.
pub(crate) fn query_dependency_change_may_affect(
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
    change_may_affect_query_plan(&plan, input, change, Some(dependency))
}

fn change_may_affect_query_plan(
    plan: &QueryPlan,
    input: &HandlerInput,
    change: &ChangedRow,
    dependency: Option<&CapturedReadDependency>,
) -> bool {
    if change.table != plan.table {
        return false;
    }
    let Some(row) = change.row.as_ref() else {
        return true;
    };
    match row_matches_query_filters(plan, input, row) {
        None => true,
        Some(true) => matching_row_may_affect_query(plan, dependency, change, row),
        Some(false) => update_may_have_changed_query_membership(plan, change),
    }
}

/// Whether a row satisfies a query plan's filters. `None` when a filter cannot
/// be evaluated against the row (a missing field or a binding-valued predicate).
///
/// @ref LLP 0020#phase-3-capture-read-sets-during-handler-execution — one
/// extractor, three consumers: the matcher's row-vs-plan predicate is reused by
/// the read-your-writes overlay (LLP 0032 E2) so buffered writes are filtered by
/// the same logic the live matcher uses.
pub(crate) fn row_matches_query_filters(
    plan: &QueryPlan,
    input: &HandlerInput,
    row: &Value,
) -> Option<bool> {
    for filter in &plan.filters {
        if !filter_matches_row(filter, input, row)? {
            return Some(false);
        }
    }
    Some(true)
}

fn filter_matches_row(filter: &FilterExpr, input: &HandlerInput, row: &Value) -> Option<bool> {
    let actual = row.get(&filter.field)?;
    let expected = eval_match_expr(&filter.value, input)?;
    match filter.op {
        FilterOp::Eq => Some(values_equal(actual, &expected)),
        FilterOp::In => {
            let values = expected.as_array()?;
            Some(values.iter().any(|value| values_equal(actual, value)))
        }
        FilterOp::Lt => {
            json_value_cmp(actual, &expected).map(|ordering| ordering == Ordering::Less)
        }
        FilterOp::Lte => json_value_cmp(actual, &expected)
            .map(|ordering| ordering == Ordering::Less || ordering == Ordering::Equal),
        FilterOp::Gt => {
            json_value_cmp(actual, &expected).map(|ordering| ordering == Ordering::Greater)
        }
        FilterOp::Gte => json_value_cmp(actual, &expected)
            .map(|ordering| ordering == Ordering::Greater || ordering == Ordering::Equal),
    }
}

fn matching_row_may_affect_query(
    plan: &QueryPlan,
    dependency: Option<&CapturedReadDependency>,
    change: &ChangedRow,
    row: &Value,
) -> bool {
    matching_limited_row_may_affect_query(plan, dependency, change, row).unwrap_or(true)
}

fn matching_limited_row_may_affect_query(
    plan: &QueryPlan,
    dependency: Option<&CapturedReadDependency>,
    change: &ChangedRow,
    row: &Value,
) -> Option<bool> {
    plan.limit?;
    if plan.order.is_empty() {
        return None;
    }
    let dependency = dependency?;
    if dependency.rows.iter().any(|id| id == &change.id) {
        return Some(true);
    }
    let boundary = dependency.boundary.as_ref()?.as_object()?;
    if boundary.get("complete")?.as_bool()? {
        return Some(true);
    }
    let last = boundary.get("last")?;
    let row_key = sort_key(plan, row)?;
    let ordering = compare_sort_keys(plan, &row_key, last)?;
    Some(ordering != Ordering::Greater)
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

fn query_boundary(plan: &QueryPlan, rows: &[Value]) -> Option<Value> {
    let limit = plan.limit?;
    if plan.order.is_empty() || rows.is_empty() {
        return None;
    }
    let first = sort_key(plan, rows.first()?)?;
    let last = sort_key(plan, rows.last()?)?;
    Some(json!({
        "first": first,
        "last": last,
        "complete": rows.len() < limit,
    }))
}

pub(crate) fn sort_key(plan: &QueryPlan, row: &Value) -> Option<Value> {
    let mut values = Vec::with_capacity(plan.order.len());
    for order in &plan.order {
        values.push(row.get(&order.field)?.clone());
    }
    Some(Value::Array(values))
}

pub(crate) fn compare_sort_keys(plan: &QueryPlan, left: &Value, right: &Value) -> Option<Ordering> {
    let left = left.as_array()?;
    let right = right.as_array()?;
    if left.len() != plan.order.len() || right.len() != plan.order.len() {
        return None;
    }
    for ((left_value, right_value), order) in left.iter().zip(right.iter()).zip(plan.order.iter()) {
        let mut ordering = json_value_cmp(left_value, right_value)?;
        if order.direction == OrderDirection::Desc {
            ordering = ordering.reverse();
        }
        if ordering != Ordering::Equal {
            return Some(ordering);
        }
    }
    Some(Ordering::Equal)
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

fn json_value_cmp(left: &Value, right: &Value) -> Option<Ordering> {
    match (left, right) {
        (Value::Null, Value::Null) => Some(Ordering::Equal),
        (Value::Bool(left), Value::Bool(right)) => Some(left.cmp(right)),
        (Value::Number(left), Value::Number(right)) => left.as_f64()?.partial_cmp(&right.as_f64()?),
        (Value::String(left), Value::String(right)) => Some(left.cmp(right)),
        _ => {
            let left_rank = scalar_rank(left)?;
            let right_rank = scalar_rank(right)?;
            Some(left_rank.cmp(&right_rank))
        }
    }
}

fn scalar_rank(value: &Value) -> Option<u8> {
    match value {
        Value::Null => Some(0),
        Value::Bool(_) => Some(1),
        Value::Number(_) => Some(2),
        Value::String(_) => Some(3),
        Value::Array(_) | Value::Object(_) => None,
    }
}
